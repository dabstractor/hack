/**
 * Utility functions for task hierarchy operations
 *
 * @module utils/task-utils
 *
 * @remarks
 * Provides pure functions for navigating, querying, and updating the
 * 4-level task hierarchy (Backlog > Phase > Milestone > Task > Subtask).
 * All functions maintain immutability and type safety.
 *
 * @example
 * ```typescript
 * import { findItem, updateItemStatus } from './utils/task-utils.js';
 *
 * const item = findItem(backlog, 'P1.M1.T1.S1');
 * const updated = updateItemStatus(backlog, 'P1.M1.T1.S1', 'Complete');
 * ```
 */

import type {
  Backlog,
  Phase,
  Milestone,
  Task,
  Subtask,
  Status,
} from '../core/models.js';

/**
 * Union type for any item in the hierarchy
 *
 * @remarks
 * This type enables type-safe operations on heterogeneous collections
 * of work items. Use discriminated union type narrowing with the `type` field.
 *
 * @example
 * ```typescript
 * function processItem(item: HierarchyItem): string {
 *   switch (item.type) {
 *     case 'Subtask': return `${item.story_points} points`;
 *     case 'Task': return `${item.subtasks.length} subtasks`;
 *     // TypeScript knows the exact type in each case
 *   }
 * }
 * ```
 */
export type HierarchyItem = Phase | Milestone | Task | Subtask;

/**
 * Type guard to check if an item is a Subtask
 *
 * @param item - The item to check
 * @returns True if the item is a Subtask
 *
 * @example
 * ```typescript
 * const item = findItem(backlog, 'P1.M1.T1.S1');
 * if (isSubtask(item)) {
 *   console.log(item.story_points); // TypeScript knows this is Subtask
 * }
 * ```
 */
export function isSubtask(item: HierarchyItem): item is Subtask {
  return item.type === 'Subtask';
}

/**
 * Recursively search the hierarchy for an item by ID
 *
 * @param backlog - The backlog to search
 * @param id - The ID of the item to find
 * @returns The found item or null if not found
 *
 * @remarks
 * Uses depth-first search (DFS) pre-order traversal with early exit.
 * Searches through phases, milestones, tasks, and subtasks in order.
 * Returns immediately upon finding the matching item for efficiency.
 *
 * @example
 * ```typescript
 * const subtask = findItem(backlog, 'P1.M1.T1.S1');
 * if (subtask && subtask.type === 'Subtask') {
 *   console.log(subtask.title);
 * }
 *
 * const notFound = findItem(backlog, 'INVALID-ID');
 * console.log(notFound); // null
 * ```
 */
export function findItem(backlog: Backlog, id: string): HierarchyItem | null {
  for (const phase of backlog.backlog) {
    if (phase.id === id) return phase;

    for (const milestone of phase.milestones) {
      if (milestone.id === id) return milestone;

      for (const task of milestone.tasks) {
        if (task.id === id) return task;

        for (const subtask of task.subtasks) {
          if (subtask.id === id) return subtask;
        }
      }
    }
  }

  return null;
}

/**
 * Normalize a loose task-ID string into a numeric segment array (PRD §5.4).
 *
 * @remarks
 * Extracts every digit sequence via `/\d+/g` and maps each to a number, so all of
 * the following are equivalent: `P1.M1.T1.S1`, `p1m1t1s1`, `1.1.1.1` → `[1,1,1,1]`;
 * `1.2` → `[1,2]`; `1` → `[1]`. The `P`/`M`/`T`/`S` letters are NOT required.
 * Segments map positionally Phase → Milestone → Task → Subtask. Returns `null` when
 * there are no digit sequences (empty/whitespace/no-digits) or more than 4 segments
 * (the hierarchy is at most 4 deep). Note: `'0'` normalizes to `[0]` (syntactically
 * valid) — it is rejected later by {@link findItemByLooseId}'s 1-based positional
 * lookup, not here.
 *
 * @param looseId - The raw task-ID string from the CLI.
 * @returns The numeric segments (1–4 numbers), or `null` if unparseable / too deep.
 *
 * @example
 * normalizeTaskId('P1.M1.T1.S1'); // [1,1,1,1]
 * normalizeTaskId('p1m1t1s1');    // [1,1,1,1]
 * normalizeTaskId('1.1.1.1');     // [1,1,1,1]
 * normalizeTaskId('1.2');         // [1,2]
 * normalizeTaskId('1');           // [1]
 * normalizeTaskId('');            // null
 * normalizeTaskId('1.2.3.4.5');   // null (>4 segments)
 */
export function normalizeTaskId(looseId: string): number[] | null {
  const nums = looseId.match(/\d+/g);
  if (!nums) return null;
  if (nums.length > 4) return null;
  return nums.map(Number);
}

