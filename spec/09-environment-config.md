### 9.2 Environment Configuration

The system uses a layered environment configuration strategy with proper fallback handling.

#### 9.2.1 Configuration Source Priority

Configuration is resolved through a strictly ordered layering: **each layer overrides the one below it, and for any given key the highest-precedence layer that provides a value wins.** Layers, from lowest to highest precedence:

1. **Built-in defaults** — the `DEFAULT_*` constants in `config/constants.ts` (e.g. `DEFAULT_BASE_URL`, `DEFAULT_HARNESS`, the model-tier defaults).
2. **Global user config** — `~/.hack` (or `$XDG_CONFIG_HOME/hack/config`), so a developer can set personal defaults (harness, model tiers, commit format) once across every project (§9.7).
3. **Project config** — `<repoRoot>/.hack`, the version-controlled, team-wide project defaults (§9.7).
4. **Project local config** — `<repoRoot>/.hack.local`, a gitignored per-developer override file (the only file layer permitted to hold secrets; §9.7).
5. **`.env` file** — `<repoRoot>/.env`, the credentials/secrets channel (today loaded externally via direnv/`.envrc` in the shell and via the `n` package in tests; see §9.7 for app-level loading).
6. **Shell environment** — inherited/exported `process.env` (CI overrides, ad-hoc `FOO=bar hack`).
7. **Explicit CLI flags** — `--prd`, `--mode`, `--parallel-research`, `--log-level`, etc. Highest precedence.

**Env-over-file rule.** Real environment variables (layers 5–6) take precedence over file configuration (layers 2–4). This is the standard convention so CI and temporary `VAR=val hack` overrides work without editing files; to make a `.hack` value take effect, unset the conflicting env var (or remove the conflicting direnv/`.envrc` export). This rule is what makes `.hack` safe to commit: a teammate's personal shell config can never be silently overridden by the project file, and a CI run can always force a value.

**Repo-root awareness.** Layers 3–5 are read from the **repository root**, which is located by an upward `.git` traversal from the invocation directory (§9.8) — so the same `.hack`, `.env`, `PRD.md`, and `plan/` are found regardless of which subdirectory `hack` is launched from. Layer 2 (`~/.hack`) is independent of the repo. The load sequence at startup is therefore: resolve the repo root via upward traversal (§9.8) → `process.chdir(repoRoot)` → load global `~/.hack` → project `.hack` → `.hack.local` → `.env` → already-present shell env (untouched, it simply sits above the files) → CLI flags re-applied as the top layer. (`--help`/`--version`/usage errors short-circuit during `parseCLIArgs()` before any of this runs, so they work with no repo and no config files.)

**Scope.** This section governs _where configuration values come from and in what order_. The `.hack` file format, schema, validation, and tooling are specified fully in §9.7; the repo-root traversal that locates the project layers (and the hard requirement that one exists) is specified in §9.8.

#### 9.2.2 Required Environment Variables

- **API Connection** — **provider-native, not a single hard-coded env var.** See §9.2.6 for the complete auth model. Summary:
  - Default path (`pi` + `zai`): authenticate via `pi /login` (writes `~/.pi/agent/auth.json`) **or** `export ZAI_API_KEY=…`. **No Anthropic env var is required.**
  - `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_API_KEY`: accepted **only** for the `anthropic` provider (and as a backward-compat alias: when `ANTHROPIC_AUTH_TOKEN` is set and `ANTHROPIC_API_KEY` is unset, the former is mapped to the latter). They must **never** be a hard requirement of the default path.
  - `ANTHROPIC_BASE_URL`: provider endpoint, resolved against the selected provider; defaults to `https://api.z.ai/api/anthropic` **only** when the provider is `zai` (see §9.2.4 safeguard).

- **Agent Runtime (Harness)**:
  - `PRP_AGENT_HARNESS`: Agent runtime/SDK to use — `pi` (pi.dev, default) or `claude-code`. Orthogonal to the LLM provider; see §9.4.

- **Pipeline Control**:
  - `PRP_PIPELINE_RUNNING`: Guard to prevent nested execution (set to PID when pipeline starts)
  - `SKIP_BUG_FINDING`: Skip bug hunt stage; also identifies bug fix mode when `true`
  - `SKIP_EXECUTION_LOOP`: Internal flag to skip task execution while allowing validation/bug hunt
  - `PARALLEL_RESEARCH`: Enable background (parallel) PRP research (`true`/`false`, default `false`; CLI `-r`/`--parallel-research`). MUST be forwarded — along with `RESEARCH_DEPTH` — into the bugfix sub-pipeline (§4.2, §4.4), where all real item execution occurs.

