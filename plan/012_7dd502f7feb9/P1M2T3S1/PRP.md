# PRP — P1.M2.T3.S1: `cascadeCompleteDown` helper in `src/utils/task-utils.ts`

---

## Goal

**Feature Goal**: Implement PRD §5.4's **downward** cascade — *"Setting a parent
to `Complete` cascades `Complete` to every descendant"* — as one new **pure,
exported** function `cascadeCompleteDown(item: HierarchyItem): HierarchyItem` in
`src/utils/task-utils.ts`. It returns a **deep-cloned** item with `status:
'Complete'` set on the item **and on every descendant recursively**, working at
any level (Phase / Milestone / Task / Subtask; a Subtask is a leaf → just
`{ ...subtask, status: 'Complete' }`). This is **distinct from** the existing
**monotonic** `promoteIfAllComplete` / `rollupCompletion` (which only ever
*promote* a parent toward `Complete` when all children are already `Complete`,
never cascade downward, never downgrade) — those are left **untouched**.

**Deliverable**:
1. **`src/utils/task-utils.ts`** — EDIT (additive only): add the exported
   `cascadeCompleteDown` function + its **Mode-A JSDoc** (which documents the
   downward-cascade semantics, the deep-clone return, and the explicit
   distinction from the monotonic rollup). **No new imports** (`HierarchyItem`
   is defined locally at line 47; `Status` is already imported at line 25).
   Place the function **immediately after `updateItemStatus`'s closing brace
   (~line 498), before the `AnyItem` type (~585)** — textually disjoint from the
   parallel sibling's insertion (~line 380) → merge-safe.
2. **`tests/unit/core/task-utils.test.ts`** — EDIT (additive only): add
   `cascadeCompleteDown` to the existing named import from
   `../../../src/utils/task-utils.js`; append a `describe('cascadeCompleteDown',
   …)` block (inside the top-level `describe('utils/task-utils')`) covering all
   four levels, immutability, idempotency, and field preservation.

**Success Definition** (the contract from the work item):
- `cascadeCompleteDown(phase)` → new Phase with `status:'Complete'` AND every
  Milestone/Task/Subtask under it `'Complete'` (deep).
- Same for Milestone (→ Tasks + Subtasks) and Task (→ Subtasks).
- `cascadeCompleteDown(subtask)` → `{ ...subtask, status:'Complete' }` (leaf, no recursion).
- The **input tree is never mutated** (deep clone; original statuses unchanged).
- Idempotent: cascading an already-all-`Complete` subtree returns an equal tree.
- Non-status fields preserved (`id`, `title`, `type`, `story_points`,
  `dependencies`, `description`, …).
- `promoteIfAllComplete` and `rollupCompletion` are **NOT modified** (still
  module-private, still monotonic); all existing tests stay GREEN.
- `npm run validate` (lint + format:check + typecheck + test:run) is GREEN;
  `cascadeCompleteDown` is exercised by the new tests (coverage stays above the
  regression floor — statements 89 / branches 90 / functions 94 / lines 89).

---

## User Persona (if applicable)

**Target User**: A **developer** wiring up PRD §5.4 `hack update` (P1.M2.T4.S1 is
the consumer). Not end-user-facing directly.

**Use Case**: When a user runs `hack update 1 done` (set a whole phase Complete),
the CLI handler locates the Phase, sets its status, then calls
`cascadeCompleteDown(phase)` to mark every descendant Complete, then calls
`recomputeAncestorsUp` (sibling P1.M2.T3.S2) to fix ancestors.

**Pain Points Addressed**: The existing `updateItemStatus` only mutates the exact
target item (+ rolls completion *up*); there is no helper that pushes `Complete`
*downward* through the whole subtree. §5.4 explicitly requires the downward
cascade, so this fills the gap as a pure, independently-testable utility.

---

## Why

- **PRD §5.4 is the contract.** *"Setting a parent to `Complete` cascades
  `Complete` to every descendant (so `hack update 1 done` marks the whole phase
  tree Complete)."* `cascadeCompleteDown` is the downward half of that rule.
- **Direction matters — it is NOT the rollup.** The existing `rollupCompletion` /
  `promoteIfAllComplete` are monotonic **promote-only** (a parent becomes
  `Complete` only when all its non-obsolete children already are). They **cannot**
  implement the downward cascade — they never touch descendants and never force a
  parent's children Complete. Forcing a downward `Complete` is a *different
  operation*; conflating the two would break the orchestrator's automatic
  status writes (which rely on the rollup's monotonicity + short-circuit on
  `Complete`/`Obsolete` parents). Hence a **separate, exported, pure** helper.
- **Pure + reusable + total.** No I/O, no mutation of the input, no dependency on
  `Backlog`/locking/`tasks.json`. Takes one `HierarchyItem`, returns a new one.
  Independently unit-testable; trivially 100%-coverable.
- **Forward consumer.** P1.M2.T4.S1 (`hack update` CLI handler) composes the
  cascade engine as: `locate target → set status → (if Complete)
  cascadeCompleteDown(item) → recomputeAncestorsUp(backlog, id)`. So this helper
  must return an immutable new item (the handler splices it back into the locked
  backlog) and be pure.
