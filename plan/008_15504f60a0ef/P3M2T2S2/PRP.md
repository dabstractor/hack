# PRP — P3.M2.T2.S2: Wire terminal-fail into retry.ts — exit 124 never retried

---

## Goal

**Feature Goal**: Make a **watchdog-killed subprocess a terminal, non-retryable failure**
across both layers that can churn retries against a hung process:

1. **Layer A (`src/utils/retry.ts`)** — the shared retry predicates. Add detection so any
   thrown or result-shaped object carrying `exitCode === 124` (the `timeout` coreutil path) OR
   `timedOut === true` (the Node-watchdog `child.kill` path surfaced by P3.M2.T2.S1) is classified
   as **PERMANENT** and **NOT transient** — never retried. This closes the false-positive trap
   where `isTransientError`'s `'timeout'` message-pattern fallback would otherwise retry a thrown
   `"Command timed out after 120000ms"` error. **Without breaking the LLM-call deadline retry
   path** (`withAgentDeadline` → `AgentError`/`PIPELINE_AGENT_LLM_FAILED`, which MUST remain
   transient per PRD §4.2 / Req 3.4).

2. **Layer B (`src/agents/prp-executor.ts`)** — the ACTUAL retry loop that a watchdog-killed bash
   command surfaces in. Today `#runValidationGates` calls `execute_bash` once (no retry wrapper)
   and the `while (fixAttempts <= maxFixAttempts)` loop treats a hung gate identically to a genuine
   validation failure, invoking `#fixAndRetry` (an LLM call) and re-running the same hung command.
   Carry `timedOut` onto `ValidationGateResult`, detect a watchdog-killed gate, and **break out →
   `outcome: 'fail'` WITHOUT fix-retrying** (PRD §9.3.2 + Req 4.4: "a watchdog-killed validation
   aborts the run and is not retried").

**Deliverable** (2 modified production files + 2 modified test files):
1. **`src/utils/retry.ts`** — ADD an internal `isWatchdogKillResult(error)` helper (detects both
   vectors); call it early in `isPermanentError` (→ `true`) and early in `isTransientError`
   (→ `false`, before the message-pattern fallback). Export it for direct unit testing. **No
   change to `retryAgentPrompt`/`withAgentDeadline`/`retryMcpTool` signatures; no change to the
   LLM-timeout classification.**
2. **`src/agents/prp-executor.ts`** — ADD `timedOut: boolean` to `ValidationGateResult`; populate
   it in `#runValidationGates` from `result.timedOut || result.exitCode === 124`; add a terminal
   early-`break` in the validation fix-loop when any gate is watchdog-killed.
3. **`tests/unit/utils/retry.test.ts`** — ADD `isPermanentError`/`isTransientError` cases for
   exit-124, `timedOut:true`, the `'timeout'`-message false-positive guard, and the LLM-timeout
   regression guard; ADD a `retry()` loop test proving a thrown watchdog-kill error is never
   retried (`calls === 1`).
4. **`tests/unit/agents/prp-executor.test.ts`** — ADD a test that a watchdog-killed gate
   (`timedOut:true`) and a coreutil-killed gate (`exitCode:124`) both yield `outcome: 'fail'`
   with `fixAttempts: 0` and **no fix-agent prompt call**.

**Success Definition**:
- `isPermanentError({ exitCode: 124 })` → `true`; `isPermanentError({ timedOut: true })` → `true`.
- `isTransientError({ exitCode: 124, message: 'Command timed out after 120000ms' })` → `false`
  (the false-positive trap is closed).
- `isTransientError(new AgentError('Agent exceeded the 300s RESEARCH_TIMEOUT deadline'))` → `true`
  **UNCHANGED** (LLM-call deadline retry path intact — Req 3.4).
- A `retry()` whose `fn` throws a `{ timedOut: true, message: 'Command timed out…' }` error calls
  `fn` exactly ONCE (never retried).
- A PRPExecutor `execute()` whose single validation gate is watchdog-killed returns
  `outcome: 'fail'`, `validationResults[0].timedOut === true`, and does NOT invoke the fix agent
  (`mockAgent.prompt` called only for the initial coder run, never for `#fixAndRetry`).
- `npm run validate` GREEN; **100% coverage** maintained on both modified files.

---

## User Persona (if applicable)

**Target User**: The autonomous pipeline (no human in the loop). Specifically the retry layer
(`src/utils/retry.ts`) and the PRP executor's validation loop (`src/agents/prp-executor.ts`),
transitively consumed by `TaskOrchestrator.executeSubtask` and the future `validate.sh` abort
hook (P4.M2.T1.S2).

**Use Case**: A PRP validation gate command hangs — infinite loop, deadlock, wedged build, or a
test suite that blocks on stdin. Two watchdog vectors can kill it: (a) `executeBashCommand`'s own
`setTimeout` (Node watchdog, surfaced as `timedOut: true` by P3.M2.T2.S1); (b) a PRP `validate.sh`
wrapping the command in the `timeout` coreutil (exits 124). Pre-S2: both look like an ordinary
validation failure → the executor fix-retries (an LLM call + re-running the same hung command),
and if the result is ever thrown into a retry loop, `isTransientError`'s `'timeout'` pattern
matches → the loop churns. Post-S2: both vectors are detected as terminal and the run aborts
cleanly to `'fail'`.

**User Journey**: PRP `execute()` → coder succeeds → `#runValidationGates` runs gate command →
command hangs → watchdog fires → `BashToolResult { success:false, timedOut:true, exitCode:143 }`
(OR coreutil `exitCode:124`) → **[S1, done]** flag surfaced → **[S2, NEW]**
`ValidationGateResult.timedOut = true` → **[S2, NEW]** fix-loop sees watchdog kill → logs +
`break` → `outcome: 'fail'`, no fix-retry. Separately, if any caller throws the result into a
`retry()` loop, **[S2, NEW]** `isPermanentError`/`isTransientError` classify it terminal →
`calls === 1`.

**Pain Points Addressed**: PRD §9.3.2 *"Watchdog kills are terminal: … a hung process will simply
re-hang, so churning retries is wrong. This applies to validation under `VALIDATION_TIMEOUT`
(§4.4): a watchdog-killed validation aborts the run and is not retried."* Today there is NO
exit-code → retry mapping (architecture/phase_findings.md §PHASE 3 Retry), so the mandate is
unimplemented. S2 implements it.

---

## Why

- **PRD compliance**: PRD §9.3.2 (h4.9) explicitly mandates watchdog kills be terminal for "the
  bash `run_with_retry` / `run_with_retry_stdin` and their Groundswell equivalents" AND for
  validation under `VALIDATION_TIMEOUT` (§4.4). This PRP is the retry-policy half of that mandate
  (P3.M2.T2.S1 was the surfacing half).
- **Work-item contract (LOGIC a–d)**:
  - (a) *"Add exit-code 124 detection to `isPermanentError()` … if the error/result indicates
    exit code 124 (watchdog kill) or `timedOut=true`, treat it as permanent (never retried)."* →
    Layer A `isPermanentError` early-return.
  - (b) *"Ensure `isTransientError()` returns false for exit 124."* → Layer A `isTransientError`
    early-return BEFORE the message-pattern fallback (closes the `'timeout'` false-positive).
  - (c) *"Update the retry loops that wrap agent calls (`retryAgentPrompt`, `executeSubtask`) to
    propagate the hard-fail when exit 124 is detected — no retry."* → Layer A makes the generic
    `retry()`/`retryAgentPrompt` path abort-on-classify (the default `isRetryable=isTransientError`
    now returns false); Layer B makes the executor validation loop (reached via
    `executeSubtask` → `prpRuntime.executeSubtask` → `PRPExecutor.execute`) break without
    fix-retry.
  - (d) *"This distinction is critical for validation (Req 4.4): a watchdog-killed validation
    aborts and is not retried."* → Layer B `break` → `'fail'`.
- **Contract item 1 (RESEARCH NOTE)**: *"retry is keyed on `isTransientError()` (network/HTTP/
  message patterns), NOT on process exit codes. No exit-code → retry mapping exists. PRD §9.3.2
  specifies exit 124 is a PERMANENT error. Distinct from LLM-generation timeout on commit (should
  be retried per Req 3.4)."* → verified against the current `src/utils/retry.ts`
  (research/01). Layer A adds the mapping WITHOUT touching the LLM-timeout classification.
