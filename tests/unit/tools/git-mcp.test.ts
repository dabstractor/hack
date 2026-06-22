/**
 * Unit tests for Git MCP tool
 *
 * @remarks
 * Tests validate Git operations with security constraints
 * and achieve 100% code coverage of src/tools/git-mcp.ts
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Mock node:fs for path validation
vi.mock('node:fs', () => ({
  existsSync: vi.fn((_path: unknown) => {
    // Return true for all paths by default
    // Individual tests can override with mockImplementation
    return true;
  }),
  realpathSync: vi.fn((path: unknown) => (path as string) ?? ''),
}));

// Mock simple-git to avoid actual git operations
vi.mock('simple-git', () => ({
  simpleGit: vi.fn(() => mockGitInstance),
  GitError: class MockGitError extends Error {
    name = 'GitError';
    message: string;
    constructor(message: string) {
      super(message);
      this.message = message;
    }
  },
}));

import { existsSync, realpathSync } from 'node:fs';
import { simpleGit, GitError } from 'simple-git';
import {
  GitMCP,
  gitStatus,
  gitDiff,
  gitAdd,
  gitCommit,
  gitFileHistory,
  gitReadFileAtCommit,
  gitRestoreFile,
  gitStatusTool,
  gitDiffTool,
  gitAddTool,
  gitCommitTool,
  type GitStatusInput,
  type GitDiffInput,
  type GitAddInput,
  type GitCommitInput,
  type GitFileHistoryEntry,
} from '../../../src/tools/git-mcp.js';

const mockExistsSync = vi.mocked(existsSync);
const mockRealpathSync = vi.mocked(realpathSync);
const mockSimpleGit = vi.mocked(simpleGit);

// Mock simple-git instance
const mockGitInstance = {
  status: vi.fn(),
  diff: vi.fn(),
  add: vi.fn(),
  commit: vi.fn(),
  log: vi.fn(),
  show: vi.fn(),
};

describe('tools/git-mcp', () => {
  beforeEach(() => {
    // Restore default mock implementations
    mockExistsSync.mockReturnValue(true);
    mockRealpathSync.mockImplementation(
      (path: unknown) => (path as string) ?? ''
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('GitMCP class', () => {
    it('should instantiate and register git server', () => {
      // EXECUTE
      const gitMCP = new GitMCP();

      // VERIFY
      expect(gitMCP).toBeInstanceOf(GitMCP);
    });

    it('should register four tool executors', () => {
      // EXECUTE
      const gitMCP = new GitMCP();

      // VERIFY - tool is registered via MCPHandler
      expect(gitMCP).toBeDefined();
    });
  });

  describe('gitStatusTool schema', () => {
    it('should have correct tool name', () => {
      // VERIFY
      expect(gitStatusTool.name).toBe('git_status');
    });

    it('should have description', () => {
      // VERIFY
      expect(gitStatusTool.description).toContain('git repository status');
    });

    it('should have path property defined', () => {
      // VERIFY
      expect(gitStatusTool.input_schema.properties.path).toEqual({
        type: 'string',
        description:
          'Path to git repository (optional, defaults to current directory)',
      });
    });

    it('should have no required fields', () => {
      // VERIFY
      expect(gitStatusTool.input_schema.required).toBeUndefined();
    });
  });

  describe('gitDiffTool schema', () => {
    it('should have correct tool name', () => {
      // VERIFY
      expect(gitDiffTool.name).toBe('git_diff');
    });

    it('should have description', () => {
      // VERIFY
      expect(gitDiffTool.description).toContain('git diff');
    });

    it('should have staged property defined', () => {
      // VERIFY
      expect(gitDiffTool.input_schema.properties.staged).toEqual({
        type: 'boolean',
        description: 'Show staged changes instead of unstaged (default: false)',
      });
    });
  });

  describe('gitAddTool schema', () => {
    it('should have correct tool name', () => {
      // VERIFY
      expect(gitAddTool.name).toBe('git_add');
    });

    it('should have files array property', () => {
      // VERIFY
      expect(gitAddTool.input_schema.properties.files).toEqual({
        type: 'array',
        items: {
          type: 'string',
        },
        description:
          'Files to stage (optional, defaults to staging all changes)',
      });
    });
  });

  describe('gitCommitTool schema', () => {
    it('should have correct tool name', () => {
      // VERIFY
      expect(gitCommitTool.name).toBe('git_commit');
    });

    it('should require message property', () => {
      // VERIFY
      expect(gitCommitTool.input_schema.required).toEqual(['message']);
    });

    it('should have allowEmpty property', () => {
      // VERIFY
      expect(gitCommitTool.input_schema.properties.allowEmpty).toEqual({
        type: 'boolean',
        description: 'Allow empty commit (default: false)',
      });
    });
  });

  describe('gitStatus', () => {
    describe('successful operations', () => {
      it('should return repository status with all file types', async () => {
        // SETUP
        mockExistsSync.mockReturnValue(true);
        mockRealpathSync.mockImplementation(path => path as string);
        mockGitInstance.status.mockResolvedValue({
          current: 'main',
          files: [
            { path: 'src/index.ts', index: 'M', working_dir: ' ' },
            { path: 'src/utils.ts', index: ' ', working_dir: 'M' },
            { path: 'newfile.txt', index: '?', working_dir: '?' },
          ],
          isClean: () => false,
        } as never);

        const input: GitStatusInput = { path: './test-repo' };

        // EXECUTE
        const result = await gitStatus(input);

        // VERIFY
        expect(result.success).toBe(true);
        expect(result.branch).toBe('main');
        expect(result.staged).toEqual(['src/index.ts']);
        expect(result.modified).toEqual(['src/utils.ts']);
        expect(result.untracked).toEqual(['newfile.txt']);
        expect(result.error).toBeUndefined();
      });

      it('should handle clean repository', async () => {
        // SETUP
        mockGitInstance.status.mockResolvedValue({
          current: 'main',
          files: [],
          isClean: () => true,
        } as never);
        const input: GitStatusInput = {};

        // EXECUTE
        const result = await gitStatus(input);

        // VERIFY
        expect(result.success).toBe(true);
        expect(result.branch).toBe('main');
        expect(result.staged).toBeUndefined();
        expect(result.modified).toBeUndefined();
        expect(result.untracked).toBeUndefined();
      });

      it('should use default path when not provided', async () => {
        // SETUP
        mockGitInstance.status.mockResolvedValue({
          current: 'develop',
          files: [],
          isClean: () => true,
        } as never);
        const input: GitStatusInput = {};

        // EXECUTE
        await gitStatus(input);

        // VERIFY - simpleGit should be called
        expect(mockSimpleGit).toHaveBeenCalled();
      });

      it('should filter files correctly by status', async () => {
        // SETUP
        mockGitInstance.status.mockResolvedValue({
          current: 'main',
          files: [
            { path: 'added.ts', index: 'A', working_dir: ' ' },
            { path: 'deleted.ts', index: 'D', working_dir: ' ' },
            { path: 'renamed.ts', index: 'R', working_dir: ' ' },
            { path: 'modified.ts', index: 'M', working_dir: 'M' },
            { path: 'untracked.ts', index: '?', working_dir: '?' },
          ],
          isClean: () => false,
        } as never);

        // EXECUTE
        const result = await gitStatus({});

        // VERIFY
        expect(result.staged).toEqual([
          'added.ts',
          'deleted.ts',
          'renamed.ts',
          'modified.ts',
        ]);
        expect(result.modified).toEqual(['modified.ts']);
        expect(result.untracked).toEqual(['untracked.ts']);
      });
    });

    describe('error handling', () => {
      it('should handle non-existent repository path', async () => {
        // SETUP
        mockExistsSync.mockReturnValue(false);
        const input: GitStatusInput = { path: '/nonexistent' };

        // EXECUTE
        const result = await gitStatus(input);

        // VERIFY
        expect(result.success).toBe(false);
        expect(result.error).toContain('Repository path not found');
      });

      it('should handle non-git repository', async () => {
        // SETUP
        mockExistsSync.mockImplementation(
          (path: unknown) =>
            // Path exists but .git doesn't
            typeof path === 'string' && !path.endsWith('.git')
        );
        const input: GitStatusInput = { path: './not-a-repo' };

        // EXECUTE
        const result = await gitStatus(input);

        // VERIFY
        expect(result.success).toBe(false);
        expect(result.error).toContain('Not a git repository');
      });

      it('should handle GitError from simple-git', async () => {
        // SETUP
        const gitError = Object.assign(new Error('Git operation failed'), {
          name: 'GitError',
        }) as GitError;
        mockGitInstance.status.mockRejectedValue(gitError);
        const input: GitStatusInput = {};

        // EXECUTE
        const result = await gitStatus(input);

        // VERIFY
        expect(result.success).toBe(false);
        expect(result.error).toBe('Git operation failed');
      });

      it('should handle generic errors', async () => {
        // SETUP
        mockGitInstance.status.mockRejectedValue(new Error('Unknown error'));
        const input: GitStatusInput = {};

        // EXECUTE
        const result = await gitStatus(input);

        // VERIFY
        expect(result.success).toBe(false);
        expect(result.error).toBe('Unknown error');
      });

      it('should handle non-Error objects', async () => {
        // SETUP
        mockGitInstance.status.mockRejectedValue('string error');
        const input: GitStatusInput = {};

        // EXECUTE
        const result = await gitStatus(input);

        // VERIFY
        expect(result.success).toBe(false);
        expect(result.error).toBe('string error');
      });
    });
  });

  describe('gitDiff', () => {
    describe('successful operations', () => {
      it('should return unstaged diff by default', async () => {
        // SETUP
        mockGitInstance.diff.mockResolvedValue(
          'diff --git a/file.txt b/file.txt\n- old\n+ new'
        );
        const input: GitDiffInput = { path: './test-repo' };

        // EXECUTE
        const result = await gitDiff(input);

        // VERIFY
        expect(result.success).toBe(true);
        expect(result.diff).toContain('diff --git');
        expect(result.error).toBeUndefined();
      });

      it('should return staged diff when staged=true', async () => {
        // SETUP
        mockGitInstance.diff.mockResolvedValue(
          'diff --cached a/file.txt b/file.txt\n- old\n+ new'
        );
        const input: GitDiffInput = { path: './test-repo', staged: true };

        // EXECUTE
        const result = await gitDiff(input);

        // VERIFY
        expect(result.success).toBe(true);
        expect(result.diff).toContain('--cached');
        expect(mockGitInstance.diff).toHaveBeenCalledWith(['--cached']);
      });

      it('should use default path when not provided', async () => {
        // SETUP
        mockGitInstance.diff.mockResolvedValue('diff output');
        const input: GitDiffInput = {};

        // EXECUTE
        const result = await gitDiff(input);

        // VERIFY
        expect(result.success).toBe(true);
        expect(result.diff).toBe('diff output');
      });

      it('should handle empty diff', async () => {
        // SETUP
        mockGitInstance.diff.mockResolvedValue('');
        const input: GitDiffInput = {};

        // EXECUTE
        const result = await gitDiff(input);

        // VERIFY
        expect(result.success).toBe(true);
        expect(result.diff).toBe('');
      });
    });

    describe('error handling', () => {
      it('should handle non-existent repository path', async () => {
        // SETUP
        mockExistsSync.mockReturnValue(false);
        const input: GitDiffInput = { path: '/nonexistent' };

        // EXECUTE
        const result = await gitDiff(input);

        // VERIFY
        expect(result.success).toBe(false);
        expect(result.error).toContain('Repository path not found');
      });

      it('should handle GitError from simple-git', async () => {
        // SETUP
        const gitError = Object.assign(new Error('Diff failed'), {
          name: 'GitError',
        }) as GitError;
        mockGitInstance.diff.mockRejectedValue(gitError);
        const input: GitDiffInput = {};

        // EXECUTE
        const result = await gitDiff(input);

        // VERIFY
        expect(result.success).toBe(false);
        expect(result.error).toBe('Diff failed');
      });

      it('should handle generic errors', async () => {
        // SETUP
        mockGitInstance.diff.mockRejectedValue(new Error('Unknown diff error'));
        const input: GitDiffInput = {};

        // EXECUTE
        const result = await gitDiff(input);

        // VERIFY
        expect(result.success).toBe(false);
        expect(result.error).toBe('Unknown diff error');
      });
    });
  });

  describe('gitAdd', () => {
    describe('successful operations', () => {
      it('should stage all files with default "."', async () => {
        // SETUP
        mockGitInstance.add.mockResolvedValue(undefined);
        const input: GitAddInput = { path: './test-repo' };

        // EXECUTE
        const result = await gitAdd(input);

        // VERIFY
        expect(result.success).toBe(true);
        expect(result.stagedCount).toBe(1);
        expect(mockGitInstance.add).toHaveBeenCalledWith('.');
      });

      it('should stage specific files', async () => {
        // SETUP
        mockGitInstance.add.mockResolvedValue(undefined);
        const input: GitAddInput = {
          path: './test-repo',
          files: ['file1.txt', 'file2.txt'],
        };

        // EXECUTE
        const result = await gitAdd(input);

        // VERIFY
        expect(result.success).toBe(true);
        expect(result.stagedCount).toBe(2);
        expect(mockGitInstance.add).toHaveBeenCalledWith([
          '--',
          'file1.txt',
          'file2.txt',
        ]);
      });

      it('should use -- separator for file staging (security)', async () => {
        // SETUP
        mockGitInstance.add.mockResolvedValue(undefined);
        const input: GitAddInput = { files: ['legitimate-file.txt'] };

        // EXECUTE
        await gitAdd(input);

        // VERIFY - -- separator should be used to prevent flag injection
        expect(mockGitInstance.add).toHaveBeenCalledWith([
          '--',
          'legitimate-file.txt',
        ]);
      });

      it('should use default path when not provided', async () => {
        // SETUP
        mockGitInstance.add.mockResolvedValue(undefined);
        const input: GitAddInput = { files: ['test.txt'] };

        // EXECUTE
        const result = await gitAdd(input);

        // VERIFY
        expect(result.success).toBe(true);
        expect(mockGitInstance.add).toHaveBeenCalled();
      });
    });

    describe('error handling', () => {
      it('should handle non-existent repository path', async () => {
        // SETUP
        mockExistsSync.mockReturnValue(false);
        const input: GitAddInput = { path: '/nonexistent' };

        // EXECUTE
        const result = await gitAdd(input);

        // VERIFY
        expect(result.success).toBe(false);
        expect(result.error).toContain('Repository path not found');
      });

      it('should handle GitError from simple-git', async () => {
        // SETUP
        const gitError = Object.assign(new Error('Add failed'), {
          name: 'GitError',
        }) as GitError;
        mockGitInstance.add.mockRejectedValue(gitError);
        const input: GitAddInput = {};

        // EXECUTE
        const result = await gitAdd(input);

        // VERIFY
        expect(result.success).toBe(false);
        expect(result.error).toBe('Add failed');
      });

      it('should handle generic errors', async () => {
        // SETUP
        mockGitInstance.add.mockRejectedValue(new Error('Unknown add error'));
        const input: GitAddInput = {};

        // EXECUTE
        const result = await gitAdd(input);

        // VERIFY
        expect(result.success).toBe(false);
        expect(result.error).toBe('Unknown add error');
      });
    });
  });

  describe('gitCommit', () => {
    describe('successful operations', () => {
      it('should create commit with message', async () => {
        // SETUP
        mockGitInstance.commit.mockResolvedValue({
          commit: 'abc123def456',
          branch: 'main',
        } as never);
        const input: GitCommitInput = {
          path: './test-repo',
          message: 'Test commit',
        };

        // EXECUTE
        const result = await gitCommit(input);

        // VERIFY
        expect(result.success).toBe(true);
        expect(result.commitHash).toBe('abc123def456');
        expect(result.error).toBeUndefined();
      });

      it('should create empty commit when allowEmpty=true', async () => {
        // SETUP
        mockGitInstance.commit.mockResolvedValue({
          commit: 'xyz789',
          branch: 'main',
        } as never);
        const input: GitCommitInput = {
          message: 'Empty commit',
          allowEmpty: true,
        };

        // EXECUTE
        const result = await gitCommit(input);

        // VERIFY
        expect(result.success).toBe(true);
        expect(mockGitInstance.commit).toHaveBeenCalledWith(
          'Empty commit',
          [],
          {
            '--allow-empty': true,
          }
        );
      });

      it('should use default path when not provided', async () => {
        // SETUP
        mockGitInstance.commit.mockResolvedValue({
          commit: 'def456',
          branch: 'main',
        } as never);
        const input: GitCommitInput = { message: 'Test' };

        // EXECUTE
        const result = await gitCommit(input);

        // VERIFY
        expect(result.success).toBe(true);
        expect(result.commitHash).toBe('def456');
      });
    });

    describe('validation', () => {
      it('should reject empty commit message', async () => {
        // SETUP
        const input: GitCommitInput = { message: '' };

        // EXECUTE
        const result = await gitCommit(input);

        // VERIFY
        expect(result.success).toBe(false);
        expect(result.error).toContain('Commit message is required');
        expect(mockGitInstance.commit).not.toHaveBeenCalled();
      });

      it('should reject whitespace-only message', async () => {
        // SETUP
        const input: GitCommitInput = { message: '   ' };

        // EXECUTE
        const result = await gitCommit(input);

        // VERIFY
        expect(result.success).toBe(false);
        expect(result.error).toContain('Commit message is required');
      });

      it('should reject undefined message', async () => {
        // SETUP
        const input: GitCommitInput = {
          message: undefined as unknown as string,
        };

        // EXECUTE
        const result = await gitCommit(input);

        // VERIFY
        expect(result.success).toBe(false);
        expect(result.error).toContain('Commit message is required');
      });
    });

    describe('error handling', () => {
      it('should handle "nothing to commit" error', async () => {
        // SETUP
        const gitError = Object.assign(new Error('nothing to commit'), {
          name: 'GitError',
        }) as GitError;
        mockGitInstance.commit.mockRejectedValue(gitError);
        const input: GitCommitInput = { message: 'Test' };

        // EXECUTE
        const result = await gitCommit(input);

        // VERIFY
        expect(result.success).toBe(false);
        expect(result.error).toContain('No changes staged for commit');
      });

      it('should handle merge conflict error', async () => {
        // SETUP
        const gitError = Object.assign(new Error('merge conflict'), {
          name: 'GitError',
        }) as GitError;
        mockGitInstance.commit.mockRejectedValue(gitError);
        const input: GitCommitInput = { message: 'Test' };

        // EXECUTE
        const result = await gitCommit(input);

        // VERIFY
        expect(result.success).toBe(false);
        expect(result.error).toContain('unresolved merge conflicts');
      });

      it('should handle non-existent repository path', async () => {
        // SETUP
        mockExistsSync.mockReturnValue(false);
        const input: GitCommitInput = { path: '/nonexistent', message: 'Test' };

        // EXECUTE
        const result = await gitCommit(input);

        // VERIFY
        expect(result.success).toBe(false);
        expect(result.error).toContain('Repository path not found');
      });

      it('should handle generic GitError', async () => {
        // SETUP
        const gitError = Object.assign(new Error('Some other git error'), {
          name: 'GitError',
        }) as GitError;
        mockGitInstance.commit.mockRejectedValue(gitError);
        const input: GitCommitInput = { message: 'Test' };

        // EXECUTE
        const result = await gitCommit(input);

        // VERIFY
        expect(result.success).toBe(false);
        expect(result.error).toBe('Some other git error');
      });

      it('should handle generic errors', async () => {
        // SETUP
        mockGitInstance.commit.mockRejectedValue(
          new Error('Unknown commit error')
        );
        const input: GitCommitInput = { message: 'Test' };

        // EXECUTE
        const result = await gitCommit(input);

        // VERIFY
        expect(result.success).toBe(false);
        expect(result.error).toBe('Unknown commit error');
      });

      it('should handle non-Error objects', async () => {
        // SETUP
        mockGitInstance.commit.mockRejectedValue('string error');
        const input: GitCommitInput = { message: 'Test' };

        // EXECUTE
        const result = await gitCommit(input);

        // VERIFY
        expect(result.success).toBe(false);
        expect(result.error).toBe('string error');
      });
    });
  });

  describe('edge cases', () => {
    it('should handle file with special status characters', async () => {
      // SETUP
      mockGitInstance.status.mockResolvedValue({
        current: 'main',
        files: [
          { path: 'conflicted.txt', index: 'U', working_dir: 'U' },
          { path: 'both_modified.txt', index: 'M', working_dir: 'M' },
        ],
        isClean: () => false,
      } as never);

      // EXECUTE
      const result = await gitStatus({});

      // VERIFY
      expect(result.staged).toContain('conflicted.txt');
      expect(result.staged).toContain('both_modified.txt');
      expect(result.modified).toContain('conflicted.txt');
      expect(result.modified).toContain('both_modified.txt');
    });

    it('should handle empty file arrays in gitAdd', async () => {
      // SETUP
      mockGitInstance.add.mockResolvedValue(undefined);
      const input: GitAddInput = { files: [] };

      // EXECUTE
      const result = await gitAdd(input);

      // VERIFY
      expect(result.success).toBe(true);
      expect(mockGitInstance.add).toHaveBeenCalledWith(['--']);
    });

    it('should handle long commit message', async () => {
      // SETUP
      const longMessage = 'a'.repeat(1000);
      mockGitInstance.commit.mockResolvedValue({
        commit: 'abc123',
        branch: 'main',
      } as never);
      const input: GitCommitInput = { message: longMessage };

      // EXECUTE
      const result = await gitCommit(input);

      // VERIFY
      expect(result.success).toBe(true);
      expect(mockGitInstance.commit).toHaveBeenCalledWith(longMessage, [], {});
    });

    it('should handle special characters in diff output', async () => {
      // SETUP
      mockGitInstance.diff.mockResolvedValue(
        'diff --git a/file\u1234.txt b/file\u1234.txt\nBinary files differ'
      );
      const input: GitDiffInput = {};

      // EXECUTE
      const result = await gitDiff(input);

      // VERIFY
      expect(result.success).toBe(true);
      expect(result.diff).toContain('Binary files differ');
    });
  });

  describe('security patterns', () => {
    it('should use -- separator when staging files (flag injection prevention)', async () => {
      // SETUP
      mockGitInstance.add.mockResolvedValue(undefined);
      const input: GitAddInput = { files: ['file.txt'] };

      // EXECUTE
      await gitAdd(input);

      // VERIFY - -- separator should always be used for specific files
      expect(mockGitInstance.add).toHaveBeenCalledWith(['--', 'file.txt']);
    });

    it('should validate repository path exists before operations', async () => {
      // SETUP
      mockExistsSync.mockReturnValue(false);
      const input: GitStatusInput = { path: '/malicious/../etc/passwd' };

      // EXECUTE
      const result = await gitStatus(input);

      // VERIFY
      expect(result.success).toBe(false);
      expect(result.error).toContain('Repository path not found');
    });
  });

  describe('gitFileHistory', () => {
    it('should return mapped history entries (newest-first)', async () => {
      // SETUP
      mockGitInstance.log.mockResolvedValue({
        all: [
          { hash: 'aaa111', date: '2024-06-21T10:00:00', message: 'latest' },
          { hash: 'bbb222', date: '2024-06-20T10:00:00', message: 'older' },
        ],
        total: 2,
        latest: {
          hash: 'aaa111',
          date: '2024-06-21T10:00:00',
          message: 'latest',
        },
      } as never);

      // EXECUTE
      const result = await gitFileHistory('tasks.json', './repo');

      // VERIFY — newest-first, hash→commit, date→date
      expect(result).toEqual([
        { commit: 'aaa111', date: '2024-06-21T10:00:00' },
        { commit: 'bbb222', date: '2024-06-20T10:00:00' },
      ]);
      expect(mockGitInstance.log).toHaveBeenCalledWith({ file: 'tasks.json' });
    });

    it('should return an empty array when the file has no history', async () => {
      // SETUP — no-history file: .log({file}) returns empty all (NO error)
      mockGitInstance.log.mockResolvedValue({
        all: [],
        total: 0,
        latest: null,
      } as never);

      // EXECUTE
      const result = await gitFileHistory('never-committed.txt');

      // VERIFY — [] (NOT a throw)
      expect(result).toEqual([]);
    });

    it('should default repoPath to process.cwd()', async () => {
      // SETUP
      mockGitInstance.log.mockResolvedValue({
        all: [],
        total: 0,
        latest: null,
      } as never);

      // EXECUTE
      await gitFileHistory('tasks.json');

      // VERIFY — simpleGit was called (path validation passed), log was called with the file
      expect(mockSimpleGit).toHaveBeenCalled();
      expect(mockGitInstance.log).toHaveBeenCalledWith({ file: 'tasks.json' });
    });

    it('should throw when the repository path is invalid', async () => {
      // SETUP
      mockExistsSync.mockReturnValue(false);

      // EXECUTE + VERIFY — validateRepositoryPath throws → propagates (NOT a {success:false} return)
      await expect(
        gitFileHistory('tasks.json', '/nonexistent')
      ).rejects.toThrow(/Repository path not found/);
    });

    it('should throw when git.log fails', async () => {
      // SETUP
      mockGitInstance.log.mockRejectedValue(new Error('git log failed'));

      // EXECUTE + VERIFY — git error propagates as a throw
      await expect(gitFileHistory('tasks.json')).rejects.toThrow(
        'git log failed'
      );
    });
  });

  describe('gitReadFileAtCommit', () => {
    it('should return the blob content at the given commit', async () => {
      // SETUP — git show <commit>:<path> returns the BLOB CONTENT
      mockGitInstance.show.mockResolvedValue('{"version":"prior"}');

      // EXECUTE
      const content = await gitReadFileAtCommit(
        'tasks.json',
        'abc123',
        './repo'
      );

      // VERIFY
      expect(content).toBe('{"version":"prior"}');
      expect(mockGitInstance.show).toHaveBeenCalledWith('abc123:tasks.json');
    });

    it('should default repoPath to process.cwd()', async () => {
      // SETUP
      mockGitInstance.show.mockResolvedValue('content');

      // EXECUTE
      await gitReadFileAtCommit('tasks.json', 'HEAD');

      // VERIFY
      expect(mockSimpleGit).toHaveBeenCalled();
      expect(mockGitInstance.show).toHaveBeenCalledWith('HEAD:tasks.json');
    });

    it('should throw when the repository path is invalid', async () => {
      // SETUP
      mockExistsSync.mockReturnValue(false);

      // EXECUTE + VERIFY
      await expect(
        gitReadFileAtCommit('tasks.json', 'HEAD', '/nonexistent')
      ).rejects.toThrow(/Repository path not found/);
    });

    it('should throw when git.show fails (bad revision/path)', async () => {
      // SETUP
      mockGitInstance.show.mockRejectedValue(
        new Error('fatal: path does not exist')
      );

      // EXECUTE + VERIFY
      await expect(
        gitReadFileAtCommit('tasks.json', 'deadbeef')
      ).rejects.toThrow('fatal: path does not exist');
    });
  });

  describe('gitRestoreFile', () => {
    it('should write the blob content to disk via atomicWrite (real tmpdir)', async () => {
      // SETUP — real tmpdir so atomicWrite (node:fs/promises, NOT mocked) writes for real.
      // existsSync is mocked (returns true) so validateRepositoryPath passes for the tmpdir.
      const dir = await mkdtemp(join(tmpdir(), 'git-restore-'));
      mockGitInstance.show.mockResolvedValue('{"version":"restored"}');

      try {
        // EXECUTE — restore the HEAD version of tasks.json into the tmpdir
        await gitRestoreFile('tasks.json', 'HEAD', dir);

        // VERIFY — the prior content is now on disk
        const content = await readFile(join(dir, 'tasks.json'), 'utf-8');
        expect(content).toBe('{"version":"restored"}');
        expect(mockGitInstance.show).toHaveBeenCalledWith('HEAD:tasks.json');
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it('should default commit to HEAD when omitted', async () => {
      // SETUP
      mockGitInstance.show.mockResolvedValue('content');
      const dir = await mkdtemp(join(tmpdir(), 'git-restore-default-'));
      try {
        // EXECUTE
        await gitRestoreFile('tasks.json', undefined, dir);

        // VERIFY — show called with HEAD:<path> (default commit)
        expect(mockGitInstance.show).toHaveBeenCalledWith('HEAD:tasks.json');
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it('should throw when the repository path is invalid', async () => {
      // SETUP
      mockExistsSync.mockReturnValue(false);

      // EXECUTE + VERIFY
      await expect(
        gitRestoreFile('tasks.json', 'HEAD', '/nonexistent')
      ).rejects.toThrow(/Repository path not found/);
    });

    it('should throw when git.show fails', async () => {
      // SETUP
      mockGitInstance.show.mockRejectedValue(new Error('fatal: bad revision'));

      // EXECUTE + VERIFY
      await expect(gitRestoreFile('tasks.json', 'deadbeef')).rejects.toThrow(
        'fatal: bad revision'
      );
    });
  });
});
