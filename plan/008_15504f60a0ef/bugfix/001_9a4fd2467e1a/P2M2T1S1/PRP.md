# PRP — P2.M2.T1.S1: Create ContextScopeReadSchema (lenient) and BacklogReadSchema

---

## Goal

**Feature Goal**: Define a **lenient READ-time schema hierarchy** for `tasks.json`
alongside the existing strict (write-time) schemas, so that legacy / hand-edited /
externally-authored / test-fixture sessions load instead of being rejected by the
`CONTRACT DEFINITION:` format check (PRD §5.1; bugfix Issue 3B). Concretely: add
six new exports to `src/core/models.ts` — `ContextScopeReadSchema`,
`SubtaskReadSchema`, `TaskReadSchema`, `MilestoneReadSchema`, `PhaseReadSchema`,
`BacklogReadSchema` — each a lenient twin of its strict counterpart, differing
ONLY in that `context_scope` is validated as a plain non-empty string (no
CONTRACT DEFINITION prefix / 4-section format). The strict schemas stay
**unchanged** and remain the write-time validator for architect OUTPUT.

> **Scope boundary (read first).** S1 is the **schema-definition layer ONLY**.
> Wiring the read path (`readTasksJSON` / `loadSession`) to use
> `BacklogReadSchema` is **P2.M2.T1.S2**. S1 must NOT edit `session-utils.ts` or
> `session-manager.ts`. The lenient schemas are exported now and consumed by S2.

**Deliverable**:
1. **`src/core/models.ts`** — ADD the six lenient `*ReadSchema` exports in a
   single cohesive block immediately AFTER `BacklogSchema` (line ~804), each
   mirroring its strict twin with the one contract-named difference. Add Mode-A
   JSDoc to `ContextScopeReadSchema` and `BacklogReadSchema` explaining the
   write-strict / read-lenient split + the PRD §5.1 rationale.
2. **`tests/unit/core/models.test.ts`** — ADD named imports for the six new
   schemas + a new `describe('Read schemas (lenient)')` block proving: the lenient
   `BacklogReadSchema` ACCEPTS a backlog whose subtask `context_scope` is a plain
   string the strict `BacklogSchema` REJECTS; leniency is on `context_scope`
   FORMAT ONLY (structural validation — IDs, status, types — still enforced);
   empty `context_scope` is still rejected (`.min(1)`). GATED (*.test.ts → runs
   under `npm run validate`).

**Success Definition**:
- `rg -n "ReadSchema" src/core/models.ts` → six exports (`ContextScopeReadSchema`,
  `SubtaskReadSchema`, `TaskReadSchema`, `MilestoneReadSchema`, `PhaseReadSchema`,
  `BacklogReadSchema`).
- The strict `ContextScopeSchema` / `SubtaskSchema` / `TaskSchema` /
  `MilestoneSchema` / `PhaseSchema` / `BacklogSchema` are **byte-unchanged**
  (`git diff` shows only ADDITIONS after `BacklogSchema`).
- `BacklogReadSchema.safeParse(<backlog with plain context_scope>).success === true`
  while `BacklogSchema.safeParse(<same>).success === false`.
- `BacklogReadSchema` still REJECTS empty `context_scope` AND structural errors
  (bad ID, bad status, wrong type discriminator) — leniency is FORMAT-only.
- `npx tsc --noEmit -p tsconfig.build.json` exit 0; `npm run lint` + `format:check`
  clean; `npx vitest run tests/unit/core/models.test.ts` green with **100%
  coverage on `src/core/models.ts`** preserved.
- No edits to `session-utils.ts` / `session-manager.ts` (S2 owns wiring).

---

## User Persona (if applicable)

**Target User**: Pipeline maintainer / recovery-path contributor.
**Use Case**: Loading a `tasks.json` that wasn't produced by the current architect
(e.g. legacy, hand-edited, externally-authored, or a test fixture) without it
being hard-rejected over a documentation-format field.
**User Journey**: A session fails to load with `context_scope must start with
"CONTRACT DEFINITION:"`; maintainer notes the read path should be lenient on
format; S1 ships the lenient schemas, S2 wires them in; the session loads.
**Pain Points Addressed**: Today the strict `ContextScopeSchema` is enforced on
READ via `readTasksJSON → BacklogSchema.parse`, locking out any legitimate
session that lacks the contract prefix (PRD §5.1 mandates survival of corruption).

---

## Why

