# PRP — P4.M1.T1.S2: Transient-API Retry & Protective Default on Exhaustion

---

## Goal

**Feature Goal**: Implement the **resilience layer** mandated by PRD §4.3 ("The Delta Workflow",
h3.5, step 1, "Change Classification") around the LLM change/artifact classifiers. PRD §4.3 states
the classifiers *"MUST distinguish transient API failures (empty output, connection errors, rate
limits, overloaded) from invalid model responses, retrying up to a bounded count (default 4) before
giving up. On exhaustion they MUST fail to the protective/conservative default (treat as
SUBSTANTIVE / DIRTY) — never silently fall through to 'could not classify' and proceed
unprotected."* This subtask wraps the S1 classifier functions
(`classifyChange` / `classifyArtifact` from `src/core/change-classifier.ts`, produced by
**P4.M1.T1.S1**) in a bounded `retry()` loop (default 4 attempts, configurable via
`CLASSIFIER_RETRY_MAX`) and returns the protective default (`'SUBSTANTIVE'` / `'DIRTY'`) with a
warn-log when all attempts are exhausted. This is the second half of work item **P4.M1.T1** —
completing it. S2 ADDS new resilient wrapper functions; it does NOT modify S1's functions,
`retry.ts`, `agent-factory.ts`, or any workflow caller.

**Deliverable** (1 modified production module + 1 modified config file + 1 new test file;
**no** retry.ts edit, **no** agent-factory edit, **no** prompts edit, **no** workflow/CLI edit,
**no** new dependencies):

1. **`src/config/constants.ts`** (MODIFY) — add the config trio for the classifier retry count,
   mirroring the `COMMIT_RETRY_MAX` / `getCommitRetryMax()` trio (constants.ts:449-425) and
   `ISSUE_RETRY_MAX` / `getIssueRetryMax()` trio (constants.ts:385-425):
   - `export const CLASSIFIER_RETRY_MAX = 'CLASSIFIER_RETRY_MAX';` (env-var NAME).
   - `export const DEFAULT_CLASSIFIER_RETRY_MAX = 4;` (PRD §4.3 "default 4").
   - `export function getClassifierRetryMax(): number` — reads
     `Number(process.env[CLASSIFIER_RETRY_MAX] ?? DEFAULT_CLASSIFIER_RETRY_MAX)`, guards
     `Number.isNaN(raw) || raw <= 0` → returns default. `Math.floor` on the way out.
2. **`src/core/change-classifier.ts`** (MODIFY — ADD only, do NOT change S1's existing exports) —
   add two resilient wrapper functions that reuse S1's `classifyChange` / `classifyArtifact`, the
   module's existing lazy `logger()` accessor, and the exported `ChangeClassification` /
   `ArtifactClassification` types:
   - `export async function classifyChangeWithRetry(diffSummary: DiffSummary):
     Promise<ChangeClassification>` — wraps `() => classifyChange(diffSummary)` in `retry(...)` with
     `{ maxAttempts: getClassifierRetryMax(), baseDelay: 1000, maxDelay: 30000, backoffFactor: 2,
     onRetry: createDefaultOnRetry('ChangeClassifier.classifyChange', getClassifierRetryMax()) }`.
     `isRetryable` is **intentionally OMITTED** → defaults to `isTransientError` (the correct
     behavior: S1 throws `AgentError(PIPELINE_AGENT_LLM_FAILED)` which is transient). On the catch
     (all retries exhausted → `retry` rethrows the last error), warn-log and return
     `'SUBSTANTIVE'` (the protective default).
   - `export async function classifyArtifactWithRetry(content: string):
     Promise<ArtifactClassification>` — same shape around `classifyArtifact(content)`; on exhaustion
     warn-log and return `'DIRTY'` (the protective default). Preserves S1's empty-content guard
     (the inner `classifyArtifact` throws on empty content — but that throw is transient and would
     be retried 4× then fall to `'DIRTY'`; this is acceptable per PRD §4.3 since empty content is a
     degenerate protective case).
   - Mode-A JSDoc on both functions citing PRD §4.3 + the protective-default contract.
3. **`tests/unit/core/change-classifier-resilient.test.ts`** (NEW) — the resilient-layer unit suite
   (vitest, Strategy-A mocking per `tests/unit/agents/prp-executor.test.ts:42-61` for `retry.js` +
   `tests/unit/workflows/delta-analysis-workflow.test.ts:24-31` for `agent-factory.js`): covers
   (a) happy-path first-attempt success returns COSMETIC/SUBSTANTIVE/CLEAN/DIRTY (retry succeeds);
   (b) transient failure then success (retry recovers); (c) exhaustion (all attempts fail) →
   protective default SUBSTANTIVE / DIRTY + warn-log fired; (d) `maxAttempts` from
   `getClassifierRetryMax()` is threaded into `retry()` options; (e) the inner S1 functions are
   invoked (the retry fn is `() => classifyChange(diff)`); (f) config getter trio reads the env var
   with fallback to default 4. 100% branch coverage of the new resilient functions.

**Success Definition**:
- `classifyChangeWithRetry(diffSummary)` returns `'COSMETIC'` or `'SUBSTANTIVE'` when the inner
  `classifyChange` succeeds within `getClassifierRetryMax()` attempts; on exhaustion it returns
  `'SUBSTANTIVE'` (protective) and emits a warn-log — never `undefined`, never `'could not classify'`.
- `classifyArtifactWithRetry(content)` returns `'CLEAN'` or `'DIRTY'` on success; on exhaustion
  returns `'DIRTY'` (protective) and warns.
- The retry count is configurable via `CLASSIFIER_RETRY_MAX` (default 4, per PRD §4.3).
- Transient failures (S1's `AgentError(PIPELINE_AGENT_LLM_FAILED)`, connection errors, rate limits,
  overloaded) are retried; permanent failures (none today — S1 avoids 'parse' messages) would not.
- `npm run validate` GREEN; `git diff --name-only` shows EXACTLY
  `src/config/constants.ts`, `src/core/change-classifier.ts`, and
  `tests/unit/core/change-classifier-resilient.test.ts` (zero overlap with S1's classifier/prompts
  work, zero overlap with `retry.ts`, zero overlap with any workflow).

---

## User Persona (if applicable)

**Target User**: The autonomous pipeline (no human in the loop during the delta workflow), transitively
future maintainers. When a user edits `PRD.md` mid-project, the pipeline detects a hash mismatch
(PRD §4.3 step 1, "Detection") and must decide whether the edit is worth spawning a delta session
(SUBSTANTIVE) or is ignorable noise (COSMETIC). The LLM classifier (S1) makes that call — but LLM
APIs are flaky (empty output, connection errors, rate limits, overloaded). Without S2, a single
transient hiccup would either crash the delta workflow or silently misclassify. S2 makes the
classifier **safe**: retry transient hiccups, and if everything fails, fail SAFE (treat the change
as SUBSTANTIVE — i.e., spawn the delta session rather than risk silently swallowing a real change).

**Use Case**: `handleDelta()` in `prp-pipeline.ts` computes `diffPRDs(oldPRD, newPRD)` →
`DiffSummary`; S2's `classifyChangeWithRetry(diffSummary)` turns that summary into a
COSMETIC/SUBSTANTIVE verdict that is **resilient to transient API failures** and **fails protective**
on total exhaustion. If SUBSTANTIVE, the delta workflow proceeds (steps 2–7).
`classifyArtifactWithRetry(deltaPrdContent)` later guards the generated `delta_prd.md` with the
same resilience + protective default (`'DIRTY'` = reject/regenerate).

**User Journey**: PRD edited → hash mismatch → `diffPRDs()` → `classifyChangeWithRetry()` (S2
retries transient hiccups; on total failure returns protective `'SUBSTANTIVE'`) → COSMETIC (skip
delta) or SUBSTANTIVE (spawn delta) → delta PRD generated → `classifyArtifactWithRetry()` (S2;
protective `'DIRTY'` on failure) → CLEAN (use it) or DIRTY (reject/regenerate). This PRP delivers
the resilience + protective-default layer around S1's classifiers.

**Pain Points Addressed**: PRD §4.3 — *"never silently fall through to 'could not classify' and
proceed unprotected through a SUBSTANTIVE change."* Without S2, a transient API failure during
classification could crash the pipeline (bad UX) or — worse — be swallowed into a silent skip
(dangerous: a semantically significant PRD edit gets ignored). S2 guarantees the conservative
outcome (SUBSTANTIVE / DIRTY) when the classifier cannot reach a confident verdict.

---

## Why

- **PRD compliance**: PRD §4.3 (h3.5) step 1, "Change Classification", states verbatim:
  > "These classifiers MUST distinguish **transient API failures** (empty output, connection errors,
  > rate limits, overloaded) from invalid model responses, retrying up to a **bounded count (default
  > 4)** before giving up. On exhaustion they MUST fail to the **protective/conservative default**
  > (treat as SUBSTANTIVE / DIRTY) — never silently fall through to 'could not classify' and proceed
  > unprotected through a SUBSTANTIVE change."
  This PRP implements exactly that clause (retry + protective default). S1 implemented the
  classifier functions; S2 implements the resilience around them.
