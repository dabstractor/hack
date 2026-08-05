# CLI Reference

> Complete reference for the PRP Pipeline command-line interface, including all available commands, options, execution modes, exit codes, and usage examples.

**Status**: Published
**Last Updated**: 2026-01-23
**Version**: 1.0.0

## Table of Contents

- [Quick Reference](#quick-reference)
- [Commands](#commands)
  - [Pipeline Execution](#pipeline-execution)
  - [Scoped Execution](#scoped-execution)
  - [Special Modes](#special-modes)
  - [Delta Response Selection](#delta-response-selection)
  - [Task Management](#task-management)
- [Options](#options)
  - [Required Options](#required-options)
  - [Execution Control](#execution-control)
  - [Boolean Flags](#boolean-flags)
  - [Limit Options](#limit-options)
- [Exit Codes](#exit-codes)
- [Examples](#examples)
  - [Basic Usage](#basic-usage)
  - [Advanced Scenarios](#advanced-scenarios)
  - [Common Patterns](#common-patterns)
- [Error Handling](#error-handling)
  - [Common Errors](#common-errors)
  - [Troubleshooting](#troubleshooting)
- [See Also](#see-also)

---

## Quick Reference

Essential commands for daily use:

| Command                                        | Description                                  |
| ---------------------------------------------- | -------------------------------------------- |
| `npm run dev -- --prd ./PRD.md`                | Run full pipeline with default PRD           |
| `npm run dev -- --prd ./PRD.md --scope P1`     | Execute only Phase 1                         |
| `npm run dev -- --prd ./PRD.md --continue`     | Resume from previous session                 |
| `npm run dev -- --prd ./PRD.md --dry-run`      | Show plan without executing                  |
| `npm run dev -- --prd ./PRD.md --verbose`      | Run with debug logging enabled               |
| `npm run dev -- --prd ./PRD.md --validate-prd` | Validate PRD syntax without running pipeline |

---

## Commands

The PRP Pipeline is invoked via `npm run dev -- [options]`. The double dash (`--`) is critical - it separates npm arguments from pipeline arguments.

### Pipeline Execution

**Basic Command:**

```bash
npm run dev -- --prd ./PRD.md
```

This command:

- Reads the PRD from the specified path
- Analyzes requirements and generates tasks
- Executes all tasks through AI agents
- Runs validation and bug hunting
- Saves session state for resumption

**With Verbose Logging:**

```bash
npm run dev -- --prd ./PRD.md --verbose
```

Enable debug logging to see detailed execution information, including:

- Parsed CLI arguments
- Scope parsing results
- Agent invocation details
- Session state changes

### Scoped Execution

Execute a specific portion of your backlog using scope identifiers:

```bash
# Execute only Phase 1
npm run dev -- --prd ./PRD.md --scope P1

# Execute only Milestone 1.1
npm run dev -- --prd ./PRD.md --scope P1.M1

# Execute only Task 1.1.1
npm run dev -- --prd ./PRD.md --scope P1.M1.T1

# Execute only Subtask 1.1.1.1
npm run dev -- --prd ./PRD.md --scope P1.M1.T1.S1

# Execute entire backlog (default)
npm run dev -- --prd ./PRD.md --scope all
```

**Scope Format:**

| Format    | Example       | Description                        |
| --------- | ------------- | ---------------------------------- |
| Phase     | `P1`          | Execute all tasks in Phase 1       |
| Milestone | `P1.M1`       | Execute all tasks in Milestone 1.1 |
| Task      | `P1.M1.T1`    | Execute all subtasks in Task 1.1.1 |
| Subtask   | `P1.M1.T1.S1` | Execute only subtask 1.1.1.1       |
| All       | `all`         | Execute entire backlog (default)   |

**Important**: Scope format is **case-sensitive**. Use uppercase letters: `P1.M1`, not `p1.m1`.

### Special Modes

**Resume Interrupted Session:**

```bash
npm run dev -- --prd ./PRD.md --continue
```

Resumes execution from the previous session, continuing from where it left off. The session manager automatically loads the saved state and continues with incomplete tasks.

**Dry Run (Preview):**

```bash
npm run dev -- --prd ./PRD.md --dry-run
```

Shows what would be executed without actually running the pipeline. Useful for:

- Verifying PRD syntax
- Checking scope selection
- Previewing execution plan

`--dry-run` makes no API calls and requires no credential — it parses the PRD and prints the plan.

**PRD Validation Only:**

```bash
npm run dev -- --prd ./PRD.md --validate-prd
```

Validates the PRD syntax and structure without running the pipeline. Exits with code 0 if valid, 1 if invalid. It makes no API calls and **requires no credential**, so you can lint your PRD before configuring API access.

### Delta Response Selection

When you resume an active session (`--continue`) whose `prd_snapshot.md` no longer matches the current `PRD.md` — i.e. you edited the PRD mid-project — the pipeline detects the change (PRD §4.3 "The Delta Workflow") and offers three response paths. The pending change is recorded in a `prd_changed.marker` file (the `.pending_delta_hash`) inside the session directory.

**1. Delta session (default):**

```bash
npm run dev -- --prd ./PRD.md --continue
```

Spawns a **linked delta session** scoped to the diffs. Completed work is preserved; affected tasks are re-executed. This is the default when no response flag is set.

**2. Integrate into current session:**

Folds the new/changed requirements into the **running** session's task hierarchy instead of spawning a separate delta session. The original `prd_snapshot.md` is **preserved until after integration succeeds** — the integration agent diffs the original snapshot against the current PRD, and the snapshot is refreshed only once integration has applied. (This path is implemented and reachable programmatically; its CLI trigger is deferred.)

**3. Accept PRD edits as the new baseline (`--accept-prd-changes`):**

```bash
npm run dev -- --prd ./PRD.md --continue --accept-prd-changes
```

Accepts the PRD edits as the new baseline **without** generating a delta session. Across all `PRD_CHANGED_*` session states it **cancels the queued `.pending_delta_hash`**, **refreshes `prd_snapshot.md` to the current PRD**, and **exits/resumes idempotently**. Use this for documentation-only edits or for changes that merely describe already-finished, validated work. The next run detects no change and proceeds normally.

### Task Management

The CLI provides task-querying subcommands for inspecting the current session's
backlog:

| Command            | Description                                                |
| ------------------ | ---------------------------------------------------------- |
| `hack task`        | List all tasks in the current session (default action)     |
| `hack task next`   | Show the next executable (Planned) subtask                 |
| `hack task status` | Show a status-counts summary (grouped by status)           |
| `hack status`      | **Alias of `hack task`** (git muscle memory; see PRD §5.3) |

**Options:**

| Option                  | Description                                |
| ----------------------- | ------------------------------------------ |
| `-f, --file <path>`     | Override the `tasks.json` file path        |
| `-o, --output <format>` | Output format: `table` (default) or `json` |

```bash
# List all tasks
hack task
# Same thing, git-style
hack status

# Get the next executable subtask (JSON)
hack status next -o json
```

**Breakdown-in-progress state.** If the latest session's directory exists but
`tasks.json` has not been generated yet (the Architect Agent is still
decomposing the PRD, or a breakdown run was interrupted), `hack task` /
`hack status` / `hack task next` print a calm notice to **stderr** and exit **0**
— this is a normal transient state, not an error. Under `--output json` they
emit `{ "status": "awaiting_breakdown", "session": "NNN_hash" }`. Re-run
shortly, or run `hack --continue` to (re)generate `tasks.json`. Note that an
explicit `--file <path>` pointing at a missing file, and the no-sessions-at-all
state, remain **hard errors** (exit non-zero) — only auto-resolved (discovered)
tasks files get the graceful path. See PRD §5.3.

**Run from anywhere (PRD §9.8.7 / §9.8.9).** Every `hack` subcommand — `task`, `status`,
`cache`, `inspect`, `artifacts`, `validate-state`, and `config` — resolves `plan/`, `PRD.md`,
`.hack`, and `.env` at the **repository root**, regardless of the directory you invoke it from.
At startup `hack` walks up from your current directory to the nearest `.git` entry (a directory
for a normal clone, or a file for a worktree/submodule) and `chdir`s to that root via a
`preAction` hook that runs _before_ each action handler, so the same command works identically
from the repo root or a deep subdirectory. Pass `--repo-root <path>` (§9.8.6) to pin an explicit
root and skip the upward search. Invoking `hack` outside any git repository exits 1 with a
single `NotARepositoryError` (§9.8.5) naming the directory it searched from and the `--repo-root`
remediation. See [Running from Anywhere](../README.md#running-from-anywhere) and [Bootstrap
Layer](./ARCHITECTURE.md#bootstrap-layer).

---

### Configuration Management

The `hack config` subcommand (PRD §9.7.8) manages the `.hack` configuration
file — a TOML file that centralizes pipeline tunables (model ids, retries,
concurrency, etc.). It exposes four actions:

| Command                         | Description                                                               |
| ------------------------------- | ------------------------------------------------------------------------- |
| `hack config init [--force]`    | Write a commented `.hack` template (all schema sections as examples)      |
| `hack config show [--src]`      | Print the effective (merged) config with resolved values (default action) |
| `hack config validate [<file>]` | Lint `.hack` + `.hack.local` (or an explicit file); CI-friendly gate      |
| `hack config path`              | Print the global / project / local config paths actually consulted        |

**Options:**

| Option                  | Description                                                     |
| ----------------------- | --------------------------------------------------------------- |
| `--force`               | `init` only: overwrite an existing `.hack` (refuses without it) |
| `--src`                 | `show` only: annotate each value with its winning layer         |
| `--global`              | `path` only: print the global config path                       |
| `--local`               | `path` only: print the project-local config path                |
| `-o, --output <format>` | Output format: `table` (default) or `json` (`show` and `path`)  |

**Layer precedence (PRD §9.2.1):** `show` merges all tiers and reports the
winning layer per key — `global` → `project` (`.hack`, committable) →
`project-local` (`.hack.local`, gitignored) → `env` (shell/exported vars win
over file values) → `default` (schema default). The `cli` layer is not reported
(the subcommand does not receive pipeline flags).

**Secrets (PRD §9.7.6/§9.7.10):** `show` masks any secret-suffixed key
(`_key`/`_token`/`_secret`/`_password`) as `<redacted>`. Secrets are only
permitted in `.hack.local`; `validate` rejects a secret found in a committable
file. `show` runs **without invoking any agent**, so it is safe to run even
with broken auth.

**`init` + `.gitignore` (PRD §9.7.6):** `hack config init` also adds
`.hack.local` to `<repoRoot>/.gitignore` (under a
`# .hack local overrides (never commit)` comment, placed near the
`# Environment files` section when one exists; idempotent across repeated runs;
creates `.gitignore` if absent) so personal overrides and secrets are never
committed. A bare pre-existing `.hack.local` line is left untouched (dedup
wins over placement), so `init` is always a safe no-op for the gitignore.

**`validate` + tracked-`.hack.local` warning (PRD §9.7.6):** if
`.hack.local` is tracked by git (e.g. it was accidentally `git add`-ed),
`hack config validate` prints a loud **stderr** WARNING naming the file, the
potential secret leak, and the remediation:

```bash
git rm --cached .hack.local
```

This is a **non-fatal warning** — `validate` still exits **0** when only
warnings occurred (the warning never flips the exit code). It stays silent when
`.hack.local` is absent, untracked, or the cwd is not a git repo.

```bash
# Onboard a fresh repo with a commented .hack
hack config init

# See the effective merged config (no agent invoked)
hack config show

# Debug why a value resolved the way it did
hack config show --src

# Lint as a CI gate (exit 1 on hard errors, 0 on warnings-only)
hack config validate

# Lint a specific file
hack config validate ./my-staging.hack

# Find where global/local config lives
hack config path --global
```

---

## Options

### Required Options

| Option         | Type   | Default    | Description               |
| -------------- | ------ | ---------- | ------------------------- |
| `--prd <path>` | string | `./PRD.md` | Path to PRD markdown file |

### Execution Control

| Option            | Type   | Choices                                   | Default  | Description                                  |
| ----------------- | ------ | ----------------------------------------- | -------- | -------------------------------------------- |
| `--mode <mode>`   | string | `normal`, `delta`, `bug-hunt`, `validate` | `normal` | Execution mode                               |
| `--scope <scope>` | string | -                                         | -        | Scope identifier (e.g., `P3.M4`, `P3.M4.T2`) |

**Execution Modes:**

- **`normal`**: Standard pipeline execution (default)
  - Generates PRPs for all tasks
  - Executes implementation agents
  - Runs validation gates
  - Performs bug hunting at completion

- **`bug-hunt`**: Run QA and bug finding even with incomplete tasks
  - Useful for testing partial implementations
  - Runs bug detection on available code
  - Skips certain completion checks

- **`validate`**: Validate PRD syntax and structure without running pipeline
  - Checks PRD formatting
  - Validates required sections
  - Exits after validation (same as `--validate-prd` flag)

- **`delta`**: Detect PRD changes and run the delta workflow.
  - On an active session whose `prd_snapshot.md` no longer matches the current PRD, the pipeline enters the Delta Workflow (PRD §4.3).
  - The response to a detected change is controlled by `--accept-prd-changes` and the integrate-into-current path — see [Delta Response Selection](#delta-response-selection).

### Boolean Flags

| Option                 | Type    | Default | Description                                                                       |
| ---------------------- | ------- | ------- | --------------------------------------------------------------------------------- |
| `--continue`           | boolean | false   | Resume from previous session                                                      |
| `--dry-run`            | boolean | false   | Show plan without executing (no credential required)                              |
| `--verbose`            | boolean | false   | Enable debug logging                                                              |
| `--machine-readable`   | boolean | false   | Enable machine-readable JSON output                                               |
| `--no-cache`           | boolean | false   | Bypass cache and regenerate all PRPs                                              |
| `--continue-on-error`  | boolean | false   | Treat all errors as non-fatal and continue pipeline execution                     |
| `--validate-prd`       | boolean | false   | Validate PRD and exit (no agent, no credential)                                   |
| `--accept-prd-changes` | boolean | false   | Accept PRD edits as the new baseline without a delta session (PRD §4.3)           |
| `--adopt-prd`          | boolean | false   | Declare the PRD as the source of truth for an already-shipped codebase (PRD §4.6) |

**Flag Details:**

- **`--continue`**: Loads the previous session state and continues execution. Useful after interruptions or when iterating on failed tasks.

- **`--dry-run`**: Parses the PRD and validates the execution plan without running any agents. Displays what would be executed. No credential required.

- **`--verbose`**: Enables detailed debug logging. Use when troubleshooting issues or understanding pipeline behavior.

- **`--machine-readable`**: Outputs results in JSON format for programmatic consumption. Useful for CI/CD integration.

- **`--no-cache`**: Forces regeneration of all PRPs even if cached versions exist. Use when PRD content or context has changed significantly.

- **`--continue-on-error`**: Treats all errors as non-fatal. The pipeline continues execution even when individual tasks fail. Useful for gathering maximum feedback.

- **`--validate-prd`**: Validates PRD structure and exits. Returns exit code 0 if valid, 1 if invalid. No agent is invoked and no credential is required. Equivalent to `--mode validate`.

- **`--accept-prd-changes`**: Accept PRD edits as the new baseline **without** generating a delta session. When the pipeline detects a PRD change on an active session, this flag cancels the queued `.pending_delta_hash`, refreshes `prd_snapshot.md` to the current PRD, and exits/resumes idempotently (PRD §4.3 step 2). Use this for doc-only edits or for changes that merely describe already-finished work. See [Delta Response Selection](#delta-response-selection).

- **`--adopt-prd`**: Declare the PRD the source of truth for an _already-implemented_ codebase (PRD §4.6). On a **fresh project** (no `plan/` sessions) it seeds a completed baseline session (P5.M1.T1.S2) so future PRD edits produce deltas against the real code. Guard rails: requires the PRD to exist; is a **no-op** (warn + proceed) if sessions already exist; rejects an empty session dir; and `mkdir -p`s the plan dir first.

### Limit Options

| Option                 | Type    | Default | Description                                |
| ---------------------- | ------- | ------- | ------------------------------------------ |
| `--max-tasks <number>` | integer | None    | Maximum number of tasks to execute         |
| `--max-duration <ms>`  | integer | None    | Maximum execution duration in milliseconds |

**Limit Details:**

- **`--max-tasks`**: Limits the number of tasks executed. Useful for testing or incremental development.

- **`--max-duration`**: Sets a maximum execution time in milliseconds. The pipeline will stop after this duration, saving state for resumption.

---

## Exit Codes

The pipeline uses specific exit codes to indicate completion status:

| Code | Name             | Description                            |
| ---- | ---------------- | -------------------------------------- |
| 0    | SUCCESS          | Pipeline completed successfully        |
| 1    | ERROR            | General error occurred                 |
| 2    | VALIDATION_ERROR | PRD or configuration validation failed |
| 130  | INTERRUPTED      | Process interrupted by user (Ctrl+C)   |

**Exit Code Details:**

- **0 (SUCCESS)**: All tasks completed successfully, validation passed, and no bugs were found.

- **1 (ERROR)**: A fatal error occurred during execution. This includes:
  - Task execution failures
  - Agent invocation errors
  - Configuration errors
  - File system errors
  - `hack config validate` rejecting a `.hack`/`.hack.local` for a hard error
    (a secret in a committable file per §9.7.6, a type/range/enum mismatch per
    §9.7.7, or a TOML parse error). `validate` exits **0** when only unknown
    section/key warnings occurred, so it can gate PRs in CI (errors vs. warnings).

- **2 (VALIDATION_ERROR)**: Configuration validation failed (e.g. invalid environment variable values). Note: `--validate-prd` returns exit code **0 (valid) / 1 (invalid)**, not code 2.

- **130 (INTERRUPTED)**: The pipeline was interrupted by the user (typically via Ctrl+C). Session state is saved for resumption.

**Shell Script Handling:**

```bash
# Check exit code in shell script
npm run dev -- --prd ./PRD.md
EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
  echo "Pipeline succeeded"
elif [ $EXIT_CODE -eq 130 ]; then
  echo "Pipeline was interrupted"
elif [ $EXIT_CODE -eq 2 ]; then
  echo "Configuration validation failed"
else
  echo "Pipeline failed with exit code $EXIT_CODE"
fi
```

**PowerShell Handling:**

```powershell
# Check exit code in PowerShell
npm run dev -- --prd ./PRD.md
if ($LASTEXITCODE -eq 0) {
  Write-Host "Pipeline succeeded"
} elseif ($LASTEXITCODE -eq 130) {
  Write-Host "Pipeline was interrupted"
} else {
  Write-Host "Pipeline failed with exit code $LASTEXITCODE"
}
```

---

## Examples

### Basic Usage

**Run pipeline with default settings:**

```bash
npm run dev -- --prd ./PRD.md
```

**Run with verbose logging for debugging:**

```bash
npm run dev -- --prd ./PRD.md --verbose
```

**Check what would happen without executing:**

```bash
npm run dev -- --prd ./PRD.md --dry-run
```

**Validate PRD syntax:**

```bash
npm run dev -- --prd ./PRD.md --validate-prd
```

### Advanced Scenarios

**Phase-based Development:**

```bash
# Work on Phase 1 first
npm run dev -- --prd ./PRD.md --scope P1

# Later work on Phase 2
npm run dev -- --prd ./PRD.md --scope P2
```

**Debugging Specific Issues:**

```bash
# Re-run a failed subtask with verbose output
npm run dev -- --prd ./PRD.md --scope P1.M1.T2.S1 --verbose --no-cache

# Validate PRD syntax before running
npm run dev -- --prd ./PRD.md --validate-prd
```

**Resuming After Interruption:**

```bash
# Pipeline was interrupted - resume where it left off
npm run dev -- --prd ./PRD.md --continue
```

**Bypassing Cache:**

```bash
# Force regeneration of all PRPs
npm run dev -- --prd ./PRD.md --no-cache
```

### Common Patterns

**Development Workflow:**

```bash
# 1. Validate PRD first
npm run dev -- --prd ./PRD.md --validate-prd

# 2. Dry run to see what will be executed
npm run dev -- --prd ./PRD.md --dry-run

# 3. Execute with scope (start small)
npm run dev -- --prd ./PRD.md --scope P1.M1

# 4. Resume if needed
npm run dev -- --prd ./PRD.md --continue
```

**Delta Iteration:**

```bash
# After modifying PRD, run only changed tasks
# The pipeline automatically detects changes via PRD hash
npm run dev -- --prd ./PRD.md --continue

# Doc-only or already-finished edits? Accept them as the new baseline
# without spawning a delta session (PRD §4.3):
npm run dev -- --prd ./PRD.md --continue --accept-prd-changes
```

**CI/CD Integration:**

```bash
# Machine-readable output for automation
npm run dev -- --prd ./PRD.md --machine-readable --max-duration 300000
```

**Quality Assurance:**

```bash
# Run bug hunt mode on existing implementation
npm run dev -- --prd ./PRD.md --mode bug-hunt --scope P2
```

---

## Error Handling

### Common Errors

#### "PRD file not found"

**What you see:**

```bash
$ npm run dev -- --prd ./PRD.md
Error: PRD file not found: ./PRD.md
```

**Why it happens:**

The PRD file path is incorrect or the file doesn't exist.

**How to fix:**

```bash
# Use absolute or relative path
npm run dev -- --prd /full/path/to/PRD.md

# Or verify current directory
pwd
ls PRD.md
```

#### "Invalid scope format"

**What you see:**

```bash
$ npm run dev -- --prd ./PRD.md --scope p1.m1.t1.s1
Error: Invalid scope "p1.m1.t1.s1"
Expected format: P1, P1.M1, P1.M1.T1, P1.M1.T1.S1, or all
```

**Why it happens:**

Scope format is case-sensitive. You must use uppercase P, M, T, S.

**How to fix:**

```bash
# Correct (uppercase)
npm run dev -- --prd ./PRD.md --scope P1.M1.T1.S1

# Incorrect (lowercase)
npm run dev -- --prd ./PRD.md --scope p1.m1.t1.s1  # Will fail
```

#### "Session not found"

**What you see:**

```bash
$ npm run dev -- --prd ./PRD.md --continue
Error: No previous session found
```

**Why it happens:**

There is no previous session to resume from. Either this is the first run, or the session was deleted.

**How to fix:**

```bash
# Run without --continue to start a new session
npm run dev -- --prd ./PRD.md
```

#### "Missing required environment variables"

**What you see:**

```bash
Error: Missing required environment variables: ANTHROPIC_API_KEY
```

**Why it happens:**

The API authentication token is not set.

**How to fix:**

```bash
# Set the authentication token
export ANTHROPIC_AUTH_TOKEN=zk-xxxxx

# Or use ANTHROPIC_API_KEY directly
export ANTHROPIC_API_KEY=zk-xxxxx
```

See [Configuration Reference](./CONFIGURATION.md) for details on environment variables.

### Troubleshooting

**Enable Verbose Logging:**

```bash
npm run dev -- --prd ./PRD.md --verbose
```

Verbose logging provides detailed information about:

- Parsed CLI arguments
- Scope resolution
- Agent invocations
- Session state changes
- Error stack traces

**Validate PRD First:**

```bash
npm run dev -- --prd ./PRD.md --validate-prd
```

This checks PRD syntax and structure before running the full pipeline.

**Dry Run Preview:**

```bash
npm run dev -- --prd ./PRD.md --dry-run
```

Shows what would be executed without actually running agents.

**Bypass Cache:**

```bash
npm run dev -- --prd ./PRD.md --no-cache
```

Forces regeneration of all PRPs if you suspect cached content is stale.

**Check Session State:**

```bash
# Session files are stored in plan/ directory
ls -la plan/
```

Each session has a unique ID and contains:

- `session.json` - Session state
- `tasks.json` - Task backlog
- `ERROR_REPORT.md` - Error details (if failures occurred)

---

## See Also

- **[README.md](../README.md)** - Project overview and quick start
- **[Installation Guide](./INSTALLATION.md)** - Setup instructions for the development environment
- **[Configuration Reference](./CONFIGURATION.md)** - Environment variables and configuration options
- **[Quick Start Tutorial](./INSTALLATION.md)** - Get started in under 5 minutes
- **[User Guide](./user-guide.md)** - Advanced usage patterns and workflows
