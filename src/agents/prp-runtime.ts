/**
 * PRP Runtime for orchestrating research → implementation → validation
 *
 * @module agents/prp-runtime
 *
 * @remarks
 * Orchestrates the complete inner loop workflow:
 * 1. Research Phase: Generate PRP via PRPGenerator (status: Researching)
 * 2. Implementation Phase: Execute PRP via PRPExecutor (status: Implementing)
 * 3. Artifact Collection: Write validation results and summaries
 * 4. Status Update: Complete or Failed based on execution result
 *
 * This class integrates PRPGenerator and PRPExecutor with TaskOrchestrator
 * for full lifecycle management.
 *
 * @example
 * ```typescript
 * import { PRPRuntime } from './agents/prp-runtime.js';
 *
 * const runtime = new PRPRuntime(orchestrator);
 * const result = await runtime.executeSubtask(subtask, backlog);
 * if (result.success) {
 *   console.log('Subtask completed successfully');
 * }
 * ```
 */

// CRITICAL: Import patterns - use .js extensions for ES modules
import { PRPGenerator } from './prp-generator.js';
import { PRPExecutor } from './prp-executor.js';
import { getLogger } from '../utils/logger.js';
import type { Logger } from '../utils/logger.js';
import type { TaskOrchestrator } from '../core/task-orchestrator.js';
import type {
  PRPDocument,
  Subtask,
  Backlog,
  Status,
  PRPCompressionLevel,
} from '../core/models.js';
import type { ExecutionResult } from './prp-executor.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Custom error for PRP Runtime failures
 *
 * @remarks
 * Thrown when the runtime orchestration fails at any phase.
 * Includes subtask ID and phase for debugging.
 */
export class PRPRuntimeError extends Error {
  constructor(
    public readonly subtaskId: string,
    public readonly phase: 'Research' | 'Implementation',
    originalError: unknown
  ) {
    super(
      `PRP Runtime failed for ${subtaskId} during ${phase} phase: ${
        originalError instanceof Error
          ? originalError.message
          : String(originalError)
      }`
    );
    this.name = 'PRPRuntimeError';
  }
}

/**
 * PRP Runtime for orchestrating research → implementation → validation
 *
 * @remarks
 * Orchestrates the complete inner loop workflow:
 * 1. Research Phase: Generate PRP via PRPGenerator (status: Researching)
 * 2. Implementation Phase: Execute PRP via PRPExecutor (status: Implementing)
 * 3. Artifact Collection: Write validation results and summaries
 * 4. Status Update: Complete or Failed based on execution result
 *
 * This class integrates PRPGenerator and PRPExecutor with TaskOrchestrator
 * for full lifecycle management.
 *
 * @example
 * ```typescript
 * const runtime = new PRPRuntime(orchestrator);
 * const result = await runtime.executeSubtask(subtask, backlog);
 * if (result.success) {
 *   console.log('Subtask completed successfully');
 * }
 * ```
 */
export class PRPRuntime {
  /** Logger instance for structured logging */
  readonly #logger: Logger;

  /** Task Orchestrator for status management */
  readonly #orchestrator: TaskOrchestrator;

  /** Path to session directory */
  readonly #sessionPath: string;

  /** PRP Generator for research phase */
  readonly #generator: PRPGenerator;

  /** PRP Executor for implementation phase */
  readonly #executor: PRPExecutor;

  /** Cache TTL in milliseconds */
  readonly #cacheTtlMs: number;

  /** PRP compression level */
  readonly #prpCompression: PRPCompressionLevel;

