/**
 * Smart-recovery routine for tasks.json after agent runs (PRD §5.1)
 *
 * @module core/tasks-json-recovery
 *
 * @remarks
 * After a Coder/agent run that may have corrupted `tasks.json` (truncated write,
 * partial edit, schema-invalid mutation) or scribbled unauthorized status changes,
 * this routine:
 *  1. Re-applies ONLY the legitimate status delta onto a trustworthy base,
 *     discarding unauthorized mutations.
 *  2. If the on-disk file fails to parse/validate, walks git history to restore
 *     the last valid committed version, re-applies the legitimate delta, and
 *     preserves items currently in `Researching`/`Retrying` status.
 *
 * It is **always non-fatal** — never throws to the caller; on total failure it
 * logs and leaves state as-is. Returns a typed result for observability.
 *
 * @example
 * ```ts
 * const result = await recoverTasksJson(
 *   'plan/005_.../tasks.json',
 *   { itemId: 'P5.M1.T2.S4', status: 'Complete' },
 *   { baselineBacklog: orchestrator.backlog, repoPath: process.cwd() }
 * );
 * if (result.restored) logger.info(result.reason, 'tasks.json restored from git');
 * ```
 */

import { dirname, relative, resolve } from 'node:path';
import type { Backlog, Status } from './models.js';
import { BacklogSchema } from './models.js';
import { readTasksJSON } from './session-utils.js';
import { validateBacklogState } from './state-validator.js';
import { withLockedTasksJSON } from './file-lock.js';
import { gitFileHistory, gitReadFileAtCommit } from '../tools/git-mcp.js';
import { setItemStatus } from '../utils/task-utils.js';
import { getLogger, type Logger } from '../utils/logger.js';

let _logger: Logger | undefined;
const logger = (): Logger => (_logger ??= getLogger('tasks-json-recovery'));

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Outcome of a tasks.json smart-recovery attempt (PRD §5.1).
 *
 * @remarks
 * Always returned (never thrown). `restored:true` means a git-history restore
 * occurred; `restored:false` means either the clean-disk re-apply path ran OR
 * recovery failed non-fatally (inspect `reason`).
 */
export interface TasksJsonRecoveryResult {
  /** true ONLY when a prior committed version was restored from git history. */
  readonly restored: boolean;
  /** 'disk' = clean-disk re-apply path; 'git' = restored from git history. */
  readonly source: 'disk' | 'git';
  /** Human-readable detail (commit hash, path taken, or failure cause). */
  readonly reason?: string;
  /**
   * The authoritative backlog that was written to disk under the lock (PRD §5.1,
   * P3.M1.T2.S2). `undefined` ONLY on a PATH-C failure (no backlog produced).
   * Callers should reuse this directly instead of re-reading `tasks.json`,
   * avoiding a second lock acquisition and a TOCTOU window.
   */
  readonly backlog?: Backlog;
}

/**
 * Options for {@link recoverTasksJson}.
 */
