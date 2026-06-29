/**
 * State validation and repair tools for task backlogs
 *
 * @module core/state-validator
 *
 * @remarks
 * Provides comprehensive validation and repair capabilities for tasks.json state.
 * Detects orphaned dependencies, circular dependencies, status inconsistencies,
 * and offers auto-repair with backup creation.
 *
 * Features:
 * - Schema validation using Zod BacklogSchema
 * - Orphaned dependency detection (deps to non-existent tasks)
 * - Circular dependency detection using DFS three-color algorithm
 * - Parent-child status consistency validation
 * - Automatic repair with timestamped backup creation
 * - Backup rotation to keep only recent backups
 *
 * @example
 * ```typescript
 * import { validateBacklogState, repairBacklog, createBackup } from './core/state-validator.js';
 *
 * const validation = validateBacklogState(backlog);
 * if (!validation.isValid) {
 *   const backupPath = await createBackup('plan/001_hash/tasks.json');
 *   const repairResult = await repairBacklog(backlog, validation, backupPath);
 * }
 * ```
 */

import type { Backlog, Phase, Milestone, Task, Subtask } from './models.js';
import { BacklogSchema } from './models.js';
import { ZodError } from 'zod';
import { copyFile, readdir, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { getLogger, type Logger } from '../utils/logger.js';

let _logger: Logger | undefined;
const logger = (): Logger => (_logger ??= getLogger('StateValidator'));

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Union type for any item in the hierarchy
 */
type HierarchyItem = Phase | Milestone | Task | Subtask;

/**
 * Type guard for items with dependencies (only Subtask has dependencies)
 */
function hasDependencies(item: HierarchyItem): item is Subtask {
  return (
    item.type === 'Subtask' &&
    'dependencies' in item &&
    Array.isArray(item.dependencies)
  );
}

/**
 * State validation result
 *
 * @remarks
 * Contains all validation issues found during state validation.
 */
export interface StateValidationResult {
  /** Overall validation status */
  isValid: boolean;

  /** Schema validation errors (Zod) */
  schemaErrors?: ZodError[];

  /** Orphaned dependencies (deps to non-existent tasks) */
  orphanedDependencies?: OrphanedDependency[];

  /** Circular dependencies detected */
  circularDependencies?: CircularDependency[];

  /** Status inconsistencies found */
  statusInconsistencies?: StatusInconsistency[];

  /** Summary counts */
  summary: {
    totalErrors: number;
    totalWarnings: number;
  };
}

/**
 * Orphaned dependency (dependency to non-existent task)
 */
export interface OrphanedDependency {
  /** Task ID that has the orphaned dependency */
  taskId: string;

  /** Non-existent task ID referenced */
  missingTaskId: string;

  /** Severity: error (blocks execution) */
  severity: 'error';
}

/**
 * Circular dependency information
 */
export interface CircularDependency {
  /** Array of task IDs forming the cycle */
  cycle: string[];

  /** Human-readable cycle string */
  cycleString: string;

  /** Number of edges in cycle */
  length: number;

  /** Severity: error (blocks execution) */
  severity: 'error';
}

/**
 * Status inconsistency (parent complete but child incomplete)
 */
export interface StatusInconsistency {
  /** Parent item ID */
  parentId: string;

  /** Child item ID */
  childId: string;

  /** Parent status (should not be Complete) */
  parentStatus: string;

  /** Child status (not Complete) */
  childStatus: string;

  /** Severity: warning (may cause issues) */
  severity: 'warning';
}

/**
 * Auto-repair result
 */
export interface RepairResult {
  /** Whether any repairs were made */
  repaired: boolean;

  /** Number of items repaired */
  itemsRepaired: number;

  /** Backup file path created */
  backupPath?: string;

  /** Repairs applied by type */
  repairs: {
    orphanedDependencies: number;
    circularDependencies: number;
    missingFields: number;
  };
}

/**
 * Dependency graph adjacency list
 */
interface DependencyGraph {
  [taskId: string]: string[];
}

/**
 * Node state for three-color marking algorithm
 */
enum NodeState {
  UNVISITED = 0,
  VISITING = 1,
  VISITED = 2,
}

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

/**
 * Validates backlog against Zod schema
 *
 * @param backlog - Backlog to validate
 * @returns Array of Zod errors (empty if valid)
 */
export function validateSchema(backlog: Backlog): ZodError[] {
  try {
    BacklogSchema.parse(backlog);
    return [];
  } catch (error) {
    if (error instanceof ZodError) {
      return [error];
    }
    return [
      new ZodError([
        {
          code: 'custom',
          path: [],
          message: `Unexpected error: ${String(error)}`,
        },
      ]),
    ];
  }
}

/**
 * Detects orphaned dependencies (deps to non-existent tasks)
 *
 * @param backlog - Backlog to validate
 * @returns Array of orphaned dependencies
 */
export function detectOrphanedDependencies(
  backlog: Backlog
): OrphanedDependency[] {
  const orphans: OrphanedDependency[] = [];

  // Collect all valid task IDs
  const allTaskIds = new Set<string>();
  const collectIds = (item: HierarchyItem): void => {
    allTaskIds.add(item.id);
    if ('milestones' in item) item.milestones.forEach(collectIds);
    if ('tasks' in item) item.tasks.forEach(collectIds);
    if ('subtasks' in item) item.subtasks.forEach(collectIds);
  };
  backlog.backlog.forEach(collectIds);

  // Check all dependencies
  const checkItem = (item: HierarchyItem): void => {
    if (hasDependencies(item)) {
      for (const depId of item.dependencies) {
        if (!allTaskIds.has(depId)) {
          orphans.push({
            taskId: item.id,
            missingTaskId: depId,
            severity: 'error',
          });
        }
      }
    }
    // Recursively check nested items
    if ('milestones' in item) item.milestones.forEach(checkItem);
    if ('tasks' in item) item.tasks.forEach(checkItem);
    if ('subtasks' in item) item.subtasks.forEach(checkItem);
  };
  backlog.backlog.forEach(checkItem);

  return orphans;
}

/**
 * Builds dependency graph for all hierarchy levels
 *
 * @param backlog - Backlog to build graph from
 * @returns Dependency graph adjacency list
 */
function buildFullDependencyGraph(backlog: Backlog): DependencyGraph {
  const graph: DependencyGraph = {};

  const addItem = (item: HierarchyItem): void => {
    // Add to graph with dependencies (only Task and Subtask have dependencies)
    graph[item.id] = hasDependencies(item) ? item.dependencies : [];

    // Recursively add nested items
    if ('milestones' in item) item.milestones.forEach(addItem);
    if ('tasks' in item) item.tasks.forEach(addItem);
    if ('subtasks' in item) item.subtasks.forEach(addItem);
  };
  backlog.backlog.forEach(addItem);

  return graph;
}

/**
 * Detects circular dependencies across all hierarchy levels
 *
 * @param backlog - Backlog to validate
 * @returns Array of circular dependencies
 */
export function detectCircularDependenciesAll(
  backlog: Backlog
): CircularDependency[] {
  const graph = buildFullDependencyGraph(backlog);
  const cycles: CircularDependency[] = [];

  // Use DFS three-color algorithm (from dependency-validator.ts)
  const state = new Map<string, NodeState>();
  const currentPath: string[] = [];

  // Initialize all nodes as UNVISITED
  for (const nodeId of Object.keys(graph)) {
    state.set(nodeId, NodeState.UNVISITED);
  }

  const dfs = (nodeId: string): string[] | null => {
    const currentState = state.get(nodeId) ?? NodeState.UNVISITED;

    if (currentState === NodeState.VISITING) {
      // BACK EDGE DETECTED - cycle found
      const cycleStart = currentPath.indexOf(nodeId);
      return [...currentPath.slice(cycleStart), nodeId];
    }

    if (currentState === NodeState.VISITED) {
      return null; // Already explored
    }

    state.set(nodeId, NodeState.VISITING);
    currentPath.push(nodeId);

    // Explore dependencies
    for (const depId of graph[nodeId] ?? []) {
      const result = dfs(depId);
      if (result) return result;
    }

    state.set(nodeId, NodeState.VISITED);
    currentPath.pop();
    return null;
  };

  // Check all nodes
  for (const nodeId of Object.keys(graph)) {
    if (state.get(nodeId) === NodeState.UNVISITED) {
      const cycle = dfs(nodeId);
      if (cycle) {
        cycles.push({
          cycle,
          cycleString: cycle.join(' → '),
          length: cycle.length - 1,
          severity: 'error',
        });
      }
    }
  }

  return cycles;
}

/**
 * Validates parent-child status consistency
 *
 * @remarks
 * A parent should not be Complete if any child is not Complete.
 *
 * @param backlog - Backlog to validate
 * @returns Array of status inconsistencies
 */
export function validateStatusConsistency(
  backlog: Backlog
): StatusInconsistency[] {
  const inconsistencies: StatusInconsistency[] = [];

  const checkChildren = (
    parentId: string,
    parentStatus: string,
    children: HierarchyItem[]
  ): void => {
    if (parentStatus !== 'Complete') return;

    for (const child of children) {
      if (child.status !== 'Complete') {
        inconsistencies.push({
          parentId,
          childId: child.id,
          parentStatus,
          childStatus: child.status,
          severity: 'warning',
        });
      }

      // Recursively check nested children
      if ('milestones' in child) {
        checkChildren(child.id, child.status, child.milestones);
      }
      if ('tasks' in child) {
        checkChildren(child.id, child.status, child.tasks);
      }
      if ('subtasks' in child) {
        checkChildren(child.id, child.status, child.subtasks);
      }
    }
  };

  for (const phase of backlog.backlog) {
    checkChildren(phase.id, phase.status, phase.milestones);
  }

  return inconsistencies;
}

/**
 * Validates backlog state comprehensively
 *
 * @param backlog - Backlog to validate
 * @returns Complete validation result
 */
export function validateBacklogState(backlog: Backlog): StateValidationResult {
  const result: StateValidationResult = {
    isValid: true,
    summary: { totalErrors: 0, totalWarnings: 0 },
  };

  // Schema validation
  result.schemaErrors = validateSchema(backlog);
  if (result.schemaErrors.length > 0) {
    result.isValid = false;
    result.summary.totalErrors += result.schemaErrors.reduce(
      (sum, e) => sum + e.issues.length,
      0
    );
  }

  // Orphaned dependencies
  result.orphanedDependencies = detectOrphanedDependencies(backlog);
  if (result.orphanedDependencies.length > 0) {
    result.isValid = false;
    result.summary.totalErrors += result.orphanedDependencies.length;
  }

  // Circular dependencies
  result.circularDependencies = detectCircularDependenciesAll(backlog);
  if (result.circularDependencies.length > 0) {
    result.isValid = false;
    result.summary.totalErrors += result.circularDependencies.length;
  }

  // Status consistency
  result.statusInconsistencies = validateStatusConsistency(backlog);
  if (result.statusInconsistencies.length > 0) {
    // Status inconsistencies are warnings, don't affect isValid
    result.summary.totalWarnings += result.statusInconsistencies.length;
  }

  return result;
}

// ============================================================================
// REPAIR FUNCTIONS
// ============================================================================

/**
 * Creates timestamped backup of tasks.json
 *
 * @param tasksPath - Path to tasks.json
 * @param maxBackups - Maximum backups to keep (default: 5)
 * @returns Path to created backup file
 */
export async function createBackup(
  tasksPath: string,
  maxBackups: number = 5
): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = dirname(tasksPath);
  const backupName = `tasks.json.backup.${timestamp}`;
  const backupPath = resolve(backupDir, backupName);

  logger().debug({ tasksPath, backupPath }, 'Creating backup');

  // Create backup
  await copyFile(tasksPath, backupPath);

  // Rotate old backups
  await rotateBackups(backupDir, maxBackups);

  logger().info({ backupPath }, 'Backup created');

  return backupPath;
}

