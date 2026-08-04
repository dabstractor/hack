# PRP — P1.M1.T1.S1: Add pure ID-renumbering helpers to `backlog-merger.ts`

> Bugfix 002, **BUG-001 (CRITICAL)** of
> `plan/008_15504f60a0ef/bugfix/002_86589b7d57d2/TEST_RESULTS.md`.
> `mergeBacklogs` skips architect items whose IDs collide with the patched backlog; the
> architect numbers fresh from `P1` every run, so ADDED requirements collide and are dropped.
> **S1 adds the pure renumbering helpers** that S2 will wire into the three append points to
> turn skip-on-collision into renumber-and-append.

---

## Goal

**Feature Goal**: Add five EXPORTED pure helper functions to `src/core/backlog-merger.ts` that
compute the next available ID number at each hierarchy level and deep-renumber an architect
Phase/Milestone/Task subtree against a target parent prefix — producing collision-free,
hierarchy-consistent IDs while preserving every non-ID field and rewriting in-scope
dependencies. These are the primitives S2 wires into `mergeBacklogs`/`mergePhase`/`mergeMilestone`.

**Deliverable**:
1. **`src/core/backlog-merger.ts`** — append five exported pure helpers:
   `maxPhaseNumber`, `maxChildNumber`, `renumberPhase`, `renumberMilestone`, `renumberTask`.
2. **`tests/unit/core/backlog-merger.test.ts`** — append unit tests for each helper (plain
   `Backlog` literals, no mocks).

**Success Definition**:
- Each helper produces hierarchy-consistent, collision-free IDs (e.g. `renumberPhase(p, 5, …)`
  yields `P5`, `P5.M1`, `P5.M1.T1`, `P5.M1.T1.S1` …) and registers every new ID into `reserved`.
- Every non-ID field (`title`, `status`, `description`, `story_points`, `context_scope`,
  `prd_selectors`, `type`) is preserved verbatim.
- Subtask `dependencies` entries that reference a remapped in-scope sibling ID are rewritten to
  the new ID; entries referencing IDs outside the renumbered scope are left verbatim.
- Helpers are pure (no I/O, no logger calls); only the passed-in `reserved: Set<string>` is
  mutated (accumulator pattern).
- `mergeBacklogs({ backlog: [] }, x)` is unaffected (these helpers are ADDITIVE — `mergeBacklogs`
  is not touched in S1; S2 does the wiring).
- `npm run typecheck && npm run lint && npm run format:check` clean; new tests pass; the existing
  `backlog-merger.test.ts` cases (incl. the 3 skip-on-collision tests) remain green UNCHANGED.

---

## Why

- **Unblocks the BUG-001 fix.** The architect (`TASK_BREAKDOWN_PROMPT`, `src/agents/prompts.ts:134`)
  numbers IDs fresh from `P1` and sees only `delta_prd.md` — never the existing ID space. So every
  ADDED-requirement item it emits (`P1`, `P1.M1`, `P1.M1.T1` …) collides with the patched backlog
  and is SKIPPED by `mergeBacklogs` (phase skip `backlog-merger.ts:217`; milestone `:153`; task
  `:113`). ADDED requirements are silently dropped — defeating PRD §4.3 step 6. Renumbering the
  architect's colliding items into fresh, hierarchy-consistent IDs (the PRD's recommended fix) is
  the cure, and these helpers are the primitives that make it possible.
- **Renumbering must be parent-context-aware (NOT a blanket pre-pass).** A pre-pass that renumbers
  ALL architect phases to `maxPhase+1` is WRONG for title-matched (extend) phases: the extended
  result keeps the existing patched phase ID (e.g. `P1`), but folded-in milestones would carry the
  renumbered prefix (`P5.M1` under phase `P1`) → a semantically broken hierarchy (architecture
  doc §"Why NOT a blanket pre-pass renumber"). So renumbering must happen at the append point using
  the correct parent context — which is exactly what these scoped helpers enable.
- **Scope discipline.** S1 ships ONLY the pure helpers + their tests. S2 wires them into the three
  append points (replacing skip → renumber-append) and corrects the 3 stale "skip-on-collision"
  tests. S3 adds the realistic-collision integration test. Doing the wiring or test correction in
  S1 would collide with S2/S3.

---

## What

