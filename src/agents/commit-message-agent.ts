/**
 * Stagecoach commit-message generation agent
 *
 * @module agents/commit-message-agent
 *
 * @remarks
 * Thin factory that builds a lightweight Groundswell agent for generating
 * descriptive conventional-commit messages from a staged diff (PRD §5.1
 * "Smart Commit Resilience" — the `stagecoach` LLM tool).
 *
 * **Design decisions (PRP P3.M1.T3.S1)**:
 * - Reuses {@link createBaseConfig} with persona `'researcher'` and role
 *   `'research'` (balanced tier, normal budget, full harness/env wiring) —
 *   NO expansion of the `AgentPersona` union or `PERSONA_TOKEN_LIMITS`.
 * - Carries NO MCP tools: the agent reads the diff from the prompt text, so
 *   tool access would only let it re-read files (slow, leaky, unnecessary).
 * - `enableReflection: false` — single-shot generation; a reflection loop would
 *   add a second LLM round-trip for a trivial task.
 * - `enableCache: false` — every diff is unique, so cache never hits and would
 *   only waste a round-trip.
 * - `maxTokens: 512` — a commit message is tiny; keeps the call cheap and fast.
 *
 * The agent emits ONLY the commit message (subject + optional body). The caller
 * (`generateCommitMessage` in `src/utils/git-commit.ts`) wraps the output with
 * the `[PRP Auto]` prefix and `Co-Authored-By` trailer via `formatCommitMessage`.
 * The system prompt forbids the agent from emitting the prefix/trailer.
 *
 * This is the generation boundary that P3.M1.T4.S1 wraps with retry. The
 * generation call is transient-API-sensitive — a generation timeout is LLM-API
 * slowness, not a stuck subprocess — so the boundary throws `AgentError`
 * (hardcoded `PIPELINE_AGENT_LLM_FAILED` → classified transient by
 * `isTransientError`) on every failure mode.
 *
 * @example
 * ```typescript
 * import { createCommitMessageAgent } from './agents/commit-message-agent.js';
 * import { createPrompt } from 'groundswell';
 * import { z } from 'zod';
 *
 * const agent = createCommitMessageAgent();
 * const prompt = createPrompt({ user: '<diff here>', responseFormat: z.string() });
 * const r = await agent.prompt(prompt);
 * if (r.status === 'success') {
 *   console.log(r.data); // 'feat(api): add endpoint'
 * }
 * ```
 */

import { createAgent, type Agent } from 'groundswell';
import { createBaseConfig } from './agent-factory.js';
import { getLogger } from '../utils/logger.js';

let _logger: ReturnType<typeof getLogger> | undefined;
const logger = () => (_logger ??= getLogger('CommitMessageAgent'));

/**
 * System prompt instructing the agent to emit a conventional-commit message.
 *
 * @remarks
 * Mirrors the Conventional Commits 1.0.0 spec
 * (https://www.conventionalcommits.org/en/v1.0.0/). Hard rules ensure the
 * output is a bare message the caller can wrap with `formatCommitMessage`
 * (which adds the `[PRP Auto]` prefix and `Co-Authored-By` trailer) — a verbose
 * agent output would corrupt the commit.
 */
const COMMIT_MESSAGE_SYSTEM = `You generate concise git commit messages from staged diffs.

Follow Conventional Commits (https://www.conventionalcommits.org/):
- Type prefix: feat, fix, refactor, docs, chore, test, perf, build, ci.
- Subject line in imperative mood, ≤72 characters, no trailing period.
- Optional blank line + body explaining WHY (not WHAT — the diff shows what).
- If a work-item id appears in changed paths (e.g. P3.M1.T3.S1), reference it in the subject.

HARD RULES:
- Output ONLY the commit message (subject + optional body). No explanation.
- No markdown fences, no leading/trailing whitespace, no preamble.
- Do NOT include "[PRP Auto]", "Co-Authored-By", or any trailer — the caller adds those.
- If the diff is empty or whitespace-only, output the single word "skip".`;

/**
 * Create the stagecoach commit-message-generation agent.
 *
 * @remarks
 * Returns a lightweight Groundswell {@link Agent} configured for single-shot
 * commit-message generation. Reuses the `researcher` persona (balanced tier)
 * via {@link createBaseConfig} and overrides the name, system prompt, and token
 * budget — NO `mcps` field (the agent reads the diff from the prompt text).
 *
 * @returns Configured Groundswell Agent instance.
 *
 * @example
 * ```typescript
 * const agent = createCommitMessageAgent();
 * const prompt = createPrompt({ user: diff, responseFormat: z.string() });
 * const r = await agent.prompt(prompt);
 * ```
 */
export function createCommitMessageAgent(): Agent {
  const baseConfig = createBaseConfig('researcher', 'research');
  const config = {
    ...baseConfig,
    name: 'CommitMessageAgent',
    system: COMMIT_MESSAGE_SYSTEM,
    maxTokens: 512,
    enableReflection: false,
    enableCache: false,
  };
  logger().debug(
    { persona: 'researcher', model: config.model },
    'Creating commit-message agent'
  );
  return createAgent(config);
}
