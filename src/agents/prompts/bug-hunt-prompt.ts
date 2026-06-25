/**
 * Bug hunt prompt generator module
 *
 * @module agents/prompts/bug-hunt-prompt
 *
 * @remarks
 * Provides a type-safe prompt generator for the QA Bug Hunt workflow.
 * Generates adversarial testing prompts with PRD context and completion status.
 */

// PATTERN: Import Groundswell prompt creation utilities
import { createPrompt, type Prompt } from 'groundswell';
import { z } from 'zod';

// CRITICAL: Use .js extension for ES module imports
import type { TestResults, Task } from '../../core/models.js';
import { TestResultsSchema } from '../../core/models.js';

// PATTERN: Import system prompt from sibling prompts file
import { BUG_HUNT_PROMPT } from '../prompts.js';

/**
 * Construct the user prompt with PRD and completed tasks
 *
 * @param prd - The PRD markdown content
 * @param completedTasks - Array of completed Task objects
 * @returns Complete user prompt string with PRD context and BUG_HUNT_PROMPT
 *
 * @remarks
 * Builds a structured markdown prompt with:
 * - Original PRD section
 * - Completed Tasks section (with task listing)
 * - System prompt content (BUG_HUNT_PROMPT)
 *
 * The completed tasks section shows all work that has been completed,
 * allowing the QA agent to understand what was implemented and perform
 * targeted testing against those specific features.
 *
 * @example
 * ```typescript
 * const userPrompt = constructUserPrompt(
 *   '## My PRD\nBuild a feature.',
 *   [{ id: 'P1.M1.T1', title: 'Setup', status: 'Complete', description: '...', subtasks: [] }]
 * );
 * // Returns prompt with PRD and completed tasks list
 * ```
 */
function constructUserPrompt(prd: string, completedTasks: Task[]): string {
  // Build completed tasks list
  const tasksList =
    completedTasks.length > 0
      ? completedTasks
          .map(
            task =>
              `- ${task.id}: ${task.title}${
                task.description ? ` - ${task.description}` : ''
              }`
          )
          .join('\n')
      : 'No completed tasks yet';

  // Construct the complete user prompt
  return `
## Original PRD

${prd}

## Completed Tasks

${tasksList}

---

${BUG_HUNT_PROMPT}
`;
}

/**
 * Create a Bug Hunt prompt with structured TestResults output
 *
 * @remarks
 * Returns a Groundswell Prompt configured with:
 * - user: PRD content + completed tasks list + BUG_HUNT_PROMPT
 * - system: BUG_HUNT_PROMPT (QA Engineer persona)
 * - responseFormat: TestResultsSchema (type-safe JSON output)
 * - enableReflection: true (for thorough analysis reliability)
 *
 * The function accepts PRD content and an array of completed tasks.
 * The completed tasks list allows the QA agent to understand what
 * was implemented and perform targeted adversarial testing.
 *
 * The returned Prompt can be passed directly to agent.prompt():
 * ```typescript
 * const qaAgent = createQAAgent();
 * const prompt = createBugHuntPrompt(prd, completedTasks);
 * const result = await qaAgent.prompt(prompt);
 * // result is typed as z.infer<typeof TestResultsSchema> = TestResults
 * ```
 *
 * @param prd - The PRD markdown content to test against
 * @param completedTasks - Array of completed Task objects showing implementation progress
 * @returns Groundswell Prompt object configured for QA Bug Hunt
 *
 * @example
 * ```typescript
 * import { createBugHuntPrompt } from './agents/prompts/bug-hunt-prompt.js';
 *
 * const prd = '# My PRD\n## Requirements\nBuild a feature.';
 * const completedTasks = [
 *   {
 *     id: 'P1.M1.T1',
 *     title: 'Initialize Project',
 *     status: 'Complete',
 *     description: 'Setup project structure',
 *     subtasks: []
 *   }
 * ];
 *
 * const prompt = createBugHuntPrompt(prd, completedTasks);
 * const results = await qaAgent.prompt(prompt);
 * // results contains hasBugs, bugs, summary, recommendations
 * ```
 */
export function createBugHuntPrompt(
  prd: string,
  completedTasks: Task[],
  outputPath?: string
): Prompt<TestResults> {
  // FILE-AS-CONTRACT: reasoning models (glm-5.2) reliably WRITE files but do
  // NOT reliably honor responseFormat for structured JSON in the conversation.
  // When outputPath is provided, instruct the agent to write its TestResults
  // JSON there; the caller reads the file back and validates it. The prior
  // responseFormat-only path failed with VALIDATION_ERROR ('Expected object,
  // received string') because the model returned prose markdown instead of
  // JSON — the exact bug already fixed for the architect/researcher agents.
  const fileBanner =
    outputPath !== undefined
      ? `## ⚠️ DELIVERABLE — READ FIRST (overrides any conflicting instruction below)

Your FINAL deliverable is a JSON object written to this file:

    ${outputPath}

Use your file-write tool to create that file with a single JSON object matching:
{ "hasBugs": boolean, "bugs": [{ "id": string, "title": string, "severity": "critical"|"major"|"minor"|"cosmetic", "description": string, "reproduction": string, "expected": string, "actual": string, "location": string, "suggestedFix": string }], "summary": string, "recommendations": string[] }

Write ONLY valid JSON to that file (no markdown fence). After writing, return a one-line confirmation like "Bug report written to <path>". The JSON in the file is the ONLY thing the system reads.

---

`
      : '';

  // Build the config. responseFormat is REQUIRED by PromptConfig, but when
  // using file-as-contract the file is the source of truth — so use a
  // permissive z.unknown() (mirrors the architect pattern) so the agent's
  // one-line confirmation doesn't trip JSON validation.
  const prompt = createPrompt({
    user: fileBanner + constructUserPrompt(prd, completedTasks),
    system: BUG_HUNT_PROMPT,
    responseFormat: outputPath !== undefined ? z.unknown() : TestResultsSchema,
    enableReflection: true,
  });
  // When using file-as-contract the response is a free-form confirmation, not
  // TestResults — but the caller treats the FILE as the contract, so cast the
  // prompt type to satisfy the Prompt<TestResults> signature.
  return prompt as Prompt<TestResults>;
}
