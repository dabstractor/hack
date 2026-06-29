/**
 * CLI argument parser for PRP Pipeline
 *
 * @module cli/index
 *
 * @remarks
 * Provides command-line argument parsing and validation for the PRP Pipeline.
 * Uses Commander.js for robust parsing with type safety via TypeScript.
 *
 * Validates:
 * - PRD file exists before execution
 * - Scope string format (if provided)
 * - Mode is one of allowed choices
 *
 * @example
 * ```typescript
 * import { parseCLIArgs } from './cli/index.js';
 *
 * const args = parseCLIArgs();
 * console.log(`PRD: ${args.prd}`);
 * console.log(`Mode: ${args.mode}`);
 * if (args.scope) {
 *   console.log(`Scope: ${args.scope}`);
 * }
 * ```
 */

import { Command } from 'commander';
import { parseScope, ScopeParseError } from '../core/scope-resolver.js';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { getLogger, type Logger } from '../utils/logger.js';
import { InspectCommand, type InspectorOptions } from './commands/inspect.js';
import { ArtifactsCommand } from './commands/artifacts.js';
import { ValidateStateCommand } from './commands/validate-state.js';
import { CacheCommand, type CacheOptions } from './commands/cache.js';
import * as os from 'node:os';
import ms from 'ms';

let _logger: Logger | undefined;
const logger = (): Logger => (_logger ??= getLogger('CLI'));

// ===== TYPE DEFINITIONS =====

/**
 * Parsed CLI arguments
 *
 * @remarks
 * All options are fully typed for compile-time safety.
 * Defaults are applied for unspecified options.
 *
 * @property prd - Path to PRD markdown file (required)
 * @property scope - Optional scope identifier (e.g., "P3.M4")
 * @property mode - Execution mode: normal, bug-hunt, or validate
 * @property continue - Resume from previous session
 * @property dryRun - Show plan without executing
 * @property logLevel - Log level: trace, debug, info, warn, error, fatal
 * @property verbose - Enable debug logging (deprecated: use --log-level debug)
 * @property machineReadable - Enable machine-readable JSON output
 * @property progressMode - Progress display mode: auto, always, or never
 */
export interface CLIArgs {
  /** Path to PRD markdown file */
  prd: string;

  /** Optional scope to limit execution (e.g., "P3.M4") */
  scope?: string;

  /** Execution mode */
  mode: 'normal' | 'delta' | 'bug-hunt' | 'validate';

  /** Resume from previous session */
  continue: boolean;

  /** Show plan without executing */
  dryRun: boolean;

  /** Log level: trace, debug, info, warn, error, fatal - may be string from commander */
  logLevel?: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | string;

  /** Enable debug logging */
  verbose: boolean;

  /** Enable machine-readable JSON output */
  machineReadable: boolean;

  /** Bypass PRP cache and regenerate all PRPs */
  noCache: boolean;

  /** Treat all errors as non-fatal and continue pipeline execution */
  continueOnError: boolean;

  /** Validate PRD syntax and structure without executing */
  validatePrd: boolean;

  /** Maximum number of tasks to execute (optional) */
  maxTasks?: number;

  /** Maximum execution duration in milliseconds (optional) */
  maxDuration?: number;

  /** Monitoring interval in milliseconds (1000-60000, default: 30000) */
  monitorInterval?: number;

  /** Monitor resources every Nth task (1-100, default: 1) */
  monitorTaskInterval?: number;

  /** Disable resource monitoring entirely */
  noResourceMonitor?: boolean;

  /** Progress display mode (auto/always/never) */
  progressMode?: 'auto' | 'always' | 'never';

  /** PRP compression level (off/standard/aggressive) - may be string from commander */
  prpCompression?: 'off' | 'standard' | 'aggressive' | string;

  /** Max concurrent subtasks (1-10, default: 2) - may be string from commander */
  parallelism: number | string;

