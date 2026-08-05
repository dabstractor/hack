# P3.M1.T1.S1 — Codebase Analysis (Proven Facts)

Scope: Add breakdown-in-progress detection + calm notice across all discovery-
based actions (task / status / task next) in the `taskAction` handler. When the
auto-resolved tasks.json is absent but the session dir exists, emit a calm
notice + exit 0 instead of the scary ENOENT error. Explicit `--file` and
no-sessions paths remain hard errors.

## §1 — The exact insertion point (cli/index.ts)

The shared `taskAction` handler spans lines 554-782. The tasksFile-resolution
block is lines 577-612, structured as:

```
if (options.file) {                                  // :580 — --file override (HARD ERROR, do NOT soften)
  tasksFile = resolve(options.file);
} else {
  // resolve sessionPath via --session prefix or findLatestSession (:584-598)
  const bugfixTasks = await findLatestBugfixTasksFile(sessionPath);  // :604
  if (bugfixTasks) {                                  // :606 — bugfix tier
    tasksFile = bugfixTasks;
    sourceNote = `Using bugfix tasks: ${relative(sessionPath, bugfixTasks)}`;
  } else {
    tasksFile = resolve(sessionPath, 'tasks.json');   // :609 — main-session fallback (THE gap)
    sourceNote = `Using main tasks: ${relative(planDir, tasksFile)}`;
  }
}
```

**THE GAP**: there is NO existence check before `readFile(tasksFile)` at line 622.
A session dir that exists but has no tasks.json → `readFile` throws ENOENT →
catch block (717-723) → `logger().error('Task command failed: ENOENT...')` →
`process.exit(1)`. This is the scary error PRD §5.3 wants eliminated.

**INSERTION POINT**: AFTER the tasksFile-resolution block (after line 620, the
close of the sourceNote-printing block) and BEFORE `readFile` (line 622). This is
BELOW the `if (options.file)` branch (so `--file` is NOT softened) and BELOW the
`else` discovery block (so we have `tasksFile` + `sessionPath` in scope).

**CRITICAL**: `sessionPath` is only in scope inside the `else` (discovery) branch.
The breakdown-in-progress check must therefore live INSIDE the discovery flow OR
re-derive the session dir from tasksFile. Cleanest: perform the check right after
tasksFile is assigned in BOTH the bugfix-tier and main-session-fallback sub-
branches — OR (simpler, single insertion) guard it on "we did discovery" (i.e.
`!options.file`). Recommended structure:

```ts
// After the if/else resolution block, before sourceNote printing (614-620):
if (!options.file) {
  // Discovery path only (PRD §5.3: explicit --file override is a HARD error).
  if (!existsSync(tasksFile) && existsSync(sessionPath)) {
    // Breakdown-in-progress: session dir exists, tasks.json not yet written.
    const sessionId = basename(sessionPath);  // 'NNN_hash'
    if (options.output === 'json') {
      console.log(JSON.stringify({
        status: 'awaiting_breakdown',
        session: sessionId,
        // (for 'next' the contract allows the same object; see §3)
      }, null, 2));
    } else {
      process.stderr.write(
        chalk.cyan(`[hack] Session ${sessionId}: `) +
        'tasks.json is generated during PRD breakdown and is not available yet — ' +
        're-run shortly, or run `hack --continue` to (re)generate it.\n'
      );
    }
    process.exit(0);
  }
}
```