- **Commit Configuration**:
  - `PRP_COMMIT_FORMAT`: Commit-message **position layer** emitted by Smart Commit / `stagecoach` (§5.1). `task-prefix` (default) renders the implementing item's hierarchical position as `<phase>.<milestone>.<task>.<subtask>: <message>` with trailing unused levels elided and _no_ `[PRP Auto]` banner; `plain` emits just the descriptive message with no position prefix, for projects that want a clean, hand-curated history. Non-backlog commits (fallback, scaffolding, `initial commit`) always carry no prefix regardless of this setting; the format applies only to newly generated messages.
  - `PRP_COMMIT_STYLE`: Commit-message **style layer** — the contract for the descriptive message `stagecoach` generates (§5.1 "Commit Message Style"). Orthogonal to `PRP_COMMIT_FORMAT` (position vs. wording). `auto` (default) learns the project's style by sending the last `PRP_COMMIT_STYLE_EXAMPLES` commit messages as style examples with an anti-reuse instruction (match style, not wording; ignore any leading numeric position prefix); degrades to `plain` when the repo has ≤1 commit. Explicit modes replace the examples with a fixed contract: `plain` (imperative descriptive summary, no type prefix), `conventional` (`type(scope): description`), or `gitmoji` (one leading emoji + description). Applies only to generated descriptive messages; never to the fallback placeholder or non-generated commits. Existing history is never rewritten.
  - `PRP_COMMIT_STYLE_EXAMPLES`: How many recent commit messages `auto` style learning sends as examples in the generation request (§5.1). Integer ≥ 0; default **5**. `0` disables style learning (degrades to `plain`) even when `PRP_COMMIT_STYLE=auto`.

- **Resilience Tuning**:
  - `RESEARCH_TIMEOUT`: Deadline in seconds for background (parallel) research before falling back to synchronous re-research (default 1800 / 30 min; see §4.2). A grace period precedes the heartbeat so legitimately long research is not flagged as stuck.
  - `RESEARCH_DEPTH`: How many items ahead the background research supervisor prefetches as a chain (default 2; see §4.2).
  - `ISSUE_RETRY_MAX`: Maximum number of issue-driven re-planning attempts per item before it hard-fails (default 3; see §4.5).

- **Bug Hunt Configuration**:
  - `BUG_FINDER_AGENT`: Agent used for bug discovery (default: `pizr`, reasoning-tier; see §9.2.3)
  - `BUG_RESULTS_FILE`: Bug report output file (default: `TEST_RESULTS.md`)
  - `BUGFIX_SCOPE`: Granularity for bug fix tasks (default: `subtask`)

- **Validation Control**:
  - `VALIDATION_AGENT`: Agent that generates and runs `validate.sh` (default: `pizr`, reasoning-tier; see §9.2.3). Overrides the generic `$AGENT` for the validation call only.
  - `VALIDATION_TIMEOUT`: Watchdog budget in seconds for the validation call (default: 7200 / 2h — validation legitimately runs full test suites). Overrides the generic agent timeout for the validation call only.

#### 9.2.3 Model Selection

Models are specified as provider-qualified strings (`provider/model`), independent of the harness (see §9.4). The pipeline reads model names from the environment at runtime and qualifies them with the `zai` provider.

The pipeline uses **separate model roles** so cost, speed, and reasoning depth can be tuned per phase. Heavy reasoning and fast codegen are independently configurable, and the reasoning-intensive steps pin the maximum thinking budget:

- **Research role (`AGENT`)** — architecture research and PRP creation. Balanced model, normal reasoning budget. Backed by `ANTHROPIC_DEFAULT_SONNET_MODEL` (default: `glm-5.2` → resolved as `zai/glm-5.2`).
- **Reasoning role (`BREAKDOWN_AGENT` / `BUG_FINDER_AGENT` / `VALIDATION_AGENT`)** — task decomposition, creative bug discovery, and validation. These run on the balanced model but at the **maximum reasoning budget** (extended-thinking `xhigh`), because synthesizing research into a strict Phase→Milestone→Task→Subtask hierarchy, adversarial bug-finding, and validating against the full PRD are the most reasoning-intensive steps. (In the bash pipeline these are the `pizr` agent — `pi` with `--thinking xhigh`.)
- **Implementation role (`IMPL_AGENT`)** — code-writing steps: PRP execution and post-validation fix. Faster codegen. Backed by `ANTHROPIC_DEFAULT_HAIKU_MODEL` (default: `glm-5-turbo` → resolved as `zai/glm-5-turbo`; bash identifier `piznt`).

