# PRP — P1.M4.T3.S2: Fix pipeline-main-loop.test.ts (constructor→run() wiring drift)

> Bugfix 002 · **BUG-004 (MAJOR) — Category (b) test-rot.** `tests/integration/pipeline-main-loop.test.ts`
> is red: **21 failed | 2 passed (23)**. The `PRPPipeline` constructor was refactored to **DEFER**
> `SessionManager`/`TaskOrchestrator` creation into `run()`/`initializeSession()`
> (`prp-pipeline.ts:2751`, `:663`, `:774`), but the tests still assume the constructor does
> everything. **All 21 failures are test-only** — the production code is in-spec (rule 5). Every
> fix here is in `tests/integration/pipeline-main-loop.test.ts`; `git diff --stat -- src/` MUST
> stay empty.

> **Parallel-coordination:** This item is INDEPENDENT of P1.M4.T3.S1 (coder-agent, disjoint file)
> and P1.M4.T3.S3 (qa-agent/researcher-agent/prd-task-command/prp-blueprint-agent/task-breakdown-prompt,
> disjoint files). No file overlap. It does NOT consume `tests/helpers/research-seam.ts`.

> **Empirically validated:** the fix design below was prototyped in a throwaway
> `tests/integration/_pml_validation.test.ts` (same dir → relative imports resolve) covering all 4
> failure categories — **10/10 representative tests passed** — then deleted. `src/` and the
> original test file were verified untouched. See `research/findings.md`.

---

## Goal

**Feature Goal**: Drive `tests/integration/pipeline-main-loop.test.ts` to green (23/23) by
re-aligning every test with the deferred-init contract: call `run()`/`initializeSession()` before
asserting on `sessionManager`/`currentPhase`; inject the orchestrator where it sticks (after init,
or at the class level); complete the `SessionManager` mock; and defensively clear the
`PRP_PIPELINE_RUNNING` env. The 4 tests that encode the pre-Issue-5 failure-swallowing contract are
re-aligned to the current fatal-`OrchestratorError` propagation contract.

**Deliverable** (test-only; NO `src/` changes; ONE file edited in place):
- **EDIT** `tests/integration/pipeline-main-loop.test.ts` —
  (1) add a file-top `vi.mock` for `ValidationWorkflow` so `run()` can complete;
  (2) clear `process.env.PRP_PIPELINE_RUNNING` in `beforeEach`;
  (3) add `hasSessionChanged`/`hasAnySessions` to the `SessionManager` mock;
  (4) for INIT tests — set `sessionManager` + call `initializeSession()` + assert `toHaveBeenCalled()`;
  (5) for EXEC tests — inject `sessionManager` directly;
  (6) for RUN tests — wire the orchestrator via class-level `TaskOrchestrator.mockImplementation`
      (add `rebuildQueue`) instead of instance injection;
  (7) re-align the 4 ROT tests to the Issue-5 OrchestratorError contract.

**Success Definition**:
- `npx vitest run tests/integration/pipeline-main-loop.test.ts` → **0 failed (23/23)**.
- Whole-suite failure count strictly decreases by ~21; no previously-green file newly red.
- `npm run typecheck && npm run lint && npm run format:check` clean on the file.
- `git diff --stat -- src/` is **EMPTY** (rule 5: test-only corrective).

## User Persona (if applicable)

**Target User**: The pipeline maintainer + the §4.4 validation-gate path. End users unaffected.

**Use Case**: "The main-loop integration suite is red (21/23) because the deferred-init refactor
moved SessionManager/TaskOrchestrator creation out of the constructor and the tests never caught
up. Make it green test-only — do NOT change production, do NOT weaken assertions."

**User Journey**:
1. Add the `ValidationWorkflow` module mock + the `PRP_PIPELINE_RUNNING` env clear + mock completeness.
2. INIT tests: drive `initializeSession()`; align the no-arg `initialize()` assertion.
3. EXEC tests: inject `sessionManager` so `executeBacklog()` finds the backlog.
4. RUN tests: move orchestrator wiring to the class level so `run()`'s init uses it.
5. ROT tests: re-align to the current OrchestratorError-propagation contract.
6. Re-run the file → 23/23 green; run the whole suite → failure count drops ~21.

**Pain Points Addressed**: 21 of the suite-wide failures; a misleading 2/23 "pass" that was actually
passing via the run() error path (false positives); and a latent `PRP_PIPELINE_RUNNING` env-leak
false-negative that made run()-tests non-deterministic across run contexts.

## Why

- **Unblocks the §4.4 validate gate (BUG-004).** This file is 21 failures.
- **Corrective, not feature work.** Rule 5 explicitly permits fixing stale-test expectations and
  test-isolation rot without a PRP. No PRD/feature change; no new behavior.