**`sessionPath` scoping gotcha**: in the discovery branch, `sessionPath` is a
`let` declared at the top of the `else` block (≈line 583). To use it AFTER the
if/else (in my insertion point), either (a) hoist `let sessionPath: string | null
= null;` to the function scope and assign it in the discovery branch, OR (b) put
the check INSIDE the discovery branch right after tasksFile is set in each sub-
branch. **Approach (a) is cleaner** — hoist `sessionPath`. The bugfix tier also
has a sessionPath (the main session's), so re-deriving from the bugfix tasksFile
would be wrong; we want the MAIN session dir existence check. Actually: for the
bugfix tier, `findLatestBugfixTasksFile` already returns null when no bugfix
tasks.json exists (architecture §2), so the bugfix tier never reaches the
absent-tasks.json state — only the MAIN-session fallback does. So the check only
needs to fire on the main-session-fallback path. **Simplest correct structure**:
put the existence check INSIDE the `else { tasksFile = resolve(sessionPath,
'tasks.json') }` sub-branch (line 609), right after tasksFile is assigned. There,
`sessionPath` IS in scope.

## §2 — existsSync import

Line 30: `import { readFileSync } from 'node:fs';` — existsSync is NOT imported.
**ADD `existsSync`** to that import: `import { readFileSync, existsSync } from
'node:fs';`. The test file (line 24-32) already mocks `node:fs` with `existsSync:
vi.fn()` overridable per-test, and imports `existsSync` at line 67
(`const mockExistsSync = existsSync as any;`). So the source-side import addition
aligns with the existing test mock — no new mock wiring needed.

## §3 — The 'next' action under breakdown-in-progress

The contract says: "For the 'next' action under this state: the notice should say
'no tasks available yet (breakdown in progress)'. For JSON: { status:
'awaiting_breakdown', session: '<id>' }."

So the human-readable message DIFFERS for `next` vs list/status:
- list / status: "tasks.json is generated during PRD breakdown and is not
  available yet — re-run shortly, or run `hack --continue` to (re)generate it."
- next: "no tasks available yet (breakdown in progress)"

The JSON object is the SAME for all three actions: `{ status: 'awaiting_breakdown',
session: '<id>' }` (the contract's example doesn't vary by action for JSON).

**Implementation**: branch the human message on `action === 'next'` inside the
breakdown-in-progress block. JSON path emits the same object regardless of action.

## §4 — The detection contract (PRD §5.3 "Detection")

PRD §5.3 Detection bullet: "After resolving the target session but *before*
parsing, if the resolved tasks file (`SESSION_DIR/tasks.json`, or the bugfix
fallback when the discovery priority selects it) does not exist (ENOENT) **and
the session directory itself does exist**, classify the state as breakdown-in-
progress."

Note the "or the bugfix fallback when the discovery priority selects it" clause.
In practice (per architecture §2) `findLatestBugfixTasksFile` returns null when
no bugfix tasks.json exists, so the bugfix tier never produces an absent tasksFile
— the only absent-tasksFile case is the main-session fallback. BUT to be safe and
spec-faithful, the existence check should apply to WHATEVER tasksFile was resolved
on the discovery path (both tiers). Since `existsSync(tasksFile)` is cheap and the
session-dir check gates it, applying it to both tiers is harmless and spec-
compliant. **Put the check after the if/else resolution but gated on
`!options.file`** — covers both tiers uniformly.

The session-dir existence check: `existsSync(sessionPath)`. For the main-session
fallback, sessionPath is the resolved session. For the bugfix tier... sessionPath
is the MAIN session (bugfixTasks is a child). Hmm — for the bugfix tier, the
absence would mean `bugfixTasks` is null, which can't happen (we're in the
`if (bugfixTasks)` branch). So the existence check effectively only fires on the
main-session fallback in practice. **Cleanest**: check existsSync(tasksFile) AND
existsSync(dirname(tasksFile)) — `dirname(tasksFile)` is always the dir containing
tasksFile, which IS the session dir for both tiers (main: sessionPath; bugfix:
the bugfix child dir). This is robust and spec-faithful without scoping gymnastics.

**DECISION**: Use `existsSync(tasksFile) === false && existsSync(dirname(tasksFile))
=== true`. Import `dirname` from `node:path` (line 31 currently imports `resolve,
relative` — add `dirname`). This avoids the sessionPath-scoping problem entirely
and works uniformly for both tiers.

## §5 — What stays UNCHANGED (hard-error paths)

Per contract + PRD §5.3 acceptance criteria:
- **`--file <nonexistent>`** (line 580): `options.file` truthy → skips discovery
  → readFile throws ENOENT → catch → exit(1). UNCHANGED. The breakdown-in-progress
  check is gated on `!options.file`, so explicit overrides still hard-error.
- **No sessions at all** (findLatestSession returns null, line 596): throws
  `'No sessions found...'` BEFORE tasksFile is even resolved → catch → exit(1).
  UNCHANGED. This throw happens ABOVE the insertion point.
- **`--session <not found>`** (line 590-592): throws `'Session not found'` →
  catch → exit(1). UNCHANGED.
- **Present-but-corrupt tasks.json** (JSON.parse fails, line 623): NOT the
  breakdown-in-progress case (file EXISTS). → catch → exit(1). UNCHANGED. Does
  NOT trigger §5.1 corruption-recovery (that's orchestrator-runtime; this is the
  read-only CLI path).

## §6 — Exit code + output stream semantics

- **Exit code 0** for breakdown-in-progress (process.exit(0)) — PRD §5.3 "Exit
  code. 0."
- **Human notice → STDERR** (process.stderr.write) — PRD §5.3 "Message. Emit a
  single, calm, human-readable notice to stderr." Mirrors the existing sourceNote
  (line 615-619) which ALSO writes to stderr. Use `chalk.cyan('[hack] ...')` to
  match the existing sourceNote style.
- **JSON → STDOUT** (console.log) — PRD §5.3 "Under --output json, emit a
  structured object instead ... so scripts get clean stdout." Mirrors the existing
  JSON branches (next: line 655; status: line 689) which use console.log.
- **Suppress sourceNote** for this state — PRD §5.3: "This notice replaces the
  `Using main tasks: …` source note for this state (printing both would be self-
  contradictory)." Since the breakdown check fires BEFORE readFile and the
  sourceNote print is at lines 614-620 (BEFORE readFile too)... ordering matters.

**SOURCE-NOTE ORDERING**: The sourceNote is printed at lines 614-620, BEFORE
readFile (622). If I insert the breakdown check AFTER sourceNote printing, the
self-contradictory "Using main tasks: ..." would print before the calm notice.
**SOLUTION**: insert the breakdown check BEFORE the sourceNote-printing block
(614-620), OR suppress sourceNote when in the breakdown state. Cleanest:
**insert the breakdown check BEFORE line 614** (the sourceNote block). Then the
breakdown path `process.exit(0)`s before sourceNote is ever printed. The
sourceNote block is only reached on the normal (file-exists) path. This is the
correct placement.

