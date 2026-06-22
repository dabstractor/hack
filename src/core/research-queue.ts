/**
 * Research Queue for parallel PRP generation
 *
 * @module core/research-queue
 *
 * @remarks
 * Manages parallel PRP generation in background while TaskOrchestrator executes
 * tasks sequentially. Enables "research ahead" behavior where PRPs for upcoming
 * tasks are generated before they're needed.
 *
 * @example
 * ```typescript
 * import { ResearchQueue } from './core/research-queue.js';
 *
 * const queue = new ResearchQueue(sessionManager, 3);
 * await queue.enqueue(subtask1, backlog);
 * await queue.enqueue(subtask2, backlog);
 * const prp = await queue.waitForPRP(subtask1.id);
 * ```
 */

import { PRPGenerator } from '../agents/prp-generator.js';
import { getLogger } from '../utils/logger.js';
import type { Logger } from '../utils/logger.js';
import type { PRPDocument, Task, Subtask, Backlog } from './models.js';
import type { SessionManager } from './session-manager.js';
import { getResearchTimeoutSeconds } from '../config/constants.js';
import { unlink } from 'node:fs/promises';

/**
 * Task or Subtask that can be enqueued for PRP generation
 */
type TaskOrSubtask = Task | Subtask;

/**
 * Module-private sentinel so the deadline win is unambiguous vs. a PRPDocument.
 *
 * @remarks
 * Used inside `waitForPRP`'s `Promise.race` to distinguish the timeout path
 * from the in-flight-resolution path. A `unique symbol` guarantees zero
 * collision risk with any PRPDocument value.
 */
const DEADLINE_SENTINEL: unique symbol = Symbol('ResearchQueue.deadline');

/**
 * Error thrown when background research for a task exceeds the
 * `RESEARCH_TIMEOUT` deadline (PRD §4.2).
 *
 * @remarks
 * This is a typed, catchable error that the orchestrator (S3) can
 * detect via `instanceof ResearchTimeoutError` to trigger a synchronous
 * fallback re-research of the abandoned task.
 *
 * Abandonment does NOT cancel the background generation (JS promises
 * cannot be cancelled). The abandoned background work keeps running;
 * its late result is silently ignored (dedup via `ResearchQueue.abandoned`).
 *
 * @example
 * ```typescript
 * try {
 *   const prp = await queue.waitForPRP(taskId);
 * } catch (err) {
 *   if (err instanceof ResearchTimeoutError) {
 *     console.log(`Task ${err.taskId} abandoned after ${err.timeoutSeconds}s`);
 *     // re-research synchronously...
 *   }
 * }
 * ```
 */
export class ResearchTimeoutError extends Error {
  /**
   * Creates a new ResearchTimeoutError
   *
   * @param taskId - The task ID whose research exceeded the deadline
   * @param timeoutSeconds - The configured deadline in seconds
   */
  constructor(
    public readonly taskId: string,
    public readonly timeoutSeconds: number
  ) {
    super(
      `Background research for ${taskId} exceeded the ${timeoutSeconds}s ` +
        `RESEARCH_TIMEOUT deadline and was abandoned.`
    );
    this.name = 'ResearchTimeoutError';
  }
}

/**
 * Manages parallel PRP generation in background
 *
 * @remarks
 * Enables "research ahead" behavior where PRPs for upcoming tasks are
 * generated before they're needed by TaskOrchestrator. Maintains
 * concurrency limit to prevent overwhelming LLM API.
 *
 * Queue lifecycle:
 * 1. Task enqueued via enqueue()
 * 2. If under maxSize, processNext() starts PRP generation
 * 3. Promise stored in researching Map
 * 4. On completion, result cached in results Map
 * 5. Promise removed from researching Map
 * 6. processNext() called to start next task
 *
 * @example
 * ```typescript
 * const queue = new ResearchQueue(sessionManager, 3);
 * await queue.enqueue(subtask1, backlog);
 * await queue.enqueue(subtask2, backlog);
 * const prp = await queue.waitForPRP(subtask1.id);
 * ```
 */
