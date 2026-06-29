/**
 * Issue resolution verifier for memory and promise errors
 *
 * @module utils/issue-resolution-verifier
 *
 * @remarks
 * Provides functionality to verify that Issues 2 and 3 from the bug fix
 * documentation are resolved by checking for memory errors and promise
 * rejections in test output. This is Step 3 of 3 in Task 1 of Milestone 4.1:
 * End-to-End Testing, serving as the final error verification gate.
 *
 * Features:
 * - Consumes TestSuiteResult from P4.M1.T1.S1
 * - Memory error resolution check using existing detectMemoryErrorInTestOutput
 * - Promise rejection resolution check with 3 patterns
 * - Resolution status determination for Issues 2 and 3
 * - Remaining issues documentation for follow-up
 * - Structured IssueResolutionStatus interface
 *
 * @example
 * ```typescript
 * import { verifyNoMemoryOrPromiseErrors } from './utils/issue-resolution-verifier.js';
 * import type { TestSuiteResult } from './utils/pass-rate-analyzer.js';
 *
 * const testResult: TestSuiteResult = {
 *   completed: true,
 *   results: { pass: 1688, fail: 0, total: 1688 },
 *   hasMemoryErrors: false,
 *   hasPromiseRejections: false,
 *   executionTime: 245.5,
 *   output: '...',
 *   exitCode: 0
 * };
 *
 * const status = verifyNoMemoryOrPromiseErrors(testResult);
 *
 * if (status.allResolved) {
 *   console.log('✓ Both issues resolved');
 *   console.log(`  Memory issues: ${status.memoryIssuesResolved ? 'resolved' : 'present'}`);
 *   console.log(`  Promise issues: ${status.promiseIssuesResolved ? 'resolved' : 'present'}`);
 * } else {
 *   console.log('✗ Issues remain:');
 *   for (const issue of status.remainingIssues) {
 *     console.log(`  - ${issue}`);
 *   }
 * }
 * ```
 */

import { getLogger, type Logger } from './logger.js';
import { detectMemoryErrorInTestOutput } from './memory-error-detector.js';

let _logger: Logger | undefined;
const logger = (): Logger => (_logger ??= getLogger('IssueResolutionVerifier'));

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Input from test suite execution (P4.M1.T1.S1)
 *
 * @remarks
 * Contains complete test execution results. This task consumes
 * the hasMemoryErrors, hasPromiseRejections, output, and exitCode fields.
 *
 * Reuses the same interface from pass-rate-analyzer.ts for consistency.
 */
export interface TestSuiteResult {
  /** Whether the test suite completed execution */
  readonly completed: boolean;

  /** Test result statistics */
  readonly results: {
    readonly pass: number;
    readonly fail: number;
    readonly total: number;
  };

  /** Whether memory errors were detected */
  readonly hasMemoryErrors: boolean;

  /** Whether promise rejections were detected */
  readonly hasPromiseRejections: boolean;

  /** Execution time in seconds */
  readonly executionTime: number;

  /** Full test output for analysis */
  readonly output: string;

  /** Process exit code */
  readonly exitCode: number;
}

/**
 * Output from P4.M1.T1.S3 (verify no memory or promise errors)
 *
 * @remarks
 * Contains resolution status for Issues 2 and 3, with detailed
 * error analysis and remaining issue documentation.
 */
export interface IssueResolutionStatus {
  /**
   * Whether Issue 2 (memory problems) is resolved
   * - true: No memory errors detected (flag is false AND no patterns in output)
   * - false: Memory errors still present
   */
  readonly memoryIssuesResolved: boolean;

  /**
   * Whether Issue 3 (promise rejections) is resolved
   * - true: No promise rejections detected (flag is false AND no patterns in output)
   * - false: Promise rejections still present
   */
  readonly promiseIssuesResolved: boolean;

  /**
   * Array of remaining issue descriptions
   * - Empty if both issues resolved
   * - Populated with human-readable descriptions if issues persist
   */
  readonly remainingIssues: readonly string[];

  /**
   * Detailed analysis of detected errors (for debugging)
   */
  readonly errorDetails: {
    /**
     * Names of matched memory error patterns
     * Empty if no memory errors detected
     */
    readonly memoryErrors: readonly string[];

    /**
     * Names of matched promise rejection patterns
     * Empty if no promise rejections detected
     */
    readonly promiseRejections: readonly string[];
  };

