# Codebase Recon: LLM Call Patterns via Groundswell Agents

Scout findings on how existing TS modules make LLM calls, structure
classification/JSON-response patterns, and register prompts. All file paths
are repo-relative to `/home/dustin/projects/hacky-hack`.

---

## TL;DR — The Canonical LLM-Call Recipe

Every LLM call in this codebase follows the same 5-step shape:

```ts
// 1. Build the agent (factory returns a configured groundswell `Agent`)
import { createQAAgent } from '../agents/agent-factory.js';   // or createCommitMessageAgent, createArchitectAgent, etc.
const agent = createQAAgent();

// 2. Build a typed `Prompt<T>` via a prompts/<name>-prompt.ts generator
import { createDeltaAnalysisPrompt } from '../agents/prompts/delta-analysis-prompt.js';
const prompt = createDeltaAnalysisPrompt(oldPRD, newPRD, completedTasks);

// 3. Invoke through the retry wrapper (NEVER call .prompt() bare)
import { retryAgentPrompt } from '../utils/retry.js';
const agentResponse = await retryAgentPrompt(() => agent.prompt(prompt),
  { agentType: 'QA', operation: 'deltaAnalysis' });

// 4. Discriminate on `agentResponse.status` ('success' | 'error' | 'partial')
if (agentResponse.status !== 'success' || agentResponse.data === null) {
  throw new Error(`QA agent failed: ${...}`);
}

// 5. Use `agentResponse.data` (typed T)
const result: DeltaAnalysis = agentResponse.data;
```

**Critical fact:** `agent.prompt()` returns `Promise<AgentResponse<T>>` — a
discriminated union, NOT a string and NOT a bare object. There is **no
`.content` field**. Validated payload is `.data`, status is `.status`, errors
are `.error`. Details in §4 below.

---

## 1. Workflow Agent Invocation + Response Handling

### 1a. `src/workflows/delta-analysis-workflow.ts`

**Files retrieved:**
- `src/workflows/delta-analysis-workflow.ts` (full file, ~230 lines) — the
  simpler/structured-JSON-only workflow. The reference implementation for
  "agent returns validated JSON via `responseFormat`".

**Key code — `analyzeDelta()` (lines ~118–170):**

```ts
@Step({ trackTiming: true })
async analyzeDelta(): Promise<DeltaAnalysis> {
  try {
    // (1) Create QA agent — reasoning role, xhigh budget, BUG_HUNT_PROMPT system
    const qaAgent = createQAAgent();

    // (2) Build typed Prompt<DeltaAnalysis> (responseFormat: DeltaAnalysisSchema)
    const prompt = createDeltaAnalysisPrompt(
      this.oldPRD, this.newPRD, this.completedTasks
    );

    // (3) Execute with retry (3 attempts, exponential backoff, jitter)
    const agentResponse = await retryAgentPrompt(
      () => qaAgent.prompt(prompt),
      { agentType: 'QA', operation: 'deltaAnalysis' }
    );

    // (4) Extract / parse-failure handling: discriminate on .status
    if (agentResponse.status !== 'success' || agentResponse.data === null) {
      const errorMessage =
        agentResponse.status === 'error' && agentResponse.error
          ? agentResponse.error.message
          : 'Unknown error';
      throw new Error(`QA agent failed: ${errorMessage}`);
    }

    // (5) Use validated data directly (Groundswell already validated against DeltaAnalysisSchema)
    const result: DeltaAnalysis = agentResponse.data;
    this.deltaAnalysis = result;
    return result;
  } catch (error) {
    this.logger.error(`[DeltaAnalysisWorkflow] Analysis failed: ${error}`);
    throw error;
  }
}
```

**How it parses structured JSON:** It does NOT call `JSON.parse()` itself.
`responseFormat: DeltaAnalysisSchema` on the Prompt causes Groundswell to
validate the LLM output against the Zod schema and either return
`status:'success'` with `data` or `status:'error'`. The workflow just reads
`agentResponse.data`.

**How it handles parse failures:** If Groundswell's schema validation fails,
`agentResponse.status === 'error'` → the `if` branch throws. (The retry wrapper
re-attempts transient errors, but a `ValidationError` / parse failure is
classified **permanent** by `isTransientError` — see `retry.ts` — so it is NOT
retried.)

