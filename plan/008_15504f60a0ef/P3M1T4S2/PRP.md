# PRP — P3.M1.T4.S2: Last-resort fallback placeholder commit

---

## Goal

**Feature Goal**: Add the **last-resort fallback placeholder commit** to
`smartCommit`'s stagecoach branch in `src/utils/git-commit.ts`, completing the
"Smart Commit Resilience" contract from PRD §5.1. When commit-message
generation **still fails after all `COMMIT_RETRY_MAX` retries** (the retry loop
authored by the prerequisite P3.M1.T4.S1), the staged work MUST NOT be stranded
uncommitted — `smartCommit` falls back to a **plain `gitCommit`** (bypassing
stagecoach entirely) with a clearly-labeled placeholder message
(`chore: commit-gen failed (exit N); fallback commit`) so the substance is
preserved and can be reworded later. This is the "still failing after all
retries" terminal branch that PRD §5.1 mandates.

**Deliverable** (2 files: 1 modified production utility + 1 modified test):
1. **`src/utils/git-commit.ts`** — MODIFY: in `smartCommit`'s stagecoach branch
   (the `if (options?.generateMessage)` block), wrap the **retry-wrapped
   `generateCommitMessage` call** (which P3.M1.T4.S1 placed there) in an
   **inner `try/catch`**. On catch (retries exhausted → `retry()` rethrows the
   last `AgentError`), build the placeholder message, call `gitCommit` directly
   with it, and return the fallback commit hash (or `null` if even the
   fallback commit fails). Add a small private `buildFallbackCommitMessage`
   helper + a `COMMIT_GEN_FALLBACK_EXIT_SENTINEL` constant. **No other path is
   touched.** The default path (`generateMessage !== true`), the
   `generateCommitMessage` boundary itself, the retry wrapper from S1, and the
   outer `try/catch` are **byte-for-byte unchanged**.
2. **`tests/unit/utils/git-commit.test.ts`** — MODIFY: update the existing
   `'generateCommitMessage throws → returns null'` test (its contract FLIPS:
   it now asserts a fallback commit is made, not null), and add 2 new tests
   covering the inner-catch branches (fallback commit succeeds → returns hash;
   fallback gitCommit ALSO fails → returns null) to satisfy the project's
   **100% coverage gate**.

**Scope note (critical):** This task is **ONLY the fallback commit + its tests**.
It does NOT add config constants, env vars, `.env.example` entries, or
`docs/CONFIGURATION.md` rows (work item: "DOCS: none"). It does NOT modify
`retry.ts`, `errors.ts`, `AgentError`, `generateCommitMessage`,
`commit-message-agent.ts`, `constants.ts`, or `task-orchestrator.ts`. It
**CONSUMES** the retry wrap from P3.M1.T4.S1 (treat S1's PRP as a contract —
S1 wraps `generateCommitMessage(diff)` in `retry(...)` inside the stagecoach
branch, and on exhausted retries `retry()` rethrows the last error). This task
completes **P3.M1.T4** (the milestone's two subtasks are then both done).

**Success Definition**:
- `smartCommit(path, msg)` (no options) behaves EXACTLY as today: no retry, no
  fallback. Existing default-path tests pass unchanged.
- `smartCommit(path, fallback, { generateMessage: true })` where stagecoach
  generation **succeeds** (after 0+ retries) behaves EXACTLY as in S1: returns
  the diff-accurate commit hash. No fallback fires.
- `smartCommit(path, fallback, { generateMessage: true })` where stagecoach
  generation **fails after all `COMMIT_RETRY_MAX` retries** now **performs a
  fallback commit** instead of returning `null`: it calls `gitCommit` directly
  with `formatCommitMessage('chore: commit-gen failed (exit N); fallback commit')`,
  logs a `warn`, and returns the fallback commit hash. The staged substance is
  preserved (PRD §5.1: "staged work MUST NOT be stranded uncommitted").
- If the fallback `gitCommit` itself fails (e.g. git error), `smartCommit`
  returns `null` (preserving the never-fail-on-commit contract).
- `npm run validate` GREEN; **100% coverage** on `src/utils/git-commit.ts`
  maintained; `package.json` `dependencies` unchanged.

---

## User Persona (if applicable)

**Target User**: The autonomous pipeline (no human in the loop). Immediate
consumer: P3.M1.T3.S2 (the two-phase commit wiring — pre-cleanup survival
commit + post-cleanup commit), which calls `smartCommit(..., { generateMessage:
true })` twice per subtask. The fallback guarantees that even on a sustained
LLM-API outage (all 5 retries exhausted), the subtask's staged substance
(implementation files, `plan/` artifacts) is still committed — never stranded.
**Use Case**: A sustained Anthropic/OpenAI outage (multi-minute 429/504 storm)
exhausts all 5 commit-generation retries. Without the fallback, the subtask's
staged work stays uncommitted → the next `smartCommit` (or cleanup) mixes it
into a later commit, or worse, an interrupt strands it forever (the
orphaned-`plan/` failure mode PRD §5.1 explicitly guards against). The
fallback commits the substance NOW with a labeled message so an operator can
`git rebase --reword` later.
**User Journey**: orchestrator → `smartCommit(path, fb, { generateMessage: true
})` → `gitAdd` (stages filtered set) → `gitDiff({staged:true})` → **retry(
generateCommitMessage)** (S1) → retries 5×, all fail → `retry()` rethrows last
`AgentError` → **[NEW] inner `catch`** → build placeholder → `gitCommit` with
placeholder → return fallback hash + `warn` log.
**Pain Points Addressed**: PRD §5.1 — "if generation is still failing after all
retries, the staged work MUST NOT be stranded uncommitted — the system falls
back to a plain `git commit` with a clearly-labeled placeholder message."

---

## Why

- **PRD compliance**: PRD §5.1 (h3.9) *"Smart Commit Resilience (commit-gen
  retry + fallback)"* mandates: *"Last-resort fallback: if generation is still
  failing after all retries, the staged work MUST NOT be stranded uncommitted —
  the system falls back to a plain `git commit` with a clearly-labeled
  placeholder message (e.g. `chore: commit-gen failed (exit N); fallback
  commit`) so the substance is preserved and can be reworded later."* S1 ships
  the retry; **this task ships the fallback**. Together they close P3.M1.T4.
