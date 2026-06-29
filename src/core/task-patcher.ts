/**
 * Task patching utility for delta session backlog updates
 *
 * @module core/task-patcher
 *
 * @remarks
 * Transforms a backlog based on DeltaAnalysis results from PRD comparison.
 * Handles three change types: added (new tasks), modified (reset to Planned),
 * and removed (mark Obsolete). Completed work is preserved unless explicitly
 * affected by changes.
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
 * - 'added': Generate new tasks via Architect agent and insert into backlog
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
        // Generate new tasks via Architect agent
        // NOTE: New PRD section content not available in current scope
        // Placeholder: Log warning and continue
        // TODO: Future enhancement - pass new PRD content to Architect
        logger().warn(
          { changeType: change.type, taskId },
          'Feature not implemented'
        );
        break;
    }
  }

  return patchedBacklog;
}