**How it extracts text:** N/A — it consumes structured `data`, not text.

---

### 1b. `src/workflows/bug-hunt-workflow.ts`

**Files retrieved:**
- `src/workflows/bug-hunt-workflow.ts` (full file, ~430 lines) — the
  **file-as-contract** workflow. Demonstrates BOTH the legacy
  `responseFormat` path AND the file-as-contract path. This is the more
  instructive example because reasoning models (glm-5.2) do NOT reliably honor
  `responseFormat` for structured JSON.

**Key code — `generateReport()` (lines ~265–340):**

```ts
@Step({ trackTiming: true })
async generateReport(): Promise<TestResults> {
  try {
    const qaAgent = createQAAgent();

    // FILE-AS-CONTRACT: agent writes TestResults JSON to a file it controls,
    // then the caller reads it back. Reasoning models reliably WRITE files
    // but do NOT reliably honor responseFormat for structured JSON.
    const outputPath = this.sessionPath !== undefined
      ? join(this.sessionPath, 'bug_hunt_results.json')
      : undefined;

    // (2) Build prompt (passing outputPath switches to file-as-contract mode)
    const prompt = createBugHuntPrompt(this.prdContent, this.completedTasks, outputPath);

    // (3) Execute with retry
    const agentResponse = await retryAgentPrompt(
      () => qaAgent.prompt(prompt),
      { agentType: 'QA', operation: 'bugHunt' }
    );

    let results: TestResults;

    if (outputPath !== undefined) {
      // FILE-AS-CONTRACT path: read + validate the JSON file the agent wrote
      results = await this.#readResultsFile(outputPath);
    } else {
      // Legacy responseFormat path: extract from AgentResponse
      if (agentResponse.status !== 'success' || agentResponse.data === null) {
        const errorMessage =
          agentResponse.status === 'error' && agentResponse.error
            ? toErrorMessage(agentResponse.error)
            : 'Unknown error';
        throw new Error(`QA agent failed: ${errorMessage}`);
      }
      results = agentResponse.data;
    }
    // ...
    return results;
  } catch (error) {
    throw new Error(`Bug report generation failed: ${toErrorMessage(error)}`);
  }
}
```

**Key code — file-as-contract reader `#readResultsFile()` (lines ~350–390):**
This is the canonical "JSON.parse with fallback" pattern in the codebase — it
handles a markdown-fenced ```json``` wrapper that some models add:

```ts
async #readResultsFile(outputPath: string): Promise<TestResults> {
  let raw: string;
  try {
    raw = await readFile(outputPath, 'utf-8');
  } catch {
    throw new Error(`QA agent did not write results file: ${outputPath}`);
  }
  let parsed: unknown = raw;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Tolerate a ```json ... ``` fence (some models wrap the file)
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) {
      try {
        parsed = JSON.parse(fenced[1].trim());
      } catch (e) {
        throw new Error(`QA results file is not valid JSON: ${toErrorMessage(e)}`);
      }
    } else {
      throw new Error('QA results file is not valid JSON');
    }
  }
  const result = TestResultsSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`QA results file failed validation: ${toErrorMessage(result.error)}`);
  }
  return result.data;
}
```

**Why file-as-contract exists (from `createBugHuntPrompt`, bug-hunt-prompt.ts):**
The prior `responseFormat`-only path failed with `VALIDATION_ERROR`
("Expected object, received string") because the model returned prose markdown
instead of JSON. When `outputPath` is set, `responseFormat` is downgraded to
`z.unknown()` (permissive) and the FILE becomes the source of truth; the prompt
injects a `## ⚠️ DELIVERABLE` banner instructing the agent to write a JSON file.

---

## 2. `src/agents/commit-message-agent.ts` — Stagecoach (text-output) Pattern

**Files retrieved:**
- `src/agents/commit-message-agent.ts` (full file, ~140 lines) — the
  lightweight single-purpose LLM agent ("stagecoach"). Demonstrates the
  `responseFormat: z.string()` / **text-extraction** pattern (contrast with the
  structured-JSON workflows above).

**Agent factory (lines ~103–120):**

