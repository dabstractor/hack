/**
 * Status color and indicator utilities for CLI display
 *
 * @module utils/display/status-colors
 *
 * @remarks
 * Provides color mapping and status indicator symbols for displaying
 * task status in terminal output. Uses chalk for terminal colors.
 *
 * @example
 * ```typescript
 * import { getStatusColor, getStatusIndicator } from './utils/display/status-colors.js';
 *
 * const color = getStatusColor('Complete'); // chalk.green
 * const indicator = getStatusIndicator('Complete'); // '✓'
 * console.log(color(indicator)); // Green checkmark
 * ```
 */

import chalk from 'chalk';
import type { Status } from '../../core/models.js';

/**
 * Gets the color function for a given status
 *
 * @param status - The status to get color for
 * @returns Chalk color function for the status
 *
 * @remarks
 * Maps status values to appropriate terminal colors:
 * - Complete: green (success)
 * - Implementing: blue (active work)
 * - Researching: cyan (discovery phase)
 * - Planned: gray (not started)
 * - Failed: red (error)
 * - Obsolete: dim (deprecated)
 *
 * @example
 * ```typescript
 * const green = getStatusColor('Complete');
 * console.log(green('Task complete')); // Green text
 * ```
 */
export function getStatusColor(status: Status): (text: string) => string {
  const colorMap: Record<Status, (text: string) => string> = {
    Complete: chalk.green,
    Implementing: chalk.blue,
    Researching: chalk.cyan,
    Retrying: chalk.yellow,
    Planned: chalk.gray,
    Ready: chalk.magenta,
    Failed: chalk.red,
    Obsolete: chalk.dim,
  };
  return colorMap[status];
}

/**
 * Gets the status indicator symbol with color
 *
 * @param status - The status to get indicator for
 * @returns Colored indicator symbol
 *
 * @remarks
 * Returns Unicode symbols for each status with appropriate coloring:
 * - Complete: ✓ (green checkmark)
 * - Implementing: ◐ (blue half-circle)
 * - Researching: ◐ (cyan half-circle)
 * - Planned: ○ (gray circle)
 * - Failed: ✗ (red x-mark)
 * - Obsolete: ⊘ (dim circle with slash)
 *
 * @example
 * ```typescript
 * console.log(getStatusIndicator('Complete')); // Green ✓
 * console.log(getStatusIndicator('Failed')); // Red ✗
 * ```
 */
export function getStatusIndicator(status: Status): string {
  const indicatorMap: Record<Status, string> = {
    Complete: '✓',
    Implementing: '◐',
    Researching: '◐',
    Retrying: '↻',
    Planned: '○',
    Ready: '◎',
    Failed: '✗',
    Obsolete: '⊘',
  };
  const indicator = indicatorMap[status];
  const color = getStatusColor(status);
  return color(indicator);
}

/**
 * Gets plain text status indicator (without color)
 *
 * @param status - The status to get indicator for
 * @returns Plain indicator symbol
 *
 * @remarks
 * Use this when you need the indicator without color formatting,
 * such as for non-TTY output or logging.
 *
 * @example
 * ```typescript
 * console.log(getPlainStatusIndicator('Complete')); // ✓
 * ```
 */
export function getPlainStatusIndicator(status: Status): string {
  const indicatorMap: Record<Status, string> = {
    Complete: '✓',
    Implementing: '◐',
    Researching: '◐',
    Retrying: '↻',
    Planned: '○',
    Ready: '◎',
    Failed: '✗',
    Obsolete: '⊘',
  };
  return indicatorMap[status];
}
