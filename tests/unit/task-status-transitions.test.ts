/**
 * Unit tests for task status values and transitions
 *
 * @remarks
 * Tests validate status type definition, valid transitions,
 * invalid transition handling, and Obsolete status in delta sessions.
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Status } from '../../src/core/models.js';
import { StatusEnum } from '../../src/core/models.js';
import type {
  Subtask,
  Task,
  Milestone,
  Phase,
  Backlog,
} from '../../src/core/models.js';
import { updateItemStatus } from '../../src/utils/task-utils.js';
import { patchBacklog } from '../../src/core/task-patcher.js';
import type {
  RequirementChange,
  DeltaAnalysis,
} from '../../src/core/models.js';

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
vi.mock('../../src/utils/logger.js', () => ({
  getLogger: vi.fn(() => mockLogger),
}));

// PATTERN: Factory functions for test data
const createTestSubtask = (
  id: string,
  title: string,
  status: Status,
  dependencies: string[] = [],
  context_scope: string = 'Test scope'
): Subtask => ({
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
  subtasks: Subtask[] = []
): Task => ({
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
  tasks: Task[] = []
): Milestone => ({
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
  milestones: Milestone[] = []
): Phase => ({
  id,
  type: 'Phase' as const,
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

// PATTERN: Status value validation test
describe('Task Status Values and Transitions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('StatusEnum', () => {
    it('should accept all valid status values', () => {
      // SETUP: All eight valid status values
      const validStatuses = [
        'Planned',
        'Researching',
        'Ready',
        'Implementing',
        'Retrying',
        'Complete',
        'Failed',
        'Obsolete',
      ] as const;

      // EXECUTE & VERIFY: Each status should parse successfully
      validStatuses.forEach(status => {
        const result = StatusEnum.safeParse(status);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data).toBe(status);
        }
      });
    });

    it('should reject invalid status values', () => {
      // SETUP: Invalid status values
      const invalidStatuses = [
        'Pending',
        'InProgress',
        'Done',
        'Cancelled',
        '',
        'planned', // Wrong case
        'PLANNED', // Wrong case
      ];

      // EXECUTE & VERIFY: Each invalid status should fail
      invalidStatuses.forEach(status => {
        const result = StatusEnum.safeParse(status);
        expect(result.success).toBe(false);
      });
    });

    it('should have exactly eight status values', () => {
      // VERIFY: StatusEnum has exactly 8 options
      const statusValues = StatusEnum.options;
      expect(statusValues).toHaveLength(8);
      expect(statusValues).toContain('Planned');
      expect(statusValues).toContain('Researching');
      expect(statusValues).toContain('Ready');
      expect(statusValues).toContain('Implementing');
      expect(statusValues).toContain('Retrying');
      expect(statusValues).toContain('Complete');
      expect(statusValues).toContain('Failed');
      expect(statusValues).toContain('Obsolete');
    });
  });

  // PATTERN: Valid status transition tests
  describe('Valid Status Transitions', () => {
    it('should accept Planned → Researching transition', () => {
      // SETUP: Create subtask in Planned status
      const subtask = createTestSubtask(
        'P1.M1.T1.S1',
        'Test Subtask',
        'Planned'
      );
      const task = createTestTask('P1.M1.T1', 'Test Task', 'Planned', [
        subtask,
      ]);
      const milestone = createTestMilestone(
        'P1.M1',
        'Test Milestone',
        'Planned',
        [task]
      );
      const phase = createTestPhase('P1', 'Test Phase', 'Planned', [milestone]);
      const backlog = createTestBacklog([phase]);

      // EXECUTE: Update status to Researching
      const updated = updateItemStatus(backlog, subtask.id, 'Researching');

      // VERIFY: Status changed to Researching
      const updatedSubtask =
        updated.backlog[0]?.milestones[0]?.tasks[0]?.subtasks[0];
      expect(updatedSubtask?.status).toBe('Researching');

      // VERIFY: Original object is immutable
      expect(subtask.status).toBe('Planned');
    });

    it('should accept Researching → Implementing transition', () => {
      // SETUP: Create subtask in Researching status
      const subtask = createTestSubtask(
        'P1.M1.T1.S1',
        'Test Subtask',
        'Researching'
      );
      const task = createTestTask('P1.M1.T1', 'Test Task', 'Researching', [
        subtask,
      ]);
      const milestone = createTestMilestone(
        'P1.M1',
        'Test Milestone',
        'Researching',
        [task]
      );
      const phase = createTestPhase('P1', 'Test Phase', 'Researching', [
        milestone,
      ]);
      const backlog = createTestBacklog([phase]);

      // EXECUTE: Update status to Implementing
      const updated = updateItemStatus(backlog, subtask.id, 'Implementing');

      // VERIFY: Status changed to Implementing
      const updatedSubtask =
        updated.backlog[0]?.milestones[0]?.tasks[0]?.subtasks[0];
      expect(updatedSubtask?.status).toBe('Implementing');
    });

    it('should accept Implementing → Complete transition', () => {
      // SETUP: Create subtask in Implementing status
      const subtask = createTestSubtask(
        'P1.M1.T1.S1',
        'Test Subtask',
        'Implementing'
      );
      const task = createTestTask('P1.M1.T1', 'Test Task', 'Implementing', [
        subtask,
      ]);
      const milestone = createTestMilestone(
        'P1.M1',
        'Test Milestone',
        'Implementing',
        [task]
      );
      const phase = createTestPhase('P1', 'Test Phase', 'Implementing', [
        milestone,
      ]);
      const backlog = createTestBacklog([phase]);

      // EXECUTE: Update status to Complete
      const updated = updateItemStatus(backlog, subtask.id, 'Complete');

      // VERIFY: Status changed to Complete
      const updatedSubtask =
        updated.backlog[0]?.milestones[0]?.tasks[0]?.subtasks[0];
      expect(updatedSubtask?.status).toBe('Complete');
    });

    it('should accept Implementing → Failed transition', () => {
      // SETUP: Create subtask in Implementing status
      const subtask = createTestSubtask(
        'P1.M1.T1.S1',
        'Test Subtask',
        'Implementing'
      );
      const task = createTestTask('P1.M1.T1', 'Test Task', 'Implementing', [
        subtask,
      ]);
      const milestone = createTestMilestone(
        'P1.M1',
        'Test Milestone',
        'Implementing',
        [task]
      );
      const phase = createTestPhase('P1', 'Test Phase', 'Implementing', [
        milestone,
      ]);
      const backlog = createTestBacklog([phase]);

      // EXECUTE: Update status to Failed
      const updated = updateItemStatus(backlog, subtask.id, 'Failed');

      // VERIFY: Status changed to Failed
      const updatedSubtask =
        updated.backlog[0]?.milestones[0]?.tasks[0]?.subtasks[0];
      expect(updatedSubtask?.status).toBe('Failed');
    });
  });

  // PATTERN: Document invalid transitions (currently accepted)
  describe('Invalid Status Transitions (Documented)', () => {
    it('should currently accept backward transitions (no validation)', () => {
      // SETUP: Create subtask in Researching status
      const subtask = createTestSubtask(
        'P1.M1.T1.S1',
        'Test Subtask',
        'Researching'
      );
      const task = createTestTask('P1.M1.T1', 'Test Task', 'Researching', [
        subtask,
      ]);
      const milestone = createTestMilestone(
        'P1.M1',
        'Test Milestone',
        'Researching',
        [task]
      );
      const phase = createTestPhase('P1', 'Test Phase', 'Researching', [
        milestone,
      ]);
      const backlog = createTestBacklog([phase]);

      // EXECUTE: Attempt backward transition to Planned
      const updated = updateItemStatus(backlog, subtask.id, 'Planned');

      // VERIFY: Transition is accepted (current behavior)
      // NOTE: This should ideally be invalid, but system accepts all transitions
      const updatedSubtask =
        updated.backlog[0]?.milestones[0]?.tasks[0]?.subtasks[0];
      expect(updatedSubtask?.status).toBe('Planned');
    });

    it('should currently accept stage-skipping transitions (no validation)', () => {
      // SETUP: Create subtask in Planned status
      const subtask = createTestSubtask(
        'P1.M1.T1.S1',
        'Test Subtask',
        'Planned'
      );
      const task = createTestTask('P1.M1.T1', 'Test Task', 'Planned', [
        subtask,
      ]);
      const milestone = createTestMilestone(
        'P1.M1',
        'Test Milestone',
        'Planned',
        [task]
      );
      const phase = createTestPhase('P1', 'Test Phase', 'Planned', [milestone]);
      const backlog = createTestBacklog([phase]);

      // EXECUTE: Attempt skip to Complete (bypasses Researching/Implementing)
      const updated = updateItemStatus(backlog, subtask.id, 'Complete');

      // VERIFY: Transition is accepted (current behavior)
      // NOTE: This should ideally be invalid, but system accepts all transitions
      const updatedSubtask =
        updated.backlog[0]?.milestones[0]?.tasks[0]?.subtasks[0];
      expect(updatedSubtask?.status).toBe('Complete');
    });

    it('should currently accept terminal state transitions (no validation)', () => {
      // SETUP: Create subtask in Complete status
      const subtask = createTestSubtask(
        'P1.M1.T1.S1',
        'Test Subtask',
        'Complete'
      );
      const task = createTestTask('P1.M1.T1', 'Test Task', 'Complete', [
        subtask,
      ]);
      const milestone = createTestMilestone(
        'P1.M1',
        'Test Milestone',
        'Complete',
        [task]
      );
      const phase = createTestPhase('P1', 'Test Phase', 'Complete', [
        milestone,
      ]);
      const backlog = createTestBacklog([phase]);

      // EXECUTE: Attempt transition from Complete to Failed
      const updated = updateItemStatus(backlog, subtask.id, 'Failed');

      // VERIFY: Transition is accepted (current behavior)
      // NOTE: Complete should be terminal, but system accepts all transitions
      const updatedSubtask =
        updated.backlog[0]?.milestones[0]?.tasks[0]?.subtasks[0];
      expect(updatedSubtask?.status).toBe('Failed');
    });
  });

  // PATTERN: Obsolete status in delta sessions
  describe('Obsolete Status in Delta Sessions', () => {
    it('should mark removed subtasks as Obsolete', () => {
      // SETUP: Create backlog with subtask to be removed
      const subtask = createTestSubtask(
        'P1.M1.T1.S1',
        'Removed Subtask',
        'Complete'
      );
      const task = createTestTask('P1.M1.T1', 'Test Task', 'Complete', [
        subtask,
      ]);
      const milestone = createTestMilestone(
        'P1.M1',
        'Test Milestone',
        'Complete',
        [task]
      );
      const phase = createTestPhase('P1', 'Test Phase', 'Complete', [
        milestone,
      ]);
      const backlog = createTestBacklog([phase]);

      // SETUP: Create delta analysis for 'removed' type
      const delta: DeltaAnalysis = createDeltaAnalysis(
        [
          {
            itemId: 'P1.M1.T1.S1',
            type: 'removed',
            description: 'Subtask removed in delta session',
            impact: 'Do not execute this subtask',
          },
        ],
        ['P1.M1.T1.S1']
      );

      // EXECUTE: Apply patch
      const patched = patchBacklog(backlog, delta);

      // VERIFY: Subtask status is Obsolete
      const patchedSubtask =
        patched.backlog[0]?.milestones[0]?.tasks[0]?.subtasks[0];
      expect(patchedSubtask?.status).toBe('Obsolete');
    });

    it('should mark removed tasks as Obsolete', () => {
      // SETUP: Create backlog with task to be removed
      const subtask = createTestSubtask(
        'P1.M1.T1.S1',
        'Test Subtask',
        'Complete'
      );
      const task = createTestTask('P1.M1.T1', 'Removed Task', 'Complete', [
        subtask,
      ]);
      const milestone = createTestMilestone(
        'P1.M1',
        'Test Milestone',
        'Complete',
        [task]
      );
      const phase = createTestPhase('P1', 'Test Phase', 'Complete', [
        milestone,
      ]);
      const backlog = createTestBacklog([phase]);

      // SETUP: Create delta analysis for 'removed' type
      const delta: DeltaAnalysis = createDeltaAnalysis(
        [
          {
            itemId: 'P1.M1.T1',
            type: 'removed',
            description: 'Task removed in delta session',
            impact: 'Do not execute this task or subtasks',
          },
        ],
        ['P1.M1.T1']
      );

      // EXECUTE: Apply patch
      const patched = patchBacklog(backlog, delta);

      // VERIFY: Task status is Obsolete
      const patchedTask = patched.backlog[0]?.milestones[0]?.tasks[0];
      expect(patchedTask?.status).toBe('Obsolete');
    });

    it('should mark removed milestones as Obsolete', () => {
      // SETUP: Create backlog with milestone to be removed
      const task = createTestTask('P1.M1.T1', 'Test Task', 'Complete', []);
      const milestone = createTestMilestone(
        'P1.M1',
        'Removed Milestone',
        'Complete',
        [task]
      );
      const phase = createTestPhase('P1', 'Test Phase', 'Complete', [
        milestone,
      ]);
      const backlog = createTestBacklog([phase]);

      // SETUP: Create delta analysis for 'removed' type
      const delta: DeltaAnalysis = createDeltaAnalysis(
        [
          {
            itemId: 'P1.M1',
            type: 'removed',
            description: 'Milestone removed in delta session',
            impact: 'Do not execute this milestone',
          },
        ],
        ['P1.M1']
      );

      // EXECUTE: Apply patch
      const patched = patchBacklog(backlog, delta);

      // VERIFY: Milestone status is Obsolete
      const patchedMilestone = patched.backlog[0]?.milestones[0];
      expect(patchedMilestone?.status).toBe('Obsolete');
    });

    it('should mark removed phases as Obsolete', () => {
      // SETUP: Create backlog with phase to be removed
      const milestone = createTestMilestone(
        'P1.M1',
        'Test Milestone',
        'Complete',
        []
      );
      const phase = createTestPhase('P1', 'Removed Phase', 'Complete', [
        milestone,
      ]);
      const backlog = createTestBacklog([phase]);

      // SETUP: Create delta analysis for 'removed' type
      const delta: DeltaAnalysis = createDeltaAnalysis(
        [
          {
            itemId: 'P1',
            type: 'removed',
            description: 'Phase removed in delta session',
            impact: 'Do not execute this phase',
          },
        ],
        ['P1']
      );

      // EXECUTE: Apply patch
      const patched = patchBacklog(backlog, delta);

      // VERIFY: Phase status is Obsolete
      const patchedPhase = patched.backlog[0];
      expect(patchedPhase?.status).toBe('Obsolete');
    });

    it('should handle multiple removed items in a single patch', () => {
      // SETUP: Create backlog with multiple items to be removed
      const subtask1 = createTestSubtask(
        'P1.M1.T1.S1',
        'Removed Subtask 1',
        'Complete'
      );
      const subtask2 = createTestSubtask(
        'P1.M1.T1.S2',
        'Removed Subtask 2',
        'Complete'
      );
      const subtask3 = createTestSubtask(
        'P1.M1.T1.S3',
        'Kept Subtask',
        'Complete'
      );
      const task = createTestTask('P1.M1.T1', 'Test Task', 'Complete', [
        subtask1,
        subtask2,
        subtask3,
      ]);
      const milestone = createTestMilestone(
        'P1.M1',
        'Test Milestone',
        'Complete',
        [task]
      );
      const phase = createTestPhase('P1', 'Test Phase', 'Complete', [
        milestone,
      ]);
      const backlog = createTestBacklog([phase]);

      // SETUP: Create delta analysis for multiple 'removed' items
      const delta: DeltaAnalysis = createDeltaAnalysis(
        [
          {
            itemId: 'P1.M1.T1.S1',
            type: 'removed',
            description: 'Subtask 1 removed',
            impact: 'Do not execute',
          },
          {
            itemId: 'P1.M1.T1.S2',
            type: 'removed',
            description: 'Subtask 2 removed',
            impact: 'Do not execute',
          },
        ],
        ['P1.M1.T1.S1', 'P1.M1.T1.S2']
      );

      // EXECUTE: Apply patch
      const patched = patchBacklog(backlog, delta);

      // VERIFY: Removed subtasks are Obsolete
      const patchedTask = patched.backlog[0]?.milestones[0]?.tasks[0];
      expect(patchedTask?.subtasks[0]?.status).toBe('Obsolete');
      expect(patchedTask?.subtasks[1]?.status).toBe('Obsolete');

      // VERIFY: Kept subtask is still Complete
      expect(patchedTask?.subtasks[2]?.status).toBe('Complete');
    });
  });

  // PATTERN: Status at all hierarchy levels
  describe('Status at All Hierarchy Levels', () => {
    it('should accept all status values for Subtask', () => {
      const statuses: Status[] = [
        'Planned',
        'Researching',
        'Ready',
        'Implementing',
        'Retrying',
        'Complete',
        'Failed',
        'Obsolete',
      ];

      statuses.forEach(status => {
        const subtask = createTestSubtask('P1.M1.T1.S1', 'Test', status);
        expect(subtask.status).toBe(status);

        // Verify Zod validation
        const result = StatusEnum.safeParse(status);
        expect(result.success).toBe(true);
      });
    });

    it('should accept all status values for Task', () => {
      const statuses: Status[] = [
        'Planned',
        'Researching',
        'Ready',
        'Implementing',
        'Retrying',
        'Complete',
        'Failed',
        'Obsolete',
      ];

      statuses.forEach(status => {
        const task = createTestTask('P1.M1.T1', 'Test', status);
        expect(task.status).toBe(status);
      });
    });

    it('should accept all status values for Milestone', () => {
      const statuses: Status[] = [
        'Planned',
        'Researching',
        'Ready',
        'Implementing',
        'Retrying',
        'Complete',
        'Failed',
        'Obsolete',
      ];

      statuses.forEach(status => {
        const milestone = createTestMilestone('P1.M1', 'Test', status);
        expect(milestone.status).toBe(status);
      });
    });

    it('should accept all status values for Phase', () => {
      const statuses: Status[] = [
        'Planned',
        'Researching',
        'Ready',
        'Implementing',
        'Retrying',
        'Complete',
        'Failed',
        'Obsolete',
      ];

      statuses.forEach(status => {
        const phase = createTestPhase('P1', 'Test', status);
        expect(phase.status).toBe(status);
      });
    });
  });

  // PATTERN: Status immutability tests
  describe('Status Immutability', () => {
    it('should create new object when updating status', () => {
      // SETUP: Create subtask in Planned status
      const subtask = createTestSubtask(
        'P1.M1.T1.S1',
        'Test Subtask',
        'Planned'
      );
      const task = createTestTask('P1.M1.T1', 'Test Task', 'Planned', [
        subtask,
      ]);
      const milestone = createTestMilestone(
        'P1.M1',
        'Test Milestone',
        'Planned',
        [task]
      );
      const phase = createTestPhase('P1', 'Test Phase', 'Planned', [milestone]);
      const backlog = createTestBacklog([phase]);

      // EXECUTE: Update status to Researching
      const updated = updateItemStatus(backlog, subtask.id, 'Researching');

      // VERIFY: New backlog is different object
      expect(updated).not.toBe(backlog);

      // VERIFY: Original backlog is unchanged
      const originalSubtask =
        backlog.backlog[0]?.milestones[0]?.tasks[0]?.subtasks[0];
      expect(originalSubtask?.status).toBe('Planned');
    });

    it('should preserve all other fields when updating status', () => {
      // SETUP: Create subtask with all fields
      const subtask = createTestSubtask(
        'P1.M1.T1.S1',
        'Original Title',
        'Planned',
        ['P1.M1.T1.S0'],
        'Original scope'
      );
      const task = createTestTask('P1.M1.T1', 'Test Task', 'Planned', [
        subtask,
      ]);
      const milestone = createTestMilestone(
        'P1.M1',
        'Test Milestone',
        'Planned',
        [task]
      );
      const phase = createTestPhase('P1', 'Test Phase', 'Planned', [milestone]);
      const backlog = createTestBacklog([phase]);

      // EXECUTE: Update status only
      const updated = updateItemStatus(backlog, subtask.id, 'Researching');

      // VERIFY: Other fields are preserved
      const updatedSubtask =
        updated.backlog[0]?.milestones[0]?.tasks[0]?.subtasks[0];
      expect(updatedSubtask?.id).toBe('P1.M1.T1.S1');
      expect(updatedSubtask?.title).toBe('Original Title');
      expect(updatedSubtask?.story_points).toBe(2);
      expect(updatedSubtask?.dependencies).toEqual(['P1.M1.T1.S0']);
      expect(updatedSubtask?.context_scope).toBe('Original scope');
    });
  });
});
