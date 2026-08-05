# PRP — P1.M1.T1.S1: `resolveRepositoryRoot` + bootstrap `chdir` in `main()`

> Foundation subtask for PRD §9.8 (Repository Root Resolution — Upward `.git` Traversal).
> S1 adds the resolver engine (`src/utils/repo-root.ts`), the `NotARepositoryError` typed
> error, module-singleton accessors, and wires the bootstrap into `main()`: capture
> `INVOCATION_CWD`, resolve the repo root, and `process.chdir(repoRoot)` BEFORE
> `configureEnvironment()`. Consumed by S2 (`--repo-root` flag) and P2.M1.T1.S2 (`.hack` loader).

---

## Goal

**Feature Goal**: Implement upward `.git` traversal that finds the nearest repository root from
the invocation cwd (PRD §9.8.2), accepting `.git` as EITHER a directory (normal clone) OR a file
(worktree/submodule `gitdir:` pointer — §9.8.4), throwing a typed `NotARepositoryError`
(§9.8.5) when none is found. Wire it into `main()` as the first step after CLI parsing so the
single `process.chdir(repoRoot)` makes every downstream `process.cwd()`/`resolve(...)` site
(repo-relative) resolve correctly with zero per-site changes (§9.8.3).

**Deliverable**:
1. **`src/utils/repo-root.ts`** (NEW) — exports `resolveRepositoryRoot`, `NotARepositoryError`,
   `getRepoRoot()`, `getInvocationCwd()`, and the `ResolveRepoOpts` interface.
2. **`src/index.ts`** — capture `INVOCATION_CWD` at module scope; in `main()`, call
   `resolveRepositoryRoot(INVOCATION_CWD)` + `process.chdir(repoRoot)` after the subcommand
   early-return and before `configureEnvironment()`.
3. **`tests/unit/utils/repo-root.test.ts`** (NEW) — vi.mock-fs traversal/edge-case tests.
4. **`tests/integration/utils/repo-root.test.ts`** (NEW) — real-tmpdir `.git` (dir + file) tests.
5. **Docs (Mode A)** — JSDoc on `resolveRepositoryRoot` (dir-or-file detection, nearest-ancestor
   rule, hard-error contract); bootstrap-ordering comment at the `main()` insertion site.

**Success Definition**:
- From a nested subdirectory of a git repo, `resolveRepositoryRoot(subdir).repoRoot` returns the
  nearest ancestor containing `.git`, canonicalized via `realpathSync`.
- `.git` as a directory AND as a file are both detected.
- Reaching the filesystem root without `.git` throws `NotARepositoryError` carrying the
  searched-from dir + `--repo-root` remediation.
- `main()` does `process.chdir(repoRoot)` after `parseCLIArgs()` and before
  `configureEnvironment()`; `--help`/`--version`/usage errors still short-circuit inside
  `parseCLIArgs()` (Commander `process.exit`) and never reach the traversal.
- `getRepoRoot()`/`getInvocationCwd()` return the resolved values after bootstrap and throw
  clearly if accessed before.
- `npm run typecheck && npm run lint && npm run format:check` clean; new tests pass at 100%
  coverage on `repo-root.ts`.

---

## Why

- **Git is a hard prerequisite (PRD §8 / §9.8.1).** Smart commits, task recovery, and session
  state all depend on git running at the repository root. Today there is NO repo-root resolution
  anywhere in `src/` — every site reads `process.cwd()` inline (~30 sites), so running `hack`
  from a subdirectory silently operates in the wrong directory.
- **Single-bootstrap-`chdir` eliminates per-site churn (§9.8.3).** One `process.chdir(repoRoot)`
  during bootstrap makes all existing `resolve('PRD.md')`/`resolve('plan')`/`process.cwd()` sites
  resolve to the repo root with ZERO changes — verified by the architecture scout
  (system_context.md §2.2).
- **Captures `INVOCATION_CWD` for consumers that need the original dir.** `.hack` discovery
  (P2), error messages, and child-process cwd semantics (§9.8.7) need the pre-chdir invocation
  directory; the module singleton exposes it.
