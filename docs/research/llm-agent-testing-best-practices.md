# LLM Agent Testing Best Practices

**Research Document:** Integration Testing Patterns for Architect Agent

**Date:** 2026-01-19

**Purpose:** Provide comprehensive guidance on testing LLM agents and integration testing patterns for creating PRP (Product Requirement Prompt) for Architect Agent integration testing.

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Vitest Integration Testing Best Practices](#vitest-integration-testing-best-practices)
3. [Mocking Patterns for External API Calls](#mocking-patterns-for-external-api-calls)
4. [Testing LLM Agent Integration](#testing-llm-agent-integration)
5. [Prompt Validation Testing Strategies](#prompt-validation-testing-strategies)
6. [Zod Schema Validation Testing](#zod-schema-validation-testing)
7. [Agent Configuration Verification](#agent-configuration-verification)
8. [Integration Test File Organization](#integration-test-file-organization)
9. [Test Fixtures and Data Management](#test-fixtures-and-data-management)
10. [Best Practices Summary](#best-practices-summary)

---

## Executive Summary

This document compiles industry best practices and proven patterns for testing LLM agents, with specific focus on:

- **Vitest integration testing**: Setup, configuration, and organization patterns
- **External API mocking**: Strategies for mocking LLM providers (Claude, OpenAI, etc.)
- **Prompt validation**: Testing prompt structure, content, and behavior
- **Schema validation**: Zod schema testing for LLM outputs
- **Agent configuration**: Verifying agent setup and tool integration

**Key Finding:** The codebase already demonstrates excellent testing patterns with 100% coverage requirements, comprehensive mock setup in `/home/dustin/projects/hacky-hack/tests/setup.ts`, and well-organized test structure.

---

## Vitest Integration Testing Best Practices

### Test Environment Configuration

**File:** `/home/dustin/projects/hacky-hack/vitest.config.ts`

```typescript
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.{test,spec}.ts'],
    exclude: ['**/dist/**', '**/node_modules/**'],
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      thresholds: {
        global: {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
      },
    },
  },
});
```

**Key Configuration Patterns:**

1. **100% Coverage Thresholds**: Enforces complete test coverage
2. **ESM Support**: Uses ESM modules with TypeScript
3. **Path Aliases**: Configures `@` for `src/` and `#` for `src/agents/`
4. **Global Setup**: Centralized mock cleanup and API validation

### Global Test Setup

**File:** `/home/dustin/projects/hacky-hack/tests/setup.ts`

**Key Features:**

1. **API Endpoint Validation**: Prevents accidental production API usage
   - Blocks `api.anthropic.com`
   - Requires `https://api.z.ai/api/anthropic` for testing
   - Validates before each test execution

2. **Mock Cleanup**: Automatic cleanup between tests

   ```typescript
   beforeEach(() => {
     vi.clearAllMocks();
     validateApiEndpoint();
   });

   afterEach(() => {
     vi.unstubAllEnvs();
     if (typeof global.gc === 'function') {
       global.gc();
     }
   });
   ```

3. **Promise Rejection Tracking**: Catches unhandled promise rejections
   - Tracks rejections during test execution
   - Fails test if any rejections occurred
   - Prevents PromiseRejectionHandledWarning messages

### Test File Organization

**Directory Structure:**

```text
tests/
├── unit/                    # Unit tests for individual modules
│   ├── agents/             # Agent factory and prompt tests
│   │   ├── agent-factory.test.ts
│   │   ├── prompts.test.ts
│   │   └── prompts/
│   │       ├── prp-blueprint-prompt.test.ts
│   │       ├── delta-analysis-prompt.test.ts
│   │       └── bug-hunt-prompt.test.ts
│   ├── core/               # Core business logic tests
│   │   ├── session-manager.test.ts
│   │   ├── task-orchestrator.test.ts
│   │   └── models.test.ts
│   └── config/             # Configuration tests
│       └── environment.test.ts
├── integration/            # Integration tests for component interactions
│   ├── agents.test.ts      # Agent integration with Groundswell
│   ├── architect-agent.test.ts
│   ├── prp-pipeline-integration.test.ts
│   └── core/
│       └── session-manager.test.ts
├── e2e/                   # End-to-end tests for complete workflows
│   └── pipeline.test.ts
├── fixtures/              # Reusable test data
├── manual/                # Manual test scenarios
└── validation/            # Validation tests
```

**Naming Conventions:**

- Unit tests: `<module>.test.ts`
- Integration tests: `<feature>-integration.test.ts`
- E2E tests: `<workflow>.test.ts`
- Prompts: `<prompt-name>-prompt.test.ts`

---

## Mocking Patterns for External API Calls

### Groundswell Agent Mocking Pattern

**File:** `/home/dustin/projects/hacky-hack/tests/integration/agents.test.ts`

**Pattern 1: Top-Level Module Mocking**

```typescript
// Mock at top level before imports (hoisting required by vi.mock)
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
```

**Key Benefits:**

- Preserves other exports (MCPHandler, MCPServer) via `importActual`
- Prevents real LLM API calls during tests
- Enables deterministic testing with controlled responses

**Pattern 2: Mock Agent and Prompt Objects**

```typescript
// Mock Agent with prompt method
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

// Setup mocks to return predictable values
vi.mocked(createAgent).mockReturnValue(mockAgent as never);
vi.mocked(createPrompt).mockReturnValue(mockPrompt as never);
```

**Pattern 3: Test Fixtures for Mock Data**

```typescript
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
  context_scope: 'Test context scope',
};
```

### Mock Verification Patterns

**Verify Function Calls:**

```typescript
it('should call createAgent with correct config', () => {
  // EXECUTE
  createArchitectAgent();

  // VERIFY: createAgent called once
  expect(createAgent).toHaveBeenCalledTimes(1);

  // VERIFY: Correct configuration passed
  expect(createAgent).toHaveBeenCalledWith(
    expect.objectContaining({
      name: 'architect',
      model: 'GLM-4.7',
      maxTokens: 8192,
    })
  );
});
```

**Verify Prompt Content:**

```typescript
it('should create prompt with correct system message', () => {
  // EXECUTE
  createArchitectPrompt(mockPRDContent);

  // VERIFY: createPrompt called with correct system
  expect(createPrompt).toHaveBeenCalledWith(
    expect.objectContaining({
      system: expect.stringContaining('LEAD TECHNICAL ARCHITECT'),
    })
  );
});
```

---

## Testing LLM Agent Integration

### Agent Configuration Testing

**File:** `/home/dustin/projects/hacky-hack/tests/unit/agents/agent-factory.test.ts`

**Test Persona-Based Configuration:**

```typescript
describe('createBaseConfig', () => {
  const personas: AgentPersona[] = ['architect', 'researcher', 'coder', 'qa'];

  it.each(personas)('should return valid config for %s persona', persona => {
    const config = createBaseConfig(persona);

    // VERIFY: Required properties exist
    expect(config).toHaveProperty('name');
    expect(config).toHaveProperty('system');
    expect(config).toHaveProperty('model');
    expect(config).toHaveProperty('enableCache');
    expect(config).toHaveProperty('enableReflection');
    expect(config).toHaveProperty('maxTokens');
    expect(config).toHaveProperty('env');
  });

  it('should set maxTokens to 8192 for architect persona', () => {
    const config = createBaseConfig('architect');
    expect(config.maxTokens).toBe(8192);
  });

  it('should enable cache and reflection for all personas', () => {
    const configs = personas.map(p => createBaseConfig(p));

    configs.forEach(config => {
      expect(config.enableCache).toBe(true);
      expect(config.enableReflection).toBe(true);
    });
  });
});
```

### Environment Variable Testing

```typescript
describe('environment variable mapping', () => {
  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'test-token');
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://api.z.ai/api/anthropic');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should properly map environment variables', () => {
    const config = createBaseConfig('architect');

    expect(config.env.ANTHROPIC_API_KEY).toBeDefined();
    expect(config.env.ANTHROPIC_BASE_URL).toBe(
      'https://api.z.ai/api/anthropic'
    );
  });
});
```

### MCP Tool Integration Testing

```typescript
describe('MCP tool integration', () => {
  it('should include all MCP tools in agent config', () => {
    const agent = createArchitectAgent();

    // VERIFY: MCP tools are registered
    expect(MCP_TOOLS).toHaveLength(3);
    expect(MCP_TOOLS[0]).toBeInstanceOf(BashMCP);
    expect(MCP_TOOLS[1]).toBeInstanceOf(FilesystemMCP);
    expect(MCP_TOOLS[2]).toBeInstanceOf(GitMCP);
  });

  it('should pass MCP tools to createAgent', () => {
    createArchitectAgent();

    expect(createAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        mcps: MCP_TOOLS,
      })
    );
  });
});
```

---

## Prompt Validation Testing Strategies

### Prompt Export Validation

**File:** `/home/dustin/projects/hacky-hack/tests/unit/agents/prompts.test.ts`

**Test 1: Prompt Exports Exist**

```typescript
describe('prompt exports', () => {
  it('should export TASK_BREAKDOWN_PROMPT as a string', () => {
    expect(typeof TASK_BREAKDOWN_PROMPT).toBe('string');
    expect(TASK_BREAKDOWN_PROMPT.length).toBeGreaterThan(100);
  });

  it('should export PRP_BLUEPRINT_PROMPT as a string', () => {
    expect(typeof PRP_BLUEPRINT_PROMPT).toBe('string');
    expect(PRP_BLUEPRINT_PROMPT.length).toBeGreaterThan(100);
  });
});
```

**Test 2: Prompt Content Validation**

```typescript
describe('prompt content validation', () => {
  it('TASK_BREAKDOWN_PROMPT should contain expected header', () => {
    expect(TASK_BREAKDOWN_PROMPT).toContain('LEAD TECHNICAL ARCHITECT');
    expect(TASK_BREAKDOWN_PROMPT).toContain('PROJECT SYNTHESIZER');
  });

  it('PRP_BLUEPRINT_PROMPT should contain expected header', () => {
    expect(PRP_BLUEPRINT_PROMPT).toContain('Create PRP for Work Item');
    expect(PRP_BLUEPRINT_PROMPT).toContain('PRP Creation Mission');
  });
});
```

**Test 3: Formatting Preservation**

````typescript
describe('formatting preservation', () => {
  it('TASK_BREAKDOWN_PROMPT should preserve markdown code blocks', () => {
    expect(TASK_BREAKDOWN_PROMPT).toContain('```json');
    expect(TASK_BREAKDOWN_PROMPT).toContain('```');
  });

  it('PRP_BLUEPRINT_PROMPT should contain template placeholders', () => {
    expect(PRP_BLUEPRINT_PROMPT).toContain('<item_title>');
    expect(PRP_BLUEPRINT_PROMPT).toContain('<item_description>');
  });

  it('BUG_HUNT_PROMPT should contain bash command placeholder', () => {
    expect(BUG_HUNT_PROMPT).toContain('$(cat "$PRD_FILE")');
    expect(BUG_HUNT_PROMPT).toContain('$(cat "$TASKS_FILE")');
  });
});
````

### Prompt Generator Testing

**File:** `/home/dustin/projects/hacky-hack/tests/unit/agents/prompts/prp-blueprint-prompt.test.ts`

**Test Prompt Generation:**

```typescript
describe('createPRPBlueprintPrompt', () => {
  it('should generate prompt with correct structure', () => {
    const prompt = createPRPBlueprintPrompt(mockTitle, mockDescription);

    // VERIFY: Prompt object structure
    expect(prompt).toHaveProperty('system');
    expect(prompt).toHaveProperty('user');
    expect(prompt).toHaveProperty('responseFormat');
    expect(prompt).toHaveProperty('enableReflection');

    // VERIFY: Response format is Zod schema
    expect(prompt.responseFormat).toBe(PRPDocumentSchema);
  });

  it('should substitute template variables', () => {
    const prompt = createPRPBlueprintPrompt('Test Title', 'Test Description');

    // VERIFY: Variables replaced
    expect(prompt.user).toContain('Test Title');
    expect(prompt.user).toContain('Test Description');

    // VERIFY: No placeholders remaining
    expect(prompt.user).not.toContain('<item_title>');
    expect(prompt.user).not.toContain('<item_description>');
  });
});
```

---

## Zod Schema Validation Testing

### Schema Validation Patterns

**File:** `/home/dustin/projects/hacky-hack/tests/unit/core/models.test.ts`

**Test 1: Valid Data Acceptance**

```typescript
describe('StatusEnum', () => {
  it('should accept valid status values', () => {
    const validStatuses = [
      'Planned',
      'Researching',
      'Implementing',
      'Complete',
      'Failed',
      'Obsolete',
    ] as const;

    validStatuses.forEach(status => {
      const result = StatusEnum.safeParse(status);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(status);
      }
    });
  });
});
```

**Test 2: Invalid Data Rejection**

```typescript
it('should reject invalid status values', () => {
  const invalidStatus = 'InvalidStatus';
  const result = StatusEnum.safeParse(invalidStatus);

  expect(result.success).toBe(false);
});
```

**Test 3: Required Field Validation**

```typescript
it('should reject subtask with missing status field', () => {
  const validSubtask: Subtask = {
    id: 'P1.M1.T1.S1',
    type: 'Subtask',
    title: 'Test Subtask',
    status: 'Planned',
    story_points: 2,
    dependencies: [],
    context_scope: 'Test context',
  };

  // EXECUTE: Remove status field
  const { status, ...subtaskWithoutStatus } = validSubtask;
  const result = SubtaskSchema.safeParse(subtaskWithoutStatus);

  // VERIFY: Should fail validation
  expect(result.success).toBe(false);

  // VERIFY: Error should mention missing status field
  if (!result.success) {
    const statusError = result.error.issues.find(issue =>
      issue.path.includes('status')
    );
    expect(statusError).toBeDefined();
    expect(statusError?.path).toEqual(['status']);
  }
});
```

**Test 4: Schema Options Validation**

```typescript
it('should expose all enum values via options property', () => {
  expect(StatusEnum.options).toEqual([
    'Planned',
    'Researching',
    'Implementing',
    'Complete',
    'Failed',
    'Obsolete',
  ]);
});
```

### Complex Schema Testing

**Test Nested Object Validation:**

```typescript
describe('TaskSchema', () => {
  it('should validate task with subtasks', () => {
    const task: Task = {
      id: 'P1.M1.T1',
      type: 'Task',
      title: 'Test Task',
      status: 'Planned',
      story_points: 5,
      dependencies: [],
      context_scope: 'Test context',
      subtasks: [
        {
          id: 'P1.M1.T1.S1',
          type: 'Subtask',
          title: 'Test Subtask',
          status: 'Planned',
          story_points: 2,
          dependencies: [],
          context_scope: 'Test context',
        },
      ],
    };

    const result = TaskSchema.safeParse(task);
    expect(result.success).toBe(true);
  });

  it('should reject task with invalid subtask', () => {
    const invalidTask = {
      id: 'P1.M1.T1',
      type: 'Task',
      title: 'Test Task',
      status: 'Planned',
      story_points: 5,
      dependencies: [],
      context_scope: 'Test context',
      subtasks: [
        {
          id: 'P1.M1.T1.S1',
          type: 'Subtask',
          title: 'Test Subtask',
          // Missing required 'status' field
          story_points: 2,
          dependencies: [],
          context_scope: 'Test context',
        },
      ],
    };

    const result = TaskSchema.safeParse(invalidTask);
    expect(result.success).toBe(false);
  });
});
```

---

## Agent Configuration Verification

### Config Structure Validation

**Test Complete Config Structure:**

```typescript
describe('AgentConfig validation', () => {
  it('should create config with all required properties', () => {
    const config = createBaseConfig('architect');

    // VERIFY: All required properties exist
    expect(config).toMatchObject({
      name: expect.any(String),
      system: expect.any(String),
      model: 'GLM-4.7',
      enableCache: true,
      enableReflection: true,
      maxTokens: expect.any(Number),
      env: expect.objectContaining({
        ANTHROPIC_API_KEY: expect.any(String),
        ANTHROPIC_BASE_URL: expect.any(String),
      }),
    });
  });

  it('should validate config against expected schema', () => {
    const config = createBaseConfig('architect');

    // VERIFY: Property types
    expect(typeof config.name).toBe('string');
    expect(typeof config.system).toBe('string');
    expect(typeof config.model).toBe('string');
    expect(typeof config.enableCache).toBe('boolean');
    expect(typeof config.enableReflection).toBe('boolean');
    expect(typeof config.maxTokens).toBe('number');
    expect(typeof config.env).toBe('object');
  });
});
```

### Agent Tool Integration

**Test MCP Tool Registration:**

```typescript
describe('MCP tool integration', () => {
  it('should register BashMCP tools', () => {
    const bashMCP = new BashMCP();

    // VERIFY: MCP server has expected structure
    expect(bashMCP).toHaveProperty('name');
    expect(bashMCP).toHaveProperty 'tools');
  });

  it('should register FilesystemMCP tools', () => {
    const fsMCP = new FilesystemMCP();

    expect(fsMCP).toHaveProperty('name');
    expect(fsMCP).toHaveProperty('tools');
  });

  it('should register GitMCP tools', () => {
    const gitMCP = new GitMCP();

    expect(gitMCP).toHaveProperty('name');
    expect(gitMCP).toHaveProperty('tools');
  });

  it('should combine all MCP tools', () => {
    expect(MCP_TOOLS).toHaveLength(3);
    expect(MCP_TOOLS.every(mcp => mcp.name)).toBe(true);
  });
});
```

---

## Integration Test File Organization

### Test File Structure Template

**File:** `tests/integration/architect-agent-integration.test.ts`

```typescript
/**
 * Integration tests for Architect Agent
 *
 * @remarks
 * Tests validate the complete flow: agent factory → Groundswell agents → Prompt generators
 * Mocks Groundswell dependencies to prevent real LLM calls.
 *
 * Test coverage goals:
 * - 100% coverage for src/agents/architect-agent.ts
 * - Validates system prompt assignments
 * - Validates Prompt<T> typing and Zod schema associations
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

// =============================================================================
// MOCK PATTERN: Groundswell createAgent and createPrompt
// =============================================================================

vi.mock('groundswell', async () => {
  const actual = await vi.importActual('groundswell');
  return {
    ...actual,
    createAgent: vi.fn(),
    createPrompt: vi.fn(),
  };
});

import { createAgent, createPrompt } from 'groundswell';

// =============================================================================
// IMPORTS
// =============================================================================

import {
  createArchitectAgent,
  createBaseConfig,
} from '../../src/agents/agent-factory.js';
import { createArchitectPrompt } from '../../src/agents/prompts/architect-prompt.js';
import { BacklogSchema, type Backlog } from '../../src/core/models.js';

// =============================================================================
// MOCK FIXTURES: Reusable test data
// =============================================================================

const mockAgent = {
  prompt: vi.fn(),
};

const mockPrompt = {
  user: '',
  system: '',
  responseFormat: BacklogSchema,
  enableReflection: true,
};

vi.mocked(createAgent).mockReturnValue(mockAgent as never);
vi.mocked(createPrompt).mockReturnValue(mockPrompt as never);

const mockPRDContent = '# Test PRD\n\nThis is a test PRD.';

// =============================================================================
// TEST SUITES
// =============================================================================

describe('Architect Agent Integration', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('agent creation', () => {
    it('should create architect agent with correct config', () => {
      createArchitectAgent();

      expect(createAgent).toHaveBeenCalledTimes(1);
      expect(createAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'architect',
          model: 'GLM-4.7',
          maxTokens: 8192,
        })
      );
    });
  });

  describe('prompt generation', () => {
    it('should generate prompt with correct structure', () => {
      createArchitectPrompt(mockPRDContent);

      expect(createPrompt).toHaveBeenCalledTimes(1);
      expect(createPrompt).toHaveBeenCalledWith(
        expect.objectContaining({
          system: expect.stringContaining('LEAD TECHNICAL ARCHITECT'),
          responseFormat: BacklogSchema,
        })
      );
    });
  });

  describe('Zod schema integration', () => {
    it('should use BacklogSchema as response format', () => {
      const prompt = createArchitectPrompt(mockPRDContent);

      expect(prompt.responseFormat).toBe(BacklogSchema);
    });

    it('should validate backlog against schema', () => {
      const mockBacklog: Backlog = {
        backlog: [
          {
            type: 'Phase',
            id: 'P1',
            title: 'Test Phase',
            status: 'Planned',
            description: 'Test phase',
            milestones: [],
          },
        ],
      };

      const result = BacklogSchema.safeParse(mockBacklog);
      expect(result.success).toBe(true);
    });
  });
});
```

---

## Test Fixtures and Data Management

### Fixture Organization

**Directory Structure:**

```text
tests/fixtures/
├── prd/
│   ├── simple-prd.md
│   ├── complex-prd.md
│   └── edge-case-prd.md
├── prompts/
│   ├── architect-prompts.json
│   ├── researcher-prompts.json
│   └── coder-prompts.json
├── schemas/
│   ├── valid-backlog.json
│   ├── invalid-backlog.json
│   └── edge-cases.json
└── mocks/
    ├── llm-responses.json
    └── agent-configs.json
```

### Fixture Usage Pattern

```typescript
// Import fixtures
import { VALID_BACKLOG } from '../fixtures/schemas/valid-backlog.json';
import { SIMPLE_PRD } from '../fixtures/prd/simple-prd.md';

describe('fixture-based tests', () => {
  it('should parse valid backlog fixture', () => {
    const result = BacklogSchema.safeParse(VALID_BACKLOG);
    expect(result.success).toBe(true);
  });

  it('should process simple PRD fixture', () => {
    const prompt = createArchitectPrompt(SIMPLE_PRD);
    expect(prompt.user).toContain(SIMPLE_PRD);
  });
});
```

---

## Best Practices Summary

### 1. Test Organization

- **Separate unit, integration, and E2E tests** into distinct directories
- **Use descriptive test names** that explain what is being tested
- **Group related tests** using `describe` blocks
- **Follow naming conventions**: `<module>.test.ts` for unit tests

### 2. Mocking Strategy

- **Mock external dependencies** at the top level before imports
- **Preserve non-mocked exports** using `vi.importActual()`
- **Clear mocks between tests** using `vi.clearAllMocks()`
- **Verify mock calls** with `expect().toHaveBeenCalledTimes()`

### 3. Prompt Testing

- **Validate prompt structure** (system, user, responseFormat)
- **Check template variable substitution**
- **Verify formatting preservation** (markdown, code blocks)
- **Test prompt content** for required sections

### 4. Schema Validation

- **Test both valid and invalid inputs**
- **Verify error messages** for invalid data
- **Check required field validation**
- **Test nested object validation**

### 5. Agent Configuration

- **Validate all config properties** exist and have correct types
- **Test persona-based variations** (architect vs coder)
- **Verify environment variable mapping**
- **Check MCP tool integration**

### 6. Coverage Requirements

- **Maintain 100% code coverage** for all source files
- **Test edge cases and error conditions**
- **Verify both success and failure paths**
- **Use coverage reporters** (text, json, html)

### 7. Test Execution

- **Run tests in isolation** (no shared state between tests)
- **Clean up resources** in `afterEach` hooks
- **Use appropriate timeouts** for async operations
- **Handle promise rejections** explicitly

### 8. Documentation

- **Document test purposes** in file headers
- **Explain complex test scenarios** with comments
- **Reference related documentation** using `@see` tags
- **Maintain test README** in test directories

---

## Implementation Checklist for Architect Agent Testing

### Phase 1: Unit Tests

- [ ] Test agent configuration generation
- [ ] Test prompt generator functions
- [ ] Test schema validation
- [ ] Test MCP tool registration
- [ ] Test environment variable mapping

### Phase 2: Integration Tests

- [ ] Test agent creation with Groundswell
- [ ] Test prompt generation with schema binding
- [ ] Test complete workflow: factory → agent → prompt
- [ ] Test error handling and edge cases
- [ ] Test concurrent operations

### Phase 3: E2E Tests

- [ ] Test complete PRD analysis workflow
- [ ] Test task generation from PRD
- [ ] Test integration with PRP pipeline
- [ ] Test error recovery scenarios

### Phase 4: Validation Tests

- [ ] Validate prompt structure compliance
- [ ] Validate schema output format
- [ ] Validate agent configuration completeness
- [ ] Validate MCP tool functionality

---

## References and Resources

### Internal Documentation

- **Vitest Config:** `/home/dustin/projects/hacky-hack/vitest.config.ts`
- **Test Setup:** `/home/dustin/projects/hacky-hack/tests/setup.ts`
- **Agent Factory:** `/home/dustin/projects/hacky-hack/src/agents/agent-factory.ts`
- **Prompt Tests:** `/home/dustin/projects/hacky-hack/tests/unit/agents/prompts.test.ts`
- **Integration Tests:** `/home/dustin/projects/hacky-hack/tests/integration/agents.test.ts`
- **Schema Tests:** `/home/dustin/projects/hacky-hack/tests/unit/core/models.test.ts`

### External Resources

**Note:** Web search services are currently at usage limits (reset Feb 1, 2026). This document is based on:

1. **Existing codebase patterns** - Proven testing strategies already in use
2. **Vitest documentation** - Configuration and best practices
3. **Zod documentation** - Schema validation patterns
4. **Groundswell API** - Agent creation and mocking patterns

### Key Documentation Sections

- **Integration Test Organization:** Section 8
- **Mock Setup Patterns:** Section 3
- **Schema Validation Testing:** Section 6
- **Agent Config Verification:** Section 7

---

**Document Status:** Complete

**Next Steps:** Use this research to create PRP for Architect Agent integration testing implementation.
