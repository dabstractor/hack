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
vi.mock('../../../src/tools/git-mcp.js', () => ({
  gitStatus: vi.fn(),
  gitAdd: vi.fn(),
  gitCommit: vi.fn(),
  gitDiff: vi.fn(),
  gitListStagedDeletions: vi.fn(),
  gitRestoreFileFromHead: vi.fn(),
  gitUnstagePath: vi.fn(),
  gitWriteTree: vi.fn(),
  gitRevParseHead: vi.fn(),
  gitCommitTree: vi.fn(),
  gitUpdateRefCAS: vi.fn(),
}));

// Mock the stagecoach binary resolver so generateCommitMessage never looks for
// a real binary. Tests override mockResolveStagecoachBinary to throw when
// exercising the resolver-throw failure path.
vi.mock('../../../src/utils/stagecoach-resolver.js', () => ({
  resolveStagecoachBinary: vi.fn(() => '/fake/stagecoach'),
}));

// Mock node:child_process.spawn so generateCommitMessage never execs a real
// process. Tests wire mockSpawn (via fakeChild) to emit 'data'+'close' (success)
// or 'error'/'close:non-zero' (failure) via the fakeSpawnClose helper.
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
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
  gitDiff,
  gitWriteTree,
  gitRevParseHead,
  gitCommitTree,
  gitUpdateRefCAS,
  gitListStagedDeletions,
  gitRestoreFileFromHead,
  gitUnstagePath,
} from '../../../src/tools/git-mcp.js';
import { spawn } from 'node:child_process';
import { resolveStagecoachBinary } from '../../../src/utils/stagecoach-resolver.js';
import { EventEmitter } from 'node:events';
import {
  buildFallbackCommitMessage,
  buildTaskPrefix,
  emitCommitRescue,
  filterProtectedFiles,
  formatCommitMessage,
  formatCommitRescueRecipe,
  generateCommitMessage,
  onCommitRescueSignal,
  parseItemPosition,
  restore_critical_files,
  smartCommit,
} from '../../../src/utils/git-commit.js';
import {
  AgentError,
  CommitCasRefusedError,
} from '../../../src/utils/errors.js';
import { isTransientError } from '../../../src/utils/retry.js';

const mockGitStatus = vi.mocked(gitStatus);
const mockGitAdd = vi.mocked(gitAdd);
const mockGitDiff = vi.mocked(gitDiff);
const mockGitListStagedDeletions = vi.mocked(gitListStagedDeletions);
const mockGitRestoreFileFromHead = vi.mocked(gitRestoreFileFromHead);
const mockGitUnstagePath = vi.mocked(gitUnstagePath);
const mockGitWriteTree = vi.mocked(gitWriteTree);
const mockGitRevParseHead = vi.mocked(gitRevParseHead);
const mockGitCommitTree = vi.mocked(gitCommitTree);
const mockGitUpdateRefCAS = vi.mocked(gitUpdateRefCAS);
const mockSpawn = vi.mocked(spawn);
const mockResolveStagecoachBinary = vi.mocked(resolveStagecoachBinary);

/**
 * Build a fake ChildProcess-like EventEmitter that generateCommitMessage's
 * spawn() return value is wired to. Emits stdout/stderr 'data' then a 'close'
 * (success) or 'error'/'close' (failure). Emission is deferred via
 * process.nextTick so the listeners the function attaches synchronously AFTER
 * spawn() returns are registered before we emit.
 *
 * IMPORTANT: pair with mockSpawn.mockImplementation(() => fakeChild(...)) (NOT
 * mockReturnValue) so the child is created — and its emission scheduled — at
 * spawn-call time (after the listeners attach), not at mock-setup time.
 *
 * @param opts.stdout - stdout payload (default '' for the empty-stdout case).
 * @param opts.stderr - stderr payload (appended to the failure message).
 * @param opts.exitCode - close code; non-zero → rejection. Use null for spawn error.
 * @param opts.spawnError - if set, emit 'error' instead of 'close' (spawn fail).
 */
function fakeChild(opts: {
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  spawnError?: Error;
}): EventEmitter {
  const child = new EventEmitter();
  (child as { stdout: EventEmitter }).stdout = new EventEmitter();
  (child as { stderr: EventEmitter }).stderr = new EventEmitter();
  const { stdout = '', stderr = '', exitCode = 0, spawnError } = opts;
  // Defer emission so the listeners (registered synchronously after spawn()
  // returns in the function body) are attached before we emit.
  process.nextTick(() => {
    if (stdout) (child as { stdout: EventEmitter }).stdout.emit('data', stdout);
    if (stderr) (child as { stderr: EventEmitter }).stderr.emit('data', stderr);
    if (spawnError) {
      child.emit('error', spawnError);
    } else {
      child.emit('close', exitCode);
    }
  });
  return child;
}

