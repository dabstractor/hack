# Research Note — P5.M1.T1.S2: Deadline-wrap `waitForPRP`

Captures the non-obvious findings that drive the PRP's design. Read alongside the PRP.

## 1. Design decision: typed-error approach (NOT discriminated-result)

The item contract offers two equivalent options for surfacing abandonment:
- (A) discriminated result `{ status: 'ready'; prp } | { status: 'abandoned' }`
- (B) `isAbandoned(taskId)` + `waitForPRP` throwing a typed `ResearchTimeoutError`

**Chosen: (B) typed-error.** Rationale:
- **Zero churn on the happy path.** `waitForPRP`'s success return type stays `Promise<PRPDocument>`. The 5+ existing waitForPRP success tests (`should return cached result immediately`, `should wait for in-flight task`, `should resolve after task completes`, and the ~15 tests that merely `await queue.waitForPRP(id)` to drive completion) stay green as-is. Only NEW tests are added for the timeout/abandonment behavior. This minimizes risk and respects implementation_notes.md §7 ("update tests in the SAME subtask").
- **No src caller breakage.** Confirmed via grep: `waitForPRP` has ZERO callers in `src/` outside `research-queue.ts` itself. The orchestrator (`task-orchestrator.ts` ~line 656) consumes `getPRP` (cache), NOT `waitForPRP`. So S3 (orchestrator fallback) will be the FIRST caller of the new timeout behavior — it can `catch (err) { if (err instanceof ResearchTimeoutError) ... }`.
- **Explicit + catchable.** A typed `ResearchTimeoutError` makes the orchestrator branch explicit (`instanceof`), satisfying the contract's "so the orchestrator branch is explicit" requirement.
- `isAbandoned(taskId)` provides the synchronous state probe the orchestrator's PRD §4.2 polling loop needs (polls liveness + artifact presence without re-awaiting).

The item description explicitly endorses (B): *"add `isAbandoned(taskId): boolean` + keep waitForPRP throwing a typed `ResearchTimeoutError`."*

## 2. The `'0'` stub gotcha (S1 interaction — CRITICAL)

S1's reader guards non-positive values:
```ts
// src/config/constants.ts (S1, already implemented)
export function getResearchTimeoutSeconds(): number {
  const raw = Number(process.env[RESEARCH_TIMEOUT] ?? DEFAULT_RESEARCH_TIMEOUT_SECONDS);
  if (Number.isNaN(raw) || raw <= 0) return DEFAULT_RESEARCH_TIMEOUT_SECONDS; // 300
  return raw;
}
```
So `vi.stubEnv(RESEARCH_TIMEOUT, '0')` returns **300**, NOT 0 (the item description's `'0'/'1'` suggestion is misleading here). **Do NOT use `'0'`.** Use a small POSITIVE value (e.g. `'5'`) and **fake timers** (`vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync`) to advance deterministically past the deadline without a real 5-second sleep. This is faster, deterministic, and tests the real `getResearchTimeoutSeconds()` integration end-to-end.

## 3. Promise.race + late rejection → no unhandled rejection (verified)

Concern: when the deadline wins `Promise.race([inFlight, timeout])` and `inFlight` later rejects, is the rejection unhandled?

**Analysis — it is handled, no special swallow needed in the rejection path:**
- `inFlight` is the chained promise created in `processNext` (`.generate().then().catch().finally()`).
- `processNext`'s `.catch` already attaches a rejection handler to the generation promise (logs + re-throws).
- `Promise.race` internally attaches `.then(resolve, reject)` to each input, so it attaches a `reject` handler to `inFlight` itself. Even after the race settles (via the timeout), that handler remains attached → V8 marks `inFlight`'s eventual rejection as **handled** (no `unhandledRejection`).
- The late rejection is therefore logged by `processNext`'s `.catch` and otherwise ignored — exactly the "ignore late result/failure for abandoned task" semantics the contract wants.

**BUT** requirement (c) is about the late **resolved** result being cached. That DOES need an explicit guard in `processNext`'s `.then()`:
```ts
.then(prp => {
  if (this.abandoned.has(task.id)) {
    this.#logger.debug({ taskId: task.id }, 'Ignoring late PRP for abandoned task');
    return prp;            // do NOT cache (dedup per contract c)
  }
  this.results.set(task.id, prp);
  return prp;
})
```

## 4. Timer leak avoidance

`waitForPRP` must `clearTimeout` when the race settles (so a fired-after-win timer doesn't linger / trip fake-timer assertions). Use a `try { ... } finally { clearTimeout(timer); }` around the race.

## 5. Scope boundary (cohesion)

- **Touches ONLY:** `src/core/research-queue.ts`, `tests/unit/core/research-queue.test.ts`, and the one re-export line in `src/core/index.ts`.
- **Verify stays green (do NOT change behavior):** `tests/integration/core/research-queue.test.ts` (exists). With the typed-error approach the success path is unchanged, so it should remain green — run it and only adjust if an assertion hits the new code path.
- **DO NOT touch:** `src/config/constants.ts` (S1), `src/core/task-orchestrator.ts` (S3), any docs file (Mode A = JSDoc only — no standalone doc subtask).

## 6. Conventions confirmed

- Error-class shape to clone: `PRPGenerationError` (`src/agents/prp-generator.ts:42`) — `extends Error`, `public readonly` ctor params, `super(msg)`, `this.name = 'ClassName'`, full JSDoc.
- `PRPDocument` type lives in `src/core/models.ts:1236` (already imported by research-queue.ts).
- Test style: `tests/unit/core/research-queue.test.ts` — module-level `vi.mock('../../../src/agents/prp-generator.js')`, `MockPRPGenerator.mockImplementation(() => ({ generate: mockGenerate }))`, `beforeEach(vi.clearAllMocks)`. Need to add `afterEach` to the vitest import for fake-timer/env cleanup.
- Validation gates: `npm run validate` (lint + format:check + typecheck), `npm run test:run` (vitest run).
