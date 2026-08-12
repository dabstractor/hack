# System Context — Bugfix 001 (Validation Abort + Stale Tests)

## Project
`hacky-hack` — Autonomous PRP Development Pipeline. TypeScript (Node ≥20, ESM).
Build: `npm run build` (tsc). Test: `npx vitest run`. Lint/validate gate: `npm run validate`.

## Current Suite State
`npx vitest run` → **9 failed | 7319 passed | 71 skipped** across 4 files.
- 1 failure = BUG-001 (genuine product defect).
- 8 failures = BUG-002 (stale tests, not product defects).

## Relevant Source Architecture

### PRPPipeline (`src/workflows/prp-pipeline.ts`)
The top-level orchestrator. `run()` executes the backlog, then:
1. `await this.#runValidation()` — **line 2935**, BEFORE `runQACycle()`, deliberately NOT inside `runQACycle()`'s try/catch so a thrown `ValidationFailedError` propagates unconditionally into `run()`'s catch.
2. `await this.runQACycle()` — **line 2937** — bug-hunt + fix-cycle.
3. `this.setStatus('completed')` + Smart Commit.

`run()`'s catch block (line ~2976) returns `{ success: false, error: errorMessage, ... }`.
`runQACycle()`'s internal catch uses `isFatalError(error, this.#continueOnError)` — which returns `false` for ALL errors when `#continueOnError === true`, swallowing them. This is WHY `#runValidation()` must live in `run()`, outside that catch.

`#continueOnError` (field declared line 282, set line 436 from constructor arg 5, default `false`) is used legitimately at MANY task-level sites (lines 671, 783, 843, 1250, 1451, 1714, 1793, 2172, 2250, 2588) to let the run continue past individual task failures. The BUG-001 carve-out (line 1868) is the ONLY place it incorrectly gates a **stage-level** abort.

### ValidationFailedError (`src/workflows/validation-workflow.ts:104`)
Extends `Error`. Constructor takes the failing `ValidationOutcome`, computes `watchdog = outcome.timedOut || outcome.exitCode === 124`, and builds a message:
`"Validation failed — <kind>. Aborting before bug-hunt (PRD §4.4). script=<path>"`.
Read-only fields `timedOut` and `exitCode` let `isWatchdogKillResult()` classify it.

### Format-Nudge Recovery (§4.5.1, `src/agents/prp-executor.ts`)
When `#parseCoderResult` cannot extract a JSON envelope (`{result,message}`) from the coder's response:
- Line 366: logs "no parseable JSON result envelope — sending format nudge".
- Re-prompts the SAME coder agent (bounded `FORMAT_NUDGE_MAX`, default 2).
- Line 385 (terminal): `Coder Agent did not return a parseable JSON result envelope after ${formatNudges} format nudge(s) (PRD §4.5.1). Last response: ...`
- Line 866: the LEGACY message `Failed to parse Coder Agent response: ${response}` — still exists but the format-nudge path (385) is the one reached for a no-envelope response.

### Backlog Schema + Heal (§4.5.1, `src/core/models.ts` + `src/workflows/fix-cycle-workflow.ts`)
`ContextScopeSchema` (models.ts:106) is a strict validator requiring:
- Prefix `CONTRACT DEFINITION:\n`
- Four ordered sections: `1. RESEARCH NOTE:`, `2. INPUT:`, `3. LOGIC:`, `4. OUTPUT:`

`BacklogSchema` (models.ts:797) validates every Subtask's `context_scope` against `ContextScopeSchema` at write time.

`FixCycleWorkflow.runStandardBreakdown()` (fix-cycle-workflow.ts:273) reads the architect's backlog, then calls `#validateAndHealBacklog()` (line 380) which:
1. `BacklogSchema.safeParse(backlog)`.
2. On failure → nudges the architect with the zod issues via `retryAgentPrompt` (bounded `FORMAT_NUDGE_MAX`).
3. On exhaustion → `#healContextScopes(backlog)` rebuilds each `context_scope` + `writeTasksJSON(...)`.

So a fixture with a weak `context_scope` (e.g. `'fix'`) triggers extra `retryAgentPrompt` + `writeTasksJSON` calls and mutates the backlog — breaking exact-count/equality assertions.

### Smart Commit Staging (§5.1, `src/utils/git-commit.ts`)
`smartCommit()` stages via **pathspec** to avoid ARG_MAX overflow:
- Line 827: `gitAdd({ path: repoRoot })` — **no `files` key** → `git add .`/`-A`.
- Lines 833-844: unstages protected files via `gitUnstagePath(excluded, repoRoot)`.

The OLD pattern was per-file: `gitAdd({ path, files: [...] })`. Tests asserting the old per-file `files:[...]` shape are now stale.

## PRD References
- **§4.4** (`spec/04-workflows.md:63`): "Abort-on-failure: If validation does not finish (non-zero exit), the run MUST abort _before_ cleanup, commit, and bug-hunt. Proceeding on a half-validated build is forbidden. (A watchdog-killed validation is a hard failure, never retried — see §9.3.2.)"
- **§4.5.1** (`spec/04-workflows.md`): format-nudge recovery + backlog-heal (see above).
- **§5.1** (`spec/17-commit-tool-safety.md`): ARG_MAX-safe pathspec staging.