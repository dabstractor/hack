/**
 * Unit tests for TaskOrchestrator class
 *
 * @remarks
 * Tests validate TaskOrchestrator class from src/core/task-orchestrator.ts with 100% coverage.
 * Tests follow the Setup/Execute/Verify pattern with comprehensive edge case coverage.
 *
 * Mocks are used for all SessionManager and task-utils operations - no real I/O is performed.
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { TaskOrchestrator } from '../../../src/core/task-orchestrator.js';
import { ResearchTimeoutError } from '../../../src/core/research-queue.js';
import type { SessionManager } from '../../../src/core/session-manager.js';
import type { Backlog } from '../../../src/core/models.js';
import { Status } from '../../../src/core/models.js';
import type { Scope } from '../../../src/core/scope-resolver.js';
import type { HierarchyItem } from '../../../src/utils/task-utils.js';

// Mock the logger with hoisted variables
const { mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock the logger module before importing
vi.mock('../../../src/utils/logger.js', () => ({
  getLogger: vi.fn(() => mockLogger),
}));

// Mock the task-utils module - use importOriginal to get real getDependencies implementation
vi.mock('../../../src/utils/task-utils.js', async importOriginal => {
  const actual =
    await importOriginal<typeof import('../../../src/utils/task-utils.js')>();
  return {
    ...actual,
    getNextPendingItem: vi.fn(),
  };
});

// Mock the scope-resolver module
vi.mock('../../../src/core/scope-resolver.js', () => ({
  resolveScope: vi.fn(),
  parseScope: vi.fn(),
}));

// Mock the git-commit module for smartCommit tests
vi.mock('../../../src/utils/git-commit.js', () => ({
  smartCommit: vi.fn(),
  filterProtectedFiles: vi.fn((files: string[]) => files),
  formatCommitMessage: vi.fn((msg: string) => msg),
}));

// Mock the ResearchQueue class — use importOriginal so the REAL
// ResearchTimeoutError (S2 export) survives mocking (else instanceof TypeError).
vi.mock('../../../src/core/research-queue.js', async importOriginal => {
  const actual =
    await importOriginal<
      typeof import('../../../src/core/research-queue.js')
    >();
  return {
    ...actual,
    ResearchQueue: vi.fn().mockImplementation(() => ({
      enqueue: vi.fn().mockResolvedValue(undefined),
      getPRP: vi.fn().mockReturnValue(null),
      processNext: vi.fn().mockResolvedValue(undefined),
      getStats: vi
        .fn()
        .mockReturnValue({ queued: 0, researching: 0, cached: 0 }),
      waitForPRP: vi
        .fn()
        .mockResolvedValue({ id: 'default-prp', title: 'cached PRP' }),
      researchNow: vi
        .fn()
        .mockResolvedValue({ id: 'default-prp', title: 'inline PRP' }),
    })),
  };
});

// Mock the PRPRuntime class
vi.mock('../../../src/agents/prp-runtime.js', () => ({
  PRPRuntime: vi.fn().mockImplementation(() => ({
    executeSubtask: vi.fn().mockResolvedValue({
      success: true,
      validationResults: [],
      artifacts: [],
      error: undefined,
      fixAttempts: 0,
    }),
  })),
}));

// Import mocked functions
import { getNextPendingItem } from '../../../src/utils/task-utils.js';
import { resolveScope } from '../../../src/core/scope-resolver.js';
import { smartCommit } from '../../../src/utils/git-commit.js';

// Cast mocked functions
const mockGetNextPendingItem = getNextPendingItem as any;
const mockResolveScope = resolveScope as any;
const mockSmartCommit = smartCommit as any;

// Set default mock for resolveScope to return empty array (for backward compatibility)
mockResolveScope.mockReturnValue([]);

// Factory functions for test data
const createTestSubtask = (
  id: string,
  title: string,
  status: Status,
  dependencies: string[] = [],
  context_scope: string = 'Test scope'
) => ({
  id,
  type: 'Subtask' as const,
  title,
  status,
  story_points: 2,
  dependencies,
  context_scope,
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

// Mock SessionManager
const createMockSessionManager = (currentSession: any): SessionManager => {
  const mockManager = {
    currentSession,
    updateItemStatus: vi.fn().mockResolvedValue(currentSession?.taskRegistry),
    loadBacklog: vi.fn().mockResolvedValue(currentSession?.taskRegistry),
    flushUpdates: vi.fn().mockResolvedValue(undefined),
  } as unknown as SessionManager;
  return mockManager;
};

describe('TaskOrchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should store sessionManager as readonly property', () => {
      // SETUP: Create mock session manager with active session
      const testBacklog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Planned'),
      ]);
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: testBacklog,
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);

      // EXECUTE
      const orchestrator = new TaskOrchestrator(mockManager);

      // VERIFY
      expect(orchestrator.sessionManager).toBe(mockManager);
    });

    it('should load backlog from session state', () => {
      // SETUP
      const testBacklog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Planned'),
      ]);
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: testBacklog,
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);

      // EXECUTE
      const orchestrator = new TaskOrchestrator(mockManager);

      // VERIFY
      expect(orchestrator.backlog).toEqual(testBacklog);
    });

    it('should throw Error when currentSession is null', () => {
      // SETUP: Session manager without active session
      const mockManager = createMockSessionManager(null);

      // EXECUTE & VERIFY
      expect(() => new TaskOrchestrator(mockManager)).toThrow(
        'Cannot create TaskOrchestrator: no active session'
      );
    });

    it('should expose backlog via getter (read-only access)', () => {
      // SETUP
      const testBacklog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Planned'),
      ]);
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: testBacklog,
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);

      // EXECUTE
      const orchestrator = new TaskOrchestrator(mockManager);

      // VERIFY: Can read backlog via getter
      expect(orchestrator.backlog.backlog).toHaveLength(1);
      expect(orchestrator.backlog.backlog[0].id).toBe('P1');
    });
  });

  describe('executePhase', () => {
    it('should update phase status to Implementing', async () => {
      // SETUP
      const testBacklog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Planned'),
      ]);
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: testBacklog,
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      const orchestrator = new TaskOrchestrator(mockManager);

      const phase = createTestPhase('P1', 'Phase 1', 'Planned');

      // EXECUTE
      await orchestrator.executePhase(phase);

      // VERIFY
      expect(mockManager.updateItemStatus).toHaveBeenCalledWith(
        'P1',
        'Implementing'
      );
    });

    it('should log execution message', async () => {
      // SETUP
      const testBacklog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Planned'),
      ]);
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: testBacklog,
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      const orchestrator = new TaskOrchestrator(mockManager);

      const phase = createTestPhase('P1', 'Phase 1', 'Planned');

      // EXECUTE
      await orchestrator.executePhase(phase);

      // VERIFY
      expect(mockLogger.info).toHaveBeenCalledWith(
        { phaseId: 'P1' },
        'Setting status to Implementing'
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        { phaseId: 'P1', title: 'Phase 1' },
        'Executing Phase'
      );
    });

    it('should handle phase with milestones', async () => {
      // SETUP: Phase with child milestones
      const testBacklog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Planned', [
          createTestMilestone('P1.M1', 'Milestone 1', 'Planned'),
        ]),
      ]);
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: testBacklog,
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      const orchestrator = new TaskOrchestrator(mockManager);

      const phase = createTestPhase('P1', 'Phase 1', 'Planned', [
        createTestMilestone('P1.M1', 'Milestone 1', 'Planned'),
      ]);

      // EXECUTE: executePhase only sets status, doesn't iterate children
      await orchestrator.executePhase(phase);

      // VERIFY: Only phase status updated, children not iterated
      expect(mockManager.updateItemStatus).toHaveBeenCalledWith(
        'P1',
        'Implementing'
      );
      expect(mockManager.updateItemStatus).toHaveBeenCalledTimes(1);
    });
  });

  describe('executeMilestone', () => {
    it('should update milestone status to Implementing', async () => {
      // SETUP
      const testBacklog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Planned', [
          createTestMilestone('P1.M1', 'Milestone 1', 'Planned'),
        ]),
      ]);
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: testBacklog,
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      const orchestrator = new TaskOrchestrator(mockManager);

      const milestone = createTestMilestone('P1.M1', 'Milestone 1', 'Planned');

      // EXECUTE
      await orchestrator.executeMilestone(milestone);

      // VERIFY
      expect(mockManager.updateItemStatus).toHaveBeenCalledWith(
        'P1.M1',
        'Implementing'
      );
    });

    it('should log execution message', async () => {
      // SETUP
      const testBacklog = createTestBacklog([]);
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: testBacklog,
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      const orchestrator = new TaskOrchestrator(mockManager);

      const milestone = createTestMilestone('P1.M1', 'Milestone 1', 'Planned');

      // EXECUTE
      await orchestrator.executeMilestone(milestone);

      // VERIFY
      expect(mockLogger.info).toHaveBeenCalledWith(
        { milestoneId: 'P1.M1' },
        'Setting status to Implementing'
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        { milestoneId: 'P1.M1', title: 'Milestone 1' },
        'Executing Milestone'
      );
    });

    it('should handle milestone with tasks', async () => {
      // SETUP: Milestone with child tasks
      const testBacklog = createTestBacklog([]);
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: testBacklog,
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      const orchestrator = new TaskOrchestrator(mockManager);

      const milestone = createTestMilestone('P1.M1', 'Milestone 1', 'Planned', [
        createTestTask('P1.M1.T1', 'Task 1', 'Planned'),
      ]);

      // EXECUTE: executeMilestone only sets status, doesn't iterate children
      await orchestrator.executeMilestone(milestone);

      // VERIFY: Only milestone status updated
      expect(mockManager.updateItemStatus).toHaveBeenCalledWith(
        'P1.M1',
        'Implementing'
      );
      expect(mockManager.updateItemStatus).toHaveBeenCalledTimes(1);
    });
  });

  describe('executeTask', () => {
    it('should update task status to Implementing', async () => {
      // SETUP
      const testBacklog = createTestBacklog([]);
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: testBacklog,
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      const orchestrator = new TaskOrchestrator(mockManager);

      const task = createTestTask('P1.M1.T1', 'Task 1', 'Planned');

      // EXECUTE
      await orchestrator.executeTask(task);

      // VERIFY
      expect(mockManager.updateItemStatus).toHaveBeenCalledWith(
        'P1.M1.T1',
        'Implementing'
      );
    });

    it('should log execution message', async () => {
      // SETUP
      const testBacklog = createTestBacklog([]);
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: testBacklog,
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      const orchestrator = new TaskOrchestrator(mockManager);

      const task = createTestTask('P1.M1.T1', 'Task 1', 'Planned');

      // EXECUTE
      await orchestrator.executeTask(task);

      // VERIFY
      expect(mockLogger.info).toHaveBeenCalledWith(
        { taskId: 'P1.M1.T1' },
        'Setting status to Implementing'
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        { taskId: 'P1.M1.T1', title: 'Task 1' },
        'Executing Task'
      );
    });

    it('should handle task with subtasks', async () => {
      // SETUP: Task with child subtasks
      const testBacklog = createTestBacklog([]);
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: testBacklog,
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      const orchestrator = new TaskOrchestrator(mockManager);

      const task = createTestTask('P1.M1.T1', 'Task 1', 'Planned', [
        createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Planned'),
      ]);

      // EXECUTE: executeTask only sets status, doesn't iterate children
      await orchestrator.executeTask(task);

      // VERIFY: Only task status updated
      expect(mockManager.updateItemStatus).toHaveBeenCalledWith(
        'P1.M1.T1',
        'Implementing'
      );
      expect(mockManager.updateItemStatus).toHaveBeenCalledTimes(1);
    });
  });

  describe('executeSubtask', () => {
    it('should set subtask status to Implementing then Complete', async () => {
      // SETUP
      const testBacklog = createTestBacklog([]);
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: testBacklog,
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      const orchestrator = new TaskOrchestrator(mockManager);

      const subtask = createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Planned');

      // EXECUTE
      await orchestrator.executeSubtask(subtask);

      // VERIFY: Status updated to Researching, Implementing, then Complete (NEW status progression)
      expect(mockManager.updateItemStatus).toHaveBeenNthCalledWith(
        1,
        'P1.M1.T1.S1',
        'Researching'
      );
      expect(mockManager.updateItemStatus).toHaveBeenNthCalledWith(
        2,
        'P1.M1.T1.S1',
        'Implementing'
      );
      expect(mockManager.updateItemStatus).toHaveBeenNthCalledWith(
        3,
        'P1.M1.T1.S1',
        'Complete'
      );
      expect(mockManager.updateItemStatus).toHaveBeenCalledTimes(3);
    });

    it('should log placeholder execution message', async () => {
      // SETUP
      const testBacklog = createTestBacklog([]);
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: testBacklog,
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      const orchestrator = new TaskOrchestrator(mockManager);

      const subtask = createTestSubtask(
        'P1.M1.T1.S1',
        'Subtask 1',
        'Planned',
        [],
        'Test context scope'
      );

      // EXECUTE
      await orchestrator.executeSubtask(subtask);

      // VERIFY
      expect(mockLogger.info).toHaveBeenCalledWith(
        { subtaskId: 'P1.M1.T1.S1', title: 'Subtask 1' },
        'Executing Subtask'
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        { subtaskId: 'P1.M1.T1.S1' },
        'Starting PRPRuntime execution'
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ subtaskId: 'P1.M1.T1.S1' }),
        'PRPRuntime execution complete'
      );
    });

    it('should handle subtask with dependencies', async () => {
      // SETUP: Subtask with dependencies
      const testBacklog = createTestBacklog([]);
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: testBacklog,
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      const orchestrator = new TaskOrchestrator(mockManager);

      const subtask = createTestSubtask('P1.M1.T1.S2', 'Subtask 2', 'Planned', [
        'P1.M1.T1.S1',
      ]);

      // EXECUTE
      await orchestrator.executeSubtask(subtask);

      // VERIFY: Dependencies don't affect placeholder execution
      expect(mockManager.updateItemStatus).toHaveBeenCalledTimes(3); // Researching + Implementing + Complete
    });

    it('falls back to synchronous inline re-research when waitForPRP abandons (PRD §4.2)', async () => {
      // SETUP
      const testBacklog = createTestBacklog([]);
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: testBacklog,
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      const orchestrator = new TaskOrchestrator(mockManager);

      const subtask = createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Planned');

      // Override mock: waitForPRP rejects with ResearchTimeoutError
      const queue = orchestrator.researchQueue as any;
      queue.waitForPRP = vi
        .fn()
        .mockRejectedValue(new ResearchTimeoutError('P1.M1.T1.S1', 300));
      queue.researchNow = vi
        .fn()
        .mockResolvedValue({ id: 'inline-prp', title: 'Inline re-research' });

      // EXECUTE
      await orchestrator.executeSubtask(subtask);

      // VERIFY: waitForPRP called once, fallback triggered
      expect(queue.waitForPRP).toHaveBeenCalledWith('P1.M1.T1.S1');
      expect(queue.waitForPRP).toHaveBeenCalledTimes(1);

      // VERIFY: researchNow called exactly once with subtask + backlog
      expect(queue.researchNow).toHaveBeenCalledTimes(1);
      expect(queue.researchNow).toHaveBeenCalledWith(subtask, testBacklog);

      // VERIFY: execution proceeded to prpRuntime.executeSubtask
      expect(orchestrator.prpRuntime.executeSubtask).toHaveBeenCalledTimes(1);

      // VERIFY: status ended at Complete (last status call)
      const lastCall = (mockManager.updateItemStatus as any).mock.calls.at(-1);
      expect(lastCall).toEqual(['P1.M1.T1.S1', 'Complete']);

      // VERIFY: exactly 3 status transitions (Researching + Implementing + Complete, no extra)
      expect(mockManager.updateItemStatus).toHaveBeenCalledTimes(3);

      // VERIFY: abandonment logged at info
      expect(mockLogger.info).toHaveBeenCalledWith(
        { subtaskId: 'P1.M1.T1.S1' },
        expect.stringContaining('abandoned')
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        { subtaskId: 'P1.M1.T1.S1' },
        'Synchronous inline re-research complete'
      );
    });

    it('propagates a non-timeout research error instead of falling back', async () => {
      // SETUP
      const testBacklog = createTestBacklog([]);
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: testBacklog,
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      const orchestrator = new TaskOrchestrator(mockManager);

      const subtask = createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Planned');

      // Override mock: waitForPRP rejects with a plain Error (NOT ResearchTimeoutError)
      const queue = orchestrator.researchQueue as any;
      queue.waitForPRP = vi
        .fn()
        .mockRejectedValue(new Error('research infra down'));
      queue.researchNow = vi.fn(); // must NOT be called

      // EXECUTE & VERIFY: error propagates
      await expect(orchestrator.executeSubtask(subtask)).rejects.toThrow(
        'research infra down'
      );

      // VERIFY: researchNow was NOT called
      expect(queue.researchNow).not.toHaveBeenCalled();

      // VERIFY: item marked Failed (inside the existing try/catch)
      const failedCalls = (
        mockManager.updateItemStatus as any
      ).mock.calls.filter((call: any[]) => call[1] === 'Failed');
      expect(failedCalls.length).toBeGreaterThan(0);
      expect(failedCalls[0][0]).toBe('P1.M1.T1.S1');
    });

    describe('smartCommit integration', () => {
      beforeEach(() => {
        // Reset smartCommit mock before each test
        mockSmartCommit.mockReset();
      });

      it('should call smartCommit after subtask completion with correct parameters', async () => {
        // SETUP
        mockSmartCommit.mockResolvedValue('abc123def456');
        const testBacklog = createTestBacklog([]);
        const currentSession = {
          metadata: {
            id: '001_14b9dc2a33c7',
            hash: '14b9dc2a33c7',
            path: '/plan/001_14b9dc2a33c7',
            createdAt: new Date(),
            parentSession: null,
          },
          prdSnapshot: '# Test PRD',
          taskRegistry: testBacklog,
          currentItemId: null,
        };
        const mockManager = createMockSessionManager(currentSession);
        const orchestrator = new TaskOrchestrator(mockManager);

        const subtask = createTestSubtask(
          'P1.M1.T1.S1',
          'Test Subtask',
          'Planned'
        );

        // EXECUTE
        await orchestrator.executeSubtask(subtask);

        // VERIFY: smartCommit was called with session path and commit message
        expect(mockSmartCommit).toHaveBeenCalledWith(
          '/plan/001_14b9dc2a33c7',
          'P1.M1.T1.S1: Test Subtask'
        );
      });

      it('should log commit hash when smartCommit succeeds', async () => {
        // SETUP
        mockSmartCommit.mockResolvedValue('abc123def456');
        const testBacklog = createTestBacklog([]);
        const currentSession = {
          metadata: {
            id: '001_14b9dc2a33c7',
            hash: '14b9dc2a33c7',
            path: '/plan/001_14b9dc2a33c7',
            createdAt: new Date(),
            parentSession: null,
          },
          prdSnapshot: '# Test PRD',
          taskRegistry: testBacklog,
          currentItemId: null,
        };
        const mockManager = createMockSessionManager(currentSession);
        const orchestrator = new TaskOrchestrator(mockManager);

        const subtask = createTestSubtask(
          'P1.M1.T1.S1',
          'Test Subtask',
          'Planned'
        );

        // EXECUTE
        await orchestrator.executeSubtask(subtask);

        // VERIFY: Commit hash was logged
        expect(mockLogger.info).toHaveBeenCalledWith(
          { commitHash: 'abc123def456' },
          'Commit created'
        );
      });

      it('should log when smartCommit returns null (no files to commit)', async () => {
        // SETUP
        mockSmartCommit.mockResolvedValue(null);
        const testBacklog = createTestBacklog([]);
        const currentSession = {
          metadata: {
            id: '001_14b9dc2a33c7',
            hash: '14b9dc2a33c7',
            path: '/plan/001_14b9dc2a33c7',
            createdAt: new Date(),
            parentSession: null,
          },
          prdSnapshot: '# Test PRD',
          taskRegistry: testBacklog,
          currentItemId: null,
        };
        const mockManager = createMockSessionManager(currentSession);
        const orchestrator = new TaskOrchestrator(mockManager);

        const subtask = createTestSubtask(
          'P1.M1.T1.S1',
          'Test Subtask',
          'Planned'
        );

        // EXECUTE
        await orchestrator.executeSubtask(subtask);

        // VERIFY: "No files to commit" was logged
        expect(mockLogger.info).toHaveBeenCalledWith('No files to commit');
      });

      it('should log error but not fail subtask when smartCommit throws', async () => {
        // SETUP
        mockSmartCommit.mockRejectedValue(new Error('Git operation failed'));
        const testBacklog = createTestBacklog([]);
        const currentSession = {
          metadata: {
            id: '001_14b9dc2a33c7',
            hash: '14b9dc2a33c7',
            path: '/plan/001_14b9dc2a33c7',
            createdAt: new Date(),
            parentSession: null,
          },
          prdSnapshot: '# Test PRD',
          taskRegistry: testBacklog,
          currentItemId: null,
        };
        const mockManager = createMockSessionManager(currentSession);
        const orchestrator = new TaskOrchestrator(mockManager);

        const subtask = createTestSubtask(
          'P1.M1.T1.S1',
          'Test Subtask',
          'Planned'
        );

        // EXECUTE
        await orchestrator.executeSubtask(subtask);

        // VERIFY: Subtask still completed despite commit failure
        expect(mockManager.updateItemStatus).toHaveBeenCalledWith(
          'P1.M1.T1.S1',
          'Complete'
        );
        // Error was logged
        expect(mockLogger.error).toHaveBeenCalledWith(
          { error: 'Git operation failed' },
          'Smart commit failed'
        );
      });

      it('should log warning when session path is not available', async () => {
        // SETUP
        const testBacklog = createTestBacklog([]);
        const currentSession = {
          metadata: {
            id: '001_14b9dc2a33c7',
            hash: '14b9dc2a33c7',
            path: undefined as unknown as string, // No path available
            createdAt: new Date(),
            parentSession: null,
          },
          prdSnapshot: '# Test PRD',
          taskRegistry: testBacklog,
          currentItemId: null,
        };
        const mockManager = createMockSessionManager(currentSession);
        const orchestrator = new TaskOrchestrator(mockManager);

        const subtask = createTestSubtask(
          'P1.M1.T1.S1',
          'Test Subtask',
          'Planned'
        );

        // EXECUTE
        await orchestrator.executeSubtask(subtask);

        // VERIFY: Warning was logged and smartCommit was not called
        expect(mockLogger.warn).toHaveBeenCalledWith(
          'Session path not available for smart commit'
        );
        expect(mockSmartCommit).not.toHaveBeenCalled();
      });
    });
  });

  describe('processNextItem', () => {
    it('should use resolveScope from scope-resolver to populate queue', async () => {
      // SETUP
      const testBacklog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Planned'),
      ]);
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: testBacklog,
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);

      const phase = createTestPhase('P1', 'Phase 1', 'Planned');
      mockResolveScope.mockReturnValue([phase] as HierarchyItem[]);

      // EXECUTE
      const orchestrator = new TaskOrchestrator(mockManager);
      await orchestrator.processNextItem();

      // VERIFY: resolveScope was called in constructor with 'all' scope
      expect(mockResolveScope).toHaveBeenCalledWith(testBacklog, {
        type: 'all',
      });
    });

    it('should return true when item found and processed', async () => {
      // SETUP
      const testBacklog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Planned'),
      ]);
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: testBacklog,
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);

      const phase = createTestPhase('P1', 'Phase 1', 'Planned');
      mockResolveScope.mockReturnValue([phase] as HierarchyItem[]);

      // EXECUTE
      const orchestrator = new TaskOrchestrator(mockManager);
      const result = await orchestrator.processNextItem();

      // VERIFY
      expect(result).toBe(true);
    });

    it('should return false when backlog is complete (no items pending)', async () => {
      // SETUP
      const testBacklog = createTestBacklog([]);
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: testBacklog,
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      mockResolveScope.mockReturnValue([]);

      const orchestrator = new TaskOrchestrator(mockManager);

      // EXECUTE
      const result = await orchestrator.processNextItem();

      // VERIFY
      expect(result).toBe(false);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Execution queue empty - processing complete'
      );
    });

    it('should delegate to executePhase when next item is Phase', async () => {
      // SETUP
      const testBacklog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Planned'),
      ]);
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: testBacklog,
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);

      const phase = createTestPhase('P1', 'Phase 1', 'Planned');
      mockResolveScope.mockReturnValue([phase] as HierarchyItem[]);

      // EXECUTE
      const orchestrator = new TaskOrchestrator(mockManager);
      await orchestrator.processNextItem();

      // VERIFY: executePhase was called (status updated)
      expect(mockManager.updateItemStatus).toHaveBeenCalledWith(
        'P1',
        'Implementing'
      );
    });

    it('should delegate to executeMilestone when next item is Milestone', async () => {
      // SETUP
      const testBacklog = createTestBacklog([]);
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: testBacklog,
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);

      const milestone = createTestMilestone('P1.M1', 'Milestone 1', 'Planned');
      mockResolveScope.mockReturnValue([milestone] as HierarchyItem[]);

      // EXECUTE
      const orchestrator = new TaskOrchestrator(mockManager);
      await orchestrator.processNextItem();

      // VERIFY: executeMilestone was called (status updated)
      expect(mockManager.updateItemStatus).toHaveBeenCalledWith(
        'P1.M1',
        'Implementing'
      );
    });

    it('should delegate to executeTask when next item is Task', async () => {
      // SETUP
      const testBacklog = createTestBacklog([]);
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: testBacklog,
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);

      const task = createTestTask('P1.M1.T1', 'Task 1', 'Planned');
      mockResolveScope.mockReturnValue([task] as HierarchyItem[]);

      // EXECUTE
      const orchestrator = new TaskOrchestrator(mockManager);
      await orchestrator.processNextItem();

      // VERIFY: executeTask was called (status updated)
      expect(mockManager.updateItemStatus).toHaveBeenCalledWith(
        'P1.M1.T1',
        'Implementing'
      );
    });

    it('should delegate to executeSubtask when next item is Subtask', async () => {
      // SETUP
      const testBacklog = createTestBacklog([]);
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: testBacklog,
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);

      const subtask = createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Planned');
      mockResolveScope.mockReturnValue([subtask] as HierarchyItem[]);

      // EXECUTE
      const orchestrator = new TaskOrchestrator(mockManager);
      await orchestrator.processNextItem();

      // VERIFY: executeSubtask was called (status updated three times with Researching added)
      expect(mockManager.updateItemStatus).toHaveBeenNthCalledWith(
        1,
        'P1.M1.T1.S1',
        'Researching'
      );
      expect(mockManager.updateItemStatus).toHaveBeenNthCalledWith(
        2,
        'P1.M1.T1.S1',
        'Implementing'
      );
      expect(mockManager.updateItemStatus).toHaveBeenNthCalledWith(
        3,
        'P1.M1.T1.S1',
        'Complete'
      );
    });

    it('should log item being processed', async () => {
      // SETUP
      const testBacklog = createTestBacklog([]);
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: testBacklog,
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);

      const subtask = createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Planned');
      mockResolveScope.mockReturnValue([subtask] as HierarchyItem[]);

      const orchestrator = new TaskOrchestrator(mockManager);

      // EXECUTE
      await orchestrator.processNextItem();

      // VERIFY
      expect(mockLogger.info).toHaveBeenCalledWith(
        { itemId: 'P1.M1.T1.S1', type: 'Subtask' },
        'Processing'
      );
    });

    it('should handle all four hierarchy item types', async () => {
      // SETUP: Test each type in sequence
      const testBacklog = createTestBacklog([]);
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: testBacklog,
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);

      // Test Phase
      const phase = createTestPhase('P1', 'Phase 1', 'Planned');
      mockResolveScope.mockReturnValue([phase] as HierarchyItem[]);
      let orchestrator = new TaskOrchestrator(mockManager);
      await orchestrator.processNextItem();
      expect(mockManager.updateItemStatus).toHaveBeenCalledWith(
        'P1',
        'Implementing'
      );

      // Test Milestone
      const milestone = createTestMilestone('P1.M1', 'Milestone 1', 'Planned');
      mockResolveScope.mockReturnValue([milestone] as HierarchyItem[]);
      orchestrator = new TaskOrchestrator(mockManager);
      await orchestrator.processNextItem();
      expect(mockManager.updateItemStatus).toHaveBeenCalledWith(
        'P1.M1',
        'Implementing'
      );

      // Test Task
      const task = createTestTask('P1.M1.T1', 'Task 1', 'Planned');
      mockResolveScope.mockReturnValue([task] as HierarchyItem[]);
      orchestrator = new TaskOrchestrator(mockManager);
      await orchestrator.processNextItem();
      expect(mockManager.updateItemStatus).toHaveBeenCalledWith(
        'P1.M1.T1',
        'Implementing'
      );

      // Test Subtask
      const subtask = createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Planned');
      mockResolveScope.mockReturnValue([subtask] as HierarchyItem[]);
      orchestrator = new TaskOrchestrator(mockManager);
      await orchestrator.processNextItem();
      expect(mockManager.updateItemStatus).toHaveBeenCalledWith(
        'P1.M1.T1.S1',
        'Implementing'
      );
      expect(mockManager.updateItemStatus).toHaveBeenCalledWith(
        'P1.M1.T1.S1',
        'Complete'
      );
    });
  });

  describe('DFS pre-order traversal', () => {
    it('should process items in correct DFS pre-order: Phase → Milestone → Task → Subtask', async () => {
      // SETUP: Full hierarchy
      const testBacklog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Planned', [
          createTestMilestone('P1.M1', 'Milestone 1', 'Planned', [
            createTestTask('P1.M1.T1', 'Task 1', 'Planned', [
              createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Planned'),
            ]),
          ]),
        ]),
      ]);
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: testBacklog,
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);

      // Simulate DFS pre-order: Phase → Milestone → Task → Subtask
      const phase = createTestPhase('P1', 'Phase 1', 'Planned');
      const milestone = createTestMilestone('P1.M1', 'Milestone 1', 'Planned');
      const task = createTestTask('P1.M1.T1', 'Task 1', 'Planned');
      const subtask = createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Planned');

      mockResolveScope.mockReturnValue([
        phase,
        milestone,
        task,
        subtask,
      ] as HierarchyItem[]);

      const orchestrator = new TaskOrchestrator(mockManager);

      // EXECUTE: Process first item (Phase)
      const result1 = await orchestrator.processNextItem();

      // VERIFY: Phase processed
      expect(result1).toBe(true);
      expect(mockManager.updateItemStatus).toHaveBeenCalledWith(
        'P1',
        'Implementing'
      );

      // EXECUTE: Process second item (Milestone)
      const result2 = await orchestrator.processNextItem();

      // VERIFY: Milestone processed
      expect(result2).toBe(true);
      expect(mockManager.updateItemStatus).toHaveBeenCalledWith(
        'P1.M1',
        'Implementing'
      );

      // EXECUTE: Process third item (Task)
      const result3 = await orchestrator.processNextItem();

      // VERIFY: Task processed
      expect(result3).toBe(true);
      expect(mockManager.updateItemStatus).toHaveBeenCalledWith(
        'P1.M1.T1',
        'Implementing'
      );

      // EXECUTE: Process fourth item (Subtask)
      const result4 = await orchestrator.processNextItem();

      // VERIFY: Subtask processed
      expect(result4).toBe(true);
      expect(mockManager.updateItemStatus).toHaveBeenCalledWith(
        'P1.M1.T1.S1',
        'Complete'
      );
    });
  });

  describe('integration scenarios', () => {
    it('should support complete processing cycle: process items until complete', async () => {
      // SETUP: Mock sequence of items
      const testBacklog = createTestBacklog([]);
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: testBacklog,
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);

      // Simulate: Phase → Milestone → Task → Subtask
      const phase = createTestPhase('P1', 'Phase 1', 'Planned');
      const milestone = createTestMilestone('P1.M1', 'Milestone 1', 'Planned');
      const task = createTestTask('P1.M1.T1', 'Task 1', 'Planned');
      const subtask = createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Planned');

      mockResolveScope.mockReturnValue([
        phase,
        milestone,
        task,
        subtask,
      ] as HierarchyItem[]);

      const orchestrator = new TaskOrchestrator(mockManager);

      // EXECUTE: Process all items
      let count = 0;
      let hasMore = true;
      while (hasMore && count < 10) {
        // Safety limit to prevent infinite loop
        hasMore = await orchestrator.processNextItem();
        count++;
      }

      // VERIFY: All 4 items processed, then returned false
      // count is 5 because we increment after the loop check
      expect(count).toBe(5); // 4 successful + 1 that returned false
      expect(mockManager.updateItemStatus).toHaveBeenCalledWith(
        'P1',
        'Implementing'
      );
      expect(mockManager.updateItemStatus).toHaveBeenCalledWith(
        'P1.M1',
        'Implementing'
      );
      expect(mockManager.updateItemStatus).toHaveBeenCalledWith(
        'P1.M1.T1',
        'Implementing'
      );
      expect(mockManager.updateItemStatus).toHaveBeenCalledWith(
        'P1.M1.T1.S1',
        'Implementing'
      );
      expect(mockManager.updateItemStatus).toHaveBeenCalledWith(
        'P1.M1.T1.S1',
        'Complete'
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Execution queue empty - processing complete'
      );
    });

    it('should handle empty backlog (no items from start)', async () => {
      // SETUP: Empty backlog
      const testBacklog = createTestBacklog([]);
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: testBacklog,
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      mockResolveScope.mockReturnValue([]);

      const orchestrator = new TaskOrchestrator(mockManager);

      // EXECUTE
      const result = await orchestrator.processNextItem();

      // VERIFY: Immediately returns false
      expect(result).toBe(false);
      expect(mockManager.updateItemStatus).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should propagate errors from SessionManager.updateItemStatus', async () => {
      // SETUP
      const testBacklog = createTestBacklog([]);
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: testBacklog,
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      (mockManager.updateItemStatus as any).mockRejectedValue(
        new Error('Update failed')
      );

      const subtask = createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Planned');
      mockResolveScope.mockReturnValue([subtask] as HierarchyItem[]);

      const orchestrator = new TaskOrchestrator(mockManager);

      // EXECUTE & VERIFY
      await expect(orchestrator.processNextItem()).rejects.toThrow(
        'Update failed'
      );
    });

    it('should handle refresh with null session (edge case)', async () => {
      // SETUP: Session becomes null after construction (edge case)
      const testBacklog = createTestBacklog([]);
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: testBacklog,
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);

      const subtask = createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Planned');
      mockResolveScope.mockReturnValue([subtask] as HierarchyItem[]);

      // Create orchestrator with valid session
      const orchestrator = new TaskOrchestrator(mockManager);

      // Simulate session becoming null (edge case)
      (mockManager as any).currentSession = null;

      // EXECUTE & VERIFY: Should throw when trying to refresh backlog after processing
      await expect(orchestrator.processNextItem()).rejects.toThrow(
        'Cannot refresh backlog: no active session'
      );
    });
  });

  describe('discriminated union type narrowing', () => {
    it('should correctly narrow types in delegateByType switch', async () => {
      // SETUP
      const testBacklog = createTestBacklog([]);
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: testBacklog,
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);

      // Test each type - TypeScript should narrow correctly
      const phase = createTestPhase('P1', 'Phase 1', 'Planned');
      const milestone = createTestMilestone('P1.M1', 'Milestone 1', 'Planned');
      const task = createTestTask('P1.M1.T1', 'Task 1', 'Planned');
      const subtask = createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Planned');

      // EXECUTE: Each type should be dispatched correctly
      // Create orchestrator with phase in queue
      mockResolveScope.mockReturnValue([phase] as HierarchyItem[]);
      let orchestrator = new TaskOrchestrator(mockManager);
      await orchestrator.processNextItem();
      expect(mockManager.updateItemStatus).toHaveBeenCalledWith(
        'P1',
        'Implementing'
      );

      // Create new orchestrator with milestone in queue
      mockResolveScope.mockReturnValue([milestone] as HierarchyItem[]);
      orchestrator = new TaskOrchestrator(mockManager);
      await orchestrator.processNextItem();
      expect(mockManager.updateItemStatus).toHaveBeenCalledWith(
        'P1.M1',
        'Implementing'
      );

      // Create new orchestrator with task in queue
      mockResolveScope.mockReturnValue([task] as HierarchyItem[]);
      orchestrator = new TaskOrchestrator(mockManager);
      await orchestrator.processNextItem();
      expect(mockManager.updateItemStatus).toHaveBeenCalledWith(
        'P1.M1.T1',
        'Implementing'
      );

      // Create new orchestrator with subtask in queue
      mockResolveScope.mockReturnValue([subtask] as HierarchyItem[]);
      orchestrator = new TaskOrchestrator(mockManager);
      await orchestrator.processNextItem();
      expect(mockManager.updateItemStatus).toHaveBeenCalledWith(
        'P1.M1.T1.S1',
        'Implementing'
      );
    });
  });

  describe('dependency resolution', () => {
    describe('canExecute()', () => {
      it('should return true when subtask has no dependencies', () => {
        // SETUP
        const testBacklog = createTestBacklog([]);
        const currentSession = {
          metadata: {
            id: '001_14b9dc2a33c7',
            hash: '14b9dc2a33c7',
            path: '/plan/001_14b9dc2a33c7',
            createdAt: new Date(),
            parentSession: null,
          },
          prdSnapshot: '# Test PRD',
          taskRegistry: testBacklog,
          currentItemId: null,
        };
        const mockManager = createMockSessionManager(currentSession);
        const orchestrator = new TaskOrchestrator(mockManager);

        const subtask = createTestSubtask(
          'P1.M1.T1.S1',
          'Subtask 1',
          'Planned',
          []
        );

        // EXECUTE
        const result = orchestrator.canExecute(subtask);

        // VERIFY: No dependencies means can execute
        expect(result).toBe(true);
      });

      it('should return true when all dependencies are Complete', () => {
        // SETUP: Subtask with dependency that is Complete
        const testBacklog = createTestBacklog([
          createTestPhase('P1', 'Phase 1', 'Planned', [
            createTestMilestone('P1.M1', 'Milestone 1', 'Planned', [
              createTestTask('P1.M1.T1', 'Task 1', 'Planned', [
                createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Complete'),
              ]),
            ]),
          ]),
        ]);
        const currentSession = {
          metadata: {
            id: '001_14b9dc2a33c7',
            hash: '14b9dc2a33c7',
            path: '/plan/001_14b9dc2a33c7',
            createdAt: new Date(),
            parentSession: null,
          },
          prdSnapshot: '# Test PRD',
          taskRegistry: testBacklog,
          currentItemId: null,
        };
        const mockManager = createMockSessionManager(currentSession);
        const orchestrator = new TaskOrchestrator(mockManager);

        const subtask = createTestSubtask(
          'P1.M1.T1.S2',
          'Subtask 2',
          'Planned',
          ['P1.M1.T1.S1']
        );

        // EXECUTE
        const result = orchestrator.canExecute(subtask);

        // VERIFY: Dependency is Complete
        expect(result).toBe(true);
      });

      it('should return false when one dependency is not Complete', () => {
        // SETUP: Subtask with dependency that has status 'Planned'
        const testBacklog = createTestBacklog([
          createTestPhase('P1', 'Phase 1', 'Planned', [
            createTestMilestone('P1.M1', 'Milestone 1', 'Planned', [
              createTestTask('P1.M1.T1', 'Task 1', 'Planned', [
                createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Planned'), // Not Complete!
              ]),
            ]),
          ]),
        ]);
        const currentSession = {
          metadata: {
            id: '001_14b9dc2a33c7',
            hash: '14b9dc2a33c7',
            path: '/plan/001_14b9dc2a33c7',
            createdAt: new Date(),
            parentSession: null,
          },
          prdSnapshot: '# Test PRD',
          taskRegistry: testBacklog,
          currentItemId: null,
        };
        const mockManager = createMockSessionManager(currentSession);
        const orchestrator = new TaskOrchestrator(mockManager);

        const subtask = createTestSubtask(
          'P1.M1.T1.S2',
          'Subtask 2',
          'Planned',
          ['P1.M1.T1.S1']
        );

        // EXECUTE
        const result = orchestrator.canExecute(subtask);

        // VERIFY: Dependency is 'Planned', not 'Complete'
        expect(result).toBe(false);
      });

      it('should return false when multiple dependencies are not Complete', () => {
        // SETUP: Subtask with multiple dependencies, none Complete
        const testBacklog = createTestBacklog([
          createTestPhase('P1', 'Phase 1', 'Planned', [
            createTestMilestone('P1.M1', 'Milestone 1', 'Planned', [
              createTestTask('P1.M1.T1', 'Task 1', 'Planned', [
                createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Planned'),
                createTestSubtask('P1.M1.T1.S2', 'Subtask 2', 'Implementing'),
              ]),
            ]),
          ]),
        ]);
        const currentSession = {
          metadata: {
            id: '001_14b9dc2a33c7',
            hash: '14b9dc2a33c7',
            path: '/plan/001_14b9dc2a33c7',
            createdAt: new Date(),
            parentSession: null,
          },
          prdSnapshot: '# Test PRD',
          taskRegistry: testBacklog,
          currentItemId: null,
        };
        const mockManager = createMockSessionManager(currentSession);
        const orchestrator = new TaskOrchestrator(mockManager);

        const subtask = createTestSubtask(
          'P1.M1.T1.S3',
          'Subtask 3',
          'Planned',
          ['P1.M1.T1.S1', 'P1.M1.T1.S2']
        );

        // EXECUTE
        const result = orchestrator.canExecute(subtask);

        // VERIFY: Neither dependency is Complete
        expect(result).toBe(false);
      });

      it('should handle missing dependencies gracefully (treats as non-blocking)', () => {
        // SETUP: Subtask depends on non-existent ID
        const testBacklog = createTestBacklog([]);
        const currentSession = {
          metadata: {
            id: '001_14b9dc2a33c7',
            hash: '14b9dc2a33c7',
            path: '/plan/001_14b9dc2a33c7',
            createdAt: new Date(),
            parentSession: null,
          },
          prdSnapshot: '# Test PRD',
          taskRegistry: testBacklog,
          currentItemId: null,
        };
        const mockManager = createMockSessionManager(currentSession);
        const orchestrator = new TaskOrchestrator(mockManager);

        const subtask = createTestSubtask(
          'P1.M1.T1.S2',
          'Subtask 2',
          'Planned',
          ['NONEXISTENT_ID']
        );

        // EXECUTE
        const result = orchestrator.canExecute(subtask);

        // VERIFY: Missing dependencies are filtered out, so no blockers
        expect(result).toBe(true);
      });
    });

    describe('getBlockingDependencies()', () => {
      it('should return empty array when no dependencies', () => {
        // SETUP
        const testBacklog = createTestBacklog([]);
        const currentSession = {
          metadata: {
            id: '001_14b9dc2a33c7',
            hash: '14b9dc2a33c7',
            path: '/plan/001_14b9dc2a33c7',
            createdAt: new Date(),
            parentSession: null,
          },
          prdSnapshot: '# Test PRD',
          taskRegistry: testBacklog,
          currentItemId: null,
        };
        const mockManager = createMockSessionManager(currentSession);
        const orchestrator = new TaskOrchestrator(mockManager);

        const subtask = createTestSubtask(
          'P1.M1.T1.S1',
          'Subtask 1',
          'Planned',
          []
        );

        // EXECUTE
        const blockers = orchestrator.getBlockingDependencies(subtask);

        // VERIFY
        expect(blockers).toEqual([]);
      });

      it('should return empty array when all dependencies are Complete', () => {
        // SETUP: All dependencies are Complete
        const testBacklog = createTestBacklog([
          createTestPhase('P1', 'Phase 1', 'Planned', [
            createTestMilestone('P1.M1', 'Milestone 1', 'Planned', [
              createTestTask('P1.M1.T1', 'Task 1', 'Planned', [
                createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Complete'),
              ]),
            ]),
          ]),
        ]);
        const currentSession = {
          metadata: {
            id: '001_14b9dc2a33c7',
            hash: '14b9dc2a33c7',
            path: '/plan/001_14b9dc2a33c7',
            createdAt: new Date(),
            parentSession: null,
          },
          prdSnapshot: '# Test PRD',
          taskRegistry: testBacklog,
          currentItemId: null,
        };
        const mockManager = createMockSessionManager(currentSession);
        const orchestrator = new TaskOrchestrator(mockManager);

        const subtask = createTestSubtask(
          'P1.M1.T1.S2',
          'Subtask 2',
          'Planned',
          ['P1.M1.T1.S1']
        );

        // EXECUTE
        const blockers = orchestrator.getBlockingDependencies(subtask);

        // VERIFY: No blocking dependencies (dependency is Complete)
        expect(blockers).toEqual([]);
      });

      it('should return array with one blocking dependency', () => {
        // SETUP: One dependency is not Complete
        const testBacklog = createTestBacklog([
          createTestPhase('P1', 'Phase 1', 'Planned', [
            createTestMilestone('P1.M1', 'Milestone 1', 'Planned', [
              createTestTask('P1.M1.T1', 'Task 1', 'Planned', [
                createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Planned'),
              ]),
            ]),
          ]),
        ]);
        const currentSession = {
          metadata: {
            id: '001_14b9dc2a33c7',
            hash: '14b9dc2a33c7',
            path: '/plan/001_14b9dc2a33c7',
            createdAt: new Date(),
            parentSession: null,
          },
          prdSnapshot: '# Test PRD',
          taskRegistry: testBacklog,
          currentItemId: null,
        };
        const mockManager = createMockSessionManager(currentSession);
        const orchestrator = new TaskOrchestrator(mockManager);

        const subtask = createTestSubtask(
          'P1.M1.T1.S2',
          'Subtask 2',
          'Planned',
          ['P1.M1.T1.S1']
        );

        // EXECUTE
        const blockers = orchestrator.getBlockingDependencies(subtask);

        // VERIFY: One blocking dependency
        expect(blockers).toHaveLength(1);
        expect(blockers[0].id).toBe('P1.M1.T1.S1');
        expect(blockers[0].status).toBe('Planned');
      });

      it('should return array with multiple blocking dependencies', () => {
        // SETUP: Multiple dependencies are not Complete
        const testBacklog = createTestBacklog([
          createTestPhase('P1', 'Phase 1', 'Planned', [
            createTestMilestone('P1.M1', 'Milestone 1', 'Planned', [
              createTestTask('P1.M1.T1', 'Task 1', 'Planned', [
                createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Planned'),
                createTestSubtask('P1.M1.T1.S2', 'Subtask 2', 'Implementing'),
                createTestSubtask('P1.M1.T1.S3', 'Subtask 3', 'Complete'),
              ]),
            ]),
          ]),
        ]);
        const currentSession = {
          metadata: {
            id: '001_14b9dc2a33c7',
            hash: '14b9dc2a33c7',
            path: '/plan/001_14b9dc2a33c7',
            createdAt: new Date(),
            parentSession: null,
          },
          prdSnapshot: '# Test PRD',
          taskRegistry: testBacklog,
          currentItemId: null,
        };
        const mockManager = createMockSessionManager(currentSession);
        const orchestrator = new TaskOrchestrator(mockManager);

        const subtask = createTestSubtask(
          'P1.M1.T1.S4',
          'Subtask 4',
          'Planned',
          ['P1.M1.T1.S1', 'P1.M1.T1.S2', 'P1.M1.T1.S3']
        );

        // EXECUTE
        const blockers = orchestrator.getBlockingDependencies(subtask);

        // VERIFY: Two blocking dependencies (S3 is Complete, so not a blocker)
        expect(blockers).toHaveLength(2);
        const blockerIds = blockers.map(b => b.id).sort();
        expect(blockerIds).toEqual(['P1.M1.T1.S1', 'P1.M1.T1.S2']);
      });

      it('should filter out non-Complete dependencies correctly', () => {
        // SETUP: Mix of Complete and non-Complete dependencies
        const testBacklog = createTestBacklog([
          createTestPhase('P1', 'Phase 1', 'Planned', [
            createTestMilestone('P1.M1', 'Milestone 1', 'Planned', [
              createTestTask('P1.M1.T1', 'Task 1', 'Planned', [
                createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Complete'),
                createTestSubtask('P1.M1.T1.S2', 'Subtask 2', 'Planned'),
                createTestSubtask('P1.M1.T1.S3', 'Subtask 3', 'Complete'),
              ]),
            ]),
          ]),
        ]);
        const currentSession = {
          metadata: {
            id: '001_14b9dc2a33c7',
            hash: '14b9dc2a33c7',
            path: '/plan/001_14b9dc2a33c7',
            createdAt: new Date(),
            parentSession: null,
          },
          prdSnapshot: '# Test PRD',
          taskRegistry: testBacklog,
          currentItemId: null,
        };
        const mockManager = createMockSessionManager(currentSession);
        const orchestrator = new TaskOrchestrator(mockManager);

        const subtask = createTestSubtask(
          'P1.M1.T1.S4',
          'Subtask 4',
          'Planned',
          ['P1.M1.T1.S1', 'P1.M1.T1.S2', 'P1.M1.T1.S3']
        );

        // EXECUTE
        const blockers = orchestrator.getBlockingDependencies(subtask);

        // VERIFY: Only S2 is blocking (S1 and S3 are Complete)
        expect(blockers).toHaveLength(1);
        expect(blockers[0].id).toBe('P1.M1.T1.S2');
      });
    });

    describe('waitForDependencies()', () => {
      beforeEach(() => {
        vi.useFakeTimers();
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      it('should resolve when dependencies become Complete', async () => {
        // SETUP: Subtask with dependencies that will become Complete
        const testBacklog = createTestBacklog([
          createTestPhase('P1', 'Phase 1', 'Planned', [
            createTestMilestone('P1.M1', 'Milestone 1', 'Planned', [
              createTestTask('P1.M1.T1', 'Task 1', 'Planned', [
                createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Planned'),
              ]),
            ]),
          ]),
        ]);
        const currentSession = {
          metadata: {
            id: '001_14b9dc2a33c7',
            hash: '14b9dc2a33c7',
            path: '/plan/001_14b9dc2a33c7',
            createdAt: new Date(),
            parentSession: null,
          },
          prdSnapshot: '# Test PRD',
          taskRegistry: testBacklog,
          currentItemId: null,
        };
        const mockManager = createMockSessionManager(currentSession);
        const orchestrator = new TaskOrchestrator(mockManager);

        const subtask = createTestSubtask(
          'P1.M1.T1.S2',
          'Subtask 2',
          'Planned',
          ['P1.M1.T1.S1']
        );

        // Create a promise that resolves after we manually update the backlog
        const waitPromise = orchestrator.waitForDependencies(subtask, {
          timeout: 5000,
          interval: 100,
        });

        // Simulate dependency becoming Complete after some time
        setTimeout(() => {
          // Update the backlog to have Complete dependency
          const updatedBacklog = createTestBacklog([
            createTestPhase('P1', 'Phase 1', 'Planned', [
              createTestMilestone('P1.M1', 'Milestone 1', 'Planned', [
                createTestTask('P1.M1.T1', 'Task 1', 'Planned', [
                  createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Complete'),
                ]),
              ]),
            ]),
          ]);
          (mockManager as any).currentSession.taskRegistry = updatedBacklog;
        }, 500);

        // EXECUTE: Advance time
        await vi.advanceTimersByTimeAsync(500);

        // VERIFY: Promise should resolve
        await expect(waitPromise).resolves.toBeUndefined();
      });

      it('should reject on timeout if dependencies never Complete', async () => {
        // SETUP: Subtask with dependencies that never become Complete
        const testBacklog = createTestBacklog([
          createTestPhase('P1', 'Phase 1', 'Planned', [
            createTestMilestone('P1.M1', 'Milestone 1', 'Planned', [
              createTestTask('P1.M1.T1', 'Task 1', 'Planned', [
                createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Planned'),
              ]),
            ]),
          ]),
        ]);
        const currentSession = {
          metadata: {
            id: '001_14b9dc2a33c7',
            hash: '14b9dc2a33c7',
            path: '/plan/001_14b9dc2a33c7',
            createdAt: new Date(),
            parentSession: null,
          },
          prdSnapshot: '# Test PRD',
          taskRegistry: testBacklog,
          currentItemId: null,
        };
        const mockManager = createMockSessionManager(currentSession);
        const orchestrator = new TaskOrchestrator(mockManager);

        const subtask = createTestSubtask(
          'P1.M1.T1.S2',
          'Subtask 2',
          'Planned',
          ['P1.M1.T1.S1']
        );

        // EXECUTE: Wait with short timeout
        const waitPromise = orchestrator.waitForDependencies(subtask, {
          timeout: 500,
          interval: 100,
        });

        // Advance past timeout
        await vi.advanceTimersByTimeAsync(600);

        // VERIFY: Should reject with timeout error
        await expect(waitPromise).rejects.toThrow(
          'Timeout waiting for dependencies of P1.M1.T1.S2 after 500ms'
        );
      });

      it('should accept custom interval and timeout options', async () => {
        // SETUP
        const testBacklog = createTestBacklog([
          createTestPhase('P1', 'Phase 1', 'Planned', [
            createTestMilestone('P1.M1', 'Milestone 1', 'Planned', [
              createTestTask('P1.M1.T1', 'Task 1', 'Planned', [
                createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Planned'),
              ]),
            ]),
          ]),
        ]);
        const currentSession = {
          metadata: {
            id: '001_14b9dc2a33c7',
            hash: '14b9dc2a33c7',
            path: '/plan/001_14b9dc2a33c7',
            createdAt: new Date(),
            parentSession: null,
          },
          prdSnapshot: '# Test PRD',
          taskRegistry: testBacklog,
          currentItemId: null,
        };
        const mockManager = createMockSessionManager(currentSession);
        const orchestrator = new TaskOrchestrator(mockManager);

        const subtask = createTestSubtask(
          'P1.M1.T1.S2',
          'Subtask 2',
          'Planned',
          ['P1.M1.T1.S1']
        );

        // EXECUTE: Use custom timeout of 200ms
        const waitPromise = orchestrator.waitForDependencies(subtask, {
          timeout: 200,
          interval: 50,
        });

        // Advance past timeout
        await vi.advanceTimersByTimeAsync(250);

        // VERIFY: Should use custom timeout
        await expect(waitPromise).rejects.toThrow(
          'Timeout waiting for dependencies of P1.M1.T1.S2 after 200ms'
        );
      });
    });

    describe('executeSubtask() with dependencies', () => {
      it('should skip execution when dependencies are not satisfied', async () => {
        // SETUP: Subtask with blocked dependencies
        const testBacklog = createTestBacklog([
          createTestPhase('P1', 'Phase 1', 'Planned', [
            createTestMilestone('P1.M1', 'Milestone 1', 'Planned', [
              createTestTask('P1.M1.T1', 'Task 1', 'Planned', [
                createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Planned'),
              ]),
            ]),
          ]),
        ]);
        const currentSession = {
          metadata: {
            id: '001_14b9dc2a33c7',
            hash: '14b9dc2a33c7',
            path: '/plan/001_14b9dc2a33c7',
            createdAt: new Date(),
            parentSession: null,
          },
          prdSnapshot: '# Test PRD',
          taskRegistry: testBacklog,
          currentItemId: null,
        };
        const mockManager = createMockSessionManager(currentSession);
        const orchestrator = new TaskOrchestrator(mockManager);

        const subtask = createTestSubtask(
          'P1.M1.T1.S2',
          'Subtask 2',
          'Planned',
          ['P1.M1.T1.S1']
        );

        // EXECUTE
        await orchestrator.executeSubtask(subtask);

        // VERIFY: Status updated to Researching (NEW: set at start before dependency check)
        expect(mockManager.updateItemStatus).toHaveBeenCalledWith(
          'P1.M1.T1.S2',
          'Researching'
        );
        expect(mockManager.updateItemStatus).toHaveBeenCalledTimes(1); // Only Researching, no further execution
        expect(mockLogger.info).toHaveBeenCalledWith(
          {
            subtaskId: 'P1.M1.T1.S2',
            blockerId: 'P1.M1.T1.S1',
            blockerTitle: 'Subtask 1',
            blockerStatus: 'Planned',
          },
          'Blocked on dependency'
        );
        expect(mockLogger.warn).toHaveBeenCalledWith(
          { subtaskId: 'P1.M1.T1.S2' },
          'Subtask blocked on dependencies, skipping'
        );
      });

      it('should execute normally when all dependencies are Complete', async () => {
        // SETUP: Subtask with all Complete dependencies
        const testBacklog = createTestBacklog([
          createTestPhase('P1', 'Phase 1', 'Planned', [
            createTestMilestone('P1.M1', 'Milestone 1', 'Planned', [
              createTestTask('P1.M1.T1', 'Task 1', 'Planned', [
                createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Complete'),
              ]),
            ]),
          ]),
        ]);
        const currentSession = {
          metadata: {
            id: '001_14b9dc2a33c7',
            hash: '14b9dc2a33c7',
            path: '/plan/001_14b9dc2a33c7',
            createdAt: new Date(),
            parentSession: null,
          },
          prdSnapshot: '# Test PRD',
          taskRegistry: testBacklog,
          currentItemId: null,
        };
        const mockManager = createMockSessionManager(currentSession);
        const orchestrator = new TaskOrchestrator(mockManager);

        const subtask = createTestSubtask(
          'P1.M1.T1.S2',
          'Subtask 2',
          'Planned',
          ['P1.M1.T1.S1']
        );

        // EXECUTE
        await orchestrator.executeSubtask(subtask);

        // VERIFY: Normal execution flow (status updated three times with Researching added)
        expect(mockManager.updateItemStatus).toHaveBeenNthCalledWith(
          1,
          'P1.M1.T1.S2',
          'Researching'
        );
        expect(mockManager.updateItemStatus).toHaveBeenNthCalledWith(
          2,
          'P1.M1.T1.S2',
          'Implementing'
        );
        expect(mockManager.updateItemStatus).toHaveBeenNthCalledWith(
          3,
          'P1.M1.T1.S2',
          'Complete'
        );
      });

      it('should log all blocking dependencies', async () => {
        // SETUP: Subtask with multiple blocking dependencies
        const testBacklog = createTestBacklog([
          createTestPhase('P1', 'Phase 1', 'Planned', [
            createTestMilestone('P1.M1', 'Milestone 1', 'Planned', [
              createTestTask('P1.M1.T1', 'Task 1', 'Planned', [
                createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Planned'),
                createTestSubtask('P1.M1.T1.S2', 'Subtask 2', 'Implementing'),
              ]),
            ]),
          ]),
        ]);
        const currentSession = {
          metadata: {
            id: '001_14b9dc2a33c7',
            hash: '14b9dc2a33c7',
            path: '/plan/001_14b9dc2a33c7',
            createdAt: new Date(),
            parentSession: null,
          },
          prdSnapshot: '# Test PRD',
          taskRegistry: testBacklog,
          currentItemId: null,
        };
        const mockManager = createMockSessionManager(currentSession);
        const orchestrator = new TaskOrchestrator(mockManager);

        const subtask = createTestSubtask(
          'P1.M1.T1.S3',
          'Subtask 3',
          'Planned',
          ['P1.M1.T1.S1', 'P1.M1.T1.S2']
        );

        // EXECUTE
        await orchestrator.executeSubtask(subtask);

        // VERIFY: Both blocking dependencies logged
        expect(mockLogger.info).toHaveBeenCalledWith(
          {
            subtaskId: 'P1.M1.T1.S3',
            blockerId: 'P1.M1.T1.S1',
            blockerTitle: 'Subtask 1',
            blockerStatus: 'Planned',
          },
          'Blocked on dependency'
        );
        expect(mockLogger.info).toHaveBeenCalledWith(
          {
            subtaskId: 'P1.M1.T1.S3',
            blockerId: 'P1.M1.T1.S2',
            blockerTitle: 'Subtask 2',
            blockerStatus: 'Implementing',
          },
          'Blocked on dependency'
        );
      });
    });

    describe('integration: dependency chain execution', () => {
      it('should execute dependency chain A->B->C in correct order', async () => {
        // SETUP: Three subtasks where S2 depends on S1, S3 depends on S2
        const testBacklog = createTestBacklog([
          createTestPhase('P1', 'Phase 1', 'Planned', [
            createTestMilestone('P1.M1', 'Milestone 1', 'Planned', [
              createTestTask('P1.M1.T1', 'Task 1', 'Planned', [
                createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Planned', []),
                createTestSubtask('P1.M1.T1.S2', 'Subtask 2', 'Planned', [
                  'P1.M1.T1.S1',
                ]),
                createTestSubtask('P1.M1.T1.S3', 'Subtask 3', 'Planned', [
                  'P1.M1.T1.S2',
                ]),
              ]),
            ]),
          ]),
        ]);
        const currentSession = {
          metadata: {
            id: '001_14b9dc2a33c7',
            hash: '14b9dc2a33c7',
            path: '/plan/001_14b9dc2a33c7',
            createdAt: new Date(),
            parentSession: null,
          },
          prdSnapshot: '# Test PRD',
          taskRegistry: testBacklog,
          currentItemId: null,
        };
        const mockManager = createMockSessionManager(currentSession);
        const orchestrator = new TaskOrchestrator(mockManager);

        // EXECUTE: Process items in order (simulating DFS traversal)

        // Step 1: Process S1 (no dependencies) - should execute
        await orchestrator.executeSubtask(
          testBacklog.backlog[0].milestones[0].tasks[0].subtasks[0]
        );
        expect(mockManager.updateItemStatus).toHaveBeenCalledWith(
          'P1.M1.T1.S1',
          'Implementing'
        );
        expect(mockManager.updateItemStatus).toHaveBeenCalledWith(
          'P1.M1.T1.S1',
          'Complete'
        );
        // Update testBacklog to reflect the new status
        testBacklog.backlog[0].milestones[0].tasks[0].subtasks[0] = {
          ...testBacklog.backlog[0].milestones[0].tasks[0].subtasks[0],
          status: 'Complete',
        };

        // Step 2: Try to process S2 (depends on S1, now Complete) - should execute
        await orchestrator.executeSubtask(
          testBacklog.backlog[0].milestones[0].tasks[0].subtasks[1]
        );
        expect(mockManager.updateItemStatus).toHaveBeenCalledWith(
          'P1.M1.T1.S2',
          'Implementing'
        );
        expect(mockManager.updateItemStatus).toHaveBeenCalledWith(
          'P1.M1.T1.S2',
          'Complete'
        );
        // Update testBacklog to reflect the new status
        testBacklog.backlog[0].milestones[0].tasks[0].subtasks[1] = {
          ...testBacklog.backlog[0].milestones[0].tasks[0].subtasks[1],
          status: 'Complete',
        };

        // Step 3: Try to process S3 (depends on S2, now Complete) - should execute
        await orchestrator.executeSubtask(
          testBacklog.backlog[0].milestones[0].tasks[0].subtasks[2]
        );
        expect(mockManager.updateItemStatus).toHaveBeenCalledWith(
          'P1.M1.T1.S3',
          'Implementing'
        );
        expect(mockManager.updateItemStatus).toHaveBeenCalledWith(
          'P1.M1.T1.S3',
          'Complete'
        );
      });

      it('should skip blocked subtasks and continue to executable ones', async () => {
        // SETUP: S2 depends on S1, but S1 is not Complete
        const testBacklog = createTestBacklog([
          createTestPhase('P1', 'Phase 1', 'Planned', [
            createTestMilestone('P1.M1', 'Milestone 1', 'Planned', [
              createTestTask('P1.M1.T1', 'Task 1', 'Planned', [
                createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Planned', []),
                createTestSubtask('P1.M1.T1.S2', 'Subtask 2', 'Planned', [
                  'P1.M1.T1.S1',
                ]),
              ]),
            ]),
          ]),
        ]);
        const currentSession = {
          metadata: {
            id: '001_14b9dc2a33c7',
            hash: '14b9dc2a33c7',
            path: '/plan/001_14b9dc2a33c7',
            createdAt: new Date(),
            parentSession: null,
          },
          prdSnapshot: '# Test PRD',
          taskRegistry: testBacklog,
          currentItemId: null,
        };
        const mockManager = createMockSessionManager(currentSession);
        const orchestrator = new TaskOrchestrator(mockManager);

        // EXECUTE: Try to execute S2 before S1 is Complete

        // S2 should be blocked (but still set to Researching first - NEW behavior)
        await orchestrator.executeSubtask(
          testBacklog.backlog[0].milestones[0].tasks[0].subtasks[1]
        );
        expect(mockManager.updateItemStatus).toHaveBeenCalledWith(
          'P1.M1.T1.S2',
          'Researching'
        ); // Only Researching for blocked subtask (NEW behavior)
        expect(mockManager.updateItemStatus).toHaveBeenCalledTimes(1);

        // S1 should execute normally
        await orchestrator.executeSubtask(
          testBacklog.backlog[0].milestones[0].tasks[0].subtasks[0]
        );
        expect(mockManager.updateItemStatus).toHaveBeenCalledWith(
          'P1.M1.T1.S1',
          'Implementing'
        );
        expect(mockManager.updateItemStatus).toHaveBeenCalledWith(
          'P1.M1.T1.S1',
          'Complete'
        );
      });

      it('should handle cross-boundary dependencies', async () => {
        // SETUP: Subtask in P3.M2.T1 depends on subtask in P1.M1.T1
        const testBacklog = createTestBacklog([
          createTestPhase('P1', 'Phase 1', 'Planned', [
            createTestMilestone('P1.M1', 'Milestone 1', 'Planned', [
              createTestTask('P1.M1.T1', 'Task 1', 'Planned', [
                createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Complete'),
              ]),
            ]),
          ]),
          createTestPhase('P3', 'Phase 3', 'Planned', [
            createTestMilestone('P3.M2', 'Milestone 2', 'Planned', [
              createTestTask('P3.M2.T1', 'Task 1', 'Planned', [
                createTestSubtask('P3.M2.T1.S1', 'Subtask 1', 'Planned', [
                  'P1.M1.T1.S1',
                ]),
              ]),
            ]),
          ]),
        ]);
        const currentSession = {
          metadata: {
            id: '001_14b9dc2a33c7',
            hash: '14b9dc2a33c7',
            path: '/plan/001_14b9dc2a33c7',
            createdAt: new Date(),
            parentSession: null,
          },
          prdSnapshot: '# Test PRD',
          taskRegistry: testBacklog,
          currentItemId: null,
        };
        const mockManager = createMockSessionManager(currentSession);
        const orchestrator = new TaskOrchestrator(mockManager);

        // EXECUTE: Subtask in P3 depends on P1 subtask
        await orchestrator.executeSubtask(
          testBacklog.backlog[1].milestones[0].tasks[0].subtasks[0]
        );

        // VERIFY: Should execute (P1.M1.T1.S1 is Complete)
        expect(mockManager.updateItemStatus).toHaveBeenCalledWith(
          'P3.M2.T1.S1',
          'Implementing'
        );
        expect(mockManager.updateItemStatus).toHaveBeenCalledWith(
          'P3.M2.T1.S1',
          'Complete'
        );
      });
    });
  });

  describe('setStatus()', () => {
    it('should log status transition with correct format', async () => {
      // SETUP
      const testBacklog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Planned'),
      ]);
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: testBacklog,
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      const orchestrator = new TaskOrchestrator(mockManager);

      // EXECUTE
      await orchestrator.setStatus('P1', 'Implementing', 'Starting work');

      // VERIFY
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          itemId: 'P1',
          oldStatus: 'Planned',
          newStatus: 'Implementing',
          reason: 'Starting work',
        }),
        'Status transition'
      );
    });

    it('should call SessionManager.updateItemStatus() with correct parameters', async () => {
      // SETUP
      const testBacklog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Planned'),
      ]);
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: testBacklog,
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      const orchestrator = new TaskOrchestrator(mockManager);

      // EXECUTE
      await orchestrator.setStatus('P1', 'Implementing');

      // VERIFY
      expect(mockManager.updateItemStatus).toHaveBeenCalledWith(
        'P1',
        'Implementing'
      );
    });

    it('should include reason in log when provided', async () => {
      // SETUP
      const testBacklog = createTestBacklog([]);
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: testBacklog,
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      const orchestrator = new TaskOrchestrator(mockManager);

      // EXECUTE
      await orchestrator.setStatus(
        'P1.M1.T1.S1',
        'Complete',
        'All tests passed'
      );

      // VERIFY
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: 'All tests passed',
        }),
        'Status transition'
      );
    });

    it('should handle missing reason parameter', async () => {
      // SETUP
      const testBacklog = createTestBacklog([]);
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: testBacklog,
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      const orchestrator = new TaskOrchestrator(mockManager);

      // EXECUTE
      await orchestrator.setStatus('P1.M1.T1.S1', 'Complete');

      // VERIFY: Should not have reason in structured data
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          itemId: 'P1.M1.T1.S1',
          newStatus: 'Complete',
        }),
        'Status transition'
      );
    });

    it('should call #refreshBacklog() after status update', async () => {
      // SETUP
      const testBacklog = createTestBacklog([]);
      const updatedBacklog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Complete'),
      ]);
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: testBacklog,
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      (mockManager.updateItemStatus as any).mockResolvedValue(updatedBacklog);
      const orchestrator = new TaskOrchestrator(mockManager);

      // EXECUTE
      await orchestrator.setStatus('P1', 'Complete');

      // VERIFY: Check that updateItemStatus was called (which triggers internal refresh)
      expect(mockManager.updateItemStatus).toHaveBeenCalled();
    });
  });

  describe('executeSubtask() status lifecycle', () => {
    it('should set Researching status at start', async () => {
      // SETUP
      const testBacklog = createTestBacklog([]);
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: testBacklog,
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      const orchestrator = new TaskOrchestrator(mockManager);
      const subtask = createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Planned');

      // EXECUTE
      await orchestrator.executeSubtask(subtask);

      // VERIFY: First status update should be 'Researching'
      expect(mockManager.updateItemStatus).toHaveBeenNthCalledWith(
        1,
        'P1.M1.T1.S1',
        'Researching'
      );
    });

    it('should set Implementing status after research', async () => {
      // SETUP
      const testBacklog = createTestBacklog([]);
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: testBacklog,
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      const orchestrator = new TaskOrchestrator(mockManager);
      const subtask = createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Planned');

      // EXECUTE
      await orchestrator.executeSubtask(subtask);

      // VERIFY: Second status update should be 'Implementing'
      expect(mockManager.updateItemStatus).toHaveBeenNthCalledWith(
        2,
        'P1.M1.T1.S1',
        'Implementing'
      );
    });

    it('should set Complete status on success', async () => {
      // SETUP
      const testBacklog = createTestBacklog([]);
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: testBacklog,
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      const orchestrator = new TaskOrchestrator(mockManager);
      const subtask = createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Planned');

      // EXECUTE
      await orchestrator.executeSubtask(subtask);

      // VERIFY: Last status update should be 'Complete'
      expect(mockManager.updateItemStatus).toHaveBeenNthCalledWith(
        3,
        'P1.M1.T1.S1',
        'Complete'
      );
    });

    it('should log Researching status with message', async () => {
      // SETUP
      const testBacklog = createTestBacklog([]);
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: testBacklog,
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      const orchestrator = new TaskOrchestrator(mockManager);
      const subtask = createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Planned');

      // EXECUTE
      await orchestrator.executeSubtask(subtask);

      // VERIFY
      expect(mockLogger.debug).toHaveBeenCalledWith(
        { subtaskId: 'P1.M1.T1.S1' },
        'Researching - preparing PRP'
      );
    });
  });

  describe('error handling with Failed status', () => {
    it('should set Failed status on exception', async () => {
      // SETUP
      const testBacklog = createTestBacklog([]);
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: testBacklog,
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);

      // Mock to throw error during the execution (after Implementing status)
      (mockManager.updateItemStatus as any).mockImplementation(
        async (id: string, status: string) => {
          if (status === 'Complete') {
            throw new Error('Test execution error');
          }
          return testBacklog;
        }
      );

      const orchestrator = new TaskOrchestrator(mockManager);
      const subtask = createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Planned');

      // EXECUTE & VERIFY: Should throw the error
      await expect(orchestrator.executeSubtask(subtask)).rejects.toThrow(
        'Test execution error'
      );

      // VERIFY: Failed status should have been set
      const failedCalls = (
        mockManager.updateItemStatus as any
      ).mock.calls.filter((call: any[]) => call[1] === 'Failed');
      expect(failedCalls.length).toBeGreaterThan(0);
      expect(failedCalls[0][0]).toBe('P1.M1.T1.S1');
      // NOTE: error is logged via mockLogger.error
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          subtaskId: 'P1.M1.T1.S1',
          error: 'Test execution error',
        }),
        'Subtask execution failed'
      );
    });

    it('should include error message in failed status reason', async () => {
      // SETUP
      const testBacklog = createTestBacklog([]);
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: testBacklog,
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);

      // Mock to throw error with specific message
      const testError = new Error('Network timeout during PRP generation');
      (mockManager.updateItemStatus as any).mockImplementation(
        async (id: string, status: string) => {
          if (status === 'Complete') {
            throw testError;
          }
          return testBacklog;
        }
      );

      const orchestrator = new TaskOrchestrator(mockManager);
      const subtask = createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Planned');

      // EXECUTE
      await expect(orchestrator.executeSubtask(subtask)).rejects.toThrow(
        'Network timeout during PRP generation'
      );

      // VERIFY: Failed status was set
      const failedCalls = (
        mockManager.updateItemStatus as any
      ).mock.calls.filter((call: any[]) => call[1] === 'Failed');
      expect(failedCalls.length).toBeGreaterThan(0);
      expect(failedCalls[0][0]).toBe('P1.M1.T1.S1');
      expect(failedCalls[0][1]).toBe('Failed');

      // VERIFY: Error message was logged via setStatus (reason parameter is for logging)
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          itemId: 'P1.M1.T1.S1',
          newStatus: 'Failed',
          reason: 'Execution failed: Network timeout during PRP generation',
        }),
        'Status transition'
      );
    });

    it('should log error with context', async () => {
      // SETUP
      const testBacklog = createTestBacklog([]);
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: testBacklog,
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);

      // Mock to throw error
      const testError = new Error('Test error');
      testError.stack = 'Error: Test error\n    at test.ts:10:15';
      (mockManager.updateItemStatus as any).mockImplementation(
        async (id: string, status: string) => {
          if (status === 'Complete') {
            throw testError;
          }
          return testBacklog;
        }
      );

      const orchestrator = new TaskOrchestrator(mockManager);
      const subtask = createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Planned');

      // EXECUTE
      await expect(orchestrator.executeSubtask(subtask)).rejects.toThrow(
        'Test error'
      );

      // VERIFY: Error was logged with context
      expect(mockLogger.error).toHaveBeenCalledWith(
        {
          subtaskId: 'P1.M1.T1.S1',
          error: 'Test error',
          stack: 'Error: Test error\n    at test.ts:10:15',
        },
        'Subtask execution failed'
      );
    });

    it('should re-throw original error after setting Failed status', async () => {
      // SETUP
      const testBacklog = createTestBacklog([]);
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: testBacklog,
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);

      // Mock to throw error
      const testError = new Error('Custom error message');
      (mockManager.updateItemStatus as any).mockImplementation(
        async (id: string, status: string) => {
          if (status === 'Complete') {
            throw testError;
          }
          return testBacklog;
        }
      );

      const orchestrator = new TaskOrchestrator(mockManager);
      const subtask = createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Planned');

      // EXECUTE & VERIFY: Should re-throw the original error
      await expect(orchestrator.executeSubtask(subtask)).rejects.toThrow(
        'Custom error message'
      );
    });

    it('should handle different error types (Error, string, unknown)', async () => {
      // SETUP: Test with string error
      const testBacklog = createTestBacklog([]);
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: testBacklog,
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);

      // Mock to throw string error
      (mockManager.updateItemStatus as any).mockImplementation(
        async (id: string, status: string) => {
          if (status === 'Complete') {
            throw 'String error message';
          }
          return testBacklog;
        }
      );

      const orchestrator = new TaskOrchestrator(mockManager);
      const subtask = createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Planned');

      // EXECUTE & VERIFY: Should handle string error
      await expect(orchestrator.executeSubtask(subtask)).rejects.toThrow(
        'String error message'
      );

      // VERIFY: Failed status was set
      const failedCalls = (
        mockManager.updateItemStatus as any
      ).mock.calls.filter((call: any[]) => call[1] === 'Failed');
      expect(failedCalls.length).toBeGreaterThan(0);
      expect(failedCalls[0][0]).toBe('P1.M1.T1.S1');
      expect(failedCalls[0][1]).toBe('Failed');

      // VERIFY: Error message was logged via setStatus (reason parameter is for logging)
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          itemId: 'P1.M1.T1.S1',
          newStatus: 'Failed',
          reason: 'Execution failed: String error message',
        }),
        'Status transition'
      );
    });
  });

  describe('status lifecycle integration test', () => {
    it('should follow full status progression: Planned → Researching → Implementing → Complete', async () => {
      // SETUP: Create test subtask with 'Planned' status
      const testBacklog = createTestBacklog([]);
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: testBacklog,
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      const orchestrator = new TaskOrchestrator(mockManager);
      const subtask = createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Planned');

      // EXECUTE
      await orchestrator.executeSubtask(subtask);

      // VERIFY: Status progression order
      expect(mockManager.updateItemStatus).toHaveBeenNthCalledWith(
        1,
        'P1.M1.T1.S1',
        'Researching'
      );
      expect(mockManager.updateItemStatus).toHaveBeenNthCalledWith(
        2,
        'P1.M1.T1.S1',
        'Implementing'
      );
      expect(mockManager.updateItemStatus).toHaveBeenNthCalledWith(
        3,
        'P1.M1.T1.S1',
        'Complete'
      );
      expect(mockManager.updateItemStatus).toHaveBeenCalledTimes(3);
    });

    it('should handle error scenario: Planned → Researching → Implementing → Failed', async () => {
      // SETUP
      const testBacklog = createTestBacklog([]);
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: testBacklog,
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);

      // Mock to throw error at Complete stage
      (mockManager.updateItemStatus as any).mockImplementation(
        async (id: string, status: string) => {
          if (status === 'Complete') {
            throw new Error('Execution failed');
          }
          return testBacklog;
        }
      );

      const orchestrator = new TaskOrchestrator(mockManager);
      const subtask = createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Planned');

      // EXECUTE
      await expect(orchestrator.executeSubtask(subtask)).rejects.toThrow(
        'Execution failed'
      );

      // VERIFY: All status transitions except Complete were called
      expect(mockManager.updateItemStatus).toHaveBeenNthCalledWith(
        1,
        'P1.M1.T1.S1',
        'Researching'
      );
      expect(mockManager.updateItemStatus).toHaveBeenNthCalledWith(
        2,
        'P1.M1.T1.S1',
        'Implementing'
      );

      // Verify Failed was set
      const failedCalls = (
        mockManager.updateItemStatus as any
      ).mock.calls.filter((call: any[]) => call[1] === 'Failed');
      expect(failedCalls.length).toBeGreaterThan(0);

      // Verify error was logged
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          subtaskId: 'P1.M1.T1.S1',
          error: 'Execution failed',
        }),
        'Subtask execution failed'
      );
    });
  });

  describe('constructor with scope parameter', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should default to all items when scope is undefined', () => {
      // SETUP: Create mock session manager
      const testBacklog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Planned', [
          createTestMilestone('P1.M1', 'Milestone 1', 'Planned', [
            createTestTask('P1.M1.T1', 'Task 1', 'Planned', [
              createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Planned'),
            ]),
          ]),
        ]),
      ]);
      const currentSession = {
        metadata: {
          id: 'test-session',
          createdAt: new Date().toISOString(),
          prdPath: './PRD.md',
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: testBacklog,
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);

      // Mock resolveScope to return all leaf subtasks
      const mockSubtasks = [
        createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Planned'),
      ];
      mockResolveScope.mockReturnValue(mockSubtasks);

      // EXECUTE: Create orchestrator without scope
      const orchestrator = new TaskOrchestrator(mockManager);

      // VERIFY: Queue contains all leaf subtasks, resolveScope called with 'all'
      expect(orchestrator.executionQueue).toHaveLength(1);
      expect(orchestrator.executionQueue[0].id).toBe('P1.M1.T1.S1');
      expect(mockResolveScope).toHaveBeenCalledWith(testBacklog, {
        type: 'all',
      });
    });

    it('should populate queue from phase scope', () => {
      // SETUP
      const testBacklog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Planned', [
          createTestMilestone('P1.M1', 'Milestone 1', 'Planned'),
        ]),
      ]);
      const currentSession = {
        metadata: {
          id: 'test-session',
          createdAt: new Date().toISOString(),
          prdPath: './PRD.md',
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: testBacklog,
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);

      // Mock resolveScope to return phase and descendants
      const mockItems = [
        createTestPhase('P1', 'Phase 1', 'Planned'),
        createTestMilestone('P1.M1', 'Milestone 1', 'Planned'),
      ];
      mockResolveScope.mockReturnValue(mockItems as HierarchyItem[]);

      const phaseScope: Scope = { type: 'phase', id: 'P1' };

      // EXECUTE: Create orchestrator with phase scope
      const orchestrator = new TaskOrchestrator(mockManager, phaseScope);

      // VERIFY: Queue populated from scope
      expect(orchestrator.executionQueue).toHaveLength(2);
      expect(orchestrator.executionQueue[0].id).toBe('P1');
      expect(orchestrator.executionQueue[1].id).toBe('P1.M1');
      expect(mockResolveScope).toHaveBeenCalledWith(testBacklog, phaseScope);
    });

    it('should preserve existing behavior without scope (backward compatibility)', () => {
      // SETUP: Same as original constructor test
      const testBacklog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Planned'),
      ]);
      const currentSession = {
        metadata: {
          id: 'test-session',
          createdAt: new Date().toISOString(),
          prdPath: './PRD.md',
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: testBacklog,
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      mockResolveScope.mockReturnValue([]);

      // EXECUTE: Create orchestrator without scope (original behavior)
      const orchestrator = new TaskOrchestrator(mockManager);

      // VERIFY: Should still work, queue defaults to 'all' scope
      expect(orchestrator.sessionManager).toBe(mockManager);
      expect(orchestrator.backlog).toBe(testBacklog);
      expect(mockResolveScope).toHaveBeenCalledWith(testBacklog, {
        type: 'all',
      });
    });
  });

  describe('processNextItem with executionQueue', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should process items from executionQueue in order', async () => {
      // SETUP
      const testBacklog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Planned'),
      ]);
      const currentSession = {
        metadata: {
          id: 'test-session',
          createdAt: new Date().toISOString(),
          prdPath: './PRD.md',
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: testBacklog,
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);

      // Mock resolveScope to return items in order
      const mockItems = [
        createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Planned'),
        createTestSubtask('P1.M1.T1.S2', 'Subtask 2', 'Planned'),
      ];
      mockResolveScope.mockReturnValue(mockItems as HierarchyItem[]);

      const orchestrator = new TaskOrchestrator(mockManager, { type: 'all' });

      // EXECUTE: Process items
      const hasMore1 = await orchestrator.processNextItem();
      const hasMore2 = await orchestrator.processNextItem();
      const hasMore3 = await orchestrator.processNextItem();

      // VERIFY: Items processed, queue drained
      expect(hasMore1).toBe(true);
      expect(hasMore2).toBe(true);
      expect(hasMore3).toBe(false); // Queue empty
      expect(mockManager.updateItemStatus).toHaveBeenCalledTimes(6); // Researching + Implementing + Complete for each (2 * 3 = 6)
    });

    it('should return false when executionQueue is empty', async () => {
      // SETUP
      const testBacklog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Planned'),
      ]);
      const currentSession = {
        metadata: {
          id: 'test-session',
          createdAt: new Date().toISOString(),
          prdPath: './PRD.md',
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: testBacklog,
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);

      // Mock resolveScope to return empty array
      mockResolveScope.mockReturnValue([]);

      const orchestrator = new TaskOrchestrator(mockManager, {
        type: 'phase',
        id: 'P999',
      });

      // EXECUTE: Try to process from empty queue
      const hasMore = await orchestrator.processNextItem();

      // VERIFY: Should return false immediately
      expect(hasMore).toBe(false);
      expect(mockManager.updateItemStatus).not.toHaveBeenCalled();
    });

    it('should delegate to correct type handler', async () => {
      // SETUP
      const testBacklog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Planned'),
      ]);
      const currentSession = {
        metadata: {
          id: 'test-session',
          createdAt: new Date().toISOString(),
          prdPath: './PRD.md',
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: testBacklog,
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);

      // Mock resolveScope to return a Phase item
      const mockPhase = createTestPhase('P1', 'Phase 1', 'Planned');
      mockResolveScope.mockReturnValue([mockPhase] as HierarchyItem[]);

      const orchestrator = new TaskOrchestrator(mockManager, {
        type: 'phase',
        id: 'P1',
      });

      // EXECUTE: Process phase
      const hasMore = await orchestrator.processNextItem();

      // VERIFY: Phase status was updated
      expect(hasMore).toBe(true);
      expect(mockManager.updateItemStatus).toHaveBeenCalledWith(
        'P1',
        'Implementing'
      );
    });
  });

  describe('setScope()', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should change scope and rebuild queue', async () => {
      // SETUP
      const testBacklog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Planned'),
        createTestPhase('P2', 'Phase 2', 'Planned'),
      ]);
      const currentSession = {
        metadata: {
          id: 'test-session',
          createdAt: new Date().toISOString(),
          prdPath: './PRD.md',
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: testBacklog,
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);

      // Initial scope: P1
      const p1Items = [createTestPhase('P1', 'Phase 1', 'Planned')];
      mockResolveScope.mockReturnValue(p1Items as HierarchyItem[]);

      const orchestrator = new TaskOrchestrator(mockManager, {
        type: 'phase',
        id: 'P1',
      });

      // Mock new scope: P2
      const p2Items = [createTestPhase('P2', 'Phase 2', 'Planned')];
      mockResolveScope.mockReturnValue(p2Items as HierarchyItem[]);

      // EXECUTE: Change scope to P2
      await orchestrator.setScope({ type: 'phase', id: 'P2' });

      // VERIFY: Scope logged, queue rebuilt with P2 items
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          oldScope: expect.any(String),
          newScope: '{"type":"phase","id":"P2"}',
        }),
        'Scope change'
      );
      expect(orchestrator.executionQueue).toHaveLength(1);
      expect(orchestrator.executionQueue[0].id).toBe('P2');
      expect(mockResolveScope).toHaveBeenCalledWith(testBacklog, {
        type: 'phase',
        id: 'P2',
      });
    });

    it('should log scope change with old and new scope', async () => {
      // SETUP
      const testBacklog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Planned'),
        createTestPhase('P2', 'Phase 2', 'Planned'),
      ]);
      const currentSession = {
        metadata: {
          id: 'test-session',
          createdAt: new Date().toISOString(),
          prdPath: './PRD.md',
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: testBacklog,
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      mockResolveScope.mockReturnValue([]);

      // Clear previous mock calls
      mockLogger.info.mockClear();

      // Create orchestrator without scope (undefined)
      const orchestrator = new TaskOrchestrator(mockManager);

      // EXECUTE: Change scope to P1
      await orchestrator.setScope({ type: 'phase', id: 'P1' });

      // VERIFY: Log shows old scope as "undefined (all)" and new scope with phase info
      expect(mockLogger.info).toHaveBeenCalledWith(
        { oldScope: 'undefined (all)', newScope: '{"type":"phase","id":"P1"}' },
        'Scope change'
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        { queueSize: 0 },
        'Execution queue rebuilt'
      );
    });

    it('should handle empty scope resolution', async () => {
      // SETUP
      const testBacklog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Planned'),
      ]);
      const currentSession = {
        metadata: {
          id: 'test-session',
          createdAt: new Date().toISOString(),
          prdPath: './PRD.md',
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: testBacklog,
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);

      // Initial items
      const initialItems = [createTestPhase('P1', 'Phase 1', 'Planned')];
      mockResolveScope.mockReturnValue(initialItems as HierarchyItem[]);

      const orchestrator = new TaskOrchestrator(mockManager);

      // Mock empty scope result
      mockResolveScope.mockReturnValue([]);

      // EXECUTE: Change to non-existent scope
      await orchestrator.setScope({ type: 'phase', id: 'P999' });

      // VERIFY: Queue is empty, no error thrown
      expect(orchestrator.executionQueue).toHaveLength(0);
    });

    it('can be called multiple times', async () => {
      // SETUP
      const testBacklog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Planned'),
        createTestPhase('P2', 'Phase 2', 'Planned'),
        createTestPhase('P3', 'Phase 3', 'Planned'),
      ]);
      const currentSession = {
        metadata: {
          id: 'test-session',
          createdAt: new Date().toISOString(),
          prdPath: './PRD.md',
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: testBacklog,
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      mockResolveScope.mockReturnValue([]);

      const orchestrator = new TaskOrchestrator(mockManager);

      // EXECUTE: Change scope multiple times
      await orchestrator.setScope({ type: 'phase', id: 'P1' });
      await orchestrator.setScope({ type: 'phase', id: 'P2' });
      await orchestrator.setScope({ type: 'phase', id: 'P3' });

      // VERIFY: Each call rebuilds queue
      expect(mockResolveScope).toHaveBeenCalledTimes(4); // 1 for constructor + 3 for setScope
      expect(mockResolveScope).toHaveBeenLastCalledWith(testBacklog, {
        type: 'phase',
        id: 'P3',
      });
    });
  });

  describe('executionQueue getter', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should return a copy of the executionQueue', () => {
      // SETUP
      const testBacklog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Planned'),
      ]);
      const currentSession = {
        metadata: {
          id: 'test-session',
          createdAt: new Date().toISOString(),
          prdPath: './PRD.md',
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: testBacklog,
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);

      const mockItems = [
        createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Planned'),
      ];
      mockResolveScope.mockReturnValue(mockItems as HierarchyItem[]);

      const orchestrator = new TaskOrchestrator(mockManager);

      // EXECUTE: Get executionQueue twice
      const queue1 = orchestrator.executionQueue;
      const queue2 = orchestrator.executionQueue;

      // VERIFY: Different references (copies), same content
      expect(queue1).not.toBe(queue2); // Different array references
      expect(queue1).toEqual(queue2); // Same content
    });

    it('should not allow external mutation of internal queue', () => {
      // SETUP
      const testBacklog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Planned'),
      ]);
      const currentSession = {
        metadata: {
          id: 'test-session',
          createdAt: new Date().toISOString(),
          prdPath: './PRD.md',
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: testBacklog,
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);

      const mockItems = [
        createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Planned'),
      ];
      mockResolveScope.mockReturnValue(mockItems as HierarchyItem[]);

      const orchestrator = new TaskOrchestrator(mockManager);

      // EXECUTE: Try to mutate returned queue
      const queue = orchestrator.executionQueue;
      queue.push(
        createTestSubtask('P1.M1.T1.S2', 'Subtask 2', 'Planned') as any
      );

      // VERIFY: Internal queue unchanged
      expect(orchestrator.executionQueue).toHaveLength(1);
      expect(orchestrator.executionQueue[0].id).toBe('P1.M1.T1.S1');
    });
  });

  describe('scope-based execution integration', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should integrate scope with full execution flow', async () => {
      // SETUP: Multi-level backlog
      const testBacklog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Planned', [
          createTestMilestone('P1.M1', 'Milestone 1', 'Planned', [
            createTestTask('P1.M1.T1', 'Task 1', 'Planned', [
              createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Planned'),
              createTestSubtask('P1.M1.T1.S2', 'Subtask 2', 'Planned'),
            ]),
          ]),
        ]),
      ]);
      const currentSession = {
        metadata: {
          id: 'test-session',
          createdAt: new Date().toISOString(),
          prdPath: './PRD.md',
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: testBacklog,
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);

      // Mock scope resolution to return 2 subtasks
      const mockSubtasks = [
        createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Planned'),
        createTestSubtask('P1.M1.T1.S2', 'Subtask 2', 'Planned'),
      ];
      mockResolveScope.mockReturnValue(mockSubtasks as HierarchyItem[]);

      // EXECUTE: Create orchestrator with scope and process all items
      const orchestrator = new TaskOrchestrator(mockManager, {
        type: 'task',
        id: 'P1.M1.T1',
      });
      let hasMore = true;
      let processedCount = 0;

      while (hasMore && processedCount < 10) {
        // Safety limit to prevent infinite loops
        hasMore = await orchestrator.processNextItem();
        processedCount++;
      }

      // VERIFY: Both subtasks processed
      expect(processedCount).toBe(3); // 2 items + 1 final call that returns false
      expect(mockManager.updateItemStatus).toHaveBeenCalledTimes(6); // Researching + Implementing + Complete for each (2 * 3 = 6)
      expect(orchestrator.executionQueue).toHaveLength(0); // Queue empty
    });

    it('should support mid-execution scope changes', async () => {
      // SETUP
      const testBacklog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Planned', [
          createTestMilestone('P1.M1', 'Milestone 1', 'Planned', [
            createTestTask('P1.M1.T1', 'Task 1', 'Planned', [
              createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Planned'),
            ]),
          ]),
          createTestMilestone('P1.M2', 'Milestone 2', 'Planned', [
            createTestTask('P1.M2.T1', 'Task 2', 'Planned', [
              createTestSubtask('P1.M2.T1.S1', 'Subtask 2', 'Planned'),
            ]),
          ]),
        ]),
      ]);
      const currentSession = {
        metadata: {
          id: 'test-session',
          createdAt: new Date().toISOString(),
          prdPath: './PRD.md',
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: testBacklog,
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);

      // Initial scope: M1
      const m1Subtask = createTestSubtask(
        'P1.M1.T1.S1',
        'Subtask 1',
        'Planned'
      );
      mockResolveScope.mockReturnValue([m1Subtask] as HierarchyItem[]);

      const orchestrator = new TaskOrchestrator(mockManager, {
        type: 'milestone',
        id: 'P1.M1',
      });

      // EXECUTE: Process first item
      await orchestrator.processNextItem();

      // Change scope to M2
      const m2Subtask = createTestSubtask(
        'P1.M2.T1.S1',
        'Subtask 2',
        'Planned'
      );
      mockResolveScope.mockReturnValue([m2Subtask] as HierarchyItem[]);

      await orchestrator.setScope({ type: 'milestone', id: 'P1.M2' });

      // Process second item
      await orchestrator.processNextItem();

      // VERIFY: Both items processed
      expect(mockManager.updateItemStatus).toHaveBeenCalledWith(
        'P1.M1.T1.S1',
        'Researching'
      );
      expect(mockManager.updateItemStatus).toHaveBeenCalledWith(
        'P1.M2.T1.S1',
        'Researching'
      );
    });
  });
});
