# Research Findings — P5.M1.T3.S1: Two-mode doc-sync rule in TASK_BREAKDOWN_PROMPT

## Subtask essence (CONTRACT from item description)
- **Pure prompt-text change** to `TASK_BREAKDOWN_PROMPT` (a HEREDOC `as const` string constant in
  `src/agents/prompts.ts`). NO mocking, NO network, NO runtime behavior change, NO signature change.
- Adds an explicit **"DOCUMENTATION SYNC (TWO MODES)"** section implementing PRD §6.1.
- Consumed UNCHANGED by `createArchitectPrompt(prdContent)` (`src/agents/prompts/architect-prompt.ts`),
  which uses it as `system: TASK_BREAKDOWN_PROMPT` + `responseFormat: BacklogSchema`. Pure additive text
  → the Architect agent automatically picks up the new rule.
- **TDD**: write the failing string-assertion test first in `tests/unit/agents/prompts.test.ts`, then
  insert the section text, then pass `npm run validate` + `npm run test:run`.
- **DOCS [Mode A]: none** — this subtask IS the doc-sync mechanism (the prompt text itself). NO external
  doc file (no WORKFLOWS.md / ARCHITECTURE.md / CONFIGURATION.md) is touched.

## Files in scope (EXACT — only 2)
1. `src/agents/prompts.ts` — insert the new section into the `TASK_BREAKDOWN_PROMPT` constant.
2. `tests/unit/agents/prompts.test.ts` — add a new `describe(...)` block of string assertions.

## Current TASK_BREAKDOWN_PROMPT structure (verified by reading prompts.ts)
```
## CRITICAL CONSTRAINTS & STANDARD OF WORK (SOW)
  ### 1. RESEARCH-DRIVEN ARCHITECTURE (NEW PRIORITY)
  ### 2. COHERENCE & CONTINUITY
  ### 3. IMPLICIT TDD & QUALITY          <-- "DO NOT create subtasks for 'Write Tests.'"
  ### 4. THE "CONTEXT SCOPE" BLINDER     <-- INPUT / OUTPUT / MOCKING bullets
---                                          <-- insertion anchor: insert NEW ### 5 BEFORE this ---
## PROCESS
## OUTPUT FORMAT   (contains the ```json backlog template)
```
- **Insertion point (lowest-risk, no renumbering):** a NEW `### 5. DOCUMENTATION SYNC (TWO MODES)`
  immediately AFTER the `### 4. THE "CONTEXT SCOPE" BLINDER` bullet list (after the MOCKING line) and
  BEFORE the `---` separator that closes the SOW section. Keeps it a sibling of the TDD rule.
- The existing test only asserts `'LEAD TECHNICAL ARCHITECT'` + `'PROJECT SYNTHESIZER'` + `'```json'`
  — none of these are near the insertion site, so additive text CANNOT break existing assertions.

## Existing test file conventions (verified — tests/unit/agents/prompts.test.ts)
- `import { ..., TASK_BREAKDOWN_PROMPT, ... } from '../../../src/agents/prompts.js';` (NOTE `.js` ESM).
- Existing blocks: `describe('prompt exports')`, `describe('prompt content validation')`,
  `describe('PROMPTS lookup object')`, `describe('formatting preservation')`.
- Idiom is `expect(TASK_BREAKDOWN_PROMPT).toContain('exact phrase')`.
- A new sibling `describe('two-mode documentation sync rule (PRD §6.1)', ...)` with 3-4 `it(...)` cases
  using `.toContain` for invariants and `.toMatch(/.../i)` for category words is the right shape.

## Toolchain facts (verified — package.json + tsconfig.json + vitest.config.ts)
- `npm run validate` = `npm run lint && npm run format:check && npm run typecheck`.
  - `lint` = `eslint . --ext .ts`.
  - `format:check` = `prettier --check "**/*.{ts,js,json,md,yml,yaml}"` → **checks prompts.ts + the test file**.
  - `typecheck` = `tsc --noEmit -p tsconfig.build.json` → a string-constant edit is type-neutral.
- `npm run test:run` = `vitest run` (include `tests/**/*.{test,spec}.ts`, globals:true, setup `./tests/setup.ts`).
- **Coverage threshold = 100%** (vitest.config.ts) — but ONLY enforced by `npm run test:coverage`, NOT by
  `npm run test:run` or `npm run validate`. Editing a string constant does not reduce coverage anyway.
  → A string-constant edit + additive test does not threaten coverage; safe.
- `.prettierrc` exists → after editing prompts.ts, run `npm run format` (writes) then `npm run validate`.
- ESM rule: source imports use `.js` specifiers (the test already imports `prompts.js`); no import added here.

## Parallel-context safety (R3 cluster + S4)
- **P5.M1.T2.S4** (running in parallel) edits `src/core/task-orchestrator.ts`, `src/core/research-queue.ts`,
  their unit tests, and `docs/WORKFLOWS.md`. **ZERO file overlap** with this subtask → safe to run concurrently.
- **P5.M1.T3.S2** (sibling, Planned — NOT in parallel yet) will edit `PRP_BLUEPRINT_PROMPT` and/or
  `DELTA_PRD_PROMPT` constants in the **same file** `src/agents/prompts.ts`. S1 owns the
  `TASK_BREAKDOWN_PROMPT` constant ONLY; keep the edit localized to that constant's region (lines ~37-150)
  and the new test in its own describe block to avoid a future merge conflict with S2.

## PROMPTS.md (legacy) — OUT OF SCOPE
- `prompts.ts` JSDoc says "Source: PROMPTS.md lines 54-169", but `PROMPTS.md` is the **legacy bash** source.
  The **runtime** consumer is `prompts.ts` via `createArchitectPrompt`. The item's OUTPUT contract is
  explicitly the `TASK_BREAKDOWN_PROMPT` constant only; it does NOT mention PROMPTS.md. Editing PROMPTS.md
  is optional and NOT required for any validation gate or test → leave it out of scope to stay tight.

## Canonical section text (drives both the prompt AND the test assertions — guaranteed consistent)
See PRP.md "Implementation Blueprint → Data models and structure". Every test assertion is derived from a
substring present in the canonical text, so RED→GREEN is deterministic.
