# Research: Call-site map for routing tasks.json writes through `withLockedTasksJSON(sessionDir, mutator)`

## Summary

There are **3 distinct write paths to `tasks.json`**: (A) `SessionManager.saveBacklog()` → `writeTasksJSON()`, reached via `flushUpdates()` (3 callers) plus 2 direct `saveBacklog()` callers in `PRPPipeline`; (B) `recoverTasksJson()` in `tasks-json-recovery.ts`, which calls `writeTasksJSON()` directly (2 sites) and is the **only existing true read-modify-write (RMW)** path; and (C) the external Architect agent subprocess writing `$TASKS_FILE` directly (uncontrollable). A **single `SessionManager` instance** is created per pipeline run (`prp-pipeline.ts:1779`) and shared by the orchestrator, the background `ResearchQueue`, and the `ConcurrentTaskExecutor` — which is the root cause of the concurrency hazard. All `flushUpdates`/`saveBacklog` callers hold a **full in-memory `Backlog` snapshot** they intend to overwrite with (pure write), not a per-item delta, which is the critical design constraint for the `withLockedTasksJSON` mutator.

---

## 1. SessionManager construction & ownership — SINGLE shared instance

| Fact | Evidence |
|------|----------|
| **Constructed once per pipeline run** | `src/workflows/prp-pipeline.ts:1779` — `this.sessionManager = new SessionManagerClass(this.#prdPath, this.#planDir, this.#flushRetries)` inside `run()`. The constructor explicitly defers construction to `run()` ("SessionManager and TaskOrchestrator will be created in run() to catch initialization errors", `prp-pipeline.ts:380`). |
| **Passed to TaskOrchestrator** | `src/workflows/prp-pipeline.ts:565` — `new TaskOrchestratorClass(this.sessionManager, ...)` inside `initializeSession()`. Stored as `readonly sessionManager: SessionManager` (public) at `task-orchestrator.ts:175`. |
| **Shared with ResearchQueue** | `task-orchestrator.ts:177-181` — `this.researchQueue = new ResearchQueue(this.sessionManager, ...)` in the orchestrator constructor. **Same instance.** |
| **Shared with ConcurrentTaskExecutor** | `concurrent-executor.ts` constructor takes `orchestrator`; workers reach the same instance via `this.#orchestrator.sessionManager.flushUpdates()` (`concurrent-executor.ts:360`). **Same instance.** |

**Conclusion:** ONE `SessionManager` instance is shared across orchestrator + researchQueue + concurrent-executor + pipeline. The in-memory batching fields (`#pendingUpdates`, `#dirty`, `#updateCount`, `#currentSession.taskRegistry`) are therefore **shared mutable state** across concurrent parallel workers — the core of the locking problem.

### ResearchQueue does NOT write tasks.json
`src/core/research-queue.ts` holds a `sessionManager` reference (constructor, `research-queue.ts:218`) but **never** calls `saveBacklog`, `flushUpdates`, `writeTasksJSON`, or `setStatus`. Its only disk I/O is:
- `unlink()` of PRP files (`.md` + `.cache/*.json`) in `deletePRP()` — `research-queue.ts:~390` and `research-queue.ts:~398` (PRP cache files, **not** tasks.json).
- PRP generation via `PRPGenerator` (writes `.md`/`.cache` files).

All task-status persistence from the background queue path flows through `orchestrator.setStatus()` → `sessionManager.updateItemStatus()` (in-memory) → later `flushUpdates()`. The queue itself is write-clean with respect to tasks.json.

---

## 2. `SessionManager.saveBacklog()` — call sites

**Definition:** `src/core/session-manager.ts:713`. Body: guard → `writeTasksJSON(this.#currentSession.metadata.path, backlog)` at **line 718** → sync `#currentSession.taskRegistry` → log. It is itself a **pure write** (no disk read; Zod validation + atomicWrite happen inside `writeTasksJSON`).

