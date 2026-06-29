/**
 * Circular dependency detection for task backlogs
 *
 * @module core/dependency-validator
 *
 * @remarks
 * Provides cycle detection in task dependency graphs using Depth-First Search (DFS)
 * with three-color marking for accurate cycle path reconstruction.
 *
 * Features:
 * - DFS-based cycle detection with three-color marking (UNVISITED/VISITING/VISITED)
 * - Cycle path reconstruction for helpful error messages
 * - Self-dependency detection (A → A)
 * - Long chain warnings (>5 levels)
 * - Multiple disconnected components support
 *
 * @example
 * ```typescript
 * import { detectCircularDeps } from './core/dependency-validator.js';
 *
 * try {
 *   detectCircularDeps(backlog);
 *   console.log('No circular dependencies found');
 * } catch (error) {
 *   if (error instanceof ValidationError) {
 *     console.error('Cycle detected:', error.context?.cyclePath);
 *   }
 * }
 * ```
 */

import type { Backlog, Subtask } from './models.js';
import { getAllSubtasks } from '../utils/task-utils.js';
import { ValidationError, ErrorCodes } from '../utils/errors.js';
import { getLogger, type Logger } from '../utils/logger.js';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Logger instance for dependency validation
 */
let _logger: Logger | undefined;
const logger = (): Logger => (_logger ??= getLogger('DependencyValidator'));

/**
 * Dependency graph adjacency list
 *
 * @remarks
 * Maps task ID to array of dependency IDs. Each entry represents
 * the outgoing edges from a node in the dependency graph.
 *
 * @example
 * ```typescript
 * const graph: DependencyGraph = {
 *   'P1.M1.T1.S1': ['P1.M1.T1.S2'], // S1 depends on S2
 *   'P1.M1.T1.S2': []                // S2 has no dependencies
 * };
 * ```
 */
export interface DependencyGraph {
  [taskId: string]: string[];
}

/**
 * Node state for three-color marking algorithm
 *
 * @remarks
 * Uses three states to track DFS traversal progress:
 * - UNVISITED (0): Node has not been processed yet (white)
 * - VISITING (1): Node is currently in recursion stack (gray)
 * - VISITED (2): Node has been fully explored (black)
 *
 * A back edge (cycle) is detected when we encounter a VISITING node.
 */
export enum NodeState {
  UNVISITED = 0,
  VISITING = 1,
  VISITED = 2,
}

/**
 * Cycle detection result
 *
 * @remarks
 * Returns detailed information about a detected cycle, including
 * the exact path forming the cycle and the number of edges.
 */
export interface CycleDetectionResult {
  /** Whether a cycle was detected */
  hasCycle: boolean;
  /** Array of task IDs forming the cycle (e.g., ['A', 'B', 'A']) */
  cyclePath?: string[];
  /** Number of edges in the cycle */
  cycleLength?: number;
}

/**
 * Long chain information for warnings
 *
 * @remarks
 * Information about dependency chains that exceed the threshold depth.
 * These are valid but may indicate design issues.
 */
export interface LongChainInfo {
  /** Root task ID of the chain */
  taskId: string;
  /** Depth of the chain */
  depth: number;
  /** Array of task IDs in the chain */
  chain: string[];
}

// ============================================================================
// DEPENDENCY GRAPH BUILDING
// ============================================================================

/**
 * Builds a dependency graph adjacency list from subtasks
 *
 * @param subtasks - Array of all subtasks in the backlog
 * @returns Dependency graph mapping task ID to dependencies array
 *
 * @remarks
 * Creates an adjacency list representation of the dependency graph.
 * Each subtask maps to its array of dependency IDs. Empty dependencies
 * array is valid (leaf task with no dependencies).
 *
 * @example
 * ```typescript
 * const subtasks = [
 *   { id: 'S1', dependencies: ['S2'] },
 *   { id: 'S2', dependencies: [] }
 * ];
 * const graph = buildDependencyGraph(subtasks);
 * // graph = { 'S1': ['S2'], 'S2': [] }
 * ```
 */
export function buildDependencyGraph(subtasks: Subtask[]): DependencyGraph {
  const graph: DependencyGraph = {};

  for (const subtask of subtasks) {
    // Build adjacency list: taskId -> array of dependency IDs
    graph[subtask.id] = subtask.dependencies;
  }

  return graph;
}

