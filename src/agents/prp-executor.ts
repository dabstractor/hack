/**
 * PRP Executor for automated PRP execution with progressive validation
 *
 * @module agents/prp-executor
 *
 * @remarks
 * Orchestrates the Coder Agent to execute PRPs, runs progressive
 * validation gates (4 levels), and implements fix-and-retry logic
 * for handling validation failures.
 *
 * @example
 * ```ts
 * import { PRPExecutor } from './agents/prp-executor.js';
 *
 * const executor = new PRPExecutor(sessionPath);
 * const result = await executor.execute(prpDocument, prpPath);
 * // Returns ExecutionResult with validation results and artifacts
 * ```
 */

// CRITICAL: Import patterns - use .js extensions for ES modules
import { createCoderAgent } from './agent-factory.js';
import { PRP_BUILDER_PROMPT } from './prompts.js';
import { getLogger } from '../utils/logger.js';
import type { Logger } from '../utils/logger.js';
import type { Agent, Prompt, AgentResponse } from 'groundswell';
import type { PRPDocument, ValidationGate } from '../core/models.js';
import { BashMCP } from '../tools/bash-mcp.js';
import { retryAgentPrompt } from '../utils/retry.js';
import { CheckpointManager } from '../core/checkpoint-manager.js';
import type { CheckpointExecutionState } from '../core/checkpoint-manager.js';

/**
 * Result from a single validation gate execution
 *
 * @remarks
 * Contains the execution results for a single validation gate level,
 * including success status, captured output, and exit code.
 */
