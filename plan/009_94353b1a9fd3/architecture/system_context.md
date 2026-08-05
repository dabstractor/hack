# Session 009 — Architecture Context (Delta: `.hack` Config, Repo-Root Resolution, Breakdown-in-Progress)

> Consolidated research findings grounded in the codebase at HEAD. These findings
> inform the `tasks.json` breakdown and feed downstream PRP agents.

---

## 1. Project Overview

**Project:** `hacky-hack` — the `hack` CLI / Autonomous PRP Development Pipeline.
A TypeScript (Node 20+, ESM) agentic software-development system that reads a PRD,
decomposes it into a strict Phase→Milestone→Task→Subtask hierarchy, and executes
each subtask via LLM agents (Groundswell framework).

**Entry point:** `src/index.ts:main()` (line 110), invoked via `void main().then(...).catch(...)` (line ~368).

**Key directories:**
- `src/config/` — constants, environment, harness, endpoint-guard, types
- `src/cli/` — Commander-based CLI parser (`index.ts`) + command classes (`commands/`)
- `src/core/` — orchestrator, session manager, task patcher, file lock, recovery
- `src/tools/` — git-mcp, filesystem-mcp, bash-mcp
- `src/utils/` — git-commit, logger, validators, runners
- `src/workflows/` — PRP pipeline, validation/fix-cycle/bug-hunt workflows
- `src/agents/` — agent factory, prompts, PRP generator/executor
- `docs/` — ARCHITECTURE.md, CLI_REFERENCE.md, CONFIGURATION.md, etc.

---

## 2. Phase 1 — Repository Root Resolution (§9.8): Current State

### 2.1 Bootstrap Ordering (confirmed)

`src/index.ts:main()` executes in this exact order (all line numbers verified):

| Step | Code | Line | Notes |
|------|------|------|-------|
| 1 | `parseCLIArgs()` | **112** | Parses argv; subcommands exit during parse. `--help`/`--version` exit here. |
| 2 | Subcommand early return | 113–119 | If `subcommand` in result, returns 0. |
| 3 | `setupGlobalHandlers(args.verbose)` | 125 | uncaughtException/unhandledRejection |
| 4 | `configureEnvironment()` | **128** | Maps ANTHROPIC_AUTH_TOKEN→API_KEY, resolves base URL. **NO chdir before this.** |
| 5 | `getLogger(...)` | 131–135 | Root pino logger. |
| 6 | dry-run early return | 143–155 | Credential-free. |
| 7 | validate-prd early return | 157–196 | Credential-free. |
| 8 | `configureHarness()` | **208** | Resolves PRP_AGENT_HARNESS, validates, registers PiHarness. |
| 9 | `await runAuthPreflight()` | **213** | §9.2.7 fail-fast credential check. |
| 10 | `await ensureHarnessInitialized()` | **218** | Initialize harness singleton. |
| 11 | `new PRPPipeline(...)` | 245 | |
| 12 | `await pipeline.run()` | 258 | |

**KEY FINDING:** There is **no `process.chdir()` call, no upward `.git` traversal, and no `INVOCATION_CWD` capture** anywhere in the codebase. `process.cwd()` is read fresh inline at every downstream use site.

### 2.2 `process.cwd()` / cwd-relative resolve sites (~30 total)

**Hardcoded `const repoRoot = process.cwd()`:**
- `src/utils/git-commit.ts:553` — `smartCommit()` — git ops run at repo root
- `src/core/task-orchestrator.ts:1087` — cleanup context repoRoot
- `src/core/task-orchestrator.ts:1242` — recoverTasksJson opts
- `src/core/task-orchestrator.ts:1323` — #checkHeadComplete

**`process.cwd()` fallback patterns (`projectRoot ?? process.cwd()`):**
- `src/agents/prp-executor.ts:550`, `src/workflows/validation-workflow.ts:304`
- `src/utils/full-test-suite-runner.ts:231`, `src/utils/single-test-runner.ts:217`
- `src/utils/prd-validation-executor.ts:170`, `src/utils/cli-help-executor.ts:157`
- `src/utils/build-logger.ts:158`, `src/core/tasks-json-recovery.ts:261`

