/**
 * CLI help executor for startup verification
 *
 * @module utils/cli-help-executor
 *
 * @remarks
 * Provides functionality to execute the CLI with --help flag and validate
 * that help text is displayed correctly. This is the first runtime verification
 * after TypeScript compilation success in P1.M1.
 *
 * Features:
 * - Spawn npm script execution with --help flag
 * - Stdout/stderr capture with complete output accumulation
 * - Timeout handling with SIGTERM/SIGKILL escalation (10s + 5s)
 * - Help text section parsing (Usage, Options, description)
 * - Structured result with success flag and help detection
 * - Mock-friendly design for comprehensive unit testing
 *
 * @example
 * ```typescript
 * import { executeCliHelp } from './utils/cli-help-executor.js';
 *
 * const result = await executeCliHelp();
 *
 * if (result.success && result.hasHelp) {
 *   console.log('CLI help verified successfully');
 *   console.log('Exit code:', result.exitCode); // 0
 * } else {
 *   console.error('CLI help failed:', result.error);
 * }
 * ```
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { getLogger, type Logger } from './logger.js';

let _logger: Logger | undefined;
const logger = (): Logger => (_logger ??= getLogger('CliHelpExecutor'));

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Result of CLI help execution
 *
 * @remarks
 * Returned by {@link executeCliHelp} to indicate whether the CLI help command
 * executed successfully and whether help text was detected in output.
 *
 * @example
 * ```typescript
 * const result = await executeCliHelp();
 * if (!result.success) {
 *   console.error(`Exit code: ${result.exitCode}`);
 *   console.error(`Error: ${result.error}`);
 * }
 * ```
 */
export interface CliHelpResult {
  /** Whether the command succeeded (exit code 0, no errors) */
  success: boolean;

  /** Combined stdout and stderr output from the command */
  output: string;

  /** Whether output contains expected help text sections */
  hasHelp: boolean;

  /** Process exit code (null if timeout or spawn error) */
  exitCode: number | null;

  /** Error message if spawn failed or timeout occurred */
  error?: string;
}

/**
 * Parsed help text sections
 *
 * @remarks
 * Internal structure for parsing help output into detectable sections.
 * Used to determine if hasHelp should be true.
 */
interface ParsedHelpSections {
  /** Whether "Usage:" section found */
  hasUsage: boolean;

  /** Whether "Options:" section found */
  hasOptions: boolean;

  /** Whether program description found */
  hasDescription: boolean;

  /** Whether "Commands:" section found (may not exist) */
  hasCommands: boolean;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Default timeout for CLI help execution (milliseconds)
 *
 * @remarks
 * 10 seconds is sufficient for TypeScript compilation and help display.
 * If timeout occurs, process is killed with SIGTERM then SIGKILL.
 */
const DEFAULT_TIMEOUT = 10_000;

/**
 * Escalation timeout for SIGKILL after SIGTERM (milliseconds)
 *
 * @remarks
 * If process doesn't exit after SIGTERM, wait 5 seconds then send SIGKILL.
 */
const SIGKILL_TIMEOUT = 5_000;

// ============================================================================
// MAIN FUNCTION
// ============================================================================

/**
 * Executes CLI with --help flag and validates output
 *
 * @remarks
 * Uses `npm run dev -- --help` to execute tsx src/index.ts with --help flag.
 * The `--` separator tells npm to pass remaining arguments to the script.
 *
 * Child processes may emit multiple data chunks. Accumulate all chunks
 * before parsing to ensure complete output is captured.
 *
 * If process doesn't exit within 10s, send SIGTERM for graceful shutdown.
 * If still running after 5s more, send SIGKILL to force termination.
 *
 * Returns structured result, doesn't throw. Allows pipeline to continue
 * even on CLI help failure. Success flag indicates operation result.
 *
 * @param projectRoot - Optional project root path (defaults to process.cwd())
 * @returns CliHelpResult with execution status and help detection
 *
 * @example
 * ```typescript
 * // Basic usage with default project root
 * const result = await executeCliHelp();
 * if (result.success && result.hasHelp) {
 *   console.log('CLI help verified successfully');
 * }
 *
 * // Custom project root
 * const result = await executeCliHelp('/custom/project/path');
 * ```
 */
export async function executeCliHelp(
  projectRoot?: string
): Promise<CliHelpResult> {
  const root = projectRoot ?? process.cwd();

  logger().debug(`Executing CLI help in directory: ${root}`);

  // PATTERN: Safe spawn execution - handle synchronous errors
  let child: ChildProcess;

  try {
    // CRITICAL: Use -- separator to pass --help to underlying script
    child = spawn('npm', ['run', 'dev', '--', '--help'], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'], // stdin ignored, stdout/stderr captured
      shell: false, // Security: no shell injection
    });
  } catch (error) {
    // Handle synchronous spawn errors (e.g., ENOENT, EACCES)
    let errorMessage = 'Failed to execute CLI help';
    const errno = error as NodeJS.ErrnoException;
    if (errno.code === 'ENOENT') {
      errorMessage =
        'npm not found. Please ensure Node.js and npm are installed.';
    } else if (errno.code === 'EACCES') {
      errorMessage = 'Permission denied executing npm.';
    } else {
      errorMessage += `: ${error instanceof Error ? error.message : String(error)}`;
    }

    logger().error(errorMessage);

    return {
      success: false,
      output: '',
      hasHelp: false,
      exitCode: null,
      error: errorMessage,
    };
  }

