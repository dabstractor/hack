# Research 02 — Detection Contract, Decision Matrix, and Two-Layer Design

## What S1 (P3.M2.T2.S1) delivers (the input contract)

`BashToolResult` (in `src/tools/bash-mcp.ts`, exported at line 329) NOW carries:
```ts
interface BashToolResult {
  success: boolean;        // UNCHANGED: exitCode===0 && !timedOut && !killed
  stdout: string;
  stderr: string;
  exitCode: number | null; // UNCHANGED — passed through (137/143 for Node-watchdog; 124 for `timeout` coreutil)
  error?: string;
  timedOut: boolean;       // NEW (S1): true iff Node watchdog (setTimeout→child.kill) fired
  killed: boolean;         // NEW (S1): true iff child.kill() was invoked
}
```
Verified present in the current tree (the interface JSDoc already cites "P3.M2.T2.S2"). S1 is COMPLETE.

## Two detection vectors for "watchdog kill" (both terminal)

| Vector | Source | Signal |
|---|---|---|
| **A. Node watchdog** | `executeBashCommand`'s `setTimeout` → `child.kill('SIGTERM'→'SIGKILL')` | `result.timedOut === true` (and `killed === true`, `exitCode` 137/143) |
| **B. `timeout` coreutil** | A PRP `validate.sh` wrapping `timeout SECS cmd` | `result.exitCode === 124` (and `timedOut === false`, because the NODE watchdog did not fire) |

**Both must be treated as permanent/terminal.** A single helper detects either.

## Decision matrix — what each predicate returns

| Input | `isPermanentError` | `isTransientError` |
|---|---|---|
| `{ exitCode: 124 }` (coreutil) | **true (NEW)** | false |
| `{ timedOut: true }` (Node watchdog) | **true (NEW)** | **false (NEW — explicit guard)** |
| `{ killed: true }` | true (covered by timedOut path) | false |
| `{ exitCode: 137 }` w/o timedOut | false (signal kill, unknown cause — leave as-is) | false |
| LLM `AgentError` (PIPELINE_AGENT_LLM_FAILED from `withAgentDeadline`) | false | **true (UNCHANGED — Req 3.4 LLM timeout IS retried)** |
| `ValidationError` | true (unchanged) | false (unchanged) |
| `ETIMEDOUT` / 504 / message contains 'timeout' | false | true (unchanged — network/HTTP timeouts ARE retried) |

### The `'timeout'` message-pattern FALSE-POSITIVE trap
`isTransientError`'s final fallback matches `message.includes('timeout')`. If S2 wraps a watchdog-killed bash result into a thrown error whose message contains the word "timeout" (e.g. "Command timed out after 120000ms"), `isTransientError` would return **true** and retry it — the exact bug the PRD forbids. **S2 must check `exitCode===124`/`timedOut` BEFORE the message-pattern fallback**, and the executor-side throw (if any) must use a message that does not trigger the generic timeout pattern, OR the predicate must short-circuit. See research/03 for the exact ordering.

## The helper function (Layer A, retry.ts)

Add an internal predicate, e.g. `isWatchdogKillResult(error: unknown): boolean`:
```ts
// Detects BOTH vectors. Object-shape duck-typing on BashToolResult-like errors.
function isWatchdogKillResult(error: unknown): boolean {
  if (error == null || typeof error !== 'object') return false;
  const e = error as { timedOut?: unknown; exitCode?: unknown };
  if (e.timedOut === true) return true;
  if (e.exitCode === 124) return true;
  return false;
}
```
- `isPermanentError`: add `if (isWatchdogKillResult(error)) return true;` early (after the null check).
- `isTransientError`: add `if (isWatchdogKillResult(error)) return false;` early — BEFORE the message-pattern fallback, so a thrown "Command timed out…" error carrying `timedOut:true`/`exitCode:124` is NOT retried.

This keeps the **LLM-timeout path intact** (`withAgentDeadline` throws a plain `AgentError` with NO `timedOut`/`exitCode:124` fields → `isWatchdogKillResult` returns false → falls through to the existing `PIPELINE_AGENT_LLM_FAILED` transient classification).

## The executor-side propagation (Layer B, prp-executor.ts)

`ValidationGateResult` (lines 41–58) gets a NEW field:
```ts
export interface ValidationGateResult {
  ...existing...
  /** True iff this gate was killed by a watchdog (Node kill OR `timeout` coreutil exit 124).
   *  Terminal: the fix-and-retry loop MUST abort on this (PRD §9.3.2). */
  readonly timedOut: boolean;
}
```
`#runValidationGates` populates it from the BashToolResult:
```ts
const gateResult: ValidationGateResult = {
  ...existing...,
  exitCode: result.exitCode ?? null,
  timedOut: result.timedOut || result.exitCode === 124,  // ← BOTH vectors
};
```
The fix-loop (lines ~368–422) adds an early terminal check:
```ts
validationResults = await this.#runValidationGates(prp);
// TERMINAL: a watchdog-killed validation is never retried (PRD §9.3.2)
const watchdogKilled = validationResults.some(r => r.timedOut);
if (watchdogKilled) {
  this.#logger.error({ prpTaskId: prp.taskId }, 'Validation gate watchdog-killed (exit 124/timedOut) — aborting without fix-retry');
  break;   // → falls through to outcome: 'fail' (Req 4.4: abort, do not retry)
}
```
The `break` exits the `while`; the existing `allPassed` computation yields `false`; the function returns `outcome: 'fail'` with a clear error. **No `#fixAndRetry` LLM call is made against the hung command.**

## Why NOT throw from the executor
Throwing would route through `executeSubtask`'s catch and muddy the tri-state outcome (`'success'|'fail'|'issue'`). The PRD wants a clean **abort → 'fail'** for watchdog kills, not an exception. The `break`→`'fail'` path is the natural fit and reuses the existing checkpoint-on-fail logic.

## Why `executeSubtask` itself is NOT modified
`TaskOrchestrator.executeSubtask` (task-orchestrator.ts:773) → `prpRuntime.executeSubtask` → `PRPExecutor.execute`. The retry/abort decision belongs in `PRPExecutor`'s validation loop (where the gate result is visible), not in the orchestrator. The work-item's mention of "executeSubtask" refers to the call CHAIN; the concrete edit site is `prp-executor.ts`. `executeSubtask` consumes `PRPExecutor`'s `'fail'` outcome via the existing `TaskError`/fail handling — no change needed there.