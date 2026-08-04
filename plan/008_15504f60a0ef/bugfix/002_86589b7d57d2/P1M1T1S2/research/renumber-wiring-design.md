# Research — P1.M1.T1.S2 (wire renumbering into mergeBacklogs/mergePhase/mergeMilestone)

S2 replaces the three **skip-on-collision** branches with **renumber-and-append** using S1's pure
helpers. This is the BUG-001 corrective fix: the architect numbers fresh from `P1` every run, so
every ADDED-requirement item collides with the patched backlog and is currently DROPPED. After S2,
NO architect item is ever dropped.

## 1. S1's helper signatures (the inputs S2 consumes — assume landed per parallel contract)

S1 appends these EXPORTED pure helpers to `src/core/backlog-merger.ts` (no logger, no fs; only the
`reserved` accumulator mutates):

```ts
maxPhaseNumber(reserved: Set<string>): number                              // max ^P(\d+) + 1 (or 1)
maxChildNumber(parentId: string, reserved: Set<string>, level: 'milestone'|'task'|'subtask'): number
renumberPhase(phase: Phase, phaseNum: number, reserved: Set<string>): Phase
renumberMilestone(ms: Milestone, parentPhaseId: string, msNum: number, reserved: Set<string>): Milestone
renumberTask(task: Task, parentMilestoneId: string, taskNum: number, reserved: Set<string>): Task
```

Each `renumber*` produces a FRESH deep-cloned subtree with hierarchy-consistent sequential ids
(P{n}.M{k}.T{j}.S{l}), registers every new id into `reserved`, preserves all non-id fields, and
rewrites in-scope subtask `dependencies`. `maxChildNumber` anchors on the IMMEDIATE parent
(phase→milestone, milestone→task, task→subtask) — S2's call sites pass `existing.id` (the
immediate parent), which matches S1's hierarchy-correct design.

## 2. The three rewire points (verified current code → S2 target)

### (A) mergeMilestone task loop — `backlog-merger.ts` ~L100-115 (the DROP)
CURRENT (drops colliding tasks):
```ts
for (const archTask of archMs.tasks) {
  if (existingIds.has(archTask.id)) {
    logger().warn({ itemId: archTask.id, level: 'task' }, 'merge de-dup skip: ...');
    continue;                          // ← DROP (always wrong: architect tasks are all new added-reqs)
  }
  existingIds.add(archTask.id);
  for (const s of archTask.subtasks) existingIds.add(s.id);
  tasks.push(archTask);
}
```
S2 TARGET (renumber-and-append):
```ts
for (const archTask of archMs.tasks) {
  let taskToAdd: Task;
  if (existingIds.has(archTask.id)) {
    taskToAdd = renumberTask(archTask, existing.id, maxChildNumber(existing.id, existingIds, 'task'), existingIds);
  } else {
    taskToAdd = archTask;
    existingIds.add(archTask.id);
    for (const s of archTask.subtasks) existingIds.add(s.id);
  }
  tasks.push(taskToAdd);               // ← ALWAYS appended (renumbered if collision)
}
```
(`existing` = the milestone — `existing.id` is the immediate parent for task-level renumber.)

### (B) mergePhase milestone loop — `backlog-merger.ts` ~L140-160 (the SKIP)
CURRENT: new-title milestone whose id collides → `else { logger().warn(... 'milestone' ...); }` (skip).
S2 TARGET:
```ts
} else {
  let msToAdd: Milestone;
  if (existingIds.has(archMs.id)) {
    msToAdd = renumberMilestone(archMs, existing.id, maxChildNumber(existing.id, existingIds, 'milestone'), existingIds);
  } else {
    msToAdd = archMs;
    existingIds.add(archMs.id);
    for (const t of archMs.tasks) { existingIds.add(t.id); for (const s of t.subtasks) existingIds.add(s.id); }
  }
  msByTitle.set(msToAdd.title.trim(), milestones.length);
  milestones.push(msToAdd);
}
```
(`existing` = the phase — `existing.id` is the immediate parent for milestone-level renumber.)

### (C) mergeBacklogs phase loop — `backlog-merger.ts` ~L210-220 (the SKIP)
CURRENT: new-title phase whose id collides → `else { logger().warn(... 'phase' ...); }` (skip).
S2 TARGET:
```ts
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
```

## 3. THE purity decision — REMOVE the logger entirely (contract: "mergeBacklogs stays pure + synchronous")

