/**
 * Checkpoint Manager for long-running task state persistence
 *
 * @module core/checkpoint-manager
 *
 * @remarks
 * Manages checkpoint creation, restoration, and cleanup for PRP execution.
 * Uses atomic writes to ensure checkpoint data integrity and provides resumption
 * capability for interrupted long-running tasks.
 *
 * Features:
 * - Save checkpoints at specific execution points
 * - Restore checkpoints to resume execution
 * - List available checkpoints for a task
 * - Cleanup old checkpoints (retention policy)
 * - Validate checkpoint data with Zod
 * - Use atomic writes for all checkpoint operations
 *
 * @example
 * ```typescript
 * import { CheckpointManager } from './core/checkpoint-manager.js';
 *
 * const manager = new CheckpointManager(sessionPath);
 *
 * // Save checkpoint
 * const id = await manager.saveCheckpoint(
 *   'P1.M1.T1.S1',
 *   'Before PRP execution',
 *   executionState
 * );
 *
 * // Restore checkpoint
 * const checkpoint = await manager.restoreCheckpoint(id);
 * ```
 */

import { atomicWrite } from './session-utils.js';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { getLogger } from '../utils/logger.js';
import type { Logger } from '../utils/logger.js';

/**
 * Validation gate result for checkpoint state
 *
 * @remarks
 * This interface is defined here for checkpoint state use.
 * The PRPExecutor also defines ValidationGateResult for execution results.
 */
export interface ValidationGateResult {
  /** Validation level (1-5) */
  readonly level: 1 | 2 | 3 | 4 | 5;
  /** Description of what this level validates */
  readonly description: string;
  /** Whether the validation passed */
  readonly success: boolean;
  /** Command that was executed (null if skipped) */
  readonly command: string | null;
  /** Standard output from command */
  readonly stdout: string;
  /** Standard error from command */
  readonly stderr: string;
  /** Exit code from process (null if skipped) */
  readonly exitCode: number | null;
  /** True if this gate was skipped (manual or no command) */
  readonly skipped: boolean;
}

/**
 * Checkpoint execution state
 *
 * @remarks
 * Captures the state of PRP execution at a specific point in time.
 * This allows resumption from interruption.
 */
export interface CheckpointExecutionState {
  /** PRP file path being executed */
  readonly prpPath: string;

  /** Current execution stage */
  readonly stage:
    | 'pre-execution'
    | 'coder-response'
    | 'validation-gate-1'
    | 'validation-gate-2'
    | 'validation-gate-3'
    | 'validation-gate-4'
    | 'complete'
    | 'failed';

  /** Coder Agent response (if stage is post-coder) */
  readonly coderResponse?: string;

  /** Parsed coder result (if available) */
  readonly coderResult?: {
    readonly result: 'success' | 'error' | 'issue';
    readonly message: string;
  };

  /** Validation results completed so far */
  readonly validationResults: readonly ValidationGateResult[];

  /** Current fix attempt number (if in fix-and-retry) */
  readonly fixAttempt?: number;

  /** Timestamp when this state was captured */
  readonly timestamp: Date;
}

/**
 * Checkpoint data structure
 *
 * @remarks
 * Complete checkpoint information including metadata and execution state.
 */
export interface CheckpointData {
  /** Unique checkpoint identifier */
  readonly id: string;

  /** Task/subtask ID this checkpoint is for */
  readonly taskId: string;

  /** Human-readable checkpoint label */
  readonly label: string;

  /** Checkpoint execution state */
  readonly state: CheckpointExecutionState;

  /** Timestamp when checkpoint was created */
  readonly createdAt: Date;

  /** Error context (if checkpoint due to error) */
  readonly error?: {
    readonly message: string;
    readonly code?: string;
    readonly stack?: string;
  };
}

/**
 * Checkpoint file structure
 *
 * @remarks
 * Schema for the checkpoints.json file stored in artifacts/{taskId}/.
 */
export interface CheckpointFile {
  /** Version of checkpoint format (for migration) */
  readonly version: '1.0';

  /** All checkpoints for this task */
  readonly checkpoints: readonly CheckpointData[];

  /** Last modified timestamp */
  readonly lastModified: Date;
}

/**
 * Checkpoint manager configuration
 */
export interface CheckpointConfig {
  /** Maximum number of checkpoints to retain per task (default: 5) */
  readonly maxCheckpoints: number;