```ts
export function createCommitMessageAgent(): Agent {
  const baseConfig = createBaseConfig('researcher', 'research');
  const config = {
    ...baseConfig,
    name: 'CommitMessageAgent',
    system: COMMIT_MESSAGE_SYSTEM,
    maxTokens: 512,
    enableReflection: false,  // single-shot; reflection = wasted round-trip
    enableCache: false,       // every diff is unique
    stateless: true,          // single-shot stagecoach; overrides researcher base
  };
  logger().debug({ persona: 'researcher', model: config.model }, 'Creating commit-message agent');
  return createAgent(config);
}
```

Notable: NO `mcps` field — the agent reads the diff from the prompt text only.
Diverges from `createCleanupAgent` (which carries `MCP_TOOLS` because it
mutates the filesystem).

**How the caller invokes it and extracts TEXT — `generateCommitMessage()` in
`src/utils/git-commit.ts` (lines ~190–220):**

```ts
export async function generateCommitMessage(diff: string): Promise<string> {
  if (!diff || !diff.trim()) {
    throw new AgentError('stagecoach commit-message generation failed: empty staged diff');
  }
  const agent = createCommitMessageAgent();
  const prompt = createPrompt({
    user: buildCommitMessageUserPrompt(diff),
    responseFormat: z.string(),            // <-- TEXT output, not structured object
  });
  const r = await agent.prompt(prompt);     // <-- NOTE: NO retryAgentPrompt wrapper here
  if (r.status === 'error') {
    throw new AgentError(
      `stagecoach commit-message generation failed: ${r.error?.message ?? 'unknown agent error'}`
    );
  }
  const message = (r.data ?? '').trim();    // <-- TEXT extraction: r.data is the string
  if (!message || message === 'skip') {
    throw new AgentError('stagecoach commit-message generation failed: empty agent output');
  }
  return message;
}
```

**Key takeaways for the text-output pattern:**
- Use `responseFormat: z.string()` to get a plain string in `r.data`.
- The text comes out of `agentResponse.data` (same `.data` field as structured
  responses — just typed as `string` because `responseFormat` is `z.string()`).
