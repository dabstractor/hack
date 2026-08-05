# Research — P1.M1.T2.S1: Integration tests — subcommands from nested subdir + outside repo

## 1. What this task tests (the BUG-001 fix)

BUG-001 (Critical): the 6 subcommands (task/status/cache/inspect/artifacts/validate-state) resolved
`plan/` & `PRD.md` against INVOCATION_CWD because their `.action()` handlers run INSIDE
`program.parse()` — before `main()`'s `process.chdir(repoRoot)`. The fix (P1.M1.T1.S2, CONTRACT —
assume LANDED): a single `program.hook('preAction', …)` in `parseCLIArgs()` calls
`bootstrapRepoRoot(process.cwd(), {explicit}?)` so repo-root resolution + chdir run before ANY action
handler (root default + all subcommands). P1.M1.T1.S3 simplifies the now-redundant config handler.

**This task (T2.S1) = the integration-test suite that PROVES the fix.** It closes the gap that let
BUG-001 ship (the existing suite tested the resolver in isolation, missing the action-handler timing).
Test-only — no source, no docs.

## 2. The spawnSync test pattern to mirror (verified in-repo)

`tests/integration/repo-root-acceptance.test.ts` already has the exact hermetic harness — MIRROR it:

```ts
const tsxBin = resolve(process.cwd(), 'node_modules', '.bin', 'tsx');   // LOCAL binary (not global npx)
const absIndex = resolve(process.cwd(), 'src/index.ts');                 // ABSOLUTE script path
const runCli = (args: string[], cwd: string) =>
  spawnSync(tsxBin, [absIndex, ...args], { cwd, encoding: 'utf8' });     // cwd controls the invocation dir
const makeRepo = (): string => { /* mkdtempSync + git init -q */ };
```

**Why subprocess (not in-process `parseCLIArgs`):**
- Each `spawnSync` is a FRESH process → NO module-singleton leakage (`_repoRoot`/`_bootstrapped`), NO
  `_resetBootstrap()` needed (the contract explicitly notes this).
- The bug is a TIMING/ordering bug (action runs before chdir) — only a real end-to-end CLI invocation
  reproduces it faithfully. In-process `parseCLIArgs` calls would need `_resetBootstrap()` + cwd control
  + would chdir the TEST process (fragile). Subprocess is the hermetic, faithful choice.
- The subprocess exercises the REAL hook + REAL chdir + REAL action handler — exactly what shipped wrong.

## 3. Subcommand behaviors (verified output strings — for assertions)

### taskAction (cli/index.ts:619-800) — used by BOTH `task` and `status`
| Scenario | Fixture | Output | Exit |
|---|---|---|---|
| session + tasks.json present | `plan/001_abcdef123456/tasks.json` | **stderr**: `[hack] Using main tasks: 001_abcdef123456/tasks.json` (chalk.cyan); stdout: listing/status | **0** |
| session dir exists, NO tasks.json (§5.3) | `plan/001_abcdef123456/` (no tasks.json) | **stderr**: `[hack] Session 001_abcdef123456: tasks.json is generated during PRD breakdown and is not available yet — re-run shortly, or run \`hack --continue\`...` | **0** (calm notice) |
| no sessions (empty/absent plan/) | none | throws `Error('No sessions found. Run the pipeline first or use --file / --session.')` → catch | **1** |

Key: `taskAction` does `JSON.parse(readFile(tasksFile))` and iterates `data.backlog` — **NO Zod validation**
in this path. So a minimal fixture `plan/001_abcdef123456/tasks.json` = `{ "backlog": [] }` is a valid
success fixture (exit 0, `Using main tasks` printed). chalk wraps output in ANSI — `toContain('Using main
tasks')` substring-matches fine (the substring has no color boundary inside it).

### Command classes (inspect/artifacts/cache/validate-state) — error strings
- All throw `new Error('No sessions found')` (or 'No session found') when plan/ has no session:
  inspect.ts:212, artifacts.ts:252, validate-state.ts:207, cache.ts:220.
- validate-state additionally validates the PRD: pre-fix, from a subdir it errored
  `Failed to validate PRD exists at <subdir>/PRD.md`.
- These command classes use `resolve('plan')`/`resolve('PRD.md')` in their constructors (defaults) —
  CORRECT after the hook chdirs (resolve() runs post-chdir → repoRoot). No per-class change needed.

## 4. Session discovery (verified) — what makes a fixture a "session"

`SessionManager.findLatestSession(planDir)` → `listSessions(planDir)` → `__scanSessionDirectories`
scans `plan/` for dirs matching `NNN_<12hexhash>` (the `__parseSessionDirectory` regex at
session-manager.ts:1401). **Discovery is dir-NAME-based** — just `plan/001_abcdef123456/` existing
makes it a found session. `tasks.json` is SEPARATE: its absence (with the dir present) = the §5.3
breakdown-in-progress calm-notice path. (The bug-hunt repro mentioned `.prd_hash`, but the actual
discovery only needs the dir; `.prd_hash` is not required for `findLatestSession`.)

