# PRP — P1.M1.T1.S2: Implement backlog merge — merge architect-decomposed tasks with patched backlog statuses

> Bugfix 001, **Issue 1 (CRITICAL)** second half. S1 (landed) reordered `decomposePRD()`
> so the delta branch is reachable and left an annotated **S2 seam** at `saveBacklog(parsedBacklog)`.
> S2 replaces that seam with a merge: combine the architect's added-requirement output
> (`parsedBacklog`, read from disk) with the in-memory patched backlog (`currentSession.taskRegistry`
> — modified→Planned, removed→Obsolete), then save the merged result. The **integration test
> (full `handleDelta` → non-empty parent backlog) is S3** (deliberately out of scope).

---

## Goal

**Feature Goal**: Add a pure `mergeBacklogs(patched, architect): Backlog` function in a new
`src/core/backlog-merger.ts` that takes the patched backlog as the base and folds in the
architect's freshly-decomposed added-requirement tasks — matching Phases/Milestones by **title**
(to extend existing phases) and de-duplicating Tasks/Subtasks by **ID** (so re-decomposed
modified/removed items don't duplicate). Wire it into `decomposePRD()` at the S1 seam so the
delta session's `tasks.json` ends up with BOTH the patched statuses AND the new added-requirement
tasks.

**Deliverable**:
1. **`src/core/backlog-merger.ts`** — NEW file exporting `mergeBacklogs(patched: Backlog, architect: Backlog): Backlog` (pure, synchronous; JSDoc Mode A).
2. **`src/workflows/prp-pipeline.ts`** — EDIT the S2 seam in `decomposePRD()`: replace `saveBacklog(parsedBacklog)` with `mergeBacklogs(currentSession.taskRegistry, parsedBacklog)` → `saveBacklog(merged)`.
3. **`tests/unit/core/backlog-merger.test.ts`** — NEW pure-function test file (no mocks) covering new-phase-append, extend-by-title, task-ID de-dup, milestone/phase collision skips, and the empty-input no-op cases.

**Success Definition**:
- `mergeBacklogs` returns a `Backlog` containing ALL patched items (statuses intact) PLUS the
  architect's new items; re-decomposed existing items are de-duped (not duplicated).
- A Phase from the architect whose title matches an existing patched Phase extends it (new
  milestones/tasks merged in); a Phase with a new title is appended.
- A Task/Subtask whose ID already exists in patched is skipped (de-dup, logged), keeping the
  patched version (correct modified→Planned / removed→Obsolete status).
- `decomposePRD()` saves the MERGED backlog for delta sessions; non-delta sessions are
  byte-equivalent to before (merge with an empty patched registry ≡ the architect output).
- `npm run typecheck && npm run lint && npm run format:check` clean; the new suite passes at
  100% coverage on `backlog-merger.ts`; `delta-prd.test.ts` (S1's suite) stays green.

---

## Why

- **Completes the Issue-1 fix.** S1 made the delta branch REACHABLE; without S2 the architect's
  added-requirement output simply OVERWRITES the patched backlog on disk (the architect writes
  `tasks.json` itself), DISCARDING the modified→Planned / removed→Obsolete statuses the patched
  backlog carried. S2's merge is what produces a delta `tasks.json` that has BOTH.
- **Preserves patched statuses.** `patchBacklog` (step 5 of `spawnDeltaSession`) already applied
  modified→Planned and removed→Obsolete. Those statuses live ONLY in the in-memory
  `currentSession.taskRegistry` after the architect's disk write clobbers `tasks.json`. S2 merges
  that in-memory registry (base) with the architect's disk output (added tasks) → statuses survive.
- **De-duplication prevents duplicates.** delta_prd.md includes Modified/Removed sections; the
  architect MAY re-decompose those into tasks whose IDs already exist. ID-based de-dup keeps the
  patched (correct-status) version and skips the architect's duplicate.
- **Unblocks S3.** The full `handleDelta → spawnDeltaSession → decomposePRD` integration test
  (non-empty parent backlog) asserts added requirements produce new tasks AND patched statuses
  survive — both depend on S2's merge being in place.
- **Scope discipline.** S2 is the merge ONLY. The end-to-end integration test is S3;
  `patchBacklog` `'added'` handling is P1.M2; the architect prompt's non-colliding-ID behavior is
  the architect surface (separate scope).

---

## What

### User-visible behavior
None directly (internal pipeline data merge). Indirectly, once S3 lands: when a user edits
`PRD.md` to ADD a requirement, the delta session's `tasks.json` contains the parent's tasks
(with modified reset to Planned, removed marked Obsolete) AND new tasks for the added requirement.

### Technical requirements (exact contract)

**File 1 — `src/core/backlog-merger.ts`** (NEW; mirror `task-patcher.ts` module shape):

```ts
/**
 * Merge two backlogs: patched (base, statuses preserved) ⊕ architect (added-req tasks).
 *
 * @remarks
 * Combines the architect's freshly-decomposed tasks for ADDED requirements with the patched
 * backlog (whose modified→Planned and removed→Obsolete statuses are already applied by
 * patchBacklog). Matching is by TITLE at the Phase and Milestone levels (robust to the
 * architect re-numbering IDs, since it sees only delta_prd.md); Tasks/Subtasks are de-duplicated
 * by ID so re-decomposed modified/removed items don't duplicate. Any architect item whose ID
 * already exists is SKIPPED with a warn (observable de-dup — never a silent drop).
 *
 * Both inputs are treated as read-only; the result is a fresh Backlog. The patched backlog's
 * statuses are preserved verbatim (it is the base).
 *
 * @param patched - The base backlog (modified/removed statuses already applied).
 * @param architect - The architect's output for added requirements (from delta_prd.md breakdown).
 * @returns A new merged Backlog (BacklogSchema-valid).
 */
export function mergeBacklogs(patched: Backlog, architect: Backlog): Backlog;
```

Algorithm (exact — see Blueprint for full code):
1. `existingIds` = set of ALL ids in `patched` (phase, milestone, task, subtask).
2. `result` = `[...patched.backlog]`; index patched phases by trimmed title.
3. For each `archPhase`:
   - If a result phase has the same trimmed **title** → `mergePhase` (extend): for each architect
     milestone, match by title → append new tasks (ID-de-duped); else append new milestone (ID-checked).
   - Else (new title): if `archPhase.id` not in `existingIds` → register its ids + append; else warn+skip.
4. Return `{ backlog: result }`.

De-dup is DEFENSIVE at every level (phase/milestone/task): any architect item whose ID already
exists is skipped with `logger().warn(...)`. Task-level de-dup is the contract's explicit rule;
phase/milestone ID-checks are defensive guards against duplicate IDs (the schemas don't enforce
uniqueness, so the merge does).

**File 2 — `src/workflows/prp-pipeline.ts`** `decomposePRD()` S2 seam (~L1209-1230):

Replace:
```ts
const parsedBacklog = JSON.parse(tasksContent) as Backlog;
/* S2 SEAM comment */
await this.sessionManager.saveBacklog(parsedBacklog);
this.totalTasks = this.#countTasks();
this.logger.info(`[PRPPipeline] Generated ${parsedBacklog.backlog.length} phases`);
```
with:
```ts
const parsedBacklog = JSON.parse(tasksContent) as Backlog;
// P1.M1.T1.S2: merge the architect's added-requirement output with the in-memory patched
// backlog (currentSession.taskRegistry — modified→Planned, removed→Obsolete). The architect's
// write above clobbered tasks.json on disk; currentSession.taskRegistry (in-memory) is the
// patched backlog and is intact (SessionManager.saveBacklog synced it at spawnDeltaSession step 7).
const patchedBacklog = this.sessionManager.currentSession!.taskRegistry;
const mergedBacklog = mergeBacklogs(patchedBacklog, parsedBacklog);
await this.sessionManager.saveBacklog(mergedBacklog);
this.totalTasks = this.#countTasks();   // reads merged via currentSession (saveBacklog syncs memory)
this.logger.info(`[PRPPipeline] Generated ${mergedBacklog.backlog.length} phases`);
```
Add the import `import { mergeBacklogs } from '../core/backlog-merger.js';` (top of file, near the
other `../core/` imports). `this.currentPhase = 'prd_decomposed'` and the existing totalTasks/
phase logic are unchanged (they already read through `currentSession`, which `saveBacklog` syncs
to the merged result).

**File 3 — `tests/unit/core/backlog-merger.test.ts`** (NEW; pure-function, NO mocks).

### Success Criteria
- [ ] `mergeBacklogs` exported from `src/core/backlog-merger.ts`.
- [ ] Patched items all present in the result with statuses unchanged (it's the base).
- [ ] Architect Phase with a NEW title is appended; architect Phase with a MATCHING title extends
      the existing phase (new milestones/tasks merged in by title).
- [ ] Architect Milestone with a matching title (within a matched phase) gets new tasks appended;
      new-title milestone is appended.
- [ ] Architect Task/Subtask whose ID already exists in patched is skipped (de-dup) — patched's
      version (correct status) is kept; a `logger.warn` fires.
- [ ] Architect Phase/Milestone whose ID collides (despite a new title) is skipped + warned (defensive).
- [ ] `mergeBacklogs(empty, x)` ≡ `x` (non-delta no-op); `mergeBacklogs(x, empty)` ≡ `x`.
- [ ] `decomposePRD()` saves the MERGED backlog; non-delta sessions byte-equivalent to S1.
- [ ] `npm run typecheck && npm run lint && npm run format:check` clean.
- [ ] New suite green at 100% coverage on `backlog-merger.ts`; `delta-prd.test.ts` still green.

---

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed to implement
this successfully?_ **Yes** — the exact S1 seam (with line numbers), the verified data-flow fact
(why `currentSession.taskRegistry` is the patched backlog at the seam), the full Backlog/Phase/
Milestone/Task/Subtask shapes (all `readonly`, strict ID regexes), the exact merge algorithm with
helper pseudocode, the precedent module to mirror (`task-patcher.ts`), the per-branch test
recipes, and the executable validation commands are all below.

### Documentation & References

```yaml
# MUST READ — root cause + Approach A fix (the merge is Approach A's second half)
- docfile: plan/008_15504f60a0ef/bugfix/001_9a4fd2467e1a/architecture/delta_workflow.md
  section: "Issue 1" → "Fix Strategy: Approach A (PRD-recommended)" → "Merge Logic Considerations"
  why: Confirms patchedBacklog is ALWAYS non-empty; the merge takes patched as base and appends/merges
        architect output; title-based phase matching for the "extend existing phase" scenario.

# MUST READ — design + the verified data-flow fact + algorithm (authored with this PRP)
- docfile: plan/008_15504f60a0ef/bugfix/001_9a4fd2467e1a/P1M1T1S2/research/backlog-merge-design.md
  section: "2. THE data-flow fact" and "4. Merge algorithm" and "5. ALWAYS-merge at the seam"
  why: Proves currentSession.taskRegistry IS the patched backlog at the seam (saveBacklog syncs memory);
        gives the exact algorithm; explains why always-merge (no isDelta branch) is safe + simpler.

# MUST READ — the data model (Phase→Milestone→Task→Subtask, all readonly, ID regexes)
- file: src/core/models.ts
  why: The shapes the merge builds. Phase{id,type:'Phase',title,status,description,milestones},
        Milestone{...,tasks}, Task{...,subtasks}, Subtask{id,...,story_points,dependencies,context_scope,prd_selectors}.
        ALL fields readonly → build fresh objects (spread), never mutate.
  critical: ID regexes — Phase ^P\d+$, Milestone ^P\d+\.M\d+$, Task ^P\d+\.M\d+\.T\d+$, Subtask
        ^P\d+\.M\d+\.T\d+\.S\d+$. The merge preserves IDs verbatim → stays schema-valid. saveBacklog
        validates via BacklogSchema.parse (writeTasksJSON) so the merged output MUST be valid.

# PATTERN FILE 1 — sibling pure backlog-transformation module to MIRROR
- file: src/core/task-patcher.ts
  why: Structure for backlog-merger.ts: module JSDoc, lazy logger `const logger = (): Logger => (_logger ??= getLogger('BacklogMerger'))`,
        exported pure function with @param/@returns/@remarks/@example. patchBacklog is the precedent
        for an immutable backlog transform (returns a new Backlog; never mutates input).
  pattern: "export function patchBacklog(backlog, delta): Backlog { ... return patchedBacklog; }"
  gotcha: patchBacklog uses updateItemStatus from task-utils for immutable status changes; the merge
        does NOT change statuses (patched is the base), so it does NOT need updateItemStatus — it
        builds new Phase/Milestone/Task objects via spread.

# PATTERN FILE 2 — the file containing the S2 seam
- file: src/workflows/prp-pipeline.ts
  why: decomposePRD() S2 seam at ~L1209-1230 (the `saveBacklog(parsedBacklog)` call under the
        "S2 SEAM" comment). Add the mergeBacklogs import near the other ../core/ imports.
  gotcha: Keep `this.totalTasks = this.#countTasks();` and `this.currentPhase = 'prd_decomposed';`
        unchanged (they read through currentSession, which saveBacklog syncs to the merged result).

# TEST FILE — verify it stays green; do NOT rewrite (S3 owns the integration test)
- file: tests/unit/core/delta-prd.test.ts
  why: CASE A (delta, EMPTY patched backlog) and CASE C (non-delta) exercise decomposePRD end-to-end
        with mocked architect + session-manager. After S2, CASE A calls mergeBacklogs(empty, parsed)
        ≡ parsed → behavior unchanged → CASE A stays green. CASE C same.
  gotcha: Do NOT add the non-empty-parent-backlog integration test here — that is S3. S2 only adds
        the pure-function merge tests (new file) + the seam wiring.

# REUSABLE HELPERS (optional; the merge is self-contained but these exist if needed)
- file: src/utils/task-utils.ts
  why: findItem/getAllSubtasks exist, but the merge walks the hierarchy itself (it needs title indices
        + per-level de-dup), so it does NOT reuse them. Mention only to avoid re-inventing traversal.
```

### Current Codebase tree (relevant slice)

```bash
src/core/
├── models.ts          # READ-ONLY — Backlog/Phase/Milestone/Task/Subtask shapes + Zod schemas
├── task-patcher.ts    # READ-ONLY — patchBacklog precedent (sibling pure module to MIRROR)
└── backlog-merger.ts  # ← S2 CREATES (mergeBacklogs pure function)
src/workflows/
└── prp-pipeline.ts    # EDIT — decomposePRD() S2 seam: saveBacklog(parsed) → saveBacklog(merge(...))
tests/unit/core/
├── delta-prd.test.ts        # UNCHANGED (verify green; S3 owns the integration test)
└── backlog-merger.test.ts   # ← S2 CREATES (pure-function merge tests, NO mocks)
```

### Desired Codebase tree with files to be added/edited

```bash
src/core/backlog-merger.ts            # NEW
src/workflows/prp-pipeline.ts         # MODIFIED (decomposePRD seam: +1 import, merge call, log tweak)
tests/unit/core/backlog-merger.test.ts # NEW
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — ALL Backlog fields are `readonly`. Build NEW Phase/Milestone/Task objects via spread;
//   never mutate. The merge returns a fresh Backlog ({ backlog: [...] }); patched is untouched.

// CRITICAL (data flow) — the architect WRITES tasks.json itself (to $TASKS_FILE), clobbering the
//   on-disk patched backlog. BUT SessionManager.saveBacklog syncs #currentSession.taskRegistry on
//   every write (verified), so currentSession.taskRegistry STILL HOLDS the patched backlog at the
//   seam. S2 reads patchedBacklog = currentSession!.taskRegistry (NOT from disk). See research §2.

// CRITICAL — saveBacklog VALIDATES via BacklogSchema.parse (writeTasksJSON). The merged output must
//   be schema-valid. The merge preserves IDs verbatim from two valid inputs and de-dups collisions,
//   so validity holds. Do NOT synthesize/re-number IDs (out of scope; the architect is expected to
//   produce non-colliding IDs via its prompt — separate scope).

// CRITICAL — de-dup is by ID at the Task/Subtask level (contract (c)); Phase/Milestone MERGE by
//   TITLE (contract (b)). Title-matching is robust to the architect re-numbering IDs (it sees only
//   delta_prd.md, not the existing ID space). Add defensive ID-collision skips (warn) at phase/
//   milestone level too, so the result never has duplicate IDs (schemas don't enforce uniqueness).

// GOTCHA — de-dup SKIPS must be LOGGED (logger.warn), NEVER silent. The original bug was a silent
//   drop; S2 must make every merge-skip observable. Each warn branch needs a test (coverage).

// GOTCHA — ALWAYS merge at the seam (no `if (isDelta)` branch). mergeBacklogs(empty, x) ≡ x, so
//   non-delta-no-backlog (the only non-delta path reaching the seam) is byte-equivalent to S1.
//   Verified in research §5. This keeps one code path + a clean coverage story.

// GOTCHA — `this.totalTasks = this.#countTasks();` reads through currentSession, which saveBacklog
//   syncs to the MERGED result. Do NOT change this line — it already reflects the merged backlog.

// GOTCHA — prettier is ERROR-enforced (prettier/prettier: error in .eslintrc.json). Run `npm run fix`
//   before format:check. The recursive helpers' spread chains may need reformatting.

// GOTCHA — 100% coverage is enforced (vitest.config.ts). Every branch of mergeBacklogs + helpers
//   (title-match vs new; id-collision skip at phase/milestone/task; empty inputs) needs a test.
//   The 9 test cases in Task 3 map 1:1 to these branches.

// GOTCHA — do NOT run the full `npm run test:run` as the gate. 297 pre-existing failures (bugfix
//   Issue 3, P2/P3 scope) are unrelated. S2's gate: typecheck + lint + format + backlog-merger.test.ts
//   + delta-prd.test.ts (regression).
```

---

## Implementation Blueprint

### Data models and structure

No new models — S2 consumes `Backlog`/`Phase`/`Milestone`/`Task`/`Subtask` from `src/core/models.ts`.
The only "model" is the `mergeBacklogs` signature + the internal helper contracts:

```ts
// src/core/backlog-merger.ts (NEW)
export function mergeBacklogs(patched: Backlog, architect: Backlog): Backlog;

// module-private helpers (NOT exported):
function mergePhase(existing: Phase, archPhase: Phase, existingIds: Set<string>): Phase;
function mergeMilestone(existing: Milestone, archMs: Milestone, existingIds: Set<string>): Milestone;
function collectIds(backlog: Backlog): Set<string>;     // all P/M/T/S ids
function registerItemIds(item: Phase | Milestone | Task, existingIds: Set<string>): void; // add item + descendant ids
```

### Implementation Tasks (ordered by dependencies — implicit TDD: RED first, then GREEN)

```yaml
Task 1: CREATE tests/unit/core/backlog-merger.test.ts   (RED — must fail before impl)
  - IMPORT: mergeBacklogs from '../../../src/core/backlog-merger.js';
        type Backlog, Phase, Milestone, Task, Subtask from '../../../src/core/models.js'.
  - STRUCTURE: pure-function tests, NO mocks, NO tmpdir (data-in/data-out). describe('mergeBacklogs').
        Build small Backlog fixtures inline (helper makePhase/makeMilestone/makeTask/makeSubtask
        or hand-written literals with valid IDs + the ContextScopeSchema-valid context_scope).
  - CASES (cover every branch; each maps to a coverage branch):
      1. NEW PHASE: patched has [P1]; architect has [P2(new title)] → result = [P1, P2].
      2. EXTEND PHASE BY TITLE: patched P1(title 'Foundation') has milestone M1(task T1);
         architect P1(title 'Foundation', id maybe different) has milestone M1(title 'Core', task T2)
         AND a NEW milestone M2 → result P1 has M1(T1, T2) + M2. (title match at phase + milestone;
         new task appended to matched milestone; new milestone appended.)
      3. TASK ID DE-DUP (contract (c)): patched P1.M1.T1.S1(Complete); architect P1.M1.T1 with a
         subtask S1 (SAME id) AND a new task T2 → T1 de-duped (skipped, patched's kept), T2 appended.
         Assert result has patched T1.S1 (status Complete, NOT duplicated) + new T2. Assert a warn
         fired (spy on the logger, or assert via the logger mock).
      4. PHASE ID COLLISION (defensive): patched has P1(title 'A'); architect has P1(title 'B',
         id 'P1' collides) → the architect phase is SKIPPED + warned (no duplicate P1 id). Result = [P1(title A)].
      5. MILESTONE ID COLLISION (defensive): within a title-matched phase, architect milestone with
         a NEW title but a COLLIDING id → skipped + warned.
      6. EMPTY PATCHED (non-delta no-op): mergeBacklogs({backlog:[]}, architect) deep-equals architect.
      7. EMPTY ARCHITECT (no-op): mergeBacklogs(patched, {backlog:[]}) deep-equals patched.
      8. STATUSES PRESERVED: patched item with status 'Obsolete' (removed) and 'Planned' (modified)
         survives the merge unchanged when the architect also emits those ids (de-dup keeps patched).
      9. DEEP NESTING / multiple architect phases: patched [P1, P2]; architect [P1(extend), P3(new),
         P4(new)] → result [P1(extended), P2, P3, P4].
  - NAMING: it('appends an architect phase with a new title'), it('extends an existing phase by title'),
        it('de-duplicates a task whose id already exists (keeps patched status)'), etc.
  - PLACEMENT: tests/unit/core/backlog-merger.test.ts.
  - GOTCHA: context_scope on Subtask fixtures MUST satisfy ContextScopeSchema (the
        'CONTRACT DEFINITION:\n1. RESEARCH NOTE: ...\n2. INPUT: ...\n3. LOGIC: ...\n4. OUTPUT: ...'
        format) or the backlog won't round-trip — but mergeBacklogs itself does NOT validate (it's
        pure data manipulation), so fixtures only need valid TypeScript shapes. Keep IDs regex-valid.
  - EXPECTED NOW: import of mergeBacklogs fails → RED.

Task 2: CREATE src/core/backlog-merger.ts   (GREEN — the pure function + helpers)
  - IMPORT: type { Backlog, Phase, Milestone, Task } from './models.js';
        { getLogger, type Logger } from '../utils/logger.js'.
  - MODULE: mirror task-patcher.ts — module JSDoc (@module core/backlog-merger), lazy logger
        `let _logger; const logger = () => (_logger ??= getLogger('BacklogMerger'));`.
  - IMPLEMENT mergeBacklogs + the 4 helpers per the algorithm in "Technical requirements" + the
        full code below. collectIds walks patched once; registerItemIds adds an item's id + descendants.
  - DE-DUP SKIPS call logger().warn({ itemId, level: 'phase'|'milestone'|'task' }, '... merge de-dup skip ...').
  - DO NOT mutate inputs (spread + new arrays). DO NOT change statuses (patched is the base).
  - DO NOT validate (BacklogSchema.parse happens later in saveBacklog); assume well-formed inputs.
  - PLACEMENT: src/core/backlog-merger.ts.
  - EXPECTED: backlog-merger.test.ts cases 1–9 turn GREEN; 100% coverage of the new file.

Task 3: EDIT src/workflows/prp-pipeline.ts — wire the merge into the S2 seam (GREEN)
  - ADD import: `import { mergeBacklogs } from '../core/backlog-merger.js';` (near other ../core/ imports).
  - AT the S2 seam (~L1209): replace `await this.sessionManager.saveBacklog(parsedBacklog);` with the
        merge block in "Technical requirements" File 2 (patchedBacklog = currentSession!.taskRegistry;
        mergedBacklog = mergeBacklogs(patchedBacklog, parsedBacklog); saveBacklog(mergedBacklog)).
  - UPDATE the "Generated X phases" log to use mergedBacklog.backlog.length.
  - KEEP `this.totalTasks = this.#countTasks();` and `this.currentPhase = 'prd_decomposed';` UNCHANGED.
  - REMOVE/REPLACE the "S2 SEAM" comment with the real merge rationale comment.
  - DO NOT touch S1's reorder, the hasBacklog block, loadDeltaPRD try/catch, or createArchitectAgent.
  - EXPECTED: delta-prd.test.ts CASE A (empty patched → merge no-op) + CASE C (non-delta) stay green.

Task 4: FORMAT + VERIFY
  - RUN: npm run fix (lint:fix + prettier --write) → npm run typecheck → npm run lint → npm run format:check.
  - RUN: npx vitest run tests/unit/core/backlog-merger.test.ts   # new suite green; 100% coverage.
  - RUN: npx vitest run tests/unit/core/delta-prd.test.ts        # S1 regression — MUST stay green.
  - EXPECTED: all clean. If CASE A fails, the merge changed non-empty-vs-empty behavior — re-check
        that mergeBacklogs(empty, x) ≡ x (case 6 in Task 1). If coverage <100% on backlog-merger.ts,
        a de-dup/warn branch is unhit — add the matching collision case (3/4/5).
```

### Implementation Patterns & Key Details

```ts
// ---- src/core/backlog-merger.ts (NEW) ----
import type { Backlog, Phase, Milestone, Task } from './models.js';
import { getLogger, type Logger } from '../utils/logger.js';

let _logger: Logger | undefined;
const logger = (): Logger => (_logger ??= getLogger('BacklogMerger'));

/** Collect every Phase/Milestone/Task/Subtask id in `backlog` (for de-dup). */
function collectIds(backlog: Backlog): Set<string> {
  const ids = new Set<string>();
  for (const p of backlog.backlog) {
    ids.add(p.id);
    for (const m of p.milestones) {
      ids.add(m.id);
      for (const t of m.tasks) {
        ids.add(t.id);
        for (const s of t.subtasks) ids.add(s.id);
      }
    }
  }
  return ids;
}

/** Add a Phase's id + all descendant ids to `ids` (so later items can't double-add). */
function registerPhaseIds(phase: Phase, ids: Set<string>): void {
  ids.add(phase.id);
  for (const m of phase.milestones) {
    ids.add(m.id);
    for (const t of m.tasks) {
      ids.add(t.id);
      for (const s of t.subtasks) ids.add(s.id);
    }
  }
}

/** Extend an existing milestone with the architect milestone's NEW tasks (id-de-duped). */
function mergeMilestone(
  existing: Milestone,
  archMs: Milestone,
  existingIds: Set<string>
): Milestone {
  const tasks = [...existing.tasks];
  for (const archTask of archMs.tasks) {
    if (existingIds.has(archTask.id)) {
      logger().warn(
        { itemId: archTask.id, level: 'task' },
        'merge de-dup skip: architect task id already exists (patched status preserved)'
      );
      continue; // de-dup — keep patched's version (correct status)
    }
    existingIds.add(archTask.id);
    for (const s of archTask.subtasks) existingIds.add(s.id);
    tasks.push(archTask);
  }
  return { ...existing, tasks };
}

/** Extend an existing phase with the architect phase's milestones (title-match or new). */
function mergePhase(
  existing: Phase,
  archPhase: Phase,
  existingIds: Set<string>
): Phase {
  const milestones = [...existing.milestones];
  const msByTitle = new Map<string, number>();
  milestones.forEach((m, i) => msByTitle.set(m.title.trim(), i));

  for (const archMs of archPhase.milestones) {
    const idx = msByTitle.get(archMs.title.trim());
    if (idx !== undefined) {
      milestones[idx] = mergeMilestone(milestones[idx], archMs, existingIds); // extend by title
    } else if (!existingIds.has(archMs.id)) {
      existingIds.add(archMs.id);
      for (const t of archMs.tasks) {
        existingIds.add(t.id);
        for (const s of t.subtasks) existingIds.add(s.id);
      }
      msByTitle.set(archMs.title.trim(), milestones.length);
      milestones.push(archMs); // new milestone
    } else {
      logger().warn(
        { itemId: archMs.id, level: 'milestone' },
        'merge de-dup skip: architect milestone id already exists'
      );
    }
  }
  return { ...existing, milestones };
}

export function mergeBacklogs(patched: Backlog, architect: Backlog): Backlog {
  const existingIds = collectIds(patched);
  const result: Phase[] = [...patched.backlog];
  const phaseByTitle = new Map<string, number>();
  result.forEach((p, i) => phaseByTitle.set(p.title.trim(), i));

  for (const archPhase of architect.backlog) {
    const idx = phaseByTitle.get(archPhase.title.trim());
    if (idx !== undefined) {
      result[idx] = mergePhase(result[idx], archPhase, existingIds); // extend by title
    } else if (!existingIds.has(archPhase.id)) {
      registerPhaseIds(archPhase, existingIds);
      phaseByTitle.set(archPhase.title.trim(), result.length);
      result.push(archPhase); // new phase
    } else {
      logger().warn(
        { itemId: archPhase.id, level: 'phase' },
        'merge de-dup skip: architect phase id already exists'
      );
    }
  }
  return { backlog: result };
}

// ---- src/workflows/prp-pipeline.ts (EDIT — the seam) ----
// import (top, near other ../core/ imports):
//   import { mergeBacklogs } from '../core/backlog-merger.js';
//
// in decomposePRD() at the S2 seam:
//   const parsedBacklog = JSON.parse(tasksContent) as Backlog;
//   const patchedBacklog = this.sessionManager.currentSession!.taskRegistry;
//   const mergedBacklog = mergeBacklogs(patchedBacklog, parsedBacklog);
//   await this.sessionManager.saveBacklog(mergedBacklog);
//   this.totalTasks = this.#countTasks();                                  // unchanged
//   this.logger.info(`[PRPPipeline] Generated ${mergedBacklog.backlog.length} phases`);

// ---- tests/unit/core/backlog-merger.test.ts (NEW — key assertions) ----
import { describe, it, expect, beforeEach } from 'vitest';
import { mergeBacklogs } from '../../../src/core/backlog-merger.js';
import type { Backlog } from '../../../src/core/models.js';

const CS = 'CONTRACT DEFINITION:\n1. RESEARCH NOTE: x.\n2. INPUT: x.\n3. LOGIC: x.\n4. OUTPUT: x.';
const st = (id: string) => ({ id, type: 'Subtask' as const, title: id, status: 'Planned' as const, story_points: 1, dependencies: [] as string[], context_scope: CS, prd_selectors: [] });

it('extends an existing phase by title (new milestone + new task in matched milestone)', () => {
  const patched: Backlog = { backlog: [{
    id: 'P1', type: 'Phase', title: 'Foundation', status: 'Planned', description: 'd',
    milestones: [{ id: 'P1.M1', type: 'Milestone', title: 'Core', status: 'Planned', description: 'd',
      tasks: [{ id: 'P1.M1.T1', type: 'Task', title: 'T1', status: 'Complete', description: 'd', subtasks: [st('P1.M1.T1.S1')] }] }],
  }] };
  const architect: Backlog = { backlog: [{
    id: 'P9', type: 'Phase', title: 'Foundation', status: 'Planned', description: 'd',   // DIFFERENT id, SAME title
    milestones: [
      { id: 'P9.M1', type: 'Milestone', title: 'Core', status: 'Planned', description: 'd',   // SAME title → extend
        tasks: [{ id: 'P9.M1.T1', type: 'Task', title: 'New', status: 'Planned', description: 'd', subtasks: [st('P9.M1.T1.S1')] }] },
      { id: 'P9.M2', type: 'Milestone', title: 'Extra', status: 'Planned', description: 'd',   // NEW title → append
        tasks: [] }],
  }] };
  const merged = mergeBacklogs(patched, architect);
  const p1 = merged.backlog[0];                                 // patched P1, EXTENDED (title match)
  expect(p1.id).toBe('P1');                                     // patched id preserved
  expect(p1.milestones).toHaveLength(2);                        // M1 (extended) + M2 (new)
  expect(p1.milestones[0].tasks).toHaveLength(2);               // T1 (patched) + new T
  expect(p1.milestones[0].tasks[0].id).toBe('P1.M1.T1');        // patched task kept (status Complete)
  expect(p1.milestones[0].tasks[0].status).toBe('Complete');
});

it('de-duplicates a task whose id already exists (keeps patched status)', () => {
  const patched: Backlog = { backlog: [{ id: 'P1', type: 'Phase', title: 'F', status: 'Planned', description: 'd',
    milestones: [{ id: 'P1.M1', type: 'Milestone', title: 'M', status: 'Planned', description: 'd',
      tasks: [{ id: 'P1.M1.T1', type: 'Task', title: 'T', status: 'Obsolete', description: 'd', subtasks: [st('P1.M1.T1.S1')] }] }] }] };
  const architect: Backlog = { backlog: [{ id: 'P1', type: 'Phase', title: 'F', status: 'Planned', description: 'd',
    milestones: [{ id: 'P1.M1', type: 'Milestone', title: 'M', status: 'Planned', description: 'd',
      tasks: [{ id: 'P1.M1.T1', type: 'Task', title: 'T-dup', status: 'Planned', description: 'd', subtasks: [st('P1.M1.T1.S1')] }] }] }] };
  const merged = mergeBacklogs(patched, architect);
  // T1 de-duped: patched's Obsolete version kept, architect's duplicate skipped.
  expect(merged.backlog[0].milestones[0].tasks).toHaveLength(1);
  expect(merged.backlog[0].milestones[0].tasks[0].status).toBe('Obsolete');
});

it('mergeBacklogs({backlog:[]}, x) ≡ x (non-delta no-op)', () => {
  const arch: Backlog = { backlog: [{ id: 'P1', type: 'Phase', title: 'N', status: 'Planned', description: 'd', milestones: [] }] };
  expect(mergeBacklogs({ backlog: [] }, arch)).toEqual(arch);
});
```

### Integration Points

```yaml
DOWNSTREAM (S2 ENABLES these — separate subtasks, do NOT do them here):
  - P1.M1.T1.S3 (integration test): drives FULL handleDelta → spawnDeltaSession → decomposePRD with a
        NON-EMPTY parent backlog; asserts the merged tasks.json has BOTH patched statuses AND new
        added-requirement tasks. Depends on S2's merge being in place.
  - P1.M2.T1 (patchBacklog 'added'): removes the silent-drop in task-patcher.ts ~L97. The delta path
        then relies on S2's merge (architect over delta_prd.md) for added reqs — patchBacklog's 'added'
        case becomes a debug-log no-op (delegated to breakdown + merge).

NO OTHER INTEGRATION: mergeBacklogs is a pure function consumed only at the decomposePRD seam. The
  pipeline's run() then calls executeBacklog() over the merged tasks.json. saveBacklog syncs
  currentSession.taskRegistry to the merged result, so #countTasks() and downstream traversal see it.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run fix                  # lint:fix + prettier --write (run first; spread chains may need it)
npm run typecheck            # tsc --noEmit -p tsconfig.build.json — clean
npm run lint                 # eslint . --ext .ts — clean
npm run format:check         # prettier --check — clean
# Expected: all clean. If typecheck fails, the import path or a readonly-field mutation is wrong.
```

### Level 2: Unit Tests (Component Validation)

```bash
# The new pure-function suite (must pass + cover 100% of backlog-merger.ts):
npx vitest run tests/unit/core/backlog-merger.test.ts
# S1 regression — decomposePRD end-to-end with mocks; CASE A (empty patched → merge no-op) + CASE C:
npx vitest run tests/unit/core/delta-prd.test.ts
# Coverage check on the new file:
npx vitest run tests/unit/core/backlog-merger.test.ts --coverage
# Expected: backlog-merger green at 100%; delta-prd green (no regression). If CASE A fails, the merge
# changed empty-vs-non-empty behavior — verify mergeBacklogs({backlog:[]}, x) ≡ x (case 6).
# Do NOT run the full `npm run test:run` — 297 pre-existing failures (Issue 3, P2/P3 scope).
```

### Level 3: Integration Testing (System Validation)

```bash
# N/A for S2 — the full handleDelta → non-empty-parent-backlog integration test is P1.M1.T1.S3.
# S2's job is the merge function + seam wiring; S3 proves it end-to-end. A targeted source-level smoke
# proving the seam is wired:
npx tsx -e "
import { readFileSync } from 'node:fs';
const src = readFileSync('src/workflows/prp-pipeline.ts','utf8');
console.log('imports mergeBacklogs?', /import\s*{\s*mergeBacklogs\s*}/.test(src));
console.log('seam calls mergeBacklogs?', /mergeBacklogs\(\s*\S+\.taskRegistry/.test(src));
"
# Expected: imports mergeBacklogs? true ; seam calls mergeBacklogs? true.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# No MCP/DB/HTTP surface. Domain checks (record in commit message):
#   - Patched statuses (modified→Planned, removed→Obsolete) survive the merge (patched is the base).
#   - Phase/Milestone merge by TITLE; Task/Subtask de-dup by ID (contract (b)/(c)).
#   - De-dup skips are LOGGED (warn), never silent (the original bug was a silent drop).
#   - mergeBacklogs(empty, x) ≡ x → non-delta-no-backlog byte-equivalent to S1.
#   - The merge does NOT re-number IDs (architect non-colliding-ID behavior is separate scope).
#   - saveBacklog validates the merged output via BacklogSchema.parse → it must be schema-valid
#     (preserved by verbatim IDs + de-dup; no duplicate ids introduced).
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` clean.
- [ ] `npm run lint` clean.
- [ ] `npm run format:check` clean.
- [ ] `npx vitest run tests/unit/core/backlog-merger.test.ts` green at 100% coverage.
- [ ] `npx vitest run tests/unit/core/delta-prd.test.ts` green (S1 regression — CASE A/C).

### Feature Validation
- [ ] `mergeBacklogs` keeps ALL patched items with statuses unchanged (base).
- [ ] Architect Phase with a new title is appended; matching-title Phase is extended.
- [ ] Architect Milestone with a matching title gets new tasks; new-title milestone appended.
- [ ] Architect Task/Subtask whose ID exists is skipped (de-dup) + warned; patched's version kept.
- [ ] Phase/Milestone ID collisions (despite new title) are skipped + warned (defensive).
- [ ] `mergeBacklogs(empty, x) ≡ x`; `mergeBacklogs(x, empty) ≡ x`.
- [ ] `decomposePRD()` saves the MERGED backlog; non-delta byte-equivalent to S1.

### Code Quality Validation
- [ ] New `src/core/backlog-merger.ts` mirrors `task-patcher.ts` (module JSDoc, lazy logger, pure fn).
- [ ] Inputs never mutated (spread + new arrays); patched statuses preserved verbatim.
- [ ] De-dup skips are logged (warn) — never silent.
- [ ] Always-merge at the seam (no `if (isDelta)` branch); `#countTasks`/`currentPhase` unchanged.
- [ ] No re-numbering of IDs; no BacklogSchema validation inside the merge (saveBacklog validates).
- [ ] Only `backlog-merger.ts` (new) + the `prp-pipeline.ts` seam + the new test file are touched.

### Documentation & Deployment
- [ ] JSDoc on `mergeBacklogs` (Mode A) documents: combines architect added-req tasks with the patched
      backlog (modified/removed already handled); title-match phases/milestones; ID-de-dup tasks.
- [ ] Commit message notes: merge = Approach A's second half; integration test = S3; non-colliding
      architect IDs = separate scope; always-merge verified byte-equivalent for non-delta.

---

## Anti-Patterns to Avoid

- ❌ Don't mutate the input backlogs — all fields are `readonly`; build fresh objects via spread.
- ❌ Don't change statuses in the merge — patched is the base; its modified→Planned / removed→Obsolete
      statuses must survive verbatim. (Status mutation is `patchBacklog`'s job, already done.)
- ❌ Don't match Phases/Milestones by ID for the MERGE decision — match by TITLE (contract (b)); the
      architect re-numbers IDs (it sees only delta_prd.md). ID is used only for DE-DUP (skip collisions).
- ❌ Don't silently skip architect items on de-dup — LOG a warn (the original bug was a silent drop;
      every merge-skip must be observable). Each warn branch needs a coverage test.
- ❌ Don't add an `if (isDelta)` branch at the seam — always-merge (mergeBacklogs(empty,x)≡x is
      byte-equivalent to S1 for non-delta). One code path, cleaner coverage.
- ❌ Don't re-number IDs mechanically — out of scope; the architect is expected to produce
      non-colliding IDs via its prompt (separate scope). The merge de-dups defensively instead.
- ❌ Don't validate inside `mergeBacklogs` (no BacklogSchema.parse) — it's a pure transform;
      saveBacklog validates on write. Assume well-formed inputs.
- ❌ Don't add the non-empty-parent-backlog integration test — that's S3. S2 keeps delta-prd CASE A/C green.
- ❌ Don't touch `patchBacklog` 'added' (task-patcher.ts) — that's P1.M2.
- ❌ Don't change `this.totalTasks = this.#countTasks()` or `this.currentPhase` — they read through
      currentSession, which saveBacklog syncs to the merged result.
- ❌ Don't run the full `npm run test:run` as the gate — 297 pre-existing failures (Issue 3, P2/P3).
      Use backlog-merger.test.ts + delta-prd.test.ts.

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: S1 is LANDED (the seam exists with an explicit "S2 SEAM" comment), and the critical
data-flow fact S2 depends on — `currentSession.taskRegistry` holds the patched backlog at the seam
because `SessionManager.saveBacklog` syncs memory (`taskRegistry: written`) — is VERIFIED in-repo,
not assumed. The merge is a small pure function (~80 lines) with a precisely specified algorithm
(title-match phases/milestones, ID-de-dup tasks, defensive collision skips), mirroring the existing
`task-patcher.ts` module shape. The Backlog/Phase/Milestone/Task/Subtask shapes and ID regexes are
confirmed, and the merge preserves them verbatim (no validation/re-numbering). The seam edit is a
3-line swap. Tests are pure-data scenarios (no mocks) mapping 1:1 to coverage branches, plus the
existing delta-prd suite verifies the wiring stays green. Residual risks: (a) a prettier nit on the
spread chains (auto-fixed), (b) the `context_scope` fixtures needing the CONTRACT DEFINITION format
(called out), and (c) the ID-collision edge case being an architect-prompt responsibility (documented
assumption, not mechanically solved). No external/runtime unknowns.