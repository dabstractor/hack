/**
 * Validate-state command for PRD pipeline
 *
 * @module cli/commands/validate-state
 *
 * @remarks
 * Provides comprehensive state validation and repair capabilities for tasks.json.
 * Detects orphaned dependencies, circular dependencies, status inconsistencies,
 * and offers auto-repair with backup creation.
 *
 * @example
 * ```typescript
 * import { ValidateStateCommand } from './cli/commands/validate-state.js';
 *
 * const validateCommand = new ValidateStateCommand();
 * await validateCommand.execute({
 *   output: 'table',
 *   autoRepair: false,
 *   backup: true,
 *   maxBackups: 5
 * });
 * ```
 */

import { SessionManager } from '../../core/session-manager.js';
import type { SessionState, Backlog } from '../../core/models.js';
import {
  validateBacklogState,
  repairBacklog,
  createBackup,
  type StateValidationResult,
} from '../../core/state-validator.js';
import { readTasksJSON, writeTasksJSON } from '../../core/session-utils.js';
import { resolve, dirname } from 'node:path';
import chalk from 'chalk';
import { createInterface } from 'node:readline';
import { getLogger, type Logger } from '../../utils/logger.js';

let _logger: Logger | undefined;
const logger = (): Logger => (_logger ??= getLogger('ValidateStateCommand'));

/**
 * Options for validate-state command
 */
export interface ValidateStateOptions {
  /** Output format (table, json, yaml) */
  output: 'table' | 'json' | 'yaml';

  /** Override tasks.json file path */
  file?: string;

  /** Auto-repair without prompting */
  autoRepair: boolean;

  /** Create backup before repair (default: true) */
  backup: boolean;

  /** Maximum backups to keep (default: 5) */
  maxBackups: number;

  /** Session hash to validate (default: latest) */
  session?: string;
}

/**
 * Validate-state command handler class
 *
 * @remarks
 * Executes the validate-state command with various output formats and repair options.
 * Integrates with SessionManager for session discovery and loading.
 */
export class ValidateStateCommand {
  /** Default plan directory */
  readonly #planDir: string;

  /** Default PRD path */
  readonly #prdPath: string;

