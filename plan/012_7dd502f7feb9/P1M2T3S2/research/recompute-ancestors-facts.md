# Research — P1.M2.T3.S2: `recomputeAncestorsUp` (bottom-up min-status recompute)

> Load-bearing facts captured by direct inspection of the hacky-hack working
> tree (session 012). This subtask ships ONE new exported pure function +
> module-private helpers + tests. It is the UPWARD half of the §5.4 cascade
> engine (sibling P1.M2.T3.S1 `cascadeCompleteDown` is the DOWNWARD half —
> already landed in the tree).

## 1. Contract (from the work item — the authoritative algorithm)

`export function recomputeAncestorsUp(backlog: Backlog, changedId: string): Backlog`

Walk UP from the changed item's position. At each ANCESTOR (Task→Milestone→Phase)
recompute its status from its (already-updated) children. The changed item's own
status was set (and optionally cascaded down) by the caller before this runs.

**Status ordering (progression):** `Planned(0) < Researching(1) < Ready(2) <
Implementing(3) < Complete(4)`. `Retrying` → treated as **Implementing(3)-
equivalent** (transitional, set by orchestrator, not a manual state).

**Per-ancestor algorithm (verbatim from the work item):**
1. Exclude `Obsolete` children (terminal, like `Complete` — not counted in progress).
2. If **ALL** children are `Obsolete` → parent = `Complete` (Obsolete loses ties to
   Complete per PRD §5.4).
3. Of remaining (non-Obsolete) children: if **ALL** are `Failed` → parent = `Failed`.
4. Else: exclude `Failed` children; parent = **min** (least-progressed) of the
   remaining non-failed, non-obsolete children's statuses (Retrying→Implementing).

**CAN DOWNGRADE:** resetting a subtask back to `Planned` drops its ancestors to
reflect the least-progressed child. This is what makes it STRICTLY RICHER than
the existing monotonic `rollupCompletion`/`promoteIfAllComplete` (which only ever
promote toward `Complete`, never downgrade).

**Immutability:** return a new `Backlog`; only copy nodes along the ancestor path
(same deep-copy-on-path / structural-sharing pattern as `updateItemStatus` and
`rollupCompletion`). Non-path nodes are shared by reference.

## 2. Model facts (src/core/models.ts — read-only; do NOT edit)

- `Status = 'Planned'|'Researching'|'Ready'|'Implementing'|'Retrying'|'Complete'|
  'Failed'|'Obsolete'` — **8 values** (line ~175). So `Record<Status, number>`
  needs all 8 keys.
- `Backlog = { readonly backlog: Phase[] }`. Phase→`milestones:Milestone[]`,
  Milestone→`tasks:Task[]`, Task→`subtasks:Subtask[]`, Subtask = leaf. All fields
  `readonly`.
- All needed types (`Backlog`, `Status`) are ALREADY imported at the top of
  `src/utils/task-utils.ts` (the `import type { Backlog, Phase, Milestone, Task,
  Subtask, Status } from '../core/models.js'` block). → **ZERO new imports.**

## 3. The immutable pattern to mirror (src/utils/task-utils.ts — read-only)

Two canonical references, BOTH module-internal:

- **`rollupCompletion(backlog): Backlog`** (~line 424): maps over
  phases→milestones→tasks, recomputes each parent via `promoteIfAllComplete`,
  threads a `mutated`/`*Changed` flag, and **returns the SAME `backlog` reference
  when nothing changed** (preserving structural sharing). This is the closest
  structural analog to `recomputeAncestorsUp` (both rebuild ancestors), EXCEPT
  rollup is whole-tree + monotonic-promote-only, while recompute is
  path-only + min(can-downgrade).
- **`updateItemStatus(backlog, id, newStatus): Backlog`** (~line 461): the
  path-only immutable rebuild. Uses a containment-check pattern
  (`phaseContainsTarget`/`milestoneContainsTarget`) then nested `.map()` with
  spread **only along the path** to the target. Non-path nodes returned by
  reference. This is the **structural-sharing idiom** the work item names.

**Do NOT modify** `promoteIfAllComplete` (~394) or `rollupCompletion` (~424) —
they are module-private, monotonic, promote-only, and load-bearing for the
orchestrator's automatic status writes (architecture §F2.C).

## 4. `promoteIfAllComplete`'s Obsolete handling — for CONTRAST only

