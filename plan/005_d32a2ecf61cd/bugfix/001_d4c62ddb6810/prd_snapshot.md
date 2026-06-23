# Bug Fix Requirements

## Overview

Comprehensive end-to-end validation of Session 005 ("Pipeline Resilience & Self-Healing") was performed against the delta PRD (R1–R4) and the full PRD scope. Testing covered:

- **R1** (Background Research Deadline & Fallback): `RESEARCH_TIMEOUT`, `ResearchQueue.waitForPRP` deadline race, `ResearchTimeoutError`, `researchNow` synchronous fallback, orchestrator wiring. — ✅ Solid, all 50+ research-queue unit tests pass.
- **R2** (Issue-Driven Re-planning Loop): `ISSUE_RETRY_MAX`, tri-state `ExecutionResult`, `issue_feedback.md` capture, stale-PRP deletion, reset-to-Planned, feedback-injected re-research, `ISSUE_RETRY_MAX` boundary. — ✅ Solid, all orchestrator issue-loop tests pass with correct boundary semantics.
- **R3** (Documentation Two-Mode Sync Rule): `TASK_BREAKDOWN_PROMPT` Mode A/B section, `DELTA_PRD_PROMPT` doc-impact declaration, `PRP_BLUEPRINT_PROMPT` DOCS reminder. — ✅ Solid, prompt-content tests pass.
- **R4** (tasks.json Protection & Smart Recovery): git-history primitives, `recoverTasksJson` (PATH A/B/C + Researching preservation), orchestrator per-agent-run wiring. — ✅ Solid, all recovery tests pass against real tmpdir git repos.
- **Mode B doc sync**: README.md resilience blurb, `docs/CONFIGURATION.md` env-var rows, `docs/WORKFLOWS.md` re-planning subsection, `docs/ARCHITECTURE.md` smart-recovery narrative. — ✅ All present and accurate.
- `npm run validate` (lint + format:check + typecheck): ✅ Green (0 errors).

**One Major regression was found** that was introduced by a commit on the current HEAD (`4e6d2ef` — "Add task CLI subcommand and delta execution mode") **after** the R1–R4 work landed. It is NOT a defect in the resilience features themselves, but it breaks the test suite that the resilience PRD's Progressive Validation gates depend on, and it is simple to fix. It is reported here because it is an actionable, confirmed regression present in the codebase under test.

---

## Critical Issues (Must Fix)

None.

---

## Major Issues (Should Fix)

### Issue 1: `process.setMaxListeners(30)` in `logger.ts` breaks 14 progress-display tests (test-suite regression)

**Severity**: Major

**PRD Reference**: PRD §6.3 (Progressive Validation — Level 2 Unit Test) and §5.2 (agent tooling/observability layer). The test suite is part of the pipeline's validation contract; this regression makes `npm run test:run` unreliable.

**Root cause**: Commit `4e6d2ef` ("Add task CLI subcommand and delta execution mode") added the following to `src/utils/logger.ts` (inside `getLogger`, ~line 448):

```ts
// Prevent MaxListenersExceededWarning from pino transport workers
// Each transport worker attaches an exit listener to process
if (!loggerCache.size) {
  process.setMaxListeners(30);
}
```

`process.setMaxListeners` is **inherited** from `EventEmitter.prototype`, not an own property of `process`:

```
$ node -e "console.log(process.hasOwnProperty('setMaxListeners'))"
false
```

Several unit tests stub the `process` global via `vi.stubGlobal('process', { ...originalProcess, stdout: {...}, on: vi.fn(), off: vi.fn() })` (see `tests/unit/utils/progress-display.test.ts:174` et al.). Because object spread (`...originalProcess`) only copies **enumerable own** properties, the inherited `setMaxListeners` is not carried into the stub. When any code path triggers `getLogger()` under the stub (e.g. constructing a `ProgressDisplay`), the unguarded `process.setMaxListeners(30)` throws:

```
TypeError: process.setMaxListeners is not a function
 ❯ Module.getLogger src/utils/logger.ts:448:13
```

**Expected Behavior**: `npm run test:run` for `tests/unit/utils/progress-display.test.ts` passes all 44 tests (this was the state at `b03ed87`, immediately before Session 005).

