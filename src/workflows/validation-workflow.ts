/**
 * Validation workflow — generates + runs `validate.sh` (PRD §4.4 step 1)
 *
 * @module workflows/validation-workflow
 *
 * @remarks
 * Implements the **Validation Scripting** stage of PRD §4.4 ("The QA & Bug
 * Hunt Loop", step 1):
 *
 * 1. **Phase 1 — generateScript()**: the reasoning-tier agent
 *    (VALIDATION_AGENT, default `pizr` — realized at runtime by
 *    {@link createQAAgent}) AUTHORS a deterministic, exit-code-driven
 *    `validate.sh` from the PRD + the codebase's real tooling. Uses the
 *    FILE-AS-CONTRACT pattern (mirrors {@link BugHuntWorkflow.generateReport}):
 *    the agent WRITES the script to `${sessionPath}/validate.sh`; the workflow
 *    reads it back and verifies it is non-empty.
 *
 * 2. **Phase 2 — runScript()**: the PIPELINE runs `bash <abs>/validate.sh` via
 *    `BashMCP.execute_bash` at the PROJECT ROOT (`process.cwd()`) under
 *    `VALIDATION_TIMEOUT` (seconds → milliseconds). The exit code is observed
 *    deterministically — the execution is NOT retried (retrying a failing/hanging
 *    validate.sh would mask the abort). A watchdog kill surfaces as EITHER
 *    `result.timedOut === true` (Node watchdog) OR `result.exitCode === 124`
 *    (`timeout` coreutil inside the script); BOTH are terminal per PRD §9.3.2.
 *
 * The pipeline's `#runValidation()` consumes the returned {@link ValidationOutcome};
 * on `!success` it throws a {@link ValidationFailedError} (carrying
 * `timedOut`/`exitCode`) so {@link isWatchdogKillResult} classifies watchdog
 * kills as terminal and the run aborts BEFORE bug-hunt (PRD §4.4).
 *
 * @example
 * ```typescript
 * import { ValidationWorkflow } from './workflows/validation-workflow.js';
 *
 * const workflow = new ValidationWorkflow(prdContent, process.cwd());
 * const outcome = await workflow.run(sessionPath);
 * if (!outcome.success) {
 *   // pipeline throws ValidationFailedError → run() aborts before bug-hunt
 * }
 * ```
 */

import { Workflow, Step } from 'groundswell';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { createQAAgent } from '../agents/agent-factory.js';
import { createValidationPrompt } from '../agents/prompts/validation-prompt.js';
import { retryAgentPrompt } from '../utils/retry.js';
import { BashMCP } from '../tools/bash-mcp.js';
import {
  getValidationAgent,
  getValidationTimeoutSeconds,
  getReasoningValidation,
} from '../config/constants.js';
import type { Logger } from '../utils/logger.js';
import { getLogger } from '../utils/logger.js';
import { toErrorMessage } from '../utils/errors.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Outcome of running `validate.sh` (PRD §4.4 step 1).
 *
 * @remarks
 * Produced by {@link ValidationWorkflow.runScript}. The pipeline inspects
 * {@link ValidationOutcome.success} to decide abort vs. proceed, and
 * {@link ValidationOutcome.timedOut}/{@link ValidationOutcome.exitCode} to
 * classify watchdog kills as terminal (PRD §9.3.2).
 */
export interface ValidationOutcome {
  /** True iff `exitCode === 0 && !timedOut` (validation passed). */
  readonly success: boolean;
  /** Exit code of `bash validate.sh` (null only if the process failed to spawn). */
  readonly exitCode: number | null;
  /**
   * True iff a watchdog killed validation — EITHER the Node watchdog
   * (`exitCode` 137/143, `BashToolResult.timedOut === true`) OR a `timeout`
   * coreutil inside the script (`exitCode` 124, `timedOut === false`).
   * Terminal per PRD §9.3.2 — never retried.
   */
  readonly timedOut: boolean;
  /** Captured stdout of validate.sh. */
  readonly stdout: string;
  /** Captured stderr of validate.sh. */
  readonly stderr: string;
  /** Absolute path to the generated validate.sh. */
  readonly scriptPath: string;
  /** Wall-clock duration of the validate.sh run in ms. */
  readonly durationMs: number;
}