```ts
function promoteIfAllComplete(children: { status: Status }[], current: Status): Status {
  if (current === 'Complete' || current === 'Obsolete') return current; // monotonic short-circuit
  const active = children.filter(c => c.status !== 'Obsolete');
  if (active.length === 0) return current;              // ← returns CURRENT (not Complete)
  return active.every(c => c.status === 'Complete') ? 'Complete' : current;
}
```
Contrast with `recomputeParentStatus`: when all-Obsolete → returns **`Complete`**
(not `current`), and it computes a true **min** (not an all-or-nothing promote).
The signature `children: { status: Status }[]` is the right param type for the
new helper too (Subtask[]/Task[]/Milestone[] all satisfy it).

## 5. Placement (merge-safe; sibling S1 already landed)

Current order in `src/utils/task-utils.ts` (verified): … `updateItemStatus` →
**`cascadeCompleteDown`** (sibling S1, already present) → `MATCHABLE_STATUSES`/
`STATUS_SYNONYMS` → `matchStatus` (P1.M2.T2.S1) → `AnyItem` → `setItemStatus`.

**Insert `recomputeAncestorsUp`** (plus its module-private helpers
`recomputeParentStatus`, `locateChange`, and the `PROGRESSION`/`STATUS_RANK`
consts) **immediately after `cascadeCompleteDown`** — keeping the two cascade-
engine halves together, and textually disjoint from `matchStatus` (~100 lines
below) → clean, merge-safe. (The sibling S1 PRP explicitly reserved this spot:
"recomputeAncestorsUp will be added immediately AFTER cascadeCompleteDown.")

## 6. Test path + fixtures + import block (tests/unit/core/task-utils.test.ts)

The architecture note §F2.E names the WRONG path (`tests/unit/utils/` does not
exist). The real file is **`tests/unit/core/task-utils.test.ts`**. Confirmed:

- Top-level `describe('utils/task-utils', () => { … })` containing nested
  `describe('<fn>', …)` blocks per function.
- **Import block** (lines 11–23) — `cascadeCompleteDown` is ALREADY imported
  (sibling S1 landed). Add `recomputeAncestorsUp,` to this SAME named import
  block (additive):
  ```ts
  import {
    findItem, getDependencies, filterByStatus, getNextPendingItem,
    updateItemStatus, isSubtask, normalizeTaskId, findItemByLooseId,
    matchStatus, cascadeCompleteDown, /* + recomputeAncestorsUp, */
    type HierarchyItem,
  } from '../../../src/utils/task-utils.js';
  ```
- **Fixture builders** (arrow consts, lines 35–94) — REUSE these:
  - `createTestSubtask(id, title, status, dependencies=[])` → Subtask
    (story_points:2, context_scope:'Test scope').
  - `createTestTask(id, title, status, subtasks=[])` → Task.
  - `createTestMilestone(id, title, status, tasks=[])` → Milestone.
  - `createTestPhase(id, title, status, milestones=[])` → Phase.
  - `createTestBacklog(phases: Phase[])` → Backlog (line 92).
  - `createComplexBacklog()` → a pre-built Backlog (line 97).
- The fixtures do NOT set every Status by default; pass statuses explicitly.

## 7. Validation environment (verified package.json scripts)

| Script          | Definition                                      | Relevant? |
| --------------- | ----------------------------------------------- | --------- |
| `lint`          | `eslint . --ext .ts`                            | yes (.ts) |
| `format:check`  | `prettier --check "**/*.{ts,js,json,md,yml,yaml}"` | yes (authoritative) |
| `typecheck`     | `tsc --noEmit -p tsconfig.build.json`           | yes       |
| `test:run`      | `vitest run`                                    | yes       |
| `validate`      | `lint && format:check && typecheck && test:run` | **the gate** |
| `fix`           | `lint:fix && format` (prettier --write)         | run first to align tables/code |

**Coverage floor** (vitest.config.ts thresholds): statements **89** / branches
**90** / functions **94** / lines **89**. This is a regression FLOOR, not 100% —
the function is small + fully exercised, so its own lines will be ~100%; just
keep the whole file above the floor. Run `npm run test:coverage` to confirm.

## 8. Algorithm edge cases to encode as tests (the discriminating cases)

The min-recompute is what makes this DISTINCT from the monotonic rollup. Cover:

1. **Promote (min of all-Complete → Complete):** last subtask set Complete → its
   Task, then Milestone, then Phase all promote to Complete.
