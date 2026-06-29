/**
 * Pass rate analysis utility for test suite validation
 *
 * @module utils/pass-rate-analyzer
 *
 * @remarks
 * Provides functionality to analyze test suite pass rates against
 * baseline metrics (94.34% from TEST_RESULTS.md) and determine if
 * improvements meet expectations for validation gates.
 *
 * Features:
 * - Pass rate calculation with zero-division protection
 * - Baseline comparison (94.34% from 1593/1688)
 * - Delta calculation (can be negative for degraded)
 * - Improved flag determination (>= baseline or 100%)
 * - Failing test extraction from output (JSON and CLI)
 * - Failure classification (acceptable/unacceptable)
 * - Structured result with all metrics
 *
 * @example
 * ```typescript
 * import { analyzePassRate } from './utils/pass-rate-analyzer.js';
 * import type { TestSuiteResult } from './utils/full-test-suite-runner.js';
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
 * const analysis = analyzePassRate(testResult);
 *
 * if (analysis.improved) {
 *   console.log(`Pass rate improved: ${analysis.passRate}% (baseline: ${analysis.baselinePassRate}%)`);
 *   console.log(`Delta: +${analysis.delta}%`);
 * } else {
 *   console.log(`Pass rate: ${analysis.passRate}% (below baseline: ${analysis.baselinePassRate}%)`);
 *   console.log(`Failing tests: ${analysis.failingTests.length}`);
 * }
 * ```
 */

import { getLogger, type Logger } from './logger.js';

let _logger: Logger | undefined;
const logger = (): Logger => (_logger ??= getLogger('PassRateAnalyzer'));

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Input from test suite execution (P4.M1.T1.S1)
 *
 * @remarks
 * Contains complete test execution results. This task consumes
 * the `results` and `output` fields for pass rate analysis.
 *
 * @see FullTestSuiteResult from full-test-suite-runner.ts (similar structure)
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
 * Output from pass rate analysis (P4.M1.T1.S2)
 *
 * @remarks
 * Contains pass rate analysis, baseline comparison, and failure details.
 * Used for validation gate decision and progress tracking.
 */
export interface PassRateAnalysis {
  /**
   * Current test pass rate as percentage (0-100)
   * Calculated: (passedCount / totalCount) * 100
   * Rounded to 2 decimal places
   */
  readonly passRate: number;

  /**
   * Baseline pass rate from Issue 2 documentation
   * Fixed: 94.37 (calculated from 1593/1688)
   */
  readonly baselinePassRate: number;

  /**
   * Target pass rate (all tests should pass)
   * Fixed: 100.00
   */
  readonly targetPassRate: number;

  /**
   * Whether pass rate meets or exceeds baseline
   * true if: passRate >= baselinePassRate OR passRate === 100
   */
  readonly improved: boolean;

  /**
   * Difference between current and baseline pass rate
   * Calculated: passRate - baselinePassRate
   * Can be negative (degraded) or positive (improved)
   */
  readonly delta: number;

  /** Absolute test counts (for reporting) */
  readonly passedCount: number;
  readonly failedCount: number;
  readonly totalCount: number;

  /**
   * List of failing test names extracted from output
   * Empty array if all tests pass
   * Format: "path/to/test.test.ts > describe > test name"
   */
  readonly failingTests: readonly string[];

