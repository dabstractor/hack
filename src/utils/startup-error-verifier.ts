/**
 * Startup error verifier for runtime error detection
 *
 * @module utils/startup-error-verifier
 *
 * @remarks
 * Provides functionality to parse CLI startup output and detect runtime
 * errors that TypeScript compilation may miss. This is the second verification
 * step after CLI help execution in P1.M2.T1.
 *
 * Features:
 * - Consumes CliHelpResult from P1.M2.T1.S1
 * - Parses combined stdout/stderr for error patterns
 * - Detects module not found errors (ES and CommonJS)
 * - Detects runtime errors and stack traces
 * - Returns structured result with error categorization
 * - Mock-friendly design for comprehensive unit testing
 *
 * @example
 * ```typescript
 * import { verifyStartupErrors } from './utils/startup-error-verifier.js';
 * import { executeCliHelp } from './utils/cli-help-executor.js';
 *
 * const helpResult = await executeCliHelp();
 * const errorResult = verifyStartupErrors(helpResult);
 *
 * if (errorResult.hasErrors) {
 *   console.error('Startup errors detected:', errorResult.errorTypes);
 * } else {
 *   console.log('Clean startup verified');
 * }
 * ```
 */

import type { CliHelpResult } from './cli-help-executor.js';
import { getLogger, type Logger } from './logger.js';

let _logger: Logger | undefined;
const logger = (): Logger => (_logger ??= getLogger('StartupErrorVerifier'));

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Result of startup error verification
 *
 * @remarks
 * Returned by {@link verifyStartupErrors} to indicate whether the CLI
 * startup had any runtime errors in the output.
 *
 * @example
 * ```typescript
 * const result = verifyStartupErrors(helpResult);
 * if (!result.hasErrors) {
 *   console.log('Clean startup - milestone complete');
 * }
 * ```
 */
export interface StartupErrorResult {
  /** Whether any runtime errors were detected in the output */
  hasErrors: boolean;

  /** List of error type categories detected (empty if hasErrors is false) */
  errorTypes: readonly string[];

  /** Raw error strings extracted from output (for debugging) */
  rawErrors: readonly string[];

  /** Human-readable status message */
  message: string;
}

/**
 * Parsed runtime errors from output
 *
 * @remarks
 * Internal structure for error parsing results before being
 * transformed into StartupErrorResult.
 */
interface ParsedRuntimeErrors {
  /** Module not found errors detected */
  hasModuleNotFoundError: boolean;

  /** General runtime errors detected */
  hasRuntimeError: boolean;

  /** Stack traces detected */
  hasStackTrace: boolean;

  /** Extracted error strings */
  errorStrings: string[];
}

/**
 * Error type categories for startup verification
 *
 * @remarks
 * Standardized error type strings used in errorTypes array.
 *
 * Valid error categories:
 * - 'MODULE_NOT_FOUND' - ERR_MODULE_NOT_FOUND, Cannot find module
 * - 'RUNTIME_ERROR' - General Error: patterns
 * - 'STACK_TRACE' - Stack traces detected
 * - 'SPAWN_ERROR' - Process spawn failure (from CliHelpResult.error)
 */

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Regex patterns for runtime error detection
 *
 * @remarks
 * Compiled regex patterns for efficient error detection.
 * All patterns are case-insensitive (i flag) for flexibility.
 *
 * Patterns:
 * - MODULE_NOT_FOUND_ES: Matches "Error [ERR_MODULE_NOT_FOUND]"
 * - MODULE_NOT_FOUND_COMMONJS: Matches "Error: Cannot find module '...'"
 * - RUNTIME_ERROR: Matches "Error: <message>"
 * - STACK_TRACE: Matches "at functionName(" or "at ["
 * - GROUNDSWELL_MISSING: Matches "Cannot find module 'groundswell'"
 */