- **Out of scope (hard boundary):** `recomputeAncestorsUp` (sibling P1.M2.T3.S2),
  the `hack update` CLI handler (P1.M2.T4.S1), `normalizeTaskId`/`findItemByLooseId`
  (P1.M2.T1.S1, already landed), `matchStatus` (parallel P1.M2.T2.S1),
  modifying `promoteIfAllComplete`/`rollupCompletion`/`updateItemStatus`/`setItemStatus`
  or any existing function, any `docs/*.md` (DOCS contract is **Mode A — JSDoc
  only**), and the `Status`/model types (read-only).

---

## What

### User-visible behavior

None directly (internal utility). Indirectly, via P1.M2.T4.S1: `hack update
<parent> done` will mark the entire subtree Complete. This subtask only ships the
helper + its tests.

### Technical requirements (exact contract)

**`src/utils/task-utils.ts`** — add ONE exported function + JSDoc. **No import
change.** Place after `updateItemStatus` (anchor: the block
`if (newStatus === 'Complete') { return rollupCompletion(updated); } return updated; }`
that closes `updateItemStatus` ~line 498), before the `AnyItem` type (~585).

Signature (exact, from the work item):
```ts
export function cascadeCompleteDown(item: HierarchyItem): HierarchyItem
```

Per-level recursion (exact, from the work item — mirror the discriminated-union
child field names; verified against `src/core/models.ts`):

| Level     | Returns                                                                                          |
| --------- | ------------------------------------------------------------------------------------------------ |
| Phase     | `{ ...phase, status:'Complete', milestones: phase.milestones.map(m => cascadeCompleteDown(m)) }` |
| Milestone | `{ ...milestone, status:'Complete', tasks: milestone.tasks.map(t => cascadeCompleteDown(t)) }`   |
| Task      | `{ ...task, status:'Complete', subtasks: task.subtasks.map(s => cascadeCompleteDown(s)) }`       |
| Subtask   | `{ ...subtask, status:'Complete' }` (leaf — no children, no recursion)                            |

