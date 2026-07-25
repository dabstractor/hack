# Bug Fix Requirements

## Overview

Creative end-to-end QA validation of the Phase 1–5 implementation against the
PRD. Testing combined direct functional exercise of each implemented feature
(include resolver, provider-neutral config, selective section extraction,
tasks.json file-lock concurrency, change classifier protective defaults,
NO_ISSUES_FOUND marker, two-phase commit, adopt mode, validation abort-on-
failure, resume-interrupted-bugfix), CLI smoke tests, the full unit/integration
test suite, and source-level control-flow tracing of the delta and bug-fix
workflows.

Most individually-implemented features (§2.3 include resolution & idempotency,
§9.2.8 provider-neutral config with legacy fallback, §4.2 selective section
extraction, §5.1 flock + atomic tasks.json writes, §4.3 classifier protective
defaults, §9.6 lazy logging / <2s `--help`, §4.6 adopt-mode guard rails) are
correct and behave as specified. However, the **delta (change-management)
workflow has a Critical defect**: the delta-session breakdown that the PRD
mandates ("Breakdown MUST consume the delta PRD") is unreachable in production,
so new requirements added to a PRD are silently dropped. Several supporting
Major and Minor issues were also found.

## Critical Issues (Must Fix)

### Issue 1: Delta-session breakdown is unreachable — `delta_prd.md` is written but never consumed; new requirements are silently dropped

**Severity**: Critical

