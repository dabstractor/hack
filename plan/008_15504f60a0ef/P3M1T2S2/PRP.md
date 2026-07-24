# PRP — P3.M1.T2.S2: Wrap all RMW paths through the locked accessor

---

## Goal

**Feature Goal**: Route every read-modify-write (RMW) path that touches
`tasks.json` through the **locked accessor** (`withLockedTasksJSON`) shipped by
P3.M1.T2.S1, so the foreground executor (`Implementing`/`Complete`) and the
background research supervisor (`Researching`/`Ready`) can never interleave
their writes and clobber a status back. Per PRD §5.1 "tasks.json Write
Concurrency (lost-update prevention)": *"every read-modify-write of `tasks.json`
MUST be serialized under an exclusive lock … Both the orchestrator's status
writes and the restore/recovery path go through the same locked accessor."*
S1 delivered the **utility**; **this task (S2) is the wiring** that makes the
lock actually protect every writer. This completes P3.M1.T2.

**Deliverable** (3 modified files + 1 new test file + 3 test-file mock patches):
1. **`src/core/session-manager.ts`** — MODIFY: convert the batched status-update
   path from a *full-snapshot overwrite* into a *delta-based merge*. Add a
   `#pendingDeltas: Array<{ itemId: string; status: Status }>` queue populated by
   `updateItemStatus`; route `flushUpdates` → `saveBacklog` through
   `withLockedTasksJSON` with a mutator that applies ONLY those deltas onto the
   freshly-locked disk read (the per-item LWW merge). This is the **primary**
   correctness fix — without it the lock serializes RMW windows but the stale
   snapshot still overwrites a concurrent writer.
2. **`src/core/tasks-json-recovery.ts`** — MODIFY: (a) **export `setItemStatus`**
   (currently module-private) so the session-manager mutator can reuse the exact
   per-item status-setter the recovery path uses — single canonical merge. (b)
   Route the RMW in `recoverTasksJson` through `withLockedTasksJSON`, **with the
   PATH-B git walk performed OUTSIDE the lock** (the git walk is read-only and
   can take seconds; holding the O_EXCL lockfile across it risks a stale-lock
   false-positive where a waiter deletes a live lock → silent concurrent RMW).
   (c) **Add `backlog?: Backlog` to `TasksJsonRecoveryResult`** and return the
   reconstructed backlog so the orchestrator's `#recoverAfterAgentRun` can reuse
   it instead of re-reading (eliminates a second lock acquire + a TOCTOU window).
3. **`src/core/task-orchestrator.ts`** — MODIFY: in `#recoverAfterAgentRun`,
   consume `result.backlog` from `recoverTasksJson` (step 3 re-read becomes a
   fallback only when recovery produced no backlog) so the restore/recovery path
   shares one locked critical section instead of two.
4. **`tests/unit/core/session-manager-locking.test.ts`** — CREATE: a **real-tmpdir**
   integration test (NO `vi.mock('node:fs')`) proving the merge-under-lock
   invariant: writer A's delta for item X does NOT clobber a concurrent writer
   B's persisted status for item Y. Mirror `tasks-json-recovery.test.ts` /
   `file-lock.test.ts`. This is the only place the core PRD §5.1 lost-update
   invariant can be *proven* (mocked-fs tests cannot).
5. **Mock patches** to 3 existing mock-everything test files
   (`session-manager.test.ts`, `flush-retry.test.ts`,
   `session-state-batching.test.ts`): add a one-line `vi.mock` passthrough for
   `file-lock.ts` so the real `openSync`/session-path are never exercised there
   (they can't be — `node:fs` is mocked and the session path is a fake string).

**Scope note (critical):** S1 (P3.M1.T2.S1) is **already implemented** —
`src/core/file-lock.ts` and `tests/unit/core/file-lock.test.ts` exist and
export `withLockedTasksJSON(sessionDir, mutator, opts?)`. **Do NOT reimplement
or modify the lock algorithm.** This task only **wires callers** into the
existing accessor and **fixes the merge semantics** that make the lock
meaningful. `writeTasksJSON` stays a low-level pure-write primitive that the
accessor calls internally for its own WRITE step — it is NOT itself routed
through the accessor (see R2 / Anti-Patterns).

**Success Definition**:
- A concurrent writer that persists item **Y** = `Ready` while a batched
  `flushUpdates` is mid-flight for item **X** = `Complete` produces on-disk
  state with **both** X=Complete **and** Y=Ready (verified by a real-tmpdir
  test). Today the batched write would clobber Y back to its pre-flight value.
- `recoverTasksJson`'s RMW runs inside `withLockedTasksJSON`; the git-history
  walk (PATH B) runs **outside** the lock; the returned `result.backlog` is the
  authoritative written version.
- The orchestrator's `#recoverAfterAgentRun` no longer does a second, unlocked
  re-read of `tasks.json` after recovery — it reuses `result.backlog`.
- `npm run validate` GREEN; the 3 patched mock-everything suites stay green; the
  new real-tmpdir suite proves the merge invariant.
- No new runtime dependencies (`package.json` `dependencies` unchanged).

---

## User Persona (if applicable)

**Target User**: Pipeline operator running `-r` / `PARALLEL_RESEARCH=true`
(P3.M1.T1), where a background research supervisor writes `Researching` /
`Ready` concurrently with the foreground executor writing `Implementing` /
`Complete`. Also affects `ConcurrentTaskExecutor.executeParallel` (P3.M1
parallel subtask execution), where N parallel workers share one
`SessionManager` and each calls `flushUpdates` in a `finally` block.
**Use Case**: Long backlog run with depth-chained prefetch — supervisor marks
item N+3 `Researching` while executor marks item N `Complete`. Without the
delta-merge + lock, the executor's `flushUpdates` (a full-snapshot overwrite of
a stale `#pendingUpdates`) reverts N+3 back to its pre-flight status.
**User Journey**: `prd -r --research-depth 3` → supervisor + executor both
touch `tasks.json` → both go through `withLockedTasksJSON`, each applying ONLY
its own `{itemId, status}` delta onto a fresh locked read → statuses are never
silently reverted.
**Pain Points Addressed**: PRD §5.1 — *"the supervisor reverts
`N:Implementing` → `N:Ready` because it read the file before the executor's
write landed."* The restore/recovery path has the identical window; both are
closed.

---

## Why

- **PRD compliance**: PRD §5.1 (h3.9) mandates: *"Both the orchestrator's
  status writes and the restore/recovery path go through the same locked
  accessor."* and *"Atomic writes alone do not prevent lost updates —
  process-level mutual exclusion does."* The lock (S1) without the wiring (S2)
  protects nothing — every existing caller still bypasses it.
- **Contract item 3 (LOGIC) full coverage**:
  - (a) *"Update writeTasksJSON to acquire the lock … or wrap its callers"* →
    **wrap its callers** (`saveBacklog`/`flushUpdates`/`recoverTasksJson`),
    NOT `writeTasksJSON` itself (R2: routing the pure-write primitive discards
    the fresh read → reintroduces the overwrite; the accessor already calls
    `writeTasksJSON` internally).
  - (b) *"Update SessionManager.flushUpdates() to route through the locked
    accessor"* → done via `saveBacklog`, with the **delta-merge mutator** (R1)
    so the locked read is honored rather than overwritten.
  - (c) *"Update recoverTasksJson to route through the locked accessor (it does
    read-modify-write)"* → done, git walk kept outside the lock (R3).
  - (d) *"Ensure the orchestrator's #recoverAfterAgentRun path uses the locked
    accessor"* → it now consumes `recoverTasksJson`'s locked result (R5) and
    drops the unlocked second re-read.
  - (e) *"All callers share one locked accessor instance for the same
    tasks.json path"* → there is a single `SessionManager` per pipeline run
    (verified: `prp-pipeline.ts:1779`), and `withLockedTasksJSON` keys the
    in-process mutex + lockfile on `sessionDir`, so every caller for the same
    session serializes on one lock.