/**
 * Find a hierarchy item by a loose task-ID, walking the tree positionally (PRD §5.4).
 *
 * @remarks
 * Normalizes `looseId` via {@link normalizeTaskId}, then walks 1-BASED:
 * `segments[0]` → `backlog.backlog[segments[0]-1]` (phase), `segments[1]` →
 * `phase.milestones[segments[1]-1]` (milestone), `segments[2]` →
 * `milestone.tasks[segments[2]-1]` (task), `segments[3]` → `task.subtasks[segments[3]-1]`
 * (subtask). Trailing segments may be omitted (fewer segments = higher-level item), so
 * `1`, `1.2`, `1.2.3`, `1.2.3.4` target a Phase, Milestone, Task, Subtask respectively.
 * Out-of-bounds at any level → `null`. The returned `canonicalId` is the found item's
 * ACTUAL `id` field (e.g. `'P1.M1.T1.S1'`), not a reconstructed string.
 *
 * @param backlog - The backlog tree to search.
 * @param looseId - The loose task-ID (any form {@link normalizeTaskId} accepts).
 * @returns The found item + its canonical id, or `null` if not found / unparseable.
 *
 * @example
 * findItemByLooseId(backlog, '1.1.1.1');   // { item: <Subtask P1.M1.T1.S1>, canonicalId: 'P1.M1.T1.S1' }
 * findItemByLooseId(backlog, 'p1m1t1s1');  // same item (case/punctuation-insensitive)
 * findItemByLooseId(backlog, '1.2');       // { item: <Milestone P1.M2>, canonicalId: 'P1.M2' }
 * findItemByLooseId(backlog, '1');         // { item: <Phase P1>, canonicalId: 'P1' }
 * findItemByLooseId(backlog, '9.9.9.9');   // null (out of bounds)
 */
export function findItemByLooseId(
  backlog: Backlog,
  looseId: string
): { item: HierarchyItem; canonicalId: string } | null {
  const segments = normalizeTaskId(looseId);
  if (!segments) return null;

  const phase = backlog.backlog[segments[0] - 1];
  if (!phase) return null;
  if (segments.length === 1) return { item: phase, canonicalId: phase.id };

  const milestone = phase.milestones[segments[1] - 1];
  if (!milestone) return null;
  if (segments.length === 2)
    return { item: milestone, canonicalId: milestone.id };

  const task = milestone.tasks[segments[2] - 1];
  if (!task) return null;
  if (segments.length === 3) return { item: task, canonicalId: task.id };

  const subtask = task.subtasks[segments[3] - 1];
  if (!subtask) return null;
  return { item: subtask, canonicalId: subtask.id };
}

/**
 * Resolve dependency IDs to actual Subtask objects
 *
 * @param task - The subtask whose dependencies to resolve
 * @param backlog - The backlog to search for dependencies
 * @returns Array of Subtask objects matching the dependency IDs
 *
 * @remarks
 * Maps the task's dependencies array, calling findItem for each ID.
 * Filters to include only Subtask results (findItem can return any type).
 * Handles circular/malformed dependencies gracefully by returning empty
 * array for non-existent or non-subtask dependencies.
 *
 * @example
 * ```typescript
 * const subtask = findItem(backlog, 'P1.M1.T1.S2') as Subtask;
 * const deps = getDependencies(subtask, backlog);
 * // deps contains the actual Subtask objects for dependencies
 * console.log(deps.map(d => d.title));
 * ```
 */
export function getDependencies(task: Subtask, backlog: Backlog): Subtask[] {
  const results: Subtask[] = [];

  for (const depId of task.dependencies) {
    const item = findItem(backlog, depId);
    if (item && isSubtask(item)) {
      results.push(item);
    }
  }

  return results;
}

/**
 * Extract all Subtask objects from a backlog
 *
 * @param backlog - The backlog to extract subtasks from
 * @returns Flat array of all Subtask objects in the backlog
 *
 * @remarks
 * Recursively traverses Phase > Milestone > Task > Subtask hierarchy
 * and returns a flat array of all Subtask objects. This is useful for
 * operations that need to work with all subtasks, such as building
 * dependency graphs or computing aggregate statistics.
 *
 * Returns empty array if backlog contains no phases or subtasks.
 *
 * @example
 * ```typescript
 * const allSubtasks = getAllSubtasks(backlog);
 * console.log(`Total subtasks: ${allSubtasks.length}`);
 *
 * // Build dependency graph
 * const graph = Object.fromEntries(
 *   allSubtasks.map(s => [s.id, s.dependencies])
 * );
 * ```
 */
export function getAllSubtasks(backlog: Backlog): Subtask[] {
  const allSubtasks: Subtask[] = [];

  for (const phase of backlog.backlog) {
    for (const milestone of phase.milestones) {
      for (const task of milestone.tasks) {
        // Collect all subtasks from this task
        allSubtasks.push(...task.subtasks);
      }
    }
  }

  return allSubtasks;
}

