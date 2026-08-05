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
import {
  type MergedHackConfig,
  type HackConfigValue,
  SCHEMA_MAP,
} from '../config/hack-config.js';
import { parseScope, ScopeParseError } from '../core/scope-resolver.js';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, relative, dirname, basename } from 'node:path';
import chalk from 'chalk';
import { getLogger, type Logger } from '../utils/logger.js';
import { InspectCommand, type InspectorOptions } from './commands/inspect.js';
import { ArtifactsCommand } from './commands/artifacts.js';
import { ValidateStateCommand } from './commands/validate-state.js';
import { CacheCommand, type CacheOptions } from './commands/cache.js';
import { ConfigCommand, type ConfigOptions } from './commands/config.js';
import { resolveRepositoryRoot } from '../utils/repo-root.js';
import * as os from 'node:os';
import ms from 'ms';

let _logger: Logger | undefined;
const logger = (): Logger => (_logger ??= getLogger('CLI'));

/**
 * The set of Commander option names (e.g. `'mode'`, `'maxTasks'`) that the user
 * EXPLICITLY passed on the command line during the most recent `parseCLIArgs()`
 * invocation (source `'cli'`). Captured by `parseCLIArgs()` so that
 * {@link applyHackCliDefaults} — invoked later in `main()` AFTER `.hack` is
 * loaded — can apply `.hack`-sourced CLI-only defaults to ONLY those flags the
 * user did not explicitly set (PRD §9.7.10 acceptance criterion).
 *
 * @remarks Reset at the start of every `parseCLIArgs()` call.
 */
let _explicitCliOptions: ReadonlySet<string> = new Set();

/**
 * Completion-based status color for `hack status` / `hack task` output (PRD §5.4).
 *
 * @remarks
 * Mirrors the reference `tsk` tool's `getStatusColor` mapping exactly: both
 * the task title and the status text on every line are rendered in this
 * color (the ID stays bold). Unknown/unlisted statuses fall back to white,
 * also matching `tsk`. Coloring is driven by chalk, so it is disabled
 * automatically for non-TTY output or when `NO_COLOR` is set.
 */
const TASK_STATUS_COLOR: Readonly<Record<string, (text: string) => string>> =
  Object.freeze({
    Planned: chalk.gray,
    Researching: chalk.yellow,
    Ready: chalk.blue,
    Implementing: chalk.magenta,
    Complete: chalk.green,
    Failed: chalk.red,
  });

/**
 * Resolve the chalk color for a task status (PRD §5.4).
 *
 * @param status - Status string (e.g. `'Complete'`).
 * @returns Chalk color function; `chalk.white` for unknown statuses.
 */
