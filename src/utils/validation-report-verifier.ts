/**
 * Validation report verifier for PRD validation report format validation
 *
 * @module utils/validation-report-verifier
 *
 * @remarks
 * Provides functionality to verify that the PRD validation report output
 * contains all expected sections with proper structured formatting. This is
 * the third verification step after PRD validation execution (P1.M2.T2.S2).
 *
 * Features:
 * - Consumes PrdValidationResult from P1.M2.T2.S2
 * - Parses validation report for expected sections (4 required)
 * - Detects 'PRD Validation Report', 'File:', 'Status:', 'Summary:' sections
 * - Handles optional 'Issues:' section (not required)
 * - Returns structured result with format detection status
 * - Mock-friendly design for comprehensive unit testing
 *
 * @example
 * ```typescript
 * import { verifyValidationReportFormat } from './utils/validation-report-verifier.js';
 * import { executePrdValidation } from './utils/prd-validation-executor.js';
 *
 * const validationResult = await executePrdValidation('/path/to/PRD.md');
 * const formatResult = verifyValidationReportFormat(validationResult);
 *
 * if (formatResult.formatValid) {
 *   console.log('Validation report format is correct');
 * } else {
 *   console.error('Missing sections:', formatResult.missingSections);
 * }
 * ```
 */

import type { PrdValidationResult } from './prd-validation-executor.js';
import { getLogger, type Logger } from './logger.js';

let _logger: Logger | undefined;
const logger = (): Logger =>
  (_logger ??= getLogger('ValidationReportVerifier'));

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Result of validation report format verification
 *
 * @remarks
 * Returned by {@link verifyValidationReportFormat} to indicate which
 * expected sections were detected in the validation report.
 *
 * @example
 * ```typescript
 * const result = verifyValidationReportFormat(validationResult);
 * if (!result.formatValid) {
 *   console.error('Missing sections:', result.missingSections);
 * }
 * ```
 */
export interface ValidationReportFormatResult {
  /** True if all required sections are present in the report */
  formatValid: boolean;

  /** List of section names detected in the report */
  sectionsPresent: readonly string[];

  /** List of required section names not found (empty if all present) */
  missingSections: readonly string[];

  /** Human-readable status message */
  message: string;
}

/**
 * Parsed sections from validation report
 *
 * @remarks
 * Internal structure for section parsing results before being
 * transformed into ValidationReportFormatResult.
 */
interface ParsedSections {
  /** Section names detected */
  sectionsFound: string[];

