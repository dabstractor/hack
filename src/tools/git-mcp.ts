/**
 * Git MCP Tool Module
 *
 * @module tools/git-mcp
 *
 * @remarks
 * Provides MCP tools for Git version control operations.
 * Implements status, diff, add, and commit operations with security constraints.
 *
 * @example
 * ```ts
 * import { GitMCP } from './tools/git-mcp.js';
 *
 * const gitMCP = new GitMCP();
 * const result = await gitMCP.executeTool('git__git_status', {
 *   path: './my-project'
 * });
 * ```
 */

import { existsSync, realpathSync } from 'node:fs';
import { resolve, join } from 'node:path';
import {
  simpleGit,
  type StatusResult,
  type CommitResult,
  type Options,
} from 'simple-git';
import { GitError } from 'simple-git';
import { MCPHandler, type Tool } from 'groundswell';
import { atomicWrite } from '../core/session-utils.js';

// ===== INPUT INTERFACES =====

/**
 * Input schema for git_status tool
 *
 * @remarks
 * Path is optional - defaults to current working directory
 */
interface GitStatusInput {
  /** Path to git repository (optional, defaults to process.cwd()) */
  path?: string;
}

/**
 * Input schema for git_diff tool
 *
 * @remarks
 * Controls whether to show staged or unstaged changes
 */
interface GitDiffInput {
  /** Path to git repository (optional, defaults to process.cwd()) */
  path?: string;
  /** Show staged changes instead of unstaged (default: false) */
  staged?: boolean;
}

/**
 * Input schema for git_add tool
 *
 * @remarks
 * Files parameter is optional - defaults to '.'
 */
interface GitAddInput {
  /** Path to git repository (optional, defaults to process.cwd()) */
  path?: string;
  /** Files to stage (optional, defaults to '.') */
  files?: string[];
}

/**
 * Input schema for git_commit tool
 *
 * @remarks
 * Message is required - empty messages rejected
 */
interface GitCommitInput {
  /** Path to git repository (optional, defaults to process.cwd()) */
  path?: string;
  /** Commit message (required) */
  message: string;
  /** Allow empty commit (default: false) */
  allowEmpty?: boolean;
}

// ===== RESULT INTERFACES =====

/**
 * Result from git_status operation
 */
interface GitStatusResult {
  /** True if operation succeeded */
  success: boolean;
  /** Current branch name */
  branch?: string;
  /** Staged files */
  staged?: string[];
  /** Modified (unstaged) files */
  modified?: string[];
  /** Untracked files */
  untracked?: string[];
  /** Error message if failed */
  error?: string;
}

/**
 * Result from git_diff operation
 */
interface GitDiffResult {
  /** True if operation succeeded */
  success: boolean;
  /** Diff output */
  diff?: string;
  /** Error message if failed */
  error?: string;
}

/**
 * Result from git_add operation
 */
interface GitAddResult {
  /** True if files were staged */
  success: boolean;
  /** Number of files staged */
  stagedCount?: number;
  /** Error message if failed */
  error?: string;
}

/**
 * A single file-history entry: a commit that touched a given file path.
 *
 * @remarks
 * Returned by {@link gitFileHistory}. Entries are NEWEST-FIRST (matching
 * `git log` default ordering). `commit` is the full commit hash; `date` is the
 * ISO-ish date string reported by git for the commit.
 */
interface GitFileHistoryEntry {
  /** Full commit SHA that touched the file */
  commit: string;
  /** Commit date as reported by git (author date, ISO-ish) */
  date: string;
}

/**
 * Result from git_commit operation
 */
interface GitCommitResult {
  /** True if commit was created */
  success: boolean;
  /** Commit hash (SHA) */
  commitHash?: string;
  /** Error message if failed */
  error?: string;
}

/**
 * Result from {@link gitListStagedDeletions}.
 *
 * @remarks
 * Lists paths currently staged as DELETIONS in the index (the `D` status
 * code) via `git diff --cached --diff-filter=D --name-only`. Used by the
 * mechanical critical-file deletion protection in smartCommit (PRD §5.1).
 */
interface GitListDeletionsResult {
  /** True if the diff succeeded. */
  success: boolean;
  /** Repo-relative paths staged as deletions (index `D`). */
  files?: string[];
  /** Error message if the diff failed. */
  error?: string;
}

/**
 * Result from {@link gitRestoreFileFromHead} and {@link gitUnstagePath}.
 *
 * @remarks
 * Shared result shape for the two staged-deletion-undo helpers used by the
 * mechanical critical-file deletion protection (PRD §5.1).
 */
interface GitRestoreFromHeadResult {
  /** True if the operation succeeded. */
  success: boolean;
  /** Error message if the operation failed. */
  error?: string;
}

// ===== HELPER FUNCTIONS =====

/**
 * Validate repository path exists and is a git repository
 *
 * @remarks
 * Checks that the path exists and contains a .git directory.
 * Resolves symlinks and returns the real path.
 *
 * @param path - Optional path to validate (defaults to process.cwd())
 * @returns Resolved real path to repository
 * @throws Error if path doesn't exist or is not a git repository
 */
