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

// Mock the GitMCP functions that smartCommit uses (gitDiff added for the
// stagecoach generateMessage path — default-path tests never trigger it).
vi.mock('../../../src/tools/git-mcp.js', () => ({
  gitStatus: vi.fn(),
  gitAdd: vi.fn(),
  gitCommit: vi.fn(),
  gitDiff: vi.fn(),
}));

// Mock the stagecoach commit-message agent factory so default-path tests
// (options absent) NEVER instantiate a real agent. Only the generateMessage
// tests wire this mock to return a fake agent.
vi.mock('../../../src/agents/commit-message-agent.js', () => ({
  createCommitMessageAgent: vi.fn(),
}));

// Mock groundswell's createPrompt: passthrough the options object so the test
// can assert the prompt was built, without needing the real Prompt type.
vi.mock('groundswell', () => ({
  createPrompt: vi.fn((opts: unknown) => opts),
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

import {
  gitStatus,
  gitAdd,
  gitCommit,
  gitDiff,
} from '../../../src/tools/git-mcp.js';
import { createPrompt } from 'groundswell';
import { createCommitMessageAgent } from '../../../src/agents/commit-message-agent.js';
import {
  filterProtectedFiles,
  formatCommitMessage,
  generateCommitMessage,
  smartCommit,
} from '../../../src/utils/git-commit.js';
import { AgentError } from '../../../src/utils/errors.js';
import { isTransientError } from '../../../src/utils/retry.js';

const mockGitStatus = vi.mocked(gitStatus);
const mockGitAdd = vi.mocked(gitAdd);
const mockGitCommit = vi.mocked(gitCommit);
const mockGitDiff = vi.mocked(gitDiff);
const mockCreateCommitMessageAgent = vi.mocked(createCommitMessageAgent);
const mockCreatePrompt = vi.mocked(createPrompt);

// Helper to build a fake agent whose .prompt() resolves a controlled response.
function makeFakeAgent(response: {
  status: 'success' | 'error' | 'partial';
  data?: unknown;
  error?: { message?: string } | null;
}) {
  return { prompt: vi.fn().mockResolvedValue(response) };
}

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
      expect(result).toEqual([
        'src/index.ts',
        'tasks.json',
        'src/utils.ts',
        'README.md',
      ]);
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
      const files = [
        'PRD.md',
        'prd_snapshot.md',
        'delta_prd.md',
        'delta_from.txt',
        'TEST_RESULTS.md',
      ];

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
      expect(result).toEqual([
        'src/index.ts',
        'plan/session/tasks.json',
        'src/utils.ts',
      ]);
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

  // ===========================================================================
  // STAGECOACH GENERATION BOUNDARY: generateCommitMessage
  // (PRP P3.M1.T3.S1) — the transient-API-sensitive boundary P3.M1.T4.S1 wraps
  // with retryAgentPrompt. Throws AgentError on every failure mode.
  // ===========================================================================
  describe('generateCommitMessage', () => {
    it('should return the trimmed message on agent success', async () => {
      // SETUP
      mockCreateCommitMessageAgent.mockReturnValue(
        makeFakeAgent({
          status: 'success',
          data: 'feat(api): add endpoint',
          error: null,
        })
      );

      // EXECUTE
      const result = await generateCommitMessage('diff --git ...');

      // VERIFY
      expect(result).toBe('feat(api): add endpoint');
      expect(mockCreatePrompt).toHaveBeenCalledWith(
        expect.objectContaining({ responseFormat: expect.anything() })
      );
    });

    it('should trim whitespace from the agent output', async () => {
      // SETUP
      mockCreateCommitMessageAgent.mockReturnValue(
        makeFakeAgent({ status: 'success', data: '  feat: x  \n', error: null })
      );

      // EXECUTE
      const result = await generateCommitMessage('diff text');

      // VERIFY
      expect(result).toBe('feat: x');
    });

    it('should throw AgentError on empty diff', async () => {
      // EXECUTE + VERIFY
      await expect(generateCommitMessage('')).rejects.toThrow(AgentError);
      await expect(generateCommitMessage('')).rejects.toThrow(
        /empty staged diff/
      );
    });

    it('should throw AgentError on whitespace-only diff', async () => {
      // EXECUTE + VERIFY
      await expect(generateCommitMessage('   \n\t  ')).rejects.toThrow(
        /empty staged diff/
      );
    });

    it('should throw AgentError on agent status error', async () => {
      // SETUP
      mockCreateCommitMessageAgent.mockReturnValue(
        makeFakeAgent({
          status: 'error',
          data: null,
          error: { message: 'model overloaded' },
        })
      );

      // EXECUTE + VERIFY
      await expect(generateCommitMessage('diff text')).rejects.toThrow(
        AgentError
      );
      await expect(generateCommitMessage('diff text')).rejects.toThrow(
        /model overloaded/
      );
    });

    it('should throw AgentError on empty/whitespace agent output', async () => {
      // SETUP
      mockCreateCommitMessageAgent.mockReturnValue(
        makeFakeAgent({ status: 'success', data: '   ', error: null })
      );

      // EXECUTE + VERIFY
      await expect(generateCommitMessage('diff text')).rejects.toThrow(
        /empty agent output/
      );
    });

    it('should throw AgentError when agent outputs the "skip" sentinel', async () => {
      // SETUP
      mockCreateCommitMessageAgent.mockReturnValue(
        makeFakeAgent({ status: 'success', data: 'skip', error: null })
      );

      // EXECUTE + VERIFY
      await expect(generateCommitMessage('diff text')).rejects.toThrow(
        /empty agent output/
      );
    });

    it('should throw a TRANSIENT AgentError (the P3.M1.T4 retry contract)', async () => {
      // SETUP — agent status error throws AgentError
      mockCreateCommitMessageAgent.mockReturnValue(
        makeFakeAgent({
          status: 'error',
          data: null,
          error: { message: 'timeout' },
        })
      );

      // EXECUTE
      let thrown: unknown;
      try {
        await generateCommitMessage('diff text');
      } catch (e) {
        thrown = e;
      }

      // VERIFY — the AgentError must be classified transient so
      // retryAgentPrompt (P3.M1.T4.S1) re-attempts the boundary.
      expect(thrown).toBeInstanceOf(AgentError);
      expect(isTransientError(thrown)).toBe(true);
    });

    it('should classify the empty-diff AgentError as transient', async () => {
      // EXECUTE
      let thrown: unknown;
      try {
        await generateCommitMessage('');
      } catch (e) {
        thrown = e;
      }

      // VERIFY — every AgentError (hardcoded PIPELINE_AGENT_LLM_FAILED) is
      // transient per isTransientError.
      expect(isTransientError(thrown)).toBe(true);
    });

    it('should handle agent error with missing error.message (fallback msg)', async () => {
      // SETUP — error object present but no `message` field → exercises the
      // `?? 'unknown agent error'` fallback branch.
      mockCreateCommitMessageAgent.mockReturnValue(
        makeFakeAgent({ status: 'error', data: null, error: {} })
      );

      // EXECUTE + VERIFY
      await expect(generateCommitMessage('diff text')).rejects.toThrow(
        /unknown agent error/
      );
    });

    it('should handle agent error with null error object', async () => {
      // SETUP — error is null → exercises the `r.error?.message` optional chain.
      mockCreateCommitMessageAgent.mockReturnValue(
        makeFakeAgent({ status: 'error', data: null, error: null })
      );

      // EXECUTE + VERIFY
      await expect(generateCommitMessage('diff text')).rejects.toThrow(
        /unknown agent error/
      );
    });

    it('should handle partial status with undefined data (fallback to empty)', async () => {
      // SETUP — partial response carries no `data` → `(r.data ?? '')` falls
      // back to empty → empty-output AgentError.
      mockCreateCommitMessageAgent.mockReturnValue(
        makeFakeAgent({ status: 'partial', data: undefined, error: null })
      );

      // EXECUTE + VERIFY
      await expect(generateCommitMessage('diff text')).rejects.toThrow(
        /empty agent output/
      );
    });
  });

  // ===========================================================================
  // STAGECOACH GENERATION PATH: smartCommit({ generateMessage: true })
  // (PRP P3.M1.T3.S1) — opt-in 3rd param. Default path stays byte-identical.
  // ===========================================================================
  describe('smartCommit generateMessage option', () => {
    it('happy path: generates message, wraps via formatCommitMessage, commits', async () => {
      // SETUP
      mockGitStatus.mockResolvedValue({
        success: true,
        modified: ['src/index.ts'],
      });
      mockGitAdd.mockResolvedValue({ success: true, stagedCount: 1 });
      mockGitDiff.mockResolvedValue({
        success: true,
        diff: 'diff --git a/a.ts b/a.ts\n+export const x = 1;',
      });
      mockCreateCommitMessageAgent.mockReturnValue(
        makeFakeAgent({
          status: 'success',
          data: 'feat(api): add endpoint',
          error: null,
        })
      );
      mockGitCommit.mockResolvedValue({
        success: true,
        commitHash: 'abc123',
      });

      // EXECUTE
      const result = await smartCommit('/project', 'fallback msg', {
        generateMessage: true,
      });

      // VERIFY — commit hash returned + gitDiff called after gitAdd + message
      // wrapped in [PRP Auto] prefix + Co-Authored-By trailer.
      expect(result).toBe('abc123');
      expect(mockGitDiff).toHaveBeenCalledWith({
        path: '/project',
        staged: true,
      });
      expect(mockGitCommit).toHaveBeenCalledWith({
        path: '/project',
        message:
          '[PRP Auto] feat(api): add endpoint\n\nCo-Authored-By: Claude <noreply@anthropic.com>',
      });
    });

    it('gitDiff failure → returns null, agent never called, error logged', async () => {
      // SETUP
      mockGitStatus.mockResolvedValue({
        success: true,
        modified: ['src/index.ts'],
      });
      mockGitAdd.mockResolvedValue({ success: true, stagedCount: 1 });
      mockGitDiff.mockResolvedValue({
        success: false,
        error: 'not a git repo',
      });

      // EXECUTE
      const result = await smartCommit('/project', 'fallback', {
        generateMessage: true,
      });

      // VERIFY
      expect(result).toBeNull();
      expect(mockCreateCommitMessageAgent).not.toHaveBeenCalled();
      expect(mockGitCommit).not.toHaveBeenCalled();
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Git diff (staged) failed: not a git repo'
      );
    });

    it('generateCommitMessage throws → returns null (outer catch), error logged, gitCommit never called', async () => {
      // SETUP — agent status error → generateCommitMessage throws AgentError
      mockGitStatus.mockResolvedValue({
        success: true,
        modified: ['src/index.ts'],
      });
      mockGitAdd.mockResolvedValue({ success: true, stagedCount: 1 });
      mockGitDiff.mockResolvedValue({ success: true, diff: 'diff text' });
      mockCreateCommitMessageAgent.mockReturnValue(
        makeFakeAgent({
          status: 'error',
          data: null,
          error: { message: 'model overloaded' },
        })
      );

      // EXECUTE — smartCommit never throws; outer catch → null return
      const result = await smartCommit('/project', 'fallback', {
        generateMessage: true,
      });

      // VERIFY
      expect(result).toBeNull();
      expect(mockGitCommit).not.toHaveBeenCalled();
      // The AgentError is caught by the outer catch → 'Unexpected error: ...'
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringMatching(/Unexpected error/)
      );
    });

    it('BACKWARD COMPAT: no options → gitDiff never called, agent never instantiated, gitCommit uses formatCommitMessage(msg)', async () => {
      // SETUP
      mockGitStatus.mockResolvedValue({
        success: true,
        modified: ['src/index.ts'],
      });
      mockGitAdd.mockResolvedValue({ success: true, stagedCount: 1 });
      mockGitCommit.mockResolvedValue({
        success: true,
        commitHash: 'abc123',
      });

      // EXECUTE — no options (the default path)
      const result = await smartCommit('/project', 'Pre-formatted message');

      // VERIFY — default path is byte-identical to pre-stagecoach behavior
      expect(result).toBe('abc123');
      expect(mockGitDiff).not.toHaveBeenCalled();
      expect(mockCreateCommitMessageAgent).not.toHaveBeenCalled();
      expect(mockGitCommit).toHaveBeenCalledWith({
        path: '/project',
        message:
          '[PRP Auto] Pre-formatted message\n\nCo-Authored-By: Claude <noreply@anthropic.com>',
      });
    });

    it('BACKWARD COMPAT: { generateMessage: false } → default path (agent never called)', async () => {
      // SETUP
      mockGitStatus.mockResolvedValue({
        success: true,
        modified: ['src/index.ts'],
      });
      mockGitAdd.mockResolvedValue({ success: true, stagedCount: 1 });
      mockGitCommit.mockResolvedValue({
        success: true,
        commitHash: 'abc123',
      });

      // EXECUTE — generateMessage explicitly false
      const result = await smartCommit('/project', 'msg', {
        generateMessage: false,
      });

      // VERIFY
      expect(result).toBe('abc123');
      expect(mockGitDiff).not.toHaveBeenCalled();
      expect(mockCreateCommitMessageAgent).not.toHaveBeenCalled();
    });

    it('gitDiff success but missing diff field → generateCommitMessage throws empty-diff → returns null', async () => {
      // SETUP — gitDiff returns success:true but no `diff` string. smartCommit
      // passes `diffResult.diff ?? ''` to generateCommitMessage, which throws
      // AgentError on the empty diff → outer catch → null return.
      mockGitStatus.mockResolvedValue({
        success: true,
        modified: ['src/index.ts'],
      });
      mockGitAdd.mockResolvedValue({ success: true, stagedCount: 1 });
      mockGitDiff.mockResolvedValue({ success: true }); // no diff field

      // EXECUTE
      const result = await smartCommit('/project', 'fallback', {
        generateMessage: true,
      });

      // VERIFY — the empty-diff AgentError is caught by the outer catch.
      expect(result).toBeNull();
      expect(mockGitCommit).not.toHaveBeenCalled();
      expect(mockCreateCommitMessageAgent).not.toHaveBeenCalled();
    });
  });
});
