/**
 * CLI options verifier for help output validation
 *
 * @module utils/cli-options-verifier
 *
 * @remarks
 * Provides functionality to parse CLI help output and detect expected
 * option flags. This is the third verification step after CLI help
 * execution (P1.M2.T1.S1) and startup error verification (P1.M2.T1.S2).
 *
 * Features:
 * - Consumes StartupErrorResult from P1.M2.T1.S2
 * - Parses help output for expected option flags
 * - Detects --prd, --verbose, --scope, --validate-prd options
 * - Returns structured result with option detection status
 * - Mock-friendly design for comprehensive unit testing
 *
 * @example
 * ```typescript
 * import { verifyCliOptions } from './utils/cli-options-verifier.js';
 * import { verifyStartupErrors } from './utils/startup-error-verifier.js';
 *
 * const errorResult = verifyStartupErrors(helpResult);
 * const optionsResult = verifyCliOptions(errorResult, helpResult.output);
 *
 * if (optionsResult.allOptionsPresent) {
 *   console.log('All CLI options verified');
 * }
 * ```
 */

import type { StartupErrorResult } from './startup-error-verifier.js';
import { getLogger, type Logger } from './logger.js';

let _logger: Logger | undefined;
const logger = (): Logger => (_logger ??= getLogger('CliOptionsVerifier'));

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Result of CLI options verification
 *
 * @remarks
 * Returned by {@link verifyCliOptions} to indicate which expected CLI
 * options were detected in the help output.
 *
 * @example
 * ```typescript
 * const result = verifyCliOptions(errorResult, helpOutput);
 * if (!result.allOptionsPresent) {
 *   console.error('Missing options:', result.missingOptions);
 * }
 * ```
 */
export interface CliOptionsResult {
  /** List of expected option flags detected in help output */
  optionsPresent: readonly string[];

  /** True if all 4 expected options were found */
  allOptionsPresent: boolean;

  /** List of expected options not found (empty if all present) */
  missingOptions: readonly string[];

  /** Human-readable status message */
  message: string;
}

/**
 * Parsed option flags from help output
 *
 * @remarks
 * Internal structure for option parsing results before being
 * transformed into CliOptionsResult.
 */
interface ParsedOptions {
  /** Option flags detected */
  flagsFound: string[];

