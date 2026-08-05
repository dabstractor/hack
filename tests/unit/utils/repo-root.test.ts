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