export interface RecoverTasksJsonOptions {
  /**
   * The orchestrator's pre-agent in-memory backlog snapshot. When provided and
   * the on-disk file is clean, recovery reconstructs from this baseline so
   * unauthorized agent mutations to unrelated items are discarded. When
   * omitted, recovery falls back to the disk-read backlog (degradation:
   * unrelated mutations cannot be detected without a baseline).
   */
  readonly baselineBacklog?: Backlog;
  /** Git repository root for the history primitives; defaults to process.cwd(). */
  readonly repoPath?: string;
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Smart-recovery for tasks.json after an agent run (PRD §5.1).
 *
 * @remarks
 * Reconciles on-disk tasks.json after a Coder/agent run:
 *  - **Clean disk** (parses + validates): reconstructs from `opts.baselineBacklog`
 *    (preferred) or the disk backlog, applies ONLY `legitimateDelta`, and writes
 *    INSIDE `withLockedTasksJSON` so the read-modify-write is serialized against
 *    every other writer. Unauthorized agent mutations to unrelated items are
 *    discarded when a baseline is supplied.
 *  - **Corrupt disk** (parse/validate failure): walks git history (via the S1
 *    primitives) OUTSIDE the lock (the walk is read-only and can take seconds;
 *    holding the O_EXCL lock across it risks a stale-lock false-positive), then
 *    restores the LAST VALID committed version + re-applies `legitimateDelta`
 *    INSIDE the lock, preferring a now-healed fresh read if another writer fixed
 *    the corruption during the walk. Preserves items currently in `Researching`
 *    or `Retrying` status (they are carried forward from the restored version —
 *    never dropped to `Planned`). There is NO `Ready` status.
 *  - **Total failure**: logs and leaves state as-is. NEVER throws — a single
 *    corrupting agent must never terminate the session.
 *
 * The written backlog is returned as `result.backlog` so callers reuse it
 * directly instead of re-reading `tasks.json` (eliminates a second lock
 * acquisition + a TOCTOU window).
 *
 * @param tasksPath - Path to the tasks.json FILE (e.g. 'plan/005_.../tasks.json').
 * @param legitimateDelta - The item id + the status the orchestrator intends/just applied.
 * @param opts - Optional baseline backlog + git repo root.
 * @returns Always-resolved typed result (never throws).
 *
 * @example
 * ```ts
 * const result = await recoverTasksJson(
 *   'plan/005_d32a2ecf61cd/tasks.json',
 *   { itemId: 'P5.M1.T2.S4', status: 'Complete' },
 *   { baselineBacklog: orchestrator.backlog, repoPath: process.cwd() }
 * );
 * if (result.restored) logger.info(result.reason, 'tasks.json restored from git');
 * ```
 */
export async function recoverTasksJson(
  tasksPath: string,
  legitimateDelta: { itemId: string; status: Status },
  opts?: RecoverTasksJsonOptions
): Promise<TasksJsonRecoveryResult> {
  const sessionDir = dirname(resolve(tasksPath));
  const repoPath = opts?.repoPath ?? process.cwd();
  const relPath = relative(repoPath, resolve(tasksPath));

  // CRITICAL: outer non-fatal guard — recoverTasksJson NEVER throws to S3.
  try {
    // ---- PATH A: clean disk (parse + validate) ----
    // The validity probe is a best-effort, harmless read; it decides which
    // path to take. It runs OUTSIDE the lock (no serialization needed for a
    // probe).
    let diskClean = false;
    try {
      const candidate = await readTasksJSON(sessionDir); // throws on parse/schema fail
      if (validateBacklogState(candidate).isValid) diskClean = true;
    } catch {
      // corruption signal — fall through to PATH B
    }

    if (diskClean) {
      // RMW inside the lock: merge the legitimate delta onto the FRESH locked
      // read (another writer may have landed changes between the probe and
      // here). Prefer the caller's baseline so unauthorized agent mutations to
      // unrelated items are discarded.
      const written = await withLockedTasksJSON(sessionDir, fresh => {
        const base = opts?.baselineBacklog
          ? (structuredClone(opts.baselineBacklog) as Backlog) // caller-owned → clone
          : fresh; // already a fresh Zod object (no clone needed, R6)
        setItemStatus(base, legitimateDelta.itemId, legitimateDelta.status);
        return base;
      });
      return {
        restored: false,
        source: 'disk',
        reason: 're-applied legitimate status delta',
        backlog: written,
      };
    }

    // ---- PATH B: corrupt disk → walk git history for the last valid version ----
    // The git walk is READ-ONLY and can take seconds; it runs OUTSIDE the lock
    // so a waiter's stale-age check cannot delete a LIVE lock mid-walk (R3).
    const history = await gitFileHistory(relPath, repoPath); // [] on no-history; throws on git error (→ PATH C)
    let restoredBacklog: Backlog | null = null;
    let restoreCommit: string | null = null;
    for (const entry of history) {
      const blob = await gitReadFileAtCommit(relPath, entry.commit, repoPath); // throws on error (→ PATH C)
      try {
        const parsed = JSON.parse(blob);
        restoredBacklog = BacklogSchema.parse(parsed) as Backlog; // schema-valid
        restoreCommit = entry.commit;
        break;
      } catch {
        // this commit's blob wasn't valid JSON / didn't validate — try the next older commit
        continue;
      }
    }

    if (!restoredBacklog || !restoreCommit) {
      // ---- PATH C: no valid version found in history ----
      logger().error(
        { relPath, historyLength: history.length },
        'tasks.json recovery failed: no valid version in git history'
      );
      return {
        restored: false,
        source: 'disk',
        reason: 'recovery failed: no valid version in git history',
      };
    }

    // Phase 2 (under lock, sub-second): the locked read may either (a) succeed —
    // another writer HEALED disk during the walk, so prefer that fresh read;
    // or (b) throw — disk is still corrupt, so use the restored blob as the
    // base (passed as the accessor's readFallback). Then apply ONLY the
    // legitimate delta. Researching/Retrying items are preserved automatically
    // (we mutate ONLY the target item).
    const commit = restoreCommit;
    const written = await withLockedTasksJSON(
      sessionDir,
      base => {
        // If we got here via a successful read (disk healed), `base` is the
        // fresh disk read; validate it and prefer it. If the read threw and the
        // accessor used restoredBacklog, `base` is the restored blob (always
        // valid by construction) → validateBacklogState(...).isValid is true.
        const useFresh = validateBacklogState(base).isValid;
        const target = useFresh
          ? base
          : (structuredClone(restoredBacklog!) as Backlog);
        setItemStatus(target, legitimateDelta.itemId, legitimateDelta.status);
        return target;
      },
      undefined,
      restoredBacklog // readFallback: corrupt disk → use the restored blob
    );
    logger().info({ commit }, 'tasks.json restored from git history');
    return {
      restored: true,
      source: 'git',
      reason: `restored from commit ${commit}`,
      backlog: written,
    };
  } catch (error) {
    // ---- PATH C: any uncaught error (git threw, write threw, etc.) — non-fatal ----
    logger().error(
      { tasksPath, err: (error as Error).message },
      'tasks.json recovery failed (non-fatal); leaving state as-is'
    );
    return {
      restored: false,
      source: 'disk',
      reason: `recovery failed: ${(error as Error).message}`,
    };
  }
}