- **Contract item 4 (OUTPUT)**: *"Exit 124 treated as permanent error in retry logic. Consumed
  by P4.M2.T1.S2. Completes P3.M2.T2."* → Layer A is the consumed contract; Layer B is the
  in-tree consumer that proves it.
- **Contract item 5 (DOCS)**: *"none — no user-facing/config/API surface change."* → Mode A:
  inline JSDoc on the new helper + `ValidationGateResult.timedOut` rides with the work. No
  `.env.example`, no `constants.ts`, no `docs/` edit.

---

## What

Two modified production files, two modified test files. **No** config, **no** new files, **no**
new dependencies, **no** new exported retry-wrapper functions.

### Success Criteria

- [ ] **`src/utils/retry.ts`** exports an internal helper (e.g. `isWatchdogKillResult`) that
      returns `true` for `{ exitCode: 124 }` OR `{ timedOut: true }` and `false` otherwise
      (duck-typed on object shape; null/non-object safe).
- [ ] **`isPermanentError()`** calls the helper EARLY and returns `true` when it matches.
- [ ] **`isTransientError()`** calls the helper EARLY (before the `TRANSIENT_PATTERNS` message
      fallback) and returns `false` when it matches.
- [ ] **LLM-timeout path UNCHANGED**: `isTransientError(new AgentError('…RESEARCH_TIMEOUT…'))`
      still returns `true`; `isPermanentError(...)` still returns `false`.
- [ ] **`src/agents/prp-executor.ts` `ValidationGateResult`** has a new required
      `readonly timedOut: boolean` field with JSDoc citing PRD §9.3.2 / P3.M2.T2.S2.
- [ ] **`#runValidationGates`** populates `timedOut: result.timedOut || result.exitCode === 124`
      on every non-skipped gate (skipped gates get `timedOut: false`).
- [ ] **The validation fix-loop** (`while (fixAttempts <= maxFixAttempts)`) breaks immediately —
      BEFORE the `allPassed` check and BEFORE any `#fixAndRetry` — when any gate has
      `timedOut === true`, logging at `error` level. The resulting `outcome` is `'fail'`.
- [ ] **`retryAgentPrompt` / `withAgentDeadline` / `retryMcpTool` signatures UNCHANGED.** No new
      wrapper functions. `retryMcpTool` is left as-is (dead code — NOT revived).
- [ ] **`tests/unit/utils/retry.test.ts`** adds: `isPermanentError` cases (124 / timedOut / no
      false-positives on 137 or exit-1), `isTransientError` cases (124+message / timedOut+message
      → false; LLM `AgentError` → true), and a `retry()`-never-retries test (`calls === 1`).
- [ ] **`tests/unit/agents/prp-executor.test.ts`** adds: watchdog-killed gate
      (`timedOut:true`) → `outcome:'fail'`, `fixAttempts:0`, no fix prompt; and a coreutil
      variant (`exitCode:124`) → same. Plus a "normal failure still fix-retries" test keeping the
      new branch's false-arm covered.
- [ ] **100% coverage** maintained on `src/utils/retry.ts` AND `src/agents/prp-executor.ts`.
- [ ] `npm run validate` GREEN; `package.json` `dependencies` byte-identical.

---

## All Needed Context

### Context Completeness Check

✅ "If someone knew nothing about this codebase, would they have everything needed to implement
this successfully?" — YES. This PRP names: the two exact files, the exact functions
(`isPermanentError` ~line 352, `isTransientError` ~line 297 in retry.ts; `ValidationGateResult`
lines 41–58, `#runValidationGates` lines 492–565, the fix-loop lines 368–422 in prp-executor.ts),
the exact helper to add, the exact early-return ordering (BEFORE the message-pattern fallback —
the critical false-positive trap), the exact test files + existing mock patterns
(`vi.mock('../../../src/tools/bash-mcp.js')` with stateful `execute_bash`; `vi.useFakeTimers`),
the LLM-timeout regression guard, and the S1 input contract.

### Documentation & References

