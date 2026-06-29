/**
 * Artifacts command for viewing and comparing pipeline artifacts
 *
 * @module cli/commands/artifacts
 *
 * @remarks
 * Provides convenient viewing, listing, and comparing of pipeline artifacts
 * stored in session directories. Supports three subcommands:
 * - list: Lists all artifacts with metadata
 * - view: Displays specific artifact content with syntax highlighting
 * - diff: Compares artifacts between tasks
 *
 * @example
 * ```typescript
 * import { ArtifactsCommand } from './cli/commands/artifacts.js';
 *
 * const command = new ArtifactsCommand();
 * await command.execute('list', { output: 'table' });
 * ```
 */

import { resolve } from 'node:path';
import { promises as fs } from 'node:fs';
import chalk from 'chalk';
import Table from 'cli-table3';
import type { SessionState, Status } from '../../core/models.js';
import type { ValidationGateResult } from '../../agents/prp-executor.js';
import { SessionManager } from '../../core/session-manager.js';
import {
  SyntaxHighlighter,
  type ColorMode,
} from '../../utils/display/syntax-highlighter.js';
import { ArtifactDiffer } from '../../utils/artifact-differ.js';
import { getStatusIndicator } from '../../utils/display/status-colors.js';
import { getLogger, type Logger } from '../../utils/logger.js';

let _logger: Logger | undefined;
const logger = (): Logger => (_logger ??= getLogger('ArtifactsCommand'));

/**
 * Artifact metadata for listing
 */
export interface ArtifactMetadata {
  /** Task ID */
  taskId: string;
  /** Task title */
  taskTitle: string;
  /** Artifact type: validation, summary, list */
  artifactType: 'validation' | 'summary' | 'list';
  /** Relative path from session directory */
  path: string;
  /** Full absolute path */
  fullPath: string;
  /** File exists check */
  exists: boolean;
  /** File size in bytes */
  size: number;
  /** Task status */
  taskStatus: Status;
}

/**
 * Artifact content for viewing
 */
export interface ArtifactContent {
  /** Task ID */
  taskId: string;
  /** Task title */
  taskTitle: string;
  /** Validation results (if exists) */
  validationResults?: ValidationGateResult[];
  /** Execution summary content (if exists) */
  executionSummary?: string;
  /** Artifacts list (if exists) */
  artifactsList?: string[];
  /** Which files are present */
  presentFiles: Array<
    'validation-results.json' | 'execution-summary.md' | 'artifacts-list.json'
  >;
}

/**
 * Artifact diff result */
export interface ArtifactDiff {
  /** Task 1 ID */
  task1Id: string;
  /** Task 2 ID */
  task2Id: string;
  /** Has differences */
  hasChanges: boolean;
  /** Validation results diff */
  validationDiff?: string;
  /** Execution summary diff */
  summaryDiff?: string;
  /** Artifacts list diff */
  listDiff?: string;
  /** Statistics */
  stats: {
    additions: number;
    deletions: number;
  };
}

/**
 * Artifacts list options
 */
export interface ArtifactsListOptions {
  /** Session ID (optional, defaults to latest) */
  session?: string;
  /** Output format */
  output: 'table' | 'json';
  /** Use color */
  color?: boolean;
}

/**
 * Artifacts view options
 */
export interface ArtifactsViewOptions {
  /** Task ID to view */
  taskId: string;
  /** Session ID (optional) */
  session?: string;
  /** Output format */
  output: 'table' | 'json';
  /** Use color */
  color?: boolean;
}

/**
 * Artifacts diff options
 */
export interface ArtifactsDiffOptions {
  /** First task ID */
  task1Id: string;
  /** Second task ID */
  task2Id: string;
  /** Session ID (optional) */
  session?: string;
  /** Output format */
  output: 'table' | 'json';
  /** Use color */
  color?: boolean;
}

/**
 * Artifacts command handler class
 *
 * @remarks
 * Executes the artifacts command with various subcommands for listing,
 * viewing, and comparing pipeline artifacts.
 */
export class ArtifactsCommand {
  /** Default plan directory */
  readonly #planDir: string;

  /** Default PRD path */
  readonly #prdPath: string;

  /** Syntax highlighter instance */
  readonly #highlighter: SyntaxHighlighter;