  return new Promise(resolve => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let killed = false;

    // Timeout handler with SIGTERM/SIGKILL escalation
    const timeoutId = setTimeout(() => {
      logger().warn('CLI help execution timed out after 10s, sending SIGTERM');
      timedOut = true;
      killed = true;
      child.kill('SIGTERM');

      // Escalate to SIGKILL after 5s if SIGTERM doesn't work
      setTimeout(() => {
        logger().warn('CLI help still running, escalating to SIGKILL');
        child.kill('SIGKILL');
      }, SIGKILL_TIMEOUT);
    }, DEFAULT_TIMEOUT);

    // Capture stdout
    child.stdout?.on('data', (data: Buffer) => {
      if (killed) return; // Ignore data after kill
      stdout += data.toString();
    });

    // Capture stderr
    child.stderr?.on('data', (data: Buffer) => {
      if (killed) return; // Ignore data after kill
      stderr += data.toString();
    });

    // Handle process exit
    child.on('close', exitCode => {
      clearTimeout(timeoutId);

      // If we killed the process due to timeout, return timeout error
      if (timedOut) {
        resolve({
          success: false,
          output: stdout + stderr,
          hasHelp: false,
          exitCode: null,
          error: `CLI help execution timed out after ${DEFAULT_TIMEOUT}ms`,
        });
        return;
      }

      // Check exit code
      const success = exitCode === 0;
      const combinedOutput = stdout + stderr;

      // Parse help sections
      const sections = parseHelpSections(combinedOutput);
      const hasHelp = sections.hasUsage && sections.hasOptions;

      if (success) {
        logger().debug('CLI help executed successfully');
      } else {
        logger().warn(`CLI help exited with code ${exitCode}`);
      }

      resolve({
        success,
        output: combinedOutput,
        hasHelp,
        exitCode,
      });
    });

    // Handle spawn errors (e.g., npm not found)
    child.on('error', error => {
      clearTimeout(timeoutId);

      let errorMessage = 'Failed to execute CLI help';
      const errno = error as NodeJS.ErrnoException;
      if (errno.code === 'ENOENT') {
        errorMessage =
          'npm not found. Please ensure Node.js and npm are installed.';
      } else if (errno.code === 'EACCES') {
        errorMessage = 'Permission denied executing npm.';
      } else {
        errorMessage += `: ${error.message}`;
      }

      logger().error(errorMessage);

      resolve({
        success: false,
        output: '',
        hasHelp: false,
        exitCode: null,
        error: errorMessage,
      });
    });
  });
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Parses help output for expected sections
 *
 * @remarks
 * Searches for Commander.js help output markers:
 * - "Usage:" line at start
 * - Program description (contains "PRD to PRP Pipeline")
 * - "Options:" section with flags
 * - "Commands:" section (optional, may not exist)
 *
 * @param output - Combined stdout/stderr output
 * @returns Parsed help sections detection
 */
function parseHelpSections(output: string): ParsedHelpSections {
  return {
    hasUsage: /Usage:\s+\S+/i.test(output),
    hasOptions: /Options:/i.test(output),
    hasDescription: /PRD to PRP Pipeline/i.test(output),
    hasCommands: /Commands:/i.test(output),
  };
}
