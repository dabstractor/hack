# PRP — P3.M1.T1.S1: Breakdown-in-progress detection + calm notice across all discovery-based actions

---

## Goal

**Feature Goal**: Eliminate the scary `ERROR: … Task command failed: ENOENT: no
such file or directory, open '…/tasks.json'` (with request id + stack trace) that
the `task` / `status` / `task next` subcommands emit during the legitimate
**breakdown-in-progress window** (PRD §5.3 "Tasks-Not-Yet-Generated Window"):
when the SessionManager has created `plan/NNN_hash/` (with `.prd_hash`) but the
Architect Agent has not yet written `tasks.json`. Instead, the command must
**detect** this state (auto-resolved tasks.json absent AND session dir exists),
emit a **single calm human-readable notice to stderr** (or a structured
`{ "status": "awaiting_breakdown", "session": "NNN_hash" }` object to stdout
under `--output json`), and **exit 0**. Explicit `--file <path>` overrides and the
"no sessions at all" path remain **hard errors** (exit non-zero). This closes
Milestone **P3.M1** and **Phase P3**.

**Deliverable** (Mode A — docs ride with the work):
1. **`src/cli/index.ts`** — MODIFY the shared `taskAction` handler (lines 554-782):
   - **ADD `existsSync` to the `node:fs` import** (line 30) and **`dirname` to the
     `node:path` import** (line 31).
   - **INSERT a breakdown-in-progress existence check** AFTER the tasksFile-
     resolution block (after line 612) and BEFORE the sourceNote-printing block
     (line 614), gated on `!options.file`. When `existsSync(tasksFile) === false &&
     existsSync(dirname(tasksFile)) === true`: (a) suppress the sourceNote; (b)
     under `--output json`, `console.log(JSON.stringify({ status:
     'awaiting_breakdown', session: basename(dirname(tasksFile)) }, null, 2))`;
     (c) else `process.stderr.write` a calm `[hack]` notice whose wording differs
     for `action === 'next'` ("no tasks available yet (breakdown in progress)")
     vs list/status ("tasks.json is generated during PRD breakdown and is not
     available yet — re-run shortly, or run `hack --continue` to (re)generate
     it."); (d) `process.exit(0)`.
2. **`tests/unit/cli/index.test.ts`** — ADD `vi.mock('../../../src/core/
   session-manager.js', …)` + `vi.mock('../../../src/core/session-utils.js', …)`
   (hoisted), then a `describe('breakdown-in-progress (PRD §5.3)', …)` block
   covering all five PRD §5.3 acceptance criteria + the 100%-coverage branches.
3. **`docs/CLI_REFERENCE.md`** — MODIFY the `### Task Management` subsection
   (lines 172-200): document the breakdown-in-progress state, its calm notice,
   its exit code 0, the `--output json` `awaiting_breakdown` object, and note
   that explicit `--file` + no-sessions paths remain hard errors.

**Success Definition**:
- `hack status` against a session whose directory exists but whose `tasks.json`
  is absent → prints the calm notice to **stderr**, exits **0**, with **no**
  `ERROR` / `ENOENT` / request id / stack trace on stdout.
- `hack task` and `hack task next` behave identically for the same state (`next`'s
  wording says "no tasks available yet (breakdown in progress)").
- `hack status --output json` → stdout emits
  `{ "status": "awaiting_breakdown", "session": "NNN_hash" }`, exits 0.
- `hack status --file /nonexistent/tasks.json` still exits non-zero (explicit
  override NOT softened).
- `hack status` with **no sessions at all** still exits non-zero with the existing
  "No sessions found" message — the two empty states are distinguished.
- `npm run validate` GREEN; 100% coverage on `src/**/*.ts` preserved.

---

## User Persona (if applicable)

**Target User**: Pipeline operator / CI script / shell alias polling `hack status`
while a run warms up.
**Use Case**: A user runs `hack status` (or a CI poll loop does) during the few
seconds between session-dir creation and tasks.json being written by the Architect
Agent. Today they get a scary ERROR + stack trace implying breakage; they should
get a calm "breakdown in progress, re-run shortly" notice + exit 0.
**User Journey**: `hack` starts → SessionManager creates `plan/001_hash/` +
`.prd_hash` → user runs `hack status` → **calm notice, exit 0** → Architect
finishes → tasks.json written → user re-runs `hack status` → normal task list.
**Pain Points Addressed**: The scary ENOENT error breaks shell scripts/prompts/
aliases that poll `hack status` (non-zero exit aborts `&&` chains); the stack
trace + request id misleads users into thinking the pipeline is broken when it's
just mid-breakdown.

---

## Why

- **PRD compliance**: PRD §5.3 "Tasks-Not-Yet-Generated Window (Breakdown-in-
  Progress)" mandates detection + calm notice + exit 0 for auto-resolved missing
  tasks.json, with five explicit acceptance criteria.
- **Closes P3.M1 + Phase P3**: item 4 OUTPUT — "Completes Milestone P3.M1 and
  Phase P3."
- **UX**: Non-zero exit on a valid transient state breaks `hack status &&
  do_something` patterns and alarms operators; a calm notice + exit 0 is correct.
- **Discovery-only scope**: PRD §5.3 "Scope — discovery only" — the graceful path
  applies EXCLUSIVELY to auto-resolved tasks files; an explicit `--file` pointing
  at a missing file is a real user mistake (hard error preserved).

### Out of scope (hard fences)
- **The `--file` override path** (cli/index.ts:580) → UNCHANGED. The breakdown
  check is gated on `!options.file`, so explicit overrides still hard-error.
- **The "No sessions found" path** (findLatestSession → null → throw at line 596)
  → UNCHANGED. That throw fires ABOVE the insertion point.
- **The "Session not found" path** (`--session` no match, line 590-592) → UNCHANGED.
- **Present-but-corrupt tasks.json** (JSON.parse fails, line 623) → UNCHANGED;
  this is NOT breakdown-in-progress (the file EXISTS). Does NOT trigger §5.1
  corruption-recovery (orchestrator-runtime; this is read-only CLI).
