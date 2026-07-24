# PRP — P3.M1.T2.S1: Add flock-based process-level mutex for tasks.json read-modify-write

---

## Goal

**Feature Goal**: Provide a **process-level mutual-exclusion primitive** that
serializes every read-modify-write (RMW) of `tasks.json` so the foreground
executor (`Implementing`/`Complete`) and the background research supervisor
(`Researching`/`Ready`, from P3.M1.T1) cannot interleave their RMW cycles and
clobber a status back. Per PRD §5.1 "tasks.json Write Concurrency
(lost-update prevention)": "every read-modify-write of `tasks.json` MUST be
serialized under an exclusive lock (e.g. `flock` on a sibling lockfile),
scoped so it is safe under recursion and the backgrounded supervisor."

**Deliverable** (1 new file + 1 constants entry; S2 wires callers in):
1. **`src/core/file-lock.ts`** — CREATE: a zero-dependency process-level file
   lock + a `withLockedTasksJSON()` locked-accessor that wraps
   `readTasksJSON` → mutate → `writeTasksJSON` (which already does temp+rename
   atomic write) inside an exclusive lock.
2. **`src/config/constants.ts`** — ADD: lock-tuning env constants
   (`TASKS_LOCK_STALE_MS`, `TASKS_LOCK_TIMEOUT_MS`, `TASKS_LOCK_POLL_MS`) +
   readers, following the exact `RESEARCH_TIMEOUT`/`getResearchTimeoutSeconds()`
   pattern already in the file.
3. **`tests/unit/core/file-lock.test.ts`** — CREATE: real-tmpdir integration
   tests (NOT module-mocked) covering mutual exclusion, stale-lock recovery,
   PID-based recovery, and the `withLockedTasksJSON` RMW contract — following
   the `tests/unit/core/tasks-json-recovery.test.ts` pattern.

**Scope note (critical):** This task (S1) delivers the **utility only**. It
does NOT yet route the existing callers (`SessionManager.flushUpdates`,
`tasks-json-recovery.recoverTasksJson`, etc.) through it — that is
**P3.M1.T2.S2 ("Wrap all RMW paths through the locked accessor")**. S1 must
be additive and non-breaking: existing behavior is unchanged because nothing
imports the new module yet. S2 will add the imports.

**Success Definition**:
- `withLockedTasksJSON(sessionDir, mutator)` acquires an exclusive OS lock on
  `sessionDir/tasks.json.lock` before reading, holds it across the mutator
  callback, and releases it in a `finally` — verified by a test where two
  concurrent invocations are provably serialized (the second does not see a
  half-applied mutation from the first).
- A crashed/leftover lockfile (`tasks.json.lock`) is auto-recovered: both
  age-based (`> staleMs`) and PID-based (`process.kill(pid,0)` → ESRCH)
  stale detection, so a SIGKILLed process does not wedge the next caller for
  the full `staleMs`.
- Recursion-safe within the process: a `mutator` that transitively re-enters
  `withLockedTasksJSON` on the SAME session dir does NOT deadlock (re-entrant
  fast path via in-process ownership tracking). A re-entrant call on a
  DIFFERENT session dir correctly acquires a second independent lock.
- Zero new runtime dependencies (`package.json` `dependencies` unchanged).
- `npm run validate` GREEN; 100% coverage on `src/core/file-lock.ts`.

---

## User Persona (if applicable)

**Target User**: Pipeline operator running `-r` / `PARALLEL_RESEARCH=true`
(P3.M1.T1), where a background research supervisor writes `Researching` /
`Ready` statuses concurrently with the foreground executor writing
`Implementing` / `Complete`.
**Use Case**: Long backlog run with depth-chained prefetch — supervisor marks
item N+3 `Researching` while executor marks item N `Complete`. Without a lock
their RMW windows interleave and the loser clobbers the winner's status back.
**User Journey**: `prd -r --research-depth 3` → supervisor + executor both
touch `tasks.json` → both go through the locked accessor (S2) → statuses are
never silently reverted.
**Pain Points Addressed**: PRD §5.1 — "the supervisor reverts
`N:Implementing` → `N:Ready` because it read the file before the executor's
write landed." The restore/recovery path has the identical window.

---

## Why

- **PRD compliance**: PRD §5.1 (h3.9) mandates: "every read-modify-write of
  `tasks.json` MUST be serialized under an exclusive lock … scoped so it is
  safe under recursion and the backgrounded supervisor." and "Atomic writes
  alone do not prevent lost updates — process-level mutual exclusion does."
- **Contract item 3 (LOGIC)**: "(a) Create a locked-accessor utility … in
  `src/core/session-utils.ts` or a new `src/core/file-lock.ts`. … (b) The
  lock must serialize read-modify-write: acquire → read → mutate →
  atomicWrite → release. (c) Safe under recursion. (d) Safe when the
  backgrounded supervisor writes concurrently."