const taskStatusColor = (status: string): ((text: string) => string) =>
  TASK_STATUS_COLOR[status] ?? chalk.white;

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

  /**
   * Explicit repository root (PRD §9.8.6). Skips the upward `.git` search; `<path>` is resolved
   * against INVOCATION_CWD and MUST contain a `.git` entry (dir or file), else startup
   * hard-errors. Undefined → automatic upward traversal (§9.8.2).
   */
  repoRoot?: string;

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

  /**
   * Accept PRD edits as the new baseline without generating a delta session
   * (PRD §4.3 "Response Selection"). Cancels any queued `.pending_delta_hash`,
   * refreshes `prd_snapshot.md` to the current PRD, and exits/resumes
   * idempotently across all `PRD_CHANGED_*` session states.
   */
  acceptPrdChanges: boolean;

  /**
   * Declare the PRD as the source of truth for an already-implemented codebase
   * (PRD §4.6 "Adopt Mode"). On a fresh project this is the baseline-adoption
   * flag; on a project with existing sessions it is a no-op (warn + proceed).
   */
  adoptPrd: boolean;

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

  /** Enable background (parallel) PRP research (default: false, env: PARALLEL_RESEARCH) */
  parallelResearch?: boolean;

  /** How many items ahead to prefetch (default: 2, env: RESEARCH_DEPTH) - may be string from commander */
  researchDepth?: number | string;
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
 * // CLI: hack inspect
 *
 * // Or use artifacts subcommand
 * // CLI: hack artifacts list
 * ```
 */
export function parseCLIArgs():
  | ValidatedCLIArgs
  | { subcommand: 'inspect'; options: InspectorOptions }
  | { subcommand: 'artifacts'; options: Record<string, unknown> }
  | { subcommand: 'validate-state'; options: Record<string, unknown> }
  | { subcommand: 'cache'; options: CacheOptions }
  | { subcommand: 'task'; options: Record<string, unknown> }
  | { subcommand: 'config'; options: ConfigOptions } {
  const program = new Command();

  // Configure program
  program
    .name('hack')
    .description('PRD to PRP Pipeline - Automated software development')
    .version(
      JSON.parse(
        readFileSync(resolve(import.meta.dirname, '../../package.json'), 'utf8')
      ).version
    )
    // Required options
    .option('-p, --prd <path>', 'Path to PRD markdown file', './PRD.md')
    // Optional options
    .option(
      '--repo-root <path>',
      'Explicit repository root (skips .git search; must contain .git)'
    )
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
    .option(
      '--accept-prd-changes',
      'Accept PRD edits as the new baseline without generating a delta session (PRD §4.3)',
      false
    )
    .option(
      '--adopt-prd',
      'Declare the PRD as the source of truth for an already-implemented codebase (PRD §4.6)',
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
      '-r, --parallel-research',
      'Enable background (parallel) PRP research (default: false, env: PARALLEL_RESEARCH)',
      false
    )
    .option(
      '--research-depth <n>',
      'How many items ahead the background research supervisor prefetches (default: 2, env: RESEARCH_DEPTH)',
      process.env.RESEARCH_DEPTH ?? '2'
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

  // Add config subcommand (PRD §9.7.8 — .hack configuration file management)
  program
    .command('config')
    .description('.hack configuration file management')
    .argument('[action]', 'Action: init, show, validate, path', 'show')
    .argument('[file]', 'Explicit file to validate (validate action only)')
    .option('--force', 'Overwrite existing .hack (init only)', false)
    .option(
      '--src',
      'Annotate each value with its source layer (show only)',
      false
    )
    .option('--global', 'Print global config path (path only)', false)
    .option('--local', 'Print project-local config path (path only)', false)
    .option('-o, --output <format>', 'Output format (table, json)', 'table')
    .action(async (action, file, options) => {
      try {
        // Subcommand dispatch runs BEFORE the bootstrap chdir (src/index.ts main():
        // parseCLIArgs → subcommand early-return → [later] resolveRepositoryRoot +
        // chdir), so process.cwd() here === INVOCATION_CWD and getRepoRoot() THROWS
        // (singleton unset). Resolve repoRoot ourselves (default upward traversal).
        // Commander passes declared positional args in order, then the parsed
        // options object: (action, file, options).
        const explicit = (program.opts() as { repoRoot?: string }).repoRoot;
        const { repoRoot } = resolveRepositoryRoot(
          process.cwd(),
          explicit ? { explicit } : undefined
        );
        await new ConfigCommand(repoRoot).execute(
          action,
          options,
          typeof file === 'string' ? file : undefined
        );
        process.exit(0);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        logger().error(`Config command failed: ${errorMessage}`);
        process.exit(1);
      }
    });

  // Shared action handler for `task` and its `status` alias (PRD §5.3).
  // Extracted so both .command('task') and .command('status') share identical
  // behavior without duplicating the body.
  const taskAction = async (
    action: string,
    options: { file?: string; output?: string; session?: string }
  ): Promise<void> => {
    try {
      const { readFile } = await import('node:fs/promises');
      const { SessionManager } = await import('../core/session-manager.js');
      const { findLatestBugfixTasksFile } =
        await import('../core/session-utils.js');
      const planDir = resolve('plan');

      // Resolve the tasks.json file per PRD §5.3 "Task File Discovery Priority":
      //   1. --file <path>          (explicit override)
      //   2. latest bugfix child    (SESSION_DIR/bugfix/NNN_hash/tasks.json)
      //   3. main session           (SESSION_DIR/tasks.json) fallback
      //
      // A bugfix child is preferred whenever it has a tasks.json, REGARDLESS of
      // its completion status — mirroring the reference run-prd.sh selector
      // (previously this skipped bugfix tasks entirely and always showed the
      // parent session's list). `inspect` already resolves the latest session
      // this way; mirror it.
      let tasksFile: string;
      let sourceNote: string | null = null;
      if (options.file) {
        tasksFile = resolve(options.file);
      } else {
        // Resolve the target session (explicit --session, else the latest).
        let sessionPath: string;
        if (options.session) {
          const sessions = await SessionManager.listSessions(planDir);
          const session = sessions.find(s =>
            s.hash.startsWith(options.session!)
          );
          if (!session) {
            throw new Error(`Session not found: ${options.session}`);
          }
          sessionPath = session.path;
        } else {
          const latest = await SessionManager.findLatestSession(planDir);
          if (!latest) {
            throw new Error(
              'No sessions found. Run the pipeline first or use --file / --session.'
            );
          }
          sessionPath = latest.path;
        }

        // Prefer the latest bugfix child's tasks.json (PRD §5.3), else main.
        const bugfixTasks = await findLatestBugfixTasksFile(sessionPath);
        if (bugfixTasks) {
          tasksFile = bugfixTasks;
          sourceNote = `Using bugfix tasks: ${relative(sessionPath, bugfixTasks)}`;
        } else {
          tasksFile = resolve(sessionPath, 'tasks.json');
          sourceNote = `Using main tasks: ${relative(planDir, tasksFile)}`;
        }
      }

      // PRD §5.3 "Tasks-Not-Yet-Generated Window": if the AUTO-RESOLVED tasks
      // file is absent solely because the session dir exists but tasks.json
      // hasn't been generated yet (breakdown in progress / interrupted
      // breakdown), emit a calm notice and exit 0 instead of a scary ENOENT
      // error. Gated on the DISCOVERY path only — an explicit --file override
      // pointing at a missing file remains a hard error (real user mistake).
      // dirname(tasksFile) is the session dir for both the main-session
      // fallback and the bugfix tier, so this works uniformly without
      // sessionPath-scoping gymnastics.
      if (
        !options.file &&
        !existsSync(tasksFile) &&
        existsSync(dirname(tasksFile))
      ) {
        const sessionId = basename(dirname(tasksFile)); // 'NNN_hash'
        if (options.output === 'json') {
          console.log(
            JSON.stringify(
              { status: 'awaiting_breakdown', session: sessionId },
              null,
              2
            )
          );
        } else {
          const notice =
            action === 'next'
              ? `[hack] Session ${sessionId}: no tasks available yet (breakdown in progress).`
              : `[hack] Session ${sessionId}: tasks.json is generated during PRD breakdown and is not available yet — re-run shortly, or run \`hack --continue\` to (re)generate it.`;
          process.stderr.write(`${chalk.cyan(notice)}\n`);
        }
        process.exit(0);
        return; // unreachable in prod; stops no-op-exit test fall-through
      }

      // Print the source note (PRD §5.3) to stderr, above the listing. It is
      // suppressed for machine-readable JSON output so `jq`/scripts get clean
      // stdout; it is always suppressed for an explicit --file override (no
      // discovery happened, so there is nothing to report).
      if (sourceNote && options.output !== 'json') {
        process.stderr.write(`${chalk.cyan(`[hack] ${sourceNote}`)}\n`);
      }

      const content = await readFile(tasksFile, 'utf-8');
      const data = JSON.parse(content);

      if (action === 'next') {
        // Find next executable task. `Planned` is the orchestrator's fresh-pick
        // status, but for a user inspecting an in-progress session we also
        // surface `Ready` (research-complete, ready to implement) and `Failed`
        // (retry-eligible) so the command never silently reports "no tasks"
        // while actionable work exists.
        const NEXT_STATUSES = new Set(['Planned', 'Ready', 'Failed']);
        const findNext = (items: any[]): any => {
          for (const item of items) {
            if (item.type === 'Subtask' && NEXT_STATUSES.has(item.status)) {
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
            // Color-code by completion status (PRD §5.4).
            const color = taskStatusColor(next.status);
            console.log(`Next task: ${chalk.bold(next.id)}`);
            console.log(`  Title: ${color(next.title)}`);
            console.log(`  Status: ${color(next.status)}`);
          }
        } else {
          // Honour --output json even on the empty-result path: a pipeline
          // that pipes `hack task next -o json | jq .` against a completed
          // session must get valid JSON (null), not plain prose. The human-
          // readable branch keeps the calm "No tasks remaining." message.
          if (options.output === 'json') {
            console.log('null');
          } else {
            console.log('No tasks remaining.');
          }
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
          // Color-code each status label by completion (PRD §5.4).
          for (const [status, count] of Object.entries(counts)) {
            console.log(`  ${taskStatusColor(status)(status)}: ${count}`);
          }
        }
      } else {
        // Default: list all tasks, color-coded by completion status (PRD §5.4).
        // Mirrors the reference tsk tool: bold ID, status-colored title+status.
        const listItems = (items: any[], indent = 0) => {
          for (const item of items) {
            const prefix = '  '.repeat(indent);
            const color = taskStatusColor(item.status);
            const points =
              typeof item.story_points === 'number'
                ? ` (${item.story_points} points)`
                : '';
            console.log(
              `${prefix}${chalk.bold(item.id)}: ${color(item.title)} - ${color(item.status)}${points}`
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
  };

  // Add task subcommand (PRD §5.3)
  program
    .command('task')
    .description('Display and query pipeline tasks')
    .argument('[action]', 'Action: (none), next, status', '')
    .option('-f, --file <path>', 'Override tasks.json file path')
    .option('--session <hash>', 'Inspect specific session by hash')
    .option('-o, --output <format>', 'Output format (table, json)', 'table')
    .action(taskAction);

  // Add status subcommand — alias of `task` (PRD §5.3: git muscle memory)
  program
    .command('status')
    .description('Display and query pipeline tasks (alias of `task`)')
    .argument('[action]', 'Action: (none), next, status', '')
    .option('-f, --file <path>', 'Override tasks.json file path')
    .option('--session <hash>', 'Inspect specific session by hash')
    .option('-o, --output <format>', 'Output format (table, json)', 'table')
    .action(taskAction);

  // Parse arguments
  program.parse(process.argv);

  // Capture which options were EXPLICITLY passed (source 'cli') on this
  // invocation, BEFORE subcommand early-returns or the default-pipeline
  // return. applyHackCliDefaults() (called later in main(), after .hack is
  // loaded) uses this to apply .hack CLI-only defaults to ONLY the unset flags
  // (PRD §9.7.10 — env-over-file / cli-over-file: an explicit flag wins).
  //
  // Uses o.attributeName() (camelCase, e.g. 'maxTasks') — NOT o.name()
  // (kebab-case 'max-tasks') — because getOptionValueSource() and the
  // HACK_CLI_FLAG_BINDING map key on the attribute name. For --no-X negated
  // flags the attribute name drops the 'no-' prefix (e.g. '--no-cache' → 'cache'),
  // which is why those bindings declare the NON-negated attribute name plus a
  // `negated: true` marker (the value stored on ValidatedCLIArgs is the
  // negation, but source-tracking uses the base attribute).
  _explicitCliOptions = new Set(
    program.options
      .filter(
        o =>
          o.long !== undefined &&
          program.getOptionValueSource(o.attributeName()) === 'cli'
      )
      .map(o => o.attributeName())
  );

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
  if (args.length > 0 && args[0] === 'config') {
    // Config subcommand was invoked and already handled by action()
    // (PRD §9.7.8). This return is for type safety only — the .action() already
    // ran and process.exit'd; the placeholder options below must be a valid
    // ConfigOptions shape but their values are never consumed.
    return {
      subcommand: 'config',
      options: {
        output: 'table',
        force: false,
        src: false,
        global: false,
        local: false,
      } as ConfigOptions,
    };
  }
  if (args.length > 0 && args[0] === 'task') {
    // Task subcommand was invoked and already handled by action()
    return {
      subcommand: 'task',
      options: {},
    };
  }
  if (args.length > 0 && args[0] === 'status') {
    // 'status' is an alias of 'task' (PRD §5.3). The action() handler already
    // ran (and called process.exit); this return is type-safety-only, mirroring
    // the 'task' branch exactly.
    return {
      subcommand: 'task',
      options: {},
    };
  }

  // Get typed options for default pipeline execution
  const options = program.opts<CLIArgs>();

  // PRD §9.8.3: an EXPLICIT --prd resolves against INVOCATION_CWD (where the user typed the
  // command), NOT the post-chdir repo root. process.cwd() here === INVOCATION_CWD (S1's chdir runs
  // AFTER parseCLIArgs returns), so resolve() now is INVOCATION_CWD-relative. The DEFAULT
  // './PRD.md' is left relative → resolved against repoRoot post-chdir. Distinguish via
  // Commander's value source ('cli' = explicit; 'default' = omitted).
  if (program.getOptionValueSource('prd') === 'cli') {
    options.prd = resolve(options.prd);
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

  // Validate maxTasks. Commander passes <number> options as STRINGS, so
  // coerce before validating — Number.isInteger("999") is false and would
  // reject every value (the original bug). Mirrors the --monitor-interval
  // pattern (Number() + Number.isInteger + assign back).
  if (options.maxTasks !== undefined) {
    const maxTasks = Number(options.maxTasks);
    if (!Number.isInteger(maxTasks) || maxTasks <= 0) {
      logger().error('--max-tasks must be a positive integer');
      process.exit(1);
    }
    // Convert to number
    options.maxTasks = maxTasks;
  }

  // Validate maxDuration (coerce string -> number; see maxTasks above)
  if (options.maxDuration !== undefined) {
    const maxDuration = Number(options.maxDuration);
    if (!Number.isInteger(maxDuration) || maxDuration <= 0) {
      logger().error(
        '--max-duration must be a positive integer (milliseconds)'
      );
      process.exit(1);
    }
    // Convert to number
    options.maxDuration = maxDuration;
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

  // Validate research-depth (must be a positive integer)
  const researchDepthStr =
    typeof options.researchDepth === 'string'
      ? options.researchDepth
      : String(options.researchDepth);
  const researchDepth = parseInt(researchDepthStr, 10);

  if (isNaN(researchDepth) || researchDepth < 1) {
    logger().error('--research-depth must be a positive integer');
    process.exit(1);
  }

  // Store validated number value
  options.researchDepth = researchDepth;

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

/**
 * Map each §9.7.5 schema entry that has a `cliFlag` to the metadata needed to
 * re-apply its `.hack`-sourced value onto a parsed {@link ValidatedCLIArgs}
 * object: the Commander option `name()` and how the flag relates to its value
 * (direct, or negated — `--no-cache`/`--no-resource-monitor`).
 *
 * @remarks The mapping is keyed by `"section.key"` (the same key used in
 * {@link MergedHackConfig}). Only entries WITHOUT an `envVar` need this path —
 * env-linked CLI flags (e.g. `cli.log_level → HACKY_LOG_LEVEL`) already flow
 * through `process.env` via the loader's seeding and Commander's
 * `.default(process.env.X ?? …)`. The 10 CLI-only keys are enumerated here.
 */
interface CliFlagBinding {
  /**
   * The field name on {@link ValidatedCLIArgs} to read/write (camelCase).
   * For negated flags this is the NEGATED field (e.g. `noCache` for `cache_enabled`).
   */
  target: string;
  /**
   * The Commander option ATTRIBUTE NAME used for source-tracking
   * (`getOptionValueSource`). For a direct flag this equals `target`; for a
   * `--no-X` negated flag Commander tracks source under the BASE name (it
   * strips the `no-` prefix), so e.g. `--no-cache` is tracked under `'cache'`
   * while `target` is `'noCache'`.
   */
  sourceName: string;
  /** If true, the boolean field stores the NEGATION of the .hack value (e.g. --no-cache ↔ cache_enabled). */
  negated?: boolean;
}

const HACK_CLI_FLAG_BINDING: Readonly<Record<string, CliFlagBinding>> = {
  // concurrency
  'concurrency.parallelism': {
    target: 'parallelism',
    sourceName: 'parallelism',
  },
  // monitor
  'monitor.interval_ms': {
    target: 'monitorInterval',
    sourceName: 'monitorInterval',
  },
  'monitor.enabled': {
    target: 'noResourceMonitor',
    sourceName: 'resourceMonitor', // Commander tracks --no-resource-monitor under 'resourceMonitor'
    negated: true,
  },
  // cli
  'cli.mode': { target: 'mode', sourceName: 'mode' },
  'cli.scope': { target: 'scope', sourceName: 'scope' },
  'cli.machine_readable': {
    target: 'machineReadable',
    sourceName: 'machineReadable',
  },
  'cli.continue_on_error': {
    target: 'continueOnError',
    sourceName: 'continueOnError',
  },
  'cli.cache_enabled': {
    target: 'noCache',
    sourceName: 'cache', // Commander tracks --no-cache under 'cache'
    negated: true,
  },
  'cli.max_tasks': { target: 'maxTasks', sourceName: 'maxTasks' },
  'cli.max_duration_ms': { target: 'maxDuration', sourceName: 'maxDuration' },
};

/**
 * Apply CLI-only `.hack` defaults to a parsed {@link ValidatedCLIArgs} object
 * for flags the user did NOT explicitly pass (PRD §9.7.10 acceptance criterion).
 *
 * @remarks
 * `parseCLIArgs()` runs BEFORE `.hack` is loaded (bootstrap order:
 * `parseCLIArgs → chdir → loadHackConfig`), so the 10 CLI-only schema keys
 * (those without an `envVar`) — `cli.mode`, `cli.scope`, `cli.max_tasks`,
 * `cli.max_duration_ms`, `cli.machine_readable`, `cli.continue_on_error`,
 * `cli.cache_enabled`, `concurrency.parallelism`, `monitor.interval_ms`,
 * `monitor.enabled` — have no path to the CLI. This function is the consumer
 * that closes the gap: it runs in `main()` AFTER `loadHackConfig()` and
 * overwrites ONLY those option fields whose source was `'default'` (i.e. the
 * user did not pass the corresponding flag).
 *
 * **Precedence (PRD §9.2.1 cli > env > file):** an explicitly-passed flag
 * always wins (its source is `'cli'`, so it is skipped here); a `.hack` value
 * fills the gap when no flag was passed. Env-linked CLI flags are unaffected —
 * they already resolve via the loader's env-seeding + Commander `.default()`.
 *
 * Type coercion mirrors the field's declared type on `ValidatedCLIArgs`:
 * booleans set directly (accounting for the `--no-*` negation); ints parsed
 * with `parseInt`; strings assigned as-is. Values are validated in-place
 * (range/enum guards) and invalid `.hack` values are WARNED and skipped so a
 * bad file value never crashes the run (the file already passed
 * `validateHackTier` at load, but `scope`/`max_tasks`/`max_duration_ms` have
 * no §9.7.5 default and are type-checked defensively here).
 *
 * @param args - The validated CLI args (mutated in place for unset flags).
 * @param merged - The merged `.hack` config returned by `loadHackConfig()`.
 * @returns The same `args` object (for chaining), with CLI-only defaults applied.
 */
export function applyHackCliDefaults(
  args: ValidatedCLIArgs,
  merged: MergedHackConfig
): ValidatedCLIArgs {
  for (const entry of SCHEMA_MAP) {
    // Only CLI-only keys (no envVar) need this path; env-linked flags already
    // resolve via process.env seeding + Commander .default().
    if (entry.envVar !== undefined) continue;
    const qualifiedKey = `${entry.section}.${entry.key}`;
    const binding = HACK_CLI_FLAG_BINDING[qualifiedKey];
    if (binding === undefined) continue;

    // Skip if the user explicitly passed the corresponding flag (cli > file).
    if (_explicitCliOptions.has(binding.sourceName)) continue;

    // Read the merged .hack value for this key (absent → nothing to apply).
    const section = (merged[entry.section] ?? {}) as Record<
      string,
      HackConfigValue
    >;
    const fileValue = section[entry.key];
    if (fileValue === undefined) continue;

    const target = binding.target;

    if (entry.type === 'boolean') {
      if (typeof fileValue !== 'boolean') {
        logger().warn(
          `[hack] ${qualifiedKey} in .hack is not a boolean (${JSON.stringify(fileValue)}); ignored`
        );
        continue;
      }
      // Negated bindings store the NEGATION of the .hack value
      // (--no-cache ↔ cache_enabled, --no-resource-monitor ↔ monitor.enabled).
      (args as unknown as Record<string, unknown>)[target] = binding.negated
        ? !fileValue
        : fileValue;
    } else if (entry.type === 'int') {
      if (typeof fileValue !== 'number' || !Number.isInteger(fileValue)) {
        logger().warn(
          `[hack] ${qualifiedKey} in .hack is not an integer (${JSON.stringify(fileValue)}); ignored`
        );
        continue;
      }
      (args as unknown as Record<string, unknown>)[target] = fileValue;
    } else {
      // string
      if (typeof fileValue !== 'string') {
        logger().warn(
          `[hack] ${qualifiedKey} in .hack is not a string (${JSON.stringify(fileValue)}); ignored`
        );
        continue;
      }
      (args as unknown as Record<string, unknown>)[target] = fileValue;
    }
  }
  return args;
}