- **§4.4 interrupted-bugfix re-entry** → NOT triggered. A simply-absent
  tasks.json on a read-only `status` query is REPORTED, not "repaired."
- **The action branches** (`next`/`status`/list logic) → UNCHANGED. Only the
  pre-readFile existence check is added.
- **`PRD.md` / `tasks.json` / `prd_snapshot.md` / `vitest.config.ts` /
  `session-manager.ts` / `session-utils.ts`** → READ-ONLY (S1 only consumes them
  via the existing dynamic imports).

---

## What

### User-visible behavior

```bash
# Session dir exists, tasks.json absent (breakdown in progress):
$ hack status
[hack] Session 001_14b9dc2a33c7: tasks.json is generated during PRD breakdown and
is not available yet — re-run shortly, or run `hack --continue` to (re)generate it.
$ echo $?
0

$ hack task next
[hack] Session 001_14b9dc2a33c7: no tasks available yet (breakdown in progress).
$ echo $?
0

$ hack status --output json
{
  "status": "awaiting_breakdown",
  "session": "001_14b9dc2a33c7"
}
$ echo $?
0

# Explicit --file override pointing at a missing file → STILL a hard error:
$ hack status --file /nonexistent/tasks.json
ERROR: Task command failed: ENOENT: no such file or directory, open '/nonexistent/tasks.json'
$ echo $?
1

# No sessions at all → STILL a hard error (distinct empty state):
$ hack status
ERROR: Task command failed: No sessions found. Run the pipeline first or use --file / --session.
$ echo $?
1
```

### Technical requirements (exact contract — item 3)

**(a) Imports (cli/index.ts lines 30-31).** ADD `existsSync` to the `node:fs`
import and `dirname` to the `node:path` import:
```ts
import { readFileSync, existsSync } from 'node:fs';
import { resolve, relative, dirname } from 'node:path';
```

**(b) The breakdown-in-progress check (cli/index.ts, insert AFTER line 612 /
BEFORE line 614).** Inside the `taskAction` handler, after the tasksFile-
resolution if/else block and BEFORE the sourceNote-printing block. Gated on
`!options.file` (discovery-only):