- **Architectural reality**: `atomicWrite` (`session-utils.ts:110`) uses
  temp+rename (crash-safe) but does NOT serialize concurrent writers — two
  writers each read a stale copy and the rename-last-wins clobbers a status.
  `SessionManager.flushUpdates()` (`session-manager.ts:761`) batches then
  writes; `ConcurrentTaskExecutor.executeParallel` → concurrent
  `executeSubtask` → concurrent `flushUpdates` (`concurrent-executor.ts:360`)
  can lose deltas. The background `ResearchQueue` (P3.M1.T1) adds a second
  concurrent writer.
- **Why a new file (`file-lock.ts`) instead of appending to `session-utils.ts`**:
  the contract explicitly permits either. A dedicated module keeps the
  locking primitive (reusable, testable in isolation) separate from the
  already-large `session-utils.ts` (~1080 lines), mirrors how
  `tasks-json-recovery.ts` is its own module, and gives S2 a clean import
  surface.
- **Why zero-dep O_EXCL over `proper-lockfile`**: research
  (`research/file-locking-patterns.md`) shows `proper-lockfile` has **no
  re-entrancy support** (a transitive re-entry deadlocks or, worse, trips a
  false-stale race after `stale` ms and silently lets both critical sections
  run concurrently), pulls in `graceful-fs`, and has mtime-only staleness.
  A zero-dep `fs.open(path,'wx')` (O_EXCL) implementation gives better stale
  detection (PID + mtime), full re-entrancy control, and matches this
  project's zero-lock-deps philosophy. See FACT 1.

---

## What

A `src/core/file-lock.ts` module exporting:

1. **`acquireTasksJSONLock(sessionDir, opts?)`** / **`releaseTasksJSONLock(sessionDir)`**
   — low-level acquire/release on `sessionDir/tasks.json.lock`.
2. **`withLockedTasksJSON(sessionDir, mutator, opts?)`** — the primary locked
   accessor: acquire → `readTasksJSON` → `mutator(backlog)` →
   `writeTasksJSON` → release (in `finally`). Re-entrant within the process
   for the same `sessionDir`.
3. Optional generic **`withFileLock(dataPath, fn, opts?)`** — the underlying
   primitive (locked on `dataPath + '.lock'`) that `withLockedTasksJSON` is
   built on; exported for any future locked resource.

The lockfile path is a **sibling** of `tasks.json` (i.e.
`sessionDir/tasks.json.lock`), matching the PRD's "flock on a sibling
lockfile" wording. It must NOT be `tasks.json.tmp.*` (those are the
atomic-write temp files) and must NOT collide with any `$SESSION_DIR` root
protected file (§5.1 — the lockfile is not a protected file; cleanup is
optional/best-effort).

### Success Criteria

- [ ] `withLockedTasksJSON` serializes two concurrent RMWs on the same
      `sessionDir` — verified by a test where a `mutator` observes a stale
      read if unsynchronized; passes under the lock.
- [ ] A pre-existing `tasks.json.lock` whose PID is dead (`ESRCH`) is
      removed and acquisition succeeds without waiting `staleMs`.
- [ ] A pre-existing `tasks.json.lock` older than `staleMs` is removed and
      acquisition succeeds (age-based fallback, the PID-alive path not firing).
- [ ] A re-entrant `withLockedTasksJSON` (mutator calls
      `withLockedTasksJSON` on the same session dir) does NOT deadlock and
      does NOT re-read/re-write (the inner call is a no-op passthrough OR
      operates on the in-progress backlog — see Implementation Decision D3).
- [ ] `package.json` `dependencies` array is byte-identical (no new dep).
- [ ] `npm run validate` GREEN; `file-lock.ts` at 100% coverage.

---

## All Needed Context

### Context Completeness Check

✅ "If someone knew nothing about this codebase, would they have everything
needed to implement this successfully?" — YES. This PRP names the exact
files, the exact functions to reuse (`atomicWrite`, `readTasksJSON`,
`writeTasksJSON`), the exact env-constant pattern to copy, the exact test
file to mirror, and includes the full locking algorithm with code.

### Documentation & References

