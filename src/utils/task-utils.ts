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