```ts
// PRD §5.3 "Tasks-Not-Yet-Generated Window": if the AUTO-RESOLVED tasks file is
// absent solely because the session dir exists but tasks.json hasn't been
// generated yet (breakdown in progress / interrupted breakdown), emit a calm
// notice and exit 0 instead of a scary ENOENT error. Gated on the DISCOVERY
// path only — an explicit --file override pointing at a missing file remains a
// hard error (real user mistake). dirname(tasksFile) is the session dir for
// both the main-session fallback and the (theoretical) bugfix tier.
if (!options.file && !existsSync(tasksFile) && existsSync(dirname(tasksFile))) {
  const sessionId = basename(dirname(tasksFile));  // 'NNN_hash'
  if (options.output === 'json') {
    console.log(JSON.stringify({ status: 'awaiting_breakdown', session: sessionId }, null, 2));
  } else {
    const notice =
      action === 'next'
        ? `[hack] Session ${sessionId}: no tasks available yet (breakdown in progress).`
        : `[hack] Session ${sessionId}: tasks.json is generated during PRD breakdown and is not available yet — re-run shortly, or run \`hack --continue\` to (re)generate it.`;
    process.stderr.write(`${chalk.cyan(notice)}\n`);
  }
  process.exit(0);
}
```

(`basename` is already imported — used elsewhere; verify it's in the `node:path`
import. If not, add it. Check: line 31 currently `import { resolve, relative }`.
`basename` is NOT imported — ADD it: `import { resolve, relative, dirname, basename
} from 'node:path';`.)

**PLACEMENT RATIONALE**: Insert BEFORE the sourceNote-printing block (614-620) so
the breakdown path `process.exit(0)`s before the self-contradictory "Using main
tasks: …" note can print (PRD §5.3: "This notice replaces the sourceNote"). The
sourceNote block is only reached on the normal (file-exists) path.

**EXIT SEMANTICS**: `process.exit(0)` inside the `if` — when the mocked exit
THROWS `'process.exit(0)'` (test mode), the catch block (717-723) is entered.
**GOTCHA**: the catch block calls `logger().error(...)` + `process.exit(1)`. In
TESTS this means the breakdown path's `process.exit(0)` throw is caught and the
catch re-throws `process.exit(1)`. **To handle this in tests**, either (i) make
the exit mock a no-op `vi.fn()` (not a thrower) for the breakdown tests so control
flow continues past exit(0) and falls through to readFile — but then readFile
returns the mocked backlog (wrong path); OR (ii) make the exit mock throw
`'process.exit(0)'` and assert the catch block's re-exit — but that double-exits.
**CLEANEST test approach**: the exit mock throws `'process.exit(N)'`, and since
the breakdown path throws FIRST (at the breakdown `process.exit(0)`), the catch
block is entered with that thrown error. The catch's `process.exit(1)` then
throws `'process.exit(1)'`. So `expect(() => ...).toThrow('process.exit(1)')` is
what you'd see — which masks the real exit code. **RESOLUTION**: In the breakdown
tests, override `process.exit` to a NO-OP `vi.fn()` (mirroring the alias block at
line 793-794) and assert `mockExit` was called with `0`. Because exit is a no-op,
control flows PAST the breakdown `process.exit(0)` to the sourceNote block (which
is suppressed for json, or prints for non-json — but we're in the breakdown path,
so... wait, the breakdown `process.exit(0)` is INSIDE the `if`; if exit is a
no-op, execution CONTINUES past it to sourceNote + readFile). **THIS IS A PROBLEM.**

**RESOLUTION (final)**: The breakdown path must NOT fall through. Two options:
(A) Make the breakdown block `return;` after `process.exit(0)` (so even if exit
is a no-op in tests, control returns from the handler and doesn't reach
readFile). `process.exit(0); return;` is safe (the `return` is unreachable in
prod but stops test fall-through). This is the standard pattern for this kind of
early-exit-under-mocked-exit. **USE option (A): `process.exit(0); return;`.**

**(c) Action-specific wording.** Per contract item 3e: `next` says "no tasks
available yet (breakdown in progress)"; list/status say the longer message. JSON
emits the same `{ status, session }` object for all three actions.

**(d) Tests (tests/unit/cli/index.test.ts).** Add two module-level mocks + a
describe block:

```ts
// At top, alongside the existing vi.mock blocks:
const { mockFindLatestSession, mockListSessions } = vi.hoisted(() => ({
  mockFindLatestSession: vi.fn(),
  mockListSessions: vi.fn(),
}));
vi.mock('../../../src/core/session-manager.js', () => ({
  SessionManager: Object.assign(class {}, {
    findLatestSession: mockFindLatestSession,
    listSessions: mockListSessions,
  }),
}));
const { mockFindLatestBugfixTasksFile } = vi.hoisted(() => ({
  mockFindLatestBugfixTasksFile: vi.fn(async () => null),
}));
vi.mock('../../../src/core/session-utils.js', () => ({
  findLatestBugfixTasksFile: mockFindLatestBugfixTasksFile,
}));
```

Then a `describe('breakdown-in-progress (PRD §5.3)', …)` block with cases (use a
no-op `process.exit` mock + `await new Promise(r => setImmediate(r))` to let the
async tail resolve, mirroring the alias block at lines 793-868):
1. **`hack status` (breakdown state)**: mockFindLatestSession returns
   `{ path: '/plan/001_abc', id: '001_abc', hash: 'abc' }`;
   mockExistsSync → `p.endsWith('tasks.json') ? false : true`. Assert
   `mockExit` called with `0`; capture stderr (spy on process.stderr.write) and
   assert it contains "breakdown" + "001_abc" + "tasks.json is generated during
   PRD breakdown"; assert stdout (console.log spy) has NO ENOENT/ERROR/stack.
2. **`hack status --output json` (breakdown state)**: assert console.log called
   with `JSON.stringify({ status: 'awaiting_breakdown', session: '001_abc' })`;
   `mockExit` called with 0.
3. **`hack status --file /nonexistent` → exit 1 (NOT softened)**: options.file
   set → breakdown check gated off → readFile rejects ENOENT → catch → exit 1.
   Mock readFile to reject ENOENT; assert throws 'process.exit(1)' (use the
   throwing exit mock here, or assert mockExit called with 1 + error logged).
4. **No sessions**: mockFindLatestSession → null → throws 'No sessions found' →
   catch → exit 1.
5. **`hack task` + `hack task next` identical**: both exit 0; `next` stderr
   contains "no tasks available yet (breakdown in progress)".
6. **(coverage) Normal path (tasks.json EXISTS)**: mockExistsSync → true (file
   present) → breakdown check skipped → sourceNote prints → readFile returns
   backlog → exit 0. Exercises the `existsSync(tasksFile) === true` negation
   branch + the `!options.file` false... actually `!options.file` is true here
   (discovery), so it exercises the inner `existsSync` false-branch.

**Process.exit mock strategy per sub-block**: Use a NO-OP `vi.fn()` for breakdown
cases (so control flows to the `return` after `process.exit(0)` in option A) and
assert `mockExit` called with 0. For hard-error cases (--file / no-sessions), use
the throwing exit mock OR assert `mockExit` called with 1. Define a per-block
`beforeEach` that sets the appropriate exit mock (mirror the alias block).

### Success Criteria
- [ ] `hack status` (session exists, no tasks.json) → calm stderr notice, exit 0,
      no ERROR/ENOENT/stack on stdout.
- [ ] `hack task` + `hack task next` identical; `next` says "no tasks available
      yet (breakdown in progress)".
- [ ] `hack status --output json` → `{ "status": "awaiting_breakdown", "session":
      "NNN_hash" }` on stdout, exit 0.
- [ ] `hack status --file /nonexistent` → exit non-zero (hard error preserved).
- [ ] No sessions → exit non-zero with "No sessions found" (distinct empty state).
- [ ] `npm run validate` GREEN; 100% coverage on `src/**/*.ts` preserved.

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_
**Yes.** This is a 3-file change (one CLI handler + its test + one doc section).
Its correctness hinges on ten pre-proven facts, all pinned with file:line anchors
below: (1) the **exact insertion point** — after the tasksFile-resolution if/else
(cli/index.ts:577-612) and BEFORE the sourceNote-printing block (614-620), so the
breakdown `process.exit(0)` short-circuits before the self-contradictory
"Using main tasks: …" prints; (2) the **gating rule** — the check is gated on
`!options.file` so the explicit `--file` override path (line 580) is NOT softened
(PRD §5.3 "Scope — discovery only"); (3) the **detection predicate** —
`existsSync(tasksFile) === false && existsSync(dirname(tasksFile)) === true`,
which works uniformly for the main-session fallback AND the bugfix tier without
`sessionPath`-scoping gymnastics; (4) the **`existsSync` import gap** — line 30
imports `readFileSync` but NOT `existsSync` (must add); `dirname`/`basename` also
not in the `node:path` import (line 31 imports only `resolve, relative`); (5) the
**sourceNote-replacement rule** — inserting BEFORE line 614 means the breakdown
path exits before sourceNote prints (PRD §5.3: "This notice replaces the
sourceNote"); (6) the **test-fall-through problem** — `process.exit(0)` mocked as
a no-op lets control flow past it to readFile; FIX with `process.exit(0); return;`
(the `return` is unreachable in prod but stops test fall-through); (7) the
**existing test mocks** — `node:fs` (existsSync overridable per-test, line 24-32),
`node:fs/promises` (readFile returns backlog, line 38) are ALREADY in place; only
`session-manager.js` + `session-utils.js` dynamic-import mocks are NEW; (8) the
**hard-error paths preserved** — `--file` (580, gated off by `!options.file`),
no-sessions (596 throw, ABOVE insertion), Session-not-found (590), corrupt-file
(623 JSON.parse) all UNCHANGED; (9) the **action-specific wording** — `next` says
"no tasks available yet (breakdown in progress)", list/status say the longer
message, JSON is identical for all; (10) **100% branch coverage** — every new
branch (`!options.file` true/false, existsSync true/false, output json/else,
action next/else) has a designated test.

### Documentation & References
```yaml
# MUST READ — the PRD spec (already provided in selected_prd_content)
- docfile: PRD.md
  section: "5.3 Task Management → Tasks-Not-Yet-Generated Window (Breakdown-in-Progress)" (h3.11)
       + the 5 acceptance criteria bullets.
  why: The ENTIRE normative rule S1 implements — detection, message (stderr),
       json object, exit 0, scope (discovery only), all-discovery-actions,
       distinct-from-recovery, and the 5 acceptance criteria.
  critical: exit code is 0 (observation, not failure); explicit --file + no-sessions
            paths remain HARD errors (the two empty states are distinguished).