// ============================================================================
// SELF-DEPENDENCY DETECTION
// ============================================================================

/**
 * Detects tasks that depend on themselves
 *
 * @param graph - Dependency graph to check
 * @returns Array of task IDs with self-dependencies
 *
 * @remarks
 * Checks for the simplest form of circular dependency: A → A.
 * This is checked first before running full DFS cycle detection.
 *
 * @example
 * ```typescript
 * const graph = { 'A': ['A'], 'B': [] };
 * const selfDeps = detectSelfDependencies(graph);
 * // selfDeps = ['A']
 * ```
 */
export function detectSelfDependencies(graph: DependencyGraph): string[] {
  const selfDependencies: string[] = [];

  for (const [taskId, deps] of Object.entries(graph)) {
    // Check if task depends on itself (A → A)
    if (deps.includes(taskId)) {
      selfDependencies.push(taskId);
    }
  }

  return selfDependencies;
}

// ============================================================================
// DFS CYCLE DETECTION WITH THREE-COLOR MARKING
// ============================================================================

/**
 * Detects cycles in a dependency graph using DFS with three-color marking
 *
 * @param graph - Dependency graph to analyze
 * @returns Cycle detection result with path information if cycle found
 *
 * @remarks
 * Uses the standard DFS cycle detection algorithm with three-color marking:
 * - Mark node as VISITING when entering recursion
 * - Mark node as VISITED when fully explored
 * - Detect back edge when encountering a VISITING node
 * - Reconstruct cycle path using currentPath tracking
 *
 * Handles disconnected components by iterating through all nodes.
 *
 * @example
 * ```typescript
 * const graph = { 'A': ['B'], 'B': ['A'] };
 * const result = detectCycleDFS(graph);
 * // result = { hasCycle: true, cyclePath: ['A', 'B', 'A'], cycleLength: 2 }
 * ```
 */
export function detectCycleDFS(graph: DependencyGraph): CycleDetectionResult {
  const state = new Map<string, NodeState>();
  const currentPath: string[] = [];

  // Initialize all nodes as UNVISITED
  for (const nodeId of Object.keys(graph)) {
    state.set(nodeId, NodeState.UNVISITED);
  }

  /**
   * Recursive DFS function for cycle detection
   *
   * @param nodeId - Current node being visited
   * @returns Cycle detection result if cycle found, null otherwise
   */
  function dfs(nodeId: string): CycleDetectionResult | null {
    const currentState = state.get(nodeId) ?? NodeState.UNVISITED;

    if (currentState === NodeState.VISITING) {
      // BACK EDGE DETECTED! Node is currently being visited
      const cycleStart = currentPath.indexOf(nodeId);
      const cyclePath = [...currentPath.slice(cycleStart), nodeId];

      return {
        hasCycle: true,
        cyclePath,
        cycleLength: cyclePath.length - 1, // Number of edges
      };
    }

    if (currentState === NodeState.VISITED) {
      // Already fully explored - skip
      return null;
    }

    // Mark as currently visiting (GRAY)
    state.set(nodeId, NodeState.VISITING);
    currentPath.push(nodeId);

    // Explore all dependencies
    const dependencies = graph[nodeId] ?? [];
    for (const depId of dependencies) {
      const result = dfs(depId);
      if (result) return result;
    }

    // Mark as fully visited (BLACK)
    state.set(nodeId, NodeState.VISITED);
    currentPath.pop();

    return null;
  }

  // Check all nodes (handles disconnected components)
  for (const nodeId of Object.keys(graph)) {
    if (state.get(nodeId) === NodeState.UNVISITED) {
      const result = dfs(nodeId);
      if (result) return result;
    }
  }

  return { hasCycle: false };
}

// ============================================================================
// LONG CHAIN DETECTION (NON-BLOCKING WARNINGS)
// ============================================================================

/**
 * Detects dependency chains exceeding a depth threshold
 *
 * @param graph - Dependency graph to analyze
 * @param threshold - Depth threshold for warnings (default: 5)
 * @returns Array of long chain information
 *
 * @remarks
 * Finds all dependency paths that exceed the threshold depth.
 * These are valid (non-circular) but may indicate design issues.
 * Logged as warnings, not errors.
 *
 * @example
 * ```typescript
 * const graph = {
 *   'A': ['B'],
 *   'B': ['C'],
 *   'C': ['D'],
 *   'D': ['E'],
 *   'E': ['F'],
 *   'F': []
 * };
 * const longChains = detectLongChains(graph, 5);
 * // Returns chain with depth 6 (A→B→C→D→E→F)
 * ```
 */
