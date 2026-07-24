/**
 * Task Orchestrator for PRP Pipeline backlog processing
 *
 * @module core/task-orchestrator
 *
 * @remarks
 * Provides recursive depth-first traversal (DFS) of the task backlog hierarchy
 * with type-specific execution delegation for each hierarchy level.
 *
 * Uses existing task-utils.ts functions for hierarchy navigation and manipulation.
 * Integrates with SessionManager for persistent state management.
 *
 * Implements the "Task Orchestrator" of the Four Core Processing Engines.
 *
 * @example
 * ```typescript
 * import { TaskOrchestrator } from './core/task-orchestrator.js';
 *
 * const orchestrator = new TaskOrchestrator(sessionManager);
 * while (await orchestrator.processNextItem()) {
 *   // Continue processing until backlog complete
 * }
 * ```
 */

import type { SessionManager } from './session-manager.js';
import { getLogger } from '../utils/logger.js';
import type { Logger } from '../utils/logger.js';
import type {
  Backlog,
  Phase,
  Milestone,
  Task,
  Subtask,
  Status,
  PRPCompressionLevel,
} from './models.js';
import { BacklogSchema } from './models.js';
import type { HierarchyItem } from '../utils/task-utils.js';
import { getDependencies, findItem } from '../utils/task-utils.js';
import type { Scope } from './scope-resolver.js';
import { resolveScope } from './scope-resolver.js';
import { smartCommit } from '../utils/git-commit.js';
import { gitReadFileAtCommit } from '../tools/git-mcp.js';
import { TaskError } from '../utils/errors.js';
import { atomicWrite, readTasksJSON } from './session-utils.js';
import { recoverTasksJson } from './tasks-json-recovery.js';
import { join, relative, resolve } from 'node:path';
import { ResearchQueue, ResearchTimeoutError } from './research-queue.js';
import { PRPRuntime } from '../agents/prp-runtime.js';
import {
  getIssueRetryMax,
  isParallelResearch,
  getResearchDepth,
} from '../config/constants.js';
import {
  ConcurrentTaskExecutor,
  type ParallelismConfig,
} from './concurrent-executor.js';
import {
  TaskRetryManager,
  type TaskRetryConfig,
} from './task-retry-manager.js';
import { createCleanupRunner, type CleanupRunner } from './cleanup-runner.js';

/** Local structural type so the method doesn't need to import ExecutionResult directly */
type ExecutionResultLike = {
  readonly success: boolean;
  readonly outcome?: 'success' | 'fail' | 'issue';
};

/**
 * Constructor options bag for {@link TaskOrchestrator} (DI-light).
 *
 * @remarks
 * Trailing options object — backward compatible with all existing positional
 * constructor callers (they simply omit it). P3.M1.T3.S3 wires the real
 * cleanup-agent persona through {@link cleanupRunner}.
 */
export interface TaskOrchestratorOptions {
  /**
   * Injected cleanup runner. Defaults to the no-op
   * {@link createCleanupRunner}. P3.M1.T3.S3 wires the real cleanup-agent
   * persona here. Cleanup failure is always non-fatal to `executeSubtask`.
   */
  readonly cleanupRunner?: CleanupRunner;
}

/**
 * Task Orchestrator for PRP Pipeline backlog processing
 *
 * @remarks
 * Provides recursive depth-first traversal (DFS) of the task backlog hierarchy
 * with type-specific execution delegation for each hierarchy level.
 *
 * The orchestrator processes items in DFS pre-order traversal:
 * Phase → Milestone → Task → Subtask (parent before children).
 *
 * Parent items (Phase, Milestone, Task) set their status to 'Implementing'
 * and delegate child processing to the main loop via processNextItem().
 *
 * Subtasks are the main execution unit - this PRP implements a placeholder
 * that logs the action and marks as complete. Actual PRP generation and
 * Coder agent execution will be added in P3.M3.T1.
 */
export class TaskOrchestrator {
  /** Logger instance for structured logging */
  readonly #logger: Logger;

  /** Session state manager for persistence */
  readonly sessionManager: SessionManager;

  /** Current task registry (read from SessionManager) */
  #backlog: Backlog;

  /** Scope for limiting execution (undefined = all items) */
  #scope: Scope | undefined;

  /** Queue of items to execute (populated from scope) */
  #executionQueue: HierarchyItem[];

  /** Research queue for parallel PRP generation */
  readonly researchQueue: ResearchQueue;

  /** PRP runtime for execution */
  readonly #prpRuntime: PRPRuntime;

  /** Cache metrics tracking */
  #cacheHits: number = 0;
  #cacheMisses: number = 0;

  /** Cache bypass flag from CLI --no-cache */
  readonly #noCache: boolean;

  /** Configurable research queue concurrency limit */
  readonly #researchQueueConcurrency: number;

  /** Cache TTL in milliseconds */
  readonly #cacheTtlMs: number;

  /** PRP compression level */
  readonly #prpCompression: PRPCompressionLevel;

  /** Task retry manager for automatic retry of failed subtasks */
  readonly #retryManager: TaskRetryManager;

  /** Per-item issue-driven re-planning attempt counts (PRD §4.5). Bounded by getIssueRetryMax(). */
  #issueAttempts: Map<string, number> = new Map();

  /** Injectable cleanup runner (DI-light). Defaults to the no-op createCleanupRunner(). */
  readonly #cleanupRunner: CleanupRunner;

  /** Current item ID being processed (for progress tracking) */
  currentItemId: string | null = null;

