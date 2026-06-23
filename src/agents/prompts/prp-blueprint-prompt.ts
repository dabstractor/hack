/**
 * PRP blueprint prompt generator module
 *
 * @module agents/prompts/prp-blueprint-prompt
 *
 * @remarks
 * Provides a type-safe prompt generator for the Researcher Agent.
 * Extracts hierarchical context from Backlog and generates Groundswell prompts
 * for PRP (Product Requirement Prompt) creation.
 */

// PATTERN: Import Groundswell prompt creation utilities
import { createPrompt, type Prompt } from 'groundswell';
import { z } from 'zod';

// CRITICAL: Use .js extension for ES module imports
import type {
  Backlog,
  Phase,
  Milestone,
  Task,
  Subtask,
} from '../../core/models.js';
import { PRP_BLUEPRINT_PROMPT } from '../prompts.js';

// PATTERN: Import task utilities for context extraction
import {
  findItem,
  getDependencies,
  isSubtask,
  type HierarchyItem,
} from '../../utils/task-utils.js';

/**
 * Type guard to check if an item has a description field
 *
 * @param item - The item to check
 * @returns True if the item has a description field (Phase, Milestone, or Task)
 *
 * @remarks
 * Subtask does not have a description field, so we need a type guard
 * to safely access the description property.
 */
function hasDescription(item: HierarchyItem): item is Phase | Milestone | Task {
  return (
    item.type === 'Phase' || item.type === 'Milestone' || item.type === 'Task'
  );
}

/**
 * Extract parent context descriptions from the task hierarchy
 *
 * @param taskId - The ID of the task/subtask to extract context for
 * @param backlog - The full Backlog for searching parent items
 * @returns String containing parent descriptions (Phase, Milestone, Task)
 *
 * @remarks
 * Parses the task ID to traverse the hierarchy (e.g., "P2.M2.T2.S2" -> P2, P2.M2, P2.M2.T2).
 * Uses findItem() to locate each parent and extract their description fields.
 *
 * @example
 * ```typescript
 * const parentContext = extractParentContext('P2.M2.T2.S2', backlog);
 * // Returns: "Phase 2: Core Agent System\nMilestone 2: PRP System\nTask 2: Create PRP Generation Prompts"
 * ```
 */
function extractParentContext(taskId: string, backlog: Backlog): string {
  const parts = taskId.split('.');
  const contexts: string[] = [];

  // Extract context from each level (Phase, Milestone, Task)
  // Start from the second-to-last part and work up to Phase (inclusive)
  for (let i = parts.length - 2; i >= 0; i--) {
    const parentId = parts.slice(0, i + 1).join('.');
    const parent = findItem(backlog, parentId);
    if (parent && hasDescription(parent)) {
      contexts.push(`${parent.type}: ${parent.description}`);
    }
  }

  return contexts.join('\n');
}

/**
 * Extract task/subtask context including dependencies
 *
 * @param task - The Task or Subtask to extract context from
 * @param backlog - The full Backlog for dependency resolution
 * @returns String containing the task description and dependency context
 *
 * @remarks
 * For Subtasks, includes dependency IDs resolved using getDependencies().
 * For Tasks, includes the description field directly.
 *
 * @example
 * ```typescript
 * const context = extractTaskContext(subtask, backlog);
 * // Returns: "Task: Create PRP Blueprint Prompt\nDependencies: P2.M2.T2.S1, P2.M2.T2.S1"
 * ```
 */
function extractTaskContext(task: Task | Subtask, backlog: Backlog): string {
  if (isSubtask(task)) {
    // Subtask-specific: extract dependencies and context_scope
    const deps = getDependencies(task, backlog);
    const depIds = deps.map(d => d.id).join(', ') || 'None';

    return `Task: ${task.title}
Dependencies: ${depIds}
Context Scope: ${task.context_scope}`;
  }

  // Task-specific: use description field
  return `Task: ${task.title}
Description: ${task.description}`;
}

/**
 * Construct the user prompt with task context and placeholders replaced
 *
 * @param task - The Task or Subtask to generate context for
 * @param backlog - The full Backlog for context extraction
 * @param codebasePath - Optional codebase path for analysis instructions
 * @param issueFeedback - Optional feedback string for re-planning (PRD §4.5). When provided and non-empty,
 *   a clearly-delimited `<issue_feedback>…</issue_feedback>` block is injected into the user prompt
 *   so the Researcher addresses the prior planning gap. When omitted or empty, the prompt is unchanged.
 * @returns Complete user prompt string with all placeholders replaced
 *
 * @remarks
 * Replaces <item_title> and <item_description> placeholders in PRP_BLUEPRINT_PROMPT.
 * Includes parent context, task context, optional codebase path, and optional issue feedback.
 *
 * @example
 * ```typescript
 * const userPrompt = constructUserPrompt(
 *   subtask,
 *   backlog,
 *   '/home/dustin/projects/hacky-hack'
 * );
 * // Returns prompt with placeholders replaced and full context injected
 * ```
 */
