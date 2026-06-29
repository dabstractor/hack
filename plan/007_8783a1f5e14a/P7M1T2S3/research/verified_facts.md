# Verified Facts — P7.M1.T2.S3 (Tests for the provider-aware auth resolution order)

All findings empirically verified in hacky-hack (`~/projects/hacky-hack`) on 2026-06-29.
**CRITICAL CONTEXT**: T2.S2 (Groundswell file-backed AuthStorage) is being implemented IN PARALLEL
right now — it is mutating `node_modules` (re-linking groundswell). `ls node_modules/@earendil-works/`
was EMPTY at inspection time. T2.S3 MUST run after S2 settles (dist rebuilt + groundswell re-linked).
Treat S2's PRP as a contract: `PiHarness.initialize()` builds `AuthStorage.create()` (file-backed).

---

## §1 — What S1 already shipped (the INPUT resolver; DO NOT duplicate)

`src/config/harness.ts` (DONE, verified by reading the file):
- `export function resolveApiKeyForProvider(provider: string, options?: { override?: string }): string | undefined`
  - Priority: (1) `options.override ?? process.env.PRP_API_KEY` trimmed; (2) **local** `getProviderEnvApiKey(provider)`
    trimmed; (3) returns `undefined` (auth.json deferred to pi). Whitespace-only → undefined.
  - `getProviderEnvApiKey` is a PRIVATE local fn (NOT pi-ai's getEnvApiKey): `zai` → `process.env.ZAI_API_KEY`;
    `anthropic` → `process.env.ANTHROPIC_OAUTH_TOKEN ?? process.env.ANTHROPIC_API_KEY`; else undefined.
  - NOTE: `ANTHROPIC_AUTH_TOKEN` is NEVER directly read here. It only reaches the resolver via
    `configureEnvironment()` mapping `ANTHROPIC_AUTH_TOKEN → ANTHROPIC_API_KEY` for the `anthropic` provider.
- `export async function ensureHarnessInitialized(): Promise<void>`:
  - `const registry = HarnessRegistry.getInstance();` (imported from 'groundswell')
  - `if (!registry.has('pi')) registry.register(new PiHarness());` (PiHarness from 'groundswell')
  - `const apiKey = resolveApiKeyForProvider(getResolvedProvider());`
  - `await registry.initializeProvider('pi', apiKey ? { apiKey } : undefined);`  ← forwards `{apiKey}` ONLY when non-empty.
- `export function getResolvedProvider(): string` in `src/config/environment.ts` → `getModel('sonnet').split('/')[0]`
  (`'zai'` default; `'anthropic'` when `ANTHROPIC_DEFAULT_SONNET_MODEL='anthropic/*'`).
- `configureEnvironment()` (environment.ts) maps `ANTHROPIC_AUTH_TOKEN→ANTHROPIC_API_KEY` ONLY when
  provider is `anthropic`; defaults `ANTHROPIC_BASE_URL` to z.ai ONLY for `zai`.

## §2 — S1's EXISTING test file `tests/unit/config/auth-resolver.test.ts` (the DUPLICATION BOUNDARY)

- Tests the resolver FUNCTION in isolation (`resolveApiKeyForProvider`, `getResolvedProvider`,
  `configureEnvironment`). Does NOT mock groundswell. Does NOT seed auth.json. Does NOT call
  `ensureHarnessInitialized`. Does NOT assert what is forwarded to the harness.
- S1's PRP explicitly states: "The comprehensive resolution matrix + auth.json-on-disk tests are owned
  by T2.S3." → T2.S3's file (`auth-resolution.test.ts`) is the END-TO-END + auth.json + forwarding
  matrix. It is a DIFFERENT file (different name) with DIFFERENT scope. NO overlap if T2.S3 does not
  re-test the bare resolver function (that's done) and instead tests the resolution ORDER through
  `ensureHarnessInitialized` + the auth.json-on-disk acceptance.

## §3 — The pattern to follow: `tests/unit/config/harness-provider-compat.test.ts`

- `vi.mock('groundswell', () => ({ configureHarnesses: vi.fn(), HarnessRegistry: { getInstance: () => ({ has: () => false, register: vi.fn() }) }, PiHarness: class MockPiHarness {} }))`
- For forwarding tests, extend the mock's `getInstance()` to return a SPY `initializeProvider` so we can
  assert `registry.initializeProvider('pi', opts)` call args (what hacky-hack forwards).
- `vi.mock` is module-level + hoisted; it ONLY intercepts the exact specifier `'groundswell'`. It does
  NOT affect `'@earendil-works/pi-coding-agent'` (a different module) — so a REAL AuthStorage import can
  coexist in the same test file (used for the case-(c) file-backed assertion).
- Pattern uses `beforeEach(vi.clearAllMocks)`, `vi.stubEnv`, `afterEach(vi.unstubAllEnvs)`.

## §4 — AuthStorage reachability in hacky-hack (THE crux of case (c))

- Groundswell's `dist/index.d.ts` / `dist/index.js` do **NOT** re-export `AuthStorage` or `ModelRegistry`
  (verified: `grep AuthStorage ../groundswell/dist/index.js` → zero hits). Groundswell re-exports only
  `PiHarness`, `HarnessRegistry`, `configureHarnesses` (what hacky-hack imports).
- `@earendil-works/pi-coding-agent` DOES re-export `AuthStorage`/`ModelRegistry` (S1's verified_facts §1)
  and has an exports map `".": {"import":"./dist/index.js"}`.
- BUT it is NOT a declared dependency of hacky-hack (`package.json` has only `"groundswell": "^1.0.0"`
  under `@earendil-works`; no `pi-coding-agent`, no `pi-ai`). At inspection it was NOT hoisted to
  hacky-hack's top-level `node_modules/@earendil-works/` (empty). Bare-node `import()` failed with
  `ERR_MODULE_NOT_FOUND`.
- AuthStorage static factory API (groundswell_auth_api.md §2, verbatim from .d.ts):
  - `AuthStorage.create(authPath?)` → file-backed; default path `join(getAgentDir(),'auth.json')` =
    `~/.pi/agent/auth.json`, overridable via `PI_CODING_AGENT_DIR` (§6). Missing-file tolerant (no throw).
  - `AuthStorage.inMemory(data?)` → in-memory; accepts a seed `AuthStorageData` e.g.
    `{ zai: { type:'api_key', key:'...' } }`.
  - `getApiKey(provider, opts?)` is ASYNC (`Promise<string|undefined>`). Priority:
    runtime → auth.json api_key → auth.json oauth → env → fallback.
- **DEP ADDITION REQUIRED** to import AuthStorage: add `"@earendil-works/pi-coding-agent"` to
  `devDependencies` (mirrors S1's `@earendil-works/pi-ai` precedent). The implementing agent checks the
  version nested under groundswell (`node_modules/groundswell/node_modules/@earendil-works/pi-coding-agent/package.json`
  AFTER S2's link settles) and adds a matching caret range, then `npm install`. Then vitest resolves it
  (vitest resolution is more lenient than bare node; `deps.interopDefault:true`).
- FALLBACK if the dep cannot be added/imported: case (c) tests ONLY the hacky-hack half (resolver returns
  undefined + ensureHarnessInitialized forwards undefined) and cites T2.S2 (groundswell repo) + the S2
  behavioral smoke for the file-backed proof. This still satisfies the hacky-hack-side acceptance.

## §5 — vitest.config.ts (test harness contract)

- `resolve.alias.groundswell → new URL('../groundswell/dist/index.js').pathname` (the rebuilt dist S2
  produces; NOT node_modules/groundswell). `fs.allow: ['.', '..']` permits importing `../groundswell`.
- `coverage` 100% gate on `include: ['src/**/*.ts']`, `exclude: ['**/*.test.ts', ...]`. → T2.S3 is a
  NEW test file → EXCLUDED from coverage. It touches NO `src/` file (test-only). → **No coverage burden.**
  The 100% gate is auto-satisfied as long as existing `src/` coverage is not broken (it isn't — no src edits).
- `setupFiles: ['./tests/setup.ts']`, `globals: true`, `pool: 'forks'`, `deps.interopDefault: true`.
- `environment: 'node'`, `include: ['tests/**/*.{test,spec}.ts']`.

## §6 — tests/setup.ts (global env pollution + safeguard)

- `dotenv.config()` runs at setup → process.env is POLLUTED by the dev's `.env` at test start. Every
  auth test MUST `delete`/`vi.stubEnv` the vars it cares about in `beforeEach`:
  `ZAI_API_KEY`, `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_OAUTH_TOKEN`, `PRP_API_KEY`,
  `ANTHROPIC_DEFAULT_SONNET_MODEL`. (`vi.unstubAllEnvs()` in afterEach restores stubs but does NOT undo
  `delete` on real env vars from .env — re-stub/unstub explicitly.)
- `validateProviderEndpoint()` (§9.2.4 safeguard) runs at setup AND `beforeEach`. It THROWS if
  `ANTHROPIC_BASE_URL` is `api.anthropic.com`; WARNS otherwise. → In auth tests NEVER set
  `ANTHROPIC_BASE_URL='https://api.anthropic.com'`. For the anthropic-provider case, leave BASE_URL
  unset or set a safe value (e.g. a mock `https://mock.local`). The existing `configureEnvironment`-
  based auth-resolver tests leave it unset and pass.
- `beforeEach(vi.clearAllMocks)` globally — so re-assert the spy each test or restore implementations.

## §7 — The five resolution-order cases → concrete assertions

(a) **explicit override wins**: `resolveApiKeyForProvider('zai', {override:'X'})` → 'X' even with ZAI_API_KEY set;
  `PRP_API_KEY` env also wins over ZAI. `ensureHarnessInitialized` (mocked spy) → `initializeProvider('pi', {apiKey:'X'})`.
(b) **ZAI_API_KEY-only** (no override, no Anthropic var): resolver → the ZAI value; spy → `{apiKey: zaiVal}`.
(c) **auth.json-only** (no env at all): resolver → `undefined`; spy → `initializeProvider('pi', undefined)` (NOT
  `{apiKey:''}`); + `AuthStorage.create()` against temp `PI_CODING_AGENT_DIR`/auth.json →
  `await auth.getApiKey('zai') === 'the-seeded-key'` (file-backed proof, needs §4 dep + S2 dist).
(d) **empty/whitespace** (ZAI_API_KEY='   ', PRP_API_KEY unset): resolver → undefined; spy → undefined.
(e) **ANTHROPIC_AUTH_TOKEN only-when-anthropic**: with provider=`zai` + AUTH_TOKEN set (no ZAI) → resolver
  returns undefined (AUTH_TOKEN NOT consulted for zai; configureEnvironment does NOT map it for zai); spy →
  undefined. With provider=`anthropic` (`ANTHROPIC_DEFAULT_SONNET_MODEL='anthropic/*'`) + AUTH_TOKEN set →
  `configureEnvironment()` maps AUTH_TOKEN→API_KEY; `resolveApiKeyForProvider('anthropic')` → the token value;
  spy → `{apiKey: tokenVal}`. (Tests BOTH halves of "only when anthropic".)

## §8 — Validation commands (verified present in package.json)

- `npm run validate` = `lint && format:check && typecheck && test:run` (the full gate).
- `npm run test:coverage` = `vitest run --coverage`.
- `npx vitest run tests/unit/config/` (the config suite in isolation — proves "existing config tests green").
- `npm run validate:groundswell` + `tests/unit/groundswell/imports.test.ts` (confirms S2's rebuilt+relinked
  dist imports cleanly — run these FIRST to confirm S2 is settled before T2.S3).

## §9 — Scope boundaries (NO overlap with siblings)

- T2.S1 (DONE): the resolver + configureEnvironment + ensureHarnessInitialized SOURCE. T2.S3 CONSUMES it.
- T2.S2 (parallel, groundswell repo): file-backed AuthStorage inside PiHarness.initialize() + groundswell's
  OWN pi-harness-initialize.test.ts. T2.S3 does NOT edit groundswell; it consumes the rebuilt dist.
- T3 (later): the fail-fast preflight (reuses resolveApiKeyForProvider + getResolvedProvider). T2.S3 does
  NOT test the preflight (that's T3.S2); T2.S3 tests the RESOLUTION ORDER only.
- T2.S3 OUTPUT is ONE new test file + (optionally) ONE devDep line. NO src/ edits. NO doc edits (Mode A
  docs rode with S1; T2.S3 is test-only per the work-item DOCS clause).

## §10 — Naming + placement

- New file: `tests/unit/config/auth-resolution.test.ts` (DIFFERENT name from S1's `auth-resolver.test.ts`;
  the work item uses "e.g." so the name is a strong recommendation, not a hard requirement — keep it to
  distinguish from S1's resolver-unit file).
- devDep (if §4 path taken): `"@earendil-works/pi-coding-agent"` under `devDependencies` in package.json.
- No other files touched.
