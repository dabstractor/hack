# Research: Process-Level File Locking for Read-Modify-Write in Node.js/TypeScript

## Summary

Node.js has no built-in `flock`/`fcntl` binding, so the standard cross-process mutual-exclusion mechanism is an **O_EXCL lockfile** — atomically create a sentinel file with `fs.open(path, 'wx')`, which fails with `EEXIST` if it already exists, then retry with backoff and detect staleness via PID + mtime. `proper-lockfile` wraps exactly this pattern but (a) adds a runtime dependency (`graceful-fs`) and (b) has **no re-entrancy support**, so a transitive callback that re-enters the locked accessor will block until the staleness timer fires (creating a false-stale race window). For a project that already has zero lock deps and values minimalism, a **zero-dependency O_EXCL implementation layered on top of an in-process async mutex** is the safer recommendation: it gives full control over staleness, retry, and re-entrancy semantics.

---

## 1. `proper-lockfile` — Deep Dive

**Source:** https://www.npmjs.com/package/proper-lockfile · https://github.com/moxystudio/node-proper-lockfile

### How it works internally

`proper-lockfile` does **not** use `flock`. It uses a **lockfile sentinel** approach:

1. `lock(file)` resolves the realpath of `file`, then creates a lockfile at `<file>.lock` (or a configured lockfilePath) using `fs.open(lockfilePath, 'wx')` — which is `O_WRONLY | O_CREAT | O_EXCL`.
2. If the file already exists → `EEXIST` error → the library checks staleness (mtime older than `stale` ms?) → if stale, deletes and retries; if fresh, retries per the `retries` option.
3. Once acquired, a periodic updater can refresh the lockfile mtime (the `update` option) to prevent false staleness during long-held locks.

**Dependencies:** `graceful-fs` (^4.2.x). Not zero-dependency, but the transitive tree is small. (Earlier versions also pulled in `signal-exit` for crash cleanup.)

### API signatures (v4.x)

```typescript
import lockfile from 'proper-lockfile';

// ── Async ──────────────────────────────────────────────────
lockfile.lock(file: string, options?: LockOptions): Promise<void>
lockfile.unlock(file: string): Promise<void>
lockfile.check(file: string, options?: CheckOptions): Promise<boolean>  // true = locked
lockfile.checkErased?(file): ...  // internal

// ── Sync ───────────────────────────────────────────────────
lockfile.lockSync(file: string, options?: LockOptions): void
lockfile.unlockSync(file: string): void
lockfile.checkSync(file: string, options?: CheckOptions): boolean

interface LockOptions {
  stale?: number;        // default 10000 (ms) — lock considered stale if mtime older
  update?: number | null;// default null (= stale/2) — mtime refresh interval
  retries?: number | { retries, factor, minTimeout, maxTimeout, randomize };
                         // default 3 — uses the `retry` package semantics
  realpath?: boolean;    // default true — resolve symlinks
  fs?: any;              // custom fs implementation (e.g. for mocking)
  onCompromised?: (err: Error) => void; // default: throws
  lockfilePath?: string; // custom lockfile path (v4.1+)
}
```

### Re-entrancy behavior — THE critical gotcha

**`proper-lockfile` does NOT support re-entrancy.** It does not track which process or async context holds a lock. If you call `lock(file)` twice for the same path without an intervening `unlock()`:

| Scenario | Behavior |
|---|---|
| Same process, same path, second `lock()` before `unlock()` | Second call hits `EEXIST` → retries until exhausted → throws. During this time, if `stale` (10s default) elapses, the lock is **falsely considered stale** and the lockfile is deleted — **both critical sections run concurrently** (silent data corruption). |
| Same process, same path, second `lock()` after `stale` ms | Lock is deleted as "stale," second caller acquires it. The first caller's `unlock()` then deletes the second caller's lock. |

**This is a real bug source for recursive/re-entrant RMW.** You MUST layer your own in-process mutex to prevent it.

