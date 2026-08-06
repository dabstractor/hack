/**
 * Unit tests for PRPExecutor class
 *
 * @remarks
 * Tests validate PRPExecutor class from src/agents/prp-executor.ts with comprehensive
 * coverage of happy path, validation gate execution, fix-and-retry scenarios, and error handling.
 *
 * Mocks are used for all external dependencies - no real I/O or LLM calls are performed.
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PRPExecutor,
  PRPExecutionError,
  ValidationError,
  type ExecutionResult,
  type ValidationGateResult,
} from '../../../src/agents/prp-executor.js';
import type { PRPDocument } from '../../../src/core/models.js';

// Mock the agent-factory module
vi.mock('../../../src/agents/agent-factory.js', () => ({
  createCoderAgent: vi.fn(),
}));

// Mock the prompts module
vi.mock('../../../src/agents/prompts.js', () => ({
  PRP_BUILDER_PROMPT: '# Execute BASE PRP\n\n## PRP File: $PRP_FILE_PATH',
}));

// Mock the bash-mcp module
vi.mock('../../../src/tools/bash-mcp.js', () => ({
  BashMCP: vi.fn().mockImplementation(() => ({
    execute_bash: vi.fn(),
  })),
}));

// Mock the retry module — wraps string returns in AgentResponse shape
// so that #extractResponseContent can extract the payload correctly.
vi.mock('../../../src/utils/retry.js', () => ({
  retryAgentPrompt: vi.fn(async (fn: () => Promise<unknown>, _ctx: unknown) => {
    const result = await fn();
    // Wrap string results in AgentResponse shape expected by #extractResponseContent
    if (typeof result === 'string') {
      return {
        status: 'success' as const,
        data: result,
        error: null,
      };
    }
    return result;
  }),
  // withAgentDeadline just races the promise against a deadline; in tests we
  // pass the inner promise straight through (no real timer).
  withAgentDeadline: vi.fn(
    async <T>(promise: Promise<T>): Promise<T> => promise
  ),
  retry: vi.fn(),
  retryMcpTool: vi.fn(),
  sleep: vi.fn(),
  isTransientError: vi.fn(),
  isPermanentError: vi.fn(),
  isWatchdogKillResult: vi.fn(),
  calculateDelay: vi.fn(),
  createDefaultOnRetry: vi.fn(),
}));

// Mock the checkpoint-manager to prevent disk writes during tests
vi.mock('../../../src/core/checkpoint-manager.js', () => ({
  CheckpointManager: vi.fn().mockImplementation(() => ({
    saveCheckpoint: vi.fn().mockResolvedValue('checkpoint-id'),
    restoreCheckpoint: vi.fn().mockResolvedValue(null),
    listCheckpoints: vi.fn().mockResolvedValue([]),
    cleanupOldCheckpoints: vi.fn().mockResolvedValue(0),
  })),
}));

// Import mocked modules
import { createCoderAgent } from '../../../src/agents/agent-factory.js';
import { BashMCP } from '../../../src/tools/bash-mcp.js';

// Cast mocked functions
const mockCreateCoderAgent = createCoderAgent as any;
const mockBashMCP = BashMCP as any;

// Factory functions for test data
const createMockAgent = () => ({
  prompt: vi.fn(),
});

const createMockPRPDocument = (taskId: string): PRPDocument => ({
  taskId,
  objective: 'Implement feature X',
  context: '## Context\nFull context here',
  implementationSteps: ['Step 1: Create file', 'Step 2: Implement logic'],
  validationGates: [
    {
      level: 1,
      description: 'Syntax check',
      command: 'npm run lint',
      manual: false,
    },
    {
      level: 2,
      description: 'Unit tests',
      command: 'npm test',
      manual: false,
    },
    {
      level: 3,
      description: 'Integration tests',
      command: 'npm run test:integration',
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

describe('agents/prp-executor', () => {
  const sessionPath = '/tmp/test-session';
  let mockAgent: ReturnType<typeof createMockAgent>;
  let mockExecuteBash: any;

  beforeEach(() => {
    // Setup mock agent
    mockAgent = createMockAgent();
    mockCreateCoderAgent.mockReturnValue(mockAgent);

    // Setup mock BashMCP execute_bash method
    mockExecuteBash = vi.fn();
    mockBashMCP.mockImplementation(() => ({
      execute_bash: mockExecuteBash,
    }));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create PRPExecutor with session path', () => {
      // EXECUTE
      const executor = new PRPExecutor(sessionPath);

      // VERIFY: Session path is set
      expect(executor.sessionPath).toBe(sessionPath);
    });

    it('should create Coder Agent in constructor', () => {
      // EXECUTE
      new PRPExecutor(sessionPath);

      // VERIFY: createCoderAgent was called once
      expect(mockCreateCoderAgent).toHaveBeenCalledTimes(1);
    });

    it('should throw error when no session path provided', () => {
      // EXECUTE & VERIFY: Constructor throws
      expect(() => new PRPExecutor('')).toThrow('sessionPath is required');
    });

    it('should throw error when session path is null', () => {
      // EXECUTE & VERIFY: Constructor throws
      expect(() => new PRPExecutor(null as any)).toThrow(
        'sessionPath is required'
      );
    });
  });

  describe('execute', () => {
    it('should successfully execute PRP with all validation gates passing', async () => {
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

      // Mock BashMCP to return success for all validation gates
      mockExecuteBash.mockResolvedValue({
        success: true,
        stdout: 'All tests passed',
        stderr: '',
        exitCode: 0,
      });

      const executor = new PRPExecutor(sessionPath);

      // EXECUTE
      const result = await executor.execute(prp, prpPath);

      // VERIFY: Execution succeeded
      expect(result.success).toBe(true);
      expect(result.outcome).toBe('success');
      expect(result.issueMessage).toBeUndefined();
      expect(result.fixAttempts).toBe(0);
      expect(result.artifacts).toEqual([]);
      expect(result.error).toBeUndefined();

      // VERIFY: All 4 validation gates were executed
      expect(result.validationResults).toHaveLength(4);
      expect(result.validationResults[0].level).toBe(1);
      expect(result.validationResults[1].level).toBe(2);
      expect(result.validationResults[2].level).toBe(3);
      expect(result.validationResults[3].level).toBe(4);
    });

    it('should skip manual validation gates', async () => {
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

      // Mock BashMCP
      mockExecuteBash.mockResolvedValue({
        success: true,
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const executor = new PRPExecutor(sessionPath);

      // EXECUTE
      const result = await executor.execute(prp, prpPath);

      // VERIFY: Level 4 (manual) was skipped
      const level4Result = result.validationResults.find(r => r.level === 4);
      expect(level4Result?.skipped).toBe(true);
      expect(level4Result?.success).toBe(true); // Skipped gates count as passed
      expect(level4Result?.command).toBeNull();
    });

    it('neutralizes a negated file-existence gate (G2.1): skipped, execute_bash NOT called, run succeeds', async () => {
      // SETUP — BUG/REQ-G2 (PRD §9.9): a cached/legacy `! test -f X` gate must be
      // neutralized at runtime so it never hard-fails when X legitimately exists
      // from another task's completed work (geoform-hack regression). The REAL
      // detector (gate-semantics.ts) classifies the command — do NOT mock it.
      const negCmd = '! test -f src/hooks/index.ts';
      const prp: PRPDocument = {
        ...createMockPRPDocument('P1.M3.T1.S1'),
        validationGates: [
          {
            level: 1,
            description: 'barrel must NOT exist (legacy gate)',
            command: negCmd,
            manual: false,
          },
          {
            level: 2,
            description: 'lint',
            command: 'npm run lint',
            manual: false,
          },
        ],
      };
      const prpPath = '/tmp/test-session/prps/P1M3T1S1.md';

      mockAgent.prompt.mockResolvedValue(
        JSON.stringify({ result: 'success', message: 'done' })
      );
      mockExecuteBash.mockResolvedValue({
        success: true,
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      // EXECUTE
      const executor = new PRPExecutor(sessionPath);
      const result = await executor.execute(prp, prpPath);

      // VERIFY: run succeeded (neutralized gate counts as passed via skipped)
      expect(result.outcome).toBe('success');

      // VERIFY: the negated-existence gate was neutralized (manual-skip shape)
      const negResult = result.validationResults.find(
        r => r.command === negCmd
      );
      expect(negResult?.skipped).toBe(true);
      expect(negResult?.success).toBe(true);
      expect(negResult?.exitCode).toBeNull();

      // VERIFY: execute_bash was NOT called for the neutralized command, but the
      // real gate still ran.
      const calledCommands = mockExecuteBash.mock.calls.map(
        ([args]: any) => args.command
      );
      expect(calledCommands).not.toContain(negCmd);
      expect(calledCommands).toContain('npm run lint');
    });

    it('executes a negated CONTENT gate normally (G2.2): execute_bash IS called', async () => {
      // SETUP — G2.2: negated content checks (`! grep …`) are NOT neutralized
      // (content is a terminal-state assertion). They execute normally.
      const contentCmd = '! grep -q TODO src/x.ts';
      const prp: PRPDocument = {
        ...createMockPRPDocument('P1.M3.T1.S2'),
        validationGates: [
          {
            level: 1,
            description: 'no TODO markers',
            command: contentCmd,
            manual: false,
          },
        ],
      };
      const prpPath = '/tmp/test-session/prps/P1M3T1S2.md';

      mockAgent.prompt.mockResolvedValue(
        JSON.stringify({ result: 'success', message: 'done' })
      );
      mockExecuteBash.mockResolvedValue({
        success: true,
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      // EXECUTE
      const executor = new PRPExecutor(sessionPath);
      await executor.execute(prp, prpPath);

      // VERIFY: the negated content gate WAS executed (G2.2).
      const calledCommands = mockExecuteBash.mock.calls.map(
        ([args]: any) => args.command
      );
      expect(calledCommands).toContain(contentCmd);
    });

    it('executes an ambiguous gate normally (G2.3): execute_bash IS called', async () => {
      // SETUP — G2.3: ambiguous commands (`test -n foo`) are NOT neutralized
      // (the detector is conservative). They execute normally.
      const ambCmd = 'test -n foo';
      const prp: PRPDocument = {
        ...createMockPRPDocument('P1.M3.T1.S3'),
        validationGates: [
          {
            level: 1,
            description: 'ambiguous',
            command: ambCmd,
            manual: false,
          },
        ],
      };
      const prpPath = '/tmp/test-session/prps/P1M3T1S3.md';

      mockAgent.prompt.mockResolvedValue(
        JSON.stringify({ result: 'success', message: 'done' })
      );
      mockExecuteBash.mockResolvedValue({
        success: true,
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      // EXECUTE
      const executor = new PRPExecutor(sessionPath);
      await executor.execute(prp, prpPath);

      // VERIFY: the ambiguous gate WAS executed (G2.3).
      const calledCommands = mockExecuteBash.mock.calls.map(
        ([args]: any) => args.command
      );
      expect(calledCommands).toContain(ambCmd);
    });

    it('should return failed result when Coder Agent reports error', async () => {
      // SETUP
      const prp = createMockPRPDocument('P1.M2.T2.S2');
      const prpPath = '/tmp/test-session/prps/P1M2T2S2.md';

      // Mock Coder Agent to return error
      mockAgent.prompt.mockResolvedValue(
        JSON.stringify({ result: 'error', message: 'Failed to parse PRP' })
      );

      const executor = new PRPExecutor(sessionPath);

      // EXECUTE
      const result = await executor.execute(prp, prpPath);

      // VERIFY: Execution failed
      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed to parse PRP');
      expect(result.fixAttempts).toBe(0);
      expect(result.validationResults).toEqual([]);
      expect(result.outcome).toBe('fail');
      expect(result.issueMessage).toBeUndefined();
    });

    it('should surface an issue outcome distinctly from fail when Coder Agent reports issue', async () => {
      // SETUP
      const prp = createMockPRPDocument('P1.M2.T2.S2');
      const prpPath = '/tmp/test-session/prps/P1M2T2S2.md';

      // Mock Coder Agent to return issue
      mockAgent.prompt.mockResolvedValue(
        JSON.stringify({
          result: 'issue',
          message: 'PRP missing API spec; cannot implement',
        })
      );

      const executor = new PRPExecutor(sessionPath);

      // EXECUTE
      const result = await executor.execute(prp, prpPath);

      // VERIFY: Issue outcome is distinct from fail
      expect(result.success).toBe(false);
      expect(result.outcome).toBe('issue');
      expect(result.issueMessage).toBe(
        'PRP missing API spec; cannot implement'
      );
      expect(result.error).toBe('PRP missing API spec; cannot implement');
      expect(result.fixAttempts).toBe(0);
      expect(result.validationResults).toEqual([]); // issue short-circuits before validation
      expect(mockExecuteBash).not.toHaveBeenCalled(); // no gates run on issue
    });

    it(
      'should trigger fix-and-retry on validation failure',
      async () => {
        // SETUP
        const prp = createMockPRPDocument('P1.M2.T2.S2');
        const prpPath = '/tmp/test-session/prps/P1M2T2S2.md';

        // Mock Coder Agent calls
        mockAgent.prompt
          .mockResolvedValueOnce(
            JSON.stringify({
              result: 'success',
              message: 'Implementation complete',
            })
          )
          .mockResolvedValueOnce(
            JSON.stringify({ result: 'success', message: 'Fix applied' })
          );

        // Mock bashMCP.execute_bash to implement a state machine
        // First run: Level 1 passes, Level 2 fails
        // Second run (after fix): All pass
        let callCount = 0;
        mockExecuteBash.mockImplementation(async () => {
          callCount++;
          // First validation run
          if (callCount === 1) {
            // Level 1: Pass
            return { success: true, stdout: '', stderr: '', exitCode: 0 };
          } else if (callCount === 2) {
            // Level 2: Fail -> triggers fix attempt
            return {
              success: false,
              stdout: '',
              stderr: 'Test failed',
              exitCode: 1,
            };
          }
          // Second validation run (after fix)
          // All remaining gates pass
          return { success: true, stdout: 'Passed', stderr: '', exitCode: 0 };
        });

        const executor = new PRPExecutor(sessionPath);

        // EXECUTE
        const result = await executor.execute(prp, prpPath);

        // VERIFY: Fix-and-retry was triggered
        expect(result.fixAttempts).toBe(1);
        expect(result.success).toBe(true);
        expect(mockAgent.prompt).toHaveBeenCalledTimes(2); // Initial + 1 fix
      },
      { timeout: 10000 }
    );

    it(
      'should exhaust fix attempts after 2 retries',
      async () => {
        // SETUP
        const prp = createMockPRPDocument('P1.M2.T2.S2');
        const prpPath = '/tmp/test-session/prps/P1M2T2S2.md';

        // Mock Coder Agent calls
        mockAgent.prompt.mockResolvedValue(
          JSON.stringify({ result: 'success', message: 'Attempt' })
        );

        // Mock bashMCP.execute_bash to always fail at Level 2
        mockExecuteBash.mockImplementation(async () => {
          return {
            success: false,
            stdout: '',
            stderr: 'Test failed',
            exitCode: 1,
          };
        });

        const executor = new PRPExecutor(sessionPath);

        // EXECUTE
        const result = await executor.execute(prp, prpPath);

        // VERIFY: All fix attempts exhausted
        expect(result.fixAttempts).toBe(2);
        expect(result.success).toBe(false);
        expect(result.outcome).toBe('fail');
        expect(result.error).toBe('Validation failed after all fix attempts');
        expect(mockAgent.prompt).toHaveBeenCalledTimes(3); // Initial + 2 fixes
      },
      { timeout: 10000 }
    );

    // ====================================================================
    // Watchdog-killed gate — terminal abort (PRD §9.3.2; P3.M2.T2.S2)
    // ====================================================================

    /** PRP fixture with a single executable validation gate (Level 1). */
    const createSingleGatePRP = (taskId: string): PRPDocument => ({
      taskId,
      objective: 'Implement feature X',
      context: '## Context\nFull context here',
      implementationSteps: ['Step 1: Create file'],
      validationGates: [
        {
          level: 1,
          description: 'Unit tests',
          command: 'npm test',
          manual: false,
        },
      ],
      successCriteria: [
        { description: 'Feature works as expected', satisfied: false },
      ],
      references: [],
    });

    it(
      'aborts (outcome:fail) without fix-retry when a gate is watchdog-killed (timedOut:true)',
      async () => {
        // SETUP
        const prp = createSingleGatePRP('P3.M2.T2.S2');
        const prpPath = '/tmp/test-session/prps/P3M2T2S2.md';

        // Mock Coder Agent → success (we must reach validation)
        mockAgent.prompt.mockResolvedValue(
          JSON.stringify({
            result: 'success',
            message: 'Implementation complete',
          })
        );

        // Mock the gate as a Node-watchdog kill: timedOut:true, exitCode 143.
        mockExecuteBash.mockResolvedValue({
          success: false,
          stdout: '',
          stderr: 'killed',
          exitCode: 143,
          timedOut: true,
          killed: true,
        });

        const executor = new PRPExecutor(sessionPath);

        // EXECUTE
        const result = await executor.execute(prp, prpPath);

        // VERIFY: terminal abort — outcome:fail, flag surfaced, NO fix-retry.
        expect(result.outcome).toBe('fail');
        expect(result.success).toBe(false);
        expect(result.validationResults[0].timedOut).toBe(true);
        expect(result.fixAttempts).toBe(0);
        // Initial coder run ONLY — #fixAndRetry never invoked.
        expect(mockAgent.prompt).toHaveBeenCalledTimes(1);
        // The hung command ran exactly once (no re-run).
        expect(mockExecuteBash).toHaveBeenCalledTimes(1);
      },
      { timeout: 10000 }
    );

    it(
      'aborts without fix-retry for a coreutil-killed gate (exitCode:124)',
      async () => {
        // SETUP
        const prp = createSingleGatePRP('P3.M2.T2.S2');
        const prpPath = '/tmp/test-session/prps/P3M2T2S2.md';

        mockAgent.prompt.mockResolvedValue(
          JSON.stringify({
            result: 'success',
            message: 'Implementation complete',
          })
        );

        // Mock the gate as a `timeout` coreutil kill: exitCode 124, Node
        // watchdog did NOT fire (timedOut:false). Layer B must map this to
        // gateResult.timedOut === true.
        mockExecuteBash.mockResolvedValue({
          success: false,
          stdout: '',
          stderr: '',
          exitCode: 124,
          timedOut: false,
          killed: false,
        });

        const executor = new PRPExecutor(sessionPath);

        // EXECUTE
        const result = await executor.execute(prp, prpPath);

        // VERIFY: same terminal abort as the timedOut vector.
        expect(result.outcome).toBe('fail');
        expect(result.success).toBe(false);
        expect(result.validationResults[0].timedOut).toBe(true); // mapped from 124
        expect(result.fixAttempts).toBe(0);
        expect(mockAgent.prompt).toHaveBeenCalledTimes(1); // no fix-retry
      },
      { timeout: 10000 }
    );

    it('should handle JSON parsing errors from Coder Agent', async () => {
      // SETUP
      const prp = createMockPRPDocument('P1.M2.T2.S2');
      const prpPath = '/tmp/test-session/prps/P1M2T2S2.md';

      // Mock Coder Agent to return invalid JSON
      mockAgent.prompt.mockResolvedValue('This is not valid JSON');

      const executor = new PRPExecutor(sessionPath);

      // EXECUTE
      const result = await executor.execute(prp, prpPath);

      // VERIFY: Execution failed gracefully
      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to parse Coder Agent response');
    });

    it('should handle JSON wrapped in markdown code blocks', async () => {
      // SETUP
      const prp = createMockPRPDocument('P1.M2.T2.S2');
      const prpPath = '/tmp/test-session/prps/P1M2T2S2.md';

      // Mock Coder Agent to return JSON in markdown
      mockAgent.prompt.mockResolvedValue(`
\`\`\`json
{
  "result": "success",
  "message": "Implementation complete"
}
\`\`\`
      `);

      // Mock validation to pass
      mockExecuteBash.mockResolvedValue({
        success: true,
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const executor = new PRPExecutor(sessionPath);

      // EXECUTE
      const result = await executor.execute(prp, prpPath);

      // VERIFY: JSON was parsed correctly
      expect(result.success).toBe(true);
    });

    it('should handle exception during execution', async () => {
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

    it('should execute validation gates in sequential order by level', async () => {
      // SETUP
      const prp = createMockPRPDocument('P1.M2.T2.S2');
      const prpPath = '/tmp/test-session/prps/P1M2T2S2.md';

      // Mock Coder Agent
      mockAgent.prompt.mockResolvedValue(
        JSON.stringify({ result: 'success', message: 'Complete' })
      );

      // Track execution order
      const executionOrder: number[] = [];
      mockExecuteBash.mockImplementation(({ command }: any) => {
        if (command === 'npm run lint') executionOrder.push(1);
        if (command === 'npm test') executionOrder.push(2);
        if (command === 'npm run test:integration') executionOrder.push(3);
        return Promise.resolve({
          success: true,
          stdout: '',
          stderr: '',
          exitCode: 0,
        });
      });

      const executor = new PRPExecutor(sessionPath);

      // EXECUTE
      await executor.execute(prp, prpPath);

      // VERIFY: Gates executed in order 1, 2, 3
      expect(executionOrder).toEqual([1, 2, 3]);
    });

    it(
      'should stop validation execution on first failure',
      async () => {
        // SETUP
        const prp = createMockPRPDocument('P1.M2.T2.S2');
        const prpPath = '/tmp/test-session/prps/P1M2T2S2.md';

        // Mock Coder Agent
        mockAgent.prompt.mockResolvedValue(
          JSON.stringify({ result: 'success', message: 'Complete' })
        );

        // Level 2 fails, Level 3 should not execute
        mockExecuteBash.mockImplementation(({ command }: any) => {
          if (command === 'npm run lint') {
            return Promise.resolve({
              success: true,
              stdout: '',
              stderr: '',
              exitCode: 0,
            });
          }
          if (command === 'npm test') {
            return Promise.resolve({
              success: false,
              stdout: '',
              stderr: 'Failed',
              exitCode: 1,
            });
          }
          if (command === 'npm run test:integration') {
            // This should not be called
            return Promise.resolve({
              success: true,
              stdout: '',
              stderr: '',
              exitCode: 0,
            });
          }
          return Promise.resolve({
            success: true,
            stdout: '',
            stderr: '',
            exitCode: 0,
          });
        });

        const executor = new PRPExecutor(sessionPath);

        // EXECUTE
        const result = await executor.execute(prp, prpPath);

        // VERIFY: Level 3 was not executed (only 3 results: L1, L2, L4)
        // Level 4 is manual so it's skipped
        const nonSkippedResults = result.validationResults.filter(
          r => !r.skipped
        );
        expect(nonSkippedResults).toHaveLength(2); // Only Level 1 and Level 2 executed
        expect(nonSkippedResults[1].success).toBe(false); // Level 2 failed
      },
      { timeout: 10000 }
    );
  });

  describe('PRPExecutionError', () => {
    it('should create error with correct properties', () => {
      // EXECUTE
      const originalError = new Error('LLM failed');
      const error = new PRPExecutionError(
        'P1.M2.T2.S2',
        '/path/to/prp.md',
        originalError
      );

      // VERIFY: Error has correct properties
      expect(error.name).toBe('PRPExecutionError');
      expect(error.taskId).toBe('P1.M2.T2.S2');
      expect(error.prpPath).toBe('/path/to/prp.md');
      expect(error.message).toContain('P1.M2.T2.S2');
      expect(error.message).toContain('/path/to/prp.md');
      expect(error.message).toContain('LLM failed');
    });

    it('should handle non-Error objects as original error', () => {
      // EXECUTE
      const originalError = 'String error message';
      const error = new PRPExecutionError(
        'P1.M2.T2.S2',
        '/path/to/prp.md',
        originalError
      );

      // VERIFY: Error message contains string
      expect(error.message).toContain('String error message');
    });
  });

  describe('ValidationError', () => {
    it('should create error with correct properties', () => {
      // EXECUTE
      const error = new ValidationError(
        2,
        'npm test',
        'Tests passed',
        'Test failed'
      );

      // VERIFY: Error has correct properties
      expect(error.name).toBe('ValidationError');
      expect(error.level).toBe(2);
      expect(error.command).toBe('npm test');
      expect(error.stdout).toBe('Tests passed');
      expect(error.stderr).toBe('Test failed');
      expect(error.message).toContain('Level 2');
      expect(error.message).toContain('npm test');
      expect(error.message).toContain('Test failed');
    });
  });

  describe('ValidationGateResult interface', () => {
    it('should create valid result object', () => {
      // EXECUTE
      const result: ValidationGateResult = {
        level: 1,
        description: 'Syntax check',
        success: true,
        command: 'npm run lint',
        stdout: 'No errors',
        stderr: '',
        exitCode: 0,
        skipped: false,
        timedOut: false,
      };

      // VERIFY: All properties are set
      expect(result.level).toBe(1);
      expect(result.description).toBe('Syntax check');
      expect(result.success).toBe(true);
      expect(result.command).toBe('npm run lint');
      expect(result.stdout).toBe('No errors');
      expect(result.stderr).toBe('');
      expect(result.exitCode).toBe(0);
      expect(result.skipped).toBe(false);
      expect(result.timedOut).toBe(false);
    });
  });

  describe('ExecutionResult interface', () => {
    it('should create valid result object', () => {
      // EXECUTE
      const result: ExecutionResult = {
        success: true,
        validationResults: [],
        artifacts: ['/path/to/file.ts'],
        fixAttempts: 0,
      };

      // VERIFY: All properties are set
      expect(result.success).toBe(true);
      expect(result.validationResults).toEqual([]);
      expect(result.artifacts).toEqual(['/path/to/file.ts']);
      expect(result.fixAttempts).toBe(0);
      expect(result.error).toBeUndefined();
    });

    it('should include error when failed', () => {
      // EXECUTE
      const result: ExecutionResult = {
        success: false,
        validationResults: [],
        artifacts: [],
        error: 'Validation failed',
        fixAttempts: 2,
      };

      // VERIFY: Error is set
      expect(result.success).toBe(false);
      expect(result.error).toBe('Validation failed');
      expect(result.fixAttempts).toBe(2);
    });
  });
});
