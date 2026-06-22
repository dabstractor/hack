# Implementation Notes & Gotchas — Session 005

Critical subtleties PRP implementation agents must internalize. Read alongside
`system_context.md` and `delta_impact.md`.

## 1. Config pattern — constants-declare + consumer-read (NO ConfigService)

Session 004 added `PRP_AGENT_HARNESS` as:
```ts
// src/config/constants.ts
export const PRP_AGENT_HARNESS = 'PRP_AGENT_HARNESS';
export const DEFAULT_HARNESS = 'pi' as const;
// consumed in src/config/harness.ts: const raw = process.env[PRP_AGENT_HARNESS] ?? DEFAULT_HARNESS;
```
`RESEARCH_TIMEOUT` and `ISSUE_RETRY_MAX` must follow the **exact same pattern**:
```ts
export const RESEARCH_TIMEOUT = 'RESEARCH_TIMEOUT';
export const DEFAULT_RESEARCH_TIMEOUT_SECONDS = 300;
export const ISSUE_RETRY_MAX = 'ISSUE_RETRY_MAX';
export const DEFAULT_ISSUE_RETRY_MAX = 3;
```
Then read `process.env[RESEARCH_TIMEOUT]` at the consumer. **Do not** invent a `ConfigService`
or add normalization to `configureEnvironment()`.

## 2. `ExecutionResult` already half-supports `issue` — don't re-parse

`src/agents/prp-executor.ts`:
- **Internal** `interface ExecuteResult { result: 'error' | 'success' | 'issue'; message: string }`
  (line ~147) — the coder JSON parser ALREADY produces the tri-state.
- **Public** `ExecutionResult` (line ~67) only has `success: boolean`.
- Line ~309: `if (coderResult.result !== 'success')` collapses BOTH `error` and `issue` into
  `{ success: false }`.

**The fix is to stop collapsing:** branch on `coderResult.result === 'issue'` and surface a
distinct `outcome: 'issue'` (+ `issueMessage`) on the public `ExecutionResult`. Do NOT touch
the internal `ExecuteResult` parsing — it already works.

## 3. `ISSUE_RETRY_MAX` ≠ `TaskRetryManager.maxAttempts` (different retry dimensions)

- `TaskRetryManager` (`src/core/task-retry-manager.ts`): retries **transient infra errors**
  (API timeout, network) with exponential backoff, gated by `maxAttempts` (default 3). It wraps
  a single `executeFn`. This is the **fix-and-retry path** for hard `fail` outcomes.
- `ISSUE_RETRY_MAX`: bounds **re-planning** attempts (PRP gap → re-research with feedback). This
  is an **orchestrator-level** counter, separate from the executor/retry-manager. Do NOT reuse
  `TaskRetryManager` for it — add a per-item counter in the orchestrator's issue-handling flow.

## 4. `waitForPRP` hangs forever today — adding the deadline needs an abandonment state

`ResearchQueue.waitForPRP(taskId)` awaits the in-flight promise from `researching` Map directly.
Adding a `RESEARCH_TIMEOUT` deadline means:
- Wrap the await in `Promise.race([promise, timeout])`.
- On timeout, the original in-flight promise is **abandoned** (do NOT cancel — promises can't be
  cancelled; just stop waiting). Mark the queue's tracking so the orchestrator can distinguish
  "still running" from "timed out".
- The orchestrator then re-researches **synchronously, inline** (call `prpGenerator.generate`
  directly and await it). The abandoned background result, if it ever lands, should be ignored
  for that taskId (dedup via the `results` Map keyed by taskId).

## 5. NO git file-history utilities exist — R4 builds them from scratch

`src/tools/git-mcp.ts` only implements `gitStatus`/`gitDiff`/`gitAdd`/`gitCommit` (wrapping
`simple-git`). There is **no** `gitLog`/`gitShow`/`gitRestore`. R4 must add functions using
`simple-git`'s `.log({ file })`, `.show(commit:path)`, and a raw `git show <commit>:<path>`
blob-fetch to read prior versions of `tasks.json` and restore the last valid one. Keep the
existing module's patterns (async, return typed objects, throw on non-zero exit).

## 6. `refreshBacklog()` re-reads in-memory, NOT disk

`TaskOrchestrator.refreshBacklog()` sets `#backlog = sessionManager.currentSession.taskRegistry`
(an in-memory snapshot). For R4 smart recovery (re-read the **disk** `tasks.json` after an agent
run, since the agent may have corrupted it), you must read from disk via `readTasksJSON(path)`
from `src/core/session-utils.ts`, not rely on `refreshBacklog()`.

## 7. Test fragility — update tests in the SAME subtask as the code (implicit TDD)

`tests/unit/agents/prp-executor.test.ts` and `prp-runtime.test.ts` assert
`result.success === true/false`. Extending `ExecutionResult` to a tri-state will break these
assertions. Per implicit-TDD, the subtask that extends the type MUST update the consuming tests
in the same commit so the suite stays green. Same for any orchestrator test asserting the
`Complete`/`Failed` dichotomy when the `issue` branch lands.

## 8. `issue_feedback.md` is implicitly protected — do NOT edit the Protected Files list

The catch-all rule ("Any file directly in `$SESSION_DIR/` root") already covers it. Adding it
to `PROTECTED_FILES` in `git-commit.ts` is unnecessary and out of scope (would touch the
protected-file rules, which the delta says are unchanged).

## 9. Doc-sync is two-mode — every subtask declares its DOCS line

Per R3 (which this very session introduces), each implementing subtask's `context_scope` carries
a `DOCS:` line (Mode A = update the specific doc it touches, in the same subtask). The cross-cutting
overview docs (`README.md`, `docs/WORKFLOWS.md`) are Mode B — a **final task** depending on all
implementing subtasks (P5.M3.T1). Do not create per-feature doc subtasks; they ride with the work.

## 10. Validation gates (run after every subtask)

```
npm run validate      # eslint + prettier --check + tsc --noEmit
npm run test:run      # vitest run
```
Both must be green before a subtask is marked Complete.

## 11. Groundswell is read-only / yalc-linked

`package.json`: `"groundswell": "file:.yalc/groundswell"`. Do NOT edit
`~/projects/groundswell/src`. If an export seems missing, re-verify against the built `dist/`.
This session does NOT require any new Groundswell exports — all targets are hacky-hack source.