export interface ValidationGateResult {
  /** Validation level (1-4) */
  readonly level: 1 | 2 | 3 | 4;
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
 * Overall PRP execution result
 *
 * @remarks
 * Contains the complete execution results from running a PRP,
 * including validation gate results, artifacts produced, and
 * overall success status.
 *
 * Tri-state outcome model (PRD §4.5):
 * - `'success'` — implementation passed all validation gates.
 * - `'fail'` — hard implementation failure (validation exhausted, coder `'error'`, or exception).
 *   Handled by the existing fix-and-retry / Failed path.
 * - `'issue'` — a RECOVERABLE PLANNING GAP: the PRP was insufficient (missing context,
 *   wrong assumptions, ambiguous requirements) but the work itself is valid.
 *   Distinct from `'fail'`. Drives the issue-driven re-planning loop
 *   (delete stale PRP → reset to Planned → re-research with feedback),
 *   bounded by `ISSUE_RETRY_MAX`.
 *
 * Invariant: `success === (outcome === 'success')`. The `success: boolean` field is
 * retained for backward compatibility with existing consumers.
 *
 * @example
 * ```typescript
 * // Coder Agent reports a planning gap:
 * const result = await executor.execute(prp, prpPath);
 * // result.success === false, result.outcome === 'issue', result.issueMessage set
 *
 * // Coder Agent reports success:
 * // result.success === true, result.outcome === 'success'
 * ```
 */
export interface ExecutionResult {
  /** Whether all validation gates passed. Invariant: success === (outcome === 'success'). */
  readonly success: boolean;
  /**
   * Explicit tri-state outcome (PRD §4.5).
   *
   * - `'success'` — implementation passed all validation gates.
   * - `'fail'` — hard implementation failure (validation exhausted, coder `'error'`, or exception).
   * - `'issue'` — a RECOVERABLE PLANNING GAP: the PRP was insufficient but the work is valid.
   *
   * Optional for backward compatibility; every return from PRPExecutor.execute() sets it
   * explicitly.
   */
  readonly outcome?: 'success' | 'fail' | 'issue';
  /** Present only when outcome === 'issue': the Coder Agent's explanation of the planning gap. */
  readonly issueMessage?: string;
  /** Results from each validation gate that was executed */
  readonly validationResults: ValidationGateResult[];
  /** File paths created/modified during execution */
  readonly artifacts: string[];
  /** Error message if execution failed */
  readonly error?: string;
  /** Number of fix attempts made (0-2) */
  readonly fixAttempts: number;
}

/**
 * Custom error for PRP execution failures
 *
 * @remarks
 * Thrown when the PRP execution fails at a fundamental level,
 * such as inability to create the agent or parse results.
 */
export class PRPExecutionError extends Error {
  /**
   * Creates a new PRPExecutionError
   *
   * @param taskId - The work item ID that failed
   * @param prpPath - Path to the PRP file
   * @param originalError - The underlying error that caused the failure
   */
  constructor(
    public readonly taskId: string,
    public readonly prpPath: string,
    originalError: unknown
  ) {
    super(
      `Failed to execute PRP for ${taskId} at ${prpPath}: ${
        originalError instanceof Error
          ? originalError.message
          : String(originalError)
      }`
    );
    this.name = 'PRPExecutionError';
  }
}

/**
 * Custom error for validation failures
 *
 * @remarks
 * Thrown when validation gates fail after all fix attempts
 * are exhausted. Contains detailed information about which
 * gate failed and why.
 */
export class ValidationError extends Error {
  /**
   * Creates a new ValidationError
   *
   * @param level - The validation level that failed (1-4)
   * @param command - The command that was executed
   * @param stdout - Standard output from the command
   * @param stderr - Standard error from the command
   */
  constructor(
    public readonly level: number,
    public readonly command: string,
    public readonly stdout: string,
    public readonly stderr: string
  ) {
    super(
      `Validation failed at Level ${level} for command "${command}":\n${stderr}`
    );
    this.name = 'ValidationError';
  }
}

/**
 * Result from parsing Coder Agent JSON response
 *
 * @remarks
 * The result field uses literal types for type safety.
 */
interface ExecuteResult {
  /** The execution result status */
  result: 'error' | 'success' | 'issue';
  /** Detailed message about the result */
  message: string;
}

/**
 * PRP Executor for automated PRP execution with progressive validation
 *
 * @remarks
 * Orchestrates the Coder Agent to execute PRPs, runs progressive
 * validation gates (4 levels), and implements fix-and-retry logic
 * for handling validation failures.
 *
 * Usage flow:
 * 1. Instantiate with session path
 * 2. Call execute() with PRPDocument and file path
 * 3. Coder Agent reads PRP and implements code
 * 4. Validation gates run sequentially (Level 1 → 2 → 3 → 4)
 * 5. If validation fails, fix-and-retry triggers (up to 2 attempts)
 * 6. Returns ExecutionResult with all results and artifacts
 *
 * @example
 * ```typescript
 * import { PRPExecutor } from './agents/prp-executor.js';
 *
 * const executor = new PRPExecutor(sessionPath);
 * const result = await executor.execute(prpDocument, prpPath);
 *
 * if (result.success) {
 *   console.log('All validation gates passed!');
 * } else {
 *   console.error('Failed:', result.error);
 *   console.log('Validation results:', result.validationResults);
 * }
 * ```
 */
export class PRPExecutor {
  /** Logger instance for structured logging */
  readonly #logger: Logger;

  /** Path to session directory (for working directory context) */
  readonly sessionPath: string;

  /** Coder Agent instance for PRP execution */
  readonly #coderAgent: Agent;

  /** BashMCP instance for running validation commands */
  readonly #bashMCP: BashMCP;

  /** CheckpointManager for persisting execution state */
  readonly #checkpointManager: CheckpointManager;

  /**
   * Creates a new PRPExecutor instance
   *
   * @param sessionPath - Path to session directory for working directory context
   * @throws {Error} If sessionPath is not provided
   *
   * @example
   * ```typescript
   * const executor = new PRPExecutor('/path/to/session');
   * ```
   */
  constructor(sessionPath: string) {
    if (!sessionPath) {
      throw new Error('sessionPath is required for PRPExecutor');
    }
    this.#logger = getLogger('PRPExecutor');
    this.sessionPath = sessionPath;
    this.#coderAgent = createCoderAgent();
    this.#bashMCP = new BashMCP();
    this.#checkpointManager = new CheckpointManager(sessionPath);
  }

