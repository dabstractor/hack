/**
 * Inspect command for PRD pipeline state
 *
 * @module cli/commands/inspect
 *
 * @remarks
 * Provides comprehensive debugging and inspection capabilities for the
 * PRD pipeline state, including session information, task hierarchy with
 * status, current executing task, recent artifacts, and error summaries.
 *
 * @example
 * ```typescript
 * import { InspectCommand } from './cli/commands/inspect.js';
 *
 * const inspect = new InspectCommand();
 * await inspect.execute({ output: 'table', verbose: false });
 * ```
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import chalk from 'chalk';
import type { SessionState, Status, Phase } from '../../core/models.js';
import type { HierarchyItem } from '../../utils/task-utils.js';
import { SessionManager } from '../../core/session-manager.js';
import {
  findItem,
  getDependencies,
  isSubtask,
  filterByStatus,
} from '../../utils/task-utils.js';
import { getLogger } from '../../utils/logger.js';
import {
  formatSessionTable,
  formatTaskHierarchyTable,
  formatArtifactTable,
  formatErrorTable,
  formatStatusCounts,
  formatCurrentTask,
} from '../../utils/display/table-formatter.js';
import {
  renderTaskTree,
  renderPendingTree,
} from '../../utils/display/tree-renderer.js';

const logger = getLogger('InspectCommand');

/**
 * Options for the inspect command
 */
export interface InspectorOptions {
  /** Output format (table, json, yaml, tree) */
  output: 'table' | 'json' | 'yaml' | 'tree';
  /** Override tasks.json file path */
  file?: string;
  /** Inspect specific session by hash */
  session?: string;
  /** Show verbose output */
  verbose: boolean;
  /** Show only artifact information */
  artifactsOnly: boolean;
  /** Show only error information */
  errorsOnly: boolean;
  /** Show detailed information for specific task */
  task?: string;
}

/**
 * Artifact location information
 */
interface ArtifactLocation {
  taskId: string;
  type: 'prp' | 'validation' | 'implementation';
  path: string;
  exists: boolean;
}

/**
 * Error summary information
 */
interface ErrorSummary {
  taskId: string;
  taskTitle: string;
  errorMessage: string;
  timestamp?: string;
  retryCount?: number;
}

/**
 * Task detail information
 */
interface TaskDetail {
  task: HierarchyItem;
  dependencies: HierarchyItem[];
  dependenciesSatisfied: boolean;
  prpPath?: string;
  prpExists: boolean;
  artifactPath?: string;
  artifactExists: boolean;
  errorInfo?: ErrorSummary;
}

/**
 * Inspector output data structure
 */
interface InspectorOutput {
  session: {
    id: string;
    hash: string;
    path: string;
    createdAt: Date | string;
    parentSession: string | null;
  };
  taskHierarchy: unknown[];
  currentTask?: {
    id: string;
    title: string;
    status: string;
  };
  artifacts: ArtifactLocation[];
  errors: ErrorSummary[];
  statusCounts: Record<string, number>;
}

/**
 * Inspect command handler class
 *
 * @remarks
 * Executes the inspect command with various output formats and filtering options.
 * Integrates with SessionManager for session discovery and loading.
 */
export class InspectCommand {
  /** Default plan directory */
  readonly #planDir: string;

  /** Default PRD path */
  readonly #prdPath: string;

  /**
   * Creates a new InspectCommand instance
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
  }

  /**
   * Executes the inspect command
   *
   * @param options - Command options
   * @throws {Error} If session not found or task not found
   *
   * @example
   * ```typescript
   * const inspect = new InspectCommand();
   * await inspect.execute({ output: 'table', verbose: false });
   * ```
   */
  async execute(options: InspectorOptions): Promise<void> {
    logger.debug({ options }, 'InspectCommand.execute called');

    // Discover and load session
    const sessionState = await this.#loadSession(options);

    // Execute appropriate command
    if (options.task) {
      await this.#executeTaskDetail(sessionState, options.task, options);
    } else {
      await this.#executeOverview(sessionState, options);
    }
  }

  /**
   * Loads session based on options
   *
   * @param options - Command options
   * @returns Loaded session state
   * @throws {Error} If session not found
   *
   * @private
   */
  async #loadSession(options: InspectorOptions): Promise<SessionState> {
    let sessionPath: string;