**JSDoc (Mode A) must state** (the work item's DOCS contract):
- Downward-cascade semantics: sets `Complete` on the item **and** every descendant.
- Returns a **deep clone** (input never mutated; structural sharing of changed
  branches — every node becomes a new object because every node's status changes).
- **DISTINCT from the monotonic `rollupCompletion`/`promoteIfAllComplete`**: those
  only *promote* a parent toward `Complete` when all children already are, never
  cascade down, never downgrade, short-circuit on `Complete`/`Obsolete` parents.
  `cascadeCompleteDown` is the *opposite direction* — it forcibly sets every node
  `Complete` regardless of prior state. Called explicitly (by P1.M2.T4.S1) only
  when the target status is `Complete`.
- `@param`, `@returns`, `@example` (TypeScript code fence), matching the existing
  JSDoc style in the file (`@remarks`, `@example`).

### Success Criteria

- [ ] `cascadeCompleteDown` exported from `src/utils/task-utils.ts`, signature
      `cascadeCompleteDown(item: HierarchyItem): HierarchyItem`.
- [ ] Deep-cascades `Complete` from Phase, Milestone, Task, and leaf Subtask.
- [ ] Input tree is **not mutated** (deep clone); idempotent on already-Complete trees.
- [ ] Non-status fields preserved.
- [ ] `promoteIfAllComplete` / `rollupCompletion` / `updateItemStatus` /
      `setItemStatus` UNCHANGED; all pre-existing tests stay GREEN.
- [ ] JSDoc documents the downward semantics, deep-clone, and the explicit
      distinction from the monotonic rollup.
- [ ] `npm run validate` GREEN; new `describe('cascadeCompleteDown')` GREEN;
      coverage above the regression floor.

---

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed
to implement this successfully?_ **Yes** — the exact file, the exact signature,
the exact per-level recursion table (mirroring verified model field names), the
exact insertion anchor, the exact narrowing idiom to copy (`'milestones' in item`
from `setItemStatus`), the exact do-not-touch boundary (the two private monotonic
helpers), the corrected test path (`tests/unit/core/`, NOT `utils/`), the fixture
builders to reuse, the exact validation commands, and a full reference
implementation + reference test block. The non-obvious facts (placement is
merge-safe vs. the parallel sibling; the `in`-chain is lint-safe where a `switch`
might not be; coverage is a floor not 100%; the function needs zero new imports)
are all proven in `research/cascade-complete-down-facts.md`.

### Documentation & References

```yaml
# MUST READ — PRD section this item implements (the contract)
- docfile: PRD.md
  section: "5.4 Manual Status Updates (hack update)" → "Cascade semantics" (h3.12)
  why: >
    "Setting a parent to Complete cascades Complete to every descendant (so
    `hack update 1 done` marks the whole phase tree Complete)." This is THE rule;
    cascadeCompleteDown is its downward half.
  critical: The cascade is DOWNWARD (parent→descendants), distinct from the
            ancestor-recompute (bottom-up min) in the same section. Do not confuse them.

# MUST READ — architecture pin (current-vs-target + do-not-touch boundary)
- docfile: plan/012_7dd502f7feb9/architecture/implementation-status.md
  section: "F2.C — Status cascade engine (src/utils/task-utils.ts)"
  why: >
    Specifies BOTH cascadeCompleteDown (this item) and recomputeAncestorsUp
    (sibling P1.M2.T3.S2), states they are "distinct from the existing monotonic
    promoteIfAllComplete / rollupCompletion", and pins "Do NOT modify the existing
    promoteIfAllComplete (~line 313) or rollupCompletion (~line 343) — they are
    monotonic promote-only and used by the orchestrator's automatic status writes."
  critical: The do-not-touch list is explicit and load-bearing.

# MUST READ — this subtask's research (THE load-bearing facts)
- docfile: plan/012_7dd502f7feb9/P1M2T3S1/research/cascade-complete-down-facts.md
  section: "1 (insertion anchor ~line 498, merge-safe vs parallel sibling ~380)",
           "2 (HierarchyItem shape + type discriminants + child field names)",
           "3 (in-chain narrowing idiom from setItemStatus — lint-safe)",
           "4 (do-not-touch monotonic rollup boundary)",
           "5 (test path is tests/unit/core/, NOT utils/ — architecture note is wrong)",
           "6 (validation commands)", "7 (coverage = regression floor, not 100%)"
  why: >
    Corrects the architecture note's wrong test path; gives the exact insertion
    anchor; documents WHY the in-chain is preferred over switch (lint-safety);
    confirms zero new imports are needed.

# MUST READ — the file being edited (read its style + the functions to NOT touch)
- file: src/utils/task-utils.ts
  why: >
    THE edit target (638 lines). HierarchyItem defined line 47; Status imported
    line 25 (NO new import needed). promoteIfAllComplete (~394) + rollupCompletion
    (~424) are module-private + monotonic → DO NOT TOUCH. updateItemStatus (461)
    ends ~498 with the `if (newStatus === 'Complete') { return rollupCompletion(updated); }
    return updated; }` block → INSERT cascadeCompleteDown immediately after.
    setItemStatus (~619) uses the `'milestones' in item` / `'tasks' in item` /
    `'subtasks' in item` narrowing idiom — COPY THIS for cascadeCompleteDown.
  pattern: "if ('milestones' in item) item.milestones.forEach(visit); if ('tasks' in item) item.tasks.forEach(visit); if ('subtasks' in item) item.subtasks.forEach(visit);"
  gotcha: Use `in`-chain narrowing (NOT switch) to match setItemStatus and avoid
          any consistent-return/switch-exhaustiveness lint friction; guaranteed
          final return for the Subtask leaf.

# MUST READ — the model shapes (verify the per-level child field names + Status)
- file: src/core/models.ts
  why: >
    Phase (readonly type:'Phase', milestones:[…]), Milestone (type:'Milestone',
    tasks:[…]), Task (type:'Task', subtasks:[…]), Subtask (type:'Subtask', leaf).
    status: StatusEnum; Status (line 175) includes 'Complete'. Confirms the
    recursion table's field names are correct.
  pattern: "readonly type: 'Phase'; ... readonly milestones: Milestone[]; ... status: StatusEnum;"

# PATTERN FILES — copy these conventions exactly
- file: tests/unit/core/task-utils.test.ts
  why: >
    THE test file to extend (NOT tests/unit/utils/ — that path does NOT exist;
    the architecture note §F2.E is wrong). Imports from
    '../../../src/utils/task-utils.js' (named + type HierarchyItem) and types from
    '../../../src/core/models.js'. Existing fixture builders to REUSE:
    createTestSubtask(id,title,status,deps=[]), createTestTask(id,title,status,
    subtasks=[]), createTestMilestone(...), createTestPhase(...), createTestBacklog(...).
    Style: nested describe('utils/task-utils', () => describe('<fn>', () => it(...)));
    Setup/Execute/Verify; expect(...).toBe/.toEqual.
  pattern: "import { ..., cascadeCompleteDown, type HierarchyItem } from '../../../src/utils/task-utils.js';"
  gotcha: Add cascadeCompleteDown to the EXISTING named import (one additive line).
          The parallel matchStatus (T2.S1) and sequenced recomputeAncestorsUp (T3.S2)
          also add names to this same import block — additive; if git flags a
          conflict it is a trivial text-resolution (keep all names).

# PARALLEL-SIBLING CONTRACT (assume implemented as-specified — do not duplicate)
- docfile: plan/012_7dd502f7feb9/P1M2T2S1/PRP.md
  why: >
    The parallel sibling (matchStatus). It ALSO edits src/utils/task-utils.ts +
    tests/unit/core/task-utils.test.ts, but inserts matchStatus "near updateItemStatus
    (~line 380)" — ~100 lines ABOVE this item's insertion point (~498) → merge-safe.
    It adds `matchStatus` to the same import block (additive). Treat matchStatus as
    ALREADY PRESENT when this item implements. Do NOT duplicate or touch matchStatus.
# SEQUENCED-SIBLING (comes AFTER this item — leave it room, do not implement)
- docfile: plan/012_7dd502f7feb9/P1M2T3S2/PRP.md   (planned; not yet written at research time)
  why: >
    recomputeAncestorsUp (the UPWARD half of the cascade engine) will be added
    immediately AFTER cascadeCompleteDown in the same file. Place cascadeCompleteDown
    so recomputeAncestorsUp can append right after it. Do NOT implement recomputeAncestorsUp.
# CONSUMER (forward reference — do not implement)
- docfile: plan/012_7dd502f7feb9/architecture/implementation-status.md
  section: "F2.D — hack update CLI command (src/cli/index.ts)"
  why: >
    P1.M2.T4.S1 composes: locate target → set status → (if Complete)
    cascadeCompleteDown(item) → recomputeAncestorsUp(backlog, id). Confirms this
    helper must be pure + return a new item (spliced back into the locked backlog).
```

### Current Codebase tree (relevant slice)

```bash
src/utils/task-utils.ts                # ← THE EDIT TARGET (638 lines; add cascadeCompleteDown after updateItemStatus ~498)
src/core/models.ts                     # CONSUME (read-only) — Phase/Milestone/Task/Subtask shapes, type discriminants, Status incl 'Complete'
src/cli/index.ts                       # NOT IN SCOPE (consumer P1.M2.T4.S1 owns it)
tests/unit/core/task-utils.test.ts     # ← THE TEST FILE TO EXTEND (NOT tests/unit/utils/ — that path doesn't exist)
plan/012_7dd502f7feb9/architecture/implementation-status.md  # §F2.C (pin) + §F2.D (consumer) + §F2.E (test surfaces)
plan/012_7dd502f7feb9/P1M2T3S1/research/cascade-complete-down-facts.md  # THIS ITEM'S RESEARCH NOTE
```

### Desired Codebase tree with files to be added

```bash
# NO new files. Two existing files are edited additively:
src/utils/task-utils.ts              # + cascadeCompleteDown (exported function + Mode-A JSDoc) after updateItemStatus
tests/unit/core/task-utils.test.ts   # + 'cascadeCompleteDown' in the named import; + describe('cascadeCompleteDown') block
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — DO NOT TOUCH promoteIfAllComplete (~394) or rollupCompletion (~424).
//   They are module-PRIVATE, monotonic, promote-only, and used by the orchestrator's
//   automatic status writes. cascadeCompleteDown is a SEPARATE, EXPORTED, pure helper
//   that forces every node Complete (the opposite direction). Modifying the rollup
//   would break automatic status promotion across the pipeline. (architecture §F2.C.)

// CRITICAL — Use the `in`-operator narrowing chain, NOT switch(item.type). The
//   codebase's own setItemStatus (~625) uses `if ('milestones' in item) ...; if
//   ('tasks' in item) ...; if ('subtasks' in item) ...`. Copy THAT idiom: after
//   each `if (... in item) return {...}` TS narrows to that level (so item.milestones
//   etc. type-check), and a final `return { ...item, status: 'Complete' }` handles
//   the Subtask leaf. Every path returns → satisfies consistent-return; no default/
//   throw needed. switch-on-type is an equivalent alternative but can trip stricter
//   switch-exhaustiveness/no-switch lint rules; prefer the in-chain. (research §3.)

// CRITICAL — ZERO new imports. HierarchyItem is DEFINED locally (line 47).
//   Status is already imported (line 25). Adding an import for either is a lint
//   error (unused / duplicate). (research §2.)

// CRITICAL — placement is merge-safe ONLY if you insert AFTER updateItemStatus
//   (~498), NOT near line 380. The parallel sibling matchStatus (P1.M2.T2.S1)
//   inserts ~line 380; the earlier normalizeTaskId/findItemByLooseId (P1.M2.T1.S1)
//   landed at 135–193. Inserting at ~498 is textually disjoint from both → clean
//   merge. (research §1.)

// CRITICAL — the architecture note §F2.E names the WRONG test path
//   (`tests/unit/utils/task-utils.test.ts` does NOT exist). The real file is
//   `tests/unit/core/task-utils.test.ts`. Use tests/unit/core/. (research §5.)

// GOTCHA — "deep clone" here means new objects at every visited node via spread,
//   matching the updateItemStatus/rollupCompletion structural-sharing pattern.
//   Because cascadeCompleteDown changes EVERY node's status, there are NO
//   unchanged subtrees — every node becomes a new object. The Subtask leaf's
//   `{...subtask}` shallow-copies primitives (incl. status) and shares the
//   `dependencies` array reference, but we never mutate it, so it's effectively
//   a deep clone for status purposes. Do NOT hand-clone dependencies/stories.

// GOTCHA — immutability assertion in tests: assert the ORIGINAL tree's statuses
//   are UNCHANGED after the call (cascadeCompleteDown must not mutate its input).
//   The spread chain guarantees this; the test pins it.

// GOTCHA — prettier owns formatting; run `npm run fix` then `npm run format:check`.
//   eslint (npm run lint) covers .ts only. Coverage is a REGRESSION FLOOR
//   (89/90/94/89), NOT 100% — but write thorough tests anyway (all 4 levels +
//   immutability + idempotency) to keep coverage well above the floor.
//   (research §6/§7.)

// GOTCHA — DOCS contract is Mode A (JSDoc only). Do NOT edit any docs/*.md.
//   The JSDoc MUST explicitly state the distinction from the monotonic rollup
//   (the work item's DOCS requirement).
```

---

## Implementation Blueprint

### Data models and structure

No new data models. The function consumes the existing `HierarchyItem` union
(defined at `src/utils/task-utils.ts:47`) and the existing `Status` type
(`src/core/models.ts:175`, already imported). The recursion mirrors the
discriminated-union child-field names (`milestones`/`tasks`/`subtasks`) verified
in `src/core/models.ts`.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: READ the target region of src/utils/task-utils.ts
  - READ: lines 1–70 (imports + HierarchyItem + isSubtask narrowing idiom),
    lines ~386–498 (promoteIfAllComplete + rollupCompletion + updateItemStatus —
    the do-not-touch boundary AND the insertion anchor), lines ~585–638 (AnyItem
    + setItemStatus — the `in`-narrowing pattern to copy).
  - CONFIRM: HierarchyItem (line 47) + Status (imported line 25) need NO new import.

Task 2: ADD cascadeCompleteDown to src/utils/task-utils.ts (after updateItemStatus, ~line 498)
  - INSERT: immediately after the block
        if (newStatus === 'Complete') {
          return rollupCompletion(updated);
        }
        return updated;
      }
    and BEFORE the `/** Union of any hierarchy node ... */` JSDoc for AnyItem (~585).
  - IMPLEMENT (reference code in "Implementation Patterns" below — use the `in`-chain):
      export function cascadeCompleteDown(item: HierarchyItem): HierarchyItem
    Per-level: Phase→milestones.map, Milestone→tasks.map, Task→subtasks.map, Subtask→leaf.
  - JSDOC (Mode A): document downward cascade, deep-clone return, and the EXPLICIT
    distinction from the monotonic rollupCompletion/promoteIfAllComplete. Include
    @param, @returns, @example (```typescript fence).
  - NAMING: cascadeCompleteDown (camelCase, exported).
  - DO NOT: import anything; modify promoteIfAllComplete/rollupCompletion/updateItemStatus/setItemStatus.

