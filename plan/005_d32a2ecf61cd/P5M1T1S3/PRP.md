# PRP — P5.M1.T1.S3: Orchestrator synchronous re-research fallback after deadline

## Goal

**Feature Goal**: Wire PRD §4.2's "Deadline & Fallback" into the orchestrator. `TaskOrchestrator.executeSubtask` becomes the **first caller** of S2's deadline-guarded `ResearchQueue.waitForPRP(taskId)`: it awaits the in-flight background PRP generation, and when S2 reports **abandonment** (`ResearchTimeoutError`, deadline exceeded), the orchestrator **re-researches the item synchronously, inline** — calling a NEW `ResearchQueue.researchNow(task, backlog)` and awaiting it directly (blocking the loop) instead of relying on the abandoned background work. The inline result is cached so S2's dedup/ignore contract holds (a late background result must NOT clobber it). `executeSubtask` therefore no longer blocks indefinitely on hung background research and always proceeds to the normal execution path. The abandonment + inline re-research are logged at info level.

**Deliverable**:
1. A NEW public `researchNow(task: TaskOrSubtask, backlog: Backlog): Promise<PRPDocument>` method on `ResearchQueue` (`src/core/research-queue.ts`) — synchronous inline `#prpGenerator.generate()` + explicit `results.set()` cache write (the synchronous-generate path the item authorizes).
2. A modified `executeSubtask` in `TaskOrchestrator` (`src/core/task-orchestrator.ts`): the FIRST statement inside the existing `try { … }` block (right after `setStatus('Implementing')`, before `#retryManager.executeWithRetry`) calls `this.researchQueue.waitForPRP(subtask.id)`; on `ResearchTimeoutError` it logs info + calls `await this.researchQueue.researchNow(subtask, this.#backlog)`; any other error is re-thrown to the existing catch → `Failed`.
3. An updated import in `task-orchestrator.ts`: `import { ResearchQueue, ResearchTimeoutError } from './research-queue.js';`.
4. TDD tests (write FAILING first): (PRIMARY) extend `tests/unit/core/task-orchestrator.test.ts` — switch the `research-queue.js` module mock to `async importOriginal` + spread `...actual` (so the REAL `ResearchTimeoutError` survives mocking), add `waitForPRP`/`researchNow` defaults to the mock instance, add two `executeSubtask` cases (abandonment→inline→proceeds; non-timeout error propagates→Failed); (SECONDARY) extend `tests/unit/core/research-queue.test.ts` with a `researchNow` describe (generates inline + caches; dedup guard; leaves `researching` intact).
5. Mode A docs: inline JSDoc on `researchNow` + a comment block at the fallback site referencing PRD §4.2. No standalone doc subtask (the CONFIGURATION.md row was S1; implementation_notes.md §9).

**Success Definition**: `npm run validate` (eslint + prettier --check + tsc --noEmit) and `npm run test:run` (vitest run) are both green; when `waitForPRP` rejects with `ResearchTimeoutError`, `executeSubtask` calls `researchNow` **exactly once** and then proceeds to `prpRuntime.executeSubtask` (status → Complete); when `waitForPRP` rejects with a plain `Error`, `executeSubtask` does **not** call `researchNow`, marks the item `Failed`, and re-throws; all pre-existing `executeSubtask` tests stay green (status count unchanged at 3 because the fallback adds no status transition); `git diff --stat` touches only `src/core/research-queue.ts`, `src/core/task-orchestrator.ts`, `tests/unit/core/task-orchestrator.test.ts`, `tests/unit/core/research-queue.test.ts`.

## Why

- **Business value**: PRD §4.2 runs background PRP generation for task N+1 while task N implements. S2 (in-flight) deadline-bounds `waitForPRP` so the *queue* gives up waiting after `RESEARCH_TIMEOUT` (default 300s). But the *orchestrator* never calls `waitForPRP` today (`grep -rn waitForPRP src/` → zero non-definition callers), so S2's deadline is currently inert at the orchestration layer. S3 closes the loop: it makes the orchestrator the first consumer of S2's abandonment signal and implements the synchronous inline fallback, so a single hung/crashed research agent can no longer stall the pipeline (implementation_notes.md §4, delta_impact.md §R1).
- **Scope boundary**: S3 ships **only the orchestrator's research-wait + inline fallback** and the single new `researchNow` queue method it needs. It does **NOT** touch S2's deliverables (`waitForPRP` deadline, `abandoned` Set, `isAbandoned`, `ResearchTimeoutError`, the `processNext` `.then` guard), S1's config (`getResearchTimeoutSeconds`), PRPRuntime's signature/behavior, the retry manager, or the issue-driven re-planning loop (that's T2.S2–S4).
- **Scope cohesion**: S1 (config) ✓ done. S2 (queue deadline + abandonment) ✓ implements the API. S3 (this) consumes S2's outputs (`waitForPRP` throws `ResearchTimeoutError`; `isAbandoned`; `results` cache) and adds exactly one new seam (`researchNow`) for the synchronous path. Keeping S3 to the orchestrator + the one queue method prevents collision with the in-parallel S2 work (S2 edits `research-queue.ts`'s `waitForPRP`/`processNext`; S3 adds a new method and edits the orchestrator — no overlapping lines).

## What

### User-visible behavior
None directly — internal core-layer resilience. The observable effect is that a subtask whose background research hangs past `RESEARCH_TIMEOUT` is now re-researched synchronously inline and still completes, instead of blocking the pipeline forever once S2's deadline fires.

### Technical requirements (the CONTRACT)

