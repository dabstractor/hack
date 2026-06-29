/**
 * Package.json syntax verifier utility
 *
 * @module utils/package-json-syntax-verifier
 *
 * @remarks
 * Provides functionality to verify package.json has valid JSON syntax
 * after NODE_OPTIONS memory limit updates from P2.M1.T1.S2.
 *
 * Features:
 * - Reads package.json from project root (process.cwd())
 * - Uses JSON.parse() for syntax validation
 * - Detects all JSON syntax errors with detailed messages
 * - Returns structured result for downstream consumption
 * - Handles file read errors gracefully
 * - Mock-friendly design for comprehensive unit testing
 *
 * @example
 * ```typescript
 * import { verifyPackageJsonSyntax } from './utils/package-json-syntax-verifier.js';
 *
 * const result = verifyPackageJsonSyntax();
 *
 * if (result.valid) {
 *   console.log('package.json is valid JSON');
 * } else {
 *   console.error('JSON Syntax Error:', result.syntaxError);
 * }
 * ```
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { getLogger, type Logger } from './logger.js';

let _logger: Logger | undefined;
const logger = (): Logger =>
  (_logger ??= getLogger('PackageJsonSyntaxVerifier'));

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Result of package.json syntax verification
 *
 * @remarks
 * Returned by {@link verifyPackageJsonSyntax} to indicate whether
 * package.json has valid JSON syntax. Provides detailed error information
 * for debugging when JSON is invalid.
 *
 * @example
 * ```typescript
 * const result = verifyPackageJsonSyntax();
 * if (!result.valid) {
 *   console.error(`Syntax error at position: ${result.syntaxError}`);
 * }
 * ```
 */
export interface PackageJsonSyntaxResult {
  /** True if package.json has valid JSON syntax */
  readonly valid: boolean;

  /** Syntax error message if invalid, null if valid */
  readonly syntaxError: string | null;

  /** Human-readable status message */
  message: string;
}

/**
 * Raw package.json structure for parsing
 *
 * @remarks
 * TypeScript interface for parsed package.json.
 * We only need to verify syntax, so we use 'unknown' type.
 */
interface _PackageJsonRaw {
  [key: string]: unknown;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Package.json filename
 *
 * @remarks
 * Standard package.json filename expected in project root.
 */
const PACKAGE_JSON_FILENAME = 'package.json';

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Builds a syntax verification result
 *
 * @remarks
 * Constructs a PackageJsonSyntaxResult with validity status,
 * syntax error (if any), and human-readable message.
 *
 * @param valid - Whether JSON is valid
 * @param syntaxError - Error message or null
 * @param filePath - Path to package.json (for message)
 * @returns Result object
 */
function buildSyntaxResult(
  valid: boolean,
  syntaxError: string | null,
  filePath: string
): PackageJsonSyntaxResult {
  if (valid) {
    return {
      valid: true,
      syntaxError: null,
      message: `Valid JSON in package.json at ${filePath}`,
    };
  }

  return {
    valid: false,
    syntaxError,
    message: `Invalid JSON in package.json at ${filePath}${syntaxError ? `: ${syntaxError}` : ''}`,
  };
}

// ============================================================================
// MAIN FUNCTION
// ============================================================================

/**
 * Verifies package.json has valid JSON syntax
 *
 * @remarks
 * * PATTERN: Always return structured result, never throw
 * This function reads package.json from the project root and verifies
 * it has valid JSON syntax using JSON.parse().
 *
 * * PATTERN: Use process.cwd() for project root
 * Constructs absolute path to package.json for reliable file access.
 * Uses path.join() for cross-platform compatibility.
 *
 * * PATTERN: Separate file read from JSON parse errors
 * File read errors (ENOENT, EACCES) return different error messages
 * than JSON parse errors (SyntaxError).
 *
 * * PATTERN: Extract SyntaxError.message for detailed debugging
 * JSON.parse() throws SyntaxError with position information.
 * Example: "Unexpected token } in JSON at position 142"
 *
 * * CONTRACT: Validate after S2 updates
 * This function should be called after P2.M1.T1.S2 updates test scripts
 * with NODE_OPTIONS to verify JSON syntax wasn't corrupted.
 *
 * @param filePath - Optional path to package.json (defaults to CWD/package.json)
 * @returns PackageJsonSyntaxResult with validity status
 *
 * @example
 * ```typescript
 * // Verify package.json in current directory
 * const result = verifyPackageJsonSyntax();
 *
 * if (result.valid) {
 *   console.log('Valid JSON');
 * } else {
 *   console.error('Syntax error:', result.syntaxError);
 * }
 *
 * // Verify specific package.json path
 * const customResult = verifyPackageJsonSyntax('/path/to/package.json');
 * ```
 */
export function verifyPackageJsonSyntax(
  filePath?: string
): PackageJsonSyntaxResult {
  // PATTERN: Build absolute path to package.json
  const packageJsonPath = filePath
    ? path.resolve(filePath)
    : path.join(process.cwd(), PACKAGE_JSON_FILENAME);

  logger().debug(`Verifying package.json syntax at: ${packageJsonPath}`);

  try {
    // PATTERN: Read file with explicit encoding
    const fileContent = readFileSync(packageJsonPath, 'utf-8');

    // PATTERN: Parse JSON with error handling
    try {
      JSON.parse(fileContent);

      logger().info('package.json has valid JSON syntax');

      // PATTERN: Return success result
      return buildSyntaxResult(true, null, packageJsonPath);
    } catch (parseError) {
      // PATTERN: Extract SyntaxError message
      const syntaxError =
        parseError instanceof SyntaxError
          ? parseError.message
          : String(parseError);

      logger().error(`Invalid JSON in package.json: ${syntaxError}`);

      // PATTERN: Return syntax error result
      return buildSyntaxResult(false, syntaxError, packageJsonPath);
    }
  } catch (readError) {
    // PATTERN: Handle file system errors
    const errorCode = (readError as NodeJS.ErrnoException).code;
    const errorMessage =
      errorCode === 'ENOENT'
        ? `File not found: ${packageJsonPath}`
        : errorCode === 'EACCES'
          ? `Permission denied reading ${packageJsonPath}`
          : `Error reading package.json: ${readError}`;

    logger().error(errorMessage);

    // PATTERN: Return file read error result
    return buildSyntaxResult(false, errorMessage, packageJsonPath);
  }
}