Task 3: ADD tests to tests/unit/core/task-utils.test.ts
  - EDIT the named import from '../../../src/utils/task-utils.js': add `cascadeCompleteDown,`
    (additive line — alongside the existing findItem/getDependencies/.../matchStatus names).
  - APPEND a describe('cascadeCompleteDown', () => { ... }) block (inside the top-level
    describe('utils/task-utils')). Reuse the existing fixture builders:
    createTestSubtask / createTestTask / createTestMilestone / createTestPhase / createTestBacklog.
  - CASES (see reference test block below):
      1. Subtask (leaf): returns new subtask status Complete; original unchanged.
      2. Task: task + every subtask → Complete (deep).
      3. Milestone: milestone + every task + every subtask → Complete (deep).
      4. Phase: phase + every milestone + task + subtask → Complete (full deep cascade).
      5. Immutability: original tree statuses UNCHANGED after the call.
      6. Idempotency: cascading an already-all-Complete tree returns an equal tree.
      7. Field preservation: id/title/type/story_points/dependencies/description preserved.
      8. Mixed prior statuses: a tree with mixed Planned/Implementing/Failed nodes → ALL become Complete
         (proves the "force regardless of prior state" semantics distinct from monotonic rollup).
  - NAMING: it('<scenario>') per case; expect(...).toEqual(...) for deep structure.
  - PLACEMENT: append at end of the top-level describe (or as a new top-level describe sibling).
    Merge-safe vs. the parallel matchStatus describe (different content; both additive).

