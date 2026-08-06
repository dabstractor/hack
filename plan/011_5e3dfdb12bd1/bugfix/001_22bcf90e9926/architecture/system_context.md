# System Context — BUG-001: G1.4 Throwaway-Survival Blueprint Prompt Gap

## Bug Summary

**PRD §9.9.2 G1.4** mandates: *"The Blueprint and Builder prompts MUST instruct the Coder Agent **not** to delete a throwaway artifact (e.g. a spike file) during its own turn; any cleanup happens after validation."*

**BUG-001**: The Builder prompt (`PRP_BUILDER_PROMPT`) satisfies this requirement. The Blueprint prompt (`PRP_BLUEPRINT_PROMPT`) does NOT — its gate-construction CRITICAL RULES block enumerates G1.1, G1.2, G1.3, and G1.5 but omits G1.4 entirely.

## Verified Code Locations

### Source: `src/agents/prompts.ts` (1346 lines total)

| Symbol | Lines | Role |
|---|---|---|
| `PRP_BLUEPRINT_PROMPT` | 182–677 | Researcher/Blueprint prompt — **MISSING G1.4** |
| `PRP_BUILDER_PROMPT` | 678–~1346 | Coder/Builder prompt — **HAS G1.4** (lines 747–765) |

**Blueprint CRITICAL RULES block** (the `### Step 3: Research Integration` → `**Validation Gates**` sub-section), current bullet order:
- Line 290: G1.1 (negative file-existence gates forbidden)
- Line 291: G1.2 (scope boundaries are never shell gates)
- Line 292: G1.3 (cleanup/throwaway deletion is never a shell gate)
- **Line 293: G1.5** (negated content gates only on permanent own-deliverable absence) ← **G1.4 is SKIPPED — must be inserted between 292 and 293**

**Builder G1.4 block** (lines 747–765): A multi-paragraph section titled `**Do not delete throwaway / spike artifacts during your turn (PRD §9.9 G1.4).**` that explains the terminal-state batch re-run rationale and composes with the FORBIDDEN ACTIONS block. This is correctly placed and complete.

### Docs Mirror: `PROMPTS.md` (47605 bytes)

Same gap. The Blueprint's CRITICAL RULES block at lines 268–277:
- Line 274: G1.1
- Line 275: G1.2
- Line 276: G1.3
- **Line 277: G1.5** ← **G1.4 must be inserted between 276 and 277**

The Builder section correctly carries G1.4 at lines 710–715.

### Spec: `spec/16-validation-gates.md` (line 27)

Verbatim G1.4 requirement:
> **G1.4 — Throwaway artifacts survive the coder's turn.** The Blueprint and Builder prompts MUST instruct the Coder Agent **not** to delete a throwaway artifact (e.g. a spike file) during its own turn; any cleanup happens after validation. This guarantees the terminal state still satisfies the artifact's _existence_ gates (1–3 in the spike example), which G1.3 then removes the contradicting _absence_ gate (4) from. (Without G1.4, neutralizing only the absence gate would still leave the existence gates failing on a post-delete tree.)

### Split Prompt Wrapper: `src/agents/prompts/prp-blueprint-prompt.ts`

Imports and embeds `PRP_BLUEPRINT_PROMPT` from `../prompts.js` (the monolith). No shadowing, no contradictory gate guidance. Editing the monolith is sufficient — no separate split-file edit needed.

## Test Locations

### `tests/unit/agents/prompts.test.ts`

- **Lines 283–309**: `describe('PRP_BLUEPRINT_PROMPT gate monotonicity rules (PRD §9.9 REQ-G1)')` — tests G1.1, G1.2, G1.3, G1.5 but **NOT G1.4** for the Blueprint prompt. A new `it()` case for G1.4 must be added here.
- **Lines 360–400**: `describe('PRP_BUILDER_PROMPT throwaway-survival + terminal-state re-execution (PRD §9.9 G1.4)')` — already tests G1.4 for the Builder prompt using `toContain('G1.4')`, `toMatch(/throwaway/i)`, `toMatch(/spike/i)`, `toMatch(/do not delete throwaway/i)`, `toMatch(/survive on disk/i)`, `toMatch(/after validation/i)`.

### `tests/unit/agents/prp-executor.test.ts`

- **Line 258**: `it('neutralizes a negated file-existence gate (G2.1): skipped, execute_bash NOT called, run succeeds')` — asserts shape (`skipped: true`, `success: true`, `exitCode: null`, `execute_bash` not called for neutralized command) but does **NOT** assert the info-level log message. The logger module is NOT mocked in this test file.

### `tests/unit/agents/gate-semantics.test.ts`

- 42-line test file testing the pure `isNegatedFileExistenceGate` detector. No executor integration.

### `tests/integration/prp-executor-integration.test.ts`

- Uses real `createCoderAgent()` + real `BashMCP` but mocks `agent.prompt()`. No neutralization test currently exists. The logger module is also NOT mocked here.

## Executor Neutralization Code Path

`src/agents/prp-executor.ts` line 553–574: When `isNegatedFileExistenceGate(gate.command)` returns true, the executor:
1. Calls `this.#logger.info({ level, description, command }, 'non-monotonic negative-existence gate neutralized — file existence is owned by the task graph / is a cleanup step, not a terminal-state assertion (§9.9)')`
2. Pushes a `{ skipped: true, success: true, exitCode: null, ... }` result
3. `continue` — skips `execute_bash`

The logger is `getLogger('PRPExecutor')` from `src/utils/logger.ts` (pino-based). To assert the log message in tests, the logger module must be mocked/spied.

## Key Patterns & Conventions

- **Blueprint gate-construction bullets**: bold-headed, single-paragraph, referencing `PRD §9.9 G1.x`. Each bullet is a gate-construction rule for the Researcher (not direct coder instruction).
- **Builder G1.4 block**: A multi-paragraph section with explicit terminal-state re-execution rationale. Addresses the Coder directly.
- **Test assertion style**: `expect(PRP_BLUEPRINT_PROMPT).toContain('G1.4')` + additional content/phrase assertions.
- **PROMPTS.md**: Faithful reference mirror of `src/agents/prompts.ts`. Uses markdown (no escaped backticks) vs. the TS template literal (escaped backticks).

## Functional Impact Assessment

**LOW** — The Builder carries the Coder-facing G1.4 instruction, and the Blueprint's G1.3 already prevents the harmful `test ! -f <throwaway>` gate from being authored. The §9.9.3 acceptance criteria remain satisfiable. However, the literal spec requirement is only half-satisfied, and the Blueprint does not reinforce throwaway-survival into the generated PRP's success criteria / coder instructions.

## Test Commands

```bash
npx vitest run tests/unit/agents/prompts.test.ts         # prompt content tests
npx vitest run tests/unit/agents/prp-executor.test.ts     # executor unit tests
npx vitest run tests/unit/agents/gate-semantics.test.ts   # detector tests
npx vitest run tests/integration/prp-executor-integration.test.ts  # integration
npm run typecheck                                          # tsc --noEmit -p tsconfig.build.json
```