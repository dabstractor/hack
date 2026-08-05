/**
 * Unit tests for `resolveRepositoryRoot` (PRD §9.8 — upward `.git` traversal)
 *
 * @remarks
 * Mocks `node:fs` (`existsSync`/`realpathSync`) to synthesize `.git` presence per directory,
 * then asserts every branch of the resolver: found-at-start, walk-up-then-found, `.git` as a
 * directory AND as a file, nearest-ancestor-wins (nested repos), filesystem-root-reached throw,
 * the explicit path branches (present/absent), and the module-singleton accessors (throw before
 * resolution; correct after).
 *
 * The module singleton (`_repoRoot`/`_invocationCwd`) is process-global, so each test re-imports
 * a FRESH module via `vi.resetModules()` + dynamic `import()` to reset that state (otherwise the
 * accessor-unset branches would be unreachable after the first resolving test).
 *
 * @see {@link ../../../src/utils/repo-root.ts}
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// `node:fs` is mocked per-test via the factory below; re-imported fresh in beforeEach.
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  realpathSync: vi.fn(),
}));

// Re-import the mocked fs so each test can (re)configure its fns.
import { existsSync, realpathSync } from 'node:fs';

// Type alias for the freshly-imported module shape (resolved in beforeEach).
type RepoRootModule = typeof import('../../../src/utils/repo-root.js');
let mod: RepoRootModule;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
  // Re-import so the module singleton (_repoRoot/_invocationCwd) is fresh per test.
  mod = await import('../../../src/utils/repo-root.js');
  // Default realpath: identity (each test may override).
  vi.mocked(realpathSync).mockImplementation(p => p as string);
});

// ============================================================================
// traverseUp — default upward traversal
// ============================================================================

describe('resolveRepositoryRoot — default upward traversal', () => {
  it('finds .git at the start dir (no walk)', () => {
    // SETUP — start dir itself has .git.
    vi.mocked(existsSync).mockImplementation(p => String(p) === '/repo/.git');

    // EXECUTE
    const result = mod.resolveRepositoryRoot('/repo');

    // VERIFY
    expect(result.repoRoot).toBe('/repo');
    expect(result.invocationCwd).toBe('/repo');
  });

  it('walks up several levels to find .git', () => {
    // SETUP — only /repo has .git; start 3 levels deep.
    vi.mocked(existsSync).mockImplementation(p => String(p) === '/repo/.git');

    // EXECUTE
    const result = mod.resolveRepositoryRoot('/repo/a/b/c');

    // VERIFY
    expect(result.repoRoot).toBe('/repo');
    expect(result.invocationCwd).toBe('/repo/a/b/c');
  });

  it('finds .git as a directory (normal clone)', () => {
    vi.mocked(existsSync).mockImplementation(p => String(p) === '/clone/.git');
    expect(mod.resolveRepositoryRoot('/clone/sub').repoRoot).toBe('/clone');
  });

  it('finds .git as a file (worktree/submodule gitdir pointer)', () => {
    // existsSync is true for BOTH directory and file forms — the resolver does not stat.
    vi.mocked(existsSync).mockImplementation(
      p => String(p) === '/worktree/.git'
    );
    expect(mod.resolveRepositoryRoot('/worktree/deep').repoRoot).toBe(
      '/worktree'
    );
  });

  it('nearest ancestor wins (inner repo inside outer repo)', () => {
    // SETUP — both /outer and /outer/inner have .git; inner is nearest to the start.
    vi.mocked(existsSync).mockImplementation(
      p => String(p) === '/outer/inner/.git' || String(p) === '/outer/.git'
    );

    // EXECUTE + VERIFY — inner wins (first .git found walking up).
    expect(mod.resolveRepositoryRoot('/outer/inner/sub').repoRoot).toBe(
      '/outer/inner'
    );
  });

  it('canonicalizes the result via realpathSync', () => {
    vi.mocked(existsSync).mockImplementation(
      p => String(p) === '/symlinked/.git'
    );
    vi.mocked(realpathSync).mockReturnValue('/real/path');

    expect(mod.resolveRepositoryRoot('/symlinked/sub').repoRoot).toBe(
      '/real/path'
    );
    expect(realpathSync).toHaveBeenCalledWith('/symlinked');
  });
});

// ============================================================================
// traverseUp — filesystem root reached → NotARepositoryError
// ============================================================================

describe('resolveRepositoryRoot — root reached without .git', () => {
  it('throws NotARepositoryError when no .git is found up to the filesystem root', () => {
    // SETUP — no .git anywhere.
    vi.mocked(existsSync).mockReturnValue(false);

    // EXECUTE + VERIFY
    expect(() => mod.resolveRepositoryRoot('/a/b/c')).toThrow(
      mod.NotARepositoryError
    );
    const err = (() => {
      try {
        mod.resolveRepositoryRoot('/a/b/c');
      } catch (e) {
        return e as InstanceType<typeof mod.NotARepositoryError>;
      }
    })();
    expect(err.searchedFrom).toBe('/a/b/c');
    expect(err.explicit).toBe(false);
    expect(err.message).toContain('/a/b/c');
    expect(err.message).toContain('--repo-root'); // remediation present
  });
});

// ============================================================================
// resolveExplicit — opts.explicit branches
// ============================================================================

describe('resolveRepositoryRoot — explicit override', () => {
  it('returns the explicit path (canonicalized) when it contains .git', () => {
    vi.mocked(existsSync).mockImplementation(
      p => String(p) === '/explicit/.git'
    );
    vi.mocked(realpathSync).mockReturnValue('/explicit-real');

    const result = mod.resolveRepositoryRoot('/cwd', {
      explicit: '/explicit',
    });

    expect(result.repoRoot).toBe('/explicit-real');
    expect(realpathSync).toHaveBeenCalledWith('/explicit');
  });

  it('throws NotARepositoryError(explicit:true) when the explicit path lacks .git', () => {
    vi.mocked(existsSync).mockReturnValue(false);

    expect(() =>
      mod.resolveRepositoryRoot('/cwd', { explicit: '/no-git' })
    ).toThrow(mod.NotARepositoryError);

    let err: InstanceType<typeof mod.NotARepositoryError> | undefined;
    try {
      mod.resolveRepositoryRoot('/cwd', { explicit: '/no-git' });
    } catch (e) {
      err = e as InstanceType<typeof mod.NotARepositoryError>;
    }
    expect(err?.explicit).toBe(true);
    expect(err?.searchedFrom).toBe('/no-git');
    expect(err?.message).toContain('/no-git');
    expect(err?.message).toContain('--repo-root');
  });
});

// ============================================================================
// Module-singleton accessors
// ============================================================================

describe('getRepoRoot / getInvocationCwd accessors', () => {
  it('throw before resolveRepositoryRoot has run', () => {
    // Fresh module (beforeEach re-imports) → singleton is unset.
    expect(() => mod.getRepoRoot()).toThrow(/not resolved yet/i);
    expect(() => mod.getInvocationCwd()).toThrow(/not captured yet/i);
  });

  it('return the resolved values after resolveRepositoryRoot runs', () => {
    vi.mocked(existsSync).mockImplementation(p => String(p) === '/repo/.git');
    vi.mocked(realpathSync).mockReturnValue('/repo-real');

    mod.resolveRepositoryRoot('/repo/sub');

    expect(mod.getRepoRoot()).toBe('/repo-real');
    expect(mod.getInvocationCwd()).toBe('/repo/sub');
  });
});

// ============================================================================
// bootstrapRepoRoot — idempotent resolve + chdir wrapper (BUG-001 fix step 1)
// ============================================================================
//
// Mirrors the file's vi.mock('node:fs') + fresh per-test `mod` re-import (so _bootstrapped resets
// per case). process.chdir is spied with a no-op impl because the mocked-fs paths ('/repo') are
// not real directories — a real chdir('/repo') would ENOENT.

describe('bootstrapRepoRoot', () => {
  // Spy process.chdir with a no-op so mocked-fs paths don't ENOENT; restored after each case.
  let chdirSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    chdirSpy = vi
      .spyOn(process, 'chdir')
      .mockImplementation((() => {}) as () => void);
  });

  afterEach(() => {
    chdirSpy.mockRestore();
  });

  it('chdirs to the resolved root on first call and sets the guard', () => {
    // SETUP — '/repo' has .git; realpath identity (the default from the file-level beforeEach).
    vi.mocked(existsSync).mockImplementation(p => String(p) === '/repo/.git');

    // EXECUTE
    const repoRoot = mod.bootstrapRepoRoot('/repo/sub');

    // VERIFY — resolve + chdir ran; returns the canonicalized root; guard set.
    expect(repoRoot).toBe('/repo');
    expect(chdirSpy).toHaveBeenCalledTimes(1);
    expect(chdirSpy).toHaveBeenCalledWith('/repo');
    expect(mod.getRepoRoot()).toBe('/repo');
  });

  it('is idempotent — a second call (no reset) is a no-op with no second chdir', () => {
    // SETUP
    vi.mocked(existsSync).mockImplementation(p => String(p) === '/repo/.git');

    // EXECUTE — first call resolves + chdirs.
    const r1 = mod.bootstrapRepoRoot('/repo');
    // Second call should short-circuit via the guard.
    const r2 = mod.bootstrapRepoRoot('/repo');

    // VERIFY — same root; chdir still called exactly once (guard short-circuited call #2).
    expect(r2).toBe(r1);
    expect(chdirSpy).toHaveBeenCalledTimes(1);
  });

  it('_resetBootstrap allows a re-bootstrap (chdir runs again)', () => {
    // SETUP
    vi.mocked(existsSync).mockImplementation(p => String(p) === '/repo/.git');

    // EXECUTE — first bootstrap.
    mod.bootstrapRepoRoot('/repo');
    expect(chdirSpy).toHaveBeenCalledTimes(1);

    // Reset → next call re-runs resolve + chdir.
    mod._resetBootstrap();
    mod.bootstrapRepoRoot('/repo');

    // VERIFY — chdir call count rose to 2 (the guard no longer short-circuits after reset).
    expect(chdirSpy).toHaveBeenCalledTimes(2);
  });

  it('propagates NotARepositoryError and stays un-bootstrapped (retryable)', () => {
    // SETUP — no .git anywhere → resolveRepositoryRoot throws NotARepositoryError.
    vi.mocked(existsSync).mockReturnValue(false);

    // EXECUTE + VERIFY — the throw propagates.
    expect(() => mod.bootstrapRepoRoot('/nowhere')).toThrow(
      mod.NotARepositoryError
    );
    // _bootstrapped stayed false: flip existsSync back on and a follow-up call re-runs resolve+chdir.
    vi.mocked(existsSync).mockImplementation(p => String(p) === '/repo/.git');
    mod.bootstrapRepoRoot('/repo');
    expect(chdirSpy).toHaveBeenCalledTimes(1); // the re-run did chdir
  });

  it('passes opts.explicit through to resolveRepositoryRoot', () => {
    // SETUP — only the EXPLICIT path '/repo' has .git (the start dir '/start' does not), proving
    // the explicit branch — not the default upward walk — resolved the root.
    vi.mocked(existsSync).mockImplementation(p => String(p) === '/repo/.git');

    // EXECUTE
    const repoRoot = mod.bootstrapRepoRoot('/start', { explicit: '/repo' });

    // VERIFY — used the explicit root.
    expect(repoRoot).toBe('/repo');
    expect(chdirSpy).toHaveBeenCalledWith('/repo');
  });
});
