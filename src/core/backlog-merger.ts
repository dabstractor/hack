/**
 * Backlog merger: combine a patched backlog with an architect's added-requirement output
 *
 * @module core/backlog-merger
 *
 * @remarks
 * Used by the delta-session path in {@link PRPPipeline.decomposePRD}: the architect agent
 * decomposes ONLY the added requirements (from `delta_prd.md`) and writes its output to
 * `tasks.json`, clobbering the patched backlog the pipeline had staged in memory. This module
 * merges that architect output back together with the in-memory patched backlog
 * (`SessionManager.currentSession.taskRegistry` — whose modified→`Planned` and removed→`Obsolete`
 * statuses were already applied by {@link patchBacklog}) so the saved `tasks.json` ends up with
 * BOTH the patched statuses AND the new added-requirement tasks.
 *
 * Matching rules:
 * - **Phase / Milestone** merge by **title** (trimmed, case-sensitive) — robust to the architect
 *   re-numbering IDs, since it sees only `delta_prd.md` and not the existing ID space. A
 *   matching title EXTENDS the existing item (new milestones/tasks folded in); a new title APPENDS.
 * - **Task / Subtask** de-duplicate by **ID** — so re-decomposed modified/removed items don't
 *   duplicate. A task whose ID already exists in the patched backlog is SKIPPED (the patched
 *   version — with the correct status — is kept).
 * - **Defensive ID-collision skips** at the Phase/Milestone level too: the schemas don't enforce
 *   ID uniqueness, so the merge never introduces a duplicate ID. Every skip is LOGGED (`warn`),
 *   never silent (the original bug was a silent drop).
 *
 * The merge is a PURE, synchronous transform: both inputs are treated as read-only (the result
 * is a fresh `Backlog`); statuses are NEVER changed (the patched backlog is the base); and no
 * `BacklogSchema` validation happens here (`SessionManager.saveBacklog` validates on write).
 *
 * @example
 * ```typescript
 * import { mergeBacklogs } from './core/backlog-merger.js';
 *
 * // patchedBacklog: modified/removed statuses already applied (in-memory registry)
 * // architectBacklog: freshly-decomposed added-requirement tasks (from disk)
 * const merged = mergeBacklogs(patchedBacklog, architectBacklog);
 * await sessionManager.saveBacklog(merged);
 * ```
 */

import type { Backlog, Phase, Milestone, Task } from './models.js';
import { getLogger, type Logger } from '../utils/logger.js';

// Module-level logger for the backlog merger.
let _logger: Logger | undefined;
const logger = (): Logger => (_logger ??= getLogger('BacklogMerger'));

// ============================================================================
// ID helpers
// ============================================================================

/**
 * Collect every Phase/Milestone/Task/Subtask id in `backlog` (for de-dup collision checks).
 *
 * @param backlog - The backlog to scan.
 * @returns A fresh `Set` of every id present at any nesting level.
 */
function collectIds(backlog: Backlog): Set<string> {
  const ids = new Set<string>();
  for (const p of backlog.backlog) {
    ids.add(p.id);
    for (const m of p.milestones) {
      ids.add(m.id);
      for (const t of m.tasks) {
        ids.add(t.id);
        for (const s of t.subtasks) ids.add(s.id);
      }
    }
  }
  return ids;
}

/**
 * Register a Phase's id + all descendant ids into `ids` (so later architect items can't double-add).
 *
 * @param phase - The phase whose ids (and descendants) to register.
 * @param ids - The running id set (mutated in place).
 */
function registerPhaseIds(phase: Phase, ids: Set<string>): void {
  ids.add(phase.id);
  for (const m of phase.milestones) {
    ids.add(m.id);
    for (const t of m.tasks) {
      ids.add(t.id);
      for (const s of t.subtasks) ids.add(s.id);
    }
  }
}

// ============================================================================
// Per-level merge helpers
// ============================================================================

/**
 * Extend an existing milestone with the architect milestone's NEW tasks (id-de-duped).
 *
 * @remarks
 * Tasks/Subtasks are de-duplicated by ID (contract (c)): an architect task whose ID already
 * exists is SKIPPED with a `warn` (the patched version — with the correct status — is kept).
 *
 * @param existing - The patched (base) milestone.
 * @param archMs - The architect milestone whose tasks should be folded in.
 * @param existingIds - The running id set (mutated as new tasks/subtasks are appended).
 * @returns A fresh `Milestone` with the merged tasks.
 */
function mergeMilestone(
  existing: Milestone,
  archMs: Milestone,
  existingIds: Set<string>
): Milestone {
  const tasks: Task[] = [...existing.tasks];
  for (const archTask of archMs.tasks) {
    if (existingIds.has(archTask.id)) {
      logger().warn(
        { itemId: archTask.id, level: 'task' },
        'merge de-dup skip: architect task id already exists (patched status preserved)'
      );
      continue; // de-dup — keep patched's version (correct status)
    }
    existingIds.add(archTask.id);
    for (const s of archTask.subtasks) existingIds.add(s.id);
    tasks.push(archTask);
  }
  return { ...existing, tasks };
}

