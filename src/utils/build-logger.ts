/**
 * Build logger for TypeScript compilation success documentation
 *
 * @module utils/build-logger
 *
 * @remarks
 * Provides functionality to document successful TypeScript compilation
 * in BUILD_LOG.md with git commit hash tracking for regression detection.
 *
 * Features:
 * - Early return when verification failed (resolved: false)
 * - Git commit hash retrieval using simple-git
 * - BUILD_LOG.md creation with markdown table format
 * - Append functionality for incremental logging
 * - Structured result with completion flag
 *
 * @example
 * ```typescript
 * import { documentBuildSuccess } from './utils/build-logger.js';
 * import { verifyNoModuleErrors } from './utils/module-resolution-verifier.js';
 *
 * const verification = verifyNoModuleErrors(analysis);
 * const result = await documentBuildSuccess(verification);
 *
 * if (result.logged) {
 *   console.log('Build documented at:', result.path);
 * }
 * ```
 */

import { writeFile, readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { simpleGit, GitError } from 'simple-git';
import type { ModuleErrorVerifyResult } from './module-resolution-verifier.js';
import { getLogger, type Logger } from './logger.js';

let _logger: Logger | undefined;
const logger = (): Logger => (_logger ??= getLogger('BuildLogger'));

// =============================================================================
// TYPES
// =============================================================================

/**
 * Result of build log documentation
 *
 * @remarks
 * Returned by documentBuildSuccess() to indicate whether the build
 * success was documented in BUILD_LOG.md and where the log file is located.
 */
export interface BuildLogResult {
  /** Whether entry was written to BUILD_LOG.md */
  logged: boolean;

  /** Absolute path to BUILD_LOG.md (empty if not logged) */
  path: string;

  /** Human-readable status message */
  message: string;
}

/**
 * Internal build log entry interface
 *
 * @remarks
 * Structure for individual build log entries before formatting
 * as markdown table rows.
 */
interface BuildLogEntry {
  /** ISO 8601 timestamp */
  timestamp: string;

  /** Git commit hash (null if not available) */
  commitHash: string | null;

  /** Build result (always "SUCCESS" when logging occurs) */
  result: 'SUCCESS';

  /** Number of remaining errors (should be 0) */
  remainingErrors: number;

  /** Additional notes about the build */
  notes: string;
}

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * BUILD_LOG.md file path (relative to project root)
 *
 * @remarks
 * Located in the bugfix-specific plan directory to keep build logs
 * organized by PRD and work item.
 */
const BUILD_LOG_PATH =
  'plan/001_14b9dc2a33c7/bugfix/001_7f5a0fab4834/BUILD_LOG.md';

/**
 * BUILD_LOG.md header content
 *
 * @remarks
 * Created when BUILD_LOG.md doesn't exist. Includes title,
 * description, and markdown table header row.
 */
const BUILD_LOG_HEADER = `# TypeScript Compilation Build Log

This file tracks successful TypeScript compilations for bugfix 001_7f5a0fab4834.
Entries are added automatically when module resolution verification passes.

| Timestamp | Commit Hash | Result | Remaining Errors | Notes |
|-----------|-------------|--------|------------------|-------|
`;

// =============================================================================
// MAIN FUNCTION
// =============================================================================

/**
 * Documents successful TypeScript compilation in BUILD_LOG.md
 *
 * @remarks
 * * PATTERN: Early return when resolved is false
 * Only log when module resolution verification succeeded. If failed,
 * return early with logged: false and explanatory message.
 *
 * * PATTERN: Get commit hash using simple-git
 * Uses git.revparse(['HEAD']) to retrieve current commit hash.
 * Gracefully handles non-git repositories by using null.
 *
 * * PATTERN: Create or append to BUILD_LOG.md
 * If file doesn't exist, create with header. If exists, append new row.
 * Uses readFile/writeFile pattern for consistency with codebase.
 *
 * @param verification - ModuleErrorVerifyResult from verifyNoModuleErrors()
 * @param projectRoot - Optional project root path (defaults to process.cwd())
 * @returns BuildLogResult with logging status and file path
 */
export async function documentBuildSuccess(
  verification: ModuleErrorVerifyResult,
  projectRoot?: string
): Promise<BuildLogResult> {
  // PATTERN: Early return when verification failed
  // CRITICAL: Only log when module resolution succeeded
  if (!verification.resolved) {
    const message = `Skipping build log - module resolution not verified. ${verification.message}`;
    logger().info(message);
    return {
      logged: false,
      path: '',
      message,
    };
  }

  try {
    // Determine project root
    const root = projectRoot ?? process.cwd();

    // Get git commit hash
    const commitHash = await getCommitHash(root);

    // Determine BUILD_LOG.md path
    const logPath = resolve(root, BUILD_LOG_PATH);

    // Create or append to BUILD_LOG.md
    const fileExists = await checkFileExists(logPath);

    if (!fileExists) {
      await createBuildLog(logPath);
    }

    await appendToBuildLog(logPath, {
      timestamp: new Date().toISOString(),
      commitHash,
      result: 'SUCCESS',
      remainingErrors: verification.remainingCount,
      notes: verification.message,
    });

    const message = `Build log entry created at ${logPath}`;
    logger().info(message);

    return {
      logged: true,
      path: logPath,
      message,
    };
  } catch (error) {
    // PATTERN: Handle errors gracefully, don't throw
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger().error(`Failed to document build success: ${errorMessage}`);

    return {
      logged: false,
      path: '',
      message: `Failed to create build log entry: ${errorMessage}`,
    };
  }
}

// =============================================================================
// GIT HASH RETRIEVAL
// =============================================================================

/**
 * Retrieves current git commit hash from repository
 *
 * @remarks
 * Uses simple-git's revparse() method to get HEAD commit hash.
 * Returns null if not in a git repository or git operation fails.
 *
 * @param projectPath - Path to git repository
 * @returns Commit hash string, or null if unavailable
 */
async function getCommitHash(projectPath: string): Promise<string | null> {
  try {
    const git = simpleGit(projectPath);
    const hash = await git.revparse(['HEAD']);
    return hash;
  } catch (error) {
    // PATTERN: Handle git errors gracefully
    if (error instanceof GitError) {
      logger().warn(`Git error retrieving commit hash: ${error.message}`);
      return null;
    }
    logger().warn(`Unexpected error retrieving commit hash: ${error}`);
    return null;
  }
}

// =============================================================================
// FILE SYSTEM HELPERS
// =============================================================================

/**
 * Checks if a file exists
 *
 * @remarks
 * Uses fs.access() with F_OK to check file existence.
 * Returns false if file doesn't exist or access fails.
 *
 * @param filePath - Path to file to check
 * @returns True if file exists and is accessible
 */
async function checkFileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Creates BUILD_LOG.md with header and table structure
 *
 * @remarks
 * Creates directory structure if needed and writes header with
 * markdown table. Uses writeFile to ensure atomic creation.
 *
 * @param logPath - Absolute path to BUILD_LOG.md
 */
async function createBuildLog(logPath: string): Promise<void> {
  await writeFile(logPath, BUILD_LOG_HEADER, 'utf-8');
  logger().debug(`Created new build log at ${logPath}`);
}

/**
 * Appends a new entry to BUILD_LOG.md
 *
 * @remarks
 * Reads existing content, formats new entry as markdown table row,
 * appends to content, and writes back to file. This preserves
 * existing entries while adding new ones.
 *
 * @param logPath - Absolute path to BUILD_LOG.md
 * @param entry - Build log entry to append
 */
async function appendToBuildLog(
  logPath: string,
  entry: BuildLogEntry
): Promise<void> {
  const existingContent = await readFile(logPath, 'utf-8');
  const newEntry = formatLogEntry(entry);
  const updatedContent = existingContent + newEntry;

  await writeFile(logPath, updatedContent, 'utf-8');
  logger().debug(`Appended entry to build log: ${entry.timestamp}`);
}

/**
 * Formats a build log entry as a markdown table row
 *
 * @remarks
 * Converts BuildLogEntry to pipe-separated markdown table row.
 * Handles null commit hash by displaying 'N/A'.
 *
 * @param entry - Build log entry data
 * @returns Markdown table row string with trailing newline
 */
function formatLogEntry(entry: BuildLogEntry): string {
  const hash = entry.commitHash ?? 'N/A';
  return `| ${entry.timestamp} | ${hash} | ${entry.result} | ${entry.remainingErrors} | ${entry.notes} |\n`;
}
