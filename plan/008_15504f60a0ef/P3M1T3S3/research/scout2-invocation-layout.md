# Scout 2 — Agent Invocation Pattern & Module Layout (P3.M1.T3.S3)

Recon for the cleanup-agent persona + runner. All findings are concrete with
file:line refs. Note: `src/core/cleanup-runner.ts` **already exists** (the S2
seam landed) — S3 replaces its no-op default, it does not create the module.

---

## 1. How an Agent is actually invoked

### Canonical single-shot invocation — `src/utils/git-commit.ts:168-189`
This is the **closest precedent to the cleanup agent** (single-shot, builds a
runtime user prompt from data, then `agent.prompt()`). Full snippet:

```ts
// src/utils/git-commit.ts:168
const agent = createCommitMessageAgent();
const prompt = createPrompt({
  user: buildCommitMessageUserPrompt(diff),   // runtime-built user string
  responseFormat: z.string(),
});
const r = await agent.prompt(prompt);
if (r.status === 'error') {
  throw new AgentError(
    `stagecoach commit-message generation failed: ${r.error?.message ?? 'unknown agent error'}`
  );
}
const message = (r.data ?? '').trim();
if (!message || message === 'skip') {
  throw new AgentError('stagecoach commit-message generation failed: empty agent output');
}
return message;
```

Key mechanics, all confirmed:
- **`createPrompt({ user, responseFormat: z.<schema> })`** — yes, this is the
  pattern. `z.string()` for free-text output (commit message, cleanup summary);
  `z.unknown()` when the response is consumed as JSON later (`prp-executor.ts:303`,
  `:593`); a real zod schema for structured output
  (`prompts/delta-analysis-prompt.ts:134`, `prompts/prp-blueprint-prompt.ts:324`).
- **Status check:** `if (r.status === 'error')` (git-commit.ts:178,
  prp-generator.ts:721). Groundswell wraps LLM failures as `{status:'error'}`
  and **never throws** — so you MUST check `r.status`. `AgentResponseStatus`
  is `'success' | 'error' | 'partial'` (groundswell agent.d.ts:225). The
  discriminated union (`agent.d.ts:312-326`) means `r.data` is non-null only on
  `'success'`/`'partial'`, and `r.error: AgentErrorDetails` only on `'error'`.
- **Extracting text:** `r.data` directly when `responseFormat: z.string()`
  (git-commit.ts:185 `(r.data ?? '').trim()`). For unknown/JSON payloads,
  `prp-executor.ts:#extractResponseContent` (lines ~649-670) stringifies:
  `typeof data === 'string' ? data : JSON.stringify(data)`.
- **Errors:** throw the project's **`AgentError`** (`src/utils/errors.ts:422`,
  `code = ErrorCodes.PIPELINE_AGENT_LLM_FAILED`, classified transient by
  `isTransientError`). Do NOT use Groundswell's `AgentErrorDetails`.

### Retry / deadline wrappers — used by core agents
- `withAgentDeadline(agent.prompt(prompt))` — bounds the call by
  `RESEARCH_TIMEOUT`; rejects with a transient `AgentError` on expiry
  (`prp-generator.ts:718`, `prp-executor.ts:325`).