/**
 * Return all items with the given status across all hierarchy levels
 *
 * @param backlog - The backlog to search
 * @param status - The status to filter by
 * @returns Array of items matching the status (may be empty)
 *
 * @remarks
 * Uses DFS traversal collecting all items matching the specified status.
 * Returns items of all 4 types (Phase, Milestone, Task, Subtask) in
 * pre-order traversal order. Returns empty array if no matches found.
 *
 * @example
 * ```typescript
 * const plannedItems = filterByStatus(backlog, 'Planned');
 * console.log(`${plannedItems.length} items are planned`);
 *
 * const completeItems = filterByStatus(backlog, 'Complete');
 * const completeSubtasks = completeItems.filter(item => item.type === 'Subtask');
 * ```
 */
export function filterByStatus(
  backlog: Backlog,
  status: Status
): HierarchyItem[] {
  const results: HierarchyItem[] = [];

  for (const phase of backlog.backlog) {
    if (phase.status === status) results.push(phase);

    for (const milestone of phase.milestones) {
      if (milestone.status === status) results.push(milestone);

      for (const task of milestone.tasks) {
        if (task.status === status) results.push(task);

        for (const subtask of task.subtasks) {
          if (subtask.status === status) results.push(subtask);
        }
      }
    }
  }

  return results;
}

/**
 * Find the first item with 'Planned' status in DFS pre-order
 *
 * @param backlog - The backlog to search
 * @returns The first 'Planned' item or null if none exist
 *
 * @remarks
 * Uses depth-first search with early return on first match.
 * Checks parent before children (pre-order traversal), meaning
 * a phase will be returned before its milestones if both are planned.
 * Returns null if no items have 'Planned' status.
 *
 * @example
 * ```typescript
 * const next = getNextPendingItem(backlog);
 * if (next) {
 *   console.log(`Next item to work on: ${next.title}`);
 * } else {
 *   console.log('No planned items found');
 * }
 * ```
 */
export function getNextPendingItem(backlog: Backlog): HierarchyItem | null {
  for (const phase of backlog.backlog) {
    if (phase.status === 'Planned') return phase;

    for (const milestone of phase.milestones) {
      if (milestone.status === 'Planned') return milestone;

      for (const task of milestone.tasks) {
        if (task.status === 'Planned') return task;

        for (const subtask of task.subtasks) {
          if (subtask.status === 'Planned') return subtask;
        }
      }
    }
  }

  return null;
}

/**
 * Immutable status update with deep copy
 *
 * @param backlog - The backlog to update
 * @param id - The ID of the item to update
 * @param newStatus - The new status to set
 * @returns A new Backlog object with updated status
 *
 * @remarks
 * Creates a deep copy using nested spread operators, updating only the
 * target item. Uses structural sharing where possible - only copies nodes
 * along the path to the updated item. The original backlog remains unchanged.
 *
 * This function must copy the entire path to the item because TypeScript's
 * readonly properties prevent shallow mutation.
 *
 * @example
 * ```typescript
 * const originalJSON = JSON.stringify(backlog);
 * const updated = updateItemStatus(backlog, 'P1.M1.T1.S1', 'Complete');
 *
 * // Original is unchanged
 * console.assert(JSON.stringify(backlog) === originalJSON);
 *
 * // Updated has new status
 * const updatedItem = findItem(updated, 'P1.M1.T1.S1');
 * console.assert(updatedItem?.status === 'Complete');
 * ```
 */

/**
 * Promote a parent (Task/Milestone/Phase) status given its children's statuses.
 *
 * @remarks
 * Returns 'Complete' only when ALL non-obsolete children are 'Complete'.
 * Otherwise returns `current` unchanged. Crucially this is MONOTONIC: it only
 * ever upgrades toward 'Complete' and never touches a parent that is already
 * 'Complete' or explicitly 'Obsolete'. That makes it safe to run after every
 * status mutation without clobbering explicit overrides (e.g. task-patcher
 * marking a task 'Obsolete', or a parent pre-set to 'Complete').
 */
function promoteIfAllComplete(
  children: { status: Status }[],
  current: Status
): Status {
  if (current === 'Complete' || current === 'Obsolete') {
    return current;
  }
  const active = children.filter(c => c.status !== 'Obsolete');
  if (active.length === 0) {
    return current;
  }
  return active.every(c => c.status === 'Complete') ? 'Complete' : current;
}

/**
 * Roll completion status up the hierarchy after a leaf (subtask) change.
 *
 * @remarks
 * `updateItemStatus` historically mutated only the exact target item, so a
 * Task whose subtasks were all 'Complete' still showed 'Planned', Milestones
 * never reached 'Complete', and a Phase stayed stuck on 'Ready' — contradicting
 * the models.ts contract ("A Task is typically completed when all its subtasks
 * are Complete"). This walks the tree bottom-up and promotes each ancestor to
 * 'Complete' when all its non-obsolete children are 'Complete'.
 *
 * Because promotion is monotonic and short-circuits on 'Complete'/'Obsolete'
 * parents, this is idempotent and side-effect-free for already-consistent trees
 * (it returns the same Backlog reference when nothing changes, preserving
 * structural sharing for unchanged subtrees).
 */