So the final insertion order in the discovery branch is:
1. tasksFile resolution (577-612)
2. **NEW: breakdown-in-progress check (gated on !options.file)** → exit(0) if hit
3. sourceNote printing (614-620)
4. readFile (622)

## §7 — Test strategy (tests/unit/cli/index.test.ts)

The existing test infrastructure:
- `vi.mock('node:fs', …)` overrides `existsSync` per-test (line 24-32), cast as
  `mockExistsSync` (line 69).
- `vi.mock('node:fs/promises', …)` mocks `readFile` to return `{ backlog: [] }`
  (line 38), cast as `mockReadFileFn` (line 68).
- `process.exit` mocked in main `beforeEach` (line 92) to THROW
  `'process.exit(N)'`; in the alias block `beforeEach` it's a no-op `vi.fn()`.
- `parseCLIArgs()` runs synchronously; the `taskAction` async tail runs after,
  resolved via `await new Promise(r => setImmediate(r))`.

**NEW MOCKS NEEDED**: `taskAction` dynamically imports `../core/session-manager.js`
(for SessionManager.findLatestSession/listSessions) and `../core/session-utils.js`
(for findLatestBugfixTasksFile). These are NOT currently mocked. For the
breakdown-in-progress test I need `findLatestSession` to return a fake session
metadata with `.path`, and `existsSync` to return false for tasksFile + true for
the session dir.

**Add `vi.mock('../../../src/core/session-manager.js', …)`** returning a
SessionManager class with static `findLatestSession` + `listSessions` as vi.fn()s.
Hoist them so per-test override works:
```ts
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
```
And `vi.mock('../../../src/core/session-utils.js', …)` returning
`findLatestBugfixTasksFile: vi.fn(async () => null)`.

**Per-test existsSync mapping**: `mockExistsSync.mockImplementation((p) =>
p.endsWith('tasks.json') ? false : true)` — tasksFile absent, session dir present.

**Test cases (contract item 3 + PRD §5.3 acceptance)**:
1. `hack status` (breakdown state) → stderr has calm notice, exit 0, stdout has
   no ERROR/ENOENT/stack-trace. Assert `mockExit` called with 0 (or threw
   'process.exit(0)').
2. `hack status --output json` (breakdown state) → stdout has
   `{ "status": "awaiting_breakdown", "session": "001_abc" }`, exit 0.
3. `hack status --file /nonexistent` → exit 1 (NOT softened). Mock readFile to
   reject ENOENT; existsSync check is gated on `!options.file` so it's skipped.
4. No sessions (`mockFindLatestSession.mockResolvedValue(null)`) → throws 'No
   sessions found' → exit 1.
5. `hack task` and `hack task next` behave identically (both exit 0, calm notice;
   `next` message says "no tasks available yet (breakdown in progress)").
6. (coverage) tasksFile EXISTS → normal path runs (readFile returns backlog),
   sourceNote prints, exit 0 — exercises the `existsSync(tasksFile) === true`
   branch (the negation).

## §8 — Coverage gate

vitest.config.ts:41-47 thresholds 100/100/100/100 on src/**/*.ts. Every new
branch must be exercised:
- `!options.file` true-branch (discovery) + false-branch (--file, skipped check).
- `existsSync(tasksFile) === false && existsSync(dirname) === true` true-branch
  (breakdown-in-progress) + false-branch (normal path proceeds).
- `action === 'next'` (breakdown message variant) + else (list/status message).
- `options.output === 'json'` (JSON emit) + else (stderr notice).

All covered by the test cases in §7.

## §9 — Scope fences & sibling coordination

- **S1 owns (this PRP):** the breakdown-in-progress check in `taskAction`
  (cli/index.ts), the existsSync/dirname imports, tests in
  tests/unit/cli/index.test.ts, and the docs/CLI_REFERENCE.md task/status section
  update (Mode A). COMPLETES P3.M1 + Phase P3.
- **P2.M2.T3.S1 (parallel):** edits src/cli/commands/config.ts +
  tests/integration/config/ + docs/CLI_REFERENCE.md (Configuration section). NO
  overlap — different source file (config.ts vs index.ts), different doc section,
  different test files.
- **READ-ONLY:** PRD.md, tasks.json, prd_snapshot.md, vitest.config.ts,
  session-manager.ts, session-utils.ts (S1 only CONSUMES them via the existing
  dynamic imports).

## §10 — Validation commands (verified)

```bash
npm run typecheck           # tsc --noEmit
npm run lint                # eslint . --ext .ts
npm run format:check        # prettier --check
npm run test:run            # vitest run
npm run validate            # lint + format:check + typecheck + test:run
npm run build               # tsc -p tsconfig.build.json
npx vitest run --coverage   # 100/100/100/100 on src/**/*.ts
```