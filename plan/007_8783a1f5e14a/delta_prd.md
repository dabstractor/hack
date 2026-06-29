# Delta PRD D1: Auth Hardening & Logging Teardown Fix

> **Session:** `plan/007_8783a1f5e14a/` (delta from `plan/006_ab48cc891f8b/`)
> **Scope basis:** Diff of `plan/006_…/prd_snapshot.md` vs. current `PRD.md`, cross-checked against the git history of the *implemented* repo.

## Delta Summary

The previous session (`006`) ran a throwaway **hello-world test snapshot** (`prd_snapshot.md` = 61-line "Test Project"). That snapshot was a pipeline self-test, **not** the real project state — the actual pipeline (PRD §1–9.5) is fully implemented in `src/` and committed across sessions 001–005 (every commit references a closed `P1`/`P5` task).

Since the last *real* implementation, exactly **two docs-only commits** added new requirements to `PRD.md` without implementing them:

- `b615a37` → **§9.6 Logging Architecture** (lazy loggers + synchronous destinations) — fixes a measured ~10s CLI teardown stall.
- `1175efc` → **§9.2.6 Provider-Agnostic Auth Model** + **§9.2.7 Authentication Preflight (Fail-Fast)** — fixes the most common install failure (deep, misleading "No API key found for zai" error).

All three sections were verified **unimplemented** in the current tree (see "Verification" under each task). This delta implements exactly those three workstreams. **Nothing else in the PRD requires work** — the remainder is satisfied by existing code and must not be re-implemented.

### Removed requirements (awareness only — no tasks)

- **P1 "Test Project" / hello-world** (the session-006 snapshot) is obsolete. It was a pipeline self-test artifact; the real implementation is unaffected. No action — do **not** delete the existing `src/` pipeline to "match" the old snapshot.

---

## Phase D1: Auth & Logging Hardening

**Goal:** Ship the three new PRD sections (§9.2.6, §9.2.7, §9.6) against the existing pipeline without disturbing the already-complete §1–9.5 surface.

### D1.T1: Logging Architecture — Lazy Loggers & Synchronous Destinations (PRD §9.6)

Implement REQ-L1/L2/L3 so `hack --help`, `-h`, `--version`, and invalid flags each return in **under 2 seconds** with zero pino worker threads spawned.

**Verification of current violation (do not re-derive):**
- `src/utils/logger.ts:318` configures `transport: { target: 'pino-pretty' }` → FORBIDDEN (REQ-L1).
- `rg -n "^(export )?(const|let) \w+ = getLogger\(" src/` returns **31** module-scope logger declarations (REQ-L2 violation) — e.g. `src/cli/index.ts:40`, `src/cli/commands/*.ts`, `src/utils/*.ts`, `src/core/*.ts`, `src/agents/agent-factory.ts:49`.

**Subtasks:**

- **D1.T1.S1 — Synchronous destinations (REQ-L1).** Remove the `transport:` block from `getLogger()` in `src/utils/logger.ts`. Pretty-printing (when enabled) must run in-process via `pino({ … }, pretty({ colorize: true, … }))` as a direct synchronous destination stream, mirroring the existing JSON path. No `ThreadStream`/worker-thread may be spawned by any logger config under `src/`.
- **D1.T1.S2 — Lazy logger instantiation (REQ-L2).** Migrate **all 31** top-level `const logger = getLogger(...)` declarations to lazy accessors (private field populated on first use, or a memoized module-local `function logger()`). The acceptance grep `rg -n "^(export )?(const|let) \w+ = getLogger\(" src/` must return **zero hits**. Preserve the existing context-keyed cache so no duplicate instances are created.
- **D1.T1.S3 — Single root logger per process (REQ-L3) + validation.** Derive component loggers from one shared root so the process bounds to one synchronous destination. Add/extend a test asserting: `hack --help`, `-h`, `--version`, and an invalid flag each finish <2s; no worker threads spawned.

**DOCS (Mode A — doc-with-work, ride with S1/S3):**
- Update JSDoc on `getLogger()` in `src/utils/logger.ts` to document the lazy + sync-destination contract.
- `docs/CONFIGURATION.md` and `README.md`: refresh any "logging / `--verbose`" prose if it implies worker-thread transports.

**dependencies:** none · **story_points:** 3

---

### D1.T2: Provider-Agnostic Authentication Model (PRD §9.2.6)

Replace the Anthropic-shell auth path with provider-aware resolution for the resolved provider (default `zai`). Includes a **cross-repo Groundswell change**.

**Verification of current violation (do not re-derive):**
- `src/config/harness.ts:128-129` — `const apiKey = process.env.ANTHROPIC_API_KEY; registry.initializeProvider('pi', apiKey ? { apiKey } : undefined)`. This is the wrong contract: it reads an Anthropic env var and injects it (or empty/`undefined`) into the `pi` provider. A `pi /login` user (valid `~/.pi/agent/auth.json`) is invisible.
- `~/projects/groundswell/src/harnesses/pi-harness.ts:144` — `this.authStorage = AuthStorage.inMemory()`. An in-memory store never reads `auth.json`.

**Subtasks:**

