/**
 * Unit tests for task breakdown JSON schema validation
 *
 * @remarks
 * Tests validate Zod schemas for all task hierarchy types with comprehensive
 * coverage of field constraints, edge cases, and architect agent output validation.
 *
 * Documents discrepancy between system_context.md (story_points: 0.5, 1, 2)
 * and actual implementation (models.ts: 1-21 integers only).
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 * @see {@link ../../../plan/003_b3d3efdaf0ed/docs/system_context.md | System Context}
 * @see {@link ../../../src/core/models.ts | Zod Schema Definitions}
 */

import { describe, expect, it } from 'vitest';
import {
  StatusEnum,
  ItemTypeEnum,
  ContextScopeSchema,
  SubtaskSchema,
  TaskSchema,
  MilestoneSchema,
  PhaseSchema,
  BacklogSchema,
} from '../../../src/core/models.js';
import {
  validMinimalBacklog,
  validFullHierarchy,
  validSubtask,
  validTask,
  validMilestone,
  validPhase,
  invalidIdFormats,
  invalidStoryPoints,
  invalidContextScope,
  invalidStatusValues,
  invalidItemTypeValues,
  invalidDependencies,
  invalidTitles,
  missingRequiredFields,
  architectAgentSamples,
} from '../../fixtures/task-breakdown-samples.js';

// =============================================================================
// TEST SUITE: Task Breakdown Schema Validation
// =============================================================================

