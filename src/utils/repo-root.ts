/**
 * Repository root resolution via upward `.git` traversal (PRD §9.8).
 *
 * @module utils/repo-root
 *
 * @remarks
 * Git is a hard prerequisite for the pipeline (smart commits, task recovery, session state all
 * run at the repository root). This module resolves the repository root from the invocation
 * cwd by walking upward until it finds a `.git` entry (a **directory** for a normal clone OR a
 * **file** for a worktree/submodule `gitdir:` pointer — PRD §9.8.4), throwing a typed
 * {@link NotARepositoryError} when none is found (§9.8.5).
 *
 * A single `process.chdir(repoRoot)` during bootstrap (wired in `src/index.ts` `main()`) makes
 * every downstream `process.cwd()`/`resolve(...)` site resolve to the repo root with **zero**
 * per-site changes (§9.8.3).
 *
 * The module also exposes a process-global singleton ({@linkcode getRepoRoot} /
 * {@linkcode getInvocationCwd}) so consumers that need the resolved root — or the original
 * invocation directory (before the bootstrap `chdir`) — can read it without re-resolving.
 */

import { existsSync, realpathSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';

/**
 * Options for {@link resolveRepositoryRoot}.
 *
 * @remarks
 * `explicit` carries an absolute or cwd-relative path that MUST contain a `.git` entry,
 * overriding the default upward traversal (PRD §9.8.6). It is forward-compat for the
 * `--repo-root` CLI flag (P1.M1.T1.S2), which threads `args.repoRoot` into
 * `resolveRepositoryRoot(INVOCATION_CWD, { explicit: args.repoRoot })`.
 */
export interface ResolveRepoOpts {
  /** Explicit repository root override (must contain a `.git` entry). */
  explicit?: string;
}

/**
 * Error thrown when no `.git` entry is found at/above the searched-from dir (PRD §9.8.5).
 *
 * @remarks
 * Follows the typed-error convention used by {@linkcode SessionFileError}: `this.name` is set
 * in the constructor (so `error instanceof NotARepositoryError` + clean rendering work), and the
 * searched-from directory + `--repo-root` remediation are baked into the message. Rendered by a
 * dedicated `main().catch()` arm as a single actionable `❌` message + exit 1, BEFORE any session is
 * created, `.hack`/`.env` is read, or any agent is invoked (the resolver runs after `parseCLIArgs()`
 * so `--help`/`--version`/usage errors short-circuit first). The message names the searched-from
 * directory, the fact that no ancestor contains `.git`, and the `--repo-root <path>` remediation.
 *
 * @example
 * ```typescript
 * try {
 *   resolveRepositoryRoot('/tmp/no-git-here');
 * } catch (error) {
 *   if (error instanceof NotARepositoryError) {
 *     console.error(error.searchedFrom); // '/tmp/no-git-here'
 *     console.error(error.explicit);     // false
 *   }
 * }
 * ```
 */
export class NotARepositoryError extends Error {
  /** Directory the search started from (or the explicit path that lacked `.git`). */
  readonly searchedFrom: string;

  /** Whether this came from an explicit `opts.explicit` path (vs. the default traversal). */
  readonly explicit: boolean;

  /**
   * Creates a new `NotARepositoryError`.
   *
   * @param searchedFrom - The searched-from directory (default) or the explicit path.
   * @param opts - `explicit: true` for the explicit-path variant (changes the message).
   */
  constructor(searchedFrom: string, opts?: { explicit?: boolean }) {
    const remediation = opts?.explicit
      ? `--repo-root path "${searchedFrom}" does not contain a .git entry.`
      : `No .git entry found at or above "${searchedFrom}". Run inside a git repository, or pass --repo-root <path>.`;
    super(remediation);
    this.name = 'NotARepositoryError';
    this.searchedFrom = searchedFrom;
    this.explicit = opts?.explicit ?? false;
  }
}

// Module singleton: set by resolveRepositoryRoot; read by getRepoRoot / getInvocationCwd.
// Process-global by design — bootstrap sets it once, all consumers read the same value.
let _repoRoot: string | undefined;
let _invocationCwd: string | undefined;

// Idempotency guard for bootstrapRepoRoot (PRD §9.8.3). Commander fires `preAction` per command
// level — for a subcommand it can fire twice (program + subcommand) — so the guard makes the
// second call a no-op after the first resolve+chdir. Reset only by _resetBootstrap (test-only).
let _bootstrapped = false;

/**
 * Resolve the repository root from a starting directory (PRD §9.8.2).
 *
 * @remarks
 * **Default (no `opts.explicit`)** — upward traversal: from the resolved-absolute `startDir`,
 * at each directory test `existsSync(join(dir, '.git'))`. `existsSync` is true for `.git` as a
 * **directory** (normal clone) AND as a **file** (worktree/submodule `gitdir:` pointer — §9.8.4),
 * so both forms are detected. The **nearest** ancestor with `.git` wins (§9.8.2) — an inner repo
 * inside an outer repo resolves to the inner one. If the filesystem root (`dirname(dir) === dir`)
 * is reached without `.git`, a {@link NotARepositoryError} is thrown (§9.8.5).
 *
 * **Explicit (`opts.explicit` set)** — resolve to absolute and verify `.git` is present
 * (dir-or-file); throw {@link NotARepositoryError} with `explicit: true` if absent (§9.8.6).
 *
 * On success the found root is canonicalized via `realpathSync` (symlinks resolved) and stored
 * into the module singleton, alongside the original `startDir` as `invocationCwd`. The caller
 * (bootstrap) performs the single `process.chdir(repoRoot)` so all downstream cwd sites resolve
 * correctly (§9.8.3).
 *
 * @param startDir - The directory to search from (typically the invocation cwd).
 * @param opts - Optional {@link ResolveRepoOpts} (`explicit` override).
 * @returns `{ repoRoot, invocationCwd }` — `repoRoot` is canonicalized (realpath).
 * @throws {NotARepositoryError} If no `.git` entry is found at/above `startDir`, or an explicit
 *         path lacks `.git`.
 *
 * @example
 * ```typescript
 * const { repoRoot } = resolveRepositoryRoot(process.cwd());
 * process.chdir(repoRoot); // single bootstrap chdir — all cwd sites now resolve to repo root
 * ```
 */
export function resolveRepositoryRoot(
  startDir: string,
  opts?: ResolveRepoOpts
): { repoRoot: string; invocationCwd: string } {
  const invocationCwd = startDir;
  const found = opts?.explicit
    ? resolveExplicit(opts.explicit) // §9.8.6 explicit override
    : traverseUp(startDir); // §9.8.2 default upward walk
  const repoRoot = realpathSync(found); // canonicalize (symlinks)
  _repoRoot = repoRoot;
  _invocationCwd = invocationCwd;
  return { repoRoot, invocationCwd };
}

/**
 * Read the resolved repository root (after bootstrap).
 *
 * @returns The canonicalized repository root.
 * @throws {Error} If accessed before {@link resolveRepositoryRoot} has run.
 */
export function getRepoRoot(): string {
  if (_repoRoot === undefined) {
    throw new Error(
      'Repository root not resolved yet (resolveRepositoryRoot must run during bootstrap).'
    );
  }
  return _repoRoot;
}

/**
 * Read the original invocation cwd captured before the bootstrap `chdir`.
 *
 * @returns The invocation directory (the cwd at process start).
 * @throws {Error} If accessed before {@link resolveRepositoryRoot} has run.
 */
export function getInvocationCwd(): string {
  if (_invocationCwd === undefined) {
    throw new Error(
      'Invocation CWD not captured yet (resolveRepositoryRoot must run during bootstrap).'
    );
  }
  return _invocationCwd;
}

/**
 * Resolve the repository root and `process.chdir` to it — idempotent (PRD §9.8.3).
 *
 * @remarks
 * Encapsulates the two-step bootstrap (`resolveRepositoryRoot` → `process.chdir`) behind a
 * `_bootstrapped` guard so it is safe to call more than once. This is the primitive the Commander
 * `preAction` hook (P1.M1.T1.S2) calls for EVERY command — including subcommands, whose `.action()`
 * handlers run inside `program.parse()` before `main()`'s chdir — and that `main()`'s default path
 * also calls. Commander fires `preAction` per command level (program + subcommand → two calls); the
 * guard makes the second invocation a no-op (no second `chdir`).
 *
 * **Side effects** (all intentional, on first call only):
 * 1. `resolveRepositoryRoot(startDir, opts)` runs — which sets the `_repoRoot`/`_invocationCwd`
 *    singletons and canonicalizes the root via `realpathSync`.
 * 2. `process.chdir(repoRoot)` — the single bootstrap chdir that makes every downstream
 *    `process.cwd()`/`resolve(...)` site resolve to the repo root (§9.8.3).
 * 3. `_bootstrapped = true` — set AFTER the chdir so a throw from `resolveRepositoryRoot` leaves
 *    it `false` (a retry re-runs).
 *
 * @param startDir - The directory to search from (typically the invocation cwd).
 * @param opts - Optional {@link ResolveRepoOpts} (`explicit` override — passed straight through).
 * @returns The canonicalized repository root (same value a follow-up `getRepoRoot()` returns).
 * @throws {NotARepositoryError} Propagated from {@link resolveRepositoryRoot} when no `.git` entry
 *         is found; `_bootstrapped` stays `false` so a retry re-runs.
 *
 * @example
 * ```typescript
 * // Called from a Commander preAction hook (runs before any action handler):
 * program.hook('preAction', () => bootstrapRepoRoot(process.cwd()));
 * ```
 */
export function bootstrapRepoRoot(
  startDir: string,
  opts?: ResolveRepoOpts
): string {
  if (_bootstrapped) return getRepoRoot(); // no-op after the first call
  const { repoRoot } = resolveRepositoryRoot(startDir, opts); // sets singletons; may throw
  process.chdir(repoRoot); // the single bootstrap chdir (§9.8.3)
  _bootstrapped = true;
  return repoRoot;
}

/**
 * Reset the `bootstrapRepoRoot` idempotency guard (test-only).
 *
 * @remarks
 * Resets ONLY `_bootstrapped` (not the `_repoRoot`/`_invocationCwd` singletons); a subsequent
 * `bootstrapRepoRoot` call re-runs `resolveRepositoryRoot`, which overwrites the singletons fresh.
 * Intended for test isolation (e.g. S2's preAction-hook tests that import the module once rather
 * than re-importing per case). Not part of the public bootstrap contract.
 */
export function _resetBootstrap(): void {
  _bootstrapped = false;
}

/**
 * Walk upward from `startDir` to the nearest ancestor containing a `.git` entry (§9.8.2).
 *
 * @param startDir - The directory to start from.
 * @returns The nearest ancestor directory containing `.git`.
 * @throws {NotARepositoryError} If the filesystem root is reached without `.git`.
 */
function traverseUp(startDir: string): string {
  let dir = resolve(startDir); // absolute
  for (;;) {
    if (existsSync(join(dir, '.git'))) {
      return dir; // nearest ancestor wins; .git dir OR file (§9.8.4)
    }
    const parent = dirname(dir);
    if (parent === dir) break; // filesystem root reached (dirname('/') === '/')
    dir = parent;
  }
  throw new NotARepositoryError(startDir); // hard error (§9.8.5)
}

/**
 * Resolve an explicit repository-root path and verify it contains `.git` (§9.8.6).
 *
 * @param explicit - Absolute or cwd-relative path that must contain `.git`.
 * @returns The resolved-absolute path.
 * @throws {NotARepositoryError} with `explicit: true` if the path lacks `.git`.
 */
function resolveExplicit(explicit: string): string {
  const abs = resolve(explicit); // relative to current cwd
  if (!existsSync(join(abs, '.git'))) {
    throw new NotARepositoryError(abs, { explicit: true });
  }
  return abs;
}
