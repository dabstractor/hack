/**
 * Unit tests for git-commit utility
 *
 * @remarks
 * Tests validate smart commit functionality with file filtering
 * and achieve 100% code coverage of src/utils/git-commit.ts
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the GitMCP functions that smartCommit uses
vi.mock('../../../src/tools/git-mcp.js', () => ({
  gitStatus: vi.fn(),
  gitAdd: vi.fn(),
  gitCommit: vi.fn(),
}));

// Mock the logger with hoisted variables
const { mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../../src/utils/logger.js', () => ({
  getLogger: vi.fn(() => mockLogger),
}));

import { gitStatus, gitAdd, gitCommit } from '../../../src/tools/git-mcp.js';
import {
  filterProtectedFiles,
  formatCommitMessage,
  smartCommit,
} from '../../../src/utils/git-commit.js';

const mockGitStatus = vi.mocked(gitStatus);
const mockGitAdd = vi.mocked(gitAdd);
const mockGitCommit = vi.mocked(gitCommit);

describe('utils/git-commit', () => {
  beforeEach(() => {
    // Reset all mocks before each test
    vi.clearAllMocks();
    // Clear mock logger calls
    mockLogger.info.mockClear();
    mockLogger.error.mockClear();
    mockLogger.warn.mockClear();
    mockLogger.debug.mockClear();
    // Mock process.cwd() so git operations use '/project' as repo root
    vi.spyOn(process, 'cwd').mockReturnValue('/project');
  });

  describe('filterProtectedFiles', () => {
    it('should remove protected files from array', () => {
      // SETUP
      const files = [
        'src/index.ts',
        'tasks.json',
        'src/utils.ts',
        'PRD.md',
        'README.md',
        'prd_snapshot.md',
        'delta_prd.md',
        'delta_from.txt',
        'TEST_RESULTS.md',
      ];

      // EXECUTE
      const result = filterProtectedFiles(files);

      // VERIFY
      // tasks.json is intentionally NOT protected (status delta rides with commit)
      expect(result).toEqual(['src/index.ts', 'tasks.json', 'src/utils.ts', 'README.md']);
      expect(result).not.toContain('PRD.md');
      expect(result).not.toContain('prd_snapshot.md');
      expect(result).not.toContain('delta_prd.md');
      expect(result).not.toContain('delta_from.txt');
      expect(result).not.toContain('TEST_RESULTS.md');
    });

    it('should keep all files when none are protected', () => {
      // SETUP
      const files = ['src/index.ts', 'src/utils.ts', 'README.md'];

      // EXECUTE
      const result = filterProtectedFiles(files);

      // VERIFY
      expect(result).toEqual(['src/index.ts', 'src/utils.ts', 'README.md']);
    });

    it('should return empty array when all files are protected', () => {
      // SETUP
      const files = ['PRD.md', 'prd_snapshot.md', 'delta_prd.md', 'delta_from.txt', 'TEST_RESULTS.md'];

      // EXECUTE
      const result = filterProtectedFiles(files);

      // VERIFY
      expect(result).toEqual([]);
    });

    it('should handle files with paths (use basename)', () => {
      // SETUP
      const files = [
        'src/index.ts',
        'plan/session/tasks.json',
        'plan/session/PRD.md',
        'src/utils.ts',
        'session/prd_snapshot.md',
      ];

      // EXECUTE
      const result = filterProtectedFiles(files);

      // VERIFY - tasks.json NOT protected, PRD.md and prd_snapshot.md ARE protected
      expect(result).toEqual(['src/index.ts', 'plan/session/tasks.json', 'src/utils.ts']);
    });

    it('should handle empty array', () => {
      // SETUP
      const files: string[] = [];

      // EXECUTE
      const result = filterProtectedFiles(files);

      // VERIFY
      expect(result).toEqual([]);
    });

    it('should handle absolute paths', () => {
      // SETUP
      const files = [
        '/project/src/index.ts',
        '/project/tasks.json',
        '/project/src/utils.ts',
      ];

      // EXECUTE
      const result = filterProtectedFiles(files);

      // VERIFY - tasks.json is NOT protected
      expect(result).toEqual([
        '/project/src/index.ts',
        '/project/tasks.json',
        '/project/src/utils.ts',
      ]);
    });
  });

  describe('formatCommitMessage', () => {
    it('should add [PRP Auto] prefix to message', () => {
      // SETUP
      const message = 'P3.M4.T1.S3: Implement smart commit workflow';

      // EXECUTE
      const result = formatCommitMessage(message);

      // VERIFY
      expect(result).toContain('[PRP Auto]');
      expect(result).toContain(message);
    });

    it('should add Co-Authored-By trailer', () => {
      // SETUP
      const message = 'P3.M4.T1.S3: Implement smart commit workflow';

      // EXECUTE
      const result = formatCommitMessage(message);

      // VERIFY
      expect(result).toContain(
        'Co-Authored-By: Claude <noreply@anthropic.com>'
      );
    });

    it('should include blank line between message and trailer', () => {
      // SETUP
      const message = 'Test commit';

      // EXECUTE
      const result = formatCommitMessage(message);

      // VERIFY
      expect(result).toBe(
        `[PRP Auto] Test commit\n\nCo-Authored-By: Claude <noreply@anthropic.com>`
      );
    });

    it('should handle multi-line messages', () => {
      // SETUP
      const message = 'feat: Add new feature\n\nThis is a detailed description';

      // EXECUTE
      const result = formatCommitMessage(message);

      // VERIFY
      expect(result).toContain('[PRP Auto]');
      expect(result).toContain(message);
      expect(result).toContain(
        'Co-Authored-By: Claude <noreply@anthropic.com>'
      );
    });

    it('should handle special characters in message', () => {
      // SETUP
      const message = 'Fix: Handle special chars @#$%^&*()';

      // EXECUTE
      const result = formatCommitMessage(message);

      // VERIFY
      expect(result).toContain('[PRP Auto]');
      expect(result).toContain(message);
    });
  });

  describe('smartCommit', () => {
    describe('successful operations', () => {
      it('should return commit hash on success', async () => {
        // SETUP
        mockGitStatus.mockResolvedValue({
          success: true,
          modified: ['src/index.ts'],
          untracked: ['src/utils.ts'],
        });
        mockGitAdd.mockResolvedValue({
          success: true,
          stagedCount: 2,
        });
        mockGitCommit.mockResolvedValue({
          success: true,
          commitHash: 'abc123def456',
        });

        // EXECUTE
        const result = await smartCommit('/project', 'Test commit');

        // VERIFY
        expect(result).toBe('abc123def456');
        expect(mockGitStatus).toHaveBeenCalledWith({ path: '/project' });
        expect(mockGitAdd).toHaveBeenCalledWith({
          path: '/project',
          files: ['src/index.ts', 'src/utils.ts'],
        });
        expect(mockGitCommit).toHaveBeenCalledWith({
          path: '/project',
          message:
            '[PRP Auto] Test commit\n\nCo-Authored-By: Claude <noreply@anthropic.com>',
        });
      });

      it('should filter out protected files before staging', async () => {
        // SETUP
        mockGitStatus.mockResolvedValue({
          success: true,
          modified: ['src/index.ts'],
          untracked: ['tasks.json', 'PRD.md'],
        });
        mockGitAdd.mockResolvedValue({
          success: true,
          stagedCount: 2,
        });
        mockGitCommit.mockResolvedValue({
          success: true,
          commitHash: 'abc123',
        });

        // EXECUTE
        const result = await smartCommit('/project', 'Test commit');

        // VERIFY
        expect(result).toBe('abc123');
        // tasks.json is NOT protected, PRD.md IS protected
        expect(mockGitAdd).toHaveBeenCalledWith({
          path: '/project',
          files: ['src/index.ts', 'tasks.json'],
        });
      });

      it('should return null when no files to commit after filtering', async () => {
        // SETUP
        mockGitStatus.mockResolvedValue({
          success: true,
          modified: ['PRD.md'],
        });

        // EXECUTE
        const result = await smartCommit('/project', 'Test commit');

        // VERIFY
        expect(result).toBeNull();
        expect(mockGitAdd).not.toHaveBeenCalled();
        expect(mockGitCommit).not.toHaveBeenCalled();
      });

      it('should return null when no changes in repository', async () => {
        // SETUP
        mockGitStatus.mockResolvedValue({
          success: true,
        });

        // EXECUTE
        const result = await smartCommit('/project', 'Test commit');

        // VERIFY
        expect(result).toBeNull();
        expect(mockGitAdd).not.toHaveBeenCalled();
        expect(mockGitCommit).not.toHaveBeenCalled();
      });
    });

    describe('input validation', () => {
      it('should return null for empty sessionPath', async () => {
        // EXECUTE
        const result = await smartCommit('', 'Test commit');

        // VERIFY
        expect(result).toBeNull();
        expect(mockGitStatus).not.toHaveBeenCalled();
      });

      it('should return null for whitespace-only sessionPath', async () => {
        // EXECUTE
        const result = await smartCommit('   ', 'Test commit');

        // VERIFY
        expect(result).toBeNull();
        expect(mockGitStatus).not.toHaveBeenCalled();
      });

      it('should return null for empty message', async () => {
        // EXECUTE
        const result = await smartCommit('/project', '');

        // VERIFY
        expect(result).toBeNull();
        expect(mockGitStatus).not.toHaveBeenCalled();
      });

      it('should return null for whitespace-only message', async () => {
        // EXECUTE
        const result = await smartCommit('/project', '   ');

        // VERIFY
        expect(result).toBeNull();
        expect(mockGitStatus).not.toHaveBeenCalled();
      });

      it('should return null for undefined sessionPath', async () => {
        // EXECUTE
        const result = await smartCommit(
          undefined as unknown as string,
          'Test commit'
        );

        // VERIFY
        expect(result).toBeNull();
        expect(mockGitStatus).not.toHaveBeenCalled();
      });
    });

    describe('error handling', () => {
      it('should return null when git status fails', async () => {
        // SETUP
        mockGitStatus.mockResolvedValue({
          success: false,
          error: 'Git status failed',
        });

        // EXECUTE
        const result = await smartCommit('/project', 'Test commit');

        // VERIFY
        expect(result).toBeNull();
        expect(mockGitAdd).not.toHaveBeenCalled();
        expect(mockGitCommit).not.toHaveBeenCalled();
      });

      it('should return null when git add fails', async () => {
        // SETUP
        mockGitStatus.mockResolvedValue({
          success: true,
          modified: ['src/index.ts'],
        });
        mockGitAdd.mockResolvedValue({
          success: false,
          error: 'Git add failed',
        });

        // EXECUTE
        const result = await smartCommit('/project', 'Test commit');

        // VERIFY
        expect(result).toBeNull();
        expect(mockGitCommit).not.toHaveBeenCalled();
      });

      it('should return null when git commit fails', async () => {
        // SETUP
        mockGitStatus.mockResolvedValue({
          success: true,
          modified: ['src/index.ts'],
        });
        mockGitAdd.mockResolvedValue({
          success: true,
          stagedCount: 1,
        });
        mockGitCommit.mockResolvedValue({
          success: false,
          error: 'Git commit failed',
        });

        // EXECUTE
        const result = await smartCommit('/project', 'Test commit');

        // VERIFY
        expect(result).toBeNull();
      });

      it('should handle unexpected errors', async () => {
        // SETUP
        mockGitStatus.mockImplementation(() => {
          throw 'String error';
        });

        // EXECUTE
        const result = await smartCommit('/project', 'Test commit');

        // VERIFY
        expect(result).toBeNull();
      });
    });

    describe('logging behavior', () => {
      it('should log commit hash on success', async () => {
        // SETUP
        mockGitStatus.mockResolvedValue({
          success: true,
          modified: ['src/index.ts'],
        });
        mockGitAdd.mockResolvedValue({
          success: true,
          stagedCount: 1,
        });
        mockGitCommit.mockResolvedValue({
          success: true,
          commitHash: 'abc123',
        });

        // EXECUTE
        await smartCommit('/project', 'Test commit');

        // VERIFY
        expect(mockLogger.info).toHaveBeenCalledWith('Commit created: abc123');
      });

      it('should log when no files to commit', async () => {
        // SETUP
        mockGitStatus.mockResolvedValue({
          success: true,
        });

        // EXECUTE
        await smartCommit('/project', 'Test commit');

        // VERIFY
        expect(mockLogger.info).toHaveBeenCalledWith(
          'No files to commit after filtering protected files'
        );
      });

      it('should log error for invalid sessionPath', async () => {
        // EXECUTE
        await smartCommit('', 'Test commit');

        // VERIFY
        expect(mockLogger.error).toHaveBeenCalledWith('Invalid session path');
      });

      it('should log error for invalid commit message', async () => {
        // EXECUTE
        await smartCommit('/project', '');

        // VERIFY
        expect(mockLogger.error).toHaveBeenCalledWith('Invalid commit message');
      });

      it('should log error for git status failure', async () => {
        // SETUP
        mockGitStatus.mockResolvedValue({
          success: false,
          error: 'Status failed',
        });

        // EXECUTE
        await smartCommit('/project', 'Test commit');

        // VERIFY
        expect(mockLogger.error).toHaveBeenCalledWith(
          'Git status failed: Status failed'
        );
      });
    });
  });

  describe('edge cases', () => {
    it('should handle files with special characters in names', async () => {
      // SETUP
      mockGitStatus.mockResolvedValue({
        success: true,
        modified: ['src/file with spaces.ts'],
        untracked: ['src/file-with-dashes.ts'],
      });
      mockGitAdd.mockResolvedValue({
        success: true,
        stagedCount: 2,
      });
      mockGitCommit.mockResolvedValue({
        success: true,
        commitHash: 'abc123',
      });

      // EXECUTE
      const result = await smartCommit('/project', 'Test commit');

      // VERIFY
      expect(result).toBe('abc123');
      expect(mockGitAdd).toHaveBeenCalled();
    });

    it('should handle very long commit messages', async () => {
      // SETUP
      const longMessage = 'a'.repeat(1000);
      mockGitStatus.mockResolvedValue({
        success: true,
        modified: ['src/index.ts'],
      });
      mockGitAdd.mockResolvedValue({
        success: true,
        stagedCount: 1,
      });
      mockGitCommit.mockResolvedValue({
        success: true,
        commitHash: 'abc123',
      });

      // EXECUTE
      const result = await smartCommit('/project', longMessage);

      // VERIFY
      expect(result).toBe('abc123');
    });

    it('should handle both modified and untracked files', async () => {
      // SETUP
      mockGitStatus.mockResolvedValue({
        success: true,
        modified: ['src/modified.ts', 'src/both.ts'],
        untracked: ['src/untracked.ts'],
      });
      mockGitAdd.mockResolvedValue({
        success: true,
        stagedCount: 3,
      });
      mockGitCommit.mockResolvedValue({
        success: true,
        commitHash: 'abc123',
      });

      // EXECUTE
      const result = await smartCommit('/project', 'Test commit');

      // VERIFY
      expect(result).toBe('abc123');
      expect(mockGitAdd).toHaveBeenCalled();
    });

    it('should NOT filter tasks.json in subdirectories (intentionally unprotected)', async () => {
      // SETUP
      mockGitStatus.mockResolvedValue({
        success: true,
        modified: ['src/index.ts'],
        untracked: ['plan/session/tasks.json', 'src/utils.ts'],
      });
      mockGitAdd.mockResolvedValue({
        success: true,
        stagedCount: 3,
      });
      mockGitCommit.mockResolvedValue({
        success: true,
        commitHash: 'abc123',
      });

      // EXECUTE
      const result = await smartCommit('/project', 'Test commit');

      // VERIFY - tasks.json is NOT protected
      expect(result).toBe('abc123');
      expect(mockGitAdd).toHaveBeenCalledWith({
        path: '/project',
        files: ['src/index.ts', 'plan/session/tasks.json', 'src/utils.ts'],
      });
    });
  });
});
