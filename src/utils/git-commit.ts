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

import {
  gitStatus,
  gitAdd,
  gitCommit,
  gitDiff,
  gitListStagedDeletions,
  gitRestoreFileFromHead,
  gitUnstagePath,
} from '../tools/git-mcp.js';
import { basename } from 'node:path';
import { getLogger, type Logger } from './logger.js';
import { AgentError, isAgentError, toErrorMessage } from './errors.js';
import { createPrompt } from 'groundswell';
import { z } from 'zod';
import { createCommitMessageAgent } from '../agents/commit-message-agent.js';
import { retry, createDefaultOnRetry } from './retry.js';
import {
  getCommitRetryMax,
  getCommitRetryDelayMs,
  getCommitRetryDelayCapMs,
  getPrpCommitFormat,
} from '../config/constants.js';

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
  'prd_changed.marker', // PRD-change pending-delta marker (PRD §4.3)
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
 * The 1-indexed hierarchical position of a backlog item, parsed from its id
 * (PRD §5.1 "Commit Message Format (Standardized Task-Prefix)").
 *
 * @remarks
 * `subtask` is OPTIONAL: a Task-level item has no subtask, so its prefix
 * elides the trailing level (`1.2.1`, never `1.2.1.0`). Produced by
 * {@link parseItemPosition}; consumed by {@link buildTaskPrefix} and
 * {@link formatCommitMessage}.
 */
export interface ItemPosition {
  phase: number;
  milestone: number;
  task: number;
  subtask?: number;
}

/**
 * Regex matching a backlog-item id `P{phase}.M{milestone}.T{task}[.S{subtask}]`
 * (PRD §5.1). The `.S{subtask}` segment is OPTIONAL so a Task-level item id
 * (`P1.M2.T1`) parses to a 3-level position (trailing-level elision). Mirrors
 * — and generalizes — the STRICT 4-level {@link SubtaskSchema} id regex
 * (`src/core/models.ts:~382`, `^P\d+\.M\d+\.T\d+\.S\d+$`): runtime Subtask ids
 * are always 4-level, but the prefix builder must also render 3-level
 * positions.
 */
const ITEM_ID_PATTERN = /^P(\d+)\.M(\d+)\.T(\d+)(?:\.S(\d+))?$/;

/**
 * Parse a backlog-item id into an {@link ItemPosition} (PRD §5.1).
 *
 * @param id - The item id, e.g. `'P1.M2.T1.S1'` (Subtask) or `'P1.M2.T1'`
 *            (Task-level, no subtask).
 * @returns The parsed position (`subtask` present iff the id had an `.S{n}`
 *          segment), or `null` when `id` does not match
 *          {@link ITEM_ID_PATTERN} (malformed, wrong case, extra segments, …).
 *
 * @example
 * ```ts
 * parseItemPosition('P1.M2.T1.S1'); // { phase:1, milestone:2, task:1, subtask:1 }
 * parseItemPosition('P1.M2.T1');    // { phase:1, milestone:2, task:1 }
 * parseItemPosition('garbage');     // null
 * ```
 */
export function parseItemPosition(id: string): ItemPosition | null {
  const m = ITEM_ID_PATTERN.exec(id);
  if (!m) return null;
  const pos: ItemPosition = {
    phase: Number(m[1]),
    milestone: Number(m[2]),
    task: Number(m[3]),
  };
  if (m[4] !== undefined) {
    pos.subtask = Number(m[4]);
  }
  return pos;
}

/**
 * Render an {@link ItemPosition} as the standardized task-prefix
 * `<phase>.<milestone>.<task>[.<subtask>]` (PRD §5.1).
 *
 * @param pos - The item position.
 * @returns The dotted prefix with trailing unused levels ELIDED:
 *          `{1,2,1,1}` → `'1.2.1.1'`; `{1,2,1}` → `'1.2.1'` (never `'1.2.1.0'`).
 *
 * @example
 * ```ts
 * buildTaskPrefix({ phase:1, milestone:2, task:1, subtask:1 }); // '1.2.1.1'
 * buildTaskPrefix({ phase:1, milestone:2, task:1 });            // '1.2.1'
 * ```
 */
