/**
 * Architect Agent Integration Tests
 *
 * @description
 * Integration tests for Architect Agent configuration, TASK_BREAKDOWN_PROMPT validation,
 * and BacklogSchema output compliance. These tests verify the agent-factory integration
 * with Groundswell, proper configuration values, and prompt structure requirements.
 *
 * @testPath integration/agents/architect-agent-integration
 * @covers createArchitectAgent, TASK_BREAKDOWN_PROMPT, createArchitectPrompt
 * @validation Configuration, Prompt Structure, Schema Compliance
 *
 * @remarks
 * Unlike architect-agent.test.ts which validates PRD decomposition output,
 * this test suite validates the agent-factory integration setup:
 * - Architect Agent configuration (model, tokens, cache, reflection)
 * - TASK_BREAKDOWN_PROMPT structure (required sections)
 * - createArchitectPrompt integration with BacklogSchema
 * - Mock Groundswell agent deterministic testing
 *
 * @see {@link ./architect-agent.test.ts} - Output validation tests (parallel, not duplicate)
 * @see {@link ../../src/agents/agent-factory.ts} - createArchitectAgent factory
 * @see {@link ../../PROMPTS.md} - TASK_BREAKDOWN_SYSTEM_PROMPT definition
 */

import { afterEach, describe, expect, it, vi, beforeAll } from 'vitest';

// =============================================================================
// MOCK SETUP: Groundswell (NOT agent-factory)
// =============================================================================
// CRITICAL: Mock Groundswell, NOT agent-factory
// This allows testing the real createArchitectAgent() function
// We mock createAgent() which the factory calls internally
vi.mock('groundswell', async () => {
  const actual = await vi.importActual('groundswell');
  return {
    ...actual,
    createAgent: vi.fn(),
    createPrompt: vi.fn(),
  };
});

// =============================================================================
// DYNAMIC IMPORTS - Load after mocks are established
// =============================================================================

/**
 * Dynamic import for Groundswell
 *
 * @remarks
 * Ensures mocks are applied before Groundswell loads.
 * The vi.mock() above intercepts the import and provides
 * mock functions for createAgent and createPrompt.
 */
async function loadGroundswell() {
  return await import('groundswell');
}

// =============================================================================
// TEST FIXTURE: Mock Backlog Data
// =============================================================================

/**
 * Factory function for creating valid mock Backlog data
 *
 * @remarks
 * Returns a minimal valid Backlog that satisfies BacklogSchema validation.
 * Used for testing agent output schema compliance.
 *
 * @returns Valid Backlog object with Phase > Milestone > Task > Subtask hierarchy
 */
const createMockBacklog = () => ({
  backlog: [
    {
      id: 'P1',
      type: 'Phase' as const,
      title: 'Phase 1: Test',
      status: 'Planned' as const,
      description: 'Test phase',
      milestones: [
        {
          id: 'P1.M1',
          type: 'Milestone' as const,
          title: 'Milestone 1.1',
          status: 'Planned' as const,
          description: 'Test milestone',
          tasks: [
            {
              id: 'P1.M1.T1',
              type: 'Task' as const,
              title: 'Task 1.1.1',
              status: 'Planned' as const,
              description: 'Test task',
              subtasks: [
                {
                  id: 'P1.M1.T1.S1',
                  type: 'Subtask' as const,
                  title: 'Subtask 1.1.1.1',
                  status: 'Planned' as const,
                  story_points: 2,
                  dependencies: [],
                  context_scope: `CONTRACT DEFINITION:
1. RESEARCH NOTE: Test research findings.
2. INPUT: None.
3. LOGIC: Test logic implementation.
4. OUTPUT: Test output for next subtask.`,
                },
              ],
            },
          ],
        },
      ],
    },
  ],
});

// =============================================================================
// TEST SUITE: Architect Agent Integration
// =============================================================================

