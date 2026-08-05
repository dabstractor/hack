# PRP — P1.M1.T2.S1: Integration tests — subcommands from nested subdir + outside repo

> Bugfix 001, **BUG-001 (CRITICAL)** test coverage. S2 (CONTRACT — assume LANDED) fixed all 6
> subcommands with a single `program.hook('preAction', …)` that bootstraps repo-root resolution +
> `process.chdir` before ANY action handler. **T2.S1 is the integration-test suite that PROVES the
> fix** end-to-end: each subcommand from a nested subdir resolves `plan/`&`PRD.md` at the repo root
> (§9.8.7/§9.8.9), outside-repo invocations hit the clean `NotARepositoryError` arm (§9.8.5), and the
> §5.3 breakdown-in-progress notice works from a subdir. **Test-only — no source, no docs.** Closes the
> integration-test gap that let BUG-001 ship.

---

## Goal

**Feature Goal**: Create a subprocess-based integration test file that proves the §9.8.7/§9.8.9
acceptance criteria hold for ALL six subcommands (`task`, `status`, `cache`, `inspect`, `artifacts`,
`validate-state`) when invoked from a nested subdirectory — each resolves `plan/`/`PRD.md` at the repo
root, not the invocation dir. Also prove (a) outside-repo invocations of those subcommands exit 1 with
the clean `No .git entry found` message (not `No sessions found`, not a stack trace — §9.8.5), and (b)
the §5.3 breakdown-in-progress calm notice fires from a subdir (not the scary `No sessions found`).

**Deliverable**:
1. **`tests/integration/cli/subcommand-repo-root.test.ts`** (NEW) — three test groups:
   - **Group A**: each of the 6 subcommands from a nested subdir → resolves at repo root.
   - **Group B**: `hack task` / `status` / `validate-state` (representative) from outside any repo →
     exit 1 + clean `No .git entry found` / `--repo-root` message + no stack trace.
   - **Group C**: `hack status` from a subdir during breakdown-in-progress (session dir exists, no
     `tasks.json`) → the §5.3 calm notice, not `No sessions found`.

**Success Definition**:
- Every Group A case: the subcommand run from `src/deep/nested` of a repo (with a session + PRD at the
  root) operates against the repo root — `task`/`status` print `Using main tasks: 001_abcdef123456/…`;
  `inspect`/`artifacts`/`cache` find the repo-root session (no `No sessions found`); `validate-state`
  resolves the PRD at the repo root (no `<subdir>/PRD.md` error).
- Every Group B case: exit 1, stderr contains `No .git entry found` + the searched-from dir + `--repo-root`,
  NO stack trace, NO `No sessions found` (the action handler never ran — the hook threw first).
- Group C: exit 0, stderr contains the `tasks.json is generated during PRD breakdown` calm notice, NOT
  `No sessions found`.
- `npm run typecheck && npm run lint && npm run format:check` clean; the new suite green; the existing
  `repo-root-acceptance.test.ts` + `repo-root-semantics.test.ts` stay green (regression).

---

## Why

