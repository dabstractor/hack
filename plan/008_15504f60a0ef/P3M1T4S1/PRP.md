# PRP — P3.M1.T4.S1: Bounded retry with exponential backoff for stagecoach generation

---

## Goal

**Feature Goal**: Wrap the stagecoach commit-message generation boundary
(`generateCommitMessage` in `src/utils/git-commit.ts`, authored by P3.M1.T3.S1)
in a **bounded retry loop with exponential backoff**, using the existing
`retry()` utility from `src/utils/retry.ts`. This makes Smart Commit's LLM
commit-message generation resilient to transient LLM-API failures (timeouts,
rate limits, 5xx) — exactly the behavior PRD §5.1 *"Smart Commit Resilience"*
mandates: *"commit-generation is retried up to `COMMIT_RETRY_MAX` (default 5)
attempts with exponential backoff (`COMMIT_RETRY_DELAY`, default 10s, doubling,
capped at 120s)."* This task ships the **retry wiring**; the **last-resort
fallback placeholder commit** (P3.M1.T4.S2) consumes this and handles the
"still failing after all retries" case.

**Deliverable** (4 files: 1 modified config, 1 modified utility, 2 modified
tests + 1 new test + 2 modified docs):
1. **`src/config/constants.ts`** — MODIFY: add **6** new exports (3 name strings +
   3 defaults + 3 reader functions = 9, but the defaults + names + getters are
   grouped) following the canonical `ISSUE_RETRY_MAX` 4-part pattern
   (env-var-name string → default → reader function, each with JSDoc citing
   PRD §5.1):
   - `COMMIT_RETRY_MAX` (name), `DEFAULT_COMMIT_RETRY_MAX = 5`,
     `getCommitRetryMax()`.
   - `COMMIT_RETRY_DELAY` (name), `DEFAULT_COMMIT_RETRY_DELAY_MS = 10_000`,
     `getCommitRetryDelayMs()`.
   - `COMMIT_RETRY_DELAY_CAP` (name), `DEFAULT_COMMIT_RETRY_DELAY_CAP_MS = 120_000`,
     `getCommitRetryDelayCapMs()`.
2. **`src/utils/git-commit.ts`** — MODIFY: in `smartCommit`'s stagecoach branch
   (`options?.generateMessage === true`), wrap the `generateCommitMessage(diff)`
   call in `retry(() => generateCommitMessage(diff), {...})` using the new
   constants + `createDefaultOnRetry('stagecoach.generateCommitMessage')`. The
   `gitDiff` call stays **outside** the retry loop (only the LLM boundary is
   retried — the git index is left untouched between retries, per PRD §5.1). The
   default path (`generateMessage !== true`) is **byte-for-byte unchanged**.
3. **`tests/unit/config/constants.test.ts`** or a NEW
   **`tests/unit/config/commit-retry.test.ts`** — CREATE/EXTEND: unit tests for
   all three reader functions, mirroring `tests/unit/config/issue-retry-max.test.ts`
   (unset→default, valid→honor, NaN→default, 0/negative→default, valid→honor).
4. **`tests/unit/utils/git-commit.test.ts`** — MODIFY: update the stagecoach-path
   tests to account for the retry wrapper. The existing "throws → null" test now
   sees the boundary invoked `COMMIT_RETRY_MAX` times before throwing (the
   `vi.fn` mock throws on every call → retry exhausts attempts). Update the
   call-count assertion OR lower `COMMIT_RETRY_MAX` for the test via `vi.stubEnv`.
   Add a new test asserting **retry actually happens** (mock throws twice then
   succeeds → assert `generateCommitMessage`/the agent was called 3× and the
   commit succeeds).
5. **`.env.example`** — MODIFY: add the 3 new commented env vars near the
   `RESEARCH_TIMEOUT` block.
6. **`docs/CONFIGURATION.md`** — MODIFY: add 3 rows to the env-var table near
   `RESEARCH_TIMEOUT` / `ISSUE_RETRY_MAX`, citing PRD §5.1.

**Scope note (critical):** This task is **ONLY the retry wiring + the 3 config
constants + Mode-A docs**. It does NOT add the last-resort fallback placeholder
commit (P3.M1.T4.S2), the watchdog exit-124 → `timedOut` detection
(P3.M2.T2.S1), the wiring of terminal-fail into `retry.ts` so exit 124 is never
retried (P3.M2.T2.S2), or critical-file deletion protection (P3.M2.T4.S2). It
**CONSUMES** the `generateCommitMessage` boundary from P3.M1.T3.S1 (treat S1's
PRP as a contract — it explicitly designed that boundary to throw a transient
`AgentError` so this task can wrap it). The single existing production caller of
`smartCommit` (`task-orchestrator.ts`) is **unchanged**.

**Success Definition**:
- `smartCommit(path, msg)` (no options) behaves EXACTLY as today: no retry, no
  new constants referenced. Existing default-path unit + integration tests pass
  **unchanged**.
- `smartCommit(path, fallback, { generateMessage: true })` now retries the inner
  `generateCommitMessage(diff)` call up to `COMMIT_RETRY_MAX` (default 5)
  attempts with exponential backoff (`COMMIT_RETRY_DELAY` base 10s, doubling,
  capped at `COMMIT_RETRY_DELAY_CAP` 120s) before the throw propagates to
  `smartCommit`'s outer try/catch (→ `null` return). P3.M1.T4.S2 will add the
  fallback commit on top of the `null` return.
- The retry uses `isTransientError` (the default `RetryOptions.isRetryable`) to
  decide retryability. `generateCommitMessage` throws `AgentError` (hardcoded
  `code = PIPELINE_AGENT_LLM_FAILED`) on every failure mode, which
  `isTransientError` classifies transient (PRD §5.1: "transient-API-sensitive").
- `COMMIT_RETRY_MAX`, `COMMIT_RETRY_DELAY`, `COMMIT_RETRY_DELAY_CAP` env vars
  are read+validated at runtime via `getCommitRetryMax()`,
  `getCommitRetryDelayMs()`, `getCommitRetryDelayCapMs()`; invalid values
  (NaN, non-positive) fall back to defaults.
- `npm run validate` GREEN; `package.json` `dependencies` unchanged (reuses
  existing `retry` + `createDefaultOnRetry` from `src/utils/retry.ts`).

---

## User Persona (if applicable)

**Target User**: The autonomous pipeline (no human in the loop). Immediate
consumer: P3.M1.T3.S2 (the two-phase commit wiring — pre-cleanup survival commit
+ post-cleanup commit), which calls `smartCommit(..., { generateMessage: true })`
twice per subtask. Long-term consumer: P3.M1.T3.S3's cleanup agent commits and
all future stagecoach calls. P3.M1.T4.S2 (last-resort fallback) consumes the
"all retries exhausted" outcome this task produces.
**Use Case**: LLM commit-message generation is a one-shot, transient-API-
sensitive call. In production, Anthropic/OpenAI APIs occasionally rate-limit
(429) or time out (504). Without retry, a single 429 strands a subtask's
staged work (the substance is committed only by P3.M1.T4.S2's fallback, which
doesn't exist yet — today a stagecoach failure just returns `null` and the
substance stays uncommitted or uses the templated fallback). With bounded retry,
transient blips recover silently.
**User Journey**: orchestrator → `smartCommit(path, fb, { generateMessage: true })`
→ `gitAdd` → `gitDiff({staged:true})` → **`retry(() => generateCommitMessage(diff),
{maxAttempts:5, baseDelay:10000, maxDelay:120000, ...})`** → on transient error:
sleep (10s, 20s, 40s, 80s — capped 120s) + retry; on permanent error: rethrow
immediately; on success: `formatCommitMessage(msg)` → `gitCommit` → hash.
**Pain Points Addressed**: PRD §5.1 — "a generation timeout here is LLM-API
slowness, not a stuck subprocess … so it should be retried." Today's stagecoach
(§5.1) is one-shot: one 429/504 and the commit message is lost.