  /** Artifact differ instance */
  readonly #differ: ArtifactDiffer;

  /**
   * Creates a new ArtifactsCommand instance
   *
   * @param planDir - Path to plan directory (default: resolve('plan'))
   * @param prdPath - Path to PRD file (default: resolve('PRD.md'))
   */
  constructor(
    planDir: string = resolve('plan'),
    prdPath: string = resolve('PRD.md')
  ) {
    this.#planDir = planDir;
    this.#prdPath = prdPath;
    this.#highlighter = new SyntaxHighlighter();
    this.#differ = new ArtifactDiffer();
  }

  /**
   * Executes the artifacts command
   *
   * @param action - Action to perform (list, view, diff)
   * @param options - Command options
   * @throws {Error} If action is unknown or execution fails
   *
   * @example
   * ```typescript
   * const command = new ArtifactsCommand();
   * await command.execute('list', { output: 'table' });
   * await command.execute('view', { taskId: 'P1.M1.T1.S1', output: 'table' });
   * await command.execute('diff', { task1Id: 'P1.M1.T1.S1', task2Id: 'P1.M1.T1.S2' });
   * ```
   */
  async execute(
    action: string,
    options: ArtifactsListOptions | ArtifactsViewOptions | ArtifactsDiffOptions
  ): Promise<void> {
    try {
      switch (action) {
        case 'list':
          await this.#listArtifacts(options as ArtifactsListOptions);
          break;
        case 'view':
          await this.#viewArtifacts(options as ArtifactsViewOptions);
          break;
        case 'diff':
          await this.#diffArtifacts(options as ArtifactsDiffOptions);
          break;
        default:
          console.error(chalk.red(`Unknown action: ${action}`));
          console.info('Valid actions: list, view, diff');
          process.exit(1);
      }
    } catch (error) {
      console.error(
        chalk.red('Error:'),
        error instanceof Error ? error.message : error
      );
      logger().error({ error }, 'Artifacts command failed');
      process.exit(1);
    }
  }

  /**
   * Loads session based on options
   *
   * @param sessionId - Optional session ID to load
   * @returns Loaded session state
   * @throws {Error} If session not found
   *
   * @private
   */
  async #loadSession(sessionId?: string): Promise<SessionState> {
    if (sessionId) {
      const sessions = await SessionManager.listSessions(this.#planDir);
      const session = sessions.find(
        s => s.hash === sessionId || s.id === sessionId
      );
      if (!session) {
        throw new Error(`Session not found: ${sessionId}`);
      }
      const manager = new SessionManager(this.#prdPath, this.#planDir);
      return await manager.loadSession(session.path);
    }

    // Find latest session
    const latest = await SessionManager.findLatestSession(this.#planDir);
    if (!latest) {
      throw new Error('No sessions found');
    }
    const manager = new SessionManager(this.#prdPath, this.#planDir);
    return await manager.loadSession(latest.path);
  }

  /**
   * Scans session directory for artifacts
   *
   * @param session - Session state to scan
   * @returns Array of artifact metadata
   *
   * @private
   */
  async #scanArtifacts(session: SessionState): Promise<ArtifactMetadata[]> {
    const artifacts: ArtifactMetadata[] = [];
    const sessionPath = session.metadata.path;
    const artifactsPath = resolve(sessionPath, 'artifacts');

    // Check if artifacts directory exists
    try {
      await fs.access(artifactsPath);
    } catch {
      return artifacts; // No artifacts directory
    }

    // Scan for task directories
    const taskDirs = await fs.readdir(artifactsPath);

    for (const taskDir of taskDirs) {
      const taskPath = resolve(artifactsPath, taskDir);
      const stat = await fs.stat(taskPath);

      if (!stat.isDirectory()) continue;

      // Convert directory name back to task ID (underscores to dots)
      const taskId = taskDir.replace(/_/g, '.');

      // Find task in backlog to get title and status
      const task = this.#findTaskInBacklog(session, taskId);
      const taskTitle = task?.title || 'Unknown';
      const taskStatus = task?.status || 'Planned';

      // Check for each artifact file
      const filenames = [
        'validation-results.json',
        'execution-summary.md',
        'artifacts-list.json',
      ] as const;
      const types: Record<
        (typeof filenames)[number],
        'validation' | 'summary' | 'list'
      > = {
        'validation-results.json': 'validation',
        'execution-summary.md': 'summary',
        'artifacts-list.json': 'list',
      };

      for (const filename of filenames) {
        const filePath = resolve(taskPath, filename);
        const exists = await this.#artifactExists(filePath);
        let size = 0;

        if (exists) {
          const fileStat = await fs.stat(filePath);
          size = fileStat.size;
        }

        artifacts.push({
          taskId,
          taskTitle,
          artifactType: types[filename],
          path: `artifacts/${taskDir}/${filename}`,
          fullPath: filePath,
          exists,
          size,
          taskStatus,
        });
      }
    }

    return artifacts;
  }

  /**
   * Finds task in backlog by ID
   *
   * @param session - Session state
   * @param taskId - Task ID to find
   * @returns Task object or null
   *
   * @private
   */
  #findTaskInBacklog(
    session: SessionState,
    taskId: string
  ): { title: string; status: Status } | null {
    for (const phase of session.taskRegistry.backlog) {
      for (const milestone of phase.milestones) {
        for (const task of milestone.tasks) {
          if (task.id === taskId) {
            return { title: task.title, status: task.status };
          }
          for (const subtask of task.subtasks) {
            if (subtask.id === taskId) {
              return { title: subtask.title, status: subtask.status };
            }
          }
        }
      }
    }
    return null;
  }

  /**
   * Checks if artifact file exists
   *
   * @param path - File path to check
   * @returns true if file exists, false otherwise
   *
   * @private
   */
  async #artifactExists(path: string): Promise<boolean> {
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Gets artifact path for a task
   *
   * @param session - Session state
   * @param taskId - Task ID
   * @param filename - Artifact filename
   * @returns Full path to artifact file
   *
   * @private
   */
  #getArtifactPath(
    session: SessionState,
    taskId: string,
    filename: string
  ): string {
    const taskDir = taskId.replace(/\./g, '_');
    return resolve(session.metadata.path, 'artifacts', taskDir, filename);
  }

