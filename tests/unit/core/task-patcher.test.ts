/**
 * Unit tests for task patching utility for delta session backlog updates
 *
 * @remarks
 * Tests validate the patchBacklog function from src/core/task-patcher.ts with
 * 100% coverage. Tests follow the Setup/Execute/Verify pattern with comprehensive
 * edge case coverage for all three change types: added, modified, and removed.
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { describe, expect, it, vi } from 'vitest';
import { patchBacklog } from '../../../src/core/task-patcher.js';
import { findItem } from '../../../src/utils/task-utils.js';
import type {
  Backlog,
  Phase,
  Milestone,
  Task,
  Subtask,
  Status,
} from '../../../src/core/models.js';
import type {
  DeltaAnalysis,
  RequirementChange,
} from '../../../src/core/models.js';

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

// Test fixtures
const createTestSubtask = (
  id: string,
  title: string,
  status: Status,
  dependencies: string[] = []
): Subtask => ({
  id,
  type: 'Subtask',
  title,
  status,
  story_points: 2,
  dependencies,
  context_scope: 'Test scope',
});

const createTestTask = (
  id: string,
  title: string,
  status: Status,
  subtasks: Subtask[] = []
): Task => ({
  id,
  type: 'Task',
  title,
  status,
  description: 'Test task description',
  subtasks,
});

const createTestMilestone = (
  id: string,
  title: string,
  status: Status,
  tasks: Task[] = []
): Milestone => ({
  id,
  type: 'Milestone',
  title,
  status,
  description: 'Test milestone description',
  tasks,
});

const createTestPhase = (
  id: string,
  title: string,
  status: Status,
  milestones: Milestone[] = []
): Phase => ({
  id,
  type: 'Phase',
  title,
  status,
  description: 'Test phase description',
  milestones,
});

const createTestBacklog = (phases: Phase[]): Backlog => ({
  backlog: phases,
});

// Test delta analysis factory
const createDeltaAnalysis = (
  changes: RequirementChange[],
  taskIds: string[]
): DeltaAnalysis => ({
  changes,
  patchInstructions: 'Test patch instructions',
  taskIds,
});

describe('core/task-patcher', () => {
  describe('patchBacklog - modified changes', () => {
    it('should reset subtask status to Planned for modified change', () => {
      // SETUP: Backlog with Complete subtask
      const subtask = createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Complete');
      const task = createTestTask('P1.M1.T1', 'Task 1', 'Complete', [subtask]);
      const milestone = createTestMilestone(
        'P1.M1',
        'Milestone 1',
        'Complete',
        [task]
      );
      const phase = createTestPhase('P1', 'Phase 1', 'Complete', [milestone]);
      const backlog = createTestBacklog([phase]);

      const delta: DeltaAnalysis = createDeltaAnalysis(
        [
          {
            itemId: 'P1.M1.T1.S1',
            type: 'modified',
            description: 'Modified requirement',
            impact: 'Re-implement subtask',
          },
        ],
        ['P1.M1.T1.S1']
      );

      // EXECUTE
      const patched = patchBacklog(backlog, delta);

      // VERIFY: Status reset to Planned
      const updatedItem = findItem(patched, 'P1.M1.T1.S1');
      expect(updatedItem?.status).toBe('Planned');
    });

    it('should reset task status to Planned for modified change', () => {
      // SETUP: Backlog with Complete task
      const subtask = createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Complete');
      const task = createTestTask('P1.M1.T1', 'Task 1', 'Complete', [subtask]);
      const milestone = createTestMilestone(
        'P1.M1',
        'Milestone 1',
        'Complete',
        [task]
      );
      const phase = createTestPhase('P1', 'Phase 1', 'Complete', [milestone]);
      const backlog = createTestBacklog([phase]);

      const delta: DeltaAnalysis = createDeltaAnalysis(
        [
          {
            itemId: 'P1.M1.T1',
            type: 'modified',
            description: 'Modified task requirement',
            impact: 'Re-implement task',
          },
        ],
        ['P1.M1.T1']
      );

      // EXECUTE
      const patched = patchBacklog(backlog, delta);

      // VERIFY: Task status reset to Planned
      const updatedItem = findItem(patched, 'P1.M1.T1');
      expect(updatedItem?.status).toBe('Planned');
    });

    it('should reset milestone status to Planned for modified change', () => {
      // SETUP: Backlog with Complete milestone
      const milestone = createTestMilestone('P1.M1', 'Milestone 1', 'Complete');
      const phase = createTestPhase('P1', 'Phase 1', 'Complete', [milestone]);
      const backlog = createTestBacklog([phase]);

      const delta: DeltaAnalysis = createDeltaAnalysis(
        [
          {
            itemId: 'P1.M1',
            type: 'modified',
            description: 'Modified milestone requirement',
            impact: 'Re-implement milestone',
          },
        ],
        ['P1.M1']
      );

      // EXECUTE
      const patched = patchBacklog(backlog, delta);

      // VERIFY: Milestone status reset to Planned
      const updatedItem = findItem(patched, 'P1.M1');
      expect(updatedItem?.status).toBe('Planned');
    });

    it('should reset phase status to Planned for modified change', () => {
      // SETUP: Backlog with Complete phase
      const phase = createTestPhase('P1', 'Phase 1', 'Complete');
      const backlog = createTestBacklog([phase]);

      const delta: DeltaAnalysis = createDeltaAnalysis(
        [
          {
            itemId: 'P1',
            type: 'modified',
            description: 'Modified phase requirement',
            impact: 'Re-implement phase',
          },
        ],
        ['P1']
      );

      // EXECUTE
      const patched = patchBacklog(backlog, delta);

      // VERIFY: Phase status reset to Planned
      const updatedItem = findItem(patched, 'P1');
      expect(updatedItem?.status).toBe('Planned');
    });

    it('should handle multiple modified changes', () => {
      // SETUP: Backlog with multiple items
      const subtask1 = createTestSubtask(
        'P1.M1.T1.S1',
        'Subtask 1',
        'Complete'
      );
      const subtask2 = createTestSubtask(
        'P1.M1.T1.S2',
        'Subtask 2',
        'Complete'
      );
      const task = createTestTask('P1.M1.T1', 'Task 1', 'Complete', [
        subtask1,
        subtask2,
      ]);
      const milestone = createTestMilestone(
        'P1.M1',
        'Milestone 1',
        'Complete',
        [task]
      );
      const phase = createTestPhase('P1', 'Phase 1', 'Complete', [milestone]);
      const backlog = createTestBacklog([phase]);

      const delta: DeltaAnalysis = createDeltaAnalysis(
        [
          {
            itemId: 'P1.M1.T1.S1',
            type: 'modified',
            description: 'Modified subtask 1',
            impact: 'Re-implement',
          },
          {
            itemId: 'P1.M1.T1.S2',
            type: 'modified',
            description: 'Modified subtask 2',
            impact: 'Re-implement',
          },
        ],
        ['P1.M1.T1.S1', 'P1.M1.T1.S2']
      );

      // EXECUTE
      const patched = patchBacklog(backlog, delta);

      // VERIFY: Both items reset to Planned
      expect(findItem(patched, 'P1.M1.T1.S1')?.status).toBe('Planned');
      expect(findItem(patched, 'P1.M1.T1.S2')?.status).toBe('Planned');
    });
  });

  describe('patchBacklog - removed changes', () => {
    it('should set subtask status to Obsolete for removed change', () => {
      // SETUP: Backlog with Complete subtask
      const subtask = createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Complete');
      const task = createTestTask('P1.M1.T1', 'Task 1', 'Complete', [subtask]);
      const milestone = createTestMilestone(
        'P1.M1',
        'Milestone 1',
        'Complete',
        [task]
      );
      const phase = createTestPhase('P1', 'Phase 1', 'Complete', [milestone]);
      const backlog = createTestBacklog([phase]);

      const delta: DeltaAnalysis = createDeltaAnalysis(
        [
          {
            itemId: 'P1.M1.T1.S1',
            type: 'removed',
            description: 'Removed requirement',
            impact: 'Mark as obsolete',
          },
        ],
        ['P1.M1.T1.S1']
      );

      // EXECUTE
      const patched = patchBacklog(backlog, delta);

      // VERIFY: Status set to Obsolete
      const updatedItem = findItem(patched, 'P1.M1.T1.S1');
      expect(updatedItem?.status).toBe('Obsolete');
    });

    it('should set task status to Obsolete for removed change', () => {
      // SETUP: Backlog with Complete task
      const task = createTestTask('P1.M1.T1', 'Task 1', 'Complete');
      const milestone = createTestMilestone(
        'P1.M1',
        'Milestone 1',
        'Complete',
        [task]
      );
      const phase = createTestPhase('P1', 'Phase 1', 'Complete', [milestone]);
      const backlog = createTestBacklog([phase]);

      const delta: DeltaAnalysis = createDeltaAnalysis(
        [
          {
            itemId: 'P1.M1.T1',
            type: 'removed',
            description: 'Removed task requirement',
            impact: 'Mark as obsolete',
          },
        ],
        ['P1.M1.T1']
      );

      // EXECUTE
      const patched = patchBacklog(backlog, delta);

      // VERIFY: Task status set to Obsolete
      const updatedItem = findItem(patched, 'P1.M1.T1');
      expect(updatedItem?.status).toBe('Obsolete');
    });

    it('should set milestone status to Obsolete for removed change', () => {
      // SETUP: Backlog with Complete milestone
      const milestone = createTestMilestone('P1.M1', 'Milestone 1', 'Complete');
      const phase = createTestPhase('P1', 'Phase 1', 'Complete', [milestone]);
      const backlog = createTestBacklog([phase]);

      const delta: DeltaAnalysis = createDeltaAnalysis(
        [
          {
            itemId: 'P1.M1',
            type: 'removed',
            description: 'Removed milestone requirement',
            impact: 'Mark as obsolete',
          },
        ],
        ['P1.M1']
      );

      // EXECUTE
      const patched = patchBacklog(backlog, delta);

      // VERIFY: Milestone status set to Obsolete
      const updatedItem = findItem(patched, 'P1.M1');
      expect(updatedItem?.status).toBe('Obsolete');
    });

    it('should set phase status to Obsolete for removed change', () => {
      // SETUP: Backlog with Complete phase
      const phase = createTestPhase('P1', 'Phase 1', 'Complete');
      const backlog = createTestBacklog([phase]);

      const delta: DeltaAnalysis = createDeltaAnalysis(
        [
          {
            itemId: 'P1',
            type: 'removed',
            description: 'Removed phase requirement',
            impact: 'Mark as obsolete',
          },
        ],
        ['P1']
      );

      // EXECUTE
      const patched = patchBacklog(backlog, delta);

      // VERIFY: Phase status set to Obsolete
      const updatedItem = findItem(patched, 'P1');
      expect(updatedItem?.status).toBe('Obsolete');
    });

    it('should handle multiple removed changes', () => {
      // SETUP: Backlog with multiple items
      const subtask1 = createTestSubtask(
        'P1.M1.T1.S1',
        'Subtask 1',
        'Complete'
      );
      const subtask2 = createTestSubtask(
        'P1.M1.T1.S2',
        'Subtask 2',
        'Complete'
      );
      const task = createTestTask('P1.M1.T1', 'Task 1', 'Complete', [
        subtask1,
        subtask2,
      ]);
      const milestone = createTestMilestone(
        'P1.M1',
        'Milestone 1',
        'Complete',
        [task]
      );
      const phase = createTestPhase('P1', 'Phase 1', 'Complete', [milestone]);
      const backlog = createTestBacklog([phase]);

      const delta: DeltaAnalysis = createDeltaAnalysis(
        [
          {
            itemId: 'P1.M1.T1.S1',
            type: 'removed',
            description: 'Removed subtask 1',
            impact: 'Mark as obsolete',
          },
          {
            itemId: 'P1.M1.T1.S2',
            type: 'removed',
            description: 'Removed subtask 2',
            impact: 'Mark as obsolete',
          },
        ],
        ['P1.M1.T1.S1', 'P1.M1.T1.S2']
      );

      // EXECUTE
      const patched = patchBacklog(backlog, delta);

      // VERIFY: Both items set to Obsolete
      expect(findItem(patched, 'P1.M1.T1.S1')?.status).toBe('Obsolete');
      expect(findItem(patched, 'P1.M1.T1.S2')?.status).toBe('Obsolete');
    });
  });

  describe('patchBacklog - added changes', () => {
    it('should log debug delegation for added change (no-op)', () => {
      // SETUP: Backlog and logger mock
      mockLogger.debug.mockClear();
      const phase = createTestPhase('P1', 'Phase 1', 'Complete');
      const backlog = createTestBacklog([phase]);

      const delta: DeltaAnalysis = createDeltaAnalysis(
        [
          {
            itemId: 'P1.M1.T1.S1',
            type: 'added',
            description: 'New requirement',
            impact: 'Generate new tasks',
          },
        ],
        ['P1.M1.T1.S1']
      );

      // EXECUTE
      patchBacklog(backlog, delta);

      // VERIFY: Debug delegation logged, backlog unchanged
      expect(mockLogger.debug).toHaveBeenCalledWith(
        { changeType: 'added', taskId: 'P1.M1.T1.S1' },
        'Added requirement delegated to delta-session breakdown (decomposePRD over delta_prd.md); patchBacklog is a no-op for added changes'
      );
    });

    it('should log debug delegation for multiple added changes', () => {
      // SETUP: Logger mock
      mockLogger.debug.mockClear();
      const phase = createTestPhase('P1', 'Phase 1', 'Complete');
      const backlog = createTestBacklog([phase]);

      const delta: DeltaAnalysis = createDeltaAnalysis(
        [
          {
            itemId: 'P1.M1.T1.S1',
            type: 'added',
            description: 'New requirement 1',
            impact: 'Generate new tasks',
          },
          {
            itemId: 'P1.M1.T1.S2',
            type: 'added',
            description: 'New requirement 2',
            impact: 'Generate new tasks',
          },
        ],
        ['P1.M1.T1.S1', 'P1.M1.T1.S2']
      );

      // EXECUTE
      patchBacklog(backlog, delta);

      // VERIFY: Debug delegations logged for both added changes
      expect(mockLogger.debug).toHaveBeenCalledTimes(2);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        { changeType: 'added', taskId: 'P1.M1.T1.S1' },
        'Added requirement delegated to delta-session breakdown (decomposePRD over delta_prd.md); patchBacklog is a no-op for added changes'
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        { changeType: 'added', taskId: 'P1.M1.T1.S2' },
        'Added requirement delegated to delta-session breakdown (decomposePRD over delta_prd.md); patchBacklog is a no-op for added changes'
      );
    });
  });

  describe('patchBacklog - completed task preservation', () => {
    it('should preserve Complete tasks not in delta.taskIds', () => {
      // SETUP: Backlog with multiple Complete tasks
      const subtask1 = createTestSubtask(
        'P1.M1.T1.S1',
        'Subtask 1',
        'Complete'
      );
      const subtask2 = createTestSubtask(
        'P1.M1.T1.S2',
        'Subtask 2',
        'Complete'
      );
      const subtask3 = createTestSubtask(
        'P1.M1.T1.S3',
        'Subtask 3',
        'Complete'
      );
      const task = createTestTask('P1.M1.T1', 'Task 1', 'Complete', [
        subtask1,
        subtask2,
        subtask3,
      ]);
      const milestone = createTestMilestone(
        'P1.M1',
        'Milestone 1',
        'Complete',
        [task]
      );
      const phase = createTestPhase('P1', 'Phase 1', 'Complete', [milestone]);
      const backlog = createTestBacklog([phase]);

      // Only S2 is modified - S1 and S3 should remain Complete
      const delta: DeltaAnalysis = createDeltaAnalysis(
        [
          {
            itemId: 'P1.M1.T1.S2',
            type: 'modified',
            description: 'Modified subtask 2',
            impact: 'Re-implement',
          },
        ],
        ['P1.M1.T1.S2']
      );

      // EXECUTE
      const patched = patchBacklog(backlog, delta);

      // VERIFY: S1 and S3 remain Complete, S2 is Planned
      expect(findItem(patched, 'P1.M1.T1.S1')?.status).toBe('Complete');
      expect(findItem(patched, 'P1.M1.T1.S2')?.status).toBe('Planned');
      expect(findItem(patched, 'P1.M1.T1.S3')?.status).toBe('Complete');
    });

    it('should preserve all Complete tasks when delta is empty', () => {
      // SETUP: Backlog with Complete tasks
      const subtask = createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Complete');
      const task = createTestTask('P1.M1.T1', 'Task 1', 'Complete', [subtask]);
      const milestone = createTestMilestone(
        'P1.M1',
        'Milestone 1',
        'Complete',
        [task]
      );
      const phase = createTestPhase('P1', 'Phase 1', 'Complete', [milestone]);
      const backlog = createTestBacklog([phase]);

      const delta: DeltaAnalysis = createDeltaAnalysis([], []);

      // EXECUTE
      const patched = patchBacklog(backlog, delta);

      // VERIFY: All tasks remain Complete
      expect(findItem(patched, 'P1.M1.T1.S1')?.status).toBe('Complete');
    });

    it('should not affect Planned tasks not in delta.taskIds', () => {
      // SETUP: Backlog with mix of statuses
      const subtask1 = createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Planned');
      const subtask2 = createTestSubtask(
        'P1.M1.T1.S2',
        'Subtask 2',
        'Complete'
      );
      const subtask3 = createTestSubtask(
        'P1.M1.T1.S3',
        'Subtask 3',
        'Implementing'
      );
      const task = createTestTask('P1.M1.T1', 'Task 1', 'Complete', [
        subtask1,
        subtask2,
        subtask3,
      ]);
      const milestone = createTestMilestone(
        'P1.M1',
        'Milestone 1',
        'Complete',
        [task]
      );
      const phase = createTestPhase('P1', 'Phase 1', 'Complete', [milestone]);
      const backlog = createTestBacklog([phase]);

      // Only S2 is modified
      const delta: DeltaAnalysis = createDeltaAnalysis(
        [
          {
            itemId: 'P1.M1.T1.S2',
            type: 'modified',
            description: 'Modified subtask 2',
            impact: 'Re-implement',
          },
        ],
        ['P1.M1.T1.S2']
      );

      // EXECUTE
      const patched = patchBacklog(backlog, delta);

      // VERIFY: S1 and S3 unchanged
      expect(findItem(patched, 'P1.M1.T1.S1')?.status).toBe('Planned');
      expect(findItem(patched, 'P1.M1.T1.S2')?.status).toBe('Planned'); // Changed
      expect(findItem(patched, 'P1.M1.T1.S3')?.status).toBe('Implementing');
    });
  });

  describe('patchBacklog - immutability', () => {
    it('should not mutate original backlog', () => {
      // SETUP: Backlog
      const subtask = createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Complete');
      const task = createTestTask('P1.M1.T1', 'Task 1', 'Complete', [subtask]);
      const milestone = createTestMilestone(
        'P1.M1',
        'Milestone 1',
        'Complete',
        [task]
      );
      const phase = createTestPhase('P1', 'Phase 1', 'Complete', [milestone]);
      const backlog = createTestBacklog([phase]);
      const originalJSON = JSON.stringify(backlog);

      const delta: DeltaAnalysis = createDeltaAnalysis(
        [
          {
            itemId: 'P1.M1.T1.S1',
            type: 'modified',
            description: 'Modified subtask',
            impact: 'Re-implement',
          },
        ],
        ['P1.M1.T1.S1']
      );

      // EXECUTE
      const patched = patchBacklog(backlog, delta);

      // VERIFY: Original unchanged
      expect(JSON.stringify(backlog)).toEqual(originalJSON);
      expect(patched).not.toEqual(backlog);
    });

    it('should return new backlog object', () => {
      // SETUP: Backlog
      const subtask = createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Complete');
      const task = createTestTask('P1.M1.T1', 'Task 1', 'Complete', [subtask]);
      const milestone = createTestMilestone(
        'P1.M1',
        'Milestone 1',
        'Complete',
        [task]
      );
      const phase = createTestPhase('P1', 'Phase 1', 'Complete', [milestone]);
      const backlog = createTestBacklog([phase]);

      const delta: DeltaAnalysis = createDeltaAnalysis(
        [
          {
            itemId: 'P1.M1.T1.S1',
            type: 'modified',
            description: 'Modified subtask',
            impact: 'Re-implement',
          },
        ],
        ['P1.M1.T1.S1']
      );

      // EXECUTE
      const patched = patchBacklog(backlog, delta);

      // VERIFY: Different object reference
      expect(patched).not.toBe(backlog);
    });
  });

  describe('patchBacklog - edge cases', () => {
    it('should handle empty changes array', () => {
      // SETUP: Backlog
      const subtask = createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Complete');
      const task = createTestTask('P1.M1.T1', 'Task 1', 'Complete', [subtask]);
      const milestone = createTestMilestone(
        'P1.M1',
        'Milestone 1',
        'Complete',
        [task]
      );
      const phase = createTestPhase('P1', 'Phase 1', 'Complete', [milestone]);
      const backlog = createTestBacklog([phase]);

      const delta: DeltaAnalysis = createDeltaAnalysis([], []);

      // EXECUTE
      const patched = patchBacklog(backlog, delta);

      // VERIFY: Backlog unchanged
      expect(patched).toEqual(backlog);
    });

    it('should handle empty backlog', () => {
      // SETUP: Empty backlog
      const backlog: Backlog = createTestBacklog([]);

      const delta: DeltaAnalysis = createDeltaAnalysis(
        [
          {
            itemId: 'P1.M1.T1.S1',
            type: 'modified',
            description: 'Modified',
            impact: 'Re-implement',
          },
        ],
        ['P1.M1.T1.S1']
      );

      // EXECUTE: Should not throw
      const patched = patchBacklog(backlog, delta);

      // VERIFY: Still empty
      expect(patched.backlog).toEqual([]);
    });

    it('should handle duplicate taskIds (de-duplication)', () => {
      // SETUP: Backlog
      const subtask = createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Complete');
      const task = createTestTask('P1.M1.T1', 'Task 1', 'Complete', [subtask]);
      const milestone = createTestMilestone(
        'P1.M1',
        'Milestone 1',
        'Complete',
        [task]
      );
      const phase = createTestPhase('P1', 'Phase 1', 'Complete', [milestone]);
      const backlog = createTestBacklog([phase]);

      // Duplicate taskIds
      const delta: DeltaAnalysis = createDeltaAnalysis(
        [
          {
            itemId: 'P1.M1.T1.S1',
            type: 'modified',
            description: 'Modified',
            impact: 'Re-implement',
          },
        ],
        ['P1.M1.T1.S1', 'P1.M1.T1.S1', 'P1.M1.T1.S1'] // Duplicates
      );

      // EXECUTE
      const patched = patchBacklog(backlog, delta);

      // VERIFY: Only processed once
      expect(findItem(patched, 'P1.M1.T1.S1')?.status).toBe('Planned');
    });

    it('should handle taskId with no corresponding change entry', () => {
      // SETUP: Backlog
      const subtask = createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Complete');
      const task = createTestTask('P1.M1.T1', 'Task 1', 'Complete', [subtask]);
      const milestone = createTestMilestone(
        'P1.M1',
        'Milestone 1',
        'Complete',
        [task]
      );
      const phase = createTestPhase('P1', 'Phase 1', 'Complete', [milestone]);
      const backlog = createTestBacklog([phase]);

      // taskId in array but no matching change entry
      const delta: DeltaAnalysis = createDeltaAnalysis(
        [
          {
            itemId: 'P1.M1.T1.S2', // Different ID
            type: 'modified',
            description: 'Modified',
            impact: 'Re-implement',
          },
        ],
        ['P1.M1.T1.S1', 'P1.M1.T1.S2']
      );

      // EXECUTE: Should not throw
      const patched = patchBacklog(backlog, delta);

      // VERIFY: S1 unchanged (no change entry), S2 also unchanged (doesn't exist)
      expect(findItem(patched, 'P1.M1.T1.S1')?.status).toBe('Complete');
    });

    it('should handle non-existent item ID gracefully', () => {
      // SETUP: Backlog
      const phase = createTestPhase('P1', 'Phase 1', 'Complete');
      const backlog = createTestBacklog([phase]);

      const delta: DeltaAnalysis = createDeltaAnalysis(
        [
          {
            itemId: 'NON-EXISTENT',
            type: 'modified',
            description: 'Modified',
            impact: 'Re-implement',
          },
        ],
        ['NON-EXISTENT']
      );

      // EXECUTE: Should not throw
      const patched = patchBacklog(backlog, delta);

      // VERIFY: Backlog unchanged
      expect(patched).toEqual(backlog);
    });

    it('should handle mixed change types', () => {
      // SETUP: Backlog with multiple items
      const subtask1 = createTestSubtask(
        'P1.M1.T1.S1',
        'Subtask 1',
        'Complete'
      );
      const subtask2 = createTestSubtask(
        'P1.M1.T1.S2',
        'Subtask 2',
        'Complete'
      );
      const subtask3 = createTestSubtask(
        'P1.M1.T1.S3',
        'Subtask 3',
        'Complete'
      );
      const task = createTestTask('P1.M1.T1', 'Task 1', 'Complete', [
        subtask1,
        subtask2,
        subtask3,
      ]);
      const milestone = createTestMilestone(
        'P1.M1',
        'Milestone 1',
        'Complete',
        [task]
      );
      const phase = createTestPhase('P1', 'Phase 1', 'Complete', [milestone]);
      const backlog = createTestBacklog([phase]);

      // Logger mock for 'added' debug delegation
      mockLogger.debug.mockClear();

      const delta: DeltaAnalysis = createDeltaAnalysis(
        [
          {
            itemId: 'P1.M1.T1.S1',
            type: 'modified',
            description: 'Modified',
            impact: 'Re-implement',
          },
          {
            itemId: 'P1.M1.T1.S2',
            type: 'removed',
            description: 'Removed',
            impact: 'Mark obsolete',
          },
          {
            itemId: 'P1.M1.T1.S3',
            type: 'added',
            description: 'Added',
            impact: 'Generate new tasks',
          },
        ],
        ['P1.M1.T1.S1', 'P1.M1.T1.S2', 'P1.M1.T1.S3']
      );

      // EXECUTE
      const patched = patchBacklog(backlog, delta);

      // VERIFY: Each change type handled correctly
      expect(findItem(patched, 'P1.M1.T1.S1')?.status).toBe('Planned'); // modified
      expect(findItem(patched, 'P1.M1.T1.S2')?.status).toBe('Obsolete'); // removed
      expect(findItem(patched, 'P1.M1.T1.S3')?.status).toBe('Complete'); // added - unchanged (delegated to delta breakdown)
      expect(mockLogger.debug).toHaveBeenCalledWith(
        { changeType: 'added', taskId: 'P1.M1.T1.S3' },
        'Added requirement delegated to delta-session breakdown (decomposePRD over delta_prd.md); patchBacklog is a no-op for added changes'
      ); // debug delegation for 'added'
    });

    it('should handle all status values in backlog', () => {
      // SETUP: Backlog with all status types
      const statuses: Status[] = [
        'Planned',
        'Researching',
        'Implementing',
        'Complete',
        'Failed',
        'Obsolete',
      ];
      const subtasks = statuses.map((status, i) =>
        createTestSubtask(`P1.M1.T1.S${i + 1}`, `Subtask ${i}`, status)
      );
      const task = createTestTask('P1.M1.T1', 'Task 1', 'Planned', subtasks);
      const milestone = createTestMilestone('P1.M1', 'Milestone 1', 'Planned', [
        task,
      ]);
      const phase = createTestPhase('P1', 'Phase 1', 'Planned', [milestone]);
      const backlog = createTestBacklog([phase]);

      const delta: DeltaAnalysis = createDeltaAnalysis(
        [
          {
            itemId: 'P1.M1.T1.S3', // Implementing
            type: 'modified',
            description: 'Modified',
            impact: 'Re-implement',
          },
        ],
        ['P1.M1.T1.S3']
      );

      // EXECUTE
      const patched = patchBacklog(backlog, delta);

      // VERIFY: Only S3 changed, others preserved
      expect(findItem(patched, 'P1.M1.T1.S1')?.status).toBe('Planned');
      expect(findItem(patched, 'P1.M1.T1.S2')?.status).toBe('Researching');
      expect(findItem(patched, 'P1.M1.T1.S3')?.status).toBe('Planned'); // Changed
      expect(findItem(patched, 'P1.M1.T1.S4')?.status).toBe('Complete');
      expect(findItem(patched, 'P1.M1.T1.S5')?.status).toBe('Failed');
      expect(findItem(patched, 'P1.M1.T1.S6')?.status).toBe('Obsolete');
    });
  });

  describe('patchBacklog - integration scenarios', () => {
    it('should support delta session workflow with multiple phases', () => {
      // SETUP: Multi-phase backlog
      const subtask1 = createTestSubtask('P1.M1.T1.S1', 'S1', 'Complete');
      const subtask2 = createTestSubtask('P2.M1.T1.S1', 'S2', 'Complete');
      const task1 = createTestTask('P1.M1.T1', 'T1', 'Complete', [subtask1]);
      const task2 = createTestTask('P2.M1.T1', 'T2', 'Complete', [subtask2]);
      const milestone1 = createTestMilestone('P1.M1', 'M1', 'Complete', [
        task1,
      ]);
      const milestone2 = createTestMilestone('P2.M1', 'M2', 'Complete', [
        task2,
      ]);
      const phase1 = createTestPhase('P1', 'Phase 1', 'Complete', [milestone1]);
      const phase2 = createTestPhase('P2', 'Phase 2', 'Complete', [milestone2]);
      const backlog = createTestBacklog([phase1, phase2]);

      // P1.M1.T1.S1 is modified, P2 unchanged
      const delta: DeltaAnalysis = createDeltaAnalysis(
        [
          {
            itemId: 'P1.M1.T1.S1',
            type: 'modified',
            description: 'Modified',
            impact: 'Re-implement',
          },
        ],
        ['P1.M1.T1.S1']
      );

      // EXECUTE
      const patched = patchBacklog(backlog, delta);

      // VERIFY: Only P1.M1.T1.S1 changed, P2 items unchanged
      expect(findItem(patched, 'P1.M1.T1.S1')?.status).toBe('Planned');
      expect(findItem(patched, 'P2.M1.T1.S1')?.status).toBe('Complete');
    });

    it('should handle cascading changes across hierarchy', () => {
      // SETUP: Hierarchy with changes at multiple levels
      const subtask = createTestSubtask('P1.M1.T1.S1', 'S1', 'Complete');
      const task = createTestTask('P1.M1.T1', 'T1', 'Complete', [subtask]);
      const milestone = createTestMilestone('P1.M1', 'M1', 'Complete', [task]);
      const phase = createTestPhase('P1', 'P1', 'Complete', [milestone]);
      const backlog = createTestBacklog([phase]);

      const delta: DeltaAnalysis = createDeltaAnalysis(
        [
          { itemId: 'P1', type: 'modified', description: 'P1', impact: 'Re' },
          {
            itemId: 'P1.M1',
            type: 'removed',
            description: 'M1',
            impact: 'Obs',
          },
          {
            itemId: 'P1.M1.T1',
            type: 'modified',
            description: 'T1',
            impact: 'Re',
          },
        ],
        ['P1', 'P1.M1', 'P1.M1.T1']
      );

      // EXECUTE
      const patched = patchBacklog(backlog, delta);

      // VERIFY: All changes applied
      expect(findItem(patched, 'P1')?.status).toBe('Planned'); // modified
      expect(findItem(patched, 'P1.M1')?.status).toBe('Obsolete'); // removed
      expect(findItem(patched, 'P1.M1.T1')?.status).toBe('Planned'); // modified
    });
  });
});