  /** Max concurrent research tasks (1-10, default: 3) - may be string from commander */
  researchConcurrency: number | string;

  /** Max retry attempts for transient errors (0-10, default: 3) - may be string from commander */
  taskRetry?: number | string;

  /** Base delay before first retry in ms (100-60000, default: 1000) - may be string from commander */
  retryBackoff?: number | string;

  /** Enable automatic retry for all tasks (default: true, --no-retry sets to false) */
  retry: boolean;

  /** Max retries for batch write failures (0-10, default: 3) - may be string from commander */
  flushRetries?: number | string;

  /** PRP cache TTL duration (e.g., "24h", "1d", "12h") - may be string from commander */
  cacheTtl?: string;

  /** Auto-clean expired cache on startup */
  cachePrune?: boolean;

  /** Path to output metrics JSON file */
  metricsOutput?: string;
}

/**
 * Validated CLI arguments where parallelism is guaranteed to be a number
 *
 * @remarks
 * This is the type returned by parseCLIArgs() after validation.
 * The parallelism value is parsed and validated as a number.
 * The logLevel value is validated as a proper log level string.
 */
export interface ValidatedCLIArgs extends Omit<
  CLIArgs,
  | 'parallelism'
  | 'researchConcurrency'
  | 'taskRetry'
  | 'retryBackoff'
  | 'retry'
  | 'flushRetries'
  | 'cacheTtl'
  | 'monitorTaskInterval'
  | 'noResourceMonitor'
  | 'prpCompression'
  | 'logLevel'
  | 'metricsOutput'
> {
  /** Max concurrent subtasks (1-10, default: 2) - validated as number */
  parallelism: number;

  /** Max concurrent research tasks (1-10, default: 3) - validated as number */
  researchConcurrency: number;

  /** Max retry attempts for transient errors (0-10, default: 3) - validated as number or undefined */
  taskRetry?: number;

  /** Base delay before first retry in ms (100-60000, default: 1000) - validated as number or undefined */
  retryBackoff?: number;

  /** Disable automatic retry for all tasks (computed from --retry/--no-retry) */
  noRetry: boolean;

  /** Max retries for batch write failures (0-10, default: 3) - validated as number */
  flushRetries?: number;

  /** PRP cache TTL in milliseconds - validated as number */
  cacheTtl: number;

  /** Monitor resources every Nth task (1-100, default: 1) - validated as number */
  monitorTaskInterval: number;

  /** Disable resource monitoring entirely - validated as boolean */
  noResourceMonitor: boolean;

  /** PRP compression level - validated as 'off' | 'standard' | 'aggressive' */
  prpCompression: 'off' | 'standard' | 'aggressive';

  /** Log level - validated as 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' */
  logLevel: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

  /** Path to output metrics JSON file */
  metricsOutput?: string;
}

// ===== MAIN FUNCTION =====

/**
 * Parses CLI arguments into typed configuration
 *
 * @returns Parsed and validated CLI arguments
 * @throws {Error} If PRD file doesn't exist
 * @throws {ScopeParseError} If scope string is invalid
 *
 * @remarks
 * Uses Commander.js to parse process.argv and validate options.
 * Performs additional validation:
 * - Checks PRD file exists
 * - Parses scope string using ScopeResolver
 *
 * Exits with code 1 on validation failures.
 *
 * Supports subcommands:
 * - No subcommand: Default pipeline execution (legacy behavior)
 * - `inspect`: Inspect pipeline state and session details
 * - `artifacts`: View and compare pipeline artifacts
 * - `validate-state`: Validate task hierarchy state and dependencies
 *
 * @example
 * ```typescript
 * // Legacy pipeline execution
 * const args = parseCLIArgs();
 * const pipeline = new PRPPipeline(args.prd);
 * await pipeline.run();
 *
 * // Or use inspect subcommand
 * // CLI: prp-pipeline inspect
 *
 * // Or use artifacts subcommand
 * // CLI: prp-pipeline artifacts list
 * ```
 */