- **Re-aligns, doesn't weaken.** The 4 ROT tests are rewritten to assert the REAL current contract
  (fatal OrchestratorError on `processNextItem` throw — PRD bugfix Issue 5), not deleted or loosened.

## What

Fix all test-only causes across 4 categories:

| # | Category | Tests | Root cause | Fix |
|---|----------|-------|------------|-----|
| 1 | INIT | 3 | constructor no longer inits; `initialize()` is now no-arg | set `sessionManager` + call `initializeSession()`; assert `toHaveBeenCalled()` |
| 2 | EXEC | ~10 | `this.sessionManager` undefined → `executeBacklog()` `:1517` throws | inject `sessionManager` directly |
| 3 | RUN | ~6 | injected orchestrator overwritten by `new TaskOrchestratorClass()` in `initializeSession()`; `rebuildQueue` missing; `#runValidation`/env abort run() | class-level `TaskOrchestrator.mockImplementation` + `rebuildQueue` + `ValidationWorkflow` mock + clear `PRP_PIPELINE_RUNNING` |
| 4 | ROT | 4 | pre-Issue-5 failure-swallowing expectations (dead contract) | re-align to fatal-`OrchestratorError` propagation |

### Success Criteria

- [ ] `pipeline-main-loop.test.ts` passes 0 failed (23/23).
- [ ] No assertion weakened or deleted to force green (the 4 ROT assertions are REPLACED with
      equivalent-or-stronger assertions on the real current-contract behavior).
- [ ] `git diff --stat -- src/` empty; typecheck/lint/format clean on the file.
- [ ] Whole-suite failure count strictly decreases; no previously-green file newly red.

## All Needed Context

### Context Completeness Check

If an implementer knew nothing about this codebase, would they have everything needed? **Yes.**
This PRP states the verified 21/2 baseline, the deferred-init contract with exact `src:line`
citations, the 4 failure categories with their per-test fixes, the two extra mock/env gaps found by
prototyping, the per-category transformation table, and the per-file validation command.

### Documentation & References

```yaml
# MUST READ — this item's own research (validated 4-category map + prototype results)
- docfile: plan/008_15504f60a0ef/bugfix/002_86589b7d57d2/P1M4T3S2/research/findings.md
  why: §"The 4 failure categories"; §"Two additional gaps discovered by empirical prototyping";
       §"Validated fix design" (per-category transformation table); §"Key production facts relied upon".
  section: all sections load-bearing.

# MUST READ — the authoritative BUG-004 category map (names this item's root cause)
- docfile: plan/008_15504f60a0ef/bugfix/002_86589b7d57d2/architecture/bug-004-test-suite.md
  why: Category (b) `pipeline-main-loop.test.ts(21)` entry — confirms the deferred-init root cause
       and the "inject AFTER init or mock at class level" remedy. Confirms test-rot (rule 5 applies).
  section: "Category (b) — Test-rot".

# ── SRC under test (READ-ONLY — do NOT modify) ──
- file: src/workflows/prp-pipeline.ts
  why: constructor (:398) stores prdPath/options only — does NOT create sessionManager/taskOrchestrator.
       run() (:2701) creates sessionManager (:2751) + calls initializeSession() (:~2791) +
       decomposePRD + rebuildQueue (:2824) + executeBacklog + #runValidation (:2851) + runQACycle +
       cleanup (finally). initializeSession() (:627) calls sessionManager.initialize() (:714, NO ARGS)
       + creates taskOrchestrator (:774, OVERWRITES any injection) + sets currentPhase='session_initialized' (:833).
       executeBacklog() (:~1490) HARD-ABORTs (:1517) if no sessionManager.currentSession.taskRegistry;
       wraps processNextItem (:1571 prime, :1736 re-eval) → OrchestratorError (Issue 5); outer catch
       (:1781) rethrows OrchestratorError/MaxIterationsError unconditionally. cleanup() (:2387) ALWAYS
       sets currentPhase='shutdown_complete'. #runValidation (:1833) runs in ALL modes → needs the
       ValidationWorkflow mock.
  gotcha: PRPPipeline extends groundswell `Workflow`; fields sessionManager/taskOrchestrator are
          regular instance fields (not #private) → assignable via `(pipeline as any).sessionManager = …`.

- file: src/core/session-manager.ts
  why: `async initialize(): Promise<SessionState>` (:383) — ZERO parameters (prdPath is passed to the
       SessionManager CONSTRUCTOR in run()). This is why `toHaveBeenCalledWith(prdPath)` is stale.
  gotcha: initializeSession() also calls `hasSessionChanged()` (:785) and `hasAnySessions()` (:695,
          adopt/validate/bug-hunt only). The test mock must define both or initializeSession throws
          non-fatally → currentPhase='session_failed'.

- file: src/utils/validation/execution-guard.ts
  why: validateNestedExecution(sessionPath) reads process.env.PRP_PIPELINE_RUNNING and throws
       NestedExecutionError if it is set (unless SKIP_BUG_FINDING + bugfix path). run() calls it
       (:2772) BEFORE setting the guard. A leaked/genuinely-set env aborts run() → false negatives.
  gotcha: vi.unstubAllEnvs() (in the existing afterEach) only undoes vi.stubEnv values — it does NOT
          clear a genuinely-set env. Must `delete process.env.PRP_PIPELINE_RUNNING` in beforeEach.

- file: src/workflows/validation-workflow.ts
  why: #runValidation() does `new ValidationWorkflow(prdContent, cwd)` then `await workflow.run(sessionPath)`
       and throws ValidationFailedError on `!outcome.success`. Without the module mock, run()'s QA
       agent is the mocked-away createQAAgent → throw → run() failure result.

# ── Test under edit (READ + EDIT) ──
- file: tests/integration/pipeline-main-loop.test.ts
  why: 23 tests across 7 describe blocks. Top-level class mocks already present for TaskOrchestrator,
       SessionManager, agent-factory, prp-runtime, node:fs/promises. Helpers: createMockSessionState,
       createMockBacklog, setupMockSessionManager. Fix touches the mock factory + beforeEach + each test.
  gotcha: `vi.mock('../../src/core/task-orchestrator.js', …)` returns `TaskOrchestrator: vi.fn()`.
          Called with `new` it returns `{}` (empty) — so `initializeSession()`'s `new
          TaskOrchestratorClass(...)` yields a truthy-but-empty object whose `rebuildQueue`/
          `processNextItem` are undefined → run() throws at rebuildQueue (:2824). The RUN-category
          fix sets a real `mockImplementation` per test so the class mock returns the test's orchestrator.

# ── vitest mocking reference ──
- url: https://vitest.dev/guide/mocking.html#hoisting
  why: confirms vi.mock() is hoisted to file top — the existing top-level class mocks are correctly
       placed; the new ValidationWorkflow mock must also be top-level.
```

