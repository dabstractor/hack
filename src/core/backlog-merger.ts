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

// ============================================================================
// ID-renumbering helpers (BUG-001 fix — P1.M1.T1.S1)
// ============================================================================
//
// Pure primitives that compute the next available ID number at each hierarchy level and
// deep-renumber an architect Phase/Milestone/Task subtree against a target parent prefix,
// producing collision-free, hierarchy-consistent IDs. P1.M1.T1.S2 will wire these into the
// three merge append points (phase/milestone/task collision → renumber-and-append instead of
// skip). These helpers have NO callers yet — they are intentionally additive only.

/**
 * Escape a string for safe embedding in a `RegExp` (dots, etc. are regex-special).
 *
 * @param s - The literal string to escape.
 * @returns The escaped string.
 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Compute the next available phase number from a reserved-id set.
 *
 * @remarks
 * Scans every id in `reserved` matching `^P(\d+)(?:\.M|$)` and returns `max(capture) + 1`,
 * or `1` if none match. The `(?:\.M|$)` tail lets it infer a phase number from a bare `P3`
 * OR from a descendant id like `P3.M1` / `P3.M1.T2.S1` (so it's robust even when the bare
 * phase id isn't directly reserved but its children are).
 *
 * Pure: does not mutate `reserved`.
 *
 * @param reserved - The set of ids already in use.
 * @returns The next available phase number (>= 1).
 */
