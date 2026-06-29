/**
 * Package.json updater utility for test script memory limits
 *
 * @module utils/package-json-updater
 *
 * @remarks
 * Provides functionality to update test scripts in package.json by
 * prepending NODE_OPTIONS memory limits. This is the second step in
 * Milestone 2.1: Test Memory Configuration.
 *
 * Features:
 * - Consumes PackageJsonScriptsResult from P2.M1.T1.S1
 * - Prepends NODE_OPTIONS="--max-old-space-size=4096" to test scripts
 * - Uses Edit tool to modify package.json in-place
 * - Detects existing NODE_OPTIONS to avoid duplication
 * - Returns structured result for downstream consumption
 * - Handles errors gracefully with detailed messages
 *
 * @example
 * ```typescript
 * import { updateTestScriptsWithMemoryLimit } from './utils/package-json-updater.js';
 * import { readPackageJsonScripts } from './utils/package-json-reader.js';
 *
 * // Read current scripts (S1)
 * const input = readPackageJsonScripts();
 *
 * if (input.success) {
 *   // Update test scripts with memory limits (S2)
 *   const result = updateTestScriptsWithMemoryLimit(input);
 *
 *   if (result.success) {
 *     console.log('Updated scripts:', result.updated);
 *     // Output: ['test', 'test:run', 'test:watch', 'test:coverage', 'test:bail']
 *   }
 * }
 * ```
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getLogger, type Logger } from './logger.js';
import type { PackageJsonScriptsReadResult } from './package-json-reader.js';

let _logger: Logger | undefined;
const logger = (): Logger => (_logger ??= getLogger('PackageJsonUpdater'));

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Result of updating test scripts with memory limits
 *
 * @remarks
 * Returned by {@link updateTestScriptsWithMemoryLimit} to provide
 * both the list of updated script names and the full updated scripts
 * object for downstream verification (P2.M1.T1.S3).
 *
 * @example
 * ```typescript
 * const result = updateTestScriptsWithMemoryLimit(input);
 * if (result.success) {
 *   // result.updated contains ['test', 'test:run', 'test:watch', ...]
 *   // result.updatedScripts contains the full scripts mapping
 * }
 * ```
 */
export interface PackageJsonUpdateResult {
  /** True if all updates were applied successfully */
  success: true;

  /** Names of test scripts that were updated (e.g., ['test', 'test:run']) */
  readonly updated: string[];

  /** Full updated scripts object with NODE_OPTIONS prepended */
  readonly updatedScripts: Record<string, string>;

  /** Human-readable status message */
  message: string;
}

/**
 * Error result for package.json update failures
 *
 * @remarks
 * Returned when update operations fail. Provides error details
 * for debugging and error reporting.
 *
 * @example
 * ```typescript
 * const result = updateTestScriptsWithMemoryLimit(input);
 * if (!result.success) {
 *   console.error(`Failed: ${result.message}`);
 *   console.error(`Error code: ${result.errorCode}`);
 * }
 * ```
 */
interface PackageJsonUpdateError {
  /** False - indicates error condition */
  success: false;

  /** Empty array (no scripts updated on error) */
  readonly updated: [];

  /** Empty scripts object (no updates on error) */
  readonly updatedScripts: Record<string, string>;

  /** Error message explaining what went wrong */
  message: string;

  /** Optional error code for programmatic error handling */
  readonly errorCode?: string;
}

/** Union type for successful and error results */
export type PackageJsonUpdateOutput =
  | PackageJsonUpdateResult
  | PackageJsonUpdateError;

/**
 * Options for script update behavior
 *
 * @remarks
 * Controls how the updater handles scripts that already have
 * NODE_OPTIONS or other edge cases.
 */
