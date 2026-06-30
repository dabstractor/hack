# PRD Constraint Extraction — Bugfix 002 Architecture

Source of truth: `/home/dustin/projects/hacky-hack/PRD.md` (628 lines). All quotes are verbatim unless marked `[paraphrase]`. Line numbers are 1-indexed against that file.

---

## 1. §9.2.7 Authentication Preflight (Fail-Fast) — PRD lines 400–422

### Heading (line 400)
`#### 9.2.7 Authentication Preflight (Fail-Fast)`

### Problem (line 402) — verbatim
> **Problem.** `validateEnvironment()` exists but is never invoked on the pipeline's startup path — only by `scripts/validate-api.ts`. A misconfigured credential (the single most common install failure) is therefore not detected until the first agent actually calls the model, where it surfaces as a deep, misleading error (`Pi agent execution failed: No API key found for zai.`) inside `decomposePRD`, after a session directory has already been created and an `ERROR_REPORT.md` written.

### Requirement (line 404) — verbatim  ← **THE critical "where" wording**
> **Requirement.** The pipeline MUST run an auth preflight on the startup path, after `configureEnvironment()` and before `ensureHarnessInitialized()` / any agent run. The preflight resolves the selected **harness + provider/model** and verifies that at least one auth source from §9.2.6 is available for that provider.

**Where it runs (exact phrases):**
- "on the startup path"
- "after `configureEnvironment()`"
- "before `ensureHarnessInitialized()` / any agent run"

### Failure behavior (lines 406–410) — verbatim
> **Failure behavior.** On failure, the pipeline MUST abort **before** creating a session or invoking an agent, and emit an actionable error naming:
>
> - the selected harness and provider/model,
> - every auth source that was checked and found empty (override, the provider env var name, and the `~/.pi/agent/auth.json` path),
> - the exact remediation (`pi /login`, or `export <PROVIDER>_API_KEY=…`).

### Empty-string policy (line 412) — verbatim
> **Empty-string policy.** The preflight MUST treat empty / whitespace-only credentials as "not configured." Empty strings must never be forwarded into harness options as auth (eliminating the `?? ''` shadowing).

### Harness-specific check (line 414) — verbatim
> **Harness-specific check.** For the `claude-code` harness, the preflight verifies an Anthropic credential (that harness is Anthropic-only). For the `pi` harness, the preflight uses the provider-aware resolution in §9.2.6.

### Acceptance criteria (lines 416–422) — verbatim
> **Acceptance criteria.**
>
> - A run with **no** credential configured for the selected provider aborts at startup with a single actionable message and exit code `1` — **no** session directory is created, **no** agent is invoked.
> - A run authenticated via `~/.pi/agent/auth.json` alone (no env vars) succeeds under the `pi` + `zai` default.
> - A run authenticated via `ZAI_API_KEY` alone succeeds under the `pi` + `zai` default.
> - A run authenticated via `ANTHROPIC_AUTH_TOKEN` succeeds **only** when the provider is `anthropic` (or via the backward-compat alias); it is **not** required by the default path.

### Roadmap restatement (PRD line 549, §9.5 item 1) — verbatim
> - Implement the **fail-fast auth preflight** (§9.2.7): abort before any agent run with an actionable error when no credential is resolvable for the selected harness + provider/model.

**Key testable assertions for §9.2.7:**
1. Preflight executes between `configureEnvironment()` and `ensureHarnessInitialized()`.
2. No-credential → exit code 1, single actionable message, **zero** session dir created, **zero** agent invoked.
3. Empty/whitespace credential treated as absent; never forwarded as `apiKey`.
4. `pi`+`zai` succeeds via `~/.pi/agent/auth.json` alone OR `ZAI_API_KEY` alone.
5. `claude-code` harness requires Anthropic credential specifically.
6. Error message names: harness, provider/model, each checked-but-empty source, exact remediation command.

---

## 2. §9.4.3 Critical Rules — PRD lines 524–529

### Heading (line 524)
`#### 9.4.3 Critical Rules`

