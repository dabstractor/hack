# Implementation Notes & Contracts — Delta Session 007

This document translates the research (`system_context.md`, `groundswell_auth_api.md`, `external_deps.md`)
into concrete, file-level contracts for each subtask. PRP-generation agents should treat the
"CONTRACT" blocks here as authoritative; they reference verified file paths, line numbers, and API shapes.

---

## T1 — Logging Architecture (PRD §9.6)

### T1.S1 — Synchronous destinations (REQ-L1)

**File:** `src/utils/logger.ts`

**Current violation (verbatim, the `createLoggerConfig()` `if (!machineReadable)` branch):**
```ts
if (!machineReadable) {
  return {
    ...baseConfig,
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname',
                 messageFormat: '[{correlationId}] [{context}] {msg}', singleLine: false },
    },
  };
}
```

**Required change:**
- Import `pino-pretty` and pass it as the **second (destination) argument** to `syncPino(...)`, NOT as a `transport:` config key:
  ```ts
  import pretty from 'pino-pretty';            // ESM default export IS the factory (v7+)
  // safe interop fallback if needed:
  // const pretty = (prettyNs as any).default ?? prettyNs;
  const dest = pretty({ colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname',
                       messageFormat: '[{correlationId}] [{context}] {msg}', singleLine: false });
  const pinoLogger = syncPino({ ...config, base: { context, correlationId } }, dest);
  ```
- **Do NOT** mix forms — `syncPino({ transport: ... }, pretty())` double-formats AND spawns a worker.
- Leave `destination` unset (defaults to `process.stdout`) — do **not** pass a file path (would re-introduce SonicBoom async flush + an exit handler).
- **Also defer the eager pino load:** the top-level module block `{ const { createRequire } = await import('module'); ... syncPino = require('pino'); }` runs at module-eval. Move it into a lazy `getPino()` accessor invoked on first `getLogger()`. Keep `syncPino`/`syncStdTime` cached.
- **Remove** the `process.setMaxListeners?.(30)` hack in `getLogger()` — it was a band-aid for the transport worker exit listeners; with sync destinations there are no workers.

**Acceptance (REQ-L1):** `rg -n "transport\s*:" src/utils/logger.ts` returns **zero hits**. No `ThreadStream`/worker spawned by any logger config.

### T1.S2 — Lazy logger instantiation (REQ-L2)

**Files: the 31 top-level declarations.** Replace `const logger = getLogger('X')` with a lazy accessor so the logger is constructed only on first use, e.g. a module-local memoized function:
```ts
// BEFORE (module top-level — FORBIDDEN by REQ-L2):
import { getLogger } from '../utils/logger.js';
const logger = getLogger('Foo');

// AFTER (lazy — constructed on first call, cached):
import { getLogger } from '../utils/logger.js';
let _logger: Logger | undefined;
const logger = (): Logger => (_logger ??= getLogger('Foo'));
// then call sites: logger().info(...)  (wrapPinoLogger already returns an object; keep a
// one-time init via a getter, OR convert all call sites logger.x → logger().x).
```
**Preferred minimal-churn pattern** (fewer call-site edits): hold the logger behind a private getter / lazy property so existing `logger.info(...)` call sites compile unchanged. Pick ONE pattern and apply it uniformly across all 31 files.

**Acceptance (REQ-L2):** `rg -n "^(export )?(const|let) \w+ = getLogger\(" src/` returns **zero hits**. Preserve the context-keyed cache (`loggerCache`) so no duplicate instances are created.

**Full list of the 31 sites (verified):**
```
src/cli/index.ts:40                              src/utils/build-logger.ts:37
src/agents/agent-factory.ts:49                   src/utils/package-json-syntax-verifier.ts:36
src/cli/commands/validate-state.ts:39            src/core/session-utils.ts:36
src/cli/commands/inspect.ts:46                   src/utils/retry.ts:556
src/cli/commands/artifacts.ts:37                 src/cli/commands/cache.ts:31
src/utils/startup-error-verifier.ts:38           src/utils/cli-help-executor.ts:37
src/utils/package-json-updater.ts:44             src/core/task-patcher.ts:26
src/utils/prd-validation-executor.ts:43          src/utils/eslint-result-parser.ts:43
src/utils/single-test-runner.ts:41               src/utils/pass-rate-analyzer.ts:49
src/core/dependency-validator.ts:44              src/utils/issue-resolution-verifier.ts:53
src/utils/git-commit.ts:27                       src/utils/memory-comparison-reporter.ts:36
src/utils/cli-options-verifier.ts:35             src/utils/high-priority-warning-verifier.ts:42
src/utils/validation-report-verifier.ts:38       src/utils/package-json-reader.ts:35
src/utils/console-log-verifier.ts:36             src/utils/full-test-suite-runner.ts:57
src/utils/eslint-error-verifier.ts:46            src/core/tasks-json-recovery.ts:45
src/core/state-validator.ts:38
```
> NOTE for PRP agents: the exact line numbers may shift slightly as S1 edits `logger.ts`; re-grep with `^(export )?(const|let) \w+ = getLogger\(` to get the live list before migrating. All 31 must be migrated regardless of line drift.