  /**
   * Lists all artifacts with metadata
   *
   * @param options - List options
   *
   * @private
   */
  async #listArtifacts(options: ArtifactsListOptions): Promise<void> {
    const session = await this.#loadSession(options.session);
    const artifacts = await this.#scanArtifacts(session);

    if (options.output === 'json') {
      console.log(JSON.stringify(artifacts, null, 2));
    } else {
      if (artifacts.length === 0) {
        console.log(chalk.gray('No artifacts found.'));
        return;
      }
      console.log(this.#formatArtifactTable(artifacts));
    }
  }

  /**
   * Formats artifacts as a table
   *
   * @param artifacts - Array of artifact metadata
   * @returns Formatted table string
   *
   * @private
   */
  #formatArtifactTable(artifacts: ArtifactMetadata[]): string {
    const table = new Table({
      head: [
        chalk.cyan('Task ID'),
        chalk.cyan('Type'),
        chalk.cyan('Path'),
        chalk.cyan('Status'),
      ],
      colWidths: [20, 15, 45, 15],
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
      const statusIcon = getStatusIndicator(artifact.taskStatus);
      const existsIndicator = artifact.exists
        ? chalk.green('✓')
        : chalk.gray('○');

      table.push([
        artifact.taskId,
        artifact.artifactType,
        artifact.path,
        `${existsIndicator} ${statusIcon}`,
      ]);
    }

    return table.toString();
  }

  /**
   * Views artifacts for a specific task
   *
   * @param options - View options
   *
   * @private
   */
  async #viewArtifacts(options: ArtifactsViewOptions): Promise<void> {
    const session = await this.#loadSession(options.session);
    const content = await this.#loadArtifactContent(session, options.taskId);

    if (!content) {
      const message = chalk.gray(
        `No artifacts found for task: ${options.taskId}`
      );
      if (options.output === 'json') {
        console.log(
          JSON.stringify(
            { error: 'No artifacts found', taskId: options.taskId },
            null,
            2
          )
        );
      } else {
        console.log(message);
      }
      return;
    }