### Verbatim body (lines 525–529)
> - **The harness never appears in the model string.** `pi/zai/glm-5.2` and `cc/anthropic/...` are **invalid**. Always use `provider/model` (e.g. `zai/glm-5.2`).
> - **Provider/harness compatibility.** `claude-code` runs `anthropic/*` models only. Requesting the z.ai provider on `claude-code` is a configuration error surfaced at `initialize()`/`execute()`.
> - **Feature parity.** All features (MCP tools, skills, hooks, `AgentResponse`, caching, workflow events) MUST work identically across both harnesses. Tool execution flows through `MCPHandler` for both, so `pi`'s lack of built-in MCP/LSP is **not** a capability gap.
> - **Cache isolation.** Cache keys incorporate **both** the harness and the provider/model.

### claude-code = Anthropic-only (supporting context)
- §9.4.1 table (line 500): `claude-code` row Notes — "Anthropic-only models. Incompatible with the z.ai provider (see §9.2.4). Retained as a parity-maintained fallback for users locked into Anthropic's ecosystem."
- §9.4.1 "Default selection" (line 502): "`PRP_AGENT_HARNESS` defaults to `pi` (pi.dev). This is the only harness compatible with the project's default z.ai provider and the §9.2.4 cost safeguard."
- §9.2.4 "Harness note" (line 354): "The optional `claude-code` harness is **Anthropic-only** and therefore incompatible with the z.ai provider — selecting it requires switching to `anthropic/*` models and disabling this safeguard (see §9.4)."

**Key testable assertions for §9.4.3:**
1. Model strings are `provider/model` only; harness name never in the string (`pi/zai/glm-5.2`, `cc/anthropic/...` are invalid).
2. `claude-code` + z.ai provider = configuration error, surfaced at `initialize()`/`execute()`.
3. Cache keys must include BOTH harness and provider/model.

---

## 3. §9.2.4 API Endpoint Safeguards — PRD lines 345–355

### Heading (line 345)
`#### 9.2.4 API Endpoint Safeguards`

### Verbatim body (lines 347–355)
> **CRITICAL**: All tests and validation scripts enforce the z.ai **provider** endpoint:
>
> - Tests will fail immediately if `ANTHROPIC_BASE_URL` is set to Anthropic's official API (`https://api.anthropic.com`)
> - Validation scripts block execution to prevent accidental API usage
> - Warnings are issued for non-z.ai endpoints (excluding localhost/mock/test endpoints)
>
> This prevents the massive usage spikes that occurred when tests were accidentally configured to use Anthropic's production API.
>
> > **Harness note.** This safeguard constrains the LLM **provider** (z.ai), not the **harness**. Because the default `pi` harness can run any provider, the pipeline defaults to `pi` + `zai` so the safeguard stays effective. The optional `claude-code` harness is **Anthropic-only** and therefore incompatible with the z.ai provider — selecting it requires switching to `anthropic/*` models and disabling this safeguard (see §9.4).

**Key testable assertions for §9.2.4:**
1. `ANTHROPIC_BASE_URL == https://api.anthropic.com` → tests fail immediately.
2. Validation scripts block execution to prevent accidental Anthropic API usage.
3. Non-z.ai endpoints (excluding localhost/mock/test) → warnings.
4. Safeguard constrains the **provider**, not the harness.

**Cross-reference for provider/model constraints — §9.2.3 Model Selection (lines 336–343):**
> Models are specified as provider-qualified strings (`provider/model`), independent of the harness (see §9.4). The pipeline reads model names from the environment at runtime and qualifies them with the `zai` provider.
> - **`ANTHROPIC_DEFAULT_SONNET_MODEL`**: Model for complex reasoning tasks (default: `glm-5.2` → resolved as `zai/glm-5.2`)
> - **`ANTHROPIC_DEFAULT_HAIKU_MODEL`**: Model for faster/lighter tasks (default: `glm-5-turbo` → resolved as `zai/glm-5-turbo`)
>
> These values should be read from the environment at runtime, not hardcoded. Model strings are never harness-qualified (e.g., `pi/zai/glm-5.2` is invalid). Model ids are **lowercase** as registered in the Pi model registry (run `pi --list-models zai` to verify available ids).

---

## 4. §9.6.3 Logging Acceptance Criteria — PRD lines 623–628

### Heading (line 623)
`#### 9.6.3 Acceptance Criteria`

