# Research — `normalizeTaskId` + `findItemByLooseId` (loose task-ID matching)

Findings anchoring P1.M2.T1.S1 (PRD §5.4 "Loose task-ID matching"). All line
numbers verified against the working tree.

## 1. The two functions are pure additions to `src/utils/task-utils.ts`

The file (557 lines) already exports `findItem` (~90, exact-id DFS match),
`isSubtask`, `getDependencies`, `getAllSubtasks`, `updateItemStatus`,
`filterByStatus`, `getNextPendingItem`, and the `HierarchyItem` union type (47).
**S1 adds two NEW exports; it does NOT modify `findItem`** (contract: "Do NOT
modify findItem"). All building blocks (`Backlog`, `Phase`, `Milestone`, `Task`,
`Subtask` types) are already imported (lines 20-26).

`HierarchyItem = Phase | Milestone | Task | Subtask` (47). Each level carries a
readonly `id: string` (models.ts: Phase.id@650, Milestone.id@548, Task.id@444,
Subtask.id@280) and the children fields confirmed by `findItem`'s traversal:
`backlog.backlog` (Phase[]@768), `phase.milestones` (Milestone[]@677),
`milestone.tasks` (Task[]@575), `task.subtasks` (Subtask[]@472). Subtask has NO
children (leaf).

## 2. `normalizeTaskId(looseId: string): number[] | null` — the algorithm