These values should be read from the environment at runtime, not hardcoded. Model strings are never harness-qualified (e.g., `pi/zai/glm-5.2` is invalid). Model ids are **lowercase** as registered in the Pi model registry (run `pi --list-models zai` to verify available ids).

#### 9.2.4 API Endpoint Safeguards

**CRITICAL**: All tests and validation scripts enforce the z.ai **provider** endpoint:

- Tests will fail immediately if `ANTHROPIC_BASE_URL` is set to Anthropic's official API (`https://api.anthropic.com`)
- Validation scripts block execution to prevent accidental API usage
- Warnings are issued for non-z.ai endpoints (excluding localhost/mock/test endpoints)

This prevents the massive usage spikes that occurred when tests were accidentally configured to use Anthropic's production API.

> **Harness note.** This safeguard constrains the LLM **provider** (z.ai), not the **harness**. Because the default `pi` harness can run any provider, the pipeline defaults to `pi` + `zai` so the safeguard stays effective. The optional `claude-code` harness is **Anthropic-only** and therefore incompatible with the z.ai provider — selecting it requires switching to `anthropic/*` models and disabling this safeguard (see §9.4).

#### 9.2.5 Nested Execution Guard

**Problem:** Agents could accidentally invoke `run-prd.sh` during implementation, causing recursive execution and corrupted pipeline state.

**Solution:** The pipeline sets `PRP_PIPELINE_RUNNING` environment variable at script entry and validates it before proceeding.

**Guard Logic:**

1. On pipeline start, check if `PRP_PIPELINE_RUNNING` is already set
2. If set, only allow execution if BOTH conditions are true:
   - `SKIP_BUG_FINDING=true` (legitimate bug fix recursion)
   - `PLAN_DIR` contains "bugfix" (validates bugfix context)
3. If validation fails, exit with clear error message
4. On valid entry, set `PRP_PIPELINE_RUNNING` to current PID

**Session Creation Guards:**

- In bug fix mode, prevent creating sessions in main `plan/` directory
- Bug fix session paths must contain "bugfix" in the path
- Provides debug logging showing `PLAN_DIR`, `SESSION_DIR`, and `SKIP_BUG_FINDING` values

#### 9.2.6 Authentication Model (Provider-Agnostic)

**Strategic framing.** Anthropic's ecosystem became a walled garden after the original spec was written, so Anthropic is downgraded to a second-class citizen. The default use case is now the vendor-neutral `pi` harness, whose natural auth flows are pi-native (`pi /login` → `auth.json`, or the provider's own env var). Auth must therefore be **provider-aware**: it authenticates the provider of the resolved model (default `zai`), and it must not gate the pipeline on Anthropic-shell conventions.

**Problem (root cause of the auth bypass).** The original design assumed Anthropic shell conventions as the primary auth path: `ANTHROPIC_AUTH_TOKEN` was the single required credential, mapped to `ANTHROPIC_API_KEY`, captured into each agent config, and forwarded into the harness. Under the `pi`-default model this is wrong on three counts:

1. **Wrong contract for `pi` users.** `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_API_KEY` are Anthropic-shell conventions. A `pi` user authenticates through pi's native sources — `pi /login` writing `~/.pi/agent/auth.json`, or the provider's own env var (`ZAI_API_KEY`, etc.). Requiring an Anthropic env var is an unnatural hard gate, and `pi`'s native env lookup for `zai` consults `ZAI_API_KEY`, **not** the Anthropic names.
2. **`auth.json` is silently ignored.** Groundswell's `PiHarness.initialize()` constructs `AuthStorage.inMemory()` + `ModelRegistry.inMemory(...)`. An in-memory auth store reads **only** runtime overrides and env vars — it never reads the `~/.pi/agent/auth.json` file. Consequently a user who runs `pi /login` (the canonical `pi` auth flow) has a valid `zai` credential on disk that the pipeline cannot see. (The Anthropic env var only works today because hacky-hack force-injects it as a provider-keyed runtime override, bypassing pi's normal resolution — not because pi reads it natively for `zai`.)
3. **Empty-string shadowing.** `createBaseConfig()` forwards `process.env.ANTHROPIC_API_KEY ?? ''`. When the Anthropic env vars are unset, an empty string is threaded into the agent config; pi currently ignores an empty override, but the contract is fragile and obscures "unset" from "misconfigured".