- **Unblocks S2 (`--repo-root` flag) and P2 (` .hack` loader).** S2 wires the CLI override;
  P2.M1.T1.S2's `.hack` loader needs `getRepoRoot()`.
- **Scope discipline.** S1 = resolver engine + bootstrap wiring. The `--repo-root` CLI flag (S2),
  the clean-error-render arm in `main().catch()` + child-inheritance UX (P1.M1.T2.S1), and
  `.hack` loading (P2) are separate subtasks.

---

## What

### User-visible behavior
Running `hack` from any subdirectory of a git repository now operates against the repository
root (plans created in `<repoRoot>/plan/`, git ops at `<repoRoot>`, etc.) instead of the cwd.
Running `hack` outside any git repository aborts at startup with a clear, actionable error.

### Technical requirements (exact contract)

**File 1 — `src/utils/repo-root.ts`** (NEW). Exports:
- `interface ResolveRepoOpts { explicit?: string }` — forward-compat for S2's `--repo-root`.
- `class NotARepositoryError extends Error` — `readonly searchedFrom: string; readonly explicit: boolean;`
  `this.name = 'NotARepositoryError'`; message includes the searched-from dir + `--repo-root`
  remediation (mirror the `SessionFileError`/`AuthPreflightError` typed-error convention).
- `resolveRepositoryRoot(startDir: string, opts?: ResolveRepoOpts): { repoRoot: string; invocationCwd: string }`
  - **Default (no `opts.explicit`)** — upward traversal (§9.8.2): from `resolve(startDir)`, at each
    dir test `existsSync(join(dir, '.git'))` (true for dir OR file → §9.8.4); return the FIRST
    (nearest) ancestor with `.git`; if `dirname(dir) === dir` (filesystem root) is reached
    without `.git`, throw `NotARepositoryError(startDir)`.
  - **Explicit (`opts.explicit` set)** — resolve to absolute; verify `.git` present (dir-or-file);
    throw `NotARepositoryError(abs, { explicit: true })` if absent; else return `abs`.
  - On success, canonicalize via `realpathSync(found)`; store `repoRoot` + `invocationCwd = startDir`
    into the module singleton; return `{ repoRoot, invocationCwd }`.
- `getRepoRoot(): string` — returns the stored `repoRoot`; throws a clear Error if accessed before
  `resolveRepositoryRoot` has run.
- `getInvocationCwd(): string` — returns the stored `invocationCwd`; throws if not yet set.

