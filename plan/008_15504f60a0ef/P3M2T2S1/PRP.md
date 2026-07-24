# PRP — P3.M2.T2.S1: Detect exit 124 in bash-mcp and surface timedOut flag

---

## Goal

**Feature Goal**: **Surface the watchdog/timeout state onto `BashToolResult`** by adding
`timedOut: boolean` and `killed: boolean` fields to the interface in `src/tools/bash-mcp.ts`
and populating them from the internal locals that `executeBashCommand` ALREADY maintains. This
closes the gap documented in `architecture/phase_findings.md` §PHASE 3 Finding G4: a validation
gate killed by the watchdog (the Node `setTimeout` → `child.kill('SIGTERM'→'SIGKILL')` path) is
currently indistinguishable from a genuine validation failure, because the consumer
(`PRPExecutor.#runValidationGates`) only sees `success/stdout/stderr/exitCode`. Surfacing the flag
is the foundational contract for the next subtask **P3.M2.T2.S2**, which will wire
`result.timedOut` / `exitCode === 124` into `retry.ts` as a **terminal (non-retryable) failure**
per PRD §9.3.2 ("Watchdog kills are terminal").

**Deliverable** (2 files: 1 modified production tool + 1 modified test):
1. **`src/tools/bash-mcp.ts`** — MODIFY:
   - Add `timedOut: boolean` and `killed: boolean` to the `BashToolResult` interface.
   - Populate both fields in **all three** resolution sites of `executeBashCommand`:
     (a) the `close` handler object literal (read the existing in-closure locals `timedOut`/`killed`),
     (b) the async `error` event handler literal (`false`/`false`), and
     (c) the synchronous `spawn()` `catch` literal (`false`/`false`).
   - Add a JSDoc note to `BashToolResult` documenting that `timedOut === true` means the Node
     watchdog fired (work item DOCS contract — no user-facing/config/API surface change; the
     comment rides WITH the work).
   - **No new exported symbols. No new dependencies. No change to `success` semantics.**
2. **`tests/unit/tools/bash-mcp.test.ts`** — MODIFY/ADD: extend existing assertions (and add
   focused new ones) so that every resolution path asserts `timedOut`/`killed`, maintaining
   **100% coverage** on `src/tools/bash-mcp.ts`.

**Scope note (critical):** This task is **ONLY the bash-mcp tool layer**. It does NOT touch
`src/agents/prp-executor.ts` (`#runValidationGates` is a CONSUMER and will read the new fields in
a later task, not here), `src/utils/retry.ts` (S2's territory), `src/core/checkpoint-manager.ts`
(separate `ValidationGateResult`), or the `timeout` coreutil. It COMPLETES the S1 half of
P3.M2.T2; S2 consumes the surfaced flag.

**Success Definition**:
- `BashToolResult` carries `timedOut: boolean` and `killed: boolean` on EVERY returned object,
  populated truthfully: `timedOut === true && killed === true` when the Node watchdog
  (`setTimeout` → `child.kill`) fires; `false`/`false` on normal success, normal non-zero exit,
  and spawn errors.
- The Node-watchdog detection is keyed on the EXISTING internal `timedOut`/`killed` locals
  (which are already correctly set) — S1 only SURFACES them; it does not re-derive them.
- The literal exit-code-124 signal from the `timeout` coreutil (when a PRP `validate.sh` wraps a
  command in `timeout SECS cmd`) continues to flow through UNCHANGED as `exitCode: 124` — S1 does
  NOT rewrite or hide it (S2 handles both vectors).
- `npm run validate` GREEN; **100% coverage** on `src/tools/bash-mcp.ts` maintained.

---

## User Persona (if applicable)

**Target User**: The autonomous pipeline's retry layer (`src/utils/retry.ts`, to be wired by
P3.M2.T2.S2) and, transitively, `PRPExecutor.#runValidationGates`. No human in the loop.
**Use Case**: A validation gate command hangs (infinite loop, deadlock, wedged build). The bash
watchdog fires after the gate's timeout, SIGTERM→SIGKILLs the process, and the `close` handler
resolves. Without S1, `BashToolResult` reports only `success: false` + an exit code (137/143).
The retry layer cannot tell this apart from "the test suite legitimately failed," so it retries —
and the hung process re-hangs on every attempt, churning retries against a terminal condition
(PRD §9.3.2: "a hung process will simply re-hang, so churning retries is wrong"). S1 surfaces
`timedOut: true` so S2 can treat it as terminal.
**User Journey**: PRP validation gate executes via `BashMCP.execute_bash` → command hangs → Node
watchdog `setTimeout` fires → sets internal `timedOut=true, killed=true` → `child.kill('SIGTERM')`
→ (grace) → `child.kill('SIGKILL')` → `close` handler → **[NEW, S1] result.timedOut=true,
result.killed=true** → `PRPExecutor` records the gate result → (S2) retry layer sees
`result.timedOut === true` and aborts instead of retrying.
**Pain Points Addressed**: PRD §9.3.2 *"Watchdog kills are terminal: Retry loops … MUST treat a
watchdog kill (exit 124) as a hard failure … so churning retries is wrong."* Today the retry layer
has no signal to act on; S1 provides the signal.

