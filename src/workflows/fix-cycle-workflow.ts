/**
 * Fix Cycle workflow for iterative bug fixing
 *
 * @module workflows/fix-cycle-workflow
 *
 * @remarks
 * Orchestrates an iterative bug fixing cycle (Fix → Re-test) until no critical
 * or major bugs remain, or max iterations (3) are reached.
 *
 * The workflow runs the standard Architect decomposition on the QA bug report,
 * executes the resulting fix subtasks via TaskOrchestrator, re-tests with
 * BugHuntWorkflow, and repeats until bugs are resolved or max iterations
 * reached.
 *
 * @example
 * ```typescript
 * import { FixCycleWorkflow } from './workflows/fix-cycle-workflow.js';
 *
 * const workflow = new FixCycleWorkflow(sessionPath, prdContent, orchestrator, sessionManager);
 * const results = await workflow.run();
 * console.log(`Final bug count: ${results.bugs.length}`);
 * ```
 */

import { readFile, access, constants } from 'node:fs/promises';
import { resolve } from 'node:path';

import { Workflow, Step } from 'groundswell';
import type { TestResults, Backlog, Task, Subtask } from '../core/models.js';
import { TestResultsSchema } from '../core/models.js';
import type { Logger } from '../utils/logger.js';
import { getLogger } from '../utils/logger.js';
import { TaskOrchestrator } from '../core/task-orchestrator.js';
import { SessionManager } from '../core/session-manager.js';
import { BugHuntWorkflow } from './bug-hunt-workflow.js';
import {
  validateBugfixSession,
  BugfixSessionValidationError,
} from '../utils/validation/session-validation.js';
import { PARALLEL_RESEARCH, RESEARCH_DEPTH } from '../config/constants.js';

/**
 * Fix Cycle workflow class
 *
 * @remarks
 * Orchestrates the bug fix cycle through four phases:
 * 1. Standard Breakdown - Run the standard Architect decomposition on the
 *    bug report (PRD §4.4: TEST_RESULTS.md is a mini-PRD)
 * 2. Execute Fixes - Run fix subtasks via TaskOrchestrator
 * 3. Re-test - Run BugHuntWorkflow to verify fixes
 * 4. Check Completion - Determine if all critical/major bugs are resolved
 *
 * Uses Groundswell Workflow base class with public state fields
 * and @Step decorators for method tracking.
 */
export class FixCycleWorkflow extends Workflow {
  // ========================================================================
  // Public State Fields
  // ========================================================================

  /** Path to bugfix session directory for reading TEST_RESULTS.md */
  sessionPath: string;

  /** Original PRD content for QA context */
  prdContent: string;

  /** Task orchestrator for executing fix tasks */
  taskOrchestrator: TaskOrchestrator;

  /** Session manager for state persistence */
  sessionManager: SessionManager;

  /**
   * Forwarded parallel-research settings for the bugfix child (PRD §4.2
   * "Propagation to Bugfix Sub-Pipeline"). When provided, the bugfix child's
   * shared TaskOrchestrator reads these via isParallelResearch() /
   * getResearchDepth() (live env reads), so the depth-chain prefetch model
   * stays active during fix execution. Null when omitted (legacy callers).
   */
  researchConfig: { parallelResearch: boolean; researchDepth: number } | null =
    null;

  /** Current iteration counter (starts at 0, increments each loop) */
  iteration: number = 0;

  /** Maximum fix iterations (hardcoded to 3 per specification) */
  maxIterations: number = 3;

  /** Latest test results from retest phase */
  currentResults: TestResults | null = null;

  /** Correlation logger with correlation ID for tracing */
  private correlationLogger: Logger;

  // ========================================================================
  // Private Fields
  // ========================================================================

  /** Fix subtasks created from bugs */
  #fixTasks: Subtask[] = [];

  /** Loaded bug report from TEST_RESULTS.md */
  #testResults: TestResults | null = null;

  // ========================================================================
  // Constructor
  // ========================================================================

