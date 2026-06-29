/**
 * ESLint result parser utility for code quality validation
 *
 * @module utils/eslint-result-parser
 *
 * @remarks
 * Provides functionality to execute ESLint on the entire codebase and
 * parse the output to extract error counts, warning counts, categorize
 * by rule, and identify top files with most warnings.
 *
 * Features:
 * - ESLint execution with JSON output parsing
 * - Error/warning count aggregation across all files
 * - Rule-specific violation categorization
 * - Top 10 files identification by warning count
 * - Graceful error handling with zero-count fallbacks
 * - Structured result for validation gates
 *
 * @example
 * ```typescript
 * import { runESLintAnalysis } from './utils/eslint-result-parser.js';
 *
 * const report = runESLintAnalysis();
 *
 * console.log(`ESLint Results: ${report.errorCount} errors, ${report.warningCount} warnings`);
 *
 * // Show rule breakdown
 * for (const [rule, count] of Object.entries(report.byRule)) {
 *   console.log(`  ${rule}: ${count}`);
 * }
 *
 * // Show top files
 * console.log('Top files with warnings:');
 * for (const file of report.topFiles) {
 *   console.log(`  - ${file}`);
 * }
 * ```
 */

import { execSync } from 'node:child_process';
import { getLogger, type Logger } from './logger.js';

let _logger: Logger | undefined;
const logger = (): Logger => (_logger ??= getLogger('ESLintResultParser'));

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Output from P4.M1.T2.S1 (run ESLint on entire codebase)
 *
 * @remarks
 * Contains aggregated ESLint results with error/warning counts,
 * rule categorization, and top problematic files identification.
 */
export interface ESLintResultReport {
  /**
   * Total error count across all files
   * Aggregated from ESLint results (severity 2 messages)
   */
  readonly errorCount: number;

  /**
   * Total warning count across all files
   * Aggregated from ESLint results (severity 1 messages)
   */
  readonly warningCount: number;

  /**
   * Rule-specific violation counts
   * Key: ruleId (e.g., '@typescript-eslint/strict-boolean-expressions', 'no-console')
   * Value: count of violations
   */
  readonly byRule: Record<string, number>;

  /**
   * Top 10 files with most warnings
   * Sorted by warning count (descending)
   * Format: relative file paths from project root
   */
  readonly topFiles: readonly string[];

  /**
   * Full ESLint results for detailed analysis
   * Optional: include only if detailed reporting needed
   * Can be omitted to reduce memory footprint
   */
  readonly fullResults?: readonly ESLintFileResult[];
}

/**
 * ESLint result for a single file
 *
 * @remarks
 * Matches ESLint JSON formatter output structure
 */
export interface ESLintFileResult {
  /** Absolute file path */
  readonly filePath: string;

  /** All messages (errors and warnings) for this file */
  readonly messages: readonly ESLintMessage[];

  /** Error count (severity 2) */
  readonly errorCount: number;

  /** Warning count (severity 1) */
  readonly warningCount: number;

  /** Fatal error count (parsing failures) */
  readonly fatalErrorCount: number;

  /** Fixable error count */
  readonly fixableErrorCount: number;

  /** Fixable warning count */
  readonly fixableWarningCount: number;
}

/**
 * Individual ESLint message
 *
 * @remarks
 * Matches ESLint LintMessage structure
 */
export interface ESLintMessage {
  /** Rule that triggered this message (null if no rule) */
  readonly ruleId: string | null;

  /** Severity: 0=off, 1=warning, 2=error */
  readonly severity: number;

  /** Human-readable message */
  readonly message: string;

  /** Line number (1-indexed) */
  readonly line: number;

  /** Column number (1-indexed) */
  readonly column: number;

  /** End line (if multiline) */
  readonly endLine?: number;

