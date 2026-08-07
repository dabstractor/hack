# PRP — P1.M2.T1.S1: `normalizeTaskId` + `findItemByLooseId` in `src/utils/task-utils.ts`

> PRD §5.4 **"Loose task-ID matching."** Two new pure exported functions that let `hack update`
> accept any of `P1.M1.T1.S1` / `p1m1t1s1` / `1.1.1.1` / `1.2` / `1` and resolve them positionally
> to the canonical item + its real `.id`. `normalizeTaskId` extracts digit sequences (regex,
> cap 4); `findItemByLooseId` walks the tree 1-based. **Additive only — `findItem` is NOT modified.**
> Consumed by P1.M2.T4.S1 (the `hack update` handler). Architecture pin: `implementation-status.md §F2.A`.

---

## Goal

**Feature Goal**: Implement PRD §5.4 "Loose task-ID matching" as two pure, exported functions in
`src/utils/task-utils.ts`:
1. `normalizeTaskId(looseId: string): number[] | null` — regex-extract digit sequences, cap at 4
   (Phase.Milestone.Task.Subtask); null for no-digits / >4.
2. `findItemByLooseId(backlog, looseId): { item: HierarchyItem; canonicalId: string } | null` —
   normalize, then walk the tree positionally (1-based); trailing segments may be omitted;
   out-of-bounds → null; `canonicalId` is the found item's real `.id`.

**Deliverable**:
1. **`src/utils/task-utils.ts`** — EDIT (additive): add the two exported functions (with Mode-A
   JSDoc) alongside the existing `findItem`. No other function touched.
2. **`tests/unit/core/task-utils.test.ts`** — EDIT (additive): add `normalizeTaskId` +
   `findItemByLooseId` to the import; append two `describe` blocks (inside the top-level
   `describe('utils/task-utils', …)`) covering all branches + the PRD §5.4 equivalence examples.

**Success Definition**:
- `normalizeTaskId('P1.M1.T1.S1')` === `normalizeTaskId('p1m1t1s1')` === `normalizeTaskId('1.1.1.1')`
  === `[1,1,1,1]`; `'1.2'` → `[1,2]`; `'1'` → `[1]`; `''`/`'foo'`/`'1.2.3.4.5'` → `null`.
- `findItemByLooseId(backlog, '1.1.1.1')`, `findItemByLooseId(backlog, 'p1m1t1s1')`, and
  `findItemByLooseId(backlog, 'P1.M1.T1.S1')` all return `{ item, canonicalId: 'P1.M1.T1.S1' }`
  with `item.type === 'Subtask'`.
- `findItemByLooseId(backlog, '1')` → phase; `'1.2'` → milestone; `'1.2.3'` → task (trailing
  omission). `'9.9.9.9'` / `'1.3'` (out-of-bounds) / `''` → `null`.
- `findItem` is UNCHANGED; all existing `task-utils.test.ts` tests stay GREEN.
- `npm run typecheck && npm run lint && npm run format:check` clean; `task-utils.test.ts` GREEN;
  `src/utils/task-utils.ts` at 100% coverage.

---

## Why

- **Enables PRD §5.4 `hack update`.** The command must accept the same loose forms the spec lists
  (`hack update p1m1t1s1 re`, `hack update 1.2 done`, `hack update 2 comp`). P1.M2.T4.S1 (the CLI
  handler) calls `findItemByLooseId` to resolve `<task-id>` and uses the returned `canonicalId` for
  the `Updated <ID> status to <Status>` output. S1 provides the resolver; T4 wires it.
- **Pure + reusable.** Both functions are pure (no I/O, no mutation). `normalizeTaskId` is independently
  testable and reusable; `findItemByLooseId` composes it. Separating normalize from lookup keeps each
  trivial to reason about and 100%-coverable.
- **Positional, not string-rebuild.** `canonicalId` is read from the ACTUAL item's `.id`, so the
  output always matches whatever the architect emitted (e.g. `'P1.M1.T1.S1'`), never a reconstructed
  guess. This is robust to future id-format changes.
- **Additive + merge-safe.** S1 only APPENDS two exports; it does not edit `findItem` or any existing
  function. Sibling P1.M2 subtasks (`matchStatus` T2, cascade T3) add their OWN functions to the same
  file but are sequenced after S1, so there is no overlap. File-disjoint from the parallel P1.M1.T4.S1
  (`git-commit.ts`).
