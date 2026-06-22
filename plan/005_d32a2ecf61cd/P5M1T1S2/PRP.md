# PRP — P5.M1.T1.S2: Deadline-wrap `ResearchQueue.waitForPRP` with abandonment state

## Goal

**Feature Goal**: Wrap `ResearchQueue.waitForPRP(taskId)` in a configurable deadline (`RESEARCH_TIMEOUT`, from S1's `getResearchTimeoutSeconds()`) so a hung background `prpGenerator.generate()` can never block the pipeline forever. On deadline expiry, `waitForPRP` records an **abandonment state** for the taskId and throws a typed `ResearchTimeoutError`; a late background result/failure landing for an abandoned task is **ignored** (never cached). The orchestrator (S3) can then re-research the item synchronously, inline. This implements the "Deadline & Fallback" contract of PRD §4.2 for the queue layer.

**Deliverable**:
1. A new exported `ResearchTimeoutError` class (typed, catchable via `instanceof`) in `src/core/research-queue.ts`.
2. A new public `abandoned: Set<string>` field + `isAbandoned(taskId): boolean` probe on `ResearchQueue`.
3. A rewritten `waitForPRP(taskId): Promise<PRPDocument>` that races the in-flight promise against a `getResearchTimeoutSeconds()`-keyed deadline; success path return type is **unchanged** (`Promise<PRPDocument>`), only the timeout path adds abandonment + `ResearchTimeoutError`.
4. A guarded `processNext` `.then()` so a late background result for an abandoned taskId is **not** cached (dedup per contract (c)).
5. A re-export of `ResearchTimeoutError` from `src/core/index.ts`.
6. New unit tests (TDD) extending `tests/unit/core/research-queue.test.ts` covering: resolves normally under deadline; abandons after timeout; abandoned late result is ignored (not cached); `getPRP` still returns cache; late background failure on an abandoned task does not surface. Full JSDoc on all new symbols (Mode A).

**Success Definition**: `npm run validate` (eslint + prettier --check + tsc --noEmit) and `npm run test:run` (vitest run) are both green; `waitForPRP` returns the PRP when generation completes under the deadline; `waitForPRP` rejects with `ResearchTimeoutError` (and `isAbandoned(taskId) === true`) once the deadline elapses; a late result for an abandoned task is never cached (`getPRP(taskId) === null`); the existing happy-path `waitForPRP` tests stay green without assertion-shape changes.

## Why

- **Business value**: PRD §4.2 ("Parallel Research") runs background PRP generation for task N+1 while task N implements. Today `waitForPRP` `await`s the in-flight promise from the `researching` Map directly — a single hung/crashed research agent stalls the whole pipeline **forever** (implementation_notes.md §4, delta_impact.md §R1). The deadline lets the queue give up waiting after `RESEARCH_TIMEOUT` (default 300s) and signal abandonment so the orchestrator can re-research synchronously.
- **JS reality**: JS promises **cannot be cancelled** — abandonment means "stop waiting," NOT "abort the generation." The abandoned background work keeps running; we simply ignore whatever it eventually produces for that taskId (contract §1, implementation_notes.md §4).
- **Scope boundary**: This subtask ships **only the queue-layer deadline + abandonment API**. It does NOT touch the orchestrator's synchronous-fallback logic (that is S3, 2 pts) or the config constant (S1, already merged). It produces the exact API S3 will consume: `waitForPRP` throwing `ResearchTimeoutError` + `isAbandoned(taskId)` + `getPRP(taskId)` cache semantics.
- **Scope cohesion**: S1 (config) is done; S2 (this) is the queue layer; S3 (orchestrator) consumes S2's outputs. Keeping this subtask to the queue layer prevents collision with the in-parallel S1 work and leaves a clean seam for S3.

## What

### User-visible behavior

None directly — this is an internal core-layer resilience change. The observable effect is that `ResearchQueue.waitForPRP` becomes deadline-bounded: it either resolves with a `PRPDocument` (unchanged shape) or rejects with a typed `ResearchTimeoutError` once `getResearchTimeoutSeconds()` elapses, after which the task is marked abandoned and any late background result is ignored.

### Technical requirements (the CONTRACT)

1. **Typed-error approach** (NOT discriminated result). `waitForPRP`'s **success return type stays `Promise<PRPDocument>`** so existing happy-path callers/tests are unaffected. Only the **timeout** path is new: record abandonment + `throw new ResearchTimeoutError(...)`. (See `research/design-decisions.md` §1 for the rationale; the item description explicitly endorses this option.)
2. **Deadline source**: `getResearchTimeoutSeconds()` from `src/config/constants.ts` (S1). Multiply by 1000 for ms. Call it at `waitForPRP` invocation time (reads `process.env[RESEARCH_TIMEOUT]` live).
3. **Race**: `Promise.race([inFlight, deadlinePromise])` where `deadlinePromise` resolves to a unique `DEADLINE_SENTINEL` symbol after the deadline. On sentinel win: `this.abandoned.add(taskId)` then `throw new ResearchTimeoutError(taskId, getResearchTimeoutSeconds())`. On `inFlight` win: return the PRP (unchanged). On `inFlight` reject: propagate (unchanged — real generation errors still surface). The deadline `setTimeout` MUST be `clearTimeout`-ed in a `finally` (no leaked timer; see `research/design-decisions.md` §4).
4. **No cancellation.** Abandonment does NOT remove the task from `researching` (generation is still running). `processNext`'s `.finally()` removes it from `researching` when generation eventually completes/rejects. `abandoned` persists for the queue's lifetime (cheap, harmless, enables late-result dedup).
5. **Late-result dedup (contract c)**: in `processNext`'s `.then()` cache step, if `this.abandoned.has(task.id)`, skip `this.results.set(...)` (ignore the late result) and debug-log. This is the ONLY behavioral change to `processNext`.
6. **Unknown-task path unchanged**: `waitForPRP(unknownTaskId)` still throws the plain `Error('No PRP available for task ...')` (unknown ≠ abandoned). The cache-hit path (`results.get(taskId)`) returns immediately and is unchanged.
7. **TDD**: write the failing tests first, then implement.
8. **Mode A docs**: JSDoc on every new symbol (`ResearchTimeoutError`, `abandoned`, `isAbandoned`, the rewritten `waitForPRP`). No standalone docs subtask.

### Success Criteria

- [ ] `ResearchTimeoutError` is exported from `src/core/research-queue.ts` (and re-exported from `src/core/index.ts`), `extends Error`, sets `this.name = 'ResearchTimeoutError'`, carries `public readonly taskId: string` + `public readonly timeoutSeconds: number`.
- [ ] `ResearchQueue` exposes `readonly abandoned: Set<string>` and `isAbandoned(taskId: string): boolean`.
- [ ] `waitForPRP(taskId)` resolves with the `PRPDocument` when generation completes under the deadline (existing behavior preserved; existing happy-path tests stay green with no assertion edits).
- [ ] `waitForPRP(taskId)` rejects with `ResearchTimeoutError` once `getResearchTimeoutSeconds()` elapses, AND `isAbandoned(taskId)` becomes `true`.
- [ ] After abandonment, a late background result for that taskId is NOT cached (`getPRP(taskId) === null`).
- [ ] `waitForPRP(unknownTaskId)` still throws the existing plain `Error('No PRP available ...')`.
- [ ] `npm run validate` passes (zero errors).
- [ ] `npm run test:run` passes (all green, incl. new abandonment tests AND existing happy-path tests unchanged).

## All Needed Context

### Context Completeness Check

_Pass_: An agent with zero codebase knowledge can implement this from (a) the full current `waitForPRP`/`processNext` bodies (quoted below), (b) the `PRPGenerationError` error-class precedent (quoted below), (c) the exact test-mock pattern (quoted below), (d) the `getResearchTimeoutSeconds()` reader (S1, already merged — quoted below), and (e) the verified `Promise.race`-no-unhandled-rejection analysis (`research/design-decisions.md` §3). No inference required.

### Documentation & References

```yaml
# MUST READ — the file being modified (the WHOLE public surface + the two methods to change)
- file: src/core/research-queue.ts
  why: This is the target file. `waitForPRP` (lines ~236-260) awaits the in-flight promise directly with NO timeout; `processNext` (lines ~135-208) builds the chained promise stored in `researching` and caches results in `results`.
  pattern: |
    # waitForPRP TODAY (no timeout — the thing to fix):
    async waitForPRP(taskId: string): Promise<PRPDocument> {
      const cached = this.results.get(taskId);
      if (cached) return cached;
      const inFlight = this.researching.get(taskId);
      if (inFlight) return inFlight;                 // <-- hangs forever if generate() hangs
      throw new Error(`No PRP available for task ${taskId}. ...`);
    }
    # processNext's .then() cache step (the ONE place to guard for late-result dedup):
    #   .then(prp => { this.results.set(task.id, prp); return prp; })
  gotcha: Public fields are `researching: Map<string, Promise<PRPDocument>>` and `results: Map<string, PRPDocument>` — both already `readonly ... = new Map()`. Mirror that exact shape for `abandoned: Set<string>`. The PRPGenerator is held privately as `#prpGenerator`; do NOT expose it (S3 re-researches via its own PRPGenerator, not via the queue).

# MUST READ — the error-class precedent to CLONE for ResearchTimeoutError
- file: src/agents/prp-generator.ts
  why: `PRPGenerationError` (line 42) is the canonical domain-error shape: `extends Error`, `public readonly` ctor params, `super(message)`, `this.name = 'ClassName'`, full JSDoc with `@remarks`/`@param`/`@example`.
  section: "PRPGenerationError class (lines ~38-65)"
  pattern: |
    export class PRPGenerationError extends Error {
      constructor(
        public readonly taskId: string,
        public readonly attempt: number,
        originalError: unknown,
      ) {
        super(`Failed to generate PRP for ${taskId} after ${attempt} attempts: ${...}`);
        this.name = 'PRPGenerationError';
      }
    }

# MUST READ — the S1 reader being consumed (ALREADY MERGED — treat as a hard contract)
- file: src/config/constants.ts
  why: `getResearchTimeoutSeconds()` reads `process.env[RESEARCH_TIMEOUT]` live and GUARDS non-positive/NaN → returns 300. So the test CANNOT stub `'0'` (it yields 300s); use a small POSITIVE value + fake timers. See gotcha below.
  section: "getResearchTimeoutSeconds() (already in file, end of file)"
  pattern: |
    export const RESEARCH_TIMEOUT = 'RESEARCH_TIMEOUT';
    export const DEFAULT_RESEARCH_TIMEOUT_SECONDS = 300;
    export function getResearchTimeoutSeconds(): number {
      const raw = Number(process.env[RESEARCH_TIMEOUT] ?? DEFAULT_RESEARCH_TIMEOUT_SECONDS);
      if (Number.isNaN(raw) || raw <= 0) return DEFAULT_RESEARCH_TIMEOUT_SECONDS;
      return raw;
    }

# MUST READ — the test file being extended (mock pattern + describe structure)
- file: tests/unit/core/research-queue.test.ts
  why: Module-level `vi.mock('../../../src/agents/prp-generator.js', () => ({ PRPGenerator: vi.fn() }))`; `MockPRPGenerator.mockImplementation(() => ({ generate: mockGenerate }))`; `beforeEach(() => vi.clearAllMocks())`. Existing `describe('waitForPRP', ...)` (line ~1193) has the happy-path tests that MUST stay green. Imports today: `import { describe, expect, it, vi, beforeEach } from 'vitest';` — must ADD `afterEach`.
  pattern: |
    # Module-level (top of file, already present):
    vi.mock('../../../src/agents/prp-generator.js', () => ({ PRPGenerator: vi.fn() }));
    import { PRPGenerator } from '../../../src/agents/prp-generator.js';
    const MockPRPGenerator = PRPGenerator as any;
    # Per-test (clone this for the new abandonment tests; swap in a controllable promise):
    const mockGenerate = vi.fn().mockImplementation(() => new Promise<PRPDocument>(() => {})); // never resolves
    MockPRPGenerator.mockImplementation(() => ({ generate: mockGenerate }));
  gotcha: |
    - Fake timers + the deferred-promise pattern are needed for deterministic late-result tests (see Implementation Tasks Task 1).
    - The existing top-level `beforeEach(vi.clearAllMocks)` runs before nested beforeEach; enable `vi.useFakeTimers()` in the NEW describe's beforeEach and `vi.useRealTimers()` in its afterEach.

# MUST READ — the orchestrator consumer (S3 target — DO NOT modify here, but design the API for it)
- file: src/core/task-orchestrator.ts
  why: `executeSubtask` (line ~639) currently consumes ONLY `this.researchQueue.getPRP(subtask.id)` (cache) — it does NOT call `waitForPRP` today. S3 will be the FIRST caller of the timeout behavior. Confirms changing `waitForPRP`'s success return type is safe (no current src caller breaks). See grep result: `waitForPRP` has ZERO callers in src/ outside research-queue.ts.
  section: "executeSubtask (~line 639-680): getPRP cache check"

# MUST READ — the design rationale (written for this subtask)
- file: plan/005_d32a2ecf61cd/P5M1T1S2/research/design-decisions.md
  why: §1 (why typed-error, not discriminated-result), §2 (the `'0'` stub gotcha), §3 (verified Promise.race does NOT leak an unhandled rejection), §4 (clearTimeout), §5 (scope boundary), §6 (conventions). Read before implementing.

# REFERENCE — architecture notes (respect boundaries)
- file: plan/005_d32a2ecf61cd/architecture/implementation_notes.md
  why: §4 confirms exactly this design ("abandonment needs a state; orchestrator re-researches synchronously; abandoned background result ignored via results Map dedup"). §10/§11 confirm validation gates + Groundswell is read-only.
  section: "§4 waitForPRP", "§10 validation gates"
- file: plan/005_d32a2ecf61cd/architecture/delta_impact.md
  why: §R1 enumerates the exact current `ResearchQueue` surface and what must change. Confirms "No timeout. No polling. No abandonment state." today, and lists the test files touched.
  section: "R1"
```

### Current Codebase tree (relevant slice)

```bash
src/core/
├── research-queue.ts     # <-- EDIT: + ResearchTimeoutError, + abandoned Set, + isAbandoned(), rewrite waitForPRP, guard processNext .then()
├── index.ts              # <-- EDIT: re-export ResearchTimeoutError alongside ResearchQueue
├── models.ts             # PRPDocument interface (line 1236) — IMPORTED, not modified
└── task-orchestrator.ts  # S3 territory — DO NOT TOUCH (getPRP consumer; no waitForPRP call today)

src/config/
└── constants.ts          # S1 output (ALREADY MERGED) — getResearchTimeoutSeconds() to IMPORT, not modify

src/agents/
└── prp-generator.ts      # REFERENCE: PRPGenerationError shape to clone

tests/unit/core/
└── research-queue.test.ts  # <-- EDIT: + afterEach import; + new 'deadline & abandonment' describe block

tests/integration/core/
└── research-queue.test.ts  # VERIFY stays green (success path unchanged) — only adjust if a test hits the new path
```

### Desired Codebase tree with files to be added/modified

```bash
src/core/
└── research-queue.ts     # MODIFIED: deadline-guarded waitForPRP + abandonment state + ResearchTimeoutError
src/core/
└── index.ts              # MODIFIED: re-export ResearchTimeoutError
tests/unit/core/
└── research-queue.test.ts  # MODIFIED: + deadline & abandonment tests (fake timers + deferred promise)
```

> **No new files.** This subtask edits two src files (research-queue.ts, index.ts) and extends one test file. A new error CLASS is added *inside* research-queue.ts (co-located, matching the `PRPGenerationError`-in-prp-generator.ts precedent) — do NOT create a separate errors module.

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL: S1's getResearchTimeoutSeconds() GUARDS non-positive values → returns 300.
//   vi.stubEnv(RESEARCH_TIMEOUT, '0') yields 300s, NOT 0. The item description's
//   "'0'/'1'" suggestion is WRONG for '0'. Use a small POSITIVE value (e.g. '5') and
//   FAKE TIMERS to advance past it deterministically. Do NOT rely on a real 5s sleep.
//   (research/design-decisions.md §2)

// CRITICAL: TS ESM source uses `.js` import specifiers even in .ts files.
//   WRONG: import { ResearchQueue } from '../core/research-queue';
//   RIGHT: import { ResearchQueue } from '../core/research-queue.js';
//   (tsconfig "moduleResolution" maps .js→.ts; tsc + vitest both resolve it.)

// CRITICAL: JS promises CANNOT be cancelled. Abandonment = "stop waiting", NOT "abort".
//   Do NOT try to abort/abort-signal the in-flight prpGenerator.generate(). The abandoned
//   promise keeps running; you merely (a) stop awaiting it and (b) ignore its late result.
//   (implementation_notes.md §4)

// VERIFIED: Promise.race([inFlight, deadline]) does NOT leak an unhandled rejection when
//   the deadline wins and inFlight later rejects. race attaches a reject-handler to inFlight;
//   processNext's own .catch logs the late failure. So NO special swallow is needed in the
//   rejection path. The ONLY processNext change is the .then() cache guard for late RESOLVED
//   results of abandoned tasks. (research/design-decisions.md §3)

// GOTCHA: clearTimeout the deadline timer in a finally{} — otherwise a fired-after-win timer
//   lingers and can trip fake-timer / open-handle assertions in tests.

// GOTCHA: vi.stubEnv + vi.useFakeTimers MUST be torn down. Pair every beforeEach that sets
//   them with an afterEach that calls vi.useRealTimers() + vi.unstubAllEnvs(), or they leak
//   into sibling describe blocks (the rest of research-queue.test.ts uses REAL timers).

// GOTCHA: vi.advanceTimersByTimeAsync (not the sync variant) flushes queued microtasks/promises,
//   which is required for Promise.race + the deferred-generate pattern to settle under fake timers.

// GOTCHA: eslint requires @returns JSDoc on exported functions with return annotations, and
//   @param/@remarks on exported classes. Clone PRPGenerationError's JSDoc style verbatim.
```

## Implementation Blueprint

### Data models and structure

No new persistence/ORM models. The new "models" are a typed error class, a `Set` field, and a discriminated sentinel symbol.

```typescript
// === NEW: typed abandonment error (clone PRPGenerationError shape) ===
export class ResearchTimeoutError extends Error {
  constructor(
    public readonly taskId: string,
    public readonly timeoutSeconds: number,
  ) {
    super(
      `Background research for ${taskId} exceeded the ${timeoutSeconds}s ` +
        `RESEARCH_TIMEOUT deadline and was abandoned.`,
    );
    this.name = 'ResearchTimeoutError';
  }
}

// === NEW: module-private sentinel so the deadline win is unambiguous vs. a PRPDocument ===
const DEADLINE_SENTINEL: unique symbol = Symbol('ResearchQueue.deadline');

// === NEW: abandonment state on the class (mirrors the readonly Map fields) ===
//   (inside class ResearchQueue:)
readonly abandoned: Set<string> = new Set();

isAbandoned(taskId: string): boolean {
  return this.abandoned.has(taskId);
}
```

### Implementation Tasks (ordered by dependencies — strict TDD)

```yaml
Task 1: WRITE tests in tests/unit/core/research-queue.test.ts  (FAILING-FIRST — do this before Task 2)
  - ADD `afterEach` to the vitest import line (top of file): `import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';`
  - ADD a new nested describe inside the existing `describe('waitForPRP', ...)`
      (or as a sibling `describe('waitForPRP deadline & abandonment', ...)` — sibling is cleaner
       since it needs fake timers): `describe('waitForPRP deadline & abandonment', () => {...})`.
  - BEFORE/AFTER for the NEW describe only:
      beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        vi.stubEnv(RESEARCH_TIMEOUT, '5');   // 5s deadline; POSITIVE (S1 guards <=0 → 300)
      });
      afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllEnvs();
      });
    IMPORT the constants + the (not-yet-existing) error at top of file:
      import { RESEARCH_TIMEOUT } from '../../../src/config/constants.js';
      import { ResearchTimeoutError } from '../../../src/core/research-queue.js';   // fails to resolve until Task 2 → RED
  - IMPLEMENT these cases (use the deferred-promise pattern for late-result control):
      (a) resolves normally when under deadline:
          mockGenerate resolves after a fake delay: vi.fn().mockImplementation(() => new Promise<PRPDocument>(r => setTimeout(() => r(expectedPRP), 1000)));
          enqueue(task); const p = queue.waitForPRP(id); vi.advanceTimersByTimeAsync(1000); const prp = await p;
          expect(prp).toEqual(expectedPRP); expect(queue.isAbandoned(id)).toBe(false);
      (b) abandons after timeout:
          mockGenerate NEVER resolves: vi.fn().mockImplementation(() => new Promise<PRPDocument>(() => {}));
          enqueue(task); const p = queue.waitForPRP(id); vi.advanceTimersByTimeAsync(5_000); // past the 5s deadline
          await expect(p).rejects.toThrow(ResearchTimeoutError); await expect(p).rejects.toThrow(/exceeded the 5s/);
          expect(queue.isAbandoned(id)).toBe(true);
      (c) abandoned late result is ignored (not cached):
          deferred: let resolveGen; const gen = new Promise<PRPDocument>(r => { resolveGen = r; });
          mockGenerate = vi.fn().mockReturnValue(gen);
          enqueue(task); const p = queue.waitForPRP(id); vi.advanceTimersByTimeAsync(5_000);
          await expect(p).rejects.toThrow(ResearchTimeoutError);          // abandoned
          resolveGen(expectedPRP); await vi.advanceTimersByTimeAsync(0);  // let the late result land (flush microtasks)
          expect(queue.getPRP(id)).toBeNull();                            // NOT cached (dedup)
          expect(queue.isAbandoned(id)).toBe(true);
      (d) getPRP still returns cache for a task that completed (non-abandoned):
          mockGenerate resolves fast; enqueue + advance past its 1s resolve; await waitForPRP(id);
          expect(queue.getPRP(id)).toEqual(expectedPRP); expect(queue.isAbandoned(id)).toBe(false);
      (e) late background FAILURE on an abandoned task does not surface (no unhandled rejection, still abandoned):
          deferred-reject: let rejectGen; const gen = new Promise<PRPDocument>((_, rej) => { rejectGen = rej; });
          mockGenerate = vi.fn().mockReturnValue(gen);
          enqueue(task); const p = queue.waitForPRP(id); vi.advanceTimersByTimeAsync(5_000);
          await expect(p).rejects.toThrow(ResearchTimeoutError);
          rejectGen(new Error('late gen boom')); await vi.advanceTimersByTimeAsync(0); // flush
          // processNext's .catch logs the late failure (warn-level); no throw escapes here:
          expect(queue.isAbandoned(id)).toBe(true); expect(queue.getPRP(id)).toBeNull();
      (f) isAbandoned returns false for a never-abandoned/unknown task:
          expect(queue.isAbandoned('P1.M1.T1.S999')).toBe(false);
  - FOLLOW pattern: the existing `waitForPRP` describe (line ~1193) for session-mock setup +
      MockPRPGenerator.mockImplementation(() => ({ generate: mockGenerate })) + the SETUP/EXECUTE/VERIFY comment rhythm.
  - MOCKING: NO network. The module-level `vi.mock('../../../src/agents/prp-generator.js')` already
      replaces PRPGenerator; you only control `generate` via mockGenerate. Do NOT hit the network.
  - VERIFY IT FAILS FIRST (RED): run `npm run test:run -- research-queue` BEFORE Task 2 — it must fail
      (ResearchTimeoutError / isAbandoned not exported; waitForPRP still hangs the never-resolving case).
      NOTE: the never-resolving (b) case may HANG the runner under real timers pre-implementation; that's
      why fake timers are mandatory. If RED hangs, that itself confirms the bug being fixed.
  - PLACEMENT: tests/unit/core/research-queue.test.ts (extend in place; do not create a new file).