---

## Why

- **PRD compliance**: PRD §9.3.2 (h4.9) explicitly mandates: *"Watchdog kills are terminal: Retry
  loops (the bash `run_with_retry` / `run_with_retry_stdin` and their Groundswell equivalents)
  MUST treat a watchdog kill (exit 124) as a hard failure — a hung process will simply re-hang, so
  churning retries is wrong. This applies to validation under `VALIDATION_TIMEOUT` (§4.4): a
  watchdog-killed validation aborts the run and is not retried."* This PRD requirement is
  unimplementable until the watchdog state is VISIBLE on the result. S1 makes it visible; S2
  enforces it.
- **Contract item 1 (RESEARCH NOTE)**: *"BashToolResult exposes {success, stdout, stderr,
  exitCode, error} — internal timedOut/killed flags are NOT surfaced. PRPExecutor.#runValidationGates
  checks only result.success, so a SIGKILL'd validation is retried. bash-mcp.ts uses
  SIGTERM→SIGKILL."* → S1 surfaces the flags.
- **Contract item 3 (LOGIC)**: *"(a) Add `timedOut: boolean` and `killed: boolean` to BashToolResult
  interface in src/tools/bash-mcp.ts. (b) Populate these fields in executeBashCommand when the
  process is killed by the watchdog/timeout (exit 124 or signal). (c) The executeBashCommand
  function already handles SIGTERM→SIGKILL; ensure the timedOut flag is set when the timeout
  fires."* → all three sub-points implemented. NOTE on "exit 124 or signal": the Node-watchdog
  path produces a SIGNAL kill (exit 137/143), which S1 detects via the `timedOut` local; the
  literal `exitCode === 124` comes only from the `timeout` coreutil (used by PRP `validate.sh`
  wrappers) and already passes through unchanged. See research/02 for the decision matrix.
- **Contract item 4 (OUTPUT)**: *"BashToolResult surfaces timedOut/killed flags. Consumed by
  P3.M2.T2.S2."* → S1's output is the contract S2 keys on (`result.timedOut === true`).
- **Contract item 5 (DOCS)**: *"none — no user-facing/config/API surface change."* → Mode A: a
  JSDoc note on `BashToolResult.timedOut` rides WITH the work (no separate docs edit).
- **Why surface BOTH `timedOut` and `killed`**: The work item explicitly requests both. In this
  tool the ONLY reason `child.kill()` is invoked is the watchdog, so in the `close` handler
  `timedOut === killed === true` whenever the watchdog fired. Surfacing both gives S2 a redundant,
  robust signal and matches the existing internal-local names verbatim (zero rename risk, minimal
  diff). See research/02.
- **Why NOT synthesize exit 124**: bash-mcp never invokes the `timeout` coreutil; forcing a
  literal `124` would require rewriting the real exit code and would HIDE the actual signal-exit
  code (137/143) from consumers. The `timedOut` boolean is the authoritative source of truth for
  THIS tool's watchdog. S2 additionally checks `exitCode === 124` for the validate.sh/coreutil
  path.

---

## What

One modified production tool (`bash-mcp.ts`), one modified test (`bash-mcp.test.ts`). **No** config,
**no** new files, **no** new dependencies, **no** consumer changes.

### Success Criteria

- [ ] **`BashToolResult` interface in `src/tools/bash-mcp.ts` declares `timedOut: boolean` and
      `killed: boolean`** (required, non-optional — no `?`).
- [ ] **The `close` handler** builds the result object literal WITH `timedOut` and `killed` read
      from the existing in-closure locals of the same names. When the watchdog fired, both are
      `true`; otherwise `false`.
- [ ] **The async `error` event handler** literal includes `timedOut: false, killed: false` (a
      spawn/child error is never a watchdog kill).
- [ ] **The synchronous `spawn()` `catch`** literal includes `timedOut: false, killed: false`.
- [ ] **`success` semantics are UNCHANGED**: still computed as
      `exitCode === 0 && !timedOut && !killed`. A timed-out command remains `success: false`.
- [ ] **`exitCode` is passed through UNCHANGED** — S1 does not rewrite 137/143 to 124 or vice
      versa. The `timeout`-coreutil `124` continues to surface as `exitCode: 124`.
- [ ] **`BashToolResult.timedOut` JSDoc** documents that `true` means the Node watchdog
      (`setTimeout` → `child.kill`) fired, and references PRD §9.3.2 / P3.M2.T2.S1.
- [ ] **Tests assert the flags on every resolution path**: watchdog-fired (true/true), normal
      success (false/false), normal non-zero exit (false/false), spawn `catch` (false/false),
      async child `error` event (false/false).
