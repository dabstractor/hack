# PRP — P2.M1.T1.S1: Move no-backlog check above try/catch and throw fatal error

---

## Goal

**Feature Goal**: Fix **bugfix Issue 5 (MINOR)** — `executeBacklog()` silently
swallows the "Cannot execute pipeline: no backlog found in session" throw because
it lives **inside** the method's try/catch, and `isFatalError()` returns `false`
for a plain `Error` (and returns `false` for *everything* under `--continue-on-error`).
The pipeline then proceeds to validation/QA over zero tasks. The fix: **move the
backlog null-check + throw ABOVE the try/catch** (so it propagates unconditionally,
bypassing `isFatalError` entirely) **and throw a fatal `SessionError`** instead of a
plain `Error` (defense in depth — `SessionError`'s hardcoded `PIPELINE_SESSION_LOAD_FAILED`
code is classified fatal by `isFatalError` if ever moved back inside a try).

**Deliverable** (single `src/` file edited — `src/workflows/prp-pipeline.ts`):
1. **MOVE** the `const backlog = this.sessionManager.currentSession?.taskRegistry;`
   declaration + `if (!backlog) { throw … }` block from **inside** the `try`
   (current ~lines 1388–1393) to **just above** the `try` (between the
   `skipExecutionLoop` adopt-mode early-return and the `try`).
2. **CHANGE** the throw from `throw new Error('Cannot execute pipeline: no backlog
   found in session')` to `throw new SessionError('Cannot execute pipeline: no backlog
   found in session', { operation: 'executeBacklog' })` (2-arg call — see Gotchas).
3. **Mode-A JSDoc** on `executeBacklog()` documenting that a missing backlog causes
   an **unconditional abort** (not subject to continue-on-error).
4. Leave the rest of `executeBacklog` (subtask-count check, progressTracker,
   execution loop, catch block) **unchanged**.

