# Research Summary — P4.M1.T1.S1: COSMETIC/SUBSTANTIVE & CLEAN/DIRTY LLM Classifiers

Source scouts: `scout1-llm-call-patterns.md`, `scout2-retry-logger-scripts.md`,
`scout3-test-conventions.md`. This file distills the load-bearing facts for PRP authoring.

## VERDICT — net-new module, no existing classifier

Searched `src/` + `tests/` case-insensitively for
`classifier|classification|COSMETIC|SUBSTANTIVE|DIRTY|CLEAN|classifyChange|classifyArtifact|classifyDiff`.
**Nothing matches.** The only `classify*` functions are unrelated domains:
`task-retry-manager.ts:369 classifyError`, `eslint-error-verifier.ts:183 classifyErrors`,
`pass-rate-analyzer.ts:365 classifyFailures`. `cosmetic` exists only as a `BugSeverity` literal
(`models.ts:1749`) and a few-shot label in `prompts.ts:903`. `dirty` is a private batching flag
(`session-manager.ts:175 #dirty`). **`src/core/change-classifier.ts` is net-new** (the path
named in the item contract). Phase findings confirm: "LLM COSMETIC/SUBSTANTIVE + CLEAN/DIRTY
classifiers with transient-API retry + protective default" is required work.

## SCOPE BOUNDARY — S1 vs S2 (CRITICAL)

The item description splits the contract across **two subtasks**:
- **P4.M1.T1.S1 (THIS PRP)** = "COSMETIC/SUBSTANTIVE and CLEAN/DIRTY LLM classifiers" — the two
  classifier functions + prompt templates + JSDoc. **Basic LLM-call happy/error paths only.**
- **P4.M1.T1.S2** = "Transient-API retry and protective default on exhaustion" — the bounded
  retry (default 4) + the fail-to-protective-default (SUBSTANTIVE / DIRTY) on exhaustion.

**This PRP (S1) MUST NOT implement the retry/protective-default logic** — that is S2's contract.
S1 implements: the two classifier functions that make an LLM call, return the classification,
handle the invalid-response case (unparseable → throw a typed error that S2 will catch and retry),
and the prompt templates. S1's functions are the **inner call** that S2's retry loop wraps. So
S1's contract is satisfied by: a function that (a) builds a prompt, (b) calls the agent, (c)
parses the validated response, (d) throws a clearly-typed error on invalid/empty model output
(which S2 will classify as transient and retry). The "protective default on exhaustion" is S2.

This separation is load-bearing: S1 must expose a clean throwing boundary so S2 can wrap it.

## The canonical LLM-call recipe (5 steps)

Every LLM call in this codebase follows this shape (delta-analysis-workflow.ts:118-170):

```ts
// 1. Create the agent (factory returns configured groundswell Agent)
const agent = createQAAgent();   // or a dedicated lightweight factory

// 2. Build a typed Prompt<T> via a prompts/<name>-prompt.ts generator
const prompt = createXxxPrompt(input);

// 3. Invoke through retryAgentPrompt (NEVER bare .prompt())
const agentResponse = await retryAgentPrompt(
  () => agent.prompt(prompt),
  { agentType: 'QA', operation: 'xxx' }
);

// 4. Discriminate on agentResponse.status
if (agentResponse.status !== 'success' || agentResponse.data === null) {
  throw new Error(`agent failed: ${agentResponse.error?.message ?? 'unknown'}`);
}

// 5. Use agentResponse.data (typed T)
```

**BUT** — `retryAgentPrompt` IS the retry layer. Since S1 must NOT own the retry (S2 does), S1
calls `agent.prompt(prompt)` DIRECTLY (no `retryAgentPrompt` wrapper), and throws on non-success
or invalid data. S2 (next subtask) will wrap S1's function in `retryAgentPrompt` (or its own
retry loop with the protective default). The `commit-message-agent.ts` → `generateCommitMessage`
pattern in `git-commit.ts:190-220` is the precedent: the agent call is bare, and the retry
boundary (`P3.M1.T4.S1`) wraps `generateCommitMessage` itself externally.

## AgentResponse<T> shape (groundswell) — the return of agent.prompt()

From `node_modules/groundswell/dist/types/agent.d.ts`:
```ts
type AgentResponse<T> =
  | { status: 'success'; data: T; error: null; metadata }
  | { status: 'error';   data: null; error: AgentErrorDetails; metadata }
  | { status: 'partial'; data: T; error: null; metadata };
```
- `data` is the validated payload (typed T from responseFormat Zod schema), or null on error.
- NO `.content` field. NO bare string return. The validated payload is `.data`.
- `AgentErrorDetails` = `{ code: string; message: string; recoverable: boolean; details? }`.

## createPrompt signature (groundswell)