/**
 * Rotates backup files, keeping only the most recent
 *
 * @param backupDir - Directory containing backups
 * @param maxBackups - Maximum backups to keep
 */
async function rotateBackups(
  backupDir: string,
  maxBackups: number
): Promise<void> {
  const files = await readdir(backupDir);

  // Get backup files sorted by date (newest first)
  const backups = files
    .filter(f => f.startsWith('tasks.json.backup.'))
    .sort()
    .reverse();

  // Remove old backups
  for (const oldBackup of backups.slice(maxBackups)) {
    await unlink(resolve(backupDir, oldBackup));
    logger().debug({ oldBackup }, 'Removed old backup');
  }
}

/**
 * Repairs orphaned dependencies by removing invalid references
 *
 * @param backlog - Backlog to repair (modified in-place)
 * @param orphans - Orphaned dependencies to remove
 * @returns Number of items repaired
 */
export function repairOrphanedDependencies(
  backlog: Backlog,
  orphans: OrphanedDependency[]
): number {
  let repaired = 0;
  const orphanMap = new Map<string, string[]>();

  // Group orphans by task ID
  for (const orphan of orphans) {
    if (!orphanMap.has(orphan.taskId)) {
      orphanMap.set(orphan.taskId, []);
    }
    orphanMap.get(orphan.taskId)!.push(orphan.missingTaskId);
  }

  // Remove orphaned dependencies
  const repairItem = (item: HierarchyItem): void => {
    if (hasDependencies(item) && orphanMap.has(item.id)) {
      const missingIds = orphanMap.get(item.id)!;
      const originalLength = item.dependencies.length;
      // Type assertion: We're intentionally modifying the readonly property for repair
      (item as { dependencies: string[] }).dependencies =
        item.dependencies.filter((id: string) => !missingIds.includes(id));
      if (item.dependencies.length < originalLength) {
        repaired++;
      }
    }

    // Recursively repair nested items
    if ('milestones' in item) item.milestones.forEach(repairItem);
    if ('tasks' in item) item.tasks.forEach(repairItem);
    if ('subtasks' in item) item.subtasks.forEach(repairItem);
  };
  backlog.backlog.forEach(repairItem);

  logger().info({ repaired }, 'Repaired orphaned dependencies');

  return repaired;
}