---

## Why

- **PRD compliance**: PRD §5.1 (h3.9) *"Smart Commit Resilience (commit-gen
  retry + fallback)"* mandates: *"Bounded retry with backoff: commit-generation
  is retried up to `COMMIT_RETRY_MAX` (default 5) attempts with exponential
  backoff (`COMMIT_RETRY_DELAY`, default 10s, doubling, capped at 120s)."*
  `architecture/phase_findings.md` §PHASE 3 documents that stagecoach generation
  is "one-shot and transient-API-sensitive. A generation timeout is LLM-API
  slowness, not a stuck subprocess — the index is left untouched + lock released
  on rescue."
- **Contract item 3 (LOGIC) full coverage**:
  - (a) *"Add `COMMIT_RETRY_MAX` (default 5) and `COMMIT_RETRY_DELAY` (default
    10s, doubling, capped 120s) to constants.ts."* → 3 name constants + 3
    defaults + 3 readers (the cap is a separate value from the base delay, hence
    `COMMIT_RETRY_DELAY_CAP`).
  - (b) *"Wrap the stagecoach LLM commit-message generation call in a bounded
    retry loop using the existing `retry()` utility from `src/utils/retry.ts`."*
    → wrap `generateCommitMessage(diff)` in `retry(...)` inside `smartCommit`'s
    stagecoach branch.
  - (c) *"The retry should use `isTransientError()` to distinguish API failures
    (retryable) from permanent errors (not retryable)."* → rely on `retry()`'s
    DEFAULT `RetryOptions.isRetryable = isTransientError`. `generateCommitMessage`
    throws `AgentError` (transient by `isTransientError`), so the default works.
  - (d) *"On each retry, the index is left untouched and any lock is released
    (the rescue exit behavior from PRD §5.1)."* → achieved structurally: the
    retry wraps ONLY `generateCommitMessage` (the LLM call), NOT `gitAdd` /
    `gitDiff` / `gitCommit`. The git index is staged once (before the retry loop)
    and committed once (after). No lock is held during the LLM call. Retrying
    repeats only the network call to the LLM API.
- **Distinction from watchdog timeouts (Req 3.6 — explicitly out of scope here)**:
  PRD §5.1 says a watchdog timeout (exit 124) on a research/implementation/
  validation call MUST NOT be retried. That is P3.M2.T2.S2's job (it wires a
  `timedOut` flag into `retry.ts`). This task does NOT change `isTransientError`
  or add exit-124 detection. We rely on the existing invariant: an exit-124 /
  watchdog error is NOT an `AgentError` (it'll be a separate error type added by
  P3.M2.T2.S1), and `isTransientError` returns false for unknown error types
  unless they match a transient pattern. No conflict.

---

## What

One modified config module (`constants.ts`), one modified utility
(`git-commit.ts`), one new/extended config test, one modified utility test, two
modified docs.

### Success Criteria

- [ ] **3 env-var name constants exist** in `src/config/constants.ts`:
      `COMMIT_RETRY_MAX = 'COMMIT_RETRY_MAX'`, `COMMIT_RETRY_DELAY = 'COMMIT_RETRY_DELAY'`,
      `COMMIT_RETRY_DELAY_CAP = 'COMMIT_RETRY_DELAY_CAP'`. Verified by import +
      strict-equality test.
- [ ] **3 default constants exist**: `DEFAULT_COMMIT_RETRY_MAX = 5`,
      `DEFAULT_COMMIT_RETRY_DELAY_MS = 10_000`, `DEFAULT_COMMIT_RETRY_DELAY_CAP_MS = 120_000`.
- [ ] **3 reader functions exist** and validate like `getIssueRetryMax()`:
      `getCommitRetryMax()`, `getCommitRetryDelayMs()`, `getCommitRetryDelayCapMs()`.
      Each returns the default when the env var is unset, NaN, or non-positive.
      Verified by a mirror of `tests/unit/config/issue-retry-max.test.ts`.
- [ ] **JSDoc cites PRD §5.1** on each new constant/reader (match `ISSUE_RETRY_MAX`'s
      JSDoc style, which cites the PRD section).
- [ ] **`smartCommit` stagecoach branch wraps `generateCommitMessage` in `retry()`**:
      the call site in `smartCommit`'s `if (options?.generateMessage)` block reads
      `const generated = await retry(() => generateCommitMessage(diffResult.diff ?? ''), { maxAttempts: getCommitRetryMax(), baseDelay: getCommitRetryDelayMs(), maxDelay: getCommitRetryDelayCapMs(), backoffFactor: 2, onRetry: createDefaultOnRetry('stagecoach.generateCommitMessage') });`.
      The `isRetryable` option is OMITTED (defaults to `isTransientError`). Verified
      by reading the call site + a test asserting retry happens on a transient throw.
- [ ] **`gitDiff` stays OUTSIDE the retry loop**: the diff is read once, then
      passed into the retry-wrapped `generateCommitMessage`. The git index is
      staged once and committed once — no re-staging between retries. Verified by
      a test asserting `gitDiff` (mocked) is called exactly once even when
      generation retries 3×.
- [ ] **Default path is byte-identical**: `smartCommit(path, msg)` (no options)
      does NOT call `retry`, does NOT read the new constants, produces identical
      behavior. Existing default-path tests pass unchanged. Verified by `git diff`
      showing the default-path branch untouched + existing tests green.
- [ ] **Retry actually retries on transient errors**: a test where the agent mock
      throws a transient `AgentError` on the first 2 calls then succeeds on the
      3rd → `smartCommit` returns a commit hash (not null), and the agent/boundary
      is invoked 3 times. Verified by asserting the mock call count === 3.
- [ ] **Permanent errors are NOT retried**: a test where the boundary throws a
      non-transient error (e.g. a plain `Error('validation failed')` — matches
      `PERMANENT_PATTERNS` in `retry.ts`) → the boundary is invoked ONCE and the
      error propagates (→ `smartCommit` returns null). NOTE: `generateCommitMessage`
      only throws `AgentError` (always transient), so this test must mock the
      boundary itself to throw a permanent error to exercise the `isRetryable`
      path. (Document this in the test comment.)
- [ ] **`.env.example` documents the 3 new vars** (commented, with defaults +
      PRD §5.1 reference), placed near the `RESEARCH_TIMEOUT` block.
- [ ] **`docs/CONFIGURATION.md` adds 3 rows** to the env-var table (near
      `RESEARCH_TIMEOUT` / `ISSUE_RETRY_MAX`), each citing PRD §5.1.
- [ ] **No orchestrator edit**: `src/core/task-orchestrator.ts` is UNCHANGED.
      Verified by `git diff --stat src/core/task-orchestrator.ts`.
- [ ] **`isTransientError` and `retry.ts` are NOT modified**: this task uses them
      as-is. The watchdog/exit-124 handling is P3.M2.T2.S2. Verified by
      `git diff --stat src/utils/retry.ts` showing no modifications.
- [ ] `npm run validate` GREEN; `package.json` `dependencies` byte-identical.

---

## All Needed Context

### Context Completeness Check