From `node_modules/groundswell/dist/types/prompt.d.ts`:
```ts
interface PromptConfig<T> {
  user: string;                          // REQUIRED
  responseFormat: z.ZodType<T>;          // REQUIRED (Zod schema)
  system?: string;
  enableReflection?: boolean;
}
```
- Structured JSON output: `responseFormat: DomainSchema` → `.data` validated.
- Text output: `responseFormat: z.string()` → `.data` is the string (commit-message pattern).

**Decision for S1:** Use `responseFormat` with a Zod enum schema so Groundswell validates the
classification string. This is cleaner than text+parse and matches the delta-analysis structured
pattern. Define `ChangeClassification = 'COSMETIC' | 'SUBSTANTIVE'` + `ChangeClassificationSchema`
and `ArtifactClassification = 'CLEAN' | 'DIRTY'` + `ArtifactClassificationSchema` in the
classifier module (mirrors `StatusEnum`/`Status` dual-declaration in models.ts:200).

## Prompt registration — TWO layers, both required for a new prompt

**Layer A — `src/agents/prompts.ts` (string-constant system prompt):** add
`CHANGE_CLASSIFIER_PROMPT` const (prepended with `PRD_PREMERGED_DECLARATION`). Add to the
`PROMPTS` lookup + `PromptKey` type. Existing constants: `DELTA_ANALYSIS_PROMPT` (prompts.ts:821),
`CLEANUP_PROMPT` (prompts.ts:1094), `DELTA_PRD_PROMPT` (prompts.ts:770).

**Layer B — `src/agents/prompts/change-classifier-prompt.ts` (typed Prompt<T> generator):**
create `createChangeClassificationPrompt(diffSummary)` and
`createArtifactClassificationPrompt(content)` returning `Prompt<ChangeClassification>` /
`Prompt<ArtifactClassification>`. Mirror `delta-analysis-prompt.ts` structure exactly:
`constructUserPrompt()` private helper + exported `createXxxPrompt()`. Re-export from
`src/agents/prompts/index.ts`.

## The agent factory decision — reuse createQAAgent vs a dedicated lightweight agent

Item contract: "Both use an LLM call (via createQAAgent or a dedicated lightweight agent)."
The commit-message-agent pattern (`agent-factory.ts`, lightweight, `createBaseConfig('researcher','research')`
+ `maxTokens:512`, `enableReflection:false`, `enableCache:false`, `stateless:true`) is the right
template — a classification is a single-shot, no-tools, no-reflection call. BUT adding a new
persona to `agent-factory.ts` requires extending `AgentPersona` union, `PERSONA_TOKEN_LIMITS`,
and `STATELESS_PERSONAS` — and S2 (in parallel) may also touch agent-factory. **To minimize
contention with S2 and with the parallel P3.M2.T6.S2 (which owns temp-prompt-cleanup, not
agent-factory), S1 should reuse the existing `createResearcherAgent()` (research role, balanced
tier, normal budget — a classification is a low-research-judgement task) OR `createQAAgent()`
(reasoning role, xhigh — heavier).** The item explicitly permits `createQAAgent`. Given a
classification is a reasoning-lite decision, **reuse `createQAAgent()`** (it already exists, no
agent-factory edit needed, zero contention). The classifier module imports `createQAAgent` from
`../agents/agent-factory.js`. This keeps S1's diff to: prompts.ts (const) + prompts/ subdir (new
file) + prompts/index.ts (re-export) + change-classifier.ts (new) + tests.

**Rationale for reuse over a new persona:** a new persona touches the shared `agent-factory.ts`
(which S2 and future P4.M1.T2 mid-session-update may also touch) → merge contention. Reusing
`createQAAgent()` is zero-contention and the item explicitly allows it. If a lighter agent is
desired later, a follow-up can add the persona; S1's contract only requires "an LLM call."

## Retry layer facts (for the S2 boundary this PRP sets up)

- `retryAgentPrompt<T>(fn, {agentType, operation})` — retry.ts:668-698. `maxAttempts:3` default.
- `isTransientError` — retry.ts:311-395. Treats as transient: `ECONNRESET/ECONNREFUSED/ETIMEDOUT`
  etc; HTTP `408/429/500/502/503/504`; messages with `timeout|rate limit|too many requests|
  connection reset|...`. Watchdog kill (exitCode 124 / timedOut:true) is TERMINAL. ValidationError
  is permanent. **NO empty-output detection** — empty output must surface as a thrown error to be
  retried. → S1's classifier MUST throw a typed error (not return silently) on empty/invalid model
  output, so S2's retry treats it as transient. `AgentError` with code
  `PIPELINE_AGENT_LLM_FAILED` is transient (unless message contains "parse"/"parsing").
- `AgentError`, `ErrorCodes`, `isPipelineError` from `../utils/errors.js`.

**S1's throwing contract for S2:** on invalid/empty/unparseable classification, throw an
`AgentError({ code: ErrorCodes.PIPELINE_AGENT_LLM_FAILED, message })` — transient by default,
retried by S2. S2 will then implement the "retry up to 4, then protective default" layer.

## Logger lazy pattern (every core module)