- This caller does NOT wrap in `retryAgentPrompt` — the P3.M1.T4.S1 retry layer
  wraps `generateCommitMessage` itself with a bounded `retry()` loop using
  `COMMIT_RETRY_*` constants (per the file's own JSDoc). The boundary throws
  `AgentError` (code `PIPELINE_AGENT_LLM_FAILED`, classified transient by
  `isTransientError`) on every failure mode.
- Sentinel handling: agent may emit `'skip'` (when diff is empty) — caller
  treats that as a failure too.

---

## 3. Prompt Registration Patterns

There are **TWO prompt layers** that coexist:

### Layer A — `src/agents/prompts.ts` (string-constant system prompts)

**Files retrieved:**
- `src/agents/prompts.ts` (full file, ~600+ lines of prompt text)

Exports large `as const` string constants that are **system-prompt bodies**
(persona definitions), NOT `Prompt<T>` objects. These are consumed by the agent
factory (as `system:` on the agent config) AND by the prompts/ generators (as
`system:` on the prompt). Constants:

| Constant | Used by |
|---|---|
| `TASK_BREAKDOWN_PROMPT` | `createArchitectAgent` (agent-factory.ts) |
| `PRP_BLUEPRINT_PROMPT` | `createResearcherAgent` |
| `PRP_BUILDER_PROMPT` | `createCoderAgent` |
| `BUG_HUNT_PROMPT` | `createQAAgent` |
| `CLEANUP_PROMPT` | `createCleanupAgent` |
| `DELTA_PRD_PROMPT` | (legacy delta-PRD generation; unused by current workflow) |
| `DELTA_ANALYSIS_PROMPT` | `createDeltaAnalysisPrompt` generator (as prompt `system`) |
| `PRD_PREMERGED_DECLARATION` | Shared preamble injected into 4 constants + 3 generators |

Also exports a `PROMPTS` lookup object and `PromptKey` type:
```ts
export const PROMPTS = { TASK_BREAKDOWN, PRP_BLUEPRINT, PRP_BUILDER,
  DELTA_PRD, DELTA_ANALYSIS, BUG_HUNT, CLEANUP } as const;
export type PromptKey = keyof typeof PROMPTS;
```

### Layer B — `src/agents/prompts/` directory (typed `Prompt<T>` generators)

**Files retrieved:**
- `src/agents/prompts/index.ts` (full file) — barrel re-exports.
- `src/agents/prompts/delta-analysis-prompt.ts` (full file) — structured-JSON pattern.
- `src/agents/prompts/bug-hunt-prompt.ts` (full file) — file-as-contract pattern.
- `src/agents/prompts/architect-prompt.ts` (lines 1–60) — confirms the pattern.

**`index.ts` (the barrel):**
```ts
export { createArchitectPrompt } from './architect-prompt.js';
export { createPRPBlueprintPrompt } from './prp-blueprint-prompt.js';
export { createDeltaAnalysisPrompt } from './delta-analysis-prompt.js';
export { createBugHuntPrompt } from './bug-hunt-prompt.js';
```
**Note:** `index.ts` re-exports only the generator FUNCTIONS from `prompts/`,
NOT the string constants from `prompts.ts`. Callers import the string constants
directly from `'../agents/prompts.js'` (or `'../../agents/prompts.js'`).

### Canonical pattern to add a NEW prompt (constant + subfile)

To add e.g. a `MID_SESSION_UPDATE` prompt, follow these steps (mirroring how
`DELTA_ANALYSIS_PROMPT` + `createDeltaAnalysisPrompt` are wired):

**Step 1 — Add the string constant to `src/agents/prompts.ts`:**
```ts
export const MID_SESSION_UPDATE_PROMPT = `
# Mid-Session Task Update

${PRD_PREMERGED_DECLARATION}

You are ...
` as const;
```
Also add it to the `PROMPTS` lookup object and (optionally) `PromptKey`.

**Step 2 — Create `src/agents/prompts/mid-session-update-prompt.ts`**
following the delta-analysis-prompt.ts template:
```ts
import { createPrompt, type Prompt } from 'groundswell';
import type { MidSessionUpdate } from '../../core/models.js';
import { MidSessionUpdateSchema } from '../../core/models.js';
import { MID_SESSION_UPDATE_PROMPT, PRD_PREMERGED_DECLARATION } from '../prompts.js';

function constructUserPrompt(...): string { /* build user turn */ }

export function createMidSessionUpdatePrompt(...): Prompt<MidSessionUpdate> {
  return createPrompt({
    user: constructUserPrompt(...),
    system: MID_SESSION_UPDATE_PROMPT,
    responseFormat: MidSessionUpdateSchema,   // Zod schema → structured JSON
    enableReflection: true,
  });
}
```

**Step 3 — Re-export from `src/agents/prompts/index.ts`:**
```ts
export { createMidSessionUpdatePrompt } from './mid-session-update-prompt.js';
```

**Step 4 — (If a dedicated agent persona is needed) add a factory to
`src/agents/agent-factory.ts`** that spreads `createBaseConfig(...)` and sets
`system: MID_SESSION_UPDATE_PROMPT`, `mcps: MCP_TOOLS`. Note
`agent-factory.ts` already imports from `./prompts.js`:
```ts
import { TASK_BREAKDOWN_PROMPT, PRP_BLUEPRINT_PROMPT, PRP_BUILDER_PROMPT,
  BUG_HUNT_PROMPT, CLEANUP_PROMPT } from './prompts.js';
```
(Add `MID_SESSION_UPDATE_PROMPT` to this import list.)

**Structural conventions observed:**
- `createPrompt({ user, system, responseFormat, enableReflection })` is the
  standard signature. `responseFormat` is REQUIRED by `PromptConfig<T>`.
- For structured output use the domain Zod schema (`DeltaAnalysisSchema`,
  `TestResultsSchema`). For text output use `z.string()`. For file-as-contract
  use `z.unknown()` (permissive) and cast the return type:
  `return prompt as Prompt<TestResults>;`.
- ES module imports MUST use `.js` extensions even in `.ts` source.
- `PRD_PREMERGED_DECLARATION` is prepended in both the system-prompt constants
  and the generator's user-prompt construction.

---

## 4. The `Agent` interface from `groundswell` — `.prompt()` Signature & Return Type

**Files retrieved:**
- `node_modules/groundswell/dist/core/agent.d.ts` (full) — `Agent` class + `prompt()`.
- `node_modules/groundswell/dist/types/agent.d.ts` — `AgentResponse<T>` discriminated union.
- `node_modules/groundswell/dist/types/prompt.d.ts` — `PromptConfig<T>`.
- `node_modules/groundswell/dist/core/prompt.d.ts` — `Prompt<T>` class.
- `node_modules/groundswell/dist/core/factory.d.ts` — `createAgent` / `createPrompt`.

**`.prompt()` signature (`agent.d.ts`):**
```ts
prompt<T>(prompt: Prompt<T>, overrides?: PromptOverrides): Promise<AgentResponse<T>>;
```

**Return type `AgentResponse<T>` (`types/agent.d.ts`) — a discriminated union
on `.status`:**
```ts
type AgentResponse<T = unknown> =
  | { status: 'success'; data: T;            error: null;                metadata: AgentResponseMetadata }
  | { status: 'error';   data: null;         error: AgentErrorDetails;   metadata: AgentResponseMetadata }
  | { status: 'partial'; data: T;            error: null;                metadata: AgentResponseMetadata };
```

**Answering the task's specific question:**
- ❌ `.prompt()` does NOT return a string.
- ❌ It does NOT return an object with a `.content` field.
- ✅ It returns `AgentResponse<T>`: an object with `.status` (the discriminant),
  `.data` (validated payload of type `T`, or `null` on error), `.error`
  (`AgentErrorDetails | null`), and `.metadata`.

**`AgentErrorDetails`:**
```ts
interface AgentErrorDetails {
  code: string;             // SCREAMING_SNAKE_CASE, e.g. 'VALIDATION_FAILED'
  message: string;
  details?: Record<string, unknown> | null;
  recoverable: boolean;     // hint for retry logic
}
```

**`PromptConfig<T>` (`types/prompt.d.ts`) — required by `createPrompt`:**
```ts
interface PromptConfig<T> {
  user: string;                          // REQUIRED
  responseFormat: z.ZodType<T>;          // REQUIRED (Zod schema)
  data?: Record<string, unknown>;
  system?: string;
  tools?: Tool[];
  mcps?: MCPServer[];
  enableReflection?: boolean;
  // ...hooks, skills
}
```

**Other `Agent` methods (for completeness):**
- `reflect<T>(prompt, overrides?)` — same signature as `prompt()` but forces reflection on.
- `stream<T>(prompt, overrides?)` — returns `AsyncStream<T>`.
- `promptWithMetadata<T>(...)` — deprecated; use `prompt()`.

Groundswell also exports type guards `isSuccess`, `isError`, `isPartial`, and
the Zod `AgentResponseSchema(dataSchema)` factory — but this codebase prefers
to discriminate directly on `.status`.

---

## 5. Retry Layer — `src/utils/retry.ts`

**Files retrieved:**
- `src/utils/retry.ts` (full file, ~600 lines).

**`retryAgentPrompt<T>()`** (the wrapper every workflow uses):
```ts
export async function retryAgentPrompt<T>(
  agentPromptFn: () => Promise<T>,
  context: { agentType: string; operation: string }
): Promise<T> {
  return retry(agentPromptFn, {
    ...AGENT_RETRY_CONFIG,   // maxAttempts: 3, baseDelay: 1000, maxDelay: 30000, backoffFactor: 2, jitterFactor: 0.1
    onRetry: createDefaultOnRetry(`${context.agentType}.${context.operation}`),
  });
}
```
- Uses `isTransientError` as the default retryable predicate.
- `ValidationError` and parse errors are **permanent** (never retried).
- `AgentError` (code `PIPELINE_AGENT_LLM_FAILED`) is transient UNLESS its
  message contains "parse"/"parsing".
- Watchdog kills (`timedOut: true` or `exitCode === 124`) are **terminal**
  (never retried).
- Related: `withAgentDeadline()` races any agent call against `RESEARCH_TIMEOUT`
  and rejects with a transient `AgentError` on expiry.

---

## Architecture — How the Pieces Connect

```
caller (workflow / util)
  │
  │  createXxxAgent()                    ← src/agents/agent-factory.ts
  │    └─ createBaseConfig(persona, role)   (model tier, tokens, env, MCP_TOOLS)
  │       └─ createAgent(config)           ← groundswell factory
  │            returns: Agent
  │
  │  createXxxPrompt(args)               ← src/agents/prompts/<name>-prompt.ts
  │    └─ createPrompt({ user, system, responseFormat, enableReflection })
  │       system ← src/agents/prompts.ts (string constant)
  │       responseFormat ← Zod schema from src/core/models.ts
  │            returns: Prompt<T>
  │
  │  retryAgentPrompt(() => agent.prompt(prompt), {agentType, operation})
  │    └─ retry(fn, {maxAttempts:3, isRetryable: isTransientError, ...})
  │         returns: Promise<AgentResponse<T>>   ← groundswell
  │
  │  discriminate agentResponse.status
  │    ├─ 'success' → use agentResponse.data (typed T)
  │    ├─ 'error'   → throw (agentResponse.error.message)
  │    └─ 'partial' → (treat as data, same as success)
  │
  │  [file-as-contract variant] when outputPath set:
  │    readFile(outputPath) → JSON.parse (with ```json fence fallback)
  │       → DomainSchema.safeParse → result.data