### Current Codebase tree (the files this item touches + READ-ONLY src)

```bash
tests/integration/pipeline-main-loop.test.ts   # EDIT (mock factory + beforeEach + 23 tests)
src/                                            # READ-ONLY (rule 5: test-only corrective)
  workflows/prp-pipeline.ts                     # READ — constructor/run/initializeSession/executeBacklog/cleanup
  workflows/validation-workflow.ts              # READ — why run() needs the VW mock
  core/session-manager.ts                       # READ — initialize() is no-arg
  utils/validation/execution-guard.ts           # READ — PRP_PIPELINE_RUNNING guard
```

### Desired Codebase tree with files to be added

```bash
# No new files. pipeline-main-loop.test.ts is EDITED in place.
# Research notes at:
#   plan/008_15504f60a0ef/bugfix/002_86589b7d57d2/P1M4T3S2/research/findings.md
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — the constructor does NOT create sessionManager/taskOrchestrator. After
//   `new PRPPipeline(prdPath)`, both are undefined. Any test that calls executeBacklog()/run()/
//   initializeSession() without first ensuring sessionManager exists will throw.

// CRITICAL — `initializeSession()` OVERWRITES `this.taskOrchestrator` via
//   `new TaskOrchestratorClass(...)` (:774). Injecting `(pipeline as any).taskOrchestrator` BEFORE
//   run() is useless for run()-tests. Use class-level `TaskOrchestrator.mockImplementation(() => orch)`
//   so the constructor mock returns YOUR orchestrator. For executeBacklog()-only tests (no init),
//   instance injection still sticks.

// CRITICAL — `SessionManager.initialize()` takes NO args. The old `toHaveBeenCalledWith(prdPath)`
//   assertion is stale; use `toHaveBeenCalled()`.

// CRITICAL — initializeSession() calls `this.sessionManager.hasSessionChanged()` (:785). The mock
//   MUST define it (return false) or initializeSession throws non-fatally → currentPhase='session_failed'.

// CRITICAL — run() calls validateNestedExecution() which throws if process.env.PRP_PIPELINE_RUNNING
//   is set. Clear it in beforeEach (`delete process.env.PRP_PIPELINE_RUNNING`). vi.unstubAllEnvs()
//   in afterEach does NOT clear a genuinely-set env.

// CRITICAL — run()'s #runValidation() runs in ALL modes and constructs ValidationWorkflow. Add a
//   file-top vi.mock for '../../src/workflows/validation-workflow.js' returning
//   { run: async () => ({ success:true, exitCode:0, timedOut:false, durationMs:0 }) } or run()
//   throws → failure result → false negatives.

// CRITICAL — `new (vi.fn())()` returns `{}` (empty, truthy). Without a mockImplementation, the
//   TaskOrchestrator class mock yields an orchestrator whose rebuildQueue/processNextItem are
//   undefined → run() throws at rebuildQueue (:2824).

// CRITICAL — PRD bugfix Issue 5: a processNextItem() throw is wrapped as OrchestratorError and
//   PROPAGATES (outer catch :1781 rethrows it unconditionally). It does NOT reach the inner
//   taskError catch (:1691), so #trackFailure is never called and the loop does NOT continue.
//   Tests that simulate failures via processNextItem throwing must assert THIS contract, not the
//   old swallow-and-continue behavior.

// CRITICAL (all) — NEVER weaken an assertion to force green, and NEVER edit src/ to match a stale
//   test. The 4 ROT assertions are REPLACED with equivalent-or-stronger assertions on the real
//   current-contract behavior (OrchestratorError propagation), not deleted.
```

