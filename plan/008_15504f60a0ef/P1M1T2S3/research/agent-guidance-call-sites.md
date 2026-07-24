# Research Note — P1.M1.T2.S3: Add pre-merged PRD guidance to all PRD-embedding prompts

> PRD §2.3 “Agent guidance”: *“Agent prompts that embed PRD content MUST state that the text they
> receive is already the complete merged document (agents must not chase includes themselves).”*
> Contract requires the statement in **4 prompt constants** (prompts.ts) AND **3 prompt-generator
> functions** (architect/bug-hunt/delta-analysis-prompt.ts).

## 0. Canonical wording (from the contract — use VERBATIM)
> The PRD text provided is already the complete, merged document — do not chase @include directives yourself.

Two stable substrings for test assertions (em-dash in the middle):
- `already the complete, merged document`
- `do not chase @include directives yourself`

## 1. Call-site inventory (verified in repo)

### A. The 4 prompt CONSTANTS in `src/agents/prompts.ts`
| Constant | Decl line | Header line | Used as `system:` by |
|---|---|---|---|
| `TASK_BREAKDOWN_PROMPT` | 33 | 34 `# LEAD TECHNICAL ARCHITECT & PROJECT SYNTHESIZER` | `createArchitectPrompt` |
| `PRP_BLUEPRINT_PROMPT`  | 166 | 167 `# Create PRP for Work Item` | `createPRPBlueprintPrompt` |
| `DELTA_ANALYSIS_PROMPT` | 761 | 762 `# PRD Delta Analysis` | `createDeltaAnalysisPrompt` |
| `BUG_HUNT_PROMPT`       | 884 | 885 `# Creative Bug Finding - End-to-End PRD Validation` | `createBugHuntPrompt` |

- **All four are pure string literals** — `${}` interpolation count = 0 in each (awk-verified). ⇒
  interpolating a shared `${PRD_PREMERGED_DECLARATION}` after the header line is safe and DRY.
- Do **NOT** add the new constant to the `PROMPTS` lookup object (line ~1004) or the `PromptKey`
  union — `tests/unit/agents/prompts.test.ts` asserts `Object.keys(PROMPTS).toHaveLength(6)`.
  `PRD_PREMERGED_DECLARATION` is a guidance fragment, not a persona prompt.

### B. The 3 prompt-generator FUNCTIONS (contract list)
| File | Function | How it embeds PRD today |
|---|---|---|
| `src/agents/prompts/architect-prompt.ts` | `createArchitectPrompt(prdContent, sessionPath?)` | `user: prdContent` (RAW), `system: TASK_BREAKDOWN_PROMPT` (+path subst) |
| `src/agents/prompts/bug-hunt-prompt.ts` | `createBugHuntPrompt(prd, tasks, outputPath?)` → `constructUserPrompt` | `user: fileBanner + constructUserPrompt(prd,…)`; PRD under `## Original PRD`; **also appends `${BUG_HUNT_PROMPT}` to user**; `system: BUG_HUNT_PROMPT` |
| `src/agents/prompts/delta-analysis-prompt.ts` | `createDeltaAnalysisPrompt(oldPRD,newPRD,ids?)` → `constructUserPrompt` | `user: constructUserPrompt(…)`; old under `## Previous PRD`, new under `## Current PRD`; **also appends `${DELTA_ANALYSIS_PROMPT}` to user**; `system: DELTA_ANALYSIS_PROMPT` |

### C. `createPRPBlueprintPrompt` (NOT in contract list — covered transitively)
`prp-blueprint-prompt.ts` `constructUserPrompt` **appends `${PRP_BLUEPRINT_PROMPT}` to the user
prompt** (line 233) AND uses it as `system`. ⇒ adding the statement to the `PRP_BLUEPRINT_PROMPT`
constant automatically surfaces it in BOTH the researcher's system and user prompt. This is why the
contract deliberately omits `createPRPBlueprintPrompt` from the function list — no separate edit
needed (verified; do not double-add).

### D. Deliberately OUT of scope (per contract enumeration)
- `DELTA_PRD_PROMPT` (line 710) — generates a delta PRD; not an agent prompt embedding the merged doc.
- `PRP_BUILDER_PROMPT` (line 628) — executor prompt; embeds the **PRP**, not the PRD.

## 2. Test-safety analysis (verified — NO existing assertion breaks)