```yaml
# MUST READ - Include these in your context window
- file: src/utils/retry.ts
  why: THE PRIMARY TARGET (Layer A). `isTransientError(error)` (~line 297) and
       `isPermanentError(error)` (~line 352) are the predicates. READ the FULL body of both:
       isTransientError checks PipelineError → ValidationError → TRANSIENT_ERROR_CODES →
       RETRYABLE_HTTP_STATUS_CODES → TRANSIENT_PATTERNS (message fallback, LAST). The helper
       MUST short-circuit BEFORE the message fallback or a thrown "Command timed out…" error is
       mis-retried. isPermanentError checks ValidationError → PipelineError(parse) → HTTP 4xx →
       PERMANENT_PATTERNS. Add the helper call as the FIRST object-shape check in BOTH (right
       after the null/non-object guard).
  pattern: |
           // ADD (module-private, exported for testing):
           export function isWatchdogKillResult(error: unknown): boolean {
             if (error == null || typeof error !== 'object') return false;
             const e = error as { timedOut?: unknown; exitCode?: unknown };
             return e.timedOut === true || e.exitCode === 124;
           }
           // In isTransientError, AFTER `if (error == null || typeof error !== 'object') return false;`
           // and the `const err = error as RetryableError;` cast, ADD (before isPipelineError):
           if (isWatchdogKillResult(err)) return false;
           // In isPermanentError, same position, ADD:
           if (isWatchdogKillResult(err)) return true;
  gotcha: the message-pattern fallback in isTransientError matches 'timeout' (lowercased). A
          thrown watchdog-kill error whose message is "Command timed out after 120000ms" MUST be
          caught by the EARLY helper return, not retried. Put the helper check BEFORE the
          TRANSIENT_PATTERNS loop. Do NOT remove the message fallback (network "timeout" strings
          from genuine ETIMEDOUT/504 SHOULD still retry).

- file: src/agents/prp-executor.ts
  why: LAYER B TARGET. (1) `ValidationGateResult` interface (lines 41–58) — ADD
       `readonly timedOut: boolean;`. (2) `#runValidationGates` (lines 492–565): it builds TWO
       gate-result literals — the SKIPPED-gate literal (lines ~505–515, add `timedOut: false`)
       and the EXECUTED-gate literal (lines ~527–538, add
       `timedOut: result.timedOut || result.exitCode === 124`). (3) The fix-loop (lines ~368–422):
       right after `validationResults = await this.#runValidationGates(prp);` (~line 376) and
       BEFORE the checkpoint block, ADD the terminal check + break. (4) The error-log site at
       ~line 560 ("Validation gate failed") is INSIDE #runValidationGates; the loop-level log is
       new.
  pattern: |
           // In the fix-loop, after validationResults is assigned (~line 376), BEFORE checkpoint:
           const watchdogKilled = validationResults.some(r => r.timedOut);
           if (watchdogKilled) {
             this.#logger.error(
               { prpTaskId: prp.taskId },
               'Validation gate watchdog-killed (exit 124 / timedOut) — aborting without fix-retry (PRD §9.3.2)'
             );
             break;  // → falls through to allPassed=false → outcome:'fail'
           }
  gotcha: the break must come BEFORE `if (allPassed) break;` and BEFORE the fix-attempts branch,
          so NEITHER the success path NOR #fixAndRetry runs. The existing allPassed/fail logic
          below the loop (lines ~423–446) already produces outcome:'fail' when gates failed — do
          NOT duplicate it; just break.

- file: src/tools/bash-mcp.ts   # BashToolResult interface (lines 52–~80), exported line 329
  why: THE S1 INPUT CONTRACT (already implemented). Confirms `BashToolResult` carries
       `timedOut: boolean` and `killed: boolean` (required, no `?`), that `exitCode` is passed
       through UNCHANGED (137/143 for Node-watchdog, 124 for `timeout` coreutil), and that
       `success` is `exitCode===0 && !timedOut && !killed`. S2 reads `result.timedOut` and
       `result.exitCode` from this contract. DO NOT modify bash-mcp.ts in S2.
  gotcha: the Node-watchdog path sets `timedOut:true` with `exitCode` 137/143 (NOT 124). The
          coreutil path sets `exitCode:124` with `timedOut:false`. Layer A and Layer B must both
          detect EITHER vector (hence `timedOut === true || exitCode === 124`).

- file: tests/unit/utils/retry.test.ts
  why: LAYER A TEST FILE. Already imports `isTransientError`, `isPermanentError`, `retry`,
       `retryAgentPrompt`, `retryMcpTool`, `createDefaultOnRetry`, `AgentError`, `ValidationError`,
       `ErrorCodes`. Uses `vi.useFakeTimers()` in beforeEach (switch to `vi.useRealTimers()` for
       the never-retries test if you rely on immediate throw — no sleep needed). Add a new
       `describe('watchdog-kill (exit 124) detection')` block.
  pattern: see research/03 for the exact assertions. Key regression guard:
           `isTransientError(new AgentError('Agent exceeded the 300s RESEARCH_TIMEOUT deadline'))`
           MUST still be `true` (Req 3.4 LLM-timeout retry intact).