## Implementation Blueprint

### Data models and structure

No production data models change. The test reuses its existing helpers (`createMockSessionState`,
`createMockBacklog`, `setupMockSessionManager`, the top-level class mocks) — only the mock factory's
return shape and each test's wiring change.

### Implementation Tasks (ordered by dependencies)

```yaml
# ═════════════════ TASK 1 — File-top: ValidationWorkflow mock ═════════════════
Task 1: EDIT tests/integration/pipeline-main-loop.test.ts  (top-level mocks)
  - ADD a new top-level vi.mock (place it alongside the existing agent-factory/prp-runtime mocks):
      vi.mock('../../src/workflows/validation-workflow.js', () => ({
        ValidationWorkflow: vi.fn().mockImplementation(() => ({
          run: vi.fn().mockResolvedValue({ success: true, exitCode: 0, timedOut: false, durationMs: 0 }),
        })),
      }));
    WHY: run()'s #runValidation() (prp-pipeline.ts:1833) runs in ALL modes and constructs
    ValidationWorkflow; without the mock it throws → run() returns a failure result.
  - KEEP all existing top-level mocks (task-orchestrator, session-manager, agent-factory,
    prp-runtime, node:fs/promises) unchanged.

# ═════════════════ TASK 2 — Mock completeness + env clear ═════════════════
Task 2: EDIT tests/integration/pipeline-main-loop.test.ts  (setupMockSessionManager + beforeEach)
  - IN setupMockSessionManager(backlog): ADD two methods to the returned `mock` object so
    initializeSession()'s calls on the mock don't throw:
      hasSessionChanged: vi.fn().mockReturnValue(false),
      hasAnySessions: vi.fn().mockResolvedValue(false),
    (Place them next to the existing initialize/saveBacklog/flushUpdates/updateItemStatus.)
    WHY: initializeSession() calls this.sessionManager.hasSessionChanged() (:785); without it the
    mock throws → non-fatal catch → currentPhase='session_failed' (not 'session_initialized').
  - IN beforeEach (after the existing SessionManager.mockImplementation reset, before vi.clearAllMocks):
      delete process.env.PRP_PIPELINE_RUNNING;
    WHY: run() calls validateNestedExecution() which throws if PRP_PIPELINE_RUNNING is set; the env
    leaks in some run contexts. Defensive clear (no-op in a clean env).

# ═════════════════ TASK 3 — INIT tests (3): drive initializeSession(), align assertion ═════════════════
Task 3: EDIT tests/integration/pipeline-main-loop.test.ts
  Files: 'pipeline initialization from PRD hash' (2 tests) + 'mock session manager behavior' >
         'should use mock SessionManager for deterministic testing' (1 test).
  - In each, AFTER `const pipeline = new PRPPipeline(prdPath);` ADD:
      (pipeline as any).sessionManager = mockSessionManager;
      await pipeline.initializeSession();
    (run()/initializeSession() are the only thing that calls SessionManager.initialize(); the
    constructor no longer does.)
  - CHANGE the assertion:
      OLD: expect(mockSessionManager.initialize).toHaveBeenCalledWith(prdPath);
      NEW: expect(mockSessionManager.initialize).toHaveBeenCalled();
    WHY: SessionManager.initialize() is `async initialize(): Promise<SessionState>` (NO args) —
    prdPath is passed to the SessionManager constructor in run(). This ALIGNS with the contract,
    it does not weaken (0-arg is the real signature).
  - KEEP: `expect(pipeline.currentPhase).toBe('session_initialized');` (now true after initializeSession).

# ═════════════════ TASK 4 — EXEC tests (~10): inject sessionManager directly ═════════════════
Task 4: EDIT tests/integration/pipeline-main-loop.test.ts
  Files (every test whose final action is `await pipeline.executeBacklog();`):
    - 'main execution loop > should log progress every 5 tasks'
    - 'individual task failure handling > should log warning when task fails'  (→ becomes ROT, see Task 6)
    - 'pipeline status transitions > should set backlog_complete after processing all tasks'
    - 'pipeline status transitions > should set shutdown_interrupted on shutdown request'
    - 'loop termination conditions > should terminate when queue is empty'
    - 'loop termination conditions > should terminate on shutdown request'
    - 'loop termination conditions > should terminate on max iterations safety check'
    - 'loop termination conditions > should handle no subtasks gracefully'
    - 'mock orchestrator behavior > should use mock TaskOrchestrator for deterministic testing'
    - 'mock orchestrator behavior > should track currentItemId correctly'
  - In each, AFTER `const pipeline = new PRPPipeline(prdPath);` and BEFORE
    `(pipeline as any).taskOrchestrator = mockOrchestrator;`, ADD:
      (pipeline as any).sessionManager = mockSessionManager;
    (mockSessionManager is already captured from setupMockSessionManager(backlog) in each test.)
    WHY: the constructor no longer creates sessionManager; executeBacklog() (:1517) reads
    this.sessionManager.currentSession?.taskRegistry and HARD-ABORTs if it is undefined.
  - KEEP the existing `(pipeline as any).taskOrchestrator = mockOrchestrator;` injection — it STICKS
    because these tests never call initializeSession()/run() (so the orchestrator is not overwritten).
  - DO NOT change mockOrchestrator's shape (it already has processNextItem + currentItemId, which is
    all executeBacklog reads). rebuildQueue is NOT needed here (only run() calls it).

# ═════════════════ TASK 5 — RUN tests (~6): class-level orchestrator mock + rebuildQueue ═════════════════
Task 5: EDIT tests/integration/pipeline-main-loop.test.ts
  Files (every test whose final action is `await pipeline.run();` — EXCLUDING the ROT tests in Task 6):
    - 'main execution loop > should process tasks until queue empty'
    - 'main execution loop > should update progress metrics during execution'
    - 'progress metrics tracking > should update totalTasks count'
    - 'progress metrics tracking > should update completedTasks count'
    - 'progress metrics tracking > should track progress percentage correctly'
    - 'pipeline status transitions > should transition through expected status states'
    - 'mock session manager behavior > should flush updates before saveBacklog'
  - In each test's mockOrchestrator object, ADD:
      rebuildQueue: vi.fn().mockResolvedValue(undefined),
    WHY: run() calls this.taskOrchestrator.rebuildQueue() at prp-pipeline.ts:2824.
  - REPLACE the instance injection:
      OLD: (pipeline as any).taskOrchestrator = mockOrchestrator;
      NEW: (TaskOrchestrator as any).mockImplementation(() => mockOrchestrator);
    WHY: initializeSession() (called inside run()) OVERWRITES this.taskOrchestrator via
    `new TaskOrchestratorClass(...)`. The instance injection is lost. Wiring at the class level makes
    the constructor mock RETURN your orchestrator, so the overwrite installs YOUR orchestrator.
    (TaskOrchestrator is already imported in beforeAll.)
  - KEEP `const result = await pipeline.run();` and all existing result/currentPhase assertions —
    they now hold for the RIGHT reason (run() completes the real loop). Specifically:
      * processNextItem call counts (4 for 3-task, 6 for 5-task) — prime + N re-evals.
      * result.totalTasks === createMockBacklog arg (decomposePRD skips, #countTasks reads the backlog).
      * pipeline.currentPhase === 'shutdown_complete' (cleanup() always sets it).
  - NOTE: run() now completes end-to-end because: init (SessionManager class mock via
    setupMockSessionManager) → decomposePRD (skips, backlog exists) → rebuildQueue (your mock) →
    executeBacklog (your processNextItem loop) → #runValidation (Task-1 mock → success) → runQACycle
    (skips: mock never marks subtasks Complete → !#allTasksComplete → qa_skipped, no LLM call) →
    cleanup → success result.

# ═════════════════ TASK 6 — ROT tests (4): re-align to Issue-5 OrchestratorError contract ═════════════════
Task 6: EDIT tests/integration/pipeline-main-loop.test.ts
  These 4 tests simulate a task failure via `processNextItem` THROWING and assert the DEAD
  pre-Issue-5 contract (swallow → #trackFailure → continue → failedTasks>0, success=true, warn
  'Task failed, continuing'). Under PRD bugfix Issue 5 a processNextItem throw is wrapped as
  OrchestratorError and PROPAGATES (outer catch :1781 rethrows unconditionally). RE-ALIGN each to
  assert the current contract (validated by prototyping):

  6a. 'individual task failure handling > should track individual task failures'  (RUN path)
      - KEEP the mockOrchestrator that throws on call 2; ADD rebuildQueue; REPLACE instance
        injection with class-level `(TaskOrchestrator as any).mockImplementation(() => mockOrchestrator)`.
      - REPLACE the assertions:
          OLD: expect(mockOrchestrator.processNextItem).toHaveBeenCalledTimes(4);
               expect(result.hasFailures).toBe(true);
               expect(result.failedTasks).toBe(1);
               expect(result.success).toBe(true);
          NEW: // PRD bugfix Issue 5: a processNextItem throw is a fatal OrchestratorError — it
               // propagates out of executeBacklog and surfaces as a run() FAILURE (not a tracked
               // individual-task failure). processNextItem is called twice (prime + the throwing re-eval).
               expect(mockOrchestrator.processNextItem).toHaveBeenCalledTimes(2);
               expect(result.success).toBe(false);
               expect(result.error).toBeTruthy();
      - RENAME the test title to reflect the current contract, e.g.:
          'should propagate an orchestrator failure as a fatal run() failure (PRD bugfix Issue 5)'.

  6b. 'individual task failure handling > should not stop pipeline on individual failures'  (RUN path)
      - This intent is GONE under Issue 5 (the first throw halts). RE-ALIGN: keep the mockOrchestrator
        that throws on calls 2 and 4; ADD rebuildQueue; class-level mockImplementation.
      - REPLACE the assertions:
          OLD: expect(mockOrchestrator.processNextItem).toHaveBeenCalledTimes(6);
               expect(result.failedTasks).toBe(2);
               expect(result.hasFailures).toBe(true);
               expect(result.success).toBe(true);
          NEW: // Issue 5: the FIRST processNextItem throw is fatal — the loop does not reach call 4.
               expect(mockOrchestrator.processNextItem).toHaveBeenCalledTimes(2);
               expect(result.success).toBe(false);
               expect(result.error).toBeTruthy();
      - RENAME, e.g.: 'should halt on the first orchestrator failure (PRD bugfix Issue 5)'.

  6c. 'progress metrics tracking > should update failedTasks count'  (RUN path)
      - RE-ALIGN: the throw is an OrchestratorError (not #trackFailure), so #failedTasks.size stays 0.
      - KEEP the throwing mockOrchestrator; ADD rebuildQueue; class-level mockImplementation.
      - REPLACE:
          OLD: expect(result.failedTasks).toBe(2);
               expect(result.hasFailures).toBe(true);
          NEW: // Issue 5: an OrchestratorError is NOT counted as an individual task failure
               // (#trackFailure is never reached) — failedTasks stays 0 and the run fails fatally.
               expect(result.failedTasks).toBe(0);
               expect(result.success).toBe(false);
      - RENAME, e.g.: 'should not count an orchestrator failure as a tracked task failure (Issue 5)'.

  6d. 'individual task failure handling > should log warning when task fails'  (EXEC path)
      - The 'Task failed, continuing to next task' warn only fires under --continue-on-error via the
        INNER taskError catch — which a processNextItem throw never reaches (it becomes an
        OrchestratorError at the re-eval wrap). RE-ALIGN: executeBacklog() now REJECTS.
      - KEEP the throwing mockOrchestrator; inject sessionManager (Task 4) + taskOrchestrator.
      - REPLACE:
          OLD: await pipeline.executeBacklog();
               expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Task failed, continuing to next task'));
          NEW: // Issue 5: a processNextItem throw propagates as OrchestratorError out of executeBacklog.
               await expect(pipeline.executeBacklog()).rejects.toThrow();
      - Remove the now-unused warnSpy setup/assertion (or repoint it at logger.error if desired).
      - RENAME, e.g.: 'should reject executeBacklog on an orchestrator failure (PRD bugfix Issue 5)'.

  - DO NOT delete these tests. DO NOT change production. The re-aligned assertions are
    equivalent-or-stronger (they verify the real current contract).
  - VERIFY: npx vitest run tests/integration/pipeline-main-loop.test.ts → 0 failed.

# ═════════════════ TASK 7 — VERIFY (file + whole-suite delta + static gates + scope guard) ═════════════════
Task 7: VERIFY
  - RUN: npx vitest run tests/integration/pipeline-main-loop.test.ts --reporter=verbose → 0 failed (23/23).
  - RUN whole suite: npx vitest run --reporter=dot 2>&1 | tail -n 30 → failure count STRICTLY
    DECREASES by ~21 vs baseline; no previously-green file newly red.
  - RUN: npm run typecheck && npm run lint && npm run format:check → clean on the file.
  - RUN: git diff --stat -- src/ → EMPTY (rule 5 test-only).
```

