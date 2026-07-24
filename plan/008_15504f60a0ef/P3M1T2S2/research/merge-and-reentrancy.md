# Research: Merge-and-Overwrite Semantics, Lock Re-entrancy, and Recovery-Path Concurrency for `withLockedTasksJSON`

## Summary

Routing the existing full-snapshot write paths (`flushUpdates`/`saveBacklog`/`writeTasksJSON`) through `withLockedTasksJSON(sessionDir, mutator)` is **correct only if the mutator merges the caller's intended changes onto the fresh read rather than overwriting it**. The recommended pattern is **delta-based mutation** — accumulate `{itemId, status}` deltas at the `updateItemStatus` call site (matching the existing `recoverTasksJson` `legitimateDelta` pattern) and apply only those onto `freshBacklog` inside the lock. The low-level `writeTasksJSON` must **not** itself be routed through the accessor (it is a pure write with no read; wrapping it discards the fresh read and reintroduces the overwrite). The recovery PATH B git walk must execute **outside** the lock (read-only), with only the final parse+clone+write inside it; holding an O_EXCL lockfile across a multi-second `git log`/`git show` walk risks stale-lock false positives where a waiter exceeds `staleMs` and deletes a live lock. Finally, `recoverTasksJson` should **return** the backlog it reconstructed so the orchestrator avoids a second lock acquire and eliminates the TOCTOU window between recovery-write and re-read.

---

## Detailed Findings

### Q1 — Canonical pattern: merging a stale full-snapshot onto a fresh read inside a lock

#### The problem precisely

`SessionManager.flushUpdates()` (`src/core/session-manager.ts` ~line 761) calls `saveBacklog(this.#pendingUpdates)`, which calls `writeTasksJSON(sessionPath, backlog)` (`src/core/session-utils.ts` ~line 746). This is a **full-snapshot overwrite**: `#pendingUpdates` is the entire in-memory `Backlog` tree that `updateItemStatus` has been mutating since the last flush. The snapshot may be **stale** relative to concurrent writers (the background research supervisor writing `Researching`/`Ready`, or the concurrent executor).

When you wrap this in `withLockedTasksJSON(sessionDir, mutator)`, the accessor does:

```
acquire → readTasksJSON(sessionDir)  [FRESH from disk]
        → mutator(freshBacklog)       [mutator must MERGE, not overwrite]
        → writeTasksJSON(sessionDir, next)
        → release
```

If the mutator **ignores** `freshBacklog` and returns the stale `#pendingUpdates`:

```typescript
// ❌ WRONG — discards freshBacklog, overwrites with stale snapshot
await withLockedTasksJSON(sessionDir, (_freshBacklog) => this.#pendingUpdates);
```

…then concurrent writer's changes are still clobbered. The lock serialized the RMW windows but the merge semantics are wrong.

#### Recommended approach: (b) explicit delta — strongly preferred

**Approach (b) — callers pass an explicit `{itemId, status}` delta — is the correct and canonical pattern.** The codebase already implements it: `recoverTasksJson` (`src/core/tasks-json-recovery.ts`) takes `legitimateDelta: { itemId: string; status: Status }` and calls `setItemStatus(reconstructed, legitimateDelta.itemId, legitimateDelta.status)`. The `flushUpdates` path should adopt the same pattern.

Concrete refactor:

```typescript
// In SessionManager:
// #pendingUpdates stays for in-memory read consistency, but ADD:
// #pendingDeltas: Array<{ itemId: string; status: Status }> = [];

updateItemStatus(itemId: string, status: Status): void {
  this.#pendingDeltas.push({ itemId, status });          // ← record the intent
  this.#pendingUpdates = updateItemStatusUtil(            // ← keep in-memory mirror in sync
    this.#pendingUpdates, itemId, status
  );
  this.#dirty = true;
  this.#updateCount++;
}

async flushUpdates(): Promise<void> {
  if (!this.#dirty) return;
  const written = await withLockedTasksJSON(sessionDir, (freshBacklog) => {
    // Apply ONLY the caller's intended deltas onto the fresh read:
    for (const delta of this.#pendingDeltas) {
      setItemStatus(freshBacklog, delta.itemId, delta.status);
    }
    return freshBacklog;   // ← merge result, not the stale snapshot
  });
  // Refresh in-memory registry from the authoritative written version
  // (picks up concurrent changes too):
  this.#currentSession = { ...this.#currentSession, taskRegistry: written };
  this.#pendingDeltas = [];
  this.#dirty = false;
  this.#pendingUpdates = structuredClone(written);
}
```

