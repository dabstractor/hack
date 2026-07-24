/**
 * Integration tests for PRPRuntime class
 *
 * @remarks
 * Tests the complete flow: SessionManager + TaskOrchestrator + PRPRuntime
 * Uses real PRPGenerator but mocks Agent.prompt() calls to avoid making real LLM calls.
 * Mocks PRPExecutor.execute() to avoid running real validation commands.
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { PRPRuntime } from '../../src/agents/prp-runtime.js';
import { SessionManager } from '../../src/core/session-manager.js';
import { TaskOrchestrator } from '../../src/core/task-orchestrator.js';
import { PRPDocumentSchema, type Backlog } from '../../src/core/models.js';
import {
  createResearcherAgent,
  createCoderAgent,
} from '../../src/agents/agent-factory.js';
import type { ExecutionResult } from '../../src/agents/prp-executor.js';

// Mock node:fs/promises for PRP and artifact file operations
vi.mock('node:fs/promises', async () => {
  const actualFs = await vi.importActual('node:fs/promises');
  return {
    ...actualFs,
    // Mock mkdir and writeFile for PRP and artifact operations
    mkdir: vi.fn((path: string, options: any) => {
      // Check if this is a PRP or artifacts directory operation
      if (
        path &&
        (path.toString().includes('prps') ||
          path.toString().includes('artifacts'))
      ) {
        return Promise.resolve(undefined);
      }
      // Use real mkdir for test setup
      return actualFs.mkdir(path, options);
    }),
    writeFile: vi.fn((path: string, data: any, options: any) => {
      // Check if this is a PRP or artifacts file write operation
      if (
        path &&
        (path.toString().includes('prps') ||
          path.toString().includes('artifacts'))
      ) {
        return Promise.resolve(undefined);
      }
      // Use real writeFile for test setup
      return actualFs.writeFile(path, data, options);
    }),
  };
});

// Import mocked functions
const mockMkdir = mkdir as any;
const mockWriteFile = writeFile as any;

// Test data factory
const createTestBacklog = (): Backlog => ({
  backlog: [
    {
      id: 'P3',
      type: 'Phase',
      title: 'Phase 3: PRP Pipeline',
      status: 'Planned',
      description: 'Implement PRP generation and execution',
      milestones: [
        {
          id: 'P3.M3',
          type: 'Milestone',
          title: 'Milestone 3: PRP Runtime',
          status: 'Planned',
          description: 'Integrate PRP generation and execution',
          tasks: [
            {
              id: 'P3.M3.T1',
              type: 'Task',
              title: 'Create PRP Runtime',
              status: 'Planned',
              description: 'Implement PRPRuntime class',
              subtasks: [
                {
                  id: 'P3.M3.T1.S3',
                  type: 'Subtask',
                  title: 'Integrate PRP Generation and Execution',
                  status: 'Planned',
                  story_points: 8,
                  dependencies: [],
                  context_scope: 'Implement PRPRuntime with orchestration',
                },
              ],
            },
          ],
        },
      ],
    },
  ],
});

const createMockPRPDocument = (taskId: string) => ({
  taskId,
  objective: 'Implement PRPRuntime class',
  context: '## Context\nFull implementation context for PRPRuntime',
  implementationSteps: [
    'Step 1: Create PRPRuntime class',
    'Step 2: Add orchestration logic',
  ],
  validationGates: [
    { level: 1, description: 'Lint', command: 'npm run lint', manual: false },
    { level: 2, description: 'Test', command: 'npm test', manual: false },
    {
      level: 3,
      description: 'Integration',
      command: 'npm run test:integration',
      manual: false,
    },
    { level: 4, description: 'Manual', command: null, manual: true },
  ],
  successCriteria: [
    { description: 'Orchestration works', satisfied: false },
    { description: 'Tests pass', satisfied: false },
  ],
  references: ['src/agents/prp-runtime.ts'],
});

const createMockExecutionResult = (success: boolean): ExecutionResult => ({
  success,
  validationResults: [
    {
      level: 1,
      description: 'Syntax check',
      success,
      command: 'npm run lint',
      stdout: 'All good',
      stderr: success ? '' : 'Lint errors found',
      exitCode: success ? 0 : 1,
      skipped: false,
      timedOut: false,
    },
  ],
  artifacts: ['/src/agents/prp-runtime.ts'],
  error: success ? undefined : 'Validation failed',
  fixAttempts: 0,
});

// Mock agent-factory to avoid MCP server registration issues
vi.mock('../../src/agents/agent-factory.js', () => ({
  createResearcherAgent: vi.fn(),
  createCoderAgent: vi.fn(),
}));

// Mock PRPExecutor to avoid running real validation commands
// Create a mock that can be controlled per test
let mockPRPExecutorExecute = vi
  .fn()
  .mockResolvedValue(createMockExecutionResult(true));

vi.mock('../../src/agents/prp-executor.js', () => ({
  PRPExecutor: vi.fn().mockImplementation(() => ({
    execute: mockPRPExecutorExecute,
  })),
}));

describe('integration/prp-runtime', () => {
  let tempDir: string;
  let prdPath: string;
  let planDir: string;
  let sessionManager: SessionManager;
  let orchestrator: TaskOrchestrator;

  beforeEach(async () => {
    // Reset PRPExecutor mock for each test
    mockPRPExecutorExecute = vi
      .fn()
      .mockResolvedValue(createMockExecutionResult(true));
    vi.doMock('../../src/agents/prp-executor.js', () => ({
      PRPExecutor: vi.fn().mockImplementation(() => ({
        execute: mockPRPExecutorExecute,
      })),
    }));

    // Create unique temp directory for each test
    const uniqueId = randomBytes(8).toString('hex');
    tempDir = join(tmpdir(), `prp-runtime-test-${uniqueId}`);
    planDir = join(tempDir, 'plan');
    prdPath = join(tempDir, 'PRD.md');

    // Clear mock calls before each test
    mockWriteFile.mockClear();
    mockMkdir.mockClear();

    // Create test PRD file with unique content to avoid finding existing sessions
    const testPRD = `# Test PRD ${uniqueId}

This is a unique test PRD for PRPRuntime integration tests with ID: ${uniqueId}.`;
    // Use real writeFile for test setup
    const fs = await import('node:fs/promises');
    await fs.mkdir(tempDir, { recursive: true });
    await fs.writeFile(prdPath, testPRD);

    // Initialize SessionManager with test PRD and custom plan directory
    sessionManager = new SessionManager(prdPath, planDir, 3);
    await sessionManager.initialize();

    // Write test backlog to session tasks.json
    const testBacklog = createTestBacklog();
    const tasksPath = join(
      sessionManager.currentSession!.metadata.path,
      'tasks.json'
    );
    await fs.writeFile(tasksPath, JSON.stringify(testBacklog, null, 2));

    // Reload session to pick up tasks.json
    await sessionManager.loadSession(
      sessionManager.currentSession!.metadata.path
    );

    // Initialize TaskOrchestrator
    orchestrator = new TaskOrchestrator(sessionManager);

    // Setup mock agents
    const mockResearcherAgent = {
      prompt: vi.fn().mockResolvedValue(createMockPRPDocument('P3.M3.T1.S3')),
    };
    (createResearcherAgent as any).mockReturnValue(mockResearcherAgent);

    const mockCoderAgent = {
      prompt: vi.fn().mockResolvedValue(
        JSON.stringify({
          result: 'success',
          message: 'Implementation completed',
        })
      ),
    };
    (createCoderAgent as any).mockReturnValue(mockCoderAgent);
  });

  afterEach(async () => {
    // Clean up temp directory
    const fs = await import('node:fs/promises');
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
    // Clear all mocks between tests
    vi.clearAllMocks();
  });

  describe('constructor integration', () => {
    it('should create PRPRuntime with TaskOrchestrator', async () => {
      // EXECUTE
      const runtime = new PRPRuntime(orchestrator);

      // VERIFY: Runtime was created
      expect(runtime).toBeInstanceOf(PRPRuntime);
    });

    it('should extract session path from orchestrator', async () => {
      // EXECUTE
      new PRPRuntime(orchestrator);

      // VERIFY: Session path matches the orchestrator's session path
      const sessionPath = sessionManager.currentSession!.metadata.path;
      // Runtime constructor creates generator and executor which use the session path
      expect(sessionPath).toMatch(/plan\/\d{3}_[a-f0-9]{12}$/);
    });
  });

  describe('full orchestration flow', () => {
    it('should execute subtask through complete inner loop', async () => {
      // SETUP: Get test subtask and backlog
      const backlog = sessionManager.currentSession!.taskRegistry;
      const subtask = backlog.backlog[0].milestones[0].tasks[0].subtasks[0];

      // EXECUTE: Run complete orchestration
      const runtime = new PRPRuntime(orchestrator);
      const result = await runtime.executeSubtask(subtask, backlog);

      // VERIFY: Result is successful
      expect(result.success).toBe(true);
      expect(result.validationResults).toBeDefined();
      expect(result.artifacts).toBeDefined();
    });

    it('should create artifacts directory with correct structure', async () => {
      // SETUP: Get test subtask and backlog
      const backlog = sessionManager.currentSession!.taskRegistry;
      const subtask = backlog.backlog[0].milestones[0].tasks[0].subtasks[0];

      // EXECUTE: Run complete orchestration
      const runtime = new PRPRuntime(orchestrator);
      await runtime.executeSubtask(subtask, backlog);

      // VERIFY: Artifacts directory was created
      const sessionPath = sessionManager.currentSession!.metadata.path;
      const artifactsDir = join(sessionPath, 'artifacts', subtask.id);
      expect(mockMkdir).toHaveBeenCalledWith(artifactsDir, { recursive: true });

      // VERIFY: Artifact files were written
      expect(mockWriteFile).toHaveBeenCalledWith(
        join(artifactsDir, 'validation-results.json'),
        expect.any(String),
        { mode: 0o644 }
      );
      expect(mockWriteFile).toHaveBeenCalledWith(
        join(artifactsDir, 'execution-summary.md'),
        expect.any(String),
        { mode: 0o644 }
      );
      expect(mockWriteFile).toHaveBeenCalledWith(
        join(artifactsDir, 'artifacts-list.json'),
        expect.any(String),
        { mode: 0o644 }
      );
    });

    it('should write PRP file with correct name', async () => {
      // SETUP: Get test subtask and backlog
      const backlog = sessionManager.currentSession!.taskRegistry;
      const subtask = backlog.backlog[0].milestones[0].tasks[0].subtasks[0];

      // EXECUTE: Run complete orchestration
      const runtime = new PRPRuntime(orchestrator);
      await runtime.executeSubtask(subtask, backlog);

      // VERIFY: PRP file was written with sanitized name (dots → underscores)
      const prpCall = mockWriteFile.mock.calls.find(
        (call: any[]) => call[0] && call[0].toString().includes('prps')
      );
      expect(prpCall).toBeDefined();
      expect(prpCall![0]).toContain('P3_M3_T1_S3.md');
    });
  });

  describe('status progression', () => {
    it('should progress status through Researching → Implementing → Complete', async () => {
      // SETUP: Get test subtask and backlog
      const backlog = sessionManager.currentSession!.taskRegistry;
      const subtask = backlog.backlog[0].milestones[0].tasks[0].subtasks[0];

      // Spy on orchestrator.setStatus to track status changes
      const setStatusSpy = vi.spyOn(orchestrator, 'setStatus');

      // EXECUTE: Run complete orchestration
      const runtime = new PRPRuntime(orchestrator);
      await runtime.executeSubtask(subtask, backlog);

      // VERIFY: Status progression
      expect(setStatusSpy).toHaveBeenNthCalledWith(
        1,
        subtask.id,
        'Researching',
        'Starting PRP generation'
      );
      expect(setStatusSpy).toHaveBeenNthCalledWith(
        2,
        subtask.id,
        'Implementing',
        'Starting PRP execution'
      );
      expect(setStatusSpy).toHaveBeenNthCalledWith(
        3,
        subtask.id,
        'Complete',
        'Implementation completed successfully'
      );
    });

    it('should set status to Failed on execution failure', async () => {
      // SETUP: Get test subtask and backlog
      const backlog = sessionManager.currentSession!.taskRegistry;
      const subtask = backlog.backlog[0].milestones[0].tasks[0].subtasks[0];

      // Configure mock PRPExecutor to return failed result
      mockPRPExecutorExecute.mockResolvedValueOnce(
        createMockExecutionResult(false)
      );

      // Spy on orchestrator.setStatus to track status changes
      const setStatusSpy = vi.spyOn(orchestrator, 'setStatus');

      // EXECUTE: Run complete orchestration
      const runtime = new PRPRuntime(orchestrator);
      const result = await runtime.executeSubtask(subtask, backlog);

      // VERIFY: Result is failed
      expect(result.success).toBe(false);

      // VERIFY: Final status is Failed
      const lastCall = setStatusSpy.mock.calls.at(-1);
      expect(lastCall?.[1]).toBe('Failed');
    });
  });

  describe('error handling', () => {
    it('should handle PRP generation failure gracefully', async () => {
      // SETUP: Get test subtask and backlog
      const backlog = sessionManager.currentSession!.taskRegistry;
      const subtask = backlog.backlog[0].milestones[0].tasks[0].subtasks[0];

      // Setup mock researcher agent to fail
      const mockResearcherAgent = {
        prompt: vi.fn().mockRejectedValue(new Error('LLM service down')),
      };
      (createResearcherAgent as any).mockReturnValue(mockResearcherAgent);

      // EXECUTE: Run complete orchestration
      const runtime = new PRPRuntime(orchestrator);
      const result = await runtime.executeSubtask(subtask, backlog);

      // VERIFY: Result is failed
      expect(result.success).toBe(false);
      expect(result.error).toContain('LLM service down');
    });

    it('should handle PRP execution failure gracefully', async () => {
      // SETUP: Get test subtask and backlog
      const backlog = sessionManager.currentSession!.taskRegistry;
      const subtask = backlog.backlog[0].milestones[0].tasks[0].subtasks[0];

      // Configure mock PRPExecutor to throw error
      mockPRPExecutorExecute.mockRejectedValueOnce(
        new Error('Coder agent timeout')
      );

      // EXECUTE: Run complete orchestration
      const runtime = new PRPRuntime(orchestrator);
      const result = await runtime.executeSubtask(subtask, backlog);

      // VERIFY: Result is failed
      expect(result.success).toBe(false);
      expect(result.error).toBe('Coder agent timeout');
    });

    it('should not fail execution when artifact writing fails', async () => {
      // SETUP: Get test subtask and backlog
      const backlog = sessionManager.currentSession!.taskRegistry;
      const subtask = backlog.backlog[0].milestones[0].tasks[0].subtasks[0];

      // Setup writeFile to fail for artifacts directory
      mockWriteFile.mockImplementation(function (
        path: string,
        data: any,
        options: any
      ) {
        if (path && path.toString().includes('artifacts')) {
          return Promise.reject(new Error('Disk full'));
        }
        if (path && path.toString().includes('prps')) {
          return Promise.resolve(undefined);
        }
        // Use real writeFile for test setup
        const fs = require('node:fs/promises'); // eslint-disable-line @typescript-eslint/no-var-requires
        return fs.writeFile(path, data, options);
      });

      // EXECUTE: Run complete orchestration
      const runtime = new PRPRuntime(orchestrator);
      const result = await runtime.executeSubtask(subtask, backlog);

      // VERIFY: Execution still succeeds (artifact errors are logged but don't fail)
      expect(result.success).toBe(true);
    });
  });

  describe('execution summary formatting', () => {
    it('should write execution summary with correct format', async () => {
      // SETUP: Get test subtask and backlog
      const backlog = sessionManager.currentSession!.taskRegistry;
      const subtask = backlog.backlog[0].milestones[0].tasks[0].subtasks[0];

      // EXECUTE: Run complete orchestration
      const runtime = new PRPRuntime(orchestrator);
      await runtime.executeSubtask(subtask, backlog);

      // VERIFY: Summary contains expected content
      const summaryCall = mockWriteFile.mock.calls.find(
        (call: any[]) =>
          call[0] && call[0].toString().includes('execution-summary.md')
      );
      expect(summaryCall).toBeDefined();
      const summary = summaryCall ? summaryCall[1] : '';

      expect(summary).toContain('# Execution Summary');
      expect(summary).toContain('**Status**: Success');
      expect(summary).toContain('## Validation Results');
      expect(summary).toContain('## Artifacts');
    });
  });
});
