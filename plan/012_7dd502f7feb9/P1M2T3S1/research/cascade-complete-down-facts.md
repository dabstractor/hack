# Research — P1.M2.T3.S1: `cascadeCompleteDown` helper

> Load-bearing facts for a small, surgical, additive function in
> `src/utils/task-utils.ts`. Captured 2026-08-06 by direct inspection of the
> hacky-hack repo (delta session 012).

## 1. The target file & exact insertion points

`src/utils/task-utils.ts` (638 lines). Relevant landmarks (verified by reading):

| Line | Symbol | Role |
| ---- | ------ | ---- |
| 47   | `export type HierarchyItem = Phase \| Milestone \| Task \| Subtask;` | THE input/return type |
| 63   | `isSubtask(item)` | uses `item.type === 'Subtask'` narrowing |
| ~394 | `function promoteIfAllComplete(...)` | **PRIVATE, monotonic — DO NOT TOUCH** |
| ~424 | `function rollupCompletion(backlog)` | **PRIVATE, monotonic — DO NOT TOUCH** |
| 461  | `export function updateItemStatus(...)` | the structural-sharing status mutator |
| ~498 | end of `updateItemStatus` (`return updated; }`) | **INSERT cascadeCompleteDown AFTER this** |
| ~585 | `export type AnyItem` + `setItemStatus` | uses `'milestones' in item` narrowing |

**Placement decision (merge-safe).** The parallel sibling P1.M2.T2.S1 (`matchStatus`)
inserts its function "near `updateItemStatus` (~line 380)" — i.e. ~100 lines ABOVE
my insertion point. The earlier P1.M2.T1.S1 (`normalizeTaskId`/`findItemByLooseId`)
landed at lines 135–193 (also above). Placing `cascadeCompleteDown` **immediately
after `updateItemStatus`'s closing brace (~line 498), before the `AnyItem` type
(~585)** is textually disjoint from both → clean merge. Bonus: it groups the new
"cascade engine" next to the status-mutation region, and leaves a natural home for
the sequenced sibling P1.M2.T3.S2 (`recomputeAncestorsUp`) to append right after it.

Anchor text for the insertion (end of `updateItemStatus`, unique in the file):
```ts
  if (newStatus === 'Complete') {
    return rollupCompletion(updated);
  }
  return updated;
}
```
Insert the new function + its JSDoc immediately after this block.

## 2. The `HierarchyItem` shape (what the recursion must mirror)

From `src/core/models.ts` (verified): each level is a discriminated union on a
**readonly literal `type`** field, and each non-leaf level carries ONE child
array with a distinct name:

| Level    | `type` discriminant | child field      | child element type |
| -------- | ------------------- | ---------------- | ------------------ |
| Phase    | `'Phase'`           | `milestones: […]`  | Milestone          |
| Milestone| `'Milestone'`       | `tasks: […]`       | Task               |
| Task     | `'Task'`            | `subtasks: […]`    | Subtask            |
| Subtask  | `'Subtask'`         | *(none — leaf)*    | —                  |

All four also share `readonly id: string` and `readonly status: Status`.
`Status` (models.ts:175) includes `'Complete'`. `Status` is **already imported**
in task-utils.ts (line 25); `HierarchyItem` is **defined locally** (line 47) →
**`cascadeCompleteDown` needs ZERO new imports.**

## 3. The narrowing idiom to use (matches codebase, lint-safe)

Two equivalent TS approaches narrow `HierarchyItem` to each level:

**(A) `in`-operator chain** — already used by `setItemStatus` (lines ~625–628):
```ts
if ('milestones' in item) item.milestones.forEach(visit);
if ('tasks' in item)      item.tasks.forEach(visit);
if ('subtasks' in item)   item.subtasks.forEach(visit);
```
After each `if (... in item) return {...}`, TS narrows `item` to that level, so
`item.milestones` / `item.tasks` / `item.subtasks` type-check. A final
`return { ...item, status: 'Complete' };` handles Subtask (the leaf). **Every
code path returns → satisfies `consistent-return` and needs no `default`/throw.**

**(B) `switch (item.type)`** — exhaustive over the 4 literal cases; TS 5.x
proves exhaustiveness. Also fine, but can trip stricter `switch-exhaustiveness`
/ `no-switch-statements` lint rules depending on config.

