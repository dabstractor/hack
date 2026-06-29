/**
 * Full test suite runner with memory monitoring
 *
 * @module utils/full-test-suite-runner
 *
 * @remarks
 * Provides functionality to execute the full test suite (1688 tests)
 * with memory monitoring to verify NODE_OPTIONS memory limits from
 * P2.M1.T1 are working correctly and detect any remaining OOM errors.
 *
 * Features:
 * - Spawn npm test execution without specific test file argument
 * - Stdout/stderr capture with complete output accumulation
 * - Timeout handling with SIGTERM/SIGKILL escalation (5 min + 10s)
 * - Memory error detection using existing utility
 * - Test result parsing using existing utility
 * - Structured result with completion flag and memory error details
 * - Input condition validation (only runs if S1 passes)
 * - Mock-friendly design for comprehensive unit testing
 *
 * @example
 * ```typescript
 * import { runSingleTestFile } from './utils/single-test-runner.js';
 * import { runFullTestSuite } from './utils/full-test-suite-runner.js';
 *
 * // Step 1: Run single test file first
 * const s1Result = await runSingleTestFile();
 *
 * if (!s1Result.success || s1Result.hasMemoryError) {
 *   console.error('Cannot run full suite - single test failed');
 *   process.exit(1);
 * }
 *
 * // Step 2: Run full test suite
 * const result = await runFullTestSuite(s1Result);
 *
 * if (result.completed && !result.memoryErrors) {
 *   console.log('✓ Full suite completed without memory issues');
 *   console.log(`Results: ${result.testResults.pass} passed, ${result.testResults.fail} failed`);
 * } else if (result.memoryErrors) {
 *   console.error('Memory error:', result.memoryError?.errorType);
 * } else {
 *   console.error('Execution failed:', result.error);
 * }
 * ```
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { getLogger, type Logger } from './logger.js';
import {
  detectMemoryErrorInTestOutput,
  parseVitestTestCounts,
  type MemoryErrorDetectionResult,
} from './memory-error-detector.js';
import type { SingleTestResult } from './single-test-runner.js';

let _logger: Logger | undefined;
const logger = (): Logger => (_logger ??= getLogger('FullTestSuiteRunner'));

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Result of full test suite execution
 *
 * @remarks
 * Returned by {@link runFullTestSuite} to indicate whether the full
 * test suite executed successfully and whether any memory errors
 * were detected.
 *
 * @example
 * ```typescript
 * const result = await runFullTestSuite(s1Result);
 * if (!result.completed) {
 *   console.error(`Error: ${result.error}`);
 * }
 * if (result.memoryErrors) {
 *   console.error(`Memory error: ${result.memoryError?.errorType}`);
 * }
 * ```
 */
export interface FullTestSuiteResult {
  /** Whether the test suite completed execution (regardless of test failures) */
  readonly completed: boolean;

  /** Whether a memory error was detected in output */
  readonly memoryErrors: boolean;

  /** Test results (pass/fail/total) or null if parsing failed */
  readonly testResults: { pass: number; fail: number; total: number } | null;

  /** Combined stdout and stderr output from the test command */
  readonly output: string;

  /** Process exit code (null if timeout or spawn error) */
  readonly exitCode: number | null;

  /** Memory error detection result (if memory error detected) */
  readonly memoryError: MemoryErrorDetectionResult | null;

