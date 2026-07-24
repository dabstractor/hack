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

import { gitStatus, gitAdd, gitCommit, gitDiff } from '../tools/git-mcp.js';
import { basename } from 'node:path';
import { getLogger, type Logger } from './logger.js';
import { AgentError } from './errors.js';
import { createPrompt } from 'groundswell';
import { z } from 'zod';
import { createCommitMessageAgent } from '../agents/commit-message-agent.js';

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
  'prd_snapshot.md', // PRP snapshot for delta detection
  'delta_prd.md', // Delta PRP document
  'delta_from.txt', // Parent session reference for delta sessions
  'TEST_RESULTS.md', // QA bug report output
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

// ===== STAGECOACH (LLM COMMIT-MESSAGE GENERATION) =====

/**
 * Options controlling {@link smartCommit} commit-message resolution.
 *
 * @remarks
 * When `generateMessage` is `true`, {@link smartCommit} delegates
 * commit-message generation to the stagecoach LLM agent
 * ({@link createCommitMessageAgent}), which reads the staged diff and emits a
 * descriptive conventional-commit message. The default (omitted / `false`)
 * path uses the caller-provided `message` verbatim — byte-for-byte backward
 * compatible.
 *
 * On generation failure, `smartCommit` logs and returns `null` (it never
 * throws); the retry layer (P3.M1.T4.S1) wraps the inner
 * {@link generateCommitMessage} boundary with `retryAgentPrompt`.
 */
export interface SmartCommitOptions {
  /** When `true`, delegate commit-message generation to the stagecoach LLM
   * agent, which reads the staged diff. Default (omitted / `false`): use the
   * caller-provided `message` verbatim (backward compatible). */
  readonly generateMessage?: boolean;
}

/**
 * Builds the user-turn prompt that injects the staged diff for the agent.
 *
 * @param diff - The staged diff text.
 * @returns A user prompt restating the formatting rules + the fenced diff.
 */
function buildCommitMessageUserPrompt(diff: string): string {
  return [
    'Generate a git commit message for the staged diff below.',
    'Follow the formatting rules in your system instructions exactly.',
    '',
    '```diff',
    diff,
    '```',
  ].join('\n');
}

/**
 * Generate a descriptive conventional-commit message from a staged diff via
 * the stagecoach LLM agent.
 *
 * @param diff - The staged diff text (post-`gitAdd`, filtered staged set).
 * @returns The trimmed commit message (subject + optional body), WITHOUT the
 * `[PRP Auto]` prefix or `Co-Authored-By` trailer — the caller wraps those via
 * {@link formatCommitMessage}.
 * @throws {AgentError} On any failure: empty/whitespace-only `diff`, agent
 * `status: 'error'`, or empty/whitespace/sentinel (`'skip'`) agent output.
 *
 * @remarks
 * **This is the transient-API-sensitive generation boundary** that
 * P3.M1.T4.S1 wraps with `retryAgentPrompt`. A generation timeout is LLM-API
 * slowness, not a stuck subprocess — so the boundary throws {@link AgentError}
 * (which hardcodes `code = PIPELINE_AGENT_LLM_FAILED` and is classified
 * **transient** by `isTransientError`). This lets the retry layer distinguish
 * "LLM-API slowness (retry)" from an exit-124 subprocess hang (never retry).
 *
 * The agent's system prompt forbids emitting the `[PRP Auto]` prefix or
 * `Co-Authored-By` trailer; this function returns ONLY the descriptive
 * message. The caller (`smartCommit`) wraps it via `formatCommitMessage`.
 *
 * @example
 * ```typescript
 * const msg = await generateCommitMessage(stagedDiff);
 * // msg: 'feat(api): add endpoint'
 * ```
 */
export async function generateCommitMessage(diff: string): Promise<string> {
  if (!diff || !diff.trim()) {
    throw new AgentError(
      'stagecoach commit-message generation failed: empty staged diff'
    );
  }
  const agent = createCommitMessageAgent();
  const prompt = createPrompt({
    user: buildCommitMessageUserPrompt(diff),
    responseFormat: z.string(),
  });
  const r = await agent.prompt(prompt);
  if (r.status === 'error') {
    throw new AgentError(
      `stagecoach commit-message generation failed: ${r.error?.message ?? 'unknown agent error'}`
    );
  }
  const message = (r.data ?? '').trim();
  if (!message || message === 'skip') {
    throw new AgentError(
      'stagecoach commit-message generation failed: empty agent output'
    );
  }
  return message;
}

// ===== MAIN FUNCTION =====

