# Configuration Reference

> Comprehensive guide for configuring the PRP Pipeline development environment.

**Status**: Published
**Last Updated**: 2026-06-20
**Version**: 1.1.0

## Table of Contents

- [Quick Reference](#quick-reference)
- [Environment Variables](#environment-variables)
  - [API Authentication](#api-authentication)
  - [Model Selection](#model-selection-1)
  - [Agent Runtime (Harness)](#agent-runtime-harness)
  - [Pipeline Control](#pipeline-control)
  - [Resilience Tuning](#resilience-tuning)
  - [Bug Hunt Configuration](#bug-hunt-configuration)
  - [Advanced Configuration](#advanced-configuration)
- [CLI Options](#cli-options)
  - [Required Options](#required-options)
  - [Execution Mode](#execution-mode)
  - [Boolean Flags](#boolean-flags)
  - [Limit Options](#limit-options)
- [Model Selection](#model-selection)
- [Configuration Priority](#configuration-priority)
- [Security](#security)
- [Example Configuration](#example-configuration)
- [Common Gotchas](#common-gotchas)
- [See Also](#see-also)

---

## Quick Reference

Primary environment variable for the default `pi` + `zai` path:

| Variable             | Required | Default                          | Description                                                               |
| -------------------- | -------- | -------------------------------- | ------------------------------------------------------------------------- |
| `ZAI_API_KEY`        | Yes\*    | None                             | z.ai API key (the default-path credential).                               |
| `ANTHROPIC_BASE_URL` | No       | `https://api.z.ai/api/anthropic` | z.ai API endpoint (default for `zai` provider only).                      |
| `PRP_AGENT_HARNESS`  | No       | `pi`                             | Agent runtime/SDK (`pi` or `claude-code`); orthogonal to the LLM provider |

\*Required: Either `ZAI_API_KEY`, `pi /login` (`~/.pi/agent/auth.json`), or `PRP_API_KEY` must be set for the default path. Anthropic credentials (`ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_API_KEY`) are **optional** and only used when the provider is `anthropic`.

For complete configuration, see [Environment Variables](#environment-variables) below.

---

## Environment Variables

### API Authentication

The PRP Pipeline authenticates based on the **resolved LLM provider** (default `zai`).

| Variable               | Required | Default                          | Description                                                                                                    |
| ---------------------- | -------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `ZAI_API_KEY`          | Yes\*    | None                             | z.ai API key. The default-path credential when provider is `zai`.                                              |
| `PRP_API_KEY`          | No       | None                             | Explicit API-key override (highest precedence, any provider).                                                  |
| `ANTHROPIC_AUTH_TOKEN` | No\*\*   | None                             | Anthropic auth token. **Only** consulted when provider is `anthropic`. Mapped to `ANTHROPIC_API_KEY` if unset. |
| `ANTHROPIC_API_KEY`    | No\*\*   | None                             | Anthropic API key. **Only** consulted when provider is `anthropic`.                                            |
| `ANTHROPIC_BASE_URL`   | No       | `https://api.z.ai/api/anthropic` | API endpoint. Defaults to z.ai **only** for the `zai` provider.                                                |

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

Configure which models each agent tier uses.

| Variable                         | Required | Default       | Description                                                    |
| -------------------------------- | -------- | ------------- | -------------------------------------------------------------- |
| `ANTHROPIC_DEFAULT_OPUS_MODEL`   | No       | `GLM-4.7`     | Model for Architect agent (highest quality, complex reasoning) |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | No       | `GLM-4.7`     | Model for Researcher/Coder agents (balanced, default)          |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL`  | No       | `GLM-4.5-Air` | Model for simple operations (fastest)                          |

> Models are **provider-qualified** at runtime. A bare model name (e.g. `GLM-4.7`)
> resolves to `zai/GLM-4.7` (provider `zai`, the default); an already-qualified
> `provider/model` (e.g. `zai/GLM-4.7`) passes through unchanged. Values are read
> from the environment at runtime — never hardcoded. The model string is always
> `provider/model`; it is never harness-qualified (see
> [Agent Runtime (Harness)](#agent-runtime-harness)).

### Agent Runtime (Harness)

The agent runtime (harness) drives prompting, tool execution, and streaming. It is
**independent of the LLM provider** — it is selected separately from the model
(see [Model Selection](#model-selection-1)). Mirrors PRD §9.2.2 / §9.4.2.

| Variable            | Required | Default | Choices             | Description                                                                                                                     |
| ------------------- | -------- | ------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `PRP_AGENT_HARNESS` | No       | `pi`    | `pi`, `claude-code` | Agent runtime/SDK to use. `pi` (pi.dev) is vendor-neutral and runs any provider; `claude-code` runs Anthropic-only models only. |

**Harness ↔ provider independence:**

- The **harness** (`PRP_AGENT_HARNESS`) and the **provider/model** (see
  [Model Selection](#model-selection-1)) are selected independently.
- The harness **never** appears in the model string. `pi/zai/GLM-4.7` is **invalid**;
  always use `provider/model` (e.g. `zai/GLM-4.7`).
- **`claude-code` is Anthropic-only** and is **incompatible with the z.ai provider**
  used by default. Selecting it requires switching to `anthropic/*` models and
  disabling the z.ai endpoint safeguard (see
  [API Endpoint Security](#api-endpoint-security) and PRD §9.2.4). The pipeline
  validates this at startup and fails fast with a configuration error.

For the full harness system — supported harnesses, `configureHarnesses()`
configuration, the capability reference, and feature-parity rules — see the
**[Harness System](./GROUNDSWELL_GUIDE.md#harness-system)** section of the
Groundswell Guide.

### Pipeline Control

Control pipeline execution behavior.

| Variable               | Required | Default | Description                                                                                                                    |
| ---------------------- | -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `PRP_PIPELINE_RUNNING` | No       | None    | Nested execution guard. Contains parent PID to prevent recursive pipeline execution. Automatically set by pipeline controller. |
| `SKIP_BUG_FINDING`     | No       | `false` | Skip bug hunt / bug fix mode. Set to `true` to disable QA and bug fix operations.                                              |
| `SKIP_EXECUTION_LOOP`  | No       | `false` | Skip execution, run validation only. Set to `true` to validate PRDs without executing tasks.                                   |

### Resilience Tuning

Tune execution-loop resilience knobs. See PRD §4.2 (deadline & fallback), §4.5 (issue-driven re-planning), and §9.2.2.

| Variable           | Required | Default | Description                                                                                                                 |
| ------------------ | -------- | ------- | --------------------------------------------------------------------------------------------------------------------------- |
| `RESEARCH_TIMEOUT` | No       | `300`   | Deadline in seconds for background (parallel) research before falling back to synchronous re-research inline. See PRD §4.2. |
| `ISSUE_RETRY_MAX`  | No       | `3`     | Maximum number of issue-driven re-planning attempts per item before it hard-fails. See PRD §4.5.                            |

### Bug Hunt Configuration

Configure the bug hunt and bug fix behavior.

| Variable           | Required | Default           | Description                                                                   |
| ------------------ | -------- | ----------------- | ----------------------------------------------------------------------------- |
| `BUG_FINDER_AGENT` | No       | `glp`             | Agent type for bug finding operations.                                        |
| `BUG_RESULTS_FILE` | No       | `TEST_RESULTS.md` | Output file for bug hunt results.                                             |
| `BUGFIX_SCOPE`     | No       | `subtask`         | Scope level for bug fix operations (`subtask`, `task`, `milestone`, `phase`). |

### Advanced Configuration

Advanced settings for performance and debugging.

| Variable         | Required | Default | Description                                                 |
| ---------------- | -------- | ------- | ----------------------------------------------------------- |
| `API_TIMEOUT_MS` | No       | `60000` | Request timeout in milliseconds. Increase for complex PRDs. |

---

## CLI Options

The PRP Pipeline is invoked via `npm run dev -- [options]`. All options can be passed after the `--` separator.

### Required Options

| Option         | Type   | Default    | Description               |
| -------------- | ------ | ---------- | ------------------------- |
| `--prd <path>` | string | `./PRD.md` | Path to PRD markdown file |

### Execution Mode

| Option            | Type   | Choices                          | Default  | Description                                              |
| ----------------- | ------ | -------------------------------- | -------- | -------------------------------------------------------- |
| `--mode <mode>`   | string | `normal`, `bug-hunt`, `validate` | `normal` | Execution mode                                           |
| `--scope <scope>` | string | -                                | -        | Scope identifier. See [Execution Mode](#execution-mode). |

**Execution Modes:**

- `normal`: Standard pipeline execution (default)
- `bug-hunt`: Run QA and bug finding even with incomplete tasks
- `validate`: Validate PRD syntax and structure without running pipeline

**Scope Format:**

- Phase: `P1`, `P2`, etc.
- Milestone: `P1.M1`, `P3.M4`, etc.
- Task: `P1.M1.T1`, `P3.M4.T2`, etc.
- Subtask: `P1.M1.T1.S1`, `P3.M4.T2.S3`, etc.
- All: `all` (execute entire backlog)

### Boolean Flags

| Option                | Type    | Default | Description                                                   |
| --------------------- | ------- | ------- | ------------------------------------------------------------- |
| `--continue`          | boolean | `false` | Resume from previous session                                  |
| `--dry-run`           | boolean | `false` | Show plan without executing                                   |
| `--verbose`           | boolean | `false` | Enable debug logging                                          |
| `--machine-readable`  | boolean | `false` | Enable machine-readable JSON output                           |
| `--no-cache`          | boolean | `false` | Bypass cache and regenerate all PRPs                          |
| `--continue-on-error` | boolean | `false` | Treat all errors as non-fatal and continue pipeline execution |
| `--validate-prd`      | boolean | `false` | Validate PRD and exit without running pipeline                |

### Limit Options

| Option                 | Type    | Default | Description                                |
| ---------------------- | ------- | ------- | ------------------------------------------ |
| `--max-tasks <number>` | integer | None    | Maximum number of tasks to execute         |
| `--max-duration <ms>`  | integer | None    | Maximum execution duration in milliseconds |

---

## Model Selection

The PRP Pipeline uses three model tiers, each optimized for different tasks.

### Model Tiers

| Model Tier | Default Model | Max Tokens | Use Case                                     | Agents                |
| ---------- | ------------- | ---------- | -------------------------------------------- | --------------------- |
| **Opus**   | GLM-4.7       | 8192       | Complex reasoning, architectural planning    | Architect             |
| **Sonnet** | GLM-4.7       | 4096       | Balanced performance, default for most tasks | Researcher, Coder, QA |
| **Haiku**  | GLM-4.5-Air   | 4096       | Fast, simple operations                      | Future: quick lookups |

### When to Use Each Tier

**Opus (GLM-4.7):**

- Use for the Architect Agent where complex reasoning is required
- Higher cost, but higher quality output for breaking down PRDs
- Best for: PRD analysis, task decomposition, architectural decisions

**Sonnet (GLM-4.7):**

- Use for Researcher, Coder, and QA agents by default
- Balanced cost and performance
- Best for: Code implementation, research, testing, documentation

**Haiku (GLM-4.5-Air):**

- Use for simple operations where speed is more important than quality
- Lower cost, faster response times
- Currently unused, reserved for future enhancements

### Model Override

Override default models using environment variables:

```bash
# Override specific agent tier (bare names resolve to zai/* at runtime)
export ANTHROPIC_DEFAULT_OPUS_MODEL="GLM-4.7"       # resolves to zai/GLM-4.7
export ANTHROPIC_DEFAULT_SONNET_MODEL="GLM-4.7"     # resolves to zai/GLM-4.7
export ANTHROPIC_DEFAULT_HAIKU_MODEL="GLM-4.5-Air"  # resolves to zai/GLM-4.5-Air

# Or set a fully-qualified provider/model directly:
# export ANTHROPIC_DEFAULT_SONNET_MODEL="zai/GLM-4.7"
```

---

## Configuration Priority

Configuration is loaded from multiple sources in the following priority order (highest to lowest):

1. **Shell Environment** - Environment variables set in your shell or parent process
2. **`.env` File** - Local project configuration file
3. **Runtime Overrides** - Explicit environment variable settings in code
4. **Default Values** - Hardcoded defaults in TypeScript code

### Example: Priority in Action

If `ANTHROPIC_BASE_URL` is set in multiple sources:

```bash
# In .env file
ANTHROPIC_BASE_URL=https://api.example.com

# In shell (higher priority)
export ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic
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

# API endpoint (defaults to z.ai proxy for the default zai provider)
# WARNING: Do NOT use https://api.anthropic.com (blocked by safeguards)
# ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic

# =============================================================================
# MODEL CONFIGURATION
# =============================================================================

# Model for Architect agent (highest quality, complex reasoning)
# ANTHROPIC_DEFAULT_OPUS_MODEL=GLM-4.7

# Model for Researcher/Coder agents (balanced, default)
# ANTHROPIC_DEFAULT_SONNET_MODEL=GLM-4.7

# Model for simple operations (fastest)
# ANTHROPIC_DEFAULT_HAIKU_MODEL=GLM-4.5-Air

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
# BUG_FINDER_AGENT=glp

# Output file for bug hunt results
# BUG_RESULTS_FILE=TEST_RESULTS.md

# Scope level for bug fix operations
# BUGFIX_SCOPE=subtask

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
export ANTHROPIC_DEFAULT_SONNET_MODEL="anthropic/claude-sonnet-4"
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
export ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic
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
Using GLM-4.7 (opus/sonnet) for all operations when GLM-4.5-Air (haiku) would suffice.

**How to fix:**

```bash
# Use faster, cheaper model for simple operations
export ANTHROPIC_DEFAULT_HAIKU_MODEL="GLM-4.5-Air"
```

### "Harness appearing in the model string is invalid"

**What you see:**
A model string like `pi/zai/GLM-4.7` is rejected or mis-resolved.

**Why it happens:**
The harness never appears in the model string (PRD §9.4.3). Models are
`provider/model` only.

**How to fix:**

```bash
# Invalid — harness prefix in the model string
# export ANTHROPIC_DEFAULT_SONNET_MODEL="pi/zai/GLM-4.7"

# Correct — provider/model only
export ANTHROPIC_DEFAULT_SONNET_MODEL="zai/GLM-4.7"

# Select the harness separately
# export PRP_AGENT_HARNESS=pi
```

### "Using claude-code with a z.ai key"

**What you see:**
Startup fails fast with a harness/provider configuration error.

**Why it happens:**
`claude-code` runs Anthropic-only models and is incompatible with the z.ai
provider (PRD §9.2.4 / §9.4.3).

**How to fix:**

```bash
# Option A: keep the default pi harness (works with z.ai)
export PRP_AGENT_HARNESS=pi
export ANTHROPIC_DEFAULT_SONNET_MODEL="zai/GLM-4.7"

# Option B: use claude-code with Anthropic models (not z.ai)
# export PRP_AGENT_HARNESS=claude-code
# export ANTHROPIC_DEFAULT_SONNET_MODEL="anthropic/claude-sonnet-4-20250514"
# — also requires disabling the z.ai endpoint safeguard (PRD §9.2.4)
```

---

## See Also

- **[INSTALLATION.md](./INSTALLATION.md)** - Setup instructions for the development environment
- **[User Guide](./user-guide.md)** - Comprehensive usage documentation
- **[README.md](../README.md)** - Project overview and quick start
- **[.env.example](../.env.example)** - Template for local configuration
- **[src/config/](../src/config/)** - Source code for environment configuration
- **[src/cli/](../src/cli/)** - Source code for CLI parsing
- **[Groundswell Guide](./GROUNDSWELL_GUIDE.md)** - Harness system, supported runtimes, capability reference, and parity rules