  /** End column (if multiline) */
  readonly endColumn?: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * ESLint command to run with JSON output
 *
 * @remarks
 * Uses npm run lint script for consistency with project conventions.
 * The --format json flag produces machine-readable output for parsing.
 */
const ESLINT_COMMAND = 'npm run lint -- --format json';

/**
 * Default number of top files to include in report
 */
const DEFAULT_TOP_FILES_LIMIT = 10;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Builds an ESLint result report with all fields
 *
 * @remarks
 * Constructs a consistent ESLintResultReport across all code paths.
 * Ensures all fields are present and correctly typed.
 *
 * @param errorCount - Total error count
 * @param warningCount - Total warning count
 * @param byRule - Rule-specific counts
 * @param topFiles - Top files with most warnings
 * @param fullResults - Optional full ESLint results
 * @returns Complete ESLint result report
 */
function buildESLintResultReport(
  errorCount: number,
  warningCount: number,
  byRule: Record<string, number>,
  topFiles: readonly string[],
  fullResults?: readonly ESLintFileResult[]
): ESLintResultReport {
  return {
    errorCount,
    warningCount,
    byRule: { ...byRule },
    topFiles: [...topFiles],
    ...(fullResults && { fullResults }),
  };
}

/**
 * Executes ESLint with JSON output
 *
 * @remarks
 * Runs ESLint via npm script and captures stdout/stderr.
 * Handles non-zero exit codes (ESLint returns non-zero on warnings/errors).
 *
 * PATTERN: Reference scripts/categorize-eslint-warnings.ts:542-545
 *
 * @returns JSON string output from ESLint, or empty string on failure
 */
function executeESLint(): string {
  try {
    const output = execSync(ESLINT_COMMAND, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'], // Capture stderr
    });

    logger().info('ESLint execution completed');
    return output;
  } catch (error) {
    // ESLint returns non-zero exit code on warnings/errors
    // Check if we have stdout (results) despite the error
    if (
      error !== null &&
      error !== undefined &&
      typeof error === 'object' &&
      'stdout' in error
    ) {
      const stdout = (error as { stdout: string }).stdout;
      if (stdout && stdout.length > 0) {
        logger().warn('ESLint found warnings/errors', {
          exitCode: (error as { status?: number }).status,
        });
        return stdout;
      }
    }

    // Real error - log and return empty string
    logger().error('ESLint execution failed', { error });
    return '';
  }
}

/**
 * Parses ESLint JSON output to structured results
 *
 * @remarks
 * Validates JSON structure and filters out invalid results.
 *
 * PATTERN: Reference scripts/categorize-eslint-warnings.ts:330-343
 *
 * @param jsonOutput - Raw JSON string from ESLint
 * @returns Parsed ESLint file results
 */
function parseESLintJSON(jsonOutput: string): ESLintFileResult[] {
  try {
    const parsed = JSON.parse(jsonOutput) as unknown[];

    // Validate it's an array
    if (!Array.isArray(parsed)) {
      logger().error('ESLint output is not an array');
      return [];
    }

    // Validate each result has required fields
    return parsed.filter(
      (result: unknown) =>
        result !== null &&
        result !== undefined &&
        typeof result === 'object' &&
        'filePath' in result &&
        'messages' in result &&
        'errorCount' in result &&
        'warningCount' in result
    ) as ESLintFileResult[];
  } catch (error) {
    logger().error('Failed to parse ESLint JSON output', { error });
    return [];
  }
}

/**
 * Aggregates error and warning counts across all files
 *
 * @remarks
 * Sums errorCount and warningCount from all ESLint results.
 *
 * @param results - Parsed ESLint file results
 * @returns Aggregated error and warning counts
 */
function aggregateCounts(results: ESLintFileResult[]): {
  errorCount: number;
  warningCount: number;
} {
  let errorCount = 0;
  let warningCount = 0;

  for (const result of results) {
    errorCount += result.errorCount;
    warningCount += result.warningCount;
  }

  logger().debug('ESLint counts aggregated', { errorCount, warningCount });

  return { errorCount, warningCount };
}

/**
 * Categorizes ESLint messages by rule ID
 *
 * @remarks
 * Counts all messages (warnings and errors) by their ruleId.
 * Handles null ruleId by grouping as 'no-rule-id'.
 *
 * PATTERN: Reference scripts/categorize-eslint-warnings.ts:351-378
 *
 * @param results - Parsed ESLint file results
 * @returns Record mapping ruleId to violation count
 */
function categorizeByRule(results: ESLintFileResult[]): Record<string, number> {
  const byRule: Record<string, number> = {};

  for (const result of results) {
    for (const message of result.messages) {
      // Handle null ruleId (parsing errors)
      const ruleId =
        message.ruleId !== null && message.ruleId !== undefined
          ? message.ruleId
          : 'no-rule-id';

      // Count all messages (both warnings and errors)
      byRule[ruleId] = (byRule[ruleId] || 0) + 1;
    }
  }

  // Log top rules for debugging
  const topRules = Object.entries(byRule)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);

  logger().debug('ESLint rule breakdown', { topRules });

  return byRule;
}

