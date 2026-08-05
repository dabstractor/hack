# Research — P1.M1.T2.S1: No-repository hard error + child/agent inheritance + acceptance tests

## 1. Current state (verified line numbers, post-S1-landed)

```
src/utils/repo-root.ts  (S1 LANDED)
  NotARepositoryError (class) — readonly searchedFrom, readonly explicit; message already actionable:
      default : `No .git entry found at or above "${searchedFrom}". Run inside a git repository, or pass --repo-root <path>.`
      explicit: `--repo-root path "${searchedFrom}" does not contain a .git entry.`
  resolveRepositoryRoot(startDir, opts?) → { repoRoot, invocationCwd }  (default traverseUp / explicit resolveExplicit)
  getRepoRoot(), getInvocationCwd()  (module singleton; throw before bootstrap)

src/index.ts  (S1 LANDED the seam)
  L59   const INVOCATION_CWD = process.cwd();           // module scope (before main())
  L116  async function main()
  L117  const parseResult = parseCLIArgs();              // --help/--version/usage exit HERE (Commander)
  L120  if ('subcommand' in parseResult) return 0;       // subcommand early-return
  L~133 const { repoRoot } = resolveRepositoryRoot(INVOCATION_CWD);   // ← THROWS NotARepositoryError (no repo)
  L~134 process.chdir(repoRoot);                         // single bootstrap chdir
  L~138 setupGlobalHandlers(args.verbose);
  L~140 configureEnvironment();                          // AFTER chdir (so .env read from repoRoot)
  ...    (logger, dry-run/validate-prd early returns, configureHarness, preflight, pipeline.run)
  L354  void main().then(code => {...}).catch((error) => { ... process.exit(1); })

main().catch() handler (L363–378) — THREE typed arms + generic:
  AuthPreflightError        → console.error(`\n❌ ${error.message}`); process.exit(1);
  HarnessProviderMismatchError → same
  UnsupportedHarnessError   → same
  (generic)                 → console.error('\n❌ Fatal error in main():', error); process.exit(1);
  *** NotARepositoryError has NO dedicated arm yet — it falls through to the GENERIC arm,
      which prepends "Fatal error in main():" (ugly, not the §9.8.5 clean actionable message). ***
```

## 2. The change (T2.S1) — small + surgical

### 2a. Add the NotARepositoryError arm to main().catch() (src/index.ts)
```ts
import { ..., NotARepositoryError } from './utils/repo-root.js';   // add to the existing resolveRepositoryRoot import
...
.catch((error: unknown) => {
  if (error instanceof AuthPreflightError) { ... }
  if (error instanceof HarnessProviderMismatchError) { ... }
  if (error instanceof UnsupportedHarnessError) { ... }
  if (error instanceof NotARepositoryError) {                                   // ← NEW arm
    console.error(`\n❌ ${error.message}`); // §9.8.5: searchedFrom + no-.git-ancestor + --repo-root remediation
    process.exit(1);
  }
  console.error('\n❌ Fatal error in main():', error);
  process.exit(1);
});
```
Matches the existing arms EXACTLY (❌ + message + exit 1). S1's message is ALREADY actionable (names
searchedFrom + --repo-root) — so the arm just renders `error.message`. No message rewrite needed.

### 2b. Ordering proof (§9.8.5: before any session/.env/agent)
The throw site is `resolveRepositoryRoot(INVOCATION_CWD)` at L~133 — which is BEFORE `configureEnvironment()`
(L~140, reads .env), before `configureHarness()` (L208), before `runAuthPreflight()` (L213), before
`new PRPPipeline()` (L245), and before `pipeline.run()` (L258, creates sessions). So the hard error fires
BEFORE any of those. Acceptance (d) "no session created" holds by construction.