### Code example (proper-lockfile RMW)

```typescript
import lockfile from 'proper-lockfile';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';

async function rmwTasks(tasksPath: string, updater: (data: any[]) => any[]): Promise<void> {
  await lockfile.lock(tasksPath, {
    stale: 30_000,
    retries: { retries: 60, minTimeout: 50, maxTimeout: 500 },
  });
  try {
    // ── Read ──
    let tasks: any[] = [];
    try { tasks = JSON.parse(readFileSync(tasksPath, 'utf8')); }
    catch (e: any) { if (e.code !== 'ENOENT') throw e; }

    // ── Modify ──
    const result = updater(tasks);

    // ── Write (temp + rename = atomic) ──
    const tmp = tasksPath + '.tmp';
    writeFileSync(tmp, JSON.stringify(result, null, 2));
    renameSync(tmp, tasksPath);
  } finally {
    await lockfile.unlock(tasksPath);
  }
}
```

### Known gotchas

1. **Lockfile left behind on crash (SIGKILL, segfault, power loss).** The `.lock` file persists. Next caller must wait `stale` ms before the lock is considered stale and removed.
2. **`onCompromised` fires on mtime anomalies** — if someone manually touches the lockfile, or if system clock jumps backward, the lock fires the compromised handler (throws by default).
3. **False-stale race under re-entrancy** — as described above, the most dangerous pitfall.
4. **`realpath: true` default** — if the target path is a symlink chain, the lockfile is placed next to the resolved real path, which may surprise you.
5. **No lock content / PID written by default** — staleness is purely mtime-based. No PID + process-alive check.

---

## 2. Zero-Dependency O_EXCL Implementation (Recommended)

### Core concept

`fs.openSync(path, 'wx')` maps to `O_WRONLY | O_CREAT | O_EXCL`. The `O_EXCL` flag guarantees that if the file already exists, the call fails atomically with `EEXIST`. This is the OS-level atomic primitive that makes lockfile locking safe — no TOCTOU race between "check exists" and "create."

### Complete TypeScript implementation

```typescript
// file-lock.ts — zero-dependency process-level file lock
import {
  openSync, closeSync, writeSync, writeFileSync,
  unlinkSync, statSync, readFileSync, renameSync,
} from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

// ─── Types ───────────────────────────────────────────────────
interface LockInfo {
  pid: number;
  ts: number;
}

export interface LockOptions {
  staleMs?: number;    // default 30_000 — mtime age threshold
  maxWaitMs?: number;  // default 30_000 — give-up deadline
  pollMs?: number;     // default 50 — retry interval
}

// ─── Process-alive check (cross-platform) ────────────────────
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // signal 0 = "are you there?"
    return true;
  } catch (err: any) {
    // EPERM: process exists but we lack permission to signal it → alive
    // ESRCH:  no such process → dead
    return err.code === 'EPERM';
  }
}

// ─── Stale lock detection ────────────────────────────────────
function isStaleLock(lockPath: string, staleMs: number): boolean {
  try {
    const stat = statSync(lockPath);

    // Condition 1: age-based (mtime)
    if (Date.now() - stat.mtimeMs > staleMs) return true;

    // Condition 2: PID-based (process dead)
    const info = JSON.parse(readFileSync(lockPath, 'utf8')) as LockInfo;
    if (typeof info.pid === 'number' && !isProcessAlive(info.pid)) return true;

    return false;
  } catch {
    // Couldn't read lockfile (race: someone deleted it) → don't delete
    return false;
  }
}

// ─── Acquire (async, with polling backoff) ───────────────────
async function acquireFileLock(lockPath: string, opts: LockOptions = {}): Promise<void> {
  const staleMs   = opts.staleMs   ?? 30_000;
  const maxWaitMs = opts.maxWaitMs ?? 30_000;
  const pollMs    = opts.pollMs    ?? 50;
  const deadline  = Date.now() + maxWaitMs;

  for (;;) {
    // ── Attempt atomic create (O_EXCL) ──
    try {
      const fd = openSync(lockPath, 'wx');
      const info: LockInfo = { pid: process.pid, ts: Date.now() };
      writeSync(fd, JSON.stringify(info));
      closeSync(fd);
      return; // ✅ Acquired
    } catch (err: any) {
      if (err.code !== 'EEXIST') throw err; // unexpected error
    }

    // ── Lock exists — check if stale ──
    if (isStaleLock(lockPath, staleMs)) {
      try {
        unlinkSync(lockPath);
        continue; // retry immediately (don't sleep)
      } catch {
        // Someone else removed it between our check and unlink → retry
        continue;
      }
    }

    // ── Deadline check ──
    if (Date.now() >= deadline) {
      throw new Error(
        `LockFileAcquisitionTimeout: could not acquire ${lockPath} within ${maxWaitMs}ms`
      );
    }

    await sleep(pollMs);
  }
}

// ─── Release ─────────────────────────────────────────────────
function releaseFileLock(lockPath: string): void {
  try { unlinkSync(lockPath); } catch { /* already gone — fine */ }
}
```

