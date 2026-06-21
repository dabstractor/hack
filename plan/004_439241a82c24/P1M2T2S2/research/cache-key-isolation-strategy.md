# Research — P1.M2.T2.S2: Cache-key isolation test (harness × provider/model)

Load-bearing facts for the PRP. Every claim below is verified against the
**linked** Groundswell build (`~/projects/groundswell/dist`, resolved via the
`groundswell` alias in `vitest.config.ts`) and the hacky-hack source.

---

## 1. Groundswell exposes a key-builder — call it directly (contract clause A)

The work item says: _"If Groundswell exposes a key-builder, call it directly;
otherwise assert through the cache get/set surface."_ Groundswell **does** expose
one, re-exported from the package root:

- **Runtime:** `dist/index.js:42` →
  `export { generateCacheKey, deterministicStringify, getSchemaHash } from './cache/cache-key.js';`
- **Types:** `dist/index.d.ts:30` → same export;
  `dist/index.d.ts:32` → `export type { CacheKeyInputs } from './cache/cache-key.js';`
- **Source of truth:** `~/projects/groundswell/src/cache/cache-key.ts`.

Signature (verified):

```ts
export function generateCacheKey(inputs: CacheKeyInputs): string; // 64-char SHA-256 hex
export interface CacheKeyInputs {
  user: string;
  model: string;
  harness?: HarnessId;      // 'pi' | 'claude-code'   (PRD §7.14.5)
  provider?: ModelProviderId; // 'zai' | 'anthropic' | open set
  data? system? temperature? maxTokens? tools? mcps? skills? responseFormat?: ...
}
```

**Therefore** the primary strategy is: call `generateCacheKey` directly with
inputs that differ on exactly one axis and assert the digests differ. This is
deterministic, requires no LLM, no harness, no network, no Anthropic key.

## 2. The key-builder ALREADY threads both axes (this is a characterization test)

`dist/cache/cache-key.js` (the compiled, linked build) — lines 166-173:

```js
// PRD §7.14.5: incorporate the harness + provider axes for cross-harness/provider isolation.
if (inputs.harness !== undefined) {
  normalized.harness = inputs.harness;
}
if (inputs.provider !== undefined) {
  normalized.provider = inputs.provider;
}
```

`normalized` is then fed to `deterministicStringify` → SHA-256. **Both axes are
components of the digest** in the linked build. **Implication:** the isolation
test is **GREEN on first run** (identical situation to the parallel P1.M2.T2.S1).
The "implicit TDD" red-state is the _regression_ the test guards: if
Groundswell's `cache-key.ts` ever drops the harness/provider lines, this test
goes RED. **Do NOT weaken assertions to manufacture a RED→GREEN arc** — a RED
here means Groundswell regressed or the wrong build is linked; investigate, do
not paper over.

## 3. Also assert through the cache get/set surface (contract clause B + "in-memory store")

The work item _also_ says: _"Use Groundswell's cache with an in-memory/in-test
store."_ Groundswell re-exports `LLMCache` (the `lru-cache` wrapper) from the root:

- `dist/index.d.ts:29` → `export { LLMCache, defaultCache } from './cache/cache.js';`
- `dist/cache/cache.d.ts` → `export declare class LLMCache<T = unknown> { constructor(config?: CacheConfig); async get(key): Promise<T|undefined>; async set(key, value, options?): Promise<void>; has(key): boolean; async clear(): Promise<void>; ... }`

**Strategy:** a **second** assertion group builds two keys via `generateCacheKey`
(differing on one axis), `set`s a value under the first into a **fresh
`new LLMCache()`**, then asserts `get` under the second key returns `undefined`
(MISS) — proving the key difference manifests as real partitioning at the store
level. This satisfies clause B and is stronger than Groundswell's own
`cache-key.test.ts` (which only tests the key-builder in isolation).

**CRITICAL — use `new LLMCache()`, NOT the `defaultCache` singleton.** The
singleton is shared module state; importing it risks cross-test pollution (and
Groundswell's own `agent-cache-key-isolation.test.ts` has to
`await defaultCache.clear()` in beforeEach to work around this). A fresh
`new LLMCache()` per test is hermetic — no clear needed, no leakage.

## 4. Why NOT mock the harness execute path / use the real Agent

Groundswell's own `src/__tests__/unit/agent-cache-key-isolation.test.ts` tests
the full `Agent.prompt()` → `executePrompt` → key-build path by registering
mock harnesses (`createMockHarness('pi')`, `createMockHarness('claude-code')`)
in a `HarnessRegistry`, spying on `defaultCache.set`, and asserting each harness's
`execute` is called. That is the **"mock the harness execute path"** strategy.

**We deliberately do NOT replicate it in hacky-hack**, because:

1. **Contract permission** — the item offers the key-builder-direct OR
   cache-get/set as explicit alternatives ("If Groundswell exposes a key-builder,
   call it directly"). Groundswell exposes one. We're permitted to skip the
   heavyweight harness-mock path.
2. **Ownership/scope** — hacky-hack owns the _integration boundary_, not
   Groundswell's internal Agent→cache plumbing. Groundswell already covers that
   plumbing in its own repo (read-only dependency). Re-doing it here duplicates
   coverage with fragile mock-harness plumbing (`createMockHarness`,
   `HarnessRegistry['_resetForTesting']`, `resetGlobalConfig`).
3. **Determinism/fragility** — the mock-harness path depends on Groundswell
   internals (`HarnessRegistry` singleton reset, `createSuccessResponse` shape,
   Agent constructor quirks) that can shift between Groundswell versions. The
   key-builder + LLMCache surface is a narrow, stable public API.
4. **"No real LLM / no network / no Anthropic key"** — calling `generateCacheKey`
   - `new LLMCache()` touches neither the harness execute path nor any provider.
     There is literally no harness to mock because we never enter the harness layer.
     This **satisfies** "mock the harness execute path" by _not invoking it at all_
     — we call the pure key-builder it would have called, and the in-memory store
     it would have used.

This mirrors the parallel P1.M2.T2.S1's documented decision (config/registration
layer over real-harness-mock) — see `plan/004_439241a82c24/P1M2T2S1/research/groundswell-parity-test-reference.md §3`.

## 5. Real pipeline config values (bind the test to the actual config)

From `src/config/constants.ts` (verified **side-effect-free** — pure `export const`,
no imports, no `configureEnvironment()` / `configureHarness()` calls — safe to
import without triggering module-load side effects or needing env stubs for the
import itself):

```ts
export const DEFAULT_HARNESS = 'pi' as const;
export const DEFAULT_MODEL_PROVIDER = 'zai' as const;
export const MODEL_NAMES = {
  opus: 'GLM-4.7',
  sonnet: 'GLM-4.7',
  haiku: 'GLM-4.5-Air',
} as const;
```

→ The pipeline's qualified model is `${DEFAULT_MODEL_PROVIDER}/${MODEL_NAMES.sonnet}`
== **`zai/GLM-4.7`**. The test imports these constants and derives the qualified
string from them, so it proves the invariant for the **actual** pipeline config
(and tracks it if defaults change). The contrasting axis uses the contract's
literal example `anthropic/claude-sonnet-4` (the `claude-code` harness's
Anthropic-only world — see PRD §9.4.3).

## 6. Exact axes under test (maps 1:1 to the work-item contract)

| Axis varied                  | Inputs A                                            | Inputs B                                    | Expectation         |
| ---------------------------- | --------------------------------------------------- | ------------------------------------------- | ------------------- |
| **harness only**             | `{user,model,provider:'zai',harness:'pi'}`          | same but `harness:'claude-code'`            | keys DIFFER         |
| **provider only**            | `{...,harness:'pi',provider:'zai',model:'GLM-4.7'}` | same but `provider:'anthropic'`             | keys DIFFER         |
| **model only**               | `{...,harness:'pi',provider:'zai',model:'GLM-4.7'}` | same but `model:'GLM-4.5-Air'`              | keys DIFFER         |
| **pipeline scenario**        | `pi` + `zai/GLM-4.7`                                | `claude-code` + `anthropic/claude-sonnet-4` | keys DIFFER         |
| **tuple uniqueness**         | 4×(harness,provider) combos + 1 model swap          | —                                           | all 5 keys distinct |
| **shape**                    | any key                                             | —                                           | `/^[a-f0-9]{64}$/`  |
| **control (stable)**         | identical inputs ×2                                 | —                                           | keys EQUAL          |
| **harness feeds digest**     | omit `harness` vs `harness:'pi'`                    | —                                           | keys DIFFER         |
| **provider feeds digest**    | omit `provider` vs `provider:'zai'`                 | —                                           | keys DIFFER         |
| **LLMCache MISS (harness)**  | `set` under pi key                                  | `get` under cc key                          | `undefined`         |
| **LLMCache MISS (provider)** | `set` under zai key                                 | `get` under anthropic key                   | `undefined`         |
| **LLMCache HIT (control)**   | `set` + `get` same axes                             | —                                           | value returned      |

## 7. Disjointness from every sibling (no merge conflict, no overlap)

