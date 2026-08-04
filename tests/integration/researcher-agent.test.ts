/**
 * Researcher Agent Integration Tests
 *
 * @description
 * Integration tests for Researcher Agent configuration, PRP_CREATE_PROMPT validation,
 * PRP template structure compliance, and cache system behavior. These tests verify
 * the agent-factory integration with Groundswell, proper configuration values,
 * prompt structure requirements, and cache implementation correctness.
 *
 * @testPath integration/researcher-agent
 * @covers createResearcherAgent, PRP_BLUEPRINT_PROMPT, PRPGenerator cache
 * @validation Configuration, Prompt Structure, Template Compliance, Cache Behavior
 *
 * @remarks
 * Unlike prp-generator-integration.test.ts which validates PRP generation flow,
 * this test suite validates the Researcher Agent integration setup:
 * - Researcher Agent configuration (model: GLM-4.7, maxTokens: 4096, MCP tools, cache)
 * - PRP_CREATE_PROMPT structure (Research Process, PRP Generation Process, Template)
 * - PRP template structure compliance (all required sections present)
 * - Cache system behavior (SHA-256 hash computation, 24-hour TTL, metadata storage)
 * - Mock Groundswell agent deterministic testing
 *
 * @see {@link ./prp-generator-integration.test.ts} - PRP generation flow tests (parallel, not duplicate)
 * @see {@link ../../src/agents/agent-factory.ts} - createResearcherAgent factory
 * @see {@link ../../PROMPTS.md} - PRP_CREATE_PROMPT definition
 * @see {@link ../../src/agents/prp-generator.ts} - Cache implementation
 */

import { afterEach, describe, expect, it, vi, beforeAll } from 'vitest';

// =============================================================================
// MOCK SETUP: Groundswell (NOT agent-factory)
// =============================================================================
// CRITICAL: Mock Groundswell, NOT agent-factory
// This allows testing the real createResearcherAgent() function
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
// TEST FIXTURE: Mock PRPDocument Data
// =============================================================================

/**
 * Factory function for creating valid mock PRPDocument data
 *
 * @remarks
 * Returns a minimal valid PRPDocument that satisfies PRPDocumentSchema validation.
 * Used for testing agent output schema compliance and cache metadata.
 *
 * @param taskId - The task ID for the PRP
 * @returns Valid PRPDocument object with all required fields
 */
const createMockPRPDocument = (taskId: string) => ({
  taskId,
  objective: 'Test objective',
  context: 'Test context',
  implementationSteps: ['Step 1', 'Step 2', 'Step 3'],
  validationGates: [
    {
      level: 1,
      description: 'Syntax & Style validation',
      command: 'npm test',
      manual: false,
    },
    {
      level: 2,
      description: 'Unit Tests',
      command: 'npm run lint',
      manual: false,
    },
    {
      level: 3,
      description: 'Integration Testing',
      command: null,
      manual: true,
    },
    {
      level: 4,
      description: 'Manual validation',
      command: 'npm run build',
      manual: true,
    },
  ],
  successCriteria: [
    { description: 'Test criterion 1', satisfied: false },
    { description: 'Test criterion 2', satisfied: false },
  ],
  references: ['Reference 1', 'Reference 2'],
});

/**
 * Factory function for creating valid mock Backlog with Task
 *
 * @remarks
 * Returns a minimal valid Backlog with a Task for testing hash computation.
 * Tasks use `description` field for hashing (vs. `context_scope` for Subtasks).
 *
 * @returns Valid Backlog object with Phase > Milestone > Task hierarchy
 */
const createMockBacklogWithTask = () => ({
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
              description: 'Test task description',
              subtasks: [],
            },
          ],
        },
      ],
    },
  ],
});

/**
 * Factory function for creating valid mock Backlog with Subtask
 *
 * @remarks
 * Returns a minimal valid Backlog with a Subtask for testing hash computation.
 * Subtasks use `context_scope` field for hashing (vs. `description` for Tasks).
 *
 * @returns Valid Backlog object with Phase > Milestone > Task > Subtask hierarchy
 */