async function validateRepositoryPath(path?: string): Promise<string> {
  const repoPath = resolve(path ?? process.cwd());

  // Check path exists
  if (!existsSync(repoPath)) {
    throw new Error(`Repository path not found: ${repoPath}`);
  }

  // Check it's a git repository
  const gitDir = join(repoPath, '.git');
  if (!existsSync(gitDir)) {
    throw new Error(`Not a git repository: ${repoPath}`);
  }

  return realpathSync(repoPath);
}

// ===== TOOL SCHEMAS =====

/**
 * Tool schema definition for git_status
 */
const gitStatusTool: Tool = {
  name: 'git_status',
  description:
    'Get git repository status including branch name, staged files, modified files, and untracked files. ' +
    'Returns structured status information for understanding repository state.',
  input_schema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description:
          'Path to git repository (optional, defaults to current directory)',
      },
    },
  },
};

/**
 * Tool schema definition for git_diff
 */
const gitDiffTool: Tool = {
  name: 'git_diff',
  description:
    'Show git diff output for changes. ' +
    'Returns diff output as string for unstaged changes by default, or staged changes when staged=true.',
  input_schema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description:
          'Path to git repository (optional, defaults to current directory)',
      },
      staged: {
        type: 'boolean',
        description: 'Show staged changes instead of unstaged (default: false)',
      },
    },
  },
};

/**
 * Tool schema definition for git_add
 */
const gitAddTool: Tool = {
  name: 'git_add',
  description:
    'Stage files for commit. ' +
    'Stages specified files or all changes (default: ".") for the next commit. ' +
    'Uses -- separator to prevent flag injection.',
  input_schema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description:
          'Path to git repository (optional, defaults to current directory)',
      },
      files: {
        type: 'array',
        items: {
          type: 'string',
        },
        description:
          'Files to stage (optional, defaults to staging all changes)',
      },
    },
  },
};

/**
 * Tool schema definition for git_commit
 */
const gitCommitTool: Tool = {
  name: 'git_commit',
  description:
    'Create a git commit with staged changes. ' +
    'Requires a commit message and returns the commit hash on success. ' +
    'Supports --allow-empty for creating commits without changes.',
  input_schema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description:
          'Path to git repository (optional, defaults to current directory)',
      },
      message: {
        type: 'string',
        description: 'Commit message (required)',
      },
      allowEmpty: {
        type: 'boolean',
        description: 'Allow empty commit (default: false)',
      },
    },
    required: ['message'],
  },
};

// ===== TOOL EXECUTORS =====

/**
 * Execute git_status tool
 *
 * @remarks
 * Uses simple-git git.status() and parses StatusResult.
 * Returns structured status with branch, staged, modified, and untracked files.
 *
 * @param input - Tool input with optional path
 * @returns Promise resolving to status result
 */
