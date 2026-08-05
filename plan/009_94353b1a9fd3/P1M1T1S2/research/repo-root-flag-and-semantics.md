# Research — P1.M1.T1.S2 (`--repo-root` flag + explicit-path vs default-path semantics)

S2 wires the `--repo-root <path>` CLI override and enforces PRD §9.8.3's explicit-vs-default path
semantics. S1 (landed) provides `resolveRepositoryRoot` (+ explicit branch), `INVOCATION_CWD`, and
the bootstrap chdir. S2 consumes those + adds the flag + fixes two confirmed path-resolution bugs.

## 1. S1's confirmed surface (verified in-repo — `src/utils/repo-root.ts` + `src/index.ts`)

- `INVOCATION_CWD = process.cwd()` at **module scope** (`src/index.ts:59`) — evaluated at import,
  strictly before `main()`. S2 reads this (it's module-local to index.ts; S2's main() edits are in
  the SAME file, so it's in scope).
- `resolveRepositoryRoot(startDir, opts?: { explicit?: string })` — S1 LANDED the explicit branch
  (`ResolveRepoOpts { explicit?: string }`, `NotARepositoryError.explicit`). The explicit branch
  resolves `opts.explicit` against `startDir`, `realpathSync`s, verifies `.git` (dir-or-file), and
  throws `NotARepositoryError(explicit:true)` if absent.
- **S1's main() seam** (`src/index.ts:135`, CONFIRMED):
  ```ts
  const args: ValidatedCLIArgs = parseResult;
  // ... S2 will pass { explicit: args.repoRoot } once the --repo-root CLI flag lands.
  const { repoRoot } = resolveRepositoryRoot(INVOCATION_CWD);   // ← S2 makes this conditional
  process.chdir(repoRoot);
  ```
  S2 changes this to `resolveRepositoryRoot(INVOCATION_CWD, args.repoRoot ? { explicit: args.repoRoot } : undefined)`.

## 2. The §9.8.3 semantics (authoritative — confirmed from prd_snapshot.md §9.8.3 / §9.8.9)

- **Explicit `--prd`/`--file`/`--session`/`--repo-root`** → resolve against **INVOCATION_CWD**.
- **Default** (`./PRD.md`, `./plan/`) → resolve against the **new process.cwd() (repoRoot)**.
- §9.8.9 acceptance: "An explicit `--prd ./relative/PRD.md` is resolved against the **invocation**
  directory, while an omitted `--prd` resolves to `<repoRoot>/PRD.md`."

## 3. CONFIRMED BUG #1 — explicit `--prd <relative>` resolves against the WRONG dir today

Trace (verified): Commander returns `options.prd` as an UNRESOLVED string (`./PRD.md` default, or
the user's explicit string). `parseCLIArgs` returns it verbatim (`return { ...options, ... }`,
`src/cli/index.ts:1128`). `main()` passes `args.prd` to `new PRPPipeline(args.prd, …)` (ctor stores
it; `src/workflows/prp-pipeline.ts:398` first param). The FIRST absolute resolution is
`session-manager.ts:284` `const absPath = resolve(prdPath)` — which runs **POST-chdir**, so
`process.cwd() === repoRoot`. Therefore `--prd ./relative/PRD.md` (explicit, from a subdir) →
`<repoRoot>/relative/PRD.md` ✗ (should be `<INVOCATION_CWD>/relative/PRD.md`). The contract's
hypothesis ("Commander resolves at parse time, so explicit resolves against INVOCATION_CWD") is
**FALSE** — Commander does not resolve paths. **S2 must pre-resolve explicit --prd against
INVOCATION_CWD.**

The fix site: `parseCLIArgs`, immediately after `const options = program.opts<CLIArgs>()`
(`src/cli/index.ts:808`). At that point `process.cwd() === INVOCATION_CWD` (S1's chdir is AFTER
parseCLIArgs returns). So `resolve(options.prd)` inside parseCLIArgs === INVOCATION_CWD-relative.
Distinguish explicit-vs-default via Commander's `program.getOptionValueSource('prd')` (Commander
v14.0.2 — confirmed; returns `'cli'` for explicit, `'default'` for omitted). Pre-resolve ONLY when
source === `'cli'`:
```ts
if (program.getOptionValueSource('prd') === 'cli') {
  options.prd = resolve(options.prd);   // absolute, INVOCATION_CWD-relative → survives the chdir
}
```
The default `'./PRD.md'` stays relative → resolved later against repoRoot. (Fallback if
getOptionValueSource is unsuitable: register `--prd` with NO default and treat `undefined` as
"default" — but that widens `CLIArgs.prd` to optional. Prefer getOptionValueSource.)

