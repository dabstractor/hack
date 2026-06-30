# Auth Resolution Blind Spot — The Root Cause of Issue 1

## TL;DR

The preflight and the runtime harness use **two different `AuthStorage` instances** that disagree
about whether auth is configured. Every existing auth test `vi.mock('groundswell')`, so none of
them exercise the real (stale) `node_modules/groundswell` dist. This is why all 26 auth tests pass
while the runtime is broken.

## The Two Divergent Code Paths

| Code path | AuthStorage source | Reads `auth.json`? |
|-----------|-------------------|---------------------|
| `runAuthPreflight()` — `src/config/harness.ts:219-281` | `AuthStorage.create()` imported from `@earendil-works/pi-coding-agent` (line 18) | **YES** |
| `PiHarness.initialize()` — `node_modules/groundswell/dist/harnesses/pi-harness.js:95` | `AuthStorage.inMemory()` | **NO** |

The preflight imports `AuthStorage` **directly** from `@earendil-works/pi-coding-agent` and calls
`AuthStorage.create()` → this reads `~/.pi/agent/auth.json` → `getAuthStatus('zai').configured === true`
→ preflight **passes**.

The harness, loaded from `node_modules/groundswell`, calls `AuthStorage.inMemory()` → an empty
in-memory store that **never** reads `auth.json`. At runtime, `harness.authStorage.getApiKey('zai')`
returns **`null`/`undefined`**, and the first LLM call dies with "No API key found for zai".

## Why No Test Caught This

1. **`auth-preflight.test.ts`** mocks `'groundswell'` (line 32) but NOT
   `'@earendil-works/pi-coding-agent'`. So the preflight uses the REAL `AuthStorage.create()` and
   reads the seeded temp `auth.json` → "configured" → passes. ✓ But it never touches `PiHarness`.
2. **`auth-resolution.test.ts`** mocks `'groundswell'` (line 33) with a spy on `initializeProvider`.
   The "case (c)" forwarding test (line 167) asserts the spy was called with `'pi', undefined` —
   the mocked spy ran, the real `PiHarness.initialize()` did NOT. ✓
3. **`harness-config.test.ts`** mocks `'groundswell'` (line 25) with `vi.hoisted()` fns. ✓
4. **`harness-provider-compat.test.ts`** mocks `'groundswell'` (line 22). ✓
5. **`auth-resolver.test.ts`** does NOT mock groundswell (it doesn't import it) — it unit-tests
   `resolveApiKeyForProvider` directly. ✓

**Count: 4 of 5 auth test files `vi.mock('groundswell')`. None test the real dist's PiHarness.**

The only dist-touching test is `auth-preflight.test.ts`'s subprocess test (`spawnSync(dist/index.js)`)
for the no-credential-abort path — but it only proves "exit 1 when nothing configured", NOT auth
resolution against the real harness.

## The Misleading Stale Dist Comment

`node_modules/groundswell/dist/harnesses/pi-harness.js:94` says:
> *"Env-var key resolution is built into AuthStorage.getApiKey (GOTCHA #7)."*

This is only true for the **file-backed** backend. For `AuthStorage.inMemory()` with no seeded data,
`getApiKey('zai')` returns `undefined` regardless of env vars — there is no provider entry to
dispatch to. The comment is misleading and masks the bug.

## Contrast: Why Env-Var Users Don't See the Bug

The `ZAI_API_KEY`-only path works even with the stale dist, because:
- `ensureHarnessInitialized()` calls `resolveApiKeyForProvider('zai')` → returns the env value.
- It forwards `{ apiKey: 'the-zai-key' }` to `registry.initializeProvider('pi', { apiKey })`.
- `PiHarness.initialize()` stores `this.options = { apiKey }`.
- At resolveModel time: `this.authStorage.setRuntimeApiKey(provider, this.options.apiKey)` injects it.

So env-var users get a **runtime override** that bypasses the empty in-memory store. Only the
**auth.json-only** path (where `resolveApiKeyForProvider` returns `undefined` and the harness must
read the file itself) is broken.

## What the New Integration Test Must Do

The fix is a **non-mocked** integration test that exercises the real `node_modules/groundswell`
`PiHarness`:

1. **DO NOT** `vi.mock('groundswell')` — the real `PiHarness` from
   `node_modules/groundswell/dist/harnesses/pi-harness.js` MUST run.
2. **DO NOT** `vi.mock('@earendil-works/pi-coding-agent')` — that would short-circuit the SDK
   import inside `PiHarness.initialize()`.
3. Mock ONLY `@anthropic-ai/sdk` (parity with `tests/integration/groundswell/agent-prompt.test.ts`)
   to prevent accidental network calls.
4. Seed a temp `PI_CODING_AGENT_DIR/auth.json` with `{ zai: { type: 'api_key', key: '...' } }`.
5. Call `ensureHarnessInitialized()` (real).
6. Fetch the live harness: `HarnessRegistry.getInstance().get('pi')`.
7. Assert `await harness.authStorage.getApiKey('zai')` resolves the seeded key.

### Isolation Gotchas (critical for the implementer)

- `HarnessRegistry` is a **process-wide singleton** — it leaks across tests in the same worker.
  Call `harness.terminate()` in `afterEach` or run in a dedicated worker pool.
- `ensureHarnessInitialized()` only registers if `!registry.has('pi')`. A prior unit test in the
  same worker that registered a mock would pollute this test. Use isolation or a separate file.
- `harness.authStorage` is **nullable** (`null` until `initialize()`) — guard with `!` or assert
  non-null first.
- `AuthStorage.getApiKey()` is **async** (`Promise<string | undefined>`) — must `await`.

### Location

`tests/integration/config/pi-harness-auth.test.ts` (matches `tests/integration/<area>/<feature>.test.ts`).

## Verified Reproduction

The PRD's repro script (`/tmp/repro.mts`) was confirmed: with auth.json-only (no env vars),
`preflight passed; harness can resolve zai key? false`. The control experiment (copying the fresh
dist over the stale one) yields `true` — `getApiKey('zai')` returns the seeded key and
`getAuthStatus('zai')` becomes `{ configured: true, source: 'stored' }`.
