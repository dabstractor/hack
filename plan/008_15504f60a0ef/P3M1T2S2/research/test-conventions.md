# Research: Test Conventions for Routing saveBacklog/flushUpdates through `withLockedTasksJSON`

> Scope: how the existing test suite mocks the modules that S2 will touch
> (`session-utils`, `tasks-json-recovery`, `node:fs`, the `SessionManager`
> class) and what breaks when `saveBacklog`/`flushUpdates`/`recoverTasksJson`
> get routed through the new `src/core/file-lock.ts` locked accessor
> (`withLockedTasksJSON`). S1 is already implemented (`file-lock.ts` +
> `file-lock.test.ts` exist); S2 is the wiring step.
>
> Method: static read of source + tests. No files modified. No commands run
> (config has no web_search/fetch tools; analysis is codebase-internal).

## Summary

The suite splits cleanly into two mocking camps. **(A) Mock-everything tests**
(`session-manager.test.ts`, `flush-retry.test.ts`, `session-state-batching.test.ts`,
`task-orchestrator.test.ts`) stub `session-utils`, `node:fs`, and/or the whole
`SessionManager`/`recoverTasksJson`. **(B) Real-I/O tests** (`tasks-json-recovery.test.ts`,
`file-lock.test.ts`) use a real tmpdir + real git and NO module-wide `vi.mock`.

The decisive fact: `file-lock.ts` imports **synchronous `node:fs`** functions
(`openSync`, `closeSync`, `writeSync`, `unlinkSync`, `statSync`, `readFileSync`)
that the three mock-everything `SessionManager` tests do **not** export from their
`vi.mock('node:fs', () => ({ statSync, readdir }))` factory. So once `saveBacklog`
routes through `withLockedTasksJSON`, those three tests hit `TypeError: openSync
is not a function` (and even if the sync fns were added, the fake session path
`/test/plan/001_…` does not exist on disk → `openSync('…/tasks.json.lock','wx')`
throws `ENOENT`, which is re-thrown, not treated as EEXIST). **These three files
need a `vi.mock('../../../src/core/file-lock.ts', …)` passthrough.** The
`task-orchestrator.test.ts` and `tasks-json-recovery.test.ts` files need **no
changes** (full module mock / real tmpdir respectively).

## Findings

### 1. `tests/unit/core/task-orchestrator.test.ts` — fully mocked, UNAFFECTED

**Mocking strategy:** `SessionManager` is imported as a **type only**
(`import type { SessionManager }`) and **never instantiated**. A hand-rolled mock
is built by `createMockSessionManager()`:

```ts
// ~line 204
const createMockSessionManager = (currentSession: any): SessionManager => {
  const mockManager = {
    currentSession,
    updateItemStatus: vi.fn().mockResolvedValue(currentSession?.taskRegistry),
    loadBacklog: vi.fn().mockResolvedValue(currentSession?.taskRegistry),
    flushUpdates: vi.fn().mockResolvedValue(undefined),   // ← flushUpdates mock
  } as unknown as SessionManager;
  return mockManager;
};
```

`flushUpdates` is a standalone `vi.fn().mockResolvedValue(undefined)` on the mock
object — it never reaches the real `SessionManager.saveBacklog`. There is **no
`vi.mock('node:fs')`** anywhere in this file.

The two `session-utils`/recovery module mocks return:

```ts
// ~line 88 — session-utils
vi.mock('../../../src/core/session-utils.js', () => ({
  atomicWrite: vi.fn().mockResolvedValue(undefined),
  readTasksJSON: vi.fn().mockResolvedValue({ backlog: [] }),
}));
// ~line 98 — tasks-json-recovery (S2 module)
vi.mock('../../../src/core/tasks-json-recovery.js', () => ({
  recoverTasksJson: vi.fn().mockResolvedValue({
    restored: false, source: 'disk', reason: 're-applied legitimate status delta',
  }),
}));
```

