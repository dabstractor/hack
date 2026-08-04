/**
 * Table formatting utilities for CLI display
 *
 * @module utils/display/table-formatter
 *
 * @remarks
 * Provides table formatting functions using cli-table3 for displaying
 * session information, task hierarchies, artifacts, and errors.
 *
 * @example
 * ```typescript
 * import { formatSessionTable, formatTaskHierarchyTable } from './utils/display/table-formatter.js';
 * import type { SessionMetadata, Phase } from '../core/models.js';
 *
 * console.log(formatSessionTable(sessionMetadata));
 * console.log(formatTaskHierarchyTable(phases));
 * ```
 */

import Table from 'cli-table3';
import chalk from 'chalk';
import type { SessionMetadata, Phase, Status } from '../../core/models.js';
import { getStatusIndicator } from './status-colors.js';

/**
 * Minimum terminal width `hack inspect` stays readable at (PRD §5.4).
 */
const MIN_TERMINAL_WIDTH = 30;
/**
 * Fallback width when the terminal width cannot be detected (non-TTY/piped).
 */
const DEFAULT_TERMINAL_WIDTH = 80;

/**
 * Detect the current terminal width, clamped to a readable minimum (PRD §5.4).
 *
 * @remarks
 * Returns `process.stdout.columns` when a TTY reports it; otherwise the
 * {@link DEFAULT_TERMINAL_WIDTH}. Always clamps to {@link MIN_TERMINAL_WIDTH}
 * (30) so `hack inspect` tables wrap rather than overflow on narrow terminals.
 * Exported for testability.
 *
 * @returns Terminal width in columns, never below 30.
 */
export function getTerminalWidth(): number {
  const columns = process.stdout.columns;
  const detected =
    typeof columns === 'number' && columns > 0
      ? columns
      : DEFAULT_TERMINAL_WIDTH;
  return Math.max(MIN_TERMINAL_WIDTH, detected);
}

/**
 * Compute table column widths that fit the current terminal and enable cell
 * wrapping, distributing space by relative `weights` (PRD §5.4).
 *
 * @remarks
 * cli-table3's total table width is `sum(colWidths)` plus one vertical
 * border/separator per column boundary (`numCols + 1` chars). This helper
 * subtracts that overhead from the (clamped) terminal width, gives each column
 * at least `floor` characters, and distributes the remaining space by weight
 * so long cell data wraps onto extra lines instead of pushing the table past
 * the right edge of the terminal.
 *
 * @param weights - Relative widths per column (e.g. `[1, 2]` → 33%/67%).
 * @param floor   - Minimum characters per column (default 4).
 * @returns Integer column widths summing to `terminalWidth - (numCols + 1)`.
 */
function fitColumnWidths(weights: number[], floor = 4): number[] {
  const numCols = weights.length;
  const borders = numCols + 1; // left border + middle separators + right border
  const usable = Math.max(numCols * floor, getTerminalWidth() - borders);
  const weightSum = weights.reduce((sum, w) => sum + w, 0);
  const excess = usable - numCols * floor; // guaranteed >= 0
  const widths = weights.map(w => floor + Math.floor((excess * w) / weightSum));
  // Absorb the non-negative rounding remainder into the last column so the
  // total matches `usable` exactly.
  const assigned = widths.reduce((sum, w) => sum + w, 0);
  widths[widths.length - 1] += usable - assigned;
  return widths;
}

// Local type definitions for inspect command
export interface ArtifactLocation {
  taskId: string;
  type: 'prp' | 'validation' | 'implementation';
  path: string;
  exists: boolean;
}

export interface ErrorSummary {
  taskId: string;
  taskTitle: string;
  errorMessage: string;
  timestamp?: string;
  retryCount?: number;
}

/**
 * Formats session metadata as a table
 *
 * @param session - Session metadata to format
 * @returns Formatted table string
 *
 * @example
 * ```typescript
 * const table = formatSessionTable({
 *   id: '001_14b9dc2a33c7',
 *   hash: '14b9dc2a33c7',
 *   path: 'plan/001_14b9dc2a33c7',
 *   createdAt: new Date(),
 *   parentSession: null
 * });
 * console.log(table);
 * ```
 */
export function formatSessionTable(session: SessionMetadata): string {
  const table = new Table({
    head: [chalk.cyan('Property'), chalk.cyan('Value')],
    colWidths: fitColumnWidths([1, 2]),
    wordWrap: true,
    chars: {
      top: '─',
      'top-mid': '┬',
      'top-left': '┌',
      'top-right': '┐',
      bottom: '─',
      'bottom-mid': '┴',
      'bottom-left': '└',
      'bottom-right': '┘',
      left: '│',
      'left-mid': '├',
      mid: '─',
      'mid-mid': '┼',
      right: '│',
      'right-mid': '┤',
      middle: '│',
    },
  });

  table.push(
    ['Session ID', chalk.bold(session.id)],
    ['Hash', session.hash],
    ['Sequence', session.id.split('_')[0]],
    [
      'Parent',
      session.parentSession
        ? chalk.yellow(session.parentSession)
        : chalk.gray('None'),
    ],
    ['Created', session.createdAt.toLocaleString()],
    ['Path', session.path]
  );

  return table.toString();
}