```yaml
# MUST READ - Include these in your context window
- url: https://nodejs.org/api/fs.html#fopenpath-flags-mode
  why: Documents 'wx' flag = O_WRONLY|O_CREAT|O_EXCL — the atomic "create if
       not exists" primitive the lock is built on. EEXIST is the "already locked" signal.
  critical: 'wx' fails ATOMICALLY with EEXIST if the file exists — no TOCTOU gap.

- url: https://nodejs.org/api/process.html#processkillpid-signal
  why: process.kill(pid, 0) is the cross-platform "is process alive?" check.
       signal 0 sends no signal, just checks existence.
  critical: ESRCH = no such process (dead → lock is stale); EPERM = exists but
            no permission (alive → keep waiting). MUST treat EPERM as ALIVE.

- url: https://man7.org/linux/man-pages/man2/rename.2.html
  why: confirms rename() is atomic on the same filesystem — this is why
       atomicWrite (temp+rename) is crash-safe and why the lock release
       (unlink) ordering does not corrupt tasks.json.

- file: src/core/session-utils.ts
  why: (1) atomicWrite (line 110) is the existing temp+rename primitive —
           DO NOT reimplement; the locked accessor calls writeTasksJSON which
           already uses it. (2) readTasksJSON (line 841) + writeTasksJSON
           (line 746) are the RMW read/write the accessor wraps. (3) The
           SessionFileError class (line ~80) + logger() pattern (line ~73)
           are the error/logging conventions to reuse.
  pattern: copy the module-private `const logger = (): Logger => (_logger ??= getLogger('file-lock'));`
           idiom and the SessionFileError envelope for lock I/O failures.
  gotcha: readTasksJSON/writeTasksJSON take a sessionDir (directory), NOT a
          file path — they resolve 'tasks.json' internally. The lockfile must
          be resolved by the accessor: resolve(sessionDir, 'tasks.json.lock').

- file: src/config/constants.ts
  why: THE pattern to copy for the new env constants. Lines 228-282
       (RESEARCH_TIMEOUT const + DEFAULT_* + getResearchTimeoutSeconds()
       reader with try/catch fallback) are the canonical "env-var-backed
       tunable" idiom in this codebase.
  pattern: export const NAME='NAME'; export const DEFAULT_NAME=<num>;
           export function getName(): number { try { raw=Number(process.env[NAME]??DEFAULT); return Number.isFinite?raw:DEFAULT } catch { return DEFAULT } }
  gotcha: the const holds the STRING env-var NAME; the reader returns the
          parsed number with a finite+fallback guard. Follow it EXACTLY.

- file: tests/unit/core/tasks-json-recovery.test.ts
  why: THE test pattern to mirror. It uses a REAL tmpdir + REAL filesystem
       (mkdtemp/rm) and NO module-wide vi.mock — exactly what lock tests need
       (you cannot meaningfully test an O_EXCL file lock against mocked fs).
  pattern: `const dir = await mkdtemp(join(tmpdir(),'filelock-'));` per test,
           `await rm(dir,{recursive:true,force:true})` in afterEach. Import
           from 'node:fs/promises' directly.
  gotcha: do NOT vi.mock('node:fs') in the lock tests — that would defeat the
          O_EXCL semantics under test. The tasks-json-recovery.test.ts is the
          reference for "real I/O" tests in this otherwise-mocked suite.

- docfile: plan/008_15504f60a0ef/P3M1T2S1/research/file-locking-patterns.md
  why: Full zero-dep O_EXCL implementation (acquireFileLock/releaseFileLock/
       withFileLock), stale detection (PID+mtime), the 3-layer architecture,
       recursion-safety options, and the top-5 pitfalls. This PRP's
       Implementation Blueprint is derived from it.
  section: "2. Zero-Dependency O_EXCL Implementation" (code),
           "4. Recursion-Safety" (design decision D3), "Top 5 Pitfalls".
```

### Current Codebase tree (relevant slice)

```bash
src/
  config/
    constants.ts            # env-var-backed tunables; add lock constants here
  core/
    session-utils.ts        # atomicWrite, readTasksJSON, writeTasksJSON, SessionFileError
    session-manager.ts      # flushUpdates()/saveBacklog() — RMW caller (S2 wires this)
    tasks-json-recovery.ts  # recoverTasksJson() — RMW caller (S2 wires this)
    concurrent-executor.ts  # calls flushUpdates() concurrently (S2 wires this)
    research-queue.ts       # background supervisor writer (S2 wires this)
tests/
  unit/
    core/
      tasks-json-recovery.test.ts  # real-tmpdir test pattern to MIRROR
      session-utils.test.ts        # module-mocked pattern (do NOT mirror for lock)
```

### Desired Codebase tree with files to be added