Task 4: FORMAT + VERIFY
  - RUN: npm run fix            (lint:fix + prettier --write)
  - RUN: npm run validate       (lint && format:check && typecheck && test:run) — MUST be GREEN
  - RUN: npx vitest run tests/unit/core/task-utils.test.ts   (targeted — the new describe passes)
  - EXPECTED: all green; promoteIfAllComplete/rollupCompletion/updateItemStatus tests still pass;
    coverage stays above the regression floor (89/90/94/89).
```

### Implementation Patterns & Key Details

```ts
// ---- src/utils/task-utils.ts — INSERT after updateItemStatus (~line 498) ----
// Uses the SAME `in`-operator narrowing idiom as setItemStatus (~625). After each
// `if (... in item) return {...}` TS narrows `item` to that level so the child
// field type-checks. Final return handles the Subtask leaf. Every path returns.

/**
 * Cascade `Complete` downward through an item's entire subtree (PRD §5.4).
 *
 * @remarks
 * Returns a **deep-cloned** item with `status: 'Complete'` set on the item AND
 * on every descendant, recursively. This is the **downward** half of the §5.4
 * rule "Setting a parent to Complete cascades Complete to every descendant"
 * (e.g. `hack update 1 done` marks the whole phase tree Complete). Works at any
 * level; a `Subtask` is a leaf and simply returns `{ ...subtask, status: 'Complete' }`.
 *
 * This is **distinct from the monotonic {@link rollupCompletion} /
 * {@link promoteIfAllComplete} helpers**: those only ever *promote* a parent
 * toward `Complete` when all its non-obsolete children are already `Complete`
 * (they never cascade downward, never downgrade, and short-circuit on a parent
 * already `Complete`/`Obsolete`). `cascadeCompleteDown` is the opposite
 * direction — it forcibly sets every node `Complete` regardless of prior state.
 * It is called explicitly (by the `hack update` handler, P1.M2.T4.S1) only when
 * the target status is `Complete`, immediately before `recomputeAncestorsUp`
 * recomputes ancestors. Do not use it as a replacement for the rollup.
 *
 * Pure: the input tree is never mutated (structural sharing — every visited node
 * becomes a new object because every status changes). Idempotent.
 *
 * @param item - The hierarchy item (any level) to cascade `Complete` down from.
 * @returns A new, deep-cloned item with `status: 'Complete'` at every level.
 *
 * @example
 * ```typescript
 * const phase = findItem(backlog, 'P1') as Phase;
 * const completed = cascadeCompleteDown(phase);
 * // completed.status === 'Complete'
 * // every milestone, task, and subtask under it is also 'Complete'
 * ```
 */
