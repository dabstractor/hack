# Verified Facts — P7.M1.T2.S1 (Provider-aware auth resolution)

Every claim below was empirically verified against the live `hacky-hack` tree
and `node_modules/` on 2026-06-29. PRP-generation should treat these as ground truth.

---

## 1. `getEnvApiKey` import path — the contract's stated path is NON-FUNCTIONAL as written

`architecture/implementation_notes.md §T2.S1` says: *"Import `getEnvApiKey` from
`@earendil-works/pi-ai` (re-exported through `@earendil-works/pi-coding-agent`)."*

**Verified FALSE on the "re-exported" half:**

```
$ grep -n "getEnvApiKey" node_modules/@earendil-works/pi-coding-agent/dist/index.d.ts
# (no output)
$ node -e "require.resolve('@earendil-works/pi-ai')"   # from project root
# Error: Cannot find module '@earendil-works/pi-ai'   (MODULE_NOT_FOUND)
```

- `pi-coding-agent/dist/index.d.ts` re-exports only `AuthStorage`, `ModelRegistry`,
  `FileAuthStorageBackend`, `InMemoryAuthStorageBackend` (and types). **It does NOT
  re-export `getEnvApiKey` / `findEnvKeys`.**
- `@earendil-works/pi-ai` is a **nested transitive** dep
  (`node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai`),
  so it is **not resolvable** from `hacky-hack/src` via a bare specifier.

**Resolution (chosen): Approach A — add the dep.** `@earendil-works/pi-ai` IS published:

```
$ npm view @earendil-works/pi-ai version
0.80.2            # latest published
# nested copy in tree = 0.79.8
```

→ Add `"@earendil-works/pi-ai": "^0.79.8"` to `package.json` `dependencies`, then
`import { getEnvApiKey } from '@earendil-works/pi-ai';`. npm will resolve/hoist it.
The `zai→ZAI_API_KEY` and `anthropic→[ANTHROPIC_OAUTH_TOKEN, ANTHROPIC_API_KEY]` mapping
is **identical across 0.79.8 ↔ 0.80.x** (env var names are stable conventions), so either
version behaves the same for this use.

**Approach B (fallback, NOT chosen): hardcode the 2-entry mapping** (`zai→ZAI_API_KEY`,
`anthropic→[ANTHROPIC_OAUTH_TOKEN, ANTHROPIC_API_KEY]`) in `constants.ts`. Zero deps, but
loses drift-proofing and deviates from the contract's stated intent. Documented in PRP
gotchas only.

---

## 2. `getEnvApiKey(provider)` semantics (from pi-ai `dist/env-api-keys.js`)

Signature: `getEnvApiKey(provider: string, env?: ProviderEnv): string | undefined`

- For `zai` → returns `process.env.ZAI_API_KEY` (the **value**), or `undefined` if unset.
- For `anthropic` → returns `process.env.ANTHROPIC_OAUTH_TOKEN` first, else `ANTHROPIC_API_KEY`.
- Special cases (`google-vertex`, `amazon-bedrock`) return `"<authenticated>"` for non-key
  auth — irrelevant here (our providers are `zai` / `anthropic` only).
- **Pure + synchronous** — reads `process.env` only, no disk, no network. Safe to call in the
  resolver, `configureHarness()`, and the resolver's tests.
- It returns the RAW value (no trimming). The resolver MUST `.trim()` and treat
  empty/whitespace-only as "not configured" (PRD §9.2.7 empty-string policy).

`findEnvKeys(provider): string[] | undefined` is also exported — returns the env-var NAMES
(`['ZAI_API_KEY']` / `['ANTHROPIC_OAUTH_TOKEN','ANTHROPIC_API_KEY']`). Useful for T3's
preflight error message (naming which var was checked). Not needed for T2.S1's value resolver.

---

## 3. Provider resolution — the pattern already exists

`src/config/harness.ts` `configureHarness()` Step 4 already does:
```ts
const resolvedProvider = getModel('sonnet').split('/')[0];   // default 'zai'
```
`getModel('sonnet')` reads `ANTHROPIC_DEFAULT_SONNET_MODEL` env (default `glm-5.2`) and
qualifies → `'zai/glm-5.2'` → split → `'zai'`. An `anthropic/*` override → `'anthropic'`.

→ Extract `getResolvedProvider(): string` into `environment.ts` (alongside `getModel`) and
reuse in `configureEnvironment`, `configureHarness`, `ensureHarnessInitialized`, and the new
resolver. **No circular import**: `environment.ts` imports nothing from `harness.ts`;
`harness.ts` already imports `getModel` from `environment.ts`.

---

## 4. The two empty-string shadowing sites to eliminate