- **PRD §5.1 compliance**: "`tasks.json` Protection & Smart Recovery" mandates the
  state file SURVIVE corruption / non-pipeline authorship — a read-time hard
  reject on a documentation-format field (`context_scope`) is too strict for a
  recovery-oriented state file.
- **Unblocks the red suite (bugfix Issue 3)**: ~90+ test fixtures use plain
  `context_scope` strings; relaxing the READ schema (S2 wiring) fixes the whole
  cluster at once. S1 supplies the lenient schemas S2 needs.
- **Preserves the contract guarantee**: the pipeline still PRODUCES the
  `CONTRACT DEFINITION` format — the STRICT schemas stay as architect OUTPUT
  (write-time) validation. Leniency is read-only and format-only.
- **Enables S2/S3**: S2 ("Wire readTasksJSON and loadSession to use
  BacklogReadSchema") and S3 (rotted-fixture cleanup) both consume S1's exports.

### Out of scope (hard fences)
- **Wire `readTasksJSON` / `loadSession` to `BacklogReadSchema`** → **S2**. S1
  must NOT touch `session-utils.ts` (line 870 `BacklogSchema.parse`) or
  `session-manager.ts`.
- **Rename the strict schemas** (e.g. `ContextScopeWriteSchema`) → the contract
  FORBIDS it ("Keep the existing strict ContextScopeSchema and BacklogSchema
  UNCHANGED"). Only ADD the `*ReadSchema` exports.
- **Relax `.min(1)` to bare `z.string()`** → the contract specifies
  `.min(1, 'Context scope is required')` verbatim. Empty scope is genuinely
  malformed, not a format deviation.
- **Add runtime "warn (not reject)" logging for non-contract scopes** → PRD Issue
  3 mentions it as a *possible* enhancement, but the CONTRACT lists only schema
  exports + JSDoc ("No mocking needed"). Logging belongs to the wiring layer (S2).
- **Fix the ~297 rotted tests / mock drift (Issue 3A)** → **P2.M3**. S1 only adds
  the schemas + their own focused tests.

---

## What

### User-visible behavior
None. S1 is schema definitions + tests. The user-visible change (sessions with
plain `context_scope` load) lands in S2 when the read path is wired.

### Technical requirements (exact contract — item 3a–e)

**(a) `ContextScopeReadSchema`** — lenient, contract verbatim:
```ts
export const ContextScopeReadSchema: z.ZodType<string> =
  z.string().min(1, 'Context scope is required');
```

**(b) `SubtaskReadSchema`** — mirror `SubtaskSchema` (models.ts:375) but
`context_scope: ContextScopeReadSchema`. Same `z.ZodType<Subtask, z.ZodTypeDef,
Omit<Subtask,'prd_selectors'> & { prd_selectors?: string[] }>` annotation; same
field bodies (regex/`StatusEnum`/`multipleOf(0.5)`/`min(0.5)`/`max(21)`/
`dependencies`/`prd_selectors …optional().default([])`).

**(c) `TaskReadSchema`, `MilestoneReadSchema`, `PhaseReadSchema`,
`BacklogReadSchema`** — mirror their strict counterparts, swapping the nested
array to the Read twin:
- `TaskReadSchema` (mirror `TaskSchema:497`): `subtasks: z.array(SubtaskReadSchema)`.
- `MilestoneReadSchema` (mirror `MilestoneSchema:600`): keeps `z.lazy(() => …)`
  outer + `tasks: z.array(z.lazy(() => TaskReadSchema))` inner.
- `PhaseReadSchema` (mirror `PhaseSchema:702`): keeps `z.lazy(() => …)` outer +
  `milestones: z.array(z.lazy(() => MilestoneReadSchema))` inner.
- `BacklogReadSchema` (mirror `BacklogSchema:797`): `backlog: z.array(PhaseReadSchema)`.

**(d)** Keep the existing strict `ContextScopeSchema` / `BacklogSchema` (and
intermediate strict schemas) **UNCHANGED** — they remain architect-OUTPUT
(write-time) validation.

**(e)** EXPORT both `BacklogSchema` (strict) and `BacklogReadSchema` (lenient).
Both are `export const` (named exports); no default export.

**DOCS (Mode A, PRD §6.1 — rides with the work)**: JSDoc on
`ContextScopeReadSchema` and `BacklogReadSchema` explaining (1) the
write-strict / read-lenient split, (2) that strict remains architect OUTPUT,
(3) why read-time rejection on a doc-format field is too strict for a
recovery-oriented state file (PRD §5.1). Concise JSDoc on the four intermediate
read schemas pointing at their strict twin + the leniency reason.

### Success Criteria
- [ ] Six `*ReadSchema` exports present in `src/core/models.ts`, JSDoc on the two
      named in the contract + brief docs on the four intermediates.
- [ ] Strict schemas byte-unchanged (`git diff src/core/models.ts` = additions only).
- [ ] `BacklogReadSchema` accepts a plain-`context_scope` backlog that
      `BacklogSchema` rejects (asymmetric acceptance — the core proof).
- [ ] `BacklogReadSchema` still rejects empty `context_scope` + structural errors.
- [ ] `tsc --noEmit -p tsconfig.build.json` exit 0; lint + format:check clean;
      `vitest run tests/unit/core/models.test.ts` green; 100% coverage preserved.
- [ ] No edits to `session-utils.ts` / `session-manager.ts`.

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_
**Yes.** The six new schemas are precise mirrors of six existing, compiling
schemas with one named change each (full type-correct source in research
§s1-type-correctness.md §1). The `z.lazy` recursion pattern is reproduced
verbatim (not simplified). The naming-reconciliation gotcha (architecture doc
suggested renaming to `*WriteSchema`; contract overrides) is called out. The
`.min(1)` boundary (empty scope still rejected) is explicit. The S1/S2 split is
fenced. The 100%-coverage trap is branch-free by construction. Build baseline is
verified green (exit 0).

### Documentation & References
```yaml
# MUST READ — the bug + the mandated fix strategy
- docfile: PRD.md  (bugfix PRD)
  section: "Issue 3: Test suite red; ContextScopeSchema over-strict on READ" (h3.2)
  why: Defines the bug (strict ContextScopeSchema enforced on READ via
       readTasksJSON → BacklogSchema.parse → session lockout) and the mandated
       fix: "Relax ContextScopeSchema: enforce the CONTRACT DEFINITION contract
       on WRITE (architect output) but only warn (not reject) on READ ... A
       read-time hard reject on a documentation-format field is too strict for a
       recovery-oriented state file (PRD §5.1)."
  critical: S1 implements the lenient schemas; S2 does the wiring. Logging is a
       wiring-layer concern (S2), NOT schema-definition (S1).
- docfile: PRD.md (bugfix PRD)
  section: "Overview" (h2.0) + PRD §5.1 (tasks.json Protection & Smart Recovery)
  why: PRD §5.1 is the authority that read-time must SURVIVE non-pipeline
       authorship, justifying the lenient read schema.
  critical: Recovery-oriented state files must not hard-reject on a doc-format field.

# MUST READ — the architecture research (proven facts)
- docfile: plan/008_15504f60a0ef/bugfix/001_9a4fd2467e1a/architecture/test_validation.md
  section: "## Issue 3 ... ### 3B: ContextScopeSchema Over-Strict on READ"
  why: Documents the exact hierarchy (ContextScopeSchema → SubtaskSchema →
       TaskSchema → MilestoneSchema → PhaseSchema → BacklogSchema), the read path
       (readTasksJSON → BacklogSchema.parse), the ~90+ plain-scope fixtures, and
       the fix strategy.
  critical: The doc SUGGESTS renaming the strict schema to ContextScopeWriteSchema —
       the CONTRACT OVERRIDES (keep names; only ADD *ReadSchema). Do not rename.

# MUST READ — this subtask's research (type-correct source + analysis)
- docfile: plan/008_15504f60a0ef/bugfix/001_9a4fd2467e1a/P2M2T1S1/research/s1-type-correctness.md
  section: §1 (full type-correct schema block), §2 (z.lazy preservation), §3 (field-body fidelity), §4 (placement), §5 (type-safety proof)
  why: The ready-to-paste, type-correct schema definitions with exact annotations.
- docfile: plan/008_15504f60a0ef/bugfix/001_9a4fd2467e1a/P2M2T1S1/research/s1-codebase-analysis.md
  section: §3 (hierarchy table), §4 (annotations), §5 (ContextScopeReadSchema verbatim), §6 (naming reconciliation), §7 (test home), §8 (coverage), §10 (scope fences)
  why: The proven facts that gate one-pass success.

# THE FILE TO EDIT
- file: src/core/models.ts
  why: EDIT — add the six *ReadSchema exports as one block AFTER BacklogSchema
       (line ~804), before the Session Metadata section (~807).
  pattern: each strict schema is `export const XS: z.ZodType<I, z.ZodTypeDef, Input> =
           z.object({...})` (or `z.lazy(...)` for Milestone/Phase). Mirror EXACTLY;
           swap only the contract-named field/array.
  gotcha: Field bodies MUST be byte-identical to the strict originals (regex, error
          strings, multipleOf/min/max, StatusEnum, prd_selectors default). The ONLY
          change per schema is the one named in the contract. Do NOT paraphrase —
          paraphrasing silently alters READ-time structural validation.

- file: tests/unit/core/models.test.ts
  why: EDIT — add the six schemas to the named import block (lines ~15-30) + add a
       new describe('Read schemas (lenient)') block after the existing
       describe('BacklogSchema') (~line 1208+). GATED (*.test.ts → runs in validate).
  pattern: SETUP/EXECUTE/VERIFY comments; safeParse() + expect(result.success).toBe(...).
           Mirror the existing `validBacklog: Backlog` fixture shape (line ~1210), but
           nest a Subtask with a PLAIN (non-contract) context_scope to prove asymmetric
           acceptance vs the strict BacklogSchema.

# CONTRACT INPUTS (read-only — the strict schemas S1 mirrors)
- symbol: ContextScopeSchema (src/core/models.ts:106)  — the strict write-time validator (KEEP)
- symbol: SubtaskSchema (src/core/models.ts:375)       — mirror target for SubtaskReadSchema
- symbol: TaskSchema (src/core/models.ts:497)          — mirror target for TaskReadSchema
- symbol: MilestoneSchema (src/core/models.ts:600)     — mirror target (z.lazy pattern)
- symbol: PhaseSchema (src/core/models.ts:702)         — mirror target (z.lazy pattern)
- symbol: BacklogSchema (src/core/models.ts:797)       — mirror target for BacklogReadSchema

# S2 CONTRACT (what consumes S1's output — DO NOT implement, just stay compatible)
- file: src/core/session-utils.ts  (readTasksJSON at :857; BacklogSchema.parse at :870)
  why: S2 swaps `BacklogSchema.parse` → `BacklogReadSchema.parse` here. S1 must
       keep BacklogReadSchema a drop-in (same output type Backlog) so S2 is a
       one-line swap.
- file: src/core/session-manager.ts (loadSession delegates to readTasksJSON :1228)
  why: S2's second wiring site. No S1 change needed.
```

### Current Codebase tree (relevant slice)
```bash
src/core/
  models.ts          # EDIT — add six *ReadSchema exports after BacklogSchema (line ~804)
  session-utils.ts   # UNTOUCHED (S2 swaps BacklogSchema.parse → BacklogReadSchema.parse)
  session-manager.ts # UNTOUCHED (S2 wiring)
tests/unit/core/
  models.test.ts     # EDIT — add imports + describe('Read schemas (lenient)')
vitest.config.ts     # READ-ONLY — 100% coverage thresholds; include globs
```

### Desired Codebase tree with files to be added and responsibility of file
```bash
src/core/models.ts              # MODIFIED — exports 6 lenient *ReadSchema (write-strict kept)
tests/unit/core/models.test.ts  # MODIFIED — Read schemas (lenient) test block
# (no NEW files)
```

### Known Gotchas of our codebase & Library Quirks
```ts
// CRITICAL: Do NOT rename the strict schemas. The architecture doc (test_validation.md
// §3B) SUGGESTED "ContextScopeWriteSchema"; the CONTRACT OVERRIDES — keep the existing
// names ContextScopeSchema / BacklogSchema UNCHANGED. Only ADD the *ReadSchema exports.

// CRITICAL: leniency is on context_scope FORMAT ONLY, and only via .min(1). The contract
// specifies ContextScopeReadSchema = z.string().min(1, 'Context scope is required') VERBATIM.
// Do NOT use bare z.string() (empty scope would then load — wrong) and do NOT add a superRefine.

// CRITICAL: keep .min(1) on ContextScopeReadSchema. Empty context_scope ('') is genuinely
// malformed data (not a format deviation) and must still be rejected. ~11 fixtures use '' but
// those flow through .parse() only in specific paths — fixing them is P2.M3 / S2 concern.

// CRITICAL: reproduce the z.lazy() recursion on MilestoneReadSchema / PhaseReadSchema EXACTLY
// as the strict originals (outer z.lazy(() => z.object({...})) AND inner
// z.array(z.lazy(() => TaskReadSchema))). Do not "simplify" to a bare z.array(TaskReadSchema) —
// it risks zod 3.x inference mismatches with the z.input<typeof ...> annotations.

// CRITICAL: every field body in the Read twins must be BYTE-IDENTICAL to the strict original
// (regex, error messages, StatusEnum, multipleOf(0.5)/min(0.5)/max(21), prd_selectors
// .optional().default([])). The ONLY change per schema is the contract-named field/array.
// Paraphrasing silently changes READ-time structural validation.

// GOTCHA: use the SAME z.ZodType<Interface, z.ZodTypeDef, InputType> annotations as the strict
// originals. context_scope is `string` in both (the Interface field is readonly context_scope:
// string); leniency changes validation, not the type. The prd_selectors input-widening is
// identical. This keeps BacklogReadSchema a drop-in (output type Backlog) for S2's one-line swap.

// GOTCHA: S1 is schema-definitions ONLY. Do NOT touch session-utils.ts:870 (BacklogSchema.parse)
// or session-manager.ts — that wiring is P2.M2.T1.S2. Exporting the schemas now is the deliverable.

// GOTCHA: vitest enforces 100% coverage (statements/branches/functions/lines). The new schemas
// are object literals + a string schema — zero runtime branches — so coverage is achieved by
// parsing one valid plain-scope backlog + one structurally-invalid backlog. No conditional logic.

// GOTCHA: no new imports needed in models.ts — `z`, `StatusEnum`, and the Interfaces
// (Subtask/Task/Milestone/Phase/Backlog) are already in scope. Build baseline verified green.
```

---

## Implementation Blueprint

### Data models and structure

See research §s1-type-correctness.md §1 for the **full, type-correct, ready-to-paste**
schema block. Summary of the six exports (all `export const`, dependency-ordered):

```ts
// ContextScopeReadSchema — lenient; contract verbatim
export const ContextScopeReadSchema: z.ZodType<string> =
  z.string().min(1, 'Context scope is required');

// SubtaskReadSchema — mirror SubtaskSchema, context_scope: ContextScopeReadSchema
export const SubtaskReadSchema: z.ZodType<Subtask, z.ZodTypeDef,
  Omit<Subtask, 'prd_selectors'> & { prd_selectors?: string[] }> = z.object({ /* ... */ });

// TaskReadSchema — mirror TaskSchema, subtasks: z.array(SubtaskReadSchema)
export const TaskReadSchema: z.ZodType<Task, z.ZodTypeDef,
  Omit<Task, 'subtasks'> & { subtasks: (Omit<Subtask,'prd_selectors'> & { prd_selectors?: string[] })[] }> =
  z.object({ /* ... */ });

// MilestoneReadSchema — mirror MilestoneSchema (z.lazy), tasks: z.array(z.lazy(() => TaskReadSchema))
export const MilestoneReadSchema: z.ZodType<Milestone, z.ZodTypeDef,
  Omit<Milestone, 'tasks'> & { tasks: z.input<typeof TaskReadSchema>[] }> = z.lazy(() => z.object({ /* ... */ }));

// PhaseReadSchema — mirror PhaseSchema (z.lazy), milestones: z.array(z.lazy(() => MilestoneReadSchema))
export const PhaseReadSchema: z.ZodType<Phase, z.ZodTypeDef,
  Omit<Phase, 'milestones'> & { milestones: z.input<typeof MilestoneReadSchema>[] }> = z.lazy(() => z.object({ /* ... */ }));

// BacklogReadSchema — mirror BacklogSchema, backlog: z.array(PhaseReadSchema)
export const BacklogReadSchema: z.ZodType<Backlog, z.ZodTypeDef,
  Omit<Backlog, 'backlog'> & { backlog: z.input<typeof PhaseReadSchema>[] }> = z.object({ /* ... */ });
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/core/models.ts — ADD the six lenient *ReadSchema exports
  - FIND: the end of `BacklogSchema` (line ~804, the `});` closing the z.object), immediately
    BEFORE the `/** Session Metadata Interface ...` block (~line 807).
  - INSERT: a section-banner comment ("READ-TIME LENIENT SCHEMAS (PRD §5.1; bugfix Issue 3B)
    — P2.M2.T1.S1") + the six schemas in dependency order: ContextScopeReadSchema →
    SubtaskReadSchema → TaskReadSchema → MilestoneReadSchema → PhaseReadSchema →
    BacklogReadSchema. (Paste the verified block from research §s1-type-correctness.md §1.)
  - VERIFY each field body is byte-identical to its strict twin (regex/StatusEnum/multipleOf/
    min/max/prd_selectors default); the ONLY diffs are: SubtaskReadSchema.context_scope =
    ContextScopeReadSchema; TaskReadSchema.subtasks = z.array(SubtaskReadSchema);
    MilestoneReadSchema tasks = z.array(z.lazy(() => TaskReadSchema)); PhaseReadSchema
    milestones = z.array(z.lazy(() => MilestoneReadSchema)); BacklogReadSchema.backlog =
    z.array(PhaseReadSchema).
  - KEEP the z.lazy() outer + inner pattern on MilestoneReadSchema/PhaseReadSchema (do not collapse).
  - ADD Mode-A JSDoc to ContextScopeReadSchema + BacklogReadSchema (write-strict/read-lenient
    split + PRD §5.1 rationale; see What §DOCS). Add concise JSDoc to the four intermediates
    pointing at their strict twin + the leniency reason.
  - NAMING: PascalCase `XReadSchema`; `export const`. No default export.
  - DO NOT touch the strict schemas, session-utils.ts, or session-manager.ts.
  - FOLLOW pattern: existing z.ZodType<Interface, z.ZodTypeDef, InputType> annotations; the
    strict MilestoneSchema/PhaseSchema z.lazy precedent.

Task 2: MODIFY tests/unit/core/models.test.ts — ADD imports + Read-schemas test block
  - EDIT the named-import block (lines ~15-30): ADD `ContextScopeReadSchema, SubtaskReadSchema,
    TaskReadSchema, MilestoneReadSchema, PhaseReadSchema, BacklogReadSchema` to the import
    from `'../../../src/core/models.js'`.
  - ADD a new `describe('Read schemas (lenient)', () => { ... })` block AFTER the existing
    `describe('BacklogSchema', ...)` (ends ~line 1355+). Tests (cover 100% + the asymmetric
    acceptance proof):
      * it('BacklogReadSchema accepts a plain (non-contract) context_scope that BacklogSchema rejects'):
          build a minimal backlog with ONE nested Subtask whose context_scope is a plain string
          (e.g. 'Implement feature X in src/foo.ts' — exactly the PRD §Issue 3 repro). Assert
          `BacklogReadSchema.safeParse(...).success === true` AND
          `BacklogSchema.safeParse(<same>).success === false`. (THE core proof of the split.)
      * it('ContextScopeReadSchema accepts plain non-empty strings; rejects empty'):
          safeParse('Test scope').success===true; safeParse('').success===false.
      * it('SubtaskReadSchema/TaskReadSchema/MilestoneReadSchema/PhaseReadSchema each accept a
          plain-scope nested object'): exercise each intermediate schema once with a plain scope
          (covers their field bodies).
      * it('BacklogReadSchema still rejects STRUCTURAL errors (leniency is FORMAT-only)'):
          bad subtask ID ('P1.M1.T1.X'), bad status ('planned' lowercase), wrong type
          discriminator — each safeParse().success===false.
      * it('strict schemas are unchanged — BacklogSchema still rejects plain context_scope'):
          re-assert (defensive) that the strict path rejects the plain-scope fixture.
  - FOLLOW pattern: existing SETUP/EXECUTE/VERIFY comment blocks; safeParse() +
    expect(result.success).toBe(...); mirror the `validBacklog: Backlog` fixture shape (line ~1210).
  - COVERAGE: every new schema object literal is read via safeParse (valid + invalid). No
    runtime branches exist in the schemas, so this trivially hits 100%.
  - PLACEMENT: inside the existing top-level `describe('core/models Zod Schemas', ...)`.

Task 3: VERIFY — typecheck, lint, format, targeted tests, coverage
  - RUN `npx tsc --noEmit -p tsconfig.build.json` → exit 0 (proves the z.lazy + annotations
    compile and BacklogReadSchema is a drop-in for S2).
  - RUN `npm run lint && npm run format:check` → clean (add schemas to format; run `npm run
    format` if it complains).
  - RUN `npx vitest run tests/unit/core/models.test.ts` → green.
  - RUN `npx vitest run --coverage` for models.ts → 100% preserved.
  - VERIFY `git diff src/core/models.ts` shows ONLY additions after BacklogSchema (strict
    schemas byte-unchanged).
  - VERIFY no edits to session-utils.ts / session-manager.ts (S2's lane).
```

### Implementation Patterns & Key Details

```ts
// PATTERN: lenient twin = strict twin with ONE named change. Example (SubtaskReadSchema):
export const SubtaskReadSchema: z.ZodType<
  Subtask, z.ZodTypeDef,
  Omit<Subtask, 'prd_selectors'> & { prd_selectors?: string[] }   // SAME annotation as SubtaskSchema
> = z.object({
  id: z.string().regex(/^P\d+\.M\d+\.T\d+\.S\d+$/, 'Invalid subtask ID format (...)'),
  type: z.literal('Subtask'),
  title: z.string().min(1, 'Title is required').max(200, 'Title too long'),
  status: StatusEnum,
  story_points: z.number({ invalid_type_error: 'Story points must be a number' })
    .multipleOf(0.5, 'Story points must be in 0.5 increments')
    .min(0.5, 'Story points must be at least 0.5').max(21, 'Story points cannot exceed 21'),
  dependencies: z.array(z.string()).min(0),
  context_scope: ContextScopeReadSchema,   // ← THE ONLY CHANGE (was ContextScopeSchema)
  prd_selectors: z.array(z.string()).optional().default([]),
});

// PATTERN: recursion on Milestone/Phase Read twins — keep BOTH z.lazy wrappers:
export const MilestoneReadSchema: z.ZodType<Milestone, z.ZodTypeDef,
  Omit<Milestone, 'tasks'> & { tasks: z.input<typeof TaskReadSchema>[] }> = z.lazy(() =>
  z.object({
    /* id/type/title/status/description byte-identical to MilestoneSchema */
    tasks: z.array(z.lazy(() => TaskReadSchema)),   // ← was () => TaskSchema
  })
);

