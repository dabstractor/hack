# Architect Agent Integration Testing Implementation Guide

**Quick Reference:** Implementing Integration Tests for Architect Agent

**Date:** 2026-01-19

**Purpose:** Provide actionable patterns and templates for creating Architect Agent integration tests.

---

## Quick Start Template

### Basic Integration Test Structure

```typescript
/**
 * Integration tests for Architect Agent
 *
 * @remarks
 * Tests validate: agent factory → Groundswell agents → Prompt generators → Schema validation
 * Mocks Groundswell to prevent real LLM API calls
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

// =============================================================================
// MOCK SETUP: Must be before imports
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
import { createArchitectAgent } from '../../src/agents/agent-factory.js';
import { createArchitectPrompt } from '../../src/agents/prompts/architect-prompt.js';
import { BacklogSchema } from '../../src/core/models.js';

// =============================================================================
// MOCK FIXTURES
// =============================================================================
const mockAgent = { prompt: vi.fn() };
const mockPrompt = {
  user: '',
  system: '',
  responseFormat: BacklogSchema,
  enableReflection: true,
};

vi.mocked(createAgent).mockReturnValue(mockAgent as never);
vi.mocked(createPrompt).mockReturnValue(mockPrompt as never);

// =============================================================================
// TESTS
// =============================================================================
describe('Architect Agent Integration', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('agent creation', () => {
    it('should create architect agent', () => {
      createArchitectAgent();
      expect(createAgent).toHaveBeenCalled();
    });
  });

  describe('prompt generation', () => {
    it('should generate architect prompt', () => {
      const prd = '# Test PRD';
      createArchitectPrompt(prd);
      expect(createPrompt).toHaveBeenCalled();
    });
  });
});
```

---

## Test Categories

### 1. Agent Configuration Tests

```typescript
describe('Agent Configuration', () => {
  it('should create config with correct properties', () => {
    const agent = createArchitectAgent();

    expect(createAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'architect',
        model: 'GLM-4.7',
        maxTokens: 8192,
        enableCache: true,
        enableReflection: true,
      })
    );
  });

  it('should include MCP tools in config', () => {
    createArchitectAgent();

    expect(createAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        mcps: expect.any(Array),
      })
    );
  });
});
```

### 2. Prompt Generation Tests

```typescript
describe('Prompt Generation', () => {
  it('should generate prompt with correct structure', () => {
    const prd = '# Test PRD';
    createArchitectPrompt(prd);

    expect(createPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.any(String),
        user: expect.any(String),
        responseFormat: BacklogSchema,
        enableReflection: true,
      })
    );
  });

  it('should include PRD content in user prompt', () => {
    const prd = '# Test PRD Content';
    createArchitectPrompt(prd);

    expect(createPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        user: expect.stringContaining('Test PRD Content'),
      })
    );
  });
});
```

### 3. Schema Validation Tests

```typescript
describe('Schema Validation', () => {
  it('should use BacklogSchema as response format', () => {
    const prd = '# Test PRD';
    const prompt = createArchitectPrompt(prd);

    expect(prompt.responseFormat).toBe(BacklogSchema);
  });

  it('should validate valid backlog', () => {
    const validBacklog = {
      backlog: [
        {
          type: 'Phase',
          id: 'P1',
          title: 'Test Phase',
          status: 'Planned',
          description: 'Test',
          milestones: [],
        },
      ],
    };

    const result = BacklogSchema.safeParse(validBacklog);
    expect(result.success).toBe(true);
  });

  it('should reject invalid backlog', () => {
    const invalidBacklog = { backlog: [] };

    const result = BacklogSchema.safeParse(invalidBacklog);
    expect(result.success).toBe(false);
  });
});
```

### 4. Environment Variable Tests

```typescript
describe('Environment Configuration', () => {
  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'test-token');
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://api.z.ai/api/anthropic');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should map environment variables correctly', () => {
    const agent = createArchitectAgent();

    expect(createAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        env: expect.objectContaining({
          ANTHROPIC_API_KEY: 'test-token',
          ANTHROPIC_BASE_URL: 'https://api.z.ai/api/anthropic',
        }),
      })
    );
  });
});
```

