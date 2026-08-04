# Research — P1.M1.T1.S1 (pure ID-renumbering helpers for backlog-merger.ts)

Bugfix 002 BUG-001 (CRITICAL): `mergeBacklogs` skips architect items whose IDs
collide with the patched backlog. The architect numbers fresh from P1 every
time (prompts.ts:134) and sees only `delta_prd.md`, so collisions are the normal
production case → ADDED requirements are dropped. **S1 adds the pure renumbering
helpers** that S2 will wire into the three append points (phase/milestone/task)
to turn skip-on-collision into renumber-and-append.

## 1. Existing module surface (src/core/backlog-merger.ts) — reuse, don't reinvent

Already present (PRIVATE, not exported):
- `collectIds(backlog: Backlog): Set<string>` — every id at every nesting level.
- `registerPhaseIds(phase: Phase, ids: Set<string>): void` — adds a phase's id + all descendants.
- `mergeMilestone`, `mergePhase` (private), `mergeBacklogs` (exported).

S1 ADDS five EXPORTED pure helpers. It does NOT touch `mergeBacklogs`/`mergePhase`/
`mergeMilestone` (S2 rewires those) and does NOT change existing tests (S2/S3 correct
the 3 "skip-on-collision" tests). S1 is purely ADDITIVE.

Logger: `getLogger('BacklogMerger')` is already imported (lazy `logger()`). The new
helpers MUST NOT log (contract: "no logger side-effects" — pure data transforms).

## 2. Model field shapes (src/core/models.ts) — what to preserve verbatim

```
Phase     { id, type:'Phase', title, status, description, milestones: Milestone[] }
Milestone { id, type:'Milestone', title, status, description, tasks: Task[] }
Task      { id, type:'Task', title, status, description, subtasks: Subtask[] }
Subtask   { id, type:'Subtask', title, status, story_points, dependencies: string[],
            context_scope, prd_selectors: string[] }
```
- ONLY Subtask has `dependencies`. → dependency rewriting happens only at the subtask level.
- ID regexes (from the Zod schemas): Phase `^P\d+$`, Milestone `^P\d+\.M\d+$`,
  Task `^P\d+\.M\d+\.T\d+$`, Subtask `^P\d+\.M\d+\.T\d+\.S\d+$`.