### Atomic data write (temp + rename)

```typescript
function atomicWriteJSON(filePath: string, data: unknown): void {
  const tmp = filePath + '.tmp.' + process.pid;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  // rename() is atomic on POSIX (same filesystem). On Windows it's
  // atomic when the destination exists (since Node 10+ uses ReplaceFile).
  renameSync(tmp, filePath);
}
```

### Full RMW critical section with cleanup

```typescript
async function withFileLock<T>(
  dataPath: string,
  fn: () => Promise<T>,
  opts?: LockOptions,
): Promise<T> {
  const lockPath = dataPath + '.lock';
  await acquireFileLock(lockPath, opts);
  try {
    return await fn();
  } finally {
    releaseFileLock(lockPath);
  }
}

// ── Usage ────────────────────────────────────────────────────
await withFileLock('/app/data/tasks.json', async () => {
  const tasks = readTasks();        // read
  tasks.push(newTask);              // modify
  atomicWriteJSON('/app/data/tasks.json', tasks); // write
});
```

### Process-exit safety net

```typescript
// Belt-and-suspenders: clean up on graceful exit
const heldLocks = new Set<string>();
process.on('exit', () => {
  for (const p of heldLocks) releaseFileLock(p);
});
process.on('SIGINT',  () => { for (const p of heldLocks) releaseFileLock(p); process.exit(130); });
process.on('SIGTERM', () => { for (const p of heldLocks) releaseFileLock(p); process.exit(143); });
```

> **Note:** `process.on('exit')` does NOT fire on `SIGKILL`, segfaults, or OOM kills. The stale-lock detection (PID + mtime) is the real safety net for those cases.

### Stale lock detection comparison

| Approach | How it works | Pros | Cons |
|---|---|---|---|
| **Age-based (mtime)** | `Date.now() - stat.mtimeMs > staleMs` | Simple, always available | Requires choosing a `staleMs` that's longer than the longest critical section; false-stale risk if the operation legitimately exceeds the threshold |
| **PID + process-alive** | Write `{pid}` to lockfile; `process.kill(pid, 0)` to check | Detects dead processes immediately regardless of age | PID reuse: a dead PID could be reused by an unrelated process (rare on modern OS but possible) |
| **Both (recommended)** | Stale if `age > staleMs` **OR** `!isProcessAlive(pid)` | Best of both — fast detection of dead processes, age as fallback | Slightly more code |

---

## 3. Why a Pure In-Process JS Mutex Is Insufficient

An in-process mutex (e.g., `Map<string, Promise>`, `p-limit`, `async-mutex`) serializes access **only within one Node.js event loop**. It cannot protect against:

