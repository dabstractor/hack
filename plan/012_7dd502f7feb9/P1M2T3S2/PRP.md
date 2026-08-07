# PRP — P1.M2.T3.S2: `recomputeAncestorsUp` helper (bottom-up min-status recompute) in `src/utils/task-utils.ts`

---

## Goal

**Feature Goal**: Implement PRD §5.4's **upward** ancestor recompute — *"every
ancestor's status is recomputed bottom-up as the **minimum** (least-progressed)
status among its non-`Failed` children … `Failed` children are excluded unless
ALL children are `Failed` … `Obsolete` is treated as terminal alongside
`Complete`, and loses ties to it … this CAN downgrade ancestors"* — as ONE new
**pure, exported** function `recomputeAncestorsUp(backlog: Backlog, changedId:
string): Backlog` in `src/utils/task-utils.ts`, plus its **module-private**
helpers (`recomputeParentStatus`, `locateChange`) and the `PROGRESSION` /
`STATUS_RANK` consts. It walks UP from the changed item's position and
recomputes each ancestor (Task→Milestone→Phase) from its children. This is
**strictly richer than** the existing **monotonic** `promoteIfAllComplete` /
`rollupCompletion` (which only ever *promote* toward `Complete`, never
downgrade, and never recompute a true minimum) — those are left **untouched**.

**Deliverable**:
1. **`src/utils/task-utils.ts`** — EDIT (additive only): add the exported
   `recomputeAncestorsUp` + its **Mode-A JSDoc** (documenting the min-status
   algorithm, the status ordering, the Failed/Obsolete/Complete special
   handling, the Retrying→Implementing rule, that it CAN downgrade ancestors,
   and the explicit distinction from the monotonic rollup) + the module-private
   helpers/consts. **No new imports** (`Backlog` + `Status` are already imported
   at the top). Place **immediately after `cascadeCompleteDown`** (sibling S1,
   already landed), before `MATCHABLE_STATUSES` — textually disjoint from
   `matchStatus` (~100 lines below) → merge-safe.
2. **`tests/unit/core/task-utils.test.ts`** — EDIT (additive only): add
   `recomputeAncestorsUp` to the existing named import from
   `../../../src/utils/task-utils.js`; append a
   `describe('recomputeAncestorsUp', …)` block (inside the top-level
   `describe('utils/task-utils')`) covering promote, **downgrade**, Failed
   (all/mixed), Obsolete (all/mixed/with-Complete), Retrying→Implementing,
   min-across-mixed, immutability + structural sharing, the two no-op cases
   (phase-level / not-found), per-level entry, and idempotency.

**Success Definition** (the contract from the work item):
- `recomputeAncestorsUp(backlog, subtaskId)` after a leaf change recomputes the
  leaf's Task, Milestone, AND Phase (full ancestor chain).
- Computes the true **minimum** (least-progressed) status — NOT all-or-nothing.
- **CAN DOWNGRADE:** resetting a subtask from `Complete` → `Planned` drops its
  Task/Milestone/Phase to the least-progressed child (the headline feature).
- **Obsolete:** all-Obsolete children → parent `Complete`; mixed Obsolete+Complete
  → `Complete`; Obsolete excluded from the min otherwise.
- **Failed:** all-failed children → parent `Failed`; Failed excluded from the min
  when any non-failed sibling exists.
- **Retrying:** treated as `Implementing`-equivalent for the min (and maps back
  to `Implementing`, never propagates `Retrying` up).
- **Immutability:** input backlog never mutated; only ancestor-path nodes copied
  (structural sharing — non-path nodes returned by reference); **no-op cases
  return the SAME `backlog` reference** (phase-level change / id-not-found).
- `promoteIfAllComplete` / `rollupCompletion` / `updateItemStatus` / `setItemStatus`
  / `cascadeCompleteDown` are **NOT modified**; all existing tests stay GREEN.
- `npm run validate` (lint + format:check + typecheck + test:run) is GREEN;
  coverage stays above the regression floor (statements 89 / branches 90 /
  functions 94 / lines 89).

---

## User Persona (if applicable)

**Target User**: A **developer** wiring up PRD §5.4 `hack update` (P1.M2.T4.S1 is
the consumer). Not end-user-facing directly.

**Use Case**: After the `hack update` handler sets a target item's status (and,
if the target was `Complete`, ran `cascadeCompleteDown`), it calls
`recomputeAncestorsUp(backlog, changedId)` to keep every ancestor consistent with
the new minimum. This handles BOTH "mark last subtask Complete → promote
ancestors" AND "reset a subtask to Planned → **demote** ancestors."

**Pain Points Addressed**: The existing `updateItemStatus`+`rollupCompletion` path
only ever *promotes* toward `Complete` (and only on the `Complete` branch). There
is no helper that recomputes the true minimum AND can **downgrade** an ancestor
when a child regresses. §5.4 explicitly requires this for `hack update`, so this
fills the gap as a pure, independently-testable utility.

---

## Why

- **PRD §5.4 is the contract.** The "Ancestor recompute" paragraph specifies the
  minimum-status rule with the Failed/Obsolete/Complete special-cases AND the
  downgrade capability (`resetting a subtask back to Planned drops its ancestors
  to reflect the remaining work`). `recomputeAncestorsUp` is the upward half of
  the §5.4 cascade engine (sibling `cascadeCompleteDown` is the downward half,
  already landed).
- **Direction + richness matter — it is NOT the rollup.** The existing
  `rollupCompletion`/`promoteIfAllComplete` are **monotonic promote-only**: a
  parent becomes `Complete` only when all its non-obsolete children already are,
  they short-circuit on `Complete`/`Obsolete` parents, they never compute a true
  minimum, and they **never downgrade**. They CANNOT implement the §5.4 recompute
  (e.g. they cannot demote a Complete task when a child regresses). Conflating the
  two would break the orchestrator's automatic status writes (which rely on the
  rollup's monotonicity). Hence a **separate, exported, pure** helper that is
  **strictly richer** (true min + downgrade).
- **Pure + reusable + total.** No I/O, no locking, no `tasks.json`, no mutation of
  the input. Takes a `Backlog` + an id, returns a new `Backlog`. The consumer
  (P1.M2.T4.S1) splices the result back into the locked backlog under the §5.1
  write lock.
- **Forward consumer.** P1.M2.T4.S1 (`hack update` CLI handler) composes the
  cascade engine as: `locate target → set status → (if Complete)
  cascadeCompleteDown(item) → recomputeAncestorsUp(backlog, changedId)`. So this
  helper must be pure + return a new immutable backlog.
- **Out of scope (hard boundary):** the `hack update` CLI handler (P1.M2.T4.S1),
  modifying `cascadeCompleteDown` (sibling S1, landed) /
  `promoteIfAllComplete` / `rollupCompletion` / `updateItemStatus` / `setItemStatus`
  / `findItem` / `normalizeTaskId` / `findItemByLooseId` / `matchStatus` or any
  existing function, any `docs/*.md` (DOCS contract is **Mode A — JSDoc only**),
  and the `Status`/model types (read-only).

---

## What

### User-visible behavior

None directly (internal utility). Indirectly, via P1.M2.T4.S1: `hack update
<id> <status>` will keep ancestors consistent with the new minimum — promoting
on completion AND demoting on regression. This subtask only ships the helper +
its tests.

### Technical requirements (exact contract)

**`src/utils/task-utils.ts`** — add ONE exported function + module-private helpers
+ consts + JSDoc. **No import change.** Place immediately after `cascadeCompleteDown`
(anchor: the `// Subtask (leaf — no children)\n  return { ...item, status: 'Complete' };\n}`
that closes `cascadeCompleteDown`), before the `/** The statuses that are manually
settable via hack update … */` JSDoc for `MATCHABLE_STATUSES`.

Signature (exact, from the work item):
```ts
export function recomputeAncestorsUp(backlog: Backlog, changedId: string): Backlog
```