### Implementation Patterns & Key Details

```ts
// ── Pattern A: INIT test (drive initializeSession, align no-arg assertion) ───────────────────
const mockSessionManager = setupMockSessionManager(backlog);
const pipeline = new PRPPipeline(prdPath);
(pipeline as any).sessionManager = mockSessionManager;          // run() normally does this
await pipeline.initializeSession();                             // constructor no longer inits
expect(mockSessionManager.initialize).toHaveBeenCalled();        // initialize() is NO-ARG now
expect(pipeline.currentPhase).toBe('session_initialized');

// ── Pattern B: EXEC test (inject sessionManager; orchestrator injection sticks) ─────────────
const mockSessionManager = setupMockSessionManager(backlog);
const pipeline = new PRPPipeline(prdPath);
(pipeline as any).sessionManager = mockSessionManager;          // NEW — executeBacklog reads it
const mockOrchestrator: any = {
  sessionManager: {},
  processNextItem: vi.fn().mockImplementation(async () => { /* … */ }),
  currentItemId: null as string | null,
};
(pipeline as any).taskOrchestrator = mockOrchestrator;          // sticks (init not called)
await pipeline.executeBacklog();

// ── Pattern C: RUN test (class-level orchestrator mock + rebuildQueue) ──────────────────────
const mockSessionManager = setupMockSessionManager(backlog);    // sets SessionManager class mock
const pipeline = new PRPPipeline(prdPath);
const mockOrchestrator: any = {
  sessionManager: {},
  rebuildQueue: vi.fn().mockResolvedValue(undefined),           // NEW — run() calls it (:2824)
  processNextItem: vi.fn().mockImplementation(async () => { /* … */ }),
  currentItemId: null as string | null,
};
(TaskOrchestrator as any).mockImplementation(() => mockOrchestrator); // CLASS-LEVEL (survives init)
const result = await pipeline.run();

// ── Pattern D: ROT test (re-aligned to Issue-5 OrchestratorError propagation) ───────────────
// processNextItem throws → OrchestratorError → executeBacklog rejects / run() failure result.
// RUN path:
expect(result.success).toBe(false);
expect(result.error).toBeTruthy();
// EXEC path:
await expect(pipeline.executeBacklog()).rejects.toThrow();
```

