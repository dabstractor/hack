# Delta Impact Analysis — Session 005

The driver for this session is `delta_prd.md` (a purely additive diff). Four cohesive
feature clusters, all under one theme: **self-healing of the execution loop and state
layer**. No new subsystems — enhancements to **existing** orchestrator/state/retry/prompts
components.

## R1 — Background research deadline & fallback (PRD §4.2, §9.2.2, §9.3.2)

### Current state
`src/core/research-queue.ts` `ResearchQueue`:
```ts
class ResearchQueue {
  constructor(sessionManager, maxSize=3, noCache=false, cacheTtlMs=86400000)
  async enqueue(task, backlog): Promise<void>          // pushes to queue[], calls processNext()
  async processNext(backlog): Promise<void>             // shifts, calls prpGenerator.generate(); fire-and-forget
  isResearching(taskId): boolean
  getPRP(taskId): PRPDocument | null                     // cache lookup
  async waitForPRP(taskId): Promise<PRPDocument>         // returns cached OR awaits in-flight promise
}
```
- `researching: Map<string, Promise<PRPDocument>>` — in-flight work.
- `results: Map<string, PRPDocument>` — completed cache.
- **No timeout. No polling. No abandonment state.** `waitForPRP` awaits the in-flight
  promise directly — a hung `prpGenerator.generate()` hangs `waitForPRP` forever.

### What must change
- Add `RESEARCH_TIMEOUT` env var (name const + `DEFAULT_RESEARCH_TIMEOUT_SECONDS = 300`)
  in `src/config/constants.ts`, read at the consumer (mirror `PRP_AGENT_HARNESS`).
- Wrap `waitForPRP` (or the in-flight promise) in a deadline. On expiry, **abandon** the
  in-flight research and surface an abandonment state so the orchestrator can re-research
  **synchronously, inline**. It must never block indefinitely.
- Orchestrator polls for completion (process liveness **and** presence of the PRP artifact).
- Wire the synchronous fallback into `TaskOrchestrator.executeSubtask` (the agent-run site).

### Tests touched
`tests/unit/core/research-queue.test.ts`, `tests/integration/core/research-queue.test.ts`,
`tests/unit/core/task-orchestrator.test.ts`.

## R2 — Issue-driven re-planning loop (PRD §4.5, §9.2.2, §9.3.2)

### Current state
- `src/agents/prp-executor.ts`: public `ExecutionResult` = `{ success: boolean, ... }`
  (boolean only). BUT the **internal** `ExecuteResult` (line 147) already carries
  `result: 'error' | 'success' | 'issue'` + `message`. Today, `if (coderResult.result !== 'success')`
  collapses **both** `error` and `issue` into `{ success: false }` (line 309). The `issue`
  signal is **parsed but discarded** — never surfaced.
- `src/agents/prp-runtime.ts`: `PRPRuntime.executeSubtask(subtask, backlog): Promise<ExecutionResult>`
  — returns the executor's boolean result.
- `src/core/task-orchestrator.ts` line 712-747: `executeWithRetry(...)` → on
  `result.success` → `Complete`, else → `Failed`. No `issue` branch exists.
- `src/core/task-retry-manager.ts`: retries **transient infra errors** (transient/permanent
  classification, exponential backoff). This is **NOT** the re-planning loop — it is a
  different retry dimension. `ISSUE_RETRY_MAX` is orchestrator-level, bounded separately.

### What must change
1. **Executor:** surface the `issue` outcome through the public `ExecutionResult` — extend it
   to carry the tri-state (`success | fail | issue`) plus an issue message, instead of just
   `success: boolean`. Stop collapsing `issue` into `fail`.
2. **Feedback injection:** `createPRPBlueprintPrompt(task, backlog, codebasePath?)` gains an
   optional `issueFeedback?` param; inject `<issue_feedback>…</issue_feedback>` into the
   Researcher prompt. `PRPGenerator.generate` passes it through.
3. **Orchestrator flow (the core of §4.5):** on `issue`:
   (1) save message to `$SESSION_DIR/issue_feedback.md`;
   (2) delete the offending PRP so it can't be reused;
   (3) reset item to `Planned` (NOT `Failed`);
   (4) re-research with feedback injected;
   (5) bound by `ISSUE_RETRY_MAX` (default 3) before hard-fail.
   Keep the item's original ID + dependency links. Do NOT cancel background research on
   dependents (they block until the re-planned item completes).
4. **Config:** `ISSUE_RETRY_MAX` env var (name const + `DEFAULT_ISSUE_RETRY_MAX = 3`).