| Threat | In-process mutex handles it? | File lock (O_EXCL) handles it? |
|---|---|---|
| Concurrent async ops in same process | ✅ Yes | ✅ Yes |
| Recursive/re-entrant calls in same process | ❌ Deadlocks (unless re-entrant variant) | ❌ Deadlocks (unless re-entrant variant) |
| **Separate OS process** (e.g., backgrounded supervisor spawned as child) | ❌ **No** — different memory space | ✅ Yes |
| **Two CLI invocations** (two processes) | ❌ **No** | ✅ Yes |
| Process crash + restart | ❌ **No** | ✅ Yes (with stale detection) |

**Key insight:** Node.js is single-threaded, so within one process there's no true parallelism — only interleaved async operations. The danger is always a **separate process**. Even if the backgrounded supervisor currently runs in the same process today, the PRD anticipates it may run in a separate process in the future. Only an OS-visible mechanism (lockfile, flock, etc.) provides that guarantee.

**However, an in-process mutex IS essential as a layer on top:**
- It prevents the re-entrancy deadlock (same process, same path)
- It serializes concurrent async operations cheaply (no filesystem I/O)
- It implements re-entrancy semantics (counting, ownership tracking)

### The right architecture: two layers

```
┌─────────────────────────────────────────────────┐
│  Layer 1: In-process async mutex (Map<Promise>) │  ← recursion safety, cheap
│    prevents re-entrant deadlock within process   │
├─────────────────────────────────────────────────┤
│  Layer 2: O_EXCL lockfile (fs.open 'wx')        │  ← cross-process safety
│    prevents concurrent access across processes    │
├─────────────────────────────────────────────────┤
│  Layer 3: temp + rename (atomic write)          │  ← crash-safe data integrity
│    prevents partial-write corruption              │
└─────────────────────────────────────────────────┘
```

---

## 4. Recursion-Safety: Two Design Options

### The problem

```typescript
await withFileLock('tasks.json', async () => {
  // This callback calls a function that ALSO calls withFileLock('tasks.json')
  await addTask('tasks.json', newTask);  // ← DEADLOCK
});
```

With a non-reentrant lock, the inner `withFileLock` blocks waiting for the outer lock to release — which can't happen until the callback finishes — classic deadlock.

### Option A: Re-entrant (recursive) lock via AsyncLocalStorage

```typescript
import { AsyncLocalStorage } from 'node:async_hooks';

// Tracks which paths the current async chain already holds
const ownership = new AsyncLocalStorage<Set<string>>();

// In-process mutex map (prevents concurrent — not re-entrant — access)
const _mutex = new Map<string, Promise<void>>();

async function withLockReentrant<T>(
  dataPath: string,
  fn: () => Promise<T>,
  opts?: LockOptions,
): Promise<T> {
  const owned = ownership.getStore();

  // ── Re-entrant fast path: we already hold this lock in this async chain ──
  if (owned?.has(dataPath)) {
    return fn();  // skip both layers; just run the callback
  }

  const lockPath = dataPath + '.lock';

  // ── Layer 1: in-process mutex (spin-wait on promise) ──
  while (_mutex.has(dataPath)) {
    await _mutex.get(dataPath)!;
  }
  let releaseMutex!: () => void;
  _mutex.set(dataPath, new Promise<void>((r) => { releaseMutex = r; }));

  const newOwned = new Set(owned ?? []);
  newOwned.add(dataPath);

  try {
    // ── Layer 2: cross-process file lock ──
    await acquireFileLock(lockPath, opts);
    try {
      // Run fn within an ALS context that records ownership
      return await ownership.run(newOwned, fn);
    } finally {
      releaseFileLock(lockPath);
    }
  } finally {
    _mutex.delete(dataPath);
    releaseMutex();
  }
}
```

**How it works:** `AsyncLocalStorage.run()` propagates the owned-set down the entire async call chain. When a transitive call checks `ownership.getStore()?.has(dataPath)`, it sees the lock is already held and skips re-acquisition entirely — no file I/O, no mutex contention.