  /**
   * Executes a PRP with progressive validation and fix-and-retry
   *
   * @remarks
   * The complete PRP execution flow:
   * 1. Injects PRP path into PRP_BUILDER_PROMPT
   * 2. Executes Coder Agent to implement code
   * 3. Parses JSON result from Coder Agent
   * 4. Runs validation gates sequentially (Level 1 → 2 → 3 → 4)
   * 5. If any gate fails, triggers fix-and-retry (up to 2 attempts)
   * 6. Returns ExecutionResult with all validation results
   *
   * Fix-and-retry configuration:
   * - Max attempts: 2 (1 initial + 2 retries = 3 total)
   * - Base delay: 2000ms (2 seconds)
   * - Max delay: 30000ms (30 seconds)
   * - Exponential backoff: 2^n
   *
   * @param prp - The PRPDocument to execute
   * @param prpPath - File path to the PRP markdown file (for Coder Agent to read)
   * @returns ExecutionResult with validation results and artifacts
   *
   * @example
   * ```typescript
   * const prp: PRPDocument = { ... };
   * const result = await executor.execute(prp, '/path/to/prp.md');
   *
   * console.log(`Success: ${result.success}`);
   * console.log(`Fix attempts: ${result.fixAttempts}`);
   * for (const vr of result.validationResults) {
   *   console.log(`Level ${vr.level}: ${vr.success ? 'PASS' : 'FAIL'}`);
   * }
   * ```
   */
  async execute(prp: PRPDocument, prpPath: string): Promise<ExecutionResult> {
    let fixAttempts = 0;
    const maxFixAttempts = 2;

    // STEP 1: Inject PRP path into prompt
    const injectedPrompt = PRP_BUILDER_PROMPT.replace(
      /\$PRP_FILE_PATH/g,
      prpPath
    );

    try {
      // CHECKPOINT: Pre-execution - before Coder Agent
      const preExecutionState: CheckpointExecutionState = {
        prpPath,
        stage: 'pre-execution',
        validationResults: [],
        timestamp: new Date(),
      };
      await this.#checkpointManager.saveCheckpoint(
        prp.taskId,
        'Before Coder Agent execution',
        preExecutionState
      );

      // STEP 2: Execute Coder Agent with retry logic
      this.#logger.info({ prpTaskId: prp.taskId }, 'Starting PRP execution');
      const coderAgentResponse = await retryAgentPrompt(
        () =>
          this.#coderAgent.prompt(injectedPrompt as unknown as Prompt<unknown>),
        { agentType: 'Coder', operation: 'executePRP' }
      );

      // STEP 3: Extract response content and parse JSON result
      const coderResponse = this.#extractResponseContent(coderAgentResponse);
      const coderResult = this.#parseCoderResult(coderResponse);

      // CHECKPOINT: Coder response - after parsing result
      const coderResponseState: CheckpointExecutionState = {
        prpPath,
        stage: 'coder-response',
        coderResponse,
        coderResult,
        validationResults: [],
        timestamp: new Date(),
      };
      await this.#checkpointManager.saveCheckpoint(
        prp.taskId,
        'After Coder Agent response',
        coderResponseState
      );

      // Branch on the Coder Agent's tri-state result (PRD §4.5). 'issue' = recoverable
      // planning gap (surfaces distinctly for re-planning); 'error' = hard implementation fail.
      if (coderResult.result === 'issue') {
        return {
          success: false,
          outcome: 'issue',
          issueMessage: coderResult.message,
          validationResults: [],
          artifacts: [],
          error: coderResult.message,
          fixAttempts: 0,
        };
      }
      if (coderResult.result === 'error') {
        return {
          success: false,
          outcome: 'fail',
          validationResults: [],
          artifacts: [],
          error: coderResult.message,
          fixAttempts: 0,
        };
      }

      // STEP 4: Run validation gates with fix-and-retry
      let validationResults: ValidationGateResult[] = [];