/**
 * Error thrown by the pipeline when validation fails (PRD §4.4 "Abort-on-failure").
 *
 * @remarks
 * Carries `timedOut`/`exitCode` so {@link isWatchdogKillResult}
 * (`src/utils/retry.ts`) classifies a watchdog kill as terminal (→
 * `isPermanentError` → never retried by `retryAgentPrompt`). Non-watchdog
 * failures are plain aborts: `run()` returns a failure result without
 * reaching bug-hunt.
 */
export class ValidationFailedError extends Error {
  /** True iff this failure was a watchdog kill (terminal, PRD §9.3.2). */
  readonly timedOut: boolean;
  /** Exit code of the failed validate.sh run. */
  readonly exitCode: number | null;

  /**
   * @param outcome - The failing {@link ValidationOutcome} that triggered the abort.
   */
  constructor(outcome: ValidationOutcome) {
    const watchdog = outcome.timedOut || outcome.exitCode === 124;
    const kind = watchdog
      ? 'watchdog-killed (terminal, never retried — PRD §9.3.2)'
      : `non-zero exit (exitCode ${outcome.exitCode})`;
    super(
      `Validation failed — ${kind}. Aborting before bug-hunt (PRD §4.4). ` +
        `script=${outcome.scriptPath}`
    );
    this.name = 'ValidationFailedError';
    this.timedOut = watchdog;
    this.exitCode = outcome.exitCode;
  }
}

// ============================================================================
// Workflow
// ============================================================================

/**
 * Validation workflow (PRD §4.4 step 1).
 *
 * @remarks
 * Mirrors {@link BugHuntWorkflow}'s class shape (extends {@link Workflow},
 * public state fields, correlation logger, `run(sessionPath)`). Phase 1
 * (`generateScript`) is a FILE-AS-CONTRACT LLM authoring call (retried via
 * `retryAgentPrompt`); Phase 2 (`runScript`) is a DETERMINISTIC bash execution
 * observed for exit code (NOT retried — the abort is the intended outcome of a
 * non-zero exit).
 */
export class ValidationWorkflow extends Workflow {
  // ========================================================================
  // Public State Fields (observable via Groundswell Workflow base)
  // ========================================================================

  /** Original (pre-merged) PRD content used to author validate.sh. */
  prdContent: string;

  /** Absolute path to the project root (where the agent discovers tooling + where validate.sh runs). */
  codebasePath: string;

  /** Outcome of the validate.sh run (null until runScript() completes). */
  outcome: ValidationOutcome | null = null;

  /** Session path for the FILE-AS-CONTRACT output (set by run()). */
  private sessionPath?: string;

  /** Correlation logger with correlation ID for tracing. */
  private readonly correlationLogger: Logger;

  // ========================================================================
  // Constructor
  // ========================================================================

  /**
   * Creates a new ValidationWorkflow instance.
   *
   * @param prdContent - The pre-merged PRD content to author validate.sh against.
   * @param codebasePath - Absolute path to the project root (toolchain discovery + run cwd).
   * @throws {Error} If `prdContent` is empty/not a string, or `codebasePath` is empty.
   */
  constructor(prdContent: string, codebasePath: string) {
    super('ValidationWorkflow');

    // PATTERN: Input validation in constructor
    if (typeof prdContent !== 'string' || prdContent.trim() === '') {
      throw new Error('prdContent must be a non-empty string');
    }
    if (typeof codebasePath !== 'string' || codebasePath.trim() === '') {
      throw new Error('codebasePath must be a non-empty string');
    }

    this.prdContent = prdContent;
    this.codebasePath = codebasePath;

    // Create correlation logger with correlation ID
    const correlationId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    this.correlationLogger = getLogger('ValidationWorkflow').child({
      correlationId,
    });

    this.correlationLogger.info('[ValidationWorkflow] Initialized', {
      correlationId,
      prdLength: prdContent.length,
      codebasePath,
      agent: getValidationAgent(),
    });
  }

