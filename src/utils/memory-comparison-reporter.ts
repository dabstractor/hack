/**
 * Memory usage comparison reporter
 *
 * @module utils/memory-comparison-reporter
 *
 * @remarks
 * Provides functionality to compare documented "before" state (Issue 2:
 * Worker terminated due to memory limit) against actual "after" state
 * (P2.M1.T2.S2 test suite execution result) to verify that the 4GB
 * memory limit from P2.M1.T1 successfully resolves memory exhaustion.
 *
 * Features:
 * - Pure function comparison (no external execution)
 * - Hardcoded "before" state from Issue 2 documentation
 * - Structured result with improved flag and state descriptions
 * - Detailed metrics for programmatic analysis
 * - Structured logging using existing logger
 *
 * @example
 * ```typescript
 * import { compareMemoryUsage } from './utils/memory-comparison-reporter.js';
 *
 * const comparison = compareMemoryUsage(s2Result);
 *
 * if (comparison.improved) {
 *   console.log('Memory improvement confirmed!');
 *   console.log(`Before: ${comparison.beforeState}`);
 *   console.log(`After: ${comparison.afterState}`);
 * }
 * ```
 */

import { getLogger, type Logger } from './logger.js';
import type { FullTestSuiteResult } from './full-test-suite-runner.js';

let _logger: Logger | undefined;
const logger = (): Logger =>
  (_logger ??= getLogger('MemoryComparisonReporter'));

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Detailed comparison metrics for before/after states
 *
 * @remarks
 * Provides structured data for programmatic analysis of the
 * memory usage comparison. Includes completion status, memory
 * error status, and test results.
 */
export interface MemoryComparisonDetails {
  /** Whether the before state completed execution (always false - Issue 2) */
  readonly beforeCompleted: boolean;

  /** Whether the after state completed execution (from S2 result) */
  readonly afterCompleted: boolean;

  /** Whether the before state had memory errors (always true - Issue 2) */
  readonly beforeHadMemoryErrors: boolean;

  /** Whether the after state had memory errors (from S2 result) */
  readonly afterHadMemoryErrors: boolean;

  /** Test results from after state (null if parsing failed or OOM occurred) */
  readonly testResults: { pass: number; fail: number; total: number } | null;
}

/**
 * Result of before/after memory usage comparison
 *
 * @remarks
 * Returned by {@link compareMemoryUsage} to indicate whether the
 * memory limit fix from P2.M1.T1 successfully resolved Issue 2.
 *
 * @example
 * ```typescript
 * const result = compareMemoryUsage(s2Result);
 * if (result.improved) {
 *   console.log('Memory issue resolved!');
 *   console.log(`Before: ${result.beforeState}`);
 *   console.log(`After: ${result.afterState}`);
 * }
 * ```
 */
export interface MemoryComparisonResult {
  /** Whether the after state is improved compared to before state */
  readonly improved: boolean;

  /** Human-readable description of the before state (Issue 2) */
  readonly beforeState: string;

  /** Human-readable description of the after state (from S2 result) */
  readonly afterState: string;

