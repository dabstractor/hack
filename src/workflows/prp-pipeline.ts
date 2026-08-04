/**
 * PRP Pipeline workflow for complete PRD implementation
 *
 * @module workflows/prp-pipeline
 *
 * @remarks
 * Orchestrates the complete PRP Pipeline lifecycle:
 * 1. Session Initialization: Detect existing or create new session
 * 2. PRD Decomposition: Generate task backlog via Architect agent
 * 3. Backlog Execution: Process all tasks via TaskOrchestrator
 * 4. QA Cycle: Run bug hunt if all tasks complete
 *
 * Uses Groundswell Workflow decorators for observability:
 * - @ObservedState: Tracks session, orchestrator, phase, task counts
 * - @Step: Tracks timing and snapshots for each phase
 *
 * @example
 * ```typescript
 * const pipeline = new PRPPipeline('./PRD.md');
 * const result = await pipeline.run();
 * console.log(`Completed ${result.completedTasks}/${result.totalTasks} tasks`);
 * ```
 */

import { Workflow, Step } from 'groundswell';
import type { SessionManager } from '../core/session-manager.js';
import type { TaskOrchestrator } from '../core/task-orchestrator.js';
import type { PRPRuntime } from '../agents/prp-runtime.js';
import type {
  Backlog,
  Status,
  DeltaAnalysis,
  Task,
  TestResults,
} from '../core/models.js';
import { BacklogReadSchema } from '../core/models.js';
import type { Scope } from '../core/scope-resolver.js';
import type { Logger } from '../utils/logger.js';
import { getLogger } from '../utils/logger.js';
import {
  SessionError,
  isPipelineError,
  isFatalError,
  toErrorMessage,
} from '../utils/errors.js';
import {
  validateNestedExecution,
  isNestedExecutionError,
} from '../utils/validation/execution-guard.js';
import { SessionManager as SessionManagerClass } from '../core/session-manager.js';
import {
  resolvePRD,
  hashPRD,
  hashPRDContent,
  readTasksJSON,
  writePendingDeltaHash,
  clearPendingDeltaHash,
  refreshSnapshotToCurrentPRD,
  renderDeltaPRD,
  writeDeltaPRD,
  loadDeltaPRD,
  nextBugfixDir,
} from '../core/session-utils.js';
import { TaskOrchestrator as TaskOrchestratorClass } from '../core/task-orchestrator.js';
import { DeltaAnalysisWorkflow } from './delta-analysis-workflow.js';
import { BugHuntWorkflow } from './bug-hunt-workflow.js';
import {
  ValidationWorkflow,
  ValidationFailedError,
} from './validation-workflow.js';
import { FixCycleWorkflow } from './fix-cycle-workflow.js';
import { isParallelResearch, getResearchDepth } from '../config/constants.js';
import { patchBacklog } from '../core/task-patcher.js';
import { mergeBacklogs } from '../core/backlog-merger.js';
import {
  classifyChangeWithRetry,
  classifyArtifactWithRetry,
} from '../core/change-classifier.js';
import { filterByStatus } from '../utils/task-utils.js';
import { progressTracker, type ProgressTracker } from '../utils/progress.js';
import { ProgressDisplay } from '../utils/progress-display.js';
import { retryAgentPrompt } from '../utils/retry.js';
import { ResourceMonitor } from '../utils/resource-monitor.js';
import { MetricsCollector } from '../utils/metrics-collector.js';

/**
 * Sentinel thrown by the executeBacklog max-iterations safety guard. Tagged
 * with a unique marker so the inner task-error catch can rethrow it (instead
 * of the default break-and-halt) and let it propagate out of executeBacklog.
 * PRD bugfix Issue 5: the guard was previously a plain `Error` swallowed by
 * the inner catch, making the safety net dead.
 */
class MaxIterationsError extends Error {
  readonly isMaxIterationsError = true;
}

/**
 * Sentinel wrapping a `taskOrchestrator.processNextItem` rejection. Tagged so
 * the outer executeBacklog catch can rethrow it instead of tracking it as a
 * non-fatal failure (PRD bugfix Issue 5): a processNextItem throw indicates an
 * orchestrator-level failure, not an individual subtask failure.
 */
class OrchestratorError extends Error {
  readonly isOrchestratorError = true;
}

/**
 * Result returned by PRPPipeline.run()
 */
export interface PipelineResult {
  /** Whether pipeline completed successfully */
  success: boolean;
  /** Whether any tasks failed during execution */
  hasFailures: boolean;
  /** Path to session directory */
  sessionPath: string;
  /** Total number of subtasks in backlog */
  totalTasks: number;
  /** Number of subtasks completed */
  completedTasks: number;
  /** Number of subtasks that failed */
  failedTasks: number;
  /** Current phase at completion */
  finalPhase: string;
  /** Pipeline execution duration in milliseconds */
  duration: number;
  /** Summary of each phase's status */
  phases: PhaseSummary[];
  /** Number of bugs found by QA (0 if QA not run) */
  bugsFound: number;
  /** Error message if pipeline failed */
  error?: string;
  /** Whether execution was interrupted by shutdown signal */
  shutdownInterrupted: boolean;
  /** Reason for shutdown (if interrupted) */
  shutdownReason?: 'SIGINT' | 'SIGTERM' | 'RESOURCE_LIMIT';
}

/**
 * Summary of a single phase's status
 */
export interface PhaseSummary {
  /** Phase ID (e.g., "P1") */
  id: string;
  /** Phase title */
  title: string;
  /** Phase status */
  status: Status;
  /** Number of milestones in phase */
  totalMilestones: number;
  /** Number of milestones completed */
  completedMilestones: number;
}

/**
 * Error tracking record for failed tasks
 *
 * @remarks
 * Captures complete context about task failures for error reporting.
 * Stored in failedTasks Map keyed by task ID.
 */
interface TaskFailure {
  /** Task ID that failed */
  taskId: string;
  /** Task title */
  taskTitle: string;
  /** Error that caused failure */
  error: Error;
  /** Error code from error hierarchy (if available) */
  errorCode?: string;
  /** Timestamp of failure */
  timestamp: Date;
  /** Phase ID where failure occurred */
  phase?: string;
  /** Milestone ID where failure occurred */
  milestone?: string;
}

/**
 * Main PRP Pipeline workflow
 *
 * @remarks
 * Orchestrates the complete PRP Pipeline lifecycle:
 * 1. Session Initialization: Detect existing or create new session
 * 2. PRD Decomposition: Generate task backlog via Architect agent
 * 3. Backlog Execution: Process all tasks via TaskOrchestrator
 * 4. QA Cycle: Run bug hunt if all tasks complete
 *
 * Uses Groundswell Workflow decorators for observability:
 * - @ObservedState: Tracks session, orchestrator, phase, task counts
 * - @Step: Tracks timing and snapshots for each phase
 */
export class PRPPipeline extends Workflow {
  // ========================================================================
  // Public Observed State Fields (tracked by Groundswell)
  // ========================================================================

  /** Session state manager */
  sessionManager!: SessionManager;

  /** Task execution orchestrator */
  taskOrchestrator!: TaskOrchestrator;

  /** Correlation logger with correlation ID for tracing */
  correlationLogger: Logger;

  /** PRP Runtime for inner loop execution */
  runtime: PRPRuntime | null = null;

  /** Current pipeline phase */
  currentPhase: string = 'init';

  /** Pipeline execution mode */
  mode: 'normal' | 'delta' | 'bug-hunt' | 'validate' = 'normal';

  /**
   * `--accept-prd-changes` (PRD §4.3 step 2): accept PRD edits as the new
   * baseline without generating a delta session. Threaded from the CLI flag.
   */
  private readonly acceptPrdChanges: boolean = false;

  /**
   * `--adopt-prd` (PRD §4.6 Adopt Mode): declare the PRD the source of truth
   * for an already-implemented codebase. Guard rails (no-op if sessions exist,
   * reject empty SESSION_DIR, mkdir -p PLAN_DIR) run in {@link initializeSession}.
   * The baseline seeding (completed tasks.json + .adopted marker +
   * SKIP_EXECUTION_LOOP) is implemented in P5.M1.T1.S2; S1 is intentionally
   * inert on the fresh-project path (flag threaded + guard rails only).
   */
  private readonly adoptPrd: boolean = false;

  /**
   * True after an `--adopt-prd` fresh-project seeding (PRD §4.6). When set,
   * {@link executeBacklog} early-returns so implementation is skipped while
   * validation + bug hunt still run. `decomposePRD` is skipped for free via
   * its existing non-empty-backlog guard once the adopted baseline is seeded
   * into the in-memory task registry.
   */
  private skipExecutionLoop: boolean = false;

  /**
   * Integrate-into-current seam (PRD §4.3 step 2): fold new requirements into
   * the running session's task hierarchy instead of spawning a delta session.
   *
   * @remarks
   * Implemented + unit-tested but its user-facing trigger (a
   * `--integrate-prd-changes` flag or interactive prompt) is deferred to keep
   * this item scoped to the CONTRACT's explicit deliverables. Reachable
   * programmatically via this field for a future CLI trigger.
   */
  private integratePrdChanges: boolean = false;

  /** Total number of subtasks in backlog */
  totalTasks: number = 0;

  /** Number of completed subtasks */
  completedTasks: number = 0;

  /** Whether graceful shutdown has been requested */
  shutdownRequested: boolean = false;

  /** ID of the currently executing task */
  currentTaskId: string | null = null;

  /** Reason for shutdown request */
  shutdownReason: 'SIGINT' | 'SIGTERM' | 'RESOURCE_LIMIT' | null = null;

  // ========================================================================
  // Private Fields
  // ========================================================================

  /** Path to PRD file */
  readonly #prdPath: string;

  /** Optional scope for limiting execution */
  readonly #scope?: Scope;

  /** Cache bypass flag from CLI --no-cache */
  readonly #noCache: boolean;

  /** Continue-on-error flag from CLI --continue-on-error */
  readonly #continueOnError: boolean;

  /** Maximum tasks limit from CLI --max-tasks */
  readonly #maxTasks?: number;

  /** Maximum duration limit from CLI --max-duration (milliseconds) */
  readonly #maxDuration?: number;

  /** Monitoring interval from CLI --monitor-interval (milliseconds) */
  readonly #monitorInterval?: number;

  /** Monitor resources every Nth task from CLI --monitor-task-interval */
  readonly #monitorTaskInterval: number = 1;

  /** Disable resource monitoring from CLI --no-resource-monitor */
  readonly #disableMonitoring: boolean = false;

  /** Custom plan directory for testing (defaults to resolve('plan')) */
  readonly #planDir?: string;

  /** Resource monitor instance */
  #resourceMonitor?: import('../utils/resource-monitor.js').ResourceMonitor;

  /** Whether resource limit was reached */
  #resourceLimitReached: boolean = false;

  /** Map of failed tasks to error context for error reporting */
  #failedTasks: Map<string, TaskFailure> = new Map();

  /** Pipeline start time for duration calculation */
  #startTime: number = 0;

  /** Number of bugs found by QA agent */
  #bugsFound: number = 0;

  /** SIGINT event handler reference */
  #sigintHandler: (() => void) | null = null;

  /** SIGTERM event handler reference */
  #sigtermHandler: (() => void) | null = null;

  /** Counter for duplicate SIGINT (force exit) */
  #sigintCount: number = 0;

  /** Correlation ID for tracing workflow execution */
  readonly #correlationId: string;

  /** Progress tracker for real-time execution metrics */
  #progressTracker?: ProgressTracker;

  /** Progress display for visual progress bars */
  #progressDisplay?: ProgressDisplay;

  /** Progress mode from CLI (auto/always/never) */
  readonly #progressMode: 'auto' | 'always' | 'never' = 'auto';

  /** Parallelism limit for concurrent subtask execution */
  readonly #parallelism: number = 2;

  /** Research queue concurrency limit for parallel PRP generation */
  readonly #researchQueueConcurrency: number = 3;

  /** Max retry attempts for tasks (from CLI) */
  readonly #taskRetry?: number;

  /** Base delay before first retry in ms (from CLI) */
  readonly #retryBackoff?: number;

  /** Disable automatic retry for all tasks (from CLI) */
  readonly #noRetry: boolean = false;

  /** Max retries for batch write failures (from CLI) */
  readonly #flushRetries?: number;

  /** PRP cache TTL in milliseconds (from CLI) */
  readonly #cacheTtl: number = 24 * 60 * 60 * 1000;

  /** PRP compression level (from CLI) */
  readonly #prpCompression: 'off' | 'standard' | 'aggressive' = 'standard';

  /** Optional metrics output path for JSON metrics export */
  readonly #metricsOutputPath?: string;

  /** Metrics collector for performance tracking */
  #metricsCollector?: MetricsCollector;

  // ========================================================================
  // Constructor
  // ========================================================================