export function cascadeCompleteDown(item: HierarchyItem): HierarchyItem {
  if ('milestones' in item) {
    // Phase
    return {
      ...item,
      status: 'Complete',
      milestones: item.milestones.map(m => cascadeCompleteDown(m)),
    };
  }
  if ('tasks' in item) {
    // Milestone
    return {
      ...item,
      status: 'Complete',
      tasks: item.tasks.map(t => cascadeCompleteDown(t)),
    };
  }
  if ('subtasks' in item) {
    // Task
    return {
      ...item,
      status: 'Complete',
      subtasks: item.subtasks.map(s => cascadeCompleteDown(s)),
    };
  }
  // Subtask (leaf — no children)
  return { ...item, status: 'Complete' };
}
```

```ts
// ---- tests/unit/core/task-utils.test.ts — reference test block ----
// Reuse the existing fixture builders (createTestSubtask/Task/Milestone/Phase/Backlog).
// Add `cascadeCompleteDown` to the named import from '../../../src/utils/task-utils.js'.

describe('cascadeCompleteDown', () => {
  it('sets a leaf Subtask to Complete (no children)', () => {
    const sub = createTestSubtask('P1.M1.T1.S1', 'leaf', 'Planned');
    const out = cascadeCompleteDown(sub);
    expect(out.status).toBe('Complete');
    expect(out.id).toBe('P1.M1.T1.S1');
    // original untouched
    expect(sub.status).toBe('Planned');
  });

  it('cascades Complete down a Task to all its Subtasks', () => {
    const task = createTestTask('P1.M1.T1', 't', 'Implementing', [
      createTestSubtask('P1.M1.T1.S1', 'a', 'Planned'),
      createTestSubtask('P1.M1.T1.S2', 'b', 'Failed'),
    ]);
    const out = cascadeCompleteDown(task);
    expect(out.status).toBe('Complete');
    expect(out.subtasks.map(s => s.status)).toEqual(['Complete', 'Complete']);
    // original untouched
    expect(task.status).toBe('Implementing');
    expect(task.subtasks.map(s => s.status)).toEqual(['Planned', 'Failed']);
  });

  it('cascades Complete down a Milestone to all Tasks and Subtasks', () => {
    const milestone = createTestMilestone('P1.M1', 'm', 'Planned', [
      createTestTask('P1.M1.T1', 't1', 'Planned', [
        createTestSubtask('P1.M1.T1.S1', 'a', 'Planned'),
      ]),
    ]);
    const out = cascadeCompleteDown(milestone);
    expect(out.status).toBe('Complete');
    expect(out.tasks[0].status).toBe('Complete');
    expect(out.tasks[0].subtasks[0].status).toBe('Complete');
  });

  it('cascades Complete down a Phase to every descendant (full deep cascade)', () => {
    const phase = createTestPhase('P1', 'phase', 'Planned', [
      createTestMilestone('P1.M1', 'm', 'Planned', [
        createTestTask('P1.M1.T1', 't', 'Planned', [
          createTestSubtask('P1.M1.T1.S1', 'leaf', 'Planned'),
        ]),
      ]),
    ]);
    const out = cascadeCompleteDown(phase);
    expect(out.status).toBe('Complete');
    expect(out.milestones[0].status).toBe('Complete');
    expect(out.milestones[0].tasks[0].status).toBe('Complete');
    expect(out.milestones[0].tasks[0].subtasks[0].status).toBe('Complete');
  });

  it('does NOT mutate the input tree (immutability)', () => {
    const phase = createTestPhase('P1', 'phase', 'Planned', [
      createTestMilestone('P1.M1', 'm', 'Researching', [
        createTestTask('P1.M1.T1', 't', 'Implementing', [
          createTestSubtask('P1.M1.T1.S1', 'leaf', 'Ready'),
        ]),
      ]),
    ]);
    const snapshot = JSON.parse(JSON.stringify(phase));
    cascadeCompleteDown(phase);
    expect(JSON.parse(JSON.stringify(phase))).toEqual(snapshot); // unchanged
  });

  it('is idempotent on an already-all-Complete subtree', () => {
    const phase = createTestPhase('P1', 'phase', 'Complete', [
      createTestMilestone('P1.M1', 'm', 'Complete', [
        createTestTask('P1.M1.T1', 't', 'Complete', [
          createTestSubtask('P1.M1.T1.S1', 'leaf', 'Complete'),
        ]),
      ]),
    ]);
    const out = cascadeCompleteDown(phase);
    expect(out.status).toBe('Complete');
    expect(out.milestones[0].tasks[0].subtasks[0].status).toBe('Complete');
    expect(out).toEqual(phase);
  });

  it('forces every node Complete regardless of prior mixed statuses (distinct from monotonic rollup)', () => {
    // A tree the monotonic rollup would NOT promote (children not all Complete)
    const task = createTestTask('P1.M1.T1', 't', 'Planned', [
      createTestSubtask('P1.M1.T1.S1', 'a', 'Planned'),
      createTestSubtask('P1.M1.T1.S2', 'b', 'Implementing'),
      createTestSubtask('P1.M1.T1.S3', 'c', 'Failed'),
    ]);
    const out = cascadeCompleteDown(task);
    expect(out.status).toBe('Complete');
    expect(out.subtasks.map(s => s.status)).toEqual([
      'Complete',
      'Complete',
      'Complete',
    ]);
  });

  it('preserves non-status fields (id/title/type/story_points/dependencies)', () => {
    const sub = createTestSubtask('P1.M1.T1.S1', 'leaf', 'Planned', ['P1.M1.T1.S0']);
    const out = cascadeCompleteDown(sub);
    expect(out.id).toBe('P1.M1.T1.S1');
    expect(out.title).toBe('leaf');
    expect(out.type).toBe('Subtask');
    expect(out.story_points).toBe(sub.story_points);
    expect(out.dependencies).toEqual(['P1.M1.T1.S0']);
  });
});
```

### Integration Points

```yaml
SOURCE (src/utils/task-utils.ts — additive only):
  - + export function cascadeCompleteDown(item: HierarchyItem): HierarchyItem  (after updateItemStatus ~498)
  - + Mode-A JSDoc (downward cascade, deep-clone, distinct-from-monotonic-rollup)
  - NO import change (HierarchyItem local line 47; Status imported line 25)
  - NO change to promoteIfAllComplete / rollupCompletion / updateItemStatus / setItemStatus / findItem / normalizeTaskId / findItemByLooseId / matchStatus