  /**
   * Creates a new PRPRuntime instance
   *
   * @param orchestrator - Task Orchestrator for status management
   * @param cacheTtlMs - Cache TTL in milliseconds (default: 24 hours)
   * @param prpCompression - PRP compression level (default: 'standard')
   * @throws {Error} If no active session exists
   */
  constructor(
    orchestrator: TaskOrchestrator,
    cacheTtlMs: number = 24 * 60 * 60 * 1000,
    prpCompression: PRPCompressionLevel = 'standard'
  ) {
    this.#logger = getLogger('PRPRuntime');
    this.#orchestrator = orchestrator;
    this.#cacheTtlMs = cacheTtlMs;
    this.#prpCompression = prpCompression;

    // Extract session path from orchestrator's session manager
    const sessionManager = orchestrator.sessionManager;
    const currentSession = sessionManager.currentSession;

    if (!currentSession) {
      throw new Error('Cannot create PRPRuntime: no active session');
    }

    this.#sessionPath = currentSession.metadata.path;

    // Create PRPGenerator and PRPExecutor instances
    this.#generator = new PRPGenerator(
      sessionManager,
      false,
      cacheTtlMs,
      prpCompression
    );
    this.#executor = new PRPExecutor(this.#sessionPath);
  }

  /**
   * Executes a subtask through the complete inner loop
   *
   * @remarks
   * Orchestrates research (PRP generation) → implementation (PRP execution) → validation.
   * Manages status progression through Researching → Implementing → Complete/Failed.
   * Creates artifacts directory and writes execution results.
   *
   * @param subtask - The subtask to execute
   * @param backlog - The full backlog for context
   * @returns Execution result with validation results and artifacts
   * @throws {PRPRuntimeError} If orchestration fails
   */
  async executeSubtask(
    subtask: Subtask,
    backlog: Backlog
  ): Promise<ExecutionResult> {
    this.#logger.info(
      { subtaskId: subtask.id, title: subtask.title },
      'Starting execution'
    );

    try {
      // PHASE 1: Research - Generate PRP
      await this.#orchestrator.setStatus(
        subtask.id,
        'Researching',
        'Starting PRP generation'
      );
      this.#logger.debug({ subtaskId: subtask.id }, 'Research Phase');

      const prp = await this.#generator.generate(subtask, backlog);
      this.#logger.debug({ subtaskId: subtask.id }, 'PRP generated');

      // PHASE 2: Implementation - Execute PRP
      await this.#orchestrator.setStatus(
        subtask.id,
        'Implementing',
        'Starting PRP execution'
      );
      this.#logger.info({ subtaskId: subtask.id }, 'Implementation Phase');

      // Construct PRP file path (sanitize taskId: replace dots with underscores)
      const sanitizedId = subtask.id.replace(/\./g, '_');
      const prpPath = join(this.#sessionPath, 'prps', `${sanitizedId}.md`);

      // Create artifacts directory
      const artifactsDir = join(this.#sessionPath, 'artifacts', subtask.id);
      await mkdir(artifactsDir, { recursive: true });
      this.#logger.debug({ artifactsDir }, 'Artifacts directory created');

      // Execute PRP
      const result = await this.#executor.execute(prp, prpPath);

      // Write execution artifacts
      await this.#writeArtifacts(artifactsDir, result);

      // PHASE 3: Update final status
      if (result.success) {
        await this.#orchestrator.setStatus(
          subtask.id,
          'Complete',
          'Implementation completed successfully'
        );
        this.#logger.info({ subtaskId: subtask.id }, 'Complete');
      } else {
        await this.#orchestrator.setStatus(
          subtask.id,
          'Failed',
          result.error ?? 'Execution failed'
        );
        this.#logger.error(
          { subtaskId: subtask.id, error: result.error },
          'Failed'
        );
      }

      return result;
    } catch (error) {
      // Set status to Failed on any exception
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      await this.#orchestrator.setStatus(
        subtask.id,
        'Failed',
        `Execution failed: ${errorMessage}`
      );

      this.#logger.error(
        {
          subtaskId: subtask.id,
          error: errorMessage,
          ...(error instanceof Error && { stack: error.stack }),
        },
        'Execution failed'
      );

      // Return failed execution result
      return {
        success: false,
        outcome: 'fail',
        validationResults: [],
        artifacts: [],
        error: errorMessage,
        fixAttempts: 0,
      };
    }
  }

  /**
   * Writes execution artifacts to artifacts directory
   *
   * @remarks
   * Creates validation-results.json, execution-summary.md, and artifacts-list.json.
   * Errors during artifact writing are logged but don't fail execution.
   *
   * @param artifactsDir - Path to artifacts directory
   * @param result - Execution result to write
   * @private
   */
  async #writeArtifacts(
    artifactsDir: string,
    result: ExecutionResult
  ): Promise<void> {
    try {
      // Write validation results as JSON
      const validationResultsPath = join(
        artifactsDir,
        'validation-results.json'
      );
      await writeFile(
        validationResultsPath,
        JSON.stringify(result.validationResults, null, 2),
        { mode: 0o644 }
      );

      // Write execution summary as markdown
      const summaryPath = join(artifactsDir, 'execution-summary.md');
      const summary = this.#formatExecutionSummary(result);
      await writeFile(summaryPath, summary, { mode: 0o644 });

      // Write artifacts list as JSON
      const artifactsListPath = join(artifactsDir, 'artifacts-list.json');
      await writeFile(
        artifactsListPath,
        JSON.stringify(result.artifacts, null, 2),
        { mode: 0o644 }
      );

      this.#logger.debug({ artifactsDir }, 'Artifacts written');
    } catch (error) {
      // Log error but don't fail execution
      this.#logger.warn(
        {
          error: error instanceof Error ? error.message : String(error),
          artifactsDir,
        },
        'Failed to write artifacts'
      );
    }
  }

  /**
   * Formats execution result as markdown summary
   *
   * @param result - Execution result to format
   * @returns Markdown string representation
   * @private
   */
  #formatExecutionSummary(result: ExecutionResult): string {
    const status = result.success ? 'Success' : 'Failed';
    const validationDetails = result.validationResults
      .map(
        v => `
### Level ${v.level}: ${v.description}

- Status: ${v.success ? 'PASSED' : 'FAILED'}
- Command: ${v.command ?? 'N/A'}
- Skipped: ${v.skipped ? 'Yes' : 'No'}
${!v.success ? `- Exit Code: ${v.exitCode}\n- Error: ${v.stderr}` : ''}
      `
      )
      .join('\n');

    return `# Execution Summary

**Status**: ${status}
**Fix Attempts**: ${result.fixAttempts}
${(result.error?.length ?? 0) > 0 ? `**Error**: ${result.error}` : ''}

## Validation Results

${validationDetails || 'No validation results available.'}

## Artifacts

${result.artifacts.length > 0 ? result.artifacts.map(a => `- ${a}`).join('\n') : 'No artifacts recorded.'}
`;
  }
}

// PATTERN: Export type for convenience
export type { PRPDocument, Subtask, Backlog, Status };
