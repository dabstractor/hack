/**
 * Test fixtures for task breakdown JSON schema validation
 *
 * @remarks
 * Provides valid and invalid JSON samples for testing Zod schema validation
 * of the task hierarchy. These fixtures are used by
 * tests/unit/core/task-breakdown-schema.test.ts to verify schema enforcement.
 *
 * @see {@link ../unit/core/task-breakdown-schema.test.ts | Schema validation tests}
 */

/**
 * Minimal valid backlog with one phase
 *
 * @remarks
 * Contains a single phase with a minimal valid structure.
 * Used for testing BacklogSchema accepts valid input.
 */
export const validMinimalBacklog = {
  backlog: [
    {
      id: 'P1',
      type: 'Phase' as const,
      title: 'Phase 1',
      status: 'Planned' as const,
      description: 'Test phase',
      milestones: [],
    },
  ],
};

/**
 * Complete 4-level hierarchy (Phase -> Milestone -> Task -> Subtask)
 *
 * @remarks
 * Contains a fully populated task hierarchy with all levels.
 * Used for testing complete BacklogSchema validation.
 */
export const validFullHierarchy = {
  backlog: [
    {
      id: 'P1',
      type: 'Phase' as const,
      title: 'Phase 1: Foundation',
      status: 'Planned' as const,
      description: 'Project initialization and setup',
      milestones: [
        {
          id: 'P1.M1',
          type: 'Milestone' as const,
          title: 'Milestone 1.1: Environment Setup',
          status: 'Planned' as const,
          description: 'Setup development environment',
          tasks: [
            {
              id: 'P1.M1.T1',
              type: 'Task' as const,
              title: 'Task 1.1.1: Initialize Project',
              status: 'Planned' as const,
              description: 'Initialize the project structure and dependencies',
              subtasks: [
                {
                  id: 'P1.M1.T1.S1',
                  type: 'Subtask' as const,
                  title: 'Subtask 1.1.1.1: Create package.json',
                  status: 'Planned' as const,
                  story_points: 2,
                  dependencies: [],
                  context_scope: `CONTRACT DEFINITION:
1. RESEARCH NOTE: Basic research findings for package.json setup.
2. INPUT: None required.
3. LOGIC: Initialize package.json with proper dependencies and scripts.
4. OUTPUT: Valid package.json file for consumption by build tools.`,
                },
                {
                  id: 'P1.M1.T1.S2',
                  type: 'Subtask' as const,
                  title: 'Subtask 1.1.1.2: Configure TypeScript',
                  status: 'Planned' as const,
                  story_points: 3,
                  dependencies: ['P1.M1.T1.S1'],
                  context_scope: `CONTRACT DEFINITION:
1. RESEARCH NOTE: TypeScript configuration requirements from S1.
2. INPUT: package.json from S1.
3. LOGIC: Create tsconfig.json with compiler options.
4. OUTPUT: Valid tsconfig.json for TypeScript compilation.`,
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

/**
 * Valid subtask with all required fields
 *
 * @remarks
 * Minimal valid subtask object. Used for SubtaskSchema validation tests.
 */
export const validSubtask = {
  id: 'P1.M1.T1.S1',
  type: 'Subtask' as const,
  title: 'Valid subtask',
  status: 'Planned' as const,
  story_points: 2,
  dependencies: [],
  context_scope: `CONTRACT DEFINITION:
1. RESEARCH NOTE: Test research.
2. INPUT: None.
3. LOGIC: Test logic.
4. OUTPUT: Test output.`,
};

/**
 * Valid task with all required fields
 *
 * @remarks
 * Minimal valid task object with empty subtasks array.
 * Used for TaskSchema validation tests.
 */
export const validTask = {
  id: 'P1.M1.T1',
  type: 'Task' as const,
  title: 'Valid task',
  status: 'Planned' as const,
  description: 'Test task description',
  subtasks: [],
};

/**
 * Valid milestone with all required fields
 *
 * @remarks
 * Minimal valid milestone object with empty tasks array.
 * Used for MilestoneSchema validation tests.
 */
export const validMilestone = {
  id: 'P1.M1',
  type: 'Milestone' as const,
  title: 'Valid milestone',
  status: 'Planned' as const,
  description: 'Test milestone description',
  tasks: [],
};

/**
 * Valid phase with all required fields
 *
 * @remarks
 * Minimal valid phase object with empty milestones array.
 * Used for PhaseSchema validation tests.
 */
export const validPhase = {
  id: 'P1',
  type: 'Phase' as const,
  title: 'Valid phase',
  status: 'Planned' as const,
  description: 'Test phase description',
  milestones: [],
};

// ============================================================================
// INVALID SAMPLES - For rejection testing
// ============================================================================

/**
 * Objects with malformed IDs for testing ID format validation
 *
 * @remarks
 * Each object has an ID that fails the regex validation for its type.
 */
export const invalidIdFormats = {
  // Wrong level IDs
  phaseIdAsSubtask: {
    ...validSubtask,
    id: 'P1', // Phase format, not subtask
  },
  missingTaskLevel: {
    ...validSubtask,
    id: 'P1.M1.S1', // Missing task level
  },
  tooManyLevels: {
    ...validSubtask,
    id: 'P1.M1.T1.S1.X1', // Extra level
  },
  lowercase: {
    ...validSubtask,
    id: 'p1.m1.t1.s1', // Lowercase letters
  },
  wrongSeparator: {
    ...validSubtask,
    id: 'P1_M1_T1_S1', // Underscore instead of dot
  },
  wordsInsteadOfNumbers: {
    ...validSubtask,
    id: 'Phase1.Milestone1.Task1.Subtask1', // Words instead of numbers
  },
};

/**
 * Various story_points values for testing range validation
 *
 * @remarks
 * Tests boundary values, decimals, and invalid types.
 * Documents the discrepancy: system_context.md says 0.5, 1, 2 (max 2)
 * but models.ts enforces 1-21 integers (rejects 0.5).
 */
export const invalidStoryPoints = {
  belowMinimum: {
    ...validSubtask,
    story_points: 0, // Below minimum of 1
  },
  decimalValue: {
    ...validSubtask,
    story_points: 0.7, // Non-0.5-multiple decimal - rejected by .multipleOf(0.5)
  },
  aboveMaximum: {
    ...validSubtask,
    story_points: 22, // Above maximum of 21
  },
  negativeValue: {
    ...validSubtask,
    story_points: -1, // Negative
  },
  nonNumeric: {
    ...validSubtask,
    story_points: 'two' as unknown as number, // String instead of number
  },
  validBoundaryValues: [
    { ...validSubtask, story_points: 0.5 }, // Half-point minimum
    { ...validSubtask, story_points: 1 }, // Minimum integer
    { ...validSubtask, story_points: 21 }, // Maximum valid
    { ...validSubtask, story_points: 2 }, // Fibonacci
    { ...validSubtask, story_points: 3 }, // Fibonacci
    { ...validSubtask, story_points: 5 }, // Fibonacci
    { ...validSubtask, story_points: 8 }, // Fibonacci
    { ...validSubtask, story_points: 13 }, // Fibonacci
  ],
};

/**
 * Malformed CONTRACT DEFINITION strings for testing context_scope validation
 *
 * @remarks
 * Tests various ways the CONTRACT DEFINITION format can be invalid.
 */
export const invalidContextScope = {
  missingPrefix: `1. RESEARCH NOTE: Research
2. INPUT: Data
3. LOGIC: Logic
4. OUTPUT: Output`,
  sectionsOutOfOrder: `CONTRACT DEFINITION:
2. INPUT: Data
1. RESEARCH NOTE: Research
3. LOGIC: Logic
4. OUTPUT: Output`,
  missingSection: `CONTRACT DEFINITION:
1. RESEARCH NOTE: Research
2. INPUT: Data
3. LOGIC: Logic`,
  wrongSectionName: `CONTRACT DEFINITION:
1. RESEARCH: Research
2. INPUT: Data
3. LOGIC: Logic
4. OUTPUT: Output`,
  missingNewlineAfterPrefix: `CONTRACT DEFINITION:1. RESEARCH NOTE: Research
2. INPUT: Data
3. LOGIC: Logic
4. OUTPUT: Output`,
  caseSensitiveError: `CONTRACT DEFINITION:
1. research note: Research
2. INPUT: Data
3. LOGIC: Logic
4. OUTPUT: Output`,
  valid: `CONTRACT DEFINITION:
1. RESEARCH NOTE: Valid research findings.
2. INPUT: Data from dependencies.
3. LOGIC: Implementation logic.
4. OUTPUT: Output for next subtask.`,
};

/**
 * Wrong status values for testing StatusEnum validation
 *
 * @remarks
 * Tests that invalid status strings are rejected.
 */
export const invalidStatusValues = [
  'Pending',
  'InProgress',
  'In Progress',
  'Done',
  'Completed',
  '',
  null,
  undefined,
];

/**
 * Wrong item type values for testing ItemTypeEnum validation
 *
 * @remarks
 * Tests that invalid type strings are rejected.
 */
export const invalidItemTypeValues = [
  'phase',
  'milestone',
  'task',
  'subtask',
  'Item',
  'Step',
];

/**
 * Invalid dependency array values
 *
 * @remarks
 * Tests that dependencies must be an array of strings.
 */
export const invalidDependencies = {
  nonArray: 'P1.M1.T1.S1' as unknown as string[], // String instead of array
  nonStringElements: [123, true, null] as unknown as string[], // Non-string elements
};

/**
 * Invalid title values for testing title constraints
 *
 * @remarks
 * Tests min(1) and max(200) character constraints.
 */
export const invalidTitles = {
  empty: '', // Empty string
  tooLong: 'a'.repeat(201), // Exceeds 200 characters
};

/**
 * Objects with missing required fields
 *
 * @remarks
 * Tests that each schema requires all specified fields.
 */
export const missingRequiredFields = {
  subtask: {
    id: 'P1.M1.T1.S1',
    type: 'Subtask' as const,
    // Missing: title, status, story_points, dependencies, context_scope
  },
  task: {
    id: 'P1.M1.T1',
    type: 'Task' as const,
    // Missing: title, status, description, subtasks
  },
  milestone: {
    id: 'P1.M1',
    type: 'Milestone' as const,
    // Missing: title, status, description, tasks
  },
  phase: {
    id: 'P1',
    type: 'Phase' as const,
    // Missing: title, status, description, milestones
  },
};

/**
 * Architect agent output samples
 *
 * @remarks
 * Simulates real architect agent output for integration testing.
 */
export const architectAgentSamples = {
  validOutput: validFullHierarchy,
  malformedOutput: {
    backlog: [
      {
        id: 'P1',
        type: 'Phase',
        // Missing: title, status, description, milestones
      },
    ],
  },
  invalidStoryPointsOutput: {
    backlog: [
      {
        id: 'P1',
        type: 'Phase' as const,
        title: 'Phase 1',
        status: 'Planned' as const,
        description: 'Test phase',
        milestones: [
          {
            id: 'P1.M1',
            type: 'Milestone' as const,
            title: 'Milestone 1',
            status: 'Planned' as const,
            description: 'Test milestone',
            tasks: [
              {
                id: 'P1.M1.T1',
                type: 'Task' as const,
                title: 'Task 1',
                status: 'Planned' as const,
                description: 'Test task',
                subtasks: [
                  {
                    id: 'P1.M1.T1.S1',
                    type: 'Subtask' as const,
                    title: 'Subtask 1',
                    status: 'Planned' as const,
                    story_points: 0.7, // Invalid: non-0.5-multiple decimal
                    dependencies: [],
                    context_scope: `CONTRACT DEFINITION:
1. RESEARCH NOTE: Test
2. INPUT: None
3. LOGIC: Test
4. OUTPUT: Test`,
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
};