| # | File:Line | Caller context | Pure write / RMW | Call chain reaching it |
|---|-----------|----------------|------------------|------------------------|
| S1 | `session-manager.ts:783` | `flushUpdates()` — **0-retries special path** (`if (this.#flushRetries === 0)` at :781) | **PURE WRITE** of `#pendingUpdates` (full in-memory Backlog snapshot) | (any flushUpdates caller) → `flushUpdates` → `saveBacklog(this.#pendingUpdates)` → `writeTasksJSON` |
| S2 | `session-manager.ts:830` | `flushUpdates()` — **retry loop** (`while (attempt < maxAttempts)` at :827) | **PURE WRITE** of `#pendingUpdates` | same |
| S3 | `prp-pipeline.ts:691` | `handleDelta()` step 7 ("Save patched backlog to delta session") | **PURE WRITE** of `patchedBacklog` (built in memory via `patchBacklog(backlog, delta)` at :684) | `run()` → `initializeSession()` → `handleDelta()` → `saveBacklog(patchedBacklog)` → `writeTasksJSON` |
| S4 | `prp-pipeline.ts:820` | `decomposePRD()` ("Save backlog to disk") | **EFFECTIVE PURE WRITE** — reads the tasks.json the Architect subprocess just wrote (`readFile` at :816), parses it (:817), then re-saves the identical content through `saveBacklog` | `run()` → `decomposePRD()` → `saveBacklog(parsedBacklog)` → `writeTasksJSON` |

> **Note on S3/S4:** both run during pipeline **initialization** (single-threaded, before `executeBacklog()` starts any parallel work), so they are not currently racy. They are safe to route as `mutator = () => desiredBacklog` (overwrite).

---

## 3. `SessionManager.flushUpdates()` — call sites

**Definition:** `src/core/session-manager.ts:~754`. Internals confirmed:
- Early-return no-op if `!#dirty` or `!#pendingUpdates`.
- **0-retries path** (:781): single `saveBacklog(#pendingUpdates)`; on error → `#preservePendingUpdates(err)` → rethrow.
- **Retry loop** (:827): exponential backoff (`#calculateFlushRetryDelay`), `#isFileIORetryableError` gate (retries only `EBUSY/EAGAIN/EIO/ENFILE`), on exhaustion or non-retryable → `#preservePendingUpdates` → rethrow.
- **`#preservePendingUpdates`** (`:~944`): writes a **`tasks.json.failed` recovery file** via `writeFile` — it does **not** write `tasks.json`.
- Every write path calls `saveBacklog(this.#pendingUpdates)` → **PURE WRITE** of the accumulated full-Backlog snapshot.

| # | File:Line | Caller context | Pure write / RMW | Call chain reaching it |
|---|-----------|----------------|------------------|------------------------|
| F1 | `task-orchestrator.ts:995` | `executeSubtask()` success path — "FLUSH FIRST … BEFORE committing" (writes status delta to disk so the smart-commit includes `subtask → Complete`) | **PURE WRITE** | `executeSubtask` → (success) → `flushUpdates` → `saveBacklog(#pendingUpdates)` → `writeTasksJSON` |
| F2 | `task-orchestrator.ts:1056` | `executeSubtask()` catch/error path — "FLUSH: Still flush on error to preserve failure state" | **PURE WRITE** | `executeSubtask` catch → `setStatus(Failed)` → `flushUpdates` → `saveBacklog` → `writeTasksJSON` |
| F3 | `concurrent-executor.ts:360` | `executeParallel()` worker **`finally` block** — "Flush state updates atomically" (runs for every parallel worker, success or fail) | **PURE WRITE** | `executeParallel` worker closure → `setStatus` (success :334 / fail :341) → `finally` → `flushUpdates` → `saveBacklog` → `writeTasksJSON` |

> **Concurrency hazard (F3):** each parallel worker calls `setStatus` (mutating shared `#pendingUpdates`/`#currentSession`) and then `flushUpdates` (full-overwrite of that shared snapshot) in its `finally`. Because all workers share one `SessionManager`, the last `flushUpdates` to win clobbers the others' status changes — `#pendingUpdates` is a full-snapshot overwrite, **not** a per-item delta merge. This is the primary race `withLockedTasksJSON` must fix.

---

## 4. `writeTasksJSON()` — call sites (the actual disk writer)

**Definition:** `src/core/session-utils.ts:744`. Body: Zod `BacklogSchema.parse(backlog)` → `JSON.stringify` → `atomicWrite(resolve(sessionPath, 'tasks.json'), content)`. **Does NOT read disk** — it is a blind overwrite of its validated argument. This is why routing it through `withLockedTasksJSON` requires re-reading fresh disk state inside the lock and letting the mutator **merge** (not blindly overwrite).

