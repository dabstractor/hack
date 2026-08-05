# Research — P1.M1.T1.S2 (wire preAction hook + main() singleton swap)

S2 wires Commander's `preAction` hook into `parseCLIArgs()` so repo-root resolution + `chdir` run
before ANY action handler (root default + all subcommands), and swaps `main()`'s two-step
resolve+chdir for a `getRepoRoot()` singleton read. This fixes BUG-001: 6 subcommands resolved
`plan/`&`PRD.md` against INVOCATION_CWD because their `.action()` handlers run inside
`program.parse()` — before `main()`'s chdir.

## 1. S1's helper is LANDED (verified — consume, don't modify)

`src/utils/repo-root.ts:203` exports the idempotent wrapper (verified by grep):
```ts
let _bootstrapped = false;                                   // :92
export function bootstrapRepoRoot(startDir, opts?: ResolveRepoOpts): string {  // :203
  if (_bootstrapped) return getRepoRoot();                   // no-op after first call
  const { repoRoot } = resolveRepositoryRoot(startDir, opts);
  process.chdir(repoRoot);
  _bootstrapped = true;
  return repoRoot;
}
export function _resetBootstrap(): void { _bootstrapped = false; }   // test-only
```
`resolveRepositoryRoot`, `getRepoRoot`, `ResolveRepoOpts`, `NotARepositoryError` are all present
and UNCHANGED. S2 imports `bootstrapRepoRoot` (cli) + `getRepoRoot` (index) and removes the now-
unused `resolveRepositoryRoot` import from index.ts.

## 2. CRITICAL — preAction fires for the DEFAULT path too (root has a no-op .action)

`external_deps.md` confirms: "`program.hook('preAction', listener)` fires before any action handler
(program-level default AND subcommands)." Verified the root program HAS a default action
(`src/cli/index.ts:465-468`):
```ts
// Default action when no subcommand is given - enables running with just options
.action(() => {
  // No-op: actual execution happens in main() after parseCLIArgs() returns
});
```
So for the DEFAULT pipeline path (no subcommand), preAction fires before this no-op root action →
the hook bootstraps → the singleton is set → `main()`'s `getRepoRoot()` succeeds. **This is why the
contract's `getRepoRoot()` (not `bootstrapRepoRoot()`) is correct for main(): the hook already ran
during `program.parse()`.** (Fix strategy Step 3 "Fallback safety" documents this.)

## 3. Commander preAction semantics (verified — external_deps.md)

- Fires AFTER options are parsed → `program.opts()` has `--repo-root` available. ✓
- Fires BEFORE the action handler body → the chdir lands before any `resolve('plan')`/`resolve('PRD.md')`. ✓
- For a subcommand, fires for BOTH program + subcommand levels (double call) → `_bootstrapped` guard
  makes call #2 a no-op. ✓
- If the hook throws (e.g. `NotARepositoryError`), the error propagates `program.parse()` → caller;
  it does NOT enter the action's try/catch (handler hasn't started). → propagates to `main().catch()`
  which has a dedicated `NotARepositoryError` clean arm (`src/index.ts:417-419`). ✓ (auto-fixes the
  subcommand NotARepositoryError rendering — no per-handler catch changes needed.)
- `--help`/`--version` short-circuit DURING `program.parse()` before any action → hook does NOT fire
  for them. ✓ (`hack --help` works anywhere, even outside a repo — §9.8.5/§9.8.9.)

## 4. The exact wiring (3 edits across 2 files)

### Edit A — `src/cli/index.ts`: register the hook before `program.parse` (line 853)
- Extend the import at line 47: `import { resolveRepositoryRoot, bootstrapRepoRoot } from '../utils/repo-root.js';`
  (KEEP `resolveRepositoryRoot` — the config handler at 608 still uses it; S3 simplifies that.)
- BEFORE `program.parse(process.argv)` (~L853), add:
  ```ts
  program.hook('preAction', () => {
    const opts = program.opts() as { repoRoot?: string };
    bootstrapRepoRoot(
      process.cwd(), // === INVOCATION_CWD (no chdir has happened yet at hook time)
      opts.repoRoot ? { explicit: opts.repoRoot } : undefined
    );
  });
  ```
  `program.opts()` returns ROOT options (--repo-root is a root option) → correct for default + all
  subcommands. `process.cwd()` at hook time === INVOCATION_CWD (the chdir is what the hook DOES).

### Edit B — `src/index.ts`: swap main()'s resolve+chdir (lines 146-150) for getRepoRoot()
- Replace lines 146-150:
  ```ts
  // BEFORE:
  const { repoRoot } = resolveRepositoryRoot(INVOCATION_CWD, args.repoRoot ? { explicit: args.repoRoot } : undefined);
  process.chdir(repoRoot);
  // AFTER:
  const repoRoot = getRepoRoot();   // the preAction hook bootstrapped during program.parse()
  ```