export function parseCLIArgs():
  | ValidatedCLIArgs
  | { subcommand: 'inspect'; options: InspectorOptions }
  | { subcommand: 'artifacts'; options: Record<string, unknown> }
  | { subcommand: 'validate-state'; options: Record<string, unknown> }
  | { subcommand: 'cache'; options: CacheOptions }
  | { subcommand: 'task'; options: Record<string, unknown> } {
  const program = new Command();

  // Configure program
  program
    .name('prp-pipeline')
    .description('PRD to PRP Pipeline - Automated software development')
    .version('1.0.0')
    // Required options
    .option('-p, --prd <path>', 'Path to PRD markdown file', './PRD.md')
    // Optional options
    .option('-s, --scope <scope>', 'Scope identifier (e.g., P3.M4, P3.M4.T2)')
    // Mode with choices
    .addOption(
      program
        .createOption('-m, --mode <mode>', 'Execution mode')
        .choices(['normal', 'delta', 'bug-hunt', 'validate'])
        .default('normal')
    )
    // Boolean flags with explicit defaults
    .option('-c, --continue', 'Resume from previous session', false)
    .option('-d, --dry-run', 'Show plan without executing', false)
    .option(
      '-v, --verbose',
      'Enable debug logging (deprecated: use --log-level debug)',
      false
    )
    // Log level with choices and environment variable
    .addOption(
      program
        .createOption(
          '--log-level <level>',
          'Minimum log level (env: HACKY_LOG_LEVEL)'
        )
        .choices(['trace', 'debug', 'info', 'warn', 'error', 'fatal'])
        .default(process.env.HACKY_LOG_LEVEL ?? 'info')
    )
    .option('--machine-readable', 'Enable machine-readable JSON output', false)
    .option('--no-cache', 'Bypass cache and regenerate all PRPs', false)
    .option('--continue-on-error', 'Treat all errors as non-fatal', false)
    .option(
      '--validate-prd',
      'Validate PRD and exit without running pipeline',
      false
    )
    .option('--max-tasks <number>', 'Maximum number of tasks to execute')
    .option('--max-duration <ms>', 'Maximum execution duration in milliseconds')
    .option(
      '--monitor-interval <ms>',
      'Resource monitoring interval in milliseconds (1000-60000, default: 30000)'
    )
    .option(
      '--monitor-task-interval <n>',
      'Monitor resources every Nth task (1-100, default: 1, env: MONITOR_TASK_INTERVAL)',
      process.env.MONITOR_TASK_INTERVAL ?? '1'
    )
    .option(
      '--no-resource-monitor',
      'Disable resource monitoring entirely',
      false
    )
    .option(
      '--parallelism <n>',
      'Max concurrent subtasks (1-10, default: 2)',
      '2'
    )
    .option(
      '--research-concurrency <n>',
      'Max concurrent research tasks (1-10, default: 3, env: RESEARCH_QUEUE_CONCURRENCY)',
      process.env.RESEARCH_QUEUE_CONCURRENCY ?? '3'
    )
    .option(
      '--task-retry <n>',
      'Max retry attempts for transient errors (0-10, default: 3, env: HACKY_TASK_RETRY_MAX_ATTEMPTS)',
      process.env.HACKY_TASK_RETRY_MAX_ATTEMPTS ?? '3'
    )
    .option(
      '--retry-backoff <ms>',
      'Base delay before first retry in ms (100-60000, default: 1000)',
      '1000'
    )
    .option(
      '--flush-retries <n>',
      'Max retries for batch write failures (0-10, default: 3, env: HACKY_FLUSH_RETRIES)',
      process.env.HACKY_FLUSH_RETRIES ?? '3'
    )
    .option(
      '--cache-ttl <duration>',
      'PRP cache time-to-live (e.g., 24h, 1d, 12h, env: HACKY_PRP_CACHE_TTL)',
      process.env.HACKY_PRP_CACHE_TTL ?? '24h'
    )
    .option('--cache-prune', 'Auto-clean expired cache on startup', false)
    .option('--metrics-output <path>', 'Path to output metrics JSON file')
    .option(
      '--prp-compression <level>',
      'PRP compression level (off|standard|aggressive, default: standard)',
      'standard'
    )
    .option(
      '--retry',
      'Enable automatic retry for all tasks (default: enabled)',
      true
    )
    .option('--no-retry', 'Disable automatic retry for all tasks', false)
    // Progress mode with choices
    .addOption(
      program
        .createOption('--progress-mode <mode>', 'Progress display mode')
        .choices(['auto', 'always', 'never'])
        .default('auto')
    )
    // Default action when no subcommand is given - enables running with just options
    .action(() => {
      // No-op: actual execution happens in main() after parseCLIArgs() returns
    });

  // Add inspect subcommand
  program
    .command('inspect')
    .description('Inspect pipeline state and session details')
    .option(
      '-o, --output <format>',
      'Output format (table, json, yaml, tree)',
      'table'
    )
    .option('--task <id>', 'Show detailed information for specific task')
    .option('-f, --file <path>', 'Override tasks.json file path')
    .option('--session <id>', 'Inspect specific session by hash')
    .option('-v, --verbose', 'Show verbose output', false)
    .option('--artifacts', 'Show only artifact information', false)
    .option('--errors', 'Show only error information', false)
    .action(async options => {
      try {
        const inspectCommand = new InspectCommand();
        await inspectCommand.execute(options as InspectorOptions);
        // Exit successfully after inspect
        process.exit(0);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        logger().error(`Inspect command failed: ${errorMessage}`);
        process.exit(1);
      }
    });

  // Add artifacts subcommand
  program
    .command('artifacts')
    .description('View and compare pipeline artifacts')
    .argument('[action]', 'Action: list, view, diff', 'list')
    .option('--session <id>', 'Session ID')
    .option('--task <id>', 'Task ID (for view)')
    .option('--task1 <id>', 'First task ID (for diff)')
    .option('--task2 <id>', 'Second task ID (for diff)')
    .option('-o, --output <format>', 'Output format: table, json', 'table')
    .option('--no-color', 'Disable colored output')
    .action(async (action, options) => {
      try {
        const planDir = resolve('plan');
        const prdPath = resolve('PRD.md');
        const artifactsCommand = new ArtifactsCommand(planDir, prdPath);
        await artifactsCommand.execute(action, options);
        // Exit successfully after artifacts
        process.exit(0);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        logger().error(`Artifacts command failed: ${errorMessage}`);
        process.exit(1);
      }
    });

  // Add validate-state subcommand
  program
    .command('validate-state')
    .description('Validate task hierarchy state and dependencies')
    .option(
      '-o, --output <format>',
      'Output format (table, json, yaml)',
      'table'
    )
    .option('-f, --file <path>', 'Override tasks.json file path')
    .option('--auto-repair', 'Automatically repair without prompting', false)
    .option('--no-backup', 'Skip backup creation before repair', false)
    .option('--max-backups <n>', 'Maximum backups to keep', '5')
    .option('-s, --session <hash>', 'Validate specific session by hash')
    .action(async options => {
      try {
        const validateCommand = new ValidateStateCommand();
        await validateCommand.execute({
          output: options.output || 'table',
          file: options.file,
          autoRepair: options.autoRepair || false,
          backup: options.backup !== false,
          maxBackups: parseInt(options.maxBackups || '5', 10),
          session: options.session,
        });
        process.exit(0);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        logger().error(`Validate-state command failed: ${errorMessage}`);
        process.exit(1);
      }
    });

  // Add cache subcommand
  program
    .command('cache')
    .description('Cache management operations')
    .argument('[action]', 'Action: stats, clean, clear', 'stats')
    .option('--force', 'Force action without confirmation', false)
    .option('--dry-run', 'Show what would be done without executing', false)
    .option('-o, --output <format>', 'Output format: table, json', 'table')
    .option('--session <id>', 'Session ID')
    .action(async (action, options) => {
      try {
        const planDir = resolve('plan');
        const prdPath = resolve('PRD.md');
        const cacheCommand = new CacheCommand(planDir, prdPath);
        await cacheCommand.execute(action, options);
        process.exit(0);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        logger().error(`Cache command failed: ${errorMessage}`);
        process.exit(1);
      }
    });

  // Add task subcommand (PRD §5.3)
  program
    .command('task')
    .description('Display and query pipeline tasks')
    .argument('[action]', 'Action: (none), next, status', '')
    .option('-f, --file <path>', 'Override tasks.json file path')
    .option('-o, --output <format>', 'Output format (table, json)', 'table')
    .action(async (action, options) => {
      try {
        const { readFile } = await import('node:fs/promises');
        const planDir = resolve('plan');
        const tasksFile = options.file
          ? resolve(options.file)
          : resolve(planDir, 'tasks.json');

        const content = await readFile(tasksFile, 'utf-8');
        const data = JSON.parse(content);

        if (action === 'next') {
          // Find next executable task (first Planned subtask)
          const findNext = (items: any[]): any => {
            for (const item of items) {
              if (item.type === 'Subtask' && item.status === 'Planned') {
                return item;
              }
              if (item.subtasks) {
                const found = findNext(item.subtasks);
                if (found) return found;
              }
              if (item.tasks) {
                const found = findNext(item.tasks);
                if (found) return found;
              }
              if (item.milestones) {
                const found = findNext(item.milestones);
                if (found) return found;
              }
            }
            return null;
          };
          const next = findNext(data.backlog || []);
          if (next) {
            if (options.output === 'json') {
              console.log(JSON.stringify(next, null, 2));
            } else {
              console.log(`Next task: ${next.id}`);
              console.log(`  Title: ${next.title}`);
              console.log(`  Status: ${next.status}`);
            }
          } else {
            console.log('No tasks remaining.');
          }
        } else if (action === 'status') {
          // Count tasks by status
          const counts: Record<string, number> = {};
          const countByStatus = (items: any[]) => {
            for (const item of items) {
              counts[item.status] = (counts[item.status] || 0) + 1;
              if (item.subtasks) countByStatus(item.subtasks);
              if (item.tasks) countByStatus(item.tasks);
              if (item.milestones) countByStatus(item.milestones);
            }
          };
          countByStatus(data.backlog || []);
          if (options.output === 'json') {
            console.log(JSON.stringify(counts, null, 2));
          } else {
            console.log('Task status summary:');
            for (const [status, count] of Object.entries(counts)) {
              console.log(`  ${status}: ${count}`);
            }
          }
        } else {
          // Default: list all tasks
          const listItems = (items: any[], indent = 0) => {
            for (const item of items) {
              const prefix = '  '.repeat(indent);
              const statusIcon =
                item.status === 'Complete'
                  ? '✅'
                  : item.status === 'Implementing'
                    ? '🔄'
                    : item.status === 'Blocked'
                      ? '🚫'
                      : '⬜';
              console.log(
                `${prefix}${statusIcon} [${item.id}] ${item.title} (${item.status})`
              );
              if (item.subtasks) listItems(item.subtasks, indent + 1);
              if (item.tasks) listItems(item.tasks, indent + 1);
              if (item.milestones) listItems(item.milestones, indent + 1);
            }
          };
          listItems(data.backlog || []);
        }
        process.exit(0);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        logger().error(`Task command failed: ${errorMessage}`);
        process.exit(1);
      }
    });

  // Parse arguments
  program.parse(process.argv);

  // Check if a subcommand was invoked
  const args = process.argv.slice(2);
  if (args.length > 0 && args[0] === 'inspect') {
    // Inspect subcommand was invoked and already handled by action()
    // This return is for type safety; actual execution already happened
    return {
      subcommand: 'inspect',
      options: {
        output: 'table',
        verbose: false,
        artifactsOnly: false,
        errorsOnly: false,
      },
    };
  }
  if (args.length > 0 && args[0] === 'artifacts') {
    // Artifacts subcommand was invoked and already handled by action()
    // This return is for type safety; actual execution already happened
    return {
      subcommand: 'artifacts',
      options: {},
    };
  }
  if (args.length > 0 && args[0] === 'validate-state') {
    // Validate-state subcommand was invoked and already handled by action()
    // This return is for type safety; actual execution already happened
    return {
      subcommand: 'validate-state',
      options: {},
    };
  }
  if (args.length > 0 && args[0] === 'cache') {
    // Cache subcommand was invoked and already handled by action()
    // This return is for type safety; actual execution already happened
    return {
      subcommand: 'cache',
      options: {
        output: 'table',
        force: false,
        dryRun: false,
      },
    };
  }
  if (args.length > 0 && args[0] === 'task') {
    // Task subcommand was invoked and already handled by action()
    return {
      subcommand: 'task',
      options: {},
    };
  }

  // Get typed options for default pipeline execution
  const options = program.opts<CLIArgs>();

  // Validate PRD file exists
  if (!existsSync(options.prd)) {
    logger().error(`PRD file not found: ${options.prd}`);
    logger().error('Please provide a valid PRD file path using --prd');
    process.exit(1);
  }

  // Validate scope format if provided
  if (options.scope !== undefined && options.scope.trim() !== '') {
    try {
      parseScope(options.scope);
      // Scope is valid, continue
    } catch (error) {
      if (error instanceof ScopeParseError) {
        logger().error(`Invalid scope "${options.scope}"`);
        logger().error(
          `Expected format: P1, P1.M1, P1.M1.T1, P1.M1.T1.S1, or all`
        );
        logger().error(`Details: ${error.message}`);
        process.exit(1);
      }
      // Re-throw unexpected errors
      throw error;
    }
  }

  // Validate maxTasks
  if (options.maxTasks !== undefined) {
    if (!Number.isInteger(options.maxTasks) || options.maxTasks <= 0) {
      logger().error('--max-tasks must be a positive integer');
      process.exit(1);
    }
  }

  // Validate maxDuration
  if (options.maxDuration !== undefined) {
    if (!Number.isInteger(options.maxDuration) || options.maxDuration <= 0) {
      logger().error(
        '--max-duration must be a positive integer (milliseconds)'
      );
      process.exit(1);
    }
  }

  // Validate monitorInterval
  if (options.monitorInterval !== undefined) {
    const monitorInterval = Number(options.monitorInterval);
    if (
      !Number.isInteger(monitorInterval) ||
      monitorInterval < 1000 ||
      monitorInterval > 60000
    ) {
      logger().error(
        '--monitor-interval must be an integer between 1000 and 60000'
      );
      process.exit(1);
    }
    // Convert to number
    options.monitorInterval = monitorInterval;
  }

  // Validate monitor-task-interval
  if (options.monitorTaskInterval !== undefined) {
    const monitorTaskIntervalStr = String(options.monitorTaskInterval);
    const monitorTaskInterval = parseInt(monitorTaskIntervalStr, 10);

    if (
      isNaN(monitorTaskInterval) ||
      monitorTaskInterval < 1 ||
      monitorTaskInterval > 100
    ) {
      logger().error(
        '--monitor-task-interval must be an integer between 1 and 100'
      );
      process.exit(1);
    }
    options.monitorTaskInterval = monitorTaskInterval;
  } else {
    // Set default to 1 (every task)
    options.monitorTaskInterval = 1;
  }

  // Normalize no-resource-monitor (boolean flag)
  if (options.noResourceMonitor === undefined) {
    options.noResourceMonitor = false;
  }

  // Validate parallelism
  const parallelismStr =
    typeof options.parallelism === 'string'
      ? options.parallelism
      : String(options.parallelism);
  const parallelism = parseInt(parallelismStr, 10);

  if (isNaN(parallelism) || parallelism < 1 || parallelism > 10) {
    logger().error('--parallelism must be an integer between 1 and 10');
    process.exit(1);
  }

  // System resource warnings (non-blocking)
  const cpuCores = os.cpus().length;
  const freeMemoryGB = os.freemem() / 1024 ** 3;

  if (parallelism > cpuCores) {
    logger().warn(
      `⚠️  Warning: Parallelism (${parallelism}) exceeds CPU cores (${cpuCores})`
    );
    logger().warn(`   This may cause context switching overhead.`);
    logger().warn(`   Recommended: --parallelism ${Math.max(1, cpuCores - 1)}`);
  }

  // Memory warning
  const estimatedMemoryGB = parallelism * 0.5; // Assume 500MB per worker
  if (estimatedMemoryGB > freeMemoryGB * 0.8) {
    logger().warn(
      `⚠️  Warning: High parallelism may exhaust free memory (${freeMemoryGB.toFixed(1)}GB available)`
    );
  }

  // Store validated number value
  options.parallelism = parallelism;

  // Validate research-concurrency
  const researchConcurrencyStr =
    typeof options.researchConcurrency === 'string'
      ? options.researchConcurrency
      : String(options.researchConcurrency);
  const researchConcurrency = parseInt(researchConcurrencyStr, 10);

  if (
    isNaN(researchConcurrency) ||
    researchConcurrency < 1 ||
    researchConcurrency > 10
  ) {
    logger().error(
      '--research-concurrency must be an integer between 1 and 10'
    );
    process.exit(1);
  }

  // System resource warnings (non-blocking)
  if (researchConcurrency > cpuCores) {
    logger().warn(
      `⚠️  Warning: Research concurrency (${researchConcurrency}) exceeds CPU cores (${cpuCores})`
    );
    logger().warn(`   This may cause context switching overhead.`);
  }

  // Memory warning (lighter than task executor - 300MB per task)
  const estimatedResearchMemoryGB = researchConcurrency * 0.3;
  if (estimatedResearchMemoryGB > freeMemoryGB * 0.8) {
    logger().warn(
      `⚠️  Warning: High research concurrency may exhaust free memory (${freeMemoryGB.toFixed(1)}GB available)`
    );
  }

  // Store validated number value
  options.researchConcurrency = researchConcurrency;

  // Validate task-retry
  if (options.taskRetry !== undefined) {
    const taskRetryStr = String(options.taskRetry);
    const taskRetry = parseInt(taskRetryStr, 10);

    if (isNaN(taskRetry) || taskRetry < 0 || taskRetry > 10) {
      logger().error('--task-retry must be an integer between 0 and 10');
      process.exit(1);
    }

    // Convert to number
    options.taskRetry = taskRetry;
  }

  // Validate retry-backoff
  if (options.retryBackoff !== undefined) {
    const retryBackoffStr = String(options.retryBackoff);
    const retryBackoff = parseInt(retryBackoffStr, 10);

    if (isNaN(retryBackoff) || retryBackoff < 100 || retryBackoff > 60000) {
      logger().error(
        '--retry-backoff must be an integer between 100 and 60000'
      );
      process.exit(1);
    }

    // Convert to number
    options.retryBackoff = retryBackoff;
  }

  // Validate flush-retries
  if (options.flushRetries !== undefined) {
    const flushRetriesStr = String(options.flushRetries);
    const flushRetries = parseInt(flushRetriesStr, 10);

    if (isNaN(flushRetries) || flushRetries < 0 || flushRetries > 10) {
      logger().error('--flush-retries must be an integer between 0 and 10');
      process.exit(1);
    }

    // Convert to number
    options.flushRetries = flushRetries;
  }

  // Validate cache-ttl
  let validatedCacheTtl: number;
  if (options.cacheTtl !== undefined) {
    const cacheTtlStr = String(options.cacheTtl);
    // Cast to StringValue type for ms function
    const cacheTtlResult = ms(cacheTtlStr as ms.StringValue);

    // CRITICAL: ms returns number when passed a string
    if (typeof cacheTtlResult !== 'number') {
      logger().error(`Invalid duration format: "${cacheTtlStr}"`);
      logger().error('Expected formats: 30s, 5m, 1h, 1d, etc.');
      process.exit(1);
    }

    const cacheTtlMs = cacheTtlResult;

    // Validate minimum (1 minute)
    if (cacheTtlMs < 60000) {
      logger().error('--cache-ttl must be at least 1 minute');
      process.exit(1);
    }

    // Validate maximum (30 days)
    const maxTtl = ms('30d' as ms.StringValue);
    if (cacheTtlMs > maxTtl) {
      logger().error('--cache-ttl cannot exceed 30 days');
      process.exit(1);
    }

    validatedCacheTtl = cacheTtlMs;
  } else {
    // Set default if not provided (24 hours)
    validatedCacheTtl = ms('24h' as ms.StringValue);
  }

  // Set default for cachePrune if not provided
  if (options.cachePrune === undefined) {
    options.cachePrune = false;
  }

  // Validate prpCompression
  let validatedPrpCompression: 'off' | 'standard' | 'aggressive';
  if (options.prpCompression !== undefined) {
    const validLevels = ['off', 'standard', 'aggressive'];
    const prpCompressionStr = String(options.prpCompression).toLowerCase();
    if (!validLevels.includes(prpCompressionStr)) {
      logger().error(
        `Invalid --prp-compression value: "${options.prpCompression}". Must be one of: ${validLevels.join(', ')}`
      );
      process.exit(1);
    }
    validatedPrpCompression = prpCompressionStr as
      | 'off'
      | 'standard'
      | 'aggressive';
  } else {
    validatedPrpCompression = 'standard'; // Default
  }

  // Compute noRetry from retry (invert the boolean)
  const noRetry = !options.retry;

  // Validate and normalize log level
  let validatedLogLevel:
    | 'trace'
    | 'debug'
    | 'info'
    | 'warn'
    | 'error'
    | 'fatal';
  if (options.logLevel !== undefined) {
    const logLevelStr = String(options.logLevel).toLowerCase();
    const validLevels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
    if (!validLevels.includes(logLevelStr)) {
      logger().error(
        `Invalid --log-level value: "${options.logLevel}". Must be one of: ${validLevels.join(', ')}`
      );
      process.exit(1);
    }
    validatedLogLevel = logLevelStr as
      | 'trace'
      | 'debug'
      | 'info'
      | 'warn'
      | 'error'
      | 'fatal';
  } else {
    validatedLogLevel = 'info'; // Default
  }

  return {
    ...options,
    noRetry,
    cacheTtl: validatedCacheTtl,
    prpCompression: validatedPrpCompression,
    logLevel: validatedLogLevel,
  } as ValidatedCLIArgs;
}

/**
 * Type guard to check if parsed args are CLIArgs (not a subcommand)
 *
 * @param args - Parsed args to check
 * @returns True if args is CLIArgs
 *
 * @example
 * ```typescript
 * const args = parseCLIArgs();
 * if (isCLIArgs(args)) {
 *   console.log(args.prd); // TypeScript knows this is CLIArgs
 * }
 * ```
 */
export function isCLIArgs(
  args: ValidatedCLIArgs | { subcommand: string; options: unknown }
): args is ValidatedCLIArgs {
  return !('subcommand' in args);
}