- **Architectural reality (the bug S1's lock alone does not fix)**:
  `flushUpdates` writes `#pendingUpdates` — a **full in-memory Backlog
  snapshot** — via `saveBacklog` → `writeTasksJSON`. `updateItemStatus` only
  mutates that in-memory snapshot; it does not record *which* `{itemId, status}`
  changed. So even *with* the lock, a mutator that returns `#pendingUpdates`
  would **blindly overwrite** fresh disk state and re-clobber a concurrent
  writer. **The delta-queue (R1) is the essential correctness fix.**

---

## What

Three production files are rewired; one real-tmpdir test proves the invariant;
three mock-everything test files get a one-line passthrough mock.

### Success Criteria

- [ ] **Merge-under-lock (R1)**: `flushUpdates` persists a backlog that is the
      *fresh locked disk read* with the `#pendingDeltas` applied — NOT the stale
      `#pendingUpdates` snapshot. Verified by a real-tmpdir test where a
      concurrent writer's status survives a batched flush.
- [ ] **Single canonical merge (R6)**: `session-manager`'s mutator reuses the
      exported `setItemStatus` from `tasks-json-recovery.ts` — the same setter
      the recovery path uses. No second tree-walk merge is written.
- [ ] **Recovery inside the lock, git outside (R3)**: `recoverTasksJson`'s
      PATH-A and PATH-B final write happen inside `withLockedTasksJSON`; the
      `gitFileHistory`/`gitReadFileAtCommit` walk happens before the lock is
      acquired.
- [ ] **Recovery returns the backlog (R5)**: `TasksJsonRecoveryResult` gains
      `readonly backlog?: Backlog`; `recoverTasksJson` returns the written
      backlog (or `undefined` on PATH-C failure).
- [ ] **Orchestrator uses the locked result**: `#recoverAfterAgentRun` sets
      `taskRegistry` from `result.backlog` and only `readTasksJSON`-falls-back
      when recovery produced no backlog.
- [ ] **writeTasksJSON NOT routed through the accessor (R2)**: it remains a
      pure-write primitive called by `withLockedTasksJSON` internally.
      `grep -n "withLockedTasksJSON" src/core/session-utils.ts` returns nothing.
- [ ] **3 mock-everything suites stay green**: `session-manager.test.ts`,
      `flush-retry.test.ts`, `session-state-batching.test.ts` each get the
      `file-lock.ts` passthrough mock and pass unchanged.
- [ ] `npm run validate` GREEN; `package.json` `dependencies` byte-identical.

---

## All Needed Context

### Context Completeness Check

✅ "If someone knew nothing about this codebase, would they have everything
needed to implement this successfully?" — YES. This PRP names the exact files,
exact functions, exact line numbers, the exact mutator shape, the exact test to
mirror, the exact mock-passthrough to add, and the exact reasons NOT to do the
naive thing (route `writeTasksJSON` / overwrite with `#pendingUpdates`).

### Documentation & References

```yaml
# MUST READ - Include these in your context window
- url: https://nodejs.org/api/async_context.html#class-asynclocalstorage
  why: The S1 lock (src/core/file-lock.ts) uses AsyncLocalStorage for re-entrant
       same-dir detection. S2's mutators apply deltas IN PLACE on freshBacklog,
       so a re-entrant inner call MUST operate on the SAME in-flight backlog, not
       a fresh disk re-read — otherwise inner deltas are silently lost (R4).
  critical: The implemented S1 fast path (file-lock.ts ~line 466) currently
            RE-READS disk on re-entry. S2 must change that to stash/pass the
            in-flight backlog (see Implementation Decision D4 below) because S2
            introduces mutating mutators. This is a SMALL edit to file-lock.ts —
            read the existing withLockedTasksJSON before editing.

- url: https://github.com/moxystudio/node-proper-lockfile#stale
  why: Documents the false-stale failure mode: "If you set stale too low, the
       lock will be compromised (released) while the holder is still working."
       This is EXACTLY why the PATH-B git walk MUST run OUTSIDE the lock (R3).
  critical: A git walk held under the O_EXCL lockfile can exceed staleMs (30s
            default); a waiter then deletes the live lock → both run RMW
            concurrently → silent corruption. Keep staleMs at 30s and move git
            outside the lock.

- file: src/core/file-lock.ts
  why: THE ACCESSOR — already implemented by S1. withLockedTasksJSON(sessionDir,
       mutator, opts?) acquires the O_EXCL lockfile + in-process mutex, runs
       `readTasksJSON → mutator(backlog) → writeTasksJSON` inside an
       AsyncLocalStorage ownership context, and returns the mutator's result.
       S2 IMPORTS this and calls it from saveBacklog + recoverTasksJson.
  pattern: read the implemented withLockedTasksJSON (~line 460) and the
           re-entrant fast path (~line 466) BEFORE editing. The fast path
           currently does `const cur = await readTasksJSON(sessionDir);
           return mutator(cur);` — for S2's mutating mutators this must become
           a stashed in-flight backlog (D4).
  gotcha: the accessor ALWAYS calls writeTasksJSON for you after the mutator
          returns. S2's mutator returns the MERGED backlog; it must NOT call
          writeTasksJSON itself (that would be a re-entrant write). The accessor
          already validates + atomicWrites the returned backlog.

- file: src/core/session-manager.ts
  why: THE PRIMARY EDIT. saveBacklog (line 713) → writeTasksJSON (718).
       flushUpdates (761) has TWO saveBacklog call sites: the 0-retries path
       (783) and the retry loop (825), each followed by a state-reset block
       (804-806 / 846-848). updateItemStatus (1048) mutates #pendingUpdates +
       #dirty + #updateCount in memory and does NOT touch disk (confirmed).
  pattern: read saveBacklog (700-731), flushUpdates (754-905), updateItemStatus
           (1043-1083), and #preservePendingUpdates (~952, writes
           tasks.json.failed — NOT tasks.json — leave untouched).
  gotcha: (1) #pendingUpdates is a FULL snapshot today; the merge needs the
          DELTAS, so add #pendingDeltas and keep #pendingUpdates as the in-memory
          mirror (D1). (2) saveBacklog also syncs #currentSession.taskRegistry
          AFTER writing (line 726-729) — when routed through the accessor, sync
          it to the MERGED result the accessor returns, not the stale snapshot.
          (3) The 0-retries and retry-loop paths BOTH must route through the
          accessor — don't patch only one. (4) #preservePendingUpdates (recovery
          file) and #calculateFlushRetryDelay are unchanged.

- file: src/core/tasks-json-recovery.ts
  why: TWO EDITS. (a) setItemStatus (line 101, currently `function setItemStatus`
       — NOT exported) must be `export function setItemStatus` so session-manager
       reuses it. (b) recoverTasksJson (158) routes its RMW through
       withLockedTasksJSON with the git walk OUTSIDE the lock, and returns the
       reconstructed backlog via a new `backlog?: Backlog` field on
       TasksJsonRecoveryResult (line 60).
  pattern: read the full recoverTasksJson (158-225): PATH A reads disk (172),
           PATH B walks git (194-203), both then structuredClone + setItemStatus
           + writeTasksJSON. PATH A's write becomes the accessor's mutator body
           (merge legitimate delta onto fresh disk). PATH B: do the git walk
           FIRST (collect restoredBacklog + commit), THEN enter the accessor and
           in the mutator prefer fresh disk if valid else use restoredBacklog.
  gotcha: (1) recoverTasksJson has a NON-FATAL outer guard ("NEVER throws to
          S3") — keep it; if withLockedTasksJSON throws TasksLockAcquisitionError,
          the outer catch must still return a non-throwing PATH-C result. (2)
          The function takes `tasksPath` (a FILE path); derive sessionDir via
          `dirname(resolve(tasksPath))` (already done at line 161) and pass
          sessionDir to withLockedTasksJSON. (3) structuredClone of
          opts.baselineBacklog is still needed (caller-owned); but inside the
          mutator, freshBacklog is already a fresh Zod-parsed object — clone is
          redundant there (R6).

- file: src/core/task-orchestrator.ts
  why: #recoverAfterAgentRun (line 1089) calls recoverTasksJson (1117) then
       readTasksJSON (1132) to reload the registry. S2 replaces the unconditional
       re-read with: use result.backlog if present, else fall back to
       readTasksJSON (recovery PATH-C produced no backlog).
  pattern: read #recoverAfterAgentRun (1089-1155). The readonly-cast idiom at
           ~1135 (`(this.sessionManager.currentSession as {taskRegistry:
           Backlog}).taskRegistry = recovered`) stays; just source `recovered`
           from result.backlog first.
  gotcha: setStatus (331) and the flushUpdates call sites (995, 1056) are
          UNCHANGED — they already go through updateItemStatus/flushUpdates,
          which S2 routes internally. No edit needed there.

- file: src/core/session-utils.ts
  why: readTasksJSON (841) + writeTasksJSON (746) — the RMW read/write the
       accessor wraps. CONFIRM writeTasksJSON does NOT read disk (it Zod-validates
       its arg and atomicWrites it) — that is WHY routing it through the accessor
       is wrong (R2) and why the MERGE mutator is required instead.
  pattern: DO NOT MODIFY writeTasksJSON or readTasksJSON. They remain the
           low-level primitives the accessor calls. The only S2 change in this
           file is NONE.

- file: tests/unit/core/tasks-json-recovery.test.ts
  why: THE real-tmpdir test pattern to MIRROR for the new
       session-manager-locking.test.ts. Uses real mkdtemp + real git + NO
       vi.mock; seeds tasks.json via a commitBacklog helper; re-reads via real
       readTasksJSON to assert on-disk state.
  pattern: copy the header (imports from node:fs/promises, tmpdir, simpleGit),
           the makeRepo/makeValidBacklog/commitBacklog helpers, and the
           beforeEach/afterEach mkdtemp+rm lifecycle.
  gotcha: because recoverTasksJson now acquires the lock internally, these
          EXISTING recovery tests still pass (the lockfile is a real sibling in
          the real tmpdir; acquire/release is automatic). No edit needed to this
          file — but RUN it to confirm.

- file: tests/unit/core/task-orchestrator.test.ts
  why: defines the orchestrator's fully-mocked boundary. The session-utils mock
       (line 88) returns atomicWrite + readTasksJSON; the recovery mock (98)
       returns {restored,source,reason}. flushUpdates on the mock sessionManager
       (line ~204) is a bare vi.fn().
  pattern: if S2 adds backlog? to recoverTasksJson's return, UPDATE the recovery
           mock factory (line ~98-103) to also return `backlog: undefined` (or a
           fixture) so the orchestrator's result.backlog branch is exercised.
           The non-fatal test (~4141) uses mockRejectedValue and is unaffected.
  gotcha: this file does NOT need a file-lock passthrough — flushUpdates is a
          vi.fn and recoverTasksJson/readTasksJSON are fully mocked. But the
          mock's return shape MUST match the new TasksJsonRecoveryResult.

- docfile: plan/008_15504f60a0ef/P3M1T2S2/research/callsites.md
  why: the complete call-site map (every saveBacklog/flushUpdates/writeTasksJSON
       caller, with file:line, pure-write vs RMW classification, and the call
       chain). CONFIRMS there is ONE SessionManager per run and that
       ResearchQueue does NOT write tasks.json directly (only via
       orchestrator.setStatus).
  section: "7. Critical design constraints" (the overwrite-vs-delta insight).

- docfile: plan/008_15504f60a0ef/P3M1T2S2/research/test-conventions.md
  why: the exact mock-break analysis. CONFIRMS session-manager.test.ts,
       flush-retry.test.ts, session-state-batching.test.ts will throw
       `TypeError: openSync is not a function` (node:fs mock lacks sync fns) +
       ENOENT (fake session path) unless a file-lock passthrough mock is added.
       Gives the exact passthrough body.
  section: "3." (the three breaking files + the passthrough mock) and
           "KEY DELIVERABLE — Checklist".

- docfile: plan/008_15504f60a0ef/P3M1T2S2/research/merge-and-reentrancy.md
  why: the canonical-pattern reasoning (delta-based merge = LWW per item,
       matching recoverTasksJson's legitimateDelta). Explains why diff-against-
       baseline is inferior and why writeTasksJSON must NOT be routed. Gives the
       concrete flushUpdates refactor, the git-outside-lock restructure, and the
       return-backlog recommendation (R1-R7).
  section: "Q1" (merge pattern), "Q3" (git outside lock), "Q4" (return backlog).
```

### Current Codebase tree (relevant slice)

```bash
src/
  config/
    constants.ts            # TASKS_LOCK_* readers (from S1) — UNCHANGED here
  core/
    file-lock.ts            # S1 accessor — IMPORT; tiny D4 edit to fast path
    session-utils.ts        # writeTasksJSON/readTasksJSON — UNCHANGED (not routed)
    session-manager.ts      # MODIFY: #pendingDeltas + delta-merge in saveBacklog/flushUpdates
    tasks-json-recovery.ts  # MODIFY: export setItemStatus; route RMW; return backlog
    task-orchestrator.ts    # MODIFY: #recoverAfterAgentRun uses result.backlog
    concurrent-executor.ts  # UNCHANGED (inherits via flushUpdates)
    research-queue.ts       # UNCHANGED (writes via orchestrator.setStatus)
tests/
  unit/
    core/
      file-lock.test.ts             # S1 — UNCHANGED
      tasks-json-recovery.test.ts   # UNCHANGED (real tmpdir; confirm still green)
      task-orchestrator.test.ts     # MODIFY: recovery mock return shape (+backlog)
      session-manager.test.ts       # MODIFY: add file-lock passthrough mock
      flush-retry.test.ts           # MODIFY: add file-lock passthrough mock
      session-state-batching.test.ts# MODIFY: add file-lock passthrough mock
      session-manager-locking.test.ts # CREATE: real-tmpdir merge-under-lock proof
```

### Desired Codebase tree with files to be added/modified

```bash
src/core/session-manager.ts             # MODIFY (Task 2)
src/core/tasks-json-recovery.ts         # MODIFY (Task 3)
src/core/task-orchestrator.ts           # MODIFY (Task 4)
src/core/file-lock.ts                   # TINY EDIT (Task 1 — D4 fast path)
tests/unit/core/session-manager-locking.test.ts  # CREATE (Task 6)
tests/unit/core/session-manager.test.ts          # MODIFY (Task 5a)
tests/unit/core/flush-retry.test.ts              # MODIFY (Task 5b)
tests/unit/core/session-state-batching.test.ts   # MODIFY (Task 5c)
tests/unit/core/task-orchestrator.test.ts        # MODIFY (Task 5d)
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL: flushUpdates writes a FULL snapshot (#pendingUpdates), NOT a delta.
// Routing it through withLockedTasksJSON with `mutator = () => #pendingUpdates`
// STILL overwrites fresh disk and re-clobbers a concurrent writer. The
// #pendingDeltas queue + apply-deltas-onto-freshBacklog mutator is MANDATORY (R1).

// CRITICAL: do NOT route writeTasksJSON itself through the accessor. It is a
// pure write (no read); wrapping it discards the fresh read and reintroduces the
// overwrite. writeTasksJSON stays the low-level primitive the accessor calls
// internally for its WRITE step (R2). `grep withLockedTasksJSON
// src/core/session-utils.ts` must be empty.

// CRITICAL: the S1 re-entrant fast path (file-lock.ts ~line 466) currently does
// `readTasksJSON` on re-entry. S2 introduces MUTATING mutators (delta apply) — a
// re-entrant inner call that re-reads disk loses the outer's in-flight deltas.
// MUST stash the in-flight backlog in the AsyncLocalStorage store and pass THAT
// to the inner mutator (D4). This is the ONE small edit to file-lock.ts.

// CRITICAL: hold the O_EXCL lockfile ONLY for the sub-second RMW (parse+merge+
// write). The PATH-B git walk (gitFileHistory/gitReadFileAtCommit) is read-only
// and can take seconds — holding the lock across it risks a waiter's stale-age
// check (Date.now()-mtimeMs > staleMs) deleting a LIVE lock → silent concurrent
// RMW (R3). Do the git walk FIRST, then enter the accessor.

// GOTCHA: recoverTasksJson is NON-FATAL — it "NEVER throws to S3". If
// withLockedTasksJSON throws TasksLockAcquisitionError (lock timeout), the outer
// try/catch must still return a PATH-C-shaped result {restored:false, source:
// 'disk', reason:'recovery failed: ...'} and NOT propagate.

// GOTCHA: recoverTasksJson takes tasksPath (a FILE path) but withLockedTasksJSON
// takes sessionDir (a DIRECTORY). Use the existing `const sessionDir =
// dirname(resolve(tasksPath))` (line 161) — it's already there.

// GOTCHA: setItemStatus is currently `function setItemStatus` (module-private)
// in tasks-json-recovery.ts. S2 must `export` it so session-manager reuses the
// SAME canonical per-item setter (single merge implementation). It depends on
// the local `type AnyItem = Phase | Milestone | Task | Subtask` (line 92) —
// export that type too, or inline it, or move both to task-utils.ts.

// GOTCHA: the 3 mock-everything test files mock node:fs with ONLY {statSync,
// readdir}. file-lock.ts imports openSync/closeSync/writeSync/unlinkSync/
// readFileSync from node:fs → those are `undefined` under the mock →
// `TypeError: openSync is not a function`. AND the session path is a fake string
// (`/test/plan/001_...`) → real openSync would ENOENT (parent missing) and ENOENT
// is RE-THROWN (only EEXIST is the retry branch). Both are fatal. The fix is a
// one-line vi.mock('../../../src/core/file-lock.ts', passthrough) in each file.

// GOTCHA: saveBacklog syncs #currentSession.taskRegistry AFTER writing. When
// routed through the accessor, sync it to the MERGED backlog the accessor
// RETURNS (which includes concurrent writers' changes), not the stale input —
// else memory and disk diverge.

// GOTCHA: there is ONE SessionManager per pipeline run (prp-pipeline.ts:1779),
// shared by orchestrator + researchQueue + concurrent-executor. The in-process
// mutex (Map<sessionDir, Promise>) in file-lock.ts therefore serializes all
// these writers for the same session. Do not introduce a second SessionManager.
```

---

## Implementation Blueprint

### Implementation Decisions

**D1 — Delta queue, not snapshot overwrite.** Add
`#pendingDeltas: Array<{ itemId: string; status: Status }> = []` to
`SessionManager`. `updateItemStatus` pushes `{itemId, status}` into it AND still
updates `#pendingUpdates`/`#dirty`/`#updateCount`/`#currentSession.taskRegistry`
(the in-memory mirror is still needed for synchronous reads between flushes).
`flushUpdates` → `saveBacklog` routes through `withLockedTasksJSON` with a
mutator that applies each delta via `setItemStatus(freshBacklog, itemId,
status)`. `#pendingDeltas` is cleared on successful flush (alongside the
existing `#pendingUpdates = null`). Rationale (research R1/Q1): the lock
serializes RMW windows; the delta provides the per-item LWW merge granularity.
This mirrors `recoverTasksJson`'s `legitimateDelta` pattern exactly.

**D2 — Wrap callers, not `writeTasksJSON`.** `writeTasksJSON` stays a pure-write
primitive. The accessor (`withLockedTasksJSON`) already calls it internally for
its WRITE step. S2 wraps `saveBacklog` and `recoverTasksJson` (the two callers
that need RMW protection), and leaves direct-write callers that are provably
single-writer (initial breakdown generation) as-is. Rationale (research R2/Q2):
routing the pure-write primitive discards the fresh read → reintroduces the
overwrite bug.

**D3 — Recovery RMW inside the lock; git walk outside.** `recoverTasksJson` is
restructured so PATH A (clean disk) enters the accessor and merges the
legitimate delta onto the fresh read; PATH B performs the entire git walk FIRST
(collecting `restoredBacklog` + commit), THEN enters the accessor and in the
mutator prefers the fresh disk read if it is now valid (another writer may have
fixed the corruption during the walk) else uses `restoredBacklog`. Rationale
(research R3/Q3): holding the O_EXCL lockfile across a multi-second git walk
risks a stale-age false-positive deleting a live lock.

**D4 — Stash in-flight backlog for re-entrant fast path.** The S1 fast path
(file-lock.ts ~line 466) currently re-reads disk on a same-dir re-entry. Because
S2 introduces **mutating** mutators (delta apply in place), a re-entrant inner
call must operate on the SAME in-flight backlog the outer mutator is mutating —
otherwise the inner's deltas land on a stale disk snapshot and the outer's
in-flight deltas are lost. Change the AsyncLocalStorage store from
`Set<string>` to a small context object `{ held: Set<string>; inflight:
Map<string, Backlog> }`; stash the read `backlog` under `inflight.get(sessionDir)`
right after the locked read; the fast path returns
`mutator(ctx.inflight.get(sessionDir)!)`. Rationale (research R4/Q2): re-entrant
correctness requires operating on the same protected state, not a re-fetched
copy. This is the ONLY edit to `file-lock.ts`.

> **Testability note for D4:** re-entrancy is rare in S2's call graph (the main
> potential path is recovery → write, but `writeTasksJSON` is NOT locked so it
> does not re-enter). Add a focused unit test in `file-lock.test.ts` (or the new
> locking test) that proves an outer mutator applying delta A and an inner
> same-dir re-entrant call applying delta B yields a backlog with BOTH A and B.