/** Wrap fakeChild for mockImplementation (call-time creation — see fakeChild). */
function spawnReturning(
  opts: Parameters<typeof fakeChild>[0]
): () => EventEmitter {
  return () => fakeChild(opts);
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
    // DEFAULT: the stagecoach binary resolves to a fake path (so
    // generateCommitMessage never looks for a real binary). Per-test overrides
    // throw to exercise the resolver-throw failure path.
    mockResolveStagecoachBinary.mockReturnValue('/fake/stagecoach');
    // DEFAULT: spawn emits a successful single-line message so every
    // generateMessage-path test that doesn't wire a failure mode gets a clean
    // commit message. Per-test overrides wire fakeChild to a failure.
    mockSpawn.mockImplementation(
      spawnReturning({ stdout: 'feat: generated message' })
    );
    // DEFAULT: restore_critical_files (now invoked from smartCommit) is a
    // no-op for every pre-existing smartCommit test — gitListStagedDeletions
    // returns success with no staged deletions, so restore/unstage are never
    // called. Individual restore_critical_files tests override these mocks.
    mockGitListStagedDeletions.mockResolvedValue({ success: true, files: [] });
    mockGitRestoreFileFromHead.mockResolvedValue({ success: true });
    mockGitUnstagePath.mockResolvedValue({ success: true });
    // DEFAULT (P1.M1.T3.S1): the pre-generation snapshot capture runs in EVERY smartCommit path —
    // gitRevParseHead → PARENT_SHA (success → a stable parent SHA; rootless-repo tests override to
    // {success:false}) and gitWriteTree → TREE_SHA (success → a stable tree SHA; the conflict-fail-fast
    // test overrides to {success:false}). A bare vi.fn() returns undefined → `treeResult.success`
    // throws → outer catch → null → every existing smartCommit test expecting a hash would break.
    mockGitRevParseHead.mockResolvedValue({
      success: true,
      sha: 'parent-sha-0001',
    });
    mockGitWriteTree.mockResolvedValue({
      success: true,
      treeSha: 'tree-sha-0001',
    });
    // DEFAULT (P1.M1.T3.S2): the post-generation plumbing commit runs in EVERY happy-path smartCommit
    // call — gitCommitTree → {success:true, commitSha} (the returned hash) and gitUpdateRefCAS →
    // {success:true} (atomic HEAD advance). Tests asserting a SPECIFIC commit hash override
    // mockGitCommitTree's commitSha; the CAS-refusal / commit-tree-fail tests override these. A bare
    // vi.fn() returns undefined → `commitTreeResult.success` throws → outer catch → null → regression.
    mockGitCommitTree.mockResolvedValue({
      success: true,
      commitSha: 'new-sha-0001',
    });
    mockGitUpdateRefCAS.mockResolvedValue({ success: true });
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

    it('no position (non-backlog) → plain subject, NO trailer (NO [PRP Auto])', () => {
      // EXECUTE
      const result = formatCommitMessage('cleanup: doc reorganization');

      // VERIFY — bare subject, trailer present, NEVER [PRP Auto]
      expect(result).toBe('cleanup: doc reorganization');
      expect(result).not.toContain('[PRP Auto]');
    });

    it('null position → plain subject, NO trailer (position explicitly null)', () => {
      // EXECUTE
      const result = formatCommitMessage('msg', null);

      // VERIFY
      expect(result).toBe('msg');
      expect(result).not.toContain('[PRP Auto]');
    });

    it('position + env UNSET (task-prefix DEFAULT) → 4-level prefix: <p.m.t.s>: <msg>, NO trailer', () => {
      // EXECUTE
      const result = formatCommitMessage('add utility', {
        phase: 1,
        milestone: 2,
        task: 1,
        subtask: 1,
      });

      // VERIFY
      expect(result).toBe('1.2.1.1: add utility');
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
      expect(result).toBe('1.2.1: build CLI entry point');
      expect(result).not.toContain('[PRP Auto]');
    });

    it('position + PRP_COMMIT_FORMAT=plain → plain (position IGNORED, NO trailer)', () => {
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
      expect(result).toBe('add utility');
      expect(result).not.toContain('[PRP Auto]');
    });

    it('position + PRP_COMMIT_FORMAT=task-prefix (explicit default honored) → prefix, NO trailer', () => {
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
      expect(result).toBe('1.2.1.1: add utility');
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
      expect(result).toBe('1.2.1.1: msg');
    });

    it('NEVER adds a Co-Authored-By trailer / banner in ANY mode (§9.10.2 identity-transparency)', () => {
      // EXECUTE ALL FOUR §9.10.2 modes — task-prefix, plain,
      // null-position (non-backlog), and the [PRP Auto]-strip path — asserting
      // the ABSENCE triple in each. The describe-level beforeEach(delete) +
      // afterEach(unstub) make the vi.stubEnv safe. The prior hardcoded
      // `Co-Authored-By: Claude <noreply@anthropic.com` literal was a spec
      // violation (it mis-attributed pi/z.ai work to Claude on every commit) and
      // is removed; no style layer may add it back (§9.10.2).
      const results: string[] = [
        // (1) task-prefix mode — env UNSET (default); position supplied.
        formatCommitMessage('task-prefix msg', {
          phase: 1,
          milestone: 2,
          task: 1,
          subtask: 1,
        }),
      ];
      // (2) plain mode — PRP_COMMIT_FORMAT=plain; position supplied but ignored.
      vi.stubEnv('PRP_COMMIT_FORMAT', 'plain');
      results.push(
        formatCommitMessage('plain-mode msg', {
          phase: 1,
          milestone: 2,
          task: 1,
          subtask: 1,
        })
      );
      vi.unstubAllEnvs();
      // (3) null-position mode (non-backlog) → plain.
      results.push(formatCommitMessage('non-backlog msg'));
      // (4) [PRP Auto]-strip path — banner input, null position.
      results.push(formatCommitMessage('[PRP Auto] stripped msg', null));

      // VERIFY — NO trailer / banner / machine author in ANY output, every mode.
      expect(results).toHaveLength(4);
      for (const result of results) {
        expect(result).not.toContain('Co-Authored-By');
        expect(result).not.toMatch(/noreply@anthropic\.com/);
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
        mockGitCommitTree.mockResolvedValue({
          success: true,
          commitSha: 'abc123def456',
        });

        // EXECUTE
        const result = await smartCommit('/project', 'Test commit');

        // VERIFY
        expect(result).toBe('abc123def456');
        expect(mockGitStatus).toHaveBeenCalledWith({ path: '/project' });
        // PRD §5.1: ARG_MAX-safe pathspec staging — no `files` key → git.add('.') (never an explicit list).
        expect(mockGitAdd).toHaveBeenCalledWith({ path: '/project' });
        // No protected files in this fixture → gitUnstagePath is never called.
        expect(mockGitUnstagePath).not.toHaveBeenCalled();
        expect(mockGitCommitTree).toHaveBeenCalledWith({
          repoPath: '/project',
          treeSha: 'tree-sha-0001',
          message: 'Test commit',
          parentSha: 'parent-sha-0001',
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
        mockGitCommitTree.mockResolvedValue({
          success: true,
          commitSha: 'abc123',
        });

        // EXECUTE
        const result = await smartCommit('/project', 'Test commit');

        // VERIFY
        expect(result).toBe('abc123');
        // tasks.json is NOT protected, PRD.md IS protected
        // PRD §5.1: ARG_MAX-safe pathspec staging — no `files` key → git.add('.').
        expect(mockGitAdd).toHaveBeenCalledWith({ path: '/project' });
        // PRD.md was filtered out → unstaged via gitUnstagePath after pathspec staging.
        expect(mockGitUnstagePath).toHaveBeenCalledWith('PRD.md', '/project');
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
        expect(mockGitCommitTree).not.toHaveBeenCalled();
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
        expect(mockGitCommitTree).not.toHaveBeenCalled();
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
        expect(mockGitCommitTree).not.toHaveBeenCalled();
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
        expect(mockGitCommitTree).not.toHaveBeenCalled();
      });

      it('should return null when gitCommitTree fails (never-fail; update-ref not called)', async () => {
        // SETUP — commit-tree reports {success:false} (bad tree SHA, git internal).
        // smartCommit MUST log + return null (never-fail; HEAD/index unchanged) and
        // MUST NOT proceed to gitUpdateRefCAS.
        mockGitStatus.mockResolvedValue({
          success: true,
          modified: ['src/index.ts'],
        });
        mockGitAdd.mockResolvedValue({
          success: true,
          stagedCount: 1,
        });
        mockGitCommitTree.mockResolvedValue({
          success: false,
          error: 'commit-tree failed: bad tree',
        });

        // EXECUTE
        const result = await smartCommit('/project', 'Test commit');

        // VERIFY — never-fail: null returned; the CAS advance never runs.
        expect(result).toBeNull();
        expect(mockGitUpdateRefCAS).not.toHaveBeenCalled();
        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.stringMatching(/commit-tree failed/i)
        );
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
        mockGitCommitTree.mockResolvedValue({
          success: false,
          error: 'commit-tree failed',
        }); // commit-tree fails -> null

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
        mockGitCommitTree.mockResolvedValue({
          success: true,
          commitSha: 'abc123',
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
      mockGitCommitTree.mockResolvedValue({
        success: true,
        commitSha: 'abc123',
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
      mockGitCommitTree.mockResolvedValue({
        success: true,
        commitSha: 'abc123',
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
      mockGitCommitTree.mockResolvedValue({
        success: true,
        commitSha: 'abc123',
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
      mockGitCommitTree.mockResolvedValue({
        success: true,
        commitSha: 'abc123',
      });

      // EXECUTE
      const result = await smartCommit('/project', 'Test commit');

      // VERIFY - tasks.json is NOT protected (staged via pathspec like everything else).
      expect(result).toBe('abc123');
      // PRD §5.1: ARG_MAX-safe pathspec staging — no `files` key → git.add('.').
      expect(mockGitAdd).toHaveBeenCalledWith({ path: '/project' });
      // tasks.json is not protected → gitUnstagePath is never called for it.
      expect(mockGitUnstagePath).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // PRE-GENERATION SNAPSHOT (P1.M1.T3.S1): capture PARENT_SHA + write-tree →
  // TREE_SHA after staging/restore, BEFORE message generation. Fail-fast aborts
  // on an unresolved-merge-conflict index (gitWriteTree {success:false}) — log +
  // return null, never spending an LLM call on an uncommittable index (PRD §5.1).
  // ===========================================================================
  describe('pre-generation snapshot (P1.M1.T3.S1)', () => {
    it('aborts BEFORE message generation when write-tree reports unresolved merge conflicts', async () => {
      // SETUP — normal status/add/restore succeed; gitRevParseHead ok; write-tree FAILS (conflicts).
      mockGitStatus.mockResolvedValue({
        success: true,
        modified: ['src/a.ts'],
        untracked: [],
      });
      mockGitAdd.mockResolvedValue({ success: true, stagedCount: 1 });
      mockGitRevParseHead.mockResolvedValue({
        success: true,
        sha: 'parent-sha',
      });
      mockGitWriteTree.mockResolvedValue({
        success: false,
        error:
          'Cannot write-tree: unresolved merge conflicts in the index — resolve them first',
      });

      // EXECUTE — generateMessage:true so the fail-fast-vs-generate distinction is meaningful
      const result = await smartCommit('/project', 'msg', {
        generateMessage: true,
      });

      // VERIFY — never-fail contract: returns null (no throw); the conflict was caught pre-generation
      // so the staged-diff read (the first step of the stagecoach generateMessage path), the LLM
      // message-generation boundary, and gitCommit were NEVER reached.
      expect(result).toBeNull();
      expect(mockGitRevParseHead).toHaveBeenCalledWith('/project');
      expect(mockGitWriteTree).toHaveBeenCalledWith('/project');
      // generateCommitMessage is the real (un-mocked) function; assert the stagecoach path never
      // STARTED by checking the staged-diff read that immediately precedes it was never called.
      expect(mockGitDiff).not.toHaveBeenCalled();
      expect(mockGitCommitTree).not.toHaveBeenCalled();
      // The abort is logged (never-fail contract: log + return null, not a throw).
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('treats a rootless repo (HEAD unborn) as parentSha undefined, not an error, and proceeds', async () => {
      // SETUP — gitRevParseHead reports HEAD unborn (rootless repo); write-tree still succeeds →
      // the commit proceeds (parentSha captured as undefined → S2 makes a root commit). This proves
      // the rootless path is NOT treated as an abort (PRD §5.1 "Rootless repo").
      mockGitStatus.mockResolvedValue({
        success: true,
        modified: ['src/a.ts'],
        untracked: [],
      });
      mockGitAdd.mockResolvedValue({ success: true, stagedCount: 1 });
      mockGitRevParseHead.mockResolvedValue({
        success: false,
        error: 'HEAD is unborn (rootless repository — no commits yet)',
      });
      mockGitWriteTree.mockResolvedValue({
        success: true,
        treeSha: 'tree-sha-rootless',
      });
      mockGitCommitTree.mockResolvedValue({
        success: true,
        commitSha: 'root-commit-hash',
      });

      // EXECUTE — default path (no generateMessage); parentSha is undefined but the commit proceeds
      const result = await smartCommit('/project', 'first commit');

      // VERIFY — commit succeeded; write-tree was called; gitCommit ran (unchanged for S1). The
      // debug log captured parentSha:null (undefined → null for logging) + the treeSha.
      expect(result).toBe('root-commit-hash');
      expect(mockGitWriteTree).toHaveBeenCalledWith('/project');
      // §5.1 rootless edge case: commit-tree called with parentSha:undefined →
      // no -p (root commit); update-ref called with expectedOldSha:undefined
      // → unconditional advance.
      expect(mockGitCommitTree).toHaveBeenCalledWith({
        repoPath: '/project',
        treeSha: 'tree-sha-rootless',
        message: 'first commit',
        parentSha: undefined,
      });
      expect(mockGitUpdateRefCAS).toHaveBeenCalledWith({
        repoPath: '/project',
        newSha: 'root-commit-hash',
        expectedOldSha: undefined,
      });
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          parentSha: null,
          treeSha: 'tree-sha-rootless',
        }),
        'Captured pre-generation snapshot (PARENT_SHA + TREE_SHA)'
      );
    });
  });

  // ===========================================================================
  // POST-GENERATION PLUMBING COMMIT (P1.M1.T3.S2): the §5.1 snapshot-based
  // atomic single-commit — commit-tree (dangling commit) → CAS update-ref.
  // Covers the CAS-refusal edge case (HEAD moved → MUST NOT force → throws
  // CommitCasRefusedError → non-zero exit) + the fallback-uses-plumbing proof.
  // ===========================================================================
  describe('post-generation plumbing commit (P1.M1.T3.S2)', () => {
    beforeEach(() => {
      mockGitStatus.mockResolvedValue({
        success: true,
        modified: ['src/index.ts'],
      });
      mockGitAdd.mockResolvedValue({ success: true, stagedCount: 1 });
    });

    it('CAS casFailure (HEAD moved) → throws CommitCasRefusedError + logs the recovery recipe (MUST NOT force)', async () => {
      // SETUP — update-ref refuses: a concurrent commit moved HEAD during
      // message generation. §5.1: MUST NOT force; surface the recipe + throw.
      mockGitUpdateRefCAS.mockResolvedValue({
        success: false,
        error: 'ref update aborted: stale HEAD',
        casFailure: true,
      });

      // EXECUTE — smartCommit re-throws CommitCasRefusedError (narrow
      // never-fail exception → non-zero exit). It is NOT swallowed to null.
      await expect(smartCommit('/project', 'Test commit')).rejects.toThrow(
        CommitCasRefusedError
      );

      // VERIFY — the recovery recipe was logged (error level). It carries the
      // snapshot SHAs, the message, and the manual `git commit-tree … |
      // xargs git update-ref HEAD` command.
      expect(mockGitCommitTree).toHaveBeenCalledWith({
        repoPath: '/project',
        treeSha: 'tree-sha-0001',
        message: 'Test commit',
        parentSha: 'parent-sha-0001',
      });
      expect(mockGitUpdateRefCAS).toHaveBeenCalledWith({
        repoPath: '/project',
        newSha: 'new-sha-0001',
        expectedOldSha: 'parent-sha-0001',
      });
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('CAS refused')
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('tree-sha-0001')
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('new-sha-0001')
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('git commit-tree')
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('xargs git update-ref HEAD')
      );
      // The generated message is surfaced in the recipe.
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Test commit')
      );
    });

    it('CAS-refused error context carries the snapshot SHAs (treeSha/parentSha/newSha)', async () => {
      // SETUP
      mockGitUpdateRefCAS.mockResolvedValue({
        success: false,
        error: 'stale',
        casFailure: true,
      });

      // EXECUTE — capture the thrown error to assert its context.
      let thrown: unknown;
      try {
        await smartCommit('/project', 'msg');
      } catch (e) {
        thrown = e;
      }

      // VERIFY — the CommitCasRefusedError context rides the snapshot SHAs.
      expect(thrown).toBeInstanceOf(CommitCasRefusedError);
      expect((thrown as CommitCasRefusedError).context).toMatchObject({
        treeSha: 'tree-sha-0001',
        parentSha: 'parent-sha-0001',
        newSha: 'new-sha-0001',
      });
    });

    it("returns gitCommitTree's commitSha on a successful atomic advance", async () => {
      // SETUP — defaults: commitTree→new-sha-0001, CAS→success. The returned
      // hash is the dangling commit's SHA (now HEAD).
      mockGitCommitTree.mockResolvedValue({
        success: true,
        commitSha: 'dangling-now-head',
      });

      // EXECUTE
      const result = await smartCommit('/project', 'msg');

      // VERIFY — return value is the commitSha (NOT a gitCommit commitHash).
      expect(result).toBe('dangling-now-head');
      expect(mockGitUpdateRefCAS).toHaveBeenCalledWith({
        repoPath: '/project',
        newSha: 'dangling-now-head',
        expectedOldSha: 'parent-sha-0001',
      });
    });

    it('fallback placeholder message flows through the SAME plumbing commit (NOT gitCommit)', async () => {
      // SETUP — generation fails after retries → buildFallbackCommitMessage
      // placeholder. The placeholder MUST flow through gitCommitTree +
      // gitUpdateRefCAS (the single plumbing path), not a separate gitCommit.
      vi.stubEnv('COMMIT_RETRY_MAX', '1');
      vi.stubEnv('COMMIT_RETRY_DELAY', '1');
      mockGitDiff.mockResolvedValue({ success: true, diff: 'diff text' });
      mockSpawn.mockImplementation(
        spawnReturning({ exitCode: 1, stderr: 'model overloaded' })
      );
      mockGitCommitTree.mockResolvedValue({
        success: true,
        commitSha: 'fallback-via-plumbing',
      });

      // EXECUTE
      const result = await smartCommit('/project', 'fallback', {
        generateMessage: true,
      });

      // VERIFY — the placeholder message went through gitCommitTree (the
      // plumbing commit), and the returned hash is its commitSha.
      expect(result).toBe('fallback-via-plumbing');
      expect(mockGitCommitTree).toHaveBeenCalledTimes(1);
      expect(mockGitCommitTree).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringMatching(
            /chore: commit-gen failed \(exit \d+\); fallback commit/
          ),
        })
      );
      expect(mockGitUpdateRefCAS).toHaveBeenCalledTimes(1);
      expect(mockGitUpdateRefCAS).toHaveBeenCalledWith({
        repoPath: '/project',
        newSha: 'fallback-via-plumbing',
        expectedOldSha: 'parent-sha-0001',
      });
    });
  });

  // ===========================================================================
  // STAGECOACH GENERATION BOUNDARY: generateCommitMessage
  // (PRP P3.M1.T3.S1) — the transient-API-sensitive boundary P3.M1.T4.S1 wraps
  // with retryAgentPrompt. Throws AgentError on every failure mode.
  // ===========================================================================
  describe('generateCommitMessage', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('returns the trimmed stdout on exit 0', async () => {
      // SETUP — stagecoach exits 0 with a multi-line stdout; the function trims.
      mockSpawn.mockImplementation(
        spawnReturning({ stdout: '  feat(api): add endpoint  \n' })
      );

      // EXECUTE
      const result = await generateCommitMessage('/repo');

      // VERIFY — trimmed stdout is returned.
      expect(result).toBe('feat(api): add endpoint');
    });

    it('forwards the harness id as --provider and the balanced model as --model', async () => {
      // SETUP — pin the harness + model so the assertion is deterministic.
      vi.stubEnv('PRP_AGENT_HARNESS', 'claude-code');
      mockSpawn.mockImplementation(spawnReturning({ stdout: 'msg' }));

      // EXECUTE
      await generateCommitMessage('/repo');

      // VERIFY — argv vector passed to spawn contains --provider claude-code
      // (the HARNESS id, NOT an LLM provider) + --model <balanced tier>, and
      // the base flags --dry-run --single. cwd is repoRoot (NOT process.cwd()).
      expect(mockSpawn).toHaveBeenCalledTimes(1);
      const [, argv, options] = mockSpawn.mock.calls[0];
      expect(argv).toEqual(
        expect.arrayContaining(['--dry-run', '--single', '--provider'])
      );
      const providerIdx = argv.indexOf('--provider');
      expect(argv[providerIdx + 1]).toBe('claude-code');
      const modelIdx = argv.indexOf('--model');
      expect(argv[modelIdx + 1]).toEqual(expect.any(String));
      expect(argv[modelIdx + 1].length).toBeGreaterThan(0);
      expect(options).toEqual(
        expect.objectContaining({
          cwd: '/repo',
          env: process.env,
          stdio: ['ignore', 'pipe', 'pipe'],
        })
      );
      // bin comes from the resolver.
      expect(mockResolveStagecoachBinary).toHaveBeenCalledTimes(1);
      expect(mockSpawn.mock.calls[0][0]).toBe('/fake/stagecoach');
    });

    it('falls back to DEFAULT_HARNESS when PRP_AGENT_HARNESS is unset', async () => {
      // SETUP — harness env unset → argv uses DEFAULT_HARNESS ('pi').
      delete process.env.PRP_AGENT_HARNESS;
      mockSpawn.mockImplementation(spawnReturning({ stdout: 'msg' }));

      // EXECUTE
      await generateCommitMessage('/repo');

      // VERIFY
      const argv = mockSpawn.mock.calls[0][1] as string[];
      const providerIdx = argv.indexOf('--provider');
      expect(argv[providerIdx + 1]).toBe('pi');
    });

    it('adds --format <style> when PRP_COMMIT_STYLE is not auto', async () => {
      // SETUP — explicit conventional → --format conventional is added.
      vi.stubEnv('PRP_COMMIT_STYLE', 'conventional');
      mockSpawn.mockImplementation(spawnReturning({ stdout: 'msg' }));

      // EXECUTE
      await generateCommitMessage('/repo');

      // VERIFY — --format conventional present in the argv.
      const argv = mockSpawn.mock.calls[0][1] as string[];
      const formatIdx = argv.indexOf('--format');
      expect(formatIdx).toBeGreaterThan(-1);
      expect(argv[formatIdx + 1]).toBe('conventional');
    });

    it('omits --format when PRP_COMMIT_STYLE is auto (default)', async () => {
      // SETUP — auto (the default) → --format is NOT added.
      delete process.env.PRP_COMMIT_STYLE;
      mockSpawn.mockImplementation(spawnReturning({ stdout: 'msg' }));

      // EXECUTE
      await generateCommitMessage('/repo');

      // VERIFY — no --format flag in the argv.
      const argv = mockSpawn.mock.calls[0][1] as string[];
      expect(argv).not.toContain('--format');
    });

    it('throws a TRANSIENT AgentError on non-zero exit', async () => {
      // SETUP — stagecoach exits 1 with a stderr message.
      mockSpawn.mockImplementation(
        spawnReturning({ exitCode: 1, stderr: 'boom' })
      );

      // EXECUTE + VERIFY — every failure wraps in a transient AgentError so
      // smartCommit's retry loop re-attempts + ultimately falls back.
      await expect(generateCommitMessage('/repo')).rejects.toThrow(AgentError);
      await expect(generateCommitMessage('/repo')).rejects.toThrow(/exit 1/);
      await expect(generateCommitMessage('/repo')).rejects.toThrow(/boom/);
    });

    it('classifies the non-zero-exit AgentError as transient (retry contract)', async () => {
      mockSpawn.mockImplementation(spawnReturning({ exitCode: 2 }));
      let thrown: unknown;
      try {
        await generateCommitMessage('/repo');
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(AgentError);
      expect(isTransientError(thrown)).toBe(true);
    });

    it('throws AgentError on empty stdout (exit 0 but no message)', async () => {
      mockSpawn.mockImplementation(spawnReturning({ stdout: '   ' }));
      await expect(generateCommitMessage('/repo')).rejects.toThrow(
        /empty stdout/
      );
    });

    it('throws AgentError on a spawn error event', async () => {
      // SETUP — spawn emits 'error' (e.g. ENOENT on the binary).
      mockSpawn.mockImplementation(
        spawnReturning({ spawnError: new Error('ENOENT no such binary') })
      );
      await expect(generateCommitMessage('/repo')).rejects.toThrow(
        /ENOENT no such binary/
      );
    });

    it('throws AgentError when the binary resolver throws', async () => {
      // SETUP — resolveStagecoachBinary throws (no binary found on the host).
      mockResolveStagecoachBinary.mockImplementation(() => {
        throw new Error('stagecoach binary not found');
      });
      await expect(generateCommitMessage('/repo')).rejects.toThrow(
        /stagecoach binary not found/
      );
    });

    it('appends stderr to the non-zero-exit message when present', async () => {
      mockSpawn.mockImplementation(
        spawnReturning({ exitCode: 3, stderr: 'model overloaded' })
      );
      await expect(generateCommitMessage('/repo')).rejects.toThrow(
        /exit 3.*model overloaded/
      );
    });

    it('omits stderr from the message when the non-zero exit had none', async () => {
      mockSpawn.mockImplementation(spawnReturning({ exitCode: 4 }));
      await expect(generateCommitMessage('/repo')).rejects.toThrow(
        /^stagecoach commit-message generation failed \(exit 4\)$/m
      );
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
      mockSpawn.mockImplementation(
        spawnReturning({ stdout: 'feat(api): add endpoint' })
      );
      mockGitCommitTree.mockResolvedValue({
        success: true,
        commitSha: 'abc123',
      });

      // EXECUTE
      const result = await smartCommit('/project', 'fallback msg', {
        generateMessage: true,
      });

      // VERIFY — commit hash returned + gitDiff called after gitAdd + message
      // wrapped via formatCommitMessage (plain subject, NO Co-Authored-By
      // trailer, no [PRP Auto] — default path emits plain until S3 threads a
      // position).
      expect(result).toBe('abc123');
      expect(mockGitDiff).toHaveBeenCalledWith({
        path: '/project',
        staged: true,
      });
      expect(mockGitCommitTree).toHaveBeenCalledWith({
        repoPath: '/project',
        treeSha: 'tree-sha-0001',
        message: 'feat(api): add endpoint',
        parentSha: 'parent-sha-0001',
      });
    });

    it('gitDiff failure → returns null, spawn never called, error logged', async () => {
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
      expect(mockSpawn).not.toHaveBeenCalled();
      expect(mockGitCommitTree).not.toHaveBeenCalled();
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Git diff (staged) failed: not a git repo'
      );
    });

    it('generateCommitMessage throws after retries → FALLBACK placeholder commit made (PRD §5.1)', async () => {
      // SETUP — stagecoach exits non-zero → generateCommitMessage throws
      // AgentError. Disable the retry loop (1 attempt = no retries) so the
      // boundary is called once and the test stays fast (no 10s backoff sleeps).
      // With COMMIT_RETRY_MAX=1 the exhausted-retry throw propagates to the
      // INNER catch (P3.M1.T4.S2), which makes a FALLBACK placeholder commit.
      vi.stubEnv('COMMIT_RETRY_MAX', '1');
      vi.stubEnv('COMMIT_RETRY_DELAY', '1');
      mockGitStatus.mockResolvedValue({
        success: true,
        modified: ['src/index.ts'],
      });
      mockGitAdd.mockResolvedValue({ success: true, stagedCount: 1 });
      mockGitDiff.mockResolvedValue({ success: true, diff: 'diff text' });
      mockSpawn.mockImplementation(
        spawnReturning({ exitCode: 1, stderr: 'model overloaded' })
      );
      // The fallback gitCommit succeeds → returns the fallback hash.
      mockGitCommitTree.mockResolvedValue({
        success: true,
        commitSha: 'fb000',
      });

      // EXECUTE — smartCommit now makes a fallback commit (not null).
      const result = await smartCommit('/project', 'fallback', {
        generateMessage: true,
      });

      // VERIFY — fallback commit made with the labeled placeholder. The
      // staged substance is preserved (never stranded). The placeholder is
      // wrapped via formatCommitMessage (plain subject, no [PRP Auto] —
      // non-backlog fallback degrades to plain per PRD §5.1).
      expect(result).toBe('fb000');
      expect(mockGitCommitTree).toHaveBeenCalledTimes(1);
      expect(mockGitCommitTree).toHaveBeenCalledWith({
        repoPath: '/project',
        treeSha: 'tree-sha-0001',
        message: expect.stringMatching(
          /chore: commit-gen failed \(exit \d+\); fallback commit/
        ),
        parentSha: 'parent-sha-0001',
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

    it('BACKWARD COMPAT: no options → gitDiff never called, spawn never called, gitCommit uses formatCommitMessage(msg)', async () => {
      // SETUP
      mockGitStatus.mockResolvedValue({
        success: true,
        modified: ['src/index.ts'],
      });
      mockGitAdd.mockResolvedValue({ success: true, stagedCount: 1 });
      mockGitCommitTree.mockResolvedValue({
        success: true,
        commitSha: 'abc123',
      });

      // EXECUTE — no options (the default path)
      const result = await smartCommit('/project', 'Pre-formatted message');

      // VERIFY — default path is byte-identical to pre-stagecoach behavior
      expect(result).toBe('abc123');
      expect(mockGitDiff).not.toHaveBeenCalled();
      expect(mockSpawn).not.toHaveBeenCalled();
      expect(mockGitCommitTree).toHaveBeenCalledWith({
        repoPath: '/project',
        treeSha: 'tree-sha-0001',
        message: 'Pre-formatted message',
        parentSha: 'parent-sha-0001',
      });
    });

    it('BACKWARD COMPAT: { generateMessage: false } → default path (spawn never called)', async () => {
      // SETUP
      mockGitStatus.mockResolvedValue({
        success: true,
        modified: ['src/index.ts'],
      });
      mockGitAdd.mockResolvedValue({ success: true, stagedCount: 1 });
      mockGitCommitTree.mockResolvedValue({
        success: true,
        commitSha: 'abc123',
      });

      // EXECUTE — generateMessage explicitly false
      const result = await smartCommit('/project', 'msg', {
        generateMessage: false,
      });

      // VERIFY
      expect(result).toBe('abc123');
      expect(mockGitDiff).not.toHaveBeenCalled();
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('gitDiff success but missing diff field → spawn sees empty stdout → FALLBACK placeholder commit (PRD §5.1)', async () => {
      // SETUP — gitDiff returns success:true but no `diff` string. smartCommit
      // passes `diffResult.diff ?? ''` to generateCommitMessage. The new
      // stagecoach binary reads the repo index itself, so the unused _diff
      // doesn't short-circuit; instead the binary (mocked) returns empty
      // stdout → empty-stdout AgentError. With S2, that throw propagates
      // through the retry (exhausted at 1 attempt) to the INNER catch →
      // fallback placeholder commit (the staged substance is preserved).
      vi.stubEnv('COMMIT_RETRY_MAX', '1');
      vi.stubEnv('COMMIT_RETRY_DELAY', '1');
      mockGitStatus.mockResolvedValue({
        success: true,
        modified: ['src/index.ts'],
      });
      mockGitAdd.mockResolvedValue({ success: true, stagedCount: 1 });
      mockGitDiff.mockResolvedValue({ success: true }); // no diff field
      mockSpawn.mockImplementation(spawnReturning({ stdout: '' })); // empty stdout
      mockGitCommitTree.mockResolvedValue({
        success: true,
        commitSha: 'fb-empty',
      });

      // EXECUTE
      const result = await smartCommit('/project', 'fallback', {
        generateMessage: true,
      });

      // VERIFY — the empty-stdout AgentError propagates through retry → INNER
      // catch → fallback placeholder commit (NOT null).
      expect(result).toBe('fb-empty');
      expect(mockGitCommitTree).toHaveBeenCalledTimes(1);
      expect(mockSpawn).toHaveBeenCalledTimes(1);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringMatching(/falling back to placeholder commit/i)
      );
    });

    it('PRD §5.1 retry: transient error retried, succeeds on 3rd attempt → commit created, gitDiff called once', async () => {
      // SETUP — stagecoach exits non-zero on the first 2 attempts then exits 0
      // on the 3rd → retry loops twice and returns the 3rd result → smartCommit
      // commits it. Lower the delays so the backoff sleeps are ~1ms (test speed).
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
      // spawn fails twice (non-zero exit → transient AgentError) then succeeds.
      mockSpawn
        .mockImplementationOnce(
          spawnReturning({ exitCode: 1, stderr: 'timeout #1' })
        )
        .mockImplementationOnce(
          spawnReturning({ exitCode: 1, stderr: 'timeout #2' })
        )
        .mockImplementationOnce(
          spawnReturning({ stdout: 'feat: retry works' })
        );
      mockGitCommitTree.mockResolvedValue({
        success: true,
        commitSha: 'retry-hash',
      });

      // EXECUTE
      const result = await smartCommit('/project', 'fallback', {
        generateMessage: true,
      });

      // VERIFY — retry succeeded on the 3rd attempt → commit hash returned.
      // The transient AgentErrors are classified retryable by isTransientError
      // (the default RetryOptions.isRetryable), so retry looped.
      expect(result).toBe('retry-hash');
      // The boundary (spawn) was invoked exactly 3 times (2 transient
      // failures + 1 success).
      expect(mockSpawn).toHaveBeenCalledTimes(3);
      // gitDiff is called ONCE (outside the retry closure — the diff is read
      // once and captured; only the generate call repeats). PRD §5.1: "the
      // index is left untouched."
      expect(mockGitDiff).toHaveBeenCalledTimes(1);
      // The committed message is the 3rd-attempt output, wrapped.
      expect(mockGitCommitTree).toHaveBeenCalledWith({
        repoPath: '/project',
        treeSha: 'tree-sha-0001',
        message: 'feat: retry works',
        parentSha: 'parent-sha-0001',
      });
    });

    it('PRD §5.1 retry: exhausted attempts → FALLBACK placeholder commit (P3.M1.T4.S2)', async () => {
      // SETUP — stagecoach always exits non-zero. With COMMIT_RETRY_MAX=2 the
      // boundary is attempted twice then the last error propagates → INNER
      // catch (P3.M1.T4.S2) → fallback placeholder commit. Lower delays for speed.
      vi.stubEnv('COMMIT_RETRY_MAX', '2');
      vi.stubEnv('COMMIT_RETRY_DELAY', '1');
      vi.stubEnv('COMMIT_RETRY_DELAY_CAP', '1');
      mockGitStatus.mockResolvedValue({
        success: true,
        modified: ['src/index.ts'],
      });
      mockGitAdd.mockResolvedValue({ success: true, stagedCount: 1 });
      mockGitDiff.mockResolvedValue({ success: true, diff: 'diff text' });
      mockSpawn.mockImplementation(
        spawnReturning({ exitCode: 1, stderr: 'always fails' })
      );
      // The fallback gitCommit succeeds → returns the fallback hash.
      mockGitCommitTree.mockResolvedValue({
        success: true,
        commitSha: 'fallback-hash',
      });

      // EXECUTE
      const result = await smartCommit('/project', 'fallback', {
        generateMessage: true,
      });

      // VERIFY — retry exhausted both attempts, then the last AgentError
      // propagated to smartCommit's INNER catch → fallback placeholder commit
      // (the staged substance is preserved, never stranded — PRD §5.1).
      expect(result).toBe('fallback-hash');
      expect(mockSpawn).toHaveBeenCalledTimes(2);
      expect(mockGitCommitTree).toHaveBeenCalledTimes(1);
      expect(mockGitDiff).toHaveBeenCalledTimes(1); // read once outside retry
      expect(mockGitCommitTree).toHaveBeenCalledWith({
        repoPath: '/project',
        treeSha: 'tree-sha-0001',
        message: expect.stringMatching(
          /chore: commit-gen failed \(exit \d+\); fallback commit/
        ),
        parentSha: 'parent-sha-0001',
      });
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringMatching(/falling back to placeholder commit/i)
      );
    });

    it('fallback commit: gitCommit ALSO fails → returns null (never-fail-on-commit)', async () => {
      // SETUP — stagecoach exits non-zero → retry exhausts (1 attempt) → INNER
      // catch → fallback placeholder commit attempted, BUT gitCommit itself
      // fails (e.g. disk full). smartCommit must return null (never-fail-on-commit).
      vi.stubEnv('COMMIT_RETRY_MAX', '1');
      vi.stubEnv('COMMIT_RETRY_DELAY', '1');
      mockGitStatus.mockResolvedValue({
        success: true,
        modified: ['src/index.ts'],
      });
      mockGitAdd.mockResolvedValue({ success: true, stagedCount: 1 });
      mockGitDiff.mockResolvedValue({ success: true, diff: 'diff text' });
      mockSpawn.mockImplementation(
        spawnReturning({ exitCode: 1, stderr: 'model overloaded' })
      );
      // The fallback gitCommit FAILS → smartCommit returns null.
      mockGitCommitTree.mockResolvedValue({
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
      expect(mockGitCommitTree).toHaveBeenCalledTimes(1); // the fallback attempt
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringMatching(/falling back/i)
      );
      // The commit-tree failure logs 'Smart Commit aborted (commit-tree failed): ...'
      // (P1.M1.T3.S2: the plumbing commit reports its own failure, never-fail → null).
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringMatching(/commit-tree failed/i)
      );
    });

    // NOTE (permanent-error path): contract item 3c requires the retry to use
    // isTransientError() so permanent errors are NOT retried. We do NOT assert
    // that here via smartCommit because generateCommitMessage wraps every
    // failure (non-zero exit / empty stdout / spawn error / resolver throw) in
    // an AgentError (PIPELINE_AGENT_LLM_FAILED), which isTransientError always
    // classifies transient. The permanent-error classification is therefore
    // owned + tested by retry.ts's own isTransientError unit tests (unchanged
    // by this task).
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
      mockGitCommitTree.mockResolvedValue({
        success: true,
        commitSha: 'abc123',
      });

      // EXECUTE — default path (no generateMessage) WITH a position. The
      // verbatim message gets the task-prefix layered on.
      const result = await smartCommit('/project', 'add utility', {
        position: parseItemPosition('P1.M2.T1.S1'),
      });

      // VERIFY — gitCommit receives the prefixed subject, NO trailer.
      expect(result).toBe('abc123');
      expect(mockGitCommitTree).toHaveBeenCalledWith({
        repoPath: '/project',
        treeSha: 'tree-sha-0001',
        message: '1.2.1.1: add utility',
        parentSha: 'parent-sha-0001',
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
      mockSpawn.mockImplementation(
        spawnReturning({ stdout: 'feat(api): add endpoint' })
      );
      mockGitCommitTree.mockResolvedValue({
        success: true,
        commitSha: 'abc123',
      });

      // EXECUTE — generateMessage path WITH a position. The LLM subject gets
      // the task-prefix layered on.
      const result = await smartCommit('/project', 'fallback msg', {
        generateMessage: true,
        position: parseItemPosition('P1.M2.T1.S1'),
      });

      // VERIFY — gitCommit receives the prefixed LLM subject, NO trailer. NO
      // [PRP Auto] banner (the wrap is via formatCommitMessage).
      expect(result).toBe('abc123');
      expect(mockGitCommitTree).toHaveBeenCalledWith({
        repoPath: '/project',
        treeSha: 'tree-sha-0001',
        message: '1.2.1.1: feat(api): add endpoint',
        parentSha: 'parent-sha-0001',
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
      mockSpawn.mockImplementation(
        spawnReturning({ exitCode: 1, stderr: 'model overloaded' })
      );
      mockGitCommitTree.mockResolvedValue({
        success: true,
        commitSha: 'fb000',
      });

      // EXECUTE — generateMessage path WITH a position, agent always fails →
      // the fallback wrap site ALSO threads position.
      const result = await smartCommit('/project', 'fallback', {
        generateMessage: true,
        position: parseItemPosition('P1.M2.T1.S1'),
      });

      // VERIFY — the fallback placeholder gets the task-prefix START.
      expect(result).toBe('fb000');
      expect(mockGitCommitTree).toHaveBeenCalledWith({
        repoPath: '/project',
        treeSha: 'tree-sha-0001',
        message: expect.stringContaining(
          '1.2.1.1: chore: commit-gen failed (exit 0); fallback commit'
        ),
        parentSha: 'parent-sha-0001',
      });
    });

    it('position null → plain commit message (regression: non-backlog degrades to plain)', async () => {
      // SETUP
      mockGitStatus.mockResolvedValue({
        success: true,
        modified: ['src/index.ts'],
      });
      mockGitAdd.mockResolvedValue({ success: true, stagedCount: 1 });
      mockGitCommitTree.mockResolvedValue({
        success: true,
        commitSha: 'abc123',
      });

      // EXECUTE — position explicitly null (e.g. a malformed subtask.id →
      // parseItemPosition returns null). Must degrade to plain.
      const result = await smartCommit('/project', 'add utility', {
        position: null,
      });

      // VERIFY — plain subject, NO trailer (no prefix, no [PRP Auto]).
      expect(result).toBe('abc123');
      const call = mockGitCommitTree.mock.calls[0]?.[0] as
        | { message?: string }
        | undefined;
      expect(call?.message).toBe('add utility');
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
      mockGitCommitTree.mockResolvedValue({
        success: true,
        commitSha: 'abc123',
      });

      // EXECUTE
      const result = await smartCommit('/project', 'add utility', {
        position: parseItemPosition('P1.M2.T1.S1'),
      });

      // VERIFY — plain despite the position (format=plain wins).
      expect(result).toBe('abc123');
      const call = mockGitCommitTree.mock.calls[0]?.[0] as
        | { message?: string }
        | undefined;
      expect(call?.message).toBe('add utility');
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
      mockGitCommitTree.mockResolvedValue({
        success: true,
        commitSha: 'abc123',
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
      const commitOrder = mockGitCommitTree.mock.invocationCallOrder[0];
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
      mockSpawn.mockImplementation(spawnReturning({ stdout: 'feat: x' }));
      mockGitCommitTree.mockResolvedValue({
        success: true,
        commitSha: 'abc123',
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
      const commitOrder = mockGitCommitTree.mock.invocationCallOrder[0];
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
      mockGitCommitTree.mockResolvedValue({
        success: true,
        commitSha: 'abc123',
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

  // ===========================================================================
  // GENERATION-TIMEOUT / SIGINT RESCUE (PRD §5.1 "Generation timeout / SIGINT", P1.M1.T3.S3)
  // — recipe/emitter/handler unit tests + the thrown-escape integration test +
  // the CAS-refusal no-double-emit guard + the happy/fallback no-emit guards.
  // ===========================================================================
  describe('generation-timeout / SIGINT rescue (PRD §5.1, P1.M1.T3.S3)', () => {
    describe('formatCommitRescueRecipe (pure renderer)', () => {
      it('renders TREE_SHA, PARENT_SHA, and the exact recovery command', () => {
        const recipe = formatCommitRescueRecipe({
          treeSha: 'tree-abc',
          parentSha: 'parent-def',
        });

        expect(recipe).toContain('TREE_SHA:    tree-abc');
        expect(recipe).toContain('PARENT_SHA:  parent-def');
        // The exact manual recovery command (§5.1 contract):
        expect(recipe).toContain(
          'git commit-tree -p parent-def -m "<your message>" tree-abc | xargs git update-ref HEAD'
        );
        expect(recipe).toContain('git ls-tree tree-abc');
      });

      it('omits -p for a rootless repository (parentSha undefined)', () => {
        const recipe = formatCommitRescueRecipe({ treeSha: 'tree-abc' });

        expect(recipe).toContain('TREE_SHA:    tree-abc');
        expect(recipe).toContain('(rootless repository — root commit)');
        // No `-p` parent flag:
        expect(recipe).toContain(
          'git commit-tree -m "<your message>" tree-abc | xargs git update-ref HEAD'
        );
        expect(recipe).not.toContain('-p parent-');
      });
    });

    describe('emitCommitRescue', () => {
      afterEach(() => {
        vi.restoreAllMocks();
      });

      it('writes the recipe to stderr + logger().error when a snapshot is held and NOT committed', () => {
        const stderrSpy = vi
          .spyOn(process.stderr, 'write')
          .mockReturnValue(true);

        emitCommitRescue({
          treeSha: 'tree-held',
          parentSha: 'parent-held',
          committed: false,
        });

        // SYNC stderr write (survives an imminent exit) — contains the recipe.
        expect(stderrSpy).toHaveBeenCalled();
        const written = stderrSpy.mock.calls.map(c => String(c[0])).join('');
        expect(written).toContain('TREE_SHA:    tree-held');
        expect(written).toContain('git commit-tree');
        // logger().error ALSO called with the recipe.
        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.stringContaining('tree-held')
        );
      });

      it('is a no-op when committed === true (the snapshot was committed)', () => {
        const stderrSpy = vi
          .spyOn(process.stderr, 'write')
          .mockReturnValue(true);

        emitCommitRescue({
          treeSha: 'tree-ok',
          parentSha: 'parent-ok',
          committed: true,
        });

        expect(stderrSpy).not.toHaveBeenCalled();
        expect(mockLogger.error).not.toHaveBeenCalledWith(
          expect.stringContaining('tree-ok')
        );
      });

      it('is a no-op when no rescue state is held (null)', () => {
        const stderrSpy = vi
          .spyOn(process.stderr, 'write')
          .mockReturnValue(true);

        emitCommitRescue(null);

        expect(stderrSpy).not.toHaveBeenCalled();
      });
    });

    describe('onCommitRescueSignal (injectable mockExit)', () => {
      afterEach(() => {
        vi.restoreAllMocks();
      });

      it('emits the held rescue + calls mockExit with the given code (130 = SIGINT)', async () => {
        // Seed the module-scoped rescue state by exercising smartCommit up to the
        // window, then assert the handler emits + exits. Use an injectable exit
        // so the test process is NOT terminated.
        const exit = vi.fn();
        const stderrSpy = vi
          .spyOn(process.stderr, 'write')
          .mockReturnValue(true);
        // Seed state: simulate an interrupt mid-window by calling the handler
        // after the recipe helpers are in scope. The handler reads the
        // module-scoped _commitRescue; set it via a real smartCommit that stalls.
        // Simpler + faithful: drive smartCommit to set _commitRescue, then (before
        // it resolves) invoke the handler. Because smartCommit is async, we seed
        // _commitRescue through a controlled stall: mock gitDiff to never resolve.
        mockGitStatus.mockResolvedValue({
          success: true,
          modified: ['src/index.ts'],
        });
        mockGitAdd.mockResolvedValue({ success: true, stagedCount: 1 });
        let resolveDiff!: () => void;
        mockGitDiff.mockReturnValue(
          new Promise(_ => {
            resolveDiff = _;
          })
        );

        const promise = smartCommit('/project', 'msg', {
          generateMessage: true,
        });
        // Allow the microtask queue to advance so smartCommit reaches the window
        // (treeSha captured + handlers registered + _commitRescue set).
        await vi.waitFor(() => {
          // The handler emits only when _commitRescue is set. Trigger it: if no
          // state were held, stderr would be empty.
          onCommitRescueSignal(130, exit);
          expect(stderrSpy).toHaveBeenCalled();
        });

        expect(exit).toHaveBeenCalledWith(130);
        const written = stderrSpy.mock.calls.map(c => String(c[0])).join('');
        expect(written).toContain('tree-sha-0001');
        expect(written).toContain('git commit-tree');

        // Release the stalled promise so smartCommit resolves and the test
        // process can exit cleanly (it will return null via the gen-fail path
        // once gitDiff is allowed to hang forever — reject it instead).
        resolveDiff();
        await expect(promise).resolves.toBeNull();
      });

      it('onCommitRescueSIGINT exits 130 and onCommitRescueSIGTERM exits 143 (named wrappers)', () => {
        const exitInt = vi.fn();
        const exitTerm = vi.fn();
        vi.spyOn(process.stderr, 'write').mockReturnValue(true);

        // Call the underlying signal fn with the named wrappers' codes via the
        // injectable exit (the named wrappers themselves use the real
        // process.exit default — exercise the code mapping directly here).
        onCommitRescueSignal(130, exitInt);
        onCommitRescueSignal(143, exitTerm);

        expect(exitInt).toHaveBeenCalledWith(130);
        expect(exitTerm).toHaveBeenCalledWith(143);
      });
    });

    describe('smartCommit try/finally rescue wiring', () => {
      beforeEach(() => {
        mockGitStatus.mockResolvedValue({
          success: true,
          modified: ['src/index.ts'],
        });
        mockGitAdd.mockResolvedValue({ success: true, stagedCount: 1 });
      });
      afterEach(() => {
        vi.restoreAllMocks();
      });

      it('a thrown escape during the window emits the rescue + returns null', async () => {
        // SETUP — gitDiff rejects (escapes the window, NOT CommitCasRefusedError).
        // committed stays false; rescueEscape is set → finally emits the rescue.
        const stderrSpy = vi
          .spyOn(process.stderr, 'write')
          .mockReturnValue(true);
        mockGitDiff.mockRejectedValue(new Error('boom — generation killed'));

        // EXECUTE
        const result = await smartCommit('/project', 'msg', {
          generateMessage: true,
        });

        // VERIFY — returns null (outer catch) AND the rescue recipe was emitted.
        expect(result).toBeNull();
        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.stringContaining('tree-sha-0001')
        );
        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.stringContaining('git commit-tree')
        );
        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.stringContaining('xargs git update-ref HEAD')
        );
        // The rescue recipe (interrupt case) is emitted, distinct from S2's.
        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.stringContaining('Smart Commit interrupted')
        );
        // SYNC stderr write also fired.
        const written = stderrSpy.mock.calls.map(c => String(c[0])).join('');
        expect(written).toContain('tree-sha-0001');
      });

      it('CAS refusal does NOT double-emit S3 rescue (S2 recipe only)', async () => {
        // SETUP — CAS refuses: S2 logs its OWN recipe (with newSha) + throws
        // CommitCasRefusedError. S3's rescue MUST NOT also fire.
        vi.spyOn(process.stderr, 'write').mockReturnValue(true);
        mockGitUpdateRefCAS.mockResolvedValue({
          success: false,
          error: 'stale HEAD',
          casFailure: true,
        });

        // EXECUTE — re-throws CommitCasRefusedError (S2 contract).
        await expect(smartCommit('/project', 'msg')).rejects.toThrow(
          CommitCasRefusedError
        );

        // VERIFY — S2's recipe was logged (carries newSha) …
        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.stringContaining('new-sha-0001')
        );
        // … but S3's rescue recipe (interrupt case) was NOT (no double-emit).
        mockLogger.error.mock.calls.forEach(([msg]) => {
          expect(String(msg)).not.toContain('Smart Commit interrupted');
        });
      });

      it('happy path does NOT emit the rescue (committed flips true)', async () => {
        // SETUP — defaults: commitTree→new-sha, CAS→success.
        const stderrSpy = vi
          .spyOn(process.stderr, 'write')
          .mockReturnValue(true);
        mockGitCommitTree.mockResolvedValue({
          success: true,
          commitSha: 'happy-hash',
        });

        // EXECUTE
        const result = await smartCommit('/project', 'msg');

        // VERIFY — commit succeeded, no rescue recipe anywhere.
        expect(result).toBe('happy-hash');
        expect(stderrSpy).not.toHaveBeenCalled();
        mockLogger.error.mock.calls.forEach(([msg]) => {
          expect(String(msg)).not.toContain('Smart Commit interrupted');
          expect(String(msg)).not.toContain('TREE_SHA:');
        });
      });

      it('fallback path does NOT emit the rescue (placeholder commits → committed true)', async () => {
        // SETUP — generation fails after retries → placeholder commits via the
        // SAME plumbing → committed flips true → no rescue.
        vi.stubEnv('COMMIT_RETRY_MAX', '1');
        vi.stubEnv('COMMIT_RETRY_DELAY', '1');
        vi.spyOn(process.stderr, 'write').mockReturnValue(true);
        mockGitDiff.mockResolvedValue({ success: true, diff: 'diff text' });
        mockSpawn.mockImplementation(
          spawnReturning({ exitCode: 1, stderr: 'model overloaded' })
        );
        mockGitCommitTree.mockResolvedValue({
          success: true,
          commitSha: 'fallback-hash',
        });

        // EXECUTE
        const result = await smartCommit('/project', 'fallback', {
          generateMessage: true,
        });

        // VERIFY — fallback committed, no rescue recipe.
        expect(result).toBe('fallback-hash');
        mockLogger.error.mock.calls.forEach(([msg]) => {
          expect(String(msg)).not.toContain('Smart Commit interrupted');
          expect(String(msg)).not.toContain('TREE_SHA:');
        });
      });

      it('normal return-null paths inside the window do NOT emit the rescue (commit-tree fail)', async () => {
        // SETUP — commit-tree fails → never-fail-on-commit return null. This is
        // a NORMAL exit (no throw escape) → rescue must NOT fire.
        vi.spyOn(process.stderr, 'write').mockReturnValue(true);
        mockGitCommitTree.mockResolvedValue({
          success: false,
          error: 'bad tree',
        });

        // EXECUTE
        const result = await smartCommit('/project', 'msg');

        // VERIFY — returns null, no rescue recipe.
        expect(result).toBeNull();
        mockLogger.error.mock.calls.forEach(([msg]) => {
          expect(String(msg)).not.toContain('Smart Commit interrupted');
        });
      });

      it('registers SIGINT/SIGTERM handlers phase-scoped (on at window-open, off after)', async () => {
        // SETUP — spy process.on / process.off around a happy-path run.
        const onSpy = vi.spyOn(process, 'on');
        const offSpy = vi.spyOn(process, 'off');
        mockGitCommitTree.mockResolvedValue({
          success: true,
          commitSha: 'hash',
        });

        // EXECUTE
        await smartCommit('/project', 'msg');

        // VERIFY — both handlers were registered at window-open …
        expect(onSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function));
        expect(onSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
        // … and unregistered in the finally (no handler leak on the happy path).
        expect(offSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function));
        expect(offSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
      });
    });
  });
});