  /** Section names not found */
  sectionsNotFound: string[];
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Expected validation report sections (required)
 *
 * @remarks
 * These 4 sections must be present in validation report for format
 * verification to pass. The "Issues:" section is optional and NOT
 * included in this list.
 */
const EXPECTED_REQUIRED_SECTIONS = [
  'PRD Validation Report', // Main title
  'File:', // File path section
  'Status:', // Validation status (✅ VALID or ❌ INVALID)
  'Summary:', // Summary counts (Critical, Warnings, Info)
] as const;

/**
 * Regex patterns for section detection
 *
 * @remarks
 * Compiled regex patterns for efficient section detection.
 * All patterns are case-sensitive for exact section matching.
 *
 * Patterns use [ \t]+ instead of \s+ to prevent matching across
 * newlines to other sections.
 */
const SECTION_PATTERNS = {
  /** Matches "PRD Validation Report" title */
  TITLE: /PRD Validation Report/,

  /** Matches "File: /path/to/file" with path content */
  FILE: /File:[ \t]+\S+/,

  /** Matches "Status: ✅ VALID" or "Status: ❌ INVALID" */
  STATUS: /Status:[ \t]+(?:✅\s*VALID|❌\s*INVALID)/,

  /** Matches "Summary:" section with counts (multiline) */
  SUMMARY: /Summary:.*Critical:\s*\d+.*Warnings:\s*\d+.*Info:\s*\d+/s,
} as const;

// ============================================================================
// MAIN FUNCTION
// ============================================================================

/**
 * Verifies validation report output format contains expected sections
 *
 * @remarks
 * * PATTERN: Early return when success is false (command failed)
 * If PrdValidationResult.success is false, don't check format.
 * Return formatValid: false immediately with all sections marked missing.
 *
 * * PATTERN: Parse validation report for expected sections
 * Use regex to detect required sections: PRD Validation Report, File:, Status:, Summary:
 * Verify each section has proper formatting with content.
 *
 * * PATTERN: Return structured result, don't throw
 * Allows pipeline to continue even on format verification failure.
 * formatValid flag indicates whether all sections were detected.
 *
 * * NOTE: Input from P1.M2.T2.S2
 * PrdValidationResult comes from executePrdValidation() function.
 *
 * @param validationResult - PrdValidationResult from executePrdValidation()
 * @returns ValidationReportFormatResult with format detection status
 *
 * @example
 * ```typescript
 * const validationResult = await executePrdValidation(prdPath);
 * const formatResult = verifyValidationReportFormat(validationResult);
 *
 * if (formatResult.formatValid) {
 *   console.log('Validation report format is correct');
 * }
 * ```
 */
export function verifyValidationReportFormat(
  validationResult: PrdValidationResult
): ValidationReportFormatResult {
  // PATTERN: Early return when validation command failed
  if (!validationResult.success) {
    logger().warn(
      'Skipping validation report format check: validation command failed'
    );

    return {
      formatValid: false,
      sectionsPresent: [],
      missingSections: [...EXPECTED_REQUIRED_SECTIONS],
      message:
        'Validation report format check skipped: validation command failed',
    };
  }

  // Parse report for sections
  const parsed = parseReportSections(validationResult.validationReport);

  // Build missing sections array
  const missingSections = EXPECTED_REQUIRED_SECTIONS.filter(
    section => !parsed.sectionsFound.includes(section)
  );

  const formatValid = missingSections.length === 0;

  if (formatValid) {
    logger().debug('All expected sections detected in validation report');
  } else {
    logger().warn(
      `Missing sections in validation report: ${missingSections.join(', ')}`
    );
  }

  return {
    formatValid,
    sectionsPresent: parsed.sectionsFound,
    missingSections,
    message: generateFormatMessage(
      parsed.sectionsFound,
      missingSections,
      formatValid
    ),
  };
}

// ============================================================================
// SECTION PARSING HELPER
// ============================================================================

/**
 * Parses validation report for expected sections
 *
 * @remarks
 * Searches validation report for the 4 expected sections:
 * - PRD Validation Report: Main title
 * - File: PRD file path
 * - Status: ✅ VALID or ❌ INVALID
 * - Summary: Critical, Warnings, Info counts
 *
 * Uses regex patterns to match each section with proper formatting.
 * Only adds section to sectionsFound if pattern matches.
 *
 * @param report - Validation report string from PrdValidationResult.validationReport
 * @returns ParsedSections with detection status
 */
function parseReportSections(report: string): ParsedSections {
  const sectionsFound: string[] = [];

  // Check for "PRD Validation Report" title
  if (SECTION_PATTERNS.TITLE.test(report)) {
    sectionsFound.push('PRD Validation Report');
  }

  // Check for "File:" section
  if (SECTION_PATTERNS.FILE.test(report)) {
    sectionsFound.push('File:');
  }

  // Check for "Status:" section
  if (SECTION_PATTERNS.STATUS.test(report)) {
    sectionsFound.push('Status:');
  }

  // Check for "Summary:" section (multiline)
  if (SECTION_PATTERNS.SUMMARY.test(report)) {
    sectionsFound.push('Summary:');
  }

  // Find missing sections
  const sectionsNotFound = EXPECTED_REQUIRED_SECTIONS.filter(
    section => !sectionsFound.includes(section)
  );

  return {
    sectionsFound,
    sectionsNotFound,
  };
}

// ============================================================================
// MESSAGE GENERATION HELPER
// ============================================================================

/**
 * Generates human-readable format verification message
 *
 * @remarks
 * Creates descriptive message explaining the verification result,
 * including which sections were found and which are missing.
 *
 * @param sectionsPresent - List of sections detected
 * @param missingSections - List of sections not found
 * @param formatValid - Whether all sections were detected
 * @returns Human-readable status message
 */
function generateFormatMessage(
  sectionsPresent: string[],
  missingSections: string[],
  formatValid: boolean
): string {
  if (formatValid) {
    return `All expected sections detected in validation report: ${EXPECTED_REQUIRED_SECTIONS.join(', ')}`;
  }

  const foundStr =
    sectionsPresent.length > 0
      ? `Found: ${sectionsPresent.join(', ')}`
      : 'No sections found';
  const missingStr =
    missingSections.length > 0 ? `Missing: ${missingSections.join(', ')}` : '';

  return `Validation report format incomplete. ${foundStr}${missingStr ? `. ${missingStr}` : ''}`;
}