### Integration Points

```yaml
DATABASE: none
CONFIG:   none
ROUTES:   none
GIT:      none
# Edits confined to tests/integration/pipeline-main-loop.test.ts (EDIT in place).
# No package.json change. No tests/setup.ts change. No tests/helpers/ change. No src/ change.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run typecheck        # tsc --noEmit ; expect no NEW errors on the file
npm run lint             # eslint ; expect clean for the file
npm run format:check     # prettier --check ; if it complains: npx prettier --write tests/integration/pipeline-main-loop.test.ts
# Expected: Zero errors. Read any output and fix before proceeding.
```

### Level 2: Per-file tests (primary gate — must be 23/23)

```bash
npx vitest run tests/integration/pipeline-main-loop.test.ts --reporter=verbose 2>&1 | tail -n 40
# Expected: "Tests  23 passed (23)", "Test Files  1 passed (1)", exit 0.
# Diagnostics:
#   - If an INIT test fails with currentPhase='session_failed' → setupMockSessionManager is missing
#     hasSessionChanged (Task 2).
#   - If a RUN test fails with processNextItem "called 0 times" / totalTasks 0 → either the
#     orchestrator is still instance-injected (overwrite — use class-level mockImplementation, Task 5)
#     OR PRP_PIPELINE_RUNNING leaked (Task 2 beforeEach clear) OR ValidationWorkflow isn't mocked (Task 1).
#   - If an EXEC test fails with "Cannot read properties of undefined (reading 'currentSession')" →
#     sessionManager wasn't injected (Task 4).
#   - If a ROT test fails → it still asserts the dead pre-Issue-5 contract (re-align per Task 6).
```

