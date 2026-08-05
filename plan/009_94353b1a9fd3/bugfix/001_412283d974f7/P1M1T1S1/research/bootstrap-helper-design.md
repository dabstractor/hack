# Research — P1.M1.T1.S1 (bootstrapRepoRoot helper)

Bugfix 001 BUG-001 (CRITICAL): 6 of 7 subcommands resolve `plan/`&`PRD.md`
against INVOCATION_CWD because their `.action()` handlers run INSIDE
`program.parse()` (src/cli/index.ts:853) — BEFORE `main()`'s `process.chdir`.
S1 adds the idempotent `bootstrapRepoRoot()` wrapper that S2's `preAction` hook
will call for every command (fixing all subcommands at once).

## 1. Existing module surface (src/utils/repo-root.ts) — verified

Already present (from the prior §9.8 S1):
- `resolveRepositoryRoot(startDir, opts?: ResolveRepoOpts): { repoRoot; invocationCwd }`
  — resolves + sets the `_repoRoot`/`_invocationCwd` singletons; throws
  `NotARepositoryError` if no `.git`. Does NOT chdir.
- `getRepoRoot(): string` / `getInvocationCwd(): string` — read singletons; throw if unset.
- `ResolveRepoOpts { explicit?: string }`, `NotARepositoryError` (typed error).
- Module singletons: `let _repoRoot: string | undefined; let _invocationCwd: string | undefined;`

**`main()` today** (src/index.ts:147-150) does the resolve + chdir as TWO separate steps:
```ts
const { repoRoot } = resolveRepositoryRoot(INVOCATION_CWD, args.repoRoot ? { explicit: args.repoRoot } : undefined);
process.chdir(repoRoot);
```
There is NO chdir encapsulation, NO idempotency flag. S1 adds the encapsulated wrapper;
S2 wires the `preAction` hook + replaces main()'s two-step with `getRepoRoot()`.

## 2. S1 scope (this task) — ADD TWO EXPORTS ONLY

```ts
let _bootstrapped = false;   // near _repoRoot/_invocationCwd

export function bootstrapRepoRoot(startDir: string, opts?: ResolveRepoOpts): string {
  if (_bootstrapped) return getRepoRoot();        // idempotent: no double chdir
  const { repoRoot } = resolveRepositoryRoot(startDir, opts);  // sets singletons; throws NotARepositoryError
  process.chdir(repoRoot);                         // the single bootstrap chdir (§9.8.3)
  _bootstrapped = true;
  return repoRoot;
}

/** Test-only: reset the idempotency guard between test cases. */
export function _resetBootstrap(): void {
  _bootstrapped = false;
}
```
- Do NOT modify `resolveRepositoryRoot`, `main()`, or any other file. S1 = additive exports + tests.
- `bootstrapRepoRoot` returns `string` (repoRoot), NOT the `{repoRoot,invocationCwd}` object.
- The `if (_bootstrapped) return getRepoRoot()` path is SAFE: `_bootstrapped===true` implies a
  prior call set `_repoRoot` (we set both in the same call), so `getRepoRoot()` won't throw there.
- If `resolveRepositoryRoot` throws (no `.git`), `_bootstrapped` stays `false` (the assignment is
  after `process.chdir`, which is after the resolve) → a later retry re-runs. Desired.

## 3. Why idempotency is mandatory (not optional)

Commander fires `preAction` once per command level in the matched chain. For a subcommand
(`hack task`), the hook can fire for BOTH the program level AND the subcommand level →
`bootstrapRepoRoot` called twice. Without the `_bootstrapped` guard, the second call re-runs
`resolveRepositoryRoot` + a SECOND `process.chdir` (harmless but wasteful) — and more importantly,
the contract requires the guard explicitly. The guard makes the 2nd call a no-op returning the
already-resolved root. (architecture/bug_001_fix_strategy.md §Risks #1.)

## 4. Test strategy — extend the EXISTING tests/unit/utils/repo-root.test.ts

The existing file mocks `node:fs` (`existsSync`/`realpathSync`) via `vi.mock('node:fs', …)` and
**re-imports the module fresh in `beforeEach`** (`const mod = await import(...)`). That re-import
resets `_bootstrapped`/`_repoRoot`/`_invocationCwd` naturally per test — so within this file the
singletons start clean. (`_resetBootstrap` is still exported for OTHER consumers — e.g. S2's hook
tests in a different file that import the module once — per the contract.)

Add a new `describe('bootstrapRepoRoot', …)` block mirroring the file's mock pattern, PLUS spy on
`process.chdir` with a no-op impl (the mocked-fs paths like `/repo` don't exist on real disk, so a
real `chdir('/repo')` would throw):
```ts
const chdirSpy = vi.spyOn(process, 'chdir').mockImplementation(() => {});
```
Cases (cover every new branch for 100% coverage):
1. first call → `resolveRepositoryRoot` runs, `process.chdir` called once with repoRoot, returns
   repoRoot, `_bootstrapped` becomes true (verify via the idempotent next call).
2. idempotent second call (no reset) → returns same repoRoot; `process.chdir` STILL called once
   total (assert spy call count didn't increase) — proves the guard short-circuits.
3. `_resetBootstrap()` → `_bootstrapped` back to false; next `bootstrapRepoRoot` call re-runs
   resolve + chdir (spy call count increases to 2).
4. error propagation: mock `existsSync` false everywhere → `resolveRepositoryRoot` throws
   `NotARepositoryError` → `bootstrapRepoRoot` re-throws it; `_bootstrapped` stays false (verify
   by then making it succeed and confirming it runs resolve+chdir fresh).
5. `opts.explicit` passthrough: `bootstrapRepoRoot('/start', { explicit: '/repo' })` → the
   explicit root is used (mock existsSync true for `/repo/.git`).
Restore `chdirSpy.mockRestore()` in the block's afterEach.

## 5. Validation

- `npm run typecheck` (tsc --noEmit -p tsconfig.build.json) — clean.
- `npm run lint && npm run format:check` — clean (prettier ERROR-enforced; `npm run fix`).
- `npx vitest run tests/unit/utils/repo-root.test.ts --coverage` — green; repo-root.ts at 100%
  on the new lines. The new branches (`_bootstrapped` true/false, chdir call, _resetBootstrap,
  error propagation) must all be hit.
- Do NOT run the full `npm run test:run` — orthogonal pre-existing failures are out of scope.
- Do NOT modify main() / resolveRepositoryRoot (S2 owns the wiring).