# PRP — P1.M1.T1.S2: Wire renumbering into mergeBacklogs/mergePhase/mergeMilestone (replace skip→renumber-append)

> Bugfix 002, **BUG-001 (CRITICAL)**. S1 (in parallel) adds the pure renumber helpers
> (`maxPhaseNumber`/`maxChildNumber`/`renumberPhase`/`renumberMilestone`/`renumberTask`).
> **S2 wires them into the three skip-on-collision branches** so a colliding architect item is
> RENUMBERED-and-appended instead of DROPPED. The architect numbers fresh from `P1` every run, so
> today every ADDED-requirement item collides and is lost — defeating PRD §4.3 step 6. After S2,
> no architect item is ever dropped. **The realistic-collision integration test is S3** (out of scope).

---

## Goal

**Feature Goal**: In `src/core/backlog-merger.ts`, replace the three **skip-on-collision** branches
(`mergeBacklogs` phase `else`, `mergePhase` milestone `else`, `mergeMilestone` task `continue`) with
**renumber-and-append** using S1's helpers — so a new-title Phase/Milestone whose ID collides, and a
colliding architect Task, are each renumbered to a fresh hierarchy-consistent ID and APPENDED (never
dropped). Remove the now-dead `logger` (the module becomes fully pure, per the contract). Correct the
stale JSDoc and the tests that asserted the drop as correct.

**Deliverable**:
1. **`src/core/backlog-merger.ts`** — rewire the 3 loops; delete the `logger` import + lazy-init;
   correct the module header + per-function JSDoc (`Defensive ID-collision skips` → renumber-and-append).
2. **`tests/unit/core/backlog-merger.test.ts`** — remove the `logger` mock scaffold; rewrite the **5**
   collision/de-dup tests to assert renumber-and-append (the contract names 3; 2 task-de-dup tests
   also break under the new semantics); delete the 4 vestigial `warnMock.not.toHaveBeenCalled()` lines.

**Success Definition**:
- A new-title architect Phase whose ID collides is renumbered (`renumberPhase(…, maxPhaseNumber(existingIds), …)`)
  and appended — it SURVIVES with a fresh `P{max+1}` id; the patched phase is intact.
- A new-title architect Milestone (under a title-matched phase) whose ID collides is renumbered
  (`renumberMilestone(…, existing.id, maxChildNumber(existing.id, …, 'milestone'), …)`) and appended.
- A colliding architect Task is renumbered (`renumberTask(…, existing.id, maxChildNumber(existing.id, …, 'task'), …)`)
  and appended — NEVER `continue`-dropped.
- **No architect item is ever dropped** — every item extends (title match, existing id kept) or appends
  (renumbered to a unique hierarchy-consistent id). `mergeBacklogs` is pure + synchronous (no logger).
- `mergeBacklogs({ backlog: [] }, x)` deep-equals `x` (non-delta no-op preserved — no collisions when patched is empty).
- `npm run typecheck && npm run lint && npm run format:check` clean; `backlog-merger.test.ts` green at
  100% coverage on `backlog-merger.ts`.

---

## Why

- **Fixes BUG-001 (the 001 fix's open wound).** The architect (`TASK_BREAKDOWN_PROMPT`,
  `src/agents/prompts.ts:134`) numbers IDs fresh from `P1` and sees ONLY `delta_prd.md` — never the
  patched backlog's ID space. So every ADDED-requirement item it emits (`P1`, `P1.M1`, `P1.M1.T1` …)
  collides with the patched backlog and is SKIPPED/DROPPED by `mergeBacklogs`. ADDED requirements are
  lost (now with a `warn`, but the data loss is identical to the original bug) — PRD §4.3 step 6 is
  violated and new PRD features are never implemented. This affects BOTH delta paths
  (`decomposePRD` → `prp-pipeline.ts:1345`; `integrateIntoCurrentSessionResponse` → `prp-pipeline.ts:1046`).
- **Renumber-at-the-append-point is the PRD-recommended fix** (architecture doc §"Chosen fix"). It must
  be parent-context-aware (NOT a blanket pre-pass): a blanket renumber of all architect phases to
  `maxPhase+1` would orphan folded-in milestones under a title-matched phase (milestone `P5.M1` under
  phase `P1`). S1's scoped helpers + S2's append-point calls (passing `existing.id` = immediate parent)
  are the correct design.