**Actual Behavior**: 14 of 44 tests fail with `TypeError: process.setMaxListeners is not a function`:

```
Tests  14 failed | 30 passed (44)
```

Failing tests (all in `tests/unit/utils/progress-display.test.ts`):
- `ProgressDisplay constructor > should accept default options`
- `ProgressDisplay constructor > should accept custom updateInterval option`
- `ProgressDisplay constructor > should accept custom showLogs option`
- `ProgressDisplay constructor > should accept custom logCount option`
- `ProgressDisplay constructor > should accept all custom options together`
- `ProgressDisplay constructor > should disable display in non-TTY with auto mode`
- `ProgressDisplay constructor > should enable display in TTY with auto mode`
- `ProgressDisplay constructor > should disable display with never mode`
- `ProgressDisplay constructor > should enable display with always mode`
- `isEnabled() > should return false when mode is never`
- `isEnabled() > should return false when mode is auto and not TTY`
- `isEnabled() > should return true when mode is auto and TTY`
- `isEnabled() > should return true when mode is always`
- `start() > should log debug message when started`

**Steps to Reproduce**:

1. `cd /home/dustin/projects/hacky-hack`
2. `npm run test:run -- tests/unit/utils/progress-display.test.ts`
3. Observe 14 failures, all with `TypeError: process.setMaxListeners is not a function`.

**Confirmation that this is a regression introduced during Session 005's history**:

```
# At b03ed87 (parent of first Session-005 commit):
Test Files  1 passed (1)
Tests  44 passed (44)

# At current HEAD (4e6d2ef):
Test Files  1 failed (1)
Tests  14 failed | 30 passed (44)
```

`git blame` / `git log -p` confirms the offending 6 lines were added in `4e6d2ef`:

```diff
+  // Prevent MaxListenersExceededWarning from pino transport workers
+  // Each transport worker attaches an exit listener to process
+  if (!loggerCache.size) {
+    process.setMaxListeners(30);
+  }
```

**Impact**:

- `npm run test:run` is part of every resilience subtask's validation gate ("pass `npm run validate` + `npm run test:run`"). A broken test suite undermines the reliability of that gate for all future work.
- It muddies CI signal: future regressions in `ProgressDisplay` (or anything downstream of `getLogger` under a stubbed `process`) would be masked by these 14 pre-existing failures.
- It does **not** affect production: in a real Node.js runtime `process.setMaxListeners` is always defined. The defect is purely a test-environment hardening gap.

**Suggested Fix**:

Use optional chaining so the call is a no-op when `setMaxListeners` is absent (e.g. under a partial `process` stub). In `src/utils/logger.ts`:

```ts
// Prevent MaxListenersExceededWarning from pino transport workers.
// Optional chaining keeps this safe in tests that stub `process` with a
// partial mock (setMaxListeners is inherited, not an own property, so the
// stub may omit it).
if (!loggerCache.size) {
  process.setMaxListeners?.(30);
}
```

This is a one-character change (`?.`) that restores all 14 tests to passing while preserving the production behavior (the listener cap is still raised on the real `process` global).

Optionally, also add a regression test in `tests/unit/utils/logger.test.ts` that constructs a logger under a `process` stub lacking `setMaxListeners` and asserts no throw — so this does not regress again.

---

## Minor Issues (Nice to Fix)

### Issue 2: `npm run validate` does not include `test:run`, so the regression above was not caught at commit time

**Severity**: Minor

**PRD Reference**: PRD §6.3 (Progressive Validation gates).

**Expected Behavior**: The `validate` script should be sufficient to catch test regressions introduced by a commit.

**Actual Behavior**: `package.json` defines `"validate": "npm run lint && npm run format:check && npm run typecheck"` — it does **not** run `test:run`. The individual resilience subtasks all explicitly require "pass `npm run validate` + `npm run test:run`", but the convenience `validate` script alone would have given commit `4e6d2ef` a false-green signal.

**Steps to Reproduce**: `npm run validate` exits 0 despite 14 broken tests.

**Suggested Fix**: Either (a) add `&& npm run test:run` to the `validate` script, or (b) document explicitly in `CONTRIBUTING.md` / `docs/TESTING.md` that `validate` is a static-only gate and `test:run` must be run separately before committing. Option (a) is preferred so the gate is self-contained.

