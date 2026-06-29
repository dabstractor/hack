/**
 * PRD validation executor for running PRD validation command
 *
 * @module utils/prd-validation-executor
 *
 * @remarks
 * Provides functionality to execute the PRD validation command
 * (`npm run dev -- --prd <path> --validate-prd`) and capture the
 * validation report output from stdout/stderr.
 *
 * This utility is used by test infrastructure to verify that the
 * PRD validation functionality works correctly end-to-end.
 *
 * Features:
 * - Spawn npm script execution with --prd and --validate-prd flags
 * - Stdout/stderr capture with complete output accumulation
 * - Timeout handling with SIGTERM/SIGKILL escalation (10s + 5s)
 * - Validation status parsing (✅ VALID / ❌ INVALID)
 * - Structured result with success flag and validation status
 * - Mock-friendly design for comprehensive unit testing
 *
 * @example
 * ```typescript
 * import { executePrdValidation } from './utils/prd-validation-executor.js';
 *
 * const result = await executePrdValidation('/path/to/TEST_PRD.md');
 *
 * if (result.success && result.valid) {
 *   console.log('PRD validation passed successfully');
 *   console.log(result.validationReport);
 * } else if (result.success && !result.valid) {
 *   console.log('PRD validation failed:');
 *   console.log(result.validationReport);
 * } else {
 *   console.error('Validation command error:', result.error);
 * }
 * ```
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { getLogger, type Logger } from './logger.js';

let _logger: Logger | undefined;
const logger = (): Logger => (_logger ??= getLogger('PrdValidationExecutor'));

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Result of PRD validation execution
 *
 * @remarks
 * Returned by {@link executePrdValidation} to indicate whether the validation
 * command executed successfully and whether the PRD passed validation.
 *
 * @example
 * ```typescript
 * const result = await executePrdValidation('/path/to/PRD.md');
 * if (!result.success) {
 *   console.error(`Exit code: ${result.exitCode}`);
 *   console.error(`Error: ${result.error}`);
 * }
 * ```
 */
export interface PrdValidationResult {
  /** Whether the command succeeded (completed without crashing) */
  success: boolean;

  /** Combined stdout and stderr output from the command (validation report) */
  validationReport: string;

  /** Whether the PRD passed validation (extracted from report) */
  valid: boolean;

  /** Process exit code (null if timeout or spawn error) */
  exitCode: number | null;

  /** Error message if spawn failed or timeout occurred */
  error?: string;
}

/**
 * Parsed validation output for extracting validation status
 *
 * @remarks
 * Internal structure for parsing validation report to determine
 * if the PRD passed or failed validation.
 */
interface ParsedValidationOutput {
  /** Whether output contains valid indicator */
  isValid: boolean;

  /** Whether validation status was found in output */
  hasStatus: boolean;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Default timeout for PRD validation execution (milliseconds)
 *
 * @remarks
 * 10 seconds is sufficient for PRD validation to complete.
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
 * Executes PRD validation command and captures report
 *
 * @remarks
 * Uses `npm run dev -- --prd <path> --validate-prd` to execute the
 * validation command. The `--` separator tells npm to pass remaining
 * arguments to the underlying script.
 *
 * Child processes may emit multiple data chunks. Accumulate all chunks
 * before parsing to ensure complete output is captured.
 *
 * If process doesn't exit within 10s, send SIGTERM for graceful shutdown.
 * If still running after 5s more, send SIGKILL to force termination.
 *
 * Exit code 0 or 1 both indicate successful execution (PRD may be valid
 * or invalid). Only timeout or spawn errors result in `success: false`.
 *
 * The `valid` field is extracted from the validation report by looking
 * for "✅ VALID" or "❌ INVALID" in the output.
 *
 * Returns structured result, doesn't throw. Allows pipeline to continue
 * even on validation failure. Success flag indicates operation result.
 *
 * @param prdPath - Absolute path to PRD file (from S1 output)
 * @param projectRoot - Optional project root path (defaults to process.cwd())
 * @returns PrdValidationResult with execution status and validation report
 *
 * @example
 * ```typescript
 * // Basic usage with default project root
 * const result = await executePrdValidation('/path/to/TEST_PRD.md');
 * if (result.success) {
 *   if (result.valid) {
 *     console.log('PRD is valid');
 *   } else {
 *     console.log('PRD has issues:', result.validationReport);
 *   }
 * }
 *
 * // Custom project root
 * const result = await executePrdValidation('/path/to/TEST_PRD.md', '/custom/project/path');
 * ```
 */
export async function executePrdValidation(
  prdPath: string,
  projectRoot?: string
): Promise<PrdValidationResult> {
  const root = projectRoot ?? process.cwd();

  logger().debug(`Executing PRD validation for: ${prdPath}`);

  // PATTERN: Safe spawn execution - handle synchronous errors
  let child: ChildProcess;

  try {
    // CRITICAL: Use -- separator to pass flags to underlying script
    child = spawn(
      'npm',
      ['run', 'dev', '--', '--prd', prdPath, '--validate-prd'],
      {
        cwd: root,
        stdio: ['ignore', 'pipe', 'pipe'], // stdin ignored, stdout/stderr captured
        shell: false, // Security: no shell injection
      }
    );
  } catch (error) {
    // Handle synchronous spawn errors (e.g., ENOENT, EACCES)
    let errorMessage = 'Failed to execute PRD validation';
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
      validationReport: '',
      valid: false,
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
      logger().warn('PRD validation timed out after 10s, sending SIGTERM');
      timedOut = true;
      killed = true;
      child.kill('SIGTERM');

      // Escalate to SIGKILL after 5s if SIGTERM doesn't work
      setTimeout(() => {
        logger().warn('PRD validation still running, escalating to SIGKILL');
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
          validationReport: stdout + stderr,
          valid: false,
          exitCode: null,
          error: `PRD validation timed out after ${DEFAULT_TIMEOUT}ms`,
        });
        return;
      }

      // Exit code 0 or 1 both indicate successful execution
      // Exit code 0 = valid PRD
      // Exit code 1 = invalid PRD
      const combinedOutput = stdout + stderr;
      const parsed = parseValidationOutput(combinedOutput);

      if (exitCode === 0) {
        logger().debug('PRD validation executed successfully (valid)');
      } else if (exitCode === 1) {
        logger().debug('PRD validation executed successfully (invalid PRD)');
      } else {
        logger().warn(`PRD validation exited with unexpected code ${exitCode}`);
      }

      resolve({
        success: true, // Command completed successfully
        validationReport: combinedOutput,
        valid: parsed.isValid,
        exitCode,
      });
    });

    // Handle spawn errors (e.g., npm not found)
    child.on('error', error => {
      clearTimeout(timeoutId);

      let errorMessage = 'Failed to execute PRD validation';
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
        validationReport: '',
        valid: false,
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
 * Parses validation output to extract validation status
 *
 * @remarks
 * Searches for validation status indicators in the output:
 * - "✅ VALID" - PRD passed validation
 * - "❌ INVALID" - PRD failed validation
 *
 * The validation report format is defined in src/index.ts lines 130-173.
 *
 * @param output - Combined stdout/stderr from validation command
 * @returns Parsed validation status
 */
function parseValidationOutput(output: string): ParsedValidationOutput {
  const hasValidIndicator = /✅\s*VALID/i.test(output);
  const hasInvalidIndicator = /❌\s*INVALID/i.test(output);
  const hasStatus = hasValidIndicator || hasInvalidIndicator;

  return {
    isValid: hasValidIndicator,
    hasStatus,
  };
}
