# P3.M1.T1.S2 — Codebase Analysis (ResearchQueue depth-chained supervisor)

## 1. Current ResearchQueue is a FLAT POOL, not a depth-chain

File: `src/core/research-queue.ts`

- Constructor: `new ResearchQueue(sessionManager, maxSize = 3, noCache, cacheTtlMs)`.
  `maxSize` is **flat concurrency** (how many `#prpGenerator.generate()` run at
  once). It is NOT "how far ahead to prefetch."
- `enqueue(task, backlog)`: dedups (skip if `researching.has(id)` or
  `results.has(id)`), pushes onto `this.queue: TaskOrSubtask[]`, calls
  `processNext(backlog)`.
- `processNext(backlog)`: if `queue.length === 0 || researching.size >= maxSize`
  → return; else `queue.shift()`, race-guard, call `#prpGenerator.generate()`
  storing the promise in `this.researching: Map<string, Promise<PRPDocument>>`.
  `.then` caches in `results` (skipping `abandoned`); `.catch` re-throws (logs
  warn); `.finally` deletes from `researching` and recurses `processNext`.
- `waitForPRP(taskId)`: cache → race in-flight vs `getResearchTimeoutSeconds()`
  deadline → on timeout `abandoned.add(id)` + throw `ResearchTimeoutError`.
- `researchNow(task, backlog, issueFeedback?)`: synchronous inline fallback
  (used for §4.2 deadline-abandonment AND §4.5 issue re-plan).
- `deletePRP(taskId)`: in-memory + disk `.md` + `.cache/*.json` removal (§4.5).

**Public surface used by tests (must stay stable):**
`queue` (array, pushed/shifted), `researching` (Map), `results` (Map),
`abandoned` (Set), `enqueue`, `processNext`, `waitForPRP`, `researchNow`,
`deletePRP`, `getPRP`, `isResearching`, `isAbandoned`, `getStats`, `clearCache`.
**All integration + unit tests reach into `queue.results.set(...)` and
`queue.queue.push(...)`** (public readonly fields) — DO NOT make these private.

## 2. The orchestrator owns the LINEAR chain (`#executionQueue`)

File: `src/core/task-orchestrator.ts`

- `#executionQueue: HierarchyItem[]` — built once by `#buildQueue(scope)` via
  `resolveScope(backlog, scope)` (leaf-subtask list for `{type:'all'}`).
- `processNextItem()` (≈line 1121): `if empty return false; nextItem = shift()!;
  switch (nextItem.type) { Phase→executePhase; Milestone→executeMilestone;
  Task→executeTask; Subtask→executeSubtask }`. This is the **consume loop** —
  the PRD §4.2 "as the orchestrator consumes each completed PRP, the supervisor
  prefetches the next item in the chain" trigger point.
- `executeTask(task)` (≈line 630): **bulk-enqueues all `task.subtasks`** via
  `researchQueue.enqueue(subtask, backlog)`. This is the CURRENT flat-pool
  driver. NOTE: with `{type:'all'}` scope, `resolveScope` returns **leaf
  subtasks only**, so `executeTask` is NEVER called → subtasks are NOT
  pre-enqueued → `executeSubtask` hits the `notEnqueued` fallback
  (line ≈773 `/No PRP available|not been enqueued/i`) and calls `researchNow`
  synchronously. **This is the "no prefetch today" reality for the default
  scope** — the supervisor's job is to FIX this.
- `executeSubtask(subtask)` (≈line 670): sets `Researching` status; checks
  `getPRP` cache hit/miss counters; then in the try-block: `await
  researchQueue.waitForPRP(subtask.id)` with try/catch → on
  `ResearchTimeoutError` OR `notEnqueued` → `researchQueue.researchNow(...)`.

## 3. The depth-chain seam (what S2 must add)

PRD §4.2: "a background supervisor researches a **chain** of up to
`RESEARCH_DEPTH` (default 2) items ahead … As the orchestrator consumes each
completed PRP, the supervisor prefetches the next item in the chain."

The chain = the upcoming items in `#executionQueue` relative to the item being
implemented. **Cleanest, least-invasive design:**

- Add an orchestrator method **`prefetchAhead(currentIndex: number)`** (or
  pass the upcoming subtask slice) that, when `isParallelResearch()` is true,
  enqueues the next `getResearchDepth()` subtasks from `#executionQueue`
  (skipping already-researched/researching ones — `enqueue`'s dedup handles
  this). Called from `executeSubtask` at the point where it begins processing
  (or from `processNextItem` after shifting a Subtask).
- **Backward compat:** when `isParallelResearch()` is false, the orchestrator
  behavior is UNCHANGED (executeTask still bulk-enqueues for scoped-Task runs;
  the `{type:'all'}` leaf path still falls back to synchronous `researchNow`).
