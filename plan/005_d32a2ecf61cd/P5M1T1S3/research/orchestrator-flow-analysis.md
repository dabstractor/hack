# Orchestrator Flow & Insertion-Point Analysis — P5.M1.T1.S3

Researched against the current `src/core/task-orchestrator.ts` (HEAD of session 005,
before S2's edits land — S2 edits `research-queue.ts` only, NOT the orchestrator).

## 1. `executeSubtask` current control flow (verbatim structure)

```
executeSubtask(subtask):
  1. this.#logger.info('Executing Subtask')
  2. await this.setStatus(subtask.id, 'Researching', 'Starting PRP generation')   // → updateItemStatus #1
  3. this.#logger.debug('Researching - preparing PRP')
  4. const cachedPRP = this.researchQueue.getPRP(subtask.id)                       // cache check (METRICS ONLY)
  5.   if (cachedPRP) { #cacheHits++ } else { #cacheMisses++ }                      //   → result is NOT consumed downstream
  6. this.#logCacheMetrics()
  7. if (!this.canExecute(subtask)) { log blockers; warn; return; }                 // dependency gate (returns early)
  8. await this.setStatus(subtask.id, 'Implementing', 'Starting implementation')   // → updateItemStatus #2
  9. try {
  10.   result = await this.#retryManager.executeWithRetry(subtask,
            async () => this.#prpRuntime.executeSubtask(subtask, this.#backlog))    // THE AGENT-RUN
  11.   this.#logger.info('PRPRuntime execution complete')
  12.   fire-and-forget this.researchQueue.processNext(this.#backlog)
  13.   if (result.success) setStatus(Complete) else setStatus(Failed)              // → updateItemStatus #3
  14.   smartCommit(...); this.sessionManager.flushUpdates()
     } catch (error) {
  15.   setStatus(Failed); flushUpdates(); throw error
     }
```

### Facts this establishes
- **`waitForPRP` is NEVER called today.** `grep -rn waitForPRP src/` → only matches inside
  `research-queue.ts` (doc-comments + the method definition). The item's RESEARCH NOTE #1
  ("TaskOrchestrator calls `researchQueue.waitForPRP(id)`") describes the **intended post-S3
  state**, NOT the current code. **S3 introduces the first caller.**
- **`getPRP`'s return value is discarded** (steps 4-6): it only feeds cache hit/miss metrics.
  The real PRP consumed by execution is generated INSIDE `prpRuntime.executeSubtask` by its own
  private `#generator` (`new PRPGenerator(...)` — a DIFFERENT instance than the queue's
  `#prpGenerator`). See `src/agents/prp-runtime.ts` `executeSubtask` PHASE 1.
- The only `try/catch` in `executeSubtask` wraps steps 10-14 (the agent-run). Steps 1-8 are
  **unprotected** — an exception there bubbles out of `executeSubtask` leaving the item in
  `Researching`/`Implementing` with no `Failed`.

## 2. Chosen insertion point for the research-wait + fallback

**Place the `waitForPRP` + fallback as the FIRST statement inside the existing `try {` block
(step 9), immediately after `setStatus('Implementing')` (step 8) and before
`this.#retryManager.executeWithRetry(...)` (step 10).**

Rationale:
- **Covered by the existing catch** (step 15): a non-`ResearchTimeoutError` from `waitForPRP`
  (a real generation error) propagates to the catch → `setStatus(Failed)` → flush → rethrow.
  Item status contract preserved (always ends Complete/Failed). If placed ABOVE the try, a
  real error would leak out with the item stuck in `Researching`.
- **After the dependency gate (step 7):** a subtask blocked on dependencies `return`s early and
  never triggers the research-wait (no wasted wait on items that won't run).
- **Outside `retryManager.executeWithRetry`:** `TaskRetryManager` is the transient-infra retry
  dimension (API timeout, network, exponential backoff). The deadline/abandonment fallback is a
  DIFFERENT concern (PRD §4.2 vs §4.5/implementation_notes.md §3). The fallback is a single
  synchronous inline call, not a retry loop — do NOT wrap it in `executeWithRetry`.
- Status-call count unchanged: the fallback performs NO `setStatus` (stays in `Implementing`),
  so the existing `expect(updateItemStatus).toHaveBeenCalledTimes(3)` assertions
  (Researching → Implementing → Complete) stay GREEN.

```
 8. await this.setStatus(subtask.id, 'Implementing', ...)
 9. try {
 9a.   // NEW: await background research (deadline-guarded by S2); fallback on abandonment.
        try {
          await this.researchQueue.waitForPRP(subtask.id);
        } catch (error) {
          if (error instanceof ResearchTimeoutError) {
            this.#logger.info({...}, 'Background research abandoned (deadline exceeded); re-researching synchronously inline');
            await this.researchQueue.researchNow(subtask, this.#backlog);
            this.#logger.info({...}, 'Synchronous inline re-research complete');
          } else {
            throw error;   // real generation error → outer catch → Failed
          }
        }
 10.   result = await this.#retryManager.executeWithRetry(subtask, async () => ...)
```

## 3. The synchronous generate path: `ResearchQueue.researchNow` (NEW method)

**Decision: add `researchNow(task, backlog): Promise<PRPDocument>` to `ResearchQueue`** — the
queue owns the private `#prpGenerator`, so only it can call `#prpGenerator.generate()` directly.

### Why on the queue (not a new PRPGenerator in the orchestrator)
- The item description's MOCKING section says: "Stub **researchQueue** (waitForPRP returns
  abandoned …); stub prpRuntime. No network." It does NOT mention stubbing a separate
  PRPGenerator. If the orchestrator built its own `PRPGenerator`, the test would have to mock
  `prp-generator.js` (as `research-queue.test.ts` does) — contradicting the item's mock list.
- The item's INPUT section explicitly offers "`researchQueue.researchNow(taskId, backlog)`" as
  the FIRST option ("or call the underlying PRPGenerator.generate inline").
- Reuses the queue's already-configured generator (correct noCache / cacheTtlMs settings) — no
  config duplication in the orchestrator.

### Conflict with S2's PRP note
S2's PRP said: *"The PRPGenerator is held privately as `#prpGenerator`; do NOT expose it (S3
re-researches via its own PRPGenerator, not via the queue)."* That was a HYPOTHESIS about how S3
might work. **S3's authoritative item description endorses `researchNow` on the queue. S3's item
wins.** S3 adds a NEW method to research-queue.ts — it does NOT modify any of S2's deliverables
(`waitForPRP` deadline, `abandoned` Set, `isAbandoned`, `ResearchTimeoutError`, the `processNext`
`.then` guard). No collision with S2.