**File 2 — `src/index.ts`** (edit `main()`):
- Add a module-scope `const INVOCATION_CWD = process.cwd();` (top of file, with other top-level
  declarations) — evaluated at import, strictly before `main()` runs (satisfies "module-level
  const" + "before parseCLIArgs").
- In `main()`, immediately AFTER the subcommand early-return (`if ('subcommand' in parseResult) return 0;`,
  ~L119) and BEFORE `setupGlobalHandlers`/`configureEnvironment()` (~L125/L128), insert:
  ```ts
  // Bootstrap: resolve repository root + chdir BEFORE configureEnvironment() (PRD §9.8.3 / §9.7.9).
  // Placed AFTER parseCLIArgs() so --help/--version/usage errors short-circuit first (Commander
  // process.exit during parse). S2 will pass { explicit: args.repoRoot } once --repo-root lands.
  const { repoRoot } = resolveRepositoryRoot(INVOCATION_CWD);
  process.chdir(repoRoot);
  ```
- Add the `resolveRepositoryRoot` import.

**File 3/4 — tests** (NEW): unit (vi.mock fs) + integration (real tmpdir). See blueprint.

**Docs (Mode A):** JSDoc on `resolveRepositoryRoot` documenting the dir-or-file `.git` detection,
nearest-ancestor rule, hard-error contract, and the singleton side effect; bootstrap-ordering
comment at the `main()` insertion site citing §9.8.3 / §9.7.9.

### Success Criteria
- [ ] `resolveRepositoryRoot`, `NotARepositoryError`, `getRepoRoot`, `getInvocationCwd`, `ResolveRepoOpts` exported.
- [ ] Upward traversal finds the nearest `.git` ancestor; `.git` dir AND `.git` file both detected.
- [ ] Root-reached-without-`.git` → `NotARepositoryError` (carries searchedFrom + remediation).
- [ ] Explicit path with `.git` → returned canonicalized; without `.git` → `NotARepositoryError(explicit:true)`.
- [ ] `realpathSync` canonicalizes the result.
- [ ] `main()` captures `INVOCATION_CWD` at module scope and does `process.chdir(repoRoot)` after
      `parseCLIArgs()` return and before `configureEnvironment()`.
- [ ] `getRepoRoot()`/`getInvocationCwd()` throw clearly before bootstrap; return correct after.
- [ ] `npm run typecheck && npm run lint && npm run format:check` clean; new tests pass; `repo-root.ts` 100% coverage.

---

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed to implement
this successfully?_ **Yes** — the exact bootstrap line numbers, the dir-or-file `.git` pattern to
mirror (with file:line), the resolver algorithm with worked edge cases, the typed-error convention
to follow, the module-singleton design, the precise `main()` insertion site, and the executable
validation commands are all specified below.

### Documentation & References

```yaml
# MUST READ — current bootstrap ordering + cwd-site inventory + the dir-or-file pattern
- docfile: plan/009_94353b1a9fd3/architecture/bootstrap-and-reporoot.md
  section: "1. Bootstrap ordering in src/index.ts main()" and "3. validateRepositoryPath"
  why: Confirms the exact main() step order (parseCLIArgs L112 → subcommand return L113-119 →
        configureEnvironment L128) and that existsSync already accepts .git-as-file (§9.8.4).
  critical: NO chdir / NO traversal / NO INVOCATION_CWD exists today. main().catch() has clean arms
        for AuthPreflightError/HarnessProviderMismatchError/UnsupportedHarnessError — a dedicated
        NotARepositoryError arm is P1.M1.T2.S1, NOT S1.

# MUST READ — §9.8 scout + single-chdir strategy
- docfile: plan/009_94353b1a9fd3/architecture/system_context.md
  section: "2.1 Bootstrap Ordering", "2.2 process.cwd() sites", "2.3 validateRepositoryPath"
  why: The ~30 process.cwd() sites + cwd-relative resolve() sites all become correct after one
        chdir — ZERO per-site changes. Do NOT modify validateRepositoryPath.

# MUST READ — resolver algorithm + edge cases + scope decision (authored with this PRP)
- docfile: plan/009_94353b1a9fd3/P1M1T1S1/research/repo-root-resolver-design.md
  section: "4. The resolver (src/utils/repo-root.ts) — design" and "5. Algorithm edge cases"
  why: Full resolver source skeleton, the explicit-branch scope decision, and the per-branch test plan.

# PATTERN FILE 1 — where the resolver lives; the dir-or-file .git pattern to mirror (READ-ONLY)
- file: src/tools/git-mcp.ts
  why: validateRepositoryPath (L202-213) uses existsSync(join(repoPath,'.git')) — true for dir AND
        file. Mirror that detection in the new resolver; do NOT modify this function (after chdir
        its default process.cwd() is correct).
  pattern: "existsSync(join(dir, '.git'))  // true for .git dir (clone) AND .git file (worktree/submodule)"
  gotcha: Do NOT add upward traversal here — it belongs in the new repo-root.ts resolver only.

# PATTERN FILE 2 — the file being wired (main())
- file: src/index.ts
  why: main() at L110. Insert INVOCATION_CWD capture at MODULE scope; insert the resolver+chdir call
        after the subcommand early-return (~L119) and before setupGlobalHandlers/configureEnvironment
        (~L125/L128). Import resolveRepositoryRoot.
  pattern: "const parseResult = parseCLIArgs(); if ('subcommand' in parseResult) return 0; const args = parseResult; ..."
  gotcha: --help/--version/usage errors exit INSIDE parseCLIArgs (Commander process.exit) — placing
        the traversal AFTER parseCLIArgs() returns guarantees they never reach it. Confirm this in tests.

# PATTERN FILE 3 — typed-error convention to follow
- file: src/core/session-utils.ts
  why: SessionFileError (L72) — `class XError extends Error { readonly fields; constructor(...){ super(msg); this.name='XError'; ... } }`.
        Mirror exactly for NotARepositoryError (readonly searchedFrom + explicit).
  pattern: "this.name = 'SessionFileError'; readonly path; readonly operation;"
  gotcha: Set this.name in the constructor (required for `error instanceof XError` + clean rendering).

# PATTERN FILE 4 — vi.mock('node:fs') test style to mirror for the unit suite
- file: tests/unit/utils/groundswell-verifier.test.ts
  why: Existing example of mocking node:fs (existsSync/statSync/realpathSync) for path-resolution logic.
        Use the same vi.mock shape for the traversal unit tests (synthesize .git presence per dir).
  pattern: "vi.mock('node:fs', () => ({ existsSync: vi.fn(...), realpathSync: vi.fn(...) }))"
  gotcha: Realpath of the start dir / repoRoot must be mocked too (realpathSync is called on success).

# VERIFIED API SURFACE
- import: { existsSync, realpathSync } from 'node:fs'; { resolve, dirname, join } from 'node:path'.
- main().catch() arms (src/index.ts bottom): AuthPreflightError / HarnessProviderMismatchError / UnsupportedHarnessError → clean; else generic. (S1 does NOT add a NotARepositoryError arm — T2 owns it.)
```

### Current Codebase tree (relevant slice)

```bash
src/utils/repo-root.ts                 # NEW — resolver engine + NotARepositoryError + accessors
src/index.ts                           # EDIT — module-scope INVOCATION_CWD + main() resolver/chdir call
tests/unit/utils/repo-root.test.ts     # NEW — vi.mock-fs traversal + edge-case tests
tests/integration/utils/repo-root.test.ts  # NEW — real-tmpdir .git (dir + file) tests
src/tools/git-mcp.ts                   # READ-ONLY (validateRepositoryPath — mirror pattern, do not modify)
```

### Desired Codebase tree with files to be added/edited

```bash
src/utils/repo-root.ts                      # NEW
src/index.ts                                # MODIFIED (module const + main() insertion + import)
tests/unit/utils/repo-root.test.ts          # NEW
tests/integration/utils/repo-root.test.ts   # NEW
# No other source changes. No docs files (Mode A: JSDoc + inline comment). validateRepositoryPath UNCHANGED.
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — place the resolver+chdir AFTER parseCLIArgs() returns and BEFORE configureEnvironment().
//   --help/--version/usage errors call process.exit() INSIDE parseCLIArgs() (Commander), so they
//   short-circuit before the traversal. NEVER move traversal above parseCLIArgs().

// CRITICAL — capture INVOCATION_CWD at MODULE SCOPE (top of index.ts), not inside main(). Module
//   scope is evaluated at import — strictly before main()'s body — so it's the true invocation cwd
//   before any chdir. (Satisfies both "module-level const" and "before parseCLIArgs".)

// CRITICAL — .git detection must accept BOTH directory (normal clone) AND file (worktree/submodule
//   gitdir: pointer, §9.8.4). existsSync is true for both — use existsSync(join(dir,'.git')), NOT
//   statSync().isDirectory() (which would reject the file form).

// GOTCHA — nearest-ancestor wins: stop at the FIRST ancestor with .git (inner repo inside an outer
//   repo → inner wins). Do NOT keep walking to find a "better" root.

// GOTCHA — filesystem-root detection: dirname(dir) === dir means you've hit '/' (or 'C:\'). Break
//   and throw NotARepositoryError. An infinite loop here is the classic traversal bug.

// GOTCHA — realpathSync is called on the FOUND repoRoot (canonicalize symlinks). Mock it in unit
//   tests (it's a real fs call). For the explicit branch, realpath the resolved explicit path too.

// GOTCHA — do NOT modify validateRepositoryPath (git-mcp.ts:202). After process.chdir(repoRoot) its
//   default process.cwd() is correct. The single-chdir strategy needs ZERO per-site changes.

// GOTCHA — do NOT add a NotARepositoryError arm to main().catch() in S1. The clean-render + exit-code
//   + child-inheritance UX is P1.M1.T2.S1. S1 throws the typed error; the generic catch arm renders it.

// GOTCHA — the explicit branch (opts.explicit) is implemented in S1 for a complete, lint-clean resolver
//   (the contract signature mandates opts?: {explicit?: string}; an unused opts would trip no-unused-vars).
//   S2 wires the --repo-root CLI flag → resolveRepositoryRoot(INVOCATION_CWD, { explicit: args.repoRoot }).

// GOTCHA — vitest.config.ts enforces 100% coverage on src/**/*.ts. Every branch must be hit:
//   found-at-start, walk-then-found, .git-as-dir, .git-as-file, root-reached-throw, explicit-ok,
//   explicit-no-git-throw, getRepoRoot-unset-throw, getInvocationCwd-unset-throw.

// GOTCHA — prettier is ERROR-enforced. Run `npm run fix` before format:check.

// GOTCHA — the module singleton (_repoRoot/_invocationCwd) is process-global; tests must either run
//   resolveRepositoryRoot first or reset the singleton between tests (the accessor-unset branch needs
//   a fresh state). Use a beforeEach that re-mocks fs + resets state (or test in isolation order).
```

---

## Implementation Blueprint

### Data models and structure

```ts
// src/utils/repo-root.ts
export interface ResolveRepoOpts { explicit?: string }

export class NotARepositoryError extends Error {
  readonly searchedFrom: string;
  readonly explicit: boolean;
  constructor(searchedFrom: string, opts?: { explicit?: boolean }) { /* super(remediation); this.name='NotARepositoryError'; ... */ }
}
// Module singleton + accessors (getRepoRoot / getInvocationCwd) + resolveRepositoryRoot.
// No Zod/ORM — pure path-resolution logic over node:fs / node:path.
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE src/utils/repo-root.ts
  - EXPORTS: ResolveRepoOpts (interface), NotARepositoryError (class), resolveRepositoryRoot (fn),
    getRepoRoot (fn), getInvocationCwd (fn).
  - IMPORTS: { existsSync, realpathSync } from 'node:fs'; { resolve, dirname, join } from 'node:path'.
  - ALGORITHM: see research note §4 — traverseUp (default) / resolveExplicit (opts.explicit) /
        realpathSync canonicalize / set singleton / return { repoRoot, invocationCwd }.
  - NotARepositoryError: mirror SessionFileError convention (this.name, readonly fields, remediation msg).
  - getRepoRoot/getInvocationCwd: throw clear Error if singleton unset.
  - JSDoc on resolveRepositoryRoot: dir-or-file detection, nearest-ancestor rule, hard-error contract,
        singleton side effect (Mode A).
  - PLACEMENT: src/utils/repo-root.ts.

Task 2: EDIT src/index.ts — wire bootstrap
  - ADD module-scope `const INVOCATION_CWD = process.cwd();` (top of file, with other top-level consts).
  - ADD import { resolveRepositoryRoot } from './utils/repo-root.js'; (or type-only as needed).
  - IN main(), after the subcommand early-return (~L119) and before setupGlobalHandlers/configureEnvironment
    (~L125/L128), insert the resolveRepositoryRoot(INVOCATION_CWD) + process.chdir(repoRoot) block with
    the §9.8.3/§9.7.9 bootstrap-ordering comment.
  - DO NOT: add a NotARepositoryError catch arm (T2), pass opts.explicit (S2), modify parseCLIArgs,
        or move the call above parseCLIArgs().

Task 3: CREATE tests/unit/utils/repo-root.test.ts — vi.mock('node:fs')
  - MOCK node:fs (existsSync/realpathSync) to synthesize .git presence per dir.
  - CASES: found-at-start; walk-up-then-found; .git-as-dir; .git-as-file; nearest-ancestor-wins (nested);
        root-reached → NotARepositoryError (assert searchedFrom + message); explicit-ok; explicit-no-git
        → NotARepositoryError(explicit:true); realpathSync called on success; getRepoRoot/getInvocationCwd
        throw before resolution + return correct after.
  - RESET the module singleton between tests (re-import or a reset helper) so the accessor-unset branch
        is reachable and tests don't leak state.
  - NAMING: it('finds .git as a directory'), it('finds .git as a file (worktree)'), it('throws at filesystem root'), etc.
  - PLACEMENT: tests/unit/utils/repo-root.test.ts.

Task 4: CREATE tests/integration/utils/repo-root.test.ts — REAL tmpdir
  - Use mkdtempSync + mkdirSync(join(tmp,'.git')) (dir form); separate case writeFileSync(join(tmp,'.git'),…)
        (file form). Build nested tmp/a/b/c; assert resolveRepositoryRoot(tmp/a/b/c).repoRoot === realpathSync(tmp).
  - Assert a NON-repo tmpdir (no .git anywhere up to its root... use a tmpdir whose parents have no .git, or
        mock) → throws. (Real-fs root-reached can be flaky if a parent has .git — prefer the vi.mock unit
        test for the root-reached branch; use integration only for happy-path dir/file detection.)
  - afterEach rmSync(tmp, { recursive, force }).
  - PLACEMENT: tests/integration/utils/repo-root.test.ts.

Task 5: FORMAT + VERIFY
  - RUN: npm run fix → npm run typecheck → npm run lint → npm run format:check.
  - RUN: npx vitest run tests/unit/utils/repo-root.test.ts tests/integration/utils/repo-root.test.ts --coverage.
  - RUN (smoke, from repo root): npx tsx -e "import('./src/utils/repo-root.ts').then(m=>console.log(m.resolveRepositoryRoot(process.cwd())))"
        → prints the hacky-hack repo root.
  - EXPECTED: all clean; repo-root.ts at 100% coverage. If a branch is uncovered, add the matching case.
```

### Implementation Patterns & Key Details

```ts
// PATTERN — the traversal (nearest-ancestor; dir-or-file via existsSync; root detection).
function traverseUp(startDir: string): string {
  let dir = resolve(startDir);                 // absolute
  for (;;) {
    if (existsSync(join(dir, '.git'))) return dir;   // .git dir OR file (§9.8.4); nearest wins (§9.8.2)
    const parent = dirname(dir);
    if (parent === dir) break;                 // filesystem root (dirname('/') === '/')
    dir = parent;
  }
  throw new NotARepositoryError(startDir);     // §9.8.5 hard error
}

// PATTERN — main() insertion (after subcommand return, before configureEnvironment).
//   Module scope (top of index.ts):
const INVOCATION_CWD = process.cwd();
//   Inside main(), after `if ('subcommand' in parseResult) return 0;` and before setupGlobalHandlers:
const { repoRoot } = resolveRepositoryRoot(INVOCATION_CWD);
process.chdir(repoRoot);

// PATTERN — typed error (mirror SessionFileError).
export class NotARepositoryError extends Error {
  readonly searchedFrom: string;
  readonly explicit: boolean;
  constructor(searchedFrom: string, opts?: { explicit?: boolean }) {
    super(opts?.explicit
      ? `--repo-root path "${searchedFrom}" does not contain a .git entry.`
      : `No .git entry found at or above "${searchedFrom}". Run inside a git repository, or pass --repo-root <path>.`);
    this.name = 'NotARepositoryError';
    this.searchedFrom = searchedFrom;
    this.explicit = opts?.explicit ?? false;
  }
}
```

### Integration Points

```yaml
DOWNSTREAM (S1 ENABLES these — separate subtasks, do NOT do them here):
  - P1.M1.T1.S2 (--repo-root flag): declares the Commander --repo-root <path> option, threads
        args.repoRoot into resolveRepositoryRoot(INVOCATION_CWD, { explicit: args.repoRoot }).
        Owns the §9.8.6 CLI-level explicit-vs-default UX.
  - P1.M1.T2.S1 (hard-error UX): adds the dedicated NotARepositoryError arm to main().catch()
        (clean ❌ message + exit 1) + child/agent inheritance semantics (§9.8.7) + acceptance tests.
  - P2.M1.T1.S2 (.hack loader): consumes getRepoRoot() for .hack discovery/layering.

NO PER-SITE CHANGES: after process.chdir(repoRoot), all ~30 process.cwd()/resolve() sites
  (smartCommit L553, task-orchestrator L1087/1242/1323, session-manager defaults, CLI resolve('plan')
  etc.) naturally resolve to repoRoot. validateRepositoryPath (git-mcp.ts:202) is UNCHANGED.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run fix                  # lint:fix + prettier --write (run first)
npm run typecheck            # tsc --noEmit -p tsconfig.build.json — clean
npm run lint                 # eslint . --ext .ts — clean
npm run format:check         # prettier --check — clean
# Expected: all clean. If no-unused-vars flags opts, ensure resolveRepositoryRoot reads opts?.explicit.
```

### Level 2: Unit/Integration Tests (Component Validation)

```bash
npx vitest run tests/unit/utils/repo-root.test.ts tests/integration/utils/repo-root.test.ts --coverage
# Expected: all green; src/utils/repo-root.ts at 100% coverage. If a branch is uncovered (e.g.
# .git-as-file, root-reached, explicit-no-git, accessor-unset), add the matching case.
```

### Level 3: Integration Testing (System Validation)

```bash
# Smoke: the resolver finds this repo from its own root and from a nested subdir.
npx tsx -e "import('./src/utils/repo-root.ts').then(m => { const r = m.resolveRepositoryRoot(process.cwd()); console.log('root:', r.repoRoot); console.log('cwd:', r.invocationCwd); });"
# Expected: root: <hacky-hack repo realpath>; cwd: <process.cwd()>.

# Smoke: from a nested subdir, traversal walks UP to the repo root.
npx tsx -e "import('node:fs').then(async fs => { const t = fs.mkdtempSync('/tmp/repo-'); fs.mkdirSync(t+'/src/a/b/c',{recursive:true}); fs.mkdirSync(t+'/.git'); const m = await import('./src/utils/repo-root.ts'); console.log(m.resolveRepositoryRoot(t+'/src/a/b/c').repoRoot); fs.rmSync(t,{recursive:true,force:true}); });"
# Expected: prints the tmp repo root (traversal found .git several levels up).

# Bootstrap smoke (after `npm run build`): run the CLI from a subdir — it should chdir to repo root.
# (Full end-to-end bootstrap verification is P1.M1.T2.S1's acceptance test; S1's gate is the resolver suites.)
```

### Level 4: Creative & Domain-Specific Validation

```bash
# N/A — pure path resolution + a single chdir, no MCP/DB/HTTP surface. Domain checks (record in commit msg):
#   - .git accepted as dir (clone) AND file (worktree/submodule gitdir: pointer) — §9.8.4.
#   - Nearest-ancestor wins (nested repos) — §9.8.2.
#   - Root-reached → typed NotARepositoryError with --repo-root remediation — §9.8.5.
#   - chdir placed after parseCLIArgs() (so --help/--version short-circuit first) and before configureEnvironment() — §9.8.3/§9.7.9.
#   - No per-site cwd changes needed (single-chdir strategy).
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` clean.
- [ ] `npm run lint` clean.
- [ ] `npm run format:check` clean.
- [ ] `npx vitest run tests/unit/utils/repo-root.test.ts tests/integration/utils/repo-root.test.ts` green.
- [ ] `src/utils/repo-root.ts` at 100% coverage.

### Feature Validation
- [ ] `resolveRepositoryRoot` finds nearest `.git` ancestor; `.git` dir AND file both detected.
- [ ] Root-reached → `NotARepositoryError` (searchedFrom + remediation).
- [ ] Explicit path: `.git` present → returned canonicalized; absent → `NotARepositoryError(explicit:true)`.
- [ ] `realpathSync` canonicalizes the result.
- [ ] `main()` captures `INVOCATION_CWD` at module scope; calls resolver + `process.chdir(repoRoot)` after
      `parseCLIArgs()` and before `configureEnvironment()`.
- [ ] `getRepoRoot()`/`getInvocationCwd()` throw before bootstrap, return correct after.
- [ ] All five symbols exported (`resolveRepositoryRoot`, `NotARepositoryError`, `getRepoRoot`, `getInvocationCwd`, `ResolveRepoOpts`).

### Code Quality Validation
- [ ] `src/utils/repo-root.ts` NEW; `src/index.ts` minimal edit (module const + import + 2-line insertion + comment).
- [ ] `validateRepositoryPath` (git-mcp.ts) UNCHANGED; no per-site cwd changes.
- [ ] `NotARepositoryError` follows the `SessionFileError` typed-error convention.
- [ ] No `NotARepositoryError` catch arm added (T2 owns it); no `opts.explicit` CLI wiring (S2 owns it).
- [ ] `.git` detection via `existsSync` (dir-or-file), not `statSync().isDirectory()`.

### Documentation & Deployment
- [ ] JSDoc on `resolveRepositoryRoot` (dir-or-file detection, nearest-ancestor rule, hard-error contract, singleton side effect).
- [ ] Bootstrap-ordering comment at the `main()` insertion site (§9.8.3 / §9.7.9).
- [ ] Commit message notes: complete resolver engine (default + explicit); --repo-root flag = S2; clean-error arm = T2; single-chdir strategy = zero per-site changes.

---

## Anti-Patterns to Avoid

- ❌ Don't move the resolver/chdir ABOVE `parseCLIArgs()` — `--help`/`--version`/usage errors must short-circuit first (Commander `process.exit` inside parse).
- ❌ Don't use `statSync().isDirectory()` for `.git` detection — it rejects the worktree/submodule `.git` FILE form (§9.8.4). Use `existsSync`.
- ❌ Don't keep walking past the first `.git` — nearest-ancestor wins (§9.8.2).
- ❌ Don't forget the `dirname(dir) === dir` root check — an infinite loop is the classic traversal bug.
- ❌ Don't capture `INVOCATION_CWD` inside `main()` if module scope is safer — capture at module scope (before any chdir, evaluated at import).
- ❌ Don't modify `validateRepositoryPath` or any of the ~30 `process.cwd()` sites — the single `chdir` makes them all correct (§9.8.3).
- ❌ Don't add a `NotARepositoryError` arm to `main().catch()` in S1 — that's P1.M1.T2.S1.
- ❌ Don't wire the `--repo-root` CLI flag or pass `opts.explicit` from `main()` in S1 — that's S2.
- ❌ Don't call `realpathSync` on the start dir mid-walk — only on the FOUND repoRoot (canonicalize once at the end).
- ❌ Don't run the full `npm run test:run` as the S1 gate — focus on the new resolver suites + static gates (the wider suite state is orthogonal to this additive change).

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: The resolver is a self-contained path-resolution function with a precisely specified
algorithm (§9.8.2), a dir-or-file `.git` pattern already proven in the codebase (`validateRepositoryPath`,
file:line cited), a clear typed-error convention to mirror (`SessionFileError`), and a single
well-defined `main()` insertion site (after subcommand return, before `configureEnvironment` — line
numbers verified). The single-`chdir` strategy means zero per-site changes (architecture scout
confirmed all ~30 cwd sites become correct). The test strategy covers every branch (vi.mock fs for
root-reached/explicit/accessor-unset; real tmpdir for dir/file detection). The one scope judgment —
including the `opts.explicit` branch in S1 for a complete, lint-clean resolver (vs. deferring it
wholly to S2) — is documented with rationale so the implementer/orchestrator can adjust. Residual
risks: (a) module-singleton state leakage between unit tests (mitigated by reset/re-import); (b)
realpathSync must be mocked in unit tests (called on success). Both are covered. No external/runtime unknowns.