function rollupCompletion(backlog: Backlog): Backlog {
  let mutated = false;

  const phases = backlog.backlog.map(phase => {
    let phaseChanged = false;

    const milestones = phase.milestones.map(milestone => {
      let milestoneChanged = false;

      const tasks = milestone.tasks.map(task => {
        const taskStatus = promoteIfAllComplete(task.subtasks, task.status);
        if (taskStatus !== task.status) {
          milestoneChanged = true;
          return { ...task, status: taskStatus };
        }
        return task;
      });

      const milestoneStatus = promoteIfAllComplete(tasks, milestone.status);
      if (milestoneStatus !== milestone.status || milestoneChanged) {
        phaseChanged = true;
        return { ...milestone, tasks, status: milestoneStatus };
      }
      return milestone;
    });

    const phaseStatus = promoteIfAllComplete(milestones, phase.status);
    if (phaseStatus !== phase.status || phaseChanged) {
      mutated = true;
      return { ...phase, milestones, status: phaseStatus };
    }
    return phase;
  });

  return mutated ? { ...backlog, backlog: phases } : backlog;
}

export function updateItemStatus(
  backlog: Backlog,
  id: string,
  newStatus: Status
): Backlog {
  const updated: Backlog = {
    ...backlog,
    backlog: backlog.backlog.map(phase => {
      // Check if this is the target phase
      if (phase.id === id) {
        return { ...phase, status: newStatus };
      }

      // Check if target might be in this phase's descendants
      let phaseContainsTarget = false;
      for (const milestone of phase.milestones) {
        if (milestone.id === id) {
          phaseContainsTarget = true;
          break;
        }
        for (const task of milestone.tasks) {
          if (task.id === id) {
            phaseContainsTarget = true;
            break;
          }
          for (const subtask of task.subtasks) {
            if (subtask.id === id) {
              phaseContainsTarget = true;
              break;
            }
          }
          if (phaseContainsTarget) break;
        }
        if (phaseContainsTarget) break;
      }

      // If target is not in this phase, return unchanged
      if (!phaseContainsTarget) {
        return phase;
      }

      // Target is in this phase, search deeper
      return {
        ...phase,
        milestones: phase.milestones.map(milestone => {
          if (milestone.id === id) {
            return { ...milestone, status: newStatus };
          }

          // Check if target is in this milestone's descendants
          let milestoneContainsTarget = false;
          for (const task of milestone.tasks) {
            if (task.id === id) {
              milestoneContainsTarget = true;
              break;
            }
            for (const subtask of task.subtasks) {
              if (subtask.id === id) {
                milestoneContainsTarget = true;
                break;
              }
            }
            if (milestoneContainsTarget) break;
          }

          // If target is not in this milestone, return unchanged
          if (!milestoneContainsTarget) {
            return milestone;
          }

          // Target is in this milestone, search deeper
          return {
            ...milestone,
            tasks: milestone.tasks.map(task => {
              if (task.id === id) {
                return { ...task, status: newStatus };
              }

              // Check if target is in this task's subtasks
              const taskContainsTarget = task.subtasks.some(
                subtask => subtask.id === id
              );

              // If target is not in this task, return unchanged
              if (!taskContainsTarget) {
                return task;
              }

              // Target is in this task, update the subtask
              return {
                ...task,
                subtasks: task.subtasks.map(subtask =>
                  subtask.id === id
                    ? { ...subtask, status: newStatus }
                    : subtask
                ),
              };
            }),
          };
        }),
      };
    }),
  };

  // Roll the change up: completing the last subtask of a task should mark the
  // task Complete, completing the last task of a milestone marks the milestone
  // Complete, and so on up to the phase. Monotonic + idempotent.
  //
  // IMPORTANT: only roll up when the caller is moving a leaf toward 'Complete'.
  // Rolling up on a *downward* reset (e.g. task-patcher setting a 'modified'
  // Task/Milestone/Phase back to 'Planned' for re-implementation) would let
  // `promoteIfAllComplete` see that all the item's children are still
  // 'Complete' and silently promote it straight back to 'Complete', undoing
  // the explicit reset (PRD §4.3 "modified" branch, HIGH-2 bug). Leaves have
  // no children, so rollup is a no-op for them in any case.
  if (newStatus === 'Complete') {
    return rollupCompletion(updated);
  }
  return updated;
}