    if (options.file) {
      // Use specified file path
      const filePath = resolve(options.file);
      if (!existsSync(filePath)) {
        throw new Error(`File not found: ${options.file}`);
      }
      // Extract session directory from file path
      sessionPath = this.#extractSessionPath(filePath);
    } else if (options.session) {
      // Find session by hash
      const sessions = await SessionManager.listSessions(this.#planDir);
      const session = sessions.find(s => s.hash.startsWith(options.session!));
      if (!session) {
        throw new Error(`Session not found: ${options.session}`);
      }
      sessionPath = session.path;
    } else {
      // Find latest session
      const latest = await SessionManager.findLatestSession(this.#planDir);
      if (!latest) {
        throw new Error('No sessions found');
      }
      sessionPath = latest.path;
    }

    // Load session state
    const manager = new SessionManager(this.#prdPath, this.#planDir);
    return await manager.loadSession(sessionPath);
  }

  /**
   * Extracts session directory path from file path
   *
   * @param filePath - File path (e.g., 'plan/001_hash/tasks.json')
   * @returns Session directory path
   *
   * @private
   */
  #extractSessionPath(filePath: string): string {
    const normalized = filePath.replace(/\\/g, '/');
    // If file is directly in a session directory
    const sessionMatch = normalized.match(/(plan\/\d{3}_[a-f0-9]{12})/);
    if (sessionMatch) {
      return resolve(sessionMatch[1]);
    }
    // Otherwise, use the parent directory
    return resolve(filePath, '..');
  }

  /**
   * Executes overview display
   *
   * @param sessionState - Session state to display
   * @param options - Command options
   *
   * @private
   */
  async #executeOverview(
    sessionState: SessionState,
    options: InspectorOptions
  ): Promise<void> {
    const output = this.#formatOverview(sessionState, options);
    console.log(output);
  }