- [ ] **100% coverage on `src/tools/bash-mcp.ts`** maintained: `npm run test:coverage` GREEN.
- [ ] `npm run validate` GREEN; `package.json` `dependencies` byte-identical.

---

## All Needed Context

### Context Completeness Check

✅ "If someone knew nothing about this codebase, would they have everything needed to implement
this successfully?" — YES. This PRP names: the exact file (`src/tools/bash-mcp.ts`), the exact
interface (`BashToolResult`), the exact function (`executeBashCommand`), the **three exact
resolution sites** (close handler ~line 180, async error handler ~line 195, sync spawn catch
~line 130) that must carry the new fields, the EXISTING internal locals (`timedOut`/`killed`) to
read from, the exact test file + mock patterns (`createMockChild`, manual non-closing-child stubs),
the 100%-coverage gate, and the S2 consumer contract.

### Documentation & References

```yaml
# MUST READ - Include these in your context window
- file: src/tools/bash-mcp.ts
  why: THE FILE YOU MODIFY. (1) `BashToolResult` interface (~lines 52-66) — ADD `timedOut: boolean`
       and `killed: boolean` (required fields). (2) `executeBashCommand` (~lines 107-205) already
       declares `let timedOut = false; let killed = false;` in the Promise closure (~line 150) and
       sets both to `true` in the watchdog `setTimeout` callback (~line 158). The `close` handler
       (~line 180) builds the result literal — ADD `timedOut, killed,` to it. The async `error`
       handler (~line 195) and the sync `spawn()` catch (~line 130) build literals WITHOUT the
       fields — ADD `timedOut: false, killed: false` to BOTH. (3) `success` is computed as
       `exitCode === 0 && !timedOut && !killed` (~line 183) — DO NOT CHANGE.
  pattern: close handler (paraphrased):
       child.on('close', exitCode => {
         clearTimeout(timeoutId);
         const result: BashToolResult = {
           success: exitCode === 0 && !timedOut && !killed,
           stdout, stderr, exitCode,
           timedOut, killed,   // ← ADD: read the in-closure locals
         };
         if (timedOut) result.error = `Command timed out after ${timeout}ms`;
         else if (exitCode !== 0) result.error = `Command failed with exit code ${exitCode}`;
         resolve(result);
       });
  gotcha: the `close` handler reads `timedOut`/`killed` as CLOSURE variables (the locals declared
          at the top of the Promise body). Do NOT shadow them. The object-literal shorthand
          `{ timedOut, killed }` is correct and idiomatic.

- file: tests/unit/tools/bash-mcp.test.ts
  why: THE TEST FILE YOU MODIFY. Mocks `node:child_process` (spawn) and `node:fs`
       (existsSync/realpathSync) at module level. REUSE: `createMockChild({exitCode, stdout, stderr})`
       for deterministic-close children; the MANUAL non-closing-child stub pattern (see the existing
       'should handle timeout correctly' / 'should send SIGKILL if SIGTERM does not kill process'
       tests) for watchdog tests. Extend the EXISTING assertions to check `result.timedOut`/
       `result.killed`; add focused new tests per research/03.
  pattern: to exercise the watchdog with a real (non-fake) timer, build a child whose `on('close')`
           callback is captured but NOT auto-invoked, set a small `timeout` (e.g. 10-50ms), await
           enough wall-clock for the watchdog + 2s SIGKILL grace, then invoke the captured close
           callback with 143 (SIGTERM) or 137 (SIGKILL) and await the result.
  gotcha: several existing timeout tests trigger `close` but never inspect the resolved result's
          flag fields. At least ONE clean-resolving watchdog test MUST assert
          `result.timedOut === true && result.killed === true`. The existing 'should send SIGKILL
          if SIGTERM does not kill process' test is the best base — extend it to await `resultPromise`
          and assert the flags after the manual `close(137)`.

- file: src/agents/prp-executor.ts   # lines 492-560 (#runValidationGates), 41-54 (ValidationGateResult)
  why: THE DOWNSTREAM CONSUMER — READ ONLY, DO NOT MODIFY in S1. Confirms the consumer currently
       maps only `success/stdout/stderr/exitCode` from BashToolResult onto its own
       `ValidationGateResult`. S1 does NOT change prp-executor.ts; S2 (and possibly a later task)
       decides whether to propagate `timedOut` onto `ValidationGateResult`. S1's job is to make
       the flag AVAILABLE on `BashToolResult`; how/whether the executor forwards it is out of scope.

- file: src/utils/retry.ts   # isTransientError, isPermanentError, retryMcpTool
  why: THE S2 CONSUMER CONTRACT — READ ONLY. S2 will key off `result.timedOut === true` (the flag
       S1 surfaces) AND `result.exitCode === 124` (the coreutil path S1 passes through unchanged).
       S1 must surface the flag truthfully and must NOT rewrite exit codes. See research/02 for
       the decision matrix and the S1/S2 boundary.

- docfile: plan/008_15504f60a0ef/architecture/phase_findings.md   # §PHASE 3 Finding G4 + Retry section
  why: THE SOURCE FINDING. Confirms: "BashToolResult exposes {success, stdout, stderr, exitCode,
       error} — internal timedOut/killed flags are NOT surfaced" and "Required: treat exit 124
       (watchdog kill) as PERMANENT (not transient). Distinct from LLM-generation timeout (should
       be retried)." S1 implements the surfacing half; S2 implements the retry-policy half.

- docfile: plan/008_15504f60a0ef/P3M2T2S1/research/01-current-state.md
  why: Full annotated read of the current `executeBashCommand`, proving the `timedOut`/`killed`
       locals ALREADY exist and are correctly set — S1 only surfaces them.

- docfile: plan/008_15504f60a0ef/P3M2T2S1/research/02-s1-s2-contract-boundary.md
  why: The S1/S2 contract (what fields, what semantics, why both `timedOut` AND `killed`, why NOT
       synthesize exit 124), the decision matrix, and why prp-executor.ts is out of scope.

- docfile: plan/008_15504f60a0ef/P3M2T2S1/research/03-test-design.md
  why: The exact tests to add/extend to hit 100% coverage on the new fields across all three
       resolution sites.
```