2. **DOWNGRADE (the headline feature):** a Complete task whose subtask is reset
   to Planned → Task drops to Planned, cascading up to Milestone+Phase.
3. **Min across mixed children:** subtasks `[Complete, Implementing]` → Task =
   Implementing (the least-progressed).
4. **Failed — all children Failed → parent Failed:** subtasks `[Failed, Failed]`
   → Task = Failed.
5. **Failed — mixed (excluded):** subtasks `[Failed, Planned]` → Task = Planned
   (Failed excluded since not all Failed).
6. **Obsolete — all Obsolete → Complete:** subtasks `[Obsolete, Obsolete]` →
   Task = Complete (Obsolete loses tie to Complete).
7. **Obsolete — mixed with Complete:** subtasks `[Obsolete, Complete]` → Task =
   Complete (Obsolete excluded; min of [Complete] = Complete).
8. **Obsolete — mixed with non-Complete:** subtasks `[Obsolete, Planned]` → Task
   = Planned.
9. **Retrying treated as Implementing-equivalent:** subtasks `[Retrying,
   Complete]` → Task = Implementing (Retrying→3 < Complete→4); and subtasks
   `[Retrying]` alone → Task = **Implementing** (NOT Retrying — the canonical
   progression status wins).
10. **Immutability:** the input backlog is NOT mutated (deep-equal before/after;
    original statuses unchanged). Structural sharing: a sibling phase/milestone/
    task NOT on the ancestor path is returned BY REFERENCE (===).
11. **No-op — phase-level change:** `recomputeAncestorsUp(backlog, 'P1')` returns
    the SAME backlog reference (a Phase has no ancestor to recompute).
12. **No-op — not found:** `recomputeAncestorsUp(backlog, 'P9.M9.T9.S9')`
    returns the SAME backlog reference (locate fails → no-op).
13. **Different entry levels:** change a Task → recompute Milestone+Phase;
    change a Milestone → recompute Phase only (verify only the correct ancestors
    move).
14. **Idempotency:** calling recompute twice yields a value-equal result.

## 9. Reference design (verified against the model + the immutable pattern)

```ts
// ---- module-private, placed right before recomputeAncestorsUp ----
/** Ordered progression of active statuses, least-progressed first (PRD §5.4). */
const PROGRESSION: readonly Status[] = [
  'Planned', 'Researching', 'Ready', 'Implementing', 'Complete',
];

/** Rank for the min computation. Retrying = Implementing-equiv (rank 3).
 *  Failed/Obsolete are EXCLUDED before this is consulted (recomputeParentStatus
 *  filters them); their ranks are sentinels that are never read. */
const STATUS_RANK: Record<Status, number> = {
  Planned: 0, Researching: 1, Ready: 2, Implementing: 3, Retrying: 3,
  Complete: 4,
  Failed: Number.POSITIVE_INFINITY, Obsolete: Number.POSITIVE_INFINITY,
};

/** Min-status recompute for ONE parent from its children (PRD §5.4). */
function recomputeParentStatus(children: { status: Status }[]): Status {
  const nonObsolete = children.filter(c => c.status !== 'Obsolete');
  if (nonObsolete.length === 0) return 'Complete';        // all-obsolete → Complete
  if (nonObsolete.every(c => c.status === 'Failed')) return 'Failed'; // all-failed → Failed
  const candidates = nonObsolete.filter(c => c.status !== 'Failed');  // else min of the rest
  let minRank = STATUS_RANK[candidates[0].status];
  for (let i = 1; i < candidates.length; i++) {
    const r = STATUS_RANK[candidates[i].status];
    if (r < minRank) minRank = r;
  }
  return PROGRESSION[minRank]; // rank → canonical status (Retrying→Implementing)
}
```
(`candidates` is guaranteed non-empty: not all-obsolete AND not all-failed ⇒ ≥1
non-failed non-obsolete child. `PROGRESSION[minRank]` is well-defined for
minRank ∈ 0..4.)

The exported `recomputeAncestorsUp`: `locateChange` (nested for-loops with early
`return`, mirroring `findItem`) → for level `phase` return `backlog` (no-op); for
`milestone`/`task`/`subtask` rebuild along the path with nested `.map()`+spread
(recompute each ancestor's status from its NEW children, innermost-first so the
recomputed Task feeds the Milestone recompute). See the PRP's Implementation
Patterns for the full reference implementation.