  /**
   * Creates a new TaskOrchestrator instance
   *
   * @param sessionManager - Session state manager for persistence
   * @param scope - Optional scope to limit execution (defaults to all items)
   * @param noCache - Whether to bypass cache (default: false)
   * @param researchQueueConcurrency - Max concurrent research tasks (default: 3)
   * @param cacheTtlMs - Cache TTL in milliseconds (default: 24 hours)
   * @param prpCompression - PRP compression level (default: 'standard')
   * @param retryConfig - Optional retry configuration (default: enabled with 3 max attempts)
   * @throws {Error} If sessionManager.currentSession is null
   *
   * @remarks
   * When scope is provided, only items matching the scope will be executed.
   * When scope is undefined, all items in the backlog will be executed.
   * The execution queue is populated by resolving the scope against the backlog.
   */
  constructor(
    sessionManager: SessionManager,
    scope?: Scope,
    noCache: boolean = false,
    researchQueueConcurrency: number = 3,
    cacheTtlMs: number = 24 * 60 * 60 * 1000,
    prpCompression: PRPCompressionLevel = 'standard',
    retryConfig?: Partial<TaskRetryConfig>,
    options?: TaskOrchestratorOptions
  ) {
    this.#logger = getLogger('TaskOrchestrator');
    this.sessionManager = sessionManager;
    this.#noCache = noCache;
    this.#researchQueueConcurrency = researchQueueConcurrency;
    this.#cacheTtlMs = cacheTtlMs;
    this.#prpCompression = prpCompression;
    // DI-light cleanup seam: default no-op; S3 (P3.M1.T3.S3) wires the real persona.
    this.#cleanupRunner = options?.cleanupRunner ?? createCleanupRunner();

    // Load initial backlog from session state
    const currentSession = sessionManager.currentSession;
    if (!currentSession) {
      throw new Error('Cannot create TaskOrchestrator: no active session');
    }

    this.#backlog = currentSession.taskRegistry;

    // Store scope and build execution queue
    this.#scope = scope;
    this.#executionQueue = this.#buildQueue(scope);

    // Initialize ResearchQueue with configurable concurrency and cache TTL
    this.researchQueue = new ResearchQueue(
      this.sessionManager,
      this.#researchQueueConcurrency,
      this.#noCache,
      this.#cacheTtlMs
    );
    this.#logger.debug(
      { maxSize: this.#researchQueueConcurrency, cacheTtlMs: this.#cacheTtlMs },
      'ResearchQueue initialized'
    );

    // Initialize PRPRuntime for execution
    this.#prpRuntime = new PRPRuntime(
      this,
      this.#cacheTtlMs,
      this.#prpCompression
    );
    this.#logger.debug('PRPRuntime initialized for subtask execution');

