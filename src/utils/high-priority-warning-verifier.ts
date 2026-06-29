/**
 * High-priority warning verifier for Phase 3 fix validation
 *
 * @module utils/high-priority-warning-verifier
 *
 * @remarks
 * Provides functionality to verify that Phase 3 fixes for Issues 4 and 5 are
 * effective by checking ESLint results for specific high-priority warning patterns.
 * This is Step 3 of 3 in Task 2 of Milestone 4.1: End-to-End Testing, serving
 * as the code quality warning verification gate.
 *
 * Features:
 * - Consumes ESLintResultReport from P4.M1.T2.S1
 * - Extracts total warning counts by rule (no-console, strict-boolean-expressions)
 * - File-specific warning analysis for priority files
 * - High-priority fix status determination (all counts === 0)
 * - Structured HighPriorityWarningStatus interface
 *
 * @example
 * ```typescript
 * import { verifyHighPriorityWarnings } from './utils/high-priority-warning-verifier.js';
 * import { runESLintAnalysis } from './utils/eslint-result-parser.js';
 *
 * const eslintReport = runESLintAnalysis();
 * const status = verifyHighPriorityWarnings(eslintReport);
 *
 * if (status.highPriorityFixed) {
 *   console.log('✓ All high-priority warnings fixed');
 *   console.log(`  Console warnings: ${status.consoleWarnings}`);
 *   console.log(`  Priority warnings: ${status.priorityWarnings}`);
 * } else {
 *   console.log('✗ High-priority warnings remain:');
 *   console.log(`  src/index.ts no-console: ${status.details.srcIndexNoConsole}`);
 *   console.log(`  prp-runtime.ts strict-boolean: ${status.details.prpRuntimeStrictBoolean}`);
 *   console.log(`  cli/index.ts strict-boolean: ${status.details.cliIndexStrictBoolean}`);
 * }
 * ```
 */

import { getLogger, type Logger } from './logger.js';

let _logger: Logger | undefined;
const logger = (): Logger =>
  (_logger ??= getLogger('HighPriorityWarningVerifier'));

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Input from P4.M1.T2.S1 (run ESLint on entire codebase)
 *
 * @remarks
 * Contains aggregated ESLint results with byRule data and
 * full results for file-specific analysis.
 *
 * Reuses the same interface from eslint-result-parser.ts for consistency.
 */
export interface ESLintResultReport {
  /**
   * Total error count across all files
   * Severity 2 from ESLint results
   */
  readonly errorCount: number;

  /**
   * Total warning count across all files
   * Severity 1 from ESLint results
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
   * Required for file-specific warning count extraction
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

/**
 * Output from P4.M1.T2.S3 (verify high-priority warnings fixed)
 *
 * @remarks
 * Contains high-priority warning verification status with file-specific
 * breakdown for validation gate decision.
 */
export interface HighPriorityWarningStatus {
  /**
   * Total no-console warnings across all files
   * From byRule['no-console']
   */
  readonly consoleWarnings: number;

  /**
   * Total strict-boolean-expressions warnings in priority files
   * Sum of src/agents/prp-runtime.ts and src/cli/index.ts
   */
  readonly priorityWarnings: number;

  /**
   * Whether all high-priority warnings are fixed (all counts === 0)
   * true: src/index.ts has 0 no-console AND priority files have 0 strict-boolean
   * false: Any high-priority warnings remain
   */
  readonly highPriorityFixed: boolean;