Architecture §F2.A + the item contract pin it verbatim:
```ts
export function normalizeTaskId(looseId: string): number[] | null {
  const nums = looseId.match(/\d+/g);   // extract ALL digit sequences
  if (!nums) return null;                // no digits (incl. empty/whitespace) → null
  if (nums.length > 4) return null;      // max Phase.Milestone.Task.Subtask
  return nums.map(Number);
}
```
- `String.prototype.match(/\d+/g)` returns `null` when there are NO matches, or a
  **non-empty** array of matches. It NEVER returns `[]`. So `if (!nums)` covers
  both "no digits" and "empty/whitespace" (the contract's "If null or empty →
  return null"). **Do NOT add a separate `nums.length === 0` check** — it is dead
  code (unreachable) and can trip lint/coverage.
- `nums.map(Number)`: `Number('1')` → `1`. Verified.
- Verified examples (all from the contract):
  - `'P1.M1.T1.S1'` → `['1','1','1','1']` → `[1,1,1,1]`
  - `'p1m1t1s1'` → `[1,1,1,1]`
  - `'1.1.1.1'` → `[1,1,1,1]`
  - `'1.2'` → `[1,2]`
  - `'1'` → `[1]`
  - `''` / `'  '` / `'foo'` → `null`
  - `'1.2.3.4.5'` → `null` (>4)
- `'0'` → `[0]` (valid per the algorithm — normalizeTaskId is purely syntactic;
  the 0 is rejected LATER by findItemByLooseId's 1-based positional lookup:
  `backlog[0-1]` = `backlog[-1]` = `undefined` → null). Do NOT reject 0 in
  normalizeTaskId (deviates from the contract; the regex+cap-at-4 IS the spec).

## 3. `findItemByLooseId(backlog, looseId): { item; canonicalId } | null` — positional 1-based walk

Cleanest TS-safe form (early-return per level, no casts, each index null-checked):
```ts
export function findItemByLooseId(
  backlog: Backlog,
  looseId: string
): { item: HierarchyItem; canonicalId: string } | null {
  const segments = normalizeTaskId(looseId);
  if (!segments) return null;

  const phase = backlog.backlog[segments[0] - 1];        // 1-based → 0-based
  if (!phase) return null;
  if (segments.length === 1) return { item: phase, canonicalId: phase.id };

  const milestone = phase.milestones[segments[1] - 1];
  if (!milestone) return null;
  if (segments.length === 2) return { item: milestone, canonicalId: milestone.id };

  const task = milestone.tasks[segments[2] - 1];
  if (!task) return null;
  if (segments.length === 3) return { item: task, canonicalId: task.id };

  const subtask = task.subtasks[segments[3] - 1];
  if (!subtask) return null;
  return { item: subtask, canonicalId: subtask.id };
}
```
- `canonicalId` is the found item's ACTUAL `.id` field (e.g. `'P1.M1.T1.S1'`), NOT
  reconstructed from segments. Read straight off the item.
- Trailing-segment omission = the `segments.length === N` early returns (1→phase,
  2→milestone, 3→task, 4→subtask). "Trailing segments may be omitted" = fewer
  segments ⇒ higher-level item.
- Out-of-bounds at any level (the `if (!x) return null` guards) ⇒ null. This also
  handles `'0'` segments (idx -1 ⇒ undefined ⇒ null) and unknown ids like `'9.9.9.9'`.
- Each level is independently null-checked; the return type narrows correctly
  (Phase/Milestone/Task/Subtask all satisfy `HierarchyItem`). **No `as` casts needed.**

## 4. The test fixture to reuse — `createComplexBacklog()` (test lines ~92-170)

`tests/unit/core/task-utils.test.ts` (NOTE: test lives in `tests/unit/core/`, NOT
`tests/unit/utils/` — source is `src/utils/task-utils.ts`; import path is
`'../../../src/utils/task-utils.js'`). The module-scope `createComplexBacklog()`
builds a verified 2-phase tree:
```
P1 (phase1)
├─ P1.M1 (milestone1, status Complete)
│  ├─ P1.M1.T1 (task1, Planned) → [P1.M1.T1.S1 (Complete), P1.M1.T1.S2 (Planned), P1.M1.T1.S3 (Planned)]
│  └─ P1.M1.T2 (task2, Planned) → [P1.M1.T2.S1 (Researching)]
└─ P1.M2 (milestone2, Implementing)
   └─ P1.M2.T1 (task3, Implementing) → [P1.M2.T1.S1 (Implementing)]
P2 (phase2)
└─ P2.M1 (milestone3, Planned)
   └─ P2.M1.T1 (task4, Planned) → [P2.M1.T1.S1 (Planned)]
```
So the 1-based positional map is:
- `[1]` → P1 · `[2]` → P2
- `[1,1]` → P1.M1 · `[1,2]` → P1.M2 · `[2,1]` → P2.M1
- `[1,1,1]` → P1.M1.T1 · `[1,1,2]` → P1.M1.T2 · `[1,2,1]` → P1.M2.T1 · `[2,1,1]` → P2.M1.T1
- `[1,1,1,1]` → P1.M1.T1.S1 · `[1,1,1,3]` → P1.M1.T1.S3 · `[1,1,2,1]` → P1.M1.T2.S1 ·
  `[1,2,1,1]` → P1.M2.T1.S1 · `[2,1,1,1]` → P2.M1.T1.S1
- Out-of-bounds: `[1,3]` (P1 has 2 milestones) → null · `[9,9,9,9]` → null · `[3]` → null

➡️ Reuse `createComplexBacklog()` for ALL findItemByLooseId tests (no new fixture
needed). For normalizeTaskId (pure string→number[]), no fixture needed.

`createTestSubtask` (test ~30) builds a Subtask WITHOUT `prd_selectors` — that's
fine (findItemByLooseId reads only `.id`/children; tests are excluded from
`tsc.build`, and esbuild strips types). Do NOT add `prd_selectors` to the fixture
(out of scope; the existing tests don't have it).

## 5. Test import + assertion conventions (mirror the existing `findItem` describe)

- Named import from `'../../../src/utils/task-utils.js'` — ADD `normalizeTaskId,
  findItemByLooseId` to the existing import block (test lines 12-20).
- Assertion style (from the findItem describe, ~215-296): `expect(result).not.toBeNull()`;
  `expect(result?.id).toBe('P1.M1.T1.S1')`; `expect(result?.type).toBe('Subtask')`;
  `expect(result).toBeNull()` for not-found. Mirror this for findItemByLooseId
  (`result.item.id`, `result.canonicalId`, `result.item.type`).
- APPEND new `describe` blocks INSIDE the top-level `describe('utils/task-utils', …)`
  (test ~172). Do NOT modify the existing `findItem`/`isSubtask` describes.

## 6. Coverage (task-utils.ts in src/ ⇒ 100% globally enforced)

Branches to exercise for 100%:
- `normalizeTaskId`: (a) no-digits → null; (b) >4 segments → null; (c) valid → number[].
- `findItemByLooseId`: (a) invalid looseId (normalize→null) → null; (b) phase
  out-of-bounds → null; (c) milestone out-of-bounds → null; (d) task out-of-bounds →
  null; (e) subtask out-of-bounds → null; (f) the 4 success returns (phase/milestone/
  task/subtask). Each `if (!x) return null` + each `segments.length === N` return is a
  branch. The createComplexBacklog fixture + the out-of-bounds cases cover all of them.

## 7. Scope boundaries + consumers

- **S1 = `src/utils/task-utils.ts` (2 new exports + JSDoc) + `tests/unit/core/task-utils.test.ts`
  (new describe blocks).** Nothing else.
- **Do NOT modify `findItem`** (contract). The new matcher is separate.
- **Consumed by P1.M2.T4.S1** (the `hack update` CLI handler in `src/cli/index.ts`),
  which calls `findItemByLooseId` to resolve the `<task-id>` arg + uses `canonicalId`
  for the `Updated <ID> …` output. S1 provides the resolver; T4 wires it.
- **Sibling P1.M2 subtasks add OTHER functions to the SAME file** (T2.S1 `matchStatus`;
  T3.S1/T3.S2 cascade helpers). They are SEQUENCED after S1 (the plan orders T1→T2→T3→T4),
  so S1's additive exports are merge-safe (each lands before the next; no overlap with
  normalizeTaskId/findItemByLooseId). S1 only APPENDS; it doesn't edit existing functions.
- **File-disjoint from the parallel P1.M1.T4.S1** (`src/utils/git-commit.ts` — commit
  style wiring). Zero overlap, no merge conflict.
- DOCS: Mode A — JSDoc on the 2 functions (algorithm + 1-based mapping + trailing-
  segment omission + canonicalId + @example showing all equivalent forms).

## 8. Validation

- `npm run typecheck` (tsc -p tsconfig.build.json, src/) — clean. The early-return
  form typechecks with no casts.
- `npm run lint && npm run format:check` — clean.
- `npx vitest run tests/unit/core/task-utils.test.ts` — GREEN (new describes + all
  existing findItem/isSubtask/etc. tests untouched).
- `npx vitest run tests/unit/core/task-utils.test.ts --coverage` — task-utils.ts 100%.
- Do NOT run the full `npm run test:run` as the gate (orthogonal pre-existing failures
  are not S1's concern). Gate = typecheck + lint + format:check + the targeted suite.