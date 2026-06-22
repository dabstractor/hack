/**
 * Integration tests for PRPExecutor class
 *
 * @remarks
 * Tests validate PRPExecutor class with real dependencies but mocked LLM calls.
 * Uses actual createCoderAgent() and BashMCP instances but mocks agent.prompt()
 * to avoid real API calls.
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PRPExecutor } from '../../src/agents/prp-executor.js';
import type { PRPDocument } from '../../src/core/models.js';

// Mock the agent-factory module but preserve real BashMCP
vi.mock('../../src/agents/agent-factory.js', () => {
  const actual = vi.importActual('../../src/agents/agent-factory.js');
  return {
    ...(actual as any),
    createCoderAgent: vi.fn(),
  };
});

// Mock the prompts module
vi.mock('../../src/agents/prompts.js', () => ({
  PRP_BUILDER_PROMPT: '# Execute BASE PRP\n\n## PRP File: $PRP_FILE_PATH',
}));

// Mock the retry module — wraps string returns in AgentResponse shape
// so that #extractResponseContent can extract the payload correctly.
vi.mock('../../src/utils/retry.js', () => ({
  retryAgentPrompt: vi.fn(async (fn: () => Promise<unknown>, _ctx: unknown) => {
    const result = await fn();
    if (typeof result === 'string') {
      return {
        status: 'success' as const,
        data: result,
        error: null,
      };
    }
    return result;
  }),
  retry: vi.fn(),
  retryMcpTool: vi.fn(),
  sleep: vi.fn(),
  isTransientError: vi.fn(),
  isPermanentError: vi.fn(),
  calculateDelay: vi.fn(),
  createDefaultOnRetry: vi.fn(),
}));

// Mock the checkpoint-manager to prevent disk writes during tests
vi.mock('../../src/core/checkpoint-manager.js', () => ({
  CheckpointManager: vi.fn().mockImplementation(() => ({
    saveCheckpoint: vi.fn().mockResolvedValue('checkpoint-id'),
    restoreCheckpoint: vi.fn().mockResolvedValue(null),
    listCheckpoints: vi.fn().mockResolvedValue([]),
    cleanupOldCheckpoints: vi.fn().mockResolvedValue(0),
  })),
}));

// Import after mocking
import { createCoderAgent } from '../../src/agents/agent-factory.js';

const mockCreateCoderAgent = createCoderAgent as any;

// Factory function for test data
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

describe('integration: agents/prp-executor', () => {
  const sessionPath = process.cwd();
  let mockAgent: any;

  beforeEach(() => {
    // Setup mock agent with real-ish behavior
    mockAgent = {
      prompt: vi.fn(),
    };
    mockCreateCoderAgent.mockReturnValue(mockAgent);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('execute() with real dependencies', () => {
    it('should successfully execute PRP with mocked agent and real BashMCP', async () => {
      // SETUP
      const prp = createMockPRPDocument('P1.M2.T2.S2');
      const prpPath = '/tmp/test-session/prps/P1M2T2S2.md';

      // Mock Coder Agent to return success
      mockAgent.prompt.mockResolvedValue(
        JSON.stringify({
          result: 'success',
          message: 'Implementation complete',
        })
      );

      const executor = new PRPExecutor(sessionPath);

      // EXECUTE
      const result = await executor.execute(prp, prpPath);

      // VERIFY: Execution succeeded
      expect(result.success).toBe(true);
      expect(result.fixAttempts).toBe(0);
      expect(result.validationResults).toHaveLength(4);

      // VERIFY: All validation gates executed with real BashMCP
      const level1Result = result.validationResults.find(r => r.level === 1);
      const level2Result = result.validationResults.find(r => r.level === 2);
      const level3Result = result.validationResults.find(r => r.level === 3);
      const level4Result = result.validationResults.find(r => r.level === 4);

      expect(level1Result?.success).toBe(true);
      expect(level1Result?.stdout).toContain('Syntax check passed');
      expect(level2Result?.success).toBe(true);
      expect(level2Result?.stdout).toContain('Unit tests passed');
      expect(level3Result?.success).toBe(true);
      expect(level3Result?.stdout).toContain('Integration tests passed');
      expect(level4Result?.skipped).toBe(true); // Manual gate
    });

    it(
      'should handle validation gate failure with real BashMCP',
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
        const prp = createMockPRPDocument('P1.M2.T2.S2', customValidationGates);
        const prpPath = '/tmp/test-session/prps/P1M2T2S2.md';

        // Mock Coder Agent
        mockAgent.prompt.mockResolvedValue(
          JSON.stringify({
            result: 'success',
            message: 'Implementation complete',
          })
        );

        const executor = new PRPExecutor(sessionPath);

        // EXECUTE
        const result = await executor.execute(prp, prpPath);

        // VERIFY: Level 2 failed and stopped execution
        expect(result.success).toBe(false);
        expect(result.fixAttempts).toBe(2); // Max retries

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
      { timeout: 10000 }
    );

    it('should skip manual validation gates with real BashMCP', async () => {
      // SETUP
      const prp = createMockPRPDocument('P1.M2.T2.S2');
      const prpPath = '/tmp/test-session/prps/P1M2T2S2.md';

      // Mock Coder Agent
      mockAgent.prompt.mockResolvedValue(
        JSON.stringify({
          result: 'success',
          message: 'Implementation complete',
        })
      );

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
      const prp = createMockPRPDocument('P1.M2.T2.S2', customValidationGates);
      const prpPath = '/tmp/test-session/prps/P1M2T2S2.md';

      // Mock Coder Agent
      mockAgent.prompt.mockResolvedValue(
        JSON.stringify({
          result: 'success',
          message: 'Implementation complete',
        })
      );

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

    it('should capture stdout and stderr from real BashMCP commands', async () => {
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
        {
          level: 3,
          description: 'Integration tests',
          command: 'echo "Integration passed"',
          manual: false,
        },
        {
          level: 4,
          description: 'Manual review',
          command: null,
          manual: true,
        },
      ];
      const prp = createMockPRPDocument('P1.M2.T2.S2', customValidationGates);
      const prpPath = '/tmp/test-session/prps/P1M2T2S2.md';

      // Mock Coder Agent
      mockAgent.prompt.mockResolvedValue(
        JSON.stringify({
          result: 'success',
          message: 'Implementation complete',
        })
      );

      const executor = new PRPExecutor(sessionPath);

      // EXECUTE
      const result = await executor.execute(prp, prpPath);

      // VERIFY: Output was captured
      const level1Result = result.validationResults.find(r => r.level === 1);
      expect(level1Result?.stdout).toContain('Hello from stdout');
    });
  });

  describe('error handling with real dependencies', () => {
    it('should handle Coder Agent returning error JSON', async () => {
      // SETUP
      const prp = createMockPRPDocument('P1.M2.T2.S2');
      const prpPath = '/tmp/test-session/prps/P1M2T2S2.md';

      // Mock Coder Agent to return error
      mockAgent.prompt.mockResolvedValue(
        JSON.stringify({ result: 'error', message: 'PRP parsing failed' })
      );

      const executor = new PRPExecutor(sessionPath);

      // EXECUTE
      const result = await executor.execute(prp, prpPath);

      // VERIFY: Error handled gracefully
      expect(result.success).toBe(false);
      expect(result.error).toBe('PRP parsing failed');
      expect(result.fixAttempts).toBe(0);
      expect(result.validationResults).toHaveLength(0);
    });

    it('should handle Coder Agent throwing exception', async () => {
      // SETUP
      const prp = createMockPRPDocument('P1.M2.T2.S2');
      const prpPath = '/tmp/test-session/prps/P1M2T2S2.md';

      // Mock Coder Agent to throw
      mockAgent.prompt.mockRejectedValue(new Error('Network timeout'));

      const executor = new PRPExecutor(sessionPath);

      // EXECUTE
      const result = await executor.execute(prp, prpPath);

      // VERIFY: Exception caught and returned as error
      expect(result.success).toBe(false);
      expect(result.error).toContain('Network timeout');
    });

    it('should handle invalid JSON from Coder Agent', async () => {
      // SETUP
      const prp = createMockPRPDocument('P1.M2.T2.S2');
      const prpPath = '/tmp/test-session/prps/P1M2T2S2.md';

      // Mock Coder Agent to return invalid JSON
      mockAgent.prompt.mockResolvedValue('Not valid JSON at all');

      const executor = new PRPExecutor(sessionPath);

      // EXECUTE
      const result = await executor.execute(prp, prpPath);

      // VERIFY: Invalid JSON handled gracefully
      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to parse Coder Agent response');
    });
  });

  describe('PRP path injection', () => {
    it('should inject PRP path into prompt correctly', async () => {
      // SETUP
      const prp = createMockPRPDocument('P1.M2.T2.S2');
      const prpPath = '/tmp/test-session/prps/P1M2T2S2.md';

      // Mock Coder Agent
      mockAgent.prompt.mockResolvedValue(
        JSON.stringify({ result: 'success', message: 'Complete' })
      );

      const executor = new PRPExecutor(sessionPath);

      // EXECUTE
      await executor.execute(prp, prpPath);

      // VERIFY: Prompt contains the PRP path
      const promptArg = mockAgent.prompt.mock.calls[0][0];
      expect(promptArg).toContain(prpPath);
      expect(promptArg).toContain('## PRP File:');
    });
  });

  describe('ExecutionResult structure', () => {
    it('should return properly structured ExecutionResult on success', async () => {
      // SETUP
      const prp = createMockPRPDocument('P1.M2.T2.S2');
      const prpPath = '/tmp/test-session/prps/P1M2T2S2.md';

      mockAgent.prompt.mockResolvedValue(
        JSON.stringify({ result: 'success', message: 'Complete' })
      );

      const executor = new PRPExecutor(sessionPath);

      // EXECUTE
      const result = await executor.execute(prp, prpPath);

      // VERIFY: Result structure
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('validationResults');
      expect(result).toHaveProperty('artifacts');
      expect(result).toHaveProperty('fixAttempts');
      expect(typeof result.success).toBe('boolean');
      expect(Array.isArray(result.validationResults)).toBe(true);
      expect(Array.isArray(result.artifacts)).toBe(true);
      expect(typeof result.fixAttempts).toBe('number');
    });

    it('should include error field when execution fails', async () => {
      // SETUP
      const prp = createMockPRPDocument('P1.M2.T2.S2');
      const prpPath = '/tmp/test-session/prps/P1M2T2S2.md';

      mockAgent.prompt.mockResolvedValue(
        JSON.stringify({ result: 'error', message: 'Execution failed' })
      );

      const executor = new PRPExecutor(sessionPath);

      // EXECUTE
      const result = await executor.execute(prp, prpPath);

      // VERIFY: Error field is populated
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toBe('Execution failed');
    });
  });
});