### 5. MCP Tool Integration Tests

```typescript
describe('MCP Tool Integration', () => {
  it('should register BashMCP tools', () => {
    const agent = createArchitectAgent();

    expect(createAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        mcps: expect.arrayContaining([
          expect.objectContaining({
            name: expect.any(String),
          }),
        ]),
      })
    );
  });

  it('should register FilesystemMCP tools', () => {
    // Test filesystem MCP registration
  });

  it('should register GitMCP tools', () => {
    // Test git MCP registration
  });
});
```

---

## Test Fixtures

### PRD Fixtures

```typescript
// tests/fixtures/prd/simple-prd.ts
export const SIMPLE_PRD = `# Simple Test PRD

## Overview
This is a simple PRD for testing.

## Requirements
- Requirement 1
- Requirement 2`;

// tests/fixtures/prd/complex-prd.ts
export const COMPLEX_PRD = `# Complex Test PRD

## Overview
Complex multi-component system.

## Components
1. Component A
2. Component B
3. Component C

## Requirements
### Functional
- FR-001: User authentication
- FR-002: Data processing

### Non-Functional
- NFR-001: Performance
- NFR-002: Security`;
```

### Backlog Fixtures

```typescript
// tests/fixtures/schemas/valid-backlog.ts
import { type Backlog } from '../../../src/core/models.js';

export const VALID_BACKLOG: Backlog = {
  backlog: [
    {
      type: 'Phase',
      id: 'P1',
      title: 'Phase 1: Implementation',
      status: 'Planned',
      description: 'Initial implementation phase',
      milestones: [
        {
          type: 'Milestone',
          id: 'P1.M1',
          title: 'Milestone 1.1',
          status: 'Planned',
          description: 'Core functionality',
          tasks: [
            {
              type: 'Task',
              id: 'P1.M1.T1',
              title: 'Task 1.1.1',
              status: 'Planned',
              story_points: 5,
              dependencies: [],
              context_scope: 'Test context',
            },
          ],
        },
      ],
    },
  ],
};
```

---

## Common Patterns

### Pattern 1: Test Data Builder

```typescript
class BacklogBuilder {
  private backlog: Backlog = {
    backlog: [
      {
        type: 'Phase',
        id: 'P1',
        title: 'Test Phase',
        status: 'Planned',
        description: 'Test',
        milestones: [],
      },
    ],
  };

  withTitle(title: string) {
    this.backlog.backlog[0].title = title;
    return this;
  }

  withStatus(status: string) {
    this.backlog.backlog[0].status = status as any;
    return this;
  }

  build() {
    return this.backlog;
  }
}

// Usage
const backlog = new BacklogBuilder()
  .withTitle('Custom Title')
  .withStatus('Implementing')
  .build();
```

### Pattern 2: Mock Response Factory

```typescript
class MockLLMResponse {
  static success(data: unknown) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(data),
        },
      ],
      model: 'GLM-4.7',
      stop_reason: 'end_turn',
    };
  }

  static error(message: string) {
    return {
      type: 'error',
      error: {
        type: 'api_error',
        message,
      },
    };
  }
}

// Usage
const mockResponse = MockLLMResponse.success(VALID_BACKLOG);
mockAgent.prompt.mockResolvedValue(mockResponse);
```

### Pattern 3: Test Helper Functions

```typescript
// tests/helpers/architect-agent-helpers.ts
export async function createTestArchitectAgent(prd: string) {
  const agent = createArchitectAgent();
  const prompt = createArchitectPrompt(prd);
  return { agent, prompt };
}

export function expectValidBacklog(backlog: unknown) {
  const result = BacklogSchema.safeParse(backlog);
  expect(result.success).toBe(true);
  return result.success ? result.data : null;
}

export function expectInvalidBacklog(backlog: unknown) {
  const result = BacklogSchema.safeParse(backlog);
  expect(result.success).toBe(false);
  return result.success ? null : result.error;
}

// Usage
const { agent, prompt } = await createTestArchitectAgent(SIMPLE_PRD);
const validated = expectValidBacklog(mockResponse);
```