**PRD Reference**: §4.3 step 5 ("Breakdown MUST consume the delta PRD") and
step 6 ("Identifies new requirements → Adds new tasks"); also defeats the
P4.M1.T3.S1 requirement ("Bind breakdown prompt to delta_prd.md after
generation").

**Expected Behavior**: When the user edits `PRD.md` and a delta session is
created (the default response path, PRD §4.3 steps 3–7), the Architect must run
the **standard task breakdown over `delta_prd.md`** (the diffs) so that newly
*added* requirements are decomposed into new Phase→Milestone→Task→Subtask items.
`delta_prd.md` MUST be the breakdown input, never the full PRD.

**Actual Behavior**: `PRPPipeline.decomposePRD()` (`src/workflows/prp-pipeline.ts`,
~line 1107) has this control flow:

```ts
const backlog = this.sessionManager.currentSession?.taskRegistry;
const hasBacklog = backlog && backlog.backlog.length > 0;
if (hasBacklog) {
  this.logger.info('[PRPPipeline] Existing backlog found, skipping generation');
  this.totalTasks = this.#countTasks();
  this.currentPhase = 'prd_decomposed';
  return;                       // ← early return
}
// ... the `isDelta` branch that calls loadDeltaPRD() is BELOW this guard ...
const isDelta = this.sessionManager.currentSession?.metadata.parentSession != null;
if (isDelta) { prdContent = await loadDeltaPRD(sessionPath); }
```

But `handleDelta()` (the default delta path, same file ~line 1000–1051) **always
pre-populates the delta session with the parent's patched backlog** before
`decomposePRD()` runs:

```
Step 5: const patchedBacklog = patchBacklog(backlog, delta);
Step 6: await this.sessionManager.createDeltaSession(...)
Step 6b: await writeDeltaPRD(...)            // delta_prd.md IS written
Step 7: await this.sessionManager.saveBacklog(patchedBacklog)  // ← non-empty
```

Because the parent session always has tasks, `patchedBacklog` is non-empty, so
`hasBacklog` is **always true** for a delta session. `decomposePRD()` therefore
early-returns and the `isDelta` branch that loads `delta_prd.md` is **dead code
in production**. `delta_prd.md` is written and then never read by the breakdown.

Combined with Issue 2 (the `patchBacklog` `'added'` case is unimplemented), the
net effect is that **any new requirement added to the PRD is silently dropped**
— no new task is ever created for it. Modified requirements are reset to
`Planned` and removed ones to `Obsolete` (so those still work), but added
requirements vanish without trace.

**Steps to Reproduce**:
1. Complete a session against an initial `PRD.md`.
2. Edit `PRD.md` to ADD a brand-new requirement (e.g. a new feature section).
3. Run the pipeline (default mode) so a delta session is created.
4. Observe: `delta_prd.md` is written containing the Added section, but the
   delta session's `tasks.json` contains only the parent's (patched) tasks —
   there is no new task for the added requirement, and the architect agent is
   never invoked ("Existing backlog found, skipping generation" in the logs).
5. The new requirement is never implemented.

**Why the existing test missed it**: `tests/unit/core/delta-prd.test.ts`
`decomposePRD delta branch > CASE A` uses a `makeDeltaSession()` helper that
seeds the delta session with an **empty** backlog (`{ backlog: [] }`). With an
empty backlog `hasBacklog` is false, so the test reaches the `isDelta` branch
and passes — but that empty-backlog precondition never occurs in the real
`handleDelta()` flow, which always saves the non-empty patched parent backlog.
The test therefore validates an unreachable code path and masks the defect.

**Suggested Fix**: Make the delta breakdown actually run. Either:
- In `decomposePRD()`, move the `isDelta`/`loadDeltaPRD()` resolution ABOVE the
  `hasBacklog` early-return (a delta session should always run the breakdown
  over `delta_prd.md` regardless of a pre-existing patched backlog), and merge
  the freshly-decomposed tasks with the patched statuses (modified→Planned,
  removed→Obsolete); OR
- Do not pre-save `patchedBacklog` to the delta session in `handleDelta()` step
  7; instead let `decomposePRD()` build the breakdown from `delta_prd.md` and
  apply the patch (modified/removed) afterward.
Either way, add an integration test that drives the FULL `handleDelta()` →
`decomposePRD()` path with a non-empty parent backlog and asserts the architect
is invoked over `delta_prd.md` and that added requirements produce new tasks.
Implementing Issue 2 (`patchBacklog` `'added'`) is also required for correctness.

## Major Issues (Should Fix)

### Issue 2: `patchBacklog` `'added'` case is unimplemented — new requirements silently dropped

**Severity**: Major

**PRD Reference**: §4.3 step 6 ("Identifies new requirements → Adds new tasks");
also §4.3 step 2 "Integrate into current session" path.

**Expected Behavior**: `patchBacklog()` should generate new tasks for added
requirements (PRD §4.3 step 6 lists "Adds new tasks" as the first patching
action).

**Actual Behavior**: `src/core/task-patcher.ts` (~line 97):

```ts
case 'added':
  // Generate new tasks via Architect agent
  // NOTE: New PRD section content not available in current scope
  // Placeholder: Log warning and continue
  // TODO: Future enhancement - pass new PRD content to Architect
  logger().warn({ changeType: change.type, taskId }, 'Feature not implemented');
  break;   // ← silently drops the added requirement
```

The added change is logged as "Feature not implemented" and discarded. The
caller `PRPPipeline.integrateIntoCurrentSessionResponse()`
(`src/workflows/prp-pipeline.ts` ~line 940) even documents this as a known
"GOTCHA: patchBacklog's 'added' case is unimplemented — added requirements are
silently dropped."

This means the "Integrate into current session" response path (PRD §4.3 step 2)
loses all newly-added requirements. It is also the secondary contributor to
Issue 1 (even if the delta breakdown ran, the patch path would still drop adds).

**Steps to Reproduce**:
1. On an active session, edit `PRD.md` to add a new requirement.
2. Choose "Integrate into current session" when prompted.
3. Observe: the patched `tasks.json` has no new task for the added requirement;
   only a warn-level log line "Feature not implemented" is emitted.

**Suggested Fix**: Implement the `'added'` case to invoke the Architect over the
added PRD section content (available from the `DeltaAnalysis`/`delta_prd.md`)
and insert the resulting tasks into the backlog, or delegate added-requirement
task creation to the delta-PRD breakdown (Issue 1) and have `patchBacklog`
handle only modified/removed. Either way, remove the silent drop.

### Issue 3: Test suite is red (297 failing tests / 38 files); `ContextScopeSchema` over-strict on READ risks session lockout

**Severity**: Major

**PRD Reference**: §6.3 Progressive Validation (Level 2 unit test gate) and §4.4
(validation/abort-on-failure rely on a green test suite); §5.1 "`tasks.json`
Protection & Smart Recovery" (must survive agent corruption, not reject valid
sessions).