/**
 * Formats task hierarchy as a table
 *
 * @param phases - Array of phases to format
 * @param currentId - Optional ID of currently executing task for highlighting
 * @returns Formatted table string
 *
 * @remarks
 * Creates a hierarchical table with indentation showing the 4-level
 * hierarchy (Phase > Milestone > Task > Subtask). The current task
 * (if provided) is highlighted with a cyan arrow.
 *
 * @example
 * ```typescript
 * const table = formatTaskHierarchyTable(phases, 'P1.M1.T1.S1');
 * console.log(table);
 * ```
 */
export function formatTaskHierarchyTable(
  phases: Phase[],
  currentId?: string
): string {
  const table = new Table({
    head: [
      chalk.cyan('ID'),
      chalk.cyan('Title'),
      chalk.cyan('Status'),
      chalk.cyan('Points'),
    ],
    colWidths: fitColumnWidths([2, 5, 3, 1]),
    wordWrap: true,
    chars: {
      top: '─',
      'top-mid': '┬',
      'top-left': '┌',
      'top-right': '┐',
      bottom: '─',
      'bottom-mid': '┴',
      'bottom-left': '└',
      'bottom-right': '┘',
      left: '│',
      'left-mid': '├',
      mid: '─',
      'mid-mid': '┼',
      right: '│',
      'right-mid': '┤',
      middle: '│',
    },
  });

  const isCurrent = (id: string): boolean => id === currentId;
  const formatId = (id: string, indent: string): string => {
    const base = indent + id;
    return isCurrent(id) ? chalk.bold.cyan('→ ') + chalk.bold.cyan(base) : base;
  };

  for (const phase of phases) {
    table.push([
      formatId(phase.id, ''),
      phase.title,
      getStatusIndicator(phase.status) + ' ' + phase.status,
      '',
    ]);

    for (const milestone of phase.milestones) {
      table.push([
        formatId(milestone.id, '  '),
        milestone.title,
        getStatusIndicator(milestone.status) + ' ' + milestone.status,
        '',
      ]);

      for (const task of milestone.tasks) {
        table.push([
          formatId(task.id, '    '),
          task.title,
          getStatusIndicator(task.status) + ' ' + task.status,
          '',
        ]);

        for (const subtask of task.subtasks) {
          table.push([
            formatId(subtask.id, '      '),
            subtask.title,
            getStatusIndicator(subtask.status) + ' ' + subtask.status,
            subtask.story_points.toString(),
          ]);
        }
      }
    }
  }

  return table.toString();
}

/**
 * Formats artifact locations as a table
 *
 * @param artifacts - Array of artifact locations to format
 * @returns Formatted table string
 *
 * @example
 * ```typescript
 * const table = formatArtifactTable([
 *   { taskId: 'P1.M1.T1.S1', type: 'prp', path: 'plan/001_test/prps/P1.M1.T1.S1.md', exists: true },
 *   { taskId: 'P1.M1.T1.S2', type: 'validation', path: 'plan/001_test/artifacts/P1.M1.T1.S2/', exists: false }
 * ]);
 * console.log(table);
 * ```
 */
export function formatArtifactTable(artifacts: ArtifactLocation[]): string {
  if (artifacts.length === 0) {
    return chalk.gray('No artifacts found.');
  }

  const table = new Table({
    head: [
      chalk.cyan('Task ID'),
      chalk.cyan('Type'),
      chalk.cyan('Path'),
      chalk.cyan('Status'),
    ],
    wordWrap: true,
    colWidths: fitColumnWidths([3, 2, 6, 2]),
    chars: {
      top: '─',
      'top-mid': '┬',
      'top-left': '┌',
      'top-right': '┐',
      bottom: '─',
      'bottom-mid': '┴',
      'bottom-left': '└',
      'bottom-right': '┘',
      left: '│',
      'left-mid': '├',
      mid: '─',
      'mid-mid': '┼',
      right: '│',
      'right-mid': '┤',
      middle: '│',
    },
  });

  for (const artifact of artifacts) {
    const status = artifact.exists ? chalk.green('✓') : chalk.red('✗');
    const type = chalk.bold(artifact.type.toUpperCase());
    table.push([artifact.taskId, type, artifact.path, status]);
  }

  return table.toString();
}

/**
 * Formats error summaries as a table
 *
 * @param errors - Array of error summaries to format
 * @returns Formatted table string
 *
 * @example
 * ```typescript
 * const table = formatErrorTable([
 *   { taskId: 'P1.M1.T1.S1', taskTitle: 'Test Task', errorMessage: 'Syntax error', timestamp: '2024-01-15T10:00:00Z' }
 * ]);
 * console.log(table);
 * ```
 */