/**
 * Cascade `Complete` downward through an item's entire subtree (PRD §5.4).
 *
 * @remarks
 * Returns a **deep-cloned** item with `status: 'Complete'` set on the item AND
 * on every descendant, recursively. This is the **downward** half of the §5.4
 * rule "Setting a parent to Complete cascades Complete to every descendant"
 * (e.g. `hack update 1 done` marks the whole phase tree Complete). Works at any
 * level; a `Subtask` is a leaf and simply returns `{ ...subtask, status: 'Complete' }`.
 *
 * This is **distinct from the monotonic {@link rollupCompletion} /
 * {@link promoteIfAllComplete} helpers**: those only ever *promote* a parent
 * toward `Complete` when all its non-obsolete children are already `Complete`
 * (they never cascade downward, never downgrade, and short-circuit on a parent
 * already `Complete`/`Obsolete`). `cascadeCompleteDown` is the opposite
 * direction — it forcibly sets every node `Complete` regardless of prior state.
 * It is called explicitly (by the `hack update` handler, P1.M2.T4.S1) only when
 * the target status is `Complete`, immediately before `recomputeAncestorsUp`
 * recomputes ancestors. Do not use it as a replacement for the rollup.
 *
 * Pure: the input tree is never mutated (structural sharing — every visited node
 * becomes a new object because every status changes). Idempotent.
 *
 * @param item - The hierarchy item (any level) to cascade `Complete` down from.
 * @returns A new, deep-cloned item with `status: 'Complete'` at every level.
 *
 * @example
 * ```typescript
 * const phase = findItem(backlog, 'P1') as Phase;
 * const completed = cascadeCompleteDown(phase);
 * // completed.status === 'Complete'
 * // every milestone, task, and subtask under it is also 'Complete'
 * ```
 */
export function cascadeCompleteDown(item: HierarchyItem): HierarchyItem {
  if ('milestones' in item) {
    // Phase — each child is a Milestone; recurse + cast back to the narrowed
    // element type (cascadeCompleteDown returns the union, but the children of
    // a Phase are structurally always Milestones).
    return {
      ...item,
      status: 'Complete',
      milestones: item.milestones.map(m =>
        cascadeCompleteDown(m)
      ) as Milestone[],
    };
  }
  if ('tasks' in item) {
    // Milestone — each child is a Task (same invariant as above).
    return {
      ...item,
      status: 'Complete',
      tasks: item.tasks.map(t => cascadeCompleteDown(t)) as Task[],
    };
  }
  if ('subtasks' in item) {
    // Task — each child is a Subtask (same invariant as above).
    return {
      ...item,
      status: 'Complete',
      subtasks: item.subtasks.map(s => cascadeCompleteDown(s)) as Subtask[],
    };
  }
  // Subtask (leaf — no children)
  return { ...item, status: 'Complete' };
}

/**
 * Ordered progression of active statuses, least-progressed first (PRD §5.4).
 * `Retrying` is excluded from the literal list (it is a transitional
 * orchestrator status); it is mapped to the `Implementing` rank inside
 * {@link STATUS_RANK}.
 */
const PROGRESSION: readonly Status[] = [
  'Planned',
  'Researching',
  'Ready',
  'Implementing',
  'Complete',
];

/**
 * Numeric rank for the min-status computation (PRD §5.4). `Retrying` is an
 * internal transitional status (set by the retry manager, not manually
 * settable) and is treated as `Implementing`-equivalent (rank 3). `Failed` and
 * `Obsolete` are EXCLUDED by {@link recomputeParentStatus} before this map is
 * consulted, so their ranks are sentinels that are never read
 * (`Number.POSITIVE_INFINITY` = can never be the min — a defensive choice in
 * case the filtering ever changes).
 */
const STATUS_RANK: Record<Status, number> = {
  Planned: 0,
  Researching: 1,
  Ready: 2,
  Implementing: 3,
  Retrying: 3,
  Complete: 4,
  Failed: Number.POSITIVE_INFINITY,
  Obsolete: Number.POSITIVE_INFINITY,
};

/**
 * Where the changed item lives, plus the ancestor-path indices for the
 * bottom-up walk. Discriminated by `level`.
 */
type ChangeLocation =
  | { level: 'phase'; phaseIndex: number }
  | { level: 'milestone'; phaseIndex: number; milestoneIndex: number }
  | {
      level: 'task';
      phaseIndex: number;
      milestoneIndex: number;
      taskIndex: number;
    }
  | {
      level: 'subtask';
      phaseIndex: number;
      milestoneIndex: number;
      taskIndex: number;
    };

/**
 * Locate the changed item and its ancestor-path indices (mirrors
 * {@link findItem}'s nested-for-loop-with-early-return idiom).
 *
 * @param backlog - The backlog tree to search.
 * @param id - The canonical id to locate.
 * @returns The {@link ChangeLocation}, or `null` when the id is absent.
 */
function locateChange(backlog: Backlog, id: string): ChangeLocation | null {
  for (let pi = 0; pi < backlog.backlog.length; pi++) {
    const phase = backlog.backlog[pi];
    if (phase.id === id) return { level: 'phase', phaseIndex: pi };
    for (let mi = 0; mi < phase.milestones.length; mi++) {
      const milestone = phase.milestones[mi];
      if (milestone.id === id)
        return { level: 'milestone', phaseIndex: pi, milestoneIndex: mi };
      for (let ti = 0; ti < milestone.tasks.length; ti++) {
        const task = milestone.tasks[ti];
        if (task.id === id)
          return {
            level: 'task',
            phaseIndex: pi,
            milestoneIndex: mi,
            taskIndex: ti,
          };
        for (let si = 0; si < task.subtasks.length; si++) {
          if (task.subtasks[si].id === id)
            return {
              level: 'subtask',
              phaseIndex: pi,
              milestoneIndex: mi,
              taskIndex: ti,
            };
        }
      }
    }
  }
  return null;
}