/**
 * Extend an existing phase with the architect phase's milestones (title-match or append).
 *
 * @remarks
 * Milestones merge by **title** (trimmed): a matching title extends the existing milestone (new
 * tasks folded in); a new title appends the architect milestone wholesale. A milestone whose ID
 * already exists (despite a new title) is SKIPPED with a `warn` (defensive — no duplicate ids).
 *
 * @param existing - The patched (base) phase.
 * @param archPhase - The architect phase whose milestones should be folded in.
 * @param existingIds - The running id set (mutated as new milestones/tasks/subtasks are appended).
 * @returns A fresh `Phase` with the merged milestones.
 */
function mergePhase(
  existing: Phase,
  archPhase: Phase,
  existingIds: Set<string>
): Phase {
  const milestones: Milestone[] = [...existing.milestones];
  const msByTitle = new Map<string, number>();
  milestones.forEach((m, i) => msByTitle.set(m.title.trim(), i));

  for (const archMs of archPhase.milestones) {
    const idx = msByTitle.get(archMs.title.trim());
    if (idx !== undefined) {
      milestones[idx] = mergeMilestone(milestones[idx], archMs, existingIds); // extend by title
    } else if (!existingIds.has(archMs.id)) {
      existingIds.add(archMs.id);
      for (const t of archMs.tasks) {
        existingIds.add(t.id);
        for (const s of t.subtasks) existingIds.add(s.id);
      }
      msByTitle.set(archMs.title.trim(), milestones.length);
      milestones.push(archMs); // new milestone
    } else {
      logger().warn(
        { itemId: archMs.id, level: 'milestone' },
        'merge de-dup skip: architect milestone id already exists'
      );
    }
  }
  return { ...existing, milestones };
}

// ============================================================================
// MAIN FUNCTION
// ============================================================================

/**
 * Merge two backlogs: patched (base, statuses preserved) ⊕ architect (added-req tasks).
 *
 * @remarks
 * Combines the architect's freshly-decomposed tasks for ADDED requirements with the patched
 * backlog (whose modified→`Planned` and removed→`Obsolete` statuses are already applied by
 * {@link patchBacklog}). Matching is by **title** at the Phase and Milestone levels (robust to the
 * architect re-numbering IDs, since it sees only `delta_prd.md`); Tasks/Subtasks are
 * de-duplicated by **ID** so re-decomposed modified/removed items don't duplicate. Any architect
 * item whose ID already exists is SKIPPED with a `warn` (observable de-dup — never a silent drop).
 *
 * Both inputs are treated as read-only; the result is a fresh `Backlog`. The patched backlog's
 * statuses are preserved verbatim (it is the base). `mergeBacklogs` is a pure, synchronous
 * transform — it does NOT validate (that happens in `SessionManager.saveBacklog` via
 * `BacklogSchema.parse`) and does NOT change statuses (that already happened in `patchBacklog`).
 *
 * **No-op identity**: `mergeBacklogs({ backlog: [] }, x)` deep-equals `x`, so wiring this into
 * the non-delta-no-backlog path of `decomposePRD` is byte-equivalent to the prior behavior.
 *
 * @param patched - The base backlog (modified/removed statuses already applied).
 * @param architect - The architect's output for added requirements (from `delta_prd.md` breakdown).
 * @returns A new merged `Backlog` (will be `BacklogSchema`-valid, since IDs are preserved verbatim
 *          from two valid inputs and collisions are de-duped).
 *
 * @example
 * ```typescript
 * import { mergeBacklogs } from './core/backlog-merger.js';
 *
 * const merged = mergeBacklogs(patchedBacklog, architectBacklog);
 * // merged has ALL patched items (statuses intact) PLUS the architect's new items.
 * ```
 */
export function mergeBacklogs(patched: Backlog, architect: Backlog): Backlog {
  const existingIds = collectIds(patched);
  const result: Phase[] = [...patched.backlog];
  const phaseByTitle = new Map<string, number>();
  result.forEach((p, i) => phaseByTitle.set(p.title.trim(), i));

  for (const archPhase of architect.backlog) {
    const idx = phaseByTitle.get(archPhase.title.trim());
    if (idx !== undefined) {
      result[idx] = mergePhase(result[idx], archPhase, existingIds); // extend by title
    } else if (!existingIds.has(archPhase.id)) {
      registerPhaseIds(archPhase, existingIds);
      phaseByTitle.set(archPhase.title.trim(), result.length);
      result.push(archPhase); // new phase
    } else {
      logger().warn(
        { itemId: archPhase.id, level: 'phase' },
        'merge de-dup skip: architect phase id already exists'
      );
    }
  }
  return { backlog: result };
}