- **Contract item 3 (LOGIC) full coverage**:
  - (a) *"After exhausting retries, if commit-message generation is still
    failing, fall back to a plain git commit (bypassing stagecoach) with a
    labeled placeholder message."* → wrap the S1 retry-wrapped
    `generateCommitMessage` call in an inner `try/catch`; on catch, call
    `gitCommit` directly (bypassing stagecoach) with the placeholder.
  - (b) *"Message: 'chore: commit-gen failed (exit N); fallback commit' where
    N is the last exit code."* → the placeholder is built by
    `buildFallbackCommitMessage(error)`. **See the "exit N" reality note
    below** — there is no real subprocess exit code for an LLM-API failure, so
    N is a sentinel `0` unless the caught error carries a `context.exitCode`.
  - (c) *"This ensures staged work is never stranded. The fallback uses the
    existing gitCommit MCP tool directly with the placeholder message."* →
    confirmed: the index is still staged (gitAdd ran before generation), so
    `gitCommit` commits the substance.
- **The "exit N" reality note (critical for the implementing agent — read
  carefully)**: The stagecoach boundary is a **pure LLM-API call**
  (`createCommitMessageAgent().prompt(...)` via Groundswell), NOT a subprocess.
  A transient LLM-API failure (429/504/timeout) has **no OS exit code**.
  `AgentError` (`src/utils/errors.ts`) hardcodes `code =
  PIPELINE_AGENT_LLM_FAILED` and has **NO `exitCode` field**. So the literal
  phrase "where N is the last exit code" in the PRD/work-item **cannot be
  faithfully populated** — there is no exit code to read. The honest, defensible
  choice: N = a sentinel `0` meaning "no subprocess exit code (LLM-API failure)",
  UNLESS the caught error happens to carry `context?.exitCode` (future-proofing
  for P3.M2.T2's exit-124 AgentErrors, which don't exist yet). The PRP's
  `buildFallbackCommitMessage` reads `context?.exitCode` if present, else `0`.
  This satisfies the PRD's intent (a clearly-labeled, rewordable commit) — the
  *label* is what matters, not a precise N. **Do NOT hunt for a nonexistent
  exit code or invent one.** Document this in a code comment.
- **Distinction from S1**: S1 ships the *retry*. This task ships the *fallback
  on exhausted retry*. The two compose: S1's `retry()` rethrows the last error;
  this task's inner `catch` turns that rethrow into a fallback commit (instead
  of letting it reach the outer `try/catch` and become a `null` return).

---

## What

One modified production utility (`git-commit.ts`), one modified test
(`git-commit.test.ts`). **No** config, **no** docs, **no** new files, **no**
new dependencies.

### Success Criteria