  /** Enable/disable checkpoint creation (default: true) */
  readonly enabled: boolean;

  /** Automatically cleanup old checkpoints (default: true) */
  readonly autoCleanup: boolean;
}

/**
 * Default checkpoint configuration
 */
const DEFAULT_CHECKPOINT_CONFIG: CheckpointConfig = {
  maxCheckpoints: 5,
  enabled: true,
  autoCleanup: true,
};

/**
 * Zod schema for ValidationGateResult validation
 */
const ValidationGateResultSchema = z.object({
  level: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  description: z.string(),
  success: z.boolean(),
  command: z.string().nullable(),
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number().nullable(),
  skipped: z.boolean(),
});

/**
 * Zod schema for checkpoint execution state validation
 */
const CheckpointExecutionStateSchema = z.object({
  prpPath: z.string(),
  stage: z.enum([
    'pre-execution',
    'coder-response',
    'validation-gate-1',
    'validation-gate-2',
    'validation-gate-3',
    'validation-gate-4',
    'complete',
    'failed',
  ]),
  coderResponse: z.string().optional(),
  coderResult: z
    .object({
      result: z.enum(['success', 'error', 'issue']),
      message: z.string(),
    })
    .optional(),
  validationResults: z.array(ValidationGateResultSchema),
  fixAttempt: z.number().int().min(0).optional(),
  timestamp: z.date(),
});

/**
 * Zod schema for checkpoint data validation
 */
const CheckpointDataSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  label: z.string(),
  state: CheckpointExecutionStateSchema,
  createdAt: z.date(),
  error: z
    .object({
      message: z.string(),
      code: z.string().optional(),
      stack: z.string().optional(),
    })
    .optional(),
});

/**
 * Zod schema for checkpoint file validation
 */
const CheckpointFileSchema = z.object({
  version: z.literal('1.0'),
  checkpoints: z.array(CheckpointDataSchema),
  lastModified: z.date(),
});

/**
 * Helper function to revive dates from JSON
 *
 * @remarks
 * JSON.parse doesn't automatically convert date strings to Date objects.
 * This reviver function handles that conversion for fields named:
 * - timestamp
 * - createdAt
 * - lastModified
 */