Task 2: MODIFY src/core/research-queue.ts  (makes Task 1 GREEN — implement the contract)
  - STEP 2a: ADD the import of the deadline reader near the top imports:
        import { getResearchTimeoutSeconds } from '../config/constants.js';
  - STEP 2b: ADD the ResearchTimeoutError class (exported) ABOVE `export class ResearchQueue`
      (clone PRPGenerationError's shape: extends Error, public readonly taskId + timeoutSeconds,
       super(message), this.name='ResearchTimeoutError', full JSDoc with @remarks/@param/@example).
      See "Data models and structure" above for the exact body.
  - STEP 2c: ADD the module-private sentinel (above the class): `const DEADLINE_SENTINEL: unique symbol = Symbol('ResearchQueue.deadline');`
  - STEP 2d: ADD the abandonment field + probe INSIDE class ResearchQueue (near the other readonly fields):
        /** Task IDs whose background research exceeded the RESEARCH_TIMEOUT deadline (PRD §4.2). */
        readonly abandoned: Set<string> = new Set();
        /** @returns true iff waitForPRP previously timed out (abandoned) for taskId (PRD §4.2). */
        isAbandoned(taskId: string): boolean { return this.abandoned.has(taskId); }
  - STEP 2e: REWRITE waitForPRP to race the deadline (keep success return type Promise<PRPDocument>):
        async waitForPRP(taskId: string): Promise<PRPDocument> {
          // cache hit (unchanged)
          const cached = this.results.get(taskId);
          if (cached) return cached;
          // in-flight → race against the deadline
          const inFlight = this.researching.get(taskId);
          if (inFlight) {
            const deadlineMs = getResearchTimeoutSeconds() * 1000;
            let timer: ReturnType<typeof setTimeout> | undefined;
            const deadline = new Promise<typeof DEADLINE_SENTINEL>(resolve => {
              timer = setTimeout(() => resolve(DEADLINE_SENTINEL), deadlineMs);
            });
            try {
              const winner = await Promise.race([inFlight, deadline]);
              if (winner === DEADLINE_SENTINEL) {
                this.abandoned.add(taskId);                       // record abandonment (contract b)
                throw new ResearchTimeoutError(taskId, getResearchTimeoutSeconds());
              }
              return winner;                                      // PRPDocument (inFlight won)
            } finally {
              if (timer) clearTimeout(timer);                     // no leaked timer (gotcha §4)
            }
          }
          // unknown (unchanged)
          throw new Error(`No PRP available for task ${taskId}. ` +
            `Task may not have been enqueued or generation failed.`);
        }
  - STEP 2f: GUARD processNext's .then() cache step for abandoned tasks (contract c — dedup):
        .then(prp => {
          if (this.abandoned.has(task.id)) {
            this.#logger.debug({ taskId: task.id }, 'Ignoring late PRP result for abandoned task');
            return prp;                  // do NOT cache
          }
          this.results.set(task.id, prp);
          return prp;
        })
      (Leave the existing .catch and .finally exactly as-is — no swallow needed; see design-decisions §3.)
  - STEP 2g: UPDATE JSDoc on waitForPRP to document the deadline + abandonment contract (PRD §4.2):
        @throws {ResearchTimeoutError} If generation does not complete within getResearchTimeoutSeconds() (abandoned; isAbandoned(taskId) becomes true).
      Keep the existing `@throws {Error}` for the unknown-task case.
  - FOLLOW pattern: the existing waitForPRP/processNext bodies (minimal diff — only the additions above).
  - NAMING: ResearchTimeoutError (PascalCase), abandoned/isAbandoned (camelCase), DEADLINE_SENTINEL (SCREAMING_SNAKE).
  - DEPENDENCIES: `getResearchTimeoutSeconds` from S1 (already merged). `PRPDocument` already imported.
  - PLACEMENT: src/core/research-queue.ts (in place).

