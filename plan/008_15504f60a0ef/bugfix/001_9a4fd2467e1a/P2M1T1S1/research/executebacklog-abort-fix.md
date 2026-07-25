# Research — P2.M1.T1.S1: Move no-backlog check above try/catch + throw fatal error

> Bugfix 001, **Issue 5 (MINOR)**. The single `src/` change that makes a missing
> backlog abort the pipeline unconditionally (bypassing `isFatalError`, so it
> aborts even under `--continue-on-error`). Test reconciliation is **S2**.

---

## 1. The bug (confirmed control flow)

`executeBacklog()` at `src/workflows/prp-pipeline.ts` (~lines 1366–1620):
```ts
async executeBacklog(): Promise<void> {
  this.logger.info('[PRPPipeline] Executing backlog');
  if (this.skipExecutionLoop) { ...; return; }          // adopt-mode early-return (~1371-1383)
  try {
    const backlog = this.sessionManager.currentSession?.taskRegistry;   // ~1388
    if (!backlog) {
      throw new Error('Cannot execute pipeline: no backlog found in session');  // ~1391 — PLAIN Error
    }
    ... subtask-count check, progressTracker, execution loop ...
  } catch (error) {                                                       // ~1601
    if (isFatalError(error, this.#continueOnError)) { throw error; }     // ~1606
    this.#trackFailure('executeBacklog', error, { phase: this.currentPhase });  // ~1614
    ... (swallows non-fatal errors; resolves successfully) ...
  }
}
```
`isFatalError()` (`src/utils/errors.ts:835`): `if (continueOnError) return false;`
(override); then `if (!isPipelineError(error)) return false;` — a **plain `Error` is
NOT a `PipelineError`** → returns `false`. So the no-backlog throw is caught, tracked,
and **swallowed**; `executeBacklog()` resolves and the pipeline proceeds to
validation/QA with zero tasks. Worse: under `--continue-on-error`, `isFatalError`
returns `false` for EVERYTHING (override at ~842), so even a fatal error is swallowed.

## 2. The fix (contract + architecture recommendation — BOTH applied)

Move the backlog null-check + throw **ABOVE the try/catch** (between the
`skipExecutionLoop` early-return and the `try`), and throw a **fatal `SessionError`**
instead of a plain `Error`. Two layers of safety: (a) outside the try/catch →
propagates unconditionally regardless of `isFatalError`/`continueOnError`; (b)
`SessionError` → `code = PIPELINE_SESSION_LOAD_FAILED` → classified fatal by
`isFatalError` anyway (defense in depth if ever moved back inside a try).

```ts
async executeBacklog(): Promise<void> {
  this.logger.info('[PRPPipeline] Executing backlog');
  if (this.skipExecutionLoop) { ...; return; }

  // HARD ABORT — no backlog = misconfigured session; never useful to continue
  // (PRD §4.2/§5.1; bugfix Issue 5). Thrown ABOVE the try/catch so it propagates
  // unconditionally — bypassing isFatalError(), so it aborts even under --continue-on-error.
  const backlog = this.sessionManager.currentSession?.taskRegistry;
  if (!backlog) {
    throw new SessionError(
      'Cannot execute pipeline: no backlog found in session',
      { operation: 'executeBacklog' }
    );
  }

  try {
    // (const backlog declaration + null-check moved above)
    const totalSubtasks = this.#countTasks();
    if (totalSubtasks === 0) { ...; this.currentPhase = 'backlog_complete'; return; }
    this.#progressTracker = progressTracker({ backlog, logInterval: 5, barWidth: 40 });
    ... execution loop ...
  } catch (error) {
    if (isFatalError(error, this.#continueOnError)) { throw error; }
    this.#trackFailure('executeBacklog', error, { phase: this.currentPhase });
    ...
  }
}
```