- **Closes the integration-test gap that let BUG-001 ship.** The existing suite tested the resolver in
  isolation (`tests/unit/utils/repo-root.test.ts`) and the default-path acceptance
  (`repo-root-acceptance.test.ts`) but NEVER ran a subcommand from a subdirectory end-to-end. The bug
  was a TIMING bug (`.action()` runs inside `program.parse()`, before `main()`'s chdir) that only a real
  subprocess invocation reproduces. T2.S1 is the regression net that catches any future re-break.
- **Proves the §9.8.7/§9.8.9 acceptance for subcommands.** PRD §9.8.7 explicitly enumerates
  "hack task/status, hack artifacts, hack cache, hack inspect, hack validate-state, hack config" as
  automatic beneficiaries of the single-chdir strategy. After S2's hook they finally ARE — T2.S1 proves
  it for the 6 subcommands (config is covered by `tests/integration/config/hack-config-acceptance.test.ts`).
- **Locks in the §9.8.5 outside-repo UX for subcommands.** Pre-fix, `hack task` outside a repo printed
  the scary `No sessions found` (the action ran against INVOCATION_CWD). Post-hook it must hit the clean
  `NotARepositoryError` arm. T2.S1 asserts this so it can't regress to the scary path.
- **Verifies the §5.3 synergy.** `hack status` from a subdir during an in-progress breakdown must print
  the calm notice, not `No sessions found` — the latter was a direct consequence of BUG-001 (plan/
  resolved to the wrong place). T2.S1 proves the fix restores the §5.3 UX from any launch directory.
- **Scope discipline.** T2.S1 = ONE new test file. No source edits (S2's hook is the fix; T2.S1 only
  tests it). No docs (the item's "DOCS: none"). Depends on S2 (CONTRACT — assume LANDED).

---

## What

### User-visible behavior
None (test-only). The tests verify the already-shipped (post-S2) behavior: subcommands run from anywhere
in a repo operate at the repo root; outside a repo they fail cleanly with the actionable message.

### Technical requirements (exact contract)

**File — `tests/integration/cli/subcommand-repo-root.test.ts`** (NEW). Mirror the hermetic harness from
`tests/integration/repo-root-acceptance.test.ts` verbatim, then add three describe groups.

**Harness (mirror `repo-root-acceptance.test.ts` exactly):**
```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const tsxBin = resolve(process.cwd(), 'node_modules', '.bin', 'tsx');   // LOCAL binary
const absIndex = resolve(process.cwd(), 'src/index.ts');                 // ABSOLUTE script path
const runCli = (args: string[], cwd: string) => {
  const r = spawnSync(tsxBin, [absIndex, ...args], { cwd, encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
};
const makeRepo = (): string => {
  const repo = mkdtempSync(join(tmpdir(), 'subcmd-repo-'));
  if (spawnSync('git', ['init', '-q', repo]).status !== 0) {
    rmSync(repo, { recursive: true, force: true });
    throw new Error('git init failed (is git installed?)');
  }
  return repo;
};
// Fixture: a discoverable session dir (NNN_<12hex>) + a minimal valid tasks.json.
const SESSION_DIR = '001_abcdef123456';
const makeSessionFixture = (repo: string, withTasksJson = true): void => {
  mkdirSync(join(repo, 'plan', SESSION_DIR), { recursive: true });
  if (withTasksJson) writeFileSync(join(repo, 'plan', SESSION_DIR, 'tasks.json'), '{"backlog":[]}');
  writeFileSync(join(repo, 'PRD.md'), '# Test PRD\n');
};
```

**Group A — each subcommand from a nested subdir resolves at the repo root (§9.8.7/§9.8.9):**
For each of `task`, `status`, `inspect`, `artifacts`, `cache`, `validate-state`: `makeRepo()` +
`makeSessionFixture(repo)` + nested dir `src/deep/nested`; `runCli([subcommand], join(repo,'src','deep','nested'))`.
- `task` (default list): `status === 0`; `stderr` contains `'Using main tasks'` AND `SESSION_DIR`.
- `status`: `status === 0`; `stderr` contains `'Using main tasks'`; `stdout` contains `'Task status summary'`.
- `inspect`: `status === 0`; `stdout` contains `SESSION_DIR` (found the repo-root session); `stdout`/`stderr`
  does NOT contain `'No sessions found'`.
- `artifacts`: `status === 0`; does NOT contain `'No sessions found'` (session found at repo root).
- `cache` (default stats): `status === 0` (operates against repo-root `plan/`).
- `validate-state`: `status` is NOT a PRD-path error — `stderr` does NOT contain `'Failed to validate PRD
  exists at'` with the nested-subdir path (the PRD resolves at the repo root). (Exact exit depends on the
  fixture's validation; assert the CONTRAPOSITIVE: no subdir-path PRD error.)

**Group B — outside any repo → clean NotARepositoryError (§9.8.5):**
`nonRepo = mkdtempSync(...)`. For `['task']`, `['status']`, `['validate-state']` (representative — the
hook fires for all subcommands): `runCli(args, nonRepo)`.
- `status === 1`; `stderr` contains `'No .git entry found'`; `stderr` contains `nonRepo` (searchedFrom);
  `stderr` contains `'--repo-root'`; `stderr` does NOT contain `'No sessions found'`; `stderr` does NOT
  match a stack trace (`/^\s*at /m` absent — the dedicated arm renders one line, no trace).

**Group C — §5.3 breakdown-in-progress synergy from a subdir:**
`makeRepo()` + `makeSessionFixture(repo, false)` (session DIR exists, NO `tasks.json`). `runCli(['status'],
join(repo,'src','deep','nested'))`.
- `status === 0`; `stderr` contains `'tasks.json is generated during PRD breakdown'` (the calm notice);
  `stderr` does NOT contain `'No sessions found'`.

### Success Criteria
- [ ] File `tests/integration/cli/subcommand-repo-root.test.ts` created with the 3 harness helpers
      (`tsxBin`/`absIndex`/`runCli`/`makeRepo`/`makeSessionFixture`) mirroring `repo-root-acceptance.test.ts`.
- [ ] Group A: all 6 subcommands from a nested subdir resolve at the repo root (per-subcommand assertions above).
- [ ] Group B: `task`/`status`/`validate-state` from a non-repo → exit 1 + `No .git entry found` +
      searchedFrom + `--repo-root`; NO stack trace; NO `No sessions found`.
- [ ] Group C: `status` from a subdir during breakdown-in-progress → exit 0 + the §5.3 calm notice, not `No sessions found`.
- [ ] All tests clean up tmpdirs (try/finally rmSync); `npm run typecheck && npm run lint && npm run format:check` clean.

---

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed?_ **Yes** — the exact
harness to copy (file:line), the verified per-subcommand output strings (`Using main tasks`,
`No sessions found`, the §5.3 notice), the session-discovery rule (dir-name-based `NNN_<12hex>`), the
minimal valid fixture (`{ "backlog": [] }`), the NotARepositoryError path proof (hook throws before the
action), and the executable validation commands are all below.

### Documentation & References

```yaml
# MUST READ — the spawnSync harness to MIRROR verbatim
- file: tests/integration/repo-root-acceptance.test.ts
  why: The hermetic subprocess pattern (tsxBin/absIndex/runCli/makeRepo) + real-tmpdir git fixtures +
        afterEach cleanup. T2.S1 copies these helpers EXACTLY and adds subcommand coverage.
  pattern: "const tsxBin = resolve(process.cwd(),'node_modules','.bin','tsx'); spawnSync(tsxBin,[absIndex,...args],{cwd,encoding:'utf8'})"
  gotcha: LOCAL tsx binary + ABSOLUTE src/index.ts path (not global `npx tsx` — flaky/online). The
          spawned cwd is controlled via options.cwd.

# MUST READ — the BUG-001 fix this task tests (S2 CONTRACT; assume LANDED)
- file: plan/009_94353b1a9fd3/bugfix/001_412283d974f7/P1M1T1S2/PRP.md
  why: S2's `program.hook('preAction', …)` bootstraps repo-root resolution + chdir before ANY action
        handler (root default + all subcommands). A hook-thrown NotARepositoryError propagates to
        main().catch()'s dedicated clean arm (index.ts:417) → `❌ <message>` + exit 1. T2.S1 proves this.
  critical: T2.S1 begins AFTER S2 lands. If a subcommand test hits `No sessions found` from a non-repo,
        S2's hook isn't wired — flag S2 sequencing (don't "fix" the test).

# MUST READ — design + verified subcommand behaviors (authored with this PRP)
- docfile: plan/009_94353b1a9fd3/bugfix/001_412283d974f7/P1M1T2S1/research/subcommand-integration-test-design.md
  section: "3. Subcommand behaviors" and "4. Session discovery" and "5. The NotARepositoryError path"
  why: The exact output strings to assert (Using main tasks / No sessions found / the §5.3 notice),
        why `{ "backlog": [] }` is a valid fixture (taskAction does JSON.parse, no Zod), why discovery
        is dir-name-based (no .prd_hash needed), and why the hook throw bypasses the action's try/catch.

# MUST READ — BUG-001 root cause + the §9.8.7/§9.8.9/§5.3 criteria
- docfile: plan/009_94353b1a9fd3/bugfix/001_412283d974f7/prd_snapshot.md
  section: "Critical Issues > Issue 1 (BUG-001)" and "Recommendations"
  why: The repro steps (the exact bug signatures T2.S1 asserts are FIXED) + the recommendation to "add
        an integration test that runs each subcommand from a nested subdirectory".

# READ-ONLY — the subcommand handlers (assertion sources)
- file: src/cli/index.ts
  why: taskAction (L619-800) — `Using main tasks` (L675, stderr chalk.cyan), `No sessions found` (L662,
        thrown), the §5.3 calm notice (L706, stderr chalk.cyan, exit 0). The .command registrations:
        task@826, status@836, inspect@472, artifacts@501, validate-state@528, cache@562. The hook S2
        adds before program.parse (~L853) is what makes these resolve at repo root.
  pattern: "sourceNote = `Using main tasks: ${relative(planDir, tasksFile)}`; … process.stderr.write(`${chalk.cyan(`[hack] ${sourceNote}`)}\n`)"
  gotcha: chalk wraps output in ANSI — assert via `toContain('Using main tasks')` (substring; no color
        boundary inside the phrase). taskAction does NOT Zod-validate tasks.json (JSON.parse + iterate).

- file: src/cli/commands/inspect.ts, artifacts.ts, validate-state.ts, cache.ts
  why: Each throws `new Error('No sessions found')` when plan/ has no session (inspect:212,
        artifacts:252, validate-state:207, cache:220). validate-state also validates the PRD (the
        pre-fix subdir `Failed to validate PRD exists at <subdir>/PRD.md` signature). Their constructor
        defaults `resolve('plan')`/`resolve('PRD.md')` are CORRECT post-hook (resolve runs post-chdir).

# READ-ONLY — the discovery rule
- file: src/core/session-manager.ts
  why: findLatestSession (L1570) → listSessions (L1507) → __scanSessionDirectories (L1429) scans plan/
        for `NNN_<12hex>` dirs (__parseSessionDirectory L1401). Dir-NAME-based — just `plan/001_abcdef123456/`
        existing makes it a found session; tasks.json absence = §5.3 calm-notice path. No `.prd_hash` needed.

# VERIFIED API SURFACE
- spawnSync(bin, args, { cwd, encoding:'utf8' }) → { status, stdout, stderr }.
- git CLI: `git init -q <dir>` (fixture repos; no commits needed for subcommand tests).
- chalk.cyan(...) — ANSI-wrapped; toContain(substring) matches the inner text.
```

### Current Codebase tree (relevant slice)

```bash
tests/integration/cli/
├── repo-root-semantics.test.ts              # EXISTING (S2's §9.8.9 f,g,h,i — reference)
└── subcommand-repo-root.test.ts             # ← T2.S1 CREATES (§9.8.7/§9.8.9 subcommand sweep)
tests/integration/repo-root-acceptance.test.ts  # EXISTING — harness to MIRROR (default-path + hard error)
# READ-ONLY (assertion sources / fix):
src/cli/index.ts                             # taskAction + .command registrations + the S2 hook
src/cli/commands/{inspect,artifacts,validate-state,cache}.ts  # command-class error strings
src/core/session-manager.ts                  # session discovery (dir-name based)
```

### Desired Codebase tree with files to be added/edited

```bash
tests/integration/cli/subcommand-repo-root.test.ts   # NEW (the ONLY file T2.S1 creates)
# No source. No docs. No other test files touched.
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — ALL tests are subprocess-based (spawnSync). Do NOT call parseCLIArgs in-process — that
//   would chdir the TEST process + leak the module singleton + need _resetBootstrap(). spawnSync is a
//   fresh process: hermetic, faithful (reproduces the timing bug end-to-end), no cleanup gymnastics.

// CRITICAL — use the LOCAL node_modules/.bin/tsx (absolute) + an ABSOLUTE src/index.ts path. Do NOT
//   use global `npx tsx` (online/flaky). The spawned cwd is controlled via spawnSync({cwd}).

// CRITICAL — the fixture `plan/001_abcdef123456/tasks.json` = `{ "backlog": [] }` is a VALID success
//   fixture for task/status: taskAction does JSON.parse + iterates data.backlog (NO Zod validation in
//   this path). Do NOT hand-craft a full Backlog — `{ "backlog": [] }` yields exit 0 + `Using main tasks`.

// CRITICAL — session discovery is dir-NAME-based (`NNN_<12hex>`). Just `plan/001_abcdef123456/` existing
//   makes it a found session. tasks.json ABSENCE (dir present) = the §5.3 calm-notice path. `.prd_hash`
//   is NOT required for findLatestSession (the bug-hunt repro mentioned it; the code doesn't need it).

// CRITICAL — chalk wraps output in ANSI codes. Assert via `toContain('<phrase>')` on a phrase with NO
//   color boundary INSIDE it (e.g. 'Using main tasks', 'No .git entry found', 'tasks.json is generated
//   during PRD breakdown'). Do NOT assert exact-equality on chalk'd lines.

// CRITICAL — outside-repo subcommand tests: the hook throws NotARepositoryError BEFORE the action body
//   → propagates to main().catch()'s dedicated arm (index.ts:417) → ONE clean line + exit 1. So stderr
//   = `No .git entry found...`, NOT `No sessions found` (the action never ran) and NOT a stack trace.
//   If you see `No sessions found`, S2's hook isn't wired — flag it.

// GOTCHA — the no-repo tmpdir must have NO .git ancestor. mkdtempSync(tmpdir()) (OS tmp, e.g. /tmp/xxx)
//   is safe in practice. Assert `!existsSync(join(nonRepo,'.git'))` as a sanity check.

// GOTCHA — validate-state's exact exit depends on the fixture's validation internals. Assert the
//   CONTRAPOSITIVE for it: stderr does NOT contain 'Failed to validate PRD exists at' + the nested
//   subdir path (the pre-fix bug signature). Don't over-couple to its success exit code.

// GOTCHA — Group A subcommands OTHER than task/status (inspect/artifacts/cache) may produce varied
//   output. The repo-root-resolution PROOF for them = they find the repo-root session (no 'No sessions
//   found') rather than failing against the subdir. Use the absence-of-bug-signature + presence-of-
//   session-id assertions; avoid coupling to per-command success-output details.

// GOTCHA — afterEach: rmSync(tmp, { recursive: true, force: true }) for EVERY tmpdir (repo, nonRepo,
//   worktree). Use try/finally so a failed assertion still cleans up. The subprocess doesn't change the
//   TEST process's cwd, so no process.cwd() restore is strictly needed — but it's belt-and-suspenders.

// GOTCHA — prettier is ERROR-enforced (prettier/prettier: error). Run `npm run fix` before format:check.

// GOTCHA — do NOT run the full `npm run test:run` as the gate (orthogonal pre-existing failures per the
//   bugfix architecture docs). Gate on: typecheck + lint + format:check + the new file + the existing
//   repo-root acceptance/semantics suites (regression).
```

---

## Implementation Blueprint

### Data models and structure
None — T2.S1 is a single test file. No types/classes/source. The "structure" is the 3 test groups +
the shared harness.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE tests/integration/cli/subcommand-repo-root.test.ts — harness + Group A (subcommands from subdir)
  - IMPORTS + the 4 helpers (tsxBin/absIndex/runCli/makeRepo) + makeSessionFixture — MIRROR
        repo-root-acceptance.test.ts verbatim (see "Technical requirements" harness block).
  - Group A describe('§9.8.7/§9.8.9 — subcommands from a nested subdir resolve at the repo root'):
      shared setup: makeRepo() + makeSessionFixture(repo) + nested = join(repo,'src','deep','nested')
      (mkdirSync recursive). One it() per subcommand:
        - it('task (list) resolves the repo-root session'): runCli(['task'], nested); expect status 0;
          expect stderr.toContain('Using main tasks'); expect stderr.toContain('001_abcdef123456').
        - it('status resolves the repo-root session'): runCli(['status'], nested); expect status 0;
          expect stderr.toContain('Using main tasks'); expect stdout.toContain('Task status summary').
        - it('inspect finds the repo-root session'): runCli(['inspect'], nested); expect status 0;
          expect (stdout+stderr).toContain('001_abcdef123456'); expect NOT 'No sessions found'.
        - it('artifacts operates against the repo-root session'): runCli(['artifacts'], nested);
          expect NOT 'No sessions found' (session found at repo root).
        - it('cache operates against the repo-root plan/'): runCli(['cache'], nested); expect status 0.
        - it('validate-state resolves the PRD at the repo root (not the subdir)'): runCli(['validate-state'], nested);
          expect stderr NOT toContain 'Failed to validate PRD exists at' + the nested path.
      Each it(): try { ... assertions ... } finally { rmSync(repo, { recursive: true, force: true }); }.
  - NAMING: it('<subcommand> <expected behavior from a subdir>').
  - PLACEMENT: tests/integration/cli/subcommand-repo-root.test.ts.

Task 2: ADD Group B (outside any repo → clean NotARepositoryError) to the same file
  - describe('§9.8.5 — subcommands outside any repo exit 1 with the clean message'):
      nonRepo = mkdtempSync(join(tmpdir(),'subcmd-norepo-')); sanity assert !existsSync(join(nonRepo,'.git')).
      One it() per representative subcommand (the hook fires for ALL):
        - it('hack task outside any repo'): runCli(['task'], nonRepo); expect status 1;
          expect stderr.toContain('No .git entry found'); expect stderr.toContain(nonRepo);
          expect stderr.toContain('--repo-root'); expect stderr NOT toContain('No sessions found');
          expect stderr.not.toMatch(/^\s*at /m) (no stack trace).
        - it('hack status outside any repo'): same assertions with ['status'].
        - it('hack validate-state outside any repo'): same assertions with ['validate-state'].
      finally rmSync(nonRepo).
  - NOTE: these prove the hook throw propagates to the dedicated arm (NOT the action's catch). If you see
        'No sessions found', S2's hook isn't wired — flag it.

Task 3: ADD Group C (§5.3 breakdown-in-progress synergy from a subdir) to the same file
  - describe('§5.3 — breakdown-in-progress calm notice works from a subdir'):
      repo = makeRepo(); makeSessionFixture(repo, false) (dir exists, NO tasks.json); nested subdir.
        - it('hack status from a subdir during breakdown prints the calm notice, not No sessions found'):
          runCli(['status'], nested); expect status 0;
          expect stderr.toContain('tasks.json is generated during PRD breakdown');
          expect stderr NOT toContain('No sessions found').
      finally rmSync(repo).

Task 4: FORMAT + VERIFY
  - RUN: npm run fix (lint:fix + prettier --write) → npm run typecheck → npm run lint → npm run format:check.
  - RUN: npx vitest run tests/integration/cli/subcommand-repo-root.test.ts (the new suite — all green).
  - RUN (regression): npx vitest run tests/integration/repo-root-acceptance.test.ts
        tests/integration/cli/repo-root-semantics.test.ts (stay green — unaffected).
  - EXPECTED: all green. If a Group A subcommand shows 'No sessions found' or a Group B case shows
        'No sessions found' (instead of 'No .git entry found'), S2's hook isn't wired — flag S2.
        If git init fails, confirm git is installed. If tsx isn't found, confirm node_modules/.bin/tsx exists.
```

### Implementation Patterns & Key Details

```ts
// ---- the harness (MIRROR repo-root-acceptance.test.ts) ----
const tsxBin = resolve(process.cwd(), 'node_modules', '.bin', 'tsx');
const absIndex = resolve(process.cwd(), 'src/index.ts');
const runCli = (args: string[], cwd: string) => {
  const r = spawnSync(tsxBin, [absIndex, ...args], { cwd, encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
};
const makeRepo = (): string => { /* mkdtempSync + git init -q; throw on git-init failure */ };
const SESSION_DIR = '001_abcdef123456';
const makeSessionFixture = (repo: string, withTasksJson = true) => {
  mkdirSync(join(repo, 'plan', SESSION_DIR), { recursive: true });
  if (withTasksJson) writeFileSync(join(repo, 'plan', SESSION_DIR, 'tasks.json'), '{"backlog":[]}');
  writeFileSync(join(repo, 'PRD.md'), '# Test PRD\n');
};

// ---- Group A: task/status from a nested subdir (the strongest signal) ----
it('status resolves the repo-root session from a nested subdir', () => {
  const repo = makeRepo();
  makeSessionFixture(repo);
  const nested = join(repo, 'src', 'deep', 'nested');
  mkdirSync(nested, { recursive: true });
  try {
    const { status, stderr, stdout } = runCli(['status'], nested);
    expect(status).toBe(0);
    expect(stderr).toContain('Using main tasks');     // only printed when plan/<session>/tasks.json was found
    expect(stderr).toContain(SESSION_DIR);             // the repo-root session id
    expect(stdout).toContain('Task status summary');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

// ---- Group B: outside any repo → clean NotARepositoryError (hook threw before the action) ----
it('hack task outside any repo exits 1 with the clean message (not No sessions found)', () => {
  const nonRepo = mkdtempSync(join(tmpdir(), 'subcmd-norepo-'));
  try {
    expect(existsSync(join(nonRepo, '.git'))).toBe(false);
    const { status, stderr } = runCli(['task'], nonRepo);
    expect(status).toBe(1);
    expect(stderr).toContain('No .git entry found');   // the dedicated arm, not the action's catch
    expect(stderr).toContain(nonRepo);                 // searchedFrom
    expect(stderr).toContain('--repo-root');           // remediation
    expect(stderr).not.toContain('No sessions found'); // the action never ran
    expect(stderr).not.toMatch(/^\s*at /m);            // no stack trace
  } finally {
    rmSync(nonRepo, { recursive: true, force: true });
  }
});

// ---- Group C: §5.3 calm notice from a subdir (session dir exists, no tasks.json) ----
it('hack status from a subdir during breakdown prints the calm notice', () => {
  const repo = makeRepo();
  makeSessionFixture(repo, false);                      // dir exists, NO tasks.json
  const nested = join(repo, 'src', 'deep', 'nested');
  mkdirSync(nested, { recursive: true });
  try {
    const { status, stderr } = runCli(['status'], nested);
    expect(status).toBe(0);
    expect(stderr).toContain('tasks.json is generated during PRD breakdown');
    expect(stderr).not.toContain('No sessions found');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
```

### Integration Points

```yaml
DEPENDS ON (must be LANDED before T2.S1 is correct):
  - P1.M1.T1.S2 (the preAction hook — the BUG-001 fix): CONTRACT (parallel). The hook bootstraps
        repo-root resolution + chdir before every action handler. Without it, Group A fails (subcommands
        resolve against the subdir) and Group B shows 'No sessions found' (not 'No .git entry found').
        The orchestrator sequences S2 before T2.S1; if a test reveals the un-fixed behavior, flag S2.

REFERENCES (consume, don't duplicate):
  - tests/integration/repo-root-acceptance.test.ts: the harness to MIRROR + the default-path §9.8.9
        acceptance (criteria a–e + child inheritance). T2.S1 adds the SUBCOMMAND sweep.
  - tests/integration/cli/repo-root-semantics.test.ts (S2): §9.8.9 criteria f,g,h,i (--repo-root +
        explicit/default --prd semantics). T2.S1 does not duplicate those.

NO SOURCE/DOCS CHANGE: T2.S1 is test-only (the item's "DOCS: none"). The fix is S2; T2.S1 proves it.
NO OTHER INTEGRATION: the suite is hermetic (subprocess + real tmpdirs). It does not touch the pipeline,
  agents, or sessions at runtime — only the CLI's repo-root bootstrap + subcommand dispatch.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run fix                  # lint:fix + prettier --write (run first)
npm run typecheck            # tsc --noEmit -p tsconfig.build.json — clean
npm run lint                 # eslint . --ext .ts — clean
npm run format:check         # prettier --check — clean
# Expected: all clean. If lint flags an unused import, prune it. prettier nits → re-run `npm run fix`.
```

### Level 2: The new suite (the deliverable)

```bash
npx vitest run tests/integration/cli/subcommand-repo-root.test.ts
# Expected: all green (Group A ×6 + Group B ×3 + Group C ×1). If Group A shows 'No sessions found' or
#   Group B shows 'No sessions found' (instead of 'No .git entry found'), S2's hook isn't wired — flag S2.
#   If git init / tsx fails, confirm the toolchain is present.
```

### Level 3: Regression (existing repo-root suites stay green)

```bash
npx vitest run tests/integration/repo-root-acceptance.test.ts tests/integration/cli/repo-root-semantics.test.ts
# Expected: both green (T2.S1 doesn't touch them). Confirms the new file is merge-safe.
# Do NOT run the full `npm run test:run` as the gate — orthogonal pre-existing failures (per the bugfix
#   architecture docs). Gate on typecheck + lint + format:check + the new file + these two regression files.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# No MCP/DB/HTTP surface (subprocess CLI invocations against real tmpdirs). Domain checks (record in commit):
#   - All 6 subcommands from src/deep/nested resolve plan/PRD.md at the repo root (§9.8.7/§9.8.9).
#   - Outside-repo task/status/validate-state → the dedicated NotARepositoryError arm (§9.8.5), NOT the
#     action's 'No sessions found' (the hook threw before the action ran) and NOT a stack trace.
#   - §5.3 breakdown-in-progress calm notice fires from a subdir (not the scary 'No sessions found').
#   - The fixture { "backlog": [] } is valid (taskAction does JSON.parse, no Zod); discovery is dir-name-based.
#   - All tmpdirs cleaned (try/finally rmSync); subprocess = fresh process (no singleton leakage).
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` clean.
- [ ] `npm run lint` clean.
- [ ] `npm run format:check` clean.
- [ ] `npx vitest run tests/integration/cli/subcommand-repo-root.test.ts` green.
- [ ] `npx vitest run tests/integration/repo-root-acceptance.test.ts tests/integration/cli/repo-root-semantics.test.ts` green (regression).

### Feature Validation
- [ ] Group A: all 6 subcommands (task/status/inspect/artifacts/cache/validate-state) from a nested
      subdir resolve plan/PRD.md at the repo root (per-subcommand assertions).
- [ ] Group B: `task`/`status`/`validate-state` from a non-repo → exit 1 + `No .git entry found` +
      searchedFrom + `--repo-root`; NO `No sessions found`; NO stack trace.
- [ ] Group C: `status` from a subdir during breakdown-in-progress → exit 0 + the §5.3 calm notice,
      NOT `No sessions found`.

### Code Quality Validation
- [ ] ONLY `tests/integration/cli/subcommand-repo-root.test.ts` created (no source, no docs).
- [ ] Harness (`tsxBin`/`absIndex`/`runCli`/`makeRepo`) MIRRORS `repo-root-acceptance.test.ts` (LOCAL tsx
      binary + ABSOLUTE script path; NOT global `npx tsx`).
- [ ] ALL tests subprocess-based (spawnSync) — no in-process `parseCLIArgs`, no `_resetBootstrap()`.
- [ ] Every tmpdir cleaned via try/finally `rmSync(..., { recursive: true, force: true })`.
- [ ] Assertions use `toContain` (chalk ANSI-wraps output; no exact-equality on colored lines).
- [ ] Fixture `{ "backlog": [] }` + dir-name-based session discovery (no over-engineered Backlog, no `.prd_hash`).

### Documentation & Deployment
- [ ] No docs change (test-only — matches the item's "DOCS: none").
- [ ] Commit message notes: closes the integration-test gap that let BUG-001 ship; proves §9.8.7/§9.8.9
      for all 6 subcommands from a subdir + §9.8.5 outside-repo + §5.3 synergy; depends on S2's hook.

---

## Anti-Patterns to Avoid

- ❌ Don't call `parseCLIArgs` in-process — it chdirs the TEST process + leaks the module singleton + needs
      `_resetBootstrap()`. Use `spawnSync` (fresh process; hermetic; reproduces the timing bug faithfully).
- ❌ Don't use global `npx tsx` — use the LOCAL `node_modules/.bin/tsx` (absolute) + ABSOLUTE `src/index.ts`
      path. Global npx is online/flaky.
- ❌ Don't hand-craft a full `Backlog` fixture — `{ "backlog": [] }` is valid for task/status (taskAction
      does `JSON.parse` + iterate; no Zod in that path). Keep fixtures minimal.
- ❌ Don't require `.prd_hash` for the session fixture — discovery is dir-NAME-based (`NNN_<12hex>`); just
      `plan/001_abcdef123456/` existing makes it a found session.
- ❌ Don't assert exact-equality on chalk'd output lines — ANSI codes wrap them. Use `toContain('<phrase>')`
      on a phrase with no internal color boundary.
- ❌ Don't over-couple to `validate-state`'s / `inspect`'s / `artifacts`'s / `cache`'s success-output
      details — assert the repo-root-resolution PROOF (no subdir-path error / no `No sessions found` /
      presence of the repo-root session id), not per-command formatting.
- ❌ Don't "fix" a test that reveals `No sessions found` from a non-repo by tweaking the assertion — that
      means S2's hook isn't wired. Flag the S2 sequencing; don't mask the bug.
- ❌ Don't edit any source file — T2.S1 is test-only (S2 is the fix; T2.S1 proves it). No docs either.
- ❌ Don't duplicate §9.8.9 f/g/h/i — they're S2's `repo-root-semantics.test.ts`. T2.S1 covers the
      subcommand sweep + outside-repo + §5.3 synergy.
- ❌ Don't run the full `npm run test:run` as the gate — orthogonal pre-existing failures. Gate on
      typecheck + lint + format:check + the new file + the two repo-root regression files.
- ❌ Don't leave tmpdirs behind on a failed assertion — wrap every test body in try/finally rmSync.

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: This is a single new test file mirroring an existing, verified hermetic harness
(`repo-root-acceptance.test.ts` — same `tsxBin`/`absIndex`/`runCli`/`makeRepo` helpers). The
per-subcommand output strings are verified in-repo (`Using main tasks` @cli/index.ts:675,
`No sessions found` @inspect/artifacts/validate-state/cache, the §5.3 calm notice @cli/index.ts:706).
The session-discovery rule (dir-name-based `NNN_<12hex>`) and the minimal valid fixture
(`{ "backlog": [] }`, no Zod in taskAction) are confirmed. The NotARepositoryError path (hook throws
before the action → dedicated main().catch() arm) is proven by S2's design. The subprocess approach is
inherently hermetic (fresh process per test; no singleton leakage; no `_resetBootstrap()`). The one
sequencing dependency (S2's hook must be LANDED) is explicitly flagged with a "flag, don't mask" rule.
Residual risks: (a) the exact exit code / output of inspect/artifacts/cache/validate-state from a subdir
may vary — mitigated by asserting the CONTRAPOSITIVE (no subdir-path bug signature) + the strong
`Using main tasks` signal for task/status; (b) a prettier nit (auto-fixed via `npm run fix`); (c) git/tsx
availability in the test env (standard). No external/runtime unknowns.