- file: tests/unit/agents/prp-executor.test.ts
  why: LAYER B TEST FILE. `vi.mock('../../../src/tools/bash-mcp.js')` (line 33) provides a
       mockable `BashMCP`; `mockExecuteBash` is reinstalled per-test (lines ~134–143). Existing
       tests (e.g. 'should exhaust fix attempts after 2 retries' ~line 362, 'should trigger
       fix-and-retry on validation failure' ~line 306) show the EXACT pattern: a stateful
       `execute_bash` mock + assertion on `mockAgent.prompt` call count. `vi.mock('../../../src/
       utils/retry.js')` (line 41) makes `retryAgentPrompt` a passthrough that awaits `fn()` —
       so `mockAgent.prompt` call count IS the fix-retry signal. REUSE these fixtures.
  pattern: |
           it('aborts (outcome:fail) without fix-retry when a gate is watchdog-killed (timedOut)', async () => {
             mockExecuteBash.mockResolvedValue({ success:false, stdout:'', stderr:'killed',
               exitCode:143, timedOut:true, killed:true });
             // mock coder agent prompt → result:'success' (reuse existing helper)
             const result = await executor.execute(prpWithOneGate, prpPath);
             expect(result.outcome).toBe('fail');
             expect(result.validationResults[0].timedOut).toBe(true);
             expect(result.fixAttempts).toBe(0);
             expect(mockAgent.prompt).toHaveBeenCalledTimes(1); // initial coder ONLY, no fix
           });
           // Mirror with exitCode:124, timedOut:false (coreutil) → same outcome, gate.timedOut===true.

- docfile: plan/008_15504f60a0ef/architecture/phase_findings.md   # §PHASE 3 Retry (lines ~91–95)
  why: THE SOURCE FINDING. "Retry (retry.ts): `retry<T>(fn, opts)` — isTransientError() decides
       retryability. withAgentDeadline(promise) — races against RESEARCH_TIMEOUT. No exit-code-
       based logic. No stdin variant. Required: treat exit 124 (watchdog kill) as PERMANENT (not
       transient). Distinct from LLM-generation timeout (should be retried)." → S2 implements
       the "Required".

- docfile: plan/008_15504f60a0ef/P3M2T2S2/research/01-retry-layer-current-state.md
  why: Annotated read of retry.ts proving: (a) isTransientError/isPermanentError operate on
       THROWN errors only, no exit-code logic; (b) execute_bash is called DIRECTLY in
       #runValidationGates with NO retry wrapper; (c) retryMcpTool is dead code; (d) the LLM-
       timeout path (withAgentDeadline → AgentError) is distinct and must stay transient.

- docfile: plan/008_15504f60a0ef/P3M2T2S2/research/02-detection-contract-and-decision-matrix.md
  why: The two-vector detection design, the decision matrix, the `'timeout'` false-positive trap,
       the helper, the ValidationGateResult.timedOut propagation, and why break→'fail' (not throw).

- docfile: plan/008_15504f60a0ef/P3M2T2S2/research/03-test-design.md
  why: Exact Layer-A and Layer-B test assertions, including the LLM-timeout regression guard and
       the never-retries loop test.
```

### Current Codebase tree (relevant slice)

```bash
src/
  utils/
    retry.ts             # MODIFY (Layer A): + isWatchdogKillResult helper; wire into isPermanentError + isTransientError
  agents/
    prp-executor.ts      # MODIFY (Layer B): ValidationGateResult +timedOut; #runValidationGates populate; fix-loop terminal break
  tools/
    bash-mcp.ts          # READ-ONLY (S1 input contract: BashToolResult.timedOut/killed already present)
  utils/
    errors.ts            # READ-ONLY (AgentError/ValidationError/ErrorCodes used by regression guard)
tests/
  unit/
    utils/
      retry.test.ts           # MODIFY: watchdog-kill predicate cases + never-retries loop test + LLM regression
    agents/
      prp-executor.test.ts    # MODIFY: watchdog-killed-gate abort test (timedOut + exitCode:124 variants)
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
src/utils/retry.ts
  # MODIFIED (additive predicate logic; signatures UNCHANGED):
  #   + export function isWatchdogKillResult(error: unknown): boolean
  #       // true iff error is an object with timedOut===true OR exitCode===124
  #   ~ isTransientError(): + `if (isWatchdogKillResult(err)) return false;` EARLY (before message fallback)
  #   ~ isPermanentError(): + `if (isWatchdogKillResult(err)) return true;`  EARLY
  #   UNCHANGED: retry(), retryAgentPrompt(), withAgentDeadline(), retryMcpTool(), calculateDelay(), sleep(),
  #              TRANSIENT_ERROR_CODES, RETRYABLE_HTTP_STATUS_CODES, TRANSIENT_PATTERNS, PERMANENT_PATTERNS,
  #              AgentError LLM-timeout classification (PIPELINE_AGENT_LLM_FAILED stays transient)
src/agents/prp-executor.ts
  # MODIFIED (additive; outcome logic UNCHANGED — break reuses existing fail path):
  #   ~ ValidationGateResult: + readonly timedOut: boolean  (+ JSDoc citing PRD §9.3.2 / P3.M2.T2.S2)
  #   ~ #runValidationGates skipped-gate literal: + timedOut: false
  #   ~ #runValidationGates executed-gate literal: + timedOut: result.timedOut || result.exitCode === 124
  #   ~ fix-loop: + terminal watchdog-kill check + error log + break (before allPassed check & #fixAndRetry)
tests/unit/utils/retry.test.ts
  # MODIFIED: + describe('watchdog-kill (exit 124) detection') with isPermanentError/isTransientError cases,
  #             the 'timeout'-message false-positive guard, the LLM-timeout regression guard, and the
  #             retry()-never-retries test (calls===1)
tests/unit/agents/prp-executor.test.ts
  # MODIFIED: + watchdog-killed gate (timedOut:true) abort test; + coreutil (exitCode:124) variant;
  #             + a normal-failure-still-fix-retries test to cover the new branch's false-arm
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL: isTransientError's FINAL fallback is `TRANSIENT_PATTERNS.some(p => message.includes(p))`
// and 'timeout' is in that list. A thrown watchdog-kill error with message "Command timed out after
// 120000ms" would be RETRIED if the helper check is placed AFTER the fallback. The helper check
// MUST come BEFORE the message-pattern loop. (Place it right after the null/object guard + cast.)

// CRITICAL: do NOT break the LLM-timeout retry path. withAgentDeadline throws a PLAIN AgentError
// (code PIPELINE_AGENT_LLM_FAILED, NO timedOut/exitCode fields). isWatchdogKillResult returns
// false for it → falls through to the existing PipelineError branch → isTransientError returns
// true. Req 3.4 (LLM-generation timeout SHOULD be retried) is preserved. The regression test
// pins this.

// CRITICAL: a Node-watchdog kill sets timedOut:TRUE but exitCode 137 or 143 (NOT 124). The
// `timeout` coreutil sets exitCode:124 but timedOut:FALSE. Detect BOTH: `timedOut === true ||
// exitCode === 124`. Do not key on exitCode===124 alone or the Node-watchdog vector is missed.

// CRITICAL: execute_bash is called DIRECTLY in #runValidationGates — there is NO retry wrapper
// around it. The "retry loop" the PRD/work-item refers to for validation is the executor's own
// `while (fixAttempts <= maxFixAttempts)` fix-loop, NOT retry(). Layer B is where "a watchdog-
// killed validation aborts and is not retried" actually lives.

// GOTCHA: in prp-executor.ts there are TWO gate-result literals in #runValidationGates — the
// skipped-gate early-continue (add timedOut:false) and the executed-gate literal (add the mapped
// value). TypeScript will flag the missing field once the interface requires it, but verify both.

// GOTCHA: the terminal break in the fix-loop must happen BEFORE `if (allPassed) break;` and
// before the `if (fixAttempts < maxFixAttempts)` fix branch — otherwise a watchdog-killed gate
// could still trigger #fixAndRetry. The break falls through to the existing allPassed=false →
// outcome:'fail' logic at the end of execute(); do NOT add a duplicate return.

// GOTCHA: retryMcpTool is DEAD CODE (never imported/called in src). Do NOT add exit-124 handling
// there and do NOT start using it. The shared isPermanentError/isTransientError predicates cover
// any future caller. Adding logic to retryMcpTool would be unverifiable and rot.

// GOTCHA: 100% coverage is ENFORCED (vitest.config.ts thresholds: statements/branches/functions/
// lines all 100%). The new helper has 2 return paths (true/false) — both must be exercised. The
// new early-returns in isPermanentError/isTransientError add branches — cover both arms (watchdog
// match + non-match). The new fix-loop `if (watchdogKilled) break;` branch must be hit (Layer-B
// test) AND its false-arm kept covered (a normal-failure-still-fix-retries test).

// GOTCHA: tests/unit/agents/prp-executor.test.ts fully mocks '../../../src/utils/retry.js' (line 41)
// — so you CANNOT assert on the real isPermanentError there. Layer-A predicate tests MUST live in
// tests/unit/utils/retry.test.ts (which imports the REAL module). Layer-B tests assert behavior
// (outcome, fixAttempts, mockAgent.prompt call count) — they do NOT need the real predicates.

// GOTCHA: tests/unit/utils/retry.test.ts uses vi.useFakeTimers() in beforeEach. For the
// never-retries test the error throws on attempt 1 with no sleep involved, so fake timers are
// fine — but if you add any real-timer reliance, call vi.useRealTimers() in that test.
```

---

## Implementation Blueprint

### Data models and structure

One interface field addition (Layer B). One new helper function (Layer A). No new types.

```typescript
// src/utils/retry.ts — NEW helper (module-private, exported for direct unit testing):

/**
 * Detects a watchdog-killed subprocess result/error — a TERMINAL, non-retryable
 * failure per PRD §9.3.2 ("Watchdog kills are terminal").
 *
 * Two vectors (both terminal):
 *  - Node watchdog: `executeBashCommand`'s `setTimeout` → `child.kill` surfaces
 *    `timedOut: true` (P3.M2.T2.S1); exitCode is 137/143, NOT 124.
 *  - `timeout` coreutil: a PRP `validate.sh` wrapping `timeout SECS cmd` exits 124;
 *    `timedOut` is false (the NODE watchdog did not fire).
 *
 * Used by {@link isPermanentError} (→ true) and {@link isTransientError} (→ false,
 * BEFORE the message-pattern fallback) so a thrown "Command timed out…" error is
 * never retried. Distinct from the LLM-call deadline (withAgentDeadline → AgentError),
 * which has neither field and remains transient (Req 3.4).
 */
export function isWatchdogKillResult(error: unknown): boolean {
  if (error == null || typeof error !== 'object') return false;
  const e = error as { timedOut?: unknown; exitCode?: unknown };
  return e.timedOut === true || e.exitCode === 124;
}

// src/agents/prp-executor.ts — MODIFIED interface:
export interface ValidationGateResult {
  readonly level: 1 | 2 | 3 | 4 | 5;
  readonly description: string;
  readonly success: boolean;
  readonly command: string | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly skipped: boolean;
  /**
   * True iff this gate was killed by a watchdog — either the Node watchdog
   * (`result.timedOut === true`, exitCode 137/143) or the `timeout` coreutil
   * (`result.exitCode === 124`). Terminal: the fix-and-retry loop MUST abort
   * on this (PRD §9.3.2; P3.M2.T2.S2).
   */
  readonly timedOut: boolean;
}
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: ADD isWatchdogKillResult helper + wire into isPermanentError/isTransientError (src/utils/retry.ts)
  - ADD the `export function isWatchdogKillResult(error: unknown): boolean` helper (see Data models)
    in the TRANSIENT ERROR DETECTION section (near isTransientError).
  - EDIT isTransientError (~line 297): AFTER `if (error == null || typeof error !== 'object')
    return false;` and the `const err = error as RetryableError;` cast, ADD (as the FIRST
    substantive check, BEFORE `if (isPipelineError(err))`):
        if (isWatchdogKillResult(err)) return false;
  - EDIT isPermanentError (~line 352): same position (after null/object guard + cast), ADD:
        if (isWatchdogKillResult(err)) return true;
  - PRESERVE: every other branch, the TRANSIENT_PATTERNS/PERMANENT_PATTERNS arrays, the
    PipelineError/ValidationError classification, the HTTP-status checks. The helper is purely
    ADDITIVE and short-circuits ONLY for the two watchdog vectors.
  - NAMING: `isWatchdogKillResult` (camelCase, matches `isTransientError`/`isPermanentError`).
  - GOTCHA: the helper MUST run BEFORE the message-pattern fallback in isTransientError.
  - VERIFY: `npx tsc --noEmit -p tsconfig.json` GREEN.

Task 2: ADD timedOut to ValidationGateResult + populate in #runValidationGates (src/agents/prp-executor.ts)
  - EDIT the `ValidationGateResult` interface (lines 41–58): ADD `readonly timedOut: boolean;`
    with the JSDoc above (Mode A — cites PRD §9.3.2 / P3.M2.T2.S2).
  - EDIT `#runValidationGates` (lines 492–565):
    * SKIPPED-gate literal (~lines 505–515): ADD `timedOut: false,`.
    * EXECUTED-gate literal (~lines 527–538): ADD `timedOut: result.timedOut || result.exitCode === 124,`.
  - PRESERVE: the cwd=process.cwd() choice, the 120000ms timeout, the sequential break-on-failure,
    the error logging. `success`/`exitCode` semantics UNCHANGED.
  - VERIFY: `npx tsc --noEmit -p tsconfig.json` — will flag the two literals until both are edited.

Task 3: ADD terminal watchdog-kill break to the validation fix-loop (src/agents/prp-executor.ts)
  - LOCATE the fix-loop (lines ~368–422): `while (fixAttempts <= maxFixAttempts) {`.
  - IMMEDIATELY after `validationResults = await this.#runValidationGates(prp);` (~line 376) and
    BEFORE the `if (validationResults.length > 0)` checkpoint block, ADD:
        const watchdogKilled = validationResults.some(r => r.timedOut);
        if (watchdogKilled) {
          this.#logger.error(
            { prpTaskId: prp.taskId },
            'Validation gate watchdog-killed (exit 124 / timedOut) — aborting without fix-retry (PRD §9.3.2)'
          );
          break;
        }
  - PRESERVE: the checkpoint block, the allPassed check, the fix-attempt counter, the sleep, the
    #fixAndRetry call. The break falls through to the existing allPassed=false → outcome:'fail'
    logic (lines ~423–446); do NOT add a duplicate return/throw.
  - GOTCHA: the break MUST precede the allPassed check so neither the success path nor #fixAndRetry
    runs on a watchdog kill.
  - VERIFY: `npx tsc --noEmit -p tsconfig.json` GREEN.

