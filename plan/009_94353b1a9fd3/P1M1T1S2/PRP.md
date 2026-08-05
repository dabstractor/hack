# PRP — P1.M1.T1.S2: `--repo-root <path>` flag + explicit-path vs default-path semantics

> PRD §9.8 (Repository Root Resolution). S1 (LANDED) provides `resolveRepositoryRoot` (+ explicit
> branch), `INVOCATION_CWD`, and the bootstrap `process.chdir(repoRoot)` in `main()` — with an
> annotated **S2 seam** (`// S2 will pass { explicit: args.repoRoot }`). **S2 wires the `--repo-root`
> CLI override and enforces §9.8.3's explicit-vs-default path semantics**, fixing two confirmed
> path-resolution bugs along the way. The no-repository hard-error UX + child-inheritance +
> §9.8.9 acceptance sweep is **P1.M1.T2.S1** (out of scope).

---

## Goal

**Feature Goal**: Add the `--repo-root <path>` CLI flag (PRD §9.8.6) that pins the repository root
and skips the upward `.git` search (erroring if `<path>` lacks `.git`), wiring it to
`resolveRepositoryRoot(INVOCATION_CWD, { explicit: args.repoRoot })`. Enforce PRD §9.8.3's path
semantics: **explicit** `--prd` (and subcommand `--file`/`--session`) resolve against `INVOCATION_CWD`;
**default** paths (`./PRD.md`, `./plan/`) resolve against the new `process.cwd()` (repoRoot). Fix the
two confirmed bugs that break these semantics (explicit-`--prd` mis-resolution + parse-time existence
check). Verify via real-tmpdir integration tests.

**Deliverable**:
1. **`src/cli/index.ts`** — add `repoRoot?: string` to `CLIArgs`; add the `--repo-root <path>` option;
   pre-resolve an EXPLICIT `--prd` against `process.cwd()` (= INVOCATION_CWD at parse time) via
   Commander's `getOptionValueSource`; **move** the `--prd` existence check out of `parseCLIArgs`
   (it runs pre-chdir and breaks the default from a subdir).
2. **`src/index.ts`** — pass `{ explicit: args.repoRoot }` to `resolveRepositoryRoot` at the S1 seam;
   add the deferred `existsSync(args.prd)` check **after** the chdir (handles both explicit-absolute
   and default-relative correctly).
3. **`tests/unit/cli/index.test.ts`** — update the "PRD file not found" test for the moved check.
4. **`tests/integration/cli/repo-root-semantics.test.ts`** (NEW) — real-tmpdir git-repo tests proving
   default-from-subdir, explicit-`--prd`-against-INVOCATION_CWD, and `--repo-root` pin/error.
5. **Docs (Mode A)** — `--repo-root` option description (§9.8.6); `main()` comment noting `--repo-root`
   short-circuits the upward search.

