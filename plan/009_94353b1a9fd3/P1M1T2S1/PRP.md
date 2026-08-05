# PRP — P1.M1.T2.S1: No-repository hard error + child/agent inheritance + acceptance tests

> Completes PRD §9.8 (Repository Root Resolution). S1 (LANDED) provides `resolveRepositoryRoot` +
> `NotARepositoryError` + the bootstrap `process.chdir(repoRoot)` in `main()`. S2 (lands first) provides
> the `--repo-root` flag + explicit/default path semantics. **T2.S1 adds the clean hard-error render arm
> to `main().catch()` (§9.8.5), verifies child/agent inheritance (§9.8.7), and delivers the full §9.8.9
> acceptance sweep.** This is the FINAL subtask of Milestone P1.M1 and Phase P1.

---

## Goal

**Feature Goal**: Make a no-repository invocation abort with a single actionable `❌` message + exit 1
(PRD §9.8.5), rendered by a dedicated `NotARepositoryError` arm in `main().catch()` (mirroring the
existing AuthPreflightError/Harness/Unsupported arms). Verify (via code inspection + acceptance tests)
that child/agent tool executions inherit `cwd = repoRoot` after the single bootstrap `chdir` (§9.8.7).
Deliver the comprehensive §9.8.9 acceptance suite (real-tmpdir git repos incl. worktrees + submodules,
plus CLI-subprocess tests for the hard-error + `--help`-outside-repo paths).

**Deliverable**:
1. **`src/index.ts`** — EDIT `main().catch()`: add a `NotARepositoryError` arm (`❌ + error.message +
   process.exit(1)`); add `NotARepositoryError` to the existing `./utils/repo-root.js` import.
2. **`src/utils/repo-root.ts`** — EDIT (Mode A, comment-only): update the `NotARepositoryError` JSDoc to
   reflect that the hard-error contract is now COMPLETE (exit 1 via the dedicated `main().catch()` arm).
