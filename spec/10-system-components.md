### 9.3 System Components (Groundswell Mapping)

#### 9.3.1 Pipeline Controller (`MainWorkflow`)

The entry point will be a class extending `Workflow` that manages the high-level lifecycle.

```typescript
import { Workflow, Step, ObservedState, Task } from 'groundswell';

class PRPPipeline extends Workflow {
  @ObservedState() sessionPath: string;
  @ObservedState() taskState: TaskRegistry;

  @Step()
  async initializeSession() {
    // Hash PRD, check for deltas, setup plan/ directory
  }

  @Task()
  async executePhase() {
    // Triggers the main loop
  }
}
```

#### 9.3.2 Task Orchestrator

Leverage Groundswell's hierarchical `@Task` feature.

- **Recursive Workflow**: Instead of a flat loop, the `TaskExecutor` can be a recursive workflow where each Phase/Milestone/Task is a sub-workflow.
- **Concurrency**: Use `@Task({ concurrent: true })` for "Parallel Research" where applicable (e.g., researching next tasks while current one executes).
- **Depth-Chained Research Queue**: The background supervisor researches a chain of up to `RESEARCH_DEPTH` items ahead while the current item executes, prefetching the next as each completes (§4.2). Each generation is wrapped in a deadline (`RESEARCH_TIMEOUT`); on expiry the queue abandons the in-flight research and the orchestrator re-researches the item synchronously.
- **Issue-Driven Re-planning**: The orchestrator treats a Coder Agent `issue` result as a signal to delete the stale PRP, reset the item to `Planned`, and re-research with the captured feedback injected, bounded by `ISSUE_RETRY_MAX` (§4.5).
- **`tasks.json` Restore**: After every agent run the orchestrator re-applies only the legitimate status delta and, on parse/validation failure, restores the last valid version from git history before re-applying (§5.1). Research statuses (`Researching`/`Ready`) are snapshotted from the working tree _before_ the revert and re-applied afterward using filesystem evidence (PRP.md/research/ existence), so they survive without depending on an in-memory supervisor index.
- **Watchdog kills are terminal:** Retry loops (the bash `run_with_retry` / `run_with_retry_stdin` and their Groundswell equivalents) MUST treat a watchdog kill (exit 124) as a hard failure — a hung process will simply re-hang, so churning retries is wrong. This applies to validation under `VALIDATION_TIMEOUT` (§4.4): a watchdog-killed validation aborts the run and is not retried.
- **Stateless single-shot invocations:** Agent calls that are stateless by nature (cleanup, mid-session task update, validation, post-validation fix, bug-finder, per-item PRP execution) MUST NOT create or resume sessions. They are single-shot or operate on freshly-built prompts, so enabling session persistence only creates orphaned sessions that serve no purpose (the bash equivalent is the `--no-session` flag).

#### 9.3.3 Agent Runtime & Personas

Agents are instantiated using Groundswell's `createAgent` factory or by extending the `Agent` class, and execute through the configured **harness** (default `pi` / pi.dev; `claude-code` optional — see §9.4).

- **Tooling**: Use `MCPHandler` to register local system tools. Tools execute locally through Groundswell regardless of the active harness; the harness only reports tool calls back.
  - `BashTool`: For executing validation scripts and git commands.
  - `FileTool`: For reading/writing PRPs and code.
  - `WebSearchTool`: For external documentation.
- **Prompt Delivery (no argv-size limit):** Prompts frequently embed the full PRD and can exceed 128 KB. They MUST be delivered to the agent as a programmatic message body (stdin/stream), never as an argv string — argv strings are capped by the kernel's `MAX_ARG_STRLEN` (131,072 bytes) and fail with a hard `E2BIG` that no wrapper can recover from. Any temp files backing these prompts MUST be cleaned up on both graceful and hard-killed (SIGTERM/SIGKILL/power-loss) exits. When a temp file backs a retry loop, it MUST be (re-)written on _every_ attempt: if the agent or the system cleans `/tmp` mid-run, a write-once temp file fails forever on every later retry, whereas re-writing is cheap and makes retries resilient.

#### 9.3.4 Prompt Engineering (From PROMPTS.md)

The critical prompts from `PROMPTS.md` must be ported to a structured format compatible with Groundswell's `Prompt` object.

- **Templates**: Convert raw HEREDOC prompts into TypeScript template literals or external text files loaded at runtime.
- **Structured Output**: For the **Architect Agent**, use Zod schemas to enforce the strict JSON output format required for `tasks.json`.

```typescript
// Example Architect Prompt Definition
const architectPrompt = createPrompt({
  name: 'architect_breakdown',
  user: prdContent,
  system: TASK_BREAKDOWN_SYSTEM_PROMPT, // Ported from PROMPTS.md
  responseFormat: z.object({
    backlog: z.array(
      z.object({
        type: z.literal('Phase'),
        // ... full schema definition
      })
    ),
  }),
});
```