### CRITICAL GOTCHA — `SessionError` constructor (the architecture doc's Option A snippet is subtly WRONG)
`src/utils/errors.ts:364`:
```ts
export class SessionError extends PipelineError {
  readonly code = ErrorCodes.PIPELINE_SESSION_LOAD_FAILED;   // ← HARDCODED; you CANNOT pass a code
  constructor(message: string, context?: PipelineErrorContext, cause?: Error) {
    super(message, context, cause);
    Object.setPrototypeOf(this, SessionError.prototype);
  }
}
```
The architecture `test_validation.md` "Option A" snippet shows
`new SessionError(msg, ErrorCodes.PIPELINE_SESSION_LOAD_FAILED, { operation: ... })` —
**that is WRONG**: the 2nd parameter is `context?: PipelineErrorContext`, NOT an
`ErrorCode`. Passing the code there is a type error / mis-type. The code is already
hardcoded to exactly the value we want (`LOAD_FAILED`). **Correct call:**
`new SessionError(message, { operation: 'executeBacklog' })` — 2 args, no code.

### In-file precedent (mirror this EXACTLY)
`src/workflows/prp-pipeline.ts:714` (already in this file — the empty-SESSION_DIR guard):
```ts
// ... Throws a fatal SessionError so the pipeline aborts (a plain Error is treated
// as non-fatal by isFatalError and would let execution continue into breakdown/validation).
if (!session.metadata.path || session.metadata.path.trim() === '') {
  throw new SessionError(
    'Session directory (SESSION_DIR) is empty; refusing to proceed ... (PRD §4.6)',
    { operation: 'initializeSession' }
  );
}
```
Same rationale ("plain Error is non-fatal → must use SessionError"), same 2-arg shape.
`SessionError` + `isFatalError` are ALREADY imported (prp-pipeline.ts:41-45). **No new import.**

## 3. Message string — MUST stay verbatim
The reject test asserts `rejects.toThrow('Cannot execute pipeline: no backlog found in session')`
(`toThrow(string)` = substring match on `error.message`). The new `SessionError` MUST carry
the EXACT same message: `'Cannot execute pipeline: no backlog found in session'`. Do NOT
rephrase, capitalize differently, or add punctuation — the substring match would still pass
for minor changes, but keeping it verbatim matches the existing reject-test expectation and
the original throw text.

## 4. Test impact analysis — and a CORRECTION to the architecture doc

`test_validation.md` "Issue 5 → Key: Update executeBacklog tests — INTERNAL
INCONSISTENCY FOUND" claims `prp-pipeline-progress.test.ts:799` ("handle missing
ProgressTracker gracefully") "currently has an empty backlog which triggers the
no-backlog abort" and will FAIL after the fix. **A direct read disproves this.**

The line-799 test (`describe('ProgressTracker optional chaining')` → `it('should
handle missing ProgressTracker gracefully')`, lines ~766–799) setup:
```ts
const backlog = createTestBacklog([
  createTestPhase('P1', 'Phase 1', 'Planned', [
    createTestMilestone('P1.M1', 'Milestone 1', 'Planned', [
      createTestTask('P1.M1.T1', 'Task 1', 'Planned', [
        createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Planned'),   // ← REAL, non-empty
      ]),
    ]),
  ]),
]);
const mockSession = createTestSession(backlog);
const mockManager = createMockSessionManager(mockSession);
...
await expect(pipeline.executeBacklog()).resolves.not.toThrow();
```
This session has a **non-empty** `taskRegistry` (P1.M1.T1.S1). After S1 the no-backlog
check does NOT fire (backlog is truthy); executeBacklog proceeds, `processNextItem`
returns `false` once, and it resolves. **S1 does NOT break this test.** The architecture
doc's "line 799 has an empty backlog" claim is a misread (it conflated this test's setup
with a different test's). 

### The ONLY behavioral change S1 makes
When `currentSession.taskRegistry` is `null`/`undefined`, `executeBacklog()` now THROWS
(`SessionError`) instead of resolving. Tests asserting this:

| Test (file:line) | taskRegistry | Current expectation | After S1 |
|---|---|---|---|
| `prp-pipeline-progress.test.ts:290-308` ("should throw error when backlog is not found in session") | **`null`** | `rejects.toThrow('...no backlog found in session')` | **RED → GREEN** (was failing because throw was swallowed; now propagates) ✅ |
| `prp-pipeline-progress.test.ts:~798` ("handle missing ProgressTracker gracefully") | real backlog (P1.M1.T1.S1) | `resolves.not.toThrow()` | **stays GREEN** (unaffected) |
| `prp-pipeline.test.ts:586` ("...Execution failed") | real backlog | `rejects.toThrow('Execution failed')` | stays GREEN (different path) |
| `prp-pipeline.test.ts:615` ("max iterations") | real backlog | `rejects.toThrow('Execution exceeded 10000 iterations')` | stays GREEN (different path) |
| `pipeline-main-loop.test.ts:958` (max iterations) | real backlog | `rejects.toThrow(/exceeded .* iterations/)` | stays GREEN (different path) |
| `pipeline-main-loop.test.ts:~965` ("handle no subtasks gracefully") | `{ backlog: [] }` (empty ARRAY, truthy) | resolves | stays GREEN (empty array ≠ no backlog; hits the `totalSubtasks===0` early-return at ~1395, not the abort) |

**Conclusion: S1 flips exactly ONE test (290-308) from RED → GREEN and breaks nothing.**
The empty-ARRAY case (`{ backlog: [] }`) is distinct from the no-backlog (null/undefined)
case — an empty array is truthy, so it falls through to the `totalSubtasks === 0`
early-return (line ~1395), which is INSIDE the try and unaffected.

### S1 vs S2 boundary
- **S1 (this PRP):** the `src/` change (move check above try/catch + `SessionError` + Mode-A JSDoc). Touches NO test files.
- **S2 ("Verify and update affected unit tests for the abort behavior"):** owns ALL test reconciliation. Per the analysis above, S1 breaks no test and FIXES 290-308; S2's job is to VERIFY this end-to-end and update any test whose expectation contradicts the new abort semantics (the architecture doc's line-799 concern is resolved by this research — that test has a real backlog — but S2 should confirm and reconcile any others).

## 5. The Mode-A JSDoc update (DOCS rides with the work)
The current `executeBacklog` JSDoc (~1350-1365) describes the iteration + graceful-shutdown
behavior. Add a remark documenting that a **missing backlog causes an unconditional abort**
(not subject to continue-on-error): the check is above the try/catch and throws a fatal
`SessionError(PIPELINE_SESSION_LOAD_FAILED)`. Reference bugfix Issue 5 / PRD §4.2 + §5.1.

## 6. Things explicitly OUT of S1's scope (hard boundaries)
- ANY test file (`prp-pipeline-progress.test.ts`, `prp-pipeline.test.ts`, `pipeline-main-loop.test.ts`, …) — **S2** owns all test reconciliation. S1 edits ONLY `src/workflows/prp-pipeline.ts`.
- The execution-loop body (subtask-count check, progressTracker, while loop, catch block) — unchanged. Only the backlog null-check MOVES (above the try) and the throw changes type (`Error` → `SessionError`).
- `isFatalError`, `SessionError`, `ErrorCodes`, `errors.ts` — NOT modified (reused as-is). `SessionError`'s hardcoded code is exactly what we need.
- Other `isFatalError(...)` call sites in prp-pipeline.ts (775, 1172, 1333, 1963) — untouched (those guard other methods: decomposePRD, runQACycle, etc.).
- The `skipExecutionLoop` adopt-mode guard (~1371-1383) — stays where it is; the moved check goes BETWEEN it and the `try`.
- `.env.example`, any `docs/*.md` — Mode A = JSDoc only; no `.md` edits.
- Issue 3 (the 297 pre-existing red tests) — P2.M2/P2.M3 scope; NOT S1. Do not gate S1 on the full `npm run test:run`.

## 7. Exact edit anchors
`src/workflows/prp-pipeline.ts`:
- ~1386 (`try {`) — the moved check goes JUST ABOVE this line.
- ~1388-1393 (`const backlog = ...; if (!backlog) { throw new Error(...) }`) — MOVE the declaration+check above the try; CHANGE `throw new Error(...)` → `throw new SessionError('...', { operation: 'executeBacklog' })`. DELETE the original lines from inside the try.
- ~1350-1365 (executeBacklog JSDoc) — ADD the unconditional-abort remark (Mode A).
- Imports (41-45): `SessionError` ALREADY present — no import change.
- Catch block (~1601-1620): UNCHANGED.