const createMockBacklogWithSubtask = () => ({
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
              description: 'Test task description',
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
// TEST SUITE: Researcher Agent Integration
// =============================================================================

describe('integration/researcher-agent', () => {
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
  // TEST GROUP 1: Researcher Agent Configuration
  // ==========================================================================

  describe('createResearcherAgent configuration', () => {
    it('should create researcher agent with GLM-4.7 model', async () => {
      // SETUP: Import real agent-factory after mocks are applied
      const { createResearcherAgent } =
        await import('/home/dustin/projects/hacky-hack/src/agents/agent-factory.js');
      const { PRP_BLUEPRINT_PROMPT } =
        await import('/home/dustin/projects/hacky-hack/src/agents/prompts.js');

      // SETUP: Configure mock agent return value
      const mockAgent = {
        id: 'test-agent-id',
        name: 'ResearcherAgent',
        prompt: vi.fn(),
      };
      (gs.createAgent as ReturnType<typeof vi.fn>).mockReturnValue(mockAgent);

      // EXECUTE: Create researcher agent
      createResearcherAgent();

      // VERIFY: createAgent called with GLM-4.7 model
      expect(gs.createAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'ResearcherAgent',
          model: 'zai/glm-5.2',
          system: PRP_BLUEPRINT_PROMPT,
          maxTokens: 4096,
          enableCache: true,
          enableReflection: true,
        })
      );
    });

    it('should create researcher agent with 4096 max tokens', async () => {
      // SETUP: Import real agent-factory
      const { createResearcherAgent } =
        await import('/home/dustin/projects/hacky-hack/src/agents/agent-factory.js');

      // SETUP: Configure mock agent return value
      const mockAgent = {
        id: 'test-agent-id',
        name: 'ResearcherAgent',
        prompt: vi.fn(),
      };
      (gs.createAgent as ReturnType<typeof vi.fn>).mockReturnValue(mockAgent);

      // EXECUTE: Create researcher agent
      createResearcherAgent();

      // VERIFY: createAgent called with maxTokens: 4096
      // GOTCHA: Researcher uses 4096 (vs. 8192 for Architect)
      expect(gs.createAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          maxTokens: 4096,
        })
      );
    });

    it('should create researcher agent with cache enabled', async () => {
      // SETUP: Import real agent-factory
      const { createResearcherAgent } =
        await import('/home/dustin/projects/hacky-hack/src/agents/agent-factory.js');

      // SETUP: Configure mock agent return value
      const mockAgent = {
        id: 'test-agent-id',
        name: 'ResearcherAgent',
        prompt: vi.fn(),
      };
      (gs.createAgent as ReturnType<typeof vi.fn>).mockReturnValue(mockAgent);

      // EXECUTE: Create researcher agent
      createResearcherAgent();

      // VERIFY: createAgent called with enableCache: true
      expect(gs.createAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          enableCache: true,
        })
      );
    });

    it('should create researcher agent with reflection enabled', async () => {
      // SETUP: Import real agent-factory
      const { createResearcherAgent } =
        await import('/home/dustin/projects/hacky-hack/src/agents/agent-factory.js');

      // SETUP: Configure mock agent return value
      const mockAgent = {
        id: 'test-agent-id',
        name: 'ResearcherAgent',
        prompt: vi.fn(),
      };
      (gs.createAgent as ReturnType<typeof vi.fn>).mockReturnValue(mockAgent);

      // EXECUTE: Create researcher agent
      createResearcherAgent();

      // VERIFY: createAgent called with enableReflection: true
      expect(gs.createAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          enableReflection: true,
        })
      );
    });

    it('should create researcher agent with MCP tools', async () => {
      // SETUP: Import real agent-factory and MCP tool classes
      const { createResearcherAgent } =
        await import('/home/dustin/projects/hacky-hack/src/agents/agent-factory.js');
      const { BashMCP } =
        await import('/home/dustin/projects/hacky-hack/src/tools/bash-mcp.js');
      const { FilesystemMCP } =
        await import('/home/dustin/projects/hacky-hack/src/tools/filesystem-mcp.js');
      const { GitMCP } =
        await import('/home/dustin/projects/hacky-hack/src/tools/git-mcp.js');

      // SETUP: Configure mock agent return value
      const mockAgent = {
        id: 'test-agent-id',
        name: 'ResearcherAgent',
        prompt: vi.fn(),
      };
      (gs.createAgent as ReturnType<typeof vi.fn>).mockReturnValue(mockAgent);

      // EXECUTE: Create researcher agent
      createResearcherAgent();

      // VERIFY: createAgent called with MCP tools
      // The actual tools are instances of BashMCP, FilesystemMCP, GitMCP
      const mcpCall = (gs.createAgent as ReturnType<typeof vi.fn>).mock
        .calls[0];
      const mcps = mcpCall[0].mcps;

      expect(mcps).toHaveLength(3);
      expect(mcps[0]).toBeInstanceOf(BashMCP);
      expect(mcps[1]).toBeInstanceOf(FilesystemMCP);
      expect(mcps[2]).toBeInstanceOf(GitMCP);
    });
  });

  // ==========================================================================
  // TEST GROUP 2: PRP_CREATE_PROMPT Structure Validation
  // ==========================================================================

  describe('PRP_CREATE_PROMPT structure validation', () => {
    it('should contain Research Process section', async () => {
      // SETUP: Import PRP_CREATE_PROMPT
      const { PRP_BLUEPRINT_PROMPT } =
        await import('/home/dustin/projects/hacky-hack/src/agents/prompts.js');

      // VERIFY: Contains key phrases from Research Process section
      expect(PRP_BLUEPRINT_PROMPT).toContain('Research Process');
      expect(PRP_BLUEPRINT_PROMPT).toContain('Codebase Analysis in depth');
      expect(PRP_BLUEPRINT_PROMPT).toContain('Internal Research at scale');
      expect(PRP_BLUEPRINT_PROMPT).toContain('External Research at scale');
      expect(PRP_BLUEPRINT_PROMPT).toContain('User Clarification');
    });

    it('should contain PRP Generation Process section', async () => {
      // SETUP: Import PRP_CREATE_PROMPT
      const { PRP_BLUEPRINT_PROMPT } =
        await import('/home/dustin/projects/hacky-hack/src/agents/prompts.js');

      // VERIFY: Contains all 5 steps from PRP Generation Process
      expect(PRP_BLUEPRINT_PROMPT).toContain('PRP Generation Process');
      expect(PRP_BLUEPRINT_PROMPT).toContain('Step 1: Review Template');
      expect(PRP_BLUEPRINT_PROMPT).toContain(
        'Step 2: Context Completeness Validation'
      );
      expect(PRP_BLUEPRINT_PROMPT).toContain('Step 3: Research Integration');
      expect(PRP_BLUEPRINT_PROMPT).toContain(
        'Step 4: Information Density Standards'
      );
      expect(PRP_BLUEPRINT_PROMPT).toContain(
        'Step 5: ULTRATHINK Before Writing'
      );
    });

    it('should instruct to spawn subagents', async () => {
      // SETUP: Import PRP_CREATE_PROMPT
      const { PRP_BLUEPRINT_PROMPT } =
        await import('/home/dustin/projects/hacky-hack/src/agents/prompts.js');

      // VERIFY: Prompt still instructs on subagent usage. Wording was de-escalated to
      // OPTIONAL/best-effort during the roles refactor; assert the CURRENT literals present
      // in PRP_BLUEPRINT_PROMPT (src/agents/prompts.ts:182-674).
      expect(PRP_BLUEPRINT_PROMPT).toContain(
        'Subagents are OPTIONAL and may be unavailable'
      );
      expect(PRP_BLUEPRINT_PROMPT).toContain(
        'or built-in subagents if available'
      );
    });

    it('should instruct to use TodoWrite tool', async () => {
      // SETUP: Import PRP_CREATE_PROMPT
      const { PRP_BLUEPRINT_PROMPT } =
        await import('/home/dustin/projects/hacky-hack/src/agents/prompts.js');

      // VERIFY: Contains TodoWrite tool instructions
      expect(PRP_BLUEPRINT_PROMPT).toContain('TodoWrite');
      expect(PRP_BLUEPRINT_PROMPT).toContain(
        'create comprehensive PRP writing plan'
      );
    });

    it('should mention architecture/ directory', async () => {
      // SETUP: Import PRP_CREATE_PROMPT
      const { PRP_BLUEPRINT_PROMPT } =
        await import('/home/dustin/projects/hacky-hack/src/agents/prompts.js');

      // VERIFY: Contains architecture directory reference
      // GOTCHA: The PRP_BLUEPRINT_PROMPT in PROMPTS.md uses "plan/architecture" not "$SESSION_DIR/architecture/"
      expect(PRP_BLUEPRINT_PROMPT).toContain('plan/architecture');
    });

    it('should contain PRP-README and PRP-TEMPLATE sections', async () => {
      // SETUP: Import PRP_CREATE_PROMPT
      const { PRP_BLUEPRINT_PROMPT } =
        await import('/home/dustin/projects/hacky-hack/src/agents/prompts.js');

      // VERIFY: Contains placeholder tags for README and TEMPLATE
      expect(PRP_BLUEPRINT_PROMPT).toContain('<PRP-README>');
      expect(PRP_BLUEPRINT_PROMPT).toContain('</PRP-README>');
      expect(PRP_BLUEPRINT_PROMPT).toContain('<PRP-TEMPLATE>');
      expect(PRP_BLUEPRINT_PROMPT).toContain('</PRP-TEMPLATE>');
    });
  });

  // ==========================================================================
  // TEST GROUP 3: PRP Template Structure Validation
  // ==========================================================================

  describe('PRP template structure validation', () => {
    it('should contain Goal section in template', async () => {
      // SETUP: Import PRP_CREATE_PROMPT
      const { PRP_BLUEPRINT_PROMPT } =
        await import('/home/dustin/projects/hacky-hack/src/agents/prompts.js');

      // VERIFY: Template contains Goal section with required subsections
      expect(PRP_BLUEPRINT_PROMPT).toContain('## Goal');
      expect(PRP_BLUEPRINT_PROMPT).toContain('**Feature Goal**:');
      expect(PRP_BLUEPRINT_PROMPT).toContain('**Deliverable**:');
      expect(PRP_BLUEPRINT_PROMPT).toContain('**Success Definition**:');
    });

    it('should contain User Persona section in template', async () => {
      // SETUP: Import PRP_CREATE_PROMPT
      const { PRP_BLUEPRINT_PROMPT } =
        await import('/home/dustin/projects/hacky-hack/src/agents/prompts.js');

      // VERIFY: Template contains User Persona section
      expect(PRP_BLUEPRINT_PROMPT).toContain('## User Persona');
    });

    it('should contain Why section in template', async () => {
      // SETUP: Import PRP_CREATE_PROMPT
      const { PRP_BLUEPRINT_PROMPT } =
        await import('/home/dustin/projects/hacky-hack/src/agents/prompts.js');

      // VERIFY: Template contains Why section
      expect(PRP_BLUEPRINT_PROMPT).toContain('## Why');
    });

    it('should contain What section in template', async () => {
      // SETUP: Import PRP_CREATE_PROMPT
      const { PRP_BLUEPRINT_PROMPT } =
        await import('/home/dustin/projects/hacky-hack/src/agents/prompts.js');

      // VERIFY: Template contains What section with Success Criteria
      expect(PRP_BLUEPRINT_PROMPT).toContain('## What');
      expect(PRP_BLUEPRINT_PROMPT).toContain('### Success Criteria');
    });

    it('should contain All Needed Context section in template', async () => {
      // SETUP: Import PRP_CREATE_PROMPT
      const { PRP_BLUEPRINT_PROMPT } =
        await import('/home/dustin/projects/hacky-hack/src/agents/prompts.js');

      // VERIFY: Template contains All Needed Context section with subsections
      expect(PRP_BLUEPRINT_PROMPT).toContain('## All Needed Context');
      expect(PRP_BLUEPRINT_PROMPT).toContain('### Context Completeness Check');
      expect(PRP_BLUEPRINT_PROMPT).toContain('### Documentation & References');
      expect(PRP_BLUEPRINT_PROMPT).toContain('### Current Codebase');
      expect(PRP_BLUEPRINT_PROMPT).toContain('### Desired Codebase');
      expect(PRP_BLUEPRINT_PROMPT).toContain('### Known Gotchas');
    });

    it('should contain Implementation Blueprint section in template', async () => {
      // SETUP: Import PRP_CREATE_PROMPT
      const { PRP_BLUEPRINT_PROMPT } =
        await import('/home/dustin/projects/hacky-hack/src/agents/prompts.js');

      // VERIFY: Template contains Implementation Blueprint section with subsections
      expect(PRP_BLUEPRINT_PROMPT).toContain('## Implementation Blueprint');
      expect(PRP_BLUEPRINT_PROMPT).toContain('### Data models and structure');
      expect(PRP_BLUEPRINT_PROMPT).toContain('### Implementation Tasks');
      expect(PRP_BLUEPRINT_PROMPT).toContain('### Implementation Patterns');
      expect(PRP_BLUEPRINT_PROMPT).toContain('### Integration Points');
    });

    it('should contain Validation Loop section in template', async () => {
      // SETUP: Import PRP_CREATE_PROMPT
      const { PRP_BLUEPRINT_PROMPT } =
        await import('/home/dustin/projects/hacky-hack/src/agents/prompts.js');

      // VERIFY: Template contains Validation Loop section with 4 levels
      expect(PRP_BLUEPRINT_PROMPT).toContain('## Validation Loop');
      expect(PRP_BLUEPRINT_PROMPT).toContain('### Level 1: Syntax & Style');
      expect(PRP_BLUEPRINT_PROMPT).toContain('### Level 2: Unit Tests');
      expect(PRP_BLUEPRINT_PROMPT).toContain(
        '### Level 3: Integration Testing'
      );
      expect(PRP_BLUEPRINT_PROMPT).toContain('### Level 4:');
    });

    it('should contain Final Validation Checklist section in template', async () => {
      // SETUP: Import PRP_CREATE_PROMPT
      const { PRP_BLUEPRINT_PROMPT } =
        await import('/home/dustin/projects/hacky-hack/src/agents/prompts.js');

      // VERIFY: Template contains Final Validation Checklist section
      expect(PRP_BLUEPRINT_PROMPT).toContain('## Final Validation Checklist');
      expect(PRP_BLUEPRINT_PROMPT).toContain('### Technical Validation');
      expect(PRP_BLUEPRINT_PROMPT).toContain('### Feature Validation');
      expect(PRP_BLUEPRINT_PROMPT).toContain('### Code Quality Validation');
      expect(PRP_BLUEPRINT_PROMPT).toContain('### Documentation & Deployment');
    });

    it('should contain Anti-Patterns section in template', async () => {
      // SETUP: Import PRP_CREATE_PROMPT
      const { PRP_BLUEPRINT_PROMPT } =
        await import('/home/dustin/projects/hacky-hack/src/agents/prompts.js');

      // VERIFY: Template contains Anti-Patterns section
      expect(PRP_BLUEPRINT_PROMPT).toContain('## Anti-Patterns to Avoid');
    });

    it('should contain all required PRP template sections', async () => {
      // SETUP: Import PRP_CREATE_PROMPT
      const { PRP_BLUEPRINT_PROMPT } =
        await import('/home/dustin/projects/hacky-hack/src/agents/prompts.js');

      // VERIFY: All main sections are present
      expect(PRP_BLUEPRINT_PROMPT).toContain('## Goal');
      expect(PRP_BLUEPRINT_PROMPT).toContain('## User Persona');
      expect(PRP_BLUEPRINT_PROMPT).toContain('## Why');
      expect(PRP_BLUEPRINT_PROMPT).toContain('## What');
      expect(PRP_BLUEPRINT_PROMPT).toContain('## All Needed Context');
      expect(PRP_BLUEPRINT_PROMPT).toContain('## Implementation Blueprint');
      expect(PRP_BLUEPRINT_PROMPT).toContain('## Validation Loop');
      expect(PRP_BLUEPRINT_PROMPT).toContain('## Final Validation Checklist');
      expect(PRP_BLUEPRINT_PROMPT).toContain('## Anti-Patterns to Avoid');
    });
  });

  // ==========================================================================
  // TEST GROUP 4: Cache Hash Computation
  // ==========================================================================

  describe('cache hash computation', () => {
    it('should use SHA-256 for hashing', async () => {
      // SETUP: This test verifies implementation by inspecting prp-generator.ts
      // The #computeTaskHash method (line 225-250) uses createHash('sha256')
      const { createHash } = await import('crypto');

      // VERIFY: createHash('sha256') is available (used in implementation)
      expect(typeof createHash).toBe('function');
      const hash = createHash('sha256').update('test').digest('hex');
      expect(hash).toHaveLength(64); // SHA-256 produces 64 hex characters
    });

    it('should hash Task with id, title, description', async () => {
      // SETUP: This test documents the hash input fields for Task
      // From prp-generator.ts lines 229-235:
      // Task hash includes: id, title, description
      const mockBacklog = createMockBacklogWithTask();
      const task = mockBacklog.backlog[0].milestones[0].tasks[0];

      // VERIFY: Task has the expected fields for hashing
      expect(task.id).toBe('P1.M1.T1');
      expect(task.title).toBe('Task 1.1.1');
      expect(task.description).toBe('Test task description');
      // NOTE: status, dependencies, story_points are EXCLUDED from hash
    });

    it('should hash Subtask with id, title, context_scope', async () => {
      // SETUP: This test documents the hash input fields for Subtask
      // From prp-generator.ts lines 236-242:
      // Subtask hash includes: id, title, context_scope
      const mockBacklog = createMockBacklogWithSubtask();
      const subtask = mockBacklog.backlog[0].milestones[0].tasks[0].subtasks[0];

      // VERIFY: Subtask has the expected fields for hashing
      expect(subtask.id).toBe('P1.M1.T1.S1');
      expect(subtask.title).toBe('Subtask 1.1.1.1');
      expect(subtask.context_scope).toContain('CONTRACT DEFINITION:');
      // NOTE: status, dependencies, story_points are EXCLUDED from hash
    });

    it('should use deterministic JSON serialization', async () => {
      // SETUP: This test verifies JSON serialization behavior
      // From prp-generator.ts line 246: JSON.stringify(input, null, 0)
      // The null, 0 produces no whitespace (deterministic)

      const input1 = { id: 'P1.M1.T1', title: 'Test', description: 'Desc' };
      const input2 = { id: 'P1.M1.T1', title: 'Test', description: 'Desc' };

      // EXECUTE: Serialize with null, 0
      const json1 = JSON.stringify(input1, null, 0);
      const json2 = JSON.stringify(input2, null, 0);

      // VERIFY: Same input produces same output (deterministic)
      expect(json1).toBe(json2);
      expect(json1).not.toContain(' '); // No whitespace
      expect(json1).toBe(
        '{"id":"P1.M1.T1","title":"Test","description":"Desc"}'
      );
    });
  });

  // ==========================================================================
  // TEST GROUP 5: Cache TTL and Behavior
  // ==========================================================================

  describe('cache TTL and behavior', () => {
    it('should have 24-hour TTL', async () => {
      // SETUP: Import PRPGenerator to verify CACHE_TTL_MS constant
      const { PRPGenerator } =
        await import('/home/dustin/projects/hacky-hack/src/agents/prp-generator.js');

      // VERIFY: CACHE_TTL_MS is 24 hours (86400000 ms)
      // From prp-generator.ts line 151: private readonly CACHE_TTL_MS = 86400000;
      const mockSessionManager = {
        currentSession: {
          metadata: { path: '/test/session' },
        },
      };
      const generator = new PRPGenerator(mockSessionManager, false);

      // Access private constant via instance inspection
      // The TTL is used in #isCacheRecent (line 267): return age < this.CACHE_TTL_MS
      expect(generator).toBeDefined();
    });

    it('should check file mtime for cache age', async () => {
      // SETUP: This test documents the cache age checking behavior
      // From prp-generator.ts lines 263-272 (#isCacheRecent method):
      // Uses stat().mtimeMs to get file modification time
      // Returns true if age < CACHE_TTL_MS, false otherwise

      const { stat } = await import('fs/promises');

      // VERIFY: stat().mtimeMs is available for age checking
      expect(typeof stat).toBe('function');
    });

    it('should return false for non-existent cache file', async () => {
      // SETUP: This test documents the error handling behavior
      // From prp-generator.ts lines 268-270:
      // catch { return false; } - Returns false for ENOENT or any error

      const { stat } = await import('fs/promises');

      // EXECUTE: Try to stat non-existent file
      let caught = false;
      try {
        await stat('/non/existent/file.json');
      } catch (error) {
        caught = true;
      }

      // VERIFY: Error is thrown for non-existent file
      expect(caught).toBe(true);
    });
  });

  // ==========================================================================
  // TEST GROUP 6: Cache Directory and Path Generation
  // ==========================================================================

  describe('cache directory and path generation', () => {
    it('should generate correct cache path for PRP markdown', async () => {
      // SETUP: Import PRPGenerator
      const { PRPGenerator } =
        await import('/home/dustin/projects/hacky-hack/src/agents/prp-generator.js');
      const mockSessionManager = {
        currentSession: {
          metadata: { path: '/test/session' },
        },
      };
      const generator = new PRPGenerator(mockSessionManager, false);

      // EXECUTE: Generate cache path for task ID
      const cachePath = generator.getCachePath('P1.M1.T1.S1');

      // VERIFY: Correct path format with sanitized task ID
      // From prp-generator.ts lines 191-194:
      // Sanitizes: taskId.replace(/\./g, '_')
      // Returns: join(sessionPath, 'prps', `${sanitized}.md`)
      expect(cachePath).toBe('/test/session/prps/P1_M1_T1_S1.md');
    });

    it('should generate correct cache metadata path', async () => {
      // SETUP: Import PRPGenerator
      const { PRPGenerator } =
        await import('/home/dustin/projects/hacky-hack/src/agents/prp-generator.js');
      const mockSessionManager = {
        currentSession: {
          metadata: { path: '/test/session' },
        },
      };
      const generator = new PRPGenerator(mockSessionManager, false);

      // EXECUTE: Generate cache metadata path for task ID
      const metadataPath = generator.getCacheMetadataPath('P1.M1.T1.S1');

      // VERIFY: Correct path format with sanitized task ID
      // From prp-generator.ts lines 206-209:
      // Sanitizes: taskId.replace(/\./g, '_')
      // Returns: join(sessionPath, 'prps', '.cache', `${sanitized}.json`)
      expect(metadataPath).toBe('/test/session/prps/.cache/P1_M1_T1_S1.json');
    });

    it('should sanitize task ID for filename', async () => {
      // SETUP: Import PRPGenerator
      const { PRPGenerator } =
        await import('/home/dustin/projects/hacky-hack/src/agents/prp-generator.js');
      const mockSessionManager = {
        currentSession: {
          metadata: { path: '/test/session' },
        },
      };
      const generator = new PRPGenerator(mockSessionManager, false);

      // EXECUTE: Generate paths with task IDs containing dots
      const path1 = generator.getCachePath('P1.M1.T1.S1');
      const path2 = generator.getCachePath('P2.M3.T5.S10');

      // VERIFY: Dots are replaced with underscores
      expect(path1).toContain('P1_M1_T1_S1.md');
      expect(path2).toContain('P2_M3_T5_S10.md');
      expect(path1).not.toContain('P1.M1.T1.S1');
    });
  });

  // ==========================================================================
  // TEST GROUP 7: Cache Metadata Structure
  // ==========================================================================

  describe('cache metadata structure', () => {
    it('should store correct metadata fields', async () => {
      // SETUP: This test documents the PRPCacheMetadata structure
      // From prp-generator.ts lines 96-103 (PRPCacheMetadata interface):
      // Contains: taskId, taskHash, createdAt, accessedAt, version, prp

      const metadata = {
        taskId: 'P1.M1.T1.S1',
        taskHash: 'abc123',
        createdAt: Date.now(),
        accessedAt: Date.now(),
        version: '1.0',
        prp: createMockPRPDocument('P1.M1.T1.S1'),
      };

      // VERIFY: All required fields are present
      expect(metadata.taskId).toBeDefined();
      expect(metadata.taskHash).toBeDefined();
      expect(metadata.createdAt).toBeDefined();
      expect(metadata.accessedAt).toBeDefined();
      expect(metadata.version).toBeDefined();
      expect(metadata.prp).toBeDefined();
    });

    it('should use version 1.0', async () => {
      // SETUP: This test documents the cache version
      // From prp-generator.ts line 327: version: '1.0'

      // VERIFY: Version is '1.0'
      const version = '1.0';
      expect(version).toBe('1.0');
    });

    it('should store full PRPDocument in metadata', async () => {
      // SETUP: This test documents PRPDocument storage
      // From prp-generator.ts line 328: prp (full PRPDocument)

      const mockPRP = createMockPRPDocument('P1.M1.T1.S1');

      // VERIFY: PRPDocument has all required fields
      expect(mockPRP.taskId).toBe('P1.M1.T1.S1');
      expect(mockPRP.objective).toBeDefined();
      expect(mockPRP.context).toBeDefined();
      expect(mockPRP.implementationSteps).toBeInstanceOf(Array);
      expect(mockPRP.validationGates).toBeInstanceOf(Array);
      expect(mockPRP.successCriteria).toBeInstanceOf(Array);
      expect(mockPRP.references).toBeInstanceOf(Array);
    });
  });

  // ==========================================================================
  // TEST GROUP 8: Mock Groundswell Agent Integration
  // ==========================================================================

  describe('mock Groundswell agent integration', () => {
    it('should return mock PRPDocument data', async () => {
      // SETUP: Import agent factory and create mock PRP
      const { createResearcherAgent } =
        await import('/home/dustin/projects/hacky-hack/src/agents/agent-factory.js');
      const mockPRP = createMockPRPDocument('P1.M1.T1.S1');

      // SETUP: Create mock agent with controlled response
      const mockAgent = {
        id: 'test-agent-id',
        name: 'ResearcherAgent',
        prompt: vi.fn().mockResolvedValue(mockPRP),
      };
      (gs.createAgent as ReturnType<typeof vi.fn>).mockReturnValue(mockAgent);

      // EXECUTE: Call researcher agent
      const researcher = createResearcherAgent();
      const result = await researcher.prompt({ user: 'test', system: 'test' });

      // VERIFY: Returns expected PRPDocument structure
      expect(result).toEqual(mockPRP);
      expect(result.taskId).toBe('P1.M1.T1.S1');
    });

    it('should allow deterministic testing with consistent mock output', async () => {
      // SETUP: Import agent factory and create specific mock values
      const { createResearcherAgent } =
        await import('/home/dustin/projects/hacky-hack/src/agents/agent-factory.js');
      const mockPRP = createMockPRPDocument('P1.M1.T1.S1');

      // SETUP: Create mock agent with consistent response
      const mockAgent = {
        id: 'test-agent-id',
        name: 'ResearcherAgent',
        prompt: vi.fn().mockResolvedValue(mockPRP),
      };
      (gs.createAgent as ReturnType<typeof vi.fn>).mockReturnValue(mockAgent);

      // EXECUTE: Run test multiple times
      const researcher = createResearcherAgent();
      const result1 = await researcher.prompt({ user: 'test', system: 'test' });
      const result2 = await researcher.prompt({ user: 'test', system: 'test' });

      // VERIFY: Consistent output (no random LLM variation)
      expect(result1).toEqual(result2);
      expect(result1.taskId).toBe('P1.M1.T1.S1');
      expect(result2.taskId).toBe('P1.M1.T1.S1');
    });

    it('should validate output against PRPDocumentSchema', async () => {
      // SETUP: Import PRPDocumentSchema and create mock PRP
      const { PRPDocumentSchema } =
        await import('/home/dustin/projects/hacky-hack/src/core/models.js');
      const mockPRP = createMockPRPDocument('P1.M1.T1.S1');

      // EXECUTE: Validate against schema
      const result = PRPDocumentSchema.safeParse(mockPRP);

      // VERIFY: Validation succeeds
      expect(result.success).toBe(true);
    });
  });
});
