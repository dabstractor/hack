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
import { isNegatedFileExistenceGate } from './gate-semantics.js';
import { z } from 'zod';
import { getLogger } from '../utils/logger.js';
import type { Logger } from '../utils/logger.js';
import { createPrompt } from 'groundswell';
import type { Agent, AgentResponse } from 'groundswell';
import type { PRPDocument, ValidationGate } from '../core/models.js';
import { BashMCP } from '../tools/bash-mcp.js';
import { retryAgentPrompt, withAgentDeadline } from '../utils/retry.js';
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
  /**
   * True iff this gate was killed by a watchdog — either the Node watchdog
   * (`result.timedOut === true`, exitCode 137/143) or the `timeout` coreutil
   * (`result.exitCode === 124`). Terminal: the fix-and-retry loop MUST abort
   * on this (PRD §9.3.2; P3.M2.T2.S2) — a hung process will simply re-hang,
   * so churning fix-retries is wrong.
   */
  readonly timedOut: boolean;
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
  /**
   * True iff the agent returned a response with NO parseable JSON result
   * envelope (prose / non-JSON) — a transport/contract miss, not a genuine
   * agent-reported error. Drives the format-nudge recovery loop (PRD §4.5.1).
   * Only set by #parseCoderResult's catch path; never present on a real envelope.
   */
  formatFailure?: boolean;
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

    // STEP 1: Build a Prompt with the PRP path injected. The prompt must be a
    // real Prompt object (with buildUserMessage()), not a bare string — the
    // prior cast `as unknown as Prompt<unknown>` hid a runtime TypeError.
    // PRP_BUILDER_PROMPT is the coder agent's SYSTEM prompt (set in
    // createCoderAgent); the USER message just names the PRP file to read.
    const injectedPrompt = createPrompt({
      user: `Execute the PRP located at: ${prpPath}\n\nRead it with your file tools, then implement it following your system instructions.`,
      responseFormat: z.unknown(),
    });

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
        () => withAgentDeadline(this.#coderAgent.prompt(injectedPrompt)),
        { agentType: 'Coder', operation: 'executePRP' }
      );

      // STEP 3: Extract response content and parse JSON result
      let coderResponse = this.#extractResponseContent(coderAgentResponse);
      let coderResult = this.#parseCoderResult(coderResponse);

      // STEP 3a: Format-nudge recovery (PRD §4.5.1). If the Coder Agent returned
      // prose / a non-JSON response instead of the required result envelope,
      // nudge it in place with a format reminder and re-prompt — right then and
      // there, before any validation gate runs. Bounded; on exhaustion the parse
      // failure surfaces as a normal 'error'. This budget is separate from the
      // validation maxFixAttempts and from ISSUE_RETRY_MAX.
      let formatNudges = 0;
      const maxFormatNudges = 2;
      while (
        coderResult.formatFailure === true &&
        formatNudges < maxFormatNudges
      ) {
        formatNudges++;
        this.#logger.warn(
          { prpTaskId: prp.taskId, formatNudges, maxFormatNudges },
          'Coder Agent response had no parseable JSON result envelope — sending format nudge (PRD §4.5.1)'
        );
        const nudgeResponse = await this.#nudgeForFormat(
          prp,
          formatNudges,
          maxFormatNudges,
          coderResponse
        );
        coderResponse = this.#extractResponseContent(nudgeResponse);
        coderResult = this.#parseCoderResult(coderResponse);
      }

      // Still unparseable after nudges: surface a clear terminal message. The
      // underlying result is already 'error' with formatFailure set; this just
      // replaces the raw parse-error text with something that says why.
      if (coderResult.formatFailure === true) {
        coderResult = {
          result: 'error',
          formatFailure: true,
          message: `Coder Agent did not return a parseable JSON result envelope after ${formatNudges} format nudge(s) (PRD §4.5.1). Last response: ${coderResponse.slice(0, 300)}`,
        };
      }

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

        // Terminal abort: a watchdog-killed gate must NOT be fix-retried
        // (PRD §9.3.2 + Req 4.4). A hung process will simply re-hang, so
        // invoking #fixAndRetry (an LLM call) + re-running the same hung
        // command is wrong. Break → existing allPassed=false → outcome:'fail'.
        const watchdogKilled = validationResults.some(r => r.timedOut);
        if (watchdogKilled) {
          this.#logger.error(
            { prpTaskId: prp.taskId },
            'Validation gate watchdog-killed (exit 124 / timedOut) — aborting without fix-retry (PRD §9.3.2)'
          );
          break;
        }

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
        // Artifacts list is intentionally empty: the executor does not parse
        // file paths out of the Coder Agent's free-form output. The files
        // themselves land on disk via the session's task workspace
        // (architecture/, prps/, artifacts/); this field is reserved for a
        // future structured-output contract.
        artifacts: [],
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
          timedOut: false,
        });
        continue;
      }

      // G2.1 (PRD §9.9): neutralize non-monotonic negated file/directory-
      // existence gates. File existence is owned by the task graph / is a cleanup
      // step, not a terminal-state assertion, so a `! test -f X` gate can fail
      // spuriously when X legitimately exists from another task's completed work
      // (cached/legacy PRPs). Skip+log rather than hard-fail. (Negated content
      // `! grep …` and ambiguous commands are NOT matched — they execute normally;
      // the detector is conservative per G2.2/G2.3.) Result shape mirrors the
      // manual/null skip so the existing `allPassed = every(r => r.success ||
      // r.skipped)` aggregation is unchanged.
      if (isNegatedFileExistenceGate(gate.command)) {
        this.#logger.info(
          {
            level: gate.level,
            description: gate.description,
            command: gate.command,
          },
          'non-monotonic negative-existence gate neutralized — file existence is owned by the task graph / is a cleanup step, not a terminal-state assertion (§9.9)'
        );
        results.push({
          level: gate.level,
          description: gate.description,
          success: true,
          command: gate.command,
          stdout: '',
          stderr: '',
          exitCode: null,
          skipped: true,
          timedOut: false,
        });
        continue;
      }

      // PRP gates are commonly authored as `<realCmd> 2>&1 | grep -q 'MARKER'`.
      // Running that verbatim swallows ALL output (grep consumes it), so a
      // failure records stdout='' / stderr='' and the coder is BLIND to why its
      // code failed — observed churning a loadable, near-correct module to
      // exhaustion because the gate's Lua assertion error was piped into grep
      // and discarded. Detect that pattern and instead run <realCmd> directly,
      // capture its full output, and check for the marker ourselves — so a
      // failure surfaces the real error to the fix-and-retry loop + artifacts.
      const pipeIdx = gate.command.lastIndexOf('|');
      const afterPipe =
        pipeIdx >= 0 ? gate.command.slice(pipeIdx + 1).trim() : '';
      const isGrepGate =
        /^grep\b/.test(afterPipe) && /(^|\s)-q\S*/.test(afterPipe);
      const markerMatch = afterPipe.match(
        /-q\S*\s+(?:--\s*)?["']?([^"'\s]+)["']?\s*$/
      );
      let result;
      if (isGrepGate && markerMatch) {
        const realCmd = gate.command
          .slice(0, pipeIdx)
          .replace(/\s*2>&1\s*$/, '')
          .trim();
        const marker = markerMatch[1];
        const raw = await this.#bashMCP.execute_bash({
          command: realCmd,
          cwd: process.cwd(),
          timeout: 120000,
        });
        const combined = `${raw.stdout}\n${raw.stderr}`.trim();
        const matched = combined.includes(marker);
        result = {
          success: matched,
          stdout: matched ? marker : combined.slice(0, 4000),
          stderr: matched ? '' : combined,
          exitCode: matched ? 0 : (raw.exitCode ?? 1),
          timedOut: raw.timedOut ?? false,
          error: raw.error,
        };
      } else {
        result = await this.#bashMCP.execute_bash({
          command: gate.command,
          cwd: process.cwd(),
          timeout: 120000, // 2 minute timeout for validation commands
        });
      }

      const gateResult: ValidationGateResult = {
        level: gate.level,
        description: gate.description,
        success: result.success,
        command: gate.command,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode ?? null,
        skipped: false,
        timedOut: result.timedOut || result.exitCode === 124,
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

    // Create fix prompt (a real Prompt object — the coder agent needs
    // buildUserMessage(); a bare string throws at runtime).
    const fixPrompt = createPrompt({
      user: `
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
    `.trim(),
      responseFormat: z.unknown(),
    });

    // Execute fix attempt with retry logic
    await retryAgentPrompt(() => this.#coderAgent.prompt(fixPrompt), {
      agentType: 'Coder',
      operation: 'fixValidation',
    });
  }

  /**
   * Re-prompts the Coder Agent for its result envelope when the prior response
   * was unparseable (PRD §4.5.1).
   *
   * @remarks
   * A transport/contract recovery, NOT a code fix: the agent already did (or
   * attempted) its work and simply failed to emit the required JSON tail. Shows
   * the agent the truncated bad response, restates the envelope contract, and
   * asks for ONLY the envelope — no re-implementation.
   *
   * @param prp - The PRPDocument being executed (task id is cited in the prompt).
   * @param attemptNumber - Current nudge attempt (1-based).
   * @param maxAttempts - Nudge budget ceiling.
   * @param lastResponse - The unparseable response the agent just produced.
   * @returns The Coder Agent's nudge response (caller re-extracts/re-parses).
   * @private
   */
  async #nudgeForFormat(
    prp: PRPDocument,
    attemptNumber: number,
    maxAttempts: number,
    lastResponse: string
  ): Promise<AgentResponse<unknown>> {
    const trimmed =
      lastResponse.length > 500
        ? `${lastResponse.slice(0, 500)}…`
        : lastResponse;

    const nudgePrompt = createPrompt({
      user: `
Your previous response could not be parsed — it did not contain the required JSON result object, so the pipeline cannot tell whether you succeeded.

PRP Task ID: ${prp.taskId}
Format Nudge: ${attemptNumber}/${maxAttempts}

Your last response (truncated) was:
"""
${trimmed}
"""

The LAST content of your reply must be the result envelope and NOTHING must follow it — no narration, no trailing prose, no apology. Emit exactly this JSON (inside a \`\`\`json fence or as bare JSON), with a real value:

\`\`\`json
{
  "result": "success" | "error" | "issue",
  "message": "Detailed explanation"
}
\`\`\`

- "success" — you implemented the PRP and it is ready for validation.
- "error"  — a hard implementation failure you cannot resolve.
- "issue"  — a recoverable planning gap (the PRP is insufficient/ambiguous); explain what is missing.

Do NOT repeat or redo your implementation. If your work is already complete, simply emit the result envelope that describes the outcome. Respond now with ONLY the result envelope.
      `.trim(),
      responseFormat: z.unknown(),
    });

    return retryAgentPrompt(
      () => withAgentDeadline(this.#coderAgent.prompt(nudgePrompt)),
      { agentType: 'Coder', operation: 'nudgeFormat' }
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
      // Parsing failed: the agent returned prose / no envelope. Flag distinctly
      // from a genuine agent-reported 'error' so the format-nudge recovery
      // (PRD §4.5.1) can re-prompt for the envelope instead of hard-failing.
      return {
        result: 'error',
        formatFailure: true,
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
