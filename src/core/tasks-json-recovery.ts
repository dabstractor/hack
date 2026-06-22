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
import type {
  Backlog,
  Phase,
  Milestone,
  Task,
  Subtask,
  Status,
} from './models.js';
import { BacklogSchema } from './models.js';
import { readTasksJSON, writeTasksJSON } from './session-utils.js';
import { validateBacklogState } from './state-validator.js';
import { gitFileHistory, gitReadFileAtCommit } from '../tools/git-mcp.js';
import { getLogger } from '../utils/logger.js';

const logger = getLogger('tasks-json-recovery');

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
// INTERNAL HELPERS
// ============================================================================

/**
 * Union of any hierarchy node (all have id + status).
 */
type AnyItem = Phase | Milestone | Task | Subtask;

/**
 * Recursively set the status of the item with `itemId` (mutates in place via
 * the established readonly-cast idiom; mirrors state-validator.ts repair fns).
 * Returns true if the item was found.
 *
 * @internal
 */
function setItemStatus(
  backlog: Backlog,
  itemId: string,
  status: Status
): boolean {
  let found = false;
  const visit = (item: AnyItem): void => {
    if (item.id === itemId) {
      // readonly cast idiom (same as state-validator's dependency repair)
      (item as { status: Status }).status = status;
      found = true;
      return; // ids are unique; stop descending once found
    }
    if ('milestones' in item) item.milestones.forEach(visit);
    if ('tasks' in item) item.tasks.forEach(visit);
    if ('subtasks' in item) item.subtasks.forEach(visit);
  };
  backlog.backlog.forEach(visit);
  return found;
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
 *    (preferred) or the disk backlog, applies ONLY `legitimateDelta`, and writes.
 *    Unauthorized agent mutations to unrelated items are discarded when a
 *    baseline is supplied.
 *  - **Corrupt disk** (parse/validate failure): walks git history (via the S1
 *    primitives), restores the LAST VALID committed version, re-applies
 *    `legitimateDelta`, and preserves items currently in `Researching` or
 *    `Retrying` status (they are carried forward from the restored version —
 *    never dropped to `Planned`). There is NO `Ready` status.
 *  - **Total failure**: logs and leaves state as-is. NEVER throws — a single
 *    corrupting agent must never terminate the session.
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
    let diskBacklog: Backlog | null = null;
    try {
      const candidate = await readTasksJSON(sessionDir); // throws on parse/schema fail
      if (validateBacklogState(candidate).isValid) diskBacklog = candidate;
    } catch {
      // corruption signal — fall through to PATH B
    }

    if (diskBacklog) {
      const base = opts?.baselineBacklog ?? diskBacklog; // baseline preferred → discards unauthorized mutations
      const reconstructed = structuredClone(base) as Backlog;
      setItemStatus(
        reconstructed,
        legitimateDelta.itemId,
        legitimateDelta.status
      );
      await writeTasksJSON(sessionDir, reconstructed);
      return {
        restored: false,
        source: 'disk',
        reason: 're-applied legitimate status delta',
      };
    }

    // ---- PATH B: corrupt disk → walk git history for the last valid version ----
    const history = await gitFileHistory(relPath, repoPath); // [] on no-history; throws on git error (→ PATH C)
    for (const entry of history) {
      const blob = await gitReadFileAtCommit(relPath, entry.commit, repoPath); // throws on error (→ PATH C)
      try {
        const parsed = JSON.parse(blob);
        const restored = BacklogSchema.parse(parsed) as Backlog; // schema-valid
        // prefer fully-valid; schema-valid alone is acceptable (deeper issues are rare post-restore)
        // Researching/Retrying items are preserved automatically (we mutate ONLY the target item below)
        const reconstructed = structuredClone(restored) as Backlog;
        setItemStatus(
          reconstructed,
          legitimateDelta.itemId,
          legitimateDelta.status
        );
        await writeTasksJSON(sessionDir, reconstructed);
        logger.info(
          { commit: entry.commit },
          'tasks.json restored from git history'
        );
        return {
          restored: true,
          source: 'git',
          reason: `restored from commit ${entry.commit}`,
        };
      } catch {
        // this commit's blob wasn't valid JSON / didn't validate — try the next older commit
        continue;
      }
    }

    // ---- PATH C: no valid version found in history ----
    logger.error(
      { relPath, historyLength: history.length },
      'tasks.json recovery failed: no valid version in git history'
    );
    return {
      restored: false,
      source: 'disk',
      reason: 'recovery failed: no valid version in git history',
    };
  } catch (error) {
    // ---- PATH C: any uncaught error (git threw, write threw, etc.) — non-fatal ----
    logger.error(
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
