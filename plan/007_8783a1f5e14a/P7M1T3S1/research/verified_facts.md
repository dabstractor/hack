# P7.M1.T3.S1 — Verified Facts (Empirical)

Every load-bearing claim below was verified against the live tree at
`~/projects/hacky-hack` (T2.S1 DONE + shipped; T2.S2 DONE; T2.S3 implementing in parallel).
T3.S1 wires the fail-fast auth preflight onto `main()`'s startup path (PRD §9.2.7).

---

## §1. The startup path today — exact insertion point (src/index.ts)

`main()` order (line numbers verified):

```
L97   const parseResult = parseCLIArgs();           // may process.exit on --help/--version
L110  setupGlobalHandlers(args.verbose);
L113  configureEnvironment();                        // ← auth preflight goes AFTER this
L118  await ensureHarnessInitialized();              // ← auth preflight goes BEFORE this
L121  const logger = getLogger('App', {...});        // ← logger created AFTER preflight
...
L204  const pipeline = new PRPPipeline(...);
      const result = await pipeline.run();          // ← session dir + ERROR_REPORT.md created HERE
```

**Authoritative contract** (`architecture/implementation_notes.md` §T3.S1):
```ts
configureEnvironment();
await runAuthPreflight();   // NEW — abort here if no credential for selected harness+provider
await ensureHarnessInitialized();
```
So `runAuthPreflight()` is invoked **after** `configureEnvironment()` and **before**
`ensureHarnessInitialized()` / `new PRPPipeline(...)`. Because the session dir + ERROR_REPORT.md are
only created inside `pipeline.run()` (L204+), aborting at the preflight guarantees
**no session dir created, no agent invoked** (PRD §9.2.7).

`validateEnvironment()` is **NOT** on the startup path — it is called ONLY by
`src/scripts/validate-api.ts:154`. The preflight (T3.S1) replaces its (missing) startup role.
**Do NOT modify or remove `validateEnvironment()`** (back-compat for the validate-api script).

---

## §2. T2.S1 resolver is SHIPPED (verbatim from src/config/harness.ts) — the INPUT contract

T3.S1 **consumes** (does NOT re-implement) these exports from the DONE T2.S1:

```ts
// src/config/harness.ts (SHIPPED)
export function resolveApiKeyForProvider(
  provider: string,
  options?: { override?: string }
): string | undefined {
  // 1. Explicit override (options.override ?? process.env.PRP_API_KEY), trimmed.
  // 2. Provider-native env var via LOCAL getProviderEnvApiKey(provider), trimmed.
  //    - zai      → process.env.ZAI_API_KEY
  //    - anthropic → process.env.ANTHROPIC_OAUTH_TOKEN ?? process.env.ANTHROPIC_API_KEY
  // 3. auth.json → returns undefined (deferred to pi's file-backed AuthStorage, T2.S2).
}
export async function ensureHarnessInitialized(): Promise<void> {
  const apiKey = resolveApiKeyForProvider(getResolvedProvider());
  await registry.initializeProvider('pi', apiKey ? { apiKey } : undefined); // forward only when non-empty
}

// src/config/environment.ts (SHIPPED)
export function getResolvedProvider(): string { return getModel('sonnet').split('/')[0]; }  // default 'zai'
export function getModel(tier: ModelTier): string { ... }   // 'zai/glm-5.2' etc.
```

**IMPORTANT divergence from the T2.S1 PRP:** the SHIPPED resolver uses a **LOCAL**
`getProviderEnvApiKey(provider)` helper (reads `process.env` directly) — NOT pi-ai's `getEnvApiKey`.
The import is `@earendil-works/pi-coding-agent` is NOT needed for the resolver; T3.S1 adds it for
`AuthStorage` only. The mapping is identical to pi's (`zai`→`ZAI_API_KEY`;
`anthropic`→`ANTHROPIC_OAUTH_TOKEN` then `ANTHROPIC_API_KEY`).

`runAuthPreflight()` reuses `resolveApiKeyForProvider(provider)` + `getResolvedProvider()` + `getModel()`.
No circular import: harness.ts already imports `getResolvedProvider`/`getModel` from environment.ts;
environment.ts imports nothing from harness.ts.

---

