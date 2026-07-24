# Research Summary — P4.M1.T1.S2: Transient-API Retry & Protective Default on Exhaustion

## VERDICT
S2 **wraps** S1's `classifyChange` / `classifyArtifact` (from `src/core/change-classifier.ts`) in a
bounded `retry()` loop with a configurable `maxAttempts` (default 4), and on exhaustion falls to the
**protective/conservative default** (`'SUBSTANTIVE'` for change, `'DIRTY'` for artifact) with a warn-log.
S2 does NOT modify S1's functions, `retry.ts`, `agent-factory.ts`, or any workflow caller.

## SCOPE BOUNDARY (S1 vs S2 — load-bearing)
- **S1 (P4.M1.T1.S1)** — the INNER LLM call: `classifyChange(diffSummary)` / `classifyArtifact(content)`
  in `src/core/change-classifier.ts`. Calls `agent.prompt(prompt)` BARE. Throws transient
  `AgentError(PIPELINE_AGENT_LLM_FAILED)` on any non-success / empty / enum-invalid output. NO retry.
- **S2 (this PRP)** — the RESILIENCE layer: wrap S1's functions in `retry()` (default 4 attempts) +
  fail-to-protective-default on exhaustion. S2 ADDS new exported resilient functions in the SAME module
  (`src/core/change-classifier.ts`) — it does not modify S1's `classifyChange`/`classifyArtifact`.
  S2 also adds the config trio (`CLASSIFIER_RETRY_MAX` / `DEFAULT_CLASSIFIER_RETRY_MAX=4` / `getClassifierRetryMax`)
  to `src/config/constants.ts`.

## The canonical retry() pattern (git-commit.ts:494-510 — EXACT precedent)
`git-commit.ts` does EXACTLY what S2 needs — wraps an LLM boundary in `retry()` with configurable
`maxAttempts`, and on exhaustion catches the rethrown error and falls back. S2 mirrors this.

```typescript
// git-commit.ts:486-510 (read-only precedent)
// isRetryable is intentionally OMITTED → defaults to isTransientError
const generated = await retry(
  () => generateCommitMessage(diffResult.diff ?? ''),
  {
    maxAttempts: getCommitRetryMax(),
    baseDelay: getCommitRetryDelayMs(),
    maxDelay: getCommitRetryDelayCapMs(),
    backoffFactor: 2,
    onRetry: createDefaultOnRetry('stagecoach.generateCommitMessage', getCommitRetryMax()),
  }
);
// catch (genError) → fallback (S2 returns protective default instead)
```

S2's shape:
```typescript
export async function classifyChangeWithRetry(diffSummary: DiffSummary): Promise<ChangeClassification> {
  try {
    return await retry(() => classifyChange(diffSummary), {
      maxAttempts: getClassifierRetryMax(),
      baseDelay: ..., maxDelay: ..., backoffFactor: 2,
      onRetry: createDefaultOnRetry('ChangeClassifier.classifyChange', getClassifierRetryMax()),
    });
  } catch (error) {
    logger().warn({ error }, 'change classifier exhausted retries — failing to protective default SUBSTANTIVE');
    return 'SUBSTANTIVE';   // PROTECTIVE — never 'could not classify'
  }
}
```

## retry() facts (src/utils/retry.ts — READ-ONLY, do NOT modify)
- `retry<T>(fn, options?)` — lines ~470-555. Default `maxAttempts: 3`, `baseDelay: 1000`,
  `maxDelay: 30000`, `backoffFactor: 2`, `jitterFactor: 0.1`. `isRetryable` defaults to
  `isTransientError`. On exhaustion, **rethrows the last error**.
- `isRetryable` is OMITTED in S2 → defaults to `isTransientError` (correct: S1 throws
  `AgentError(PIPELINE_AGENT_LLM_FAILED)` which IS transient — retry.ts:326-337).