```

**Two output modes:**
1. **Structured JSON** (`responseFormat: DomainSchema`) — Groundswell validates;
   caller reads `.data`. Used by delta-analysis (and bug-hunt legacy path).
2. **File-as-contract** (reasoning models that won't honor responseFormat) —
   agent writes JSON to a file; caller reads+parses+validates the file.
   `responseFormat` downgraded to `z.unknown()`. Used by bug-hunt
   (`outputPath`), architect, prp-generator.
3. **Text** (`responseFormat: z.string()`) — caller reads `.data` as a string.
   Used by commit-message-agent.

---

## Start Here

**Open `src/workflows/delta-analysis-workflow.ts` lines 110–175 first** — it is
the cleanest, smallest example of the full agent-invocation → retry →
status-discrimination → data-extraction cycle (structured-JSON mode, no
file-as-contract complexity). Then read `src/agents/prompts/delta-analysis-prompt.ts`
for the matching prompt generator. For the file-as-contract variant and JSON
parse-with-fallback, read `bug-hunt-workflow.ts` `#readResultsFile()` (lines
~350–390). For text-output mode, read `commit-message-agent.ts` + the
`generateCommitMessage()` caller in `src/utils/git-commit.ts` (lines ~190–220).

---

## Residual Risks / Open Questions

