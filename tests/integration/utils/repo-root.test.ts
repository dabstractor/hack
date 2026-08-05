/**
 * Integration tests for `resolveRepositoryRoot` (PRD §9.8) — REAL tmpdir
 *
 * @remarks
 * Exercises the resolver against a REAL filesystem (a `mkdtempSync` tmpdir with actual `.git`
 * entries), complementing the `vi.mock('node:fs')` unit suite. Covers:
 * - `.git` as a directory (normal clone) found from a nested subdir.
 * - `.git` as a file (worktree/submodule `gitdir:` pointer) found.
 * - nested traversal walking UP several levels.
 *
 * The filesystem-root-reached throw branch is covered by the mocked unit suite (a real-fs walk
 * from an arbitrary tmpdir can hit a parent that legitimately contains `.git`, making it flaky).
 *
 * @see {@link ../../../src/utils/repo-root.ts}
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  resolveRepositoryRoot,
  NotARepositoryError,
} from '../../../src/utils/repo-root.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'repo-root-int-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('resolveRepositoryRoot — real tmpdir', () => {
  it('finds .git as a directory (normal clone) from a nested subdir', () => {
    // SETUP — a normal git clone layout: tmp/.git (dir), tmp/a/b/c (nested).
    mkdirSync(join(tmp, '.git'));
    const nested = join(tmp, 'a', 'b', 'c');
    mkdirSync(nested, { recursive: true });

    // EXECUTE
    const result = resolveRepositoryRoot(nested);

    // VERIFY — walks up to tmp; canonicalized via realpath.
    expect(result.repoRoot).toBe(realpathSync(tmp));
    expect(result.invocationCwd).toBe(nested);
  });

  it('finds .git as a file (worktree/submodule gitdir pointer)', () => {
    // SETUP — a worktree/submodule layout: tmp/.git is a FILE pointing at the real gitdir.
    writeFileSync(join(tmp, '.git'), 'gitdir: /elsewhere/repo.git\n');
    mkdirSync(join(tmp, 'sub'), { recursive: true });

    // EXECUTE + VERIFY — existsSync accepts the file form.
    expect(resolveRepositoryRoot(join(tmp, 'sub')).repoRoot).toBe(
      realpathSync(tmp)
    );
  });

  it('finds the start dir itself when it contains .git (no walk)', () => {
    // SETUP
    mkdirSync(join(tmp, '.git'));

    // EXECUTE + VERIFY
    expect(resolveRepositoryRoot(tmp).repoRoot).toBe(realpathSync(tmp));
  });

  it('throws NotARepositoryError when an explicit path lacks .git', () => {
    // SETUP — tmp has NO .git.
    mkdirSync(join(tmp, 'empty'), { recursive: true });

    // EXECUTE + VERIFY
    expect(() =>
      resolveRepositoryRoot('/cwd', { explicit: join(tmp, 'empty') })
    ).toThrow(NotARepositoryError);
  });
});