- The ResearchQueue itself does NOT need to become a true supervisor process —
  its existing flat `maxSize`-bounded `processNext` IS the concurrency cap, and
  `enqueue` dedup IS the chain-management. **The "chain" semantics live in the
  CALLER (orchestrator) deciding WHAT and WHEN to enqueue**, gated on
  `isParallelResearch()` + `getResearchDepth()`. This is the minimal, low-risk
  read of the contract: "Change the prefetch MODEL from flat maxSize pool to
  depth-chained supervisor" = change the **enqueue strategy** in the
  orchestrator from "bulk all subtasks of a Task" to "enqueue next
  `RESEARCH_DEPTH` ahead of the current subtask."

  → This keeps `ResearchQueue` a thin pool and puts depth logic in the
    orchestrator (which owns `#executionQueue`). Low blast radius. Existing
    ResearchQueue unit + integration tests stay GREEN unchanged.

## 4. Config inputs from S1 (the contract)

From `plan/008_15504f60a0ef/P3M1T1S1/PRP.md` (treat as contract):

- `isParallelResearch(): boolean` — `true` iff `process.env.PARALLEL_RESEARCH === 'true'`.
- `getResearchDepth(): number` — positive int, default `2`.
- `DEFAULT_RESEARCH_TIMEOUT_SECONDS === 1800` (already flows through
  `getResearchTimeoutSeconds()` which `waitForPRP` calls — NO change needed in
  ResearchQueue for the timeout; it already races on the helper).
- Import path: `src/config/constants.js`.

S2 CONSUMES these; it must NOT redefine them. The `getResearchTimeoutSeconds()`
default change (300→1800) is transparent to ResearchQueue code (it calls the
helper, not the literal).

## 5. Test surface to preserve / extend

- `tests/unit/core/research-queue.test.ts` — 70 `describe`/`it`, 100% coverage
  on research-queue.ts. Reaches into `queue.results`, `queue.queue`,
  `queue.researching` (public readonly). **Must stay GREEN.**
- `tests/integration/core/research-queue.test.ts` — concurrency, dedup,
  fire-and-forget errors, stats. **Must stay GREEN.**
- `tests/unit/core/task-orchestrator.test.ts` — orchestrator unit tests; S2's
  new orchestrator method must be covered here.
- `tests/unit/utils/promise-handling-validator.test.ts` —
  `verifyPromiseHandling()` DEFAULTS to `src/core/research-queue.ts`. **S2's
  edits to research-queue.ts MUST keep every promise rejection handled** (the
  validator scans catch blocks). If S2 adds a new fire-and-forget `.then`,
  it MUST have a `.catch`.
- `vitest.config.ts` — 100/100/100/100 on `src/**/*.ts`. Every new branch in
  research-queue.ts AND task-orchestrator.ts must be exercised.

## 6. Validation commands (verified)

- `npm run validate` = lint + format:check + typecheck + test:run (GREEN gate).
- `npx vitest run tests/unit/core/research-queue.test.ts` — unit, fast.
- `npx vitest run tests/integration/core/research-queue.test.ts` — integration.
- `npx vitest run --coverage` — 100/100/100/100.
- `npx tsx scripts/validate-promise-handling.ts` (if it exists) OR the vitest
  test that calls `verifyPromiseHandling()` — confirms no unhandled rejections.

## 7. Scope fences

- **S1 (config constants)** — DONE as contract; S2 only READS
  `isParallelResearch`/`getResearchDepth`. Do not redefine.
- **S3 (RESEARCH_TIMEOUT docs)** — separate; S2 does NOT touch docs/.env.
- **S4 (bugfix forwarding)** — forwards the env vars to the bugfix child;
  S2 must NOT do the forwarding (only consume the helpers in the orchestrator).
- **tasks.json / PRD.md / prd_snapshot.md / vitest.config.ts** — READ-ONLY.
- **ResearchTimeoutError / researchNow / deletePRP / waitForPRP** — DO NOT
  change their signatures (orchestrator + tests depend on them).

## 8. Risk: the `executeTask` bulk-enqueue interaction

If `isParallelResearch()` is true AND a run uses a scoped-Task (not leaf-all),
`executeTask` currently bulk-enqueues all subtasks. Under the depth-chain
model that is acceptable (enqueue dedups; the supervisor effectively caps via
`getResearchDepth()` from the `prefetchAhead` calls as subtasks are consumed).
But to be SAFE and match PRD §4.2 exactly ("chain of up to RESEARCH_DEPTH
ahead"), S2 should gate `executeTask`'s bulk-enqueue on
`!isParallelResearch()` — when parallel research is ON, `executeTask` enqueues
only the first subtask (or none) and lets `prefetchAhead` drive the chain.
This is the cleanest way to honor "depth-chained supervisor … prefetching the
next as the orchestrator consumes." Document the choice; keep the legacy
bulk-enqueue as the `false` branch.