export function formatErrorTable(errors: ErrorSummary[]): string {
  if (errors.length === 0) {
    return chalk.green('No errors found.');
  }

  const table = new Table({
    head: [
      chalk.cyan('Task ID'),
      chalk.cyan('Title'),
      chalk.cyan('Error'),
      chalk.cyan('Time'),
    ],
    wordWrap: true,
    colWidths: fitColumnWidths([2, 3, 5, 2]),
    chars: {
      top: '─',
      'top-mid': '┬',
      'top-left': '┌',
      'top-right': '┐',
      bottom: '─',
      'bottom-mid': '┴',
      'bottom-left': '└',
      'bottom-right': '┘',
      left: '│',
      'left-mid': '├',
      mid: '─',
      'mid-mid': '┼',
      right: '│',
      'right-mid': '┤',
      middle: '│',
    },
  });

  for (const error of errors) {
    const timeStr = error.timestamp
      ? new Date(error.timestamp).toLocaleString()
      : chalk.gray('N/A');
    table.push([
      chalk.red(error.taskId),
      error.taskTitle,
      chalk.red(error.errorMessage),
      timeStr,
    ]);
  }

  return table.toString();
}

/**
 * Formats status counts as a summary table
 *
 * @param counts - Record of status counts
 * @returns Formatted table string
 *
 * @example
 * ```typescript
 * const table = formatStatusCounts({
 *   Planned: 10,
 *   Researching: 2,
 *   Implementing: 3,
 *   Complete: 50,
 *   Failed: 0,
 *   Obsolete: 1
 * });
 * console.log(table);
 * ```
 */
export function formatStatusCounts(counts: Record<string, number>): string {
  const table = new Table({
    head: [chalk.cyan('Status'), chalk.cyan('Count')],
    colWidths: fitColumnWidths([3, 1]),
    wordWrap: true,
    chars: {
      top: '─',
      'top-mid': '┬',
      'top-left': '┌',
      'top-right': '┐',
      bottom: '─',
      'bottom-mid': '┴',
      'bottom-left': '└',
      'bottom-right': '┘',
      left: '│',
      'left-mid': '├',
      mid: '─',
      'mid-mid': '┼',
      right: '│',
      'right-mid': '┤',
      middle: '│',
    },
  });

  const statusColorMap: Record<string, (text: string) => string> = {
    Planned: chalk.gray,
    Researching: chalk.cyan,
    Implementing: chalk.blue,
    Retrying: chalk.yellow,
    Complete: chalk.green,
    Failed: chalk.red,
    Obsolete: chalk.dim,
  };

  let total = 0;
  for (const [status, count] of Object.entries(counts)) {
    const colorFn = statusColorMap[status] || chalk.white;
    table.push([colorFn(status), count.toString()]);
    total += count;
  }

  table.push([chalk.bold('Total'), chalk.bold(total.toString())]);

  return table.toString();
}

/**
 * Formats current task information as a table
 *
 * @param taskId - Current task ID
 * @param title - Current task title
 * @param status - Current task status
 * @param startTime - Optional start time of the task
 * @returns Formatted table string
 *
 * @example
 * ```typescript
 * const table = formatCurrentTask('P1.M1.T1.S1', 'Implement feature', 'Implementing', new Date());
 * console.log(table);
 * ```
 */
export function formatCurrentTask(
  taskId: string,
  title: string,
  status: string,
  startTime?: Date
): string {
  const table = new Table({
    head: [chalk.cyan('Property'), chalk.cyan('Value')],
    colWidths: fitColumnWidths([1, 2]),
    wordWrap: true,
    chars: {
      top: '─',
      'top-mid': '┬',
      'top-left': '┌',
      'top-right': '┐',
      bottom: '─',
      'bottom-mid': '┴',
      'bottom-left': '└',
      'bottom-right': '┘',
      left: '│',
      'left-mid': '├',
      mid: '─',
      'mid-mid': '┼',
      right: '│',
      'right-mid': '┤',
      middle: '│',
    },
  });

  table.push(
    ['Current Task', chalk.bold.cyan('→ ') + chalk.bold(taskId)],
    ['Title', title],
    ['Status', getStatusIndicator(status as Status) + ' ' + status]
  );

  if (startTime) {
    const elapsed = Date.now() - startTime.getTime();
    const elapsedStr = formatDuration(elapsed);
    table.push(['Running For', elapsedStr]);
  }

  return table.toString();
}

/**
 * Formats a duration in milliseconds to human readable string
 *
 * @param ms - Duration in milliseconds
 * @returns Formatted duration string
 *
 * @example
 * ```typescript
 * formatDuration(3661000); // "1h 1m 1s"
 * formatDuration(61000); // "1m 1s"
 * formatDuration(1000); // "1s"
 * ```
 */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  const parts: string[] = [];
  if (hours > 0) {
    parts.push(`${hours}h`);
  }
  if (minutes % 60 > 0) {
    parts.push(`${minutes % 60}m`);
  }
  if (seconds % 60 > 0 || parts.length === 0) {
    parts.push(`${seconds % 60}s`);
  }

  return parts.join(' ');
}
