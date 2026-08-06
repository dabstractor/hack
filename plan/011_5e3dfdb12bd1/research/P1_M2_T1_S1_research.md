# Research Notes — P1.M2.T1.S1: pure `isNegatedFileExistenceGate` detector + unit-test table

## Work item scope (TIGHT)
- S1 = **pure exported function + green unit-test table ONLY**.
- S2 (`P1.M2.T1.S2`, sibling, status Planned) = wire the detector into
  `PRPExecutor.#runValidationGates()` + executor integration tests.
- Therefore S1 must **NOT** edit `#runValidationGates`, the `ValidationGate`
  model, or any prompt. It only adds the function + its test.

## Verified facts (working tree, 2026-08-06)
1. **No existing detector** in the gate path. `grep -rn "neutraliz|isNegated|negative.existence" src/`
   returns only `src/utils/cli-help-parser.ts` (`isNegatedFlag` for `--no-` CLI flags) — unrelated.
2. `PRPExecutor.#runValidationGates()` lives in `src/agents/prp-executor.ts`; the manual/null-command
   **skip block** (`if (gate.manual || gate.command === null) { ... skipped:true, success:true ... continue }`)
   is the exact shape the S2 neutralization branch will mirror. `BashMCP.execute_bash(...)` is called
   after that block at `cwd: process.cwd()`.
3. `ValidationGate` interface at `src/core/models.ts` L1271 already has `manual: boolean` and
   `command: string | null`; `ValidationGateSchema` transform maps a null command → `manual:true`.
   **No schema change needed. Do not edit the model.**
4. Sibling S2 confirmed in `tasks.json`: "Integrate the detector into PRPExecutor.#runValidationGates
   and add executor integration tests". So S1's export is the sole contract S2 imports.

## Placement decision
- **Recommended: dedicated pure module `src/agents/gate-semantics.ts`.** It is a zero-dependency leaf
  module → the unit test imports only the function (no mocking of groundswell / BashMCP /
  checkpoint-manager / agent-factory, which `prp-executor.ts` drags in). Mirrors existing small
  pure-utility modules. S2 imports it with one line.
- Co-located export in `prp-executor.ts` is the documented alternative (work item + impl-status §B.2
  both say "either is acceptable"), but it forces the test to either mock the executor's deps or live
  inside `prp-executor.test.ts`. Dedicated module is strictly cleaner for a pure function.

## Detector logic design (conservative per G2.3)
Two unambiguous negated-existence forms (PRD §9.9.2 G2.1):
- **Leading bang**: `!` then `test`/`[` then an existence flag `-f`/`-e`/`-d` → `! test -f X`, `! [ -e X ]`
- **Inner bang**: `test`/`[` then `!` then existence flag → `test ! -f X`, `[ ! -d X ]`

Recommended regex pair (anchored at `^`, existence flag via `-[fed]`, word boundary `\b`):
- `LEADING = /^\s*!\s+(?:test|\[)\s+-[fed]\b/`
- `INNER   = /^\s*(?:test|\[)\s+!\s+-[fed]\b/`
- `return typeof command === 'string' && command.trim() !== '' && (LEADING.test(command) || INNER.test(command))`

### Table verification (all pass)
| command | LEADING | INNER | result | expected |
| - | - | - | - | - |
| `! test -f src/hooks/index.ts` | ✓ | — | true | true |
| `test ! -f x` | — | ✓ | true | true |
| `! [ -e x ]` | ✓ | — | true | true |
| `[ ! -d x ]` | — | ✓ | true | true |
| `! grep -q TODO src/x.ts` | ✗ (needs test/[ after !) | ✗ (starts with !) | false | false |
| `test -f x` | ✗ (no leading !) | ✗ (-f not ! after test) | false | false |
| `npm test` | ✗ | ✗ | false | false |
| `grep -q foo x` | ✗ | ✗ | false | false |
| `test -n foo` (ambiguous) | ✗ | ✗ (-n not !) | false | false |
| `test foo` (ambiguous) | ✗ | ✗ | false | false |

### Intentionally NOT matched (conservative → executes normally, G2.3)
- Compound: `test -f x -a ! -f y` (INNER requires `!` immediately after `test`/`[`; here `-f` follows).
- Wrappers: `bash -c '! test -f x'` (leading token is `bash`, not `!`/`test`/`[`).
- Other flags: `-n`/`-z`/string tests (`-[fed]` excludes them).

## Test conventions (verified)
- vitest; `import { describe, expect, it } from 'vitest'`.
- Table-driven via `it.each([...])` (see `tests/unit/agents/agent-factory.test.ts` L176).
- ESM imports use `.js`: `import { isNegatedFileExistenceGate } from '../../../src/agents/gate-semantics.js'`.
- EXECUTE/VERIFY comment style; `describe('…')` blocks.
- Tests live in `tests/unit/agents/` (new `gate-semantics.test.ts`).

## Validation commands (package.json, verified)
- `npm run typecheck` → `tsc --noEmit -p tsconfig.build.json`
- `npm run test:run` → `vitest run`
- `npm run lint` → `eslint . --ext .ts`
- Single file: `npx vitest run tests/unit/agents/gate-semantics.test.ts`

## Scope boundaries (success criteria, NOT shell gates)
- Do NOT modify `src/agents/prp-executor.ts` (S2's job).
- Do NOT modify `src/core/models.ts` (no schema change).
- Do NOT modify `src/agents/prompts.ts` (REQ-G1 / separate tasks P1.M1.*).
- DOCS: none (internal helper; contract = behavior + tests).
