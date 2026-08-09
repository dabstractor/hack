/**
 * Integration tests for `hack status` / `hack task` output (PRD §5.3, §5.4).
 *
 * @remarks
 * Drives the real CLI parser (`parseCLIArgs`) against a real temp `plan/`
 * directory so the task-file discovery (bugfix vs main), the stderr source
 * note, and the completion-based color-coding are exercised end-to-end.
 *
 * @see {@link ../../src/cli/index.ts | taskAction handler}
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import chalk from 'chalk';
import { parseCLIArgs } from '../../src/cli/index.js';
import { _resetBootstrap } from '../../src/utils/repo-root.js';

// Silence the CLI logger so its output does not interfere with console spies.
const { mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(() => mockLogger),
  },
}));
vi.mock('../../src/utils/logger.js', () => ({
  getLogger: vi.fn(() => mockLogger),
}));

/** A backlog with a Complete phase (green) and a Planned subtask (gray). */
const BACKLOG = {
  backlog: [
    {
      id: 'P1',
      type: 'Phase',
      title: 'Phase One',
      status: 'Complete',
      milestones: [
        {
          id: 'P1.M1',
          type: 'Milestone',
          title: 'Milestone One',
          status: 'Implementing',
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
                  dependencies: [],
                  context_scope: '',
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

/** A backlog whose only item has a status NOT in the tsk color map (→ white). */
const BACKLOG_UNKNOWN_STATUS = {
  backlog: [
    {
      id: 'P1',
      type: 'Phase',
      title: 'Phase One',
      status: 'Obsolete',
      milestones: [],
    },
  ],
};

describe('hack status / hack task (PRD §5.3 discovery + §5.4 color-coding)', () => {
  let cwd: string;
  let origCwd: string;
  let origArgv: string[];
  let origExit: typeof process.exit;
  let origChalkLevel: number;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    origCwd = process.cwd();
    origArgv = process.argv;
    origExit = process.exit;
    // Force color ON so the chalk-based color-coding is observable in tests
    // (stdout is not a TTY under vitest, which would otherwise disable it).
    origChalkLevel = chalk.level;
    chalk.level = 1;
    process.exit = vi.fn() as unknown as typeof process.exit;
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(async () => {
    chalk.level = origChalkLevel;
    process.exit = origExit;
    process.argv = origArgv;
    logSpy.mockRestore();
    errSpy.mockRestore();
    if (process.cwd() !== origCwd) process.chdir(origCwd);
    // Reset the repo-root bootstrap guard so the next test re-resolves from its own (git-init'd)
    // tmpdir rather than reusing this test's chdir'd root (the preAction hook sets it once).
    _resetBootstrap();
    if (cwd) await rm(cwd, { recursive: true, force: true });
  });

  /** Create a fresh tmpdir that is a real git repo (so the preAction hook's repo-root bootstrap
   * does not throw NotARepositoryError — PRD §9.8.5). Caller cleans up in afterEach. */
  const mkRepoTmp = async (): Promise<string> => {
    const d = await mkdtemp(join(tmpdir(), 'hack-cli-'));
    const r = spawnSync('git', ['init', '-q', d]);
    if (r.status !== 0) {
      await rm(d, { recursive: true, force: true });
      throw new Error(
        `git init failed: ${r.stderr ?? 'unknown error'} (is git installed?)`
      );
    }
    return d;
  };

  /** Wait for the detached async action handler to call process.exit. */
  const waitForExit = async (timeoutMs = 1000): Promise<void> => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise<void>(r => setImmediate(r));
      if (vi.mocked(process.exit).mock.calls.length > 0) return;
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

  const makeSession = async (
    overrides: { withBugfix?: boolean; backlog?: object } = {}
  ): Promise<void> => {
    const backlog = overrides.backlog ?? BACKLOG;
    const sessionDir = join(cwd, 'plan', '001_14b9dc2a33c7');
    await mkdir(sessionDir, { recursive: true });
    await writeFile(join(sessionDir, 'tasks.json'), JSON.stringify(backlog));
    if (overrides.withBugfix) {
      const bugfixDir = join(sessionDir, 'bugfix', '001_a1b2c3d4e5f6');
      await mkdir(bugfixDir, { recursive: true });
      await writeFile(join(bugfixDir, 'tasks.json'), JSON.stringify(backlog));
    }
  };

  it('prefers the bugfix child and prints the bugfix source note to stderr', async () => {
    cwd = await mkRepoTmp();
    process.chdir(cwd);
    await makeSession({ withBugfix: true });

    await run(['status']);

    expect(stderrText()).toContain('Using bugfix tasks');
    expect(stderrText()).toContain('bugfix/001_a1b2c3d4e5f6/tasks.json');
  });

  it('falls back to main tasks and prints the main source note when no bugfix exists', async () => {
    cwd = await mkRepoTmp();
    process.chdir(cwd);
    await makeSession({ withBugfix: false });

    await run(['status']);

    expect(stderrText()).toContain('Using main tasks');
    expect(stderrText()).toContain('001_14b9dc2a33c7/tasks.json');
    expect(stderrText()).not.toContain('bugfix');
  });

  it('suppresses the source note for machine-readable -o json output', async () => {
    cwd = await mkRepoTmp();
    process.chdir(cwd);
    await makeSession({ withBugfix: true });

    await run(['status', '-o', 'json']);

    expect(stderrText()).not.toContain('Using bugfix tasks');
    expect(stderrText()).not.toContain('Using main tasks');
  });

  it('default listing under -o json emits the backlog as valid JSON (BUG-1)', async () => {
    cwd = await mkRepoTmp();
    process.chdir(cwd);
    await makeSession();

    await run(['status', '-o', 'json']);

    // BUG-1: previously the default-list branch ignored `-o json` and printed
    // the colored text tree, so stdout was NOT parseable JSON. Now stdout must
    // be the backlog array verbatim, with no ANSI color escapes leaking in.
    const emitted = JSON.parse(stdout());
    expect(Array.isArray(emitted)).toBe(true);
    expect(emitted[0].id).toBe('P1');
    expect(emitted[0].milestones[0].tasks[0].subtasks[0].id).toBe(
      'P1.M1.T1.S1'
    );
    expect(stdout()).not.toContain('\x1b'); // no colored text on the json path
  });

  it('default listing under -o json works for `hack task` too (BUG-1)', async () => {
    cwd = await mkRepoTmp();
    process.chdir(cwd);
    await makeSession();

    await run(['task', '-o', 'json']);

    const emitted = JSON.parse(stdout());
    expect(Array.isArray(emitted)).toBe(true);
    expect(emitted[0].id).toBe('P1');
    expect(stdout()).not.toContain('\x1b');
  });

  it('skips discovery (no note) for an explicit --file override', async () => {
    cwd = await mkRepoTmp();
    process.chdir(cwd);
    await makeSession({ withBugfix: true });
    const file = join(cwd, 'custom.json');
    await writeFile(file, JSON.stringify(BACKLOG));

    await run(['status', '-f', file]);

    expect(stderrText()).not.toContain('Using bugfix tasks');
    expect(stderrText()).not.toContain('Using main tasks');
    // The override file's tasks are listed.
    expect(stdout()).toContain('P1.M1.T1.S1');
  });

  it('color-codes the default listing by completion status (tsk mapping)', async () => {
    cwd = await mkRepoTmp();
    process.chdir(cwd);
    await makeSession();

    await run(['status']);

    const out = stdout();
    // tsk-style format: bold ID + status-colored title/status.
    expect(out).toContain('P1.M1.T1.S1');
    expect(out).toContain(' - ');
    // Complete → green (\x1b[32m); Planned → gray (\x1b[90m).
    expect(out).toContain('\x1b[32mPhase One');
    expect(out).toContain('\x1b[90mSubtask One');
  });

  it('color-codes the `next` action output by completion status', async () => {
    cwd = await mkRepoTmp();
    process.chdir(cwd);
    await makeSession();

    await run(['status', 'next']);

    const out = stdout();
    expect(out).toContain('Next task:');
    expect(out).toContain('P1.M1.T1.S1');
    // Planned → gray status text.
    expect(out).toContain('\x1b[90mPlanned');
  });

  it('color-codes the `status` summary action labels by completion status', async () => {
    cwd = await mkRepoTmp();
    process.chdir(cwd);
    await makeSession();

    await run(['status', 'status']);

    const out = stdout();
    expect(out).toContain('Task status summary:');
    // Complete → green label appears.
    expect(out).toContain('\x1b[32mComplete');
  });

  it('renders unknown statuses via the white fallback (PRD §5.4)', async () => {
    cwd = await mkRepoTmp();
    process.chdir(cwd);
    await makeSession({ backlog: BACKLOG_UNKNOWN_STATUS });

    await run(['status']);

    const out = stdout();
    // 'Obsolete' is not in the tsk color map → chalk.white (\x1b[37m).
    expect(out).toContain('Obsolete');
    expect(out).toContain('\x1b[37m');
  });

  it('exits with code 1 when no sessions are found', async () => {
    cwd = await mkRepoTmp();
    process.chdir(cwd);

    await run(['status']);

    expect(process.exit).toHaveBeenCalledWith(1);
  });
});