### Data models and structure

No ORM/pydantic — TypeScript/ESM. Two small shape changes:

```typescript
// 1. SessionManager gains a delta queue (in addition to the existing snapshot).
interface StatusDelta {
  itemId: string;
  status: Status; // from src/core/models.ts (already exported)
}
// class SessionManager { ...
//   #pendingDeltas: StatusDelta[] = [];
//   #pendingUpdates: Backlog | null = null; // unchanged in-memory mirror
// }

// 2. recoverTasksJson's result gains the written backlog.
export interface TasksJsonRecoveryResult {
  readonly restored: boolean;
  readonly source: 'disk' | 'git';
  readonly reason?: string;
  readonly backlog?: Backlog; // NEW — the authoritative written backlog (undefined on PATH-C failure)
}

// 3. (file-lock.ts D4) the ALS store widens from Set<string> to:
interface LockOwnership {
  held: Set<string>;            // sessionDirs this async chain holds
  inflight: Map<string, Backlog>; // sessionDir -> in-flight backlog being mutated
}
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT src/core/file-lock.ts — stash in-flight backlog for re-entrant fast path (D4)
  - READ FIRST: withLockedTasksJSON (~line 460) and the re-entrant fast path
    (~line 466: `const cur = await readTasksJSON(sessionDir); return mutator(cur);`).
  - CHANGE the AsyncLocalStorage store type from `AsyncLocalStorage<Set<string>>`
    to `AsyncLocalStorage<LockOwnership>` (new interface, see Data models #3).
    Update EVERY call site that reads/writes the store:
      * the fast-path guard: `ctx?.held.has(sessionDir)` (was `owned?.has`)
      * the ownership.run(...) arg: `{ held: new Set(ctx?.held ?? []).add(sessionDir), inflight: new Map(ctx?.inflight ?? []) }`
  - STASH the locked read: right after `const backlog = await readTasksJSON(sessionDir)` in the critical section, do `inflightForRun.set(sessionDir, backlog)` where `inflightForRun` is the inflight Map owned by THIS critical section's ownership.run context (capture it in the closure). If the mutator itself calls withLockedTasksJSON on the same dir, the fast path reads `ctx.inflight.get(sessionDir)` instead of re-reading disk.
  - FAST PATH becomes:
        const ctx = ownership.getStore();
        if (ctx?.held.has(sessionDir)) {
          const inflight = ctx.inflight.get(sessionDir);
          // SAFE: outer holds the lock; operate on the SAME in-flight object
          return mutator(inflight ?? await readTasksJSON(sessionDir));
        }
  - GOTCHA: each ownership.run creates a NEW LockOwnership with a copied inflight
    Map so concurrent independent critical sections don't share inflight state.
  - FOLLOW pattern: keep the existing logger().debug reentrant log line.
  - DO NOT change acquireFileLock / isStaleLock / releaseFileLock / withFileLock —
    only the ownership-store shape + the fast path + the stash.
  - VALIDATE: existing file-lock.test.ts must still pass (re-entrancy test there
    may need its assertion relaxed/updated — re-read it; if it asserts a re-read
    happened, update it to assert both deltas land).

Task 2: EDIT src/core/session-manager.ts — delta queue + merge-under-lock (D1)
  - ADD field: `#pendingDeltas: Array<{ itemId: string; status: Status }> = [];`
    near #pendingUpdates (line ~177).
  - MODIFY updateItemStatus (line 1048): AFTER computing `updated` via
    updateItemStatusUtil, ALSO push `{ itemId, status }` into #pendingDeltas.
    Keep the existing #pendingUpdates/#dirty/#updateCount/#currentSession updates
    (the in-memory mirror is still read synchronously between flushes).
  - MODIFY saveBacklog (line 713): replace `await writeTasksJSON(path, backlog)`
    with a merge-through-accessor:
        const sessionDir = this.#currentSession.metadata.path;
        const deltas = this.#pendingDeltas;          // capture (cleared by flushUpdates on success)
        const written = await withLockedTasksJSON(sessionDir, (fresh) => {
          // #pendingDeltas may be empty (direct saveBacklog callers during init
          // — S3/S4 handleDelta/decomposePRD). When empty, `backlog` (the arg)
          // is the authoritative full snapshot from a single-writer init phase;
          // honor it by applying it as a wholesale replace ONLY when no deltas
          // are queued. When deltas ARE queued, apply ONLY them onto fresh.
          if (deltas.length === 0) return backlog;    // init-time full write (single writer)
          let changed = false;
          for (const d of deltas) changed = setItemStatus(fresh, d.itemId, d.status) || changed;
          return fresh;                               // merge result (R1)
        });
        // Sync in-memory registry to the MERGED result (picks up concurrent changes):
        this.#currentSession = { ...this.#currentSession, taskRegistry: written };
  - MODIFY flushUpdates (line 761): on the SUCCESS path of BOTH the 0-retries
    branch (line 783) and the retry loop (line 825), ALSO clear #pendingDeltas
    alongside the existing #pendingUpdates=null / #dirty=false / #updateCount=0
    resets (lines 804-806 and 846-848). On the ERROR path (#preservePendingUpdates),
    do NOT clear #pendingDeltas (preserve for retry — same as #pendingUpdates).
  - IMPORT: `import { withLockedTasksJSON } from './file-lock.js';` and
    `import { setItemStatus } from './tasks-json-recovery.js';` at the top.
  - GOTCHA: the mutator closure captures `this.#pendingDeltas` at call time; if
    saveBacklog is entered twice concurrently (it isn't — flushUpdates serializes
    via #dirty, and the in-process mutex serializes the accessor), capture a
    local copy. The single-SessionManager-per-run invariant makes this safe.
  - GOTCHA: do NOT call writeTasksJSON inside the mutator — the accessor does it.
  - FOLLOW pattern: keep the existing retry/backoff/#preservePendingUpdates logic
    untouched; only the write call + the reset lines change.
  - NAMING: #pendingDeltas (camelCase private field), StatusDelta inline type or
    reuse {itemId,status}.

Task 3: EDIT src/core/tasks-json-recovery.ts — export setItemStatus, route RMW, return backlog (D2/D3/R5)
  - EXPORT setItemStatus (line 101): `export function setItemStatus(...)`. Also
    export the local `type AnyItem = Phase | Milestone | Task | Subtask` (line 92)
    OR move both setItemStatus + AnyItem to src/utils/task-utils.ts (preferred —
    keeps task-tree utilities together; confirm task-utils has no name clash).
  - ADD field to TasksJsonRecoveryResult (line 60): `readonly backlog?: Backlog;`.
  - RESTRUCTURE recoverTasksJson (line 158):
      * Keep the outer non-fatal try/catch (NEVER throws).
      * PATH A (clean disk, ~line 172): replace the `readTasksJSON → reconstruct
        → writeTasksJSON` with:
            const written = await withLockedTasksJSON(sessionDir, (fresh) => {
              const base = opts?.baselineBacklog
                ? structuredClone(opts.baselineBacklog)   // caller-owned → clone
                : fresh;                                   // already fresh Zod object (R6: no clone)
              setItemStatus(base, legitimateDelta.itemId, legitimateDelta.status);
              return base;
            });
            return { restored:false, source:'disk', reason:'re-applied legitimate status delta', backlog: written };
        NOTE: the disk-validity probe (`try readTasksJSON → validateBacklogState`)
        STAYS OUTSIDE the accessor (it decides which path to take) — that read is
        best-effort and harmless.
      * PATH B (git restore, ~line 194): do the git walk FIRST (outside any lock):
            const history = await gitFileHistory(relPath, repoPath);
            let restoredBacklog: Backlog | null = null; let restoreCommit: string | null = null;
            for (const entry of history) {
              const blob = await gitReadFileAtCommit(relPath, entry.commit, repoPath);
              try { restoredBacklog = BacklogSchema.parse(JSON.parse(blob)); restoreCommit = entry.commit; break; }
              catch { continue; }
            }
            if (!restoredBacklog) { /* PATH C log + return {restored:false,...,backlog:undefined} */ }
        THEN enter the accessor:
            const written = await withLockedTasksJSON(sessionDir, (fresh) => {
              // Another writer may have healed disk during the walk — prefer a
              // now-valid fresh read; else use the restored blob.
              const freshValid = validateBacklogState(fresh).isValid;
              const base = freshValid ? fresh : structuredClone(restoredBacklog!);
              setItemStatus(base, legitimateDelta.itemId, legitimateDelta.status);
              return base;
            });
            return { restored:true, source:'git', reason:`restored from commit ${restoreCommit}`, backlog: written };
      * PATH C (no valid version / any error): return {restored:false, source:'disk', reason:'...', backlog:undefined}.
  - IMPORT: `import { withLockedTasksJSON } from './file-lock.js';`
    (setItemStatus is local/exported; readTasksJSON/writeTasksJSON imports can be
    REMOVED from this file — the accessor does the read/write. Keep readTasksJSON
    ONLY if still used for the PATH-A validity probe; writeTasksJSON import is no
    longer needed here.)
  - GOTCHA: keep the `dirname(resolve(tasksPath))` sessionDir derivation (line 161).
  - GOTCHA: structuredClone is needed for opts.baselineBacklog and restoredBacklog
    (caller/repo-owned) but NOT for `fresh` (already a fresh Zod object) — R6.
  - FOLLOW pattern: keep the logger() lazy-init + all existing log lines.

Task 4: EDIT src/core/task-orchestrator.ts — #recoverAfterAgentRun uses result.backlog (R5)
  - MODIFY #recoverAfterAgentRun (line 1089): after `const recovery = await
    recoverTasksJson(...)`, replace the unconditional
    `const recovered = await readTasksJSON(session.metadata.path)` (line 1132)
    with:
        const recovered = recovery.backlog ?? await readTasksJSON(session.metadata.path).catch(() => null);
        if (recovered) {
          (this.sessionManager.currentSession as { taskRegistry: Backlog }).taskRegistry = recovered;
          await this.refreshBacklog();
        }
    (When recovery returned a backlog, skip the second locked read entirely — no
    TOCTOU window. When it didn't — PATH-C failure — fall back to a best-effort
    read, tolerating a throw by catching to null.)
  - GOTCHA: keep the surrounding non-fatal try/catch (a reload failure must not
    terminate the session, PRD §5.1).
  - NO other changes to task-orchestrator.ts. setStatus (331) and the flushUpdates
    call sites (995, 1056) are unchanged — they already flow through the
    internally-routed SessionManager.

Task 5: PATCH the mock-everything test files (a/b/c) + the orchestrator test (d)
  Task 5a — tests/unit/core/session-manager.test.ts:
    - ADD (next to the existing session-utils vi.mock):
        vi.mock('../../../src/core/file-lock.js', () => ({
          // Passthrough: node:fs is mocked + session path is fake here, so skip
          // the real O_EXCL lock and run the mutator on the caller's backlog.
          withLockedTasksJSON: vi.fn(async (_sessionDir, mutator) => {
            // The real accessor reads disk first; the mocked readTasksJSON is a
            // bare vi.fn(). Pass a minimal backlog so the mutator's setItemStatus
            // (if any) does not crash; for full-overwrite init writes the mutator
            // ignores it.
            return mutator((await (await import('../../../src/core/session-utils.js')).readTasksJSON(_sessionDir)) ?? { backlog: [] });
          }),
        }));
      (If the bare readTasksJSON mock returns undefined and crashes the mutator,
       simplify to `return mutator({ backlog: [] } as any)` — the existing
       assertions key off the spied writeTasksJSON, which the passthrough still
       reaches via the real saveBacklog? NO — saveBacklog now calls
       withLockedTasksJSON, NOT writeTasksJSON directly. So the spied
       writeTasksJSON will NOT fire. UPDATE the affected assertions to spy on
       withLockedTasksJSON instead, OR have the passthrough call the spied
       writeTasksJSON. PREFERRED: keep the spy on writeTasksJSON by having the
       passthrough import and call it: see Task 5 note below.)
  Task 5b — tests/unit/core/flush-retry.test.ts: same passthrough as 5a.
  Task 5c — tests/unit/core/session-state-batching.test.ts: same passthrough as 5a.
  Task 5d — tests/unit/core/task-orchestrator.test.ts:
    - UPDATE the recovery mock factory (line ~98) to include `backlog: undefined`
      (or a fixture backlog) in its resolved value, matching the new
      TasksJsonRecoveryResult shape. If any test asserts on result.backlog being
      consumed, add a fixture.
  - NOTE on the passthrough body: the cleanest passthrough that keeps the
    EXISTING writeTasksJSON spies working is to have the mock CALL the same spied
    writeTasksJSON after running the mutator — but that re-couples the test to
    the implementation. The SIMPLER and more honest approach: change the spied
    symbol in those 3 files from `writeTasksJSON` to `withLockedTasksJSON` (the
    new write boundary) and have the passthrough be a thin `async (_d, m) =>
    m(mockRead)` that records the call. Inspect each file's assertions and pick
    the option that minimizes diff while keeping the test's intent (assert the
    backlog was persisted). The research doc (test-conventions.md §3) gives the
    minimal passthrough; adjust per-file as needed.

Task 6: CREATE tests/unit/core/session-manager-locking.test.ts — real-tmpdir merge-under-lock proof
  - SETUP: NO vi.mock('node:fs'). Real tmpdir per test:
        const dir = await mkdtemp(join(tmpdir(), 'sm-lock-'));
        afterEach: await rm(dir, { recursive:true, force:true });
    Mirror tests/unit/core/tasks-json-recovery.test.ts header + helpers.
  - HELPER: seedTasksJSON(dir, backlog) writes a valid minimal Backlog (reuse the
    fixture shape from tasks-json-recovery.test.ts). Construct a REAL
    SessionManager against `dir` (use the existing constructor + initialize() /
    loadSession() pattern — read session-manager.test.ts to see how a real
    SessionManager is pointed at a tmpdir; if that needs a session metadata
    object, build a minimal one).
  - IMPLEMENT cases:
      1. MERGE-UNDER-LOCK (the core invariant): seed backlog with X=Planned,
         Y=Planned. Writer B (simulate the supervisor) directly sets Y=Ready on
         disk via a FIRST withLockedTasksJSON call (or a direct writeTasksJSON)
         and flushes. Writer A: SessionManager.updateItemStatus(X, Complete) then
         flushUpdates(). Assert on-disk (real readTasksJSON) has X=Complete AND
         Y=Ready (Y was NOT clobbered back to Planned). This is the PRD §5.1
         lost-update proof.
      2. CONCURRENT SERIALIZATION: two overlapping flushUpdates (or two
         withLockedTasksJSON) on the same dir via Promise.all, each sleeping
         ~20ms inside the mutator and setting a different item's status; assert
         BOTH statuses land on disk (not last-writer-wins). (S1's file-lock.test
         has the raw-accessor counter case; this is the SessionManager-level
         equivalent.)
      3. DELTA CLEAR ON SUCCESS: after a successful flushUpdates, a second
         flushUpdates with no intervening updateItemStatus is a no-op (assert no
         write / #dirty cleared).
      4. RECOVERY RETURNS BACKLOG: recoverTasksJson against a tmpdir with real
         git (mirror tasks-json-recovery.test.ts makeRepo) asserts result.backlog
         is defined and equals the on-disk state after the legitimate delta.
      5. RE-ENTRANT DELTA PRESERVATION (D4): an outer withLockedTasksJSON
         mutator that applies delta A and calls withLockedTasksJSON on the SAME
         dir applying delta B; assert the result has BOTH A and B (proves the
         stashed in-flight backlog, not a disk re-read).
  - FOLLOW pattern: describe('session-manager locking', () => {...}); real I/O;
    assert via real readTasksJSON on the final disk state.
  - PLACEMENT: tests/unit/core/session-manager-locking.test.ts.
```

### Implementation Patterns & Key Details

```typescript
// ── Pattern: delta-merge mutator in saveBacklog (Task 2) ──
async saveBacklog(backlog: Backlog): Promise<void> {
  if (!this.#currentSession) throw new Error('Cannot save backlog: no session loaded');
  const sessionDir = this.#currentSession.metadata.path;
  const deltas = this.#pendingDeltas;   // captured; flushUpdates clears on success
  const written = await withLockedTasksJSON(sessionDir, (fresh) => {
    if (deltas.length === 0) return backlog;          // init-time full write (single writer)
    for (const d of deltas) setItemStatus(fresh, d.itemId, d.status); // merge ONLY deltas (R1)
    return fresh;
  });
  // Sync memory to the MERGED result (picks up concurrent changes too):
  this.#currentSession = { ...this.#currentSession, taskRegistry: written };
}

// ── Pattern: recoverTasksJson PATH A inside the lock (Task 3) ──
const written = await withLockedTasksJSON(sessionDir, (fresh) => {
  const base = opts?.baselineBacklog ? structuredClone(opts.baselineBacklog) : fresh;
  setItemStatus(base, legitimateDelta.itemId, legitimateDelta.status);
  return base;
});
return { restored: false, source: 'disk', reason: 're-applied legitimate status delta', backlog: written };

// ── Pattern: PATH B git walk OUTSIDE the lock, merge INSIDE (Task 3, R3) ──
// Phase 1 (no lock): find last valid committed version
let restoredBacklog: Backlog | null = null;
const history = await gitFileHistory(relPath, repoPath);     // may take seconds — NOT under lock
for (const entry of history) {
  try {
    const blob = await gitReadFileAtCommit(relPath, entry.commit, repoPath);
    restoredBacklog = BacklogSchema.parse(JSON.parse(blob));
    break;
  } catch { continue; }
}
if (!restoredBacklog) return { restored:false, source:'disk', reason:'no valid version in git history', backlog: undefined };
// Phase 2 (under lock, sub-second): merge onto fresh read (another writer may have healed disk)
const written = await withLockedTasksJSON(sessionDir, (fresh) => {
  const base = validateBacklogState(fresh).isValid ? fresh : structuredClone(restoredBacklog!);
  setItemStatus(base, legitimateDelta.itemId, legitimateDelta.status);
  return base;
});
return { restored:true, source:'git', reason:`restored from git history`, backlog: written };

// ── Pattern: D4 stashed in-flight backlog (Task 1) ──
// ownership store: AsyncLocalStorage<{ held: Set<string>; inflight: Map<string, Backlog> }>
const ctx = ownership.getStore();
if (ctx?.held.has(sessionDir)) {
  const inflight = ctx.inflight.get(sessionDir);
  return mutator(inflight ?? await readTasksJSON(sessionDir)); // operate on SAME object
}
// ... in the critical section, after the locked read:
//   const backlog = await readTasksJSON(sessionDir);
//   inflightForRun.set(sessionDir, backlog);   // stash for re-entrant inner calls
//   const next = await mutator(backlog);
```

### Integration Points

```yaml
CONFIG:
  - no new env vars (TASKS_LOCK_* from S1 are reused as-is; keep staleMs=30s).

MODULE EXPORTS:
  - src/core/tasks-json-recovery.ts: EXPORT setItemStatus (+ AnyItem type, or move
    both to src/utils/task-utils.ts — preferred; confirm no name clash).
  - src/core/tasks-json-recovery.ts: TasksJsonRecoveryResult gains `backlog?: Backlog`.

IMPORTS (new):
  - src/core/session-manager.ts:  withLockedTasksJSON (./file-lock.js), setItemStatus (./tasks-json-recovery.js or ../utils/task-utils.js)
  - src/core/tasks-json-recovery.ts: withLockedTasksJSON (./file-lock.js)
  - (src/core/task-orchestrator.ts: no new imports — result.backlog is on the existing return)

IMPORTS (removable):
  - src/core/tasks-json-recovery.ts: writeTasksJSON no longer called here (accessor does it);
    readTasksJSON may still be used for the PATH-A validity probe — keep only if used.

NO DATABASE / NO ROUTES / NO REGISTRY CHANGES.

DOWNSTREAM (this task COMPLETES P3.M1.T2 — no further wiring):
  - ConcurrentTaskExecutor.executeParallel (concurrent-executor.ts:360) inherits
    the lock via flushUpdates — no edit needed.
  - ResearchQueue (research-queue.ts) inherits via orchestrator.setStatus →
    updateItemStatus/flushUpdates — no edit needed.
  - prp-pipeline.ts saveBacklog callers (handleDelta:691, decomposePRD:820) are
    init-time single-writer full writes — handled by the `deltas.length === 0`
    branch (return the caller's backlog verbatim). No edit needed.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run lint            # eslint . --ext .ts — zero errors
npm run typecheck       # tsc --noEmit — zero errors (watch the TasksJsonRecoveryResult + LockOwnership shape changes)
npm run format:check    # prettier --check — zero diffs (run `npm run format` to fix)
# Expected: clean. Read any error before proceeding — a type error here usually
# means the TasksJsonRecoveryResult or LockOwnership shape didn't propagate.
```

### Level 2: Unit Tests (Component Validation)

```bash
# The new real-tmpdir merge-under-lock proof (the core PRD §5.1 invariant):
npx vitest run tests/unit/core/session-manager-locking.test.ts --reporter=verbose

# The 3 patched mock-everything suites must stay green:
npx vitest run tests/unit/core/session-manager.test.ts tests/unit/core/flush-retry.test.ts tests/unit/core/session-state-batching.test.ts -v

# Recovery still green (real tmpdir; lock auto-acquires/releases):
npx vitest run tests/unit/core/tasks-json-recovery.test.ts -v

# Orchestrator recovery path (mock shape updated for result.backlog):
npx vitest run tests/unit/core/task-orchestrator.test.ts -v

# The S1 lock tests (D4 fast-path change must not regress):
npx vitest run tests/unit/core/file-lock.test.ts -v

# Full suite:
npm run test:run   # or `npm run validate` (lint + format + typecheck + test)
# Expected: all green. If a mock-everything suite throws `openSync is not a
# function`, the file-lock passthrough mock (Task 5a/b/c) is missing or mis-typed.
```

### Level 3: Integration Testing (Concurrency proof)

```bash
# Manual end-to-end lost-update proof (real filesystem, two processes):
# Process A simulates the supervisor writing Y=Ready; Process B simulates the
# executor batching X=Complete then flushing. After both, tasks.json MUST have
# both X=Complete and Y=Ready.
node --input-type=module -e '
import { withLockedTasksJSON } from "./src/core/file-lock.ts";
import { writeFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os"; import { join } from "node:path";
const dir = mkdtempSync(join(tmpdir(),"e2e-"));
const seed = { backlog: [{ id:"P1", title:"p", status:"Planned", points:1, milestones:[{ id:"P1.M1", title:"m", status:"Planned", points:1, tasks:[{ id:"P1.M1.T1", title:"t", status:"Planned", points:1, subtasks:[ {id:"X",title:"x",status:"Planned",points:1,subtasks:[]}, {id:"Y",title:"y",status:"Planned",points:1,subtasks:[]} ]}]}]}] };
writeFileSync(join(dir,"tasks.json"), JSON.stringify(seed));
// supervisor writes Y=Ready (concurrent writer)
await withLockedTasksJSON(dir, b => { setY(b,"Ready"); return b; });
// executor flushes a batched X=Complete (simulated via the accessor directly)
await withLockedTasksJSON(dir, b => { setX(b,"Complete"); return b; });
const final = JSON.parse(readFileSync(join(dir,"tasks.json"),"utf8"));
const st = id => findStatus(final, id);
console.log({ X: st("X"), Y: st("Y") });  // expect { X:"Complete", Y:"Ready" }
function setY(b,s){b.backlog[0].milestones[0].tasks[0].subtasks[1].status=s;}
function setX(b,s){b.backlog[0].milestones[0].tasks[0].subtasks[0].status=s;}
function findStatus(b,id){for(const p of b.backlog)for(const m of p.milestones)for(const t of m.tasks)for(const s of t.subtasks)if(s.id===id)return s.status;}
'
# Expected: { X: 'Complete', Y: 'Ready' } — Y survived the executor's flush.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Stale-lock-during-git-walk safety check (proves R3 — git never holds the lock):
# Plant a real git repo, corrupt tasks.json, run recoverTasksJson while a second
# caller is polling the lockfile mtime; assert the lock is NEVER held for more
# than a few hundred ms (well under staleMs). This is best done as a vitest case
# in session-manager-locking.test.ts (case: "recoverTasksJson does not hold the
# lock across the git walk") rather than a shell one-liner.

# Coverage gate:
npx vitest run tests/unit/core/ --coverage
# Expected: the delta-merge branches in session-manager.ts (deltas.length===0 vs
# >0) and the recoverTasksJson PATH-A/PATH-B-inside-lock branches are covered.
```

---

## Final Validation Checklist

### Technical Validation

- [ ] Level 1: `npm run lint && npm run typecheck && npm run format:check` GREEN
- [ ] Level 2: new `session-manager-locking.test.ts` GREEN + the 5 existing
      affected suites GREEN (session-manager, flush-retry, session-state-batching,
      tasks-json-recovery, task-orchestrator, file-lock)
- [ ] Level 3: manual e2e shows `{X:'Complete', Y:'Ready'}` (no lost update)
- [ ] Full suite: `npm run validate` GREEN

### Feature Validation

- [ ] Merge-under-lock: a concurrent writer's status survives a batched
      `flushUpdates` (real-tmpdir test case 1)
- [ ] Concurrent serialization: two overlapping flushes both land (case 2)
- [ ] Delta clear on success: second flush with no updates is a no-op (case 3)
- [ ] Recovery returns backlog: `result.backlog` defined and equals disk (case 4)
- [ ] Re-entrant delta preservation (D4): outer+inner deltas both land (case 5)
- [ ] writeTasksJSON NOT routed: `grep withLockedTasksJSON src/core/session-utils.ts` empty
- [ ] Git walk outside lock: lock held only sub-second during recovery (R3)

### Code Quality Validation

- [ ] Single canonical merge: `setItemStatus` exported and reused by both
      session-manager and tasks-json-recovery (no duplicate tree-walk)
- [ ] `writeTasksJSON`/`readTasksJSON` signatures unchanged (low-level primitives intact)
- [ ] `recoverTasksJson` remains NON-FATAL (outer try/catch preserved; lock
      acquisition errors return a PATH-C-shaped result)
- [ ] Zero new runtime dependencies (`git diff package.json` shows no dep changes)
- [ ] JSDoc on the modified `saveBacklog`/`flushUpdates`/`recoverTasksJson`
      documents the lock + merge guarantee per PRD §Mode A

### Documentation & Deployment

- [ ] `TasksJsonRecoveryResult.backlog` documented in the interface JSDoc
- [ ] `setItemStatus` export documented (moved to task-utils.ts preferred)
- [ ] No user-facing/config/API surface change (internal concurrency guarantee) —
      matches contract item 4 OUTPUT ("Completes P3.M1.T2") and item 5 DOCS ("none")

---

## Anti-Patterns to Avoid

- ❌ **Do NOT route `writeTasksJSON` through `withLockedTasksJSON`.** It is a pure
  write (no read); wrapping it discards the accessor's fresh read and
  reintroduces the overwrite bug. `writeTasksJSON` stays the primitive the
  accessor calls internally for its WRITE step (R2).
- ❌ **Do NOT make the mutator return `#pendingUpdates` (the stale snapshot).**
  That overwrites fresh disk and re-clobbers a concurrent writer even WITH the
  lock. The mutator MUST apply `#pendingDeltas` onto `fresh` and return `fresh`
  (R1). The lock serializes RMW windows; the delta provides the merge granularity.
- ❌ **Do NOT hold the O_EXCL lockfile across the PATH-B git walk.** The walk is
  read-only and can take seconds; a waiter's stale-age check (`Date.now() -
  mtimeMs > staleMs`) would delete a LIVE lock → both run RMW concurrently →
  silent corruption. Walk git FIRST, then enter the accessor (R3).
- ❌ **Do NOT leave the S1 re-entrant fast path re-reading disk.** S2 introduces
  MUTATING mutators (delta apply in place); a re-entrant inner call that re-reads
  disk loses the outer's in-flight deltas. Stash the in-flight backlog in the
  AsyncLocalStorage store and pass THAT to the inner mutator (D4/R4).
- ❌ **Do NOT let `recoverTasksJson` throw.** It is NON-FATAL by contract. A
  `TasksLockAcquisitionError` (lock timeout) must be caught by the outer guard
  and returned as a PATH-C-shaped result, never propagated to the orchestrator.
- ❌ **Do NOT forget the 3 mock-everything test passthroughs.** Without
  `vi.mock('../../../src/core/file-lock.js', passthrough)` in
  session-manager.test.ts / flush-retry.test.ts / session-state-batching.test.ts,
  they throw `TypeError: openSync is not a function` (node:fs mock lacks sync fns)
  and ENOENT (fake session path). The passthrough is mandatory (Task 5a/b/c).
- ❌ **Do NOT sync `#currentSession.taskRegistry` to the stale input.** After the
  accessor returns the MERGED backlog, sync memory to THAT (it includes concurrent
  writers' changes), or memory and disk diverge.
- ❌ **Do NOT reduce `staleMs` to "tighten" detection.** A tight staleMs causes
  false positives on legitimate long holders. Keep the 30s default; move long
  work (git) outside the lock instead (R7).
- ❌ **Do NOT introduce a second `SessionManager`.** There is ONE per pipeline run
  (`prp-pipeline.ts:1779`), shared by orchestrator + researchQueue +
  concurrent-executor. The in-process mutex keys on `sessionDir`, so all writers
  for one session serialize on one lock — that invariant must hold.
- ❌ **Do NOT call `writeTasksJSON` from inside a mutator.** The accessor already
  validates + atomicWrites the returned backlog. A second write inside the
  mutator is a re-entrant write and corrupts the RMW contract.