**Expected Behavior**: `npm run test:run` (and thus `npm run validate`) should
pass so the PRD §6.3 Level-2 unit-test gate and §4.4 validation are meaningful.
`tasks.json` files created by any legitimate means should load.

**Actual Behavior**:
- `npm run test:run` reports `297 failed | 6306 passed | 70 skipped` across
  `38 failed | 153 passed` files (exit 1). While a portion is test-rot (mock
  fixtures not re-exporting `ResearchTimeoutError`, PRP-generator tests mocking
  the pre-file-contract return path) and a portion is environmental
  (`node_modules/groundswell` is not a valid linked package in this checkout —
  `require('groundswell')` throws "No exports main defined", breaking the
  groundswell-linker and several integration suites), a red suite means the
  project's own validation gate cannot pass.
- A concrete over-strict validation: `ContextScopeSchema`
  (`src/core/models.ts` ~line 110) requires every subtask's `context_scope` to
  start with the literal `CONTRACT DEFINITION:\n`. This is enforced on **READ**
  via `readTasksJSON → BacklogSchema.parse`, so any `tasks.json` whose subtasks
  lack that exact prefix fails to load with `context_scope must start with
  "CONTRACT DEFINITION:"`. This breaks a large cluster of integration tests
  (task-orchestrator*, tasks-json-authority, etc.) whose fixtures use plain
  scope strings, and — more seriously — risks **lockout of hand-edited, legacy,
  or externally-authored sessions** that don't follow the contract format. The
  pipeline produces the format, but rejecting all other valid content on read is
  fragile.

**Steps to Reproduce**:
1. `npm run test:run` → exits 1 with the counts above.
2. For the schema issue: write a `tasks.json` containing a subtask with
   `context_scope: "Implement feature X in src/foo.ts"` and call
   `readTasksJSON()` (or `loadSession`) → throws the CONTRACT DEFINITION error.

**Suggested Fix**: 
- Fix/refresh the rotted test fixtures and mocks (re-export
  `ResearchTimeoutError` from the research-queue mock; update PRP-generator
  tests to the file-as-contract path; align executeBacklog tests with the
  continue-on-error semantics) and restore the groundswell link so integration
  suites run.
- Relax `ContextScopeSchema`: enforce the CONTRACT DEFINITION contract on
  **write** (architect output) but only warn (not reject) on **read**, so
  legacy/manually-edited/externally-authored sessions still load. A read-time
  hard reject on a documentation-format field is too strict for a recovery-
  oriented state file (PRD §5.1).

## Minor Issues (Nice to Fix)

### Issue 4: Bugfix sessions use a flat `bugfix/` directory instead of numbered iterations

**Severity**: Minor