- `createDefaultOnRetry(operationName, maxAttempts)` — lines ~590-625. Returns a warn-logging
  callback. S2 reuses it (do NOT hand-roll the onRetry logger — it logs attempt/delay/errorName/
  errorCode/errorMessage with structured context).
- `RetryOptions` interface — lines ~153-230. Keys: `maxAttempts`, `baseDelay`, `maxDelay`,
  `backoffFactor`, `jitterFactor`, `isRetryable`, `onRetry`.
- DO NOT use `retryAgentPrompt` (it hardcodes `maxAttempts: 3` via `AGENT_RETRY_CONFIG` — lines 640-648).
  S2 needs `maxAttempts: 4 (configurable)`, so it uses the lower-level `retry()` directly.
- DO NOT modify `retry.ts`. S2 consumes it as-is.

## isTransientError (retry.ts:311-395 — why S1's throw is retryable)
Treats as TRANSIENT (retried):
- PipelineError with code `PIPELINE_AGENT_TIMEOUT` or `PIPELINE_AGENT_LLM_FAILED` (UNLESS message
  contains 'parse'/'parsing').
- Node system codes: ECONNRESET, ECONNREFUSED, ETIMEDOUT, ENOTFOUND, EPIPE, EAI_AGAIN, etc.
- HTTP 408, 429, 500, 502, 503, 504.
- Message patterns: 'timeout', 'network error', 'temporarily unavailable', 'service unavailable',
  'connection reset', 'connection refused', 'rate limit', 'too many requests'.
Treats as PERMANENT (not retried):
- ValidationError.
- AgentError whose message contains 'parse'/'parsing' (S1 avoids those words → transient ✓).
- Watchdog kill (`timedOut: true` OR `exitCode: 124`) — `isWatchdogKillResult` runs FIRST.
- HTTP 4xx (except 408/429).
S1's `AgentError(PIPELINE_AGENT_LLM_FAILED)` with message like "change classifier returned no data"
→ transient → S2 retries. ✓

## Config trio pattern (constants.ts — ISSOSUE_RETRY_MAX / COMMIT_RETRY_MAX precedent)
`getCommitRetryMax()` (constants.ts:420-425) + `getCommitRetryDelayMs()` + `getCommitRetryDelayCapMs()`
are the EXACT pattern to mirror. Each is a trio: `export const X = 'X'` (env var name) +
`export const DEFAULT_X = N` + `export function getX(): number` (reads `process.env[X] ?? DEFAULT_X`,
guards `Number.isNaN(raw) || raw <= 0`).

S2 adds the same trio for the classifier retry count:
- `CLASSIFIER_RETRY_MAX = 'CLASSIFIER_RETRY_MAX'`
- `DEFAULT_CLASSIFIER_RETRY_MAX = 4` (PRD §4.3: "default 4")
- `getClassifierRetryMax(): number`

