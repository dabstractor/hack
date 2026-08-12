/**
 * Integration test for `generateCommitMessage` under the DEFAULT `auto` config.
 *
 * @remarks
 * Mock rewiring rationale: the in-process commit-message agent
 * (`src/agents/commit-message-agent.ts`) was removed per PRD §9.10.1, and
 * `generateCommitMessage` (P1.M2.T2.S1) now delegates to the external
 * `stagecoach` binary via `spawn`. The previous revision of this test mocked
 * `createCommitMessageAgent` at the (now-deleted) agent module boundary — that
 * mock target no longer exists. This revision mocks the STAGECOACH BINARY
 * BOUNDARY instead:
 *   - `resolveStagecoachBinary` → a fake path (`/fake/stagecoach`), so no real
 *     binary resolution/platform logic runs.
 *   - `node:child_process.spawn` → a fake child that emits the configured
 *     stdout then a `close(0)`, so the function's argv-construction + spawn +
 *     stdout-collection path is exercised end-to-end without invoking a real
 *     process.
 *
 * This proves the §5.1 default-config path: with `PRP_COMMIT_STYLE` unset
 * (→ `auto`), the argv contains `--dry-run` + `--single` and NO `--format`
 * flag, and the trimmed stagecoach stdout is returned verbatim. The previous
 * BUG-001 `maxEntries` regression net is obsolete — `generateCommitMessage` no
 * longer reads commit history itself; the binary reads the staged index.
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { simpleGit } from 'simple-git';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { resolveStagecoachBinary } from '../../src/utils/stagecoach-resolver.js';

// Mock the stagecoach binary boundary (§9.10.1). Bare factories are hoist-safe;
// `spawn`/`resolveStagecoachBinary` become `vi.fn()`s we drive below.
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));
vi.mock('../../src/utils/stagecoach-resolver.js', () => ({
  resolveStagecoachBinary: vi.fn(() => '/fake/stagecoach'),
}));

import { generateCommitMessage } from '../../src/utils/git-commit.js';

const mockSpawn = spawn as unknown as ReturnType<typeof vi.fn>;
const mockResolveStagecoachBinary =
  resolveStagecoachBinary as unknown as ReturnType<typeof vi.fn>;

/**
 * Build a fake `child_process.ChildProcess`-shaped object whose `stdout` emits
 * `stdout` then closes with code 0 on the next tick. Mirrors the real spawn
 * event contract `generateCommitMessage` listens to (`stdout` `data`, `close`).
 */
function fakeChild(stdout: string): NodeJS.EventEmitter {
  const child = new EventEmitter();
  const stdoutStream = new EventEmitter();
  const stderrStream = new EventEmitter();
  // The implementation reads `child.stdout`/`child.stderr` as possibly-undefined
  // streams; attach them directly.
  (child as { stdout: NodeJS.EventEmitter }).stdout = stdoutStream;
  (child as { stderr: NodeJS.EventEmitter }).stderr = stderrStream;
  process.nextTick(() => {
    stdoutStream.emit('data', Buffer.from(stdout));
    child.emit('close', 0);
  });
  return child;
}

describe('generateCommitMessage — default auto config (stagecoach binary boundary mocked)', () => {
  let dir: string;

  beforeEach(async () => {
    // DEFAULT config (env unset → auto): the path that previously broke under
    // `--format` being incorrectly added.
    delete process.env.PRP_COMMIT_STYLE;
    delete process.env.PRP_COMMIT_STYLE_EXAMPLES;

    mockResolveStagecoachBinary.mockReturnValue('/fake/stagecoach');
    mockSpawn.mockImplementation(() =>
      fakeChild('feat: generated commit message\n')
    );

    // Seed a real temp repo so the binary boundary has a valid cwd (the function
    // spawns with `cwd: repoRoot`). A bare repo with one commit suffices.
    dir = mkdtempSync(join(tmpdir(), 'commit-style-e2e-'));
    const git = simpleGit(dir);
    await git.init();
    await git.addConfig('user.email', 'test@test.com');
    await git.addConfig('user.name', 'Test');
    writeFileSync(join(dir, 'file.txt'), 'content\n');
    await git.add('.');
    await git.commit('feat: example commit');
  });

  afterEach(() => {
    mockSpawn.mockReset();
    mockResolveStagecoachBinary.mockReset();
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns the stagecoach stdout and spawns with the default-auto argv (PRD §5.1)', async () => {
    // EXECUTE — first arg is repoRoot (dir), NOT a diff. The binary reads the
    // staged index itself; the diff argument is unused.
    const result = await generateCommitMessage(dir);

    // VERIFY: the trimmed stagecoach stdout, NOT a fallback placeholder.
    expect(result).toBe('feat: generated commit message');
    expect(result).not.toBe(
      'chore: commit-gen failed (exit 0); fallback commit'
    );

    // VERIFY: the binary was spawned exactly once.
    expect(mockSpawn).toHaveBeenCalledTimes(1);

    // VERIFY (a): the default-auto argv contains --dry-run + --single.
    const argv = mockSpawn.mock.calls[0][1] as string[];
    expect(argv).toEqual(expect.arrayContaining(['--dry-run', '--single']));

    // VERIFY (b): under the default `auto` style, NO --format flag is emitted.
    expect(argv).not.toContain('--format');
  });
});
