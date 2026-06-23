/**
 * Architect prompt generator module
 *
 * @module agents/prompts/architect-prompt
 *
 * @remarks
 * Provides a type-safe prompt generator for the Architect Agent.
 * Uses Groundswell's createPrompt() with BacklogSchema for structured output.
 */

import { createPrompt, type Prompt } from 'groundswell';
import { z } from 'zod';

// PATTERN: Import system prompt from sibling prompts file
import { TASK_BREAKDOWN_PROMPT } from '../prompts.js';

/**
 * Create an Architect Agent prompt with structured Backlog output
 *
 * @remarks
 * Returns a Groundswell Prompt configured with:
 * - user: The PRD content (provided as parameter)
 * - system: TASK_BREAKDOWN_PROMPT (LEAD TECHNICAL ARCHITECT persona)
 * - responseFormat: BacklogSchema (ensures type-safe JSON output)
 * - enableReflection: true (for complex decomposition reliability)
 *
 * When `sessionPath` is provided, the `$TASKS_FILE` and `$SESSION_DIR`
 * placeholders baked into `TASK_BREAKDOWN_PROMPT` are substituted with
 * absolute filesystem paths. Without this, the placeholders are emitted
 * verbatim, the agent has no idea where to write, and `decomposePRD()`'s
 * follow-up `readFile(<session>/tasks.json)` throws ENOENT.
 *
 * The returned Prompt can be passed directly to agent.prompt():
 * ```typescript
 * const architect = createArchitectAgent();
 * const prompt = createArchitectPrompt(prdContent, sessionPath);
 * const result = await architect.prompt(prompt);
 * // result is typed as z.infer<typeof BacklogSchema> = Backlog
 * ```
 *
 * @param prdContent - The PRD markdown content to analyze
 * @param sessionPath - Absolute path to the active session directory (used to
 *   resolve `$TASKS_FILE` / `$SESSION_DIR` in the system prompt)
 * @returns Groundswell Prompt object configured for Architect Agent
 *
 * @example
 * ```typescript
 * import { createArchitectPrompt } from './agents/prompts/architect-prompt.js';
 *
 * const prd = '# My PRD\n...';
 * const prompt = createArchitectPrompt(prd, '/abs/plan/001_abc');
 * const { backlog } = await agent.prompt(prompt);
 * ```
 */
export function createArchitectPrompt(
  prdContent: string,
  sessionPath?: string
): Prompt<unknown> {
  // Substitute the path placeholders baked into TASK_BREAKDOWN_PROMPT so the
  // agent writes artifacts to the active session directory (absolute paths are
  // cwd-independent — the architect runs with cwd = project root).
  const systemPrompt =
    sessionPath !== undefined
      ? TASK_BREAKDOWN_PROMPT.replace(
          /\.\$TASKS_FILE|\$TASKS_FILE/g,
          `${sessionPath.replace(/\/$/, '')}/tasks.json`
        ).replace(/\$SESSION_DIR/g, sessionPath.replace(/\/$/, ''))
      : TASK_BREAKDOWN_PROMPT;

  // NOTE: No strict responseFormat / no enableReflection here — by design.
  // TASK_BREAKDOWN_PROMPT instructs the agent to WRITE the JSON to $TASKS_FILE
  // and NOT emit it to the conversation; the decomposePRD() caller reads that
  // file back via readFile(). A strict `responseFormat: BacklogSchema` would
  // contradict that instruction: it forces a structured object in the
  // conversational response AND makes Groundswell validate it, so the agent's
  // (correct) text summary fails validation with "Expected object, received
  // string" and decomposePRD() throws before it ever reads the file. The FILE
  // is the contract. `responseFormat: z.unknown()` satisfies PromptConfig's
  // required field while making validation a permissive no-op.
  return createPrompt({
    // The user prompt is the PRD content to analyze
    user: prdContent,

    // The system prompt is the LEAD TECHNICAL ARCHITECT persona
    system: systemPrompt,

    // Permissive schema — the real contract is the tasks.json file the agent writes.
    responseFormat: z.unknown(),
  });
}