/**
 * Recompute ONE parent's status as the minimum (least-progressed) of its
 * children (PRD §5.4).
 *
 * @remarks
 * - `Obsolete` children are terminal and EXCLUDED from the min; if ALL children
 *   are `Obsolete` the parent becomes `Complete` (Obsolete loses ties to
 *   Complete).
 * - `Failed` children are EXCLUDED unless ALL non-obsolete children are `Failed`,
 *   in which case the parent becomes `Failed`.
 * - Otherwise the parent is the min of the remaining (non-failed, non-obsolete)
 *   children. `Retrying` is treated as `Implementing`-equivalent (rank 3) and
 *   maps back to the canonical progression status via {@link PROGRESSION}.
 *
 * @param children - The parent's children (any shape with a `status` field).
 * @returns The recomputed parent status.
 */
function recomputeParentStatus(children: { status: Status }[]): Status {
  const nonObsolete = children.filter(c => c.status !== 'Obsolete');
  if (nonObsolete.length === 0) return 'Complete';
  if (nonObsolete.every(c => c.status === 'Failed')) return 'Failed';
  const candidates = nonObsolete.filter(c => c.status !== 'Failed');
  let minRank = STATUS_RANK[candidates[0].status];
  for (let i = 1; i < candidates.length; i++) {
    const r = STATUS_RANK[candidates[i].status];
    if (r < minRank) minRank = r;
  }
  // Map the min rank back to the canonical progression status
  // (Retrying → Implementing).
  return PROGRESSION[minRank];
}

/**
 * Recompute ancestor statuses bottom-up after a status change (PRD §5.4 "Ancestor recompute").
 *
 * @remarks
 * Walks UP from the changed item's position and recomputes each ancestor
 * (Task → Milestone → Phase) as the **minimum** (least-progressed) status among
 * its children. The changed item's own status is assumed already set (and, if it
 * was set to `Complete`, already cascaded down by {@link cascadeCompleteDown})
 * before this runs — this function only recomputes the ANCESTORS above it.
 *
 * Status ordering (least → most progressed): `Planned(0) < Researching(1) <
 * Ready(2) < Implementing(3) < Complete(4)`. Special handling per PRD §5.4:
 *  - `Obsolete` children are terminal and EXCLUDED from the min; if ALL children
 *    are `Obsolete` the parent becomes `Complete` (Obsolete loses ties to
 *    Complete).
 *  - `Failed` children are EXCLUDED unless ALL non-obsolete children are
 *    `Failed`, in which case the parent becomes `Failed`.
 *  - Otherwise the parent = the min of the remaining (non-failed, non-obsolete)
 *    children. `Retrying` is treated as `Implementing`-equivalent and maps back
 *    to `Implementing` (it is never propagated up an ancestor).
 *
 * This CAN DOWNGRADE ancestors: resetting a subtask back to `Planned` drops its
 * Task/Milestone/Phase to reflect the least-progressed child. This is what makes
 * it **strictly richer than** the monotonic {@link rollupCompletion} /
 * {@link promoteIfAllComplete} (which only ever promote a parent toward
 * `Complete` when all children are already `Complete`, never compute a true
 * minimum, and never downgrade). It is also distinct from
 * {@link cascadeCompleteDown} (the downward force-`Complete` half of the §5.4
 * cascade). Do not use this in place of the rollup for automatic status writes.
 *
 * Pure: the input backlog is never mutated; only nodes along the ancestor path
 * are copied (structural sharing — same deep-copy-on-path pattern as
 * {@link updateItemStatus} / {@link rollupCompletion}). A `changedId` that is
 * not found, or a Phase-level change (no ancestor), returns the SAME `backlog`
 * reference.
 *
 * @param backlog - The backlog tree containing the changed item.
 * @param changedId - The canonical id of the item whose status just changed
 *   (e.g. `'P1.M1.T1.S1'`). Its own status is not recomputed here.
 * @returns A new `Backlog` with recomputed ancestor statuses (or the same
 *   reference for the no-op cases).
 *
 * @example
 * ```typescript
 * // DOWNGRADE: a Complete task whose first subtask is reset to Planned drops
 * // the whole ancestor chain (Task → Milestone → Phase) back to Planned.
 * const task = createTestTask('P1.M1.T1', 't', 'Complete', [
 *   createTestSubtask('P1.M1.T1.S1', 'a', 'Planned'), // just reset
 *   createTestSubtask('P1.M1.T1.S2', 'b', 'Complete'),
 * ]);
 * const backlog = createTestBacklog([
 *   createTestPhase('P1', 'p', 'Complete', [
 *     createTestMilestone('P1.M1', 'm', 'Complete', [task]),
 *   ]),
 * ]);
 * const out = recomputeAncestorsUp(backlog, 'P1.M1.T1.S1');
 * // out: Task/Milestone/Phase are now 'Planned' (min of [Planned, Complete]).
 * ```
 */
