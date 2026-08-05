# PRP — P1.M1.T1.S2: Wire `preAction` hook into `parseCLIArgs()` and update `main()` to use singleton

> Bugfix 001, **BUG-001 (CRITICAL)**. 6 of 7 subcommands resolve `plan/`&`PRD.md` against the
> invocation dir because their `.action()` handlers run INSIDE `program.parse()` — before `main()`'s
> `process.chdir`. S1 (LANDED) added the idempotent `bootstrapRepoRoot()` helper. **S2 wires a single
> Commander `preAction` hook** so repo-root resolution + chdir run before ANY action handler (root
> default + all subcommands), and swaps `main()`'s two-step resolve+chdir for a `getRepoRoot()` read.
> The config-handler simplification is **S3**; the comprehensive subcommand integration tests are
> **P1.M1.T2.S1**.

---

## Goal

**Feature Goal**: Register `program.hook('preAction', …)` in `parseCLIArgs()` (before
`program.parse`) that calls `bootstrapRepoRoot(process.cwd(), {explicit}?)` for every command —
fixing all 6 unpatched subcommands (task/status/cache/inspect/artifacts/validate-state) with one
hook. Replace `main()`'s explicit `resolveRepositoryRoot` + `process.chdir` (src/index.ts:146-150)
with `const repoRoot = getRepoRoot();` (the hook already bootstrapped during `program.parse()`).
Keep the directly-affected unit tests green by mocking the bootstrap in option-parsing tests.

**Deliverable**:
1. **`src/cli/index.ts`** — extend the repo-root import with `bootstrapRepoRoot`; register the
   `preAction` hook before `program.parse(process.argv)` (~L853).
2. **`src/index.ts`** — swap main()'s resolve+chdir (L146-150) for `getRepoRoot()`; swap the import
   (`resolveRepositoryRoot` → `getRepoRoot`); update the bootstrap comment.
3. **Unit tests** that call `parseCLIArgs` — mock `bootstrapRepoRoot` (no-op) so the hook doesn't
   chdir/throw during option-parsing tests (index.test.ts + the other 3 unit files if they break).
4. **One focused test** asserting the hook fires `bootstrapRepoRoot` with the right args.

