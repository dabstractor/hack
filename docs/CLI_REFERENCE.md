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

**PRD Validation Only:**

```bash
npm run dev -- --prd ./PRD.md --validate-prd
```

Validates the PRD syntax and structure without running the pipeline. Exits with code 0 if valid, 1 if invalid.

---

## Options

### Required Options

| Option         | Type   | Default    | Description               |
| -------------- | ------ | ---------- | ------------------------- |
| `--prd <path>` | string | `./PRD.md` | Path to PRD markdown file |

### Execution Control

| Option            | Type   | Choices                          | Default  | Description                                  |
| ----------------- | ------ | -------------------------------- | -------- | -------------------------------------------- |
| `--mode <mode>`   | string | `normal`, `bug-hunt`, `validate` | `normal` | Execution mode                               |
| `--scope <scope>` | string | -                                | -        | Scope identifier (e.g., `P3.M4`, `P3.M4.T2`) |

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

### Boolean Flags

| Option                | Type    | Default | Description                                                   |
| --------------------- | ------- | ------- | ------------------------------------------------------------- |
| `--continue`          | boolean | false   | Resume from previous session                                  |
| `--dry-run`           | boolean | false   | Show plan without executing                                   |
| `--verbose`           | boolean | false   | Enable debug logging                                          |
| `--machine-readable`  | boolean | false   | Enable machine-readable JSON output                           |
| `--no-cache`          | boolean | false   | Bypass cache and regenerate all PRPs                          |
| `--continue-on-error` | boolean | false   | Treat all errors as non-fatal and continue pipeline execution |
| `--validate-prd`      | boolean | false   | Validate PRD and exit without running pipeline                |

**Flag Details:**

- **`--continue`**: Loads the previous session state and continues execution. Useful after interruptions or when iterating on failed tasks.

- **`--dry-run`**: Parses the PRD and validates the execution plan without running any agents. Displays what would be executed.

- **`--verbose`**: Enables detailed debug logging. Use when troubleshooting issues or understanding pipeline behavior.

- **`--machine-readable`**: Outputs results in JSON format for programmatic consumption. Useful for CI/CD integration.

- **`--no-cache`**: Forces regeneration of all PRPs even if cached versions exist. Use when PRD content or context has changed significantly.

- **`--continue-on-error`**: Treats all errors as non-fatal. The pipeline continues execution even when individual tasks fail. Useful for gathering maximum feedback.

- **`--validate-prd`**: Validates PRD structure and exits. Returns exit code 0 if valid, 1 if invalid. Equivalent to `--mode validate`.

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

- **2 (VALIDATION_ERROR)**: PRD validation failed when using `--validate-prd` or `--mode validate`. The validation report will show specific issues.

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
  echo "PRD validation failed"
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