Task 4: MODIFY tests/unit/utils/retry.test.ts — Layer A predicate + loop tests
  - ADD `isWatchdogKillResult` to the import from '../../../src/utils/retry.js'.
  - ADD a `describe('watchdog-kill (exit 124) detection', ...)` block with:
      isPermanentError:
        - { exitCode: 124, timedOut: false } → true
        - { timedOut: true, killed: true, exitCode: 143 } → true
        - { exitCode: 1, timedOut: false } → false (no false positive)
        - { exitCode: 137, timedOut: false } → false (signal w/o flag)
      isTransientError (the critical false-positive guard):
        - { exitCode: 124, message: 'Command timed out after 120000ms' } → false
        - { timedOut: true, killed: true, exitCode: 143, message: 'Command timed out…' } → false
      LLM-timeout regression guard (Req 3.4 NOT broken):
        - isTransientError(new AgentError('Agent exceeded the 300s RESEARCH_TIMEOUT deadline')) → true
        - isPermanentError(same) → false
      isWatchdogKillResult direct:
        - null/undefined/'string'/42 → false
        - { timedOut: true } → true ; { exitCode: 124 } → true ; { timedOut: 1 } → false ; { exitCode: '124' } → false
      retry() never-retries (use vi.useRealTimers() in this test; no sleep needed):
        - fn throws { timedOut:true, message:'Command timed out…' } → rejects, calls===1
        - fn throws { exitCode:124, message:'timeout' } → rejects, calls===1
  - GOTCHA: the retry() never-retries test must use real timers OR ensure no sleep path is hit
    (it throws on attempt 1, so the loop exits before calculateDelay/sleep — fake timers are OK,
    but real timers are simplest). Mirror the existing non-retryable-error test style.
  - VERIFY: `npx vitest run tests/unit/utils/retry.test.ts -v` GREEN.