### Level 3: Whole-suite delta (must NOT regress)

```bash
npx vitest run --reporter=dot 2>&1 | tail -n 30
# Expected:
#   - Failure count STRICTLY DECREASES by ~21 vs the pre-item baseline.
#   - No previously-green file newly red.
#   - Sibling category-(b) files NOT owned here (qa-agent, researcher-agent, prd-task-command,
#     prp-blueprint-agent, task-breakdown-prompt) may STILL be red — those are P1.M4.T3.S3 territory.
#     Do not fix them here. coder-agent.* are P1.M4.T3.S1 territory — leave them alone.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Scope guard — prove NO src/ file was touched (rule 5 test-only corrective):
git diff --stat -- src/                                       # EXPECT: empty
git status --short -- src/                                    # EXPECT: empty

# No-new-file guard — only the existing test file changed:
git status --short -- tests/integration/                      # EXPECT: only pipeline-main-loop.test.ts

# Mock-completeness guard — hasSessionChanged is on the mock:
grep -c "hasSessionChanged" tests/integration/pipeline-main-loop.test.ts   # EXPECT: >=1

# Env-clear guard — PRP_PIPELINE_RUNNING is defensively cleared:
grep -c "delete process.env.PRP_PIPELINE_RUNNING" tests/integration/pipeline-main-loop.test.ts  # EXPECT: >=1

# ValidationWorkflow-mock guard:
grep -c "workflows/validation-workflow.js" tests/integration/pipeline-main-loop.test.ts  # EXPECT: >=1

# Class-level orchestrator wiring guard (RUN tests use mockImplementation, not instance injection to run()):
grep -c 'TaskOrchestrator as any).mockImplementation' tests/integration/pipeline-main-loop.test.ts  # EXPECT: >=6

# No-arg initialize assertion guard (INIT tests):
grep -c "initialize).toHaveBeenCalled()" tests/integration/pipeline-main-loop.test.ts  # EXPECT: >=1
grep -c "initialize).toHaveBeenCalledWith(prdPath)" tests/integration/pipeline-main-loop.test.ts    # EXPECT: 0
```