### Current Codebase tree (relevant slice)

```bash
src/
  tools/
    bash-mcp.ts          # MODIFY — add timedOut/killed to BashToolResult; populate in 3 sites; JSDoc
  agents/
    prp-executor.ts      # READ-ONLY consumer (#runValidationGates; ValidationGateResult at line 41)
  utils/
    retry.ts             # READ-ONLY S2 target (isTransientError/isPermanentError/retryMcpTool)
  core/
    checkpoint-manager.ts # READ-ONLY (separate ValidationGateResult; out of scope)
tests/
  unit/
    tools/
      bash-mcp.test.ts   # MODIFY/ADD — assert timedOut/killed on every resolution path
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
src/tools/bash-mcp.ts
  # MODIFIED (additive; success/exitCode semantics UNCHANGED):
  #   ~ BashToolResult interface: + timedOut: boolean ; + killed: boolean   (required fields)
  #   + JSDoc on BashToolResult.timedOut: "true iff the Node watchdog (setTimeout→child.kill) fired"
  #     citing PRD §9.3.2 / P3.M2.T2.S1
  #   ~ close handler result literal: + timedOut, killed   (shorthand for in-closure locals)
  #   ~ async 'error' handler literal: + timedOut: false, killed: false
  #   ~ sync spawn() catch literal: + timedOut: false, killed: false
tests/unit/tools/bash-mcp.test.ts
  # MODIFIED:
  #   ~ 'should return failure for non-zero exit code' → assert result.timedOut===false, killed===false
  #   ~ 'should execute simple command successfully' → assert flags false/false
  #   ~ 'should handle spawn errors (command not found)' → assert flags false/false
  #   ~ 'should handle async child process error events' → assert flags false/false
  #   ~ 'should handle non-Error objects thrown during spawn' → assert flags false/false
  #   ~ 'should send SIGKILL if SIGTERM does not kill process' (or a new dedicated test) →
  #     await the resolved result and assert result.timedOut===true && result.killed===true
  #   + new focused test 'should surface timedOut=true and killed=true when the watchdog fires'
  #     (clean single-purpose watchdog test asserting the resolved BashToolResult flags)
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL: the `timedOut`/`killed` locals ALREADY EXIST in executeBashCommand's Promise closure
// and are ALREADY set correctly by the watchdog setTimeout callback. S1 only SURFACES them onto
// the returned object. Do NOT re-derive, re-compute, or duplicate the watchdog logic.

// CRITICAL: ALL THREE resolution sites must carry the new fields, or BashToolResult becomes
// structurally inconsistent. TypeScript will catch a missing field on a typed literal (the
// interface now requires them), but verify all three:
//   (a) close handler object literal (~line 180)
//   (b) async child 'error' event handler literal (~line 195)
//   (c) synchronous spawn() catch literal (~line 130)

// CRITICAL: do NOT change `success` semantics. It stays `exitCode === 0 && !timedOut && !killed`.
// A timed-out command is already success:false. S1's value-add is the NEW boolean signal, not a
// change to the existing one.

// CRITICAL: do NOT rewrite exitCode. The Node-watchdog path yields 137 (SIGKILL) or 143 (SIGTERM);
// the `timeout`-coreutil path yields 124. S1 passes exitCode through UNCHANGED so S2 can detect
// BOTH vectors (result.timedOut===true OR result.exitCode===124). Synthesizing 124 would HIDE the
// real signal-exit code from other consumers.

// GOTCHA: the close handler reads `timedOut`/`killed` as closure variables. The object-literal
// shorthand `{ success, stdout, stderr, exitCode, timedOut, killed }` is correct. Do NOT write
// `timedOut: timedOut` (redundant) and do NOT shadow the locals with a same-named const.

// GOTCHA: several existing timeout tests build a manual non-closing child and invoke the captured
// close callback with 143/137 but NEVER inspect the resolved result. At least ONE watchdog test
// must `await resultPromise` (after triggering close) and assert `result.timedOut===true &&
// result.killed===true`. The existing 'should send SIGKILL if SIGTERM does not kill process' test
// is the best base; extend it OR add a dedicated clean test.