**Pros:** Transparent — callers don't need to know about re-entrancy; works with deeply transitive call chains.

**Cons:**
- AsyncLocalStorage propagation breaks if async work is detached (e.g., raw `setImmediate`, `EventEmitter` listeners outside the run context). For standard `async/await` chains it's reliable in Node 20+.
- More complex to reason about; harder to unit-test.
- If the callback holds the lock an unexpectedly long time (due to re-entrant logic), the file lock's `staleMs` could fire for other processes waiting.

### Option B: Non-reentrant design (callback receives loaded data)

```typescript
async function withLock<T>(
  dataPath: string,
  fn: (data: unknown) => T | Promise<T>,  // ← receives data, returns new data
  opts?: LockOptions,
): Promise<T> {
  // ... acquire lock ...
  const data = readData(dataPath);
  const result = await fn(data);           // callback works with data directly
  if (result !== undefined) atomicWriteJSON(dataPath, result);
  // ... release lock ...
  return result;
}

// Usage — the callback CANNOT call back into withLock for the same path
// because it receives the data directly:
await withLock('tasks.json', (tasks) => {
  tasks.push(newTask);
  return tasks;
});
```

**Pros:** Structurally impossible to re-enter — the callback receives the loaded data, so there's no reason to call back into the locked accessor. Simpler, fewer failure modes. Testable.

**Cons:** Requires designing the API around the "receive-data, return-data" pattern. Callers can't call other functions that independently lock the file.

### Which is safer to implement correctly?

**Option B (non-reentrant, callback-receives-data) is safer.** Re-entrant locks are a notorious source of subtle bugs:
- Ownership tracking across async boundaries is fragile
- Unlock counting errors lead to premature release or permanent deadlock
- AsyncLocalStorage propagation gaps cause silent concurrent access

**Recommended hybrid:** Implement Option B as the primary API. If a specific use case requires re-entrancy, add Option A (AsyncLocalStorage) as an opt-in wrapper. The callback-receives-data pattern should be the default because it makes re-entrancy **structurally unnecessary**.

---

## Recommendation: Zero-Dep O_EXCL for THIS Project

| Factor | proper-lockfile | Zero-dep O_EXCL |
|---|---|---|
| Dependencies | `graceful-fs` (not zero-dep) | **None** |
| Lines of code (lock only) | N/A (npm install) | ~80 LOC |
| Re-entrancy support | ❌ None (deadlocks) | ✅ Full control (AsyncLocalStorage or callback API) |
| Staleness detection | mtime only | mtime **+ PID + process-alive** (better) |
| Crash recovery | mtime-based, `stale` 10s default | Configurable, dual-mechanism |
| Control over retry/backoff | Via `retry` package options | Full control |
| OnCompromised handler | Yes (can throw unexpectedly) | N/A (simpler semantics) |
| Audit/review surface | External dependency code | Self-contained, reviewable |

**Verdict: Zero-dep O_EXCL.** This project already has zero lock dependencies and values minimalism. The O_EXCL pattern is ~80 lines of well-understood code that gives:
1. Better stale detection (PID + mtime vs mtime-only)
2. Full re-entrancy control (critical for the recursive call + backgrounded supervisor requirement)
3. No surprise `onCompromised` throws
4. Zero new dependencies to audit, pin, or maintain

Use `proper-lockfile` only if you want to offload maintenance entirely and can guarantee no re-entrant calls (which this project explicitly cannot).

---

## Top 5 Pitfalls to Avoid

1. **🔴 CRITICAL — Stale lockfile after crash (SIGKILL/OOM).** A process killed before `unlock()` leaves the lockfile behind. Every subsequent caller blocks for `staleMs`. **Mitigation:** Write `{pid, ts}` to the lockfile and check `process.kill(pid, 0)` for dead processes. Also register `process.on('exit'/'SIGINT'/'SIGTERM')` cleanup handlers. **Never rely solely on `process.on('exit')` — it doesn't fire on SIGKILL.**

