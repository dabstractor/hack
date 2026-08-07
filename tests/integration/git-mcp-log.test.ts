/**
 * Integration test: `getRecentCommitMessages` against REAL simple-git (BUG-001 regression net).
 *
 * @remarks
 * BUG-001 was a critical default-config-breaking bug: `getRecentCommitMessages` passed simple-git the
 * INVALID option `{ maxEntries }` instead of `{ maxCount }`. CI missed it because the unit test
 * asserted the broken contract against an arg-ignoring `vi.fn()` mock. S1 fixed the source (`maxCount`);
 * this test is the regression net the unit mock could not provide.
 *
 * This test calls the REAL `simple-git` (no `vi.mock`) against a throwaway temp git repo seeded with
 * 5 commits. If the source ever reverts to an invalid option name, real `git log` throws
 * `fatal: ambiguous argument 'maxEntries=N'…` → the `await` rejects → this test FAILS. No mock to mask it.
 *
 * Three cases: `count < total` (3 of 5), `count === total` (5 of 5), `count === 0` (short-circuit → []).
 *
 * @see {@link ../../src/tools/git-mcp.ts} — getRecentCommitMessages + validateRepositoryPath (both real)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { simpleGit } from 'simple-git'; // REAL — for setup (do NOT vi.mock)
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getRecentCommitMessages } from '../../src/tools/git-mcp.js'; // REAL — under test (do NOT vi.mock)

// Seeded in chronological order; commit 5 ('feat: commit 5') is the NEWEST (git log is newest-first).
const MSGS = [
  'commit 1',
  'fix: commit 2',
  'docs: commit 3',
  'refactor: commit 4',
  'feat: commit 5',
];

// NEWEST-FIRST expected order (the order git log returns .all in).
const NEWEST_FIRST = [...MSGS].reverse();

let dir: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'git-log-test-'));
  const git = simpleGit(dir);
  await git.init();
  // Hermetic git identity — CI may lack a global git config; set it after init, before the first commit.
  await git.addConfig('user.email', 'test@test.com');
  await git.addConfig('user.name', 'Test');
  for (let i = 0; i < MSGS.length; i++) {
    // Unique file per commit so `git add('.')` always has something to stage.
    writeFileSync(join(dir, `file${i}.txt`), `content ${i}\n`);
    await git.add('.');
    await git.commit(MSGS[i]);
  }
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('getRecentCommitMessages — real simple-git against a temp git repo', () => {
  it('returns the N newest commit messages, newest-first (count < total: 3 of 5)', async () => {
    // EXECUTE — REAL getRecentCommitMessages against the REAL temp repo (no mocks).
    // If the source used an invalid log() option, real git throws 'fatal: ambiguous argument…'
    // → the await rejects → this it() FAILS. That is the regression-catching property.
    const result = await getRecentCommitMessages(3, dir);

    // VERIFY — the 3 NEWEST messages, newest-first. Trim guards against any platform trailing newline.
    expect(result.map(m => m.trim())).toEqual(NEWEST_FIRST.slice(0, 3));
  });

  it('returns all commits newest-first when count === total (5 of 5)', async () => {
    const result = await getRecentCommitMessages(5, dir);

    expect(result.map(m => m.trim())).toEqual(NEWEST_FIRST);
  });

  it('returns [] for count === 0 (short-circuit, no git call)', async () => {
    // The count===0 guard is the function's first line — it returns [] BEFORE validateRepositoryPath,
    // so this passes even though (under a maxEntries regression) cases 1 & 2 would fail. By design.
    const result = await getRecentCommitMessages(0, dir);

    expect(result).toEqual([]);
  });
});