      while (fixAttempts <= maxFixAttempts) {
        validationResults = await this.#runValidationGates(prp);

        // CHECKPOINT: After each validation gate completion
        if (validationResults.length > 0) {
          const lastGate = validationResults[validationResults.length - 1];
          const validationStage: CheckpointExecutionState['stage'] =
            `validation-gate-${lastGate.level}` as CheckpointExecutionState['stage'];
          const validationState: CheckpointExecutionState = {
            prpPath,
            stage: validationStage,
            coderResponse,
            coderResult,
            validationResults,
            fixAttempt: fixAttempts > 0 ? fixAttempts : undefined,
            timestamp: new Date(),
          };
          await this.#checkpointManager.saveCheckpoint(
            prp.taskId,
            `After validation gate ${lastGate.level}`,
            validationState
          );
        }

        // Check if all gates passed
        const allPassed = validationResults.every(r => r.success || r.skipped);

        if (allPassed) {
          break; // Success!
        }

        // If we have more fix attempts available
        if (fixAttempts < maxFixAttempts) {
          fixAttempts++;
          const delay = Math.min(2000 * Math.pow(2, fixAttempts - 1), 30000);
          this.#logger.warn(
            { prpTaskId: prp.taskId, fixAttempts, maxFixAttempts, delay },
            'Validation failed, retrying'
          );
          await this.#sleep(delay);

