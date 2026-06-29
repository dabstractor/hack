/**
 * Package.json reader utility for test script extraction
 *
 * @module utils/package-json-reader
 *
 * @remarks
 * Provides functionality to read package.json from project root and
 * extract npm scripts with focus on test-related scripts. This is the
 * first step in Milestone 2.1: Test Memory Configuration.
 *
 * Features:
 * - Reads package.json from project root (process.cwd())
 * - Extracts all scripts as Record<string, string>
 * - Identifies test scripts (names starting with "test")
 * - Returns structured result for downstream consumption
 * - Handles file read and parse errors gracefully
 *
 * @example
 * ```typescript
 * import { readPackageJsonScripts } from './utils/package-json-reader.js';
 *
 * const result = readPackageJsonScripts();
 *
 * if (result.success) {
 *   console.log('Test scripts:', result.testScripts);
 *   // Output: ['test', 'test:run', 'test:watch', 'test:coverage', 'test:bail']
 * }
 * ```
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { getLogger, type Logger } from './logger.js';

let _logger: Logger | undefined;
const logger = (): Logger => (_logger ??= getLogger('PackageJsonReader'));

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Result of reading package.json scripts
 *
 * @remarks
 * Returned by {@link readPackageJsonScripts} to provide both all scripts
 * and a filtered list of test-related scripts for memory limit updates.
 *
 * The `testScripts` array contains only script names (keys), not the full
 * command values. This allows downstream tasks to easily iterate over test
 * scripts for updates.
 *
 * @example
 * ```typescript
 * const result = readPackageJsonScripts();
 * if (result.success) {
 *   // result.scripts contains all scripts
 *   // result.testScripts contains ['test', 'test:run', 'test:watch', ...]
 * }
 * ```
 */
export interface PackageJsonScriptsResult {
  /** True if package.json was read successfully */
  readonly success: true;

  /** All npm scripts from package.json (name → command mapping) */
  readonly scripts: Record<string, string>;

  /** List of test script names (filtered to names starting with "test") */
  readonly testScripts: string[];

  /** Human-readable status message */
  message: string;
}

/**
 * Error result for package.json read failures
 *
 * @remarks
 * Returned when file cannot be read or JSON cannot be parsed.
 * Provides error details for debugging and error reporting.
 *
 * @example
 * ```typescript
 * const result = readPackageJsonScripts();
 * if (!result.success) {
 *   console.error(`Failed: ${result.message}`);
 *   console.error(`Error code: ${result.errorCode}`);
 * }
 * ```
 */
interface PackageJsonReadError {
  /** False - indicates error condition */
  readonly success: false;

  /** Empty scripts object (no scripts available on error) */
  readonly scripts: Record<string, string>;

  /** Empty test scripts array (no test scripts found on error) */
  readonly testScripts: [];

  /** Error message explaining what went wrong */
  message: string;

  /** Optional error code for programmatic error handling */
  readonly errorCode?: string;
}

/** Union type for successful and error results */
export type PackageJsonScriptsReadResult =
  | PackageJsonScriptsResult
  | PackageJsonReadError;

/**
 * Raw package.json structure (scripts section only)
 *
 * @remarks
 * TypeScript interface for the parsed package.json.
 * Only includes the scripts section since that's all we need.
 */