export function buildTaskPrefix(pos: ItemPosition): string {
  const base = `${pos.phase}.${pos.milestone}.${pos.task}`;
  return pos.subtask === undefined ? base : `${base}.${pos.subtask}`;
}

/**
 * Format a commit message per PRD §5.1 "Commit Message Format (Standardized
 * Task-Prefix)".
 *
 * @param message - The descriptive commit message (subject). May be a bare
 *                  hand-written message, an LLM-generated summary, or a fallback
 *                  placeholder; any leading `[PRP Auto] ` banner is STRIPPED
 *                  (defense-in-depth).
 * @param position - Optional {@link ItemPosition} for the implementing backlog
 *                   item. When supplied AND {@link getPrpCommitFormat} returns
 *                   `'task-prefix'` (the DEFAULT), the standardized
 *                   `<phase>.<milestone>.<task>[.<subtask>]:` prefix is layered
 *                   onto the subject. When absent/`null`, OR when the format is
 *                   `'plain'`, the subject is emitted verbatim (no prefix).
 * @returns The formatted commit message: `<prefix?><subject>\n\nCo-Authored-By:
 *          Claude <noreply@anthropic.com>`. The `Co-Authored-By` trailer is
 *          PRESERVED in BOTH modes (PRD §5.1 is silent on the trailer; only the
 *          `[PRP Auto]` banner is forbidden).
 *
 * @remarks
 * - NEVER emits the legacy `[PRP Auto]` banner (PRD §5.1 forbids it). A stray
 *   `[PRP Auto] ` the caller/LLM may have included in `message` is stripped as
 *   defense-in-depth.
 * - Non-backlog commits (initial, fallback, scaffolding, cleanup) pass NO
 *   `position` → plain subject (PRD §5.1: "When task-prefix selected but commit
 *   is not a backlog item → degrade to plain").
 * - The trailer is appended after a blank line in both modes (architecture
 *   decision: removing it is a separate product concern).
 *
 * @example
 * ```ts
 * // task-prefix mode (DEFAULT — PRP_COMMIT_FORMAT unset):
 * formatCommitMessage('add utility', { phase:1, milestone:2, task:1, subtask:1 });
 * // => '1.2.1.1: add utility\n\nCo-Authored-By: Claude <noreply@anthropic.com>'
 *
 * // plain mode (PRP_COMMIT_FORMAT=plain) — position ignored:
 * formatCommitMessage('add utility', { phase:1, milestone:2, task:1, subtask:1 });
 * // => 'add utility\n\nCo-Authored-By: Claude <noreply@anthropic.com>'
 *
 * // no position (non-backlog) → always plain:
 * formatCommitMessage('cleanup: doc reorganization');
 * // => 'cleanup: doc reorganization\n\nCo-Authored-By: Claude <noreply@anthropic.com>'
 * ```
 */
