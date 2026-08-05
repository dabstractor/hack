# Bootstrap Flow & `process.cwd()` / Repo-Root Usage

Scout findings for the `hack` CLI (TypeScript). Every claim below is backed by an exact `file:line` reference.

---

## 1. Bootstrap ordering in `src/index.ts` `main()`

`main()` is declared at `src/index.ts:110` and invoked via `void main().then(...).catch(...)` (≈ line 368).

| # | Step | Line | Notes |
|---|------|------|-------|
| 1 | `parseCLIArgs()` | **112** | First thing. May exit on validation failure. |
| 2 | Subcommand dispatch (early `return`) | 113–119 | If `'subcommand' in parseResult` → return 0. |
| 3 | `setupGlobalHandlers(args.verbose)` | **125** | uncaughtException / unhandledRejection. |
| 4 | `configureEnvironment()` | **128** | CRITICAL: before any API op. NO chdir before this. |
| 5 | `getLogger('App', {...})` | 131–135 | Root logger. |
| 6 | dry-run early return | 143–155 | Credential-free. |
| 7 | validate-prd early return | 157–196 | Credential-free. |
| 8 | `configureHarness()` | **208** | After configureEnvironment + local returns. |
| 9 | `await runAuthPreflight()` | **213** | §9.2.7 fail-fast. |
| 10 | `await ensureHarnessInitialized()` | **218** | Initialize harness. |
| 11 | `new PRPPipeline(...)` | 245 | |
| 12 | `await pipeline.run()` | 258 | |

**`main()` itself NEVER calls `process.cwd()` directly.** First implicit cwd dependency: `existsSync(options.prd)` in parseCLIArgs post-parse validation (~line 764). First explicit `resolve('plan')`/`resolve('PRD.md')` in subcommand actions.

---

## 2. `smartCommit` in `src/utils/git-commit.ts`

- **Defined:** `src/utils/git-commit.ts:504`
- **`const repoRoot = process.cwd();`** — **line 553**
- Comment (548-552): git ops run at REPO ROOT (cwd), NOT sessionPath.
- Consumers: `gitStatus` (:556), `gitAdd` (:586), `restore_critical_files` (:600), `gitDiff` (:609), `gitCommit` (:662)
- Callers: `task-orchestrator.ts` (~1060 survival, ~1116 post-cleanup)

---

## 3. `validateRepositoryPath` in `src/tools/git-mcp.ts`

**Lines 202-213:**
```ts
async function validateRepositoryPath(path?: string): Promise<string> {
  const repoPath = resolve(path ?? process.cwd());
  if (!existsSync(repoPath)) throw new Error(`Repository path not found: ${repoPath}`);
  const gitDir = join(repoPath, '.git');
  if (!existsSync(gitDir)) throw new Error(`Not a git repository: ${repoPath}`);
  return realpathSync(repoPath);
}
```
- Uses `existsSync` — **true for BOTH directory AND file** (.git file accepted for worktrees/submodules).
- **NO upward traversal** — checks only the exact path given or cwd.
- Callers: every git-mcp export (`gitStatus` :223, `gitDiff` :272, `gitAdd` :302, `gitCommit` :354, etc.)

---

## 4. `process.cwd()` in cleanup-runner.ts and task-orchestrator.ts

### cleanup-runner.ts
- `:40` — JSDoc only (`/** Git repo root = process.cwd(). */`)
- `:41` — `readonly repoRoot: string` (field on CleanupContext)
- **NO direct `process.cwd()` call** — receives repoRoot via context from caller.

### task-orchestrator.ts
- **`:1087`** — `const repoRoot = process.cwd();` → cleanup context
- **`:1242`** — `{ ..., repoPath: process.cwd() }` → recoverTasksJson opts
- **`:1323`** — `const repoPath = process.cwd();` → #checkHeadComplete

---

## 5. ALL `process.cwd()` and cwd-relative resolve sites