interface PackageJsonRaw {
  /** Scripts section - may be undefined in some package.json files */
  scripts?: Record<string, string>;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Regex pattern for identifying test scripts
 *
 * @remarks
 * Matches script names that start with "test". This includes:
 * - test (base test command)
 * - test:run (run tests once)
 * - test:watch (watch mode)
 * - test:coverage (coverage report)
 * - test:bail (bail on first failure)
 *
 * Does NOT match:
 * - unittest (doesn't start with "test")
 * - mytest (doesn't start with "test")
 * - testing (not a standard test script name, but would match)
 */
const TEST_SCRIPT_PATTERN = /^test/;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Checks if a script name is a test script
 *
 * @remarks
 * Uses regex pattern to determine if a script name indicates a test script.
 * Test scripts are identified by names starting with "test".
 *
 * @param scriptName - The script name to check (key from package.json scripts)
 * @returns True if this is a test script
 */
function isTestScript(scriptName: string): boolean {
  return TEST_SCRIPT_PATTERN.test(scriptName);
}

/**
 * Parses scripts from package.json object
 *
 * @remarks
 * Extracts the scripts section and separates test scripts from all scripts.
 * Handles missing scripts section by returning empty objects.
 *
 * @param pkg - Parsed package.json object
 * @returns Object with scripts and testScripts arrays
 */
function parsePackageJsonScripts(pkg: PackageJsonRaw): {
  scripts: Record<string, string>;
  testScripts: string[];
} {
  // Get scripts section, default to empty object if missing
  const allScripts = pkg.scripts ?? {};

  // Filter to only test scripts (names starting with "test")
  const testScriptNames = Object.keys(allScripts).filter(isTestScript);

  return {
    scripts: allScripts,
    testScripts: testScriptNames,
  };
}

/**
 * Generates human-readable success message
 *
 * @remarks
 * Creates a descriptive message explaining the read result,
 * including how many scripts were found and how many are test scripts.
 *
 * @param scriptCount - Number of total scripts found
 * @param testScriptCount - Number of test scripts found
 * @returns Human-readable status message
 */
function generateSuccessMessage(
  scriptCount: number,
  testScriptCount: number
): string {
  return `Successfully read ${scriptCount} script${scriptCount === 1 ? '' : 's'} (${testScriptCount} test script${testScriptCount === 1 ? '' : 's'})`;
}

// ============================================================================
// MAIN FUNCTION
// ============================================================================

/**
 * Reads package.json and extracts scripts
 *
 * @remarks
 * * PATTERN: Always return structured result, never throw
 * This function reads package.json from the project root and extracts
 * all scripts with a focus on test-related scripts.
 *
 * * PATTERN: Use process.cwd() for project root
 * Constructs absolute path to package.json for reliable file access.
 * Uses path.join() for cross-platform compatibility.
 *
 * * PATTERN: Graceful error handling
 * Wraps file read and JSON parse in try-catch blocks.
 * Returns error result with descriptive message on failure.
 *
 * * PATTERN: Filter test scripts using helper function
 * Uses isTestScript() to identify which scripts need memory limits.
 *
 * * NOTE: This is READ-ONLY - does not modify package.json
 * P2.M1.T1.S2 handles updating scripts with NODE_OPTIONS.
 *
 * @returns PackageJsonScriptsResult with scripts and testScripts
 *
 * @example
 * ```typescript
 * const result = readPackageJsonScripts();
 *
 * if (result.success) {
 *   // result.scripts contains all scripts
 *   // result.testScripts contains ['test', 'test:run', 'test:watch', ...]
 * } else {
 *   // Handle error - check result.message
 * }
 * ```
 */
export function readPackageJsonScripts(): PackageJsonScriptsReadResult {
  // PATTERN: Build absolute path to package.json
  const packageJsonPath = path.join(process.cwd(), 'package.json');

  try {
    // PATTERN: Read file with explicit encoding
    const fileContent = readFileSync(packageJsonPath, 'utf-8');

    // PATTERN: Parse JSON with error handling
    let pkg: PackageJsonRaw;
    try {
      pkg = JSON.parse(fileContent);
    } catch (parseError) {
      logger().error(`Failed to parse package.json: ${parseError}`);
      return {
        success: false,
        scripts: {},
        testScripts: [],
        message: `Invalid JSON in package.json at ${packageJsonPath}`,
        errorCode: 'SYNTAX_ERROR',
      };
    }

    // PATTERN: Parse and filter scripts
    const { scripts, testScripts } = parsePackageJsonScripts(pkg);

    const scriptCount = Object.keys(scripts).length;
    logger().info(
      `Successfully read package.json: ${scriptCount} scripts, ${testScripts.length} test scripts`
    );

    return {
      success: true,
      scripts,
      testScripts,
      message: generateSuccessMessage(scriptCount, testScripts.length),
    };
  } catch (readError) {
    // PATTERN: Handle file system errors
    const errorCode =
      (readError as NodeJS.ErrnoException).code === 'ENOENT'
        ? 'FILE_NOT_FOUND'
        : 'READ_ERROR';
    logger().error(`Failed to read package.json: ${readError}`);

    return {
      success: false,
      scripts: {},
      testScripts: [],
      message: `Error reading package.json at ${packageJsonPath}: ${readError}`,
      errorCode,
    };
  }
}