// GOTCHA: 100% coverage is ENFORCED (vitest.config.ts thresholds 100% on src/**/*.ts). The new
// fields are boolean literals populated unconditionally → they add NO branches, so branch coverage
// is unaffected. The risk is a resolution site being UNREACHABLE in tests; the existing suite
// already covers all three sites (success, non-zero exit, spawn catch, async error, watchdog) —
// just extend the assertions.

// GOTCHA: do NOT add a dependency on the `timeout` coreutil or any new npm package. The
// watchdog is pure Node (setTimeout + child.kill). package.json dependencies must be byte-identical.

// GOTCHA: BashMCP.execute_bash and the MCP tool executor both delegate to executeBashCommand, so
// surfacing the fields on the return value covers BOTH the direct (PRPExecutor) and MCP paths in
// one change. No separate MCP-layer work needed.
```

---

## Implementation Blueprint

### Data models and structure

One interface modification (two new required boolean fields). No new types.

```typescript
// src/tools/bash-mcp.ts — MODIFIED interface:

/**
 * Result from bash command execution
 */
interface BashToolResult {
  /** True if command succeeded (exit code 0 and not timed out / killed) */
  success: boolean;
  /** Standard output from command */
  stdout: string;
  /** Standard error from command */
  stderr: string;
  /** Exit code from process (null if spawn failed). UNCHANGED — S1 does not rewrite it. */
  exitCode: number | null;
  /** Error message if spawn failed or timed out */
  error?: string;
  /**
   * True iff the Node watchdog fired — i.e. the command exceeded its `timeout`
   * and `executeBashCommand` invoked `child.kill('SIGTERM'→'SIGKILL')`.
   *
   * PRD §9.3.2 ("Watchdog kills are terminal"): a timed-out validation is a
   * HARD, non-retryable failure. This flag lets the retry layer (P3.M2.T2.S2)
   * distinguish a watchdog kill from a genuine non-zero exit and abort instead
   * of churning retries against a hung process. Note: when a PRP `validate.sh`
   * wraps a command in the `timeout` coreutil, the shell itself exits 124 —
   * that surfaces here as `exitCode: 124` (with `timedOut: false`, because the
   * NODE watchdog did not fire); consumers should treat EITHER signal as terminal.
   */
  timedOut: boolean;
  /**
   * True iff `child.kill()` was invoked (SIGTERM or SIGKILL). In this tool the
   * only caller of `kill()` is the watchdog, so `killed === timedOut` in the
   * close handler; surfaced separately as a redundant, robust signal per the
   * P3.M2.T2.S1 contract.
   */
  killed: boolean;
}
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: ADD timedOut/killed to the BashToolResult interface (src/tools/bash-mcp.ts)
  - LOCATE the `interface BashToolResult` (~lines 52-66).
  - ADD two required fields (NO `?`): `timedOut: boolean;` and `killed: boolean;` with the JSDoc
    above (the timedOut JSDoc cites PRD §9.3.2 + P3.M2.T2.S1 and explains the exit-124-vs-flag
    distinction — Mode A docs riding with the work).
  - NAMING: `timedOut` / `killed` (camelCase, matching the existing internal locals verbatim —
    zero rename risk).
  - GOTCHA: do NOT mark them optional (`?`). They must be present on EVERY BashToolResult, or
    consumers cannot rely on `result.timedOut`.
  - VERIFY: `npx tsc --noEmit -p tsconfig.json` will now FAIL on the three object literals that
    omit the fields — that is expected; Task 2 fixes them.

Task 2: POPULATE timedOut/killed in all three resolution sites of executeBashCommand
  - SITE A — the `close` handler result literal (~line 180). It currently reads:
        const result: BashToolResult = {
          success: exitCode === 0 && !timedOut && !killed,
          stdout,
          stderr,
          exitCode,
        };
    ADD the in-closure locals via shorthand:
        const result: BashToolResult = {
          success: exitCode === 0 && !timedOut && !killed,
          stdout,
          stderr,
          exitCode,
          timedOut,
          killed,
        };
    (Do NOT change the `success` computation or the `if (timedOut) … else if (exitCode !== 0) …`
    error-message logic — those are correct.)
  - SITE B — the async child 'error' event handler (~line 195). It currently resolves:
        resolve({ success: false, stdout, stderr, exitCode: null, error: error.message });
    CHANGE to:
        resolve({
          success: false,
          stdout,
          stderr,
          exitCode: null,
          error: error.message,
          timedOut: false,
          killed: false,
        });
    (A child 'error' event is never a watchdog kill.)
  - SITE C — the synchronous spawn() catch (~line 130). It currently returns:
        return Promise.resolve({
          success: false, stdout: '', stderr: '', exitCode: null,
          error: error instanceof Error ? error.message : String(error),
        });
    ADD `timedOut: false, killed: false,` to the literal. (A spawn failure happens BEFORE any
    watchdog could fire.)
  - PRESERVE: the cwd-validation logic, the spawn options (`shell: true`, stdio), the watchdog
    setTimeout + 2s SIGKILL grace, the stdout/stderr `if (killed) return;` guards. S1 is purely
    ADDITIVE on the returned objects.
  - VERIFY: `npx tsc --noEmit -p tsconfig.json` GREEN (all three literals now satisfy the interface).