### T1.S3 — Single root logger per process (REQ-L3) + validation

- Derive component loggers from ONE shared root (e.g. `getLogger()` returns a child of a process-wide root pino). Bound total destinations to **one synchronous stream, zero workers**.
- **Validation test** (new `tests/unit/utils/logger-teardown.test.ts` or extend `logger.test.ts`):
  - Assert `hack --help`, `-h`, `--version`, and an invalid flag each finish **< 2s** (spawn the built CLI, measure wall time).
  - Assert no worker thread spawned: spy on `worker_threads.Worker` during `getLogger()` construction (`vi.spyOn(workerThreads, 'Worker')` → not called), and/or assert the logger destination (`log[pino.symbols.streamSym]`) is not a `ThreadStream`.
  - (See `external_deps.md §1 Finding 6` for the spy patterns.)

---

## T2 — Provider-Agnostic Authentication Model (PRD §9.2.6)

### T2.S1 — Provider-aware resolver in hacky-hack (`src/config/harness.ts` + `environment.ts`)

**New contract:** a function that resolves auth for the **selected provider** (default `zai`, from `getModel('sonnet').split('/')[0]`) in priority order (first non-empty wins):

1. **Explicit override** — `options.apiKey` / future `PRP_API_KEY` env var.
2. **Provider-native env var** — via pi's `getEnvApiKey(provider)` mapping (`ZAI_API_KEY` for `zai`; `ANTHROPIC_OAUTH_TOKEN` then `ANTHROPIC_API_KEY` for `anthropic`). Import `getEnvApiKey` from `@earendil-works/pi-ai` (re-exported through `@earendil-works/pi-coding-agent`).
3. **`~/.pi/agent/auth.json`** — honored by the file-backed `AuthStorage` once T2.S2 lands; hacky-hack should forward **nothing** (let pi resolve natively) when only the file is present.

**Critical rules:**
- **Forward an override only when non-empty** — replace `apiKey ? { apiKey } : undefined` and the `?? ''` patterns; **never** thread empty/whitespace strings into harness options.
- **Demote `ANTHROPIC_AUTH_TOKEN`:** keep `configureEnvironment()`'s `ANTHROPIC_AUTH_TOKEN` → `ANTHROPIC_API_KEY` mapping **only** as a backward-compat alias used **when the provider is `anthropic`**. For the default `zai` path it must NOT be a requirement.
- **Resolve `ANTHROPIC_BASE_URL` against the selected provider** — default to the z.ai endpoint (`https://api.z.ai/api/anthropic`) **only when provider is `zai`**; keep the §9.2.4 safeguard (`endpoint-guard.ts`) intact.
- Update `ensureHarnessInitialized()` to use the new resolver and forward `{ apiKey }` **only** when a non-empty explicit/env override was resolved (so auth.json-only users work once S2 lands).

