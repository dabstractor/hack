/**
 * Unit tests for TaskOrchestrator dependency resolution logic
 *
 * @remarks
 * Tests validate dependency resolution methods in TaskOrchestrator:
 * - canExecute(): Returns true only when all dependencies are Complete
 * - getBlockingDependencies(): Returns only incomplete dependencies
 * - Dependency graph construction from subtask dependency arrays
 *
 * Tests follow the Setup/Execute/Verify pattern with comprehensive edge case coverage.
 * Mocks are used for all SessionManager and task-utils operations - no real I/O is performed.
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { TaskOrchestrator } from '../../../src/core/task-orchestrator.js';
import type { SessionManager } from '../../../src/core/session-manager.js';
import type { Backlog, Subtask } from '../../../src/core/models.js';
import { Status } from '../../../src/core/models.js';

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

// Mock the task-utils module - control getDependencies return value for isolated testing
vi.mock('../../../src/utils/task-utils.js', () => ({
  findItem: vi.fn(),
  isSubtask: vi.fn(),
  getDependencies: vi.fn(() => []),
}));

// Mock the scope-resolver module
vi.mock('../../../src/core/scope-resolver.js', () => ({
  resolveScope: vi.fn(),
  parseScope: vi.fn(),
}));

// Mock the ResearchQueue class — use importOriginal so the REAL
// ResearchTimeoutError survives mocking (task-orchestrator.ts:903 does
// `error instanceof ResearchTimeoutError`; without importOriginal the class
// binding is undefined → "[vitest] No ResearchTimeoutError export" TypeError).
// The ResearchQueue mock body mirrors the canonical task-orchestrator.test.ts
// mock (all methods the source calls: enqueue/getPRP/processNext/getStats/
// waitForPRP/researchNow/deletePRP) so executeSubtask's research path works.
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
      waitForPRP: vi.fn().mockResolvedValue({
        id: 'default-prp',
        title: 'cached PRP',
      }),
      researchNow: vi.fn().mockResolvedValue({
        id: 'default-prp',
        title: 'inline PRP',
      }),
      deletePRP: vi.fn().mockResolvedValue(undefined),
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
import { getDependencies } from '../../../src/utils/task-utils.js';
import { resolveScope } from '../../../src/core/scope-resolver.js';

// Cast mocked functions
const mockGetDependencies = getDependencies as any;
const mockResolveScope = resolveScope as any;

// Set default mock for resolveScope to return empty array
mockResolveScope.mockReturnValue([]);

// Factory functions for test data
const createTestSubtask = (
  id: string,
  title: string,
  status: Status,
  dependencies: string[] = [],
  context_scope: string = 'Test scope'
): Subtask => ({
  id,
  type: 'Subtask',
  title,
  status,
  story_points: 2,
  dependencies,
  context_scope,
});

const createTestBacklog = (phases: any[]): Backlog => ({
  backlog: phases,
});

// Mock SessionManager
const createMockSessionManager = (taskRegistry: Backlog): SessionManager => {
  const mockManager = {
    currentSession: {
      metadata: { id: '001_14b9dc2a33c7', hash: '14b9dc2a33c7' },
      prdSnapshot: '# Test PRD',
      taskRegistry,
      currentItemId: null,
    },
    updateItemStatus: vi.fn().mockResolvedValue(taskRegistry),
    loadBacklog: vi.fn().mockResolvedValue(taskRegistry),
    flushUpdates: vi.fn().mockResolvedValue(undefined),
  } as unknown as SessionManager;
  return mockManager;
};

describe('TaskOrchestrator - Dependency Resolution', () => {
  let orchestrator: TaskOrchestrator;
  let mockSessionManager: SessionManager;
  let testBacklog: Backlog;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create test backlog
    testBacklog = createTestBacklog([]);

    // Create mock session manager
    mockSessionManager = createMockSessionManager(testBacklog);

    // Create orchestrator instance
    orchestrator = new TaskOrchestrator(mockSessionManager);

    // Reset mock getDependencies to return empty array by default
    mockGetDependencies.mockReturnValue([]);
  });

  describe('canExecute()', () => {
    describe('Happy Path', () => {
      it('should return true when dependencies array is empty', () => {
        // SETUP: Create subtask with no dependencies
        const subtask = createTestSubtask(
          'P1.M1.T1.S1',
          'Test Subtask',
          'Planned',
          [] // Empty dependencies
        );
        mockGetDependencies.mockReturnValue([]);

        // EXECUTE: Check if subtask can execute
        const result = orchestrator.canExecute(subtask);

        // VERIFY: Should return true since no dependencies
        expect(result).toBe(true);
      });

      it('should return true when all dependencies are Complete', () => {
        // SETUP: Create subtask with one Complete dependency
        const subtask = createTestSubtask(
          'P1.M1.T1.S1',
          'Test Subtask',
          'Planned',
          ['P1.M1.T1.S2']
        );
        const dep1 = createTestSubtask(
          'P1.M1.T1.S2',
          'Dependency 1',
          'Complete'
        );
        mockGetDependencies.mockReturnValue([dep1]);

        // EXECUTE: Check if subtask can execute
        const result = orchestrator.canExecute(subtask);

        // VERIFY: Should return true since dependency is Complete
        expect(result).toBe(true);
      });

      it('should return true when multiple dependencies are all Complete', () => {
        // SETUP: Create subtask with three Complete dependencies
        const subtask = createTestSubtask(
          'P1.M1.T1.S1',
          'Test Subtask',
          'Planned',
          ['P1.M1.T1.S2', 'P1.M1.T1.S3', 'P1.M1.T1.S4']
        );
        const dep1 = createTestSubtask(
          'P1.M1.T1.S2',
          'Dependency 1',
          'Complete'
        );
        const dep2 = createTestSubtask(
          'P1.M1.T1.S3',
          'Dependency 2',
          'Complete'
        );
        const dep3 = createTestSubtask(
          'P1.M1.T1.S4',
          'Dependency 3',
          'Complete'
        );
        mockGetDependencies.mockReturnValue([dep1, dep2, dep3]);

        // EXECUTE: Check if subtask can execute
        const result = orchestrator.canExecute(subtask);

        // VERIFY: Should return true since all dependencies are Complete
        expect(result).toBe(true);
      });
    });

    describe('Blocked Cases', () => {
      it('should return false when single dependency is Planned', () => {
        // SETUP: Create subtask with Planned dependency
        const subtask = createTestSubtask(
          'P1.M1.T1.S1',
          'Test Subtask',
          'Planned',
          ['P1.M1.T1.S2']
        );
        const dep1 = createTestSubtask(
          'P1.M1.T1.S2',
          'Dependency 1',
          'Planned'
        );
        mockGetDependencies.mockReturnValue([dep1]);

        // EXECUTE: Check if subtask can execute
        const result = orchestrator.canExecute(subtask);

        // VERIFY: Should return false since dependency is not Complete
        expect(result).toBe(false);
      });

      it('should return false when any dependency is not Complete', () => {
        // SETUP: Create subtask with mix of Complete and Planned dependencies
        const subtask = createTestSubtask(
          'P1.M1.T1.S1',
          'Test Subtask',
          'Planned',
          ['P1.M1.T1.S2', 'P1.M1.T1.S3', 'P1.M1.T1.S4']
        );
        const dep1 = createTestSubtask(
          'P1.M1.T1.S2',
          'Dependency 1',
          'Complete'
        );
        const dep2 = createTestSubtask(
          'P1.M1.T1.S3',
          'Dependency 2',
          'Implementing' // Not Complete
        );
        const dep3 = createTestSubtask(
          'P1.M1.T1.S4',
          'Dependency 3',
          'Complete'
        );
        mockGetDependencies.mockReturnValue([dep1, dep2, dep3]);

        // EXECUTE: Check if subtask can execute
        const result = orchestrator.canExecute(subtask);

        // VERIFY: Should return false since one dependency is not Complete
        expect(result).toBe(false);
      });

      it('should return false for each non-Complete status value', () => {
        // PARAMETERIZE: Test all non-Complete status values
        const nonCompleteStatuses: Status[] = [
          'Planned',
          'Researching',
          'Implementing',
          'Retrying',
          'Failed',
          'Obsolete',
        ];

        nonCompleteStatuses.forEach(status => {
          // SETUP: Create subtask with dependency having specific status
          const subtask = createTestSubtask(
            'P1.M1.T1.S1',
            'Test Subtask',
            'Planned',
            ['P1.M1.T1.S2']
          );
          const dep1 = createTestSubtask('P1.M1.T1.S2', 'Dependency 1', status);
          mockGetDependencies.mockReturnValue([dep1]);

          // EXECUTE & VERIFY: Should return false for all non-Complete statuses
          expect(orchestrator.canExecute(subtask)).toBe(false);
        });
      });

      it('should return false when all dependencies are not Complete', () => {
        // SETUP: Create subtask with all dependencies in various non-Complete states
        const subtask = createTestSubtask(
          'P1.M1.T1.S1',
          'Test Subtask',
          'Planned',
          ['P1.M1.T1.S2', 'P1.M1.T1.S3', 'P1.M1.T1.S4']
        );
        const dep1 = createTestSubtask(
          'P1.M1.T1.S2',
          'Dependency 1',
          'Planned'
        );
        const dep2 = createTestSubtask(
          'P1.M1.T1.S3',
          'Dependency 2',
          'Researching'
        );
        const dep3 = createTestSubtask(
          'P1.M1.T1.S4',
          'Dependency 3',
          'Implementing'
        );
        mockGetDependencies.mockReturnValue([dep1, dep2, dep3]);

        // EXECUTE: Check if subtask can execute
        const result = orchestrator.canExecute(subtask);

        // VERIFY: Should return false since none are Complete
        expect(result).toBe(false);
      });
    });
  });

  describe('getBlockingDependencies()', () => {
    it('should return empty array when all dependencies are Complete', () => {
      // SETUP: Create subtask with all Complete dependencies
      const subtask = createTestSubtask(
        'P1.M1.T1.S1',
        'Test Subtask',
        'Planned',
        ['P1.M1.T1.S2', 'P1.M1.T1.S3']
      );
      const dep1 = createTestSubtask('P1.M1.T1.S2', 'Dependency 1', 'Complete');
      const dep2 = createTestSubtask('P1.M1.T1.S3', 'Dependency 2', 'Complete');
      mockGetDependencies.mockReturnValue([dep1, dep2]);

      // EXECUTE: Get blocking dependencies
      const blockers = orchestrator.getBlockingDependencies(subtask);

      // VERIFY: Should return empty array since all are Complete
      expect(blockers).toEqual([]);
    });

    it('should return empty array when dependencies array is empty', () => {
      // SETUP: Create subtask with no dependencies
      const subtask = createTestSubtask(
        'P1.M1.T1.S1',
        'Test Subtask',
        'Planned',
        []
      );
      mockGetDependencies.mockReturnValue([]);

      // EXECUTE: Get blocking dependencies
      const blockers = orchestrator.getBlockingDependencies(subtask);

      // VERIFY: Should return empty array since no dependencies
      expect(blockers).toEqual([]);
    });

    it('should return only incomplete dependencies', () => {
      // SETUP: Create subtask with mix of Complete and incomplete dependencies
      const subtask = createTestSubtask(
        'P1.M1.T1.S1',
        'Test Subtask',
        'Planned',
        ['P1.M1.T1.S2', 'P1.M1.T1.S3', 'P1.M1.T1.S4']
      );
      const dep1 = createTestSubtask('P1.M1.T1.S2', 'Dependency 1', 'Complete');
      const dep2 = createTestSubtask(
        'P1.M1.T1.S3',
        'Dependency 2',
        'Planned' // Blocking
      );
      const dep3 = createTestSubtask('P1.M1.T1.S4', 'Dependency 3', 'Complete');
      mockGetDependencies.mockReturnValue([dep1, dep2, dep3]);

      // EXECUTE: Get blocking dependencies
      const blockers = orchestrator.getBlockingDependencies(subtask);

      // VERIFY: Should return only the incomplete dependency
      expect(blockers).toHaveLength(1);
      expect(blockers[0].id).toBe('P1.M1.T1.S3');
      expect(blockers[0].status).toBe('Planned');
    });

    it('should return all dependencies when none are Complete', () => {
      // SETUP: Create subtask with all dependencies incomplete
      const subtask = createTestSubtask(
        'P1.M1.T1.S1',
        'Test Subtask',
        'Planned',
        ['P1.M1.T1.S2', 'P1.M1.T1.S3']
      );
      const dep1 = createTestSubtask('P1.M1.T1.S2', 'Dependency 1', 'Planned');
      const dep2 = createTestSubtask(
        'P1.M1.T1.S3',
        'Dependency 2',
        'Researching'
      );
      mockGetDependencies.mockReturnValue([dep1, dep2]);

      // EXECUTE: Get blocking dependencies
      const blockers = orchestrator.getBlockingDependencies(subtask);

      // VERIFY: Should return all dependencies since none are Complete
      expect(blockers).toHaveLength(2);
      expect(blockers[0].id).toBe('P1.M1.T1.S2');
      expect(blockers[1].id).toBe('P1.M1.T1.S3');
    });

    it('should handle multiple incomplete dependencies', () => {
      // SETUP: Create subtask with multiple incomplete dependencies
      const subtask = createTestSubtask(
        'P1.M1.T1.S1',
        'Test Subtask',
        'Planned',
        ['P1.M1.T1.S2', 'P1.M1.T1.S3', 'P1.M1.T1.S4', 'P1.M1.T1.S5']
      );
      const dep1 = createTestSubtask('P1.M1.T1.S2', 'Dependency 1', 'Complete');
      const dep2 = createTestSubtask(
        'P1.M1.T1.S3',
        'Dependency 2',
        'Planned' // Blocking
      );
      const dep3 = createTestSubtask(
        'P1.M1.T1.S4',
        'Dependency 3',
        'Implementing' // Blocking
      );
      const dep4 = createTestSubtask(
        'P1.M1.T1.S5',
        'Dependency 4',
        'Failed' // Blocking
      );
      mockGetDependencies.mockReturnValue([dep1, dep2, dep3, dep4]);

      // EXECUTE: Get blocking dependencies
      const blockers = orchestrator.getBlockingDependencies(subtask);

      // VERIFY: Should return three incomplete dependencies
      expect(blockers).toHaveLength(3);
      expect(blockers.map(b => b.id)).toEqual([
        'P1.M1.T1.S3',
        'P1.M1.T1.S4',
        'P1.M1.T1.S5',
      ]);
    });

    it('should handle dependencies with Failed status', () => {
      // SETUP: Create subtask with Failed dependency
      const subtask = createTestSubtask(
        'P1.M1.T1.S1',
        'Test Subtask',
        'Planned',
        ['P1.M1.T1.S2']
      );
      const dep1 = createTestSubtask('P1.M1.T1.S2', 'Dependency 1', 'Failed');
      mockGetDependencies.mockReturnValue([dep1]);

      // EXECUTE: Get blocking dependencies
      const blockers = orchestrator.getBlockingDependencies(subtask);

      // VERIFY: Failed dependencies should be blocking
      expect(blockers).toHaveLength(1);
      expect(blockers[0].status).toBe('Failed');
    });

    it('should handle dependencies with Obsolete status', () => {
      // SETUP: Create subtask with Obsolete dependency
      const subtask = createTestSubtask(
        'P1.M1.T1.S1',
        'Test Subtask',
        'Planned',
        ['P1.M1.T1.S2']
      );
      const dep1 = createTestSubtask('P1.M1.T1.S2', 'Dependency 1', 'Obsolete');
      mockGetDependencies.mockReturnValue([dep1]);

      // EXECUTE: Get blocking dependencies
      const blockers = orchestrator.getBlockingDependencies(subtask);

      // VERIFY: Obsolete dependencies should be blocking
      expect(blockers).toHaveLength(1);
      expect(blockers[0].status).toBe('Obsolete');
    });
  });

  describe('Edge Cases', () => {
    it('should handle non-existent dependency IDs gracefully', () => {
      // SETUP: Create subtask with non-existent dependency ID
      // getDependencies will return empty array for non-existent IDs
      const subtask = createTestSubtask(
        'P1.M1.T1.S1',
        'Test Subtask',
        'Planned',
        ['NON-EXISTENT-ID']
      );
      mockGetDependencies.mockReturnValue([]); // Non-existent IDs filtered out

      // EXECUTE: Check if subtask can execute
      const canExecResult = orchestrator.canExecute(subtask);

      // EXECUTE: Get blocking dependencies
      const blockers = orchestrator.getBlockingDependencies(subtask);

      // VERIFY: Should handle gracefully - empty array means can execute
      expect(canExecResult).toBe(true);
      expect(blockers).toEqual([]);
    });

    it('should handle self-dependency gracefully', () => {
      // SETUP: Create subtask that depends on itself
      const subtask = createTestSubtask(
        'P1.M1.T1.S1',
        'Test Subtask',
        'Planned',
        ['P1.M1.T1.S1'] // Self-dependency
      );
      // Self-dependency filtered out by isSubtask or resolved as self
      // In practice, getDependencies would return empty or the subtask itself
      // If returned, status is 'Planned' (not Complete), so would block
      mockGetDependencies.mockReturnValue([subtask]);

      // EXECUTE: Check if subtask can execute
      const canExecResult = orchestrator.canExecute(subtask);

      // EXECUTE: Get blocking dependencies
      const blockers = orchestrator.getBlockingDependencies(subtask);

      // VERIFY: Self is not Complete, so should be blocked
      expect(canExecResult).toBe(false);
      expect(blockers).toHaveLength(1);
      expect(blockers[0].id).toBe('P1.M1.T1.S1');
    });

    it('should handle circular dependencies gracefully', () => {
      // SETUP: Create two subtasks that depend on each other
      const subtask1 = createTestSubtask(
        'P1.M1.T1.S1',
        'Subtask 1',
        'Planned',
        ['P1.M1.T1.S2']
      );
      const subtask2 = createTestSubtask(
        'P1.M1.T1.S2',
        'Subtask 2',
        'Planned',
        ['P1.M1.T1.S1']
      );
      // S1 depends on S2, which has status 'Planned'
      mockGetDependencies.mockReturnValue([subtask2]);

      // EXECUTE: Check if subtask1 can execute
      const canExecResult1 = orchestrator.canExecute(subtask1);

      // EXECUTE: Get blocking dependencies for subtask1
      const blockers1 = orchestrator.getBlockingDependencies(subtask1);

      // VERIFY: S1 should be blocked since S2 is not Complete
      expect(canExecResult1).toBe(false);
      expect(blockers1).toHaveLength(1);
      expect(blockers1[0].id).toBe('P1.M1.T1.S2');

      // EXECUTE: Now check S2 (depends on S1)
      mockGetDependencies.mockReturnValue([subtask1]);
      const canExecResult2 = orchestrator.canExecute(subtask2);
      const blockers2 = orchestrator.getBlockingDependencies(subtask2);

      // VERIFY: S2 should also be blocked since S1 is not Complete
      expect(canExecResult2).toBe(false);
      expect(blockers2).toHaveLength(1);
      expect(blockers2[0].id).toBe('P1.M1.T1.S1');

      // VERIFY: No infinite loop occurs - both calls return immediately
    });

    it('should handle empty subtask dependencies array with mock returning empty', () => {
      // SETUP: Create subtask with empty dependencies array
      const subtask = createTestSubtask(
        'P1.M1.T1.S1',
        'Test Subtask',
        'Planned',
        []
      );
      mockGetDependencies.mockReturnValue([]);

      // EXECUTE: Check both methods
      const canExecResult = orchestrator.canExecute(subtask);
      const blockers = orchestrator.getBlockingDependencies(subtask);

      // VERIFY: Empty dependencies = can execute, no blockers
      expect(canExecResult).toBe(true);
      expect(blockers).toEqual([]);
    });
  });

  describe('Integration between canExecute and getBlockingDependencies', () => {
    it('should return consistent results between the two methods', () => {
      // SETUP: Create subtask with mixed dependency states
      const subtask = createTestSubtask(
        'P1.M1.T1.S1',
        'Test Subtask',
        'Planned',
        ['P1.M1.T1.S2', 'P1.M1.T1.S3']
      );
      const dep1 = createTestSubtask('P1.M1.T1.S2', 'Dependency 1', 'Complete');
      const dep2 = createTestSubtask('P1.M1.T1.S3', 'Dependency 2', 'Planned');
      mockGetDependencies.mockReturnValue([dep1, dep2]);

      // EXECUTE: Check both methods
      const canExecResult = orchestrator.canExecute(subtask);
      const blockers = orchestrator.getBlockingDependencies(subtask);

      // VERIFY: If canExecute is false, getBlockingDependencies should return non-empty array
      // If canExecute is true, getBlockingDependencies should return empty array
      if (canExecResult) {
        expect(blockers).toEqual([]);
      } else {
        expect(blockers.length).toBeGreaterThan(0);
      }

      // In this case, canExecute should be false due to dep2
      expect(canExecResult).toBe(false);
      expect(blockers).toHaveLength(1);
      expect(blockers[0].id).toBe('P1.M1.T1.S3');
    });

    it('should maintain consistency when all dependencies become Complete', () => {
      // SETUP: Create subtask with incomplete dependencies
      const subtask = createTestSubtask(
        'P1.M1.T1.S1',
        'Test Subtask',
        'Planned',
        ['P1.M1.T1.S2', 'P1.M1.T1.S3']
      );
      const dep1Incomplete = createTestSubtask(
        'P1.M1.T1.S2',
        'Dependency 1',
        'Planned'
      );
      const dep2Incomplete = createTestSubtask(
        'P1.M1.T1.S3',
        'Dependency 2',
        'Implementing'
      );
      mockGetDependencies.mockReturnValue([dep1Incomplete, dep2Incomplete]);

      // EXECUTE: Initially blocked
      expect(orchestrator.canExecute(subtask)).toBe(false);
      expect(orchestrator.getBlockingDependencies(subtask)).toHaveLength(2);

      // SETUP: Update dependencies to Complete
      const dep1Complete = createTestSubtask(
        'P1.M1.T1.S2',
        'Dependency 1',
        'Complete'
      );
      const dep2Complete = createTestSubtask(
        'P1.M1.T1.S3',
        'Dependency 2',
        'Complete'
      );
      mockGetDependencies.mockReturnValue([dep1Complete, dep2Complete]);

      // EXECUTE: Now should be able to execute
      expect(orchestrator.canExecute(subtask)).toBe(true);
      expect(orchestrator.getBlockingDependencies(subtask)).toEqual([]);
    });
  });
});
