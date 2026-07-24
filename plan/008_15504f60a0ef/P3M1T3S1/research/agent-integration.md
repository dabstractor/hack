# Agent Integration — How to add a stagecoach commit-message generator

Findings for wiring an LLM commit-message-generation path into `smartCommit`
without expanding the `AgentPersona` union or touching the 4 existing personas.

## 1. Minimal new agent WITHOUT expanding `AgentPersona`

`src/agents/agent-factory.ts`:
- `AgentPersona = 'architect' | 'researcher' | 'coder' | 'qa'` (line ~132) —
  **DO NOT expand**; it is consumed by `PERSONA_TOKEN_LIMITS` and every factory.
- `createBaseConfig(persona, role='research'): AgentConfig` (line ~239) returns
  a fully-wired config (model via `ROLE_CONFIG[role]`, harness via
  `resolvedHarness()`, env keys via `resolveApiKeyForProvider`, lazy logger).
- Pattern used by all 4 factories (lines ~296-430):
  ```ts
  export function createResearcherAgent(): Agent {
    const baseConfig = createBaseConfig('researcher', 'research');
    const config = { ...baseConfig, system: PRP_BLUEPRINT_PROMPT, mcps: MCP_TOOLS };
    return createAgent(config);
  }
  ```

**RECOMMENDATION — do NOT add a 5th persona.** Two clean options:

### Option A (preferred for this task): a dedicated thin factory in a new module
Create `src/agents/commit-message-agent.ts` that reuses `createBaseConfig` with
an EXISTING persona+role and overrides name/system/maxTokens. This avoids any
edit to `agent-factory.ts` (zero blast radius) and keeps the commit-message
agent self-contained for `git-commit.ts` to import:

```ts
// src/agents/commit-message-agent.ts
import { createAgent } from 'groundswell';
import { createBaseConfig } from './agent-factory.js';

const COMMIT_MESSAGE_SYSTEM = `You generate concise, conventional-commit-style git commit messages from staged diffs.
Rules:
- Output ONLY the commit message subject + optional body. No preamble, no fences.
- Subject line ≤ 72 chars, imperative mood ("Add", "Fix", "Refactor").
- Reference the work-item id if present in the diff/paths (e.g. P3.M1.T3.S1).
- Do not include Co-Authored-By or [PRP Auto] — the caller wraps the message.`;

export function createCommitMessageAgent() {
  const base = createBaseConfig('researcher', 'research'); // balanced tier, normal budget
  return createAgent({
    ...base,
    name: 'CommitMessageAgent',
    system: COMMIT_MESSAGE_SYSTEM,
    maxTokens: 512, // a commit message is tiny — cheap + fast
    enableReflection: false, // single-shot generation, no reflection loop
    enableCache: false, // diffs are unique; caching wastes a round-trip
    // NO mcps — the agent reads the diff from the PROMPT, not from tools.
  });
}
```
Why `researcher` persona + `research` role: balanced tier (per PRD §9.2.3),
normal reasoning budget, `PERSONA_TOKEN_LIMITS.researcher = 4096` (overridden to
512 here). Using an existing persona means `createBaseConfig`'s harness/env/model
wiring is reused verbatim — no new code paths in agent-factory.

### Option B: inline in git-commit.ts
Build a bare `AgentConfig` and call `createAgent(config)` directly. Loses the
lazy harness/env resolution (`resolvedHarness()` is module-private in
agent-factory) → would re-derive model/harness/env by hand. **Not recommended.**

## 2. Prompt construction (`createPrompt` from groundswell)

- Import: `import { createPrompt } from 'groundswell';` (see
  `src/agents/prp-executor.ts:26`).
- Shape (from `node_modules/groundswell/dist/core/prompt.d.ts`):
  `createPrompt({ user: string; system?: string; responseFormat: ZodType<T> })`.
- For a free-text commit message, `responseFormat: z.string()` → the agent's
  `r.data` is typed `string` on success.
- Example (mirrors prp-executor.ts:303):
  ```ts
  const prompt = createPrompt({
    user: `Generate a git commit message for the following staged diff.\n\n${diff}`,
    responseFormat: z.string(),
  });
  const r = await agent.prompt(prompt);
  ```

## 3. AgentResponse handling

- `agent.prompt(prompt)` → `Promise<AgentResponse<T>>` (groundswell
  `core/agent.d.ts:100`).
- Discriminated union (`types/agent.d.ts:225-321`):
  - `status: 'success'` → `data: T`, `error: null`
  - `status: 'error'`   → `data: null`, `error: AgentErrorDetails`
  - `status: 'partial'` → `data: T`, `error: null`
- Existing pattern (`src/agents/prp-generator.ts:725-731`):
  ```ts
  if (r.status === 'error') {
    throw new AgentError(`... failed: ${r.error?.message ?? 'unknown agent error'}`);
  }
  // r.data is now T (string) on 'success' or 'partial'
  ```
- **Gotcha**: existing code only checks `'error'`, letting `'partial'` fall
  through and use `r.data`. For commit-message gen that is acceptable (partial
  still carries usable text). But P3.M1.T4.S1 (retry) MUST treat the thrown
  `AgentError` as transient-API-sensitive (retryable) — see retry.ts:325
  `isTransientError` (PIPELINE_AGENT_LLM_FAILED / PIPELINE_AGENT_TIMEOUT are
  transient). So this task's contract: **throw `AgentError` on failure** so
  P3.M1.T4.S1 can wrap the call boundary with `retryAgentPrompt`.

## 4. Staged diff retrieval

- `src/tools/git-mcp.ts:367` `async function gitDiff(input): Promise<GitDiffResult>`
  with `input.staged ?? false`. When `staged: true`, runs `git.diff(['--cached'])`.
- Return shape: `{ success: boolean; diff?: string; error?: string }`.
- Exported at line ~666 (`export { gitStatus, gitDiff, gitAdd, gitCommit, ... }`).
- **PLACEMENT in smartCommit**: call `gitDiff({ path: repoRoot, staged: true })`
  AFTER `gitAdd` succeeds and BEFORE `gitCommit`. The diff MUST reflect what is
  actually staged (post-filter). Add `gitDiff` to the existing import line:
  `import { gitStatus, gitAdd, gitCommit, gitDiff } from '../tools/git-mcp.js';`

## 5. Retry boundary contract for P3.M1.T4.S1

- `retryAgentPrompt<T>(fn, context)` exists at `src/utils/retry.ts:651`.
  Signature: `<T>(fn: () => Promise<T>, context: { agentType; operation })`.
- This task (S1) does NOT add retry. It MUST expose a single clean call
  boundary that P3.M1.T4.S1 wraps:
  ```ts
  // git-commit.ts (this task) — the boundary P3.M1.T4.S1 wraps:
  export async function generateCommitMessage(diff: string): Promise<string>
  ```
  - Throws `AgentError` (from `src/utils/errors.ts` — import as the existing
    agents do) on any failure (agent error, empty diff, empty/whitespace-only
    output, parse failure). The thrown AgentError must carry a message that
    `isTransientError` classifies as transient (PIPELINE_AGENT_LLM_FAILED is
    hardcoded on AgentError — see retry.ts:340). P3.M1.T4.S1 will then wrap
    `generateCommitMessage` in `retryAgentPrompt` with bounded backoff.
- `COMMIT_RETRY_MAX` / `COMMIT_RETRY_DELAY` do **NOT** exist in
  `src/config/constants.ts` yet — that is P3.M1.T4.S1's job. This task adds
  neither config nor retry.