### `issue_feedback.md` protection
The delta_prd §6 confirms `issue_feedback.md` lives in `$SESSION_DIR/` root and is
**implicitly protected** by the existing catch-all rule ("Any file directly in
`$SESSION_DIR/` root"). No change to the explicit Protected Files list is required.

### Tests touched
`tests/unit/agents/prp-executor.test.ts`, `tests/unit/agents/prp-runtime.test.ts`,
`tests/unit/agents/prp-generator.test.ts`, `tests/unit/agents/prompts/prp-blueprint-prompt.test.ts`,
`tests/unit/core/task-orchestrator.test.ts`.

## R3 — Documentation two-mode sync rule (PRD §6.1, §6.4) — PROMPT change

### Current state
- `TASK_BREAKDOWN_PROMPT` (HEREDOC in `src/agents/prompts.ts` line 33) — the system prompt
  fed to the Architect agent via `createArchitectPrompt()` (`src/agents/prompts/architect-prompt.ts`).
  It already encodes **implicit TDD** ("docs never a standalone subtask") but does **not** yet
  spell out the two-mode (Mode A `DOCS:` line / Mode B final task) rule.
- `PRP_BLUEPRINT_PROMPT` / `DELTA_PRD_PROMPT` (HEREDOCs in `src/agents/prompts.ts`) — Researcher /
  Change-Manager prompts. No doc-impact-declaration requirement yet.

### What must change
- Add the **two-mode rule** text to `TASK_BREAKDOWN_PROMPT`: Mode A = `DOCS:` line inside the
  implementing subtask's `context_scope`; Mode B = a final "Sync changeset-level documentation"
  task depending on all implementing subtasks. Mirror the existing implicit-TDD framing.
- Add a **doc-impact declaration** requirement to the delta/blueprint prompt so each affected
  delta item declares its doc impact at authoring time.

> This requirement **is** the doc-sync mechanism — there is no standalone runtime file to update.
> Changeset-level docs for *this* delta itself are handled by the Mode B final task (P5.M3).

## R4 — `tasks.json` Protection & Smart Recovery (PRD §5.1, §9.3.2)

### Current state
- `src/core/state-validator.ts`: `validateBacklogState(backlog)`, `createBackup(tasksPath)`,
  `repairBacklog(backlog, validation, backupPath)` (mutates in place, does NOT write to disk).
  Caller pattern (see `src/cli/commands/validate-state.ts`): readTasksJSON → validate → backup → repair → write.
- `src/core/task-orchestrator.ts`: `setStatus()` → `sessionManager.updateItemStatus()` →
  `refreshBacklog()` (re-reads **in-memory** `currentSession.taskRegistry`, NOT disk). Agent
  runs happen in `executeSubtask` between `setStatus('Implementing')` and
  `setStatus('Complete'|'Failed')` + `flushUpdates()`.
- `src/utils/git-commit.ts`: `smartCommit`, `filterProtectedFiles`. `PROTECTED_FILES` (not exported) = `['tasks.json','PRD.md','prd_snapshot.md']`.
- `src/tools/git-mcp.ts`: `gitStatus`/`gitDiff`/`gitAdd`/`gitCommit` only.
  **⚠️ NO file-history or file-restore utilities exist** (`gitLog`/`gitShow`/`gitRestore`/`gitCheckout`
  are absent). Building "restore from git history" requires NEW functions (simple-git provides
  `.log()`, `.show()`, `.checkout()`).
- `src/core/checkpoint-manager.ts`: persists **execution state** (PRP stage, validation results),
  NOT files. Not a file-restore mechanism.

### What must change
1. **Git history utilities (NEW):** add `git-mcp.ts` functions to read prior versions of a file
   from git history (`git.log` by path, `git.show` to fetch a prior blob) and restore it.
2. **Smart recovery (NEW module or extend state-validator):** after each agent run, re-read
   `tasks.json` from disk; re-apply **only** the legitimate status delta (the item just
   implemented/interrupted), discarding unauthorized mutations. On parse/validation failure,
   walk git history → restore last valid JSON → re-apply in-flight status changes on top.
   Preserve items in `Researching`/`Retrying` status (do NOT drop to `Planned`). Non-fatal + logged.
3. **Orchestrator integration:** call the recovery step after each agent invocation in
   `executeSubtask` (between the agent run and the commit / flushUpdates).

### Tests touched
`tests/unit/tools/git-mcp.test.ts`, `tests/unit/core/state-validator.test.ts` (may need creating —
no dedicated unit test today), `tests/unit/core/task-orchestrator.test.ts`,
`tests/integration/validate-state.test.ts`.

## NOT Affected (do not touch)

- Harness/provider/parity code (Session 004): `src/config/harness.ts`, `qualifyModel`/`getModel`,
  `HarnessProviderMismatchError`, `agent-factory.ts` harness field, parity tests.
- Delta-detection, task-patching (`src/core/{prd-differ,task-patcher}.ts`), bug-hunt/fix-cycle workflows.
- Protected-file rules, nested-execution guard (`src/utils/validation/execution-guard.ts`).
- `PRD.md` (human-owned, read-only) and Groundswell sources (external).