### Verbatim body (lines 625–628)
> - `hack --help`, `hack -h`, `hack --version`, and an invalid flag each return in **under 2 seconds** (target <1s excluding cold Node/module load), with no `ThreadStream` worker threads spawned during the invocation.
> - No `getLogger(...)` call exists at module top-level scope in `src/`. (Verification: `rg -n "^(export )?(const|let) \w+ = getLogger\(" src/` must return zero hits.)
> - No `transport:` key appears in any logger configuration under `src/`; pretty-printing is delivered via a synchronous stream destination.
> - A syscall-level trace of `hack --help` shows no multi-second blocking `epoll_pwait`/`futex` attributable to process exit.

### Surrounding startup fast-path framing

**§9.6 intro (line 568) — verbatim:**
> Cross-cutting requirement for the structured-logging subsystem (the §7.3 "Observability" improvement). The pipeline is a **CLI that calls `process.exit()` on every code path** — `--help`, `--version`, PRD validation, and full pipeline runs alike — so logging must be designed for fast process teardown, not for long-running services.

**§9.6.2 REQ-L2 (line 613) — verbatim, the `--help/--version/validation/dry-run` short-circuit list:**
> Loggers must not be constructed at module top-level scope. A top-level `const logger = getLogger('Foo')` forces the logger to be built during `import` — before the CLI has parsed arguments or decided whether to run — which defeats every short-circuit code path (`--help`, validation, dry-run). Loggers must be obtained lazily:

**§9.6.2 REQ-L2 lazy-accessor requirement (lines 615–617) — verbatim:**
> - Hold the logger behind a lazy accessor (e.g. a private field populated on first use, or a memoized module-local `function logger()`), so it is constructed only by code paths that actually log.
> - All existing top-level `const logger = getLogger(...)` declarations in `src/` must be migrated to lazy instantiation when this section is implemented.

**§9.6.1 measured baseline (lines 582–585) — verbatim:**
> - Every invocation — `--help`, `-h`, `--version`, `-V`, unknown flags (exit 1), `inspect --help` — took ~10.7s wall time but only ~1.6s CPU.
> - Commander printed help and called `process.exit(0)` at ~+535ms, yet the process did not terminate for ~10s more (the event loop was frozen).
> - Exactly 13 pino `exit` handlers ran **sequentially**, totaling **10,111ms** — the entire stall.
> - Stubbing `ThreadStream` shutdown reduced `--help` from 10.71s to 1.94s, confirming the cost is teardown-bound, not work-bound.

**§9.6.2 REQ-L1 (lines 591–609) — verbatim core:**
> **REQ-L1 — Synchronous destinations only (no worker-thread transports).**
> The CLI must never configure a pino `transport:` (which spawns a worker thread). Pretty-printing, when enabled, must run in-process via a synchronous destination stream...
> Transports exist to keep logging off the hot path of long-running **services**; in a CLI that exits via `process.exit()`, each transport adds one worker-thread spawn and one blocking exit handler. The machine-readable (JSON) path already uses a sync destination; the human-readable path must match it.

**§9.6.2 REQ-L3 (lines 619–621) — verbatim:**
> **REQ-L3 — Single root logger per process.**
> Components running in the same process should derive their loggers from a single shared root rather than each constructing an independent logger, bounding the total number of destinations to **one per process** (one synchronous stream, zero worker threads).

**Key testable assertions for §9.6.3:**
1. `hack --help`, `-h`, `--version`, invalid flag → return < 2s (target <1s excl. cold load); zero `ThreadStream` workers spawned.
2. `rg -n "^(export )?(const|let) \w+ = getLogger\(" src/` → **zero hits**.
3. No `transport:` key in any logger config under `src/`.
4. Syscall trace of `hack --help` shows no multi-second blocking `epoll_pwait`/`futex` at exit.

---

## 5. §9.4.2 Configuration (harness configuration cascade) — PRD lines 504–522

### Heading (line 504)
`#### 9.4.2 Configuration`

### Verbatim body (lines 506–522)
```ts
import { configureHarnesses } from 'groundswell';

configureHarnesses({
  defaultHarness: 'pi', // vendor-neutral, first-class default (pi.dev)
  defaultModelProvider: 'zai', // LLM host — independent of harness
  harnessDefaults: {
    // 'pi': auth resolved provider-natively (override / env var / ~/.pi/agent/auth.json);
    //       see §9.2.6. Do NOT inject an empty apiKey — forward an override only when non-empty.
    'claude-code': { apiKey: process.env.ANTHROPIC_API_KEY }, // Anthropic-only harness
  },
});
```
> - **`PRP_AGENT_HARNESS`** (`pi` | `claude-code`, default `pi`): selects the runtime.
> - Harness selection cascades: global default → agent config → prompt overrides.
> - Harness-specific options (e.g. `skillsDirs` on `pi`) MAY extend the base `HarnessOptions`.

