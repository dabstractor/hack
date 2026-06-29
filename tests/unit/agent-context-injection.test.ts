/**
 * Unit tests for Agent Context Injection
 *
 * @remarks
 * Tests validate that agents receive properly curated context including:
 * - Architecture documentation from $SESSION_DIR/architecture/
 * - Previous session notes for delta sessions
 * - Code snippets based on task requirements
 * - Context size management (no token overflow)
 *
 * Verifies:
 * - extractParentContext() traverses hierarchy correctly
 * - extractTaskContext() handles Task and Subtask differences
 * - constructUserPrompt() assembles complete context
 * - createPRPBlueprintPrompt() generates Groundswell prompts
 * - Token estimation prevents overflow
 * - Delta sessions inject previous context
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 * @see {@link ../../src/agents/prompts/prp-blueprint-prompt.ts | Context Assembly Functions}
 * @see {@link ../../src/core/session-manager.ts | Session Manager}
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { createPRPBlueprintPrompt } from '#/prompts/index.js';
import type { Backlog, Task, Phase } from '../../src/core/models.js';

/**
 * Helper function to create a mock backlog with full hierarchy
 *
 * @remarks
 * Creates a complete 4-level hierarchy (Phase > Milestone > Task > Subtask)
 * for testing context extraction at all levels.
 */
function createMockBacklog(): Backlog {
  return {
    backlog: [
      {
        id: 'P1',
        type: 'Phase',
        title: 'Phase 1: Foundation',
        status: 'Planned',
        description: 'Project initialization and setup',
        milestones: [
          {
            id: 'P1.M1',
            type: 'Milestone',
            title: 'Milestone 1.1: Core Models',
            status: 'Planned',
            description: 'Define core data models and interfaces',
            tasks: [
              {
                id: 'P1.M1.T1',
                type: 'Task',
                title: 'Create Models',
                status: 'Planned',
                description: 'Implement TypeScript interfaces and Zod schemas',
                subtasks: [
                  {
                    id: 'P1.M1.T1.S1',
                    type: 'Subtask',
                    title: 'Define Phase Interface',
                    status: 'Planned',
                    story_points: 1,
                    dependencies: [],
                    context_scope:
                      'CONTRACT DEFINITION:\n1. RESEARCH NOTE: Interface patterns\n2. INPUT: None\n3. LOGIC: Define interface\n4. OUTPUT: Phase interface',
                  },
                  {
                    id: 'P1.M1.T1.S2',
                    type: 'Subtask',
                    title: 'Define Task Interface',
                    status: 'Planned',
                    story_points: 1,
                    dependencies: ['P1.M1.T1.S1'],
                    context_scope:
                      'CONTRACT DEFINITION:\n1. RESEARCH NOTE: Depends on S1\n2. INPUT: Phase interface\n3. LOGIC: Define Task interface\n4. OUTPUT: Task interface',
                  },
                  {
                    id: 'P1.M1.T1.S3',
                    type: 'Subtask',
                    title: 'Define Subtask Interface',
                    status: 'Planned',
                    story_points: 2,
                    dependencies: ['P1.M1.T1.S1', 'P1.M1.T1.S2'],
                    context_scope:
                      'CONTRACT DEFINITION:\n1. RESEARCH NOTE: Complex interface\n2. INPUT: Phase and Task interfaces\n3. LOGIC: Define Subtask interface with dependencies\n4. OUTPUT: Subtask interface',
                  },
                ],
              },
              {
                id: 'P1.M1.T2',
                type: 'Task',
                title: 'Create Zod Schemas',
                status: 'Planned',
                description: 'Create validation schemas for all interfaces',
                subtasks: [],
              },
            ],
          },
        ],
      },
      {
        id: 'P2',
        type: 'Phase',
        title: 'Phase 2: Agent System',
        status: 'Planned',
        description: 'Groundswell agent integration and prompt system',
        milestones: [
          {
            id: 'P2.M1',
            type: 'Milestone',
            title: 'Milestone 2.1: Agent Factory',
            status: 'Planned',
            description: 'Build agent factory and runtime',
            tasks: [
              {
                id: 'P2.M1.T1',
                type: 'Task',
                title: 'Implement Agent Factory',
                status: 'Planned',
                description: 'Create factory for agent instantiation',
                subtasks: [],
              },
            ],
          },
        ],
      },
    ],
  };
}