- **`DELTA_PRD_PROMPT` vs `DELTA_ANALYSIS_PROMPT`:** Two different prompts.
  `DELTA_PRD_PROMPT` (legacy, shell-substitution `$PREV_SESSION_DIR`) appears
  unused by the current `DeltaAnalysisWorkflow`, which uses
  `DELTA_ANALYSIS_PROMPT` via `createDeltaAnalysisPrompt`. A new prompt author
  must pick the right one. No code defect — just naming overlap to be aware of.
- **File-as-contract necessity is model-dependent:** The bug-hunt prompt
  comments note glm-5.2 (reasoning) does NOT reliably honor `responseFormat`.
  Any NEW structured-JSON prompt targeting a reasoning-tier agent may hit the
  same `VALIDATION_ERROR` and need the file-as-contract fallback. The
  delta-analysis workflow uses `responseFormat` directly without
  file-as-contract — confirm the target model honors it before copying that
  pattern verbatim.
- **`retryAgentPrompt` vs custom `retry()`:** The commit-message boundary uses
  a custom `retry()` loop (not `retryAgentPrompt`) with `COMMIT_RETRY_*`
  constants. New text-output / transient-boundary calls should decide which
  retry wrapper fits (the generic `retryAgentPrompt` vs a bespoke
  `retry()` with operation-specific constants).
- **No partial-status handling in workflows:** Both workflows treat only
  `'success'` as usable; `'partial'` would fall through to the throw branch.
  If a new workflow relies on streaming/partial results, it must handle
  `status: 'partial'` explicitly.