| Sibling         | Owns                                                                                                                                                                                                                    | This test's relationship                                                                                                                                                                                                                                                                            |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P1.M2.T1.S1** | provider-endpoint guard (`src/config/endpoint-guard.ts`, `tests/unit/config/endpoint-guard.test.ts`)                                                                                                                    | Disjoint. (We still stub `ANTHROPIC_BASE_URL`=z.ai to keep the _global_ `tests/setup.ts` guard happy — see §8.)                                                                                                                                                                                     |
| **P1.M2.T1.S2** | harness/provider **compatibility rejection** (`HarnessProviderMismatchError`, `src/config/harness.ts`, `tests/unit/config/harness-provider-compat.test.ts`) — throws when `configureHarness()` sees `claude-code`+`zai` | Disjoint. **This test never calls `configureHarness()`/`configureHarnesses()`** — it builds `CacheKeyInputs` objects and feeds them to `generateCacheKey` directly. So `claude-code`+`zai` does **NOT** throw here. Add an inline comment noting the compatibility guard is intentionally bypassed. |
| **P1.M2.T2.S1** | tool discovery/execution parity (`tests/unit/tools/mcp-tool-parity.test.ts`)                                                                                                                                            | Disjoint (tools layer vs cache layer; different file, different dir).                                                                                                                                                                                                                               |
| **P1.M2.T3**    | docs (`docs/CONFIGURATION.md`, `docs/GROUNDSWELL_GUIDE.md`)                                                                                                                                                             | Disjoint (test-only; no docs touched).                                                                                                                                                                                                                                                              |

## 8. Env stubbing — the ONE global-setup interaction

`tests/setup.ts` registers a global `beforeEach` that calls
`validateProviderEndpoint()` (reads `process.env.ANTHROPIC_BASE_URL`) and a global
`afterEach` that calls `vi.unstubAllEnvs()`. To keep the global guard happy we
stub `ANTHROPIC_BASE_URL` to the **z.ai** URL in a LOCAL `beforeEach` (Anthropic
URLs are blocked; z.ai is allowed) — exactly the pattern in
`tests/unit/agents/agent-factory.test.ts`:

```ts
beforeEach(() => {
  vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'stubbed-token');
  vi.stubEnv('ANTHROPIC_API_KEY', 'stubbed-token');
  vi.stubEnv('ANTHROPIC_BASE_URL', 'https://api.z.ai/api/anthropic'); // NOT Anthropic
});
afterEach(() => vi.unstubAllEnvs());
```

**This test does NOT import `agent-factory.ts` or `environment.ts`** (both have
module-load side effects: `configureEnvironment()` / `configureHarness()`). It
imports only `src/config/constants.ts` (pure) + `generateCacheKey`/`LLMCache`
from `groundswell`. So the env stubs exist _solely_ to satisfy the global
endpoint guard — they are not needed by the code under test.

## 9. No `vi.mock('groundswell')` — we need the REAL functions

This test verifies **Groundswell's actual behavior**, so it must use the REAL
`generateCacheKey` and REAL `LLMCache` (mocking would test a stub of our own
invention, proving nothing). `vi.mock` is file-scoped in vitest, so other files'
`vi.mock('groundswell')` (e.g. `cache-verification.test.ts`) does **not** leak
into this file. (Confirmed by reading `cache-verification.test.ts` — it mocks
`createAgent`/`createPrompt` only, not `generateCacheKey`/`LLMCache`; and in any
case mocks don't cross file boundaries.)

## 10. Coverage safety

`vitest.config.ts` enforces 100% statements/branches/functions/lines on
`src/**/*.ts`. This subtask creates **no new `src/**/\*.ts`** file (test-only) →
**no new coverage obligation**. The new test lives in `tests/**`(excluded from
measurement). Importing`constants.ts`(already 100% covered) and Groundswell
(outside`src/**`) adds nothing to the coverage gate. Identical coverage posture
to P1.M2.T2.S1.

## 11. Placement decision: `tests/unit/agents/cache-key-isolation.test.ts`

- **Not** `tests/unit/tools/` — that's S1's home (tool parity); cache-key is not a tool concern.
- **Not** `tests/unit/config/` — the M2.T1 guard tests live there (endpoint/compat); cache-key is built at the Agent runtime layer, not the config-validation layer.
- **Yes** `tests/unit/agents/cache-key-isolation.test.ts` — sits next to the existing `cache-verification.test.ts` (the established "agent cache" cluster), reflects that the key is built at `Agent.executePrompt`, and is cleanly disjoint from both the tools dir and the config dir.

## 12. Upstream reference tests (read-only inspiration, do NOT copy wholesale)

- `~/projects/groundswell/src/__tests__/unit/cache-key.test.ts` — the direct
  `generateCacheKey` idiom (its `describe('cache key isolation — harness + provider')`
  block is the closest upstream analog to our Group 1). We mirror its
  `{...base, harness, provider}` spread style.
- `~/projects/groundswell/src/__tests__/unit/agent-cache-key-isolation.test.ts` —
  the heavyweight Agent+mock-harness path we **deliberately do not replicate**
  (see §4). Read it to confirm what we are NOT doing and why.
