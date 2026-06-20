# Delta Impact — Exact Files & Current vs Target State

Concrete, line-level inventory of what Session 004 changes. Every PRP subtask
must target a row below.

## A. Configuration layer

### `src/config/constants.ts`
- **CURRENT:** `MODEL_NAMES = { opus:'GLM-4.7', sonnet:'GLM-4.7', haiku:'GLM-4.5-Air' }`
  (bare model names). `MODEL_ENV_VARS` maps tiers → `ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU}_MODEL`.
  No `PRP_AGENT_HARNESS`.
- **TARGET:** Add `PRP_AGENT_HARNESS` env-var name + harness/provider constants
  (default harness `'pi'`, default provider `'zai'`, supported harness list).

### `src/config/environment.ts`
- **CURRENT:** `getModel(tier)` returns `process.env[MODEL_ENV_VARS[tier]] ?? MODEL_NAMES[tier]`
  → bare string e.g. `'GLM-4.7'`. `configureEnvironment()` maps `ANTHROPIC_AUTH_TOKEN`→`ANTHROPIC_API_KEY`,
  sets default `ANTHROPIC_BASE_URL`.
- **TARGET:** `getModel(tier)` must return **provider-qualified** `zai/<model>`
  (e.g. `zai/GLM-4.7`), sourced from env at runtime, NEVER harness-qualified.
  Either qualify at resolution time, or store qualified defaults in `MODEL_NAMES`.
  Prefer a single `qualifyModel()` helper so the rule lives in one place.

### `src/config/types.ts`
- **CURRENT:** `ModelTier`, `EnvironmentConfig` with bare `opusModel/sonnetModel/haikuModel`,
  `EnvironmentValidationError`.
- **TARGET:** Add types for harness selection (`AgentHarness = 'pi' | 'claude-code'`),
  provider id, and a `HarnessProviderMismatchError`. Update model-field JSDoc/examples
  to the `provider/model` form.

## B. Agent runtime layer

### `src/agents/agent-factory.ts`
- **CURRENT:** calls `configureEnvironment()` at module load. `createBaseConfig()`
  sets `model = getModel('sonnet')` (bare), passes `env:{ANTHROPIC_API_KEY,ANTHROPIC_BASE_URL}`.
  No `harness` / `harnessOptions` on the config. Four persona factories
  (`createArchitectAgent` etc.) spread `baseConfig` + add `system` + `mcps: MCP_TOOLS`,
  then call Groundswell `createAgent(config)`.
- **TARGET:**
  1. At startup (alongside `configureEnvironment()`), call Groundswell
     `configureHarnesses({ defaultHarness, defaultModelProvider:'zai', harnessDefaults })`.
  2. Read `PRP_AGENT_HARNESS` (default `'pi'`) and validate it.
  3. **Enforce compatibility:** if harness is `'claude-code'` AND provider is `zai`,
     throw a config error at init with a message citing §9.2.4 (Groundswell will NOT
     catch this — `configureHarnesses` does not validate the provider).
  4. Add `harness` (and `harnessOptions` if needed) to the agent config object so it
     flows to `createAgent()`. Keep `mcps`/tools unchanged — they run via `MCPHandler`
     for both harnesses (PRD §9.3.3).

### `src/scripts/validate-api.ts` + `tests/validation/zai-api-test.ts`
- **CURRENT:** guard `ANTHROPIC_BASE_URL` against `https://api.anthropic.com`.
- **TARGET:** clarify the guard targets the **provider** endpoint; add/note the
  harness↔provider compatibility check. No change to the z.ai happy-path behavior.

## C. Tests that assert on changed values (WILL BREAK — must update in same subtask)

| Test file | Current assertion | Must become |
| --- | --- | --- |
| `tests/unit/agents/agent-factory.test.ts` | `expect(config.model).toBe('GLM-4.7')` | `'zai/GLM-4.7'` |
| `tests/unit/agents/agent-factory.test.ts` | (persona model checks) | qualified strings; optionally assert `config.harness` is set |
| `tests/unit/config/environment.test.ts` | `getModel('opus')).toBe(MODEL_NAMES.opus)` | still passes IF `MODEL_NAMES` becomes qualified; add explicit `expect(getModel('sonnet')).toMatch(/^zai\//)` regression test |

**TDD rule:** the implementation subtask updates the production code AND its tests
together (fail → implement → pass). Do not split test updates into separate subtasks.

## D. Documentation (docs/ is in scope — not a protected path)

| File | State | Target |
| --- | --- | --- |
| `docs/CONFIGURATION.md` | **EXISTS** (16KB). Documents z.ai env vars. Has **0** mentions of `PRP_AGENT_HARNESS` or provider-qualified models. | Add `PRP_AGENT_HARNESS` env var, provider-qualified model format, harness/provider independence (mirror PRD §9.2.2 / §9.4.2). |
| `docs/GROUNDSWELL_GUIDE.md` | **DOES NOT EXIST** in `hacky-hack/docs/`. (A copy exists only in `plan/003_.../docs/`.) | **CREATE** in `hacky-hack/docs/` with a "Harness System" section mirroring PRD §9.4 (supported harnesses table, `configureHarnesses()` config, critical rules, capability reference). Reuse prior-session copy as a reference if helpful. |

## E. NOT changing (confirmed by diff)

- Session manager, task orchestrator, task patcher, prd-differ, delta analysis,
  bug-hunt / fix-cycle workflows, all prompts, CLI commands, MCP tools
  (`bash/filesystem/git`), protected-file logic, nested-execution guard.
- Groundswell sources (external dependency — read-only).
