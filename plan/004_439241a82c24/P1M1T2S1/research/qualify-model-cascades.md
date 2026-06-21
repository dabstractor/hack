# Research — P1.M1.T2.S1: Qualify model defaults via `getModel()`

## 1. `parseModelSpec` contract (Groundswell) — confirms the qualification rule

Source: `plan/004_439241a82c24/architecture/external_deps.md` §3, quoting
Groundswell `src/utils/model-spec.ts`:

```ts
parseModelSpec(model: string, defaultProvider?: ModelProviderId): ModelSpec
//  'zai/GLM-4.7'           -> { provider:'zai', model:'GLM-4.7', raw:'zai/GLM-4.7' }
//  'GLM-4.7'               -> resolved against defaultProvider
//  'pi/zai/GLM-4.7'        -> THROWS ("Harness must not appear in model string …")
```

Implications for `qualifyModel`:

- Returning `provider + '/' + name` (e.g. `zai/GLM-4.7`) is the **correct** output — `parseModelSpec` accepts it.
- The `name.includes('/') ? name : provider + '/' + name` guard is **necessary**:
  (a) it makes `qualifyModel` idempotent (re-qualifying an already-qualified string is a no-op), and
  (b) it guarantees we NEVER produce a 3-segment harness-qualified string
  (e.g. `zai/zai/GLM-4.7` or `pi/zai/GLM-4.7`) that would make `parseModelSpec` THROW.
- Never prefix the **harness** (`pi`/`claude-code`) — only the **provider** (`zai`). The
  harness never appears in the model string (PRD §9.4.3).

## 2. Cascading test breakages (MUST be fixed in the same subtask — implicit TDD)

Changing `getModel()` from returning bare names to returning `zai/<name>` breaks two
EXISTING assertion sets that hard-code bare model names. Per
`architecture/implementation_notes.md` §3 and `architecture/implementation_notes.md` §7
(Definition of Done: `npm run test:run` must pass), these are fixed in THIS subtask.

### Cascade A — `tests/unit/config/environment.test.ts` → `describe('getModel')`

Current assertions (verified, lines ~108–160) that break:

```ts
expect(getModel('opus')).toBe(MODEL_NAMES.opus); // MODEL_NAMES.opus === 'GLM-4.7' (bare)
expect(getModel('sonnet')).toBe(MODEL_NAMES.sonnet); // bare
expect(getModel('haiku')).toBe(MODEL_NAMES.haiku); // bare
expect(getModel('opus')).toBe('custom-opus-model'); // bare override
expect(getModel('sonnet')).toBe('custom-sonnet-model'); // bare override
expect(getModel('haiku')).toBe('custom-haiku-model'); // bare override
```

After qualification these resolve to `zai/GLM-4.7`, `zai/GLM-4.5-Air`, `zai/custom-opus-model`, etc.
Fix: assert qualified strings. Prefer the robust form
`` `${DEFAULT_MODEL_PROVIDER}/${MODEL_NAMES.opus}` `` so the test stays correct if the
provider constant changes. Override cases assert `'zai/custom-opus-model'` etc.

### Cascade B — `tests/unit/agents/agent-factory.test.ts`

Verified assertion (the "should use GLM-4.7 model for all personas" test):

```ts
configs.forEach(config => {
  expect(config.model).toBe('GLM-4.7'); // BREAKS — createBaseConfig() calls getModel('sonnet')
});
```

Fix: change `'GLM-4.7'` → `'zai/GLM-4.7'` (one-line). This is the ONLY edit to that file.
(`createBaseConfig` does `const model = getModel('sonnet');` — so after T2.S1 it yields
`zai/GLM-4.7`.)

## 3. Branch-coverage mapping (vitest.config.ts enforces 100% globally)

`qualifyModel(name, provider = DEFAULT_MODEL_PROVIDER)` has exactly ONE branch — the
ternary `name.includes('/') ? name : provider + '/' + name`. Both sides must execute:

| Branch (`includes('/')`)          | Test that covers it                            | Input → output                                    |
| --------------------------------- | ---------------------------------------------- | ------------------------------------------------- |
| **false** (name has no '/')       | default-tier tests (e.g. `getModel('sonnet')`) | `'GLM-4.7'` → `'zai/GLM-4.7'`                     |
| **true** (name already qualified) | already-qualified override test                | `'anthropic/foo'` → `'anthropic/foo'` (unchanged) |

`getModel(tier)` itself has no new branches (same `??` fallback as before, just wrapped).
100% coverage of `environment.ts` is already achieved by the existing suite; the new/updated
assertions keep it at 100%.

## 4. Consumer impact — `src/scripts/validate-api.ts` (NO edit required)

Verified: `validate-api.ts` imports `getModel` and passes the result straight through to
`createAgent({ model })` / logging (lines 23, 192, 296, 299, 363, 366, 377). Qualification is
transparent and CORRECT for it — `zai/GLM-4.7` is exactly what `parseModelSpec` expects. No
source change to validate-api.ts. (Its own integration test, if any, is not part of the unit
gate and makes no LLM/network call in the unit suite.)

## 5. Parallel-execution / file-disjoint check (vs P1.M1.T1.S2)

T1.S2 (in-flight) touches:

- `src/config/harness.ts` (NEW)
- `src/agents/agent-factory.ts` (EDIT: +import configureHarness, +1 top-level call)
- `tests/unit/config/harness-config.test.ts` (NEW)

T2.S1 (this) touches:

- `src/config/environment.ts` (EDIT: +qualifyModel, edit getModel)
- `tests/unit/config/environment.test.ts` (EDIT: qualify getModel assertions + add qualifyModel describe)
- `tests/unit/agents/agent-factory.test.ts` (EDIT: 1-line model assertion)

**Zero file overlap.** Both are config-layer changes on disjoint files
(implementation_notes.md §8 confirms M1.T1 and M1.T2 are independent). Note: T2.S1's
agent-factory.test.ts import of agent-factory.ts will, after T1.S2 merges, also trigger
`configureHarness()` at module load — but that is a no-op with `PRP_AGENT_HARNESS` unset
(returns `'pi'`, no throw), so T2.S1's tests pass regardless of whether T1.S2 has landed.

## 6. Decisions locked

- `qualifyModel` lives in `src/config/environment.ts` and is **exported** (single source of
  truth — reuse by validate-api.ts and future persona factories per implementation_notes §2).
- Default param `provider = DEFAULT_MODEL_PROVIDER` (NOT a bare `'zai'` literal) — keeps the
  qualification rule coupled to the one constant.
- `getModel` uses `qualifyModel(process.env[MODEL_ENV_VARS[tier]] ?? MODEL_NAMES[tier])` —
  reads env at runtime, qualifies whatever value wins. No hardcoded qualified literals beyond
  the `provider + '/'` prefix produced by the helper.
- `configureEnvironment()` and `validateEnvironment()` are NOT modified.