### Cascade ordering (line 520) — the explicit cascade statement
> - Harness selection cascades: global default → agent config → prompt overrides.

**Key testable assertions for §9.4.2:**
1. `configureHarnesses` called with `defaultHarness: 'pi'`, `defaultModelProvider: 'zai'` (also mandated in §9.5 item 1, line 551).
2. Cascade precedence: **global default → agent config → prompt overrides** (later wins).
3. `pi` harness must NOT receive an empty `apiKey`; forward override only when non-empty.
4. `claude-code` harness gets `apiKey: process.env.ANTHROPIC_API_KEY`.

---

## 6. §4.x CLI surface / `--validate-prd` / `--dry-run` flags — **NOT PRESENT IN PRD**

**Finding (negative):** The PRD contains **no** CLI flag named `--validate-prd` or `--dry-run`, and **no** §4.x "CLI surface" section enumerating flags.

- Verified by full-text search: `grep -niE "validate-prd|dry.?run|--validate|--dry|\.option\(|addOption|parseArgs"` returns matches **only** in §9.6 (logging), where "validation" and "dry-run" appear as examples of *short-circuit code paths* that must not pay logger-teardown cost — not as defined CLI flags.
- §4 "User Workflows" describes operational flows (Init & Breakdown, Execution Loop, Delta, QA, Issue Re-planning) and a `prd task` subcommand (§5.3), but does **not** define a flag table.
- The only concrete CLI subcommand the PRD names is `prd task` (§5.3) and `prd` (the entry point).

**The only PRD-stated fast-path / short-circuit modes** (from §9.6 intro line 568 and REQ-L2 line 613) are listed as examples:
- `--help` / `-h`
- `--version` / `-V`
- PRD validation (referred to generically as "validation")
- "dry-run" (referred to generically)
- unknown flags (exit 1)
- `inspect --help`

These are cited as paths that call `process.exit()` and therefore must not spawn worker threads — but **none are given a formal flag specification or semantics section.**

**Implication / open question:** If `--validate-prd` and `--dry-run` are expected by downstream agents, that expectation is **not grounded in the PRD**. The PRD treats them only as illustrative short-circuit examples. Any implementation of such flags would be inventing requirements beyond the PRD and should be raised to the parent/supervisor before coding.

---

## 7. "API call vs purely local" CLI modes — **NO EXPLICIT ENUMERATION IN PRD**

**Finding:** The PRD does **not** contain an explicit statement listing "these CLI modes make API calls, these are purely local."

What CAN be inferred from the PRD (inference, not verbatim requirement):
- §9.6 intro (line 568) lists `--help`, `--version`, "PRD validation", "dry-run", and "full pipeline runs" as separate code paths that all call `process.exit()` — implying the first four are short-circuits distinct from "full pipeline runs."
- §9.2.7 (line 404) gates the auth preflight specifically on "before ... any agent run" — and the failure criteria (line 418) is "no agent is invoked" for the no-credential case. This implies the short-circuit paths (`--help`, `--version`, validation, dry-run) do **not** reach the agent layer and therefore make **no API calls**; only the full pipeline / agent-run path triggers API calls.
- §9.2.7 acceptance (line 418) further implies that a successful preflight is a prerequisite to *any* API call: the no-credential abort happens "at startup... no agent is invoked."

**Therefore (inference, to be confirmed by implementer against actual CLI code):**
- **Purely local / no API calls:** `--help`, `-h`, `--version`, `-V`, unknown-flag error exit, PRD validation, dry-run.
- **Make API calls:** the full pipeline run path (Architect/Researcher/Coder/QA agent invocations), reached only after the §9.2.7 preflight passes.

This is **not** stated as an explicit requirement in the PRD; it is a logical consequence of the preflight gating and the short-circuit list. Flag as an open question if the implementer needs it nailed down.

---

## 8. §9.2.6 Authentication Model (cross-cutting, heavily referenced by §9.2.7) — PRD lines 378–398

Included because §9.2.7's preflight "verifies that at least one auth source from §9.2.6 is available." This is the auth resolution order the preflight must validate.

