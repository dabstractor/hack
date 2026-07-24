/**
 * Unit tests for Bug Hunt prompt generator
 *
 * @remarks
 * Tests validate that createBugHuntPrompt() correctly generates prompts
 * for QA adversarial testing with PRD context and completed tasks.
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { describe, expect, it } from 'vitest';
import { createBugHuntPrompt } from '#/prompts/index.js';
import type { Task } from '../../../src/core/models.js';

// Test fixtures matching the Task interface structure
const mockTasks: Task[] = [
  {
    id: 'P1.M1.T1',
    type: 'Task',
    title: 'Initialize Project',
    status: 'Complete',
    description: 'Setup project structure and dependencies',
    subtasks: [],
  },
  {
    id: 'P1.M1.T2',
    type: 'Task',
    title: 'Create User Authentication',
    status: 'Complete',
    description: 'Implement login and registration',
    subtasks: [],
  },
];

const mockPRD = `# My Feature PRD

## Requirements

Build a user authentication system with login and registration.

## Success Criteria

- Users can register with email and password
- Users can login with credentials
- Session management works correctly
`;

describe('agents/prompts/bug-hunt-prompt', () => {
  describe('createBugHuntPrompt', () => {
    it('should return a Prompt object with correct structure', () => {
      // SETUP: Prepare test data
      const prd = mockPRD;
      const completedTasks = mockTasks;

      // EXECUTE: Generate the prompt
      const prompt = createBugHuntPrompt(prd, completedTasks);

      // VERIFY: Prompt has expected properties
      expect(prompt).toBeDefined();
      expect(typeof prompt.user).toBe('string');
      // Groundswell stores system prompt as systemOverride
      expect(prompt.systemOverride).toBeDefined();
      expect(typeof prompt.systemOverride).toBe('string');
      expect(prompt.responseFormat).toBeDefined();
      expect(prompt.enableReflection).toBe(true);
    });

    it('should include PRD content in user prompt', () => {
      // SETUP: Prepare test data
      const prd = mockPRD;
      const completedTasks = mockTasks;

      // EXECUTE: Generate the prompt
      const prompt = createBugHuntPrompt(prd, completedTasks);

      // VERIFY: PRD content is in the user prompt
      expect(prompt.user).toContain('## Original PRD');
      expect(prompt.user).toContain('My Feature PRD');
      expect(prompt.user).toContain('Build a user authentication system');
    });

    it('should declare the PRD is pre-merged before the Original PRD block (PRD §2.3)', () => {
      // SETUP: Prepare test data
      const prd = mockPRD;
      const completedTasks = mockTasks;

      // EXECUTE: Generate the prompt
      const prompt = createBugHuntPrompt(prd, completedTasks);

      // VERIFY: The pre-merged declaration sits adjacent to (before) the PRD
      expect(prompt.user).toContain(
        'do not chase @include directives yourself'
      );
      expect(prompt.user).toContain('already the complete, merged document');
      const declarationIndex = prompt.user.indexOf(
        'do not chase @include directives yourself'
      );
      const originalPrdIndex = prompt.user.indexOf('## Original PRD');
      expect(declarationIndex).toBeGreaterThanOrEqual(0);
      expect(originalPrdIndex).toBeGreaterThan(declarationIndex);
    });

    it('should include completed tasks section in user prompt', () => {
      // SETUP: Prepare test data
      const prd = mockPRD;
      const completedTasks = mockTasks;

      // EXECUTE: Generate the prompt
      const prompt = createBugHuntPrompt(prd, completedTasks);

      // VERIFY: Completed tasks section is present
      expect(prompt.user).toContain('## Completed Tasks');
      expect(prompt.user).toContain('P1.M1.T1');
      expect(prompt.user).toContain('Initialize Project');
      expect(prompt.user).toContain('P1.M1.T2');
      expect(prompt.user).toContain('Create User Authentication');
    });

    it('should handle empty completedTasks array', () => {
      // SETUP: Prepare test data with empty tasks array
      const prd = mockPRD;
      const completedTasks: Task[] = [];

      // EXECUTE: Generate the prompt
      const prompt = createBugHuntPrompt(prd, completedTasks);

      // VERIFY: Empty tasks are handled gracefully
      expect(prompt.user).toContain('## Completed Tasks');
      expect(prompt.user).toContain('No completed tasks yet');
    });

    it('should include BUG_HUNT_PROMPT content in system prompt', () => {
      // SETUP: Prepare test data
      const prd = mockPRD;
      const completedTasks = mockTasks;

      // EXECUTE: Generate the prompt
      const prompt = createBugHuntPrompt(prd, completedTasks);

      // VERIFY: System prompt contains BUG_HUNT_PROMPT content
      expect(prompt.systemOverride).toContain('Creative Bug Finding');
      expect(prompt.systemOverride).toContain('End-to-End PRD Validation');
      expect(prompt.systemOverride).toContain('QA engineer');
    });

    it('should include BUG_HUNT_PROMPT content in user prompt', () => {
      // SETUP: Prepare test data
      const prd = mockPRD;
      const completedTasks = mockTasks;

      // EXECUTE: Generate the prompt
      const prompt = createBugHuntPrompt(prd, completedTasks);

      // VERIFY: User prompt contains BUG_HUNT_PROMPT content (appended at end)
      expect(prompt.user).toContain('Creative Bug Finding');
      expect(prompt.user).toContain('Phase 1: PRD Scope Analysis');
      expect(prompt.user).toContain('Phase 2: Creative End-to-End Testing');
    });

    it('should have enableReflection set to true', () => {
      // SETUP: Prepare test data
      const prd = mockPRD;
      const completedTasks = mockTasks;

      // EXECUTE: Generate the prompt
      const prompt = createBugHuntPrompt(prd, completedTasks);

      // VERIFY: enableReflection is true for complex bug analysis
      expect(prompt.enableReflection).toBe(true);
    });

    it('should include responseFormat (TestResultsSchema)', () => {
      // SETUP: Prepare test data
      const prd = mockPRD;
      const completedTasks = mockTasks;

      // EXECUTE: Generate the prompt
      const prompt = createBugHuntPrompt(prd, completedTasks);

      // VERIFY: responseFormat is defined
      expect(prompt.responseFormat).toBeDefined();
    });

    it('should format completed tasks as markdown list', () => {
      // SETUP: Prepare test data
      const prd = mockPRD;
      const completedTasks = mockTasks;

      // EXECUTE: Generate the prompt
      const prompt = createBugHuntPrompt(prd, completedTasks);

      // VERIFY: Tasks are formatted as markdown list items
      expect(prompt.user).toMatch(/- P1\.M1\.T1:/);
      expect(prompt.user).toMatch(/- P1\.M1\.T2:/);
      expect(prompt.user).toContain('Setup project structure and dependencies');
      expect(prompt.user).toContain('Implement login and registration');
    });

    it('should include task description in formatted output', () => {
      // SETUP: Prepare test data
      const prd = mockPRD;
      const completedTasks = mockTasks;

      // EXECUTE: Generate the prompt
      const prompt = createBugHuntPrompt(prd, completedTasks);

      // VERIFY: Task descriptions are included
      expect(prompt.user).toContain('Setup project structure and dependencies');
      expect(prompt.user).toContain('Implement login and registration');
    });

    it('should include separator between sections', () => {
      // SETUP: Prepare test data
      const prd = mockPRD;
      const completedTasks = mockTasks;

      // EXECUTE: Generate the prompt
      const prompt = createBugHuntPrompt(prd, completedTasks);

      // VERIFY: Separator is present
      expect(prompt.user).toContain('---');
    });

    it('should handle tasks without descriptions', () => {
      // SETUP: Prepare test data with task that has no description
      const prd = mockPRD;
      const completedTasks: Task[] = [
        {
          id: 'P1.M1.T3',
          type: 'Task',
          title: 'Some Task',
          status: 'Complete',
          description: '',
          subtasks: [],
        },
      ];

      // EXECUTE: Generate the prompt
      const prompt = createBugHuntPrompt(prd, completedTasks);

      // VERIFY: Task is still included in output
      expect(prompt.user).toContain('P1.M1.T3');
      expect(prompt.user).toContain('Some Task');
    });
  });

  describe('prompt structure validation', () => {
    it('should maintain consistent structure across multiple calls', () => {
      // SETUP: Prepare test data
      const prd = mockPRD;
      const completedTasks = mockTasks;

      // EXECUTE: Generate multiple prompts
      const prompt1 = createBugHuntPrompt(prd, completedTasks);
      const prompt2 = createBugHuntPrompt(prd, completedTasks);

      // VERIFY: Both prompts have identical structure
      expect(typeof prompt1.user).toBe(typeof prompt2.user);
      expect(prompt1.enableReflection).toBe(prompt2.enableReflection);
      expect(prompt1.responseFormat).toBeDefined();
      expect(prompt2.responseFormat).toBeDefined();
    });

    it('should handle single task array', () => {
      // SETUP: Prepare test data with single task
      const prd = mockPRD;
      const completedTasks: Task[] = [mockTasks[0]];

      // EXECUTE: Generate the prompt
      const prompt = createBugHuntPrompt(prd, completedTasks);

      // VERIFY: Single task is included correctly
      expect(prompt.user).toContain('P1.M1.T1');
      expect(prompt.user).toContain('Initialize Project');
      expect(prompt.user).not.toContain('P1.M1.T2');
    });

    it('should include all 4 testing phases from BUG_HUNT_PROMPT', () => {
      // SETUP: Prepare test data
      const prd = mockPRD;
      const completedTasks = mockTasks;

      // EXECUTE: Generate the prompt
      const prompt = createBugHuntPrompt(prd, completedTasks);

      // VERIFY: All 4 phases are present
      expect(prompt.user).toContain('Phase 1: PRD Scope Analysis');
      expect(prompt.user).toContain('Phase 2: Creative End-to-End Testing');
      expect(prompt.user).toContain('Phase 3: Adversarial Testing');
      expect(prompt.user).toContain('Phase 4: Documentation as Bug Report');
    });
  });
});