**Success Definition**:
- `executeBacklog()`, when `currentSession.taskRegistry` is `null`/`undefined`,
  THROWS a `SessionError` carrying message `'Cannot execute pipeline: no backlog
  found in session'` — and the throw propagates to the caller (it is NOT caught by
  the method's own try/catch). This holds even when `continueOnError === true`.
- The pre-existing reject test
  `tests/unit/workflows/prp-pipeline-progress.test.ts:290-308`
  ("should throw error when backlog is not found in session", `taskRegistry: null`)
  goes from **RED → GREEN**.
- No other executeBacklog test flips (verified: every other executeBacklog test
  has a real backlog or an empty-but-truthy `{ backlog: [] }` — see Context §4).
- `npm run typecheck && npm run lint && npm run format:check` clean. The full
  `npm run test:run` is NOT the gate (bugfix Issue 3 — 297 pre-existing red tests,
  P2.M2/P2.M3 scope).
- S1 edits ONLY `src/workflows/prp-pipeline.ts`. **No test files** (S2 owns test
  reconciliation).

---

## Why

- **State-integrity bug (PRD §4.2 execution loop, §5.1 state integrity).** A session
  with no backlog is a misconfiguration; running validation/QA over an empty task set
  is not useful and silently masks the problem. The bug-report (PRD §h2.3/§h3.4 Issue 5)
  says "prefer aborting."
- **`isFatalError` is the wrong gate for this case.** A plain `Error` is non-fatal, so
  the catch swallows it; and under `--continue-on-error` `isFatalError` returns `false`
  for *everything* (override at `errors.ts:~842`). Moving the check ABOVE the try/catch
  removes `isFatalError` from the propagation path entirely — the cleanest fix the
  architecture recommendation (`test_validation.md` Issue 5 → "Recommendation") and the
  contract both prescribe.
- **Foundational for S2.** S2 ("Verify and update affected unit tests for the abort
  behavior") consumes this exact source change: it reconciles tests against the new
  abort semantics. S1 must land the source behavior first (and, per Context §4, S1
  actually FIXES the one red reject test and breaks nothing — S2's job is verification +
  any remaining reconciliation).
- **Out of scope (hard boundaries):** any test file (S2), `errors.ts`/`isFatalError`/
  `SessionError`/`ErrorCodes` (reused as-is — `SessionError` already has the right
  hardcoded code), the execution-loop body + catch block (unchanged), other
  `isFatalError(...)` sites in the file (775/1172/1333/1963 — other methods), the
  `skipExecutionLoop` guard (stays), `.env.example`/any `docs/*.md` (Mode A = JSDoc only),
  and Issue 3's 297 pre-existing red tests (P2.M2/P2.M3).

---

## What

### User-visible behavior
A pipeline run whose session has no/empty-loaded backlog (`currentSession.taskRegistry`
is `null`/`undefined`) now **aborts** at `executeBacklog()` with a fatal
`SessionError('Cannot execute pipeline: no backlog found in session')` instead of
silently resolving and proceeding to validation/QA. This holds under `--continue-on-error`.

### Technical requirements (exact contract)

**`src/workflows/prp-pipeline.ts` — `executeBacklog()`** (~lines 1366–1620). Current
top-of-method shape:
```ts
async executeBacklog(): Promise<void> {
  this.logger.info('[PRPPipeline] Executing backlog');
  if (this.skipExecutionLoop) { ...; this.totalTasks=...; this.completedTasks=...; this.currentPhase='backlog_complete'; return; }
  try {
    const backlog = this.sessionManager.currentSession?.taskRegistry;   // ← MOVE UP
    if (!backlog) {
      throw new Error('Cannot execute pipeline: no backlog found in session');  // ← CHANGE TYPE + MOVE UP
    }
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
After S1:
```ts
async executeBacklog(): Promise<void> {
  this.logger.info('[PRPPipeline] Executing backlog');
  if (this.skipExecutionLoop) { ...; this.totalTasks=...; this.completedTasks=...; this.currentPhase='backlog_complete'; return; }

  // HARD ABORT — no backlog = misconfigured session; never useful to continue
  // (PRD §4.2/§5.1; bugfix Issue 5). Thrown ABOVE the try/catch so it propagates
  // unconditionally — bypassing isFatalError(), so it aborts even under
  // --continue-on-error. SessionError's hardcoded PIPELINE_SESSION_LOAD_FAILED code
  // is also classified fatal by isFatalError (defense in depth).
  const backlog = this.sessionManager.currentSession?.taskRegistry;
  if (!backlog) {
    throw new SessionError(
      'Cannot execute pipeline: no backlog found in session',
      { operation: 'executeBacklog' }
    );
  }

  try {
    // (backlog declaration + null-check moved above; backlog is narrowed to non-null here)
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

**Mode-A JSDoc** (~1350–1365) — add a remark documenting the unconditional abort:
```ts
/**
 * Execute backlog until complete
 *
 * @remarks
 * ...existing remarks...
 *
 * **Unconditional abort on missing backlog (PRD §4.2/§5.1; bugfix Issue 5).** If
 * `currentSession.taskRegistry` is absent, this method throws a fatal
 * {@link SessionError} (`PIPELINE_SESSION_LOAD_FAILED`) carrying the message
 * `'Cannot execute pipeline: no backlog found in session'`. The check lives ABOVE
 * the execution try/catch, so the throw propagates unconditionally — it is NOT
 * subject to `isFatalError()` and therefore NOT swallowed under `--continue-on-error`.
 * A missing backlog is a misconfigured session; running validation/QA over zero
 * tasks is not useful, so the pipeline aborts loudly.
 */
```

### Success Criteria
- [ ] `executeBacklog()` throws `SessionError` (message `'Cannot execute pipeline: no backlog found in session'`) when `currentSession.taskRegistry` is null/undefined, and the throw is OUTSIDE the try/catch (propagates unconditionally).
- [ ] The execution-loop body (subtask-count check, progressTracker, while loop) + catch block are byte-for-byte unchanged.
- [ ] The `skipExecutionLoop` adopt-mode guard stays above the moved check; the moved check sits between it and the `try`.
- [ ] `backlog` is declared once (above the try) and used inside the try (`progressTracker({ backlog, ... })`); no duplicate declaration.
- [ ] Mode-A JSDoc documents the unconditional abort.
- [ ] `npm run typecheck && npm run lint && npm run format:check` clean.
- [ ] `npx vitest run tests/unit/workflows/prp-pipeline-progress.test.ts` — the "should throw error when backlog is not found in session" it() (line ~290-308) is GREEN (was RED); no other it() in that file newly fails.
- [ ] ONLY `src/workflows/prp-pipeline.ts` is modified (no test files — S2 owns those).

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_
**Yes.** The exact before/after of the single method is given (§"Technical requirements").
The decisive facts are proven: `SessionError`'s constructor is `(message, context?, cause?)`
with a **hardcoded** `code = PIPELINE_SESSION_LOAD_FAILED` (so the call is 2-arg — the
architecture doc's 3-arg Option A snippet is WRONG and that's flagged); `SessionError` +
`isFatalError` are **already imported** (prp-pipeline.ts:41-45) so no import change; the
in-file precedent at line 714 (empty-SESSION_DIR guard) is an identical `SessionError`
throw with the same rationale; the message string MUST stay verbatim (the reject test
sub-string-matches it); and the test-impact analysis (Context §4) proves S1 fixes exactly
one red test and breaks nothing — including a CORRECTION of the architecture doc's
erroneous "line 799 has an empty backlog" claim.

### Documentation & References
```yaml
# MUST READ — the bug-report issue (the spec this implements)
- docfile: plan/008_15504f60a0ef/bugfix/001_9a4fd2467e1a/prd_snapshot.md
  section: "Minor Issues → Issue 5: executeBacklog swallows 'no backlog found' instead of aborting"
  why: States expected behavior (abort loudly), actual (swallow + proceed to validation/QA),
        and the suggested fix (fatal PipelineError subtype OR move above try/catch — "prefer aborting").

# MUST READ — this subtask's research (exact fix + SessionError gotcha + test-impact correction)
- docfile: plan/008_15504f60a0ef/bugfix/001_9a4fd2467e1a/P2M1T1S1/research/executebacklog-abort-fix.md
  section: "2. The fix", "CRITICAL GOTCHA — SessionError constructor", "4. Test impact analysis",
           "6. Things explicitly OUT of S1's scope", "7. Exact edit anchors"
  why: The verbatim before/after; WHY the architecture doc's Option A 3-arg SessionError call is WRONG
        (code is hardcoded → 2-arg call); the in-file precedent at line 714; the proof that S1 fixes
        exactly one red test (progress.test.ts:290-308) and breaks nothing (line 799 has a REAL backlog,
        not empty — corrects the architecture doc); the S1-vs-S2 boundary.

# MUST READ — the architecture finding (control flow + isFatalError classification)
- docfile: plan/008_15504f60a0ef/bugfix/001_9a4fd2467e1a/architecture/test_validation.md
  section: "Issue 5: executeBacklog Swallows 'no backlog found'" + "Recommendation"
  why: Confirms the swallow mechanism (plain Error → isFatalError false → catch swallows; continueOnError
        override → always false) and prescribes "move the check above the try/catch." NOTE: its "Option A"
        3-arg SessionError snippet is subtly WRONG (see research §2 gotcha) and its "line 799 has an empty
        backlog" claim is INCORRECT (see research §4) — both corrected in this PRP.

# THE FILE TO EDIT — exact current state + edit anchors
- file: src/workflows/prp-pipeline.ts
  why: EDIT executeBacklog() (~1366-1620): move the backlog null-check (1388-1393) ABOVE the try (~1386);
        change `throw new Error(...)` → `throw new SessionError('...', { operation: 'executeBacklog' })`;
        add the Mode-A JSDoc remark (~1350-1365). Catch block (1601-1620) + execution body UNCHANGED.
  pattern: "throw new SessionError('Session directory (SESSION_DIR) is empty; ...', { operation: 'initializeSession' })"  (line 714 — the in-file precedent; MIRROR this 2-arg shape)
  gotcha: SessionError's `code` is HARDCODED to PIPELINE_SESSION_LOAD_FAILED (errors.ts:365) — do NOT pass
          a code arg. Constructor is (message, context?, cause?). The 2nd arg is the context object.
          SessionError + isFatalError are ALREADY imported (41-45) — no import change.

# CONTRACT — SessionError + isFatalError (reused, NOT modified)
- file: src/utils/errors.ts
  why: SessionError class (364-381): hardcoded `code = PIPELINE_SESSION_LOAD_FAILED`; ctor (message, context?, cause?).
        isFatalError (835-886): `if (continueOnError) return false` (override); SessionError with LOAD_FAILED/SAVE_FAILED
        → fatal. Both confirm WHY moving above try/catch is needed (continueOnError override) AND that SessionError is
        the right fatal type (LOAD_FAILED = fatal). DO NOT edit this file.
  pattern: "export class SessionError extends PipelineError { readonly code = ErrorCodes.PIPELINE_SESSION_LOAD_FAILED; constructor(message: string, context?: PipelineErrorContext, cause?: Error) {...} }"
  gotcha: isFatalError returns false for a plain Error (not a PipelineError) AND returns false for everything when
          continueOnError===true. Both are why the no-backlog throw MUST be above the try/catch (not just a SessionError inside it).

# PATTERN FILE — test that S1 makes GREEN (S2 owns reconciliation, but S1 must not break it)
- file: tests/unit/workflows/prp-pipeline-progress.test.ts
  why: The "should throw error when backlog is not found in session" it() (~290-308) sets taskRegistry:null and
        asserts rejects.toThrow('Cannot execute pipeline: no backlog found in session'). It is CURRENTLY RED (throw
        swallowed). After S1 it is GREEN. S1 does NOT edit this file; running it PROVES the fix.
  pattern: "const mockSession: any = { metadata: { path: '/test' }, taskRegistry: null }; ... await expect(pipeline.executeBacklog()).rejects.toThrow('Cannot execute pipeline: no backlog found in session');"
  gotcha: The message string MUST stay verbatim — the test sub-string-matches error.message.

# CONSUMERS (read-only — proves non-breaking)
- file: tests/unit/workflows/prp-pipeline.test.ts
  why: it()s at 586 ('Execution failed') + 615 ('Execution exceeded 10000 iterations') reject on DIFFERENT messages
        with REAL backlogs — unaffected by S1. The 290-308 reject is the only no-backlog-path assertion.
- file: tests/integration/pipeline-main-loop.test.ts
  why: it() at 958 (max iterations, /exceeded .* iterations/) + ~965 ('handle no subtasks gracefully', empty ARRAY
        { backlog: [] }) — both unaffected (real backlog / truthy empty-array ≠ null taskRegistry).
```

### Current Codebase tree (relevant slice)
```bash
src/workflows/prp-pipeline.ts            # EDIT — executeBacklog(): move null-check above try + SessionError + JSDoc
src/utils/errors.ts                      # READ-ONLY — SessionError (hardcoded LOAD_FAILED) + isFatalError (reused)
tests/unit/workflows/prp-pipeline-progress.test.ts   # READ-ONLY (S2 owns); S1 makes its 290-308 it() go RED→GREEN
```

### Desired Codebase tree with files to be added/edited
```bash
src/workflows/prp-pipeline.ts            # MODIFIED (executeBacklog: moved check + SessionError + Mode-A JSDoc)
# (NO test files — S2 owns test reconciliation. NO errors.ts — reused as-is.)
```

### Known Gotchas of our codebase & Library Quirks
```ts
// CRITICAL — SessionError's `code` is HARDCODED (errors.ts:365: `readonly code = ErrorCodes.PIPELINE_SESSION_LOAD_FAILED`).
//   The constructor is (message, context?, cause?) — you CANNOT pass a code. The architecture doc's "Option A"
//   snippet `new SessionError(msg, ErrorCodes.PIPELINE_SESSION_LOAD_FAILED, {...})` is WRONG (passes the code as the
//   context arg). Correct call: `new SessionError('Cannot execute pipeline: no backlog found in session',
//   { operation: 'executeBacklog' })` — 2 args. Mirror the in-file precedent at prp-pipeline.ts:714.

// CRITICAL — the no-backlog throw MUST be ABOVE the try/catch, not just a SessionError inside it. isFatalError
//   returns false for EVERYTHING when continueOnError===true (override at errors.ts:~842), so even a fatal
//   SessionError would be swallowed under --continue-on-error if it were inside the try. Moving the check above
//   the try removes isFatalError from the propagation path entirely — the only way to abort unconditionally.

// CRITICAL — keep the message EXACTLY 'Cannot execute pipeline: no backlog found in session'. The reject test
//   (progress.test.ts:290-308) sub-string-matches error.message via toThrow(string). SessionError preserves the
//   passed message verbatim, so this matches — but do NOT rephrase it.

// GOTCHA — after moving `const backlog = ...` + `if (!backlog) { throw }` above the try, TypeScript narrows
//   `backlog` to non-undefined for the rest of the function (the throw guarantees it). So `progressTracker({ backlog,
//   ... })` inside the try still typechecks (backlog is Backlog, not Backlog|undefined). Declare backlog ONCE.

// GOTCHA — the empty-ARRAY case ({ backlog: [] }) is NOT the no-backlog case. An empty array is truthy, so it does
//   NOT trigger the abort — it falls through to the `totalSubtasks === 0` early-return (~1395, inside the try) and
//   resolves with currentPhase='backlog_complete'. S1 does not affect pipeline-main-loop.test.ts:~965.

// GOTCHA — do NOT touch the execution-loop body (subtask-count check, progressTracker init, while loop) or the
//   catch block (1601-1620). They are byte-for-byte unchanged. Only the backlog null-check MOVES and the throw
//   changes type. The catch still handles execution-loop errors via isFatalError + trackFailure as before.

// GOTCHA — other isFatalError(...) sites in this file (775 decomposePRD, 1172 runQACycle area, 1333 decomposePRD
//   catch, 1963 runQACycle) are OTHER methods — leave them. S1 touches ONLY executeBacklog's no-backlog check.

// CRITICAL — bugfix Issue 3: the FULL `npm run test:run` is PRE-EXISTING-RED (297 failures / 38 files — mock drift,
//   groundswell-link, over-strict schema — ALL P2.M2/P2.M3 scope, NOT S1). Do NOT use it as the gate. Gate =
//   typecheck + lint + format:check + the targeted progress.test.ts (which S1 makes greener, not redder).

// GOTCHA — 100% coverage is globally enforced (vitest.config.ts). The moved check's throw branch is exercised by
//   progress.test.ts:290-308 (taskRegistry:null → throws). S1 does not reduce coverage (the same branch, now
//   outside the try, is still covered). The SessionError constructor path was already covered by line 714's throw.

// GOTCHA — prettier is ERROR-enforced (format:check). Run `npm run fix` before validate.
```

---

## Implementation Blueprint

### Data models and structure
No new types. Reuses `SessionError` (already imported) and the existing
`PipelineErrorContext` shape (`{ operation: string }` is valid —
`PipelineErrorContext extends Record<string, unknown>`).

### Implementation Tasks (ordered by dependencies)
```yaml
Task 1: EDIT src/workflows/prp-pipeline.ts — move the no-backlog check above the try + change throw type
  - LOCATE executeBacklog() (~1366). Inside its try (~1386-1393) find:
        const backlog = this.sessionManager.currentSession?.taskRegistry;
        if (!backlog) {
          throw new Error('Cannot execute pipeline: no backlog found in session');
        }
  - MOVE those lines to JUST ABOVE the `try {` (i.e., immediately after the `skipExecutionLoop`
        early-return block that ends with `return;` at ~1383, and before the `try {` at ~1386).
  - CHANGE the throw: `throw new Error('...')` →
        throw new SessionError(
          'Cannot execute pipeline: no backlog found in session',
          { operation: 'executeBacklog' }
        );
    (2-arg call — SessionError's code is hardcoded; do NOT pass ErrorCodes. Mirror line 714.)
  - ADD a comment above the moved check documenting the HARD ABORT rationale (see "Technical requirements").
  - VERIFY the try body now starts at `const totalSubtasks = this.#countTasks();` (the subtask-count check)
        — i.e., the moved declaration is NOT duplicated inside the try. `backlog` is declared once, above the try,
        and `progressTracker({ backlog, ... })` inside the try still references it (narrowed to non-null).
  - DO NOT touch the execution-loop body, the catch block (1601-1620), other isFatalError sites, or skipExecutionLoop.
  - EXPECTED: typecheck GREEN (backlog narrows to Backlog after the throw; SessionError already imported).

Task 2: EDIT src/workflows/prp-pipeline.ts — Mode-A JSDoc on executeBacklog()
  - LOCATE the executeBacklog JSDoc (~1350-1365). ADD the "Unconditional abort on missing backlog" remark
        (see "Technical requirements" → Mode-A JSDoc) documenting: missing backlog → fatal SessionError
        (PIPELINE_SESSION_LOAD_FAILED); check is ABOVE the try/catch; NOT subject to isFatalError /
        continue-on-error; references PRD §4.2/§5.1 + bugfix Issue 5.
  - KEEP the existing @remarks (iteration, graceful shutdown) intact — APPEND, don't replace.
  - EXPECTED: docs build unaffected (typedoc --skipErrorSkipping); lint/format clean.

Task 3: FORMAT + VERIFY
  - RUN: npm run fix → npm run typecheck → npm run lint → npm run format:check.  (MUST be clean.)
  - RUN: npx vitest run tests/unit/workflows/prp-pipeline-progress.test.ts
        (EXPECTED: the "should throw error when backlog is not found in session" it() ~290-308 is GREEN — was RED.
        No other it() in this file newly fails. If the ~798 "handle missing ProgressTracker gracefully" it() fails,
        re-check its session has a real backlog — per research §4 it does (P1.M1.T1.S1) so it stays GREEN; if it
        somehow fails, that's S2's reconciliation scope, but it should NOT fail.)
  - RUN: npx vitest run tests/unit/workflows/prp-pipeline.test.ts
        (EXPECTED: 586/615 reject on different messages with real backlogs — unaffected, stay as-is.)
  - DO NOT run the full `npm run test:run` (pre-existing red — bugfix Issue 3, P2.M2/P2.M3 scope).
  - RUN: git status --short src/   (EXPECTED: only src/workflows/prp-pipeline.ts modified; NO test files.)
  - EXPECTED: typecheck/lint/format clean; progress.test.ts no-backlog it() RED→GREEN; only one src file touched.
```

### Implementation Patterns & Key Details
```ts
// ---- src/workflows/prp-pipeline.ts: executeBacklog() AFTER S1 (the moved check + SessionError) ----
async executeBacklog(): Promise<void> {
  this.logger.info('[PRPPipeline] Executing backlog');
  if (this.skipExecutionLoop) {
    this.logger.info('[PRPPipeline] Skipping execution loop ... (PRD §4.6)');
    this.totalTasks = this.#countTasks();
    this.completedTasks = this.#countCompletedTasks();
    this.currentPhase = 'backlog_complete';
    return;
  }

  // HARD ABORT — no backlog = misconfigured session; never useful to continue (PRD §4.2/§5.1; bugfix Issue 5).
  // Thrown ABOVE the try/catch so it propagates unconditionally — bypassing isFatalError(), so it aborts even
  // under --continue-on-error. SessionError's hardcoded PIPELINE_SESSION_LOAD_FAILED code is also fatal (defense in depth).
  const backlog = this.sessionManager.currentSession?.taskRegistry;
  if (!backlog) {
    throw new SessionError(
      'Cannot execute pipeline: no backlog found in session',
      { operation: 'executeBacklog' }
    );
  }

  try {
    // (backlog declared + null-checked above; narrowed to Backlog here)
    const totalSubtasks = this.#countTasks();
    if (totalSubtasks === 0) {
      this.logger.info('[PRPPipeline] No subtasks to execute, skipping backlog execution');
      this.currentPhase = 'backlog_complete';
      return;
    }
    this.#progressTracker = progressTracker({ backlog, logInterval: 5, barWidth: 40 });
    // ... rest of execution loop UNCHANGED ...
  } catch (error) {
    if (isFatalError(error, this.#continueOnError)) {
      throw error;
    }
    this.#trackFailure('executeBacklog', error, { phase: this.currentPhase });
    // ... rest of catch UNCHANGED ...
  }
}

// ---- In-file precedent to mirror (prp-pipeline.ts:714, already present) ----
throw new SessionError(
  'Session directory (SESSION_DIR) is empty; refusing to proceed ... (PRD §4.6)',
  { operation: 'initializeSession' }
);
```

### Integration Points
```yaml
EXECUTEBACKLOG (src/workflows/prp-pipeline.ts):
  - MOVE: backlog null-check (~1388-1393) from inside try → above the try (after skipExecutionLoop, before try).
  - CHANGE: `throw new Error(msg)` → `throw new SessionError(msg, { operation: 'executeBacklog' })`.
  - ADD: Mode-A JSDoc remark (~1350-1365) documenting the unconditional abort.
  - PRESERVE: execution-loop body, catch block (1601-1620), skipExecutionLoop guard, other isFatalError sites.

ERRORS (src/utils/errors.ts): NO CHANGE (reused).
  - SessionError: hardcoded code PIPELINE_SESSION_LOAD_FAILED; ctor (message, context?, cause?).
  - isFatalError: continueOnError override → false-for-all; SessionError+LOAD_FAILED → fatal. Both confirm the design.

TESTS: NO CHANGE by S1 (S2 owns reconciliation).
  - progress.test.ts:290-308 (taskRegistry:null, expects reject) → S1 makes it RED→GREEN (proves the fix).
  - progress.test.ts:~798 (real backlog, expects resolve) → stays GREEN (unaffected; research §4 corrects the
    architecture doc's erroneous "empty backlog" claim).
  - prp-pipeline.test.ts:586/615 + pipeline-main-loop.test.ts:958/~965 → unaffected (real backlogs / truthy empty array).

NO CHANGES TO (hard boundary):
  - any test file (S2), errors.ts/isFatalError/SessionError/ErrorCodes (reused), the execution-loop body + catch,
    other isFatalError sites (775/1172/1333/1963), skipExecutionLoop, .env.example, any docs/*.md (Mode A = JSDoc).
  - Issue 3's 297 pre-existing red tests (P2.M2/P2.M3) — NOT gated by S1.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
npm run fix            # lint:fix + prettier --write
npm run typecheck      # tsc --noEmit -p tsconfig.build.json (SRC-ONLY — must be green)
npm run lint           # eslint . --ext .ts
npm run format:check   # prettier --check
# Targeted:
npx eslint src/workflows/prp-pipeline.ts
npx prettier --check src/workflows/prp-pipeline.ts
# Expected: all clean. Likely failure: a TS error if `backlog` is declared twice (inside the try too) — remove the
#   duplicate inside the try (declare once above). Or if a code arg is passed to SessionError — use the 2-arg form.
```

### Level 2: Unit Tests (Component Validation)
```bash
# The no-backlog reject test — S1 makes it RED → GREEN (the proof of the fix):
npx vitest run tests/unit/workflows/prp-pipeline-progress.test.ts
#   Expected: "should throw error when backlog is not found in session" (~290-308) is GREEN (was RED). No other it()
#   in this file newly fails. If the ~798 "handle missing ProgressTracker gracefully" it() fails, its session lacks a
#   real backlog — but per research §4 it has P1.M1.T1.S1, so it stays GREEN (verify; if it fails, that's S2's scope).
# Sibling regression — different-message rejects with real backlogs (must stay unaffected):
npx vitest run tests/unit/workflows/prp-pipeline.test.ts
#   Expected: 586 ('Execution failed') + 615 ('Execution exceeded 10000 iterations') stay as-is (GREEN/unaffected).
# Do NOT run the full `npm run test:run` — pre-existing red (bugfix Issue 3, 297 failures, P2.M2/P2.M3 scope).
```

### Level 3: Integration / Regression (System Validation)
```bash
# Confirm ONLY one src file changed (S1 is source-only; NO test files):
git status --short src/        # Expect: M src/workflows/prp-pipeline.ts  (only).
git status --short tests/      # Expect: EMPTY (S2 owns test reconciliation).
# Confirm the moved check + SessionError are in place (grep the new shape):
grep -n "HARD ABORT" src/workflows/prp-pipeline.ts
grep -n "throw new SessionError(" src/workflows/prp-pipeline.ts | grep "no backlog found"
grep -n "throw new Error('Cannot execute pipeline" src/workflows/prp-pipeline.ts   # Expect: EMPTY (old plain Error gone).
# Integration executeBacklog call sites (real backlogs — unaffected):
npx vitest run tests/integration/pipeline-main-loop.test.ts -t "no subtasks gracefully" 2>/dev/null || true
#   (the empty-ARRAY case resolves via the totalSubtasks===0 early-return, NOT the abort — stays GREEN.)
# Expected: one src file modified; no test files; the new SessionError throw present; the old plain Error gone.
```

### Level 4: Creative & Domain-Specific Validation
```bash
# No MCP/DB/HTTP. Domain checks (record in commit message):
#   1. Unconditional abort — construct a PRPPipeline whose session has taskRegistry:null, call executeBacklog(),
#      assert it REJECTS with a SessionError whose message contains 'Cannot execute pipeline: no backlog found in
#      session'. Proof: progress.test.ts:290-308 (RED→GREEN). Confirm via the test run above.
#   2. continue-on-error independence — the throw is ABOVE the try/catch, so even with #continueOnError===true it
#      propagates (isFatalError is bypassed entirely). Confirm by reading the moved check is outside the try
#      (grep "HARD ABORT" sits before "try {"). (A dedicated continue-on-error test is S2's verification scope.)
#   3. No regression to resolve-cases — every other executeBacklog test has a real backlog or a truthy empty array;
#      none newly fails (run the two targeted suites above).
#   4. Message verbatim — the SessionError message is byte-identical to the old plain Error message (the reject test
#      sub-string-matches it).
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` clean (src-only; backlog narrows correctly; SessionError already imported).
- [ ] `npm run lint` clean.
- [ ] `npm run format:check` clean.
- [ ] `npx vitest run tests/unit/workflows/prp-pipeline-progress.test.ts` — "should throw error when backlog is not
      found in session" (~290-308) GREEN (was RED); no other it() newly fails.
- [ ] `git status --short src/` shows ONLY `src/workflows/prp-pipeline.ts`; `git status --short tests/` is EMPTY.

### Feature Validation
- [ ] `executeBacklog()` throws `SessionError` (message `'Cannot execute pipeline: no backlog found in session'`)
      when `currentSession.taskRegistry` is null/undefined.
- [ ] The throw is ABOVE the try/catch (propagates unconditionally; bypasses isFatalError; works under --continue-on-error).
- [ ] `skipExecutionLoop` adopt-mode guard stays above the moved check; moved check sits between it and the try.
- [ ] Execution-loop body + catch block byte-for-byte unchanged; `backlog` declared once.

### Code Quality Validation
- [ ] S1 edits ONLY `src/workflows/prp-pipeline.ts` (no test files — S2 owns reconciliation; no errors.ts — reused).
- [ ] `SessionError` called with 2 args `(message, { operation })` — NOT the architecture doc's wrong 3-arg form.
- [ ] Message string verbatim (`'Cannot execute pipeline: no backlog found in session'`).
- [ ] Mode-A JSDoc documents the unconditional abort (PRD §4.2/§5.1; bugfix Issue 5).
- [ ] No other `isFatalError(...)` site (775/1172/1333/1963) touched.

### Documentation & Deployment
- [ ] Mode-A JSDoc is the only doc artifact (rides with the code).
- [ ] No `docs/*.md`, README, or `.env.example` changes.
- [ ] Commit message notes: the swallow mechanism (plain Error non-fatal + continueOnError override); the two-layer
      fix (move above try/catch + fatal SessionError); the SessionError-hardcoded-code gotcha; the test-impact
      correction (line 798 has a real backlog — architecture doc was wrong); S2 owns test reconciliation.

---

## Anti-Patterns to Avoid

- ❌ Don't pass a code argument to `SessionError` — its `code` is HARDCODED to `PIPELINE_SESSION_LOAD_FAILED`
      (errors.ts:365); the ctor is `(message, context?, cause?)`. The architecture doc's "Option A" 3-arg snippet is
      WRONG. Use the 2-arg form `new SessionError(msg, { operation: 'executeBacklog' })`. Mirror line 714.
- ❌ Don't leave the no-backlog throw INSIDE the try/catch (even as a SessionError). Under `--continue-on-error`,
      `isFatalError` returns false for EVERYTHING (override), so even a fatal SessionError would be swallowed. The
      check MUST be ABOVE the try to bypass isFatalError entirely.
- ❌ Don't rephrase the message. Keep it EXACTLY `'Cannot execute pipeline: no backlog found in session'` — the reject
      test (progress.test.ts:290-308) sub-string-matches `error.message`.
- ❌ Don't edit any test file. S1 is source-only; S2 ("Verify and update affected unit tests for the abort behavior")
      owns ALL test reconciliation. S1 only needs to confirm the no-backlog reject test goes RED→GREEN.
- ❌ Don't edit `src/utils/errors.ts` (SessionError, isFatalError, ErrorCodes) — reused as-is. SessionError already
      has the right hardcoded code.
- ❌ Don't touch the execution-loop body (subtask-count check, progressTracker, while loop) or the catch block — they
      stay byte-for-byte unchanged. Only the backlog null-check MOVES and the throw changes type.
- ❌ Don't touch the other `isFatalError(...)` sites in the file (775 decomposePRD, 1172/1333, 1963 runQACycle) —
      those guard OTHER methods.
- ❌ Don't move the `skipExecutionLoop` adopt-mode guard — it stays first; the moved no-backlog check goes BETWEEN it
      and the `try`.
- ❌ Don't declare `backlog` twice. Move the single declaration above the try; the try body references it (narrowed
      to non-null). A duplicate `const backlog` inside the try is a typecheck error.
- ❌ Don't run the full `npm run test:run` as the gate — it's pre-existing red (bugfix Issue 3, 297 failures,
      P2.M2/P2.M3 scope). Gate = typecheck + lint + format:check + the targeted progress.test.ts.
- ❌ Don't conflate "empty backlog array" (`{ backlog: [] }`, truthy → resolves via totalSubtasks===0 early-return)
      with "no backlog" (`null`/`undefined` → the abort). S1 only changes the null/undefined path.

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: This is a small, surgical, single-file change with every relevant fact
empirically verified. The exact before/after of `executeBacklog()` is given. The two
non-obvious traps are both flagged with proof: (1) `SessionError`'s `code` is
hardcoded → the 2-arg call is mandatory (the architecture doc's 3-arg Option A snippet
is wrong — corrected); (2) the throw MUST be above the try/catch (not just a
SessionError inside it) because `isFatalError` returns false-for-all under
`--continue-on-error`. The in-file precedent at line 714 is an identical `SessionError`
throw with the same rationale, and `SessionError`/`isFatalError` are already imported
(no import change). The test-impact analysis (research §4) proves S1 fixes exactly one
red test (progress.test.ts:290-308, `taskRegistry:null` → reject) and breaks nothing —
including a direct correction of the architecture doc's erroneous "line 798 has an empty
backlog" claim (that test has a real P1.M1.T1.S1 backlog). TypeScript control-flow
narrowing holds after the move (`backlog` → `Backlog` past the throw), so typecheck is
green. S2 cleanly inherits test reconciliation. The pre-existing-red full suite (Issue 3)
is fenced by gating on the targeted suite. Residual risks are mechanical and gate-caught:
(a) a duplicate `const backlog` inside the try → typecheck error (fix by declaring once);
(b) accidentally passing a code to SessionError → typecheck error (fix by 2-arg form);
(c) a prettier nit (auto-fixed via `npm run fix`). No runtime/network/LLM unknowns.
```