Task 5: MODIFY tests/unit/agents/prp-executor.test.ts — Layer B abort tests
  - REUSE the existing harness: `vi.mock('../../../src/tools/bash-mcp.js')`, `mockExecuteBash`,
    the PRP-with-gates fixture, the coder-agent mock. See the 'should exhaust fix attempts after
    2 retries' test (line ~362) for the stateful-mock pattern.
  - ADD test: 'aborts (outcome:fail) without fix-retry when a gate is watchdog-killed (timedOut)':
      mockExecuteBash.mockResolvedValue({ success:false, stdout:'', stderr:'killed',
        exitCode:143, timedOut:true, killed:true });
      mock coder prompt → result:'success' (to reach validation);
      const result = await executor.execute(prpWithOneGate, prpPath);
      expect(result.outcome).toBe('fail');
      expect(result.validationResults[0].timedOut).toBe(true);
      expect(result.fixAttempts).toBe(0);
      expect(mockAgent.prompt).toHaveBeenCalledTimes(1);   // initial coder ONLY
  - ADD test: 'aborts without fix-retry for coreutil exit 124':
      mockExecuteBash.mockResolvedValue({ success:false, stdout:'', stderr:'',
        exitCode:124, timedOut:false, killed:false });
      …same assertions…; expect(result.validationResults[0].timedOut).toBe(true); // mapped from 124
  - ADD/KEEP a normal-failure-still-fix-retries test (the existing 'should trigger fix-and-retry
    on validation failure' already covers this) — ensure it still asserts fixAttempts>=1 and
    mockAgent.prompt called >1×. This keeps the new `if (watchdogKilled)` false-arm covered.
  - GOTCHA: the test file mocks '../../../src/utils/retry.js' fully (line 41); retryAgentPrompt
    is a passthrough that awaits fn(). So `mockAgent.prompt` call count is the reliable fix-retry
    signal. Do NOT try to assert on the real predicates here.
  - VERIFY: `npx vitest run tests/unit/agents/prp-executor.test.ts -v` GREEN.

Task 6: VALIDATE
  - RUN: npx tsc --noEmit -p tsconfig.json
  - RUN: npx eslint src/utils/retry.ts src/agents/prp-executor.ts
  - RUN: npx prettier --check src/utils/retry.ts src/agents/prp-executor.ts tests/unit/utils/retry.test.ts tests/unit/agents/prp-executor.test.ts
  - RUN: npx vitest run tests/unit/utils/retry.test.ts tests/unit/agents/prp-executor.test.ts -v
  - RUN: npx vitest run --coverage src/utils/retry.ts src/agents/prp-executor.ts   # CONFIRM 100%
  - RUN: npm run validate
  - EXPECT: GREEN. If red:
    * "Property 'timedOut' is missing in type …" → one of the two #runValidationGates literals
      still omits the field. Add it.
    * coverage < 100% → an added branch (helper true/false arm, early-return arm, loop break arm)
      is not exercised. Add the matching test from Task 4/5.
    * LLM-timeout regression test fails (isTransientError(AgentError) === false) → the helper is
      matching AgentError somehow; it should NOT (AgentError has no timedOut/exitCode). Re-check.
```

### Implementation Patterns & Key Details

```typescript
// PATTERN (Layer A): the helper short-circuits BOTH predicates, before message patterns.

export function isWatchdogKillResult(error: unknown): boolean {
  if (error == null || typeof error !== 'object') return false;
  const e = error as { timedOut?: unknown; exitCode?: unknown };
  return e.timedOut === true || e.exitCode === 124;
}

export function isTransientError(error: unknown): boolean {
  if (error == null || typeof error !== 'object') return false;
  const err = error as RetryableError;
  if (isWatchdogKillResult(err)) return false; // ← ADD: terminal, before message fallback
  if (isPipelineError(err)) { /* …unchanged… */ }
  // …rest unchanged…
}

export function isPermanentError(error: unknown): boolean {
  if (error == null || typeof error !== 'object') return false;
  const err = error as RetryableError;
  if (isWatchdogKillResult(err)) return true; // ← ADD: terminal
  if (isValidationError(err)) return true;
  // …rest unchanged…
}

// PATTERN (Layer B): carry the flag + terminal break.

// In #runValidationGates — EXECUTED gate:
const gateResult: ValidationGateResult = {
  level: gate.level,
  description: gate.description,
  success: result.success,
  command: gate.command,
  stdout: result.stdout,
  stderr: result.stderr,
  exitCode: result.exitCode ?? null,
  skipped: false,
  timedOut: result.timedOut || result.exitCode === 124, // ← ADD: both vectors
};

// In the fix-loop — terminal abort:
while (fixAttempts <= maxFixAttempts) {
  validationResults = await this.#runValidationGates(prp);

  const watchdogKilled = validationResults.some(r => r.timedOut); // ← ADD
  if (watchdogKilled) {                                           // ← ADD
    this.#logger.error(
      { prpTaskId: prp.taskId },
      'Validation gate watchdog-killed (exit 124 / timedOut) — aborting without fix-retry (PRD §9.3.2)'
    );
    break; // → existing allPassed=false → outcome:'fail' path
  }

  // …checkpoint block, allPassed check, fix-attempt logic UNCHANGED…
}

