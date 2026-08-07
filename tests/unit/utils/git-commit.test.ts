/**
 * Unit tests for git-commit utility
 *
 * @remarks
 * Tests validate smart commit functionality with file filtering
 * and achieve 100% code coverage of src/utils/git-commit.ts
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the GitMCP functions that smartCommit uses (gitDiff added for the
// stagecoach generateMessage path — default-path tests never trigger it).
// The three restore_* helpers are stubbed for the restore_critical_files
// mechanical protection layer (PRD §5.1, P3.M2.T4.S2).
// getRecentCommitMessages is added for the style-resolution block
// (P1.M1.T4.S1) — the top-level beforeEach defaults it to [] so the env-unset
// (auto) path degrades to plain and existing tests stay green.
vi.mock('../../../src/tools/git-mcp.js', () => ({
  gitStatus: vi.fn(),
  gitAdd: vi.fn(),
  gitCommit: vi.fn(),
  gitDiff: vi.fn(),
  gitListStagedDeletions: vi.fn(),
  gitRestoreFileFromHead: vi.fn(),
  gitUnstagePath: vi.fn(),
  getRecentCommitMessages: vi.fn(),
}));

// Mock the stagecoach commit-message agent factory so default-path tests
// (options absent) NEVER instantiate a real agent. Only the generateMessage
// tests wire this mock to return a fake agent. buildCommitMessageSystemPrompt
// is added for the style-resolution block (P1.M1.T4.S1) — it defaults to a
// vi.fn() (undefined return); style-resolution tests override it via
// mockImplementation to assert the WIRING via a MOCK[<style>] sentinel.
vi.mock('../../../src/agents/commit-message-agent.js', () => ({
  createCommitMessageAgent: vi.fn(),
  buildCommitMessageSystemPrompt: vi.fn(),
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
  gitListStagedDeletions,
  gitRestoreFileFromHead,
  gitUnstagePath,
  getRecentCommitMessages,
} from '../../../src/tools/git-mcp.js';
import { createPrompt } from 'groundswell';
import {
  createCommitMessageAgent,
  buildCommitMessageSystemPrompt,
} from '../../../src/agents/commit-message-agent.js';
import {
  buildFallbackCommitMessage,
  buildTaskPrefix,
  filterProtectedFiles,
  formatCommitMessage,
  generateCommitMessage,
  parseItemPosition,
  restore_critical_files,
  smartCommit,
} from '../../../src/utils/git-commit.js';
import { AgentError } from '../../../src/utils/errors.js';
import { isTransientError } from '../../../src/utils/retry.js';

const mockGitStatus = vi.mocked(gitStatus);
const mockGitAdd = vi.mocked(gitAdd);
const mockGitCommit = vi.mocked(gitCommit);
const mockGitDiff = vi.mocked(gitDiff);
const mockGitListStagedDeletions = vi.mocked(gitListStagedDeletions);
const mockGitRestoreFileFromHead = vi.mocked(gitRestoreFileFromHead);
const mockGitUnstagePath = vi.mocked(gitUnstagePath);
const mockCreateCommitMessageAgent = vi.mocked(createCommitMessageAgent);
const mockBuildCommitMessageSystemPrompt = vi.mocked(
  buildCommitMessageSystemPrompt
);
const mockCreatePrompt = vi.mocked(createPrompt);
const mockGetRecentCommitMessages = vi.mocked(getRecentCommitMessages);

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
    // DEFAULT: getRecentCommitMessages returns [] so the env-unset (auto)
    // style-resolution path degrades to plain (PRD §5.1) and existing
    // generateCommitMessage/smartCommit tests stay behaviorally identical to
    // the pre-style fixed plain contract. Style-resolution tests override
    // this per case. (A bare vi.fn() returning undefined would also work via
    // the !examples guard, but [] is deterministic and self-documenting.)
    mockGetRecentCommitMessages.mockResolvedValue([]);
    // DEFAULT: restore_critical_files (now invoked from smartCommit) is a
    // no-op for every pre-existing smartCommit test — gitListStagedDeletions
    // returns success with no staged deletions, so restore/unstage are never
    // called. Individual restore_critical_files tests override these mocks.
    mockGitListStagedDeletions.mockResolvedValue({ success: true, files: [] });
    mockGitRestoreFileFromHead.mockResolvedValue({ success: true });
    mockGitUnstagePath.mockResolvedValue({ success: true });
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

  describe('parseItemPosition', () => {
    it('parses a 4-level Subtask id into a full position (with subtask)', () => {
      // EXECUTE + VERIFY
      expect(parseItemPosition('P1.M2.T1.S1')).toEqual({
        phase: 1,
        milestone: 2,
        task: 1,
        subtask: 1,
      });
    });

    it('parses a multi-digit 4-level id', () => {
      // EXECUTE + VERIFY
      expect(parseItemPosition('P3.M1.T2.S4')).toEqual({
        phase: 3,
        milestone: 1,
        task: 2,
        subtask: 4,
      });
    });

    it('parses a 3-level Task id into a position WITHOUT a subtask key (trailing-level elision)', () => {
      // EXECUTE
      const parsed = parseItemPosition('P1.M2.T1');

      // VERIFY — exact shape (no subtask key) for toEqual, plus an explicit
      // assertion that subtask is absent (guards trailing-level elision).
      expect(parsed).toEqual({ phase: 1, milestone: 2, task: 1 });
      expect(parsed?.subtask).toBeUndefined();
    });

    it('parses a bugfix-session Subtask id (own numbering, no special-casing) — BUG-003 S3', () => {
      // EXECUTE + VERIFY — bugfix sessions have their OWN P/M/T/S ids (this
      // item's own id, P1.M3.T2.S1, is a bugfix-session id). It parses cleanly
      // to the CURRENT session's indices — no remapping to a parent session.
      expect(parseItemPosition('P1.M3.T2.S1')).toEqual({
        phase: 1,
        milestone: 3,
        task: 2,
        subtask: 1,
      });
      expect(buildTaskPrefix(parseItemPosition('P1.M3.T2.S1')!)).toBe(
        '1.3.2.1'
      );
    });

    it.each([
      'garbage', // not an id at all
      'P1.M2', // too few segments
      'P1.M2.T1.S1.X', // extra segment
      '', // empty string
      'p1.m2.t1.s1', // lowercase (case-SENSITIVE)
    ])('returns null for a non-matching id %r', id => {
      // EXECUTE + VERIFY
      expect(parseItemPosition(id)).toBeNull();
    });
  });

  describe('buildTaskPrefix', () => {
    it('renders a 4-level position as p.m.t.s', () => {
      // EXECUTE + VERIFY
      expect(
        buildTaskPrefix({ phase: 1, milestone: 2, task: 1, subtask: 1 })
      ).toBe('1.2.1.1');
    });

    it('renders a multi-digit 4-level position', () => {
      // EXECUTE + VERIFY
      expect(
        buildTaskPrefix({ phase: 3, milestone: 1, task: 2, subtask: 4 })
      ).toBe('3.1.2.4');
    });

    it("ELIDES the absent trailing level for a 3-level position (never '1.2.1.0')", () => {
      // EXECUTE
      const prefix = buildTaskPrefix({ phase: 1, milestone: 2, task: 1 });

      // VERIFY — elision: no trailing .0
      expect(prefix).toBe('1.2.1');
      expect(prefix).not.toBe('1.2.1.0');
    });
  });

  describe('formatCommitMessage', () => {
    // The env-branch cases (task-prefix vs plain) need a clean env each run so
    // a leftover vi.stubEnv(PRP_COMMIT_FORMAT,'plain') from a prior test can't
    // flip the next task-prefix case to plain. Mirrors the harness in
    // tests/unit/config/prp-commit-format.test.ts. Nested hooks run AFTER the
    // outer file-wide beforeEach (which does vi.clearAllMocks + spies cwd).
    beforeEach(() => {
      delete process.env.PRP_COMMIT_FORMAT;
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('no position (non-backlog) → plain subject + trailer (NO [PRP Auto])', () => {
      // EXECUTE
      const result = formatCommitMessage('cleanup: doc reorganization');

      // VERIFY — bare subject, trailer present, NEVER [PRP Auto]
      expect(result).toBe(
        'cleanup: doc reorganization\n\nCo-Authored-By: Claude <noreply@anthropic.com>'
      );
      expect(result).not.toContain('[PRP Auto]');
    });

    it('null position → plain subject + trailer (position explicitly null)', () => {
      // EXECUTE
      const result = formatCommitMessage('msg', null);

      // VERIFY
      expect(result).toBe(
        'msg\n\nCo-Authored-By: Claude <noreply@anthropic.com>'
      );
      expect(result).not.toContain('[PRP Auto]');
    });

    it('position + env UNSET (task-prefix DEFAULT) → 4-level prefix: <p.m.t.s>: <msg> + trailer', () => {
      // EXECUTE
      const result = formatCommitMessage('add utility', {
        phase: 1,
        milestone: 2,
        task: 1,
        subtask: 1,
      });

      // VERIFY
      expect(result).toBe(
        '1.2.1.1: add utility\n\nCo-Authored-By: Claude <noreply@anthropic.com>'
      );
      expect(result).not.toContain('[PRP Auto]');
    });

    it('position + env UNSET (task-prefix DEFAULT) → 3-level prefix with ELISION', () => {
      // EXECUTE
      const result = formatCommitMessage('build CLI entry point', {
        phase: 1,
        milestone: 2,
        task: 1,
      });

      // VERIFY — trailing level elided (1.2.1, never 1.2.1.0)
      expect(result).toBe(
        '1.2.1: build CLI entry point\n\nCo-Authored-By: Claude <noreply@anthropic.com>'
      );
      expect(result).not.toContain('[PRP Auto]');
    });

    it('position + PRP_COMMIT_FORMAT=plain → plain (position IGNORED) + trailer', () => {
      // SETUP
      vi.stubEnv('PRP_COMMIT_FORMAT', 'plain');

      // EXECUTE
      const result = formatCommitMessage('add utility', {
        phase: 1,
        milestone: 2,
        task: 1,
        subtask: 1,
      });

      // VERIFY — plain opt-out: position supplied but ignored
      expect(result).toBe(
        'add utility\n\nCo-Authored-By: Claude <noreply@anthropic.com>'
      );
      expect(result).not.toContain('[PRP Auto]');
    });

    it('position + PRP_COMMIT_FORMAT=task-prefix (explicit default honored) → prefix + trailer', () => {
      // SETUP
      vi.stubEnv('PRP_COMMIT_FORMAT', 'task-prefix');

      // EXECUTE
      const result = formatCommitMessage('add utility', {
        phase: 1,
        milestone: 2,
        task: 1,
        subtask: 1,
      });

      // VERIFY
      expect(result).toBe(
        '1.2.1.1: add utility\n\nCo-Authored-By: Claude <noreply@anthropic.com>'
      );
    });

    it("DEFENSE-IN-DEPTH: strips a leading '[PRP Auto] ' banner from the message", () => {
      // EXECUTE — message starts with the forbidden banner; the formatter must
      // strip it so a stray banner from any caller/LLM can never reach history.
      const result = formatCommitMessage('[PRP Auto] msg', {
        phase: 1,
        milestone: 2,
        task: 1,
        subtask: 1,
      });

      // VERIFY — banner is gone; task-prefix applied to the stripped subject
      expect(result).not.toContain('[PRP Auto]');
      expect(result).toBe(
        '1.2.1.1: msg\n\nCo-Authored-By: Claude <noreply@anthropic.com>'
      );
    });

    it('PRESERVES the Co-Authored-By trailer in EVERY output (both modes)', () => {
      // EXECUTE a representative cross-section of both modes + the strip path.
      const results = [
        formatCommitMessage('plain msg'),
        formatCommitMessage('prefixed msg', {
          phase: 1,
          milestone: 2,
          task: 1,
          subtask: 1,
        }),
        formatCommitMessage('[PRP Auto] stripped msg', null),
      ];

      // VERIFY — trailer present in every output
      for (const result of results) {
        expect(result).toContain(
          'Co-Authored-By: Claude <noreply@anthropic.com>'
        );
        // And NEVER the banner
        expect(result).not.toContain('[PRP Auto]');
      }
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
            'Test commit\n\nCo-Authored-By: Claude <noreply@anthropic.com>',
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

      it('should return null when gitCommit succeeds but returns no commitHash', async () => {
        // SETUP — gitCommit reports success:true but omits commitHash. Covers
        // the `commitResult.commitHash ?? null` null arm.
        mockGitStatus.mockResolvedValue({
          success: true,
          modified: ['src/index.ts'],
        });
        mockGitAdd.mockResolvedValue({ success: true, stagedCount: 1 });
        mockGitCommit.mockResolvedValue({ success: true }); // no commitHash

        // EXECUTE
        const result = await smartCommit('/project', 'Test commit');

        // VERIFY — commitHash ?? null → null returned.
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

    // =======================================================================
    // STYLE RESOLUTION (PRP_COMMIT_STYLE) — P1.M1.T4.S1.
    // Proves generateCommitMessage resolves the configured PRP_COMMIT_STYLE,
    // fetches recent-commit examples only under `auto` + a positive example
    // count, degrades to plain when there is nothing to learn, and threads
    // the resolved style into createCommitMessageAgent via
    // buildCommitMessageSystemPrompt. The builder's PROMPT CONTENT is owned by
    // its own unit test (commit-message-agent.test.ts); here we assert the
    // WIRING via a MOCK[<style>] sentinel returned by a mocked builder.
    // =======================================================================
    describe('style resolution (PRP_COMMIT_STYLE)', () => {
      // Env hygiene: the style getters read PRP_COMMIT_STYLE /
      // PRP_COMMIT_STYLE_EXAMPLES at call time, so a stubbed env from a prior
      // case must not bleed into the next. Nested hooks run AFTER the
      // outer file-wide beforeEach (which clears mocks + defaults
      // getRecentCommitMessages to []). Mirrors the formatCommitMessage harness.
      beforeEach(() => {
        delete process.env.PRP_COMMIT_STYLE;
        delete process.env.PRP_COMMIT_STYLE_EXAMPLES;
      });

      afterEach(() => {
        vi.unstubAllEnvs();
      });

      it('auto + >1 example → fetches N (default 5), factory receives the auto (learned-style) contract', async () => {
        // SETUP — env unset → auto + default EXAMPLES=5. Provide >1 example so
        // resolvedStyle stays 'auto' and the builder is called with 'auto'.
        mockGetRecentCommitMessages.mockResolvedValue([
          'feat: a',
          'fix: b',
          'chore: c',
        ]);
        mockBuildCommitMessageSystemPrompt.mockImplementation(
          s => `MOCK[${s}]` as string
        );
        mockCreateCommitMessageAgent.mockReturnValue(
          makeFakeAgent({ status: 'success', data: 'msg', error: null })
        );

        // EXECUTE
        await generateCommitMessage('diff text');

        // VERIFY — git-log fetched exactly once with the default N=5; the
        // factory received the auto contract (NOT degraded to plain).
        expect(mockGetRecentCommitMessages).toHaveBeenCalledTimes(1);
        expect(mockGetRecentCommitMessages).toHaveBeenCalledWith(5);
        expect(mockCreateCommitMessageAgent).toHaveBeenCalledWith('MOCK[auto]');
      });

      it('auto + ≤1 example → degrades to plain; factory receives the plain contract', async () => {
        // SETUP — env unset → auto, but the repo has only 1 commit → nothing
        // to learn → resolvedStyle degrades to plain (PRD §5.1).
        mockGetRecentCommitMessages.mockResolvedValue(['only commit']);
        mockBuildCommitMessageSystemPrompt.mockImplementation(
          s => `MOCK[${s}]` as string
        );
        mockCreateCommitMessageAgent.mockReturnValue(
          makeFakeAgent({ status: 'success', data: 'msg', error: null })
        );

        // EXECUTE
        await generateCommitMessage('diff text');

        // VERIFY — git-log WAS called (auto + N>0), but ≤1 example flipped
        // resolvedStyle to plain, so the factory received the plain contract.
        expect(mockGetRecentCommitMessages).toHaveBeenCalledTimes(1);
        expect(mockCreateCommitMessageAgent).toHaveBeenCalledWith(
          'MOCK[plain]'
        );
      });

      it('auto + PRP_COMMIT_STYLE_EXAMPLES=0 → NO git-log call, degrades to plain', async () => {
        // SETUP — learning disabled (EXAMPLES=0). The n>0 gate skips the
        // git-log call entirely; examples stays undefined → degrade to plain.
        vi.stubEnv('PRP_COMMIT_STYLE_EXAMPLES', '0'); // PRP_COMMIT_STYLE unset → auto
        mockGetRecentCommitMessages.mockResolvedValue([
          'feat: a',
          'fix: b',
          'chore: c',
        ]); // would be enough to learn, but must NOT be called
        mockBuildCommitMessageSystemPrompt.mockImplementation(
          s => `MOCK[${s}]` as string
        );
        mockCreateCommitMessageAgent.mockReturnValue(
          makeFakeAgent({ status: 'success', data: 'msg', error: null })
        );

        // EXECUTE
        await generateCommitMessage('diff text');

        // VERIFY — git-log NEVER called (EXAMPLES=0 → n>0 gate skips it);
        // resolvedStyle degraded to plain.
        expect(mockGetRecentCommitMessages).not.toHaveBeenCalled();
        expect(mockCreateCommitMessageAgent).toHaveBeenCalledWith(
          'MOCK[plain]'
        );
      });

      it('PRP_COMMIT_STYLE=plain → skips git log, factory receives the plain contract', async () => {
        // SETUP — explicit plain: history is ignored entirely.
        vi.stubEnv('PRP_COMMIT_STYLE', 'plain');
        mockBuildCommitMessageSystemPrompt.mockImplementation(
          s => `MOCK[${s}]` as string
        );
        mockCreateCommitMessageAgent.mockReturnValue(
          makeFakeAgent({ status: 'success', data: 'msg', error: null })
        );

        // EXECUTE
        await generateCommitMessage('diff text');

        // VERIFY
        expect(mockGetRecentCommitMessages).not.toHaveBeenCalled();
        expect(mockCreateCommitMessageAgent).toHaveBeenCalledWith(
          'MOCK[plain]'
        );
      });

      it('PRP_COMMIT_STYLE=conventional → skips git log, factory receives the conventional contract', async () => {
        // SETUP — explicit conventional: history ignored.
        vi.stubEnv('PRP_COMMIT_STYLE', 'conventional');
        mockBuildCommitMessageSystemPrompt.mockImplementation(
          s => `MOCK[${s}]` as string
        );
        mockCreateCommitMessageAgent.mockReturnValue(
          makeFakeAgent({ status: 'success', data: 'feat: x', error: null })
        );

        // EXECUTE
        await generateCommitMessage('diff text');

        // VERIFY
        expect(mockGetRecentCommitMessages).not.toHaveBeenCalled();
        expect(mockCreateCommitMessageAgent).toHaveBeenCalledWith(
          'MOCK[conventional]'
        );
      });

      it('PRP_COMMIT_STYLE=gitmoji → skips git log, factory receives the gitmoji contract', async () => {
        // SETUP — explicit gitmoji: history ignored.
        vi.stubEnv('PRP_COMMIT_STYLE', 'gitmoji');
        mockBuildCommitMessageSystemPrompt.mockImplementation(
          s => `MOCK[${s}]` as string
        );
        mockCreateCommitMessageAgent.mockReturnValue(
          makeFakeAgent({
            status: 'success',
            data: ':sparkles: x',
            error: null,
          })
        );

        // EXECUTE
        await generateCommitMessage('diff text');

        // VERIFY
        expect(mockGetRecentCommitMessages).not.toHaveBeenCalled();
        expect(mockCreateCommitMessageAgent).toHaveBeenCalledWith(
          'MOCK[gitmoji]'
        );
      });

      it('auto + PRP_COMMIT_STYLE_EXAMPLES=3 → git-log called once with 3', async () => {
        // SETUP — custom example count threads through to the git-log call.
        vi.stubEnv('PRP_COMMIT_STYLE_EXAMPLES', '3'); // PRP_COMMIT_STYLE unset → auto
        mockGetRecentCommitMessages.mockResolvedValue(['a', 'b', 'c']); // >1 → stays auto
        mockBuildCommitMessageSystemPrompt.mockImplementation(
          s => `MOCK[${s}]` as string
        );
        mockCreateCommitMessageAgent.mockReturnValue(
          makeFakeAgent({ status: 'success', data: 'msg', error: null })
        );

        // EXECUTE
        await generateCommitMessage('diff text');

        // VERIFY — the custom EXAMPLES count threads through to the git-log
        // call; resolvedStyle stays auto (>1 example).
        expect(mockGetRecentCommitMessages).toHaveBeenCalledTimes(1);
        expect(mockGetRecentCommitMessages).toHaveBeenCalledWith(3);
        expect(mockCreateCommitMessageAgent).toHaveBeenCalledWith('MOCK[auto]');
      });
    });
  });

  // ===========================================================================
  // STAGECOACH GENERATION PATH: smartCommit({ generateMessage: true })
  // (PRP P3.M1.T3.S1) — opt-in 3rd param. Default path stays byte-identical.
  // ===========================================================================
  describe('smartCommit generateMessage option', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

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
      // wrapped via formatCommitMessage (plain subject + Co-Authored-By
      // trailer, no [PRP Auto] — default path emits plain until S3 threads a
      // position).
      expect(result).toBe('abc123');
      expect(mockGitDiff).toHaveBeenCalledWith({
        path: '/project',
        staged: true,
      });
      expect(mockGitCommit).toHaveBeenCalledWith({
        path: '/project',
        message:
          'feat(api): add endpoint\n\nCo-Authored-By: Claude <noreply@anthropic.com>',
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

    it('generateCommitMessage throws after retries → FALLBACK placeholder commit made (PRD §5.1)', async () => {
      // SETUP — agent status error → generateCommitMessage throws AgentError.
      // Disable the retry loop (1 attempt = no retries) so the boundary is
      // called once and the test stays fast (no 10s backoff sleeps). P3.M1.T4.S1
      // wraps generateCommitMessage in a bounded retry; with COMMIT_RETRY_MAX=1
      // the exhausted-retry throw propagates to the INNER catch (P3.M1.T4.S2),
      // which now makes a FALLBACK placeholder commit instead of returning null.
      vi.stubEnv('COMMIT_RETRY_MAX', '1');
      vi.stubEnv('COMMIT_RETRY_DELAY', '1');
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
      // The fallback gitCommit succeeds → returns the fallback hash.
      mockGitCommit.mockResolvedValue({
        success: true,
        commitHash: 'fb000',
      });

      // EXECUTE — smartCommit now makes a fallback commit (not null).
      const result = await smartCommit('/project', 'fallback', {
        generateMessage: true,
      });

      // VERIFY — fallback commit made with the labeled placeholder. The
      // staged substance is preserved (never stranded). The placeholder is
      // wrapped via formatCommitMessage (plain subject + Co-Authored-By
      // trailer, no [PRP Auto] — non-backlog fallback degrades to plain per
      // PRD §5.1). 'exit N' uses the sentinel 0 (LLM-API failures have no
      // subprocess exit code).
      expect(result).toBe('fb000');
      expect(mockGitCommit).toHaveBeenCalledTimes(1);
      expect(mockGitCommit).toHaveBeenCalledWith({
        path: '/project',
        message: expect.stringMatching(
          /chore: commit-gen failed \(exit \d+\); fallback commit[\s\S]*Co-Authored-By: Claude/
        ),
      });
      // A warn log is emitted naming the fallback (NOT the outer 'Unexpected
      // error' log — the fallback path never reaches the outer catch).
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringMatching(/falling back to placeholder commit/i)
      );
      expect(mockLogger.error).not.toHaveBeenCalledWith(
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
          'Pre-formatted message\n\nCo-Authored-By: Claude <noreply@anthropic.com>',
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

    it('gitDiff success but missing diff field → empty-diff throws → FALLBACK placeholder commit (PRD §5.1)', async () => {
      // SETUP — gitDiff returns success:true but no `diff` string. smartCommit
      // passes `diffResult.diff ?? ''` to generateCommitMessage, which throws
      // AgentError on the empty diff. With S2, that throw propagates through
      // the retry (exhausted at 1 attempt) to the INNER catch → fallback
      // placeholder commit (the staged substance is preserved).
      // Disable the retry loop so the boundary is called once and the test
      // stays fast (no backoff sleeps).
      vi.stubEnv('COMMIT_RETRY_MAX', '1');
      vi.stubEnv('COMMIT_RETRY_DELAY', '1');
      mockGitStatus.mockResolvedValue({
        success: true,
        modified: ['src/index.ts'],
      });
      mockGitAdd.mockResolvedValue({ success: true, stagedCount: 1 });
      mockGitDiff.mockResolvedValue({ success: true }); // no diff field
      mockGitCommit.mockResolvedValue({
        success: true,
        commitHash: 'fb-empty',
      });

      // EXECUTE
      const result = await smartCommit('/project', 'fallback', {
        generateMessage: true,
      });

      // VERIFY — the empty-diff AgentError propagates through retry → INNER
      // catch → fallback placeholder commit (NOT null).
      expect(result).toBe('fb-empty');
      expect(mockGitCommit).toHaveBeenCalledTimes(1);
      // The agent factory is never called (generateCommitMessage throws on the
      // empty diff BEFORE instantiating the agent).
      expect(mockCreateCommitMessageAgent).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringMatching(/falling back to placeholder commit/i)
      );
    });

    it('PRD §5.1 retry: transient error retried, succeeds on 3rd attempt → commit created, gitDiff called once', async () => {
      // SETUP — P3.M1.T4.S1 wraps generateCommitMessage in a bounded retry loop.
      // Lower the delays so the backoff sleeps are ~1ms instead of 10s/120s
      // (CRITICAL for test speed). The agent's prompt() throws a transient
      // AgentError on the first 2 calls then succeeds on the 3rd → retry loops
      // twice and returns the 3rd result → smartCommit commits it.
      vi.stubEnv('COMMIT_RETRY_MAX', '3');
      vi.stubEnv('COMMIT_RETRY_DELAY', '1');
      vi.stubEnv('COMMIT_RETRY_DELAY_CAP', '1');
      mockGitStatus.mockResolvedValue({
        success: true,
        modified: ['src/index.ts'],
      });
      mockGitAdd.mockResolvedValue({ success: true, stagedCount: 1 });
      mockGitDiff.mockResolvedValue({
        success: true,
        diff: 'diff --git a/a.ts b/a.ts\n+export const x = 1;',
      });
      // Build a fake agent, then rewire its .prompt() to throw twice then
      // succeed. makeFakeAgent returns { prompt: vi.fn().mockResolvedValue(r) }.
      const fakeAgent = makeFakeAgent({
        status: 'success',
        data: 'feat: retry works',
        error: null,
      });
      const mockPrompt = vi.mocked(fakeAgent.prompt);
      mockPrompt.mockReset();
      mockPrompt
        .mockRejectedValueOnce(
          new AgentError(
            'stagecoach commit-message generation failed: timeout #1'
          )
        )
        .mockRejectedValueOnce(
          new AgentError(
            'stagecoach commit-message generation failed: timeout #2'
          )
        )
        .mockResolvedValueOnce({
          status: 'success',
          data: 'feat: retry works',
          error: null,
        });
      mockCreateCommitMessageAgent.mockReturnValue(fakeAgent);
      mockGitCommit.mockResolvedValue({
        success: true,
        commitHash: 'retry-hash',
      });

      // EXECUTE
      const result = await smartCommit('/project', 'fallback', {
        generateMessage: true,
      });

      // VERIFY — retry succeeded on the 3rd attempt → commit hash returned.
      // The transient AgentErrors are classified retryable by isTransientError
      // (the default RetryOptions.isRetryable), so retry looped.
      expect(result).toBe('retry-hash');
      // The boundary (agent.prompt) was invoked exactly 3 times (2 transient
      // failures + 1 success).
      expect(mockPrompt).toHaveBeenCalledTimes(3);
      // gitDiff is called ONCE (outside the retry closure — the diff is read
      // once and captured; only the LLM call repeats). PRD §5.1: "the index is
      // left untouched."
      expect(mockGitDiff).toHaveBeenCalledTimes(1);
      // The committed message is the 3rd-attempt output, wrapped.
      expect(mockGitCommit).toHaveBeenCalledWith({
        path: '/project',
        message:
          'feat: retry works\n\nCo-Authored-By: Claude <noreply@anthropic.com>',
      });
    });

    it('PRD §5.1 retry: exhausted attempts → FALLBACK placeholder commit (P3.M1.T4.S2)', async () => {
      // SETUP — the agent always throws a transient AgentError. With
      // COMMIT_RETRY_MAX=2 the boundary is attempted twice then the last error
      // propagates → INNER catch (P3.M1.T4.S2) → fallback placeholder commit.
      // Lower the delays for speed.
      vi.stubEnv('COMMIT_RETRY_MAX', '2');
      vi.stubEnv('COMMIT_RETRY_DELAY', '1');
      vi.stubEnv('COMMIT_RETRY_DELAY_CAP', '1');
      mockGitStatus.mockResolvedValue({
        success: true,
        modified: ['src/index.ts'],
      });
      mockGitAdd.mockResolvedValue({ success: true, stagedCount: 1 });
      mockGitDiff.mockResolvedValue({ success: true, diff: 'diff text' });
      const fakeAgent = makeFakeAgent({
        status: 'success',
        data: 'unused',
        error: null,
      });
      const mockPrompt = vi.mocked(fakeAgent.prompt);
      mockPrompt.mockReset();
      mockPrompt.mockRejectedValue(
        new AgentError(
          'stagecoach commit-message generation failed: always fails'
        )
      );
      mockCreateCommitMessageAgent.mockReturnValue(fakeAgent);
      // The fallback gitCommit succeeds → returns the fallback hash.
      mockGitCommit.mockResolvedValue({
        success: true,
        commitHash: 'fallback-hash',
      });

      // EXECUTE
      const result = await smartCommit('/project', 'fallback', {
        generateMessage: true,
      });

      // VERIFY — retry exhausted both attempts, then the last AgentError
      // propagated to smartCommit's INNER catch → fallback placeholder commit
      // (the staged substance is preserved, never stranded — PRD §5.1).
      expect(result).toBe('fallback-hash');
      expect(mockPrompt).toHaveBeenCalledTimes(2);
      expect(mockGitCommit).toHaveBeenCalledTimes(1);
      expect(mockGitDiff).toHaveBeenCalledTimes(1); // read once outside retry
      expect(mockGitCommit).toHaveBeenCalledWith({
        path: '/project',
        message: expect.stringMatching(
          /chore: commit-gen failed \(exit \d+\); fallback commit/
        ),
      });
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringMatching(/falling back to placeholder commit/i)
      );
    });

    it('fallback commit: gitCommit ALSO fails → returns null (never-fail-on-commit)', async () => {
      // SETUP — agent status error → retry exhausts (1 attempt) → INNER catch
      // → fallback placeholder commit attempted, BUT gitCommit itself fails
      // (e.g. disk full). smartCommit must return null (never-fail-on-commit).
      vi.stubEnv('COMMIT_RETRY_MAX', '1');
      vi.stubEnv('COMMIT_RETRY_DELAY', '1');
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
      // The fallback gitCommit FAILS → smartCommit returns null.
      mockGitCommit.mockResolvedValue({
        success: false,
        error: 'disk full',
      });

      // EXECUTE
      const result = await smartCommit('/project', 'fallback', {
        generateMessage: true,
      });

      // VERIFY — the fallback gitCommit was attempted (once) but failed → null.
      // The never-fail-on-commit contract is preserved.
      expect(result).toBeNull();
      expect(mockGitCommit).toHaveBeenCalledTimes(1); // the fallback attempt
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringMatching(/falling back/i)
      );
      // The existing commitResult.success-check logs 'Git commit failed: ...'.
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringMatching(/Git commit failed/i)
      );
    });

    // NOTE (permanent-error path): contract item 3c requires the retry to use
    // isTransientError() so permanent errors are NOT retried. We do NOT assert
    // that here via smartCommit because generateCommitMessage ONLY ever throws
    // AgentError (hardcoded code = PIPELINE_AGENT_LLM_FAILED), which
    // isTransientError always classifies transient. Exercising the
    // permanent-error short-circuit through smartCommit would require mocking
    // the boundary to throw a non-transient error, but generateCommitMessage
    // wraps every failure in a transient AgentError. The permanent-error
    // classification is therefore owned + tested by retry.ts's own
    // isTransientError unit tests (unchanged by this task). This test would
    // belong here only if generateCommitMessage gained a permanent failure mode.
  });

  // ===========================================================================
  // SMARTCOMMIT POSITION WIRING (BUG-003 S3 — PRD §5.1): proves
  // options.position flows THROUGH smartCommit → formatCommitMessage →
  // gitCommit so committed subtasks carry the <n.n.n.n>: task-prefix (the
  // DEFAULT) while non-backlog commits degrade to plain. These cover the THREE
  // wrap sites: default path, generateMessage happy path, and generateMessage
  // fallback path.
  // ===========================================================================
  describe('smartCommit position option (BUG-003 S3 wiring)', () => {
    // Task-prefix is the DEFAULT (env unset). A plain-opt-out case below stubs
    // PRP_COMMIT_FORMAT=plain; a nested afterEach unstub prevents env-bleed
    // into the next test (mirrors the formatCommitMessage harness).
    beforeEach(() => {
      delete process.env.PRP_COMMIT_FORMAT;
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('DEFAULT path + position → task-prefix commit message over the verbatim subject', async () => {
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

      // EXECUTE — default path (no generateMessage) WITH a position. The
      // verbatim message gets the task-prefix layered on.
      const result = await smartCommit('/project', 'add utility', {
        position: parseItemPosition('P1.M2.T1.S1'),
      });

      // VERIFY — gitCommit receives the prefixed subject + trailer.
      expect(result).toBe('abc123');
      expect(mockGitCommit).toHaveBeenCalledWith({
        path: '/project',
        message:
          '1.2.1.1: add utility\n\nCo-Authored-By: Claude <noreply@anthropic.com>',
      });
    });

    it('generateMessage happy path + position → task-prefix over the LLM subject', async () => {
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

      // EXECUTE — generateMessage path WITH a position. The LLM subject gets
      // the task-prefix layered on.
      const result = await smartCommit('/project', 'fallback msg', {
        generateMessage: true,
        position: parseItemPosition('P1.M2.T1.S1'),
      });

      // VERIFY — gitCommit receives the prefixed LLM subject + trailer. NO
      // [PRP Auto] banner (the wrap is via formatCommitMessage).
      expect(result).toBe('abc123');
      expect(mockGitCommit).toHaveBeenCalledWith({
        path: '/project',
        message:
          '1.2.1.1: feat(api): add endpoint\n\nCo-Authored-By: Claude <noreply@anthropic.com>',
      });
    });

    it('generateMessage FALLBACK path + position → task-prefix over the placeholder (all wrap sites covered)', async () => {
      // SETUP — agent status error → generateCommitMessage throws AgentError.
      // Disable the retry loop (1 attempt = no retries) for a fast test.
      vi.stubEnv('COMMIT_RETRY_MAX', '1');
      vi.stubEnv('COMMIT_RETRY_DELAY', '1');
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
      mockGitCommit.mockResolvedValue({
        success: true,
        commitHash: 'fb000',
      });

      // EXECUTE — generateMessage path WITH a position, agent always fails →
      // the fallback wrap site ALSO threads position.
      const result = await smartCommit('/project', 'fallback', {
        generateMessage: true,
        position: parseItemPosition('P1.M2.T1.S1'),
      });

      // VERIFY — the fallback placeholder gets the task-prefix START.
      expect(result).toBe('fb000');
      expect(mockGitCommit).toHaveBeenCalledWith({
        path: '/project',
        message: expect.stringContaining(
          '1.2.1.1: chore: commit-gen failed (exit 0); fallback commit'
        ),
      });
    });

    it('position null → plain commit message (regression: non-backlog degrades to plain)', async () => {
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

      // EXECUTE — position explicitly null (e.g. a malformed subtask.id →
      // parseItemPosition returns null). Must degrade to plain.
      const result = await smartCommit('/project', 'add utility', {
        position: null,
      });

      // VERIFY — plain subject + trailer (no prefix, no [PRP Auto]).
      expect(result).toBe('abc123');
      const call = mockGitCommit.mock.calls[0]?.[0] as
        | { message?: string }
        | undefined;
      expect(call?.message).toBe(
        'add utility\n\nCo-Authored-By: Claude <noreply@anthropic.com>'
      );
      expect(call?.message).not.toContain('[PRP Auto]');
    });

    it('position + PRP_COMMIT_FORMAT=plain → plain (opt-out overrides position)', async () => {
      // SETUP — opt-out of the task-prefix even when a position is supplied.
      vi.stubEnv('PRP_COMMIT_FORMAT', 'plain');
      mockGitStatus.mockResolvedValue({
        success: true,
        modified: ['src/index.ts'],
      });
      mockGitAdd.mockResolvedValue({ success: true, stagedCount: 1 });
      mockGitCommit.mockResolvedValue({
        success: true,
        commitHash: 'abc123',
      });

      // EXECUTE
      const result = await smartCommit('/project', 'add utility', {
        position: parseItemPosition('P1.M2.T1.S1'),
      });

      // VERIFY — plain despite the position (format=plain wins).
      expect(result).toBe('abc123');
      const call = mockGitCommit.mock.calls[0]?.[0] as
        | { message?: string }
        | undefined;
      expect(call?.message).toBe(
        'add utility\n\nCo-Authored-By: Claude <noreply@anthropic.com>'
      );
    });
  });

  // ===========================================================================
  // LAST-RESORT FALLBACK PLACEHOLDER BUILDER: buildFallbackCommitMessage
  // (PRP P3.M1.T4.S2) — the pure string builder for the PRD §5.1 placeholder.
  // ===========================================================================
  describe('buildFallbackCommitMessage', () => {
    it('uses the sentinel 0 exit code for an AgentError without context.exitCode', () => {
      // SETUP — a typical AgentError thrown by generateCommitMessage (no
      // exitCode; LLM-API failures have no subprocess exit code).
      const error = new AgentError('model overloaded');

      // EXECUTE
      const message = buildFallbackCommitMessage(error);

      // VERIFY — PRD §5.1 placeholder shape with the sentinel 0.
      expect(message).toBe(
        'chore: commit-gen failed (exit 0); fallback commit'
      );
    });

    it('uses context.exitCode when the AgentError carries one (future-proofing)', () => {
      // SETUP — a future error type (e.g. an exit-124 watchdog error from
      // P3.M2.T2) may carry context.exitCode. The helper reads it.
      const error = new AgentError('watchdog killed process', {
        exitCode: 124,
      });

      // EXECUTE
      const message = buildFallbackCommitMessage(error);

      // VERIFY — the context.exitCode is used instead of the sentinel.
      expect(message).toBe(
        'chore: commit-gen failed (exit 124); fallback commit'
      );
    });

    it('uses the sentinel 0 for a non-AgentError thrown value', () => {
      // SETUP — retry() rethrows the bare underlying error. If a non-Agent
      // value is ever thrown, the helper falls back to the sentinel.
      const error: unknown = new Error('something else');

      // EXECUTE
      const message = buildFallbackCommitMessage(error);

      // VERIFY
      expect(message).toBe(
        'chore: commit-gen failed (exit 0); fallback commit'
      );
    });

    it('ignores a non-numeric context.exitCode (sentinel fallback)', () => {
      // SETUP — context.exitCode present but not a number → sentinel used.
      const error = new AgentError('bad context', { exitCode: 'oops' });

      // EXECUTE
      const message = buildFallbackCommitMessage(error);

      // VERIFY — non-numeric exitCode is ignored, sentinel 0 used.
      expect(message).toBe(
        'chore: commit-gen failed (exit 0); fallback commit'
      );
    });
  });

  // ===========================================================================
  // CRITICAL-FILE DELETION PROTECTION (PRD §5.1, mechanical layer —
  // P3.M2.T4.S2): restore_critical_files + smartCommit invocation wiring.
  // ===========================================================================
  describe('restore_critical_files', () => {
    it('no-ops when gitListStagedDeletions returns no files', async () => {
      // SETUP — no staged deletions
      mockGitListStagedDeletions.mockResolvedValue({
        success: true,
        files: [],
      });

      // EXECUTE
      await restore_critical_files('/project');

      // VERIFY — neither restore nor unstage is called
      expect(mockGitListStagedDeletions).toHaveBeenCalledWith('/project');
      expect(mockGitRestoreFileFromHead).not.toHaveBeenCalled();
      expect(mockGitUnstagePath).not.toHaveBeenCalled();
    });

    it('no-ops when gitListStagedDeletions fails (non-fatal)', async () => {
      // SETUP — list failed; function must not throw and must not call helpers
      mockGitListStagedDeletions.mockResolvedValue({
        success: false,
        error: 'git diff failed',
      });

      // EXECUTE
      await restore_critical_files('/project');

      // VERIFY
      expect(mockGitRestoreFileFromHead).not.toHaveBeenCalled();
      expect(mockGitUnstagePath).not.toHaveBeenCalled();
    });

    it('restores a staged PRD.md deletion from HEAD via checkout', async () => {
      // SETUP — root PRD.md staged as deletion, exists in HEAD → restore
      mockGitListStagedDeletions.mockResolvedValue({
        success: true,
        files: ['PRD.md'],
      });
      mockGitRestoreFileFromHead.mockResolvedValue({ success: true });

      // EXECUTE
      await restore_critical_files('/project');

      // VERIFY — restored via checkout, unstage NOT attempted
      expect(mockGitRestoreFileFromHead).toHaveBeenCalledWith(
        'PRD.md',
        '/project'
      );
      expect(mockGitUnstagePath).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringMatching(/Restored critical file from HEAD.*PRD\.md/)
      );
    });

    it('restores a nested PRP.md deletion from HEAD via checkout', async () => {
      // SETUP — a plan/.../PRP.md staged as deletion, exists in HEAD
      const prpPath = 'plan/008_x/P3M2T4S2/PRP.md';
      mockGitListStagedDeletions.mockResolvedValue({
        success: true,
        files: [prpPath],
      });
      mockGitRestoreFileFromHead.mockResolvedValue({ success: true });

      // EXECUTE
      await restore_critical_files('/project');

      // VERIFY — basename match catches the nested PRP.md
      expect(mockGitRestoreFileFromHead).toHaveBeenCalledWith(
        prpPath,
        '/project'
      );
      expect(mockGitUnstagePath).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringMatching(/Restored critical file from HEAD.*PRP\.md/)
      );
    });

    it('unstages a PRP.md deletion not in HEAD (created-and-deleted)', async () => {
      // SETUP — restore-from-HEAD FAILS (path absent from HEAD → git.checkout
      // fails), so the function falls back to unstaging via reset.
      const prpPath = 'plan/x/PRP.md';
      mockGitListStagedDeletions.mockResolvedValue({
        success: true,
        files: [prpPath],
      });
      mockGitRestoreFileFromHead.mockResolvedValue({
        success: false,
        error: 'pathspec did not match',
      });
      mockGitUnstagePath.mockResolvedValue({ success: true });

      // EXECUTE
      await restore_critical_files('/project');

      // VERIFY — unstage via reset called; restore was attempted first
      expect(mockGitRestoreFileFromHead).toHaveBeenCalledWith(
        prpPath,
        '/project'
      );
      expect(mockGitUnstagePath).toHaveBeenCalledWith(prpPath, '/project');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringMatching(/Unstaged critical file deletion.*not in HEAD/)
      );
    });

    it('leaves non-critical deletions staged (neither restore nor unstage)', async () => {
      // SETUP — src/foo.ts is staged-as-deleted but is NOT a critical file
      mockGitListStagedDeletions.mockResolvedValue({
        success: true,
        files: ['src/foo.ts', 'lib/bar.ts'],
      });

      // EXECUTE
      await restore_critical_files('/project');

      // VERIFY — basename match skips non-critical files
      expect(mockGitRestoreFileFromHead).not.toHaveBeenCalled();
      expect(mockGitUnstagePath).not.toHaveBeenCalled();
    });

    it('logs but does not throw when both restore and unstage fail', async () => {
      // SETUP — restore fails AND unstage fails → must log, not throw
      const prpPath = 'plan/x/PRP.md';
      mockGitListStagedDeletions.mockResolvedValue({
        success: true,
        files: [prpPath],
      });
      mockGitRestoreFileFromHead.mockResolvedValue({
        success: false,
        error: 'restore failed',
      });
      mockGitUnstagePath.mockResolvedValue({
        success: false,
        error: 'reset failed',
      });

      // EXECUTE — must NOT throw (never-fail-on-commit contract)
      await expect(restore_critical_files('/project')).resolves.toBeUndefined();

      // VERIFY — both attempted, failure logged
      expect(mockGitRestoreFileFromHead).toHaveBeenCalledWith(
        prpPath,
        '/project'
      );
      expect(mockGitUnstagePath).toHaveBeenCalledWith(prpPath, '/project');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringMatching(/Could not restore\/unstage critical file/)
      );
    });

    it('catches a thrown helper error (non-fatal, logged)', async () => {
      // SETUP — gitRestoreFileFromHead THROWS (not just returns {success:false}).
      // The per-path try/catch must swallow it and continue.
      const prpPath = 'plan/x/PRP.md';
      mockGitListStagedDeletions.mockResolvedValue({
        success: true,
        files: [prpPath],
      });
      mockGitRestoreFileFromHead.mockRejectedValue(new Error('unexpected'));

      // EXECUTE — must NOT throw
      await expect(restore_critical_files('/project')).resolves.toBeUndefined();

      // VERIFY — per-path error logged
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringMatching(/per-path error.*unexpected/)
      );
    });

    it('catches a thrown gitListStagedDeletions error (non-fatal, logged)', async () => {
      // SETUP — the outer try/catch covers a throw from gitListStagedDeletions
      mockGitListStagedDeletions.mockRejectedValue(new Error('list threw'));

      // EXECUTE — must NOT throw
      await expect(restore_critical_files('/project')).resolves.toBeUndefined();

      // VERIFY — aborted, logged
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringMatching(/restore_critical_files: aborted/)
      );
    });

    it('processes a mix of critical and non-critical deletions', async () => {
      // SETUP — mix: PRD.md (critical), src/foo.ts (non-critical), PRP.md (critical)
      mockGitListStagedDeletions.mockResolvedValue({
        success: true,
        files: ['PRD.md', 'src/foo.ts', 'plan/x/PRP.md'],
      });
      mockGitRestoreFileFromHead.mockResolvedValue({ success: true });

      // EXECUTE
      await restore_critical_files('/project');

      // VERIFY — only the two critical files restored; foo.ts left alone
      expect(mockGitRestoreFileFromHead).toHaveBeenCalledTimes(2);
      expect(mockGitRestoreFileFromHead).toHaveBeenCalledWith(
        'PRD.md',
        '/project'
      );
      expect(mockGitRestoreFileFromHead).toHaveBeenCalledWith(
        'plan/x/PRP.md',
        '/project'
      );
    });
  });

  // ===========================================================================
  // smartCommit × restore_critical_files wiring — proves the invocation lands
  // AFTER gitAdd and BEFORE gitDiff/gitCommit (PRD §5.1 ordering).
  // ===========================================================================
  describe('smartCommit restore_critical_files wiring', () => {
    it('invokes restore_critical_files after gitAdd and before gitCommit', async () => {
      // SETUP — default path (no generateMessage). smartCommit stages, then
      // restore_critical_files runs (no-op here), then gitCommit.
      mockGitStatus.mockResolvedValue({
        success: true,
        modified: ['src/index.ts'],
      });
      mockGitAdd.mockResolvedValue({ success: true, stagedCount: 1 });
      mockGitListStagedDeletions.mockResolvedValue({
        success: true,
        files: [],
      });
      mockGitCommit.mockResolvedValue({
        success: true,
        commitHash: 'abc123',
      });

      // EXECUTE
      await smartCommit('/project', 'Test commit');

      // VERIFY — ordering via mock.invocationCallOrder: gitAdd → restore
      // (gitListStagedDeletions) → gitCommit. invocationCallOrder[i] is a
      // monotonically increasing sequence number assigned each time a mock
      // is invoked, so a lower number means an earlier call.
      const addOrder = mockGitAdd.mock.invocationCallOrder[0];
      const restoreOrder =
        mockGitListStagedDeletions.mock.invocationCallOrder[0];
      const commitOrder = mockGitCommit.mock.invocationCallOrder[0];
      expect(addOrder).toBeDefined();
      expect(restoreOrder).toBeDefined();
      expect(commitOrder).toBeDefined();
      expect(addOrder).toBeLessThan(restoreOrder);
      expect(restoreOrder).toBeLessThan(commitOrder);
    });

    it('restore runs BEFORE stagecoach gitDiff on the generateMessage path', async () => {
      // SETUP — stagecoach path: gitDiff({staged:true}) feeds the agent. The
      // restore MUST run before gitDiff so the staged diff reflects the
      // post-restore (deletion-free) staged set.
      mockGitStatus.mockResolvedValue({
        success: true,
        modified: ['src/index.ts'],
      });
      mockGitAdd.mockResolvedValue({ success: true, stagedCount: 1 });
      mockGitListStagedDeletions.mockResolvedValue({
        success: true,
        files: [],
      });
      mockGitDiff.mockResolvedValue({ success: true, diff: 'diff text' });
      mockCreateCommitMessageAgent.mockReturnValue(
        makeFakeAgent({
          status: 'success',
          data: 'feat: x',
          error: null,
        })
      );
      mockGitCommit.mockResolvedValue({
        success: true,
        commitHash: 'abc123',
      });

      // EXECUTE
      await smartCommit('/project', 'fallback', { generateMessage: true });

      // VERIFY — restore (gitListStagedDeletions) runs AFTER gitAdd and
      // BEFORE gitDiff, so stagecoach sees the corrected staged set. Uses
      // mock.invocationCallOrder (monotonic sequence numbers) since this
      // vitest version has no toHaveBeenCalledBefore matcher.
      const addOrder = mockGitAdd.mock.invocationCallOrder[0];
      const restoreOrder =
        mockGitListStagedDeletions.mock.invocationCallOrder[0];
      const diffOrder = mockGitDiff.mock.invocationCallOrder[0];
      const commitOrder = mockGitCommit.mock.invocationCallOrder[0];
      expect(addOrder).toBeLessThan(restoreOrder);
      expect(restoreOrder).toBeLessThan(diffOrder);
      expect(diffOrder).toBeLessThan(commitOrder);
    });

    it('undoes a staged PRP.md deletion during a real smartCommit run', async () => {
      // SETUP — simulate an agent that staged a deletion of a tracked PRP.md.
      // smartCommit must restore it before committing (the deletion is NOT
      // committed). gitStatus reports the PRP.md as modified (the deletion);
      // filterProtectedFiles lets PRP.md through (PRP.md is NOT in
      // PROTECTED_FILES — only the basename match in restore_critical_files
      // catches it). After staging, gitListStagedDeletions reports it, and
      // restore_critical_files restores it from HEAD.
      mockGitStatus.mockResolvedValue({
        success: true,
        modified: ['src/index.ts', 'plan/x/PRP.md'],
      });
      mockGitAdd.mockResolvedValue({ success: true, stagedCount: 2 });
      mockGitListStagedDeletions.mockResolvedValue({
        success: true,
        files: ['plan/x/PRP.md'],
      });
      mockGitRestoreFileFromHead.mockResolvedValue({ success: true });
      mockGitCommit.mockResolvedValue({
        success: true,
        commitHash: 'abc123',
      });

      // EXECUTE
      const result = await smartCommit('/project', 'Test commit');

      // VERIFY — commit succeeds, and the PRP.md deletion was restored
      expect(result).toBe('abc123');
      expect(mockGitRestoreFileFromHead).toHaveBeenCalledWith(
        'plan/x/PRP.md',
        '/project'
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringMatching(/Restored critical file from HEAD.*PRP\.md/)
      );
    });
  });
});