```bash
src/
  config/
    constants.ts            # MODIFY: add 3 lock constants + 3 readers (Task 1)
  core/
    file-lock.ts            # CREATE: O_EXCL lock + withLockedTasksJSON (Task 2)
tests/
  unit/
    core/
      file-lock.test.ts     # CREATE: real-tmpdir integration tests (Task 3)
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL: Node has NO native flock binding. The PRD says "flock on a sibling
// lockfile" — implement via fs.open(path, 'wx') (O_EXCL) + retry loop. See
// research/file-locking-patterns.md §2.

// CRITICAL: process.kill(pid, 0) semantics — ESRCH = dead (stale lock),
// EPERM = alive but no perms (KEEP WAITING, do NOT treat as stale). Inverting
// this deletes a live process's lock → silent concurrent RMW (worst bug).

// CRITICAL: vi.mock('node:fs') in the lock tests would make O_EXCL untestable.
// Mirror tests/unit/core/tasks-json-recovery.test.ts (REAL tmpdir, no mock).

// GOTCHA: readTasksJSON/writeTasksJSON take a session DIRECTORY, not a file.
// They internally resolve 'tasks.json'. The lockfile is a sibling:
//   resolve(sessionDir, 'tasks.json.lock')
// Do NOT pass 'tasks.json.lock' to readTasksJSON.

// GOTCHA: the lockfile (tasks.json.lock) lives in $SESSION_DIR root. PRD §5.1
// lists files that are "NEVER delete or move" — the lockfile is NOT among them.
// It is a transient sentinel; best-effort cleanup on release is fine, and stale
// detection handles the rest. Do NOT add it to any protected-files list.

// GOTCHA: 'wx' open requires the PARENT dir to exist. sessionDir always exists
// (it's the session root), so no mkdir needed — but write the stale-PID file
// content with writeSync(fd, JSON.stringify({pid,ts})) BEFORE closeSync(fd) so
// the PID is durable for the stale check.

// CRITICAL: release (unlink) MUST be in a finally block. A thrown mutator that
// skips release wedges every subsequent caller for staleMs. Same for the
// process-level signal handlers (exit/SIGINT/SIGTERM) — but those do NOT fire
// on SIGKILL, so stale detection is the real safety net (pitfall #1).
```

---

## Implementation Blueprint

### Implementation Decision: Lock algorithm & re-entrancy

**D1 — Algorithm:** zero-dependency O_EXCL lockfile (`fs.open(lockPath, 'wx')`)
with polling retry, dual stale detection (age > staleMs OR PID dead via
`process.kill(pid,0)===ESRCH`), and `try/finally` release. (research §2,
recommendation table.)

**D2 — Two layers:** (Layer 1) an in-process async mutex keyed by `sessionDir`
so concurrent async ops in the SAME process cheaply serialize without
filesystem thrash AND so re-entrancy can be detected; (Layer 2) the O_EXCL
lockfile so cross-process writers (backgrounded supervisor now or in future,
two CLI invocations, crash+restart) are excluded. (research §3 diagram.)

**D3 — Re-entrancy (research §4, Option A):** Use `AsyncLocalStorage<Set<string>>`
to track which session dirs the current async chain already holds a lock on.
A re-entrant call on the SAME sessionDir skips BOTH layers and runs the
mutator directly (it is already inside the critical section). A re-entrant
call on a DIFFERENT sessionDir acquires a second, independent lock.
Rationale: the call graph (S2) includes recovery paths that may call
`writeTasksJSON` from inside an already-locked region; a non-reentrant lock
would deadlock there. Option A (AsyncLocalStorage) is chosen over Option B
(callback-receives-data) because the existing `readTasksJSON`/`writeTasksJSON`
signature is directory-based and S2 must wrap diverse call sites without
rewriting their internals.

> **Testability note for D3:** AsyncLocalStorage propagates reliably across
> `async/await` in Node 20+. The re-entrancy test must use plain async/await
> (not detached `setImmediate`/raw EventEmitter listeners) or the ALS context
> won't propagate and the test will spuriously acquire a second lock.

### Data models and structure

No ORM/pydantic — this is TypeScript/ESM. The only data shape is the lockfile
contents (a tiny JSON sentinel):

```typescript
// Written into tasks.json.lock for stale detection
interface TasksLockInfo {
  /** PID of the process holding the lock (process.pid) */
  pid: number;
  /** ms epoch when acquired — for age-based staleness fallback */
  ts: number;
}
```

The accessor operates on the existing `Backlog` type (`src/core/models.ts`)
via the existing `readTasksJSON`/`writeTasksJSON` — no model changes.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/config/constants.ts — add lock-tuning env constants
  - ADD: export const TASKS_LOCK_STALE_MS = 'TASKS_LOCK_STALE_MS';
          export const DEFAULT_TASKS_LOCK_STALE_MS = 30_000;
          export function getTasksLockStaleMs(): number { ... }
  - ADD: export const TASKS_LOCK_TIMEOUT_MS = 'TASKS_LOCK_TIMEOUT_MS';
          export const DEFAULT_TASKS_LOCK_TIMEOUT_MS = 30_000;
          export function getTasksLockTimeoutMs(): number { ... }
  - ADD: export const TASKS_LOCK_POLL_MS = 'TASKS_LOCK_POLL_MS';
          export const DEFAULT_TASKS_LOCK_POLL_MS = 50;
          export function getTasksLockPollMs(): number { ... }
  - FOLLOW pattern: the RESEARCH_TIMEOUT block (constants.ts ~lines 228-282):
          `export const NAME='NAME'; export const DEFAULT_NAME=<num>;
           export function getName(): number { try { const raw=Number(process.env[NAME]??DEFAULT_NAME); return Number.isFinite(raw)&&raw>0?raw:DEFAULT_NAME } catch { return DEFAULT_NAME } }`
  - NAMING: SCREAMING_SNAKE for the env-var-name const, DEFAULT_ prefix for
            the numeric default, get{Name}() for the reader.
  - VALIDATE: poll and timeout must be > 0 (guard in reader, else default).
  - PLACEMENT: append to the RESEARCH_* block (keep concurrency-related
            constants together); do not reorder existing exports.