- **The contract mandates purity.** "mergeBacklogs stays pure + synchronous." Removing the skip-branches
  makes the `logger` dead → S2 deletes it, making the whole module pure (matching S1's pure helpers).
- **Scope discipline.** S2 is the WIRING + test correction ONLY. S1 owns the helpers; S3 owns the
  realistic-collision integration test; `prp-pipeline.ts` call sites are unchanged (they consume
  `mergeBacklogs` as-is).

---

## What

### User-visible behavior
None directly (internal merge). Indirectly, once S3 lands: when a user edits `PRD.md` to ADD a
requirement, the delta session's `tasks.json` contains the parent's tasks (modified→Planned,
removed→Obsolete) AND new tasks for the added requirement (renumbered to non-colliding ids).

### Technical requirements (exact contract)

**File — `src/core/backlog-merger.ts`** (S1's 5 helpers are present; S2 rewires the 3 loops):

**(1) `mergeMilestone` task loop** — REPLACE the `if (existingIds.has(archTask.id)) { warn; continue; }`
DROP with renumber-and-append:
```ts
for (const archTask of archMs.tasks) {
  let taskToAdd: Task;
  if (existingIds.has(archTask.id)) {
    // Architect tasks are always new added-requirement tasks — renumber rather than drop.
    taskToAdd = renumberTask(
      archTask, existing.id, maxChildNumber(existing.id, existingIds, 'task'), existingIds
    );
  } else {
    taskToAdd = archTask;
    existingIds.add(archTask.id);
    for (const s of archTask.subtasks) existingIds.add(s.id);
  }
  tasks.push(taskToAdd);
}
```

**(2) `mergePhase` milestone loop** — REPLACE the `else { warn; }` SKIP with renumber-and-append:
```ts
for (const archMs of archPhase.milestones) {
  const idx = msByTitle.get(archMs.title.trim());
  if (idx !== undefined) {
    milestones[idx] = mergeMilestone(milestones[idx], archMs, existingIds);   // extend by title
  } else {
    let msToAdd: Milestone;
    if (existingIds.has(archMs.id)) {
      msToAdd = renumberMilestone(
        archMs, existing.id, maxChildNumber(existing.id, existingIds, 'milestone'), existingIds
      );
    } else {
      msToAdd = archMs;
      existingIds.add(archMs.id);
      for (const t of archMs.tasks) { existingIds.add(t.id); for (const s of t.subtasks) existingIds.add(s.id); }
    }
    msByTitle.set(msToAdd.title.trim(), milestones.length);
    milestones.push(msToAdd);
  }
}
```

**(3) `mergeBacklogs` phase loop** — REPLACE the `else { warn; }` SKIP with renumber-and-append:
```ts
for (const archPhase of architect.backlog) {
  const idx = phaseByTitle.get(archPhase.title.trim());
  if (idx !== undefined) {
    result[idx] = mergePhase(result[idx], archPhase, existingIds);            // extend by title
  } else {
    let phaseToAdd: Phase;
    if (existingIds.has(archPhase.id)) {
      phaseToAdd = renumberPhase(archPhase, maxPhaseNumber(existingIds), existingIds);
    } else {
      phaseToAdd = archPhase;
      registerPhaseIds(archPhase, existingIds);
    }
    phaseByTitle.set(phaseToAdd.title.trim(), result.length);
    result.push(phaseToAdd);
  }
}
```

**(4) REMOVE the dead logger** (all 3 warn-branches are gone; nothing else logs):
```ts
// DELETE these three lines:
import { getLogger, type Logger } from '../utils/logger.js';
let _logger: Logger | undefined;
const logger = (): Logger => (_logger ??= getLogger('BacklogMerger'));
```
(The contract's optional "keep a final defensive warn if an id is STILL duplicated after renumber"
is INTENTIONALLY OMITTED — it is unreachable (renumber picks `max+1` → guaranteed unique) and an
unreachable branch fails the 100% coverage gate. The renumber helpers' construction IS the uniqueness
guarantee; a code comment documents this invariant.)

**(5) JSDoc corrections** (Mode A): correct every stale "skip/warn/de-dup" description:
- Module header `@remarks`: replace the "**Defensive ID-collision skips** … Every skip is LOGGED"
  paragraph with a "**Renumber-on-collision** … a new-title Phase/Milestone whose ID collides (the
  architect numbers fresh from `P1`) is renumbered to a fresh hierarchy-consistent ID and appended —
  never skipped. No architect item is ever dropped" paragraph.
- `mergeMilestone` `@remarks`: "Tasks … are RENUMBERED on ID collision (the architect decomposes
  ONLY added requirements, so every task is genuinely new) and appended — never dropped."