- **Work-item contract mapping**:
  - **CONTRACT (1) RESEARCH NOTE** — *"...retrying up to a bounded count (default 4) before giving
    up. On exhaustion they MUST fail to the protective/conservative default (treat as SUBSTANTIVE /
    DIRTY) — never silently fall through to 'could not classify' and proceed unprotected."* → This
    PRP is that clause in full: `retry()` with `maxAttempts=4` (configurable) + protective default
    on the catch (Task 1 + Task 2).
  - **CONTRACT (2) INPUT** — *"Classifier functions from P4.M1.T1.S1."* → S2 imports
    `classifyChange`, `classifyArtifact`, `ChangeClassification`, `ArtifactClassification`, and the
    module's `logger()` accessor from `src/core/change-classifier.ts` (S1's deliverable). S2 wraps,
    it does not redefine.
  - **CONTRACT (3) LOGIC** — *"(a) Wrap classifyChange and classifyArtifact in a bounded retry loop
    using retry() from src/utils/retry.ts with maxAttempts=4 (configurable)."* →
    `classifyChangeWithRetry` / `classifyArtifactWithRetry` call `retry(() => classifyChange(diff),
    { maxAttempts: getClassifierRetryMax(), ... })` (Task 2). `getClassifierRetryMax()` defaults to
    4 and is overridable via the `CLASSIFIER_RETRY_MAX` env var (Task 1). **Uses the lower-level
    `retry()`, NOT `retryAgentPrompt()`** — `retryAgentPrompt` hardcodes `maxAttempts: 3` via
    `AGENT_RETRY_CONFIG` (retry.ts:640-648) and cannot be configured to 4.
  - *"(b) Distinguish transient API failures (isTransientError → retry) from invalid model responses
    (parse failure → retry up to limit)."* → `isRetryable` is **intentionally OMITTED** from the
    `retry()` options → defaults to `isTransientError` (retry.ts:487). S1 throws
    `AgentError(PIPELINE_AGENT_LLM_FAILED)` (message avoids 'parse'/'parsing') → transient →
    retried. Node system errors (ECONNRESET etc.) + HTTP 429/5xx are also transient → retried. The
    "invalid model response" case (S1's null/enum-invalid output) IS the `AgentError` → retried.
    (PRD treats both transient-API and invalid-model as retryable up to the bound; S2 retries both
    via the default `isTransientError`.)
  - *"(c) On exhaustion (all retries fail), return the protective/conservative default: 'SUBSTANTIVE'
    for change classification, 'DIRTY' for artifact classification."* → the `catch` block around
    `retry()` returns the protective literal (`'SUBSTANTIVE'` / `'DIRTY'`).
  - *"(d) Log a warning when falling to protective default."* → `logger().warn({ error }, '...')`
    in the catch block.
  - *"(e) Never return 'could not classify' — always return a protective value."* → the resilient
    functions have exactly two return paths: the `retry()` success value OR the protective default
    in the catch. No third path. The return type is `ChangeClassification` / `ArtifactClassification`
    (a closed 2-value union) — TypeScript enforces a value is always returned.
  - **CONTRACT (4) OUTPUT** — *"Retry-wrapped classifiers with protective defaults. Consumed by
    P4.M1.T2.S1, P4.M1.T3.S1. Completes P4.M1.T1."* → S2's resilient functions are the contract for
    the downstream delta-workflow callers. Wiring is a LATER item (just as S1 noted for its own
    functions) — S2 does not wire into `handleDelta()`.
  - **CONTRACT (5) DOCS** — *"none — no user-facing/config/API surface change."* → Wait: S2 DOES
    add one config knob (`CLASSIFIER_RETRY_MAX`). Per the item, DOCS = "none" refers to
    user-facing/README/API docs. The env var gets the standard constants.ts JSDoc (Mode A — rides
    with the work, like every other constant in that file). No `.env.example` edit, no `docs/` edit,
    no README edit required for this subtask (the P6 doc-sweep owns those).
- **No overlap with sibling/parallel PRPs**: S1 (P4.M1.T1.S1) owns the classifier functions + prompts
  (S2 wraps them; S2 does NOT edit S1's functions or any prompt file). `retry.ts` is consumed
  read-only (S2 does NOT modify it). The parallel P3.M2.T6.S2 owns `src/core/temp-prompt-cleanup.ts`
  — not touched. This PRP's diff is exactly the three files listed under Deliverable.

---

## What

Two new resilient wrapper functions added to `src/core/change-classifier.ts` (ADD-only — S1's
existing exports are untouched), one new config trio in `src/config/constants.ts` (ADD-only), and
one new test file `tests/unit/core/change-classifier-resilient.test.ts`. **No** retry.ts edit,
**no** agent-factory edit, **no** prompts edit, **no** workflow/CLI edit, **no** new dependencies.

### Success Criteria

- [ ] **`src/config/constants.ts`** (MODIFY — ADD the trio, mirror `getCommitRetryMax` at :420):
      - `export const CLASSIFIER_RETRY_MAX = 'CLASSIFIER_RETRY_MAX';`
      - `export const DEFAULT_CLASSIFIER_RETRY_MAX = 4;` (PRD §4.3 "default 4").
      - `export function getClassifierRetryMax(): number` —
        `const raw = Number(process.env[CLASSIFIER_RETRY_MAX] ?? DEFAULT_CLASSIFIER_RETRY_MAX);`
        `if (Number.isNaN(raw) || raw <= 0) return DEFAULT_CLASSIFIER_RETRY_MAX;`
        `return Math.floor(raw);`
      - Full JSDoc block (env-var NAME doc + DEFAULT doc + getter doc with `@returns`/`@example`),
        mirroring the `COMMIT_RETRY_MAX` block (constants.ts:386-425) but citing PRD §4.3.
- [ ] **`src/core/change-classifier.ts`** (MODIFY — ADD two functions; DO NOT change S1's existing
      exports): new imports `retry, createDefaultOnRetry` from `'../utils/retry.js'` and
      `getClassifierRetryMax` from `'../config/constants.js'`. Then:
      - `export async function classifyChangeWithRetry(diffSummary: DiffSummary):
        Promise<ChangeClassification>` — see Data models block for exact body. Wraps S1's
        `classifyChange(diffSummary)` in `retry()` with `maxAttempts: getClassifierRetryMax()`,
        `baseDelay: 1000`, `maxDelay: 30000`, `backoffFactor: 2`, and
        `onRetry: createDefaultOnRetry('ChangeClassifier.classifyChange', getClassifierRetryMax())`.
        `isRetryable` OMITTED (→ defaults to `isTransientError`). `catch (error)` →
        `logger().warn({ error }, 'change classifier exhausted retries; failing to protective default SUBSTANTIVE')`
        → `return 'SUBSTANTIVE';`.
      - `export async function classifyArtifactWithRetry(content: string):
        Promise<ArtifactClassification>` — same shape around S1's `classifyArtifact(content)`;
        `catch` → warn-log → `return 'DIRTY';`.
      - Mode-A JSDoc on both citing PRD §4.3 + the protective-default contract + the configurable
        `CLASSIFIER_RETRY_MAX`.
- [ ] **`tests/unit/core/change-classifier-resilient.test.ts`** (NEW): Strategy-A mocks of BOTH
      `retry.js` (to simulate exhaustion / success) and `agent-factory.js` (to make the inner S1
      `classifyChange`/`classifyArtifact` throw or succeed). Covers: happy-path first-attempt
      success (4 label values), transient-then-success (retry recovers), exhaustion → protective
      default + warn-log (both SUBSTANTIVE and DIRTY), `maxAttempts`/`onRetry` options threading,
      inner-S1-function invocation assertion, and the config getter trio (env var override + default
      fallback + non-positive guard). 100% branch coverage of the two new functions.
- [ ] `npm run validate` GREEN.
- [ ] `git diff --name-only` shows EXACTLY `src/config/constants.ts`,
      `src/core/change-classifier.ts`, and `tests/unit/core/change-classifier-resilient.test.ts`.

---

## All Needed Context

### Context Completeness Check

✅ "If someone knew nothing about this codebase, would they have everything needed to implement
this successfully?" — YES. This PRP names: the EXACT precedent to mirror
(`git-commit.ts:486-510` — same `retry()`-wrap-LLM-boundary + catch-and-fallback shape); the EXACT
`retry()` signature + options (`retry<T>(fn, options?)`, default `maxAttempts:3`, `isRetryable`
defaults to `isTransientError`, rethrows last error on exhaustion); the EXACT `RetryOptions` keys
(`maxAttempts`, `baseDelay`, `maxDelay`, `backoffFactor`, `jitterFactor`, `isRetryable`, `onRetry`);
the EXACT `createDefaultOnRetry(operationName, maxAttempts)` factory (returns the warn-logging
callback — do NOT hand-roll the onRetry logger); the EXACT config-trio pattern
(`getCommitRetryMax` at constants.ts:420 — env-var NAME const + DEFAULT const + getter with
`Number.isNaN(raw) || raw <= 0` guard); the EXACT contract that S1 throws transient
`AgentError(PIPELINE_AGENT_LLM_FAILED)` (so `isTransientError` retries it); the EXACT test mock
boilerplate for `retry.js` (`prp-executor.test.ts:42-61`); and the EXACT scope boundary (ADD-only
to change-classifier.ts; do NOT touch S1's functions, retry.ts, prompts, agent-factory).

### Documentation & References

```yaml
# MUST READ - Include these in your context window

- file: plan/008_15504f60a0ef/P4M1T1S1/PRP.md
  why: THE CONTRACT for what S2 wraps. S1's deliverable is `src/core/change-classifier.ts` exporting
        `classifyChange(diffSummary)`, `classifyArtifact(content)`, the `ChangeClassification` /
        `ArtifactClassification` types + Zod schemas, and a module-level lazy `logger()` accessor.
        S1's functions throw transient `AgentError(PIPELINE_AGENT_LLM_FAILED)` on failure. S2 imports
        ALL of these (the functions to wrap, the types for the return signatures, and the `logger()`
        accessor for the warn-log). Read S1's PRP before writing S2 — the throwing boundary S1 set up
        is exactly what makes S2's retry work.
  critical: S1 throws AgentError whose message AVOIDS 'parse'/'parsing' — so isTransientError treats
        it as transient and S2 retries it. S1 calls agent.prompt(prompt) BARE (no retry) — that is
        why S2 must add the retry layer. S2 ADDS new functions; it does NOT modify S1's.

- file: src/utils/retry.ts
  section: retry() (lines ~470-555), RetryOptions (lines ~153-230), createDefaultOnRetry (lines ~590-625),
           isTransientError (lines 311-395), AGENT_RETRY_CONFIG (lines 640-648), retryAgentPrompt (lines 668-698)
  why: THE RETRY ENGINE S2 consumes. retry<T>(fn, options?) runs fn up to maxAttempts times; on a
        retryable error (per isRetryable, default isTransientError) it sleeps calculateDelay(...) and
        retries; on a non-retryable error OR exhaustion it rethrows the last error. S2 wraps S1's
        functions in retry() and catches the rethrow to apply the protective default.
  pattern: |
    const result = await retry(() => classifyChange(diff), {
      maxAttempts: getClassifierRetryMax(),
      baseDelay: 1000, maxDelay: 30000, backoffFactor: 2,
      onRetry: createDefaultOnRetry('ChangeClassifier.classifyChange', getClassifierRetryMax()),
    }); // isRetryable OMITTED → defaults to isTransientError
  gotcha: DO NOT use retryAgentPrompt — it hardcodes maxAttempts:3 (AGENT_RETRY_CONFIG, retry.ts:640).
        S2 needs maxAttempts:4 (configurable), so it uses the lower-level retry() directly. DO NOT
        modify retry.ts — S2 consumes it read-only. createDefaultOnRetry returns a function — pass it
        the operationName + maxAttempts and it logs attempt/delay/errorName/errorCode/errorMessage.

- file: src/utils/git-commit.ts
  section: lines 486-525 (the stagecoach retry boundary)
  why: THE EXACT PRECEDENT. git-commit.ts wraps an LLM boundary (generateCommitMessage) in retry()
        with { maxAttempts: getCommitRetryMax(), baseDelay: getCommitRetryDelayMs(), maxDelay:
        getCommitRetryDelayCapMs(), backoffFactor: 2, onRetry: createDefaultOnRetry(...) } and on the
        catch falls back (to a placeholder commit). S2 mirrors this — the ONLY difference is S2's
        fallback is the protective default ('SUBSTANTIVE'/'DIRTY') instead of a placeholder commit,
        and S2's maxAttempts comes from getClassifierRetryMax() (default 4) instead of
        getCommitRetryMax() (default 5). Copy the structure verbatim.
  pattern: |
    try {
      const result = await retry(() => innerFn(input), {
        maxAttempts: getClassifierRetryMax(),
        baseDelay: 1000, maxDelay: 30000, backoffFactor: 2,
        onRetry: createDefaultOnRetry('ChangeClassifier.classifyChange', getClassifierRetryMax()),
      });
      return result;
    } catch (error) {
      logger().warn({ error }, '<protective-default message>');
      return 'SUBSTANTIVE'; // or 'DIRTY'
    }
  critical: the comment in git-commit.ts:488 — "isRetryable is intentionally OMITTED → defaults to
        isTransientError" — is load-bearing. S2 copies this exact intent. Do NOT pass a custom
        isRetryable; the default isTransientError is correct (it retries S1's AgentError + all
        transient-API failures).

- file: src/config/constants.ts
  section: ISSUE_RETRY_MAX block (lines 385-425) and COMMIT_RETRY_MAX block (lines 449-425)
  why: THE TEMPLATE for the new config trio. Each trio is: `export const X = 'X'` (env-var NAME) +
        `export const DEFAULT_X = N` + `export function getX(): number` that reads
        `Number(process.env[X] ?? DEFAULT_X)`, guards `Number.isNaN(raw) || raw <= 0` → default, and
        `Math.floor`s the result. S2 adds the identical trio for CLASSIFIER_RETRY_MAX (default 4).
  pattern: |
    export const CLASSIFIER_RETRY_MAX = 'CLASSIFIER_RETRY_MAX';
    export const DEFAULT_CLASSIFIER_RETRY_MAX = 4;
    export function getClassifierRetryMax(): number {
      const raw = Number(process.env[CLASSIFIER_RETRY_MAX] ?? DEFAULT_CLASSIFIER_RETRY_MAX);
      if (Number.isNaN(raw) || raw <= 0) return DEFAULT_CLASSIFIER_RETRY_MAX;
      return Math.floor(raw);
    }
  gotcha: place the trio near the other retry-max constants (after COMMIT_RETRY_MAX block, ~line 490).
        Full JSDoc for all three exports (mirror the COMMIT_RETRY_MAX block's doc style, citing
        PRD §4.3 "default 4"). ESM .js import in change-classifier.ts: `from '../config/constants.js'`.

- file: src/core/change-classifier.ts   # (S1's deliverable — will exist when S2 begins)
  section: classifyChange, classifyArtifact, ChangeClassification, ArtifactClassification, logger() accessor
  why: THE MODULE S2 MODIFIES (ADD-only). S2 imports nothing new at the top beyond retry/createDefaultOnRetry
        + getClassifierRetryMax; it REUSES S1's logger() accessor and the two type unions for the return
        signatures. S2 ADDS classifyChangeWithRetry + classifyArtifactWithRetry. DO NOT modify S1's
        classifyChange/classifyArtifact/schemas/types/accessor — ADD only.
  gotcha: the `logger()` accessor is module-private (`const logger = () => (_logger ??= getLogger('ChangeClassifier'))`).
        S2's new functions call `logger().warn(...)` — same accessor, no new logger instance. The
        `DiffSummary` type is already imported by S1 (for classifyChange's signature) — S2's
        classifyChangeWithRetry takes the same `diffSummary: DiffSummary` param; no new import needed.

- file: src/utils/errors.ts
  section: AgentError (lines ~418-428), ErrorCodes, isTransientError reference
  why: S1 throws AgentError(PIPELINE_AGENT_LLM_FAILED). S2 does NOT throw — it catches and returns the
        protective default. But S2's test asserts that on exhaustion the LAST thrown error (from retry's
        rethrow) is an AgentError with code PIPELINE_AGENT_LLM_FAILED (to prove the boundary is
        transient/retried). Import { isAgentError } from '../utils/errors.js' in the TEST (errors.ts:703)
        if asserting on the caught error. S2's production code does not import from errors.ts.
  gotcha: AgentError.code is HARDCODED to PIPELINE_AGENT_LLM_FAILED (errors.ts:423) — stable for test
        assertions.

- file: tests/unit/agents/prp-executor.test.ts
  section: lines 42-61 (the retry.js mock)
  why: THE TEST TEMPLATE for mocking retry.js. vi.mock('../../../src/utils/retry.js', () => ({
        retry: vi.fn(), retryAgentPrompt: vi.fn(), retryMcpTool: vi.fn(), createDefaultOnRetry:
        vi.fn(() => () => {}) })). Then in the test, mockRetry.mockImplementation(async (fn, opts) =>
        fn()) to make retry pass-through, OR mockRetry.mockRejectedValueOnce(...).mockResolvedValueOnce(...)
        to simulate retry-then-success, OR mock the inner S1 function (via agent-factory mock) to throw
        always → simulate exhaustion.
  pattern: |
    vi.mock('../../../src/utils/retry.js', () => ({
      retry: vi.fn(async (fn: () => Promise<unknown>) => fn()),   // pass-through default
      createDefaultOnRetry: vi.fn(() => vi.fn()),
    }));
  gotcha: combine with the agent-factory mock (tests/unit/workflows/delta-analysis-workflow.test.ts:24-31)
        so the INNER S1 classifyChange/classifyArtifact can be made to throw (transient) or succeed.
        Mock BOTH modules; vi.clearAllMocks() in beforeEach.

- file: tests/unit/workflows/delta-analysis-workflow.test.ts
  section: lines 24-31 (agent-factory mock boilerplate), 105-123 (AgentResponse injection)
  why: THE agent-factory mock template. S2's test mocks createQAAgent so the inner S1 classifier's
        agent.prompt() resolves to a success AgentResponse (happy path) or rejects/returns-error
        (transient failure → exhaustion path). Pattern: mockCreateQAAgent.mockReturnValue({ prompt:
        vi.fn().mockResolvedValue({ status:'success', data:'SUBSTANTIVE', error:null, metadata:{} }) }).
  gotcha: S2 does NOT need to re-mock the prompt-generator (S1's test does); S2 mocks at the
        agent-factory + retry layer. But to assert the inner S1 classifyChange is invoked, S2 may
        also spy on it (vi.spyOn on the change-classifier module) OR rely on the agent-factory mock
        being called.

- file: vitest.config.ts
  why: 100% coverage thresholds (statements/branches/functions/lines ALL 100). pool:'forks'.
        The new test MUST achieve 100% coverage of the two new resilient functions (every branch:
        success path, catch/protective-default path for BOTH functions). If retry is mocked as
        pass-through, the success branch is covered; if retry is mocked to always throw, the
        catch/protective-default branch is covered. Both functions need both branches tested.

- file: plan/008_15504f60a0ef/P4M1T1S2/research/00_research_summary.md
  why: S2's own research summary. §VERDICT, §SCOPE BOUNDARY (S1 vs S2), §The canonical retry() pattern
        (git-commit.ts:486-510), §retry() facts, §isTransientError, §Config trio pattern,
        §Protective default contract, §Test conventions. The implementer MUST read this before writing.
```

### Current Codebase tree (relevant slice)

```bash
src/config/
  constants.ts                   # MODIFY — add CLASSIFIER_RETRY_MAX trio (after COMMIT_RETRY_MAX block ~line 490).
src/core/
  change-classifier.ts           # MODIFY (ADD-only) — add classifyChangeWithRetry + classifyArtifactWithRetry.
                                 #   S1's classifyChange/classifyArtifact/types/logger() accessor REUSED (read-only).
  prd-differ.ts                  # READ-ONLY — DiffSummary type (already imported by S1; S2 reuses S1's import).
src/utils/
  retry.ts                       # READ-ONLY — retry() + createDefaultOnRetry + isTransientError. S2 CONSUMES, never edits.
  git-commit.ts                  # READ-ONLY — THE PRECEDENT (retry()-wrap-LLM + catch-fallback, lines 486-525).
  errors.ts                      # READ-ONLY — AgentError/PIPELINE_AGENT_LLM_FAILED (for test assertions only).
  logger.ts                      # READ-ONLY — getLogger/Logger (S1's accessor reused; S2 imports nothing new).
tests/unit/
  core/
    change-classifier.test.ts            # S1's test — DO NOT TOUCH.
    change-classifier-resilient.test.ts  # NEW — S2's resilient-layer suite.
  agents/
    prp-executor.test.ts                 # READ-ONLY — retry.js mock template (lines 42-61).
  workflows/
    delta-analysis-workflow.test.ts      # READ-ONLY — agent-factory mock template (lines 24-31).
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
src/config/
  constants.ts                   # MODIFY — ADD the CLASSIFIER_RETRY_MAX trio (env-var NAME const +
                                 #   DEFAULT_CLASSIFIER_RETRY_MAX=4 + getClassifierRetryMax getter). Mirrors
                                 #   COMMIT_RETRY_MAX block. PRD §4.3 "default 4".
src/core/
  change-classifier.ts           # MODIFY (ADD-only) — ADD classifyChangeWithRetry(diffSummary) +
                                 #   classifyArtifactWithRetry(content). Each wraps S1's inner fn in
                                 #   retry({ maxAttempts: getClassifierRetryMax(), baseDelay: 1000,
                                 #   maxDelay: 30000, backoffFactor: 2, onRetry: createDefaultOnRetry(...) })
                                 #   with isRetryable OMITTED (→ isTransientError). On catch → warn-log +
                                 #   return protective default ('SUBSTANTIVE' / 'DIRTY'). Mode-A JSDoc PRD §4.3.
tests/unit/core/
  change-classifier-resilient.test.ts  # NEW — Strategy-A mocks (retry.js + agent-factory.js). Covers
                                 #   happy-path (4 labels), retry-then-success, exhaustion → protective
                                 #   default + warn-log, maxAttempts/onRetry options threading, inner-S1
                                 #   invocation, config getter trio (override/default/non-positive guard).
                                 #   100% branch coverage of the two new functions.
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL (use retry(), NOT retryAgentPrompt): retryAgentPrompt hardcodes maxAttempts:3 via
//   AGENT_RETRY_CONFIG (retry.ts:640-648). S2 needs maxAttempts:4 (configurable per PRD §4.3), so it
//   MUST use the lower-level retry() and pass maxAttempts: getClassifierRetryMax() explicitly.

// CRITICAL (isRetryable OMITTED → defaults to isTransientError): this is the load-bearing choice. S1
//   throws AgentError(PIPELINE_AGENT_LLM_FAILED) — transient (isTransientError, retry.ts:326-337) because
//   S1's messages avoid 'parse'/'parsing'. Node system errors (ECONNRESET etc.) + HTTP 429/5xx are also
//   transient. Passing a custom isRetryable would risk classifying S1's AgentError as permanent → no
//   retry → wrong behavior. Mirror git-commit.ts:488 ("isRetryable is intentionally OMITTED").

// CRITICAL (retry() RETHROWS on exhaustion — S2 must catch): retry() rethrows the last error when all
//   maxAttempts fail (retry.ts:548-550). S2 wraps the retry() call in try/catch; the catch returns the
//   protective default. If S2 forgets the catch, the protective default is never applied and the PRD
//   §4.3 "never silently fall through" clause is violated (the function would throw out instead of
//   returning SUBSTANTIVE/DIRTY).

// CRITICAL (catch returns a literal, not the thrown value): the catch block's return is the protective
//   DEFAULT ('SUBSTANTIVE' / 'DIRTY'), NOT the error or the last attempted value. The error is only
//   passed to logger().warn({ error }, ...) for diagnostics. The return type is the closed 2-value union
//   (ChangeClassification / ArtifactClassification) — TypeScript enforces a value is always returned.

// CRITICAL (do NOT modify S1's functions): S2 ADDS classifyChangeWithRetry / classifyArtifactWithRetry.
//   It does NOT edit classifyChange / classifyArtifact / the schemas / the types / the logger() accessor.
//   S1's functions remain the bare-throwing inner call. If S2 inlines retry into S1's functions, it
//   breaks S1's test (which asserts agent.prompt is called bare) and violates the S1/S2 scope split.

// CRITICAL (do NOT modify retry.ts): S2 consumes retry() / createDefaultOnRetry / isTransientError
//   read-only. Modifying retry.ts would affect every other consumer (git-commit, bug-hunt, delta-analysis,
//   prp-executor, prp-generator) and cause merge contention + regressions.

// GOTCHA (createDefaultOnRetry returns a FUNCTION): createDefaultOnRetry(operationName, maxAttempts)
//   returns (attempt, error, delay) => void. S2 calls it ONCE in the options object; it is NOT the onRetry
//   callback itself. Pattern: onRetry: createDefaultOnRetry('ChangeClassifier.classifyChange',
//   getClassifierRetryMax()). It logs attempt/delay/errorName/errorCode/errorMessage at warn level.

// GOTCHA (reuse S1's logger() accessor): S1 already declares `const logger = () => (_logger ??=
//   getLogger('ChangeClassifier'))` in change-classifier.ts. S2's new functions call logger().warn(...)
//   — same accessor, no new logger instance, no new import. Do NOT declare a second accessor.

// GOTCHA (getClassifierRetryMax is called TWICE in the options object — once for maxAttempts, once for
//   onRetry's maxAttempts arg): this matches git-commit.ts:497+503. Calling it twice is fine (it's a
//   cheap pure read of process.env). Alternatively compute once into a const — either is acceptable.
//   Prefer computing once for clarity: `const maxAttempts = getClassifierRetryMax();` then use it twice.

// GOTCHA (empty-content input on classifyArtifactWithRetry): S1's classifyArtifact throws on empty
//   content BEFORE calling the agent. That throw is an AgentError → transient → S2 retries it 4× →
//   exhaustion → catch → return 'DIRTY'. This is ACCEPTABLE per PRD §4.3 (empty artifact content is a
//   degenerate protective case — treating it as DIRTY is conservative/safe). S2 does NOT special-case
//   empty content; the protective default handles it. (If desired, S2 MAY short-circuit empty content
//   to 'DIRTY' without retrying — but that is an OPTIONAL optimization, not required. The simplest
//   correct behavior is to let it flow through retry → protective default.)

// GOTCHA (config getter trio — Number.isNaN + <= 0 guard): mirror getCommitRetryMax (constants.ts:420)
//   EXACTLY: `const raw = Number(process.env[X] ?? DEFAULT_X); if (Number.isNaN(raw) || raw <= 0) return
//   DEFAULT_X; return Math.floor(raw);`. The `<= 0` guard rejects zero/negative (a non-positive retry
//   count is meaningless). Math.floor rejects fractional attempts.

// GOTCHA (ESM .js imports): all intra-project imports use .js extensions even in .ts source
//   (e.g. '../utils/retry.js', '../config/constants.js'). S1's existing imports in change-classifier.ts
//   already follow this; S2 adds the two new imports in the same style.

// GOTCHA (100% branch coverage enforced): vitest.config.ts requires 100% statements/branches/functions/
//   lines. The two new functions each have TWO branches: (1) retry() succeeds → return result; (2) retry()
//   throws → catch → return protective default. Each function needs BOTH branches tested. Mock retry as
//   pass-through (success branch) AND mock retry/inner-fn to always throw (protective-default branch).

// GOTCHA (do NOT wire into handleDelta or any workflow): the caller is a LATER work item (the
//   delta-workflow caller, after S2). classifyChangeWithRetry / classifyArtifactWithRetry are exported
//   for P4.M1.T2.S1 / P4.M1.T3.S1 to consume. Wiring now would be dead code and out of scope (S1 noted
//   the same for its own functions).
```

---

## Implementation Blueprint

### Data models and structure

S2 adds two resilient wrapper functions to `src/core/change-classifier.ts` (the module S1 created).
The new functions reuse S1's inner classifiers, types, and logger accessor. **ADD-only** — S1's
existing exports are untouched.

```typescript
// === additions to src/core/change-classifier.ts (TOP OF FILE — new imports) ===
import { retry, createDefaultOnRetry } from '../utils/retry.js';
import { getClassifierRetryMax } from '../config/constants.js';
// (S1's existing imports — createQAAgent, createChangeClassificationPrompt, AgentError, getLogger,
//  DiffSummary, zod — remain. S2 adds ONLY the two lines above.)

// === additions to src/core/change-classifier.ts (BOTTOM OF FILE — new functions) ===

/**
 * Classify a detected PRD change as COSMETIC or SUBSTANTIVE with TRANSIENT-API RETRY and a
 * PROTECTIVE DEFAULT on exhaustion. PRD §4.3.
 *
 * @remarks
 * Wraps {@link classifyChange} (the inner LLM call) in a bounded `retry()` loop with
 * `maxAttempts = getClassifierRetryMax()` (default 4, configurable via `CLASSIFIER_RETRY_MAX`).
 * Transient API failures (empty output, connection errors, rate limits, overloaded) and the
 * inner classifier's `AgentError(PIPELINE_AGENT_LLM_FAILED)` are retried (via the default
 * `isTransientError`). On exhaustion (all attempts fail) this function FAILS TO THE PROTECTIVE
 * DEFAULT `'SUBSTANTIVE'` and warns — it NEVER returns `'could not classify'` or throws.
 *
 * Per PRD §4.3: "On exhaustion they MUST fail to the protective/conservative default (treat as
 * SUBSTANTIVE / DIRTY) — never silently fall through to 'could not classify' and proceed
 * unprotected through a SUBSTANTIVE change."
 *
 * @param diffSummary - The structural diff summary from `diffPRDs()` (src/core/prd-differ.ts).
 * @returns `'COSMETIC'` on a confident trivial change; `'SUBSTANTIVE'` on a significant change OR
 *          on retry exhaustion (protective default).
 */
export async function classifyChangeWithRetry(
  diffSummary: DiffSummary
): Promise<ChangeClassification> {
  const maxAttempts = getClassifierRetryMax();
  try {
    return await retry(() => classifyChange(diffSummary), {
      maxAttempts,
      baseDelay: 1000,
      maxDelay: 30000,
      backoffFactor: 2,
      // isRetryable intentionally OMITTED → defaults to isTransientError (mirrors git-commit.ts:488).
      // S1 throws AgentError(PIPELINE_AGENT_LLM_FAILED) which is transient (message avoids 'parse').
      onRetry: createDefaultOnRetry(
        'ChangeClassifier.classifyChange',
        maxAttempts
      ),
    });
  } catch (error) {
    // PRD §4.3 protective default: all retries exhausted → fail SAFE (treat as SUBSTANTIVE).
    logger().warn(
      { error, maxAttempts },
      'change classifier exhausted retries; failing to protective default SUBSTANTIVE'
    );
    return 'SUBSTANTIVE';
  }
}

/**
 * Classify a generated artifact (e.g. `delta_prd.md` content) as CLEAN or DIRTY with
 * TRANSIENT-API RETRY and a PROTECTIVE DEFAULT on exhaustion. PRD §4.3.
 *
 * @remarks
 * Wraps {@link classifyArtifact} in a bounded `retry()` loop (same config as
 * {@link classifyChangeWithRetry}). On exhaustion this function FAILS TO THE PROTECTIVE DEFAULT
 * `'DIRTY'` and warns — it NEVER returns `'could not classify'` or throws.
 *
 * @param content - The artifact text to classify (e.g. delta_prd.md content).
 * @returns `'CLEAN'` on a well-formed faithful artifact; `'DIRTY'` on a contaminated artifact OR
 *          on retry exhaustion (protective default).
 */
export async function classifyArtifactWithRetry(
  content: string
): Promise<ArtifactClassification> {
  const maxAttempts = getClassifierRetryMax();
  try {
    return await retry(() => classifyArtifact(content), {
      maxAttempts,
      baseDelay: 1000,
      maxDelay: 30000,
      backoffFactor: 2,
      onRetry: createDefaultOnRetry(
        'ChangeClassifier.classifyArtifact',
        maxAttempts
      ),
    });
  } catch (error) {
    // PRD §4.3 protective default: all retries exhausted → fail SAFE (treat as DIRTY).
    logger().warn(
      { error, maxAttempts },
      'artifact classifier exhausted retries; failing to protective default DIRTY'
    );
    return 'DIRTY';
  }
}
```

> **NOTE on the config trio (src/config/constants.ts):** add it AFTER the `COMMIT_RETRY_MAX` block
> (~line 490), mirroring that block's three-export structure + full JSDoc. The getter body is
> byte-for-byte the `getCommitRetryMax` shape with the names swapped and default = 4.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/config/constants.ts — add the CLASSIFIER_RETRY_MAX trio
  - IMPLEMENT: three exports (env-var NAME const + DEFAULT const + getter), mirroring the
    COMMIT_RETRY_MAX block (constants.ts:449-425) and ISSUE_RETRY_MAX block (constants.ts:385-425):
      export const CLASSIFIER_RETRY_MAX = 'CLASSIFIER_RETRY_MAX';
      export const DEFAULT_CLASSIFIER_RETRY_MAX = 4;   # PRD §4.3 "default 4"
      export function getClassifierRetryMax(): number {
        const raw = Number(process.env[CLASSIFIER_RETRY_MAX] ?? DEFAULT_CLASSIFIER_RETRY_MAX);
        if (Number.isNaN(raw) || raw <= 0) return DEFAULT_CLASSIFIER_RETRY_MAX;
        return Math.floor(raw);
      }
  - FOLLOW pattern: getCommitRetryMax (constants.ts:420-425) — same guard, same Math.floor.
  - NAMING: SCREAMING_SNAKE_CASE env-var NAME; DEFAULT_ prefix on the default; get-prefixed getter.
  - PLACEMENT: src/config/constants.ts, after the COMMIT_RETRY_MAX block (~line 490).
  - JSDOC: full block for each of the three exports (mirror the COMMIT_RETRY_MAX block's doc style:
    env-var NAME doc with @example showing process.env read; DEFAULT doc with @example showing 4;
    getter doc with @returns + @example). Cite PRD §4.3 ("default 4") in the DEFAULT doc.

Task 2: MODIFY src/core/change-classifier.ts — ADD the two resilient functions (see Data models block)
  - ADD imports (top of file, alongside S1's existing imports):
      import { retry, createDefaultOnRetry } from '../utils/retry.js';
      import { getClassifierRetryMax } from '../config/constants.js';
  - ADD classifyChangeWithRetry(diffSummary: DiffSummary): Promise<ChangeClassification> — wraps
    classifyChange in retry() (see Data models block). isRetryable OMITTED → isTransientError.
    catch → logger().warn(...) → return 'SUBSTANTIVE'.
  - ADD classifyArtifactWithRetry(content: string): Promise<ArtifactClassification> — same shape
    around classifyArtifact. catch → return 'DIRTY'.
  - FOLLOW pattern: src/utils/git-commit.ts:486-525 (the stagecoach retry boundary — EXACT same
    try/retry/catch-fallback shape; S2's fallback is the protective default instead of a placeholder).
  - NAMING: classifyChangeWithRetry / classifyArtifactWithRetry (verb-first + WithRetry suffix,
    matching the codebase's *WithRetry / *Retry naming convention in retry.ts + git-commit.ts).
  - DEPENDENCIES: S1's classifyChange/classifyArtifact + ChangeClassification/ArtifactClassification
    + logger() accessor (all already in this module); retry/createDefaultOnRetry (utils/retry.js);
    getClassifierRetryMax (config/constants.js, Task 1).
  - PLACEMENT: src/core/change-classifier.ts, AFTER S1's classifyArtifact (bottom of the classifier
    section). DO NOT interleave with S1's functions.
  - JSDOC: Mode A on both functions citing PRD §4.3 + the protective-default contract +
    @param/@returns (see Data models block).
  - GOTCHA: compute `const maxAttempts = getClassifierRetryMax();` once and reuse for both the
    `maxAttempts` option and the `createDefaultOnRetry` second arg (matches git-commit.ts clarity).

Task 3: CREATE tests/unit/core/change-classifier-resilient.test.ts (Strategy A — the resilient suite)
  - IMPORT: describe, expect, it, vi, beforeEach from 'vitest'; classifyChangeWithRetry,
    classifyArtifactWithRetry from '../../../src/core/change-classifier.js'; type DiffSummary from
    '../../../src/core/prd-differ.js'; createQAAgent from '../../../src/agents/agent-factory.js';
    { retry, createDefaultOnRetry } from '../../../src/utils/retry.js'; { getClassifierRetryMax,
    DEFAULT_CLASSIFIER_RETRY_MAX, CLASSIFIER_RETRY_MAX } from '../../../src/config/constants.js'.
  - MOCK (top-level, before imports):
      vi.mock('../../../src/agents/agent-factory.js', () => ({ createQAAgent: vi.fn() }));
      vi.mock('../../../src/utils/retry.js', () => ({
        retry: vi.fn(async (fn: () => Promise<unknown>) => fn()),  # pass-through default
        createDefaultOnRetry: vi.fn(() => vi.fn()),
      }));
    # NOTE: do NOT mock config/constants.js — test the REAL getClassifierRetryMax by setting
    # process.env[CLASSIFIER_RETRY_MAX] and restoring it (the getter is pure + cheap to test).
  - beforeEach: vi.clearAllMocks(); restore process.env[CLASSIFIER_RETRY_MAX] (delete it so the
    default applies). Set up the agent-factory mockReturnValue({ prompt: vi.fn() }) per test.
  - describe('classifyChangeWithRetry'):
    * GIVEN retry passes through + inner classifyChange returns SUBSTANTIVE → mock agent.prompt to
      resolve { status:'success', data:'SUBSTANTIVE', error:null, metadata:{} }; const result = await
      classifyChangeWithRetry(diffFixture); expect(result).toBe('SUBSTANTIVE'); assert retry was
      called with a fn (vi.fn), and the options object has maxAttempts: getClassifierRetryMax() (=4
      by default), baseDelay:1000, maxDelay:30000, backoffFactor:2, onRetry is a function.
    * GIVEN retry passes through + inner returns COSMETIC → data:'COSMETIC' → expect('COSMETIC').
    * GIVEN retry recovers (transient then success) → mockRetry.mockImplementationOnce(async (fn) =>
      { throw new (require AgentError)('transient'); }).mockImplementationOnce(async (fn) => fn());
      then inner agent.prompt resolves SUBSTANTIVE → expect('SUBSTANTIVE'). (Proves the retry layer
      is between the caller and the inner classifier.)
    * GIVEN exhaustion (retry always throws) → mockRetry.mockRejectedValue(new AgentError('exhausted'));
      OR mockRetry.mockImplementation(async () => { throw new AgentError('exhausted'); }); const result
      = await classifyChangeWithRetry(diff); expect(result).toBe('SUBSTANTIVE') (PROTECTIVE DEFAULT);
      assert logger.warn was called (spy on the module's logger, or assert via a warn mock). [See test
      gotcha below on asserting the warn.]
    * GIVEN maxAttempts comes from getClassifierRetryMax() → set process.env[CLASSIFIER_RETRY_MAX]='7';
      call classifyChangeWithRetry(diff); assert the options passed to retry had maxAttempts:7.
    * GIVEN the inner classifyChange is invoked → assert createQAAgent was called (the inner fn ran).
  - describe('classifyArtifactWithRetry'):
    * GIVEN retry passes through + inner returns CLEAN → expect('CLEAN').
    * GIVEN retry passes through + inner returns DIRTY → expect('DIRTY').
    * GIVEN exhaustion → mockRetry always throws → expect('DIRTY') (PROTECTIVE DEFAULT); warn fired.
  - describe('getClassifierRetryMax config trio'):
    * GIVEN env var unset → delete process.env[CLASSIFIER_RETRY_MAX]; expect(getClassifierRetryMax())
      .toBe(4) (DEFAULT_CLASSIFIER_RETRY_MAX).
    * GIVEN env var set to valid positive int → process.env[CLASSIFIER_RETRY_MAX]='8';
      expect(getClassifierRetryMax()).toBe(8). (restore in afterEach.)
    * GIVEN env var non-numeric → '=abc' → expect(getClassifierRetryMax()).toBe(4) (fallback).
    * GIVEN env var zero/negative → '0' / '-1' → expect(getClassifierRetryMax()).toBe(4) (guard).
    * GIVEN env var fractional → '2.9' → expect(getClassifierRetryMax()).toBe(2) (Math.floor).
  - COVERAGE: every branch in the two new functions — success (change), success (artifact),
    exhaustion/protective-default (change), exhaustion/protective-default (artifact). 100%
    statements/branches/functions/lines of the new code.
  - FOLLOW pattern: tests/unit/agents/prp-executor.test.ts:42-61 (retry.js mock) +
    tests/unit/workflows/delta-analysis-workflow.test.ts:24-31 (agent-factory mock) +
    tests/unit/core/prd-differ.test.ts (GIVEN/SHOULD + SETUP/EXECUTE/VERIFY).
  - FIXTURE: build a DiffSummary inline (prd-differ.test.ts:498-567 style) for
    classifyChangeWithRetry.
  - PLACEMENT: tests/unit/core/change-classifier-resilient.test.ts.
  - GOTCHA (asserting the warn-log): the module's `logger()` accessor is module-private. Two options:
    (a) spy on the underlying getLogger — vi.spyOn(loggerModule, 'getLogger') and assert .warn called;
    (b) since this is a behavior test (the protective default is the contract), asserting the RETURN
    value ('SUBSTANTIVE'/'DIRTY') is the primary check and the warn is secondary. Prefer (b) for the
    core assertion + optionally (a) for the warn assertion. Do NOT restructure the module just to make
    the logger testable — the return value is the contract.

Task 4: JSDoc (Mode A — rides with the work)
  - constants.ts: JSDoc on CLASSIFIER_RETRY_MAX, DEFAULT_CLASSIFIER_RETRY_MAX, getClassifierRetryMax
    (mirror the COMMIT_RETRY_MAX block; cite PRD §4.3).
  - change-classifier.ts: JSDoc on classifyChangeWithRetry + classifyArtifactWithRetry (see Data
    models block — PRD §4.3 citation + protective-default contract + @param/@returns).
  - change-classifier-resilient.test.ts: describe-block doc comments citing PRD §4.3 + the S1/S2 split.
```

### Implementation Patterns & Key Details

```typescript
// PATTERN: the retry()-wrap-LLM-boundary + catch-fallback (git-commit.ts:486-525 — THE precedent).
export async function classifyChangeWithRetry(
  diffSummary: DiffSummary
): Promise<ChangeClassification> {
  const maxAttempts = getClassifierRetryMax();   // default 4 (PRD §4.3), configurable via env
  try {
    return await retry(() => classifyChange(diffSummary), {
      maxAttempts,
      baseDelay: 1000,
      maxDelay: 30000,
      backoffFactor: 2,
      // isRetryable OMITTED → defaults to isTransientError (mirrors git-commit.ts:488).
      // S1's AgentError(PIPELINE_AGENT_LLM_FAILED) + all transient-API failures are retried.
      onRetry: createDefaultOnRetry('ChangeClassifier.classifyChange', maxAttempts),
    });
  } catch (error) {
    // PRD §4.3: retry() rethrows the last error on exhaustion → catch → protective default.
    logger().warn(
      { error, maxAttempts },
      'change classifier exhausted retries; failing to protective default SUBSTANTIVE'
    );
    return 'SUBSTANTIVE';   // PROTECTIVE — never 'could not classify', never rethrow
  }
}

// PATTERN: the config getter trio (constants.ts:420 — getCommitRetryMax is the template).
export function getClassifierRetryMax(): number {
  const raw = Number(
    process.env[CLASSIFIER_RETRY_MAX] ?? DEFAULT_CLASSIFIER_RETRY_MAX
  );
  if (Number.isNaN(raw) || raw <= 0) {
    return DEFAULT_CLASSIFIER_RETRY_MAX;   // default 4 (PRD §4.3)
  }
  return Math.floor(raw);
}

// PATTERN: the Strategy-A test mock for retry.js (prp-executor.test.ts:42-61).
vi.mock('../../../src/utils/retry.js', () => ({
  retry: vi.fn(async (fn: () => Promise<unknown>) => fn()),   // pass-through default
  createDefaultOnRetry: vi.fn(() => vi.fn()),
}));
// To simulate exhaustion: mockRetry.mockImplementation(async () => { throw new AgentError('exhausted'); });
// To simulate retry-then-success: mockImplementationOnce(throw).mockImplementationOnce(fn => fn()).
```

### Integration Points

```yaml
NO RUNTIME INTEGRATION in S2 — this PRP adds the resilient wrapper functions + config + tests. It does NOT:
  - wire classifyChangeWithRetry/classifyArtifactWithRetry into handleDelta() (prp-pipeline.ts) — that
    is a LATER work item (the delta-workflow caller). Wiring now would be dead code.
  - modify retry.ts, agent-factory.ts, prompts.ts, prompts/index.ts, prompts/change-classifier-prompt.ts,
    prd-differ.ts, models.ts, any workflow/CLI.
  - remove or repurpose S1's classifyChange/classifyArtifact (they remain the inner bare-throwing call).
CONFIG:
  - add to: src/config/constants.ts
  - new env var: CLASSIFIER_RETRY_MAX (default 4, per PRD §4.3). Read via getClassifierRetryMax().
ROUTES / DATABASE:
  - none.
The ONLY consumers of the new functions in S2 are:
  - tests/unit/core/change-classifier-resilient.test.ts (this PRP).
  - (future) P4.M1.T2.S1 (delta-workflow response selection) invokes classifyChangeWithRetry.
  - (future) P4.M1.T3.S1 (breakdown-consumes-delta-prd) invokes classifyArtifactWithRetry.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Run after creating each file — fix before proceeding
npm run lint            # eslint . --ext .ts (the new/modified files must pass)
npm run typecheck       # tsc --noEmit -p tsconfig.build.json (catches import errors in change-classifier.ts)
npm run format:check    # prettier --check (run `npm run format` if it complains)

# Expected: Zero errors. If typecheck flags a missing export from constants.ts, confirm the trio is
# added and exported. If lint flags unused imports (e.g. createDefaultOnRetry if accidentally unused),
# remove them. The two new functions in change-classifier.ts must use retry + createDefaultOnRetry +
# getClassifierRetryMax — all three imports are exercised.
```

### Level 2: Unit Tests (Component Validation)

```bash
# Test the new resilient functions in isolation
npm run test:run -- change-classifier-resilient

# Coverage of the new code (MUST be 100% statements/branches/functions/lines)
npm run test:coverage -- change-classifier-resilient

# Full suite (ensure no regression — the constants.ts edit must not break existing config tests;
# the change-classifier.ts ADD must not break S1's change-classifier.test.ts)
npm run test:run

# Expected: All tests pass. The new tests (happy-path 4 labels, retry-then-success, exhaustion →
# protective default + warn, maxAttempts/onRetry threading, inner-S1 invocation, config trio override/
# default/non-numeric/zero/fractional) must be GREEN. Coverage of the two new functions MUST be 100%.
# S1's change-classifier.test.ts MUST still pass UNCHANGED (S2 is ADD-only).
# If coverage < 100%, add a test for the uncovered branch (likely the exhaustion/protective-default
# branch of one function, or a config-guard edge case).
```

### Level 3: Integration Testing (System Validation)

```bash
# Not applicable — S2 adds leaf wrapper functions + a config trio + tests. There is no runtime
# integration to validate (no existing call site invokes the resilient functions yet; wiring is a
# later item). The "integration" is: npm run validate (lint + format + typecheck + test) all GREEN.

npm run validate
# Expected: GREEN. This is the gate.

# Manual verification (optional): confirm the config trio + resilient functions are exported.
grep -n "CLASSIFIER_RETRY_MAX\|DEFAULT_CLASSIFIER_RETRY_MAX\|getClassifierRetryMax" src/config/constants.ts
grep -n "classifyChangeWithRetry\|classifyArtifactWithRetry" src/core/change-classifier.ts
# Expected: all three constants + getter present; both resilient functions present.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Verify the protective-default contract: the resilient functions ALWAYS return a classification
# (never throw, never undefined). (Read-only check — confirms the PRD §4.3 clause.)
grep -n "return 'SUBSTANTIVE'\|return 'DIRTY'\|catch (error)" src/core/change-classifier.ts
# Expected: each resilient function has a catch that returns the protective literal.

# Verify isRetryable is OMITTED (defaults to isTransientError — the load-bearing choice).
grep -n "isRetryable" src/core/change-classifier.ts
# Expected: ZERO matches in the new functions (isRetryable must NOT appear — it defaults to
# isTransientError, matching git-commit.ts:488).

# Verify S1's functions are NOT modified (ADD-only).
grep -n "export async function classifyChange\b\|export async function classifyArtifact\b" src/core/change-classifier.ts
# Expected: S1's classifyChange + classifyArtifact are still exported with their ORIGINAL signatures
# (bare agent.prompt, no retry). S2's functions are the *WithRetry variants.

# Verify retry.ts + agent-factory.ts + prompts are NOT touched.
git diff --name-only
# Expected: EXACTLY src/config/constants.ts, src/core/change-classifier.ts,
# tests/unit/core/change-classifier-resilient.test.ts.
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run validate` GREEN (lint + format:check + typecheck + test:run).
- [ ] All new tests pass: `npm run test:run -- change-classifier-resilient`.
- [ ] 100% coverage of the two new functions: `npm run test:coverage -- change-classifier-resilient`.
- [ ] No linting errors: `npm run lint`.
- [ ] No type errors: `npm run typecheck`.
- [ ] No formatting issues: `npm run format:check`.
- [ ] `git diff --name-only` shows EXACTLY `src/config/constants.ts`,
      `src/core/change-classifier.ts`, and `tests/unit/core/change-classifier-resilient.test.ts`.

### Feature Validation

- [ ] `classifyChangeWithRetry(diffSummary)` returns `'COSMETIC'`/`'SUBSTANTIVE'` on success; on
      exhaustion returns `'SUBSTANTIVE'` (protective) and warns — never throws, never returns
      `'could not classify'` or `undefined`.
- [ ] `classifyArtifactWithRetry(content)` returns `'CLEAN'`/`'DIRTY'` on success; on exhaustion
      returns `'DIRTY'` (protective) and warns.
- [ ] Both wrap S1's inner classifiers in `retry()` with `maxAttempts: getClassifierRetryMax()`
      (default 4, configurable via `CLASSIFIER_RETRY_MAX`), `isRetryable` OMITTED (→
      `isTransientError`), `onRetry: createDefaultOnRetry(...)`.
- [ ] `CLASSIFIER_RETRY_MAX` env var overrides the default 4; non-numeric/zero/negative fall back to 4.
- [ ] Transient failures (S1's `AgentError`, connection errors, rate limits) are retried.
- [ ] A warn-log fires on every fall-to-protective-default (PRD §4.3 + contract LOGIC (d)).

### Code Quality Validation

- [ ] Mirrors `src/utils/git-commit.ts:486-525` (the retry()-wrap-LLM + catch-fallback precedent).
- [ ] Mirrors `src/config/constants.ts:420` (`getCommitRetryMax` config-trio pattern).
- [ ] Mirrors `tests/unit/agents/prp-executor.test.ts:42-61` (retry.js Strategy-A mock) +
      `tests/unit/workflows/delta-analysis-workflow.test.ts:24-31` (agent-factory mock).
- [ ] ADD-only to `src/core/change-classifier.ts` (S1's functions/schemas/types/accessor untouched;
      S1's `change-classifier.test.ts` still passes UNCHANGED).
- [ ] Reuses S1's module-level `logger()` accessor (no new logger instance).
- [ ] ESM `.js` imports throughout.
- [ ] Anti-patterns avoided (see below): no retry.ts edit, no retryAgentPrompt, no custom isRetryable,
      no S1 modification, no workflow wiring, no 'parse' reliance.

### Documentation & Deployment

- [ ] Mode-A JSDoc on `classifyChangeWithRetry`, `classifyArtifactWithRetry`, and the three
      `constants.ts` exports — citing PRD §4.3 + the protective-default contract.
- [ ] One new env var (`CLASSIFIER_RETRY_MAX`) documented via constants.ts JSDoc (Mode A — rides with
      the work). No `.env.example` / `docs/` / README edit required for this subtask (the P6 doc-sweep
      owns the canonical env-var reference).

---

## Anti-Patterns to Avoid

- ❌ **Don't use `retryAgentPrompt`.** It hardcodes `maxAttempts: 3` via `AGENT_RETRY_CONFIG`
  (retry.ts:640-648). S2 needs `maxAttempts: 4` (configurable per PRD §4.3), so it MUST use the
  lower-level `retry()` and pass `maxAttempts: getClassifierRetryMax()` explicitly.
- ❌ **Don't pass a custom `isRetryable`.** Omit it → defaults to `isTransientError` (the correct
  behavior). A custom predicate risks misclassifying S1's `AgentError(PIPELINE_AGENT_LLM_FAILED)` as
  permanent → no retry → wrong behavior. Mirror git-commit.ts:488 ("isRetryable is intentionally
  OMITTED"). S1's error messages avoid 'parse'/'parsing' precisely so `isTransientError` treats them
  transient.
- ❌ **Don't forget the try/catch around `retry()`.** `retry()` RETHROWS the last error on exhaustion
  (retry.ts:548-550). S2's catch is where the protective default is applied. Forgetting the catch means
  the function throws out instead of returning SUBSTANTIVE/DIRTY — violating PRD §4.3's "never silently
  fall through" clause.
- ❌ **Don't return the thrown error or the last attempted value from the catch.** The catch returns
  the protective DEFAULT literal (`'SUBSTANTIVE'` / `'DIRTY'`), NOT the error. The error goes only to
  `logger().warn({ error }, ...)`.
- ❌ **Don't modify S1's `classifyChange` / `classifyArtifact`.** S2 ADDS `*WithRetry` variants; it
  does not edit S1's functions. S1's functions remain the bare-throwing inner call. Editing them breaks
  S1's test (which asserts `agent.prompt` is called bare) and violates the S1/S2 scope split.
- ❌ **Don't modify `retry.ts`.** S2 consumes `retry()` / `createDefaultOnRetry` / `isTransientError`
  read-only. Modifying retry.ts affects every consumer (git-commit, bug-hunt, delta-analysis,
  prp-executor, prp-generator) and causes merge contention + regressions.
- ❌ **Don't add a new logger instance.** Reuse S1's module-level `logger()` accessor in
  change-classifier.ts. Declaring a second accessor (`_logger2` / `getLogger('ChangeClassifierResilient')`)
  fragments logging and is unnecessary.
- ❌ **Don't wire `classifyChangeWithRetry` / `classifyArtifactWithRetry` into `handleDelta()` or any
  workflow.** The caller is a LATER work item (after S2). Wiring now would be dead code and out of scope.
- ❌ **Don't add delay config env vars (`CLASSIFIER_RETRY_DELAY`, etc.).** The item contract only
  requires `maxAttempts=4 (configurable)`. The `baseDelay`/`maxDelay`/`backoffFactor` use sane inline
  defaults (1000/30000/2, matching git-commit.ts). Adding delay env vars is scope creep and env-var
  proliferation.
- ❌ **Don't special-case empty `content` in `classifyArtifactWithRetry`.** S1's `classifyArtifact`
  throws on empty content (transient `AgentError`) → S2 retries 4× → exhaustion → protective `'DIRTY'`.
  This is acceptable per PRD §4.3 (empty artifact = degenerate protective case). A short-circuit is an
  OPTIONAL optimization, not required, and adds a branch to test for 100% coverage.
- ❌ **Don't touch S1's `change-classifier.test.ts`.** S2's tests live in a separate file
  (`change-classifier-resilient.test.ts`). S1's test must pass UNCHANGED.
- ❌ **Don't rely on `'parse'`/`'parsing'` in any error message.** `isTransientError` treats messages
  containing those words as PERMANENT (never retried). S1 already avoids them; S2's warn-log message
  ("exhausted retries; failing to protective default") also avoids them (it is not retried anyway, but
  consistency is safer).