- `tests/unit/agents/prompts.test.ts` — every assertion is `toContain` on the constant runtime
  value (e.g. `TASK_BREAKDOWN_PROMPT`). Interpolating the declaration only ADDS text ⇒ all pass.
  Header assertions (`LEAD TECHNICAL ARCHITECT`, `Create PRP for Work Item`, `PRD Delta Analysis`,
  `Creative Bug Finding`) still hold (header lines untouched).
- `tests/integration/task-breakdown-prompt.test.ts`, `bug-finding-prompt.test.ts`,
  `prp-create-prompt.test.ts` — all assert `toContain` on the CONSTANTS, never on a function's
  `user`/`systemOverride` equality. Safe.
- `tests/unit/agents/prompts/bug-hunt-prompt.test.ts` — asserts `prompt.user` `toContain`
  (`## Original PRD`, PRD text, `---`). Prefixing the declaration before `## Original PRD` keeps
  `toContain` true. No order assertion across PRD↔tasks↔phases.
- `tests/unit/agents/prompts/delta-analysis-prompt.test.ts` — order tests:
  `indexOf('## Previous PRD') < indexOf('## Current PRD')` and `indexOf('## Completed Tasks') >
  indexOf('## Current PRD')`. Prefixing the declaration before `## Previous PRD` shifts all indices
  up equally ⇒ relative order preserved. ⚠️ Must NOT introduce a spurious `## Previous PRD` /
  `## Current PRD` / `## Completed Tasks` header in the declaration block — use a DISTINCT label
  (the canonical wording is plain prose/blockquote, no `## ` header).
- grep for `prompt.(user|systemOverride) ===` / `!====` across `tests/` → **zero hits**. Confirms
  no strict-equality assertion on any function's prompt fields.

## 3. Design decision — single shared constant + dual-channel injection

**Single source of truth:** declare `export const PRD_PREMERGED_DECLARATION = …` once in
`prompts.ts` (top, after imports, before line 33). All 7 sites reference it.

**Dual-channel (system + user) is INTENTIONAL, per the contract's explicit enumeration of both the
constants and the functions:**
- The 4 CONSTANTS carry the statement at the **persona/system** level (contract item 1).
- The 3 FUNCTIONS inject it into the **user prompt adjacent to the PRD content** (contract item 2 —
  the most PRD-§2.3-correct placement: the declaration sits right next to the PRD text it modifies).
  This is the only non-redundant place to honor “also add it to the functions,” since each function
  already pulls its constant in as `system`.

Net effect per agent:
- **Architect**: declaration in `system` (TASK_BREAKDOWN_PROMPT) + `user` (injected before
  `prdContent`). Architect's user prompt had NO constant before ⇒ the user injection is essential.
- **Bug-hunt / Delta-analysis**: declaration in `system` + `user` (injected before the PRD section) +
  additionally at the tail of `user` via the appended constant. The tail occurrence is pre-existing
  behavior (they append the constant); the contract’s “also add to the function” is satisfied by the
  PRD-adjacent injection. Triple occurrence for these two is acceptable/defensive — important invariant.
- **Researcher (PRP blueprint)**: declaration in `system` + `user` (both via the constant; no extra
  injection — transitively covered, contract omits the function).

## 4. Parallel-execution disjointness vs S1/S2 (no file conflicts)
- S2 edits: `src/core/session-manager.ts`, `src/workflows/prp-pipeline.ts`,
  `src/workflows/delta-analysis-workflow.ts`, `tests/unit/core/session-manager.test.ts`.
- S3 edits: `src/agents/prompts.ts`, `src/agents/prompts/architect-prompt.ts`,
  `src/agents/prompts/bug-hunt-prompt.ts`, `src/agents/prompts/delta-analysis-prompt.ts`, + tests.
- **Zero file overlap.** Note: `delta-analysis-workflow.ts` (S2) ≠ `delta-analysis-prompt.ts` (S3).
- S3’s “INPUT: resolved-document pipeline from S2” is a LOGICAL dependency (the guidance is TRUE
  because S2 made the delta path resolved-correct), not a file dependency. S3 can land independently.

## 5. Validation commands (verified in package.json)
`npm run typecheck` · `npm run lint` · `npm run format:check` · `npm run test:run` · `npm run fix`
(= lint:fix + prettier --write). 100% coverage globally enforced (vitest.config.ts) — the new
constant + injection lines are covered by the 4-constant assertions + the 3 function unit tests.