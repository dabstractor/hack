/**
 * Console.log verifier for detecting console.log usage in CLI output
 *
 * @module utils/console-log-verifier
 *
 * @remarks
 * Provides functionality to verify whether CLI output contains console.log
 * statements (as opposed to structured logger output). This is the fourth
 * verification step after validation report format verification (P1.M2.T2.S3).
 *
 * Features:
 * - Consumes ValidationReportFormatResult from P1.M2.T2.S3
 * - Detects console.log-style output patterns (unstructured text)
 * - Detects logger output patterns (structured JSON or bracketed levels)
 * - Returns structured result with pattern detection status
 * - Mock-friendly design for comprehensive unit testing
 *
 * @example
 * ```typescript
 * import { verifyConsoleLogAbsence } from './utils/console-log-verifier.js';
 * import { verifyValidationReportFormat } from './utils/validation-report-verifier.js';
 *
 * const formatResult = verifyValidationReportFormat(validationResult);
 * const consoleResult = verifyConsoleLogAbsence(formatResult);
 *
 * if (consoleResult.hasConsoleLog) {
 *   // Create issue for Phase 3: Replace Console.log with Logger
 *   console.log(`Found ${consoleResult.consoleLogCount} console.log occurrences`);
 * }
 * ```
 */

import type { ValidationReportFormatResult } from './validation-report-verifier.js';
import { getLogger, type Logger } from './logger.js';

let _logger: Logger | undefined;
const logger = (): Logger => (_logger ??= getLogger('ConsoleLogVerifier'));

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Result of console.log absence verification
 *
 * @remarks
 * Returned by {@link verifyConsoleLogAbsence} to indicate whether
 * console.log output was detected in the validation report.
 *
 * @example
 * ```typescript
 * const result = verifyConsoleLogAbsence(formatResult);
 * if (result.hasConsoleLog) {
 *   console.error('Console.log detected:', result.consoleLogCount);
 * }
 * ```
 */
export interface ConsoleLogVerificationResult {
  /** True if structured logger output patterns were detected */
  usesLogger: boolean;

  /** True if console.log-style output patterns were detected */
  hasConsoleLog: boolean;

  /** Number of console.log-style lines detected in the output */
  consoleLogCount: number;

  /** Human-readable status message */
  message: string;

  /** List of detected console.log patterns (for debugging) */
  detectedPatterns: readonly string[];
}

/**
 * Detected patterns in output
 *
 * @remarks
 * Internal structure for pattern detection results.
 */
interface PatternDetection {
  /** Console.log patterns found */
  consoleLogPatterns: string[];

  /** Logger patterns found */
  loggerPatterns: string[];