**Resolved auth resolution order (per selected provider).** The pipeline authenticates the **provider of the resolved model** (default `zai`), not Anthropic. Auth for a given provider is resolved in this order; the first available source wins:

1. **Explicit override** — a non-empty pipeline-level credential passed via the harness `options.apiKey` (e.g. a future `--api-key` flag or `PRP_API_KEY` env var). Highest precedence; forwarded only when non-empty.
2. **Provider-native env var** — the env var pi assigns to that provider (`ZAI_API_KEY` for `zai`, `ANTHROPIC_API_KEY` / `ANTHROPIC_OAUTH_TOKEN` for `anthropic`, etc.), resolved via pi's `getEnvApiKey(provider)` mapping.
3. **`pi` auth.json** — `~/.pi/agent/auth.json`, written by `pi /login` / `pi /auth`. **This must be honored** (see Groundswell contract change below); it is the canonical auth flow for interactive `pi` users.

**`ANTHROPIC_AUTH_TOKEN` demotion.** `ANTHROPIC_AUTH_TOKEN` is no longer required and is not the documented primary path. It MAY be accepted as a backward-compat alias (mapped to `ANTHROPIC_API_KEY` when the latter is unset) so existing Anthropic-provider setups keep working. It must never be the only accepted credential, and the default (`pi` + `zai`) path must not depend on it.

**Groundswell contract change (auth.json support).** Because hacky-hack is the `pi` harness's primary consumer, the harness MUST consult pi's on-disk auth store rather than an in-memory one. Concretely, `pi` harness initialization must replace `AuthStorage.inMemory()` with `AuthStorage.create()` (file-backed `FileAuthStorageBackend`, default path `getAgentDir()/auth.json`) — or accept a caller-supplied, file-backed `authStorage` / `ModelRegistry`. hacky-hack must NOT inject an empty `apiKey` into the harness options; it forwards an override only when a non-empty credential is explicitly resolved (§9.2.7). Track as a cross-cutting change against `~/projects/groundswell` `src/harnesses/pi-harness.ts`.

**Provider-aware base URL.** The endpoint (`ANTHROPIC_BASE_URL` today) is a property of the **provider**, not a global Anthropic setting. It must be resolved against the selected provider and default to the z.ai endpoint only when the provider is `zai`. The §9.2.4 safeguard remains in force for the `zai` provider.

#### 9.2.7 Authentication Preflight (Fail-Fast)

**Problem.** `validateEnvironment()` exists but is never invoked on the pipeline's startup path — only by `scripts/validate-api.ts`. A misconfigured credential (the single most common install failure) is therefore not detected until the first agent actually calls the model, where it surfaces as a deep, misleading error (`Pi agent execution failed: No API key found for zai.`) inside `decomposePRD`, after a session directory has already been created and an `ERROR_REPORT.md` written.

**Requirement.** The pipeline MUST run an auth preflight on the startup path, after `configureEnvironment()` and before `ensureHarnessInitialized()` / any agent run. The preflight resolves the selected **harness + provider/model** and verifies that at least one auth source from §9.2.6 is available for that provider.

**Failure behavior.** On failure, the pipeline MUST abort **before** creating a session or invoking an agent, and emit an actionable error naming:

- the selected harness and provider/model,
- every auth source that was checked and found empty (override, the provider env var name, and the `~/.pi/agent/auth.json` path),
- the exact remediation (`pi /login`, or `export <PROVIDER>_API_KEY=…`).

**Empty-string policy.** The preflight MUST treat empty / whitespace-only credentials as "not configured." Empty strings must never be forwarded into harness options as auth (eliminating the `?? ''` shadowing).

**Harness-specific check.** For the `claude-code` harness, the preflight verifies an Anthropic credential (that harness is Anthropic-only). For the `pi` harness, the preflight uses the provider-aware resolution in §9.2.6.

