# S3 Codebase Analysis — xhigh in decomposition demand-write retry

## 0. The work item's actual ask

Item 3 (LOGIC) verbatim:
> Ensure the decomposition demand-write retry path (when breakdown output is
> missing/invalid and the architect is re-invoked) uses the same xhigh reasoning
> budget as the initial decomposition call. This is primarily **verifying** that
> the architect agent's config already includes `thinking='xhigh'` from
> P2.M2.T1.S2, and that the retry path in `decomposePRD()` does **not** downgrade
> the agent config. If `decomposePRD` re-creates the agent on retry, ensure it
> uses the same `createArchitectAgent()` which already has xhigh.

The contract is **verification + a regression-locking test**, not a behavior
change. The word "primarily verifying" is the operative phrase.

## 1. Where the demand-write retry lives

`src/workflows/prp-pipeline.ts` `decomposePRD()` (line ~746):

```ts
// Line 768-774 — agent created ONCE, before the retry loop
const { createArchitectAgent } =
  await import('../agents/agent-factory.js');
const { createArchitectPrompt } =
  await import('../agents/prompts/architect-prompt.js');
const architectAgent = createArchitectAgent();   // ← config frozen here

// Line 787-790 — the "demand-write retry": same instance re-invoked
const result = await retryAgentPrompt(
  () => architectAgent.prompt(architectPrompt),
  { agentType: 'Architect', operation: 'decomposePRD' }
);
```

**Critical finding:** the agent is created **exactly once** at line 774. The
retry loop (`retryAgentPrompt`) re-invokes the **same** `architectAgent`
instance via `architectAgent.prompt(...)`. It does NOT:
- re-call `createArchitectAgent()` on retry,
- mutate `architectAgent`'s config,
- pass any per-call thinking override.

## 2. retryAgentPrompt does not touch agent config

`src/utils/retry.ts:651`:
```ts
export async function retryAgentPrompt<T>(
  agentPromptFn: () => Promise<T>,
  context: { agentType: string; operation: string }
): Promise<T> {
  return retry(agentPromptFn, { ...AGENT_RETRY_CONFIG, onRetry: ... });
}
```
It wraps `retry()` (retry.ts ~470) which loops `await fn()` — calling the
**same closure** (`() => architectAgent.prompt(architectPrompt)`) on each
attempt. The agent instance and its frozen config are captured by the closure.
**There is no config-mutation vector in the retry path.**

## 3. Therefore: S2 already satisfies the runtime requirement

Once S2 changes `createArchitectAgent()` to
`createBaseConfig('architect', 'reasoning')`, the returned config carries
`thinking: 'xhigh'` (from `ROLE_CONFIG.reasoning`). The config is frozen at
agent creation (line 774), so EVERY `architectAgent.prompt(...)` call —
including every retry attempt — runs at xhigh. **No change to prp-pipeline.ts
or retry.ts is required for the budget itself.**

## 4. What S3 must actually deliver

The runtime behavior is already correct post-S2. S3's value is **defense in
depth**: lock the invariant so a future change cannot silently downgrade the
retry to a lower budget. Concrete deliverables:

### 4a. A regression-locking UNIT test
Add to `tests/unit/workflows/prp-pipeline.test.ts` in the existing
`describe('decomposePRD', ...)` block:

```ts
it('uses the same single Architect agent instance for the initial call and all demand-write retries (xhigh budget invariant)', async () => {
  // SETUP: an agent mock whose .prompt rejects twice (transient) then resolves,
  //   forcing retryAgentPrompt to re-invoke the SAME mock instance.
  const promptFn = vi.fn()
    .mockRejectedValueOnce(new AgentError('transient'))   // attempt 1 fail
    .mockRejectedValueOnce(new AgentError('transient'))   // attempt 2 fail
    .mockResolvedValueOnce({ status: 'success', /* ... */ }); // attempt 3 ok
  mockCreateArchitectAgent.mockReturnValue({ prompt: promptFn } as never);
  // ... session with empty backlog + readFile(tasks.json) returning a valid backlog ...

  // EXECUTE
  await pipeline.decomposePRD();

  // VERIFY (the invariant S3 protects):
  // 1. createArchitectAgent called EXACTLY ONCE (not re-created on retry).
  expect(mockCreateArchitectAgent).toHaveBeenCalledTimes(1);
  // 2. the SAME agent instance's prompt was called on every attempt (3 calls).
  expect(promptFn).toHaveBeenCalledTimes(3);
});
```

This test fails the moment someone "optimizes" the retry by re-creating the
agent (which could downgrade the budget) or by switching to a different agent
on retry. It directly encodes the item-3 requirement: *the retry path uses
the same xhigh-configured architect*.

### 4b. A clarifying code comment at the retry site
Add a short comment in `decomposePRD()` at the agent-creation line documenting
the invariant, so a maintainer doesn't move the `createArchitectAgent()` call
inside the retry closure:

```ts
// INVARIANT (PRD §6.1): the Architect is created ONCE here with the Reasoning
// role (xhigh budget, wired by createArchitectAgent → S2). The demand-write
// retry below (retryAgentPrompt) re-invokes THIS SAME instance, so every retry
// attempt inherits the xhigh budget. Do NOT move createArchitectAgent() inside
// the retry closure — that could create a fresh agent with a downgraded config.
const architectAgent = createArchitectAgent();
```

## 5. Test mock setup (proven facts)

