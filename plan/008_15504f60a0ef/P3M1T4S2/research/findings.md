# P3.M1.T4.S2 Research Findings — Last-resort fallback placeholder commit

## 1. Contract from P3.M1.T4.S1 (the dependency)

S1 wraps `generateCommitMessage(diff)` in `retry(() => generateCommitMessage(diff), { maxAttempts: getCommitRetryMax(), ... })`
INSIDE `smartCommit`'s stagecoach branch (`src/utils/git-commit.ts` ~line 285-300). On exhausted retries:

- `retry()` does **`throw lastError`** at `src/utils/retry.ts:550` — it rethrows the
  LAST underlying error DIRECTLY (the original `AgentError`), NOT a wrapper/AggregateError.
- So the catch in the fallback receives the ORIGINAL `AgentError` (code = PIPELINE_AGENT_LLM_FAILED,
  classified transient by `isTransientError`).
- S1 leaves the exhausted-retry outcome as: the throw propagates to `smartCommit`'s OUTER
  try/catch → `null` return. **S2 must intercept BEFORE the outer catch / null return** to
  perform the fallback commit. The cleanest hook is an INNER try/catch around the
  retry-wrapped call, inside the stagecoach branch.

## 2. The "exit N" question — NO real subprocess exit code exists

PRD §5.1 + work item say the placeholder is `'chore: commit-gen failed (exit N); fallback commit'
where N is the last exit code`. Reality check:

- `AgentError` (`src/utils/errors.ts`) has **NO `exitCode` field**. It hardcodes
  `code = PIPELINE_AGENT_LLM_FAILED` and carries an optional `context` object.
- `generateCommitMessage` throws `AgentError` with messages like
  `'stagecoach commit-message generation failed: empty staged diff'`,
  `'...failed: <agent error msg>'`, `'...failed: empty agent output'`. NONE carry an exit code.
- The stagecoach boundary is a **pure LLM API call** (Groundswell agent.prompt), not a subprocess.
  A transient LLM-API failure (429/504/timeout) has no OS exit code. The "exit N" language in
  the PRD is a placeholder label borrowed from the subprocess-timeout framing, but it does not
  map to a real value here.

**Resolution**: The honest, defensible value for N is a sentinel. AgentError does NOT expose
an exit code, so we CANNOT faithfully populate "exit N". Options considered:
  (a) `0` — sentinel meaning "no subprocess exit code (LLM API failure)". Defensible: 0 is
      conventionally "success" but here it signals "not applicable".
  (b) Use AgentError's `context.attempt` if the retry layer attached it — but `retry()`'s
      `onRetry` callback receives the attempt but does NOT mutate the error's context, so
      `context.attempt` is undefined on the rethrown error.
  (c) Extract a numeric code from the error MESSAGE via regex — fragile, brittle.

**Decision for the PRP**: Use a sentinel `0` with a clear comment explaining the LLM-API
failure has no subprocess exit code. This is the only honest choice. The PRP documents this
explicitly so the implementing agent does not hunt for a nonexistent exit code. If the
caught error happens to carry `context?.exitCode` (future-proofing, e.g. if P3.M2.T2 adds
exit-124 AgentErrors), use that value; else `0`.

This satisfies PRD §5.1's intent ("clearly-labeled placeholder message … so the substance
is preserved and can be reworded later") — the label is what matters, not a precise N.

## 3. gitCommit can commit the already-staged index — CONFIRMED

`gitCommit({path, message, allowEmpty?})` in `src/tools/git-mcp.ts` calls
`simpleGit(safePath).commit(message, [], options)`. It commits WHATEVER IS STAGED. In the
stagecoach branch, `gitAdd` already succeeded (the filtered set is staged) BEFORE generation
runs. So when generation fails after retries, **the index is still staged** — `gitCommit`
with the placeholder message will commit the substance. This is exactly the PRD §5.1
requirement: "the staged work MUST NOT be stranded uncommitted."

`gitCommit` returns `{success, commitHash?, error?}`. On success → return `commitHash`.
On failure → return `null` (preserve the never-fail-on-commit contract; smartCommit's outer
catch is not even reached because the fallback is inside the stagecoach branch).

## 4. formatCommitMessage is the correct wrapper

`formatCommitMessage(message)` → `[PRP Auto] ${message}\n\nCo-Authored-By: Claude <noreply@anthropic.com>`.
So the final commit message becomes:
`[PRP Auto] chore: commit-gen failed (exit 0); fallback commit\n\nCo-Authored-By: ...`
This matches the existing commit format (the happy path also wraps via formatCommitMessage).

## 5. Existing test that S2 changes

`tests/unit/utils/git-commit.test.ts` has the test:
`'generateCommitMessage throws → returns null (outer catch), error logged, gitCommit never called'`
(~line 911 in the S1-modified file; currently asserts `result === null`, `mockGitCommit` not called,
`mockLogger.error` called with `/Unexpected error/`).

**S2 CHANGES this test's contract**: after retries are exhausted, smartCommit now performs a
FALLBACK COMMIT instead of returning null. The test must be updated to assert:
- `result` is the fallback commit hash (e.g. `'fb000'`), NOT null.
- `mockGitCommit` IS called — once, with the placeholder message.
- The placeholder message matches `/chore: commit-gen failed \(exit \d+\); fallback commit/`.
- A `warn` log indicates the fallback fired (so operators can find/reword these commits).

## 6. Coverage gate — 100% enforced

`vitest.config.ts` enforces 100% statements/branches/functions/lines on `src/**/*.ts`. Every
new branch in `smartCommit` (the fallback try/catch) MUST be exercised by a test:
- Inner catch path → fallback commit succeeds (returns hash).
- Inner catch path → fallback gitCommit ALSO fails (returns null).
- Both must be tested or coverage fails. (The happy-path retry-succeeds and default-path
  branches are already covered by S1/existing tests.)

## 7. No new config / docs surface (per work item)

Work item: "DOCS: none — no user-facing/config/API surface change." So NO new constants,
NO `.env.example` edit, NO `docs/CONFIGURATION.md` edit. The placeholder label is a hardcoded
constant inside `git-commit.ts` (not user-configurable). This keeps S2 minimal and focused.

## 8. Dependency ordering / cohesion

- S2 strictly DEPENDS on S1 (the retry wrap must exist for S2 to wrap it).
- S2 does NOT touch: `src/utils/retry.ts`, `src/utils/errors.ts`, `src/agents/commit-message-agent.ts`,
  `src/config/constants.ts`, `src/core/task-orchestrator.ts`, the default `smartCommit` path,
  or `generateCommitMessage` itself.
- S2's only production edit is `src/utils/git-commit.ts` (the stagecoach branch) + the test file.
- P3.M1.T4 is COMPLETE after S2 (the milestone's two subtasks are done).