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
  return rollupCompletion(updated);
}