    if (options.output === 'json') {
      console.log(JSON.stringify(content, null, 2));
    } else {
      console.log(
        this.#formatArtifactContent(
          content,
          this.#shouldUseColor(options.color)
        )
      );
    }
  }

  /**
   * Loads artifact content for a task
   *
   * @param session - Session state
   * @param taskId - Task ID
   * @returns Artifact content or null
   *
   * @private
   */
  async #loadArtifactContent(
    session: SessionState,
    taskId: string
  ): Promise<ArtifactContent | null> {
    const task = this.#findTaskInBacklog(session, taskId);
    if (!task) return null;

    const content: ArtifactContent = {
      taskId,
      taskTitle: task.title,
      presentFiles: [],
    };

    // Load validation-results.json
    const validationPath = this.#getArtifactPath(
      session,
      taskId,
      'validation-results.json'
    );
    if (await this.#artifactExists(validationPath)) {
      const validationContent = await fs.readFile(validationPath, 'utf-8');
      content.validationResults = JSON.parse(validationContent);
      content.presentFiles.push('validation-results.json');
    }

    // Load execution-summary.md
    const summaryPath = this.#getArtifactPath(
      session,
      taskId,
      'execution-summary.md'
    );
    if (await this.#artifactExists(summaryPath)) {
      content.executionSummary = await fs.readFile(summaryPath, 'utf-8');
      content.presentFiles.push('execution-summary.md');
    }

    // Load artifacts-list.json
    const listPath = this.#getArtifactPath(
      session,
      taskId,
      'artifacts-list.json'
    );
    if (await this.#artifactExists(listPath)) {
      const listContent = await fs.readFile(listPath, 'utf-8');
      content.artifactsList = JSON.parse(listContent);
      content.presentFiles.push('artifacts-list.json');
    }

    if (content.presentFiles.length === 0) return null;

    return content;
  }

  /**
   * Formats artifact content for display
   *
   * @param content - Artifact content
   * @param color - Whether to use color
   * @returns Formatted content string
   *
   * @private
   */
  #formatArtifactContent(content: ArtifactContent, color: boolean): string {
    const lines: string[] = [];

    lines.push(
      chalk.bold(`\nArtifacts for ${content.taskId}: ${content.taskTitle}\n`)
    );
    lines.push(chalk.gray('─'.repeat(80)));

    // Validation Results
    if (content.validationResults) {
      lines.push(chalk.bold('\nvalidation-results.json:'));
      lines.push(
        this.#highlighter.highlightJSON(
          content.validationResults,
          this.#getColorMode(color)
        )
      );
    }

    // Execution Summary
    if (content.executionSummary) {
      lines.push(chalk.bold('\nexecution-summary.md:'));
      lines.push(
        this.#highlighter.highlightMarkdown(
          content.executionSummary,
          this.#getColorMode(color)
        )
      );
    }

    // Artifacts List
    if (content.artifactsList) {
      lines.push(chalk.bold('\nartifacts-list.json:'));
      lines.push(
        this.#highlighter.highlightJSON(
          content.artifactsList,
          this.#getColorMode(color)
        )
      );
    }

    return lines.join('\n');
  }

  /**
   * Diffs artifacts between two tasks
   *
   * @param options - Diff options
   *
   * @private
   */
  async #diffArtifacts(options: ArtifactsDiffOptions): Promise<void> {
    const session = await this.#loadSession(options.session);

    const content1 = await this.#loadArtifactForDiff(session, options.task1Id);
    const content2 = await this.#loadArtifactForDiff(session, options.task2Id);

    if (!content1) {
      const message = chalk.yellow(
        `No artifacts found for task: ${options.task1Id}`
      );
      if (options.output === 'json') {
        console.log(
          JSON.stringify(
            { error: 'No artifacts found', taskId: options.task1Id },
            null,
            2
          )
        );
      } else {
        console.log(message);
      }
      return;
    }
    if (!content2) {
      const message = chalk.yellow(
        `No artifacts found for task: ${options.task2Id}`
      );
      if (options.output === 'json') {
        console.log(
          JSON.stringify(
            { error: 'No artifacts found', taskId: options.task2Id },
            null,
            2
          )
        );
      } else {
        console.log(message);
      }
      return;
    }

    const diffResult: ArtifactDiff = {
      task1Id: options.task1Id,
      task2Id: options.task2Id,
      hasChanges: false,
      stats: { additions: 0, deletions: 0 },
    };

    const useColor = this.#shouldUseColor(options.color);

    // Diff validation results
    if (content1.validationResults && content2.validationResults) {
      const validationDiff = this.#differ.diffJSON(
        content1.validationResults,
        content2.validationResults,
        { color: useColor }
      );
      diffResult.validationDiff = validationDiff.unifiedDiff;
      diffResult.stats.additions += validationDiff.additions;
      diffResult.stats.deletions += validationDiff.deletions;
      if (validationDiff.hasChanges) diffResult.hasChanges = true;
    }

    // Diff execution summaries
    if (content1.executionSummary && content2.executionSummary) {
      const summaryDiff = this.#differ.diffText(
        content1.executionSummary,
        content2.executionSummary,
        { color: useColor }
      );
      diffResult.summaryDiff = summaryDiff.unifiedDiff;
      diffResult.stats.additions += summaryDiff.additions;
      diffResult.stats.deletions += summaryDiff.deletions;
      if (summaryDiff.hasChanges) diffResult.hasChanges = true;
    }

    // Diff artifacts lists
    if (content1.artifactsList && content2.artifactsList) {
      const listDiff = this.#differ.diffJSON(
        content1.artifactsList,
        content2.artifactsList,
        { color: useColor }
      );
      diffResult.listDiff = listDiff.unifiedDiff;
      diffResult.stats.additions += listDiff.additions;
      diffResult.stats.deletions += listDiff.deletions;
      if (listDiff.hasChanges) diffResult.hasChanges = true;
    }

    if (options.output === 'json') {
      console.log(JSON.stringify(diffResult, null, 2));
    } else {
      console.log(this.#formatArtifactDiff(diffResult, useColor));
    }
  }

  /**
   * Loads artifact content for diffing
   *
   * @param session - Session state
   * @param taskId - Task ID
   * @returns Artifact content or null
   *
   * @private
   */
  async #loadArtifactForDiff(
    session: SessionState,
    taskId: string
  ): Promise<ArtifactContent | null> {
    return this.#loadArtifactContent(session, taskId);
  }

  /**
   * Formats artifact diff for display
   *
   * @param diff - Artifact diff result
   * @param color - Whether to use color
   * @returns Formatted diff string
   *
   * @private
   */
  #formatArtifactDiff(diff: ArtifactDiff, color: boolean): string {
    const lines: string[] = [];

    lines.push(
      chalk.bold(`\nComparing artifacts: ${diff.task1Id} → ${diff.task2Id}\n`)
    );

    if (!diff.hasChanges) {
      lines.push(chalk.gray('No differences detected.'));
      return lines.join('\n');
    }

    const summary = color
      ? `Changes: ${chalk.green('+' + diff.stats.additions)} ${chalk.red('-' + diff.stats.deletions)}`
      : `Changes: +${diff.stats.additions} -${diff.stats.deletions}`;

    lines.push(summary);
    lines.push('');

    if (diff.validationDiff) {
      lines.push(chalk.bold('validation-results.json:'));
      lines.push(diff.validationDiff);
    }

    if (diff.summaryDiff) {
      lines.push(chalk.bold('execution-summary.md:'));
      lines.push(diff.summaryDiff);
    }

    if (diff.listDiff) {
      lines.push(chalk.bold('artifacts-list.json:'));
      lines.push(diff.listDiff);
    }

    return lines.join('\n');
  }

  /**
   * Determines if color should be used
   *
   * @param colorOption - Color option from command
   * @returns true if color should be used
   *
   * @private
   */
  #shouldUseColor(colorOption?: boolean): boolean {
    if (colorOption === false) return false;
    if (colorOption === true) return true;
    // Auto: check TTY and NO_COLOR
    return process.stdout.isTTY !== false && !process.env.NO_COLOR;
  }

  /**
   * Gets color mode for highlighter
   *
   * @param useColor - Whether to use color
   * @returns Color mode
   *
   * @private
   */
  #getColorMode(useColor: boolean): ColorMode {
    return useColor ? 'always' : 'never';
  }
}