  /** Structured details for programmatic analysis */
  readonly details: MemoryComparisonDetails;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Hardcoded "before" state from Issue 2
 *
 * @remarks
 * This is the documented state from TEST_RESULTS.md Issue 2:
 * "Worker terminated due to reaching memory limit: JS heap out of memory"
 *
 * The test suite failed to complete due to memory exhaustion before
 * the P2.M1.T1 memory limit fix was applied.
 */
const BEFORE_STATE =
  'Worker terminated due to reaching memory limit: JS heap out of memory (Issue 2)';

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Builds a comparison result
 *
 * @remarks
 * Constructs a MemoryComparisonResult with all fields for consistent
 * result structure across all code paths.
 *
 * @param improved - Whether improvement occurred
 * @param beforeState - Before state description
 * @param afterState - After state description
 * @param details - Detailed comparison metrics
 * @returns Result object
 */
function buildComparisonResult(
  improved: boolean,
  beforeState: string,
  afterState: string,
  details: MemoryComparisonDetails
): MemoryComparisonResult {
  return {
    improved,
    beforeState,
    afterState,
    details,
  };
}

/**
 * Generates after state description
 *
 * @remarks
 * Builds a human-readable description of the "after" state based on
 * the FullTestSuiteResult from P2.M1.T2.S2.
 *
 * Includes test counts if available, and indicates memory error status.
 *
 * @param result - Full test suite result from S2
 * @returns Human-readable after state string
 */
function generateAfterState(result: FullTestSuiteResult): string {
  if (!result.completed) {
    if (result.memoryErrors) {
      return 'Test suite failed to complete - Memory errors detected';
    }
    return 'Test suite failed to complete';
  }

  if (result.memoryErrors) {
    return 'Test suite completed - Memory errors detected';
  }

  // No memory errors - check if we have test results
  if (result.testResults) {
    const { pass, fail, total } = result.testResults;
    return `Test suite completed: ${pass} passed, ${fail} failed (${total} total) - No memory errors detected`;
  }

  return 'Test suite completed - No memory errors detected';
}

// ============================================================================
// MAIN FUNCTION
// ============================================================================

/**
 * Compares before/after memory usage
 *
 * @remarks
 * * PATTERN: Pure function - no external execution
 * This function performs a data-only comparison between the documented
 * "before" state (Issue 2) and the actual "after" state (S2 result).
 *
 * * PATTERN: Always return structured result, never throw
 * Handles all input scenarios gracefully, returning a result object
 * even with invalid input.
 *
 * * PATTERN: Hardcoded before state
 * The before state is from TEST_RESULTS.md Issue 2 and is not
 * dynamic or captured at runtime.
 *
 * * PATTERN: Improved determination
 * improved = afterCompleted === true && afterHadMemoryErrors === false
 * Test failures don't affect the improved flag - only memory errors.
 *
 * * CONTRACT: Verify P2.M1.T1 memory limits resolved Issue 2
 * After P2.M1.T1 adds NODE_OPTIONS to test scripts, this function
 * verifies the memory limit fix successfully resolved the OOM issue.
 *
 * @param suiteResult - Full test suite result from P2.M1.T2.S2
 * @returns Memory comparison result with improvement status
 *
 * @example
 * ```typescript
 * import { runFullTestSuite } from './utils/full-test-suite-runner.js';
 * import { compareMemoryUsage } from './utils/memory-comparison-reporter.js';
 *
 * const s2Result = await runFullTestSuite(s1Result);
 * const comparison = compareMemoryUsage(s2Result);
 *
 * if (comparison.improved) {
 *   console.log('Memory improvement confirmed!');
 *   console.log(`Before: ${comparison.beforeState}`);
 *   console.log(`After: ${comparison.afterState}`);
 *   console.log(`Tests: ${comparison.details.testResults?.total ?? 0}`);
 * } else {
 *   console.log('No memory improvement detected');
 * }
 * ```
 */
export function compareMemoryUsage(
  suiteResult: FullTestSuiteResult | null | undefined
): MemoryComparisonResult {
  // Handle null/undefined input gracefully
  if (!suiteResult) {
    logger().warn('compareMemoryUsage called with null/undefined input');
    return buildComparisonResult(
      false,
      BEFORE_STATE,
      'Invalid input: suiteResult is null or undefined',
      {
        beforeCompleted: false,
        afterCompleted: false,
        beforeHadMemoryErrors: true,
        afterHadMemoryErrors: false, // Unknown, assume false
        testResults: null,
      }
    );
  }

  // Extract after state metrics
  const afterCompleted = suiteResult.completed;
  const afterHadMemoryErrors = suiteResult.memoryErrors;
  const testResults = suiteResult.testResults;

  // Determine improvement: completed AND no memory errors
  const improved = afterCompleted && !afterHadMemoryErrors;

  // Generate after state description
  const afterState = generateAfterState(suiteResult);

  // Build details object
  const details: MemoryComparisonDetails = {
    beforeCompleted: false, // Always false for Issue 2
    afterCompleted,
    beforeHadMemoryErrors: true, // Always true for Issue 2
    afterHadMemoryErrors,
    testResults,
  };

  // Log findings
  logger().debug('Memory usage comparison details', {
    improved,
    beforeState: BEFORE_STATE,
    afterState,
    details,
  });

  if (improved) {
    logger().info('Memory improvement confirmed', {
      before: BEFORE_STATE,
      after: afterState,
      testResults,
    });
  } else {
    logger().warn('No memory improvement detected', {
      before: BEFORE_STATE,
      after: afterState,
      afterCompleted,
      afterHadMemoryErrors,
    });
  }

  return buildComparisonResult(improved, BEFORE_STATE, afterState, details);
}