- **Out of scope (hard boundary):** the loose STATUS matcher `matchStatus` (P1.M2.T2.S1), the cascade
  engine (P1.M2.T3.S1/S2), the `hack update` CLI handler (P1.M2.T4.S1), modifying `findItem`, any
  `docs/*.md` (DOCS: Mode A — JSDoc only), and the Backlog/Phase/Milestone/Task/Subtask types.

---

## What

### User-visible behavior
None directly (internal utilities). Indirectly, via P1.M2.T4.S1: `hack update` will accept the loose
ID forms. S1 only ships the resolver + its tests.

### Technical requirements (exact contract)

**`src/utils/task-utils.ts`** — add two exported functions (place near `findItem`, ~line 110, or at a
logical grouping). Verbatim implementations:

```ts
/**
 * Normalize a loose task-ID string into a numeric segment array (PRD §5.4).
 *
 * @remarks
 * Extracts every digit sequence via `/\d+/g` and maps each to a number, so all of
 * the following are equivalent: `P1.M1.T1.S1`, `p1m1t1s1`, `1.1.1.1` → `[1,1,1,1]`;
 * `1.2` → `[1,2]`; `1` → `[1]`. The `P`/`M`/`T`/`S` letters are NOT required.
 * Segments map positionally Phase → Milestone → Task → Subtask. Returns `null` when
 * there are no digit sequences (empty/whitespace/no-digits) or more than 4 segments
 * (the hierarchy is at most 4 deep). Note: `'0'` normalizes to `[0]` (syntactically
 * valid) — it is rejected later by {@link findItemByLooseId}'s 1-based positional
 * lookup, not here.
 *
 * @param looseId - The raw task-ID string from the CLI.
 * @returns The numeric segments (1–4 numbers), or `null` if unparseable / too deep.
 *
 * @example
 * normalizeTaskId('P1.M1.T1.S1'); // [1,1,1,1]
 * normalizeTaskId('p1m1t1s1');    // [1,1,1,1]
 * normalizeTaskId('1.1.1.1');     // [1,1,1,1]
 * normalizeTaskId('1.2');         // [1,2]
 * normalizeTaskId('1');           // [1]
 * normalizeTaskId('');            // null
 * normalizeTaskId('1.2.3.4.5');   // null (>4 segments)
 */
export function normalizeTaskId(looseId: string): number[] | null {
  const nums = looseId.match(/\d+/g);
  if (!nums) return null;
  if (nums.length > 4) return null;
  return nums.map(Number);
}

/**
 * Find a hierarchy item by a loose task-ID, walking the tree positionally (PRD §5.4).
 *
 * @remarks
 * Normalizes `looseId` via {@link normalizeTaskId}, then walks 1-BASED:
 * `segments[0]` → `backlog.backlog[segments[0]-1]` (phase), `segments[1]` →
 * `phase.milestones[segments[1]-1]` (milestone), `segments[2]` →
 * `milestone.tasks[segments[2]-1]` (task), `segments[3]` → `task.subtasks[segments[3]-1]`
 * (subtask). Trailing segments may be omitted (fewer segments = higher-level item), so
 * `1`, `1.2`, `1.2.3`, `1.2.3.4` target a Phase, Milestone, Task, Subtask respectively.
 * Out-of-bounds at any level → `null`. The returned `canonicalId` is the found item's
 * ACTUAL `id` field (e.g. `'P1.M1.T1.S1'`), not a reconstructed string.
 *
 * @param backlog - The backlog tree to search.
 * @param looseId - The loose task-ID (any form {@link normalizeTaskId} accepts).
 * @returns The found item + its canonical id, or `null` if not found / unparseable.
 *
 * @example
 * findItemByLooseId(backlog, '1.1.1.1');   // { item: <Subtask P1.M1.T1.S1>, canonicalId: 'P1.M1.T1.S1' }
 * findItemByLooseId(backlog, 'p1m1t1s1');  // same item (case/punctuation-insensitive)
 * findItemByLooseId(backlog, '1.2');       // { item: <Milestone P1.M2>, canonicalId: 'P1.M2' }
 * findItemByLooseId(backlog, '1');         // { item: <Phase P1>, canonicalId: 'P1' }
 * findItemByLooseId(backlog, '9.9.9.9');   // null (out of bounds)
 */
export function findItemByLooseId(
  backlog: Backlog,
  looseId: string
): { item: HierarchyItem; canonicalId: string } | null {
  const segments = normalizeTaskId(looseId);
  if (!segments) return null;

  const phase = backlog.backlog[segments[0] - 1];
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

**`tests/unit/core/task-utils.test.ts`** — additive tests (see Implementation Tasks). Add
`normalizeTaskId, findItemByLooseId` to the existing named import; reuse the module-scope
`createComplexBacklog()` fixture.

### Success Criteria
- [ ] `normalizeTaskId` + `findItemByLooseId` exported from `src/utils/task-utils.ts`.
- [ ] All PRD §5.4 equivalence examples hold (see Goal).
- [ ] `findItem` UNCHANGED; no existing function edited.
- [ ] Out-of-bounds / unparseable → `null`; `canonicalId` is the item's real `.id`.
- [ ] JSDoc (Mode A) on both functions documents the algorithm + 1-based mapping + trailing omission + `@example`.
- [ ] `npm run typecheck && npm run lint && npm run format:check` clean; `task-utils.test.ts` GREEN;
      `src/utils/task-utils.ts` 100% covered.

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_ **Yes** — verbatim
implementations of both functions, the regex-semantics gotcha (`match` never returns `[]`), the `'0'`-segment
note, the exact `createComplexBacklog()` tree (every id at every level) with the verified 1-based positional
map, the test import path (`tests/unit/core/`, NOT `utils/`), the assertion style to mirror, the
do-not-modify-`findItem` rule, the scope boundaries vs sibling P1.M2 subtasks + the parallel P1.M1.T4.S1,
and the executable validation commands. See `research/loose-task-id-matcher.md` for the grep evidence.

### Documentation & References
```yaml
# AUTHORITATIVE SPEC — the architecture pin for this exact task
- docfile: plan/012_7dd502f7feb9/architecture/implementation-status.md
  section: "F2.A — Loose task-ID normalizer & matcher (src/utils/task-utils.ts)"
  why: Pins both function contracts verbatim + "Do NOT modify findItem" + the verified examples.
  critical: normalizeTaskId's algorithm is regex `/\d+/g` + cap-at-4 (NOT split-on-dot); canonicalId
        comes from the item's real .id, not a rebuild.

