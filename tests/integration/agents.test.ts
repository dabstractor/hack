/**
 * Integration tests for agent factory and prompt generators
 *
 * @remarks
 * Tests validate the complete flow: agent factory → Groundswell agents → Prompt generators
 * Mocks Groundswell dependencies to prevent real LLM calls and MCP server registration issues.
 *
 * Test coverage goals:
 * - 100% coverage for src/agents/agent-factory.ts
 * - Validates system prompt assignments for all agent types
 * - Validates Prompt<T> typing and Zod schema associations for all prompt generators
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

// =============================================================================
// MOCK PATTERN: Groundswell createAgent and createPrompt
// =============================================================================

// Pattern: Mock at top level before imports (hoisting required by vi.mock)
// Use importOriginal to preserve MCPHandler and other exports needed by MCP tools
vi.mock('groundswell', async () => {
  const actual = await vi.importActual('groundswell');
  return {
    ...actual,
    createAgent: vi.fn(),
    createPrompt: vi.fn(),
  };
});

// Import after mocking - get mocked versions
import { createAgent, createPrompt } from 'groundswell';

// Import agent factory functions and system prompts
import {
  createBaseConfig,
  createArchitectAgent,
  createResearcherAgent,
  createCoderAgent,
  createQAAgent,
} from '../../src/agents/agent-factory.js';
import {
  TASK_BREAKDOWN_PROMPT,
  PRP_BLUEPRINT_PROMPT,
  PRP_BUILDER_PROMPT,
  BUG_HUNT_PROMPT,
  DELTA_ANALYSIS_PROMPT,
} from '../../src/agents/prompts.js';

// Import prompt generator functions
import { createArchitectPrompt } from '../../src/agents/prompts/architect-prompt.js';
import { createPRPBlueprintPrompt } from '../../src/agents/prompts/prp-blueprint-prompt.js';
import { createBugHuntPrompt } from '../../src/agents/prompts/bug-hunt-prompt.js';
import { createDeltaAnalysisPrompt } from '../../src/agents/prompts/delta-analysis-prompt.js';

// Import types and schemas for validation
import type {
  Backlog,
  PRPDocument,
  TestResults,
  DeltaAnalysis,
} from '../../src/core/models.js';
import type { Task, Subtask } from '../../src/core/models.js';
import {
  BacklogSchema,
  PRPDocumentSchema,
  TestResultsSchema,
  DeltaAnalysisSchema,
} from '../../src/core/models.js';

// =============================================================================
// MOCK FIXTURES: Reusable test data
// =============================================================================

// Mock Agent with prompt method (pattern from architect-agent.test.ts)
const mockAgent = {
  prompt: vi.fn(),
};

// Mock Prompt object (Groundswell Prompt<T> type)
const mockPrompt = {
  user: '',
  system: '',
  responseFormat: BacklogSchema,
  enableReflection: true,
};

// Setup createAgent to return mock agent
vi.mocked(createAgent).mockReturnValue(mockAgent as never);

// Setup createPrompt to return mock prompt
vi.mocked(createPrompt).mockReturnValue(mockPrompt as never);

// Test fixture: Sample PRD content
const mockPRDContent =
  '# Test PRD\n\nThis is a test PRD for integration testing.';

// Test fixture: Sample Subtask
const mockSubtask: Subtask = {
  id: 'P1.M1.T1.S1',
  type: 'Subtask',
  title: 'Test Subtask',
  status: 'Planned',
  story_points: 2,
  dependencies: [],
  context_scope: 'Test context scope for implementation',
};

// Test fixture: Sample Task
const mockTask: Task = {
  id: 'P1.M1.T1',
  type: 'Task',
  title: 'Test Task',
  status: 'Planned',
  description: 'Test task description',
  subtasks: [mockSubtask],
};

// Test fixture: Sample Backlog
const mockBacklog: Backlog = {
  backlog: [
    {
      id: 'P1',
      type: 'Phase',
      title: 'Test Phase',
      status: 'Planned',
      description: 'Test description',
      milestones: [
        {
          id: 'P1.M1',
          type: 'Milestone',
          title: 'Test Milestone',
          status: 'Planned',
          description: 'Test',
          tasks: [mockTask],
        },
      ],
    },
  ],
};

// =============================================================================
// TEST SUITE: createBaseConfig() Environment Variable Mapping
// =============================================================================

describe('createBaseConfig', () => {
  // CLEANUP: Restore environment after each test
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('provider-aware API key resolution (PRD §9.2.6)', () => {
    // Each case mirrors the unit-level matrix in tests/unit/config/auth-resolver.test.ts.
    // createBaseConfig() forwards resolveApiKeyForProvider(getResolvedProvider()) ?? ''
    // as config.env.ANTHROPIC_API_KEY (the field the Groundswell SDK reads).

    it('(a) DEFAULT zai provider — resolves ZAI_API_KEY and forwards it as the SDK key', () => {
      // SETUP: default zai provider (no sonnet override), no PRP_API_KEY override
      delete process.env.ANTHROPIC_DEFAULT_SONNET_MODEL;
      delete process.env.PRP_API_KEY;
      vi.stubEnv('ZAI_API_KEY', 'zai-test-key');

      // EXECUTE
      const config = createBaseConfig('architect');

      // VERIFY: the zai-native env var is resolved and forwarded
      expect(config.env.ANTHROPIC_API_KEY).toBe('zai-test-key');
    });

    it('(b) anthropic provider override — honors ANTHROPIC_API_KEY', () => {
      // SETUP: switch provider to anthropic via a qualified sonnet override
      vi.stubEnv('ANTHROPIC_DEFAULT_SONNET_MODEL', 'anthropic/claude-sonnet-4');
      vi.stubEnv('ANTHROPIC_API_KEY', 'anthropic-test-key');
      delete process.env.ANTHROPIC_OAUTH_TOKEN; // OAUTH has precedence; clear so API_KEY wins
      delete process.env.PRP_API_KEY;

      // EXECUTE
      const config = createBaseConfig('architect');

      // VERIFY: ANTHROPIC_API_KEY IS honored for the anthropic provider
      expect(config.env.ANTHROPIC_API_KEY).toBe('anthropic-test-key');
    });

    it('(c) no credential configured — honest empty-string default', () => {
      // SETUP: default zai provider, nothing configured anywhere
      delete process.env.ANTHROPIC_DEFAULT_SONNET_MODEL;
      delete process.env.PRP_API_KEY;
      delete process.env.ZAI_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_OAUTH_TOKEN;

      // EXECUTE
      const config = createBaseConfig('architect');

      // VERIFY: terminal ?? '' — genuinely unconfigured, not a fake key
      expect(config.env.ANTHROPIC_API_KEY).toBe('');
    });
  });

  it('should include all required AgentConfig properties', () => {
    // SETUP
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-token');
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://api.z.ai/api/anthropic');

    // EXECUTE
    const config = createBaseConfig('architect');

    // VERIFY: All required properties exist
    expect(config).toHaveProperty('name');
    expect(config).toHaveProperty('system');
    expect(config).toHaveProperty('model');
    expect(config).toHaveProperty('enableCache');
    expect(config).toHaveProperty('enableReflection');
    expect(config).toHaveProperty('maxTokens');
    expect(config).toHaveProperty('env');
  });

  it('should set persona-specific token limits', () => {
    // SETUP
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-token');
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://api.z.ai/api/anthropic');

    // EXECUTE & VERIFY: Architect gets 8192 tokens
    expect(createBaseConfig('architect').maxTokens).toBe(8192);

    // EXECUTE & VERIFY: Other personas get 4096 tokens
    expect(createBaseConfig('researcher').maxTokens).toBe(4096);
    expect(createBaseConfig('coder').maxTokens).toBe(4096);
    expect(createBaseConfig('qa').maxTokens).toBe(4096);
  });

  it('should generate correct agent names from personas', () => {
    // SETUP
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-token');
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://api.z.ai/api/anthropic');

    // EXECUTE & VERIFY: Agent names follow Persona → PersonaAgent pattern
    expect(createBaseConfig('architect').name).toBe('ArchitectAgent');
    expect(createBaseConfig('researcher').name).toBe('ResearcherAgent');
    expect(createBaseConfig('coder').name).toBe('CoderAgent');
    expect(createBaseConfig('qa').name).toBe('QaAgent');
  });
});

// =============================================================================
// TEST SUITE: Agent Creators Use Correct System Prompts
// =============================================================================

describe('createArchitectAgent', () => {
  // CLEANUP: Clear mock calls after each test
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should create architect agent with TASK_BREAKDOWN_PROMPT', () => {
    // SETUP: Stub environment variables
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-token');
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://api.z.ai/api/anthropic');

    // EXECUTE
    const agent = createArchitectAgent();

    // VERIFY: createAgent was called with correct config
    expect(createAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'ArchitectAgent',
        system: TASK_BREAKDOWN_PROMPT,
        maxTokens: 8192,
        model: 'zai/glm-5.2',
        enableCache: true,
        enableReflection: true,
      })
    );

    // VERIFY: Agent has prompt method
    expect(agent.prompt).toBeDefined();
  });

  it('should include MCP tools in architect agent config', () => {
    // SETUP
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-token');
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://api.z.ai/api/anthropic');

    // EXECUTE
    createArchitectAgent();

    // VERIFY: mcps parameter was passed
    expect(createAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        mcps: expect.any(Array),
      })
    );
  });
});

describe('createResearcherAgent', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should create researcher agent with PRP_BLUEPRINT_PROMPT', () => {
    // SETUP
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-token');
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://api.z.ai/api/anthropic');

    // EXECUTE
    const agent = createResearcherAgent();

    // VERIFY: createAgent was called with correct config
    expect(createAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'ResearcherAgent',
        system: PRP_BLUEPRINT_PROMPT,
        maxTokens: 4096,
        model: 'zai/glm-5.2',
        enableCache: true,
        enableReflection: true,
      })
    );

    // VERIFY: Agent has prompt method
    expect(agent.prompt).toBeDefined();
  });

  it('should include MCP tools in researcher agent config', () => {
    // SETUP
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-token');
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://api.z.ai/api/anthropic');

    // EXECUTE
    createResearcherAgent();

    // VERIFY: mcps parameter was passed
    expect(createAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        mcps: expect.any(Array),
      })
    );
  });
});

describe('createCoderAgent', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should create coder agent with PRP_BUILDER_PROMPT', () => {
    // SETUP
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-token');
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://api.z.ai/api/anthropic');

    // EXECUTE
    const agent = createCoderAgent();

    // VERIFY: createAgent was called with correct config
    expect(createAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'CoderAgent',
        system: PRP_BUILDER_PROMPT,
        maxTokens: 4096,
        model: 'zai/glm-5.2',
        enableCache: true,
        enableReflection: true,
      })
    );

    // VERIFY: Agent has prompt method
    expect(agent.prompt).toBeDefined();
  });

  it('should include MCP tools in coder agent config', () => {
    // SETUP
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-token');
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://api.z.ai/api/anthropic');

    // EXECUTE
    createCoderAgent();

    // VERIFY: mcps parameter was passed
    expect(createAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        mcps: expect.any(Array),
      })
    );
  });
});

describe('createQAAgent', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should create QA agent with BUG_HUNT_PROMPT', () => {
    // SETUP
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-token');
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://api.z.ai/api/anthropic');

    // EXECUTE
    const agent = createQAAgent();

    // VERIFY: createAgent was called with correct config
    expect(createAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'QaAgent',
        system: BUG_HUNT_PROMPT,
        maxTokens: 4096,
        model: 'zai/glm-5.2',
        enableCache: true,
        enableReflection: true,
      })
    );

    // VERIFY: Agent has prompt method
    expect(agent.prompt).toBeDefined();
  });

  it('should include MCP tools in QA agent config', () => {
    // SETUP
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-token');
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://api.z.ai/api/anthropic');

    // EXECUTE
    createQAAgent();

    // VERIFY: mcps parameter was passed
    expect(createAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        mcps: expect.any(Array),
      })
    );
  });
});

// =============================================================================
// TEST SUITE: Prompt Generators Return Correct Prompt<T> Types
// =============================================================================

describe('createArchitectPrompt', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should create architect prompt with BacklogSchema', () => {
    // SETUP
    const prdContent = '# Test PRD\n\nThis is a test.';

    // EXECUTE
    const prompt = createArchitectPrompt(prdContent);

    // VERIFY: createPrompt was called with correct config
    expect(createPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        user: prdContent,
        system: TASK_BREAKDOWN_PROMPT,
        responseFormat: BacklogSchema,
        enableReflection: true,
      })
    );

    // NOTE: TypeScript generic type Prompt<Backlog> is compile-time only
    // Runtime tests validate createPrompt was called with correct schema
  });
});

describe('createPRPBlueprintPrompt', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should create PRP blueprint prompt with PRPDocumentSchema', () => {
    // SETUP: Create test task and backlog
    const task: Subtask = {
      id: 'P1.M1.T1.S1',
      type: 'Subtask',
      title: 'Test Subtask',
      status: 'Planned',
      story_points: 2,
      dependencies: [],
      context_scope: 'Test context scope',
    };

    const backlog: Backlog = {
      backlog: [
        {
          id: 'P1',
          type: 'Phase',
          title: 'Test Phase',
          status: 'Planned',
          description: 'Test description',
          milestones: [
            {
              id: 'P1.M1',
              type: 'Milestone',
              title: 'Test Milestone',
              status: 'Planned',
              description: 'Test',
              tasks: [
                {
                  id: 'P1.M1.T1',
                  type: 'Task',
                  title: 'Test Task',
                  status: 'Planned',
                  description: 'Test',
                  subtasks: [task],
                },
              ],
            },
          ],
        },
      ],
    };

    // EXECUTE
    const prompt = createPRPBlueprintPrompt(task, backlog, '/test/path');

    // VERIFY: createPrompt was called with correct config
    expect(createPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        user: expect.stringContaining(task.title),
        system: PRP_BLUEPRINT_PROMPT,
        responseFormat: PRPDocumentSchema,
        enableReflection: true,
      })
    );
  });

  it('should include codebase path in user prompt when provided', () => {
    // SETUP
    const codebasePath = '/home/dustin/projects/hacky-hack';
    const prompt = createPRPBlueprintPrompt(
      mockSubtask,
      mockBacklog,
      codebasePath
    );

    // VERIFY: User prompt contains codebase path
    expect(createPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        user: expect.stringContaining(codebasePath),
      })
    );
  });
});

describe('createBugHuntPrompt', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should create bug hunt prompt with TestResultsSchema', () => {
    // SETUP
    const prd = '# Test PRD';
    const completedTasks: Task[] = [
      {
        id: 'P1.M1.T1',
        type: 'Task',
        title: 'Test Task',
        status: 'Complete',
        description: 'Test',
        subtasks: [],
      },
    ];

    // EXECUTE
    const prompt = createBugHuntPrompt(prd, completedTasks);

    // VERIFY: createPrompt was called with correct config
    expect(createPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        user: expect.stringContaining(prd),
        system: BUG_HUNT_PROMPT,
        responseFormat: TestResultsSchema,
        enableReflection: true,
      })
    );
  });

  it('should include completed tasks in user prompt', () => {
    // SETUP
    const prd = '# Test PRD';
    const completedTasks: Task[] = [
      {
        id: 'P1.M1.T1',
        type: 'Task',
        title: 'Completed Task 1',
        status: 'Complete',
        description: 'First completed task',
        subtasks: [],
      },
      {
        id: 'P1.M1.T2',
        type: 'Task',
        title: 'Completed Task 2',
        status: 'Complete',
        description: 'Second completed task',
        subtasks: [],
      },
    ];

    // EXECUTE
    const prompt = createBugHuntPrompt(prd, completedTasks);

    // VERIFY: User prompt contains completed task IDs
    expect(createPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        user: expect.stringContaining('P1.M1.T1'),
      })
    );

    expect(createPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        user: expect.stringContaining('P1.M1.T2'),
      })
    );
  });
});

describe('createDeltaAnalysisPrompt', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should create delta analysis prompt with DeltaAnalysisSchema', () => {
    // SETUP
    const oldPRD = '# Old PRD';
    const newPRD = '# New PRD';
    const completedTaskIds = ['P1.M1.T1', 'P1.M1.T2'];

    // EXECUTE
    const prompt = createDeltaAnalysisPrompt(oldPRD, newPRD, completedTaskIds);

    // VERIFY: createPrompt was called with correct config
    expect(createPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        user: expect.stringContaining(oldPRD),
        system: DELTA_ANALYSIS_PROMPT,
        responseFormat: DeltaAnalysisSchema,
        enableReflection: true,
      })
    );
  });

  it('should include completed task IDs when provided', () => {
    // SETUP
    const oldPRD = '# Old PRD';
    const newPRD = '# New PRD';
    const completedTaskIds = ['P1.M1.T1', 'P1.M2.T3'];

    // EXECUTE
    const prompt = createDeltaAnalysisPrompt(oldPRD, newPRD, completedTaskIds);

    // VERIFY: User prompt contains completed task IDs section
    expect(createPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        user: expect.stringContaining('P1.M1.T1'),
      })
    );
  });

  it('should work without completed task IDs', () => {
    // SETUP
    const oldPRD = '# Old PRD';
    const newPRD = '# New PRD';

    // EXECUTE - no completed task IDs provided
    const prompt = createDeltaAnalysisPrompt(oldPRD, newPRD);

    // VERIFY: Should still call createPrompt correctly
    expect(createPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        user: expect.stringContaining(oldPRD),
        system: DELTA_ANALYSIS_PROMPT,
        responseFormat: DeltaAnalysisSchema,
        enableReflection: true,
      })
    );
  });
});

// =============================================================================
// TEST SUITE: MCP Tools Integration
// =============================================================================

describe('MCP tools integration', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should pass MCP tools to all agent creators', () => {
    // SETUP: Stub environment variables
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-token');
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://api.z.ai/api/anthropic');

    // EXECUTE: Create all agent types
    createArchitectAgent();
    createResearcherAgent();
    createCoderAgent();
    createQAAgent();

    // VERIFY: All agents were created with mcps parameter
    expect(createAgent).toHaveBeenCalledTimes(4);

    // Check each call had mcps parameter
    vi.mocked(createAgent).mock.calls.forEach(call => {
      const config = call[0];
      expect(config).toHaveProperty('mcps');
      expect(Array.isArray(config.mcps)).toBe(true);
    });
  });
});
