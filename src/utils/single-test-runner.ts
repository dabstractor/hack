/**
 * Single test file runner for memory issue verification
 *
 * @module utils/single-test-runner
 *
 * @remarks
 * Provides functionality to execute a single test file with memory
 * monitoring to verify NODE_OPTIONS memory limits from P2.M1.T1 are
 * working correctly and detect any remaining OOM errors.
 *
 * Features:
 * - Spawn npm test execution with single test file argument
 * - Stdout/stderr capture with complete output accumulation
 * - Timeout handling with SIGTERM/SIGKILL escalation (30s + 5s)
 * - Memory error detection using existing utility
 * - Structured result with success flag and memory error details
 * - Mock-friendly design for comprehensive unit testing
 *
 * @example
 * ```typescript
 * import { runSingleTestFile } from './utils/single-test-runner.js';
 *
 * const result = await runSingleTestFile();
 *
 * if (result.success && !result.hasMemoryError) {
 *   console.log('✓ No memory issues detected');
 *   console.log(result.output);
 * } else if (result.hasMemoryError) {
 *   console.error('Memory error:', result.memoryError?.errorType);
 *   console.error('Suggestion:', result.memoryError?.suggestion);
 * } else {
 *   console.error('Execution failed:', result.error);
 * }
 * ```
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { getLogger, type Logger } from './logger.js';
import { detectMemoryErrorInTestOutput } from './memory-error-detector.js';

let _logger: Logger | undefined;
const logger = (): Logger => (_logger ??= getLogger('SingleTestRunner'));

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Result of single test file execution
 *
 * @remarks
 * Returned by {@link runSingleTestFile} to indicate whether the test
 * executed successfully and whether any memory errors were detected.
 *
 * @example
 * ```typescript
 * const result = await runSingleTestFile();
 * if (!result.success) {
 *   console.error(`Exit code: ${result.exitCode}`);
 *   console.error(`Error: ${result.error}`);
 * }
 * if (result.hasMemoryError) {
 *   console.error(`Memory error: ${result.memoryError?.errorType}`);
 * }
 * ```
 */
export interface SingleTestResult {
  /** Whether the test command succeeded (completed without crashing) */
  readonly success: boolean;

  /** Whether a memory error was detected in output */
  readonly hasMemoryError: boolean;

  /** Combined stdout and stderr output from the test command */
  readonly output: string;

  /** Process exit code (null if timeout or spawn error) */
  readonly exitCode: number | null;

  /** Memory error detection result (if memory error detected) */
  readonly memoryError:
    | import('./memory-error-detector.js').MemoryErrorDetectionResult
    | null;