TESTS (tests/unit/core/task-utils.test.ts — additive only):
  - + 'cascadeCompleteDown' in the named import from '../../../src/utils/task-utils.js'
  - + describe('cascadeCompleteDown', ...) block (8 cases: leaf/task/milestone/phase/immutability/idempotency/force-mixed/preserve-fields)
  - reuse existing fixtures: createTestSubtask/Task/Milestone/Phase/Backlog

NO CHANGES TO (hard boundary):
  - recomputeAncestorsUp (sibling P1.M2.T3.S2), the hack update CLI handler (P1.M2.T4.S1)
  - any docs/*.md (DOCS = Mode A: JSDoc only)
  - src/core/models.ts, src/cli/*, PRD.md, plan/**, tasks.json, package.json
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run fix              # lint:fix + prettier --write (aligns the new code)
npm run typecheck        # tsc --noEmit -p tsconfig.build.json
npm run lint             # eslint . --ext .ts
npm run format:check     # prettier --check "**/*.{ts,js,json,md,yml,yaml}"

# Targeted (faster feedback):
npx eslint src/utils/task-utils.ts
npx prettier --check src/utils/task-utils.ts tests/unit/core/task-utils.test.ts
npx tsc --noEmit -p tsconfig.build.json

# Expected: Zero errors. Most likely nit: prettier formatting (re-run `npm run fix`).
# Type errors would only arise from a misspelled child-field name (milestones/tasks/subtasks)
# — verify against src/core/models.ts. Using the `in`-chain avoids switch-exhaustiveness
# consistent-return friction.
```

### Level 2: Unit Tests (Component Validation)

```bash
# The new suite (must pass):
npx vitest run tests/unit/core/task-utils.test.ts

# Expected: all green, INCLUDING the new describe('cascadeCompleteDown') and ALL
# pre-existing tests (findItem/updateItemStatus/normalizeTaskId/findItemByLooseId/matchStatus
# once landed). A failure in a pre-existing test means cascadeCompleteDown accidentally
# mutated shared state or touched another function — re-read the do-not-touch boundary.
```

### Level 3: Integration / Regression (System Validation)

```bash
# Full gate — MUST stay green. Proves:
#  (1) cascadeCompleteDown passes (all 4 levels + immutability + idempotency + force-mixed);
#  (2) the additive edit did NOT regress any other test (esp. the status/rollup suites);
#  (3) coverage stays above the regression floor (89/90/94/89).
npm run validate         # = lint && format:check && typecheck && test:run
npm run test:coverage    # optional: confirm src/utils/task-utils.ts coverage is high
#                          (the function is small + fully exercised → ~100% on its lines)

# Build emits dist/ cleanly (proves the edit compiles via tsc):
npx tsc -p tsconfig.build.json

