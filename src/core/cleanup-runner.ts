/**
 * Cleanup runner seam (P3.M1.T3.S2).
 *
 * @module core/cleanup-runner
 *
 * @remarks
 * This module is the **injectable seam** between the two-phase commit wiring
 * in {@link executeSubtask} (P3.M1.T3.S2) and the real cleanup-agent persona
 * (P3.M1.T3.S3, still Planned). It carries NO agent imports, NO git imports,
 * and NO side effects — only the typed contract plus a no-op default factory.
 *
 * P3.M1.T3.S3 will later replace {@link createCleanupRunner}'s default runner
 * with one that invokes the cleanup agent persona to remove temp artifacts,
 * move `plan/.../research/*` → `docs/`, and save `tasks.json` (PRD §4.2 step 4
 * "Cleanup"). Until S3 lands, the two-phase commit still works — the survival
 * commit persists substance, and the post-cleanup commit simply finds nothing
 * to commit (returns null).
 */

import type { Subtask } from './models.js';

/** Context handed to a cleanup runner (P3.M1.T3.S2 seam → P3.M1.T3.S3 persona). */
export interface CleanupContext {
  /** Absolute path to the session dir: `plan/{seq}_{hash}/` (or bugfix child). */
  readonly sessionPath: string;
  /** The subtask whose artifacts are being cleaned up. */
  readonly subtask: Subtask;
  /** Git repo root = `process.cwd()`. Cleanup operates at repo root. */
  readonly repoRoot: string;
}

/** Result of a cleanup run. `success:false` MUST be non-fatal to executeSubtask. */
export interface CleanupResult {
  /** Whether the cleanup completed its reorganization. */
  readonly success: boolean;
  /** Optional human-readable summary of what the cleanup did. */
  readonly summary?: string;
  /** Optional error message when `success` is `false`. */
  readonly error?: string;
}

/**
 * Injectable cleanup callable. The default is a no-op (see
 * {@link createCleanupRunner}); S3 (P3.M1.T3.S3) supplies the real one.
 */
export type CleanupRunner = (ctx: CleanupContext) => Promise<CleanupResult>;

/**
 * DEFAULT cleanup runner: a no-op.
 *
 * @returns A {@link CleanupRunner} that resolves `{ success: true }` without
 *   touching the filesystem.
 *
 * @remarks
 * P3.M1.T3.S3 replaces this factory's return with a runner that invokes the
 * cleanup agent persona to remove temp artifacts, move docs to `docs/`, and
 * save `tasks.json` (PRD §4.2 step 4 "Cleanup"). Until S3 lands, the
 * two-phase commit still works — the survival commit persists substance, and
 * the post-cleanup commit simply finds nothing to commit (returns null).
 */
export function createCleanupRunner(): CleanupRunner {
  return async (_ctx: CleanupContext): Promise<CleanupResult> => ({
    success: true,
    summary: 'cleanup disabled (no persona wired yet)',
  });
}