**Existing tests to update (don't break):** `tests/unit/config/harness.test.ts`, `harness-config.test.ts`, `harness-provider-compat.test.ts`, `environment.test.ts`, `endpoint-guard.test.ts`. These currently stub `ANTHROPIC_API_KEY`; they must pass with `ZAI_API_KEY`-only under `pi`+`zai`.

### T2.S2 — Cross-repo Groundswell: honor `auth.json`

**File:** `~/projects/groundswell/src/harnesses/pi-harness.ts` `initialize()` (lines 144–145).

**Current:**
```ts
this.authStorage = AuthStorage.inMemory();
this.modelRegistry = ModelRegistry.inMemory(this.authStorage);
```
**Required:**
```ts
this.authStorage = options?.authStorage ?? AuthStorage.create();      // FileAuthStorageBackend → ~/.pi/agent/auth.json
this.modelRegistry = options?.modelRegistry ?? ModelRegistry.create(this.authStorage);
```
- Extend `HarnessOptions` (`~/projects/groundswell/src/types/harnesses.ts`) with optional `authStorage?: AuthStorage` and `modelRegistry?: ModelRegistry` (the type doc explicitly sanctions per-harness extension — PRD §7.5).
- Keep `initialize()` idempotent (`if (this.sdk) return;`) and `terminate()` nulling the fields.
- Update/extend Groundswell's own `pi-harness` tests (under `~/projects/groundswell/tests/...`) so they seed `AuthStorage.inMemory({ zai: { type: 'api_key', key: '...' } })` rather than relying on the old in-memory default.
- **Verify link:** hacky-hack must still resolve the import (`npm run validate:groundswell` / `tests/unit/groundswell/imports.test.ts`).

### T2.S3 — Tests for the resolution order

Cover (no network): (a) explicit override wins; (b) `ZAI_API_KEY`-only succeeds under `pi`+`zai`; (c) `auth.json`-only (no env vars) succeeds under `pi`+`zai` (seed a temp-dir `~/.pi/agent/auth.json` via `PI_CODING_AGENT_DIR`/`HOME` override); (d) empty/whitespace strings treated as "not configured"; (e) `ANTHROPIC_AUTH_TOKEN` succeeds **only** when provider is `anthropic`.

---

## T3 — Fail-Fast Authentication Preflight (PRD §9.2.7)

### T3.S1 — Wire the preflight onto the startup path

**File:** `src/index.ts` `main()`. Insert the preflight **after** `configureEnvironment()` and **before** `ensureHarnessInitialized()` / `new PRPPipeline(...)`:

```ts
configureEnvironment();
await runAuthPreflight();   // NEW — abort here if no credential for selected harness+provider
await ensureHarnessInitialized();
```

**Preflight contract:**
- Resolve selected **harness + provider/model** (reuse T2.S1's resolver).
- `pi` harness: use `AuthStorage.hasAuth(provider)` / `getAuthStatus(provider)` (the SAME resolver the harness uses at runtime — see `groundswell_auth_api.md §2`). This is the accurate, drift-proof check.
- `claude-code` harness: verify an Anthropic credential (that harness is Anthropic-only).
- Treat empty/whitespace-only as "not configured."
- **On failure:** abort with exit code `1`, emit ONE actionable message naming: the selected harness + provider/model; every empty source checked (override, the provider env-var name e.g. `ZAI_API_KEY`, and the `~/.pi/agent/auth.json` path); the exact remediation (`pi /login` or `export ZAI_API_KEY=…`). **No session dir created, no agent invoked.**

### T3.S2 — Harness-specific + acceptance tests

Assert: (a) no-credential run aborts at startup with one message + exit `1` and creates **no** session dir; (b) `auth.json`-only run proceeds; (c) `ZAI_API_KEY`-only run proceeds; (d) `ANTHROPIC_AUTH_TOKEN` proceeds **only** under the `anthropic` provider; (e) `claude-code` harness requires an Anthropic credential.

---

## T4 — Changeset-Level Documentation Sync (Mode B)

Run **last**; depends on all implementing subtasks. Update:
- `README.md` — Prerequisites (line 81: "Anthropic API key …"), the env-var table + "Authentication"/"Setup" block (lines 232–279), and the "How It Works / Variable Mapping" narrative (lines 267–279). Make `pi /login` / `ZAI_API_KEY` the primary path; demote `ANTHROPIC_AUTH_TOKEN`/`ANTHROPIC_API_KEY` to optional `anthropic`-provider aliases; drop the "AUTH_TOKEN mapped to API_KEY on startup" framing as the *primary* flow.
- `docs/ARCHITECTURE.md` — top-level capability framing if it implies Anthropic-only or worker-thread logging.
- (Per-file docs — `.env.example`, `docs/CONFIGURATION.md`, `docs/INSTALLATION.md`, JSDoc — are Mode A and ride with T1.S1 / T2.S1 / T3.S1.)

---

## Dependency Graph

```
T1.S1 ─▶ T1.S2 ─▶ T1.S3
T2.S1 ──────────▶ T2.S3 ◀─ (conceptually) T2.S2 (groundswell; enables auth.json)
T2.S1 ─▶ T3.S1 ─▶ T3.S2
T1.S3, T2.S3, T3.S2 ─▶ T4.S1, T4.S2
```
- T1 (logging) and T2 (auth) are **independent** workstreams and may be parallelized.
- T3 (preflight) **reuses** T2.S1's resolver → hard dependency on T2.S1.
- T4 (docs) is the final sweep, depends on all implementing subtasks.
