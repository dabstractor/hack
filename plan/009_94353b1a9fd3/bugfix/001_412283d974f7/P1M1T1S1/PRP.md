# PRP — P1.M1.T1.S1: Create `bootstrapRepoRoot()` helper in `src/utils/repo-root.ts`

> Bugfix 001, **BUG-001 (CRITICAL)** of
> `plan/009_94353b1a9fd3/bugfix/001_412283d974f7/TEST_RESULTS.md`.
> 6 of 7 subcommands resolve `plan/`&`PRD.md` against the invocation dir because their
> `.action()` handlers run inside `program.parse()` — before `main()`'s `process.chdir`.
> S1 adds the **idempotent `bootstrapRepoRoot()` wrapper** that S2's `preAction` hook will call
> for every command, fixing all subcommands with one hook instead of per-handler edits.

---

## Goal

**Feature Goal**: Add an exported, idempotent `bootstrapRepoRoot(startDir, opts?)` helper to
`src/utils/repo-root.ts` that encapsulates the two-step "resolve + `process.chdir`" bootstrap
behind a `_bootstrapped` guard, plus a test-only `_resetBootstrap()`. This is the primitive S2
wires into a Commander `preAction` hook so that repo-root resolution + chdir runs before ANY
action handler (including subcommands), making the double-invocation a no-op.

**Deliverable**:
1. **`src/utils/repo-root.ts`** — append `let _bootstrapped = false;`, `export function
   bootstrapRepoRoot(...)`, and `export function _resetBootstrap()`.
2. **`tests/unit/utils/repo-root.test.ts`** — append a `describe('bootstrapRepoRoot', …)` block.

**Success Definition**:
- `bootstrapRepoRoot(startDir, opts?)` calls `resolveRepositoryRoot` → `process.chdir(repoRoot)`
  → sets `_bootstrapped = true` → returns the repoRoot string.
- A second call (without reset) is a no-op: returns `getRepoRoot()` WITHOUT a second `chdir`.
- If `resolveRepositoryRoot` throws `NotARepositoryError`, `bootstrapRepoRoot` re-throws it and
  `_bootstrapped` stays `false` (so a retry re-runs).
- `_resetBootstrap()` sets `_bootstrapped = false` (test-only).
- `resolveRepositoryRoot` itself is UNCHANGED (the helper wraps it).
- `npm run typecheck && npm run lint && npm run format:check` clean; new tests pass; `repo-root.ts`
  remains at 100% coverage on the new lines.

---

## Why

