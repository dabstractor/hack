/**
 * Integration tests for the `hack update` CLI command (PRD §5.4).
 *
 * @remarks
 * Drives the real CLI parser (`parseCLIArgs`) against a REAL temp `plan/`
 * directory + REAL `tasks.json` + REAL file-lock + REAL atomic
 * `writeTasksJSON` (only the logger is mocked). This is the proof that the
 * serialized RMW + downward `Complete` cascade + upward ancestor recompute
 * (promote AND demote) + atomic temp+rename write actually land on disk.
 *
 * Handler-logic cases (status matching, output channels, lock timeout) are
 * covered by the unit suite `tests/unit/cli/update-command.test.ts`.
 *
 * @see {@link ../../src/cli/index.ts | updateAction handler}
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  readdir,
} from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCLIArgs } from '../../src/cli/index.js';
import { _resetBootstrap } from '../../src/utils/repo-root.js';

// Silence the CLI logger so its output does not interfere with console spies.
const { mockLogger, mockSetLogDestination } = vi.hoisted(() => ({
  mockLogger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(() => mockLogger),
  },
  // BUG-2: updateAction calls setLogDestination(process.stderr) under `-o json`.
  mockSetLogDestination: vi.fn(),
}));
vi.mock('../../src/utils/logger.js', () => ({
  getLogger: vi.fn(() => mockLogger),
  setLogDestination: mockSetLogDestination,
}));

/**
 * A small but rich backlog: P1 has one milestone with one task of two subtasks.
 * All items start `Planned` so promote/demote deltas are observable. The
 * fixture is schema-valid (passes BacklogSchema.parse): Phase/Milestone/Task
 * carry a `description`, and each Subtask carries a CONTRACT DEFINITION-shaped
 * `context_scope` (required by ContextScopeSchema).
 */
function validContextScope(n: number): string {
  return `CONTRACT DEFINITION:
1. RESEARCH NOTE: Subtask ${n} context for the hack update integration test.
2. INPUT: The fixture tasks.json written by setupRepo().
3. LOGIC: Assert the cascade + ancestor recompute land on disk.
4. OUTPUT: A schema-valid backlog the file-lock RMW round-trips.`;
}