3. **`tests/integration/repo-root-acceptance.test.ts`** (NEW) — the §9.8.9 acceptance sweep (criteria
   a–e + child-inheritance at the resolver/subprocess level; f–i referenced to S2's file).
4. **Docs (Mode A)** — the NotARepositoryError JSDoc update (above) is the doc ride-along.

**Success Definition**:
- A no-repo `hack` invocation prints exactly ONE `❌` line naming the searched-from dir + `--repo-root`
  remediation and exits 1 — via the dedicated `NotARepositoryError` arm (NOT the generic "Fatal error"
  arm). No session dir created.
- `hack --help` from a non-repo directory exits 0 (Commander short-circuits before the traversal).
- §9.8.9 acceptance: subdir→repoRoot (process.cwd()===repoRoot); worktree `.git` file; submodule→
  submodule root; no-repo→exit1+no-session; `--help` outside repo→exit0; child/agent inheritance.
- `npm run typecheck && npm run lint && npm run format:check` clean; new acceptance suite green; S1's
  resolver suites + S2's semantic suite stay green (regression).

---

## Why

- **Closes the §9.8.5 UX gap.** Today a no-repo invocation throws `NotARepositoryError` (S1) but it falls
  through to the GENERIC `main().catch()` arm, which renders `❌ Fatal error in main(): <NotARepositoryError>`
  — ugly, leaky (exposes the error object), and not the "single actionable message" §9.8.5 mandates. The
  dedicated arm renders S1's already-actionable message cleanly and exits 1, matching the §9.2.7
  fail-fast philosophy shared by the AuthPreflight/Harness/Unsupported arms.
- **Git is a hard prerequisite (§9.8.5 / §8).** Smart commits, task recovery, and session state all run
  against the repo root. Catching the missing prerequisite at startup with one clear message (before any
  session/.env/agent) prevents confusing failures deep inside the first git operation.
- **Acceptance is the Definition of Done for §9.8.** S1 (resolver) + S2 (flag/semantics) + T2.S1 (hard
  error + full §9.8.9 sweep) together complete the feature. T2.S1 is where the cross-cutting behaviors
  (worktree/submodule detection, child inheritance, no-repo/`--help` edge cases) are PROVEN, not assumed.
- **Completes Milestone P1.M1 and Phase P1.** Unblocks P2 (`.hack` loader consumes `getRepoRoot()`) and
  P4 (docs).
- **Out of scope (hard boundary):** modifying `resolveRepositoryRoot`/`traverseUp`/`resolveExplicit`
  logic (S1 owns it), the `--repo-root` flag + explicit/default semantics (S2 owns it), any per-site
  `process.cwd()`/`resolve()` change (the single-chdir strategy needs none — §9.8.3/§9.8.7), the `.hack`
  loader (P2).

---

## What

### User-visible behavior
Running `hack` (any operational invocation) outside any git repository prints a single line like:
```
❌ No .git entry found at or above "/Users/me/notes". Run inside a git repository, or pass --repo-root <path>.
```
and exits 1, having created no `plan/` session and invoked no agent. `hack --help` / `hack --version` /
invalid-flag usage still work anywhere (exit 0 for help/version) because Commander short-circuits during
parse, before the traversal.

### Technical requirements (exact contract)

**File 1 — `src/index.ts`** (2 edits):

(1) **Import** — add `NotARepositoryError` to the existing import:
```ts
import { resolveRepositoryRoot, NotARepositoryError } from './utils/repo-root.js';
```
(currently only `resolveRepositoryRoot` is imported at ~L49.)

(2) **`main().catch()` arm** (~L363–378) — add a `NotARepositoryError` arm BEFORE the generic fallback,
mirroring the existing arms exactly:
```ts
if (error instanceof NotARepositoryError) {
  console.error(`\n❌ ${error.message}`); // §9.8.5: searchedFrom + no-.git-ancestor + --repo-root remediation (fires before any session/.env/agent)
  process.exit(1);
}
```
Place it adjacent to the other typed arms (order among typed arms does not matter — they're mutually
exclusive). The generic `console.error('\n❌ Fatal error in main():', error); process.exit(1);` stays as
the final fallback.

**File 2 — `src/utils/repo-root.ts`** (Mode A, comment-only JSDoc update):
The current `NotARepositoryError` JSDoc `@remarks` says "The clean render arm + exit code +
child-inheritance UX in `main().catch()` lands in P1.M1.T2.S1; until then this error renders via the
generic catch arm." UPDATE it to reflect the now-complete contract:
> "Thrown by {@linkcode resolveRepositoryRoot} when no `.git` entry is found (§9.8.5). Rendered by a
> dedicated `main().catch()` arm as a single actionable `❌` message + exit 1, BEFORE any session is
> created, `.hack`/`.env` is read, or any agent is invoked (the resolver runs after `parseCLIArgs()` so
> `--help`/`--version`/usage errors short-circuit first). The message names the searched-from directory,
> the fact that no ancestor contains `.git`, and the `--repo-root <path>` remediation."

(No code/logic change to `NotARepositoryError` or any function in this file — JSDoc only.)

**File 3 — `tests/integration/repo-root-acceptance.test.ts`** (NEW) — see Implementation Blueprint Task 3.

### Success Criteria
- [ ] `NotARepositoryError` imported in `src/index.ts`; a dedicated arm in `main().catch()` renders
      `\n❌ ${error.message}` + `process.exit(1)` (NOT the generic "Fatal error" arm).
- [ ] No-repo invocation: exit 1, stderr contains the actionable message (searchedFrom + `--repo-root`),
      no `plan/` session created, no agent invoked.
- [ ] `hack --help` from a non-repo dir: exit 0.
- [ ] Launched from a subdir: resolver finds repoRoot; bootstrap `chdir` makes `process.cwd() === repoRoot`.
- [ ] Worktree (`.git` file via `git worktree add`) resolves to the worktree root.
- [ ] Submodule (nested repo with own `.git`) resolves to the submodule root.
- [ ] Bugfix dir under the session resolves the SAME repo root as the parent (child inheritance).
- [ ] `NotARepositoryError` JSDoc updated (Mode A); no logic change to `repo-root.ts`.
- [ ] `npm run typecheck && npm run lint && npm run format:check` clean; new suite green; S1 + S2 regression green.

---

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed?_ **Yes** — the exact
landed `main().catch()` arms (with line numbers) to mirror, the exact `NotARepositoryError` message
shapes (so the arm renders correctly), the ordering proof (throw before .env/session/agent; --help
short-circuits in parse), the full child-inheritance site table, the per-criterion acceptance-test
recipes (real `git worktree add` / nested-repo submodule / spawnSync mechanics), and the executable
validation commands are all below.

### Documentation & References

```yaml
# MUST READ — authoritative §9.8 spec (selectors didn't auto-extract; read directly)
- docfile: PRD.md
  section: "§9.8.5 No-Repository Behavior (Hard Error)" and "§9.8.7 Effect on Subcommands & Child Processes" and "§9.8.9 Acceptance Criteria"
  why: §9.8.5 (exit 1, before session/.env/agent, actionable message, --help exemption), §9.8.7 (child
        inheritance via single chdir), §9.8.9 (the 9 acceptance criteria a–i + child-process criterion).

# MUST READ — design + cascade + child-inheritance proof (authored with this PRP)
- docfile: plan/009_94353b1a9fd3/P1M1T2S1/research/hard-error-and-acceptance-design.md
  section: "2. The change" and "3. Child/agent inheritance" and "4. Acceptance-test design"
  why: Exact main().catch() arm code, the ordering proof (throw site L~133 < configureEnvironment L~140),
        the proof that NO child_process.spawn exists (inheritance is via process.cwd() = repoRoot), the
        per-criterion test recipes (real git worktree/submodule, spawnSync tsx mechanics), and the
        file-disjoint proof vs S1/S2. READ BEFORE IMPLEMENTING.

# MUST READ — S1's LANDED surface (the error class + resolver T2.S1 consumes)
- file: src/utils/repo-root.ts
  why: NotARepositoryError (class — readonly searchedFrom/explicit; message already actionable), the
        JSDoc @remarks to UPDATE (currently says "lands in P1.M1.T2.S1"), resolveRepositoryRoot (throws
        it). T2.S1 does a JSDoc-only edit here + consumes the class from index.ts.
  gotcha: Do NOT change NotARepositoryError's logic or message — S1's message already satisfies §9.8.5.

# MUST READ — the file with the catch handler (the ONE src edit)
- file: src/index.ts
  why: main().catch() at L363–378 (three typed arms + generic). T2.S1 adds the NotARepositoryError arm
        + the import (L49). The throw site (resolveRepositoryRoot at L~133) and the chdir (L~134) are
        S1-landed — DO NOT touch them.
  pattern: "if (error instanceof XError) { console.error(`\\n❌ ${error.message}`); process.exit(1); }"
  critical: Place the new arm BEFORE the generic fallback. Mirror the EXACT format (\\n❌ + message + exit 1).

# MUST READ — S2's PRP (lands first; defines what T2.S1 can assume + reference)
- file: plan/009_94353b1a9fd3/P1M1T1S2/PRP.md
  why: S2 adds the --repo-root flag + explicit/default path semantics + creates
        tests/integration/cli/repo-root-semantics.test.ts (owns §9.8.9 criteria f,g,h,i). T2.S1
        REFERENCES S2's file for those criteria (consume, don't duplicate) and uses a DISTINCT filename.
  critical: T2.S1 begins AFTER S2 lands. Do not re-test f–i; reference S2's suite.

# MUST READ — current bootstrap ordering + cwd-site inventory (single-chdir strategy proof)
- docfile: plan/009_94353b1a9fd3/architecture/bootstrap-and-reporoot.md
  section: "1. Bootstrap ordering" and "5. ALL process.cwd() and cwd-relative resolve sites"
  why: Confirms the chdir is before configureEnvironment (so the hard error fires first) and that the
        ~30 process.cwd() sites all inherit repoRoot (zero per-site changes — §9.8.7).

# PATTERN FILES — acceptance-test style to mirror
- file: tests/integration/utils/repo-root.test.ts
  why: S1's REAL-tmpdir resolver test (mkdtempSync/mkdirSync/rmSync + resolveRepositoryRoot calls). T2.S1
        MIRRORS this style for the resolver-level acceptance cases (a,b,c,child-inheritance).
  pattern: "mkdirSync(join(tmp,'.git')); ... resolveRepositoryRoot(join(tmp,'a','b')).repoRoot === realpathSync(tmp)"

- file: tests/integration/core/task-orchestrator-e2e.test.ts
  why: Precedent for spawnSync-based integration tests invoking the built/runnable CLI with controlled
        cwd (if it exists); otherwise use spawnSync(tsxBin, [absScript, args], {cwd}) directly.
  gotcha: Use the LOCAL node_modules/.bin/tsx (absolute) + absolute src/index.ts path — NOT global npx
        (flaky/online). The spawned cwd is controlled via spawnSync options.cwd.

# VERIFIED API SURFACE
- NotARepositoryError: instanceof check; .message (actionable); .searchedFrom; .explicit. (S1, landed.)
- node:child_process spawnSync (sync subprocess for the hard-error/--help acceptance cases).
- git CLI: `git init`, `git commit --allow-empty -m`, `git worktree add <path>` (real worktree → .git FILE).
```

### Current Codebase tree (relevant slice)

```bash
src/index.ts                              # EDIT — +NotARepositoryError import; +catch arm
src/utils/repo-root.ts                    # EDIT (Mode A, JSDoc only) — NotARepositoryError @remarks update
tests/integration/repo-root-acceptance.test.ts   # NEW — §9.8.9 acceptance sweep
# READ-ONLY (consume, do not modify):
src/agents/prp-executor.ts:550            # cwd: process.cwd() — inherits repoRoot (§9.8.7)
src/tools/git-mcp.ts:203                  # resolve(path ?? process.cwd()) — inherits repoRoot
src/core/task-orchestrator.ts:1087/1242/1323  # process.cwd() — inherits repoRoot
tests/integration/utils/repo-root.test.ts # S1's resolver suite (regression)
tests/integration/cli/repo-root-semantics.test.ts  # S2's semantic suite (owns f,g,h,i — reference)
```

### Desired Codebase tree with files to be added/edited

```bash
src/index.ts                              # MODIFIED (import + 1 catch arm)
src/utils/repo-root.ts                    # MODIFIED (JSDoc comment only — Mode A)
tests/integration/repo-root-acceptance.test.ts   # NEW
# No other source changes. No per-site cwd edits. No repo-root.ts logic change.
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — the NotARepositoryError arm MUST sit BEFORE the generic fallback in main().catch(). If
//   placed after, the generic `console.error('\n❌ Fatal error in main():', error)` catches it first
//   and the §9.8.5 clean single-message UX is lost. (The typed arms are mutually exclusive, so order
//   among THEM doesn't matter — but all must precede the generic catch-all.)

// CRITICAL — render error.message AS-IS (S1's message is already actionable per §9.8.5: it names
//   searchedFrom + the --repo-root remediation). Do NOT reformat, re-wrap, or prepend "Fatal error".
//   The arm is `console.error(\`\n❌ ${error.message}\`)` — identical to the AuthPreflight/Harness arms.

// CRITICAL — there are NO child_process.spawn / execa / fork calls in src/ (verified). "Child
//   processes" / "agent subprocesses" (§9.8.7) are TOOL EXECUTIONS + bash/file ops reading
//   process.cwd(). The single bootstrap chdir (index.ts L~134) makes process.cwd() === repoRoot for
//   the whole process, so prp-executor.ts:550, git-mcp.ts:203, task-orchestrator ×3, git-commit.ts:553
//   ALL inherit repoRoot with ZERO per-site changes. Do NOT add cwd threading.

// CRITICAL — the throw site (resolveRepositoryRoot at index.ts L~133) is BEFORE configureEnvironment
//   (L~140), configureHarness (L208), runAuthPreflight (L213), new PRPPipeline (L245), pipeline.run
//   (L258). So NotARepositoryError fires BEFORE any session/.env/agent — acceptance (d) "no session
//   created" holds by construction. Do NOT move the resolver.

// CRITICAL — --help/--version/invalid-flag exit INSIDE parseCLIArgs() (Commander process.exit, L117),
//   BEFORE the resolver (L133). So `hack --help` works from a non-repo (exit 0) — acceptance (e).
//   Do NOT move the resolver above parseCLIArgs().

// GOTCHA — S2 lands FIRST. T2.S1 can assume --repo-root + explicit/default semantics exist. For §9.8.9
//   criteria f/g/h/i, REFERENCE S2's tests/integration/cli/repo-root-semantics.test.ts (consume, don't
//   duplicate) to keep the two parallel files merge-safe. T2.S1's file is named distinctly.

// GOTCHA — subprocess acceptance tests: use the LOCAL node_modules/.bin/tsx (absolute path) + an
//   ABSOLUTE src/index.ts path (resolve(process.cwd(),'src/index.ts') from the test, which runs at repo
//   root). The spawned process's cwd is controlled via spawnSync({cwd: nonRepoTmp}). Do NOT use global
//   `npx tsx` (online/flaky). Restore the test process's cwd in afterEach (belt-and-suspenders).

// GOTCHA — the no-repo tmpdir for subprocess tests must have NO .git ancestor. mkdtempSync(tmpdir())
//   (OS tmp, e.g. /tmp/xxx) is safe in practice (no .git up to /). If the CI machine has a .git in a
//   tmpdir ancestor, the traversal would find it — use a deeply-nested mkdtemp to be safe, or assert
//   the resolver throws for the specific tmpdir first.

// GOTCHA — `git worktree add` requires the main repo to have at least one commit: `git init tmp &&
//   git -C tmp commit --allow-empty -m init && git -C tmp worktree add ../tmp-wt`. The worktree's .git
//   is a FILE (gitdir: pointer) — exactly the §9.8.4 case. Assert resolveRepositoryRoot(tmp-wt).repoRoot
//   === realpathSync(tmp-wt) (worktree root, NOT the main checkout).

// GOTCHA — a submodule is a nested repo with its own .git. For a hermetic test WITHOUT a remote, create
//   a nested repo: `git init tmp && git init tmp/vendor/sub`. resolveRepositoryRoot(tmp/vendor/sub)
//   resolves to tmp/vendor/sub (nearest-ancestor — §9.8.4 submodule→submodule root, not superproject).
//   (A real `git submodule add` needs a URL; the nested-repo approach is the equivalent root-detection
//   test and is fully hermetic.)

// GOTCHA — vitest.config.ts enforces 100% coverage on src/**/*.ts. T2.S1 adds ONE new line (the catch
//   arm) to src/index.ts. That branch (error instanceof NotARepositoryError → true) is covered by the
//   no-repo subprocess acceptance test (criterion d). The repo-root.ts JSDoc edit adds zero coverage
//   burden (comment only). If coverage on index.ts drops, ensure the no-repo test actually triggers
//   the arm (the subprocess must exit via NotARepositoryError, not some other path).

// GOTCHA — prettier is ERROR-enforced. Run `npm run fix` before format:check.

// GOTCHA — do NOT run the full `npm run test:run` as the primary gate (orthogonal suite state). Gate on:
//   typecheck + lint + format:check + the new acceptance suite + S1's resolver suites + S2's semantic
//   suite (regression).
```

---

## Implementation Blueprint

### Data models and structure
None new. The only "model" is the `NotARepositoryError` arm logic (`instanceof` → render → exit). No
Zod/ORM/CLI-arg changes.

### Implementation Tasks (ordered by dependencies — implicit TDD: RED first, then GREEN)

```yaml
Task 1: CREATE tests/integration/repo-root-acceptance.test.ts   (RED — must fail before the catch arm lands)
  - IMPORTS: vitest (describe/it/expect/beforeEach/afterEach); node:fs (mkdtempSync/mkdirSync/
        writeFileSync/rmSync/existsSync/realpathSync); node:os tmpdir; node:path (join/resolve);
        node:child_process spawnSync; resolveRepositoryRoot + NotARepositoryError from
        '../../../src/utils/repo-root.js'.
  - HELPERS:
      * makeRepo(): mkdtempSync + `git init` (spawnSync git) → returns tmp path. afterEach rmSync.
      * tsxBin = resolve(process.cwd(), 'node_modules', '.bin', 'tsx'); absIndex = resolve(process.cwd(),
        'src/index.ts'). (Hermetic subprocess invocation.)
      * runCli(args[], cwd): spawnSync(tsxBin, [absIndex, ...args], {cwd, encoding:'utf8'}) → {status, stderr, stdout}.
  - LAYER A — resolver-level (real tmpdirs), mirroring S1's integration style:
      (a) it('launched from a subdir resolves the repo root; bootstrap chdir makes cwd===repoRoot'):
            makeRepo(); mkdirSync(tmp/src/a/b,{recursive}); assert resolveRepositoryRoot(join(tmp,'src','a','b')).repoRoot
            === realpathSync(tmp). PLUS the bootstrap-sequence subprocess: spawnSync(tsxBin, ['-e',
            '<inline: import resolveRepositoryRoot, chdir, print process.cwd()>'], {cwd: join(tmp,'src','a','b')})
            → stdout.trim() === realpathSync(tmp). (Proves process.cwd()===repoRoot post-chdir.)
      (b) it('detects a git worktree via its .git FILE'): makeRepo(); `git -C tmp commit --allow-empty -m x`;
            `git -C tmp worktree add <tmp-wt>`; assert resolveRepositoryRoot(tmp-wt).repoRoot === realpathSync(tmp-wt).
            (The .git file at the worktree root is detected — §9.8.4.)
      (c) it('resolves a submodule to the submodule root, not the superproject'): makeRepo();
            `git init tmp/vendor/sub`; assert resolveRepositoryRoot(join(tmp,'vendor','sub')).repoRoot ===
            realpathSync(join(tmp,'vendor','sub')). (Nearest-ancestor wins — §9.8.4.)
      (child-inheritance) it('a bugfix dir under the session resolves the same repo root as the parent'):
            makeRepo(); mkdirSync(join(tmp,'plan','001_abc','bugfix','002_def'),{recursive:true}); assert
            resolveRepositoryRoot(join(tmp,'plan','001_abc','bugfix','002_def')).repoRoot === realpathSync(tmp).
            (§9.8.7 / §9.8.9 child-process criterion — bugfix dir walks up to the same .git.)
  - LAYER B — CLI subprocess (spawnSync the real tsx src/index.ts with controlled cwd):
      (d) it('a no-repo invocation exits 1 with an actionable message and creates no session'):
            nonRepo = mkdtempSync(join(tmpdir(),'no-repo-')); runCli(['--prd','./PRD.md'], nonRepo);
            assert status===1; assert stderr includes 'No .git entry found' AND nonRepo (searchedFrom)
            AND '--repo-root'; assert NOT existsSync(join(nonRepo,'plan')) (no session created).
      (e) it('--help works outside any repo (exit 0)'): runCli(['--help'], nonRepo); assert status===0.
            (Commander short-circuits in parseCLIArgs before the traversal — §9.8.5 exemption.)
  - REFERENCE (do NOT duplicate): add a header comment noting §9.8.9 criteria f/g/h/i (--repo-root
        pin/error, explicit --prd against invocation, default PRD.md → <repoRoot>/PRD.md) are covered
        by S2's tests/integration/cli/repo-root-semantics.test.ts.
  - NAMING: it('resolves the repo root when launched from a nested subdir'), it('detects a git worktree
        via its .git file'), it('exits 1 with an actionable message when no repo is found'), etc.
  - PLACEMENT: tests/integration/repo-root-acceptance.test.ts.
  - EXPECTED NOW: (d) FAILS — the no-repo invocation currently renders via the GENERIC arm (stderr
        contains 'Fatal error in main()' NOT the clean 'No .git entry found' ❌ line) → RED. (a/b/c/e
        may pass already since they test S1's resolver + Commander; (d) is the one needing the new arm.)

Task 2: EDIT src/index.ts — add the NotARepositoryError import + catch arm   (GREEN for criterion d)
  - IMPORT (~L49): change `import { resolveRepositoryRoot } from './utils/repo-root.js';` to
        `import { resolveRepositoryRoot, NotARepositoryError } from './utils/repo-root.js';`.
  - main().catch() (~L363–378): add the arm BEFORE the generic fallback:
        if (error instanceof NotARepositoryError) {
          console.error(`\n❌ ${error.message}`); // §9.8.5: searchedFrom + no-.git-ancestor + --repo-root remediation
          process.exit(1);
        }
  - DO NOT: touch the throw site (L~133), the chdir (L~134), parseCLIArgs, the other typed arms, or the
        generic fallback. DO NOT reformat error.message.
  - EXPECTED: acceptance (d) turns GREEN (stderr now has the clean ❌ line, exit 1). (e) stays GREEN.

Task 3: EDIT src/utils/repo-root.ts — Mode A JSDoc update on NotARepositoryError   (GREEN — comment only)
  - UPDATE the NotARepositoryError @remarks (currently says "lands in P1.M1.T2.S1; until then renders
        via the generic catch arm") to reflect the now-complete contract (see "Technical requirements"
        File 2). No logic/message change.
  - EXPECTED: typecheck/lint/format clean; S1's resolver suites still green (no logic change).

Task 4: FORMAT + VERIFY
  - RUN: npm run fix → npm run typecheck → npm run lint → npm run format:check.
  - RUN: npx vitest run tests/integration/repo-root-acceptance.test.ts (new suite green).
  - RUN (regression): npx vitest run tests/unit/utils/repo-root.test.ts tests/integration/utils/repo-root.test.ts
        (S1's resolver suites — stay green).
  - RUN (regression): npx vitest run tests/integration/cli/repo-root-semantics.test.ts (S2's semantic
        suite — stays green; if S2 hasn't landed yet, skip this line).
  - EXPECTED: all clean. If acceptance (d) still fails, confirm the subprocess actually reaches the
        NotARepositoryError arm (not e.g. an earlier parse error) — check stderr for 'No .git entry found'.
```

### Implementation Patterns & Key Details

```ts
// ---- src/index.ts: the new catch arm (mirror the existing typed arms EXACTLY) ----
import { resolveRepositoryRoot, NotARepositoryError } from './utils/repo-root.js';
...
void main()
  .then(code => { if (typeof code === 'number') process.exitCode = code; })
  .catch((error: unknown) => {
    if (error instanceof AuthPreflightError) { console.error(`\n❌ ${error.message}`); process.exit(1); }
    if (error instanceof HarnessProviderMismatchError) { console.error(`\n❌ ${error.message}`); process.exit(1); }
    if (error instanceof UnsupportedHarnessError) { console.error(`\n❌ ${error.message}`); process.exit(1); }
    if (error instanceof NotARepositoryError) {                                   // ← NEW (§9.8.5)
      console.error(`\n❌ ${error.message}`); // actionable: searchedFrom + no-.git-ancestor + --repo-root
      process.exit(1);
    }
    console.error('\n❌ Fatal error in main():', error);
    process.exit(1);
  });

// ---- tests/integration/repo-root-acceptance.test.ts: key cases ----
import { spawnSync } from 'node:child_process';
import { resolveRepositoryRoot, NotARepositoryError } from '../../../src/utils/repo-root.js';
const tsxBin = resolve(process.cwd(), 'node_modules', '.bin', 'tsx');
const absIndex = resolve(process.cwd(), 'src/index.ts');
const runCli = (args: string[], cwd: string) =>
  spawnSync(tsxBin, [absIndex, ...args], { cwd, encoding: 'utf8' });

it('(d) no-repo invocation exits 1 with an actionable message and creates no session', () => {
  const nonRepo = mkdtempSync(join(tmpdir(), 'no-repo-'));
  const { status, stderr } = runCli(['--prd', './PRD.md'], nonRepo);
  expect(status).toBe(1);
  expect(stderr).toContain('No .git entry found');      // the clean ❌ message (not 'Fatal error')
  expect(stderr).toContain(nonRepo);                    // searchedFrom named
  expect(stderr).toContain('--repo-root');              // remediation
  expect(existsSync(join(nonRepo, 'plan'))).toBe(false); // no session created
  rmSync(nonRepo, { recursive: true, force: true });
});

it('(e) --help works outside any repo (exit 0)', () => {
  const nonRepo = mkdtempSync(join(tmpdir(), 'no-repo-'));
  const { status } = runCli(['--help'], nonRepo);
  expect(status).toBe(0);                                // Commander short-circuits before traversal
  rmSync(nonRepo, { recursive: true, force: true });
});

it('(b) detects a git worktree via its .git FILE', () => {
  const main = mkdtempSync(join(tmpdir(), 'repo-'));
  spawnSync('git', ['init', '-q', main]);
  spawnSync('git', ['-C', main, 'commit', '-q', '--allow-empty', '-m', 'init']);
  const wt = main + '-wt';
  spawnSync('git', ['-C', main, 'worktree', 'add', '-q', wt]);
  expect(resolveRepositoryRoot(wt).repoRoot).toBe(realpathSync(wt)); // .git FILE detected (§9.8.4)
  rmSync(main, { recursive: true, force: true });
  rmSync(wt, { recursive: true, force: true });
});

// (a) subdir resolution + bootstrap chdir equivalence; (c) nested-repo submodule; (child) bugfix dir —
// all resolver-level, mirroring S1's tests/integration/utils/repo-root.test.ts style.
```

### Integration Points

```yaml
MAIN ENTRYPOINT (src/index.ts):
  - import: +NotARepositoryError (extend the existing ./utils/repo-root.js import)
  - main().catch(): +NotARepositoryError arm (before the generic fallback; mirror the typed arms)
  - PRESERVE: throw site (L~133), chdir (L~134), parseCLIArgs, the other typed arms, generic fallback

NOTA REPOSITORY ERROR (src/utils/repo-root.ts):
  - JSDoc @remarks UPDATE (Mode A — comment only): hard-error contract now complete (exit 1 via the
        dedicated arm; before session/.env/agent; --help exempt)
  - PRESERVE: class logic, message, resolveRepositoryRoot, traverseUp, resolveExplicit, accessors

CHILD/AGENT INHERITANCE (§9.8.7) — NO EDIT (structural, verified by inspection + acceptance tests):
  - prp-executor.ts:550 / git-mcp.ts:203 / task-orchestrator.ts ×3 / git-commit.ts:553 all read
        process.cwd() which === repoRoot after the single bootstrap chdir.

ACCEPTANCE OWNERSHIP (§9.8.9):
  - T2.S1 owns (a,b,c,d,e,child) in tests/integration/repo-root-acceptance.test.ts
  - S2 owns (f,g,h,i) in tests/integration/cli/repo-root-semantics.test.ts (reference, don't duplicate)

DOWNSTREAM (unblocked by completing P1.M1 / Phase P1):
  - P2.M1.T1.S2 (.hack loader): consumes getRepoRoot() for .hack discovery at the repo root.
  - P4.M1.T1.S1 (docs): references the §9.8 behavior in README/ARCHITECTURE/CONFIGURATION.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run fix                  # lint:fix + prettier --write (run first)
npm run typecheck            # tsc --noEmit -p tsconfig.build.json — clean
npm run lint                 # eslint . --ext .ts — clean
npm run format:check         # prettier --check — clean
# Expected: all clean. If lint flags an unused import, confirm NotARepositoryError is used in the catch arm.
```

### Level 2: Unit/Integration Tests (Component Validation)

```bash
# T2.S1's gate — the new acceptance suite:
npx vitest run tests/integration/repo-root-acceptance.test.ts
# S1 regression — the resolver suites must stay green (T2.S1 only JSDoc-edits repo-root.ts):
npx vitest run tests/unit/utils/repo-root.test.ts tests/integration/utils/repo-root.test.ts
# S2 regression — the semantic suite (if landed):
npx vitest run tests/integration/cli/repo-root-semantics.test.ts
# Expected: all green. If acceptance (d) fails (stderr has 'Fatal error' not 'No .git entry found'),
# the catch arm isn't wired — confirm the instanceof check + arm placement.
```

### Level 3: Integration Testing (System Validation)

```bash
# Smoke: no-repo hard error from a real non-repo dir (the §9.8.5 UX, end-to-end).
mkdir -p /tmp/no-repo-smoke && cd /tmp/no-repo-smoke && rm -rf plan
npx tsx /abs/path/to/src/index.ts --prd ./PRD.md; echo "exit=$?"
# Expected: a single "❌ No .git entry found at or above \"/tmp/no-repo-smoke\". ... --repo-root <path>." line;
# exit=1; NO /tmp/no-repo-smoke/plan/ created.

# Smoke: --help from the same non-repo dir (the §9.8.5 exemption).
cd /tmp/no-repo-smoke && npx tsx /abs/path/to/src/index.ts --help >/dev/null; echo "exit=$?"
# Expected: exit=0 (Commander short-circuits in parseCLIArgs, before the traversal).
```

### Level 4: Creative & Domain-Specific Validation

```bash
# No MCP/DB/HTTP surface (the catch arm is pure control flow; the resolver is pure path logic). Domain
# checks (record in commit message):
#   - NotARepositoryError renders via the DEDICATED arm (not generic) → single clean ❌ line + exit 1.
#   - Throw site (L~133) precedes configureEnvironment (L~140)/harness/preflight/pipeline → no session/.env/agent.
#   - --help/--version/usage exit in parseCLIArgs (L117) before the resolver (L133) → work outside any repo.
#   - .git accepted as dir (clone) AND file (worktree) — §9.8.4 (real `git worktree add` acceptance).
#   - Submodule (nested repo) resolves to submodule root, not superproject — §9.8.4.
#   - Child/agent tool executions inherit cwd=repoRoot via the single chdir — §9.8.7 (no per-site changes).
#   - §9.8.9 criteria f/g/h/i (--repo-root + explicit/default semantics) covered by S2's suite.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` clean.
- [ ] `npm run lint` clean (NotARepositoryError import is used in the catch arm).
- [ ] `npm run format:check` clean.
- [ ] `npx vitest run tests/integration/repo-root-acceptance.test.ts` green.
- [ ] S1's resolver suites (`tests/unit/utils/repo-root.test.ts`, `tests/integration/utils/repo-root.test.ts`) green (regression).
- [ ] S2's semantic suite green (if landed).

### Feature Validation
- [ ] `NotARepositoryError` imported in `src/index.ts`; dedicated arm in `main().catch()` renders
      `\n❌ ${error.message}` + `process.exit(1)` (before the generic fallback).
- [ ] No-repo invocation: exit 1, stderr = single actionable `❌` line (searchedFrom + `--repo-root`),
      no `plan/` session created.
- [ ] `hack --help` from a non-repo dir: exit 0.
- [ ] Subdir launch: resolver finds repoRoot; bootstrap `chdir` → `process.cwd() === repoRoot`.
- [ ] Worktree (real `git worktree add`, `.git` FILE) resolves to the worktree root.
- [ ] Submodule (nested repo) resolves to the submodule root (not superproject).
- [ ] Bugfix dir under the session resolves the same repo root as the parent (child inheritance).

### Code Quality Validation
- [ ] Only `src/index.ts` (import + 1 catch arm) + `src/utils/repo-root.ts` (JSDoc only) + 1 new test file touched.
- [ ] `NotARepositoryError` arm mirrors the existing typed arms EXACTLY (`❌` + message + exit 1).
- [ ] `error.message` rendered AS-IS (S1's message already actionable; no reformat).
- [ ] NO per-site `process.cwd()`/`resolve()` changes (single-chdir strategy; §9.8.7).
- [ ] NO change to `resolveRepositoryRoot`/`traverseUp`/`resolveExplicit`/`NotARepositoryError` logic.
- [ ] Acceptance file named distinctly from S1's + S2's (merge-safe).

### Documentation & Deployment
- [ ] `NotARepositoryError` JSDoc `@remarks` updated (Mode A): hard-error contract complete (exit 1 via
      dedicated arm; before session/.env/agent; `--help` exempt; message names searchedFrom + `--repo-root`).
- [ ] Commit message notes: dedicated catch arm completes §9.8.5; child/agent inheritance is structural
      (§9.8.7); §9.8.9 acceptance sweep delivered (a–e + child here; f–i in S2's suite); completes P1.M1 + P1.

---

## Anti-Patterns to Avoid

- ❌ Don't place the `NotARepositoryError` arm AFTER the generic fallback — the generic
      `console.error('\n❌ Fatal error in main():', error)` would catch it first and the clean §9.8.5 UX
      is lost. All typed arms precede the catch-all.
- ❌ Don't reformat or re-wrap `error.message` — S1's message already names searchedFrom + the
      `--repo-root` remediation (§9.8.5). Render it verbatim as `\n❌ ${error.message}`.
- ❌ Don't change `NotARepositoryError`'s logic or message — S1 owns it; T2.S1 only JSDoc-edits + consumes it.
- ❌ Don't move the resolver/throw site above `parseCLIArgs()` — `--help`/`--version`/usage must
      short-circuit first (§9.8.5 exemption; Commander exits inside parse).
- ❌ Don't add `cwd` threading to prp-executor/git-mcp/task-orchestrator/git-commit — the single bootstrap
      `chdir` already makes `process.cwd() === repoRoot` for the whole process (§9.8.7). Zero per-site changes.
- ❌ Don't duplicate §9.8.9 criteria f/g/h/i — they're S2's (`tests/integration/cli/repo-root-semantics.test.ts`).
      Reference S2's file; keep T2.S1's file focused on a–e + child inheritance.
- ❌ Don't use global `npx tsx` in subprocess acceptance tests — use the LOCAL
      `node_modules/.bin/tsx` (absolute) + an ABSOLUTE `src/index.ts` path (hermetic; no network).
- ❌ Don't use `git submodule add <url>` for the submodule test (needs a remote) — create a nested repo
      (`git init tmp/vendor/sub`) which is the equivalent root-detection case and is hermetic.
- ❌ Don't forget `git commit --allow-empty` before `git worktree add` — a worktree needs the main repo
      to have a commit, else `git worktree add` errors.
- ❌ Don't run the full `npm run test:run` as the primary gate — focus on typecheck + lint + format +
      the new acceptance suite + S1's + S2's resolver/semantic suites (regression).
- ❌ Don't skip the failing-test-first (RED) step — acceptance (d) must FAIL before the catch arm lands
      (it currently renders via the generic arm).

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: The src change is tiny and surgical (one import + one `instanceof` arm mirroring three
existing arms exactly) and the consumed inputs (`NotARepositoryError` + the bootstrap throw site) are
verified LANDED with exact line numbers. The ordering proofs (throw before .env/session/agent; `--help`
exits in parse before the resolver) are confirmed against the actual `main()`. The child/agent
inheritance is proven structural (no `child_process.spawn` exists; all sites read `process.cwd()` =
repoRoot post-chdir) — zero per-site changes. The acceptance-test design is concrete: real `git worktree
add` + nested-repo submodule + spawnSync-of-local-tsx for the hard-error/`--help` paths, with the
hermetic-mechanics gotchas (local tsx binary, absolute script path, no-.git-ancestor tmpdir) spelled
out. The §9.8.9 criteria are partitioned cleanly between T2.S1 (a–e + child) and S2 (f–i) to stay
merge-safe. Residual risks: (a) a prettier nit (auto-fixed via `npm run fix`); (b) the subprocess test
needing the local tsx binary present (it is — `npm run dev` uses tsx); (c) `git worktree add`/`git init`
availability in the test env (standard on any dev/CI machine with git). No external/runtime unknowns.