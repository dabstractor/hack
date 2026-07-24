# Architecture Findings — Session 008 Delta

## Project Overview
**Project:** hacky-hack — Autonomous PRP Development Pipeline  
**Stack:** TypeScript (Node 20+, ESM), Vitest, Groundswell agent framework, Commander CLI  
**Entry:** `src/index.ts` → `parseCLIArgs()` → `new PRPPipeline(...)` → `.run()`  
**Binary:** `hack` / `npm run pipeline` (`tsx src/index.ts`)

## Key Codebase Architecture

### Data Flow (Current State)
```
PRD.md (raw entry file)
  → SessionManager.initialize()
    → hashPRD(prdPath) [session-utils.ts:235] — reads RAW file, SHA-256
    → findSessionByHash(sessionHash) — scan plan/{seq}_{hash} dirs
    → if found: loadSession(path) — reads tasks.json + prd_snapshot.md
    → if not found: createSessionDirectory + readFile(prdPath) RAW → write prd_snapshot.md
  → SessionState.prdSnapshot (RAW string)
    → decomposePRD() → createArchitectPrompt(prdContent)
    → runQACycle() → BugHuntWorkflow(prdContent)
    → handleDelta() → DeltaAnalysisWorkflow(oldPRD, newPRD)
```

### Key File Inventory (with line counts)
| File | Lines | Role |
|------|-------|------|
| `src/core/session-manager.ts` | 1444 | Session lifecycle, hash, snapshot, delta |
| `src/core/session-utils.ts` | 836 | hashPRD, atomicWrite, writeTasksJSON, readTasksJSON |
| `src/core/task-orchestrator.ts` | ~1170 | Execution loop, commit, recovery hook |
| `src/core/research-queue.ts` | 488 | Flat maxSize=3 concurrency pool |
| `src/core/prd-differ.ts` | 618 | Structural diffing (non-LLM) |
| `src/core/tasks-json-recovery.ts` | 247 | PATH A/B/C recovery |
| `src/core/models.ts` | ~1850 | Zod schemas, Subtask/Task/Status types |
| `src/config/constants.ts` | 276 | MODEL_NAMES, env vars, timeout defaults |
| `src/config/environment.ts` | ~230 | getModel(), configureEnvironment() |
| `src/config/types.ts` | ~230 | ModelTier, AgentHarness types |
| `src/agents/agent-factory.ts` | 329 | createBaseConfig + 4 persona factories |
| `src/agents/prompts.ts` | ~1050 | System prompts (TASK_BREAKDOWN, PRP_BLUEPRINT, etc.) |
| `src/utils/git-commit.ts` | 218 | smartCommit (single-phase) |
| `src/utils/retry.ts` | 765 | retry, retryAgentPrompt, withAgentDeadline |
| `src/workflows/prp-pipeline.ts` | ~2082 | Main pipeline orchestrator |
| `src/workflows/bug-hunt-workflow.ts` | 537 | QA bug hunt + TEST_RESULTS.md |
| `src/workflows/delta-analysis-workflow.ts` | 195 | LLM delta analysis (JSON output) |
| `src/workflows/fix-cycle-workflow.ts` | 620 | Bugfix iterative fix→retest loop |
| `src/cli/index.ts` | ~963 | CLI parsing, 5 subcommands |
| `src/tools/bash-mcp.ts` | ~240 | Bash execution, SIGTERM→SIGKILL |

## Critical Cross-Cutting Findings

### 1. Subtask Model Has No `prd_selectors` Field
`Subtask` interface (`models.ts:273-337`) has: `id`, `type`, `title`, `status`, `story_points`, `dependencies`, `context_scope`. No `prd_selectors` field exists. `SubtaskSchema` (`models.ts:360-381`) mirrors this exactly.

### 2. Status Type Already Includes `Ready`
`Status` (`models.ts:175-185`) = `Planned | Researching | Ready | Implementing | Retrying | Complete | Failed | Obsolete`. The `Ready` status EXISTS in the type but the recovery code comment says "There is NO Ready status" — the recovery code doesn't use it but the type permits it.

### 3. No File Locking Anywhere
`atomicWrite` (session-utils.ts:99) uses temp+rename but NO mutex/flock. Concurrent `writeTasksJSON` calls from parallel executors + background research can lose updates. `session-manager.ts` batches in-memory (`#pendingUpdates`) then `flushUpdates()` writes once, but the background research supervisor (to be added) would bypass this batching.

### 4. No Cleanup Agent Persona
`agent-factory.ts` has 4 personas: `architect`, `researcher`, `coder`, `qa`. No `cleanup` persona. The two-phase commit requires a new cleanup agent. No `stagecoach` code exists — `smartCommit` takes a pre-formatted message and does single `gitAdd` + `gitCommit`.

### 5. hashPRD Called 3-4× Per Init
Call sites: `session-manager.ts:294` (initialize), `session-manager.ts:624` (createDeltaSession), `session-manager.ts:1383` (static find-by-hash), plus internally in `createSessionDirectory`. Resolution must be cached or threaded to avoid 3-4× expansion.

### 6. Dead `snapshotPRD()` and Dead `DELTA_PRD_PROMPT`
- `snapshotPRD()` (session-utils.ts:691-778) has ZERO callers — inline `writeFile` at `session-manager.ts:473` is the live path.
- `DELTA_PRD_PROMPT` (prompts.ts:710) instructs writing `delta_prd.md` but is imported by NO workflow. Active delta path is `DELTA_ANALYSIS_PROMPT` → structured JSON.

### 7. No stdin-Aware Retry, No Exit-Code Retry
PRD references `run_with_retry`/`run_with_retry_stdin` (snake_case) — these DO NOT EXIST. Actual API: `retry<T>()`, `retryAgentPrompt()`, `retryMcpTool()`, `withAgentDeadline()`. No exit-code-based retry logic exists; retryability is decided by `isTransientError()`.

### 8. BashToolResult Does Not Surface killed/timedOut
`BashToolResult` exposes `{success, stdout, stderr, exitCode, error}` — internal `timedOut`/`killed` flags are NOT surfaced. Watchdog-kill (exit 124) detection requires adding these fields.

### 9. PRPPipeline Constructor Takes 23 Positional Args
`src/index.ts:233` passes 23 args positionally. Adding any constructor param requires updating: constructor, CLIArgs interface, parseCLIArgs validation, and main() call site.

## Environment Configuration
- `.env.example` documents: `ZAI_API_KEY`, `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `PRP_API_KEY`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_DEFAULT_OPUS/SONNET/HAIKU_MODEL`, `API_TIMEOUT_MS`, `RESEARCH_QUEUE_CONCURRENCY`
- NOT documented but used at runtime: `RESEARCH_TIMEOUT`, `ISSUE_RETRY_MAX`, `PRP_AGENT_HARNESS`
- Missing entirely (to be added): `PRD_INCLUDE_MAX_DEPTH`, `PRD_INCLUDE_MARKERS`, `PARALLEL_RESEARCH`, `RESEARCH_DEPTH`, `COMMIT_RETRY_MAX`, `COMMIT_RETRY_DELAY`, `VALIDATION_AGENT`, `VALIDATION_TIMEOUT`

## Test Infrastructure
- **Framework:** Vitest (`vitest.config.ts`)
- **Setup:** `tests/setup.ts`
- **Run:** `npm test` / `npm run test:run`
- **Pattern:** `*.test.ts` co-located or in `tests/`
- Tests use mocks for Groundswell agents, file system operations