# Research 03 — Test Design

## Files to modify/create

1. **MODIFY** `tests/unit/utils/retry.test.ts` — add `isPermanentError`/`isTransientError` cases for the watchdog-kill vectors (Layer A).
2. **MODIFY** `tests/unit/agents/prp-executor.test.ts` (CONFIRM path) — add a test that a watchdog-killed gate aborts without fix-retry (Layer B).
3. **(if no executor test exists)** CREATE a focused test file or extend an existing one. Verify with `find tests -path '*prp-executor*'`.

## Layer A tests — `tests/unit/utils/retry.test.ts`

The file already imports `isTransientError`, `isPermanentError`, `retryAgentPrompt`, `retryMcpTool`, `createDefaultOnRetry`, and `AgentError`/`ValidationError`/`ErrorCodes`. It uses `vi.useFakeTimers()` in `beforeEach`.

### New `describe('watchdog-kill (exit 124) detection', ...)` block

Add to `isPermanentError()` tests:
```ts
it('treats exitCode 124 (timeout coreutil) as permanent', () => {
  expect(isPermanentError({ exitCode: 124, timedOut: false })).toBe(true);
});
it('treats timedOut:true (Node watchdog) as permanent', () => {
  expect(isPermanentError({ timedOut: true, killed: true, exitCode: 143 })).toBe(true);
});
it('does NOT treat a plain non-124 exitCode as permanent (no false positives)', () => {
  expect(isPermanentError({ exitCode: 1, timedOut: false })).toBe(false);
  expect(isPermanentError({ exitCode: 137, timedOut: false })).toBe(false); // signal w/o timedOut flag
});
```

Add to `isTransientError()` tests (CRITICAL — guards the false-positive):
```ts
it('returns false for exitCode 124 even when message contains "timeout"', () => {
  // The classic false-positive: thrown error w/ "timed out" message → would be retried.
  const e = { exitCode: 124, timedOut: false, message: 'Command timed out after 120000ms' };
  expect(isTransientError(e)).toBe(false);
});
it('returns false for timedOut:true (Node watchdog) even with "timeout" message', () => {
  const e = { timedOut: true, killed: true, exitCode: 143, message: 'Command timed out after 120000ms' };
  expect(isTransientError(e)).toBe(false);
});
it('still retries LLM AgentError timeouts (PIPELINE_AGENT_LLM_FAILED) — Req 3.4 NOT broken', () => {
  const llmTimeout = new AgentError('Agent exceeded the 300s RESEARCH_TIMEOUT deadline');
  expect(isTransientError(llmTimeout)).toBe(true);   // UNCHANGED behavior
  expect(isPermanentError(llmTimeout)).toBe(false);
});
```

### Integration: a `retry()` loop that sees a thrown watchdog-kill error aborts immediately
```ts
it('does not retry when a watchdog-killed result (timedOut) is thrown', async () => {
  let calls = 0;
  const watchdogErr = { timedOut: true, killed: true, exitCode: 143,
    message: 'Command timed out after 120000ms' };
  // Use real timers for this (no sleep needed — it throws immediately on attempt 1)
  vi.useRealTimers();
  await expect(
    retry(
      async () => { calls++; throw watchdogErr; },
      { maxAttempts: 5, baseDelay: 1 }
    )
  ).rejects.toEqual(watchdogErr);
  expect(calls).toBe(1);   // NEVER retried
});
```
Mirror for `exitCode: 124`.

## Layer B tests — `tests/unit/agents/prp-executor.test.ts`

First confirm the file exists and how it constructs a `PRPExecutor` (mock `BashMCP`, feed a `PRPDocument` with a single validation gate, mock the coder agent to return `success`). The key assertion:

> When the mocked `BashMCP.execute_bash` returns `{ success: false, timedOut: true, ... }` for the gate, `PRPExecutor.execute()` returns `outcome: 'fail'` and **does NOT invoke the fix agent** (`#fixAndRetry` / `retryAgentPrompt` call count == 0 for fix).

If the existing executor test is heavy to set up, the minimum viable Layer-B test is a **unit test on the detection helper** exported from retry.ts (e.g. export `isWatchdogKillResult`) plus an assertion that `ValidationGateResult.timedOut` is populated from `result.timedOut || result.exitCode === 124` in `#runValidationGates`. But since `#runValidationGates` is private, the cleanest behavioral test is through `execute()` with a mocked BashMCP. Check the existing executor test harness and reuse its fixtures.

### Minimal behavioral test sketch
```ts
it('aborts (outcome:fail) without fix-retry when a validation gate is watchdog-killed', async () => {
  // mock coderAgent.prompt → result:'success' (so we reach validation)
  // mock bashMCP.execute_bash → { success:false, timedOut:true, exitCode:143, stdout:'', stderr:'killed' }
  //   for the single gate.
  // spy on retryAgentPrompt for the FIX call (or on the fix-agent prompt).
  const result = await executor.execute(prpWithOneGate, prpPath);
  expect(result.outcome).toBe('fail');
  expect(result.validationResults[0].timedOut).toBe(true);
  expect(fixPromptSpy).not.toHaveBeenCalled();   // NO fix-retry against the hung gate
});
```
And a coreutil variant: `execute_bash` returns `{ success:false, exitCode:124, timedOut:false }` → same outcome, `timedOut: true` on the gate result (mapped from exitCode===124).

## Coverage note
Project enforces **100% coverage** on `src/**/*.ts` (vitest.config.ts thresholds). The new `isWatchdogKillResult` helper and the early-return branches in `isPermanentError`/`isTransientError` MUST be exercised by the new tests (both the `true` and `false` returns of the helper, and both exit-124 and timedOut arms). The executor's new `if (watchdogKilled) break;` branch MUST be hit by the Layer-B test. Add a "no watchdog" test (gate fails normally → fix-retry DOES happen) to keep the false-branch covered.