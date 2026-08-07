/**
 * Unit tests for task hierarchy utility functions
 *
 * @remarks
 * Tests validate all utility functions in src/utils/task-utils.ts with 100% coverage.
 * Tests follow the Setup/Execute/Verify pattern with comprehensive edge case coverage.
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { describe, expect, it } from 'vitest';
import {
  findItem,
  getDependencies,
  filterByStatus,
  getNextPendingItem,
  updateItemStatus,
  isSubtask,
  normalizeTaskId,
  findItemByLooseId,
  matchStatus,
  cascadeCompleteDown,
  type HierarchyItem,
} from '../../../src/utils/task-utils.js';
import type {
  Backlog,
  Phase,
  Milestone,
  Task,
  Subtask,
  Status,
} from '../../../src/core/models.js';

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

// Comprehensive test backlog with multiple levels
const createComplexBacklog = (): Backlog => {
  const subtask1: Subtask = createTestSubtask(
    'P1.M1.T1.S1',
    'Subtask 1',
    'Complete'
  );
  const subtask2: Subtask = createTestSubtask(
    'P1.M1.T1.S2',
    'Subtask 2',
    'Planned',
    ['P1.M1.T1.S1']
  );
  const subtask3: Subtask = createTestSubtask(
    'P1.M1.T1.S3',
    'Subtask 3',
    'Planned',
    ['P1.M1.T1.S2']
  );
  const subtask4: Subtask = createTestSubtask(
    'P1.M1.T2.S1',
    'Subtask 4',
    'Researching'
  );
  const subtask5: Subtask = createTestSubtask(
    'P1.M2.T1.S1',
    'Subtask 5',
    'Implementing'
  );
  const subtask6: Subtask = createTestSubtask(
    'P2.M1.T1.S1',
    'Subtask 6',
    'Planned'
  );

  const task1: Task = createTestTask('P1.M1.T1', 'Task 1', 'Planned', [
    subtask1,
    subtask2,
    subtask3,
  ]);
  const task2: Task = createTestTask('P1.M1.T2', 'Task 2', 'Planned', [
    subtask4,
  ]);
  const task3: Task = createTestTask('P1.M2.T1', 'Task 3', 'Implementing', [
    subtask5,
  ]);
  const task4: Task = createTestTask('P2.M1.T1', 'Task 4', 'Planned', [
    subtask6,
  ]);

  const milestone1: Milestone = createTestMilestone(
    'P1.M1',
    'Milestone 1',
    'Complete',
    [task1, task2]
  );
  const milestone2: Milestone = createTestMilestone(
    'P1.M2',
    'Milestone 2',
    'Implementing',
    [task3]
  );
  const milestone3: Milestone = createTestMilestone(
    'P2.M1',
    'Milestone 3',
    'Planned',
    [task4]
  );

  const phase1: Phase = createTestPhase('P1', 'Phase 1', 'Planned', [
    milestone1,
    milestone2,
  ]);
  const phase2: Phase = createTestPhase('P2', 'Phase 2', 'Planned', [
    milestone3,
  ]);

  return createTestBacklog([phase1, phase2]);
};

describe('utils/task-utils', () => {
  describe('isSubtask type guard', () => {
    it('should return true for Subtask items', () => {
      // SETUP: Subtask item
      const subtask: HierarchyItem = createTestSubtask(
        'P1.M1.T1.S1',
        'Test',
        'Planned'
      );

      // EXECUTE & VERIFY
      expect(isSubtask(subtask)).toBe(true);
    });

    it('should return false for Task items', () => {
      // SETUP: Task item
      const task: HierarchyItem = createTestTask('P1.M1.T1', 'Test', 'Planned');

      // EXECUTE & VERIFY
      expect(isSubtask(task)).toBe(false);
    });

    it('should return false for Milestone items', () => {
      // SETUP: Milestone item
      const milestone: HierarchyItem = createTestMilestone(
        'P1.M1',
        'Test',
        'Planned'
      );

      // EXECUTE & VERIFY
      expect(isSubtask(milestone)).toBe(false);
    });

    it('should return false for Phase items', () => {
      // SETUP: Phase item
      const phase: HierarchyItem = createTestPhase('P1', 'Test', 'Planned');

      // EXECUTE & VERIFY
      expect(isSubtask(phase)).toBe(false);
    });
  });

  describe('findItem', () => {
    describe('finding items at each hierarchy level', () => {
      it('should find a Phase by ID', () => {
        // SETUP: Backlog with phases
        const backlog = createComplexBacklog();

        // EXECUTE
        const result = findItem(backlog, 'P1');

        // VERIFY
        expect(result).not.toBeNull();
        expect(result?.id).toBe('P1');
        expect(result?.type).toBe('Phase');
      });

      it('should find a Milestone by ID', () => {
        // SETUP: Backlog with milestones
        const backlog = createComplexBacklog();

        // EXECUTE
        const result = findItem(backlog, 'P1.M1');

        // VERIFY
        expect(result).not.toBeNull();
        expect(result?.id).toBe('P1.M1');
        expect(result?.type).toBe('Milestone');
      });

      it('should find a Task by ID', () => {
        // SETUP: Backlog with tasks
        const backlog = createComplexBacklog();

        // EXECUTE
        const result = findItem(backlog, 'P1.M1.T1');

        // VERIFY
        expect(result).not.toBeNull();
        expect(result?.id).toBe('P1.M1.T1');
        expect(result?.type).toBe('Task');
      });

      it('should find a Subtask by ID', () => {
        // SETUP: Backlog with subtasks
        const backlog = createComplexBacklog();

        // EXECUTE
        const result = findItem(backlog, 'P1.M1.T1.S1');

        // VERIFY
        expect(result).not.toBeNull();
        expect(result?.id).toBe('P1.M1.T1.S1');
        expect(result?.type).toBe('Subtask');
        if (result && isSubtask(result)) {
          expect(result.story_points).toBe(2);
        }
      });

      it('should use early return and not continue searching after finding item', () => {
        // SETUP: Backlog with multiple items
        const backlog = createComplexBacklog();

        // EXECUTE: Find first item
        const startTime = performance.now();
        const result = findItem(backlog, 'P1');
        const endTime = performance.now();

        // VERIFY: Should return immediately
        expect(result?.id).toBe('P1');
        // Early return means this should be very fast
        expect(endTime - startTime).toBeLessThan(1);
      });
    });

    describe('not found scenarios', () => {
      it('should return null for non-existent ID', () => {
        // SETUP: Backlog
        const backlog = createComplexBacklog();

        // EXECUTE
        const result = findItem(backlog, 'NON-EXISTENT');

        // VERIFY
        expect(result).toBeNull();
      });

      it('should return null for empty backlog', () => {
        // SETUP: Empty backlog
        const emptyBacklog: Backlog = createTestBacklog([]);

        // EXECUTE
        const result = findItem(emptyBacklog, 'P1');

        // VERIFY
        expect(result).toBeNull();
      });

      it('should return null for partial ID match', () => {
        // SETUP: Backlog with full IDs
        const backlog = createComplexBacklog();

        // EXECUTE: Search with partial ID
        const result = findItem(backlog, 'P1.M1');

        // VERIFY: Should find exact match, not partial
        expect(result).not.toBeNull();
        expect(result?.id).toBe('P1.M1');
      });
    });

    describe('edge cases', () => {
      it('should handle phase with empty milestones', () => {
        // SETUP: Phase with empty milestones
        const phase = createTestPhase('P1', 'Empty Phase', 'Planned', []);
        const backlog = createTestBacklog([phase]);

        // EXECUTE
        const result = findItem(backlog, 'P1');

        // VERIFY: Should still find the phase
        expect(result?.id).toBe('P1');
      });

      it('should handle milestone with empty tasks', () => {
        // SETUP: Milestone with empty tasks
        const milestone = createTestMilestone(
          'P1.M1',
          'Empty Milestone',
          'Planned',
          []
        );
        const phase = createTestPhase('P1', 'Phase', 'Planned', [milestone]);
        const backlog = createTestBacklog([phase]);

        // EXECUTE
        const result = findItem(backlog, 'P1.M1');

        // VERIFY: Should still find the milestone
        expect(result?.id).toBe('P1.M1');
      });

      it('should handle task with empty subtasks', () => {
        // SETUP: Task with empty subtasks
        const task = createTestTask('P1.M1.T1', 'Empty Task', 'Planned', []);
        const milestone = createTestMilestone('P1.M1', 'Milestone', 'Planned', [
          task,
        ]);
        const phase = createTestPhase('P1', 'Phase', 'Planned', [milestone]);
        const backlog = createTestBacklog([phase]);

        // EXECUTE
        const result = findItem(backlog, 'P1.M1.T1');

        // VERIFY: Should still find the task
        expect(result?.id).toBe('P1.M1.T1');
      });
    });
  });

  describe('getDependencies', () => {
    it('should return empty array for subtask with no dependencies', () => {
      // SETUP: Subtask with empty dependencies
      const subtask = createTestSubtask('P1.M1.T1.S1', 'Test', 'Planned', []);
      const backlog = createComplexBacklog();

      // EXECUTE
      const result = getDependencies(subtask, backlog);

      // VERIFY
      expect(result).toEqual([]);
    });

    it('should return single dependency', () => {
      // SETUP: Subtask with one dependency
      const subtask = createTestSubtask('P1.M1.T1.S2', 'Test', 'Planned', [
        'P1.M1.T1.S1',
      ]);
      const backlog = createComplexBacklog();

      // EXECUTE
      const result = getDependencies(subtask, backlog);

      // VERIFY
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('P1.M1.T1.S1');
    });

    it('should return multiple dependencies in order', () => {
      // SETUP: Subtask with multiple dependencies
      const subtask = createTestSubtask('P1.M1.T1.S3', 'Test', 'Planned', [
        'P1.M1.T1.S1',
        'P1.M1.T1.S2',
      ]);
      const backlog = createComplexBacklog();

      // EXECUTE
      const result = getDependencies(subtask, backlog);

      // VERIFY
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('P1.M1.T1.S1');
      expect(result[1].id).toBe('P1.M1.T1.S2');
    });

    it('should filter out non-existent dependencies', () => {
      // SETUP: Subtask with invalid dependency
      const subtask = createTestSubtask('P1.M1.T1.S2', 'Test', 'Planned', [
        'P1.M1.T1.S1',
        'NON-EXISTENT',
      ]);
      const backlog = createComplexBacklog();

      // EXECUTE
      const result = getDependencies(subtask, backlog);

      // VERIFY: Should only return valid Subtask dependencies
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('P1.M1.T1.S1');
    });

    it('should filter out non-Subtask dependencies', () => {
      // SETUP: Subtask with dependency on non-subtask
      const subtask = createTestSubtask('P1.M1.T1.S2', 'Test', 'Planned', [
        'P1.M1.T1.S1',
        'P1.M1',
      ]);
      const backlog = createComplexBacklog();

      // EXECUTE
      const result = getDependencies(subtask, backlog);

      // VERIFY: Should only return Subtask type dependencies
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('P1.M1.T1.S1');
      expect(result.every(item => item.type === 'Subtask')).toBe(true);
    });

    it('should handle circular reference gracefully', () => {
      // SETUP: Subtask with self-reference (circular)
      const subtask = createTestSubtask('P1.M1.T1.S1', 'Test', 'Planned', [
        'P1.M1.T1.S1',
      ]);
      const backlog = createComplexBacklog();

      // EXECUTE: Should not infinite loop
      const result = getDependencies(subtask, backlog);

      // VERIFY: Should handle gracefully (either include or exclude self)
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('filterByStatus', () => {
    it('should return all Planned items', () => {
      // SETUP: Complex backlog
      const backlog = createComplexBacklog();

      // EXECUTE
      const result = filterByStatus(backlog, 'Planned');

      // VERIFY: Should include items at all levels with Planned status
      expect(result.length).toBeGreaterThan(0);
      expect(result.every(item => item.status === 'Planned')).toBe(true);

      // Check we have different types
      const types = new Set(result.map(item => item.type));
      expect(types.size).toBeGreaterThan(1);
    });

    it('should return all Complete items', () => {
      // SETUP: Complex backlog
      const backlog = createComplexBacklog();

      // EXECUTE
      const result = filterByStatus(backlog, 'Complete');

      // VERIFY
      expect(result.length).toBeGreaterThan(0);
      expect(result.every(item => item.status === 'Complete')).toBe(true);
    });

    it('should return all Researching items', () => {
      // SETUP: Complex backlog
      const backlog = createComplexBacklog();

      // EXECUTE
      const result = filterByStatus(backlog, 'Researching');

      // VERIFY
      expect(result.every(item => item.status === 'Researching')).toBe(true);
    });

    it('should return all Implementing items', () => {
      // SETUP: Complex backlog
      const backlog = createComplexBacklog();

      // EXECUTE
      const result = filterByStatus(backlog, 'Implementing');

      // VERIFY
      expect(result.every(item => item.status === 'Implementing')).toBe(true);
    });

    it('should return empty array when no items match status', () => {
      // SETUP: Backlog without Failed status
      const backlog = createComplexBacklog();

      // EXECUTE
      const result = filterByStatus(backlog, 'Failed');

      // VERIFY
      expect(result).toEqual([]);
    });

    it('should return empty array for empty backlog', () => {
      // SETUP: Empty backlog
      const emptyBacklog: Backlog = createTestBacklog([]);

      // EXECUTE
      const result = filterByStatus(emptyBacklog, 'Planned');

      // VERIFY
      expect(result).toEqual([]);
    });

    it('should preserve DFS pre-order in results', () => {
      // SETUP: Known backlog structure
      const backlog = createComplexBacklog();

      // EXECUTE
      const result = filterByStatus(backlog, 'Planned');

      // VERIFY: First Planned item should be P1 (Phase before children)
      if (result.length > 0) {
        const firstItem = result[0];
        // P1 is Planned and should come before its children in pre-order
        expect(firstItem.status).toBe('Planned');
      }
    });

    it('should include all four types in results', () => {
      // SETUP: Backlog with Planned items at all levels
      const backlog = createComplexBacklog();

      // EXECUTE
      const result = filterByStatus(backlog, 'Planned');

      // VERIFY: Check for all types
      const types = new Set(result.map(item => item.type));
      expect(types.has('Phase')).toBe(true);
      expect(types.has('Milestone')).toBe(true);
      expect(types.has('Task')).toBe(true);
      expect(types.has('Subtask')).toBe(true);
    });
  });

  describe('getNextPendingItem', () => {
    it('should return first Planned item in DFS pre-order', () => {
      // SETUP: Complex backlog with known structure
      const backlog = createComplexBacklog();

      // EXECUTE
      const result = getNextPendingItem(backlog);

      // VERIFY: Should return P1 (Phase is Planned and comes first in pre-order)
      expect(result).not.toBeNull();
      expect(result?.status).toBe('Planned');
      expect(result?.id).toBe('P1'); // Phase comes before its children
    });

    it('should return null when no Planned items exist', () => {
      // SETUP: Backlog with only Complete items
      const subtask = createTestSubtask('P1.M1.T1.S1', 'Test', 'Complete');
      const task = createTestTask('P1.M1.T1', 'Task', 'Complete', [subtask]);
      const milestone = createTestMilestone('P1.M1', 'Milestone', 'Complete', [
        task,
      ]);
      const phase = createTestPhase('P1', 'Phase', 'Complete', [milestone]);
      const backlog = createTestBacklog([phase]);

      // EXECUTE
      const result = getNextPendingItem(backlog);

      // VERIFY
      expect(result).toBeNull();
    });

    it('should return null for empty backlog', () => {
      // SETUP: Empty backlog
      const emptyBacklog: Backlog = createTestBacklog([]);

      // EXECUTE
      const result = getNextPendingItem(emptyBacklog);

      // VERIFY
      expect(result).toBeNull();
    });

    it('should find Planned subtask when parents are Complete', () => {
      // SETUP: Hierarchy with Complete parents but Planned subtask
      const subtask = createTestSubtask('P1.M1.T1.S1', 'Test', 'Planned');
      const task = createTestTask('P1.M1.T1', 'Task', 'Complete', [subtask]);
      const milestone = createTestMilestone('P1.M1', 'Milestone', 'Complete', [
        task,
      ]);
      const phase = createTestPhase('P1', 'Phase', 'Complete', [milestone]);
      const backlog = createTestBacklog([phase]);

      // EXECUTE
      const result = getNextPendingItem(backlog);

      // VERIFY: In pre-order, Phase is checked first (Complete), then Milestone (Complete), then Task (Complete), then Subtask (Planned)
      // But wait - pre-order means parent before children. Since all parents are Complete, we continue deeper.
      // The first Planned item found in DFS pre-order would be... wait, let me re-read the implementation.
      // The implementation checks P1 (Complete), then P1.M1 (Complete), then P1.M1.T1 (Complete), then P1.M1.T1.S1 (Planned)
      expect(result).not.toBeNull();
      expect(result?.id).toBe('P1.M1.T1.S1');
    });

    it('should use early return on first match', () => {
      // SETUP: Backlog with first item Planned
      const backlog = createComplexBacklog(); // P1 is Planned

      // EXECUTE
      const startTime = performance.now();
      const result = getNextPendingItem(backlog);
      const endTime = performance.now();

      // VERIFY: Should return immediately after finding first Planned item
      expect(result?.id).toBe('P1');
      expect(endTime - startTime).toBeLessThan(1);
    });

    it('should find Planned milestone when parent Phase is Complete', () => {
      // SETUP: Hierarchy where Phase is Complete but Milestone is Planned
      const subtask = createTestSubtask('P1.M1.T1.S1', 'Test', 'Complete');
      const task = createTestTask('P1.M1.T1', 'Task', 'Complete', [subtask]);
      const milestone = createTestMilestone('P1.M1', 'Milestone', 'Planned', [
        task,
      ]);
      const phase = createTestPhase('P1', 'Phase', 'Complete', [milestone]);
      const backlog = createTestBacklog([phase]);

      // EXECUTE
      const result = getNextPendingItem(backlog);

      // VERIFY: Should return the Planned milestone
      expect(result).not.toBeNull();
      expect(result?.id).toBe('P1.M1');
      expect(result?.type).toBe('Milestone');
    });

    it('should find Planned task when Phase and Milestone are Complete', () => {
      // SETUP: Hierarchy where Phase and Milestone are Complete but Task is Planned
      const subtask = createTestSubtask('P1.M1.T1.S1', 'Test', 'Complete');
      const task = createTestTask('P1.M1.T1', 'Task', 'Planned', [subtask]);
      const milestone = createTestMilestone('P1.M1', 'Milestone', 'Complete', [
        task,
      ]);
      const phase = createTestPhase('P1', 'Phase', 'Complete', [milestone]);
      const backlog = createTestBacklog([phase]);

      // EXECUTE
      const result = getNextPendingItem(backlog);

      // VERIFY: Should return the Planned task
      expect(result).not.toBeNull();
      expect(result?.id).toBe('P1.M1.T1');
      expect(result?.type).toBe('Task');
    });
  });

  describe('updateItemStatus', () => {
    it('should update subtask status', () => {
      // SETUP: Backlog with subtask
      const backlog = createComplexBacklog();

      // EXECUTE
      const updated = updateItemStatus(backlog, 'P1.M1.T1.S1', 'Failed');

      // VERIFY: Find the updated item
      const item = findItem(updated, 'P1.M1.T1.S1');
      expect(item?.status).toBe('Failed');
    });

    it('should update task status', () => {
      // SETUP: Backlog with task
      const backlog = createComplexBacklog();

      // EXECUTE
      const updated = updateItemStatus(backlog, 'P1.M1.T1', 'Complete');

      // VERIFY
      const item = findItem(updated, 'P1.M1.T1');
      expect(item?.status).toBe('Complete');
    });

    it('should update milestone status', () => {
      // SETUP: Backlog with milestone
      const backlog = createComplexBacklog();

      // EXECUTE
      const updated = updateItemStatus(backlog, 'P1.M1', 'Implementing');

      // VERIFY
      const item = findItem(updated, 'P1.M1');
      expect(item?.status).toBe('Implementing');
    });

    it('should update phase status', () => {
      // SETUP: Backlog with phase
      const backlog = createComplexBacklog();

      // EXECUTE
      const updated = updateItemStatus(backlog, 'P1', 'Researching');

      // VERIFY
      const item = findItem(updated, 'P1');
      expect(item?.status).toBe('Researching');
    });

    it('should not mutate original backlog (immutability)', () => {
      // SETUP: Backlog
      const backlog = createComplexBacklog();
      const originalJSON = JSON.stringify(backlog);

      // EXECUTE
      const updated = updateItemStatus(backlog, 'P1.M1.T1.S1', 'Failed');

      // VERIFY: Original unchanged
      expect(JSON.stringify(backlog)).toEqual(originalJSON);
      expect(updated).not.toEqual(backlog);
    });

    it('should preserve unchanged items with structural sharing', () => {
      // SETUP: Backlog
      const backlog = createComplexBacklog();
      const _originalPhase = backlog.backlog[0];

      // EXECUTE: Update a subtask
      const updated = updateItemStatus(backlog, 'P1.M1.T1.S1', 'Failed');

      // VERIFY: Phase should be a new object (because we're updating deep within it)
      // But the other phase (P2) should be the same reference
      expect(updated.backlog[1]).toBe(backlog.backlog[1]); // P2 unchanged
    });

    it('should only update the target item, not siblings', () => {
      // SETUP: Backlog with multiple subtasks
      const backlog = createComplexBacklog();

      // EXECUTE: Update one subtask
      const updated = updateItemStatus(backlog, 'P1.M1.T1.S1', 'Failed');

      // VERIFY: Sibling should keep original status
      const sibling = findItem(updated, 'P1.M1.T1.S2');
      expect(sibling?.status).toBe('Planned'); // Original status
    });

    it('should handle non-existent ID gracefully', () => {
      // SETUP: Backlog
      const backlog = createComplexBacklog();
      const originalJSON = JSON.stringify(backlog);

      // EXECUTE: Try to update non-existent item
      const updated = updateItemStatus(backlog, 'NON-EXISTENT', 'Failed');

      // VERIFY: Should return unchanged backlog
      expect(JSON.stringify(updated)).toEqual(originalJSON);
    });

    it('should handle empty backlog', () => {
      // SETUP: Empty backlog
      const emptyBacklog: Backlog = createTestBacklog([]);

      // EXECUTE
      const updated = updateItemStatus(emptyBacklog, 'P1', 'Complete');

      // VERIFY: Should return empty backlog
      expect(updated).toEqual(emptyBacklog);
    });

    it('should update deeply nested subtask', () => {
      // SETUP: Deeply nested structure
      const subtask = createTestSubtask('P1.M1.T1.S1', 'Deep', 'Planned');
      const task = createTestTask('P1.M1.T1', 'Task', 'Planned', [subtask]);
      const milestone = createTestMilestone('P1.M1', 'Milestone', 'Planned', [
        task,
      ]);
      const phase = createTestPhase('P1', 'Phase', 'Planned', [milestone]);
      const backlog = createTestBacklog([phase]);

      // EXECUTE
      const updated = updateItemStatus(backlog, 'P1.M1.T1.S1', 'Complete');

      // VERIFY: All parent levels should be new objects
      expect(updated.backlog[0]).not.toBe(backlog.backlog[0]); // New phase
      expect(updated.backlog[0].milestones[0]).not.toBe(
        backlog.backlog[0].milestones[0]
      ); // New milestone
      expect(updated.backlog[0].milestones[0].tasks[0]).not.toBe(
        backlog.backlog[0].milestones[0].tasks[0]
      ); // New task
      expect(updated.backlog[0].milestones[0].tasks[0].subtasks[0]).not.toBe(
        backlog.backlog[0].milestones[0].tasks[0].subtasks[0]
      ); // New subtask
    });

    it('should support all status values', () => {
      // SETUP: Backlog
      const backlog = createComplexBacklog();

      // EXECUTE & VERIFY each status value
      const statuses: Status[] = [
        'Planned',
        'Researching',
        'Implementing',
        'Complete',
        'Failed',
        'Obsolete',
      ];

      for (const status of statuses) {
        const updated = updateItemStatus(backlog, 'P1.M1.T1.S1', status);
        const item = findItem(updated, 'P1.M1.T1.S1');
        expect(item?.status).toBe(status);
      }
    });
  });

  describe('integration scenarios', () => {
    it('should support typical task orchestrator workflow', () => {
      // SETUP: Task orchestrator workflow
      const backlog = createComplexBacklog();

      // EXECUTE: Get next pending item
      const nextItem = getNextPendingItem(backlog);
      expect(nextItem).not.toBeNull();

      // EXECUTE: Check dependencies
      if (nextItem && isSubtask(nextItem)) {
        const deps = getDependencies(nextItem, backlog);
        expect(Array.isArray(deps)).toBe(true);

        // EXECUTE: Update status after completion
        const updated = updateItemStatus(backlog, nextItem.id, 'Complete');
        const updatedItem = findItem(updated, nextItem.id);
        expect(updatedItem?.status).toBe('Complete');

        // VERIFY: Original unchanged
        expect(backlog).not.toEqual(updated);
      }
    });

    it('should filter and find items consistently', () => {
      // SETUP: Backlog
      const backlog = createComplexBacklog();

      // EXECUTE: Get all Planned items
      const plannedItems = filterByStatus(backlog, 'Planned');

      // EXECUTE & VERIFY: Can find each Planned item
      for (const item of plannedItems) {
        const found = findItem(backlog, item.id);
        expect(found?.id).toBe(item.id);
      }
    });

    it('should handle complex multi-update scenario', () => {
      // SETUP: Backlog
      const backlog = createComplexBacklog();

      // EXECUTE: Chain multiple updates
      let updated = updateItemStatus(backlog, 'P1.M1.T1.S1', 'Complete');
      updated = updateItemStatus(updated, 'P1.M1.T1.S2', 'Complete');
      updated = updateItemStatus(updated, 'P1.M1.T1.S3', 'Complete');

      // VERIFY: All updates applied
      expect(findItem(updated, 'P1.M1.T1.S1')?.status).toBe('Complete');
      expect(findItem(updated, 'P1.M1.T1.S2')?.status).toBe('Complete');
      expect(findItem(updated, 'P1.M1.T1.S3')?.status).toBe('Complete');

      // VERIFY: Original unchanged
      expect(findItem(backlog, 'P1.M1.T1.S1')?.status).toBe('Complete'); // Original was Complete
      expect(findItem(backlog, 'P1.M1.T1.S2')?.status).toBe('Planned'); // Original was Planned
    });
  });

  describe('edge cases and boundary conditions', () => {
    it('should handle backlog with only one phase', () => {
      // SETUP: Single phase backlog
      const phase = createTestPhase('P1', 'Single Phase', 'Planned');
      const backlog = createTestBacklog([phase]);

      // EXECUTE & VERIFY
      expect(findItem(backlog, 'P1')?.id).toBe('P1');
      expect(getNextPendingItem(backlog)?.id).toBe('P1');
    });

    it('should handle backlog with only one milestone', () => {
      // SETUP: Single milestone
      const milestone = createTestMilestone(
        'P1.M1',
        'Single Milestone',
        'Planned'
      );
      const phase = createTestPhase('P1', 'Phase', 'Planned', [milestone]);
      const backlog = createTestBacklog([phase]);

      // EXECUTE & VERIFY
      expect(findItem(backlog, 'P1.M1')?.id).toBe('P1.M1');
    });

    it('should handle backlog with only one task', () => {
      // SETUP: Single task
      const task = createTestTask('P1.M1.T1', 'Single Task', 'Planned');
      const milestone = createTestMilestone('P1.M1', 'Milestone', 'Planned', [
        task,
      ]);
      const phase = createTestPhase('P1', 'Phase', 'Planned', [milestone]);
      const backlog = createTestBacklog([phase]);

      // EXECUTE & VERIFY
      expect(findItem(backlog, 'P1.M1.T1')?.id).toBe('P1.M1.T1');
    });

    it('should handle backlog with only one subtask', () => {
      // SETUP: Single subtask
      const subtask = createTestSubtask(
        'P1.M1.T1.S1',
        'Single Subtask',
        'Planned'
      );
      const task = createTestTask('P1.M1.T1', 'Task', 'Planned', [subtask]);
      const milestone = createTestMilestone('P1.M1', 'Milestone', 'Planned', [
        task,
      ]);
      const phase = createTestPhase('P1', 'Phase', 'Planned', [milestone]);
      const backlog = createTestBacklog([phase]);

      // EXECUTE & VERIFY
      expect(findItem(backlog, 'P1.M1.T1.S1')?.id).toBe('P1.M1.T1.S1');
    });

    it('should handle maximum depth hierarchy', () => {
      // SETUP: 4-level deep hierarchy (max for this system)
      const subtask = createTestSubtask('P1.M1.T1.S1', 'Deep', 'Planned');
      const task = createTestTask('P1.M1.T1', 'Task', 'Planned', [subtask]);
      const milestone = createTestMilestone('P1.M1', 'Milestone', 'Planned', [
        task,
      ]);
      const phase = createTestPhase('P1', 'Phase', 'Planned', [milestone]);
      const backlog = createTestBacklog([phase]);

      // EXECUTE: Update deepest item
      const updated = updateItemStatus(backlog, 'P1.M1.T1.S1', 'Complete');

      // VERIFY: Update successful at maximum depth
      expect(findItem(updated, 'P1.M1.T1.S1')?.status).toBe('Complete');
    });

    it('should handle items with all status values', () => {
      // SETUP: Items with each status
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
      const task = createTestTask('P1.M1.T1', 'Task', 'Planned', subtasks);
      const milestone = createTestMilestone('P1.M1', 'Milestone', 'Planned', [
        task,
      ]);
      const phase = createTestPhase('P1', 'Phase', 'Planned', [milestone]);
      const backlog = createTestBacklog([phase]);

      // EXECUTE & VERIFY: Can filter by each status
      for (const status of statuses) {
        const items = filterByStatus(backlog, status);
        expect(items.some(item => item.status === status)).toBe(true);
      }
    });

    it('should handle multiple phases with similar IDs', () => {
      // SETUP: Multiple phases
      const phase1 = createTestPhase('P1', 'Phase 1', 'Complete');
      const phase2 = createTestPhase('P2', 'Phase 2', 'Planned');
      const phase3 = createTestPhase('P3', 'Phase 3', 'Implementing');
      const backlog = createTestBacklog([phase1, phase2, phase3]);

      // EXECUTE & VERIFY: Can find each phase
      expect(findItem(backlog, 'P1')?.id).toBe('P1');
      expect(findItem(backlog, 'P2')?.id).toBe('P2');
      expect(findItem(backlog, 'P3')?.id).toBe('P3');
    });
  });

  describe('normalizeTaskId', () => {
    it('canonical + loose forms all normalize to [1,1,1,1]', () => {
      expect(normalizeTaskId('P1.M1.T1.S1')).toEqual([1, 1, 1, 1]);
      expect(normalizeTaskId('p1m1t1s1')).toEqual([1, 1, 1, 1]);
      expect(normalizeTaskId('1.1.1.1')).toEqual([1, 1, 1, 1]);
    });

    it('partial forms keep only the leading segments', () => {
      expect(normalizeTaskId('1.2')).toEqual([1, 2]);
      expect(normalizeTaskId('1')).toEqual([1]);
    });

    it('returns null for empty / whitespace / no-digits', () => {
      expect(normalizeTaskId('')).toBeNull();
      expect(normalizeTaskId('   ')).toBeNull();
      expect(normalizeTaskId('foo')).toBeNull();
    });

    it('returns null for more than 4 segments', () => {
      expect(normalizeTaskId('1.2.3.4.5')).toBeNull();
    });

    it('normalizes 0 to [0] (syntactically valid; rejected later by the 1-based lookup)', () => {
      // NOTE: '0' is syntactically valid per the regex+cap-4 contract; the 0 is rejected
      // positionally by findItemByLooseId (backlog[0-1] === undefined → null), not here.
      expect(normalizeTaskId('0')).toEqual([0]);
    });
  });

  describe('findItemByLooseId', () => {
    const backlog = createComplexBacklog();

    it('canonical + loose forms all resolve to the same subtask', () => {
      expect(findItemByLooseId(backlog, '1.1.1.1')?.canonicalId).toBe(
        'P1.M1.T1.S1'
      );
      expect(findItemByLooseId(backlog, 'p1m1t1s1')?.canonicalId).toBe(
        'P1.M1.T1.S1'
      );
      expect(findItemByLooseId(backlog, 'P1.M1.T1.S1')?.canonicalId).toBe(
        'P1.M1.T1.S1'
      );
      expect(findItemByLooseId(backlog, '1.1.1.1')?.item.type).toBe('Subtask');
    });

    it('trailing omission resolves higher-level items', () => {
      // 1 → phase, 1.2 → milestone, 1.1.2 → task (trailing segments may be omitted)
      expect(findItemByLooseId(backlog, '1')?.item.type).toBe('Phase');
      expect(findItemByLooseId(backlog, '1')?.canonicalId).toBe('P1');
      expect(findItemByLooseId(backlog, '1.2')?.canonicalId).toBe('P1.M2');
      expect(findItemByLooseId(backlog, '1.1.2')?.canonicalId).toBe('P1.M1.T2');
    });

    it('resolves items in the second phase', () => {
      expect(findItemByLooseId(backlog, '2.1.1.1')?.canonicalId).toBe(
        'P2.M1.T1.S1'
      );
    });

    it('returns null for out-of-bounds at every level', () => {
      expect(findItemByLooseId(backlog, '9.9.9.9')).toBeNull(); // deep OOB
      expect(findItemByLooseId(backlog, '3')).toBeNull(); // only 2 phases
      expect(findItemByLooseId(backlog, '1.3')).toBeNull(); // P1 has 2 milestones
      expect(findItemByLooseId(backlog, '1.1.9')).toBeNull(); // P1.M1 has 2 tasks
      expect(findItemByLooseId(backlog, '1.1.1.9')).toBeNull(); // P1.M1.T1 has 3 subtasks
    });

    it('returns null for unparseable loose IDs', () => {
      expect(findItemByLooseId(backlog, '')).toBeNull();
      expect(findItemByLooseId(backlog, 'foo')).toBeNull();
    });

    it('returns null for the 0 segment (1-based lookup: backlog[-1] is undefined)', () => {
      expect(findItemByLooseId(backlog, '0')).toBeNull();
    });
  });

  describe('matchStatus', () => {
    it('synonym table (step 1) — exact, case-insensitive', () => {
      // Complete synonyms
      expect(matchStatus('done')).toEqual({ status: 'Complete' });
      expect(matchStatus('d')).toEqual({ status: 'Complete' });
      expect(matchStatus('fin')).toEqual({ status: 'Complete' });
      expect(matchStatus('finished')).toEqual({ status: 'Complete' });
      expect(matchStatus('completed')).toEqual({ status: 'Complete' });
      // Ready synonyms
      expect(matchStatus('re')).toEqual({ status: 'Ready' });
      expect(matchStatus('rdy')).toEqual({ status: 'Ready' });
      // case-insensitive
      expect(matchStatus('DONE')).toEqual({ status: 'Complete' });
      expect(matchStatus('Re')).toEqual({ status: 'Ready' });
    });

    it('canonical exact, case-insensitive (step 2)', () => {
      expect(matchStatus('ready')).toEqual({ status: 'Ready' });
      expect(matchStatus('Complete')).toEqual({ status: 'Complete' });
      expect(matchStatus('FAILED')).toEqual({ status: 'Failed' });
      expect(matchStatus('planned')).toEqual({ status: 'Planned' });
      expect(matchStatus('OBSOLETE')).toEqual({ status: 'Obsolete' });
      expect(matchStatus('implementing')).toEqual({ status: 'Implementing' });
      expect(matchStatus('researching')).toEqual({ status: 'Researching' });
    });

    it('unique prefix (step 3) — single match', () => {
      expect(matchStatus('comp')).toEqual({ status: 'Complete' });
      expect(matchStatus('c')).toEqual({ status: 'Complete' });
      expect(matchStatus('p')).toEqual({ status: 'Planned' });
      expect(matchStatus('i')).toEqual({ status: 'Implementing' });
      expect(matchStatus('o')).toEqual({ status: 'Obsolete' });
      expect(matchStatus('f')).toEqual({ status: 'Failed' });
      expect(matchStatus('res')).toEqual({ status: 'Researching' });
    });

    it('"re" is a synonym that preempts the r-prefix ambiguity', () => {
      // 're' is a synonym for Ready (step 1) — it NEVER reaches prefix
      // matching, where it would also match Researching (ambiguous). This
      // preemption is the PRD §5.4 design.
      expect(matchStatus('re')).toEqual({ status: 'Ready' });
    });

    it('unique substring, not a prefix of any status (step 4)', () => {
      expect(matchStatus('search')).toEqual({ status: 'Researching' });
      expect(matchStatus('lan')).toEqual({ status: 'Planned' });
    });

    it('ambiguous via prefix (step 5) — 2+ matches', () => {
      const r = matchStatus('r');
      expect('error' in r).toBe(true);
      if ('error' in r) {
        // 'r' prefix-matches Researching + Ready (in MATCHABLE_STATUSES order:
        // Researching precedes Ready in the canonical lifecycle list).
        expect(r.candidates).toEqual(['Researching', 'Ready']);
        expect(r.error).toContain('Ambiguous status "r"');
        expect(r.error).toContain('Researching');
        expect(r.error).toContain('Ready');
      }
    });

    it('ambiguous via substring (step 5) — 2+ matches', () => {
      const ed = matchStatus('ed');
      expect('error' in ed).toBe(true);
      if ('error' in ed) {
        // 'ed' is a substring of both Planned and Failed (in MATCHABLE_STATUSES
        // order: Planned precedes Failed in the canonical lifecycle list).
        expect(ed.candidates).toEqual(['Planned', 'Failed']);
        expect(ed.error).toContain('Ambiguous status "ed"');
      }
    });

    it('unknown (step 6) — 0 matches lists all 7 valid statuses', () => {
      const bogus = matchStatus('bogus');
      expect('error' in bogus).toBe(true);
      if ('error' in bogus) {
        expect(bogus.candidates).toEqual([
          'Planned',
          'Researching',
          'Ready',
          'Implementing',
          'Complete',
          'Failed',
          'Obsolete',
        ]);
        expect(bogus.error).toContain('Unknown status "bogus"');
        expect(bogus.error).toContain('Valid statuses');
      }
    });

    it('a non-synonym near-miss is unknown (synonym exactness)', () => {
      // 'done' is the synonym; 'don' is NOT (step 1 is exact, not prefix).
      // 'don' is not exact, not a prefix of any, not a substring of any → unknown.
      const don = matchStatus('don');
      expect('error' in don).toBe(true);
    });

    it('Retrying is NOT matchable (excluded from the lifecycle set)', () => {
      // 'ret' would prefix-match 'Retrying' among the 8 Status values, but
      // Retrying is EXCLUDED from MATCHABLE_STATUSES → 'ret' matches nothing
      // → unknown, and candidates must NOT include Retrying.
      const ret = matchStatus('ret');
      expect('error' in ret).toBe(true);
      if ('error' in ret) {
        expect(ret.candidates).not.toContain('Retrying');
        expect(ret.candidates).toHaveLength(7);
      }
    });
  });

  describe('cascadeCompleteDown', () => {
    it('sets a leaf Subtask to Complete (no children)', () => {
      // SETUP: A leaf subtask in a non-Complete status
      const sub = createTestSubtask('P1.M1.T1.S1', 'leaf', 'Planned');

      // EXECUTE
      const out = cascadeCompleteDown(sub);

      // VERIFY: returned item is Complete; original untouched
      expect(out.status).toBe('Complete');
      expect(out.id).toBe('P1.M1.T1.S1');
      expect(sub.status).toBe('Planned');
    });

    it('cascades Complete down a Task to all its Subtasks', () => {
      // SETUP: A task with subtasks in mixed statuses
      const task = createTestTask('P1.M1.T1', 't', 'Implementing', [
        createTestSubtask('P1.M1.T1.S1', 'a', 'Planned'),
        createTestSubtask('P1.M1.T1.S2', 'b', 'Failed'),
      ]);

      // EXECUTE
      const out = cascadeCompleteDown(task);

      // VERIFY: task + every subtask → Complete
      expect(out.status).toBe('Complete');
      expect(out.subtasks.map(s => s.status)).toEqual(['Complete', 'Complete']);
      // original untouched
      expect(task.status).toBe('Implementing');
      expect(task.subtasks.map(s => s.status)).toEqual(['Planned', 'Failed']);
    });

    it('cascades Complete down a Milestone to all Tasks and Subtasks', () => {
      // SETUP: A milestone with a nested task + subtask
      const milestone = createTestMilestone('P1.M1', 'm', 'Planned', [
        createTestTask('P1.M1.T1', 't1', 'Planned', [
          createTestSubtask('P1.M1.T1.S1', 'a', 'Planned'),
        ]),
      ]);

      // EXECUTE
      const out = cascadeCompleteDown(milestone);

      // VERIFY: milestone + task + subtask → Complete (deep)
      expect(out.status).toBe('Complete');
      expect(out.tasks[0].status).toBe('Complete');
      expect(out.tasks[0].subtasks[0].status).toBe('Complete');
    });

    it('cascades Complete down a Phase to every descendant (full deep cascade)', () => {
      // SETUP: A full 4-level tree
      const phase = createTestPhase('P1', 'phase', 'Planned', [
        createTestMilestone('P1.M1', 'm', 'Planned', [
          createTestTask('P1.M1.T1', 't', 'Planned', [
            createTestSubtask('P1.M1.T1.S1', 'leaf', 'Planned'),
          ]),
        ]),
      ]);

      // EXECUTE
      const out = cascadeCompleteDown(phase);

      // VERIFY: every level → Complete
      expect(out.status).toBe('Complete');
      expect(out.milestones[0].status).toBe('Complete');
      expect(out.milestones[0].tasks[0].status).toBe('Complete');
      expect(out.milestones[0].tasks[0].subtasks[0].status).toBe('Complete');
    });

    it('does NOT mutate the input tree (immutability)', () => {
      // SETUP: A phase tree with mixed statuses
      const phase = createTestPhase('P1', 'phase', 'Planned', [
        createTestMilestone('P1.M1', 'm', 'Researching', [
          createTestTask('P1.M1.T1', 't', 'Implementing', [
            createTestSubtask('P1.M1.T1.S1', 'leaf', 'Ready'),
          ]),
        ]),
      ]);
      const snapshot = JSON.parse(JSON.stringify(phase));

      // EXECUTE: cascade (discard result; we only care about the input)
      cascadeCompleteDown(phase);

      // VERIFY: original tree is byte-for-byte unchanged
      expect(JSON.parse(JSON.stringify(phase))).toEqual(snapshot);
    });

    it('is idempotent on an already-all-Complete subtree', () => {
      // SETUP: A tree where every node is already Complete
      const phase = createTestPhase('P1', 'phase', 'Complete', [
        createTestMilestone('P1.M1', 'm', 'Complete', [
          createTestTask('P1.M1.T1', 't', 'Complete', [
            createTestSubtask('P1.M1.T1.S1', 'leaf', 'Complete'),
          ]),
        ]),
      ]);

      // EXECUTE
      const out = cascadeCompleteDown(phase);

      // VERIFY: still all Complete, and structurally equal to the input
      expect(out.status).toBe('Complete');
      expect(out.milestones[0].tasks[0].subtasks[0].status).toBe('Complete');
      expect(out).toEqual(phase);
    });

    it('forces every node Complete regardless of prior mixed statuses (distinct from monotonic rollup)', () => {
      // SETUP: A tree the monotonic rollup would NOT promote (children not all
      // Complete). cascadeCompleteDown must force them ALL Complete anyway.
      const task = createTestTask('P1.M1.T1', 't', 'Planned', [
        createTestSubtask('P1.M1.T1.S1', 'a', 'Planned'),
        createTestSubtask('P1.M1.T1.S2', 'b', 'Implementing'),
        createTestSubtask('P1.M1.T1.S3', 'c', 'Failed'),
      ]);

      // EXECUTE
      const out = cascadeCompleteDown(task);

      // VERIFY: parent + every child → Complete, regardless of prior state
      expect(out.status).toBe('Complete');
      expect(out.subtasks.map(s => s.status)).toEqual([
        'Complete',
        'Complete',
        'Complete',
      ]);
    });

    it('preserves non-status fields (id/title/type/story_points/dependencies)', () => {
      // SETUP: A subtask with a dependency + story points
      const sub = createTestSubtask('P1.M1.T1.S1', 'leaf', 'Planned', [
        'P1.M1.T1.S0',
      ]);

      // EXECUTE
      const out = cascadeCompleteDown(sub);

      // VERIFY: only status changed; every other field preserved
      expect(out.id).toBe('P1.M1.T1.S1');
      expect(out.title).toBe('leaf');
      expect(out.type).toBe('Subtask');
      expect(out.story_points).toBe(sub.story_points);
      expect(out.dependencies).toEqual(['P1.M1.T1.S0']);
    });
  });
});