## 4. Dedup / ignore contract proof (a late background result must not clobber the inline result)

Trace with task X:
1. Background research enqueued → `processNext` starts `#prpGenerator.generate(X)`, stores promise
   in `researching`, does NOT cache yet.
2. Orchestrator calls `waitForPRP(X)`. Deadline (S2, `getResearchTimeoutSeconds()`) elapses →
   S2 adds X to `abandoned`, throws `ResearchTimeoutError`.
3. Orchestrator catches → calls `researchNow(X, backlog)`.
4. `researchNow`: cache miss (`results` empty) → calls `#prpGenerator.generate(X)` **inline** (a
   NEW generate call, awaited synchronously) → `this.results.set(X, prp)` (explicit, UNGUARDED) →
   returns prp. **The inline result is now authoritative in `results`.**
5. The BACKGROUND generate (step 1) eventually resolves → `processNext`'s `.then` runs S2's guard:
   `if (this.abandoned.has(X)) { debug-log 'Ignoring late PRP result for abandoned task'; return prp; }`
   → **NOT cached**. The late background result is discarded. The inline result wins. ✓
6. (Or the background generate rejects → `processNext`'s `.catch` logs warn, no throw escapes —
   S2 verified `Promise.race` prevents unhandled rejection. `results` keeps the inline result.) ✓

**Key invariant:** `researchNow`'s `results.set` is an EXPLICIT, UNGUARDED write. S2's
`processNext` `.then` guard only skips writes for ABANDONED tasks. Since `researchNow` does not
go through `processNext`, its write always lands. The late background result always goes through
`processNext`, so it's always skipped for abandoned X. ⇒ inline result is the single source of truth.

## 5. `researchNow` does NOT touch the `researching` Map

The background promise stays in `researching` until the background generate completes (S2's
`processNext` `.finally` owns that cleanup). `researchNow` must NOT `researching.delete(X)` —
that would corrupt the in-flight tracking and could let a duplicate get re-enqueued. `researchNow`
only (a) checks `results` cache, (b) calls generate inline, (c) caches in `results`, (d) returns.
X stays `abandoned === true` for the queue's lifetime (cheap, harmless — enables the late-result
dedup in step 5).

## 6. The orchestrator discards `waitForPRP`/`researchNow` return values (intentional)

The orchestrator does NOT pipe the PRP to `prpRuntime.executeSubtask` — that method's signature
is `(subtask, backlog)` and it generates its own PRP internally. Changing it to accept a PRP is
OUT OF SCOPE (would break `prp-runtime.test.ts` and the item says "no API surface change at the
orchestrator layer"). The research-wait + fallback achieves the goal ("executeSubtask no longer
blocks indefinitely") by ensuring research either completes (waitForPRP resolves) or is done
inline (researchNow) before the agent-run. The cached PRP in `results` is "consumed downstream by
the normal execution path" in the sense that it's available in the queue cache; PRPRuntime's own
generation is pre-existing redundancy that S3 does not need to resolve.