`tests/unit/workflows/prp-pipeline.test.ts`:
- Line 51: `createArchitectAgent: vi.fn()` (mocked in the agent-factory mock block).
- Line 113: `import { createArchitectAgent } from '../../../src/agents/agent-factory.js';`
- Line 127: `const mockCreateArchitectAgent = createArchitectAgent as any;`
- The `decomposePRD` describe block (line 298+) uses `createMockSessionManager`
  + `createTestSession(createTestBacklog([]))` for "new session" cases.
- The architect's prompt mock currently returns `{ backlog: ... }` directly;
  the test asserts `mockCreateArchitectAgent` was called. There is NO existing
  test that exercises the RETRY path (prompt rejecting then resolving).
- `vi.mock('node:fs/promises', ...)` mocks `readFile`/`writeFile`; decomposePRD
  calls `readFile(tasksPath)` → the test must make it resolve to a valid
  `Backlog` JSON string for the happy path (existing "should call
  createArchitectAgent" test relies on the default `vi.fn()` mock which returns
  `undefined` → JSON.parse(undefined) throws → caught as non-fatal. So existing
  tests do NOT actually reach the parse/success branch cleanly).

> **GOTCHA:** the existing "should call createArchitectAgent for new session"
> test does NOT assert a clean decomposition — it only asserts the factory was
> called and `currentPhase` becomes `prd_decomposed` (which also happens via the
> catch branch's non-fatal path setting `prd_decomposition_failed`? No — it sets
> `prd_decomposed` only on success). Re-reading: the success path sets
> `currentPhase = 'prd_decomposed'` at the END after saveBacklog + #countTasks.
> So for the existing test to pass, `readFile` must be returning something
> parseable OR the mock returns undefined and JSON.parse throws → catch →
> non-fatal → phase becomes `prd_decomposition_failed`, NOT `prd_decomposed`.
> **This means the existing "should update currentPhase to prd_decomposed"
> test (line 348) likely currently passes only if readFile is stubbed.**
> Verification needed during implementation: confirm the existing decomposePRD
> happy-path test actually reaches `prd_decomposed`, and mirror whatever
> readFile stubbing makes it work for the new S3 retry test.

## 6. AgentError / transient-error mechanics (for the retry test)

`src/utils/retry.ts` `isTransientError`:
- A thrown `AgentError` has code `PIPELINE_AGENT_LLM_FAILED` → transient = true
  (retryable).
- `AgentError` is imported from `src/utils/errors.ts`.
- The default `AGENT_RETRY_CONFIG.maxAttempts = 3`, so 2 rejections + 1
  resolution = 3 total `prompt()` calls (matches the test design in §4a).

Import in the test:
```ts
import { AgentError } from '../../../src/utils/errors.js';
```
(Confirm the exact export name during implementation — `rg -n "class AgentError" src/utils/errors.ts`.)

## 7. What S3 must NOT do (scope fences)

- Do NOT modify `createArchitectAgent()` / `createBaseConfig` / `ROLE_CONFIG` —
  S1/S2 own them. S3 only CONSUMES the (post-S2) xhigh-configured architect.
- Do NOT wire `thinking` into the pi harness end-to-end — that is a later,
  separate task. S3's `thinking: 'xhigh'` is still a write-only config field at
  this stage (same as S1/S2). The BUDGET is *requested*; harness *enforcement*
  is out of scope for all of P2.M2.T1.
- Do NOT touch `retry.ts` / `retryAgentPrompt` behavior — it already re-invokes
  the same instance. S3 only adds a test + a comment.
- Do NOT edit docs (item 5: "DOCS: none").
- Do NOT touch the delta-analysis-workflow's retryAgentPrompt call
  (`delta-analysis-workflow.ts:131`) — that's the Delta classifier, a different
  agent/role; out of scope for "decomposition demand-write retry".

## 8. Coverage impact

- The new test exercises the retry branch inside `decomposePRD()` → currently
  that branch is covered by the generic retryAgentPrompt test? No — the
  pipeline's retry path (prompt rejecting) is NOT currently exercised by the
  unit suite (existing decomposePRD tests resolve on first call). So the new
  test may ADD coverage (good — keeps the 100% gate honest, no coverage dent).
- prp-pipeline.ts is already in the 100%-coverage include glob; adding a
  passing test only helps. No risk of denting coverage below 100%.
- retry.ts is already 100% covered; the new test uses real `retryAgentPrompt`
  (not mocked) which is fine.

## 9. The "primarily verifying" framing → minimal diff

Because the runtime behavior is already correct post-S2, S3's diff is tiny:
- ~1 comment line in `src/workflows/prp-pipeline.ts` (decomposePRD).
- ~1 new `it(...)` test in `tests/unit/workflows/prp-pipeline.test.ts`.
- ~1 import (`AgentError`) in the test file if not already present.

This matches the item's 1-point estimate and the explicit "primarily
verifying" language.

## 10. Parallel-execution seam with S2

S2 is being implemented concurrently. S3 ASSUMES S2 lands as specified:
`createArchitectAgent()` → `createBaseConfig('architect', 'reasoning')`
producing `thinking: 'xhigh'`. S3 does NOT re-verify the agent's config value
in the pipeline test (that's S2's unit test's job in
`tests/unit/agents/agent-factory.test.ts`). S3 verifies the *structural
invariant* (single instance reused across retries), which is budget-agnostic
and correct regardless of S2's exact wiring. This keeps S2 and S3 from
overlapping on assertions.