  /** Error message if spawn failed, timeout occurred, or input condition failed */
  readonly error?: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Default timeout for full test suite execution (milliseconds)
 *
 * @remarks
 * 5 minutes is sufficient for the full test suite (1688 tests) to complete.
 * Full suite typically takes 3-5 minutes depending on hardware.
 * If timeout occurs, process is killed with SIGTERM then SIGKILL.
 */
const DEFAULT_TIMEOUT = 5 * 60 * 1000; // 5 minutes

/**
 * Escalation timeout for SIGKILL after SIGTERM (milliseconds)
 *
 * @remarks
 * If process doesn't exit after SIGTERM, wait 10 seconds then send SIGKILL.
 * Longer than single-test-runner.ts (5s) because test suite may take time to flush.
 */
const SIGKILL_TIMEOUT = 10 * 1000; // 10 seconds

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Builds a full test suite result
 *
 * @remarks
 * Constructs a FullTestSuiteResult with all fields for consistent result
 * structure across all code paths (success, failure, timeout, error).
 *
 * @param completed - Whether suite completed
 * @param memoryErrors - Whether memory errors detected
 * @param testResults - Parsed test counts (or null)
 * @param output - Combined stdout/stderr
 * @param exitCode - Process exit code
 * @param memoryError - Memory error detection result
 * @param error - Optional error message
 * @returns Result object
 */
function buildFullSuiteResult(
  completed: boolean,
  memoryErrors: boolean,
  testResults: { pass: number; fail: number; total: number } | null,
  output: string,
  exitCode: number | null,
  memoryError: MemoryErrorDetectionResult | null,
  error?: string
): FullTestSuiteResult {
  return {
    completed,
    memoryErrors,
    testResults,
    output,
    exitCode,
    memoryError,
    // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    ...(error && { error }),
  };
}

// ============================================================================
// MAIN FUNCTION
// ============================================================================

/**
 * Runs full test suite with memory monitoring
 *
 * @remarks
 * * PATTERN: Validate input condition from S1 first
 * Only runs full suite if single test passed without memory errors.
 * This prevents wasting 5 minutes if single test already fails.
 *
 * * PATTERN: Always return structured result, never throw
 * This function executes `npm run test:run` and captures the output
 * to detect memory errors and parse test results.
 *
 * * PATTERN: Use spawn with argument arrays (shell: false)
 * Command: ['npm', 'run', 'test:run']
 * No test file argument - runs full suite.
 *
 * * PATTERN: Accumulate all output before parsing
 * Child processes emit multiple data chunks. Concatenate all chunks
 * before calling memory error detection and test count parsing.
 *
 * * PATTERN: Ignore data after kill
 * Set killed flag before sending SIGTERM/SIGKILL. Check flag in
 * data event handlers to prevent race conditions.
 *
 * * PATTERN: Use existing memory-error-detector.ts
 * Don't reimplement OOM detection or test count parsing.
 * Import and use detectMemoryErrorInTestOutput() and parseVitestTestCounts().
 *
 * * CONTRACT: Verify P2.M1.T1 memory limits work at scale
 * After P2.M1.T1 adds NODE_OPTIONS to test scripts, this function
 * verifies the memory limits prevent OOM errors across all 1688 tests.
 *
 * @param singleTestResult - Result from S1 (single test file execution)
 * @param projectRoot - Optional project root path (defaults to process.cwd())
 * @returns FullTestSuiteResult with execution status and memory error detection
 *
 * @example
 * ```typescript
 * // Run single test file first (from S1)
 * const s1Result = await runSingleTestFile();
 *
 * // Run full test suite (only if S1 passed)
 * const result = await runFullTestSuite(s1Result);
 *
 * if (result.completed && !result.memoryErrors) {
 *   console.log('✓ Full suite passed');
 *   console.log(`${result.testResults.pass}/${result.testResults.total} tests passed`);
 * } else if (result.memoryErrors) {
 *   console.error('Memory error:', result.memoryError?.errorType);
 *   console.error('Suggestion:', result.memoryError?.suggestion);
 * }
 * ```
 */
export async function runFullTestSuite(
  singleTestResult: SingleTestResult,
  projectRoot?: string
): Promise<FullTestSuiteResult> {
  const root = projectRoot ?? process.cwd();

  // PATTERN: Validate input condition from S1 first
  if (!singleTestResult.success || singleTestResult.hasMemoryError) {
    const errorMessage =
      'Cannot run full suite - single test failed or has memory issues. ' +
      `S1 success: ${singleTestResult.success}, hasMemoryError: ${singleTestResult.hasMemoryError}`;

    logger().error(errorMessage);

    return buildFullSuiteResult(
      false,
      false,
      null,
      '',
      null,
      null,
      errorMessage
    );
  }

  logger().debug('Running full test suite (1688 tests)');

  // PATTERN: Safe spawn execution - handle synchronous errors
  let child: ChildProcess;

  try {
    // CRITICAL: No test file argument - runs full suite
    child = spawn('npm', ['run', 'test:run'], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'], // stdin ignored, stdout/stderr captured
      shell: false, // Security: no shell injection
    });
  } catch (error) {
    // Handle synchronous spawn errors (e.g., ENOENT, EACCES)
    let errorMessage = 'Failed to run full test suite';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((error as any).code === 'ENOENT') {
      errorMessage =
        'npm not found. Please ensure Node.js and npm are installed.';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } else if ((error as any).code === 'EACCES') {
      errorMessage = 'Permission denied executing npm.';
    } else {
      errorMessage += `: ${error instanceof Error ? error.message : String(error)}`;
    }

    logger().error(errorMessage);

    return buildFullSuiteResult(
      false,
      false,
      null,
      '',
      null,
      null,
      errorMessage
    );
  }