export function formatCommitMessage(
  message: string,
  position?: ItemPosition | null
): string {
  // Defense-in-depth: strip any stray [PRP Auto] banner the caller/LLM may have
  // included. PRD §5.1 forbids the banner; the stagecoach agent is also told
  // not to emit it, but this guarantees it can never reach the history.
  const subject = message.replace(/^\[PRP Auto\]\s*/, '');
  const withPrefix =
    position && getPrpCommitFormat() === 'task-prefix'
      ? `${buildTaskPrefix(position)}: ${subject}`
      : subject;
  return `${withPrefix}\n\nCo-Authored-By: Claude <noreply@anthropic.com>`;
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
 * {@link generateCommitMessage} boundary with a bounded `retry()` loop using
 * the `COMMIT_RETRY_*` constants (PRD §5.1).
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
 * P3.M1.T4.S1 wraps with a bounded `retry()` loop (PRD §5.1, using the
 * `COMMIT_RETRY_*` constants — NOT the hardcoded `retryAgentPrompt`). A
 * generation timeout is LLM-API slowness, not a stuck subprocess — so the
 * boundary throws {@link AgentError}
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

// ===== LAST-RESORT FALLBACK (PRD §5.1) =====

/**
 * Sentinel "exit code" used in the fallback placeholder commit message when
 * commit-message generation fails after all retries (PRD §5.1).
 *
 * @remarks
 * The stagecoach generation boundary is a pure LLM-API call (Groundswell
 * agent.prompt), NOT a subprocess. A transient LLM-API failure
 * (429/504/timeout) has NO OS exit code, and {@link AgentError} carries no
 * `exitCode` field. So the PRD §5.1 placeholder label
 * `chore: commit-gen failed (exit N); fallback commit` cannot be populated
 * with a real exit code — `0` is the sentinel meaning "no subprocess exit code
 * (LLM-API failure)". If a future error type (e.g. an exit-124 watchdog error
 * from P3.M2.T2) carries `context.exitCode`, that value is used instead (see
 * {@link buildFallbackCommitMessage}).
 */
const COMMIT_GEN_FALLBACK_EXIT_SENTINEL = 0;

/**
 * Build the last-resort fallback placeholder commit message (PRD §5.1).
 *
 * @param error - The error thrown by the exhausted retry loop (the original
 * {@link AgentError} rethrown by `retry()` — NOT a wrapper).
 * @returns The placeholder subject line, e.g.
 * `'chore: commit-gen failed (exit 0); fallback commit'`. The caller wraps it
 * via {@link formatCommitMessage} (task-prefix or plain per PRD §5.1 +
 * `Co-Authored-By` trailer).
 *
 * @remarks
 * PRD §5.1 mandates a "clearly-labeled placeholder message … so the substance
 * is preserved and can be reworded later." The `exit N` segment reflects the
 * last exit code when one is available (read from a {@link PipelineError}
 * `context.exitCode`); otherwise the {@link COMMIT_GEN_FALLBACK_EXIT_SENTINEL}
 * (`0`) is used, because LLM-API failures have no subprocess exit code.
 */
export function buildFallbackCommitMessage(error: unknown): string {
  let exitCode: number = COMMIT_GEN_FALLBACK_EXIT_SENTINEL;
  if (isAgentError(error)) {
    const ctx = error.context as Record<string, unknown> | undefined;
    if (ctx && typeof ctx.exitCode === 'number') {
      exitCode = ctx.exitCode;
    }
  }
  return `chore: commit-gen failed (exit ${exitCode}); fallback commit`;
}

// ===== CRITICAL-FILE DELETION PROTECTION (PRD §5.1, mechanical layer) =====

/**
 * Mechanical critical-file deletion protection (PRD §5.1).
 *
 * @remarks
 * Invoked from {@link smartCommit} immediately AFTER staging (`gitAdd`) and
 * BEFORE commit-message resolution / `gitCommit`. Detects any paths staged as
 * DELETIONS (`git diff --cached --diff-filter=D`) whose basename is `PRD.md`
 * or `PRP.md` (covers root `PRD.md` and every nested `PRP.md` via a basename
 * match — no fast-glob needed, no `node_modules` false positives) and undoes
 * the deletion so the commit cannot wipe a protected document:
 *
 *   - if the file exists in HEAD → `git checkout HEAD -- <path>` restores the
 *     working tree AND clears the staged deletion from the index in one call;
 *   - if it was created-and-deleted in the same run (not in HEAD) →
 *     `git reset HEAD -- <path>` unstages the deletion.
 *
 * This is the MECHANICAL backstop to the prompt layer (P3.M2.T4.S1): the
 * prompt layer prohibits agents from deleting `PRD.md` / `PRP.md`; this layer
 * catches the residual cases where an agent deletes despite the prompt.
 * Together they guarantee `PRD.md` and every `PRP.md` survive every commit.
 *
 * **Non-fatal / best-effort** (honors smartCommit's never-fail-on-commit
 * contract): per-path failures are logged via `logger().warn` and the loop
 * continues. A thrown error never escapes — even if every restore attempt
 * fails, `smartCommit` still proceeds to commit the (unchanged) staged set.
 *
 * @param repoRoot - Repository root path (process.cwd() at the smartCommit
 * call site).
 */
export async function restore_critical_files(repoRoot: string): Promise<void> {
  try {
    const del = await gitListStagedDeletions(repoRoot);
    if (!del.success || !del.files?.length) return;
    for (const path of del.files) {
      const name = basename(path);
      // Basename match: covers root PRD.md and every nested PRP.md without
      // fast-glob and without node_modules false positives.
      if (name !== 'PRD.md' && name !== 'PRP.md') continue; // non-critical: leave staged
      try {
        const restore = await gitRestoreFileFromHead(path, repoRoot);
        if (restore.success) {
          logger().warn(
            `Restored critical file from HEAD (staged deletion undone): ${path}`
          );
          continue;
        }
        // restore failed → likely not in HEAD (created-and-deleted same run) →
        // unstage the deletion instead. gitRestoreFileFromHead returns
        // {success:false} when the path is absent from HEAD (git.checkout
        // fails), which we treat as the signal to unstage. This two-strategy
        // approach avoids a separate `git ls-tree` round-trip and handles the
        // rare phantom-entry case defensively (research/01 Q3).
        const unstage = await gitUnstagePath(path, repoRoot);
        if (unstage.success) {
          logger().warn(
            `Unstaged critical file deletion (not in HEAD): ${path}`
          );
        } else {
          logger().warn(
            `Could not restore/unstage critical file ${path}: ${unstage.error ?? restore.error}`
          );
        }
      } catch (perPath) {
        logger().warn(
          `restore_critical_files: per-path error for ${path}: ${toErrorMessage(perPath)}`
        );
      }
    }
  } catch (error) {
    logger().warn(`restore_critical_files: aborted: ${toErrorMessage(error)}`);
  }
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
 *   `isTransientError`). The retry layer (P3.M1.T4.S1) wraps the INNER
 *   `generateCommitMessage` boundary with a bounded `retry()` loop using the
 *   `COMMIT_RETRY_*` constants (PRD §5.1), NOT `smartCommit`. When all retry
 *   attempts are exhausted, `retry()` rethrows the last `AgentError`, which an
 *   INNER `try/catch` (PRD §5.1, P3.M1.T4.S2) catches and converts into a
 *   **last-resort fallback placeholder commit** via {@link buildFallbackCommitMessage} + a direct `gitCommit` — the staged substance is NEVER stranded. The outer `try/catch` only catches truly unexpected throws (e.g. a git operation throwing) → `null` return.
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

    // ── Critical-File Deletion Protection (PRD §5.1, mechanical layer) ──
    // Detect staged deletions of PRD.md / nested PRP.md and undo them, so the
    // stagecoach gitDiff({staged:true}) + gitCommit below see a deletion-free
    // staged set. Must run AFTER gitAdd and BEFORE commit-message resolution.
    // Best-effort/non-fatal: restore_critical_files swallows its own errors.
    await restore_critical_files(repoRoot);

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
      // generateCommitMessage is the transient-API-sensitive LLM boundary
      // (PRD §5.1). Wrap ONLY this boundary in a bounded retry loop with
      // exponential backoff — NOT gitDiff/gitAdd/gitCommit (the index is
      // staged once and committed once; no re-staging between retries). The
      // diff is read ONCE above and captured here; only the LLM call repeats.
      // isRetryable is intentionally OMITTED → defaults to isTransientError
      // (PRD §5.1 contract item 3c). generateCommitMessage throws AgentError
      // (PIPELINE_AGENT_LLM_FAILED) which isTransientError classifies
      // transient. Permanent errors (none today) would not retry.
      try {
        const generated = await retry(
          () => generateCommitMessage(diffResult.diff ?? ''),
          {
            maxAttempts: getCommitRetryMax(),
            baseDelay: getCommitRetryDelayMs(),
            maxDelay: getCommitRetryDelayCapMs(),
            backoffFactor: 2, // doubling (PRD §5.1)
            onRetry: createDefaultOnRetry(
              'stagecoach.generateCommitMessage',
              getCommitRetryMax()
            ),
          }
        );
        formattedMessage = formatCommitMessage(generated);
      } catch (genError) {
        // PRD §5.1 last-resort fallback: generation failed after all retries.
        // The index is still staged (gitAdd ran before generation), so commit
        // the substance with a labeled placeholder so it's never stranded.
        // LLM-API failures have no subprocess exit code → sentinel 0 (see
        // buildFallbackCommitMessage). Flow CONTINUES (no rethrow) to the
        // shared gitCommit call below, which handles both the happy path and
        // this fallback path.
        logger().warn(
          `Commit-message generation failed after retries; falling back to placeholder commit: ${toErrorMessage(genError)}`
        );
        formattedMessage = formatCommitMessage(
          buildFallbackCommitMessage(genError)
        );
      }
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