  /** Error message if spawn failed or timeout occurred */
  readonly error?: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Default timeout for single test file execution (milliseconds)
 *
 * @remarks
 * 30 seconds is sufficient for a single test file (~500 tests) to complete.
 * resource-monitor.test.ts has 564 tests and typically completes in ~10 seconds.
 * If timeout occurs, process is killed with SIGTERM then SIGKILL.
 */
const DEFAULT_TIMEOUT = 30_000;

/**
 * Escalation timeout for SIGKILL after SIGTERM (milliseconds)
 *
 * @remarks
 * If process doesn't exit after SIGTERM, wait 5 seconds then send SIGKILL.
 */
const SIGKILL_TIMEOUT = 5_000;

/**
 * Default test file to execute for memory verification
 *
 * @remarks
 * resource-monitor.test.ts is a medium-sized test file (564 tests) that
 * exercises resource monitoring functionality. A good choice for verifying
 * memory limits work without running the full 1688-test suite.
 */
const DEFAULT_TEST_FILE = 'tests/unit/utils/resource-monitor.test.ts';

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Builds a single test result
 *
 * @remarks
 * Constructs a SingleTestResult with all fields for consistent result
 * structure across all code paths (success, failure, timeout, error).
 *
 * @param success - Whether command succeeded
 * @param hasMemoryError - Whether memory error detected
 * @param output - Combined stdout/stderr
 * @param exitCode - Process exit code
 * @param memoryError - Memory error detection result
 * @param error - Optional error message
 * @returns Result object
 */
function buildTestResult(
  success: boolean,
  hasMemoryError: boolean,
  output: string,
  exitCode: number | null,
  memoryError:
    | import('./memory-error-detector.js').MemoryErrorDetectionResult
    | null,
  error?: string
): SingleTestResult {
  return {
    success,
    hasMemoryError,
    output,
    exitCode,
    memoryError,
    ...(error && { error }),
  };
}

// ============================================================================
// MAIN FUNCTION
// ============================================================================

/**
 * Runs a single test file with memory monitoring
 *
 * @remarks
 * * PATTERN: Always return structured result, never throw
 * This function executes `npm run test:run -- <test-file>` and captures
 * the output to detect memory errors.
 *
 * * PATTERN: Use spawn with argument arrays (shell: false)
 * Command: ['npm', 'run', 'test:run', '--', testFile]
 * The -- separator tells npm to pass remaining args to vitest.
 *
 * * PATTERN: Accumulate all output before parsing
 * Child processes emit multiple data chunks. Concatenate all chunks
 * before calling memory error detection.
 *
 * * PATTERN: Ignore data after kill
 * Set killed flag before sending SIGTERM/SIGKILL. Check flag in
 * data event handlers to prevent race conditions.
 *
 * * PATTERN: Use existing memory-error-detector.ts
 * Don't reimplement OOM detection. Import and use detectMemoryErrorInTestOutput().
 *
 * * CONTRACT: Verify P2.M1.T1 memory limits work
 * After P2.M1.T1 adds NODE_OPTIONS to test scripts, this function
 * verifies the memory limits actually prevent OOM errors.
 *
 * @param testFile - Optional test file path (defaults to resource-monitor.test.ts)
 * @param projectRoot - Optional project root path (defaults to process.cwd())
 * @returns SingleTestResult with execution status and memory error detection
 *
 * @example
 * ```typescript
 * // Run default test file (resource-monitor.test.ts)
 * const result = await runSingleTestFile();
 * if (result.success && !result.hasMemoryError) {
 *   console.log('✓ No memory issues');
 * }
 *
 * // Run custom test file
 * const customResult = await runSingleTestFile('tests/unit/utils/logger.test.ts');
 *
 * // Run with custom project root
 * const customRoot = await runSingleTestFile(
 *   'tests/unit/utils/logger.test.ts',
 *   '/custom/project/path'
 * );
 * ```
 */
export async function runSingleTestFile(
  testFile?: string,
  projectRoot?: string
): Promise<SingleTestResult> {
  const root = projectRoot ?? process.cwd();
  const file = testFile ?? DEFAULT_TEST_FILE;

  logger().debug(`Running single test file: ${file}`);

  // PATTERN: Safe spawn execution - handle synchronous errors
  let child: ChildProcess;

  try {
    // CRITICAL: Use -- separator to pass test file to vitest
    child = spawn('npm', ['run', 'test:run', '--', file], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'], // stdin ignored, stdout/stderr captured
      shell: false, // Security: no shell injection
    });
  } catch (error) {
    // Handle synchronous spawn errors (e.g., ENOENT, EACCES)
    let errorMessage = 'Failed to run test file';
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

    return buildTestResult(false, false, '', null, null, errorMessage);
  }

  return new Promise(resolve => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let killed = false;

    // Timeout handler with SIGTERM/SIGKILL escalation
    const timeoutId = setTimeout(() => {
      logger().warn(
        `Test execution timed out after ${DEFAULT_TIMEOUT}ms, sending SIGTERM`
      );
      timedOut = true;
      killed = true;
      child.kill('SIGTERM');

      // Escalate to SIGKILL after 5s if SIGTERM doesn't work
      setTimeout(() => {
        logger().warn('Test execution still running, escalating to SIGKILL');
        child.kill('SIGKILL');
      }, SIGKILL_TIMEOUT);
    }, DEFAULT_TIMEOUT);

    // Capture stdout
    child.stdout?.on('data', (data: Buffer) => {
      if (killed) return; // CRITICAL: Ignore data after kill
      stdout += data.toString();
    });

    // Capture stderr
    child.stderr?.on('data', (data: Buffer) => {
      if (killed) return; // CRITICAL: Ignore data after kill
      stderr += data.toString();
    });

    // Handle process exit
    child.on('close', exitCode => {
      clearTimeout(timeoutId);

      // If we killed the process due to timeout, return timeout error
      if (timedOut) {
        resolve(
          buildTestResult(
            false,
            false,
            stdout + stderr,
            null,
            null,
            `Test execution timed out after ${DEFAULT_TIMEOUT}ms`
          )
        );
        return;
      }

      // Combine output for memory error detection
      const combinedOutput = stdout + stderr;

      // PATTERN: Use existing memory-error-detector.ts
      const memoryCheck = detectMemoryErrorInTestOutput(
        combinedOutput,
        exitCode
      );

      if (exitCode === 0) {
        logger().debug('Test file executed successfully (all tests passed)');
      } else if (exitCode === 1) {
        logger().debug('Test file executed with some test failures');
      } else {
        logger().warn(`Test file exited with unexpected code ${exitCode}`);
      }

      resolve(
        buildTestResult(
          true, // Command completed successfully
          memoryCheck.hasMemoryError,
          combinedOutput,
          exitCode,
          memoryCheck.hasMemoryError ? memoryCheck : null
        )
      );
    });

    // Handle spawn errors (e.g., npm not found)
    child.on('error', error => {
      clearTimeout(timeoutId);

      let errorMessage = 'Failed to run test file';
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

      resolve(
        buildTestResult(false, false, stdout + stderr, null, null, errorMessage)
      );
    });
  });
}