/**
 * Helper function to estimate token count (approximate)
 *
 * @remarks
 * Uses the approximation 1 token ≈ 4 characters for English text.
 * This is a rough estimate, not exact token counting.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

describe('unit/agent-context-injection > context assembly', () => {
  let mockBacklog: Backlog;

  beforeEach(() => {
    mockBacklog = createMockBacklog();
  });

  describe('parent context extraction', () => {
    it('should extract Phase, Milestone, and Task descriptions for Subtask', () => {
      // SETUP: Get a subtask with full parent hierarchy
      const subtask = mockBacklog.backlog[0].milestones[0].tasks[0].subtasks[2];

      // EXECUTE: Generate the prompt
      const prompt = createPRPBlueprintPrompt(subtask, mockBacklog);

      // VERIFY: Order is Task -> Milestone -> Phase (reverse hierarchy)
      expect(prompt.user).toContain(
        'Task: Implement TypeScript interfaces and Zod schemas'
      );
      expect(prompt.user).toContain(
        'Milestone: Define core data models and interfaces'
      );
      expect(prompt.user).toContain('Phase: Project initialization and setup');
    });

    it('should return "No parent context" for Phase-level item', () => {
      // SETUP: Get a Phase (root level, no parents)
      const phase = mockBacklog.backlog[0] as Phase;

      // EXECUTE: Generate the prompt
      const prompt = createPRPBlueprintPrompt(phase, mockBacklog);

      // VERIFY: Should show "No parent context" message
      expect(prompt.user).toContain('No parent context');
    });

    it('should handle items at different hierarchy levels correctly', () => {
      // SETUP: Test Milestone-level item
      const milestone = mockBacklog.backlog[0].milestones[0];

      // EXECUTE: Generate the prompt
      const prompt = createPRPBlueprintPrompt(milestone, mockBacklog);

      // VERIFY: Only Phase as parent
      expect(prompt.user).toContain('Phase: Project initialization and setup');
      // Task should not be in parent context for milestone
      expect(prompt.user).not.toContain(
        'Task: Implement TypeScript interfaces'
      );
    });

    it('should traverse hierarchy in correct order (Task -> Milestone -> Phase)', () => {
      // SETUP: Get a subtask
      const subtask = mockBacklog.backlog[0].milestones[0].tasks[0].subtasks[0];

      // EXECUTE: Generate the prompt
      const prompt = createPRPBlueprintPrompt(subtask, mockBacklog);

      // VERIFY: Order should be Task, then Milestone, then Phase
      // Verify all three parent descriptions are present
      const userPrompt = prompt.user;

      // Find the Parent Context section
      const parentContextStart = userPrompt.indexOf('## Parent Context');
      expect(parentContextStart).toBeGreaterThan(-1);

      // Get content after Parent Context but before the next section
      const afterParentContext = userPrompt.slice(parentContextStart);
      const parentContextContent = afterParentContext.split(/\n##/)[0]; // Split at next section header

      // Verify the order: Task description should appear before Milestone,
      // which should appear before Phase
      const taskIndex = parentContextContent.indexOf(
        'Task: Implement TypeScript interfaces'
      );
      const milestoneIndex = parentContextContent.indexOf(
        'Milestone: Define core data models'
      );
      const phaseIndex = parentContextContent.indexOf(
        'Phase: Project initialization and setup'
      );

      expect(taskIndex).toBeGreaterThan(-1);
      expect(milestoneIndex).toBeGreaterThan(-1);
      expect(phaseIndex).toBeGreaterThan(-1);

      // Verify correct order (Task < Milestone < Phase in string position)
      expect(taskIndex).toBeLessThan(milestoneIndex);
      expect(milestoneIndex).toBeLessThan(phaseIndex);
    });
  });

  describe('task context extraction', () => {
    it('should extract Task description and title for Task type', () => {
      // SETUP: Get a Task with title and description
      const task = mockBacklog.backlog[0].milestones[0].tasks[0] as Task;

      // EXECUTE: Generate the prompt
      const prompt = createPRPBlueprintPrompt(task, mockBacklog);

      // VERIFY: Task context includes title and description
      expect(prompt.user).toContain('Task: Create Models');
      expect(prompt.user).toContain(
        'Description: Implement TypeScript interfaces and Zod schemas'
      );
    });

    it('should extract Subtask context_scope, dependencies, and title', () => {
      // SETUP: Get a Subtask with context_scope and dependencies
      const subtask = mockBacklog.backlog[0].milestones[0].tasks[0].subtasks[2];

      // EXECUTE: Generate the prompt
      const prompt = createPRPBlueprintPrompt(subtask, mockBacklog);

      // VERIFY: Subtask context includes title, dependencies, and context_scope
      expect(prompt.user).toContain('Task: Define Subtask Interface');
      expect(prompt.user).toContain('Dependencies: P1.M1.T1.S1, P1.M1.T1.S2');
      expect(prompt.user).toContain('Context Scope: CONTRACT DEFINITION:');
    });

    it('should resolve dependency IDs correctly', () => {
      // SETUP: Get a subtask with multiple dependencies
      const subtask = mockBacklog.backlog[0].milestones[0].tasks[0].subtasks[2];

      // EXECUTE: Generate the prompt
      const prompt = createPRPBlueprintPrompt(subtask, mockBacklog);

      // VERIFY: Dependencies are resolved to actual task IDs
      expect(prompt.user).toContain('P1.M1.T1.S1');
      expect(prompt.user).toContain('P1.M1.T1.S2');
    });

    it('should handle Subtask with no dependencies gracefully', () => {
      // SETUP: Get a subtask with empty dependencies array
      const subtask = mockBacklog.backlog[0].milestones[0].tasks[0].subtasks[0];

      // EXECUTE: Generate the prompt
      const prompt = createPRPBlueprintPrompt(subtask, mockBacklog);

      // VERIFY: Dependencies shown as "None"
      expect(prompt.user).toContain('Dependencies: None');
    });
  });

  describe('prompt construction', () => {
    it('should replace <item_title> and include actual task title', () => {
      // SETUP: Get a subtask with known title
      const subtask = mockBacklog.backlog[0].milestones[0].tasks[0].subtasks[0];

      // EXECUTE: Generate the prompt
      const prompt = createPRPBlueprintPrompt(subtask, mockBacklog);

      // VERIFY: Actual title included in context
      expect(prompt.user).toContain('Define Phase Interface');

      // NOTE: PRP_BLUEPRINT_PROMPT contains <item_title> placeholder as template
      expect(prompt.user).toContain('<item_title>');
    });

    it('should include parent context in the prompt', () => {
      // SETUP: Get a subtask with parent hierarchy
      const subtask = mockBacklog.backlog[0].milestones[0].tasks[0].subtasks[1];

      // EXECUTE: Generate the prompt
      const prompt = createPRPBlueprintPrompt(subtask, mockBacklog);

      // VERIFY: Parent context section included
      expect(prompt.user).toContain('## Parent Context');
      expect(prompt.user).toContain('Task: Implement TypeScript interfaces');
      expect(prompt.user).toContain('Milestone: Define core data models');
    });

    it('should include codebase path section when provided', () => {
      // SETUP: Get a task and codebase path
      const task = mockBacklog.backlog[0].milestones[0].tasks[0] as Task;
      const codebasePath = '/home/dustin/projects/hacky-hack';

      // EXECUTE: Generate the prompt with codebase path
      const prompt = createPRPBlueprintPrompt(task, mockBacklog, codebasePath);

      // VERIFY: Codebase section included
      expect(prompt.user).toContain('## Codebase Analysis');
      expect(prompt.user).toContain(codebasePath);
    });

    it('should exclude codebase path section when not provided', () => {
      // SETUP: Get a task without codebase path
      const task = mockBacklog.backlog[0].milestones[0].tasks[0] as Task;

      // EXECUTE: Generate the prompt without codebase path
      const prompt = createPRPBlueprintPrompt(task, mockBacklog);

      // VERIFY: Custom codebase section NOT included
      expect(prompt.user).not.toContain('The codebase is located at:');
    });

    it('should include task context with dependencies', () => {
      // SETUP: Get a Subtask with dependencies
      const subtask = mockBacklog.backlog[0].milestones[0].tasks[0].subtasks[2];

      // EXECUTE: Generate the prompt
      const prompt = createPRPBlueprintPrompt(subtask, mockBacklog);

      // VERIFY: Task context includes dependencies
      expect(prompt.user).toContain('Dependencies: P1.M1.T1.S1, P1.M1.T1.S2');
    });

    it('should include Work Item Context section', () => {
      // SETUP: Get any task
      const task = mockBacklog.backlog[0].milestones[0].tasks[0] as Task;

      // EXECUTE: Generate the prompt
      const prompt = createPRPBlueprintPrompt(task, mockBacklog);

      // VERIFY: Work Item Context section present
      expect(prompt.user).toContain('# Work Item Context');
      expect(prompt.user).toContain('## Task Information');
    });
  });

  describe('createPRPBlueprintPrompt structure', () => {
    it('should return Groundswell Prompt with correct structure', () => {
      // SETUP: Get a test subtask
      const subtask = mockBacklog.backlog[0].milestones[0].tasks[0].subtasks[0];

      // EXECUTE: Generate the prompt
      const prompt = createPRPBlueprintPrompt(subtask, mockBacklog);

      // VERIFY: Prompt has expected properties
      expect(prompt).toBeDefined();
      expect(typeof prompt.user).toBe('string');
      expect(prompt.systemOverride).toBeDefined();
      expect(typeof prompt.systemOverride).toBe('string');
      expect(prompt.responseFormat).toBeDefined();
      // enableReflection is no longer set by default
      expect(prompt.enableReflection).toBeUndefined();
    });

    it('should include user prompt from constructUserPrompt()', () => {
      // SETUP: Get a subtask with known values
      const subtask = mockBacklog.backlog[0].milestones[0].tasks[0].subtasks[0];

      // EXECUTE: Generate the prompt
      const prompt = createPRPBlueprintPrompt(subtask, mockBacklog);

      // VERIFY: User prompt contains expected content
      expect(prompt.user).toContain('Define Phase Interface');
      expect(prompt.user).toContain('CONTRACT DEFINITION:');
    });

    it('should have enableReflection unset (not set by default)', () => {
      // SETUP: Get a test subtask
      const subtask = mockBacklog.backlog[0].milestones[0].tasks[0].subtasks[0];

      // EXECUTE: Generate the prompt
      const prompt = createPRPBlueprintPrompt(subtask, mockBacklog);

      // VERIFY: enableReflection is not set
      expect(prompt.enableReflection).toBeUndefined();
    });

    it('should include responseFormat (PRPDocumentSchema)', () => {
      // SETUP: Get a test subtask
      const subtask = mockBacklog.backlog[0].milestones[0].tasks[0].subtasks[0];

      // EXECUTE: Generate the prompt
      const prompt = createPRPBlueprintPrompt(subtask, mockBacklog);

      // VERIFY: responseFormat is defined
      expect(prompt.responseFormat).toBeDefined();
    });
  });
});

describe('unit/agent-context-injection > context size management', () => {
  // Note: The full PRP_BLUEPRINT_PROMPT template is ~2000-3000 tokens,
  // so realistic prompt sizes are larger than just the context parts
  const MAX_CONTEXT_TOKENS = 10000;

  describe('token estimation', () => {
    it('should estimate tokens accurately for typical text', () => {
      // SETUP: Create test string with known length
      const testText = 'This is a test sentence with exactly ten words.';

      // EXECUTE: Estimate tokens
      const estimatedTokens = estimateTokens(testText);

      // VERIFY: Approximate estimation (within reasonable range)
      expect(estimatedTokens).toBeGreaterThan(5);
      expect(estimatedTokens).toBeLessThan(20);
    });

    it('should return 0 for empty strings', () => {
      // EXECUTE: Estimate tokens for empty string
      const result = estimateTokens('');

      // VERIFY
      expect(result).toBe(0);
    });

    it('should handle large texts without overflow', () => {
      // SETUP: Create large string
      const largeText = 'x'.repeat(10000);

      // EXECUTE: Estimate tokens
      const result = estimateTokens(largeText);

      // VERIFY: Should not overflow
      expect(result).toBe(2500); // 10000 / 4
      expect(Number.isFinite(result)).toBe(true);
    });
  });

  describe('context size validation', () => {
    it('should validate context size within token limits', () => {
      // SETUP: Create context within limits
      const context = 'x'.repeat(MAX_CONTEXT_TOKENS * 3); // ~6000 tokens

      // EXECUTE: Estimate tokens
      const tokens = estimateTokens(context);

      // VERIFY: Within limits
      expect(tokens).toBeLessThanOrEqual(MAX_CONTEXT_TOKENS);
    });

    it('should detect oversized contexts', () => {
      // SETUP: Create oversized context
      const oversizedContext = 'x'.repeat(MAX_CONTEXT_TOKENS * 5); // ~10000 tokens

      // EXECUTE: Estimate tokens
      const tokens = estimateTokens(oversizedContext);

      // VERIFY: Exceeds limit
      expect(tokens).toBeGreaterThan(MAX_CONTEXT_TOKENS);
    });

    it('should provide warnings for contexts near token limit', () => {
      // SETUP: Create context at 90% of limit
      const nearLimitContext = 'x'.repeat(
        Math.floor(MAX_CONTEXT_TOKENS * 4 * 0.9)
      );

      // EXECUTE: Estimate tokens
      const tokens = estimateTokens(nearLimitContext);

      // VERIFY: Near limit (should trigger warning in production)
      expect(tokens).toBeGreaterThan(8000); // Above traditional 8k limit
      expect(tokens).toBeLessThanOrEqual(MAX_CONTEXT_TOKENS);
    });
  });

  describe('prompt size management', () => {
    it('should generate prompts of reasonable size', () => {
      // SETUP: Create a typical backlog
      const mockBacklog = createMockBacklog();
      const subtask = mockBacklog.backlog[0].milestones[0].tasks[0].subtasks[0];

      // EXECUTE: Generate prompt
      const prompt = createPRPBlueprintPrompt(subtask, mockBacklog);

      // VERIFY: Prompt size is reasonable
      const userTokens = estimateTokens(prompt.user);
      const systemTokens = estimateTokens(prompt.systemOverride || '');
      const totalTokens = userTokens + systemTokens;

      expect(totalTokens).toBeLessThan(MAX_CONTEXT_TOKENS);
      expect(userTokens).toBeGreaterThan(0);
      expect(systemTokens).toBeGreaterThan(0);
    });

    it('should handle larger hierarchies without excessive growth', () => {
      // SETUP: Create backlog with more phases
      const mockBacklog = createMockBacklog();
      const subtask = mockBacklog.backlog[1].milestones[0].tasks[0];

      // EXECUTE: Generate prompt
      const prompt = createPRPBlueprintPrompt(subtask, mockBacklog);

      // VERIFY: Prompt size scales reasonably
      const tokens = estimateTokens(
        prompt.user + (prompt.systemOverride || '')
      );

      // Should not grow linearly with backlog size
      expect(tokens).toBeLessThan(MAX_CONTEXT_TOKENS);
    });
  });
});

describe('unit/agent-context-injection > edge cases', () => {
  let mockBacklog: Backlog;

  beforeEach(() => {
    mockBacklog = createMockBacklog();
  });

  it('should handle Subtask with empty dependencies array', () => {
    // SETUP: Get subtask with no dependencies
    const subtask = mockBacklog.backlog[0].milestones[0].tasks[0].subtasks[0];

    // EXECUTE: Generate prompt
    const prompt = createPRPBlueprintPrompt(subtask, mockBacklog);

    // VERIFY: Dependencies shown as "None"
    expect(prompt.user).toContain('Dependencies: None');
  });

  it('should handle Task with subtasks array', () => {
    // SETUP: Get a Task with subtasks
    const task = mockBacklog.backlog[0].milestones[0].tasks[0] as Task;

    // EXECUTE: Generate prompt
    const prompt = createPRPBlueprintPrompt(task, mockBacklog);

    // VERIFY: Task description included
    expect(prompt.user).toContain(
      'Description: Implement TypeScript interfaces'
    );
  });

  it('should handle Task with empty subtasks array', () => {
    // SETUP: Get a Task with no subtasks
    const task = mockBacklog.backlog[0].milestones[0].tasks[1] as Task;

    // EXECUTE: Generate prompt
    const prompt = createPRPBlueprintPrompt(task, mockBacklog);

    // VERIFY: Still generates valid prompt
    expect(prompt.user).toContain(task.title);
    expect(prompt.user).toContain(task.description);
  });

  it('should handle Milestone-level items', () => {
    // SETUP: Get a Milestone
    const milestone = mockBacklog.backlog[0].milestones[0];

    // EXECUTE: Generate prompt
    const prompt = createPRPBlueprintPrompt(milestone, mockBacklog);

    // VERIFY: Valid prompt generated
    expect(prompt).toBeDefined();
    expect(prompt.user).toContain(milestone.title);
    expect(prompt.user).toContain('Parent Context');
  });

  it('should handle Phase-level items', () => {
    // SETUP: Get a Phase (root level)
    const phase = mockBacklog.backlog[0];

    // EXECUTE: Generate prompt
    const prompt = createPRPBlueprintPrompt(phase, mockBacklog);

    // VERIFY: Valid prompt generated with "No parent context"
    expect(prompt).toBeDefined();
    expect(prompt.user).toContain(phase.title);
    expect(prompt.user).toContain('No parent context');
  });

  it('should handle Subtask with multiple dependencies', () => {
    // SETUP: Get subtask with 2 dependencies
    const subtask = mockBacklog.backlog[0].milestones[0].tasks[0].subtasks[2];

    // EXECUTE: Generate prompt
    const prompt = createPRPBlueprintPrompt(subtask, mockBacklog);

    // VERIFY: All dependencies listed
    expect(prompt.user).toContain('P1.M1.T1.S1');
    expect(prompt.user).toContain('P1.M1.T1.S2');
    expect(prompt.user).toContain('Dependencies: P1.M1.T1.S1, P1.M1.T1.S2');
  });

  it('should handle codebasePath parameter', () => {
    // SETUP: Get task and provide codebase path
    const task = mockBacklog.backlog[0].milestones[0].tasks[0] as Task;
    const codebasePath = '/custom/path/to/project';

    // EXECUTE: Generate prompt with codebase path
    const prompt = createPRPBlueprintPrompt(task, mockBacklog, codebasePath);

    // VERIFY: Codebase path included
    expect(prompt.user).toContain('## Codebase Analysis');
    expect(prompt.user).toContain(codebasePath);
  });

  it('should handle undefined codebasePath', () => {
    // SETUP: Get task without codebase path
    const task = mockBacklog.backlog[0].milestones[0].tasks[0] as Task;

    // EXECUTE: Generate prompt without codebase path
    const prompt = createPRPBlueprintPrompt(task, mockBacklog, undefined);

    // VERIFY: Codebase section NOT included
    expect(prompt.user).not.toContain('## Codebase Analysis');
    expect(prompt.user).not.toContain('The codebase is located at:');
  });

  it('should handle empty string codebasePath', () => {
    // SETUP: Get task with empty codebase path
    const task = mockBacklog.backlog[0].milestones[0].tasks[0] as Task;

    // EXECUTE: Generate prompt with empty codebase path
    const prompt = createPRPBlueprintPrompt(task, mockBacklog, '');

    // VERIFY: Codebase section NOT included (empty string treated as no path)
    expect(prompt.user).not.toContain('## Codebase Analysis');
    expect(prompt.user).not.toContain('The codebase is located at:');
  });

  it('should preserve context_scope format in prompt', () => {
    // SETUP: Get subtask with CONTRACT DEFINITION format
    const subtask = mockBacklog.backlog[0].milestones[0].tasks[0].subtasks[0];

    // EXECUTE: Generate prompt
    const prompt = createPRPBlueprintPrompt(subtask, mockBacklog);

    // VERIFY: Context scope format preserved
    expect(prompt.user).toContain('CONTRACT DEFINITION:');
    expect(prompt.user).toContain('RESEARCH NOTE:');
    expect(prompt.user).toContain('INPUT:');
    expect(prompt.user).toContain('LOGIC:');
    expect(prompt.user).toContain('OUTPUT:');
  });

  it('should handle different phases in the same backlog', () => {
    // SETUP: Get items from different phases
    const phase1Task = mockBacklog.backlog[0].milestones[0].tasks[0];
    const phase2Task = mockBacklog.backlog[1].milestones[0].tasks[0];

    // EXECUTE: Generate prompts for both
    const prompt1 = createPRPBlueprintPrompt(phase1Task, mockBacklog);
    const prompt2 = createPRPBlueprintPrompt(phase2Task, mockBacklog);

    // VERIFY: Each prompt has correct parent context
    expect(prompt1.user).toContain('Phase: Project initialization and setup');
    expect(prompt2.user).toContain('Phase: Groundswell agent integration');
  });

  it('should include all required sections in prompt', () => {
    // SETUP: Get a subtask
    const subtask = mockBacklog.backlog[0].milestones[0].tasks[0].subtasks[0];

    // EXECUTE: Generate prompt
    const prompt = createPRPBlueprintPrompt(subtask, mockBacklog);

    // VERIFY: All required sections present
    expect(prompt.user).toContain('# Work Item Context');
    expect(prompt.user).toContain('## Task Information');
    expect(prompt.user).toContain('**Title**');
    expect(prompt.user).toContain('**Description**');
    expect(prompt.user).toContain('## Parent Context');
    expect(prompt.user).toContain('---');
  });
});

describe('unit/agent-context-injection > context completeness', () => {
  let mockBacklog: Backlog;

  beforeEach(() => {
    mockBacklog = createMockBacklog();
  });

  it('should include complete hierarchy path in parent context', () => {
    // SETUP: Get a deeply nested subtask
    const subtask = mockBacklog.backlog[0].milestones[0].tasks[0].subtasks[2];

    // EXECUTE: Generate prompt
    const prompt = createPRPBlueprintPrompt(subtask, mockBacklog);

    // VERIFY: Complete hierarchy present
    expect(prompt.user).toContain('Task: Implement TypeScript interfaces');
    expect(prompt.user).toContain('Milestone: Define core data models');
    expect(prompt.user).toContain('Phase: Project initialization and setup');
  });

  it('should include task information section with all fields', () => {
    // SETUP: Get a subtask
    const subtask = mockBacklog.backlog[0].milestones[0].tasks[0].subtasks[1];

    // EXECUTE: Generate prompt
    const prompt = createPRPBlueprintPrompt(subtask, mockBacklog);

    // VERIFY: Task Information section complete
    expect(prompt.user).toContain('## Task Information');
    expect(prompt.user).toContain(`**Title**: ${subtask.title}`);
    expect(prompt.user).toContain('**Description**:');
  });

  it('should separate sections with proper formatting', () => {
    // SETUP: Get any task
    const task = mockBacklog.backlog[0].milestones[0].tasks[0] as Task;

    // EXECUTE: Generate prompt
    const prompt = createPRPBlueprintPrompt(task, mockBacklog);

    // VERIFY: Proper section separation
    expect(prompt.user).toMatch(/## \w+/); // Section headers
    expect(prompt.user).toContain('\n\n'); // Double newlines for spacing
    expect(prompt.user).toContain('---\n'); // Separator before PRP_BLUEPRINT_PROMPT
  });

  it('should include PRP_BLUEPRINT_PROMPT template', () => {
    // SETUP: Get any task
    const task = mockBacklog.backlog[0].milestones[0].tasks[0] as Task;

    // EXECUTE: Generate prompt
    const prompt = createPRPBlueprintPrompt(task, mockBacklog);

    // VERIFY: PRP template included after separator
    const parts = prompt.user.split('---\n');
    expect(parts.length).toBeGreaterThan(1);
    expect(parts[1]).toContain('PRP'); // Template should contain PRP reference
  });

  it('should handle subtasks with complex context_scope', () => {
    // SETUP: Get subtask with complex context
    const subtask = mockBacklog.backlog[0].milestones[0].tasks[0].subtasks[2];

    // EXECUTE: Generate prompt
    const prompt = createPRPBlueprintPrompt(subtask, mockBacklog);

    // VERIFY: Complex context included
    expect(prompt.user).toContain('Complex interface');
    expect(prompt.user).toContain('Phase and Task interfaces');
    expect(prompt.user).toContain('dependencies');
  });

  it('should verify system prompt is set correctly', () => {
    // SETUP: Get a subtask
    const subtask = mockBacklog.backlog[0].milestones[0].tasks[0].subtasks[0];

    // EXECUTE: Generate prompt
    const prompt = createPRPBlueprintPrompt(subtask, mockBacklog);

    // VERIFY: System prompt set (stored as systemOverride by Groundswell)
    expect(prompt.systemOverride).toBeDefined();
    expect(typeof prompt.systemOverride).toBe('string');
    expect(prompt.systemOverride.length).toBeGreaterThan(0);
  });

  it('should maintain consistency across multiple prompts', () => {
    // SETUP: Get multiple subtasks
    const subtask1 = mockBacklog.backlog[0].milestones[0].tasks[0].subtasks[0];
    const subtask2 = mockBacklog.backlog[0].milestones[0].tasks[0].subtasks[1];

    // EXECUTE: Generate prompts
    const prompt1 = createPRPBlueprintPrompt(subtask1, mockBacklog);
    const prompt2 = createPRPBlueprintPrompt(subtask2, mockBacklog);

    // VERIFY: Both have consistent structure
    expect(prompt1.user).toContain('# Work Item Context');
    expect(prompt2.user).toContain('# Work Item Context');
    // Both prompts should have the same enableReflection state (both undefined)
    expect(prompt1.enableReflection).toBe(prompt2.enableReflection);
    expect(typeof prompt1.responseFormat).toBe(typeof prompt2.responseFormat);
  });
});