// CRITICAL: the asymmetric-acceptance proof (the whole point of S1) — assert in tests:
//   BacklogReadSchema.safeParse(plainScopeBacklog).success === true
//   BacklogSchema.safeParse(plainScopeBacklog).success === false
```

### Integration Points

```yaml
SCHEMAS (src/core/models.ts):
  - export (NEW): ContextScopeReadSchema, SubtaskReadSchema, TaskReadSchema,
    MilestoneReadSchema, PhaseReadSchema, BacklogReadSchema
  - unchanged (STRICT, write-time): ContextScopeSchema, SubtaskSchema, TaskSchema,
    MilestoneSchema, PhaseSchema, BacklogSchema

TESTS (tests/unit/core/models.test.ts):
  - add: named imports + describe('Read schemas (lenient)')

DOWNSTREAM (S2 — DO NOT IMPLEMENT; stay compatible):
  - src/core/session-utils.ts:870  BacklogSchema.parse → BacklogReadSchema.parse
  - src/core/session-manager.ts loadSession (delegates to readTasksJSON)

NO DATABASE / NO ROUTES / NO ENV VARS / NO CLI — pure schema + tests.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# After adding the schema block to src/core/models.ts:
npx tsc --noEmit -p tsconfig.build.json   # MUST be exit 0 (z.lazy + annotations + drop-in)
npm run lint -- --ext .ts                  # eslint: no unused/typing issues
npm run format:check                        # prettier; run `npm run format` if it complains