  /**
   * Creates a new FixCycleWorkflow instance
   *
   * @param sessionPath - Path to bugfix session directory for reading TEST_RESULTS.md
   * @param prdContent - Original PRD content for QA context
   * @param taskOrchestrator - Task orchestrator for executing fix tasks
   * @param sessionManager - Session manager for state persistence
   * @param researchConfig - Optional forwarded parallel-research settings (PRD §4.2)
   * @throws {Error} If sessionPath is not a valid non-empty string
   * @throws {BugfixSessionValidationError} If sessionPath is not a valid bugfix session
   */
  constructor(
    sessionPath: string,
    prdContent: string,
    taskOrchestrator: TaskOrchestrator,
    sessionManager: SessionManager,
    researchConfig?: { parallelResearch: boolean; researchDepth: number }
  ) {
    super('FixCycleWorkflow');

    // Validate inputs
    if (typeof sessionPath !== 'string' || sessionPath.trim() === '') {
      throw new Error('FixCycleWorkflow requires valid sessionPath');
    }

    this.sessionPath = sessionPath;
    this.prdContent = prdContent;
    this.taskOrchestrator = taskOrchestrator;
    this.sessionManager = sessionManager;
    this.researchConfig = researchConfig ?? null;

    // Validate bugfix session path
    this.logger.debug(
      `[FixCycleWorkflow] Validating bugfix session path: ${this.sessionPath}`
    );

    try {
      validateBugfixSession(this.sessionPath);
      this.logger.debug(
        `[FixCycleWorkflow] Bugfix session path validated: ${this.sessionPath}`
      );
    } catch (error) {
      if (error instanceof BugfixSessionValidationError) {
        this.correlationLogger = getLogger('FixCycleWorkflow').child({
          correlationId: 'init-failed',
        });
        this.correlationLogger.error(
          { sessionPath: this.sessionPath, validationError: error.message },
          '[FixCycleWorkflow] Bugfix session validation failed during initialization'
        );
        throw error;
      }

      // Defensive: Handle unexpected error types
      throw new Error(
        'FixCycleWorkflow initialization failed: validation error'
      );
    }

    // PRD §4.2: defensively re-apply forwarded settings to process.env so the
    // shared orchestrator's live reads (isParallelResearch / getResearchDepth)
    // are correct inside the bugfix child. Idempotent: a no-op when the env was
    // already set to these values; a hardening for a future process-isolated
    // bugfix child. Only runs when the caller explicitly forwarded settings.
    if (researchConfig) {
      process.env[PARALLEL_RESEARCH] = researchConfig.parallelResearch
        ? 'true'
        : 'false';
      process.env[RESEARCH_DEPTH] = String(researchConfig.researchDepth);
      this.logger.debug(
        '[FixCycleWorkflow] Forwarded parallel-research settings applied to env',
        {
          parallelResearch: researchConfig.parallelResearch,
          researchDepth: researchConfig.researchDepth,
        }
      );
    }

    // Create correlation logger with correlation ID
    const correlationId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    this.correlationLogger = getLogger('FixCycleWorkflow').child({
      correlationId,
    });

    this.logger.info('[FixCycleWorkflow] Initialized', {
      sessionPath: sessionPath,
      maxIterations: this.maxIterations,
    });
    this.correlationLogger.info('[FixCycleWorkflow] Initialized', {
      correlationId,
      sessionPath: sessionPath,
      maxIterations: this.maxIterations,
    });
  }

  // ========================================================================
  // Phase 1: Create Fix Tasks
  // ========================================================================