**Recommendation: use (A) the `in`-chain** — it is this codebase's own idiom
(`setItemStatus`), is unconditionally lint-safe, and has a guaranteed final
return. (B) is an acceptable equivalent if preferred; both produce identical
output and identical narrowing.

## 4. The do-not-touch boundary (the monotonic rollup)

`promoteIfAllComplete` (~394) and `rollupCompletion` (~424) are **module-private,
monotonic, promote-only** helpers:

- `promoteIfAllComplete(children, current)` returns `'Complete'` ONLY when ALL
  non-obsolete children are already `'Complete'`; otherwise returns `current`
  unchanged. It **short-circuits** on a parent already `'Complete'`/`'Obsolete'`
  and **never downgrades**.
- `rollupCompletion` walks the tree bottom-up and promotes each ancestor toward
  `'Complete'` when all its non-obsolete children are `'Complete'`. Idempotent;
  returns the same `Backlog` reference when nothing changes.

**`cascadeCompleteDown` is the OPPOSITE direction** — it forcibly sets EVERY node
`Complete` regardless of children, and can be called on any single item (not a
whole `Backlog`). The PRP's JSDoc must spell out this distinction explicitly
(the work item's DOCS contract requires it). **Do not modify, rename, or call
into** the two rollup helpers from `cascadeCompleteDown`; they remain untouched.

## 5. Test location & fixture style (correction of the architecture note)

- **Architecture note §F2.E says `tests/unit/utils/task-utils.test.ts` — that
  path DOES NOT EXIST.** The real file is **`tests/unit/core/task-utils.test.ts`**
  (35 KB; confirmed). Use `tests/unit/core/`.
- The test file imports from `../../../src/utils/task-utils.js` (named imports +
  `type HierarchyItem`) and types from `../../../src/core/models.js`
  (`Backlog, Phase, Milestone, Task, Subtask, Status`).
- Existing fixture builders (grep to confirm exact names): `createTestSubtask`,
  `createTestTask`, `createTestMilestone`, `createTestPhase`, `createTestBacklog`
  — each takes `(id, title, status, …children)`. Reuse these to build small trees.
- Test style: `describe('utils/task-utils', () => { describe('<fn>', () => { it('…') }) })`,
  Setup/Execute/Verify, `expect(...).toBe(...)` / `toEqual(...)`.
- **Add `cascadeCompleteDown` to the existing named import** (one additive line).
  The parallel `matchStatus` (T2.S1) and sequenced `recomputeAncestorsUp` (T3.S2)
  also touch this same import block — additive name additions; if git flags a
  conflict it is a trivial text-resolution (keep both names).

## 6. Validation commands (verified present in package.json)

```bash
npm run typecheck      # tsc --noEmit -p tsconfig.build.json
npm run lint           # eslint . --ext .ts
npm run format:check   # prettier --check "**/*.{ts,js,json,md,yml,yaml}"
npm run fix            # lint:fix + format (prettier --write)
npm run test:run       # vitest run
npm run validate       # = lint && format:check && typecheck && test:run  (the gate)
npx vitest run tests/unit/core/task-utils.test.ts   # targeted
```

## 7. Coverage is a regression FLOOR, not 100% (vitest.config.ts)

`vitest.config.ts` `coverage.thresholds` = statements 89 / branches 90 /
functions 94 / lines 89 — a **regression floor** set below actual (~90%) to catch
drops, NOT an aspirational 100% target. The test-file header *says* "100%
coverage" aspirationally, but the gate is the floor. A well-tested
`cascadeCompleteDown` (all 4 levels + immutability + idempotency + field
preservation) keeps coverage comfortably above the floor; no special gymnastics
needed. `src/**/*.ts` is the coverage `include`; tests live under `tests/**`
(excluded from measurement) → adding the function + tests does not LOWER coverage
because the new lines are immediately exercised.

## 8. Consumer contract (forward reference)

`cascadeCompleteDown` is consumed by **P1.M2.T4.S1** (the `hack update` CLI
handler). Per architecture note §F2.D, the handler composes the cascade engine as:
`clone → set target status → (if target is Complete) cascadeCompleteDown(subtree) →
recomputeAncestorsUp(backlog, id)`. So the function must (a) take a single
`HierarchyItem` (the target item already located + status-set), (b) return a NEW
item tree (immutability — the handler splices it back into the locked backlog),
and (c) be pure. It does NOT itself touch `tasks.json`, locking, or ancestors.