const ERROR_PATTERNS = {
  /** ES Module not found: Error [ERR_MODULE_NOT_FOUND]: ... */
  MODULE_NOT_FOUND_ES: /Error\s+\[ERR_MODULE_NOT_FOUND\]/i,

  /** CommonJS module not found: Error: Cannot find module '...' */
  MODULE_NOT_FOUND_COMMONJS:
    /Error:\s+Cannot find module\s+['"`]([^'"`]+)['"`]/i,

  /** General runtime error: Error: ... (global flag for matchAll) */
  RUNTIME_ERROR: /Error:\s+(.+)/gi,

  /** Stack trace indicator: at functionName, at [filename], or at /path/to/file */
  STACK_TRACE: /at\s+(?:\w+\s*\(|\[|\/)/i,

  /** Groundswell-specific module error (research note compliance) */
  GROUNDSWELL_MISSING: /Cannot find module\s+['"`]groundswell['"`]/i,
} as const;

// ============================================================================
// MAIN FUNCTION
// ============================================================================

/**
 * Verifies no runtime errors in CLI startup output
 *
 * @remarks
 * * PATTERN: Early return when success is false (spawn failed)
 * If CliHelpResult.success is false, the process didn't execute correctly.
 * Return hasErrors: true immediately with SPAWN_ERROR type.
 *
 * * PATTERN: Parse combined output for error patterns
 * The output field contains combined stdout + stderr from S1.
 * Use regex to detect module not found, runtime errors, stack traces.
 *
 * * PATTERN: Categorize errors for structured response
 * Group detected errors by type: MODULE_NOT_FOUND, RUNTIME_ERROR, STACK_TRACE.
 * Enables automated response based on error category.
 *
 * * PATTERN: Return structured result, don't throw
 * Allows pipeline to continue even on startup failure.
 * hasErrors flag indicates whether startup was clean.
 *
 * @param helpResult - CliHelpResult from executeCliHelp()
 * @returns StartupErrorResult with error detection status
 *
 * @example
 * ```typescript
 * const helpResult = await executeCliHelp();
 * const verification = verifyStartupErrors(helpResult);
 *
 * if (!verification.hasErrors) {
 *   console.log('Clean startup - milestone complete');
 * }
 * ```
 */
export function verifyStartupErrors(
  helpResult: CliHelpResult
): StartupErrorResult {
  // PATTERN: Early return when spawn failed (success is false)
  if (!helpResult.success) {
    const spawnError = helpResult.error || 'Unknown spawn error';

    logger().warn(`CLI spawn failed: ${spawnError}`);

    return {
      hasErrors: true,
      errorTypes: ['SPAWN_ERROR'],
      rawErrors: [spawnError],
      message: `CLI process failed to start: ${spawnError}`,
    };
  }

  // Parse output for runtime error patterns
  const parsed = parseRuntimeErrors(helpResult.output);

  // Build error types array
  const errorTypes: string[] = [];

  if (parsed.hasModuleNotFoundError) {
    errorTypes.push('MODULE_NOT_FOUND');
  }

  if (parsed.hasRuntimeError) {
    errorTypes.push('RUNTIME_ERROR');
  }

  if (parsed.hasStackTrace) {
    errorTypes.push('STACK_TRACE');
  }

  const hasErrors = errorTypes.length > 0;

  if (hasErrors) {
    logger().warn(`Runtime errors detected: ${errorTypes.join(', ')}`);
  } else {
    logger().debug('Clean startup - no runtime errors detected');
  }

  return {
    hasErrors,
    errorTypes,
    rawErrors: parsed.errorStrings,
    message: generateErrorMessage(
      hasErrors,
      errorTypes,
      parsed.errorStrings.length
    ),
  };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Parses CLI output for runtime error patterns
 *
 * @remarks
 * Searches combined stdout/stderr for error indicators:
 * - ERR_MODULE_NOT_FOUND: ES module resolution failure
 * - Cannot find module: CommonJS module resolution failure
 * - Error:: General runtime errors
 * - at [: Stack trace indicators
 *
 * Returns structured detection results for error categorization.
 *
 * @param output - Combined stdout/stderr from CLI execution
 * @returns ParsedRuntimeErrors with detection status
 */
function parseRuntimeErrors(output: string): ParsedRuntimeErrors {
  const result: ParsedRuntimeErrors = {
    hasModuleNotFoundError: false,
    hasRuntimeError: false,
    hasStackTrace: false,
    errorStrings: [],
  };

  // Check for ES Module not found error
  if (ERROR_PATTERNS.MODULE_NOT_FOUND_ES.test(output)) {
    result.hasModuleNotFoundError = true;

    // Extract error message
    const match = output.match(ERROR_PATTERNS.MODULE_NOT_FOUND_ES);
    if (match) {
      result.errorStrings.push(match[0]);
    }
  }

  // Check for CommonJS module not found error
  if (ERROR_PATTERNS.MODULE_NOT_FOUND_COMMONJS.test(output)) {
    result.hasModuleNotFoundError = true;

    // Extract module name from error
    const match = output.match(ERROR_PATTERNS.MODULE_NOT_FOUND_COMMONJS);
    if (match && match[1]) {
      result.errorStrings.push(`Cannot find module '${match[1]}'`);
    }
  }

  // Check for Groundswell-specific error (research note compliance)
  if (ERROR_PATTERNS.GROUNDSWELL_MISSING.test(output)) {
    result.hasModuleNotFoundError = true;

    const match = output.match(ERROR_PATTERNS.GROUNDSWELL_MISSING);
    if (match) {
      result.errorStrings.push(match[0]);
    }
  }

  // Check for general runtime errors
  const runtimeErrorMatches = output.matchAll(ERROR_PATTERNS.RUNTIME_ERROR);
  for (const match of runtimeErrorMatches) {
    if (match[1]) {
      result.hasRuntimeError = true;
      result.errorStrings.push(match[1]);
    }
  }

  // Check for stack traces
  if (ERROR_PATTERNS.STACK_TRACE.test(output)) {
    result.hasStackTrace = true;
  }

  return result;
}

/**
 * Generates human-readable error message
 *
 * @remarks
 * Creates descriptive message explaining the verification result,
 * including error types and count of raw errors detected.
 *
 * @param hasErrors - Whether errors were detected
 * @param errorTypes - List of error type categories
 * @param errorCount - Number of raw error strings
 * @returns Human-readable status message
 */
function generateErrorMessage(
  hasErrors: boolean,
  errorTypes: string[],
  errorCount: number
): string {
  if (!hasErrors) {
    return 'Clean startup - no runtime errors detected in CLI output.';
  }

  const typeList = errorTypes.sort().join(', ');
  const countStr = errorCount > 0 ? ` (${errorCount} error(s))` : '';

  return `Runtime errors detected: ${typeList}${countStr}`;
}