export function maxPhaseNumber(reserved: Set<string>): number {
  let max = 0;
  for (const id of reserved) {
    const m = /^P(\d+)(?:\.M|$)/.exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

/**
 * Compute the next available child number under a parent id, at a given hierarchy level.
 *
 * @remarks
 * `parentId` is the **immediate parent** for `level` (hierarchy-correct — matches the S2
 * append-point calls, which pass `existing.id`): the phase id for `'milestone'`, the
 * milestone id for `'task'`, and the task id for `'subtask'`. Scans `reserved` for ids of
 * the form `{parentId}.{M|T|S}{n}` and returns `max(n) + 1`, or `1` if none match. The
 * `parentId` is regex-escaped before embedding (dots are regex-special).
 *
 * Pure: does not mutate `reserved`.
 *
 * @param parentId - The immediate parent id (phase/milestone/task).
 * @param reserved - The set of ids already in use.
 * @param level - Which child level to count: `'milestone'` (M-num under a phase), `'task'`
 *                (T-num under a milestone), or `'subtask'` (S-num under a task).
 * @returns The next available child number (>= 1).
 */
export function maxChildNumber(
  parentId: string,
  reserved: Set<string>,
  level: 'milestone' | 'task' | 'subtask'
): number {
  const esc = escapeRegExp(parentId);
  const re =
    level === 'milestone'
      ? new RegExp(`^${esc}\\.M(\\d+)`)
      : level === 'task'
        ? new RegExp(`^${esc}\\.T(\\d+)`)
        : new RegExp(`^${esc}\\.S(\\d+)$`);
  let max = 0;
  for (const id of reserved) {
    const m = re.exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

/**
 * Renumber a `Task` (and its subtasks) into a fresh, collision-free id subtree.
 *
 * @remarks
 * Produces a FRESH deep-cloned `Task` with `id = '${parentMilestoneId}.T${taskNum}'` and
 * every subtask renumbered sequentially in INPUT order (`…T{taskNum}.S{1..l}`). Builds an
 * old→new id map for THIS task's subtree and rewrites every subtask `dependencies` entry
 * found in that map to its new id; entries referencing ids OUTSIDE the renumbered scope are
 * left verbatim (those targets aren't moving). Every other field (`title`, `status`,
 * `description`, `story_points`, `context_scope`, `prd_selectors`) is preserved verbatim.
 *
 * Pure: no I/O, no logger. The ONLY mutation is appending all produced new ids into the
 * `reserved` accumulator (in place).
 *
 * @param task - The task to renumber (read-only).
 * @param parentMilestoneId - The immediate parent milestone id (the new task prefix).
 * @param taskNum - The fresh task number to assign.
 * @param reserved - The running id set; mutated to register the new task + subtask ids.
 * @returns A fresh renumbered `Task`.
 */
export function renumberTask(
  task: Task,
  parentMilestoneId: string,
  taskNum: number,
  reserved: Set<string>
): Task {
  const newTaskId = `${parentMilestoneId}.T${taskNum}`;
  const idMap = new Map<string, string>(); // oldId → newId (this task's subtree)
  idMap.set(task.id, newTaskId);
  const newSubtasks = task.subtasks.map((s, i) => {
    const newSubId = `${newTaskId}.S${i + 1}`;
    idMap.set(s.id, newSubId);
    return { ...s, id: newSubId };
  });
  // Rewrite deps using the fully-populated idMap so cross-subtask deps within the task resolve.
  const remappedSubtasks = newSubtasks.map(s => ({
    ...s,
    dependencies: s.dependencies.map(d => idMap.get(d) ?? d),
  }));
  reserved.add(newTaskId);
  for (const s of remappedSubtasks) reserved.add(s.id);
  return { ...task, id: newTaskId, subtasks: remappedSubtasks };
}

/**
 * Renumber a `Milestone` (and its task subtree) into a fresh, collision-free id subtree.
 *
 * @remarks
 * Produces a FRESH deep-cloned `Milestone` with `id = '${parentPhaseId}.M${msNum}'` and
 * every task renumbered sequentially in INPUT order (`…M{msNum}.T{1..j}`) via {@link
 * renumberTask}. Builds an old→new id map for the WHOLE milestone scope (ms + all tasks +
 * subtasks) so subtask `dependencies` referencing any in-scope sibling are rewritten; deps to
 * ids outside the scope are left verbatim. Every non-id field is preserved verbatim.
 *
 * Pure: no I/O, no logger. The ONLY mutation is appending all produced new ids into the
 * `reserved` accumulator (in place).
 *
 * @param ms - The milestone to renumber (read-only).
 * @param parentPhaseId - The immediate parent phase id (the new milestone prefix).
 * @param msNum - The fresh milestone number to assign.
 * @param reserved - The running id set; mutated to register the new milestone + descendant ids.
 * @returns A fresh renumbered `Milestone`.
 */
export function renumberMilestone(
  ms: Milestone,
  parentPhaseId: string,
  msNum: number,
  reserved: Set<string>
): Milestone {
  const newMsId = `${parentPhaseId}.M${msNum}`;
  const idMap = new Map<string, string>(); // oldId → newId (whole milestone scope)
  idMap.set(ms.id, newMsId);
  // Pass 1 — populate the scope map so cross-task/subtask in-scope deps resolve.
  ms.tasks.forEach((t, j) => {
    const newTaskId = `${newMsId}.T${j + 1}`;
    idMap.set(t.id, newTaskId);
    t.subtasks.forEach((s, k) => {
      idMap.set(s.id, `${newTaskId}.S${k + 1}`);
    });
  });
  // Pass 2 — build renumbered tasks with ids + dep rewrite via the fully-populated idMap.
  const renumberedTasks: Task[] = ms.tasks.map((t, j) => {
    const newTaskId = `${newMsId}.T${j + 1}`;
    const remappedSubtasks = t.subtasks.map((s, k) => {
      const newSubId = `${newTaskId}.S${k + 1}`;
      return {
        ...s,
        id: newSubId,
        dependencies: s.dependencies.map(
          d => idMap.get(d) ?? d // in-scope → new id; else verbatim
        ),
      };
    });
    reserved.add(newTaskId);
    for (const s of remappedSubtasks) reserved.add(s.id);
    return { ...t, id: newTaskId, subtasks: remappedSubtasks };
  });
  reserved.add(newMsId);
  return { ...ms, id: newMsId, tasks: renumberedTasks };
}

/**
 * Renumber a `Phase` (and its entire milestone subtree) into a fresh, collision-free id tree.
 *
 * @remarks
 * Produces a FRESH deep-cloned `Phase` with `id = 'P${phaseNum}'` and every milestone
 * renumbered sequentially in INPUT order (`P{phaseNum}.M{1..k}`) via {@link renumberMilestone},
 * which in turn renumbers tasks (`…M{k}.T{1..j}`) and subtasks (`…T{j}.S{1..l}`). Builds an
 * old→new id map for the WHOLE phase scope (phase + every descendant) so subtask
 * `dependencies` referencing any in-scope sibling are rewritten; deps to ids outside the
 * scope are left verbatim. Every non-id field is preserved verbatim.
 *
 * Pure: no I/O, no logger. The ONLY mutation is appending all produced new ids into the
 * `reserved` accumulator (in place).
 *
 * @param phase - The phase to renumber (read-only).
 * @param phaseNum - The fresh phase number to assign.
 * @param reserved - The running id set; mutated to register the new phase + descendant ids.
 * @returns A fresh renumbered `Phase`.
 */
export function renumberPhase(
  phase: Phase,
  phaseNum: number,
  reserved: Set<string>
): Phase {
  const newPhaseId = `P${phaseNum}`;
  const idMap = new Map<string, string>(); // oldId → newId (whole phase scope)
  idMap.set(phase.id, newPhaseId);
  // Pass 1 — populate the scope map so cross-milestone/task/subtask in-scope deps resolve.
  phase.milestones.forEach((m, i) => {
    const newMsId = `${newPhaseId}.M${i + 1}`;
    idMap.set(m.id, newMsId);
    m.tasks.forEach((t, j) => {
      const newTaskId = `${newMsId}.T${j + 1}`;
      idMap.set(t.id, newTaskId);
      t.subtasks.forEach((s, k) => {
        idMap.set(s.id, `${newTaskId}.S${k + 1}`);
      });
    });
  });
  // Pass 2 — renumber using the fully-populated idMap.
  const renumberedMilestones: Milestone[] = phase.milestones.map((m, i) => {
    const newMsId = `${newPhaseId}.M${i + 1}`;
    const renumberedTasks: Task[] = m.tasks.map((t, j) => {
      const newTaskId = `${newMsId}.T${j + 1}`;
      const remappedSubtasks = t.subtasks.map((s, k) => {
        const newSubId = `${newTaskId}.S${k + 1}`;
        return {
          ...s,
          id: newSubId,
          dependencies: s.dependencies.map(
            d => idMap.get(d) ?? d // in-scope → new id; else verbatim
          ),
        };
      });
      reserved.add(newTaskId);
      for (const s of remappedSubtasks) reserved.add(s.id);
      return { ...t, id: newTaskId, subtasks: remappedSubtasks };
    });
    reserved.add(newMsId);
    return { ...m, id: newMsId, tasks: renumberedTasks };
  });
  reserved.add(newPhaseId);
  return { ...phase, id: newPhaseId, milestones: renumberedMilestones };
}
