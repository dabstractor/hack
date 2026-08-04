# P1.M4.T3.S2 Research Findings — pipeline-main-loop.test.ts (constructor→run() wiring drift)

## Baseline (live run, this session)
`npx vitest run tests/integration/pipeline-main-loop.test.ts` → **21 failed | 2 passed (23)**.

The 2 "passing" tests pass **for the wrong reason** (via run()'s error path → cleanup sets
`currentPhase='shutdown_complete'` regardless). They are false positives that must be made to
pass for the *right* reason.

## Root cause — the deferred-init refactor
`PRPPipeline`'s constructor (`src/workflows/prp-pipeline.ts:398`) was refactored to **DEFER**
`SessionManager` / `TaskOrchestrator` creation out of the constructor:

| Field | Created in | Line | Notes |
|-------|-----------|------|-------|
| `this.sessionManager` | `run()` | `:2751` `new SessionManagerClass(prdPath, planDir, flushRetries)` | **NOT** in constructor |
| `this.taskOrchestrator` | `initializeSession()` | `:774` `new TaskOrchestratorClass(...)` | **NOT** in constructor; also at `:663` for validate/bug-hunt reuse |

Consequences for the tests (which were written for the OLD constructor-did-everything contract):
1. After `new PRPPipeline(prdPath)`, **`this.sessionManager` is `undefined`** and `this.taskOrchestrator`
   is `undefined`. So `executeBacklog()` (`:1517` `this.sessionManager.currentSession?.taskRegistry`)
   throws `TypeError: Cannot read properties of undefined (reading 'currentSession')`.
2. Tests that inject `(pipeline as any).taskOrchestrator = mockOrchestrator` **before** `run()` have
   their injection **OVERWRITTEN** by `new TaskOrchestratorClass(...)` inside `initializeSession()`.
3. Tests that assert `mockSessionManager.initialize` was called / `currentPhase==='session_initialized'`
   after only `new PRPPipeline(prdPath)` see **0 calls** (the constructor no longer calls initialize).

## The 4 failure categories (all test-only; production code is IN-SPEC — rule 5)

### Category INIT (3 tests) — assert session init that never runs
- `pipeline initialization > should initialize session from PRD hash`
- `pipeline initialization > should use existing session when PRD hash matches`
- `mock session manager behavior > should use mock SessionManager for deterministic testing`