- `mergePhase` `@remarks`: "a new-title milestone whose ID collides is renumbered and appended."
- `mergeBacklogs` `@remarks`: "Any architect item whose ID already exists is RENUMBERED to a fresh
  hierarchy-consistent ID and appended." Remove the "SKIPPED with a warn" / "silent drop" language.

### Success Criteria
- [ ] All 3 loops renumber-and-append on collision (no `continue`/skip).
- [ ] No architect item is ever dropped (extend or renumber-append).
- [ ] `logger` import + lazy-init DELETED; module is pure (no logger calls anywhere).
- [ ] JSDoc corrected (module header + mergeMilestone/mergePhase/mergeBacklogs @remarks).
- [ ] `mergeBacklogs({ backlog: [] }, x)` still deep-equals `x`.
- [ ] `npm run typecheck && npm run lint && npm run format:check` clean.
- [ ] `backlog-merger.test.ts` green at 100% coverage on `backlog-merger.ts`.

---

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed to implement
this successfully?_ **Yes** — S1's exact helper signatures, the 3 rewire points (current code →
target code), the purity/logger-removal rationale, the 5-test ripple (with the cascade trace for
the tricky task-collision case), the immediate-parent call-site correctness, and the executable
validation commands are all below.

### Documentation & References

```yaml
# MUST READ — chosen fix + why renumber-at-append (not a blanket pre-pass)
- docfile: plan/008_15504f60a0ef/bugfix/002_86589b7d57d2/architecture/bug-001-backlog-merge.md
  section: "Chosen fix: renumber-on-collision-and-append" → "Design (inline, parent-context-aware)"
  why: Gives the 3 append-point changes this PRP implements + why a blanket pre-pass is wrong.
  critical: renumber-at-the-append-point with existing.id (immediate parent); the realistic
        integration test is S3 (NOT S2).

# MUST READ — S1's helper contracts (the inputs S2 wires) + wiring design + 5-test ripple
- docfile: plan/008_15504f60a0ef/bugfix/002_86589b7d57d2/P1M1T1S1/PRP.md
  section: "Technical requirements (exact contract)" → the 5 helper signatures
  why: S2 calls these helpers; the signatures + the `reserved` accumulator + dep-rewrite rule are
        the contract S2 depends on. S1 is the authoritative source for the helper behavior.
- docfile: plan/008_15504f60a0ef/bugfix/002_86589b7d57d2/P1M1T1S2/research/renumber-wiring-design.md
  section: "2. The three rewire points" and "3. THE purity decision" and "4. TEST RIPPLE"
  why: Current→target code for each loop; why the logger MUST be deleted; the 5 (not 3) tests that
        change, with the cascade trace for the task-collision case.

# PATTERN FILE 1 — the only source file edited (current state verified)
- file: src/core/backlog-merger.ts
  why: The 3 loops to rewire (mergeMilestone ~L100, mergePhase ~L140, mergeBacklogs ~L210) + the
        logger lines to delete (top of file). S1's 5 helpers are appended here (assume present).
  pattern: "if (existingIds.has(archX.id)) { renumberX(...) } else { register + push as-is }"
  gotcha: After S2, NOTHING calls logger() — delete the import + lazy-init or no-unused-vars fails.

# PATTERN FILE 2 — the test file (5 rewrites + scaffold removal)
- file: tests/unit/core/backlog-merger.test.ts
  why: The 5 collision/de-dup tests to rewrite (see Task 2) + the logger mock scaffold to remove
        (vi.mock logger.js + warnMock + beforeEach mockClear) + the 4 `warnMock.not.toHaveBeenCalled()`
        lines to delete. Reuse the existing fixture builders (makeSubtask/makeTask/makeMilestone/makePhase + CS).
  gotcha: S1 APPENDS helper tests to this same file (they don't use warnMock) — they stay green when
        S2 removes the mock. Do NOT touch S1's helper tests.

# READ-ONLY context
- file: src/core/models.ts
  why: Phase/Milestone/Task/Subtask shapes + ID regexes. ONLY Subtask has `dependencies`. renumber*
        (S1) preserves all non-id fields + rewrites in-scope deps; S2 just calls them.
- file: src/workflows/prp-pipeline.ts   # lines 1046, 1345 — consume mergeBacklogs UNCHANGED
  why: Confirms S2 needs NO pipeline edit — the call sites pass (patched, architect) and save the
        result; they don't inspect merge semantics.
```