  /**
   * Overall resolution status
   * - true: Both issues resolved (all flags true)
   * - false: At least one issue still exists
   */
  readonly allResolved: boolean;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Promise rejection error patterns to detect
 *
 * @remarks
 * Covers all common Node.js promise rejection patterns:
 * - PromiseRejectionHandledWarning: async handling (Issue 3 pattern)
 * - UnhandledPromiseRejectionWarning: unhandled (more severe)
 * - Uncaught PromiseRejection: variant pattern
 *
 * Reference: vitest-parsing-quick-reference.md Section 6
 */
const PROMISE_REJECTION_PATTERNS = {
  /** Promise rejection was handled asynchronously (Issue 3 pattern) */
  handledWarning: /PromiseRejectionHandledWarning/i,

  /** Promise rejection was never handled */
  unhandledWarning: /UnhandledPromiseRejectionWarning/i,

  /** Uncaught promise rejection variant */
  uncaughtRejection: /Uncaught PromiseRejection/i,
} as const;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Builds an issue resolution status result
 *
 * @remarks
 * Constructs an IssueResolutionStatus with all fields for consistent
 * result structure across all code paths.
 */
function buildIssueResolutionStatus(
  memoryIssuesResolved: boolean,
  promiseIssuesResolved: boolean,
  remainingIssues: readonly string[],
  memoryErrorPatterns: readonly string[],
  promiseRejectionPatterns: readonly string[]
): IssueResolutionStatus {
  const allResolved = memoryIssuesResolved && promiseIssuesResolved;

  return {
    memoryIssuesResolved,
    promiseIssuesResolved,
    remainingIssues,
    errorDetails: {
      memoryErrors: memoryErrorPatterns,
      promiseRejections: promiseRejectionPatterns,
    },
    allResolved,
  };
}

/**
 * Checks memory issue resolution
 *
 * @remarks
 * Uses existing detectMemoryErrorInTestOutput function from memory-error-detector.ts.
 * Resolution = hasMemoryErrors flag is false AND no patterns detected in output.
 *
 * PATTERN: Double-check using both flags and output parsing
 * GOTCHA: Flags may be false but patterns still present in output
 * SOLUTION: Always verify with pattern matching
 *
 * @param hasMemoryErrors - Boolean flag from TestSuiteResult
 * @param output - Full test output for pattern matching
 * @param exitCode - Process exit code for memory error detection
 * @returns Resolution status and matched patterns
 */
function checkMemoryIssueResolution(
  hasMemoryErrors: boolean,
  output: string,
  exitCode: number
): { resolved: boolean; matchedPatterns: string[] } {
  // Use existing detection function from memory-error-detector.ts
  const detectionResult = detectMemoryErrorInTestOutput(output, exitCode);

  // Resolution = flag is false AND no patterns detected
  const resolved = !hasMemoryErrors && !detectionResult.hasMemoryError;

  // Collect matched patterns for error details
  const matchedPatterns: string[] = [];
  if (detectionResult.hasMemoryError && detectionResult.matchedPattern) {
    matchedPatterns.push(detectionResult.matchedPattern);
  }

  logger().debug('Memory issue resolution check', {
    hasMemoryErrors,
    detectedMemoryError: detectionResult.hasMemoryError,
    resolved,
    matchedPatterns,
  });

  return { resolved, matchedPatterns };
}

/**
 * Checks promise rejection resolution
 *
 * @remarks
 * Implements promise rejection detection using 3 patterns.
 * Resolution = hasPromiseRejections flag is false AND no patterns detected in output.
 *
 * PATTERN: Similar to memory error resolution check
 * GOTCHA: Must check ALL 3 patterns for Issue 3 resolution
 *
 * Reference: vitest-parsing-quick-reference.md Section 6
 *
 * @param hasPromiseRejections - Boolean flag from TestSuiteResult
 * @param output - Full test output for pattern matching
 * @returns Resolution status and matched patterns
 */
function checkPromiseIssueResolution(
  hasPromiseRejections: boolean,
  output: string
): { resolved: boolean; matchedPatterns: string[] } {
  // Check for all 3 promise rejection patterns
  const matchedPatterns: string[] = [];

  for (const [name, pattern] of Object.entries(PROMISE_REJECTION_PATTERNS)) {
    if (pattern.test(output)) {
      matchedPatterns.push(name);
    }
  }

  // Resolution = flag is false AND no patterns detected
  const resolved = !hasPromiseRejections && matchedPatterns.length === 0;

  logger().debug('Promise rejection resolution check', {
    hasPromiseRejections,
    patternsFound: matchedPatterns.length,
    resolved,
    matchedPatterns,
  });

  return { resolved, matchedPatterns };
}

/**
 * Builds remaining issues array
 *
 * @remarks
 * Creates human-readable descriptions of unresolved issues.
 * Empty array if both issues resolved, populated otherwise.
 *
 * @param memoryResolved - Whether memory issues are resolved
 * @param promiseResolved - Whether promise issues are resolved
 * @returns Array of issue descriptions
 */
function buildRemainingIssues(
  memoryResolved: boolean,
  promiseResolved: boolean
): string[] {
  const issues: string[] = [];

  if (!memoryResolved) {
    issues.push(
      'Issue 2: Memory errors still present - ' +
        '"Worker terminated due to reaching memory limit: JS heap out of memory" ' +
        'or related memory error patterns detected in test output'
    );
  }

  if (!promiseResolved) {
    issues.push(
      'Issue 3: Promise rejections still present - ' +
        '"PromiseRejectionHandledWarning" or related promise rejection patterns ' +
        'detected in test output'
    );
  }

  return issues;
}

// ============================================================================
// MAIN FUNCTION
// ============================================================================

/**
 * Verifies no memory or promise errors in test output
 *
 * @remarks
 * * PATTERN: Pure function - no external execution
 * Performs data-only analysis on TestSuiteResult from P4.M1.T1.S1.
 *
 * * PATTERN: Always return structured result, never throw
 * Handles all input scenarios gracefully.
 *
 * * PATTERN: Double-check using both flags and output parsing
 * Resolution = !flag && !patternsFound
 * GOTCHA: Flags may be false but patterns still present in output
 *
 * * PATTERN: Use existing detectMemoryErrorInTestOutput function
 * Don't reimplement memory error detection.
 *
 * * CONTRACT: Verify Issues 2 and 3 are resolved
 * After test suite execution, this function checks for memory errors
 * and promise rejections to determine if the bug fixes resolved Issues 2 and 3.
 *
 * @param testResult - Test suite result from P4.M1.T1.S1
 * @returns Issue resolution status with all fields
 *
 * @example
 * ```typescript
 * import { runFullTestSuite } from './utils/full-test-suite-runner.js';
 * import { verifyNoMemoryOrPromiseErrors } from './utils/issue-resolution-verifier.js';
 *
 * const testResult = await runFullTestSuite(s1Result);
 * const status = verifyNoMemoryOrPromiseErrors(testResult);
 *
 * if (status.allResolved) {
 *   console.log('✓ Both Issue 2 and Issue 3 resolved');
 *   console.log(`  Memory issues: ${status.memoryIssuesResolved ? 'resolved' : 'present'}`);
 *   console.log(`  Promise issues: ${status.promiseIssuesResolved ? 'resolved' : 'present'}`);
 * } else {
 *   console.log('✗ Issues remain:');
 *   for (const issue of status.remainingIssues) {
 *     console.log(`  - ${issue}`);
 *   }
 *   if (status.errorDetails.memoryErrors.length > 0) {
 *     console.log(`Memory error patterns: ${status.errorDetails.memoryErrors.join(', ')}`);
 *   }
 *   if (status.errorDetails.promiseRejections.length > 0) {
 *     console.log(`Promise patterns: ${status.errorDetails.promiseRejections.join(', ')}`);
 *   }
 * }
 * ```
 */
export function verifyNoMemoryOrPromiseErrors(
  testResult: TestSuiteResult | null | undefined
): IssueResolutionStatus {
  // Handle null/undefined input gracefully
  if (!testResult) {
    logger().warn(
      'verifyNoMemoryOrPromiseErrors called with null/undefined input'
    );
    return buildIssueResolutionStatus(
      false,
      false,
      ['Invalid input: testResult is null or undefined'],
      [],
      []
    );
  }

  logger().debug('Verifying issue resolution for Issues 2 and 3', {
    hasMemoryErrors: testResult.hasMemoryErrors,
    hasPromiseRejections: testResult.hasPromiseRejections,
    exitCode: testResult.exitCode,
  });

  // Task 2: Check Issue 2 (memory errors) resolution
  const memoryCheck = checkMemoryIssueResolution(
    testResult.hasMemoryErrors,
    testResult.output,
    testResult.exitCode
  );

  // Task 3: Check Issue 3 (promise rejections) resolution
  const promiseCheck = checkPromiseIssueResolution(
    testResult.hasPromiseRejections,
    testResult.output
  );

  // Task 4: Build remaining issues array
  const remainingIssues = buildRemainingIssues(
    memoryCheck.resolved,
    promiseCheck.resolved
  );

  // Task 7: Assemble result
  const status = buildIssueResolutionStatus(
    memoryCheck.resolved,
    promiseCheck.resolved,
    remainingIssues,
    memoryCheck.matchedPatterns,
    promiseCheck.matchedPatterns
  );

  // Log findings
  if (status.allResolved) {
    logger().info('Both Issue 2 and Issue 3 resolved', {
      memoryIssuesResolved: status.memoryIssuesResolved,
      promiseIssuesResolved: status.promiseIssuesResolved,
    });
  } else {
    logger().warn('Issues remain unresolved', {
      memoryIssuesResolved: status.memoryIssuesResolved,
      promiseIssuesResolved: status.promiseIssuesResolved,
      remainingIssues: status.remainingIssues,
      errorDetails: status.errorDetails,
    });
  }

  return status;
}

// ============================================================================
// DEFAULT EXPORT
// ============================================================================

export default {
  verifyNoMemoryOrPromiseErrors,
  IssueResolutionStatus: undefined as unknown as IssueResolutionStatus,
};