**Success Definition**:
- Every action handler (root default + all subcommands) sees `process.cwd() === repoRoot` when its
  body runs (the hook chdir'd before it).
- `--repo-root <path>` flows through the hook to `bootstrapRepoRoot(…, { explicit })`; without
  `--repo-root`, the default upward traversal runs.
- `main()` reads the singleton via `getRepoRoot()` (the hook bootstrapped during parse); the explicit
  resolve+chdir at L146-150 is gone.
- A hook-thrown `NotARepositoryError` (e.g. `hack task` outside any repo) propagates to `main().catch()`'s
  dedicated clean arm (L417-419) → `❌ <message>` + exit 1 (no stack trace).
- `--help`/`--version` still short-circuit during parse (hook does NOT fire) → work anywhere.
- `npm run typecheck && npm run lint && npm run format:check` clean; affected unit tests + the hook
  test green; S1's repo-root suite stays green.

---

## Why

- **Fixes BUG-001 (§9.8.7/§9.8.9 acceptance).** The §9.8.3 "single chdir in main()" strategy is
  correct for the DEFAULT path but FALSE for subcommands: each subcommand `.action()` runs during
  `program.parse()` (src/cli/index.ts:853) and calls `process.exit()` before `main()`'s chdir. So
  `hack status` from `src/deep/nested` resolves `plan/` against the invocation dir → "No sessions
  found". The `preAction` hook is the PRD-recommended single-point fix (§9.8.7 "all subcommands
  benefit automatically" — now actually true).
- **One hook, not 6 per-handler edits.** The hook fires before EVERY action (root default + all
  subcommands), so all 6 unpatched subcommands inherit the correct cwd without per-handler changes.
- **Idempotent (S1's guard).** Commander fires `preAction` for both program + subcommand levels
  (double call); S1's `_bootstrapped` guard makes call #2 a no-op (no double chdir).
- **Auto-fixes subcommand `NotARepositoryError` rendering.** A hook throw propagates through
  `program.parse()` → `main().catch()`'s dedicated `NotARepositoryError` arm (L417) → clean render.
  No per-handler catch changes needed for this error class.
- **Scope discipline.** S2 = hook + main swap + keep unit tests green. S3 simplifies the (now-redundant)
  config handler; T2.S1 adds the comprehensive subcommand-from-subdir integration tests; BUG-002
  (HackConfigError) is P1.M2.

---

## What

### User-visible behavior
`hack task` / `status` / `cache` / `inspect` / `artifacts` / `validate-state` / `config` run from ANY
subdirectory now resolve `plan/`&`PRD.md` at the repo root (exactly as a root-launched run). `hack task`
outside any git repo now prints the clean "not a git repository / --repo-root" message + exit 1 (not
a scary "No sessions found" or stack trace).

### Technical requirements (exact contract)

**Edit A — `src/cli/index.ts`** (2 changes):
1. **Import** (~L47): `import { resolveRepositoryRoot, bootstrapRepoRoot } from '../utils/repo-root.js';`
   (KEEP `resolveRepositoryRoot` — the config handler at L608 still uses it; S3 removes that usage.)
2. **Hook** — immediately BEFORE `program.parse(process.argv)` (~L853):
   ```ts
   // PRD §9.8.3/§9.8.7: bootstrap repo-root resolution + chdir for ALL action handlers (root default
   // AND subcommands) via a single preAction hook. Subcommand .action() handlers run INSIDE
   // program.parse() — before main()'s chdir — so without this hook they resolve plan/PRD.md against
   // INVOCATION_CWD. The hook fires AFTER options are parsed (program.opts() has --repo-root) and
   // BEFORE the action body. _bootstrapped (in bootstrapRepoRoot) makes the program+subcommand
   // double-fire a no-op. A NotARepositoryError throw propagates to main().catch()'s clean arm.
   program.hook('preAction', () => {
     const opts = program.opts() as { repoRoot?: string };
     bootstrapRepoRoot(
       process.cwd(), // === INVOCATION_CWD (no chdir has happened yet at hook time)
       opts.repoRoot ? { explicit: opts.repoRoot } : undefined
     );
   });
   ```

**Edit B — `src/index.ts`** (2 changes):
1. **Import** (~L59-62): replace `resolveRepositoryRoot` with `getRepoRoot`:
   ```ts
   import { getRepoRoot } from './utils/repo-root.js';
   ```
   (After the swap, `resolveRepositoryRoot` is UNUSED in index.ts — grep confirms only import L60 +
   usage L146 — so REMOVE it; `no-unused-vars` would flag it. `INVOCATION_CWD` L68 STAYS — still used
   by the --prd pre-resolution logic.)
2. **main()** (~L146-150): replace the resolve+chdir with the singleton read:
   ```ts
   // BEFORE (L146-150):
   const { repoRoot } = resolveRepositoryRoot(
     INVOCATION_CWD,
     args.repoRoot ? { explicit: args.repoRoot } : undefined
   );
   process.chdir(repoRoot);
   // AFTER:
   // The preAction hook (registered in parseCLIArgs) already bootstrapped resolveRepositoryRoot +
   // process.chdir during program.parse() — for the default path (root's no-op .action) AND every
   // subcommand. Read the singleton (PRD §9.8.3). INVOCATION_CWD is still captured at module scope
   // (L68) for the --prd pre-resolution logic above.
   const repoRoot = getRepoRoot();
   ```
   (Keep the post-chdir `existsSync(args.prd)` check + the rest of main() UNCHANGED.)

### Success Criteria
- [ ] `preAction` hook registered before `program.parse`; calls `bootstrapRepoRoot(process.cwd(), {explicit}?)`.
- [ ] Root default + all subcommand actions see `process.cwd() === repoRoot` (hook chdir'd first).
- [ ] `main()` reads `getRepoRoot()` (no explicit resolve+chdir); `resolveRepositoryRoot` import removed from index.ts.
- [ ] Hook-thrown `NotARepositoryError` → `main().catch()` clean arm (L417) → `❌` + exit 1.
- [ ] `--help`/`--version` still work anywhere (hook doesn't fire — Commander short-circuits during parse).
- [ ] `npm run typecheck && npm run lint && npm run format:check` clean; affected unit tests + hook test green.

---

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed to implement
this successfully?_ **Yes** — S1's landed helper (with line numbers), the confirmed root no-op
`.action()` (so preAction fires for the default path), the Commander preAction semantics, the exact
3 edits (with before/after code), the test ripple (9 files, with the mock mitigation), and the
executable validation commands are all below.

### Documentation & References

```yaml
# MUST READ — full fix design (Steps 2 & 3 are S2) + risk/mitigation
- docfile: plan/009_94353b1a9fd3/bugfix/001_412283d974f7/architecture/bug_001_fix_strategy.md
  section: "Step 2: Register the hook in parseCLIArgs()" and "Step 3: Update main()" and "Risks & Mitigations"
  why: Verbatim hook code + main() swap + the "preAction fires for the program's own action" rationale
        (root has a no-op .action at cli/index.ts:465-468, so the default path is covered) + the test
        impact note (point 4: "Unit tests calling parseCLIArgs() directly need _resetBootstrap() in
        setup/teardown" — S2 mitigates by mocking bootstrapRepoRoot).

# MUST READ — Commander preAction semantics + S2 wiring + test ripple
- docfile: plan/009_94353b1a9fd3/bugfix/001_412283d974f7/P1M1T1S2/research/preaction-hook-wiring-design.md
  section: "2. CRITICAL — preAction fires for the DEFAULT path" and "4. The exact wiring" and "5. THE test ripple"
  why: Confirms the root no-op .action (so getRepoRoot() works in main()), the 3 edits, and the 9-file
        test ripple with the mock mitigation.

# MUST READ — Commander hook API (verified)
- docfile: plan/009_94353b1a9fd3/bugfix/001_412283d974f7/architecture/external_deps.md
  section: "Commander.js"
  why: "program.hook('preAction', listener) fires before any action handler (program-level default AND
        subcommands)"; fires AFTER options parsed (program.opts() has --repo-root); a throw propagates
        through program.parse() (NOT into the action's try/catch). commander v14.0.2.

# PATTERN FILE 1 — the CLI file being wired
- file: src/cli/index.ts
  why: The repo-root import (L47), the root no-op .action (L465-468), program.parse (L853), and the
        config handler (L599-621, S3-owned — leave it). S2 extends the import + adds the hook before L853.
  pattern: "import { resolveRepositoryRoot } from '../utils/repo-root.js';  →  + bootstrapRepoRoot"
  gotcha: KEEP resolveRepositoryRoot in the import (config handler L608 still uses it; S3 removes that).
        program.opts() returns ROOT options (--repo-root is root-level) → correct for all commands.

# PATTERN FILE 2 — main() being swapped
- file: src/index.ts
  why: main()'s resolve+chdir at L146-150 (the swap site); the import at L59-62; INVOCATION_CWD at L68
        (STAYS — used by --prd pre-resolution); the NotARepositoryError catch arm at L417-419 (handles
        hook throws). S2 swaps L146-150 → getRepoRoot() + updates the import.
  pattern: "const { repoRoot } = resolveRepositoryRoot(INVOCATION_CWD, …); process.chdir(repoRoot);  →  const repoRoot = getRepoRoot();"
  gotcha: After the swap, resolveRepositoryRoot is UNUSED in index.ts → remove it from the import
        (no-unused-vars). Do NOT remove INVOCATION_CWD (still used).

# PATTERN FILE 3 — S1's landed helper (READ-ONLY — consume, don't modify)
- file: src/utils/repo-root.ts
  why: bootstrapRepoRoot (L203) — idempotent (via _bootstrapped L92); calls resolveRepositoryRoot +
        process.chdir; re-throws NotARepositoryError. getRepoRoot (L148) — reads singleton; throws if unset.
        _resetBootstrap — test-only. S2 imports bootstrapRepoRoot (cli) + getRepoRoot (index).
  gotcha: The hook double-fires (program + subcommand level) — _bootstrapped makes call #2 a no-op
        (S1's design). Do NOT modify repo-root.ts.

# TEST FILE — the primary ripple + the hook-fires test site
- file: tests/unit/cli/index.test.ts
  why: Already mocks node:fs (L28) + uses setArgv (L136) + parseCLIArgs (L17). After S2, parseCLIArgs
        triggers the hook → bootstrapRepoRoot → chdir/throw. Add vi.mock('../../../src/utils/repo-root.js',
        () => ({ bootstrapRepoRoot: vi.fn(), resolveRepositoryRoot: vi.fn(), getRepoRoot: vi.fn(() => '/mock-repo') }))
        so option-parsing tests don't chdir. The existing --repo-root flow test (L426) still passes
        (it tests option flow, not bootstrap). Add the hook-fires assertion here (or a new block).
  gotcha: The mock must export EVERY repo-root symbol the SUT imports (bootstrapRepoRoot + any others
        cli/index.ts imports). List them from the import line.

# VERIFIED API SURFACE
- program.hook('preAction', (thisCommand, actionCommand) => void) — Commander v14; fires before any action.
- program.opts() — root options (has repoRoot regardless of which subcommand action is about to run).
- bootstrapRepoRoot(startDir, opts?: { explicit?: string }): string — idempotent; chdirs; throws NotARepositoryError.
- getRepoRoot(): string — reads singleton; throws if unset (won't throw post-hook — hook ran during parse).
```

### Current Codebase tree (relevant slice)

```bash
src/cli/index.ts                # EDIT — extend import + register preAction hook before program.parse
src/index.ts                    # EDIT — swap main() resolve+chdir → getRepoRoot(); swap import
tests/unit/cli/index.test.ts    # EDIT — mock bootstrapRepoRoot; add hook-fires test
# (+ the other 3 unit files calling parseCLIArgs, IF they break — mock bootstrapRepoRoot there too)
src/utils/repo-root.ts          # READ-ONLY (S1 — bootstrapRepoRoot/getRepoRoot consumed unchanged)
src/cli/commands/*.ts           # READ-ONLY (subcommand defaults resolve('plan') — correct after the hook chdirs)
```

### Desired Codebase tree with files to be added/edited

```bash
src/cli/index.ts                # MODIFIED (import + hook)
src/index.ts                    # MODIFIED (import swap + main() swap + comment)
tests/unit/cli/index.test.ts    # MODIFIED (mock + hook-fires test)
# Possibly: tests/unit/config/auth-preflight.test.ts, tests/unit/utils/logger-teardown.test.ts,
#   tests/unit/cli/apply-hack-cli-defaults.test.ts — add the same repo-root mock IF they break.
# No new source files. No docs (the fix aligns with existing §9.8.7/§9.8.9 — nothing describes the broken behavior).
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — the root program has a no-op .action() (cli/index.ts:465-468), so preAction fires for
//   the DEFAULT path too. That's WHY main()'s getRepoRoot() succeeds (the hook bootstrapped during
//   program.parse()). Do NOT add a fallback bootstrapRepoRoot() in main() — getRepoRoot() is correct.

// CRITICAL — after swapping main() to getRepoRoot(), resolveRepositoryRoot becomes UNUSED in index.ts
//   (grep: only import L60 + usage L146). REMOVE it from the import (no-unused-vars fails otherwise).
//   KEEP INVOCATION_CWD (L68) — the --prd pre-resolution logic still uses it.

// CRITICAL — KEEP resolveRepositoryRoot in cli/index.ts's import (L47). The config handler (L608) still
//   uses it; S3 removes that usage. S2 only ADDS bootstrapRepoRoot to the import. Do NOT touch the
//   config handler (S3 owns it).

// CRITICAL — the hook changes parseCLIArgs to have a chdir side effect (via bootstrapRepoRoot). Unit
//   tests calling parseCLIArgs will now chdir (or throw NotARepositoryError outside a repo). Mitigate by
//   mocking bootstrapRepoRoot (no-op) in those test files. The real chdir behavior is verified by
//   P1.M1.T2.S1's subprocess integration tests.

// GOTCHA — program.opts() returns ROOT options. --repo-root is a root option, so opts.repoRoot is
//   available for the default path AND every subcommand. Do NOT use actionCommand.opts() (subcommand
//   options) for --repo-root.

// GOTCHA — process.cwd() at hook time === INVOCATION_CWD (the chdir is what the hook DOES, so before
//   it runs, cwd is the invocation dir). This is correct for bootstrapRepoRoot's startDir + for
//   --repo-root relative-path resolution.

// GOTCHA — Commander fires preAction for BOTH program + subcommand levels (double call for a
//   subcommand). S1's _bootstrapped guard makes call #2 a no-op. Do NOT add your own guard.

// GOTCHA — a hook throw propagates through program.parse() → parseCLIArgs → main → main().catch(). It
//   does NOT enter the action's try/catch. The dedicated NotARepositoryError arm (index.ts:417) renders
//   it cleanly. No per-handler catch changes needed.

// GOTCHA — --help/--version short-circuit DURING program.parse() before any action → the hook does NOT
//   fire for them. So `hack --help` works anywhere (even outside a repo). Do NOT move the hook to fire
//   for help/version.

// GOTCHA — the test mock for repo-root must export EVERY symbol the SUT (cli/index.ts) imports from it.
//   After S2, cli/index.ts imports { resolveRepositoryRoot, bootstrapRepoRoot } — the mock must provide
//   both (as vi.fn()). index.ts imports { getRepoRoot } — its tests mock that separately if they call main().

// GOTCHA — vitest.config.ts enforces 100% coverage on src/**/*.ts. The hook's branches (opts.repoRoot
//   truthy/falsy) must be hit by the hook-fires test. The main() getRepoRoot() line is covered by any
//   main()-exercising test.

// GOTCHA — prettier is ERROR-enforced. Run `npm run fix` before format:check.

// GOTCHA — do NOT run the full `npm run test:run` as the S2 gate (orthogonal pre-existing failures).
//   DO run the parseCLIArgs-calling files to confirm the hook didn't break them.
```

---

## Implementation Blueprint

### Data models and structure
None — S2 is control-flow wiring (a hook registration + a 2-line swap). No types/constants/classes.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT src/cli/index.ts — register the preAction hook
  - EXTEND the import (L47): add bootstrapRepoRoot alongside resolveRepositoryRoot.
  - ADD the program.hook('preAction', …) block immediately BEFORE program.parse(process.argv) (~L853),
        per Edit A. Read program.opts().repoRoot; call bootstrapRepoRoot(process.cwd(), {explicit}?).
  - DO NOT: touch the config handler (L599-621 — S3), modify any .action() handler, remove
        resolveRepositoryRoot from the import, or move program.parse.
  - EXPECTED: typecheck clean. parseCLIArgs now has a chdir side effect (mitigated in Task 3).

Task 2: EDIT src/index.ts — swap main() to the singleton
  - SWAP the import (L59-62): resolveRepositoryRoot → getRepoRoot (remove the now-unused resolveRepositoryRoot).
  - SWAP main() L146-150: resolve+chdir → `const repoRoot = getRepoRoot();` (per Edit B). Update the
        bootstrap comment to explain the hook did the work during parse.
  - KEEP: INVOCATION_CWD (L68), the post-chdir existsSync(args.prd) check, the NotARepositoryError
        catch arm (L417-419), and everything else in main().
  - EXPECTED: typecheck clean (resolveRepositoryRoot removed cleanly — verify no other usage in index.ts).

Task 3: EDIT tests/unit/cli/index.test.ts — mock the bootstrap + add the hook-fires test
  - ADD vi.mock('../../../src/utils/repo-root.js', () => ({ resolveRepositoryRoot: vi.fn(),
        bootstrapRepoRoot: vi.fn(), getRepoRoot: vi.fn(() => '/mock-repo') })) (hoisted). Export EVERY
        symbol cli/index.ts imports from repo-root (resolveRepositoryRoot + bootstrapRepoRoot).
  - ADD a hook-fires test: setArgv([]) → parseCLIArgs() → assert bootstrapRepoRoot called once with
        (process.cwd(), undefined). setArgv(['--repo-root','/x']) → assert called with (process.cwd(),
        { explicit: '/x' }). (Use the mocked bootstrapRepoRoot spy.)
  - VERIFY the existing --repo-root flow test (L426) still passes (option flow, not bootstrap).
  - EXPECTED: index.test.ts green; the mock prevents the hook from chdir'ing during option-parsing tests.

Task 4: Check + fix the other parseCLIArgs-calling unit tests (ripple)
  - RUN: npx vitest run tests/unit/config/auth-preflight.test.ts tests/unit/utils/logger-teardown.test.ts
        tests/unit/cli/apply-hack-cli-defaults.test.ts.
  - IF any break (hook chdir/throw during parseCLIArgs): add the same vi.mock('../../../src/utils/repo-root.js',
        …) to that file. If a file needs a real repo-root context, run it from a repo or mock appropriately.
  - REVIEW the 5 integration files (parallelism-option, retry-options, cli-task-status, repo-root-semantics,
        repo-root-acceptance): subprocess-based tests (spawnSync in real repos) should benefit (hook fires
        correctly); in-process parseCLIArgs calls may need the mock. (The COMPREHENSIVE subcommand tests
        are T2.S1 — S2 only keeps existing tests green.)
  - EXPECTED: all parseCLIArgs-calling test files green.

Task 5: FORMAT + VERIFY
  - RUN: npm run fix → npm run typecheck → npm run lint → npm run format:check.
  - RUN: npx vitest run tests/unit/cli/index.test.ts tests/unit/utils/repo-root.test.ts (S2 wiring + S1 regression).
  - RUN: the other affected unit files (Task 4).
  - EXPECTED: all clean. If typecheck flags unused resolveRepositoryRoot in index.ts, confirm Task 2 removed it.
        If a unit test breaks on the hook's chdir, add the repo-root mock (Task 3/4).
```

### Implementation Patterns & Key Details

```ts
// ---- src/cli/index.ts: the hook (registered before program.parse) ----
import { resolveRepositoryRoot, bootstrapRepoRoot } from '../utils/repo-root.js';
// … (option chain, subcommands, root no-op .action) …
program.hook('preAction', () => {
  const opts = program.opts() as { repoRoot?: string };
  bootstrapRepoRoot(
    process.cwd(),                                            // === INVOCATION_CWD at hook time
    opts.repoRoot ? { explicit: opts.repoRoot } : undefined   // --repo-root short-circuits the search (§9.8.6)
  );
});
program.parse(process.argv);

// ---- src/index.ts: the main() swap ----
import { getRepoRoot } from './utils/repo-root.js';           // (was resolveRepositoryRoot — now unused, removed)
// …
// main(), where the resolve+chdir was (L146-150):
const repoRoot = getRepoRoot();   // the preAction hook bootstrapped during program.parse()

// ---- tests/unit/cli/index.test.ts: mock + hook-fires proof ----
vi.mock('../../../src/utils/repo-root.js', () => ({
  resolveRepositoryRoot: vi.fn(),
  bootstrapRepoRoot: vi.fn(),
  getRepoRoot: vi.fn(() => '/mock-repo'),
}));
import { bootstrapRepoRoot } from '../../../src/utils/repo-root.js';   // the spy (same module → mocked)
// …
it('preAction hook fires bootstrapRepoRoot with the resolved --repo-root', () => {
  setArgv(['--repo-root', '/explicit/repo']);
  parseCLIArgs();
  expect(bootstrapRepoRoot).toHaveBeenCalledWith(process.cwd(), { explicit: '/explicit/repo' });
});
it('preAction hook fires bootstrapRepoRoot with undefined when --repo-root omitted', () => {
  setArgv([]);
  parseCLIArgs();
  expect(bootstrapRepoRoot).toHaveBeenCalledWith(process.cwd(), undefined);
});
```

### Integration Points

```yaml
DOWNSTREAM (S2 ENABLES these — separate subtasks, do NOT do them here):
  - P1.M1.T1.S3 (simplify config handler): the config action (cli/index.ts:608) currently calls
        resolveRepositoryRoot inline — redundant after the hook. S3 replaces it with getRepoRoot() and
        removes resolveRepositoryRoot from the cli import (if no other usage). S2 leaves it (the double
        call is harmless — resolveRepositoryRoot doesn't chdir; _bootstrapped prevents a second chdir).
  - P1.M1.T2.S1 (subcommand integration tests): the comprehensive "each subcommand from a nested subdir
        + outside any repo" acceptance tests (§9.8.9). Depends on S2's hook being in place.

NO PER-HANDLER CHANGES: the hook fires before every action → all 6 unpatched subcommands (task/status/
  cache/inspect/artifacts/validate-state) + config inherit the correct cwd. The subcommand .action()
  bodies + the command-class defaults (resolve('plan')) are UNCHANGED — they're correct once the hook
  chdirs. main()'s pipeline path is UNCHANGED apart from the L146-150 swap.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run fix                  # lint:fix + prettier --write (run first)
npm run typecheck            # tsc --noEmit -p tsconfig.build.json — clean
npm run lint                 # eslint . --ext .ts — clean (watch unused resolveRepositoryRoot in index.ts)
npm run format:check         # prettier --check — clean
# Expected: all clean. If lint flags unused resolveRepositoryRoot in index.ts, confirm Task 2 removed it
# from the import. If lint flags an unused import in cli/index.ts, you removed resolveRepositoryRoot
# prematurely — KEEP it (the config handler L608 still uses it; S3 removes that).
```

### Level 2: Unit Tests (Component Validation)

```bash
# S2's gate — the hook-fires test + S1 helper regression + the ripple files:
npx vitest run tests/unit/cli/index.test.ts tests/unit/utils/repo-root.test.ts
npx vitest run tests/unit/config/auth-preflight.test.ts tests/unit/cli/apply-hack-cli-defaults.test.ts tests/unit/utils/logger-teardown.test.ts
# Expected: all green. If a unit test breaks on the hook's chdir, add the repo-root mock (Task 3/4).
# Do NOT run the full `npm run test:run` — orthogonal pre-existing failures.
```

### Level 3: Integration Testing (System Validation)

```bash
# Smoke: the hook fires for a subcommand from a subdir (real tmp git repo). The comprehensive suite is
# T2.S1; S2's smoke proves the wiring end-to-end for ONE subcommand:
npx tsx -e "
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const repo = mkdtempSync(join(tmpdir(),'hook-')); mkdirSync(join(repo,'.git')); mkdirSync(join(repo,'plan'),{recursive:true});
mkdirSync(join(repo,'src','deep','nested'),{recursive:true});
writeFileSync(join(repo,'PRD.md'),'# x');
const tsx = join(process.cwd(),'node_modules','.bin','tsx'); const idx = join(process.cwd(),'src/index.ts');
// Run `hack task` from the nested subdir — before the fix this failed; now the hook chdirs to repo root.
const r = spawnSync(tsx, [idx, 'task'], { cwd: join(repo,'src','deep','nested'), encoding:'utf8' });
console.log('exit:', r.status); console.log('stderr:', r.stderr.slice(0,200));
rmSync(repo,{recursive:true,force:true});
"
# Expected: the subcommand runs with cwd === repo root (no "No sessions found" from a stray plan/ in the
# subdir). (Exact output depends on whether plan/ has sessions — the point is cwd is the repo root.)
```

### Level 4: Creative & Domain-Specific Validation

```bash
# No MCP/DB/HTTP surface. Domain checks (record in commit message):
#   - preAction fires for root default + all subcommands (one hook, not 6 edits).
#   - main() reads getRepoRoot() (the hook bootstrapped during parse); resolve+chdir removed.
#   - Hook-thrown NotARepositoryError → main().catch() clean arm (no stack trace).
#   - --help/--version short-circuit before the hook (work anywhere).
#   - _bootstrapped makes the program+subcommand double-fire a no-op (S1's guard).
#   - Unit tests that call parseCLIArgs mock bootstrapRepoRoot (no unwanted chdir during option-parsing tests).
#   - resolveRepositoryRoot import removed from index.ts (unused after the swap); KEPT in cli/index.ts (config handler, S3-owned).
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` clean.
- [ ] `npm run lint` clean (resolveRepositoryRoot removed from index.ts import; KEPT in cli/index.ts).
- [ ] `npm run format:check` clean.
- [ ] `npx vitest run tests/unit/cli/index.test.ts tests/unit/utils/repo-root.test.ts` green.
- [ ] The other parseCLIArgs-calling unit tests green (Task 4).

### Feature Validation
- [ ] `preAction` hook registered before `program.parse`; calls `bootstrapRepoRoot(process.cwd(), {explicit}?)`.
- [ ] Root default + all subcommand actions see `process.cwd() === repoRoot`.
- [ ] `main()` reads `getRepoRoot()`; the L146-150 resolve+chdir is gone.
- [ ] Hook-thrown `NotARepositoryError` → `main().catch()` clean arm (`❌` + exit 1).
- [ ] `--help`/`--version` still work anywhere (hook doesn't fire).

### Code Quality Validation
- [ ] Only `src/cli/index.ts` (import + hook) + `src/index.ts` (import swap + main swap) + test files touched.
- [ ] `repo-root.ts` (S1), the config handler (S3), and subcommand `.action()` bodies UNCHANGED.
- [ ] `resolveRepositoryRoot` removed from index.ts import (unused); KEPT in cli/index.ts (config handler).
- [ ] `INVOCATION_CWD` retained in index.ts (still used by --prd pre-resolution).
- [ ] Unit tests mock `bootstrapRepoRoot` so the hook doesn't chdir during option-parsing tests.

### Documentation & Deployment
- [ ] Bootstrap comment in main() updated (the hook did the work during parse).
- [ ] Hook comment in cli/index.ts cites §9.8.3/§9.8.7 + the double-fire idempotency + error propagation.
- [ ] Commit message notes: one preAction hook fixes all 6 subcommands; main() reads singleton; config
      simplification = S3; comprehensive subcommand tests = T2.S1; test-ripple mitigated by mocking.

---

## Anti-Patterns to Avoid

- ❌ Don't add a fallback `bootstrapRepoRoot()` in `main()` — the root's no-op `.action()` means the hook
      already fired for the default path; `getRepoRoot()` is correct. Adding a fallback masks a real bug.
- ❌ Don't remove `resolveRepositoryRoot` from `cli/index.ts`'s import — the config handler (L608) still
      uses it; S3 removes that usage. S2 only ADDS `bootstrapRepoRoot`.
- ❌ Don't forget to remove `resolveRepositoryRoot` from `index.ts`'s import after the swap — it becomes
      unused (no-unused-vars fails). (But KEEP `INVOCATION_CWD`.)
- ❌ Don't touch the config handler (L599-621) — that's S3. The double-call is harmless.
- ❌ Don't use `actionCommand.opts()` for `--repo-root` — it's a ROOT option; use `program.opts()`.
- ❌ Don't add your own idempotency guard — S1's `_bootstrapped` already handles the program+subcommand
      double-fire.
- ❌ Don't move the hook to fire for `--help`/`--version` — they short-circuit during parse (correct).
- ❌ Don't let unit tests call the REAL `bootstrapRepoRoot` via the hook — mock it (no-op) so option-parsing
      tests don't chdir/throw. The real chdir behavior is T2.S1's subprocess tests.
- ❌ Don't modify `repo-root.ts` (S1) or any subcommand `.action()` body (the hook makes them correct).
- ❌ Don't run the full `npm run test:run` as the gate — but DO run the parseCLIArgs-calling files to
      confirm the hook didn't break them.

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: S1's `bootstrapRepoRoot` is LANDED and verified (idempotent via `_bootstrapped`). The root
program's no-op `.action()` (cli/index.ts:465-468) is confirmed → preAction fires for the default path
→ `main()`'s `getRepoRoot()` succeeds (external_deps.md confirms "program-level default AND subcommands").
The 3 edits are shown as exact before/after code with line numbers. Commander v14's preAction semantics
are verified (fires after opts parsed, before action body; throw propagates to main().catch; double-fire
handled by S1's guard). The dedicated `NotARepositoryError` catch arm (index.ts:417) exists for hook
throws. The test ripple (9 files) is enumerated with the precise mock mitigation. Residual risks: (a)
the exact set of unit tests that break depends on whether they run in a repo / mock node:fs (the
mitigation — mock `bootstrapRepoRoot` — is specified per-file); (b) the integration test files need
review (subprocess vs in-process) — the comprehensive subcommand tests are T2.S1, so S2 only keeps
existing tests green. Both are covered. No external/runtime unknowns.