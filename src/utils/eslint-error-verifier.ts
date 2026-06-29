/**
 * ESLint error verifier for code quality validation
 *
 * @module utils/eslint-error-verifier
 *
 * @remarks
 * Provides functionality to verify that the codebase has zero ESLint errors
 * (severity 2) by checking the error count from ESLint analysis and classifying
 * any errors as critical blocking or deferrable. This is Step 2 of 3 in Task 2
 * of Milestone 4.1: End-to-End Testing, serving as the code quality error
 * verification gate.
 *
 * Features:
 * - Consumes ESLintResultReport from P4.M1.T2.S1
 * - Error count check (severity 2 errors only)
 * - Error classification (critical blocking vs deferrable)
 * - Acceptable status determination
 * - Structured ESLintErrorStatus interface
 * - Human-readable error descriptions
 *
 * @example
 * ```typescript
 * import { verifyESLintErrorStatus } from './utils/eslint-error-verifier.js';
 * import { runESLintAnalysis } from './utils/eslint-result-parser.js';
 *
 * const eslintReport = runESLintAnalysis();
 * const status = verifyESLintErrorStatus(eslintReport);
 *
 * if (status.acceptable) {
 *   console.log('✓ No ESLint errors or all errors are deferrable');
 *   if (status.hasErrors) {
 *     console.log(`  Deferrable errors: ${status.errors.length}`);
 *   }
 * } else {
 *   console.log('✗ Critical ESLint errors must be fixed:');
 *   for (const error of status.errors) {
 *     console.log(`  - ${error}`);
 *   }
 * }
 * ```
 */

import { getLogger, type Logger } from './logger.js';
import type { ESLintResultReport } from './eslint-result-parser.js';

let _logger: Logger | undefined;
const logger = (): Logger => (_logger ??= getLogger('ESLintErrorVerifier'));

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Re-export ESLintResultReport for convenience
 *
 * @remarks
 * Input from P4.M1.T2.S1 (run ESLint on entire codebase).
 * Contains aggregated ESLint results with error/warning counts.
 */
export type { ESLintResultReport };

/**
 * Output from P4.M1.T2.S2 (verify no ESLint errors)
 *
 * @remarks
 * Contains ESLint error status with error classification and
 * acceptability determination for validation gate decision.
 */
export interface ESLintErrorStatus {
  /**
   * Whether any ESLint errors (severity 2) exist
   * - true: errorCount > 0
   * - false: errorCount === 0
   */
  readonly hasErrors: boolean;

  /**
   * Array of error descriptions
   * - Empty if no errors (errorCount === 0)
   * - Populated with human-readable descriptions if errors exist
   * - Format: "ruleId: file:line:col - message"
   */
  readonly errors: readonly string[];