✅ "If someone knew nothing about this codebase, would they have everything
needed to implement this successfully?" — YES. This PRP names the exact boundary
to wrap (`generateCommitMessage` in `git-commit.ts`, which S1's JSDoc explicitly
flags as the P3.M1.T4.S1 retry target), the exact utility to use (`retry()` +
`createDefaultOnRetry` from `retry.ts`, with their exact option names and
semantics), the exact constants pattern to mirror (`ISSUE_RETRY_MAX` — 4-part
name/default/reader/JSDoc), the exact test pattern to mirror
(`issue-retry-max.test.ts`), the exact docs files to touch (`.env.example` +
`docs/CONFIGURATION.md`), and the exact reasons the alternatives (using
`retryAgentPrompt`, wrapping all of `smartCommit`) are wrong.

### Documentation & References

```yaml
# MUST READ - Include these in your context window
- file: src/utils/retry.ts
  why: THE UTILITY YOU ARE USING. (1) `retry<T>(fn, options)` — generic
       exponential-backoff-with-jitter. Read the RetryOptions interface (lines
       ~180-265): maxAttempts (total attempts, NOT retry count), baseDelay (ms),
       maxDelay (cap ms), backoffFactor (default 2 = doubling), jitterFactor
       (default 0.1), isRetryable (DEFAULTS to isTransientError — OMIT to use it),
       onRetry (use createDefaultOnRetry). (2) `createDefaultOnRetry(operationName,
       maxAttempts)` — structured-logging onRetry callback; pass the operation name.
       (3) `isTransientError` — AgentError (PIPELINE_AGENT_LLM_FAILED) is transient.
  pattern: read the JSDoc on `retry()` (lines ~430-540) + the RetryOptions
           interface. The AGENT_RETRY_CONFIG / retryAgentPrompt wrapper has a
           HARDCODED config (3 attempts, 1s, 30s cap) that IGNORES our constants —
           DO NOT USE retryAgentPrompt; use the generic retry() directly.
  gotcha: maxAttempts is TOTAL attempts (initial + retries), not retry count.
          PRD §5.1 "retried up to COMMIT_RETRY_MAX (default 5) attempts" = 5 total.
          So getCommitRetryMax() returns 5 → retry() calls the boundary 5 times max.
  gotcha: isRetryable DEFAULTS to isTransientError. OMIT the isRetryable option
          to get the contract-required behavior ("use isTransientError() to
          distinguish API failures from permanent errors"). Do NOT pass a custom
          isRetryable — that would risk diverging from isTransientError.

- file: src/utils/git-commit.ts   # lines ~140-200 (generateCommitMessage) + ~280-310 (smartCommit stagecoach branch)
  why: THE FILE YOU MODIFY. (1) generateCommitMessage(diff) is the throw-on-
       failure transient boundary S1 designed for THIS task to wrap. Read its
       JSDoc (~line 150) — it literally says "P3.M1.T4.S1 wraps with
       retryAgentPrompt." (S1 wrote retryAgentPrompt as a placeholder name; this
       task uses the generic retry() with COMMIT_RETRY_* constants instead — that
       is the correct, more-specific choice.) (2) smartCommit's stagecoach branch
       (~line 285-300) is where the wrap goes: replace
         `const generated = await generateCommitMessage(diffResult.diff ?? '');`
       with
         `const generated = await retry(() => generateCommitMessage(diffResult.diff ?? ''), {...});`
       (3) smartCommit's outer try/catch stays — on exhausted-retry throw it
       returns null (P3.M1.T4.S2 adds the fallback commit there).
  pattern: the stagecoach branch already reads `const diffResult = await
           gitDiff({path: repoRoot, staged: true})` BEFORE generateCommitMessage.
           Keep gitDiff OUTSIDE the retry closure (the diff is read once; only the
           LLM call repeats). The retry closure captures `diffResult.diff`.
  gotcha: the retry wraps ONLY generateCommitMessage, NOT the whole smartCommit.
          S1's JSDoc is explicit: "The retry layer (P3.M1.T4.S1) wraps the INNER
          generateCommitMessage boundary, NOT smartCommit." Wrapping all of
          smartCommit would re-stage + re-commit on retry (double commits, index
          churn) — forbidden by PRD §5.1 "the index is left untouched."
  gotcha: import retry + createDefaultOnRetry from './retry.js' (add to the
          existing import block at the top of git-commit.ts).

- file: src/config/constants.ts   # ISSUE_RETRY_MAX block ~lines 380-425
  why: THE PATTERN TO MIRROR for the 3 new constants. ISSUE_RETRY_MAX is the
       canonical 4-part pattern: (1) `export const X = 'X'` env-var NAME string;
       (2) `export const DEFAULT_X = <val>`; (3) `export function getX()` read+
       validate-from-env-with-default-fallback; (4) JSDoc citing the PRD section.
       Read this block in full and replicate it THREE times (COMMIT_RETRY_MAX as
       an int, COMMIT_RETRY_DELAY as an int-ms, COMMIT_RETRY_DELAY_CAP as int-ms).
  pattern: getX() reads `Number(process.env[X] ?? DEFAULT_X)`, returns DEFAULT on
           NaN or <=0. Mirror exactly (with the appropriate default + type).
  gotcha: COMMIT_RETRY_DELAY and COMMIT_RETRY_DELAY_CAP are MILLISECONDS (to feed
          retry()'s baseDelay/maxDelay which are ms). The PRD says "default 10s"
          and "capped 120s" — convert to 10_000 and 120_000. Name them with the
          _MS suffix on the default constant (DEFAULT_COMMIT_RETRY_DELAY_MS) to
          make the unit explicit, matching DEFAULT_TASKS_LOCK_TIMEOUT_MS.

- file: tests/unit/config/issue-retry-max.test.ts
  why: THE TEST PATTERN TO MIRROR for the new config readers. 6 cases per reader:
       unset→default, valid int→honor, NaN→default, zero→default, negative→default,
       valid→honor. Uses beforeEach to delete the env var + afterEach
       vi.unstubAllEnvs + vi.stubEnv to set. Mirror exactly for
       getCommitRetryMax() and getCommitRetryDelayMs() and getCommitRetryDelayCapMs().
  pattern: read the full file. Place the new tests in a NEW file
           tests/unit/config/commit-retry.test.ts (preferred — keeps each
           constant group self-contained, matching the one-file-per-constant-group
           convention: issue-retry-max.test.ts, research-timeout.test.ts) OR
           extend tests/unit/config/constants.test.ts if that is the established
           convention. Check: ls tests/unit/config/ shows issue-retry-max.test.ts
           AND research-timeout.test.ts exist as SEPARATE files → follow that
           convention: CREATE tests/unit/config/commit-retry.test.ts.

- file: tests/unit/utils/git-commit.test.ts   # stagecoach section ~lines 669-950
  why: THE TEST FILE YOU MODIFY. Two regions: (1) generateCommitMessage boundary
       tests (~669-836) — these test the UNWRAPPED boundary directly; they are
       UNCHANGED (the boundary itself is not modified, only its call site inside
       smartCommit). (2) smartCommit generateMessage option tests (~839-950) —
       these test the call site; UPDATE them for the retry wrapper. Specifically
       the test "generateCommitMessage throws → returns null" (~line 911) now sees
       the boundary invoked COMMIT_RETRY_MAX times (the vi.fn mock throws every
       call → retry exhausts 5 attempts then propagates). Update the call-count
       assertion, OR vi.stubEnv COMMIT_RETRY_MAX='2' in the test to keep it fast.
       ADD a new test: "retry succeeds on 3rd attempt → commit created".
  pattern: the existing mock is `mockCreateCommitMessageAgent` (a vi.fn). With
           retry, the agent's prompt() is called once per retry. To assert
           "retried 3 times then succeeded", use mockResolvedValueOnce to throw
           twice then resolve: `mockPrompt.mockRejectedValueOnce(new
           AgentError('x')).mockRejectedValueOnce(new AgentError('y'))
           .mockResolvedValueOnce({status:'success', data:'feat: x'})`. Check the
           existing makeFakeAgent helper (~line 50) for the exact mock shape.
  gotcha: the existing "throws → null" test uses a single mockReturnValue that
          throws on EVERY call. After the retry wrap, the boundary (and thus the
          agent) is called COMMIT_RETRY_MAX times. To keep the test fast + correct,
          vi.stubEnv('COMMIT_RETRY_MAX', '1') in the failure tests so retry does
          NOT loop (1 attempt = no retries). This also makes the "permanent error
          not retried" test meaningful (1 attempt = boundary called once).
  gotcha: the makeFakeAgent helper returns an agent whose .prompt() is a vi.fn.
          If the existing mock throws synchronously vs rejects, check — retry's
          fn is async, so the throw must be an async rejection. generateCommitMessage
          awaits agent.prompt(prompt), so a throw inside prompt() propagates as a
          rejected promise → retry catches it. Use mockRejectedValue / mockRejectedValueOnce.

- file: .env.example   # RESEARCH_TIMEOUT block ~line 109
  why: ADD the 3 new commented env vars. Pattern (mirror the RESEARCH_TIMEOUT line):
       `# COMMIT_RETRY_MAX=5`, `# COMMIT_RETRY_DELAY=10000`,
       `# COMMIT_RETRY_DELAY_CAP=120000` with a comment citing PRD §5.1. Place
       right after the RESEARCH_TIMEOUT line (~line 109), grouped with the other
       retry/resilience knobs.
  gotcha: values are commented (the `#` prefix), matching RESEARCH_TIMEOUT's
          convention. Use the DEFAULT values as the commented example.