**Success Definition**:
- `--repo-root <path>` (with `.git`) pins the root and skips the search; `--repo-root <path>` (no
  `.git`) throws `NotARepositoryError(explicit:true)` (S1's error; S2 wires the flag).
- An explicit `--prd ./relative/PRD.md` resolves against **INVOCATION_CWD**; an omitted `--prd`
  resolves to `<repoRoot>/PRD.md` (§9.8.9 acceptance).
- `hack` launched from a subdirectory no longer fails the parse-time `existsSync('./PRD.md')` for the
  default (the check is deferred past the chdir).
- `npm run typecheck && npm run lint && npm run format:check` clean; updated + new tests green.

---

## Why

- **Completes the §9.8 UX.** S1 made the resolver + bootstrap chdir work for the DEFAULT case
  (run from anywhere → operate at repo root). S2 adds the explicit override (`--repo-root`) for
  unusual layouts (monorepo subdir, test harnesses, CI) and the escape hatch when the auto-walk
  picks the wrong ancestor (nested repos) — §9.8.6.
- **Fixes two real bugs S1's chdir exposes.** (1) Explicit relative `--prd` resolves against repoRoot
  (post-chdir) instead of INVOCATION_CWD — violating §9.8.3/§9.8.9. (2) The parse-time
  `existsSync(options.prd)` rejects the default `./PRD.md` when run from a subdir (before the chdir) —
  breaking "run from anywhere." Both are required for the §9.8.9 acceptance criteria.
- **Single-chdir strategy holds.** Apart from the two parse/CLI-site fixes, NO per-call-site changes
  are needed at the ~20 downstream `resolve('PRD.md')`/`resolve('plan')` sites (system_context.md §2.2)
  — they naturally resolve to repoRoot after the chdir. S2 verifies this with an integration test.
- **Scope discipline.** S2 = the flag + the two semantic fixes + tests. The `NotARepositoryError`
  clean-render arm in `main().catch()` + child/agent inheritance + the full §9.8.9 acceptance sweep =
  P1.M1.T2.S1. `.hack` loader = P2.

---

## What

### User-visible behavior
`hack --repo-root /path/to/repo` pins the repo root (skipping the upward search) and operates there.
`hack --prd ./my/prd.md` (from a subdir) uses the PRD relative to where the user invoked the command.
`hack` (no flags) from a subdir still finds `<repoRoot>/PRD.md` and operates at the repo root.

### Technical requirements (exact contract)

**File 1 — `src/cli/index.ts`** (4 edits):

(1) **`CLIArgs` interface** (~L94, near `prd`): add
```ts
/**
 * Explicit repository root (PRD §9.8.6). Skips the upward `.git` search; `<path>` is resolved
 * against INVOCATION_CWD and MUST contain a `.git` entry (dir or file), else startup hard-errors.
 * Undefined → automatic upward traversal (§9.8.2).
 */
repoRoot?: string;
```
(ValidatedCLIArgs `extends Omit<CLIArgs, …>`; `repoRoot` is NOT in the Omit list → inherited automatically.)

(2) **Root option chain** (~L312, near `--prd`): add (NO default — undefined when omitted):
```ts
.option('--repo-root <path>', 'Explicit repository root (skips .git search; must contain .git)')
```

(3) **Pre-resolve EXPLICIT `--prd`** in `parseCLIArgs`, immediately AFTER `const options = program.opts<CLIArgs>()` (~L808) and BEFORE the (removed) existence check:
```ts
// PRD §9.8.3: an EXPLICIT --prd resolves against INVOCATION_CWD (where the user typed the command),
// NOT the post-chdir repo root. process.cwd() here === INVOCATION_CWD (S1's chdir runs AFTER
// parseCLIArgs returns), so resolve() now is INVOCATION_CWD-relative. The DEFAULT './PRD.md' is left
// relative → resolved against repoRoot post-chdir. Distinguish via Commander's value source.
if (program.getOptionValueSource('prd') === 'cli') {
  options.prd = resolve(options.prd);
}
```
(Commander v14.0.2 — `getOptionValueSource` returns `'cli'` for explicit, `'default'` for omitted. Add `resolve` to the existing `node:path` import if not already present.)

(4) **REMOVE the existence check** from `parseCLIArgs` (~L810-815):
```ts
// DELETE (moved to main() post-chdir — see P1.M1.T1.S2):
// if (!existsSync(options.prd)) { logger().error(`PRD file not found: ${options.prd}`); … process.exit(1); }
```
(The default `./PRD.md` can't be validated at parse time — repoRoot isn't known until main()'s chdir.
The check moves to main() post-chdir where a single `existsSync(args.prd)` handles both the
explicit-absolute and default-relative cases correctly.)

**File 2 — `src/index.ts`** (2 edits at/around the S1 seam, ~L135):

(1) **Pass `{ explicit }`** at the seam:
```ts
const { repoRoot } = resolveRepositoryRoot(
  INVOCATION_CWD,
  args.repoRoot ? { explicit: args.repoRoot } : undefined
);
process.chdir(repoRoot);
```
(Update the S1 placeholder comment: "`--repo-root` short-circuits the upward search (§9.8.6); the
resolver resolves <path> against INVOCATION_CWD, realpathSyncs, and verifies .git (else
NotARepositoryError).")

(2) **Add the deferred existence check** AFTER `process.chdir(repoRoot)` and BEFORE
`configureEnvironment()`:
```ts
// PRD §9.8.3: validate the PRD exists against the NOW-correct cwd. args.prd is absolute
// (explicit, pre-resolved against INVOCATION_CWD in parseCLIArgs) or relative './PRD.md'
// (default → resolves against repoRoot here). One check covers both semantics.
if (!existsSync(args.prd)) {
  console.error(`PRD file not found: ${args.prd}`);
  console.error('Please provide a valid PRD file path using --prd');
  return 1;
}
```
(Use `console.error` + `return 1` to match main()'s error-return contract — do NOT `process.exit`
inside main(); let the caller render. Mirror the existing main() error-return style. Add
`existsSync` to the `node:fs` import if not already present.)

**File 3 — `tests/unit/cli/index.test.ts`**: update the "PRD file not found" test (~L353) — the check
no longer fires inside `parseCLIArgs`; it now fires in `main()` post-chdir. Rewrite to drive the check
via the main() path (or assert the moved behavior). See Task 4.

**File 4 — `tests/integration/cli/repo-root-semantics.test.ts`** (NEW): real-tmpdir git-repo tests.

### Success Criteria
- [ ] `--repo-root <path>` flag registered; `repoRoot?: string` in CLIArgs; flows through `parseCLIArgs` return.
- [ ] `main()` passes `{ explicit: args.repoRoot }` to `resolveRepositoryRoot`; `--repo-root` with `.git`
      pins the root, without `.git` throws `NotARepositoryError(explicit:true)`.
- [ ] Explicit `--prd ./relative/PRD.md` pre-resolved against INVOCATION_CWD (absolute) in parseCLIArgs.
- [ ] Default `./PRD.md` NOT existence-checked at parse time; checked post-chdir against `<repoRoot>/PRD.md`.
- [ ] `existsSync(args.prd)` in main() post-chdir handles both explicit-absolute + default-relative.
- [ ] Subcommand `--file`/`--session` resolve against INVOCATION_CWD (unchanged — confirmed; no S2 edit).
- [ ] PRPPipeline ctor UNCHANGED (no repoRoot param).
- [ ] `npm run typecheck && npm run lint && npm run format:check` clean; updated + new tests green.

---

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed to implement
this successfully?_ **Yes** — S1's exact landed surface (with line numbers), the two confirmed bugs
(with traces), the precise 4+2 CLI/index edits, the Commander API for explicit-vs-default detection,
the §9.8.3/§9.8.6/§9.8.9 semantics, the test-impact list, and the executable validation commands are
all below.

### Documentation & References

```yaml
# MUST READ — authoritative semantics + acceptance criteria
- docfile: plan/009_94353b1a9fd3/prd_snapshot.md
  section: "§9.8.3 Implementation Strategy & Explicit-Path Semantics" and "§9.8.6 The --repo-root <path> Override" and "§9.8.9 Acceptance Criteria"
  why: §9.8.3 (explicit→INVOCATION_CWD, default→repoRoot), §9.8.6 (--repo-root resolves against
        INVOCATION_CWD + must have .git), §9.8.9 (acceptance: explicit --prd against invocation;
        omitted --prd → <repoRoot>/PRD.md; --repo-root pins/errors).

# MUST READ — S1's landed surface (the contract S2 consumes) + the two confirmed bugs
- docfile: plan/009_94353b1a9fd3/P1M1T1S2/research/repo-root-flag-and-semantics.md
  section: "1. S1's confirmed surface" and "3. CONFIRMED BUG #1" and "4. CONFIRMED BUG #2"
  why: S1's seam (index.ts:135) + repo-root.ts explicit branch + INVOCATION_CWD (index.ts:59); the
        explicit--prd mis-resolution trace (args.prd unresolved → session-manager:284 post-chdir
        resolve); the parse-time existsSync(options.prd) breakage; the getOptionValueSource fix.

# MUST READ — resolve-site inventory + single-chdir strategy
- docfile: plan/009_94353b1a9fd3/architecture/system_context.md
  section: "2.2 process.cwd() / cwd-relative resolve sites"
  why: Confirms the ~20 downstream resolve('PRD.md')/resolve('plan') sites need ZERO changes after
        the chdir (they run post-chdir against repoRoot). S2's existence-check move is the ONLY
        parse-time site that needs fixing.

# PATTERN FILE 1 — the CLI file being edited
- file: src/cli/index.ts
  why: CLIArgs (L94), the --prd option (L312), parseCLIArgs opts<CLIArgs> (L808) + existence check
        (L810-815) + return (L1128). S2 adds the --repo-root option, the repoRoot field, the explicit
        --prd pre-resolution, and removes the existence check.
  pattern: ".option('-p, --prd <path>', '…', './PRD.md')  →  .option('--repo-root <path>', '…')"
  gotcha: getOptionValueSource('prd') must be called on the SAME `program` after program.parse().
        Confirm Commander v14 returns 'cli' for explicit (it does — v7+).

# PATTERN FILE 2 — the main() file being edited (S1 seam confirmed landed)
- file: src/index.ts
  why: INVOCATION_CWD (L59), the S1 seam resolveRepositoryRoot(INVOCATION_CWD) + chdir (L135) with the
        "S2 will pass { explicit: args.repoRoot }" comment. S2 makes the call conditional + adds the
        post-chdir existsSync(args.prd).
  pattern: "const { repoRoot } = resolveRepositoryRoot(INVOCATION_CWD); process.chdir(repoRoot);"
  gotcha: Use console.error + return 1 for the deferred PRD-not-found (main()'s contract), NOT
        process.exit. Add existsSync to node:fs import if absent.

# PATTERN FILE 3 — S1's resolver (READ-ONLY — the explicit branch S2 relies on)
- file: src/utils/repo-root.ts
  why: resolveRepositoryRoot(startDir, { explicit }) — the explicit branch resolves opts.explicit
        against startDir, realpathSyncs, verifies .git (dir-or-file), throws
        NotARepositoryError(explicit:true) if absent. S2 just passes { explicit: args.repoRoot }.
  gotcha: Do NOT modify repo-root.ts (S1 owns it). args.repoRoot is a string-or-undefined; pass
        undefined (not {}) when omitted so S1's default traversal runs.

# TEST FILE — update the existence-check test
- file: tests/unit/cli/index.test.ts
  why: L353 "should display error message when PRD file not found" asserts parseCLIArgs emits the
        error — the check moved to main(); rewrite to drive main()'s post-chdir check.
  gotcha: auth-preflight.test.ts:269 asserts stderr does NOT contain 'PRD file not found' (proves it
        reached preflight). After S2 the check is in main() BEFORE preflight — the assertion's intent
        (reached preflight, not the PRD check) still holds IF the test supplies a valid PRD; review it.

# VERIFIED API SURFACE
- Commander v14.0.2: program.getOptionValueSource(name) → 'default'|'cli'|'env'|… (use to detect explicit --prd).
- node:path resolve(); node:fs existsSync() (add to imports if not present in the edited file).
- resolveRepositoryRoot(INVOCATION_CWD, { explicit }?) — S1; returns { repoRoot, invocationCwd }.
```

### Current Codebase tree (relevant slice)

```bash
src/cli/index.ts                 # EDIT — CLIArgs.repoRoot + --repo-root option + explicit--prd pre-resolve + remove parse-time existence check
src/index.ts                     # EDIT — { explicit } at S1 seam + post-chdir existsSync(args.prd)
tests/unit/cli/index.test.ts     # EDIT — update "PRD file not found" test (check moved to main)
tests/integration/cli/repo-root-semantics.test.ts  # NEW — real-tmpdir semantics tests
src/utils/repo-root.ts           # READ-ONLY (S1 — consumed, not modified)
src/workflows/prp-pipeline.ts    # READ-ONLY (ctor unchanged — args.prd flows through)
```

### Desired Codebase tree with files to be added/edited

```bash
src/cli/index.ts                 # MODIFIED (4 edits)
src/index.ts                     # MODIFIED (2 edits at the S1 seam)
tests/unit/cli/index.test.ts     # MODIFIED (1 test rewrite)
tests/integration/cli/repo-root-semantics.test.ts  # NEW
# No docs files (Mode A: option description + main() comment). No repo-root.ts / prp-pipeline.ts changes.
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — S1's chdir is AFTER parseCLIArgs(). So INSIDE parseCLIArgs, process.cwd() === INVOCATION_CWD.
//   That's WHY pre-resolving explicit --prd in parseCLIArgs (resolve(options.prd)) is INVOCATION_CWD-
//   relative. Do NOT pre-resolve the DEFAULT './PRD.md' — it must stay relative to resolve against
//   repoRoot post-chdir.

// CRITICAL — the parse-time existsSync(options.prd) (cli/index.ts:810) breaks the default from a
//   subdir (checks <INVOCATION_CWD>/PRD.md before the chdir). MOVE it to main() post-chdir. One
//   existsSync(args.prd) there handles both: explicit (now absolute) + default (relative → repoRoot).

// CRITICAL — distinguish explicit-vs-default --prd via program.getOptionValueSource('prd') === 'cli'.
//   Do NOT use `options.prd !== './PRD.md'` (fragile — user could explicitly pass './PRD.md').
//   Commander v14.0.2 supports getOptionValueSource (v7+). Fallback if unsuitable: register --prd with
//   no default + treat undefined as default (but that widens CLIArgs.prd to optional — avoid).

// CRITICAL — main()'s deferred PRD-not-found must use console.error + return 1 (main()'s contract),
//   NOT process.exit (which bypasses main()'s catch/cleanup). Mirror existing main() error-returns.

// GOTCHA — pass `undefined` (not `{}`) to resolveRepositoryRoot when --repo-root is omitted, so S1's
//   DEFAULT upward-traversal branch runs. `{ explicit: args.repoRoot }` only when args.repoRoot is set.

// GOTCHA — do NOT modify repo-root.ts (S1 owns it), prp-pipeline.ts ctor (no repoRoot param needed),
//   or the ~20 downstream resolve() sites (single-chdir makes them correct). The ONLY parse-time site
//   to fix is the cli/index.ts existence check.

// GOTCHA — subcommand --file/--session already resolve against INVOCATION_CWD (subcommand actions run
//   during program.parse, before main()'s chdir). No S2 change for them. (Subcommand DEFAULT paths
//   resolve against INVOCATION_CWD too — that's a S1/T2 bootstrap-placement concern, NOT S2's scope.)

// GOTCHA — the module-scope INVOCATION_CWD (index.ts:59) is captured at IMPORT. Integration tests
//   that need a specific INVOCATION_CWD must control process.cwd() BEFORE importing index.ts, OR test
//   parseCLIArgs's pre-resolution + the resolver's explicit branch in isolation.

// GOTCHA — vitest.config.ts enforces 100% coverage on src/**/*.ts. The new branches (explicit--prd
//   pre-resolution TRUE/FALSE; the conditional { explicit } ternary; the post-chdir existsSync
//   TRUE/FALSE) must each be hit. The integration tests + the updated unit test cover them.

// GOTCHA — prettier is ERROR-enforced. Run `npm run fix` before format:check.

// GOTCHA — do NOT run the full `npm run test:run` as the S2 gate. Focus on: typecheck + lint + format
//   + tests/unit/cli/index.test.ts + the new integration suite + S1's resolver suites (regression).
```

---

## Implementation Blueprint

### Data models and structure
None new — `repoRoot?: string` is a plain optional string on `CLIArgs`. No Zod/ORM. The "structure"
is the explicit-vs-default distinction (via `getOptionValueSource` + `path.isAbsolute` post-resolution).

### Implementation Tasks (ordered by dependencies — implicit TDD: RED first, then GREEN)

```yaml
Task 1: EDIT src/cli/index.ts — add the --repo-root flag + repoRoot field + explicit--prd pre-resolve + remove parse-time existence check
  - CLIArgs (~L94): ADD `repoRoot?: string` with the §9.8.6 JSDoc.
  - Option chain (~L312, near --prd): ADD `.option('--repo-root <path>', 'Explicit repository root (skips .git search; must contain .git)')` (NO default).
  - parseCLIArgs, after `const options = program.opts<CLIArgs>()` (~L808): ADD the explicit--prd
        pre-resolution (`if (program.getOptionValueSource('prd') === 'cli') options.prd = resolve(options.prd);`).
        Add `resolve` to the node:path import if absent.
  - parseCLIArgs (~L810-815): REMOVE the `if (!existsSync(options.prd)) { … process.exit(1); }` block
        (moved to main() post-chdir in Task 2). If existsSync becomes unused in this file, remove the import.
  - DO NOT: add a default to --repo-root, modify subcommand option chains, touch the parseCLIArgs return
        (repoRoot auto-flows via `...options`), or change ValidatedCLIArgs (repoRoot inherited).
  - EXPECTED: typecheck clean (repoRoot is optional; flows through). The removed existence check may
        leave a now-unused existsSync import — remove it if so (no-unused-vars).

Task 2: EDIT src/index.ts — wire { explicit } at the S1 seam + add the post-chdir existence check
  - At the S1 seam (~L135): REPLACE `resolveRepositoryRoot(INVOCATION_CWD)` with the conditional
        `resolveRepositoryRoot(INVOCATION_CWD, args.repoRoot ? { explicit: args.repoRoot } : undefined)`.
        Update the placeholder comment (--repo-root short-circuits the search; resolver verifies .git).
  - AFTER `process.chdir(repoRoot)` and BEFORE `configureEnvironment()`: ADD the deferred
        `if (!existsSync(args.prd)) { console.error(...); console.error(...); return 1; }`. Add
        existsSync to the node:fs import if absent.
  - DO NOT: modify INVOCATION_CWD (L59), the chdir line itself, PRPPipeline construction, or add a
        NotARepositoryError catch arm (T2 owns it).
  - EXPECTED: --repo-root with .git pins; without .git → S1's NotARepositoryError(explicit:true)
        propagates (rendered by the generic catch — T2 adds the dedicated arm). Default --prd
        existence checked against repoRoot post-chdir.

Task 3: CREATE tests/integration/cli/repo-root-semantics.test.ts — REAL tmpdir git repos
  - Use mkdtempSync + mkdirSync(join(tmp,'.git')) (dir form); write PRD.md files as needed. Restore
        process.cwd() in afterEach (the bootstrap chdirs). Build nested tmp/src/a/b.
  - CASES (§9.8.9):
      1. DEFAULT from subdir: tmp/.git + tmp/PRD.md; invoke from tmp/src/a/b (set process.cwd BEFORE
         importing index OR test the resolver+chdir sequence) → after chdir, resolve('PRD.md') === tmp/PRD.md.
      2. EXPLICIT --prd ./PRD.md from subdir: write tmp/src/a/b/PRD.md; explicit --prd resolves
         against INVOCATION_CWD (tmp/src/a/b) → args.prd === absolute tmp/src/a/b/PRD.md (NOT tmp/PRD.md).
      3. --repo-root <tmp> (has .git) → resolveRepositoryRoot(INVOCATION_CWD, {explicit: tmp}).repoRoot
         === realpathSync(tmp); skips search.
      4. --repo-root <tmp-no-git> → throws NotARepositoryError with explicit:true.
  - NOTE: full main() invocation chdirs the real process; prefer testing parseCLIArgs's pre-resolution
        (case 2) + resolveRepositoryRoot's explicit branch (cases 3-4) directly, with ONE end-to-end
        chdir test (case 1) that restores cwd. Keep tests hermetic.
  - NAMING: it('default --prd resolves against repoRoot when invoked from a subdir'), it('explicit
        --prd resolves against INVOCATION_CWD'), it('--repo-root pins the root and skips the search'), etc.
  - PLACEMENT: tests/integration/cli/repo-root-semantics.test.ts.

Task 4: EDIT tests/unit/cli/index.test.ts — update the moved existence-check test
  - The "should display error message when PRD file not found" test (~L353) asserted parseCLIArgs emits
        'PRD file not found'. The check moved to main() post-chdir. Rewrite to drive the check via main()
        (invoke the main() path with a missing PRD; assert the error + return 1), OR if main() is hard
        to invoke in isolation, convert it to an integration assertion in Task 3's suite.
  - REVIEW auth-preflight.test.ts:269 (asserts stderr does NOT contain 'PRD file not found'): confirm
        the test supplies a valid PRD so the moved check (now in main() before preflight) passes and
        the assertion's intent (reached preflight) still holds.
  - DO NOT: weaken the existence-check coverage — the moved check must still be tested.

Task 5: FORMAT + VERIFY
  - RUN: npm run fix → npm run typecheck → npm run lint → npm run format:check.
  - RUN: npx vitest run tests/unit/cli/index.test.ts tests/integration/cli/repo-root-semantics.test.ts.
  - RUN (regression): npx vitest run tests/unit/utils/repo-root.test.ts tests/integration/utils/repo-root.test.ts (S1's suites — stay green).
  - EXPECTED: all clean. If typecheck flags an unused existsSync import in cli/index.ts, remove it. If
        the moved existence check broke other tests, update them (the check is now in main() post-chdir).
```

### Implementation Patterns & Key Details

```ts
// ---- src/cli/index.ts: the explicit--prd pre-resolution (the §9.8.3 semantic fix) ----
const options = program.opts<CLIArgs>();
// PRD §9.8.3: explicit --prd resolves against INVOCATION_CWD (process.cwd() here === INVOCATION_CWD,
// since S1's chdir runs AFTER parseCLIArgs returns). Default './PRD.md' stays relative → repoRoot post-chdir.
if (program.getOptionValueSource('prd') === 'cli') {
  options.prd = resolve(options.prd);   // absolute → survives the chdir; later resolve() is idempotent
}
// (the old `if (!existsSync(options.prd)) …` block is DELETED here — moved to main() post-chdir)

// ---- src/index.ts: the S1 seam (conditional explicit) + deferred existence check ----
const { repoRoot } = resolveRepositoryRoot(
  INVOCATION_CWD,
  args.repoRoot ? { explicit: args.repoRoot } : undefined   // §9.8.6: --repo-root short-circuits the search
);
process.chdir(repoRoot);
// PRD §9.8.3: validate the PRD against the NOW-correct cwd. args.prd is absolute (explicit,
// pre-resolved against INVOCATION_CWD) or relative './PRD.md' (default → repoRoot here). One check covers both.
if (!existsSync(args.prd)) {
  console.error(`PRD file not found: ${args.prd}`);
  console.error('Please provide a valid PRD file path using --prd');
  return 1;
}

// ---- tests/integration/cli/repo-root-semantics.test.ts: the explicit-vs-default proof (case 2) ----
it('explicit --prd resolves against INVOCATION_CWD, not the repo root', () => {
  // tmp/.git (repo root = tmp); user invokes from tmp/src/a/b; explicit --prd ./PRD.md points at the
  // subdir PRD. parseCLIArgs (cwd=INVOCATION_CWD=tmp/src/a/b) pre-resolves --prd against INVOCATION_CWD.
  const tmp = mkdtempSync(join(tmpdir(), 'repo-'));
  mkdirSync(join(tmp, '.git'));
  mkdirSync(join(tmp, 'src', 'a', 'b'), { recursive: true });
  writeFileSync(join(tmp, 'src', 'a', 'b', 'PRD.md'), '# subdir PRD');
  const invocationCwd = join(tmp, 'src', 'a', 'b');
  // Drive parseCLIArgs with cwd=invocationCwd + --prd ./PRD.md; assert options.prd === <invocationCwd>/PRD.md.
  // (Exact harness depends on how parseCLIArgs is testable in isolation; the assertion is the contract.)
  // … assert resolve(invocationCwd, 'PRD.md') is what options.prd becomes …
});
```

### Integration Points

```yaml
DOWNSTREAM (S2 ENABLES these — separate subtasks, do NOT do them here):
  - P1.M1.T2.S1 (hard-error UX + acceptance): adds the dedicated NotARepositoryError arm to main().catch()
        (clean ❌ message + exit 1) + child/agent inheritance (§9.8.7) + the FULL §9.8.9 acceptance sweep
        (worktree/submodule detection, --help from non-repo, smart-commit from subdir, etc.). S2's flag +
        semantic fixes are prerequisites for several of those acceptance criteria.
  - P2.M1.T1.S2 (.hack loader): consumes getRepoRoot() for .hack discovery (independent of S2's flag).

NO PER-SITE CHANGES: after S1's chdir (+ S2's two parse/CLI fixes), all ~20 downstream resolve()/
  process.cwd() sites (system_context.md §2.2) resolve to repoRoot. PRPPipeline ctor, session-manager,
  smartCommit, task-orchestrator, etc. are UNCHANGED. S2's integration test verifies resolve('PRD.md')
  from a subdir yields <repoRoot>/PRD.md.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run fix                  # lint:fix + prettier --write (run first)
npm run typecheck            # tsc --noEmit -p tsconfig.build.json — clean
npm run lint                 # eslint . --ext .ts — clean (watch unused existsSync import in cli/index.ts)
npm run format:check         # prettier --check — clean
# Expected: all clean. If lint flags an unused existsSync/resolve import, the move/add left it orphaned — clean it up.
```

### Level 2: Unit/Integration Tests (Component Validation)

```bash
# S2's gate — the updated CLI test + the new integration suite:
npx vitest run tests/unit/cli/index.test.ts tests/integration/cli/repo-root-semantics.test.ts
# S1 regression — the resolver suites must stay green (S2 doesn't touch repo-root.ts):
npx vitest run tests/unit/utils/repo-root.test.ts tests/integration/utils/repo-root.test.ts
# Expected: all green. If the moved existence check broke index.test.ts, rewrite the test per Task 4.
# Do NOT run the full `npm run test:run` as the gate — orthogonal suite state.
```

### Level 3: Integration Testing (System Validation)

```bash
# Smoke: --repo-root pins the root (real tmp git repo).
npx tsx -e "
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';
import { resolveRepositoryRoot } from './src/utils/repo-root.ts';
const t = mkdtempSync(join(tmpdir(),'rr-')); mkdirSync(join(t,'.git'));
const r = resolveRepositoryRoot(process.cwd(), { explicit: t });
console.log('pinned root:', r.repoRoot); rmSync(t,{recursive:true,force:true});
"
# Expected: pinned root: <tmp realpath>  (the explicit branch skipped the upward search).

# Smoke: explicit --prd ./relative pre-resolves against INVOCATION_CWD (parseCLIArgs, cwd=INVOCATION_CWD).
# (Drive parseCLIArgs with mocked argv + cwd; assert options.prd is absolute INVOCATION_CWD-relative.)
```

### Level 4: Creative & Domain-Specific Validation

```bash
# No MCP/DB/HTTP surface. Domain checks (record in commit message):
#   - --repo-root <path> with .git → pins root (skips search); without .git → NotARepositoryError(explicit:true).
#   - Explicit --prd ./relative → absolute INVOCATION_CWD-relative (survives chdir); default ./PRD.md → repoRoot.
#   - Parse-time existence check removed; post-chdir check handles both semantics.
#   - Subcommand --file/--session resolve against INVOCATION_CWD (unchanged — confirmed).
#   - PRPPipeline ctor + ~20 downstream resolve() sites UNCHANGED (single-chdir strategy).
#   - §9.8.9 acceptance (explicit-vs-default, --repo-root pin/error) verified by the integration suite.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` clean.
- [ ] `npm run lint` clean (no unused imports after the existence-check move).
- [ ] `npm run format:check` clean.
- [ ] `npx vitest run tests/unit/cli/index.test.ts tests/integration/cli/repo-root-semantics.test.ts` green.
- [ ] S1's resolver suites stay green (regression).

### Feature Validation
- [ ] `--repo-root <path>` flag registered; `repoRoot?: string` in CLIArgs; flows through parseCLIArgs.
- [ ] `main()` passes `{ explicit: args.repoRoot }` (conditional); `--repo-root` w/ .git pins, w/o .git errors.
- [ ] Explicit `--prd ./relative` pre-resolved against INVOCATION_CWD (absolute); default stays relative.
- [ ] Parse-time existence check REMOVED; post-chdir `existsSync(args.prd)` handles both semantics.
- [ ] Default `./PRD.md` from a subdir resolves to `<repoRoot>/PRD.md` (integration test).

### Code Quality Validation
- [ ] Only `src/cli/index.ts` (4 edits) + `src/index.ts` (2 edits) + 2 test files touched.
- [ ] `repo-root.ts` (S1), `prp-pipeline.ts` ctor, and the ~20 downstream resolve() sites UNCHANGED.
- [ ] Explicit-vs-default detected via `getOptionValueSource` (not fragile string comparison).
- [ ] Deferred PRD-not-found uses `console.error` + `return 1` (main()'s contract), not `process.exit`.
- [ ] No `NotARepositoryError` catch arm added (T2 owns it).

### Documentation & Deployment
- [ ] `--repo-root` option description (§9.8.6) + `repoRoot` JSDoc on CLIArgs.
- [ ] `main()` comment: `--repo-root` short-circuits the upward search; explicit-vs-default semantics.
- [ ] Commit message notes: flag wired; two semantic bugs fixed (explicit--prd + parse-time existence);
      acceptance sweep = T2; single-chdir strategy = zero per-site changes.

---

## Anti-Patterns to Avoid

- ❌ Don't pre-resolve the DEFAULT `./PRD.md` in parseCLIArgs — it must stay relative to resolve against
      repoRoot post-chdir. Only EXPLICIT (`getOptionValueSource === 'cli'`) --prd is pre-resolved.
- ❌ Don't leave the `existsSync(options.prd)` check in parseCLIArgs — it runs pre-chdir and rejects the
      default from a subdir. Move it to main() post-chdir.
- ❌ Don't detect explicit-vs-default via `options.prd !== './PRD.md'` — fragile (user can pass the
      default explicitly). Use `getOptionValueSource('prd') === 'cli'`.
- ❌ Don't pass `{ explicit: undefined }` (truthy object) to resolveRepositoryRoot when --repo-root is
      omitted — pass `undefined` so S1's default traversal runs. Use the ternary.
- ❌ Don't modify `repo-root.ts` (S1), the `PRPPipeline` ctor, or downstream resolve() sites — the
      single-chdir strategy needs zero per-site changes (except the one parse-time existence check).
- ❌ Don't add a `NotARepositoryError` catch arm to `main().catch()` — that's P1.M1.T2.S1.
- ❌ Don't use `process.exit` for the deferred PRD-not-found in main() — use `console.error` + `return 1`.
- ❌ Don't forget to update `tests/unit/cli/index.test.ts:353` (the moved existence check) — a red test
      there fails the gate.
- ❌ Don't add a default to `--repo-root` — it must be undefined when omitted (so the conditional works).
- ❌ Don't run the full `npm run test:run` as the gate — focus on the CLI test + the new integration
      suite + S1's resolver regression.

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: S1's surface is LANDED and verified (the seam comment literally names S2; `repo-root.ts`'s
explicit branch + `INVOCATION_CWD` + the chdir are all present with line numbers). The two confirmed
bugs are traced to exact lines with clear fixes (getOptionValueSource pre-resolution + existence-check
move). The §9.8.3/§9.8.6/§9.8.9 semantics are quoted authoritatively. Commander v14's
getOptionValueSource is confirmed available. The PRPPipeline ctor + downstream resolve() sites are
confirmed unchanged (single-chdir strategy). The test impact is identified (index.test.ts:353 +
auth-preflight review). Residual risks: (a) the exact harness for driving parseCLIArgs/main() in the
integration test depends on how INVOCATION_CWD capture + chdir interact with test isolation (mitigated
by testing the resolver + pre-resolution in isolation + one cwd-restoring end-to-end test); (b)
getOptionValueSource behavior in Commander v14 (well-supported, fallback documented); (c) other tests
that relied on the parse-time existence check (the impact list is given; the implementer runs the CLI
test to catch any stragglers). No external/runtime unknowns.