- [ ] **`smartCommit` stagecoach branch wraps the retry-wrapped
      `generateCommitMessage` call in an inner `try/catch`**: the call site in
      the `if (options?.generateMessage)` block reads (after S1's wrap)
      `let generated: string; try { generated = await retry(() =>
      generateCommitMessage(diffResult.diff ?? ''), { ...S1's options... }); }
      catch (genError) { /* FALLBACK */ }`. Verified by reading the call site.
- [ ] **A private `buildFallbackCommitMessage(error: unknown): string` helper
      exists** in `git-commit.ts`, returning
      `'chore: commit-gen failed (exit N); fallback commit'` where N =
      `toExitCodeOrSentinel(error)` (reads `context?.exitCode` if the error is
      an `AgentError`/`PipelineError` with that context key, else the sentinel
      `COMMIT_GEN_FALLBACK_EXIT_SENTINEL = 0`). Verified by a direct unit test.
- [ ] **A `COMMIT_GEN_FALLBACK_EXIT_SENTINEL = 0` constant exists** in
      `git-commit.ts` with a JSDoc comment explaining "LLM-API failures have no
      subprocess exit code; 0 is the sentinel meaning 'not applicable'."
- [ ] **On exhausted-retry catch, `smartCommit` calls `gitCommit` directly**
      with `formatCommitMessage(buildFallbackCommitMessage(genError))`, returns
      the fallback commit hash on success (and logs a `warn` naming the
      fallback). The placeholder is wrapped with the `[PRP Auto]` prefix +
      `Co-Authored-By` trailer via `formatCommitMessage` (matching the happy
      path). Verified by a test asserting the exact commit message.
- [ ] **On exhausted-retry catch + fallback `gitCommit` failure,
      `smartCommit` returns `null`** (never-fail-on-commit contract preserved).
      Verified by a test where the mocked `gitCommit` returns `{success:false}`
      → `result === null`.
- [ ] **A `warn` log is emitted when the fallback fires**: e.g.
      `logger().warn('Commit-message generation failed after retries; falling back to placeholder commit')`.
      Verified by asserting `mockLogger.warn` was called with a matching string.
- [ ] **Default path is byte-identical**: `smartCommit(path, msg)` (no options)
      does NOT reference the fallback, does NOT enter the inner try/catch.
      Existing default-path tests pass unchanged. Verified by `git diff`
      showing the default-path branch untouched.
- [ ] **Stagecoach happy path is byte-identical**: when generation succeeds
      (after 0+ retries), the inner `try` completes, no catch runs, no fallback
      fires, the diff-accurate commit is made. Verified by the existing
      happy-path stagecoach test still passing (S1 added it).
- [ ] **`generateCommitMessage` itself is UNCHANGED**: the boundary is not
      modified — only its call site's error handling. Verified by
      `git diff --stat src/utils/git-commit.ts` showing the diff localized to
      the stagecoach branch.
- [ ] **The existing `'generateCommitMessage throws → returns null'` test is
      UPDATED**: it now asserts a fallback commit is made (result = fallback
      hash, `mockGitCommit` called once with the placeholder, `mockLogger.warn`
      called) instead of `null`.
- [ ] **100% coverage on `src/utils/git-commit.ts` is maintained**:
      `npm run test:coverage` GREEN for the file (the inner-catch success +
      failure branches are both exercised).
- [ ] `npm run validate` GREEN; `package.json` `dependencies` byte-identical.

---

## All Needed Context

### Context Completeness Check

✅ "If someone knew nothing about this codebase, would they have everything
needed to implement this successfully?" — YES. This PRP names the exact branch
to modify (`smartCommit`'s `if (options?.generateMessage)` block, where S1's
retry wrap already lives), the exact error type caught (the original
`AgentError` rethrown by `retry()` — confirmed `retry()` does `throw lastError`
at `retry.ts:550`, NOT a wrapper), the exact tool to call (`gitCommit` from
`src/tools/git-mcp.ts` — confirmed it commits the already-staged index), the
exact wrapper (`formatCommitMessage`), the exact placeholder string, the exact
two tests to write (inner-catch success + failure), and the exact "exit N"
reality (no subprocess exit code exists → sentinel `0`).

### Documentation & References

```yaml
# MUST READ - Include these in your context window
- file: src/utils/git-commit.ts   # smartCommit stagecoach branch ~lines 280-310
  why: THE FILE YOU MODIFY. (1) The stagecoach branch is the `if (options?.generateMessage)`
       block. S1's PRP placed a `retry(() => generateCommitMessage(diffResult.diff ?? ''), {...})`
       call there. This task WRAPS THAT retry call in an inner try/catch. (2) The gitDiff
       call BEFORE the retry stays (the diff is read once). (3) The gitAdd call BEFORE gitDiff
       already staged the filtered set — so when generation fails, the index is STILL staged
       and gitCommit will commit the substance. (4) The outer try/catch stays for truly
       unexpected errors (e.g. gitStatus throws).
  pattern: the stagecoach branch currently (post-S1) looks like:
       const diffResult = await gitDiff({ path: repoRoot, staged: true });
       if (!diffResult.success) { logger().error(...); return null; }
       const generated = await retry(() => generateCommitMessage(diffResult.diff ?? ''), { ...S1 opts });
       formattedMessage = formatCommitMessage(generated);
       const commitResult = await gitCommit({ path: repoRoot, message: formattedMessage });
       ...
   This task changes ONLY the middle: wrap the retry in try/catch, and on catch set
   formattedMessage to the placeholder + continue to the SAME gitCommit call (so the
   fallback reuses the existing commit-result handling + the logger().info('Commit created: ...')
   line). See Implementation Blueprint for the exact shape.
  gotcha: do NOT duplicate the gitCommit call. The cleanest refactor: compute
          `formattedMessage` in BOTH the try-success and catch-fallback paths, then the
          SINGLE existing `await gitCommit({ path: repoRoot, message: formattedMessage })`
          handles both. This keeps the commit-result + logger().info logic shared. See the
          Implementation Blueprint's "refactor shape" — it shows how to do this without a
          second gitCommit call.
  gotcha: the fallback must NOT swallow/re-throw into the OUTER try/catch. The inner catch
          handles generation exhaustion and sets formattedMessage = placeholder, then flow
          continues NORMALLY to gitCommit. The outer try/catch is only for errors OUTSIDE
          generation (e.g. gitStatus/gitAdd/gitDiff/gitCommit throwing unexpectedly).

- file: src/utils/retry.ts   # lines ~480-555 (the retry() body)
  why: CONFIRMS the catch receives the ORIGINAL error. At line 550, `retry()` does
       `throw lastError` (the last caught error), NOT a wrapper/AggregateError. So
       `catch (genError)` in the fallback receives the original `AgentError`
       (code = PIPELINE_AGENT_LLM_FAILED). This is why `buildFallbackCommitMessage` can
       type-narrow on `isAgentError` / check `context?.exitCode`.
  pattern: read the retry() loop (~500-555). `lastError` is assigned each iteration; on
           the final attempt OR a non-retryable error, it throws `lastError` directly.
  gotcha: do NOT assume a RetryError type exists — it does NOT. `retry()` rethrows the
          bare underlying error. So `catch (genError) { ... }` gets an AgentError (or
          whatever generateCommitMessage threw — currently always AgentError).

- file: src/utils/errors.ts   # AgentError class + PipelineError base
  why: (1) AgentError hardcodes `code = PIPELINE_AGENT_LLM_FAILED`, has NO `exitCode`
       field, and carries an optional `context` (PipelineErrorContext). (2) The base
       PipelineError attaches context props to the instance (line ~155:
       `Object.assign(this, context)`), so if a caller ever sets `context.exitCode`, it
       appears as `(error as any).exitCode`. (3) `isAgentError(error)` type guard exists.
       (4) `toErrorMessage(error)` robustly extracts a message from any thrown value —
       USE IT for the log/warn (don't hand-roll `error instanceof Error ? error.message`).
  pattern: for buildFallbackCommitMessage, narrow: `if (isAgentError(error) &&
           typeof (error as PipelineError).context?.exitCode === 'number') N =
           error.context.exitCode; else N = COMMIT_GEN_FALLBACK_EXIT_SENTINEL;`
  gotcha: there is NO subprocess exit code for an LLM-API failure. The "exit N" in the
          PRD is a label. Use sentinel 0. See the "exit N reality note" in the Why section.

- file: src/tools/git-mcp.ts   # gitCommit function + GitCommitResult interface
  why: CONFIRMS gitCommit commits the already-staged index. `gitCommit({path, message,
       allowEmpty?})` calls `simpleGit(safePath).commit(message, [], options)` — it commits
       whatever is staged. In the stagecoach branch, gitAdd already ran (staging the
       filtered set), so the fallback gitCommit will commit the substance. Returns
       `{success, commitHash?, error?}`. On `success:false` → smartCommit returns null
       (preserve never-fail-on-commit). `allowEmpty` defaults false — do NOT set it (we
       want the commit to fail loudly if somehow nothing is staged, which shouldn't happen
       because gitAdd succeeded + filteredFiles.length > 0 was checked earlier).
  pattern: the fallback uses the SAME gitCommit call the happy path uses. Do not create a
           second gitCommit call site — reuse the shared commit-result handling.

- file: tests/unit/utils/git-commit.test.ts   # stagecoach section ~lines 839-950
  why: THE TEST FILE YOU MODIFY. (1) The existing test 'generateCommitMessage throws →
       returns null' (FLIPS contract) must be updated to assert a fallback commit is made.
       (2) ADD a test 'fallback gitCommit ALSO fails → returns null' (mock gitCommit to
       return {success:false} after generation exhausts retries). (3) The mock setup:
       `vi.mock('../../../src/tools/git-mcp.js', ...)` already mocks gitStatus/gitAdd/
       gitCommit/gitDiff. `mockCreateCommitMessageAgent` (vi.fn) returns a fake agent via
       `makeFakeAgent`. The makeFakeAgent helper (~line 50) returns `{prompt: vi.fn()}`.
  pattern: S1's PRP added `vi.stubEnv('COMMIT_RETRY_MAX', '1')` to failure-path tests so
           retry does NOT loop (1 attempt = boundary called once, fast test). REUSE that
           pattern: in BOTH fallback tests, `vi.stubEnv('COMMIT_RETRY_MAX', '1')` AND
           `vi.stubEnv('COMMIT_RETRY_DELAY', '1')` (so any incidental sleep is 1ms). The
           afterEach should `vi.unstubAllEnvs()` (check if S1 added it; if not, add it).
  gotcha: the generation-throws test must mock the agent to throw on EVERY .prompt() call
          (so retry exhausts immediately with COMMIT_RETRY_MAX=1). Use makeFakeAgent with
          `{status:'error', data:null, error:{message:'model overloaded'}}` — generateCommitMessage
          throws AgentError on status:error. With COMMIT_RETRY_MAX=1, retry calls the boundary
          once, gets the AgentError, isTransientError=true but attempt 0 >= maxAttempts-1=0 →
          throws. Inner catch → fallback.
  gotcha: assert mockGitCommit is called with the PLACEHOLDER message, e.g.:
          expect(mockGitCommit).toHaveBeenCalledWith({
            path: '/project',
            message: expect.stringMatching(/\[PRP Auto\] chore: commit-gen failed \(exit \d+\); fallback commit/)
          });
          The regex allows any digit for N (sentinel 0 in tests).

- file: plan/008_15504f60a0ef/P3M1T4S1/PRP.md
  why: THE CONTRACT for the retry wrap. Confirms: (1) S1 wraps generateCommitMessage(diff)
       in retry() inside smartCommit's stagecoach branch. (2) On exhausted retries, retry()
       rethrows → smartCommit's outer try/catch → null return (THIS IS WHAT S2 CHANGES).
       (3) S1 added tests including a retry-succeeds test + the throws-→-null test that S2
       now updates. (4) S1 added vi.stubEnv('COMMIT_RETRY_MAX', '1') to failure tests.
       Treat S1's retry options (maxAttempts: getCommitRetryMax(), etc.) as FROZEN — S2
       does NOT change the retry options, only adds the try/catch around them.
  pattern: S2 wraps S1's retry(...) call. Do NOT modify S1's retry options object.
```

### Current Codebase tree (relevant slice)

```bash
src/
  utils/
    git-commit.ts            # MODIFY — wrap S1's retry-wrapped generateCommitMessage in inner try/catch; add buildFallbackCommitMessage + COMMIT_GEN_FALLBACK_EXIT_SENTINEL
    retry.ts                 # READ-ONLY — retry() rethrows lastError directly (line 550), NOT a wrapper
    errors.ts                # READ — AgentError (no exitCode field; context.exitCode if set), isAgentError, toErrorMessage
  tools/
    git-mcp.ts               # READ-ONLY — gitCommit commits already-staged index; returns {success, commitHash?, error?}
tests/
  unit/
    utils/
      git-commit.test.ts     # MODIFY — update throws-→-null test (now fallback); add fallback-gitCommit-fails test
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
src/utils/git-commit.ts
  # MODIFIED:
  #   + export const COMMIT_GEN_FALLBACK_EXIT_SENTINEL = 0;  (with JSDoc explaining the LLM-API-no-exit-code reality)
  #   + function buildFallbackCommitMessage(error: unknown): string  (returns 'chore: commit-gen failed (exit N); fallback commit', N from error.context?.exitCode ?? sentinel)
  #   + in smartCommit stagecoach branch: wrap S1's retry(...) call in try/catch;
  #       on catch: logger().warn('Commit-message generation failed after retries; falling back to placeholder commit');
  #         formattedMessage = formatCommitMessage(buildFallbackCommitMessage(genError));
  #       (then flow continues to the SAME gitCommit call the happy path uses)
  #   Default path, generateCommitMessage boundary, retry options, outer try/catch — UNCHANGED.
tests/unit/utils/git-commit.test.ts
  # MODIFIED:
  #   - UPDATE 'generateCommitMessage throws → returns null' → now asserts fallback commit made (hash, placeholder msg, warn log)
  #   + ADD 'fallback commit: gitCommit ALSO fails → returns null' (mock gitCommit {success:false} after gen exhaustion)
  #   + ADD direct unit test for buildFallbackCommitMessage (sentinel path + context.exitCode path) if not covered via smartCommit
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL: wrap S1's retry(...) call, NOT generateCommitMessage directly, and NOT all of
// smartCommit. S1's PRP placed retry(() => generateCommitMessage(diff), {...}) in the
// stagecoach branch. S2 adds try { ...S1's retry call... } catch (genError) { fallback }
// AROUND that retry call. Wrapping all of smartCommit would catch gitStatus/gitAdd/gitDiff
// errors too (wrong — those should hit the outer catch → null, not a fallback commit with
// a nonsense placeholder). Wrapping generateCommitMessage (without retry) would bypass
// S1's retry entirely. Wrap the retry call exactly.

// CRITICAL: there is NO subprocess exit code for an LLM-API failure. The "exit N" in the
// PRD is a label. AgentError has no exitCode field. Use sentinel 0 (COMMIT_GEN_FALLBACK_EXIT_SENTINEL).
// Read error.context?.exitCode IF present (future-proofing for P3.M2.T2 exit-124 errors),
// else the sentinel. DO NOT invent or parse an exit code from the error message.

// CRITICAL: reuse the SINGLE existing gitCommit call. After the try/catch computes
// formattedMessage (either from the generated message on success, or the placeholder on
// fallback), flow continues to the SAME `await gitCommit({ path: repoRoot, message:
// formattedMessage })` the happy path uses. Do NOT add a second gitCommit call site —
// that would duplicate the commit-result + logger().info('Commit created: ...') logic.

// CRITICAL: the fallback must set formattedMessage and CONTINUE (not return early, not
// rethrow). The outer try/catch is for unexpected throws (git operations). The inner catch
// is the controlled fallback path — it must produce a valid commit, not propagate.

// GOTCHA: the inner catch must NOT fire on gitDiff failure. gitDiff failure is handled
// EARLIER in the stagecoach branch (the `if (!diffResult.success) { ...; return null; }`
// guard). The inner try/catch wraps ONLY the retry(generateCommitMessage) call, which runs
// AFTER the gitDiff success check. So gitDiff failure still → null (correct — there's no
// diff to commit-message, and the fallback placeholder would be meaningless without a
// successful stage).

// GOTCHA: 100% coverage is ENFORCED (vitest.config.ts thresholds: statements/branches/
// functions/lines all 100% on src/**/*.ts). The inner catch has TWO outcomes: fallback
// commit succeeds (→ hash) and fallback gitCommit fails (→ null). BOTH must be tested or
// coverage fails. The buildFallbackCommitMessage helper's two branches (context.exitCode
// present vs absent) should also be covered — easiest by a direct unit test OR by
// constructing an AgentError with context.exitCode in one of the smartCommit tests.

// GOTCHA: use vi.stubEnv('COMMIT_RETRY_MAX', '1') AND vi.stubEnv('COMMIT_RETRY_DELAY', '1')
// in the fallback tests so retry does NOT loop (1 attempt) and any incidental sleep is 1ms.
// S1's PRP established this pattern. Add afterEach: vi.unstubAllEnvs() if not already present.

// GOTCHA: use toErrorMessage(error) (from src/utils/errors.ts) for the warn log's error
// detail — it robustly handles AgentError, plain objects, ZodErrors, etc. Do NOT hand-roll
// `error instanceof Error ? error.message : String(error)`.

// GOTCHA: the existing test 'generateCommitMessage throws → returns null' asserts
// mockLogger.error was called with /Unexpected error/. AFTER S2, that assertion is WRONG —
// the fallback path logs a WARN (not error) and does NOT reach the outer catch. Update the
// test to assert mockLogger.warn was called with the fallback message, and mockGitCommit
// was called with the placeholder. Do NOT leave a stale /Unexpected error/ assertion.
```

---

## Implementation Blueprint

### Data models and structure

No new types. The only new "data" is one sentinel constant + one helper function. The
fallback reuses the existing `formatCommitMessage` wrapper + `gitCommit` tool.

```typescript
// src/utils/git-commit.ts — NEW additions:

/**
 * Sentinel "exit code" used in the fallback placeholder commit message when
 * commit-message generation fails after all retries (PRD §5.1).
 *
 * @remarks
 * The stagecoach generation boundary is a pure LLM-API call (Groundswell
 * agent.prompt), NOT a subprocess. A transient LLM-API failure (429/504/timeout)
 * has NO OS exit code, and {@link AgentError} carries no `exitCode` field. So the
 * PRD §5.1 placeholder label `chore: commit-gen failed (exit N); fallback commit`
 * cannot be populated with a real exit code — `0` is the sentinel meaning
 * "no subprocess exit code (LLM-API failure)". If a future error type (e.g. an
 * exit-124 watchdog error from P3.M2.T2) carries `context.exitCode`, that value
 * is used instead (see {@link buildFallbackCommitMessage}).
 */
const COMMIT_GEN_FALLBACK_EXIT_SENTINEL = 0;

/**
 * Build the last-resort fallback placeholder commit message (PRD §5.1).
 *
 * @param error - The error thrown by the exhausted retry loop (the original
 * {@link AgentError} rethrown by `retry()` — NOT a wrapper).
 * @returns The placeholder subject line, e.g.
 * `'chore: commit-gen failed (exit 0); fallback commit'`. The caller wraps it
 * via {@link formatCommitMessage} (adds `[PRP Auto]` prefix + `Co-Authored-By`).
 *
 * @remarks
 * PRD §5.1 mandates a "clearly-labeled placeholder message … so the substance
 * is preserved and can be reworded later." The `exit N` segment reflects the
 * last exit code when one is available (read from a {@link PipelineError}
 * `context.exitCode`); otherwise the {@link COMMIT_GEN_FALLBACK_EXIT_SENTINEL}
 * (`0`) is used, because LLM-API failures have no subprocess exit code.
 */
function buildFallbackCommitMessage(error: unknown): string {
  let exitCode: number = COMMIT_GEN_FALLBACK_EXIT_SENTINEL;
  if (isAgentError(error)) {
    const ctx = error.context as Record<string, unknown> | undefined;
    if (ctx && typeof ctx.exitCode === 'number') {
      exitCode = ctx.exitCode;
    }
  }
  return `chore: commit-gen failed (exit ${exitCode}); fallback commit`;
}
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: ADD the sentinel constant + buildFallbackCommitMessage helper to src/utils/git-commit.ts
  - LOCATE the import block at the top of git-commit.ts. ENSURE these imports exist
    (some may already be present from S1/S0):
      import { AgentError, isAgentError, toErrorMessage } from './errors.js';
    (Add isAgentError + toErrorMessage if not already imported. AgentError is already
     imported — generateCommitMessage uses it.)
  - ADD a new section AFTER the STAGECOACH section header / BEFORE the MAIN FUNCTION
    section (or grouped near generateCommitMessage), containing:
      (a) the COMMIT_GEN_FALLBACK_EXIT_SENTINEL constant (with the JSDoc above).
      (b) the buildFallbackCommitMessage function (with the JSDoc above).
  - NAMING: SCREAMING_SNAKE_CASE for the const; camelCase for the function.
  - GOTCHA: do NOT export buildFallbackCommitMessage unless a test needs it directly.
    If the smartCommit tests exercise both its branches (sentinel + context.exitCode),
    it need NOT be exported. If you prefer a direct unit test, export it. Recommendation:
    keep it module-private (not exported) and cover it via smartCommit tests — this
    matches the codebase's preference for testing through the public API (the existing
    generateCommitMessage tests do exercise the boundary via the exported function, but
    buildFallbackCommitMessage is a pure string helper with no side effects, so covering
    it via smartCommit's catch path is cleaner). If coverage complains, export + add a
    direct test.
  - VERIFY: npx tsc --noEmit passes.

Task 2: WRAP S1's retry(...) call in an inner try/catch inside smartCommit's stagecoach branch
  - LOCATE the stagecoach branch inside smartCommit (the `if (options?.generateMessage)`
    block). Post-S1 it reads (approximately):
      const diffResult = await gitDiff({ path: repoRoot, staged: true });
      if (!diffResult.success) {
        logger().error(`Git diff (staged) failed: ${diffResult.error}`);
        return null;
      }
      const generated = await retry(
        () => generateCommitMessage(diffResult.diff ?? ''),
        { maxAttempts: getCommitRetryMax(), baseDelay: getCommitRetryDelayMs(),
          maxDelay: getCommitRetryDelayCapMs(), backoffFactor: 2,
          onRetry: createDefaultOnRetry('stagecoach.generateCommitMessage', getCommitRetryMax()) }
      );
      formattedMessage = formatCommitMessage(generated);
  - REFACTOR to wrap the retry call in try/catch, computing formattedMessage in BOTH paths
    so the SINGLE downstream gitCommit call is reused:
      const diffResult = await gitDiff({ path: repoRoot, staged: true });
      if (!diffResult.success) {
        logger().error(`Git diff (staged) failed: ${diffResult.error}`);
        return null;
      }
      try {
        // Stagecoach generation (S1's retry wrap). On success, use the generated message.
        const generated = await retry(
          () => generateCommitMessage(diffResult.diff ?? ''),
          { maxAttempts: getCommitRetryMax(), baseDelay: getCommitRetryDelayMs(),
            maxDelay: getCommitRetryDelayCapMs(), backoffFactor: 2,
            onRetry: createDefaultOnRetry('stagecoach.generateCommitMessage', getCommitRetryMax()) }
        );
        formattedMessage = formatCommitMessage(generated);
      } catch (genError) {
        // PRD §5.1 last-resort fallback: generation failed after all retries.
        // The index is still staged (gitAdd ran before generation), so commit the
        // substance with a labeled placeholder so it's never stranded. LLM-API
        // failures have no subprocess exit code → sentinel 0 (see buildFallbackCommitMessage).
        logger().warn(
          `Commit-message generation failed after retries; falling back to placeholder commit: ${toErrorMessage(genError)}`
        );
        formattedMessage = formatCommitMessage(buildFallbackCommitMessage(genError));
      }
  - PRESERVE: everything AFTER this block — the `await gitCommit({ path: repoRoot,
    message: formattedMessage })` call, the commitResult.success check, the
    `logger().info('Commit created: ...')`, the `return commitHash`. These are now
    SHARED by both the happy path and the fallback (single gitCommit call site).
  - PRESERVE: the default path (`else formattedMessage = formatCommitMessage(message)`)
    — byte-identical. PRESERVE: the outer try/catch (only unexpected throws reach it now).
    PRESERVE: S1's retry options object — do NOT change maxAttempts/baseDelay/etc.
  - UPDATE the smartCommit JSDoc: in the "Stagecoach path" description + "Error Handling"
    bullets, note that exhausted retries now trigger a fallback placeholder commit
    (PRD §5.1) instead of returning null. Reference buildFallbackCommitMessage.
  - GOTCHA: the catch variable `genError` is `unknown` (TS strict). buildFallbackCommitMessage
    + toErrorMessage both accept `unknown` — no cast needed.
  - GOTCHA: do NOT rethrow from the catch. Flow must continue to gitCommit. Rethrowing
    would hit the outer catch → null (defeating the fallback).

Task 3: MODIFY tests/unit/utils/git-commit.test.ts
  - READ the stagecoach section (~lines 839-950) + the makeFakeAgent helper (~line 50) first.
  - UPDATE the existing test 'generateCommitMessage throws → returns null (outer catch)...'
    (rename to 'generateCommitMessage throws after retries → FALLBACK placeholder commit made'):
      * SETUP: vi.stubEnv('COMMIT_RETRY_MAX', '1'); vi.stubEnv('COMMIT_RETRY_DELAY', '1');
        (so retry calls the boundary once, fast). Mock gitStatus/gitAdd/gitDiff to succeed
        (as the happy-path test does). Mock the agent to throw on EVERY call: makeFakeAgent(
        {status:'error', data:null, error:{message:'model overloaded'}}) — generateCommitMessage
        throws AgentError on status:error. Mock gitCommit to return {success:true, commitHash:'fb000'}.
      * EXECUTE: const result = await smartCommit('/project', 'fallback', { generateMessage: true });
      * VERIFY:
          expect(result).toBe('fb000');  // NOT null — fallback commit made
          expect(mockGitCommit).toHaveBeenCalledTimes(1);
          expect(mockGitCommit).toHaveBeenCalledWith({
            path: '/project',
            message: expect.stringMatching(
              /\[PRP Auto\] chore: commit-gen failed \(exit \d+\); fallback commit[\s\S]*Co-Authored-By: Claude/
            ),
          });
          expect(mockLogger.warn).toHaveBeenCalledWith(
            expect.stringMatching(/falling back to placeholder commit/i)
          );
          // The OLD assertion mockLogger.error with /Unexpected error/ is REMOVED — the
          // fallback path does NOT reach the outer catch.
      * afterEach: vi.unstubAllEnvs() (add if S1 didn't already).
  - ADD a new test 'fallback commit: gitCommit ALSO fails → returns null (never-fail-on-commit)':
      * SETUP: vi.stubEnv('COMMIT_RETRY_MAX', '1'); vi.stubEnv('COMMIT_RETRY_DELAY', '1');
        Mock gitStatus/gitAdd/gitDiff to succeed. Mock the agent to throw (status:error).
        Mock gitCommit to return {success:false, error:'disk full'}.
      * EXECUTE: const result = await smartCommit('/project', 'fallback', { generateMessage: true });
      * VERIFY:
          expect(result).toBeNull();  // fallback gitCommit failed → null
          expect(mockGitCommit).toHaveBeenCalledTimes(1);  // the fallback attempt
          expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringMatching(/falling back/i));
          expect(mockLogger.error).toHaveBeenCalledWith(expect.stringMatching(/Git commit failed/i));
          // (the gitCommit-failure path logs error 'Git commit failed: ...' — this is the
          //  EXISTING commitResult.success-check log, unchanged.)
  - ADD (optional, only if coverage demands) a direct test for buildFallbackCommitMessage's
    context.exitCode branch:
      * If buildFallbackCommitMessage is exported: construct `new AgentError('x', {exitCode: 124})`
        and assert buildFallbackCommitMessage returns 'chore: commit-gen failed (exit 124); fallback commit'.
      * If NOT exported: cover it via a smartCommit test where the agent throws and you
        somehow inject context.exitCode — but generateCommitMessage constructs the AgentError
        internally (no exitCode in context), so the context.exitCode branch is ONLY reachable
        if a future error type carries it. RECOMMENDATION: export buildFallbackCommitMessage
        and add a 2-case direct test (sentinel + context.exitCode). This is the cleanest way
        to hit 100% branch coverage on the helper. The export is harmless (it's a pure helper).
  - PRESERVE: the generateCommitMessage boundary tests (~669-836) — UNCHANGED. PRESERVE:
    the happy-path stagecoach test (generation succeeds → no fallback) — UNCHANGED. PRESERVE:
    all default-path tests — UNCHANGED.
  - GOTCHA: the existing 'gitDiff failure → returns null' test (~line 870) is UNCHANGED —
    gitDiff failure returns null BEFORE the inner try/catch (it's the diffResult.success
    guard). Do not touch it.

Task 4: VALIDATE
  - RUN: npx tsc --noEmit -p tsconfig.json
  - RUN: npx eslint src/utils/git-commit.ts
  - RUN: npx prettier --check src/utils/git-commit.ts tests/unit/utils/git-commit.test.ts
  - RUN: npx vitest run tests/unit/utils/git-commit.test.ts -v
  - RUN: npx vitest run --coverage src/utils/git-commit.ts   # CONFIRM 100% on the file
  - RUN: npm run validate   # lint + format:check + typecheck + full unit suite + (coverage if wired)
  - EXPECT: GREEN. If red:
    * coverage < 100% on git-commit.ts → an inner-catch branch is untested. Add the missing test.
    * "isAgentError is not defined" / import error → forgot to import isAgentError (+ toErrorMessage).
    * stale /Unexpected error/ assertion → the throws-test wasn't updated for the fallback.
    * format:check fails → npx prettier --write on the 2 modified files.
```

### Implementation Patterns & Key Details

```typescript
// PATTERN: the refactored stagecoach branch (Task 2). The SINGLE gitCommit call is
//   shared by the happy path and the fallback — formattedMessage is computed in both.
let formattedMessage: string;
if (options?.generateMessage) {
  const diffResult = await gitDiff({ path: repoRoot, staged: true });
  if (!diffResult.success) {
    logger().error(`Git diff (staged) failed: ${diffResult.error}`);
    return null;
  }
  try {
    // Stagecoach generation (S1's retry wrap). Happy path.
    const generated = await retry(
      () => generateCommitMessage(diffResult.diff ?? ''),
      {
        maxAttempts: getCommitRetryMax(),
        baseDelay: getCommitRetryDelayMs(),
        maxDelay: getCommitRetryDelayCapMs(),
        backoffFactor: 2,
        onRetry: createDefaultOnRetry(
          'stagecoach.generateCommitMessage',
          getCommitRetryMax()
        ),
        // isRetryable: OMITTED → defaults to isTransientError (S1's contract)
      }
    );
    formattedMessage = formatCommitMessage(generated);
  } catch (genError) {
    // PRD §5.1 last-resort fallback: generation failed after all retries.
    // Index is still staged → commit the substance with a labeled placeholder.
    logger().warn(
      `Commit-message generation failed after retries; falling back to placeholder commit: ${toErrorMessage(genError)}`
    );
    formattedMessage = formatCommitMessage(buildFallbackCommitMessage(genError));
  }
} else {
  formattedMessage = formatCommitMessage(message);
}

// SHARED commit path (happy + fallback + default all reach here):
const commitResult = await gitCommit({ path: repoRoot, message: formattedMessage });
if (!commitResult.success) {
  logger().error(`Git commit failed: ${commitResult.error}`);
  return null;
}
const commitHash = commitResult.commitHash ?? null;
logger().info(`Commit created: ${commitHash}`);
return commitHash;

// CRITICAL INVARIANTS:
// 1. The inner try/catch wraps ONLY retry(generateCommitMessage). gitDiff runs before it
//    (its failure → null, no fallback). gitCommit runs after it (shared by all paths).
// 2. On exhausted retry, retry() rethrows the last AgentError (NOT a wrapper) → caught here.
// 3. The fallback sets formattedMessage = placeholder and CONTINUES (no rethrow, no early
//    return). The outer try/catch is only for truly unexpected throws.
// 4. The fallback gitCommit uses the SAME call site as the happy path (single commit-result
//    handler + logger().info('Commit created: ...')).
// 5. "exit N" in the placeholder is the sentinel 0 (LLM-API failures have no exit code),
//    unless the caught error carries context.exitCode (future-proofing).
```

### Integration Points

```yaml
UTILITIES:
  - modify: src/utils/git-commit.ts
  - pattern: "wrap S1's retry(generateCommitMessage) call in inner try/catch; on catch → placeholder commit"
  - consumed: gitCommit (src/tools/git-mcp.ts), formatCommitMessage, toErrorMessage, isAgentError, AgentError
  - new helper: buildFallbackCommitMessage(error) — pure string builder
  - new constant: COMMIT_GEN_FALLBACK_EXIT_SENTINEL = 0
  - untouched: retry.ts, errors.ts, generateCommitMessage boundary, default smartCommit path,
    outer try/catch, S1's retry options object, commit-message-agent.ts, constants.ts

NO CONFIG CHANGES:
  - work item: "DOCS: none — no user-facing/config/API surface change"
  - no new constants.ts entries, no .env.example edit, no docs/CONFIGURATION.md edit
  - the placeholder label is a hardcoded module constant, not user-configurable

NO ORCHESTRATOR CHANGES:
  - src/core/task-orchestrator.ts is UNCHANGED (the single smartCommit caller is unaffected —
    it receives a commit hash either way; the fallback is transparent to callers)
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Run after editing git-commit.ts - fix before proceeding
npx tsc --noEmit -p tsconfig.json            # typecheck (catches unknown catch var misuse, missing imports)
npx eslint src/utils/git-commit.ts
npx prettier --check src/utils/git-commit.ts tests/unit/utils/git-commit.test.ts

# Project-wide validation (the canonical gate)
npm run validate

# Expected: Zero errors. If errors exist, READ output and fix before proceeding.
# Common: format:check fails → npx prettier --write on the modified files.
# Common: "isAgentError is not exported" → it IS exported from errors.ts; fix the import path.
```

### Level 2: Unit Tests (Component Validation)

```bash
# Modified git-commit (stagecoach + fallback paths)
npx vitest run tests/unit/utils/git-commit.test.ts -v

# Full utils suite
npx vitest run tests/unit/utils/ -v

# CRITICAL: confirm 100% coverage on git-commit.ts (the project enforces 100% globally)
npx vitest run --coverage src/utils/git-commit.ts

# Expected: All tests pass AND coverage on src/utils/git-commit.ts is 100%.
# If coverage < 100%: an inner-catch branch (fallback succeeds vs fallback gitCommit fails)
#   or a buildFallbackCommitMessage branch (sentinel vs context.exitCode) is untested.
#   Add the missing test (see Task 3).
# CRITICAL for test speed: vi.stubEnv('COMMIT_RETRY_MAX', '1') AND
#   vi.stubEnv('COMMIT_RETRY_DELAY', '1') in EVERY fallback/generation-failure test, so
#   retry does NOT loop (1 attempt) and any incidental sleep is 1ms. Forgetting this makes
#   the test take 10+ seconds (the default backoff) or time out.
```

### Level 3: Integration Testing (System Validation)

```bash
# No service to start — this is a utility-level change. The integration-level validation
# is the existing git-commit.test.ts stagecoach-path tests (which mock git + the agent) +
# the full unit suite via `npm run validate`.

# To manually exercise the fallback (optional, smoke test):
#   set COMMIT_RETRY_MAX=1 COMMIT_RETRY_DELAY=100
#   run a stagecoach smartCommit against a repo with staged changes + a mocked flaky LLM
#   that always errors. Confirm it makes a commit with message matching
#   '[PRP Auto] chore: commit-gen failed (exit 0); fallback commit' and returns the hash.

# Expected: the fallback commit is created; `git log -1 --format=%s` shows the placeholder;
#   the substance (staged files) is in the commit.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# (This task has no web/Docker/DB/performance surface — it's a fallback-commit branch over
#  an existing LLM call + git commit. The domain-specific validation is the unit test
#  asserting fallback behavior: gen-exhaustion → fallback commit made with placeholder;
#  fallback gitCommit failure → null; warn log emitted; default + happy paths unchanged.)

# Optional: assert the placeholder matches the PRD §5.1 example shape exactly:
#   'chore: commit-gen failed (exit N); fallback commit' (N = 0 sentinel in tests).
#   The test regex /\[PRP Auto\] chore: commit-gen failed \(exit \d+\); fallback commit/
#   encodes this contract.
```

---

## Final Validation Checklist

### Technical Validation

- [ ] All 4 validation levels completed successfully
- [ ] `npm run validate` GREEN (lint + format:check + typecheck + test:run)
- [ ] No linting errors: `npx eslint src/utils/git-commit.ts`
- [ ] No type errors: `npx tsc --noEmit -p tsconfig.json`
- [ ] No formatting issues: `npx prettier --check` on modified files
- [ ] **100% coverage on `src/utils/git-commit.ts`**: `npx vitest run --coverage src/utils/git-commit.ts`

### Feature Validation

- [ ] `COMMIT_GEN_FALLBACK_EXIT_SENTINEL = 0` constant exists with the LLM-API-no-exit-code JSDoc
- [ ] `buildFallbackCommitMessage(error)` helper exists, returns the PRD §5.1 placeholder shape
- [ ] `smartCommit` stagecoach branch wraps S1's retry call in an inner try/catch
- [ ] On exhausted-retry catch: warn log + placeholder commit (single shared gitCommit call)
- [ ] Default path (`generateMessage !== true`) byte-identical — existing tests GREEN
- [ ] Stagecoach happy path (generation succeeds) byte-identical — no fallback fires
- [ ] Updated throws-test asserts fallback commit made (hash + placeholder + warn), NOT null
- [ ] New test: fallback gitCommit fails → returns null (never-fail-on-commit preserved)
- [ ] `gitDiff` failure still → null (unchanged — it's before the inner try/catch)
- [ ] `generateCommitMessage` boundary itself UNCHANGED
- [ ] S1's retry options object UNCHANGED (maxAttempts/baseDelay/maxDelay/onRetry)
- [ ] `src/core/task-orchestrator.ts` UNCHANGED

### Code Quality Validation

- [ ] Fallback reuses the SINGLE existing gitCommit call site (no duplication)
- [ ] Inner catch sets formattedMessage and CONTINUES (no rethrow, no early return)
- [ ] "exit N" uses sentinel 0 (documented reality: no subprocess exit code for LLM-API failure)
- [ ] `toErrorMessage(error)` used for the warn log (robust error extraction)
- [ ] No new dependencies added (`package.json` `dependencies` byte-identical)
- [ ] JSDoc on the new constant + helper + the modified stagecoach branch cites PRD §5.1
- [ ] No new config/docs surface (work item: "DOCS: none")

### Documentation & Deployment

- [ ] Code is self-documenting with clear variable/function names
- [ ] The "exit N" reality is documented in a code comment (so future readers don't hunt for a nonexistent exit code)
- [ ] The warn log is informative (names the fallback + includes the error message) for operators

---

## Anti-Patterns to Avoid

- ❌ Don't wrap all of `smartCommit` in the fallback try/catch — that would catch
  gitStatus/gitAdd/gitDiff/gitCommit errors and commit a nonsense placeholder.
  Wrap ONLY S1's `retry(generateCommitMessage)` call.
- ❌ Don't wrap `generateCommitMessage` WITHOUT the retry wrapper — that bypasses
  S1's retry. Wrap the retry call exactly (S1 is a dependency; its wrap already
  exists in the stagecoach branch).
- ❌ Don't add a SECOND `gitCommit` call site for the fallback — compute
  `formattedMessage` in both the try-success and catch-fallback paths, then let
  the SINGLE existing `gitCommit` call handle both. Duplicating the commit-result
  + `logger().info('Commit created: ...')` logic is a maintenance hazard.
- ❌ Don't rethrow from the inner catch — the fallback must CONTINUE to gitCommit.
  Rethrowing hits the outer catch → null (defeating the fallback entirely).
- ❌ Don't invent or regex-parse an exit code from the error message — there is
  NO subprocess exit code for an LLM-API failure. Use the sentinel `0` (or
  `context.exitCode` if a future error type carries it). Document this.
- ❌ Don't change S1's retry options (`maxAttempts`, `baseDelay`, `maxDelay`,
  `onRetry`) — S2 wraps the retry call; it does not modify the retry config.
- ❌ Don't modify `retry.ts`, `errors.ts`, `AgentError`, `generateCommitMessage`,
  `commit-message-agent.ts`, `constants.ts`, or `task-orchestrator.ts`. This
  task touches ONLY `git-commit.ts` + its test.
- ❌ Don't add config/env/docs surface — the work item explicitly says "DOCS:
  none." The placeholder label is a hardcoded module constant.
- ❌ Don't forget the stale `/Unexpected error/` assertion in the throws-test —
  after S2, the fallback path logs a WARN (not error) and does NOT reach the
  outer catch. Update the assertion or the test fails.
- ❌ Don't skip the coverage check — the project ENFORCES 100% on `src/**/*.ts`.
  Both inner-catch branches (fallback succeeds, fallback gitCommit fails) AND
  both `buildFallbackCommitMessage` branches (sentinel, context.exitCode) must
  be exercised or `npm run validate` fails the coverage threshold.