**cwd-relative `resolve('PRD.md')` / `resolve('plan')`:**
- `src/cli/index.ts:481-482` (artifacts), `:540-541` (cache), `:565` (task/status)
- `src/cli/commands/{inspect,validate-state,cache,artifacts}.ts` constructor defaults
- `src/core/session-manager.ts:279,1508,1571,1615`
- `src/core/session-utils.ts:630`
- `src/workflows/prp-pipeline.ts:299,385`

**IMPLICATION:** The single-bootstrap-`chdir` strategy (§9.8.3) means **zero per-site changes** are needed. After `process.chdir(repoRoot)`, every `resolve(...)` and `process.cwd()` naturally resolves to the repo root.

### 2.3 `validateRepositoryPath` (§9.8.2 prerequisite)

`src/tools/git-mcp.ts:202-213`:
```ts
async function validateRepositoryPath(path?: string): Promise<string> {
  const repoPath = resolve(path ?? process.cwd());
  if (!existsSync(repoPath)) throw new Error(`Repository path not found: ${repoPath}`);
  const gitDir = join(repoPath, '.git');
  if (!existsSync(gitDir)) throw new Error(`Not a git repository: ${repoPath}`);
  return realpathSync(repoPath);
}
```
- Uses `existsSync`, which is true for **both** directory and file — so `.git` as a **file** (worktree/submodule `gitdir:` pointer) is already accepted.
- **NO upward traversal** — checks only the exact given path.
- This is the chokepoint for ALL git operations (gitStatus, gitAdd, gitCommit, etc.).

**The new `resolveRepositoryRoot` in `src/utils/repo-root.ts` should NOT modify this function** — after `process.chdir(repoRoot)`, the default `process.cwd()` resolves correctly. But the new resolver's `.git` detection logic should mirror the dir-or-file acceptance.

### 2.4 Subcommand Registration Pattern (for adding `config`)

The `cache` subcommand (`src/cli/index.ts:531-553`) is the closest template:
```ts
program
  .command('cache')
  .description('Cache management operations')
  .argument('[action]', 'Action: stats, clean, clear', 'stats')
  .option('--force', 'Force action without confirmation', false)
  .option('--dry-run', 'Show what would be done without executing', false)
  .option('-o, --output <format>', 'Output format: table, json', 'table')
  .option('--session <id>', 'Session ID')
  .action(async (action, options) => {
    try {
      const planDir = resolve('plan');
      const prdPath = resolve('PRD.md');
      const cacheCommand = new CacheCommand(planDir, prdPath);
      await cacheCommand.execute(action, options);
      process.exit(0);
    } catch (error) { ... process.exit(1); }
  });
```
A new `config` subcommand + `src/cli/commands/config.ts` class should follow this pattern exactly.

### 2.5 `--repo-root` flag insertion point

The flag must be added to the root `program` option chain in `src/cli/index.ts:310-436`
(same location as `--prd`, `--scope`, etc.). It must be parsed by `parseCLIArgs()` and
exposed to `main()` so that the resolver can use it before `configureEnvironment()`.

The `ValidatedCLIArgs` interface (`src/cli/index.ts:~180`) and `CLIArgs` interface
(`:~100`) must gain a `repoRoot?: string` field.

---

## 3. Phase 2 — `.hack` Configuration File (§9.7): Current State

### 3.1 No App-Level Config File

**CONFIRMED:** There is no application-level config file loader today.
- `dotenv` is a **devDependency** only (`package.json:88`) — used in `tests/setup.ts:22-34` via dynamic `import('dotenv')`, never in `src/`.
- No TOML parser is a direct dependency.
- `smol-toml@1.6.1` IS present in `node_modules` as a **transitive** dep of `markdownlint-cli`, but it is NOT listed in `package.json` dependencies. It must be added explicitly.
- All defaults live in `src/config/constants.ts` (1271 lines).

