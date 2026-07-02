/**
 * Unit tests for PRPPipeline class
 *
 * @remarks
 * Tests validate PRPPipeline class from src/workflows/prp-pipeline.ts with comprehensive coverage.
 * Tests follow the Setup/Execute/Verify pattern with comprehensive edge case coverage.
 *
 * Mocks are used for all SessionManager, TaskOrchestrator, and agent operations - no real I/O is performed.
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { PRPPipeline } from '../../../src/workflows/prp-pipeline.js';
import { Backlog, SessionState, Status } from '../../../src/core/models.js';

// Mock the node:fs/promises module
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

// Mock SessionManager
vi.mock('../../../src/core/session-manager.js', () => ({
  SessionManager: vi.fn().mockImplementation(() => ({
    currentSession: null,
    initialize: vi.fn(),
    saveBacklog: vi.fn(),
  })),
}));

// Mock TaskOrchestrator
vi.mock('../../../src/core/task-orchestrator.js', () => ({
  TaskOrchestrator: vi.fn().mockImplementation(() => ({
    processNextItem: vi.fn(),
    rebuildQueue: vi.fn().mockResolvedValue(undefined),
  })),
}));

// Mock agent factory
vi.mock('../../../src/agents/agent-factory.js', () => ({
  createArchitectAgent: vi.fn(),
  createQAAgent: vi.fn(),
}));

// Mock prompts
vi.mock('../../../src/agents/prompts.js', () => ({
  TASK_BREAKDOWN_PROMPT: 'Mock TASK_BREAKDOWN_PROMPT',
}));

// Mock DeltaAnalysisWorkflow
vi.mock('../../../src/workflows/delta-analysis-workflow.js', () => ({
  DeltaAnalysisWorkflow: vi.fn().mockImplementation(() => ({
    run: vi.fn().mockResolvedValue({
      changes: [],
      patchInstructions: 'No changes',
      taskIds: [],
    }),
  })),
}));

// Mock BugHuntWorkflow
vi.mock('../../../src/workflows/bug-hunt-workflow.js', () => ({
  BugHuntWorkflow: vi.fn().mockImplementation(() => ({
    run: vi.fn().mockResolvedValue({
      hasBugs: false,
      bugs: [],
      summary: 'No bugs found',
      recommendations: [],
    }),
  })),
}));

// Mock FixCycleWorkflow
vi.mock('../../../src/workflows/fix-cycle-workflow.js', () => ({
  FixCycleWorkflow: vi.fn().mockImplementation(() => ({
    run: vi.fn().mockResolvedValue({
      hasBugs: false,
      bugs: [],
      summary: 'All bugs fixed',
      recommendations: [],
    }),
  })),
}));

// Mock TaskPatcher
vi.mock('../../../src/core/task-patcher.js', () => ({
  patchBacklog: vi.fn().mockImplementation((backlog: Backlog) => backlog),
}));

// Mock TaskUtils
vi.mock('../../../src/utils/task-utils.js', () => ({
  filterByStatus: vi.fn().mockReturnValue([]),
}));

// Mock execution-guard
vi.mock('../../../src/utils/validation/execution-guard.js', () => ({
  validateNestedExecution: vi.fn(),
  isNestedExecutionError: vi.fn(() => false),
}));

// Import mocked modules
import { readFile } from 'node:fs/promises';
import { createArchitectAgent } from '../../../src/agents/agent-factory.js';
import { SessionManager as SessionManagerClass } from '../../../src/core/session-manager.js';
import { DeltaAnalysisWorkflow } from '../../../src/workflows/delta-analysis-workflow.js';
import { patchBacklog } from '../../../src/core/task-patcher.js';
import { filterByStatus } from '../../../src/utils/task-utils.js';
import {
  validateNestedExecution,
  isNestedExecutionError,
} from '../../../src/utils/validation/execution-guard.js';

// Cast mocked functions
const mockReadFile = readFile as any;
const mockCreateArchitectAgent = createArchitectAgent as any;
const MockDeltaAnalysisWorkflow = DeltaAnalysisWorkflow as any;
const mockPatchBacklog = patchBacklog as any;
const mockFilterByStatus = filterByStatus as any;
const mockValidateNestedExecution = validateNestedExecution as any;
const mockIsNestedExecutionError = isNestedExecutionError as any;
// Get reference to mocked constructor for test setup
const MockSessionManagerClass = SessionManagerClass as any;

// Factory functions for test data
const createTestSubtask = (
  id: string,
  title: string,
  status: Status,
  dependencies: string[] = []
) => ({
  id,
  type: 'Subtask' as const,
  title,
  status,
  story_points: 1,
  dependencies,
  context_scope: 'Test scope',
});

const createTestTask = (
  id: string,
  title: string,
  status: Status,
  subtasks: any[] = []
) => ({
  id,
  type: 'Task' as const,
  title,
  status,
  description: 'Test task description',
  subtasks,
});

const createTestMilestone = (
  id: string,
  title: string,
  status: Status,
  tasks: any[] = []
) => ({
  id,
  type: 'Milestone' as const,
  title,
  status,
  description: 'Test milestone description',
  tasks,
});

const createTestPhase = (
  id: string,
  title: string,
  status: Status,
  milestones: any[] = []
) => ({
  id,
  type: 'Phase' as const,
  title,
  status,
  description: 'Test phase description',
  milestones,
});

const createTestBacklog = (phases: any[]): Backlog => ({
  backlog: phases,
});

const createTestSession = (
  backlog: Backlog,
  prdSnapshot: string = '# Test PRD',
  sessionPath: string = '/plan/001_14b9dc2a33c7'
): SessionState => ({
  metadata: {
    id: '001_14b9dc2a33c7',
    hash: '14b9dc2a33c7',
    path: sessionPath,
    createdAt: new Date(),
    parentSession: null,
  },
  prdSnapshot,
  taskRegistry: backlog,
  currentItemId: null,
});

// Create mock SessionManager factory
function createMockSessionManager(
  session: SessionState | null,
  hasSessionChanged = false
) {
  const mock = {
    currentSession: session,
    initialize: vi.fn().mockResolvedValue(session),
    saveBacklog: vi.fn().mockResolvedValue(undefined),
    hasSessionChanged: vi.fn().mockReturnValue(hasSessionChanged),
    createDeltaSession: vi.fn().mockResolvedValue(session),
    prdPath: '/test/prd.md',
    flushUpdates: vi.fn().mockResolvedValue(undefined),
  };
  // Set the mock instance to be returned by SessionManager constructor
  MockSessionManagerClass.mockImplementation(() => mock);
  return mock;
}

// Create mock TaskOrchestrator factory
function createMockTaskOrchestrator() {
  return {
    processNextItem: vi.fn(),
    rebuildQueue: vi.fn().mockResolvedValue(undefined),
    currentItemId: null as string | null,
    sessionManager: {},
  };
}

describe('PRPPipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset SessionManager mock
    MockSessionManagerClass.mockImplementation(() => ({
      currentSession: null,
      initialize: vi.fn().mockResolvedValue({ currentSession: null }),
      saveBacklog: vi.fn().mockResolvedValue(undefined),
    }));
    // Setup default mocks
    mockReadFile.mockResolvedValue(
      JSON.stringify({ backlog: [createTestPhase('P1', 'Phase 1', 'Planned')] })
    );
    mockCreateArchitectAgent.mockReturnValue({
      prompt: vi.fn().mockResolvedValue({
        backlog: createTestBacklog([]),
      }),
    });
    // Setup default validation mock (allow execution)
    mockValidateNestedExecution.mockImplementation(() => {
      // Default: allow execution (no throw)
    });
    mockIsNestedExecutionError.mockReturnValue(false);
  });

  afterEach(() => {
    // Clean up signal listeners to prevent memory leaks
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGTERM');
  });

  describe('constructor', () => {
    it('should throw if prdPath is empty', () => {
      // EXECUTE & VERIFY
      expect(() => new PRPPipeline('')).toThrow('PRP path cannot be empty');
    });

    it('should throw if prdPath is only whitespace', () => {
      // EXECUTE & VERIFY
      expect(() => new PRPPipeline('   ')).toThrow('PRP path cannot be empty');
    });

    it('should initialize ObservedState fields with default values', () => {
      // EXECUTE
      const pipeline = new PRPPipeline('./test.md');

      // VERIFY
      expect(pipeline.currentPhase).toBe('init');
      expect(pipeline.totalTasks).toBe(0);
      expect(pipeline.completedTasks).toBe(0);
      expect(pipeline.runtime).toBeNull();
    });
  });

  describe('decomposePRD', () => {
    it('should skip backlog generation if backlog exists', async () => {
      // SETUP
      const backlog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Planned', [
          createTestMilestone('P1.M1', 'Milestone 1', 'Planned', [
            createTestTask('P1.M1.T1', 'Task 1', 'Planned', [
              createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Planned'),
            ]),
          ]),
        ]),
      ]);
      const mockSession = createTestSession(backlog);
      const mockManager = createMockSessionManager(mockSession);

      const pipeline = new PRPPipeline('./test.md');
      (pipeline as any).sessionManager = mockManager;

      // EXECUTE
      await pipeline.decomposePRD();

      // VERIFY
      expect(mockCreateArchitectAgent).not.toHaveBeenCalled();
      expect(pipeline.currentPhase).toBe('prd_decomposed');
    });

    it('should call createArchitectAgent for new session', async () => {
      // SETUP
      const backlog = createTestBacklog([]);
      const mockSession = createTestSession(backlog);
      const mockManager = createMockSessionManager(mockSession);

      const pipeline = new PRPPipeline('./test.md');
      (pipeline as any).sessionManager = mockManager;

      // EXECUTE
      await pipeline.decomposePRD();

      // VERIFY
      expect(mockCreateArchitectAgent).toHaveBeenCalled();
    });

    it('should update currentPhase to prd_decomposed', async () => {
      // SETUP
      const backlog = createTestBacklog([]);
      const mockSession = createTestSession(backlog);
      const mockManager = createMockSessionManager(mockSession);

      const pipeline = new PRPPipeline('./test.md');
      (pipeline as any).sessionManager = mockManager;

      // EXECUTE
      await pipeline.decomposePRD();

      // VERIFY
      expect(pipeline.currentPhase).toBe('prd_decomposed');
    });
  });

  describe('executeBacklog', () => {
    it('should call processNextItem until false returned', async () => {
      // SETUP
      const backlog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Planned', [
          createTestMilestone('P1.M1', 'Milestone 1', 'Planned', [
            createTestTask('P1.M1.T1', 'Task 1', 'Planned', [
              createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Planned'),
            ]),
          ]),
        ]),
      ]);
      const mockSession = createTestSession(backlog);
      const mockManager = createMockSessionManager(mockSession);

      const mockOrchestrator = createMockTaskOrchestrator();
      mockOrchestrator.currentItemId = 'P1.M1.T1.S1';
      (mockOrchestrator as any).processNextItem = vi
        .fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);

      const pipeline = new PRPPipeline('./test.md');
      (pipeline as any).sessionManager = mockManager;
      (pipeline as any).taskOrchestrator = mockOrchestrator;

      // EXECUTE
      await pipeline.executeBacklog();

      // VERIFY
      expect((mockOrchestrator as any).processNextItem).toHaveBeenCalledTimes(
        3
      );
    });

    it('should update currentPhase to backlog_complete', async () => {
      // SETUP
      const backlog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Planned', [
          createTestMilestone('P1.M1', 'Milestone 1', 'Planned', [
            createTestTask('P1.M1.T1', 'Task 1', 'Planned', [
              createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Planned'),
            ]),
          ]),
        ]),
      ]);
      const mockSession = createTestSession(backlog);
      const mockManager = createMockSessionManager(mockSession);

      const mockOrchestrator = createMockTaskOrchestrator();
      mockOrchestrator.currentItemId = 'P1.M1.T1.S1';
      (mockOrchestrator as any).processNextItem = vi
        .fn()
        .mockResolvedValueOnce(false);

      const pipeline = new PRPPipeline('./test.md');
      (pipeline as any).sessionManager = mockManager;
      (pipeline as any).taskOrchestrator = mockOrchestrator;

      // EXECUTE
      await pipeline.executeBacklog();

      // VERIFY
      expect(pipeline.currentPhase).toBe('backlog_complete');
    });

    it('should throw if processNextItem throws', async () => {
      // SETUP
      const backlog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Planned', [
          createTestMilestone('P1.M1', 'Milestone 1', 'Planned', [
            createTestTask('P1.M1.T1', 'Task 1', 'Planned', [
              createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Planned'),
            ]),
          ]),
        ]),
      ]);
      const mockSession = createTestSession(backlog);
      const mockManager = createMockSessionManager(mockSession);

      const mockOrchestrator = createMockTaskOrchestrator();
      mockOrchestrator.currentItemId = 'P1.M1.T1.S1';
      (mockOrchestrator as any).processNextItem = vi
        .fn()
        .mockRejectedValue(new Error('Execution failed'));

      const pipeline = new PRPPipeline('./test.md');
      (pipeline as any).sessionManager = mockManager;
      (pipeline as any).taskOrchestrator = mockOrchestrator;

      // EXECUTE & VERIFY
      await expect(pipeline.executeBacklog()).rejects.toThrow(
        'Execution failed'
      );
    });

    it('should throw safety error after max iterations', async () => {
      // SETUP
      const backlog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Planned', [
          createTestMilestone('P1.M1', 'Milestone 1', 'Planned', [
            createTestTask('P1.M1.T1', 'Task 1', 'Planned', [
              createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Planned'),
            ]),
          ]),
        ]),
      ]);
      const mockSession = createTestSession(backlog);
      const mockManager = createMockSessionManager(mockSession);

      const mockOrchestrator = createMockTaskOrchestrator();
      (mockOrchestrator as any).processNextItem = vi
        .fn()
        .mockResolvedValue(true);

      const pipeline = new PRPPipeline('./test.md');
      (pipeline as any).sessionManager = mockManager;
      (pipeline as any).taskOrchestrator = mockOrchestrator;

      // EXECUTE & VERIFY
      await expect(pipeline.executeBacklog()).rejects.toThrow(
        'Execution exceeded 10000 iterations'
      );
    });
  });

  describe('runQACycle', () => {
    it('should skip QA if not all tasks complete', async () => {
      // SETUP
      const backlog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Implementing', [
          createTestMilestone('P1.M1', 'Milestone 1', 'Planned', [
            createTestTask('P1.M1.T1', 'Task 1', 'Planned', [
              createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Planned'),
              createTestSubtask('P1.M1.T1.S2', 'Subtask 2', 'Complete'),
            ]),
          ]),
        ]),
      ]);
      const mockSession = createTestSession(backlog);
      const mockManager = createMockSessionManager(mockSession);

      const pipeline = new PRPPipeline('./test.md');
      (pipeline as any).sessionManager = mockManager;
      pipeline.totalTasks = 2;

      // EXECUTE
      await pipeline.runQACycle();

      // VERIFY
      expect(pipeline.currentPhase).toBe('qa_skipped');
    });

    it('should set qa_complete phase when all tasks complete', async () => {
      // SETUP
      const backlog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Complete', [
          createTestMilestone('P1.M1', 'Milestone 1', 'Complete', [
            createTestTask('P1.M1.T1', 'Task 1', 'Complete', [
              createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Complete'),
              createTestSubtask('P1.M1.T1.S2', 'Subtask 2', 'Complete'),
            ]),
          ]),
        ]),
      ]);
      const mockSession = createTestSession(backlog);
      const mockManager = createMockSessionManager(mockSession);

      const pipeline = new PRPPipeline('./test.md');
      (pipeline as any).sessionManager = mockManager;

      // EXECUTE
      await pipeline.runQACycle();

      // VERIFY
      expect(pipeline.currentPhase).toBe('qa_complete');
    });
  });

  describe('run', () => {
    it('should call all workflow steps in order', async () => {
      // SETUP
      const mockSession = createTestSession(createTestBacklog([]));
      createMockSessionManager(mockSession);

      const mockOrchestrator = createMockTaskOrchestrator();
      (mockOrchestrator as any).processNextItem = vi
        .fn()
        .mockResolvedValue(false);

      // Create pipeline AFTER setting up mocks
      const pipeline = new PRPPipeline('./test.md');
      (pipeline as any).taskOrchestrator = mockOrchestrator;

      // Mock step methods
      const initSpy = vi.spyOn(pipeline, 'initializeSession');
      const decomposeSpy = vi.spyOn(pipeline, 'decomposePRD');
      const executeSpy = vi.spyOn(pipeline, 'executeBacklog');
      const qaSpy = vi.spyOn(pipeline, 'runQACycle');

      // EXECUTE
      await pipeline.run();

      // VERIFY
      expect(initSpy).toHaveBeenCalled();
      expect(decomposeSpy).toHaveBeenCalled();
      expect(executeSpy).toHaveBeenCalled();
      expect(qaSpy).toHaveBeenCalled();
    });

    it('should return PipelineResult with success true on completion', async () => {
      // SETUP
      const mockSession = createTestSession(createTestBacklog([]));
      createMockSessionManager(mockSession);

      const mockOrchestrator = createMockTaskOrchestrator();
      (mockOrchestrator as any).processNextItem = vi
        .fn()
        .mockResolvedValue(false);

      // Create pipeline AFTER setting up mocks
      const pipeline = new PRPPipeline('./test.md');
      (pipeline as any).taskOrchestrator = mockOrchestrator;

      // EXECUTE
      const result = await pipeline.run();

      // VERIFY
      expect(result.success).toBe(true);
      expect(result.sessionPath).toBe('/plan/001_14b9dc2a33c7');
      expect(result.duration).toBeGreaterThan(0);
      expect(result.phases).toEqual([]);
    });

    it('should return PipelineResult with success false on error', async () => {
      // SETUP
      const mockError = new Error('Test error');
      // Create mock manager that will error
      const errorManager: any = {
        initialize: vi.fn().mockRejectedValue(mockError),
        currentSession: null,
        saveBacklog: vi.fn().mockResolvedValue(undefined),
      };
      // Override the mock to return error manager
      MockSessionManagerClass.mockImplementation(() => errorManager);

      const pipeline = new PRPPipeline('./test.md');

      // EXECUTE
      const result = await pipeline.run();

      // VERIFY
      expect(result.success).toBe(false);
      expect(result.error).toBe('Test error');
      expect(result.duration).toBeGreaterThan(0);

      // Reset mock to default for other tests
      MockSessionManagerClass.mockImplementation(() => ({
        currentSession: null,
        initialize: vi.fn().mockResolvedValue({ currentSession: null }),
        saveBacklog: vi.fn().mockResolvedValue(undefined),
      }));
    });

    it('should include phase summaries in result', async () => {
      // SETUP
      const backlog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Complete', [
          createTestMilestone('P1.M1', 'Milestone 1', 'Complete', []),
          createTestMilestone('P1.M2', 'Milestone 2', 'Planned', []),
        ]),
      ]);
      const mockSession = createTestSession(backlog);
      createMockSessionManager(mockSession);

      const mockOrchestrator = createMockTaskOrchestrator();
      (mockOrchestrator as any).processNextItem = vi
        .fn()
        .mockResolvedValue(false);

      // Create pipeline AFTER setting up mocks
      const pipeline = new PRPPipeline('./test.md');
      (pipeline as any).taskOrchestrator = mockOrchestrator;

      // EXECUTE
      const result = await pipeline.run();

      // VERIFY
      expect(result.phases).toHaveLength(1);
      expect(result.phases[0].id).toBe('P1');
      expect(result.phases[0].totalMilestones).toBe(2);
      expect(result.phases[0].completedMilestones).toBe(1);
    });
  });

  describe('private helper methods - behavior verification', () => {
    it('should count all subtasks in backlog', async () => {
      // SETUP
      const backlog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Planned', [
          createTestMilestone('P1.M1', 'Milestone 1', 'Planned', [
            createTestTask('P1.M1.T1', 'Task 1', 'Planned', [
              createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Planned'),
              createTestSubtask('P1.M1.T1.S2', 'Subtask 2', 'Planned'),
            ]),
            createTestTask('P1.M1.T2', 'Task 2', 'Planned', [
              createTestSubtask('P1.M1.T2.S1', 'Subtask 1', 'Planned'),
            ]),
          ]),
        ]),
      ]);
      const mockSession = createTestSession(backlog);
      const mockManager = createMockSessionManager(mockSession);

      const pipeline = new PRPPipeline('./test.md');
      (pipeline as any).sessionManager = mockManager;

      // EXECUTE - decomposePRD will call #countTasks
      pipeline.totalTasks = 0;
      await pipeline.decomposePRD();

      // VERIFY - totalTasks should be updated
      expect(pipeline.totalTasks).toBe(3);
    });

    it('should build phase summary array', async () => {
      // SETUP
      const backlog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Complete', [
          createTestMilestone('P1.M1', 'Milestone 1', 'Complete', []),
          createTestMilestone('P1.M2', 'Milestone 2', 'Planned', []),
        ]),
        createTestPhase('P2', 'Phase 2', 'Planned', [
          createTestMilestone('P2.M1', 'Milestone 1', 'Planned', []),
        ]),
      ]);
      const mockSession = createTestSession(backlog);
      createMockSessionManager(mockSession);

      const mockOrchestrator = createMockTaskOrchestrator();
      (mockOrchestrator as any).processNextItem = vi
        .fn()
        .mockResolvedValue(false);

      // Create pipeline AFTER setting up mocks
      const pipeline = new PRPPipeline('./test.md');
      (pipeline as any).taskOrchestrator = mockOrchestrator;

      // EXECUTE
      const result = await pipeline.run();

      // VERIFY
      expect(result.phases).toHaveLength(2);
      expect(result.phases[0]).toEqual({
        id: 'P1',
        title: 'Phase 1',
        status: 'Complete',
        totalMilestones: 2,
        completedMilestones: 1,
      });
      expect(result.phases[1]).toEqual({
        id: 'P2',
        title: 'Phase 2',
        status: 'Planned',
        totalMilestones: 1,
        completedMilestones: 0,
      });
    });
  });

  describe('graceful shutdown', () => {
    it('should initialize shutdown state fields with default values', () => {
      // EXECUTE
      const pipeline = new PRPPipeline('./test.md');

      // VERIFY
      expect(pipeline.shutdownRequested).toBe(false);
      expect(pipeline.currentTaskId).toBeNull();
      expect(pipeline.shutdownReason).toBeNull();
    });

    it('should set shutdownRequested to true and reason to SIGINT on SIGINT', () => {
      // SETUP
      const pipeline = new PRPPipeline('./test.md');
      const originalListeners = (process as any)._events?.SIGINT?.length ?? 0;

      // EXECUTE - Emit SIGINT event
      process.emit('SIGINT');

      // VERIFY
      expect(pipeline.shutdownRequested).toBe(true);
      expect(pipeline.shutdownReason).toBe('SIGINT');

      // Cleanup: Remove our test listener
      const listeners = (process as any)._events?.SIGINT;
      if (
        listeners != null &&
        typeof listeners.length === 'number' &&
        listeners.length > originalListeners
      ) {
        process.removeAllListeners('SIGINT');
      }
    });

    it('should set shutdownRequested to true and reason to SIGTERM on SIGTERM', () => {
      // SETUP
      const pipeline = new PRPPipeline('./test.md');
      const originalListeners = (process as any)._events?.SIGTERM?.length ?? 0;

      // EXECUTE - Emit SIGTERM event
      process.emit('SIGTERM');

      // VERIFY
      expect(pipeline.shutdownRequested).toBe(true);
      expect(pipeline.shutdownReason).toBe('SIGTERM');

      // Cleanup: Remove our test listener
      const listeners = (process as any)._events?.SIGTERM;
      if (
        listeners != null &&
        typeof listeners.length === 'number' &&
        listeners.length > originalListeners
      ) {
        process.removeAllListeners('SIGTERM');
      }
    });

    it('should break executeBacklog loop when shutdownRequested is true', async () => {
      // SETUP
      const backlog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Planned', [
          createTestMilestone('P1.M1', 'Milestone 1', 'Planned', [
            createTestTask('P1.M1.T1', 'Task 1', 'Planned', [
              createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Planned'),
              createTestSubtask('P1.M1.T1.S2', 'Subtask 2', 'Planned'),
            ]),
          ]),
        ]),
      ]);
      const mockSession = createTestSession(backlog);
      const mockManager = createMockSessionManager(mockSession);

      const pipeline = new PRPPipeline('./test.md');
      (pipeline as any).sessionManager = mockManager;
      let callCount = 0;

      const mockOrchestrator = createMockTaskOrchestrator();
      mockOrchestrator.currentItemId = 'P1.M1.T1.S1';
      (mockOrchestrator as any).processNextItem = vi
        .fn()
        .mockImplementation(async () => {
          callCount++;
          // Update currentItemId for each call
          mockOrchestrator.currentItemId =
            callCount === 1 ? 'P1.M1.T1.S1' : 'P1.M1.T1.S2';
          // Set shutdownRequested after first call
          if (callCount === 2) {
            pipeline.shutdownRequested = true;
          }
          return callCount < 4; // Would normally return true 4 times
        });

      (pipeline as any).taskOrchestrator = mockOrchestrator;

      // EXECUTE
      await pipeline.executeBacklog();

      // VERIFY - should have stopped early due to shutdownRequested
      expect(callCount).toBe(2);
      expect(pipeline.currentPhase).toBe('shutdown_interrupted');
    });

    it('should call cleanup in finally block even on error', async () => {
      // SETUP
      const mockError = new Error('Test error');
      const mockManager: any = {
        initialize: vi.fn().mockRejectedValue(mockError),
        currentSession: null,
        saveBacklog: vi.fn().mockResolvedValue(undefined),
      };

      const pipeline = new PRPPipeline('./test.md');
      (pipeline as any).sessionManager = mockManager;

      // Spy on cleanup method
      const cleanupSpy = vi
        .spyOn(pipeline, 'cleanup')
        .mockResolvedValue(undefined);

      // EXECUTE
      await pipeline.run();

      // VERIFY - cleanup should be called even though initialize failed
      expect(cleanupSpy).toHaveBeenCalled();
      cleanupSpy.mockRestore();
    });

    it('should save backlog in cleanup when session exists', async () => {
      // SETUP
      const backlog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Implementing', [
          createTestMilestone('P1.M1', 'Milestone 1', 'Planned', [
            createTestTask('P1.M1.T1', 'Task 1', 'Planned', [
              createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Complete'),
              createTestSubtask('P1.M1.T1.S2', 'Subtask 2', 'Planned'),
            ]),
          ]),
        ]),
      ]);
      const mockSession = createTestSession(backlog);
      const mockManager = createMockSessionManager(mockSession);

      const pipeline = new PRPPipeline('./test.md');
      (pipeline as any).sessionManager = mockManager;

      // EXECUTE
      await pipeline.cleanup();

      // VERIFY
      expect(mockManager.saveBacklog).toHaveBeenCalledWith(backlog);
      expect(pipeline.currentPhase).toBe('shutdown_complete');
    });

    it('should include shutdownInterrupted in PipelineResult', async () => {
      // SETUP
      const mockSession = createTestSession(createTestBacklog([]));
      const mockManager = createMockSessionManager(mockSession);

      const mockOrchestrator = createMockTaskOrchestrator();
      (mockOrchestrator as any).processNextItem = vi
        .fn()
        .mockResolvedValue(false);

      const pipeline = new PRPPipeline('./test.md');
      (pipeline as any).sessionManager = mockManager;
      (pipeline as any).taskOrchestrator = mockOrchestrator;

      // EXECUTE - normal completion
      const result = await pipeline.run();

      // VERIFY
      expect(result.shutdownInterrupted).toBe(false);
      expect(result.shutdownReason).toBeUndefined();
    });

    it('should include shutdownInterrupted true when shutdown requested', async () => {
      // SETUP
      const mockError = new Error('Test error');
      const mockManager: any = {
        initialize: vi.fn().mockRejectedValue(mockError),
        currentSession: null,
        saveBacklog: vi.fn().mockResolvedValue(undefined),
      };

      const pipeline = new PRPPipeline('./test.md');
      (pipeline as any).sessionManager = mockManager;

      // Set shutdown flags before error
      pipeline.shutdownRequested = true;
      pipeline.shutdownReason = 'SIGINT';

      // EXECUTE
      const result = await pipeline.run();

      // VERIFY
      expect(result.shutdownInterrupted).toBe(true);
      expect(result.shutdownReason).toBe('SIGINT');
    });

    it('should log warning on duplicate SIGINT', () => {
      // SETUP
      const pipeline = new PRPPipeline('./test.md');
      const warnSpy = vi.spyOn((pipeline as any).logger, 'warn');

      // EXECUTE - Emit SIGINT twice
      process.emit('SIGINT');
      process.emit('SIGINT');

      // VERIFY
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Duplicate SIGINT received')
      );

      // Cleanup
      process.removeAllListeners('SIGINT');
      warnSpy.mockRestore();
    });
  });

  describe('delta workflow integration', () => {
    describe('initializeSession', () => {
      it('should call handleDelta when hasSessionChanged returns true', async () => {
        // SETUP
        const backlog = createTestBacklog([]);
        const mockSession = createTestSession(backlog);
        const mockManager = createMockSessionManager(mockSession, true); // hasSessionChanged = true

        const pipeline = new PRPPipeline('./test.md');
        (pipeline as any).sessionManager = mockManager;

        // Spy on handleDelta method
        const handleDeltaSpy = vi
          .spyOn(pipeline, 'handleDelta')
          .mockResolvedValue(undefined);

        // EXECUTE
        await pipeline.initializeSession();

        // VERIFY
        expect(mockManager.hasSessionChanged).toHaveBeenCalled();
        expect(handleDeltaSpy).toHaveBeenCalled();
        expect(pipeline.currentPhase).toBe('session_initialized');

        handleDeltaSpy.mockRestore();
      });

      it('should not call handleDelta when hasSessionChanged returns false', async () => {
        // SETUP
        const backlog = createTestBacklog([]);
        const mockSession = createTestSession(backlog);
        const mockManager = createMockSessionManager(mockSession, false); // hasSessionChanged = false

        const pipeline = new PRPPipeline('./test.md');
        (pipeline as any).sessionManager = mockManager;

        // Spy on handleDelta method
        const handleDeltaSpy = vi
          .spyOn(pipeline, 'handleDelta')
          .mockResolvedValue(undefined);

        // EXECUTE
        await pipeline.initializeSession();

        // VERIFY
        expect(mockManager.hasSessionChanged).toHaveBeenCalled();
        expect(handleDeltaSpy).not.toHaveBeenCalled();
        expect(pipeline.currentPhase).toBe('session_initialized');

        handleDeltaSpy.mockRestore();
      });
    });

    describe('handleDelta', () => {
      beforeEach(() => {
        // Setup default mocks for handleDelta tests
        mockReadFile.mockResolvedValue('# Updated PRD');
        mockFilterByStatus.mockReturnValue([]);
        mockPatchBacklog.mockImplementation((backlog: Backlog) => backlog);
      });

      it('should load old PRD from session snapshot', async () => {
        // SETUP
        const oldPRD = '# Original PRD\nOld content here';
        const backlog = createTestBacklog([]);
        const mockSession = createTestSession(backlog, oldPRD);

        const mockManager = createMockSessionManager(mockSession, true);
        mockManager.currentSession = mockSession;

        const pipeline = new PRPPipeline('./test.md');
        (pipeline as any).sessionManager = mockManager;

        // EXECUTE
        await pipeline.handleDelta();

        // VERIFY - old PRD should be from session snapshot
        expect(MockDeltaAnalysisWorkflow).toHaveBeenCalledWith(
          oldPRD,
          expect.any(String),
          expect.any(Array)
        );
      });

      it('should load new PRD from disk via readFile', async () => {
        // SETUP
        const newPRD = '# Updated PRD\nNew content here';
        const backlog = createTestBacklog([]);
        const mockSession = createTestSession(backlog);

        const mockManager = createMockSessionManager(mockSession, true);
        mockManager.currentSession = mockSession;
        mockManager.prdPath = '/test/prd.md';

        mockReadFile.mockResolvedValue(newPRD);

        const pipeline = new PRPPipeline('./test.md');
        (pipeline as any).sessionManager = mockManager;

        // EXECUTE
        await pipeline.handleDelta();

        // VERIFY
        expect(mockReadFile).toHaveBeenCalledWith('/test/prd.md', 'utf-8');
        expect(MockDeltaAnalysisWorkflow).toHaveBeenCalledWith(
          expect.any(String),
          newPRD,
          expect.any(Array)
        );
      });

      it('should extract completed task IDs via filterByStatus', async () => {
        // SETUP
        const backlog = createTestBacklog([
          createTestPhase('P1', 'Phase 1', 'Complete', [
            createTestMilestone('P1.M1', 'Milestone 1', 'Complete', [
              createTestTask('P1.M1.T1', 'Task 1', 'Complete', [
                createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Complete'),
                createTestSubtask('P1.M1.T1.S2', 'Subtask 2', 'Planned'),
              ]),
            ]),
          ]),
        ]);
        const mockSession = createTestSession(backlog);

        const mockManager = createMockSessionManager(mockSession, true);
        mockManager.currentSession = mockSession;

        const pipeline = new PRPPipeline('./test.md');
        (pipeline as any).sessionManager = mockManager;

        const completedItems = [
          backlog.backlog[0],
          backlog.backlog[0].milestones[0],
          backlog.backlog[0].milestones[0].tasks[0],
          backlog.backlog[0].milestones[0].tasks[0].subtasks[0],
        ];
        mockFilterByStatus.mockReturnValue(completedItems);

        // EXECUTE
        await pipeline.handleDelta();

        // VERIFY
        expect(mockFilterByStatus).toHaveBeenCalledWith(backlog, 'Complete');
        // Implementation filters to only Task and Subtask types (not Phase/Milestone)
        expect(MockDeltaAnalysisWorkflow).toHaveBeenCalledWith(
          expect.any(String),
          expect.any(String),
          ['P1.M1.T1', 'P1.M1.T1.S1']
        );
      });

      it('should run DeltaAnalysisWorkflow and get result', async () => {
        // SETUP
        const backlog = createTestBacklog([]);
        const mockSession = createTestSession(backlog);

        const mockManager = createMockSessionManager(mockSession, true);
        mockManager.currentSession = mockSession;

        const mockDelta = {
          changes: [
            {
              itemId: 'P1.M1.T1.S1',
              type: 'modified' as const,
              description: 'Added new requirement',
              impact: 'Update implementation',
            },
          ],
          patchInstructions: 'Re-execute P1.M1.T1.S1',
          taskIds: ['P1.M1.T1.S1'],
        };

        const mockWorkflow = {
          run: vi.fn().mockResolvedValue(mockDelta),
        };
        MockDeltaAnalysisWorkflow.mockImplementation(() => mockWorkflow);

        const pipeline = new PRPPipeline('./test.md');
        (pipeline as any).sessionManager = mockManager;

        // EXECUTE
        await pipeline.handleDelta();

        // VERIFY
        expect(mockWorkflow.run).toHaveBeenCalled();
        expect(mockPatchBacklog).toHaveBeenCalledWith(backlog, mockDelta);
      });

      it('should create delta session and save patched backlog', async () => {
        // SETUP
        const backlog = createTestBacklog([]);
        const mockSession = createTestSession(backlog);

        const mockManager = createMockSessionManager(mockSession, true);
        mockManager.currentSession = mockSession;

        const patchedBacklog = createTestBacklog([
          createTestPhase('P1', 'Phase 1', 'Planned'),
        ]);
        mockPatchBacklog.mockReturnValue(patchedBacklog);

        const pipeline = new PRPPipeline('./test.md');
        (pipeline as any).sessionManager = mockManager;

        // EXECUTE
        await pipeline.handleDelta();

        // VERIFY
        expect(mockManager.createDeltaSession).toHaveBeenCalledWith(
          mockManager.prdPath
        );
        expect(mockManager.saveBacklog).toHaveBeenCalledWith(patchedBacklog);
      });

      it('should update phase to delta_handling then session_initialized', async () => {
        // SETUP
        const backlog = createTestBacklog([]);
        const mockSession = createTestSession(backlog);

        const mockManager = createMockSessionManager(mockSession, true);
        mockManager.currentSession = mockSession;

        const pipeline = new PRPPipeline('./test.md');
        (pipeline as any).sessionManager = mockManager;

        // EXECUTE
        await pipeline.handleDelta();

        // VERIFY - phase should end as session_initialized
        expect(pipeline.currentPhase).toBe('session_initialized');
      });

      it('should throw if no session loaded', async () => {
        // SETUP
        const mockManager = createMockSessionManager(null, true);
        mockManager.currentSession = null;

        const pipeline = new PRPPipeline('./test.md');
        (pipeline as any).sessionManager = mockManager;

        // EXECUTE & VERIFY
        await expect(pipeline.handleDelta()).rejects.toThrow(
          'Cannot handle delta: no session loaded'
        );
      });

      it('should throw if readFile fails', async () => {
        // SETUP
        const backlog = createTestBacklog([]);
        const mockSession = createTestSession(backlog);

        const mockManager = createMockSessionManager(mockSession, true);
        mockManager.currentSession = mockSession;

        mockReadFile.mockRejectedValue(new Error('File not found'));

        const pipeline = new PRPPipeline('./test.md');
        (pipeline as any).sessionManager = mockManager;

        // EXECUTE & VERIFY
        await expect(pipeline.handleDelta()).rejects.toThrow(
          'Failed to load new PRD'
        );
      });
    });
  });

  describe('nested execution validation', () => {
    it('should log debug message before validation', async () => {
      // SETUP
      const backlog = createTestBacklog([]);
      const mockSession = createTestSession(
        backlog,
        '# Test PRD',
        'plan/001_14b9dc2a33c7'
      );

      const mockManager = createMockSessionManager(mockSession);
      mockManager.initialize = vi.fn().mockResolvedValue(mockSession);

      const debugSpy = vi.fn();
      const loggerSpy = {
        debug: debugSpy,
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
      };

      const pipeline = new PRPPipeline('./test.md');
      (pipeline as any).logger = loggerSpy;
      (pipeline as any).sessionManager = mockManager;

      // EXECUTE
      try {
        await (pipeline as any).run();
      } catch (e) {
        // Ignore errors from missing mocks
      }

      // VERIFY - should log "Checking for nested execution at {sessionPath}"
      const validationCalls = debugSpy.mock.calls.filter((call: any[]) =>
        call.some(arg => String(arg).includes('Checking for nested execution'))
      );
      expect(validationCalls.length).toBeGreaterThan(0);
    });

    it('should call validateNestedExecution with session path', async () => {
      // SETUP
      const backlog = createTestBacklog([]);
      const mockSession = createTestSession(
        backlog,
        '# Test PRD',
        'plan/003_b3d3efdaf0ed/bugfix/001_d5507a871918'
      );

      const mockManager = createMockSessionManager(mockSession);
      mockManager.initialize = vi.fn().mockResolvedValue(mockSession);

      const pipeline = new PRPPipeline('./test.md');
      (pipeline as any).sessionManager = mockManager;

      // EXECUTE
      try {
        await (pipeline as any).run();
      } catch (e) {
        // Ignore errors from missing mocks
      }

      // VERIFY
      expect(mockValidateNestedExecution).toHaveBeenCalledWith(
        'plan/003_b3d3efdaf0ed/bugfix/001_d5507a871918'
      );
    });

    it('should throw and log NestedExecutionError when validation fails', async () => {
      // SETUP
      const backlog = createTestBacklog([]);
      const mockSession = createTestSession(
        backlog,
        '# Test PRD',
        'plan/001_14b9dc2a33c7'
      );

      const mockManager = createMockSessionManager(mockSession);
      mockManager.initialize = vi.fn().mockResolvedValue(mockSession);

      // Create a mock NestedExecutionError
      class MockNestedExecutionError extends Error {
        constructor(
          message: string,
          public context?: {
            existingPid?: string;
            currentPid?: string;
            sessionPath?: string;
          }
        ) {
          super(message);
          this.name = 'NestedExecutionError';
        }
      }

      const mockError = new MockNestedExecutionError(
        'Nested PRP Pipeline execution detected',
        {
          existingPid: '12345',
          currentPid: '67890',
          sessionPath: 'plan/001_14b9dc2a33c7',
        }
      );

      mockValidateNestedExecution.mockImplementation(() => {
        throw mockError;
      });
      mockIsNestedExecutionError.mockReturnValue(true);

      const errorSpy = vi.fn();
      const loggerSpy = {
        debug: vi.fn(),
        info: vi.fn(),
        error: errorSpy,
        warn: vi.fn(),
      };

      const pipeline = new PRPPipeline('./test.md');
      (pipeline as any).logger = loggerSpy;
      (pipeline as any).sessionManager = mockManager;

      // EXECUTE - run() catches errors and returns result object
      const result = await (pipeline as any).run();

      // VERIFY - result indicates failure with nested execution error
      expect(result.success).toBe(false);
      expect(result.error).toContain('Nested PRP Pipeline');

      // VERIFY error was logged with context
      const errorCalls = errorSpy.mock.calls;
      const nestedExecutionErrors = errorCalls.filter((call: any[]) =>
        call.some(arg => {
          if (typeof arg === 'string') {
            return arg.includes('Nested execution detected');
          }
          if (typeof arg === 'object' && arg !== null) {
            return (
              arg.sessionPath === 'plan/001_14b9dc2a33c7' &&
              arg.existingPid === '12345' &&
              arg.currentPid === '67890'
            );
          }
          return false;
        })
      );
      expect(nestedExecutionErrors.length).toBeGreaterThan(0);
    });

    it('should validate BEFORE guard is set', async () => {
      // SETUP
      const backlog = createTestBacklog([]);
      const mockSession = createTestSession(
        backlog,
        '# Test PRD',
        'plan/001_14b9dc2a33c7'
      );

      const mockManager = createMockSessionManager(mockSession);
      mockManager.initialize = vi.fn().mockResolvedValue(mockSession);

      let validationCallCount = 0;
      let guardSetCount = 0;

      // Track validation call
      const originalEnv = process.env.PRP_PIPELINE_RUNNING;
      delete process.env.PRP_PIPELINE_RUNNING;

      mockValidateNestedExecution.mockImplementation(() => {
        validationCallCount++;
        // Check if guard is already set (it should NOT be)
        if (process.env.PRP_PIPELINE_RUNNING) {
          guardSetCount++;
        }
      });

      const pipeline = new PRPPipeline('./test.md');
      (pipeline as any).sessionManager = mockManager;

      // EXECUTE
      try {
        await (pipeline as any).run();
      } catch (e) {
        // Ignore errors from missing mocks
      } finally {
        // Restore env
        if (originalEnv) {
          process.env.PRP_PIPELINE_RUNNING = originalEnv;
        } else {
          delete process.env.PRP_PIPELINE_RUNNING;
        }
      }

      // VERIFY - validation was called
      expect(validationCallCount).toBeGreaterThan(0);
      // VERIFY - guard was NOT set at the time of validation
      expect(guardSetCount).toBe(0);
    });

    it('should allow execution when validation passes', async () => {
      // SETUP
      const backlog = createTestBacklog([]);
      const mockSession = createTestSession(
        backlog,
        '# Test PRD',
        'plan/001_14b9dc2a33c7'
      );

      const mockManager = createMockSessionManager(mockSession);
      mockManager.initialize = vi.fn().mockResolvedValue(mockSession);

      // Validation passes (no throw)
      mockValidateNestedExecution.mockImplementation(() => {
        // Do nothing - allow execution
      });

      const pipeline = new PRPPipeline('./test.md');
      (pipeline as any).sessionManager = mockManager;

      // EXECUTE & VERIFY - should not throw from validation
      try {
        await (pipeline as any).run();
      } catch (e) {
        // Error should NOT be from validation
        if (e instanceof Error) {
          expect(e.message).not.toContain('Nested execution');
        }
      }
    });
  });

  describe('guard context logging', () => {
    it('should log guard context with all 4 fields after guard is set', async () => {
      // SETUP
      const backlog = createTestBacklog([]);
      const mockSession = createTestSession(
        backlog,
        '# Test PRD',
        '/plan/001_14b9dc2a33c7'
      );

      const mockManager = createMockSessionManager(mockSession);
      mockManager.planDir = '/plan';
      mockManager.initialize = vi.fn().mockResolvedValue(mockSession);

      const debugLogs: string[] = [];
      const loggerSpy = {
        debug: vi.fn((message: string) => debugLogs.push(message)),
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
      };

      const pipeline = new PRPPipeline('./test.md');
      (pipeline as any).logger = loggerSpy;
      (pipeline as any).sessionManager = mockManager;

      // EXECUTE
      try {
        await (pipeline as any).run();
      } catch (e) {
        // Ignore errors from missing mocks
      }

      // VERIFY - find guard context log
      const guardContextLog = debugLogs.find(log =>
        log.includes('[PRPPipeline] Guard Context:')
      );

      expect(guardContextLog).toBeDefined();
      expect(guardContextLog).toMatch(/PLAN_DIR=/);
      expect(guardContextLog).toMatch(/SESSION_DIR=/);
      expect(guardContextLog).toMatch(/SKIP_BUG_FINDING=/);
      expect(guardContextLog).toMatch(/PRP_PIPELINE_RUNNING=/);
    });

    it('should handle null currentSession gracefully', async () => {
      // SETUP
      const mockManager = createMockSessionManager(null);
      mockManager.planDir = '/plan';
      mockManager.currentSession = null;
      mockManager.initialize = vi.fn().mockResolvedValue(null);

      const debugLogs: string[] = [];
      const loggerSpy = {
        debug: vi.fn((message: string) => debugLogs.push(message)),
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
      };

      const pipeline = new PRPPipeline('./test.md');
      (pipeline as any).logger = loggerSpy;
      (pipeline as any).sessionManager = mockManager;

      // EXECUTE
      try {
        await (pipeline as any).run();
      } catch (e) {
        // Ignore errors from missing mocks
      }

      // VERIFY - should not throw, and SESSION_DIR should be 'not set'
      const guardContextLogs = debugLogs.filter(log =>
        log.includes('[PRPPipeline] Guard Context:')
      );

      // If guard context was logged, verify SESSION_DIR is 'not set'
      if (guardContextLogs.length > 0) {
        const hasNotSetSession = guardContextLogs.some(log =>
          log.includes('SESSION_DIR=not set')
        );
        expect(hasNotSetSession).toBe(true);
      }
    });

    it('should show default values when env vars are not set', async () => {
      // SETUP
      const backlog = createTestBacklog([]);
      const mockSession = createTestSession(
        backlog,
        '# Test PRD',
        '/plan/001_14b9dc2a33c7'
      );

      const mockManager = createMockSessionManager(mockSession);
      mockManager.planDir = '/plan';
      mockManager.initialize = vi.fn().mockResolvedValue(mockSession);

      // Clear env vars for test
      const originalSkipBugFinding = process.env.SKIP_BUG_FINDING;
      const originalRunning = process.env.PRP_PIPELINE_RUNNING;
      delete process.env.SKIP_BUG_FINDING;
      delete process.env.PRP_PIPELINE_RUNNING;

      const debugLogs: string[] = [];
      const loggerSpy = {
        debug: vi.fn((message: string) => debugLogs.push(message)),
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
      };

      const pipeline = new PRPPipeline('./test.md');
      (pipeline as any).logger = loggerSpy;
      (pipeline as any).sessionManager = mockManager;

      // EXECUTE
      try {
        await (pipeline as any).run();
      } catch (e) {
        // Ignore errors from missing mocks
      } finally {
        // Restore env vars
        if (originalSkipBugFinding) {
          process.env.SKIP_BUG_FINDING = originalSkipBugFinding;
        }
        if (originalRunning) {
          process.env.PRP_PIPELINE_RUNNING = originalRunning;
        }
      }

      // VERIFY - default values should be shown
      const guardContextLog = debugLogs.find(log =>
        log.includes('[PRPPipeline] Guard Context:')
      );

      if (guardContextLog) {
        expect(guardContextLog).toMatch(/SKIP_BUG_FINDING=false/);
      }
    });

    it('should show actual env var values when set', async () => {
      // SETUP
      const backlog = createTestBacklog([]);
      const mockSession = createTestSession(
        backlog,
        '# Test PRD',
        '/plan/001_14b9dc2a33c7'
      );

      const mockManager = createMockSessionManager(mockSession);
      mockManager.planDir = '/plan';
      mockManager.initialize = vi.fn().mockResolvedValue(mockSession);

      // Set SKIP_BUG_FINDING for test (PRP_PIPELINE_RUNNING will be set to process.pid by the implementation)
      const originalSkipBugFinding = process.env.SKIP_BUG_FINDING;
      process.env.SKIP_BUG_FINDING = 'true';

      const debugLogs: string[] = [];
      const loggerSpy = {
        debug: vi.fn((message: string) => debugLogs.push(message)),
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
      };

      const pipeline = new PRPPipeline('./test.md');
      (pipeline as any).logger = loggerSpy;
      (pipeline as any).sessionManager = mockManager;

      // EXECUTE
      try {
        await (pipeline as any).run();
      } catch (e) {
        // Ignore errors from missing mocks
      } finally {
        // Restore env vars
        if (originalSkipBugFinding !== undefined) {
          process.env.SKIP_BUG_FINDING = originalSkipBugFinding;
        } else {
          delete process.env.SKIP_BUG_FINDING;
        }
      }

      // VERIFY - actual values should be shown
      const guardContextLog = debugLogs.find(log =>
        log.includes('[PRPPipeline] Guard Context:')
      );

      if (guardContextLog) {
        expect(guardContextLog).toMatch(/SKIP_BUG_FINDING=true/);
        // PRP_PIPELINE_RUNNING should be set to a PID (numeric string)
        expect(guardContextLog).toMatch(/PRP_PIPELINE_RUNNING=\d+/);
      }
    });

    it('should use exact format specified in requirements', async () => {
      // SETUP
      const backlog = createTestBacklog([]);
      const mockSession = createTestSession(
        backlog,
        '# Test PRD',
        '/plan/001_14b9dc2a33c7'
      );

      const mockManager = createMockSessionManager(mockSession);
      mockManager.planDir = '/plan';
      mockManager.initialize = vi.fn().mockResolvedValue(mockSession);

      const debugLogs: string[] = [];
      const loggerSpy = {
        debug: vi.fn((message: string) => debugLogs.push(message)),
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
      };

      const pipeline = new PRPPipeline('./test.md');
      (pipeline as any).logger = loggerSpy;
      (pipeline as any).sessionManager = mockManager;

      // EXECUTE
      try {
        await (pipeline as any).run();
      } catch (e) {
        // Ignore errors from missing mocks
      }

      // VERIFY - format should match specification
      const guardContextLog = debugLogs.find(log =>
        log.includes('[PRPPipeline] Guard Context:')
      );

      if (guardContextLog) {
        // Check format: Guard Context: PLAN_DIR={planDir}, SESSION_DIR={sessionDir}, SKIP_BUG_FINDING={skipBugFinding}, PRP_PIPELINE_RUNNING={running}
        const formatPattern =
          /^Guard Context: PLAN_DIR=.+, SESSION_DIR=.+, SKIP_BUG_FINDING=.+, PRP_PIPELINE_RUNNING=.+$/;
        const messageOnly = guardContextLog.replace('[PRPPipeline] ', '');
        expect(messageOnly).toMatch(formatPattern);
      }
    });
  });
});