Task 2: CREATE src/core/file-lock.ts — the lock + locked accessor
  - IMPLEMENT (Layer 2 primitive): withFileLock<T>(dataPath, fn, opts?): Promise<T>
      * lockPath = dataPath + '.lock'
      * acquireFileLock(lockPath, opts): openSync(lockPath,'wx') → write
        {pid:process.pid,ts:Date.now()} → closeSync; on EEXIST check staleness
        (age>staleMs OR isProcessAlive(pid)===false) → unlink+retry; else
        sleep(pollMs) and retry until deadline (timeoutMs) → throw
        TasksLockAcquisitionError.
      * isProcessAlive(pid): process.kill(pid,0) — return true; catch →
        err.code==='EPERM' (alive, no perms) → true; else (ESRCH) → false.
      * releaseFileLock(lockPath): try unlinkSync; catch ignore (ENOENT = fine).
      * try { return await fn(); } finally { releaseFileLock(lockPath); }
  - IMPLEMENT (Layer 1 + re-entrancy): an in-process Map<string, Promise<void>>
      ownership gate + AsyncLocalStorage<Set<string>>:
      * const heldDirs = new Map<string, Promise<void>>();
        const ownership = new AsyncLocalStorage<Set<string>>();
      * withLockedTasksJSON(sessionDir, mutator, opts?):
          const owned = ownership.getStore();
          if (owned?.has(sessionDir)) return mutator(...);  // re-entrant fast path
          // serialize in-process: await prior holder for this dir, then take the slot
          ... acquire in-process mutex slot ...
          try {
            return await withFileLock(resolve(sessionDir,'tasks.json'), async () => {
              const backlog = await readTasksJSON(sessionDir);
              const next = await mutator(backlog);   // mutator returns the NEW Backlog
              if (next !== undefined) await writeTasksJSON(sessionDir, next);
            }, opts);
          } ... finally release in-process slot ...
      * RUN the mutator INSIDE ownership.run(new Set(owned??[]).add(sessionDir), ...)
        so transitive re-entries on the same dir short-circuit.
  - IMPLEMENT error type: export class TasksLockAcquisitionError extends Error
      { readonly lockPath; readonly timeoutMs; constructor(...) { super(...); this.name='TasksLockAcquisitionError' } }
  - IMPLEMENT best-effort process cleanup:
      * a module-level Set<string> of held lockPaths; on process 'exit'/
        'SIGINT'/'SIGTERM' releaseFileLock each. (Belt-and-suspenders; the
        stale detector is authoritative for SIGKILL.)
  - IMPORTS: from 'node:fs' (openSync,closeSync,writeSync,unlinkSync,statSync,readFileSync);
        from 'node:timers/promises' (setTimeout as sleep);
        from 'node:async_hooks' (AsyncLocalStorage);
        from 'node:path' (resolve); from '../utils/logger.js' (getLogger);
        from '../config/constants.js' (the 3 readers from Task 1);
        from './session-utils.js' (readTasksJSON, writeTasksJSON).
  - FOLLOW pattern: the logger() lazy-init idiom from session-utils.ts
        (const logger=():Logger=>(_logger??=getLogger('file-lock'));).
  - JSDoc (PRD §Mode A "DOCS rides WITH the work"): document on
        withLockedTasksJSON that it guarantees (1) mutual exclusion across
        processes for tasks.json RMW, (2) atomic write (via writeTasksJSON's
        existing temp+rename), (3) recursion-safety within the process, and
        (4) crash recovery via PID+mtime stale detection. Reference PRD §5.1.
  - NAMING: withFileLock, withLockedTasksJSON, acquireTasksJSONLock,
        releaseTasksJSONLock (camelCase fns); TasksLockAcquisitionError
        (PascalCase class).
  - DEPENDENCIES: Task 1 (constants). NONE on existing code paths (S1 is
        additive — nothing imports this yet).
  - GOTCHA: writeSync the {pid,ts} BEFORE closeSync so the sentinel is on
        disk for the stale check. Do NOT write it after close.
  - GOTCHA: statSync/readFileSync inside isStaleLock can throw if another
        process unlinks between the open EEXIST and the read — wrap in
        try/catch returning false (don't delete; just retry the open loop).

Task 3: CREATE tests/unit/core/file-lock.test.ts — real-tmpdir integration tests
  - SETUP: NO vi.mock('node:fs'). Use real tmpdir: in beforeEach,
        `dir = await mkdtemp(join(tmpdir(),'filelock-'));`; afterEach,
        `await rm(dir,{recursive:true,force:true});`. Mirror
        tests/unit/core/tasks-json-recovery.test.ts header (lines ~14-91).
  - HELPER: a seedTasksJSON(dir, backlog) test util that writes a valid
        minimal Backlog (reuse the fixture shape from
        tasks-json-recovery.test.ts) so readTasksJSON inside the accessor
        succeeds.
  - IMPLEMENT cases:
      1. withLockedTasksJSON runs the mutator and persists the returned backlog
         (read-back equals the mutated shape).
      2. MUTUAL EXCLUSION: spawn two concurrent withLockedTasksJSON on the
         SAME dir where each mutator sleeps ~30ms and increments a shared
         counter via the backlog; assert the final counter == 2 (serialized),
         not lost-update-corrupted. (Use a mutator that reads a counter field
         in the backlog, +1, returns it.)
      3. STALE-PID RECOVERY: manually write a tasks.json.lock with
         {pid: 999999, ts: Date.now()} (a PID that surely doesn't exist) →
         withLockedTasksJSON should acquire immediately (no staleMs wait),
         proving PID-based recovery.
      4. STALE-AGE RECOVERY: write a lock with {pid: process.pid (alive!),
         ts: Date.now() - (staleMs + 1000)} → acquisition succeeds (age path
         fires even though the PID is alive).
      5. RE-ENTRANCY: a mutator that calls withLockedTasksJSON on the SAME
         dir again returns without deadlock; assert the inner call did not
         re-read/re-write (spy on readTasksJSON or use a counter).
      6. RELEASE-ON-THROW: a mutator that throws → the lockfile is removed
         (next acquisition does not block) AND the error propagates.
      7. TIMEOUT: with opts.timeoutMs very small and a pre-existing lock
         with a live PID + fresh ts → acquireFileLock throws
         TasksLockAcquisitionError.
  - FOLLOW pattern: describe('core/file-lock', () => { ... }); Setup/Execute/Verify;
        use vitest's describe/it/expect/beforeEach/afterEach.
  - COVERAGE: every branch — EEXIST path, stale-pid branch, stale-age branch,
        deadline-throw branch, re-entrant fast path, finally-release, EPERM
        (simulate by... see note below).
  - GOTCHA: EPERM (alive-but-no-perms) is hard to trigger as non-root.
        Cover it by unit-testing isProcessAlive directly: mock process.kill to
        throw {code:'EPERM'} → assert returns true; throw {code:'ESRCH'} →
        assert returns false. (A tiny vi.spyOn(process,'kill') is acceptable
        here even in a real-I/O test file — it targets the one line that can't
        be exercised naturally.)
  - PLACEMENT: tests/unit/core/file-lock.test.ts (alongside the module).
```

### Implementation Patterns & Key Details

```typescript
// ── Pattern: the env-constant reader (copy from constants.ts RESEARCH_TIMEOUT) ──
export const TASKS_LOCK_STALE_MS = 'TASKS_LOCK_STALE_MS';
export const DEFAULT_TASKS_LOCK_STALE_MS = 30_000;
export function getTasksLockStaleMs(): number {
  const raw = Number(process.env[TASKS_LOCK_STALE_MS] ?? DEFAULT_TASKS_LOCK_STALE_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TASKS_LOCK_STALE_MS;
}
// (repeat the same shape for TIMEOUT_MS and POLL_MS)

// ── Pattern: cross-process acquire (research §2) ──
function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (err) { return (err as NodeJS.ErrnoException).code === 'EPERM'; } // EPERM=alive
}
function isStaleLock(lockPath: string, staleMs: number): boolean {
  try {
    const st = statSync(lockPath);
    if (Date.now() - st.mtimeMs > staleMs) return true;          // age fallback
    const info = JSON.parse(readFileSync(lockPath, 'utf8')) as TasksLockInfo;
    if (typeof info.pid === 'number' && !isProcessAlive(info.pid)) return true; // dead holder
    return false;
  } catch { return false; } // race: someone deleted it → don't delete, retry
}
async function acquireFileLock(lockPath: string, opts: LockOpts): Promise<void> {
  const deadline = Date.now() + opts.timeoutMs;
  for (;;) {
    try {
      const fd = openSync(lockPath, 'wx');               // O_EXCL atomic create
      writeSync(fd, JSON.stringify({ pid: process.pid, ts: Date.now() } as TasksLockInfo));
      closeSync(fd);
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
    if (isStaleLock(lockPath, opts.staleMs)) { try { unlinkSync(lockPath); } catch {} continue; }
    if (Date.now() >= deadline) throw new TasksLockAcquisitionError(lockPath, opts.timeoutMs);
    await sleep(opts.pollMs);
  }
}

// ── Pattern: locked accessor (Layer1 re-entrancy + Layer2 O_EXCL + RMW) ──
export async function withLockedTasksJSON(
  sessionDir: string,
  mutator: (b: Backlog) => Backlog | Promise<Backlog>,
  opts?: LockOpts,
): Promise<Backlog> {
  const owned = ownership.getStore();
  if (owned?.has(sessionDir)) {
    // re-entrant fast path — already inside this dir's critical section
    const cur = await readTasksJSON(sessionDir);     // NB: see D3 note
    return mutator(cur);
  }
  // Layer 1: in-process serialize for this dir
  while (_held.has(sessionDir)) await _held.get(sessionDir);
  let releaseInProc!: () => void;
  _held.set(sessionDir, new Promise<void>(r => { releaseInProc = r; }));
  try {
    const dataPath = resolve(sessionDir, 'tasks.json');
    return await ownership.run(new Set(owned ?? []).add(sessionDir), async () => {
      await acquireFileLock(dataPath + '.lock', resolveOpts(opts));
      try {
        const backlog = await readTasksJSON(sessionDir);     // READ
        const next = await mutator(backlog);                  // MODIFY
        await writeTasksJSON(sessionDir, next);               // WRITE (atomic)
        return next;
      } finally {
        try { unlinkSync(dataPath + '.lock'); } catch {}      // RELEASE
      }
    });
  } finally {
    _held.delete(sessionDir);
    releaseInProc();
  }
}
```

> **D3 refinement (re-entrant read semantics):** in the re-entrant fast path,
> re-reading `tasks.json` is SAFE because the outer caller already holds the
> lock and no other process can be mid-write. If you want to avoid the
> double-read, the outer critical section can stash the in-flight backlog in
> the AsyncLocalStorage store and the inner call returns that — but a plain
> re-read is simpler and correct. Pick one and document it in the JSDoc.

### Integration Points

```yaml
CONFIG:
  - add to: src/config/constants.ts (3 const/DEFAULT/reader triples)
  - pattern: RESEARCH_TIMEOUT block — env-var-name const + numeric DEFAULT + getter with finite/>0 guard
  - new env vars (document later in P6 CONFIGURATION.md, NOT this task):
      TASKS_LOCK_STALE_MS (default 30000), TASKS_LOCK_TIMEOUT_MS (default 30000),
      TASKS_LOCK_POLL_MS (default 50)

NO DATABASE / NO ROUTES / NO REGISTRY CHANGES (S1 is additive infra).

DOWNSTREAM CONSUMER (NOT in this task — P3.M1.T2.S2):
  - SessionManager.flushUpdates / saveBacklog  → route write through withLockedTasksJSON
  - tasks-json-recovery.recoverTasksJson        → route restore write through withLockedTasksJSON
  - ConcurrentTaskExecutor.executeSubtask       → inherits via flushUpdates
  - ResearchQueue background supervisor         → inherits via its status writes
  S1 must expose a STABLE exported surface (withLockedTasksJSON signature) so S2 is mechanical.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# After Task 1 (constants) and Task 2 (file-lock.ts):
npm run lint            # eslint . --ext .ts — zero errors
npm run typecheck       # tsc --noEmit — zero errors
npm run format:check    # prettier --check — zero diffs (run `npm run format` to fix)
# Expected: clean. Read any error before proceeding.
```

### Level 2: Unit Tests (Component Validation)

```bash
# Test the new module in isolation (real tmpdir, no fs mock):
npx vitest run tests/unit/core/file-lock.test.ts --reporter=verbose

# Confirm constants readers parse env + fall back:
npx vitest run tests/unit/core/  # if a constants test exists, else add inline assertions in file-lock.test.ts

# Coverage gate (this project targets 100% on src/**/*.ts):
npx vitest run tests/unit/core/file-lock.test.ts --coverage
# Expected: 100% lines/branches/funcs on src/core/file-lock.ts.
```

### Level 3: Integration Testing (Concurrency proof)

```bash
# Manual concurrency sanity check (proves the lock actually serializes):
node --input-type=module -e '
import { withLockedTasksJSON } from "./src/core/file-lock.ts";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os"; import { join } from "node:path";
const dir = mkdtempSync(join(tmpdir(), "manual-"));
writeFileSync(join(dir, "tasks.json"), JSON.stringify({backlog:[{id:"X",title:"t",status:"Planned",points:1,subtasks:[]}]}));
const mk = (label) => async (b) => { const c=(b.backlog[0].points)+1;
  await new Promise(r=>setTimeout(r,20)); b.backlog[0].points=c;
  console.log(label,"saw",c); return b; };
await Promise.all([ withLockedTasksJSON(dir,mk("A")), withLockedTasksJSON(dir,mk("B")) ]);
// Serialized ⇒ final points must equal initial+2 (no lost update).
console.log("final points:", JSON.parse(require("fs").readFileSync(join(dir,"tasks.json"))).backlog[0].points);
'
# Expected: A and B see sequential counters (e.g. A saw 2, B saw 3); final == initial+2.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Stale-lock recovery drill (simulate a crashed holder):
node --input-type=module -e '
import { withLockedTasksJSON } from "./src/core/file-lock.ts";
import { writeFileSync, mkdtempSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
const dir = mkdtempSync(join(tmpdir(),"drill-"));
writeFileSync(join(dir,"tasks.json"), JSON.stringify({backlog:[{id:"X",title:"t",status:"Planned",points:1,subtasks:[]}]}));
// plant a lock owned by a surely-dead PID
writeFileSync(join(dir,"tasks.json.lock"), JSON.stringify({pid:999999,ts:Date.now()}));
console.time("acquire-after-dead-pid");
await withLockedTasksJSON(dir, async b => { b.backlog[0].status="Complete"; return b; });
console.timeEnd("acquire-after-dead-pid");
// Expected: acquire-after-dead-pid is ~0ms (PID-based recovery, no 30s wait).
'
```

---

## Final Validation Checklist

### Technical Validation

- [ ] Level 1: `npm run lint && npm run typecheck && npm run format:check` GREEN
- [ ] Level 2: `npx vitest run tests/unit/core/file-lock.test.ts --coverage`
      → all pass, 100% on `src/core/file-lock.ts`
- [ ] Level 3: manual concurrency snippet shows serialized counters (no lost update)
- [ ] Level 4: stale-PID drill acquires in ~0ms (PID recovery working)
- [ ] Full suite GREEN: `npm run validate` (lint + format + typecheck + test:run)

### Feature Validation

- [ ] Mutual exclusion: two concurrent RMWs on the same dir are serialized
- [ ] Stale-PID recovery: dead-holder lock acquired immediately
- [ ] Stale-age recovery: old fresh-PID lock acquired via age fallback
- [ ] Re-entrancy: same-dir transitive call does NOT deadlock (ALS fast path)
- [ ] Different-dir: acquires an independent second lock
- [ ] Release-on-throw: mutator throwing still removes the lockfile + propagates
- [ ] Timeout: un-acquirable lock throws `TasksLockAcquisitionError` after timeoutMs

### Code Quality Validation

- [ ] Follows existing patterns: logger() lazy init, SessionFileError-style error,
      RESEARCH_TIMEOUT-style env constants, tasks-json-recovery.test.ts test style
- [ ] Zero new runtime dependencies (`git diff package.json` shows no dep changes)
- [ ] JSDoc on `withLockedTasksJSON` documents the 4 guarantees (mutual exclusion,
      atomic write, recursion-safety, crash recovery) per PRD §Mode A
- [ ] Stable exported surface for S2 (`withLockedTasksJSON(sessionDir, mutator, opts?)`)

### Documentation & Deployment

- [ ] Lockfile path documented as `sessionDir/tasks.json.lock` (sibling of tasks.json)
- [ ] Three new env vars named in constants.ts (CONFIGURATION.md update is P6, not here)
- [ ] Stale-detection behavior documented (PID+mtime, EPERM=alive, ESRCH=dead)

---

## Anti-Patterns to Avoid

- ❌ **Do NOT use `proper-lockfile`.** No re-entrancy support → deadlock or
  false-stale silent-concurrent-RMW on transitive re-entry (research §1).
  Use the zero-dep O_EXCL implementation.
- ❌ **Do NOT treat EPERM from `process.kill(pid,0)` as "dead".** EPERM means
  the process EXISTS but you lack permission → it is ALIVE → keep waiting.
  Only ESRCH = dead. Inverting this deletes a live process's lock (worst bug).
- ❌ **Do NOT `vi.mock('node:fs')` in the lock tests.** O_EXCL semantics are
  untestable against a mocked fs. Use a REAL tmpdir
  (mirror `tests/unit/core/tasks-json-recovery.test.ts`).
- ❌ **Do NOT skip the `finally` release.** A thrown mutator that skips
  release wedges every caller for `staleMs`. Same for the in-process mutex slot.
- ❌ **Do NOT rely on `process.on('exit')` alone.** It does not fire on
  SIGKILL/OOM/segfault. The PID+mtime stale detector is the authoritative
  crash-recovery mechanism; the signal handlers are belt-and-suspenders.
- ❌ **Do NOT write the `{pid,ts}` sentinel after `closeSync`.** It must be
  on disk (writeSync before close) for the stale check to read it.
- ❌ **Do NOT route existing callers (flushUpdates/recovery) in this task.**
  That is P3.M1.T2.S2. S1 is additive infra; keep the exported surface stable.
- ❌ **Do NOT add `tasks.json.lock` to any "protected files" list.** It is a
  transient sentinel, not a §5.1 protected file.
- ❌ **Do NOT hardcode 30000/50 — read them from the constants getters** so
  operators can tune under load via env vars.