- `retryAgentPrompt(async () => { ... }, { agentType, operation })` — wraps the
  full generation contract with exponential backoff (`prp-generator.ts:694`,
  `prp-executor.ts:326`, `git-commit.ts` consumed by P3.M1.T4.S1's retry layer).
- The cleanup runner is **non-fatal** (its own try/catch in task-orchestrator,
  see S2 PRP Task 4), so it likely needs only `withAgentDeadline` to bound
  runtime, NOT full `retryAgentPrompt` — open design question (see §Risks).

## 2. `src/utils/logger.ts` — getLogger signature

```ts
// src/utils/logger.ts:339
export function getLogger(context: string, options?: LoggerConfig): Logger
```

- Single required arg = context string (the component label).
- Returns the project `Logger` interface (pino-backed; `info`/`debug`/`warn`/…
  with `logger.info({taskId}, 'msg')` shape).
- **Cached & lazy** (pino loaded on first call).
- Convention across agents: `getLogger('PRPGenerator')` (prp-generator.ts:204),
  `getLogger('PRPExecutor')` (prp-executor.ts:197),
  `getLogger('CommitMessageAgent')` (commit-message-agent.ts:36),
  `getLogger('AgentFactory')` (agent-factory.ts:88).
- **Lazy-accessor pattern** used by the thin factories to avoid module-eval
  side effects — copy this verbatim:
  ```ts
  // src/agents/commit-message-agent.ts:34-36
  let _logger: ReturnType<typeof getLogger> | undefined;
  const logger = () => (_logger ??= getLogger('CommitMessageAgent'));
  ```
  → for cleanup: `getLogger('CleanupAgent')`.

## 3. `src/core/cleanup-runner.ts` — EXISTS (S2 seam landed)

The module exists (105 lines, 2678 bytes) and matches the S2 PRP contract
exactly. The seam interface is already in place — S3 replaces the no-op default,
it does not redefine the types.

- **`CleanupContext`** (`cleanup-runner.ts:28-34`): `{ sessionPath: string;
  subtask: Subtask; repoRoot: string }` (`Subtask` imported **type-only** from
  `./models.js` to avoid the runtime cycle — `cleanup-runner.ts:25`).
- **`CleanupResult`** (`:42-49`): `{ success: boolean; summary?: string;
  error?: string }`. `success:false` is non-fatal to `executeSubtask`.
- **`CleanupRunner`** (`:57`): `(ctx: CleanupContext) => Promise<CleanupResult>`.
- **`createCleanupRunner(): CleanupRunner`** (`:70-79`) — currently a **no-op**
  returning `{ success: true, summary: 'cleanup disabled (no persona wired
  yet)' }`. Module header (`:9-17`) and JSDoc both explicitly state
  *"P3.M1.T3.S3 will later replace createCleanupRunner's default runner with
  one that invokes the cleanup agent persona."*

The orchestrator already consumes this seam: it calls
`this.#cleanupRunner({ sessionPath, subtask, repoRoot })` between the survival
and post-cleanup commits (S2 PRP Task 4). So **S3 only needs to change the
implementation inside `createCleanupRunner()`** — no orchestrator edits.

## 4. How the runner builds its runtime user prompt from CleanupContext

The cleanup agent is single-shot, so the **runner** (not a prompt module) must
build the user prompt string from `CleanupContext.sessionPath`,
`ctx.subtask.id`, `ctx.subtask.title` at call time. There is **no existing
subtask→prompt builder**; the established pattern is to build the user string
inline at the call site:

- **`src/agents/prp-executor.ts:303-309`** — builds the user prompt inline from
  `prpPath`, the exact model for cleanup (substitute ctx fields):
  ```ts
  const injectedPrompt = createPrompt({
    user: `Execute the PRP located at: ${prpPath}\n\nRead it with your file tools, then implement it following your system instructions.`,
    responseFormat: z.unknown(),
  });
  ```
- **`src/utils/git-commit.ts:152-160`** — `buildCommitMessageUserPrompt(diff)`
  is a tiny private helper that joins a few lines + a fenced payload, then
  passed as `createPrompt({ user: ... })` at git-commit.ts:174. **This is the
  cleanest template** for a `buildCleanupUserPrompt(ctx)` helper.
- **`src/core/task-orchestrator.ts`** already interpolates subtask fields into a
  fallback string: `${subtask.id}: ${subtask.title}` (S2 PRP Task 4 survival
  commit message).

**Recommended for S3:** a private `buildCleanupUserPrompt(ctx: CleanupContext):
string` helper inside `cleanup-runner.ts` that emits the sessionPath, subtask id,
subtask title, and the explicit instructions (move `plan/{sessionPath}/research/*`
→ `docs/`, remove temp artifacts, save `tasks.json`, forbid touching `plan/`
per PRD §5.1). Then `createPrompt({ user, responseFormat: z.string() })`.

## 5. Module-layout recommendation for S3

> **NOTE — overridden by the S3 contract:** The contract item 3(a) MANDATES
> "Add a 'cleanup' persona to AgentPersona type in agent-factory.ts" and item
> 3(d) MANDATES "Add CLEANUP_PROMPT to src/agents/prompts.ts". The recommendation
> below (thin-factory reuse) is the *alternative* the contract REJECTS. The PRP
> follows the contract: union-expansion in agent-factory.ts + CLEANUP_PROMPT in
> prompts.ts. This section is retained for the import-cycle check + invocation
> pattern, which still apply.

### Agent persona factory → contract says: in `agent-factory.ts`
The direct, same-feature precedent is `src/agents/commit-message-agent.ts`
(P3.M1.T3.S1 — stagecoach, sibling of this cleanup task). Its JSDoc
(`commit-message-agent.ts:12-16`) reuses `createBaseConfig('researcher')` to
AVOID expanding the union. **However the S3 contract mandates the expansion**,
so the cleanup factory lives in `agent-factory.ts` as a sibling of
`createCoderAgent`/`createQAAgent`, NOT in a separate thin-factory file.

**Key DIFFERENCE from commit-message-agent:** cleanup must actually move files
and save `tasks.json`, so it **MUST carry MCP tools** — unlike commit-message
(no tools, reads diff from prompt). `MCP_TOOLS` (bash+filesystem+git) is already
exported from agent-factory.ts (`export { MCP_TOOLS }`), so the cleanup factory
can do:
```ts
import { createBaseConfig, MCP_TOOLS } from './agent-factory.js';
const config = { ...createBaseConfig('cleanup', 'implementation'),
  system: CLEANUP_PROMPT, mcps: MCP_TOOLS,
  enableReflection: false, enableCache: false };
return createAgent(config);
```

### Runner → MODIFY `src/core/cleanup-runner.ts` in place (replace no-op)
The seam contract (types + `createCleanupRunner()` factory) is already consumed
by the orchestrator. The module's own header and the S2 PRP both name this as
the S3 edit site. Replacing the no-op body with the real agent invocation keeps:
the interface untouched, `task-orchestrator.ts` untouched, no new wiring/DI. Do
NOT create a parallel runner module — that would require re-plumbing the
orchestrator's `#cleanupRunner` field.

**Import cycle check (clean):** `core/cleanup-runner.ts` → `agents/agent-factory.ts`
→ (`config/*`, `utils/logger`, `agents/prompts.ts`, `tools/*`). Nothing in the
agents/ chain imports back into `core/`, so no cycle.

## 6. Where does CLEANUP_PROMPT go?

Two prompt conventions coexist:
1. **`src/agents/prompts.ts`** (42 KB) — the **system prompts** for the 4 core
   personas (`TASK_BREAKDOWN_PROMPT`, `PRP_BLUEPRINT_PROMPT`, `PRP_BUILDER_PROMPT`,
   `BUG_HUNT_PROMPT`), all wired through `agent-factory.ts`.
2. **`src/agents/prompts/`** dir + `prompts/index.ts` — per-file
   `createXxxPrompt()` factories that build a full `Prompt` object via
   `createPrompt` (architect, bug-hunt, delta-analysis, prp-blueprint). Each is
   a *builder*, not a raw system string.

**Per the S3 contract (item 3d):** `CLEANUP_PROMPT` goes in
`src/agents/prompts.ts` as a sibling of `BUG_HUNT_PROMPT`, registered in the
`PROMPTS` map. The runtime USER prompt is built from `CleanupContext` by the
runner (cleanup-runner.ts), not by a `createCleanupPrompt()` builder, so it does
not need a `prompts/cleanup-prompt.ts` file.

| Part | Owner | Precedent |
|---|---|---|
| `CLEANUP_PROMPT` (system/persona string) | `src/agents/prompts.ts` | `BUG_HUNT_PROMPT` (prompts.ts:918), contract item 3(d) |
| runtime user prompt from `CleanupContext` | inline/helper in `cleanup-runner.ts` | `buildCommitMessageUserPrompt` (git-commit.ts:152), `injectedPrompt` (prp-executor.ts:303) |

## Start Here
Open `src/agents/commit-message-agent.ts` (full file) for the config-override
shape. Then open `src/agents/agent-factory.ts` lines 360-410
(`createCoderAgent`/`createQAAgent`) for the MCP-carrying factory shape that the
cleanup factory mirrors (contract mandates union-expansion). Then open
`src/core/cleanup-runner.ts` (full file) to see the exact no-op body to replace
and the `CleanupContext`/`CleanupResult` shapes the runner must honor. Use
`src/utils/git-commit.ts:168-189` as the invocation-pattern reference (status
check → `r.data` extraction; the cleanup runner returns `CleanupResult` instead
of throwing).

---

## Residual Risks / Open Questions
- **Retry around the cleanup call:** S2 makes cleanup non-fatal (own try/catch
  in task-orchestrator), so a bare `withAgentDeadline(agent.prompt(prompt))`
  likely suffices. Whether S3 should also wrap in `retryAgentPrompt` (matching
  P3.M1.T4.S1's stagecoach retry) is a PRD/scope decision — confirm before
  over-engineering. The runner's own `success:false`/throw is swallowed by the
  orchestrator either way. **PRP decision: NO retry (non-fatal; out of scope).**
- **`responseFormat` choice:** `z.string()` (free-text summary, mirrors
  commit-message) vs `z.unknown()`/JSON (mirrors coder). Depends on whether the
  cleanup agent should emit a structured `{summary}` or just prose. Recommend
  `z.string()` + `responseFormat` since `CleanupResult.summary` is a free string.
  **PRP decision: `z.string()`.**
- **MCP tools required:** cleanup genuinely mutates the filesystem (move docs,
  remove artifacts, save tasks.json), so `mcps: MCP_TOOLS` is mandatory — this
  diverges from the otherwise-identical commit-message-agent (no tools).
- **`plan/` mutation prohibition (PRD §5.1):** the system prompt + user prompt
  must forbid touching `plan/` (the survival commit already persisted it); the
  agent must only touch `docs/` and root-level temp artifacts. Enforce via
  prompt instructions (the orchestrator does not sandbox the agent).