---

### Issue 3: No integration tests for the resilience features (R1–R4)

**Severity**: Minor

**PRD Reference**: PRD §4.2 (deadline fallback), §4.5 (issue re-planning), §5.1 (smart recovery).

**Expected Behavior**: The end-to-end flows (deadline → synchronous fallback → execution; issue → feedback → re-research → re-execute → complete; agent corrupts tasks.json → orchestrator recovers → continues) should be covered by at least one integration test that exercises the real `TaskOrchestrator` + `ResearchQueue` + `PRPRuntime` + disk/git together.

**Actual Behavior**: All R1–R4 coverage is unit-level with heavy mocking (the orchestrator tests stub `prpRuntime`, `researchQueue`, `recoverTasksJson`, `smartCommit`). There are no tests in `tests/integration/` that reference `RESEARCH_TIMEOUT`, `ISSUE_RETRY_MAX`, `recoverTasksJson`, `ResearchTimeoutError`, `issue_feedback`, `researchNow`, or `deletePRP`:

```
$ grep -rln "RESEARCH_TIMEOUT|ISSUE_RETRY_MAX|recoverTasksJson|ResearchTimeoutError|issue_feedback|researchNow|deletePRP" tests/
tests/unit/config/issue-retry-max.test.ts
tests/unit/config/research-timeout.test.ts
tests/unit/core/research-queue.test.ts
tests/unit/core/task-orchestrator.test.ts
tests/unit/core/tasks-json-recovery.test.ts
tests/unit/agents/prompts/prp-blueprint-prompt.test.ts
```

The unit tests are thorough and well-structured (e.g. `tasks-json-recovery.test.ts` uses real tmpdir git repos), so this is a coverage-gap observation rather than a defect. But the integration seams (orchestrator ↔ recovery ↔ sessionManager's `#pendingUpdates`/`flushUpdates`; orchestrator ↔ researchQueue abandonment ↔ `researchNow`) are only exercised through mocks, which is where the real-world failure modes would surface.

**Suggested Fix**: Add 2–3 integration tests under `tests/integration/core/`:
1. Deadline fallback end-to-end: stub `prpGenerator.generate` to exceed a tiny `RESEARCH_TIMEOUT`, assert the orchestrator falls back to inline research and completes.
2. Issue re-plan end-to-end: stub the coder to return `issue` once then `success`, assert `issue_feedback.md` is written, PRP is deleted and regenerated, and the item ends `Complete`.
3. Smart recovery end-to-end: run a real subtask against a tmpdir session with a real git repo, corrupt `tasks.json` mid-run via the coder stub, assert recovery restores from git and the run continues.

---

## Testing Summary

- **Total tests performed (this hunt)**: ~30 distinct investigations across the four PRD requirements plus the surrounding commits.
- **Passing**: All 244 resilience-specific unit tests (R1–R4) pass. `npm run validate` is green.
- **Failing**: 14 tests in `tests/unit/utils/progress-display.test.ts` (Major regression, Issue 1). This is the only actionable defect introduced during Session 005's commit history.
- **Areas with good coverage**:
  - R1 research-deadline semantics (race, abandonment, dedup of late results, synchronous fallback) — excellent unit coverage in `tests/unit/core/research-queue.test.ts`.
  - R2 issue-re-planning boundary (`ISSUE_RETRY_MAX` exact boundary, tri-state routing, feedback file write, PRP deletion, fail-vs-issue distinction) — excellent unit coverage in `tests/unit/core/task-orchestrator.test.ts`.
  - R4 smart recovery (PATH A clean-disk, PATH B git-restore + Researching preservation, PATH C non-fatal) — excellent unit coverage in `tests/unit/core/tasks-json-recovery.test.ts` using real tmpdir git repos.
  - R3 prompt-content assertions for the two-mode doc-sync rule and delta doc-impact declaration.
  - Mode B cross-cutting docs (README, CONFIGURATION, WORKFLOWS, ARCHITECTURE) — all present and internally consistent.
- **Areas needing more attention**:
  - Integration test coverage for R1–R4 end-to-end flows (Issue 3).
  - Commit-time validation gate that includes the test suite (Issue 2).
  - Guarding `process.*` calls against partial-mock test environments (Issue 1).
