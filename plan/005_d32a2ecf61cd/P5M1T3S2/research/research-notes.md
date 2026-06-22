# Research Notes — P5.M1.T3.S2 (doc-impact declaration in delta/blueprint prompts)

Consolidated findings from codebase research. The PRP at `../PRP.md` consumes these.

## 1. The two target constants (src/agents/prompts.ts)

| Constant | Lines | Persona | Structure / insertion site |
|---|---|---|---|
| `DELTA_PRD_PROMPT` | 696–734 | Change-Manager ("Generate Delta PRD from Changes") | `## Instructions:` numbered list (1. DIFF ANALYSIS … 5. OUTPUT) then a closing 2-line paragraph. **Insert a new `6. DOC IMPACT DECLARATION`** between item 5 and the closing paragraph. |
| `PRP_BLUEPRINT_PROMPT` | 157–603 | Researcher ("Create PRP for Work Item") | `### Step 3: Research Integration` lists template sections (**Goal Section**, **Context Section**, **Implementation Tasks**, **Validation Gates**). **Insert a `**Docs Impact**:` line** after Validation Gates, before `### Step 4`. |

> Naming asymmetry noted (and followed): the item contract maps the *Change-Manager* prompt to `DELTA_PRD_PROMPT` (the bash-legacy "Generate Delta PRD from Changes" HEREDOC, NOT the newer `DELTA_ANALYSIS_PROMPT` "Requirements Change Analyst" one). The test file named in the contract — `delta-analysis-prompt.test.ts` — therefore imports `DELTA_PRD_PROMPT` (a different constant than the `createDeltaAnalysisPrompt` generator it already tests). This is intentional per the contract.

## 2. Consumers / blast radius (all ADDITIVE-safe)

- `DELTA_PRD_PROMPT` consumers: `PROMPTS.DELTA_PRD` lookup (L992) + `tests/integration/delta-prd-generation.test.ts` + `tests/integration/delta-resume-regeneration.test.ts` + `tests/unit/agents/prompts.test.ts`. **Every** assertion is `.toContain(...)` on existing substrings (e.g. `'SCOPE DELTA'`, `'$(cat "$PRD_FILE")'`, `'$SESSION_DIR/delta_prd.md'`, `'**OUTPUT**'`). Additive text cannot break a `.toContain`. No test counts instructions.
- `PRP_BLUEPRINT_PROMPT` consumers: `createPRPBlueprintPrompt()` (`src/agents/prompts/prp-blueprint-prompt.ts` L284 `system: PRP_BLUEPRINT_PROMPT` — **verbatim**), `agent-factory.ts` L233, `PROMPTS.PRP_BLUEPRINT`. Integration tests `tests/integration/prp-create-prompt.test.ts` + `tests/integration/prp-blueprint-agent.test.ts` assert `.toContain('Step 3: Research Integration')`, etc. — all additive-safe.
- Generators need NO signature change: `createPRPBlueprintPrompt(task, backlog, codebasePath?, issueFeedback?)` returns `systemOverride === PRP_BLUEPRINT_PROMPT` verbatim; additive text flows through untouched.

## 3. Test placement strategy (deterministic RED → GREEN)

### delta-analysis-prompt.test.ts (tests/unit/agents/prompts/)
- Currently imports `createDeltaAnalysisPrompt` from `../../../../src/agents/prompts/delta-analysis-prompt.js` (4-level relative path — proven runtime-correct).
- **ADD** `import { DELTA_PRD_PROMPT } from '../../../../src/agents/prompts.js';` (same 4-level pattern).
- **ADD** a new `describe('DELTA_PRD_PROMPT doc-impact declaration (PRD §6.4)', ...)` block asserting on the constant directly (the generator does not expose DELTA_PRD_PROMPT, so a direct import is required).

### prp-blueprint-prompt.test.ts (tests/unit/agents/prompts/)
- File already calls `createPRPBlueprintPrompt(task, mockBacklog)` and asserts on `prompt.systemOverride`.
- `systemOverride` IS `PRP_BLUEPRINT_PROMPT` verbatim (generator L284). **No new import needed.**
- **ADD** a new `describe('PRP_BLUEPRINT_PROMPT DOCS impact reminder (PRD §6.4)', ...)` that calls the existing fixture and asserts on `prompt.systemOverride` (path-safe; reuses established pattern).

## 4. Critical toolchain facts

- `npm run validate` = `npm run lint && npm run format:check && npm run typecheck`.
  - `lint` = `eslint . --ext .ts`
  - `format:check` = `prettier --check "**/*.{ts,js,json,md,yml,yaml}"` (covers `src/agents/prompts.ts`)
  - `typecheck` = `tsc --noEmit -p tsconfig.build.json`
- **`tsconfig.build.json` excludes `tests`** (`"exclude": ["node_modules","dist","tests"]`). So `npm run typecheck` does NOT typecheck test files — only `src/`. This is why the existing `../../../src/core/models.js` (3-level, technically wrong) `import type` in sibling test files doesn't fail validation (it's erased at runtime by vitest/esbuild and never type-checked). Implication: test import paths need only be **runtime-correct**, and an `import type` can survive a slightly-off path — but our value imports use the proven 4-level relative path anyway.
- Vitest alias: `#` → `src/agents` (so `#/prompts/index.js` = `src/agents/prompts/index.js`). We avoid the alias for the constant to prevent confusion with the `prompts/` subdir.
- prettier does **NOT** reformat inside template literals — so HEREDOC markdown spacing is ours to control; just keep surrounding TS valid. Backticks inside the section must be `` \` ``-escaped (the existing constants already do this, e.g. `\`$SESSION_DIR/delta_prd.md\``).
- Coverage 100% is enforced ONLY by `npm run test:coverage`, NOT by `npm run test:run`/`npm run validate`. Editing string constants does not change coverage.

## 5. TDD + scope discipline (per architecture/implementation_notes.md §7, §10)

- Write the failing assertion blocks FIRST (RED), confirm with `npm run test:run -- delta-analysis-prompt prp-blueprint-prompt`, THEN insert the prompt text (GREEN).
- `npm run validate` + `npm run test:run` are the gates (§10).
- Parallel safety vs S1: S1 edits `TASK_BREAKDOWN_PROMPT` (L33–146) + `tests/unit/agents/prompts.test.ts`. S2 edits `DELTA_PRD_PROMPT` (L696) + `PRP_BLUEPRINT_PROMPT` (L157) in the same `src/agents/prompts.ts` file + two files under `tests/unit/agents/prompts/`. Different constants + different test files → localized edits avoid merge conflicts. Also disjoint from S4 (`src/core/*` + `docs/WORKFLOWS.md`).
- OUT OF SCOPE: `DELTA_ANALYSIS_PROMPT`, `PRP_BUILDER_PROMPT`, `TASK_BREAKDOWN_PROMPT` (S1 owns), `PROMPTS.md` (legacy), any `docs/*.md` (DOCS: [Mode A] none — this subtask IS the declaration mechanism), any generator signature.