Task 3: MODIFY tests/unit/tools/bash-mcp.test.ts — assert flags on every resolution path
  - READ the existing suite first. The mocks (`createMockChild`, manual non-closing-child stubs)
    are reused as-is.
  - EXTEND existing tests with flag assertions (additive — do not remove existing assertions):
      * 'should execute simple command successfully' (createMockChild exitCode 0) →
        expect(result.timedOut).toBe(false); expect(result.killed).toBe(false);
      * 'should return failure for non-zero exit code' (exitCode 1) → flags false/false.
      * 'should handle spawn errors (command not found)' (spawn throws) → flags false/false.
      * 'should handle async child process error events' (child 'error' event) → flags false/false.
      * 'should handle non-Error objects thrown during spawn' → flags false/false.
  - ADD a focused watchdog test (cleanest if new; or extend 'should send SIGKILL if SIGTERM does
    not kill process'):
        it('should surface timedOut=true and killed=true when the watchdog fires', async () => {
          // SETUP: manual non-closing child capturing the close callback; small timeout (e.g. 10ms).
          // EXECUTE: executeBashCommand({ command: 'hang', timeout: 10 }).
          // AWAIT: enough wall-clock for the watchdog setTimeout to fire (e.g. 30-50ms).
          // ASSERT (pre-close): mockChild.kill was called with 'SIGTERM' (and 'SIGKILL' after 2s
          //   if you wait that long — waiting for SIGKILL is optional; the flag is set on the
          //   FIRST watchdog tick, before SIGKILL).
          // TRIGGER: invoke the captured close callback with 143 (or 137).
          // AWAIT: the result promise.
          // VERIFY: result.timedOut === true; result.killed === true; result.success === false;
          //         result.exitCode === 143; result.error contains 'timed out'.
        });
    NOTE: the watchdog sets `timedOut=true; killed=true` on the FIRST setTimeout tick (before the
    2s SIGKILL grace). You do NOT need to wait 2s to assert the flags — waiting ~30ms is enough
    for the SIGTERM tick; then manually close(143) to resolve the promise.
  - GOTCHA: do NOT use `vi.useFakeTimers()` for the watchdog test unless you also advance the
    inner 2s SIGKILL timer — the existing 'should include timeout error in result' test learned
    this the hard way (it fell back to real timers). Prefer REAL timers with small values
    (timeout: 10, await 30-50ms) for the new watchdog test, matching the existing
    'should handle timeout correctly' pattern.
  - VERIFY: `npx vitest run tests/unit/tools/bash-mcp.test.ts -v` GREEN.
  - VERIFY: `npx vitest run --coverage src/tools/bash-mcp.ts` → 100% on the file.

Task 4: VALIDATE
  - RUN: npx tsc --noEmit -p tsconfig.json
  - RUN: npx eslint src/tools/bash-mcp.ts
  - RUN: npx prettier --check src/tools/bash-mcp.ts tests/unit/tools/bash-mcp.test.ts
  - RUN: npx vitest run tests/unit/tools/bash-mcp.test.ts -v
  - RUN: npx vitest run --coverage src/tools/bash-mcp.ts   # CONFIRM 100%
  - RUN: npm run validate
  - EXPECT: GREEN. If red:
    * "Property 'timedOut' is missing in type …" → a resolution-site literal (close/error/catch)
      still omits the fields. Add them.
    * coverage < 100% → unlikely (no new branches), but if so, a resolution site is unreachable;
      the existing tests already cover all sites — verify the watchdog test resolves cleanly.
    * format:check fails → npx prettier --write on the two modified files.
```

### Implementation Patterns & Key Details

```typescript
// PATTERN: close handler — surface the in-closure watchdog locals via shorthand.
child.on('close', exitCode => {
  clearTimeout(timeoutId);
  const result: BashToolResult = {
    success: exitCode === 0 && !timedOut && !killed, // UNCHANGED
    stdout,
    stderr,
    exitCode,
    timedOut, // ← ADD (reads closure local)
    killed, // ← ADD (reads closure local)
  };
  if (timedOut) {
    result.error = `Command timed out after ${timeout}ms`; // UNCHANGED
  } else if (exitCode !== 0) {
    result.error = `Command failed with exit code ${exitCode}`; // UNCHANGED
  }
  resolve(result);
});

// PATTERN: async 'error' handler — explicit false/false (no watchdog involved).
child.on('error', (error: Error) => {
  clearTimeout(timeoutId);
  resolve({
    success: false,
    stdout,
    stderr,
    exitCode: null,
    error: error.message,
    timedOut: false, // ← ADD
    killed: false, // ← ADD
  });
});

// PATTERN: sync spawn() catch — explicit false/false (fails before any watchdog).
} catch (error) {
  return Promise.resolve({
    success: false,
    stdout: '',
    stderr: '',
    exitCode: null,
    error: error instanceof Error ? error.message : String(error),
    timedOut: false, // ← ADD
    killed: false, // ← ADD
  });
}

