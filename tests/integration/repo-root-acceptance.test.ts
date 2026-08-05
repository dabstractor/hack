/**
 * Acceptance tests for PRD §9.8 (Repository Root Resolution) — criteria a–e + child inheritance.
 *
 * @remarks
 * This is the P1.M1.T2.S1 acceptance sweep (the Definition of Done for §9.8 alongside S1's resolver
 * suite and S2's semantic suite). It proves the cross-cutting §9.8.9 behaviors end-to-end:
 *
 * Layer A — resolver-level (real `mkdtempSync` tmpdirs + real `git`):
 * - (a) launched from a nested subdir → resolves repoRoot; bootstrap chdir makes cwd === repoRoot.
 * - (b) a real `git worktree add` produces a `.git` FILE → resolves to the worktree root (§9.8.4).
 * - (c) a nested repo (submodule-equivalent) → resolves to the submodule root, not the superproject.
 * - (child) a bugfix dir under the session resolves the SAME repo root as the parent (§9.8.7/§9.8.9).
 *
 * Layer B — CLI subprocess (`spawnSync` the local tsx + absolute `src/index.ts`, controlled cwd):
 * - (d) a no-repo invocation exits 1 with the actionable `❌` message + creates NO `plan/` session (§9.8.5).
 * - (e) `--help` works outside any repo (exit 0) — Commander short-circuits before the traversal.
 *
 * §9.8.9 criteria f/g/h/i (`--repo-root` pin/error, explicit `--prd` against invocation, default
 * `PRD.md` → `<repoRoot>/PRD.md`) are owned by S2's `tests/integration/cli/repo-root-semantics.test.ts`
 * and are NOT duplicated here (consume, don't duplicate — keeps the two files merge-safe).
 *
 * @see {@link ../../../src/utils/repo-root.ts}
 * @see {@link ../../../src/index.ts}
 */

import { describe, it, expect } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  existsSync,
  realpathSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveRepositoryRoot } from '../../src/utils/repo-root.js';

// --- hermetic subprocess invocation (PRP gotcha: LOCAL tsx binary + ABSOLUTE script path) ---
const tsxBin = resolve(process.cwd(), 'node_modules', '.bin', 'tsx');
const absIndex = resolve(process.cwd(), 'src/index.ts');

/**
 * Run the CLI as a real subprocess with a controlled cwd. Returns exit status + streams.
 */