**Test ~line 4058** (`invokes recoverTasksJson ONCE after a successful agent
run …`): asserts `mockRecoverTasksJson` was called **once** with
`('/plan/001_x/tasks.json', {itemId:'P1.M1.T1.S1', status:'Complete'}, {baselineBacklog})`.
Pure mock-call-count + argument assertion.

**Test ~line 4141** (`is NON-FATAL: a recovery+reload failure does NOT terminate
execution …`): flips `mockRecoverTasksJson.mockRejectedValue(new Error('git
exploded'))` and `mockReadTasksJSON.mockRejectedValue(new Error('disk gone'))`,
then asserts `executeSubtask` **resolves** and still reaches `mockSmartCommit`
(once). Recovery + reload are both mocked, so non-fatality is asserted against
the mock rejection, not real I/O.

**KEY question — does S2 break this file?** **No.** Three independent reasons:
1. The orchestrator calls `mockManager.flushUpdates()` (a `vi.fn`), never the real
   `saveBacklog` → routing `saveBacklog` through the lock is invisible here.
2. `recoverTasksJson` is fully replaced by a `vi.mock` factory, so wrapping its
   body in the lock is irrelevant — the factory wins at module load.
3. `readTasksJSON` is fully mocked; no real disk read.

→ **No mock changes required.** Severity: none.

### 2. `tests/unit/core/tasks-json-recovery.test.ts` — REAL tmpdir, UNAFFECTED (confirms pass)

**Mocking strategy:** **NO module-wide `vi.mock` at all.** Real tmpdir + real git.
Imports the **real** `recoverTasksJson` and **real** `readTasksJSON`.

Helper that seeds `tasks.json`:
```ts
async function commitBacklog(git, dir, backlog, msg) {
  await writeFile(join(dir, 'tasks.json'), JSON.stringify(backlog, null, 2));
  await git.add('tasks.json'); await git.commit(msg);
}
// plus makeRepo() = mkdtemp(join(tmpdir(),'recovery-')) + git.init() + user config
// and makeValidBacklog() — a minimal schema-valid Backlog fixture.
```
Each test does `beforeEach: makeRepo()` → fresh dir; `afterEach: rm(dir, …)`.

**If `recoverTasksJson`'s body is wrapped to acquire the lock — do these still
pass?** **Yes. CONFIRMED.** Reasoning:
- The lockfile is `resolve(sessionDir,'tasks.json.lock')` — a **sibling** of
  `tasks.json` inside the **real** tmpdir, whose parent dir exists.
  `acquireFileLock` → `openSync(lockPath,'wx')` succeeds against real I/O.
- Release is in a `finally` (`releaseFileLock` → `unlinkSync`, ENOENT ignored),
  so no leftover lockfile after each case.
- Each test gets a **fresh tmpdir**, so there is no cross-test lock
  contamination even if one case failed mid-flight.
- The observable contract — `recoverTasksJson`'s return shape (`restored`/
  `source`/`reason`) and the **on-disk** state (re-read via real `readTasksJSON`)
  — is unchanged by adding lock acquire/release around the RMW.
- **Re-entrancy caveat (S2 design note, not a test break):** the S2 implementation
  should wrap `recoverTasksJson`'s RMW in a **single** `withLockedTasksJSON`
  call (the whole body is the mutator), not nest a second `withLockedTasksJSON`
  inside. A nested call would hit the re-entrant fast path (re-read + run mutator
  but **no re-write**), which is designed-safe but is a subtlety to avoid.
  `recoverTasksJson` already does its own read/restore/write, so one outer lock
  is correct.

→ **No mock changes required.** The real-I/O pattern is exactly what the lock is
built for. Severity: none. This file + `file-lock.test.ts` are the **templates**
any new merge-under-lock test should copy.

### 3. `session-manager.test.ts`, `flush-retry.test.ts`, `session-state-batching.test.ts` — WILL BREAK, need a file-lock passthrough mock

All three instantiate the **real `SessionManager`** class and drive
`updateItemStatus` → `flushUpdates` → `saveBacklog` → `writeTasksJSON`. They all:

- `vi.mock('node:fs', () => ({ statSync: vi.fn(), readdir: vi.fn() }))` — **only
  `statSync` and `readdir`**; no `openSync/closeSync/writeSync/unlinkSync/
  readFileSync`.
- `vi.mock('node:fs/promises', () => ({ writeFile, rename, unlink, readFile, stat,
  readdir }))` and `vi.mock('node:crypto', …)`.
- `vi.mock('../../../src/core/session-utils.js', () => ({ …, readTasksJSON:
  vi.fn(), writeTasksJSON: vi.fn(), … }))` — `writeTasksJSON` is a **spy**
  (`mockWriteTasksJSON`) whose `.mockImplementation` simulates the atomic
  writeFile→rename chain; tests assert it was called with the **in-memory**
  backlog and/or the underlying `mockWriteFile`/`mockRename` calls.

**Why S2 breaks them (two compounding reasons):**

1. **Missing sync-fs exports.** `file-lock.ts` does
   `import { openSync, closeSync, writeSync, unlinkSync, statSync, readFileSync }
   from 'node:fs'`. Under the `vi.mock('node:fs')` factory these names are
   **`undefined`** → `acquireFileLock` calls `openSync(…)` →
   `TypeError: openSync is not a function`.
2. **Fake session path.** The session dir is `/test/plan/001_14b9dc2a33c7` (a mock
   string, never created on disk). Even if the sync fns were added to the mock,
   real `openSync('/test/plan/001_…/tasks.json.lock','wx')` would throw **ENOENT**
   (parent missing) — and `ENOENT` is **re-thrown** by `acquireFileLock` (only
   `EEXIST` is the "already locked" branch), so the call crashes rather than
   retrying.

A secondary concern: `withLockedTasksJSON` calls `readTasksJSON(sessionDir)` —
here mocked as a bare `vi.fn()` returning `undefined`. If S2 makes `saveBacklog`
do a **merge** (read disk under lock + apply in-memory delta + write), the mutator
would receive `undefined` and crash. If S2 keeps `saveBacklog` as a pure
overwrite (mutator ignores the read, returns the in-memory backlog), the merge
concern is moot — but the two break reasons above still apply.

**Minimal fix (identical for all three):** add a passthrough mock for
`file-lock.ts` that **preserves the current overwrite behaviour** so the existing
`mockWriteTasksJSON`/`mockWriteFile`/`mockRename` assertions stay intact. Drop it
in **next to the existing `session-utils` mock**:

```ts
vi.mock('../../../src/core/file-lock.ts', () => ({
  // Passthrough: skip the real O_EXCL lock (node:fs is mocked; session path is
  // fake). Run the mutator on the in-memory backlog the caller already holds and
  // let the spied writeTasksJSON record the call — keeping existing assertions
  // byte-identical to today's overwrite semantics.
  withLockedTasksJSON: vi.fn(async (_sessionDir, mutator) => mutator()),
}));
```

> The exact mutator-coupling (whether `saveBacklog`'s mutator takes a read-back
> backlog or returns the in-memory one) is an S2 implementation decision; either
> way the file-lock module **must** be mocked here, because `node:fs` is mocked
> and the session path is not real. The three files are otherwise identical in
> structure — the fix is mechanical and copy-paste.

**Severity: HIGH (test-blocking).** Without the mock, all three files fail to load
or fail at the first `flushUpdates`. With the passthrough, they remain green and
unchanged.

**In-memory-only assertion breakage?** None, **provided** the passthrough above is
used. The passthrough invokes the mutator directly on the caller's backlog and
defers to the spied `writeTasksJSON`, so the in-memory `taskRegistry` assertions
(e.g. `session-state-batching` CONTRACT a–e) are unaffected. The breakage risk
would only materialize if S2 (a) did NOT mock `file-lock` AND (b) made
`saveBacklog` merge from a `readTasksJSON` mock returning `undefined`.