- file: docs/CONFIGURATION.md   # env-var table ~lines 151-154
  why: ADD 3 rows to the canonical env-var table, near RESEARCH_TIMEOUT /
       ISSUE_RETRY_MAX. Columns (match existing rows): var name | required? |
       default | description + PRD section. Cite PRD §5.1 for all three.
  pattern: read the table header + the ISSUE_RETRY_MAX row. Add 3 rows in the
           same Markdown table format, grouped together (they're related).

- file: plan/008_15504f60a0ef/P3M1T3S1/PRP.md
  why: THE CONTRACT for the boundary. Confirms generateCommitMessage throws
       AgentError (transient) on every failure mode (empty diff, agent error
       status, empty/whitespace output), so retry's default isRetryable =
       isTransientError classifies every throw as retryable. Confirms smartCommit's
       outer try/catch converts the exhausted-retry throw into a null return (so
       the never-fail-on-commit contract holds — P3.M1.T4.S2 layers the fallback
       commit on top of that null return).
  pattern: treat generateCommitMessage's signature + throw contract as FROZEN. Do
           NOT modify generateCommitMessage itself — only its call site inside
           smartCommit.
```

### Current Codebase tree (relevant slice)

```bash
src/
  config/
    constants.ts             # MODIFY — add 3 env-var names + 3 defaults + 3 readers (mirror ISSUE_RETRY_MAX)
  utils/
    git-commit.ts            # MODIFY — wrap generateCommitMessage call in retry() inside smartCommit stagecoach branch
    retry.ts                 # READ-ONLY — retry() + createDefaultOnRetry + isTransientError (consumed, NOT modified)
    errors.ts                # READ — AgentError (hardcodes PIPELINE_AGENT_LLM_FAILED → transient)
tests/
  unit/
    config/
      commit-retry.test.ts        # CREATE — getCommitRetryMax/DelayMs/DelayCapMs readers (mirror issue-retry-max.test.ts)
      issue-retry-max.test.ts     # READ — the test pattern to mirror
    utils/
      git-commit.test.ts          # MODIFY — update stagecoach-path tests for retry wrapper; add retry-succeeds test
.env.example                      # MODIFY — add 3 commented env vars near RESEARCH_TIMEOUT
docs/
  CONFIGURATION.md                # MODIFY — add 3 rows to env-var table, cite PRD §5.1
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
src/config/constants.ts
  # MODIFIED: + COMMIT_RETRY_MAX (name) + DEFAULT_COMMIT_RETRY_MAX (5) +
  #   getCommitRetryMax() (int, validates NaN/<=0 → default)
  # + COMMIT_RETRY_DELAY (name) + DEFAULT_COMMIT_RETRY_DELAY_MS (10_000) +
  #   getCommitRetryDelayMs() (int ms)
  # + COMMIT_RETRY_DELAY_CAP (name) + DEFAULT_COMMIT_RETRY_DELAY_CAP_MS (120_000) +
  #   getCommitRetryDelayCapMs() (int ms)
src/utils/git-commit.ts
  # MODIFIED: import { retry, createDefaultOnRetry } from './retry.js';
  #   in smartCommit stagecoach branch, replace
  #     `const generated = await generateCommitMessage(diffResult.diff ?? '');`
  #   with
  #     `const generated = await retry(() => generateCommitMessage(diffResult.diff ?? ''), { maxAttempts: getCommitRetryMax(), baseDelay: getCommitRetryDelayMs(), maxDelay: getCommitRetryDelayCapMs(), backoffFactor: 2, onRetry: createDefaultOnRetry('stagecoach.generateCommitMessage') });`
  #   Default path + generateCommitMessage boundary + outer try/catch UNCHANGED.
tests/unit/config/commit-retry.test.ts
  # NEW: 3 describe blocks (one per reader), 6 cases each, mirroring issue-retry-max.test.ts.
tests/unit/utils/git-commit.test.ts
  # MODIFIED: vi.stubEnv('COMMIT_RETRY_MAX','1') in failure tests (so retry
  #   doesn't loop); add a "retry succeeds on 3rd attempt" test; add a
  #   "permanent error not retried (boundary called once)" test (mock boundary
  #   to throw a non-transient Error); assert gitDiff called once across retries.
.env.example
  # MODIFIED: + 3 commented env vars (COMMIT_RETRY_MAX=5, COMMIT_RETRY_DELAY=10000,
  #   COMMIT_RETRY_DELAY_CAP=120000) near RESEARCH_TIMEOUT, citing PRD §5.1.
docs/CONFIGURATION.md
  # MODIFIED: + 3 rows in env-var table near RESEARCH_TIMEOUT/ISSUE_RETRY_MAX.
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL: wrap ONLY generateCommitMessage, NOT smartCommit. S1's JSDoc is
// explicit: "The retry layer (P3.M1.T4.S1) wraps the INNER generateCommitMessage
// boundary, NOT smartCommit." Wrapping all of smartCommit would re-stage + re-
// commit on retry → double commits + index churn → violates PRD §5.1 "the index
// is left untouched." The retry closure captures the already-read diff.

// CRITICAL: OMIT the RetryOptions.isRetryable option. It DEFAULTS to
// isTransientError, which is exactly what contract item 3(c) requires ("use
// isTransientError() to distinguish API failures from permanent errors").
// Passing a custom isRetryable risks diverging. generateCommitMessage throws
// AgentError (PIPELINE_AGENT_LLM_FAILED) which isTransientError classifies
// transient (UNLESS the message contains 'parse' — our messages are
// 'stagecoach commit-message generation failed: ...', no 'parse', so always transient).

// CRITICAL: use the generic retry(), NOT retryAgentPrompt(). retryAgentPrompt
// has a HARDCODED config (maxAttempts:3, baseDelay:1000ms, maxDelay:30000ms) that
// IGNORES our COMMIT_RETRY_* constants. The generic retry() accepts an options
// object — use it with our reader functions.

// CRITICAL: maxAttempts is TOTAL attempts (initial + retries), not retry count.
// PRD §5.1 "retried up to COMMIT_RETRY_MAX (default 5) attempts" → 5 total calls
// to the boundary. So getCommitRetryMax() returns 5 and retry() calls the
// boundary at most 5 times. Do NOT subtract 1.

// GOTCHA: keep gitDiff OUTSIDE the retry closure. The diff is read once (after
// gitAdd, so it reflects the filtered staged set). Only generateCommitMessage
// (the LLM call) repeats. This structurally guarantees "the index is left
// untouched + lock released on rescue" (PRD §5.1) — no git operation is retried.

// GOTCHA: COMMIT_RETRY_DELAY and COMMIT_RETRY_DELAY_CAP are MILLISECONDS (to feed
// retry()'s baseDelay/maxDelay which are ms). PRD says "10s" / "capped 120s" →
// 10_000 / 120_000. Name the default constants with _MS suffix
// (DEFAULT_COMMIT_RETRY_DELAY_MS) to make the unit explicit, matching
// DEFAULT_TASKS_LOCK_TIMEOUT_MS.

// GOTCHA: the existing failure test "generateCommitMessage throws → smartCommit
// returns null" will, after the wrap, invoke the boundary COMMIT_RETRY_MAX times
// before throwing. To keep the test fast + its assertions exact, vi.stubEnv(
// 'COMMIT_RETRY_MAX', '1') in the failure-path tests so retry does NOT loop
// (1 attempt = boundary called once). This makes the "permanent error not
// retried" assertion meaningful (called exactly once).

// GOTCHA: the makeFakeAgent mock helper returns an agent whose .prompt() is a
// vi.fn. With retry, .prompt() is called once per attempt. To assert "retried
// 3× then succeeded", use mockRejectedValueOnce(...).mockRejectedValueOnce(...)
// .mockResolvedValueOnce({status:'success', data:'...'}) on the prompt mock and
// assert the mock was called 3×. (Check the exact mock helper shape at ~line 50
// of git-commit.test.ts first.)

// GOTCHA: do NOT modify src/utils/retry.ts or isTransientError. The watchdog/
// exit-124 "never retry" wiring is P3.M2.T2.S2's job. This task relies on the
// EXISTING isTransientError classification (AgentError = transient). If a future
// exit-124 error is added, it will be a non-AgentError type that isTransientError
// returns false for — no conflict with this task.

// GOTCHA: smartCommit's outer try/catch already converts the exhausted-retry
// throw into a null return. This preserves the never-fail-on-commit contract.
// P3.M1.T4.S2 will ADD the fallback placeholder commit on top of that null
// return — this task does NOT add the fallback. Do not pre-empt S2.
```

---

## Implementation Blueprint

### Data models and structure

No new types. The only new "data" is 9 config constants (3 groups of
name-string + default + reader). The retry wiring uses the existing `RetryOptions`
type from `retry.ts`.

```typescript
// src/config/constants.ts — NEW constants (mirror ISSUE_RETRY_MAX exactly):
export const COMMIT_RETRY_MAX = 'COMMIT_RETRY_MAX';
export const DEFAULT_COMMIT_RETRY_MAX = 5;
export function getCommitRetryMax(): number { /* Number(env ?? default); NaN/<=0 → default */ }

export const COMMIT_RETRY_DELAY = 'COMMIT_RETRY_DELAY';
export const DEFAULT_COMMIT_RETRY_DELAY_MS = 10_000;
export function getCommitRetryDelayMs(): number { /* same shape */ }

export const COMMIT_RETRY_DELAY_CAP = 'COMMIT_RETRY_DELAY_CAP';
export const DEFAULT_COMMIT_RETRY_DELAY_CAP_MS = 120_000;
export function getCommitRetryDelayCapMs(): number { /* same shape */ }

// src/utils/git-commit.ts — the wrap (inside smartCommit's stagecoach branch):
//   const generated = await retry(
//     () => generateCommitMessage(diffResult.diff ?? ''),
//     {
//       maxAttempts: getCommitRetryMax(),
//       baseDelay: getCommitRetryDelayMs(),
//       maxDelay: getCommitRetryDelayCapMs(),
//       backoffFactor: 2,                  // doubling (PRD §5.1)
//       onRetry: createDefaultOnRetry('stagecoach.generateCommitMessage', getCommitRetryMax()),
//       // isRetryable: OMITTED — defaults to isTransientError (contract item 3c)
//     }
//   );
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: ADD 3 config constant groups to src/config/constants.ts
  - LOCATE the ISSUE_RETRY_MAX block (~lines 380-425). Read it fully — it is the
    canonical 4-part pattern (name string → default → reader → JSDoc).
  - ADD a new block AFTER ISSUE_RETRY_MAX (or grouped with the other pipeline-
    resilience knobs). Three groups:
    GROUP A (COMMIT_RETRY_MAX — int, attempts):
      /**
       * Environment variable name: max commit-message-generation attempts before
       *   falling back (PRD §5.1 "Smart Commit Resilience").
       * ... (mirror ISSUE_RETRY_MAX's JSDoc structure, cite PRD §5.1)
       */
      export const COMMIT_RETRY_MAX = 'COMMIT_RETRY_MAX';
      /** Default max stagecoach generation attempts (PRD §5.1). */
      export const DEFAULT_COMMIT_RETRY_MAX = 5;
      /**
       * Read & validate the COMMIT_RETRY_MAX env var (PRD §5.1, §9.2.2).
       * @returns The configured max attempts, or DEFAULT_COMMIT_RETRY_MAX when
       *          unset, non-numeric, or non-positive.
       */
      export function getCommitRetryMax(): number {
        const raw = Number(process.env[COMMIT_RETRY_MAX] ?? DEFAULT_COMMIT_RETRY_MAX);
        if (Number.isNaN(raw) || raw <= 0) { return DEFAULT_COMMIT_RETRY_MAX; }
        return Math.floor(raw);   // integer attempts
      }
    GROUP B (COMMIT_RETRY_DELAY — int ms, base delay):
      export const COMMIT_RETRY_DELAY = 'COMMIT_RETRY_DELAY';
      /** Default base retry delay in ms for stagecoach generation (PRD §5.1: 10s). */
      export const DEFAULT_COMMIT_RETRY_DELAY_MS = 10_000;
      export function getCommitRetryDelayMs(): number {
        const raw = Number(process.env[COMMIT_RETRY_DELAY] ?? DEFAULT_COMMIT_RETRY_DELAY_MS);
        if (Number.isNaN(raw) || raw <= 0) { return DEFAULT_COMMIT_RETRY_DELAY_MS; }
        return Math.floor(raw);
      }
    GROUP C (COMMIT_RETRY_DELAY_CAP — int ms, max-delay cap):
      export const COMMIT_RETRY_DELAY_CAP = 'COMMIT_RETRY_DELAY_CAP';
      /** Default max-delay cap in ms for stagecoach retry (PRD §5.1: capped 120s). */
      export const DEFAULT_COMMIT_RETRY_DELAY_CAP_MS = 120_000;
      export function getCommitRetryDelayCapMs(): number {
        const raw = Number(process.env[COMMIT_RETRY_DELAY_CAP] ?? DEFAULT_COMMIT_RETRY_DELAY_CAP_MS);
        if (Number.isNaN(raw) || raw <= 0) { return DEFAULT_COMMIT_RETRY_DELAY_CAP_MS; }
        return Math.floor(raw);
      }
  - NAMING: SCREAMING_SNAKE_CASE for consts; camelCase getXxx for readers.
  - JSDOC: each const/reader cites PRD §5.1 (match ISSUE_RETRY_MAX's style which
    cites its PRD section). Add @example blocks mirroring ISSUE_RETRY_MAX.
  - GOTCHA: Math.floor(raw) ensures integer attempts/ms even if env has a float.
    ISSUE_RETRY_MAX doesn't floor, but our delays feed setTimeout which needs int
    ms — floor to be safe. (Acceptable minor robustness; does not break the pattern.)
  - VERIFY: npx tsc --noEmit passes.

Task 2: WRAP generateCommitMessage in retry() inside smartCommit (src/utils/git-commit.ts)
  - ADD to the import block at top of git-commit.ts (alongside the existing
    './logger.js', './errors.js', '../agents/commit-message-agent.js' imports):
      import { retry, createDefaultOnRetry } from './retry.js';
      import {
        getCommitRetryMax,
        getCommitRetryDelayMs,
        getCommitRetryDelayCapMs,
      } from '../config/constants.js';
  - LOCATE the stagecoach branch inside smartCommit (~line 285-300), specifically:
      const diffResult = await gitDiff({ path: repoRoot, staged: true });
      if (!diffResult.success) { ...return null; }
      const generated = await generateCommitMessage(diffResult.diff ?? '');
      formattedMessage = formatCommitMessage(generated);
  - REPLACE ONLY the `const generated = await generateCommitMessage(...)` line with:
      const generated = await retry(
        () => generateCommitMessage(diffResult.diff ?? ''),
        {
          maxAttempts: getCommitRetryMax(),
          baseDelay: getCommitRetryDelayMs(),
          maxDelay: getCommitRetryDelayCapMs(),
          backoffFactor: 2, // doubling (PRD §5.1)
          onRetry: createDefaultOnRetry(
            'stagecoach.generateCommitMessage',
            getCommitRetryMax()
          ),
          // NOTE: isRetryable is intentionally OMITTED — it defaults to
          // isTransientError (PRD §5.1 contract item 3c). generateCommitMessage
          // throws AgentError (PIPELINE_AGENT_LLM_FAILED) which isTransientError
          // classifies transient. Permanent errors (none today) would not retry.
        }
      );
  - PRESERVE: the gitDiff call BEFORE the retry (the diff is read once; only the
    LLM call repeats). PRESERVE: the outer try/catch (exhausted-retry throw →
    null return). PRESERVE: the default path (`else formattedMessage =
    formatCommitMessage(message)`) — byte-identical. PRESERVE:
    generateCommitMessage itself (do NOT modify the boundary).
  - UPDATE the smartCommit JSDoc: in the "Stagecoach path" description (~line
    240), note that generation is now retried with COMMIT_RETRY_* per PRD §5.1,
    and that exhausted retries still surface as a null return (P3.M1.T4.S2 adds
    the fallback commit). Update the "Error Handling" bullets to mention retry.
  - GOTCHA: the retry closure captures diffResult.diff. Do NOT re-read the diff
    inside the closure (that would re-run gitDiff on every retry — wasteful and
    risks reading a different staged set if something mutated the index).
  - GOTCHA: backoffFactor:2 is the default in RetryOptions, but pass it
    explicitly for documentation clarity (PRD §5.1 says "doubling").

Task 3: CREATE tests/unit/config/commit-retry.test.ts
  - MIRROR tests/unit/config/issue-retry-max.test.ts structure EXACTLY, but for
    3 readers. One describe per reader, 6 cases each:
    describe('config/constants: getCommitRetryMax') — cases:
      (a) unset → DEFAULT_COMMIT_RETRY_MAX (5)
      (b) stub '8' → 8
      (c) stub 'abc' (NaN) → 5
      (d) stub '0' → 5
      (e) stub '-3' → 5
      (f) stub '7' → 7
    describe('config/constants: getCommitRetryDelayMs') — same 6 cases against
      DEFAULT_COMMIT_RETRY_DELAY_MS (10_000); valid values 5000, 20000, etc.
    describe('config/constants: getCommitRetryDelayCapMs') — same 6 cases against
      DEFAULT_COMMIT_RETRY_DELAY_CAP_MS (120_000); valid values 60000, 240000.
  - IMPORTS:
      import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
      import {
        COMMIT_RETRY_MAX, DEFAULT_COMMIT_RETRY_MAX, getCommitRetryMax,
        COMMIT_RETRY_DELAY, DEFAULT_COMMIT_RETRY_DELAY_MS, getCommitRetryDelayMs,
        COMMIT_RETRY_DELAY_CAP, DEFAULT_COMMIT_RETRY_DELAY_CAP_MS, getCommitRetryDelayCapMs,
      } from '../../../src/config/constants.js';
  - beforeEach: delete all 3 env vars. afterEach: vi.unstubAllEnvs().
  - PATTERN: use vi.stubEnv(NAME, value) to set; assert getXxx() === expected.
  - PLACEMENT: tests/unit/config/commit-retry.test.ts (new file, matching the
    one-file-per-constant-group convention: issue-retry-max.test.ts,
    research-timeout.test.ts).

Task 4: MODIFY tests/unit/utils/git-commit.test.ts (stagecoach-path section)
  - READ the stagecoach section (~lines 839-950) fully first. Note the mock setup
    (mockCreateCommitMessageAgent, makeFakeAgent helper ~line 50).
  - In EVERY failure-path test in the stagecoach describe block, ADD at the top:
      vi.stubEnv('COMMIT_RETRY_MAX', '1');   // disable retry loop for failure tests
    (so retry calls the boundary exactly once, preserving the existing
    call-count assertions and keeping tests fast). Add afterEach:
    vi.unstubAllEnvs() (or rely on the existing one if present).
  - The "generateCommitMessage throws → returns null" test (~line 911) STILL
    HOLDS (exhausted retry throws → outer catch → null) but now the boundary is
    called once (because COMMIT_RETRY_MAX='1'). If the test asserts a call count,
    update it; if it only asserts the null return + "gitCommit never called",
    no change needed beyond the stubEnv.
  - ADD a new test "smartCommit generateMessage: retries on transient error then
    succeeds":
      * SETUP: vi.stubEnv('COMMIT_RETRY_MAX', '3');
        mockCreateCommitMessageAgent.mockReturnValue(makeFakeAgent that throws
        AgentError on first 2 .prompt() calls then returns success on 3rd).
        Use the prompt mock's mockRejectedValueOnce(new AgentError('timeout #1'))
        .mockRejectedValueOnce(new AgentError('timeout #2'))
        .mockResolvedValueOnce({ status:'success', data:'feat: retry works' }).
        Mock gitStatus/gitAdd/gitDiff/gitCommit to succeed (as the happy-path test does).
      * EXECUTE: await smartCommit('/repo', 'fallback', { generateMessage: true });
      * VERIFY: result === commitHash (not null); the agent's prompt mock was
        called 3 times; gitDiff mock called ONCE (not 3× — diff read once outside
        retry); gitCommit called once with a message containing 'feat: retry works'.
  - ADD a new test "smartCommit generateMessage: permanent error NOT retried
    (boundary called once)":
      * SETUP: vi.stubEnv('COMMIT_RETRY_MAX', '5'); // would retry 5× if retryable
        Mock the BOUNDARY itself to throw a non-transient error. NOTE:
        generateCommitMessage only throws AgentError (always transient), so to
        exercise the permanent-error path you must mock
        'generateCommitMessage' directly OR mock the agent to throw an Error
        whose message contains 'validation failed' (matches PERMANENT_PATTERNS
        in retry.ts). Simplest: vi.mock('../../../src/utils/git-commit.js', ...)
        is circular (testing the module itself). Instead, mock the agent's
        .prompt() to reject with `new Error('validation failed: bad diff')` —
        BUT generateCommitMessage wraps it in AgentError (transient). To truly
        test the permanent path, you must assert isRetryable behavior at the
        retry() level, not via smartCommit. RECOMMENDATION: if exercising the
        permanent-error path through smartCommit is infeasible (because
        generateCommitMessage always throws transient AgentError), SKIP this test
        and instead add a UNIT TEST OF isTransientError in retry's own tests
        (out of scope — retry.ts is read-only). DOCUMENT in a comment that the
        permanent-error classification is owned by isTransientError (unchanged)
        and that generateCommitMessage currently only produces transient errors.
      * IF feasible (e.g. by mocking the boundary module partial-mock): assert
        the agent/boundary is called ONCE and smartCommit returns null.
      * DECISION: implement this test ONLY if a clean partial-mock of
        generateCommitMessage is achievable without contorting the test. If not,
        document the gap (the permanent-error path is exercised by retry.ts's
        own isTransientError tests, not here).
  - PRESERVE: the generateCommitMessage boundary tests (~669-836) — those test
    the UNWRAPPED boundary directly; they are UNCHANGED (the boundary itself is
    not modified).
  - GOTCHA: if the existing happy-path stagecoach test (~line 860-890) does NOT
    stubEnv COMMIT_RETRY_MAX, the default (5) applies but the agent succeeds on
    the first call → retry returns immediately (1 call). No change needed. But
    ADD vi.stubEnv('COMMIT_RETRY_MAX','1') defensively OR leave default — either
    works for the happy path (success → no retry).

Task 5: UPDATE .env.example
  - LOCATE the RESEARCH_TIMEOUT block (~line 109): `# RESEARCH_TIMEOUT=1800`.
  - ADD immediately after it (3 commented lines + a section comment):
      # --- Smart Commit Resilience (PRD §5.1) ---
      # COMMIT_RETRY_MAX=5
      # COMMIT_RETRY_DELAY=10000
      # COMMIT_RETRY_DELAY_CAP=120000
  - GOTCHA: values are the DEFAULTS, commented with `#`. COMMIT_RETRY_DELAY /
    _CAP are in MILLISECONDS (10000 = 10s, 120000 = 120s). Add a one-line comment
    noting the unit.

Task 6: UPDATE docs/CONFIGURATION.md
  - LOCATE the env-var table containing RESEARCH_TIMEOUT + ISSUE_RETRY_MAX
    (~lines 151-154).
  - ADD 3 rows immediately after ISSUE_RETRY_MAX, same Markdown table format:
      | `COMMIT_RETRY_MAX`        | No | `5`       | Maximum number of stagecoach commit-message-generation attempts before falling back. See PRD §5.1. |
      | `COMMIT_RETRY_DELAY`      | No | `10000`   | Base delay in milliseconds between stagecoach generation retries (exponential, doubling). See PRD §5.1. |
      | `COMMIT_RETRY_DELAY_CAP`  | No | `120000`  | Maximum delay cap in milliseconds for stagecoach generation backoff. See PRD §5.1. |
  - VERIFY column alignment matches the existing rows (var | required | default | description).
  - GOTCHA: note the unit (milliseconds) in the description for DELAY/_CAP, since
    the PRD expresses them in seconds (10s/120s) but the env var is ms.

Task 7: VALIDATE
  - RUN: npx tsc --noEmit -p tsconfig.json
  - RUN: npx eslint src/config/constants.ts src/utils/git-commit.ts
  - RUN: npx vitest run tests/unit/config/commit-retry.test.ts
         tests/unit/utils/git-commit.test.ts
  - RUN: npm run validate   # lint + format:check + typecheck + full unit suite
  - EXPECT: GREEN. If red:
    * "retry is not defined" / import error → forgot to import retry in git-commit.ts.
    * test timeout in the retry-succeeds test → the backoff sleeps are real (10s
      default!) — vi.stubEnv COMMIT_RETRY_DELAY='1' AND COMMIT_RETRY_DELAY_CAP='1'
      in the retry tests so the sleeps are 1ms, not 10s. CRITICAL for test speed.
    * boundary called wrong number of times → check COMMIT_RETRY_MAX stub.
    * format:check fails → run npx prettier --write on the 2 modified src files
      + the new test file.
```

### Implementation Patterns & Key Details

```typescript
// PATTERN: the constants (Task 1) — mirror ISSUE_RETRY_MAX's 4-part shape.
export const COMMIT_RETRY_MAX = 'COMMIT_RETRY_MAX';
export const DEFAULT_COMMIT_RETRY_MAX = 5;
export function getCommitRetryMax(): number {
  const raw = Number(process.env[COMMIT_RETRY_MAX] ?? DEFAULT_COMMIT_RETRY_MAX);
  if (Number.isNaN(raw) || raw <= 0) {
    return DEFAULT_COMMIT_RETRY_MAX;
  }
  return Math.floor(raw);
}
// (repeat the same shape for COMMIT_RETRY_DELAY → getCommitRetryDelayMs() and
//  COMMIT_RETRY_DELAY_CAP → getCommitRetryDelayCapMs(), with ms defaults 10_000
//  and 120_000 respectively)

// PATTERN: the retry wrap (Task 2) — wraps ONLY generateCommitMessage.
//   smartCommit stagecoach branch (after gitDiff succeeds):
const diffResult = await gitDiff({ path: repoRoot, staged: true });   // ONCE, outside retry
if (!diffResult.success) {
  logger().error(`Git diff (staged) failed: ${diffResult.error}`);
  return null;
}
const generated = await retry(
  () => generateCommitMessage(diffResult.diff ?? ''),   // the transient boundary
  {
    maxAttempts: getCommitRetryMax(),
    baseDelay: getCommitRetryDelayMs(),
    maxDelay: getCommitRetryDelayCapMs(),
    backoffFactor: 2,
    onRetry: createDefaultOnRetry(
      'stagecoach.generateCommitMessage',
      getCommitRetryMax()
    ),
    // isRetryable: OMITTED → defaults to isTransientError (PRD §5.1 item 3c)
  }
);
formattedMessage = formatCommitMessage(generated);

// CRITICAL INVARIANTS:
// 1. gitDiff is called ONCE (outside retry). The retry closure captures the diff.
// 2. generateCommitMessage throws AgentError (transient) on every failure →
//    isTransientError returns true → retry loops. Permanent errors (none today)
//    would short-circuit.
// 3. On exhausted retries, retry() rethrows the last AgentError → smartCommit's
//    outer try/catch catches it → returns null. P3.M1.T4.S2 adds the fallback
//    commit on that null path. This task does NOT add the fallback.
// 4. The default path (options?.generateMessage !== true) is UNCHANGED — no
//    retry, no new constants referenced. Backward compatible.
```

### Integration Points

```yaml
CONFIG:
  - add to: src/config/constants.ts
  - pattern: "mirror ISSUE_RETRY_MAX block (4-part: name string → default → reader → JSDoc)"
  - env vars: COMMIT_RETRY_MAX (int), COMMIT_RETRY_DELAY (int ms), COMMIT_RETRY_DELAY_CAP (int ms)
  - defaults: 5, 10000, 120000 (PRD §5.1)

UTILITIES:
  - modify: src/utils/git-commit.ts
  - pattern: "wrap generateCommitMessage(diff) in retry() inside smartCommit stagecoach branch"
  - consumed: retry(), createDefaultOnRetry(), isTransientError (default) from src/utils/retry.ts
  - untouched: generateCommitMessage boundary itself, default smartCommit path, outer try/catch

DOCS (Mode A — rides with the work):
  - .env.example: + 3 commented env vars near RESEARCH_TIMEOUT
  - docs/CONFIGURATION.md: + 3 rows in env-var table, cite PRD §5.1
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Run after each file creation - fix before proceeding
npx tsc --noEmit -p tsconfig.json            # typecheck (catches missing imports, type mismatches)
npx eslint src/config/constants.ts src/utils/git-commit.ts
npx prettier --check src/config/constants.ts src/utils/git-commit.ts tests/unit/config/commit-retry.test.ts

# Project-wide validation (the canonical gate)
npm run validate

# Expected: Zero errors. If errors exist, READ output and fix before proceeding.
# Common: format:check fails → npx prettier --write on modified files.
```

### Level 2: Unit Tests (Component Validation)

```bash
# New config readers
npx vitest run tests/unit/config/commit-retry.test.ts -v

# Modified git-commit (stagecoach path)
npx vitest run tests/unit/utils/git-commit.test.ts -v

# Full config + utils suites
npx vitest run tests/unit/config/ tests/unit/utils/ -v

# Expected: All tests pass. If failing, debug root cause and fix implementation.
# CRITICAL for test speed: vi.stubEnv COMMIT_RETRY_DELAY='1' and
#   COMMIT_RETRY_DELAY_CAP='1' in any test that exercises the retry loop, so the
#   backoff sleeps are 1ms instead of the default 10s/120s. Forgetting this makes
#   the retry-succeeds test take 10+ seconds (and may time out).
```

### Level 3: Integration Testing (System Validation)

```bash
# No service to start — this is a library/utility change. The integration-level
# validation is the existing git-commit.test.ts stagecoach-path tests (which mock
# git + the agent) + the full unit suite via `npm run validate`.

# To manually exercise the retry path (optional, smoke test):
#   set COMMIT_RETRY_MAX=2 COMMIT_RETRY_DELAY=100 COMMIT_RETRY_DELAY_CAP=500
#   run a stagecoach smartCommit against a repo with staged changes + a mocked
#   flaky LLM. Confirm it retries and either succeeds or returns null after 2 tries.

# Expected: npm run validate GREEN; no behavioral change to default-path
# smartCommit; stagecoach path retries transient failures.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# (This task has no web/Docker/DB/performance surface — it's a retry-wrapper
#  over an existing LLM call. The domain-specific validation is the unit test
#  asserting retry behavior: transient error → retried; success-after-retries →
#  commit created; gitDiff called once across retries.)

# Optional: assert the retry backoff sequence is exponential (10, 20, 40, 80, 120
# capped) by inspecting createDefaultOnRetry's logged delayMs values in a test
# that captures the onRetry callback. (Lower the delays via env to keep it fast.)
```

## Final Validation Checklist

### Technical Validation

- [ ] All 4 validation levels completed successfully
- [ ] `npm run validate` GREEN (lint + format:check + typecheck + test:run)
- [ ] No linting errors: `npx eslint src/config/constants.ts src/utils/git-commit.ts`
- [ ] No type errors: `npx tsc --noEmit -p tsconfig.json`
- [ ] No formatting issues: `npx prettier --check` on modified files

### Feature Validation

- [ ] 3 config constant groups (name + default + reader) exist with PRD §5.1 JSDoc
- [ ] Readers validate (unset/NaN/zero/negative → default) — commit-retry.test.ts GREEN
- [ ] `smartCommit` stagecoach branch wraps `generateCommitMessage` in `retry()`
      with the new constants + `createDefaultOnRetry`
- [ ] `gitDiff` stays outside the retry closure (called once across retries)
- [ ] Default path (`generateMessage !== true`) byte-identical — existing tests GREEN
- [ ] Retry-succeeds test passes (boundary called 3×, commit created)
- [ ] Failure-path tests use `vi.stubEnv('COMMIT_RETRY_MAX', '1')` to stay fast
- [ ] `.env.example` has 3 commented vars near RESEARCH_TIMEOUT
- [ ] `docs/CONFIGURATION.md` has 3 new rows citing PRD §5.1
- [ ] `src/utils/retry.ts` UNCHANGED (read-only consumption)
- [ ] `src/core/task-orchestrator.ts` UNCHANGED

### Code Quality Validation

- [ ] Constants mirror the `ISSUE_RETRY_MAX` 4-part pattern exactly
- [ ] Reader functions use the same `Number(env ?? default)` + NaN/<=0 guard
- [ ] Retry wiring uses the generic `retry()`, NOT the hardcoded `retryAgentPrompt`
- [ ] `isRetryable` option OMITTED (relies on the `isTransientError` default per contract)
- [ ] No new dependencies added (`package.json` `dependencies` byte-identical)
- [ ] JSDoc on new constants + the modified smartCommit branch cites PRD §5.1

### Documentation & Deployment

- [ ] Code is self-documenting with clear variable/function names
- [ ] New env vars documented in `.env.example` AND `docs/CONFIGURATION.md`
- [ ] Units (ms) noted where the PRD expresses seconds (10s/120s)

---

## Anti-Patterns to Avoid

- ❌ Don't use `retryAgentPrompt` — it has a HARDCODED config (3/1s/30s) that
  ignores `COMMIT_RETRY_*`. Use the generic `retry()` with explicit options.
- ❌ Don't wrap all of `smartCommit` in retry — that re-stages + re-commits on
  each retry (double commits, index churn). Wrap ONLY `generateCommitMessage`.
- ❌ Don't re-read the diff inside the retry closure — read `gitDiff` ONCE
  outside, capture `diffResult.diff` in the closure.
- ❌ Don't pass a custom `isRetryable` — omit it so it defaults to
  `isTransientError` (contract item 3c). A custom predicate risks divergence.
- ❌ Don't subtract 1 from `COMMIT_RETRY_MAX` — `retry()`'s `maxAttempts` is
  TOTAL attempts (5 = 5 calls), matching PRD §5.1 "5 attempts."
- ❌ Don't modify `src/utils/retry.ts` or `isTransientError` — the watchdog/
  exit-124 "never retry" wiring is P3.M2.T2.S2's scope. This task consumes
  `retry`/`isTransientError` as-is.
- ❌ Don't add the fallback placeholder commit — that's P3.M1.T4.S2. This task
  leaves the exhausted-retry outcome as a `null` return (smartCommit's existing
  outer catch), which S2 will layer the fallback onto.
- ❌ Don't forget to lower the delays in retry-exercising tests — without
  `vi.stubEnv('COMMIT_RETRY_DELAY', '1')`, the retry-succeeds test sleeps 10s+
  and may time out.
- ❌ Don't treat `COMMIT_RETRY_DELAY` as seconds — it's MILLISECONDS (to feed
  `retry()`'s `baseDelay`/`maxDelay`). Default 10_000 (not 10).