**Status ordering (progression)** — `Planned(0) < Researching(1) < Ready(2) <
Implementing(3) < Complete(4)`; `Retrying` ≡ `Implementing(3)` (transitional,
never propagated up as `Retrying`).

**Per-ancestor algorithm** (verbatim from the work item — implemented in the
module-private `recomputeParentStatus(children: { status: Status }[]): Status`):
1. Exclude `Obsolete` children.
2. If ALL children are `Obsolete` → return `Complete` (Obsolete loses ties to Complete).
3. Of non-Obsolete: if ALL are `Failed` → return `Failed`.
4. Else: exclude `Failed`; return `min`(remaining by ordering; Retrying→3), mapped
   back to the canonical progression status.

**Walk-up** (in the exported function): locate the changed item's position
(`locateChange`, nested for-loops w/ early `return` mirroring `findItem`); if not
found → return `backlog` unchanged; if the changed item is a **Phase** → return
`backlog` unchanged (no ancestor to recompute); else rebuild along the ancestor
path with nested `.map()`+spread, recomputing each ancestor's status from its
**new** children innermost-first (so the recomputed Task feeds the Milestone
recompute, which feeds the Phase recompute). Only ancestor-path nodes are copied;
everything else is shared by reference.

**JSDoc (Mode A) must state** (the work item's DOCS contract):
- The min-status algorithm + the exact status ordering (Planned<…<Complete).
- The Failed/Obsolete/Complete special handling (all-Obsolete→Complete; all-failed→Failed;
  Failed/Obsolete otherwise excluded from the min).
- That it **CAN DOWNGRADE** ancestors (regression example).
- That it is **DISTINCT from the monotonic `rollupCompletion`/`promoteIfAllComplete`**
  (those only promote, never downgrade, never compute a true min).
- `Retrying` is treated as `Implementing`-equivalent.
- `@param`, `@returns`, `@example` (TypeScript code fence showing a **downgrade**),
  matching the existing JSDoc style (`@remarks`, `@example`).

### Success Criteria

- [ ] `recomputeAncestorsUp(backlog, changedId)` exported, signature exact.
- [ ] Recomputes the FULL ancestor chain (Task→Milestone→Phase) for a subtask-level change.
- [ ] Computes the true **minimum** (not all-or-nothing); **CAN DOWNGRADE**.
- [ ] Obsolete: all-Obsolete→Complete; loses ties to Complete; excluded from min otherwise.
- [ ] Failed: all-failed→Failed; excluded from min when a non-failed sibling exists.
- [ ] Retrying→Implementing-equivalent; maps back to `Implementing`, never `Retrying`.
- [ ] Input never mutated; only ancestor-path nodes copied (structural sharing);
      no-op cases (phase-level / not-found) return the SAME `backlog` reference.
- [ ] `promoteIfAllComplete` / `rollupCompletion` / `updateItemStatus` / `setItemStatus`
      / `cascadeCompleteDown` UNCHANGED; all pre-existing tests stay GREEN.
- [ ] JSDoc documents the algorithm, ordering, special handling, downgrade, and the
      distinction from the monotonic rollup.
- [ ] `npm run validate` GREEN; new `describe('recomputeAncestorsUp')` GREEN;
      coverage above the regression floor.

---

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed
to implement this successfully?_ **Yes** — the exact file, the exact signature,
the exact per-ancestor algorithm (verbatim from the work item), the exact
placement (immediately after `cascadeCompleteDown`), the exact status ordering +
Failed/Obsolete/Complete/Retrying handling, the immutable pattern to mirror
(`updateItemStatus` path-rebuild + `rollupCompletion` ancestor-recompute), the
`Record<Status, number>` requirement (Status has 8 values), the do-not-touch
boundary (the two private monotonic helpers), the correct test path
(`tests/unit/core/`, NOT `utils/`), the fixture builders + import block to reuse,
the exact validation commands, and a FULL reference implementation + reference
test block. All non-obvious facts are proven in
`research/recompute-ancestors-facts.md`.

### Documentation & References

```yaml
# MUST READ — PRD section this item implements (the contract)
- docfile: PRD.md
  section: "5.4 Manual Status Updates (hack update)" → "Cascade semantics → Ancestor recompute" (h3.12)
  why: >
    "every ancestor's status is recomputed bottom-up as the MINIMUM (least-progressed)
    status among its non-Failed children (Failed children are excluded unless ALL
    children are Failed, in which case the parent becomes Failed; Obsolete is
    treated as terminal alongside Complete, and loses ties to it so a fully-done
    parent reports Complete). … resetting a subtask back to Planned drops its
    ancestors to reflect the remaining work." This is THE rule; recomputeAncestorsUp
    is its upward half.
  critical: The recompute is UPWARD (child→ancestors) AND computes a true MIN that
            CAN DOWNGRADE — distinct from the downward cascadeCompleteDown AND from
            the monotonic rollup. Do not confuse the three.

# MUST READ — architecture pin (current-vs-target + do-not-touch boundary)
- docfile: plan/012_7dd502f7feb9/architecture/implementation-status.md
  section: "F2.C — Status cascade engine (src/utils/task-utils.ts)"
  why: >
    Specifies recomputeAncestorsUp(backlog: Backlog, changedItemId: string): Backlog:
    "walks UP the ancestor chain … and recomputes each ancestor's status as the
    minimum (least-progressed) status among its children" with the Failed/Obsolete/
    Retrying special handling, "CAN downgrade ancestors," and pins "Do NOT modify the
    existing promoteIfAllComplete (~line 313) or rollupCompletion (~line 343) — they
    are monotonic promote-only."
  critical: The do-not-touch list + the exact signature + the min semantics are explicit.

# MUST READ — this subtask's research (THE load-bearing facts)
- docfile: plan/012_7dd502f7feb9/P1M2T3S2/research/recompute-ancestors-facts.md
  section: "1 (contract/algorithm verbatim)", "2 (model facts; Status=8 values; ZERO new imports)",
           "3 (immutable pattern: rollupCompletion + updateItemStatus)", "4 (promoteIfAllComplete contrast)",
           "5 (placement: after cascadeCompleteDown)", "6 (test path tests/unit/core/ + fixtures + import block)",
           "7 (validation scripts + coverage floor 89/90/94/89)", "8 (14 edge cases to encode)",
           "9 (reference design for recomputeParentStatus + PROGRESSION/STATUS_RANK)"
  why: >
    Corrects the architecture note's wrong test path; gives the exact placement; the
    Record<Status,number> requirement; the locateChange + path-rebuild design; and a
    verified reference implementation of the min algorithm.

# MUST READ — the file being edited (read its style + the functions to NOT touch)
- file: src/utils/task-utils.ts
  why: >
    THE edit target. Backlog + Status already imported at top (NO new import). findItem
    (~90) = the nested-for-loop-with-early-return idiom to copy for locateChange.
    promoteIfAllComplete (~394, private, monotonic) + rollupCompletion (~424, private,
    monotonic) → DO NOT TOUCH but rollupCompletion is the closest structural analog
    (rebuilds ancestors). updateItemStatus (~461) = the path-only immutable rebuild
    idiom (containment check + nested .map()+spread along the path). cascadeCompleteDown
    (~immediately after updateItemStatus) = the INSERTION ANCHOR; insert
    recomputeAncestorsUp right after it. MATCHABLE_STATUSES/matchStatus follow.
  pattern: "function promoteIfAllComplete(children: { status: Status }[], current: Status): Status { const active = children.filter(c => c.status !== 'Obsolete'); … }"
  gotcha: recomputeParentStatus reuses the SAME `children: { status: Status }[]` param
          shape but returns the true MIN (not all-or-nothing) and Complete (not current)
          on all-obsolete.

# MUST READ — the model shapes (verify Status values + Backlog structure)
- file: src/core/models.ts
  why: >
    Status (line ~175) = 'Planned'|'Researching'|'Ready'|'Implementing'|'Retrying'|
    'Complete'|'Failed'|'Obsolete' (8 values → Record<Status,number> needs all 8 keys).
    Backlog = { readonly backlog: Phase[] }. Phase→milestones, Milestone→tasks,
    Task→subtasks, Subtask = leaf. All readonly.
  pattern: "export type Status = 'Planned'|'Researching'|'Ready'|'Implementing'|'Retrying'|'Complete'|'Failed'|'Obsolete';"

# PATTERN FILES — copy these conventions exactly
- file: tests/unit/core/task-utils.test.ts
  why: >
    THE test file to extend (NOT tests/unit/utils/ — does NOT exist; architecture §F2.E
    is wrong). Imports from '../../../src/utils/task-utils.js' (named + type HierarchyItem)
    — cascadeCompleteDown is ALREADY in the import block (sibling S1 landed); add
    recomputeAncestorsUp to that SAME block (additive). Fixture builders to REUSE:
    createTestSubtask(id,title,status,deps=[]), createTestTask(id,title,status,subtasks=[]),
    createTestMilestone(id,title,status,tasks=[]), createTestPhase(id,title,status,milestones=[]),
    createTestBacklog(phases). Style: nested describe('utils/task-utils', () => describe('<fn>', () => it(...)));
    Setup/Execute/Verify; expect(...).toBe/.toEqual.
  pattern: "import { …, cascadeCompleteDown, recomputeAncestorsUp, type HierarchyItem } from '../../../src/utils/task-utils.js';"
  gotcha: Add recomputeAncestorsUp to the EXISTING named import (one additive line). The
          import block is shared across all the P1.M2 subtasks — additive; if git flags a
          conflict it is a trivial text-resolution (keep all names).

# PARALLEL-SIBLING CONTRACT (assume implemented as-specified — do not duplicate)
- docfile: plan/012_7dd502f7feb9/P1M2T3S1/PRP.md
  why: >
    Sibling P1.M2.T3.S1 (cascadeCompleteDown) is ALREADY LANDED in the tree (verified:
    cascadeCompleteDown present in both src and the test import). It inserts ~after
    updateItemStatus; THIS item inserts immediately AFTER cascadeCompleteDown. The
    sibling PRP explicitly reserved this spot. Do NOT touch cascadeCompleteDown.
# CONSUMER (forward reference — do not implement)
- docfile: plan/012_7dd502f7feb9/architecture/implementation-status.md
  section: "F2.D — hack update CLI command (src/cli/index.ts)"
  why: >
    P1.M2.T4.S1 composes: locate target → set status → (if Complete)
    cascadeCompleteDown(item) → recomputeAncestorsUp(backlog, id). Confirms this helper
    must be pure + return a new immutable backlog (spliced back into the locked backlog).
```

### Current Codebase tree (relevant slice)

```bash
src/utils/task-utils.ts                # ← THE EDIT TARGET (add recomputeAncestorsUp + private helpers/consts after cascadeCompleteDown)
src/core/models.ts                     # CONSUME (read-only) — Status (8 values), Backlog/Phase/Milestone/Task/Subtask shapes
src/cli/index.ts                       # NOT IN SCOPE (consumer P1.M2.T4.S1 owns it)
tests/unit/core/task-utils.test.ts     # ← THE TEST FILE TO EXTEND (NOT tests/unit/utils/ — does not exist)
vitest.config.ts                       # READ-ONLY — coverage thresholds (89/90/94/89)
plan/012_7dd502f7feb9/architecture/implementation-status.md  # §F2.C (pin + do-not-touch) + §F2.D (consumer)
plan/012_7dd502f7feb9/P1M2T3S2/research/recompute-ancestors-facts.md  # THIS ITEM'S RESEARCH NOTE
```

### Desired Codebase tree with files to be added

```bash
# NO new files. Two existing files are edited additively:
src/utils/task-utils.ts              # + recomputeAncestorsUp (exported) + recomputeParentStatus/locateChange (private) + PROGRESSION/STATUS_RANK consts + Mode-A JSDoc; after cascadeCompleteDown
tests/unit/core/task-utils.test.ts   # + 'recomputeAncestorsUp' in the named import; + describe('recomputeAncestorsUp') block (~14 cases)
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — DO NOT TOUCH promoteIfAllComplete (~394) or rollupCompletion (~424).
//   They are module-PRIVATE, monotonic, promote-only, and load-bearing for the
//   orchestrator's automatic status writes. recomputeAncestorsUp is a SEPARATE,
//   EXPORTED, pure helper that computes a true MIN (and CAN downgrade) — strictly
//   richer, never aliased to the rollup. (architecture §F2.C.)

// CRITICAL — this is the UPWARD, min, CAN-DOWNGRADE recompute. It is DISTINCT from:
//   (a) cascadeCompleteDown (sibling S1) — the DOWNWARD force-Complete cascade; and
//   (b) rollupCompletion/promoteIfAllComplete — the monotonic promote-only rollup.
//   Computing a true min that demotes an ancestor when a child regresses is what
//   makes this richer than both. Do NOT implement it as "promote to Complete when
//   all children Complete" — that is the rollup, not the recompute.

// CRITICAL — Status has 8 values (Planned|Researching|Ready|Implementing|Retrying|
//   Complete|Failed|Obsolete). A `Record<Status, number>` MUST list all 8 keys or
//   tsc errors. Failed/Obsolete are EXCLUDED before the rank is consulted; give them
//   sentinel ranks (e.g. Number.POSITIVE_INFINITY) that are never read. Retrying =
//   Implementing-equiv (rank 3) and must map BACK to 'Implementing' (never propagate
//   'Retrying' up an ancestor). (research §2/§9.)

// CRITICAL — ZERO new imports. Backlog + Status are ALREADY imported at the top of
//   src/utils/task-utils.ts. Adding an import for either is a lint error (unused/
//   duplicate). (research §2.)

// CRITICAL — placement is merge-safe ONLY if you insert immediately AFTER
//   cascadeCompleteDown (NOT near matchStatus ~100 lines below, NOT inside the
//   private rollup block). The sibling S1 (cascadeCompleteDown) is already landed;
//   this item appends right after it. (research §5.)

// CRITICAL — the architecture note §F2.E names the WRONG test path
//   (`tests/unit/utils/task-utils.test.ts` does NOT exist). The real file is
//   `tests/unit/core/task-utils.test.ts`. Use tests/unit/core/. (research §6.)

// CRITICAL — recompute innermost-FIRST so a recomputed ancestor feeds its parent's
//   recompute. In the path-rebuild, build the new children array at each level
//   FIRST, then derive that level's parent status from the NEW children array.
//   (Otherwise a stale lower-ancestor status would skew the upper min.) See the
//   reference implementation in Implementation Patterns.

// GOTCHA — no-op cases MUST return the SAME backlog reference: (1) changedId not
//   found (locateChange returns null); (2) the changed item is a Phase (no ancestor
//   to recompute). These are the only guaranteed same-ref returns; the path-rebuild
//   cases return a new object (matching updateItemStatus). Tests pin the same-ref
//   behavior with `expect(result).toBe(backlog)`.

// GOTCHA — "deep clone / structural sharing" here means new objects only along the
//   ancestor path via spread (matching updateItemStatus). Non-path phases/milestones/
//   tasks are returned BY REFERENCE (===). The Subtask leaf is never copied by this
//   function (its status was already set by the caller). Do NOT hand-clone arrays
//   that aren't on the path. Pin structural sharing in a test (a sibling phase
//   unchanged by reference).

// GOTCHA — prettier owns formatting; run `npm run fix` then `npm run format:check`.
//   eslint (npm run lint) covers .ts only. Coverage is a REGRESSION FLOOR
//   (89/90/94/89), NOT 100% — but write thorough tests (the ~14 cases) so coverage
//   on the new lines is ~100% and the whole file stays well above the floor.

// GOTCHA — DOCS contract is Mode A (JSDoc only). Do NOT edit any docs/*.md. The
//   JSDoc MUST explicitly state the min algorithm, the ordering, the
//   Failed/Obsolete/Complete special handling, the Retrying→Implementing rule, that
//   it CAN DOWNGRADE, and the explicit distinction from the monotonic rollup.
```

---

## Implementation Blueprint

### Data models and structure

No new data models. The function consumes the existing `Backlog` (`src/core/models.ts`)
and the existing `Status` (8 values, already imported). A module-private
discriminated union `ChangeLocation` (by `level`) carries the ancestor path
indices; module-private consts `PROGRESSION` (ordered active statuses) and
`STATUS_RANK: Record<Status, number>` (min rank; Retrying=3; Failed/Obsolete sentinels)
encode the ordering.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: READ the target region of src/utils/task-utils.ts
  - READ: the top import block (Backlog + Status already imported → NO new import),
    findItem (~90, the nested-for-loop-with-early-return idiom for locateChange),
    promoteIfAllComplete (~394, private, the `children: {status:Status}[]` shape +
    Obsolete filter to mirror/contrast), rollupCompletion (~424, the ancestor-rebuild
    analog — DO NOT TOUCH), updateItemStatus (~461, the path-only immutable rebuild
    idiom), cascadeCompleteDown (the INSERTION ANCHOR — insert recomputeAncestorsUp
    immediately after it), MATCHABLE_STATUSES/matchStatus (the boundary ~100 lines below).
  - CONFIRM: Status has 8 values (models.ts) → Record<Status,number> needs all 8 keys.

Task 2: ADD the module-private helpers + consts to src/utils/task-utils.ts
        (immediately AFTER cascadeCompleteDown, BEFORE MATCHABLE_STATUSES)
  - ADD const PROGRESSION: readonly Status[] = ['Planned','Researching','Ready','Implementing','Complete'].
  - ADD const STATUS_RANK: Record<Status, number> = { Planned:0, Researching:1, Ready:2,
    Implementing:3, Retrying:3, Complete:4, Failed:Infinity, Obsolete:Infinity }.
  - ADD function recomputeParentStatus(children: {status:Status}[]): Status — the min
    algorithm (filter Obsolete; all-obsolete→Complete; all-failed→Failed; else min of
    non-failed non-obsolete by STATUS_RANK; map minRank→PROGRESSION[minRank]).
  - ADD (type | function) locateChange(backlog, id): ChangeLocation | null — nested
    for-loops w/ early return (mirror findItem) capturing phaseIndex/milestoneIndex/
    taskIndex + level. Discriminate by level: 'phase'|'milestone'|'task'|'subtask'.
  - DO NOT: export these (module-private, like promoteIfAllComplete); import anything;
    modify any existing function.

Task 3: ADD the exported recomputeAncestorsUp + Mode-A JSDoc (right after the helpers)
  - IMPLEMENT recomputeAncestorsUp(backlog: Backlog, changedId: string): Backlog:
      const loc = locateChange(backlog, changedId);
      if (!loc) return backlog;              // not found → no-op (same ref)
      if (loc.level === 'phase') return backlog; // phase has no ancestor → no-op (same ref)
      // else rebuild along the path per level (see Implementation Patterns reference).
  - JSDOC (Mode A): min algorithm + ordering + Failed/Obsolete/Complete/Retrying
    handling + CAN-DOWNGRADE + distinct-from-monotonic-rollup + @param/@returns/@example
    (downgrade scenario).
  - DO NOT: modify cascadeCompleteDown / promoteIfAllComplete / rollupCompletion /
    updateItemStatus / setItemStatus / findItem / matchStatus.

Task 4: ADD tests to tests/unit/core/task-utils.test.ts
  - EDIT the named import from '../../../src/utils/task-utils.js': add `recomputeAncestorsUp,`
    (additive — cascadeCompleteDown is already there).
  - APPEND a describe('recomputeAncestorsUp', () => { ... }) block (inside the top-level
    describe('utils/task-utils')). Reuse createTestSubtask/Task/Milestone/Phase/Backlog.
  - CASES (see reference test block below):
      1. PROMOTE: set last subtask Complete (caller pre-sets) → Task+Milestone+Phase → Complete.
      2. DOWNGRADE (headline): a Complete task whose subtask regressed to Planned → Task/Milestone/Phase drop.
      3. min across mixed: [Complete, Implementing] → Implementing.
      4. Failed all → parent Failed.
      5. Failed mixed (excluded) → [Failed, Planned] → Planned.
      6. Obsolete all → Complete.
      7. Obsolete+Complete → Complete.
      8. Obsolete+Planned → Planned.
      9. Retrying+Complete → Implementing; Retrying alone → Implementing (NOT Retrying).
     10. immutability: input deep-equal before/after; statuses unchanged.
     11. structural sharing: a sibling phase/milestone/task NOT on the path is === unchanged.
     12. no-op phase-level: recompute(backlog,'P1') === backlog (same ref).
     13. no-op not-found: recompute(backlog,'P9.M9.T9.S9') === backlog (same ref).
     14. per-level entry: change a Task → only Milestone+Phase move; change a Milestone → only Phase moves.
     15. idempotency: recompute(recompute(b,id),id) value-equal recompute(b,id).
  - NAMING: it('<scenario>') per case; expect(...).toBe/.toEqual for structure; toBe(backlog) for same-ref.

Task 5: FORMAT + VERIFY
  - RUN: npm run fix            (lint:fix + prettier --write)
  - RUN: npm run validate       (lint && format:check && typecheck && test:run) — MUST be GREEN
  - RUN: npx vitest run tests/unit/core/task-utils.test.ts   (targeted — the new describe passes)
  - RUN: npm run test:coverage  (optional — confirm src/utils/task-utils.ts well-covered; floor 89/90/94/89)
  - EXPECTED: all green; every pre-existing test (findItem/updateItemStatus/rollup/cascadeCompleteDown/
    matchStatus/normalizeTaskId/findItemByLooseId) still passes; coverage above floor.
```

### Implementation Patterns & Key Details

```ts
// ---- src/utils/task-utils.ts — INSERT immediately AFTER cascadeCompleteDown ----
// Helpers are module-private (like promoteIfAllComplete). ZERO new imports
// (Backlog + Status already imported at the top of the file).

/**
 * Ordered progression of active statuses, least-progressed first (PRD §5.4).
 * Retrying is excluded from the literal list (it's a transitional orchestrator
 * status); it is mapped to the Implementing rank inside {@link STATUS_RANK}.
 */
const PROGRESSION: readonly Status[] = [
  'Planned',
  'Researching',
  'Ready',
  'Implementing',
  'Complete',
];

/**
 * Numeric rank for the min-status computation (PRD §5.4). `Retrying` is an
 * internal transitional status (set by the retry manager, not manually settable)
 * and is treated as `Implementing`-equivalent (rank 3). `Failed` and `Obsolete`
 * are EXCLUDED by {@link recomputeParentStatus} before this map is consulted, so
 * their ranks are sentinels that are never read (Infinity = can never be the min,
 * a defensive choice in case the filtering ever changes).
 */
const STATUS_RANK: Record<Status, number> = {
  Planned: 0,
  Researching: 1,
  Ready: 2,
  Implementing: 3,
  Retrying: 3,
  Complete: 4,
  Failed: Number.POSITIVE_INFINITY,
  Obsolete: Number.POSITIVE_INFINITY,
};

/** Where the changed item lives, for the ancestor walk. */
type ChangeLocation =
  | { level: 'phase'; phaseIndex: number }
  | { level: 'milestone'; phaseIndex: number; milestoneIndex: number }
  | { level: 'task'; phaseIndex: number; milestoneIndex: number; taskIndex: number }
  | {
      level: 'subtask';
      phaseIndex: number;
      milestoneIndex: number;
      taskIndex: number;
    };

/**
 * Locate the changed item and its ancestor-path indices (mirrors {@link findItem}'s
 * nested-for-loop-with-early-return idiom). Returns null when the id is absent.
 */
function locateChange(backlog: Backlog, id: string): ChangeLocation | null {
  for (let pi = 0; pi < backlog.backlog.length; pi++) {
    const phase = backlog.backlog[pi];
    if (phase.id === id) return { level: 'phase', phaseIndex: pi };
    for (let mi = 0; mi < phase.milestones.length; mi++) {
      const milestone = phase.milestones[mi];
      if (milestone.id === id)
        return { level: 'milestone', phaseIndex: pi, milestoneIndex: mi };
      for (let ti = 0; ti < milestone.tasks.length; ti++) {
        const task = milestone.tasks[ti];
        if (task.id === id)
          return {
            level: 'task',
            phaseIndex: pi,
            milestoneIndex: mi,
            taskIndex: ti,
          };
        for (let si = 0; si < task.subtasks.length; si++) {
          if (task.subtasks[si].id === id)
            return {
              level: 'subtask',
              phaseIndex: pi,
              milestoneIndex: mi,
              taskIndex: ti,
            };
        }
      }
    }
  }
  return null;
}

/**
 * Recompute ONE parent's status as the minimum (least-progressed) of its children
 * (PRD §5.4). Obsolete is terminal (excluded; all-obsolete → Complete, losing the
 * tie to Complete); Failed is excluded unless ALL non-obsolete children are Failed
 * (→ Failed); otherwise the min of the remaining children, with Retrying treated
 * as Implementing-equivalent and mapped back to the canonical progression status.
 */
function recomputeParentStatus(children: { status: Status }[]): Status {
  const nonObsolete = children.filter(c => c.status !== 'Obsolete');
  if (nonObsolete.length === 0) return 'Complete';
  if (nonObsolete.every(c => c.status === 'Failed')) return 'Failed';
  const candidates = nonObsolete.filter(c => c.status !== 'Failed');
  let minRank = STATUS_RANK[candidates[0].status];
  for (let i = 1; i < candidates.length; i++) {
    const r = STATUS_RANK[candidates[i].status];
    if (r < minRank) minRank = r;
  }
  // Map the min rank back to the canonical progression status (Retrying→Implementing).
  return PROGRESSION[minRank];
}

/**
 * Recompute ancestor statuses bottom-up after a status change (PRD §5.4 "Ancestor recompute").
 *
 * @remarks
 * Walks UP from the changed item's position and recomputes each ancestor (Task →
 * Milestone → Phase) as the **minimum** (least-progressed) status among its
 * children. The changed item's own status is assumed already set (and, if it was
 * set to `Complete`, already cascaded down by {@link cascadeCompleteDown}) before
 * this runs — this function only recomputes the ANCESTORS above it.
 *
 * Status ordering (least → most progressed): `Planned(0) < Researching(1) <
 * Ready(2) < Implementing(3) < Complete(4)`. Special handling per PRD §5.4:
 *  - `Obsolete` children are terminal and EXCLUDED from the min; if ALL children
 *    are `Obsolete` the parent becomes `Complete` (Obsolete loses ties to Complete).
 *  - `Failed` children are EXCLUDED unless ALL non-obsolete children are `Failed`,
 *    in which case the parent becomes `Failed`.
 *  - Otherwise the parent = the min of the remaining (non-failed, non-obsolete)
 *    children. `Retrying` is treated as `Implementing`-equivalent and maps back to
 *    `Implementing` (it is never propagated up an ancestor).
 *
 * This CAN DOWNGRADE ancestors: resetting a subtask back to `Planned` drops its
 * Task/Milestone/Phase to reflect the least-progressed child. This is what makes
 * it **strictly richer than** the monotonic {@link rollupCompletion} /
 * {@link promoteIfAllComplete} (which only ever promote a parent toward `Complete`
 * when all children are already `Complete`, never compute a true minimum, and
 * never downgrade). It is also distinct from {@link cascadeCompleteDown} (the
 * downward force-`Complete` half of the §5.4 cascade). Do not use this in place of
 * the rollup for automatic status writes.
 *
 * Pure: the input backlog is never mutated; only nodes along the ancestor path are
 * copied (structural sharing — same deep-copy-on-path pattern as
 * {@link updateItemStatus} / {@link rollupCompletion}). A `changedId` that is not
 * found, or a Phase-level change (no ancestor), returns the SAME `backlog` reference.
 *
 * @param backlog - The backlog tree containing the changed item.
 * @param changedId - The canonical id of the item whose status just changed
 *   (e.g. `'P1.M1.T1.S1'`). Its own status is not recomputed here.
 * @returns A new `Backlog` with recomputed ancestor statuses (or the same reference
 *   for the no-op cases).
 *
 * @example
 * ```typescript
 * // DOWNGRADE: a Complete task whose first subtask is reset to Planned drops the
 * // whole ancestor chain (Task → Milestone → Phase) back to Planned.
 * const task = createTestTask('P1.M1.T1', 't', 'Complete', [
 *   createTestSubtask('P1.M1.T1.S1', 'a', 'Planned'), // just reset
 *   createTestSubtask('P1.M1.T1.S2', 'b', 'Complete'),
 * ]);
 * const backlog = createTestBacklog([
 *   createTestPhase('P1', 'p', 'Complete', [
 *     createTestMilestone('P1.M1', 'm', 'Complete', [task]),
 *   ]),
 * ]);
 * const out = recomputeAncestorsUp(backlog, 'P1.M1.T1.S1');
 * // out: Task/Milestone/Phase are now 'Planned' (min of [Planned, Complete]).
 * ```
 */
export function recomputeAncestorsUp(
  backlog: Backlog,
  changedId: string
): Backlog {
  const loc = locateChange(backlog, changedId);
  if (!loc) return backlog; // not found → no-op (same reference)
  if (loc.level === 'phase') return backlog; // a Phase has no ancestor to recompute

  if (loc.level === 'milestone') {
    // recompute only the containing Phase from its milestones
    return {
      ...backlog,
      backlog: backlog.backlog.map((phase, pi) =>
        pi === loc.phaseIndex
          ? { ...phase, status: recomputeParentStatus(phase.milestones) }
          : phase
      ),
    };
  }

  if (loc.level === 'task') {
    // recompute the containing Milestone (from tasks) then the Phase (from milestones)
    return {
      ...backlog,
      backlog: backlog.backlog.map((phase, pi) => {
        if (pi !== loc.phaseIndex) return phase;
        const newMilestones = phase.milestones.map((milestone, mi) =>
          mi === loc.milestoneIndex
            ? { ...milestone, status: recomputeParentStatus(milestone.tasks) }
            : milestone
        );
        return {
          ...phase,
          milestones: newMilestones,
          status: recomputeParentStatus(newMilestones),
        };
      }),
    };
  }

  // loc.level === 'subtask': recompute Task (from subtasks) → Milestone (from tasks) → Phase (from milestones)
  return {
    ...backlog,
    backlog: backlog.backlog.map((phase, pi) => {
      if (pi !== loc.phaseIndex) return phase;
      const newMilestones = phase.milestones.map((milestone, mi) => {
        if (mi !== loc.milestoneIndex) return milestone;
        const newTasks = milestone.tasks.map((task, ti) =>
          ti === loc.taskIndex
            ? { ...task, status: recomputeParentStatus(task.subtasks) }
            : task
        );
        return {
          ...milestone,
          tasks: newTasks,
          status: recomputeParentStatus(newTasks),
        };
      });
      return {
        ...phase,
        milestones: newMilestones,
        status: recomputeParentStatus(newMilestones),
      };
    }),
  };
}
```

```ts
// ---- tests/unit/core/task-utils.test.ts — reference test block ----
// Reuse the existing fixture builders. Add `recomputeAncestorsUp` to the named
// import from '../../../src/utils/task-utils.js' (cascadeCompleteDown is already there).

describe('recomputeAncestorsUp', () => {
  it('PROMOTES ancestors to Complete when the last subtask becomes Complete', () => {
    // Caller has already set S2 to Complete; ancestors were stale at Planned.
    const backlog = createTestBacklog([
      createTestPhase('P1', 'p', 'Planned', [
        createTestMilestone('P1.M1', 'm', 'Planned', [
          createTestTask('P1.M1.T1', 't', 'Planned', [
            createTestSubtask('P1.M1.T1.S1', 'a', 'Complete'),
            createTestSubtask('P1.M1.T1.S2', 'b', 'Complete'), // just completed
          ]),
        ]),
      ]),
    ]);
    const out = recomputeAncestorsUp(backlog, 'P1.M1.T1.S2');
    expect(findItem(out, 'P1.M1.T1')!.status).toBe('Complete');
    expect(findItem(out, 'P1.M1')!.status).toBe('Complete');
    expect(findItem(out, 'P1')!.status).toBe('Complete');
  });

  it('DOWNGRADES ancestors when a subtask regresses to Planned (headline feature)', () => {
    const backlog = createTestBacklog([
      createTestPhase('P1', 'p', 'Complete', [
        createTestMilestone('P1.M1', 'm', 'Complete', [
          createTestTask('P1.M1.T1', 't', 'Complete', [
            createTestSubtask('P1.M1.T1.S1', 'a', 'Planned'), // just reset
            createTestSubtask('P1.M1.T1.S2', 'b', 'Complete'),
          ]),
        ]),
      ]),
    ]);
    const out = recomputeAncestorsUp(backlog, 'P1.M1.T1.S1');
    expect(findItem(out, 'P1.M1.T1')!.status).toBe('Planned'); // min(Planned, Complete)
    expect(findItem(out, 'P1.M1')!.status).toBe('Planned');
    expect(findItem(out, 'P1')!.status).toBe('Planned');
  });

  it('computes the minimum across mixed children', () => {
    const backlog = createTestBacklog([
      createTestPhase('P1', 'p', 'Planned', [
        createTestMilestone('P1.M1', 'm', 'Planned', [
          createTestTask('P1.M1.T1', 't', 'Planned', [
            createTestSubtask('P1.M1.T1.S1', 'a', 'Complete'),
            createTestSubtask('P1.M1.T1.S2', 'b', 'Implementing'),
          ]),
        ]),
      ]),
    ]);
    const out = recomputeAncestorsUp(backlog, 'P1.M1.T1.S2');
    expect(findItem(out, 'P1.M1.T1')!.status).toBe('Implementing'); // least-progressed
  });

  it('returns Failed when ALL non-obsolete children are Failed', () => {
    const backlog = createTestBacklog([
      createTestPhase('P1', 'p', 'Planned', [
        createTestMilestone('P1.M1', 'm', 'Planned', [
          createTestTask('P1.M1.T1', 't', 'Planned', [
            createTestSubtask('P1.M1.T1.S1', 'a', 'Failed'),
            createTestSubtask('P1.M1.T1.S2', 'b', 'Failed'),
          ]),
        ]),
      ]),
    ]);
    const out = recomputeAncestorsUp(backlog, 'P1.M1.T1.S2');
    expect(findItem(out, 'P1.M1.T1')!.status).toBe('Failed');
  });

  it('excludes Failed when a non-failed sibling exists', () => {
    const backlog = createTestBacklog([
      createTestPhase('P1', 'p', 'Planned', [
        createTestMilestone('P1.M1', 'm', 'Planned', [
          createTestTask('P1.M1.T1', 't', 'Planned', [
            createTestSubtask('P1.M1.T1.S1', 'a', 'Failed'),
            createTestSubtask('P1.M1.T1.S2', 'b', 'Planned'),
          ]),
        ]),
      }),
    ]);
    const out = recomputeAncestorsUp(backlog, 'P1.M1.T1.S1');
    expect(findItem(out, 'P1.M1.T1')!.status).toBe('Planned'); // Failed excluded
  });

  it('returns Complete when ALL children are Obsolete (Obsolete loses ties to Complete)', () => {
    const backlog = createTestBacklog([
      createTestPhase('P1', 'p', 'Planned', [
        createTestMilestone('P1.M1', 'm', 'Planned', [
          createTestTask('P1.M1.T1', 't', 'Planned', [
            createTestSubtask('P1.M1.T1.S1', 'a', 'Obsolete'),
            createTestSubtask('P1.M1.T1.S2', 'b', 'Obsolete'),
          ]),
        ]),
      }),
    ]);
    const out = recomputeAncestorsUp(backlog, 'P1.M1.T1.S1');
    expect(findItem(out, 'P1.M1.T1')!.status).toBe('Complete');
  });

  it('excludes Obsolete and takes the min of the rest (Obsolete+Complete → Complete)', () => {
    const backlog = createTestBacklog([
      createTestPhase('P1', 'p', 'Planned', [
        createTestMilestone('P1.M1', 'm', 'Planned', [
          createTestTask('P1.M1.T1', 't', 'Planned', [
            createTestSubtask('P1.M1.T1.S1', 'a', 'Obsolete'),
            createTestSubtask('P1.M1.T1.S2', 'b', 'Complete'),
          ]),
        ]),
      }),
    ]);
    expect(
      findItem(recomputeAncestorsUp(backlog, 'P1.M1.T1.S1'), 'P1.M1.T1')!.status
    ).toBe('Complete');
  });

  it('excludes Obsolete and takes the min of the rest (Obsolete+Planned → Planned)', () => {
    const backlog = createTestBacklog([
      createTestPhase('P1', 'p', 'Complete', [
        createTestMilestone('P1.M1', 'm', 'Complete', [
          createTestTask('P1.M1.T1', 't', 'Complete', [
            createTestSubtask('P1.M1.T1.S1', 'a', 'Obsolete'),
            createTestSubtask('P1.M1.T1.S2', 'b', 'Planned'),
          ]),
        ]),
      }),
    ]);
    expect(
      findItem(recomputeAncestorsUp(backlog, 'P1.M1.T1.S2'), 'P1.M1.T1')!.status
    ).toBe('Planned');
  });

  it('treats Retrying as Implementing-equivalent (and never propagates Retrying up)', () => {
    const withComplete = createTestBacklog([
      createTestPhase('P1', 'p', 'Planned', [
        createTestMilestone('P1.M1', 'm', 'Planned', [
          createTestTask('P1.M1.T1', 't', 'Planned', [
            createTestSubtask('P1.M1.T1.S1', 'a', 'Retrying'),
            createTestSubtask('P1.M1.T1.S2', 'b', 'Complete'),
          ]),
        ]),
      }),
    ]);
    expect(
      findItem(recomputeAncestorsUp(withComplete, 'P1.M1.T1.S1'), 'P1.M1.T1')!
        .status
    ).toBe('Implementing'); // Retrying(3) < Complete(4)

    const onlyRetrying = createTestBacklog([
      createTestPhase('P1', 'p', 'Planned', [
        createTestMilestone('P1.M1', 'm', 'Planned', [
          createTestTask('P1.M1.T1', 't', 'Planned', [
            createTestSubtask('P1.M1.T1.S1', 'a', 'Retrying'),
          ]),
        ]),
      }),
    ]);
    expect(
      findItem(recomputeAncestorsUp(onlyRetrying, 'P1.M1.T1.S1'), 'P1.M1.T1')!
        .status
    ).toBe('Implementing'); // canonical status, NOT 'Retrying'
  });

  it('does NOT mutate the input backlog (immutability)', () => {
    const backlog = createTestBacklog([
      createTestPhase('P1', 'p', 'Complete', [
        createTestMilestone('P1.M1', 'm', 'Complete', [
          createTestTask('P1.M1.T1', 't', 'Complete', [
            createTestSubtask('P1.M1.T1.S1', 'a', 'Planned'),
            createTestSubtask('P1.M1.T1.S2', 'b', 'Complete'),
          ]),
        ]),
      }),
    ]);
    const snapshot = JSON.parse(JSON.stringify(backlog));
    recomputeAncestorsUp(backlog, 'P1.M1.T1.S1');
    expect(JSON.parse(JSON.stringify(backlog))).toEqual(snapshot); // unchanged
  });

  it('shares non-path nodes by reference (structural sharing)', () => {
    const otherPhase = createTestPhase('P2', 'other', 'Complete', [
      createTestMilestone('P2.M1', 'm', 'Complete', [
        createTestTask('P2.M1.T1', 't', 'Complete', [
          createTestSubtask('P2.M1.T1.S1', 'a', 'Complete'),
        ]),
      }),
    ]);
    const backlog = createTestBacklog([
      createTestPhase('P1', 'p', 'Complete', [
        createTestMilestone('P1.M1', 'm', 'Complete', [
          createTestTask('P1.M1.T1', 't', 'Complete', [
            createTestSubtask('P1.M1.T1.S1', 'a', 'Planned'),
            createTestSubtask('P1.M1.T1.S2', 'b', 'Complete'),
          ]),
        ]),
      ]),
      otherPhase,
    ]);
    const out = recomputeAncestorsUp(backlog, 'P1.M1.T1.S1');
    expect(out.backlog[1]).toBe(otherPhase); // sibling phase untouched by reference
  });

  it('is a no-op (same reference) for a Phase-level change (no ancestor)', () => {
    const backlog = createTestBacklog([
      createTestPhase('P1', 'p', 'Planned', [
        createTestMilestone('P1.M1', 'm', 'Planned', []),
      ]),
    ]);
    expect(recomputeAncestorsUp(backlog, 'P1')).toBe(backlog); // same ref
  });

  it('is a no-op (same reference) when changedId is not found', () => {
    const backlog = createTestBacklog([
      createTestPhase('P1', 'p', 'Planned', [
        createTestMilestone('P1.M1', 'm', 'Planned', []),
      ]),
    ]);
    expect(recomputeAncestorsUp(backlog, 'P9.M9.T9.S9')).toBe(backlog); // same ref
  });

  it('recomputes only the correct ancestors per entry level', () => {
    // Task-level change → Milestone + Phase recompute (Task itself unchanged)
    const backlog = createTestBacklog([
      createTestPhase('P1', 'p', 'Complete', [
        createTestMilestone('P1.M1', 'm', 'Complete', [
          createTestTask('P1.M1.T1', 't', 'Planned', [
            createTestSubtask('P1.M1.T1.S1', 'a', 'Planned'),
          ]),
        ]),
      ]),
    ]);
    const out = recomputeAncestorsUp(backlog, 'P1.M1.T1');
    expect(findItem(out, 'P1.M1.T1')!.status).toBe('Planned'); // unchanged (it IS the changed item)
    expect(findItem(out, 'P1.M1')!.status).toBe('Planned'); // recomputed from tasks
    expect(findItem(out, 'P1')!.status).toBe('Planned'); // recomputed from milestones
  });

  it('is idempotent (recompute twice → value-equal)', () => {
    const backlog = createTestBacklog([
      createTestPhase('P1', 'p', 'Complete', [
        createTestMilestone('P1.M1', 'm', 'Complete', [
          createTestTask('P1.M1.T1', 't', 'Complete', [
            createTestSubtask('P1.M1.T1.S1', 'a', 'Planned'),
            createTestSubtask('P1.M1.T1.S2', 'b', 'Complete'),
          ]),
        ]),
      ]),
    ]);
    const once = recomputeAncestorsUp(backlog, 'P1.M1.T1.S1');
    const twice = recomputeAncestorsUp(once, 'P1.M1.T1.S1');
    expect(twice).toEqual(once);
  });
});
```

### Integration Points

```yaml
SOURCE (src/utils/task-utils.ts — additive only):
  - + const PROGRESSION + const STATUS_RANK + type ChangeLocation  (module-private)
  - + function locateChange + function recomputeParentStatus       (module-private)
  - + export function recomputeAncestorsUp(backlog, changedId): Backlog  (after cascadeCompleteDown)
  - + Mode-A JSDoc (min algorithm + ordering + Failed/Obsolete/Complete/Retrying + CAN-DOWNGRADE + distinct-from-monotonic-rollup)
  - NO import change (Backlog + Status already imported at top)
  - NO change to promoteIfAllComplete / rollupCompletion / updateItemStatus / setItemStatus
    / cascadeCompleteDown / findItem / normalizeTaskId / findItemByLooseId / matchStatus

TESTS (tests/unit/core/task-utils.test.ts — additive only):
  - + 'recomputeAncestorsUp' in the named import from '../../../src/utils/task-utils.js'
  - + describe('recomputeAncestorsUp', ...) block (~15 cases: promote/downgrade/min/failed×2/
    obsolete×3/retrying/immutability/structural-sharing/no-op×2/per-level/idempotency)
  - reuse existing fixtures: createTestSubtask/Task/Milestone/Phase/Backlog + findItem (for assertions)

NO CHANGES TO (hard boundary):
  - the hack update CLI handler (P1.M2.T4.S1), cascadeCompleteDown (sibling S1, landed)
  - any docs/*.md (DOCS = Mode A: JSDoc only)
  - src/core/models.ts, src/cli/*, PRD.md, plan/**, tasks.json, package.json, vitest.config.ts
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
# Type errors would arise from: a misspelled Record key (Status has 8 values — all must be
# listed), a missing `return` branch in recomputeAncestorsUp (the `loc.level === 'subtask'`
# fall-through must be the final return), or narrowing issues in locateChange. The reference
# implementation handles all of these.
```

### Level 2: Unit Tests (Component Validation)

```bash
# The new suite (must pass):
npx vitest run tests/unit/core/task-utils.test.ts

# Expected: all green, INCLUDING the new describe('recomputeAncestorsUp') AND ALL
# pre-existing tests (findItem/updateItemStatus/rollup/cascadeCompleteDown/matchStatus/
# normalizeTaskId/findItemByLooseId). A failure in a pre-existing test means the new code
# accidentally mutated shared state or touched another function — re-read the do-not-touch
# boundary and the immutability/structural-sharing notes.
```

### Level 3: Integration / Regression (System Validation)

```bash
# Full gate — MUST stay green. Proves:
#  (1) recomputeAncestorsUp passes (promote + DOWNGRADE + all special cases + immutability
#      + structural sharing + no-op same-ref + per-level + idempotency);
#  (2) the additive edit did NOT regress any other test (esp. the rollup/cascade suites);
#  (3) coverage stays above the regression floor (89/90/94/89).
npm run validate         # = lint && format:check && typecheck && test:run
npm run test:coverage    # optional: confirm src/utils/task-utils.ts is well-covered
#                          (the function + helpers are small + fully exercised → ~100% on their lines)

# Build emits dist/ cleanly (proves the edit compiles via tsc):
npx tsc -p tsconfig.build.json

# Expected: full suite green; coverage above floor; build succeeds.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# No I/O / network / DB / CLI in this subtask — a pure tree transform.
# Domain-specific reasoning (record in commit message):
#   1. Direction + richness correctness (PRD §5.4): recomputeAncestorsUp is the UPWARD
#      MIN recompute (child→ancestors) that CAN DOWNGRADE — distinct from the downward
#      cascadeCompleteDown AND from the monotonic rollup. It computes a true minimum,
#      not all-or-nothing.
#   2. Special-case correctness: Obsolete loses ties to Complete (all-obsolete→Complete;
#      otherwise excluded); Failed wins only when ALL non-obsolete are Failed; Retrying
#      ≡ Implementing and maps back to Implementing (never propagated up).
#   3. Innermost-first threading: a recomputed lower ancestor feeds its parent's recompute
#      (the new-children-array-then-derive-status structure guarantees this).
#   4. Immutability + structural sharing: input never mutated; only ancestor-path nodes
#      copied; non-path nodes shared by reference; no-op cases return the SAME reference.
#   5. Boundary discipline: promoteIfAllComplete/rollupCompletion are untouched and still
#      module-private; cascadeCompleteDown untouched; the orchestrator's automatic status
#      writes are unaffected.
#   6. Consumer-ready: returns a pure new Backlog for P1.M2.T4.S1 to splice back into the
#      locked backlog (no side effects, no locking, no tasks.json).
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

- [ ] Recomputes the FULL ancestor chain (Task→Milestone→Phase) for a subtask change.
- [ ] Computes the true **minimum** (not all-or-nothing); **CAN DOWNGRADE** (regression test passes).
- [ ] Obsolete: all-Obsolete→Complete; loses ties to Complete; excluded from min otherwise.
- [ ] Failed: all-failed→Failed; excluded from min when a non-failed sibling exists.
- [ ] Retrying→Implementing-equivalent; maps back to `Implementing`, never `Retrying`.
- [ ] Input never mutated; only ancestor-path nodes copied (structural sharing test passes).
- [ ] No-op cases (phase-level / not-found) return the SAME `backlog` reference.
- [ ] Per-level entry correct (Task→Milestone+Phase; Milestone→Phase only).
- [ ] Idempotent (recompute twice → value-equal).
- [ ] JSDoc documents the algorithm, ordering, special handling, downgrade, and the
      explicit distinction from the monotonic `rollupCompletion`/`promoteIfAllComplete`.

### Code Quality Validation

- [ ] Mirrors the immutable path-rebuild idiom (`updateItemStatus`) + the ancestor-recompute
      structure (`rollupCompletion`); module-private helpers (like `promoteIfAllComplete`).
- [ ] `Record<Status, number>` lists all 8 Status keys (sentinels for Failed/Obsolete).
- [ ] ZERO new imports (Backlog + Status already imported at top).
- [ ] Placed immediately after `cascadeCompleteDown` — merge-safe vs. `matchStatus` (~100 lines below).
- [ ] Additive only — no existing function modified; no `docs/*.md` edited (Mode A: JSDoc).
- [ ] Tests reuse existing fixture builders + `findItem` (for assertions); placed in
      `tests/unit/core/` (NOT `utils/`).

### Documentation & Deployment

- [ ] Mode-A JSDoc present on `recomputeAncestorsUp` (min algorithm + ordering + special
      handling + CAN-DOWNGRADE + distinct-from-monotonic-rollup + @param/@returns/@example
      showing a downgrade).
- [ ] Commit message notes: the §5.4 upward-min-recompute contract; the merge-safe
      placement (after cascadeCompleteDown); the do-not-touch boundary; the
      innermost-first threading; that this is the upward half consumed by P1.M2.T4.S1
      (with `cascadeCompleteDown` as the downward sibling S1).

---

## Anti-Patterns to Avoid

- ❌ Don't modify `promoteIfAllComplete` (~394) or `rollupCompletion` (~424) — they are
  module-private, monotonic, promote-only, and load-bearing for the orchestrator's
  automatic status writes. `recomputeAncestorsUp` is a SEPARATE exported helper that is
  **strictly richer** (true min + downgrade). (architecture §F2.C.)
- ❌ Don't conflate the three — this is the UPWARD MIN recompute (child→ancestors, CAN
  DOWNGRADE), NOT the downward force-`Complete` cascade (`cascadeCompleteDown`, sibling
  S1) and NOT the monotonic promote-only rollup. Computing a true min that demotes an
  ancestor ≠ promoting a parent when all children are done.
- ❌ Don't implement "parent = Complete when all children Complete" — that is the
  **rollup**, not the **recompute**. The recompute computes the MINIMUM and can return
  any progression status (Planned/Researching/Ready/Implementing/Complete) or Failed.
- ❌ Don't forget any `Status` key in `STATUS_RANK` — `Status` has 8 values
  (Planned/Researching/Ready/Implementing/Retrying/Complete/Failed/Obsolete); a
  `Record<Status, number>` missing any key is a tsc error. (research §2.)
- ❌ Don't propagate `Retrying` up an ancestor — map it back to `Implementing`
  (`PROGRESSION[3]`). `Retrying` is an internal transitional status set by the retry
  manager; an ancestor must never report `Retrying`. (research §1/§9.)
- ❌ Don't thread a STALE lower-ancestor status into an upper recompute — build each
  level's NEW children array FIRST, then derive that level's parent status from the NEW
  array. (Implementation Patterns reference guarantees this.)
- ❌ Don't mutate the input — return a new backlog; only copy ancestor-path nodes
  (structural sharing). Non-path nodes are shared by reference. The immutability +
  structural-sharing + same-ref-no-op tests pin this; mutating shared nodes would
  corrupt the locked backlog at the P1.M2.T4.S1 call site.
- ❌ Don't hand-clone arrays off the path — spread along the path only, matching
  `updateItemStatus`/`rollupCompletion`.
- ❌ Don't add imports for `Backlog` or `Status` — both are ALREADY imported at the top of
  `src/utils/task-utils.ts`. Adding either is a lint error.
- ❌ Don't place the function near `matchStatus` (~100 lines below `cascadeCompleteDown`) —
  insert immediately AFTER `cascadeCompleteDown` to stay merge-safe and keep the cascade
  engine together. (research §5.)
- ❌ Don't put tests in `tests/unit/utils/` — that path does NOT exist (architecture §F2.E
  is wrong). The real file is `tests/unit/core/task-utils.test.ts`.
- ❌ Don't implement the `hack update` CLI handler (P1.M2.T4.S1) or modify
  `cascadeCompleteDown` (sibling S1, landed) — out of scope.
- ❌ Don't edit any `docs/*.md` — the DOCS contract is Mode A (JSDoc only).
- ❌ Don't skip the DOWNGRADE test — it is the proof that `recomputeAncestorsUp` is
  distinct from the monotonic rollup (which can NEVER demote an ancestor). Likewise don't
  skip the all-Obsolete→Complete and Retrying→Implementing tests — they pin the special
  handling that a naive min would get wrong.

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: This is a single, small (~80-line including helpers), pure, additive
function set with an exact contract (signature + per-ancestor min algorithm + status
ordering + Failed/Obsolete/Complete/Retrying handling) supplied verbatim by the work
item and cross-checked against `src/core/models.ts` (Status = 8 values) and the
architecture pin §F2.C. The immutable path-rebuild idiom is copied from the file's own
`updateItemStatus`, and the ancestor-recompute structure mirrors `rollupCompletion`
(both read-only references). Zero new imports are needed (Backlog + Status already
imported). The do-not-touch boundary (the two private monotonic helpers +
`cascadeCompleteDown`) is explicit, and the insertion point (immediately after
`cascadeCompleteDown`, already landed) is textually disjoint from `matchStatus` (~100
lines below), so the merge is clean. The only test-path risk — the architecture note's
wrong `tests/unit/utils/` path — is corrected here to `tests/unit/core/` with the exact
import line and fixture builders named. The reference implementation (helpers +
`recomputeAncestorsUp` + the per-level rebuild) and a ~15-case reference test block are
written out verbatim, including the discriminating DOWNGRADE / all-Obsolete→Complete /
Retrying→Implementing cases. The residual risk is a minor prettier/tsc nit (e.g. a
missing Record key or a consistent-return branch), which `npm run fix` + `tsc` +
the Level 1 gates catch and resolve. Coverage is a regression floor (89/90/94/89),
comfortably met by the thorough test block. Validation is the project's standard
`npm run validate` gate.