  /**
   * Executes task detail display
   *
   * @param sessionState - Session state
   * @param taskId - Task ID to display details for
   * @param options - Command options
   * @throws {Error} If task not found
   *
   * @private
   */
  async #executeTaskDetail(
    sessionState: SessionState,
    taskId: string,
    options: InspectorOptions
  ): Promise<void> {
    const taskDetail = this.#getTaskDetail(sessionState, taskId);
    const output = this.#formatTaskDetail(taskDetail, options);
    console.log(output);
  }

  /**
   * Gets detailed information about a specific task
   *
   * @param sessionState - Session state
   * @param taskId - Task ID
   * @returns Task detail information
   * @throws {Error} If task not found
   *
   * @private
   */
  #getTaskDetail(sessionState: SessionState, taskId: string): TaskDetail {
    const task = findItem(sessionState.taskRegistry, taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    // Get dependencies if subtask
    let dependencies: HierarchyItem[] = [];
    let dependenciesSatisfied = true;
    if (isSubtask(task)) {
      dependencies = getDependencies(task, sessionState.taskRegistry);
      dependenciesSatisfied = dependencies.every(
        dep => dep.status === 'Complete'
      );
    }

    // Find PRP file
    const prpPath = join(sessionState.metadata.path, 'prps', `${taskId}.md`);
    const prpExists = existsSync(prpPath);

    // Find artifacts
    const artifactPath = join(sessionState.metadata.path, 'artifacts', taskId);
    const artifactExists = existsSync(artifactPath);

    // Check for errors
    let errorInfo: ErrorSummary | undefined;
    if (task.status === 'Failed') {
      errorInfo = {
        taskId: task.id,
        taskTitle: task.title,
        errorMessage: 'Task execution failed',
      };
    }

    return {
      task,
      dependencies,
      dependenciesSatisfied,
      prpPath,
      prpExists,
      artifactPath,
      artifactExists,
      errorInfo,
    };
  }

  /**
   * Formats overview output based on options
   *
   * @param sessionState - Session state to format
   * @param options - Command options
   * @returns Formatted output string
   *
   * @private
   */
  #formatOverview(
    sessionState: SessionState,
    options: InspectorOptions
  ): string {
    const { metadata, taskRegistry, currentItemId } = sessionState;
    const phases = taskRegistry.backlog;

    // Build output data
    const artifacts = this.#scanArtifacts(metadata.path, phases);
    const errors = this.#scanErrors(phases);
    const statusCounts = this.#countStatuses(phases);

    // Filter output based on options
    if (options.artifactsOnly) {
      return this.#formatSection(
        chalk.bold('Artifacts'),
        formatArtifactTable(artifacts)
      );
    }

    if (options.errorsOnly) {
      return this.#formatSection(
        chalk.bold('Errors'),
        formatErrorTable(errors)
      );
    }

    // Format based on output type
    switch (options.output) {
      case 'json':
        return JSON.stringify(
          {
            session: metadata,
            taskHierarchy: phases,
            currentTask: currentItemId
              ? findItem(taskRegistry, currentItemId)
              : undefined,
            artifacts,
            errors,
            statusCounts,
          } as InspectorOutput,
          null,
          2
        );

      case 'yaml':
        // Note: Using JSON as YAML placeholder since yaml library not installed
        // In production, would use: import YAML from 'yaml'; YAML.stringify(...)
        return JSON.stringify(
          {
            session: metadata,
            taskHierarchy: phases,
            currentTask: currentItemId
              ? findItem(taskRegistry, currentItemId)
              : undefined,
            artifacts,
            errors,
            statusCounts,
          } as InspectorOutput,
          null,
          2
        );

      case 'tree':
        return this.#formatTreeOutput(
          phases,
          currentItemId,
          artifacts,
          errors,
          statusCounts
        );

      case 'table':
      default:
        return this.#formatTableOutput(
          metadata,
          phases,
          currentItemId,
          artifacts,
          errors,
          statusCounts
        );
    }
  }

  /**
   * Formats table output for overview
   *
   * @param metadata - Session metadata
   * @param phases - Task phases
   * @param currentItemId - Current task ID
   * @param artifacts - Artifact locations
   * @param errors - Error summaries
   * @param statusCounts - Status counts
   * @returns Formatted table output
   *
   * @private
   */
  #formatTableOutput(
    metadata: {
      id: string;
      hash: string;
      path: string;
      createdAt: Date;
      parentSession: string | null;
    },
    phases: Phase[],
    currentItemId: string | null,
    artifacts: ArtifactLocation[],
    errors: ErrorSummary[],
    statusCounts: Record<string, number>
  ): string {
    const lines: string[] = [];

    // Header
    lines.push(
      chalk.bold.cyan(
        '\n═══════════════════════════════════════════════════════════════'
      )
    );
    lines.push(chalk.bold.cyan('  PRD Pipeline State Inspector'));
    lines.push(
      chalk.bold.cyan(
        '═══════════════════════════════════════════════════════════════\n'
      )
    );

    // Session Information
    lines.push(chalk.bold.yellow('Session Information'));
    lines.push(formatSessionTable(metadata));
    lines.push('');

    // Status Counts
    lines.push(chalk.bold.yellow('Task Status Summary'));
    lines.push(formatStatusCounts(statusCounts));
    lines.push('');

    // Current Task
    if (currentItemId) {
      const currentItem = findItem({ backlog: phases }, currentItemId);
      if (currentItem) {
        lines.push(chalk.bold.yellow('Current Task'));
        lines.push(
          formatCurrentTask(
            currentItem.id,
            currentItem.title,
            currentItem.status
          )
        );
        lines.push('');
      }
    }

    // Task Hierarchy (abbreviated for table view)
    lines.push(chalk.bold.yellow('Task Hierarchy'));
    lines.push(formatTaskHierarchyTable(phases, currentItemId ?? undefined));
    lines.push('');

    // Artifacts
    if (artifacts.length > 0) {
      lines.push(chalk.bold.yellow('Recent Artifacts'));
      lines.push(formatArtifactTable(artifacts));
      lines.push('');
    }

    // Errors
    if (errors.length > 0) {
      lines.push(chalk.bold.yellow('Error Summary'));
      lines.push(formatErrorTable(errors));
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Formats tree output for overview
   *
   * @param phases - Task phases
   * @param currentItemId - Current task ID
   * @param artifacts - Artifact locations
   * @param errors - Error summaries
   * @param statusCounts - Status counts
   * @returns Formatted tree output
   *
   * @private
   */
  #formatTreeOutput(
    phases: Phase[],
    currentItemId: string | null,
    artifacts: ArtifactLocation[],
    errors: ErrorSummary[],
    statusCounts: Record<string, number>
  ): string {
    const lines: string[] = [];

    // Header
    lines.push(
      chalk.bold.cyan(
        '\n═══════════════════════════════════════════════════════════════'
      )
    );
    lines.push(chalk.bold.cyan('  PRD Pipeline State Inspector (Tree View)'));
    lines.push(
      chalk.bold.cyan(
        '═══════════════════════════════════════════════════════════════\n'
      )
    );

    // Status Counts
    lines.push(chalk.bold.yellow('Task Status Summary'));
    lines.push(formatStatusCounts(statusCounts));
    lines.push('');

    // Task Tree (showing all tasks)
    lines.push(chalk.bold.yellow('Task Hierarchy (All)'));
    lines.push(renderTaskTree(phases, currentItemId ?? undefined));
    lines.push('');

    // Pending Tasks Tree
    lines.push(chalk.bold.yellow('Pending Tasks'));
    lines.push(renderPendingTree(phases, currentItemId ?? undefined));
    lines.push('');

    // Artifacts
    if (artifacts.length > 0) {
      lines.push(chalk.bold.yellow('Recent Artifacts'));
      lines.push(formatArtifactTable(artifacts));
      lines.push('');
    }

    // Errors
    if (errors.length > 0) {
      lines.push(chalk.bold.yellow('Error Summary'));
      lines.push(formatErrorTable(errors));
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Formats task detail output based on options
   *
   * @param taskDetail - Task detail information
   * @param options - Command options
   * @returns Formatted output string
   *
   * @private
   */
  #formatTaskDetail(taskDetail: TaskDetail, options: InspectorOptions): string {
    const {
      task,
      dependencies,
      dependenciesSatisfied,
      prpPath,
      prpExists,
      artifactPath,
      artifactExists,
      errorInfo,
    } = taskDetail;

    switch (options.output) {
      case 'json':
        return JSON.stringify(taskDetail, null, 2);

      case 'yaml':
        return JSON.stringify(taskDetail, null, 2);

      case 'tree':
      case 'table':
      default:
        return this.#formatTaskDetailTable(
          task,
          dependencies,
          dependenciesSatisfied,
          prpPath,
          prpExists,
          artifactPath,
          artifactExists,
          errorInfo,
          options.verbose
        );
    }
  }

  /**
   * Formats task detail as table
   *
   * @param task - Task item
   * @param dependencies - Task dependencies
   * @param dependenciesSatisfied - Whether dependencies are satisfied
   * @param prpPath - PRP file path
   * @param prpExists - Whether PRP exists
   * @param artifactPath - Artifact directory path
   * @param artifactExists - Whether artifacts exist
   * @param errorInfo - Error information
   * @param verbose - Whether to show verbose output
   * @returns Formatted table output
   *
   * @private
   */
  #formatTaskDetailTable(
    task: HierarchyItem,
    dependencies: HierarchyItem[],
    dependenciesSatisfied: boolean,
    prpPath: string | undefined,
    prpExists: boolean,
    artifactPath: string | undefined,
    artifactExists: boolean,
    errorInfo?: ErrorSummary,
    verbose?: boolean
  ): string {
    const lines: string[] = [];

    // Header
    lines.push(
      chalk.bold.cyan(
        '\n═══════════════════════════════════════════════════════════════'
      )
    );
    lines.push(chalk.bold.cyan(`  Task Details: ${task.id}`));
    lines.push(
      chalk.bold.cyan(
        '═══════════════════════════════════════════════════════════════\n'
      )
    );

    // Basic Info
    lines.push(chalk.bold.yellow('Task Information'));
    lines.push(`  ID:        ${chalk.bold(task.id)}`);
    lines.push(`  Type:      ${task.type}`);
    lines.push(`  Title:     ${task.title}`);
    lines.push(
      `  Status:    ${this.#getStatusIndicator(task.status)} ${task.status}`
    );
    if (isSubtask(task)) {
      lines.push(`  Points:    ${task.story_points}`);
    }
    lines.push('');

    // Dependencies
    if (dependencies.length > 0) {
      lines.push(chalk.bold.yellow('Dependencies'));
      for (const dep of dependencies) {
        const satisfied = dep.status === 'Complete';
        const statusIcon = satisfied ? chalk.green('✓') : chalk.red('✗');
        lines.push(`  ${statusIcon} ${dep.id}: ${dep.title} (${dep.status})`);
      }
      lines.push(
        `  All satisfied: ${dependenciesSatisfied ? chalk.green('Yes') : chalk.red('No')}`
      );
      lines.push('');
    }

    // PRP File
    lines.push(chalk.bold.yellow('PRP Document'));
    if (prpExists && prpPath) {
      lines.push(`  Path: ${prpPath}`);
      if (verbose) {
        const prpContent = readFileSync(prpPath, 'utf-8');
        lines.push('');
        lines.push(chalk.gray('─'.repeat(70)));
        lines.push(chalk.gray(prpContent.split('\n').slice(0, 20).join('\n')));
        if (prpContent.split('\n').length > 20) {
          lines.push(chalk.gray('... (truncated)'));
        }
        lines.push(chalk.gray('─'.repeat(70)));
      }
    } else {
      lines.push(`  ${chalk.gray('No PRP file found')}`);
    }
    lines.push('');

    // Artifacts
    lines.push(chalk.bold.yellow('Artifacts'));
    if (artifactExists && artifactPath) {
      lines.push(`  Path: ${artifactPath}`);
      try {
        const artifactFiles = readdirSync(artifactPath);
        if (artifactFiles.length > 0) {
          lines.push(`  Files:`);
          for (const file of artifactFiles) {
            lines.push(`    - ${file}`);
          }
        } else {
          lines.push(`  ${chalk.gray('Empty directory')}`);
        }
      } catch {
        lines.push(`  ${chalk.gray('Cannot read directory')}`);
      }
    } else {
      lines.push(`  ${chalk.gray('No artifacts found')}`);
    }
    lines.push('');

    // Error Info
    if (errorInfo) {
      lines.push(chalk.bold.yellow('Error Information'));
      lines.push(`  Message: ${chalk.red(errorInfo.errorMessage)}`);
      if (errorInfo.timestamp) {
        lines.push(`  Time:    ${errorInfo.timestamp}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Gets status indicator with color
   *
   * @param status - Status value
   * @returns Colored status indicator
   *
   * @private
   */
  #getStatusIndicator(status: Status): string {
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
    const indicator = indicatorMap[status];
    const color = colorMap[status];
    return color(indicator);
  }

  /**
   * Scans session directory for artifacts
   *
   * @param sessionPath - Session directory path
   * @param phases - Task phases
   * @returns Array of artifact locations
   *
   * @private
   */
  #scanArtifacts(sessionPath: string, _phases: Phase[]): ArtifactLocation[] {
    const artifacts: ArtifactLocation[] = [];
    const prpsDir = join(sessionPath, 'prps');
    const artifactsDir = join(sessionPath, 'artifacts');

    // Scan PRP files
    if (existsSync(prpsDir)) {
      try {
        const prpFiles = readdirSync(prpsDir);
        for (const file of prpFiles) {
          if (file.endsWith('.md')) {
            const taskId = file.replace('.md', '');
            artifacts.push({
              taskId,
              type: 'prp',
              path: join(prpsDir, file),
              exists: true,
            });
          }
        }
      } catch {
        // Directory not readable
      }
    }

    // Scan artifact directories
    if (existsSync(artifactsDir)) {
      try {
        const artifactDirs = readdirSync(artifactsDir);
        for (const dir of artifactDirs) {
          artifacts.push({
            taskId: dir,
            type: 'implementation',
            path: join(artifactsDir, dir),
            exists: true,
          });
        }
      } catch {
        // Directory not readable
      }
    }

    return artifacts;
  }

  /**
   * Scans for failed tasks
   *
   * @param phases - Task phases
   * @returns Array of error summaries
   *
   * @private
   */
  #scanErrors(phases: Phase[]): ErrorSummary[] {
    const errors: ErrorSummary[] = [];
    const failedItems = filterByStatus({ backlog: phases }, 'Failed');

    for (const item of failedItems) {
      errors.push({
        taskId: item.id,
        taskTitle: item.title,
        errorMessage: 'Task execution failed',
      });
    }

    return errors;
  }

  /**
   * Counts tasks by status
   *
   * @param phases - Task phases
   * @returns Record of status counts
   *
   * @private
   */
  #countStatuses(phases: Phase[]): Record<string, number> {
    const counts: Record<string, number> = {
      Planned: 0,
      Researching: 0,
      Implementing: 0,
      Retrying: 0,
      Complete: 0,
      Failed: 0,
      Obsolete: 0,
    };

    for (const phase of phases) {
      counts[phase.status]++;
      for (const milestone of phase.milestones) {
        counts[milestone.status]++;
        for (const task of milestone.tasks) {
          counts[task.status]++;
          for (const subtask of task.subtasks) {
            counts[subtask.status]++;
          }
        }
      }
    }

    return counts;
  }

  /**
   * Formats a section with header
   *
   * @param header - Section header
   * @param content - Section content
   * @returns Formatted section string
   *
   * @private
   */
  #formatSection(header: string, content: string): string {
    return `${header}\n${content}`;
  }
}