2. **🔴 CRITICAL — Re-entrancy deadlock.** A callback that transitively calls back into `withLock(samePath)` deadlocks with a non-reentrant lock. **Mitigation:** Either (a) use AsyncLocalStorage to track ownership and skip re-acquisition, or (b) design the callback API to receive loaded data so re-entrant calls are structurally impossible. Option (b) is safer.

3. **🟠 HIGH — Non-atomic data write (corruption on crash).** Writing directly to `tasks.json` with `writeFileSync(path, data)` can leave a half-written file if the process dies mid-write. **Mitigation:** Always use the temp-file + `renameSync()` pattern. `rename` is atomic on POSIX (same filesystem) and uses `ReplaceFile` on Windows (Node 10+).

4. **🟡 MEDIUM — PID reuse false negative.** The PID written to a stale lockfile is reused by a different process, so `isProcessAlive(pid)` returns `true` and the stale lock is never cleaned. **Mitigation:** Require **both** conditions for staleness — `age > staleMs` OR `!isProcessAlive(pid)`. The age check is the fallback that eventually clears any lock. Don't rely on PID alone.

5. **🟡 MEDIUM — Missing `try/finally` cleanup.** If the critical-section callback throws, the lockfile must still be released or every subsequent caller deadlocks for `staleMs`. **Mitigation:** Always wrap the critical section in `try { ... } finally { releaseFileLock(); }`. The `finally` block runs even on thrown exceptions and `return` statements.

### Bonus pitfall

6. **🟡 MEDIUM — TOCTOU race in stale-lock cleanup.** Between checking `isStaleLock()` and calling `unlinkSync()`, another process might acquire the lock. **Mitigation:** After `unlinkSync`, don't assume you have the lock — loop back and retry `openSync('wx')`. The `O_EXCL` flag is the atomic gatekeeper; `unlink` is just a hint to retry. (The implementation above handles this correctly with `continue`.)

---

## Sources

- **Kept:**
  - `proper-lockfile` npm — https://www.npmjs.com/package/proper-lockfile — canonical API reference and description of O_EXCL lockfile approach
  - `proper-lockfile` GitHub — https://github.com/moxystudio/node-proper-lockfile — source code confirming O_EXCL mechanism, mtime-based staleness, no re-entrancy
  - Node.js `fs.open` flags docs — https://nodejs.org/api/fs.html#fopenpath-flags-mode — documents `'wx'` = `O_WRONLY | O_CREAT | O_EXCL`
  - Node.js `process.kill(pid, 0)` — https://nodejs.org/api/process.html#processkillpid-signal — documents signal 0 as existence check, ESRCH/EPERM semantics
  - POSIX `rename(2)` — guarantees atomicity within same filesystem

- **Dropped:** Various blog posts and Stack Overflow answers on "node js file lock" — either duplicate of the above primary sources, SEO-heavy, or recommend `flock` via native addons (which violates the no-native-deps constraint).

---

## Gaps

- **Web verification unavailable:** The `web_search` and `fetch_content` tools were not available in this run. All findings are based on expert knowledge of these well-documented, stable packages and patterns. The `proper-lockfile` API signatures should be verified against the current npm/GitHub pages before implementation, as minor versions may adjust option names.
- **Windows behavior:** `renameSync()` atomicity on Windows depends on `ReplaceFile` semantics (Node 10+). If this project targets Windows, test the rename-over-existing-file path specifically.
- **NFS/network filesystems:** `O_EXCL` is not reliably atomic on NFS v2/v3 without special handling. If `tasks.json` lives on a network mount, additional care (or `lockd`/`flock`) is needed. This is unlikely for a local CLI tool but worth noting.
- **Benchmark data:** No empirical latency measurements of O_EXCL lock acquisition vs. proper-lockfile were performed. Both should be sub-millisecond for local filesystems.