  // ========================================================================
  // Step Methods
  // ========================================================================

  /**
   * Phase 1: the reasoning agent WRITES `validate.sh` (FILE-AS-CONTRACT).
   *
   * @remarks
   * Mirrors {@link BugHuntWorkflow.generateReport}: `createQAAgent()` →
   * `createValidationPrompt(prd, codebasePath, scriptPath)` →
   * `retryAgentPrompt(() => agent.prompt(prompt))` → agent writes the file →
   * caller reads + verifies it. The GENERATION call is wrapped in
   * `retryAgentPrompt` (transient-LLM retries); the EXECUTION (runScript) is
   * NOT retried (see class docs).
   *
   * @returns Absolute path to the generated validate.sh.
   * @throws {Error} If `sessionPath` is unset, the agent fails to run, or the
   *   written script is missing/empty.
   */
  @Step({ trackTiming: true })
  async generateScript(): Promise<string> {
    this.correlationLogger.info(
      '[ValidationWorkflow] Phase 1: Authoring validate.sh',
      { agent: getValidationAgent() }
    );

    if (this.sessionPath === undefined) {
      throw new Error('sessionPath required (call run(sessionPath))');
    }

    // CRITICAL: ABSOLUTE path so `bash <path>` resolves regardless of cwd.
    const scriptPath = resolve(this.sessionPath, 'validate.sh');

    try {
      // Reasoning resolved per-role per PRD §9.2.9 (validation level — independent of bug-finder).
      const agent = createQAAgent(getReasoningValidation());
      this.correlationLogger.info('[ValidationWorkflow] QA agent created');

      const prompt = createValidationPrompt(
        this.prdContent,
        this.codebasePath,
        scriptPath
      );
      this.correlationLogger.info(
        '[ValidationWorkflow] Validation prompt created (FILE-AS-CONTRACT)',
        { scriptPath }
      );

      // PATTERN: Execute authoring agent with retry logic (transient LLM retries only).
      await retryAgentPrompt(() => agent.prompt(prompt), {
        agentType: 'QA',
        operation: 'generateValidationScript',
      });

      // FILE-AS-CONTRACT: verify the agent wrote a non-empty script.
      const content = await readFile(scriptPath, 'utf8');
      if (content.trim() === '') {
        throw new Error(
          `VALIDATION_AGENT did not write a non-empty validate.sh at ${scriptPath}`
        );
      }

      this.correlationLogger.info(
        '[ValidationWorkflow] validate.sh authored successfully',
        { scriptPath, bytes: content.length }
      );

      return scriptPath;
    } catch (error) {
      const errorMessage = toErrorMessage(error);
      this.correlationLogger.error(
        '[ValidationWorkflow] Failed to author validate.sh',
        { error: errorMessage, scriptPath }
      );
      throw new Error(`validate.sh generation failed: ${errorMessage}`);
    }
  }