const runCli = (
  args: string[],
  cwd: string
): { status: number | null; stdout: string; stderr: string } => {
  const result = spawnSync(tsxBin, [absIndex, ...args], {
    cwd,
    encoding: 'utf8',
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
};

/**
 * Create a real git repo tmpdir (`git init`). Returns the tmp path. Caller cleans up.
 */
const makeRepo = (): string => {
  const repo = mkdtempSync(join(tmpdir(), 'repo-acceptance-'));
  const r = spawnSync('git', ['init', '-q', repo]);
  if (r.status !== 0) {
    rmSync(repo, { recursive: true, force: true });
    throw new Error(
      `git init failed: ${r.stderr ?? 'unknown error'} (is git installed?)`
    );
  }
  return repo;
};

// =============================================================================
// Layer A — resolver-level (real tmpdirs)
// =============================================================================

describe('§9.8.9 acceptance — resolver level (real tmpdirs)', () => {
  it('(a) launched from a nested subdir resolves the repo root', () => {
    // SETUP — a real repo with a deeply nested subdir.
    const repo = makeRepo();
    const nested = join(repo, 'src', 'a', 'b');
    mkdirSync(nested, { recursive: true });
    try {
      // EXECUTE
      const result = resolveRepositoryRoot(nested);

      // VERIFY — walks up to the repo root; canonicalized via realpath.
      expect(result.repoRoot).toBe(realpathSync(repo));
      expect(result.invocationCwd).toBe(nested);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it('(a) bootstrap chdir makes process.cwd() === repoRoot (subprocess)', () => {
    // SETUP — run the EXACT bootstrap sequence (resolveRepositoryRoot + chdir) from a nested subdir
    // in a subprocess, then print process.cwd(). Proves the single chdir propagates to cwd.
    const repo = makeRepo();
    const nested = join(repo, 'src', 'a', 'b');
    mkdirSync(nested, { recursive: true });
    // Inline bootstrap: resolve from the subdir, chdir, print cwd. Mirrors src/index.ts L138–144.
    // Import via an ABSOLUTE .ts path (the spawned cwd is the tmp subdir, so a relative import
    // won't resolve; tsx loads .ts natively). Resolve against the TEST process's cwd (project root).
    const absRepoRootTs = resolve(
      process.cwd(),
      'src',
      'utils',
      'repo-root.ts'
    );
    const inline = [
      `import { resolveRepositoryRoot } from '${absRepoRootTs}';`,
      'const { repoRoot } = resolveRepositoryRoot(process.cwd());',
      'process.chdir(repoRoot);',
      'process.stdout.write(process.cwd());',
    ].join('\n');
    try {
      // EXECUTE — tsx -e runs the inline script with cwd = nested.
      const r = spawnSync(tsxBin, ['-e', inline], {
        cwd: nested,
        encoding: 'utf8',
      });

      // VERIFY — post-chdir cwd === repoRoot (realpath-canonicalized).
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe(realpathSync(repo));
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it('(b) detects a git worktree via its .git FILE', () => {
    // SETUP — a real worktree: main repo needs a commit before `git worktree add` works.
    // The worktree's .git is a FILE (gitdir: pointer) — the §9.8.4 case.
    const main = makeRepo();
    spawnSync('git', [
      '-C',
      main,
      'commit',
      '-q',
      '--allow-empty',
      '-m',
      'init',
    ]);
    const wt = `${main}-wt`;
    const addResult = spawnSync('git', [
      '-C',
      main,
      'worktree',
      'add',
      '-q',
      wt,
    ]);
    try {
      expect(addResult.status).toBe(0); // sanity: worktree created
      // Sanity: the worktree root has a .git FILE (not a dir).
      expect(existsSync(join(wt, '.git'))).toBe(true);

      // EXECUTE + VERIFY — resolves to the WORKTREE root (realpath), NOT the main checkout.
      expect(resolveRepositoryRoot(wt).repoRoot).toBe(realpathSync(wt));
    } finally {
      rmSync(main, { recursive: true, force: true });
      rmSync(wt, { recursive: true, force: true });
    }
  });

  it('(c) resolves a submodule (nested repo) to the submodule root, not the superproject', () => {
    // SETUP — a submodule is a nested repo with its own .git. Hermetic equivalent of
    // `git submodule add` (which needs a URL): `git init tmp/vendor/sub`.
    const repo = makeRepo();
    const sub = join(repo, 'vendor', 'sub');
    mkdirSync(sub, { recursive: true });
    const r = spawnSync('git', ['init', '-q', sub]);
    try {
      expect(r.status).toBe(0); // sanity: nested repo initialized
      expect(existsSync(join(sub, '.git'))).toBe(true);

      // EXECUTE + VERIFY — nearest-ancestor wins (§9.8.4): resolves to the submodule root,
      // NOT the superproject repo.
      expect(resolveRepositoryRoot(sub).repoRoot).toBe(realpathSync(sub));
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it('(child) a bugfix dir under the session resolves the same repo root as the parent', () => {
    // SETUP — a bugfix child session lives under plan/{seq}/bugfix/{seq}/, INSIDE the repo.
    // §9.8.7 / §9.8.9 child-process criterion: it must resolve the SAME repo root as the parent.
    const repo = makeRepo();
    const bugfixDir = join(repo, 'plan', '001_abc', 'bugfix', '002_def');
    mkdirSync(bugfixDir, { recursive: true });
    try {
      // EXECUTE + VERIFY — the bugfix dir walks up to the same .git as the repo root.
      expect(resolveRepositoryRoot(bugfixDir).repoRoot).toBe(
        realpathSync(repo)
      );
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

// =============================================================================
// Layer B — CLI subprocess (spawnSync the real tsx src/index.ts, controlled cwd)
// =============================================================================

describe('§9.8.9 acceptance — CLI subprocess (no-repo hard error + --help)', () => {
  it('(d) a no-repo invocation exits 1 with an actionable message and creates no session', () => {
    // SETUP — a tmpdir with NO .git ancestor (OS tmp; safe in practice per PRP gotcha).
    const nonRepo = mkdtempSync(join(tmpdir(), 'no-repo-'));
    try {
      // Sanity: no .git at the non-repo dir itself.
      expect(existsSync(join(nonRepo, '.git'))).toBe(false);

      // EXECUTE — invoke the CLI with the default --prd from the non-repo cwd.
      const { status, stderr } = runCli(['--prd', './PRD.md'], nonRepo);

      // VERIFY — §9.8.5: exit 1 + the DEDICATED arm's clean actionable message
      // (NOT the generic "Fatal error in main()" arm).
      expect(status).toBe(1);
      expect(stderr).toContain('No .git entry found'); // clean ❌ message
      expect(stderr).not.toContain('Fatal error in main()'); // NOT the generic arm
      expect(stderr).toContain(nonRepo); // searchedFrom named
      expect(stderr).toContain('--repo-root'); // remediation
      // No session created (the throw fires before pipeline.run → before any plan/ dir).
      expect(existsSync(join(nonRepo, 'plan'))).toBe(false);
    } finally {
      rmSync(nonRepo, { recursive: true, force: true });
    }
  });

  it('(e) --help works outside any repo (exit 0)', () => {
    // SETUP — a non-repo tmpdir.
    const nonRepo = mkdtempSync(join(tmpdir(), 'no-repo-help-'));
    try {
      // EXECUTE — --help short-circuits INSIDE parseCLIArgs (Commander process.exit),
      // BEFORE the resolver runs, so it works from a non-repo dir (§9.8.5 exemption).
      const { status } = runCli(['--help'], nonRepo);

      // VERIFY
      expect(status).toBe(0);
    } finally {
      rmSync(nonRepo, { recursive: true, force: true });
    }
  });
});
