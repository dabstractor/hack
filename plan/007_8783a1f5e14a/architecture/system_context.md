# System Context — Delta Session 007 (Auth & Logging Hardening)

> **Session:** `plan/007_8783a1f5e14a/` · **Delta from:** `plan/006_ab48cc891f8b/` (throwaway hello-world self-test; the REAL implementation is in `src/` across sessions 001–005).
> **Scope:** Exactly three new PRD sections, **all verified UNIMPLEMENTED** in the current tree:
> - **PRD §9.6** — Logging Architecture (lazy loggers + synchronous destinations)
> - **PRD §9.2.6** — Provider-Agnostic Authentication Model
> - **PRD §9.2.7** — Fail-Fast Authentication Preflight
>
> Everything else in PRD §1–9.5 is already implemented and committed. **Do NOT re-implement it.**

## 1. Technology & Build Reality (verified)

- **Runtime:** Node.js 20+ / TypeScript 5.2+ (ESM, `"type": "module"` in `package.json`).
- **Test runner:** Vitest (`vitest.config.ts`; tests under `tests/unit/...`).
- **Build:** `tsc -p tsconfig.build.json`; entry `dist/index.js` (shebang `#!/usr/bin/env node`).
- **Logger:** `pino` (^9.14) + `pino-pretty` (^11.3, devDep).
- **Core framework:** Groundswell, **`npm link`ed** to `~/projects/groundswell`. The Groundswell repo is a **sibling** that hacky-hack depends on; cross-repo changes (PRD §9.2.6 / §9.5) land in `~/projects/groundswell/src/...`.
- **CLI:** `commander` (^14). Entry: `src/index.ts` → `main()` → `configureEnvironment()` → `ensureHarnessInitialized()` → `PRPPipeline.run()`.
- **Auth/LLM:** z.ai provider (Anthropic-compatible) via the `pi` harness (`@earendil-works/pi-coding-agent`). Default provider `zai`, default model `zai/glm-5.2`.

## 2. The Three Violations (verified against current `src/`)

### 2.1 Logging (PRD §9.6) — REQ-L1 / L2 / L3 all violated

- **REQ-L1 (worker-thread transport):** `src/utils/logger.ts`, function `createLoggerConfig()`, the `if (!machineReadable)` branch returns `transport: { target: 'pino-pretty', options: {...} }`. This spawns one `ThreadStream` worker per logger. (Confirmed: the only `transport:` in logging is at `logger.ts` — the three `transport: this.transport` hits in `src/tools/*-mcp.ts` are MCP transport objects, unrelated.)
- **REQ-L2 (module-scope loggers):** exactly **31** top-level `const logger = getLogger(...)` declarations in `src/` (grep `^(export )?(const|let) \w+ = getLogger\(`). Full list captured in `implementation_notes.md §3`. The critical chain: `index.ts` imports `cli/index.ts`, which has `const logger = getLogger('CLI')` at **line 40** — so even `--help`/`--version` construct a logger + spawn a worker during `import`, before any arg parsing.
- **Additional eager init:** `logger.ts` also has a top-level `{ const { createRequire } = await import('module'); ... syncPino = require('pino'); }` block that eagerly loads pino at module-eval time. This does NOT spawn workers by itself, but it defeats laziness and should be deferred to first `getLogger()` call.
- **Symptom (from PRD §9.6.1):** `hack --help` / `-h` / `--version` / invalid flag each take ~10.7s wall / ~1.6s CPU; 13 pino `exit` handlers run sequentially (~10,111ms total). The stall is argument-independent (loggers are constructed at import time).

### 2.2 Auth (PRD §9.2.6) — wrong contract for `pi` users

- **`src/config/harness.ts` `ensureHarnessInitialized()`:** reads `process.env.ANTHROPIC_API_KEY` (an Anthropic-shell var) and forwards `apiKey ? { apiKey } : undefined` into `registry.initializeProvider('pi', ...)`. A `pi /login` user (valid `~/.pi/agent/auth.json`) is **invisible** to this path.
- **`src/config/harness.ts` `configureHarness()`:** sets `harnessDefaults: { 'claude-code': { apiKey: process.env.ANTHROPIC_API_KEY } }`.
- **`src/config/environment.ts` `configureEnvironment()`:** maps `ANTHROPIC_AUTH_TOKEN` → `ANTHROPIC_API_KEY` (the Anthropic-shell convention the PRD now demotes).
- **`src/config/constants.ts`:** `REQUIRED_ENV_VARS = { apiKey: 'ANTHROPIC_API_KEY', baseURL: 'ANTHROPIC_BASE_URL' }`.
- **Cross-repo (Groundswell):** `~/projects/groundswell/src/harnesses/pi-harness.ts` `initialize()` (lines 144–145) hard-codes `this.authStorage = AuthStorage.inMemory()` + `ModelRegistry.inMemory(this.authStorage)`. An in-memory store **never reads `~/.pi/agent/auth.json`**. See `groundswell_auth_api.md`.