- Import: swap `resolveRepositoryRoot` → `getRepoRoot` in the `./utils/repo-root.js` import
  (lines 59-62). After the swap, `resolveRepositoryRoot` is UNUSED in index.ts (grep confirms only
  import L60 + usage L146) → REMOVE it (no-unused-vars). `INVOCATION_CWD` (L68) stays — it's still
  used for the --prd pre-resolution logic (unaffected).
- Keep/update the bootstrap comment to explain the hook did the work during parse.

### Edit C — no edit to the config handler (S3 owns it)
The config handler (`src/cli/index.ts:599-621`) calls `resolveRepositoryRoot` inline (line 608).
After the hook, this is REDUNDANT — but simplifying it is **P1.M1.T1.S3**, NOT S2. S2 leaves it
(the double-call is harmless: `resolveRepositoryRoot` just re-resolves + re-sets singletons; the
`_bootstrapped` guard prevents a second chdir if it were `bootstrapRepoRoot`, but it's
`resolveRepositoryRoot` which doesn't chdir anyway). Do NOT touch it in S2.

## 5. THE test ripple — 9 files call parseCLIArgs (the hook now fires during parse)

After S2, `parseCLIArgs()` triggers `bootstrapRepoRoot` (via the hook) → `process.chdir` (or
`NotARepositoryError` outside a repo). This is a NEW side effect of parseCLIArgs. 9 test files call
parseCLIArgs:
- **Unit (4):** `tests/unit/cli/index.test.ts`, `tests/unit/config/auth-preflight.test.ts`,
  `tests/unit/utils/logger-teardown.test.ts`, `tests/unit/cli/apply-hack-cli-defaults.test.ts`.
- **Integration (5):** `tests/integration/parallelism-option.test.ts`, `tests/integration/retry-options.test.ts`,
  `tests/integration/cli-task-status.test.ts`, `tests/integration/cli/repo-root-semantics.test.ts`,
  `tests/integration/repo-root-acceptance.test.ts`.

**Mitigation for UNIT tests:** mock `bootstrapRepoRoot` (no-op) so the hook doesn't chdir/throw
during option-parsing tests. `index.test.ts` ALREADY mocks `node:fs` (L28) and uses `setArgv` (L136) +
`parseCLIArgs()`; add `vi.mock('../../../src/utils/repo-root.js', () => ({ bootstrapRepoRoot: vi.fn(),
resolveRepositoryRoot: vi.fn(), getRepoRoot: vi.fn(() => '/mock-repo'), ...other-used-exports }))`.
The existing `--repo-root` flow test (index.test.ts:426) still works — it tests that the OPTION flows
to ValidatedCLIArgs, not the bootstrap (mocking bootstrapRepoRoot doesn't affect option parsing).
Apply the same mock to the other 3 unit files that call parseCLIArgs (auth-preflight, logger-teardown,
apply-hack-cli-defaults) IF they break.

**Integration tests:** review each — subprocess-based tests (spawnSync) in real git repos will have
the hook fire + chdir correctly (that's the fix); in-process parseCLIArgs calls need the same mock or
a real repo context. The COMPREHENSIVE subcommand-from-subdir integration tests are **P1.M1.T2.S1**
(not S2). S2's job is to keep the directly-affected unit tests green + add ONE focused hook-fires test.

## 6. S2's own test (the wiring proof)

Add a focused test (in index.test.ts or a new block) proving the hook is registered + fires:
- mock `bootstrapRepoRoot` (spy), call `parseCLIArgs()` via `setArgv([])` (default path, root action),
  assert the spy was called once with `(process.cwd(), undefined)`.
- assert `setArgv(['--repo-root','/x'])` → spy called with `(process.cwd(), { explicit: '/x' })`.
- (The subcommand double-fire + idempotency is S1's helper test; the real subcommand-from-subdir
  behavior is T2.S1.)

## 7. Scope boundaries

- S2 = hook wiring (cli/index.ts) + main() swap (index.ts) + keep affected unit tests green + 1 hook-fires test.
- S1 (landed) = bootstrapRepoRoot helper. Do NOT modify repo-root.ts.
- S3 = simplify the config handler (remove its inline resolveRepositoryRoot → getRepoRoot).
- T2.S1 = comprehensive subcommand-from-subdir + outside-repo integration tests.
- BUG-002 (HackConfigError clean render) = P1.M2 (separate).

## 8. Validation (verified executable)

- `npm run typecheck` / `npm run lint` / `npm run format:check` (prettier ERROR-enforced; `npm run fix`).
- `npx vitest run tests/unit/cli/index.test.ts tests/unit/utils/repo-root.test.ts` (S2 wiring + S1 helper regression).
- `npx vitest run tests/unit/config/auth-preflight.test.ts tests/unit/cli/apply-hack-cli-defaults.test.ts tests/unit/utils/logger-teardown.test.ts` (ripple).
- Do NOT run full `npm run test:run` as the gate (orthogonal pre-existing failures); but DO run the
  parseCLIArgs-calling files to confirm the hook didn't break them.