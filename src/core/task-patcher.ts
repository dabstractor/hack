/**
 * Task patching utility for delta session backlog updates
 *
 * @module core/task-patcher
 *
 * @remarks
 * Transforms a backlog based on DeltaAnalysis results from PRD comparison.
 * Handles three change types: added (delegated to the delta-session breakdown —
 * no-op here), modified (reset to Planned), and removed (mark Obsolete). Completed
 * work is preserved unless explicitly affected by changes.
 *
 * @example
 * ```typescript
 * import { patchBacklog } from './core/task-patcher.js';
 *
 * const patched = patchBacklog(currentBacklog, deltaAnalysis);
 * console.log(`Patched ${deltaAnalysis.taskIds.length} tasks`);
 * ```
 */

import type { Backlog, DeltaAnalysis } from './models.js';
import { getLogger, type Logger } from '../utils/logger.js';
import { updateItemStatus } from '../utils/task-utils.js';

// Module-level logger for task patcher
let _logger: Logger | undefined;
const logger = (): Logger => (_logger ??= getLogger('TaskPatcher'));

// ============================================================================
// MAIN FUNCTION
// ============================================================================

/**
 * Patch backlog based on delta analysis
 *
 * @param backlog - Current backlog to patch
 * @param delta - Delta analysis from PRD comparison
 * @returns New immutable backlog with applied patches
 *
 * @remarks
 * Processes three change types:
 * - 'added': No-op here — added requirements are delegated to the delta-session
 *   breakdown (decomposePRD over delta_prd.md). patchBacklog is a synchronous pure
 *   function with no Architect/PRD-section access, so it cannot generate tasks.
 * - 'modified': Reset task status to 'Planned' for re-implementation
 * - 'removed': Set task status to 'Obsolete'
 *
 * Completed tasks not in delta.taskIds are preserved unchanged.
 *
 * Patches are applied immutably - original backlog is unchanged.
 *
 * @example
 * ```typescript
 * const delta: DeltaAnalysis = {
 *   changes: [
 *     { itemId: 'P1.M1.T1.S1', type: 'modified', description: '...', impact: '...' }
 *   ],
 *   patchInstructions: 'Re-execute P1.M1.T1.S1',
 *   taskIds: ['P1.M1.T1.S1']
 * };
 *
 * const patched = patchBacklog(backlog, delta);
 * const updatedTask = findItem(patched, 'P1.M1.T1.S1');
 * console.log(updatedTask?.status); // 'Planned'
 * ```
 */
export function patchBacklog(backlog: Backlog, delta: DeltaAnalysis): Backlog {
  // De-duplicate taskIds (changes may have duplicates)
  const uniqueTaskIds = new Set(delta.taskIds);

  // Create map for efficient change lookup
  const changeMap = new Map(
    delta.changes.map(change => [change.itemId, change])
  );

  // Start with original backlog
  let patchedBacklog = backlog;

  // Process each unique task ID
  for (const taskId of Array.from(uniqueTaskIds)) {
    const change = changeMap.get(taskId);

    if (!change) {
      // Task ID in taskIds but no change entry - skip
      continue;
    }

    switch (change.type) {
      case 'modified':
        // Reset to 'Planned' for re-implementation
        patchedBacklog = updateItemStatus(patchedBacklog, taskId, 'Planned');
        break;

      case 'removed':
        // Mark as obsolete
        patchedBacklog = updateItemStatus(patchedBacklog, taskId, 'Obsolete');
        break;

      case 'added':
        // Added requirements are handled by the delta-session breakdown
        // (decomposePRD over delta_prd.md), not here: patchBacklog is a sync
        // pure fn with no architect/PRD-text access. No-op (break).
        logger().debug(
          { changeType: change.type, taskId },
          'Added requirement delegated to delta-session breakdown (decomposePRD over delta_prd.md); patchBacklog is a no-op for added changes'
        );
        break;
    }
  }

  return patchedBacklog;
}