## §3. CRITICAL — `AuthStorage.hasAuth()` is TOO LENIENT; use `getAuthStatus().configured`

The work item says "the ACCURATE, drift-proof preflight primitive is
`AuthStorage.hasAuth(provider)`/`getAuthStatus(provider)` (architecture/groundswell_auth_api.md §2)".
**Both were probed empirically** (`AuthStorage.create()` against a temp `PI_CODING_AGENT_DIR`).
Result matrix for provider `zai`:

| # | Source present                                  | `hasAuth('zai')` | `getAuthStatus('zai')`                                  |
|---|-------------------------------------------------|------------------|---------------------------------------------------------|
| 1 | nothing (file absent, no env)                   | `false`          | `{configured:false}`                                    |
| 2 | `auth.json` = `{zai:{type:'api_key',key:'k1'}}` | `true`           | `{configured:true, source:"stored"}`                    |
| 3 | `ZAI_API_KEY='env-key'` (non-empty)             | `true`           | `{configured:false, source:"environment", label:"ZAI_API_KEY"}` |
| 4 | `ZAI_API_KEY='   '` (whitespace-only)           | **`true`** ❌     | `{configured:false, source:"environment", label:"ZAI_API_KEY"}` |
| 5 | nothing (absent file)                           | `false`          | `{configured:false}`                                    |
| 6 | `ANTHROPIC_API_KEY='ant-key'`                   | hasAuth('anthropic')=`true`; hasAuth('zai')=`false` | anthropic status `{configured:false, source:"environment"}` |

**Two decisive findings:**

1. **`hasAuth()` returns `true` for a WHITESPACE-ONLY env var (row 4).** It only checks "does the
   source EXIST", not "is it non-empty". Using `hasAuth` alone would VIOLATE PRD §9.2.7's empty-string
   policy (whitespace-only == "not configured") and let a whitespace `ZAI_API_KEY` run proceed.
2. **`getAuthStatus().configured` is `false` for the `environment` source** (rows 3, 4, 6) — even when
   the env var holds a real key — and `true` ONLY for a resolvable stored/runtime/fallback credential
   (row 2: `source:"stored"`, `configured:true`). So `configured` correctly EXCLUDES env vars
   (incl. whitespace) and correctly INCLUDES a real auth.json api_key.

**Therefore the correct preflight predicate (drift-proof + empty-string-safe) is:**

```ts
// Source 1+2: hacky-hack override/env (empty-string policy via resolveApiKeyForProvider's .trim()).
if (resolveApiKeyForProvider(provider)) return;       // configured
// Source 3: pi file-backed AuthStorage — auth.json (SAME resolver pi uses at runtime).
//           getAuthStatus().configured is false for the env source, so whitespace env does NOT pass.
if (AuthStorage.create().getAuthStatus(provider).configured) return;  // configured (auth.json)
// else → fail
```

Verified against all 6 rows:
- row 1/5 (nothing): resolve→undefined; status.configured=false → FAIL ✓
- row 2 (auth.json): resolve→undefined; status.configured=**true** → PASS ✓ (auth.json-only succeeds — PRD §9.2.7)
- row 3 (valid env): resolve→'env-key' → PASS ✓ (ZAI-only succeeds — PRD §9.2.7)
- row 4 (whitespace env): resolve→undefined (trim→empty); status.configured=false → FAIL ✓ (empty-string policy!)
- row 6 (anthropic env): resolve('anthropic')→'ant-key' → PASS ✓

**Do NOT use `hasAuth()` as the auth.json check** — it would pass whitespace env. Use
`getAuthStatus(provider).configured`. (Optionally also surface `status.source`/`status.label` in the
failure message for diagnostics, but the gate predicate is `configured`.)

---

## §4. `AuthStorage` import + reachability