# AUTHORITATIVE SPEC — the PRD text
- docfile: PRD.md   # (provided in selected_prd_content §5.4 "Loose task-ID matching")
  section: §5.4 "Loose task-ID matching" + the `hack update` examples block
  why: Defines the equivalence set (P1.M1.T1.S1 / p1.m1.t1.s1 / p1m1t1s1 / 1.1.1.1 / 1.2 / 1) and the
        positional Phase→Milestone→Task→Subtask mapping with trailing-segment omission.

# CONSUMER (read the CONTRACT, do NOT implement it) — P1.M2.T4.S1
- file: plan/012_7dd502f7feb9/tasks.json   # (or the T4.S1 PRP when it exists)
  why: T4.S1 (hack update handler in src/cli/index.ts) calls findItemByLooseId(backlog, argv.taskId)
        and uses result.canonicalId for the `Updated <ID> …` output + result.item for the cascade.
        S1 provides the resolver; S1 MUST NOT touch src/cli/index.ts.

# PATTERN FILE — the file being edited (read it; place the new exports near findItem)
- file: src/utils/task-utils.ts
  why: EDIT (additive). HierarchyItem union@47; findItem@90 (exact-id DFS — DO NOT MODIFY). All needed
        types (Backlog/Phase/Milestone/Task/Subtask) already imported (20-26). findItem's traversal
        confirms the children fields: backlog.backlog / phase.milestones / milestone.tasks / task.subtasks.
  pattern: "export function findItem(backlog: Backlog, id: string): HierarchyItem | null { for (const phase of backlog.backlog) { if (phase.id === id) return phase; for (const milestone of phase.milestones) { … } } }"
  gotcha: Do NOT modify findItem. The new matcher is separate (loose/positional vs exact/string).