  /**
   * Whether all errors are acceptable (no critical blocking errors)
   * - true: errorCount === 0 OR all errors are deferrable
   * - false: At least one critical blocking error exists
   */
  readonly acceptable: boolean;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Critical blocking error rules from .eslintrc.json
 *
 * @remarks
 * These rules are set to severity "error" and must be fixed immediately.
 * They cause CI/CD failures and block deployments.
 *
 * Reference: .eslintrc.json lines 17-28
 */
const CRITICAL_RULES = [
  'prettier/prettier', // Code formatting
  '@typescript-eslint/no-unused-vars', // Unused variables
  '@typescript-eslint/no-floating-promises', // Unhandled promises
  '@typescript-eslint/no-misused-promises', // Promise misuse
] as const;

/**
 * ESLint severity value for errors
 *
 * @remarks
 * ESLint uses numeric severity values:
 * - 0 = off (ignored)
 * - 1 = warning (acceptable per requirement)
 * - 2 = error (must be 0 for task success)
 */
const SEVERITY_ERROR = 2;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Builds an ESLint error status result
 *
 * @remarks
 * Constructs an ESLintErrorStatus with all fields for consistent
 * result structure across all code paths.
 *
 * @param hasErrors - Whether any ESLint errors exist
 * @param errors - Array of error descriptions
 * @param acceptable - Whether all errors are acceptable
 * @returns Complete ESLint error status
 */
function buildESLintErrorStatus(
  hasErrors: boolean,
  errors: readonly string[],
  acceptable: boolean
): ESLintErrorStatus {
  return {
    hasErrors,
    errors,
    acceptable,
  };
}

/**
 * Checks if a rule ID is critical (blocking)
 *
 * @remarks
 * Determines if a given rule ID is in the critical rules list.
 * Critical rules must be fixed immediately and block deployments.
 *
 * @param ruleId - The rule ID to check (can be null)
 * @returns true if the rule is critical, false otherwise
 */
function isCriticalRule(ruleId: string | null): boolean {
  if (ruleId === null) {
    return false;
  }
  return CRITICAL_RULES.includes(ruleId as (typeof CRITICAL_RULES)[number]);
}

/**
 * Classifies errors as critical blocking or deferrable
 *
 * @remarks
 * Parses ESLint results and categorizes errors by rule.
 * Critical errors are blocking, deferrable errors can be fixed later.
 *
 * Handles two scenarios:
 * 1. If fullResults is provided: Parses individual messages for detailed classification
 * 2. If fullResults is missing: Uses byRule for aggregate classification
 *
 * @param eslintReport - ESLint result report
 * @returns Error classification with critical and deferrable arrays
 */
function classifyErrors(eslintReport: ESLintResultReport): {
  criticalErrors: string[];
  deferrableErrors: string[];
} {
  const criticalErrors: string[] = [];
  const deferrableErrors: string[] = [];

  // If no fullResults, use byRule for aggregate classification
  if (!eslintReport.fullResults || eslintReport.fullResults.length === 0) {
    for (const [ruleId, count] of Object.entries(eslintReport.byRule)) {
      const errorDesc = `${ruleId}: ${count} error(s)`;
      if (CRITICAL_RULES.includes(ruleId as (typeof CRITICAL_RULES)[number])) {
        criticalErrors.push(errorDesc);
      } else {
        deferrableErrors.push(errorDesc);
      }
    }
    return { criticalErrors, deferrableErrors };
  }

  // Parse full results for detailed classification
  const cwd = process.cwd();
  for (const fileResult of eslintReport.fullResults) {
    for (const message of fileResult.messages) {
      // Only process severity 2 (errors)
      if (message.severity !== SEVERITY_ERROR) continue;

      const ruleId = message.ruleId ?? 'no-rule-id';
      const relativePath = fileResult.filePath
        .replace(cwd, '')
        .replace(/^\//, '');
      const errorDesc = `${ruleId}: ${relativePath}:${message.line}:${message.column} - ${message.message}`;

      // Classify as critical or deferrable
      if (isCriticalRule(message.ruleId)) {
        criticalErrors.push(errorDesc);
      } else {
        deferrableErrors.push(errorDesc);
      }
    }
  }

  return { criticalErrors, deferrableErrors };
}

/**
 * Extracts human-readable error descriptions from ESLint results
 *
 * @remarks
 * Formats errors as "ruleId: file:line:col - message".
 * Transforms absolute paths to relative paths for readability.
 *
 * If fullResults is provided, extracts detailed error descriptions.
 * Otherwise, uses byRule for aggregate descriptions.
 *
 * @param eslintReport - ESLint result report
 * @returns Array of error descriptions
 */
function extractErrorDescriptions(eslintReport: ESLintResultReport): string[] {
  const errors: string[] = [];

  // If no fullResults, build from byRule
  if (!eslintReport.fullResults || eslintReport.fullResults.length === 0) {
    for (const [ruleId, count] of Object.entries(eslintReport.byRule)) {
      errors.push(`${ruleId}: ${count} error(s)`);
    }
    return errors;
  }

  // Parse full results for detailed descriptions
  const cwd = process.cwd();
  for (const fileResult of eslintReport.fullResults) {
    for (const message of fileResult.messages) {
      // Only process severity 2 (errors)
      if (message.severity !== SEVERITY_ERROR) continue;

      // Transform absolute path to relative
      const relativePath = fileResult.filePath
        .replace(cwd, '')
        .replace(/^\//, '');
      const ruleId = message.ruleId ?? 'no-rule-id';

      errors.push(
        `${ruleId}: ${relativePath}:${message.line}:${message.column} - ${message.message}`
      );
    }
  }

  return errors;
}

// ============================================================================
// MAIN FUNCTION
// ============================================================================

/**
 * Verifies ESLint error status from ESLint analysis results
 *
 * @remarks
 * * PATTERN: Pure function - no external execution
 * Performs data-only analysis on ESLintResultReport from P4.M1.T2.S1.
 *
 * * PATTERN: Always return structured result, never throw
 * Handles all input scenarios gracefully.
 *
 * * PATTERN: Short-circuit on success
 * If errorCount === 0, return success immediately without further analysis.
 *
 * * CONTRACT: Verify no ESLint errors per implementation_patterns.md
 * After ESLint analysis, this function checks error count and classifies
 * any errors as critical blocking or deferrable for validation gate decision.
 *
 * @param eslintReport - ESLint result report from P4.M1.T2.S1
 * @returns ESLint error status with all fields
 *
 * @example
 * ```typescript
 * import { runESLintAnalysis } from './utils/eslint-result-parser.js';
 * import { verifyESLintErrorStatus } from './utils/eslint-error-verifier.js';
 *
 * const eslintReport = runESLintAnalysis();
 * const status = verifyESLintErrorStatus(eslintReport);
 *
 * if (status.acceptable) {
 *   console.log('✓ No ESLint errors or all errors are deferrable');
 *   if (status.hasErrors) {
 *     console.log(`  Deferrable errors: ${status.errors.length}`);
 *     for (const error of status.errors) {
 *       console.log(`    - ${error}`);
 *     }
 *   }
 * } else {
 *   console.log('✗ Critical ESLint errors must be fixed:');
 *   for (const error of status.errors) {
 *     console.log(`  - ${error}`);
 *   }
 * }
 * ```
 */
export function verifyESLintErrorStatus(
  eslintReport: ESLintResultReport | null | undefined
): ESLintErrorStatus {
  // Handle null/undefined input gracefully
  if (!eslintReport) {
    logger().warn('verifyESLintErrorStatus called with null/undefined input');
    return buildESLintErrorStatus(false, [], false);
  }

  // Check error count (only severity 2 errors matter)
  const hasErrors = eslintReport.errorCount > 0;

  // Short-circuit: no errors means success
  if (!hasErrors) {
    logger().info('No ESLint errors detected', {
      errorCount: eslintReport.errorCount,
      warningCount: eslintReport.warningCount,
    });
    return buildESLintErrorStatus(false, [], true);
  }

  // Classify errors
  const errorClassification = classifyErrors(eslintReport);

  // Extract error descriptions
  const errorDescriptions = extractErrorDescriptions(eslintReport);

  // Determine acceptable status (no critical blocking errors)
  const acceptable = errorClassification.criticalErrors.length === 0;

  // Log findings
  if (acceptable) {
    logger().info('ESLint errors are all deferrable', {
      totalErrors: eslintReport.errorCount,
      deferrableErrors: errorClassification.deferrableErrors.length,
    });
  } else {
    logger().warn('Critical ESLint errors detected', {
      totalErrors: eslintReport.errorCount,
      criticalErrors: errorClassification.criticalErrors.length,
      deferrableErrors: errorClassification.deferrableErrors.length,
    });
  }

  // Assemble result
  return buildESLintErrorStatus(hasErrors, errorDescriptions, acceptable);
}

// ============================================================================
// DEFAULT EXPORT
// ============================================================================

export default {
  verifyESLintErrorStatus,
  ESLintErrorStatus: undefined as unknown as ESLintErrorStatus,
};
