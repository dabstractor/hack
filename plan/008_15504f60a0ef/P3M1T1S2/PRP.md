# PRP — P3.M1.T1.S2: Convert ResearchQueue prefetch model to depth-chained supervisor

---

## Goal

**Feature Goal**: Change the prefetch **model** from a flat "bulk-enqueue all
subtasks of a Task into a `maxSize` concurrency pool" to a **depth-chained
supervisor** that, when `PARALLEL_RESEARCH` is enabled, researches a **chain of
`RESEARCH_DEPTH` items ahead** of the subtask currently being implemented —
prefetching the next item in the chain as the orchestrator consumes each
completed PRP (PRD §4.2). When `PARALLEL_RESEARCH` is disabled (`false`,
default), behavior is **unchanged** (legacy flat pool / synchronous
`researchNow` fallback).

**Deliverable**:
1. **`src/core/task-orchestrator.ts`** — MODIFY:
   - **ADD** a private method **`#prefetchResearchAhead(fromIndex: number)`**
     that, when `isParallelResearch()` is `true`, enqueues the next
     `getResearchDepth()` **subtask** items from `#executionQueue` (starting at
     `fromIndex`) via `this.researchQueue.enqueue(subtask, this.#backlog)`.
     `enqueue`'s existing dedup (skip if `researching.has`/`results.has`) makes
     this idempotent and safe to call repeatedly. When `isParallelResearch()`
     is `false`, the method is a **no-op** (preserves today's behavior).
   - **GATE** the existing `executeTask` bulk-enqueue loop (≈line 644) on
     `!isParallelResearch()`: when parallel research is ON, `executeTask`
     enqueues **only the first subtask** (so the very first PRP starts
     immediately) and the chain is then driven by `#prefetchResearchAhead`.
     When OFF, the legacy bulk-enqueue is preserved verbatim.
   - **CALL** `#prefetchResearchAhead(...)` from `executeSubtask` at the point
     where the subtask transitions to research/implementation — i.e.
     immediately after the cache-hit/miss log block (≈line 720), BEFORE the
     `waitForPRP` call, passing the **current subtask's index in
     `#executionQueue`**. Because `processNextItem()` already `shift()`ed the
     item, "ahead" = the next items remaining in the queue. (See Implementation
     Tasks for the exact index plumbing.)
   - **ADD** the import: `import { isParallelResearch, getResearchDepth } from '../config/constants.js';`
2. **`src/core/research-queue.ts`** — MODIFY (minimal, additive):
   - **ADD** a public read-only getter **`get depth()`** (or
     `getDepth(): number`) returning the configured chain depth via
     `getResearchDepth()` — so the orchestrator/tests can introspect it.
     **NO change** to `enqueue`, `processNext`, `waitForPRP`, `researchNow`,
     `deletePRP`, `isResearching`, `isAbandoned`, `getPRP`, `getStats`,
     `clearCache`, or the constructor signature. The flat `maxSize` pool stays
     as the underlying concurrency cap (it is orthogonal to "how far ahead to
     prefetch"). This keeps all 70 unit tests + integration tests GREEN.
3. **`tests/unit/core/task-orchestrator.test.ts`** — ADD: unit tests for
   `#prefetchResearchAhead` behavior (parallel ON → enqueues exactly
   `getResearchDepth()` upcoming subtasks; parallel OFF → no-op; dedup →
   re-call doesn't double-enqueue; chain advances as items are consumed).
   Drive 100% branch coverage on the new orchestrator branches
   (`isParallelResearch()` true/false, the gated `executeTask` branch).
4. **`tests/unit/core/research-queue.test.ts`** — ADD: a test asserting the new
   `depth` getter returns `getResearchDepth()` (default 2; respects
   `RESEARCH_DEPTH` env via `vi.stubEnv`/`vi.unstubAllEnvs`). Keeps 100%
   coverage on research-queue.ts.

**Success Definition**:
- With `PARALLEL_RESEARCH=true` and `RESEARCH_DEPTH=2`, when the orchestrator
  begins implementing subtask N, the ResearchQueue is actively researching (or
  has cached) subtasks N+1 and N+2 (the "chain ahead"). As N completes and N+1
  begins, N+3 is prefetched.
- With `PARALLEL_RESEARCH` unset/false, `executeTask` bulk-enqueues all
  subtasks (legacy) and `{type:'all'}` leaf runs fall back to synchronous
  `researchNow` exactly as today — **zero behavior change**.
- `npm run validate` GREEN; 100% coverage on `src/**/*.ts` preserved.
- All existing ResearchQueue unit + integration tests pass unchanged
  (signatures stable; `queue`/`researching`/`results`/`abandoned` stay public).
- `verifyPromiseHandling()` (defaults to `src/core/research-queue.ts`) still
  reports all rejection handlers present (no new unhandled promise).

---

## User Persona (if applicable)

**Target User**: Pipeline operator running the autonomous PRP pipeline on a
multi-subtask backlog.
**Use Case**: Operator enables background research (`-r` / `PARALLEL_RESEARCH=true`)
so the implementer slot is never idle waiting for the next PRP, and never wastes
capacity researching items that won't be needed for a long time.
**User Journey**: `prd -r` → orchestrator starts subtask N → supervisor
researches N+1..N+DEPTH ahead → N completes, N+1 PRP is ready → implementer
proceeds immediately → supervisor prefetches N+DEPTH+1.
**Pain Points Addressed**: PRD §4.2's two failure modes —
"fast implementer → stall waiting for N+1" and "slow implementer → wasted idle
capacity" — are collapsed by a bounded-ahead chain instead of a single-slot
prefetch or an unbounded bulk-enqueue.

---

## Why

- **PRD compliance**: PRD §4.2 (h3.4) specifies a "background supervisor
  researches a **chain** of up to `RESEARCH_DEPTH` (default 2) items ahead,
  rather than a single item … The supervisor keeps prefetching the next item in
  the chain while the orchestrator consumes completed PRPs one at a time."
  §9.2.2 (h4.1) defines `PARALLEL_RESEARCH` and `RESEARCH_DEPTH`.
- **Architectural alignment**: `architecture/phase_findings.md` §PHASE 3 states
  "ResearchQueue (research-queue.ts) is a flat `maxSize=3` POOL, not a
  depth-chain" and requires converting the prefetch **model** to a
  depth-chained supervisor.
- **Backward compatibility**: contract item 3c mandates "when
  `PARALLEL_RESEARCH` is false, behave as today (or single-item prefetch)." The
  `false` branch is the legacy path — unchanged.
- **Foundation for S4**: S4 forwards `PARALLEL_RESEARCH` + `RESEARCH_DEPTH` to
  the bugfix child; S2 is the consumer of those helpers in the main orchestrator.

### Out of scope (hard fences)
- **Config constants themselves** → S1 (DONE; treat as contract).
- **RESEARCH_TIMEOUT docs / `.env.example`** → S3.
- **Bugfix sub-pipeline env-var forwarding** → S4.
- **PRD.md / tasks.json / prd_snapshot.md / vitest.config.ts** → READ-ONLY.
- **ResearchTimeoutError / researchNow / deletePRP / waitForPRP / getStats
  signatures** → UNCHANGED (orchestrator + all tests depend on them).
- **The flat `maxSize` concurrency cap** → UNCHANGED. "Depth chain" governs
  *which/how-many items to prefetch ahead*; `maxSize` governs *how many
  generate() calls run at once*. They are orthogonal. Do NOT collapse them.

---

## What

### User-visible behavior
None at the CLI surface (contract item 5 DOCS: none). Operators who enable
`PARALLEL_RESEARCH=true` will observe (in logs) the orchestrator researching a
bounded-ahead chain instead of bulk-prefetching an entire Task's subtasks at
once. Operators who do nothing see identical behavior to today.

### Technical requirements (exact contract — item 3)

**(a) Orchestrator depth-chain method (`task-orchestrator.ts`).** Add:

```ts
import { isParallelResearch, getResearchDepth } from '../config/constants.js';

// inside class TaskOrchestrator:
/**
 * Depth-chained research supervisor (PRD §4.2).
 *
 * When PARALLEL_RESEARCH is enabled, enqueues up to getResearchDepth()
 * UPCOMING subtasks (ahead of the current implementation cursor) into the
 * ResearchQueue. enqueue()'s dedup makes this idempotent. When disabled,
 * this is a no-op and the legacy flat-pool / synchronous-researchNow path
 * is used (backward compatibility).
 *
 * @param upcomingSubtasks - the subtasks ahead of the current item, in
 *   execution order (caller slices #executionQueue). Only Subtask-type items
 *   are enqueued; non-subtask items are skipped.
 */
#prefetchResearchAhead(upcomingSubtasks: HierarchyItem[]): void {
  if (!isParallelResearch()) {
    return; // legacy path — no behavior change
  }
  const depth = getResearchDepth();
  let enqueued = 0;
  for (const item of upcomingSubtasks) {
    if (enqueued >= depth) break;
    if (item.type !== 'Subtask') continue; // only leaf subtasks are researchable
    // enqueue is async but we intentionally fire-and-forget here: dedup +
    // processNext cap concurrency; waitForPRP surfaces errors at consume time.
    this.researchQueue.enqueue(item as Subtask, this.#backlog).catch(error => {
      const msg = error instanceof Error ? error.message : String(error);
      this.#logger.warn(
        { subtaskId: item.id, error: msg },
        'Depth-chain prefetch enqueue failed (non-critical)'
      );
    });
    enqueued++;
  }
}
```

**(b) Gate `executeTask` bulk-enqueue on parallel flag (`task-orchestrator.ts`
≈line 630-660).** Replace the unconditional `for (const subtask of
task.subtasks) { await enqueue(...) }` with a branch:

```ts
if (isParallelResearch()) {
  // Depth-chain model: enqueue ONLY the first subtask now; the chain is driven
  // by #prefetchResearchAhead as the orchestrator consumes items (PRD §4.2).
  if (task.subtasks.length > 0) {
    await this.researchQueue.enqueue(task.subtasks[0], this.#backlog);
  }
} else {
  // Legacy flat-pool model: bulk-enqueue all subtasks (unchanged behavior).
  for (const subtask of task.subtasks) {
    await this.researchQueue.enqueue(subtask, this.#backlog);
    this.#logger.debug(
      { taskId: task.id, subtaskId: subtask.id },
      'Enqueued for parallel research'
    );
  }
}
```

**(c) Drive the chain from `executeSubtask` (`task-orchestrator.ts` ≈line 720).**
After the cache hit/miss logging, BEFORE the `waitForPRP` try/catch, call the
supervisor with the upcoming slice. Because `processNextItem()` already
`shift()`ed the current subtask off `#executionQueue`, the upcoming items ARE
the current `#executionQueue` contents (the first `getResearchDepth()` of them):

```ts
// PRD §4.2: depth-chained supervisor prefetches RESEARCH_DEPTH items ahead.
// (Fire-and-forget enqueue; dedup + waitForPRP handle completion/errors.)
this.#prefetchResearchAhead(this.#executionQueue);
```

`#executionQueue` is `HierarchyItem[]`; the method filters to `Subtask` type.
This naturally advances the chain: when subtask N+1 is processed, its
`executeSubtask` re-calls `#prefetchResearchAhead` on the now-shorter queue,
enqueueing N+DEPTH+1.

**(d) ResearchQueue `depth` getter (`research-queue.ts`).** Minimal, additive:

```ts
/**
 * The configured depth-chain prefetch depth (PRD §4.2, read via getResearchDepth()).
 *
 * @returns The number of items the depth-chained supervisor researches ahead.
 *   Orthogonal to maxSize (which caps concurrent generate() calls).
 */
get depth(): number {
  return getResearchDepth();
}
```

Add the import: `import { getResearchDepth } from '../config/constants.js';`
(`getResearchTimeoutSeconds` is already imported from the same module — extend
that import line.) **No other change to research-queue.ts.**

### Success Criteria
- [ ] With `PARALLEL_RESEARCH=true`, `RESEARCH_DEPTH=2`, and 5 upcoming
      subtasks, calling `executeSubtask` on the first enqueues exactly subtasks
      #2 and #3 into `researchQueue.researching`/`queue` (the chain ahead).
- [ ] As each subtask is consumed, the chain advances (the next-ahead subtask
      is enqueued) — verified by a test that walks 3 sequential
      `executeSubtask` calls and asserts the researching set grows by one each
      time up to the depth.
- [ ] With `PARALLEL_RESEARCH` unset/false, `executeTask` bulk-enqueues all
      subtasks (legacy) and `#prefetchResearchAhead` is a no-op — verified by a
      test asserting enqueue is called `task.subtasks.length` times in the
      legacy branch and 0 times from the supervisor.
- [ ] `researchQueue.depth === getResearchDepth()` (default 2; `RESEARCH_DEPTH=5`
      → 5).
- [ ] All existing ResearchQueue unit + integration tests pass UNCHANGED.
- [ ] `verifyPromiseHandling()` (default file `src/core/research-queue.ts`)
      reports `allHandled: true` (the new `#prefetchResearchAhead` enqueue has a
      `.catch`; the getter adds no promises).
- [ ] `npm run validate` GREEN; 100% coverage on `src/**/*.ts` preserved.

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_
**Yes.** The change spans 4 files (2 source, 2 test). Correctness rests on eight
pre-proven facts, all pinned below: (1) **ResearchQueue is a flat pool** whose
`enqueue` dedups (`researching.has`/`results.has`) and `processNext` caps at
`maxSize` — so depth logic can live entirely in the CALLER (orchestrator)
without touching pool internals; (2) **the orchestrator owns `#executionQueue`**
— the linear chain; `processNextItem()` `shift()`s it, so at `executeSubtask`
time the queue holds exactly the upcoming items; (3) **`executeTask`
bulk-enqueues** today (line ≈644) and the `{type:'all'}` leaf path NEVER calls
it (leaf subtasks fall back to synchronous `researchNow` at line ≈773) — so the
supervisor's value is precisely fixing the leaf-all no-prefetch case; (4) the
config helpers `isParallelResearch()` + `getResearchDepth()` exist from S1
(contract); `getResearchTimeoutSeconds()` already flows the 1800s default into
`waitForPRP` with NO ResearchQueue change needed; (5) **all ResearchQueue tests
reach into `queue.queue`/`queue.results`/`queue.researching`** (public readonly)
— must stay public; (6) **`verifyPromiseHandling()` defaults to
`src/core/research-queue.ts`** — any new fire-and-forget `.then` MUST `.catch`;
(7) **100% branch coverage** is enforced — every new `if` (`isParallelResearch`
true/false, `item.type !== 'Subtask'`, `enqueued >= depth`) needs a test;
(8) the **backward-compat `false` branch** is the legacy path — verbatim
preserved.

### Documentation & References
```yaml
# MUST READ — the PRD spec (provided in selected_prd_content)
- docfile: PRD.md
  section: "4.2 The Execution Loop — Parallel Research, Deadline & Fallback" (h3.4)
       + "9.2.2 Required Environment Variables" (h4.1)
  why: §4.2 defines the depth-chain supervisor ("chain of up to RESEARCH_DEPTH
       ahead", "prefetching the next as the orchestrator consumes each completed
       PRP"); §9.2.2 defines PARALLEL_RESEARCH (default false) + RESEARCH_DEPTH
       (default 2) + RESEARCH_TIMEOUT (default 1800s).
  critical: PARALLEL_RESEARCH + RESEARCH_DEPTH MUST be forwarded to the bugfix
            child (§4.4) — that wiring is S4, NOT S2. S2 only CONSUMES the helpers
            in the main orchestrator. RESEARCH_TIMEOUT default is 1800s (already
            flows via getResearchTimeoutSeconds() — NO ResearchQueue edit needed).

# MUST READ — this subtask's research (proven facts about the working tree)
- docfile: plan/008_15504f60a0ef/P3M1T1S2/research/s2-codebase-analysis.md
  section: §1 (ResearchQueue flat-pool internals + public surface), §2 (orchestrator
       owns #executionQueue + executeTask bulk-enqueue + executeSubtask consume path),
       §3 (the depth-chain seam design), §4 (S1 config contract), §5 (test surface),
       §6 (validation commands), §7 (scope fences), §8 (executeTask gating risk)
  why: Proves the minimal-risk design (depth logic in the orchestrator, NOT in the
       pool), the exact edit sites (executeTask ≈644, executeSubtask ≈720), and the
       test-preservation constraints.

# MUST READ — S1 contract (the config layer this PRP consumes)
- docfile: plan/008_15504f60a0ef/P3M1T1S1/PRP.md
  section: "Goal" (isParallelResearch/getResearchDepth/DEFAULT_RESEARCH_TIMEOUT_SECONDS=1800)
  why: S2 CONSUMES these helpers; must not redefine. The 1800s default already
       flows through waitForPRP (which calls getResearchTimeoutSeconds()) — S2
       does NOT touch the timeout logic.

# MUST READ — architecture reference
- docfile: plan/008_15504f60a0ef/architecture/phase_findings.md
  section: "## PHASE 3" → "### ResearchQueue (research-queue.ts)" (lines 70-73)
  why: Confirms the flat maxSize=3 pool reality and the required depth-chain
       conversion; confirms RESEARCH_TIMEOUT 300→1800 (S1's job, already done).

# THE FILE TO EDIT — orchestrator (depth-chain supervisor lives HERE)
- file: src/core/task-orchestrator.ts
  section: (1) constructor ResearchQueue init (≈174-183, UNCHANGED); (2) executeTask
       bulk-enqueue loop (≈630-660) — GATE on isParallelResearch(); (3) executeSubtask
       cache-hit/miss block (≈700-725) — ADD #prefetchResearchAhead(this.#executionQueue)
       call; (4) ADD the private #prefetchResearchAhead method near other private
       helpers (e.g. after #buildQueue ≈line 228 or near #recoverAfterAgentRun).
  why: The orchestrator owns #executionQueue (the chain) and drives consumption via
       processNextItem(). Depth semantics belong in the consumer, not the pool.
  pattern: existing enqueue calls (line 644: await this.researchQueue.enqueue(subtask,
       this.#backlog)) — the supervisor uses the SAME call, just gated + bounded.
  gotcha: #executionQueue contains HierarchyItem (Phase|Milestone|Task|Subtask);
       the supervisor MUST filter item.type === 'Subtask' before enqueue (enqueue
       accepts Task|Subtask but only leaf subtasks are the "chain ahead" per PRD §4.2).

# THE FILE TO EDIT — ResearchQueue (minimal additive getter)
- file: src/core/research-queue.ts
  section: extend the constants import (line ≈31) to include getResearchDepth; ADD a
       `get depth()` getter near getStats() (≈line 395) or after the constructor.
  why: Lets the orchestrator/tests introspect the configured chain depth; also
       documents the orthogonality (depth vs maxSize).
  pattern: existing read-only accessors (getStats, getPRP, isResearching).
  gotcha: Do NOT add depth to the constructor signature (breaks the orchestrator's
       `new ResearchQueue(sessionManager, concurrency, noCache, cacheTtlMs)` call AND
       all tests). Read depth live from getResearchDepth() so env changes take effect.

# THE FILES TO EDIT — tests (100% coverage gate)
- file: tests/unit/core/task-orchestrator.test.ts
  section: ADD a describe('TaskOrchestrator: depth-chained research supervisor', …)
       block. Mock researchQueue.enqueue (spy) to assert call counts/args.
  why: Covers the new #prefetchResearchAhead branches + the gated executeTask branch.
  pattern: existing orchestrator unit tests mock researchQueue + assert enqueue calls.
  gotcha: must drive BOTH isParallelResearch() true AND false (vi.stubEnv +
       vi.unstubAllEnvs). Must cover the item.type!=='Subtask' skip branch (put a
       Task item in the upcoming slice) and the enqueued>=depth early-break branch.

- file: tests/unit/core/research-queue.test.ts
  section: ADD an it() asserting queue.depth === getResearchDepth() (default 2; stub
       RESEARCH_DEPTH=5 → 5).
  why: Covers the new getter.
  pattern: existing simple-assertion tests; use vi.stubEnv/vi.unstubAllEnvs.
  gotcha: getter reads env live — stub then unstub to avoid leaking into other tests.

# CONTRACT INPUTS (read-only)
- file: vitest.config.ts
  why: 100/100/100/100 thresholds on src/**/*.ts — new branches in BOTH
       task-orchestrator.ts and research-queue.ts must be covered.
- file: package.json
  why: npm run validate = lint + format:check + typecheck + test:run (green gate).
- file: src/utils/promise-handling-validator.ts
  why: verifyPromiseHandling() defaults to src/core/research-queue.ts — any new
       fire-and-forget promise there (or referenced pattern) MUST have a .catch.
```

### Current Codebase tree (relevant slice)
```bash
src/
  core/
    task-orchestrator.ts      # EDIT — +isParallelResearch/getResearchDepth import, +gate executeTask, +#prefetchResearchAhead, +call from executeSubtask
    research-queue.ts         # EDIT — +getResearchDepth import, +get depth() getter (minimal, additive)
  config/
    constants.ts              # READ-ONLY (S1) — isParallelResearch, getResearchDepth live here
tests/
  unit/
    core/
      task-orchestrator.test.ts   # EDIT — +depth-chain supervisor describe block
      research-queue.test.ts      # EDIT — +depth getter test
    utils/
      promise-handling-validator.test.ts  # READ-ONLY — validates research-queue.ts catch blocks
  integration/
    core/
      research-queue.test.ts  # READ-ONLY — must stay GREEN (signatures unchanged)
vitest.config.ts              # READ-ONLY — 100% coverage thresholds
package.json                  # READ-ONLY — npm run validate gate
PRD.md                        # READ-ONLY — §4.2 (h3.4), §9.2.2 (h4.1)
```

### Desired Codebase tree with files to be added and responsibility of file
```bash
src/core/task-orchestrator.ts      # MODIFIED — depth-chain supervisor: gates executeTask bulk-enqueue, drives chain from executeSubtask
src/core/research-queue.ts         # MODIFIED — additive `get depth()` getter (no signature/logic change)
tests/unit/core/task-orchestrator.test.ts  # MODIFIED — supervisor unit tests (parallel on/off, dedup, chain advance, depth cap)
tests/unit/core/research-queue.test.ts     # MODIFIED — depth getter assertion
# (no NEW files)
```

### Known Gotchas of our codebase & Library Quirks
```ts
// CRITICAL (depth vs maxSize are ORTHOGONAL): RESEARCH_DEPTH = how many items to
// prefetch AHEAD in the chain (governed by the orchestrator's #prefetchResearchAhead).
// maxSize (RESEARCH_QUEUE_CONCURRENCY, default 3) = how many generate() calls run
// AT ONCE inside the pool. Do NOT collapse them. If depth=5 and maxSize=3, the
// orchestrator enqueues 5 ahead but only 3 generate() at a time — that's correct.

// CRITICAL (depth logic lives in the ORCHESTRATOR, not the pool): ResearchQueue is a
// generic dedup'd bounded pool. The "chain ahead" concept requires knowing the
// upcoming execution order, which only #executionQueue (in the orchestrator) has.
// Putting depth logic inside ResearchQueue would require passing the backlog/queue
// in — far more invasive and breaks the 70 unit + integration tests. The minimal,
// low-risk design: orchestrator decides WHAT/WHEN to enqueue (gated on
// isParallelResearch + bounded by getResearchDepth); pool stays unchanged.

// CRITICAL (#executionQueue is already-shifted at executeSubtask time): processNextItem()
// shift()s the current item BEFORE dispatching to executeSubtask. So at the start of
// executeSubtask, this.#executionQueue holds exactly the UPCOMING items. Pass it
// directly to #prefetchResearchAhead — no index math needed. (Confirm by reading
// processNextItem ≈line 1121-1135.)

// CRITICAL (enqueue is async; fire-and-forget needs a .catch): the supervisor calls
// this.researchQueue.enqueue(...).catch(...) because enqueue returns Promise<void>
// and a rejection (e.g. backlog shape error) would otherwise be an unhandled promise
// rejection — which verifyPromiseHandling() flags AND which can crash the process.
// The .catch logs a warn (non-critical); waitForPRP surfaces real research errors at
// consume time.

// CRITICAL (HierarchyItem type filter): #executionQueue is HierarchyItem[]
// (Phase|Milestone|Task|Subtask). enqueue() accepts Task|Subtask (TaskOrSubtask).
// For the {type:'all'} scope it's all Subtasks, but for scoped runs it can contain
// Tasks/Milestones. The supervisor MUST `if (item.type !== 'Subtask') continue;`
// before enqueue — enqueuing a Task would feed a non-leaf to PRPGenerator.

// CRITICAL (backward-compat false branch is VERBATIM legacy): the !isParallelResearch()
// executeTask branch must replicate today's bulk-enqueue EXACTLY (same loop, same log).
// The {type:'all'} leaf path's synchronous researchNow fallback (line ≈773) must be
// UNTOUCHED — it's the safety net for items never pre-enqueued.

// GOTCHA (100% branch coverage): every new branch needs a test:
//   - isParallelResearch() true  → enqueue called getResearchDepth() times.
//   - isParallelResearch() false → #prefetchResearchAhead is a no-op (0 enqueues).
//   - executeTask gated branch: parallel ON → enqueue once (first subtask only).
//   - executeTask gated branch: parallel OFF → enqueue subtasks.length times (legacy).
//   - item.type !== 'Subtask' skip → put a Task in the slice, assert it's skipped.
//   - enqueued >= depth early-break → depth=2, slice has 5 subtasks, assert only 2 enqueued.
//   - researchQueue.depth getter → default 2; stubbed 5.

// GOTCHA (test env mutation): use vi.stubEnv('PARALLEL_RESEARCH','true') /
// vi.stubEnv('RESEARCH_DEPTH','2') and afterEach(() => vi.unstubAllEnvs()). Manual
// process.env mutation leaks across tests and breaks the 100%-coverage determinism.

// GOTCHA (do NOT change constructor signature): `new ResearchQueue(sm, maxSize, noCache,
// cacheTtlMs)` is called by the orchestrator (≈175) and by every test. Adding a depth
// param breaks all of them. Read depth live via getResearchDepth() in the getter.
```

---

## Implementation Blueprint

### Data models and structure
No new data models. The only type-level touch is the `get depth(): number`
getter on `ResearchQueue` and the new private method
`#prefetchResearchAhead(upcoming: HierarchyItem[]): void` on `TaskOrchestrator`.
Both use existing types (`HierarchyItem`, `Subtask`, `Backlog`). The
`HierarchyItem` union is already imported by task-orchestrator.ts (it types
`#executionQueue`).

### Implementation Tasks (ordered by dependencies)
```yaml
Task 1: MODIFY src/core/research-queue.ts — additive `get depth()` getter
  - EXTEND the existing constants import (≈line 31) to add getResearchDepth:
      import { getResearchTimeoutSeconds, getResearchDepth } from '../config/constants.js';
  - ADD a public read-only getter (place near getStats(), ≈line 395):
      /**
       * The configured depth-chain prefetch depth (PRD §4.2). Orthogonal to
       * maxSize (which caps concurrent generate() calls). Read live from env.
       */
      get depth(): number {
        return getResearchDepth();
      }
  - PRESERVE: constructor signature, enqueue, processNext, waitForPRP,
    researchNow, deletePRP, isResearching, isAbandoned, getPRP, getStats,
    clearCache, the public `queue`/`researching`/`results`/`abandoned` fields.
  - FOLLOW pattern: existing read-only accessors (getStats, getPRP).
  - GOTCHA: read depth LIVE from getResearchDepth() (env-respecting), NOT from a
    constructor param (breaks all callers/tests).

Task 2: MODIFY src/core/task-orchestrator.ts — import + gate + supervisor + call
  - ADD to the constants import (find the existing `getResearchTimeoutSeconds`
    / `getIssueRetryMax` import line near the top): isParallelResearch, getResearchDepth.
  - GATE executeTask bulk-enqueue (≈lines 638-655): wrap the existing
    `for (const subtask of task.subtasks) { await enqueue(...) }` in
    `if (isParallelResearch()) { enqueue only task.subtasks[0] if any } else { ...legacy loop... }`.
    Preserve the exact legacy loop body (including the debug log) in the else branch.
  - ADD the private method #prefetchResearchAhead(upcoming: HierarchyItem[]): void
    (place after #buildQueue ≈line 228, or near #recoverAfterAgentRun). Body:
      if (!isParallelResearch()) return;
      const depth = getResearchDepth();
      let enqueued = 0;
      for (const item of upcoming) {
        if (enqueued >= depth) break;
        if (item.type !== 'Subtask') continue;
        this.researchQueue.enqueue(item as Subtask, this.#backlog).catch(error => {
          const msg = error instanceof Error ? error.message : String(error);
          this.#logger.warn({ subtaskId: item.id, error: msg },
            'Depth-chain prefetch enqueue failed (non-critical)');
        });
        enqueued++;
      }
  - CALL the supervisor from executeSubtask: immediately AFTER the cache hit/miss
    logging block (≈line 720, before the `try { await waitForPRP }` block), add:
      this.#prefetchResearchAhead(this.#executionQueue);
    (#executionQueue is already-shifted; it holds the upcoming items.)
  - PRESERVE: the waitForPRP/researchNow fallback try/catch (≈768-790), the issue
    loop, executePhase, executeMilestone, processNextItem, #buildQueue, the
    constructor, all public accessors.
  - FOLLOW pattern: existing enqueue call (line 644); existing warn-log pattern
    in #recoverAfterAgentRun for non-catal errors.
  - GOTCHA: enqueue is async — the .catch is MANDATORY (verifyPromiseHandling +
    no unhandled rejection). Do NOT await the loop (fire-and-forget is correct —
    waitForPRP awaits at consume time).

Task 3: MODIFY tests/unit/core/research-queue.test.ts — depth getter
  - ADD an it() under a new or existing describe:
      it('depth getter returns getResearchDepth() (default 2)', () => {
        const q = new ResearchQueue(createMockSessionManager(...), 3, false, ttl);
        expect(q.depth).toBe(2);
      });
      it('depth getter respects RESEARCH_DEPTH env', () => {
        vi.stubEnv('RESEARCH_DEPTH', '5');
        const q = new ResearchQueue(createMockSessionManager(...), 3, false, ttl);
        expect(q.depth).toBe(5);
        vi.unstubAllEnvs();
      });
    (reuse the existing createMockSessionManager / createTestSubtask factories;
     ensure afterEach(() => vi.unstubAllEnvs()) in the describe.)
  - FOLLOW pattern: existing simple-assertion tests in the file.
  - GOTCHA: stub+unstub env to avoid leaking; the getter reads env live.

Task 4: MODIFY tests/unit/core/task-orchestrator.test.ts — supervisor coverage
  - ADD describe('TaskOrchestrator: depth-chained research supervisor', …).
    Use vi.spyOn(orchestrator.researchQueue, 'enqueue') to assert call counts/args.
    Cover:
      a. isParallelResearch()=true, RESEARCH_DEPTH=2, upcoming=[S2,S3,S4,S5] (S1 is
         current): expect enqueue called exactly 2 times with S2, S3.
      b. isParallelResearch()=false: #prefetchResearchAhead is a no-op — enqueue
         spy NOT called from the supervisor (legacy executeTask path still
         bulk-enqueues — test that separately).
      c. upcoming contains a Task item (non-Subtask): assert it is SKIPPED (enqueue
         not called for it) and depth-count applies only to Subtasks.
      d. enqueued >= depth early-break: depth=2, upcoming=5 subtasks → exactly 2
         enqueue calls.
      e. chain advance: simulate 3 sequential executeSubtask calls; after each,
         assert the researching set grows by one (dedup prevents re-enqueue of
         already-researched items).
      f. executeTask gated branch: parallel ON → enqueue called once (subtasks[0]);
         parallel OFF → enqueue called subtasks.length times (legacy).
  - Each test: vi.stubEnv('PARALLEL_RESEARCH', 'true'/'false') +
    vi.stubEnv('RESEARCH_DEPTH', N); afterEach vi.unstubAllEnvs.
  - FOLLOW pattern: existing task-orchestrator unit tests (mock researchQueue,
    assert enqueue calls). Mirror how they construct the orchestrator + scope.
  - GOTCHA: must drive EVERY new branch for 100% coverage (parallel on/off, type
    skip, depth break, gated executeTask on/off). The supervisor is private —
    test it via its OBSERVABLE effect (enqueue spy) by calling executeSubtask (or
    a thin public wrapper if one exists). If the method is truly unreachable
    from public API, add a minimal public test-only accessor OR test through
    executeSubtask (preferred — exercises the real call site).

Task 5: VERIFY — no regressions
  - RUN npm run typecheck → exit 0.
  - RUN npx vitest run tests/unit/core/research-queue.test.ts → ALL green (incl. new depth test).
  - RUN npx vitest run tests/unit/core/task-orchestrator.test.ts → ALL green (incl. new supervisor tests).
  - RUN npx vitest run tests/integration/core/research-queue.test.ts → GREEN unchanged.
  - RUN npx vitest run tests/unit/utils/promise-handling-validator.test.ts → GREEN
    (confirms research-queue.ts still has all rejection handlers; the getter adds
    no promises so this is a no-op check, but RUN it to be sure).
  - RUN npx vitest run --coverage → 100/100/100/100 on src/**/*.ts.
  - RUN npm run validate → GREEN.
  - RUN npm run build → succeeds.
  - VERIFY only the 4 intended files changed: git diff --name-only →
    task-orchestrator.ts, research-queue.ts, task-orchestrator.test.ts,
    research-queue.test.ts.
```

### Implementation Patterns & Key Details
```ts
// PATTERN: gated executeTask bulk-enqueue (task-orchestrator.ts ≈638-655):
if (isParallelResearch()) {
  // Depth-chain model (PRD §4.2): enqueue only the first subtask now;
  // #prefetchResearchAhead drives the chain as items are consumed.
  if (task.subtasks.length > 0) {
    await this.researchQueue.enqueue(task.subtasks[0], this.#backlog);
  }
} else {
  // Legacy flat-pool model (unchanged).
  for (const subtask of task.subtasks) {
    await this.researchQueue.enqueue(subtask, this.#backlog);
    this.#logger.debug({ taskId: task.id, subtaskId: subtask.id },
      'Enqueued for parallel research');
  }
}

// PATTERN: depth-chain supervisor (task-orchestrator.ts, new private method):
#prefetchResearchAhead(upcoming: HierarchyItem[]): void {
  if (!isParallelResearch()) return;                       // ← false branch (cover)
  const depth = getResearchDepth();
  let enqueued = 0;
  for (const item of upcoming) {
    if (enqueued >= depth) break;                          // ← depth-break branch (cover)
    if (item.type !== 'Subtask') continue;                 // ← type-skip branch (cover)
    this.researchQueue.enqueue(item as Subtask, this.#backlog).catch(error => {  // ← .catch MANDATORY
      const msg = error instanceof Error ? error.message : String(error);
      this.#logger.warn({ subtaskId: item.id, error: msg },
        'Depth-chain prefetch enqueue failed (non-critical)');
    });
    enqueued++;
  }
}

// PATTERN: drive the chain from executeSubtask (≈line 720, before waitForPRP):
this.#prefetchResearchAhead(this.#executionQueue);  // already-shifted: holds upcoming

// PATTERN: minimal additive getter (research-queue.ts):
get depth(): number {
  return getResearchDepth();  // live env read — no constructor change
}

// CRITICAL: enqueue is async and fire-and-forget here. The .catch is REQUIRED
//   (verifyPromiseHandling flags unhandled rejections; an unhandled rejection can
//   crash Node). waitForPRP awaits + surfaces real research errors at consume time.
// CRITICAL: do NOT change the ResearchQueue constructor signature. Read depth live.
// CRITICAL: depth (how far ahead) and maxSize (how many at once) are ORTHOGONAL.
```

### Integration Points
```yaml
ORCHESTRATOR (src/core/task-orchestrator.ts):
  - add import: isParallelResearch, getResearchDepth (from ../config/constants.js).
  - gate: executeTask bulk-enqueue on isParallelResearch() (≈638-655).
  - add method: #prefetchResearchAhead(upcoming: HierarchyItem[]): void.
  - add call: this.#prefetchResearchAhead(this.#executionQueue) in executeSubtask (≈720).

RESEARCH QUEUE (src/core/research-queue.ts):
  - add import: getResearchDepth (extend existing constants import).
  - add getter: get depth(): number (live env read).

NO CONFIG CHANGE (src/config/constants.ts): isParallelResearch/getResearchDepth
  already exist (S1). S2 CONSUMES them only.
NO DOCS CHANGE: contract item 5 DOCS = none (internal prefetch model).
NO DATABASE / NO ROUTES / NO MODELS / NO PRD.md / NO tasks.json / NO vitest.config.ts.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
npm run typecheck        # tsc --noEmit → exit 0 (new import/method/getter compile)
npm run lint             # eslint . --ext .ts → no new violations
npm run format:check     # prettier --check; run `npm run format` if it complains
# Expected: Zero errors. Edits are additive + mirror existing patterns.
```

### Level 2: Unit Tests (Component Validation)
```bash
npx vitest run tests/unit/core/research-queue.test.ts       # incl. new depth getter test
npx vitest run tests/unit/core/task-orchestrator.test.ts    # incl. new supervisor tests
npx vitest run tests/unit/utils/promise-handling-validator.test.ts  # research-queue.ts still allHandled
npx vitest run --coverage                                   # 100/100/100/100 on src/**/*.ts
npm run test:run                                            # full suite green
# Expected: ALL green. New branches (parallel on/off, type skip, depth break,
# gated executeTask) are exercised (else coverage fails).
```

### Level 3: Integration Testing (System Validation)
```bash
npm run validate      # lint + format:check + typecheck + test:run → GREEN
npm run build         # tsc -p tsconfig.build.json → succeeds

# Integration tests unchanged (signatures stable):
npx vitest run tests/integration/core/research-queue.test.ts   # GREEN
npx vitest run tests/integration/core/task-orchestrator-runtime.test.ts  # GREEN

# Behavioral smoke (depth-chain observable via mocked enqueue spy in a unit test —
# see Task 4). No live-process smoke needed (this is internal prefetch logic).
```

### Level 4: Creative & Domain-Specific Validation
```bash
# Confirm the supervisor consumes the S1 helpers (not redefining them):
rg -n "isParallelResearch|getResearchDepth" src/core/task-orchestrator.ts   # EXPECT: import + 2 usages
rg -n "getResearchDepth" src/core/research-queue.ts                          # EXPECT: import + getter

# Confirm NO config constant was redefined by S2:
rg -n "export const RESEARCH_DEPTH|export function getResearchDepth|export function isParallelResearch" src/config/constants.ts
# EXPECT: all defined ONCE (S1's territory; S2 only imports).

# Confirm the ResearchQueue constructor signature is UNCHANGED:
rg -n "constructor\(" src/core/research-queue.ts   # EXPECT: still (sessionManager, maxSize=3, noCache=false, cacheTtlMs=24h)

# Confirm promise handling is intact (no new unhandled rejection in research-queue.ts):
npx vitest run tests/unit/utils/promise-handling-validator.test.ts
# EXPECT: GREEN (the getter adds no promises; the supervisor's .catch is in task-orchestrator.ts)

# Confirm only the 4 intended files changed:
git diff --name-only
# EXPECT: src/core/task-orchestrator.ts, src/core/research-queue.ts,
#         tests/unit/core/task-orchestrator.test.ts, tests/unit/core/research-queue.test.ts
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` exit 0.
- [ ] `npm run validate` GREEN (lint + format:check + typecheck + test:run).
- [ ] `npm run build` succeeds.
- [ ] 100% coverage on `src/**/*.ts` preserved (all new branches covered).

### Feature Validation
- [ ] With `PARALLEL_RESEARCH=true`, `executeSubtask` on item N prefetches
      `RESEARCH_DEPTH` upcoming subtasks (verified by enqueue spy asserting
      exactly `depth` calls with the next subtasks).
- [ ] Chain advances as items are consumed (3 sequential executeSubtask calls →
      researching set grows by one each, dedup preventing re-enqueue).
- [ ] With `PARALLEL_RESEARCH` unset/false, `executeTask` bulk-enqueues all
      subtasks (legacy) and `#prefetchResearchAhead` is a no-op.
- [ ] `researchQueue.depth === getResearchDepth()` (default 2; env-respecting).
- [ ] Non-Subtask items in `#executionQueue` are skipped by the supervisor.
- [ ] The supervisor's `enqueue(...)` has a `.catch` (no unhandled rejection).

### Code Quality Validation
- [ ] Depth logic lives in the orchestrator (owns `#executionQueue`); pool unchanged.
- [ ] `depth` and `maxSize` kept orthogonal (not collapsed).
- [ ] ResearchQueue constructor signature UNCHANGED (depth read live from env).
- [ ] All existing ResearchQueue unit + integration tests pass UNCHANGED.
- [ ] `executeTask` legacy branch is verbatim (same loop + log).
- [ ] `{type:'all'}` leaf synchronous-`researchNow` fallback UNTOUCHED.

### Documentation & Deployment
- [ ] No docs/.env changes (contract item 5 DOCS = none).
- [ ] No new env vars introduced (S2 consumes S1's `PARALLEL_RESEARCH`/`RESEARCH_DEPTH`).
- [ ] Code is self-documenting (JSDoc on `#prefetchResearchAhead` and `get depth`).

---

## Anti-Patterns to Avoid
- ❌ Don't put depth-chain logic INSIDE `ResearchQueue` (it would need the
  backlog/execution-order, breaking the 70 unit + integration tests). The pool
  is a generic dedup'd bounded pool; the chain semantics belong in the
  orchestrator, which owns `#executionQueue`.
- ❌ Don't collapse `depth` and `maxSize` — they're orthogonal (how far ahead vs
  how many at once). `depth=5, maxSize=3` is valid and correct.
- ❌ Don't change the `ResearchQueue` constructor signature — it breaks the
  orchestrator call AND every test. Read `depth` live via `getResearchDepth()`.
- ❌ Don't fire-and-forget `enqueue()` without a `.catch` —
  `verifyPromiseHandling()` flags it and an unhandled rejection can crash Node.
- ❌ Don't forget to filter `item.type !== 'Subtask'` — enqueuing a Task feeds a
  non-leaf to `PRPGenerator`.
- ❌ Don't change `executeTask`'s legacy (`false`) branch — it must be verbatim
  (same loop + debug log) for backward compatibility.
- ❌ Don't touch `waitForPRP`/`researchNow`/`deletePRP`/`ResearchTimeoutError`
  signatures — the orchestrator's §4.2/§4.5 fallback paths depend on them.
- ❌ Don't redefine `isParallelResearch`/`getResearchDepth` — they're S1's
  contract; S2 only imports them.
- ❌ Don't forward `PARALLEL_RESEARCH`/`RESEARCH_DEPTH` to the bugfix child —
  that's S4. S2 consumes the helpers in the MAIN orchestrator only.
- ❌ Don't mutate `process.env` in tests without restoration — use
  `vi.stubEnv`/`vi.unstubAllEnvs` (the 100%-coverage gate needs determinism).
- ❌ Don't touch PRD.md, tasks.json, prd_snapshot.md, or vitest.config.ts.

---

## Confidence Score

**8/10** — One-pass success likelihood is high. The design is deliberately
minimal-risk: the depth-chain logic lives in the orchestrator (which owns
`#executionQueue`, the chain source of truth) rather than mutating the
ResearchQueue pool internals — this keeps all 70 unit tests + integration tests
GREEN unchanged and avoids a large-blast-radius refactor. Every edit site is
pinned (executeTask ≈638-655, executeSubtask ≈720, the additive getter near
getStats), every pattern mirrored from a named exemplar (existing `enqueue`
call, existing warn-log pattern), and every new branch has a designated test
(parallel on/off, type skip, depth break, gated executeTask on/off, depth
getter). The S1 config contract is stable and consumed by import only. The
`RESEARCH_TIMEOUT` 300→1800 change is transparent (S1 already did it; `waitForPRP`
calls the helper).

The two notable risks, both mitigated: (1) **the supervisor is a private
method** — test it via its observable effect (enqueue spy) through the public
`executeSubtask` call site (preferred) or a test-only accessor if truly
unreachable; the PRP specifies the preferred path. (2) **the
`#executionQueue`-already-shifted invariant** — the PRP documents that
`processNextItem()` shift()s before dispatching, so at `executeSubtask` entry the
queue holds exactly the upcoming items (Task 2 GOTCHA + research §2 confirm
this); the implementer should re-read `processNextItem` (≈line 1121) to confirm
before wiring the call. Zero file overlap with S1 (config-only), S3 (docs-only),
or S4 (bugfix-forwarding) — S2 edits `task-orchestrator.ts` + `research-queue.ts`
+ their unit tests, all disjoint from siblings' files.