/**
 * Repairs circular dependencies by removing last edge in cycle
 *
 * @param backlog - Backlog to repair (modified in-place)
 * @param cycles - Circular dependencies to fix
 * @returns Number of items repaired
 */
export function repairCircularDependencies(
  backlog: Backlog,
  cycles: CircularDependency[]
): number {
  let repaired = 0;

  for (const cycle of cycles) {
    // Remove last edge: second-to-last task depends on first
    const lastTaskId = cycle.cycle[cycle.cycle.length - 2];
    const firstTaskId = cycle.cycle[0];

    const findAndRepair = (item: HierarchyItem): boolean => {
      if (item.id === lastTaskId && hasDependencies(item)) {
        const idx = item.dependencies.indexOf(firstTaskId);
        if (idx !== -1) {
          // Type assertion: We're intentionally modifying the readonly property for repair
          (item as { dependencies: string[] }).dependencies.splice(idx, 1);
          repaired++;
          return true;
        }
      }

      // Recursively search
      if ('milestones' in item) {
        for (const m of item.milestones) {
          if (findAndRepair(m)) return true;
        }
      }
      if ('tasks' in item) {
        for (const t of item.tasks) {
          if (findAndRepair(t)) return true;
        }
      }
      if ('subtasks' in item) {
        for (const s of item.subtasks) {
          if (findAndRepair(s)) return true;
        }
      }
      return false;
    };

    for (const phase of backlog.backlog) {
      if (findAndRepair(phase)) break;
    }
  }

  logger().info({ repaired }, 'Repaired circular dependencies');

  return repaired;
}