```ts
import { getLogger, type Logger } from '../utils/logger.js';
let _logger: Logger | undefined;
const logger = (): Logger => (_logger ??= getLogger('ChangeClassifier'));
```

## Test conventions (CRITICAL — 100% coverage enforced)

`vitest.config.ts`: `coverage.thresholds = { statements:100, branches:100, functions:100, lines:100 }`.
`pool: 'forks'`, `setupFiles: ['./tests/setup.ts']`, `include: ['tests/**/*.{test,spec}.ts']`.
`groundswell` alias → `../groundswell/dist/index.js`.

**Mocking strategy for the classifier module (Strategy A — the workflow pattern):**
```ts
vi.mock('../../../src/agents/agent-factory.js', () => ({
  createQAAgent: vi.fn(),
}));
vi.mock('../../../src/agents/prompts/change-classifier-prompt.js', () => ({
  createChangeClassificationPrompt: vi.fn(),
  createArtifactClassificationPrompt: vi.fn(),
}));
import { createQAAgent } from '../../../src/agents/agent-factory.js';
const mockCreateQAAgent = createQAAgent as any;
// per-test:
mockCreateQAAgent.mockReturnValue({
  prompt: vi.fn().mockResolvedValue({ status: 'success', data: 'SUBSTANTIVE', error: null, metadata: {} }),
});
```
**DiffSummary construction in tests:** inline literal (prd-differ.test.ts:498-567):
```ts
const diff: DiffSummary = {
  changes: [{ type: 'added', sectionTitle: 'X', lineNumber: 1, newContent: '...', impact: 'low' }],
  summaryText: '...',
  stats: { totalAdded: 1, totalModified: 0, totalRemoved: 0, sectionsAffected: ['X'] },
};
```
Test style: `describe` → `GIVEN` → `it('SHOULD')` → `// SETUP // EXECUTE // VERIFY` comment blocks.

## npm scripts (exact)

- `validate` = `npm run lint && npm run format:check && npm run typecheck && npm run test:run`
- `lint` = `eslint . --ext .ts`
- `format:check` = `prettier --check "**/*.{ts,js,json,md,yml,yaml}"`
- `typecheck` = `tsc --noEmit -p tsconfig.build.json`
- `test:run` = `vitest run`; `test:coverage` = `vitest run --coverage`

## models.ts dual-declaration convention for a new union

```ts
export type ChangeClassification = 'COSMETIC' | 'SUBSTANTIVE';
export const ChangeClassificationEnum = z.enum(['COSMETIC', 'SUBSTANTIVE']);
```
Re-export both type + schema from `src/core/index.ts` (type in `export type {}`, schema in
`export {}`). **Decision:** define the classification types IN the new `change-classifier.ts`
module (they are the module's own output contract and tightly coupled to the classifier), NOT in
models.ts — this keeps S1's diff self-contained (no models.ts edit, less contention) and the types
are co-located with the functions that produce them. S2 will import them from change-classifier.ts.

## Phase findings corroboration (architecture/phase_findings.md §PHASE 4)

> "LLM COSMETIC/SUBSTANTIVE + CLEAN/DIRTY classifiers with transient-API retry + protective
> default." Also: "hasSignificantChanges() is exported but never called" (dead code) and
> "DELTA_PRD_PROMPT is DEAD CODE." The classifier is the LLM layer OVER diffPRDs()'s structural
> DiffSummary (item contract LOGIC (c): "The classifier receives the structural diff summary from
> diffPRDs() as input").

## PRD §4.3 mandate (the governing requirement)

> "Detected changes are classified by an LLM-driven binary classifier as COSMETIC (trivial:
> whitespace/formatting) or SUBSTANTIVE (semantically significant). A parallel CLEAN/DIRTY
> classifier guards generated artifacts (e.g., the delta PRD). These classifiers MUST distinguish
> transient API failures (empty output, connection errors, rate limits, overloaded) from invalid
> model responses, retrying up to a bounded count (default 4) before giving up. On exhaustion they
> MUST fail to the protective/conservative default (treat as SUBSTANTIVE / DIRTY)..."

**S1 scope** (the classifier + prompts): the LLM-driven classification + the invalid-vs-transient
throwing boundary. **S2 scope** (next subtask): the bounded retry (4) + protective default.

## Files S1 touches (the diff)

NEW: `src/core/change-classifier.ts`
NEW: `src/agents/prompts/change-classifier-prompt.ts`
NEW: `tests/unit/core/change-classifier.test.ts`
MODIFY: `src/agents/prompts.ts` (add `CHANGE_CLASSIFIER_PROMPT` const + `PROMPTS`/`PromptKey`)
MODIFY: `src/agents/prompts/index.ts` (re-export the two prompt generators)

NO edit to: agent-factory.ts (reuse createQAAgent), models.ts (types co-located in the module),
prd-differ.ts (consume DiffSummary read-only), retry.ts (S2 owns retry), any workflow/CLI.