**PRD Reference**: §4.4 step 3 ("Each bug hunt iteration creates a new numbered
session: `bugfix/001_hash/`, `bugfix/002_hash/`, etc.") and §5.1 ("Session
structure: `plan/NNN_hash/bugfix/NNN_hash/`").

**Expected Behavior**: Each bug-hunt iteration that finds bugs should create a
new numbered bugfix session under `bugfix/`, preserving prior iterations for the
audit trail.

**Actual Behavior**: `runQACycle()` creates a single flat directory
`resolve(sessionPath, 'bugfix')` (`src/workflows/prp-pipeline.ts` ~line 1729)
and runs the fix cycle there. `#detectInterruptedBugfix()` correspondingly
checks `sessionPath/bugfix/{TEST_RESULTS.md,tasks.json}`. There is no
`001_hash/`, `002_hash/` numbering, so only one bugfix iteration can exist per
session and prior iterations are overwritten rather than archived. (Note: the
detection and creation paths are mutually consistent, so resume-interrupted-
breakdown still works for this layout — it's the PRD's numbered-iteration
archival behavior that is not implemented.)

**Suggested Fix**: Number bugfix sessions (`bugfix/NNN_hash/`) and have
`#detectInterruptedBugfix()` scan the numbered children; archive rather than
overwrite prior iterations.

### Issue 5: `executeBacklog` swallows "no backlog found" instead of aborting

**Severity**: Minor

**PRD Reference**: §4.2 (execution loop) and §5.1 (state integrity); relates to
the `isFatalError` classification in `src/utils/errors.ts`.

**Expected Behavior**: A session with no backlog is a configuration error that
should abort loudly (several unit tests in
`tests/unit/workflows/prp-pipeline*.test.ts` assert `executeBacklog()` rejects
with "Cannot execute pipeline: no backlog found in session").

**Actual Behavior**: `executeBacklog()` wraps its body in try/catch and only
re-throws when `isFatalError(error, this.#continueOnError)` is true
(`src/workflows/prp-pipeline.ts` ~line 1486). `isFatalError()` returns `false`
for a plain `Error` (only specific `PipelineError` subtypes are fatal), so the
"no backlog found" throw is caught, logged as a warning, tracked, and swallowed
— `executeBacklog()` resolves successfully and the pipeline proceeds to
validation/QA with zero tasks. This is arguably the intended continue-on-error
philosophy, but it silently masks a misconfigured/empty session and contradicts
the test expectations.

**Steps to Reproduce**: Construct a `PRPPipeline` whose session has an empty
`taskRegistry`, call `executeBacklog()` → it resolves (does not throw) despite
the "Cannot execute pipeline: no backlog found in session" branch firing.

**Suggested Fix**: Either make the "no backlog found" error a fatal
`PipelineError` subtype (so it propagates), or update the affected tests to
reflect the swallow-and-continue semantics — but prefer aborting, since running
validation/QA over an empty task set is not useful.

## Testing Summary

- **Total tests performed**: Direct functional tests of ~12 implemented features
  (include resolver idempotency/cycle/max-depth, provider-neutral config
  canonical+legacy resolution, selective section extraction, tasks.json flock
  concurrency under 20 parallel writers, change-classifier protective defaults,
  NO_ISSUES_FOUND marker fields, smart-commit retry+fallback+restore_critical_files,
  adopt-mode guard rails + CLI, validation abort-on-failure wiring, resume-
  interrupted-bugfix detection, prd-status alias, lazy-logging <2s latency);
  full `npm run test:run` (6681 tests); CLI smoke (`--help`/`--version`/invalid
  flag/`task`/`status`/`--adopt-prd` missing-PRD); source control-flow tracing
  of the delta, integrate, and bug-fix workflows.
- **Passing**: Include resolver, provider-neutral config, selective section
  extraction, file-lock serialization, classifier protective defaults,
  NO_ISSUES_FOUND marker, smart-commit resilience, adopt-mode guard rails,
  validation abort-on-failure, config defaults, persona→role mapping,
  lazy-logging latency, prd-status alias — all behave per PRD.
- **Failing**: Delta-session breakdown (Critical, Issue 1); patchBacklog 'added'
  (Major, Issue 2); test-suite red + over-strict read schema (Major, Issue 3);
  flat bugfix dir (Minor, Issue 4); executeBacklog swallow (Minor, Issue 5).
- **Areas with good coverage**: Phase 1 (PRD resolution & selectors), Phase 2
  (model roles & config naming), Phase 3 (concurrency, commit, deletion/crash
  protection), and the individual mechanical layers of Phase 4 are solid.
- **Areas needing more attention**: The **end-to-end delta workflow** (handleDelta
  → createDeltaSession → writeDeltaPRD → decomposePRD) is not covered by a
  realistic integration test — the only delta-breakdown test seeds an empty
  backlog that never occurs in production, masking Issue 1. The
  patchBacklog `'added'` path and the full bug-fix iteration lifecycle also lack
  end-to-end coverage.