// CRITICAL INVARIANTS:
// 1. `timedOut`/`killed` are REQUIRED on BashToolResult (no `?`) — every literal carries them.
// 2. In the close handler they read the EXISTING closure locals (set true by the watchdog
//    setTimeout callback). S1 does NOT re-derive them.
// 3. `success` semantics UNCHANGED: `exitCode === 0 && !timedOut && !killed`.
// 4. `exitCode` passed through UNCHANGED (137/143 for Node-watchdog signal kills; 124 for the
//    `timeout` coreutil path). S1 does not rewrite exit codes.
// 5. The 2s SIGTERM→SIGKILL grace, the `if (killed) return;` stdout/stderr guards, and the cwd
//    validation are ALL unchanged. S1 is purely additive on the returned objects.
// 6. Both the direct path (BashMCP.execute_bash) and the MCP tool-executor path delegate to
//    executeBashCommand → both surfaces get the flags in one change.
```

### Integration Points

```yaml
TOOL LAYER:
  - modify: src/tools/bash-mcp.ts
  - interface: BashToolResult +timedOut: boolean, +killed: boolean (required)
  - function: executeBashCommand — populate fields in close handler (shorthand) + error/catch (false/false)
  - docs: BashToolResult.timedOut JSDoc (Mode A, rides with work; cites PRD §9.3.2 / P3.M2.T2.S1)
  - untouched: BashToolInput, bashTool schema, BashMCP class, DEFAULT_TIMEOUT, cwd validation,
    watchdog setTimeout/SIGKILL grace, success computation

CONSUMERS (READ-ONLY — NOT modified by S1):
  - src/agents/prp-executor.ts #runValidationGates — currently maps success/stdout/stderr/exitCode
    onto its own ValidationGateResult. Reading result.timedOut is a FUTURE task, not S1.
  - src/utils/retry.ts — S2 (P3.M2.T2.S2) will key off result.timedOut===true OR result.exitCode===124
    as a terminal/non-retryable failure. S1 makes the flag available; S2 consumes it.

NO CONFIG CHANGES:
  - work item DOCS contract is "none — no user-facing/config/API surface change" → Mode A
    (JSDoc rides with the work). No .env.example, no constants.ts, no docs/ edit.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Run after editing bash-mcp.ts - fix before proceeding
npx tsc --noEmit -p tsconfig.json            # catches any resolution-site literal missing the new fields
npx eslint src/tools/bash-mcp.ts
npx prettier --check src/tools/bash-mcp.ts tests/unit/tools/bash-mcp.test.ts

# Project-wide validation (the canonical gate)
npm run validate

# Expected: Zero errors. If errors exist, READ output and fix before proceeding.
# Common: "Property 'timedOut' is missing in type '{ ... }' but required in type 'BashToolResult'"
#   → one of the three resolution-site literals (close/error/catch) still omits the field. Add it.
# Common: format:check fails → npx prettier --write on the two modified files.
```

### Level 2: Unit Tests (Component Validation)

```bash
# Modified tool (all resolution paths)
npx vitest run tests/unit/tools/bash-mcp.test.ts -v

# CRITICAL: confirm 100% coverage on bash-mcp.ts (project enforces 100%)
npx vitest run --coverage src/tools/bash-mcp.ts

# Expected: All tests pass AND coverage on src/tools/bash-mcp.ts is 100%.
# The new fields are boolean literals populated unconditionally → they add NO branches, so branch
# coverage is unaffected. If coverage drops, a resolution site became unreachable — but the
# existing suite already covers success / non-zero-exit / spawn-catch / async-error / watchdog,
# so this should not happen. Verify the new watchdog test resolves cleanly (it must await the
# result after manually triggering close).
# Common test bug: the watchdog test used vi.useFakeTimers() but didn't advance the inner 2s
#   SIGKILL timer → the result never resolves. Prefer REAL timers with small values
#   (timeout: 10, await 30-50ms), matching the existing 'should handle timeout correctly' test.
# Common test bug: forgot to `await resultPromise` after invoking the captured close callback →
#   assertions run before the promise resolves. Always await.
```

### Level 3: Integration Testing (System Validation)

```bash
# (No service to start — this is a synchronous tool-layer change. The integration surface is the
#  unit tests + typecheck. There is no bash-mcp integration/e2e test file.)

