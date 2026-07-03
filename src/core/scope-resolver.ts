/**
 * Scope parsing and resolution for hierarchical task selection
 *
 * @module core/scope-resolver
 *
 * @remarks
 * Provides utilities for parsing scope strings (like "P1", "P1.M1", "all")
 * and resolving them to lists of executable backlog items. Enables flexible
 * execution of tasks at any level of the hierarchy.
 *
 * @example
 * ```typescript
 * import { parseScope, resolveScope } from './core/scope-resolver.js';
 *
 * // Parse a scope string
 * const scope = parseScope('P1.M1');
 * // { type: 'milestone', id: 'P1.M1' }
 *
 * // Resolve against backlog
 * const items = resolveScope(backlog, scope);
 * // Returns milestone P1.M1 and all its descendants
 * ```
 */

import type { Backlog, Phase, Milestone, Task, Subtask } from './models.js';
import type { HierarchyItem } from '../utils/task-utils.js';
import { findItem } from '../utils/task-utils.js';

/**
 * Scope level types for hierarchical task selection
 *
 * @remarks
 * - 'all': Selects all leaf subtasks across the entire backlog
 * - 'phase': Selects a specific phase and all its descendants
 * - 'milestone': Selects a specific milestone and all its descendants
 * - 'task': Selects a specific task and all its subtasks
 * - 'subtask': Selects a single subtask
 *
 * String literal union is used instead of TypeScript enum for:
 * - Better Zod integration
 * - Serialization compatibility
 * - Type safety at both compile and runtime
 */
export type ScopeType = 'phase' | 'milestone' | 'task' | 'subtask' | 'all';

/** Valid scope types const array for type guard validation */
const VALID_SCOPE_TYPES: ScopeType[] = [
  'phase',
  'milestone',
  'task',
  'subtask',
  'all',
];

/**
 * Represents a parsed scope for task selection
 *
 * @remarks
 * - For 'all' type, id is undefined
 * - For all other types, id is required and must match the hierarchy format
 */
export interface Scope {
  readonly type: ScopeType;
  readonly id?: string;
}

/**
 * Error thrown when scope string parsing fails
 *
 * @remarks
 * Follows existing error pattern from EnvironmentValidationError in types.ts
 * Includes context properties for better error handling and messaging
 */
export class ScopeParseError extends Error {
  readonly invalidInput: string;
  readonly expectedFormat: string;

  constructor(input: string, expected: string) {
    super(`Failed to parse scope: "${input}". Expected: ${expected}`);
    this.name = 'ScopeParseError';
    this.invalidInput = input;
    this.expectedFormat = expected;
  }

  toString(): string {
    return `${this.name}: ${this.message}`;
  }
}

/**
 * Type guard for ScopeType validation
 *
 * @remarks
 * Follows type guard pattern from task-utils.ts (isSubtask, isTask)
 * Uses const array for validation (easier to maintain than inline array)
 */
export function isScopeType(value: unknown): value is ScopeType {
  return (
    typeof value === 'string' && VALID_SCOPE_TYPES.includes(value as ScopeType)
  );
}

/**
 * Type guard for Scope interface validation
 */
export function isScope(value: unknown): value is Scope {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const scope = value as Record<string, unknown>;
  return (
    isScopeType(scope.type) &&
    (scope.type === 'all' || typeof scope.id === 'string')
  );
}

/**
 * Parses a scope string into a Scope object
 *
 * @param scopeArg - Scope string to parse (e.g., "P1", "P1.M1", "all")
 * @returns Parsed Scope object
 * @throws {ScopeParseError} If the scope string is invalid or malformed
 *
 * @remarks
 * Scope format mapping:
 * - "all" → { type: 'all' }
 * - "P1" → { type: 'phase', id: 'P1' }
 * - "P1.M1" → { type: 'milestone', id: 'P1.M1' }
 * - "P1.M1.T1" → { type: 'task', id: 'P1.M1.T1' }
 * - "P1.M1.T1.S1" → { type: 'subtask', id: 'P1.M1.T1.S1' }
 *
 * Regex patterns from models.ts are used for validation:
 * - Phase: /^P\d+$/
 * - Milestone: /^P\d+\.M\d+$/
 * - Task: /^P\d+\.M\d+\.T\d+$/
 * - Subtask: /^P\d+\.M\d+\.T\d+\.S\d+$/
 */
export function parseScope(scopeArg: string): Scope {
  // Handle empty input
  if (!scopeArg || scopeArg.trim() === '') {
    throw new ScopeParseError(
      scopeArg,
      'non-empty scope string (e.g., "all", "P1", "P1.M1")'
    );
  }

  const trimmed = scopeArg.trim();

  // Handle "all" keyword
  if (trimmed === 'all') {
    return { type: 'all' };
  }

  // Parse by depth (number of dot-separated components)
  const parts = trimmed.split('.');
  const depth = parts.length;

  // Validate and map depth to scope type
  switch (depth) {
    case 1: {
      // Phase: P1, P2, etc.
      if (!/^P\d+$/.test(trimmed)) {
        throw new ScopeParseError(trimmed, 'phase format (e.g., "P1")');
      }
      return { type: 'phase', id: trimmed };
    }

    case 2: {
      // Milestone: P1.M1, P1.M2, etc.
      if (!/^P\d+\.M\d+$/.test(trimmed)) {
        throw new ScopeParseError(trimmed, 'milestone format (e.g., "P1.M1")');
      }
      return { type: 'milestone', id: trimmed };
    }

    case 3: {
      // Task: P1.M1.T1, P1.M1.T2, etc.
      if (!/^P\d+\.M\d+\.T\d+$/.test(trimmed)) {
        throw new ScopeParseError(trimmed, 'task format (e.g., "P1.M1.T1")');
      }
      return { type: 'task', id: trimmed };
    }

    case 4: {
      // Subtask: P1.M1.T1.S1, P1.M1.T1.S2, etc.
      if (!/^P\d+\.M\d+\.T\d+\.S\d+$/.test(trimmed)) {
        throw new ScopeParseError(
          trimmed,
          'subtask format (e.g., "P1.M1.T1.S1")'
        );
      }
      return { type: 'subtask', id: trimmed };
    }

    default: {
      throw new ScopeParseError(
        trimmed,
        'valid scope format (e.g., "P1", "P1.M1", "P1.M1.T1", "P1.M1.T1.S1", "all")'
      );
    }
  }
}