# MUST READ — this subtask's research (proven facts about the working tree)
- docfile: plan/009_94353b1a9fd3/P3M1T1S1/research/s1-codebase-analysis.md
  section: §1 (insertion point + sessionPath scoping), §2 (existsSync import),
       §3 (next-action wording), §4 (detection predicate + dirname), §5 (unchanged
       hard-error paths), §6 (exit/stream semantics + sourceNote ordering), §7
       (test strategy + new mocks), §8 (coverage branches), §9 (scope fences),
       §10 (validation commands)
  why: Proves every edit site, the dirname-based predicate (avoids scoping), the
       sourceNote-ordering fix, the test-fall-through `return` fix, and the exact
       test mock wiring.

# MUST READ — architecture reference (cited by the contract's RESEARCH NOTE)
- docfile: plan/009_94353b1a9fd3/architecture/session-and-tasks-json.md
  section: §3 (taskAction EXACT flow with line anchors), §4 (recovery DISTINCT),
       §6 (exit codes), §8 (NO existence check before readFile)
  why: Confirms the exact line numbers, the absence of the pre-readFile check, the
       catch-block exit(1)-for-all behavior, and that recovery is for present-but-
       corrupt (distinct from simply-absent).

# THE FILE TO EDIT (CLI handler)
- file: src/cli/index.ts
  section: taskAction handler (lines 554-782). Three edits:
       (1) imports (lines 30-31): +existsSync to node:fs; +dirname, basename to node:path;
       (2) INSERT breakdown check AFTER line 612 (end of tasksFile resolution) and
           BEFORE line 614 (sourceNote print); gated on !options.file; uses
           existsSync(tasksFile) + existsSync(dirname(tasksFile));
       (3) the breakdown block: json branch (console.log) vs human branch
           (process.stderr.write + chalk.cyan), action==='next' wording variant,
           process.exit(0); return;  (the return prevents test fall-through).
  why: This is the single shared handler for task/status/task next (all three get
       the graceful degradation for free).
  pattern: the existing sourceNote block (614-620) writes to stderr with
       chalk.cyan('[hack] …'); mirror it. The existing json branches (next:655,
       status:689) use console.log(JSON.stringify(...)); mirror them.
  gotcha: do NOT soften the --file path (gate on !options.file). do NOT print the
       sourceNote for this state (insert BEFORE the sourceNote block). do NOT
       trigger §5.1 recovery or §4.4 re-entry. do NOT change the action branches.
       Use process.exit(0); return;  so the no-op-exit test mock doesn't fall through.