// CRITICAL INVARIANTS:
// 1. isWatchdogKillResult detects BOTH vectors: timedOut===true (Node watchdog, exit 137/143)
//    OR exitCode===124 (timeout coreutil). Keying on one misses the other.
// 2. In isTransientError the helper check is BEFORE the TRANSIENT_PATTERNS message fallback —
//    otherwise a thrown "Command timed out…" error is mis-retried.
// 3. The LLM-timeout path is UNTOUCHED: withAgentDeadline throws a plain AgentError (no
//    timedOut/exitCode fields) → helper returns false → existing transient classification → retried (Req 3.4).
// 4. execute_bash is called DIRECTLY in #runValidationGates (no retry() wrapper). The fix-loop
//    IS the retry surface for validation; the break is the "abort, do not retry" mandate.
// 5. The break reuses the existing allPassed=false → outcome:'fail' logic; no duplicate return/throw.
// 6. retryMcpTool is dead code — do NOT touch it. Shared predicates cover any future caller.
```

### Integration Points

```yaml
RETRY LAYER (src/utils/retry.ts):
  - add: export function isWatchdogKillResult(error): boolean
  - wire: isTransientError → `if (isWatchdogKillResult(err)) return false;` (early, pre-fallback)
  - wire: isPermanentError → `if (isWatchdogKillResult(err)) return true;`  (early)
  - untouched: retry(), retryAgentPrompt(), withAgentDeadline(), retryMcpTool(), calculateDelay(),
    sleep(), all PATTERN/CODE arrays, PipelineError/ValidationError/AgentError classification

EXECUTOR LAYER (src/agents/prp-executor.ts):
  - interface: ValidationGateResult + readonly timedOut: boolean (+ JSDoc)
  - #runValidationGates: populate timedOut on skipped (false) + executed (result.timedOut || exitCode===124) literals
  - fix-loop: terminal `if (watchdogKilled) break;` after validationResults assignment, before checkpoint/allPassed
  - untouched: execute() outcome logic (success/fail/issue), #fixAndRetry, checkpoint plumbing, BashMCP wiring

CONSUMERS (READ-ONLY — NOT modified by S2):
  - src/core/task-orchestrator.ts executeSubtask → consumes PRPExecutor outcome:'fail' via existing TaskError/fail handling
  - P4.M2.T1.S2 (validate.sh abort-on-failure) → will consume the same ValidationGateResult.timedOut / outcome:'fail'

NO CONFIG CHANGES:
  - work item DOCS contract is "none — no user-facing/config/API surface change" → Mode A
    (inline JSDoc rides with the work). No .env.example, no constants.ts, no docs/ edit.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Run after editing the two production files - fix before proceeding
npx tsc --noEmit -p tsconfig.json          # catches missing timedOut on gate-result literals
npx eslint src/utils/retry.ts src/agents/prp-executor.ts
npx prettier --check src/utils/retry.ts src/agents/prp-executor.ts tests/unit/utils/retry.test.ts tests/unit/agents/prp-executor.test.ts

# Project-wide validation (the canonical gate)
npm run validate

# Expected: Zero errors.
# Common: "Property 'timedOut' is missing in type '{ … }' but required in type 'ValidationGateResult'"
#   → one of the two #runValidationGates literals (skipped or executed) still omits timedOut. Add it.
# Common: format:check fails → npx prettier --write on the modified files.
```

### Level 2: Unit Tests (Component Validation)

```bash
# Layer A — retry predicates + loop
npx vitest run tests/unit/utils/retry.test.ts -v

# Layer B — executor abort behavior
npx vitest run tests/unit/agents/prp-executor.test.ts -v

# CRITICAL: confirm 100% coverage on BOTH modified files (project enforces 100%)
npx vitest run --coverage src/utils/retry.ts src/agents/prp-executor.ts

# Expected: All tests pass AND coverage on both files is 100%.
# The added branches: isWatchdogKillResult (true/false arms), the two early-returns in
# isTransientError/isPermanentError, and the fix-loop `if (watchdogKilled) break;` (true-arm via
# the watchdog test, false-arm via the existing normal-failure-fix-retries test).
# Common test bug: the LLM-timeout regression guard fails → the helper is matching AgentError;
#   it must NOT (AgentError has no timedOut/exitCode field). Re-check the duck-type.
# Common test bug: the never-retries test hangs → fn throws on attempt 1, the loop should exit
#   before calculateDelay/sleep; ensure isRetryable(error) returns false (isTransientError → false).
```

### Level 3: Integration Testing (System Validation)

```bash
# Broader suites to confirm no cross-file regression from the interface + predicate changes.
npx vitest run tests/unit/utils/ -v
npx vitest run tests/unit/agents/ -v