- `AuthStorage` lives in **`@earendil-works/pi-coding-agent`** (`dist/core/auth-storage.d.ts`).
- **Groundswell does NOT re-export it** (`grep -c AuthStorage node_modules/groundswell/dist/index.d.ts` → `0`).
- `@earendil-works/pi-coding-agent` is already a **devDependency** (`^0.79.8`) of hacky-hack — added by the
  parallel T2.S3. It resolves from root under NodeNext ESM:
  `node --input-type=module -e "import('@earendil-works/pi-coding-agent')..."` →
  `AuthStorage.create: function`. So `import { AuthStorage } from '@earendil-works/pi-coding-agent'`
  works in `src/` **as-is** (hacky-hack is a local CLI; devDeps are always present locally, and pi-coding-agent
  is ALSO a transitive runtime dep via groundswell's `PiHarness.initialize()` `await import(...)`).
- **Recommended (correctness, optional):** since `src/` now statically imports it, the implementer MAY
  promote it to `dependencies` (or leave it as the devDep T2.S3 added — it resolves either way). If a
  duplicate key appears (T2.S3 added devDep; T3.S1 might add dep), keep ONE entry; prefer `dependencies`.

### AuthStorage API surface (verbatim from .d.ts / groundswell_auth_api.md §2)
```ts
static create(authPath?: string): AuthStorage;   // FileAuthStorageBackend; default join(getAgentDir(),'auth.json')
static inMemory(data?: AuthStorageData): AuthStorage;
hasAuth(provider: string): boolean;              // EXISTS check (lenient — sees whitespace env)
getAuthStatus(provider: string): AuthStatus;     // {configured:boolean; source?:"stored"|"runtime"|"environment"|"fallback"|...; label?}
getApiKey(providerId: string, options?): Promise<string | undefined>;  // ASYNC; refreshes OAuth
reload(): void;
```
- `getAuthStatus`/`hasAuth` are **SYNC** (return directly; `getApiKey` is the only async one). So
  `runAuthPreflight`'s AuthStorage half is sync; the function can be `async` only to match the
  architecture sketch's `await runAuthPreflight()` (await on a sync value is a no-op).
- `AuthStorage.create()` is **missing-file tolerant** (constructor `reload()` catches into `loadError`;
  does NOT throw when `~/.pi/agent/auth.json` is absent) → safe to construct unconditionally.

### `getAgentDir()` — the auth.json path (groundswell_auth_api.md §6)
```js
getAgentDir() = process.env.PI_CODING_AGENT_DIR ? expandTildePath(env) : join(homedir(), '.pi', 'agent')
```
Default `~/.pi/agent`; auth.json at `~/.pi/agent/auth.json`. Override via `PI_CODING_AGENT_DIR` (used by tests).

---

## §5. Harness + provider/model resolution at preflight time

- **Harness id:** `process.env[PRP_AGENT_HARNESS] ?? DEFAULT_HARNESS` (`DEFAULT_HARNESS = 'pi'`).
  There is no exported reader; `configureHarness()` reads it the same way but is called lazily at
  module-load in `agent-factory.ts` (NOT in `main()`). The preflight must read the harness id DIRECTLY
  from env to be independent of `configureHarness()`'s lazy timing.
- **Provider:** `getResolvedProvider()` = `getModel('sonnet').split('/')[0]` (default `'zai'`).
- **Model:** `getModel('sonnet')` (e.g. `'zai/glm-5.2'`).
- **claude-code special case:** that harness is **Anthropic-only** (PRD §9.4.1/§9.2.7). The preflight
  checks the **`anthropic`** credential for it (regardless of the resolved model). If the user selected
  `claude-code` with a `zai` model, that mismatch is a SEPARATE config error caught later by
  `configureHarness()` → `HarnessProviderMismatchError` (NOT the preflight's job).

So: `checkProvider = (harness === 'claude-code') ? 'anthropic' : getResolvedProvider()`.

---

## §6. Error pattern (throw a dedicated Error, like the existing two)

`src/config/types.ts` already defines two startup errors thrown from the config layer:
- `EnvironmentValidationError(missing[])` — `super(message); this.name='EnvironmentValidationError'`.
- `HarnessProviderMismatchError(harness, provider)` — builds an actionable message in the constructor.

**Follow that pattern:** add `AuthPreflightError` to `src/config/types.ts`. It accepts structured fields
`{ harness, provider, model }` and builds the PRD §9.2.7 actionable message in its constructor (naming
the selected harness+provider/model, every empty source checked, the exact remediation). The preflight
THROWS it on failure; `main()`'s top-level catch prints it cleanly + exits 1.

**Why throw (not `process.exit` inside the function):** keeps `runAuthPreflight()` pure/testable (assert
`toThrow(AuthPreflightError)` + message), matches the existing thrown-error pattern, and the message is
built once in one place. `main()` handles the side effect (console + exit) at the boundary.

---

## §7. `main()` output/exit handling (logger is created AFTER the preflight)

- The root logger (`getLogger('App', ...)`) is constructed at `src/index.ts:121` — **after** the preflight
  insertion point (between L113 and L118). So **NO logger exists at preflight time**. Use
  `console.error` for the failure message (mirrors the existing `void main().catch(...)` handler which
  uses `console.error`). This sidesteps PRD §9.6 REQ-L2 (lazy loggers) entirely — no logger is built.
- Existing top-level catch (`src/index.ts:226` `void main().catch((error) => {
  console.error('\n❌ Fatal error in main():', error); process.exit(1); })`) prints "Fatal error in
  main():" + the error — NOISY for the preflight. UPDATE it to detect `AuthPreflightError` and print
  ONLY the error message (`\n❌ ${error.message}`) with exit 1, falling through to the existing handler
  for all other errors.

---

## §8. Test isolation — `PI_CODING_AGENT_DIR` temp dir is MANDATORY

`AuthStorage.create()` reads the developer's REAL `~/.pi/agent/auth.json` unless `PI_CODING_AGENT_DIR`
is overridden. On the dev machine a real auth.json likely EXISTS, so a "no-credential" test would
WRONGLY pass (find a stored credential). **Every preflight test MUST** `mkdtempSync` a temp dir +
`vi.stubEnv('PI_CODING_AGENT_DIR', tmp)` in `beforeEach` and `rmSync(tmp)` + `vi.unstubAllEnvs()` in
`afterEach` (mirrors T2.S3's case-(c) isolation). Also clear auth env vars (`ZAI_API_KEY`,
`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_OAUTH_TOKEN`, `PRP_API_KEY`,
`ANTHROPIC_DEFAULT_SONNET_MODEL`) in `beforeEach` because `tests/setup.ts` runs `dotenv.config()`
(pollutes `process.env` from the dev `.env`).

---

## §9. Existing test pattern to follow — `tests/unit/config/harness-provider-compat.test.ts`

- `vi.mock('groundswell', factory)` at module top (hoisted) — intercepts ONLY `'groundswell'`.
  Factory returns `{ configureHarnesses: vi.fn(), HarnessRegistry: { getInstance: () => ({...}) },
  PiHarness: class {} }`.
- `beforeEach`: `vi.clearAllMocks()` (global, from setup.ts) + `delete process.env.PRP_AGENT_HARNESS` +
  `vi.stubEnv('ANTHROPIC_API_KEY', 'stubbed-key')`. `afterEach`: `vi.unstubAllEnvs()`.
- **For the preflight test,** the groundswell mock is NOT strictly needed (the preflight uses
  `AuthStorage` from `@earendil-works/pi-coding-agent`, a DIFFERENT module not affected by the groundswell
  mock) — but `resolveApiKeyForProvider` lives in `harness.ts` which imports `groundswell`, so the mock
  IS still required to import `harness.ts` without a real groundswell singleton. Keep the mock.
- `vi.mock('@earendil-works/pi-coding-agent', ...)` is an OPTION if you want to stub `AuthStorage`, but
  the REAL `AuthStorage` + temp-dir `PI_CODING_AGENT_DIR` is the drift-proof approach (proves the
  file-backed read). Prefer the real one + temp-dir isolation (mirrors T2.S3 case c). DO mock
  `process.exit`/`console.error` is NOT needed — `runAuthPreflight` THROWS, so assert `toThrow`.

---

## §10. Coverage gate + T3.S1 / T3.S2 test boundary

- `vitest.config.ts` enforces 100% on `src/**` (test files excluded). The new `runAuthPreflight()`
  branches (override/env success → early return; auth.json success → early return; failure → throw;
  claude-code provider swap) MUST all be hit, or the gate breaks after T3.S1 alone.
- **Boundary (mirrors the T2.S1 ↔ T2.S3 split):** T3.S1 ships a **coverage-sufficient** suite
  (`tests/unit/config/auth-preflight.test.ts`) — success-via-env, success-via-auth.json, failure-throws,
  claude-code branch — enough for 100% on the new code. **T3.S2** owns the full ACCEPTANCE/integration
  matrix (no-session-dir-on-fail, ZAI-only proceeds end-to-end, AUTH_TOKEN-only-for-anthropic, the
  `main()` wiring integration, etc.). Do NOT duplicate T3.S2's acceptance cases here.

---

## §11. docs/INSTALLATION.md is STALE — Mode A update required

- Current INSTALLATION.md (read in full) still states `ANTHROPIC_AUTH_TOKEN | Yes` (required) in the env
  table, `export ANTHROPIC_AUTH_TOKEN=zk-xxxxx` in Quick Start step 4, and "AUTH_TOKEN mapped to API_KEY
  on startup" as the documented flow. This is **factually wrong** post-T2.S1+T3.S1 (the preflight now
  ACCEPTS `pi /login`/`ZAI_API_KEY`/auth.json and the default path needs NO Anthropic var). T2.S1 updated
  `.env.example` + `docs/CONFIGURATION.md` but NOT INSTALLATION.md.
- **T3.S1 Mode A docs (work-item DOCS clause):**
  1. ADD a troubleshooting subsection documenting the NEW preflight failure mode (the exact actionable
     message + remediation: `pi /login` or `export ZAI_API_KEY=…`).
  2. UPDATE Quick Start step 4 + the "Required/Optional Variables" env table so the PRIMARY path is
     `pi /login` (writes `~/.pi/agent/auth.json`) OR `export ZAI_API_KEY=…`; DEMOTE
     `ANTHROPIC_AUTH_TOKEN`/`ANTHROPIC_API_KEY` to optional `anthropic`-provider aliases.
  3. **Do NOT touch `README.md`** — that is Mode B and owned by T4.S1.

---

## §12. Validation commands (verified working in this tree)

```bash
cd ~/projects/hacky-hack
npm run typecheck        # tsc --noEmit -p tsconfig.build.json (NodeNext, strict) — catches import/signature errors
npm run lint             # eslint . --ext .ts
npm run format:check     # prettier --check (run `npm run format` to fix)
npx vitest run tests/unit/config/auth-preflight.test.ts   # the new file
npx vitest run tests/unit/config/                          # all config tests green
npm run validate         # lint + format:check + typecheck + test:run
npm run test:coverage    # 100% on src/** — confirms new runAuthPreflight branches are covered
```

## §13. Acceptance greps (the §9.2.7 invariants)
```bash
# runAuthPreflight is invoked on the startup path, between configureEnvironment and ensureHarnessInitialized.
rg -n "runAuthPreflight" src/index.ts                      # ≥1 hit, located between the two
# runAuthPreflight is exported (T3.S2 / consumers import it).
rg -n "export (async )?function runAuthPreflight" src/config/harness.ts
# The preflight uses AuthStorage (the drift-proof primitive), NOT a raw process.env-only check.
rg -n "AuthStorage" src/config/harness.ts                  # ≥1 hit
# AuthPreflightError exists.
rg -n "class AuthPreflightError" src/config/types.ts
# main() handles AuthPreflightError cleanly (exit 1, ONE message).
rg -n "AuthPreflightError" src/index.ts                    # ≥1 hit
```

## §14. Scope boundaries
- **IN:** `runAuthPreflight()` (harness.ts) + `AuthPreflightError` (types.ts) + `main()` wiring
  (index.ts) + coverage-sufficient test (auth-preflight.test.ts) + INSTALLATION.md Mode A.
- **OUT (do NOT touch):** `resolveApiKeyForProvider`/`getResolvedProvider`/`ensureHarnessInitialized`
  (DONE by T2.S1 — consume them); `validateEnvironment()` (back-compat; not on startup path);
  `endpoint-guard.ts` (§9.2.4 safeguard); `src/config/constants.ts` (PRP_AGENT_HARNESS/PRP_API_KEY exist);
  `PiHarness.initialize()`/groundswell repo (T2.S2 owns the file-backed store); the full acceptance
  matrix (T3.S2); README (T4.S1); PRD.md / tasks.json / prd_snapshot.md / .gitignore (READ ONLY).