## Final Validation Checklist

### Technical Validation

- [ ] `npx vitest run tests/integration/pipeline-main-loop.test.ts` → 0 failed (23/23).
- [ ] Whole-suite failure count strictly decreases (~21); no previously-green file newly red.
- [ ] `npm run typecheck`, `npm run lint`, `npm run format:check` clean on the file.

### Feature Validation

- [ ] **INIT (3):** `initializeSession()` driven; `initialize` asserted `toHaveBeenCalled()` (no-arg);
      `currentPhase==='session_initialized'`.
- [ ] **EXEC (~10):** `sessionManager` injected; `executeBacklog()` reaches the loop; phase transitions
      (backlog_complete / shutdown_interrupted) and call counts correct.
- [ ] **RUN (~6):** orchestrator wired at class level with `rebuildQueue`; `run()` completes the real
      loop; `result.totalTasks`/call-counts/`currentPhase==='shutdown_complete'` hold for the right reason.
- [ ] **ROT (4):** re-aligned to the Issue-5 OrchestratorError contract (run() failure result /
      executeBacklog rejects); no assertion weakened or deleted.
- [ ] The 2 previously-false-positive tests now pass via the real path (not the run() error path).

### Code Quality Validation

- [ ] File remains self-contained (own class mocks + helpers) — repo convention.
- [ ] `git diff --stat -- src/` empty (rule 5).

### Documentation & Deployment

- [ ] Commit message uses the project's task-prefix format (P1.M3 landed): `P1.M4.T3.S2: <subject>`.
      Do NOT prepend `[PRP Auto]` (forbidden per PRD §5.1 / BUG-003).

---

## Anti-Patterns to Avoid

- ❌ Don't inject `(pipeline as any).taskOrchestrator` and THEN call `run()` — `initializeSession()`
  overwrites it. Use class-level `TaskOrchestrator.mockImplementation(() => orch)` for run()-tests.
- ❌ Don't assert `initialize` was `toHaveBeenCalledWith(prdPath)` — `SessionManager.initialize()` is
  no-arg now (prdPath goes to the constructor in `run()`). Assert `toHaveBeenCalled()`.
- ❌ Don't leave `hasSessionChanged` off the SessionManager mock — `initializeSession()` calls it
  (`:785`) and throws non-fatally → `currentPhase='session_failed'`.
- ❌ Don't omit the `ValidationWorkflow` vi.mock — `#runValidation()` runs in ALL modes and would
  throw without it, making every run()-test a false-negative failure result.
- ❌ Don't rely on `vi.unstubAllEnvs()` to clear `PRP_PIPELINE_RUNNING` — it only undoes `stubEnv`
  values. `delete process.env.PRP_PIPELINE_RUNNING` in `beforeEach`.
- ❌ Don't keep the 4 ROT tests asserting swallow-and-continue — that contract is dead (PRD bugfix
  Issue 5). Re-align them to OrchestratorError propagation; don't delete or weaken them.
- ❌ Don't change production code (`src/`) to make a test pass — rule 5 is test-only corrective. The
  deferred-init contract and the Issue-5 OrchestratorError propagation are CORRECT.
- ❌ Don't fix files outside this item's scope (coder-agent.* = S1; qa-agent/researcher-agent/
  prd-task-command/prp-blueprint-agent/task-breakdown-prompt = S3).
- ❌ Don't prepend `[PRP Auto]` to the commit message (forbidden per PRD §5.1 / BUG-003).
- ❌ Don't run the pipeline app (`npm run dev`/`tsx src/index.ts`) — only run vitest.

---

## Confidence Score

**9/10** — one-pass success likelihood. Every failure category is verified by a live run (21/2
baseline) with exact `src:line` citations; the per-category fix was **empirically validated by
prototyping** (10/10 representative tests green in a throwaway file, then deleted). The deferred-init
contract is traced through source (constructor/run/initializeSession/executeBacklog/cleanup), the two
extra mock/env gaps were discovered and fixed during prototyping, and the 4 ROT tests have explicit
re-aligned assertions matching the validated Issue-5 OrchestratorError behavior. Residual risk: the
exact `processNextItem` call-count for the throwing ROT tests (validated as 2: prime + throwing
re-eval) and merging the per-test `rebuildQueue`/`mockImplementation` edits cleanly (mechanical,
flagged). Blast radius is 1 edited test file; `src/` is fenced off by an explicit scope guard.