  /**
   * File-specific warning counts for debugging
   * Provides detailed breakdown for failed verification
   */
  readonly details: {
    /** no-console warnings in src/index.ts (should be 0) */
    readonly srcIndexNoConsole: number;

    /** strict-boolean-expressions warnings in src/agents/prp-runtime.ts (should be 0) */
    readonly prpRuntimeStrictBoolean: number;

    /** strict-boolean-expressions warnings in src/cli/index.ts (should be 0) */
    readonly cliIndexStrictBoolean: number;
  };
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Target files for high-priority warning verification
 *
 * @remarks
 * These are the files that Phase 3 claimed to fix.
 * Each file has a specific rule that should have 0 warnings.
 */
const TARGET_FILE_PATTERNS = {
  SRC_INDEX: 'src/index.ts',
  PRP_RUNTIME: 'src/agents/prp-runtime.ts',
  CLI_INDEX: 'src/cli/index.ts',
} as const;

/**
 * Rules to check for each target file
 */
const TARGET_RULES = {
  NO_CONSOLE: 'no-console',
  STRICT_BOOLEAN: '@typescript-eslint/strict-boolean-expressions',
} as const;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Builds a high-priority warning status result
 *
 * @remarks
 * Constructs a HighPriorityWarningStatus with all fields for consistent
 * result structure across all code paths.
 */
function buildHighPriorityWarningStatus(
  consoleWarnings: number,
  priorityWarnings: number,
  highPriorityFixed: boolean,
  details: {
    srcIndexNoConsole: number;
    prpRuntimeStrictBoolean: number;
    cliIndexStrictBoolean: number;
  }
): HighPriorityWarningStatus {
  return {
    consoleWarnings,
    priorityWarnings,
    highPriorityFixed,
    details: {
      srcIndexNoConsole: details.srcIndexNoConsole,
      prpRuntimeStrictBoolean: details.prpRuntimeStrictBoolean,
      cliIndexStrictBoolean: details.cliIndexStrictBoolean,
    },
  };
}

/**
 * Extracts file-specific warning counts from ESLint results
 *
 * @remarks
 * Iterates through fullResults to count warnings in specific files.
 * Returns zeros for any file not found or missing fullResults.
 *
 * PATTERN: File path matching uses .endsWith() for reliability
 * GOTCHA: ESLint returns absolute paths in results.filePath
 * SOLUTION: Match files by .endsWith() not === comparison
 * GOTCHA: Windows paths use backslashes, normalize to forward slashes
 * SOLUTION: Replace backslashes before matching
 *
 * @param eslintReport - ESLint result report
 * @returns File-specific warning counts and availability flag
 */
function extractFileSpecificWarnings(eslintReport: ESLintResultReport): {
  srcIndexNoConsole: number;
  prpRuntimeStrictBoolean: number;
  cliIndexStrictBoolean: number;
  fullResultsAvailable: boolean;
} {
  // Initialize all counts to 0
  let srcIndexNoConsole = 0;
  let prpRuntimeStrictBoolean = 0;
  let cliIndexStrictBoolean = 0;

  // Check if fullResults is available
  if (!eslintReport.fullResults) {
    logger().warn(
      'fullResults not available, cannot perform file-specific analysis'
    );
    return {
      srcIndexNoConsole,
      prpRuntimeStrictBoolean,
      cliIndexStrictBoolean,
      fullResultsAvailable: false,
    };
  }

  // Iterate through all file results
  for (const result of eslintReport.fullResults) {
    // Normalize path for cross-platform matching (Windows backslashes to forward slashes)
    const normalizedPath = result.filePath.replace(/\\/g, '/');

    // Match files by .endsWith() for reliable path matching
    // Check src/index.ts for no-console warnings
    if (normalizedPath.endsWith(TARGET_FILE_PATTERNS.SRC_INDEX)) {
      srcIndexNoConsole = result.messages.filter(
        m => m.ruleId === TARGET_RULES.NO_CONSOLE
      ).length;
    }

    // Check src/agents/prp-runtime.ts for strict-boolean-expressions warnings
    if (normalizedPath.endsWith(TARGET_FILE_PATTERNS.PRP_RUNTIME)) {
      prpRuntimeStrictBoolean = result.messages.filter(
        m => m.ruleId === TARGET_RULES.STRICT_BOOLEAN
      ).length;
    }

    // Check src/cli/index.ts for strict-boolean-expressions warnings
    if (normalizedPath.endsWith(TARGET_FILE_PATTERNS.CLI_INDEX)) {
      cliIndexStrictBoolean = result.messages.filter(
        m => m.ruleId === TARGET_RULES.STRICT_BOOLEAN
      ).length;
    }
  }

  logger().debug('File-specific warning counts extracted', {
    srcIndexNoConsole,
    prpRuntimeStrictBoolean,
    cliIndexStrictBoolean,
  });

  return {
    srcIndexNoConsole,
    prpRuntimeStrictBoolean,
    cliIndexStrictBoolean,
    fullResultsAvailable: true,
  };
}

// ============================================================================
// MAIN FUNCTION
// ============================================================================

/**
 * Verifies high-priority warnings are fixed from ESLint analysis results
 *
 * @remarks
 * * PATTERN: Pure function - no external execution
 * Performs data-only analysis on ESLintResultReport from P4.M1.T2.S1.
 *
 * * PATTERN: Always return structured result, never throw
 * Handles all input scenarios gracefully.
 *
 * * PATTERN: Detailed breakdown for debugging
 * Provides file-specific counts in details field.
 *
 * * CONTRACT: P4.M1.T2.S3 - Verify high-priority warnings fixed
 * After ESLint analysis, this function checks specific warning counts
 * in specific files to verify Phase 3 fixes are effective.
 *
 * @param eslintReport - ESLint result report from P4.M1.T2.S1
 * @returns High-priority warning status with all fields
 *
 * @example
 * ```typescript
 * import { runESLintAnalysis } from './utils/eslint-result-parser.js';
 * import { verifyHighPriorityWarnings } from './utils/high-priority-warning-verifier.js';
 *
 * const eslintReport = runESLintAnalysis();
 * const status = verifyHighPriorityWarnings(eslintReport);
 *
 * if (status.highPriorityFixed) {
 *   console.log('✓ All high-priority warnings fixed');
 *   console.log(`  Console warnings: ${status.consoleWarnings}`);
 *   console.log(`  Priority warnings: ${status.priorityWarnings}`);
 * } else {
 *   console.log('✗ High-priority warnings remain:');
 *   console.log(`  src/index.ts no-console: ${status.details.srcIndexNoConsole}`);
 *   console.log(`  prp-runtime.ts strict-boolean: ${status.details.prpRuntimeStrictBoolean}`);
 *   console.log(`  cli/index.ts strict-boolean: ${status.details.cliIndexStrictBoolean}`);
 * }
 * ```
 */
export function verifyHighPriorityWarnings(
  eslintReport: ESLintResultReport | null | undefined
): HighPriorityWarningStatus {
  // Handle null/undefined input gracefully
  if (!eslintReport) {
    logger().warn(
      'verifyHighPriorityWarnings called with null/undefined input'
    );
    return buildHighPriorityWarningStatus(0, 0, false, {
      srcIndexNoConsole: 0,
      prpRuntimeStrictBoolean: 0,
      cliIndexStrictBoolean: 0,
    });
  }

  // Extract total warning counts from byRule
  const consoleWarnings = eslintReport.byRule[TARGET_RULES.NO_CONSOLE] || 0;

  // Extract file-specific warning counts
  const fileSpecificWarnings = extractFileSpecificWarnings(eslintReport);

  // Calculate priority warnings (sum of priority file strict-boolean warnings)
  const priorityWarnings =
    fileSpecificWarnings.prpRuntimeStrictBoolean +
    fileSpecificWarnings.cliIndexStrictBoolean;

  // Determine fix status:
  // - Must have fullResults available (can't verify without it)
  // - All file-specific counts must be 0
  const highPriorityFixed =
    fileSpecificWarnings.fullResultsAvailable &&
    fileSpecificWarnings.srcIndexNoConsole === 0 &&
    fileSpecificWarnings.prpRuntimeStrictBoolean === 0 &&
    fileSpecificWarnings.cliIndexStrictBoolean === 0;

  // Log findings
  if (highPriorityFixed) {
    logger().info('All high-priority warnings fixed', {
      consoleWarnings,
      priorityWarnings,
      srcIndexNoConsole: fileSpecificWarnings.srcIndexNoConsole,
      prpRuntimeStrictBoolean: fileSpecificWarnings.prpRuntimeStrictBoolean,
      cliIndexStrictBoolean: fileSpecificWarnings.cliIndexStrictBoolean,
    });
  } else {
    logger().warn('High-priority warnings remain', {
      consoleWarnings,
      priorityWarnings,
      srcIndexNoConsole: fileSpecificWarnings.srcIndexNoConsole,
      prpRuntimeStrictBoolean: fileSpecificWarnings.prpRuntimeStrictBoolean,
      cliIndexStrictBoolean: fileSpecificWarnings.cliIndexStrictBoolean,
    });
  }

  // Assemble result
  return buildHighPriorityWarningStatus(
    consoleWarnings,
    priorityWarnings,
    highPriorityFixed,
    fileSpecificWarnings
  );
}

// ============================================================================
// DEFAULT EXPORT
// ============================================================================

export default {
  verifyHighPriorityWarnings,
  HighPriorityWarningStatus: undefined as unknown as HighPriorityWarningStatus,
};
