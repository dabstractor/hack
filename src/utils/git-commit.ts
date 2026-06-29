/**
 * Git commit utilities for PRP Pipeline
 *
 * @module utils/git-commit
 *
 * @remarks
 * Provides automated Git commit functionality with smart file filtering.
 * Protects pipeline state files from being committed while automatically
 * creating checkpoints after each subtask completion.
 *
 * @example
 * ```typescript
 * import { smartCommit } from './utils/git-commit.js';
 *
 * const commitHash = await smartCommit(
 *   '/project/session/path',
 *   'P3.M4.T1.S3: Implement smart commit workflow'
 * );
 * // Returns: 'abc123def456...' or null if no files to commit
 * ```
 */

import { gitStatus, gitAdd, gitCommit } from '../tools/git-mcp.js';
import { basename } from 'node:path';
import { getLogger, type Logger } from './logger.js';

let _logger: Logger | undefined;
const logger = (): Logger => (_logger ??= getLogger('smartCommit'));

// ===== CONSTANTS =====

/**
 * Files that must never be committed by smart commit
 *
 * @remarks
 * These files contain pipeline state and must remain uncommitted
 * to enable clean pipeline resumption and state management.
 */
// Files excluded from per-task commits. tasks.json is intentionally NOT here:
// the user requires each task commit to include the status delta (subtask →
// Complete) so the task registry tracks alongside the deliverables.
const PROTECTED_FILES = [
  'PRD.md', // Original PRD document
  'prd_snapshot.md', // PRD snapshot for delta detection
] as const;

// ===== HELPER FUNCTIONS =====

/**
 * Filters out protected files from a list of files.
 *
 * @returns Array of file paths excluding protected pipeline-control files.
 *
 * @remarks
 * Excludes only the PROTECTED_FILES (the PRD input) by basename. Everything
 * else under plan/ — including per-task artifacts (checkpoints.json,
 * validation results, summaries), the task registry, and research — is
 * committed WITH the task in a single commit. The duplicate-named noise
 * commits are prevented upstream by executeSubtask skipping already-Complete
 * subtasks on resume, so each task runs exactly once and its artifacts ride
 * in its one commit.
 */
export function filterProtectedFiles(files: string[]): string[] {
  return files.filter(file => {
    const fileName = basename(file) as (typeof PROTECTED_FILES)[number];
    return !PROTECTED_FILES.includes(fileName);
  });
}

/**
 * Formats a commit message with PRP prefix and co-author trailer
 *
 * @param message - Base commit message
 * @returns Formatted commit message with prefix and trailer
 *
 * @remarks
 * Adds [PRP Auto] prefix to distinguish automated commits.
 * Appends Co-Authored-By: Claude trailer per AI contribution standards.
 *
 * @example
 * ```typescript
 * formatCommitMessage('P3.M4.T1.S3: Implement smart commit');
 * // Returns: '[PRP Auto] P3.M4.T1.S3: Implement smart commit\n\nCo-Authored-By: Claude <noreply@anthropic.com>'
 * ```
 */
export function formatCommitMessage(message: string): string {
  return `[PRP Auto] ${message}\n\nCo-Authored-By: Claude <noreply@anthropic.com>`;
}

// ===== MAIN FUNCTION =====

/**
 * Creates a smart Git commit excluding protected pipeline state files
 *
 * @param sessionPath - Path to git repository (usually project root)
 * @param message - Commit message describing what was implemented
 * @returns Promise resolving to commit hash, or null if no commit was made
 *
 * @remarks
 * **Workflow**:
 * 1. Check git status for modified and untracked files
 * 2. Filter out protected files (tasks.json, PRD.md, prd_snapshot.md)
 * 3. If no files remain, return null (skip commit)
 * 4. Stage remaining files with git add
 * 5. Create commit with [PRP Auto] prefix and Co-Authored-By trailer
 * 6. Return commit hash for observability
 *
 * **Error Handling**:
 * - Git operation failures are logged but don't throw
 * - Returns null on any failure to allow pipeline to continue
 * - Errors are logged to console.error for debugging
 *
 * **Protected Files**:
 * - `tasks.json`: Pipeline task registry state
 * - `PRD.md`: Original PRD document
 * - `prd_snapshot.md`: PRD snapshot for delta detection
 *
 * @example
 * ```typescript
 * const hash = await smartCommit('/project', 'P3.M4.T1.S3: Implement smart commit');
 * if (hash) {
 *   console.log(`Commit created: ${hash}`);
 * } else {
 *   console.log('No files to commit');
 * }
 * ```
 */
export async function smartCommit(
  sessionPath: string,
  message: string
): Promise<string | null> {
  try {
    // Validate inputs
    if (!sessionPath || sessionPath.trim() === '') {
      logger().error('Invalid session path');
      return null;
    }

    if (!message || message.trim() === '') {
      logger().error('Invalid commit message');
      return null;
    }

    // CRITICAL: Git operations run at the REPO ROOT (process.cwd()), NOT the
    // session path. The session path is the metadata dir (plan/001_.../) where
    // pipeline state lives; the actual implementation files the coder writes
    // land at the project root. Running git status/add/commit against the
    // session path would only ever see protected metadata files.
    const repoRoot = process.cwd();

    // Get repository status
    const statusResult = await gitStatus({ path: repoRoot });
    if (!statusResult.success) {
      logger().error(`Git status failed: ${statusResult.error}`);
      return null;
    }

    // Collect files to potentially stage
    const filesToStage: string[] = [];

    // Add modified files (excluding protected)
    if (statusResult.modified) {
      filesToStage.push(...statusResult.modified);
    }

    // Add untracked files (excluding protected)
    if (statusResult.untracked) {
      filesToStage.push(...statusResult.untracked);
    }

    // Filter out protected files
    const filteredFiles = filterProtectedFiles(filesToStage);

    // Skip commit if no files to stage
    if (filteredFiles.length === 0) {
      logger().info('No files to commit after filtering protected files');
      return null;
    }

    // Stage the files
    const addResult = await gitAdd({
      path: repoRoot,
      files: filteredFiles,
    });

    if (!addResult.success) {
      logger().error(`Git add failed: ${addResult.error}`);
      return null;
    }

    // Format commit message
    const formattedMessage = formatCommitMessage(message);

    // Create commit
    const commitResult = await gitCommit({
      path: repoRoot,
      message: formattedMessage,
    });

    if (!commitResult.success) {
      logger().error(`Git commit failed: ${commitResult.error}`);
      return null;
    }

    // Return commit hash
    const commitHash = commitResult.commitHash ?? null;
    logger().info(`Commit created: ${commitHash}`);
    return commitHash;
  } catch (error) {
    // Catch any unexpected errors
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger().error(`Unexpected error: ${errorMessage}`);
    return null;
  }
}