### 2.3 Preflight (PRD §9.2.7) — never on the startup path

- **`src/config/environment.ts`** exports `validateEnvironment()` (checks `ANTHROPIC_API_KEY` + `ANTHROPIC_BASE_URL`) but it is **only** called by `src/scripts/validate-api.ts` — **not** on the `main()` startup path.
- **`src/index.ts` `main()`** order today: `parseCLIArgs()` → `configureEnvironment()` → `await ensureHarnessInitialized()` → `new PRPPipeline(...).run()`. There is **no auth check** between env config and the first agent run, so a bad credential surfaces deep inside `decomposePRD` after a session dir + `ERROR_REPORT.md` are created.

## 3. Groundswell Auth API (key facts — full detail in `groundswell_auth_api.md`)

- `AuthStorage.create(authPath?)` → **file-backed** `FileAuthStorageBackend`, default path `join(getAgentDir(), 'auth.json')` = `~/.pi/agent/auth.json`. **This is the factory the cross-repo change must use.**
- `AuthStorage.inMemory(data?)` → current behavior (no disk).
- `ModelRegistry.create(authStorage, modelsJsonPath?)` → file-backed (also reads `~/.pi/agent/models.json`); `ModelRegistry.inMemory(authStorage)` → built-ins only. **Both REQUIRE a caller-supplied `AuthStorage`.**
- **Env-var mapping** (`@earendil-works/pi-ai` `getEnvApiKey`): `zai` → `ZAI_API_KEY`; `anthropic` → `ANTHROPIC_OAUTH_TOKEN` then `ANTHROPIC_API_KEY`.
- **`getAgentDir()`** → `~/.pi/agent` (overridable via `PI_CODING_AGENT_DIR` env).
- **`AuthStorage.hasAuth(provider)`** → checks runtime override **+ auth.json + env + fallback** (the exact resolver the harness uses at runtime). **`getAuthStatus(provider)`** → `{ configured: boolean, source?: 'stored'|'runtime'|'environment'|'fallback'|... }`. **These are the precise preflight primitives** — the preflight should reuse the SAME resolver the harness will use, not a hand-rolled `process.env` check.
- `AuthStorage.getApiKey()` internal priority: runtime override → auth.json api_key → auth.json oauth → `getEnvApiKey(provider)` → fallback.
- `HarnessOptions` (Groundswell `src/types/harnesses.ts`) is **explicitly designed to be extended** per-harness (PRD §7.5) — adding `authStorage?: AuthStorage` / `modelRegistry?: ModelRegistry` there is the type-safe seam for the cross-repo change.

## 4. Doc Surfaces Touched (Mode A vs Mode B — per PRD §6.1)

- **Mode A (ride with the implementing subtask):**
  - `src/utils/logger.ts` JSDoc on `getLogger()` (with T1.S1).
  - `src/config/harness.ts` JSDoc on the new auth functions (with T2.S1).
  - `.env.example` lines 9–17 / 24–25 — rewrite "API AUTHENTICATION" (with T2.S1).
  - `docs/CONFIGURATION.md` — refresh logging (`--verbose`) + auth prose (with T1.S1 / T2.S1).
  - `docs/INSTALLATION.md` — add preflight failure mode + remediation (with T3.S1).
- **Mode B (final changeset-level task):**
  - `README.md` — Prerequisites (line 81), env-var table + Authentication block (lines 232–279), and the "How It Works / Variable Mapping" narrative (lines 267–279).
  - `docs/ARCHITECTURE.md` — top-level framing if it implies Anthropic-only or worker-thread logging.

## 5. Constraints / Guardrails (from PRD + repo conventions)

- **Forbidden (Task Breakdown agent):** modifying `PRD.md`, `.gitignore`, source code, or any `tasks.json` outside `plan/007_8783a1f5e14a/`. (This plan only writes `tasks.json` + `architecture/`.)
- **Do NOT run the project** (no `npm test` / build) during planning — it is mid-implementation; static reads only.
- **TDD implicit:** every subtask implies write-failing-test → implement → pass.
- **Cross-repo discipline:** T2.S2 edits `~/projects/groundswell/src/harnesses/pi-harness.ts` AND its tests; hacky-hack must still link cleanly afterward (verify via `npm run validate:groundswell` / import-resolution test).
- **No Anthropic hard-gate:** the default `pi`+`zai` path must succeed with **only** `ZAI_API_KEY` **or** `~/.pi/agent/auth.json`. `ANTHROPIC_AUTH_TOKEN`/`ANTHROPIC_API_KEY` are valid **only** for the `anthropic` provider.
- **Empty-string policy:** never forward `?? ''` empty strings as auth (PRD §9.2.7). Whitespace-only == "not configured".