/**
 * Identifies top files with most warnings
 *
 * @remarks
 * Converts absolute paths to relative, filters files with zero warnings,
 * sorts by warning count (descending), and limits to top N.
 *
 * @param results - Parsed ESLint file results
 * @param limit - Maximum number of files to return (default: 10)
 * @returns Array of relative file paths sorted by warning count
 */
function identifyTopFiles(
  results: ESLintFileResult[],
  limit: number = DEFAULT_TOP_FILES_LIMIT
): string[] {
  // Convert absolute paths to relative
  const cwd = process.cwd();

  const topFiles = results
    .map(result => ({
      file: result.filePath.replace(cwd, '').replace(/^\//, ''),
      warnings: result.warningCount,
      errors: result.errorCount,
    }))
    .filter(f => f.warnings > 0) // Only files with warnings
    .sort((a, b) => b.warnings - a.warnings) // Descending by warnings
    .slice(0, limit)
    .map(f => f.file);

  logger().debug('Top files with warnings', { topFiles: topFiles.slice(0, 5) });

  return topFiles;
}

// ============================================================================
// MAIN FUNCTION
// ============================================================================

/**
 * Runs ESLint on entire codebase and parses results
 *
 * @remarks
 * * PATTERN: Pure function - executes ESLint and returns structured result
 * * PATTERN: Always return structured result, never throw for execution failures
 * * PATTERN: Zero-count protection - returns zeros if ESLint fails
 *
 * CONTRACT: P4.M1.T2.S1 - Execute ESLint and parse output
 * After execution, returns structured report with error/warning counts,
 * rule categorization, and top problematic files identification.
 *
 * This enables:
 * - P4.M1.T2.S2: Verify no ESLint errors (check errorCount === 0)
 * - P4.M1.T2.S3: Verify high-priority warnings fixed (check byRule for specific rules)
 * - P4.M2: Documentation & Handoff (ESLint results for bug fix summary)
 *
 * @returns ESLint result report with all metrics
 *
 * @example
 * ```typescript
 * import { runESLintAnalysis } from './utils/eslint-result-parser.js';
 *
 * const report = runESLintAnalysis();
 *
 * // Check for errors (validation gate)
 * if (report.errorCount > 0) {
 *   console.error(`ESLint found ${report.errorCount} errors`);
 *   process.exit(1);
 * }
 *
 * // Check warnings
 * console.log(`ESLint Results: ${report.errorCount} errors, ${report.warningCount} warnings`);
 *
 * // Show rule breakdown
 * for (const [rule, count] of Object.entries(report.byRule)) {
 *   console.log(`  ${rule}: ${count}`);
 * }
 *
 * // Show top files
 * console.log('Top files with warnings:');
 * for (const file of report.topFiles) {
 *   console.log(`  - ${file}`);
 * }
 * ```
 */
export function runESLintAnalysis(): ESLintResultReport {
  // Execute ESLint
  const eslintOutput = executeESLint();

  // Handle execution failure
  if (!eslintOutput) {
    logger().warn('ESLint execution failed, returning zero counts');
    return buildESLintResultReport(0, 0, {}, [], []);
  }

  // Parse JSON output
  const results = parseESLintJSON(eslintOutput);

  // Handle parsing failure
  if (results.length === 0) {
    logger().warn('ESLint parsing failed, returning zero counts');
    return buildESLintResultReport(0, 0, {}, [], []);
  }

  // Aggregate counts
  const { errorCount, warningCount } = aggregateCounts(results);

  // Categorize by rule
  const byRule = categorizeByRule(results);

  // Identify top files
  const topFiles = identifyTopFiles(results, DEFAULT_TOP_FILES_LIMIT);

  // Assemble result (include fullResults for detailed analysis)
  const report = buildESLintResultReport(
    errorCount,
    warningCount,
    byRule,
    topFiles,
    results
  );

  logger().info('ESLint analysis completed', {
    errorCount,
    warningCount,
    totalRules: Object.keys(byRule).length,
    topFilesCount: topFiles.length,
  });

  return report;
}

// ============================================================================
// DEFAULT EXPORT
// ============================================================================

export default {
  runESLintAnalysis,
  ESLintResultReport: undefined as unknown as ESLintResultReport,
};