describe('Task Breakdown Schema Validation', () => {
  // ==========================================================================
  // TEST GROUP 1: StatusEnum Validation
  // ==========================================================================

  describe('StatusEnum', () => {
    it('should accept all 8 valid status values', () => {
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

      validStatuses.forEach(status => {
        const result = StatusEnum.safeParse(status);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data).toBe(status);
        }
      });
    });

    it('should reject invalid status values', () => {
      invalidStatusValues.forEach(status => {
        const result = StatusEnum.safeParse(status);
        expect(result.success).toBe(false);
      });
    });

    it('should reject wrong types', () => {
      const wrongTypes = [123, true, {}, [], null, undefined];

      wrongTypes.forEach(status => {
        const result = StatusEnum.safeParse(status);
        expect(result.success).toBe(false);
      });
    });
  });

  // ==========================================================================
  // TEST GROUP 2: ItemTypeEnum Validation
  // ==========================================================================

  describe('ItemTypeEnum', () => {
    it('should accept all 4 valid item type values', () => {
      const validTypes = ['Phase', 'Milestone', 'Task', 'Subtask'] as const;

      validTypes.forEach(type => {
        const result = ItemTypeEnum.safeParse(type);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data).toBe(type);
        }
      });
    });

    it('should reject invalid item type values', () => {
      invalidItemTypeValues.forEach(type => {
        const result = ItemTypeEnum.safeParse(type);
        expect(result.success).toBe(false);
      });
    });

    it('should reject wrong types', () => {
      const wrongTypes = [123, true, {}, [], null, undefined];

      wrongTypes.forEach(type => {
        const result = ItemTypeEnum.safeParse(type);
        expect(result.success).toBe(false);
      });
    });
  });

  // ==========================================================================
  // TEST GROUP 3: ContextScopeSchema Validation
  // ==========================================================================

  describe('ContextScopeSchema', () => {
    it('should accept valid CONTRACT DEFINITION format', () => {
      const result = ContextScopeSchema.safeParse(invalidContextScope.valid);
      expect(result.success).toBe(true);
    });

    it('should reject missing CONTRACT DEFINITION prefix', () => {
      const result = ContextScopeSchema.safeParse(
        invalidContextScope.missingPrefix
      );
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('CONTRACT DEFINITION');
      }
    });

    it('should reject sections out of order', () => {
      const result = ContextScopeSchema.safeParse(
        invalidContextScope.sectionsOutOfOrder
      );
      expect(result.success).toBe(false);
    });

    it('should reject missing sections', () => {
      const result = ContextScopeSchema.safeParse(
        invalidContextScope.missingSection
      );
      expect(result.success).toBe(false);
    });

    it('should reject wrong section name (case sensitivity)', () => {
      const result = ContextScopeSchema.safeParse(
        invalidContextScope.wrongSectionName
      );
      expect(result.success).toBe(false);
    });

    it('should reject missing newline after prefix', () => {
      const result = ContextScopeSchema.safeParse(
        invalidContextScope.missingNewlineAfterPrefix
      );
      expect(result.success).toBe(false);
    });

    it('should reject case-sensitive section header errors', () => {
      const result = ContextScopeSchema.safeParse(
        invalidContextScope.caseSensitiveError
      );
      expect(result.success).toBe(false);
    });

    it('should reject non-string values', () => {
      const nonStrings = [123, true, {}, [], null, undefined];

      nonStrings.forEach(value => {
        const result = ContextScopeSchema.safeParse(value);
        expect(result.success).toBe(false);
      });
    });

    it('should reject empty string', () => {
      const result = ContextScopeSchema.safeParse('');
      expect(result.success).toBe(false);
    });
  });

  // ==========================================================================
  // TEST GROUP 4: SubtaskSchema Validation
  // ==========================================================================

  describe('SubtaskSchema', () => {
    describe('valid subtask acceptance', () => {
      it('should accept valid subtask with all fields', () => {
        const result = SubtaskSchema.safeParse(validSubtask);
        expect(result.success).toBe(true);
      });
    });

    describe('ID format validation', () => {
      it('should validate subtask ID format regex', () => {
        const validIds = ['P1.M1.T1.S1', 'P99.M99.T99.S99', 'P01.M01.T01.S01'];

        validIds.forEach(id => {
          const subtask = { ...validSubtask, id };
          const result = SubtaskSchema.safeParse(subtask);
          expect(result.success).toBe(true);
        });
      });

      it('should reject invalid subtask ID formats', () => {
        const invalidSamples = [
          invalidIdFormats.phaseIdAsSubtask,
          invalidIdFormats.missingTaskLevel,
          invalidIdFormats.tooManyLevels,
          invalidIdFormats.lowercase,
          invalidIdFormats.wrongSeparator,
          invalidIdFormats.wordsInsteadOfNumbers,
        ];

        invalidSamples.forEach(sample => {
          const result = SubtaskSchema.safeParse(sample);
          expect(result.success).toBe(false);
        });
      });
    });

    describe('type literal validation', () => {
      it('should require type literal "Subtask"', () => {
        const wrongType = { ...validSubtask, type: 'Task' as const };
        const result = SubtaskSchema.safeParse(wrongType);
        expect(result.success).toBe(false);
      });
    });

    describe('title constraints validation', () => {
      it('should reject empty title string', () => {
        const emptyTitle = { ...validSubtask, title: invalidTitles.empty };
        const result = SubtaskSchema.safeParse(emptyTitle);
        expect(result.success).toBe(false);
      });

      it('should reject title exceeding 200 characters', () => {
        const tooLongTitle = { ...validSubtask, title: invalidTitles.tooLong };
        const result = SubtaskSchema.safeParse(tooLongTitle);
        expect(result.success).toBe(false);
      });

      it('should accept title at boundary (200 characters)', () => {
        const maxLengthTitle = 'a'.repeat(200);
        const subtask = { ...validSubtask, title: maxLengthTitle };
        const result = SubtaskSchema.safeParse(subtask);
        expect(result.success).toBe(true);
      });
    });

    describe('status enum validation', () => {
      it('should accept valid status values', () => {
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

        validStatuses.forEach(status => {
          const subtask = { ...validSubtask, status };
          const result = SubtaskSchema.safeParse(subtask);
          expect(result.success).toBe(true);
        });
      });

      it('should reject invalid status values', () => {
        const invalidStatus = { ...validSubtask, status: 'Pending' as const };
        const result = SubtaskSchema.safeParse(invalidStatus);
        expect(result.success).toBe(false);
      });
    });

    describe('story_points validation', () => {
      it('should accept valid story points (1-21 integers)', () => {
        invalidStoryPoints.validBoundaryValues.forEach(sample => {
          const result = SubtaskSchema.safeParse(sample);
          expect(result.success).toBe(true);
        });
      });

      it('should reject story_points below minimum (0)', () => {
        const result = SubtaskSchema.safeParse(invalidStoryPoints.belowMinimum);
        expect(result.success).toBe(false);
      });

      it('should reject story_points above maximum (22)', () => {
        const result = SubtaskSchema.safeParse(invalidStoryPoints.aboveMaximum);
        expect(result.success).toBe(false);
      });

      it('should reject non-0.5-multiple story_points', () => {
        // CRITICAL: system_context.md says 0.5 is valid, and the schema now
        // accepts 0.5-multiple values (0.5, 1, 1.5, 2, …). Values that are
        // not multiples of 0.5 are rejected.
        const result = SubtaskSchema.safeParse(invalidStoryPoints.decimalValue);
        expect(result.success).toBe(false);
        if (!result.success) {
          // .multipleOf(0.5) refinement rejects non-multiples
          expect(
            result.error.issues.some(i => i.message.includes('increments'))
          ).toBe(true);
        }
      });

      it('should accept half-point story_points (0.5)', () => {
        const subtask = { ...validSubtask, story_points: 0.5 };
        const result = SubtaskSchema.safeParse(subtask);
        expect(result.success).toBe(true);
      });

      it('should reject negative story_points', () => {
        const result = SubtaskSchema.safeParse(
          invalidStoryPoints.negativeValue
        );
        expect(result.success).toBe(false);
      });

      it('should reject non-numeric story_points', () => {
        const result = SubtaskSchema.safeParse(invalidStoryPoints.nonNumeric);
        expect(result.success).toBe(false);
      });
    });

    describe('dependencies array validation', () => {
      it('should accept empty dependencies array', () => {
        const result = SubtaskSchema.safeParse(validSubtask);
        expect(result.success).toBe(true);
      });

      it('should accept valid subtask ID dependencies', () => {
        const withDeps = {
          ...validSubtask,
          dependencies: ['P1.M1.T1.S1', 'P1.M1.T1.S2'],
        };
        const result = SubtaskSchema.safeParse(withDeps);
        expect(result.success).toBe(true);
      });

      it('should accept any string in dependencies array (schema does not validate ID format)', () => {
        // CRITICAL: Schema is z.array(z.string()).min(0) - does not validate subtask ID format
        // This test documents that schema accepts any string
        const anyStrings = {
          ...validSubtask,
          dependencies: ['invalid-id-format', 'random-string', 'P2.M3.T4.S5'],
        };
        const result = SubtaskSchema.safeParse(anyStrings);
        expect(result.success).toBe(true);
      });

      it('should reject non-array dependencies', () => {
        const result = SubtaskSchema.safeParse(invalidDependencies.nonArray);
        expect(result.success).toBe(false);
      });

      it('should reject non-string elements in dependencies array', () => {
        const result = SubtaskSchema.safeParse(
          invalidDependencies.nonStringElements
        );
        expect(result.success).toBe(false);
      });
    });

    describe('context_scope validation', () => {
      it('should validate context_scope format', () => {
        const result = SubtaskSchema.safeParse(validSubtask);
        expect(result.success).toBe(true);
      });

      it('should reject invalid context_scope format', () => {
        const invalidScope = {
          ...validSubtask,
          context_scope: 'Invalid context scope',
        };
        const result = SubtaskSchema.safeParse(invalidScope);
        expect(result.success).toBe(false);
      });
    });

    describe('missing required fields', () => {
      it('should reject subtask missing required fields', () => {
        const result = SubtaskSchema.safeParse(missingRequiredFields.subtask);
        expect(result.success).toBe(false);
      });
    });

    describe('invalid field types', () => {
      it('should reject wrong field types', () => {
        const wrongTypes = [
          { ...validSubtask, id: 123 as unknown as string },
          { ...validSubtask, title: true as unknown as string },
          { ...validSubtask, status: 123 as unknown as 'Planned' },
          { ...validSubtask, story_points: 'two' as unknown as number },
        ];

        wrongTypes.forEach(sample => {
          const result = SubtaskSchema.safeParse(sample);
          expect(result.success).toBe(false);
        });
      });
    });
  });

  // ==========================================================================
  // TEST GROUP 5: TaskSchema Validation
  // ==========================================================================

  describe('TaskSchema', () => {
    describe('valid task acceptance', () => {
      it('should accept valid task with all fields', () => {
        const result = TaskSchema.safeParse(validTask);
        expect(result.success).toBe(true);
      });

      it('should accept task with valid subtasks', () => {
        const taskWithSubtasks = {
          ...validTask,
          subtasks: [validSubtask],
        };
        const result = TaskSchema.safeParse(taskWithSubtasks);
        expect(result.success).toBe(true);
      });
    });

    describe('ID format validation', () => {
      it('should validate task ID format regex', () => {
        const validIds = ['P1.M1.T1', 'P99.M99.T99', 'P01.M01.T01'];

        validIds.forEach(id => {
          const task = { ...validTask, id };
          const result = TaskSchema.safeParse(task);
          expect(result.success).toBe(true);
        });
      });

      it('should reject invalid task ID formats', () => {
        const invalidIds = ['P1', 'P1.M1', 'P1.M1.T1.S1', 'p1.m1.t1'];

        invalidIds.forEach(id => {
          const task = { ...validTask, id };
          const result = TaskSchema.safeParse(task);
          expect(result.success).toBe(false);
        });
      });
    });

    describe('type literal validation', () => {
      it('should require type literal "Task"', () => {
        const wrongType = { ...validTask, type: 'Subtask' as const };
        const result = TaskSchema.safeParse(wrongType);
        expect(result.success).toBe(false);
      });
    });

    describe('title constraints validation', () => {
      it('should reject empty title', () => {
        const emptyTitle = { ...validTask, title: '' };
        const result = TaskSchema.safeParse(emptyTitle);
        expect(result.success).toBe(false);
      });

      it('should reject title exceeding 200 characters', () => {
        const tooLongTitle = { ...validTask, title: 'a'.repeat(201) };
        const result = TaskSchema.safeParse(tooLongTitle);
        expect(result.success).toBe(false);
      });
    });

    describe('status enum validation', () => {
      it('should accept valid status values', () => {
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

        validStatuses.forEach(status => {
          const task = { ...validTask, status };
          const result = TaskSchema.safeParse(task);
          expect(result.success).toBe(true);
        });
      });
    });

    describe('description requirement', () => {
      it('should require non-empty description', () => {
        const noDescription = { ...validTask, description: '' };
        const result = TaskSchema.safeParse(noDescription);
        expect(result.success).toBe(false);
      });

      it('should reject missing description field', () => {
        const { description, ...taskWithoutDescription } = validTask;
        const result = TaskSchema.safeParse(taskWithoutDescription);
        expect(result.success).toBe(false);
      });
    });

    describe('subtasks array validation', () => {
      it('should accept empty subtasks array', () => {
        const result = TaskSchema.safeParse(validTask);
        expect(result.success).toBe(true);
      });

      it('should accept valid subtasks', () => {
        const taskWithSubtasks = {
          ...validTask,
          subtasks: [validSubtask],
        };
        const result = TaskSchema.safeParse(taskWithSubtasks);
        expect(result.success).toBe(true);
      });

      it('should reject tasks with invalid subtasks', () => {
        const taskWithInvalidSubtask = {
          ...validTask,
          subtasks: [missingRequiredFields.subtask],
        };
        const result = TaskSchema.safeParse(taskWithInvalidSubtask);
        expect(result.success).toBe(false);
      });

      it('should reject non-array subtasks', () => {
        const nonArray = {
          ...validTask,
          subtasks: 'invalid' as unknown as typeof validTask.subtasks,
        };
        const result = TaskSchema.safeParse(nonArray);
        expect(result.success).toBe(false);
      });
    });

    describe('missing required fields', () => {
      it('should reject task missing required fields', () => {
        const result = TaskSchema.safeParse(missingRequiredFields.task);
        expect(result.success).toBe(false);
      });
    });
  });

  // ==========================================================================
  // TEST GROUP 6: MilestoneSchema Validation
  // ==========================================================================

  describe('MilestoneSchema', () => {
    describe('valid milestone acceptance', () => {
      it('should accept valid milestone with all fields', () => {
        const result = MilestoneSchema.safeParse(validMilestone);
        expect(result.success).toBe(true);
      });

      it('should accept milestone with valid tasks', () => {
        const milestoneWithTasks = {
          ...validMilestone,
          tasks: [validTask],
        };
        const result = MilestoneSchema.safeParse(milestoneWithTasks);
        expect(result.success).toBe(true);
      });
    });

    describe('ID format validation', () => {
      it('should validate milestone ID format regex', () => {
        const validIds = ['P1.M1', 'P99.M99', 'P01.M01'];

        validIds.forEach(id => {
          const milestone = { ...validMilestone, id };
          const result = MilestoneSchema.safeParse(milestone);
          expect(result.success).toBe(true);
        });
      });

      it('should reject invalid milestone ID formats', () => {
        const invalidIds = ['P1', 'P1.M1.T1', 'p1.m1', 'P1_M1'];

        invalidIds.forEach(id => {
          const milestone = { ...validMilestone, id };
          const result = MilestoneSchema.safeParse(milestone);
          expect(result.success).toBe(false);
        });
      });
    });

    describe('type literal validation', () => {
      it('should require type literal "Milestone"', () => {
        const wrongType = { ...validMilestone, type: 'Phase' as const };
        const result = MilestoneSchema.safeParse(wrongType);
        expect(result.success).toBe(false);
      });
    });

    describe('title and status validation', () => {
      it('should reject empty title', () => {
        const emptyTitle = { ...validMilestone, title: '' };
        const result = MilestoneSchema.safeParse(emptyTitle);
        expect(result.success).toBe(false);
      });

      it('should accept valid status values', () => {
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

        validStatuses.forEach(status => {
          const milestone = { ...validMilestone, status };
          const result = MilestoneSchema.safeParse(milestone);
          expect(result.success).toBe(true);
        });
      });
    });

    describe('description requirement', () => {
      it('should require non-empty description', () => {
        const noDescription = { ...validMilestone, description: '' };
        const result = MilestoneSchema.safeParse(noDescription);
        expect(result.success).toBe(false);
      });
    });

    describe('tasks array validation with z.lazy() recursion', () => {
      it('should accept empty tasks array', () => {
        const result = MilestoneSchema.safeParse(validMilestone);
        expect(result.success).toBe(true);
      });

      it('should accept valid tasks with recursive validation', () => {
        const milestoneWithTasks = {
          ...validMilestone,
          tasks: [
            {
              ...validTask,
              subtasks: [validSubtask],
            },
          ],
        };
        const result = MilestoneSchema.safeParse(milestoneWithTasks);
        expect(result.success).toBe(true);
      });

      it('should reject milestones with invalid tasks', () => {
        const milestoneWithInvalidTask = {
          ...validMilestone,
          tasks: [missingRequiredFields.task],
        };
        const result = MilestoneSchema.safeParse(milestoneWithInvalidTask);
        expect(result.success).toBe(false);
      });

      it('should test deeply nested task structures', () => {
        const deeplyNested = {
          ...validMilestone,
          tasks: [
            {
              ...validTask,
              subtasks: [
                validSubtask,
                {
                  ...validSubtask,
                  id: 'P1.M1.T1.S2',
                  dependencies: ['P1.M1.T1.S1'],
                },
              ],
            },
          ],
        };
        const result = MilestoneSchema.safeParse(deeplyNested);
        expect(result.success).toBe(true);
      });
    });

    describe('missing required fields', () => {
      it('should reject milestone missing required fields', () => {
        const result = MilestoneSchema.safeParse(
          missingRequiredFields.milestone
        );
        expect(result.success).toBe(false);
      });
    });
  });

  // ==========================================================================
  // TEST GROUP 7: PhaseSchema Validation
  // ==========================================================================

  describe('PhaseSchema', () => {
    describe('valid phase acceptance', () => {
      it('should accept valid phase with all fields', () => {
        const result = PhaseSchema.safeParse(validPhase);
        expect(result.success).toBe(true);
      });

      it('should accept phase with valid milestones', () => {
        const phaseWithMilestones = {
          ...validPhase,
          milestones: [validMilestone],
        };
        const result = PhaseSchema.safeParse(phaseWithMilestones);
        expect(result.success).toBe(true);
      });
    });

    describe('ID format validation', () => {
      it('should validate phase ID format regex', () => {
        const validIds = ['P1', 'P99', 'P01'];

        validIds.forEach(id => {
          const phase = { ...validPhase, id };
          const result = PhaseSchema.safeParse(phase);
          expect(result.success).toBe(true);
        });
      });

      it('should reject invalid phase ID formats', () => {
        const invalidIds = ['P1.M1', 'Phase1', 'p1', 'P_1'];

        invalidIds.forEach(id => {
          const phase = { ...validPhase, id };
          const result = PhaseSchema.safeParse(phase);
          expect(result.success).toBe(false);
        });
      });
    });

    describe('type literal validation', () => {
      it('should require type literal "Phase"', () => {
        const wrongType = { ...validPhase, type: 'Milestone' as const };
        const result = PhaseSchema.safeParse(wrongType);
        expect(result.success).toBe(false);
      });
    });

    describe('title and status validation', () => {
      it('should reject empty title', () => {
        const emptyTitle = { ...validPhase, title: '' };
        const result = PhaseSchema.safeParse(emptyTitle);
        expect(result.success).toBe(false);
      });

      it('should accept valid status values', () => {
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

        validStatuses.forEach(status => {
          const phase = { ...validPhase, status };
          const result = PhaseSchema.safeParse(phase);
          expect(result.success).toBe(true);
        });
      });
    });

    describe('description requirement', () => {
      it('should require non-empty description', () => {
        const noDescription = { ...validPhase, description: '' };
        const result = PhaseSchema.safeParse(noDescription);
        expect(result.success).toBe(false);
      });
    });

    describe('milestones array validation with z.lazy() recursion', () => {
      it('should accept empty milestones array', () => {
        const result = PhaseSchema.safeParse(validPhase);
        expect(result.success).toBe(true);
      });

      it('should accept valid milestones with recursive validation', () => {
        const phaseWithMilestones = {
          ...validPhase,
          milestones: [
            {
              ...validMilestone,
              tasks: [
                {
                  ...validTask,
                  subtasks: [validSubtask],
                },
              ],
            },
          ],
        };
        const result = PhaseSchema.safeParse(phaseWithMilestones);
        expect(result.success).toBe(true);
      });

      it('should test 4-level hierarchy validation', () => {
        const fullHierarchy = validFullHierarchy.backlog[0];
        const result = PhaseSchema.safeParse(fullHierarchy);
        expect(result.success).toBe(true);
      });

      it('should reject phases with invalid milestones', () => {
        const phaseWithInvalidMilestone = {
          ...validPhase,
          milestones: [missingRequiredFields.milestone],
        };
        const result = PhaseSchema.safeParse(phaseWithInvalidMilestone);
        expect(result.success).toBe(false);
      });
    });

    describe('missing required fields', () => {
      it('should reject phase missing required fields', () => {
        const result = PhaseSchema.safeParse(missingRequiredFields.phase);
        expect(result.success).toBe(false);
      });
    });
  });

  // ==========================================================================
  // TEST GROUP 8: BacklogSchema Validation (Root Schema)
  // ==========================================================================

  describe('BacklogSchema', () => {
    describe('valid backlog acceptance', () => {
      it('should accept valid backlog with phase array', () => {
        const result = BacklogSchema.safeParse(validMinimalBacklog);
        expect(result.success).toBe(true);
      });

      it('should accept complete 4-level hierarchy', () => {
        const result = BacklogSchema.safeParse(validFullHierarchy);
        expect(result.success).toBe(true);
      });

      it('should accept multiple phases', () => {
        const multiplePhases = {
          backlog: [validPhase, { ...validPhase, id: 'P2' }],
        };
        const result = BacklogSchema.safeParse(multiplePhases);
        expect(result.success).toBe(true);
      });

      it('should accept empty phase array', () => {
        const emptyBacklog = { backlog: [] };
        const result = BacklogSchema.safeParse(emptyBacklog);
        expect(result.success).toBe(true);
      });
    });

    describe('backlog wrapper structure validation', () => {
      it('should reject non-array backlog value', () => {
        const nonArray = {
          backlog: 'invalid' as unknown as typeof validMinimalBacklog.backlog,
        };
        const result = BacklogSchema.safeParse(nonArray);
        expect(result.success).toBe(false);
      });

      it('should reject backlog with invalid phases', () => {
        const invalidPhases = {
          backlog: [missingRequiredFields.phase],
        };
        const result = BacklogSchema.safeParse(invalidPhases);
        expect(result.success).toBe(false);
      });

      it('should reject missing backlog field', () => {
        const result = BacklogSchema.safeParse({});
        expect(result.success).toBe(false);
      });
    });
  });

  // ==========================================================================
  // TEST GROUP 9: Architect Agent Output Validation
  // ==========================================================================

  describe('Architect Agent Output Validation', () => {
    it('should validate valid architect agent output', () => {
      const result = BacklogSchema.safeParse(architectAgentSamples.validOutput);
      expect(result.success).toBe(true);
    });

    it('should reject malformed architect output', () => {
      const result = BacklogSchema.safeParse(
        architectAgentSamples.malformedOutput
      );
      expect(result.success).toBe(false);
    });

    it('should reject architect output with invalid story_points', () => {
      const result = BacklogSchema.safeParse(
        architectAgentSamples.invalidStoryPointsOutput
      );
      expect(result.success).toBe(false);
    });

    it('should validate complete architect agent hierarchy structure', () => {
      const result = BacklogSchema.safeParse(validFullHierarchy);
      expect(result.success).toBe(true);

      if (result.success) {
        // Verify all ID formats in hierarchy
        for (const phase of result.data.backlog) {
          expect(phase.id).toMatch(/^P\d+$/);
          expect(phase.type).toBe('Phase');

          for (const milestone of phase.milestones) {
            expect(milestone.id).toMatch(/^P\d+\.M\d+$/);
            expect(milestone.type).toBe('Milestone');

            for (const task of milestone.tasks) {
              expect(task.id).toMatch(/^P\d+\.M\d+\.T\d+$/);
              expect(task.type).toBe('Task');

              for (const subtask of task.subtasks) {
                expect(subtask.id).toMatch(/^P\d+\.M\d+\.T\d+\.S\d+$/);
                expect(subtask.type).toBe('Subtask');
              }
            }
          }
        }
      }
    });

    it('should validate story_points are 0.5-multiples in range 0.5-21 in architect output', () => {
      const result = BacklogSchema.safeParse(validFullHierarchy);
      expect(result.success).toBe(true);

      if (result.success) {
        for (const phase of result.data.backlog) {
          for (const milestone of phase.milestones) {
            for (const task of milestone.tasks) {
              for (const subtask of task.subtasks) {
                expect(subtask.story_points % 0.5).toBe(0);
                expect(subtask.story_points).toBeGreaterThanOrEqual(0.5);
                expect(subtask.story_points).toBeLessThanOrEqual(21);
              }
            }
          }
        }
      }
    });

    it('should validate context_scope format in architect output', () => {
      const result = BacklogSchema.safeParse(validFullHierarchy);
      expect(result.success).toBe(true);

      if (result.success) {
        for (const phase of result.data.backlog) {
          for (const milestone of phase.milestones) {
            for (const task of milestone.tasks) {
              for (const subtask of task.subtasks) {
                expect(subtask.context_scope).toContain('CONTRACT DEFINITION:');
                expect(subtask.context_scope).toContain('1. RESEARCH NOTE:');
                expect(subtask.context_scope).toContain('2. INPUT:');
                expect(subtask.context_scope).toContain('3. LOGIC:');
                expect(subtask.context_scope).toContain('4. OUTPUT:');
              }
            }
          }
        }
      }
    });

    it('should validate error messages for invalid architect output', () => {
      const result = BacklogSchema.safeParse(
        architectAgentSamples.malformedOutput
      );
      expect(result.success).toBe(false);

      if (!result.success) {
        // Verify error messages are present and meaningful
        expect(result.error.issues.length).toBeGreaterThan(0);
        expect(result.error.issues[0].message).toBeTruthy();
      }
    });
  });

  // ==========================================================================
  // TEST GROUP 10: Edge Cases and Boundary Values
  // ==========================================================================

  describe('Edge Cases and Boundary Values', () => {
    describe('story_points boundary values', () => {
      it('should accept story_points = 0.5 (half-point minimum)', () => {
        const subtask = { ...validSubtask, story_points: 0.5 };
        const result = SubtaskSchema.safeParse(subtask);
        expect(result.success).toBe(true);
      });

      it('should accept story_points = 1 (minimum integer)', () => {
        const subtask = { ...validSubtask, story_points: 1 };
        const result = SubtaskSchema.safeParse(subtask);
        expect(result.success).toBe(true);
      });

      it('should accept story_points = 21 (maximum)', () => {
        const subtask = { ...validSubtask, story_points: 21 };
        const result = SubtaskSchema.safeParse(subtask);
        expect(result.success).toBe(true);
      });

      it('should accept all Fibonacci values in range', () => {
        const fibonacciValues = [1, 2, 3, 5, 8, 13, 21];

        fibonacciValues.forEach(sp => {
          const subtask = { ...validSubtask, story_points: sp };
          const result = SubtaskSchema.safeParse(subtask);
          expect(result.success).toBe(true);
        });
      });
    });

    describe('title boundary values', () => {
      it('should accept 1 character title', () => {
        const subtask = { ...validSubtask, title: 'a' };
        const result = SubtaskSchema.safeParse(subtask);
        expect(result.success).toBe(true);
      });

      it('should accept 200 character title', () => {
        const subtask = { ...validSubtask, title: 'a'.repeat(200) };
        const result = SubtaskSchema.safeParse(subtask);
        expect(result.success).toBe(true);
      });
    });

    describe('ID format edge cases', () => {
      it('should accept single digit IDs', () => {
        const subtask = { ...validSubtask, id: 'P1.M1.T1.S1' };
        const result = SubtaskSchema.safeParse(subtask);
        expect(result.success).toBe(true);
      });

      it('should accept large number IDs', () => {
        const subtask = { ...validSubtask, id: 'P999.M999.T999.S999' };
        const result = SubtaskSchema.safeParse(subtask);
        expect(result.success).toBe(true);
      });

      it('should accept zero-padded IDs', () => {
        const subtask = { ...validSubtask, id: 'P01.M01.T01.S01' };
        const result = SubtaskSchema.safeParse(subtask);
        expect(result.success).toBe(true);
      });
    });

    describe('dependencies array edge cases', () => {
      it('should accept single dependency', () => {
        const subtask = { ...validSubtask, dependencies: ['P1.M1.T1.S1'] };
        const result = SubtaskSchema.safeParse(subtask);
        expect(result.success).toBe(true);
      });

      it('should accept multiple dependencies', () => {
        const subtask = {
          ...validSubtask,
          dependencies: ['P1.M1.T1.S1', 'P1.M1.T1.S2', 'P1.M1.T1.S3'],
        };
        const result = SubtaskSchema.safeParse(subtask);
        expect(result.success).toBe(true);
      });
    });

    describe('deeply nested structures', () => {
      it('should validate deep nesting with multiple levels', () => {
        const deepHierarchy = {
          backlog: [
            {
              ...validPhase,
              milestones: [
                {
                  ...validMilestone,
                  tasks: [
                    {
                      ...validTask,
                      subtasks: [
                        validSubtask,
                        { ...validSubtask, id: 'P1.M1.T1.S2' },
                        { ...validSubtask, id: 'P1.M1.T1.S3' },
                      ],
                    },
                    {
                      ...validTask,
                      id: 'P1.M1.T2',
                      subtasks: [{ ...validSubtask, id: 'P1.M1.T2.S1' }],
                    },
                  ],
                },
                {
                  ...validMilestone,
                  id: 'P1.M2',
                  tasks: [
                    {
                      ...validTask,
                      id: 'P1.M2.T1',
                      subtasks: [{ ...validSubtask, id: 'P1.M2.T1.S1' }],
                    },
                  ],
                },
              ],
            },
          ],
        };
        const result = BacklogSchema.safeParse(deepHierarchy);
        expect(result.success).toBe(true);
      });
    });
  });
});