  /** Option flags not found */
  flagsNotFound: string[];
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Expected CLI options to verify
 *
 * @remarks
 * These 4 options must be present in CLI help output for verification
 * to pass. Specified in work item and implementation_patterns.md.
 */
const EXPECTED_CLI_OPTIONS = [
  '--prd', // Path to PRD markdown file
  '--verbose', // Enable debug logging
  '--scope', // Scope identifier (e.g., "P3.M4")
  '--validate-prd', // Validate PRD and exit
] as const;

/**
 * Regex patterns for option flag detection
 *
 * @remarks
 * Compiled regex patterns for efficient option detection.
 * All patterns are case-sensitive for exact flag matching.
 *
 * Patterns match option flag followed by spaces/tabs (not newlines) and
 * description text. Using [ \t]+ instead of \s+ prevents matching across
 * newlines to the next line's option flag (e.g., -h, --help).
 */
const OPTION_PATTERNS = {
  /** Matches --prd option with description */
  PRD_OPTION: /--prd[ \t]+\S+/,

  /** Matches --verbose option with description */
  VERBOSE_OPTION: /--verbose[ \t]+\S+/,

  /** Matches --scope option with description */
  SCOPE_OPTION: /--scope[ \t]+\S+/,

  /** Matches --validate-prd option with description */
  VALIDATE_PRD_OPTION: /--validate-prd[ \t]+\S+/,
} as const;

// ============================================================================
// MAIN FUNCTION
// ============================================================================

/**
 * Verifies expected CLI options are displayed in help output
 *
 * @remarks
 * * PATTERN: Early return when hasErrors is true (startup failed)
 * If StartupErrorResult.hasErrors is true, don't check options.
 * Return allOptionsPresent: false immediately with all options marked missing.
 *
 * * PATTERN: Parse help output for option flags
 * Use regex to detect expected options: --prd, --verbose, --scope, --validate-prd
 * Verify each option has description text following the flag.
 *
 * * PATTERN: Return structured result, don't throw
 * Allows pipeline to continue even on option verification failure.
 * allOptionsPresent flag indicates whether all options were detected.
 *
 * * NOTE: Help output source
 * This implementation accepts help output as a parameter.
 * In actual integration, helpOutput should come from CliHelpResult.output.
 *
 * @param errorResult - StartupErrorResult from verifyStartupErrors()
 * @param helpOutput - Optional help output from CLI execution
 * @returns CliOptionsResult with option detection status
 *
 * @example
 * ```typescript
 * const errorResult = verifyStartupErrors(helpResult);
 * const verification = verifyCliOptions(errorResult, helpResult.output);
 *
 * if (verification.allOptionsPresent) {
 *   console.log('All CLI options present - milestone complete');
 * }
 * ```
 */
export function verifyCliOptions(
  errorResult: StartupErrorResult,
  helpOutput?: string
): CliOptionsResult {
  // PATTERN: Early return when startup had errors
  if (errorResult.hasErrors) {
    logger().warn(
      `Skipping CLI options verification due to startup errors: ${errorResult.errorTypes.join(', ')}`
    );

    return {
      optionsPresent: [],
      allOptionsPresent: false,
      missingOptions: [...EXPECTED_CLI_OPTIONS],
      message: 'CLI options verification skipped: startup errors detected',
    };
  }

  // PATTERN: Get help output from parameter or use empty string
  // In actual implementation, helpOutput should come from pipeline context
  const output = helpOutput || '';

  // Parse output for option flags
  const parsed = parseOptionFlags(output);

  // Build missing options array
  const missingOptions = EXPECTED_CLI_OPTIONS.filter(
    option => !parsed.flagsFound.includes(option)
  );

  const allOptionsPresent = missingOptions.length === 0;

  if (allOptionsPresent) {
    logger().debug('All expected CLI options detected in help output');
  } else {
    logger().warn(`Missing CLI options: ${missingOptions.join(', ')}`);
  }

  return {
    optionsPresent: parsed.flagsFound,
    allOptionsPresent,
    missingOptions,
    message: generateOptionsMessage(
      parsed.flagsFound,
      missingOptions,
      allOptionsPresent
    ),
  };
}

// ============================================================================
// OPTION PARSING HELPER
// ============================================================================

/**
 * Parses help output for expected option flags
 *
 * @remarks
 * Searches help output for the 4 expected CLI options:
 * - --prd: Path to PRD markdown file
 * - --verbose: Enable debug logging
 * - --scope: Scope identifier (e.g., "P3.M4")
 * - --validate-prd: Validate PRD and exit
 *
 * Uses regex patterns to match each option flag with its description.
 * Only adds option to flagsFound if both flag and description are present.
 *
 * @param output - Help output from CLI execution
 * @returns ParsedOptions with detection status
 */
function parseOptionFlags(output: string): ParsedOptions {
  const flagsFound: string[] = [];

  // Check for --prd option
  if (OPTION_PATTERNS.PRD_OPTION.test(output)) {
    flagsFound.push('--prd');
  }

  // Check for --verbose option
  if (OPTION_PATTERNS.VERBOSE_OPTION.test(output)) {
    flagsFound.push('--verbose');
  }

  // Check for --scope option
  if (OPTION_PATTERNS.SCOPE_OPTION.test(output)) {
    flagsFound.push('--scope');
  }

  // Check for --validate-prd option
  if (OPTION_PATTERNS.VALIDATE_PRD_OPTION.test(output)) {
    flagsFound.push('--validate-prd');
  }

  // Find missing options
  const flagsNotFound = EXPECTED_CLI_OPTIONS.filter(
    option => !flagsFound.includes(option)
  );

  return {
    flagsFound,
    flagsNotFound,
  };
}

// ============================================================================
// MESSAGE GENERATION HELPER
// ============================================================================

/**
 * Generates human-readable options verification message
 *
 * @remarks
 * Creates descriptive message explaining the verification result,
 * including which options were found and which are missing.
 *
 * @param optionsPresent - List of options detected
 * @param missingOptions - List of options not found
 * @param allPresent - Whether all options were detected
 * @returns Human-readable status message
 */
function generateOptionsMessage(
  optionsPresent: string[],
  missingOptions: string[],
  allPresent: boolean
): string {
  if (allPresent) {
    return `All expected CLI options detected: ${EXPECTED_CLI_OPTIONS.join(', ')}`;
  }

  const foundStr =
    optionsPresent.length > 0
      ? `Found: ${optionsPresent.join(', ')}`
      : 'No options found';
  const missingStr =
    missingOptions.length > 0 ? `Missing: ${missingOptions.join(', ')}` : '';

  return `CLI options verification incomplete. ${foundStr}${missingStr ? `. ${missingStr}` : ''}`;
}
