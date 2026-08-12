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
  gitDiff,
  gitWriteTree,
  gitRevParseHead,
  gitCommitTree,
  gitUpdateRefCAS,
  gitListStagedDeletions,
  gitRestoreFileFromHead,
  gitUnstagePath,
} from '../tools/git-mcp.js';
import { basename } from 'node:path';
import { spawn } from 'node:child_process';
import { getLogger, type Logger } from './logger.js';
import {
  AgentError,
  CommitCasRefusedError,
  isAgentError,
  toErrorMessage,
} from './errors.js';
import { retry, createDefaultOnRetry } from './retry.js';
import { resolveStagecoachBinary } from './stagecoach-resolver.js';
import { getModel } from '../config/environment.js';
import {
  getCommitRetryMax,
  getCommitRetryDelayMs,
  getCommitRetryDelayCapMs,
  getPrpCommitFormat,
  getPrpCommitStyle,
  PRP_AGENT_HARNESS,
  DEFAULT_HARNESS,
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
 * @returns The formatted commit message: `<prefix?><subject>`. NO trailer,
 *          banner, or machine author is appended — commits are identity-
 *          transparent (PRD §5.1 "Commit-identity transparency").
 *
 * @remarks
 * - NEVER emits the legacy `[PRP Auto]` banner (PRD §5.1 forbids it). A stray
 *   `[PRP Auto] ` the caller/LLM may have included in `message` is stripped as
 *   defense-in-depth.
 * - Non-backlog commits (initial, fallback, scaffolding, cleanup) pass NO
 *   `position` → plain subject (PRD §5.1: "When task-prefix selected but commit
 *   is not a backlog item → degrade to plain").
 * - NEVER appends a `Co-Authored-By` trailer, a `Generated-by` footer, or any
 *   machine/branded authorship. PRD §5.1 "Commit-identity transparency" + §9.10.2
 *   "Commit-Identity Structural Guard" forbid them; the prior unconditional
 *   `Co-Authored-By: Claude <noreply@anthropic.com>` literal was a spec violation
 *   (it mis-attributed pi/z.ai work to Claude on every commit) and is removed, and
 *   no style layer may add a `Co-Authored-By` trailer, ever (§9.10.2 closes §5.1's
 *   "unless an explicit style layer below adds one" carve-out).
 *
 * @example
 * ```ts
 * // task-prefix mode (DEFAULT — PRP_COMMIT_FORMAT unset):
 * formatCommitMessage('add utility', { phase:1, milestone:2, task:1, subtask:1 });
 * // => '1.2.1.1: add utility'
 *
 * // plain mode (PRP_COMMIT_FORMAT=plain) — position ignored:
 * formatCommitMessage('add utility', { phase:1, milestone:2, task:1, subtask:1 });
 * // => 'add utility'
 *
 * // no position (non-backlog) → always plain:
 * formatCommitMessage('cleanup: doc reorganization');
 * // => 'cleanup: doc reorganization'
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
  // Identity-transparent (PRD §5.1): NO Co-Authored-By trailer, no machine
  // author. The prior hardcoded `Co-Authored-By: Claude <noreply@anthropic.com>`
  // was a spec violation that mis-attributed every commit to Claude regardless
  // of the actual harness/model — it has been removed.
  return withPrefix;
}

// ===== STAGECOACH (LLM COMMIT-MESSAGE GENERATION) =====

/**
 * Options controlling {@link smartCommit} commit-message resolution.
 *
 * @remarks
 * When `generateMessage` is `true`, {@link smartCommit} delegates
 * commit-message generation to the stagecoach binary
 * ({@link generateCommitMessage}), which reads the staged index and emits a
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

  /**
   * Optional backlog-item position (PRD §5.1 "Commit Message Format"). When
   * supplied AND {@link getPrpCommitFormat} returns `'task-prefix'` (the
   * DEFAULT), the standardized
   * `<phase>.<milestone>.<task>[.<subtask>]:` prefix is layered onto the
   * commit subject. When `null`/`undefined` (non-backlog commits), OR when
   * the format is `'plain'`, the subject is emitted plain.
   *
   * Pass {@link parseItemPosition} of the implementing item's id — a `null`
   * result (malformed id) degrades gracefully to plain (no throw).
   */
  readonly position?: ItemPosition | null;
}

/**
 * Generate a commit message by exec'ing the stagecoach binary (PRD §5.1).
 *
 * @remarks
 * Spawns the resolved stagecoach binary with `--dry-run --single` (the binary
 * reads the repo index itself, so it needs `cwd: repoRoot`). The `--provider`
 * flag receives the AGENT-HARNESS id (pi|claude-code), NOT an LLM provider — the
 * binary maps the harness to its backing model. `--model` receives the balanced
 * model tier; `--format` is added only when the resolved style is not `auto`.
 *
 * Every failure mode — non-zero exit, empty stdout, spawn error, resolver
 * throw — is wrapped in a transient {@link AgentError} so {@link smartCommit}'s
 * bounded retry loop re-attempts the boundary and ultimately falls back to a
 * labeled placeholder commit (PRD §5.1). The argv is passed as a vector
 * (NEVER `sh -c`) via `spawn` with no shell.
 *
 * Supersedes the in-process agent — the previous `commit-message-agent.ts`
 * and its style-learning machinery are removed in favor of stagecoach
 * delegation (§9.10.1). The in-process re-implementation (which
 * drift-acquired a hardcoded `Co-Authored-By: Claude` trailer — incident 1)
 * is gone; stagecoach's own output discipline (emit only the message; no
 * prefix, no banner, no trailer) replaces it.
 *
 * @param repoRoot - Repository root path (the binary reads the repo index; needs cwd).
 * @param _diff - UNUSED (kept for call-site compatibility). The binary reads
 *                the staged diff from the index itself.
 * @returns The trimmed commit-message subject line from stagecoach's stdout.
 * @throws {AgentError} On any failure (non-zero exit / empty stdout / spawn
 *         error / resolver throw).
 */
export async function generateCommitMessage(
  repoRoot: string,
  _diff?: string
): Promise<string> {
  const bin = resolveStagecoachBinary();
  const argv: string[] = ['--dry-run', '--single'];
  const style = getPrpCommitStyle();
  if (style !== 'auto') argv.push('--format', style);
  argv.push('--provider', process.env[PRP_AGENT_HARNESS] ?? DEFAULT_HARNESS);
  argv.push('--model', getModel('balanced'));
  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn(bin, argv, {
      cwd: repoRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let stderr = '';
    child.stdout?.on('data', (d: Buffer) => {
      out += d.toString();
    });
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    child.on('error', e =>
      reject(
        new AgentError(
          `stagecoach commit-message generation failed: ${e.message}`
        )
      )
    );
    child.on('close', code => {
      if (code !== 0) {
        reject(
          new AgentError(
            `stagecoach commit-message generation failed (exit ${code ?? 'null'})` +
              (stderr ? `: ${stderr.trim()}` : '')
          )
        );
        return;
      }
      resolve(out);
    });
  });
  const message = stdout.trim();
  if (!message)
    throw new AgentError(
      'stagecoach commit-message generation failed: empty stdout'
    );
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

// ===== GENERATION-TIMEOUT / SIGINT RESCUE (PRD §5.1, P1.M1.T3.S3) =====

/**
 * Snapshot held across the slow message-generation window so an interrupt
 * (SIGINT / SIGTERM / thrown escape) can hand the operator the immutable
 * TREE_SHA + a manual recovery command. `committed` flips `true` ONLY on a
 * successful CAS HEAD advance; until then the snapshot is uncommitted and
 * the rescue is meaningful.
 *
 * @internal
 */
export interface CommitRescueState {
  readonly treeSha: string;
  readonly parentSha?: string; // undefined → rootless repository (root commit)
  committed: boolean; // true ONLY after gitUpdateRefCAS succeeds
}

/**
 * Module-scoped rescue state. `smartCommit` is serial in the orchestrator (no
 * concurrency), so a single slot mirrors `temp-prompt-cleanup`'s module-scoped
 * tracking. Set right after S1's treeSha capture; cleared in the `finally` on
 * every path. The phase-scoped signal handlers self-guard on this reference.
 */
let _commitRescue: CommitRescueState | null = null;

/**
 * Format the §5.1 "Generation timeout / SIGINT" rescue recipe.
 *
 * @remarks
 * Distinct from {@link formatCommitRecoveryRecipe} (the CAS-refusal recipe):
 * the interrupt case has NO `newSha` and NO generated message (generation was
 * killed BEFORE `commit-tree` ran). The recipe hands the operator the
 * immutable `TREE_SHA` + the exact manual recovery command so the snapshotted
 * work is recoverable. Rootless repo (`parentSha` undefined) omits `-p`
 * (root commit). The TREE_SHA is an immutable git object (system_context §5.2)
 * — it survives any crash; this recipe just makes recovery *discoverable*.
 *
 * @internal
 */
export function formatCommitRescueRecipe(args: {
  treeSha: string;
  parentSha?: string;
}): string {
  const parentArg = args.parentSha ? `-p ${args.parentSha} ` : '';
  return [
    'Smart Commit interrupted (SIGINT/timeout/process kill) AFTER write-tree succeeded — ' +
      'the snapshotted work is safe as the immutable tree object below; HEAD/index are unchanged.',
    `  TREE_SHA:    ${args.treeSha}`,
    args.parentSha
      ? `  PARENT_SHA:  ${args.parentSha}`
      : '  PARENT_SHA:  (rootless repository — root commit)',
    '  The commit was NOT created (generation was killed). Recover manually (supply your own message):',
    `    git commit-tree ${parentArg}-m "<your message>" ${args.treeSha} | xargs git update-ref HEAD`,
    `  (Inspect the tree first if unsure: git ls-tree ${args.treeSha}.)`,
  ].join('\n');
}

/**
 * Emit the §5.1 "Generation timeout / SIGINT" rescue recipe.
 *
 * @remarks
 * PRD §5.1 edge case — verbatim: "Generation timeout / SIGINT: the in-flight
 * generation is killed; the subsystem enters a rescue path that prints
 * TREE_SHA + the manual recovery command so the snapshotted work is never
 * lost." Writes to BOTH `process.stderr.write` (synchronous — survives an
 * imminent `process.exit(130/143)` even if buffered logs do not flush, per
 * §9.6) AND `logger().error`. No-op when there is no held snapshot or the
 * snapshot was already committed (the happy/fallback paths). Best-effort for
 * SIGKILL/OOM/segfault where NO handler/finally can run — there the immutable
 * TREE_SHA is still recoverable via `git fsck --lost-found`; this rescue
 * covers everything that *can* run (SIGINT/SIGTERM/thrown-escape). The
 * CAS-refusal path is EXCLUDED (S2's `formatCommitRecoveryRecipe` already
 * logged its own recipe carrying `newSha` + the message before throwing — no
 * double-emit).
 *
 * @internal
 */
export function emitCommitRescue(rescue: CommitRescueState | null): void {
  if (!rescue || rescue.committed) return; // no snapshot held, or already committed → no-op
  const recipe = formatCommitRescueRecipe({
    treeSha: rescue.treeSha,
    parentSha: rescue.parentSha,
  });
  process.stderr.write(`\n${recipe}\n`); // synchronous; survives a fast exit
  logger().error(recipe);
}

/**
 * Signal/exit handler: emit the rescue recipe (if an uncommitted snapshot is
 * held), then exit with the given code. Mirrors `file-lock.ts`
 * {@link onLockCleanupSignal | onLockCleanupSignal} EXACTLY.
 *
 * @remarks
 * Exported for direct unit testing of both the SIGINT (130) and SIGTERM (143)
 * code paths without terminating the test process. The default `mockExit` is
 * the function EXPRESSION `c => process.exit(c)` (re-resolves `process.exit`
 * at call time) so a `vi.spyOn(process, 'exit')` test is hit — NEVER
 * `mockExit = process.exit` (a bound reference would defeat the spy). The
 * handler does NOT suppress the signal: it prints the recipe THEN exits.
 *
 * @param code - Process exit code to pass through (130 = SIGINT, 143 = SIGTERM).
 * @param mockExit - Injectable exit hook so the handler can be exercised
 *                   without terminating the process.
 * @internal
 */
export function onCommitRescueSignal(
  code: number,
  mockExit: (code: number) => void = c => process.exit(c)
): void {
  emitCommitRescue(_commitRescue);
  mockExit(code);
}

/**
 * Registered SIGINT handler (exported so the registration site has no
 * anonymous arrow body that would otherwise be uncoverable). @internal
 */
export function onCommitRescueSIGINT(): void {
  onCommitRescueSignal(130);
}

/**
 * Registered SIGTERM handler (exported so the registration site has no
 * anonymous arrow body that would otherwise be uncoverable). @internal
 */
export function onCommitRescueSIGTERM(): void {
  onCommitRescueSignal(143);
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

/**
 * Render the §5.1 "HEAD moved during generation" manual recovery recipe.
 *
 * @remarks
 * Pure string renderer used by {@link smartCommit} when the post-generation
 * `gitUpdateRefCAS` refuses the atomic HEAD advance (`casFailure:true` — a
 * concurrent commit moved HEAD during message generation). Per PRD §5.1 the
 * caller MUST NOT force the advance; instead it surfaces the generated
 * message plus this recipe and exits non-zero. The snapshotted work is safe
 * as a dangling commit (`newSha`) and HEAD is byte-for-byte unchanged, so a
 * human can recover by reviewing the message and running the copy-paste
 * `git commit-tree … | xargs git update-ref HEAD` command below.
 *
 * `parentSha` omitted → the recipe notes the rootless-repository case and the
 * command drops `-p` (root commit). Exported so P1.M1.T3.S3 (SIGINT/timeout
 * rescue) and tests can reuse the exact text.
 *
 * @param args - `{ message, treeSha, parentSha?, newSha, error? }`.
 * @returns The multi-line recovery recipe string (header + snapshot SHAs +
 *          message + the manual `git commit-tree … | xargs git update-ref HEAD`
 *          command).
 */
export function formatCommitRecoveryRecipe(args: {
  message: string;
  treeSha: string;
  parentSha?: string;
  newSha: string;
  error?: string;
}): string {
  const parentArg = args.parentSha ? `-p ${args.parentSha} ` : '';
  return [
    'Smart Commit CAS refused (HEAD moved during message generation) — MUST NOT force.',
    '  The snapshotted work is safe as a dangling commit; HEAD is byte-for-byte unchanged.',
    `  treeSha:    ${args.treeSha}`,
    args.parentSha
      ? `  parentSha:  ${args.parentSha}`
      : '  parentSha:  (rootless repository — root commit)',
    `  newSha:     ${args.newSha}`,
    `  message:    ${JSON.stringify(args.message)}`,
    args.error ? `  git error:  ${args.error}` : null,
    '  Manual recovery (review the message above, then run):',
    `    git commit-tree ${parentArg}-m "<msg>" ${args.treeSha} | xargs git update-ref HEAD`,
  ]
    .filter(Boolean)
    .join('\n');
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
 *   **Throws** {@link CommitCasRefusedError} when the post-generation atomic
 *   HEAD advance refuses (HEAD moved during message generation) — a narrow,
 *   safety-critical exception to the never-fail-on-commit contract (see
 *   remarks).
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
 * 6. Return commit hash for observability
 *
 * **Snapshot-Based Atomic Single-Commit** (PRD §5.1 "Commit Workflow Mechanics"):
 * After staging + `restore_critical_files` and BEFORE the (slow) message-generation step, this
 * function captures the pre-generation snapshot: `PARENT_SHA` (current HEAD via `gitRevParseHead`;
 * `undefined` for a rootless repo) and `TREE_SHA` (the staged index frozen into an immutable tree
 * via `gitWriteTree`). The full atomic sequence is `write-tree` → (message gen) → `commit-tree` →
 * CAS `update-ref`: PARENT_SHA + TREE_SHA are captured pre-generation (P1.M1.T3.S1); the dangling
 * commit is composed via `gitCommitTree` + HEAD advanced atomically via `gitUpdateRefCAS`
 * post-generation (P1.M1.T3.S2). Only the CAS `update-ref` moves HEAD — every code path that does
 * not reach a successful `update-ref` leaves HEAD + the index byte-for-byte unchanged. Capturing
 * the snapshot BEFORE generation ALSO fail-fast aborts on an unresolved-merge-conflict index
 * (`gitWriteTree` returns `{success:false}`) → log + `return null`, never spending an LLM call on
 * an uncommittable index (PRD §5.1 "Unresolved merge conflicts in the index" edge case).
 *
 * **HEAD moved during generation** (PRD §5.1 "Edge cases"): if a concurrent commit advanced HEAD
 * in the message-generation window, `gitUpdateRefCAS` reports `{success:false, casFailure:true}`.
 * This function **MUST NOT force** the advance (forcing would silently clobber the concurrent
 * commit). Instead it surfaces the generated message plus a manual recovery recipe
 * ({@link formatCommitRecoveryRecipe}) and **throws {@link CommitCasRefusedError}** — a narrow,
 * safety-critical exception to the never-fail-on-commit contract. The outer catch RE-THROWS it
 * (it is NOT swallowed to `null`) so the orchestrator exits non-zero. The snapshotted work is
 * safe as a dangling commit (`newSha`) and HEAD is byte-for-byte unchanged; a human recovers via
 * the recipe.
 *
 * **Commit-identity transparency** (PRD §5.1 / §9.10.1): this subsystem MUST NOT set, override, or
 * inject any git author/committer identity — no `user.name`/`user.email` config write and no
 * `GIT_AUTHOR_*`/`GIT_COMMITTER_*` env on any git subprocess. The plumbing wrappers
 * (`gitRevParseHead`, `gitWriteTree`, and S2's `gitCommitTree`/`gitUpdateRefCAS`) use
 * `simpleGit.raw([...])` (argv vector, no shell) and inherit the repo's existing git config +
 * `process.env` only, so every commit is authored as whoever git resolves from the user's own
 * config — a pipeline commit is indistinguishable in metadata from a hand-authored one. (The
 * structural self-source-scan guard for this invariant is P1.M3.T1.)
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
 *   **last-resort fallback placeholder commit** via {@link buildFallbackCommitMessage} — the placeholder flows through the SAME `gitCommitTree` + `gitUpdateRefCAS` plumbing (the staged substance is NEVER stranded). The outer `try/catch` returns `null` for all other failures EXCEPT the safety-critical {@link CommitCasRefusedError}, which it RE-THROWS (→ non-zero exit).
 * - Returns `null` on any non-CAS failure to allow the pipeline to continue.
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

    // Skip commit if no files to stage after filtering protected files.
    if (filteredFiles.length === 0) {
      logger().info('No files to commit after filtering protected files');
      return null;
    }

    // PRD §5.1: ARG_MAX-safe staging (no argument-vector overflow) — stage by pathspec
    // (git add -A / git add .), NOT an explicit file list. A repo with an unignored node_modules/
    // (tens of thousands of files) makes git.add(['--', ...everyFile]) overflow ARG_MAX → spawn E2BIG
    // → silently strands task status. Pathspec staging respects .gitignore and never overflows. Where
    // an explicit filtered set is needed, chunk the path list into batches under an ARG_MAX byte budget.
    const addResult = await gitAdd({ path: repoRoot }); // no `files` key → pathspec git.add('.')

    if (!addResult.success) {
      logger().error(`Git add failed: ${addResult.error}`);
      return null;
    }

    // Unstage protected files that were in the status but filtered out (§5.1 protected-files).
    // A handful of basenames — no ARG_MAX risk. Non-fatal: if unstage fails, the file stays staged
    // (restore_critical_files may catch PRD.md deletions; the commit proceeds — substance is never stranded).
    const excludedFiles = filesToStage.filter(f => !filteredFiles.includes(f));
    for (const excluded of excludedFiles) {
      const unstageResult = await gitUnstagePath(excluded, repoRoot);
      if (!unstageResult.success) {
        logger().warn(
          `Failed to unstage protected file ${excluded}: ${unstageResult.error}`
        );
      }
    }

    // ── Critical-File Deletion Protection (PRD §5.1, mechanical layer) ──
    // Detect staged deletions of PRD.md / nested PRP.md and undo them, so the
    // stagecoach gitDiff({staged:true}) + the plumbing commit below see a deletion-free
    // staged set. Must run AFTER gitAdd and BEFORE commit-message resolution.
    // Best-effort/non-fatal: restore_critical_files swallows its own errors.
    await restore_critical_files(repoRoot);

    // ── Snapshot-Based Atomic Commit — PRE-GENERATION capture (PRD §5.1, P1.M1.T3.S1) ──
    // Capture PARENT_SHA (current HEAD) BEFORE the (slow) message-generation step, then freeze the
    // staged index into an immutable tree object (TREE_SHA). Both flow to the post-generation
    // commit-tree + CAS update-ref (P1.M1.T3.S2). Capturing BEFORE generation ALSO fail-fast aborts
    // on unresolved merge conflicts (write-tree fails) — never spending an LLM call on an
    // uncommittable index (PRD §5.1 "Unresolved merge conflicts in the index" edge case).
    //
    // Commit-identity transparency (PRD §5.1 / §9.10.1): this path MUST NOT set user.name/user.email
    // or pass GIT_AUTHOR_*/GIT_COMMITTER_* env on any git subprocess — the plumbing wrappers inherit
    // the repo's existing git config only. Every commit is authored as whoever git resolves from the
    // user's own config; a pipeline commit is indistinguishable in metadata from a hand-authored one.
    const headResult = await gitRevParseHead(repoRoot);
    const parentSha = headResult.success ? headResult.sha : undefined; // undefined → root commit (rootless)

    const treeResult = await gitWriteTree(repoRoot);
    if (!treeResult.success) {
      // Unresolved merge conflicts in the index → abort BEFORE message generation (never-fail-on-commit
      // contract: log + return null; do NOT throw — the index/HEAD are byte-for-byte unchanged).
      logger().error(
        `Smart Commit aborted (unresolved merge conflicts): ${treeResult.error}`
      );
      return null;
    }
    const treeSha = treeResult.treeSha;
    logger().debug(
      { parentSha: parentSha ?? null, treeSha },
      'Captured pre-generation snapshot (PARENT_SHA + TREE_SHA)'
    );

    // ── Generation-timeout / SIGINT rescue (PRD §5.1 "Generation timeout / SIGINT", P1.M1.T3.S3) ──
    // treeSha (S1's write-tree) is an IMMUTABLE git object — it survives any crash (system_context §5.2).
    // If the process is interrupted AFTER this point but BEFORE the CAS advances HEAD, emit treeSha +
    // the manual recovery command so the snapshotted work is recoverable. Phase-scoped SIGINT/SIGTERM
    // handlers (mirroring file-lock.ts/temp-prompt-cleanup.ts) + a try/finally complement for thrown
    // escapes. The handlers self-guard on _commitRescue; process.off in the finally prevents a leak.
    _commitRescue = { treeSha, parentSha, committed: false };
    const rescueHandlers: Array<[NodeJS.Signals, () => void]> = [
      ['SIGINT', onCommitRescueSIGINT],
      ['SIGTERM', onCommitRescueSIGTERM],
    ];
    for (const [sig, fn] of rescueHandlers) process.on(sig, fn);
    let rescueEscape: unknown; // captures a thrown escape so the finally can distinguish it from a normal return
    try {
      // PARENT_SHA + TREE_SHA are consumed by the post-generation commit-tree + CAS update-ref
      // (P1.M1.T3.S2). The existing message-generation path above is UNCHANGED for S1; S2 replaced the trailing gitCommit with commit-tree → CAS update-ref.

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
            () => generateCommitMessage(repoRoot, diffResult.diff ?? ''),
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
          formattedMessage = formatCommitMessage(generated, options.position);
        } catch (genError) {
          // PRD §5.1 last-resort fallback: generation failed after all retries.
          // The index is still staged (gitAdd ran before generation), so commit
          // the substance with a labeled placeholder so it's never stranded.
          // LLM-API failures have no subprocess exit code → sentinel 0 (see
          // buildFallbackCommitMessage). Flow CONTINUES (no rethrow) to the
          // shared plumbing commit below (gitCommitTree + gitUpdateRefCAS),
          // which handles both the happy path and this fallback path.
          logger().warn(
            `Commit-message generation failed after retries; falling back to placeholder commit: ${toErrorMessage(genError)}`
          );
          formattedMessage = formatCommitMessage(
            buildFallbackCommitMessage(genError),
            options.position
          );
        }
      } else {
        formattedMessage = formatCommitMessage(message, options?.position);
      }

      // Create commit — §5.1 snapshot-based atomic single-commit: commit-tree
      // (dangling commit from S1's TREE_SHA + PARENT_SHA) → CAS update-ref
      // (atomic HEAD advance). parentSha undefined → root commit (no -p) /
      // unconditional advance (rootless repo). The message (generated OR
      // fallback placeholder) converges on formattedMessage, so BOTH paths flow
      // through this single plumbing commit.
      const commitTreeResult = await gitCommitTree({
        repoPath: repoRoot,
        treeSha,
        message: formattedMessage,
        parentSha, // undefined → root commit (rootless repo, no -p)
      });
      if (!commitTreeResult.success) {
        // never-fail-on-commit: log + return null; HEAD + index unchanged.
        logger().error(
          `Smart Commit aborted (commit-tree failed): ${commitTreeResult.error}`
        );
        return null;
      }
      const newSha = commitTreeResult.commitSha;

      const casResult = await gitUpdateRefCAS({
        repoPath: repoRoot,
        newSha,
        expectedOldSha: parentSha, // undefined → unconditional advance (rootless repo)
      });
      if (!casResult.success) {
        // §5.1 "HEAD moved during generation": a concurrent commit advanced HEAD
        // during message generation. MUST NOT force (would clobber it). Surface a
        // manual recovery recipe + throw (narrow never-fail exception → non-zero
        // exit). The snapshotted work is safe as a dangling commit.
        const recipe = formatCommitRecoveryRecipe({
          message: formattedMessage,
          treeSha,
          parentSha,
          newSha,
          error: casResult.error,
        });
        logger().error(recipe);
        throw new CommitCasRefusedError(recipe, { treeSha, parentSha, newSha });
      }

      // Return commit hash (the dangling commit's SHA, now HEAD).
      if (_commitRescue) _commitRescue.committed = true; // window CLOSED only on CAS success
      logger().info(`Commit created: ${newSha}`);
      return newSha;
    } catch (e) {
      rescueEscape = e;
      throw e; // re-throw: let the outer catch decide (S2 re-throws CommitCasRefusedError; others → null)
    } finally {
      for (const [sig, fn] of rescueHandlers) process.off(sig, fn); // ALWAYS unregister (phase-scoped)
      // try/finally rescue: a genuine THROWN escape (timeout/unexpected error) with an uncommitted
      // snapshot → emit rescue. Normal `return null` paths inside the window (gitDiff/commit-tree
      // never-fail) reach the finally WITHOUT throwing (rescueEscape === undefined) → no rescue.
      // CAS refusal already logged S2's recipe + carries newSha — do NOT double-emit.
      if (
        _commitRescue &&
        !_commitRescue.committed &&
        rescueEscape !== undefined &&
        !(rescueEscape instanceof CommitCasRefusedError)
      ) {
        emitCommitRescue(_commitRescue);
      }
      _commitRescue = null; // ALWAYS clear
    }
  } catch (error) {
    // Safety-critical: the CAS refusal MUST propagate → non-zero exit (PRD
    // §5.1). It is NOT swallowed to null.
    if (error instanceof CommitCasRefusedError) throw error;
    // Catch any unexpected errors
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger().error(`Unexpected error: ${errorMessage}`);
    return null;
  }
}