# Sanity: run the broader tools suite to confirm no cross-file regression from the interface change.
npx vitest run tests/unit/tools/ -v

# Expected: GREEN. The interface change is additive (new required fields); any consumer test that
# constructs a BashToolResult literal would now require the fields — grep confirms the only
# producers of BashToolResult are inside bash-mcp.ts itself (the test file mocks the function, it
# does not construct the type). So no consumer test breaks.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# (This task has no web/Docker/DB/performance surface — it surfaces two booleans on a tool result.)

# Optional manual reasoning check: construct the hung-validation scenario — a PRP gate whose
# command hangs (e.g. `sleep 1000`) with a 2s timeout. Pre-S1: result.success===false, exitCode
# 137/143, NO way to tell it was a watchdog kill. Post-S1: result.timedOut===true &&
# result.killed===true → S2 can abort retries. The new watchdog unit test is the executable proof.
```

---

## Final Validation Checklist

### Technical Validation

- [ ] All 4 validation levels completed successfully
- [ ] `npm run validate` GREEN (lint + format:check + typecheck + test:run)
- [ ] No linting errors: `npx eslint src/tools/bash-mcp.ts`
- [ ] No type errors: `npx tsc --noEmit -p tsconfig.json`
- [ ] No formatting issues: `npx prettier --check` on modified files
- [ ] **100% coverage on `src/tools/bash-mcp.ts`**: `npx vitest run --coverage src/tools/bash-mcp.ts`

### Feature Validation

- [ ] `BashToolResult` declares `timedOut: boolean` and `killed: boolean` (required, no `?`)
- [ ] `close` handler reads the in-closure `timedOut`/`killed` locals into the result
- [ ] Async `error` handler literal carries `timedOut: false, killed: false`
- [ ] Sync `spawn()` catch literal carries `timedOut: false, killed: false`
- [ ] Watchdog-fired result has `timedOut === true && killed === true` (unit test asserts)
- [ ] Normal success / non-zero exit / spawn-error results have both flags `false` (unit tests assert)
- [ ] `success` semantics UNCHANGED (`exitCode === 0 && !timedOut && !killed`)
- [ ] `exitCode` passed through UNCHANGED (no 137/143 → 124 rewrite)
- [ ] `BashToolResult.timedOut` JSDoc cites PRD §9.3.2 / P3.M2.T2.S1 and explains the exit-124 distinction

### Code Quality Validation

- [ ] Field names `timedOut`/`killed` match the existing internal locals (zero rename risk)
- [ ] Both flags surfaced (work item explicitly requests both; redundant robust signal for S2)
- [ ] No new dependencies (`package.json` `dependencies` byte-identical)
- [ ] No new exported symbols; no config surface (work item DOCS is Mode A — JSDoc only)
- [ ] Change is purely additive on returned objects; watchdog/SIGKILL/cwd logic untouched
- [ ] Both the direct (`BashMCP.execute_bash`) and MCP tool-executor paths get the flags in one change

### Documentation & Deployment

- [ ] `BashToolResult.timedOut` JSDoc explains WHY the flag exists (terminal-failure signal for S2)
- [ ] JSDoc explains the dual detection vectors (Node-watchdog `timedOut===true` vs coreutil `exitCode===124`)
- [ ] No new env vars or config (DOCS contract: "none")

---

## Anti-Patterns to Avoid

- ❌ Don't re-derive or duplicate the watchdog logic — the `timedOut`/`killed` locals ALREADY EXIST
  and are correctly set. S1 only SURFACES them onto the returned object.
- ❌ Don't mark the new fields optional (`?`). They must be present on EVERY `BashToolResult` or
  consumers cannot rely on `result.timedOut`.
- ❌ Don't omit the fields from ANY of the three resolution sites (close handler, async error
  handler, sync spawn catch). TypeScript will catch typed-literal omissions, but verify all three.
- ❌ Don't change `success` semantics or rewrite `exitCode` (e.g. synthesizing 124). The Node
  watchdog yields 137/143; the `timeout` coreutil yields 124; both must pass through unchanged so
  S2 can detect both vectors.
- ❌ Don't touch `src/agents/prp-executor.ts` or `src/utils/retry.ts` — prp-executor is a consumer
  (forwarding `timedOut` onto `ValidationGateResult` is a FUTURE task), and retry.ts is S2's
  territory. S1's blast radius is ONE production file.
- ❌ Don't add a dependency on the `timeout` coreutil or any npm package. The watchdog is pure Node.
- ❌ Don't use `vi.useFakeTimers()` for the watchdog test without advancing the inner 2s SIGKILL
  timer — it will hang. Prefer REAL timers with small values, matching the existing timeout tests.
- ❌ Don't shadow the `timedOut`/`killed` closure locals with same-named consts in the close
  handler — use object-literal shorthand `{ timedOut, killed }`.