---

## Test Organization

### File Structure

```text
tests/integration/agents/
├── architect-agent-integration.test.ts
├── researcher-agent-integration.test.ts
├── coder-agent-integration.test.ts
└── qa-agent-integration.test.ts

tests/unit/agents/prompts/
├── architect-prompt.test.ts
├── researcher-prompt.test.ts
├── coder-prompt.test.ts
└── qa-prompt.test.ts

tests/fixtures/
├── prd/
│   ├── simple-prd.ts
│   ├── complex-prd.ts
│   └── edge-cases.ts
└── schemas/
    ├── valid-backlog.ts
    ├── invalid-backlog.ts
    └── edge-cases.ts
```

### Test Suite Structure

```typescript
describe('Architect Agent Integration', () => {
  describe('configuration', () => {
    // Agent config tests
  });

  describe('prompt generation', () => {
    // Prompt tests
  });

  describe('schema validation', () => {
    // Schema tests
  });

  describe('MCP tools', () => {
    // Tool integration tests
  });

  describe('environment', () => {
    // Environment variable tests
  });

  describe('error handling', () => {
    // Error scenarios
  });

  describe('edge cases', () => {
    // Edge case testing
  });
});
```

---

## Best Practices Checklist

### Test Setup

- [ ] Mock Groundswell before imports
- [ ] Preserve non-mocked exports with `vi.importActual()`
- [ ] Clear mocks in `afterEach`
- [ ] Set up environment variables in `beforeEach`

### Test Structure

- [ ] Use descriptive test names
- [ ] Group related tests with `describe`
- [ ] Arrange-Act-Assert pattern
- [ ] Test both success and failure paths

### Mock Verification

- [ ] Verify mock call counts
- [ ] Verify mock call arguments
- [ ] Reset mocks between tests
- [ ] Use `vi.mocked()` for type safety

### Schema Testing

- [ ] Test valid data acceptance
- [ ] Test invalid data rejection
- [ ] Test error message quality
- [ ] Test edge cases

### Coverage

- [ ] Maintain 100% code coverage
- [ ] Test all branches
- [ ] Test all error paths
- [ ] Run coverage reports regularly

---

## Running Tests

### Commands

```bash
# Run all tests
npm test

# Run integration tests only
npm test -- tests/integration

# Run specific test file
npm test -- architect-agent-integration.test.ts

# Run with coverage
npm run test:coverage

# Run in watch mode
npm run test:watch

# Run tests matching pattern
npm test -- --grep "architect"
```

### CI/CD Integration

```yaml
# .github/workflows/test.yml
name: Tests
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run test:coverage
      - uses: codecov/codecov-action@v3
```

---

## Debugging Tips

### Common Issues

1. **Mock not working**
   - Ensure mock is before imports
   - Check module path is correct
   - Use `vi.importActual()` to preserve exports

2. **Test timing out**
   - Increase timeout: `test.setTimeout(5000)`
   - Check for hanging promises
   - Verify async/await usage

3. **Coverage not 100%**
   - Run coverage with `--reporter=html`
   - Check for untested branches
   - Add tests for error paths

4. **Environment variables missing**
   - Set up in `beforeEach`
   - Clean up in `afterEach`
   - Use `vi.stubEnv()`

### Debugging Commands

```bash
# Run tests in debug mode
node --inspect-brk node_modules/.bin/vitest run

# Run specific test with console output
npm test -- --reporter=verbose

# List all tests
npm test -- --listTests

# Run tests matching pattern
npm test -- --grep "should create"
```

---

## Next Steps

1. **Create test file**: Copy the Quick Start Template
2. **Add fixtures**: Create PRD and schema fixtures
3. **Implement tests**: Follow test categories
4. **Run tests**: Verify all pass
5. **Check coverage**: Ensure 100%
6. **Refactor**: Extract common patterns to helpers

---

**Document Status:** Ready for Implementation

**Related Documents:**

- `/home/dustin/projects/hacky-hack/docs/research/llm-agent-testing-best-practices.md`
- `/home/dustin/projects/hacky-hack/docs/research/llm-agent-testing-resources.md`