### Current Codebase tree (relevant slice)

```bash
src/core/backlog-merger.ts            # EDIT — rewire 3 loops + delete logger + correct JSDoc
tests/unit/core/backlog-merger.test.ts # EDIT — remove logger mock; rewrite 5 tests; drop 4 warn lines
# S1's helpers + helper tests already in the same two files (assume landed; S2 does not modify them).
src/workflows/prp-pipeline.ts         # READ-ONLY (1046, 1345 — consume mergeBacklogs unchanged)
src/core/models.ts                    # READ-ONLY (type/regex reference)
```

### Desired Codebase tree with files to be added/edited

```bash
src/core/backlog-merger.ts            # MODIFIED (rewire + logger removal + JSDoc)
tests/unit/core/backlog-merger.test.ts # MODIFIED (mock removal + 5 rewrites + 4 line deletions)
# No new files. No docs files (Mode A: JSDoc is the doc). No pipeline edits.
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — S2 is the WIRING ONLY. Do NOT modify S1's 5 helpers or their tests. Do NOT add the
//   realistic-collision integration test (S3). Do NOT edit prp-pipeline.ts (call sites unchanged).

// CRITICAL — DELETE the logger import + lazy-init. After the rewire, NOTHING in backlog-merger.ts
//   calls logger(). @typescript-eslint/no-unused-vars (no blanket ignore; only ^_) FAILS on the
//   unused import + _logger + logger. Deleting them makes the module fully pure (contract: "pure +
//   synchronous") and matches S1's pure-helpers rule.

// CRITICAL — the de-dup→renumber change ripples to 5 tests, NOT 3. The contract names the 3
//   collision-skip tests, but 2 task-de-dup tests also assert dedup/warn behavior and MUST be rewritten
//   (see Task 2). Leaving them red breaks the gate.

// CRITICAL — renumber call sites pass existing.id = the IMMEDIATE parent (phase→milestone level,
//   milestone→task level), matching S1's hierarchy-correct maxChildNumber. For phase-level there is no
//   parent → use maxPhaseNumber(existingIds) for a fresh P{max+1}.

// GOTCHA — omit the contract's optional "defensive warn if id STILL duplicated after renumber." It is
//   UNREACHABLE (renumber picks max+1 → unique by construction) and an unreachable branch fails the
//   100% coverage gate. Add a code comment documenting the invariant instead.

// GOTCHA — sequential collisions are safe: maxPhaseNumber/maxChildNumber are recomputed per iteration
//   AND renumber* registers each new id into existingIds, so a second colliding item sees the first's
//   registered id and picks the next number. No renumbered id collides with another.

// GOTCHA — the renumber* helpers preserve title/status/description/story_points/context_scope/
//   prd_selectors and rewrite in-scope subtask deps (S1 contract). S2 does NOT re-implement any of
//   that — it just calls the helpers.

// GOTCHA — prettier is ERROR-enforced (prettier/prettier: error). Run `npm run fix` before format:check.

// GOTCHA — 100% coverage is enforced. The rewired branches (collision-renumber vs no-collision-append
//   at each of the 3 levels) must each be hit — the 5 rewritten tests + the unchanged extend/append
//   tests cover them. No dead branches remain (the warn branches are DELETED, not left unreachable).

// GOTCHA — do NOT run the full `npm run test:run` as the gate. 178 pre-existing failures (bugfix
//   Issue 3) are P1.M4 scope. S2's gate: typecheck + lint + format + backlog-merger.test.ts.
```

---

## Implementation Blueprint

### Data models and structure
None — S2 consumes S1's helpers + the existing `Backlog`/`Phase`/`Milestone`/`Task` types. No new
types. The only structural change is the control-flow of the 3 loops + the logger deletion.

### Implementation Tasks (ordered by dependencies — implicit TDD: RED first, then GREEN)