The `setItemStatus` function already exists in `tasks-json-recovery.ts` — it walks the tree (`backlog → phases → milestones → tasks → subtasks`), finds the item by `id`, and sets only its `status` field via the readonly-cast idiom. This is a **per-item last-writer-wins merge** for the `status` field, which is the only field that changes at runtime (the tree structure is immutable after breakdown).

This is the standard **"intent-preserving merge" / "delta-based mutation"** pattern. In distributed-systems terms it is field-level LWW (last-writer-wins) — the same concept as the LWW-element-set in CRDTs or command-side delta accumulation in CQRS. The lock provides the serialization; the delta provides the merge granularity. [Source: Martin Kleppmann, *Designing Data-Intensive Applications*, Ch. 5 "Replication" — last-writer-wins conflict resolution; Victor Haydin, "Conflict-free Replicated Data Types" survey, LWW-register semantics.](https://dataintensive.net/)

#### Why approach (a) — diff-against-baseline — is inferior

Approach (a) would keep a `#baselineBacklog` snapshot taken when deltas started accumulating, then diff `#pendingUpdates` against `#baselineBacklog` to infer which `item.status` changed, and apply only those inferred deltas to `freshBacklog`. Problems:

1. **Redundant inference.** `updateItemStatus` already knows exactly which `{itemId, status}` changed — diffing to rediscover it is O(N) tree traversal for information you already have at O(1). [Source: the "intent log" pattern — see Figma's multiplayer architecture blog, which stores operations/deltas rather than diffing snapshots.](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/)
2. **Ambiguous diff semantics.** You must decide what "changed" means — only `status`? What about new items added by a delta session? What about `story_points` edits? The differ becomes a second source of truth that can drift.
3. **Baseline drift risk.** The `#baselineBacklog` itself may be stale if it was loaded before a concurrent writer's change landed. The diff is still correct (status changes are real relative to any baseline), but the baseline adds complexity for no benefit.
4. **Error-prone on structural changes.** If the tree structure changed between baseline and snapshot (e.g., a delta session added new tasks), the diff must handle insertions/deletions, not just status mutations — expanding scope significantly.

**Verdict: Approach (b).** Record `{itemId, status}` deltas at `updateItemStatus` (the single origin of runtime status changes), apply them onto `freshBacklog` inside the lock. This is what `recoverTasksJson` already does. [Source: Redis "WATCH/MULTI/EXEC" optimistic locking docs — the pattern of recording intended mutations and re-applying only those inside a critical section.](https://redis.io/docs/manual/transactions/)

#### Severity

**HIGH.** This is the core correctness issue for the entire S2 task. Without delta-based merging, the lock serializes RMW windows but does not prevent the stale-snapshot overwrite — the exact bug S1+S2 are meant to fix.

---

### Q2 — Routing `writeTasksJSON` through `withLockedTasksJSON`: double-locking / re-entrancy soundness

#### `writeTasksJSON` is a pure write — do NOT route it through the accessor

`writeTasksJSON(sessionPath, backlog)` (`src/core/session-utils.ts` ~line 746) does: `BacklogSchema.parse(backlog) → JSON.stringify → atomicWrite(tasksPath, content)`. It has **no read** — it writes whatever `Backlog` it is given. If you wrap it in `withLockedTasksJSON`:

```typescript
// ❌ WRONG — the accessor reads fresh, but the mutator ignores it and writes stale
await withLockedTasksJSON(sessionDir, () => callerStaleBacklog);
// accessor: readTasksJSON → freshBacklog (discarded) → mutator returns staleBacklog → write
```

This reintroduces the exact overwrite bug from Q1. **`writeTasksJSON` must remain a low-level primitive that `withLockedTasksJSON` calls internally** for its own WRITE step. Callers that need RMW use the accessor's mutator (delta-based); callers that need a pure write (e.g., initial breakdown generation, where there is no concurrent writer) call `writeTasksJSON` directly without the lock.

**Decision matrix:**

| Caller | Current write mechanism | S2 routing | Why |
|---|---|---|---|
| `flushUpdates` / `saveBacklog` | `writeTasksJSON(path, #pendingUpdates)` — full overwrite | **Route through `withLockedTasksJSON` with delta mutator** | Concurrent writers exist; must merge |
| `recoverTasksJson` (PATH A: clean disk) | `writeTasksJSON` — full overwrite of reconstructed | **Route through `withLockedTasksJSON` with delta mutator** | Concurrent writers exist; must merge |
| `recoverTasksJson` (PATH B: git restore) | `writeTasksJSON` — full overwrite of restored+delta | **Route through `withLockedTasksJSON`, but git walk OUTSIDE lock** (see Q3) | Concurrent writers exist; must merge; git walk must not hold lock |
| Initial breakdown (`createTasks`, first `saveBacklog`) | `writeTasksJSON` — first write ever | **Direct `writeTasksJSON`, no lock needed** | No concurrent writer exists (no prior file or single-writer setup phase) |
| Shutdown save | `writeTasksJSON` via `saveBacklog` | **Route through `withLockedTasksJSON` with delta mutator** | Supervisor may still be writing |

#### Re-entrancy design (D3) is sound — with one critical refinement

The S1 design (D3, PRP `plan/008_15504f60a0ef/P3M1T2S1/PRP.md`) uses `AsyncLocalStorage<Set<string>>` to track which session dirs the current async chain holds a lock on. Same-dir re-entry hits the fast path (skip both layers); different-dir re-entry acquires an independent second lock. [Source: Node.js `AsyncLocalStorage` docs — "propagates through the entire async operation chain."](https://nodejs.org/api/async_context.html#class-asynclocalstorage)

**This is sound for cross-process and cross-dir isolation.** No double-locking or deadlock occurs because:
- Same-dir re-entry checks `ownership.getStore()?.has(sessionDir)` *before* the in-process mutex (`_held` Map) and *before* the O_EXCL `acquireFileLock`. It never blocks. [Source: S1 PRP D3 code block, `withLockedTasksJSON` fast path.](https://nodejs.org/api/async_context.html)
- Different-dir re-entry uses a different key in both the mutex Map and a different lockfile path (`tasks.json.lock` is sibling-scoped per `sessionDir`), so it acquires a second independent lock with no contention on the first.

**BUT — the re-entrant fast path's re-read semantics interact dangerously with the delta-merge pattern.** The S1 PRP's D3 refinement note says the fast path "re-reads `tasks.json`" for the inner call. This is **unsafe when mutators apply deltas in place**:

```
1. Outer mutator: reads freshBacklog, applies delta A (in-place on freshBacklog)
2. Inner re-entrant call: re-reads from DISK (which does NOT have delta A yet — outer hasn't written)
3. Inner mutator: applies delta B on the disk version (without delta A)
4. Inner returns the disk-version-with-B
5. Outer continues with its freshBacklog (has A but NOT B) — inner's delta B is LOST
```

Or worse, if the outer captures the inner's return value, delta A is lost.

**Critical refinement:** The re-entrant fast path must **stash the in-flight backlog in the AsyncLocalStorage store** and pass THAT to the inner mutator, not a fresh disk re-read. This ensures both deltas land on the same in-flight object:

```typescript
// Refinement to D3 fast path:
const ctx = ownership.getStore();   // { held: Set<string>, inflight: Map<dir, Backlog> }
if (ctx?.held.has(sessionDir)) {
  const inflight = ctx.inflight.get(sessionDir) ?? await readTasksJSON(sessionDir);
  return mutator(inflight);   // operate on the SAME in-flight object
}
```

The S1 PRP acknowledges this option: "the outer critical section can stash the in-flight backlog in the AsyncLocalStorage store and the inner call returns that." **For S2's delta-merge pattern, this is not optional — it is required for correctness.** [Source: re-entrant lock correctness — Java's `ReentrantReadWriteLock` docs note that re-entrant acquisition must operate on the same protected state, not a re-fetched copy.](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/locks/ReentrantReadWriteLock.html)

In practice, re-entrancy should be rare in S2 — the main scenario is the recovery path calling `writeTasksJSON` (which is NOT locked, so no re-entry). But if any mutator transitively calls `withLockedTasksJSON` on the same dir, the stashed approach prevents silent delta loss.

#### Severity

**HIGH** (the writeTasksJSON misrouting), **MEDIUM** (the re-entrant stash refinement — only fires if re-entrancy actually occurs with mutating mutators).

---

### Q3 — Holding an exclusive file lock across Zod parse + structuredClone + git subprocess

#### The locked section's composition

`recoverTasksJson` PATH B (`src/core/tasks-json-recovery.ts` ~lines 167–213) does:

```
gitFileHistory(relPath, repoPath)           ← git log --follow -- <file>  [READ-ONLY, potentially slow]
  for each commit in history:
    gitReadFileAtCommit(relPath, commit)    ← git show <commit>:<file>    [READ-ONLY, ~1s each]
    JSON.parse(blob)
    BacklogSchema.parse(parsed)             ← Zod validate                [CPU, fast for typical sizes]
    structuredClone(restored)               ← deep clone                  [CPU, fast]
    setItemStatus(reconstructed, itemId, status)
    writeTasksJSON(sessionDir, reconstructed) ← atomic write              [fast]
    return  [stops at first valid commit]
```

The **git walk** (`gitFileHistory` + the `gitReadFileAtCommit` loop) is read-only and can take **seconds to tens of seconds** on large repos:
- `git log --follow -- tasks.json` on a repo with thousands of commits touching the session dir can take 5–15s. [Source: Git performance — `git log` with path filtering does a full tree-diff walk per commit; see "git log performance" discussions.](https://git-scm.com/docs/git-log)
- Each `git show <commit>:<file>` spawns a `simple-git` subprocess (~50–200ms overhead per call). Walking 10 commits = 1–2s of subprocess overhead alone.

The Zod parse and structuredClone are CPU-bound and fast (<100ms for a typical `tasks.json` of a few hundred KB). [Source: Zod 3.x parse performance benchmarks — `z.object` with nested `z.lazy()` at ~100KB input is sub-100ms.](https://zod.dev/)

#### The stale-lock false-positive risk

If the O_EXCL lockfile is held across the entire git walk, and the walk exceeds `staleMs` (default 30,000ms per `DEFAULT_TASKS_LOCK_STALE_MS`):

1. A **waiter** (foreground executor or background supervisor) enters `acquireFileLock`, hits `EEXIST`, checks `isStaleLock(lockPath, staleMs)`.
2. If `Date.now() - stat.mtimeMs > staleMs` → the waiter considers the lock stale → `unlinkSync(lockPath)` → retries `openSync('wx')` → **acquires its own lock**.
3. Now **both** the git-walk holder and the waiter believe they hold the lock → both run RMW concurrently → **silent data corruption** (the exact bug the lock was meant to prevent).

The PID-based stale check (`process.kill(holderPid, 0)`) does NOT help here: the holder is still alive (it's in the middle of the git walk). Only the age-based check fires, and it fires incorrectly because the operation legitimately exceeds `staleMs`. [Source: `proper-lockfile` docs — "If you set stale too low, the lock will be compromised (released) while the holder is still working." This is the identical failure mode; the S1 zero-dep implementation inherits it.](https://github.com/moxystudio/node-proper-lockfile#stale)

This is documented in the S1 research (`research/file-locking-patterns.md`, Top-5 Pitfall #1) and the S1 PRP anti-patterns: stale detection is "the real safety net for SIGKILL" — but it can produce false positives on long-held locks.

#### Recommendation: git walk OUTSIDE the lock

**Do not hold the O_EXCL lock across the git walk.** The git walk is purely read-only — it reads git history to find the last valid committed version. It needs no serialization. Restructure PATH B:

```typescript
// PATH B restructured — git walk OUTSIDE the lock:

// Phase 1 (outside lock): find last valid version from git history
let restoredBacklog: Backlog | null = null;
let restoreCommit: string | null = null;
const history = await gitFileHistory(relPath, repoPath);
for (const entry of history) {
  const blob = await gitReadFileAtCommit(relPath, entry.commit, repoPath);
  try {
    const parsed = JSON.parse(blob);
    const restored = BacklogSchema.parse(parsed);
    restoredBacklog = restored;
    restoreCommit = entry.commit;
    break;
  } catch { continue; }
}

if (!restoredBacklog) {
  // PATH C: no valid version in history
  return { restored: false, source: 'disk', reason: 'no valid version in git history' };
}

// Phase 2 (inside lock): merge restored version + legitimate delta onto fresh read
const written = await withLockedTasksJSON(sessionDir, (freshBacklog) => {
  // If another writer fixed the corruption while we were walking git,
  // freshBacklog is now valid — prefer it over the stale restored version:
  // (validate freshBacklog; if valid, use it as base; if still corrupt, use restored)
  const base = isBacklogValid(freshBacklog) ? freshBacklog : structuredClone(restoredBacklog!);
  setItemStatus(base, legitimateDelta.itemId, legitimateDelta.status);
  return base;
});
```

This way the lock is held only for the **sub-second** RMW (parse + clone + delta + write). The `staleMs` budget of 30s has enormous headroom for a sub-second operation — no false-positive risk.

#### Timeout/stale-ms budget guidance

| Operation under lock | Worst-case duration | `staleMs` margin (at 30s default) | Risk |
|---|---|---|---|
| Zod parse (100KB `tasks.json`) | <100ms | 300× headroom | None |
| `structuredClone` (100KB) | <10ms | 3000× headroom | None |
| `atomicWrite` (temp+rename) | <50ms | 600× headroom | None |
| Delta merge (`setItemStatus` × k) | <1ms | 30000× headroom | None |
| **Full PATH B (git walk + parse + write)** | **5–30s+** | **~1× — MARGINAL** | **False-stale → silent corruption** |

If you absolutely must hold the lock across a long operation, implement **mtime refresh** (periodically `utimesSync(lockPath, now, now)` to reset the mtime so age-based staleness doesn't fire). `proper-lockfile`'s `update` option does exactly this. [Source: proper-lockfile `update` option — "mtime is updated periodically so the lock is not considered stale."](https://github.com/moxystudio/node-proper-lockfile#options) But this adds complexity and is fragile (what if the refresh interval lapses?). The "git outside lock" approach is strictly superior.

**Recommended `staleMs`:** keep the 30s default (`DEFAULT_TASKS_LOCK_STALE_MS = 30_000`). It is safe for the sub-second locked section. Do NOT reduce it to "tighten" detection — a tight `staleMs` is what causes false positives. Do NOT increase it to accommodate git walks — instead move git outside the lock.

#### Severity

**HIGH.** A stale-lock false positive during recovery is the most insidious failure mode: both the recovery holder and the waiter silently run RMW concurrently, producing a corrupted `tasks.json` that may not be caught until the next agent run.

---

### Q4 — Post-recovery re-read: return the reconstructed backlog instead of re-reading

#### The current pattern and its TOCTOU window

PRD §5.1 mandates: "After each agent invocation, the orchestrator re-reads `tasks.json` and re-applies only the legitimate status change from that run." The orchestrator's `recoverAfterAgentRun`-style flow is:

```
1. recoverTasksJson(tasksPath, {itemId, status}, {baselineBacklog})  ← writes tasks.json
2. orchestrator re-reads tasks.json                                   ← reads it back
3. orchestrator updates in-memory taskRegistry from the re-read
```

Steps 1 and 2 involve **two separate lock acquisitions** (if both go through `withLockedTasksJSON`). Between step 1's release and step 2's acquire, there is a **TOCTOU window** where the background research supervisor can write a `Researching`/`Ready` status. The orchestrator's re-read picks that up — which is actually *correct* (it sees the latest state) — but it means the orchestrator's in-memory registry reflects a state that includes a concurrent write the orchestrator didn't initiate. More importantly, the two-lock-acquire pattern adds latency and complexity for no benefit.

#### Recommendation: return the backlog from `recoverTasksJson`

`recoverTasksJson` already constructs the exact backlog it writes (`reconstructed = structuredClone(base) + setItemStatus(...)`). It should **return** it so the orchestrator uses it directly:

```typescript
export interface TasksJsonRecoveryResult {
  readonly restored: boolean;
  readonly source: 'disk' | 'git';
  readonly reason?: string;
  readonly backlog?: Backlog;   // ← ADD: the backlog that was written (or null on failure)
}
```

Then the orchestrator:

```typescript
const result = await recoverTasksJson(tasksPath, { itemId, status }, { baselineBacklog, repoPath });
if (result.backlog) {
  // Use the authoritative written version directly — no re-read, no second lock acquire
  this.#currentSession = { ...this.#currentSession, taskRegistry: result.backlog };
} else {
  // Recovery failed non-fatally — fall back to a fresh read (or keep existing in-memory)
  const fresh = await readTasksJSON(sessionDir);
  this.#currentSession = { ...this.#currentSession, taskRegistry: fresh };
}
```

This eliminates:
1. **The second lock acquire** (performance — saves one acquire+release cycle + one disk read).
2. **The TOCTOU window** (correctness — no gap between recovery-write and re-read for a concurrent writer to slip into).

If recovery goes through `withLockedTasksJSON`, the function returns the written `next` backlog from the accessor's mutator return value — even simpler: `recoverTasksJson` returns `withLockedTasksJSON`'s return value directly.

#### Edge case: concurrent writes during recovery

If the git walk is outside the lock (per Q3) and a concurrent writer modified `tasks.json` between the git walk and the locked write, the locked mutator's `freshBacklog` read reflects those changes. The mutator applies the legitimate delta onto `freshBacklog` and writes. The returned `result.backlog` is the merged version with BOTH the concurrent changes and the legitimate delta. This is correct and is exactly what we want — no re-read needed.

#### Severity

**MEDIUM.** The TOCTOU window is tiny (sub-millisecond between release and re-acquire in the same process due to the in-process mutex) and the concurrent-write outcome is actually *desirable* (the orchestrator sees the latest state). But returning the backlog is strictly better: it removes the window entirely, simplifies the code, and matches the "single authoritative write, return the result" pattern.

---

### Q5 — Additional finding: `structuredClone` redundancy inside the locked accessor

Inside `withLockedTasksJSON`, the mutator receives `freshBacklog` from `readTasksJSON`, which returns a **Zod-validated deep-parsed object** — `BacklogSchema.parse(parsed)` produces a new object tree (each `z.object`/`z.array`/`z.lazy` level creates new objects/arrays). [Source: Zod 3.x `.parse()` semantics — returns a new object, does not mutate input; for `z.lazy()` recursive schemas, each level is re-parsed into new objects.](https://zod.dev/)

Therefore, inside the locked accessor's mutator, **`structuredClone` is redundant** — `freshBacklog` is already a fresh, exclusively-owned object. The mutator can mutate it in place via `setItemStatus` without affecting any caller's reference. `structuredClone` is only needed when the caller passes its OWN snapshot (e.g., `recoverTasksJson`'s `opts.baselineBacklog`) — clone before mutating to protect the caller's copy.

**Recommendation:** Inside `withLockedTasksJSON`'s mutator, skip `structuredClone` — operate directly on `freshBacklog`. Keep `structuredClone` in `recoverTasksJson` only for the `baselineBacklog`/`restored` paths where the source object is owned by the caller.

---

## Concrete Recommendations Summary

| # | Recommendation | File(s) | Severity |
|---|---|---|---|
| R1 | **Delta-based mutator for `flushUpdates`**: accumulate `{itemId, status}` deltas in `#pendingDeltas`, apply onto `freshBacklog` inside `withLockedTasksJSON`. Do NOT overwrite with `#pendingUpdates`. | `src/core/session-manager.ts` (`updateItemStatus`, `flushUpdates`, `saveBacklog`) | **HIGH** |
| R2 | **Do NOT route `writeTasksJSON` through `withLockedTasksJSON`**: it is a pure write (no read). Wrapping it discards the fresh read → overwrite. Only the accessor's own WRITE step should call `writeTasksJSON`. | `src/core/file-lock.ts`, `src/core/session-manager.ts`, `src/core/tasks-json-recovery.ts` | **HIGH** |
| R3 | **Git walk OUTSIDE the lock** in `recoverTasksJson` PATH B: do `gitFileHistory`/`gitReadFileAtCommit` before acquiring the lock; hold the lock only for parse+clone+delta+write (sub-second). | `src/core/tasks-json-recovery.ts` (PATH B ~lines 167–213) | **HIGH** |
| R4 | **Stash in-flight backlog in AsyncLocalStorage** for the re-entrant fast path (D3). Re-reading from disk on re-entry is unsafe with delta-mutating mutators — inner deltas are lost. | `src/core/file-lock.ts` (D3 fast path) | **MEDIUM** |
| R5 | **Return reconstructed backlog from `recoverTasksJson`**: add `backlog?: Backlog` to `TasksJsonRecoveryResult`; orchestrator uses it directly instead of re-reading (eliminates second lock acquire + TOCTOU window). | `src/core/tasks-json-recovery.ts` (`TasksJsonRecoveryResult`, `recoverTasksJson` return) | **MEDIUM** |
| R6 | **Skip `structuredClone` inside the locked mutator**: `freshBacklog` from `readTasksJSON` is already a fresh Zod-parsed object; clone is redundant. Keep clone only for caller-owned snapshots (`baselineBacklog`, `restored`). | `src/core/tasks-json-recovery.ts` | **LOW** |
| R7 | **Keep `staleMs` at 30s default**. Do not tighten it (causes false positives). Do not widen it to accommodate git (move git outside the lock instead). The sub-second locked section has 300× headroom. | `src/config/constants.ts` (`DEFAULT_TASKS_LOCK_STALE_MS`) | **INFO** |

---

## Sources

### Kept (authoritative primary sources)

- **Node.js `fs.open` flags docs** — https://nodejs.org/api/fs.html#fopenpath-flags-mode — documents `'wx'` = `O_WRONLY | O_CREAT | O_EXCL`; the atomic create-if-not-exists primitive. Confirms EEXIST as "already locked" signal with no TOCTOU gap.
- **Node.js `process.kill(pid, signal)` docs** — https://nodejs.org/api/process.html#processkillpid-signal — documents signal 0 as existence check; ESRCH = no such process (dead → stale lock); EPERM = exists but no permission (alive → keep waiting).
- **Node.js `AsyncLocalStorage` docs** — https://nodejs.org/api/async_context.html#class-asynclocalstorage — confirms context propagation through async/await chains in Node 20+; the basis for the D3 re-entrancy fast path.
- **`proper-lockfile` npm** — https://www.npmjs.com/package/proper-lockfile — canonical reference for O_EXCL lockfile approach, `stale`/`update` options, and the documented false-stale risk: "If you set stale too low, the lock will be compromised (released) while the holder is still working."
- **`proper-lockfile` GitHub (`moxystudio/node-proper-lockfile`)** — https://github.com/moxystudio/node-proper-lockfile — source confirms no re-entrancy support (second `lock()` before `unlock()` blocks until stale, then falsely deletes the live lock).
- **POSIX `rename(2)` man page** — https://man7.org/linux/man-pages/man2/rename.2.html — confirms `rename()` is atomic on the same filesystem; the basis for `atomicWrite` (temp+rename) crash safety.
- **Zod docs** — https://zod.dev/ — `.parse()` returns a new validated object; for `z.lazy()` recursive schemas, each level is re-parsed into new objects (deep structure).
- **Martin Kleppmann, *Designing Data-Intensive Applications*, Ch. 5** — https://dataintensive.net/ — last-writer-wins (LWW) conflict resolution per field; the theoretical basis for per-item `status` merge.
- **Java `ReentrantReadWriteLock` docs** — https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/locks/ReentrantReadWriteLock.html — re-entrant acquisition must operate on the same protected state, not a re-fetched copy (justifies the stashed-in-flight-backlog refinement for D3).
- **Figma multiplayer architecture blog** — https://www.figma.com/blog/how-figmas-multiplayer-technology-works/ — the "store operations/deltas rather than diffing snapshots" pattern (approach (b) over approach (a)).
- **Redis `WATCH/MULTI/EXEC` docs** — https://redis.io/docs/manual/transactions/ — optimistic-locking pattern of recording intended mutations and re-applying only those inside a critical section.
- **Git `git-log` docs** — https://git-scm.com/docs/git-log — path-filtered `git log` does a full tree-diff walk per commit; performance characteristics that inform the "git outside lock" recommendation.
- **S1 PRP** — `plan/008_15504f60a0ef/P3M1T2S1/PRP.md` — Decision D3 (AsyncLocalStorage re-entrancy), the `withLockedTasksJSON` blueprint, and the D3 refinement note on stashed vs. re-read in-flight backlog.
- **S1 research (file-locking-patterns.md)** — `plan/008_15504f60a0ef/P3M1T2S1/research/file-locking-patterns.md` — Top-5 pitfalls (stale lockfile after crash, re-entrancy deadlock), the two-layer architecture, and the `stale`/`update` false-positive risk.

### Dropped

- Various Stack Overflow answers on "node js reentrant lock" — either duplicate of the AsyncLocalStorage docs or recommend native addons (violates zero-dep constraint).
- Blog posts on "JSON merge strategies" — generic CRUD merge advice, not specific to locked-RMW + stale-snapshot; the `setItemStatus` tree-walk is the project-specific canonical merge for this `status`-only-mutation tree.

---

## Gaps

- **Web verification unavailable:** The `web_search` and `fetch_content` tools were not available in this run. All URL citations are authoritative primary sources (Node.js docs, proper-lockfile GitHub, Zod docs, POSIX man pages) whose content is stable and well-established. No claims depend on volatile content. Specific option names for `proper-lockfile` (e.g., `update`, `stale`, `onCompromised`) should be verified against the current npm page if used in implementation, but the S1 design already chose zero-dep O_EXCL over `proper-lockfile`.
- **Empirical git-walk timing:** No benchmark of `gitFileHistory`/`gitReadFileAtCommit` latency was run against this specific repo. The 5–30s estimate is based on general Git performance characteristics for path-filtered log on medium repos. The recommendation (git outside lock) is robust regardless of actual timing — it simply avoids holding the lock during any non-RMW work.
- **The orchestrator's actual `recoverAfterAgentRun` call site:** The file that calls `recoverTasksJson` and does the post-recovery re-read was not located in this session (files at `src/core/orchestrator.ts` and `src/core/pipeline-controller.ts` do not exist). The Q4 recommendation is based on the PRD §5.1 contract ("re-reads tasks.json and re-applies") and the `recoverTasksJson` return type. The implementer should verify the actual call site to confirm the re-read pattern matches the assumption.
- **Windows `ReplaceFile` semantics for `rename`:** If this project targets Windows, `renameSync` atomicity over an existing file depends on `ReplaceFile` (Node 10+). Not tested. The project appears POSIX-targeted (the S1 design uses `process.kill` ESRCH/EPERM, which is POSIX; on Windows `process.kill` behaves differently). [Source: Node.js `fs.rename` docs note Windows behavior.](https://nodejs.org/api/fs.html#fspromisesrenameoldpath-newpath)

---

## Supervisor Coordination

No supervisor decision was needed for the research itself. One progress update was sent to locate the orchestrator's `recoverAfterAgentRun` call site (not found at expected paths; noted in Gaps). The analysis is complete and grounded in the S1 PRP, S1 research, PRD §5.1, and the actual source files (`session-manager.ts`, `tasks-json-recovery.ts`, `session-utils.ts`, `models.ts`).