## 5. The NotARepositoryError path (§9.8.5) — why `hack task` outside repo is now clean

After the S2 hook: `hack task` outside any repo → the hook's `bootstrapRepoRoot` throws
`NotARepositoryError` BEFORE the action body runs → propagates through `program.parse()` →
`main().catch()`'s DEDICATED `NotARepositoryError` arm (index.ts:417) → `❌ <message>` + exit 1.
So stderr = `No .git entry found at or above "<dir>". ... --repo-root <path>.` (the clean actionable
message) — NOT the action's `No sessions found` and NOT a stack trace. (Pre-fix, `hack task` outside
repo printed the scary `No sessions found` because the action ran with cwd=INVOCATION_CWD.)

## 6. Test design (3 groups, all subprocess)

### Group A — each of the 6 subcommands from a nested subdir resolves at repo root (§9.8.7/§9.8.9)
Fixture per test: `makeRepo()` + `plan/001_abcdef123456/tasks.json` = `{ "backlog": [] }` + `PRD.md`
at repo root; nested dir `src/deep/nested`; `runCli([subcommand], nested)`.
- **task** (default list): exit 0; stderr `Using main tasks` + `001_abcdef123456`.
- **status**: exit 0; stderr `Using main tasks`; stdout `Task status summary`.
- **inspect**: exit 0; stdout contains `001_abcdef123456` (found the repo-root session); NOT `No sessions found`.
- **artifacts**: exit 0 (or appropriate); NOT `No sessions found` (session found at repo root).
- **cache**: exit 0 (stats); operates against repo-root plan/.
- **validate-state**: exit (validation-dependent); stderr does NOT contain `<nested>/PRD.md` /
  `Failed to validate PRD exists at <nested>` (PRD resolves at repo root, not the subdir).
(Contrapositive proof: pre-fix these failed from the subdir because plan/PRD resolved to the subdir.)

### Group B — NotARepositoryError from outside any repo (§9.8.5)
Fixture: non-repo `mkdtempSync` (no .git). `runCli([subcommand], nonRepo)`.
- `hack task`, `hack status`, `hack validate-state` (representative — the hook fires for ALL): exit 1;
  stderr `No .git entry found`; stderr `--repo-root`; stderr contains `<nonRepo>`; stderr does NOT
  contain a stack trace (`at `) and does NOT contain `No sessions found` (the action never ran).

### Group C — §5.3 breakdown-in-progress synergy from a subdir
Fixture: `makeRepo()` + `plan/001_abcdef123456/` dir EXISTS but NO tasks.json. `runCli(['status'], nested)`.
- exit 0; stderr `tasks.json is generated during PRD breakdown` (the calm notice); NOT `No sessions found`.

## 7. Decisions locked

- **File**: `tests/integration/cli/subcommand-repo-root.test.ts` (the contract-suggested name).
- **ALL tests subprocess-based** (spawnSync) — no `_resetBootstrap()`, no singleton leakage, faithful
  end-to-end reproduction. Mirror `repo-root-acceptance.test.ts`'s helpers verbatim.
- **Fixture**: `plan/001_abcdef123456/tasks.json` = `{ "backlog": [] }` (valid; no Zod in taskAction).
  PRD.md = `# x` at repo root (for validate-state / PRD resolution). Discovery is dir-name-based only.
- **Assertions**: strongest signal `Using main tasks` (task/status); for others, absence of the
  subdir-path bug signature + presence of the repo-root session id.
- **beforeEach/afterEach**: mkdtempSync per test; rmSync recursive in afterEach; restore process.cwd()
  belt-and-suspenders (the subprocess doesn't change the TEST process's cwd, but a try/finally rm is safer).
- **No source/docs edits** (test-only; matches the item's "DOCS: none"). Depends on S2's hook (CONTRACT —
  assume LANDED before T2.S1 begins).

## 8. Parallel-execution / file-disjoint check

- **vs S2 (the fix, CONTRACT)**: S2 edits `src/cli/index.ts` (hook) + `src/index.ts` (main swap) +
  `tests/unit/cli/index.test.ts` (mock). T2.S1 creates ONLY `tests/integration/cli/subcommand-repo-root.test.ts`
  (a NEW file) — ZERO overlap with S2's files. T2.S1 consumes S2's hook behavior (assumes it's LANDED).
- **vs S3 (config-handler simplify, in-flight)**: S3 edits `src/cli/index.ts` (config handler only).
  T2.S1 does not touch source. No overlap.
- **vs repo-root-acceptance.test.ts (existing)**: T2.S1 MIRRORS its helpers but is a distinct file with
  distinct coverage (subcommands-from-subdir; the acceptance file covers the default path + hard error
  for the default invocation). Merge-safe.