          // Trigger fix attempt
          await this.#fixAndRetry(prp, validationResults, fixAttempts);
        } else {
          break; // Exhausted fix attempts
        }
      }

      // STEP 5: Build final result
      const allPassed = validationResults.every(r => r.success || r.skipped);

      // CHECKPOINT: Complete or failed state
      const finalStage: CheckpointExecutionState['stage'] = allPassed
        ? 'complete'
        : 'failed';
      const finalState: CheckpointExecutionState = {
        prpPath,
        stage: finalStage,
        coderResponse,
        coderResult,
        validationResults,
        fixAttempt: fixAttempts > 0 ? fixAttempts : undefined,
        timestamp: new Date(),
      };
      await this.#checkpointManager.saveCheckpoint(
        prp.taskId,
        allPassed ? 'Task completed successfully' : 'Task failed',
        finalState
      );

      return {
        success: allPassed,
        outcome: allPassed ? 'success' : 'fail',
        validationResults,
        artifacts: [], // TODO: Extract artifacts from Coder Agent output
        error: allPassed
          ? undefined
          : 'Validation failed after all fix attempts',
        fixAttempts,
      };
    } catch (error) {
      // CHECKPOINT: Error checkpoint
      const errorState: CheckpointExecutionState = {
        prpPath,
        stage: 'failed',
        validationResults: [],
        timestamp: new Date(),
      };
      await this.#checkpointManager.saveCheckpoint(
        prp.taskId,
        'Error during execution',
        errorState,
        error instanceof Error ? error : undefined
      );

      return {
        success: false,
        outcome: 'fail',
        validationResults: [],
        artifacts: [],
        error: error instanceof Error ? error.message : String(error),
        fixAttempts,
      };
    }
  }

  /**
   * Runs all validation gates from the PRP in sequence
   *
   * @remarks
   * Iterates through validationGates in order by level. Skips manual
   * gates or gates with no command. Stops execution on first failure.
   *
   * @param prp - The PRPDocument containing validation gates
   * @returns Array of ValidationGateResult for each executed gate
   * @private
   */
  async #runValidationGates(prp: PRPDocument): Promise<ValidationGateResult[]> {
    const results: ValidationGateResult[] = [];

    // Sort gates by level to ensure sequential execution
    const sortedGates = [...prp.validationGates].sort(
      (a, b) => a.level - b.level
    );

    for (const gate of sortedGates) {
      // Skip manual gates or gates with no command
      if (gate.manual || gate.command === null) {
        results.push({
          level: gate.level,
          description: gate.description,
          success: true, // Skipped gates count as "passed"
          command: gate.command,
          stdout: '',
          stderr: '',
          exitCode: null,
          skipped: true,
        });
        continue;
      }

      // Execute command via BashMCP
      const result = await this.#bashMCP.execute_bash({
        command: gate.command,
        cwd: this.sessionPath,
        timeout: 120000, // 2 minute timeout for validation commands
      });

      const gateResult: ValidationGateResult = {
        level: gate.level,
        description: gate.description,
        success: result.success,
        command: gate.command,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode ?? null,
        skipped: false,
      };

      results.push(gateResult);

      // Stop sequential execution on first failure
      if (!gateResult.success) {
        this.#logger.error(
          {
            level: gate.level,
            description: gate.description,
            command: gate.command,
            exitCode: result.exitCode,
            stderr: result.stderr,
          },
          'Validation gate failed'
        );
        break;
      }
    }

    return results;
  }

  /**
   * Triggers fix-and-retry by providing error context to Coder Agent
   *
   * @remarks
   * Builds error context from failed validation gates and prompts
   * the Coder Agent to fix the issues. The fix prompt includes specific
   * error details to guide the agent's fix attempt.
   *
   * @param prp - The PRPDocument being executed
   * @param failedGates - Validation gates that failed
   * @param attemptNumber - Current fix attempt number (1 or 2)
   * @private
   */
  async #fixAndRetry(
    prp: PRPDocument,
    failedGates: ValidationGateResult[],
    attemptNumber: number
  ): Promise<void> {
    // Build error context
    const errorContext = failedGates
      .filter(g => !g.success && !g.skipped)
      .map(
        g => `
Level ${g.level}: ${g.description}
Command: ${g.command}
Exit Code: ${g.exitCode}
Output: ${g.stdout}
Error: ${g.stderr}
      `
      )
      .join('\n');

    // Create fix prompt
    const fixPrompt = `
The previous implementation failed validation. Please fix the issues.

PRP Task ID: ${prp.taskId}
Failed Validation Gates:
${errorContext}

Fix Attempt: ${attemptNumber}/2

Please analyze the validation failures and fix the implementation.
Focus on the specific errors reported above.

Output your result in the same JSON format:
{
  "result": "success" | "error" | "issue",
  "message": "Detailed explanation"
}
    `.trim();

    // Execute fix attempt with retry logic
    await retryAgentPrompt(
      () => this.#coderAgent.prompt(fixPrompt as unknown as Prompt<unknown>),
      {
        agentType: 'Coder',
        operation: 'fixValidation',
      }
    );
  }

  /**
   * Parses JSON result from Coder Agent response
   *
   * @remarks
   * Extracts JSON from the Coder Agent response, handling both
   * raw JSON and markdown code block wrapped JSON.
   *
   * @param response - Raw string response from Coder Agent
   * @returns Parsed result object with result and message fields
   * @private
   */
  #parseCoderResult(response: string): ExecuteResult {
    try {
      // Extract JSON from response (may be wrapped in markdown code blocks)
      const jsonMatch = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      const jsonStr = jsonMatch ? jsonMatch[1] : response;

      return JSON.parse(jsonStr);
    } catch (error) {
      // If parsing fails, assume error
      return {
        result: 'error',
        message: `Failed to parse Coder Agent response: ${response}`,
      };
    }
  }

  /**
   * Extracts the response content from AgentResponse
   *
   * @remarks
   * The agent.prompt() method returns AgentResponse<T> where the actual
   * content is in the data property. This method extracts it as a string.
   *
   * @param agentResponse - The AgentResponse from the agent
   * @returns The response content as a string
   * @private
   */
  #extractResponseContent(agentResponse: AgentResponse<unknown>): string {
    if (agentResponse.status === 'success' && agentResponse.data !== null) {
      return typeof agentResponse.data === 'string'
        ? agentResponse.data
        : JSON.stringify(agentResponse.data);
    }
    // For error or partial responses, try to get a string representation
    if (agentResponse.status === 'error') {
      return agentResponse.error?.message ?? 'Unknown error';
    }
    // For partial or null data, return empty string or stringified data
    return agentResponse.data === null
      ? ''
      : JSON.stringify(agentResponse.data);
  }

  /**
   * Sleep utility for delays
   *
   * @param ms - Milliseconds to sleep
   * @returns Promise that resolves after the delay
   * @private
   */
  #sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// PATTERN: Export type for convenience
export type { PRPDocument, ValidationGate };