# The ValidationGateResult interface change is additive (new required field). Any test that
# constructs a ValidationGateResult literal would now require timedOut — grep confirms producers
# are inside prp-executor.ts itself (test files mock execute_bash, they do not construct the type).
# The isPermanentError/isTransientError change is additive (new early-return) — existing predicate
# tests for ValidationError/ETIMEDOUT/5xx/message-patterns remain GREEN.

# Expected: GREEN. No consumer test breaks.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# (No service/Docker/DB/web surface — this is pure in-process predicate + control-flow logic.)

# Reasoning check — the two terminal vectors, end to end:
#  Vector A (Node watchdog): a PRP gate whose command hangs (e.g. `sleep 1000`) under the 120s
#    execute_bash timeout → BashToolResult.timedOut=true, exitCode 143 → gateResult.timedOut=true
#    → fix-loop breaks → outcome:'fail', fixAttempts:0, no fix-agent call. (Layer-B test proves it.)
#  Vector B (coreutil): a gate command `timeout 5 ./hung-binary` → shell exits 124 →
#    BashToolResult.exitCode=124, timedOut=false → gateResult.timedOut=true (mapped) → same abort.
#  Thrown into a retry() loop: any caller that throws a {timedOut:true}|{exitCode:124} error →
#    isPermanentError=true / isTransientError=false → calls===1. (Layer-A loop test proves it.)
#  Regression: an LLM call exceeding RESEARCH_TIMEOUT → withAgentDeadline throws AgentError →
#    isTransientError=true → retried. (LLM-timeout regression guard proves Req 3.4 intact.)
```

---

## Final Validation Checklist

### Technical Validation

- [ ] All 4 validation levels completed successfully
- [ ] `npm run validate` GREEN (lint + format:check + typecheck + test:run)
- [ ] No linting errors: `npx eslint src/utils/retry.ts src/agents/prp-executor.ts`
- [ ] No type errors: `npx tsc --noEmit -p tsconfig.json`
- [ ] No formatting issues: `npx prettier --check` on the 4 modified files
- [ ] **100% coverage** on `src/utils/retry.ts` AND `src/agents/prp-executor.ts`

### Feature Validation

- [ ] `isPermanentError({ exitCode: 124 })` → `true`; `isPermanentError({ timedOut: true })` → `true`
- [ ] `isTransientError({ exitCode: 124, message: 'Command timed out…' })` → `false` (false-positive trap closed)
- [ ] `isTransientError(new AgentError('…RESEARCH_TIMEOUT…'))` → `true` **UNCHANGED** (Req 3.4 intact)
- [ ] `retry()` throwing a `{ timedOut: true }` error calls `fn` exactly ONCE (never retried)
- [ ] `ValidationGateResult` has `readonly timedOut: boolean` with JSDoc citing PRD §9.3.2 / P3.M2.T2.S2
- [ ] `#runValidationGates` populates `timedOut` on BOTH the skipped (`false`) and executed (`result.timedOut || exitCode===124`) literals
- [ ] The fix-loop breaks (→ `outcome:'fail'`, `fixAttempts:0`, no fix prompt) for a watchdog-killed gate AND a coreutil-124 gate
- [ ] A normal validation failure STILL triggers fix-and-retry (false-arm of the new branch covered)
- [ ] `retryAgentPrompt` / `withAgentDeadline` / `retryMcpTool` signatures UNCHANGED; no new wrapper functions

### Code Quality Validation

- [ ] Helper named `isWatchdogKillResult` (matches `isTransientError`/`isPermanentError` convention)
- [ ] Helper checks BOTH vectors (`timedOut === true || exitCode === 124`)
- [ ] Helper runs BEFORE the message-pattern fallback in `isTransientError`
- [ ] No new dependencies (`package.json` `dependencies` byte-identical)
- [ ] No new exported wrapper functions; `retryMcpTool` left untouched (dead code)
- [ ] `break` reuses existing `outcome:'fail'` logic — no duplicate return/throw
- [ ] Change is purely additive on predicates + one interface field + one loop guard

### Documentation & Deployment

- [ ] `isWatchdogKillResult` JSDoc explains the two vectors and the LLM-timeout distinction
- [ ] `ValidationGateResult.timedOut` JSDoc cites PRD §9.3.2 / P3.M2.T2.S2
- [ ] Loop-level error log message references PRD §9.3.2
- [ ] No new env vars or config (DOCS contract: "none")

---

## Anti-Patterns to Avoid

- ❌ Don't place the `isWatchdogKillResult` check AFTER the `TRANSIENT_PATTERNS` message fallback in
  `isTransientError` — a thrown "Command timed out…" error would be retried (the exact bug).
- ❌ Don't key detection on `exitCode === 124` ALONE — the Node-watchdog vector uses `timedOut: true`
  with exitCode 137/143. Detect BOTH (`timedOut === true || exitCode === 124`).
- ❌ Don't break the LLM-timeout retry path. `withAgentDeadline`'s `AgentError` has NO
  `timedOut`/`exitCode` fields → the helper returns false → it must fall through to the existing
  transient classification (Req 3.4). The regression test pins this.
- ❌ Don't add exit-124 handling to `retryMcpTool` or start using it — it's dead code. The shared
  predicates cover any future caller; adding logic there is unverifiable and rots.
- ❌ Don't wrap `execute_bash` in a new retry loop or in `retry()`. `#runValidationGates` is a
  single-shot; the fix-loop IS the retry surface. S2 adds a terminal BREAK, not a retry wrapper.
- ❌ Don't throw from the fix-loop on a watchdog kill. Use `break` → existing `outcome:'fail'`
  path. Throwing would muddy the tri-state outcome (`success|fail|issue`).
- ❌ Don't forget the SKIPPED-gate literal in `#runValidationGates` — once `ValidationGateResult`
  requires `timedOut`, TypeScript flags both literals; add `timedOut: false` to the skipped one.
- ❌ Don't try to assert on the real `isPermanentError`/`isTransientError` inside
  `tests/unit/agents/prp-executor.test.ts` — that file fully mocks `../../../src/utils/retry.js`.
  Layer-A predicate tests MUST live in `tests/unit/utils/retry.test.ts`; Layer-B tests assert
  behavior (outcome / fixAttempts / `mockAgent.prompt` call count).
- ❌ Don't mark `ValidationGateResult.timedOut` optional (`?`). It must be present on every gate
  result or the loop's `.some(r => r.timedOut)` cannot rely on it.