function dateReviver(key: string, value: unknown): unknown {
  // Convert date strings to Date objects for known date fields
  const dateFields = ['timestamp', 'createdAt', 'lastModified'];
  if (dateFields.includes(key) && typeof value === 'string') {
    const parsed = new Date(value);
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return value;
}

/**
 * Checkpoint Manager for long-running task state persistence
 *
 * @remarks
 * Manages checkpoint creation, restoration, and cleanup for PRP execution.
 * Uses atomic writes to ensure checkpoint data integrity.
 *
 * Checkpoint stages:
 * - `pre-execution`: Before Coder Agent execution
 * - `coder-response`: After Coder Agent completes
 * - `validation-gate-N`: After each validation gate (1-4)
 * - `complete`: Task completed successfully
 * - `failed`: Task failed
 *
 * @example
 * ```typescript
 * const manager = new CheckpointManager('/path/to/session');
 *
 * // Save checkpoint
 * const id = await manager.saveCheckpoint(
 *   'P1.M1.T1.S1',
 *   'Before PRP execution',
 *   { prpPath: '/path/to/prp.md', stage: 'pre-execution', validationResults: [], timestamp: new Date() }
 * );
 *
 * // Restore checkpoint
 * const checkpoint = await manager.restoreCheckpoint(id);
 *
 * // List checkpoints
 * const checkpoints = await manager.listCheckpoints('P1.M1.T1.S1');
 *
 * // Cleanup old checkpoints
 * await manager.cleanup('P1.M1.T1.S1');
 * ```
 */
export class CheckpointManager {
  readonly #logger: Logger;
  readonly sessionPath: string;
  readonly #config: CheckpointConfig;

  /**
   * Creates a new CheckpointManager instance
   *
   * @param sessionPath - Path to session directory
   * @param config - Partial checkpoint configuration (merged with defaults)
   */
  constructor(sessionPath: string, config: Partial<CheckpointConfig> = {}) {
    this.#logger = getLogger('CheckpointManager');
    this.sessionPath = sessionPath;
    this.#config = { ...DEFAULT_CHECKPOINT_CONFIG, ...config };
  }

  /**
   * Save a checkpoint at the current execution state
   *
   * @param taskId - Task/subtask ID
   * @param label - Human-readable checkpoint label
   * @param state - Current execution state
   * @param error - Optional error context
   * @returns Checkpoint ID
   *
   * @remarks
   * Checkpoint ID format: {taskId}_{timestamp}_{stage}_{random}
   * Example: P1.M1.T1.S1_1706102400000_pre-execution_a1b2c3d4
   */
  async saveCheckpoint(
    taskId: string,
    label: string,
    state: CheckpointExecutionState,
    error?: Error
  ): Promise<string> {
    if (!this.#config.enabled) {
      this.#logger.debug('Checkpoint creation disabled');
      return '';
    }

    const checkpointId = this.#generateCheckpointId(taskId, state.stage);
    const timestamp = new Date();

    const checkpointData: CheckpointData = {
      id: checkpointId,
      taskId,
      label,
      state,
      createdAt: timestamp,
      error: error
        ? {
            message: error.message,
            code: (error as { code?: string }).code,
            stack: error.stack,
          }
        : undefined,
    };

    // Validate checkpoint data
    const validated = CheckpointDataSchema.parse(
      checkpointData
    ) as CheckpointData;

    // Load existing checkpoint file or create new
    const checkpointPath = this.#getCheckpointPath(taskId);
    let checkpointFile: {
      version: '1.0';
      checkpoints: CheckpointData[];
      lastModified: Date;
    };

    if (existsSync(checkpointPath)) {
      const content = await readFile(checkpointPath, 'utf-8');
      checkpointFile = CheckpointFileSchema.parse(
        JSON.parse(content, dateReviver)
      ) as {
        version: '1.0';
        checkpoints: CheckpointData[];
        lastModified: Date;
      };
    } else {
      // Ensure directory exists
      const dir = dirname(checkpointPath);
      await mkdir(dir, { recursive: true });
      checkpointFile = {
        version: '1.0',
        checkpoints: [],
        lastModified: timestamp,
      };
    }

    // Add new checkpoint
    checkpointFile.checkpoints.push(validated);
    checkpointFile.lastModified = timestamp;

    // Auto-cleanup if enabled
    if (this.#config.autoCleanup) {
      while (checkpointFile.checkpoints.length > this.#config.maxCheckpoints) {
        checkpointFile.checkpoints.shift();
      }
    }

    // Save using atomic write
    await atomicWrite(checkpointPath, JSON.stringify(checkpointFile, null, 2));

    this.#logger.info(
      { taskId, checkpointId, stage: state.stage, label },
      `Checkpoint saved: ${label}`
    );

    return checkpointId;
  }

  /**
   * Restore a checkpoint by ID
   *
   * @param checkpointId - Checkpoint ID to restore
   * @returns Checkpoint data
   * @throws Error if checkpoint not found
   */
  async restoreCheckpoint(checkpointId: string): Promise<CheckpointData> {
    // Extract taskId from checkpointId
    const match = checkpointId.match(/^([A-Z0-9.]+)_/);
    if (!match) {
      throw new Error(`Invalid checkpoint ID: ${checkpointId}`);
    }
    const taskId = match[1];

    const checkpointFile = await this.#loadCheckpointFile(taskId);
    const checkpoint = checkpointFile.checkpoints.find(
      c => c.id === checkpointId
    );

    if (!checkpoint) {
      throw new Error(`Checkpoint not found: ${checkpointId}`);
    }

    this.#logger.info(
      { checkpointId, taskId, stage: checkpoint.state.stage },
      `Checkpoint restored: ${checkpoint.label}`
    );

    return checkpoint;
  }

  /**
   * Get the latest checkpoint for a task
   *
   * @param taskId - Task ID
   * @returns Latest checkpoint or null if none exist
   */
  async getLatestCheckpoint(taskId: string): Promise<CheckpointData | null> {
    try {
      const checkpointFile = await this.#loadCheckpointFile(taskId);
      if (checkpointFile.checkpoints.length === 0) {
        return null;
      }
      return checkpointFile.checkpoints[checkpointFile.checkpoints.length - 1];
    } catch {
      return null;
    }
  }

  /**
   * List all checkpoints for a task
   *
   * @param taskId - Task ID
   * @returns Array of checkpoints sorted by creation time
   */
  async listCheckpoints(taskId: string): Promise<CheckpointData[]> {
    try {
      const checkpointFile = await this.#loadCheckpointFile(taskId);
      return [...checkpointFile.checkpoints].sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
      );
    } catch {
      return [];
    }
  }

  /**
   * Cleanup old checkpoints for a task
   *
   * @param taskId - Task ID
   * @param retain - Number of checkpoints to retain (default: config.maxCheckpoints)
   */
  async cleanup(taskId: string, retain?: number): Promise<void> {
    const retainCount = retain ?? this.#config.maxCheckpoints;
    const checkpointPath = this.#getCheckpointPath(taskId);

    if (!existsSync(checkpointPath)) {
      return;
    }

    const checkpointFile = await this.#loadCheckpointFile(taskId);

    if (checkpointFile.checkpoints.length <= retainCount) {
      return;
    }

    // Remove oldest checkpoints - use mutable operations internally
    const mutableFile: {
      version: '1.0';
      checkpoints: CheckpointData[];
      lastModified: Date;
    } = {
      version: checkpointFile.version,
      checkpoints: [...checkpointFile.checkpoints].slice(-retainCount),
      lastModified: new Date(),
    };

    await atomicWrite(checkpointPath, JSON.stringify(mutableFile, null, 2));

    this.#logger.info(
      {
        taskId,
        removedCount: checkpointFile.checkpoints.length - retainCount,
        retained: retainCount,
      },
      'Checkpoints cleaned up'
    );
  }

  /**
   * Delete a specific checkpoint
   *
   * @param checkpointId - Checkpoint ID to delete
   */
  async deleteCheckpoint(checkpointId: string): Promise<void> {
    const match = checkpointId.match(/^([A-Z0-9.]+)_/);
    if (!match) {
      throw new Error(`Invalid checkpoint ID: ${checkpointId}`);
    }
    const taskId = match[1];

    const checkpointFile = await this.#loadCheckpointFile(taskId);
    const index = checkpointFile.checkpoints.findIndex(
      c => c.id === checkpointId
    );

    if (index === -1) {
      throw new Error(`Checkpoint not found: ${checkpointId}`);
    }

    const mutableFile: {
      version: '1.0';
      checkpoints: CheckpointData[];
      lastModified: Date;
    } = {
      version: checkpointFile.version,
      checkpoints: [
        ...checkpointFile.checkpoints.slice(0, index),
        ...checkpointFile.checkpoints.slice(index + 1),
      ],
      lastModified: new Date(),
    };

    const checkpointPath = this.#getCheckpointPath(taskId);
    await atomicWrite(checkpointPath, JSON.stringify(mutableFile, null, 2));

    this.#logger.info({ checkpointId }, 'Checkpoint deleted');
  }

  /**
   * Check if a task has any checkpoints
   *
   * @param taskId - Task ID
   * @returns True if checkpoints exist
   */
  async hasCheckpoint(taskId: string): Promise<boolean> {
    const latest = await this.getLatestCheckpoint(taskId);
    return latest !== null;
  }

  /**
   * Generate a unique checkpoint ID
   *
   * @param taskId - Task ID
   * @param stage - Execution stage
   * @returns Checkpoint ID
   *
   * @remarks
   * Format: {taskId}_{timestamp}_{stage}_{random}
   * Example: P1.M1.T1.S1_1706102400000_pre-execution_a1b2c3d4
   */
  #generateCheckpointId(taskId: string, stage: string): string {
    const timestamp = Date.now();
    const random = randomBytes(4).toString('hex');
    return `${taskId}_${timestamp}_${stage}_${random}`;
  }

  /**
   * Get the checkpoint file path for a task
   *
   * @param taskId - Task ID
   * @returns Absolute path to checkpoints.json
   */
  #getCheckpointPath(taskId: string): string {
    return resolve(this.sessionPath, 'artifacts', taskId, 'checkpoints.json');
  }

  /**
   * Load and validate checkpoint file
   *
   * @param taskId - Task ID
   * @returns Validated checkpoint file
   * @throws Error if file not found or invalid
   */
  async #loadCheckpointFile(taskId: string): Promise<CheckpointFile> {
    const checkpointPath = this.#getCheckpointPath(taskId);
    const content = await readFile(checkpointPath, 'utf-8');
    return CheckpointFileSchema.parse(
      JSON.parse(content, dateReviver)
    ) as CheckpointFile;
  }
}
