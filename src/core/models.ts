/**
 * Type definitions for task hierarchy models
 *
 * @module core/models
 *
 * @remarks
 * Defines the four-level task hierarchy used throughout the PRP Pipeline:
 * Phase > Milestone > Task > Subtask. All types use readonly properties
 * to ensure immutability and prevent accidental state mutation.
 *
 * @example
 * ```typescript
 * import { Backlog, Status } from './core/models.js';
 *
 * const backlog: Backlog = {
 *   backlog: [
 *     {
 *       id: 'P1',
 *       type: 'Phase',
 *       title: 'Phase 1: Foundation',
 *       status: 'Planned',
 *       description: 'Project initialization',
 *       milestones: []
 *     }
 *   ]
 * };
 * ```
 */

import { z } from 'zod';

/**
 * PRP compression level for PRP generation
 *
 * @remarks
 * Controls how much compression is applied to PRP content.
 * - 'off': No compression, full context preserved
 * - 'standard': Moderate compression (30-50% size reduction)
 * - 'aggressive': Maximum compression (50-70% size reduction)
 *
 * @example
 * ```typescript
 * import { PRPCompressionLevel } from './core/models.js';
 *
 * const level: PRPCompressionLevel = 'standard';
 * ```
 */
export type PRPCompressionLevel = 'off' | 'standard' | 'aggressive';

/**
 * Zod schema for PRP compression level validation
 *
 * @remarks
 * Validates that a string is one of the valid compression level values.
 *
 * @example
 * ```typescript
 * import { PRPCompressionLevelSchema } from './core/models.js';
 *
 * const result = PRPCompressionLevelSchema.safeParse('standard');
 * // result.success === true
 * ```
 */
export const PRPCompressionLevelSchema = z.enum([
  'off',
  'standard',
  'aggressive',
]);

/**
 * Zod schema for context_scope contract format validation
 *
 * @remarks
 * Validates that context_scope follows the CONTRACT DEFINITION format
 * with 4 numbered sections: RESEARCH NOTE, INPUT, LOGIC, OUTPUT.
 *
 * The format must be:
 * ```
 * CONTRACT DEFINITION:
 * 1. RESEARCH NOTE: [...]
 * 2. INPUT: [...]
 * 3. LOGIC: [...]
 * 4. OUTPUT: [...]
 * ```
 *
 * Section validation:
 * - Must start with "CONTRACT DEFINITION:" followed by newline
 * - Must have all 4 numbered sections in order
 * - Section headers must match exactly (case-sensitive)
 * - Section number must be followed by period and space
 *
 * @example
 * ```typescript
 * import { ContextScopeSchema } from './core/models.js';
 *
 * const validScope = `CONTRACT DEFINITION:
 * 1. RESEARCH NOTE: Basic research findings.
 * 2. INPUT: Data from S1.
 * 3. LOGIC: Implement feature.
 * 4. OUTPUT: Feature for consumption by S2.`;
 *
 * const result = ContextScopeSchema.safeParse(validScope);
 * // result.success === true
 * ```
 */