| # | File:Line | Caller context | Pure write / RMW | Call chain reaching it |
|---|-----------|----------------|------------------|------------------------|
| W1 | `session-manager.ts:718` | `saveBacklog()` | **PURE WRITE** (blind overwrite of caller's Backlog) | (all saveBacklog callers S1–S4) |
| W2 | `tasks-json-recovery.ts:189` | `recoverTasksJson()` **PATH A** (clean disk) — `readTasksJSON(sessionDir)` at :175 → `validateBacklogState` → reconstruct from `opts.baselineBacklog ?? diskBacklog` via `structuredClone` → `setItemStatus(itemId, status)` → write | **TRUE RMW** (read disk → mutate → write) | `executeSubtask` → `#recoverAfterAgentRun` (`:~1118`) → `recoverTasksJson` → `writeTasksJSON` |
| W3 | `tasks-json-recovery.ts:209` | `recoverTasksJson()` **PATH B** (corrupt disk → git restore) — `gitReadFileAtCommit` → `BacklogSchema.parse` → `structuredClone` → `setItemStatus` → write | **TRUE RMW** (read from git history → mutate → write) | same |

> `recoverTasksJson` is **already a correct RMW** (re-applies only the legitimate single-item status delta onto a trustworthy base, discarding unauthorized agent mutations). It is the model to follow. It just needs to be **wrapped inside the lock** so it cannot interleave with a concurrent `flushUpdates`.

---

## 5. `readTasksJSON()` — call sites (read side of RMW)

**Definition:** `src/core/session-utils.ts:841`. Reads + parses + Zod-validates.

| # | File:Line | Caller | Notes |
|---|-----------|--------|-------|
| R1 | `tasks-json-recovery.ts:175` | `recoverTasksJson` PATH A | The read half of RMW (W2). |
| R2 | `task-orchestrator.ts:1132` | `#recoverAfterAgentRun` — `const recovered = await readTasksJSON(session.metadata.path)` | Reloads in-memory registry from the recovered disk; then `refreshBacklog()` (in-memory only per the code comment at :1130). |
| R3 | `session-manager.ts:~1023` | `loadBacklog()` | `return readTasksJSON(this.#currentSession.metadata.path)`. Infrequently used utility. |

---

## 6. `updateItemStatus()` — CONFIRMED no disk touch

**Definition:** `session-manager.ts:1048`. Verified in-memory only:
- Reads `const currentBacklog = this.#currentSession.taskRegistry` (in-memory).
- Calls `updateItemStatusUtil(currentBacklog, itemId, status)` (pure function, `task-utils`).
- Mutates only: `this.#pendingUpdates = updated`, `this.#dirty = true`, `this.#updateCount++`, and `this.#currentSession.taskRegistry = updated`.
- Explicit code comment: **"NOTE: No longer calling await this.saveBacklog(updated). Caller must call flushUpdates() to persist changes."**

So `updateItemStatus` is purely a memory mutation; disk contact happens later via `flushUpdates`. The full chain during execution is:

```
orchestrator.setStatus(id, status)
  → sessionManager.updateItemStatus(id, status)        [IN-MEMORY ONLY: #pendingUpdates/#dirty/#currentSession]
  → orchestrator.refreshBacklog()                       [IN-MEMORY ONLY]
  ... later ...
  → sessionManager.flushUpdates()                       [DISK: saveBacklog(#pendingUpdates) → writeTasksJSON]
```

---

## 7. Critical design constraints for `withLockedTasksJSON(sessionDir, mutator)`

1. **`flushUpdates` writes a full-snapshot overwrite, not a delta.** `#pendingUpdates` is the *entire* Backlog produced by the last `updateItemStatus` call (which itself produces a full Backlog via `updateItemStatusUtil`). There is **no per-item delta tracking** — only `#updateCount` (an integer) and the full snapshot. Therefore, simply routing `flushUpdates` through `withLockedTasksJSON` and returning `#pendingUpdates` as the mutator result would still **blindly overwrite** fresh disk state and re-introduce the race. The fix requires re-applying the *intended status change(s)* onto the freshly-read locked disk — which means `flushUpdates`/`updateItemStatus` must either (a) record the `{itemId, status}` deltas, or (b) the mutator must diff `#pendingUpdates` against the locked disk and merge. **This is the hardest call site to migrate.**

2. **`saveBacklog` direct callers (S3 handleDelta, S4 decomposePRD) are initialization-time, single-threaded pure writes.** Safe to implement as `withLockedTasksJSON(dir, () => desiredBacklog)` — but still must hold the lock to be consistent with the accessor discipline.

3. **`recoverTasksJson` (W2/W3) is already a correct RMW** and only needs to run *inside* the lock. Its internal `readTasksJSON` (R1) should become the locked read; the whole function body is the mutator.

4. **External Architect write (uncontrollable).** During `decomposePRD`, the Architect subprocess writes `$TASKS_FILE` (tasks.json) directly via the harness (`prp-pipeline.ts` comment at :811 "The architect agent writes to $TASKS_FILE"), then the pipeline reads it back (:816) and re-saves through `saveBacklog` (:820). This external write happens **outside any in-process lock**. If a future cross-process lock is needed, this path is the gap; for an in-process lock it is safe because it occurs during single-threaded initialization.

5. **`saveBacklog`'s in-memory sync side effect.** `saveBacklog` (line 726-729) updates `#currentSession.taskRegistry = backlog` after writing. When routing through `withLockedTasksJSON`, ensure the in-memory registry is synced to the *post-mutator* (merged) result, not the stale caller snapshot, or memory and disk will diverge.

---

## Gaps / next steps

- **Exact `flushUpdates` migration semantics are the open design question.** Recommendation: before implementing, decide whether `updateItemStatus` should push `{itemId, status}` deltas into a queue (making `flushUpdates`'s mutator a clean re-apply loop) versus a structural-diff merge. The delta-queue approach is cleaner and matches `recoverTasksJson`'s established "re-apply legitimate delta" pattern.
- **`loadBacklog` (R3) and `#recoverAfterAgentRun`'s direct `readTasksJSON` (R2)** are reads, not writes, so they are out of scope for the *write* lock — but if `withLockedTasksJSON` is meant to also serialize reads against writes, these become relevant (R2 in particular runs immediately after a `recoverTasksJson` write and would benefit from being inside the same locked critical section).
- Test files were not exhaustively grepped for additional callers; the above covers all production `src/` source paths. If the lock accessor is also exposed for tests, expect test-side call sites to appear.

---

## Source line-number index (verified)

| Symbol | Location |
|--------|----------|
| `new SessionManagerClass(...)` (single construction) | `prp-pipeline.ts:1779` |
| `new TaskOrchestratorClass(this.sessionManager, ...)` | `prp-pipeline.ts:565` |
| orchestrator → `new ResearchQueue(this.sessionManager, ...)` | `task-orchestrator.ts:177` |
| `saveBacklog` def | `session-manager.ts:713` |
| `saveBacklog` → `writeTasksJSON` | `session-manager.ts:718` |
| `flushUpdates` → `saveBacklog` (0-retries) | `session-manager.ts:783` |
| `flushUpdates` → `saveBacklog` (retry loop) | `session-manager.ts:830` |
| `updateItemStatus` def (in-memory only) | `session-manager.ts:1048` |
| `#preservePendingUpdates` (writes `tasks.json.failed`, not tasks.json) | `session-manager.ts:~944` |
| `writeTasksJSON` def | `session-utils.ts:744` |
| `readTasksJSON` def | `session-utils.ts:841` |
| `recoverTasksJson` → `readTasksJSON` (PATH A) | `tasks-json-recovery.ts:175` |
| `recoverTasksJson` → `writeTasksJSON` (PATH A) | `tasks-json-recovery.ts:189` |
| `recoverTasksJson` → `writeTasksJSON` (PATH B git) | `tasks-json-recovery.ts:209` |
| `setStatus` def (orchestrator) | `task-orchestrator.ts:~338` |
| `flushUpdates` call (orchestrator success) | `task-orchestrator.ts:995` |
| `flushUpdates` call (orchestrator error) | `task-orchestrator.ts:1056` |
| `#recoverAfterAgentRun` → `recoverTasksJson` | `task-orchestrator.ts:~1118` |
| `#recoverAfterAgentRun` → `readTasksJSON` | `task-orchestrator.ts:1132` |
| `flushUpdates` call (concurrent-executor finally) | `concurrent-executor.ts:360` |
| `saveBacklog` call (handleDelta step 7) | `prp-pipeline.ts:691` |
| `saveBacklog` call (decomposePRD) | `prp-pipeline.ts:820` |