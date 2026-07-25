/**
 * Unit tests for TaskOrchestrator DFS hierarchical traversal
 *
 * @remarks
 * Tests validate depth-first search (DFS) pre-order traversal behavior of TaskOrchestrator.
 * Tests verify:
 * - CONTRACT a: Traversal order follows DFS pre-order (parent before children)
 * - CONTRACT b: Parent status changes to 'Implementing' when child starts
 * - CONTRACT c: Traversal stops at Subtask level (subtasks are execution units)
 * - CONTRACT d: Traversal respects scope limits (phase/milestone/task filters)
 *
 * Tests follow the Setup/Execute/Verify pattern with comprehensive edge case coverage.
 * Mocks are used for all SessionManager and external operations - no real I/O is performed.
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { TaskOrchestrator } from '../../../src/core/task-orchestrator.js';
import type { SessionManager } from '../../../src/core/session-manager.js';
import type { Backlog } from '../../../src/core/models.js';
import { Status } from '../../../src/core/models.js';
import type { Scope } from '../../../src/core/scope-resolver.js';

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

// Mock the task-utils module
vi.mock('../../../src/utils/task-utils.js', () => ({
  findItem: vi.fn(),
  getDependencies: vi.fn().mockReturnValue([]),
}));

// Mock the scope-resolver module
vi.mock('../../../src/core/scope-resolver.js', () => ({
  resolveScope: vi.fn(),
  parseScope: vi.fn(),
}));

// Mock the git-commit module
vi.mock('../../../src/utils/git-commit.js', () => ({
  smartCommit: vi.fn().mockResolvedValue(null),
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
import { resolveScope } from '../../../src/core/scope-resolver.js';

// Cast mocked functions
const mockResolveScope = resolveScope as any;

// Factory functions for test data
const createTestSubtask = (
  id: string,
  title: string,
  status: Status = 'Planned',
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
  status: Status = 'Planned',
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
  status: Status = 'Planned',
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
  status: Status = 'Planned',
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
const createMockSessionManager = (taskRegistry: Backlog): SessionManager => {
  const currentSession = {
    metadata: {
      id: '001_14b9dc2a33c7',
      hash: '14b9dc2a33c7',
      path: '/plan/001_14b9dc2a33c7',
      createdAt: new Date(),
      parentSession: null,
    },
    prdSnapshot: '# Test PRD',
    taskRegistry,
    currentItemId: null,
  };

  return {
    currentSession,
    updateItemStatus: vi.fn().mockResolvedValue(taskRegistry),
    flushUpdates: vi.fn().mockResolvedValue(undefined),
  } as unknown as SessionManager;
};

describe('TaskOrchestrator - DFS Traversal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('CONTRACT a: DFS pre-order traversal (parent before children)', () => {
    it('should traverse items in DFS pre-order: parent before children', async () => {
      // SETUP: Create full hierarchy with multiple levels
      const subtask1 = createTestSubtask('P1.M1.T1.S1', 'Subtask 1');
      const subtask2 = createTestSubtask('P1.M1.T1.S2', 'Subtask 2');
      const task1 = createTestTask('P1.M1.T1', 'Task 1', 'Planned', [
        subtask1,
        subtask2,
      ]);
      const task2 = createTestTask('P1.M1.T2', 'Task 2', 'Planned', []);
      const milestone1 = createTestMilestone(
        'P1.M1',
        'Milestone 1',
        'Planned',
        [task1, task2]
      );
      const phase1 = createTestPhase('P1', 'Phase 1', 'Planned', [milestone1]);
      const backlog = createTestBacklog([phase1]);

      const mockManager = createMockSessionManager(backlog);

      // Mock resolveScope to return items in DFS order (simulating real traversal)
      mockResolveScope.mockReturnValue([
        phase1,
        milestone1,
        task1,
        subtask1,
        subtask2,
        task2,
      ]);

      // EXECUTE: Create orchestrator and process all items
      const orchestrator = new TaskOrchestrator(mockManager);
      const processedIds: string[] = [];

      let hasMore = true;
      while (hasMore) {
        hasMore = await orchestrator.processNextItem();
        if (orchestrator.currentItemId) {
          processedIds.push(orchestrator.currentItemId);
        }
      }

      // VERIFY: Parent indices are less than child indices (DFS pre-order property)
      const p1Index = processedIds.indexOf('P1');
      const m1Index = processedIds.indexOf('P1.M1');
      const t1Index = processedIds.indexOf('P1.M1.T1');
      const s1Index = processedIds.indexOf('P1.M1.T1.S1');

      expect(p1Index).toBeGreaterThanOrEqual(0);
      expect(p1Index).toBeLessThan(m1Index); // Parent before child
      expect(m1Index).toBeLessThan(t1Index); // Child before grandchild
      expect(t1Index).toBeLessThan(s1Index); // Grandchild before great-grandchild
    });

    it('should maintain sibling order from left to right', async () => {
      // SETUP: Create hierarchy with siblings at same level
      const subtask1 = createTestSubtask('P1.M1.T1.S1', 'Subtask 1');
      const subtask2 = createTestSubtask('P1.M1.T1.S2', 'Subtask 2');
      const task1 = createTestTask('P1.M1.T1', 'Task 1', 'Planned', [
        subtask1,
        subtask2,
      ]);
      const milestone1 = createTestMilestone(
        'P1.M1',
        'Milestone 1',
        'Planned',
        [task1]
      );
      const phase1 = createTestPhase('P1', 'Phase 1', 'Planned', [milestone1]);
      const backlog = createTestBacklog([phase1]);

      const mockManager = createMockSessionManager(backlog);
      mockResolveScope.mockReturnValue([
        phase1,
        milestone1,
        task1,
        subtask1,
        subtask2,
      ]);

      // EXECUTE: Process all items
      const orchestrator = new TaskOrchestrator(mockManager);
      const processedIds: string[] = [];

      let hasMore = true;
      while (hasMore) {
        hasMore = await orchestrator.processNextItem();
        if (orchestrator.currentItemId) {
          processedIds.push(orchestrator.currentItemId);
        }
      }

      // VERIFY: Siblings maintain left-to-right order
      const s1Index = processedIds.indexOf('P1.M1.T1.S1');
      const s2Index = processedIds.indexOf('P1.M1.T1.S2');
      expect(s1Index).toBeLessThan(s2Index); // S1 before S2
    });

    it('should use depth-first not breadth-first traversal', async () => {
      // SETUP: Create wide hierarchy (Phase with 2 milestones, each with tasks)
      const subtask1 = createTestSubtask('P1.M1.T1.S1', 'Subtask 1');
      const task1 = createTestTask('P1.M1.T1', 'Task 1', 'Planned', [subtask1]);
      const milestone1 = createTestMilestone(
        'P1.M1',
        'Milestone 1',
        'Planned',
        [task1]
      );

      const task2 = createTestTask('P1.M2.T1', 'Task 2', 'Planned', []);
      const milestone2 = createTestMilestone(
        'P1.M2',
        'Milestone 2',
        'Planned',
        [task2]
      );

      const phase1 = createTestPhase('P1', 'Phase 1', 'Planned', [
        milestone1,
        milestone2,
      ]);
      const backlog = createTestBacklog([phase1]);

      const mockManager = createMockSessionManager(backlog);
      // DFS order: P1 → P1.M1 → P1.M1.T1 → P1.M1.T1.S1 → P1.M2 → P1.M2.T1
      mockResolveScope.mockReturnValue([
        phase1,
        milestone1,
        task1,
        subtask1,
        milestone2,
        task2,
      ]);

      // EXECUTE: Process all items
      const orchestrator = new TaskOrchestrator(mockManager);
      const processedIds: string[] = [];

      let hasMore = true;
      while (hasMore) {
        hasMore = await orchestrator.processNextItem();
        if (orchestrator.currentItemId) {
          processedIds.push(orchestrator.currentItemId);
        }
      }

      // VERIFY: Grandchild from first milestone comes before second milestone (DFS property)
      const s1Index = processedIds.indexOf('P1.M1.T1.S1');
      const m2Index = processedIds.indexOf('P1.M2');
      expect(s1Index).toBeLessThan(m2Index); // Deep before wide (DFS, not BFS)
    });
  });

  describe('CONTRACT b: Parent status transitions to Implementing', () => {
    it('should set parent status to Implementing when processing children', async () => {
      // SETUP: Create hierarchy
      const subtask = createTestSubtask('P1.M1.T1.S1', 'Subtask 1');
      const task = createTestTask('P1.M1.T1', 'Task 1', 'Planned', [subtask]);
      const milestone = createTestMilestone('P1.M1', 'Milestone 1', 'Planned', [
        task,
      ]);
      const phase = createTestPhase('P1', 'Phase 1', 'Planned', [milestone]);
      const backlog = createTestBacklog([phase]);

      const mockManager = createMockSessionManager(backlog);
      mockResolveScope.mockReturnValue([phase, milestone, task, subtask]);

      // EXECUTE: Process Phase
      const orchestrator = new TaskOrchestrator(mockManager);
      await orchestrator.processNextItem();

      // VERIFY: Phase status set to Implementing
      expect(mockManager.updateItemStatus).toHaveBeenCalledWith(
        'P1',
        'Implementing'
      );

      // EXECUTE: Process Milestone
      await orchestrator.processNextItem();

      // VERIFY: Milestone status set to Implementing
      expect(mockManager.updateItemStatus).toHaveBeenNthCalledWith(
        2,
        'P1.M1',
        'Implementing'
      );

      // EXECUTE: Process Task
      await orchestrator.processNextItem();

      // VERIFY: Task status set to Implementing
      expect(mockManager.updateItemStatus).toHaveBeenNthCalledWith(
        3,
        'P1.M1.T1',
        'Implementing'
      );
    });

    it('should update parent status before processing children', async () => {
      // SETUP: Create hierarchy
      const subtask = createTestSubtask('P1.M1.T1.S1', 'Subtask 1');
      const task = createTestTask('P1.M1.T1', 'Task 1', 'Planned', [subtask]);
      const milestone = createTestMilestone('P1.M1', 'Milestone 1', 'Planned', [
        task,
      ]);
      const phase = createTestPhase('P1', 'Phase 1', 'Planned', [milestone]);
      const backlog = createTestBacklog([phase]);

      const mockManager = createMockSessionManager(backlog);
      mockResolveScope.mockReturnValue([phase, milestone, task, subtask]);

      // EXECUTE: Process all items
      const orchestrator = new TaskOrchestrator(mockManager);

      let hasMore = true;
      while (hasMore) {
        hasMore = await orchestrator.processNextItem();
      }

      // VERIFY: Status update calls happen in correct order
      // Phase, Milestone, Task each get 1 status update (Implementing)
      // Subtask gets 3 status updates (Researching, Implementing, Complete)
      // Total: 6 status updates
      expect(mockManager.updateItemStatus).toHaveBeenCalledTimes(6);
      expect(mockManager.updateItemStatus).toHaveBeenNthCalledWith(
        1,
        'P1',
        'Implementing'
      );
      expect(mockManager.updateItemStatus).toHaveBeenNthCalledWith(
        2,
        'P1.M1',
        'Implementing'
      );
      expect(mockManager.updateItemStatus).toHaveBeenNthCalledWith(
        3,
        'P1.M1.T1',
        'Implementing'
      );
      // Subtask status updates (Researching, Implementing, Complete)
      expect(mockManager.updateItemStatus).toHaveBeenNthCalledWith(
        4,
        'P1.M1.T1.S1',
        'Researching'
      );
      expect(mockManager.updateItemStatus).toHaveBeenNthCalledWith(
        5,
        'P1.M1.T1.S1',
        'Implementing'
      );
      expect(mockManager.updateItemStatus).toHaveBeenNthCalledWith(
        6,
        'P1.M1.T1.S1',
        'Complete'
      );
    });
  });

  describe('CONTRACT c: Traversal stops at Subtask level', () => {
    it('should stop traversal at Subtask level (subtasks are execution units)', async () => {
      // SETUP: Create hierarchy
      const subtask = createTestSubtask('P1.M1.T1.S1', 'Subtask 1');
      const task = createTestTask('P1.M1.T1', 'Task 1', 'Planned', [subtask]);
      const milestone = createTestMilestone('P1.M1', 'Milestone 1', 'Planned', [
        task,
      ]);
      const phase = createTestPhase('P1', 'Phase 1', 'Planned', [milestone]);
      const backlog = createTestBacklog([phase]);

      const mockManager = createMockSessionManager(backlog);
      mockResolveScope.mockReturnValue([phase, milestone, task, subtask]);

      // EXECUTE: Process all items
      const orchestrator = new TaskOrchestrator(mockManager);
      const processedIds: string[] = [];

      let hasMore = true;
      while (hasMore) {
        hasMore = await orchestrator.processNextItem();
        if (orchestrator.currentItemId) {
          processedIds.push(orchestrator.currentItemId);
        }
      }

      // VERIFY: All items processed, Subtask is last level
      expect(processedIds).toEqual(['P1', 'P1.M1', 'P1.M1.T1', 'P1.M1.T1.S1']);
      expect(processedIds[processedIds.length - 1]).toBe('P1.M1.T1.S1'); // Last item is Subtask
    });

    it('should contain only Subtasks in execution queue for all scope', async () => {
      // SETUP: Create hierarchy
      const subtask1 = createTestSubtask('P1.M1.T1.S1', 'Subtask 1');
      const subtask2 = createTestSubtask('P1.M1.T1.S2', 'Subtask 2');
      const task1 = createTestTask('P1.M1.T1', 'Task 1', 'Planned', [
        subtask1,
        subtask2,
      ]);
      const milestone1 = createTestMilestone(
        'P1.M1',
        'Milestone 1',
        'Planned',
        [task1]
      );
      const phase1 = createTestPhase('P1', 'Phase 1', 'Planned', [milestone1]);
      const backlog = createTestBacklog([phase1]);

      const mockManager = createMockSessionManager(backlog);
      // For 'all' scope, resolveScope returns only leaf subtasks
      mockResolveScope.mockReturnValue([subtask1, subtask2]);

      // EXECUTE: Create orchestrator with default (all) scope
      const orchestrator = new TaskOrchestrator(mockManager);

      // VERIFY: executionQueue contains only Subtasks when using 'all' scope
      const queue = orchestrator.executionQueue;
      expect(queue.length).toBeGreaterThan(0);
      queue.forEach(item => {
        expect(item.type).toBe('Subtask');
      });
    });

    it('should verify Subtask has no children (is leaf node)', async () => {
      // SETUP: Create subtask
      const subtask = createTestSubtask('P1.M1.T1.S1', 'Subtask 1');

      // VERIFY: Subtask interface has no child array properties
      expect(subtask).not.toHaveProperty('subtasks');
      expect(subtask).not.toHaveProperty('tasks');
      expect(subtask).not.toHaveProperty('milestones');
      expect(subtask.type).toBe('Subtask');
    });
  });

  describe('CONTRACT d: Scope filtering respects phase/milestone/task limits', () => {
    it('should filter execution queue by phase scope', async () => {
      // SETUP: Create backlog with multiple phases
      const phase1 = createTestPhase('P1', 'Phase 1');
      const phase2 = createTestPhase('P2', 'Phase 2');
      const backlog = createTestBacklog([phase1, phase2]);

      const mockManager = createMockSessionManager(backlog);

      // Mock resolveScope to return only P1 items
      mockResolveScope.mockReturnValue([phase1]);

      // EXECUTE: Create orchestrator with P1 scope
      const scope: Scope = { type: 'phase', id: 'P1' };
      const orchestrator = new TaskOrchestrator(mockManager, scope);

      // VERIFY: Execution queue contains only P1
      const queue = orchestrator.executionQueue;
      expect(queue.map(item => item.id)).toContain('P1');
      expect(queue.some(item => item.id === 'P2')).toBe(false);
    });

    it('should filter execution queue by milestone scope', async () => {
      // SETUP: Create backlog with multiple milestones
      const subtask1 = createTestSubtask('P1.M1.T1.S1', 'Subtask 1');
      const task1 = createTestTask('P1.M1.T1', 'Task 1', 'Planned', [subtask1]);
      const milestone1 = createTestMilestone(
        'P1.M1',
        'Milestone 1',
        'Planned',
        [task1]
      );

      const subtask2 = createTestSubtask('P1.M2.T1.S1', 'Subtask 2');
      const task2 = createTestTask('P1.M2.T1', 'Task 2', 'Planned', [subtask2]);
      const milestone2 = createTestMilestone(
        'P1.M2',
        'Milestone 2',
        'Planned',
        [task2]
      );

      const phase1 = createTestPhase('P1', 'Phase 1', 'Planned', [
        milestone1,
        milestone2,
      ]);
      const backlog = createTestBacklog([phase1]);

      const mockManager = createMockSessionManager(backlog);

      // Mock resolveScope to return only M1 items
      mockResolveScope.mockReturnValue([milestone1, task1, subtask1]);

      // EXECUTE: Create orchestrator with M1 scope
      const scope: Scope = { type: 'milestone', id: 'P1.M1' };
      const orchestrator = new TaskOrchestrator(mockManager, scope);

      // VERIFY: Execution queue contains only M1 descendants
      const queue = orchestrator.executionQueue;
      expect(queue.some(item => item.id === 'P1.M1')).toBe(true);
      expect(queue.some(item => item.id === 'P1.M2')).toBe(false);
    });

    it('should filter execution queue by task scope', async () => {
      // SETUP: Create backlog with multiple tasks
      const subtask1 = createTestSubtask('P1.M1.T1.S1', 'Subtask 1');
      const task1 = createTestTask('P1.M1.T1', 'Task 1', 'Planned', [subtask1]);

      const subtask2 = createTestSubtask('P1.M1.T2.S1', 'Subtask 2');
      const task2 = createTestTask('P1.M1.T2', 'Task 2', 'Planned', [subtask2]);

      const milestone1 = createTestMilestone(
        'P1.M1',
        'Milestone 1',
        'Planned',
        [task1, task2]
      );
      const phase1 = createTestPhase('P1', 'Phase 1', 'Planned', [milestone1]);
      const backlog = createTestBacklog([phase1]);

      const mockManager = createMockSessionManager(backlog);

      // Mock resolveScope to return only T1 items
      mockResolveScope.mockReturnValue([task1, subtask1]);

      // EXECUTE: Create orchestrator with T1 scope
      const scope: Scope = { type: 'task', id: 'P1.M1.T1' };
      const orchestrator = new TaskOrchestrator(mockManager, scope);

      // VERIFY: Execution queue contains only T1 descendants
      const queue = orchestrator.executionQueue;
      expect(queue.some(item => item.id === 'P1.M1.T1')).toBe(true);
      expect(queue.some(item => item.id === 'P1.M1.T2')).toBe(false);
    });

    it('should filter execution queue by subtask scope', async () => {
      // SETUP: Create backlog with multiple subtasks
      const subtask1 = createTestSubtask('P1.M1.T1.S1', 'Subtask 1');
      const subtask2 = createTestSubtask('P1.M1.T1.S2', 'Subtask 2');
      const task1 = createTestTask('P1.M1.T1', 'Task 1', 'Planned', [
        subtask1,
        subtask2,
      ]);
      const milestone1 = createTestMilestone(
        'P1.M1',
        'Milestone 1',
        'Planned',
        [task1]
      );
      const phase1 = createTestPhase('P1', 'Phase 1', 'Planned', [milestone1]);
      const backlog = createTestBacklog([phase1]);

      const mockManager = createMockSessionManager(backlog);

      // Mock resolveScope to return only S1
      mockResolveScope.mockReturnValue([subtask1]);

      // EXECUTE: Create orchestrator with S1 scope
      const scope: Scope = { type: 'subtask', id: 'P1.M1.T1.S1' };
      const orchestrator = new TaskOrchestrator(mockManager, scope);

      // VERIFY: Execution queue contains only S1
      const queue = orchestrator.executionQueue;
      expect(queue.length).toBe(1);
      expect(queue[0].id).toBe('P1.M1.T1.S1');
    });

    it('should handle scope with non-existent ID', async () => {
      // SETUP: Create backlog
      const phase1 = createTestPhase('P1', 'Phase 1');
      const backlog = createTestBacklog([phase1]);

      const mockManager = createMockSessionManager(backlog);

      // Mock resolveScope to return empty array (non-existent ID)
      mockResolveScope.mockReturnValue([]);

      // EXECUTE: Create orchestrator with non-existent scope
      const scope: Scope = { type: 'phase', id: 'P999' };
      const orchestrator = new TaskOrchestrator(mockManager, scope);

      // VERIFY: executionQueue is empty
      const queue = orchestrator.executionQueue;
      expect(queue.length).toBe(0);

      // VERIFY: processNextItem returns false
      const result = await orchestrator.processNextItem();
      expect(result).toBe(false);
    });
  });

  describe('processNextItem return values', () => {
    it('should return true when items remain in queue', async () => {
      // SETUP: Create orchestrator with items
      const subtask = createTestSubtask('P1.M1.T1.S1', 'Subtask 1');
      const task1 = createTestTask('P1.M1.T1', 'Task 1', 'Planned', [subtask]);
      const milestone1 = createTestMilestone(
        'P1.M1',
        'Milestone 1',
        'Planned',
        [task1]
      );
      const phase1 = createTestPhase('P1', 'Phase 1', 'Planned', [milestone1]);
      const backlog = createTestBacklog([phase1]);
      const mockManager = createMockSessionManager(backlog);
      mockResolveScope.mockReturnValue([phase1, milestone1, task1, subtask]);

      const orchestrator = new TaskOrchestrator(mockManager);

      // EXECUTE: Process item
      const result = await orchestrator.processNextItem();

      // VERIFY: Returns true
      expect(result).toBe(true);
    });

    it('should return false when queue is empty', async () => {
      // SETUP: Create orchestrator with empty queue
      const backlog = createTestBacklog([]);
      const mockManager = createMockSessionManager(backlog);
      mockResolveScope.mockReturnValue([]);

      const orchestrator = new TaskOrchestrator(mockManager);

      // EXECUTE: Try to process
      const result = await orchestrator.processNextItem();

      // VERIFY: Returns false
      expect(result).toBe(false);
    });

    it('should update currentItemId during processing', async () => {
      // SETUP: Create orchestrator with known item
      const subtask = createTestSubtask('P1.M1.T1.S1', 'Subtask 1');
      const task1 = createTestTask('P1.M1.T1', 'Task 1', 'Planned', [subtask]);
      const milestone1 = createTestMilestone(
        'P1.M1',
        'Milestone 1',
        'Planned',
        [task1]
      );
      const phase1 = createTestPhase('P1', 'Phase 1', 'Planned', [milestone1]);
      const backlog = createTestBacklog([phase1]);
      const mockManager = createMockSessionManager(backlog);
      mockResolveScope.mockReturnValue([phase1, milestone1, task1, subtask]);

      const orchestrator = new TaskOrchestrator(mockManager);

      // EXECUTE: Process first item
      await orchestrator.processNextItem();

      // VERIFY: currentItemId matches processed item
      expect(orchestrator.currentItemId).toBe('P1');

      // EXECUTE: Process second item
      await orchestrator.processNextItem();

      // VERIFY: currentItemId updated to second item
      expect(orchestrator.currentItemId).toBe('P1.M1');
    });

    it('should set currentItemId to null when queue is empty', async () => {
      // SETUP: Create orchestrator with single item
      const subtask = createTestSubtask('P1.M1.T1.S1', 'Subtask 1');
      const task1 = createTestTask('P1.M1.T1', 'Task 1', 'Planned', [subtask]);
      const milestone1 = createTestMilestone(
        'P1.M1',
        'Milestone 1',
        'Planned',
        [task1]
      );
      const phase1 = createTestPhase('P1', 'Phase 1', 'Planned', [milestone1]);
      const backlog = createTestBacklog([phase1]);
      const mockManager = createMockSessionManager(backlog);
      mockResolveScope.mockReturnValue([subtask]);

      const orchestrator = new TaskOrchestrator(mockManager);

      // EXECUTE: Process the only item
      await orchestrator.processNextItem();
      expect(orchestrator.currentItemId).toBe('P1.M1.T1.S1');

      // EXECUTE: Try to process again (queue empty)
      const result = await orchestrator.processNextItem();

      // VERIFY: Returns false and currentItemId is null
      expect(result).toBe(false);
      expect(orchestrator.currentItemId).toBeNull();
    });
  });

  describe('Execution queue building', () => {
    it('should build execution queue from scope in constructor', async () => {
      // SETUP: Create backlog with multiple items
      const subtask = createTestSubtask('P1.M1.T1.S1', 'Subtask 1');
      const task1 = createTestTask('P1.M1.T1', 'Task 1', 'Planned', [subtask]);
      const milestone1 = createTestMilestone(
        'P1.M1',
        'Milestone 1',
        'Planned',
        [task1]
      );
      const phase1 = createTestPhase('P1', 'Phase 1', 'Planned', [milestone1]);
      const backlog = createTestBacklog([phase1]);

      const mockManager = createMockSessionManager(backlog);
      mockResolveScope.mockReturnValue([phase1, milestone1, task1, subtask]);

      // EXECUTE: Create TaskOrchestrator with scope
      const scope: Scope = { type: 'phase', id: 'P1' };
      const orchestrator = new TaskOrchestrator(mockManager, scope);

      // VERIFY: executionQueue contains correct items
      const queue = orchestrator.executionQueue;
      expect(queue.map(item => item.id)).toEqual([
        'P1',
        'P1.M1',
        'P1.M1.T1',
        'P1.M1.T1.S1',
      ]);
    });

    it('should use resolveScope to populate execution queue', async () => {
      // SETUP: Mock resolveScope to return specific items
      const subtask1 = createTestSubtask('P1.M1.T1.S1', 'Subtask 1');
      const subtask2 = createTestSubtask('P1.M1.T1.S2', 'Subtask 2');
      const task1 = createTestTask('P1.M1.T1', 'Task 1', 'Planned', [
        subtask1,
        subtask2,
      ]);
      const backlog = createTestBacklog([createTestPhase('P1', 'Phase 1')]);

      const mockManager = createMockSessionManager(backlog);
      mockResolveScope.mockReturnValue([task1, subtask1, subtask2]);

      // EXECUTE: Create TaskOrchestrator
      const orchestrator = new TaskOrchestrator(mockManager);

      // VERIFY: Mock resolveScope called with backlog and scope
      expect(mockResolveScope).toHaveBeenCalledWith(backlog, { type: 'all' });

      // VERIFY: executionQueue matches resolveScope return value
      const queue = orchestrator.executionQueue;
      expect(queue.map(item => item.id)).toEqual([
        'P1.M1.T1',
        'P1.M1.T1.S1',
        'P1.M1.T1.S2',
      ]);
    });

    it('should default to all scope when no scope provided', async () => {
      // SETUP: Create backlog
      const backlog = createTestBacklog([createTestPhase('P1', 'Phase 1')]);
      const mockManager = createMockSessionManager(backlog);
      mockResolveScope.mockReturnValue([]);

      // EXECUTE: Create TaskOrchestrator without scope
      void new TaskOrchestrator(mockManager);

      // VERIFY: resolveScope called with 'all' scope
      expect(mockResolveScope).toHaveBeenCalledWith(backlog, { type: 'all' });
    });
  });

  describe('Complete processing cycle', () => {
    it('should process all items until queue is empty', async () => {
      // SETUP: Create backlog with full hierarchy
      const subtask = createTestSubtask('P1.M1.T1.S1', 'Subtask 1');
      const task1 = createTestTask('P1.M1.T1', 'Task 1', 'Planned', [subtask]);
      const milestone1 = createTestMilestone(
        'P1.M1',
        'Milestone 1',
        'Planned',
        [task1]
      );
      const phase1 = createTestPhase('P1', 'Phase 1', 'Planned', [milestone1]);
      const backlog = createTestBacklog([phase1]);

      const mockManager = createMockSessionManager(backlog);
      mockResolveScope.mockReturnValue([phase1, milestone1, task1, subtask]);

      // EXECUTE: While loop calling processNextItem() until returns false
      const orchestrator = new TaskOrchestrator(mockManager);
      const processedIds: string[] = [];
      let iterations = 0;

      let hasMore = true;
      while (hasMore && iterations < 100) {
        // Safety limit
        hasMore = await orchestrator.processNextItem();
        if (orchestrator.currentItemId) {
          processedIds.push(orchestrator.currentItemId);
        }
        iterations++;
      }

      // VERIFY: All items processed exactly once
      expect(processedIds).toEqual(['P1', 'P1.M1', 'P1.M1.T1', 'P1.M1.T1.S1']);

      // VERIFY: Final processNextItem() call returns false
      expect(hasMore).toBe(false);
    });

    it('should handle empty queue gracefully', async () => {
      // SETUP: Create orchestrator with no items
      const backlog = createTestBacklog([]);
      const mockManager = createMockSessionManager(backlog);
      mockResolveScope.mockReturnValue([]);

      const orchestrator = new TaskOrchestrator(mockManager);

      // EXECUTE: Call processNextItem()
      const result = await orchestrator.processNextItem();

      // VERIFY: Returns false without error
      expect(result).toBe(false);
      expect(orchestrator.currentItemId).toBeNull();
    });
  });

  describe('Edge cases', () => {
    it('should handle backlog with single phase', async () => {
      // SETUP: Create backlog with single phase
      const phase1 = createTestPhase('P1', 'Phase 1');
      const backlog = createTestBacklog([phase1]);

      const mockManager = createMockSessionManager(backlog);
      mockResolveScope.mockReturnValue([phase1]);

      // EXECUTE: Process items
      const orchestrator = new TaskOrchestrator(mockManager);
      const processedIds: string[] = [];

      let hasMore = true;
      while (hasMore) {
        hasMore = await orchestrator.processNextItem();
        if (orchestrator.currentItemId) {
          processedIds.push(orchestrator.currentItemId);
        }
      }

      // VERIFY: Processes correctly
      expect(processedIds).toEqual(['P1']);
    });

    it('should handle backlog with single milestone', async () => {
      // SETUP: Create backlog with single milestone
      const milestone1 = createTestMilestone('P1.M1', 'Milestone 1');
      const phase1 = createTestPhase('P1', 'Phase 1', 'Planned', [milestone1]);
      const backlog = createTestBacklog([phase1]);

      const mockManager = createMockSessionManager(backlog);
      mockResolveScope.mockReturnValue([milestone1]);

      // EXECUTE: Process items
      const orchestrator = new TaskOrchestrator(mockManager);
      const processedIds: string[] = [];

      let hasMore = true;
      while (hasMore) {
        hasMore = await orchestrator.processNextItem();
        if (orchestrator.currentItemId) {
          processedIds.push(orchestrator.currentItemId);
        }
      }

      // VERIFY: Processes correctly
      expect(processedIds).toEqual(['P1.M1']);
    });

    it('should handle backlog with single task', async () => {
      // SETUP: Create backlog with single task
      const task1 = createTestTask('P1.M1.T1', 'Task 1');
      const milestone1 = createTestMilestone(
        'P1.M1',
        'Milestone 1',
        'Planned',
        [task1]
      );
      const phase1 = createTestPhase('P1', 'Phase 1', 'Planned', [milestone1]);
      const backlog = createTestBacklog([phase1]);

      const mockManager = createMockSessionManager(backlog);
      mockResolveScope.mockReturnValue([task1]);

      // EXECUTE: Process items
      const orchestrator = new TaskOrchestrator(mockManager);
      const processedIds: string[] = [];

      let hasMore = true;
      while (hasMore) {
        hasMore = await orchestrator.processNextItem();
        if (orchestrator.currentItemId) {
          processedIds.push(orchestrator.currentItemId);
        }
      }

      // VERIFY: Processes correctly
      expect(processedIds).toEqual(['P1.M1.T1']);
    });

    it('should handle backlog with single subtask', async () => {
      // SETUP: Create backlog with single subtask
      const subtask = createTestSubtask('P1.M1.T1.S1', 'Subtask 1');
      const task1 = createTestTask('P1.M1.T1', 'Task 1', 'Planned', [subtask]);
      const milestone1 = createTestMilestone(
        'P1.M1',
        'Milestone 1',
        'Planned',
        [task1]
      );
      const phase1 = createTestPhase('P1', 'Phase 1', 'Planned', [milestone1]);
      const backlog = createTestBacklog([phase1]);

      const mockManager = createMockSessionManager(backlog);
      mockResolveScope.mockReturnValue([subtask]);

      // EXECUTE: Process items
      const orchestrator = new TaskOrchestrator(mockManager);
      const processedIds: string[] = [];

      let hasMore = true;
      while (hasMore) {
        hasMore = await orchestrator.processNextItem();
        if (orchestrator.currentItemId) {
          processedIds.push(orchestrator.currentItemId);
        }
      }

      // VERIFY: Processes correctly
      expect(processedIds).toEqual(['P1.M1.T1.S1']);
    });

    it('should handle phase with no milestones', async () => {
      // SETUP: Create phase with no milestones
      const phase1 = createTestPhase('P1', 'Phase 1', 'Planned', []);
      const backlog = createTestBacklog([phase1]);

      const mockManager = createMockSessionManager(backlog);
      mockResolveScope.mockReturnValue([phase1]);

      // EXECUTE: Process phase
      const orchestrator = new TaskOrchestrator(mockManager);
      const result1 = await orchestrator.processNextItem();

      // VERIFY: Processes phase, returns true
      expect(result1).toBe(true);
      expect(orchestrator.currentItemId).toBe('P1');

      // EXECUTE: Try to process again
      const result2 = await orchestrator.processNextItem();

      // VERIFY: Returns false (queue empty)
      expect(result2).toBe(false);
    });

    it('should handle task with no subtasks', async () => {
      // SETUP: Create task with no subtasks
      const task1 = createTestTask('P1.M1.T1', 'Task 1', 'Planned', []);
      const milestone1 = createTestMilestone(
        'P1.M1',
        'Milestone 1',
        'Planned',
        [task1]
      );
      const phase1 = createTestPhase('P1', 'Phase 1', 'Planned', [milestone1]);
      const backlog = createTestBacklog([phase1]);

      const mockManager = createMockSessionManager(backlog);
      mockResolveScope.mockReturnValue([task1]);

      // EXECUTE: Process task
      const orchestrator = new TaskOrchestrator(mockManager);
      const result1 = await orchestrator.processNextItem();

      // VERIFY: Processes task, returns true
      expect(result1).toBe(true);
      expect(orchestrator.currentItemId).toBe('P1.M1.T1');

      // EXECUTE: Try to process again
      const result2 = await orchestrator.processNextItem();

      // VERIFY: Returns false (queue empty)
      expect(result2).toBe(false);
    });
  });

  describe('Hierarchy type processing', () => {
    it('should process all hierarchy types correctly', async () => {
      // SETUP: Create complete hierarchy with all types
      const subtask1 = createTestSubtask('P1.M1.T1.S1', 'Subtask 1');
      const subtask2 = createTestSubtask('P1.M1.T1.S2', 'Subtask 2');
      const task1 = createTestTask('P1.M1.T1', 'Task 1', 'Planned', [
        subtask1,
        subtask2,
      ]);
      const task2 = createTestTask('P1.M1.T2', 'Task 2', 'Planned', []);
      const milestone1 = createTestMilestone(
        'P1.M1',
        'Milestone 1',
        'Planned',
        [task1, task2]
      );
      const milestone2 = createTestMilestone(
        'P1.M2',
        'Milestone 2',
        'Planned',
        []
      );
      const phase1 = createTestPhase('P1', 'Phase 1', 'Planned', [
        milestone1,
        milestone2,
      ]);
      const backlog = createTestBacklog([phase1]);

      const mockManager = createMockSessionManager(backlog);
      mockResolveScope.mockReturnValue([
        phase1,
        milestone1,
        task1,
        subtask1,
        subtask2,
        task2,
        milestone2,
      ]);

      // EXECUTE: Process all items
      const orchestrator = new TaskOrchestrator(mockManager);
      const processedTypes: string[] = [];

      let hasMore = true;
      while (hasMore) {
        hasMore = await orchestrator.processNextItem();
        if (orchestrator.currentItemId) {
          // Get the item type from the currentItemId pattern
          const id = orchestrator.currentItemId;
          if (id.match(/^P\d+$/)) processedTypes.push('Phase');
          else if (id.match(/^P\d+\.M\d+$/)) processedTypes.push('Milestone');
          else if (id.match(/^P\d+\.M\d+\.T\d+$/)) processedTypes.push('Task');
          else if (id.match(/^P\d+\.M\d+\.T\d+\.S\d+$/))
            processedTypes.push('Subtask');
        }
      }

      // VERIFY: All hierarchy types are processed
      expect(processedTypes).toContain('Phase');
      expect(processedTypes).toContain('Milestone');
      expect(processedTypes).toContain('Task');
      expect(processedTypes).toContain('Subtask');
    });
  });
});
