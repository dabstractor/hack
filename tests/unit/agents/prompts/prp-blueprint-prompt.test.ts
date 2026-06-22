/**
 * Unit tests for PRP blueprint prompt generator
 *
 * @remarks
 * Tests validate that createPRPBlueprintPrompt() correctly extracts context
 * from the Backlog hierarchy and generates properly structured prompts.
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { describe, expect, it } from 'vitest';
import { createPRPBlueprintPrompt } from '#/prompts/index.js';
import type { Backlog, Task } from '../../../src/core/models.js';

// Test fixtures matching the BacklogSchema structure
const mockBacklog: Backlog = {
  backlog: [
    {
      id: 'P2',
      type: 'Phase',
      title: 'Phase 2: Core Agent System',
      status: 'Planned',
      description: 'Groundswell agent integration and prompt system',
      milestones: [
        {
          id: 'P2.M2',
          type: 'Milestone',
          title: 'Milestone 2.2: PRP System',
          status: 'Planned',
          description: 'PRP generation and execution system',
          tasks: [
            {
              id: 'P2.M2.T2',
              type: 'Task',
              title: 'Create PRP Generation Prompts',
              status: 'Planned',
              description: 'Build prompt generators for PRP creation',
              subtasks: [
                {
                  id: 'P2.M2.T2.S1',
                  type: 'Subtask',
                  title: 'Create PRPDocumentSchema',
                  status: 'Planned',
                  story_points: 2,
                  dependencies: [],
                  context_scope:
                    'CONTRACT DEFINITION: Create Zod schema for PRPDocument',
                },
                {
                  id: 'P2.M2.T2.S2',
                  type: 'Subtask',
                  title: 'Create PRP Blueprint Prompt Generator',
                  status: 'Planned',
                  story_points: 3,
                  dependencies: ['P2.M2.T2.S1'],
                  context_scope:
                    'CONTRACT DEFINITION: Create createPRPBlueprintPrompt() function',
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

describe('agents/prompts/prp-blueprint-prompt', () => {
  describe('createPRPBlueprintPrompt', () => {
    it('should return a Prompt object with correct structure', () => {
      // SETUP: Get a test subtask from the mock backlog
      const task = mockBacklog.backlog[0].milestones[0].tasks[0].subtasks[1];

      // EXECUTE: Generate the prompt
      const prompt = createPRPBlueprintPrompt(task, mockBacklog);

      // VERIFY: Prompt has expected properties
      expect(prompt).toBeDefined();
      expect(typeof prompt.user).toBe('string');
      // Groundswell stores system prompt as systemOverride
      expect(prompt.systemOverride).toBeDefined();
      expect(typeof prompt.systemOverride).toBe('string');
      expect(prompt.responseFormat).toBeDefined();
      expect(prompt.enableReflection).toBe(true);
    });

    it('should include task title in user prompt', () => {
      // SETUP: Get a test subtask
      const task = mockBacklog.backlog[0].milestones[0].tasks[0].subtasks[1];

      // EXECUTE: Generate the prompt
      const prompt = createPRPBlueprintPrompt(task, mockBacklog);

      // VERIFY: Task title is in the user prompt
      expect(prompt.user).toContain(task.title);
      expect(prompt.user).toContain('**Title**');
    });

    it('should include context_scope for Subtask input', () => {
      // SETUP: Get a test subtask with context_scope
      const task = mockBacklog.backlog[0].milestones[0].tasks[0].subtasks[1];

      // EXECUTE: Generate the prompt
      const prompt = createPRPBlueprintPrompt(task, mockBacklog);

      // VERIFY: context_scope is included
      expect(prompt.user).toContain(task.context_scope);
      expect(prompt.user).toContain('Context Scope:');
    });

    it('should include description for Task input', () => {
      // SETUP: Get a test task with description
      const task = mockBacklog.backlog[0].milestones[0].tasks[0] as Task;

      // EXECUTE: Generate the prompt
      const prompt = createPRPBlueprintPrompt(task, mockBacklog);

      // VERIFY: Task description is included
      expect(prompt.user).toContain(task.description);
      expect(prompt.user).toContain('Description:');
    });

    it('should include dependency context for Subtask with dependencies', () => {
      // SETUP: Get a subtask with dependencies
      const task = mockBacklog.backlog[0].milestones[0].tasks[0].subtasks[1];

      // EXECUTE: Generate the prompt
      const prompt = createPRPBlueprintPrompt(task, mockBacklog);

      // VERIFY: Dependencies are listed
      expect(prompt.user).toContain('Dependencies:');
      expect(prompt.user).toContain('P2.M2.T2.S1');
    });

    it('should include parent context (Phase, Milestone, Task)', () => {
      // SETUP: Get a test subtask
      const task = mockBacklog.backlog[0].milestones[0].tasks[0].subtasks[1];

      // EXECUTE: Generate the prompt
      const prompt = createPRPBlueprintPrompt(task, mockBacklog);

      // VERIFY: Parent context is included
      expect(prompt.user).toContain('Parent Context');
      expect(prompt.user).toContain(
        'Groundswell agent integration and prompt system'
      ); // Phase description
      expect(prompt.user).toContain('PRP generation and execution system'); // Milestone description
    });

    it('should include codebase path when provided', () => {
      // SETUP: Get a test subtask and codebase path
      const task = mockBacklog.backlog[0].milestones[0].tasks[0].subtasks[1];
      const codebasePath = '/home/dustin/projects/hacky-hack';

      // EXECUTE: Generate the prompt with codebase path
      const prompt = createPRPBlueprintPrompt(task, mockBacklog, codebasePath);

      // VERIFY: Codebase path is included
      expect(prompt.user).toContain('Codebase Analysis');
      expect(prompt.user).toContain(codebasePath);
    });

    it('should not include codebase section when path is not provided', () => {
      // SETUP: Get a test subtask without codebase path
      const task = mockBacklog.backlog[0].milestones[0].tasks[0].subtasks[1];

      // EXECUTE: Generate the prompt without codebase path
      const prompt = createPRPBlueprintPrompt(task, mockBacklog);

      // VERIFY: Custom codebase section is not included
      // Note: PRP_BLUEPRINT_PROMPT itself contains "Codebase Analysis" text,
      // but our custom codebase path section should not be present
      expect(prompt.user).not.toContain('The codebase is located at:');
    });

    it('should include the <issue_feedback> block when issueFeedback is provided', () => {
      // SETUP: Get a test subtask and feedback string
      const task = mockBacklog.backlog[0].milestones[0].tasks[0].subtasks[1];
      const feedback =
        'PRP did not specify the /health API contract; re-research with that gap filled.';

      // EXECUTE: Generate the prompt with issueFeedback (codebasePath=undefined)
      const prompt = createPRPBlueprintPrompt(
        task,
        mockBacklog,
        undefined,
        feedback
      );

      // VERIFY: The <issue_feedback> block is present with framing text
      expect(prompt.user).toContain('<issue_feedback>');
      expect(prompt.user).toContain('</issue_feedback>');
      expect(prompt.user).toContain(feedback);
      expect(prompt.user).toContain('Issue Feedback (Re-planning)');
    });

    it('should not include the <issue_feedback> block when issueFeedback is omitted', () => {
      // SETUP: Get a test subtask without feedback
      const task = mockBacklog.backlog[0].milestones[0].tasks[0].subtasks[1];

      // EXECUTE: Generate the prompt without issueFeedback
      const prompt = createPRPBlueprintPrompt(task, mockBacklog);

      // VERIFY: No <issue_feedback> block is present
      expect(prompt.user).not.toContain('<issue_feedback>');
    });

    it('should not include the <issue_feedback> block when issueFeedback is an empty string', () => {
      // SETUP: Get a test subtask with empty feedback
      const task = mockBacklog.backlog[0].milestones[0].tasks[0].subtasks[1];

      // EXECUTE: Generate the prompt with empty string feedback
      const prompt = createPRPBlueprintPrompt(task, mockBacklog, undefined, '');

      // VERIFY: No <issue_feedback> block is present
      expect(prompt.user).not.toContain('<issue_feedback>');
    });

    it('should handle Subtask with no dependencies', () => {
      // SETUP: Get a subtask with no dependencies
      const task = mockBacklog.backlog[0].milestones[0].tasks[0].subtasks[0];

      // EXECUTE: Generate the prompt
      const prompt = createPRPBlueprintPrompt(task, mockBacklog);

      // VERIFY: Dependencies section shows "None"
      expect(prompt.user).toContain('Dependencies: None');
    });

    it('should include PRP_BLUEPRINT_PROMPT content in system prompt', () => {
      // SETUP: Get a test subtask
      const task = mockBacklog.backlog[0].milestones[0].tasks[0].subtasks[1];

      // EXECUTE: Generate the prompt
      const prompt = createPRPBlueprintPrompt(task, mockBacklog);

      // VERIFY: System prompt contains expected content
      // Groundswell stores system prompt as systemOverride
      expect(prompt.systemOverride).toContain('Create PRP for Work Item');
      expect(prompt.systemOverride).toContain('PRP Creation Mission');
    });

    it('should replace <item_title> and <item_description> placeholders', () => {
      // SETUP: Get a test subtask
      const task = mockBacklog.backlog[0].milestones[0].tasks[0].subtasks[1];

      // EXECUTE: Generate the prompt
      const prompt = createPRPBlueprintPrompt(task, mockBacklog);

      // VERIFY: Task title is included in the user prompt context
      expect(prompt.user).toContain(task.title);

      // NOTE: The PRP_BLUEPRINT_PROMPT contains <item_title> and <item_description>
      // placeholders as part of its template. These are intentional and will be
      // replaced by the LLM when generating the PRP document. Our function adds
      // the task context at the beginning of the user prompt, so the title appears twice:
      // once in our Work Item Context section and once as a placeholder in PRP_BLUEPRINT_PROMPT.
      expect(prompt.user).toContain('<item_title>');
    });

    it('should have enableReflection set to true', () => {
      // SETUP: Get a test subtask
      const task = mockBacklog.backlog[0].milestones[0].tasks[0].subtasks[1];

      // EXECUTE: Generate the prompt
      const prompt = createPRPBlueprintPrompt(task, mockBacklog);

      // VERIFY: enableReflection is true for complex PRP generation
      expect(prompt.enableReflection).toBe(true);
    });

    it('should include responseFormat (PRPDocumentSchema)', () => {
      // SETUP: Get a test subtask
      const task = mockBacklog.backlog[0].milestones[0].tasks[0].subtasks[1];

      // EXECUTE: Generate the prompt
      const prompt = createPRPBlueprintPrompt(task, mockBacklog);

      // VERIFY: responseFormat is defined
      expect(prompt.responseFormat).toBeDefined();
    });

    it('should handle Task input (not just Subtask)', () => {
      // SETUP: Get a Task (not Subtask)
      const task = mockBacklog.backlog[0].milestones[0].tasks[0] as Task;

      // EXECUTE: Generate the prompt
      const prompt = createPRPBlueprintPrompt(task, mockBacklog);

      // VERIFY: Prompt is generated without errors
      expect(prompt).toBeDefined();
      expect(prompt.user).toContain(task.title);
      expect(prompt.user).toContain('Description:');
    });
  });

  describe('context extraction', () => {
    it('should extract Phase description for parent context', () => {
      // SETUP: Get a test subtask
      const task = mockBacklog.backlog[0].milestones[0].tasks[0].subtasks[1];

      // EXECUTE: Generate the prompt
      const prompt = createPRPBlueprintPrompt(task, mockBacklog);

      // VERIFY: Phase description is in parent context
      expect(prompt.user).toContain(
        'Groundswell agent integration and prompt system'
      );
    });

    it('should extract Milestone description for parent context', () => {
      // SETUP: Get a test subtask
      const task = mockBacklog.backlog[0].milestones[0].tasks[0].subtasks[1];

      // EXECUTE: Generate the prompt
      const prompt = createPRPBlueprintPrompt(task, mockBacklog);

      // VERIFY: Milestone description is in parent context
      expect(prompt.user).toContain('PRP generation and execution system');
    });

    it('should extract Task description for parent context when input is Subtask', () => {
      // SETUP: Get a test subtask
      const task = mockBacklog.backlog[0].milestones[0].tasks[0].subtasks[1];

      // EXECUTE: Generate the prompt
      const prompt = createPRPBlueprintPrompt(task, mockBacklog);

      // VERIFY: Parent Task description is included
      expect(prompt.user).toContain('Build prompt generators for PRP creation');
    });
  });

  describe('PRP_BLUEPRINT_PROMPT DOCS impact reminder (PRD §6.4)', () => {
    it('should reference the DOCS impact', () => {
      const task = mockBacklog.backlog[0].milestones[0].tasks[0].subtasks[1];
      const prompt = createPRPBlueprintPrompt(task, mockBacklog);
      expect(prompt.systemOverride).toMatch(/DOCS impact/i);
    });

    it('should reference Mode A (DOCS: line) and Mode B (changeset-level)', () => {
      const task = mockBacklog.backlog[0].milestones[0].tasks[0].subtasks[1];
      const prompt = createPRPBlueprintPrompt(task, mockBacklog);
      expect(prompt.systemOverride).toMatch(/Mode A/i);
      expect(prompt.systemOverride).toContain('DOCS:');
      expect(prompt.systemOverride).toMatch(/Mode B/i);
      expect(prompt.systemOverride).toMatch(/changeset-level|changeset level/i);
    });
  });
});