All three `logger().warn(...)` skip-branches are REMOVED by S2. After the rewire, NOTHING in
`backlog-merger.ts` calls `logger()`. The remaining logger references are dead:
```ts
import { getLogger, type Logger } from '../utils/logger.js';   // ← becomes unused
let _logger: Logger | undefined;                                // ← unused
const logger = (): Logger => (_logger ??= getLogger('BacklogMerger'));  // ← unused
```
`@typescript-eslint/no-unused-vars` (no blanket ignore; only `^_`) FAILS the build on unused
imports/vars. **S2 MUST delete these three lines.** This makes the ENTIRE module pure (merge +
helpers, no side effects) — which is exactly what the contract demands ("mergeBacklogs stays pure +
synchronous") and matches S1's "helpers are pure (no logger)" rule. The contract's optional
"keep a final defensive warn only if an id is STILL duplicated after renumber" is INTENTIONALLY
OMITTED: it would be unreachable (renumber picks `max+1` → guaranteed unique) and an unreachable
branch fails the 100% coverage gate. The renumber helpers' construction IS the uniqueness guarantee.

## 4. TEST RIPPLE — 5 tests change, NOT 3 (the contract names 3; 2 more break)

The de-dup→renumber semantic change ripples beyond the 3 collision-skip tests. Enumerated against
the CURRENT `tests/unit/core/backlog-merger.test.ts`:

| # | Test | Why it breaks under S2 | Action |
|---|------|------------------------|--------|
| 1 | "skips an architect phase whose id collides (despite a new title) and warns" | contract #1 — skip→renumber | REWRITE: phase SURVIVES renumbered |
| 2 | "skips an architect milestone whose id collides (despite a new title) and warns" | contract #2 — skip→renumber | REWRITE: milestone SURVIVES renumbered |
| 3 | "de-duplicates a task whose id already exists (keeps patched status, warns)" | contract #3 — drop→renumber | REWRITE: task SURVIVES renumbered (patched also kept) |
| 4 | "appends a new architect task while de-duping a colliding one in the same milestone" | asserts `warnMock.toHaveBeenCalledTimes(1)` + dedup ids — now BOTH architect tasks survive renumbered | REWRITE: assert both survive, remapped ids, 0 warns |
| 5 | "preserves patched modified→Planned and removed→Obsolete statuses through the merge" | asserts `warnMock.toHaveBeenCalledTimes(2)` (T1,T2 dedup) + `byId['P1.M1.T3'].title==='added-task'` — under renumber, T1/T2 renumber+append, T3 collides with renumbered T1 → cascade | REWRITE: patched statuses still preserved (base), architect tasks survive renumbered, 0 warns |

ALSO: every test with `expect(warnMock).not.toHaveBeenCalled()` (4 tests) loses that assertion
(logger removed), and the module-level `vi.mock('../../../src/utils/logger.js', ...)` +
`warnMock` + `beforeEach(mockClear)` are REMOVED (vestigial once the source is pure). The 4
"not called" assertions are simply deleted (they asserted an absence that's now structural).

**Net:** the whole file is edited — remove the logger mock scaffold; rewrite the 5 collision/dedup
tests; delete the 4 "not called" lines. The UNCHANGED tests (new-phase-append ×2, extend-by-title ×3,
empty-no-ops ×2) keep their core assertions (only lose the optional `warnMock` line if present).

## 5. Renumber call-site correctness (immediate parent — matches S1)

S1's `maxChildNumber` anchors on the IMMEDIATE parent. S2's call sites pass `existing.id` = the
immediate parent at each level:
- task level: `mergeMilestone(existing: Milestone, …)` → `existing.id` is the milestone → `maxChildNumber(existing.id, …, 'task')` scans `^${milestone}\.T(\d+)`. ✓
- milestone level: `mergePhase(existing: Phase, …)` → `existing.id` is the phase → `maxChildNumber(existing.id, …, 'milestone')` scans `^${phase}\.M(\d+)`. ✓
- phase level: `renumberPhase(archPhase, maxPhaseNumber(existingIds), …)` → fresh `P{max+1}`. ✓

Sequential-collision safety: when TWO architect phases both collide (e.g. both id 'P1'),
`maxPhaseNumber(existingIds)` is recomputed per iteration AND `renumberPhase` registers the new id
into `existingIds`, so the second call sees the first's registered id and picks the next number.
Same for milestones/tasks. → No renumbered id ever collides with another renumbered id.

## 6. Coverage map (vitest enforces 100% on src/**/*.ts)

Every branch of the rewired merge functions must be hit:
- mergeBacklogs phase loop: title-match (extend) | no-collision-append | collision-renumber.
- mergePhase milestone loop: title-match (extend) | no-collision-append | collision-renumber.
- mergeMilestone task loop: no-collision-append | collision-renumber.
The 5 rewritten tests + the unchanged extend/append tests cover all these branches. No unreachable
branches remain (the logger/warn branches are deleted, not left dead).

## 7. Scope containment — S2 edits ONLY backlog-merger.ts + its test

- `src/core/backlog-merger.ts` — rewire 3 loops + remove logger + correct JSDoc (module header,
  mergeMilestone/mergePhase/mergeBacklogs @remarks).
- `tests/unit/core/backlog-merger.test.ts` — remove logger mock scaffold; rewrite 5 tests; delete
  4 vestigial "not called" lines.
- `prp-pipeline.ts:1046,1345` — UNCHANGED (consume mergeBacklogs as-is; output now has more items).
- S1's helpers + helper tests — UNCHANGED (S2 wires them; doesn't modify them).
- S3's realistic-collision integration test — NOT S2 (separate subtask).

## 8. Validation commands (verified executable)

- `npm run typecheck` / `npm run lint` / `npm run format:check` (prettier ERROR-enforced; `npm run fix`).
- `npx vitest run tests/unit/core/backlog-merger.test.ts` (S1 helper tests + S2 rewired merge tests).
- Do NOT run full `npm run test:run` — 178 pre-existing failures (bugfix Issue 3, P1.M4 scope).