interface ScriptUpdateOptions {
  /**
   * Behavior when NODE_OPTIONS already detected in a script
   * - 'skip': Ignore scripts with existing NODE_OPTIONS (default)
   * - 'error': Return error result if NODE_OPTIONS detected
   * - 'replace': Replace existing NODE_OPTIONS with new value
   */
  readonly onExistingOptions?: 'skip' | 'error' | 'replace';
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Memory limit in megabytes for test scripts
 *
 * @remarks
 * Set to 4096MB (4GB) to address Issue 2: Worker terminated due to
 * reaching memory limit. This is the recommended value for test suites
 * with coverage (external_deps.md line 171).
 *
 * Default Node.js memory: ~512MB - 2GB (varies by system)
 * Required for this test suite: 4GB+ (1688 tests with coverage)
 */
const MEMORY_LIMIT_MB = 4096;

/**
 * NODE_OPTIONS prefix to prepend to test scripts
 *
 * @remarks
 * This prefix tells Node.js to use the specified old space size limit.
 * The --max-old-space-size flag controls V8's garbage collector heap size.
 *
 * Format: NODE_OPTIONS="<flag>" command
 * Quotes are escaped for JSON string representation in package.json.
 *
 * Cross-platform note: This syntax works on Unix/Linux/macOS.
 * For Windows compatibility, consider using cross-env package.
 */
const NODE_OPTIONS_PREFIX = `NODE_OPTIONS="--max-old-space-size=${MEMORY_LIMIT_MB}"`;

/**
 * Regex pattern for detecting existing NODE_OPTIONS
 *
 * @remarks
 * Matches script commands that start with NODE_OPTIONS to prevent
 * double-prepending memory limits.
 */
const NODE_OPTIONS_PATTERN = /^NODE_OPTIONS=/i;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Checks if a script command already has NODE_OPTIONS
 *
 * @remarks
 * Uses regex pattern to detect if a script command starts with NODE_OPTIONS.
 * This prevents double-prepending memory limits to the same script.
 *
 * @param scriptCommand - The script command to check (value from package.json)
 * @returns True if NODE_OPTIONS is already present
 *
 * @example
 * ```typescript
 * hasNodeOptions('vitest run')                    // false
 * hasNodeOptions('NODE_OPTIONS="--max-old-space-size=4096" vitest run')  // true
 * ```
 */
function hasNodeOptions(scriptCommand: string): boolean {
  if (!scriptCommand) {
    return false;
  }
  return NODE_OPTIONS_PATTERN.test(scriptCommand.trim());
}

/**
 * Prepends NODE_OPTIONS to a script command
 *
 * @remarks
 * Constructs a new command string with the memory limit prefix.
 * Preserves the original command and all its arguments.
 *
 * @param scriptCommand - The original script command
 * @returns New command with NODE_OPTIONS prepended
 *
 * @example
 * ```typescript
 * prependNodeOptions('vitest run')
 * // Returns: 'NODE_OPTIONS="--max-old-space-size=4096" vitest run'
 *
 * prependNodeOptions('vitest run --coverage')
 * // Returns: 'NODE_OPTIONS="--max-old-space-size=4096" vitest run --coverage'
 * ```
 */
function prependNodeOptions(scriptCommand: string): string {
  const trimmed = scriptCommand.trim();
  return `${NODE_OPTIONS_PREFIX} ${trimmed}`;
}

/**
 * Removes existing NODE_OPTIONS from a script command
 *
 * @remarks
 * Strips the NODE_OPTIONS prefix from a command so it can be replaced
 * with a new value. Used when onExistingOptions is 'replace'.
 *
 * @param scriptCommand - The script command with existing NODE_OPTIONS
 * @returns Command with NODE_OPTIONS removed
 */
function removeExistingNodeOptions(scriptCommand: string): string {
  // Match NODE_OPTIONS="..." at the start of the command (case-insensitive)
  // The pattern matches: NODE_OPTIONS="any value" followed by a space
  return scriptCommand.replace(/^NODE_OPTIONS="[^"]*"\s+/i, '');
}

/**
 * Builds a successful update result
 *
 * @remarks
 * Constructs a PackageJsonUpdateResult with the list of updated
 * script names and the full updated scripts object.
 *
 * @param updated - Array of script names that were updated
 * @param updatedScripts - Full scripts object with updates applied
 * @returns Success result object
 */
function buildUpdateResult(
  updated: string[],
  updatedScripts: Record<string, string>
): PackageJsonUpdateResult {
  return {
    success: true,
    updated,
    updatedScripts,
    message: `Successfully updated ${updated.length} test script(s) with ${MEMORY_LIMIT_MB}MB memory limit`,
  };
}

/**
 * Builds an error result
 *
 * @remarks
 * Constructs a PackageJsonUpdateError with error details.
 *
 * @param message - Error message explaining what went wrong
 * @param errorCode - Optional error code for programmatic handling
 * @returns Error result object
 */
function buildErrorResult(
  message: string,
  errorCode?: string
): PackageJsonUpdateError {
  return {
    success: false,
    updated: [],
    updatedScripts: {},
    message,
    errorCode,
  };
}

/**
 * Writes updated scripts to package.json
 *
 * @remarks
 * Reads package.json, updates the scripts section, and writes it back.
 * This is used instead of the Edit tool for batch updates.
 *
 * @param packageJsonPath - Path to package.json
 * @param updatedScripts - Updated scripts object to write
 * @returns true if write succeeded, false if failed
 */
function writePackageJson(
  packageJsonPath: string,
  updatedScripts: Record<string, string>
): boolean {
  try {
    // Read current package.json
    const content = readFileSync(packageJsonPath, 'utf-8');
    const pkg = JSON.parse(content) as Record<string, unknown>;

    // Update scripts section
    pkg.scripts = updatedScripts;

    // Write back with proper formatting (2-space indentation)
    writeFileSync(
      packageJsonPath,
      JSON.stringify(pkg, null, 2) + '\n',
      'utf-8'
    );

    logger().info(`Successfully wrote updated scripts to ${packageJsonPath}`);
    return true;
  } catch (error) {
    logger().error(`Failed to write package.json: ${error}`);
    return false;
  }
}

// ============================================================================
// MAIN FUNCTION
// ============================================================================

/**
 * Updates test scripts with NODE_OPTIONS memory limit
 *
 * @remarks
 * * PATTERN: Always return structured result, never throw
 * This function consumes the output from P2.M1.T1.S1 and updates
 * each test script by prepending NODE_OPTIONS with a 4GB memory limit.
 *
 * * PATTERN: Batch file update for efficiency
 * Rather than multiple Edit tool calls, this function reads package.json,
 * updates the scripts object in memory, and uses a single write operation.
 * This is more efficient and atomic than multiple individual edits.
 *
 * * PATTERN: Detect existing NODE_OPTIONS
 * Checks each script command for existing NODE_OPTIONS to avoid
 * duplication. Behavior controlled by onExistingOptions option.
 *
 * * PATTERN: Preserve non-test scripts
 * Scripts not in the testScripts array are copied to updatedScripts
 * without modification. This maintains all other npm scripts.
 *
 * * CONTRACT: Input from S1, output to S3
 * Input: PackageJsonScriptsResult from P2.M1.T1.S1
 * Output: PackageJsonUpdateResult for P2.M1.T1.S3 verification
 *
 * @param input - PackageJsonScriptsResult from S1
 * @param options - Update behavior options
 * @returns PackageJsonUpdateResult with updated scripts
 *
 * @example
 * ```typescript
 * const input = readPackageJsonScripts();
 *
 * if (input.success) {
 *   const result = updateTestScriptsWithMemoryLimit(input);
 *
 *   if (result.success) {
 *     console.log('Updated:', result.updated);
 *     // ['test', 'test:run', 'test:watch', 'test:coverage', 'test:bail']
 *   }
 * }
 * ```
 */
export function updateTestScriptsWithMemoryLimit(
  input: PackageJsonScriptsReadResult,
  options: ScriptUpdateOptions = {}
): PackageJsonUpdateOutput {
  // Extract options with defaults
  const { onExistingOptions = 'skip' } = options;

  // PATTERN: Validate input
  if (!input.success) {
    logger().error(
      'Invalid input: PackageJsonScriptsResult.success must be true'
    );
    return buildErrorResult(
      'Invalid input: input.success must be true',
      'INVALID_INPUT'
    );
  }

  const { scripts, testScripts } = input;

  // PATTERN: Initialize tracking arrays
  const updated: string[] = [];
  const updatedScripts: Record<string, string> = { ...scripts };

  // PATTERN: Iterate through test scripts
  for (const scriptName of testScripts) {
    const currentCommand = scripts[scriptName];

    // Check for missing/undefined/null script (empty string is valid)
    if (currentCommand === undefined || currentCommand === null) {
      logger().warn(
        `Script "${scriptName}" not found in scripts object, skipping`
      );
      continue;
    }

    // PATTERN: Check for existing NODE_OPTIONS
    if (hasNodeOptions(currentCommand)) {
      if (onExistingOptions === 'error') {
        logger().error(`Script "${scriptName}" already has NODE_OPTIONS`);
        return buildErrorResult(
          `Script "${scriptName}" already has NODE_OPTIONS`,
          'DUPLICATE_OPTIONS'
        );
      } else if (onExistingOptions === 'skip') {
        logger().info(
          `Script "${scriptName}" already has NODE_OPTIONS, skipping`
        );
        continue;
      }
      // 'replace' option: remove existing NODE_OPTIONS first
    }

    // PATTERN: Prepend NODE_OPTIONS
    // If replace option and has NODE_OPTIONS, remove them first
    const commandWithoutOptions =
      onExistingOptions === 'replace' && hasNodeOptions(currentCommand)
        ? removeExistingNodeOptions(currentCommand)
        : currentCommand;

    const newCommand = prependNodeOptions(commandWithoutOptions);
    updatedScripts[scriptName] = newCommand;
    updated.push(scriptName);

    logger().debug(
      `Updated script "${scriptName}": ${currentCommand} → ${newCommand}`
    );
  }

  // PATTERN: Write updated package.json
  const packageJsonPath = path.join(process.cwd(), 'package.json');
  const writeSuccess = writePackageJson(packageJsonPath, updatedScripts);

  if (!writeSuccess) {
    logger().error('Failed to write package.json');
    return buildErrorResult('Failed to write package.json', 'WRITE_FAILED');
  }

  // PATTERN: Return success result
  logger().info(
    `Successfully updated ${updated.length} test script(s) with memory limit`
  );
  return buildUpdateResult(updated, updatedScripts);
}
