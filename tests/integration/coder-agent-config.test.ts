/**
 * Integration tests for Coder Agent configuration (createCoderAgent config assertions)
 *
 * @remarks
 * This file was SPLIT OUT of `coder-agent.test.ts` (Bugfix 002 / BUG-004, Category (b)
 * test-rot). The original file declares a module-level
 * `vi.mock('../../src/agents/agent-factory.js')` to control the Coder Agent inside the PRP
 * executor suites. Because `vi.mock()` is ALWAYS hoisted to the file top by vitest (regardless
 * of where it is written), that mock also replaced `createCoderAgent` for the
 * `createCoderAgent configuration` suite — silently neutralizing it (the real factory never ran,
 * so `gs.createAgent` was never called and all 7 assertions failed). The robust, minimal fix is
 * to move this suite into its own file with NO agent-factory mock, so the dynamic import yields
 * the REAL factory and the mocked `gs.createAgent` is the correct capture boundary.
 *
 * No `src/` change is involved (rule 5: test-only corrective).
 *
 * @see {@link ../../src/agents/agent-factory.ts | agent-factory.ts} - createCoderAgent
 */

import {
  afterEach,
  beforeEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

// =============================================================================
// MOCK SETUP - Must be at top level for hoisting
// =============================================================================

/**
 * Helper function to create a mock AgentResponse
 *
 * @remarks
 * Mirrors the helper in `coder-agent.test.ts` so this file stays self-contained
 * (repo convention: each file keeps its own top-level mocks + helpers).
 *
 * @param data - The response data
 * @returns A success AgentResponse<string>
 */
function createMockAgentResponse(data: string): {
  status: 'success';
  data: string;
  error: null;
  metadata: {
    agentId: string;
    timestamp: number;
  };
} {
  return {
    status: 'success',
    data,
    error: null,
    metadata: {
      agentId: 'mock-agent-id',
      timestamp: Date.now(),
    },
  };
}

/**
 * Mock Groundswell for agent configuration tests
 *
 * @remarks
 * Must be at top level before any imports that use groundswell. Only the groundswell
 * boundary is mocked here (NOT agent-factory) — the real `createCoderAgent` runs and
 * hands its built config to the mocked `gs.createAgent`, which is the capture boundary
 * for these assertions.
 */
vi.mock('groundswell', async () => {
  const actual = await vi.importActual('groundswell');
  return {
    ...actual,
    createAgent: vi.fn().mockReturnValue({
      id: 'mock-agent-id',
      name: 'MockAgent',
      prompt: vi.fn(),
    }),
    createPrompt: vi.fn(),
  };
});

// =============================================================================
// IMPORTS - After mocks are established
// =============================================================================

import { PRP_BUILDER_PROMPT } from '../../src/agents/prompts.js';

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Dynamic import ensures mocks are applied before Groundswell loads
 */
async function loadGroundswell() {
  return await import('groundswell');
}

// =============================================================================
// TEST SUITE: Coder Agent Configuration
// =============================================================================

describe('integration/coder-agent > createCoderAgent configuration', () => {
  let gs: Awaited<ReturnType<typeof loadGroundswell>>;

  beforeAll(async () => {
    gs = await loadGroundswell();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('should create coder agent with zai/glm-5-turbo model', async () => {
    // SETUP: Import real agent-factory after mocks established
    const { createCoderAgent } =
      await import('../../src/agents/agent-factory.js');

    // EXECUTE: Create coder agent
    createCoderAgent();

    // VERIFY: createAgent called with the provider-qualified fast-tier model.
    // Chain: createBaseConfig('coder','implementation') -> getModel('fast') ->
    //        qualifyModel('glm-5-turbo', 'zai') -> 'zai/glm-5-turbo'
    expect(gs.createAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'zai/glm-5-turbo',
      })
    );
  });

  it('should create coder agent with 4096 max tokens', async () => {
    // SETUP: Import real agent-factory
    const { createCoderAgent } =
      await import('../../src/agents/agent-factory.js');

    // EXECUTE: Create coder agent
    createCoderAgent();

    // VERIFY: createAgent called with maxTokens: 4096
    expect(gs.createAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        maxTokens: 4096,
      })
    );
  });

  it('should create coder agent with cache enabled', async () => {
    // SETUP: Import real agent-factory
    const { createCoderAgent } =
      await import('../../src/agents/agent-factory.js');

    // EXECUTE: Create coder agent
    createCoderAgent();

    // VERIFY: createAgent called with enableCache: true
    expect(gs.createAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        enableCache: true,
      })
    );
  });

  it('should create coder agent with reflection enabled', async () => {
    // SETUP: Import real agent-factory
    const { createCoderAgent } =
      await import('../../src/agents/agent-factory.js');

    // EXECUTE: Create coder agent
    createCoderAgent();

    // VERIFY: createAgent called with enableReflection: true
    expect(gs.createAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        enableReflection: true,
      })
    );
  });

  it('should create coder agent with MCP tools', async () => {
    // SETUP: Import real agent-factory and MCP_TOOLS
    const agentFactory = await import('../../src/agents/agent-factory.js');

    // EXECUTE: Create coder agent
    agentFactory.createCoderAgent();

    // VERIFY: createAgent called with mcps containing 3 tools
    expect(gs.createAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        mcps: expect.any(Array),
      })
    );

    const callArgs = (gs.createAgent as any).mock.calls[0][0];
    expect(callArgs.mcps).toHaveLength(3);
  });

  it('should use PRP_BUILDER_PROMPT as system prompt', async () => {
    // SETUP: Import real agent-factory
    const { createCoderAgent } =
      await import('../../src/agents/agent-factory.js');

    // EXECUTE: Create coder agent
    createCoderAgent();

    // VERIFY: createAgent called with system: PRP_BUILDER_PROMPT
    expect(gs.createAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        system: PRP_BUILDER_PROMPT,
      })
    );
  });

  it('should name agent CoderAgent', async () => {
    // SETUP: Import real agent-factory
    const { createCoderAgent } =
      await import('../../src/agents/agent-factory.js');

    // EXECUTE: Create coder agent
    createCoderAgent();

    // VERIFY: createAgent called with name: 'CoderAgent'
    expect(gs.createAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'CoderAgent',
      })
    );
  });
});

// Keep the helper referenced so tree-shaking/lint doesn't drop a documented export;
// createMockAgentResponse mirrors coder-agent.test.ts and documents the AgentResponse shape.
void createMockAgentResponse;