**Acceptance criteria.**

- A run with **no** credential configured for the selected provider aborts at startup with a single actionable message and exit code `1` — **no** session directory is created, **no** agent is invoked.
- A run authenticated via `~/.pi/agent/auth.json` alone (no env vars) succeeds under the `pi` + `zai` default.
- A run authenticated via `ZAI_API_KEY` alone succeeds under the `pi` + `zai` default.
- A run authenticated via `ANTHROPIC_AUTH_TOKEN` succeeds **only** when the provider is `anthropic` (or via the backward-compat alias); it is **not** required by the default path.

#### 9.2.8 Provider-Neutral Configuration Naming

**Problem.** Several pipeline-global configuration env vars still carry the `ANTHROPIC_` prefix — a legacy of the original Anthropic-first design (`ANTHROPIC_BASE_URL`, `ANTHROPIC_DEFAULT_OPUS_MODEL` / `..._SONNET_MODEL` / `..._HAIKU_MODEL`). Under the `pi` + `zai` default (§9.1, §9.2.6) this is actively misleading: the names imply a hard Anthropic dependency when in fact they configure the vendor-neutral pipeline (the LLM endpoint and the model-quality tiers). The tier names themselves (`opus`/`sonnet`/`haiku`) are Anthropic model-family names, compounding the same smell.

**Requirement.** Pipeline-global configuration env vars MUST be provider-neutral (the `PRP_*` namespace already used by `PRP_API_KEY`, `PRP_AGENT_HARNESS`, `PRP_PIPELINE_RUNNING`). A vendor name may appear ONLY in a variable that is genuinely that vendor-provider's own native credential (e.g. `ZAI_API_KEY`, `ANTHROPIC_API_KEY`), never in a pipeline-global setting.

**Canonical names.**

| Canonical (provider-neutral) | Legacy alias (deprecated)        | Purpose                                                     | Default                                                 |
| ---------------------------- | -------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------- |
| `PRP_API_BASE_URL`           | `ANTHROPIC_BASE_URL`             | LLM provider endpoint, resolved per provider (§9.2.4)       | `https://api.z.ai/api/anthropic` when provider is `zai` |
| `PRP_MODEL_HIGH`             | `ANTHROPIC_DEFAULT_OPUS_MODEL`   | Highest-quality model tier                                  | `glm-5.2`                                               |
| `PRP_MODEL_BALANCED`         | `ANTHROPIC_DEFAULT_SONNET_MODEL` | Balanced/default tier — planning & research roles (`AGENT`) | `glm-5.2`                                               |
| `PRP_MODEL_FAST`             | `ANTHROPIC_DEFAULT_HAIKU_MODEL`  | Fast/codegen tier — implementation role (`IMPL_AGENT`)      | `glm-5-turbo`                                           |

**Model-tier rename.** The internal tiers are renamed from Anthropic model-family names to vendor-neutral quality tiers: `opus` → `high`, `sonnet` → `balanced`, `haiku` → `fast`. This touches `MODEL_NAMES`, `MODEL_ENV_VARS`, `getModel(tier)`, the `ModelTier` type, and the agent factory's per-persona tier selection (§9.2.3). The role→tier mapping is unchanged: planning/research → `balanced`; implementation → `fast`.

**Backward compatibility.** The legacy `ANTHROPIC_*` names MUST remain readable as deprecated aliases: when a canonical var is unset, the loader falls back to the legacy alias and emits a one-time deprecation warning naming the canonical replacement. The legacy aliases are slated for removal in a future major version. `.env.example` documents only the canonical names (legacy names appear solely in a deprecation note).

**Scope / transition.** This is a forward requirement. When implemented, it updates §9.2.2, §9.2.3, and §9.2.4 to reference the canonical names as primary, the env loader (`config/environment.ts`, `config/constants.ts`) to read canonical-first with legacy fallback, and `.env.example`. **Until then, the `ANTHROPIC_*` names shown in §9.2.2–§9.2.4 remain in effect** (so the current code, which reads those names, stays in spec).

**Exception — Anthropic-provider credentials.** `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` are NOT renamed: they are the `anthropic` provider's own native credentials, consulted only when the resolved provider is `anthropic` (§9.2.6). Provider-native credential names are correct; only pipeline-global vars are neutralized.
