# Research: Integration, ordering & test design (P1.M1.T1.S2)

## Deterministic startup ordering (implementation_notes.md §5)

`src/agents/agent-factory.ts` ALREADY calls `configureEnvironment()` at module
load (top-level side effect, line ~38). S2 must add `configureHarness()`
IMMEDIATELY AFTER so the chain is deterministic:

```
import (module load)
  → configureEnvironment()   // existing: maps ANTHROPIC_AUTH_TOKEN → ANTHROPIC_API_KEY, sets default BASE_URL
  → configureHarness()        // NEW (S2): read PRP_AGENT_HARNESS → validate → compat-check → configureHarnesses()
```

By the time `configureHarness()` runs, `process.env.ANTHROPIC_API_KEY` is already
populated (configureEnvironment mapped it), so the `harnessDefaults['claude-code'].apiKey`
binding is correct.

## configureHarness() — placement decision

Contract allows "in src/config/ or extend the config module". **Recommended: new
file `src/config/harness.ts`** (single-responsibility; mirrors the
constants.ts / types.ts / environment.ts split; easiest to unit-test in isolation
and to give 100% coverage). `environment.ts` remains focused on ANTHROPIC\_\* var
mapping — harness/provider selection is a distinct concern.

`agent-factory.ts` gains exactly:

```ts
import { configureHarness } from '../config/harness.js';
...
configureEnvironment();
configureHarness();   // ← NEW line, directly below
```

## File-disjoint from S1 (parallel-safe)

S1 and S2 execute in PARALLEL. Confirmed NO file overlap:

| File                                       | Owner                                                      |
| ------------------------------------------ | ---------------------------------------------------------- |
| `src/config/constants.ts`                  | S1 (append) — S2 only IMPORTS                              |
| `src/config/types.ts`                      | S1 (append) — S2 only IMPORTS                              |
| `tests/unit/config/harness.test.ts`        | S1 (NEW)                                                   |
| `src/config/harness.ts`                    | **S2 (NEW)**                                               |
| `src/agents/agent-factory.ts`              | **S2 (EDIT: +1 import, +1 call)**                          |
| `tests/unit/config/harness-config.test.ts` | **S2 (NEW)** — distinct filename from S1's harness.test.ts |

No merge conflicts. S2 imports S1's symbols (`DEFAULT_HARNESS`, `DEFAULT_MODEL_PROVIDER`,
`SUPPORTED_HARNESSES`, `AgentHarness`, `HarnessProviderMismatchError`, `PRP_AGENT_HARNESS`)
— these exist per the S1 contract.

## 100% coverage mapping (vitest.config.ts enforces statements/branches/functions/lines = 100)

`src/config/harness.ts` branches that MUST each be exercised by a test:

| Branch                                                                         | Covered by test case |
| ------------------------------------------------------------------------------ | -------------------- |
| `process.env.PRP_AGENT_HARNESS ?? DEFAULT_HARNESS` → env UNSET (default 'pi')  | case (a)             |
| valid harness 'pi' passes validation + calls configureHarnesses                | case (b)             |
| `harness === 'claude-code' && DEFAULT_MODEL_PROVIDER === 'zai'` → TRUE → throw | case (c)             |
| `SUPPORTED_HARNESSES.includes(raw)` → FALSE → throw (invalid value)            | case (d)             |

All four contract-mandated cases (a–d) map 1:1 onto branch coverage. No extra cases
needed. The compat branch's FALSE side is covered by (a)/(b); TRUE side by (c).

## Compatibility-check semantics (clarified)

`DEFAULT_MODEL_PROVIDER` is the `'zai'` constant from S1 (not env-read in S2).
Therefore `harness === 'claude-code' && DEFAULT_MODEL_PROVIDER === 'zai'` is
**always true when harness is claude-code** → selecting claude-code ALWAYS throws
in S2. This is CORRECT per PRD §9.4.1/§9.4.3: claude-code is Anthropic-only and
incompatible with the default z.ai provider. The escape-hatch (anthropic provider)
is a FUTURE concern (provider is not env-configurable until later milestones).
The explicit `&& DEFAULT_MODEL_PROVIDER === 'zai'` comparison is kept for
self-documentation and forward-compatibility (matches implementation_notes.md §1).

## Impact on existing agent-factory.test.ts (regression check)

Adding top-level `configureHarness()` to agent-factory.ts runs at first import.
In `agent-factory.test.ts`, `PRP_AGENT_HARNESS` is unset at module-load time →
resolves to 'pi' → no throw; real `configureHarnesses({ defaultHarness:'pi',... })`
stores into its singleton (harmless, idempotent). Existing assertions (model,
maxTokens, MCP_TOOLS, agent creation) are unaffected. Suite stays GREEN.

Note: `agent-factory.test.ts` does NOT mock groundswell, so it exercises the REAL
`configureHarnesses`. This is fine — 'pi' is always valid.

## Test isolation: stubEnv + unstubAllEnvs (no resetGlobalHarnessConfig needed)

```
beforeEach/each test:
  vi.stubEnv('PRP_AGENT_HARNESS', 'pi' | 'claude-code' | 'bogus')
  vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')     // for harnessDefaults assertion
afterEach:
  vi.unstubAllEnvs()                                // restores env (also done by global setup)
  vi.clearAllMocks() / vi.restoreAllMocks()         // clears configureHarnesses mock state
```

Global `tests/setup.ts` already runs `vi.clearAllMocks()` in beforeEach and
`vi.unstubAllEnvs()` in afterEach, so per-file hooks are belt-and-suspenders.