### Direct `process.cwd()` calls (runtime)
| file:line | Context |
|-----------|---------|
| `src/tools/git-mcp.ts:203` | validateRepositoryPath |
| `src/tools/filesystem-mcp.ts:400` | fast-glob cwd |
| `src/utils/git-commit.ts:553` | smartCommit |
| `src/core/task-orchestrator.ts:1087` | cleanup context |
| `src/core/task-orchestrator.ts:1242` | recoverTasksJson |
| `src/core/task-orchestrator.ts:1323` | #checkHeadComplete |
| `src/core/tasks-json-recovery.ts:261` | `opts?.repoPath ?? process.cwd()` |
| `src/agents/prp-executor.ts:550` | BashMCP cwd |
| `src/agents/prp-generator.ts:670` | PRP-gen helper |
| `src/utils/prd-validator.ts:244` | error message |
| `src/utils/full-test-suite-runner.ts:231` | `projectRoot ?? process.cwd()` |
| `src/utils/single-test-runner.ts:217` | `projectRoot ?? process.cwd()` |
| `src/utils/prd-validation-executor.ts:170` | `projectRoot ?? process.cwd()` |
| `src/utils/cli-help-executor.ts:157` | `projectRoot ?? process.cwd()` |
| `src/utils/build-logger.ts:158` | `projectRoot ?? process.cwd()` |
| `src/utils/eslint-result-parser.ts:364` | path normalization |
| `src/utils/eslint-error-verifier.ts:204,253` | path normalization (×2) |
| `src/utils/package-json-updater.ts:446` | `path.join(process.cwd(), 'package.json')` |
| `src/utils/package-json-syntax-verifier.ts:182` | package.json path |
| `src/utils/package-json-reader.ts:252` | package.json path |
| `src/utils/verify-groundswell-version.ts:346` | node_modules path |
| `src/workflows/validation-workflow.ts:304` | BashMCP cwd |
| `src/workflows/prp-pipeline.ts:1844` | `new ValidationWorkflow(..., process.cwd())` |

### cwd-relative `resolve('PRD.md')` / `resolve('plan')` sites
| file:line | Code |
|-----------|------|
| `src/cli/index.ts:481-482` | `resolve('plan')`, `resolve('PRD.md')` (artifacts) |
| `src/cli/index.ts:540-541` | (cache) |
| `src/cli/index.ts:565` | `resolve('plan')` (task/status) |
| `src/cli/commands/validate-state.ts:86-87` | constructor defaults |
| `src/cli/commands/inspect.ts:147-148` | constructor defaults |
| `src/cli/commands/cache.ts:70-71` | constructor defaults |
| `src/cli/commands/artifacts.ts:173-174` | constructor defaults |
| `src/core/session-utils.ts:630` | createSession default |
| `src/core/session-manager.ts:279,1508,1571,1615` | constructor/method defaults |
| `src/workflows/prp-pipeline.ts:299,385` | planDir default |

---

## 6. No existing repo-root resolution logic

**None exists.** No `findRepoRoot`, `repositoryRoot`, `walkUp`, `findUp`, upward `.git` traversal, or `git rev-parse --show-toplevel` anywhere in `src/`.

---

## 7. No INVOCATION_CWD / captured-cwd variable

**None exists.** `process.cwd()` is called inline at each use site. No snapshot taken at boot. No `process.chdir` call in `src/`.

---

## 8. Subcommand registration pattern (src/cli/index.ts)

**`task` command** (lines 727-734):
```ts
program.command('task')
  .description('Display and query pipeline tasks')
  .argument('[action]', 'Action: (none), next, status', '')
  .option('-f, --file <path>', 'Override tasks.json file path')
  .option('--session <hash>', 'Inspect specific session by hash')
  .option('-o, --output <format>', 'Output format (table, json)', 'table')
  .action(taskAction);
```

**`status` alias** (lines 737-744) — separate `.command('status')` reusing same `taskAction` handler.

**`cache` command** (lines 531-553) — closest template for adding `config`:
```ts
program.command('cache')
  .description('Cache management operations')
  .argument('[action]', 'Action: stats, clean, clear', 'stats')
  .option('--force', ...)
  .option('--dry-run', ...)
  .option('-o, --output <format>', ...)
  .option('--session <id>', ...)
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

Command classes live in `src/cli/commands/`. No `config.ts` exists yet.