```yaml
Task 1: EDIT tests/unit/core/backlog-merger.test.ts — rewrite the 5 collision/dedup tests (RED)
  - REMOVE the logger mock scaffold: the `vi.mock('../../../src/utils/logger.js', ...)` block, the
        `warnMock` const, and `beforeEach(() => { warnMock.mockClear(); })`. (After S2 the source is
        pure — no logger. S1's helper tests don't use warnMock, so they stay green.)
  - DELETE the 4 vestigial `expect(warnMock).not.toHaveBeenCalled();` lines (in new-phase-append ×1,
        new-milestone-append ×1, empty-no-ops ×2).
  - REWRITE the 5 collision/dedup tests to assert RENUMBER-AND-APPEND (TDD: write these first, watch
        them fail against the still-skipping source, then implement Task 2 to turn them green):
      1. PHASE (contract #1): patched [P1 'Alpha']; architect [P1 'Beta'] (new title, colliding id).
         → merged has TWO phases: patched 'Alpha'@P1 intact + architect 'Beta' renumbered to P2.
         Assert result.backlog.map(id) includes 'P2'; the 'Beta' phase is present with id 'P2'; patched
         'Alpha'@P1 unchanged.
      2. MILESTONE (contract #2): patched P1 'F' with M1 'Old'; architect P1 'F' (title match → mergePhase)
         with M1 'Fresh' (new title, colliding id P1.M1). → merged P1 has TWO milestones: patched 'Old'@P1.M1
         + architect 'Fresh' renumbered to P1.M2. Assert milestones.map includes P1.M2; 'Fresh' present.
      3. TASK (contract #3): patched P1.M1.T1 (Obsolete); architect P1.M1.T1 'T-dup' (colliding). → merged
         P1.M1 has TWO tasks: patched T1 Obsolete (base, intact) + architect task renumbered to P1.M1.T2.
         Assert tasks.map(id) === ['P1.M1.T1','P1.M1.T2']; T1 status Obsolete; T2 title 'T-dup' (architect
         content survived).
      4. TASK-MIX (was "appends a new architect task while de-duping a colliding one"): patched T1;
         architect T1 (collides) + T2 (fresh id P1.M1.T2). → BOTH architect tasks survive: T1 renumbers to
         P1.M1.T2 (maxChildNumber→2), then T2 (P1.M1.T2) NOW collides → renumbers to P1.M1.T3. Result tasks:
         [P1.M1.T1 (patched), P1.M1.T2 (renumbered arch T1), P1.M1.T3 (renumbered arch T2)]. Assert all
         three present; titles 'T1-arch'/'T2-arch' survive on the renumbered tasks; patched T1 intact.
      5. STATUS-PRESERVE (was "preserves patched modified→Planned and removed→Obsolete"): patched T1
         (Planned 'modified-task'), T2 (Obsolete 'removed-task'); architect T1, T2, T3 (all collide/cascade).
         → patched T1 Planned + T2 Obsolete preserved (base); architect T1→T3, T2→T4, T3→T5 (cascade
         renumber). Assert byId['P1.M1.T1'].status==='Planned' (patched), byId['P1.M1.T2'].status==='Obsolete'
         (patched); the three renumbered architect tasks present (titles 'arch-T1'/'arch-T2'/'added-task'
         survive). Refocus the test's INTENT on patched-status-preservation (still true) + architect survival.
  - REUSE the existing fixture builders (makeSubtask/makeTask/makeMilestone/makePhase + CS). Do NOT touch
        S1's helper-test describe block (appended by S1).
  - EXPECTED NOW (before Task 2): the 5 rewritten tests FAIL (source still skips/drops) + the removed
        logger mock leaves the file importing mergeBacklogs fine but the old warn assertions are gone. RED.

Task 2: EDIT src/core/backlog-merger.ts — rewire the 3 loops + delete logger + correct JSDoc (GREEN)
  - REWIRE mergeMilestone task loop (per "Technical requirements" (1)): replace the `continue` drop with
        the renumber-and-append if/else.
  - REWIRE mergePhase milestone loop (per (2)): replace the `else { warn }` skip with renumber-and-append.
  - REWIRE mergeBacklogs phase loop (per (3)): replace the `else { warn }` skip with renumber-and-append.
  - DELETE the logger import + lazy-init (per (4)). Add a code comment where each warn WAS, noting the
        renumber invariant (helpers pick max+1 → guaranteed unique; no defensive check needed).
  - CORRECT the JSDoc (per (5)): module header + mergeMilestone/mergePhase/mergeBacklogs @remarks —
        "Defensive ID-collision skips" / "SKIPPED with a warn" → "renumber-and-append; no item dropped."
  - DO NOT: modify S1's 5 helpers, collectIds, registerPhaseIds, or any signature. DO NOT add the
        defensive-warn branch (unreachable → coverage). DO NOT edit prp-pipeline.ts.
  - EXPECTED: the 5 rewritten tests turn GREEN; the unchanged tests stay green; 100% coverage.

Task 3: FORMAT + VERIFY
  - RUN: npm run fix (lint:fix + prettier --write) → npm run typecheck → npm run lint → npm run format:check.
  - RUN: npx vitest run tests/unit/core/backlog-merger.test.ts   # S1 helper tests + S2 rewired merge tests.
  - EXPECTED: all green; backlog-merger.ts at 100% coverage. If typecheck fails, the logger deletion
        orphaned a reference — confirm no `logger(` calls remain. If a merge branch is uncovered, add the
        matching collision case (Task 1 cases 1-5 cover all 3 levels' collision + no-collision branches).
```

### Implementation Patterns & Key Details

```ts
// ---- src/core/backlog-merger.ts: the 3 rewired loops (full code in "Technical requirements") ----
// Key shape at each level — collision → renumber-and-append; no-collision → register + push as-is:
//
//   mergeMilestone task loop:
//     if (existingIds.has(archTask.id))
//       taskToAdd = renumberTask(archTask, existing.id, maxChildNumber(existing.id, existingIds, 'task'), existingIds);
//     else { taskToAdd = archTask; existingIds.add(archTask.id); for (s of archTask.subtasks) existingIds.add(s.id); }
//     tasks.push(taskToAdd);
//
//   mergePhase milestone loop (new-title branch):
//     if (existingIds.has(archMs.id))
//       msToAdd = renumberMilestone(archMs, existing.id, maxChildNumber(existing.id, existingIds, 'milestone'), existingIds);
//     else { msToAdd = archMs; register ms+tasks+subtasks into existingIds; }
//     msByTitle.set(msToAdd.title.trim(), milestones.length); milestones.push(msToAdd);
//
//   mergeBacklogs phase loop (new-title branch):
//     if (existingIds.has(archPhase.id))
//       phaseToAdd = renumberPhase(archPhase, maxPhaseNumber(existingIds), existingIds);
//     else { phaseToAdd = archPhase; registerPhaseIds(archPhase, existingIds); }
//     phaseByTitle.set(phaseToAdd.title.trim(), result.length); result.push(phaseToAdd);
//
// DELETE (logger is dead after the rewire):
//   import { getLogger, type Logger } from '../utils/logger.js';
//   let _logger: Logger | undefined;
//   const logger = (): Logger => (_logger ??= getLogger('BacklogMerger'));

// ---- tests/unit/core/backlog-merger.test.ts: the cascade trace for task-collision (case 4) ----
// patched P1.M1: [T1]. architect P1.M1 (title match → mergeMilestone): [T1 (collides), T2 'P1.M1.T2'].
//   archTask T1 (P1.M1.T1): collides → renumberTask(..., maxChildNumber('P1.M1', …, 'task')=2) → P1.M1.T2 (register).
//   archTask T2 (P1.M1.T2): NOW collides with just-registered P1.M1.T2 → renumber → maxChildNumber=3 → P1.M1.T3.
//   result tasks: ['P1.M1.T1' (patched), 'P1.M1.T2' (renumbered arch T1), 'P1.M1.T3' (renumbered arch T2)].
it('renumbers both a colliding and a fresh architect task in the same milestone (no data loss)', () => {
  const patched: Backlog = { backlog: [makePhase('P1', { title: 'F',
    milestones: [makeMilestone('P1.M1', { title: 'M', tasks: [makeTask('P1.M1.T1', { status: 'Planned' })] })] })] };
  const architect: Backlog = { backlog: [makePhase('P1', { title: 'F',
    milestones: [makeMilestone('P1.M1', { title: 'M', tasks: [
      makeTask('P1.M1.T1', { title: 'arch-T1' }),     // collides → renumber
      makeTask('P1.M1.T2', { title: 'arch-T2' }),     // fresh id, but will collide after T1's renumber
    ] })] })] };
  const merged = mergeBacklogs(patched, architect);
  const tasks = merged.backlog[0].milestones[0].tasks;
  expect(tasks.map(t => t.id)).toEqual(['P1.M1.T1', 'P1.M1.T2', 'P1.M1.T3']);
  expect(tasks[0].status).toBe('Planned');            // patched T1 intact (base)
  const byTitle = Object.fromEntries(tasks.map(t => [t.title, t.id]));
  expect(byTitle['arch-T1']).toBe('P1.M1.T2');        // architect T1 survived, renumbered
  expect(byTitle['arch-T2']).toBe('P1.M1.T3');        // architect T2 survived, renumbered
});
```

### Integration Points

```yaml
DOWNSTREAM (S2 ENABLES these — separate subtasks, do NOT do them here):
  - P1.M1.T1.S3 (realistic integration test): architect fixture numbers from P1 with a NEW title (the
        production case the 001 fixture avoids) → asserts the ADDED 'Reporting' phase SURVIVES renumbered
        alongside the patched 'Foundation' phase. Depends on S2's renumber-and-append being in place.

NO OTHER INTEGRATION: mergeBacklogs is consumed unchanged at prp-pipeline.ts:1046 and :1345 (they pass
  (patched, architect) and save the result). The OUTPUT now contains more items (renumbered architect
  items survive), but the call sites don't inspect merge semantics, so NO pipeline edit is needed.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run fix                  # lint:fix + prettier --write (run first)
npm run typecheck            # tsc --noEmit -p tsconfig.build.json — clean
npm run lint                 # eslint . --ext .ts — clean (watch no-unused-vars on the deleted logger)
npm run format:check         # prettier --check — clean
# Expected: all clean. If lint flags getLogger/_logger/logger as unused, confirm ALL 3 logger lines
# (import + let + const) are deleted and no logger() calls remain in the rewired loops.
```

### Level 2: Unit Tests (Component Validation)

```bash
# The S2 gate — S1 helper tests + S2 rewired merge tests, all green:
npx vitest run tests/unit/core/backlog-merger.test.ts
# Coverage check on the touched source file:
npx vitest run tests/unit/core/backlog-merger.test.ts --coverage
# Expected: all green; backlog-merger.ts at 100%. If a merge branch is uncovered, add the matching
# collision case (Task 1 cases 1-5 cover collision + no-collision at all 3 levels). If a helper branch
# is uncovered, that's S1's scope — but the rewired merge call-sites exercise renumber* end-to-end.
# Do NOT run the full `npm run test:run` — 178 pre-existing failures (Issue 3) are P1.M4 scope.
```

### Level 3: Integration Testing (System Validation)

```bash
# N/A for S2 — the realistic-collision integration test is P1.M1.T1.S3. S2's job is the rewire + test
# correction. A targeted pure-function smoke proving the core invariant (NO architect item dropped):
npx tsx -e "
import { mergeBacklogs } from './src/core/backlog-merger.ts';
const CS = 'CONTRACT DEFINITION:\n1. RESEARCH NOTE: x.\n2. INPUT: x.\n3. LOGIC: x.\n4. OUTPUT: x.';
const mkPhase = (id, title, ms=[]) => ({ id, type:'Phase', title, status:'Planned', description:'d', milestones: ms });
const mkMs = (id, title, tasks=[]) => ({ id, type:'Milestone', title, status:'Planned', description:'d', tasks });
const mkT = (id, title) => ({ id, type:'Task', title, status:'Planned', description:'d',
  subtasks:[{ id:id+'.S1', type:'Subtask', title:'s', status:'Planned', story_points:1, dependencies:[], context_scope:CS, prd_selectors:[] }] });
// The EXACT production case: architect emits P1 'Reporting' (colliding id, new title) under patched P1 'Foundation'.
const patched = { backlog:[ mkPhase('P1','Foundation',[ mkMs('P1.M1','Core',[ mkT('P1.M1.T1','Existing') ]) ]) ] };
const arch    = { backlog:[ mkPhase('P1','Reporting',[ mkMs('P1.M1','Reports',[ mkT('P1.M1.T1','New') ]) ]) ] };
const m = mergeBacklogs(patched, arch);
const titles = m.backlog.map(p=>p.title);
console.log('Reporting phase present?', titles.includes('Reporting'));
console.log('Foundation phase intact?', titles.includes('Foundation'));
console.log('phase ids:', m.backlog.map(p=>p.id));
"
# Expected: Reporting phase present? true | Foundation phase intact? true | phase ids: ['P1','P2']
#   (the 'Reporting' phase was renumbered from colliding P1 → fresh P2 and APPENDED, not dropped).
```

### Level 4: Creative & Domain-Specific Validation

```bash
# No MCP/DB/HTTP surface. Domain checks (record in commit message):
#   - NO architect item is dropped (extend OR renumber-append at every level).
#   - Renumbered ids are hierarchy-consistent (P{n}.M{k}.T{j}.S{l}) and unique (max+1 per level).
#   - Sequential collisions are safe (each renumber registers its new id; the next sees it).
#   - Patched statuses preserved (patched is the base; architect items are additive).
#   - mergeBacklogs is pure (no logger/fs); mergeBacklogs({backlog:[]}, x) ≡ x (non-delta no-op).
#   - prp-pipeline.ts call sites (1046, 1345) unchanged — they consume the richer output as-is.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` clean.
- [ ] `npm run lint` clean (no unused logger).
- [ ] `npm run format:check` clean.
- [ ] `npx vitest run tests/unit/core/backlog-merger.test.ts` green at 100% coverage.

### Feature Validation
- [ ] All 3 loops renumber-and-append on collision (no `continue`/skip anywhere).
- [ ] No architect item ever dropped (extend or renumber-append).
- [ ] `logger` import + lazy-init DELETED; module pure.
- [ ] JSDoc corrected (module header + mergeMilestone/mergePhase/mergeBacklogs @remarks).
- [ ] `mergeBacklogs({ backlog: [] }, x)` still deep-equals `x`.

### Code Quality Validation
- [ ] Only `backlog-merger.ts` (rewire + logger removal + JSDoc) + the test file edited.
- [ ] S1's 5 helpers + helper tests UNCHANGED.
- [ ] Renumber call sites pass `existing.id` (immediate parent) / `maxPhaseNumber(existingIds)` (phase).
- [ ] No unreachable defensive-warn branch (renumber guarantees uniqueness; comment documents it).
- [ ] `prp-pipeline.ts` UNCHANGED.

### Documentation & Deployment
- [ ] JSDoc describes renumber-and-append (the "skip/warn" language is gone).
- [ ] Commit message notes: rewire skip→renumber-append at 3 levels; logger removed (purity); 5 tests
      corrected (3 named + 2 task-de-dup); realistic integration test = S3; call sites unchanged.

---

## Anti-Patterns to Avoid

- ❌ Don't leave any skip/`continue`/drop branch — every colliding architect item must be renumbered AND appended.
- ❌ Don't keep the `logger` — after the rewire nothing logs; the unused import fails lint. Delete it (the
      module becomes pure, as the contract requires). Don't add an unreachable "defensive warn" to keep it
      alive — that fails the 100% coverage gate.