### 4. S1 test pattern (`file-lock.test.ts`) — CONFIRMED real-tmpdir, no mock

Reading the S1 PRP `plan/008_15504f60a0ef/P3M1T2S1/PRP.md` **Task 3** and the
**already-implemented** `tests/unit/core/file-lock.test.ts`:

- **Task 3** of the S1 PRP mandates: *"NO `vi.mock('node:fs')`. Use real tmpdir:
  `dir = await mkdtemp(join(tmpdir(),'filelock-'))` per test,
  `await rm(dir,{recursive:true,force:true})` in afterEach. Mirror
  `tasks-json-recovery.test.ts`."*
- The actual file confirms this: it imports from `node:fs/promises`
  (`mkdtemp, rm, writeFile, utimes`) and `node:fs` (`existsSync`) directly, with
  **no `vi.mock`** anywhere except a single `vi.spyOn(process,'kill')` to exercise
  the `EPERM`/`ESRCH` branches of `isProcessAlive` (which cannot be triggered
  naturally as non-root). Header comment: *"REAL tmpdir + REAL filesystem (NO
  module-wide `vi.mock`)"*.

→ The two real-I/O test files (`tasks-json-recovery.test.ts`,
`file-lock.test.ts`) are the canonical pattern for any **new** test that must
prove merge-under-lock / concurrency behaviour.

## KEY DELIVERABLE — Checklist

### A. Existing test files: do they need mock updates?

| # | File | Strategy | Breaks when S2 routes `saveBacklog`/`flushUpdates` through `withLockedTasksJSON`? | Action |
|---|------|----------|------|--------|
| 1 | `tests/unit/core/session-manager.test.ts` | mock-everything (real `SessionManager`, mocked `node:fs` + `session-utils`) | **YES — TypeError (openSync undefined) + fake path ENOENT** | **ADD** `vi.mock('../../../src/core/file-lock.ts', passthrough)` |
| 2 | `tests/unit/core/flush-retry.test.ts` | mock-everything (real `SessionManager`, mocked `node:fs` + `session-utils`) | **YES — same root cause** | **ADD** `vi.mock('../../../src/core/file-lock.ts', passthrough)` |
| 3 | `tests/unit/core/session-state-batching.test.ts` | mock-everything (real `SessionManager`, mocked `node:fs` + `session-utils`) | **YES — same root cause** | **ADD** `vi.mock('../../../src/core/file-lock.ts', passthrough)` |
| 4 | `tests/unit/core/task-orchestrator.test.ts` | full mock (type-only `SessionManager`, mocked `flushUpdates`/`recoverTasksJson`/`readTasksJSON`) | **NO** | none — `flushUpdates` is a `vi.fn`; `recoverTasksJson`/`readTasksJSON` fully mocked |
| 5 | `tests/unit/core/tasks-json-recovery.test.ts` | REAL tmpdir + real git, no mock | **NO** | none — lockfile is a real sibling, auto-acquires/releases; **confirm** S2 wraps body in a single `withLockedTasksJSON` |
| 6 | `tests/unit/core/file-lock.test.ts` | REAL tmpdir, no module mock | **NO** | none — tests the lock directly; doesn't touch `saveBacklog` |

**Severity legend:** items 1–3 are **HIGH / test-blocking**; items 4–6 are **none**.

### B. New tests proving merge-under-lock (PRD §5.1 lost-update prevention)