export class ResearchQueue {
  /** Logger instance for structured logging */
  readonly #logger: Logger;

  /** Session manager passed to PRPGenerator */
  readonly sessionManager: SessionManager;

  /** Max concurrent PRP generations */
  readonly maxSize: number;

  /** Cache bypass flag from CLI --no-cache */
  readonly #noCache: boolean;

  /** Cache TTL in milliseconds */
  readonly #cacheTtlMs: number;

  /** PRP generator instance */
  readonly #prpGenerator: PRPGenerator;

  /** Pending tasks waiting to be researched */
  readonly queue: TaskOrSubtask[] = [];

  /** In-flight PRP generations: taskId -> Promise */
  readonly researching: Map<string, Promise<PRPDocument>> = new Map();

  /** Completed PRP results: taskId -> PRPDocument */
  readonly results: Map<string, PRPDocument> = new Map();

  /**
   * Task IDs whose background research exceeded the RESEARCH_TIMEOUT deadline (PRD §4.2).
   *
   * @remarks
   * Abandoned tasks are never removed from this set (cheap, harmless).
   * Any late background result for an abandoned taskId is silently ignored.
   */
  readonly abandoned: Set<string> = new Set();

  /**
   * Creates a new ResearchQueue
   *
   * @param sessionManager - Session state manager
   * @param maxSize - Max concurrent PRP generations (default 3)
   * @param noCache - Whether to bypass cache (default: false)
   * @param cacheTtlMs - Cache TTL in milliseconds (default: 24 hours)
   * @throws {Error} If no session is active in SessionManager
   */
  constructor(
    sessionManager: SessionManager,
    maxSize: number = 3,
    noCache: boolean = false,
    cacheTtlMs: number = 24 * 60 * 60 * 1000
  ) {
    this.#logger = getLogger('ResearchQueue');
    this.sessionManager = sessionManager;
    this.maxSize = maxSize;
    this.#noCache = noCache;
    this.#cacheTtlMs = cacheTtlMs;
    this.#prpGenerator = new PRPGenerator(sessionManager, noCache, cacheTtlMs);
  }

  /**
   * Enqueues a task for PRP generation
   *
   * @remarks
   * Adds task to queue and starts processing if under capacity.
   * Deduplicates: if task already being researched or cached,
   * this is a no-op.
   *
   * @param task - Task or Subtask to generate PRP for
   * @param backlog - Full backlog for context (required by PRPGenerator)
   */
  async enqueue(task: TaskOrSubtask, backlog: Backlog): Promise<void> {
    // Deduplication: skip if already researching
    if (this.researching.has(task.id)) {
      return;
    }

    // Deduplication: skip if already cached
    if (this.results.has(task.id)) {
      return;
    }

    // Add to queue
    this.queue.push(task);

    // Try to start processing
    await this.processNext(backlog);
  }

