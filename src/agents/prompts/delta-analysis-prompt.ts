/**
 * Delta analysis prompt generator module
 *
 * @module agents/prompts/delta-analysis-prompt
 *
 * @remarks
 * Provides a type-safe prompt generator for the Delta Analysis workflow.
 * Compares PRD versions and generates structured delta analysis for task patching.
 */

// PATTERN: Import Groundswell prompt creation utilities
import { createPrompt, type Prompt } from 'groundswell';

// CRITICAL: Use .js extension for ES module imports
import type { DeltaAnalysis } from '../../core/models.js';
import { DeltaAnalysisSchema } from '../../core/models.js';

// PATTERN: Import system prompt from sibling prompts file
import {
  DELTA_ANALYSIS_PROMPT,
  PRD_PREMERGED_DECLARATION,
} from '../prompts.js';

/**
 * Construct the user prompt with PRD comparison data
 *
 * @param oldPRD - The previous PRD content
 * @param newPRD - The current PRD content
 * @param completedTaskIds - Optional list of completed task IDs
 * @returns Complete user prompt string with all comparison data
 *
 * @remarks
 * Builds a structured markdown prompt with:
 * - Previous PRD section
 * - Current PRD section
 * - Completed tasks section (conditionally included)
 * - System prompt content
 *
 * The completed tasks section is only included when the array is non-empty
 * to avoid noise when no work has been completed yet.
 *
 * @example
 * ```typescript
 * const userPrompt = constructUserPrompt(
 *   '## Old PRD\n...',
 *   '## New PRD\n...',
 *   ['P1.M1.T1', 'P1.M2.T1']
 * );
 * // Returns prompt with all three sections
 * ```
 */
function constructUserPrompt(
  oldPRD: string,
  newPRD: string,
  completedTaskIds?: string[]
): string {
  // Build completed tasks section
  const completedTasksSection =
    completedTaskIds !== undefined && completedTaskIds.length > 0
      ? `

## Completed Tasks

The following tasks have been completed and should be preserved unless critically affected:
${completedTaskIds.map(id => `- ${id}`).join('\n')}
`
      : '';

  // Construct the complete user prompt
  return `
${PRD_PREMERGED_DECLARATION}

## Previous PRD

${oldPRD}

## Current PRD

${newPRD}${completedTasksSection}

---

${DELTA_ANALYSIS_PROMPT}
`;
}

/**
 * Create a Delta Analysis prompt with structured DeltaAnalysis output
 *
 * @remarks
 * Returns a Groundswell Prompt configured with:
 * - user: PRD comparison context (old vs new)
 * - system: DELTA_ANALYSIS_PROMPT (Requirements Change Analyst)
 * - responseFormat: DeltaAnalysisSchema (type-safe JSON output)
 * - enableReflection: true (for complex delta analysis reliability)
 *
 * The function accepts two PRD versions and an optional list of completed
 * task IDs. The completed tasks list allows the delta analysis to preserve
 * work that shouldn't be re-executed unless critically affected by changes.
 *
 * The returned Prompt can be passed directly to agent.prompt():
 * ```typescript
 * const deltaAgent = createDeltaAgent();
 * const prompt = createDeltaAnalysisPrompt(oldPRD, newPRD, ['P1.M1.T1']);
 * const result = await deltaAgent.prompt(prompt);
 * // result is typed as z.infer<typeof DeltaAnalysisSchema> = DeltaAnalysis
 * ```
 *
 * @param oldPRD - The previous PRD markdown content
 * @param newPRD - The current PRD markdown content
 * @param completedTaskIds - Optional list of completed task IDs to preserve
 * @returns Groundswell Prompt object configured for Delta Analysis
 *
 * @example
 * ```typescript
 * import { createDeltaAnalysisPrompt } from './agents/prompts/delta-analysis-prompt.js';
 *
 * const oldPRD = '# My PRD v1\n...';
 * const newPRD = '# My PRD v2\n...';
 * const completedTasks = ['P1.M1.T1', 'P1.M2.T1'];
 *
 * const prompt = createDeltaAnalysisPrompt(oldPRD, newPRD, completedTasks);
 *
 * const analysis = await agent.prompt(prompt);
 * // analysis contains changes, patchInstructions, and taskIds
 * ```
 */
export function createDeltaAnalysisPrompt(
  oldPRD: string,
  newPRD: string,
  completedTaskIds?: string[]
): Prompt<DeltaAnalysis> {
  // PATTERN: Use createPrompt with responseFormat for structured output
  return createPrompt({
    // The user prompt contains the PRD comparison data
    user: constructUserPrompt(oldPRD, newPRD, completedTaskIds),

    // The system prompt is the Requirements Change Analyst persona
    system: DELTA_ANALYSIS_PROMPT,

    // CRITICAL: responseFormat enables type-safe structured output
    // Groundswell validates LLM output against this schema
    responseFormat: DeltaAnalysisSchema,

    // CRITICAL: Enable reflection for complex delta analysis
    // Reflection provides error recovery for structured output
    enableReflection: true,
  });
}