NOTE: S2 does NOT need separate base/max-delay config (the classifier retry is over an LLM call;
reuse `AGENT_RETRY_CONFIG`-style defaults inline via the `baseDelay`/`maxDelay`/`backoffFactor` options
passed to `retry()`, OR omit them and rely on `retry()`'s own defaults of baseDelay=1000/maxDelay=30000).
DECISION: S2 passes `baseDelay: 1000, maxDelay: 30000, backoffFactor: 2` explicitly (mirrors git-commit.ts
explicitness, and avoids env-var proliferation — the item contract only requires `maxAttempts=4 (configurable)`).
Only `maxAttempts` is configurable via env var; delays use sane inline defaults.

## Logger facts (src/utils/logger.ts — READ-ONLY)
- `getLogger(context: string): Logger` — line 465. `Logger` interface (line 80) has the standard
  pino-like methods (debug/info/warn/error with structured object + message).
- Lazy accessor pattern (module-private): `let _logger: Logger | undefined; const logger = () =>
  (_logger ??= getLogger('ChangeClassifier'));` (mirrors retry.ts:628-629, dependency-validator.ts:44-45).
- S1 already adds this accessor to change-classifier.ts. S2 REUSES the SAME accessor (same module).

## Test conventions (vitest.config.ts + Strategy A)
- vitest.config.ts: thresholds 100% statements/branches/functions/lines. `pool: 'forks'`.
  `setupFiles: ['./tests/setup.ts']`. `include: ['src/**/*.ts']` for coverage.
- Strategy-A mocking (prp-executor.test.ts:42-61 is the retry-mock template):
  ```typescript
  vi.mock('../../../src/utils/retry.js', () => ({
    retry: vi.fn(),
    retryAgentPrompt: vi.fn(),
    retryMcpTool: vi.fn(),
    createDefaultOnRetry: vi.fn(() => () => {}),
  }));
  ```
  S2's test mocks BOTH `retry.js` (to simulate exhaustion) AND `change-classifier.js`'s inner
  `classifyChange`/`classifyArtifact` — OR mocks the agent-factory (per S1's test) to make the inner
  classifier throw. The CLEANEST approach: mock `retry` to invoke the passed fn directly and rethrow
  on the Nth call, so the inner classifyChange can be the real S1 function (mocked agent throws).
  GIVEN/SHOULD + SETUP/EXECUTE/VERIFY comment blocks (prd-differ.test.ts style).

## Protective default contract (PRD §4.3 + item contract LOGIC (c),(d),(e))
- Change classification exhaustion → return `'SUBSTANTIVE'` (PRD: "never silently fall through to
  'could not classify' and proceed unprotected through a SUBSTANTIVE change").
- Artifact classification exhaustion → return `'DIRTY'`.
- MUST warn-log when falling to the protective default (item LOGIC (d)).
- NEVER return `'could not classify'` or undefined — always a protective value.

## Scope / no-overlap
- S2 does NOT touch: `retry.ts`, `agent-factory.ts`, `prompts.ts`, `prompts/index.ts`,
  `prompts/change-classifier-prompt.ts`, `prd-differ.ts`, `models.ts`, any workflow/CLI.
- S2 MODIFIES: `src/core/change-classifier.ts` (ADD resilient functions + reuse S1's logger accessor),
  `src/config/constants.ts` (ADD the config trio).
- S2 CREATES: `tests/unit/core/change-classifier-resilient.test.ts` (the resilient-layer suite; S1
  owns `tests/unit/core/change-classifier.test.ts` — do NOT touch it).
- Future consumer: the delta-workflow caller (handleDelta in prp-pipeline.ts) will call
  `classifyChangeWithRetry` / `classifyArtifactWithRetry` — NOT in scope for S2 (wiring is a later item,
  just as S1 noted). P4.M1.T2.S1 / P4.M1.T3.S1 consume S2's resilient functions.

## npm scripts
- `npm run validate` = lint + format:check + typecheck + test:run (the gate).
- `npm run test:run -- change-classifier` = targeted test.
- `npm run test:coverage -- change-classifier` = coverage (must be 100% of new code).

## Item contract mapping
- LOGIC (a) "Wrap classifyChange and classifyArtifact in a bounded retry loop using retry() with
  maxAttempts=4 (configurable)" → `classifyChangeWithRetry` / `classifyArtifactWithRetry` using
  `retry(..., { maxAttempts: getClassifierRetryMax() })`.
- LOGIC (b) "Distinguish transient API failures (isTransientError → retry) from invalid model
  responses (parse failure → retry up to limit)" → `isRetryable` OMITTED → defaults to
  `isTransientError`. BOTH transient-API failures AND S1's `AgentError` (invalid output) are transient
  → both retry. (S1's invalid-output messages avoid 'parse' → transient. ✓)
- LOGIC (c) "On exhaustion (all retries fail), return the protective default: SUBSTANTIVE / DIRTY" →
  the catch block returns the protective literal.
- LOGIC (d) "Log a warning when falling to protective default" → `logger().warn(...)`.
- LOGIC (e) "Never return 'could not classify' — always return a protective value" → the functions
  have a single return path per branch; the catch always returns the protective default.