  /**
   * Processes next task if under capacity
   *
   * @remarks
   * Idempotent: safe to call multiple times. Will only start new
   * research if under maxSize limit. Called automatically by
   * enqueue() and after each research completion.
   *
   * @param backlog - Full backlog for context
   */
  async processNext(backlog: Backlog): Promise<void> {
    // Check capacity
    if (this.queue.length === 0 || this.researching.size >= this.maxSize) {
      return;
    }

    // Dequeue next task
    const task = this.queue.shift();
    if (!task) {
      return; // Should not happen due to length check above
    }

    // Race guard: check if already started (might have been enqueued twice)
    if (this.researching.has(task.id)) {
      return;
    }

    // Start PRP generation
    const promise = this.#prpGenerator
      .generate(task, backlog)
      .then(prp => {
        // Ignore late result for abandoned tasks (dedup per PRD §4.2)
        if (this.abandoned.has(task.id)) {
          this.#logger.debug(
            { taskId: task.id },
            'Ignoring late PRP result for abandoned task'
          );
          return prp;
        }
        // Cache successful result
        this.results.set(task.id, prp);
        return prp;
      })
      .catch((error: unknown) => {
        // Log error but don't cache failed results
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.#logger.warn(
          { taskId: task.id, error: errorMessage },
          'PRP generation failed (non-critical)'
        );
        // Re-throw to allow waitForPRP to handle the error
        throw error;
      })
      .finally(() => {
        // Clean up in-flight tracking
        this.researching.delete(task.id);
        // Start next task
        this.processNext(backlog).catch((error: unknown) => {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          this.#logger.error(
            {
              taskId: task.id,
              error: errorMessage,
              ...(error instanceof Error && { stack: error.stack }),
            },
            'Background task failed'
          );
        });
      });

    // Track in-flight
    this.researching.set(task.id, promise);
  }

  /**
   * Checks if task is currently being researched
   *
   * @param taskId - Task ID to check
   * @returns true if PRP generation is in-flight
   */
  isResearching(taskId: string): boolean {
    return this.researching.has(taskId);
  }

  /**
   * Gets cached PRP if available
   *
   * @param taskId - Task ID to get PRP for
   * @returns Cached PRPDocument or null if not cached
   */
  getPRP(taskId: string): PRPDocument | null {
    return this.results.get(taskId) ?? null;
  }

  /**
   * Checks if a task was abandoned due to a research timeout (PRD §4.2).
   *
   * @param taskId - Task ID to check
   * @returns true iff waitForPRP previously timed out (abandoned) for taskId
   */
  isAbandoned(taskId: string): boolean {
    return this.abandoned.has(taskId);
  }

  /**
   * Re-researches a task SYNCHRONOUSLY, inline (PRD §4.2 fallback + §4.5 issue re-plan).
   *
   * @param task - The Task/Subtask to re-research.
   * @param backlog - Full backlog for PRPGenerator context.
   * @param issueFeedback - Optional feedback string from an issue outcome (PRD §4.5).
   *   When provided, forwarded to `PRPGenerator.generate()` which bypasses cache-read
   *   and injects the feedback into the blueprint prompt (S3).
   * @returns The freshly-generated (or already-cached) PRPDocument.
   *
   * @remarks
   * Called by `TaskOrchestrator.executeSubtask` in two scenarios:
   * 1. **Fallback re-research** (§4.2): when `waitForPRP` reports the background research
   *    was abandoned (deadline exceeded). No feedback is passed.
   * 2. **Issue-driven re-plan** (§4.5): when the Coder Agent reports `outcome: 'issue'`.
   *    The feedback from `result.issueMessage` is forwarded as the 3rd arg, causing
   *    `PRPGenerator.generate()` to bypass cache-read and inject the feedback into
   *    the blueprint prompt.
   *
   * Cache-write stays unconditional (overwrites with the feedback-aware PRP on re-plan).
   * Cache-READ bypass on feedback is handled inside the generator (S3) — this method
   * does NOT re-implement it.
   *
   * @example
   * ```typescript
   * // Fallback (no feedback)
   * const prp = await queue.researchNow(task, backlog);
   *
   * // Issue-driven re-plan (with feedback)
   * const prp = await queue.researchNow(task, backlog, 'missing /health contract');
   * ```
   */
  async researchNow(
    task: TaskOrSubtask,
    backlog: Backlog,
    issueFeedback?: string
  ): Promise<PRPDocument> {
    const cached = this.results.get(task.id);
    if (cached) return cached;
    const prp = await this.#prpGenerator.generate(task, backlog, issueFeedback);
    this.results.set(task.id, prp);
    return prp;
  }

  /**
   * Deletes the cached PRP for a task, clearing both the in-memory cache and
   * the on-disk PRP file + cache metadata (PRD §4.5 step 2).
   *
   * @param taskId - The task ID whose PRP should be deleted (e.g., "P1.M1.T1.S1").
   *
   * @remarks
   * Called by the orchestrator when an `outcome: 'issue'` triggers re-planning.
   * Three actions are performed:
   *
   * 1. **In-memory cache**: `this.results.delete(taskId)` — prevents stale PRP reuse.
   * 2. **Disk PRP file**: `unlink(getCachePath(taskId))` — removes the `.md` PRP document.
   * 3. **Cache metadata**: `unlink(getCacheMetadataPath(taskId))` — removes the `.cache/*.json`
   *    metadata file that could otherwise cause a stale `#isCacheRecent` hit on a later
   *    no-feedback generate.
   *
   * Both `unlink` calls are **ENOENT-tolerant** — if the file is already gone
   * (e.g., no PRP was ever written, or re-research already replaced it), the error
   * is silently swallowed. Non-ENOENT errors are re-thrown.
   *
   * Deleting both the `.md` and the `.cache/*.json` guarantees the stale plan
   * "cannot be reused" even if a later no-feedback generate runs. The subsequent
   * feedback re-research overwrites both anyway (S3 cache-write is unconditional) —
   * belt-and-suspenders.
   *
   * @example
   * ```typescript
   * // After an issue outcome (PRD §4.5):
   * await queue.deletePRP(subtask.id);
   * ```
   */
  async deletePRP(taskId: string): Promise<void> {
    // (a) clear in-memory cache
    this.results.delete(taskId);

    // (b) unlink the disk PRP file (ENOENT-tolerant)
    const prpPath = this.#prpGenerator.getCachePath(taskId);
    try {
      await unlink(prpPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }

    // (c) unlink the cache-metadata JSON (ENOENT-tolerant)
    const metaPath = this.#prpGenerator.getCacheMetadataPath(taskId);
    try {
      await unlink(metaPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }

    this.#logger.debug(
      { taskId },
      'Deleted PRP file + cache metadata (issue-driven re-plan)'
    );
  }

  /**
   * Waits for PRP to be ready, with a configurable deadline
   *
   * @remarks
   * Returns immediately if cached. If currently generating, races the
   * in-flight promise against a `getResearchTimeoutSeconds()`-keyed deadline.
   * On deadline expiry, records abandonment and throws `ResearchTimeoutError`
   * so the caller (orchestrator) can re-research synchronously.
   *
   * Success return type is unchanged (`Promise<PRPDocument>`) so existing
   * happy-path callers/tests are unaffected.
   *
   * @param taskId - Task ID to wait for
   * @returns PRPDocument when ready (under the deadline)
   * @throws {ResearchTimeoutError} If generation does not complete within
   *   `getResearchTimeoutSeconds()` (abandoned; `isAbandoned(taskId)` becomes `true`).
   * @throws {Error} If task not enqueued or generation failed
   */
  async waitForPRP(taskId: string): Promise<PRPDocument> {
    // Check cache first
    const cached = this.results.get(taskId);
    if (cached) {
      return cached;
    }

    // Check in-flight → race against the deadline
    const inFlight = this.researching.get(taskId);
    if (inFlight) {
      const deadlineMs = getResearchTimeoutSeconds() * 1000;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<typeof DEADLINE_SENTINEL>(resolve => {
        timer = setTimeout(() => resolve(DEADLINE_SENTINEL), deadlineMs);
      });
      try {
        const winner = await Promise.race([inFlight, deadline]);
        if (winner === DEADLINE_SENTINEL) {
          this.abandoned.add(taskId);
          throw new ResearchTimeoutError(taskId, getResearchTimeoutSeconds());
        }
        return winner;
      } finally {
        if (timer) clearTimeout(timer);
      }
    }

    // Not found
    throw new Error(
      `No PRP available for task ${taskId}. ` +
        `Task may not have been enqueued or generation failed.`
    );
  }

  /**
   * Gets queue statistics
   *
   * @returns Object with queue, researching, and cached counts
   */
  getStats(): {
    queued: number;
    researching: number;
    cached: number;
  } {
    return {
      queued: this.queue.length,
      researching: this.researching.size,
      cached: this.results.size,
    };
  }

  /**
   * Clears cached results
   *
   * @remarks
   * Does not affect in-flight research or queue. Useful for
   * forcing re-research or cleaning up after session completion.
   */
  clearCache(): void {
    this.results.clear();
  }
}
