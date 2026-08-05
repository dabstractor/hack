# Configuration Reference

> Comprehensive guide for configuring the PRP Pipeline development environment.

**Status**: Published
**Last Updated**: 2026-06-20
**Version**: 1.1.0

## Table of Contents

- [Quick Reference](#quick-reference)
- [.hack Configuration File](#hack-configuration-file)
- [Environment Variables](#environment-variables)
  - [API Authentication](#api-authentication)
  - [Model Selection](#model-selection)
  - [Agent Runtime (Harness)](#agent-runtime-harness)
  - [Pipeline Control](#pipeline-control)
  - [Resilience Tuning](#resilience-tuning)
  - [Distributed PRDs](#distributed-prds)
  - [Concurrency & Monitoring](#concurrency--monitoring)
  - [Bug Hunt Configuration](#bug-hunt-configuration)
  - [Validation Control](#validation-control)
  - [Advanced Configuration](#advanced-configuration)
  - [tasks.json Lock Tunables](#tasksjson-lock-tunables)
- [CLI Options](#cli-options)
  - [Required Options](#required-options)
  - [Execution Mode](#execution-mode)
  - [Boolean Flags](#boolean-flags)
  - [Limit Options](#limit-options)
  - [Delta Response](#delta-response)
- [Task & Status Commands](#task--status-commands)
- [Models, Roles & Reasoning Budget](#models-roles--reasoning-budget)
- [Configuration Priority](#configuration-priority)
- [Security](#security)
- [Example Configuration](#example-configuration)
- [Common Gotchas](#common-gotchas)
- [See Also](#see-also)

---

## Quick Reference

The **primary** configuration mechanism is the [`.hack` file](#hack-configuration-file) — a
committable TOML file that captures every tunable default (PRD §9.7). The env vars and CLI
flags below are the higher-precedence override layers (see
[Configuration Priority](#configuration-priority)); `.hack` fills the gaps.

Primary environment variable for the default `pi` + `zai` path:

| Variable            | Required | Default                          | Description                                                                              |
| ------------------- | -------- | -------------------------------- | ---------------------------------------------------------------------------------------- |
| `ZAI_API_KEY`       | Yes\*    | None                             | z.ai API key (the default-path credential).                                              |
| `PRP_API_BASE_URL`  | No       | `https://api.z.ai/api/anthropic` | z.ai API endpoint (default for `zai` provider only). Legacy alias: `ANTHROPIC_BASE_URL`. |
| `PRP_AGENT_HARNESS` | No       | `pi`                             | Agent runtime/SDK (`pi` or `claude-code`); orthogonal to the LLM provider                |

\*Required: Either `ZAI_API_KEY`, `pi /login` (`~/.pi/agent/auth.json`), or `PRP_API_KEY` must be set for the default path. Anthropic credentials (`ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_API_KEY`) are **optional** and only used when the provider is `anthropic`. The pure-local modes `--validate-prd` and `--dry-run` make no API calls and run without any credential.

For complete configuration, see [Environment Variables](#environment-variables) below.

---

## .hack Configuration File

`.hack` is the **primary** configuration mechanism — a committable TOML file that captures
every tunable default (both the env-var-style settings of [Environment Variables](#environment-variables)
and the CLI flags of [CLI Options](#cli-options)), so you do not have to re-export env vars or
re-pass CLI flags on every invocation (PRD §9.7). Every key maps to exactly one `[section].key`,
and each maps to an env var and/or a CLI flag it seeds as a default.

### Discovery (three tiers)

Three files are searched (lowest → highest precedence), each optional (PRD §9.7.3):

| Tier          | File                                                                    | Committable?     | Secrets?                    |
| ------------- | ----------------------------------------------------------------------- | ---------------- | --------------------------- |
| Global        | `~/.hack` / `$XDG_CONFIG_HOME/hack/config` / `$HACK_CONFIG_HOME/config` | n/a (user-level) | Refused                     |
| Project       | `<repoRoot>/.hack`                                                      | Yes              | Refused (hard error)        |
| Project-local | `<repoRoot>/.hack.local`                                                | No (gitignored)  | Allowed (only secrets tier) |

Missing file at any tier is not an error — that tier contributes nothing.

### Schema summary

The authoritative schema reference is **PRD §9.7.5** (and `hack config show`, which prints the
same mapping). The summary below groups the exhaustive `SCHEMA_MAP` rows from
[`src/config/hack-config.ts`](../src/config/hack-config.ts) by section; see the linked env-var
subsections for the per-key semantics.

| `[section]`         | Keys (summary)                                                                                        | Maps to env vars / CLI flags (sample)                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `[models]`          | `high`, `balanced`, `fast`                                                                            | `PRP_MODEL_HIGH` / `_BALANCED` / `_FAST`                                                          |
| `[endpoint]`        | `base_url`                                                                                            | `PRP_API_BASE_URL`                                                                                |
| `[harness]`         | `name`                                                                                                | `PRP_AGENT_HARNESS` (`pi` \| `claude-code`)                                                       |
| `[pipeline]`        | `parallel_research`, `research_depth`, `research_timeout_seconds`, `issue_retry_max`, `commit_format` | `PARALLEL_RESEARCH`, `RESEARCH_DEPTH`, `RESEARCH_TIMEOUT`, `ISSUE_RETRY_MAX`, `PRP_COMMIT_FORMAT` |
| `[commit]`          | `retry_max`, `retry_delay_ms`, `retry_delay_cap_ms`, `classifier_retry_max`                           | `COMMIT_RETRY_MAX` / `_DELAY` / `_DELAY_CAP`, `CLASSIFIER_RETRY_MAX`                              |
| `[bug_hunt]`        | `finder_agent`, `results_file`, `fix_scope`                                                           | `BUG_FINDER_AGENT`, `BUG_RESULTS_FILE`, `BUGFIX_SCOPE`                                            |
| `[validation]`      | `agent`, `timeout_seconds`                                                                            | `VALIDATION_AGENT`, `VALIDATION_TIMEOUT`                                                          |
| `[distributed_prd]` | `include_max_depth`, `include_markers`                                                                | `PRD_INCLUDE_MAX_DEPTH`, `PRD_INCLUDE_MARKERS`                                                    |
| `[tasks_lock]`      | `stale_ms`, `timeout_ms`, `poll_ms`                                                                   | `TASKS_LOCK_STALE_MS` / `_TIMEOUT_MS` / `_POLL_MS`                                                |
| `[concurrency]`     | `research_queue`, `parallelism`                                                                       | `RESEARCH_QUEUE_CONCURRENCY`                                                                      |
| `[api]`             | `timeout_ms`                                                                                          | `API_TIMEOUT_MS`                                                                                  |
| `[monitor]`         | `task_interval`, `interval_ms`, `enabled`                                                             | `MONITOR_TASK_INTERVAL`                                                                           |
| `[cli]`             | `mode` (and the other Commander defaults)                                                             | `--mode` (CLI default only; some keys are CLI-only, no env var)                                   |

> **Env-over-file rule (PRD §9.2.1):** `.hack` tiers seed `process.env` **only** when the key
> is `undefined`. A real env var (shell or `.env`) — even an empty one — is already "set" and
> therefore wins over the file value. `.hack` fills gaps; it never overrides real env. A `[cli]`
> key sets the **default** for the matching Commander option, so an explicit flag on the command
> line still wins.
>
> **Secrets policy (PRD §9.7.6):** committable `.hack` (global + project tiers) refuses
> secret-bearing keys (any key ending `_key`/`_token`/`_secret`/`_password`) — a non-empty
> secret there is a **hard error** (exit 1). `.hack.local` (gitignored) is the only `.hack` tier
> permitted to hold secrets. Unknown sections/keys emit a stderr **warning** and are ignored
> (catches typos); type/range/enum mismatches are hard errors.

### `hack config` subcommand

The `hack config` subcommand manages `.hack` files (PRD §9.7.8):

| Command                         | Description                                                                  |
| ------------------------------- | ---------------------------------------------------------------------------- |
| `hack config init [--force]`    | Write a commented `.hack` template (also adds `.hack.local` to `.gitignore`) |
| `hack config show [--src]`      | Print the effective merged config with resolved values (secrets masked)      |
| `hack config validate [<file>]` | Lint `.hack` + `.hack.local` (CI gate; exit 1 on errors)                     |
| `hack config path`              | Print the global / project / local config paths consulted                    |

See [CLI Reference](./CLI_REFERENCE.md) for the exhaustive `hack config` reference, and
[Configuration Priority](#configuration-priority) for how the tiers compose with env/CLI.

---

## Environment Variables

### API Authentication

The PRP Pipeline authenticates based on the **resolved LLM provider** (default `zai`).

| Variable               | Required | Default                          | Description                                                                                                                 |
| ---------------------- | -------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `ZAI_API_KEY`          | Yes\*    | None                             | z.ai API key. The default-path credential when provider is `zai`.                                                           |
| `PRP_API_KEY`          | No       | None                             | Explicit API-key override (highest precedence, any provider).                                                               |
| `ANTHROPIC_AUTH_TOKEN` | No\*\*   | None                             | Anthropic auth token. **Only** consulted when provider is `anthropic`. Mapped to `ANTHROPIC_API_KEY` if unset.              |
| `ANTHROPIC_API_KEY`    | No\*\*   | None                             | Anthropic API key. **Only** consulted when provider is `anthropic`.                                                         |
| `PRP_API_BASE_URL`     | No       | `https://api.z.ai/api/anthropic` | API endpoint (canonical, PRD §9.2.8). Defaults to z.ai **only** for the `zai` provider. Legacy alias: `ANTHROPIC_BASE_URL`. |

\*Required: Either `ZAI_API_KEY`, `pi /login` (`~/.pi/agent/auth.json`, auto-detected), or `PRP_API_KEY` for the default `zai` path.
\*\*Optional: Anthropic credentials are only used when the resolved provider is `anthropic` (via an `anthropic/*` model override). They are **ignored** for the default `zai` provider.

**Resolution order (PRD §9.2.6):**

1. **Explicit override** — `PRP_API_KEY` env var (or `options.override`)
2. **Provider-native env var** — `ZAI_API_KEY` for `zai`; `ANTHROPIC_OAUTH_TOKEN` → `ANTHROPIC_API_KEY` for `anthropic`
3. **`~/.pi/agent/auth.json`** — auto-detected by pi's file-backed AuthStorage (requires `pi /login`)

Empty or whitespace-only values are treated as "not configured".

**Provider-conditional AUTH_TOKEN mapping:**

```typescript
// From src/config/environment.ts — anthropic provider ONLY
if (
  provider === 'anthropic' &&
  process.env.ANTHROPIC_AUTH_TOKEN &&
  !process.env.ANTHROPIC_API_KEY
) {
  process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_AUTH_TOKEN;
}
```

**Important:** The `ANTHROPIC_AUTH_TOKEN` → `ANTHROPIC_API_KEY` mapping only applies when the resolved provider is `anthropic`. For the default `zai` provider, it is **not** consulted — use `ZAI_API_KEY` or `pi /login` instead.

### Model Selection

Configure which model each **tier** uses. For how tiers map to **roles** and reasoning budgets, see
[Models, Roles & Reasoning Budget](#models-roles--reasoning-budget).

| Variable             | Required | Default       | Description                                                                                                              |
| -------------------- | -------- | ------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `PRP_MODEL_HIGH`     | No       | `glm-5.2`     | Highest-quality tier model (override). Legacy alias: `ANTHROPIC_DEFAULT_OPUS_MODEL`.                                     |
| `PRP_MODEL_BALANCED` | No       | `glm-5.2`     | Balanced tier model (default tier for the Research and Reasoning roles). Legacy alias: `ANTHROPIC_DEFAULT_SONNET_MODEL`. |
| `PRP_MODEL_FAST`     | No       | `glm-5-turbo` | Fast tier model (used by the Implementation role). Legacy alias: `ANTHROPIC_DEFAULT_HAIKU_MODEL`.                        |

> Models are **provider-qualified** at runtime. A bare model name (e.g. `glm-5.2`)
> resolves to `zai/glm-5.2` (provider `zai`, the default); an already-qualified
> `provider/model` (e.g. `zai/glm-5.2`) passes through unchanged. Values are read
> from the environment at runtime — never hardcoded. The model string is always
> `provider/model`; it is never harness-qualified (see
> [Agent Runtime (Harness)](#agent-runtime-harness)).

### Agent Runtime (Harness)

The agent runtime (harness) drives prompting, tool execution, and streaming. It is
**independent of the LLM provider** — it is selected separately from the model
(see [Models, Roles & Reasoning Budget](#models-roles--reasoning-budget)). Mirrors PRD §9.2.2 / §9.4.2.

| Variable            | Required | Default | Choices             | Description                                                                                                                     |
| ------------------- | -------- | ------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `PRP_AGENT_HARNESS` | No       | `pi`    | `pi`, `claude-code` | Agent runtime/SDK to use. `pi` (pi.dev) is vendor-neutral and runs any provider; `claude-code` runs Anthropic-only models only. |

**Harness ↔ provider independence:**

- The **harness** (`PRP_AGENT_HARNESS`) and the **provider/model** (see
  [Models, Roles & Reasoning Budget](#models-roles--reasoning-budget)) are selected independently.
- The harness **never** appears in the model string. `pi/zai/glm-5.2` is **invalid**;
  always use `provider/model` (e.g. `zai/glm-5.2`).
- **`claude-code` is Anthropic-only** and is **incompatible with the z.ai provider**
  used by default. Selecting it requires switching to `anthropic/*` models and
  disabling the z.ai endpoint safeguard (see
  [API Endpoint Security](#api-endpoint-security) and PRD §9.2.4). The pipeline
  validates this at startup (on agent-invoking runs) and fails fast with a configuration error.
  The pure-local modes `--validate-prd` and `--dry-run` make no API calls and bypass this check.

For the full harness system — supported harnesses, `configureHarnesses()`
configuration, the capability reference, and feature-parity rules — see the
**[Harness System](./GROUNDSWELL_GUIDE.md#harness-system)** section of the
Groundswell Guide.

### Pipeline Control

Control pipeline execution behavior.

| Variable               | Required | Default | Description                                                                                                                          |
| ---------------------- | -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `PRP_PIPELINE_RUNNING` | No       | None    | Nested execution guard. Contains parent PID to prevent recursive pipeline execution. Automatically set by pipeline controller.       |
| `SKIP_BUG_FINDING`     | No       | `false` | Skip bug hunt. When `true`, also identifies **bug-fix mode** and disables QA / bug-finding operations. See PRD §9.2.2.               |
| `SKIP_EXECUTION_LOOP`  | No       | `false` | Skip execution, run validation only. Also set **internally by `--adopt-prd`** (PRD §4.6). See [Adopt Mode](#adopt-mode---adopt-prd). |

### Resilience Tuning

Tune execution-loop resilience knobs. See PRD §4.2 (deadline & fallback), §4.3 (delta-classifier retry), §4.5 (issue-driven re-planning), and §9.2.2.

| Variable                 | Required | Default       | Description                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------ | -------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RESEARCH_TIMEOUT`       | No       | `1800`        | Deadline in seconds for background (parallel) research before falling back to synchronous re-research inline. See PRD §4.2.                                                                                                                                                                                                                                                                          |
| `PARALLEL_RESEARCH`      | No       | `false`       | Enable background (parallel) PRP research. Set to `true` (literal). Forwarded to the bugfix sub-pipeline. CLI: `-r`/`--parallel-research`. See PRD §4.2, §4.4.                                                                                                                                                                                                                                       |
| `RESEARCH_DEPTH`         | No       | `2`           | How many items ahead the background research supervisor prefetches as a chain. Forwarded to the bugfix sub-pipeline. See PRD §4.2, §4.4.                                                                                                                                                                                                                                                             |
| `ISSUE_RETRY_MAX`        | No       | `3`           | Maximum number of issue-driven re-planning attempts per item before it hard-fails. See PRD §4.5.                                                                                                                                                                                                                                                                                                     |
| `COMMIT_RETRY_MAX`       | No       | `5`           | Maximum number of stagecoach commit-message-generation attempts before falling back (total attempts: initial + retries). See PRD §5.1.                                                                                                                                                                                                                                                               |
| `COMMIT_RETRY_DELAY`     | No       | `10000`       | Base delay in milliseconds between stagecoach commit-message-generation retries (exponential, doubling). See PRD §5.1.                                                                                                                                                                                                                                                                               |
| `COMMIT_RETRY_DELAY_CAP` | No       | `120000`      | Maximum delay cap in milliseconds for stagecoach commit-message-generation backoff. See PRD §5.1.                                                                                                                                                                                                                                                                                                    |
| `CLASSIFIER_RETRY_MAX`   | No       | `4`           | Maximum number of LLM change/artifact-classifier attempts before failing to the protective/conservative default (treat as SUBSTANTIVE/DIRTY). Total attempt count (initial + retries), like the `COMMIT_RETRY_*` knobs. See PRD §4.3.                                                                                                                                                                |
| `PRP_COMMIT_FORMAT`      | No       | `task-prefix` | Commit-message format mode. `task-prefix` (DEFAULT) layers the `<phase>.<milestone>.<task>.<subtask>:` position prefix; `plain` opts out (no prefix). Any other value (including empty) falls back to `task-prefix`. See PRD §5.1. **`.hack` key:** `[pipeline] commit_format` (see [.hack Configuration File](#hack-configuration-file)); already live via `constants.ts` / `getPrpCommitFormat()`. |

### Distributed PRDs

Control distributed / multi-file PRD assembly. See PRD §2.3.

A PRD may be authored across multiple files (architecture, API, data model, companion docs) and assembled into one canonical document at load time. An `@path/to/file.md` token is an **include directive** — it is replaced inline by the referenced file's UTF-8 contents. A token expands only when **both** (1) **boundary** — the `@` is at the start of the line or preceded by a non-path character (so `foo@bar.com` and mid-word `@` are left literal) — and (2) **existence** — the path resolves to an existing **file** (directories and missing paths stay verbatim and silent). Includes resolve **project-root-relative** (relative to the entry PRD's directory) and expand recursively with cycle detection up to `PRD_INCLUDE_MAX_DEPTH`.

| Variable                | Required | Default | Description                                                                                                                                                                                       |
| ----------------------- | -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PRD_INCLUDE_MAX_DEPTH` | No       | `10`    | Max recursion depth for include expansion (PRD §2.3). Non-numeric or non-positive values fall back to the default.                                                                                |
| `PRD_INCLUDE_MARKERS`   | No       | unset   | When set, resolved output emits `<!-- @include: path -->` / `<!-- @end-include -->` markers around expanded includes; a `.md` token that fails to resolve (stale include) emits a stderr warning. |

### Concurrency & Monitoring

Control background concurrency and resource-monitoring cadence. Mirror the
`.env.example` "CONCURRENCY CONFIGURATION" grouping. Both are CLI-flag env overrides.

| Variable                     | Required | Default | Description                                                                                                                           |
| ---------------------------- | -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `RESEARCH_QUEUE_CONCURRENCY` | No       | `3`     | Max concurrent background research tasks for parallel PRP generation (range 1-10). CLI: `--research-queue-concurrency`. See PRD §4.2. |
| `MONITOR_TASK_INTERVAL`      | No       | `1`     | Monitor resources every Nth task (range 1-100). CLI: `--monitor-task-interval`.                                                       |

### Bug Hunt Configuration

Configure the bug hunt and bug fix behavior.

| Variable           | Required | Default           | Description                                                              |
| ------------------ | -------- | ----------------- | ------------------------------------------------------------------------ |
| `BUG_FINDER_AGENT` | No       | `pizr`            | Reasoning-tier agent used for creative bug discovery (PRD §4.4, §9.2.3). |
| `BUG_RESULTS_FILE` | No       | `TEST_RESULTS.md` | Output file for bug hunt results.                                        |

### Validation Control

Configure the validation stage of the QA & bug-hunt loop. See PRD §4.4 and §9.2.2.

| Variable             | Required | Default | Description                                                                                                                                                                    |
| -------------------- | -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `VALIDATION_AGENT`   | No       | `pizr`  | Reasoning-tier agent that generates and runs `validate.sh`. Overrides the generic `$AGENT` for the validation call only. See PRD §4.4, §9.2.3.                                 |
| `VALIDATION_TIMEOUT` | No       | `7200`  | Watchdog budget in seconds for the validation call (2h — validation legitimately runs full test suites). Overrides the generic agent timeout for this call only. See PRD §4.4. |

### Advanced Configuration

Advanced settings for performance and debugging. The `HACKY_` prefix marks framework /
Groundswell-level knobs exposed as CLI `--flag` env overrides.

| Variable                        | Required | Default | Description                                                                                                                      |
| ------------------------------- | -------- | ------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `API_TIMEOUT_MS`                | No       | `60000` | Request timeout in milliseconds. Increase for complex PRDs. (Framework-level — consumed by the harness SDK, not read in `src/`.) |
| `HACKY_LOG_LEVEL`               | No       | `info`  | Minimum log level. CLI: `--log-level`.                                                                                           |
| `HACKY_TASK_RETRY_MAX_ATTEMPTS` | No       | `3`     | Max retry attempts for transient errors (range 0-10). CLI: `--task-retry-max-attempts`.                                          |
| `HACKY_FLUSH_RETRIES`           | No       | `3`     | Max retries for batch write failures (range 0-10). CLI: `--flush-retries`.                                                       |
| `HACKY_PRP_CACHE_TTL`           | No       | `24h`   | PRP cache time-to-live (internal; rarely set directly). CLI: `--prp-cache-ttl`.                                                  |

### tasks.json Lock Tunables

Tune the O_EXCL `tasks.json.lock` file used by `withLockedTasksJSON` (PRD §5.1). These are
**rarely tuned** — only adjust if read-modify-write critical sections run longer than the
defaults.

| Variable                | Required | Default | Description                                                                                    |
| ----------------------- | -------- | ------- | ---------------------------------------------------------------------------------------------- |
| `TASKS_LOCK_STALE_MS`   | No       | `30000` | Age in ms at which an unreleased `tasks.json.lock` is considered stale and forcibly removed.   |
| `TASKS_LOCK_TIMEOUT_MS` | No       | `30000` | Deadline in ms to acquire `tasks.json.lock` before giving up with `TasksLockAcquisitionError`. |
| `TASKS_LOCK_POLL_MS`    | No       | `50`    | Retry interval in ms between lock-acquisition attempts.                                        |

---

## CLI Options

The PRP Pipeline is invoked via `npm run dev -- [options]`. All options can be passed after the `--` separator.

### Required Options

| Option         | Type   | Default    | Description               |
| -------------- | ------ | ---------- | ------------------------- |
| `--prd <path>` | string | `./PRD.md` | Path to PRD markdown file |

### Execution Mode

| Option            | Type   | Choices                                   | Default  | Description                                              |
| ----------------- | ------ | ----------------------------------------- | -------- | -------------------------------------------------------- |
| `--mode <mode>`   | string | `normal`, `delta`, `bug-hunt`, `validate` | `normal` | Execution mode                                           |
| `--scope <scope>` | string | -                                         | -        | Scope identifier. See [Execution Mode](#execution-mode). |

**Execution Modes:**

- `normal`: Standard pipeline execution (default)
- `delta`: Detect PRD changes and run the delta workflow (PRD §4.3). The response to a detected change is controlled by `--accept-prd-changes` and the integrate-into-current path — see the [CLI Reference: Delta Response Selection](./CLI_REFERENCE.md#delta-response-selection).
- `bug-hunt`: Run QA and bug finding even with incomplete tasks
- `validate`: Validate PRD syntax and structure without running pipeline

**Scope Format:**

- Phase: `P1`, `P2`, etc.
- Milestone: `P1.M1`, `P3.M4`, etc.
- Task: `P1.M1.T1`, `P3.M4.T2`, etc.
- Subtask: `P1.M1.T1.S1`, `P3.M4.T2.S3`, etc.
- All: `all` (execute entire backlog)

### Boolean Flags

| Option                 | Type    | Default | Description                                                             |
| ---------------------- | ------- | ------- | ----------------------------------------------------------------------- |
| `--continue`           | boolean | `false` | Resume from previous session                                            |
| `--dry-run`            | boolean | `false` | Show plan without executing (no credential required)                    |
| `--verbose`            | boolean | `false` | Enable debug logging                                                    |
| `--machine-readable`   | boolean | `false` | Enable machine-readable JSON output                                     |
| `--no-cache`           | boolean | `false` | Bypass cache and regenerate all PRPs                                    |
| `--continue-on-error`  | boolean | `false` | Treat all errors as non-fatal and continue pipeline execution           |
| `--validate-prd`       | boolean | `false` | Validate PRD and exit (no agent, no credential)                         |
| `--accept-prd-changes` | boolean | `false` | Accept PRD edits as the new baseline without a delta session (PRD §4.3) |

### Limit Options

| Option                 | Type    | Default | Description                                |
| ---------------------- | ------- | ------- | ------------------------------------------ |
| `--max-tasks <number>` | integer | None    | Maximum number of tasks to execute         |
| `--max-duration <ms>`  | integer | None    | Maximum execution duration in milliseconds |

### Delta Response

When the pipeline resumes an active session (`--continue`) whose `prd_snapshot.md` no longer matches the current `PRD.md`, it has detected a PRD change (PRD §4.3). The pending change is recorded in a `prd_changed.marker` file (the `.pending_delta_hash`) in the session directory, and one of three response paths is taken:

- **Delta session (default):** spawn a linked session scoped to the diffs (completed work preserved).
- **Integrate into current session:** fold new requirements into the running session's task hierarchy. The original `prd_snapshot.md` is preserved until after integration succeeds.
- **`--accept-prd-changes`:** accept PRD edits as the new baseline **without** a delta session — cancels the queued `.pending_delta_hash`, refreshes `prd_snapshot.md` to the current PRD, and exits/resumes idempotently. Use this for doc-only or already-finished edits.

See the [CLI Reference: Delta Response Selection](./CLI_REFERENCE.md#delta-response-selection) for examples.

### Adopt Mode (`--adopt-prd`)

Declares the PRD the source of truth for an _already-implemented_ codebase (PRD §4.6). On a **fresh project** (no `plan/` sessions), `--adopt-prd` seeds a single completed baseline `tasks.json` (one "Adopt existing codebase" item, all `Complete`) and writes an `.adopted` marker, then sets the internal `SKIP_EXECUTION_LOOP` flag so implementation is skipped while **validation and bug hunt still run** against the real codebase. This adopted session becomes the idempotent baseline that future deltas diff against.

- Requires the PRD to exist; is a **no-op** (warn + proceed) if sessions already exist.
- Guard rails: rejects an empty session dir and `mkdir -p`s the plan dir first.
- See also the [`SKIP_EXECUTION_LOOP`](#pipeline-control) env var (§9.2.2) and [CLI Reference → `--adopt-prd`](./CLI_REFERENCE.md).

---

## Models, Roles & Reasoning Budget

The pipeline selects models via **three roles** — research, reasoning, and implementation. Each
role maps to a quality **tier** (high / balanced / fast) and a reasoning budget. The
`PRP_MODEL_*` env vars override the tier defaults; the role → {tier, budget} mapping is fixed in
`ROLE_CONFIG` (`src/agents/agent-factory.ts`, PRD §9.2.3 / §6.1). Tiers are **quality levels**
(default model + max tokens); roles are the authoritative binding of a pipeline persona to a tier
plus a reasoning budget. See the [Model Selection](#model-selection) env-var table for the
canonical tier-override env vars.

### Model Tiers

Tiers are **quality levels**. The default model for each is overridable via the `PRP_MODEL_*`
env vars (see [Model Selection](#model-selection)); the role→tier binding is authoritative in
[Model Roles](#model-roles) below.

| Tier         | Default Model | Max Tokens | Use Case                                     |
| ------------ | ------------- | ---------- | -------------------------------------------- |
| **high**     | glm-5.2       | 8192       | Complex reasoning, architectural planning    |
| **balanced** | glm-5.2       | 4096       | Balanced performance, default for most tasks |
| **fast**     | glm-5-turbo   | 4096       | Fast, simple operations                      |

> **Tier ↔ role note:** `balanced` is bound to the Research and Reasoning roles (Reasoning at the
> `xhigh` reasoning budget); `fast` is bound to the Implementation role (Coder PRP
> execution/fix, Cleanup). `high` is the highest-quality tier override — not currently bound to a
> fixed role. See [Model Roles](#model-roles) for the authoritative mapping.

### When to Use Each Tier

**high (glm-5.2):**

- Highest quality, higher cost; override `PRP_MODEL_HIGH` to use it for a role.
- Best for: PRD analysis, task decomposition, architectural decisions.

**balanced (glm-5.2):**

- The default tier — bound to the **Research** role (Researcher) and **Reasoning** role
  (Architect decomposition, Bug-finder, Validation).
- Balanced cost and performance.
- Best for: code implementation, research, testing, documentation.

**fast (glm-5-turbo):**

- Fastest, lowest cost — bound to the **Implementation** role (Coder PRP execution/fix, Cleanup).
- Best for: simple operations where speed matters more than peak quality.

### Model Roles

In addition to the model **tiers** above, the pipeline assigns each agent a model **role**
(PRD §9.2.3) that selects both the tier and the reasoning (extended-thinking) budget. The
role→{tier, budget} mapping lives in `ROLE_CONFIG` (in
`src/agents/agent-factory.ts`) and is the single source of truth.

| Role               | Tier     | Reasoning Budget | Pipeline agents                                   |
| ------------------ | -------- | ---------------- | ------------------------------------------------- |
| **Research**       | balanced | normal           | Researcher (PRP creation, architecture research)  |
| **Reasoning**      | balanced | `xhigh`          | Architect (decomposition), Bug-finder, Validation |
| **Implementation** | fast     | normal           | Coder (PRP execution, post-validation fix)        |

> **Maximum reasoning budget:** Decomposition, creative bug-finding, and validation run at
> the **maximum** reasoning budget (extended-thinking `xhigh`) per PRD §6.1 / §9.2.3, because
> synthesizing research into a strict Phase→Milestone→Task→Subtask hierarchy is the most
> reasoning-intensive step. Research and Implementation roles run at their model's normal
> budget (the `thinking` field is omitted → `undefined`).

### Model Override

Override default models using the canonical environment variables (PRD §9.2.8):

```bash
# Override specific agent tier (bare names resolve to zai/* at runtime)
export PRP_MODEL_HIGH="glm-5.2"       # resolves to zai/glm-5.2
export PRP_MODEL_BALANCED="glm-5.2"   # resolves to zai/glm-5.2
export PRP_MODEL_FAST="glm-5-turbo"   # resolves to zai/glm-5-turbo

# Or set a fully-qualified provider/model directly:
# export PRP_MODEL_BALANCED="zai/glm-5.2"
```

### Deprecation (legacy `ANTHROPIC_*` aliases)

The legacy `ANTHROPIC_*`-prefixed pipeline-global env vars are **deprecated**
(PRD §9.2.8) but remain **readable** for backward compatibility. When a canonical
var is unset, the loader falls back to the legacy alias and emits a **one-time**
deprecation warning (per legacy var per process) naming the canonical replacement.
The legacy aliases are slated for removal in a future major version.

| Canonical (provider-neutral) | Legacy alias (deprecated)        |
| ---------------------------- | -------------------------------- |
| `PRP_API_BASE_URL`           | `ANTHROPIC_BASE_URL`             |
| `PRP_MODEL_HIGH`             | `ANTHROPIC_DEFAULT_OPUS_MODEL`   |
| `PRP_MODEL_BALANCED`         | `ANTHROPIC_DEFAULT_SONNET_MODEL` |
| `PRP_MODEL_FAST`             | `ANTHROPIC_DEFAULT_HAIKU_MODEL`  |

> **Note:** Provider-native credentials `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN`
> are **not** renamed (PRD §9.2.8 exception) — they are the `anthropic` provider's
> own native credentials, consulted only when the resolved provider is `anthropic`.

---

## Configuration Priority

Configuration is resolved through a strictly ordered layering: **each layer overrides the
one below it, and for any given key the highest-precedence layer that provides a value wins**
(PRD §9.2.1). Sources, from highest to lowest precedence:

1. **CLI flags** — `--prd`, `--mode`, `--parallel-research`, `--log-level`, etc. (Commander;
   highest precedence).
2. **Shell environment** — real exported env vars (CI overrides, ad-hoc `FOO=bar hack`).
   **Even an empty env var wins over a `.hack` file value.**
3. **`.env` file** — `<repoRoot>/..env`, the credentials/secrets channel.
4. **`.hack.local`** — `<repoRoot>/.hack.local` (gitignored; the only `.hack` tier permitted to
   hold secrets).
5. **`.hack`** — `<repoRoot>/.hack` (committable; refuses secrets).
6. **Global `.hack`** — `~/.hack` / `$XDG_CONFIG_HOME/hack/config` / `$HACK_CONFIG_HOME/config`
   (user-level defaults across every project).
7. **Default values** — the `DEFAULT_*` constants in [`src/config/constants.ts`](../src/config/constants.ts).

> **Env-over-file rule (PRD §9.2.1):** the `.hack` tiers (layers 4–6) seed `process.env`
> **only** when the key is `undefined`. A real env var (shell or `.env`) — even an empty one — is
> already "set" and therefore wins over the file value. This is the standard convention so CI
> and temporary `VAR=val hack` overrides work without editing files, and it is what makes `.hack`
> safe to commit: a teammate's personal shell config can never be silently overridden by the
> project file. To make a `.hack` value take effect, unset the conflicting env var. See
> [.hack Configuration File](#hack-configuration-file) for the schema and tier discovery.

### Example: Priority in Action

If `PRP_API_BASE_URL` is set in multiple sources:

```bash
# In .env file
PRP_API_BASE_URL=https://api.example.com

# In shell (higher priority)
export PRP_API_BASE_URL=https://api.z.ai/api/anthropic
```

The shell environment value (`https://api.z.ai/api/anthropic`) takes precedence.

### Special Case: Provider-Aware Resolution

API key resolution is **provider-aware** (PRD §9.2.6):

- **Default `zai` path**: `PRP_API_KEY` → `ZAI_API_KEY` → `~/.pi/agent/auth.json` (auto-detected). Anthropic env vars are ignored.
- **`anthropic` path**: `PRP_API_KEY` → `ANTHROPIC_OAUTH_TOKEN` → `ANTHROPIC_API_KEY`. The `ANTHROPIC_AUTH_TOKEN` alias is mapped to `ANTHROPIC_API_KEY` only when the provider is `anthropic`.
- Empty/whitespace-only values are treated as "not configured" (nothing fake is forwarded).

---

## Security

### API Key Security

**CRITICAL**: Never commit your `.env` file to version control.

The `.env` file contains sensitive authentication credentials that should never be shared.

```bash
# .gitignore (already configured)
.env
```

**Best Practices:**

1. Use `.env.example` as a template (contains placeholder values only)
2. Keep your `.env` file local (never commit, never share)
3. Rotate your API key if it's accidentally exposed
4. Use environment-specific tokens when possible (development vs production)

### API Endpoint Security

**WARNING**: Do NOT use the production Anthropic API endpoint.

The pipeline includes safeguards that will block execution if you attempt to use `https://api.anthropic.com`:

```typescript
// From test setup
if (process.env.ANTHROPIC_BASE_URL?.includes('api.anthropic.com')) {
  throw new Error('Tests must use z.ai API, not Anthropic production API');
}
```

Always use the z.ai proxy endpoint: `https://api.z.ai/api/anthropic`

---

## Example Configuration

Create a `.env` file in your project root:

```bash
# =============================================================================
# API AUTHENTICATION
# =============================================================================

# --- PRIMARY (pi + zai default) ---
# Option A: Use pi /login (writes ~/.pi/agent/auth.json, auto-detected by the harness)
#
# Option B: Set ZAI_API_KEY directly
ZAI_API_KEY=your-zai-key-here

# --- OPTIONAL: Anthropic-only credentials (claude-code harness / anthropic/* models) ---
# These are ONLY consulted when the resolved provider is 'anthropic'.
# For the default zai provider, they are ignored.
# ANTHROPIC_AUTH_TOKEN=your-anthropic-token-here
# ANTHROPIC_API_KEY=your-anthropic-key-here

# --- OPTIONAL: Explicit API-key override (highest precedence, any provider) ---
# PRP_API_KEY=your-override-key-here

# =============================================================================
# API ENDPOINT
# =============================================================================

# Canonical provider-neutral endpoint (PRD §9.2.8). Defaults to z.ai for the
# default `zai` provider.
# WARNING: Do NOT use https://api.anthropic.com (blocked by safeguards)
# PRP_API_BASE_URL=https://api.z.ai/api/anthropic
#
# DEPRECATED legacy alias (still readable, emits a one-time warning; PRD §9.2.8):
# ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic

# =============================================================================
# MODEL CONFIGURATION
# =============================================================================

# Model for Architect agent (highest quality, complex reasoning)
# PRP_MODEL_HIGH=glm-5.2

# Model for Researcher/Coder agents (balanced, default)
# PRP_MODEL_BALANCED=glm-5.2

# Model for simple operations (fastest)
# PRP_MODEL_FAST=glm-5-turbo

# =============================================================================
# AGENT RUNTIME (HARNESS) — OPTIONAL
# =============================================================================

# Agent runtime/SDK. INDEPENDENT of the LLM provider/model above.
# Default: pi (pi.dev, vendor-neutral — runs any provider, incl. z.ai).
# claude-code requires anthropic/* models (incompatible with the z.ai provider).
# PRP_AGENT_HARNESS=pi

# =============================================================================
# PIPELINE CONTROL (OPTIONAL)
# =============================================================================

# Skip bug hunt / bug fix mode
# SKIP_BUG_FINDING=true

# Skip execution, run validation only
# SKIP_EXECUTION_LOOP=true

# =============================================================================
# BUG HUNT CONFIGURATION (OPTIONAL)
# =============================================================================

# Agent type for bug finding
# BUG_FINDER_AGENT=pizr

# Output file for bug hunt results
# BUG_RESULTS_FILE=TEST_RESULTS.md

# =============================================================================
# VALIDATION CONFIGURATION (OPTIONAL)
# =============================================================================

# Reasoning-tier agent that generates and runs validate.sh (default: pizr)
# VALIDATION_AGENT=pizr

# Watchdog budget in seconds for the validation call (default: 7200 = 2h)
# VALIDATION_TIMEOUT=7200

# =============================================================================
# ADVANCED CONFIGURATION (OPTIONAL)
# =============================================================================

# Request timeout in milliseconds (default: 60000)
# API_TIMEOUT_MS=300000
```

---

## Common Gotchas

### "API key not working"

**What you see:**

```bash
Error: Missing required environment variables: ANTHROPIC_API_KEY
```

**Why it happens:**
For the default `zai` provider, the pipeline looks for `ZAI_API_KEY` (or `~/.pi/agent/auth.json` / `pi /login`), not Anthropic credentials. If using Anthropic models, you need an `anthropic/*` model override AND Anthropic credentials.

**How to fix:**

```bash
# For the default zai path (recommended)
export ZAI_API_KEY=zk-xxxxx
# Or: pi /login (writes ~/.pi/agent/auth.json)

# For Anthropic-only models
export PRP_MODEL_BALANCED="anthropic/claude-sonnet-4"
export ANTHROPIC_API_KEY=sk-ant-xxxxx
```

### "Tests fail with wrong API endpoint"

**What you see:**

```bash
Error: Tests must use z.ai API, not Anthropic production API
```

**Why it happens:**
You're using `https://api.anthropic.com` instead of the z.ai proxy endpoint.

**How to fix:**

```bash
export PRP_API_BASE_URL=https://api.z.ai/api/anthropic
```

### "Scope format rejected"

**What you see:**

```bash
Error: Invalid scope "p1.m1.t1.s1"
Expected format: P1, P1.M1, P1.M1.T1, P1.M1.T1.S1, or all
```

**Why it happens:**
Scope format is case-sensitive. You must use uppercase P, M, T, S.

**How to fix:**

```bash
# Correct (uppercase)
npm run dev -- --scope P1.M1.T1.S1

# Incorrect (lowercase)
npm run dev -- --scope p1.m1.t1.s1  # Will fail
```

### "Model selection affecting cost"

**What you see:**
Higher than expected API usage costs.

**Why it happens:**
Using glm-5.2 (high/balanced) for all operations when glm-5-turbo (fast) would suffice.

**How to fix:**

```bash
# Use faster, cheaper model for simple operations
export PRP_MODEL_FAST="glm-5-turbo"
```

### "Harness appearing in the model string is invalid"

**What you see:**
A model string like `pi/zai/glm-5.2` is rejected or mis-resolved.

**Why it happens:**
The harness never appears in the model string (PRD §9.4.3). Models are
`provider/model` only.

**How to fix:**

```bash
# Invalid — harness prefix in the model string
# export PRP_MODEL_BALANCED="pi/zai/glm-5.2"

# Correct — provider/model only
export PRP_MODEL_BALANCED="zai/glm-5.2"

# Select the harness separately
# export PRP_AGENT_HARNESS=pi
```

### "Using claude-code with a z.ai key"

**What you see:**
Startup fails fast with a single actionable message and exit code 1 (no raw stack trace). The message names both fixes: switch the harness to `pi` (`PRP_AGENT_HARNESS=pi`) or switch the model provider to `anthropic/*` models (which also requires an Anthropic credential).

**Why it happens:**
`claude-code` runs Anthropic-only models and is incompatible with the z.ai
provider (PRD §9.2.4 / §9.4.3).

**How to fix:**

```bash
# Option A: keep the default pi harness (works with z.ai)
export PRP_AGENT_HARNESS=pi
export PRP_MODEL_BALANCED="zai/glm-5.2"

# Option B: use claude-code with Anthropic models (not z.ai)
# export PRP_AGENT_HARNESS=claude-code
# export PRP_MODEL_BALANCED="anthropic/claude-sonnet-4-20250514"
# — also requires disabling the z.ai endpoint safeguard (PRD §9.2.4)
```

---

## Task & Status Commands

The `hack status` / `hack task` / `hack task next` subcommands read the resolved session's
`tasks.json`. Their exit codes distinguish three states (PRD §5.3):

| State                                                           | `hack status` behavior                                                                                | Exit code |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------- |
| Normal — `tasks.json` present                                   | Prints the backlog / next task as usual                                                               | `0`       |
| Breakdown-in-progress — session dir exists, `tasks.json` absent | Calm stderr notice; `--output json` emits `{ "status": "awaiting_breakdown", "session": "NNN_hash" }` | `0`       |
| Explicit `--file <path>` missing                                | Hard error "file not found" (explicit override is not softened)                                       | non-zero  |
| No sessions at all                                              | Hard error "No sessions found" (distinct empty state)                                                 | non-zero  |

> **Breakdown-in-progress (PRD §5.3):** there is a legitimate window between session creation
> (the `plan/NNN_hash/` directory is stamped with `.prd_hash`) and the Architect Agent finishing
> decomposition (writing `tasks.json`). During that window the directory exists but `tasks.json`
> does not. For an **auto-resolved** (discovered) tasks file this is reported as a calm notice
> with **exit `0`** — an observation of a valid transient state, not a failure — so shell scripts
> and CI loops that poll `hack status` while a run warms up do not break. This is distinct from
> the §5.1 corruption-recovery path (present-but-broken files) and the `--file` / no-sessions
> hard errors above. See [CLI Reference](./CLI_REFERENCE.md) for the subcommand syntax.

---

## See Also

- **[INSTALLATION.md](./INSTALLATION.md)** - Setup instructions for the development environment
- **[User Guide](./user-guide.md)** - Comprehensive usage documentation
- **[README.md](../README.md)** - Project overview and quick start
- **[.env.example](../.env.example)** - Template for local configuration
- **[src/config/](../src/config/)** - Source code for environment configuration
- **[src/cli/](../src/cli/)** - Source code for CLI parsing
- **[Groundswell Guide](./GROUNDSWELL_GUIDE.md)** - Harness system, supported runtimes, capability reference, and parity rules