### User-visible behavior
None (internal helpers; no user/config/API surface change — Mode A = module JSDoc only).

### Technical requirements (exact contract)

**File:** `src/core/backlog-merger.ts` (append; reuse the existing `logger()` import — do NOT call
it from these helpers). Inputs are the existing types from `./models.js` (`Phase`, `Milestone`,
`Task`, `Backlog` already imported).

**(1) `maxPhaseNumber(reserved: Set<string>): number`**
- Scan every id in `reserved` matching `/^P(\d+)(?:\.M|$)/`; return `max(capture) + 1`, or `1` if none.
- The `(?:\.M|$)` tail lets it infer a phase number from a bare `P3` OR from `P3.M1`/`P3.M1.T2.S1`.

**(2) `maxChildNumber(parentId: string, reserved: Set<string>, level: 'milestone'|'task'|'subtask'): number`**
- `parentId` is the **immediate parent** for the level (hierarchy-correct; matches S2's append-point
  calls, which pass `existing.id` — the phase for milestone-level, milestone for task-level, task
  for subtask-level). ESCAPE `parentId` (dots are regex-special) before embedding.
- `level 'milestone'`: parentId = phase → `/^${esc}\.M(\d+)/` → max M-num + 1.
- `level 'task'`:     parentId = milestone → `/^${esc}\.T(\d+)/` → max T-num + 1.
- `level 'subtask'`:  parentId = task → `/^${esc}\.S(\d+)$/` → max S-num + 1.
- Return `1` when no match. (The work-item's prose "parentId 'P1', level 'task'" is loose; the
  hierarchy-correct design anchors on the immediate parent — confirmed against the architecture
  doc's append-point pseudocode. See research note §3.)

**(3) `renumberPhase(phase: Phase, phaseNum: number, reserved: Set<string>): Phase`**
- Produce a FRESH deep-cloned `Phase` with `id = 'P' + phaseNum`. Build a full old→new id map for
  the ENTIRE phase subtree (phase + all descendants). Remap descendant ids sequentially in INPUT
  order: milestones `P{phaseNum}.M{1..k}`, tasks `…M{k}.T{1..j}`, subtasks `…T{j}.S{1..l}`.
- Register every new id into `reserved`.
- Rewrite every subtask's `dependencies` entries found in the old→new map → new id; leave
  external entries verbatim.
- Preserve all other fields verbatim.

**(4) `renumberMilestone(ms: Milestone, parentPhaseId: string, msNum: number, reserved: Set<string>): Milestone`**
- `id = '${parentPhaseId}.M${msNum}'`. Scope = this milestone's subtree. Tasks `…M{msNum}.T{1..j}`,
  subtasks `…T{j}.S{1..l}`. Build scoped old→new map; register; rewrite in-scope subtask deps;
  preserve other fields.

**(5) `renumberTask(task: Task, parentMilestoneId: string, taskNum: number, reserved: Set<string>): Task`**
- `id = '${parentMilestoneId}.T${taskNum}'`. Scope = this task's subtree. Subtasks `…T{taskNum}.S{1..l}`.
  Build scoped old→new map; register; rewrite in-scope subtask deps; preserve other fields.

**Purity:** no I/O, no `logger()` calls; inputs read-only; results are fresh objects; the ONLY
mutation is appending to `reserved` (document in JSDoc).

**JSDoc (Mode A):** add `@param`/`@returns`/`@remarks` on each helper; note the `reserved`
accumulator mutation and the dependency-rewrite rule.

### Success Criteria
- [ ] Five exported helpers present with the signatures above.
- [ ] `maxPhaseNumber` / `maxChildNumber` return the correct next number (incl. inferring from
      descendant ids and returning `1` on empty).
- [ ] `renumberPhase`/`renumberMilestone`/`renumberTask` produce hierarchy-consistent sequential
      ids and register them all into `reserved`.
- [ ] Non-id fields preserved verbatim; subtask `dependencies` rewritten for in-scope refs and
      left verbatim for external refs.
- [ ] Helpers are pure (no logger, no fs); only `reserved` is mutated.
- [ ] New unit tests added; existing `backlog-merger.test.ts` cases (incl. 3 skip-on-collision)
      remain green UNCHANGED.
- [ ] `npm run typecheck && npm run lint && npm run format:check` clean; new helper lines at 100% coverage.

---

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed to implement
this successfully?_ **Yes** — the exact field shapes (with the interfaces), the ID regexes, the
helper contracts (with worked id examples), the purity rules, the dep-rewrite rule, the existing
module surface to reuse, the existing test's fixture-builder style to mirror, and the executable
validation commands are all specified with file:line references.

### Documentation & References

```yaml
# MUST READ — chosen fix + why a blanket pre-pass is wrong
- docfile: plan/008_15504f60a0ef/bugfix/002_86589b7d57d2/architecture/bug-001-backlog-merge.md
  section: "Chosen fix: renumber-on-collision-and-append" → "Design (inline, parent-context-aware)"
  why: Gives the helper signatures this PRP implements and the S2 append-point calls they must
        support (passing existing.id = immediate parent). Also explains why renumbering must be
        scoped to the append point, not a blanket pre-pass.
  critical: S1 ONLY adds the helpers. The 3 append-point rewires (skip→renumber-append) are S2;
        correcting the 3 stale skip-tests + the realistic integration test are S2/S3.

# MUST READ — helper contracts + purity + test strategy (authored with this PRP)
- docfile: plan/008_15504f60a0ef/bugfix/002_86589b7d57d2/P1M1T1S1/research/renumber-helpers-design.md
  section: "3. The five helpers — exact contracts" and "6. Test strategy"
  why: Reconciles the work-item's loose maxChildNumber example with the hierarchy-correct
        immediate-parent design, and gives per-helper test cases.

# PATTERN FILE 1 — the only source file edited
- file: src/core/backlog-merger.ts
  why: Append the 5 helpers here. Reuse the existing type imports (Backlog/Phase/Milestone/Task from
        ./models.js) and the lazy logger() — but DO NOT call logger() from the new helpers (pure).
        Existing private helpers collectIds/registerPhaseIds stay private; the 5 new ones are EXPORTED.
  pattern: "function collectIds(backlog): Set<string>  /  function registerPhaseIds(phase, ids): void"
  gotcha: The merger lazily inits _logger via getLogger('BacklogMerger'); the new helpers must not
        touch it (contract: no logger side-effects). Pure = no I/O, no logging; only `reserved` mutates.

# PATTERN FILE 2 — model field shapes + ID regexes
- file: src/core/models.ts
  why: Phase {id,type:'Phase',title,status,description,milestones}; Milestone {…,tasks};
        Task {…,subtasks}; Subtask {id,type:'Subtask',title,status,story_points,dependencies[],
        context_scope,prd_selectors[]}. ID regexes: Phase ^P\d+$, Milestone ^P\d+\.M\d+$,
        Task ^P\d+\.M\d+\.T\d+$, Subtask ^P\d+\.M\d+\.T\d+\.S\d+$. ONLY Subtask has `dependencies`.
  pattern: "readonly id: string; readonly type: 'Phase'; … ; readonly milestones: Milestone[]"
  gotcha: Preserve ALL fields via spread; only id is replaced and dependencies is conditionally rewritten.

# PATTERN FILE 3 — test fixture style to mirror
- file: tests/unit/core/backlog-merger.test.ts
  why: Copy the existing builders (makeSubtask/makeTask/makeMilestone/makePhase + the `CS` context_scope
        constant) for the new helper tests. The existing file ALREADY mocks the logger for the merge
        skip-branch assertions — the NEW helper tests need NO logger mock (helpers don't log), but
        appending to the same file inherits the existing mock (harmless).
  pattern: "const CS = 'CONTRACT DEFINITION:\n1. RESEARCH NOTE: x.…'; function makeSubtask(id, opts) {…}"
  gotcha: Do NOT modify the 3 existing skip-on-collision tests in S1 (they're S2/S3 to correct). Only ADD.
```

### Current Codebase tree (relevant slice)

```bash
src/core/backlog-merger.ts            # EDIT — append 5 exported pure helpers + JSDoc
tests/unit/core/backlog-merger.test.ts # EDIT — append helper unit tests (existing cases unchanged)
src/core/models.ts                    # READ-ONLY (type/regex reference — not modified)
```

### Desired Codebase tree with files to be added/edited

```bash
src/core/backlog-merger.ts            # MODIFIED (append-only: 5 new exports + JSDoc)
tests/unit/core/backlog-merger.test.ts # MODIFIED (append-only: new helper tests; existing tests untouched)
# No new files. No docs files (Mode A: module JSDoc is the doc). mergeBacklogs UNCHANGED (S2 rewires it).
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — S1 is ADDITIVE ONLY. Do NOT modify mergeBacklogs/mergePhase/mergeMilestone (S2 rewires
//   them). Do NOT correct the 3 "skip-on-collision" tests (S2/S3). Do NOT add the realistic-collision
//   integration test (S3). Only ADD the 5 helpers + their unit tests.

// CRITICAL — renumbering must be PARENT-CONTEXT-AWARE, not a blanket pre-pass. renumberPhase is called
//   with a FRESH phaseNum (from maxPhaseNumber) → P{phaseNum}.* are all brand-new (no collision).
//   renumberMilestone/renumberTask are called with an EXISTING parent id + a fresh child num (from
//   maxChildNumber) → the new child id is unique under that parent. (Blanket-renumbering all phases
//   to maxPhase+1 would orphan folded-in milestones under a title-matched phase — see architecture doc.)

// CRITICAL — maxChildNumber parent = IMMEDIATE parent (phase→milestone level, milestone→task level,
//   task→subtask level). The work-item prose "parentId 'P1', level 'task'" is loose; S2's actual call
//   sites pass existing.id = the immediate parent. Anchor the regex on the escaped parentId prefix.

// GOTCHA — ESCAPE parentId before embedding in the regex (dots are regex-special). Use
//   parentId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').

// GOTCHA — ONLY Subtask has `dependencies`. Dependency rewriting happens only at the subtask level.
//   Build the old→new map for the helper's FULL scope (so cross-task/cross-milestone deps WITHIN the
//   renumbered scope are rewritten); deps to ids OUTSIDE the scope are left verbatim (those targets
//   aren't moving).

// GOTCHA — preserve input order when sequentially numbering descendants (M1..k, T1..j, S1..l). This
//   preserves the architect's relative structure; only the id prefix/numbers change.

// GOTCHA — purity: no logger(), no fs. Inputs read-only; results are FRESH (spread + re-create nested
//   arrays). The ONLY mutation is appending to `reserved` (accumulator) — document it in JSDoc.

// GOTCHA — vitest.config.ts enforces 100% coverage on src/**/*.ts. Every branch of the 5 helpers must
//   be hit: empty vs non-empty reserved; each of the 3 levels in maxChildNumber; dep-in-map vs
//   dep-outside; deep nesting (multiple milestones/tasks/subtasks).

// GOTCHA — prettier is ERROR-enforced. Run `npm run fix` before format:check.

// GOTCHA — do NOT run the full `npm run test:run` as the S1 gate. 178 pre-existing failures (bugfix
//   Issue 3) are P1.M4 scope. S1's gate is typecheck + lint + format + the targeted backlog-merger.test.ts.
```

---

## Implementation Blueprint

### Data models and structure

```ts
// Reuse existing imports in backlog-merger.ts: Backlog, Phase, Milestone, Task from './models.js'.
// No new types needed — the helpers operate on the existing model interfaces.
// The only "structure" is the old→new id Map<string,string> built transiently inside each renumber helper.
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT src/core/backlog-merger.ts — add the 5 exported pure helpers
  - APPEND (after the existing ID-helpers section, before/after mergeBacklogs — keep mergeBacklogs intact):
      maxPhaseNumber, maxChildNumber, renumberPhase, renumberMilestone, renumberTask.
  - SIGNATURES: see "Technical requirements" above. EXPORT all five.
  - maxPhaseNumber/maxChildNumber: iterate `reserved`, regex-match, track max capture, return max+1 or 1.
  - renumberTask: build local Map<oldId,newId> for {task.id→newTaskId, each subtask.id→newSubtaskId};
      deep-clone task (spread), set id, re-create subtasks with remapped ids + rewritten deps
      (deps mapped via the local map; unmapped deps verbatim); register all new ids into `reserved`.
  - renumberMilestone: scope = ms subtree; renumber tasks via renumberTask (compose) OR inline;
      build full-scope old→new map for dep rewrite; register; preserve fields.
  - renumberPhase: scope = phase subtree; compose via renumberMilestone OR inline; full-scope map; register.
  - PURITY: no logger(), no fs. Only `reserved` mutates. Inputs read-only; fresh results.
  - JSDoc: each helper (@param/@returns/@remarks; note reserved mutation + dep-rewrite rule).
  - DO NOT: touch mergeBacklogs/mergePhase/mergeMilestone, call logger(), or modify existing exports.

Task 2: EDIT tests/unit/core/backlog-merger.test.ts — append helper unit tests
  - REUSE the existing fixture builders (makeSubtask/makeTask/makeMilestone/makePhase + CS constant).
  - IMPORT the 5 new helpers from '../../../src/core/backlog-merger.js'.
  - ADD a new describe('renumber helpers') block with cases:
      * maxPhaseNumber: empty→1; {P1}→2; {P1,P3}→4; {P2.M1}→3 (infers); {P1.M1.T2.S1}→2 (infers phase 1).
      * maxChildNumber: milestone/task/subtask levels; immediate-parent anchoring; empty→1; infers from
        deeper descendants (e.g. maxChildNumber('P1.M1', {'P1.M1.T2.S5'}, 'task') → 3).
      * renumberPhase: P1 subtree (P1.M1.T1.S1 + a second milestone) renumbered to phaseNum=5 → ids
        P5/P5.M1/P5.M1.T1/P5.M1.T1.S1/P5.M2/…; all registered in reserved; title/status/description/
        story_points/context_scope/prd_selectors preserved verbatim; a subtask dep on a remapped
        sibling → rewritten; a dep on an external id ('P9.M9.T9.S9') → left verbatim.
      * renumberMilestone / renumberTask: scoped renumber + registration + dep rewrite (mirrors above).
      * Collision-free: snapshot reserved before the call; assert none of the produced new ids were in
        that snapshot (the helpers register them, but they must be unique vs the pre-existing set).
      * Deep nesting: multiple milestones/tasks/subtasks → sequential 1..k in input order.
  - DO NOT modify the 3 existing skip-on-collision tests (S2/S3 own them). Only APPEND.
  - NAMING: it('maxPhaseNumber returns 1 for an empty reserved set'), etc.
  - PLACEMENT: append at end of the existing file (or a new describe block).

Task 3: FORMAT + VERIFY
  - RUN: npm run fix (lint:fix + prettier --write) → npm run typecheck → npm run lint → npm run format:check.
  - RUN: npx vitest run tests/unit/core/backlog-merger.test.ts   # NEW helper tests + existing merge tests green.
  - EXPECTED: all clean. If coverage <100% on backlog-merger.ts, a helper branch is unhit — add the case.
```

### Implementation Patterns & Key Details

```ts
// PATTERN — the two number-computing helpers (escape parentId; iterate the small reserved set).
export function maxPhaseNumber(reserved: Set<string>): number {
  let max = 0;
  for (const id of reserved) {
    const m = /^P(\d+)(?:\.M|$)/.exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

export function maxChildNumber(
  parentId: string,
  reserved: Set<string>,
  level: 'milestone' | 'task' | 'subtask'
): number {
  const esc = parentId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re =
    level === 'milestone' ? new RegExp(`^${esc}\\.M(\\d+)`)
    : level === 'task'    ? new RegExp(`^${esc}\\.T(\\d+)`)
                          : new RegExp(`^${esc}\\.S(\\d+)$`);
  let max = 0;
  for (const id of reserved) {
    const m = re.exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

// PATTERN — renumberTask (scoped old→new map; preserve fields; rewrite in-scope deps; register).
export function renumberTask(
  task: Task,
  parentMilestoneId: string,
  taskNum: number,
  reserved: Set<string>
): Task {
  const newTaskId = `${parentMilestoneId}.T${taskNum}`;
  const idMap = new Map<string, string>();           // oldId → newId (this task's subtree)
  idMap.set(task.id, newTaskId);
  const subtasks = task.subtasks.map((s, i) => {
    const newSubId = `${newTaskId}.S${i + 1}`;
    idMap.set(s.id, newSubId);
    return { ...s, id: newSubId };
  });
  // Now rewrite deps using the fully-populated idMap (so cross-subtask deps within the task resolve).
  const remappedSubtasks = subtasks.map((s) => ({
    ...s,
    dependencies: s.dependencies.map((d) => idMap.get(d) ?? d),   // in-scope → new id; else verbatim
  }));
  reserved.add(newTaskId);
  for (const s of remappedSubtasks) reserved.add(s.id);
  return { ...task, id: newTaskId, subtasks: remappedSubtasks };  // preserves type/title/status/description
}

// PATTERN — renumberMilestone/renumberPhase compose the same way (build scope's idMap, renumber
//   descendants sequentially in input order, rewrite subtask deps across the WHOLE scope, register all).
//   They may delegate the per-child remapping to renumberTask (compose) as long as the cross-scope
//   dep map covers the whole renumbered subtree.
```

### Integration Points

```yaml
DOWNSTREAM (S1 ENABLES these — separate subtasks, do NOT do them here):
  - P1.M1.T1.S2 (wire renumbering): replaces the 3 skip-on-collision branches in mergeBacklogs/
        mergePhase/mergeMilestone with renumber-and-append using these helpers:
        - phase collision → renumberPhase(archPhase, maxPhaseNumber(existingIds), existingIds)
        - milestone collision → renumberMilestone(archMs, existing.id, maxChildNumber(existing.id, existingIds,'milestone'), existingIds)
        - task collision → renumberTask(archTask, existing.id, maxChildNumber(existing.id, existingIds,'task'), existingIds)
        S2 also CORRECTS the 3 stale skip-on-collision unit tests to assert renumber-and-append.
  - P1.M1.T1.S3 (realistic integration test): architect fixture numbers from P1 with a NEW title
        (the production case the current fixture avoids) → asserts ADDED requirement survives.

NO OTHER INTEGRATION in S1: the helpers are pure data transforms with no callers yet. mergeBacklogs
  is unchanged; its existing tests (incl. the 3 skip-on-collision) stay green.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run fix                  # lint:fix + prettier --write (run first)
npm run typecheck            # tsc --noEmit -p tsconfig.build.json — clean
npm run lint                 # eslint . --ext .ts — clean
npm run format:check         # prettier --check — clean
# Expected: all clean. If no-unused-vars flags a helper param, ensure every param is used (reserved is
# mutated; the others are read). If typecheck fails on the regex new RegExp(...) widening, type the capture.
```

### Level 2: Unit Tests (Component Validation)

```bash
# The S1 gate — the backlog-merger suite (NEW helper tests + existing merge tests, all green):
npx vitest run tests/unit/core/backlog-merger.test.ts
# Coverage check on the touched source file:
npx vitest run tests/unit/core/backlog-merger.test.ts --coverage
# Expected: all green; backlog-merger.ts at 100% on the new helper lines. If a branch is uncovered
# (e.g. dep-outside-map, empty reserved, a maxChildNumber level), add the matching case from Task 2.
# Do NOT run the full `npm run test:run` — 178 pre-existing failures (bugfix Issue 3) are P1.M4 scope.
```

### Level 3: Integration Testing (System Validation)

```bash
# N/A for S1 — the helpers are pure primitives with no callers yet (S2 wires them). A targeted
# pure-function smoke that proves the core invariant (collision-free, hierarchy-consistent):
npx tsx -e "
import { renumberPhase, maxPhaseNumber } from './src/core/backlog-merger.ts';
const phase = { id:'P1', type:'Phase', title:'Reporting', status:'Planned', description:'d',
  milestones:[{ id:'P1.M1', type:'Milestone', title:'Reports', status:'Planned', description:'d',
    tasks:[{ id:'P1.M1.T1', type:'Task', title:'Build', status:'Planned', description:'d',
      subtasks:[{ id:'P1.M1.T1.S1', type:'Subtask', title:'S1', status:'Planned', story_points:1,
        dependencies:[], context_scope:'CONTRACT DEFINITION:\n1. X', prd_selectors:[] }] }] }] } as any;
const reserved = new Set(['P1','P1.M1','P1.M1.T1','P1.M1.T1.S1']);
const n = maxPhaseNumber(reserved);
const r = renumberPhase(phase, n, reserved);
console.log('new phase id:', r.id, '| first milestone:', r.milestones[0].id, '| first task:', r.milestones[0].tasks[0].id);
console.log('title preserved:', r.title === 'Reporting');
"
# Expected: new phase id: P2 | first milestone: P2.M1 | first task: P2.M1.T1 | title preserved: true.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# N/A — pure data transforms with no creative surface. Domain checks (record in commit message):
#   - Produced ids are hierarchy-consistent (P{n}.M{k}.T{j}.S{l}) and sequential in input order.
#   - No produced id collides with the pre-existing reserved set (collision-free guarantee).
#   - Non-id fields preserved verbatim; subtask deps rewritten for in-scope refs, verbatim for external.
#   - Helpers are pure (no logger/fs); only `reserved` mutates.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` clean.
- [ ] `npm run lint` clean.
- [ ] `npm run format:check` clean.
- [ ] `npx vitest run tests/unit/core/backlog-merger.test.ts` green (new helper tests + existing merge tests).
- [ ] `backlog-merger.ts` at 100% coverage on the new helper lines.

### Feature Validation
- [ ] Five exported helpers with the exact signatures/contracts.
- [ ] `maxPhaseNumber`/`maxChildNumber` return correct next numbers (infer from descendants; 1 on empty).
- [ ] `renumberPhase`/`renumberMilestone`/`renumberTask` produce hierarchy-consistent sequential ids; register all.
- [ ] Non-id fields preserved verbatim; subtask `dependencies` rewritten in-scope, verbatim external.
- [ ] Helpers pure (no logger/fs); only `reserved` mutated.

### Code Quality Validation
- [ ] Only `src/core/backlog-merger.ts` (append 5 exports + JSDoc) and the test file (append tests) modified.
- [ ] `mergeBacklogs`/`mergePhase`/`mergeMilestone` UNCHANGED (S2 rewires them).
- [ ] Existing tests (incl. 3 skip-on-collision) UNCHANGED and still green (S2/S3 correct them).
- [ ] Reuses existing type imports + fixture builders; no reinvention.
- [ ] parentId is regex-escaped in `maxChildNumber`; parent = immediate parent (hierarchy-correct).

### Documentation & Deployment
- [ ] JSDoc on each helper (@param/@returns/@remarks; reserved mutation + dep-rewrite rule noted).
- [ ] Commit message notes: pure additive helpers; wiring = S2; realistic integration test = S3;
      maxChildNumber parent = immediate parent (reconciling the work-item's loose example).

---

## Anti-Patterns to Avoid

- ❌ Don't wire the helpers into `mergeBacklogs`/`mergePhase`/`mergeMilestone` — that's S2.
- ❌ Don't correct the 3 existing skip-on-collision tests or add the realistic integration test — S2/S3.
- ❌ Don't implement a blanket pre-pass renumber of all architect phases — it orphans folded-in milestones under title-matched phases. Renumber at the append point with the correct parent context (S2's job, using these scoped helpers).
- ❌ Don't call `logger()` from the helpers — they must be pure (no logger side-effects).
- ❌ Don't mutate the input phase/milestone/task/subtask — produce fresh deep clones.
- ❌ Don't anchor `maxChildNumber` on the wrong parent — parent = IMMEDIATE parent (phase→milestone, milestone→task, task→subtask), matching S2's call sites.
- ❌ Don't forget to regex-escape `parentId` in `maxChildNumber` (dots are regex-special).
- ❌ Don't rewrite dependencies that point outside the renumbered scope — leave them verbatim (those targets aren't moving).
- ❌ Don't change the id numbering order — preserve INPUT ORDER (M1..k, T1..j, S1..l) so the architect's relative structure is retained.
- ❌ Don't run the full `npm run test:run` as the S1 gate — 178 pre-existing failures (Issue 3) are P1.M4 scope.

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: The five helpers are PURE data transforms with precisely specified contracts, worked
ID examples, the exact model field shapes (only Subtask has `dependencies`), and a clean composition
(renumberPhase → renumberMilestone → renumberTask). The hierarchy-correct immediate-parent design
for `maxChildNumber` is reconciled against both the work-item prose and the architecture doc's S2
append-point pseudocode (which passes `existing.id`). The test strategy mirrors the file's existing
fixture builders and covers every branch (empty/non-empty reserved, each level, dep-in-map vs
dep-outside, deep nesting, collision-free). The single residual risk is the work-item's loose
`maxChildNumber` example ("parentId 'P1', level 'task'") — explicitly reconciled in the PRP to the
immediate-parent design so the implementer doesn't build the wrong anchor. The validation is concrete:
typecheck + lint + format + the targeted backlog-merger suite at 100% coverage. No external/runtime unknowns.