async function gitStatus(input: GitStatusInput): Promise<GitStatusResult> {
  try {
    const safePath = await validateRepositoryPath(input.path);
    const git = simpleGit(safePath);

    // CRITICAL: StatusResult structure from simple-git
    const status: StatusResult = await git.status();

    // Parse files by status
    const staged: string[] = [];
    const modified: string[] = [];
    const untracked: string[] = [];

    for (const file of status.files) {
      // Untracked files (both columns are '?')
      if (file.index === '?' && file.working_dir === '?') {
        untracked.push(file.path);
        continue;
      }
      // Staged files (index has changes)
      if (file.index !== ' ') {
        staged.push(file.path);
      }
      // Modified files (working dir has changes)
      // Note: Files can be in both staged and modified if changed in both locations
      if (file.working_dir !== ' ') {
        modified.push(file.path);
      }
    }

    return {
      success: true,
      branch: status.current ?? undefined,
      staged: staged.length > 0 ? staged : undefined,
      modified: modified.length > 0 ? modified : undefined,
      untracked: untracked.length > 0 ? untracked : undefined,
    };
  } catch (error) {
    // PATTERN: Error handling from FilesystemMCP
    if (error instanceof GitError) {
      return {
        success: false,
        error: error.message,
      };
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Execute git_diff tool
 *
 * @remarks
 * Uses git.diff() for unstaged changes, or git.diff(['--cached']) for staged changes.
 * Returns raw diff output as string.
 *
 * @param input - Tool input with optional path and staged flag
 * @returns Promise resolving to diff result
 */
async function gitDiff(input: GitDiffInput): Promise<GitDiffResult> {
  try {
    const safePath = await validateRepositoryPath(input.path);
    const git = simpleGit(safePath);

    let diff: string;

    if (input.staged ?? false) {
      // Get staged changes
      diff = await git.diff(['--cached']);
    } else {
      // Get unstaged changes
      diff = await git.diff();
    }

    return { success: true, diff };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Execute git_add tool
 *
 * @remarks
 * Uses git.add() with argument array.
 * Security: Uses '--' separator to prevent flag injection.
 *
 * @param input - Tool input with optional path and files array
 * @returns Promise resolving to add result
 */
async function gitAdd(input: GitAddInput): Promise<GitAddResult> {
  try {
    const safePath = await validateRepositoryPath(input.path);
    const git = simpleGit(safePath);

    const files = input.files ?? ['.'];

    // CRITICAL: Security pattern from official MCP Git server
    // Use '--' to prevent files starting with '-' from being interpreted as flags
    if (files.length === 1 && files[0] === '.') {
      await git.add('.');
    } else {
      await git.add(['--', ...files]);
    }

    return { success: true, stagedCount: files.length };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Execute git_commit tool
 *
 * @remarks
 * Uses git.commit() with message and options.
 * Validates message is not empty.
 * Handles --allow-empty option.
 *
 * @param input - Tool input with optional path, required message, and optional allowEmpty
 * @returns Promise resolving to commit result
 */
async function gitCommit(input: GitCommitInput): Promise<GitCommitResult> {
  try {
    // Validate message is not empty (before path validation for better UX)
    if (!input.message || input.message.trim() === '') {
      return {
        success: false,
        error: 'Commit message is required and cannot be empty',
      };
    }

    const safePath = await validateRepositoryPath(input.path);
    const git = simpleGit(safePath);

    // Build options
    const options: Options & { '--allow-empty'?: boolean } = {};
    if (input.allowEmpty ?? false) {
      options['--allow-empty'] = true;
    }

    // CRITICAL: CommitResult structure from simple-git
    const result: CommitResult = await git.commit(input.message, [], options);

    return {
      success: true,
      commitHash: result.commit ?? undefined,
    };
  } catch (error) {
    // PATTERN: Handle specific git errors
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('nothing to commit')) {
      return {
        success: false,
        error:
          'No changes staged for commit. Use git_add to stage files first.',
      };
    }
    if (msg.includes('merge conflict')) {
      return {
        success: false,
        error: 'Cannot commit with unresolved merge conflicts',
      };
    }
    return {
      success: false,
      error: msg,
    };
  }
}

/**
 * List the commit history of a single file path (newest-first).
 *
 * @remarks
 * Wraps simple-git's `git.log({ file })`. Returns one entry per commit that touched
 * `filePath`, newest commit first. A file with no commit history returns an empty
 * array (NOT an error) — git itself returns no rows for such a path.
 *
 * Generic over any file path — not `tasks.json`-specific. Used by the smart-recovery
 * routine (P5.M2.T1.S2) to locate the last valid committed version of `tasks.json`
 * after an agent corrupts it (PRD §5.1).
 *
 * @param filePath - Repository-relative path of the file to inspect.
 * @param repoPath - Path to the git repository (optional, defaults to cwd).
 * @returns Array of `{ commit, date }` entries, newest-first. Empty if the file has no history.
 * @throws {Error} If `repoPath` is not a git repository, or if `git log` fails.
 *
 * @example
 * ```ts
 * const history = await gitFileHistory('tasks.json', '/path/to/repo');
 * // [{ commit: 'abc123…', date: '2024-06-21…' }, { commit: 'def456…', date: '2024-06-20…' }]
 * ```
 */
async function gitFileHistory(
  filePath: string,
  repoPath?: string
): Promise<GitFileHistoryEntry[]> {
  const safePath = await validateRepositoryPath(repoPath);
  const git = simpleGit(safePath);

  const logResult = await git.log({ file: filePath });

  return logResult.all.map(entry => ({
    commit: entry.hash,
    date: entry.date,
  }));
}

/**
 * Fetch the most recent commit messages from a repository (PRD §5.1 commit-style layer).
 *
 * @remarks
 * Returns the FULL commit message (subject + body) of each of the last `count` commits, newest-first
 * (matching `git log` default ordering). Used by the commit-message style layer to inject recent
 * history as style examples when `PRP_COMMIT_STYLE=auto` (§5.1): the caller passes the resolved
 * `PRP_COMMIT_STYLE_EXAMPLES` count.
 *
 * - `count === 0` short-circuits to `[]` BEFORE any filesystem/git access — so a `0` count (which
 *   disables style learning per §5.1) is a pure no-op, even outside a repository.
 * - A repository with fewer than `count` commits returns all available entries (no error — `git.log`
 *   simply returns fewer).
 *
 * Mirrors {@link gitFileHistory}'s `validateRepositoryPath` → `simpleGit` → `git.log` pattern.
 *
 * @param count - How many recent commit messages to fetch. `0` → `[]` (no git call).
 * @param repoPath - Path to the git repository (optional, defaults to cwd).
 * @returns Array of full commit-message strings (subject + body), newest-first. Empty if `count === 0`
 *          or the repository has no commits.
 * @throws {Error} If `repoPath` is not a git repository (via {@link validateRepositoryPath}), or if
 *         `git.log` fails.
 *
 * @example
 * ```ts
 * const msgs = await getRecentCommitMessages(5, '/path/to/repo');
 * // ['feat: add thing\n\nbody', 'fix: other', …]  (newest-first)
 * ```
 */
async function getRecentCommitMessages(
  count: number,
  repoPath?: string
): Promise<string[]> {
  if (count === 0) return []; // short-circuit BEFORE validate (no git call) — PRP_COMMIT_STYLE_EXAMPLES=0
  const safePath = await validateRepositoryPath(repoPath);
  const git = simpleGit(safePath);
  const logResult = await git.log({ maxCount: count });
  return logResult.all.map(entry => entry.message); // newest-first; full message (subject + body)
}

/**
 * Result of {@link gitWriteTree}: either a successful tree SHA or a structured error.
 *
 * @remarks
 * `success: false` is returned when the index has unresolved merge conflicts (the only failure
 * mode of `git write-tree`). The `error` string is actionable per PRD §5.1.
 */
type GitWriteTreeResult =
  | { success: true; treeSha: string }
  | { success: false; error: string };

/**
 * `git write-tree` — freeze the current index into an immutable tree object (PRD §5.1 "Commit
 * Workflow Mechanics" step 1: snapshot-based atomic single-commit).
 *
 * @remarks
 * Records exactly what was staged at time T by writing the current index to a new immutable tree
 * object and returning its 40-char SHA. **Pure with respect to refs and the index**: it creates a
 * tree object but modifies neither HEAD nor the staging area — so a failed or slow generation step
 * after it cannot corrupt history or lose staged work. This is the snapshot step of the
 * `write-tree → commit-tree → CAS update-ref` atomic workflow.
 *
 * Uses `simpleGit.raw(['write-tree'])` — an argv VECTOR (not a shell-interpolated string), so it
 * runs via `execFile` internally and satisfies §5.1's no-shell rule. `write-tree` prints the tree
 * SHA + a trailing newline; the output is `.trim()`-ed.
 *
 * The only failure mode is an index with unresolved merge conflicts (`git write-tree` exits
 * non-zero); this is surfaced as `{ success: false, error }` with an actionable message — the error
 * is NOT re-thrown.
 *
 * @param repoPath - Optional repository path (defaults to cwd via {@link validateRepositoryPath}).
 * @returns `{ success: true, treeSha }` on success, or `{ success: false, error }` on a conflicted index.
 */
async function gitWriteTree(repoPath?: string): Promise<GitWriteTreeResult> {
  const safePath = await validateRepositoryPath(repoPath);
  const git = simpleGit(safePath);
  try {
    const output = await git.raw(['write-tree']); // stdout = 40-char tree SHA + trailing newline
    const treeSha = output.trim();
    return { success: true, treeSha };
  } catch {
    return {
      success: false,
      error:
        'Cannot write-tree: unresolved merge conflicts in the index — resolve them first',
    };
  }
}

/**
 * Result of {@link gitRevParseHead}: either the current HEAD commit SHA or a structured error.
 *
 * @remarks
 * `success: false` is returned when HEAD is unborn (a rootless repository — no commits yet) or
 * the ref is otherwise unresolvable. This is the PRD §5.1 "Rootless repo" edge case: PARENT_SHA is
 * empty, so {@link gitCommitTree} is called without `-p` (a root commit) and {@link gitUpdateRefCAS}
 * without an `expected-old` — NOT an error condition.
 */
type GitRevParseHeadResult =
  | { success: true; sha: string }
  | { success: false; error: string };

/**
 * `git rev-parse HEAD` — read the current HEAD commit SHA (PRD §5.1 "Commit Workflow Mechanics":
 * PARENT_SHA capture for the snapshot-based atomic single-commit).
 *
 * @remarks
 * Mirrors {@link gitWriteTree}: `validateRepositoryPath` → `simpleGit` → `git.raw(['rev-parse',
 * 'HEAD'])` → `.trim()` → `{ success: true, sha }`. On throw (HEAD unborn / rootless repository, or a
 * missing ref) it returns `{ success: false, error }` — the error is NOT re-thrown.
 *
 * Captured pre-message-generation by {@link smartCommit} (P1.M1.T3.S1) as PARENT_SHA, alongside the
 * {@link gitWriteTree} TREE_SHA, so the post-generation `commit-tree` + CAS `update-ref` (P1.M1.T3.S2)
 * can advance HEAD atomically.
 *
 * Uses `simpleGit.raw(['rev-parse', 'HEAD'])` — an argv VECTOR (not a shell-interpolated string), so it
 * runs via `execFile` internally and satisfies §5.1's no-shell rule.
 *
 * **Commit-identity transparency** (PRD §5.1 / §9.10.1): `rev-parse` is a pure read that inherits the
 * repo's git config + `process.env` only — it sets no `user.name`/`user.email` and passes no
 * `GIT_AUTHOR_*`/`GIT_COMMITTER_*` env.
 *
 * @param repoPath - Optional repository path (defaults to cwd via {@link validateRepositoryPath}).
 * @returns `{ success: true, sha }` on success, or `{ success: false, error }` when HEAD is unborn.
 */
async function gitRevParseHead(
  repoPath?: string
): Promise<GitRevParseHeadResult> {
  const safePath = await validateRepositoryPath(repoPath);
  const git = simpleGit(safePath);
  try {
    const sha = (await git.raw(['rev-parse', 'HEAD'])).trim();
    return { success: true, sha };
  } catch {
    return {
      success: false,
      error: 'HEAD is unborn (rootless repository — no commits yet)',
    };
  }
}

/**
 * Result of {@link gitCommitTree}: either a successful commit SHA or a structured error.
 *
 * @remarks
 * `success: false` carries the git error message — `git commit-tree` has several failure modes
 * (bad tree SHA, bad parent SHA, git internal), so the message is extracted (not a fixed string)
 * for an actionable signal per PRD §5.1.
 */
type GitCommitTreeResult =
  | { success: true; commitSha: string }
  | { success: false; error: string };

/**
 * `git commit-tree` — create a DANGLING commit object from a tree + optional parent + message
 * (PRD §5.1 "Commit Workflow Mechanics" step 2: snapshot-based atomic single-commit).
 *
 * @remarks
 * Creates a commit object from `treeSha` (the frozen tree from {@link gitWriteTree}), an optional
 * `parentSha`, and `message`. This touches NO ref — the commit is DANGLING until step 3
 * ({@linkcode gitUpdateRefCAS}, S3) advances HEAD. This is what makes the §5.1 commit atomic: a
 * failed/slow generation step after `write-tree` cannot corrupt history, and `commit-tree` itself
 * never moves HEAD.
 *
 * Uses `simpleGit.raw([...])` — an argv VECTOR (not a shell-interpolated string), so it runs via
 * `execFile` internally and satisfies §5.1's no-shell rule. The message is the `-m` argv element:
 * `execFile` does NOT interpret embedded newlines, so a multi-line message is preserved verbatim
 * (git `-m` treats them as the commit body). No stdin piping or shell-concatenation is involved.
 *
 * `parentSha` is OPTIONAL: when omitted, no `-p` is passed and git creates a root commit (the
 * rootless-repo / first-commit edge case in PRD §5.1). `commit-tree` prints the 40-char commit
 * SHA + a trailing newline; the output is `.trim()`-ed.
 *
 * Failures (bad tree SHA, bad parent SHA, git internal) are surfaced as `{ success: false, error }`
 * with the extracted git message — the error is NOT re-thrown.
 *
 * @param input - `{ treeSha, message, parentSha?, repoPath? }`.
 * @returns `{ success: true, commitSha }` (trimmed 40-char SHA) on success, or
 *          `{ success: false, error }` with the git error message on failure.
 */
async function gitCommitTree(input: {
  treeSha: string;
  message: string;
  parentSha?: string;
  repoPath?: string;
}): Promise<GitCommitTreeResult> {
  const safePath = await validateRepositoryPath(input.repoPath);
  const git = simpleGit(safePath);
  const args = [
    'commit-tree',
    input.treeSha,
    ...(input.parentSha ? ['-p', input.parentSha] : []), // omitted for root commits (rootless repo)
    '-m',
    input.message, // argv element — execFile preserves newlines
  ];
  try {
    const output = await git.raw(args); // stdout = 40-char commit SHA + trailing newline
    const commitSha = output.trim();
    return { success: true, commitSha };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Result of {@link gitUpdateRefCAS}: either HEAD was atomically advanced, or it refused (HEAD
 * unchanged).
 *
 * @remarks
 * `success: false` ALWAYS carries `casFailure: true` and the git error message. It means "the
 * atomic HEAD advance did NOT happen" — true for the canonical CAS mismatch (HEAD moved during
 * message generation), a bad `newSha`, or any git error. In every case HEAD is byte-for-byte
 * unchanged and the caller MUST NOT force the advance (PRD §5.1). The git message is returned
 * verbatim (NOT parsed — stderr wording is fragile across versions) for an actionable signal.
 */
type GitUpdateRefCASResult =
  | { success: true }
  | { success: false; error: string; casFailure: true };

/**
 * `git update-ref HEAD <new-sha> <expected-old-sha>` — the CAS (compare-and-swap) form atomically
 * advances HEAD only if its current value still equals [expected-old] (PRD §5.1 "Commit Workflow
 * Mechanics" step 3: snapshot-based atomic single-commit).
 *
 * @remarks
 * Step 3 of the `write-tree` (S1) → `commit-tree` (S2) → CAS `update-ref` (S3) atomic workflow.
 * This is the ONLY step that moves HEAD — it does so atomically (CAS) or not at all. The expected-old
 * SHA is captured BEFORE message generation; if a concurrent commit moved HEAD in that window, git
 * refuses (non-zero exit) and S3 reports `{ success: false, casFailure: true }` so the caller
 * (P1.M1.T3.S2) surfaces a manual-recovery recipe instead of clobbering the concurrent commit.
 *
 * **NEVER force.** A `{ success: false, casFailure: true }` is terminal for this attempt — no
 * `--force`, no retry without the expected-old, no fallback `git commit` (PRD §5.1 "MUST NOT force
 * the update"). Forcing would silently overwrite history — the exact failure mode this plumbing
 * commit exists to prevent. On any failure HEAD is byte-for-byte unchanged (the tree object from S1
 * + dangling commit from S2 remain, reaped later by `git gc`).
 *
 * `expectedOldSha` is OPTIONAL: when omitted, no expected-old is passed and git advances HEAD
 * unconditionally — the rootless-repo / first-commit edge case (PRD §5.1: "PARENT_SHA is empty;
 * update-ref HEAD <new> is called without the expected-old argument").
 *
 * Uses `simpleGit.raw([...])` — an argv VECTOR (not a shell-interpolated string), so it runs via
 * `execFile` internally and satisfies §5.1's no-shell rule. The expected-old is a BARE POSITIONAL
 * appended after `newSha` (per `git update-ref <ref> <new> [<old>]` syntax), NOT a `-p`-style flag.
 * `update-ref` is SILENT on success (exit 0, empty stdout) — there is no SHA to trim/return.
 *
 * @param input - `{ newSha, expectedOldSha?, repoPath? }`.
 * @returns `{ success: true }` (no payload) on success, or
 *          `{ success: false, error, casFailure: true }` with the git error message on refusal.
 */
async function gitUpdateRefCAS(input: {
  newSha: string;
  expectedOldSha?: string;
  repoPath?: string;
}): Promise<GitUpdateRefCASResult> {
  const safePath = await validateRepositoryPath(input.repoPath);
  const git = simpleGit(safePath);
  const args = [
    'update-ref',
    'HEAD',
    input.newSha,
    ...(input.expectedOldSha ? [input.expectedOldSha] : []), // BARE POSITIONAL — omitted for rootless repos
  ];
  try {
    await git.raw(args); // SILENT on success (exit 0, empty stdout) — HEAD atomically advanced
    return { success: true };
  } catch (e) {
    // update-ref refused (HEAD moved during generation, bad SHA, git error). HEAD is UNCHANGED.
    // NEVER force — the caller surfaces a manual-recovery recipe (§5.1 "HEAD moved during generation").
    return {
      success: false,
      error: e instanceof Error ? e.message : String(e),
      casFailure: true, // the atomic advance did NOT happen
    };
  }
}

/**
 * Read the content of a file at a specific commit (blob fetch).
 *
 * @remarks
 * Runs `git show <commit>:<filePath>` via simple-git `.show(...)`, returning the
 * blob content as a string. `commit` may be a full hash, short hash, or symbolic
 * ref (`HEAD`, `HEAD~1`, …). Invalid revisions / missing paths cause git to error,
 * which is thrown (do NOT swallow).
 *
 * Generic over any file path. The smart-recovery routine uses this to fetch the
 * last valid blob of `tasks.json` before restoring it (PRD §5.1).
 *
 * @param filePath - Repository-relative path of the file.
 * @param commit - Git revision (hash or symbolic ref like `HEAD`) to read at.
 * @param repoPath - Path to the git repository (optional, defaults to cwd).
 * @returns The file's blob content at `commit`, as a string.
 * @throws {Error} If `repoPath` is not a git repository, the revision/path is invalid, or `git show` fails.
 *
 * @example
 * ```ts
 * const content = await gitReadFileAtCommit('tasks.json', 'abc123', '/path/to/repo');
 * const parsed = JSON.parse(content); // last valid version
 * ```
 */
async function gitReadFileAtCommit(
  filePath: string,
  commit: string,
  repoPath?: string
): Promise<string> {
  const safePath = await validateRepositoryPath(repoPath);
  const git = simpleGit(safePath);

  return git.show(`${commit}:${filePath}`);
}

/**
 * Restore a file to a prior committed version by writing its blob to disk.
 *
 * @remarks
 * Fetches the blob at `commit` (default `HEAD`) via `git show <commit>:<filePath>`,
 * then writes it to `resolve(repoPath, filePath)` using {@link atomicWrite}
 * (temp-file + rename, crash-safe). This restores a prior valid version of the file.
 *
 * Generic over any file path. The smart-recovery routine uses this to restore the
 * last valid `tasks.json` after an agent corrupts it, before re-applying in-flight
 * status changes (PRD §5.1).
 *
 * @param filePath - Repository-relative path of the file to restore.
 * @param commit - Git revision to restore from (optional, defaults to `HEAD`).
 * @param repoPath - Path to the git repository (optional, defaults to cwd).
 * @returns Resolves once the file has been atomically written to disk.
 * @throws {Error} If `repoPath` is not a git repository, the revision/path is invalid, `git show` fails, or the atomic write fails.
 *
 * @example
 * ```ts
 * // Restore the last committed tasks.json after corruption:
 * await gitRestoreFile('tasks.json', 'HEAD', '/path/to/repo');
 * ```
 */
async function gitRestoreFile(
  filePath: string,
  commit: string = 'HEAD',
  repoPath?: string
): Promise<void> {
  const safePath = await validateRepositoryPath(repoPath);
  const git = simpleGit(safePath);

  // 1. fetch the blob at the target commit
  const content = await git.show(`${commit}:${filePath}`);

  // 2. write it to disk atomically (restore the file). resolve() against the repo root so it lands in the repo.
  await atomicWrite(resolve(safePath, filePath), content);
}

/**
 * List the paths currently staged as DELETIONS in the index.
 *
 * @remarks
 * Runs `git diff --cached --diff-filter=D --name-only` via simple-git's
 * `.diff([...])` (ARRAY form — a single STRING throws
 * `TaskConfigurationError`). Output is split on newlines, trimmed, and
 * empty lines filtered. Returns an empty array when nothing is staged-as-
 * deleted.
 *
 * Used by the mechanical critical-file deletion protection
 * (`restore_critical_files` in `utils/git-commit.ts`, PRD §5.1) to find
 * staged deletions of `PRD.md` and any nested `PRP.md` and undo them before commit.
 *
 * @param repoPath - Path to the git repository (optional, defaults to cwd).
 * @returns A {@link GitListDeletionsResult}: `{ success, files }` on success,
 * `{ success: false, error }` on a git failure.
 *
 * @example
 * ```ts
 * const { files } = await gitListStagedDeletions('/repo');
 * // files: ['PRD.md', 'plan/008_x/P3M2T4S2/PRP.md']
 * ```
 */
async function gitListStagedDeletions(
  repoPath?: string
): Promise<GitListDeletionsResult> {
  try {
    const safePath = await validateRepositoryPath(repoPath);
    const git = simpleGit(safePath);
    // CRITICAL: ARRAY form — a single STRING throws TaskConfigurationError.
    const raw = await git.diff(['--cached', '--diff-filter=D', '--name-only']);
    // raw is UNTRIMMED by default → split + trim + filter empties.
    const files = raw
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean);
    return { success: true, files };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Restore a HEAD-tracked deleted file from HEAD (clears the staged deletion
 * in the index AND restores the working tree in ONE call).
 *
 * @remarks
 * Runs `git checkout HEAD -- <path>` via simple-git's `.checkout([...])`
 * (ARRAY form — the varargs form `git.checkout('HEAD','--',path)` is SILENTLY
 * LOSSY: `getTrailingOptions` keeps only the first primitive, dropping
 * `'--'`/`path` and running `git checkout HEAD` instead). Unlike
 * {@link gitRestoreFile} (which is `git.show`+`atomicWrite` and writes the
 * working tree ONLY, leaving the file still staged-as-deleted), this helper
 * clears the index entry AND restores the worktree in a single call — the
 * correct way to undo a staged deletion of a HEAD-tracked file.
 *
 * Used by the mechanical critical-file deletion protection (PRD §5.1) for
 * the "existed in HEAD" branch (a tracked `PRD.md` and any nested `PRP.md` that an
 * agent deleted + staged).
 *
 * @param filePath - Repository-relative path of the file to restore.
 * @param repoPath - Path to the git repository (optional, defaults to cwd).
 * @returns A {@link GitRestoreFromHeadResult}: `{ success: true }` on success,
 * `{ success: false, error }` if the path is absent from HEAD or git fails.
 *
 * @example
 * ```ts
 * const { success } = await gitRestoreFileFromHead('PRD.md', '/repo');
 * ```
 */
async function gitRestoreFileFromHead(
  filePath: string,
  repoPath?: string
): Promise<GitRestoreFromHeadResult> {
  try {
    const safePath = await validateRepositoryPath(repoPath);
    const git = simpleGit(safePath);
    // CRITICAL: ARRAY form. The varargs git.checkout('HEAD','--',path) drops
    // '--'/path and runs `git checkout HEAD` (silently lossy).
    await git.checkout(['HEAD', '--', filePath]);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Unstage a path from the index (`git reset HEAD -- <path>`).
 *
 * @remarks
 * Runs `git reset HEAD -- <path>` via simple-git's `.reset([...])` (ARRAY
 * form — `git.reset([path])` without `'HEAD'`/`'--'` is ambiguous). Git
 * exits 0 with no error even when the path is absent from HEAD, so this is
 * the safe way to undo a staged deletion of a file that was created-and-
 * deleted in the same run (never committed → not in HEAD).
 *
 * Used by the mechanical critical-file deletion protection (PRD §5.1) for
 * the "not in HEAD" branch: when {@link gitRestoreFileFromHead} fails because
 * the path was never committed, this helper unstages the deletion so the
 * commit proceeds without it.
 *
 * @param filePath - Repository-relative path of the file to unstage.
 * @param repoPath - Path to the git repository (optional, defaults to cwd).
 * @returns A {@link GitRestoreFromHeadResult}: `{ success: true }` on success,
 * `{ success: false, error }` on a git failure.
 *
 * @example
 * ```ts
 * const { success } = await gitUnstagePath('plan/x/PRP.md', '/repo');
 * ```
 */
async function gitUnstagePath(
  filePath: string,
  repoPath?: string
): Promise<GitRestoreFromHeadResult> {
  try {
    const safePath = await validateRepositoryPath(repoPath);
    const git = simpleGit(safePath);
    // `git reset HEAD -- <path>`: exit 0, no error even if path absent from HEAD.
    // ARRAY form; do NOT use git.reset([path]) (ambiguous).
    await git.reset(['HEAD', '--', filePath]);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ===== MCP SERVER =====

/**
 * Git MCP Server
 *
 * @remarks
 * Groundswell MCP server that provides Git version control operations.
 * Extends MCPHandler and registers four tools: git_status, git_diff,
 * git_add, and git_commit.
 */
export class GitMCP extends MCPHandler {
  /** Server name for MCPServer interface */
  public readonly name = 'git';

  /** Transport type for MCPServer interface */
  public readonly transport = 'inprocess' as const;

  /** Tools for MCPServer interface */
  public readonly tools = [
    gitStatusTool,
    gitDiffTool,
    gitAddTool,
    gitCommitTool,
  ];

  constructor() {
    super();

    // PATTERN: Register server in constructor
    this.registerServer({
      name: this.name,
      transport: this.transport,
      tools: this.tools,
    });

    // PATTERN: Register tool executors (type-safe adapters match MCPHandler's local ToolExecutor)
    this.registerToolExecutor('git', 'git_status', async (input: unknown) =>
      gitStatus(input as GitStatusInput)
    );
    this.registerToolExecutor('git', 'git_diff', async (input: unknown) =>
      gitDiff(input as GitDiffInput)
    );
    this.registerToolExecutor('git', 'git_add', async (input: unknown) =>
      gitAdd(input as GitAddInput)
    );
    this.registerToolExecutor('git', 'git_commit', async (input: unknown) =>
      gitCommit(input as GitCommitInput)
    );
  }
}

/**
 * Read-only Git MCP Server (PRD §9.10.3 per-persona tool subsets).
 *
 * @remarks
 * A SEPARATE {@link MCPHandler} instance that registers ONLY `git_status` +
 * `git_diff` — the read-only git subset given to non-qa personas
 * (architect/researcher/coder/cleanup). Subsetting works because MCPHandler
 * registration is PER-INSTANCE: this instance never registers `git_add` /
 * `git_commit`, so those tools are simply undiscoverable to agents holding it.
 *
 * The server `name` stays `'git'` (the tool namespace prefix) — no single
 * persona ever holds two `'git'` servers, so there is no collision, and the
 * namespaced tool ids (`git__git_status` / `git__git_diff`) are identical to
 * the full {@link GitMCP}. The full {@link GitMCP} (4 tools) is unchanged and
 * remains the qa set.
 */
export class ReadOnlyGitMCP extends MCPHandler {
  /** Server name for MCPServer interface (same namespace as GitMCP) */
  public readonly name = 'git';

  /** Transport type for MCPServer interface */
  public readonly transport = 'inprocess' as const;

  /** Read-only subset: status + diff only */
  public readonly tools = [gitStatusTool, gitDiffTool];

  constructor() {
    super();

    this.registerServer({
      name: this.name,
      transport: this.transport,
      tools: this.tools,
    });

    // Register ONLY the read-only executors (no git_add / git_commit).
    this.registerToolExecutor('git', 'git_status', async (input: unknown) =>
      gitStatus(input as GitStatusInput)
    );
    this.registerToolExecutor('git', 'git_diff', async (input: unknown) =>
      gitDiff(input as GitDiffInput)
    );
  }
}

// Export types and tools for external use and testing
export type {
  GitStatusInput,
  GitDiffInput,
  GitAddInput,
  GitCommitInput,
  GitStatusResult,
  GitDiffResult,
  GitAddResult,
  GitCommitResult,
  GitFileHistoryEntry,
  GitListDeletionsResult,
  GitRestoreFromHeadResult,
  GitWriteTreeResult,
  GitCommitTreeResult,
  GitUpdateRefCASResult,
  GitRevParseHeadResult,
};
export {
  gitStatusTool,
  gitDiffTool,
  gitAddTool,
  gitCommitTool,
  gitStatus,
  gitDiff,
  gitAdd,
  gitCommit,
  gitFileHistory,
  getRecentCommitMessages,
  gitReadFileAtCommit,
  gitRestoreFile,
  gitListStagedDeletions,
  gitRestoreFileFromHead,
  gitUnstagePath,
  gitWriteTree,
  gitCommitTree,
  gitUpdateRefCAS,
  gitRevParseHead,
};