    // Initialize retry manager with optional config
    this.#retryManager = new TaskRetryManager(retryConfig, sessionManager);
    this.#logger.debug('TaskRetryManager initialized for subtask retry');
  }

  /**
   * Builds the execution queue from scope
   *
   * @param scope - Optional scope to resolve (defaults to 'all')
   * @returns Array of items to execute
   *
   * @remarks
   * Uses resolveScope() from scope-resolver.ts to convert scope to item list.
   * Returns all leaf subtasks when scope is undefined or 'all'.
   * Returns empty array for non-existent scope IDs (valid - no items to execute).
   */
  #buildQueue(scope?: Scope): HierarchyItem[] {
    // Default to 'all' scope if not provided
    const scopeToResolve = scope ?? { type: 'all' };

    // Resolve scope to list of items
    const items = resolveScope(this.#backlog, scopeToResolve);

    this.#logger.info(
      { itemCount: items.length, scope: JSON.stringify(scopeToResolve) },
      'Execution queue built'
    );

    return items;
  }

  /**
   * Depth-chained research supervisor (PRD §4.2).
   *
   * @remarks
   * When `PARALLEL_RESEARCH` is enabled, enqueues up to
   * {@link getResearchDepth} UPCOMING subtasks (ahead of the current
   * implementation cursor) into the {@link ResearchQueue}.
   * `enqueue()`'s dedup (`researching.has` / `results.has`) makes this
   * idempotent and safe to call repeatedly. When disabled, this is a no-op
   * and the legacy flat-pool / synchronous-`researchNow` path is used
   * (backward compatibility).
   *
   * The `enqueue` call is intentionally fire-and-forget: dedup +
   * `processNext` cap concurrency, and {@link ResearchQueue.waitForPRP}
   * surfaces real research errors at consume time. The `.catch` is
   * MANDATORY to avoid an unhandled promise rejection.
   *
   * Only `Subtask`-type items are enqueued (leaf subtasks are the
   * researchable chain ahead per PRD §4.2); non-subtask items are skipped.
   *
   * `depth` (how far ahead) and `maxSize` (how many `generate()` at once)
   * are ORTHOGONAL — this method bounds the former; the pool caps the latter.
   *
   * @param upcomingSubtasks - the subtasks ahead of the current item, in
   *   execution order (caller passes the already-shifted `#executionQueue`).
   */
  #prefetchResearchAhead(upcomingSubtasks: HierarchyItem[]): void {
    if (!isParallelResearch()) {
      return; // legacy path — no behavior change
    }
    const depth = getResearchDepth();
    let enqueued = 0;
    for (const item of upcomingSubtasks) {
      if (enqueued >= depth) break;
      if (item.type !== 'Subtask') continue; // only leaf subtasks are researchable
      // enqueue is async but we intentionally fire-and-forget here: dedup +
      // processNext cap concurrency; waitForPRP surfaces errors at consume time.
      this.researchQueue
        .enqueue(item as Subtask, this.#backlog)
        .catch(error => {
          const msg = error instanceof Error ? error.message : String(error);
          this.#logger.warn(
            { subtaskId: item.id, error: msg },
            'Depth-chain prefetch enqueue failed (non-critical)'
          );
        });
      enqueued++;
    }
  }

  /**
   * Gets the current backlog (read-only access)
   *
   * @returns Current backlog state
   */
  get backlog(): Backlog {
    return this.#backlog;
  }

  /**
   * Gets the current execution queue (read-only access for testing)
   *
   * @returns Copy of execution queue (external code can't mutate internal state)
   *
   * @remarks
   * Returns a shallow copy to prevent external mutation of the internal queue.
   * Mainly intended for testing - production code uses processNextItem() instead.
   */
  get executionQueue(): HierarchyItem[] {
    // Return shallow copy to prevent external mutation
    return [...this.#executionQueue];
  }

  /**
   * Gets the PRP Runtime instance
   *
   * @returns PRPRuntime instance for subtask execution
   *
   * @remarks
   * Public accessor for ConcurrentTaskExecutor to execute subtasks.
   * The PRPRuntime orchestrates PRP generation and execution.
   */
  get prpRuntime(): PRPRuntime {
    return this.#prpRuntime;
  }

  /**
   * Sets item status with logging and state persistence
   *
   * @param itemId - Item ID to update (e.g., "P1.M1.T1.S1")
   * @param status - New status value
   * @param reason - Optional reason for status change (for debugging)
   * @throws {Error} If SessionManager.updateItemStatus() fails
   *
   * @remarks
   * Public wrapper for SessionManager.updateItemStatus() that:
   * 1. Logs the status transition with structured information
   * 2. Persists the status change via SessionManager
   * 3. Refreshes backlog to get latest state
   *
   * Logs include: timestamp, itemId, oldStatus, newStatus, reason
   */
  public async setStatus(
    itemId: string,
    status: Status,
    reason?: string
  ): Promise<void> {
    // Import findItem utility to get current item for oldStatus
    const { findItem } = await import('../utils/task-utils.js');

    // PATTERN: Get current item to capture oldStatus for logging
    const currentItem = findItem(this.#backlog, itemId);
    const oldStatus = currentItem?.status ?? 'Unknown';
    const timestamp = new Date().toISOString();

    this.#logger.info(
      { itemId, oldStatus, newStatus: status, timestamp, reason },
      'Status transition'
    );

    // PATTERN: Persist status change through SessionManager
    // NOTE: reason is only for logging, not passed to SessionManager (API doesn't support it)
    await this.sessionManager.updateItemStatus(itemId, status);

    // PATTERN: Reload backlog to get latest state
    await this.refreshBacklog();
  }

  /**
   * Checks if a subtask can execute based on its dependencies
   *
   * @param subtask - The subtask to check
   * @returns true if all dependencies are Complete or no dependencies exist
   *
   * @remarks
   * Uses getDependencies utility to resolve dependency IDs to actual Subtask objects.
   * Returns true if the subtask has no dependencies (empty array).
   * Returns true only when ALL dependencies have status === 'Complete'.
   * Returns false if ANY dependency is not Complete.
   *
   * @example
   * ```typescript
   * const subtask = createTestSubtask('P1.M1.T1.S2', 'Subtask 2', 'Planned', ['P1.M1.T1.S1']);
   * const canExecute = orchestrator.canExecute(subtask);
   * // Returns false if P1.M1.T1.S1 is not Complete
   * ```
   */
  public canExecute(subtask: Subtask): boolean {
    // PATTERN: Use getDependencies utility from task-utils
    const dependencies = getDependencies(subtask, this.#backlog);

    // GOTCHA: Empty array means no dependencies = can execute
    if (dependencies.length === 0) {
      return true;
    }

    // PATTERN: Array.every() checks ALL items match condition
    // CRITICAL: Use strict string equality for status comparison
    const allComplete = dependencies.every(dep => dep.status === 'Complete');

    return allComplete;
  }

  /**
   * Gets the dependencies that are blocking a subtask from executing
   *
   * @param subtask - The subtask to check
   * @returns Array of incomplete dependency Subtask objects
   *
   * @remarks
   * Uses getDependencies utility to resolve dependency IDs to actual Subtask objects.
   * Filters dependencies where status !== 'Complete'.
   * Returns empty array if no blocking dependencies exist.
   *
   * @example
   * ```typescript
   * const blockers = orchestrator.getBlockingDependencies(subtask);
   * console.log(`Blocked on: ${blockers.map(b => b.id).join(', ')}`);
   * ```
   */
  public getBlockingDependencies(subtask: Subtask): Subtask[] {
    // PATTERN: Use getDependencies utility from task-utils
    const dependencies = getDependencies(subtask, this.#backlog);

    // PATTERN: Array.filter() returns NEW array (immutable)
    // CRITICAL: Check for NOT Complete to find blockers
    const blocking = dependencies.filter(dep => dep.status !== 'Complete');

    return blocking;
  }

  /**
   * Waits for a subtask's dependencies to become Complete
   *
   * @param subtask - The subtask whose dependencies to wait for
   * @param options - Optional configuration for timeout and interval
   * @returns Promise that resolves when dependencies are Complete
   * @throws {Error} If timeout is exceeded before dependencies are Complete
   *
   * @remarks
   * Polls canExecute() at intervals until all dependencies are Complete or timeout.
   * This is a placeholder for future async workflow enhancement.
   * Current implementation uses simple polling; event-driven in future.
   *
   * @example
   * ```typescript
   * try {
   *   await orchestrator.waitForDependencies(subtask, { timeout: 5000 });
   *   // Dependencies are now Complete
   * } catch (error) {
   *   // Timeout - dependencies not ready within 5 seconds
   * }
   * ```
   */
  public async waitForDependencies(
    subtask: Subtask,
    options: { timeout?: number; interval?: number } = {}
  ): Promise<void> {
    // PATTERN: Default values with destructuring
    const { timeout = 30000, interval = 1000 } = options;

    const startTime = Date.now();

    // PATTERN: Polling loop with timeout
    while (Date.now() - startTime < timeout) {
      // Refresh backlog to get latest status
      await this.refreshBacklog();

      // Check if dependencies are complete
      if (this.canExecute(subtask)) {
        this.#logger.info({ subtaskId: subtask.id }, 'Dependencies complete');
        return;
      }

      // Log waiting status
      const blockers = this.getBlockingDependencies(subtask);
      const blockerIds = blockers.map(b => b.id).join(', ');
      this.#logger.debug(
        { subtaskId: subtask.id, blockerIds },
        'Waiting for dependencies'
      );

      // Sleep for interval
      await new Promise(resolve => setTimeout(resolve, interval));
    }

    // PATTERN: Throw descriptive error on timeout
    throw new Error(
      `Timeout waiting for dependencies of ${subtask.id} after ${timeout}ms`
    );
  }

  /**
   * Reloads backlog from SessionManager after status updates
   *
   * @throws {Error} If currentSession is null
   *
   * @remarks
   * This method should be called after any status update to ensure
   * the orchestrator has the latest backlog state from disk.
   * Public method for ConcurrentTaskExecutor integration.
   */
  async refreshBacklog(): Promise<void> {
    const currentSession = this.sessionManager.currentSession;
    if (!currentSession) {
      throw new Error('Cannot refresh backlog: no active session');
    }

    // Reload from session state (not cached value)
    this.#backlog = currentSession.taskRegistry;
  }

  /**
   * Reloads the backlog snapshot from the session registry and rebuilds the
   * execution queue from it.
   *
   * @remarks
   * The orchestrator snapshots the backlog and builds its execution queue
   * exactly once — in its constructor. That snapshot is taken inside
   * `initializeSession()`, which runs *before* the Architect generates the
   * backlog, so for a brand-new session both the snapshot and the queue are
   * empty. Once the backlog exists (generated by `decomposePRD()` for new
   * sessions, or loaded/patched for existing/delta sessions) and is synced into
   * the session registry via `SessionManager.saveBacklog()`, call this to
   * re-snapshot the now-populated backlog and rebuild the queue. Without it the
   * queue stays empty, `processNextItem()` returns false immediately, and the
   * pipeline reports success having executed 0/0 tasks (PRD §9.3.1/§9.3.2:
   * init → breakdown → execute — the queue must reflect the generated
   * hierarchy, not the empty pre-decomposition registry).
   */
  public async rebuildQueue(): Promise<void> {
    await this.refreshBacklog();
    this.#executionQueue = this.#buildQueue(this.#scope);
    this.#logger.info(
      { queueSize: this.#executionQueue.length },
      'Execution queue rebuilt'
    );
  }

  /**
   * Updates item status and refreshes backlog
   *
   * @param id - Item ID to update
   * @param status - New status value
   * @returns Updated Backlog after save
   * @throws {Error} If no session is loaded
   *
   * @remarks
   * Wraps SessionManager.updateItemStatus() with automatic backlog refresh.
   * The SessionManager persists the change to disk and updates its internal state.
   */
  async #updateStatus(id: string, status: Status): Promise<Backlog> {
    // Persist status change through SessionManager
    const updated = await this.sessionManager.updateItemStatus(id, status);

    // Reload backlog to get latest state
    await this.refreshBacklog();

    return updated;
  }

  /**
   * Changes the execution scope and rebuilds the queue
   *
   * @param scope - New scope to execute
   *
   * @remarks
   * Reconfigures the orchestrator to execute a different set of items.
   * Logs the scope change for debugging and audit trail.
   * The current item (if any) will complete before the new scope takes effect.
   *
   * @example
   * ```typescript
   * // Start with all items
   * const orchestrator = new TaskOrchestrator(sessionManager);
   *
   * // Later, narrow scope to specific milestone
   * await orchestrator.setScope({ type: 'milestone', id: 'P1.M1' });
   * ```
   */
  public async setScope(scope: Scope): Promise<void> {
    // Log old scope for debugging
    const oldScope = this.#scope
      ? JSON.stringify(this.#scope)
      : 'undefined (all)';
    const newScope = JSON.stringify(scope);

    this.#logger.info({ oldScope, newScope }, 'Scope change');

    // Store new scope and rebuild queue
    this.#scope = scope;
    this.#executionQueue = this.#buildQueue(scope);

    this.#logger.info(
      { queueSize: this.#executionQueue.length },
      'Execution queue rebuilt'
    );
  }

  /**
   * Type-switch dispatch to appropriate execute* method
   *
   * @param item - Hierarchy item to execute
   * @returns Promise that resolves when execution completes
   *
   * @remarks
   * Uses discriminated union (item.type) for type narrowing.
   * TypeScript automatically narrows type in each case branch.
   */
  async #delegateByType(item: HierarchyItem): Promise<void> {
    // PATTERN: Switch on 'type' field for discriminated union narrowing
    switch (item.type) {
      case 'Phase':
        // TypeScript knows 'item' is Phase here (has milestones property)
        return this.executePhase(item);

      case 'Milestone':
        // TypeScript knows 'item' is Milestone here (has tasks property)
        return this.executeMilestone(item);

      case 'Task':
        // TypeScript knows 'item' is Task here (has subtasks property)
        return this.executeTask(item);

      case 'Subtask':
        // TypeScript knows 'item' is Subtask here (has dependencies property)
        return this.executeSubtask(item);

      default: {
        // PATTERN: Exhaustive check - TypeScript errors if missing case
        const _exhaustive: never = item;
        throw new Error(`Unknown hierarchy item type: ${_exhaustive}`);
      }
    }
  }

  /**
   * Executes a Phase item
   *
   * @param phase - Phase to execute
   * @returns Promise that resolves when execution completes
   *
   * @remarks
   * Sets phase status to 'Implementing'. Child iteration happens through
   * the processNextItem() loop - the Pipeline Controller will repeatedly
   * call processNextItem() to process milestones within this phase.
   */
  async executePhase(phase: Phase): Promise<void> {
    // PATTERN: Log before status update (NEW - adds visibility)
    this.#logger.info({ phaseId: phase.id }, 'Setting status to Implementing');

    await this.#updateStatus(phase.id, 'Implementing');
    this.#logger.info(
      { phaseId: phase.id, title: phase.title },
      'Executing Phase'
    );
  }

  /**
   * Executes a Milestone item
   *
   * @param milestone - Milestone to execute
   * @returns Promise that resolves when execution completes
   *
   * @remarks
   * Sets milestone status to 'Implementing'. Child iteration happens through
   * the processNextItem() loop - the Pipeline Controller will repeatedly
   * call processNextItem() to process tasks within this milestone.
   */
  async executeMilestone(milestone: Milestone): Promise<void> {
    // PATTERN: Log before status update (NEW - adds visibility)
    this.#logger.info(
      { milestoneId: milestone.id },
      'Setting status to Implementing'
    );

    await this.#updateStatus(milestone.id, 'Implementing');
    this.#logger.info(
      { milestoneId: milestone.id, title: milestone.title },
      'Executing Milestone'
    );
  }

  /**
   * Executes a Task item
   *
   * @param task - Task to execute
   * @returns Promise that resolves when execution completes
   *
   * @remarks
   * Sets task status to 'Implementing'. Enqueues all subtasks for parallel PRP
   * generation. Child iteration happens through the processNextItem() loop -
   * the Pipeline Controller will repeatedly call processNextItem() to process
   * subtasks within this task.
   */
  async executeTask(task: Task): Promise<void> {
    // PATTERN: Log before status update (NEW - adds visibility)
    this.#logger.info({ taskId: task.id }, 'Setting status to Implementing');

    await this.#updateStatus(task.id, 'Implementing');
    this.#logger.info({ taskId: task.id, title: task.title }, 'Executing Task');

    // Enqueue subtasks for parallel PRP generation. Under the depth-chain
    // model (PRD §4.2), enqueue ONLY the first subtask now so it starts
    // immediately; #prefetchResearchAhead drives the chain as items are
    // consumed. Under the legacy flat-pool model, bulk-enqueue all subtasks.
    this.#logger.info(
      { taskId: task.id, subtaskCount: task.subtasks.length },
      'Enqueuing subtasks for parallel PRP generation'
    );

    if (isParallelResearch()) {
      // Depth-chain model (PRD §4.2): enqueue only the first subtask now;
      // #prefetchResearchAhead drives the chain as items are consumed.
      if (task.subtasks.length > 0) {
        await this.researchQueue.enqueue(task.subtasks[0], this.#backlog);
      }
    } else {
      // Legacy flat-pool model: bulk-enqueue all subtasks (unchanged behavior).
      for (const subtask of task.subtasks) {
        await this.researchQueue.enqueue(subtask, this.#backlog);
        this.#logger.debug(
          { taskId: task.id, subtaskId: subtask.id },
          'Enqueued for parallel research'
        );
      }
    }

    // Log queue statistics after enqueueing
    const stats = this.researchQueue.getStats();
    this.#logger.debug(
      {
        queued: stats.queued,
        researching: stats.researching,
        cached: stats.cached,
      },
      'Research queue stats'
    );
  }

  /**
   * Executes a Subtask item (main execution unit)
   *
   * @param subtask - Subtask to execute
   * @returns Promise that resolves when execution completes
   *
   * @remarks
   * This is the main execution unit. Before execution, it checks if all
   * dependencies are Complete using canExecute(). If blocked, it logs
   * the blocking dependencies and returns early without executing.
   *
   * Status progression: Planned → Researching → Implementing → Complete/Failed
   * - Researching: PRP generation phase (checks cache first)
   * - Implementing: Coder agent execution phase via PRPRuntime
   * - Complete: All validation gates passed
   * - Failed: Exception during execution
   *
   * Checks ResearchQueue cache for existing PRP before generation.
   * Triggers background research for next tasks after starting execution.
   */
  async executeSubtask(subtask: Subtask): Promise<void> {
    // Skip subtasks that are already Complete (e.g. on --continue resume).
    // Without this, every resume re-runs every completed subtask, wasting
    // 10+ min each and producing duplicate commits whose only changed file
    // is regenerated execution telemetry.
    //
    // PRD §5.1 "Orphaned-`plan/` Recovery → Skip-recovery": before skipping,
    // verify HEAD also records the item Complete. A force-interrupted prior
    // run can leave the item Complete in the working tree but never committed
    // — stranding its plan/ dir + status as untracked/unstaged. Because the
    // cleanup agent is forbidden from touching plan/ and no later commit
    // reaches a skipped item, a blind skip would orphan that work forever.
    // If HEAD disagrees, run smartCommit to persist the stranded state before
    // skipping (so the next resume is a clean skip).
    if (subtask.status === 'Complete') {
      const sessionPath = this.sessionManager.currentSession?.metadata.path;
      if (sessionPath) {
        const headComplete = await this.#checkHeadComplete(
          sessionPath,
          subtask.id
        );
        if (!headComplete) {
          this.#logger.warn(
            { subtaskId: subtask.id },
            'Completed in working tree but not in HEAD — stranded plan/ detected; running recovery commit'
          );
          await smartCommit(
            sessionPath,
            `${subtask.id}: ${subtask.title} (skip-recovery: persist stranded plan/)`,
            { generateMessage: true }
          );
        }
      }
      this.#logger.info(
        { subtaskId: subtask.id },
        'Already complete, skipping'
      );
      return;
    }

    this.#logger.info(
      { subtaskId: subtask.id, title: subtask.title },
      'Executing Subtask'
    );

    // PATTERN: Set 'Researching' status at start
    await this.setStatus(subtask.id, 'Researching', 'Starting PRP generation');
    this.#logger.debug(
      { subtaskId: subtask.id },
      'Researching - preparing PRP'
    );

    // NEW: Check if PRP is cached in ResearchQueue
    const cachedPRP = this.researchQueue.getPRP(subtask.id);
    if (cachedPRP) {
      this.#cacheHits++;
      this.#logger.debug(
        { subtaskId: subtask.id },
        'Cache HIT - using cached PRP'
      );
    } else {
      this.#cacheMisses++;
      this.#logger.debug(
        { subtaskId: subtask.id },
        'Cache MISS - PRP will be generated by PRPRuntime'
      );
    }

    // Log cache metrics
    this.#logCacheMetrics();

    // PRD §4.2: depth-chained supervisor prefetches RESEARCH_DEPTH items ahead.
    // (Fire-and-forget enqueue; dedup + waitForPRP handle completion/errors.)
    // #executionQueue is already-shifted by processNextItem(), so it holds the
    // upcoming items. The method is a no-op when PARALLEL_RESEARCH is disabled.
    this.#prefetchResearchAhead(this.#executionQueue);

    // NEW: Check if dependencies are satisfied
    if (!this.canExecute(subtask)) {
      const blockers = this.getBlockingDependencies(subtask);

      // PATTERN: Log each blocking dependency for clarity
      for (const blocker of blockers) {
        this.#logger.info(
          {
            subtaskId: subtask.id,
            blockerId: blocker.id,
            blockerTitle: blocker.title,
            blockerStatus: blocker.status,
          },
          'Blocked on dependency'
        );
      }

      this.#logger.warn(
        { subtaskId: subtask.id },
        'Subtask blocked on dependencies, skipping'
      );

      // Reset to Planned (it was set to Researching above) so this incomplete
      // task is retried on the next resume instead of being left dangling
      // mid-flight. With a dependency-ordered queue (topo sort in resolveScope)
      // this path only fires when a dependency itself failed/was skipped.
      await this.setStatus(
        subtask.id,
        'Planned',
        'Blocked on dependencies, deferring to next pass'
      );

      // PATTERN: Return early without executing
      return;
    }

    // PATTERN: Set 'Implementing' status before work
    await this.setStatus(subtask.id, 'Implementing', 'Starting implementation');

    // PATTERN: Wrap execution in try/catch for error handling
    try {
      // PRD §4.2: await background research (deadline-guarded by ResearchQueue — S2); fall back to
      // synchronous inline re-research if the background work was abandoned (hung/crashed agent)
      // OR if the subtask was never pre-enqueued (happens when resolveScope returns leaf-only
      // subtasks for {type:'all'} scope — the parent Task's executeTask/enqueue is skipped).
      try {
        await this.researchQueue.waitForPRP(subtask.id);
      } catch (error) {
        const notEnqueued =
          error instanceof Error &&
          /No PRP available|not been enqueued/i.test(error.message);
        if (error instanceof ResearchTimeoutError || notEnqueued) {
          this.#logger.info(
            { subtaskId: subtask.id },
            error instanceof ResearchTimeoutError
              ? 'Background research abandoned (deadline exceeded); re-researching synchronously inline'
              : 'Subtask not pre-enqueued for research; generating PRP synchronously inline'
          );
          await this.researchQueue.researchNow(subtask, this.#backlog);
          this.#logger.info(
            { subtaskId: subtask.id },
            'Synchronous inline research complete'
          );
        } else {
          throw error; // real generation error → outer catch → Failed + rethrow
        }
      }

      // NEW: Use PRPRuntime for execution with retry wrapper
      this.#logger.info(
        { subtaskId: subtask.id },
        'Starting PRPRuntime execution with retry'
      );

      // PRD §4.5: Issue-bounded execution loop.
      // executeWithRetry (TaskRetryManager) wraps each runtime call INSIDE the loop (transient infra retries).
      // #issueAttempts accumulates OUTSIDE (orchestrator-level re-planning count).
      const maxIssueRetries = getIssueRetryMax();
      let succeeded = false; // tracks whether this subtask passed validation
      let failureReason = ''; // captured on hard-fail for the thrown TaskError
      // eslint-disable-next-line no-constant-condition -- bounded by internal break/continue
      while (true) {
        // Wrap PRPRuntime execution with retry logic
        const result = await this.#retryManager.executeWithRetry(
          subtask,
          async () => {
            return await this.#prpRuntime.executeSubtask(
              subtask,
              this.#backlog
            );
          }
        );

        // Smart recovery: reconcile tasks.json after every agent run (PRD §5.1, R4 S3).
        // Re-applies ONLY the legitimate status delta (discards unauthorized agent mutations
        // via the pre-agent baseline); restores from git history if the agent corrupted the
        // file; reloads the session registry from the recovered disk. Non-fatal.
        await this.#recoverAfterAgentRun(subtask.id, result);

        this.#logger.info(
          { subtaskId: subtask.id, success: result.success },
          'PRPRuntime execution complete'
        );

        // NOTE: No fire-and-forget background research here. The pipeline runs
        // STRICTLY SEQUENTIALLY — one task is fully researched, executed, and
        // committed before the next begins. The prior researchQueue.processNext()
        // pre-fetched PRPs for upcoming tasks in the background (concurrency 3),
        // which meant 'research across multiple items at once' and left tasks
        // dangling in 'Researching' when the process was interrupted. Each task
        // self-serves its PRP via the inline researchNow() fallback above.

        // --- Tri-state outcome handling (PRD §4.5) ---

        // SUCCESS: mark Complete and exit loop
        if (result.success) {
          await this.setStatus(
            subtask.id,
            'Complete',
            'Implementation completed successfully'
          );
          succeeded = true;
          break;
        }

        // ISSUE: recoverable planning gap → re-plan (PRD §4.5)
        if (result.outcome === 'issue') {
          const attempts = (this.#issueAttempts.get(subtask.id) ?? 0) + 1;
          this.#issueAttempts.set(subtask.id, attempts);

          // Boundary check — hard-fail if attempts exceeded
          if (attempts > maxIssueRetries) {
            this.#logger.warn(
              { subtaskId: subtask.id, attempts, maxIssueRetries },
              'Issue-driven re-planning exhausted; hard-failing item'
            );
            failureReason = `Issue-driven re-planning exhausted after ${maxIssueRetries} attempts: ${
              result.issueMessage ?? 'unspecified planning gap'
            }`;
            await this.setStatus(subtask.id, 'Failed', failureReason);
            break;
          }

          // Re-plan sequence (PRD §4.5 steps 1–4):
          const feedback =
            result.issueMessage ??
            'Unspecified planning gap reported by Coder Agent';
          const sessionDir = this.sessionManager.currentSession!.metadata.path;

          // (1) Capture feedback
          await atomicWrite(join(sessionDir, 'issue_feedback.md'), feedback);
          this.#logger.info(
            { subtaskId: subtask.id },
            'Wrote issue_feedback.md for re-planning'
          );

          // (2) Invalidate stale plan
          await this.researchQueue.deletePRP(subtask.id);

          // (3) Reset state (NOT Failed)
          await this.setStatus(
            subtask.id,
            'Planned',
            'Issue-driven re-planning'
          );

          // (4) Re-research with feedback injected (S3 generator path, via researchNow)
          await this.researchQueue.researchNow(
            subtask,
            this.#backlog,
            feedback
          );
          this.#logger.info(
            { subtaskId: subtask.id, attempts },
            'Re-planning complete; re-executing with feedback-aware PRP'
          );

          continue; // next loop iteration re-executes against the fresh PRP
        }

        // FAIL: real implementation failure → mark Failed, capture reason, exit loop.
        // (The throw + commit-skip happen after the loop.)
        failureReason = result.error ?? 'Execution failed';
        await this.setStatus(subtask.id, 'Failed', failureReason);
        break;
      }

      // Smart commit ONLY on success. Failed tasks must NOT auto-commit their
      // broken code — the prior unconditional commit polluted history with
      // failed deliverables under a [PRP Auto] message indistinguishable from
      // real work. Broken output stays in the working tree (uncommitted) for
      // inspection.
      //
      // FLUSH FIRST: write the batched status delta to disk (tasks.json) BEFORE
      // committing, so the task commit includes the status change (subtask →
      // Complete) riding alongside the deliverables.
      await this.sessionManager.flushUpdates();

      if (succeeded) {
        try {
          const sessionPath = this.sessionManager.currentSession?.metadata.path;
          if (!sessionPath) {
            this.#logger.warn('Session path not available for smart commit');
          } else {
            // ── Two-phase commit stagecoach pattern (PRD §4.2 step 4, §5.1) ──
            // (a) SURVIVAL COMMIT — substance + plan/ work dir + Complete status.
            //     Runs BEFORE the long/interruptible cleanup so a force-interrupt
            //     during cleanup can no longer strand an item
            //     "Complete on disk but uncommitted" (orphaning state).
            const preHash = await smartCommit(
              sessionPath,
              `${subtask.id}: ${subtask.title}`,
              { generateMessage: true }
            );
            if (preHash) {
              this.#logger.info(
                { commitHash: preHash },
                'Survival commit created'
              );
            } else {
              this.#logger.info(
                'No substance to commit (survival commit empty)'
              );
            }

            // (b) CLEANUP — best-effort, isolated, NEVER fatal. The cleanup
            //     runner is UNTRUSTED (S3's persona) so its own try/catch MUST
            //     swallow — a throw escaping here would reach the outer catch
            //     (→ Failed + rethrow), violating "cleanup is non-fatal".
            const repoRoot = process.cwd();
            let cleanupOk = false;
            try {
              const res = await this.#cleanupRunner({
                sessionPath,
                subtask,
                repoRoot,
              });
              cleanupOk = res.success;
              if (!res.success) {
                this.#logger.warn(
                  { error: res.error },
                  'Cleanup runner reported failure'
                );
              }
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              this.#logger.warn(
                { error: msg },
                'Cleanup runner threw — continuing (survival commit already safe)'
              );
              cleanupOk = false;
            }

            // cleanup may have written tasks.json — persist before post-cleanup commit
            await this.sessionManager.flushUpdates();

            // (c) POST-CLEANUP COMMIT — doc reorganization, stagecoach. Only
            //     when cleanup succeeded; if cleanup failed, nothing was
            //     reorganized. smartCommit returning null (cleanup changed
            //     nothing committable) is logged at info and is fine.
            if (cleanupOk) {
              const postHash = await smartCommit(
                sessionPath,
                'cleanup: doc reorganization',
                { generateMessage: true }
              );
              if (postHash) {
                this.#logger.info(
                  { commitHash: postHash },
                  'Post-cleanup commit created'
                );
              } else {
                this.#logger.info('No cleanup changes to commit');
              }
            }
          }
        } catch (error) {
          // Don't fail the subtask if commit fails
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          this.#logger.error({ error: errorMessage }, 'Smart commit failed');
        }
      } else {
        this.#logger.warn(
          { subtaskId: subtask.id, reason: failureReason },
          'Subtask failed — skipping commit (broken output left uncommitted)'
        );
      }

      // Halt-on-failure: throw a TaskError so executeBacklog can halt the
      // pipeline (unless --continue-on-error). The prior code returned normally
      // on validation failure, so executeBacklog silently continued to the next
      // task — committing broken code and cascading into dependent work.
      if (!succeeded) {
        throw new TaskError(`Subtask ${subtask.id} failed: ${failureReason}`, {
          taskId: subtask.id,
          operation: 'executeSubtask',
        });
      }
    } catch (error) {
      // PATTERN: Set 'Failed' status on exception with error details
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      await this.setStatus(
        subtask.id,
        'Failed',
        `Execution failed: ${errorMessage}`
      );

      // PATTERN: Log error with context for debugging
      this.#logger.error(
        {
          subtaskId: subtask.id,
          error: errorMessage,
          ...(error instanceof Error && { stack: error.stack }),
        },
        'Subtask execution failed'
      );

      // FLUSH: Still flush on error to preserve failure state
      await this.sessionManager.flushUpdates();

      // PATTERN: Re-throw error for upstream handling
      throw error;
    }
  }

  /**
   * Logs cache metrics for monitoring
   *
   * @remarks
   * Logs cache hits, misses, and hit ratio percentage. Called from
   * executeSubtask() to provide visibility into cache effectiveness.
   *
   * @private
   */
  /**
   * Smart-recovery hook: reconcile on-disk tasks.json after every agent run (PRD §5.1, R4 S3).
   *
   * @remarks
   * Called from {@link executeSubtask} immediately after the agent run returns, before
   * the tri-state status handling. Delegates to {@link recoverTasksJson} (S2) to re-apply
   * ONLY the legitimate status delta for `itemId` (discarding unauthorized agent mutations
   * via the pre-agent baseline) and to restore from git history if the agent corrupted the
   * file. Then reloads the session registry from the recovered disk so the orchestrator's
   * in-memory backlog reflects reality (refreshBacklog() alone re-reads in-memory only).
   *
   * NON-FATAL: any failure (recovery or reload) is logged and swallowed — a single
   * corrupting agent must never terminate the session.
   *
   * @param itemId - The subtask just run (the item whose status delta is legitimate).
   * @param result - The ExecutionResult of the agent run (determines the intended status).
   */
  async #recoverAfterAgentRun(
    itemId: string,
    result: ExecutionResultLike
  ): Promise<void> {
    const session = this.sessionManager.currentSession;
    if (!session) {
      this.#logger.warn(
        'No active session; skipping tasks.json smart recovery'
      );
      return;
    }

    try {
      // --- 1. Determine the intended legitimate status for this run ---
      const maxIssueRetries = getIssueRetryMax();
      const nextIssueAttempt = (this.#issueAttempts.get(itemId) ?? 0) + 1;
      const legitimateStatus: Status = result.success
        ? 'Complete'
        : result.outcome === 'issue'
          ? nextIssueAttempt > maxIssueRetries
            ? 'Failed' // issue-driven re-planning exhausted → hard-fail
            : 'Planned' // recoverable gap → reset for re-planning
          : 'Failed'; // hard implementation failure

      // --- 2. Reconcile disk: re-apply ONLY the legitimate delta; discard unauthorized
      //        mutations (reconstruct from the pre-agent #backlog baseline); restore from
      //        git history if the agent corrupted the file. recoverTasksJson never throws. ---
      const tasksPath = join(session.metadata.path, 'tasks.json');
      const recovery = await recoverTasksJson(
        tasksPath,
        { itemId, status: legitimateStatus },
        { baselineBacklog: this.#backlog, repoPath: process.cwd() }
      );
      if (recovery.restored) {
        this.#logger.info(
          { itemId, source: recovery.source, reason: recovery.reason },
          'tasks.json restored from git history after agent run'
        );
      }

      // --- 3. Reload the session registry from recovery's locked result. When
      //        recovery produced a backlog (PATH A/B), reuse it directly — no
      //        second locked re-read, no TOCTOU window. When recovery produced
      //        none (PATH C failure), fall back to a best-effort read that
      //        tolerates a corrupt-disk throw. refreshBacklog() is in-memory
      //        only (implementation_notes §6). ---
      const recovered =
        recovery.backlog ??
        (await readTasksJSON(session.metadata.path).catch(() => null));
      if (recovered) {
        // readonly-cast idiom (SessionState.taskRegistry is readonly; mirrors state-validator.ts)
        (
          this.sessionManager.currentSession as { taskRegistry: Backlog }
        ).taskRegistry = recovered;
        await this.refreshBacklog();
      }
    } catch (error) {
      // NON-FATAL: a recovery/reload failure must never terminate the session (PRD §5.1).
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.#logger.error(
        { itemId, err: errorMessage },
        'tasks.json smart recovery failed (non-fatal); continuing'
      );
    }
  }

  #logCacheMetrics(): void {
    const total = this.#cacheHits + this.#cacheMisses;
    const hitRatio = total > 0 ? (this.#cacheHits / total) * 100 : 0;

    this.#logger.debug(
      {
        hits: this.#cacheHits,
        misses: this.#cacheMisses,
        hitRatio: hitRatio.toFixed(1),
      },
      'Cache metrics'
    );
  }

  /**
   * PRD §5.1 "Orphaned-`plan/` Recovery" — skip-recovery HEAD check.
   *
   * Reads HEAD's `tasks.json` and returns `true` ONLY when HEAD records
   * `itemId` with status `'Complete'`. Used by {@link executeSubtask} on the
   * Completed-skip path to detect the stranded state: an item that is
   * `'Complete'` in the working tree but was never committed (a force-
   * interrupted prior run left its `plan/` dir + status untracked). When this
   * returns `false`, the caller runs `smartCommit` to persist the stranded
   * state before skipping.
   *
   * **HEAD-not-found ⇒ `false` (stranded):** if `findItem` cannot locate
   * `itemId` in HEAD's backlog at all, HEAD has no record of the completion →
   * it is certainly not recorded Complete → stranded. Do NOT treat not-found
   * as a safe skip.
   *
   * **Non-fatal:** any error (git read failure, invalid JSON, schema
   * validation failure) is logged at `warn` and returns `false`. The caller's
   * recovery commit is itself non-throwing (`smartCommit` never-fail-on-commit
   * contract), and `executeSubtask` always `return`s after the skip block — so
   * a recovery failure NEVER causes the already-Complete item to be re-run.
   *
   * @param sessionPath - The session metadata dir (currentSession.metadata.path).
   * @param itemId - The subtask id to look up in HEAD's tasks.json.
   * @returns `true` iff HEAD's tasks.json records `itemId` as `'Complete'`.
   */
  async #checkHeadComplete(
    sessionPath: string,
    itemId: string
  ): Promise<boolean> {
    try {
      const repoPath = process.cwd();
      // repo-RELATIVE path for git (mirror tasks-json-recovery.ts PATH B):
      // resolve → absolute → relative handles both repo-relative and absolute
      // sessionPath inputs correctly.
      const relPath = relative(repoPath, resolve(sessionPath, 'tasks.json'));
      const blob = await gitReadFileAtCommit(relPath, 'HEAD', repoPath); // THROWS → caught
      const headBacklog = BacklogSchema.parse(JSON.parse(blob)) as Backlog; // THROWS on bad JSON/schema
      const headItem = findItem(headBacklog, itemId);
      return headItem?.status === 'Complete';
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.#logger.warn(
        { itemId, err: msg },
        'Skip-recovery: could not read/parse HEAD tasks.json; assuming stranded (non-fatal)'
      );
      return false;
    }
  }

  /**
   * Processes the next item from the execution queue
   *
   * @returns true if item was processed, false if queue is empty
   *
   * @remarks
   * This is the main entry point for backlog processing with scope support:
   * 1. Check if executionQueue has items
   * 2. Shift next item from queue (FIFO order)
   * 3. Return false if queue empty
   * 4. Log item being processed
   * 5. Delegate to type-specific handler
   * 6. Refresh backlog after status update
   * 7. Return true (item processed, more may remain)
   *
   * The Pipeline Controller calls this method repeatedly until it returns false.
   *
   * When scope is provided, only items in the scope are processed.
   * When scope is undefined, all items are processed.
   *
   * @example
   * ```typescript
   * const orchestrator = new TaskOrchestrator(sessionManager, { type: 'milestone', id: 'P1.M1' });
   * let hasMore = true;
   * while (hasMore) {
   *   hasMore = await orchestrator.processNextItem();
   * }
   * console.log('Milestone P1.M1 complete!');
   * ```
   */
  async processNextItem(): Promise<boolean> {
    // 1. Check if execution queue has items
    if (this.#executionQueue.length === 0) {
      this.#logger.info('Execution queue empty - processing complete');
      this.currentItemId = null;
      return false;
    }

    // 2. Shift next item from queue (FIFO order)
    const nextItem = this.#executionQueue.shift()!;
    // Non-null assertion safe: we checked length > 0 above

    // 3. Set current item ID for progress tracking
    this.currentItemId = nextItem.id;

    // 4. Log item being processed
    this.#logger.info(
      { itemId: nextItem.id, type: nextItem.type },
      'Processing'
    );

    // 5. Delegate to type-specific handler
    await this.#delegateByType(nextItem);

    // 6. Refresh backlog after status update
    await this.refreshBacklog();

    // 7. Indicate item was processed (more items may remain)
    return true;
  }

  /**
   * Executes subtasks in parallel with dependency awareness
   *
   * @param config - Parallel execution configuration
   * @returns Promise that resolves when all subtasks complete
   * @throws {Error} If concurrent execution fails or deadlock detected
   *
   * @remarks
   * Creates ConcurrentTaskExecutor and executes all subtasks from the backlog
   * in parallel while respecting dependency constraints. Subtasks with satisfied
   * dependencies execute concurrently up to maxConcurrency limit.
   *
   * Preserves existing sequential processNextItem() for backward compatibility.
   *
   * @example
   * ```typescript
   * const orchestrator = new TaskOrchestrator(sessionManager);
   * await orchestrator.executeParallel({
   *   enabled: true,
   *   maxConcurrency: 3,
   *   prpGenerationLimit: 3,
   *   resourceThreshold: 0.8
   * });
   * ```
   */
  public async executeParallel(config: ParallelismConfig): Promise<void> {
    if (!config.enabled) {
      this.#logger.info('Parallel execution disabled, skipping');
      return;
    }

    this.#logger.info(
      { maxConcurrency: config.maxConcurrency },
      'Starting parallel execution'
    );

    // Get all subtasks from backlog
    const subtasks = this.#getAllSubtasks(this.#backlog);

    this.#logger.info(
      { subtaskCount: subtasks.length },
      'Found subtasks for parallel execution'
    );

    // Create executor and run parallel execution
    const executor = new ConcurrentTaskExecutor(this, config);
    await executor.executeParallel(subtasks);

    this.#logger.info('Parallel execution complete');
  }

  /**
   * Gets all subtasks from the backlog hierarchy
   *
   * @param backlog - Backlog to extract subtasks from
   * @returns Array of all subtasks in the backlog
   *
   * @remarks
   * Recursively traverses Phase > Milestone > Task > Subtask hierarchy
   * and collects all subtasks into a flat array.
   *
   * @private
   */
  #getAllSubtasks(backlog: Backlog): Subtask[] {
    const subtasks: Subtask[] = [];

    for (const phase of backlog.backlog) {
      for (const milestone of phase.milestones) {
        for (const task of milestone.tasks) {
          subtasks.push(...task.subtasks);
        }
      }
    }

    return subtasks;
  }
}
