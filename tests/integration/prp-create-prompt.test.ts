/**
 * PRP_CREATE_PROMPT Research Process Verification Tests
 *
 * @description
 * Integration tests that verify the PRP_BLUEPRINT_PROMPT (PRP_CREATE_PROMPT) contains
 * all required research process workflow instructions without calling actual LLMs.
 * These tests validate prompt content completeness and ensure critical research
 * workflow instructions are present.
 *
 * @testPath integration/prp-create-prompt
 * @covers PRP_BLUEPRINT_PROMPT research process verification
 * @validation Prompt Content, Research Process Instructions, Subagent Spawning
 *
 * @remarks
 * Unlike researcher-agent.test.ts which validates agent configuration and cache behavior,
 * this test suite focuses specifically on verifying the PRP_CREATE_PROMPT contains
 * all required research workflow instructions:
 * - Codebase Analysis with subagent spawning
 * - Internal Research checking plan/architecture directory
 * - External Research for documentation with URLs
 * - User Clarification for ambiguous requirements
 * - PRP Generation Process steps
 * - TodoWrite tool usage instructions
 *
 * @see {@link ./researcher-agent.test.ts} - Agent configuration and cache tests
 * @see {@link ../../PROMPTS.md} - PRP_CREATE_PROMPT definition (lines 189-639)
 * @see {@link ../../src/agents/prompts.ts} - PRP_BLUEPRINT_PROMPT export
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  beforeAll,
} from 'vitest';

// =============================================================================
// MOCK SETUP: Groundswell (NOT agent-factory)
// =============================================================================
// CRITICAL: Mock Groundswell, NOT agent-factory
// This allows testing the real PRP_BLUEPRINT_PROMPT content
// We mock createAgent() and createPrompt() for consistency with existing patterns
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
// TEST SUITE: PRP_CREATE_PROMPT Research Process Verification
// =============================================================================

describe('integration/prp-create-prompt', () => {
  // Load Groundswell dynamically before all tests
  // NOTE: Variable prefixed with _ as it's not directly used in tests
  // but is required for proper mock setup
  beforeAll(async () => {
    await loadGroundswell();
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
   * - Following pattern from tests/integration/researcher-agent.test.ts
   */
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  // ==========================================================================
  // TEST GROUP 1: Research Process Section Verification
  // ==========================================================================

  describe('PRP_CREATE_PROMPT research process verification', () => {
    it('should contain Research Process section', async () => {
      // SETUP: Import PRP_BLUEPRINT_PROMPT
      const { PRP_BLUEPRINT_PROMPT } =
        await import('/home/dustin/projects/hacky-hack/src/agents/prompts.js');

      // VERIFY: Contains key phrases from Research Process section
      expect(PRP_BLUEPRINT_PROMPT).toContain('Research Process');
      expect(PRP_BLUEPRINT_PROMPT).toContain('Codebase Analysis in depth');
      expect(PRP_BLUEPRINT_PROMPT).toContain('Internal Research at scale');
      expect(PRP_BLUEPRINT_PROMPT).toContain('External Research at scale');
      expect(PRP_BLUEPRINT_PROMPT).toContain('User Clarification');
    });

    it('should instruct to spawn subagents for codebase analysis', async () => {
      // SETUP: Import PRP_BLUEPRINT_PROMPT
      const { PRP_BLUEPRINT_PROMPT } =
        await import('/home/dustin/projects/hacky-hack/src/agents/prompts.js');

      // VERIFY: Contains instructions for subagent spawning
      // GOTCHA: Subagents were made OPTIONAL in the current prompt rewrite —
      // the prompt now references built-in subagents and instructs codebase
      // search via shell/file tools or built-in subagents if available.
      expect(PRP_BLUEPRINT_PROMPT).toContain('Subagents are OPTIONAL');
      expect(PRP_BLUEPRINT_PROMPT).toContain('Search the codebase');
    });

    it('should instruct to check plan/architecture directory', async () => {
      // SETUP: Import PRP_BLUEPRINT_PROMPT
      const { PRP_BLUEPRINT_PROMPT } =
        await import('/home/dustin/projects/hacky-hack/src/agents/prompts.js');

      // VERIFY: Contains architecture directory reference
      // GOTCHA: The PRP_BLUEPRINT_PROMPT uses "plan/architecture" not "$SESSION_DIR/architecture/"
      expect(PRP_BLUEPRINT_PROMPT).toContain('plan/architecture');
    });

    it('should instruct to perform external research', async () => {
      // SETUP: Import PRP_BLUEPRINT_PROMPT
      const { PRP_BLUEPRINT_PROMPT } =
        await import('/home/dustin/projects/hacky-hack/src/agents/prompts.js');

      // VERIFY: Contains external research instructions with documentation URLs
      expect(PRP_BLUEPRINT_PROMPT).toContain('External Research at scale');
      expect(PRP_BLUEPRINT_PROMPT).toContain('Library documentation');
      expect(PRP_BLUEPRINT_PROMPT).toContain('include urls to documentation');
      expect(PRP_BLUEPRINT_PROMPT).toContain('Implementation examples');
    });

    it('should instruct to ask user for clarification', async () => {
      // SETUP: Import PRP_BLUEPRINT_PROMPT
      const { PRP_BLUEPRINT_PROMPT } =
        await import('/home/dustin/projects/hacky-hack/src/agents/prompts.js');

      // VERIFY: Contains user clarification instructions
      expect(PRP_BLUEPRINT_PROMPT).toContain('User Clarification');
      expect(PRP_BLUEPRINT_PROMPT).toContain(
        'Ask for clarification if you need it'
      );
    });
  });

  // ==========================================================================
  // TEST GROUP 2: PRP Generation Process Section Verification
  // ==========================================================================

  describe('PRP Generation Process verification', () => {
    it('should contain all PRP Generation Process steps', async () => {
      // SETUP: Import PRP_BLUEPRINT_PROMPT
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

    it('should instruct to use TodoWrite tool', async () => {
      // SETUP: Import PRP_BLUEPRINT_PROMPT
      const { PRP_BLUEPRINT_PROMPT } =
        await import('/home/dustin/projects/hacky-hack/src/agents/prompts.js');

      // VERIFY: Contains TodoWrite tool instructions
      expect(PRP_BLUEPRINT_PROMPT).toContain('TodoWrite');
      expect(PRP_BLUEPRINT_PROMPT).toContain(
        'create comprehensive PRP writing plan'
      );
    });

    it('should mention Context Completeness Validation', async () => {
      // SETUP: Import PRP_BLUEPRINT_PROMPT
      const { PRP_BLUEPRINT_PROMPT } =
        await import('/home/dustin/projects/hacky-hack/src/agents/prompts.js');

      // VERIFY: Contains "No Prior Knowledge" test for context validation
      expect(PRP_BLUEPRINT_PROMPT).toContain('Context Completeness Validation');
      expect(PRP_BLUEPRINT_PROMPT).toContain('No Prior Knowledge');
      expect(PRP_BLUEPRINT_PROMPT).toContain(
        'would they have everything needed to implement this successfully'
      );
    });
  });

  // ==========================================================================
  // TEST GROUP 3: Codebase Analysis Instructions Verification
  // ==========================================================================

  describe('Codebase Analysis instructions verification', () => {
    it('should instruct to identify necessary files', async () => {
      // SETUP: Import PRP_BLUEPRINT_PROMPT
      const { PRP_BLUEPRINT_PROMPT } =
        await import('/home/dustin/projects/hacky-hack/src/agents/prompts.js');

      // VERIFY: Contains instruction to identify files to reference
      expect(PRP_BLUEPRINT_PROMPT).toContain(
        'Identify all the necessary files'
      );
      expect(PRP_BLUEPRINT_PROMPT).toContain('reference in the PRP');
    });

    it('should instruct to note existing conventions', async () => {
      // SETUP: Import PRP_BLUEPRINT_PROMPT
      const { PRP_BLUEPRINT_PROMPT } =
        await import('/home/dustin/projects/hacky-hack/src/agents/prompts.js');

      // VERIFY: Contains instruction to note conventions to follow
      expect(PRP_BLUEPRINT_PROMPT).toContain('Note all existing conventions');
      expect(PRP_BLUEPRINT_PROMPT).toContain('to follow');
    });

    it('should instruct to check test patterns', async () => {
      // SETUP: Import PRP_BLUEPRINT_PROMPT
      const { PRP_BLUEPRINT_PROMPT } =
        await import('/home/dustin/projects/hacky-hack/src/agents/prompts.js');

      // VERIFY: Contains instruction to check existing test patterns
      expect(PRP_BLUEPRINT_PROMPT).toContain('Check existing test patterns');
      expect(PRP_BLUEPRINT_PROMPT).toContain('validation approach');
    });

    it('should instruct to use batch tools for codebase search', async () => {
      // SETUP: Import PRP_BLUEPRINT_PROMPT
      const { PRP_BLUEPRINT_PROMPT } =
        await import('/home/dustin/projects/hacky-hack/src/agents/prompts.js');

      // VERIFY: Contains instruction to search the codebase (optionally via
      // built-in subagents — the prompt rewrite made subagents OPTIONAL).
      expect(PRP_BLUEPRINT_PROMPT).toContain('built-in subagents');
      expect(PRP_BLUEPRINT_PROMPT).toContain('Search the codebase');
    });
  });

  // ==========================================================================
  // TEST GROUP 4: External Research Instructions Verification
  // ==========================================================================

  describe('External Research instructions verification', () => {
    it('should instruct to spawn subagents for online research', async () => {
      // SETUP: Import PRP_BLUEPRINT_PROMPT
      const { PRP_BLUEPRINT_PROMPT } =
        await import('/home/dustin/projects/hacky-hack/src/agents/prompts.js');

      // VERIFY: Contains instruction for external research with docs/URLs
      // (subagents are now OPTIONAL — research is done by the agent itself
      // or via built-in subagents if available).
      expect(PRP_BLUEPRINT_PROMPT).toContain(
        'Research similar features/patterns online'
      );
      expect(PRP_BLUEPRINT_PROMPT).toContain(
        'include urls to documentation and examples'
      );
    });

    it('should instruct to include URLs to documentation', async () => {
      // SETUP: Import PRP_BLUEPRINT_PROMPT
      const { PRP_BLUEPRINT_PROMPT } =
        await import('/home/dustin/projects/hacky-hack/src/agents/prompts.js');

      // VERIFY: Contains instruction to include documentation URLs
      expect(PRP_BLUEPRINT_PROMPT).toContain('include urls to documentation');
    });

    it('should instruct to store research in work item research directory', async () => {
      // SETUP: Import PRP_BLUEPRINT_PROMPT
      const { PRP_BLUEPRINT_PROMPT } =
        await import('/home/dustin/projects/hacky-hack/src/agents/prompts.js');

      // VERIFY: Contains instruction to store research
      // GOTCHA: the current prompt added the word "notes" — "Store all research
      // notes in the work item's research/ subdirectory".
      expect(PRP_BLUEPRINT_PROMPT).toContain(
        "Store all research notes in the work item's research/ subdirectory"
      );
    });

    it('should instruct to reference critical documentation in PRP', async () => {
      // SETUP: Import PRP_BLUEPRINT_PROMPT
      const { PRP_BLUEPRINT_PROMPT } =
        await import('/home/dustin/projects/hacky-hack/src/agents/prompts.js');

      // VERIFY: Contains instruction to reference docs in PRP
      // GOTCHA: The prompt splits "reasoning and instructions" across lines
      expect(PRP_BLUEPRINT_PROMPT).toContain(
        'reference critical pieces of documentation in the PRP'
      );
      expect(PRP_BLUEPRINT_PROMPT).toContain('reasoning and instructions');
    });

    it('should instruct to find implementation examples', async () => {
      // SETUP: Import PRP_BLUEPRINT_PROMPT
      const { PRP_BLUEPRINT_PROMPT } =
        await import('/home/dustin/projects/hacky-hack/src/agents/prompts.js');

      // VERIFY: Contains instruction to find implementation examples
      expect(PRP_BLUEPRINT_PROMPT).toContain('Implementation examples');
      expect(PRP_BLUEPRINT_PROMPT).toContain('GitHub/StackOverflow/blogs');
    });
  });

  // ==========================================================================
  // TEST GROUP 5: User Clarification Instructions Verification
  // ==========================================================================

  describe('User Clarification instructions verification', () => {
    it('should instruct to ask for clarification when needed', async () => {
      // SETUP: Import PRP_BLUEPRINT_PROMPT
      const { PRP_BLUEPRINT_PROMPT } =
        await import('/home/dustin/projects/hacky-hack/src/agents/prompts.js');

      // VERIFY: Contains instruction to ask for clarification
      expect(PRP_BLUEPRINT_PROMPT).toContain(
        'Ask for clarification if you need it'
      );
    });

    it('should instruct to ask about testing framework if none found', async () => {
      // SETUP: Import PRP_BLUEPRINT_PROMPT
      const { PRP_BLUEPRINT_PROMPT } =
        await import('/home/dustin/projects/hacky-hack/src/agents/prompts.js');

      // VERIFY: Contains instruction to ask about testing framework
      expect(PRP_BLUEPRINT_PROMPT).toContain(
        'If no testing framework is found'
      );
      expect(PRP_BLUEPRINT_PROMPT).toContain(
        'ask the user if they would like to set one up'
      );
    });

    it('should instruct to halt on fundamental misalignment', async () => {
      // SETUP: Import PRP_BLUEPRINT_PROMPT
      const { PRP_BLUEPRINT_PROMPT } =
        await import('/home/dustin/projects/hacky-hack/src/agents/prompts.js');

      // VERIFY: Contains instruction to halt on misalignment
      // GOTCHA: The prompt has a typo "misalignemnt" (missing 'i')
      expect(PRP_BLUEPRINT_PROMPT).toContain(
        'fundamental misalignemnt of objectives'
      );
      expect(PRP_BLUEPRINT_PROMPT).toContain(
        'halt and produce a thorough explanation'
      );
      expect(PRP_BLUEPRINT_PROMPT).toContain('at a 10th grade level');
    });
  });

  // ==========================================================================
  // TEST GROUP 6: PRP Quality Gates Verification
  // ==========================================================================

  describe('PRP Quality Gates verification', () => {
    it('should contain Context Completeness Check section', async () => {
      // SETUP: Import PRP_BLUEPRINT_PROMPT
      const { PRP_BLUEPRINT_PROMPT } =
        await import('/home/dustin/projects/hacky-hack/src/agents/prompts.js');

      // VERIFY: Contains quality gate for context completeness
      expect(PRP_BLUEPRINT_PROMPT).toContain('## PRP Quality Gates');
      expect(PRP_BLUEPRINT_PROMPT).toContain('### Context Completeness Check');
    });

    it('should contain Template Structure Compliance section', async () => {
      // SETUP: Import PRP_BLUEPRINT_PROMPT
      const { PRP_BLUEPRINT_PROMPT } =
        await import('/home/dustin/projects/hacky-hack/src/agents/prompts.js');

      // VERIFY: Contains quality gate for template compliance
      expect(PRP_BLUEPRINT_PROMPT).toContain(
        '### Template Structure Compliance'
      );
    });

    it('should contain Information Density Standards section', async () => {
      // SETUP: Import PRP_BLUEPRINT_PROMPT
      const { PRP_BLUEPRINT_PROMPT } =
        await import('/home/dustin/projects/hacky-hack/src/agents/prompts.js');

      // VERIFY: Contains quality gate for information density
      expect(PRP_BLUEPRINT_PROMPT).toContain(
        '### Information Density Standards'
      );
    });

    it('should contain Success Metrics section', async () => {
      // SETUP: Import PRP_BLUEPRINT_PROMPT
      const { PRP_BLUEPRINT_PROMPT } =
        await import('/home/dustin/projects/hacky-hack/src/agents/prompts.js');

      // VERIFY: Contains success metrics section
      expect(PRP_BLUEPRINT_PROMPT).toContain('## Success Metrics');
      expect(PRP_BLUEPRINT_PROMPT).toContain('Confidence Score');
    });
  });

  // ==========================================================================
  // TEST GROUP 7: Information Density Standards Verification
  // ==========================================================================

  describe('Information Density Standards verification', () => {
    it('should require URLs with section anchors', async () => {
      // SETUP: Import PRP_BLUEPRINT_PROMPT
      const { PRP_BLUEPRINT_PROMPT } =
        await import('/home/dustin/projects/hacky-hack/src/agents/prompts.js');

      // VERIFY: Contains instruction for specific URLs
      expect(PRP_BLUEPRINT_PROMPT).toContain('URLs include section anchors');
      expect(PRP_BLUEPRINT_PROMPT).toContain('not just domain names');
    });

    it('should require specific file references', async () => {
      // SETUP: Import PRP_BLUEPRINT_PROMPT
      const { PRP_BLUEPRINT_PROMPT } =
        await import('/home/dustin/projects/hacky-hack/src/agents/prompts.js');

      // VERIFY: Contains instruction for specific file patterns
      expect(PRP_BLUEPRINT_PROMPT).toContain(
        'File references include specific patterns'
      );
      expect(PRP_BLUEPRINT_PROMPT).toContain('not generic mentions');
    });

    it('should require exact naming in task specifications', async () => {
      // SETUP: Import PRP_BLUEPRINT_PROMPT
      const { PRP_BLUEPRINT_PROMPT } =
        await import('/home/dustin/projects/hacky-hack/src/agents/prompts.js');

      // VERIFY: Contains instruction for exact naming
      expect(PRP_BLUEPRINT_PROMPT).toContain(
        'Task specifications include exact naming conventions'
      );
    });

    it('should require project-specific validation commands', async () => {
      // SETUP: Import PRP_BLUEPRINT_PROMPT
      const { PRP_BLUEPRINT_PROMPT } =
        await import('/home/dustin/projects/hacky-hack/src/agents/prompts.js');

      // VERIFY: Contains instruction for specific validation commands
      expect(PRP_BLUEPRINT_PROMPT).toContain(
        'Validation commands are project-specific'
      );
      expect(PRP_BLUEPRINT_PROMPT).toContain('and executable');
    });
  });

  // ==========================================================================
  // TEST GROUP 8: Research Integration Instructions Verification
  // ==========================================================================

  describe('Research Integration instructions verification', () => {
    it('should instruct to transform research into Goal section', async () => {
      // SETUP: Import PRP_BLUEPRINT_PROMPT
      const { PRP_BLUEPRINT_PROMPT } =
        await import('/home/dustin/projects/hacky-hack/src/agents/prompts.js');

      // VERIFY: Contains instruction for Goal section
      expect(PRP_BLUEPRINT_PROMPT).toContain(
        '**Goal Section**: Use research to define specific, measurable Feature Goal'
      );
      expect(PRP_BLUEPRINT_PROMPT).toContain('concrete Deliverable');
    });

    it('should instruct to populate Context section with findings', async () => {
      // SETUP: Import PRP_BLUEPRINT_PROMPT
      const { PRP_BLUEPRINT_PROMPT } =
        await import('/home/dustin/projects/hacky-hack/src/agents/prompts.js');

      // VERIFY: Contains instruction for Context section
      expect(PRP_BLUEPRINT_PROMPT).toContain(
        '**Context Section**: Populate YAML structure with your research findings'
      );
      expect(PRP_BLUEPRINT_PROMPT).toContain(
        'specific URLs, file patterns, gotchas'
      );
    });

    it('should instruct to create implementation tasks from research', async () => {
      // SETUP: Import PRP_BLUEPRINT_PROMPT
      const { PRP_BLUEPRINT_PROMPT } =
        await import('/home/dustin/projects/hacky-hack/src/agents/prompts.js');

      // VERIFY: Contains instruction for Implementation Tasks
      expect(PRP_BLUEPRINT_PROMPT).toContain(
        '**Implementation Tasks**: Create dependency-ordered tasks'
      );
      expect(PRP_BLUEPRINT_PROMPT).toContain('information-dense keywords');
    });
  });
});
