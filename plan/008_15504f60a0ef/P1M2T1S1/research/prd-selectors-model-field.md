# Research — `prd_selectors` on the Subtask model

Findings anchoring P1.M2.T1.S1 (add `prd_selectors` to the `Subtask` interface +
`SubtaskSchema`). All line numbers verified against the working tree.

## 1. The field already exists in serialized `tasks.json` — but is dropped on read

Session 008's `plan/008_15504f60a0ef/tasks.json` subtasks ALREADY carry
`prd_selectors` (e.g. `P1.M1.T1.S1` → `["h3.2","h2.1"]`). The Task-Breakdown
agent emits it because PRD §4.2 describes it. BUT:

- `Subtask` interface (`models.ts:273-337`) has **no** `prd_selectors` field
  (confirmed: `architecture/system_context.md` Finding #1).
- `SubtaskSchema` (`models.ts:360-381`) mirrors the interface — no `prd_selectors`.
- **zod uses default STRIP** — `grep -n "passthrough\|strict\|strip\|catchall"
  src/core/models.ts` returns NOTHING. So unknown keys are silently removed on
  `parse`. The live `prd_selectors` is being **thrown away** every time
  `tasks.json` is loaded via `BacklogSchema`.

➡️ Adding the field to the schema is what makes the existing serialized data
**round-trip**. This is the real, load-bearing point of the task (not just a
type addition).

## 2. The exact edit sites in `src/core/models.ts`

**Interface** (`models.ts:273-337`) — insert `readonly prd_selectors: string[];`
immediately AFTER `readonly context_scope: string;` (line 334), per the contract
("after context_scope"). Add a JSDoc block referencing PRD §4.2 selective
extraction.

**Schema** (`SubtaskSchema`, `models.ts:360-381`) — insert
`prd_selectors: z.array(z.string()).optional().default([]),` AFTER the
`context_scope: ContextScopeSchema,` line (379). The `.optional().default([])`
makes the OUTPUT type `string[]` (so `z.ZodType<Subtask>` stays satisfied) while
allowing the INPUT to omit the key (backward compat for old `tasks.json`).

**Recursion is automatic.** `TaskSchema` (`z.array(SubtaskSchema)` @484),
`MilestoneSchema` (`z.lazy(() => TaskSchema)` @579), `PhaseSchema`
(`z.lazy(() => MilestoneSchema)` @671), `BacklogSchema` (`z.array(PhaseSchema)`
@755) all compose `SubtaskSchema`. No change needed to them — adding the key to
`SubtaskSchema` propagates through the whole tree. "Ensure BacklogSchema
recursive validation still passes" = verify with `BacklogSchema.safeParse(...)`
on a sample (existing tests cover this).

## 3. CRITICAL — what `typecheck` actually covers (blasts-radius scoping)

- `tsconfig.build.json` (used by `npm run typecheck` + `npm run build`):
  `"include": ["src/**/*"]`, `"exclude": ["node_modules","dist","tests"]`.
  ➡️ **`tests/` is NOT type-checked by `tsc`.**
- `tsconfig.json` (base) includes `tests/**/*` and is referenced by eslint
  (`parserOptions.project: "./tsconfig.json"`), but typescript-eslint does NOT
  emit raw TS compiler diagnostics (missing-property is a `tsc` diagnostic, not
  an eslint rule). So test files do not fail `npm run lint` on type errors
  either.
- vitest uses esbuild, which **strips types without checking**.

➡️ Therefore a **required** `prd_selectors: string[]` on the interface only
breaks **src/** construction sites (typecheck-enforced). Test `: Subtask`
literals are NOT enforced and won't block green (they only matter at runtime for
`toEqual` comparisons — see §4).

## 4. The ONE src/ construction site that must change

`grep -rn "type: 'Subtask'" src/` → real object literals only at:
- **`src/workflows/fix-cycle-workflow.ts:567-613`** — `#createFixSubtask(bug,
  index): Subtask` RETURNS a `Subtask` literal. With a required interface field,
  `npm run typecheck` FAILS here. FIX: add `prd_selectors: []` to the returned
  object (bug-fix subtasks have no PRD selectors — empty array is correct).
- `src/workflows/prp-pipeline.ts:940` — `{ id, title, type: 'Subtask' }` passed
  to `progressDisplay.update(...)`. This is a 3-field **display partial**, NOT a
  `Subtask` (a Subtask needs 7 fields). It does NOT break. DO NOT touch it.
- All other `type: 'Subtask'` hits in `src/core/models.ts` are inside JSDoc
  `@example` blocks (comments), not code.

➡️ Production blast radius = **1 file, 1 returned literal**.

## 5. Runtime `toEqual` breakers (the real test risk)

A `toEqual` only breaks when **parsed** Subtask data (which now gains
`prd_selectors: []`) is compared to a **fixture lacking** it. Confirmed by
grepping every `toEqual` in the subtask-touching core test files:

- **`tests/unit/core/models.test.ts:358`** —
  `expect(result.data).toEqual(validSubtask)` where `result =
  SubtaskSchema.safeParse({...validSubtask})` and `validSubtask` is the inline
  fixture at **line 334** (typed `: Subtask`, no `prd_selectors`). **BREAKS.**
  FIX: add `prd_selectors: []` to the line-334 `validSubtask`.
- `task-breakdown-schema.test.ts` — **0** `toEqual` (only `.success` checks on
  the shared `validSubtask` fixture from `tests/fixtures/task-breakdown-samples.ts`).
  The fixture lacks `prd_selectors` but is only used for `.success` assertions →
  **safe** (`.optional()` accepts absence). No edit required for green.
- The other 15 `toEqual` in `models.test.ts` (lines 1422/1542/1652/2358/2501/
  2518/2535/2653/2893/3023) are for **ValidationGate / SuccessCriterion /
  PRPDocument / PRPArtifact / RequirementChange / DeltaAnalysis / Bug /
  TestResults** — NONE parse a Subtask. Safe.
- `JSON.stringify(backlog).toEqual(originalJSON)` round-trip tests
  (`scope-resolver.test.ts:906`, `task-utils.test.ts:744`,
  `task-patcher.test.ts:681`) build the backlog from **inline literals**, not
  via `BacklogSchema.parse`, so the schema change does not touch their output.
  Safe — but VERIFY by running the suite.
- Type-level tests `models.test.ts:3180/3221` (`toEqualTypeOf<Subtask>()` /
  `expectTypeOf<InferredSubtask>().toEqualTypeOf<Subtask>()`) — both sides gain
  `prd_selectors: string[]` symmetrically, so the type-equality still holds.

➡️ Confirmed runtime breaker = **1 assertion** (models.test.ts:358). The full
`npm run test:run` gate surfaces any other; the recipe is "add `prd_selectors:
[]` to the compared fixture".

## 6. Other `: Subtask` test literals (non-blocking, optional hygiene)

`grep -rn ": Subtask = {\|as Subtask" tests/` shows ~17 `: Subtask` literals in
`models.test.ts` plus one each in `tests/manual/models-type-test.ts:24` and
`tests/integration/agents.test.ts:102,475`, plus per-file helpers like
`createTestSubtask(): Subtask` (`task-utils.test.ts:36`). Because tests are
excluded from `tsc.build` and esbuild strips types, **none of these block
green** unless used in a parse→`toEqual`. Updating them all to include
`prd_selectors: []` is good hygiene (keeps the file type-correct under a full
`tsc -p tsconfig.json`) but is NOT required by the validation gates. The PRP
marks these OPTIONAL to avoid scope creep; the gate-driven fallback
(`npm run typecheck`/`test:run`) catches anything that actually matters.

## 7. Backward-compat contract & consumption

- `.optional().default([])` ⇒ old `tasks.json` files with subtasks lacking the
  key parse to `prd_selectors: []` (contract: "existing serialized tasks.json
  files remain valid"). New files / architect output with populated selectors
  parse to the array intact.
- Consumed by **P1.M2.T1.S3** (selector extraction at PRP-generation time),
  which treats `prd_selectors` absent-or-empty as "use full PRD fallback" (PRD
  §4.2: "When selectors are absent or extraction fails, the full PRD is used").
  So `[]`/absent ≡ fallback — the consumer MUST treat both the same.
- **P1.M2.T1.S2** (section-index generator) is what POPULATES `prd_selectors`.
  This task only adds the FIELD; it does not populate it.

## 8. Parallel-execution disjointness

P1.M1.T2.S3 (running in parallel) edits `src/agents/prompts.ts` + 3
prompt-generator files + their tests. This task edits `src/core/models.ts` +
`src/workflows/fix-cycle-workflow.ts` + `tests/unit/core/models.test.ts`.
**Zero file overlap** — no merge conflict. The `prd_selectors` field is a
STANDALONE model change (contract: "No prior subtask output consumed").

## 9. Validation commands (verified in package.json)

- `npm run typecheck` = `tsc --noEmit -p tsconfig.build.json` (src/ only —
  catches the fix-cycle-workflow.ts site).
- `npm run lint` = `eslint . --ext .ts` (src + tests, type-aware but no raw TS
  diagnostics).
- `npm run format:check` = `prettier --check`.
- `npm run validate` = `lint && format:check && typecheck`.
- `npm run fix` = `lint:fix && format`.
- `npm run test:run` = `vitest run` (full suite; 100% coverage globally).
- Targeted: `npx vitest run tests/unit/core/models.test.ts tests/unit/core/task-breakdown-schema.test.ts`.