# BUG-001 Fix Strategy — Subcommand Repo-Root Resolution

## Problem

6 of 7 subcommands (task, status, cache, inspect, artifacts, validate-state) resolve `plan/`
and `PRD.md` against the invocation directory (INVOCATION_CWD), not the repository root. Only
`config` was patched (it calls `resolveRepositoryRoot()` inline at `src/cli/index.ts:608`).

**Root cause:** Subcommand `.action()` handlers execute inside `program.parse()` (line 853),
which is inside `parseCLIArgs()`, BEFORE `main()` performs `process.chdir(repoRoot)` at line 150.
Subcommands call `process.exit()` before `main()` ever reaches the chdir.

## Fix: `program.hook('preAction', ...)` + Shared Bootstrap Helper

### Design

Add a single `preAction` hook that resolves the repo root + chdirs before ANY action handler
runs. This makes all 6 unpatched subcommands inherit correct cwd without per-handler edits.

### Step 1: `bootstrapRepoRoot()` helper in `src/utils/repo-root.ts`

```ts
let _bootstrapped = false;

/**
 * Resolve the repository root and chdir to it (idempotent).
 *
 * Called from the Commander preAction hook (all commands) and from main()'s
 * default path. Uses an idempotency guard so double-invocation (hook cascade
 * or main() follow-up) is a no-op after the first call.
 *
 * @returns The canonicalized repository root.
 * @throws {NotARepositoryError} If no .git entry found.
 */
export function bootstrapRepoRoot(
  startDir: string,
  opts?: ResolveRepoOpts
): string {
  if (_bootstrapped) return getRepoRoot();
  const { repoRoot } = resolveRepositoryRoot(startDir, opts);
  process.chdir(repoRoot);
  _bootstrapped = true;
  return repoRoot;
}

/** Test-only: reset the idempotency guard between test cases. */
export function _resetBootstrap(): void {
  _bootstrapped = false;
}
```

### Step 2: Register the hook in `parseCLIArgs()` (`src/cli/index.ts`)

Add BEFORE `program.parse(process.argv)` (line 853):

```ts
// PRD §9.8.3/§9.8.7: bootstrap repo-root resolution + chdir for ALL action
// handlers (including subcommands) via a single preAction hook. Subcommand
// .action() handlers run INSIDE program.parse() — before main()'s chdir —
// so without this hook they resolve plan/PRD.md against INVOCATION_CWD.
program.hook('preAction', () => {
  const opts = program.opts() as { repoRoot?: string };
  bootstrapRepoRoot(
    process.cwd(), // === INVOCATION_CWD (no chdir has happened yet)
    opts.repoRoot ? { explicit: opts.repoRoot } : undefined
  );
});
```

**Why `process.cwd()` is correct here:** The hook runs inside `program.parse()`, before any
chdir. `process.cwd()` === INVOCATION_CWD at this point. The idempotency guard in
`bootstrapRepoRoot()` prevents double execution if Commander fires the hook for both the
program and subcommand levels.

### Step 3: Update `main()` in `src/index.ts`

Replace the explicit `resolveRepositoryRoot` + `process.chdir` (lines 147-150) with a call to
the already-bootstrapped singleton:

```ts
// Before (lines 147-150):
const { repoRoot } = resolveRepositoryRoot(
  INVOCATION_CWD,
  args.repoRoot ? { explicit: args.repoRoot } : undefined
);
process.chdir(repoRoot);

// After:
// The preAction hook (registered in parseCLIArgs) already bootstrapped
// resolveRepositoryRoot + chdir during program.parse(). Use the singleton.
const repoRoot = getRepoRoot();
```

**Fallback safety:** If `parseCLIArgs()` returns (default path), the hook has already run for
the program's own action. `getRepoRoot()` will succeed. If somehow it hasn't (edge case),
`getRepoRoot()` throws with a clear message.

### Step 4: Simplify the `config` handler (`src/cli/index.ts:599-621`)

The config handler currently calls `resolveRepositoryRoot` inline (line 608). After the hook,
this is redundant. Replace with:

```ts
// Before:
const explicit = (program.opts() as { repoRoot?: string }).repoRoot;
const { repoRoot } = resolveRepositoryRoot(
  process.cwd(),
  explicit ? { explicit } : undefined
);
await new ConfigCommand(repoRoot).execute(...)

// After:
// The preAction hook already resolved the repo root + chdir'd.
const repoRoot = getRepoRoot();
await new ConfigCommand(repoRoot).execute(...)
```

### Files Changed

| File | Change |
|------|--------|
| `src/utils/repo-root.ts` | Add `bootstrapRepoRoot()` + `_resetBootstrap()` |
| `src/cli/index.ts` | Add `program.hook('preAction', ...)` before line 853; import `bootstrapRepoRoot`; simplify config handler (line 608) |
| `src/index.ts` | Replace resolveRepositoryRoot+chdir (lines 147-150) with `getRepoRoot()`; import `getRepoRoot` from repo-root.js |

### Interaction with BUG-002

When the preAction hook throws `NotARepositoryError` (e.g., `hack task` outside any repo), the
error propagates through `program.parse()` → `parseCLIArgs()` → `main()` → `main().catch()`.
Since `main().catch()` has a dedicated `NotARepositoryError` arm, it renders cleanly as
`\n❌ <message>` without a stack trace. **This automatically fixes the subcommand
NotARepositoryError rendering issue** — no per-handler catch changes needed for this error class.

### Risks & Mitigations

1. **Hook fires twice for subcommands (program + subcommand level):** The `_bootstrapped` flag
   in `bootstrapRepoRoot()` makes the second call a no-op.

2. **Default path double-bootstrap:** Hook fires for the program's default action (sets
   `_bootstrapped`), then `main()` calls `getRepoRoot()` (reads singleton). No double chdir.

3. **`--repo-root` relative path resolution:** `resolveExplicit()` resolves against
   `process.cwd()`. At hook time, `process.cwd()` === INVOCATION_CWD (before any chdir), so
   relative paths resolve correctly. This matches the current `config` handler behavior.

4. **Existing tests:** Tests that construct command classes (InspectCommand, etc.) with default
   args outside a repo-root context may be affected. The default parameters (`resolve('plan')`)
   still evaluate against the test's cwd. Tests using `spawnSync` subprocesses will benefit from
   the fix. Unit tests calling `parseCLIArgs()` directly need `_resetBootstrap()` in setup/teardown.

5. **`--help` / `--version`:** Commander short-circuits these during `program.parse()` before
   any action runs. The preAction hook does NOT fire for these. This is correct behavior.