- ❌ Don't correct only the 3 named tests — the de-dup→renumber change ripples to 5 tests (2 task-de-dup
      tests also break). Leaving them red fails the gate.
- ❌ Don't implement a blanket pre-pass renumber of all architect phases — it orphans folded-in milestones
      under title-matched phases. Renumber at the append point with `existing.id` (immediate parent).
- ❌ Don't pass the wrong parent to `maxChildNumber` — parent = IMMEDIATE parent (phase→milestone,
      milestone→task). For phase-level use `maxPhaseNumber(existingIds)`.
- ❌ Don't modify S1's 5 helpers or their tests — S2 only WIRES them.
- ❌ Don't add the realistic-collision integration test — that's S3.
- ❌ Don't edit `prp-pipeline.ts` — the call sites (1046, 1345) consume `mergeBacklogs` unchanged.
- ❌ Don't forget the cascade: an architect task whose id was fresh can collide AFTER a prior task's
      renumber registers a new id — the renumber-per-iteration + maxChildNumber-recomputed handles this;
      the test (case 4) asserts the cascade explicitly.
- ❌ Don't run the full `npm run test:run` as the gate — 178 pre-existing failures (Issue 3) are P1.M4.

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: S1's helper signatures are precisely specified (with the `reserved` accumulator + dep-rewrite
rule), and the 3 rewire points are shown as exact current→target code. The two non-obvious decisions
are fully reasoned: (1) the `logger` MUST be deleted (it's dead after the rewire; keeping it fails lint,
and the contract mandates purity) — with the test scaffold removal spelled out; (2) the contract's
optional "defensive warn" is intentionally omitted (unreachable → coverage failure) with the invariant
documented. The test ripple is enumerated exhaustively (5 tests, not 3 — the contract understates it),
including the cascade trace for the tricky sequential-collision task case. The immediate-parent
call-site correctness is reconciled with S1's hierarchy-correct `maxChildNumber`. The validation is
concrete: typecheck + lint + format + the targeted backlog-merger suite at 100% coverage, plus a pure-
function smoke reproducing the exact production scenario (architect P1 'Reporting' under patched P1
'Foundation' → renumbered to P2 and appended). Residual risks: (a) a prettier nit (auto-fixed), (b) the
cascade-rewrite test's exact expected ids needing a fixture tweak (the trace is given), and (c) coverage
of any rewired branch (the 5 cases cover all). No external/runtime unknowns.