Task 3: MODIFY src/core/index.ts  (re-export the new error for S3's `instanceof` catch)
  - FIND the existing line: `export { ResearchQueue } from './research-queue.js';`
  - CHANGE it to: `export { ResearchQueue, ResearchTimeoutError } from './research-queue.js';`
  - GOTCHA: Do not move/remove other exports; just extend this one line.

Task 4: VERIFY (validation gates — run after Task 2 and Task 3)
  - RUN: `npm run validate`  (eslint . --ext .ts + prettier --check + tsc --noEmit) — expect ZERO errors.
      If eslint flags missing @returns/@param, complete the JSDoc (clone PRPGenerationError's).
  - RUN: `npm run test:run`  (vitest run) — expect ALL green, incl. the 6 new cases AND the existing
      happy-path waitForPRP tests (unchanged) AND the rest of research-queue.test.ts.
  - RUN the integration test to confirm no regression: `npm run test:run -- tests/integration/core/research-queue.test.ts`
      (success path is unchanged; it should stay green. Only adjust if it hits the new code path.)
  - GREP-VERIFY scope: `git diff --stat` shows ONLY src/core/research-queue.ts, src/core/index.ts,
      tests/unit/core/research-queue.test.ts changed (+ the RED-then-GREEN test run).
```

### Implementation Patterns & Key Details

```typescript
// === PATTERN: the rewritten waitForPRP (the core change) ===
// Success return type is UNCHANGED (Promise<PRPDocument>). Only the timeout branch is new.
// The deadline timer is cleared in `finally` (no leak). Abandonment is recorded BEFORE throwing
// so isAbandoned(taskId) is true the moment the caller catches ResearchTimeoutError.

async waitForPRP(taskId: string): Promise<PRPDocument> {
  const cached = this.results.get(taskId);
  if (cached) return cached;                       // unchanged: cache hit

  const inFlight = this.researching.get(taskId);
  if (inFlight) {
    const deadlineMs = getResearchTimeoutSeconds() * 1000;   // S1 reader, live env read
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<typeof DEADLINE_SENTINEL>(resolve => {
      timer = setTimeout(() => resolve(DEADLINE_SENTINEL), deadlineMs);
    });
    try {
      const winner = await Promise.race([inFlight, deadline]);
      if (winner === DEADLINE_SENTINEL) {                      // deadline won
        this.abandoned.add(taskId);                            // (contract b) record abandonment
        throw new ResearchTimeoutError(taskId, getResearchTimeoutSeconds());
      }
      return winner;                                           // inFlight won → PRPDocument
    } finally {
      if (timer) clearTimeout(timer);                          // (gotcha) no leaked timer
    }
  }

  throw new Error(                                              // unchanged: unknown task
    `No PRP available for task ${taskId}. ` +
      `Task may not have been enqueued or generation failed.`,
  );
}

// === PATTERN: the ONE processNext change (late-result dedup, contract c) ===
// Only the .then() cache step gains an abandonment guard. .catch/.finally are UNTOUCHED.
.then(prp => {
  if (this.abandoned.has(task.id)) {
    this.#logger.debug({ taskId: task.id }, 'Ignoring late PRP result for abandoned task');
    return prp;   // do NOT cache the stale background result
  }
  this.results.set(task.id, prp);
  return prp;
})

// === PATTERN: the deferred-promise test helper (for deterministic late-result cases) ===
// Gives the test a handle to resolve/reject the mocked generate() AFTER abandonment.
let resolveGen!: (p: PRPDocument) => void;
const gen = new Promise<PRPDocument>(r => { resolveGen = r; });
const mockGenerate = vi.fn().mockReturnValue(gen);
// ... enqueue, advance fake timers past deadline → ResearchTimeoutError → resolveGen(prp) → flush
```

### Integration Points

```yaml
CONFIG (consumed, NOT modified — S1 owns it):
  - source: src/config/constants.ts (already merged)
  - consume: getResearchTimeoutSeconds() * 1000 inside waitForPRP

CORE API (the change — this subtask):
  - file: src/core/research-queue.ts
  - add:    class ResearchTimeoutError; field abandoned; method isAbandoned(taskId)
  - rewrite: waitForPRP (deadline race + abandonment)
  - guard:  processNext .then() cache step (skip abandoned)
  - file: src/core/index.ts
  - add:    re-export ResearchTimeoutError (extends the existing ResearchQueue export line)

NOT TOUCHED (scope guardrails):
  - src/config/constants.ts           # S1 (merged) — read only
  - src/core/task-orchestrator.ts     # S3 (synchronous fallback) — consumes this API, not modified here
  - docs/**                           # Mode A = JSDoc only; no standalone doc subtask (implementation_notes.md §9)
  - src/agents/prp-generator.ts       # REFERENCE only (PRPGenerationError shape to clone)

FUTURE CONSUMER (informational — S3 will do this, do NOT implement now):
  - try { const prp = await this.researchQueue.waitForPRP(subtask.id); /* use cached/awaited PRP */ }
    catch (err) {
      if (err instanceof ResearchTimeoutError) { /* abandoned → re-research synchronously inline */ }
      else { throw err; }                                         // real generation error
    }
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# After Task 2 (edit research-queue.ts) + Task 3 (edit index.ts):
npm run validate
# = eslint . --ext .ts && prettier --check && tsc --noEmit
# Expected: ZERO errors.
#   - eslint may flag missing JSDoc @returns/@param on the new exports → complete them (clone PRPGenerationError style).
#   - tsc must accept the `PRPDocument | typeof DEADLINE_SENTINEL` narrowing in the race.
#   - prettier may reflow the ResearchTimeoutError super() message string → run `npm run format` if --check fails.
```

### Level 2: Unit Tests (Component Validation)

```bash
# RED step (after Task 1, before Task 2) — MUST fail first (TDD):
npm run test:run -- research-queue
# Expected: failure (ResearchTimeoutError / isAbandoned not exported; the never-resolving (b) case
#           will only be reachable under fake timers, so pre-impl it may error on the missing symbol).
#           This confirms the new tests actually exercise new code.

# GREEN step (after Task 2 + Task 3):
npm run test:run -- research-queue
# Expected: ALL green — the 6 new deadline/abandonment cases AND every existing happy-path waitForPRP test
#           (unchanged assertion shapes) AND the constructor/enqueue/processNext/getPRP/getStats/clearCache/error suites.

# Integration regression check (success path unchanged → should stay green):
npm run test:run -- tests/integration/core/research-queue.test.ts
# Expected: green. If a case here asserts waitForPRP timeout behavior, update it; otherwise leave it.

# Full suite (confirm no fake-timer/env leak into siblings):
npm run test:run
# Expected: all green. If sibling core tests now hang or fail on time, `afterEach(vi.useRealTimers + vi.unstubAllEnvs)`
#           is missing or misplaced in the new describe block.
```

### Level 3: Integration Testing (System Validation)

```bash
# Smoke-check the deadline end-to-end with a REAL (non-vitest) env + a stubbed timeout:
# (Spin a tiny harness that enqueues a never-resolving generate and confirms waitForPRP rejects fast.)
RESEARCH_TIMEOUT=1 node --input-type=module -e "
import('./src/core/research-queue.ts').catch(()=>{}); // ignore TS-loading in raw node; use the build:
"
# If the above is awkward with raw .ts, instead rely on the vitest suite (Level 2) which exercises the
# real getResearchTimeoutSeconds() integration under fake timers — that IS the integration validation.
# Alternatively, build first and run against dist/:
#   npm run build && RESEARCH_TIMEOUT=1 node --input-type=module -e "..."  (import from dist/research-queue.js)
# Expected (vitest path): waitForPRP rejects with ResearchTimeoutError after the deadline; isAbandoned===true.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Scope-guard regression check — confirm we did NOT over-reach into the orchestrator / constants / docs:
git diff --stat
# Expected: ONLY src/core/research-queue.ts, src/core/index.ts, tests/unit/core/research-queue.test.ts changed.

git diff src/config/constants.ts src/core/task-orchestrator.ts
# Expected: EMPTY (no changes — S1/S3 territory).

# Boundary check — confirm the new public surface exists and is typed:
node --input-type=module -e "import('./dist/core/index.js').then(m => {
  console.log(typeof m.ResearchTimeoutError, typeof m.ResearchQueue);
});"
# Expected: 'function' 'function'  (after `npm run build`)