**Rot:** they do only `new PRPPipeline(prdPath)` then assert `initialize toHaveBeenCalledWith(prdPath)`
+ `currentPhase==='session_initialized'`. Neither happens (constructor doesn't init).

**EXTRA rot:** `SessionManager.initialize()` is `async initialize(): Promise<SessionState>`
(`src/core/session-manager.ts:383`) — **takes NO args**. The assertion `toHaveBeenCalledWith(prdPath)`
is stale (prdPath is now passed to the SessionManager *constructor* in `run()`). Must become
`toHaveBeenCalled()`.

### Category EXEC (≈10 tests) — call `executeBacklog()` with an undefined sessionManager
All the `loop termination`, `status transitions` (backlog_complete/shutdown_interrupted),
`mock orchestrator behavior`, and the `log progress every 5 tasks` / `log warning when task fails`
tests. They inject `taskOrchestrator` but **never set `sessionManager`** → `executeBacklog()` throws
`Cannot read properties of undefined (reading 'currentSession')` at `:1517`.

### Category RUN (≈6 tests) — call `run()` whose init overwrites the injected orchestrator
`process tasks until queue empty`, `update progress metrics`, `totalTasks/completedTasks/failedTasks
count`, `track progress percentage`, `transition through expected status states`, `flush updates
before saveBacklog`. They inject `taskOrchestrator` then call `run()`; `initializeSession()`
overwrites it with `new TaskOrchestratorClass(...)` (an empty `{}` — `vi.fn()` called with `new`
returns `{}`). `run()` then calls `this.taskOrchestrator.rebuildQueue()` (`:2824`) → `undefined is
not a function` → `run()` catches → returns a failure result → `processNextItem` called **0 times**,
`totalTasks === 0`.

### Category ROT (4 tests) — pre-Issue-5 failure-swallowing expectations (DEAD contract)
- `individual task failure handling > should track individual task failures`
- `individual task failure handling > should not stop pipeline on individual failures`
- `progress metrics tracking > should update failedTasks count`
- `individual task failure handling > should log warning when task fails`

These simulate a task failure by having the mock `processNextItem` **throw**, and assert the OLD
behavior (failure swallowed → `#trackFailure` → loop continues → `result.failedTasks>0`,
`result.success===true`, warn `'Task failed, continuing'`).

**Why it's dead:** PRD bugfix Issue 5 wrapped every `processNextItem()` call site in
`executeBacklog()` (priming `:1571` + re-eval `:1736`) with `try { … } catch (e) { throw new
OrchestratorError(…) }`. The outer catch (`:1781`) **rethrows** any `isOrchestratorError`/
`isMaxIterationsError` unconditionally (even under `--continue-on-error`). So a `processNextItem`
throw now **propagates as a fatal OrchestratorError** — it never reaches the inner `taskError`
catch (`:1691`) that calls `#trackFailure`. Therefore `#failedTasks.size` stays 0 and the loop
does NOT continue.

> Individual task failures in the REAL architecture are handled **inside** the real
> `TaskOrchestrator.processNextItem()` (it catches `TaskError`, marks the subtask `Failed`,
> returns true/false). The mock throwing from `processNextItem` no longer maps to "individual
> task failure" — it maps to "orchestrator broke". These 4 tests must be **re-aligned to the
> current Issue-5 contract** (OrchestratorError propagation), not deleted/weakened.

## Two additional gaps discovered by empirical prototyping (part of the wiring drift)

1. **Mock `SessionManager` is incomplete for the init path.** `initializeSession()` calls
   `this.sessionManager.hasSessionChanged()` (`:785`) and (in adopt/validate/bug-hunt modes)
   `hasAnySessions()` (`:695`). `setupMockSessionManager()` defines NEITHER → `TypeError` →
   non-fatal catch → `currentPhase='session_failed'` (not `session_initialized`). **Fix:** add
   `hasSessionChanged: vi.fn().mockReturnValue(false)` and `hasAnySessions:
   vi.fn().mockResolvedValue(false)` to the mock.

2. **`PRP_PIPELINE_RUNNING` env leak aborts `run()` via `validateNestedExecution()`.** `run()`
   (`:2772`) calls `validateNestedExecution(sessionPath)` which reads
   `process.env.PRP_PIPELINE_RUNNING` and throws `NestedExecutionError` if it is set (unless
   bugfix recursion). The env var is genuinely set in some run contexts (observed value
   `3899796` in this session; also set when the suite runs inside a pipeline/agent harness). The
   original `afterEach` uses `vi.unstubAllEnvs()` which only undoes `vi.stubEnv`'d values — it
   does **not** clear a genuinely-set env. Result: `run()` throws before `executeBacklog` →
   failure result → false negatives. **Fix:** `delete process.env.PRP_PIPELINE_RUNNING;` in
   `beforeEach` (defensive; no-op in a clean env, fixes the leak).

## Validated fix design (prototyped in a temp file, 10/10 representative tests green, then deleted)

A throwaway `tests/integration/_pml_validation.test.ts` (same dir → relative imports resolve)
was written with the fix applied across all 4 categories + the 2 mock-completeness/env fixes.
**All 10 representative tests passed.** The prototype was then deleted; `src/` and the original
test file were verified untouched (`git status --short` clean for both).

### Per-category transformation (validated)

| Category | Trigger | Orchestrator wiring | SessionManager wiring | Entry point |
|----------|---------|---------------------|-----------------------|-------------|
| INIT | assert init happened | (none — init creates an empty `{}` orchestrator, unused) | `(pipeline as any).sessionManager = mockSM` | `await pipeline.initializeSession()` |
| EXEC | loop behavior / phase | `(pipeline as any).taskOrchestrator = mockOrch` (sticks — init NOT called) | `(pipeline as any).sessionManager = mockSM` | `await pipeline.executeBacklog()` |
| RUN | end-to-end / `result.*` | **`(TaskOrchestrator as any).mockImplementation(() => mockOrch)`** (class-level; survives `initializeSession`) + mockOrch needs `rebuildQueue` | `setupMockSessionManager` class mock (run() does `new SessionManagerClass`) | `await pipeline.run()` |
| ROT | failure propagation | same as RUN or EXEC | same | assert `run()` failure result / `executeBacklog()` rejects |

### File-top additions (validated)
- `vi.mock('../../src/workflows/validation-workflow.js', …)` → `run()`'s `#runValidation()`
  (`:1833`, runs in ALL modes per PRD §4.4) would otherwise call the real `ValidationWorkflow`
  (→ mocked-away `createQAAgent` → throw). Mock returns
  `{ run: async () => ({ success:true, exitCode:0, timedOut:false, durationMs:0 }) }`.
- `delete process.env.PRP_PIPELINE_RUNNING;` in `beforeEach`.

### Key production facts relied upon (READ-ONLY — do NOT change)
- `decomposePRD()` (`:1293`) **skips** (sets `prd_decomposed`, no architect call) when a non-delta
  session already has `backlog.backlog.length > 0` → the `createArchitectAgent` mock is unused on
  the happy path (harmless).
- `runQACycle()` (`:1877`) in normal mode **skips early** (`qa_skipped`) when
  `!#allTasksComplete()` — and the mock orchestrator never marks subtasks `Complete`, so QA never
  runs (no LLM/agent call). Good — keeps run()-tests light.
- `cleanup()` (`:2387`) **always** sets `currentPhase='shutdown_complete'` (whether or not
  sessionManager exists) → that's why the 2 currently-passing tests are false positives (they pass
  via the error path). The fix makes them pass via the real path.
- `#countTasks/#countCompletedTasks/#countFailedTasks` (`:2953+`) read **backlog statuses**
  (`Complete` / `Failed`). The mock never changes statuses → `completedTasks===0`,
  `#countFailedTasks()===0` always. BUT `result.failedTasks` (`:2877`) = `#failedTasks.size` (the
  Map, populated only by `#trackFailure`) — a DIFFERENT source than `#countFailedTasks()`.
- `executeBacklog()`'s HARD-ABORT (`:1517`): no `sessionManager.currentSession.taskRegistry` →
  throws `SessionError` (fatal). This is the source of the EXEC-category `TypeError` when
  sessionManager is undefined.

## Scope guard (rule 5 — test-only corrective)
`git diff --stat -- src/` MUST stay empty. Every change is in `tests/integration/pipeline-main-loop.test.ts`.
No PRD/feature change; no new behavior. The production deferred-init contract (and PRD bugfix
Issue 5's OrchestratorError propagation) are CORRECT — only the tests drift.

## Sibling-item boundaries (parallel execution)
- **P1.M4.T3.S1** (coder-agent.test.ts): disjoint file; does NOT touch pipeline-main-loop. Its
  helper/temp-dir conventions are referenced but not consumed here.
- **P1.M4.T3.S3** (qa-agent, researcher-agent, prd-task-command, prp-blueprint-agent,
  task-breakdown-prompt): disjoint files. Do NOT touch them here.
- The `tests/helpers/research-seam.ts` (P1.M4.T2) is NOT needed — this file already has its own
  class-level mocks.