# Expected: full suite green; coverage above floor; build succeeds.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# No I/O / network / DB / CLI in this subtask — a pure tree transform.
# Domain-specific reasoning (record in commit message):
#   1. Direction correctness (PRD §5.4): cascadeCompleteDown is the DOWNWARD cascade
#      (parent→descendants), NOT the upward ancestor-recompute. It forces every node
#      Complete regardless of prior state — distinct from the monotonic rollup.
#   2. Immutability: the input tree is never mutated (deep clone via spread); every
#      visited node becomes a new object. The immutability test pins this.
#   3. Boundary discipline: promoteIfAllComplete/rollupCompletion are untouched and
#      still module-private; their tests stay green; the orchestrator's automatic
#      status writes are unaffected.
#   4. Consumer-ready: returns a pure new HierarchyItem for P1.M2.T4.S1 to splice
#      back into the locked backlog (no side effects, no locking, no tasks.json).
```

---

## Final Validation Checklist

### Technical Validation

- [ ] `npm run validate` exits 0 (lint + format:check + typecheck + test:run).
- [ ] `npx vitest run tests/unit/core/task-utils.test.ts` exits 0 (new describe GREEN).
- [ ] `npx tsc -p tsconfig.build.json` compiles with no errors.
- [ ] Coverage stays above the regression floor (statements 89 / branches 90 /
      functions 94 / lines 89); `src/utils/task-utils.ts` well-covered.

### Feature Validation

- [ ] `cascadeCompleteDown(phase)` sets Phase + every Milestone/Task/Subtask Complete.
- [ ] `cascadeCompleteDown(milestone)` / `(task)` / `(subtask)` cascade/leaf correctly.
- [ ] Input tree is NOT mutated (immutability test passes).
- [ ] Idempotent on already-all-Complete trees.
- [ ] Forces every node Complete regardless of prior mixed statuses (distinct from rollup).
- [ ] Non-status fields preserved (id/title/type/story_points/dependencies/description).
- [ ] JSDoc documents downward semantics, deep-clone, and the explicit distinction
      from the monotonic `rollupCompletion`/`promoteIfAllComplete`.

### Code Quality Validation

- [ ] Uses the `in`-operator narrowing idiom (matches `setItemStatus`); guaranteed
      final return; lint-safe.
- [ ] ZERO new imports (HierarchyItem local; Status already imported).
- [ ] Placed after `updateItemStatus` (~498) — merge-safe vs. parallel `matchStatus` (~380)
      and the earlier `normalizeTaskId`/`findItemByLooseId` (135–193).
- [ ] Additive only — no existing function modified; no `docs/*.md` edited (Mode A: JSDoc).
- [ ] Tests reuse existing fixture builders; placed in `tests/unit/core/` (NOT `utils/`).

### Documentation & Deployment

- [ ] Mode-A JSDoc present on `cascadeCompleteDown` (downward cascade + deep-clone +
      distinct-from-monotonic-rollup + @param/@returns/@example).
- [ ] Commit message notes: the §5.4 downward-cascade contract; the merge-safe
      placement; the do-not-touch boundary; the `in`-chain idiom choice; that this is
      the downward half consumed by P1.M2.T4.S1 (with `recomputeAncestorsUp` as the
      upward sibling P1.M2.T3.S2).

---

## Anti-Patterns to Avoid

- ❌ Don't modify `promoteIfAllComplete` (~394) or `rollupCompletion` (~424) — they
  are module-private, monotonic, promote-only, and load-bearing for the
  orchestrator's automatic status writes. `cascadeCompleteDown` is a SEPARATE
  exported helper. (architecture §F2.C.)
- ❌ Don't conflate directions — this is the DOWNWARD cascade (parent→descendants),
  NOT the upward ancestor-recompute (`recomputeAncestorsUp`, sibling P1.M2.T3.S2)
  and NOT the monotonic rollup. Forcing every node Complete ≠ promoting a parent
  when children are done.
- ❌ Don't use `switch (item.type)` when the `in`-chain is available — `setItemStatus`
  already established the `in`-idiom in this file, it's lint-safe (guaranteed final
  return, no exhaustiveness friction), and TS narrows correctly. (research §3.)
- ❌ Don't add imports for `HierarchyItem` or `Status` — `HierarchyItem` is defined
  locally (line 47) and `Status` is already imported (line 25). Adding either is a
  lint error.
- ❌ Don't place the function near line 380 (where the parallel `matchStatus` lands)
  — insert after `updateItemStatus` (~498) to stay merge-safe. (research §1.)
- ❌ Don't put tests in `tests/unit/utils/` — that path does NOT exist (the
  architecture note §F2.E is wrong). The real file is `tests/unit/core/task-utils.test.ts`.
- ❌ Don't mutate the input — return a new tree (deep clone via spread). The
  immutability test pins this; mutating shared nodes would corrupt the locked backlog
  at the P1.M2.T4.S1 call site.
- ❌ Don't hand-clone nested arrays (`dependencies`, `story_points`) — spread is
  sufficient; structural sharing of unchanged nested arrays matches
  `updateItemStatus`/`rollupCompletion`.
- ❌ Don't implement `recomputeAncestorsUp` (sibling P1.M2.T3.S2) or the `hack update`
  CLI handler (P1.M2.T4.S1) — out of scope. Leave room for `recomputeAncestorsUp` to
  append right after this function.
- ❌ Don't edit any `docs/*.md` — the DOCS contract is Mode A (JSDoc only).
- ❌ Don't skip the "force regardless of prior state" test — it is the proof that
  `cascadeCompleteDown` is distinct from the monotonic rollup (which would NOT
  promote a parent whose children aren't all Complete).

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: This is a single, small (~25-line), pure, additive function with an
exact contract (signature + per-level recursion table) supplied verbatim by the
work item and verified against `src/core/models.ts`. The narrowing idiom
(`'milestones' in item` / `'tasks' in item` / `'subtasks' in item`) is copied
directly from the file's own `setItemStatus`, guaranteeing it type-checks and is
lint-safe. Zero new imports are needed (`HierarchyItem` local, `Status` imported).
The do-not-touch boundary (the two private monotonic helpers) is explicit and the
insertion point (~line 498) is textually disjoint from the parallel sibling's
insertion (~380) and the earlier landed functions (135–193), so the merge is
clean. The only test-path risk — the architecture note's wrong `tests/unit/utils/`
path — is corrected here to `tests/unit/core/` with the exact import line and
fixture builders named. The reference implementation and reference 8-case test
block are written out verbatim. The residual risk is a minor prettier/lint nit,
which `npm run fix` resolves automatically. Coverage is a regression floor
(89/90/94/89), comfortably met by the thorough test block. Validation is the
project's standard `npm run validate` gate.