describe('integration/agents/architect-agent-integration', () => {
  let gs: Awaited<ReturnType<typeof loadGroundswell>>;

  // ---------------------------------------------------------------------------
  // HOOKS: Setup and cleanup
  // ---------------------------------------------------------------------------

  /**
   * Load Groundswell dynamically before all tests
   *
   * @remarks
   * Must use dynamic import to ensure vi.mock() is applied.
   * The mock provides createAgent and createPrompt spies.
   */
  beforeAll(async () => {
    gs = await loadGroundswell();
  });

  /**
   * Clear mocks before each test
   *
   * @remarks
   * Ensures each test starts with clean mock state.
   * Prevents mock call counts from accumulating across tests.
   */
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Cleanup after each test
   *
   * @remarks
   * - Unstub environment variables to prevent cross-test pollution
   * - Clear all mocks to reset spy call counts
   * - Following pattern from tests/integration/groundswell/agent-prompt.test.ts
   */
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  // ==========================================================================
  // TEST GROUP 1: Architect Agent Configuration
  // ==========================================================================

  describe('createArchitectAgent configuration', () => {
    it('should create architect agent with zai/glm-5.2 model', async () => {
      // SETUP: Import real agent-factory after mocks are applied
      const { createArchitectAgent } =
        await import('/home/dustin/projects/hacky-hack/src/agents/agent-factory.js');
      const { TASK_BREAKDOWN_PROMPT } =
        await import('/home/dustin/projects/hacky-hack/src/agents/prompts.js');

      // SETUP: Configure mock agent return value
      const mockAgent = {
        id: 'test-agent-id',
        name: 'ArchitectAgent',
        prompt: vi.fn(),
      };
      (gs.createAgent as ReturnType<typeof vi.fn>).mockReturnValue(mockAgent);

      // EXECUTE: Create architect agent
      createArchitectAgent();

      // VERIFY: createAgent called with zai/glm-5.2 model
      expect(gs.createAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'ArchitectAgent',
          model: 'zai/glm-5.2',
          system: TASK_BREAKDOWN_PROMPT,
          maxTokens: 8192,
          enableCache: true,
          enableReflection: true,
        })
      );
    });

    it('should create architect agent with 8192 max tokens', async () => {
      // SETUP: Import real agent-factory
      const { createArchitectAgent } =
        await import('/home/dustin/projects/hacky-hack/src/agents/agent-factory.js');

      // SETUP: Configure mock agent return value
      const mockAgent = {
        id: 'test-agent-id',
        name: 'ArchitectAgent',
        prompt: vi.fn(),
      };
      (gs.createAgent as ReturnType<typeof vi.fn>).mockReturnValue(mockAgent);

      // EXECUTE: Create architect agent
      createArchitectAgent();

      // VERIFY: createAgent called with maxTokens: 8192
      // GOTCHA: Architect uses 8192 (vs. 4096 for other personas)
      expect(gs.createAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          maxTokens: 8192,
        })
      );
    });

    it('should create architect agent with cache enabled', async () => {
      // SETUP: Import real agent-factory
      const { createArchitectAgent } =
        await import('/home/dustin/projects/hacky-hack/src/agents/agent-factory.js');

      // SETUP: Configure mock agent return value
      const mockAgent = {
        id: 'test-agent-id',
        name: 'ArchitectAgent',
        prompt: vi.fn(),
      };
      (gs.createAgent as ReturnType<typeof vi.fn>).mockReturnValue(mockAgent);

      // EXECUTE: Create architect agent
      createArchitectAgent();

      // VERIFY: createAgent called with enableCache: true
      expect(gs.createAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          enableCache: true,
        })
      );
    });

    it('should create architect agent with reflection enabled', async () => {
      // SETUP: Import real agent-factory
      const { createArchitectAgent } =
        await import('/home/dustin/projects/hacky-hack/src/agents/agent-factory.js');

      // SETUP: Configure mock agent return value
      const mockAgent = {
        id: 'test-agent-id',
        name: 'ArchitectAgent',
        prompt: vi.fn(),
      };
      (gs.createAgent as ReturnType<typeof vi.fn>).mockReturnValue(mockAgent);

      // EXECUTE: Create architect agent
      createArchitectAgent();

      // VERIFY: createAgent called with enableReflection: true
      expect(gs.createAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          enableReflection: true,
        })
      );
    });
  });

  // ==========================================================================
  // TEST GROUP 2: TASK_BREAKDOWN_PROMPT Validation
  // ==========================================================================

  describe('TASK_BREAKDOWN_PROMPT validation', () => {
    it('should contain Research-Driven Architecture section', async () => {
      // SETUP: Import TASK_BREAKDOWN_PROMPT
      const { TASK_BREAKDOWN_PROMPT } =
        await import('/home/dustin/projects/hacky-hack/src/agents/prompts.js');

      // VERIFY: Contains key phrases from Research-Driven Architecture section
      expect(TASK_BREAKDOWN_PROMPT).toContain('RESEARCH-DRIVEN ARCHITECTURE');
      expect(TASK_BREAKDOWN_PROMPT).toContain('SPAWN SUBAGENTS');
      expect(TASK_BREAKDOWN_PROMPT).toContain('$SESSION_DIR/architecture/');
      expect(TASK_BREAKDOWN_PROMPT).toContain('VALIDATE BEFORE BREAKING DOWN');
    });

    it('should contain Implicit TDD section', async () => {
      // SETUP: Import TASK_BREAKDOWN_PROMPT
      const { TASK_BREAKDOWN_PROMPT } =
        await import('/home/dustin/projects/hacky-hack/src/agents/prompts.js');

      // VERIFY: Contains key phrases from Implicit TDD section
      expect(TASK_BREAKDOWN_PROMPT).toContain('IMPLICIT TDD');
      expect(TASK_BREAKDOWN_PROMPT).toContain(
        '**DO NOT** create subtasks for "Write Tests."'
      );
      expect(TASK_BREAKDOWN_PROMPT).toContain('DEFINITION OF DONE');
    });

    it('should contain Context Scope Blinder section', async () => {
      // SETUP: Import TASK_BREAKDOWN_PROMPT
      const { TASK_BREAKDOWN_PROMPT } =
        await import('/home/dustin/projects/hacky-hack/src/agents/prompts.js');

      // VERIFY: Contains key phrases from Context Scope Blinder section
      expect(TASK_BREAKDOWN_PROMPT).toContain('CONTEXT SCOPE');
      expect(TASK_BREAKDOWN_PROMPT).toContain('INPUT:');
      expect(TASK_BREAKDOWN_PROMPT).toContain('OUTPUT:');
      expect(TASK_BREAKDOWN_PROMPT).toContain('MOCKING:');
    });

    it('should instruct to write to $TASKS_FILE', async () => {
      // SETUP: Import TASK_BREAKDOWN_PROMPT
      const { TASK_BREAKDOWN_PROMPT } =
        await import('/home/dustin/projects/hacky-hack/src/agents/prompts.js');

      // VERIFY: Contains output format instructions
      expect(TASK_BREAKDOWN_PROMPT).toContain('./$TASKS_FILE');
      expect(TASK_BREAKDOWN_PROMPT).toContain(
        'Do NOT output JSON to the conversation'
      );
      expect(TASK_BREAKDOWN_PROMPT).toContain('WRITE IT TO THE FILE');
    });

    it('should contain CONTRACT DEFINITION instructions for context_scope', async () => {
      // SETUP: Import TASK_BREAKDOWN_PROMPT
      const { TASK_BREAKDOWN_PROMPT } =
        await import('/home/dustin/projects/hacky-hack/src/agents/prompts.js');

      // VERIFY: Contains CONTRACT DEFINITION format instructions
      // This is critical for ContextScopeSchema validation
      expect(TASK_BREAKDOWN_PROMPT).toContain('CONTRACT DEFINITION:');
      expect(TASK_BREAKDOWN_PROMPT).toContain('1. RESEARCH NOTE:');
      expect(TASK_BREAKDOWN_PROMPT).toContain('2. INPUT:');
      expect(TASK_BREAKDOWN_PROMPT).toContain('3. LOGIC:');
      expect(TASK_BREAKDOWN_PROMPT).toContain('4. OUTPUT:');
    });
  });

  // ==========================================================================
  // TEST GROUP 3: createArchitectPrompt Integration
  // ==========================================================================

  describe('createArchitectPrompt', () => {
    it('should create prompt with BacklogSchema responseFormat', async () => {
      // SETUP: Import createArchitectPrompt and BacklogSchema
      const { createArchitectPrompt } =
        await import('/home/dustin/projects/hacky-hack/src/agents/prompts/architect-prompt.js');
      const { BacklogSchema } =
        await import('/home/dustin/projects/hacky-hack/src/core/models.js');

      // SETUP: Mock createPrompt to return a prompt object
      const mockPrompt = {
        user: '',
        system: '',
        responseFormat: BacklogSchema,
        enableReflection: true,
        getResponseFormat: vi.fn(() => BacklogSchema),
      };
      (gs.createPrompt as ReturnType<typeof vi.fn>).mockReturnValue(mockPrompt);

      // EXECUTE: Create architect prompt
      const prdContent = '# Test PRD\n\nTest content.';
      createArchitectPrompt(prdContent);

      // VERIFY: createPrompt called with BacklogSchema as responseFormat
      expect(gs.createPrompt).toHaveBeenCalledWith(
        expect.objectContaining({
          user: prdContent,
          responseFormat: BacklogSchema,
        })
      );
    });

    it('should create prompt with enableReflection', async () => {
      // SETUP: Import createArchitectPrompt
      const { createArchitectPrompt } =
        await import('/home/dustin/projects/hacky-hack/src/agents/prompts/architect-prompt.js');
      const { BacklogSchema } =
        await import('/home/dustin/projects/hacky-hack/src/core/models.js');

      // SETUP: Mock createPrompt return value
      const mockPrompt = {
        user: '',
        system: '',
        responseFormat: BacklogSchema,
        enableReflection: true,
        getResponseFormat: vi.fn(() => BacklogSchema),
      };
      (gs.createPrompt as ReturnType<typeof vi.fn>).mockReturnValue(mockPrompt);

      // EXECUTE: Create architect prompt
      const prdContent = '# Test PRD\n\nTest content.';
      createArchitectPrompt(prdContent);

      // VERIFY: createPrompt called with enableReflection: true
      // CRITICAL: Reflection provides error recovery for complex JSON generation
      expect(gs.createPrompt).toHaveBeenCalledWith(
        expect.objectContaining({
          enableReflection: true,
        })
      );
    });

    it('should create prompt with TASK_BREAKDOWN_SYSTEM_PROMPT', async () => {
      // SETUP: Import createArchitectPrompt and TASK_BREAKDOWN_PROMPT
      const { createArchitectPrompt } =
        await import('/home/dustin/projects/hacky-hack/src/agents/prompts/architect-prompt.js');
      const { TASK_BREAKDOWN_PROMPT } =
        await import('/home/dustin/projects/hacky-hack/src/agents/prompts.js');
      const { BacklogSchema } =
        await import('/home/dustin/projects/hacky-hack/src/core/models.js');

      // SETUP: Mock createPrompt return value
      const mockPrompt = {
        user: '',
        system: TASK_BREAKDOWN_PROMPT,
        responseFormat: BacklogSchema,
        enableReflection: true,
        getResponseFormat: vi.fn(() => BacklogSchema),
      };
      (gs.createPrompt as ReturnType<typeof vi.fn>).mockReturnValue(mockPrompt);

      // EXECUTE: Create architect prompt
      const prdContent = '# Test PRD\n\nTest content.';
      createArchitectPrompt(prdContent);

      // VERIFY: createPrompt called with TASK_BREAKDOWN_PROMPT as system
      expect(gs.createPrompt).toHaveBeenCalledWith(
        expect.objectContaining({
          system: TASK_BREAKDOWN_PROMPT,
        })
      );
    });
  });

  // ==========================================================================
  // TEST GROUP 4: Agent Output Schema Validation
  // ==========================================================================

  describe('agent output validation', () => {
    it('should validate output against BacklogSchema', async () => {
      // SETUP: Import BacklogSchema and createArchitectAgent
      const { BacklogSchema } =
        await import('/home/dustin/projects/hacky-hack/src/core/models.js');
      const { createArchitectAgent } =
        await import('/home/dustin/projects/hacky-hack/src/agents/agent-factory.js');
      const { createArchitectPrompt } =
        await import('/home/dustin/projects/hacky-hack/src/agents/prompts/architect-prompt.js');

      // SETUP: Create mock agent with controlled response
      const mockBacklog = createMockBacklog();
      const mockAgent = {
        id: 'test-agent-id',
        name: 'ArchitectAgent',
        prompt: vi.fn().mockResolvedValue(mockBacklog),
      };
      (gs.createAgent as ReturnType<typeof vi.fn>).mockReturnValue(mockAgent);

      // EXECUTE: Call architect agent
      const architect = createArchitectAgent();
      const prompt = createArchitectPrompt('# Test PRD');
      const result = await architect.prompt(prompt);

      // VERIFY: Result validates against BacklogSchema
      const validation = BacklogSchema.safeParse(result);
      expect(validation.success).toBe(true);
    });

    it('should validate all ID formats', async () => {
      // SETUP: Import and create mock agent
      const { BacklogSchema } =
        await import('/home/dustin/projects/hacky-hack/src/core/models.js');
      const { createArchitectAgent } =
        await import('/home/dustin/projects/hacky-hack/src/agents/agent-factory.js');
      const { createArchitectPrompt } =
        await import('/home/dustin/projects/hacky-hack/src/agents/prompts/architect-prompt.js');

      const mockBacklog = createMockBacklog();
      const mockAgent = {
        id: 'test-agent-id',
        name: 'ArchitectAgent',
        prompt: vi.fn().mockResolvedValue(mockBacklog),
      };
      (gs.createAgent as ReturnType<typeof vi.fn>).mockReturnValue(mockAgent);

      // EXECUTE: Call architect agent
      const architect = createArchitectAgent();
      const prompt = createArchitectPrompt('# Test PRD');
      const result = await architect.prompt(prompt);

      // VERIFY: Validate against schema
      const validation = BacklogSchema.safeParse(result);
      expect(validation.success).toBe(true);

      if (validation.success) {
        // VERIFY: Phase IDs match /^P\d+$/
        for (const phase of validation.data.backlog) {
          expect(phase.id).toMatch(/^P\d+$/);
          expect(phase.type).toBe('Phase');

          // VERIFY: Milestone IDs match /^P\d+\.M\d+$/
          for (const milestone of phase.milestones) {
            expect(milestone.id).toMatch(/^P\d+\.M\d+$/);
            expect(milestone.type).toBe('Milestone');

            // VERIFY: Task IDs match /^P\d+\.M\d+\.T\d+$/
            for (const task of milestone.tasks) {
              expect(task.id).toMatch(/^P\d+\.M\d+\.T\d+$/);
              expect(task.type).toBe('Task');

              // VERIFY: Subtask IDs match /^P\d+\.M\d+\.T\d+\.S\d+$/
              for (const subtask of task.subtasks) {
                expect(subtask.id).toMatch(/^P\d+\.M\d+\.T\d+\.S\d+$/);
                expect(subtask.type).toBe('Subtask');
              }
            }
          }
        }
      }
    });

    it('should validate story_points are integers 1-21', async () => {
      // SETUP: Import and create mock agent
      const { BacklogSchema } =
        await import('/home/dustin/projects/hacky-hack/src/core/models.js');
      const { createArchitectAgent } =
        await import('/home/dustin/projects/hacky-hack/src/agents/agent-factory.js');
      const { createArchitectPrompt } =
        await import('/home/dustin/projects/hacky-hack/src/agents/prompts/architect-prompt.js');

      // SETUP: Create mock backlog with valid story points
      const mockBacklog = createMockBacklog();
      const mockAgent = {
        id: 'test-agent-id',
        name: 'ArchitectAgent',
        prompt: vi.fn().mockResolvedValue(mockBacklog),
      };
      (gs.createAgent as ReturnType<typeof vi.fn>).mockReturnValue(mockAgent);

      // EXECUTE: Call architect agent
      const architect = createArchitectAgent();
      const prompt = createArchitectPrompt('# Test PRD');
      const result = await architect.prompt(prompt);

      // VERIFY: Validate against schema
      const validation = BacklogSchema.safeParse(result);
      expect(validation.success).toBe(true);

      if (validation.success) {
        // VERIFY: Traverse all subtasks and validate story_points
        // GOTCHA: Story points in PROMPTS.md say "0.5, 1, or 2"
        // BUT schema requires integers 1-21 (Fibonacci)
        // Tests validate schema compliance, not prompt text
        for (const phase of validation.data.backlog) {
          for (const milestone of phase.milestones) {
            for (const task of milestone.tasks) {
              for (const subtask of task.subtasks) {
                expect(Number.isInteger(subtask.story_points)).toBe(true);
                expect(subtask.story_points).toBeGreaterThanOrEqual(1);
                expect(subtask.story_points).toBeLessThanOrEqual(21);
              }
            }
          }
        }
      }
    });

    it('should validate context_scope format', async () => {
      // SETUP: Import and create mock agent
      const { BacklogSchema } =
        await import('/home/dustin/projects/hacky-hack/src/core/models.js');
      const { createArchitectAgent } =
        await import('/home/dustin/projects/hacky-hack/src/agents/agent-factory.js');
      const { createArchitectPrompt } =
        await import('/home/dustin/projects/hacky-hack/src/agents/prompts/architect-prompt.js');

      const mockBacklog = createMockBacklog();
      const mockAgent = {
        id: 'test-agent-id',
        name: 'ArchitectAgent',
        prompt: vi.fn().mockResolvedValue(mockBacklog),
      };
      (gs.createAgent as ReturnType<typeof vi.fn>).mockReturnValue(mockAgent);

      // EXECUTE: Call architect agent
      const architect = createArchitectAgent();
      const prompt = createArchitectPrompt('# Test PRD');
      const result = await architect.prompt(prompt);

      // VERIFY: Validate against schema
      const validation = BacklogSchema.safeParse(result);
      expect(validation.success).toBe(true);

      if (validation.success) {
        // VERIFY: All context_scope contain CONTRACT DEFINITION with 4 numbered sections
        for (const phase of validation.data.backlog) {
          for (const milestone of phase.milestones) {
            for (const task of milestone.tasks) {
              for (const subtask of task.subtasks) {
                expect(subtask.context_scope).toContain('CONTRACT DEFINITION:');
                expect(subtask.context_scope).toContain('1. RESEARCH NOTE:');
                expect(subtask.context_scope).toContain('2. INPUT:');
                expect(subtask.context_scope).toContain('3. LOGIC:');
                expect(subtask.context_scope).toContain('4. OUTPUT:');
              }
            }
          }
        }
      }
    });
  });

  // ==========================================================================
  // TEST GROUP 5: Mock Groundswell Agent Integration
  // ==========================================================================

  describe('mock Groundswell agent integration', () => {
    it('should return mock Backlog data deterministically', async () => {
      // SETUP: Import agent factory and prompt creator
      const { createArchitectAgent } =
        await import('/home/dustin/projects/hacky-hack/src/agents/agent-factory.js');
      const { createArchitectPrompt } =
        await import('/home/dustin/projects/hacky-hack/src/agents/prompts/architect-prompt.js');

      // SETUP: Create controlled mock response
      const mockBacklog = createMockBacklog();
      const mockAgent = {
        id: 'test-agent-id',
        name: 'ArchitectAgent',
        prompt: vi.fn().mockResolvedValue(mockBacklog),
      };
      (gs.createAgent as ReturnType<typeof vi.fn>).mockReturnValue(mockAgent);

      // EXECUTE: Call architect agent
      const architect = createArchitectAgent();
      const prompt = createArchitectPrompt('# Test PRD');
      const result = await architect.prompt(prompt);

      // VERIFY: Returns expected Backlog structure
      expect(result).toEqual(mockBacklog);
      expect(result.backlog).toBeDefined();
      expect(result.backlog).toBeInstanceOf(Array);
      expect(result.backlog.length).toBeGreaterThan(0);
    });

    it('should allow deterministic testing with consistent mock output', async () => {
      // SETUP: Import agent factory and prompt creator
      const { createArchitectAgent } =
        await import('/home/dustin/projects/hacky-hack/src/agents/agent-factory.js');
      const { createArchitectPrompt } =
        await import('/home/dustin/projects/hacky-hack/src/agents/prompts/architect-prompt.js');

      // SETUP: Create specific mock return values
      const mockBacklog1 = createMockBacklog();
      const mockAgent = {
        id: 'test-agent-id',
        name: 'ArchitectAgent',
        prompt: vi.fn().mockResolvedValue(mockBacklog1),
      };
      (gs.createAgent as ReturnType<typeof vi.fn>).mockReturnValue(mockAgent);

      // EXECUTE: Run test multiple times
      const architect = createArchitectAgent();
      const prompt = createArchitectPrompt('# Test PRD');

      const result1 = await architect.prompt(prompt);
      const result2 = await architect.prompt(prompt);

      // VERIFY: Consistent output (no random LLM variation)
      expect(result1).toEqual(result2);
      expect(result1.backlog[0].id).toBe('P1');
      expect(result2.backlog[0].id).toBe('P1');
    });
  });
});