# Resilience check — confirm a late-arriving result for an abandoned task does NOT populate the cache.
# (Covered by test case (c) in Level 2; this is the human-readable assertion of that contract.)

# Unhandled-rejection check — confirm the abandoned-then-late-failure path logs (warn) but does NOT throw
# out of the queue (covered by test case (e) in Level 2; run with vitest verbose to see the warn log).
npm run test:run -- research-queue --reporter=verbose 2>&1 | grep -i 'abandoned\|deadline'
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run validate` passes (eslint + prettier --check + tsc --noEmit, zero errors).
- [ ] `npm run test:run` passes (all green — new abandonment tests + existing happy-path tests unchanged).
- [ ] `tests/integration/core/research-queue.test.ts` verified green (or adjusted only if it hits the new path).
- [ ] RED step observed before GREEN (tests failed before implementation — TDD).

### Feature Validation

- [ ] `ResearchTimeoutError` exported from `src/core/research-queue.ts` AND `src/core/index.ts`; `extends Error`; `this.name === 'ResearchTimeoutError'`; carries `taskId` + `timeoutSeconds`.
- [ ] `ResearchQueue.abandoned: Set<string>` + `isAbandoned(taskId): boolean` present.
- [ ] `waitForPRP` resolves with `PRPDocument` under the deadline (existing happy-path tests unchanged & green).
- [ ] `waitForPRP` rejects with `ResearchTimeoutError` after `getResearchTimeoutSeconds()`, and `isAbandoned(taskId)` is `true`.
- [ ] A late background result for an abandoned taskId is NOT cached (`getPRP(taskId) === null`).
- [ ] A late background FAILURE for an abandoned taskId does not surface as an unhandled rejection (logged only).
- [ ] `waitForPRP(unknownTaskId)` still throws the plain `Error('No PRP available ...')` (unknown ≠ abandoned).
- [ ] No src caller of `waitForPRP` breaks (grep confirms zero non-test callers outside research-queue.ts).

### Code Quality Validation

- [ ] Follows the `PRPGenerationError` precedent exactly for `ResearchTimeoutError` (extends Error, `this.name`, full JSDoc).
- [ ] `abandoned` Set mirrors the existing `readonly researching/results` field shape.
- [ ] `clearTimeout` in a `finally` around the race (no leaked timer).
- [ ] `DEADLINE_SENTINEL` is a `unique symbol` (no collision risk with a PRPDocument).
- [ ] ESM import specifiers use `.js` extensions (incl. the new `getResearchTimeoutSeconds` import).
- [ ] `vi.useFakeTimers()`/`vi.stubEnv` paired with `vi.useRealTimers()`/`vi.unstubAllEnvs()` in the new describe's afterEach (no leak).
- [ ] File placement matches the desired tree (only research-queue.ts, index.ts, research-queue.test.ts touched).

### Documentation & Deployment

- [ ] JSDoc on `ResearchTimeoutError`, `abandoned`, `isAbandoned`, and the rewritten `waitForPRP` (Mode A — doc-with-work; no standalone doc subtask).
- [ ] `waitForPRP` JSDoc documents the deadline + abandonment + synchronous-fallback contract (PRD §4.2), including `@throws {ResearchTimeoutError}`.

---

## Anti-Patterns to Avoid

- ❌ Don't change `waitForPRP`'s success return type (no discriminated result) — that would churn the 5+ existing happy-path tests for no benefit; the typed-error approach is explicitly endorsed by the contract and item description.
- ❌ Don't try to CANCEL the in-flight promise on timeout — JS promises can't be cancelled; abandonment means "stop waiting + ignore late result," not "abort." (implementation_notes.md §4)
- ❌ Don't stub `RESEARCH_TIMEOUT='0'` expecting a fast timeout — S1's reader guards `<=0` and returns 300s. Use a small POSITIVE value (`'5'`) + fake timers. (design-decisions §2)
- ❌ Don't add a swallow/re-throw in `processNext`'s `.catch` for the abandonment case — `Promise.race` already prevents the unhandled rejection, and `.catch`'s existing log+rethrow is correct. Only the `.then()` cache step needs an abandonment guard. (design-decisions §3)
- ❌ Don't forget `clearTimeout(timer)` in a `finally` — a fired-after-win timer lingers and trips fake-timer/open-handle assertions.
- ❌ Don't write the implementation before the failing tests (breaks implicit-TDD; implementation_notes.md §7).
- ❌ Don't touch the orchestrator (`task-orchestrator.ts`) or constants (`constants.ts`) — that's S3 / S1 territory and will collide with the parallel/in-flight work.
- ❌ Don't create a standalone docs subtask or edit `docs/**` — Mode A = JSDoc only (implementation_notes.md §9).
- ❌ Don't use a generic sentinel (e.g. a plain object) for the deadline win — use a `unique symbol` so TS narrows `PRPDocument | typeof DEADLINE_SENTINEL` cleanly and there's zero collision risk.
- ❌ Don't use sync `vi.advanceTimersByTime` — use the `Async` variant so queued promise microtasks flush under fake timers.
- ❌ Don't remove the task from `researching` on abandonment — generation is still running; `processNext`'s `.finally()` owns that removal on completion.

---

## Success Metrics

**Confidence Score: 9/10** — This is a tightly-scoped, single-file (plus index re-export + test extension) change with: (a) an exact in-repo precedent for the error class (`PRPGenerationError`); (b) a confirmed-safe API change (zero non-test `waitForPRP` callers); (c) a verified `Promise.race`-no-unhandled-rejection analysis removing the main correctness risk; (d) the S1 reader already merged and its `'0'` gotcha documented; and (e) deterministic fake-timer tests with a deferred-promise helper for the late-result cases. Residual risks are low and caught by Level 1/2: a missing JSDoc field (eslint), a fake-timer/env leak into sibling tests (afterEach discipline), or a raw-`.ts` Level-3 smoke command needing `npm run build` first (Level 2's vitest path is the authoritative integration check). One-pass success is highly likely.