  /** Count of lines with console.log characteristics */
  consoleLogLineCount: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Regex patterns for detecting console.log-style output
 *
 * @remarks
 * Console.log output is characterized by:
 * - Unstructured plain text
 * - No JSON structure
 * - No log level prefixes
 * - Direct user-facing messages
 * - Common patterns in validation reports
 */
const CONSOLE_LOG_PATTERNS = {
  /** Lines starting with capital letters (handles acronyms like PRD) */
  PLAIN_TEXT: /^[A-Z][A-Za-z]+/,

  /** Border lines with 60 equals signs (from src/index.ts:138) */
  BORDER_EQUALS: /^={60}$/,

  /** Border lines with 60 dashes (alternative border style) */
  BORDER_DASHES: /^-+$/,

  /** Emoji status indicators (✅ VALID, ❌ INVALID, ⚠️ WARNING, ℹ️ INFO) */
  EMOJI_STATUS: /✅\s*VALID|❌\s*INVALID|⚠️|ℹ️/,

  /** Unstructured key-value patterns (File:, Status:, Summary:, Issues:) */
  KEY_VALUE_SECTION: /^(File|Status|Summary|Issues):/,

  /** Indented content lines (spaces followed by text) */
  INDENTED_CONTENT: /^[ \t]{2,}[A-Z]/i,
} as const;

/**
 * Regex patterns for detecting logger output
 *
 * @remarks
 * Logger output is characterized by:
 * - Structured JSON format with level field
 * - Bracketed log levels [INFO], [ERROR], [WARN], [DEBUG]
 * - Context prefixes like [ContextName]
 * - ISO 8601 timestamps
 * - Structured key-value pairs
 */
const LOGGER_PATTERNS = {
  /** JSON structured logs: {"level":"info",...} */
  JSON_STRUCTURED: /^\{["']?level["']?\s*:/i,

  /** Bracketed log levels: [INFO], [ERROR], [WARN], [DEBUG] */
  BRACKETED_LEVEL: /^\[(DEBUG|INFO|WARN|ERROR)\]/i,

  /** Context prefix: [ContextName] message */
  CONTEXT_PREFIX: /^\[[A-Z][a-zA-Z]+\]\s+/,

  /** ISO 8601 timestamp: 2024-01-14T10:30:00.000Z */
  TIMESTAMP_ISO: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,

  /** Pino pretty format: level: INFO, msg: "...", time: ... */
  PINO_PRETTY: /level:\s*(DEBUG|INFO|WARN|ERROR)/i,
} as const;

// ============================================================================
// MAIN FUNCTION
// ============================================================================

/**
 * Verifies absence of console.log statements in CLI output
 *
 * @remarks
 * * PATTERN: Check output for console.log vs logger usage patterns
 *
 * This function analyzes the captured validation output to determine
 * whether console.log was used (unstructured output) vs logger
 * (structured output with JSON or bracketed levels).
 *
 * * PATTERN: Always check output, regardless of format validity
 * Unlike format verification which skips on failed command,
 * console.log detection runs on all output to catch violations.
 *
 * * PATTERN: Return structured result, don't throw
 * Allows pipeline to continue even when console.log is detected.
 * hasConsoleLog flag indicates whether console.log patterns were found.
 *
 * * NOTE: Input from P1.M2.T2.S3
 * ValidationReportFormatResult comes from verifyValidationReportFormat().
 *
 * * NOTE: This is VERIFICATION, not fixing
 * If hasConsoleLog is true, this creates an issue for Phase 3 (P3.M1.T1)
 * to replace console.log with logger in src/index.ts:138-169.
 *
 * @param formatResult - ValidationReportFormatResult from verifyValidationReportFormat()
 * @returns ConsoleLogVerificationResult with pattern detection status
 *
 * @example
 * ```typescript
 * const formatResult = verifyValidationReportFormat(validationResult);
 * const consoleResult = verifyConsoleLogAbsence(formatResult);
 *
 * if (consoleResult.hasConsoleLog) {
 *   // Create issue for Phase 3: Replace Console.log with Logger
 *   console.log(`Found ${consoleResult.consoleLogCount} console.log occurrences`);
 * }
 * ```
 */
export function verifyConsoleLogAbsence(
  formatResult: ValidationReportFormatResult
): ConsoleLogVerificationResult {
  // PATTERN: Always check output, regardless of format validity
  // Unlike format verification which skips on failed command,
  // console.log detection runs on all output to catch violations
  const consoleDetection = detectConsoleLog(formatResult.message);
  const loggerDetection = detectLoggerOutput(formatResult.message);

  const hasConsoleLog = consoleDetection.consoleLogLineCount > 0;
  const usesLogger = loggerDetection.loggerPatterns.length > 0;

  // Log detection results
  if (hasConsoleLog) {
    logger().warn(
      `Console.log patterns detected in output: ${consoleDetection.consoleLogLineCount} lines`
    );
  }
  if (usesLogger) {
    logger().debug('Structured logger output detected');
  }

  return {
    usesLogger,
    hasConsoleLog,
    consoleLogCount: consoleDetection.consoleLogLineCount,
    message: generateVerificationMessage(
      usesLogger,
      hasConsoleLog,
      consoleDetection.consoleLogLineCount
    ),
    detectedPatterns: consoleDetection.consoleLogPatterns,
  };
}

// ============================================================================
// CONSOLE.LOG DETECTION HELPER
// ============================================================================

/**
 * Detects console.log patterns in validation output
 *
 * @remarks
 * Analyzes output line by line to detect characteristics of
 * console.log output (unstructured, plain text formatting).
 *
 * Lines matching console.log patterns are accumulated for
 * counting and pattern reference.
 *
 * @param message - Validation report output from ValidationReportFormatResult.message
 * @returns PatternDetection with console.log patterns found
 */
function detectConsoleLog(
  message: string
): Omit<PatternDetection, 'loggerPatterns'> {
  const lines = message.split('\n');
  const consoleLogPatterns: string[] = [];
  let consoleLogLineCount = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines
    if (!trimmed) {
      continue;
    }

    // Check for console.log characteristics
    const hasConsoleLogCharacteristic =
      CONSOLE_LOG_PATTERNS.PLAIN_TEXT.test(trimmed) ||
      CONSOLE_LOG_PATTERNS.BORDER_EQUALS.test(trimmed) ||
      CONSOLE_LOG_PATTERNS.BORDER_DASHES.test(trimmed) ||
      CONSOLE_LOG_PATTERNS.EMOJI_STATUS.test(trimmed) ||
      CONSOLE_LOG_PATTERNS.KEY_VALUE_SECTION.test(trimmed) ||
      CONSOLE_LOG_PATTERNS.INDENTED_CONTENT.test(trimmed);

    // Additional check: NOT a logger pattern
    const isNotLogger =
      !LOGGER_PATTERNS.JSON_STRUCTURED.test(trimmed) &&
      !LOGGER_PATTERNS.BRACKETED_LEVEL.test(trimmed) &&
      !LOGGER_PATTERNS.CONTEXT_PREFIX.test(trimmed);

    if (hasConsoleLogCharacteristic && isNotLogger) {
      consoleLogPatterns.push(trimmed);
      consoleLogLineCount++;
    }
  }

  return {
    consoleLogPatterns,
    consoleLogLineCount,
  };
}

// ============================================================================
// LOGGER OUTPUT DETECTION HELPER
// ============================================================================

/**
 * Detects logger output patterns in validation output
 *
 * @remarks
 * Analyzes output line by line to detect characteristics of
 * structured logger output (JSON, bracketed levels, context).
 *
 * @param message - Validation report output from ValidationReportFormatResult.message
 * @returns PatternDetection with logger patterns found
 */
function detectLoggerOutput(
  message: string
): Omit<PatternDetection, 'consoleLogPatterns' | 'consoleLogLineCount'> {
  const lines = message.split('\n');
  const loggerPatterns: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines
    if (!trimmed) {
      continue;
    }

    // Check for logger characteristics
    const hasLoggerCharacteristic =
      LOGGER_PATTERNS.JSON_STRUCTURED.test(trimmed) ||
      LOGGER_PATTERNS.BRACKETED_LEVEL.test(trimmed) ||
      LOGGER_PATTERNS.CONTEXT_PREFIX.test(trimmed) ||
      LOGGER_PATTERNS.TIMESTAMP_ISO.test(trimmed) ||
      LOGGER_PATTERNS.PINO_PRETTY.test(trimmed);

    if (hasLoggerCharacteristic) {
      loggerPatterns.push(trimmed);
    }
  }

  return {
    loggerPatterns,
  };
}

// ============================================================================
// MESSAGE GENERATION HELPER
// ============================================================================

/**
 * Generates human-readable verification message
 *
 * @remarks
 * Creates descriptive message explaining the console.log detection
 * status, including count and Phase 3 fix reference.
 *
 * @param usesLogger - Whether logger output was detected
 * @param hasConsoleLog - Whether console.log output was detected
 * @param consoleLogCount - Number of console.log lines detected
 * @returns Human-readable status message
 */
function generateVerificationMessage(
  usesLogger: boolean,
  hasConsoleLog: boolean,
  consoleLogCount: number
): string {
  if (hasConsoleLog && usesLogger) {
    return `Mixed output detected: ${consoleLogCount} console.log lines found alongside logger output. Phase 3 fix required.`;
  }

  if (hasConsoleLog) {
    return `Console.log output detected: ${consoleLogCount} lines. Issue 5 violation - Phase 3 fix required.`;
  }

  if (usesLogger) {
    return 'Structured logger output detected - no console.log patterns found.';
  }

  return 'No logger or console.log output patterns detected.';
}