**(a) `src/config/harness.ts:123-129` `ensureHarnessInitialized()`** — the AUTHORITATIVE
harness-forwarding point:
```ts
const apiKey = process.env.ANTHROPIC_API_KEY;
await registry.initializeProvider('pi', apiKey ? { apiKey } : undefined);
```
Wrong contract: reads only `ANTHROPIC_API_KEY` (Anthropic-shell). A `zai` user with only
`ZAI_API_KEY` (or `~/.pi/agent/auth.json`) forwards `undefined` → for `zai`, that's correct
ONLY because pi's (future file-backed) AuthStorage resolves natively; but the override/env
layer is skipped entirely. **Fix:** source `apiKey` from the new provider-aware resolver.

**(b) `src/agents/agent-factory.ts:178-181` `createBaseConfig()`** — the per-agent env capture
(named explicitly in PRD §9.2.6 problem #3):
```ts
env: {
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? '',   // ← the `?? ''` shadow
  ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL ?? '',
}
```
`AgentConfig.env.ANTHROPIC_API_KEY` is typed `readonly string` (inline interface ~L100-113).
**Fix (minimal, ripple-free):** source from the resolver so it is provider-aware; the value
is non-empty whenever a credential is actually resolvable. The field stays `string`; the
residual terminal `?? ''` is now an honest "genuinely unconfigured" default (the T3 preflight
aborts before createBaseConfig is ever reached with nothing configured), NOT an Anthropic-shell
fake-shadow. Fully removing the field/`?? ''` would ripple the `AgentConfig` type + all
`createXxxConfig` call sites → out of scope for T2.S1.

Auth actually flows through `ensureHarnessInitialized → registry.initializeProvider('pi',{apiKey})`
(verified in `src/index.ts:113-118`), NOT primarily through `config.env`; so (b) is secondary
to (a) but required by the work item's "eliminate the `?? ''`" instruction.

---

## 5. `configureEnvironment()` today — what changes

`src/config/environment.ts:60-69`:
```ts
export function configureEnvironment(): void {
  if (process.env.ANTHROPIC_AUTH_TOKEN && !process.env.ANTHROPIC_API_KEY) {
    process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_AUTH_TOKEN;   // UNCONDITIONAL
  }
  if (!process.env.ANTHROPIC_BASE_URL) {
    process.env.ANTHROPIC_BASE_URL = DEFAULT_BASE_URL;                  // z.ai, always
  }
}
```
**New contract:**
- `ANTHROPIC_AUTH_TOKEN → ANTHROPIC_API_KEY` mapping becomes **provider-conditional**:
  apply it ONLY when `getResolvedProvider() === 'anthropic'` (backward-compat alias). For the
  default `zai` path, do NOT map (leave `ANTHROPIC_API_KEY` unset → resolver reads `ZAI_API_KEY`).
- Base URL default: set `DEFAULT_BASE_URL` (z.ai) ONLY when provider is `zai`. For `anthropic`,
  do NOT force the z.ai endpoint (leave unset → user/SDK default; §9.2.4 safeguard still blocks
  `api.anthropic.com`).

**Existing test impact** (`tests/unit/config/environment.test.ts`):
- "should map AUTH_TOKEN to API_KEY when API_KEY is not set" — currently asserts unconditional
  mapping. Must become: maps ONLY when provider is `anthropic`; for default `zai`, AUTH_TOKEN is
  NOT mapped. (OUTPUT contract: "updated to pass under ZAI_API_KEY-only".)
- "should set default BASE_URL when not provided" — still passes for default `zai` (provider
  defaults to `zai` when `ANTHROPIC_DEFAULT_SONNET_MODEL` unset). Add an `anthropic`-provider
  case asserting z.ai is NOT forced.

---

## 6. `configureHarness()` Step 5 — `harnessDefaults['claude-code'].apiKey`

`src/config/harness.ts:91-95`:
```ts
configureHarnesses({
  defaultHarness: harness,
  defaultModelProvider: DEFAULT_MODEL_PROVIDER,
  harnessDefaults: { 'claude-code': { apiKey: process.env.ANTHROPIC_API_KEY } },
});
```
`claude-code` is Anthropic-only, so its apiKey should be the resolved `anthropic` credential:
`resolveApiKeyForProvider('anthropic') ?? undefined`. With `ANTHROPIC_API_KEY` stubbed in the
existing tests, `resolveApiKeyForProvider('anthropic')` = that stub (via `getEnvApiKey`), so
`harness-config.test.ts` / `harness-provider-compat.test.ts` assertions on
`{ 'claude-code': { apiKey: 'stubbed-key' } }` **still hold** — but must be re-verified (the
resolver trims; a stub like `'stubbed-key'` survives trim). Update test comments to reflect
provider-aware sourcing.

---

## 7. `~/.pi/agent/auth.json` — hacky-hack forwards NOTHING for source #3

PRD §9.2.6 resolution order #3 (`auth.json`) is honored by the **Groundswell** harness's
file-backed `AuthStorage` — that is the **T2.S2 cross-repo change** (`pi-harness.ts:144-145`
`AuthStorage.inMemory()` → `AuthStorage.create()`). T2.S1 does NOT read `auth.json` itself;
when only the file is present (no override, no env var), `resolveApiKeyForProvider()` returns
`undefined`, and `ensureHarnessInitialized` forwards `undefined` → pi's file-backed store
resolves natively (once S2 lands). **This is the correct, drift-proof seam** (groundswell_auth_api.md
§2 "how the pieces connect"). T2.S1 must not duplicate auth.json reading.

`getAgentDir()` override for tests = env var `PI_CODING_AGENT_DIR` (verified, §6) — used by T2.S3
to seed a temp `auth.json`. Not T2.S1's concern.

---

## 8. Endpoint guard must stay intact

`src/config/endpoint-guard.ts` (PRD §9.2.4) is provider-focused, reads `ANTHROPIC_BASE_URL`,
blocks `api.anthropic.com`, warns on non-z.ai. It is **orthogonal** to this change and must NOT
be modified. The provider-aware base-URL defaulting in `configureEnvironment` keeps the default
`zai` path on the z.ai endpoint, so the guard stays green. `endpoint-guard.test.ts` needs no
behaviour change (only re-verify it still passes).

---

## 9. Existing tests to UPDATE (not delete) — verified list

```
tests/unit/config/harness.test.ts            # constants/types/error — NO change needed (pure symbols)
tests/unit/config/harness-config.test.ts     # mocks 'groundswell'; asserts configureHarnesses args → UPDATE for resolver-sourced claude-code apiKey
tests/unit/config/harness-provider-compat.test.ts  # same mock → UPDATE similarly
tests/unit/config/environment.test.ts        # AUTH_TOKEN mapping + BASE_URL → UPDATE to provider-conditional
tests/unit/config/endpoint-guard.test.ts     # NO behaviour change; re-verify green
```

Both harness-config/provider-compat tests `vi.mock('groundswell', ...)` but do **NOT** mock
`@earendil-works/pi-ai` → the real `getEnvApiKey` runs (reads `process.env`). That's desired
(tests the real mapping) but requires the dep installed. They also call `vi.stubEnv` in
`beforeEach`, which sets `process.env` before `configureHarness()` reads it — ordering is fine
because the resolver reads env lazily at call time.

---

## 10. Validation commands (verified present in package.json)

```
npm run validate        # = lint && format:check && typecheck && test:run
npm run typecheck       # tsc --noEmit -p tsconfig.build.json (NodeNext, strict)
npm run lint            # eslint . --ext .ts
npm run test:run        # vitest run
npm run test:coverage   # vitest run --coverage  (100% thresholds — new resolver code MUST be covered)
npx vitest run tests/unit/config/   # the config suite in isolation
npm run build           # tsc -p tsconfig.build.json  (dist/index.js; not required for unit tests)
```

Coverage gate is 100% (per the S3 PRP's vitest.config.ts note). New resolver branches
(override-wins / provider-env / none / trim-empty / provider-conditional AUTH_TOKEN / zai-only
BASE_URL) must each be hit by tests. T2.S3 owns the comprehensive resolution-order + auth.json
matrix; T2.S1 adds the coverage-sufficient resolver tests + updates existing tests.

---

## 11. Scope boundaries (parallel + sibling work items)

- **P7.M1.T1.S3 (logging)** is running in parallel and touches `src/utils/logger.ts` + a new
  teardown test. **No overlap** with T2.S1 (auth). Safe to run concurrently.
- **T2.S2 (Groundswell `auth.json`)** is a cross-repo change (`~/projects/groundswell`). T2.S1
  does NOT depend on S2 being merged: when S2 is absent, `auth.json`-only users simply have no
  env/override → resolver returns `undefined` → harness forwards `undefined` → (pre-S2) in-memory
  store finds nothing → fails at agent time (which is exactly what the T3 preflight will catch
  once it lands). T2.S1's resolver is correct with or without S2.
- **T2.S3** owns the full resolution-order + auth.json-on-disk test matrix. T2.S1 adds only
  coverage-sufficient resolver tests (no disk seeding).
- **T3 (preflight)** reuses T2.S1's `resolveApiKeyForProvider` + `getResolvedProvider`. Hard
  downstream dependency on T2.S1 — so T2.S1 MUST export both.

---

## 12. The `PRP_API_KEY` override env (new, optional)

PRD §9.2.6 #1 mentions "a future `--api-key` flag or `PRP_API_KEY` env var". T2.S1 wires the
`PRP_API_KEY` env as the explicit-override source (highest precedence), read by the resolver.
Add `export const PRP_API_KEY = 'PRP_API_KEY';` to `constants.ts`. Document in `.env.example`
(commented, optional) + `docs/CONFIGURATION.md`. Not a required var.