/**
 * Creates a smart Git commit excluding protected pipeline state files.
 *
 * @param sessionPath - Path to git repository (usually project root).
 * @param message - Commit message describing what was implemented. This is
 * the SOLE input for the default path and the FALLBACK for the generate path.
 * @param options - Optional {@link SmartCommitOptions}. When
 * `options.generateMessage === true`, the commit message is generated from the
 * staged diff by the stagecoach LLM agent (see {@link generateCommitMessage});
 * otherwise `message` is used verbatim (default — byte-for-byte backward
 * compatible).
 * @returns Promise resolving to commit hash, or `null` if no commit was made.
 *
 * @remarks
 * **Workflow**:
 * 1. Check git status for modified and untracked files
 * 2. Filter out protected files (tasks.json, PRD.md, prd_snapshot.md)
 * 3. If no files remain, return `null` (skip commit)
 * 4. Stage remaining files with `git add`
 * 5. Resolve the commit message:
 *    - **Default path** (option omitted / `generateMessage !== true`):
 *      `formatCommitMessage(message)` — byte-identical to pre-stagecoach
 *      behavior. Existing callers and tests are untouched.
 *    - **Stagecoach path** (`generateMessage === true`, PRD §5.1): run
 *      `gitDiff({ staged: true })` (reflects the filtered staged set — MUST
 *      run AFTER `gitAdd`), feed the diff to {@link generateCommitMessage},
 *      and wrap the LLM output in `formatCommitMessage`. This produces a
 *      diff-accurate message instead of a fixed template — intended for the
 *      two-phase cleanup commits (P3.M1.T3.S2: pre-cleanup survival commit +
 *      post-cleanup commit) whose diffs are unpredictable.
 * 6. Create commit with `[PRP Auto]` prefix and `Co-Authored-By` trailer
 * 7. Return commit hash for observability
 *
 * **Error Handling (never-fail-on-commit contract)**:
 * - Git operation failures are logged but don't throw.
 * - `generateCommitMessage` (the stagecoach boundary) DOES throw
 *   {@link AgentError} on failure (transient — classified by
 *   `isTransientError`), but `smartCommit`'s outer `try/catch` converts that
 *   throw to a `null` return + `error` log. The retry layer (P3.M1.T4.S1)
 *   wraps the INNER `generateCommitMessage` boundary, NOT `smartCommit`.
 * - Returns `null` on any failure to allow the pipeline to continue.
 *
 * **Protected Files**:
 * - `PRD.md`: Original PRD document
 * - `prd_snapshot.md`: PRD snapshot for delta detection
 * - `delta_prd.md` / `delta_from.txt`: delta-session references
 * - `TEST_RESULTS.md`: QA bug report output
 * - (`tasks.json` is intentionally NOT protected — the status delta rides
 *   with the commit.)
 *
 * @example
 * ```typescript
 * // Default (pre-formatted message) — byte-identical to pre-stagecoach:
 * const hash = await smartCommit('/project', 'P3.M4.T1.S3: Implement feature');
 *
 * // Stagecoach (generate from staged diff):
 * const hash2 = await smartCommit(
 *   '/project',
 *   'P3.M1.T3.S2: cleanup fallback',
 *   { generateMessage: true }
 * );
 * ```
 */
export async function smartCommit(
  sessionPath: string,
  message: string,
  options?: SmartCommitOptions
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

    // Resolve the commit message. The DEFAULT path (option omitted / false)
    // is byte-identical to the pre-stagecoach behavior: formatCommitMessage(
    // message). The stagecoach path (generateMessage:true, PRD §5.1) reads the
    // staged diff AFTER gitAdd (so it reflects the filtered staged set, not
    // the raw working tree) and delegates generation to the LLM agent.
    let formattedMessage: string;
    if (options?.generateMessage) {
      const diffResult = await gitDiff({ path: repoRoot, staged: true });
      if (!diffResult.success) {
        // Mirror the gitAdd-failure path: do NOT feed an undefined diff to the
        // agent. The outer try/catch returns null here.
        logger().error(`Git diff (staged) failed: ${diffResult.error}`);
        return null;
      }
      // generateCommitMessage throws AgentError (transient) on failure → caught
      // by the outer try/catch below → null return. P3.M1.T4.S1's retry wraps
      // this INNER boundary, not smartCommit.
      const generated = await generateCommitMessage(diffResult.diff ?? '');
      formattedMessage = formatCommitMessage(generated);
    } else {
      formattedMessage = formatCommitMessage(message);
    }

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
