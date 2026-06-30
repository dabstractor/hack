# Research — P1.M1.T1.S1 (non-mocked PiHarness auth.json integration test)

TDD **RED** test for Issue 1 (TEST_RESULTS.md): the deployed `node_modules/groundswell`
dist still uses `AuthStorage.inMemory()` and ignores `~/.pi/agent/auth.json`.

## 0. ⚠️ CRITICAL: in-process vitest CANNOT produce a RED here (verified)

`vitest.config.ts` declares:
```js
resolve: { alias: { groundswell: new URL('../groundswell/dist/index.js', import.meta.url).pathname } }
```
`import.meta.url` = the config file, so the alias target is the **sibling checkout**
`/home/dustin/projects/groundswell/dist/index.js`. Probe run under vitest:
```json
{
  "aliasTarget": "/home/dustin/projects/groundswell/dist/index.js",
  "siblingUsesCreate": true,        // ← FIXED dist
  "nodeModsUsesInMemory": true,     // ← STALE dist
  "hasHarnessRegistry": true
}
```
The two dist files differ:
| File | Line | Code |
| --- | --- | --- |
| `node_modules/groundswell/dist/harnesses/pi-harness.js` | 95 | `this.authStorage = AuthStorage.inMemory();` **STALE** |
| `~/projects/groundswell/dist/harnesses/pi-harness.js` | 103 | `this.authStorage = … ?? AuthStorage.create();` **FIXED** |

**Consequence:** under vitest, EVERY `import 'groundswell'` — including the internal
import inside `src/config/harness.ts` `ensureHarnessInitialized()` — resolves to the
FIXED sibling dist. So an in-process vitest assertion `await harness.authStorage.getApiKey('zai')`
would **PASS (GREEN)**, never RED. The contract's literal "vitest test that FAILS against the
current stale dist" is **impossible in-process**. The bug only manifests at runtime (tsx/node,
no alias) — which is exactly why the PRD Issue-1 repro uses `npx tsx /tmp/repro.mts`.

I also ruled out the "instantiate the stale PiHarness by absolute path" workaround: it would
reproduce Case A (auth.json → undefined) but NOT Case B (env → key), because the env path
flows through `ensureHarnessInitialized()` → `resolveApiKeyForProvider()` →
`initializeProvider('pi', {apiKey})` → runtime override, which direct `initialize()` skips.

## 1. The viable mechanism: vitest test that spawns a tsx SUBPROCESS

A subprocess (`node_modules/.bin/tsx <runner>`) does **not** inherit vitest's resolve alias.
Its `import 'groundswell'` resolves via normal Node resolution to `node_modules/groundswell`
(the STALE dist). This faithfully exercises both contract cases through the real
`ensureHarnessInitialized()` path against the real deployed dist. After P1.M1.T2 deploys the
fix (npm-link or republish), the subprocess's `import 'groundswell'` resolves to the FIXED
dist → Case A turns GREEN. The RED→GREEN lifecycle the contract requires is preserved.

This mirrors the existing repo pattern: `tests/unit/config/auth-preflight.test.ts:258` uses
`spawnSync(process.execPath, [CLI, ...])` to touch the real dist. `tsx` is available at
`node_modules/.bin/tsx`.

**Bonus:** the subprocess is a fresh process each run → a fresh `HarnessRegistry` singleton →
this **eliminates** the contract's isolation worries (registry leaks across tests,
`has('pi')` pollution from prior mocked unit tests, dedicated `--pool=forks` worker). No
`afterEach harness.terminate()` needed for cross-test isolation (the process dies). The
subprocess runner still calls `terminate()` internally as a tidy-up.

## 2. Ground-truth results (run via `npx tsx ./_repro_runner.mjs` from project root)

Runner: `PI_CODING_AGENT_DIR=<tmp>; ensureHarnessInitialized(); getApiKey('zai')`.

| Case | Setup (auth vars cleared) | Result on STALE dist | After fix (GREEN) |
| --- | --- | --- | --- |
| A — auth.json-only | `auth.json = {zai:{type:'api_key',key:'SECRET-FROM-AUTH-JSON'}}`, no env | `getApiKey('zai')` → **`undefined`** ❌ RED | → `'SECRET-FROM-AUTH-JSON'` |
| B — ZAI_API_KEY-only | no auth.json, `ZAI_API_KEY=SECRET-FROM-ENV` | `getApiKey('zai')` → **`'SECRET-FROM-ENV'`** ✅ (control) | → `'SECRET-FROM-ENV'` |

This **exactly matches** the work-item contract's stated expectations for both cases. The
test asserts these values; Case A is the definitive RED, Case B proves the bug is specific
to the auth.json path (and guards that the env fallback still works post-fix).

## 3. API surface (verified)

- `src/config/harness.ts:189` `export async function ensureHarnessInitialized(): Promise<void>`
  — registers `new PiHarness()` if `!registry.has('pi')`, then
  `await registry.initializeProvider('pi', apiKey ? {apiKey} : undefined)`.
- `HarnessRegistry.getInstance().get('pi')` → the live `PiHarness` (returns `undefined` if absent).
- `PiHarness.authStorage` — public, **nullable** (`null` until `initialize()`); guard with `?.`.
- `AuthStorage.getApiKey(provider)` — **async** (`Promise<string|undefined>`); single-arg form
  used (verified: returns correct values). `{ includeFallback: false }` is the 2nd-arg opt-out
  (used internally by model-registry); the test uses the default (fallback ON → env resolves).
- `PiHarness.terminate()` exists (pi-harness.js:106) — the runner calls it for tidy-up.
- auth.json shape: `{ zai: { type: 'api_key', key: '<secret>' } }` (confirmed by
  `@earendil-works/pi-coding-agent/dist/core/auth-storage.js` `type === 'api_key'`).

## 4. Deviations from the literal contract (with justification)

1. **Mechanism = subprocess, not in-process `await`.** Required because the vitest alias makes
   in-process RED impossible (§0). The contract's GOAL (RED exposing stale dist → GREEN after
   deploy) is fully met; only the mechanism differs.
2. **No `vi.mock('@anthropic-ai/sdk')`.** The contract suggested mocking it "to prevent
   accidental network calls" (parity with agent-prompt.test.ts). That mock matters for the
   in-process `createAgent` path. The subprocess path calls only `ensureHarnessInitialized()`
   (→ `PiHarness.initialize()` lazy-imports the SDK but does NOT instantiate Anthropic or make
   any call) + `getApiKey()` (purely local). No network is reachable, so no mock is needed — and
   a `vi.mock` in the vitest process would not affect the spawned subprocess anyway.
3. **No `vi.mock('groundswell')` / `vi.mock('@earendil-works/pi-coding-agent')`.** Honored
   exactly — the whole point is the REAL deployed dist runs.

## 5. Scope & validation

- File: `tests/integration/config/pi-harness-auth.test.ts` (matches `tests/integration/<area>/`).
- This is the **RED** step (P1.M1.T1). It is expected to FAIL (Case A) on the current tree.
  It turns GREEN when P1.M1.T2 deploys the fixed Groundswell dist to `node_modules`.
- Coverage note: a subprocess test executes NO `src/` code in the vitest process → contributes 0
  to src coverage. The global 100% threshold is upheld by existing unit tests (harness.ts is
  already covered). Do not treat this file in isolation as a coverage source.
- Validation command: `npx vitest run tests/integration/config/pi-harness-auth.test.ts`.
  Currently: Case A fails (RED), Case B passes. Post-fix: both pass.