  /**
   * Creates a new PRPPipeline instance
   *
   * @param prdPath - Path to PRD markdown file
   * @param scope - Optional scope to limit execution
   * @param mode - Execution mode: 'normal', 'delta', 'bug-hunt', or 'validate' (default: 'normal')
   * @param noCache - Whether to bypass PRP cache (default: false)
   * @param continueOnError - Whether to treat all errors as non-fatal (default: false)
   * @param maxTasks - Maximum number of tasks to execute (optional)
   * @param maxDuration - Maximum execution duration in milliseconds (optional)
   * @param monitorInterval - Resource monitoring polling interval in milliseconds (optional)
   * @param monitorTaskInterval - Monitor resources every Nth task (default: 1)
   * @param disableMonitoring - Completely disable resource monitoring (default: false)
   * @param planDir - Custom plan directory path (defaults to resolve('plan'))
   * @param progressMode - Progress display mode: 'auto', 'always', or 'never' (default: 'auto')
   * @param parallelism - Max concurrent subtasks (1-10, default: 2)
   * @param researchQueueConcurrency - Max concurrent research tasks (1-10, default: 3)
   * @param taskRetry - Max retry attempts for tasks (0-10, default: 3)
   * @param retryBackoff - Base delay before first retry in ms (100-60000, default: 1000)
   * @param noRetry - Disable automatic retry for all tasks (default: false)
   * @param flushRetries - Max retries for batch write failures (0-10, default: 3)
   * @param cacheTtl - PRP cache TTL in milliseconds (default: 24 hours)
   * @param prpCompression - PRP compression level (default: 'standard')
   * @param metricsOutputPath - Optional path for JSON metrics export
   * @throws {Error} If prdPath is empty
   */
  constructor(
    prdPath: string,
    scope?: Scope,
    mode?: 'normal' | 'delta' | 'bug-hunt' | 'validate',
    noCache: boolean = false,
    continueOnError: boolean = false,
    maxTasks?: number,
    maxDuration?: number,
    monitorInterval?: number,
    monitorTaskInterval: number = 1,
    disableMonitoring: boolean = false,
    planDir?: string,
    progressMode: 'auto' | 'always' | 'never' = 'auto',
    parallelism: number = 2,
    researchQueueConcurrency: number = 3,
    taskRetry?: number,
    retryBackoff?: number,
    noRetry: boolean = false,
    flushRetries?: number,
    cacheTtl: number = 24 * 60 * 60 * 1000,
    prpCompression: 'off' | 'standard' | 'aggressive' = 'standard',
    metricsOutputPath?: string,
    acceptPrdChanges: boolean = false,
    adoptPrd: boolean = false
  ) {
    super('PRPPipeline');

    if (!prdPath || prdPath.trim() === '') {
      throw new Error('PRP path cannot be empty');
    }

    // Generate correlation ID for workflow tracing
    this.#correlationId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    this.#prdPath = prdPath;
    this.#scope = scope;
    this.mode = mode ?? 'normal';
    this.#noCache = noCache;
    this.#continueOnError = continueOnError;
    this.#maxTasks = maxTasks;
    this.#maxDuration = maxDuration;
    this.#monitorInterval = monitorInterval;
    this.#monitorTaskInterval = monitorTaskInterval;
    this.#disableMonitoring = disableMonitoring;
    this.#planDir = planDir;
    this.#progressMode = progressMode;
    this.#parallelism = parallelism;
    this.#researchQueueConcurrency = researchQueueConcurrency;
    this.#taskRetry = taskRetry;
    this.#retryBackoff = retryBackoff;
    this.#noRetry = noRetry;
    this.#flushRetries = flushRetries;
    this.#cacheTtl = cacheTtl;
    this.#prpCompression = prpCompression;
    this.#metricsOutputPath = metricsOutputPath;

    // PRD §4.3 "Response Selection" (mid-session changes): when set, the delta
    // workflow accepts PRD edits as the new baseline WITHOUT spawning a delta
    // session (cancels .pending_delta_hash, refreshes prd_snapshot.md, exits
    // idempotently). Threaded from the --accept-prd-changes CLI flag.
    this.acceptPrdChanges = acceptPrdChanges;

    // PRD §4.6 "Adopt Mode": declare the PRD the source of truth for an
    // already-implemented codebase. Threaded from the --adopt-prd CLI flag.
    this.adoptPrd = adoptPrd;

    // SessionManager and TaskOrchestrator will be created in run() to catch initialization errors
    // Using definite assignment assertion (!) in property declarations

    // Create correlation logger with correlation ID
    this.correlationLogger = getLogger('PRPPipeline').child({
      correlationId: this.#correlationId,
    });

    // Create resource monitor if limits specified and monitoring not disabled
    if (disableMonitoring) {
      this.logger.info('[PRPPipeline] Resource monitoring disabled by user');
    } else if (maxTasks || maxDuration) {
      this.#resourceMonitor = new ResourceMonitor({
        maxTasks,
        maxDuration,
        pollingInterval: monitorInterval,
        monitorInterval: monitorTaskInterval,
        lazyEvaluation: true,
        lazyEvaluationThreshold: 0.5,
      });
      this.#resourceMonitor.start();
      this.logger.info('[PRPPipeline] Resource monitoring enabled', {
        maxTasks,
        maxDuration,
        monitorInterval,
        monitorTaskInterval,
      });
    }

    // Setup signal handlers for graceful shutdown
    this.#setupSignalHandlers();
  }

  // ========================================================================
  // Private Methods
  // ========================================================================

  /**
   * Registers SIGINT and SIGTERM handlers for graceful shutdown
   *
   * @remarks
   * - First SIGINT: Sets shutdownRequested flag, current task completes
   * - Second SIGINT: Logs warning (shutdown already in progress)
   * - SIGTERM: Same as SIGINT (sent by kill command)
   *
   * Handlers are removed in cleanup() to prevent memory leaks.
   */
  #setupSignalHandlers(): void {
    // SIGINT handler (Ctrl+C)
    this.#sigintHandler = () => {
      this.#sigintCount++;

      if (this.#sigintCount > 1) {
        this.logger.warn(
          '[PRPPipeline] Duplicate SIGINT received - shutdown already in progress'
        );
        // Future: Could force immediate exit here
        return;
      }

      this.logger.info(
        '[PRPPipeline] SIGINT received, initiating graceful shutdown'
      );
      this.shutdownRequested = true;
      this.shutdownReason = 'SIGINT';
    };

    // SIGTERM handler (kill command)
    this.#sigtermHandler = () => {
      this.logger.info(
        '[PRPPipeline] SIGTERM received, initiating graceful shutdown'
      );
      this.shutdownRequested = true;
      this.shutdownReason = 'SIGTERM';
    };

    // Register handlers
    process.on('SIGINT', this.#sigintHandler);
    process.on('SIGTERM', this.#sigtermHandler);

    this.logger.debug('[PRPPipeline] Signal handlers registered');
  }

  /**
   * Tracks a task failure in the failedTasks Map
   *
   * @param taskId - ID of the task that failed
   * @param error - Error that caused the failure
   * @param context - Optional context about the failure
   *
   * @remarks
   * Creates a TaskFailure record with all available context and stores it
   * in the failedTasks Map. Logs the error with full context for debugging.
   *
   * @private
   */
  #trackFailure(
    taskId: string,
    error: unknown,
    context?: { phase?: string; milestone?: string; taskTitle?: string }
  ): void {
    // Extract error information — use toErrorMessage so plain objects,
    // ZodErrors, and groundswell AgentResponse errors serialize to real text
    // instead of the useless "[object Object]" literal.
    const message = toErrorMessage(error);
    const errorObj = error instanceof Error ? error : new Error(message);
    let errorCode: string | undefined;

    // Extract error code from PipelineError
    if (isPipelineError(error)) {
      errorCode = error.code;
    }

    // Check for Node.js error codes
    if (error instanceof Object && 'code' in error) {
      errorCode = (error as { code: string }).code;
    }

    // Get task title from context or use taskId as fallback
    const taskTitle = context?.taskTitle ?? taskId;

    // Create failure record
    const failure: TaskFailure = {
      taskId,
      taskTitle,
      error: errorObj,
      errorCode,
      timestamp: new Date(),
      phase: context?.phase,
      milestone: context?.milestone,
    };

    // Store in failed tasks Map
    this.#failedTasks.set(taskId, failure);

    // Log with full context
    this.logger.error('[PRPPipeline] Task failure tracked', {
      taskId,
      taskTitle: failure.taskTitle,
      errorCode,
      errorMessage: errorObj.message,
      ...(errorObj.stack && { stack: errorObj.stack }),
      timestamp: failure.timestamp.toISOString(),
      ...context,
    });
  }

  // ========================================================================
  // Step Methods
  // ========================================================================

  /**
   * Initialize session - detect existing or create new
   *
   * @remarks
   * Calls SessionManager.initialize() which:
   * - Computes PRD hash
   * - Searches for existing session with matching hash
   * - Loads existing session if found, or creates new session directory
   * - Returns SessionState with metadata and task registry
   *
   * After session initialization, creates TaskOrchestrator instance.
   */
  async initializeSession(): Promise<void> {
    this.correlationLogger.info('[PRPPipeline] Initializing session', {
      correlationId: this.#correlationId,
    });
    this.logger.info('[PRPPipeline] Initializing session');

    try {
      // PRP §4.3 step 2 ("Validate/bug-hunt re-runs reuse the completed session"):
      // when invoked in validate-only (`--mode validate`) or bug-hunt-only
      // (`--mode bug-hunt`) mode against an already-completed session that has a pending
      // PRD change, reuse the latest completed session instead of letting
      // SessionManager.initialize() create a new empty session (which has no tasks.json
      // and would make the validate/bug-hunt gates bail). The pending change is
      // intentionally left in place so the next normal run processes it into a proper
      // delta session. See {@link PRPPipeline.tryReuseCompletedSessionForReRun}.
      if (this.mode === 'validate' || this.mode === 'bug-hunt') {
        const reused = await this.tryReuseCompletedSessionForReRun();
        if (reused) {
          const session = this.sessionManager.currentSession!;
          this.logger.info(`[PRPPipeline] Session: ${session.metadata.id}`);
          this.logger.info(`[PRPPipeline] Path: ${session.metadata.path}`);
          this.logger.info(
            `[PRPPipeline] Existing: ${session.taskRegistry.backlog.length > 0}`
          );

          // Build the TaskOrchestrator against the reused session, mirroring the normal
          // path below. run()'s rebuildQueue() requires a non-null orchestrator.
          const retryConfig: {
            maxAttempts?: number;
            baseDelay?: number;
            enabled?: boolean;
          } = {
            maxAttempts: this.#taskRetry,
            baseDelay: this.#retryBackoff,
            enabled: !this.#noRetry,
          };
          this.taskOrchestrator = new TaskOrchestratorClass(
            this.sessionManager,
            this.#scope,
            this.#noCache,
            this.#researchQueueConcurrency,
            this.#cacheTtl,
            this.#prpCompression,
            retryConfig
          );

          // No delta branch fires: loadSessionAsCurrent() cached the loaded
          // session's hash as #prdHash, so hasSessionChanged() is false. (We also
          // return before the :577 check regardless.) The pending change stays on disk.
          this.currentPhase = 'session_initialized';
          this.logger.info(
            '[PRPPipeline] Session initialized successfully (reused)'
          );
          return;
        }
        // else: fall through to the normal initialize() path.
      }

      // ============================================================
      // PRD §4.6 Adopt Mode (--adopt-prd) guard rails.
      // Applies only to fresh projects; if sessions already exist the flag is a
      // no-op misuse (warn and proceed with normal session resolution). On a
      // fresh project the completed baseline (tasks.json + .adopted marker +
      // SKIP_EXECUTION_LOOP) is seeded AFTER initialize() below (the session
      // dir + prd_snapshot.md must exist first).
      // ============================================================
      let adoptFresh = false;
      if (this.adoptPrd) {
        const hasSessions = await this.sessionManager.hasAnySessions();
        if (hasSessions) {
          this.logger.warn(
            `[PRPPipeline] --adopt-prd is a no-op: sessions already exist in ${this.sessionManager.planDir}; proceeding with normal session resolution (PRD §4.6)`
          );
          // Fall through to normal session resolution below (rail c: warn + proceed).
        } else {
          // Fresh project: seed the completed baseline AFTER initialize() below
          // (it creates the session dir + writes prd_snapshot.md). Capture the
          // decision here and act on it once the session path exists.
          adoptFresh = true;
          this.logger.info(
            '[PRPPipeline] --adopt-prd set on fresh project (no sessions); seeding adopted baseline (PRD §4.6)'
          );
          // Fall through to normal session creation below.
        }
      }

      // Initialize session manager (detects new vs existing)
      const session = await this.sessionManager.initialize();

      // ============================================================
      // PRD §4.6 Adopt Mode: seed the completed baseline + .adopted marker, then
      // skip the execution loop. initialize() has created the session dir +
      // written prd_snapshot.md; seedAdoptedBaseline reuses writeTasksJSON
      // (BacklogSchema.parse + atomicWrite) and updates the in-memory registry
      // so the next decomposePRD() auto-skips the architect (zero tokens).
      // ============================================================
      if (adoptFresh) {
        await this.sessionManager.seedAdoptedBaseline();
        this.skipExecutionLoop = true;
        this.logger.info(
          '[PRPPipeline] Adopted baseline seeded (PRD §4.6); execution loop will be skipped (validation/bug-hunt still run)'
        );
      }

      // ============================================================
      // PRD §4.6 guard rail (d): reject an empty SESSION_DIR before
      // breakdown/validation so collapsed root paths can never be written.
      // General guard (runs for ALL sessions, not just adopt) — only ever fires
      // on a pathological empty path. Throws a fatal SessionError so the
      // pipeline aborts (a plain Error is treated as non-fatal by isFatalError
      // and would let execution continue into breakdown/validation).
      // ============================================================
      if (!session.metadata.path || session.metadata.path.trim() === '') {
        throw new SessionError(
          'Session directory (SESSION_DIR) is empty; refusing to proceed to breakdown/validation to prevent collapsed root paths (PRD §4.6)',
          { operation: 'initializeSession' }
        );
      }

      this.logger.info(`[PRPPipeline] Session: ${session.metadata.id}`);
      this.logger.info(`[PRPPipeline] Path: ${session.metadata.path}`);
      this.logger.info(
        `[PRPPipeline] Existing: ${session.taskRegistry.backlog.length > 0}`
      );

      // Initialize MetricsCollector if metrics output path is provided
      if (this.#metricsOutputPath) {
        const metricsLogger = getLogger('MetricsCollector');
        this.#metricsCollector = new MetricsCollector(metricsLogger);
        this.logger.info('[PRPPipeline] Metrics collector initialized', {
          outputPath: this.#metricsOutputPath,
        });
      }

      // Create TaskOrchestrator now that session is initialized
      // Build retry config from CLI options
      // Use undefined for unspecified values to allow TaskRetryManager defaults
      const retryConfig: {
        maxAttempts?: number;
        baseDelay?: number;
        enabled?: boolean;
      } = {
        maxAttempts: this.#taskRetry,
        baseDelay: this.#retryBackoff,
        enabled: !this.#noRetry,
      };

      this.taskOrchestrator = new TaskOrchestratorClass(
        this.sessionManager,
        this.#scope,
        this.#noCache,
        this.#researchQueueConcurrency,
        this.#cacheTtl,
        this.#prpCompression,
        retryConfig
      );

      // Check for PRD changes and handle delta if needed
      if (this.sessionManager.hasSessionChanged()) {
        // BUG-002 Part A: classify the change before spawning a delta session
        // (PRD §4.3 step 1). hasSessionChanged() is a pure hash compare, so
        // EVERY edit reaches here; the classifier decides whether the change is
        // SUBSTANTIVE (→ delta session) or COSMETIC (→ absorb the new baseline
        // without a delta session). Any classification failure degrades to
        // SUBSTANTIVE (the protective default — never silently skip a delta
        // session on a classifier failure).
        const diffSummary = await this.sessionManager.getChangeDiffSummary();

        // Cheap pre-filter: diffPRDs already normalizes whitespace away, so a
        // pure-whitespace edit yields zero changes → COSMETIC without an LLM call.
        if (diffSummary.changes.length === 0) {
          this.logger.info(
            '[PRPPipeline] PRD diff is empty after normalization — absorbing as COSMETIC'
          );
          await this.sessionManager.absorbCosmeticChange();
        } else {
          let verdict: 'COSMETIC' | 'SUBSTANTIVE';
          try {
            verdict = await classifyChangeWithRetry(diffSummary);
          } catch (error) {
            // Protective default (PRD §4.3): classifyChangeWithRetry already
            // fails to SUBSTANTIVE on retry exhaustion; this guards the residual
            // "classifier threw around its own catch" case (e.g. module-load
            // failure) — never silently skip the delta session.
            const classifierErr =
              error instanceof Error ? error.message : String(error);
            this.logger.warn(
              `[PRPPipeline] Change classifier threw; failing to protective default SUBSTANTIVE: ${classifierErr}`
            );
            verdict = 'SUBSTANTIVE';
          }
          if (verdict === 'SUBSTANTIVE') {
            this.logger.info(
              '[PRPPipeline] PRD change is SUBSTANTIVE — initializing delta session'
            );
            await this.handleDelta();
          } else {
            this.logger.info(
              '[PRPPipeline] PRD change is COSMETIC — absorbing without delta session'
            );
            await this.sessionManager.absorbCosmeticChange();
          }
        }
      }

      // Update phase
      this.currentPhase = 'session_initialized';

      this.logger.info('[PRPPipeline] Session initialized successfully');
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // Check if error is fatal
      if (isFatalError(error, this.#continueOnError)) {
        this.logger.error(
          `[PRPPipeline] Fatal session initialization error: ${errorMessage}`
        );
        throw error; // Re-throw to abort pipeline
      }

      // Non-fatal: track failure and continue
      this.#trackFailure('initializeSession', error, {
        phase: this.currentPhase,
      });
      this.logger.warn(
        `[PRPPipeline] Non-fatal session initialization error, continuing: ${errorMessage}`
      );
      this.currentPhase = 'session_failed';

      // If the session never loaded (no currentSession), continuing is
      // pointless — downstream stages would fail with a misleading error
      // (e.g. executeBacklog's "no backlog found" hard-abort) that masks the
      // REAL init failure. Re-throw so run() surfaces the original error.
      if (!this.sessionManager.currentSession) {
        throw error;
      }
    }
  }

  /**
   * Select and execute the PRD-change response per PRD §4.3 step 2
   * "Response Selection (mid-session changes)".
   *
   * @remarks
   * Mode A. When a PRD change is detected on an active session, this dispatcher
   * writes the pending-delta marker (`.pending_delta_hash` = the new PRD hash)
   * and then routes to one of three private response handlers:
   *
   * 1. **`acceptPrdChangesResponse()`** — `--accept-prd-changes`: accept PRD edits
   *    as the new baseline WITHOUT a delta session. Cancels
   *    `.pending_delta_hash`, refreshes `prd_snapshot.md` to the current PRD,
   *    and exits/resumes idempotently.
   * 2. **`integrateIntoCurrentSessionResponse()`** — integrate into current
   *    session: fold new requirements into the running session's task
   *    hierarchy. The original `prd_snapshot.md` is PRESERVED until AFTER
   *    integration succeeds (the integration agent diffs the original snapshot
   *    against the current PRD; refreshing early erases the diff and silently
   *    swallows unapplied changes).
   * 3. **`spawnDeltaSession()`** (default) — the existing delta-session flow:
   *    DeltaAnalysisWorkflow → patchBacklog → createDeltaSession → saveBacklog.
   *
   * CONTRACT INPUT: `initializeSession()` classifies a detected PRD change via
   * `classifyChangeWithRetry()` (PRD §4.3 step 1). A `SUBSTANTIVE` verdict routes
   * here (delta session). A `COSMETIC` verdict is absorbed upstream via
   * `SessionManager.absorbCosmeticChange()` — it does NOT route here and does NOT
   * spawn a delta session. Any classifier failure (exhaustion or an unexpected
   * throw) degrades to `SUBSTANTIVE`, so this method runs on every change that is
   * not confidently COSMETIC.
   */
  @Step({ trackTiming: true, name: 'handleDelta' })
  async handleDelta(): Promise<void> {
    this.currentPhase = 'delta_handling';

    // Get current session state — guard BEFORE any dispatch so a missing
    // session throws a clear error rather than a null-deref inside a handler.
    const currentSession = this.sessionManager.currentSession;
    if (!currentSession) {
      throw new Error('Cannot handle delta: no session loaded');
    }
    const sessionPath = currentSession.metadata.path;

    // Load new PRD from disk (resolved once — PRD §2.3 "Single canonical
    // document downstream"). Any resolution failure aborts dispatch so the
    // marker is NOT written for a PRD we cannot read.
    let newPRD: string;
    try {
      newPRD = await resolvePRD(this.sessionManager.prdPath);
    } catch (error) {
      throw new Error(
        `Failed to load new PRD from ${this.sessionManager.prdPath}: ${error}`
      );
    }

    // Write the pending-delta marker (.pending_delta_hash) BEFORE dispatching
    // (PRD §4.3 — the marker is what --accept-prd-changes cancels and what
    // P4.M1.T2.S2 reads to detect a pending change).
    await writePendingDeltaHash(
      sessionPath,
      hashPRDContent(newPRD).slice(0, 12)
    );

    // Response selection (PRD §4.3 step 2).
    if (this.acceptPrdChanges) {
      await this.acceptPrdChangesResponse(sessionPath);
      return;
    }
    if (this.integratePrdChanges) {
      await this.integrateIntoCurrentSessionResponse(sessionPath);
      return;
    }
    // DEFAULT: existing delta-session flow (PRD §4.3 steps 3-7).
    await this.spawnDeltaSession();
  }

  /**
   * `--accept-prd-changes` response (PRD §4.3 step 2): accept PRD edits as the
   * new baseline WITHOUT generating a delta session.
   *
   * @remarks
   * Mode A. "Across all `PRD_CHANGED_*` session states it cancels any queued
   * `.pending_delta_hash`, refreshes `prd_snapshot.md` to the current PRD, and
   * exits/resumes idempotently." Does NOT call `createDeltaSession` and does
   * NOT run `DeltaAnalysisWorkflow`. The next run finds no marker + a snapshot
   * matching the current PRD → no change detected → idempotent.
   */
  private async acceptPrdChangesResponse(sessionPath: string): Promise<void> {
    this.logger.info(
      '[PRPPipeline] --accept-prd-changes: accepting PRD edits as new baseline'
    );
    await refreshSnapshotToCurrentPRD(sessionPath, this.sessionManager.prdPath);
    await clearPendingDeltaHash(sessionPath);
    this.currentPhase = 'delta_accepted';
  }

  /**
   * Integrate-into-current response (PRD §4.3 step 2): fold new requirements
   * into the running session's task hierarchy.
   *
   * @remarks
   * Mode A. The original `prd_snapshot.md` is PRESERVED until AFTER integration
   * succeeds — the integration agent diffs the original snapshot against the
   * current PRD; the snapshot is refreshed only once integration has applied.
   * "Refreshing the snapshot at integration time erases the very diff the agent
   * needs (and silently swallows unapplied changes)" (PRD §4.3). Therefore the
   * order is strictly: DeltaAnalysisWorkflow → patchBacklog → saveBacklog
   * (APPLY) → refreshSnapshotToCurrentPRD (only on success) → clearPendingDeltaHash.
   *
   * Operates on the CURRENT session directory — does NOT call
   * `createDeltaSession`.
   *
   * Added requirements: `patchBacklog` handles only `modified`/`removed`; its
   * `'added'` case is an intentional no-op (added reqs need task GENERATION,
   * which a sync pure function cannot do). When `delta.changes` contains any
   * `'added'` item, this method invokes the Architect over a focused Added-only
   * delta PRD (via `renderDeltaPRD`) and merges the resulting tasks into the
   * patched backlog (`mergeBacklogs` — the same utility the delta path uses).
   * An Architect failure is caught: the modified/removed integration (already
   * applied) is preserved and the patched backlog is re-asserted on disk; the
   * added requirement is skipped with a warn (never a silent drop).
   */
  private async integrateIntoCurrentSessionResponse(
    sessionPath: string
  ): Promise<void> {
    this.logger.info(
      '[PRPPipeline] Integrating PRD changes into current session (snapshot preserved until applied)'
    );

    // PRESERVED — do not refresh the snapshot yet.
    const currentSession = this.sessionManager.currentSession!;
    const oldPRD = currentSession.prdSnapshot;

    // Resolve the current PRD ONCE for both the delta diff and (later) the
    // snapshot refresh.
    const newPRDResolved = await resolvePRD(this.sessionManager.prdPath);

    const completedTaskIds = filterByStatus(
      currentSession.taskRegistry,
      'Complete'
    )
      .filter(item => item.type === 'Task' || item.type === 'Subtask')
      .map(item => item.id);

    this.logger.info(
      `[PRPPipeline] Found ${completedTaskIds.length} completed tasks`
    );
    this.logger.info('[PRPPipeline] Running delta analysis...');
    const delta: DeltaAnalysis = await new DeltaAnalysisWorkflow(
      oldPRD,
      newPRDResolved,
      completedTaskIds
    ).run();
    this.logger.info(
      `[PRPPipeline] Delta analysis found ${delta.changes.length} changes`
    );

    this.logger.info('[PRPPipeline] Patching backlog...');
    const patchedBacklog = patchBacklog(currentSession.taskRegistry, delta);

    // APPLY the patched backlog to the CURRENT session (NOT a delta dir).
    this.logger.info('[PRPPipeline] Saving patched backlog to current session');
    await this.sessionManager.saveBacklog(patchedBacklog);

    // P1.M2.T1.S2: ADDED-requirement handling (PRD §4.3 step 6 "Adds new tasks").
    // patchBacklog handles only modified/removed (its 'added' case is a documented
    // no-op — added reqs need task GENERATION). If the delta has any 'added'
    // changes, invoke the Architect over a focused Added-only delta PRD and MERGE
    // its output into the just-saved patched backlog (same mergeBacklogs utility
    // as the delta path — P1.M1.T1.S2). Gated on added-changes so modified/
    // removed-only deltas are byte-equivalent to before. try/catch: an Architect
    // failure MUST NOT abort the modified/removed integration (already applied
    // above); the patched backlog is re-asserted on disk so the session stays
    // consistent.
    const addedChanges = delta.changes.filter(c => c.type === 'added');
    if (addedChanges.length > 0) {
      try {
        const addedOnlyDelta: DeltaAnalysis = {
          ...delta,
          changes: addedChanges,
        };
        const addedPrdContent = renderDeltaPRD(
          addedOnlyDelta,
          completedTaskIds,
          currentSession.metadata.id
        );

        // Dynamic imports mirror decomposePRD() (agent factory + prompt builder).
        const { createArchitectAgent } =
          await import('../agents/agent-factory.js');
        const { createArchitectPrompt } =
          await import('../agents/prompts/architect-prompt.js');
        // Created ONCE outside the retry closure (PRD §6.1 "same budget"
        // invariant — see decomposePRD comment). Do NOT move inside retryAgentPrompt.
        const architectAgent = createArchitectAgent();
        const architectPrompt = createArchitectPrompt(
          addedPrdContent,
          sessionPath
        );

        this.logger.info(
          '[PRPPipeline] Decomposing added requirements via Architect (integrate path)'
        );
        const result = await retryAgentPrompt(
          () => architectAgent.prompt(architectPrompt),
          { agentType: 'Architect', operation: 'integrateAddedRequirements' }
        );
        if (result.status === 'error') {
          const errMsg = result.error?.message ?? 'unknown agent error';
          throw new Error(
            `Architect agent failed on added requirements: ${errMsg}`
          );
        }

        // The Architect writes tasks.json itself (createArchitectPrompt
        // substitutes $TASKS_FILE → {sessionPath}/tasks.json). Read it back + merge.
        const { readFile } = await import('node:fs/promises');
        const { resolve } = await import('node:path');
        const tasksPath = resolve(sessionPath, 'tasks.json');
        const tasksContent = await readFile(tasksPath, 'utf-8');
        const parsedBacklog = JSON.parse(tasksContent) as Backlog;

        // mergeBacklogs(patched, architect): patched is the BASE (modified/
        // removed statuses preserved); architect's added-req tasks are folded in.
        // The Architect's disk write bypassed SessionManager, so
        // currentSession.taskRegistry STILL holds the patched backlog here.
        const mergedBacklog = mergeBacklogs(
          this.sessionManager.currentSession!.taskRegistry,
          parsedBacklog
        );
        await this.sessionManager.saveBacklog(mergedBacklog);
        this.totalTasks = this.#countTasks();
        this.logger.info(
          `[PRPPipeline] Merged ${addedChanges.length} added requirement(s) into backlog`
        );
      } catch (error) {
        // Architect/read/parse/merge failure: preserve the modified/removed
        // integration that already succeeded. Re-assert the patched backlog on
        // disk in case the Architect clobbered tasks.json before failing.
        const errMsg = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `[PRPPipeline] Added-requirement decomposition failed; modified/removed integration preserved: ${errMsg}`
        );
        await this.sessionManager.saveBacklog(
          this.sessionManager.currentSession!.taskRegistry
        );
      }
    }

    // ONLY NOW (integration applied) refresh the snapshot + clear the marker.
    await refreshSnapshotToCurrentPRD(sessionPath, this.sessionManager.prdPath);
    await clearPendingDeltaHash(sessionPath);
    this.currentPhase = 'delta_integrated';
  }

  /**
   * DEFAULT delta-session flow (the original `handleDelta` body, extracted).
   *
   * @remarks
   * Mode A. Executes delta analysis and task patching to create a delta
   * session that preserves completed work while re-executing affected tasks
   * (PRD §4.3 steps 3-7). Steps:
   *
   * 1. Load old PRD from session snapshot.
   * 2. Load new PRD from disk.
   * 3. Extract completed task IDs.
   * 4. Run DeltaAnalysisWorkflow.
   * 5. Apply patches via TaskPatcher.
   * 6. Create delta session.
   * 7. Log delta summary.
   *
   * The pending-delta marker is written BEFORE this method is entered (by
   * {@link handleDelta}).
   */
  private async spawnDeltaSession(): Promise<void> {
    try {
      // Get current session state
      const currentSession = this.sessionManager.currentSession;
      if (!currentSession) {
        throw new Error('Cannot handle delta: no session loaded');
      }

      // Step 1: Get old PRD from session snapshot
      const oldPRD = currentSession.prdSnapshot;
      if (!oldPRD) {
        throw new Error('Cannot handle delta: no PRD snapshot in session');
      }

      // Step 2: Load new PRD from disk (resolved once — PRD §2.3 "Single canonical
      // document downstream"; the old PRD snapshot is already resolved from init).
      let newPRD: string;
      try {
        newPRD = await resolvePRD(this.sessionManager.prdPath);
      } catch (error) {
        throw new Error(
          `Failed to load new PRD from ${this.sessionManager.prdPath}: ${error}`
        );
      }

      // Step 3: Extract completed task IDs
      const backlog = currentSession.taskRegistry;
      const completedItems = filterByStatus(backlog, 'Complete');
      const completedTaskIds = completedItems
        .filter(item => item.type === 'Task' || item.type === 'Subtask')
        .map(item => item.id);

      this.logger.info(
        `[PRPPipeline] Found ${completedTaskIds.length} completed tasks`
      );

      // Step 4: Run DeltaAnalysisWorkflow
      this.logger.info('[PRPPipeline] Running delta analysis...');
      const workflow = new DeltaAnalysisWorkflow(
        oldPRD,
        newPRD,
        completedTaskIds
      );
      const delta: DeltaAnalysis = await workflow.run();

      this.logger.info(
        `[PRPPipeline] Delta analysis found ${delta.changes.length} changes`
      );
      this.logger.info(
        `[PRPPipeline] Tasks to re-execute: ${delta.taskIds.join(', ')}`
      );

      // Step 5: Apply patches to backlog
      this.logger.info('[PRPPipeline] Patching backlog...');
      const patchedBacklog = patchBacklog(backlog, delta);

      // Step 6: Create delta session
      // Capture the PARENT session id BEFORE createDeltaSession reassigns
      // #currentSession to the new delta session (after which .metadata.id is
      // the DELTA id, not the parent).
      const parentSessionIdRef = currentSession.metadata.id;
      this.logger.info('[PRPPipeline] Creating delta session...');
      await this.sessionManager.createDeltaSession(this.sessionManager.prdPath);

      // Step 6b: Render + write delta_prd.md (PRD §4.3 step 5 — "Delta PRD
      // Generation"). DETERMINISTIC render of the structured DeltaAnalysis that
      // DeltaAnalysisWorkflow already produced (no second LLM call; the
      // retry/fail-fast contract is inherited from the retried QA step). The
      // delta branch in decomposePRD() later consumes this file for the
      // breakdown input — see PRD §4.3 "Breakdown MUST consume the delta PRD."
      const deltaSessionPath =
        this.sessionManager.currentSession!.metadata.path;
      await writeDeltaPRD(
        deltaSessionPath,
        renderDeltaPRD(delta, completedTaskIds, parentSessionIdRef)
      );

      // Step 7: Save patched backlog to delta session
      await this.sessionManager.saveBacklog(patchedBacklog);

      // Log delta summary
      const deltaSession = this.sessionManager.currentSession;
      this.logger.info('[PRPPipeline] ===== Delta Summary =====');
      this.logger.info(
        `[PRPPipeline] Delta session: ${deltaSession?.metadata.id}`
      );
      this.logger.info(
        `[PRPPipeline] Parent session: ${deltaSession?.metadata.parentSession}`
      );
      this.logger.info(`[PRPPipeline] Changes found: ${delta.changes.length}`);
      this.logger.info(
        `[PRPPipeline] Tasks to re-execute: ${delta.taskIds.length}`
      );
      this.logger.info(
        `[PRPPipeline] Affected tasks: ${delta.taskIds.join(', ')}`
      );
      this.logger.info(
        `[PRPPipeline] Patch instructions: ${delta.patchInstructions}`
      );
      this.logger.info('[PRPPipeline] ===== End Delta Summary =====');

      // Update phase
      this.currentPhase = 'session_initialized';
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // Check if error is fatal
      if (isFatalError(error, this.#continueOnError)) {
        this.logger.error(
          `[PRPPipeline] Fatal delta handling error: ${errorMessage}`
        );
        throw error; // Re-throw to abort pipeline
      }

      // Non-fatal: track failure and continue
      this.#trackFailure('handleDelta', error, {
        phase: this.currentPhase,
      });
      this.logger.warn(
        `[PRPPipeline] Non-fatal delta handling error, continuing: ${errorMessage}`
      );
    }
  }

  /**
   * Decompose PRD into task backlog
   *
   * @remarks
   * A delta session ALWAYS runs the Architect breakdown over `delta_prd.md`
   * (PRD §4.3 step 5) regardless of any pre-existing patched backlog — this is
   * what makes the delta branch reachable (bugfix 001, Issue 1). Non-delta
   * sessions retain the `hasBacklog` early-return: an existing backlog skips
   * generation, an empty backlog generates one from the PRD.
   *
   * Generated backlog is saved via SessionManager.saveBacklog().
   *
   * @remarks **BUG-002 Part B (PRD §4.3):** on a delta session the generated
   * `delta_prd.md` is classified CLEAN/DIRTY via `classifyArtifactWithRetry`
   * before it is fed to the architect. CLEAN proceeds; DIRTY aborts the
   * breakdown (`currentPhase='prd_decomposition_failed'`) so malformed content
   * is never consumed unprotected. The non-delta full PRD is never classified.
   * See the inline guard comment for the action-on-DIRTY rationale.
   */
  async decomposePRD(): Promise<void> {
    this.logger.info('[PRPPipeline] Decomposing PRD');

    try {
      // Resolve the session + delta-ness FIRST so the hasBacklog guard below
      // only applies to NON-delta sessions (PRD §4.3 step 5; bugfix Issue 1:
      // previously this guard ran before isDelta and, since spawnDeltaSession
      // always saves a non-empty patched backlog, dead-coded the delta branch).
      const sessionPath = this.sessionManager.currentSession!.metadata.path;
      const isDelta =
        this.sessionManager.currentSession?.metadata.parentSession != null;

      if (!isDelta) {
        // ORIGINAL hasBacklog early-return — NON-DELTA only (byte-for-byte
        // unchanged; only its position + this wrapper changed in bugfix S1).
        const backlog = this.sessionManager.currentSession?.taskRegistry;
        const hasBacklog = backlog && backlog.backlog.length > 0;

        if (hasBacklog) {
          this.logger.info(
            '[PRPPipeline] Existing backlog found, skipping generation'
          );
          this.totalTasks = this.#countTasks();
          this.currentPhase = 'prd_decomposed';
          return;
        }

        this.logger.info(
          '[PRPPipeline] New session, generating backlog from PRD'
        );
      } else {
        this.logger.info(
          '[PRPPipeline] Delta session — breakdown over delta_prd.md (PRD §4.3 step 5)'
        );
      }

      // Import agent factory and prompt generator dynamically
      const { createArchitectAgent } =
        await import('../agents/agent-factory.js');
      const { createArchitectPrompt } =
        await import('../agents/prompts/architect-prompt.js');

      // Create Architect agent
      // INVARIANT (PRD §6.1): the Architect is created ONCE here with the
      // Reasoning role (xhigh budget — wired by createArchitectAgent via S2).
      // The "demand-write" retry below (retryAgentPrompt) re-invokes THIS SAME
      // instance on every attempt, so every retry inherits the xhigh budget.
      // Do NOT move createArchitectAgent() inside the retry closure — a fresh
      // agent could rebind to a downgraded config and break §6.1's "same budget"
      // rule for the retry. Regression-locked by the
      // "reuses the same single Architect agent instance ..." unit test.
      const architectAgent = createArchitectAgent();

      // Source the breakdown input. PRD §4.3 step 5 ("Breakdown MUST consume
      // the delta PRD"): on a delta session the breakdown runs over
      // delta_prd.md (the diffs), NOT the full PRD. `prdSnapshot` on a delta
      // session is the FULL resolved new PRD (createDeltaSession sets it), so
      // using it here would silently embed the entire PRD and ignore the delta.
      // If delta_prd.md is missing on a delta session, throw a clear error —
      // NEVER fall back to prdSnapshot (that re-introduces the full-PRD leak;
      // the next run regenerates delta_prd.md via the delta spawn path).
      let prdContent: string;
      if (isDelta) {
        try {
          prdContent = await loadDeltaPRD(sessionPath);
        } catch {
          throw new Error(
            `Delta session has no delta_prd.md at ${sessionPath} — cannot break down ` +
              'the delta. Re-run to regenerate it via the delta spawn path.'
          );
        }
      } else {
        prdContent = this.sessionManager.currentSession?.prdSnapshot ?? '';
      }

      // Create properly typed prompt with PRD content.
      // Pass the session path so $TASKS_FILE / $SESSION_DIR placeholders in the
      // system prompt resolve to absolute paths inside the session directory.
      //
      // BUG-002 Part B: guard the GENERATED delta_prd.md artifact (PRD §4.3 step 1).
      // classifyArtifactWithRetry returns 'CLEAN' | 'DIRTY', failing to the
      // protective default 'DIRTY' on exhaustion (PRD §4.3: "never … proceed
      // unprotected"). A DIRTY verdict (malformed artifact OR classifier-down)
      // MUST NOT be fed to the architect unprotected — abort this breakdown so
      // the next run regenerates delta_prd.md fresh via the delta spawn path and
      // re-classifies (no infinite loop: the delta spawn regenerates the file
      // each run). §4.3's "never proceed unprotected" rules out warn-and-proceed.
      // The plain Error is caught by the outer catch as NON-fatal (isFatalError
      // treats a plain Error as non-fatal) → #trackFailure + warn +
      // currentPhase='prd_decomposition_failed' — identical handling to the
      // 'Architect agent failed' throw below and the loadDeltaPRD-missing throw
      // above. DELTA-ONLY: the non-delta path's prdContent is the full
      // human-authored PRD (currentSession.prdSnapshot), NOT a generated
      // artifact — it is intentionally NEVER classified (classifying it would
      // block every initial breakdown on classifier availability).
      if (isDelta) {
        const artifactVerdict = await classifyArtifactWithRetry(prdContent);
        if (artifactVerdict === 'DIRTY') {
          this.logger.warn(
            '[PRPPipeline] delta_prd.md classified DIRTY/malformed (PRD §4.3) — ' +
              'aborting breakdown; refusing to feed the architect unprotected. ' +
              'Re-run to regenerate delta_prd.md via the delta spawn path.'
          );
          throw new Error(
            'delta_prd.md classified DIRTY/malformed (PRD §4.3) — refusing to ' +
              'feed the architect unprotected. Re-run to regenerate delta_prd.md ' +
              'via the delta spawn path.'
          );
        }
      }

      const architectPrompt = createArchitectPrompt(prdContent, sessionPath);

      // Generate backlog with retry logic
      this.logger.info('[PRPPipeline] Calling Architect agent...');
      const result = await retryAgentPrompt(
        () => architectAgent.prompt(architectPrompt),
        { agentType: 'Architect', operation: 'decomposePRD' }
      );

      // Surface agent-level failures instead of masking them as a later ENOENT.
      // Groundswell wraps harness/LLM failures into { status: 'error' } responses
      // (no throw); without this check a failed agent would leave tasks.json
      // unwritten and the readFile below would throw a confusing ENOENT.
      if (result.status === 'error') {
        const errMsg = result.error?.message ?? 'unknown agent error';
        throw new Error(`Architect agent failed: ${errMsg}`);
      }

      // Parse the result - architect agent returns { backlog: Backlog }
      // Note: The architect agent writes to $TASKS_FILE, but we can also parse from response
      // For this implementation, we'll read from the file the agent writes
      const { readFile } = await import('node:fs/promises');
      const { resolve } = await import('node:path');
      const tasksPath = resolve(sessionPath, 'tasks.json');
      const tasksContent = await readFile(tasksPath, 'utf-8');
      const parsedBacklog = JSON.parse(tasksContent) as Backlog;

      // P1.M1.T1.S2: MERGE the architect's added-requirement output (parsedBacklog, just read
      // from the architect's disk write) with the in-memory patched backlog
      // (currentSession.taskRegistry — modified→Planned, removed→Obsolete already applied by
      // patchBacklog). The architect's write above clobbered tasks.json on disk, but
      // SessionManager.saveBacklog synced currentSession.taskRegistry in memory at
      // spawnDeltaSession, so it still holds the patched backlog. mergeBacklogs is a pure
      // transform; mergeBacklogs(empty, x) ≡ x, so the non-delta-no-backlog path (empty
      // patched registry) is byte-equivalent to saving the architect output directly.
      const patchedBacklog = this.sessionManager.currentSession!.taskRegistry;
      const mergedBacklog = mergeBacklogs(patchedBacklog, parsedBacklog);
      await this.sessionManager.saveBacklog(mergedBacklog);

      // Update task counts (reads the merged result via currentSession, which saveBacklog syncs).
      this.totalTasks = this.#countTasks();

      // Log summary
      const phaseCount = mergedBacklog.backlog.length;
      this.logger.info(`[PRPPipeline] Generated ${phaseCount} phases`);
      this.logger.info(`[PRPPipeline] Total tasks: ${this.totalTasks}`);

      this.currentPhase = 'prd_decomposed';
      this.logger.info('[PRPPipeline] PRD decomposition complete');
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // Check if error is fatal
      if (isFatalError(error, this.#continueOnError)) {
        this.logger.error(
          `[PRPPipeline] Fatal PRD decomposition error: ${errorMessage}`
        );
        throw error; // Re-throw to abort pipeline
      }

      // Non-fatal: track failure and continue
      this.#trackFailure('decomposePRD', error, {
        phase: this.currentPhase,
      });
      this.logger.warn(
        `[PRPPipeline] Non-fatal PRD decomposition error, continuing: ${errorMessage}`
      );
      this.currentPhase = 'prd_decomposition_failed';
    }
  }

  /**
   * Execute backlog until complete
   *
   * @remarks
   * Iterates through backlog by calling TaskOrchestrator.processNextItem()
   * until it returns false (queue empty). Updates completedTasks count
   * after each item for observability.
   *
   * Supports graceful shutdown via SIGINT/SIGTERM signals - checks
   * shutdownRequested flag after each task completes and breaks loop
   * if shutdown was requested.
   *
   * NOTE: TaskOrchestrator.executeSubtask() is currently a placeholder.
   * Future: Will integrate PRPRuntime for actual PRP execution.
   *
   * **Unconditional abort on missing backlog (PRD §4.2/§5.1; bugfix Issue 5).** If
   * `currentSession.taskRegistry` is absent, this method throws a fatal
   * {@link SessionError} (`PIPELINE_SESSION_LOAD_FAILED`) carrying the message
   * `'Cannot execute pipeline: no backlog found in session'`. The check lives ABOVE
   * the execution try/catch, so the throw propagates unconditionally — it is NOT
   * subject to `isFatalError()` and therefore NOT swallowed under `--continue-on-error`.
   * A missing backlog is a misconfigured session; running validation/QA over zero
   * tasks is not useful, so the pipeline aborts loudly.
   */
  async executeBacklog(): Promise<void> {
    this.logger.info('[PRPPipeline] Executing backlog');

    // PRD §4.6 Adopt Mode: skip implementation while still allowing validation
    // + bug hunt (called later in run()). The adopted baseline is all-Complete,
    // so nothing would run anyway; this guard makes the skip explicit and fast
    // and is the signal S3 (validation/bug-hunt-still-run) keys off.
    if (this.skipExecutionLoop) {
      this.logger.info(
        '[PRPPipeline] Skipping execution loop (adopt mode / SKIP_EXECUTION_LOOP); validation + bug-hunt still run (PRD §4.6)'
      );
      // PRD §4.6: the adopted baseline is all-Complete. executeBacklog()'s body
      // (which sets completedTasks) is skipped, so recompute BOTH counts from
      // the seeded registry here. This makes the session report as complete and
      // ensures runQACycle() treats it as a normal completed session.
      this.totalTasks = this.#countTasks();
      this.completedTasks = this.#countCompletedTasks();
      this.currentPhase = 'backlog_complete';
      return;
    }

    // HARD ABORT — no backlog = misconfigured session; never useful to continue
    // (PRD §4.2/§5.1; bugfix Issue 5). Thrown ABOVE the try/catch so it propagates
    // unconditionally — bypassing isFatalError(), so it aborts even under
    // --continue-on-error. SessionError's hardcoded PIPELINE_SESSION_LOAD_FAILED
    // code is also classified fatal by isFatalError (defense in depth).
    const backlog = this.sessionManager.currentSession?.taskRegistry;
    if (!backlog) {
      throw new SessionError(
        'Cannot execute pipeline: no backlog found in session',
        { operation: 'executeBacklog' }
      );
    }

    try {
      // (backlog declared + null-checked above; narrowed to non-null here)
      // Check if there are any subtasks to execute
      const totalSubtasks = this.#countTasks();
      if (totalSubtasks === 0) {
        this.logger.info(
          '[PRPPipeline] No subtasks to execute, skipping backlog execution'
        );
        this.currentPhase = 'backlog_complete';
        return;
      }

      this.#progressTracker = progressTracker({
        backlog,
        logInterval: 5, // Log progress every 5 tasks per work item spec
        barWidth: 40,
      });

      this.logger.info(
        `[PRPPipeline] Progress tracking initialized: ${this.#progressTracker?.getProgress().total ?? 0} subtasks`
      );

      // Initialize ProgressDisplay for visual progress bars
      this.#progressDisplay = new ProgressDisplay({
        progressMode: this.#progressMode,
        updateInterval: 100,
        showLogs: true,
        logCount: 3,
      });

      if (this.#progressDisplay.isEnabled()) {
        this.#progressDisplay.start(backlog);
        this.logger.info('[PRPPipeline] Progress display enabled');
      } else {
        this.logger.debug('[PRPPipeline] Progress display disabled');
      }

      let iterations = 0;
      let taskCounter = 0; // Track tasks for interval-based monitoring
      const maxIterations = 10000; // Safety limit

      // Process items until queue is empty or shutdown requested. A
      // processNextItem rejection is wrapped as OrchestratorError so the outer
      // catch rethrows it (PRD bugfix Issue 5) rather than swallowing it.
      let hasMore: boolean;
      try {
        hasMore = await this.taskOrchestrator.processNextItem();
      } catch (e) {
        throw new OrchestratorError(e instanceof Error ? e.message : String(e));
      }
      while (hasMore) {
        // WRAP: Loop body in try-catch to continue on individual task failures
        try {
          iterations++;

          // Safety check. Rethrown out of the inner catch below (tagged via
          // isMaxIterationsError) so it propagates OUT of executeBacklog (PRD
          // bugfix Issue 5): an earlier version threw a plain Error here that
          // the inner catch swallowed (break → reported "success").
          if (iterations > maxIterations) {
            throw new MaxIterationsError(
              `Execution exceeded ${maxIterations} iterations`
            );
          }

          // Update completed tasks count
          this.completedTasks = this.#countCompletedTasks();

          // Track task completion for progress
          const currentItemId =
            this.taskOrchestrator.currentItemId ?? 'unknown';
          this.#progressTracker?.recordComplete(currentItemId);

          // Update progress display with current task info
          // Need to get current task info from backlog if available
          if (currentItemId !== 'unknown') {
            // Try to find current task in backlog for display
            // For now, use basic info - could be enhanced to look up title
            this.#progressDisplay?.update(
              this.completedTasks,
              this.totalTasks,
              {
                id: currentItemId,
                title: 'Current Task',
                type: 'Subtask',
              }
            );
          } else {
            this.#progressDisplay?.update(this.completedTasks, this.totalTasks);
          }

          // CRITICAL: Record task completion in resource monitor
          if (this.#resourceMonitor) {
            this.#resourceMonitor.recordTaskComplete();
          }

          // Increment task counter for interval-based monitoring
          taskCounter++;

          // Log progress every 5 tasks
          if (this.completedTasks % 5 === 0) {
            this.logger.info(
              `[PRPPipeline] ${this.#progressTracker?.formatProgress()}`
            );
          }

          // CRITICAL: Check for resource limits based on interval or always on last task
          const shouldCheckResources =
            this.#monitorTaskInterval === 1 || // Always check if interval is 1
            taskCounter % this.#monitorTaskInterval === 0 || // Check on interval boundary
            this.completedTasks === this.totalTasks; // Always check on last task

          if (shouldCheckResources && this.#resourceMonitor?.shouldStop()) {
            const status = this.#resourceMonitor.getStatus();
            this.logger.warn(
              '[PRPPipeline] Resource limit reached, initiating graceful shutdown',
              {
                limitType: status.limitType,
                tasksCompleted: this.completedTasks,
                snapshot: status.snapshot,
              }
            );

            if (status.suggestion) {
              this.logger.info(
                `[PRPPipeline] Suggestion: ${status.suggestion}`
              );
            }

            this.#resourceLimitReached = true;
            this.shutdownRequested = true;
            this.shutdownReason = 'RESOURCE_LIMIT';
            this.currentPhase = 'resource_limit_reached';
            break;
          }

          // Check for shutdown request after each task
          if (this.shutdownRequested) {
            this.logger.info(
              '[PRPPipeline] Shutdown requested, finishing current task'
            );

            // Log progress state at shutdown
            const progress = this.#progressTracker?.getProgress();
            this.logger.info(
              `[PRPPipeline] Shutting down: ${progress?.completed}/${progress?.total} tasks complete (${progress?.percentage.toFixed(1)}%)`
            );

            this.currentPhase = 'shutdown_interrupted';
            break;
          }

          // Log progress every 10 items (kept for compatibility)
          if (iterations % 10 === 0) {
            this.logger.info(
              `[PRPPipeline] Processed ${iterations} items, ${this.completedTasks}/${this.totalTasks} tasks complete`
            );
          }
        } catch (taskError) {
          // CATCH: Individual task failure.
          //
          // A MaxIterationsError is the executeBacklog safety guard (PRD
          // bugfix Issue 5): rethrow it so it propagates instead of being
          // swallowed by the default break-and-halt below.
          if (
            taskError instanceof Error &&
            (taskError as MaxIterationsError).isMaxIterationsError
          ) {
            throw taskError;
          }
          //
          // A TaskError thrown by executeSubtask means a subtask hard-failed
          // (validation exhausted after retries). By DEFAULT we HALT the
          // pipeline — the prior always-continue behavior committed broken
          // code and cascaded into dependent tasks. Pass --continue-on-error
          // to soldier on.
          const currentItemId =
            this.taskOrchestrator.currentItemId ?? `iteration-${iterations}`;
          const taskId = currentItemId;

          this.#trackFailure(taskId, taskError, {
            phase: this.currentPhase,
          });

          const errMsg =
            taskError instanceof Error ? taskError.message : String(taskError);

          if (this.#continueOnError) {
            this.logger.warn(
              '[PRPPipeline] Task failed, continuing (--continue-on-error)',
              { taskId, error: errMsg }
            );
            continue; // next iteration
          }

          // Halt: stop processing further tasks. The tracked failure surfaces
          // as a non-empty failedTasks set so run() reports failure (exit 1).
          this.logger.error(
            '[PRPPipeline] Task failed — halting pipeline. ' +
              'Fix the failing task and resume with --continue, or pass ' +
              '--continue-on-error to proceed past failures.',
            { taskId, error: errMsg }
          );
          this.currentPhase = 'backlog_halted';
          break;
        }

        // Re-evaluate the loop condition for the next iteration. Wrapped as
        // OrchestratorError on rejection (see the priming read above) so a
        // processNextItem throw propagates (PRD bugfix Issue 5).
        try {
          hasMore = await this.taskOrchestrator.processNextItem();
        } catch (e) {
          throw new OrchestratorError(
            e instanceof Error ? e.message : String(e)
          );
        }
      }

      // Only log "complete" if not interrupted
      if (!this.shutdownRequested) {
        this.logger.info(`[PRPPipeline] Processed ${iterations} items total`);

        // Final counts
        this.completedTasks = this.#countCompletedTasks();
        const failedTasks = this.#countFailedTasks();

        // Log final progress summary
        const progress = this.#progressTracker?.getProgress();
        this.logger.info('[PRPPipeline] ===== Pipeline Complete =====');
        this.logger.info(
          `[PRPPipeline] Progress: ${this.#progressTracker?.formatProgress()}`
        );
        this.logger.info(
          `[PRPPipeline] Duration: ${(progress?.elapsed ?? 0).toFixed(0)}ms (${((progress?.elapsed ?? 0) / 1000).toFixed(1)}s)`
        );
        this.logger.info(`[PRPPipeline] Complete: ${progress?.completed ?? 0}`);
        this.logger.info(`[PRPPipeline] Failed: ${failedTasks}`);
        this.logger.info('[PRPPipeline] ===== End Summary =====');

        this.currentPhase = 'backlog_complete';
        this.logger.info('[PRPPipeline] Backlog execution complete');
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // PRD bugfix Issue 5: the max-iterations safety guard and a
      // processNextItem orchestrator failure must propagate out of
      // executeBacklog (they were previously swallowed here because
      // isFatalError treats unknown Error types as non-fatal). These are
      // tagged sentinels (MaxIterationsError / OrchestratorError); rethrow
      // them unconditionally — even under --continue-on-error, since both
      // indicate the execution loop itself is broken, not a single subtask.
      if (
        error instanceof Error &&
        ((error as MaxIterationsError).isMaxIterationsError ||
          (error as OrchestratorError).isOrchestratorError)
      ) {
        this.logger.error(
          `[PRPPipeline] Fatal backlog execution error: ${errorMessage}`
        );
        throw error;
      }

      // Check if error is fatal
      if (isFatalError(error, this.#continueOnError)) {
        this.logger.error(
          `[PRPPipeline] Fatal backlog execution error: ${errorMessage}`
        );
        throw error; // Re-throw to abort pipeline
      }

      // Non-fatal: track and continue
      this.#trackFailure('executeBacklog', error, { phase: this.currentPhase });
      this.logger.warn(
        `[PRPPipeline] Non-fatal backlog error, continuing: ${errorMessage}`
      );
    }
  }

  /**
   * Validation stage (PRD §4.4 step 1 "Validation Scripting").
   *
   * @remarks
   * Constructs + runs a {@link ValidationWorkflow}: the reasoning agent
   * (VALIDATION_AGENT, default `pizr`) AUTHORS `validate.sh` from the PRD +
   * the repo's tooling (FILE-AS-CONTRACT), then the pipeline RUNS it via
   * `BashMCP.execute_bash` at the project root under `VALIDATION_TIMEOUT`
   * (overriding the generic gate timeout for this call only).
   *
   * **Abort-on-failure** (PRD §4.4): on `!outcome.success` this throws a
   * {@link ValidationFailedError} carrying `{ timedOut, exitCode }` so
   * {@link isWatchdogKillResult} (`src/utils/retry.ts`) classifies a watchdog
   * kill (Node watchdog `timedOut` OR `timeout`-coreutil `exitCode 124`) as a
   * HARD terminal failure that is never retried (PRD §9.3.2). A non-watchdog
   * non-zero exit is a plain abort.
   *
   * This method is invoked from `run()` BEFORE `runQACycle()` — NOT inside its
   * try/catch — so the throw propagates unconditionally (even under
   * `--continue-on-error`, where `runQACycle`'s catch swallows non-fatal
   * errors). The throw lands in `run()`'s catch → returns a failure result,
   * so bug-hunt is never reached and `setStatus('completed')` is never called.
   *
   * @throws {ValidationFailedError} If validation fails (non-zero exit or
   *   watchdog kill).
   * @throws {Error} If no session path is available, or authoring fails.
   */
  async #runValidation(): Promise<void> {
    const sessionPath = this.sessionManager.currentSession?.metadata.path;
    if (!sessionPath) {
      throw new Error('[PRPPipeline] No session path available for validation');
    }
    const prdContent = this.sessionManager.currentSession?.prdSnapshot ?? '';

    this.logger.info(
      '[PRPPipeline] Validation stage (PRD §4.4) — generate + run validate.sh'
    );

    const workflow = new ValidationWorkflow(prdContent, process.cwd());
    const outcome = await workflow.run(sessionPath);

    this.logger.info('[PRPPipeline] Validation outcome', {
      success: outcome.success,
      exitCode: outcome.exitCode,
      timedOut: outcome.timedOut,
      durationMs: outcome.durationMs,
    });

    // PRD §4.4 Abort-on-failure: non-zero exit aborts BEFORE bug-hunt. Watchdog
    // kills are terminal (ValidationFailedError carries timedOut/exitCode so
    // isWatchdogKillResult(error)===true → never retried by retryAgentPrompt).
    if (!outcome.success) {
      throw new ValidationFailedError(outcome);
    }
  }

  /**
   * Run QA bug hunt cycle
   *
   * @remarks
   * Behavior based on mode:
   * - 'bug-hunt': Run QA immediately regardless of task status
   * - 'validate': Skip QA (validation-only mode)
   * - 'normal': Run QA only if all tasks are Complete
   *
   * QA flow:
   * 1. Run BugHuntWorkflow to detect bugs
   * 2. If bugs found, run FixCycleWorkflow to fix them
   * 3. Write TEST_RESULTS.md if bugs remain
   * 4. Print QA summary to console
   */
  async runQACycle(): Promise<void> {
    this.logger.info('[PRPPipeline] QA Cycle');

    try {
      // ============================================================
      // Decision: Run QA or skip based on mode
      // ============================================================

      let shouldRunQA = false;

      if (this.mode === 'bug-hunt') {
        // Bug-hunt mode: run QA immediately
        this.logger.info(
          '[PRPPipeline] Bug-hunt mode: running QA regardless of task status'
        );
        shouldRunQA = true;
      } else if (this.mode === 'validate') {
        // Validate mode: skip QA
        this.logger.info('[PRPPipeline] Validate mode: skipping QA cycle');
        this.#bugsFound = 0;
        this.currentPhase = 'qa_skipped';
        return;
      } else {
        // Normal mode: check if all tasks are complete
        // Skip QA if there are 0 tasks to test
        if (this.totalTasks === 0) {
          this.logger.info('[PRPPipeline] No tasks to test, skipping QA cycle');
          this.#bugsFound = 0;
          this.currentPhase = 'qa_complete';
          return;
        }
        if (!this.#allTasksComplete()) {
          const failedCount = this.#countFailedTasks();
          const plannedCount =
            this.totalTasks - this.completedTasks - failedCount;

          this.logger.info('[PRPPipeline] Not all tasks complete, skipping QA');
          this.logger.info(
            `[PRPPipeline] Failed: ${failedCount}, Planned: ${plannedCount}`
          );

          this.#bugsFound = 0;
          this.currentPhase = 'qa_skipped';
          return;
        }
        shouldRunQA = true;
      }

      if (!shouldRunQA) {
        this.#bugsFound = 0;
        this.currentPhase = 'qa_skipped';
        return;
      }

      // ============================================================
      // Phase 1: Bug Hunt
      // ============================================================

      this.logger.info('[PRPPipeline] All tasks complete, running QA bug hunt');

      const prdContent = this.sessionManager.currentSession?.prdSnapshot ?? '';
      const completedTasks = this.#extractCompletedTasks();

      this.logger.info(
        `[PRPPipeline] Testing against ${completedTasks.length} completed tasks`
      );

      // Extract and validate session path for BugHuntWorkflow
      const sessionPath = this.sessionManager.currentSession?.metadata.path;
      if (!sessionPath) {
        throw new Error(
          '[PRPPipeline] Session path not available for QA cycle'
        );
      }

      // ============================================================
      // PRD §4.4 step 3: Resume interrupted bugfix breakdowns.
      // If a previous bug-fix run was killed between committing
      // TEST_RESULTS.md and finishing breakdown, the bugfix dir has
      // TEST_RESULTS.md but no (valid) tasks.json. Re-enter the SAME path
      // the bug-hunt stage uses when it first finds bugs
      // (runStandardBreakdown regenerates tasks.json). Skipped in
      // --validate / --skip-bug-finding and suppressed inside bug-fix
      // children (no detect→resume→detect re-entry loop).
      // ============================================================
      const canAutoResume =
        (this.mode as 'normal' | 'delta' | 'bug-hunt' | 'validate') !==
          'validate' &&
        process.env.SKIP_BUG_FINDING !== 'true' &&
        !sessionPath.toLowerCase().includes('bugfix');

      // Declared up here so the resume branch can assign it; the fresh-hunt
      // path assigns it below. Guaranteed assigned by exactly one of the two
      // paths before Phase 3/4 read it (resume-success XOR fresh path).
      let finalResults: TestResults | null = null;
      let resumed = false;

      if (canAutoResume) {
        const interruptedDir = await this.#detectInterruptedBugfix(sessionPath);
        if (interruptedDir) {
          this.logger.info(
            `[PRPPipeline] Interrupted bugfix breakdown detected at ${interruptedDir}; resuming (skipping fresh bug hunt)`
          );
          try {
            finalResults = await this.#runBugFixCycle(
              interruptedDir,
              prdContent
            );
            resumed = true;
          } catch (resumeError) {
            const msg =
              resumeError instanceof Error
                ? resumeError.message
                : String(resumeError);
            this.logger.warn(
              `[PRPPipeline] Resume of interrupted bugfix failed, falling back to fresh bug hunt: ${msg}`
            );
            // resumed stays false → fresh hunt runs below
          }
        }
      }

      // ============================================================
      // Phase 1: Bug Hunt (fresh) — only when not resuming
      // ============================================================
      if (!resumed) {
        const bugHuntWorkflow = new BugHuntWorkflow(prdContent, completedTasks);
        const testResults = await bugHuntWorkflow.run(sessionPath);

        // Log initial test results
        this.logger.info('[PRPPipeline] Bug hunt complete', {
          hasBugs: testResults.hasBugs,
          bugCount: testResults.bugs.length,
          summary: testResults.summary,
        });

        // ============================================================
        // Phase 2: Fix Cycle (if bugs found)
        // ============================================================

        finalResults = testResults;

        if (testResults.hasBugs) {
          this.logger.info('[PRPPipeline] Bugs detected, starting fix cycle');

          try {
            // Create a bugfix child session directory. The FixCycleWorkflow
            // validates that its sessionPath contains 'bugfix' (PRD §5.1: bug
            // fix operations must only occur in bugfix sessions). We create a
            // bugfix/ subdirectory under the current session, copy TEST_RESULTS.md
            // into it (the workflow reads it from there), and pass that path.
            const { resolve } = await import('node:path');
            const { mkdir, copyFile } = await import('node:fs/promises');
            // PRD §4.4 step 3 / §5.1: numbered bugfix/NNN_hash/ iteration (archives
            // prior iterations instead of overwriting a flat bugfix/ dir).
            // nextBugfixDir is read-only (returns the path + sequence); mkdir below
            // creates it (+ parent bugfix/ if absent). The path still contains
            // 'bugfix' so FixCycleWorkflow's includes('bugfix') check still passes.
            const { dir: bugfixSessionPath } = await nextBugfixDir(
              sessionPath,
              testResults.summary ?? JSON.stringify(testResults.bugs)
            );
            await mkdir(bugfixSessionPath, { recursive: true });
            const testResultsPath = resolve(sessionPath, 'TEST_RESULTS.md');
            try {
              await copyFile(
                testResultsPath,
                resolve(bugfixSessionPath, 'TEST_RESULTS.md')
              );
            } catch {
              // TEST_RESULTS.md may not exist if writeBugReport skipped (no
              // critical/major bugs); copy bug_hunt_results.json as fallback.
              await copyFile(
                resolve(sessionPath, 'bug_hunt_results.json'),
                resolve(bugfixSessionPath, 'TEST_RESULTS.md')
              ).catch(() => {
                /* nothing to copy — fix-cycle will error on load */
              });
            }
            this.logger.info(
              `[PRPPipeline] Bugfix session: ${bugfixSessionPath}`
            );

            const fixResults = await this.#runBugFixCycle(
              bugfixSessionPath,
              prdContent
            );

            // Log fix cycle results
            const bugsRemaining = fixResults.bugs.length;
            const bugsFixed = testResults.bugs.length - bugsRemaining;

            this.logger.info('[PRPPipeline] Fix cycle complete', {
              bugsFixed,
              bugsRemaining,
              hasBugs: fixResults.hasBugs,
            });

            finalResults = fixResults;

            // Warning if bugs remain after fix cycle
            if (bugsRemaining > 0) {
              this.logger.warn(
                `[PRPPipeline] Fix cycle completed with ${bugsRemaining} bugs remaining`
              );
            }
          } catch (fixError) {
            // Fix cycle failure - log but use original test results
            const errorMessage =
              fixError instanceof Error ? fixError.message : String(fixError);
            this.logger.warn(
              `[PRPPipeline] Fix cycle failed (continuing with original results): ${errorMessage}`
            );
            // Keep original testResults as finalResults
          }
        }
      }

      // ============================================================
      // Phase 3: Update state
      // ============================================================

      // finalResults is guaranteed assigned by exactly one of the two paths
      // above (resume-success XOR fresh path runs when !resumed).
      const resolvedResults = finalResults!;

      this.#bugsFound = resolvedResults.bugs.length;
      this.currentPhase = 'qa_complete';

      // ============================================================
      // Phase 4: Print console summary
      // ============================================================

      console.log('\n' + '='.repeat(60));
      console.log('🐛 QA Summary');
      console.log('='.repeat(60));

      if (resolvedResults.bugs.length === 0) {
        console.log('✅ No bugs found - all tests passed!');
      } else {
        console.log(`📊 Total bugs found: ${resolvedResults.bugs.length}`);

        const criticalCount = resolvedResults.bugs.filter(
          b => b.severity === 'critical'
        ).length;
        const majorCount = resolvedResults.bugs.filter(
          b => b.severity === 'major'
        ).length;
        const minorCount = resolvedResults.bugs.filter(
          b => b.severity === 'minor'
        ).length;
        const cosmeticCount = resolvedResults.bugs.filter(
          b => b.severity === 'cosmetic'
        ).length;

        console.log(`  🔴 Critical: ${criticalCount}`);
        console.log(`  🟠 Major: ${majorCount}`);
        console.log(`  🟡 Minor: ${minorCount}`);
        console.log(`  ⚪ Cosmetic: ${cosmeticCount}`);

        console.log(`\n${resolvedResults.summary}`);

        if (criticalCount > 0 || majorCount > 0) {
          console.log(
            '\n⚠️  Critical or major bugs detected - manual review recommended'
          );
        }

        console.log(`\n📄 Detailed results: ${sessionPath}/TEST_RESULTS.md`);
      }

      console.log('='.repeat(60) + '\n');

      this.logger.info('[PRPPipeline] QA cycle complete');
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // Check if error is fatal
      if (isFatalError(error, this.#continueOnError)) {
        this.logger.error(
          `[PRPPipeline] Fatal QA cycle error: ${errorMessage}`
        );
        throw error; // Re-throw to abort pipeline
      }

      // QA failure is non-fatal - track and continue
      this.#trackFailure('runQACycle', error, {
        phase: this.currentPhase,
      });
      this.logger.warn(
        `[PRPPipeline] QA cycle failed (non-fatal): ${errorMessage}`
      );
      this.#bugsFound = 0;
      this.currentPhase = 'qa_failed';
    }
  }

  /**
   * Construct + run the bug-fix cycle on a bugfix session dir (PRD §4.4).
   *
   * Shared by the fresh-hunt Phase 2 and the interrupted-breakdown resume
   * branch so both "re-enter the same path the bug-hunt stage uses when it
   * first finds bugs." runStandardBreakdown (P4.M2.T4.S1) writes tasks.json
   * into bugfixDir.
   *
   * @param bugfixDir - Existing bugfix session dir (must contain 'bugfix').
   * @param prdContent - PRD snapshot for QA context.
   * @returns Final TestResults from the fix cycle.
   * @private
   */
  async #runBugFixCycle(
    bugfixDir: string,
    prdContent: string
  ): Promise<TestResults> {
    const fixCycleWorkflow = new FixCycleWorkflow(
      bugfixDir,
      prdContent,
      this.taskOrchestrator,
      this.sessionManager,
      // PRD §4.2: forward parallel-research settings to the bugfix child
      // so its shared orchestrator's depth-chain prefetch stays active
      // during fix execution (the main items are already Complete by now).
      {
        parallelResearch: isParallelResearch(),
        researchDepth: getResearchDepth(),
      }
    );
    return await fixCycleWorkflow.run();
  }

  /**
   * Detect the most recent numbered bugfix child left in an interrupted state
   * (PRD §4.4 step 3, §5.1).
   *
   * @remarks
   * Scans ALL numbered children (`NNN_hash/`) of `sessionPath/bugfix/` and returns
   * the MOST RECENT one whose breakdown did not finish. "Interrupted" = the child
   * has a bug report (`TEST_RESULTS.md`) but its `tasks.json` is missing, empty,
   * unreadable, fails JSON parse, or fails `BacklogReadSchema` (lenient read-time)
   * validation. Children with a valid `tasks.json` (healthy/completed) are SKIPPED,
   * so resume works across multiple iterations (prior completed iterations are
   * preserved, not re-run). Children without `TEST_RESULTS.md` are skipped (never
   * properly hunted). Returns `null` when there is nothing to resume (no `bugfix/`
   * dir, no numbered children, or all children healthy).
   *
   * Mutual consistency with S2: `runQACycle` CREATES numbered `bugfix/NNN_hash/`
   * children; this method DETECTS them. The returned path still contains `'bugfix'`,
   * so `FixCycleWorkflow`'s path validation passes unchanged.
   *
   * @param sessionPath - The MAIN session dir (plan/NNN_hash).
   * @returns The most recent interrupted numbered bugfix child dir, or null.
   * @private
   */
  async #detectInterruptedBugfix(sessionPath: string): Promise<string | null> {
    const { resolve } = await import('node:path');
    const { readdir } = await import('node:fs/promises');

    const BUGFIX_CHILD_PATTERN = /^\d{3}_/;
    const bugfixDir = resolve(sessionPath, 'bugfix');

    // (a) Read sessionPath/bugfix/ — ENOENT means never hunted.
    let entries: import('node:fs').Dirent[];
    try {
      entries = await readdir(bugfixDir, { withFileTypes: true });
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        return null; // no bugfix/ dir → never hunted
      }
      throw error; // non-ENOENT → propagate (unexpected)
    }

    // (b)+(c) Filter to numbered NNN_* child DIRS, sort by sequence DESC (most recent first).
    const numberedChildren = entries
      .filter(e => e.isDirectory() && BUGFIX_CHILD_PATTERN.test(e.name))
      .map(e => {
        const seq = parseInt(e.name.slice(0, 3), 10);
        return { dir: resolve(bugfixDir, e.name), seq };
      })
      .sort((a, b) => b.seq - a.seq);

    // (d)+(e)+(f) Find the first (most recent) interrupted child.
    for (const child of numberedChildren) {
      const interrupted = await this.#isBugfixChildInterrupted(child.dir);
      if (interrupted) {
        return child.dir; // most recent interrupted
      }
      // healthy (or never-hunted) → skip, continue to older children
    }
    return null; // no interrupted child
  }

  /**
   * Check a single numbered bugfix child dir for an interrupted-breakdown state.
   *
   * @remarks
   * "Interrupted" = `TEST_RESULTS.md` exists (a bug report was committed) but
   * `tasks.json` is missing, empty, unreadable, fails JSON parse, or fails
   * `BacklogReadSchema` (lenient read-time) validation. A child WITHOUT
   * `TEST_RESULTS.md` returns `false` (never properly hunted → skip).
   *
   * @param childDir - A numbered bugfix/NNN_hash/ child dir.
   * @returns true if this child is interrupted (should be resumed).
   * @private
   */
  async #isBugfixChildInterrupted(childDir: string): Promise<boolean> {
    const { resolve } = await import('node:path');
    const { stat, readFile } = await import('node:fs/promises');
    const testResultsPath = resolve(childDir, 'TEST_RESULTS.md');
    const tasksPath = resolve(childDir, 'tasks.json');

    // No bug report → never hunted in this child → not interrupted (skip).
    try {
      await stat(testResultsPath);
    } catch {
      return false;
    }

    // Bug report present → tasks.json must be valid; anything else = interrupted.
    try {
      await stat(tasksPath);
    } catch {
      return true; // missing
    }
    let content: string;
    try {
      content = await readFile(tasksPath, 'utf-8');
    } catch {
      return true; // unreadable
    }
    if (content.trim() === '') {
      return true; // empty
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return true; // corrupt JSON
    }
    if (!BacklogReadSchema.safeParse(parsed).success) {
      return true; // invalid Backlog (lenient read-time schema)
    }
    return false; // healthy
  }

  /**
   * Extract completed tasks from session backlog
   *
   * @returns Array of completed Task objects
   * @private
   */
  #extractCompletedTasks(): Task[] {
    const backlog = this.sessionManager.currentSession?.taskRegistry;
    if (!backlog) {
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
   * Cleanup and state preservation before shutdown
   *
   * @remarks
   * Called from run() method's finally block to ensure cleanup
   * happens even on error or interruption. Saves current state
   * and removes signal listeners to prevent memory leaks.
   */
  @Step({ trackTiming: true })
  async cleanup(): Promise<void> {
    this.logger.info('[PRPPipeline] Starting cleanup and state preservation');

    try {
      // CRITICAL: Stop progress display (must happen before other cleanup)
      this.#progressDisplay?.stop();
      this.logger.debug('[PRPPipeline] Progress display stopped');

      // CRITICAL: Stop resource monitoring
      if (this.#resourceMonitor) {
        this.#resourceMonitor.stop();
        this.logger.debug('[PRPPipeline] Resource monitoring stopped');
      }

      // Log progress state before shutdown
      const progress = this.#progressTracker?.getProgress();
      if (progress) {
        this.logger.info('[PRPPipeline] 💾 Saving progress state', {
          completedTasks: progress.completed,
          pendingTasks: progress.remaining,
          totalTasks: progress.total,
          completionRate: `${progress.percentage.toFixed(1)}%`,
          elapsed: `${progress.elapsed}ms`,
          eta: progress.eta === Infinity ? null : progress.eta,
        });
      }

      // Check if sessionManager was initialized
      if (!this.sessionManager) {
        this.logger.warn(
          '[PRPPipeline] SessionManager not initialized, skipping state save'
        );
        // Still remove signal listeners
        if (this.#sigintHandler) {
          process.off('SIGINT', this.#sigintHandler);
          this.logger.debug('[PRPPipeline] SIGINT handler removed');
        }
        if (this.#sigtermHandler) {
          process.off('SIGTERM', this.#sigtermHandler);
          this.logger.debug('[PRPPipeline] SIGTERM handler removed');
        }
        this.currentPhase = 'shutdown_complete';
        this.logger.info('[PRPPipeline] Cleanup complete (no session)');
        return;
      }

      // Save current state
      const backlog = this.sessionManager.currentSession?.taskRegistry;
      if (backlog) {
        // FLUSH: Flush any pending batch updates before shutdown
        await this.sessionManager.flushUpdates();
        this.logger.debug('[PRPPipeline] Pending updates flushed on shutdown');

        await this.sessionManager.saveBacklog(backlog);
        this.logger.info('[PRPPipeline] ✅ State saved successfully');

        // Log state summary
        const completed = this.#countCompletedTasks();
        const remaining = this.totalTasks - completed;
        this.logger.info(
          `[PRPPipeline] State: ${completed} complete, ${remaining} remaining`
        );
      } else {
        this.logger.warn('[PRPPipeline] No session state to save');
      }

      // Remove signal listeners to prevent memory leaks
      if (this.#sigintHandler) {
        process.off('SIGINT', this.#sigintHandler);
        this.logger.debug('[PRPPipeline] SIGINT handler removed');
      }
      if (this.#sigtermHandler) {
        process.off('SIGTERM', this.#sigtermHandler);
        this.logger.debug('[PRPPipeline] SIGTERM handler removed');
      }

      // Check if resource limit was reached and generate report
      if (this.#resourceLimitReached) {
        await this.#generateResourceLimitReport();
      }

      this.currentPhase = 'shutdown_complete';
      this.logger.info('[PRPPipeline] Cleanup complete');
    } catch (error) {
      // Log but don't throw - cleanup failures shouldn't prevent shutdown
      this.logger.error(`[PRPPipeline] Cleanup failed: ${error}`);
    }
  }

  /**
   * Generates error report if any failures occurred
   *
   * @remarks
   * Creates ERROR_REPORT.md in the session directory with:
   * - Summary of total/completed/failed tasks
   * - List of all failed tasks with error details
   * - Error categories breakdown
   * - Recommendations for fixing failures
   *
   * Only generates report if failedTasks Map is non-empty.
   *
   * @private
   */
  async #generateErrorReport(): Promise<void> {
    // No failures - skip report generation
    if (this.#failedTasks.size === 0) {
      return;
    }

    this.logger.info('[PRPPipeline] Generating error report', {
      failureCount: this.#failedTasks.size,
    });

    const sessionPath = this.sessionManager.currentSession?.metadata.path;
    if (!sessionPath) {
      this.logger.warn(
        '[PRPPipeline] Session path not available for error report'
      );
      return;
    }

    try {
      // Import ErrorReportBuilder dynamically
      const { ErrorReportBuilder } =
        await import('../utils/errors/error-reporter.js');

      // Build enhanced error report
      const startTime = new Date(this.#startTime);
      const currentSession = this.sessionManager.currentSession;
      if (!currentSession) {
        this.logger.warn(
          '[PRPPipeline] Current session not available for error report'
        );
        return;
      }
      const sessionId = currentSession.metadata.id;

      const builder = new ErrorReportBuilder(this.logger, startTime, sessionId);
      const reportContent = await builder.generateReport(this.#failedTasks, {
        sessionPath,
        sessionId,
        backlog: currentSession.taskRegistry,
        totalTasks: this.totalTasks,
        completedTasks: this.completedTasks,
        pipelineMode: this.mode,
        continueOnError: this.#continueOnError,
        startTime,
      });

      // Write error report to session directory
      const { resolve } = await import('node:path');
      const { writeFile } = await import('node:fs/promises');
      const reportPath = resolve(sessionPath, 'ERROR_REPORT.md');

      await writeFile(reportPath, reportContent, 'utf-8');
      this.logger.info(`[PRPPipeline] Error report written to ${reportPath}`);
    } catch (error) {
      this.logger.error('[PRPPipeline] Failed to generate error report', {
        error,
      });

      // Fallback to simple error report if enhanced generation fails
      await this.#generateFallbackErrorReport(sessionPath);
    }
  }

  /**
   * Fallback error report generation if enhanced reporter fails
   *
   * @param sessionPath - Path to session directory
   *
   * @remarks
   * Simple error report generation as fallback when the enhanced
   * error reporter encounters an error.
   *
   * @private
   */
  async #generateFallbackErrorReport(sessionPath: string): Promise<void> {
    const failures = Array.from(this.#failedTasks.values());

    const content = `# Error Report (Fallback)

**Generated**: ${new Date().toISOString()}
**Pipeline Mode**: ${this.mode}

## Failed Tasks

${failures
  .map(
    failure => `### ${failure.taskId}: ${failure.taskTitle}

**Error**: ${failure.error.message}
`
  )
  .join('\n---\n')}

**Report Location**: ${sessionPath}/ERROR_REPORT.md
`;

    const { resolve } = await import('node:path');
    const { writeFile } = await import('node:fs/promises');
    const reportPath = resolve(sessionPath, 'ERROR_REPORT.md');

    await writeFile(reportPath, content, 'utf-8');
    this.logger.info(
      `[PRPPipeline] Fallback error report written to ${reportPath}`
    );
  }

  /**
   * Generates resource limit report when resource limit is reached
   *
   * @remarks
   * Creates RESOURCE_LIMIT_REPORT.md in the session directory with:
   * - Resource snapshot (file handles, memory)
   * - Task progress summary
   * - Actionable suggestions for resolution
   * - Resume instructions
   *
   * Only generates report if resource limit was reached.
   *
   * @private
   */
  async #generateResourceLimitReport(): Promise<void> {
    const status = this.#resourceMonitor?.getStatus();
    if (!status || !status.shouldStop) {
      return;
    }

    const sessionPath = this.sessionManager.currentSession?.metadata.path;
    if (!sessionPath) {
      this.logger.warn(
        '[PRPPipeline] Session path not available for resource report'
      );
      return;
    }

    const progress = this.#progressTracker?.getProgress();
    const snapshot = status.snapshot;

    const content = `# Resource Limit Report

**Generated**: ${new Date().toISOString()}
**Limit Type**: ${status.limitType}
**Tasks Completed**: ${progress?.completed ?? 0} / ${progress?.total ?? 0}

## Summary

The pipeline reached a resource limit and gracefully shut down to prevent system exhaustion.

### Resource Snapshot

| Metric | Value |
|--------|-------|
| File Handles | ${snapshot.fileHandles} |
| File Handle Limit | ${
      snapshot.fileHandleUlimit > 0
        ? snapshot.fileHandleUlimit
        : 'N/A (Windows)'
    } |
| File Handle Usage | ${(snapshot.fileHandleUsage * 100).toFixed(1)}% |
| Heap Used | ${(snapshot.heapUsed / 1024 / 1024).toFixed(1)} MB |
| Heap Total | ${(snapshot.heapTotal / 1024 / 1024).toFixed(1)} MB |
| System Memory Used | ${(
      (1 - snapshot.systemFree / snapshot.systemTotal) *
      100
    ).toFixed(1)}% |

### Progress

- **Completed**: ${progress?.completed ?? 0} tasks
- **Remaining**: ${progress?.remaining ?? 0} tasks
- **Completion**: ${progress?.percentage.toFixed(1) ?? 0}%
- **Elapsed**: ${
      progress?.elapsed ? (progress.elapsed / 1000).toFixed(1) + 's' : 'N/A'
    }

## Recommendations

${status.suggestion ? `- ${status.suggestion}` : ''}

### How to Resume

\`\`\`bash
# Resume from where the pipeline stopped
node dist/index.js --prd PRD.md --continue
\`\`\`

### If Hitting File Handle Limits

\`\`\`bash
# Increase file handle limit (Linux/macOS)
ulimit -n 4096

# Then re-run the pipeline
node dist/index.js --prd PRD.md --continue
\`\`\`

### If Hitting Memory Limits

1. Consider splitting your PRD into smaller phases
2. Use \`--scope P1.M1\` to limit execution to specific milestones
3. Increase system memory or close other applications

---

Report Location: ${sessionPath}/RESOURCE_LIMIT_REPORT.md
`;

    const { resolve } = await import('node:path');
    const { writeFile } = await import('node:fs/promises');
    const reportPath = resolve(sessionPath, 'RESOURCE_LIMIT_REPORT.md');

    await writeFile(reportPath, content, 'utf-8');
    this.logger.info(
      `[PRPPipeline] Resource limit report written to ${reportPath}`
    );
  }

  // ========================================================================
  // Main Entry Point
  // ========================================================================

  /**
   * Run the complete PRP Pipeline workflow
   *
   * @remarks
   * Orchestrates all steps in sequence:
   * 1. Initialize session
   * 2. Decompose PRD (if new session)
   * 3. Execute backlog (with graceful shutdown support)
   * 4. Run QA cycle
   * 5. Cleanup (always runs via finally block)
   *
   * Supports graceful shutdown via SIGINT/SIGTERM signals. When a signal
   * is received, the current task completes before the pipeline exits,
   * and state is preserved for resumption.
   *
   * Returns PipelineResult with execution summary including shutdown status.
   *
   * @returns Pipeline execution result with summary
   */
  async run(): Promise<PipelineResult> {
    this.#startTime = performance.now();
    this.setStatus('running');

    // Store current PID as string for guard operations
    const currentPid = process.pid.toString();

    // Keep the Node.js event loop alive for the entire duration of run().
    //
    // Rationale: the pipeline drives long-running work (LLM calls via the
    // in-process agent harness) whose async chains contain handle-free windows
    // — dynamic imports of already-cached modules + synchronous agent/session
    // construction, all microtask-continuations, before the first HTTP socket is
    // established. Pending Promises do NOT keep the Node event loop alive; only
    // libuv handles (timers/sockets/watchers) do. During such a handle-free
    // window Node would otherwise exit(0) and silently abandon the in-flight
    // pipeline (the "dies in a few seconds, no errors" symptom). A single ref'd
    // interval guarantees the loop stays alive until run() resolves/rejects; the
    // finally block below clears it so the process can exit normally afterward.
    // (The ResourceMonitor interval also keeps the loop alive, but only when
    // --max-tasks/--max-duration is supplied — this covers the default path.)
    const keepAlive = setInterval(() => {}, 1000);

    this.correlationLogger.info(
      '[PRPPipeline] Starting PRP Pipeline workflow',
      {
        correlationId: this.#correlationId,
        prdPath: this.#prdPath,
        scope: this.#scope ?? 'all',
        mode: this.mode,
      }
    );
    this.logger.info('[PRPPipeline] Starting PRP Pipeline workflow');
    this.logger.info(`[PRPPipeline] PRD: ${this.#prdPath}`);
    this.logger.info(
      `[PRPPipeline] Scope: ${JSON.stringify(this.#scope ?? 'all')}`
    );

    // Debug logging for workflow entry point
    this.correlationLogger.debug(
      {
        prdPath: this.#prdPath,
        scope: this.#scope ?? 'all',
        mode: this.mode,
      },
      '[PRPPipeline] Starting PRP Pipeline workflow'
    );

    try {
      // Create SessionManager (may throw if PRD doesn't exist)
      this.sessionManager = new SessionManagerClass(
        this.#prdPath,
        this.#planDir,
        this.#flushRetries
      );

      // Validate no nested execution BEFORE setting guard
      // CRITICAL: Validation must happen before guard is set to prevent race condition
      if (this.sessionManager.currentSession?.metadata.path) {
        const sessionPath = this.sessionManager.currentSession.metadata.path;
        try {
          this.logger.debug(
            `[PRPPipeline] Checking for nested execution at ${sessionPath}`
          );
          validateNestedExecution(sessionPath);
          this.logger.debug(
            '[PRPPipeline] No nested execution detected, proceeding'
          );
        } catch (error) {
          if (isNestedExecutionError(error)) {
            this.logger.error(
              '[PRPPipeline] Nested execution detected - cannot proceed',
              {
                sessionPath,
                existingPid: error.context?.existingPid,
                currentPid: error.context?.currentPid,
              }
            );
            throw error; // Re-throw to prevent execution
          }
          throw error; // Re-throw other errors
        }
      }

      // Set guard after validation passes
      process.env.PRP_PIPELINE_RUNNING = currentPid;
      this.logger.debug(`[PRPPipeline] Set PRP_PIPELINE_RUNNING=${currentPid}`);

      // Log guard context for troubleshooting
      const planDir = this.sessionManager.planDir;
      const sessionDir =
        this.sessionManager.currentSession?.metadata.path ?? 'not set';
      const skipBugFinding = process.env.SKIP_BUG_FINDING ?? 'false';
      const running = process.env.PRP_PIPELINE_RUNNING ?? 'not set';

      this.logger.debug(
        `[PRPPipeline] Guard Context: PLAN_DIR=${planDir}, SESSION_DIR=${sessionDir}, SKIP_BUG_FINDING=${skipBugFinding}, PRP_PIPELINE_RUNNING=${running}`
      );

      // Execute workflow steps
      await this.initializeSession();

      // Debug logging after session initialization
      this.logger.debug('[PRPPipeline] Session initialized', {
        sessionPath: this.sessionManager?.currentSession?.metadata.path,
        hasExistingBacklog:
          (this.sessionManager?.currentSession?.taskRegistry?.backlog?.length ??
            0) > 0,
      });

      await this.decomposePRD();

      // The TaskOrchestrator was constructed in initializeSession() against an
      // empty (new-session) registry — before the Architect generated anything
      // (and, for delta sessions, before handleDelta() patched the backlog).
      // Now that the backlog exists and is synced into the session registry
      // (SessionManager.saveBacklog keeps memory == disk), rebuild the
      // execution queue from it. Without this the queue stays empty and
      // executeBacklog() processes nothing (the pipeline "completes" 0/0).
      // Guarded: if session init failed non-fatally before the orchestrator was
      // constructed, there is nothing to rebuild (executeBacklog surfaces the
      // failure) — never crash the pipeline here.
      if (this.taskOrchestrator) {
        await this.taskOrchestrator.rebuildQueue();
      }

      // Debug logging after PRD decomposition
      this.logger.debug('[PRPPipeline] PRD decomposition complete', {
        totalPhases:
          this.sessionManager?.currentSession?.taskRegistry?.backlog?.length ??
          0,
        totalTasks: this.totalTasks,
      });

      await this.executeBacklog();

      // Debug logging after backlog execution
      this.logger.debug('[PRPPipeline] Backlog execution complete', {
        completedTasks: this.completedTasks,
        totalTasks: this.totalTasks,
        failedTasks: this.#countFailedTasks(),
      });

      // PRD §4.4 step 1 (Validation Scripting): generate + run validate.sh.
      // Lives in run() — NOT inside runQACycle()'s try/catch — so a validation
      // abort propagates EVEN under --continue-on-error (runQACycle's catch
      // swallows non-fatal errors when continueOnError===true; isFatalError
      // returns false for ALL errors then). A throw here lands in run()'s catch
      // → returns a failure result, bypassing bug-hunt/commit. Runs in ALL
      // modes (fixes the --mode validate skip-QA defect).
      await this.#runValidation();

      await this.runQACycle();

      // Debug logging after QA cycle
      this.logger.debug('[PRPPipeline] QA cycle complete', {
        bugsFound: this.#bugsFound,
        mode: this.mode,
      });

      this.setStatus('completed');

      const duration = performance.now() - this.#startTime;
      const sessionPath =
        this.sessionManager.currentSession?.metadata.path ?? '';

      this.logger.info('[PRPPipeline] Workflow completed successfully');
      this.logger.info(`[PRPPipeline] Duration: ${duration.toFixed(0)}ms`);

      // GENERATE: Error report if any failures occurred
      await this.#generateErrorReport();

      // EXPORT: Metrics if output path is specified
      await this.#exportMetrics();

      return {
        success: this.#failedTasks.size === 0,
        hasFailures: this.#failedTasks.size > 0,
        sessionPath,
        totalTasks: this.totalTasks,
        completedTasks: this.completedTasks,
        failedTasks: this.#failedTasks.size,
        finalPhase: this.currentPhase,
        duration,
        phases: this.#summarizePhases(),
        bugsFound: this.#bugsFound,
        shutdownInterrupted: false, // Completed successfully
      };
    } catch (error) {
      this.setStatus('failed');

      const duration = performance.now() - this.#startTime;
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // Debug logging for error path
      this.logger.debug('[PRPPipeline] Workflow failed with error', {
        errorMessage,
        errorType: error instanceof Error ? error.constructor.name : 'Unknown',
        errorCode: (error as { code?: string })?.code,
        currentPhase: this.currentPhase,
        ...(error instanceof Error && { stack: error.stack }),
      });

      this.logger.error(`[PRPPipeline] Workflow failed: ${errorMessage}`);

      // GENERATE: Error report even on fatal error
      await this.#generateErrorReport();

      // EXPORT: Metrics even on failure
      await this.#exportMetrics();

      return {
        success: false,
        hasFailures: this.#failedTasks.size > 0,
        sessionPath: this.sessionManager?.currentSession?.metadata.path ?? '',
        totalTasks: this.totalTasks,
        completedTasks: this.completedTasks,
        failedTasks: this.#failedTasks.size,
        finalPhase: this.currentPhase,
        duration,
        phases: [],
        bugsFound: this.#bugsFound,
        error: errorMessage,
        shutdownInterrupted: this.shutdownRequested, // May have been interrupted
        shutdownReason: this.shutdownReason ?? undefined,
      };
    } finally {
      // Release the loop-alive handle acquired at the top of run() so the
      // process can exit naturally once the pipeline is done.
      clearInterval(keepAlive);

      // Clear guard if we own it (before cleanup)
      if (process.env.PRP_PIPELINE_RUNNING === currentPid) {
        delete process.env.PRP_PIPELINE_RUNNING;
        this.logger.debug('[PRPPipeline] Cleared PRP_PIPELINE_RUNNING');
      }

      // Always cleanup, even if interrupted or errored
      await this.cleanup();
    }
  }

  // ========================================================================
  // Private Helper Methods
  // ========================================================================

  /**
   * Counts total subtasks in backlog
   */
  #countTasks(): number {
    if (!this.sessionManager) return 0;
    const backlog = this.sessionManager.currentSession?.taskRegistry;
    if (!backlog) return 0;

    let count = 0;
    for (const phase of backlog.backlog) {
      for (const milestone of phase.milestones) {
        for (const task of milestone.tasks) {
          count += task.subtasks.length;
        }
      }
    }
    return count;
  }

  /**
   * Counts completed subtasks
   */
  #countCompletedTasks(): number {
    if (!this.sessionManager) return 0;
    const backlog = this.sessionManager.currentSession?.taskRegistry;
    if (!backlog) return 0;

    let count = 0;
    for (const phase of backlog.backlog) {
      for (const milestone of phase.milestones) {
        for (const task of milestone.tasks) {
          count += task.subtasks.filter(s => s.status === 'Complete').length;
        }
      }
    }
    return count;
  }

  /**
   * Counts failed subtasks
   */
  #countFailedTasks(): number {
    if (!this.sessionManager) return 0;
    const backlog = this.sessionManager.currentSession?.taskRegistry;
    if (!backlog) return 0;

    let count = 0;
    for (const phase of backlog.backlog) {
      for (const milestone of phase.milestones) {
        for (const task of milestone.tasks) {
          count += task.subtasks.filter(s => s.status === 'Failed').length;
        }
      }
    }
    return count;
  }

  /**
   * Checks if all tasks are complete
   */
  #allTasksComplete(): boolean {
    const backlog = this.sessionManager.currentSession?.taskRegistry;
    if (!backlog) return false;

    for (const phase of backlog.backlog) {
      for (const milestone of phase.milestones) {
        for (const task of milestone.tasks) {
          for (const subtask of task.subtasks) {
            if (subtask.status !== 'Complete') {
              return false;
            }
          }
        }
      }
    }
    return true;
  }

  /**
   * All-subtasks-Complete predicate over an arbitrary {@link Backlog}.
   *
   * @remarks
   * Mirrors {@link PRPPipeline.#allTasksComplete} but operates on an externally
   * supplied backlog (e.g. one loaded via {@link readTasksJSON} for the reuse
   * completion probe) rather than the current session's task registry. An empty
   * backlog (no subtasks) is considered vacuously complete.
   *
   * @param backlog - The backlog to inspect.
   * @returns `true` if every subtask has status `'Complete'`.
   */
  #isBacklogComplete(backlog: Backlog): boolean {
    for (const phase of backlog.backlog) {
      for (const milestone of phase.milestones) {
        for (const task of milestone.tasks) {
          for (const subtask of task.subtasks) {
            if (subtask.status !== 'Complete') {
              return false;
            }
          }
        }
      }
    }
    return true;
  }

  /**
   * PRD §4.3 step 2 ("Validate/bug-hunt re-runs reuse the completed session"):
   * reuse detection for validate-only / bug-hunt-only re-runs.
   *
   * @remarks
   * When the pipeline runs in `--mode validate` or `--mode bug-hunt` against an
   * already-completed session that has a pending PRD change, this helper decides
   * whether to reuse the latest completed session (returning `true`) instead of
   * letting {@link SessionManager.initialize} create a new empty session.
   *
   * Detection (returns `false` — fall through to normal `initialize()` — on any
   * non-reuse case):
   * 1. No latest session exists → nothing to reuse.
   * 2. The latest session's hash already matches the current PRD hash → no pending
   *    change; normal `initialize()` will load it by hash anyway.
   * 3. The latest session's tasks are NOT all `Complete` → do not reuse an
   *    incomplete session (the contract is about completed sessions).
   *
   * On reuse, it loads the completed session as the current session via
   * {@link SessionManager.loadSessionAsCurrent} (which caches the loaded session's
   * hash as `#prdHash` in memory only — so `hasSessionChanged()` reports false —
   * leaving the on-disk PRD change pending) and logs an explanatory message. The
   * pending change is intentionally left in place so the next normal run processes
   * it into a proper delta session.
   *
   * @returns `true` if a completed session with a pending change was reused;
   *          `false` to fall through to the normal {@link SessionManager.initialize} path.
   */
  private async tryReuseCompletedSessionForReRun(): Promise<boolean> {
    const planDir = this.sessionManager.planDir;
    const latest = await SessionManagerClass.findLatestSession(planDir);
    if (!latest) {
      // No sessions at all — normal initialize() will create the first one.
      return false;
    }
    // Current PRD hash (resolved + hashed, 12-char prefix to match dir-name hashes).
    const currentHash = (await hashPRD(this.sessionManager.prdPath)).slice(
      0,
      12
    );
    if (latest.hash === currentHash) {
      // No pending change on the latest session — normal initialize() loads it by hash.
      return false;
    }
    // Pending change detected. Check whether the latest session is COMPLETED
    // (completion is derived from tasks.json — there is no session-level status field).
    const backlog = await readTasksJSON(latest.path);
    if (!this.#isBacklogComplete(backlog)) {
      // Latest session is incomplete — do not reuse; fall through to normal init.
      return false;
    }
    // REUSE: load the completed session as current WITHOUT initialize()/
    // createDeltaSession(), and WITHOUT refreshing prd_snapshot.md.
    this.logger.info(
      `[PRPPipeline] ${this.mode} mode: reusing completed session ${latest.id} ` +
        'for re-run; pending PRD change left in place for the next normal run'
    );
    await this.sessionManager.loadSessionAsCurrent(latest.path);
    return true;
  }

  /**
   * Builds phase summary array
   */
  #summarizePhases(): PhaseSummary[] {
    if (!this.sessionManager) return [];
    const backlog = this.sessionManager.currentSession?.taskRegistry;
    if (!backlog) return [];

    return backlog.backlog.map(phase => ({
      id: phase.id,
      title: phase.title,
      status: phase.status,
      totalMilestones: phase.milestones.length,
      completedMilestones: phase.milestones.filter(m => m.status === 'Complete')
        .length,
    }));
  }

  /**
   * Exports metrics to JSON file if metrics collector is initialized
   *
   * @remarks
   * Collects cache statistics and resource data from the pipeline
   * and exports the complete metrics snapshot to the specified output path.
   *
   * @private
   */
  async #exportMetrics(): Promise<void> {
    if (!this.#metricsCollector || !this.#metricsOutputPath) {
      return;
    }

    try {
      // Get final metrics snapshot
      const snapshot = this.#metricsCollector.getSnapshot();

      // Update metadata with pipeline context
      snapshot.metadata.sessionPath =
        this.sessionManager?.currentSession?.metadata.path ?? '';
      snapshot.metadata.correlationId = this.#correlationId;

      // Export to file
      await this.#metricsCollector.exportToFile(this.#metricsOutputPath);

      this.logger.info('[PRPPipeline] Metrics exported successfully', {
        path: this.#metricsOutputPath,
        taskTimings: Object.keys(snapshot.taskTimings).length,
        resourceSnapshots: snapshot.resourceSnapshots.length,
      });
    } catch (error) {
      // Log but don't fail pipeline
      this.logger.warn('[PRPPipeline] Failed to export metrics', {
        error: error instanceof Error ? error.message : String(error),
        path: this.#metricsOutputPath,
      });
    }
  }
}