The locked accessor only prevents lost updates if `saveBacklog` stops being a
blind overwrite of the in-memory backlog and instead does a true **read-disk →
apply-delta → write** *inside* the lock. Today `saveBacklog` is a pure overwrite
(`writeTasksJSON(path, backlog)` of the full in-memory state). That overwrite must
NOT be added to the mock-everything tests (mocked fs can't prove concurrency);
it must be proven with **real I/O**, mirroring `tasks-json-recovery.test.ts` /
`file-lock.test.ts`:

1. **NEW real-tmpdir integration test** (preferred location: a new
   `tests/unit/core/session-manager-locking.test.ts`, or an added `describe` in
   `file-lock.test.ts`) proving: writer A holds an in-memory delta for item **X**;
   writer B has already persisted item **Y** to disk; A's flush (under lock)
   reads disk (sees **Y**), merges **X** on top, writes **both** — does **not**
   clobber **Y**. This is the core PRD §5.1 invariant and is only meaningful with
   a real tmpdir.
2. **Concurrent serialization proof** (two overlapping `flushUpdates`/RMW calls on
   the same dir with `Promise.all`, each sleeping inside the mutator) asserting
   the final on-disk state reflects both deltas — NOT last-writer-wins. (The S1
   `file-lock.test.ts` already has a counter-increment case for the raw accessor;
   S2 needs the equivalent at the `saveBacklog`/`flushUpdates` level.)
3. **Re-entrant no-deadlock** at the `SessionManager` call graph level — e.g. a
   path where `flushUpdates` → recovery → write re-enters on the same session dir
   (the `AsyncLocalStorage` fast path must short-circuit without re-write).

> Note: these NEW tests belong in the **real-I/O** camp, NOT the mock-everything
> camp. The mock passthrough in items A1–A3 is only to keep the *existing*
> in-memory/overwrite assertions green; it cannot prove the new merge semantics.

## Sources

- **Kept (read):**
  - `tests/unit/core/task-orchestrator.test.ts` (mock factories lines ~30–110;
    `createMockSessionManager` ~line 204; recovery tests ~4058 & ~4141) — defines
    the orchestrator's fully-mocked boundary that S2 cannot disturb.
  - `tests/unit/core/tasks-json-recovery.test.ts` (full file) — the canonical
    real-tmpdir pattern and the proof that lock-wrapping is safe there.
  - `tests/unit/core/session-manager.test.ts`, `flush-retry.test.ts`,
    `session-state-batching.test.ts` (mock headers + bodies) — the three
    mock-everything files that break on the missing sync-`node:fs` exports.
  - `src/core/file-lock.ts` (imports lines 60–68; `acquireFileLock` ~line 145;
    `withLockedTasksJSON` ~line 430) — confirms sync `node:fs` usage +
    `readTasksJSON`/`writeTasksJSON` coupling → the break mechanism.
  - `src/core/session-manager.ts` (`saveBacklog` ~line 723; `flushUpdates`
    ~line 760) — confirms today's pure-overwrite semantics that S2 changes.
  - `plan/008_15504f60a0ef/P3M1T2S1/PRP.md` Task 3 + `tests/unit/core/file-lock.test.ts`
    header — confirm the S1 real-tmpdir test pattern.
- **Dropped:** none — all targeted files were read and are relevant.

## Gaps

- **No runtime test run.** This run has no `web_search`/`fetch_content`/shell
  tooling available, so the break is argued from static analysis of the mock
  factories + the `file-lock.ts` import list, not from an actual
  `vitest` failure log. The argument is airtight (undefined sync-fn + non-existent
  path) but an empirical confirmation run of the three files after wiring is
  advised.
- **Exact S2 `saveBacklog` mutator shape (overwrite vs merge) is undecided.**
  Whether `saveBacklog` ignores the read-back backlog (overwrite) or merges the
  pending delta onto it determines (a) whether the merge-under-lock NEW tests in
  §B are mandatory or optional, and (b) the precise passthrough body in §A. The
  PRD §5.1 lost-update requirement implies merge is mandatory, but that is an S2
  PRD/scope decision, not a test-convention fact.
- **`recoverTasksJson` re-entrancy under S2** is only confirmed safe-by-design
  (AsyncLocalStorage fast path) from source reading, not from a test that
  exercises a nested lock path.

## Supervisor coordination

No decision needed. This is a self-contained research brief returned in the
normal flow. The one item that could warrant a scope call — *is S2's `saveBacklog`
a merge or an overwrite?* — is flagged in Gaps as an S2 PRD decision rather than a
blocker for this research task.