  /**
   * Creates a new ValidateStateCommand instance
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
   * Executes the validate-state command
   *
   * @param options - Command options
   * @throws {Error} If session not found or validation fails
   *
   * @example
   * ```typescript
   * const validateCommand = new ValidateStateCommand();
   * await validateCommand.execute({ output: 'table', autoRepair: false });
   * ```
   */
  async execute(options: ValidateStateOptions): Promise<void> {
    logger().debug({ options }, 'ValidateStateCommand.execute called');

    let backlog: Backlog;
    let sessionPath: string;

    // Handle custom file path or load session
    if (options.file) {
      // Load from specific file directly
      const filePath = resolve(options.file);
      sessionPath = dirname(filePath);
      backlog = await readTasksJSON(sessionPath);
    } else {
      // Load session normally
      const sessionState = await this.#loadSession(options);
      backlog = sessionState.taskRegistry;
      sessionPath = sessionState.metadata.path;
    }

    // Run validations
    const validation = this.#runValidations(backlog, options);

    // Output results
    this.#outputResults(validation, options);

    // Exit if valid
    if (validation.isValid) {
      process.exit(0);
    }

    // Handle repair
    const shouldRepair =
      options.autoRepair ||
      (process.stdin.isTTY && (await this.#promptForRepair(validation)));

    if (shouldRepair) {
      // Create backup
      const backupPath = options.backup
        ? await createBackup(
            resolve(sessionPath, 'tasks.json'),
            options.maxBackups
          )
        : undefined;

      // Perform repairs
      const repairResult = await repairBacklog(
        backlog,
        validation,
        backupPath!
      );

      if (repairResult.repaired) {
        console.log(
          chalk.green(`✓ Repaired ${repairResult.itemsRepaired} items`)
        );
        if (backupPath) {
          console.log(chalk.gray(`  Backup: ${backupPath}`));
        }

        // Write repaired backlog
        await writeTasksJSON(sessionPath, backlog);

        // Re-validate
        const revalidation = this.#runValidations(backlog, options);
        if (revalidation.isValid) {
          console.log(chalk.green('✓ State is now valid'));
        }
      }
    }

    // Exit with error code
    process.exit(validation.isValid ? 0 : 1);
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
  async #loadSession(options: ValidateStateOptions): Promise<SessionState> {
    const manager = new SessionManager(this.#prdPath, this.#planDir);

    if (options.file) {
      // Load from specific file
      const sessionPath = resolve(options.file, '..');
      return await manager.loadSession(sessionPath);
    } else if (options.session) {
      // Find session by hash
      const sessions = await SessionManager.listSessions(this.#planDir);
      const session = sessions.find(s => s.hash.startsWith(options.session!));
      if (!session) {
        throw new Error(`Session not found: ${options.session}`);
      }
      return await manager.loadSession(session.path);
    } else {
      // Load latest session
      const latest = await SessionManager.findLatestSession(this.#planDir);
      if (!latest) {
        throw new Error('No sessions found');
      }
      return await manager.loadSession(latest.path);
    }
  }

  /**
   * Runs validation on the backlog
   *
   * @param backlog - Backlog to validate
   * @param _options - Command options
   * @returns Validation result
   *
   * @private
   */
  #runValidations(
    backlog: import('../../core/models.js').Backlog,
    _options: ValidateStateOptions
  ): StateValidationResult {
    return validateBacklogState(backlog);
  }

  /**
   * Outputs validation results based on format
   *
   * @param validation - Validation result
   * @param options - Command options
   *
   * @private
   */
  #outputResults(
    validation: StateValidationResult,
    options: ValidateStateOptions
  ): void {
    if (options.output === 'json') {
      console.log(JSON.stringify(validation, null, 2));
    } else if (options.output === 'yaml') {
      // Note: Using JSON as YAML placeholder since yaml library not installed
      // In production, would use: import YAML from 'yaml'; YAML.stringify(...)
      console.log(JSON.stringify(validation, null, 2));
    } else {
      console.log(this.#formatTableOutput(validation));
    }
  }

  /**
   * Formats validation result as table output
   *
   * @param validation - Validation result
   * @returns Formatted table output
   *
   * @private
   */
  #formatTableOutput(validation: StateValidationResult): string {
    const lines: string[] = [];

    lines.push(
      chalk.bold.cyan('\n═════════════════════════════════════════════════════')
    );
    lines.push(chalk.bold.cyan('  State Validation Results'));
    lines.push(
      chalk.bold.cyan('═════════════════════════════════════════════════════\n')
    );

    // Status
    const statusIcon = validation.isValid ? chalk.green('✓') : chalk.red('✗');
    const statusText = validation.isValid ? 'Valid' : 'Invalid';
    lines.push(`Status: ${statusIcon} ${statusText}`);
    lines.push(
      `Errors: ${chalk.red(validation.summary.totalErrors.toString())}`
    );
    lines.push(
      `Warnings: ${chalk.yellow(validation.summary.totalWarnings.toString())}`
    );
    lines.push('');

    // Schema errors
    if (validation.schemaErrors && validation.schemaErrors.length > 0) {
      lines.push(chalk.bold.red('Schema Errors:'));
      for (const error of validation.schemaErrors) {
        for (const issue of error.issues) {
          lines.push(
            chalk.red(`  ✗ ${issue.path.join('.')}: ${issue.message}`)
          );
        }
      }
      lines.push('');
    }

    // Orphaned dependencies
    if (
      validation.orphanedDependencies &&
      validation.orphanedDependencies.length > 0
    ) {
      lines.push(chalk.bold.red('Orphaned Dependencies:'));
      for (const orphan of validation.orphanedDependencies) {
        lines.push(
          chalk.red(
            `  ✗ ${orphan.taskId} depends on non-existent ${orphan.missingTaskId}`
          )
        );
      }
      lines.push('');
    }

    // Circular dependencies
    if (
      validation.circularDependencies &&
      validation.circularDependencies.length > 0
    ) {
      lines.push(chalk.bold.red('Circular Dependencies:'));
      for (const cycle of validation.circularDependencies) {
        lines.push(chalk.red(`  ✗ ${cycle.cycleString}`));
      }
      lines.push('');
    }

    // Status inconsistencies
    if (
      validation.statusInconsistencies &&
      validation.statusInconsistencies.length > 0
    ) {
      lines.push(chalk.bold.yellow('Status Inconsistencies:'));
      for (const inc of validation.statusInconsistencies) {
        lines.push(
          chalk.yellow(
            `  ⚠ ${inc.parentId} is Complete but ${inc.childId} is ${inc.childStatus}`
          )
        );
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Prompts user for repair confirmation
   *
   * @param _validation - Validation result
   * @returns Promise resolving to user's choice
   *
   * @private
   */
  async #promptForRepair(_validation: StateValidationResult): Promise<boolean> {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const question = (prompt: string): Promise<string> =>
      new Promise(resolve => rl.question(prompt, resolve));

    const answer = await question('\nAttempt auto-repair? (y/N): ');
    rl.close();

    return answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes';
  }
}