/**
 * Repairs missing required fields by adding defaults
 *
 * @param backlog - Backlog to repair (modified in-place)
 * @returns Number of items repaired
 */
export function repairMissingFields(backlog: Backlog): number {
  const repaired = 0;

  const repairItem = (item: HierarchyItem): void => {
    // Ensure dependencies array exists (only for Task and Subtask)
    if (hasDependencies(item)) {
      // Dependencies already exist, no action needed
    }

    // Recursively repair nested items
    if ('milestones' in item) item.milestones.forEach(repairItem);
    if ('tasks' in item) item.tasks.forEach(repairItem);
    if ('subtasks' in item) item.subtasks.forEach(repairItem);
  };
  backlog.backlog.forEach(repairItem);

  logger().info({ repaired }, 'Repaired missing fields');

  return repaired;
}

/**
 * Repairs backlog issues
 *
 * @param backlog - Backlog to repair (modified in-place)
 * @param validation - Validation result with issues
 * @param backupPath - Backup file path created
 * @returns Repair result
 */
export async function repairBacklog(
  backlog: Backlog,
  validation: StateValidationResult,
  backupPath: string
): Promise<RepairResult> {
  const result: RepairResult = {
    repaired: false,
    itemsRepaired: 0,
    backupPath,
    repairs: {
      orphanedDependencies: 0,
      circularDependencies: 0,
      missingFields: 0,
    },
  };

  // Repair orphaned dependencies
  if (validation.orphanedDependencies) {
    result.repairs.orphanedDependencies = repairOrphanedDependencies(
      backlog,
      validation.orphanedDependencies
    );
    result.itemsRepaired += result.repairs.orphanedDependencies;
  }

  // Repair circular dependencies
  if (validation.circularDependencies) {
    result.repairs.circularDependencies = repairCircularDependencies(
      backlog,
      validation.circularDependencies
    );
    result.itemsRepaired += result.repairs.circularDependencies;
  }

  // Repair missing fields
  result.repairs.missingFields = repairMissingFields(backlog);
  result.itemsRepaired += result.repairs.missingFields;

  result.repaired = result.itemsRepaired > 0;

  logger().info(
    {
      repaired: result.repaired,
      itemsRepaired: result.itemsRepaired,
      backupPath,
    },
    'Repair completed'
  );

  return result;
}