  /**
   * Phase 2: the PIPELINE runs `validate.sh` under `VALIDATION_TIMEOUT` and
   * observes the exit code + watchdog.
   *
   * @remarks
   * Mirrors `prp-executor.ts #runValidationGates`:
   * `new BashMCP().execute_bash({ command: \`bash <abs>/validate.sh\`,
   * cwd: process.cwd(), timeout: getValidationTimeoutSeconds()*1000 })` then
   * `timedOut: result.timedOut || result.exitCode === 124`.
   *
   * Gotchas honored:
   * - `cwd` is `process.cwd()` (PROJECT ROOT), NOT the session/metadata dir.
   * - `timeout` is in MILLISECONDS (`getValidationTimeoutSeconds()` returns
   *   seconds → multiply by 1000).
   * - The execution is NOT wrapped in `retryAgentPrompt` (the abort is the
   *   intended outcome of a non-zero exit; retrying would mask it).
   *
   * @param scriptPath - Absolute path to the validate.sh to run.
   * @returns The {@link ValidationOutcome} (success / exitCode / timedOut / ...).
   */
  @Step({ trackTiming: true })
  async runScript(scriptPath: string): Promise<ValidationOutcome> {
    // CRITICAL: SECONDS→MS. Do NOT pass raw seconds (a 7.2s budget).
    const timeoutMs = getValidationTimeoutSeconds() * 1000;
    // CRITICAL: cwd = PROJECT ROOT (mirror prp-executor.ts:543). The session
    // dir holds metadata; the implementation under test lives at the root.
    const cwd = process.cwd();

    this.correlationLogger.info(
      '[ValidationWorkflow] Phase 2: Running validate.sh',
      {
        scriptPath,
        cwd,
        timeoutMs,
      }
    );

    const start = Date.now();
    const bashMCP = new BashMCP();
    const result = await bashMCP.execute_bash({
      command: `bash ${scriptPath}`,
      cwd,
      timeout: timeoutMs,
    });
    const durationMs = Date.now() - start;

    // CRITICAL: TWO watchdog vectors (both terminal per PRD §9.3.2):
    //   - Node watchdog (executeBashCommand setTimeout → kill) → timedOut:true
    //   - `timeout` coreutil INSIDE the script → exitCode:124, timedOut:false
    const timedOut = result.timedOut || result.exitCode === 124;
    const outcome: ValidationOutcome = {
      success: result.exitCode === 0 && !timedOut,
      exitCode: result.exitCode,
      timedOut,
      stdout: result.stdout,
      stderr: result.stderr,
      scriptPath,
      durationMs,
    };

    this.outcome = outcome;

    this.correlationLogger.info('[ValidationWorkflow] validate.sh complete', {
      success: outcome.success,
      exitCode: outcome.exitCode,
      timedOut: outcome.timedOut,
      durationMs,
    });

    return outcome;
  }

  // ========================================================================
  // Main Entry Point
  // ========================================================================

  /**
   * Runs the complete validation workflow: author validate.sh, then run it.
   *
   * @param sessionPath - Absolute path to the session directory (where
   *   validate.sh is written + read back).
   * @returns The {@link ValidationOutcome}. Callers (the pipeline) inspect
   *   `outcome.success` and throw {@link ValidationFailedError} on failure.
   * @throws {Error} If authoring fails (agent error / missing script).
   *
   * @remarks
   * Note: a NON-ZERO validate.sh exit does NOT throw here — it returns an
   * outcome with `success: false`. The PIPELINE (`#runValidation`) decides to
   * abort by throwing {@link ValidationFailedError}. This separation keeps the
   * workflow a pure observer of the exit code and lets the pipeline own the
   * abort policy (PRD §4.4).
   */
  async run(sessionPath: string): Promise<ValidationOutcome> {
    this.setStatus('running');
    this.sessionPath = sessionPath;
    this.correlationLogger.info(
      '[ValidationWorkflow] Starting validation workflow'
    );

    try {
      const scriptPath = await this.generateScript();
      const outcome = await this.runScript(scriptPath);

      this.setStatus('completed');
      this.correlationLogger.info(
        '[ValidationWorkflow] Validation workflow completed',
        { success: outcome.success, exitCode: outcome.exitCode }
      );

      return outcome;
    } catch (error) {
      // PATTERN: Set status to failed on error
      this.setStatus('failed');
      const errorMessage = toErrorMessage(error);
      this.correlationLogger.error(
        '[ValidationWorkflow] Validation workflow failed',
        { error: errorMessage }
      );
      throw error;
    }
  }
}