export const ContextScopeSchema: z.ZodType<string> = z
  .string()
  .min(1, 'Context scope is required')
  .superRefine((value, ctx) => {
    // Check for CONTRACT DEFINITION prefix
    const prefix = 'CONTRACT DEFINITION:\n';
    if (!value.startsWith(prefix)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'context_scope must start with "CONTRACT DEFINITION:" followed by a newline',
      });
      return; // Exit early if prefix missing
    }

    // Extract sections after the prefix
    const content = value.slice(prefix.length);

    // Check for all 4 numbered sections in order
    const requiredSections = [
      { num: 1, name: 'RESEARCH NOTE', pattern: /1\.\s*RESEARCH\sNOTE:/m },
      { num: 2, name: 'INPUT', pattern: /2\.\s*INPUT:/m },
      { num: 3, name: 'LOGIC', pattern: /3\.\s*LOGIC:/m },
      { num: 4, name: 'OUTPUT', pattern: /4\.\s*OUTPUT:/m },
    ];

    let searchStartIndex = 0;

    for (const section of requiredSections) {
      // Search for the section header in the content starting from the last position
      const match = section.pattern.exec(content);

      if (!match || match.index < searchStartIndex) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Missing or incorrect section: "${section.num}. ${section.name}:"`,
        });
        return;
      }

      // Update the search start position to after this section
      // This ensures sections are in order
      searchStartIndex = match.index + match[0].length;
    }
  });

/**
 * Lifecycle status of a work item in the PRP Pipeline
 *
 * @remarks
 * Each work item progresses through these states as it moves from
 * conception to completion. The Architect Agent creates items in
 * 'Planned' status, and the Task Orchestrator updates status as
 * work progresses.
 *
 * - `Planned`: Initial state after Architect Agent generates the backlog
 * - `Researching`: Research Agent is gathering context for PRP generation
 * - `Implementing`: Coder Agent is actively implementing the PRP
 * - `Complete`: All validation gates passed, work is done
 * - `Failed`: Implementation failed, requires retry or manual intervention
 * - `Obsolete`: Work item was deprecated or replaced (e.g., delta session)
 *
 * @example
 * ```typescript
 * import { Status } from './core/models.js';
 *
 * const currentStatus: Status = 'Implementing';
 * ```
 */
export type Status =
  | 'Planned'
  | 'Researching'
  | 'Ready'
  | 'Implementing'
  | 'Retrying'
  | 'Complete'
  | 'Failed'
  | 'Obsolete';

/**
 * Zod schema for Status enum validation
 *
 * @remarks
 * Validates that a value is one of the valid Status values.
 * Use this for runtime validation of status fields.
 *
 * @example
 * ```typescript
 * import { StatusEnum } from './core/models.js';
 *
 * const result = StatusEnum.safeParse('Planned');
 * // result.success === true
 * ```
 */
export const StatusEnum = z.enum([
  'Planned',
  'Researching',
  'Ready',
  'Implementing',
  'Retrying',
  'Complete',
  'Failed',
  'Obsolete',
]);

/**
 * Type discriminator for the four levels of task hierarchy
 *
 * @remarks
 * Each work item has a `type` field that indicates its level in the
 * hierarchy. This enables type narrowing when processing heterogeneous
 * collections of work items.
 *
 * @example
 * ```typescript
 * import { ItemType } from './core/models.js';
 *
 * const type: ItemType = 'Subtask';
 * ```
 */
export type ItemType = 'Phase' | 'Milestone' | 'Task' | 'Subtask';

/**
 * Zod schema for ItemType enum validation
 *
 * @remarks
 * Validates that a value is one of the valid ItemType values.
 * Use this for runtime validation of type fields.
 *
 * @example
 * ```typescript
 * import { ItemTypeEnum } from './core/models.js';
 *
 * const result = ItemTypeEnum.safeParse('Subtask');
 * // result.success === true
 * ```
 */
export const ItemTypeEnum = z.enum(['Phase', 'Milestone', 'Task', 'Subtask']);

/**
 * Leaf node in the task hierarchy - the smallest unit of work
 *
 * @remarks
 * Subtasks represent atomic work items that can be completed in a single
 * implementation pass. Each subtask has a PRP (Product Requirement Prompt)
 * generated by the Researcher Agent and executed by the Coder Agent.
 *
 * The `context_scope` field contains critical instructions for the Coder Agent,
 * defining what code it can access and modify during implementation.
 *
 * @see {@link https://github.com/anthropics/claude-code/blob/main/PRP-TEMPLATE.md | PRP Template}
 *
 * @example
 * ```typescript
 * import { Subtask, Status } from './core/models.js';
 *
 * const subtask: Subtask = {
 *   id: 'P1.M1.T1.S1',
 *   type: 'Subtask',
 *   title: 'Create TypeScript interfaces for task hierarchy',
 *   status: 'Planned',
 *   story_points: 2,
 *   dependencies: [],
 *   context_scope: 'Strict scope: src/core/ directory only'
 * };
 * ```
 */
export interface Subtask {
  /**
   * Unique identifier following dot-notation hierarchy
   *
   * @format P{phase}.M{milestone}.T{task}.S{subtask}
   * @example 'P1.M1.T1.S1'
   */
  readonly id: string;

  /** Type discriminator for type narrowing */
  readonly type: 'Subtask';

  /**
   * Human-readable title of the work item
   *
   * @minLength 1
   * @maxLength 200
   */
  readonly title: string;

  /** Current lifecycle status */
  readonly status: Status;

  /**
   * Estimated complexity in Fibonacci story points
   *
   * @remarks
   * Uses the Fibonacci sequence: 1, 2, 3, 5, 8, 13, 21
   * Larger values indicate higher uncertainty and complexity
   *
   * @min 1
   * @max 21
   */
  readonly story_points: number;

  /**
   * IDs of subtasks that must complete before this one can start
   *
   * @remarks
   * The Task Orchestrator uses this array to enforce dependency ordering.
   * Empty array means no dependencies.
   *
   * @example ['P1.M1.T1.S1', 'P1.M1.T1.S2']
   */
  readonly dependencies: string[];

  /**
   * Strict instructions for isolated development
   *
   * @remarks
   * Defines INPUT (what to use), OUTPUT (what to produce), and MOCKING
   * (what external services to fake). This context is injected into the
   * Coder Agent's prompt.
   *
   * @example
   * ```
   * INPUT: TaskRegistry from dependency P1.M2.T1.S1
   * OUTPUT: TaskService.create() method
   * MOCKING: Groundswell agents, file system operations
   * ```
   */
  readonly context_scope: string;
}

/**
 * Zod schema for Subtask validation
 *
 * @remarks
 * Validates Subtask objects with all field constraints including story points
 * range (Fibonacci: 1-21) and ID format validation.
 *
 * @example
 * ```typescript
 * import { SubtaskSchema } from './core/models.js';
 *
 * const result = SubtaskSchema.safeParse({
 *   id: 'P1.M1.T1.S1',
 *   type: 'Subtask',
 *   title: 'Create Zod schemas',
 *   status: 'Planned',
 *   story_points: 2,
 *   dependencies: [],
 *   context_scope: 'src/core/models.ts only'
 * });
 * // result.success === true
 * ```
 */
export const SubtaskSchema: z.ZodType<Subtask> = z.object({
  id: z
    .string()
    .regex(
      /^P\d+\.M\d+\.T\d+\.S\d+$/,
      'Invalid subtask ID format (expected P{N}.M{N}.T{N}.S{N})'
    ),
  type: z.literal('Subtask'),
  title: z.string().min(1, 'Title is required').max(200, 'Title too long'),
  status: StatusEnum,
  story_points: z
    .number({ invalid_type_error: 'Story points must be a number' })
    // TASK_BREAKDOWN_PROMPT allows 0.5 / 1 / 2 SP per subtask; accept half-point
    // granularity (0.5 multiples) with a 0.5 floor. The prior .int().min(1)
    // rejected the prompt's own 0.5-SP examples.
    .multipleOf(0.5, 'Story points must be in 0.5 increments')
    .min(0.5, 'Story points must be at least 0.5')
    .max(21, 'Story points cannot exceed 21'),
  dependencies: z.array(z.string()).min(0),
  context_scope: ContextScopeSchema,
});

/**
 * Container for related subtasks forming a coherent unit of work
 *
 * @remarks
 * Tasks represent intermediate-level work items that group related subtasks.
 * A Task is typically completed when all its subtasks are Complete.
 *
 * @example
 * ```typescript
 * import { Task, Status } from './core/models.js';
 *
 * const task: Task = {
 *   id: 'P1.M1.T1',
 *   type: 'Task',
 *   title: 'Initialize TypeScript Project',
 *   status: 'Planned',
 *   description: 'Set up package.json, tsconfig.json, and directory structure',
 *   subtasks: [
 *     {
 *       id: 'P1.M1.T1.S1',
 *       type: 'Subtask',
 *       title: 'Initialize package.json',
 *       status: 'Complete',
 *       story_points: 1,
 *       dependencies: [],
 *       context_scope: '...'
 *     }
 *   ]
 * };
 * ```
 */
export interface Task {
  /**
   * Unique identifier following dot-notation hierarchy
   *
   * @format P{phase}.M{milestone}.T{task}
   * @example 'P1.M1.T1'
   */
  readonly id: string;

  /** Type discriminator for type narrowing */
  readonly type: 'Task';

  /** Human-readable title of the work item */
  readonly title: string;

  /** Current lifecycle status */
  readonly status: Status;

  /**
   * Detailed description of the task's objectives
   *
   * @remarks
   * Explains what the task accomplishes and how its subtasks
   * contribute to the overall goal.
   */
  readonly description: string;

  /**
   * Array of subtasks that comprise this task
   *
   * @remarks
   * Tasks contain subtasks, forming a parent-child relationship.
   * The Task Orchestrator processes subtasks sequentially based on
   * dependency ordering within this array.
   */
  readonly subtasks: Subtask[];
}

/**
 * Zod schema for Task validation
 *
 * @remarks
 * Validates Task objects with recursive Subtask array validation.
 * Note that Tasks contain Subtasks, not other Tasks.
 *
 * @example
 * ```typescript
 * import { TaskSchema } from './core/models.js';
 *
 * const result = TaskSchema.safeParse({
 *   id: 'P1.M1.T1',
 *   type: 'Task',
 *   title: 'Define Task Models',
 *   status: 'Planned',
 *   description: 'Create TypeScript interfaces',
 *   subtasks: []
 * });
 * // result.success === true
 * ```
 */
export const TaskSchema: z.ZodType<Task> = z.object({
  id: z
    .string()
    .regex(
      /^P\d+\.M\d+\.T\d+$/,
      'Invalid task ID format (expected P{N}.M{N}.T{N})'
    ),
  type: z.literal('Task'),
  title: z.string().min(1, 'Title is required').max(200, 'Title too long'),
  status: StatusEnum,
  description: z.string().min(1, 'Description is required'),
  subtasks: z.array(SubtaskSchema),
});

/**
 * Significant checkpoint or deliverable within a phase
 *
 * @remarks
 * Milestones represent major progress points that group related tasks.
 * They often correspond to deliverable increments or validation gates.
 *
 * @example
 * ```typescript
 * import { Milestone, Status } from './core/models.js';
 *
 * const milestone: Milestone = {
 *   id: 'P1.M1',
 *   type: 'Milestone',
 *   title: 'Project Initialization',
 *   status: 'Complete',
 *   description: 'Foundation setup and environment configuration',
 *   tasks: []
 * };
 * ```
 */
export interface Milestone {
  /**
   * Unique identifier following dot-notation hierarchy
   *
   * @format P{phase}.M{milestone}
   * @example 'P1.M1'
   */
  readonly id: string;

  /** Type discriminator for type narrowing */
  readonly type: 'Milestone';

  /** Human-readable title of the work item */
  readonly title: string;

  /** Current lifecycle status */
  readonly status: Status;

  /**
   * Detailed description of the milestone's objectives
   *
   * @remarks
   * Explains what the milestone accomplishes and what deliverables
   * are expected upon completion.
   */
  readonly description: string;

  /**
   * Array of tasks that comprise this milestone
   *
   * @remarks
   * Milestones contain tasks, forming a parent-child relationship.
   * Tasks are processed based on their internal dependencies.
   */
  readonly tasks: Task[];
}

/**
 * Zod schema for Milestone validation
 *
 * @remarks
 * Validates Milestone objects with recursive Task array validation.
 * Uses z.lazy() to handle the recursive reference to TaskSchema.
 *
 * @example
 * ```typescript
 * import { MilestoneSchema } from './core/models.js';
 *
 * const result = MilestoneSchema.safeParse({
 *   id: 'P1.M1',
 *   type: 'Milestone',
 *   title: 'Project Initialization',
 *   status: 'Complete',
 *   description: 'Foundation setup and environment configuration',
 *   tasks: []
 * });
 * // result.success === true
 * ```
 */
export const MilestoneSchema: z.ZodType<Milestone> = z.lazy(() =>
  z.object({
    id: z
      .string()
      .regex(
        /^P\d+\.M\d+$/,
        'Invalid milestone ID format (expected P{N}.M{N})'
      ),
    type: z.literal('Milestone'),
    title: z.string().min(1, 'Title is required').max(200, 'Title too long'),
    status: StatusEnum,
    description: z.string().min(1, 'Description is required'),
    tasks: z.array(z.lazy(() => TaskSchema)),
  })
);

/**
 * Top-level container representing a major development phase
 *
 * @remarks
 * Phases represent the highest level of organization in the PRP Pipeline.
 * Each phase typically corresponds to a major capability or milestone
 * in the overall product roadmap (e.g., "Foundation", "Core Agent System").
 *
 * @example
 * ```typescript
 * import { Phase, Status } from './core/models.js';
 *
 * const phase: Phase = {
 *   id: 'P1',
 *   type: 'Phase',
 *   title: 'Phase 1: Foundation & Environment Setup',
 *   status: 'Complete',
 *   description: 'Project initialization, environment configuration, and core data structures',
 *   milestones: []
 * };
 * ```
 */
export interface Phase {
  /**
   * Unique identifier for the phase
   *
   * @format P{phase}
   * @example 'P1'
   */
  readonly id: string;

  /** Type discriminator for type narrowing */
  readonly type: 'Phase';

  /** Human-readable title of the work item */
  readonly title: string;

  /** Current lifecycle status */
  readonly status: Status;

  /**
   * Detailed description of the phase's objectives
   *
   * @remarks
   * Explains the overall goals, scope, and expected outcomes
   * for this phase of development.
   */
  readonly description: string;

  /**
   * Array of milestones that comprise this phase
   *
   * @remarks
   * Phases contain milestones, forming the top level of the hierarchy.
   * The PRP Pipeline processes phases sequentially.
   */
  readonly milestones: Milestone[];
}

/**
 * Zod schema for Phase validation
 *
 * @remarks
 * Validates Phase objects with recursive Milestone array validation.
 * Uses z.lazy() to handle the recursive reference to MilestoneSchema.
 *
 * @example
 * ```typescript
 * import { PhaseSchema } from './core/models.js';
 *
 * const result = PhaseSchema.safeParse({
 *   id: 'P1',
 *   type: 'Phase',
 *   title: 'Phase 1: Foundation',
 *   status: 'Planned',
 *   description: 'Project initialization',
 *   milestones: []
 * });
 * // result.success === true
 * ```
 */
export const PhaseSchema: z.ZodType<Phase> = z.lazy(() =>
  z.object({
    id: z.string().regex(/^P\d+$/, 'Invalid phase ID format (expected P{N})'),
    type: z.literal('Phase'),
    title: z.string().min(1, 'Title is required').max(200, 'Title too long'),
    status: StatusEnum,
    description: z.string().min(1, 'Description is required'),
    milestones: z.array(z.lazy(() => MilestoneSchema)),
  })
);

/**
 * Root container for the entire task backlog
 *
 * @remarks
 * The Backlog interface represents the top-level structure stored in
 * `tasks.json`. It contains an array of Phases, forming the complete
 * hierarchy of work for the PRP Pipeline.
 *
 * The Session Manager loads this structure, and the Task Orchestrator
 * iterates through it to execute work items.
 *
 * @see {@link ./architecture/system_context.md#task-hierarchy-json-schema | System Context}
 *
 * @example
 * ```typescript
 * import { Backlog, Phase } from './core/models.js';
 *
 * const backlog: Backlog = {
 *   backlog: [
 *     {
 *       id: 'P1',
 *       type: 'Phase',
 *       title: 'Phase 1: Foundation',
 *       status: 'Planned',
 *       description: 'Project setup and core data structures',
 *       milestones: []
 *     },
 *     {
 *       id: 'P2',
 *       type: 'Phase',
 *       title: 'Phase 2: Core Agent System',
 *       status: 'Planned',
 *       description: 'Groundswell agent integration and prompt system',
 *       milestones: []
 *     }
 *   ]
 * };
 * ```
 */
export interface Backlog {
  /**
   * Array of phases comprising the complete project backlog
   *
   * @remarks
   * This is the root of the task hierarchy. All phases, milestones,
   * tasks, and subtasks are contained within this array.
   *
   * The Task Orchestrator processes phases sequentially in order,
   * then recursively processes nested items.
   */
  readonly backlog: Phase[];
}

/**
 * Zod schema for Backlog validation
 *
 * @remarks
 * Validates Backlog objects containing an array of Phase objects.
 * This is the root schema for the entire task hierarchy.
 *
 * @example
 * ```typescript
 * import { BacklogSchema } from './core/models.js';
 *
 * const result = BacklogSchema.safeParse({
 *   backlog: [
 *     {
 *       id: 'P1',
 *       type: 'Phase',
 *       title: 'Phase 1: Foundation',
 *       status: 'Planned',
 *       description: 'Project setup',
 *       milestones: []
 *     }
 *   ]
 * });
 * // result.success === true
 * ```
 */
export const BacklogSchema: z.ZodType<Backlog> = z.object({
  backlog: z.array(PhaseSchema),
});

/**
 * Session Metadata Interface
 *
 * Identifies and locates a session in the filesystem. Sessions are
 * created when the PRP Pipeline initializes, providing an immutable
 * audit trail of development history.
 *
 * @remarks
 * Session identifiers use the format `{sequence}_{hash}` where:
 * - `sequence`: Zero-padded incremental number (001, 002, 003, ...)
 * - `hash`: First 12 characters of the PRD content hash (SHA-256)
 *
 * The session directory path is `plan/{sequence}_{hash}/`.
 *
 * Delta sessions set `parentSession` to the parent session ID, enabling
 * change tracking and selective re-execution of modified tasks.
 *
 * @see {@link ../../plan/001_14b9dc2a33c7/architecture/system_context.md | System Context: Session Directory Structure}
 *
 * @example
 * ```typescript
 * import { SessionMetadata } from './core/models.js';
 *
 * const metadata: SessionMetadata = {
 *   id: '001_14b9dc2a33c7',
 *   hash: '14b9dc2a33c7',
 *   path: 'plan/001_14b9dc2a33c7',
 *   createdAt: new Date('2024-01-12T10:00:00Z'),
 *   parentSession: null  // Initial session has no parent
 * };
 * ```
 */
export interface SessionMetadata {
  /**
   * Unique session identifier combining sequence and PRD hash
   *
   * @format {sequence}_{hash}
   * @example '001_14b9dc2a33c7'
   */
  readonly id: string;

  /**
   * SHA-256 hash of the PRD content (first 12 characters)
   *
   * @remarks
   * Used for PRD change detection. If the hash differs from the
   * current PRD hash, a delta session is required.
   *
   * @length 12
   */
  readonly hash: string;

  /**
   * Filesystem path to the session directory
   *
   * @format plan/{sequence}_{hash}/
   * @example 'plan/001_14b9dc2a33c7/'
   */
  readonly path: string;

  /**
   * Timestamp when the session was created
   *
   * @remarks
   * Stored as a Date object for type safety. Serialized to ISO 8601
   * format when persisted to JSON.
   *
   * @format ISO 8601
   */
  readonly createdAt: Date;

  /**
   * Parent session ID for delta sessions
   *
   * @remarks
   * Null for initial sessions. Set to the parent session ID for
   * delta sessions created when the PRD is modified.
   *
   * This enables the Session Manager to trace the lineage of sessions
   * and determine which tasks can be reused from the parent session.
   *
   * @nullable true
   * @example '001_14b9dc2a33c7' for a delta session, null for initial session
   */
  readonly parentSession: string | null;
}

/**
 * Complete state of a development session
 *
 * @remarks
 * SessionState captures the complete state at session initialization,
 * including the PRD snapshot, task hierarchy, and current execution
 * position. This state is persisted to `tasks.json` and loaded by
 * the Session Manager to enable resume capability.
 *
 * The `currentItemId` field tracks which task/subtask is currently
 * being executed, enabling the pipeline to resume from interruption
 * without re-executing completed work.
 *
 * @see {@link ../../plan/001_14b9dc2a33c7/architecture/system_context.md | System Context: Task Hierarchy}
 *
 * @example
 * ```typescript
 * import { SessionState, SessionMetadata, Backlog, Status } from './core/models.js';
 *
 * const state: SessionState = {
 *   metadata: {
 *     id: '001_14b9dc2a33c7',
 *     hash: '14b9dc2a33c7',
 *     path: 'plan/001_14b9dc2a33c7',
 *     createdAt: new Date(),
 *     parentSession: null
 *   },
 *   prdSnapshot: '# PRD Content\\n...',
 *   taskRegistry: {
 *     backlog: [
 *       {
 *         id: 'P1',
 *         type: 'Phase',
 *         title: 'Phase 1',
 *         status: 'Planned',
 *         description: 'Foundation',
 *         milestones: []
 *       }
 *     ]
 *   },
 *   currentItemId: 'P1.M1.T1.S1'
 * };
 * ```
 */
export interface SessionState {
  /** Session identification and filesystem location */
  readonly metadata: SessionMetadata;

  /**
   * Full PRD content at session initialization
   *
   * @remarks
   * Stores the complete PRD markdown content as a string. Used for
   * change detection and as the baseline for delta diffing.
   *
   * The PRD snapshot is stored in `plan/{session_id}/prd_snapshot.md`
   * and this field contains its content as a string for easy access.
   */
  readonly prdSnapshot: string;

  /**
   * Task hierarchy for this session
   *
   * @remarks
   * Reuses the existing `Backlog` interface from the task hierarchy.
   * Contains the complete Phase > Milestone > Task > Subtask structure
   * generated by the Architect Agent.
   *
   * This registry is the single source of truth for task execution.
   * Status updates are persisted here as work progresses.
   */
  readonly taskRegistry: Backlog;

  /**
   * Currently executing work item ID
   *
   * @remarks
   * Tracks the task/subtask currently being executed by the pipeline.
   * Null if no task is currently active (e.g., session initialized
   * but execution not started, or all tasks complete).
   *
   * Enables resume capability: the Task Orchestrator can find and
   * continue from this item after interruption.
   *
   * @format P{phase}.M{milestone}.T{task}.S{subtask} or similar
   * @nullable true
   * @example 'P1.M1.T1.S1' for a subtask, null when idle
   */
  readonly currentItemId: string | null;
}

/**
 * Delta session state for PRD change management
 *
 * @remarks
 * Delta sessions are created when the master PRD is modified after
 * initial session creation. They extend the base SessionState with
 * additional fields for PRD diffing and change analysis.
 *
 * The Delta Analysis workflow (P4.M1.T1) compares oldPRD and newPRD
 * to generate the diffSummary, which guides task patching logic.
 *
 * Delta sessions reference their parent session via the inherited
 * `parentSession` field in metadata, enabling the pipeline to reuse
 * completed work from the parent session.
 *
 * @see {@link ../../../PRD.md#43-the-delta-workflow-change-management | PRD: Delta Workflow}
 *
 * @example
 * ```typescript
 * import { DeltaSession, SessionMetadata, Backlog } from './core/models.js';
 *
 * const delta: DeltaSession = {
 *   metadata: {
 *     id: '002_a3f8e9d12b4',
 *     hash: 'a3f8e9d12b4',
 *     path: 'plan/002_a3f8e9d12b4',
 *     createdAt: new Date(),
 *     parentSession: '001_14b9dc2a33c7'  // References parent session
 *   },
 *   prdSnapshot: '# Updated PRD\\n...',
 *   taskRegistry: { backlog: [] },
 *   currentItemId: null,
 *   oldPRD: '# Original PRD\\n...',
 *   newPRD: '# Updated PRD\\n...',
 *   diffSummary: 'Added new feature X, modified feature Y requirements'
 * };
 * ```
 */
export interface DeltaSession extends SessionState {
  /**
   * Original PRD content before modification
   *
   * @remarks
   * Stores the PRD content from the parent session. Used by the
   * Delta Analysis workflow to compute differences and identify
   * which tasks are affected by PRD changes.
   */
  readonly oldPRD: string;

  /**
   * Modified PRD content after user changes
   *
   * @remarks
   * The updated PRD that triggered delta session creation. The
   * Architect Agent will process this PRD to generate an updated
   * task registry.
   */
  readonly newPRD: string;

  /**
   * Human-readable summary of PRD differences
   *
   * @remarks
   * Generated by the Delta Analysis workflow (P4.M1.T1). Provides
   * a high-level description of what changed in the PRD, which
   * guides task patching decisions.
   *
   * Example content: "Added Phase 5 for production deployment,
   * modified P3.M2.T1 to include parallel research, removed
   * deprecated P2.M3.T2.S1"
   */
  readonly diffSummary: string;
}

/**
 * Represents a single validation level in the PRP validation system
 *
 * @remarks
 * PRPs use a 4-level progressive validation system:
 * - Level 1: Syntax & Style (linting, type checking)
 * - Level 2: Unit Tests (component validation)
 * - Level 3: Integration Testing (system validation)
 * - Level 4: Manual/Creative Validation (end-to-end workflows)
 *
 * Each level must pass before proceeding to the next. The `command` field
 * contains the shell command to run for automated validation levels, while
 * `manual` indicates whether the level requires human intervention.
 *
 * @see {@link ../../PROMPTS.md | PROMPTS.md PRP Template: Validation Loop section}
 *
 * @example
 * ```typescript
 * import { ValidationGate } from './core/models.js';
 *
 * const level1Gate: ValidationGate = {
 *   level: 1,
 *   description: 'Syntax & Style validation',
 *   command: 'ruff check src/ --fix && mypy src/',
 *   manual: false,
 * };
 *
 * const level4Gate: ValidationGate = {
 *   level: 4,
 *   description: 'Manual end-to-end testing',
 *   command: null,
 *   manual: true,
 * };
 * ```
 */
export interface ValidationGate {
  /**
   * Validation level in the progressive system (1-5)
   *
   * @remarks
   * Each level represents a distinct validation gate:
   * - 1: Syntax & Style (linting, formatting, type checking)
   * - 2: Unit Tests (component-level validation)
   * - 3: Integration Testing (system-level validation)
   * - 4: Manual/Creative (end-to-end workflows, domain-specific)
   * - 5: Scope guard (verify task boundaries respected, no forbidden imports)
   */
  readonly level: 1 | 2 | 3 | 4 | 5;

  /**
   * Human-readable description of what this level validates
   *
   * @remarks
   * Provides context for developers executing the PRP about what
   * aspect of the implementation is being validated at this level.
   */
  readonly description: string;

  /**
   * Bash command to run for this validation level
   *
   * @remarks
   * Contains the shell command for automated validation. Set to `null`
   * for manual validation levels (typically level 4) that require human
   * judgment or creative validation.
   *
   * @nullable true
   * @example 'ruff check src/ --fix && npm run type-check'
   */
  readonly command: string | null;

  /**
   * Whether this validation requires manual intervention
   *
   * @remarks
   * Set to `true` for validation levels that require human judgment,
   * such as end-to-end testing, code review, or creative validation.
   * Automated levels (1-3) should be `false`.
   */
  readonly manual: boolean;
}

/**
 * Zod schema for ValidationGate interface validation
 *
 * @remarks
 * Validates that an object conforms to the ValidationGate interface structure.
 * Enforces that level is one of the four valid literal values (1-4) and that
 * command is either a string or null (not undefined).
 *
 * @example
 * ```typescript
 * import { ValidationGateSchema } from './core/models.js';
 *
 * const result = ValidationGateSchema.safeParse({
 *   level: 1,
 *   description: 'Test',
 *   command: 'npm test',
 *   manual: false,
 * });
 * // result.success === true
 * ```
 */
export const ValidationGateSchema = z
  .object({
    // Accept the natural shapes reasoning models emit: a numeric level (1-4),
    // a descriptive string ("L1 — typecheck..."), or "L1"-style prefixes.
    // Normalize to one of 1|2|3|4|5 so the executor can sort numerically.
    level: z.union([z.number(), z.string()]),
    description: z.string().optional(),
    command: z.string().nullable(),
    manual: z.boolean().optional(),
  })
  .transform((g): ValidationGate => {
    let level: 1 | 2 | 3 | 4 | 5;
    if (typeof g.level === 'number') {
      level = Math.max(1, Math.min(5, Math.trunc(g.level))) as
        | 1
        | 2
        | 3
        | 4
        | 5;
    } else {
      const m = g.level.match(/([1-5])/);
      if (!m) {
        // No numeric hint — assign level 1 (syntax/style) as a safe default.
        level = 1;
      } else {
        level = Number(m[1]) as 1 | 2 | 3 | 4 | 5;
      }
    }
    const command = g.command ?? null;
    return {
      level,
      description: g.description ?? `Level ${level} gate`,
      command,
      manual: g.manual ?? command === null,
    };
  });

/**
 * Represents a single success criterion checkbox from the PRP "What" section
 *
 * @remarks
 * Success criteria are measurable outcomes that define completion of a PRP.
 * Each criterion has a description and a satisfied boolean that tracks
 * whether the criterion has been met during implementation.
 *
 * These criteria are used in the Final Validation Checklist to verify
 * that all success conditions from the "What" section have been satisfied.
 *
 * @see {@link ../../PROMPTS.md | PROMPTS.md PRP Template: Success Criteria section}
 *
 * @example
 * ```typescript
 * import { SuccessCriterion } from './core/models.js';
 *
 * const criterion: SuccessCriterion = {
 *   description: 'All four interfaces added to src/core/models.ts',
 *   satisfied: false,
 * };
 *
 * // After implementation completes:
 * criterion.satisfied = true;
 * ```
 */
export interface SuccessCriterion {
  /**
   * The criterion description text (without checkbox prefix)
   *
   * @remarks
   * Contains the readable description of what success looks like
   * for this specific criterion. This is the text that would appear
   * after the checkbox in the PRP document.
   *
   * @example "All four interfaces added to src/core/models.ts"
   */
  readonly description: string;

  /**
   * Whether this criterion has been met
   *
   * @remarks
   * Tracks the satisfaction state of this success criterion.
   * Updated as implementation progresses and validation gates pass.
   * The Final Validation Checklist checks that all criteria are satisfied.
   */
  readonly satisfied: boolean;
}

/**
 * Zod schema for SuccessCriterion interface validation
 *
 * @remarks
 * Validates that an object conforms to the SuccessCriterion interface structure.
 * Both description and satisfied fields are required; satisfied must be a boolean.
 *
 * @example
 * ```typescript
 * import { SuccessCriterionSchema } from './core/models.js';
 *
 * const result = SuccessCriterionSchema.safeParse({
 *   description: 'Test criterion',
 *   satisfied: true,
 * });
 * // result.success === true
 * ```
 */
export const SuccessCriterionSchema = z.object({
  description: z.string().min(1, 'Description is required'),
  // satisfied is an executor-state field; default to false on ingestion so the
  // agent doesn't have to emit it (it has no way to know satisfaction state).
  satisfied: z.boolean().default(false),
});

/**
 * Complete PRP (Product Requirement Prompt) document structure
 *
 * @remarks
 * PRPDocument represents the full structure of a PRP as defined in PROMPTS.md.
 * It captures all sections needed for type-safe generation, validation, and
 * execution of PRPs throughout the development pipeline.
 *
 * This interface is used by:
 * - P2.M2.T2 (Create PRP Generation Prompts) to generate PRPs from Architect output
 * - P3.M3.T1 (PRP Execution Runtime) to parse and execute PRPs
 *
 * The document contains the objective, context, implementation steps, validation
 * gates, success criteria, and references needed to implement a work item.
 *
 * @see {@link ../../PROMPTS.md#319-637 | PROMPTS.md PRP Template}
 *
 * @example
 * ```typescript
 * import { PRPDocument, ValidationGate, SuccessCriterion } from './core/models.js';
 *
 * const prp: PRPDocument = {
 *   taskId: 'P1.M2.T2.S2',
 *   objective: 'Add PRP document interfaces to models.ts',
 *   context: '# All Needed Context\\n\\n...',
 *   implementationSteps: [
 *     'Create ValidationGate interface',
 *     'Create ValidationGateSchema',
 *   ],
 *   validationGates: [
 *     {
 *       level: 1,
 *       description: 'Syntax & Style validation',
 *       command: 'npm run validate',
 *       manual: false,
 *     },
 *     // ... more gates
 *   ],
 *   successCriteria: [
 *     { description: 'All interfaces added', satisfied: false },
 *     // ... more criteria
 *   ],
 *   references: [
 *     'https://github.com/anthropics/claude-code',
 *     'src/core/models.ts',
 *   ],
 * };
 * ```
 */
export interface PRPDocument {
  /**
   * The work item ID this PRP is for
   *
   * @remarks
   * Matches the task hierarchy ID format (e.g., "P1.M2.T2.S2" for a subtask).
   * Used to associate the PRP with its corresponding work item in the backlog.
   *
   * @format P{phase}.M{milestone}.T{task}.S{subtask} or similar
   * @example "P1.M2.T2.S2"
   */
  readonly taskId: string;

  /**
   * The Feature Goal from the Goal section
   *
   * @remarks
   * Contains the specific, measurable end state of what needs to be built.
   * This is the primary objective that the implementation must achieve.
   */
  readonly objective: string;

  /**
   * The complete "All Needed Context" section as markdown
   *
   * @remarks
   * Stores the full context section as a markdown string, including
   * documentation references, file patterns, gotchas, and all other
   * context needed for successful implementation.
   *
   * This context is critical for the "one-pass implementation success"
   * goal of the PRP system.
   */
  readonly context: string;

  /**
   * Array of implementation task descriptions
   *
   * @remarks
   * Each step is a string description of a discrete implementation task.
   * Steps are ordered by dependencies and guide the agent through
   * the implementation process.
   */
  readonly implementationSteps: string[];

  /**
   * Array of 4 validation gates (one per level)
   *
   * @remarks
   * Contains exactly 4 validation gates, one for each level of the
   * progressive validation system. Each gate must pass before proceeding
   * to the next level.
   */
  readonly validationGates: ValidationGate[];

  /**
   * Array of success criteria checkboxes
   *
   * @remarks
   * Contains all success criteria from the "What" section. These are
   * verified in the Final Validation Checklist to confirm that all
   * success conditions have been met.
   */
  readonly successCriteria: SuccessCriterion[];

  /**
   * Array of reference URLs and file paths
   *
   * @remarks
   * Contains links to external documentation and internal file references
   * that provide additional context for implementation.
   */
  readonly references: string[];
}

/**
 * Zod schema for PRPDocument interface validation
 *
 * @remarks
 * Validates that an object conforms to the PRPDocument interface structure.
 * Ensures all required fields are present and properly typed, including
 * nested validation of ValidationGate and SuccessCriterion arrays.
 *
 * @example
 * ```typescript
 * import { PRPDocumentSchema } from './core/models.js';
 *
 * const result = PRPDocumentSchema.safeParse({
 *   taskId: 'P1.M2.T2.S2',
 *   objective: 'Test',
 *   context: '## Context',
 *   implementationSteps: ['Step 1'],
 *   validationGates: [...],
 *   successCriteria: [...],
 *   references: [],
 * });
 * // result.success === true
 * ```
 */
export const PRPDocumentSchema = z.object({
  taskId: z.string().min(1, 'Task ID is required'),
  objective: z.string().min(1, 'Objective is required'),
  context: z.string().min(1, 'Context is required'),
  implementationSteps: z.array(
    z.string().min(1, 'Implementation step cannot be empty')
  ),
  validationGates: z.array(ValidationGateSchema),
  successCriteria: z.array(SuccessCriterionSchema),
  references: z.array(z.string()),
});

/**
 * Metadata about a generated PRP document for tracking within session state
 *
 * @remarks
 * PRPArtifact stores metadata about PRP generation and execution status.
 * It enables the Session Manager to track which PRPs have been generated,
 * their current execution status, and their filesystem locations.
 *
 * The status field tracks the PRP lifecycle through these states:
 * - `Generated`: PRP has been created but not yet executed
 * - `Executing`: PRP is currently being implemented by an agent
 * - `Completed`: PRP execution completed successfully
 * - `Failed`: PRP execution failed and requires intervention
 *
 * Artifacts are stored in session state to enable resume capability
 * and track progress across multiple PRP executions.
 *
 * @example
 * ```typescript
 * import { PRPArtifact } from './core/models.js';
 *
 * const artifact: PRPArtifact = {
 *   taskId: 'P1.M2.T2.S2',
 *   prpPath: 'plan/001_14b9dc2a33c7/P1M2T2S2/PRP.md',
 *   status: 'Generated',
 *   generatedAt: new Date('2024-01-12T10:00:00Z'),
 * };
 *
 * // Update status during execution
 * artifact.status = 'Executing';
 * ```
 */
export interface PRPArtifact {
  /**
   * The work item ID this PRP was generated for
   *
   * @remarks
   * Matches the task ID in the backlog. Used to correlate the PRP
   * artifact with its corresponding work item.
   *
   * @example "P1.M2.T2.S2"
   */
  readonly taskId: string;

  /**
   * Filesystem path to the generated PRP.md file
   *
   * @remarks
   * Absolute or relative path to the PRP document on disk. Used by the
   * PRP Execution Runtime to load and parse the PRP for execution.
   *
   * @format plan/{sequence}_{hash}/{taskId}/PRP.md
   * @example "plan/001_14b9dc2a33c7/P1M2T2S2/PRP.md"
   */
  readonly prpPath: string;

  /**
   * Current execution status of the PRP
   *
   * @remarks
   * Tracks where the PRP is in its lifecycle:
   * - `Generated`: PRP file has been created, ready for execution
   * - `Executing`: Agent is currently implementing the PRP
   * - `Completed`: All validation gates passed, PRP is complete
   * - `Failed`: Execution failed, requires retry or manual intervention
   */
  readonly status: 'Generated' | 'Executing' | 'Completed' | 'Failed';

  /**
   * Timestamp when the PRP was generated
   *
   * @remarks
   * Records when the PRP was created. Used for tracking and debugging.
   * Stored as a Date object for type safety.
   *
   * @format ISO 8601
   */
  readonly generatedAt: Date;
}

/**
 * Zod schema for PRPArtifact interface validation
 *
 * @remarks
 * Validates that an object conforms to the PRPArtifact interface structure.
 * Ensures status is one of the four valid literal values and that generatedAt
 * is a valid Date object.
 *
 * @example
 * ```typescript
 * import { PRPArtifactSchema } from './core/models.js';
 *
 * const result = PRPArtifactSchema.safeParse({
 *   taskId: 'P1.M2.T2.S2',
 *   prpPath: 'plan/001_14b9dc2a33c7/P1M2T2S2/PRP.md',
 *   status: 'Generated',
 *   generatedAt: new Date(),
 * });
 * // result.success === true
 * ```
 */
export const PRPArtifactSchema: z.ZodType<PRPArtifact> = z.object({
  taskId: z.string().min(1, 'Task ID is required'),
  prpPath: z.string().min(1, 'PRP path is required'),
  status: z.union([
    z.literal('Generated'),
    z.literal('Executing'),
    z.literal('Completed'),
    z.literal('Failed'),
  ]),
  generatedAt: z.date(),
});

/**
 * Represents a single detected change in the PRD delta analysis
 *
 * @remarks
 * RequirementChange captures individual differences between old and new
 * PRD versions. Each change is categorized as added, modified, or removed,
 * with descriptions of what changed and how it impacts implementation.
 *
 * Used by the Delta Analysis workflow to communicate PRD differences to
 * the task patching logic.
 *
 * @example
 * ```typescript
 * import { RequirementChange } from './core/models.js';
 *
 * const change: RequirementChange = {
 *   itemId: 'P1.M2.T3.S1',
 *   type: 'modified',
 *   description: 'Added validation for negative numbers',
 *   impact: 'Update implementation to reject negative story_points values'
 * };
 * ```
 */
export interface RequirementChange {
  /**
   * Task, milestone, or subtask ID that changed
   *
   * @format P{phase}.M{milestone}.T{task}.S{subtask} (or shorter)
   * @example 'P1.M2.T3.S1' for a subtask, 'P2.M1' for a milestone
   */
  readonly itemId: string;

  /**
   * Type of change detected
   *
   * @remarks
   * - 'added': New requirement that didn't exist in old PRD
   * - 'modified': Existing requirement with changed content
   * - 'removed': Requirement that exists in old PRD but not new PRD
   */
  readonly type: 'added' | 'modified' | 'removed';

  /**
   * Human-readable description of what changed
   *
   * @remarks
   * Explains the specific difference between old and new PRD versions.
   * Should be detailed enough for a developer to understand the change.
   *
   * @example "Added field: maxRetries with default value of 3"
   */
  readonly description: string;

  /**
   * Explanation of implementation impact
   *
   * @remarks
   * Describes how this change affects the codebase and what actions
   * are needed. Used by the task patching logic to determine re-execution.
   *
   * @example "Update createTask() to validate maxRetries parameter"
   */
  readonly impact: string;
}

/**
 * Zod schema for RequirementChange validation
 *
 * @remarks
 * Validates RequirementChange objects with all field constraints.
 * Ensures type is one of the three valid enum values and that
 * string fields are non-empty.
 *
 * @example
 * ```typescript
 * import { RequirementChangeSchema } from './core/models.js';
 *
 * const result = RequirementChangeSchema.safeParse({
 *   itemId: 'P1.M2.T3.S1',
 *   type: 'modified',
 *   description: 'Added validation',
 *   impact: 'Update implementation'
 * });
 * // result.success === true
 * ```
 */
export const RequirementChangeSchema: z.ZodType<RequirementChange> = z.object({
  itemId: z.string().min(1, 'Item ID is required'),
  type: z.enum(['added', 'modified', 'removed']),
  description: z.string().min(1, 'Description is required'),
  impact: z.string().min(1, 'Impact is required'),
});

/**
 * Complete delta analysis result from PRD comparison
 *
 * @remarks
 * DeltaAnalysis represents the structured output of the Delta Analysis
 * workflow (P4.M1.T1). Contains all detected changes, natural language
 * instructions for task patching, and the list of task IDs that need
 * to be re-executed.
 *
 * This structure enables type-safe validation of AI agent output when
 * performing PRD diffing, ensuring that delta sessions have reliable
 * change data for task patching decisions.
 *
 * @example
 * ```typescript
 * import { DeltaAnalysis, RequirementChange } from './core/models.js';
 *
 * const analysis: DeltaAnalysis = {
 *   changes: [
 *     {
 *       itemId: 'P1.M2.T3.S1',
 *       type: 'modified',
 *       description: 'Added validation',
 *       impact: 'Update implementation'
 *     }
 *   ],
 *   patchInstructions: 'Re-execute P1.M2.T3.S1 to apply validation changes',
 *   taskIds: ['P1.M2.T3.S1']
 * };
 * ```
 */
export interface DeltaAnalysis {
  /**
   * Array of all detected changes between PRD versions
   *
   * @remarks
   * Contains RequirementChange objects for each added, modified, or
   * removed requirement. Empty array if no changes detected.
   */
  readonly changes: RequirementChange[];

  /**
   * Natural language instructions for task patching
   *
   * @remarks
   * Human-readable guide for the task patching logic (P4.M1.T2).
   * Explains which tasks need re-execution, which can be reused,
   * and any special handling required for the delta.
   *
   * @example "Re-execute P1.M2.T3.S1. P1.M2.T1 can be reused from parent session."
   */
  readonly patchInstructions: string;

  /**
   * Task IDs that need to be re-executed
   *
   * @remarks
   * List of task/subtask IDs affected by PRD changes. The Task
   * Orchestrator uses this list to determine which work items
   * need to run in the delta session.
   *
   * Empty array if no tasks are affected (rare - delta session
   * wouldn't be created if no changes).
   */
  readonly taskIds: string[];
}

/**
 * Zod schema for DeltaAnalysis validation
 *
 * @remarks
 * Validates DeltaAnalysis objects including nested RequirementChange
 * array validation. Ensures patchInstructions is non-empty and that
 * all changes in the array conform to RequirementChangeSchema.
 *
 * @example
 * ```typescript
 * import { DeltaAnalysisSchema } from './core/models.js';
 *
 * const result = DeltaAnalysisSchema.safeParse({
 *   changes: [],
 *   patchInstructions: 'No changes detected',
 *   taskIds: []
 * });
 * // result.success === true
 * ```
 */
export const DeltaAnalysisSchema: z.ZodType<DeltaAnalysis> = z.object({
  changes: z.array(RequirementChangeSchema),
  patchInstructions: z.string().min(1, 'Patch instructions are required'),
  taskIds: z.array(z.string()),
});

/**
 * Bug severity classification for QA reporting
 *
 * @remarks
 * Severity levels indicate impact on system functionality:
 * - `critical`: System down, data loss, security vulnerability
 * - `major`: Significant functionality broken, workarounds unavailable
 * - `minor`: Partial functionality, workarounds available
 * - `cosmetic`: Polish items, typos, visual issues
 *
 * @example
 * ```typescript
 * import { BugSeverity } from './core/models.js';
 *
 * const severity: BugSeverity = 'critical';
 * ```
 */
export type BugSeverity = 'critical' | 'major' | 'minor' | 'cosmetic';

/**
 * Zod schema for BugSeverity enum validation
 *
 * @remarks
 * Validates that a value is one of the four valid severity levels.
 * Used for runtime validation of bug severity fields.
 *
 * @example
 * ```typescript
 * import { BugSeverityEnum } from './core/models.js';
 *
 * const result = BugSeverityEnum.safeParse('critical');
 * // result.success === true
 * ```
 */
export const BugSeverityEnum = z.enum([
  'critical',
  'major',
  'minor',
  'cosmetic',
]);

/**
 * Structured bug report from QA Agent testing
 *
 * @remarks
 * Bug represents a single issue discovered during QA testing. Contains
 * all information needed for developers to reproduce, understand, and fix
 * the issue. Used by the QA Agent to generate structured bug reports
 * that can be processed by the bug fix sub-pipeline.
 *
 * @example
 * ```typescript
 * import { Bug, BugSeverity } from './core/models.js';
 *
 * const bug: Bug = {
 *   id: 'BUG-001',
 *   severity: 'critical',
 *   title: 'Login fails with empty password',
 *   description: 'Unhandled exception when password field is empty',
 *   reproduction: '1. Navigate to /login\n2. Leave password empty\n3. Click Submit',
 *   location: 'src/services/auth.ts:45'
 * };
 * ```
 */
export interface Bug {
  /**
   * Unique identifier for this bug report
   *
   * @remarks
   * Should be unique across all bugs in a test session.
   * Use format like BUG-001 or timestamp-based ID.
   *
   * @example 'BUG-001' or 'bug-1705123456'
   */
  readonly id: string;

  /** Severity classification */
  readonly severity: BugSeverity;

  /**
   * Brief, searchable title of the bug
   *
   * @minLength 1
   * @maxLength 200
   * @example 'Login fails with empty password'
   */
  readonly title: string;

  /**
   * Detailed explanation of the bug
   *
   * @remarks
   * Should include expected vs actual behavior, error messages,
   * and any relevant context about when the bug occurs.
   */
  readonly description: string;

  /**
   * Step-by-step instructions to reproduce the bug
   *
   * @remarks
   * Must be detailed enough that another developer can follow
   * the steps and reliably observe the bug.
   *
   * @example
   * ```
   * 1. Navigate to /login
   * 2. Leave password field empty
   * 3. Click Submit button
   * 4. Observe: Unhandled exception thrown
   * ```
   */
  readonly reproduction: string;

  /**
   * File or function location where bug occurs
   *
   * @remarks
   * Optional field for code-related bugs. Include file path
   * and function name for easy navigation.
   *
   * @nullable true
   * @example 'src/services/auth.ts:45' or 'LoginComponent.submit()'
   */
  readonly location?: string;
}

/**
 * Zod schema for Bug validation
 *
 * @remarks
 * Validates Bug objects with all field constraints. Ensures required
 * fields are present and non-empty, title length is bounded, and
 * severity is a valid BugSeverity value.
 *
 * @example
 * ```typescript
 * import { BugSchema } from './core/models.js';
 *
 * const result = BugSchema.safeParse({
 *   id: 'BUG-001',
 *   severity: 'critical',
 *   title: 'Test bug',
 *   description: 'Test description',
 *   reproduction: 'Test steps'
 * });
 * // result.success === true
 * ```
 */
export const BugSchema: z.ZodType<Bug> = z.object({
  id: z.string().min(1, 'Bug ID is required'),
  severity: BugSeverityEnum,
  title: z.string().min(1, 'Title is required').max(200, 'Title too long'),
  description: z.string().min(1, 'Description is required'),
  reproduction: z.string().min(1, 'Reproduction steps are required'),
  location: z.string().optional(),
});

/**
 * Complete test results from QA Agent bug hunt
 *
 * @remarks
 * TestResults represents the structured output of the QA Bug Hunt workflow.
 * Contains all bugs found during testing, a summary of the testing performed,
 * and recommendations for fixes. The `hasBugs` boolean drives the bug fix
 * cycle: if true, the bug fix sub-pipeline processes the bugs; if false,
 * the absence of TEST_RESULTS.md signals success.
 *
 * This structure enables type-safe validation of AI agent output when
 * performing QA testing, ensuring that bug reports have reliable data
 * for the fix cycle.
 *
 * @example
 * ```typescript
 * import { TestResults, Bug } from './core/models.js';
 *
 * const results: TestResults = {
 *   hasBugs: true,
 *   bugs: [
 *     {
 *       id: 'BUG-001',
 *       severity: 'critical',
 *       title: 'Login fails',
 *       description: 'Auth error',
 *       reproduction: 'Steps...'
 *     }
 *   ],
 *   summary: 'Found 1 critical bug during login testing',
 *   recommendations: ['Add input validation']
 * };
 * ```
 */
export interface TestResults {
  /**
   * Whether critical or major bugs were found
   *
   * @remarks
   * This boolean drives the bug fix cycle. If true, the bug
   * fix sub-pipeline treats the TEST_RESULTS.md as a mini-PRD.
   * If false, the absence of the file signals success.
   */
  readonly hasBugs: boolean;

  /**
   * Array of all bugs found during testing
   *
   * @remarks
   * Contains bugs of all severity levels. Empty array if no
   * bugs found. The QA Agent populates this based on testing
   * results across happy paths, edge cases, and adversarial scenarios.
   */
  readonly bugs: Bug[];

  /**
   * High-level summary of testing performed
   *
   * @remarks
   * Should include: total tests performed, areas covered,
   * overall quality assessment, and any notable findings.
   *
   * @example "Performed 15 tests across login, data persistence, and error handling. Found 2 critical issues."
   */
  readonly summary: string;

  /**
   * Recommended fixes or improvements
   *
   * @remarks
   * Array of actionable recommendations for fixing bugs or
   * improving the implementation. Can be empty if no specific
   * recommendations beyond fixing reported bugs.
   */
  readonly recommendations: string[];
}

/**
 * Zod schema for TestResults validation
 *
 * @remarks
 * Validates TestResults objects including nested Bug array validation.
 * Ensures summary is non-empty and that all bugs in the array conform
 * to BugSchema. Empty bugs array is valid (no bugs found).
 *
 * @example
 * ```typescript
 * import { TestResultsSchema } from './core/models.js';
 *
 * const result = TestResultsSchema.safeParse({
 *   hasBugs: false,
 *   bugs: [],
 *   summary: 'All tests passed',
 *   recommendations: []
 * });
 * // result.success === true
 * ```
 */
export const TestResultsSchema: z.ZodType<TestResults> = z.object({
  hasBugs: z.boolean(),
  bugs: z.array(BugSchema),
  summary: z.string().min(1, 'Summary is required'),
  recommendations: z.array(z.string()).min(0),
});
