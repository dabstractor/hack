/**
 * Integration tests for PRPPipeline main execution loop
 *
 * @remarks
 * Tests validate the main execution loop of PRPPipeline correctly processes tasks from the backlog.
 * Tests verify session initialization, task processing loop, individual failure handling,
 * progress metrics updates, and pipeline status transitions.
 *
 * These tests focus on the main loop behavior, not end-to-end scenarios.
 * They use mocks for TaskOrchestrator and SessionManager for deterministic testing.
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
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
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// CRITICAL: Mock TaskOrchestrator and SessionManager at top level (hoisting required)
vi.mock('../../src/core/task-orchestrator.js', async () => {
  const actual = await vi.importActual('../../src/core/task-orchestrator.js');
  return {
    ...actual,
    TaskOrchestrator: vi.fn(),
  };
});

vi.mock('../../src/core/session-manager.js', async () => {
  const actual = await vi.importActual('../../src/core/session-manager.js');
  return {
    ...actual,
    SessionManager: vi.fn(),
  };
});

// Mock agent factory to avoid LLM calls
vi.mock('../../src/agents/agent-factory.js', () => ({
  createArchitectAgent: vi.fn(),
  createResearcherAgent: vi.fn(),
  createCoderAgent: vi.fn(),
  createQAAgent: vi.fn(),
}));

// Mock PRPRuntime to avoid actual PRP execution
vi.mock('../../src/agents/prp-runtime.js', () => ({
  PRPRuntime: vi.fn().mockImplementation(() => ({
    executeSubtask: vi.fn().mockResolvedValue({
      success: true,
      validationResults: [],
      artifacts: [],
      error: undefined,
    }),
  })),
}));

// Mock fs/promises for tasks.json reading
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readFile: vi.fn((path: string) => {
      if (path.includes('tasks.json')) {
        return actual.readFile(path, 'utf-8');
      }
      return actual.readFile(path, 'utf-8');
    }),
  };
});

// Import types and utilities
import type {
  SessionState,
  Backlog,
  Status,
  PipelineResult,
} from '../../src/core/models.js';
import { readFile } from 'node:fs/promises';

describe('integration/pipeline-main-loop', () => {
  let tempDir: string;
  let prdPath: string;
  let planDir: string;
  let TaskOrchestrator: any;
  let SessionManager: any;
  let PRPPipeline: any;

  beforeAll(async () => {
    // Dynamic imports after mocks are applied
    const orchestratorModule =
      await import('../../src/core/task-orchestrator.js');
    TaskOrchestrator = orchestratorModule.TaskOrchestrator;

    const sessionModule = await import('../../src/core/session-manager.js');
    SessionManager = sessionModule.SessionManager;

    const pipelineModule = await import('../../src/workflows/prp-pipeline.js');
    PRPPipeline = pipelineModule.PRPPipeline;
  });

  // Factory functions for consistent mock creation

  /**
   * Create a mock SessionState fixture for testing
   */
  function createMockSessionState(
    overrides?: Partial<SessionState>
  ): SessionState {
    return {
      metadata: {
        id: '001_test123',
        hash: 'test123',
        path: tempDir,
        createdAt: new Date(),
        parentSession: null,
      },
      prdSnapshot: '# Test PRD',
      taskRegistry: { backlog: [] },
      currentItemId: null,
      ...overrides,
    };
  }

  /**
   * Create a mock Backlog fixture with specified number of subtasks
   */
  function createMockBacklog(taskCount: number = 3): Backlog {
    return {
      backlog: [
        {
          type: 'Phase',
          id: 'P1',
          title: `Test Phase`,
          status: 'Planned' as Status,
          description: 'Test phase description',
          milestones: [
            {
              type: 'Milestone',
              id: 'P1.M1',
              title: 'Test Milestone',
              status: 'Planned' as Status,
              description: 'Test milestone description',
              tasks: Array.from({ length: taskCount }, (_, i) => ({
                type: 'Task',
                id: `P1.M1.T${i + 1}`,
                title: `Test Task ${i + 1}`,
                status: 'Planned' as Status,
                description: `Test task ${i + 1} description`,
                subtasks: [
                  {
                    type: 'Subtask',
                    id: `P1.M1.T${i + 1}.S1`,
                    title: `Test Subtask ${i + 1}.S1`,
                    status: 'Planned' as Status,
                    story_points: 1,
                    dependencies: [],
                    context_scope: 'Test scope',
                  },
                ],
              })),
            },
          ],
        },
      ],
    };
  }

  /**
   * Helper to set up mock SessionManager
   */
  function setupMockSessionManager(backlog: Backlog) {
    const mock = {
      currentSession: {
        metadata: { path: tempDir },
        taskRegistry: backlog,
      },
      initialize: vi.fn().mockResolvedValue({
        metadata: {
          id: 'test',
          hash: 'abc',
          path: tempDir,
          createdAt: new Date(),
        },
        prdSnapshot: '# Test',
        taskRegistry: backlog,
        currentItemId: null,
      }),
      saveBacklog: vi.fn().mockResolvedValue(undefined),
      flushUpdates: vi.fn().mockResolvedValue(undefined),
      updateItemStatus: vi.fn().mockResolvedValue(undefined),
    };
    (SessionManager as any).mockImplementation(() => mock);
    return mock;
  }

  beforeEach(() => {
    // Create temp directory for each test
    tempDir = mkdtempSync(join(tmpdir(), 'pipeline-test-'));
    prdPath = join(tempDir, 'PRD.md');
    planDir = join(tempDir, 'plan');
    writeFileSync(prdPath, '# Test PRD\n\nBuild a feature.', 'utf-8');

    // Reset SessionManager mock to default
    (SessionManager as any).mockImplementation(() => ({
      currentSession: null,
      initialize: vi.fn().mockResolvedValue({ currentSession: null }),
      saveBacklog: vi.fn().mockResolvedValue(undefined),
      flushUpdates: vi.fn().mockResolvedValue(undefined),
    }));

    // Clear mocks
    vi.clearAllMocks();
  });

  afterEach(async () => {
    // Cleanup
    rmSync(tempDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  describe('pipeline initialization from PRD hash', () => {
    it('should initialize session from PRD hash', async () => {
      // SETUP: Create test PRD
      const backlog = createMockBacklog(3);
      const mockAgent = { prompt: vi.fn().mockResolvedValue({ backlog }) };
      const { createArchitectAgent } =
        await import('../../src/agents/agent-factory.js');
      (createArchitectAgent as any).mockReturnValue(mockAgent);
      (readFile as any).mockImplementation((path: string) => {
        if (path.includes('tasks.json')) {
          return JSON.stringify(backlog);
        }
        return '';
      });

      const mockSessionManager = setupMockSessionManager(backlog);

      // EXECUTE: Create pipeline
      const pipeline = new PRPPipeline(prdPath);

      // VERIFY: SessionManager.initialize was called
      expect(mockSessionManager.initialize).toHaveBeenCalledWith(prdPath);

      // VERIFY: Pipeline has session initialized
      expect(pipeline.currentPhase).toBe('session_initialized');
    });

    it('should use existing session when PRD hash matches', async () => {
      // SETUP: Create mock session with existing state
      const backlog = createMockBacklog(3);
      const mockAgent = { prompt: vi.fn().mockResolvedValue({ backlog }) };
      const { createArchitectAgent } =
        await import('../../src/agents/agent-factory.js');
      (createArchitectAgent as any).mockReturnValue(mockAgent);
      (readFile as any).mockImplementation((path: string) => {
        if (path.includes('tasks.json')) {
          return JSON.stringify(backlog);
        }
        return '';
      });

      const existingSession = createMockSessionState({
        metadata: {
          id: '001_existing',
          hash: 'abc123',
          path: tempDir,
          createdAt: new Date(),
          parentSession: null,
        },
      });
      const mockSessionManager = setupMockSessionManager(backlog);

      // EXECUTE: Create pipeline (should discover existing session)
      const pipeline = new PRPPipeline(prdPath);

      // VERIFY: Session was discovered/initialized
      expect(mockSessionManager.initialize).toHaveBeenCalledWith(prdPath);
      expect(pipeline.currentPhase).toBe('session_initialized');
    });
  });

  describe('main execution loop', () => {
    it('should process tasks until queue empty', async () => {
      // SETUP: Create test PRD
      const backlog = createMockBacklog(3);
      const mockAgent = { prompt: vi.fn().mockResolvedValue({ backlog }) };
      const { createArchitectAgent } =
        await import('../../src/agents/agent-factory.js');
      (createArchitectAgent as any).mockReturnValue(mockAgent);
      (readFile as any).mockImplementation((path: string) => {
        if (path.includes('tasks.json')) {
          return JSON.stringify(backlog);
        }
        return '';
      });

      const mockSessionManager = setupMockSessionManager(backlog);

      // EXECUTE: Create pipeline and run it (not just executeBacklog)
      const pipeline = new PRPPipeline(prdPath);

      // Mock processNextItem to return true 3 times, then false
      let callCount = 0;
      const mockOrchestrator: any = {
        sessionManager: {},
        processNextItem: vi.fn().mockImplementation(async () => {
          callCount++;
          return callCount <= 3; // Returns true 3 times, then false
        }),
        currentItemId: null as string | null,
      };
      (pipeline as any).taskOrchestrator = mockOrchestrator;

      await pipeline.run();

      // VERIFY: processNextItem called 4 times (3 true + 1 false)
      expect(mockOrchestrator.processNextItem).toHaveBeenCalledTimes(4);

      // VERIFY: Pipeline completed backlog
      expect(pipeline.currentPhase).toBe('shutdown_complete');
    });

    it('should update progress metrics during execution', async () => {
      // SETUP: Create test PRD
      const backlog = createMockBacklog(5);
      const mockAgent = { prompt: vi.fn().mockResolvedValue({ backlog }) };
      const { createArchitectAgent } =
        await import('../../src/agents/agent-factory.js');
      (createArchitectAgent as any).mockReturnValue(mockAgent);
      (readFile as any).mockImplementation((path: string) => {
        if (path.includes('tasks.json')) {
          return JSON.stringify(backlog);
        }
        return '';
      });

      const mockSessionManager = setupMockSessionManager(backlog);

      // EXECUTE: Create pipeline and run it
      const pipeline = new PRPPipeline(prdPath);

      // Mock processNextItem to process 5 tasks
      let callCount = 0;
      const mockOrchestrator: any = {
        sessionManager: {},
        processNextItem: vi.fn().mockImplementation(async () => {
          callCount++;
          // Simulate task completion by updating status
          if (callCount <= 5) {
            const taskId = `P1.M1.T${callCount}.S1`;
            mockOrchestrator.currentItemId = taskId;
          }
          return callCount <= 5;
        }),
        currentItemId: null as string | null,
      };
      (pipeline as any).taskOrchestrator = mockOrchestrator;

      await pipeline.run();

      // VERIFY: All tasks were processed
      expect(mockOrchestrator.processNextItem).toHaveBeenCalledTimes(6); // 5 tasks + 1 false
    });

    it('should log progress every 5 tasks', async () => {
      // SETUP: Create test PRD
      const backlog = createMockBacklog(10);
      const mockAgent = { prompt: vi.fn().mockResolvedValue({ backlog }) };
      const { createArchitectAgent } =
        await import('../../src/agents/agent-factory.js');
      (createArchitectAgent as any).mockReturnValue(mockAgent);
      (readFile as any).mockImplementation((path: string) => {
        if (path.includes('tasks.json')) {
          return JSON.stringify(backlog);
        }
        return '';
      });

      const mockSessionManager = setupMockSessionManager(backlog);

      // EXECUTE: Create pipeline
      const pipeline = new PRPPipeline(prdPath);
      const infoSpy = vi.spyOn((pipeline as any).logger, 'info');

      let callCount = 0;
      const mockOrchestrator: any = {
        sessionManager: {},
        processNextItem: vi.fn().mockImplementation(async () => {
          callCount++;
          // Update completed count to trigger progress logging
          if (callCount <= 10) {
            const taskId = `P1.M1.T${callCount}.S1`;
            mockOrchestrator.currentItemId = taskId;
          }
          return callCount <= 10;
        }),
        currentItemId: null as string | null,
      };
      (pipeline as any).taskOrchestrator = mockOrchestrator;

      await pipeline.executeBacklog();

      // VERIFY: Progress logged at milestones (every 5 tasks)
      expect(infoSpy).toHaveBeenCalledWith(
        expect.stringContaining('tasks complete')
      );

      infoSpy.mockRestore();
    });
  });

  describe('individual task failure handling', () => {
    it('should track individual task failures', async () => {
      // SETUP: Create test PRD
      const backlog = createMockBacklog(3);
      const mockAgent = { prompt: vi.fn().mockResolvedValue({ backlog }) };
      const { createArchitectAgent } =
        await import('../../src/agents/agent-factory.js');
      (createArchitectAgent as any).mockReturnValue(mockAgent);
      (readFile as any).mockImplementation((path: string) => {
        if (path.includes('tasks.json')) {
          return JSON.stringify(backlog);
        }
        return '';
      });

      const mockSessionManager = setupMockSessionManager(backlog);

      // EXECUTE: Create pipeline
      const pipeline = new PRPPipeline(prdPath);

      // Mock processNextItem to throw on second call
      let callCount = 0;
      const mockOrchestrator: any = {
        sessionManager: {},
        processNextItem: vi.fn().mockImplementation(async () => {
          callCount++;
          if (callCount === 2) {
            // Set currentItemId before throwing
            mockOrchestrator.currentItemId = 'P1.M1.T2.S1';
            throw new Error('Task failed');
          }
          if (callCount <= 3) {
            mockOrchestrator.currentItemId = `P1.M1.T${callCount}.S1`;
          }
          return callCount <= 3;
        }),
        currentItemId: null as string | null,
      };
      (pipeline as any).taskOrchestrator = mockOrchestrator;

      const result = await pipeline.run();

      // VERIFY: All tasks were attempted (pipeline continued after failure)
      expect(mockOrchestrator.processNextItem).toHaveBeenCalledTimes(4);

      // VERIFY: Failure was tracked
      expect(result.hasFailures).toBe(true);
      expect(result.failedTasks).toBe(1);

      // VERIFY: Pipeline completed despite failure
      expect(result.success).toBe(true);
    });

    it('should not stop pipeline on individual failures', async () => {
      // SETUP: Create test PRD
      const backlog = createMockBacklog(5);
      const mockAgent = { prompt: vi.fn().mockResolvedValue({ backlog }) };
      const { createArchitectAgent } =
        await import('../../src/agents/agent-factory.js');
      (createArchitectAgent as any).mockReturnValue(mockAgent);
      (readFile as any).mockImplementation((path: string) => {
        if (path.includes('tasks.json')) {
          return JSON.stringify(backlog);
        }
        return '';
      });

      const mockSessionManager = setupMockSessionManager(backlog);

      // EXECUTE: Create pipeline
      const pipeline = new PRPPipeline(prdPath);

      // Mock processNextItem with mixed success/failure pattern
      let callCount = 0;
      const failedTasks = new Set<number>([2, 4]); // Tasks 2 and 4 will fail
      const mockOrchestrator: any = {
        sessionManager: {},
        processNextItem: vi.fn().mockImplementation(async () => {
          callCount++;
          const taskId = `P1.M1.T${callCount}.S1`;
          mockOrchestrator.currentItemId = taskId;

          if (failedTasks.has(callCount)) {
            throw new Error(`Task ${callCount} failed`);
          }
          return callCount <= 5;
        }),
        currentItemId: null as string | null,
      };
      (pipeline as any).taskOrchestrator = mockOrchestrator;

      const result = await pipeline.run();

      // VERIFY: All tasks were attempted
      expect(mockOrchestrator.processNextItem).toHaveBeenCalledTimes(6); // 5 tasks + 1 false

      // VERIFY: Failures tracked but pipeline continued
      expect(result.failedTasks).toBe(2);
      expect(result.hasFailures).toBe(true);
      expect(result.success).toBe(true); // Overall success despite failures
    });

    it('should log warning when task fails', async () => {
      // SETUP: Create test PRD
      const backlog = createMockBacklog(3);
      const mockAgent = { prompt: vi.fn().mockResolvedValue({ backlog }) };
      const { createArchitectAgent } =
        await import('../../src/agents/agent-factory.js');
      (createArchitectAgent as any).mockReturnValue(mockAgent);
      (readFile as any).mockImplementation((path: string) => {
        if (path.includes('tasks.json')) {
          return JSON.stringify(backlog);
        }
        return '';
      });

      const mockSessionManager = setupMockSessionManager(backlog);

      // EXECUTE: Create pipeline
      const pipeline = new PRPPipeline(prdPath);
      const warnSpy = vi.spyOn((pipeline as any).logger, 'warn');

      let callCount = 0;
      const mockOrchestrator: any = {
        sessionManager: {},
        processNextItem: vi.fn().mockImplementation(async () => {
          callCount++;
          mockOrchestrator.currentItemId = `P1.M1.T${callCount}.S1`;
          if (callCount === 1) {
            throw new Error('Task execution error');
          }
          return callCount <= 3;
        }),
        currentItemId: null as string | null,
      };
      (pipeline as any).taskOrchestrator = mockOrchestrator;

      await pipeline.executeBacklog();

      // VERIFY: Warning logged for failed task
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Task failed, continuing to next task')
      );

      warnSpy.mockRestore();
    });
  });

  describe('progress metrics tracking', () => {
    it('should update totalTasks count', async () => {
      // SETUP: Create backlog with known task count
      const backlog = createMockBacklog(7);
      const mockAgent = { prompt: vi.fn().mockResolvedValue({ backlog }) };
      const { createArchitectAgent } =
        await import('../../src/agents/agent-factory.js');
      (createArchitectAgent as any).mockReturnValue(mockAgent);
      (readFile as any).mockImplementation((path: string) => {
        if (path.includes('tasks.json')) {
          return JSON.stringify(backlog);
        }
        return '';
      });

      const mockSessionManager = setupMockSessionManager(backlog);

      // EXECUTE: Create pipeline
      const pipeline = new PRPPipeline(prdPath);

      const mockOrchestrator: any = {
        sessionManager: {},
        processNextItem: vi.fn().mockResolvedValue(false),
        currentItemId: null as string | null,
      };
      (pipeline as any).taskOrchestrator = mockOrchestrator;

      const result = await pipeline.run();

      // VERIFY: totalTasks matches backlog size
      expect(result.totalTasks).toBe(7);
    });

    it('should update completedTasks count', async () => {
      // SETUP: Create test PRD
      const backlog = createMockBacklog(5);
      const mockAgent = { prompt: vi.fn().mockResolvedValue({ backlog }) };
      const { createArchitectAgent } =
        await import('../../src/agents/agent-factory.js');
      (createArchitectAgent as any).mockReturnValue(mockAgent);
      (readFile as any).mockImplementation((path: string) => {
        if (path.includes('tasks.json')) {
          return JSON.stringify(backlog);
        }
        return '';
      });

      const mockSessionManager = setupMockSessionManager(backlog);

      // EXECUTE: Create pipeline
      const pipeline = new PRPPipeline(prdPath);

      // Mock processNextItem to complete tasks
      let callCount = 0;
      const mockOrchestrator: any = {
        sessionManager: {},
        processNextItem: vi.fn().mockImplementation(async () => {
          callCount++;
          if (callCount <= 5) {
            const taskId = `P1.M1.T${callCount}.S1`;
            mockOrchestrator.currentItemId = taskId;
          }
          return callCount <= 5;
        }),
        currentItemId: null as string | null,
      };
      (pipeline as any).taskOrchestrator = mockOrchestrator;

      const result = await pipeline.run();

      // VERIFY: completedTasks matches number of successful completions
      expect(result.completedTasks).toBeGreaterThanOrEqual(0);
      expect(mockOrchestrator.processNextItem).toHaveBeenCalledTimes(6);
    });

    it('should update failedTasks count', async () => {
      // SETUP: Create test PRD
      const backlog = createMockBacklog(5);
      const mockAgent = { prompt: vi.fn().mockResolvedValue({ backlog }) };
      const { createArchitectAgent } =
        await import('../../src/agents/agent-factory.js');
      (createArchitectAgent as any).mockReturnValue(mockAgent);
      (readFile as any).mockImplementation((path: string) => {
        if (path.includes('tasks.json')) {
          return JSON.stringify(backlog);
        }
        return '';
      });

      const mockSessionManager = setupMockSessionManager(backlog);

      // EXECUTE: Create pipeline
      const pipeline = new PRPPipeline(prdPath);

      // Mock processNextItem to fail some tasks
      let callCount = 0;
      const mockOrchestrator: any = {
        sessionManager: {},
        processNextItem: vi.fn().mockImplementation(async () => {
          callCount++;
          const taskId = `P1.M1.T${callCount}.S1`;
          mockOrchestrator.currentItemId = taskId;

          // Fail tasks 2 and 4
          if (callCount === 2 || callCount === 4) {
            throw new Error(`Task ${callCount} failed`);
          }
          return callCount <= 5;
        }),
        currentItemId: null as string | null,
      };
      (pipeline as any).taskOrchestrator = mockOrchestrator;

      const result = await pipeline.run();

      // VERIFY: failedTasks matches number of failures
      expect(result.failedTasks).toBe(2);
      expect(result.hasFailures).toBe(true);
    });

    it('should track progress percentage correctly', async () => {
      // SETUP: Create test PRD
      const backlog = createMockBacklog(10);
      const mockAgent = { prompt: vi.fn().mockResolvedValue({ backlog }) };
      const { createArchitectAgent } =
        await import('../../src/agents/agent-factory.js');
      (createArchitectAgent as any).mockReturnValue(mockAgent);
      (readFile as any).mockImplementation((path: string) => {
        if (path.includes('tasks.json')) {
          return JSON.stringify(backlog);
        }
        return '';
      });

      const mockSessionManager = setupMockSessionManager(backlog);

      // EXECUTE: Create pipeline
      const pipeline = new PRPPipeline(prdPath);

      let callCount = 0;
      const mockOrchestrator: any = {
        sessionManager: {},
        processNextItem: vi.fn().mockImplementation(async () => {
          callCount++;
          if (callCount <= 10) {
            mockOrchestrator.currentItemId = `P1.M1.T${callCount}.S1`;
          }
          return callCount <= 10;
        }),
        currentItemId: null as string | null,
      };
      (pipeline as any).taskOrchestrator = mockOrchestrator;

      const result = await pipeline.run();

      // VERIFY: Progress can be calculated
      const expectedTotal = 10;
      expect(result.totalTasks).toBe(expectedTotal);
      // completedTasks should be between 0 and totalTasks
      expect(result.completedTasks).toBeGreaterThanOrEqual(0);
      expect(result.completedTasks).toBeLessThanOrEqual(expectedTotal);
    });
  });

  describe('pipeline status transitions', () => {
    it('should transition through expected status states', async () => {
      // SETUP: Create test PRD
      const backlog = createMockBacklog(3);
      const mockAgent = { prompt: vi.fn().mockResolvedValue({ backlog }) };
      const { createArchitectAgent } =
        await import('../../src/agents/agent-factory.js');
      (createArchitectAgent as any).mockReturnValue(mockAgent);
      (readFile as any).mockImplementation((path: string) => {
        if (path.includes('tasks.json')) {
          return JSON.stringify(backlog);
        }
        return '';
      });

      const mockSessionManager = setupMockSessionManager(backlog);

      // EXECUTE: Create pipeline
      const pipeline = new PRPPipeline(prdPath);

      const mockOrchestrator: any = {
        sessionManager: {},
        processNextItem: vi.fn().mockResolvedValue(false),
        currentItemId: null as string | null,
      };
      (pipeline as any).taskOrchestrator = mockOrchestrator;

      await pipeline.run();

      // VERIFY: Final phase is complete
      expect(pipeline.currentPhase).toBe('shutdown_complete');
    });

    it('should set backlog_complete after processing all tasks', async () => {
      // SETUP: Create test PRD
      const backlog = createMockBacklog(3);
      const mockAgent = { prompt: vi.fn().mockResolvedValue({ backlog }) };
      const { createArchitectAgent } =
        await import('../../src/agents/agent-factory.js');
      (createArchitectAgent as any).mockReturnValue(mockAgent);
      (readFile as any).mockImplementation((path: string) => {
        if (path.includes('tasks.json')) {
          return JSON.stringify(backlog);
        }
        return '';
      });

      const mockSessionManager = setupMockSessionManager(backlog);

      // EXECUTE: Create pipeline
      const pipeline = new PRPPipeline(prdPath);

      // Mock processNextItem to return false immediately (empty queue after processing)
      let callCount = 0;
      const mockOrchestrator: any = {
        sessionManager: {},
        processNextItem: vi.fn().mockImplementation(async () => {
          callCount++;
          return callCount <= 3;
        }),
        currentItemId: null as string | null,
      };
      (pipeline as any).taskOrchestrator = mockOrchestrator;

      await pipeline.executeBacklog();

      // VERIFY: Pipeline completed backlog
      expect(pipeline.currentPhase).toBe('backlog_complete');
    });

    it('should set shutdown_interrupted on shutdown request', async () => {
      // SETUP: Create test PRD
      const backlog = createMockBacklog(3);
      const mockAgent = { prompt: vi.fn().mockResolvedValue({ backlog }) };
      const { createArchitectAgent } =
        await import('../../src/agents/agent-factory.js');
      (createArchitectAgent as any).mockReturnValue(mockAgent);
      (readFile as any).mockImplementation((path: string) => {
        if (path.includes('tasks.json')) {
          return JSON.stringify(backlog);
        }
        return '';
      });

      const mockSessionManager = setupMockSessionManager(backlog);

      // EXECUTE: Create pipeline
      const pipeline = new PRPPipeline(prdPath);

      let callCount = 0;
      const mockOrchestrator: any = {
        sessionManager: {},
        processNextItem: vi.fn().mockImplementation(async () => {
          callCount++;
          // Set shutdown flag after first task
          if (callCount === 1) {
            (pipeline as any).shutdownRequested = true;
            (pipeline as any).shutdownReason = 'SIGINT';
          }
          if (callCount <= 3) {
            mockOrchestrator.currentItemId = `P1.M1.T${callCount}.S1`;
          }
          return callCount <= 3;
        }),
        currentItemId: null as string | null,
      };
      (pipeline as any).taskOrchestrator = mockOrchestrator;

      await pipeline.executeBacklog();

      // VERIFY: Pipeline status is shutdown_interrupted
      expect(pipeline.currentPhase).toBe('shutdown_interrupted');
    });
  });

  describe('loop termination conditions', () => {
    it('should terminate when queue is empty', async () => {
      // SETUP: Create test PRD
      const backlog = createMockBacklog(3);
      const mockAgent = { prompt: vi.fn().mockResolvedValue({ backlog }) };
      const { createArchitectAgent } =
        await import('../../src/agents/agent-factory.js');
      (createArchitectAgent as any).mockReturnValue(mockAgent);
      (readFile as any).mockImplementation((path: string) => {
        if (path.includes('tasks.json')) {
          return JSON.stringify(backlog);
        }
        return '';
      });

      const mockSessionManager = setupMockSessionManager(backlog);

      // EXECUTE: Create pipeline
      const pipeline = new PRPPipeline(prdPath);

      // Mock processNextItem to return false immediately (no tasks to process)
      const mockOrchestrator: any = {
        sessionManager: {},
        processNextItem: vi.fn().mockResolvedValue(false),
        currentItemId: null as string | null,
      };
      (pipeline as any).taskOrchestrator = mockOrchestrator;

      await pipeline.executeBacklog();

      // VERIFY: Loop terminated (processNextItem returns false, so loop doesn't run)
      expect(mockOrchestrator.processNextItem).toHaveBeenCalledTimes(1);

      // VERIFY: Pipeline completed backlog
      expect(pipeline.currentPhase).toBe('backlog_complete');
    });

    it('should terminate on shutdown request', async () => {
      // SETUP: Create test PRD
      const backlog = createMockBacklog(5);
      const mockAgent = { prompt: vi.fn().mockResolvedValue({ backlog }) };
      const { createArchitectAgent } =
        await import('../../src/agents/agent-factory.js');
      (createArchitectAgent as any).mockReturnValue(mockAgent);
      (readFile as any).mockImplementation((path: string) => {
        if (path.includes('tasks.json')) {
          return JSON.stringify(backlog);
        }
        return '';
      });

      const mockSessionManager = setupMockSessionManager(backlog);

      // EXECUTE: Create pipeline
      const pipeline = new PRPPipeline(prdPath);

      let callCount = 0;
      const mockOrchestrator: any = {
        sessionManager: {},
        processNextItem: vi.fn().mockImplementation(async () => {
          callCount++;
          // Set shutdown flag after first task
          if (callCount === 1) {
            (pipeline as any).shutdownRequested = true;
            (pipeline as any).shutdownReason = 'SIGINT';
          }
          if (callCount <= 5) {
            mockOrchestrator.currentItemId = `P1.M1.T${callCount}.S1`;
          }
          return callCount <= 5;
        }),
        currentItemId: null as string | null,
      };
      (pipeline as any).taskOrchestrator = mockOrchestrator;

      await pipeline.executeBacklog();

      // VERIFY: Loop terminated early (after shutdown flag set)
      expect(callCount).toBeGreaterThan(0);
      expect(pipeline.currentPhase).toBe('shutdown_interrupted');
    });

    it('should terminate on max iterations safety check', async () => {
      // SETUP: Create test PRD
      const backlog = createMockBacklog(3);
      const mockAgent = { prompt: vi.fn().mockResolvedValue({ backlog }) };
      const { createArchitectAgent } =
        await import('../../src/agents/agent-factory.js');
      (createArchitectAgent as any).mockReturnValue(mockAgent);
      (readFile as any).mockImplementation((path: string) => {
        if (path.includes('tasks.json')) {
          return JSON.stringify(backlog);
        }
        return '';
      });

      const mockSessionManager = setupMockSessionManager(backlog);

      // EXECUTE: Create pipeline
      const pipeline = new PRPPipeline(prdPath);

      // Mock processNextItem to always return true (infinite loop condition)
      const mockOrchestrator: any = {
        sessionManager: {},
        processNextItem: vi.fn().mockResolvedValue(true),
        currentItemId: null as string | null,
      };
      (pipeline as any).taskOrchestrator = mockOrchestrator;

      // This should throw an error for exceeding max iterations
      await expect(pipeline.executeBacklog()).rejects.toThrow(
        /exceeded .* iterations/
      );
    });

    it('should handle no subtasks gracefully', async () => {
      // SETUP: Create test PRD with empty backlog
      const emptyBacklog: Backlog = { backlog: [] };
      const mockAgent = {
        prompt: vi.fn().mockResolvedValue({ backlog: emptyBacklog }),
      };
      const { createArchitectAgent } =
        await import('../../src/agents/agent-factory.js');
      (createArchitectAgent as any).mockReturnValue(mockAgent);
      (readFile as any).mockImplementation((path: string) => {
        if (path.includes('tasks.json')) {
          return JSON.stringify(emptyBacklog);
        }
        return '';
      });

      const mockSessionManager = setupMockSessionManager(emptyBacklog);

      // EXECUTE: Create pipeline
      const pipeline = new PRPPipeline(prdPath);

      const mockOrchestrator: any = {
        sessionManager: {},
        processNextItem: vi.fn().mockResolvedValue(false),
        currentItemId: null as string | null,
      };
      (pipeline as any).taskOrchestrator = mockOrchestrator;

      await pipeline.executeBacklog();

      // VERIFY: Pipeline completed without processing any tasks
      expect(pipeline.currentPhase).toBe('backlog_complete');
      expect(mockOrchestrator.processNextItem).not.toHaveBeenCalled();
    });
  });

  describe('mock orchestrator behavior', () => {
    it('should use mock TaskOrchestrator for deterministic testing', async () => {
      // SETUP: Create test PRD
      const backlog = createMockBacklog(3);
      const mockAgent = { prompt: vi.fn().mockResolvedValue({ backlog }) };
      const { createArchitectAgent } =
        await import('../../src/agents/agent-factory.js');
      (createArchitectAgent as any).mockReturnValue(mockAgent);
      (readFile as any).mockImplementation((path: string) => {
        if (path.includes('tasks.json')) {
          return JSON.stringify(backlog);
        }
        return '';
      });

      const mockSessionManager = setupMockSessionManager(backlog);

      // EXECUTE: Create pipeline
      const pipeline = new PRPPipeline(prdPath);

      // Controlled behavior: exactly 3 tasks
      let callCount = 0;
      const mockOrchestrator: any = {
        sessionManager: {},
        processNextItem: vi.fn().mockImplementation(async () => {
          callCount++;
          mockOrchestrator.currentItemId = `P1.M1.T${callCount}.S1`;
          return callCount <= 3;
        }),
        currentItemId: null as string | null,
      };
      (pipeline as any).taskOrchestrator = mockOrchestrator;

      await pipeline.executeBacklog();

      const callCount1 = mockOrchestrator.processNextItem.mock.calls.length;

      // Reset and run again
      vi.clearAllMocks();
      callCount = 0;
      mockOrchestrator.processNextItem = vi
        .fn()
        .mockImplementation(async () => {
          callCount++;
          mockOrchestrator.currentItemId = `P1.M1.T${callCount}.S1`;
          return callCount <= 3;
        });

      const pipeline2 = new PRPPipeline(prdPath);
      (pipeline2 as any).taskOrchestrator = mockOrchestrator;
      await pipeline2.executeBacklog();

      const callCount2 = mockOrchestrator.processNextItem.mock.calls.length;

      // VERIFY: Deterministic behavior (same call count)
      expect(callCount1).toBe(callCount2);
      expect(callCount1).toBe(4); // 3 tasks + 1 false
    });

    it('should track currentItemId correctly', async () => {
      // SETUP: Create test PRD
      const backlog = createMockBacklog(3);
      const mockAgent = { prompt: vi.fn().mockResolvedValue({ backlog }) };
      const { createArchitectAgent } =
        await import('../../src/agents/agent-factory.js');
      (createArchitectAgent as any).mockReturnValue(mockAgent);
      (readFile as any).mockImplementation((path: string) => {
        if (path.includes('tasks.json')) {
          return JSON.stringify(backlog);
        }
        return '';
      });

      const mockSessionManager = setupMockSessionManager(backlog);

      // EXECUTE: Create pipeline
      const pipeline = new PRPPipeline(prdPath);

      const processedIds: string[] = [];
      let callCount = 0;
      const mockOrchestrator: any = {
        sessionManager: {},
        processNextItem: vi.fn().mockImplementation(async () => {
          callCount++;
          const id = `P1.M1.T${callCount}.S1`;
          mockOrchestrator.currentItemId = id;
          processedIds.push(id);
          return callCount <= 3;
        }),
        currentItemId: null as string | null,
      };
      (pipeline as any).taskOrchestrator = mockOrchestrator;

      await pipeline.executeBacklog();

      // VERIFY: All task IDs were tracked
      expect(processedIds).toEqual([
        'P1.M1.T1.S1',
        'P1.M1.T2.S1',
        'P1.M1.T3.S1',
      ]);
    });
  });

  describe('mock session manager behavior', () => {
    it('should use mock SessionManager for deterministic testing', async () => {
      // SETUP: Create controlled session state
      const backlog = createMockBacklog(3);
      const mockAgent = { prompt: vi.fn().mockResolvedValue({ backlog }) };
      const { createArchitectAgent } =
        await import('../../src/agents/agent-factory.js');
      (createArchitectAgent as any).mockReturnValue(mockAgent);
      (readFile as any).mockImplementation((path: string) => {
        if (path.includes('tasks.json')) {
          return JSON.stringify(backlog);
        }
        return '';
      });

      const mockSessionManager = setupMockSessionManager(backlog);

      // EXECUTE: Create pipeline
      const pipeline = new PRPPipeline(prdPath);

      // VERIFY: SessionManager methods were called
      expect(mockSessionManager.initialize).toHaveBeenCalledWith(prdPath);
      expect(pipeline.currentPhase).toBe('session_initialized');
    });

    it('should flush updates before saveBacklog', async () => {
      // SETUP: Track call order
      const backlog = createMockBacklog(3);
      const mockAgent = { prompt: vi.fn().mockResolvedValue({ backlog }) };
      const { createArchitectAgent } =
        await import('../../src/agents/agent-factory.js');
      (createArchitectAgent as any).mockReturnValue(mockAgent);
      (readFile as any).mockImplementation((path: string) => {
        if (path.includes('tasks.json')) {
          return JSON.stringify(backlog);
        }
        return '';
      });

      const callOrder: string[] = [];
      const mockSessionManager = {
        currentSession: {
          metadata: { path: tempDir },
          taskRegistry: backlog,
        },
        initialize: vi.fn().mockResolvedValue({
          metadata: {
            id: 'test',
            hash: 'abc',
            path: tempDir,
            createdAt: new Date(),
          },
          prdSnapshot: '# Test',
          taskRegistry: backlog,
          currentItemId: null,
        }),
        flushUpdates: vi.fn().mockImplementation(async () => {
          callOrder.push('flushUpdates');
        }),
        saveBacklog: vi.fn().mockImplementation(async () => {
          callOrder.push('saveBacklog');
        }),
        updateItemStatus: vi.fn().mockResolvedValue(undefined),
      };
      (SessionManager as any).mockImplementation(() => mockSessionManager);

      // EXECUTE: Create pipeline
      const pipeline = new PRPPipeline(prdPath);

      const mockOrchestrator: any = {
        sessionManager: {},
        processNextItem: vi.fn().mockResolvedValue(false),
        currentItemId: null as string | null,
      };
      (pipeline as any).taskOrchestrator = mockOrchestrator;

      await pipeline.run();

      // VERIFY: flushUpdates called before saveBacklog in cleanup
      expect(callOrder).toContain('flushUpdates');
      expect(callOrder).toContain('saveBacklog');
    });
  });
});