- **D1.T2.S1 — Provider-aware resolution in hacky-hack (`src/config/harness.ts`).** Resolve auth for the selected provider in order (first non-empty wins): (1) explicit override (`options.apiKey` / future `PRP_API_KEY`), (2) provider-native env var via pi's `getEnvApiKey(provider)` mapping (`ZAI_API_KEY` for `zai`, `ANTHROPIC_API_KEY`/`ANTHROPIC_OAUTH_TOKEN` for `anthropic`), (3) `~/.pi/agent/auth.json`. **Forward an override only when non-empty** — never thread `?? ''` empty strings into harness options. Demote `ANTHROPIC_AUTH_TOKEN` to a backward-compat alias (map to `ANTHROPIC_API_KEY` when unset) used **only** for the `anthropic` provider. Resolve `ANTHROPIC_BASE_URL` against the selected provider (default z.ai endpoint only when provider is `zai`); keep the §9.2.4 safeguard.
- **D1.T2.S2 — Cross-repo Groundswell: honor `auth.json`.** In `~/projects/groundswell/src/harnesses/pi-harness.ts`, replace `AuthStorage.inMemory()` with `AuthStorage.create()` (file-backed `FileAuthStorageBackend`, default `getAgentDir()/auth.json`), or accept a caller-supplied file-backed `authStorage`/`ModelRegistry`. This is a tracked cross-cutting change against the Groundswell repo; note it in the commit and verify hacky-hack still links cleanly.
- **D1.T2.S3 — Tests for the resolution order.** Cover: override-wins; `ZAI_API_KEY`-only succeeds under `pi`+`zai`; `auth.json`-only (no env vars) succeeds under `pi`+`zai`; empty/whitespace strings treated as "not configured"; `ANTHROPIC_AUTH_TOKEN` succeeds only when provider is `anthropic`.

**DOCS (Mode A — doc-with-work, ride with S1):**
- `.env.example` (lines 9–17, 24–25): rewrite the "API AUTHENTICATION" block — default path is `pi /login` or `ZAI_API_KEY`; demote `ANTHROPIC_AUTH_TOKEN` to an optional alias.
- JSDoc on the auth functions in `src/config/harness.ts`.

**dependencies:** none (independent of T1) · **story_points:** 3

---

### D1.T3: Fail-Fast Authentication Preflight (PRD §9.2.7)

Add the startup auth preflight so a misconfigured credential aborts **before** a session directory is created or an agent is invoked.

**Verification of current violation (do not re-derive):**
- `src/config/environment.ts:163` exports `validateEnvironment()` but — per PRD §9.2.7 — it "is never invoked on the pipeline's startup path" (only by `scripts/validate-api.ts`). A bad credential surfaces as a deep `decomposePRD` error after `ERROR_REPORT.md` is written.

**Subtasks:**

- **D1.T3.S1 — Wire the preflight onto the startup path.** After `configureEnvironment()` and **before** `ensureHarnessInitialized()` / any agent run, resolve the selected harness + provider/model and verify ≥1 auth source from §9.2.6 is available (reuse T2's resolver). On failure: abort with exit code `1`, **no** session dir created, **no** agent invoked, emitting an actionable error naming the selected harness/provider-model, every empty source checked (override, the provider env-var name, the `auth.json` path), and the exact remediation (`pi /login` or `export <PROVIDER>_API_KEY=…`).
- **D1.T3.S2 — Harness-specific + acceptance tests.** `pi` harness uses the §9.2.6 provider-aware check; `claude-code` harness verifies an Anthropic credential. Assert: no-credential run aborts at startup with one message + exit 1 and creates no session dir; `auth.json`-only run succeeds; `ZAI_API_KEY`-only run succeeds; `ANTHROPIC_AUTH_TOKEN` run succeeds only under the `anthropic` provider.

**DOCS (Mode A — doc-with-work, ride with S1):**
- `docs/INSTALLATION.md` / `docs/CONFIGURATION.md`: add the preflight failure mode + remediation to the setup/troubleshooting section.
- JSDoc on the preflight function.

**dependencies:** `["D1.T2.S1"]` (preflight reuses the provider-aware resolver) · **story_points:** 2

---

## Changeset-Level Documentation Sync (Mode B)

**Requirement:** Cross-cutting docs that only make sense once the whole change lands — the default auth *flow* changes from Anthropic-shell to pi-native, and the CLI teardown behavior changes. These cannot be honestly written until D1.T1–D1.T3 are in.

Update as a **final task depending on all implementing subtasks**:

- `README.md` — "Prerequisites"/"Getting Started" (line 81) and the env-var table + "Authentication" block (lines 232–279): rewrite to make `pi /login` / `ZAI_API_KEY` the primary path, demote `ANTHROPIC_AUTH_TOKEN`/`ANTHROPIC_API_KEY` to optional `anthropic`-provider aliases, and drop the "AUTH_TOKEN mapped to API_KEY on startup" narrative (lines 267–279).
- Top-level capability framing in `README.md`/`docs/ARCHITECTURE.md` if it implies Anthropic-only or worker-thread logging.

**dependencies:** `["D1.T1.S3", "D1.T2.S3", "D1.T3.S2"]` · **story_points:** 1

---

## Reference: Prior Session & Research

- **No architecture research exists** in `plan/006_ab48cc891f8b/architecture/` (that session was the hello-world self-test; only `prd_snapshot.md` + `tasks.json` are present).
- **Completed implementation to reference (do NOT rebuild):** `src/config/environment.ts` (`configureEnvironment`, `validateEnvironment`, endpoint guard), `src/config/harness.ts` (`configureHarnesses`, provider init), `src/utils/logger.ts` (`getLogger`, context cache), the full `src/core/` orchestrator/recovery stack, and all of PRD §1–9.5 as committed in sessions 001–005.
- **New requirements' own rationale** is self-contained in PRD §9.2.6 (auth root-cause analysis), §9.2.7 (preflight), and §9.6.1 (the measured 10s stall) — read those sections directly; no additional research is needed.