- Preserve every non-id field verbatim. `dependencies` is the ONE field that is conditionally
  REWRITTEN (entries referencing a remapped sibling id → new id; entries referencing ids
  OUTSIDE the renumbered scope → left verbatim, because those targets aren't moving).

## 3. The five helpers — exact contracts

### `maxPhaseNumber(reserved: Set<string>): number`
Scan ids matching `^P(\d+)(?:\.M|$)` → return max capture + 1 (or 1 if none). The
`(?:\.M|$)` tail lets it infer a phase number from a bare `P3` OR from `P3.M1`/`P3.M1.T2`
(so it's robust even if the bare phase id isn't directly reserved but its children are).

### `maxChildNumber(parentId: string, reserved: Set<string>, level: 'milestone'|'task'|'subtask'): number`
**parent = IMMEDIATE parent** (hierarchy-correct; matches the S2 append-point calls in
architecture/bug-001-backlog-merge.md §Design, which pass `existing.id` = the immediate
parent — phase for milestone-level, milestone for task-level, task for subtask-level):
- level `'milestone'`: parentId = phase id (e.g. `'P1'`) → `^P1\.M(\d+)` → max M-num + 1.
- level `'task'`:     parentId = milestone id (e.g. `'P1.M1'`) → `^P1\.M1\.T(\d+)` → max T-num + 1.
- level `'subtask'`:  parentId = task id (e.g. `'P1.M1.T1'`) → `^P1\.M1\.T1\.S(\d+)$` → max S-num + 1.
ESCAPE `parentId` before embedding (dots are regex-special). NOTE: the work-item prose
example "parentId 'P1', level 'task'" is loose/illustrative; the hierarchy-correct design
anchors on the immediate parent (the milestone id), which is what S2's `mergeMilestone`
call site passes. Confirmed against the architecture doc's append-point pseudocode.

### `renumberPhase(phase, phaseNum, reserved): Phase`
Deep-clone with `id = 'P' + phaseNum`. Build a FULL old→new id map for the entire phase
subtree (the phase + every descendant). Remap ALL descendant ids sequentially:
milestones `P{phaseNum}.M{1..k}`, tasks `…M{k}.T{1..j}`, subtasks `…T{j}.S{1..l}`
(1-based, in INPUT ORDER — preserves the architect's relative structure). Register every
new id into `reserved`. Rewrite every subtask's `dependencies` entries that appear in the
old→new map (siblings inside the folded phase) to their new ids; leave external deps verbatim.
Preserve all other fields verbatim.

### `renumberMilestone(ms, parentPhaseId, msNum, reserved): Milestone`
`id = '${parentPhaseId}.M${msNum}'`. Build old→new map for THIS milestone's subtree
(ms + its tasks + subtasks). Tasks → `…M{msNum}.T{1..j}`, subtasks → `…T{j}.S{1..l}`.
Register; rewrite in-scope subtask deps. Preserve other fields.

### `renumberTask(task, parentMilestoneId, taskNum, reserved): Task`
`id = '${parentMilestoneId}.T${taskNum}'`. Build old→new map for THIS task's subtree
(task + its subtasks). Subtasks → `…T{taskNum}.S{1..l}`. Register; rewrite in-scope subtask
deps. Preserve other fields.

### Composition note
`renumberPhase` MAY delegate milestone renumbering to `renumberMilestone` (and so on down)
to avoid duplicating the descendant logic — BUT each helper must build the old→new map for
its OWN full scope so cross-task/cross-milestone dependencies WITHIN that scope are rewritten
correctly. Simplest robust implementation: each helper first walks its subtree assigning new
ids into a local `Map<oldId,newId>`, then deep-clones with ids + deps remapped via that map,
then registers all new ids into `reserved`.

## 4. Purity / side-effects

- Pure data transforms: NO I/O, NO logger calls.
- The ONE intentional mutation is appending to the passed-in `reserved: Set<string>`
  (accumulator pattern — the contract explicitly says "register ids into reserved").
  Document this in JSDoc ("mutates `reserved` by registering the new ids").
- Inputs are treated as read-only; results are FRESH objects (deep clone via spread +
  re-creation of nested arrays). Never mutate the input phase/milestone/task/subtask.

## 5. Identity / no-regression guarantee

S1 only ADDS exports + tests. `mergeBacklogs` is unchanged, so:
- `mergeBacklogs({ backlog: [] }, x)` still deep-equals `x` (no collisions when patched is
  empty → no renumbering ever triggers — S2's wiring preserves this).
- The 3 existing "skip-on-collision" tests still pass UNCHANGED in S1 (S2/S3 correct them).
S1's tests assert the HELPERS behave correctly in isolation; they do NOT assert merge behavior.

## 6. Test strategy — plain Backlog literals, NO mocks

Mirror the fixture-builder style already in `tests/unit/core/backlog-merger.test.ts`
(`makeSubtask`/`CS` constant etc.). Pure data-in/data-out — no tmpdir, no fs, no logger mock
needed for the helper tests (the helpers don't log). Cases per helper:
- `maxPhaseNumber`: empty set → 1; `{P1}` → 2; `{P1, P3}` → 4; `{P2.M1}` (no bare phase) → 3
  (infers from the milestone); `{P1.M1.T2.S1}` → 2 (infers phase 1).
- `maxChildNumber`: milestone/task/subtask at each level; empty → 1; infers from descendants.
- `renumberPhase`: input phase `P1` w/ P1.M1.T1.S1 → renumber to phaseNum=5 → ids become
  P5, P5.M1, P5.M1.T1, P5.M1.T1.S1; all registered in reserved; title/status/description/
  story_points/context_scope/prd_selectors preserved verbatim; a subtask dependency on a
  remapped sibling → rewritten; a dependency on an external id → left verbatim.
- `renumberMilestone` / `renumberTask`: scoped renumber + registration + dep rewrite.
- Deep nesting (multiple milestones/tasks/subtasks) → sequential 1..k numbering in input order.
- Collision-free guarantee: after renumber, none of the new ids are in the reserved set AS IT
  WAS BEFORE the call (the helpers register them, but the produced ids must be unique vs the
  pre-existing reserved contents — assert no overlap with a snapshot of reserved taken before).

## 7. Validation

- `npm run typecheck` (tsc --noEmit -p tsconfig.build.json) — clean.
- `npm run lint && npm run format:check` — clean (prettier is ERROR-enforced; run `npm run fix`).
- `npx vitest run tests/unit/core/backlog-merger.test.ts` — green (NEW helper tests added;
  existing merge tests UNCHANGED and still pass). Touched lines at 100% coverage (vitest
  enforces 100% on src/**/*.ts; the new helpers' branches — empty/non-empty reserved, each
  level, dep-in-map vs dep-outside — must all be exercised).
- Do NOT run the full `npm run test:run` — 178 pre-existing failures (bugfix Issue 3) are
  P1.M4's scope, unrelated to this additive change.