### 2c. --help/--version/invalid-flag proof (§9.8.5 exemption)
Commander calls `process.exit()` INSIDE `parseCLIArgs()` (L117) for --help/--version/usage errors.
Since the resolver runs AFTER parseCLIArgs() returns (L133), those never reach the traversal. Acceptance
(e): `hack --help` from a non-repo exits 0 — holds by construction (test via subprocess).

## 3. Child/agent inheritance (§9.8.7) — STRUCTURAL, no code change

There are **NO `child_process.spawn`/`execa`/`fork` calls anywhere in src/** (verified by grep). The
"child processes" and "agent subprocesses" in §9.8.7 are TOOL EXECUTIONS + bash/file ops that read
`process.cwd()`. Because the single bootstrap `process.chdir(repoRoot)` (L~134) sets process.cwd() =
repoRoot for the ENTIRE process, every such site inherits repoRoot automatically:

| site | code | post-chdir |
|---|---|---|
| src/agents/prp-executor.ts:550 | `cwd: process.cwd()` (BashMCP gate exec) | repoRoot |
| src/tools/git-mcp.ts:203 | `resolve(path ?? process.cwd())` (validateRepositoryPath) | repoRoot |
| src/core/task-orchestrator.ts:1087/1242/1323 | `process.cwd()` (cleanup/recovery/checkHead) | repoRoot |
| src/utils/git-commit.ts:553 | `const repoRoot = process.cwd()` (smartCommit) | repoRoot |
| src/workflows/prp-pipeline.ts:1844 | `new ValidationWorkflow(..., process.cwd())` | repoRoot |

The "bugfix child process spawned from plan/…/bugfix/… resolves the same repo root" criterion (§9.8.9)
is verified at the RESOLVER level: `resolveRepositoryRoot(<repoRoot>/plan/.../bugfix/...).repoRoot ===
repoRoot` — the bugfix dir is UNDER repoRoot, so the upward walk finds the same `.git`. (Bugfix "children"
are in-process session dirs under `plan/{seq}/bugfix/{seq}/`, NOT separate OS processes — verified:
`spawnDeltaSession`/`createBugfixChild` in session-utils operate on dirs, no spawn.)

→ **T2.S1 makes NO per-site cwd changes** (the single-chdir strategy covers them all). Inheritance is
verified by (1) code inspection (above) + (2) resolver-level acceptance tests.

## 4. Acceptance-test design (§9.8.9 a–i) — real tmpdir + subprocess

Two layers, all hermetic:

### Layer A — resolver-level (direct `resolveRepositoryRoot` calls in real tmpdirs)
- **(a) launched-from-subdir resolves repo root:** `git init tmp`; `resolveRepositoryRoot(tmp/src/a/b).repoRoot === realpathSync(tmp)`.
  process.cwd()===repoRoot equivalence: spawn an inline `tsx -e` that runs the EXACT bootstrap sequence
  (resolveRepositoryRoot + chdir + print process.cwd()) from the subdir → assert === realpathSync(tmp).
- **(b) worktree .git FILE detected:** `git init tmp && (cd tmp && git commit --allow-empty -m x) &&
  git worktree add tmp-wt`; `resolveRepositoryRoot(tmp-wt).repoRoot === realpathSync(tmp-wt)` (the .git
  FILE at the worktree root is detected — §9.8.4). (S1's integration test does this synthetically via
  writeFileSync; T2.S1 uses a REAL `git worktree add` for definitive acceptance.)
- **(c) submodule resolves to submodule root:** a submodule is a nested repo with its own `.git`. Create
  `git init tmp && git init tmp/vendor/sub` → `resolveRepositoryRoot(tmp/vendor/sub).repoRoot ===
  realpathSync(tmp/vendor/sub)` (nearest-ancestor wins — §9.8.4; submodule root, not superproject).
- **child-inheritance:** `resolveRepositoryRoot(tmp/plan/001_abc/bugfix/002_def).repoRoot === realpathSync(tmp)`
  (a bugfix dir under the session resolves the SAME repo root as the parent — §9.8.9 / §9.8.7).

### Layer B — CLI subprocess (spawnSync the real `tsx src/index.ts` with controlled cwd)
- **(d) no-repo → exit 1 + actionable message + NO session:** spawnSync(tsx, [absSrcIndex, '--prd',
  './PRD.md'], { cwd: nonRepoTmp }); assert `status === 1`, stderr matches
  /No \.git entry found.*<nonRepoTmp>|--repo-root/ , and `nonRepoTmp/plan/` does NOT exist (no session).
  (nonRepoTmp = mkdtempSync under tmpdir() — no .git ancestor.)
- **(e) --help outside repo → exit 0:** spawnSync(tsx, [absSrcIndex, '--help'], { cwd: nonRepoTmp });
  assert `status === 0` (Commander short-circuits in parseCLIArgs, before the traversal).

### Criteria (f)–(i) — covered by S2's `tests/integration/cli/repo-root-semantics.test.ts`
S2 (lands before T2.S1 begins) owns: (f) --repo-root pins/skips search, (g) --repo-root non-.git
errors, (h) explicit --prd against invocation dir, (i) default PRD.md → <repoRoot>/PRD.md. T2.S1
REFERENCES S2's file for these (consume, don't duplicate) to keep the two files merge-safe. T2.S1 may
add a light smoke for (f)/(g) at the resolver level (resolveRepositoryRoot explicit branch) since S1's
unit suite already covers it — but the DEFINITIVE acceptance for (f)–(i) is S2's CLI-level file.

### Subprocess mechanics (hermetic)
- tsx binary: resolve from `node_modules/.bin/tsx` (NOT global `npx tsx` — flaky/online). Absolute path.
- script path: ABSOLUTE `resolve(process.cwd(), 'src/index.ts')` (test runs at repo root → absolute;
  survives the spawned process's cwd = nonRepoTmp).
- restore the test process's own cwd in afterEach (the resolver calls do NOT chdir the test process;
  only the SUBPROCESS chdirs itself — so the test process cwd is untouched; still belt-and-suspenders).
- nonRepoTmp parents (OS tmpdir) have no .git ancestor in practice — safe.

## 5. Parallel-execution / file-disjoint check

- **vs S2 (in-flight, lands FIRST):** S2 edits `src/cli/index.ts` (--repo-root flag + semantic fixes) +
  `src/index.ts` (the `{ explicit }` ternary + post-chdir existsSync) + creates
  `tests/integration/cli/repo-root-semantics.test.ts`. T2.S1 edits `src/index.ts` ONLY at the
  `.catch()` handler (DISJOINT from S2's seam edits at L~133 + post-chdir L~140) + creates a DIFFERENTLY-
  NAMED file (`tests/integration/repo-root-acceptance.test.ts`). No overlap. T2.S1 imports
  `NotARepositoryError` (S1) + relies on `--repo-root` (S2) being present for criteria (f)/(g).
- **vs S1 (LANDED):** T2.S1 does NOT modify `repo-root.ts` (except the NotARepositoryError JSDoc Mode-A
  update — a comment-only edit, safe). S1's resolver tests stay green (regression).

## 6. Decisions locked

- The catch arm renders `error.message` as-is (S1's message is already actionable per §9.8.5). No rewrite.
- NO per-site cwd changes (single-chdir strategy; §9.8.7 inheritance is structural).
- NO new source files — only (1) the catch arm in src/index.ts + (2) the NotARepositoryError JSDoc
  update + (3) the acceptance test file.
- Acceptance file: `tests/integration/repo-root-acceptance.test.ts` (distinct from S1's
  `tests/integration/utils/repo-root.test.ts` and S2's `tests/integration/cli/repo-root-semantics.test.ts`).
- Subprocess tests use the local `node_modules/.bin/tsx` + absolute `src/index.ts` path (hermetic).
- (f)–(i) acceptance is OWNED by S2's file; T2.S1 references it (consume, don't duplicate).