export function recomputeAncestorsUp(
  backlog: Backlog,
  changedId: string
): Backlog {
  const loc = locateChange(backlog, changedId);
  if (!loc) return backlog; // not found → no-op (same reference)
  if (loc.level === 'phase') return backlog; // a Phase has no ancestor to recompute

  if (loc.level === 'milestone') {
    // recompute only the containing Phase from its milestones
    return {
      ...backlog,
      backlog: backlog.backlog.map((phase, pi) =>
        pi === loc.phaseIndex
          ? { ...phase, status: recomputeParentStatus(phase.milestones) }
          : phase
      ),
    };
  }

  if (loc.level === 'task') {
    // recompute the containing Milestone (from tasks) then the Phase (from milestones)
    return {
      ...backlog,
      backlog: backlog.backlog.map((phase, pi) => {
        if (pi !== loc.phaseIndex) return phase;
        const newMilestones = phase.milestones.map((milestone, mi) =>
          mi === loc.milestoneIndex
            ? { ...milestone, status: recomputeParentStatus(milestone.tasks) }
            : milestone
        );
        return {
          ...phase,
          milestones: newMilestones,
          status: recomputeParentStatus(newMilestones),
        };
      }),
    };
  }

  // loc.level === 'subtask': recompute Task (from subtasks) → Milestone (from
  // tasks) → Phase (from milestones), innermost-first so a recomputed lower
  // ancestor feeds its parent's recompute.
  return {
    ...backlog,
    backlog: backlog.backlog.map((phase, pi) => {
      if (pi !== loc.phaseIndex) return phase;
      const newMilestones = phase.milestones.map((milestone, mi) => {
        if (mi !== loc.milestoneIndex) return milestone;
        const newTasks = milestone.tasks.map((task, ti) =>
          ti === loc.taskIndex
            ? { ...task, status: recomputeParentStatus(task.subtasks) }
            : task
        );
        return {
          ...milestone,
          tasks: newTasks,
          status: recomputeParentStatus(newTasks),
        };
      });
      return {
        ...phase,
        milestones: newMilestones,
        status: recomputeParentStatus(newMilestones),
      };
    }),
  };
}

/**
 * The statuses that are manually settable via `hack update` (PRD §5.4).
 *
 * @remarks
 * This is the §5.3 lifecycle set PLUS `Ready`, MINUS `Retrying`. `Retrying` is
 * an internal transitional status set by the retry manager; allowing a user to
 * set it by hand would fight the orchestrator, so it is intentionally excluded
 * from loose matching. A stuck `Retrying` item is reset via `Planned` or `Ready`.
 */
const MATCHABLE_STATUSES: Status[] = [
  'Planned',
  'Researching',
  'Ready',
  'Implementing',
  'Complete',
  'Failed',
  'Obsolete',
];

/**
 * Synonyms / aliases for statuses that are not derivable from the canonical word
 * or would otherwise be ambiguous (PRD §5.4 step 1). Keys are matched EXACT,
 * case-insensitive (NOT as prefixes). `re`/`rdy` → Ready preempts the `r`-prefix
 * ambiguity with Researching; `done`/`fin`/… → Complete are common shorthands.
 */
const STATUS_SYNONYMS: Readonly<Record<string, Status>> = {
  d: 'Complete',
  done: 'Complete',
  fin: 'Complete',
  finished: 'Complete',
  completed: 'Complete',
  re: 'Ready',
  rdy: 'Ready',
};