# Expected: Zero errors. The tsc check is the headline gate — it proves the six lenient schemas
# compile AND BacklogReadSchema is a type-compatible drop-in for S2's swap.
```

### Level 2: Unit Tests (Component Validation)

```bash
# Targeted suite (GATED — runs under npm run validate):
npx vitest run tests/unit/core/models.test.ts

# Coverage on models.ts (100% thresholds enforced by vitest.config.ts):
npx vitest run tests/unit/core/models.test.ts --coverage

# Expected: ALL green. Specifically verify describe('Read schemas (lenient)'):
#   - BacklogReadSchema ACCEPTS a plain-scope backlog; BacklogSchema REJECTS the same (asymmetric).
#   - ContextScopeReadSchema accepts 'Test scope'; rejects ''.
#   - BacklogReadSchema rejects structural errors (bad ID/status/type) — FORMAT-only leniency.
#   - each intermediate Read schema exercised once.
# 100% coverage on src/core/models.ts preserved (the new schemas have zero runtime branches).
```

### Level 3: Integration Testing (System Validation)

```bash
# NOTE: the FULL `npm run test:run` / `npm run validate` is NOT green yet and is NOT S1's gate —
# the suite has ~297 pre-existing failures (bugfix Issue 3A mock drift + Issue 4 resume-detection),
# owned by P2.M3 / P3. S1's gate is: targeted models.test.ts green + tsc exit 0 + 100% models coverage.

