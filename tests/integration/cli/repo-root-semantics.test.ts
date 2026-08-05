/**
 * Integration tests: `--repo-root` flag + explicit-path vs default-path semantics (PRD §9.8)
 *
 * @remarks
 * Real-tmpdir git-repo tests proving the P1.M1.T1.S2 contracts:
 * - DEFAULT `./PRD.md` resolves against the repo root (not the invocation subdir) after the chdir.
 * - EXPLICIT `--prd ./relative/PRD.md` pre-resolves against INVOCATION_CWD (absolute), so it
 *   survives the chdir and does NOT get re-resolved against the repo root.
 * - `--repo-root <path>` (with `.git`) pins the root and skips the upward `.git` search.
 * - `--repo-root <path>` (no `.git`) throws `NotARepositoryError` with `explicit: true`.
 *
 * `main()` is NOT exported (it runs on import via `void main()`), so these tests drive the
 * S2 semantics directly through the public surface they consume: `parseCLIArgs` (explicit-vs-
 * default `--prd` pre-resolution) and `resolveRepositoryRoot` (the explicit branch that
 * `--repo-root` wires into). One end-to-end cwd-restoring test proves the default-from-subdir
 * chdir sequence (the resolver + chdir + a repo-root-relative resolve('PRD.md')).
 *
 * @see {@link ../../../src/utils/repo-root.ts}
 * @see {@link ../../../src/cli/index.ts}
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  resolveRepositoryRoot,
  NotARepositoryError,
} from '../../../src/utils/repo-root.js';
import { parseCLIArgs } from '../../../src/cli/index.js';

// ============================================================================
// FIXTURES / HELPERS
// ============================================================================

let tmpDirs: string[] = [];
const originalCwd = process.cwd();
const originalArgv = process.argv;

/** Create a throwaway tmp dir and track it for cleanup. */
function mkTmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}

/** Set process.argv to a fresh `hack ...` invocation. */
function setArgv(args: string[] = []): void {
  process.argv = ['node', '/path/to/hack', ...args];
}

afterEach(() => {
  // Restore process state (parseCLIArgs + the resolver's explicit branch may chdir/mutate argv).
  process.chdir(originalCwd);
  process.argv = originalArgv;
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
  tmpDirs = [];
});

beforeEach(() => {
  // Ensure a clean argv baseline.
  setArgv([]);
});

// ============================================================================
// DEFAULT --prd resolves against the repo root (not the invocation subdir)
// ============================================================================

describe('default --prd resolves against the repo root', () => {
  it('resolves to <repoRoot>/PRD.md when invoked from a subdir (after the bootstrap chdir)', () => {
    // SETUP — tmp is the repo root (.git + PRD.md live there); invoke from tmp/src/a/b.
    const tmp = mkTmp('repo-default-');
    mkdirSync(join(tmp, '.git'));
    writeFileSync(join(tmp, 'PRD.md'), '# root PRD');
    mkdirSync(join(tmp, 'src', 'a', 'b'), { recursive: true });
    const invocationCwd = join(tmp, 'src', 'a', 'b');

    // Drive the resolver + chdir exactly as main() does (main() isn't exported, so reproduce the
    // bootstrap: resolveRepositoryRoot(INVOCATION_CWD) → process.chdir(repoRoot)).
    process.chdir(invocationCwd); // simulate the user invoking from the subdir
    const { repoRoot } = resolveRepositoryRoot(process.cwd());
    process.chdir(repoRoot);

    // VERIFY — the default './PRD.md' (left relative by parseCLIArgs) now resolves to the ROOT PRD,
    // exactly like the ~20 downstream resolve('PRD.md') sites do post-chdir.
    expect(resolve('PRD.md')).toBe(join(tmp, 'PRD.md'));
    expect(process.cwd()).toBe(repoRoot);
  });
});

// ============================================================================
// EXPLICIT --prd resolves against INVOCATION_CWD (the §9.8.3 semantic fix)
// ============================================================================