  /**
   * Whether all failures are acceptable/expected
   * For this codebase: TRUE only if no failures OR all match known issues
   */
  readonly allFailuresAcceptable: boolean;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Baseline pass rate from TEST_RESULTS.md
 *
 * @remarks
 * Calculated from: 1593 passing / 1688 total = 94.3720...%
 * Rounded to 2 decimal places: 94.37
 *
 * CRITICAL: Use 94.37, not 94.3 for accurate delta calculation
 * 100.00 - 94.37 = 5.63 (correct)
 * 100.00 - 94.3 = 5.7 (incorrect)
 */
const BASELINE_PASS_RATE = Math.round((1593 / 1688) * 10000) / 100; // 94.37

/**
 * Target pass rate (all tests should pass)
 */
const TARGET_PASS_RATE = 100.0;

/**
 * Known failing tests from Issue 6 documentation
 *
 * @remarks
 * Tests that are documented as failing and acceptable for now.
 * Only these specific failures are considered "acceptable".
 */
const KNOWN_FAILURES = [
  'tests/unit/core/research-queue.test.ts > should create PRPGenerator with sessionManager',
] as const;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Builds a pass rate analysis result
 *
 * @remarks
 * Constructs a PassRateAnalysis with all fields for consistent
 * result structure across all code paths.
 */
function buildPassRateAnalysis(
  passRate: number,
  passedCount: number,
  failedCount: number,
  totalCount: number,
  failingTests: readonly string[]
): PassRateAnalysis {
  const delta = Math.round((passRate - BASELINE_PASS_RATE) * 100) / 100;
  const improved =
    passRate >= BASELINE_PASS_RATE || passRate === TARGET_PASS_RATE;
  const allFailuresAcceptable = classifyFailures(failingTests);

  return {
    passRate,
    baselinePassRate: BASELINE_PASS_RATE,
    targetPassRate: TARGET_PASS_RATE,
    improved,
    delta,
    passedCount,
    failedCount,
    totalCount,
    failingTests,
    allFailuresAcceptable,
  };
}

/**
 * Calculates pass rate with zero-division protection
 *
 * @remarks
 * PATTERN from src/utils/progress.ts:291-310
 * const percentage = total > 0 ? (completed / total) * 100 : 0;
 *
 * @param passed - Number of passed tests
 * @param total - Total number of tests
 * @returns Pass rate rounded to 2 decimal places
 */
function calculatePassRate(passed: number, total: number): number {
  // Zero-division protection
  if (total === 0) {
    return 0;
  }

  // Calculate percentage
  const rawRate = (passed / total) * 100;

  // Round to 2 decimal places
  return Math.round(rawRate * 100) / 100;
}

/**
 * Extracts failing tests from JSON reporter output
 *
 * @remarks
 * Attempts to parse output as JSON and extract failing test names.
 * Returns empty array if parsing fails (will try CLI parsing next).
 */
function extractFailingTestsFromJson(output: string): string[] {
  try {
    const results = JSON.parse(output);

    // Handle Vitest JSON format
    if (results.testResults && Array.isArray(results.testResults)) {
      return results.testResults.flatMap((suite: unknown) => {
        if (
          suite &&
          typeof suite === 'object' &&
          'assertionResults' in suite &&
          Array.isArray(suite.assertionResults)
        ) {
          return suite.assertionResults
            .filter(
              (test: unknown) =>
                test &&
                typeof test === 'object' &&
                'status' in test &&
                test.status === 'failed' &&
                'fullName' in test &&
                typeof test.fullName === 'string'
            )
            .map((test: { fullName: string }) => test.fullName);
        }
        return [];
      });
    }
  } catch {
    // Not valid JSON, return empty array
  }

  return [];
}

/**
 * Extracts failing tests from CLI output
 *
 * @remarks
 * Parses Vitest CLI output format for failing test names.
 * Handles both summary lines and detailed failure blocks.
 *
 * Patterns:
 * - File header: ❯ filename (85 tests | 21 failed)
 * - Test failure: FAIL filename > describe > test name
 * - Detailed failure: ❯ filename > describe > test name
 */
function extractFailingTestsFromCLI(output: string): string[] {
  const patterns = {
    // Match file header with failures: ❯ filename (85 tests | 21 failed)
    fileHeader: /[❯]\s+(.+?)\s+\(\d+\s+tests?\s*\|\s*\d+\s+failed\)/,
    // Match individual test failures: FAIL path > test name
    testFailure: /\sFAIL\s+(.+?)\s*>\s+(.+?)(?=\n|$)/,
    // Match detailed failure blocks
    detailedFailure: /\s❯\s+(.+?)\s*>\s*(.+?)(?=\n\n|$)/,
  };

  const failingTests: string[] = [];
  const lines = output.split('\n');
  let currentFile = '';

  for (const line of lines) {
    // Match file with failures
    const fileMatch = line.match(patterns.fileHeader);
    if (fileMatch) {
      currentFile = fileMatch[1].trim();
      continue;
    }

    // Match individual test failures
    const failureMatch =
      line.match(patterns.testFailure) || line.match(patterns.detailedFailure);
    if (failureMatch && currentFile) {
      const testName = failureMatch[2].trim();
      failingTests.push(`${currentFile} > ${testName}`);
    }
  }

  return failingTests;
}

/**
 * Extracts failing test names from test output
 *
 * @remarks
 * Tries JSON parsing first (most reliable), falls back to CLI regex patterns.
 *
 * @param output - Full test output string
 * @returns Array of failing test names (empty if none)
 */
function extractFailingTests(output: string): string[] {
  // Try JSON first (most reliable)
  const jsonTests = extractFailingTestsFromJson(output);
  if (jsonTests.length > 0) {
    return jsonTests;
  }

  // Fallback to CLI parsing
  return extractFailingTestsFromCLI(output);
}

/**
 * Classifies failures as acceptable or unacceptable
 *
 * @remarks
 * For this codebase:
 * - No failures = acceptable (true)
 * - All failures match known issues = acceptable (true)
 * - Any other failures = unacceptable (false)
 *
 * @param failingTests - Array of failing test names
 * @returns true if all failures are acceptable
 */
function classifyFailures(failingTests: readonly string[]): boolean {
  // No failures = acceptable
  if (failingTests.length === 0) {
    return true;
  }

  // Check if all failures are in known list
  return failingTests.every(test =>
    KNOWN_FAILURES.some(known => test.includes(known))
  );
}

// ============================================================================
// MAIN FUNCTION
// ============================================================================

/**
 * Analyzes test pass rate against baseline
 *
 * @remarks
 * * PATTERN: Pure function - no external execution
 * Performs data-only analysis on TestSuiteResult from P4.M1.T1.S1.
 *
 * * PATTERN: Always return structured result, never throw
 * Handles all input scenarios gracefully.
 *
 * * PATTERN: Zero-division protection
 * Returns pass rate of 0 if total is 0 (crash scenario).
 *
 * * CONTRACT: Verify P4.M1.T1.S1 pass rate meets expectations
 * After test suite execution, this function calculates pass rate
 * and compares against baseline (94.34%) to determine if improvements
 * meet validation gate requirements.
 *
 * @param testResult - Test suite result from P4.M1.T1.S1
 * @returns Pass rate analysis with all metrics
 *
 * @example
 * ```typescript
 * import { runFullTestSuite } from './utils/full-test-suite-runner.js';
 * import { analyzePassRate } from './utils/pass-rate-analyzer.js';
 *
 * const testResult = await runFullTestSuite();
 * const analysis = analyzePassRate(testResult);
 *
 * if (analysis.improved) {
 *   console.log('✓ Pass rate meets or exceeds baseline');
 *   console.log(`  Current: ${analysis.passRate}%`);
 *   console.log(`  Baseline: ${analysis.baselinePassRate}%`);
 *   console.log(`  Delta: ${analysis.delta > 0 ? '+' : ''}${analysis.delta}%`);
 * } else {
 *   console.log('✗ Pass rate below baseline');
 *   console.log(`  Current: ${analysis.passRate}%`);
 *   console.log(`  Baseline: ${analysis.baselinePassRate}%`);
 *   console.log(`  Delta: ${analysis.delta}%`);
 * }
 *
 * if (analysis.failingTests.length > 0) {
 *   console.log(`Failing tests (${analysis.failingTests.length}):`);
 *   for (const test of analysis.failingTests) {
 *     console.log(`  - ${test}`);
 *   }
 * }
 * ```
 */
export function analyzePassRate(
  testResult: TestSuiteResult | null | undefined
): PassRateAnalysis {
  // Handle null/undefined input gracefully
  if (!testResult) {
    logger().warn('analyzePassRate called with null/undefined input');
    return buildPassRateAnalysis(0, 0, 0, 0, []);
  }

  const {
    pass: passedCount,
    fail: failedCount,
    total: totalCount,
  } = testResult.results;

  // Calculate pass rate with zero-division protection
  const passRate = calculatePassRate(passedCount, totalCount);

  // Extract failing tests from output
  const failingTests = extractFailingTests(testResult.output);

  // Build analysis result
  const analysis = buildPassRateAnalysis(
    passRate,
    passedCount,
    failedCount,
    totalCount,
    failingTests
  );

  // Log findings
  logger().debug('Pass rate analysis details', {
    passRate: analysis.passRate,
    baselinePassRate: analysis.baselinePassRate,
    delta: analysis.delta,
    improved: analysis.improved,
    passedCount,
    failedCount,
    totalCount,
    failingTestsCount: failingTests.length,
    allFailuresAcceptable: analysis.allFailuresAcceptable,
  });

  if (analysis.improved) {
    logger().info('Pass rate meets or exceeds baseline', {
      passRate: analysis.passRate,
      baseline: analysis.baselinePassRate,
      delta: analysis.delta,
    });
  } else {
    logger().warn('Pass rate below baseline', {
      passRate: analysis.passRate,
      baseline: analysis.baselinePassRate,
      delta: analysis.delta,
    });
  }

  if (failingTests.length > 0) {
    logger().warn(`Failing tests detected: ${failingTests.length}`, {
      failingTests,
      allFailuresAcceptable: analysis.allFailuresAcceptable,
    });
  }

  return analysis;
}

// ============================================================================
// DEFAULT EXPORT
// ============================================================================

export default {
  analyzePassRate,
  PassRateAnalysis: undefined as unknown as PassRateAnalysis,
};