# THE FILE TO EDIT (tests)
- file: tests/unit/cli/index.test.ts
  section: ADD two vi.mock blocks (session-manager.js, session-utils.js) at the top
       alongside the existing mocks; ADD a describe('breakdown-in-progress
       (PRD §5.3)') block (sibling to the 'prd status alias' block at line 779).
  why: Locks the 5 acceptance criteria + covers all new branches for 100% coverage.
  pattern: the existing 'prd status alias' block (779-868) — no-op process.exit mock
       in beforeEach + setArgv([...]) + parseCLIArgs() + await setImmediate + assert
       mockExit called with N. Mirror it. For stderr/stdout assertions, spy on
       process.stderr.write / console.log via vi.spyOn.
  gotcha: taskAction dynamically imports session-manager.js + session-utils.js —
       you MUST vi.mock BOTH or the real modules run (hit real FS / fail). Use
       vi.hoisted for the mock fns so per-test override works. The no-op exit mock
       is REQUIRED for breakdown cases (else the catch block's exit(1) masks exit(0));
       the `return` after process.exit(0) in the source prevents fall-through to
       readFile. For hard-error cases (--file / no-sessions) use the throwing exit
       mock OR assert mockExit called with 1.

# THE FILE TO EDIT (docs — Mode A, rides with the work)
- file: docs/CLI_REFERENCE.md
  section: "### Task Management" (lines 172-200). ADD a paragraph + a note row
       documenting the breakdown-in-progress state.
  why: PRD/contract item 6 DOCS requires documenting the state + exit code 0;
       Mode A rides with the work.
  pattern: the existing subsection uses a command table + options table + fenced
       bash example. ADD a short paragraph after the example block.
  gotcha: note that explicit --file + no-sessions remain hard errors (exit non-zero).

# CONTRACT INPUTS (read-only — owned by other layers)
- file: src/core/session-manager.ts
  section: findLatestSession (1573-1596, null sentinel); listSessions (1497-1555).
  why: Confirms findLatestSession returns null (no-sessions path throws ABOVE the
       insertion point) and SessionMetadata.path/id/hash shapes for test fakes.
  gotcha: READ-ONLY for S1 (do not edit).

- file: src/core/session-utils.ts
  section: findLatestBugfixTasksFile (916-970).
  why: Returns null when no bugfix tasks.json → bugfix tier never reaches the
       absent-tasksFile state in practice (but the dirname-based predicate handles
       it uniformly anyway).
  gotcha: READ-ONLY for S1.

- file: vitest.config.ts
  section: coverage.include = ['src/**/*.ts']; thresholds 100/100/100/100.
  why: Confirms the new branches are coverage-gated.
- file: package.json
  why: npm run validate = lint + format:check + typecheck + test:run (the green gate).
```

### Current Codebase tree (relevant slice)
```bash
src/
  cli/
    index.ts                  # EDIT — +existsSync/dirname/basename imports, +breakdown check in taskAction
  core/
    session-manager.ts        # READ-ONLY — findLatestSession (null sentinel), SessionMetadata
    session-utils.ts          # READ-ONLY — findLatestBugfixTasksFile
tests/
  unit/
    cli/
      index.test.ts           # EDIT — +session-manager/session-utils mocks, +describe('breakdown-in-progress')
docs/
  CLI_REFERENCE.md            # EDIT — ### Task Management subsection (+breakdown-in-progress paragraph)
vitest.config.ts              # READ-ONLY — 100% coverage thresholds
package.json                  # READ-ONLY — npm run validate gate
PRD.md                        # READ-ONLY — §5.3 (h3.11) source of truth
```

### Desired Codebase tree with files to be added and responsibility of file
```bash
src/cli/index.ts             # MODIFIED — breakdown-in-progress detection + calm notice + exit 0
tests/unit/cli/index.test.ts # MODIFIED — +2 module mocks, +describe block (5 acceptance criteria + coverage)
docs/CLI_REFERENCE.md        # MODIFIED — ### Task Management subsection documents the state
# (no NEW files)
```

### Known Gotchas of our codebase & Library Quirks
```ts
// CRITICAL (insertion ordering): insert the breakdown check BEFORE the sourceNote-
// printing block (cli/index.ts:614-620), NOT after. If inserted after, the self-
// contradictory "Using main tasks: …" prints before the calm notice (PRD §5.3:
// "This notice replaces the sourceNote"). The breakdown process.exit(0) must
// short-circuit before sourceNote prints.
// CRITICAL (gating): gate the check on `!options.file`. The explicit --file
// override path (line 580) MUST remain a hard error — a user asking for a
// specific missing file made a real mistake, not a transient state (PRD §5.3
// "Scope — discovery only").
// CRITICAL (test fall-through): process.exit is mocked (no-op or thrower) in
// tests. If exit is a no-op and the breakdown block is just `process.exit(0);`,
// control flows PAST it to sourceNote + readFile (wrong path). FIX with
// `process.exit(0); return;` — the `return` is unreachable in prod (exit never
// returns) but stops the no-op-exit test from falling through.
// CRITICAL (dirname predicate): use `existsSync(tasksFile) === false &&
// existsSync(dirname(tasksFile)) === true`, NOT `existsSync(sessionPath)`.
// sessionPath is scoped inside the discovery else-branch and is awkward to hoist;
// dirname(tasksFile) is the session dir for BOTH the main-session fallback AND
// the bugfix tier, with no scoping work. This is robust + spec-faithful.
// CRITICAL (imports): line 30 imports `readFileSync` but NOT `existsSync`; line
// 31 imports `resolve, relative` but NOT `dirname`/`basename`. ADD all three
// (existsSync, dirname, basename) or the new code won't typecheck.
// CRITICAL (test mocks): taskAction DYNAMICALLY imports session-manager.js +
// session-utils.js. The existing test file mocks node:fs + node:fs/promises +
// logger + config, but NOT these two. ADD vi.mock for both (vi.hoisted fns for
// per-test override) or the real modules run (hit real FS / throw).
// CRITICAL (exit mock per-case): use a NO-OP vi.fn() exit mock for breakdown
// cases (assert mockExit called with 0) — a throwing mock would let the catch
// block's exit(1) mask the real exit(0). For hard-error cases (--file /
// no-sessions) use the throwing mock OR assert mockExit called with 1.
// CRITICAL (100% branch coverage): vitest.config.ts enforces 100/100/100/100 on
// src/**/*.ts. Every new branch MUST be exercised:
//   - !options.file true (discovery → check runs) + false (--file → check skipped).
//   - existsSync(tasksFile) false + existsSync(dirname) true → breakdown path.
//   - the negation (file exists OR dir absent) → normal path / hard error.
//   - options.output === 'json' (JSON emit) + else (stderr notice).
//   - action === 'next' (wording variant) + else (list/status wording).
// All covered by the test cases in What §d.
// GOTCHA (hard-error paths UNCHANGED): --file (580, gated off), no-sessions (596
// throw, ABOVE insertion), Session-not-found (590), corrupt-file (623 JSON.parse)
// all still exit 1. Do NOT soften them. The two empty states (no-sessions vs
// session-exists-no-tasks.json) are DISTINGUISHED by exit code.
// GOTCHA (no recovery / no re-entry): a simply-absent tasks.json on a read-only
// status query is REPORTED, not "repaired." Do NOT call §5.1 corruption-recovery
// (orchestrator-runtime; this is read-only CLI) or §4.4 interrupted-bugfix re-
// entry (scoped to bugfix children with TEST_RESULTS.md).
// GOTCHA (action wording): `next` says "no tasks available yet (breakdown in
// progress)"; list/status say the longer "tasks.json is generated during PRD
// breakdown ..." message. JSON emits the same { status, session } for all three.
// GOTCHA (no sourceNote for this state): inserting BEFORE line 614 means the
// breakdown path exits before sourceNote prints. Do NOT also try to clear
// sourceNote — it's never reached on the breakdown path.
```

---

## Implementation Blueprint

### Data models and structure
No ORM/pydantic models (TypeScript project). No new types — the breakdown path
emits a plain object literal `{ status: 'awaiting_breakdown', session: string }`
inline (matching the existing JSON.stringify style at lines 655/689). No new
config constants or env vars.

### Implementation Tasks (ordered by dependencies)
```yaml
Task 1: MODIFY src/cli/index.ts — imports + breakdown-in-progress check
  - EDIT line 30: `import { readFileSync, existsSync } from 'node:fs';`
  - EDIT line 31: `import { resolve, relative, dirname, basename } from 'node:path';`
  - INSERT (after line 612, before line 614's sourceNote block) the breakdown
    check, gated on !options.file, using existsSync(tasksFile) +
    existsSync(dirname(tasksFile)). Body per "What" §b:
      if (!options.file && !existsSync(tasksFile) && existsSync(dirname(tasksFile))) {
        const sessionId = basename(dirname(tasksFile));
        if (options.output === 'json') {
          console.log(JSON.stringify({ status: 'awaiting_breakdown', session: sessionId }, null, 2));
        } else {
          const notice = action === 'next'
            ? `[hack] Session ${sessionId}: no tasks available yet (breakdown in progress).`
            : `[hack] Session ${sessionId}: tasks.json is generated during PRD breakdown and is not available yet — re-run shortly, or run \`hack --continue\` to (re)generate it.`;
          process.stderr.write(`${chalk.cyan(notice)}\n`);
        }
        process.exit(0);
        return;  // unreachable in prod; stops no-op-exit test fall-through
      }
  - PRESERVE: the --file path (580, gated off by !options.file), the no-sessions
    throw (596, above insertion), the Session-not-found throw (590), the sourceNote
    block (614-620), the readFile (622), all three action branches, the catch
    block (717-723).
  - FOLLOW pattern: the existing sourceNote stderr write (615-619, chalk.cyan
    '[hack] …'); the existing json console.log (655, 689).
  - GOTCHA: do NOT soften --file (gate on !options.file). do NOT print sourceNote
    for this state (insert before it). do NOT change action branches. Use
    process.exit(0); return;  for test fall-through safety.

Task 2: MODIFY tests/unit/cli/index.test.ts — mocks + describe block
  - ADD two vi.hoisted + vi.mock blocks at the top (near the existing mocks):
      mockFindLatestSession, mockListSessions → vi.mock('../../../src/core/session-manager.js')
      mockFindLatestBugfixTasksFile → vi.mock('../../../src/core/session-utils.js')
  - ADD describe('breakdown-in-progress (PRD §5.3)', …) (sibling to 'prd status
    alias' at line 779). Use a per-block beforeEach with a NO-OP process.exit
    vi.fn() (mirror alias block 793-794). Cases:
      1. hack status (breakdown) → stderr notice, mockExit(0), no ERROR/ENOENT/stack on stdout.
         mockFindLatestSession → { path:'/plan/001_abc', id:'001_abc', hash:'abc' };
         mockExistsSync → p.endsWith('tasks.json')?false:true; spy process.stderr.write.
      2. hack status --output json → console.log JSON { status, session }, mockExit(0).
      3. hack status --file /nonexistent → mockExit(1) (gated off; readFile rejects ENOENT).
      4. no-sessions → mockFindLatestSession → null → mockExit(1) + 'No sessions found'.
      5. hack task + hack task next identical; next wording "no tasks available yet".
      6. (coverage) normal path: mockExistsSync → true (file exists) → breakdown
         skipped → readFile returns backlog → mockExit(0). Exercises negation branch.
  - FOLLOW pattern: the 'prd status alias' block (779-868) — no-op exit mock +
    setArgv + parseCLIArgs + await setImmediate + assert mockExit. For stderr/
    stdout assertions use vi.spyOn(process.stderr, 'write') / vi.spyOn(console, 'log').
  - GOTCHA: MUST vi.mock session-manager.js + session-utils.js (dynamic imports).
    MUST use no-op exit for breakdown cases (else catch exit(1) masks exit(0)).
    The source's `return` after process.exit(0) prevents fall-through to readFile.

Task 3: MODIFY docs/CLI_REFERENCE.md — ### Task Management subsection
  - LOCATE "### Task Management" (line 172). After the fenced bash example block
    (line 200), ADD a paragraph:
      "**Breakdown-in-progress state.** If the latest session's directory exists
      but `tasks.json` has not been generated yet (the Architect Agent is still
      decomposing the PRD, or a breakdown run was interrupted), `hack task` /
      `hack status` / `hack task next` print a calm notice to stderr and exit
      **0** — this is a normal transient state, not an error. Under `--output
      json` they emit `{ "status": "awaiting_breakdown", "session": "NNN_hash" }`.
      Re-run shortly, or run `hack --continue` to (re)generate `tasks.json`.
      Note: an explicit `--file <path>` pointing at a missing file, and the
      no-sessions-at-all state, remain **hard errors** (exit non-zero) — only
      auto-resolved (discovered) tasks files get the graceful path. See PRD §5.3."
  - FOLLOW pattern: the existing subsection's prose + fenced example style.
  - GOTCHA: document ONLY the breakdown state; do NOT re-document task/status
    actions (already in the table). Note the hard-error preservation.

Task 4: VERIFY — no regressions
  - RUN npm run typecheck → exit 0 (existsSync/dirname/basename resolve; check compiles).
  - RUN npx vitest run tests/unit/cli/index.test.ts → ALL green incl. new describe block.
  - RUN npx vitest run --coverage → 100/100/100/100 on src/**/*.ts (new branches covered).
  - RUN npm run validate → GREEN.
  - RUN npm run build → succeeds.
  - VERIFY only the three intended files changed: git diff --name-only →
    src/cli/index.ts, tests/unit/cli/index.test.ts, docs/CLI_REFERENCE.md.
```

### Implementation Patterns & Key Details
```ts
// PATTERN: the breakdown-in-progress check (cli/index.ts, inserted before sourceNote).
// Gated on !options.file (discovery only); dirname(tasksFile) = session dir for both tiers.
if (!options.file && !existsSync(tasksFile) && existsSync(dirname(tasksFile))) {
  const sessionId = basename(dirname(tasksFile));   // 'NNN_hash'
  if (options.output === 'json') {
    console.log(JSON.stringify({ status: 'awaiting_breakdown', session: sessionId }, null, 2));
  } else {
    const notice = action === 'next'
      ? `[hack] Session ${sessionId}: no tasks available yet (breakdown in progress).`
      : `[hack] Session ${sessionId}: tasks.json is generated during PRD breakdown and is not available yet — re-run shortly, or run \`hack --continue\` to (re)generate it.`;
    process.stderr.write(`${chalk.cyan(notice)}\n`);
  }
  process.exit(0);
  return;   // unreachable in prod; stops no-op-exit test fall-through
}

// PATTERN (test): no-op exit mock + spy, mirroring the 'prd status alias' block.
describe('breakdown-in-progress (PRD §5.3)', () => {
  let exitMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    mockFindLatestSession.mockResolvedValue({ path: '/plan/001_abc', id: '001_abc', hash: 'abc' });
    mockFindLatestBugfixTasksFile.mockResolvedValue(null);
    mockExistsSync.mockImplementation((p: string) => p.endsWith('tasks.json') ? false : true);
    exitMock = vi.fn();
    process.exit = exitMock as any;
  });
  it('hack status (breakdown) → calm stderr notice, exit 0', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    process.argv = ['node', 'hack', 'status'];
    parseCLIArgs();
    await new Promise(r => setImmediate(r));
    expect(exitMock).toHaveBeenCalledWith(0);
    expect(stderrSpy.mock.calls.flat().join(' ')).toMatch(/breakdown.*001_abc|001_abc.*breakdown/);
    stderrSpy.mockRestore();
  });
  // ... (json, --file, no-sessions, task/next parity, coverage cases)
});

// CRITICAL: insert BEFORE sourceNote block (614) so breakdown exits before
//   "Using main tasks: …" prints.
// CRITICAL: gate on !options.file (--file stays a hard error).
// CRITICAL: process.exit(0); return;  — the return stops no-op-exit test fall-through.
// CRITICAL: vi.mock session-manager.js + session-utils.js (dynamic imports) or
//   the real modules run in tests.
// CRITICAL: use dirname(tasksFile) for the session-dir check (uniform for both
//   tiers; avoids sessionPath scoping).
```

### Integration Points
```yaml
CLI (src/cli/index.ts):
  - add import: existsSync (node:fs), dirname + basename (node:path).
  - add: breakdown-in-progress check in taskAction (before sourceNote, gated on !options.file).
  - add: process.exit(0); return;  in the breakdown block.
  - unchanged: --file path (580), no-sessions throw (596), Session-not-found (590),
    sourceNote block (614-620), readFile (622), all action branches, catch (717-723).

TESTS (tests/unit/cli/index.test.ts):
  - add: vi.mock session-manager.js (mockFindLatestSession, mockListSessions).
  - add: vi.mock session-utils.js (mockFindLatestBugfixTasksFile).
  - add: describe('breakdown-in-progress (PRD §5.3)') — 5 acceptance criteria + coverage.

DOCS (docs/CLI_REFERENCE.md):
  - add: paragraph in ### Task Management documenting the state + exit 0 + json object
    + hard-error preservation.

NO DATABASE / NO ROUTES / NO ENV VARS / NO CONFIG / NO RECOVERY / NO RE-ENTRY /
NO PRD.md / NO tasks.json
  — pure CLI pre-readFile existence check + notice + test + doc.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
npm run typecheck        # tsc --noEmit → exit 0 (existsSync/dirname/basename resolve; check compiles)
npm run lint             # eslint . --ext .ts → no new violations
npm run format:check     # prettier --check; run `npm run format` if it complains
# Expected: Zero errors. The check is additive + mirrors existing patterns.
```

### Level 2: Unit Tests (Component Validation)
```bash
npx vitest run tests/unit/cli/index.test.ts          # incl. new breakdown-in-progress describe block
npx vitest run --coverage                            # 100/100/100/100 on src/**/*.ts
npm run test:run                                     # full suite green
# Expected: ALL green. The new branches (!options.file, existsSync true/false,
# output json/else, action next/else) are all exercised (else coverage fails).
```

### Level 3: Integration Testing (System Validation)
```bash
npm run validate      # lint + format:check + typecheck + test:run → GREEN
npm run build         # tsc -p tsconfig.build.json → succeeds

# Manual smoke (breakdown-in-progress state on a real temp tree):
SMOKE=$(mktemp -d)
mkdir -p "$SMOKE/plan/001_aaaaaaaaaaaa"
touch "$SMOKE/plan/001_aaaaaaaaaaaa/.prd_hash"
(cd "$SMOKE" && node /path/to/hack/dist/index.js status 2>/tmp/err.txt; echo "exit=$?")
# EXPECT: stderr has "[hack] Session 001_aaaaaaaaaaaa: ... breakdown ...", exit=0
cat /tmp/err.txt
(cd "$SMOKE" && node /path/to/hack/dist/index.js status --output json; echo "exit=$?")
# EXPECT: {"status":"awaiting_breakdown","session":"001_aaaaaaaaaaaa"}, exit=0
(cd "$SMOKE" && node /path/to/hack/dist/index.js status --file /nonexistent/tasks.json; echo "exit=$?")
# EXPECT: ERROR ... ENOENT, exit=1 (NOT softened)
rm -rf "$SMOKE"
```

### Level 4: Creative & Domain-Specific Validation
```bash
# Confirm the new imports:
rg -n "existsSync" src/cli/index.ts                                  # import present + check use
rg -n "dirname, basename|dirname, basename" src/cli/index.ts         # node:path import updated

# Confirm the breakdown check exists exactly once + is gated on !options.file:
rg -n "awaiting_breakdown" src/cli/index.ts                          # one match (json branch)
rg -n "breakdown in progress" src/cli/index.ts                       # one+ match (wording)
rg -n "!options\.file && !existsSync\(tasksFile\)" src/cli/index.ts  # the gated predicate

# Confirm the two empty states are distinguished (exit codes):
rg -n "process.exit\(0\)" src/cli/index.ts | rg -A2 "return"         # breakdown path exits 0 + returns
rg -n "No sessions found" src/cli/index.ts                           # no-sessions path unchanged

# Confirm process.exit(0); return;  (test fall-through safety):
rg -n "process.exit\(0\);\s*$" -A1 src/cli/index.ts | rg "return"    # the return after exit(0)

# Confirm docs:
rg -n "breakdown-in-progress|awaiting_breakdown" docs/CLI_REFERENCE.md  # documented

# Confirm only the three intended files changed:
git diff --name-only
# EXPECT: src/cli/index.ts, tests/unit/cli/index.test.ts, docs/CLI_REFERENCE.md
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` exit 0 (existsSync/dirname/basename resolve; check compiles).
- [ ] `npm run validate` GREEN (lint + format:check + typecheck + test:run).
- [ ] `npm run build` succeeds.
- [ ] 100% coverage on `src/**/*.ts` preserved (all new branches covered).

### Feature Validation
- [ ] `hack status` (session exists, no tasks.json) → calm stderr notice, exit 0,
      no ERROR/ENOENT/stack on stdout.
- [ ] `hack task` + `hack task next` identical; `next` says "no tasks available
      yet (breakdown in progress)".
- [ ] `hack status --output json` → `{ "status": "awaiting_breakdown", "session":
      "NNN_hash" }`, exit 0.
- [ ] `hack status --file /nonexistent` → exit non-zero (hard error preserved).
- [ ] No sessions → exit non-zero with "No sessions found" (distinct empty state).
- [ ] `docs/CLI_REFERENCE.md` documents the state + exit 0 + hard-error preservation.

### Code Quality Validation
- [ ] Breakdown check mirrors existing sourceNote (stderr, chalk.cyan) + json
      (console.log) patterns.
- [ ] Gated on `!options.file` (discovery only; --file not softened).
- [ ] Inserted before sourceNote block (notice replaces, not stacks with, sourceNote).
- [ ] `process.exit(0); return;` (test fall-through safety).
- [ ] No §5.1 recovery / §4.4 re-entry triggered (read-only observation).

### Documentation & Deployment
- [ ] `### Task Management` doc consistent with existing prose + example style.
- [ ] No new env vars / config / routes.
- [ ] No out-of-scope docs edits.

---

## Anti-Patterns to Avoid
- ❌ Don't **soften the `--file` override path** — gate the breakdown check on
  `!options.file`. An explicit `--file <missing>` is a real user mistake (hard
  error), not a transient state (PRD §5.3 "Scope — discovery only").
- ❌ Don't insert the check **after the sourceNote block** (614-620) — the
  self-contradictory "Using main tasks: …" would print before the calm notice.
  Insert BEFORE line 614 so the breakdown `process.exit(0)` short-circuits first.
- ❌ Don't use `existsSync(sessionPath)` for the session-dir check — `sessionPath`
  is scoped inside the discovery else-branch and awkward to hoist. Use
  `existsSync(dirname(tasksFile))` (uniform for both tiers, no scoping).
- ❌ Don't write `process.exit(0);` alone in the breakdown block — a no-op exit
  mock in tests lets control fall through to readFile (wrong path). Use
  `process.exit(0); return;` (the `return` is unreachable in prod).
- ❌ Don't forget to **vi.mock `session-manager.js` + `session-utils.js`** in the
  tests — `taskAction` dynamically imports them; without mocks the real modules
  run (hit real FS / throw).
- ❌ Don't use a **throwing exit mock** for the breakdown cases — the catch
  block's `process.exit(1)` would mask the real `exit(0)`. Use a no-op `vi.fn()`
  and assert `mockExit` called with 0 (mirror the alias block).
- ❌ Don't trigger **§5.1 corruption-recovery** or **§4.4 interrupted-bugfix
  re-entry** — a simply-absent tasks.json on a read-only status query is REPORTED,
  not "repaired."
- ❌ Don't change the **action branches** (`next`/`status`/list logic) — only the
  pre-readFile existence check is added.
- ❌ Don't forget the **action-specific wording** — `next` says "no tasks
  available yet (breakdown in progress)"; list/status say the longer message.
- ❌ Don't collapse the **two empty states** — no-sessions (exit non-zero) vs
  session-exists-no-tasks.json (exit 0) MUST be distinguished by exit code.
- ❌ Don't touch `PRD.md`, `tasks.json`, `prd_snapshot.md`, `vitest.config.ts`,
  `session-manager.ts`, or `session-utils.ts`.

---

## Confidence Score

**9/10** — One-pass success likelihood is very high. S1 is a 3-file change (one
CLI handler + its test + one doc paragraph). Every edit site is pinned with
file:line anchors, every pattern mirrored from a named exemplar (the sourceNote
block at cli/index.ts:614-620 for stderr/chalk.cyan; the json branches at 655/689
for console.log; the 'prd status alias' test block at 779-868 for the no-op-exit
mock + setArgv/parseCLIArgs/await-setImmediate/assert-mockExit pattern). The
correctness rests on ten pre-proven facts: the exact insertion point (before
sourceNote), the `!options.file` gate, the dirname-based predicate (avoids
sessionPath scoping), the existsSync/dirname/basename import gaps, the
sourceNote-replacement ordering, the test-fall-through `return` fix, the existing
node:fs/node:fs/promises mocks (only session-manager.js + session-utils.js mocks
are NEW), the four preserved hard-error paths (--file, no-sessions,
Session-not-found, corrupt-file), the action-specific wording, and the
100%-branch-coverage gate (every branch has a designated test). The single notable
risk — the test-fall-through / exit-mock-masking interaction — is explicitly
handled by the `process.exit(0); return;` pattern + per-case exit-mock choice.
Scope fences are airtight: S1 edits ONLY cli/index.ts + its test + the
CLI_REFERENCE task section; the parallel P2.M2.T3.S1 edits config.ts +
integration/config tests + the CLI_REFERENCE Configuration section — disjoint
source files, disjoint doc sections, disjoint test files, zero overlap.