describe('explicit --prd resolves against INVOCATION_CWD', () => {
  it('pre-resolves an explicit relative --prd against INVOCATION_CWD (absolute)', () => {
    // SETUP — tmp is the repo root; user invokes from tmp/src/a/b with an explicit --prd ./PRD.md
    // pointing at the SUBDIR PRD (NOT the root PRD).
    const tmp = mkTmp('repo-explicit-');
    mkdirSync(join(tmp, '.git'));
    mkdirSync(join(tmp, 'src', 'a', 'b'), { recursive: true });
    writeFileSync(join(tmp, 'PRD.md'), '# root PRD (must NOT be used)');
    writeFileSync(join(tmp, 'src', 'a', 'b', 'PRD.md'), '# subdir PRD');
    const invocationCwd = join(tmp, 'src', 'a', 'b');

    // EXECUTE — parseCLIArgs with cwd === INVOCATION_CWD (S1's chdir runs AFTER parseCLIArgs).
    process.chdir(invocationCwd);
    setArgv(['--prd', './PRD.md']);
    const result = parseCLIArgs();

    // The result may be a subcommand or CLIArgs; assert the CLIArgs shape.
    expect(result).toMatchObject({ prd: expect.any(String) });
    const args = result as { prd: string };

    // VERIFY — explicit --prd is ABSOLUTE and INVOCATION_CWD-relative: it points at the SUBDIR PRD,
    // not the root PRD. This is the §9.8.9 acceptance criterion (explicit-vs-default).
    expect(args.prd).toBe(resolve(invocationCwd, './PRD.md'));
    expect(args.prd).toBe(join(invocationCwd, 'PRD.md'));
    expect(args.prd).not.toBe(join(tmp, 'PRD.md'));
  });

  it('leaves the DEFAULT ./PRD.md relative (NOT pre-resolved) so it resolves against repoRoot later', () => {
    // SETUP — no --prd; Commander supplies the default './PRD.md'.
    const tmp = mkTmp('repo-default-arg-');
    mkdirSync(join(tmp, '.git'));
    process.chdir(tmp);

    setArgv([]); // no --prd
    const result = parseCLIArgs();
    expect(result).toMatchObject({ prd: expect.any(String) });
    const args = result as { prd: string };

    // VERIFY — default stays relative (the §9.8.3 invariant: only EXPLICIT --prd is pre-resolved).
    expect(args.prd).toBe('./PRD.md');
  });
});

// ============================================================================
// --repo-root <path> (explicit) pins the root and skips the upward search
// ============================================================================

describe('--repo-root explicit override', () => {
  it('pins the root (skips the upward .git search) when <path> contains .git', () => {
    // SETUP — tmp has .git; a sibling dir (also with .git) is the cwd. The explicit override
    // must pin tmp, NOT walk up from cwd.
    const tmp = mkTmp('repo-pin-');
    const otherRepo = mkTmp('repo-pin-other-');
    mkdirSync(join(tmp, '.git'));
    mkdirSync(join(otherRepo, '.git'));
    process.chdir(otherRepo); // cwd is a DIFFERENT repo

    // EXECUTE — the explicit branch resolves <path> against INVOCATION_CWD (= otherRepo), so pass
    // an absolute tmp to make the test deterministic regardless of cwd.
    const { repoRoot } = resolveRepositoryRoot(process.cwd(), {
      explicit: tmp,
    });

    // VERIFY — pinned to tmp (realpath-canonicalized); the upward search from otherRepo was skipped.
    expect(repoRoot).toBe(resolve(tmp));
    expect(repoRoot).not.toBe(resolve(otherRepo));
  });

  it('throws NotARepositoryError(explicit:true) when <path> lacks .git', () => {
    // SETUP — tmp has NO .git.
    const tmp = mkTmp('repo-no-git-');
    process.chdir(tmp);

    // EXECUTE + VERIFY — the explicit branch hard-errors (§9.8.6).
    expect(() =>
      resolveRepositoryRoot(process.cwd(), { explicit: tmp })
    ).toThrow(NotARepositoryError);

    let caught: NotARepositoryError | undefined;
    try {
      resolveRepositoryRoot(process.cwd(), { explicit: tmp });
    } catch (e) {
      caught = e as NotARepositoryError;
    }
    expect(caught).toBeInstanceOf(NotARepositoryError);
    expect(caught!.explicit).toBe(true); // distinguishes the explicit-path error from the default traversal
  });

  it('errors on a .git FILE (worktree pointer) is out of S2 scope — supports .git DIR form', () => {
    // SETUP — .git as a directory (the common on-disk form). Confirms the happy path the
    // resolver's explicit branch accepts (the worktree/submodule FILE-form cases are T2).
    const tmp = mkTmp('repo-git-dir-');
    mkdirSync(join(tmp, '.git'));
    process.chdir(tmp);

    const { repoRoot } = resolveRepositoryRoot(process.cwd(), {
      explicit: '.',
    });
    expect(repoRoot).toBe(resolve(tmp));
  });
});