  /**
   * Phase 1: Standard Architect breakdown of the bug report (PRD §4.4).
   *
   * @remarks
   * PRD §4.4 mandates that the bug-fix cycle treat `TEST_RESULTS.md` as a
   * mini-PRD and run the **standard full task breakdown** (the same
   * Phase→Milestone→Task→Subtask decomposition a main session uses) — there is
   * no separate "simplified" bug-fix breakdown mode. This method mirrors
   * `PRPPipeline.decomposePRD()` exactly, MINUS the final backlog persist
   * (the bugfix child SHARES the parent sessionManager — overwriting its
   * registry would corrupt the parent session; the bugfix keeps its OWN
   * `tasks.json` in its dir, written by the architect via `$TASKS_FILE`). The flattened
   * subtasks are stored in `#fixTasks` and executed via `executeFixes()` →
   * `executeSubtask()` (which already runs the two-phase commit + cleanup
   * agent — CONTRACT c holds).
   */
  @Step({ trackTiming: true })
  async runStandardBreakdown(): Promise<void> {
    this.logger.info(
      '[FixCycleWorkflow] Phase 1: Standard Architect breakdown of bug report'
    );

    const testResults = this.currentResults ?? this.#testResults;
    if (!testResults) {
      throw new Error('[FixCycleWorkflow] No test results available');
    }

    // (a) Build the mini-PRD from the QA bug report (PRD §4.4).
    const miniPrd = this.#buildBugFixMiniPrd(testResults);
    this.logger.info(
      `[FixCycleWorkflow] Built bug-fix mini-PRD (${miniPrd.length} chars) from ${testResults.bugs.length} bugs`
    );

    // (b) Standard decomposition: Architect agent over the mini-PRD, writing
    //     tasks.json into THIS bugfix session dir (createArchitectPrompt
    //     substitutes $TASKS_FILE → ${sessionPath}/tasks.json). Mirrors
    //     PRPPipeline.decomposePRD() verbatim, MINUS the backlog persist (the
    //     bugfix shares the parent sessionManager — overwriting its registry
    //     would corrupt the parent session).
    const { createArchitectAgent } = await import('../agents/agent-factory.js');
    const { createArchitectPrompt } =
      await import('../agents/prompts/architect-prompt.js');
    const { retryAgentPrompt } = await import('../utils/retry.js');

    // Create the architect ONCE (not in the retry closure) so every retry
    // inherits the xhigh Reasoning budget (mirrors decomposePRD invariant).
    const architectAgent = createArchitectAgent();
    const architectPrompt = createArchitectPrompt(miniPrd, this.sessionPath);

    this.logger.info('[FixCycleWorkflow] Calling Architect agent...');
    const result = await retryAgentPrompt(
      () => architectAgent.prompt(architectPrompt),
      { agentType: 'Architect', operation: 'decomposeBugReport' }
    );

    // Surface agent-level failures instead of a confusing later ENOENT.
    if (result.status === 'error') {
      const errMsg = result.error?.message ?? 'unknown agent error';
      throw new Error(`Architect agent failed: ${errMsg}`);
    }

    // (c) The FILE is the contract — the architect wrote tasks.json to
    //     ${this.sessionPath}/tasks.json. Read it back and parse as Backlog.
    const tasksPath = resolve(this.sessionPath, 'tasks.json');
    let parsedBacklog: Backlog;
    try {
      const tasksContent = await readFile(tasksPath, 'utf-8');
      parsedBacklog = JSON.parse(tasksContent) as Backlog;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[FixCycleWorkflow] Failed to read/parse bugfix tasks.json at ${tasksPath}: ${msg}`
      );
      throw new Error(
        `Failed to read/parse bugfix tasks.json at ${tasksPath}: ${msg}`
      );
    }

    // (d) Flatten the standard Phase→Milestone→Task→Subtask hierarchy into
    //     dependency-ordered leaf subtasks (standard scope traversal).
    const { resolveScope, parseScope } =
      await import('../core/scope-resolver.js');
    this.#fixTasks = resolveScope(
      parsedBacklog,
      parseScope('all')
    ) as Subtask[];

    this.logger.info(
      `[FixCycleWorkflow] Standard breakdown produced ${this.#fixTasks.length} fix subtasks`
    );
  }

  /**
   * Build a Markdown mini-PRD from the QA bug report so the Architect agent can
   * run the standard Phase→Milestone→Task→Subtask decomposition on it (PRD §4.4:
   * TEST_RESULTS.md is treated as a mini-PRD).
   *
   * @param testResults - The loaded, schema-validated bug report.
   * @returns Markdown framing the bugs as fix requirements.
   * @private
   */
  #buildBugFixMiniPrd(testResults: TestResults): string {
    const lines: string[] = [];
    lines.push('# Bug Fix PRD (Mini-PRD from TEST_RESULTS.md)');
    lines.push('');
    lines.push(
      '> PRD §4.4: the QA bug report is treated as a mini-PRD. Break this'
    );
    lines.push(
      '> down into a standard Phase→Milestone→Task→Subtask hierarchy of fixes.'
    );
    lines.push('');
    lines.push('## Summary');
    lines.push(testResults.summary || '(no summary)');
    lines.push('');
    lines.push('## Bugs to Fix');
    lines.push('');
    for (const bug of testResults.bugs) {
      lines.push(`### ${bug.id} [${bug.severity}]: ${bug.title}`);
      lines.push(`**Description:** ${bug.description}`);
      lines.push(`**Reproduction:** ${bug.reproduction}`);
      lines.push(`**Location:** ${bug.location ?? 'Not specified'}`);
      lines.push('');
    }
    if (testResults.recommendations.length > 0) {
      lines.push('## Recommendations');
      for (const r of testResults.recommendations) {
        lines.push(`- ${r}`);
      }
      lines.push('');
    }
    return lines.join('\n');
  }

  // ========================================================================
  // Phase 2: Execute Fixes
  // ========================================================================