# Build (compiles dist — confirms no transitive breakage from the new exports):
npm run build

# Confirm strict schemas are byte-unchanged (additions only):
git diff src/core/models.ts --stat
git diff src/core/models.ts | grep -E "^-" | grep -v "^---"   # EXPECT: empty (no deletions/modifications)

# Expected: `npm run build` succeeds; git diff shows additions only (strict schemas untouched).
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Confirm all six exports exist:
rg -n "export const (ContextScopeReadSchema|SubtaskReadSchema|TaskReadSchema|MilestoneReadSchema|PhaseReadSchema|BacklogReadSchema)\b" src/core/models.ts

# Confirm the strict schemas are unchanged (still present, not renamed to *WriteSchema):
rg -n "export const ContextScopeSchema\b|export const BacklogSchema\b" src/core/models.ts   # EXPECT: both still present
rg -n "WriteSchema" src/core/models.ts   # EXPECT: empty (no rename)

# Confirm the asymmetric-acceptance contract holds (quick inline check via the test suite above).

# Confirm S1 did NOT touch the read-path wiring (S2's lane):
git diff --stat src/core/session-utils.ts src/core/session-manager.ts   # EXPECT: empty

# Expected: six Read exports present; strict schemas intact & unnamed-*WriteSchema*; read path untouched.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npx tsc --noEmit -p tsconfig.build.json` exit 0.
- [ ] `npm run lint` + `npm run format:check` clean.
- [ ] `npx vitest run tests/unit/core/models.test.ts` green; 100% models.ts coverage.
- [ ] `npm run build` succeeds.