# DATA SHAPES (read-only — confirmed by findItem + models.ts)
- file: src/core/models.ts
  why: Phase.id@650 + milestones@677; Milestone.id@548 + tasks@575; Task.id@444 + subtasks@472;
        Subtask.id@280 (leaf — no children); Backlog.backlog@768. All readonly. findItemByLooseId
        reads .id + the children arrays only.

# TEST PATTERN — the file being extended (NOTE the path: tests/unit/CORE/, not utils/)
- file: tests/unit/core/task-utils.test.ts
  why: EDIT (additive). Import path '../../../src/utils/task-utils.js' (12-20). Module-scope fixture
        createComplexBacklog() (~92-170) builds the verified 2-phase tree (see research §4 for the full
        id map). createTestSubtask/Task/Milestone/Phase builders. Top-level describe('utils/task-utils')@172.
  pattern: "const result = findItem(backlog, 'P1.M1.T1.S1'); expect(result).not.toBeNull(); expect(result?.id).toBe('P1.M1.T1.S1'); expect(result?.type).toBe('Subtask');"
  gotcha: createTestSubtask builds a Subtask WITHOUT prd_selectors — leave it (findItemByLooseId reads
        only .id/children; tests are excluded from tsc.build). APPEND new describes inside the top-level
        describe; do NOT edit the existing findItem/isSubtask describes.
```

### Current Codebase tree (relevant slice)
```bash
src/utils/task-utils.ts                     # EDIT (additive): +normalizeTaskId +findItemByLooseId (+JSDoc)
src/core/models.ts                          # READ-ONLY (Backlog/Phase/Milestone/Task/Subtask shapes)
src/cli/index.ts                            # UNCHANGED (P1.M2.T4.S1 consumes the resolver later)
tests/unit/core/task-utils.test.ts          # EDIT (additive): +imports +2 describe blocks (reuse createComplexBacklog)
```

### Desired Codebase tree with files to be added/edited
```bash
src/utils/task-utils.ts                     # MODIFIED (+2 exported functions + Mode-A JSDoc)
tests/unit/core/task-utils.test.ts          # MODIFIED (+imports +2 additive describe blocks)
# No new files. No docs/*.md (DOCS: Mode A — JSDoc only).
```

### Known Gotchas of our codebase & Library Quirks
```ts
// CRITICAL — Do NOT modify findItem. The new findItemByLooseId is a SEPARATE, looser/positional matcher.
//   findItem does exact-id DFS; findItemByLooseId does normalize-then-positional-walk. Both coexist.

// CRITICAL — normalizeTaskId uses looseId.match(/\d+/g), which returns null (no matches) or a NON-EMPTY
//   array — NEVER []. So `if (!nums) return null;` covers empty/whitespace/no-digits. Do NOT add a
//   `nums.length === 0` check (dead code; can trip lint/coverage). The >4 cap is `nums.length > 4`.

// CRITICAL — Do NOT reject '0' in normalizeTaskId. '0' → [0] is syntactically valid per the contract
//   (regex + cap-4 IS the spec). The 0 is rejected LATER by findItemByLooseId: backlog[0-1]=backlog[-1]
//   =undefined → null. Rejecting 0 in normalizeTaskId deviates from the contract.

// CRITICAL — canonicalId is the found item's REAL .id (e.g. 'P1.M1.T1.S1'), read straight off the item.
//   Do NOT reconstruct it from the segments (the architect's actual id is authoritative).

// GOTCHA — The early-return-per-level form (return at segments.length === 1/2/3, else fall through)
//   typechecks with NO `as` casts: each level's variable is already narrowed (phase: Phase, milestone:
//   Milestone, task: Task, subtask: Subtask), and all satisfy HierarchyItem. Avoid a mutating
//   `let item: HierarchyItem` + cast form — the early-return form is cleaner and cast-free.

// GOTCHA — The test file lives at tests/unit/CORE/task-utils.test.ts (NOT tests/unit/utils/). The source
//   is src/utils/task-utils.ts; the import path is '../../../src/utils/task-utils.js'. Mirror the existing
//   findItem describe's assertion style (not.toBeNull / ?.id / ?.type / toBeNull).