/**
 * Fuzzy-match a loose status string to a canonical {@link Status} (PRD §5.4 "Loose status matching").
 *
 * @remarks
 * Matches over the 7 manually-settable statuses
 * ({@link MATCHABLE_STATUSES} — `Retrying` excluded; see its doc). Matching order,
 * first hit wins:
 *
 * 1. **Synonym table** (exact, case-insensitive) — see {@link STATUS_SYNONYMS}.
 *    `done`/`d`/`fin`/`finished`/`completed` → Complete; `re`/`rdy` → Ready.
 * 2. **Canonical exact** (case-insensitive) — `input.toLowerCase()` equals one of the 7.
 * 3. **Unique prefix** — `input.toLowerCase()` is a prefix of exactly one status.
 * 4. **Unique substring** — `input.toLowerCase()` is a substring of exactly one status.
 * 5. **Ambiguous** — 2+ matches at the prefix OR substring level → `{ error, candidates }`.
 * 6. **Unknown** — 0 matches → `{ error, candidates: [all 7] }`.
 *
 * Steps 3 and 4 are separate, each with its own count + ambiguity check. Step 3
 * (prefix) is tried first and returns on a unique hit before step 4 (substring)
 * ever runs; substring matching is reached only when the input is not a prefix
 * of any status. The synonym table (step 1) preempts ambiguity: `re` resolves to
 * Ready there, so it never reaches prefix matching where it would also match
 * Researching. A raw `r` is NOT a synonym → prefix-matches both Ready and
 * Researching → ambiguous.
 *
 * @returns A discriminated union: `{ status }` on success, or `{ error, candidates }`
 *          on ambiguity/unknown. Narrow with `'status' in result` / `'error' in result`.
 *
 * @param input - The raw status string from the CLI (e.g. `done`, `re`, `comp`, `r`, `bogus`).
 *
 * @example
 * matchStatus('done');  // { status: 'Complete' }          — synonym (step 1)
 * matchStatus('re');    // { status: 'Ready' }             — synonym preempts ambiguity
 * matchStatus('ready'); // { status: 'Ready' }             — canonical exact (step 2)
 * matchStatus('comp');  // { status: 'Complete' }          — unique prefix (step 3)
 * matchStatus('search');// { status: 'Researching' }       — unique substring (step 4)
 * matchStatus('r');     // { error: 'Ambiguous status "r": matches Researching, Ready',
 *                       //   candidates: ['Researching','Ready'] }  — ambiguous (step 5)
 * matchStatus('bogus'); // { error: 'Unknown status "bogus". Valid statuses: …',
 *                       //   candidates: [<all 7>] }        — unknown (step 6)
 */
export function matchStatus(
  input: string
): { status: Status } | { error: string; candidates: string[] } {
  const lower = input.toLowerCase();

  // 1. SYNONYM (exact, case-insensitive)
  if (lower in STATUS_SYNONYMS) return { status: STATUS_SYNONYMS[lower] };

  // 2. CANONICAL EXACT (case-insensitive)
  const exact = MATCHABLE_STATUSES.find(s => s.toLowerCase() === lower);
  if (exact) return { status: exact };

  // 3. UNIQUE PREFIX
  const prefixMatches = MATCHABLE_STATUSES.filter(s =>
    s.toLowerCase().startsWith(lower)
  );
  if (prefixMatches.length === 1) return { status: prefixMatches[0] };
  if (prefixMatches.length >= 2) {
    return {
      error: `Ambiguous status "${input}": matches ${prefixMatches.join(', ')}`,
      candidates: [...prefixMatches],
    };
  }

  // 4. UNIQUE SUBSTRING (prefix matched 0 → try the broader match)
  const substringMatches = MATCHABLE_STATUSES.filter(s =>
    s.toLowerCase().includes(lower)
  );
  if (substringMatches.length === 1) return { status: substringMatches[0] };
  if (substringMatches.length >= 2) {
    return {
      error: `Ambiguous status "${input}": matches ${substringMatches.join(', ')}`,
      candidates: [...substringMatches],
    };
  }

  // 6. UNKNOWN
  return {
    error: `Unknown status "${input}". Valid statuses: ${MATCHABLE_STATUSES.join(', ')}`,
    candidates: [...MATCHABLE_STATUSES],
  };
}

/**
 * Union of any hierarchy node (all have `id` + `status`).
 *
 * @remarks
 * Used by {@link setItemStatus} for the recursive tree walk. Kept here so the
 * canonical per-item status-setter lives alongside the other hierarchy
 * utilities (PRD §5.1, P3.M1.T2.S2 — single merge implementation shared by the
 * session-manager delta-merge mutator and the recovery path).
 */
export type AnyItem = Phase | Milestone | Task | Subtask;

/**
 * Recursively set the `status` of the item with `itemId`, mutating the backlog
 * IN PLACE via the established readonly-cast idiom.
 *
 * @remarks
 * This is the **canonical per-item last-writer-wins merge** for the `status`
 * field (the only field that changes at runtime — the tree structure is
 * immutable after breakdown). It is shared by:
 *  - `SessionManager.saveBacklog`'s delta-merge mutator (applies queued
 *    `{itemId, status}` deltas onto the fresh locked disk read), and
 *  - `recoverTasksJson`'s legitimate-delta re-apply (PATH A + PATH B).
 *
 * Mirrors `state-validator.ts`'s repair fns. Returns `true` if the item was
 * found (so callers can short-circuit / log). Idempotent: setting the existing
 * status is a no-op write.
 *
 * @param backlog - The backlog to mutate (in place).
 * @param itemId - The hierarchy id to locate (e.g. `P1.M1.T1.S1`).
 * @param status - The status to assign.
 * @returns `true` if an item with `itemId` was found and updated.
 *
 * @example
 * ```typescript
 * setItemStatus(backlog, 'P1.M1.T1.S1', 'Complete');
 * ```
 */
export function setItemStatus(
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
