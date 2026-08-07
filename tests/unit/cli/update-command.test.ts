/**
 * Unit tests for the `hack update` CLI command (PRD §5.4).
 *
 * @remarks
 * Drives `parseCLIArgs()` (Commander auto-routes `.command('update')` to the
 * inline `updateAction` handler). The handler-logic contract is exercised with
 * `withLockedTasksJSON` MOCKED to run the REAL mutator on a fixture backlog —
 * so the cascade composition (`cascadeCompleteDown` + `replaceItemById` +
 * `recomputeAncestorsUp`) is genuinely executed. File discovery, status
 * matching, output channels, and exit codes are verified per case.
 *
 * End-to-end on-disk RMW (real lock + real atomic write) is covered by the
 * integration suite `tests/integration/cli-update.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseCLIArgs } from '../../../src/cli/index.js';
import type { Backlog } from '../../../src/core/models.js';

// ── Hoisted mocks ────────────────────────────────────────────────────────────

// repo-root: no-op bootstrap so the preAction hook is inert during these tests.
const { mockBootstrapRepoRoot } = vi.hoisted(() => ({
  mockBootstrapRepoRoot: vi.fn(),
}));
vi.mock('../../../src/utils/repo-root.js', () => ({
  resolveRepositoryRoot: vi.fn(() => ({
    repoRoot: '/mock-repo',
    invocationCwd: '/mock-invocation',
  })),
  bootstrapRepoRoot: mockBootstrapRepoRoot,
  getRepoRoot: vi.fn(() => '/mock-repo'),
  getInvocationCwd: vi.fn(() => process.cwd()),
}));

// node:fs — existsSync overridden per-test; readFileSync preserved for --version.
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: vi.fn(),
  };
});

// node:fs/promises — readFile mocked (the pre-lock loose lookup parse).
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

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

const { mockConfigExecute } = vi.hoisted(() => ({
  mockConfigExecute: vi.fn(async () => {}),
}));
vi.mock('../../../src/cli/commands/config.js', () => ({
  ConfigCommand: class {
    constructor() {}
    execute = mockConfigExecute;
  },
}));

const { mockFindLatestSession, mockListSessions } = vi.hoisted(() => ({
  mockFindLatestSession: vi.fn(),
  mockListSessions: vi.fn(),
}));
vi.mock('../../../src/core/session-manager.js', () => ({
  SessionManager: Object.assign(class {}, {
    findLatestSession: mockFindLatestSession,
    listSessions: mockListSessions,
  }),
}));

const { mockFindLatestBugfixTasksFile } = vi.hoisted(() => ({
  mockFindLatestBugfixTasksFile: vi.fn(async () => null),
}));
vi.mock('../../../src/core/session-utils.js', () => ({
  findLatestBugfixTasksFile: mockFindLatestBugfixTasksFile,
}));

// file-lock mock: run the REAL mutator on a mutable fixture clone so the cascade
// composition is exercised; expose a class for the lock-timeout case. The mock is
// seeded with a fixture that can be overridden per-test.
function buildFixture(): Backlog {
  return JSON.parse(
    JSON.stringify({
      backlog: [
        {
          id: 'P1',
          type: 'Phase',
          title: 'Phase One',
          status: 'Planned',
          milestones: [
            {
              id: 'P1.M1',
              type: 'Milestone',
              title: 'Milestone One',
              status: 'Planned',
              tasks: [
                {
                  id: 'P1.M1.T1',
                  type: 'Task',
                  title: 'Task One',
                  status: 'Planned',
                  subtasks: [
                    {
                      id: 'P1.M1.T1.S1',
                      type: 'Subtask',
                      title: 'Subtask One',
                      status: 'Planned',
                      story_points: 2,
                    },
                    {
                      id: 'P1.M1.T1.S2',
                      type: 'Subtask',
                      title: 'Subtask Two',
                      status: 'Planned',
                      story_points: 2,
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    })
  ) as Backlog;
}

const { mockWithLocked, LockErr, mockLockFixture } = vi.hoisted(() => ({
  mockWithLocked: vi.fn(),
  LockErr: class extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'TasksLockAcquisitionError';
    }
  },
  mockLockFixture: { current: buildFixture() as Backlog },
}));
vi.mock('../../../src/core/file-lock.js', () => ({
  withLockedTasksJSON: mockWithLocked,
  TasksLockAcquisitionError: LockErr,
}));

import { existsSync } from 'node:fs';
import { readFile as mockReadFile } from 'node:fs/promises';

const mockExistsSync = existsSync as unknown as ReturnType<typeof vi.fn>;
const mockReadFileFn = mockReadFile as unknown as ReturnType<typeof vi.fn>;

// mockWithLocked is wired in beforeEach (vi.restoreAllMocks in afterEach
// wipes any top-level mockImplementation, so it must be re-established per test).
const lastPersisted: { current: Backlog | null } = { current: null };

describe('hack update (PRD §5.4)', () => {
  const originalArgv = process.argv;
  const originalExit = process.exit;

  const setArgv = (args: string[]) => {
    process.argv = ['node', '/path/to/script.js', ...args];
  };

  // process.exit NO-OP mock. Commander uses synchronous program.parse(), so the
  // async .action() runs detached. A NO-OP exit lets the handler run without
  // throwing an unhandled rejection; because the handler short-circuits early
  // (status-match errors) via exit(1) with no `return`, a leaked continuation
  // may call exit again later — so tests assert on the FIRST exit call
  // (bdExit.mock.calls[0][0]), which is always the intended short-circuit.
  let bdExit: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Fresh fixture + default discovery state for every case.
    mockLockFixture.current = buildFixture();
    lastPersisted.current = null;
    // Re-wire withLockedTasksJSON to run the REAL mutator on the fixture.
    // (vi.restoreAllMocks in afterEach wipes the top-level mockImplementation,
    // so we re-establish it every test.)
    mockWithLocked.mockImplementation(
      async (
        _dir: string,
        mutator: (b: Backlog) => Backlog
      ): Promise<Backlog> => {
        const result = mutator(mockLockFixture.current);
        lastPersisted.current = result;
        return result;
      }
    );
    mockFindLatestSession.mockResolvedValue({
      path: '/plan/001_abc',
      id: '001_abc',
      hash: 'abc',
    });
    mockListSessions.mockResolvedValue([
      { path: '/plan/001_abc', id: '001_abc', hash: 'abc' },
    ]);
    mockFindLatestBugfixTasksFile.mockResolvedValue(null);
    // Discovered tasks.json present by default; session dir present.
    mockExistsSync.mockImplementation(() => true);
    mockReadFileFn.mockResolvedValue(JSON.stringify(mockLockFixture.current));

    bdExit = vi.fn();
    process.exit = bdExit as unknown as typeof process.exit;
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.exit = originalExit;
    vi.restoreAllMocks();
  });

  /** Drive parseCLIArgs + drain microtasks so the detached async action settles.
   *  The handler's early short-circuit exit(1) calls (status-match errors) are
   *  followed by more awaits in the same try-body; with a NO-OP exit those
   *  leaked continuations must fully settle WITHIN this test (via a macrotask
   *  delay) so they never run against the next test's mocks. */
  const run = async () => {
    parseCLIArgs();
    // Flush microtasks (each await resumes here) across enough ticks to settle
    // the longest path (status match → 3x dynamic import → discovery → loose
    // lookup → lock+RMW → output).
    for (let i = 0; i < 50; i++) {
      await new Promise(r => setImmediate(r));
    }
  };

  /** The first recorded exit code (the intended short-circuit), or undefined. */
  const firstExitCode = (): number | undefined => bdExit.mock.calls[0]?.[0];

  it('hack update 1.1.1.1 done → success text + exit 0 (mutator ran)', async () => {
    const stdoutSpy = vi
      .spyOn(console, 'log')
      .mockImplementation(() => undefined);

    setArgv(['update', '1.1.1.1', 'done']);
    await run();

    expect(firstExitCode()).toBe(0);
    const stdoutText = stdoutSpy.mock.calls.flat().join(' ');
    expect(stdoutText).toContain('Updated P1.M1.T1.S1 status to Complete');

    // The mutator ran (pure): the PERSISTED backlog has the leaf Complete.
    const persisted = lastPersisted.current as any;
    expect(persisted.backlog[0].milestones[0].tasks[0].subtasks[0].status).toBe(
      'Complete'
    );

    stdoutSpy.mockRestore();
  });

  it('hack update p1m1t1s1 done -o json → success json + exit 0', async () => {
    const stdoutSpy = vi
      .spyOn(console, 'log')
      .mockImplementation(() => undefined);

    setArgv(['update', 'p1m1t1s1', 'done', '-o', 'json']);
    await run();

    expect(firstExitCode()).toBe(0);
    const emitted = JSON.parse(stdoutSpy.mock.calls[0][0] as string);
    expect(emitted).toEqual({
      id: 'P1.M1.T1.S1',
      status: 'Complete',
      title: 'Subtask One',
    });

    stdoutSpy.mockRestore();
  });

  it('hack update p1m1t1s1 re → synonym status Ready (case-insensitive)', async () => {
    const stdoutSpy = vi
      .spyOn(console, 'log')
      .mockImplementation(() => undefined);

    setArgv(['update', 'p1m1t1s1', 're']);
    await run();

    expect(firstExitCode()).toBe(0);
    const stdoutText = stdoutSpy.mock.calls.flat().join(' ');
    expect(stdoutText).toContain('Updated P1.M1.T1.S1 status to Ready');

    stdoutSpy.mockRestore();
  });

  it('hack update 1 done → cascade Complete to EVERY item under P1', async () => {
    const stdoutSpy = vi
      .spyOn(console, 'log')
      .mockImplementation(() => undefined);

    setArgv(['update', '1', 'done']);
    await run();

    expect(firstExitCode()).toBe(0);
    expect(stdoutSpy.mock.calls.flat().join(' ')).toContain(
      'Updated P1 status to Complete'
    );

    // The whole P1 subtree is now Complete (cascade ran inside the mutator).
    const phase = (lastPersisted.current as any).backlog[0];
    expect(phase.status).toBe('Complete');
    expect(phase.milestones[0].status).toBe('Complete');
    expect(phase.milestones[0].tasks[0].status).toBe('Complete');
    expect(phase.milestones[0].tasks[0].subtasks[0].status).toBe('Complete');
    expect(phase.milestones[0].tasks[0].subtasks[1].status).toBe('Complete');

    stdoutSpy.mockRestore();
  });

  it('hack update 9.9.9.9 done → exit 1, stderr "Task not found"', async () => {
    const stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);

    setArgv(['update', '9.9.9.9', 'done']);
    await run();

    expect(firstExitCode()).toBe(1);
    const stderrText = stderrSpy.mock.calls.flat().join(' ');
    expect(stderrText).toContain('Task not found: 9.9.9.9');

    stderrSpy.mockRestore();
  });

  it('hack update 1.1.1.1 r → exit 1, ambiguity (Ready + Researching)', async () => {
    const stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);

    setArgv(['update', '1.1.1.1', 'r']);
    await run();

    expect(firstExitCode()).toBe(1);
    const stderrText = stderrSpy.mock.calls.flat().join(' ');
    expect(stderrText).toMatch(/Ambiguous status "r"/);
    expect(stderrText).toMatch(/Ready|Researching/);

    stderrSpy.mockRestore();
  });

  it('hack update 1.1.1.1 bogus → exit 1, "Unknown status" + valid list', async () => {
    const stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);

    setArgv(['update', '1.1.1.1', 'bogus']);
    await run();

    expect(firstExitCode()).toBe(1);
    const stderrText = stderrSpy.mock.calls.flat().join(' ');
    expect(stderrText).toMatch(/Unknown status "bogus"/);
    expect(stderrText).toMatch(/Valid statuses:/);

    stderrSpy.mockRestore();
  });

  it('missing discovered tasks.json → HARD ERROR exit 1 (NO awaiting_breakdown)', async () => {
    const stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);

    // Discovered tasks.json absent (session dir present) — a WRITE must hard-error.
    mockExistsSync.mockImplementation((p: string) =>
      String(p).endsWith('tasks.json') ? false : true
    );

    setArgv(['update', '1.1.1.1', 'done']);
    await run();

    expect(firstExitCode()).toBe(1);
    const stderrText = stderrSpy.mock.calls.flat().join(' ');
    expect(stderrText).toMatch(/not found/);
    expect(stderrText).not.toMatch(/awaiting_breakdown/);

    stderrSpy.mockRestore();
  });

  it('explicit --file to a missing file → HARD ERROR exit 1 (ENOENT)', async () => {
    const stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);

    // existsSync returns false, but the --file path bypasses the discovery
    // hard-error gate; readFile then rejects ENOENT → catch → exit 1.
    mockExistsSync.mockImplementation(() => false);
    mockReadFileFn.mockRejectedValue(
      Object.assign(
        new Error("ENOENT: no such file, open '/missing/tasks.json'"),
        { code: 'ENOENT' }
      )
    );

    setArgv(['update', '1.1.1.1', 'done', '--file', '/missing/tasks.json']);
    await run();

    expect(firstExitCode()).toBe(1);
    const stderrText = stderrSpy.mock.calls.flat().join(' ');
    expect(stderrText).toMatch(/no such file|not found/);

    stderrSpy.mockRestore();
  });

  it('lock timeout → exit 1 with a clear lock message', async () => {
    const stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);

    mockWithLocked.mockRejectedValueOnce(
      new LockErr('Timed out waiting for tasks.json.lock')
    );

    setArgv(['update', '1.1.1.1', 'done']);
    await run();

    expect(firstExitCode()).toBe(1);
    const stderrText = stderrSpy.mock.calls.flat().join(' ');
    expect(stderrText).toMatch(/locked/);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('Could not acquire tasks.json lock')
    );

    stderrSpy.mockRestore();
  });
});