### Resolved auth resolution order (line 386) — verbatim
> The pipeline authenticates the **provider of the resolved model** (default `zai`), not Anthropic. Auth for a given provider is resolved in this order; the first available source wins:
>
> 1. **Explicit override** — a non-empty pipeline-level credential passed via the harness `options.apiKey` (e.g. a future `--api-key` flag or `PRP_API_KEY` env var). Highest precedence; forwarded only when non-empty.
> 2. **Provider-native env var** — the env var pi assigns to that provider (`ZAI_API_KEY` for `zai`, `ANTHROPIC_API_KEY` / `ANTHROPIC_OAUTH_TOKEN` for `anthropic`, etc.), resolved via pi's `getEnvApiKey(provider)` mapping.
> 3. **`pi` auth.json** — `~/.pi/agent/auth.json`, written by `pi /login` / `pi /auth`. **This must be honored** ...; it is the canonical auth flow for interactive `pi` users.

### `ANTHROPIC_AUTH_TOKEN` demotion (line 394) — verbatim
> `ANTHROPIC_AUTH_TOKEN` is no longer required and is not the documented primary path. It MAY be accepted as a backward-compat alias (mapped to `ANTHROPIC_API_KEY` when the latter is unset) ... It must never be the only accepted credential, and the default (`pi` + `zai`) path must not depend on it.

### Groundswell contract change (line 396) — verbatim (truncated in grep; full from read)
> **Groundswell contract change (auth.json support).** Because hacky-hack is the `pi` harness's primary consumer, the harness MUST consult pi's on-disk auth store rather than an in-memory one. Concretely, `pi` harness initialization must replace `AuthStorage.inMemory()` with `AuthStorage.create()` (file-backed `FileAuthStorageBackend`, default path `getAgentDir()/auth.json`) — or accept a caller-supplied, file-backed `authStorage` / `ModelRegistry`. hacky-hack must NOT inject an empty `apiKey` into the harness options; it forwards an override only when a non-empty credential is explicitly resolved (§9.2.7). Track as a cross-cutting change against `~/projects/groundswell` `src/harnesses/pi-harness.ts`.

### Provider-aware base URL (line 398) — verbatim
> **Provider-aware base URL.** The endpoint (`ANTHROPIC_BASE_URL` today) is a property of the **provider**, not a global Anthropic setting. It must be resolved against the selected provider and default to the z.ai endpoint only when the provider is `zai`. The §9.2.4 safeguard remains in force for the `zai` provider.

---

## Summary table for implementers

| Requirement | Where preflight/short-circuit runs | Key assertion |
|---|---|---|
| §9.2.7 Auth Preflight | startup path, **after `configureEnvironment()` and before `ensureHarnessInitialized()` / any agent run**; on failure abort **before** session dir creation and agent invocation | no-cred → exit 1, single actionable msg, 0 session dir, 0 agent invoked |
| §9.4.3 harness↔provider | surfaced at `initialize()`/`execute()` | `claude-code` + zai provider = config error; model string = `provider/model` only |
| §9.2.4 endpoint safeguard | tests + validation scripts | `ANTHROPIC_BASE_URL == api.anthropic.com` → immediate test failure |
| §9.6.3 logging teardown | every `process.exit()` path, esp. `--help`/`--version`/invalid flag | < 2s return; 0 `ThreadStream` workers; 0 top-level `getLogger()`; 0 `transport:` keys |
| §9.4.2 config cascade | `configureHarnesses()` at startup | cascade: global default → agent config → prompt overrides |
| §4.x CLI flags (`--validate-prd`/`--dry-run`) | **NOT DEFINED in PRD** | only appear as illustrative short-circuit examples in §9.6 |
| API-call vs local modes | **NO explicit enumeration in PRD** | inferred: help/version/validate/dry-run = local; full pipeline run = API (post-preflight) |

## Open questions / risks for parent
1. `--validate-prd` and `--dry-run` are **not** specified anywhere in the PRD as flags with semantics. If downstream agents are expected to implement them, that is scope beyond the PRD — needs a decision.
2. The "API call vs purely local" mode list is an **inference**, not a PRD requirement. Confirm against actual `src/cli` code before treating it as a contract.
3. The preflight's exact placement ("after `configureEnvironment()` and before `ensureHarnessInitialized()`") references two internal functions — implementer must confirm these symbols exist in the current codebase or map to the equivalent lifecycle hooks.