/**
 * Gets all descendants of a hierarchy item
 *
 * @param item - The item to get descendants for
 * @returns Array of all descendant items (not including the item itself)
 *
 * @remarks
 * Uses DFS pre-order traversal to match existing traversal patterns
 * Returns only direct children, not grandchildren (use recursive call for full tree)
 */
function getAllDescendants(item: Phase | Milestone | Task): HierarchyItem[] {
  const descendants: HierarchyItem[] = [];

  if ('milestones' in item) {
    // Phase: return all milestones
    descendants.push(...item.milestones);
    // Recursively get descendants of each milestone
    for (const milestone of item.milestones) {
      descendants.push(...getAllDescendants(milestone));
    }
  } else if ('tasks' in item) {
    // Milestone: return all tasks
    descendants.push(...item.tasks);
    // Recursively get descendants of each task
    for (const task of item.tasks) {
      descendants.push(...getAllDescendants(task));
    }
  } else if ('subtasks' in item) {
    // Task: return all subtasks (leaf nodes)
    descendants.push(...item.subtasks);
  }

  return descendants;
}

/**
 * Gets all leaf subtasks from a backlog
 *
 * @param backlog - The backlog to extract subtasks from
 * @returns Array of all subtasks (leaf nodes in the hierarchy)
 *
 * @remarks
 * Subtasks are the leaf nodes in our hierarchy
 * Uses DFS traversal for consistent ordering
 */
function getLeafSubtasks(backlog: Backlog): Subtask[] {
  const leaves: Subtask[] = [];

  for (const phase of backlog.backlog) {
    for (const milestone of phase.milestones) {
      for (const task of milestone.tasks) {
        leaves.push(...task.subtasks);
      }
    }
  }

  return leaves;
}

/**
 * Resolves a scope to a list of hierarchy items
 *
 * @param backlog - The backlog to search
 * @param scope - The parsed scope to resolve
 * @returns Array of items matching the scope
 *
 * @remarks
 * Resolution logic:
 * - 'all': Returns all leaf subtasks
 * - 'phase' with id: Returns that phase and all descendants
 * - 'milestone' with id: Returns that milestone and all descendants
 * - 'task' with id: Returns that task and all subtasks
 * - 'subtask' with id: Returns that single subtask
 * - Non-existent id: Returns empty array (no error)
 *
 * Uses findItem() from task-utils.ts for ID lookups
 * Preserves DFS pre-order traversal (parent before children)
 */
/**
 * Topologically sorts subtasks so dependencies precede dependents.
 *
 * @remarks
 * The execution loop processes the queue in a single FIFO pass and SKIPS any
 * subtask whose dependencies aren't yet Complete — without re-enqueueing it.
 * If a dependent appears before its dependencies in the queue, it is skipped
 * and never revisited, leaving it dangling mid-flight (observed: 11 subtasks
 * stuck in 'Researching' while the pipeline reported success). Sorting the
 * queue topologically guarantees every subtask's dependencies are already
 * Complete by the time it is reached, so the skip only fires for items blocked
 * by a dependency that genuinely failed.
 *
 * Stable (independent items keep their backlog order) and cycle-safe (a cycle,
 * which the dependency validator rejects anyway, is broken rather than looping).
 */
function topoSortByDependencies(items: Subtask[]): Subtask[] {
  const ids = new Set(items.map(i => i.id));
  const byId = new Map(items.map(i => [i.id, i] as const));
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const ordered: Subtask[] = [];

  const visit = (id: string): void => {
    if (visited.has(id) || visiting.has(id)) return;
    visiting.add(id);
    const item = byId.get(id);
    if (item) {
      for (const dep of item.dependencies) {
        // Only dependencies that are themselves in this queue constrain
        // ordering; deps already Complete (or out of scope) don't.
        if (ids.has(dep)) visit(dep);
      }
    }
    visited.add(id);
    if (item) ordered.push(item);
  };

  // Iterate in original (backlog) order so independent items stay in place.
  for (const item of items) visit(item.id);
  return ordered;
}

export function resolveScope(backlog: Backlog, scope: Scope): HierarchyItem[] {
  // Handle 'all' scope - return all leaf subtasks
  if (scope.type === 'all') {
    // Topologically sort (deps before dependents) so the single-pass execution
    // loop never skips a runnable subtask whose deps complete later in the pass.
    return topoSortByDependencies(getLeafSubtasks(backlog));
  }

  // For all other scope types, id is required
  if (!scope.id) {
    // This should never happen with proper Scope objects
    return [];
  }

  // Find the item by ID
  const item = findItem(backlog, scope.id);

  // If not found, return empty array
  if (!item) {
    return [];
  }

  // For subtask, return just the subtask
  if (item.type === 'Subtask') {
    return [item];
  }

  // For phase, milestone, or task, return item and all descendants
  return [item, ...getAllDescendants(item)];
}