  return new Promise(resolve => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let killed = false;

    // Timeout handler with SIGTERM/SIGKILL escalation
    const timeoutId = setTimeout(() => {
      logger().warn(
        `Test suite timed out after ${DEFAULT_TIMEOUT}ms, sending SIGTERM`
      );
      timedOut = true;
      killed = true;
      child.kill('SIGTERM');

      // Escalate to SIGKILL after 10s if SIGTERM doesn't work
      setTimeout(() => {
        logger().warn('Test suite still running, escalating to SIGKILL');
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
          buildFullSuiteResult(
            false,
            false,
            null,
            stdout + stderr,
            null,
            null,
            `Test suite timed out after ${DEFAULT_TIMEOUT}ms`
          )
        );
        return;
      }

      // Combine output for parsing
      const combinedOutput = stdout + stderr;

      // PATTERN: Use existing memory-error-detector.ts
      const memoryCheck = detectMemoryErrorInTestOutput(
        combinedOutput,
        exitCode
      );

      // PATTERN: Use existing parseVitestTestCounts() function
      const testCounts = parseVitestTestCounts(combinedOutput);

      if (exitCode === 0) {
        logger().debug('Test suite executed successfully (all tests passed)');
      } else if (exitCode === 1) {
        // Exit code 1 means some tests failed, but not necessarily memory errors
        if (memoryCheck.hasMemoryError) {
          logger().warn('Test suite had memory errors');
        } else {
          logger().debug('Test suite executed with some test failures');
        }
      } else {
        logger().warn(`Test suite exited with unexpected code ${exitCode}`);
      }

      resolve(
        buildFullSuiteResult(
          true, // Command completed successfully
          memoryCheck.hasMemoryError,
          testCounts,
          combinedOutput,
          exitCode,
          memoryCheck.hasMemoryError ? memoryCheck : null
        )
      );
    });

    // Handle spawn errors (e.g., npm not found)
    child.on('error', error => {
      clearTimeout(timeoutId);

      let errorMessage = 'Failed to run full test suite';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((error as any).code === 'ENOENT') {
        errorMessage =
          'npm not found. Please ensure Node.js and npm are installed.';
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } else if ((error as any).code === 'EACCES') {
        errorMessage = 'Permission denied executing npm.';
      } else {
        errorMessage += `: ${error.message}`;
      }

      logger().error(errorMessage);

      resolve(
        buildFullSuiteResult(
          false,
          false,
          null,
          stdout + stderr,
          null,
          null,
          errorMessage
        )
      );
    });
  });
}