  /**
   * Phase 2: Execute fixes via PRPRuntime
   *
   * Executes all fix tasks using TaskOrchestrator (which internally uses PRPRuntime).
   * Handles failures gracefully - logs error but continues with next fix.
   */
  @Step({ trackTiming: true })
  async executeFixes(): Promise<void> {
    this.logger.info('[FixCycleWorkflow] Phase 2: Executing fixes');

    let successCount = 0;
    let failureCount = 0;

    for (const fixTask of this.#fixTasks) {
      this.logger.info(
        `[FixCycleWorkflow] Executing fix task: ${fixTask.id} - ${fixTask.title}`
      );

      try {
        await this.taskOrchestrator.executeSubtask(fixTask);
        successCount++;
        this.logger.info(
          `[FixCycleWorkflow] Fix task ${fixTask.id} completed successfully`
        );
      } catch (error) {
        failureCount++;
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          `[FixCycleWorkflow] Fix task ${fixTask.id} failed: ${errorMessage}`
        );
        // Don't throw - continue with next fix
        // The retest phase will catch remaining bugs
      }
    }

    this.logger.info('[FixCycleWorkflow] Fixes execution complete', {
      success: successCount,
      failed: failureCount,
      total: this.#fixTasks.length,
    });
  }

  // ========================================================================
  // Phase 3: Re-test
  // ========================================================================

  /**
   * Phase 3: Re-test with BugHuntWorkflow
   *
   * Runs BugHuntWorkflow again to verify fixes.
   * Returns new TestResults with remaining bugs.
   */
  @Step({ trackTiming: true })
  async retest(): Promise<TestResults> {
    this.logger.info('[FixCycleWorkflow] Phase 3: Re-testing after fixes');

    // Extract completed tasks from session
    const completedTasks = this.#extractCompletedTasks();
    this.logger.info(
      `[FixCycleWorkflow] Testing against ${completedTasks.length} completed tasks`
    );

    // Run BugHuntWorkflow — pass sessionPath so it uses file-as-contract
    // (without it, the bug-hunt falls back to responseFormat and fails with
    // VALIDATION_ERROR on reasoning models that return prose instead of JSON)
    const bugHuntWorkflow = new BugHuntWorkflow(
      this.prdContent,
      completedTasks
    );
    const results = await bugHuntWorkflow.run(this.sessionPath);

    // Store results
    this.currentResults = results;

    // Log results
    this.logger.info('[FixCycleWorkflow] Re-test complete', {
      bugsFound: results.bugs.length,
      hasBugs: results.hasBugs,
      summary: results.summary,
    });

    return results;
  }

  // ========================================================================
  // Phase 4: Check Completion
  // ========================================================================

  /**
   * Phase 4: Check completion
   *
   * Returns true if no critical or major bugs remain.
   * Minor and cosmetic bugs are acceptable.
   */
  @Step({ trackTiming: true })
  async checkComplete(): Promise<boolean> {
    if (!this.currentResults) {
      return false;
    }

    const hasCriticalOrMajor = this.currentResults.bugs.some(
      bug => bug.severity === 'critical' || bug.severity === 'major'
    );

    this.logger.info('[FixCycleWorkflow] Completion check', {
      complete: !hasCriticalOrMajor,
      criticalOrMajorBugs: this.currentResults.bugs.filter(
        b => b.severity === 'critical' || b.severity === 'major'
      ).length,
    });

    return !hasCriticalOrMajor;
  }

  // ========================================================================
  // Main Fix Cycle Loop
  // ========================================================================

  /**
   * Run the complete fix cycle workflow
   *
   * Loops until:
   * - No critical/major bugs remain, OR
   * - Max iterations (3) reached
   *
   * @returns Final TestResults after fix cycle
   */
  async run(): Promise<TestResults> {
    this.setStatus('running');
    this.correlationLogger.info(
      '[FixCycleWorkflow] Starting fix cycle workflow'
    );
    this.logger.info('[FixCycleWorkflow] Starting fix cycle workflow');

    // Load bug report from TEST_RESULTS.md
    this.#testResults = await this.#loadBugReport();
    this.logger.debug(`Loaded TEST_RESULTS.md from ${this.sessionPath}`);

    this.logger.info(
      `[FixCycleWorkflow] Initial bug count: ${this.#testResults.bugs.length}`
    );

    try {
      while (this.iteration < this.maxIterations) {
        // Increment iteration counter
        this.iteration++;

        this.logger.info(
          `[FixCycleWorkflow] ========== Iteration ${this.iteration}/${this.maxIterations} ==========`
        );

        // Phase 1: Standard Architect breakdown of the bug report (PRD §4.4)
        await this.runStandardBreakdown();

        // Phase 2: Execute fixes
        await this.executeFixes();

        // Phase 3: Re-test
        await this.retest();

        // Phase 4: Check completion
        const complete = await this.checkComplete();

        if (complete) {
          this.logger.info(
            '[FixCycleWorkflow] All critical/major bugs resolved - fix cycle complete'
          );
          break;
        }

        this.logger.info(
          `[FixCycleWorkflow] Iteration ${this.iteration} complete - ${this.currentResults?.bugs.length ?? 0} bugs remain`
        );
      }

      // Check if max iterations reached
      if (
        this.iteration >= this.maxIterations &&
        (this.currentResults?.bugs.length ?? 0) > 0
      ) {
        this.logger.warn(
          `[FixCycleWorkflow] Max iterations (${this.maxIterations}) reached`
        );
        this.logger.warn(
          `[FixCycleWorkflow] ${this.currentResults?.bugs.length ?? 0} bugs remaining`
        );
      }

      this.setStatus('completed');

      // Return final results
      return this.currentResults ?? this.#testResults!;
    } catch (error) {
      this.setStatus('failed');
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`[FixCycleWorkflow] Fix cycle failed: ${errorMessage}`);
      throw error;
    }
  }

  // ========================================================================
  // Test-Only Helpers
  // ========================================================================

  /**
   * Test-only getter for fix tasks
   *
   * @returns Array of fix subtasks created from bugs
   * @internal
   */
  get _fixTasksForTesting(): Subtask[] {
    return this.#fixTasks;
  }

  /**
   * Test-only getter for loadBugReport method
   *
   * @returns Bound loadBugReport method that also stores results in this.#testResults
   * @internal
   */
  get _loadBugReportForTesting(): () => Promise<TestResults> {
    const loadAndStore = async (): Promise<TestResults> => {
      const results = await this.#loadBugReport();
      this.#testResults = results;
      return results;
    };
    return loadAndStore.bind(this);
  }

  // ========================================================================
  // Helper Methods
  // ========================================================================

  /**
   * Extract completed tasks from session backlog
   *
   * @returns Array of completed Task objects
   * @private
   */
  #extractCompletedTasks(): Task[] {
    const backlog = this.sessionManager.currentSession?.taskRegistry;
    if (!backlog) {
      this.logger.warn('[FixCycleWorkflow] No session backlog found');
      return [];
    }

    const completedTasks: Task[] = [];

    for (const phase of backlog.backlog) {
      for (const milestone of phase.milestones) {
        for (const task of milestone.tasks) {
          if (task.status === 'Complete') {
            completedTasks.push(task);
          }
        }
      }
    }

    return completedTasks;
  }

  /**
   * Load bug report from TEST_RESULTS.md in session directory
   *
   * @returns Parsed and validated TestResults object
   * @throws {Error} If TEST_RESULTS.md not found or contains invalid data
   * @private
   */
  async #loadBugReport(): Promise<TestResults> {
    const resultsPath = resolve(this.sessionPath, 'TEST_RESULTS.md');

    this.correlationLogger.info('[FixCycleWorkflow] Loading bug report', {
      resultsPath,
    });

    // Check file existence
    try {
      await access(resultsPath, constants.F_OK);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        throw new Error(`TEST_RESULTS.md not found at ${resultsPath}`);
      }
      throw new Error(
        `Failed to access TEST_RESULTS.md at ${resultsPath}: ${err.message}`
      );
    }

    // Read file content
    let content: string;
    try {
      content = await readFile(resultsPath, 'utf-8');
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error('[FixCycleWorkflow] Failed to read TEST_RESULTS.md', {
        resultsPath,
        error: errorMessage,
      });
      throw new Error(
        `Failed to read TEST_RESULTS.md at ${resultsPath}: ${errorMessage}`
      );
    }

    // Parse JSON
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error('[FixCycleWorkflow] Failed to parse TEST_RESULTS.md', {
        resultsPath,
        error: errorMessage,
      });
      throw new Error(
        `Failed to parse TEST_RESULTS.md at ${resultsPath}: ${errorMessage}`
      );
    }

    // Validate with Zod
    try {
      const validated = TestResultsSchema.parse(parsed) as TestResults;
      this.correlationLogger.info('[FixCycleWorkflow] Bug report loaded', {
        resultsPath,
        hasBugs: validated.hasBugs,
        bugCount: validated.bugs.length,
      });
      return validated;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        '[FixCycleWorkflow] Invalid TestResults in TEST_RESULTS.md',
        {
          resultsPath,
          error: errorMessage,
        }
      );
      throw new Error(
        `Invalid TestResults in TEST_RESULTS.md at ${resultsPath}: ${errorMessage}`
      );
    }
  }
}