function freshBacklog() {
  return {
    backlog: [
      {
        id: 'P1',
        type: 'Phase',
        title: 'Phase One',
        status: 'Planned',
        description: 'Phase one of the hack update integration fixture.',
        milestones: [
          {
            id: 'P1.M1',
            type: 'Milestone',
            title: 'Milestone One',
            status: 'Planned',
            description:
              'Milestone one of the hack update integration fixture.',
            tasks: [
              {
                id: 'P1.M1.T1',
                type: 'Task',
                title: 'Task One',
                status: 'Planned',
                description: 'Task one of the hack update integration fixture.',
                subtasks: [
                  {
                    id: 'P1.M1.T1.S1',
                    type: 'Subtask',
                    title: 'Subtask One',
                    status: 'Planned',
                    story_points: 2,
                    dependencies: [],
                    context_scope: validContextScope(1),
                  },
                  {
                    id: 'P1.M1.T1.S2',
                    type: 'Subtask',
                    title: 'Subtask Two',
                    status: 'Planned',
                    story_points: 2,
                    dependencies: [],
                    context_scope: validContextScope(2),
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

/** Read the persisted backlog from disk after a `hack update`. */
const readBacklog = async (file: string): Promise<any> =>
  JSON.parse(await readFile(file, 'utf-8'));

const statusOf = (backlog: any, id: string): string => {
  for (const phase of backlog.backlog) {
    if (phase.id === id) return phase.status;
    for (const ms of phase.milestones ?? []) {
      if (ms.id === id) return ms.status;
      for (const task of ms.tasks ?? []) {
        if (task.id === id) return task.status;
        for (const sub of task.subtasks ?? []) {
          if (sub.id === id) return sub.status;
        }
      }
    }
  }
  throw new Error(`id not found: ${id}`);
};

describe('hack update (PRD §5.4 — end-to-end RMW + cascade + atomic write)', () => {
  let cwd: string;
  let sessionDir: string;
  let tasksFile: string;
  let origArgv: string[];
  let origExit: typeof process.exit;
  let exitMock: ReturnType<typeof vi.fn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    origArgv = process.argv;
    origExit = process.exit;
    exitMock = vi.fn();
    process.exit = exitMock as unknown as typeof process.exit;
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(async () => {
    process.exit = origExit;
    process.argv = origArgv;
    logSpy.mockRestore();
    errSpy.mockRestore();
    if (process.cwd() !== cwd) process.chdir(cwd);
    _resetBootstrap();
    if (cwd) await rm(cwd, { recursive: true, force: true });
  });

  /** Create a fresh git-init'd tmpdir with a plan/001_<hash> session + tasks.json. */
  const setupRepo = async (backlog: object = freshBacklog()): Promise<void> => {
    cwd = await mkdtemp(join(tmpdir(), 'hack-update-'));
    const r = spawnSync('git', ['init', '-q', cwd]);
    if (r.status !== 0) {
      await rm(cwd, { recursive: true, force: true });
      throw new Error(
        `git init failed: ${r.stderr ?? 'unknown error'} (is git installed?)`
      );
    }
    sessionDir = join(cwd, 'plan', '001_abc123def456');
    await mkdir(sessionDir, { recursive: true });
    tasksFile = join(sessionDir, 'tasks.json');
    await writeFile(tasksFile, JSON.stringify(backlog));
    process.chdir(cwd);
  };

  /** Wait for the detached async action handler to call process.exit. */
  const waitForExit = async (timeoutMs = 2000): Promise<void> => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise<void>(r => setImmediate(r));
      if (exitMock.mock.calls.length > 0) return;
    }
  };

  const run = async (args: string[]): Promise<void> => {
    process.argv = ['node', 'hack', ...args];
    parseCLIArgs();
    await waitForExit();
  };

  const stdout = (): string =>
    logSpy.mock.calls.map(c => String(c[0])).join('\n');
  const stderrText = (): string =>
    errSpy.mock.calls.map(c => String(c[0])).join('');

  it('hack update 1 done → cascades Complete to EVERY item under P1 (atomic write)', async () => {
    await setupRepo();

    await run(['update', '1', 'done']);

    expect(exitMock.mock.calls[0]?.[0]).toBe(0);
    expect(stdout()).toContain('Updated P1 status to Complete');

    const after = await readBacklog(tasksFile);
    expect(statusOf(after, 'P1')).toBe('Complete');
    expect(statusOf(after, 'P1.M1')).toBe('Complete');
    expect(statusOf(after, 'P1.M1.T1')).toBe('Complete');
    expect(statusOf(after, 'P1.M1.T1.S1')).toBe('Complete');
    expect(statusOf(after, 'P1.M1.T1.S2')).toBe('Complete');
  });

  it('hack update <last-incomplete-subtask> comp → promotes Task/Milestone/Phase to Complete', async () => {
    // Seed: S1 already Complete; completing S2 should promote every ancestor.
    const backlog = freshBacklog();
    backlog.backlog[0].milestones[0].tasks[0].subtasks[0].status = 'Complete';
    backlog.backlog[0].milestones[0].tasks[0].subtasks[1].status = 'Complete';
    await setupRepo(backlog);

    // Recompute ancestors first by marking the task Complete via the leaf that
    // is already Complete — instead, directly drive a promote: mark the ONE
    // remaining subtask Complete and assert ancestors become Complete.
    // (Both subtasks Complete → task Complete → milestone Complete → phase Complete.)
    await run(['update', '1.1.1.2', 'comp']);

    expect(exitMock.mock.calls[0]?.[0]).toBe(0);
    const after = await readBacklog(tasksFile);
    expect(statusOf(after, 'P1.M1.T1.S2')).toBe('Complete');
    expect(statusOf(after, 'P1.M1.T1')).toBe('Complete');
    expect(statusOf(after, 'P1.M1')).toBe('Complete');
    expect(statusOf(after, 'P1')).toBe('Complete');
  });

  it('hack update <a-subtask> p → DOWNGRADES ancestors to least-progressed child', async () => {
    // Seed: everything Complete; downgrading S2 to Planned must demote the
    // Task/Milestone/Phase to the least-progressed child status (Planned).
    const backlog = freshBacklog();
    const phase = backlog.backlog[0];
    phase.status = 'Complete';
    phase.milestones[0].status = 'Complete';
    const task = phase.milestones[0].tasks[0];
    task.status = 'Complete';
    task.subtasks[0].status = 'Complete';
    task.subtasks[1].status = 'Complete';
    await setupRepo(backlog);

    await run(['update', '1.1.1.2', 'p']);

    expect(exitMock.mock.calls[0]?.[0]).toBe(0);
    const after = await readBacklog(tasksFile);
    expect(statusOf(after, 'P1.M1.T1.S2')).toBe('Planned');
    // Ancestors demote to the min-status of children (Planned < Complete).
    expect(statusOf(after, 'P1.M1.T1')).toBe('Planned');
    expect(statusOf(after, 'P1.M1')).toBe('Planned');
    expect(statusOf(after, 'P1')).toBe('Planned');
  });

  it('hack update 1.1.1.1 done -o json → stdout JSON {id,status,title} + file written', async () => {
    await setupRepo();

    await run(['update', '1.1.1.1', 'done', '-o', 'json']);

    expect(exitMock.mock.calls[0]?.[0]).toBe(0);
    const emitted = JSON.parse(stdout());
    expect(emitted).toEqual({
      id: 'P1.M1.T1.S1',
      status: 'Complete',
      title: 'Subtask One',
    });
    // BUG-2: under `-o json` the handler routes structured logs to stderr so
    // stdout stays a pure machine-readable payload (no leading pino INFO line).
    expect(mockSetLogDestination).toHaveBeenCalledWith(process.stderr);

    const after = await readBacklog(tasksFile);
    expect(statusOf(after, 'P1.M1.T1.S1')).toBe('Complete');
  });

  it('hack update 9.9.9.9 done → exit 1 + not found; file UNCHANGED (no partial write)', async () => {
    await setupRepo();
    const before = await readFile(tasksFile, 'utf-8');

    await run(['update', '9.9.9.9', 'done']);

    expect(exitMock.mock.calls[0]?.[0]).toBe(1);
    expect(stderrText()).toContain('Task not found: 9.9.9.9');

    // The not-found short-circuit happens BEFORE the lock+RMW, so tasks.json
    // is byte-for-byte unchanged (no partial / atomic-rename write occurred).
    const after = await readFile(tasksFile, 'utf-8');
    expect(after).toBe(before);
  });

  it('no leftover tasks.json.tmp after a successful atomic write', async () => {
    await setupRepo();

    await run(['update', '1.1.1.1', 'done']);

    expect(exitMock.mock.calls[0]?.[0]).toBe(0);
    // writeTasksJSON uses an atomic temp+rename; no .tmp artifact remains, and
    // the exclusive lockfile is released (finally) once the RMW completes.
    const entries = await readdir(sessionDir);
    expect(entries.filter(e => e.endsWith('.tmp'))).toEqual([]);
    expect(entries.filter(e => e.includes('.lock'))).toEqual([]);
    // tasks.json itself is present (the atomic rename landed).
    expect(entries).toContain('tasks.json');
  });
});