- **Unblocks the BUG-001 fix (S2's `preAction` hook).** Subcommand `.action()` handlers execute
  inside `program.parse()` (src/cli/index.ts:853) — BEFORE `main()`'s chdir — so their
  `process.cwd()` is still INVOCATION_CWD and `resolve('plan')`/`resolve('PRD.md')` resolve to the
  wrong place. The fix is a single `preAction` hook that bootstraps before any action runs; that
  hook needs an idempotent helper (Commander can fire `preAction` for both program + subcommand
  levels → double call).
- **Encapsulates the two-step bootstrap.** Today `main()` does `resolveRepositoryRoot` +
  `process.chdir` as two separate steps (src/index.ts:147-150). Wrapping them in one idempotent
  function lets both the hook AND `main()` call the same primitive without double-chdir risk.
- **Scope discipline.** S1 = the helper + its tests ONLY. S2 wires the `preAction` hook, replaces
  `main()`'s two-step with `getRepoRoot()`, and simplifies the `config` handler. S1 does NOT touch
  `main()`, `resolveRepositoryRoot`, or any CLI file.

---

## What

### User-visible behavior
None (internal helper; no user/config/API surface change — Mode A = module JSDoc only).

### Technical requirements (exact contract)

**File:** `src/utils/repo-root.ts` (append; reuse the existing `ResolveRepoOpts` type,
`resolveRepositoryRoot`, `getRepoRoot` — do NOT modify them).

Add a module-level idempotency flag near the existing `_repoRoot`/`_invocationCwd` singletons:
```ts
let _bootstrapped = false;
```

Add two exports:
```ts
/**
 * Resolve the repository root and chdir to it (idempotent). PRD §9.8.3.
 *
 * Called from the Commander preAction hook (all commands) and from main()'s default path.
 * The `_bootstrapped` guard makes double-invocation (Commander hook cascade for program +
 * subcommand levels, or a main() follow-up) a no-op after the first call.
 *
 * @returns The canonicalized repository root.
 * @throws {NotARepositoryError} If no `.git` entry is found (propagated from resolveRepositoryRoot).
 */
export function bootstrapRepoRoot(startDir: string, opts?: ResolveRepoOpts): string {
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

**Purity/side-effects:** `bootstrapRepoRoot` performs TWO side effects — `process.chdir(repoRoot)`
and setting `_bootstrapped` (and, via `resolveRepositoryRoot`, setting `_repoRoot`/`_invocationCwd`).
Document all three in the JSDoc.

### Success Criteria
- [ ] `bootstrapRepoRoot` exported; returns `string` (the repoRoot).
- [ ] First call: `resolveRepositoryRoot` + `process.chdir` run; returns repoRoot; `_bootstrapped` true.
- [ ] Second call (no reset): returns same repoRoot via `getRepoRoot()`; NO second `chdir`.
- [ ] `resolveRepositoryRoot` throw → `bootstrapRepoRoot` re-throws `NotARepositoryError`; `_bootstrapped` stays false.
- [ ] `_resetBootstrap()` exported; sets `_bootstrapped = false`.
- [ ] `resolveRepositoryRoot` itself is byte-for-byte unchanged.
- [ ] `npm run typecheck && npm run lint && npm run format:check` clean; new tests pass; `repo-root.ts` 100% on new lines.

---

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed to implement
this successfully?_ **Yes** — the exact existing symbols to reuse (with the function that sets the
singletons), the verbatim helper source, the idempotency rationale, the test file's mocking pattern
to mirror (with the `process.chdir` spy gotcha), and the executable validation commands are all below.

### Documentation & References

```yaml
# MUST READ — full fix design (the helper is Step 1)
- docfile: plan/009_94353b1a9fd3/bugfix/001_412283d974f7/architecture/bug_001_fix_strategy.md
  section: "Step 1: bootstrapRepoRoot() helper in src/utils/repo-root.ts" and "Risks & Mitigations"
  why: Gives the verbatim helper source + the idempotency rationale (Commander preAction fires for
        program + subcommand levels → double call) + the BUG-002 interaction (NotARepositoryError
        propagates through program.parse → main().catch → clean render arm).
  critical: S1 ONLY adds the helper. The preAction hook wiring, the main() getRepoRoot() swap, and
        the config-handler simplification are ALL S2 (P1.M1.T1.S2 / P1.M1.T1.S3). Do not do them here.

# MUST READ — helper source + test strategy (authored with this PRP)
- docfile: plan/009_94353b1a9fd3/bugfix/001_412283d974f7/P1M1T1S1/research/bootstrap-helper-design.md
  section: "2. S1 scope" and "4. Test strategy"
  why: Verbatim helper, the chdir-spy gotcha (mocked-fs paths don't exist on real disk), and the
        per-branch coverage cases.

# PATTERN FILE — the only source file edited
- file: src/utils/repo-root.ts
  why: Append _bootstrapped + bootstrapRepoRoot + _resetBootstrap. Reuse the existing ResolveRepoOpts
        type, resolveRepositoryRoot, and getRepoRoot (do NOT modify them). Place _bootstrapped next to
        the existing _repoRoot/_invocationCwd singletons.
  pattern: "let _repoRoot: string | undefined; let _invocationCwd: string | undefined;  // module singletons"
  gotcha: resolveRepositoryRoot sets _repoRoot/_invocationCwd but does NOT chdir — bootstrapRepoRoot
        adds the chdir + the _bootstrapped guard. Don't move the chdir into resolveRepositoryRoot.

# PATTERN FILE — test style to mirror (extend, don't rewrite)
- file: tests/unit/utils/repo-root.test.ts
  why: Already mocks node:fs (existsSync/realpathSync) via vi.mock('node:fs', …) and RE-IMPORTS the
        module fresh in beforeEach (so _bootstrapped/_repoRoot/_invocationCwd reset per test). Add a
        new describe('bootstrapRepoRoot') block mirroring this. Because the mocked-fs paths (e.g.
        '/repo') don't exist on real disk, you MUST spy process.chdir with a no-op impl.
  pattern: "vi.mock('node:fs', () => ({ existsSync: vi.fn(), realpathSync: vi.fn() }));  beforeEach(async () => { const mod = await import('…'); … })"
  gotcha: "vi.spyOn(process, 'chdir').mockImplementation(() => {}) — a REAL chdir('/repo') would
        throw ENOENT because the mocked fs paths aren't real directories. Assert the spy was called
        with repoRoot; restore in afterEach."

# VERIFIED API SURFACE (do not re-discover)
- symbol: resolveRepositoryRoot(startDir, opts?: ResolveRepoOpts): { repoRoot; invocationCwd }  # sets singletons, throws NotARepositoryError, NO chdir
- symbol: getRepoRoot(): string  # reads _repoRoot; throws if unset
- symbol: ResolveRepoOpts { explicit?: string }
- main() today (src/index.ts:147-150): resolveRepositoryRoot(INVOCATION_CWD, …) + process.chdir(repoRoot) — UNCHANGED in S1 (S2 swaps to getRepoRoot())
```

### Current Codebase tree (relevant slice)

```bash
src/utils/repo-root.ts                 # EDIT — append _bootstrapped + bootstrapRepoRoot + _resetBootstrap + JSDoc
tests/unit/utils/repo-root.test.ts     # EDIT — append describe('bootstrapRepoRoot') block
```

### Desired Codebase tree with files to be added/edited

```bash
src/utils/repo-root.ts                 # MODIFIED (append-only: 1 flag + 2 exports + JSDoc)
tests/unit/utils/repo-root.test.ts     # MODIFIED (append-only: new describe block)
# No other files. main()/resolveRepositoryRoot/CLI UNCHANGED (S2 owns the wiring).
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — S1 is ADDITIVE ONLY. Do NOT modify resolveRepositoryRoot, main(), or any CLI file.
//   The preAction hook, the main() getRepoRoot() swap, and the config-handler simplification are S2.

// CRITICAL — the `_bootstrapped` guard is MANDATORY, not optional. Commander fires preAction per
//   command level; for a subcommand it can fire twice (program + subcommand). Without the guard the
//   second call re-runs resolveRepositoryRoot + a second chdir. The guard makes call #2 a no-op.

// GOTCHA — bootstrapRepoRoot returns `string` (repoRoot), NOT the {repoRoot, invocationCwd} object.
//   S2's hook + main() need just the root (or use getRepoRoot() afterward).

// GOTCHA — the `if (_bootstrapped) return getRepoRoot()` path is SAFE: _bootstrapped===true implies
//   a prior call completed (which set _repoRoot), so getRepoRoot() won't throw there. Don't add a
//   redundant undefined check.

// GOTCHA — _bootstrapped must be set AFTER process.chdir (which is after resolveRepositoryRoot).
//   If resolveRepositoryRoot throws, _bootstrapped stays false → a retry re-runs. Desired + tested.

// GOTCHA — _resetBootstrap resets ONLY _bootstrapped (per contract), NOT the singletons. That's fine:
//   a subsequent bootstrapRepoRoot call re-runs resolveRepositoryRoot, which OVERWRITES the singletons
//   fresh. (The accessor-unset branch of getRepoRoot is already tested by the existing suite.)

// GOTCHA — tests MUST spy process.chdir with a no-op impl: vi.spyOn(process, 'chdir').mockImplementation(() => {}).
//   The mocked-fs paths ('/repo') aren't real dirs → a real chdir throws ENOENT. Restore in afterEach.

// GOTCHA — the existing repo-root.test.ts re-imports the module fresh in beforeEach, so _bootstrapped
//   resets per test within that file. _resetBootstrap is still exported for OTHER consumers (S2's hook
//   tests in a different file that import the module once). Export it regardless (contract requires it).

// GOTCHA — vitest.config.ts enforces 100% coverage on src/**/*.ts. Every new branch must be hit:
//   _bootstrapped true (idempotent return) / false (first call); chdir call; _resetBootstrap body;
//   error-propagation (resolveRepositoryRoot throws → re-throw, _bootstrapped stays false).

// GOTCHA — prettier is ERROR-enforced. Run `npm run fix` before format:check.

// GOTCHA — do NOT run the full `npm run test:run` as the S1 gate. Use the targeted repo-root suite.
```

---

## Implementation Blueprint

### Data models and structure
None — a boolean module flag + two thin functions wrapping existing exports. No types/constants/classes.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT src/utils/repo-root.ts — add the helper + flag + reset
  - ADD `let _bootstrapped = false;` next to the existing `_repoRoot`/`_invocationCwd` singletons.
  - ADD `export function bootstrapRepoRoot(startDir: string, opts?: ResolveRepoOpts): string` using
        the verbatim body from the contract (idempotent guard → resolveRepositoryRoot → process.chdir
        → set _bootstrapped → return repoRoot).
  - ADD `export function _resetBootstrap(): void { _bootstrapped = false; }`.
  - ADD JSDoc on bootstrapRepoRoot (Mode A): documents the resolve+chdir+singleton side effects, the
        idempotency rationale (Commander preAction cascade), and the NotARepositoryError propagation.
  - DO NOT: modify resolveRepositoryRoot / getRepoRoot / getInvocationCwd / NotARepositoryError, or
        touch main()/CLI files. Reuse the existing ResolveRepoOpts import (already in-file).

Task 2: EDIT tests/unit/utils/repo-root.test.ts — append describe('bootstrapRepoRoot')
  - MIRROR the file's existing mock pattern (vi.mock('node:fs') + fresh re-import in beforeEach).
  - In the new describe block, additionally: const chdirSpy = vi.spyOn(process, 'chdir').mockImplementation(() => {});
        restore via chdirSpy.mockRestore() in the block's afterEach (or a local afterEach).
  - IMPORT bootstrapRepoRoot + _resetBootstrap from the freshly-imported module (`mod.bootstrapRepoRoot`).
  - CASES (cover every new branch):
      1. first call → resolveRepositoryRoot runs (mock existsSync true for '/repo/.git', realpathSync
         identity); chdirSpy called once with '/repo'; returns '/repo'; idempotent flag set.
      2. idempotent second call (no reset) → returns '/repo' again; chdirSpy STILL called once total
         (assert call count unchanged) — proves the guard short-circuits before chdir.
      3. _resetBootstrap() → next bootstrapRepoRoot call re-runs resolve+chdir (chdirSpy call count
         rises to 2).
      4. error propagation → mock existsSync false everywhere → bootstrapRepoRoot throws
         NotARepositoryError; _bootstrapped stays false (verify by flipping existsSync back true and
         confirming a follow-up call runs resolve+chdir fresh).
      5. opts.explicit passthrough → bootstrapRepoRoot('/start', { explicit: '/repo' }) → resolve uses
         the explicit root (mock existsSync true for '/repo/.git').
  - NAMING: it('chdirs to the resolved root on first call'), it('is idempotent (no second chdir)'),
        it('_resetBootstrap allows re-bootstrap'), it('propagates NotARepositoryError and stays un-bootstrapped'),
        it('passes opts.explicit through to resolveRepositoryRoot').
  - PLACEMENT: append the new describe block at the end of the existing file.

Task 3: FORMAT + VERIFY
  - RUN: npm run fix → npm run typecheck → npm run lint → npm run format:check.
  - RUN: npx vitest run tests/unit/utils/repo-root.test.ts --coverage.
  - EXPECTED: all clean; repo-root.ts at 100% coverage (existing + new lines). If a new branch is
        uncovered, add the matching case.
```

### Implementation Patterns & Key Details

```ts
// PATTERN — the idempotent wrapper (verbatim from the contract).
let _bootstrapped = false;

export function bootstrapRepoRoot(startDir: string, opts?: ResolveRepoOpts): string {
  if (_bootstrapped) return getRepoRoot();                        // no-op after first call
  const { repoRoot } = resolveRepositoryRoot(startDir, opts);    // sets singletons; throws NotARepositoryError
  process.chdir(repoRoot);                                        // the single bootstrap chdir (§9.8.3)
  _bootstrapped = true;
  return repoRoot;
}

export function _resetBootstrap(): void {
  _bootstrapped = false;
}

// PATTERN — test spy (mocked-fs paths aren't real dirs → real chdir would ENOENT).
const chdirSpy = vi.spyOn(process, 'chdir').mockImplementation(() => {});
// … call mod.bootstrapRepoRoot('/repo') …
expect(chdirSpy).toHaveBeenCalledWith('/repo');
// second call (idempotent): chdirSpy called once total — NOT twice
mod.bootstrapRepoRoot('/repo');
expect(chdirSpy).toHaveBeenCalledTimes(1);
```

### Integration Points

```yaml
DOWNSTREAM (S1 ENABLES these — separate subtasks, do NOT do them here):
  - P1.M1.T1.S2 (preAction hook + main() swap): registers program.hook('preAction', () =>
        bootstrapRepoRoot(process.cwd(), program.opts().repoRoot ? {explicit} : undefined)) before
        program.parse() (src/cli/index.ts ~L853); replaces main()'s resolveRepositoryRoot+chdir
        (src/index.ts:147-150) with `const repoRoot = getRepoRoot();`.
  - P1.M1.T1.S3 (simplify config handler): replaces the inline resolveRepositoryRoot in the config
        action (src/cli/index.ts:608) with `getRepoRoot()`.
  - BUG-002 interaction: when the hook throws NotARepositoryError, it propagates program.parse →
        parseCLIArgs → main → main().catch (dedicated NotARepositoryError arm) → clean render.

NO OTHER INTEGRATION in S1: the helper has no callers yet (S2 wires it). resolveRepositoryRoot,
getRepoRoot, and the singletons are consumed unchanged.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run fix                  # lint:fix + prettier --write (run first)
npm run typecheck            # tsc --noEmit -p tsconfig.build.json — clean
npm run lint                 # eslint . --ext .ts — clean
npm run format:check         # prettier --check — clean
# Expected: all clean. If no-unused-vars flags opts/startDir, ensure bootstrapRepoRoot reads both
# (opts is passed through; startDir is passed to resolveRepositoryRoot).
```

### Level 2: Unit Tests (Component Validation)

```bash
npx vitest run tests/unit/utils/repo-root.test.ts --coverage
# Expected: all green; src/utils/repo-root.ts at 100% coverage on existing + new lines. If a new
# branch is uncovered (idempotent-return / error-propagation / _resetBootstrap), add the matching case.
# Do NOT run the full `npm run test:run` — orthogonal pre-existing failures are out of scope.
```

### Level 3: Integration Testing (System Validation)

```bash
# N/A for S1 — the helper has no callers yet (S2 wires the preAction hook). A pure-function smoke
# proving the idempotent contract:
npx tsx -e "
import { bootstrapRepoRoot, _resetBootstrap, getRepoRoot } from './src/utils/repo-root.ts';
const calls = []; const orig = process.chdir; process.chdir = (d) => { calls.push(d); };
try { const r1 = bootstrapRepoRoot(process.cwd()); const r2 = bootstrapRepoRoot(process.cwd()); console.log('r1===r2:', r1===r2, '| chdir calls:', calls.length); console.log('getRepoRoot:', getRepoRoot()); _resetBootstrap(); } finally { process.chdir = orig; }
"
# Expected (run inside the hacky-hack repo): r1===r2: true | chdir calls: 1 | getRepoRoot: <repo realpath>.
# (chdir is stubbed so the test process cwd isn't actually changed; idempotency → 1 chdir call.)
```

### Level 4: Creative & Domain-Specific Validation

```bash
# N/A — a thin idempotent wrapper with no creative surface. Domain checks (record in commit msg):
#   - Idempotent: 2nd call is a no-op (no second chdir).
#   - Error propagation: NotARepositoryError re-thrown; _bootstrapped stays false (retryable).
#   - _resetBootstrap exported for test/S2-hook-test use.
#   - resolveRepositoryRoot itself unchanged.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` clean.
- [ ] `npm run lint` clean.
- [ ] `npm run format:check` clean.
- [ ] `npx vitest run tests/unit/utils/repo-root.test.ts` green.
- [ ] `src/utils/repo-root.ts` at 100% coverage (existing + new lines).

### Feature Validation
- [ ] `bootstrapRepoRoot` exported; returns `string`.
- [ ] First call: resolve + chdir + `_bootstrapped=true` + return repoRoot.
- [ ] Second call (no reset): no-op (no second chdir), returns same root.
- [ ] `NotARepositoryError` propagated; `_bootstrapped` stays false.
- [ ] `_resetBootstrap()` exported; resets `_bootstrapped`.
- [ ] `opts.explicit` passed through to `resolveRepositoryRoot`.

### Code Quality Validation
- [ ] Only `src/utils/repo-root.ts` (append flag + 2 exports + JSDoc) + test file (append block) modified.
- [ ] `resolveRepositoryRoot` / `getRepoRoot` / `main()` / CLI files UNCHANGED (S2 owns wiring).
- [ ] `_bootstrapped` placed next to the existing singletons; set AFTER chdir (error-safe).
- [ ] Tests mirror the existing file's `vi.mock('node:fs')` + fresh-reimport pattern; `process.chdir` spied with no-op.

### Documentation & Deployment
- [ ] JSDoc on `bootstrapRepoRoot` (side effects: chdir + singleton set; idempotency rationale; NotARepositoryError propagation).
- [ ] Commit message notes: idempotent wrapper; S2 wires the preAction hook + main() swap + config simplification.

---

## Anti-Patterns to Avoid

- ❌ Don't modify `resolveRepositoryRoot`, `main()`, or any CLI file — S1 is the helper + tests ONLY.
- ❌ Don't wire the `preAction` hook or swap `main()` to `getRepoRoot()` — that's S2.
- ❌ Don't drop or make the `_bootstrapped` guard optional — Commander fires `preAction` per level (double call); the guard is the whole point.
- ❌ Don't set `_bootstrapped = true` BEFORE `process.chdir`/resolve — if resolve throws, the flag must stay false (retryable).
- ❌ Don't return `{ repoRoot, invocationCwd }` — the contract signature is `: string`.
- ❌ Don't reset the singletons in `_resetBootstrap` — only `_bootstrapped` (per contract); re-bootstrap overwrites the singletons fresh anyway.
- ❌ Don't call real `process.chdir` in unit tests — mocked-fs paths aren't real dirs (ENOENT). Spy with a no-op impl.
- ❌ Don't move the `chdir` into `resolveRepositoryRoot` — it must stay in the wrapper (resolveRepositoryRoot is a pure resolver that callers may use without chdir'ing).
- ❌ Don't add a redundant `undefined` check in the `if (_bootstrapped) return getRepoRoot()` path — `_bootstrapped===true` guarantees `_repoRoot` is set.
- ❌ Don't run the full `npm run test:run` as the S1 gate — use the targeted repo-root suite.

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: This is a tiny, surgical addition — one boolean flag + two thin functions (verbatim source
supplied in the contract) + a focused test block. The existing module surface (`resolveRepositoryRoot`,
`getRepoRoot`, `ResolveRepoOpts`, singletons) is verified present and reused unchanged. The one genuine
testing gotcha (mocked-fs paths → real `process.chdir` ENOENTs → must spy with a no-op) is explicitly
called out, and the existing test file's mocking/fresh-reimport pattern is the model to mirror. The
idempotency rationale and error-propagation invariant are documented and testable. The only residual
risk is a coverage miss on one of the small branches (idempotent-return / error-stays-unbootstrapped),
which the per-branch test plan covers. No external/runtime unknowns.