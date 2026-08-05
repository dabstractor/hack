# Design Note — P1.M1.T1.S3: Simplify config handler — remove redundant resolveRepositoryRoot inline call

> Tiny source-only refactor of `src/cli/index.ts`. Captures the verified facts that make it one-pass.

## 0. What S3 consumes (S1 LANDED, S2 = CONTRACT)

- **S1 (LANDED)**: `bootstrapRepoRoot()` in `src/utils/repo-root.ts:203` — idempotent (`_bootstrapped`
  guard L207); calls `resolveRepositoryRoot` + `process.chdir`; re-throws `NotARepositoryError`.
- **S2 (CONTRACT, parallel)**: registers `program.hook('preAction', …)` before `program.parse()` in
  `src/cli/index.ts` so repo-root resolution + chdir run before ANY action handler (root default +
  all subcommands). `main()` (src/index.ts) reads `getRepoRoot()` instead of resolve+chdir.
- **S3 (this)**: the config `.action()` handler (cli/index.ts:599-621) STILL calls
  `resolveRepositoryRoot` inline (redundant after S2's hook). S3 swaps it for `getRepoRoot()` and
  removes the now-stale comment. No behavior change.

## 1. The exact diff (3 edits, all in src/cli/index.ts)

**Verified current state** (read from HEAD):
- L44: `import { resolveRepositoryRoot } from '../utils/repo-root.js';` — `resolveRepositoryRoot`
  is used in this file ONLY at L608 (the config handler) + L602 (the comment). grep-confirmed: no
  other usage. So after S3 removes the L608 call, `resolveRepositoryRoot` is UNUSED → MUST be
  removed from the import (else `@typescript-eslint/no-unused-vars` fails).
- L601-606: the stale comment ("Subcommand dispatch runs BEFORE the bootstrap chdir … getRepoRoot()
  THROWS … Resolve repoRoot ourselves").
- L607-611: `const explicit = (program.opts() as {repoRoot?:string}).repoRoot;` +
  `const { repoRoot } = resolveRepositoryRoot(process.cwd(), explicit ? {explicit} : undefined);`.
- L612: `await new ConfigCommand(repoRoot).execute(action, options, typeof file === 'string' ? file : undefined);`.
- L617-621: catch block (`logger().error(\`Config command failed: …\`); process.exit(1);`) — STAYS.

**Edits:**
1. L44: `import { resolveRepositoryRoot } from '../utils/repo-root.js';` → `import { getRepoRoot } from '../utils/repo-root.js';`
2. L601-611 (the stale comment + the `explicit` extraction + the `resolveRepositoryRoot` call) →
   a 2-line comment + `const repoRoot = getRepoRoot();`:
   ```ts
   // The preAction hook already resolved the repo root + chdir'd (PRD §9.8.3);
   // read the hook-bootstrapped singleton.
   const repoRoot = getRepoRoot();
   ```
3. The catch block (L617-621) is UNCHANGED.

The architecture doc Step 4 (`bug_001_fix_strategy.md` L98-114) gives the identical before/after.

## 2. Why `getRepoRoot()` can't throw here (the hook ran first)

S2's `preAction` hook fires before the config `.action()` body (Commander v14: preAction runs after
options are parsed, before the action body). The hook calls `bootstrapRepoRoot(process.cwd(), …)`
which sets the singleton. So `getRepoRoot()` in the handler reads a guaranteed-set singleton. The
only way it throws is if the hook didn't run (impossible for a real action) or threw first — and a
hook `NotARepositoryError` propagates through `program.parse()` → `main().catch()`'s clean arm
(index.ts:417), never reaching this handler. So the handler's existing catch is now only for
`ConfigCommand.execute` errors (config validation / file I/O). The item's note (d) confirms: the
catch stays as-is.

## 3. Test impact = nil (verified)

- `tests/unit/cli/commands/config.test.ts` instantiates `ConfigCommand` DIRECTLY with a real tmpdir
  (`new ConfigCommand(repoRoot)`) — it does NOT go through the cli/index.ts handler. Unaffected.
- `tests/integration/config/hack-config-acceptance.test.ts` is SUBPROCESS-based (Layer B: `spawnSync`
  of the real CLI inside a `git init` tmpdir). The real hook bootstraps → `getRepoRoot()` returns the
  right root → `ConfigCommand` works. Its Layer A imports `resolveRepositoryRoot` for ITS OWN
  assertions (`resolveRepositoryRoot(nested)`) — still exported from repo-root.ts (S3 doesn't touch
  that file). Unaffected.
- `tests/unit/cli/index.test.ts` — S2 added `vi.mock('../../../src/utils/repo-root.js', () => ({
  resolveRepositoryRoot: vi.fn(), bootstrapRepoRoot: vi.fn(), getRepoRoot: vi.fn(() => '/mock-repo') }))`.
  After S3, cli/index.ts imports `getRepoRoot` (mocked → '/mock-repo'). Any in-process test that
  drives the config handler via parseCLIArgs gets the mock. Unaffected. (If any test asserts
  `resolveRepositoryRoot` was CALLED by the handler, that assertion would now fail — verify none do;
  the grep showed only the mock, no call assertion.)

## 4. Scope discipline

S3 touches ONLY `src/cli/index.ts`. It does NOT modify `src/utils/repo-root.ts` (S1), `src/index.ts`
(S2's main() swap), the hook itself (S2), the subcommand `.action()` bodies (hook makes them
correct), or `ConfigCommand` (config.test.ts exercises it directly). No new tests required (internal
refactor, no behavior change — the item's DOCS: none; OUTPUT is the refactor only). Validation =
typecheck + lint (the `resolveRepositoryRoot` unused-removal) + format + the existing cli/config
tests stay green.