### 3.2 TOML Parser Choice

**Recommendation: `smol-toml`** — already present transitively, TOML 1.0 compliant, ESM-native, BSD-3-Clause, small/fast. Must be promoted to a direct `dependency` in `package.json`.

API: `import { parse, stringify } from 'smol-toml'`

### 3.3 Config System Architecture

```
src/config/constants.ts    ← ALL env-var names + defaults + getters
src/config/environment.ts  ← configureEnvironment() (process.env side effects)
src/config/harness.ts      ← configureHarness(), runAuthPreflight(), resolveApiKeyForProvider()
src/config/endpoint-guard.ts ← endpoint validation
src/config/types.ts        ← ModelTier, error classes
```

**All numeric getter pattern:** `Number(process.env[X] ?? DEFAULT)` then fallback on `NaN`/`<=0`.

**Bootstrap data flow (current):**
1. `parseCLIArgs()` reads `process.env.*` into Commander `.default()` for 7 env-linked flags
2. `configureEnvironment()` maps auth tokens, resolves base URL → writes to `process.env`
3. `configureHarness()` resolves `PRP_AGENT_HARNESS`, registers PiHarness
4. `runAuthPreflight()` resolves provider key
5. Runtime getters (`getResearchTimeoutSeconds()`, etc.) read `process.env` lazily

**The `.hack` loader must insert BETWEEN `chdir` and `configureEnvironment()`** so that:
- Project files are read from repo root (post-chdir)
- Seeded `process.env` values are then overridden by `configureEnvironment()`/shell env (env-over-file rule)

### 3.4 Complete Schema Surface (§9.7.5)

All tunables map to constants.ts env-var names or CLI flags. Key mappings:

| Category | TOML key | Env var | CLI flag | constants.ts source |
|----------|----------|---------|----------|---------------------|
| Models | `[models] high/balanced/fast` | `PRP_MODEL_*` | — | `MODEL_ENV_VARS`, `MODEL_NAMES` |
| Endpoint | `[endpoint] base_url` | `PRP_API_BASE_URL` | — | `PRP_API_BASE_URL` |
| Harness | `[harness] name` | `PRP_AGENT_HARNESS` | — | `PRP_AGENT_HARNESS`, `DEFAULT_HARNESS` |
| Pipeline | `[pipeline] parallel_research` | `PARALLEL_RESEARCH` | `--parallel-research` | `PARALLEL_RESEARCH` |
| Pipeline | `[pipeline] research_depth` | `RESEARCH_DEPTH` | `--research-depth` | `RESEARCH_DEPTH` |
| Pipeline | `[pipeline] research_timeout_seconds` | `RESEARCH_TIMEOUT` | — | `RESEARCH_TIMEOUT` |
| Pipeline | `[pipeline] issue_retry_max` | `ISSUE_RETRY_MAX` | — | `ISSUE_RETRY_MAX` |
| Pipeline | `[pipeline] commit_format` | `PRP_COMMIT_FORMAT` | — | `PRP_COMMIT_FORMAT` |
| Commit | `[commit] retry_max` | `COMMIT_RETRY_MAX` | — | `COMMIT_RETRY_MAX` |
| Commit | `[commit] retry_delay_ms` | `COMMIT_RETRY_DELAY` | — | `COMMIT_RETRY_DELAY` |
| Commit | `[commit] retry_delay_cap_ms` | `COMMIT_RETRY_DELAY_CAP` | — | `COMMIT_RETRY_DELAY_CAP` |
| Commit | `[commit] classifier_retry_max` | `CLASSIFIER_RETRY_MAX` | — | `CLASSIFIER_RETRY_MAX` |
| Bug hunt | `[bug_hunt] finder_agent` | `BUG_FINDER_AGENT` | — | `BUG_FINDER_AGENT` |
| Bug hunt | `[bug_hunt] results_file` | `BUG_RESULTS_FILE` | — | (not in constants.ts — inline) |
| Bug hunt | `[bug_hunt] fix_scope` | `BUGFIX_SCOPE` | — | (not in constants.ts — inline) |
| Validation | `[validation] agent` | `VALIDATION_AGENT` | — | `VALIDATION_AGENT` |
| Validation | `[validation] timeout_seconds` | `VALIDATION_TIMEOUT` | — | `VALIDATION_TIMEOUT` |
| Distributed PRD | `[distributed_prd] include_max_depth` | `PRD_INCLUDE_MAX_DEPTH` | — | `PRD_INCLUDE_MAX_DEPTH` |
| Distributed PRD | `[distributed_prd] include_markers` | `PRD_INCLUDE_MARKERS` | — | `PRD_INCLUDE_MARKERS` |
| Tasks lock | `[tasks_lock] stale_ms/timeout_ms/poll_ms` | `TASKS_LOCK_*` | — | `TASKS_LOCK_*` |
| Concurrency | `[concurrency] research_queue` | `RESEARCH_QUEUE_CONCURRENCY` | `--research-concurrency` | (inline in cli/index.ts) |
| Concurrency | `[concurrency] parallelism` | — | `--parallelism` | (inline) |
| API | `[api] timeout_ms` | `API_TIMEOUT_MS` | — | (not currently defined) |
| Monitor | `[monitor] task_interval` | `MONITOR_TASK_INTERVAL` | `--monitor-task-interval` | (inline) |
| Monitor | `[monitor] interval_ms` | — | `--monitor-interval` | (inline) |
| Monitor | `[monitor] enabled` | — | `--no-resource-monitor` | (inline) |
| CLI | `[cli] mode` | — | `--mode` | (inline) |
| CLI | `[cli] scope` | — | `--scope` | (inline) |
| CLI | `[cli] log_level` | `HACKY_LOG_LEVEL` | `--log-level` | (inline) |
| CLI | `[cli] machine_readable` | — | `--machine-readable` | (inline) |
| CLI | `[cli] continue_on_error` | — | `--continue-on-error` | (inline) |
| CLI | `[cli] cache_enabled` | — | `--no-cache` | (inline) |
| CLI | `[cli] max_tasks` | — | `--max-tasks` | (inline) |
| CLI | `[cli] max_duration_ms` | — | `--max-duration` | (inline) |

### 3.5 Secrets Policy Implementation Notes

The secret-bearing keys to refuse in committable `.hack`:
- `[auth] override_key` (maps to `PRP_API_KEY` in `.hack.local`)
- `[auth] zai_api_key`, `[auth] anthropic_api_key`, `[auth] anthropic_auth_token`
- Any key ending in `_key`/`_token`/`_secret`/`_password`

These should be detected during parsing/validation (Phase 2, Task 2.1.2).

---

## 4. Phase 3 — Breakdown-in-Progress (§5.3): Current State

### 4.1 The `taskAction` handler

`src/cli/index.ts:554-723` — shared by `task` and `status` subcommands.

**Flow:**
1. Lines 561-565: Dynamic imports (`readFile`, `SessionManager`, `findLatestBugfixTasksFile`)
2. Lines 577-612: Tasks file resolution:
   - `--file` override → `resolve(options.file)` (explicit path, hard error if missing)
   - Else: resolve session (`--session` prefix match or `findLatestSession`)
   - Then: bugfix child (`findLatestBugfixTasksFile`) → main `tasks.json` fallback
3. Lines 614-620: Print `sourceNote` to stderr (suppressed for `--output json`)
4. Line 622: `const content = await readFile(tasksFile, 'utf-8')` — **NO existence check before this**
5. Line 623: `const data = JSON.parse(content)` — raw, no Zod validation
6. Lines 625-715: Three action branches (`next`, `status`, default list)
7. Line 716: `process.exit(0)` on success
8. Lines 717-723: Catch block → `logger().error(...)` + `process.exit(1)`

