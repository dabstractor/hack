# Research Notes — P3.M1.T4.S1: Bounded retry w/ exponential backoff for stagecoach

## The core finding: S1 designed the seam FOR this task

`src/utils/git-commit.ts` (authored in P3.M1.T3.S1) was **explicitly designed**
as a throw-on-failure transient boundary that this task wraps with
`retryAgentPrompt`. Evidence (verbatim from S1's JSDoc on
`generateCommitMessage`):

> **This is the transient-API-sensitive generation boundary** that
> P3.M1.T4.S1 wraps with `retryAgentPrompt`. A generation timeout is LLM-API
> slowness, not a stuck subprocess — so the boundary throws `AgentError` (which
> hardcodes `code = PIPELINE_AGENT_LLM_FAILED` and is classified **transient**
> by `isTransientError`).

And `smartCommit`'s own JSDoc:
> The retry layer (P3.M1.T4.S1) wraps the INNER `generateCommitMessage`
> boundary, NOT `smartCommit`.

So the implementation is **minimal**: wrap the existing
`generateCommitMessage(diff)` call inside `smartCommit`'s stagecoach branch
with `retry(generateCommitMessage, {...})` using the new constants. The boundary
already throws `AgentError` (transient) on every failure mode; `retry`'s default
`isRetryable = isTransientError` will classify it correctly. **No new error
classification logic needed.**

## The existing retry utility does everything we need

`src/utils/retry.ts`:
- `retry<T>(fn, options)` — generic exponential backoff with jitter.
  - `options.maxAttempts` — total attempts (1 initial + retries). **This maps to
    COMMIT_RETRY_MAX.** NOTE: "max attempts" = total calls, NOT retry count.
    The PRD says "retried up to COMMIT_RETRY_MAX (default 5) attempts" → 5 total
    attempts. ✓ (matches retry semantics).
  - `options.baseDelay` — first delay. Maps to COMMIT_RETRY_DELAY (10s = 10000ms).
  - `options.maxDelay` — cap. PRD says "capped 120s" → 120000ms.
  - `options.backoffFactor` — default 2 → "doubling" ✓.
  - `options.jitterFactor` — default 0.1. Acceptable (PRD doesn't forbid jitter).
  - `options.isRetryable` — DEFAULTS to `isTransientError`. We can rely on this
    default (AgentError is transient). OR pass it explicitly for clarity.
  - `options.onRetry` — use `createDefaultOnRetry('stagecoach.generateCommitMessage')`.

- `isTransientError()` — AgentError (code `PIPELINE_AGENT_LLM_FAILED`) is
  classified transient (UNLESS message contains 'parse'). Our AgentError messages
  are 'stagecoach commit-message generation failed: ...' — no 'parse' substring.
  ✓ transient.

- `retryAgentPrompt(fn, ctx)` — convenience wrapper with its OWN hardcoded config
  (maxAttempts:3, baseDelay:1000ms, maxDelay:30000ms). **DO NOT USE this** — it
  ignores our COMMIT_RETRY_* constants. Use the generic `retry()` directly.

## Constants pattern (mirror ISSUE_RETRY_MAX exactly)

`src/config/constants.ts` already has the canonical 4-part pattern:
1. `export const X = 'X'` — env var NAME string.
2. `export const DEFAULT_X = <val>` — default.
3. `export function getX(): <type>` — read+validate from env with default fallback.
4. JSDoc citing the PRD section.

`ISSUE_RETRY_MAX` (lines ~380-425) is the closest analog (integer max). We add:
- `COMMIT_RETRY_MAX` (name string) + `DEFAULT_COMMIT_RETRY_MAX = 5` + `getCommitRetryMax()`.
- `COMMIT_RETRY_DELAY` (name string) + `DEFAULT_COMMIT_RETRY_DELAY_MS = 10_000` +
  `getCommitRetryDelayMs()`.
- `COMMIT_RETRY_DELAY_CAP` — PRD says "capped 120s". The `retry()` utility takes
  `maxDelay`. We need a separate constant: `DEFAULT_COMMIT_RETRY_DELAY_CAP_MS = 120_000`
  + `getCommitRetryDelayCapMs()`.
  - QUESTION resolved: the PRD names the *base* delay COMMIT_RETRY_DELAY and the
    cap as "capped 120s". The cap is a separate value → separate constant. Naming:
    follow the base name + `_CAP` suffix to keep them visually grouped.

## Test pattern (mirror issue-retry-max.test.ts)

`tests/unit/config/issue-retry-max.test.ts` — 6 cases: unset→default, valid→honor,
NaN→default, 0→default, negative→default, valid int→honor. Mirror exactly for
both COMMIT_RETRY_MAX and COMMIT_RETRY_DELAY[_CAP].

## Existing git-commit.test.ts stagecoach coverage

Lines 839-950+ already cover `smartCommit({ generateMessage: true })`:
- happy path → generated message wrapped.
- `generateCommitMessage` throws → smartCommit returns null (outer catch), error
  logged, gitCommit never called.

**After we wrap with retry, the "throws → null" test needs adjustment**: when
`generateCommitMessage` is wrapped in `retry`, it will be called up to N times
before the throw propagates. The existing test mocks the agent to throw ONCE per
call → it'll be invoked COMMIT_RETRY_MAX times then throw. The test asserting
"gitCommit never called" still holds; the test asserting the agent is called
once may need the count updated OR we set maxAttempts low for the test. Need to
check the exact mock setup when implementing. **The S1 PRP's mock for the
generateCommitMessage boundary is a vi.fn that throws; with retry, vi.fn will be
called maxAttempts times.** Document this in the PRP.

## smartCommit retry scope: INNER boundary only

CRITICAL (per S1 JSDoc): retry wraps `generateCommitMessage`, NOT `smartCommit`.
So the git operations (status/add/diff/commit) are NOT retried — only the LLM
generation. The `gitDiff` call sits OUTSIDE the retry loop (it feeds the diff
to generateCommitMessage). So structure:

```ts
const diff = await gitDiff({ staged: true });  // NOT retried
const generated = await retry(
  () => generateCommitMessage(diff),            // retried (the boundary)
  { maxAttempts: getCommitRetryMax(), baseDelay: getCommitRetryDelayMs(),
    maxDelay: getCommitRetryDelayCapMs(), onRetry: createDefaultOnRetry(...) }
);
```

This keeps the git index untouched between retries (only the LLM call repeats),
satisfying PRD §5.1 "the index is left untouched + lock released on rescue."

## Distinct from watchdog timeouts (Req 3.6 — NOT in this task)

PRD §5.1: "a watchdog timeout (exit 124) on a research/implementation/validation
call MUST NOT be retried." That is P3.M2.T2.S2 (wire terminal-fail into retry.ts).
This task does NOT touch exit-124 detection. We rely on `isTransientError`'s
existing classification: AgentError is transient; a future exit-124 surface
(watchdog) will throw a NON-AgentError that isTransientError returns false for.
No conflict.

## Docs (Mode A — rides with the work)

- `.env.example` — add `# COMMIT_RETRY_MAX=5`, `# COMMIT_RETRY_DELAY=10000`,
  `# COMMIT_RETRY_DELAY_CAP=120000` near the RESEARCH_TIMEOUT block (~line 109).
- `docs/CONFIGURATION.md` — add 3 rows to the env-var table (~line 151-154,
  near RESEARCH_TIMEOUT/ISSUE_RETRY_MAX). Cite PRD §5.1.