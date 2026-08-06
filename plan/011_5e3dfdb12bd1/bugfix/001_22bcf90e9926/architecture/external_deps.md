# External Dependencies & Spec References — BUG-001

## Spec Source of Truth

**File**: `spec/16-validation-gates.md`
**Section**: `### 9.9 Validation Gate Semantics (Monotonicity & Terminal-State Re-Execution)`

### REQ-G1 Gate-Construction Guardrails (§9.9.2)

The Blueprint (Researcher/PRP-creation) prompt's gate-construction CRITICAL RULES block must enumerate all five guardrails:

| Rule | ID | Current Blueprint Status |
|---|---|---|
| No negative file-existence gates | G1.1 | ✅ Present (line 290) |
| Scope boundaries are never shell gates | G1.2 | ✅ Present (line 291) |
| Cleanup/throwaway deletion is never a shell gate | G1.3 | ✅ Present (line 292) |
| **Throwaway artifacts survive the coder's turn** | **G1.4** | **❌ MISSING — must be added** |
| Negated content gates only on permanent own-deliverable absence | G1.5 | ✅ Present (line 293) |

### Acceptance Criteria (§9.9.3) relevant to G1.4

> A spike/throwaway PRP does not contain a `test ! -f <throwaway>` gate; the throwaway is not deleted during the coder's turn, so its existence gates pass on the terminal state. (G1.3, G1.4)

> Re-running `pi-nvim-bridge-hack` `P1.M1.T1.S1` after regenerating its PRP (cache cleared) passes: the spike survives the coder's turn (gates 1–3 pass on terminal state) and the cleanup gate is `manual`. (G1.3, G1.4)

## No External Package Dependencies

This bugfix involves only:
1. Editing prompt text strings in `src/agents/prompts.ts` (template literals)
2. Mirroring the same text in `PROMPTS.md` (markdown)
3. Adding test assertions in `tests/unit/agents/prompts.test.ts` (vitest `toContain`/`toMatch`)
4. Optionally: logging assertions and integration tests (vitest, pino logger spying)

No new npm packages are needed. No API endpoints, no schema migrations, no config changes.

## Build/Typecheck

- `tsconfig.build.json` is the typecheck target (`npm run typecheck` = `tsc --noEmit -p tsconfig.build.json`)
- The 680 pre-existing `tsc` diagnostics are all in test files (excluded from `tsconfig.build.json`) — none touch §9.9 source
- `src/agents/prompts.ts` is source (included in build typecheck)