function constructUserPrompt(
  task: Task | Subtask,
  backlog: Backlog,
  codebasePath?: string,
  prpOutputPath?: string,
  issueFeedback?: string
): string {
  // Extract the description based on task type
  // For Subtask: use context_scope (always present)
  // For Task: use description if present, otherwise fallback to title
  const itemDescription = isSubtask(task)
    ? task.context_scope
    : task.description.length > 0
      ? task.description
      : task.title;

  // Build parent context string
  const parentContext = extractParentContext(task.id, backlog);

  // Build task context string
  const taskContext = extractTaskContext(task, backlog);

  // Add codebase path if provided
  const codebaseSection =
    codebasePath !== undefined && codebasePath.length > 0
      ? `

## Codebase Analysis

The codebase is located at: ${codebasePath}

Use this path to analyze the codebase structure and identify relevant files for this work item.`
      : '';

  // Use parent context if available, otherwise provide default message
  const parentContextDisplay =
    parentContext.length > 0
      ? parentContext
      : 'No parent context (root level item)';

  // Build issue feedback section — '' when undefined/empty (byte-identical no-feedback path)
  const feedbackSection =
    issueFeedback !== undefined && issueFeedback.length > 0
      ? `

## Issue Feedback (Re-planning)

This is a **re-planning attempt** after a previous implementation reported an issue (a recoverable planning gap).
**CRITICAL**: You MUST address the feedback below in your revised PRP — do not repeat the prior approach unchanged.

<issue_feedback>
${issueFeedback}
</issue_feedback>`
      : '';

  // Construct the complete user prompt
  const writeFileBanner =
    prpOutputPath !== undefined
      ? `## ⚠️ DELIVERABLE — READ FIRST (overrides any conflicting instruction below)

Your FINAL deliverable is a JSON object written to this file:

    ${prpOutputPath}

Use your file-write tool to create that file with a single JSON object matching:
{ "taskId": string, "objective": string, "context": string, "implementationSteps": string[], "validationGates": [{"level":string,"command":string|null}], "successCriteria": [{"description":string}], "references": string[] }

Do NOT put the JSON in your chat reply. Do NOT wrap it in markdown. WRITE IT TO THE FILE. Your chat reply should be a one-line confirmation like "PRP written to <path>". The JSON in the file is the ONLY thing the system reads.

---

`
      : '';

  return `${writeFileBanner}# Work Item Context

## Task Information

**Title**: ${task.title}
**Description**: ${itemDescription}

${taskContext}

## Parent Context

${parentContextDisplay}

${codebaseSection}${feedbackSection}

---

${PRP_BLUEPRINT_PROMPT}
`;
}

/**
 * Create a Researcher Agent prompt with structured PRP output
 *
 * @remarks
 * Returns a Groundswell Prompt configured with:
 * - user: Task context with placeholders replaced and parent hierarchy included
 * - system: PRP_BLUEPRINT_PROMPT (Researcher persona)
 * - responseFormat: PRPDocumentSchema (ensures type-safe JSON output)
 * - enableReflection: true (for complex PRP generation reliability)
 *
 * The function extracts hierarchical context from the Backlog including:
 * - Task/subtask title and description
 * - Parent item descriptions (Phase, Milestone, Task)
 * - Dependency context (for Subtasks)
 * - context_scope contract definition (for Subtasks)
 *
 * The returned Prompt can be passed directly to agent.prompt():
 * ```typescript
 * const researcher = createResearcherAgent();
 * const prompt = createPRPBlueprintPrompt(task, backlog, '/path/to/codebase');
 * const result = await researcher.prompt(prompt);
 * // result is typed as z.infer<typeof PRPDocumentSchema> = PRPDocument
 * ```
 *
 * @param task - The Task or Subtask to generate a PRP for
 * @param backlog - The full Backlog for context extraction
 * @param codebasePath - Optional codebase path for codebase analysis instructions
 * @param issueFeedback - Optional feedback string for re-planning (PRD §4.5). When provided and non-empty,
 *   a `<issue_feedback>…</issue_feedback>` block is injected into the user prompt so the Researcher
 *   directly addresses the reported gap. When omitted or empty, the prompt is unchanged.
 * @returns Groundswell Prompt object configured for Researcher Agent
 *
 * @example
 * ```typescript
 * import { createPRPBlueprintPrompt } from './agents/prompts/prp-blueprint-prompt.js';
 * import { findItem } from './utils/task-utils.js';
 *
 * const backlog = JSON.parse(fs.readFileSync('tasks.json', 'utf8'));
 * const subtask = findItem(backlog, 'P2.M2.T2.S2') as Subtask;
 *
 * const prompt = createPRPBlueprintPrompt(
 *   subtask,
 *   backlog,
 *   '/home/dustin/projects/hacky-hack'
 * );
 *
 * const prpDocument = await agent.prompt(prompt);
 * // prpDocument contains the structured PRP with all context
 * ```
 */
export function createPRPBlueprintPrompt(
  task: Task | Subtask,
  backlog: Backlog,
  codebasePath?: string,
  prpOutputPath?: string,
  issueFeedback?: string
): Prompt<unknown> {
  // Substitute the output path into the system prompt so the researcher knows
  // EXACTLY where to write the PRP JSON. Without this the prompt's vague
  // "path specified in your instructions" never resolves, and the agent either
  // writes to the wrong location or returns markdown prose (which fails
  // responseFormat validation). The file is the contract (mirrors the
  // architect pattern), so responseFormat is permissive (z.unknown()).
  const systemPrompt =
    prpOutputPath !== undefined
      ? PRP_BLUEPRINT_PROMPT.replace(
          // Tell the agent the absolute output path.
          /Store the PRP and documentation at the path specified in your instructions\./,
          `You MUST write your final PRP as a JSON object to the file: ${prpOutputPath}\nThe JSON must match the schema: { taskId, objective, context, implementationSteps[], validationGates[], successCriteria[], references[] }. Write ONLY valid JSON to that file (no markdown fence). After writing, return a brief one-line confirmation.`
        )
      : PRP_BLUEPRINT_PROMPT;

  return createPrompt({
    // The user prompt contains the task context with placeholders replaced
    user: constructUserPrompt(
      task,
      backlog,
      codebasePath,
      prpOutputPath,
      issueFeedback
    ),

    // The system prompt is the PRP_BLUEPRINT_PROMPT (Researcher persona)
    system: systemPrompt,

    // Permissive schema — the FILE is the contract (mirrors the architect).
    responseFormat: z.unknown(),
  });
}