**CRITICAL GAP:** There is **no check** whether `tasksFile` exists before `readFile`.
When `tasks.json` is absent (breakdown-in-progress), `readFile` throws `ENOENT`,
which propagates to the catch block and exits 1 with a scary error.

### 4.2 Session Discovery Primitives

- `SessionManager.findLatestSession(planDir)` (`session-manager.ts:1573-1596`): returns `null` when no sessions, returns `SessionMetadata` object when found.
- `SessionManager.listSessions(planDir)` (`session-manager.ts:1497-1555`): returns `SessionMetadata[]`, empty array when no sessions.
- `findLatestBugfixTasksFile(sessionPath)` (`session-utils.ts:916-970`): returns path string or `null`.

### 4.3 Distinction from §5.1 Corruption Recovery

`src/core/tasks-json-recovery.ts` is a **runtime** recovery path triggered after every agent run. It deals with a **present-but-corrupt** file (parse/validation failure), restoring from git history. It is completely distinct from the breakdown-in-progress case where the file is simply **absent**.

The breakdown-in-progress fix is in the **read-only CLI path** only (`taskAction`), not the pipeline path.

### 4.4 Insertion Point for Breakdown-in-Progress Detection

The detection must be inserted **after** the `else` branch resolves `tasksFile` (line ~609-610) and **before** the `readFile` call (line 622). The `--file` override branch must NOT be softened.

The check: `if (!existsSync(tasksFile) && existsSync(sessionPath))` → breakdown-in-progress.

---

## 5. External Dependencies

| Dependency | Status | Purpose |
|-----------|--------|---------|
| `smol-toml` | Present transitively (via `markdownlint-cli`); **must add to `dependencies`** | TOML 1.0 parsing for `.hack` |
| `commander` | Already in deps | CLI parsing (subcommand registration for `config`) |
| `dotenv` | devDep only | NOT used in `src/` — `.hack` loader is NOT dotenv-based |

No new runtime dependency is needed beyond promoting `smol-toml`.

---

## 6. Documentation Files for Mode B Sync

| File | Current Content | Delta Impact |
|------|----------------|--------------|
| `README.md` | 34KB, extensive | Add "Configuration" section (`.hack`, `hack config`), "Running from anywhere" note |
| `docs/ARCHITECTURE.md` | 44KB | Add bootstrap-layer section (parseCLIArgs → repo-root → .hack load → env → pipeline) |
| `docs/CONFIGURATION.md` | 40KB | Add `.hack` as primary config mechanism, schema table, env-over-file rule |
| `docs/CLI_REFERENCE.md` | 20KB | Add `--repo-root` flag, `hack config` subcommand, breakdown-in-progress exit code |

---

## 7. Risk Assessment

1. **Bootstrap ordering sensitivity:** The repo-root resolution + `.hack` load must be inserted at exactly the right point (after `parseCLIArgs()`, before `configureEnvironment()`). Any deviation breaks the precedence model.

2. **Existing `process.cwd()` assumption:** The entire codebase assumes `process.cwd() === repoRoot`. The single-`chdir` strategy preserves this invariant, but if any code captures `process.cwd()` before the `chdir` and uses it after, it would break. The research confirms no such pre-capture exists.

3. **`smol-toml` API:** `parse(string)` returns a plain object; `stringify(object)` serializes. Key names are case-sensitive. TOML 1.0-compliant. No BOM handling built-in (the loader must detect/reject BOM manually).

4. **CLI flag dual-surface:** Several env vars are both in `constants.ts` getters AND inline in CLI `.default(process.env.X ?? y)`. The TOML schema must seed the env var (which the CLI `.default()` then reads), avoiding duplicate config surfaces.

5. **§9.6 logging:** All warnings/errors from config validation go to stderr synchronously via `console.warn`/`console.error` (NOT pino), because pino is configured AFTER config load. This mirrors the existing `_deprecatedWarned` pattern in `environment.ts`.