## 4. CONFIRMED BUG #2 — the parse-time `existsSync(options.prd)` breaks the default from a subdir

`parseCLIArgs` (`src/cli/index.ts:810`):
```ts
const options = program.opts<CLIArgs>();
if (!existsSync(options.prd)) {            // ← PARSE TIME: process.cwd() === INVOCATION_CWD
  logger().error(`PRD file not found: ${options.prd}`); process.exit(1);
}
```
This runs BEFORE S1's chdir. For the DEFAULT `./PRD.md` invoked from a subdir, `existsSync('./PRD.md')`
checks `<INVOCATION_CWD>/PRD.md` → FAILS (PRD.md lives at `<repoRoot>/PRD.md`) → exits before the
chdir. This **defeats "run from anywhere"** (§9.8.9: "hack launched from src/, docs/ resolves PRD.md
at the repo root"). S1's PRP did not move this check, so S2 owns it.

The fix: **defer the --prd existence check to `main()` POST-chdir.** After S2's #3 pre-resolution:
- explicit --prd → absolute (INVOCATION_CWD-relative) → `existsSync(absolute)` post-chdir is correct.
- default --prd → `'./PRD.md'` relative → `existsSync('./PRD.md')` post-chdir checks `<repoRoot>/PRD.md`. ✓

So: REMOVE the existence check from parseCLIArgs (lines 810-815); ADD one `existsSync(args.prd)`
check in `main()` AFTER `process.chdir(repoRoot)` and BEFORE `configureEnvironment()`. A single
post-chdir check handles both semantics correctly (absolute vs relative). `path.isAbsolute(args.prd)`
naturally distinguishes the two (no extra flag needed).

**Test impact (CONFIRMED):** `tests/unit/cli/index.test.ts:353` ("should display error message when
PRD file not found") asserts parseCLIArgs emits 'PRD file not found' → MUST be updated to drive the
check via main() (or assert against the new check site). `tests/unit/config/auth-preflight.test.ts:269`
asserts stderr does NOT contain 'PRD file not found' (proving it reached preflight, not parseCLIArgs)
→ review; if the check moved to main() before preflight, the assertion's intent still holds but the
reasoning comment may need a refresh. Other "PRD file not found" matches (session-utils/prd-validator/
prd-validation-executor) are DIFFERENT existence checks (SessionFileError / validator), not parseCLIArgs.

## 5. The `--repo-root` flag wiring (the primary deliverable)

- **CLIArgs** (`src/cli/index.ts:94` area): add `/** Explicit repository root (PRD §9.8.6). Skips the
  upward .git search; <path> MUST contain .git. */ repoRoot?: string;`. ValidatedCLIArgs inherits it
  (it's `extends Omit<CLIArgs, …>` and `repoRoot` is NOT in the Omit list — confirmed).
- **Option chain** (`src/cli/index.ts:312` area, near `--prd`): add
  `.option('--repo-root <path>', 'Explicit repository root (skips .git search; must contain .git)')`
  — NO default (undefined when omitted).
- **parseCLIArgs return** (`:1128` `return { ...options, … }`): `repoRoot` auto-flows (it's in
  `options` via spread). No explicit handling needed (string-or-undefined passthrough).
- **main() seam** (`:135`): `resolveRepositoryRoot(INVOCATION_CWD, args.repoRoot ? { explicit: args.repoRoot } : undefined)`.
  The resolver resolves `<path>` against INVOCATION_CWD, realpathSyncs, verifies `.git`, else throws
  `NotARepositoryError(explicit:true)` (S1's behavior — S2 just passes it through).

## 6. Subcommand `--file`/`--session` already resolve against INVOCATION_CWD (CONFIRMED — no S2 change)

`--file`/`--session` are SUBCOMMAND options (`inspect` :449-450, `validate-state` :508, `task` :537).
Subcommand action handlers run DURING `program.parse()` (inside parseCLIArgs), and the subcommand
branches `return { subcommand: … }` (e.g. :793) BEFORE main()'s chdir. So subcommand `resolve()`/
`process.cwd()` see `INVOCATION_CWD` (no chdir has occurred) → explicit `--file`/`--session` already
resolve against INVOCATION_CWD. **No S2 change needed** for subcommand explicit paths. (Caveat: this
also means subcommand DEFAULT paths like `resolve('PRD.md')` resolve against INVOCATION_CWD, not
repoRoot — but that's the subcommand-chdir interaction, owned by S1/T2's bootstrap placement, NOT
S2's explicit-path scope. S2 notes it; does not fix it.)

## 7. PRPPipeline constructor does NOT need repoRoot (CONFIRMED)

`new PRPPipeline(args.prd, …)` (`src/index.ts:248`) passes `args.prd` (now correctly absolute for
explicit, relative for default). The ctor stores prdPath; session-manager resolves it post-chdir.
The ctor does NOT take repoRoot — and doesn't need to (the single chdir makes downstream
`resolve()`/`process.cwd()` correct). **No ctor change.** (Contract: "if it does not pass repoRoot
explicitly … no change needed" — confirmed.)

## 8. Integration tests (real tmp git repos — no mocks)

- **Default from subdir**: tmp git repo `<tmp>/.git`; write `<tmp>/PRD.md`; `process.chdir(<tmp>/src/a/b)`
  (or set INVOCATION_CWD via a helper); run the CLI/bootstrap; assert `resolve('PRD.md')` after chdir
  === `<tmp>/PRD.md` (repoRoot-relative). (§9.8.9: "hack launched from src/ resolves PRD.md at repo root".)
- **Explicit --prd ./relative**: from `<tmp>/src/a/b`, `--prd ./PRD.md` → resolves against
  `<INVOCATION_CWD>` = `<tmp>/src/a/b/PRD.md` (write a PRD there) — NOT `<tmp>/PRD.md`. (§9.8.9
  explicit-invocation test.)
- **--repo-root pins + errors**: `--repo-root <tmp>` (has .git) → chdir to <tmp>, skips search.
  `--repo-root <tmp-no-git>` (no .git) → `NotARepositoryError(explicit:true)` (S1 throws; S2 verifies
  the flag wires it). (§9.8.6 / §9.8.9.)
- Note: these test the BOOTSTRAP path (main's chdir + the flag). They must invoke the real
  parseCLIArgs+main chdir sequence (or a thin extract), not a fully-mocked parse. Use `process.chdir`
  carefully + restore in afterEach (the module-scope INVOCATION_CWD is captured at import — tests
  that need a specific INVOCATION_CWD must control process.cwd BEFORE importing index.ts, OR test the
  resolver+semantics in isolation). The cleanest unit test targets parseCLIArgs's pre-resolution +
  the resolver's explicit branch directly; the integration test drives the full main() chdir.

## 9. Validation (verified executable)

- `npm run typecheck` / `npm run lint` / `npm run format:check` (prettier ERROR-enforced; `npm run fix`).
- `npx vitest run tests/unit/cli/index.test.ts` (updated existence-check test).
- New: `tests/integration/cli/repo-root-semantics.test.ts` (real tmp git repos).
- S1's resolver suites stay green. Do NOT run full `npm run test:run` as the gate (orthogonal suite state).