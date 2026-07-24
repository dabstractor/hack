# Research 01 — Current State of `src/utils/retry.ts` and Its Callers

## The retry surface (what actually runs)

`src/utils/retry.ts` exports the following. All line numbers are current.

| Symbol | Line | Purpose | Actually called? |
|---|---|---|---|
| `isTransientError(error)` | ~297 | Predicate: is this thrown error retryable? | YES — default `isRetryable` in `retry()` |
| `isPermanentError(error)` | ~352 | Predicate: is this thrown error permanent? | YES — see below |
| `retry<T>(fn, opts)` | ~415 | Generic exponential-backoff loop | YES (via wrappers) |
| `createDefaultOnRetry(name, max)` | ~525 | Builds an `onRetry` logger | YES |
| `retryAgentPrompt<T>(fn, ctx)` | ~651 | Wraps `agent.prompt()` (LLM calls) | YES (prp-executor, prp-generator, delta-analysis, bug-hunt, prp-pipeline) |
| `withAgentDeadline<T>(promise)` | ~678 | Race against `RESEARCH_TIMEOUT` | YES (wraps `agent.prompt` before `retryAgentPrompt`) |
| `retryMcpTool<T>(fn, ctx)` | ~742 | Wraps an MCP tool execution | **NO — defined but NEVER imported/called in src.** Only exercised by `tests/unit/utils/retry.test.ts`. |
| `calculateDelay(...)` | ~210 | Backoff math | YES (+ session-manager, task-retry-manager) |
| `sleep(ms)` | ~195 | Async sleep | YES |

## How retryability is decided

`retry<T>()` (line ~415) calls `options.isRetryable ?? isTransientError` on the THROWN error. The default is `isTransientError`. If `isRetryable(error)` returns `false`, the error is re-thrown immediately (NO retry).

`isTransientError(error)` (line ~297) checks, in order:
1. null/non-object → false
2. `isPipelineError` → check `code` (`PIPELINE_AGENT_TIMEOUT` / `PIPELINE_AGENT_LLM_FAILED` are transient; parse-message ones are not)
3. `isValidationError` → false
4. `err.code` ∈ `TRANSIENT_ERROR_CODES` (ECONNRESET, ETIMEDOUT, …) → true
5. `err.response.status` ∈ `RETRYABLE_HTTP_STATUS_CODES` (408/429/5xx) → true
6. `message` matches `TRANSIENT_PATTERNS` (`'timeout'`, `'network error'`, …) → true

`isPermanentError(error)` (line ~352) mirrors it for permanent cases.

### CRITICAL architectural fact
**There is NO exit-code-based logic.** `isTransientError`/`isPermanentError` operate on THROWN errors (Error-shaped objects with `.code`, `.response.status`, `.message`). They never inspect a `BashToolResult` `{ success, stdout, stderr, exitCode, timedOut, killed }` result object, because such results are **returned, not thrown**.

## How `execute_bash` (the thing that CAN be watchdog-killed) is called

`rg "execute_bash|retryMcpTool"` shows:

- `src/agents/prp-executor.ts:521` — `#runValidationGates` calls `this.#bashMCP.execute_bash({...})` **DIRECTLY**, with **NO retry wrapper**. It is a single shot.
- `retryMcpTool` is NEVER used to wrap `execute_bash` anywhere in the codebase.

So the **only** place a watchdog-killed bash result (exit 124 / `timedOut: true`) currently surfaces is the **validation fix-loop** in `prp-executor.ts` (lines ~368–422), where:

```
while (fixAttempts <= maxFixAttempts) {
  validationResults = await this.#runValidationGates(prp);
  ...
  const allPassed = validationResults.every(r => r.success || r.skipped);
  if (allPassed) break;            // success
  if (fixAttempts < maxFixAttempts) {
    fixAttempts++;
    await this.#sleep(delay);
    await this.#fixAndRetry(prp, validationResults, fixAttempts);  // ← FIX RETRY
  } else break;
}
```

**A watchdog-killed gate today is indistinguishable from a genuine validation failure**, so this loop runs `#fixAndRetry` (an LLM call) against a hung command, then re-runs the same hung gate — exactly the "churning retries" the PRD forbids.

## What S2 must wire (two layers)

Per the work-item contract (LOGIC a–d) and PRD §9.3.2:

### Layer A — `src/utils/retry.ts` (the literal contract)
- `isPermanentError()`: detect `exitCode === 124` OR `timedOut === true` on a result/error-shaped object → return `true`.
- `isTransientError()`: ensure it returns `false` for exit 124 / timedOut (defense — it currently has no such case, but the `'timeout'` message pattern is a FALSE-POSITIVE risk; a thrown error carrying exit-124 info must NOT be retried).
- `retryAgentPrompt` / the generic `retry()`: propagate the hard-fail (no retry) when exit 124 is detected. The default `isRetryable=isTransientError` path already does this once `isTransientError` returns false for 124 — but we must make it ROBUST and explicit.

### Layer B — `src/agents/prp-executor.ts` (the ACTUAL retry of a watchdog-killed validation)
- The validation fix-loop (`while (fixAttempts <= maxFixAttempts)`) MUST detect a timed-out/124 gate and **break out without fix-retrying**. This is where "a watchdog-killed validation aborts the run and is not retried" (PRD §9.3.2, Req 4.4) actually lives.
- Mechanism: `ValidationGateResult` needs a `timedOut` signal (carried from `BashToolResult.timedOut` / `exitCode === 124`); the loop checks it and sets `outcome: 'fail'` immediately (skip `#fixAndRetry`).

**Both layers are in scope.** Layer A satisfies the work-item's literal LOGIC (a)–(c); Layer B satisfies LOGIC (d) ("Update the retry loops that wrap agent calls ... to propagate the hard-fail when exit 124 is detected") and the PRD's validation-specific mandate. The work item description says "Update the retry loops that wrap agent calls (retryAgentPrompt, executeSubtask)" — `executeSubtask` delegates to `prpRuntime.executeSubtask` → `PRPExecutor.execute` → the validation fix-loop. So Layer B is the `executeSubtask`-side propagation.

## Why `retryMcpTool` is out of scope (do NOT add exit-124 handling there)
`retryMcpTool` is **dead code** (never called). Adding logic to it would be unverifiable and could rot. The contract is satisfied by the generic `isPermanentError`/`isTransientError` + the executor loop. If `retryMcpTool` is later revived, the shared predicates already cover it.

## `retryAgentPrompt` / `withAgentDeadline` interaction (the LLM-timeout distinction)
Per phase_findings G4 + the work item contract note: **LLM-generation timeout SHOULD be retried** (Req 3.4) — that's `withAgentDeadline`'s `AgentError` (`PIPELINE_AGENT_LLM_FAILED`), which `isTransientError` already classifies as transient. **Watchdog-killed subprocess (exit 124 / `timedOut`) must NOT be retried.** S2 must NOT break the LLM-timeout retry path. The two are distinct vectors:
- LLM call deadline (`withAgentDeadline`) → transient → retry. UNCHANGED.
- Bash subprocess watchdog (`BashToolResult.timedOut` / `exitCode===124`) → permanent → no retry. NEW.