1. **S3 introduces the FIRST caller of `waitForPRP`.** Today `executeSubtask` only calls `getPRP` (cache metrics, result discarded — see `research/orchestrator-flow-analysis.md` §1). S3 adds the `waitForPRP` call. (The item's RESEARCH NOTE #1 describes the *intended* post-S3 state.)
2. **Insertion point — the FIRST statement inside the existing `try { … }` of `executeSubtask`**, immediately after `setStatus('Implementing')` and BEFORE `this.#retryManager.executeWithRetry(...)`. Rationale: (a) covered by the existing catch so a real (non-timeout) error → `Failed`; (b) after the dependency gate so blocked subtasks don't trigger a wasted wait; (c) OUTSIDE `executeWithRetry` because the deadline/abandonment fallback is a different concern from `TaskRetryManager`'s transient-infra retry dimension (implementation_notes.md §3). See `research/orchestrator-flow-analysis.md` §2.
3. **The fallback catches ONLY `ResearchTimeoutError`.** Use `if (error instanceof ResearchTimeoutError)`. On match: log info (`'Background research abandoned (deadline exceeded); re-researching synchronously inline'`), `await this.researchQueue.researchNow(subtask, this.#backlog)`, log info (`'Synchronous inline re-research complete'`), then fall through to the normal `executeWithRetry` path. On no-match: `throw error;` (real generation error → outer catch → `Failed` + rethrow). See `research/mock-and-test-strategy.md` case (b).
4. **The synchronous generate path is a NEW `ResearchQueue.researchNow(task, backlog)` method.** The queue owns the private `#prpGenerator`; the orchestrator cannot call it directly. The item's INPUT section and MOCKING section both endorse this (it stubs `researchQueue`, not a separate PRPGenerator). `researchNow`: (a) cache check — return `results.get(task.id)` if present (dedup guard); (b) `const prp = await this.#prpGenerator.generate(task, backlog);` (inline, awaited synchronously); (c) `this.results.set(task.id, prp);` (EXPLICIT, unguarded — this is what makes the inline result authoritative); (d) `return prp;`. It must NOT touch the `researching` Map (S2's `processNext.finally` owns that cleanup; see `research/orchestrator-flow-analysis.md` §5). See `research/orchestrator-flow-analysis.md` §3–§5 for the S2-conflict resolution and the dedup proof.
5. **`researchNow` is placed AFTER `getPRP`/`waitForPRP` in the file** (co-locate near the other public accessors), with full JSDoc (`@remarks` citing PRD §4.2 synchronous fallback, `@param`, `@returns`, `@example`).
6. **No status change in the fallback.** The fallback performs NO `setStatus` (the item stays `Implementing`); the existing `Researching → Implementing → Complete` triple is unchanged, so the existing `expect(updateItemStatus).toHaveBeenCalledTimes(3)` assertions stay green.
7. **The orchestrator discards the `waitForPRP`/`researchNow` return values.** It does NOT pipe the PRP to `prpRuntime.executeSubtask` (that would change PRPRuntime's signature and break `prp-runtime.test.ts` — out of scope; item says "no API surface change at the orchestrator layer"). The research-wait + fallback achieves the goal by ensuring research completes-or-is-done-inline before the agent-run. See `research/orchestrator-flow-analysis.md` §6.
8. **TDD**: write the failing tests FIRST, then implement.
9. **Mode A docs**: JSDoc on `researchNow` + a comment at the fallback site. No standalone doc subtask.

### Success Criteria
- [ ] `executeSubtask` calls `this.researchQueue.waitForPRP(subtask.id)` exactly once per subtask that reaches execution (inside the existing try block).
- [ ] When `waitForPRP` rejects with `ResearchTimeoutError`, `executeSubtask` calls `this.researchQueue.researchNow(subtask, backlog)` **exactly once** and then proceeds to `prpRuntime.executeSubtask` (status → Complete when PRPRuntime returns success).
- [ ] When `waitForPRP` rejects with a non-`ResearchTimeoutError`, `executeSubtask` does **not** call `researchNow`, sets the item `Failed`, and re-throws.
- [ ] Abandonment + inline re-research are each logged at **info** level.
- [ ] The fallback adds **no** status transition (status count stays 3 for the happy + abandonment cases).
- [ ] `researchNow` caches its inline result in `results` (verified via `getPRP`), does NOT re-generate when a result is already cached, and does NOT delete from `researching`.
- [ ] `npm run validate` passes (zero errors); `npm run test:run` passes (all green, incl. new tests AND all pre-existing `executeSubtask` tests unchanged).

## All Needed Context

### Context Completeness Check
_Pass_: An agent with zero codebase knowledge can implement this from (a) the verbatim current `executeSubtask` control flow + chosen insertion point (`research/orchestrator-flow-analysis.md` §1–§2), (b) the exact `researchNow` body + dedup proof (§3–§5), (c) the exact test-mock change (`research/mock-and-test-strategy.md` §1–§4, incl. the `importOriginal` trap), (d) S2's API contract (quoted below), and (e) the verified commands (`npm run validate`, `npm run test:run`). No inference required.

### Documentation & References

```yaml
# MUST READ — the orchestrator file being modified (THE primary target)
- file: src/core/task-orchestrator.ts
  why: This is where executeSubtask lives. It currently calls ONLY this.researchQueue.getPRP(id) (cache metrics, result discarded) — it does NOT call waitForPRP. S3 adds the waitForPRP call + fallback as the FIRST statement inside the existing try block (right after setStatus('Implementing'), before #retryManager.executeWithRetry). this.researchQueue is a PUBLIC readonly field (line ~88); this.prpRuntime is exposed via a PUBLIC getter (line ~252) — both reachable from tests.
  section: "executeSubtask (~line 639-760): getPRP cache check → canExecute gate → setStatus('Implementing') → try{ retryManager.executeWithRetry(prpRuntime.executeSubtask) }"
  pattern: |
    # TODAY (the region S3 edits) — statuses Researching(#1) → Implementing(#2) → Complete/Failed(#3):
    const cachedPRP = this.researchQueue.getPRP(subtask.id);   // metrics only
    ...
    if (!this.canExecute(subtask)) { ...; return; }            // dependency gate
    await this.setStatus(subtask.id, 'Implementing', 'Starting implementation');
    try {
      // <— S3 INSERTS waitForPRP + fallback HERE (first statement)
      const result = await this.#retryManager.executeWithRetry(subtask, async () => {
        return await this.#prpRuntime.executeSubtask(subtask, this.#backlog);
      });
      ...
  gotcha: The only try/catch in executeSubtask wraps the agent-run. Steps BEFORE the try (Researching status, cache check, dependency gate, Implementing status) are UNPROTECTED — an exception there leaves the item stuck. That is WHY the research-wait must go INSIDE the try (real error → Failed via the catch), not above it.

# MUST READ — the queue file S3 adds researchNow to (S2 edits waitForPRP/processNext; S3 adds a NEW method — no overlap)
- file: src/core/research-queue.ts
  why: researchNow goes here because the queue owns the private #prpGenerator (the orchestrator cannot call it). Place researchNow near getPRP/waitForPRP. It must reuse the EXACT accessor shape already in the file.
  section: "getPRP (~221), waitForPRP (~236), readonly fields researching/results (~70)"
  pattern: |
    # EXISTING public accessor to mirror for researchNow:
    getPRP(taskId: string): PRPDocument | null {
      return this.results.get(taskId) ?? null;
    }
    # S2's signature (already present once S2 lands — S3 CONSUMES, does not change it):
    async waitForPRP(taskId: string): Promise<PRPDocument>   // throws ResearchTimeoutError on deadline
    # researchNow body (NEW):
    async researchNow(task: TaskOrSubtask, backlog: Backlog): Promise<PRPDocument> {
      const cached = this.results.get(task.id);
      if (cached) return cached;
      const prp = await this.#prpGenerator.generate(task, backlog);
      this.results.set(task.id, prp);     // explicit, UNGUARDED — inline result is authoritative
      return prp;
    }
  gotcha: |
    - Do NOT touch researching in researchNow — S2's processNext.finally owns that cleanup (orchestrator-flow-analysis §5).
    - Do NOT guard researchNow's results.set with the abandoned check — researchNow bypasses processNext by design (the dedup proof, orchestrator-flow-analysis §4).
    - TaskOrSubtask and Backlog are ALREADY imported in research-queue.ts; PRPDocument too. No new imports.

# MUST READ — S2's contract (the API S3 consumes — treat as hard contract; S2 ships it in parallel)
- file: plan/005_d32a2ecf61cd/P5M1T1S2/PRP.md
  why: Defines EXACTLY what waitForPRP/ResearchTimeoutError/abandoned/isAbandoned/processNext-guard look like when S3 begins. S3 depends on: waitForPRP rejecting with ResearchTimeoutError on deadline; ResearchTimeoutError exported from research-queue.ts AND src/core/index.ts; the processNext .then guard that skips caching for abandoned tasks (the OTHER half of the dedup contract). Read the "What / Technical requirements" + "Implementation Patterns" sections.
  section: "Success Criteria + Implementation Patterns (the rewritten waitForPRP + processNext .then guard)"

# MUST READ — the design analysis written for THIS subtask
- file: plan/005_d32a2ecf61cd/P5M1T1S3/research/orchestrator-flow-analysis.md
  why: §1 verbatim current executeSubtask flow; §2 the chosen insertion point + WHY inside-try/not-above-try/outside-retryManager; §3 why researchNow on the queue + the S2-conflict resolution; §4 the dedup/ignore-contract PROOF (late background result cannot clobber inline); §5 why researchNow leaves researching intact; §6 why the return value is discarded.
- file: plan/005_d32a2ecf61cd/P5M1T1S3/research/mock-and-test-strategy.md
  why: §1 the CRITICAL importOriginal trap (else ResearchTimeoutError is undefined → instanceof TypeError); §2 how tests reach the mock instance via the public researchQueue field + prpRuntime getter; §3 the PRIMARY failing tests (verbatim); §4 the SECONDARY researchNow tests; §6 why NO fake timers are needed here.

# MUST READ — the PRIMARY test file being extended (mock idioms + describe structure)
- file: tests/unit/core/task-orchestrator.test.ts
  why: S3 (a) changes the research-queue.js module mock to async importOriginal + ...actual + new defaults, (b) adds two cases inside describe('executeSubtask') (line ~574). The task-utils.js mock (line ~37) is the EXACT precedent for the importOriginal idiom. createMockSessionManager / createTestBacklog / createTestSubtask factories (line ~115+) are reused as-is.
  section: "module mocks (lines ~37-89); describe('executeSubtask') (line ~574); existing happy-path test 'should set subtask status to Implementing then Complete' (asserts updateItemStatus called 3× — must stay green)"
  pattern: |
    # The task-utils.js mock is the template for the research-queue.js mock change:
    vi.mock('../../../src/utils/task-utils.js', async importOriginal => {
      const actual = await importOriginal<typeof import('../../../src/utils/task-utils.js')>();
      return { ...actual, getNextPendingItem: vi.fn() };
    });
    # Per-test override (researchQueue is a PUBLIC field, prpRuntime a PUBLIC getter):
    const queue = orchestrator.researchQueue as any;
    queue.waitForPRP = vi.fn().mockRejectedValue(new ResearchTimeoutError('P1.M1.T1.S1', 300));
    queue.researchNow = vi.fn().mockResolvedValue({ id: 'inline-prp', title: 'Inline re-research' });
    expect(orchestrator.prpRuntime.executeSubtask).toHaveBeenCalledTimes(1);
  gotcha: |
    - The CURRENT research-queue.js mock (lines ~60-69) REPLACES the whole module → ResearchTimeoutError would be undefined. MUST switch to importOriginal + ...actual.
    - WITHOUT waitForPRP/researchNow defaults on the mock instance, every existing executeSubtask test TypeErrors (the new waitForPRP call hits undefined). MUST add the defaults.

# MUST READ — the SECONDARY test file (researchNow unit coverage)
- file: tests/unit/core/research-queue.test.ts
  why: researchNow is a new public queue method → add a describe('researchNow') here mirroring the existing describe('enqueue')/describe('getPRP') style. Reuses the ALREADY-present module mock: vi.mock('../../../src/agents/prp-generator.js', () => ({ PRPGenerator: vi.fn() })) + MockPRPGenerator.mockImplementation(() => ({ generate: mockGenerate })).
  section: "module mock at top; existing describe('enqueue'), describe('getPRP') blocks"
  gotcha: (queue as any).results / .researching are how the test seeds/inspects the readonly Maps (existing tests already do this).

# REFERENCE — architecture notes (respect boundaries)
- file: plan/005_d32a2ecf61cd/architecture/implementation_notes.md
  why: §3 (retry dimensions — fallback is NOT a TaskRetryManager concern), §4 (waitForPRP deadline needs abandonment + orchestrator re-researches synchronously inline + abandoned result ignored via results Map dedup), §7 (implicit TDD — update consuming tests in the same subtask), §9 (Mode A docs), §10/§11 (validation gates + Groundswell read-only).
  section: "§3, §4, §7, §9, §10"
- file: plan/005_d32a2ecf61cd/architecture/delta_impact.md
  why: §R1 confirms the current ResearchQueue surface, that waitForPRP has no timeout/abandonment today (S2 adds it), and that the orchestrator must wire the synchronous fallback at the agent-run site. Lists the test files touched (incl. task-orchestrator.test.ts).
  section: "R1"
```

### Current Codebase tree (relevant slice)

```bash
src/core/
├── research-queue.ts      # EDIT: + researchNow(task, backlog) (NEW method; S2 owns waitForPRP/processNext/abandoned)
├── task-orchestrator.ts   # EDIT: executeSubtask gains waitForPRP + ResearchTimeoutError fallback; import ResearchTimeoutError
└── index.ts               # (S2 already re-exports ResearchTimeoutError — verify present; no change unless missing)

src/config/
└── constants.ts           # S1 (merged) — read-only reference (getResearchTimeoutSeconds used only by S2, not directly by S3)

src/agents/
└── prp-runtime.ts         # DO NOT TOUCH — generates its own PRP via #generator; executeSubtask(subtask, backlog) signature unchanged

tests/unit/core/
├── task-orchestrator.test.ts  # EDIT: research-queue.js mock → importOriginal; + waitForPRP/researchNow defaults; + 2 executeSubtask cases
└── research-queue.test.ts     # EDIT: + describe('researchNow') (3 cases)
```

### Desired Codebase tree with files to be added/modified

```bash
src/core/
└── research-queue.ts          # MODIFIED: + researchNow() method (+ JSDoc). No change to S2's symbols.
src/core/
└── task-orchestrator.ts       # MODIFIED: + import ResearchTimeoutError; executeSubtask + waitForPRP/fallback inside try.
tests/unit/core/
├── task-orchestrator.test.ts  # MODIFIED: research-queue.js mock (importOriginal + defaults); + 2 executeSubtask cases.
└── research-queue.test.ts     # MODIFIED: + describe('researchNow') (3 cases).
```

> **No new files.** One new METHOD on an existing class; one modified method (`executeSubtask`); two extended test files. `researchNow` is co-located in research-queue.ts with the other public accessors (mirrors how S2 co-locates `ResearchTimeoutError` there and how `getPRP`/`waitForPRP` live there).

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL: vi.mock('research-queue.js', () => ({ ResearchQueue })) REPLACES the whole module,
//   so the orchestrator's `import { ResearchTimeoutError }` resolves to `undefined` in tests →
//   `error instanceof undefined` → TypeError ("Right-hand side of instanceof is not callable").
//   FIX: switch the mock to `async importOriginal => ({ ...actual, ResearchQueue: ... })` so the
//   REAL ResearchTimeoutError (S2's export) survives. The task-utils.js mock in this very file is
//   the precedent. (research/mock-and-test-strategy.md §1)

// CRITICAL: adding waitForPRP to executeSubtask means EVERY existing executeSubtask test now
//   calls it. If the mock instance lacks a default waitForPRP, they TypeError. ADD defaults
//   (waitForPRP: vi.fn().mockResolvedValue({...}), researchNow: vi.fn().mockResolvedValue({...}))
//   to the mockImplementation so the happy path resolves (no fallback) and the existing
//   toHaveBeenCalledTimes(3) status assertions stay GREEN. (implementation_notes.md §7 implicit-TDD)

// CRITICAL: place the research-wait INSIDE the existing try{} of executeSubtask (first statement),
//   NOT above it. Above the try, a non-timeout error leaks out with the item stuck in
//   Researching/Implementing. Inside the try, it hits the outer catch → setStatus(Failed) → rethrow.
//   (orchestrator-flow-analysis.md §2; the non-timeout test case (b) enforces this.)

// CRITICAL: do NOT wrap the fallback in #retryManager.executeWithRetry. TaskRetryManager is the
//   transient-infra retry dimension (API timeout/network, exponential backoff). The deadline/
//   abandonment fallback is a SEPARATE concern (PRD §4.2). researchNow is a single inline call.
//   (implementation_notes.md §3)

// CRITICAL: researchNow's results.set is EXPLICIT and must NOT be guarded by the abandoned check.
//   researchNow bypasses processNext by design; the late background result goes through processNext
//   (where S2's .then guard skips it for abandoned tasks). That ordering is what makes the inline
//   result authoritative. Guarding researchNow's set would let the late background result win.
//   (orchestrator-flow-analysis.md §4 — the dedup proof)

// GOTCHA: researchNow must NOT touch the researching Map. S2's processNext.finally owns its
//   cleanup when the background generate eventually completes/rejects. Deleting from researching
//   in researchNow would corrupt in-flight tracking. (orchestrator-flow-analysis.md §5)

// GOTCHA: the fallback adds NO setStatus — the item stays Implementing. This is what keeps the
//   existing toHaveBeenCalledTimes(3) (Researching/Implementing/Complete) assertions GREEN.

// GOTCHA: TS ESM source uses `.js` import specifiers in .ts files (tsconfig moduleResolution maps
//   .js→.ts). The orchestrator's import is: import { ResearchQueue, ResearchTimeoutError } from './research-queue.js';

// GOTCHA: NO fake timers needed in task-orchestrator.test.ts (unlike S2). The mock waitForPRP
//   synchronously rejects with a real ResearchTimeoutError; the mock researchNow synchronously
//   resolves. No setTimeout/deadline is exercised at the orchestrator layer. Leave real timers.

// GOTCHA: eslint requires JSDoc (@returns/@param/@remarks) on exported methods. Clone the JSDoc
//   style of the existing getPRP/waitForPRP accessors for researchNow.
```

## Implementation Blueprint

### Data models and structure

No new persistence/ORM models and no new error class (S2 owns `ResearchTimeoutError`). The only new "structure" is one method. `researchNow` reuses the already-imported `TaskOrSubtask`, `Backlog`, `PRPDocument` types from `research-queue.ts`'s existing imports.

```typescript
// === NEW method on class ResearchQueue (place near getPRP/waitForPRP) ===
/**
 * Re-researches a task SYNCHRONOUSLY, inline (PRD §4.2 fallback).
 *
 * @remarks
 * Called by `TaskOrchestrator.executeSubtask` when `waitForPRP` reports the background
 * research was abandoned (deadline exceeded). Generates the PRP directly via the queue's
 * `#prpGenerator` and caches it so the abandoned background result (if it ever lands) is
 * ignored — see the `processNext` late-result guard. Does NOT touch the `researching` Map
 * (its cleanup is owned by `processNext`'s `.finally`).
 *
 * @param task - The Task/Subtask to re-research.
 * @param backlog - Full backlog for PRPGenerator context.
 * @returns The freshly-generated (or already-cached) PRPDocument.
 */
async researchNow(task: TaskOrSubtask, backlog: Backlog): Promise<PRPDocument> {
  const cached = this.results.get(task.id);
  if (cached) return cached;
  const prp = await this.#prpGenerator.generate(task, backlog);
  this.results.set(task.id, prp);
  return prp;
}
```

### Implementation Tasks (ordered by dependencies — strict TDD)

```yaml
Task 1: WRITE tests in tests/unit/core/task-orchestrator.test.ts  (FAILING-FIRST — before Task 3)
  - STEP 1a (FIX THE MOCK so ResearchTimeoutError survives + existing tests stay green):
      Replace the current `vi.mock('../../../src/core/research-queue.js', () => ({ ResearchQueue: vi.fn()... }))`
      (lines ~60-69) with the importOriginal form:
        vi.mock('../../../src/core/research-queue.js', async importOriginal => {
          const actual = await importOriginal<typeof import('../../../src/core/research-queue.js')>();
          return {
            ...actual,                 // preserves REAL ResearchTimeoutError (S2 export)
            ResearchQueue: vi.fn().mockImplementation(() => ({
              enqueue: vi.fn().mockResolvedValue(undefined),
              getPRP: vi.fn().mockReturnValue(null),
              processNext: vi.fn().mockResolvedValue(undefined),
              getStats: vi.fn().mockReturnValue({ queued: 0, researching: 0, cached: 0 }),
              waitForPRP: vi.fn().mockResolvedValue({ id: 'default-prp', title: 'cached PRP' }),
              researchNow: vi.fn().mockResolvedValue({ id: 'default-prp', title: 'inline PRP' }),
            })),
          };
        });
      ADD the import of ResearchTimeoutError at the top of the file (alongside the TaskOrchestrator import):
        import { ResearchTimeoutError } from '../../../src/core/research-queue.js';
      (This import is what makes the test compile against the real class. If S2 also re-exports it
       from src/core/index.js, either path works — prefer the direct research-queue.js import to
       match the orchestrator's own import.)
  - STEP 1b: ADD two cases inside the existing `describe('executeSubtask', () => { ... })` (line ~574):
      (a) 'falls back to synchronous inline re-research when waitForPRP abandons (PRD §4.2)' —
          setup like the sibling 'should set subtask status to Implementing then Complete' test
          (createTestBacklog + currentSession + createMockSessionManager + new TaskOrchestrator);
          override the mock: queue.waitForPRP = vi.fn().mockRejectedValue(new ResearchTimeoutError('P1.M1.T1.S1', 300));
          queue.researchNow = vi.fn().mockResolvedValue({ id: 'inline-prp', title: 'Inline re-research' });
          createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Planned'); await orchestrator.executeSubtask(subtask);
          ASSERT: queue.waitForPRP called once; queue.researchNow called once (with subtask + backlog);
          orchestrator.prpRuntime.executeSubtask called once; updateItemStatus last call 'Complete';
          mockLogger.info called with a message containing 'abandoned'; updateItemStatus called 3× total.
      (b) 'propagates a non-timeout research error instead of falling back' —
          queue.waitForPRP = vi.fn().mockRejectedValue(new Error('research infra down'));
          queue.researchNow = vi.fn();  // must NOT be called
          await expect(orchestrator.executeSubtask(subtask)).rejects.toThrow('research infra down');
          ASSERT: queue.researchNow NOT called; updateItemStatus last call 'Failed'.
  - SEE research/mock-and-test-strategy.md §3 for the verbatim bodies.
  - VERIFY RED: run `npm run test:run -- task-orchestrator` BEFORE Task 2/3 — case (a) fails
      (waitForPRP never called → toHaveBeenCalledTimes(1) fails); case (b) fails (no waitForPRP
      call, item not Failed by this path). The mock change (1a) alone keeps the OTHER existing
      executeSubtask tests green (waitForPRP default resolves → no fallback).

Task 2: WRITE the researchNow unit tests in tests/unit/core/research-queue.test.ts  (FAILING-FIRST)
  - ADD a `describe('researchNow', () => { ... })` mirroring the existing describe('enqueue')/describe('getPRP')
      blocks (reuse the module-level vi.mock('../../../src/agents/prp-generator.js') + MockPRPGenerator
      pattern already at the top of the file; beforeEach(vi.clearAllMocks)).
  - CASES:
      (a) 'generates synchronously inline and caches the result' — mockGenerate resolves expectedPRP;
          const out = await queue.researchNow(task, backlog); assert out===expectedPRP, mockGenerate called
          once with (task, backlog), queue.getPRP(task.id)===expectedPRP (CACHED).
      (b) 'returns the cached result without re-generating if one already exists' — seed
          (queue as any).results.set(task.id, cached); mockGenerate = vi.fn(); assert out===cached and
          mockGenerate NOT called.
      (c) 'does not delete from researching (background cleanup is processNext.finally)' — seed
          (queue as any).researching.set(task.id, Promise.resolve(prp)); await researchNow; assert
          (queue as any).researching.has(task.id) === true.
  - SEE research/mock-and-test-strategy.md §4 for the verbatim bodies.
  - VERIFY RED: `npm run test:run -- research-queue` BEFORE Task 3 — fails (researchNow undefined).

Task 3: MODIFY src/core/research-queue.ts  (makes Task 2 GREEN; also unblocks Task 1's RED→GREEN path)
  - ADD the researchNow method to class ResearchQueue (near getPRP/waitForPRP). Body = the "Data models"
      block above. Full JSDoc (@remarks citing PRD §4.2, @param, @returns, @example).
  - GOTCHA: TaskOrSubtask, Backlog, PRPDocument are ALREADY imported — no new imports. Do NOT touch
      waitForPRP, processNext, abandoned, isAbandoned, or ResearchTimeoutError (S2's territory).
  - FOLLOW pattern: the existing getPRP accessor for shape/style.

Task 4: MODIFY src/core/task-orchestrator.ts  (makes Task 1 GREEN — wire the fallback)
  - STEP 4a: UPDATE the import to add ResearchTimeoutError:
      import { ResearchQueue, ResearchTimeoutError } from './research-queue.js';
  - STEP 4b: Inside executeSubtask, as the FIRST statement of the existing `try {` block (right after
      `await this.setStatus(subtask.id, 'Implementing', 'Starting implementation');` and BEFORE
      `const result = await this.#retryManager.executeWithRetry(...)`), insert:
        // PRD §4.2: await background research (deadline-guarded by ResearchQueue — S2); fall back to
        // synchronous inline re-research if the background work was abandoned (hung/crashed agent).
        try {
          await this.researchQueue.waitForPRP(subtask.id);
        } catch (error) {
          if (error instanceof ResearchTimeoutError) {
            this.#logger.info(
              { subtaskId: subtask.id },
              'Background research abandoned (deadline exceeded); re-researching synchronously inline',
            );
            await this.researchQueue.researchNow(subtask, this.#backlog);
            this.#logger.info(
              { subtaskId: subtask.id },
              'Synchronous inline re-research complete',
            );
          } else {
            throw error;   // real generation error → outer catch → Failed + rethrow
          }
        }
  - FOLLOW pattern: the existing executeSubtask try/catch structure (minimal diff — one nested try/catch
      added as the first statement; outer catch unchanged).
  - NAMING: no new symbols except the import. Comments reference PRD §4.2.
  - DEPENDENCIES: ResearchTimeoutError from S2 (exported from research-queue.ts). researchNow from Task 3.
  - PLACEMENT: src/core/task-orchestrator.ts (in place; do NOT refactor executeSubtask's shape).

Task 5: VERIFY (validation gates — run after Task 3 and Task 4)
  - RUN: `npm run validate`  (eslint . --ext .ts + prettier --check + tsc --noEmit) — expect ZERO errors.
      If eslint flags missing JSDoc on researchNow, complete it (clone getPRP's JSDoc style). If
      prettier --check fails, run `npm run format` (it writes) then re-check.
  - RUN: `npm run test:run`  (vitest run) — expect ALL green: the 2 new orchestrator cases, the 3 new
      researchNow cases, AND every pre-existing executeSubtask + research-queue test (unchanged).
  - GREP-VERIFY scope: `git diff --stat` shows ONLY:
      src/core/research-queue.ts, src/core/task-orchestrator.ts,
      tests/unit/core/task-orchestrator.test.ts, tests/unit/core/research-queue.test.ts.
  - GREP-VERIFY untouched: `git diff src/agents/prp-runtime.ts src/core/index.ts src/config/constants.ts`
      → EMPTY (index.ts only if S2 already re-exported ResearchTimeoutError; if NOT present, this is a
      S2 completion gap — report it, do NOT add it here to avoid colliding with S2's in-flight work;
      the orchestrator imports directly from research-queue.js so the core/index.js re-export is not
      required for S3 to function).
```

### Implementation Patterns & Key Details

```typescript
// === PATTERN: the executeSubtask fallback (the core orchestrator change) ===
// Inserted as the FIRST statement inside the existing try{} (after setStatus('Implementing'),
// before #retryManager.executeWithRetry). Nested try/catch: ONLY ResearchTimeoutError triggers the
// fallback; everything else re-throws to the outer catch (→ Failed). No status change here.

try {
  await this.researchQueue.waitForPRP(subtask.id);
} catch (error) {
  if (error instanceof ResearchTimeoutError) {
    this.#logger.info(
      { subtaskId: subtask.id },
      'Background research abandoned (deadline exceeded); re-researching synchronously inline',
    );
    await this.researchQueue.researchNow(subtask, this.#backlog);   // synchronous inline generate + cache
    this.#logger.info({ subtaskId: subtask.id }, 'Synchronous inline re-research complete');
  } else {
    throw error;   // real generation error → outer catch → setStatus(Failed) → rethrow
  }
}
// ... existing: const result = await this.#retryManager.executeWithRetry(subtask, async () => ...)

// === PATTERN: researchNow (the new queue method) ===
// Explicit, UNGUARDED results.set is the crux of the dedup contract — the late background result
// is skipped by S2's processNext .then guard (abandoned tasks), so the inline result always wins.
// Does NOT touch researching (processNext.finally owns that).

async researchNow(task: TaskOrSubtask, backlog: Backlog): Promise<PRPDocument> {
  const cached = this.results.get(task.id);
  if (cached) return cached;                          // dedup guard (don't re-generate)
  const prp = await this.#prpGenerator.generate(task, backlog);
  this.results.set(task.id, prp);                     // authoritative inline result
  return prp;
}

// === PATTERN: the test mock change (importOriginal preserves ResearchTimeoutError) ===
vi.mock('../../../src/core/research-queue.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../src/core/research-queue.js')>();
  return {
    ...actual,                                        // REAL ResearchTimeoutError survives
    ResearchQueue: vi.fn().mockImplementation(() => ({
      enqueue: vi.fn().mockResolvedValue(undefined),
      getPRP: vi.fn().mockReturnValue(null),
      processNext: vi.fn().mockResolvedValue(undefined),
      getStats: vi.fn().mockReturnValue({ queued: 0, researching: 0, cached: 0 }),
      waitForPRP: vi.fn().mockResolvedValue({ id: 'default-prp', title: 'cached PRP' }),
      researchNow: vi.fn().mockResolvedValue({ id: 'default-prp', title: 'inline PRP' }),
    })),
  };
});
```

### Integration Points

```yaml
CORE API (consumed — S2, do NOT modify):
  - source: src/core/research-queue.ts (S2 ships: ResearchTimeoutError, waitForPRP deadline,
    abandoned Set, isAbandoned, processNext .then guard)
  - consume: import { ResearchQueue, ResearchTimeoutError } in task-orchestrator.ts;
             instanceof ResearchTimeoutError in the fallback catch.

CORE API (added — this subtask):
  - file: src/core/research-queue.ts
  - add: async researchNow(task, backlog): Promise<PRPDocument>  (inline generate + cache)

ORCHESTRATOR (the change — this subtask):
  - file: src/core/task-orchestrator.ts
  - modify: executeSubtask — first statement of existing try{} = waitForPRP + ResearchTimeoutError fallback
  - import: + ResearchTimeoutError alongside ResearchQueue

NOT TOUCHED (scope guardrails):
  - src/agents/prp-runtime.ts        # generates its own PRP; signature unchanged (research-wait result discarded by design)
  - src/core/task-retry-manager.ts   # transient-infra retry dimension — fallback is OUTSIDE executeWithRetry
  - src/config/constants.ts          # S1 (merged) — getResearchTimeoutSeconds consumed by S2 only, not S3 directly
  - src/core/index.ts                # S2 re-exports ResearchTimeoutError; S3 imports directly from research-queue.js
  - docs/**                          # Mode A = JSDoc + inline comments only (implementation_notes.md §9)

DEDUP CONTRACT (cross-subtask — S2 + S3 together enforce it):
  - S2: processNext .then guard skips results.set for abandoned tasks (late background result ignored).
  - S3: researchNow explicit results.set (inline result authoritative) + orchestrator only calls it on abandonment.
  - Together: the inline result is the single source of truth; the late background result cannot clobber it.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# After Task 3 (research-queue.ts) + Task 4 (task-orchestrator.ts):
npm run validate
# = npm run lint (eslint . --ext .ts) && npm run format:check (prettier --check) && npm run typecheck (tsc --noEmit)
# Expected: ZERO errors.
#   - eslint may flag missing JSDoc @returns/@param/@remarks on researchNow → complete it (clone getPRP's JSDoc).
#   - tsc must accept `error instanceof ResearchTimeoutError` (imported from './research-queue.js').
#   - prettier may reflow the multi-line logger.info strings → run `npm run format` (writes) then re-validate.
```

### Level 2: Unit Tests (Component Validation)

```bash
# RED step (after Task 1 + Task 2, before Task 3 + Task 4) — MUST fail first (TDD):
npm run test:run -- task-orchestrator     # case (a)/(b) fail (no waitForPRP/researchNow yet)
npm run test:run -- research-queue        # researchNow cases fail (method undefined)
# NOTE: Task 1a (the mock importOriginal change + defaults) keeps the OTHER existing executeSubtask
#       tests GREEN even before implementation — run the full file to confirm no collateral RED.

# GREEN step (after Task 3 + Task 4):
npm run test:run -- task-orchestrator     # ALL green — 2 new cases + every existing executeSubtask test
npm run test:run -- research-queue        # ALL green — 3 new researchNow cases + S2's abandonment suite + existing

# Full suite (confirm no cross-file regression):
npm run test:run
# Expected: all green. If existing executeSubtask tests now TypeError or fail the 3× status count,
#   the mock is missing waitForPRP/researchNow defaults OR the fallback added a status change (it must not).
```

### Level 3: Integration Testing (System Validation)

```bash
# The orchestrator test IS the integration boundary here (it wires researchQueue → prpRuntime with
# status transitions). Level 2 covers it. No additional integration file is required for S3.

# If an integration smoke is desired, confirm the wired symbol surface exists end-to-end:
npm run build && node --input-type=module -e "
import('./dist/core/research-queue.js').then(m => {
  const q = {}; // shape check only — researchNow is a prototype method on the class
  console.log('ResearchTimeoutError:', typeof m.ResearchTimeoutError);
  console.log('ResearchQueue:', typeof m.ResearchQueue);
});
"
# Expected: ResearchTimeoutError: function, ResearchQueue: function.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Scope-guard regression — confirm we did NOT over-reach into prp-runtime / retry-manager / constants / docs:
git diff --stat
# Expected: ONLY src/core/research-queue.ts, src/core/task-orchestrator.ts,
#           tests/unit/core/task-orchestrator.test.ts, tests/unit/core/research-queue.test.ts.

git diff src/agents/prp-runtime.ts src/core/task-retry-manager.ts src/config/constants.ts
# Expected: EMPTY (no changes).

# Dedup-contract reasoning check (human-readable): confirm researchNow's results.set is UNGUARDED
# and processNext's .then guard (S2) skips abandoned tasks — together they make the inline result
# authoritative. (Asserted by research-queue.test.ts case (a)/(c) + S2's late-result-ignored case.)

# Resilience check: confirm a non-timeout research error is NOT swallowed as abandonment.
# (Covered by task-orchestrator.test.ts case (b) — researchNow NOT called, item Failed, error rethrown.)
```

## Final Validation Checklist

### Technical Validation
- [ ] `npm run validate` passes (eslint + prettier --check + tsc --noEmit, zero errors).
- [ ] `npm run test:run` passes (all green — 2 new orchestrator cases + 3 new researchNow cases + all pre-existing tests unchanged).
- [ ] RED step observed before GREEN (tests failed before implementation — TDD).

### Feature Validation
- [ ] `executeSubtask` calls `this.researchQueue.waitForPRP(subtask.id)` exactly once (inside the existing try block).
- [ ] On `ResearchTimeoutError`, `executeSubtask` calls `this.researchQueue.researchNow(subtask, backlog)` **exactly once**, then proceeds to `prpRuntime.executeSubtask` (status → Complete when PRPRuntime succeeds).
- [ ] On a non-`ResearchTimeoutError`, `executeSubtask` does **not** call `researchNow`, sets `Failed`, and re-throws.
- [ ] Abandonment + inline re-research each logged at **info** level.
- [ ] The fallback adds **no** status transition (`updateItemStatus` count stays 3 for happy + abandonment cases).
- [ ] `researchNow` caches its result (`getPRP` returns it), skips re-generation when already cached, and leaves `researching` intact.
- [ ] Dedup contract holds: a late background result for an abandoned task does NOT clobber the inline result (inline `results.set` unguarded + S2 `processNext` guard skips abandoned).

### Code Quality Validation
- [ ] The research-wait is INSIDE the existing `try{}` (first statement), NOT above it; OUTSIDE `#retryManager.executeWithRetry`.
- [ ] The fallback catches ONLY `ResearchTimeoutError` (`instanceof`); other errors re-thrown.
- [ ] `researchNow`'s `results.set` is explicit/unguarded; it does NOT touch `researching`.
- [ ] The `research-queue.js` test mock uses `async importOriginal` + `...actual` (so `ResearchTimeoutError` is the real class) and provides `waitForPRP`/`researchNow` defaults (so existing tests stay green).
- [ ] ESM import specifiers use `.js` extensions; import line is `import { ResearchQueue, ResearchTimeoutError } from './research-queue.js';`.
- [ ] File placement matches the desired tree (only the 4 files touched).

### Documentation & Deployment
- [ ] JSDoc on `researchNow` (`@remarks` citing PRD §4.2 synchronous fallback, `@param`, `@returns`, `@example`) — Mode A.
- [ ] Inline comment at the fallback site in `executeSubtask` references PRD §4.2.
- [ ] No standalone doc subtask; no `docs/**` edits (implementation_notes.md §9).

---

## Anti-Patterns to Avoid

- ❌ Don't place the research-wait ABOVE the existing `try{}` — a non-timeout error would leak out with the item stuck in Researching/Implementing. Put it as the FIRST statement INSIDE the try (case (b) test enforces this).
- ❌ Don't wrap the fallback in `#retryManager.executeWithRetry` — that's the transient-infra retry dimension; the deadline/abandonment fallback is a separate, single inline call (implementation_notes.md §3).
- ❌ Don't guard `researchNow`'s `results.set` with the `abandoned` check — researchNow bypasses `processNext` by design; guarding it would let the late background result win (orchestrator-flow-analysis.md §4).
- ❌ Don't have `researchNow` delete from `researching` — S2's `processNext.finally` owns that cleanup; deleting corrupts in-flight tracking (§5).
- ❌ Don't pipe the `waitForPRP`/`researchNow` return value into `prpRuntime.executeSubtask` — that changes PRPRuntime's signature and breaks `prp-runtime.test.ts`; the item says no API surface change. The orchestrator discards it by design (§6).
- ❌ Don't add a `setStatus` in the fallback — it would break the existing `toHaveBeenCalledTimes(3)` assertions and is unnecessary (the item stays Implementing).
- ❌ Don't leave the `research-queue.js` test mock as a plain `() => ({ ResearchQueue })` — `ResearchTimeoutError` would be `undefined` and `instanceof` would TypeError. Use `async importOriginal` + `...actual` (§1).
- ❌ Don't forget the `waitForPRP`/`researchNow` DEFAULTS on the mock instance — every existing `executeSubtask` test now calls `waitForPRP`; without a resolving default they TypeError (implementation_notes.md §7).
- ❌ Don't use fake timers in `task-orchestrator.test.ts` — the mock `waitForPRP`/`researchNow` are synchronous; fake timers risk leaking into sibling describes (unlike S2, S3 needs none).
- ❌ Don't write the implementation before the failing tests (breaks implicit-TDD; implementation_notes.md §7).
- ❌ Don't touch `prp-runtime.ts`, `task-retry-manager.ts`, `constants.ts`, S2's `waitForPRP`/`processNext`/`abandoned`/`isAbandoned`/`ResearchTimeoutError`, or `docs/**` — out of scope / S2's territory / Mode A.
- ❌ Don't create a standalone docs subtask — Mode A = JSDoc + inline comments only (implementation_notes.md §9).

---

## Success Metrics

**Confidence Score: 9/10** — Tightly-scoped change (one new queue method + one nested try/catch in `executeSubtask` + two extended test files) with: (a) the verbatim current `executeSubtask` control flow + a justified, test-enforced insertion point (`orchestrator-flow-analysis.md`); (b) airtight dedup proof showing the inline `results.set` + S2's `processNext` guard make the late background result non-clobbering; (c) the critical `importOriginal` mock trap documented with the exact in-file precedent (`task-utils.js`); (d) verbatim failing-first test bodies for both files; (e) confirmed validation commands (`npm run validate`, `npm run test:run`) and verified no fake-timer / no PRPRuntime-signature change needed. Residual risks are low and caught by Level 1/2: a missing JSDoc field (eslint), an existing executeSubtask test going RED if the mock defaults are omitted (Level 2), or a misplaced research-wait (the case (b) test forces it inside the try). The one cross-subtask dependency — S2's `ResearchTimeoutError` export — is a hard contract S3 imports directly from `research-queue.js` (so even if S2's `core/index.ts` re-export is pending, S3 functions). One-pass success is highly likely.