// GOTCHA — Reuse the module-scope createComplexBacklog() fixture for findItemByLooseId tests — it already
//   builds P1/P2 with milestones/tasks/subtasks at every level (see research §4 for the full id map).
//   Do NOT add prd_selectors to createTestSubtask (out of scope; existing tests don't have it).

// GOTCHA — 100% coverage globally enforced (vitest.config.ts). Every branch must be hit: normalizeTaskId
//   (no-digits → null, >4 → null, valid → number[]); findItemByLooseId (invalid looseId → null, phase/
//   milestone/task/subtask out-of-bounds → null ×4, and the 4 success returns). createComplexBacklog +
//   the out-of-bounds cases ('1.3', '9.9.9.9', '') cover all of them.

// GOTCHA — prettier is ERROR-enforced. Run `npm run fix` before format:check (the JSDoc @example fences
//   + multi-line signatures may reflow).

// GOTCHA — Do NOT run the full `npm run test:run` as the gate (orthogonal pre-existing failures). Gate
//   = typecheck + lint + format:check + the targeted tests/unit/core/task-utils.test.ts.

// CRITICAL — Parallel execution: P1.M1.T4.S1 (running now) edits src/utils/git-commit.ts (commit style).
//   S1 edits src/utils/task-utils.ts + tests/unit/core/task-utils.test.ts. ZERO file overlap, no merge
//   conflict. Sibling P1.M2 subtasks (matchStatus/cascade) add OTHER functions to task-utils.ts but are
//   SEQUENCED after S1 — S1's additive exports are merge-safe.
```

---

## Implementation Blueprint

### Data models and structure
No new data models. Two pure functions + one inline return type literal
(`{ item: HierarchyItem; canonicalId: string } | null`). All input types (`Backlog`,
`HierarchyItem`) already exist + are imported in `task-utils.ts`.

### Implementation Tasks (ordered by dependencies — implicit TDD: RED first, then GREEN)
```yaml
Task 1: EDIT tests/unit/core/task-utils.test.ts  (RED — failing imports/assertions FIRST)
  - IMPORT: add `normalizeTaskId, findItemByLooseId` to the existing named import from
        '../../../src/utils/task-utils.js' (test lines 12-20).
  - APPEND `describe('normalizeTaskId', () => { … })` INSIDE the top-level describe('utils/task-utils'):
      * it('P1.M1.T1.S1 → [1,1,1,1]') / it('p1m1t1s1 → [1,1,1,1]') / it('1.1.1.1 → [1,1,1,1]') — all toEqual([1,1,1,1])
      * it('1.2 → [1,2]') / it('1 → [1]')
      * it('empty → null') / it('whitespace → null') / it('no digits (foo) → null')
      * it('>4 segments (1.2.3.4.5) → null')
      * (optional) it('0 → [0]') documenting the syntactic-valid-but-positionally-invalid edge
  - APPEND `describe('findItemByLooseId', () => { … })` INSIDE the top-level describe, using
        `const backlog = createComplexBacklog();` (module-scope fixture):
      * it('canonical + loose forms all resolve to the same subtask'):
            expect(findItemByLooseId(backlog,'1.1.1.1')?.canonicalId).toBe('P1.M1.T1.S1');
            expect(findItemByLooseId(backlog,'p1m1t1s1')?.canonicalId).toBe('P1.M1.T1.S1');
            expect(findItemByLooseId(backlog,'P1.M1.T1.S1')?.canonicalId).toBe('P1.M1.T1.S1');
            expect(findItemByLooseId(backlog,'1.1.1.1')?.item.type).toBe('Subtask');
      * it('trailing omission: 1 → phase, 1.2 → milestone, 1.2.3 → task'):
            expect(findItemByLooseId(backlog,'1')?.item.type).toBe('Phase');
            expect(findItemByLooseId(backlog,'1')?.canonicalId).toBe('P1');
            expect(findItemByLooseId(backlog,'1.2')?.canonicalId).toBe('P1.M2');
            expect(findItemByLooseId(backlog,'1.1.2')?.canonicalId).toBe('P1.M1.T2');
      * it('second phase: 2.1.1.1 → P2.M1.T1.S1'):
            expect(findItemByLooseId(backlog,'2.1.1.1')?.canonicalId).toBe('P2.M1.T1.S1');
      * it('out-of-bounds → null'): '9.9.9.9' / '1.3' (P1 has 2 milestones) / '3' (only 2 phases) / '1.1.9'
      * it('unparseable → null'): '' / 'foo'
  - DO NOT: edit the existing findItem/isSubtask/etc. describes; add prd_selectors to fixtures.
  - EXPECTED NOW: imports FAIL (functions don't exist) → RED.

Task 2: EDIT src/utils/task-utils.ts  (GREEN — the two functions)
  - ADD normalizeTaskId + findItemByLooseId (verbatim bodies in "Technical requirements"), each with
        its Mode-A JSDoc, placed near findItem (~line 110) or at a logical grouping.
  - DO NOT: modify findItem or any existing function/export; add imports (Backlog/Phase/Milestone/
        Task/Subtask already imported 20-26); use `as` casts (the early-return form needs none).
  - EXPECTED: the new tests turn GREEN; existing tests stay GREEN.

Task 3: FORMAT + VERIFY
  - RUN: npm run fix → npm run typecheck → npm run lint → npm run format:check.
  - RUN: npx vitest run tests/unit/core/task-utils.test.ts   # new describes + all existing — GREEN.
  - RUN: npx vitest run tests/unit/core/task-utils.test.ts --coverage   # task-utils.ts 100%.
  - DO NOT run the full `npm run test:run` (orthogonal pre-existing failures — not S1's concern).
  - EXPECTED: typecheck/lint/format clean; task-utils.test.ts green; task-utils.ts 100% covered.
```

### Implementation Patterns & Key Details
```ts
// ---- normalizeTaskId (pure; regex extract + cap-4) ----
export function normalizeTaskId(looseId: string): number[] | null {
  const nums = looseId.match(/\d+/g);
  if (!nums) return null;          // no digit sequences (empty/whitespace/no-digits)
  if (nums.length > 4) return null; // hierarchy is at most 4 deep
  return nums.map(Number);
}

// ---- findItemByLooseId (normalize → positional 1-based walk; early-return per level, no casts) ----
export function findItemByLooseId(
  backlog: Backlog,
  looseId: string
): { item: HierarchyItem; canonicalId: string } | null {
  const segments = normalizeTaskId(looseId);
  if (!segments) return null;

  const phase = backlog.backlog[segments[0] - 1];
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

// ---- tests/unit/core/task-utils.test.ts: the equivalence + positional cases ----
describe('findItemByLooseId', () => {
  const backlog = createComplexBacklog();
  it('canonical + loose forms all resolve to the same subtask', () => {
    expect(findItemByLooseId(backlog, '1.1.1.1')?.canonicalId).toBe('P1.M1.T1.S1');
    expect(findItemByLooseId(backlog, 'p1m1t1s1')?.canonicalId).toBe('P1.M1.T1.S1');
    expect(findItemByLooseId(backlog, 'P1.M1.T1.S1')?.canonicalId).toBe('P1.M1.T1.S1');
    expect(findItemByLooseId(backlog, '1.1.1.1')?.item.type).toBe('Subtask');
  });
  it('trailing omission resolves higher-level items', () => {
    expect(findItemByLooseId(backlog, '1')?.canonicalId).toBe('P1');
    expect(findItemByLooseId(backlog, '1.2')?.canonicalId).toBe('P1.M2');
    expect(findItemByLooseId(backlog, '1.1.2')?.canonicalId).toBe('P1.M1.T2');
  });
  it('out-of-bounds and unparseable → null', () => {
    expect(findItemByLooseId(backlog, '9.9.9.9')).toBeNull();
    expect(findItemByLooseId(backlog, '1.3')).toBeNull();   // P1 has only 2 milestones
    expect(findItemByLooseId(backlog, '')).toBeNull();
  });
});
```

### Integration Points
```yaml
TASK-UTILS.TS (src/utils/task-utils.ts):
  - +export function normalizeTaskId(looseId): number[] | null  (regex extract + cap-4)
  - +export function findItemByLooseId(backlog, looseId): { item; canonicalId } | null  (normalize → 1-based walk)
  - PRESERVE: findItem, isSubtask, getDependencies, getAllSubtasks, updateItemStatus, filterByStatus,
        getNextPendingItem, HierarchyItem. No existing function edited.

DOWNSTREAM CONSUMER (P1.M2.T4.S1 — NOT S1):
  - src/cli/index.ts `hack update` handler: findItemByLooseId(backlog, argv.taskId) → result.canonicalId
        for `Updated <ID> …` output + result.item for the cascade engine (T3). S1 MUST NOT touch src/cli.

SIBLING P1.M2 SUBTASKS (sequenced AFTER S1 — merge-safe):
  - P1.M2.T2.S1 (matchStatus), P1.M2.T3.S1/S2 (cascade helpers) add their OWN functions to the same
        file. S1 is additive (append-only); no overlap with normalizeTaskId/findItemByLooseId.

DOCS (Mode A — JSDoc rides with the work):
  - JSDoc on both functions (algorithm + 1-based mapping + trailing omission + canonicalId + @example)
        is the only doc artifact. NO docs/*.md.
  - Commit message notes: PRD §5.4 loose-ID matcher; normalize-then-positional; canonicalId from real .id;
        findItem untouched; consumed by P1.M2.T4.S1 (hack update).
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
npm run fix            # lint:fix + prettier --write (run first — JSDoc @example fences may reflow)
npm run typecheck      # tsc --noEmit -p tsconfig.build.json — clean (early-return form needs no casts)
npm run lint           # eslint . --ext .ts — clean
npm run format:check   # prettier --check — clean
# Expected: all clean. If lint flags an unreachable `nums.length === 0` branch or unused var, prune it.
```

### Level 2: Unit Tests (Component Validation)
```bash
# The directly-affected suite — new describes + ALL existing findItem/isSubtask/etc. tests:
npx vitest run tests/unit/core/task-utils.test.ts
# Coverage on the touched source file (confirm 100% — every branch hit):
npx vitest run tests/unit/core/task-utils.test.ts --coverage
# Expected: green; task-utils.ts 100%. If a branch is uncovered, add the missing case (no-digits, >4,
#   or one out-of-bounds level). If an equivalence case fails, check the regex/cap + the 1-based index.
# Do NOT run the full `npm run test:run` (orthogonal pre-existing failures — not S1's concern).
```

### Level 3: Integration / Regression (System Validation)
```bash
# Confirm ONLY the 2 files changed (S1 must not touch cli/models/other utils):
git diff --name-only   # Expect ONLY src/utils/task-utils.ts + tests/unit/core/task-utils.test.ts.
# Confirm findItem is UNCHANGED + the 2 new exports are present:
grep -n "export function normalizeTaskId\|export function findItemByLooseId\|export function findItem" src/utils/task-utils.ts
# Expected: all three present; findItem body byte-identical (git diff shows only ADDITIONS around it).
```

### Level 4: Creative & Domain-Specific Validation
```bash
# No MCP/DB/HTTP (pure functions). Domain checks (record in commit message):
#   1. All PRD §5.4 equivalence forms resolve identically (P1.M1.T1.S1 / p1m1t1s1 / 1.1.1.1 → same subtask).
#   2. Trailing-segment omission works (1→phase, 1.2→milestone, 1.2.3→task, 1.2.3.4→subtask).
#   3. canonicalId is the item's REAL .id (not a rebuild) — robust to id-format changes.
#   4. Out-of-bounds + unparseable → null (no throw; the resolver is total).
#   5. findItem UNCHANGED; the new matcher is separate (loose/positional vs exact/string).
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` clean.
- [ ] `npm run lint` clean.
- [ ] `npm run format:check` clean.
- [ ] `npx vitest run tests/unit/core/task-utils.test.ts` GREEN (new + existing).
- [ ] `src/utils/task-utils.ts` at 100% coverage.
- [ ] `git diff --name-only` shows ONLY `src/utils/task-utils.ts` + `tests/unit/core/task-utils.test.ts`.

### Feature Validation
- [ ] `normalizeTaskId`: `P1.M1.T1.S1`/`p1m1t1s1`/`1.1.1.1`→`[1,1,1,1]`; `1.2`→`[1,2]`; `1`→`[1]`;
      `''`/`foo`/`1.2.3.4.5`→`null`.
- [ ] `findItemByLooseId`: canonical+loose forms → same item; trailing omission (1/1.2/1.2.3/1.2.3.4);
      out-of-bounds + unparseable → `null`; `canonicalId` = item's real `.id`.

### Code Quality Validation
- [ ] Both functions exported; `findItem` UNCHANGED; no existing function edited.
- [ ] `normalizeTaskId` uses `match(/\d+/g)` (no dead `length === 0` check); caps at 4.
- [ ] `findItemByLooseId` uses the early-return-per-level form (no `as` casts); `canonicalId` from real `.id`.
- [ ] JSDoc (Mode A) on both: algorithm + 1-based mapping + trailing omission + `@example`.
- [ ] Tests reuse `createComplexBacklog()`; new describes APPENDED inside the top-level describe.

### Documentation & Deployment
- [ ] JSDoc on both functions is the only doc artifact (Mode A — rides with the code).
- [ ] No `docs/*.md`, README, or `.env.example` changes.
- [ ] Commit message notes: PRD §5.4 loose-ID matcher; normalize-then-positional; canonicalId from real .id;
      findItem untouched; consumed by P1.M2.T4.S1 (hack update).

---

## Anti-Patterns to Avoid

- ❌ Don't modify `findItem` — the new `findItemByLooseId` is a SEPARATE matcher (loose/positional vs
      exact/string). The contract is explicit: "Do NOT modify findItem."
- ❌ Don't add a `nums.length === 0` check in `normalizeTaskId` — `match(/\d+/g)` returns `null` or a
      NON-EMPTY array, never `[]`. `if (!nums)` covers empty/whitespace/no-digits. The dead branch can
      trip lint/coverage.
- ❌ Don't reject `'0'` in `normalizeTaskId` — `'0'`→`[0]` is syntactically valid per the contract; the 0
      is rejected later by the 1-based lookup. Rejecting it here deviates from the spec.
- ❌ Don't reconstruct `canonicalId` from the segments — read it from the found item's REAL `.id` (the
      architect's actual id is authoritative; robust to format changes).
- ❌ Don't use a mutating `let item: HierarchyItem` + `as Milestone`/`as Task` casts — the early-return-
      per-level form is cleaner and cast-free (each level's variable is already narrowed).
- ❌ Don't split on `.` instead of using `/\d+/g` — the contract pins the regex form (it also handles
      `p1m1t1s1` concatenated, which split-on-dot would not).
- ❌ Don't edit the existing `findItem`/`isSubtask`/etc. test describes — APPEND new describes inside the
      top-level `describe('utils/task-utils')`. Don't add `prd_selectors` to `createTestSubtask`.
- ❌ Don't touch `src/cli/index.ts` — the `hack update` handler is P1.M2.T4.S1 (consumes the resolver).
      Don't touch `src/core/models.ts` (read-only) or `matchStatus`/cascade (sibling P1.M2 subtasks).
- ❌ Don't run the full `npm run test:run` as the gate — orthogonal pre-existing failures. Gate on
      typecheck + lint + format:check + the targeted `tests/unit/core/task-utils.test.ts`.
- ❌ Don't forget the coverage branches — every `if (!x) return null` and every `segments.length === N`
      return must be hit (the createComplexBacklog out-of-bounds cases `'1.3'`/`'9.9.9.9'`/`''` cover them).

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: This is a small, fully-specified, pure-function addition. Both function bodies are pinned
verbatim (architecture §F2.A + the item contract), the regex semantics gotcha (`match` never returns
`[]`) is called out, the `'0'`-segment edge is documented, and the early-return-per-level form needs no
TS casts. The test fixture (`createComplexBacklog`) already exists with a verified id map at every level,
so the equivalence + positional + out-of-bounds assertions are concrete and deterministic. The change is
strictly additive (`findItem` untouched; new exports appended), merge-safe with the sequenced sibling
P1.M2 subtasks (matchStatus/cascade) and file-disjoint from the parallel P1.M1.T4.S1 (`git-commit.ts`).
100% coverage is achievable with the enumerated branch cases. Residual risks: (a) a dead-branch lint/coverage
flag if the implementer adds an unnecessary `nums.length === 0` check (enumerated as an anti-pattern);
(b) a prettier reflow of the JSDoc `@example` fences (auto-fixed via `npm run fix`). No runtime/network/LLM
unknowns — both functions are pure.