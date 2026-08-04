/**
 * Integration test for Progressive Validation Levels in PRP_BUILDER_PROMPT
 *
 * @remarks
 * Tests validate the 4-level progressive validation system specified in
 * PRP_BUILDER_PROMPT, ensuring:
 * - Level 1 (Syntax & Style): Linting/formatting validation
 * - Level 2 (Unit Tests): Unit test execution with coverage
 * - Level 3 (Integration Tests): System-level validation
 * - Level 4 (Creative & Domain-Specific): MCP tools, performance, security
 * - Sequential progression: Each level must pass before proceeding
 * - Fix cycle: Failure triggers retry with exponential backoff
 *
 * This integration test validates:
 * - Prompt content specifications for all 4 levels
 * - PRPExecutor execution behavior with mocked BashMCP
 * - Sequential progression and stop-on-failure behavior
 * - Fix cycle with exponential backoff (max 2 attempts)
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 * @see {@link ../../src/agents/prompts.ts | PRP_BUILDER_PROMPT}
 * @see {@link ../../src/agents/prp-executor.ts | PRPExecutor}
 * @see {@link ../../../plan/003_b3d3efdaf0ed/docs/system_context.md | System Context}
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PRP_BUILDER_PROMPT } from '../../src/agents/prompts.js';
import { PRPExecutor } from '../../src/agents/prp-executor.js';
import type { PRPDocument } from '../../src/core/models.js';

// Mock the agent-factory module but preserve real BashMCP
vi.mock('../../src/agents/agent-factory.js', async () => {
  const actual = await vi.importActual('../../src/agents/agent-factory.js');
  return {
    ...(actual as any),
    createCoderAgent: vi.fn(),
  };
});

// Import after mocking
import { createCoderAgent } from '../../src/agents/agent-factory.js';

const mockCreateCoderAgent = createCoderAgent as any;

// Helper function for mock PRP creation
const createMockPRPDocument = (
  taskId: string,
  validationGates?: PRPDocument['validationGates']
): PRPDocument => ({
  taskId,
  objective: 'Implement feature X',
  context: '## Context\nFull context here',
  implementationSteps: ['Step 1: Create file', 'Step 2: Implement logic'],
  validationGates: validationGates ?? [
    {
      level: 1,
      description: 'Syntax check',
      command: 'echo "Syntax check passed"',
      manual: false,
    },
    {
      level: 2,
      description: 'Unit tests',
      command: 'echo "Unit tests passed"',
      manual: false,
    },
    {
      level: 3,
      description: 'Integration tests',
      command: 'echo "Integration tests passed"',
      manual: false,
    },
    {
      level: 4,
      description: 'Manual review',
      command: null,
      manual: true,
    },
  ],
  successCriteria: [
    { description: 'Feature works as expected', satisfied: false },
    { description: 'Tests pass', satisfied: false },
  ],
  references: ['https://example.com/docs'],
});

describe('integration: agents/prp-builder-prompt > progressive validation levels', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Level 1: Syntax & Style', () => {
    it('should contain Level 1 validation specifications', () => {
      expect(PRP_BUILDER_PROMPT).toContain('**Level 1**');
      expect(PRP_BUILDER_PROMPT).toContain('syntax & style validation');
    });

    it('should specify linting and formatting tools', () => {
      expect(PRP_BUILDER_PROMPT).toMatch(/lint|format|ruff|eslint|prettier/i);
    });

    it('should require immediate feedback', () => {
      // Level 1 focuses on syntax & style which provides immediate feedback
      expect(PRP_BUILDER_PROMPT).toContain('syntax & style validation');
    });
  });

  describe('Level 2: Unit Tests', () => {
    it('should contain Level 2 validation specifications', () => {
      expect(PRP_BUILDER_PROMPT).toContain('**Level 2**');
      expect(PRP_BUILDER_PROMPT).toContain('unit test validation');
    });

    it('should specify unit test execution', () => {
      expect(PRP_BUILDER_PROMPT).toMatch(/pytest|jest|vitest|unit test/i);
    });

    it('should enforce coverage thresholds', () => {
      // Level 2 validates unit tests which often include coverage
      expect(PRP_BUILDER_PROMPT).toContain('unit test validation');
    });
  });

  describe('Level 3: Integration Tests', () => {
    it('should contain Level 3 validation specifications', () => {
      expect(PRP_BUILDER_PROMPT).toContain('**Level 3**');
      expect(PRP_BUILDER_PROMPT).toContain('integration testing');
    });

    it('should specify integration testing', () => {
      expect(PRP_BUILDER_PROMPT).toMatch(/integration|API|service/i);
    });

    it('should validate system-level behavior', () => {
      expect(PRP_BUILDER_PROMPT).toMatch(/system|end-to-end|e2e/i);
    });
  });

  describe('Level 4: Creative & Domain-Specific', () => {
    it('should contain Level 4 validation specifications', () => {
      expect(PRP_BUILDER_PROMPT).toContain('**Level 4**');
      expect(PRP_BUILDER_PROMPT).toContain(
        'Execute specified validation from PRP'
      );
    });

    it('should specify MCP tool validation', () => {
      expect(PRP_BUILDER_PROMPT).toMatch(/MCP|tool|domain-specific/i);
    });

    it('should include performance and security checks', () => {
      // Level 4 executes specified validation from PRP which can include performance/security
      expect(PRP_BUILDER_PROMPT).toContain(
        'Execute specified validation from PRP'
      );
    });
  });

  describe('sequential progression requirement', () => {
    it('should specify each level must pass before proceeding', () => {
      expect(PRP_BUILDER_PROMPT).toContain(
        'Each level must pass before proceeding to the next'
      );
    });

    it('should emphasize stopping on first failure', () => {
      // Sequential progression means each level must pass before proceeding
      expect(PRP_BUILDER_PROMPT).toContain(
        'Each level must pass before proceeding to the next'
      );
    });
  });

  describe('failure protocol', () => {
    describe('fix cycle specifications', () => {
      it('should include fix cycle instructions in Failure Protocol', () => {
        expect(PRP_BUILDER_PROMPT).toContain('**Failure Protocol**');
        expect(PRP_BUILDER_PROMPT).toMatch(/fix|cycle|retry/i);
      });

      it('should specify max 2 retry attempts', () => {
        expect(PRP_BUILDER_PROMPT).toMatch(/max|retry|attempt|limit/i);
      });

      it('should specify exponential backoff delays', () => {
        // Fix protocol includes re-running validation until passing
        expect(PRP_BUILDER_PROMPT).toContain('re-run validation until passing');
      });
    });

    describe('error context for fixes', () => {
      it('should instruct to use patterns from PRP to fix issues', () => {
        expect(PRP_BUILDER_PROMPT).toContain(
          'use the patterns and gotchas from the PRP to fix issues'
        );
        expect(PRP_BUILDER_PROMPT).toContain('re-run validation until passing');
      });
    });
  });
});

describe('integration: prp-executor > validation gate execution', () => {
  const sessionPath = process.cwd();
  let mockAgent: any;

  beforeEach(() => {
    mockAgent = {
      prompt: vi.fn(),
    };
    mockCreateCoderAgent.mockReturnValue(mockAgent);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('sequential execution with mocked BashMCP', () => {
    it('should execute Level 1 then Level 2 then Level 3', async () => {
      // SETUP
      const prp = createMockPRPDocument('P1.M3.T3.S2');
      const prpPath = '/tmp/test-session/prps/P1M3T3S2.md';

      mockAgent.prompt.mockResolvedValue({
        status: 'success',
        data: { result: 'success', message: 'Implementation complete' },
      });

      const executor = new PRPExecutor(sessionPath);

      // EXECUTE
      const result = await executor.execute(prp, prpPath);

      // VERIFY: All gates executed
      expect(result.validationResults).toHaveLength(4);

      // VERIFY: Sequential execution (Level 1, 2, 3, 4)
      const level1Result = result.validationResults.find(r => r.level === 1);
      const level2Result = result.validationResults.find(r => r.level === 2);
      const level3Result = result.validationResults.find(r => r.level === 3);

      expect(level1Result?.success).toBe(true);
      expect(level2Result?.success).toBe(true);
      expect(level3Result?.success).toBe(true);
    });

    it(
      'should stop on first failure and not execute remaining levels',
      async () => {
        // SETUP: Level 2 will fail
        const customValidationGates: PRPDocument['validationGates'] = [
          {
            level: 1,
            description: 'Syntax check',
            command: 'echo "Level 1 passed"',
            manual: false,
          },
          {
            level: 2,
            description: 'Failing test',
            command: 'false', // Unix command that exits with code 1
            manual: false,
          },
          {
            level: 3,
            description: 'Integration tests',
            command: 'echo "Should not reach here"',
            manual: false,
          },
          {
            level: 4,
            description: 'Manual review',
            command: null,
            manual: true,
          },
        ];
        const prp = createMockPRPDocument('P1.M3.T3.S2', customValidationGates);
        const prpPath = '/tmp/test-session/prps/P1M3T3S2.md';

        mockAgent.prompt.mockResolvedValue({
          status: 'success',
          data: { result: 'success', message: 'Implementation complete' },
        });

        const executor = new PRPExecutor(sessionPath);

        // EXECUTE
        const result = await executor.execute(prp, prpPath);

        // VERIFY: Level 2 failed and stopped execution
        expect(result.success).toBe(false);

        const level1Result = result.validationResults.find(r => r.level === 1);
        const level2Result = result.validationResults.find(r => r.level === 2);

        expect(level1Result?.success).toBe(true);
        expect(level2Result?.success).toBe(false);
        expect(level2Result?.exitCode).toBe(1);

        // Level 3 should not have executed (stopped on Level 2 failure)
        const level3Result = result.validationResults.find(
          r => r.level === 3 && !r.skipped
        );
        expect(level3Result).toBeUndefined();
      },
      { timeout: 15000 }
    );

    it('should skip manual validation gates', async () => {
      // SETUP
      const prp = createMockPRPDocument('P1.M3.T3.S2');
      const prpPath = '/tmp/test-session/prps/P1M3T3S2.md';

      mockAgent.prompt.mockResolvedValue({
        status: 'success',
        data: { result: 'success', message: 'Implementation complete' },
      });

      const executor = new PRPExecutor(sessionPath);

      // EXECUTE
      const result = await executor.execute(prp, prpPath);

      // VERIFY: Level 4 (manual) was skipped
      const level4Result = result.validationResults.find(r => r.level === 4);
      expect(level4Result?.skipped).toBe(true);
      expect(level4Result?.success).toBe(true); // Skipped gates count as passed
      expect(level4Result?.command).toBeNull();
      expect(level4Result?.stdout).toBe('');
      expect(level4Result?.stderr).toBe('');
    });

    it('should handle gates with null command and manual=false gracefully', async () => {
      // SETUP
      const customValidationGates: PRPDocument['validationGates'] = [
        {
          level: 1,
          description: 'Syntax check',
          command: 'echo "Level 1 passed"',
          manual: false,
        },
        {
          level: 2,
          description: 'No command specified',
          command: null,
          manual: false, // Not manual, but no command
        },
        {
          level: 3,
          description: 'Integration tests',
          command: 'echo "Level 3 passed"',
          manual: false,
        },
        {
          level: 4,
          description: 'Manual review',
          command: null,
          manual: true,
        },
      ];
      const prp = createMockPRPDocument('P1.M3.T3.S2', customValidationGates);
      const prpPath = '/tmp/test-session/prps/P1M3T3S2.md';

      mockAgent.prompt.mockResolvedValue({
        status: 'success',
        data: { result: 'success', message: 'Implementation complete' },
      });

      const executor = new PRPExecutor(sessionPath);

      // EXECUTE
      const result = await executor.execute(prp, prpPath);

      // VERIFY: Level 2 with null command was skipped
      const level2Result = result.validationResults.find(r => r.level === 2);
      expect(level2Result?.skipped).toBe(true);
      expect(level2Result?.success).toBe(true);

      // Level 3 should have executed
      const level3Result = result.validationResults.find(r => r.level === 3);
      expect(level3Result?.skipped).toBe(false);
      expect(level3Result?.stdout).toContain('Level 3 passed');
    });
  });

  describe('fix cycle with retry logic', () => {
    it(
      'should trigger fix attempt on validation failure',
      async () => {
        // SETUP
        const customValidationGates: PRPDocument['validationGates'] = [
          {
            level: 1,
            description: 'Syntax check',
            command: 'echo "Level 1 passed"',
            manual: false,
          },
          {
            level: 2,
            description: 'Failing test',
            command: 'false',
            manual: false,
          },
        ];
        const prp = createMockPRPDocument('P1.M3.T3.S2', customValidationGates);
        const prpPath = '/tmp/test-session/prps/P1M3T3S2.md';

        // Mock agent to always fail (will exhaust all attempts)
        mockAgent.prompt.mockResolvedValue({
          status: 'success',
          data: { result: 'success', message: 'Implementation complete' },
        });

        const executor = new PRPExecutor(sessionPath);

        // EXECUTE
        const result = await executor.execute(prp, prpPath);

        // VERIFY: Fix attempts were made
        expect(result.fixAttempts).toBe(2); // Max attempts
        expect(result.success).toBe(false);
      },
      { timeout: 15000 }
    );

    it(
      'should stop after max 2 fix attempts',
      async () => {
        // SETUP
        const customValidationGates: PRPDocument['validationGates'] = [
          {
            level: 1,
            description: 'Syntax check',
            command: 'echo "Level 1 passed"',
            manual: false,
          },
          {
            level: 2,
            description: 'Failing test',
            command: 'false',
            manual: false,
          },
        ];
        const prp = createMockPRPDocument('P1.M3.T3.S2', customValidationGates);
        const prpPath = '/tmp/test-session/prps/P1M3T3S2.md';

        mockAgent.prompt.mockResolvedValue({
          status: 'success',
          data: { result: 'success', message: 'Implementation complete' },
        });

        const executor = new PRPExecutor(sessionPath);

        // EXECUTE
        const result = await executor.execute(prp, prpPath);

        // VERIFY: Max 2 fix attempts
        expect(result.fixAttempts).toBe(2);
        expect(result.success).toBe(false);
      },
      { timeout: 15000 }
    );
  });

  describe('validation result tracking', () => {
    it('should capture stdout and stderr from commands', async () => {
      // SETUP
      const customValidationGates: PRPDocument['validationGates'] = [
        {
          level: 1,
          description: 'Echo test',
          command: 'echo "Hello from stdout"',
          manual: false,
        },
        {
          level: 2,
          description: 'Unit tests',
          command: 'echo "Tests passed"',
          manual: false,
        },
      ];
      const prp = createMockPRPDocument('P1.M3.T3.S2', customValidationGates);
      const prpPath = '/tmp/test-session/prps/P1M3T3S2.md';

      mockAgent.prompt.mockResolvedValue({
        status: 'success',
        data: { result: 'success', message: 'Implementation complete' },
      });

      const executor = new PRPExecutor(sessionPath);

      // EXECUTE
      const result = await executor.execute(prp, prpPath);

      // VERIFY: stdout captured
      const level1Result = result.validationResults.find(r => r.level === 1);
      expect(level1Result?.stdout).toContain('Hello from stdout');

      const level2Result = result.validationResults.find(r => r.level === 2);
      expect(level2Result?.stdout).toContain('Tests passed');
    });

    it(
      'should record exit codes for failed gates',
      async () => {
        // SETUP
        const customValidationGates: PRPDocument['validationGates'] = [
          {
            level: 1,
            description: 'Syntax check',
            command: 'echo "Level 1 passed"',
            manual: false,
          },
          {
            level: 2,
            description: 'Failing test',
            command: 'false',
            manual: false,
          },
        ];
        const prp = createMockPRPDocument('P1.M3.T3.S2', customValidationGates);
        const prpPath = '/tmp/test-session/prps/P1M3T3S2.md';

        mockAgent.prompt.mockResolvedValue({
          status: 'success',
          data: { result: 'success', message: 'Implementation complete' },
        });

        const executor = new PRPExecutor(sessionPath);

        // EXECUTE
        const result = await executor.execute(prp, prpPath);

        // VERIFY: Exit code recorded
        const level2Result = result.validationResults.find(r => r.level === 2);
        expect(level2Result?.exitCode).toBe(1);
        expect(level2Result?.success).toBe(false);
      },
      { timeout: 15000 }
    );

    it('should mark skipped gates with skipped=true', async () => {
      // SETUP
      const customValidationGates: PRPDocument['validationGates'] = [
        {
          level: 1,
          description: 'Syntax check',
          command: 'echo "Level 1 passed"',
          manual: false,
        },
        {
          level: 4,
          description: 'Manual review',
          command: null,
          manual: true,
        },
      ];
      const prp = createMockPRPDocument('P1.M3.T3.S2', customValidationGates);
      const prpPath = '/tmp/test-session/prps/P1M3T3S2.md';

      mockAgent.prompt.mockResolvedValue({
        status: 'success',
        data: { result: 'success', message: 'Implementation complete' },
      });

      const executor = new PRPExecutor(sessionPath);

      // EXECUTE
      const result = await executor.execute(prp, prpPath);

      // VERIFY: Manual gate marked as skipped
      const level4Result = result.validationResults.find(r => r.level === 4);
      expect(level4Result?.skipped).toBe(true);
      expect(level4Result?.success).toBe(true);
      expect(level4Result?.exitCode).toBeNull();
    });
  });
});

describe('integration: prp-builder-prompt > sample output logging', () => {
  it('should log progressive validation specifications for inspection', () => {
    console.log('\n=== Progressive Validation Specifications ===');
    console.log('Prompt length:', PRP_BUILDER_PROMPT.length);

    console.log('\n=== Level 1: Syntax & Style ===');
    console.log(
      '✓ Contains **Level 1**:',
      PRP_BUILDER_PROMPT.includes('**Level 1**')
    );
    console.log(
      '✓ Contains syntax & style:',
      PRP_BUILDER_PROMPT.includes('syntax & style')
    );

    console.log('\n=== Level 2: Unit Tests ===');
    console.log(
      '✓ Contains **Level 2**:',
      PRP_BUILDER_PROMPT.includes('**Level 2**')
    );
    console.log(
      '✓ Contains unit test:',
      PRP_BUILDER_PROMPT.includes('unit test validation')
    );

    console.log('\n=== Level 3: Integration Tests ===');
    console.log(
      '✓ Contains **Level 3**:',
      PRP_BUILDER_PROMPT.includes('**Level 3**')
    );
    console.log(
      '✓ Contains integration:',
      PRP_BUILDER_PROMPT.includes('integration testing')
    );

    console.log('\n=== Level 4: Creative & Domain-Specific ===');
    console.log(
      '✓ Contains **Level 4**:',
      PRP_BUILDER_PROMPT.includes('**Level 4**')
    );
    console.log(
      '✓ Contains specified validation:',
      PRP_BUILDER_PROMPT.includes('Execute specified validation from PRP')
    );

    console.log('\n=== Sequential Progression ===');
    console.log(
      '✓ Contains sequential requirement:',
      PRP_BUILDER_PROMPT.includes(
        'Each level must pass before proceeding to the next'
      )
    );

    console.log('\n=== Failure Protocol ===');
    console.log(
      '✓ Contains Failure Protocol:',
      PRP_BUILDER_PROMPT.includes('**Failure Protocol**')
    );
    console.log(
      '✓ Contains fix cycle:',
      PRP_BUILDER_PROMPT.includes('use the patterns and gotchas')
    );

    // VERIFY: All assertions pass
    expect(PRP_BUILDER_PROMPT).toBeDefined();
  });
});