### Feature Validation
- [ ] Six `*ReadSchema` exports present; JSDoc on ContextScopeReadSchema + BacklogReadSchema (+ brief docs on intermediates).
- [ ] Strict schemas byte-unchanged (`git diff` = additions only).
- [ ] Asymmetric acceptance: `BacklogReadSchema` accepts a plain-scope backlog `BacklogSchema` rejects.
- [ ] `BacklogReadSchema` still rejects empty `context_scope` + structural errors (FORMAT-only leniency).
- [ ] No edits to `session-utils.ts` / `session-manager.ts` (S2's lane).

### Code Quality Validation
- [ ] Field bodies byte-identical to strict twins (only the contract-named field/array differs).
- [ ] `z.lazy()` recursion reproduced verbatim on Milestone/Phase Read twins.
- [ ] Same `z.ZodType<Interface, z.ZodTypeDef, InputType>` annotations (drop-in for S2).
- [ ] No `*WriteSchema` rename; no bare `z.string()` (kept `.min(1)`); no logging (S2's lane).

### Documentation & Deployment
- [ ] Mode-A JSDoc on the two contract-named schemas (write-strict/read-lenient split + PRD §5.1).
- [ ] No new env vars / CLI / routes (pure schema + tests).

---

## Anti-Patterns to Avoid

- ❌ Don't wire `readTasksJSON`/`loadSession` to the lenient schema — that's S2.
- ❌ Don't rename the strict schemas to `*WriteSchema` — contract keeps the existing names.
- ❌ Don't relax `ContextScopeReadSchema` to bare `z.string()` — contract is `.min(1)` verbatim.
- ❌ Don't paraphrase field bodies (regex/errors/constraints) — silently alters READ validation.
- ❌ Don't collapse the `z.lazy()` recursion on Milestone/Phase Read twins — mirror it verbatim.
- ❌ Don't add runtime "warn (not reject)" logging — that's a wiring-layer (S2) concern.
- ❌ Don't gate S1 on the full `npm run test:run`/`validate` — the suite has ~297 pre-existing
  failures (Issue 3A/4, P2.M3/P3 scope); S1's gate is targeted models.test.ts + tsc + coverage.
- ❌ Don't fix the ~90+ plain-scope / ~11 empty-scope test fixtures — P2.M3 / S2 scope.

---

## Confidence Score

**9/10** — One-pass success likelihood is high. The six schemas are precise,
type-correct mirrors (full ready-to-paste source in research) of six existing,
compiling schemas with one named change each. The two design risks — (1) the
`z.lazy` recursion and (2) the naming-reconciliation (architecture doc's
`*WriteSchema` suggestion vs contract's "keep names") — are both explicitly
resolved. The build baseline is verified green; the lenient schemas are branch-
free so 100% coverage is trivial. The only residual risk is a zod 3.x inference
edge case around `z.input<typeof TaskReadSchema>`, mitigated by keeping the
generic annotations byte-identical to the proven strict originals.