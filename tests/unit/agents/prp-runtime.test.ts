/**
 * Unit tests for PRPRuntime class
 *
 * @remarks
 * Tests validate PRPRuntime class from src/agents/prp-runtime.ts with comprehensive
 * coverage of happy path, status progression, and error handling.
 *
 * Mocks are used for all external dependencies - no real I/O or LLM calls are performed.
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PRPRuntime,
  PRPRuntimeError,
} from '../../../src/agents/prp-runtime.js';
import type { TaskOrchestrator } from '../../../src/core/task-orchestrator.js';
import type { SessionManager } from '../../../src/core/session-manager.js';
import type {
  PRPDocument,
  Backlog,
  Subtask,
} from '../../../src/core/models.js';
import type { ExecutionResult } from '../../../src/agents/prp-executor.js';

// Mock the prp-generator module
vi.mock('../../../src/agents/prp-generator.js', () => ({
  PRPGenerator: vi.fn(),
}));

// Mock the prp-executor module
vi.mock('../../../src/agents/prp-executor.js', () => ({
  PRPExecutor: vi.fn(),
}));

// Mock the node:fs/promises module
vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(),
  writeFile: vi.fn(),
}));

// Import mocked modules
import { PRPGenerator } from '../../../src/agents/prp-generator.js';
import { PRPExecutor } from '../../../src/agents/prp-executor.js';
import { mkdir, writeFile } from 'node:fs/promises';

// Cast mocked functions
const MockPRPGenerator = PRPGenerator as any;
const MockPRPExecutor = PRPExecutor as any;
const mockMkdir = mkdir as any;
const mockWriteFile = writeFile as any;

// Factory functions for test data
const createMockSessionManager = (sessionPath: string): SessionManager => {
  return {
    currentSession: {
      metadata: {
        id: '001_14b9dc2a33c7',
        hash: '14b9dc2a33c7',
        path: sessionPath,
        createdAt: new Date(),
        parentSession: null,
      },
      prdSnapshot: '# PRD Content',
      taskRegistry: { backlog: [] },
      currentItemId: null,
    },
  } as SessionManager;
};

const createMockTaskOrchestrator = (
  sessionManager: SessionManager
): TaskOrchestrator => {
  return {
    sessionManager,
    setStatus: vi.fn().mockResolvedValue(undefined),
  } as any as TaskOrchestrator;
};

const createMockSubtask = (id: string, title: string): Subtask => ({
  id,
  type: 'Subtask',
  title,
  status: 'Planned',
  story_points: 3,
  dependencies: [],
  context_scope: 'Implement the feature',
});

const createMockBacklog = (): Backlog => ({
  backlog: [],
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

const createMockExecutionResult = (success: boolean): ExecutionResult => ({
  success,
  validationResults: [
    {
      level: 1,
      description: 'Syntax check',
      success: true,
      command: 'npm run lint',
      stdout: '',
      stderr: '',
      exitCode: 0,
      skipped: false,
    },
  ],
  artifacts: ['/path/to/file.ts'],
  error: success ? undefined : 'Validation failed',
  fixAttempts: 0,
});

describe('agents/prp-runtime', () => {
  const sessionPath = '/tmp/test-session';
  let mockSessionManager: SessionManager;
  let mockOrchestrator: TaskOrchestrator;
  let mockGenerator: any;
  let mockExecutor: any;

  beforeEach(() => {
    // Setup mock session manager
    mockSessionManager = createMockSessionManager(sessionPath);

    // Setup mock orchestrator
    mockOrchestrator = createMockTaskOrchestrator(mockSessionManager);

    // Setup mock PRPGenerator
    mockGenerator = {
      generate: vi.fn().mockResolvedValue(createMockPRPDocument('P1.M2.T2.S2')),
    };
    MockPRPGenerator.mockImplementation(() => mockGenerator);

    // Setup mock PRPExecutor
    mockExecutor = {
      execute: vi.fn().mockResolvedValue(createMockExecutionResult(true)),
    };
    MockPRPExecutor.mockImplementation(() => mockExecutor);

    // Setup file system mocks
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create PRPRuntime with orchestrator', () => {
      // EXECUTE
      const runtime = new PRPRuntime(mockOrchestrator);

      // VERIFY: Runtime was created
      expect(runtime).toBeInstanceOf(PRPRuntime);
    });

    it('should extract session path from orchestrator', () => {
      // EXECUTE
      new PRPRuntime(mockOrchestrator);

      // VERIFY: PRPGenerator was instantiated with sessionManager
      expect(MockPRPGenerator).toHaveBeenCalledWith(
        mockSessionManager,
        false,
        expect.any(Number),
        expect.any(String)
      );

      // VERIFY: PRPExecutor was instantiated with sessionPath
      expect(MockPRPExecutor).toHaveBeenCalledWith(sessionPath);
    });

    it('should throw error when no active session', () => {
      // SETUP: Orchestrator with null current session
      const emptySessionManager = { currentSession: null } as SessionManager;
      const emptyOrchestrator = {
        sessionManager: emptySessionManager,
      } as any as TaskOrchestrator;

      // EXECUTE & VERIFY: Constructor throws
      expect(() => new PRPRuntime(emptyOrchestrator)).toThrow(
        'Cannot create PRPRuntime: no active session'
      );
    });
  });

  describe('executeSubtask', () => {
    it('should set status to Researching then Implementing then Complete on success', async () => {
      // SETUP
      const subtask = createMockSubtask('P1.M2.T2.S2', 'Test Subtask');
      const backlog = createMockBacklog();
      const mockPRP = createMockPRPDocument(subtask.id);
      const mockResult = createMockExecutionResult(true);

      mockGenerator.generate.mockResolvedValue(mockPRP);
      mockExecutor.execute.mockResolvedValue(mockResult);

      const runtime = new PRPRuntime(mockOrchestrator);

      // EXECUTE
      const result = await runtime.executeSubtask(subtask, backlog);

      // VERIFY: Status progression
      expect(mockOrchestrator.setStatus).toHaveBeenNthCalledWith(
        1,
        subtask.id,
        'Researching',
        'Starting PRP generation'
      );
      expect(mockOrchestrator.setStatus).toHaveBeenNthCalledWith(
        2,
        subtask.id,
        'Implementing',
        'Starting PRP execution'
      );
      expect(mockOrchestrator.setStatus).toHaveBeenNthCalledWith(
        3,
        subtask.id,
        'Complete',
        'Implementation completed successfully'
      );

      // VERIFY: Result is returned
      expect(result).toEqual(mockResult);
      expect(result.success).toBe(true);
    });

    it('should call PRPGenerator.generate() with subtask and backlog', async () => {
      // SETUP
      const subtask = createMockSubtask('P1.M2.T2.S2', 'Test Subtask');
      const backlog = createMockBacklog();
      const mockPRP = createMockPRPDocument(subtask.id);

      mockGenerator.generate.mockResolvedValue(mockPRP);

      const runtime = new PRPRuntime(mockOrchestrator);

      // EXECUTE
      await runtime.executeSubtask(subtask, backlog);

      // VERIFY: generate was called with correct parameters
      expect(mockGenerator.generate).toHaveBeenCalledTimes(1);
      expect(mockGenerator.generate).toHaveBeenCalledWith(subtask, backlog);
    });

    it('should call PRPExecutor.execute() with PRP and correct path', async () => {
      // SETUP
      const subtask = createMockSubtask('P1.M2.T2.S2', 'Test Subtask');
      const backlog = createMockBacklog();
      const mockPRP = createMockPRPDocument(subtask.id);
      const mockResult = createMockExecutionResult(true);

      mockGenerator.generate.mockResolvedValue(mockPRP);
      mockExecutor.execute.mockResolvedValue(mockResult);

      const runtime = new PRPRuntime(mockOrchestrator);

      // EXECUTE
      await runtime.executeSubtask(subtask, backlog);

      // VERIFY: execute was called with PRP and sanitized path (dots → underscores)
      expect(mockExecutor.execute).toHaveBeenCalledTimes(1);
      expect(mockExecutor.execute).toHaveBeenCalledWith(
        mockPRP,
        `${sessionPath}/prps/P1_M2_T2_S2.md`
      );
    });

    it('should create artifacts directory with correct path', async () => {
      // SETUP
      const subtask = createMockSubtask('P1.M2.T2.S2', 'Test Subtask');
      const backlog = createMockBacklog();
      const mockPRP = createMockPRPDocument(subtask.id);
      const mockResult = createMockExecutionResult(true);

      mockGenerator.generate.mockResolvedValue(mockPRP);
      mockExecutor.execute.mockResolvedValue(mockResult);

      const runtime = new PRPRuntime(mockOrchestrator);

      // EXECUTE
      await runtime.executeSubtask(subtask, backlog);

      // VERIFY: Artifacts directory was created
      expect(mockMkdir).toHaveBeenCalledWith(
        `${sessionPath}/artifacts/${subtask.id}`,
        { recursive: true }
      );
    });

    it('should write execution artifacts to artifacts directory', async () => {
      // SETUP
      const subtask = createMockSubtask('P1.M2.T2.S2', 'Test Subtask');
      const backlog = createMockBacklog();
      const mockPRP = createMockPRPDocument(subtask.id);
      const mockResult = createMockExecutionResult(true);

      mockGenerator.generate.mockResolvedValue(mockPRP);
      mockExecutor.execute.mockResolvedValue(mockResult);

      const runtime = new PRPRuntime(mockOrchestrator);

      // EXECUTE
      await runtime.executeSubtask(subtask, backlog);

      // VERIFY: Artifacts were written
      const artifactsDir = `${sessionPath}/artifacts/${subtask.id}`;
      expect(mockWriteFile).toHaveBeenCalledWith(
        `${artifactsDir}/validation-results.json`,
        expect.any(String),
        { mode: 0o644 }
      );
      expect(mockWriteFile).toHaveBeenCalledWith(
        `${artifactsDir}/execution-summary.md`,
        expect.any(String),
        { mode: 0o644 }
      );
      expect(mockWriteFile).toHaveBeenCalledWith(
        `${artifactsDir}/artifacts-list.json`,
        expect.any(String),
        { mode: 0o644 }
      );
    });

    it('should pass through the issue outcome from the executor (no behavior change)', async () => {
      // SETUP
      const subtask = createMockSubtask('P1.M2.T2.S2', 'Test Subtask');
      const backlog = createMockBacklog();
      const issueResult: ExecutionResult = {
        success: false,
        outcome: 'issue',
        issueMessage: 'missing context for endpoint contract',
        validationResults: [],
        artifacts: [],
        error: 'missing context for endpoint contract',
        fixAttempts: 0,
      };

      mockGenerator.generate.mockResolvedValue(
        createMockPRPDocument(subtask.id)
      );
      mockExecutor.execute.mockResolvedValue(issueResult);

      const runtime = new PRPRuntime(mockOrchestrator);

      // EXECUTE
      const result = await runtime.executeSubtask(subtask, backlog);

      // VERIFY: outcome is passed through unchanged
      expect(result.outcome).toBe('issue');
      expect(result.issueMessage).toBe('missing context for endpoint contract');

      // VERIFY: S4 BOUNDARY — runtime STILL sets Failed
      // (issue→Planned reset is the orchestrator's job, not S2)
      expect(mockOrchestrator.setStatus).toHaveBeenCalledWith(
        subtask.id,
        'Failed',
        expect.any(String)
      );
    });

    it('should set status to Failed when execution result is not successful', async () => {
      // SETUP
      const subtask = createMockSubtask('P1.M2.T2.S2', 'Test Subtask');
      const backlog = createMockBacklog();
      const mockPRP = createMockPRPDocument(subtask.id);
      const mockResult = createMockExecutionResult(false);

      mockGenerator.generate.mockResolvedValue(mockPRP);
      mockExecutor.execute.mockResolvedValue(mockResult);

      const runtime = new PRPRuntime(mockOrchestrator);

      // EXECUTE
      const result = await runtime.executeSubtask(subtask, backlog);

      // VERIFY: Status set to Failed
      expect(mockOrchestrator.setStatus).toHaveBeenCalledWith(
        subtask.id,
        'Failed',
        mockResult.error ?? 'Execution failed'
      );

      // VERIFY: Result is returned
      expect(result.success).toBe(false);
    });

    it('should set status to Failed when PRP generation throws error', async () => {
      // SETUP
      const subtask = createMockSubtask('P1.M2.T2.S2', 'Test Subtask');
      const backlog = createMockBacklog();

      mockGenerator.generate.mockRejectedValue(
        new Error('LLM service unavailable')
      );

      const runtime = new PRPRuntime(mockOrchestrator);

      // EXECUTE
      const result = await runtime.executeSubtask(subtask, backlog);

      // VERIFY: Status set to Failed
      expect(mockOrchestrator.setStatus).toHaveBeenCalledWith(
        subtask.id,
        'Failed',
        'Execution failed: LLM service unavailable'
      );

      // VERIFY: Returns failed result
      expect(result.success).toBe(false);
      expect(result.error).toBe('LLM service unavailable');
    });

    it('should set status to Failed when PRP execution throws error', async () => {
      // SETUP
      const subtask = createMockSubtask('P1.M2.T2.S2', 'Test Subtask');
      const backlog = createMockBacklog();
      const mockPRP = createMockPRPDocument(subtask.id);

      mockGenerator.generate.mockResolvedValue(mockPRP);
      mockExecutor.execute.mockRejectedValue(new Error('Coder agent timeout'));

      const runtime = new PRPRuntime(mockOrchestrator);

      // EXECUTE
      const result = await runtime.executeSubtask(subtask, backlog);

      // VERIFY: Status set to Failed
      expect(mockOrchestrator.setStatus).toHaveBeenCalledWith(
        subtask.id,
        'Failed',
        'Execution failed: Coder agent timeout'
      );

      // VERIFY: Returns failed result
      expect(result.success).toBe(false);
      expect(result.error).toBe('Coder agent timeout');
    });

    it('should not fail when artifact writing throws error', async () => {
      // SETUP
      const subtask = createMockSubtask('P1.M2.T2.S2', 'Test Subtask');
      const backlog = createMockBacklog();
      const mockPRP = createMockPRPDocument(subtask.id);
      const mockResult = createMockExecutionResult(true);

      mockGenerator.generate.mockResolvedValue(mockPRP);
      mockExecutor.execute.mockResolvedValue(mockResult);
      mockWriteFile.mockRejectedValue(new Error('Disk full'));

      const runtime = new PRPRuntime(mockOrchestrator);

      // EXECUTE
      const result = await runtime.executeSubtask(subtask, backlog);

      // VERIFY: Status still set to Complete (artifact errors are logged but don't fail execution)
      expect(mockOrchestrator.setStatus).toHaveBeenCalledWith(
        subtask.id,
        'Complete',
        'Implementation completed successfully'
      );

      // VERIFY: Result is still successful
      expect(result.success).toBe(true);
    });
  });

  describe('PRPRuntimeError', () => {
    it('should create error with correct properties for Research phase', () => {
      // EXECUTE
      const originalError = new Error('LLM failed');
      const error = new PRPRuntimeError(
        'P1.M2.T2.S1',
        'Research',
        originalError
      );

      // VERIFY: Error has correct properties
      expect(error.name).toBe('PRPRuntimeError');
      expect(error.subtaskId).toBe('P1.M2.T2.S1');
      expect(error.phase).toBe('Research');
      expect(error.message).toContain('P1.M2.T2.S1');
      expect(error.message).toContain('Research');
      expect(error.message).toContain('LLM failed');
    });

    it('should create error with correct properties for Implementation phase', () => {
      // EXECUTE
      const originalError = new Error('Coder failed');
      const error = new PRPRuntimeError(
        'P1.M2.T2.S1',
        'Implementation',
        originalError
      );

      // VERIFY: Error has correct properties
      expect(error.name).toBe('PRPRuntimeError');
      expect(error.subtaskId).toBe('P1.M2.T2.S1');
      expect(error.phase).toBe('Implementation');
      expect(error.message).toContain('P1.M2.T2.S1');
      expect(error.message).toContain('Implementation');
      expect(error.message).toContain('Coder failed');
    });

    it('should handle non-Error objects as originalError', () => {
      // EXECUTE
      const originalError = 'String error message';
      const error = new PRPRuntimeError(
        'P1.M2.T2.S1',
        'Research',
        originalError
      );

      // VERIFY: Error message contains string representation
      expect(error.message).toContain('String error message');
    });
  });

  describe('execution summary formatting', () => {
    it('should format successful execution summary', async () => {
      // SETUP
      const subtask = createMockSubtask('P1.M2.T2.S2', 'Test Subtask');
      const backlog = createMockBacklog();
      const mockPRP = createMockPRPDocument(subtask.id);
      const mockResult: ExecutionResult = {
        success: true,
        validationResults: [
          {
            level: 1,
            description: 'Syntax check',
            success: true,
            command: 'npm run lint',
            stdout: 'All good',
            stderr: '',
            exitCode: 0,
            skipped: false,
          },
        ],
        artifacts: ['/src/file.ts'],
        error: undefined,
        fixAttempts: 0,
      };

      mockGenerator.generate.mockResolvedValue(mockPRP);
      mockExecutor.execute.mockResolvedValue(mockResult);

      const runtime = new PRPRuntime(mockOrchestrator);

      // EXECUTE
      await runtime.executeSubtask(subtask, backlog);

      // VERIFY: Summary contains expected content
      const writeCall = mockWriteFile.mock.calls.find((call: string[]) =>
        call[0].includes('execution-summary.md')
      );
      const summary = writeCall?.[1];

      expect(summary).toContain('# Execution Summary');
      expect(summary).toContain('**Status**: Success');
      expect(summary).toContain('**Fix Attempts**: 0');
      expect(summary).toContain('### Level 1: Syntax check');
      expect(summary).toContain('- Status: PASSED');
      expect(summary).toContain('- Command: npm run lint');
      expect(summary).toContain('## Artifacts');
      expect(summary).toContain('- /src/file.ts');
    });

    it('should format failed execution summary', async () => {
      // SETUP
      const subtask = createMockSubtask('P1.M2.T2.S2', 'Test Subtask');
      const backlog = createMockBacklog();
      const mockPRP = createMockPRPDocument(subtask.id);
      const mockResult: ExecutionResult = {
        success: false,
        validationResults: [
          {
            level: 1,
            description: 'Syntax check',
            success: false,
            command: 'npm run lint',
            stdout: '',
            stderr: 'Syntax error at line 10',
            exitCode: 1,
            skipped: false,
          },
        ],
        artifacts: [],
        error: 'Validation failed',
        fixAttempts: 2,
      };

      mockGenerator.generate.mockResolvedValue(mockPRP);
      mockExecutor.execute.mockResolvedValue(mockResult);

      const runtime = new PRPRuntime(mockOrchestrator);

      // EXECUTE
      await runtime.executeSubtask(subtask, backlog);

      // VERIFY: Summary contains failure details
      const writeCall = mockWriteFile.mock.calls.find((call: string[]) =>
        call[0].includes('execution-summary.md')
      );
      const summary = writeCall?.[1];

      expect(summary).toContain('**Status**: Failed');
      expect(summary).toContain('**Error**: Validation failed');
      expect(summary).toContain('**Fix Attempts**: 2');
      expect(summary).toContain('- Status: FAILED');
      expect(summary).toContain('- Exit Code: 1');
      expect(summary).toContain('- Error: Syntax error at line 10');
    });
  });
});
