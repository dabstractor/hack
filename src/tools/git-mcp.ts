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
  gitReadFileAtCommit,
  gitRestoreFile,
};