export function detectLongChains(
  graph: DependencyGraph,
  threshold: number = 5
): LongChainInfo[] {
  const longChains: LongChainInfo[] = [];
  const visited = new Set<string>();

  /**
   * Finds longest path from a node
   *
   * @param nodeId - Current node
   * @param currentDepth - Current depth in traversal
   * @param path - Current path of task IDs
   */
  function findLongestPath(
    nodeId: string,
    currentDepth: number,
    path: string[]
  ): void {
    // Skip if already visited
    if (visited.has(nodeId)) return;

    visited.add(nodeId);
    path.push(nodeId);

    // Check if depth exceeds threshold
    if (currentDepth > threshold) {
      longChains.push({
        taskId: path[0],
        depth: currentDepth,
        chain: [...path],
      });
    }

    // Recurse through dependencies
    const dependencies = graph[nodeId] ?? [];
    for (const depId of dependencies) {
      findLongestPath(depId, currentDepth + 1, path);
    }

    path.pop();
  }

  // Check all nodes for long chains
  for (const nodeId of Object.keys(graph)) {
    if (!visited.has(nodeId)) {
      findLongestPath(nodeId, 1, []);
    }
  }

  return longChains;
}

// ============================================================================
// MAIN CIRCULAR DEPENDENCY DETECTION FUNCTION
// ============================================================================

/**
 * Validates a backlog for circular dependencies
 *
 * @param backlog - Task backlog to validate
 * @throws {ValidationError} If circular dependencies or self-dependencies are found
 *
 * @remarks
 * Performs comprehensive dependency validation:
 * 1. Builds dependency graph from all subtasks
 * 2. Checks for self-dependencies (A → A) - throws immediately
 * 3. Detects cycles using DFS with three-color marking - throws immediately
 * 4. Logs warnings for long dependency chains (>5 levels) - non-blocking
 *
 * This function is called by SessionManager.initialize() during session setup.
 *
 * @example
 * ```typescript
 * import { detectCircularDeps } from './core/dependency-validator.js';
 *
 * try {
 *   detectCircularDeps(backlog);
 *   logger.info('Dependency validation passed');
 * } catch (error) {
 *   if (error instanceof ValidationError) {
 *     const path = error.context?.cyclePath?.join(' → ');
 *     logger.error(`Circular dependency: ${path}`);
 *   }
 *   throw error;
 * }
 * ```
 */
export function detectCircularDeps(backlog: Backlog): void {
  // Step 1: Build dependency graph
  const allSubtasks = getAllSubtasks(backlog);
  const graph = buildDependencyGraph(allSubtasks);

  // Step 2: Check for self-dependencies (fail fast)
  const selfDeps = detectSelfDependencies(graph);
  if (selfDeps.length > 0) {
    const cyclePath = [selfDeps[0], selfDeps[0]]; // A → A
    throw new ValidationError(
      `Task ${selfDeps[0]} depends on itself`,
      {
        taskId: selfDeps[0],
        cyclePath,
        suggestion: `Remove ${selfDeps[0]} from its own dependencies array`,
      },
      ErrorCodes.PIPELINE_VALIDATION_CIRCULAR_DEPENDENCY
    );
  }

  // Step 3: Detect cycles using DFS
  const cycleResult = detectCycleDFS(graph);
  if (cycleResult.hasCycle && cycleResult.cyclePath) {
    const pathStr = cycleResult.cyclePath.join(' → ');
    throw new ValidationError(
      `Circular dependency detected: ${pathStr}`,
      {
        cyclePath: cycleResult.cyclePath,
        cycleLength: cycleResult.cycleLength,
        suggestion:
          'Remove one of the dependencies in the cycle to break the circular reference',
      },
      ErrorCodes.PIPELINE_VALIDATION_CIRCULAR_DEPENDENCY
    );
  }

  // Step 4: Warn about long chains (non-blocking)
  const longChains = detectLongChains(graph, 5);
  for (const chain of longChains) {
    logger().warn(
      {
        taskId: chain.taskId,
        depth: chain.depth,
        chain: chain.chain,
      },
      `Long dependency chain detected (${chain.depth} levels)`
    );
  }
}
