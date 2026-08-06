# Bug Fix Requirements

## Overview
Creative end-to-end validation of the PRD §9.9 (Validation Gate Semantics — Monotonicity & Terminal-State Re-Execution) delta for session 011. Testing covered all four implemented layers: (1) the `isNegatedFileExistenceGate` pure detector (src/agents/gate-semantics.ts) — probed with a 16-case adversarial table covering all 4 canonical negated-existence forms (`! test -f`, `test ! -f`, `! [ -e ]`, `[ ! -d ]`), negated content (`! grep -q` → executes, G2.2), ambiguous (`test -n`, `[[ ]]`, full-path `/bin/test`, double-negation, compound `&&`) all executing normally (G2.3), and boundary inputs (empty/whitespace/tabs/leading newline); the detector is precise with zero dangerous false positives on realistic commands because shell semantics guarantee the matched prefixes are always negation. (2) The executor integration (src/agents/prp-executor.ts #runValidationGates) — neutralized gates use a result shape identical to the manual/null skip, BashMCP is NOT invoked for them, aggregation `every(r => r.success || r.skipped)` counts them as passed, the fix-retry error context excludes skipped gates, and the watchdog terminal-abort path (§9.3.2) is unaffected; confirmed #runValidationGates is the only mechanical gate-execution path (no bypass). (3) Runtime effectiveness — verified the §9.9-edited monolithic `prompts.ts` IS what reaches the model: `agent-factory.ts` sets `system: PRP_BLUEPRINT_PROMPT`/`PRP_BUILDER_PROMPT`, and the split `prompts/prp-blueprint-prompt.ts` wrapper embeds the monolithic base (`${PRP_BLUEPRINT_PROMPT}`) rather than shadowing it; no contradictory gate guidance exists in any split file and there is no split builder file. (4) Docs — README, docs/ARCHITECTURE.md, and the PROMPTS.md mirror are all synced to §9.9, and the runtime log reason string matches the PRD G2.1 wording verbatim. Verification: src-only `tsc --noEmit` clean (exit 0); 40 detector+executor unit tests pass, 84 prompt-content tests pass, 11 executor integration tests pass. The 680 `tsc` diagnostics are all pre-existing in test files (excluded from the build/typecheck config) and none touch §9.9 source. Net assessment: the §9.9 implementation is correct, robust, and well-tested. One minor literal spec deviation found (BUG-001): G1.4's throwaway-survival instruction is present in the Builder but missing from the Blueprint prompt, whereas PRD §9.9.2 G1.4 mandates it in both; functional impact is low because the Builder carries the Coder-facing rule and G1.3 already blocks the harmful gate from being authored.


## Critical Issues (Must Fix)
Issues that prevent core functionality from working.

None.


## Major Issues (Should Fix)
Issues that significantly impact user experience or functionality.

None.


## Minor Issues (Nice to Fix)
Small improvements or polish items.

### Issue 1: G1.4 throwaway-survival instruction is missing from the Blueprint (Researcher) prompt — PRD §9.9.2 requires it in BOTH the Blueprint and Builder prompts
**Severity**: Minor
**ID**: BUG-001
**Location**: src/agents/prompts.ts:285-293 (PRP_BLUEPRINT_PROMPT gate-construction rules — G1.4 absent); required by spec alongside the present Builder implementation at src/agents/prompts.ts:750-765

**Description**:
PRD §9.9.2 REQ-G1 bullet G1.4 states verbatim: "The Blueprint AND Builder prompts MUST instruct the Coder Agent not to delete a throwaway artifact (e.g. a spike file) during its own turn; any cleanup happens after validation." The Builder (Coder) prompt satisfies this — `PRP_BUILDER_PROMPT` in `src/agents/prompts.ts` carries the "Do not delete throwaway / spike artifacts during your turn (PRD §9.9 G1.4)" block (lines ~750-765). However the Blueprint (Researcher) prompt `PRP_BLUEPRINT_PROMPT` (lines 182-677) does NOT contain any G1.4 throwaway-survival instruction: its gate-construction CRITICAL RULES block (lines 285-293) enumerates G1.1, G1.2, G1.3, and G1.5 only. The only "do not delete" text in the Blueprint (line ~206) concerns pipeline-state files (PRD.md/PRP.md/tasks.json), not throwaway/spike artifacts. The literal "Blueprint and Builder prompts MUST ..." requirement is therefore only half-satisfied. Functional impact is low: the Builder carries the Coder-facing instruction and the Blueprint's G1.3 already prevents the harmful `test ! -f <throwaway>` gate from being authored, so the §9.9.3 acceptance criteria (spike survives the coder's turn; cleanup gate is `manual`) remain satisfiable — but the spec's explicit dual-prompt requirement is incomplete, and the Blueprint does not reinforce throwaway-survival into the generated PRP's success criteria. The PROMPTS.md reference mirror (lines 268-277) faithfully reproduces the same gap, so docs and code are at least consistent with each other. Verified via grep: no `survive`/`do not delete`/`G1.4`/`after validation` text exists anywhere in PRP_BLUEPRINT_PROMPT (lines 182-677).

**Steps to Reproduce**:
1. Open `src/agents/prompts.ts`.
2. Inspect `PRP_BLUEPRINT_PROMPT` (exported at line 182, spanning lines 182-677) — the Researcher/Blueprint prompt.
3. Read the gate-construction `CRITICAL RULES for gate commands` block at lines 285-293: it lists G1.1 (line 290), G1.2 (291), G1.3 (292), G1.5 (293) but NO G1.4 throwaway-survival bullet.
4. Confirm via: `awk 'NR>=182 && NR<=677' src/agents/prompts.ts | grep -ni 'G1\.4\|survive\|do not delete throwaway'` → no match for the throwaway-survival instruction.
5. Contrast with `PRP_BUILDER_PROMPT` (line 678+) which DOES contain the `Do not delete throwaway / spike artifacts during your turn (PRD §9.9 G1.4)` block (lines ~750-765).
6. Compare against PRD §9.9.2 G1.4 which mandates the instruction in BOTH prompts. Expected: G1.4 throwaway-survival guidance present in PRP_BLUEPRINT_PROMPT; actual: absent.

## Testing Summary
- Total bugs found: 1
- Critical: 0
- Major: 0
- Minor: 1

## Recommendations
- Add a short G1.4 throwaway-survival bullet to PRP_BLUEPRINT_PROMPT's gate-construction CRITICAL RULES block (src/agents/prompts.ts ~line 293) so the Researcher is guided to surface throwaway-survival in generated PRPs, fully satisfying PRD §9.9.2 G1.4's 'Blueprint and Builder prompts' wording. Mirror the same addition into PROMPTS.md (lines ~268-277) to keep the reference doc in lockstep.
- Optional test-coverage hardening: add an assertion that the executor emits the §9.9 neutralization log reason (currently the unit test asserts the skipped/success/exitCode shape and that BashMCP is not called, but does not assert the info-level log message is emitted); and add one integration test exercising the neutralization through the real BashMCP path.
