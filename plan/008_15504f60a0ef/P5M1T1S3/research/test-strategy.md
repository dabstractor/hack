# Test Strategy — P5.M1.T1.S3

All tests extend `tests/unit/workflows/prp-pipeline.test.ts` (the PRIMARY file). The module
mocks at the top of that file ALREADY cover every external dependency `run()` touches, so an
adopt-mode end-to-end test is feasible without new mocks. **No network, no real agent.**

## 1. The existing mock surface (already in the file — REUSE, do not re-declare)

```ts
// :41  SessionManager — mock; configure per-test via MockSessionManagerClass.mockImplementation
vi.mock('../../../src/core/session-manager.js', () => ({ SessionManager: vi.fn().mockImplementation(() => ({
  currentSession: null, initialize: vi.fn(), saveBacklog: vi.fn(),
})) }));
// :50  TaskOrchestrator — mock with processNextItem + rebuildQueue
// :58  agent-factory — createArchitectAgent/createQAAgent (mocks)
// :73  DeltaAnalysisWorkflow, :84 BugHuntWorkflow, :96 FixCycleWorkflow — mocks
// :113 validation-workflow.js — vi.hoisted MockValidationWorkflow (default: validation PASSES);
//        exports a mock ValidationFailedError too. Per-test re-mockImplementation to control outcome.
// :138 task-patcher, :143 task-utils (filterByStatus), :148 execution-guard
```
Cast references already exist: `MockSessionManagerClass`, `MockBugHuntWorkflow`,
`MockFixCycleWorkflow`, `MockValidationWorkflow`, `MockDeltaAnalysisWorkflow`,
`mockCreateArchitectAgent`, `mockValidateNestedExecution`, `mockIsNestedExecutionError`.

Existing test idiom (REUSE): `const pipeline = new PRPPipeline('./test.md');` then call a
sub-method (`pipeline.executeBacklog()` / `pipeline.runQACycle()`) and/or inject fields
(`pipeline.totalTasks = 2;` at `:606`). S2's PRP already adds an
`describe('--adopt-prd baseline seeding')` block to THIS file — S3's tests sit ALONGSIDE it
(a new `describe('adopt mode: validation + bug-hunt still run (PRD §4.6)')` block), reusing
the same `createAdoptedBaseline` import + `MockSessionManagerClass` setup.

## 2. Shared fixture — a mock sessionManager holding the adopted (all-Complete) baseline

```ts
import { createAdoptedBaseline } from '../../../src/core/session-manager.js'; // S2 export
// ...
function mockSessionWithAdoptedBaseline() {
  const baseline = createAdoptedBaseline(); // 1 Phase→Milestone→Task→Subtask, all Complete
  return {
    currentSession: {
      metadata: { id: '008_abc', hash: 'abc', path: '/plan/008_abc', createdAt: new Date(), parentSession: null },
      prdSnapshot: '# PRD',
      taskRegistry: baseline,
      currentItemId: null,
    },
    initialize: vi.fn(),
    saveBacklog: vi.fn(),
    hasAnySessions: vi.fn().mockResolvedValue(false),
    planDir: '/plan',
  };
}
```
> NOTE: `createAdoptedBaseline` is the S2 export. If S2 is still landing, the test can inline
> an equivalent all-Complete `Backlog` (1 subtask) — but prefer the import so the test pins
> the REAL baseline shape.

## 3. Test A — `executeBacklog()` skip guard recomputes the counts (the S3 change)

```ts
it('executeBacklog recomputes totalTasks/completedTasks when skipExecutionLoop (adopt mode)', async () => {
  MockSessionManagerClass.mockImplementation(() => mockSessionWithAdoptedBaseline());
  const pipeline = new PRPPipeline('./test.md');
  (pipeline as any).skipExecutionLoop = true;          // S2 field
  // sanity: counts start at 0
  expect(pipeline.totalTasks).toBe(0);
  expect(pipeline.completedTasks).toBe(0);

  await pipeline.executeBacklog();

  // The adopted baseline is all-Complete (1/1); the skip guard MUST recompute so the session
  // reports complete (PRD §4.6 / work-item part c).
  expect(pipeline.totalTasks).toBe(1);
  expect(pipeline.completedTasks).toBe(1);
  expect(pipeline.currentPhase).toBe('backlog_complete');
});
```
Asserting `completedTasks === totalTasks === 1` is the DIRECT regression guard for the S3
fix. Without the recompute this fails (completedTasks stays 0).

## 4. Test B — `runQACycle()` RUNS (does not skip) for the adopted baseline

Mirrors the existing `runQACycle` tests (`:588+`). Set the field state that `executeBacklog`
(skip) would have produced, then call `runQACycle` and assert the bug-hunt mock fired:
```ts
it('runQACycle runs the bug hunt for the adopted (all-Complete) baseline (PRD §4.6)', async () => {
  MockSessionManagerClass.mockImplementation(() => mockSessionWithAdoptedBaseline());
  const pipeline = new PRPPipeline('./test.md');
  pipeline.totalTasks = 1;                              // as set by the skip guard / decomposePRD
  pipeline.completedTasks = 1;                          // as set by the S3 recompute
  // mode defaults to 'normal'

  await pipeline.runQACycle();

  // QA must NOT have been skipped (currentPhase !== 'qa_skipped') and the bug hunt ran:
  expect(MockBugHuntWorkflow).toHaveBeenCalled();
  expect(pipeline.currentPhase).not.toBe('qa_skipped');
});
```
Optional stronger guard: also assert the negative — a baseline with a NON-Complete subtask
skips QA (`currentPhase === 'qa_skipped'`, `MockBugHuntWorkflow` NOT called) — to pin that the
gate is the completion check, not a blanket adopt bypass. (Existing runQACycle tests already
cover the skip path; this is optional.)

## 5. Test C — validation still runs in adopt mode (run()-level end-to-end)

`#runValidation` is `#`-private ⇒ reachable ONLY via `run()`. The module mocks cover all of
`run()`'s deps, so call `run()` in adopt mode and assert BOTH the validation mock AND the
bug-hunt mock fired, plus the result reports the session complete:
```ts
it('run() still runs validation + bug-hunt in adopt mode and reports the session complete (PRD §4.6)', async () => {
  MockSessionManagerClass.mockImplementation(() => mockSessionWithAdoptedBaseline());
  // validation passes by default (the hoisted MockValidationWorkflow default). Ensure a fresh impl:
  MockValidationWorkflow.mockImplementation(() => ({ run: vi.fn().mockResolvedValue({ success:true, exitCode:0, timedOut:false, stdout:'', stderr:'', scriptPath:'/plan/008_abc/validate.sh', durationMs:0 }) }));
  mockValidateNestedExecution.mockImplementation(() => {});      // no nested-execution error
  mockIsNestedExecutionError.mockReturnValue(false);

  const pipeline = new PRPPipeline('./test.md');
  (pipeline as any).skipExecutionLoop = true;          // adopt mode (S2 sets this on adoptFresh)

  const result = await pipeline.run();

  expect(result.success).toBe(true);
  // VALIDATION ran (PRD §4.6 — validation not gated by skipExecutionLoop):
  expect(MockValidationWorkflow).toHaveBeenCalled();
  // BUG HUNT ran (not skipped):
  expect(MockBugHuntWorkflow).toHaveBeenCalled();
  // Session reported COMPLETE (the S3 recompute):
  expect(result.totalTasks).toBe(1);
  expect(result.completedTasks).toBe(1);
});
```
> If `run()` proves too heavy in this harness (initializeSession side effects), DROP Test C
> and rely on Test A + Test B + the §3 "validation runs by construction" reasoning
> (no gate; S3 adds none). But the module mocks are comprehensive, so Test C should work — and
> it is the strongest single proof of the work-item OUTPUT. Prefer to keep it; trim only if it
> blocks.

## 6. Test D (optional, part d) — next PRD edit produces a delta (no production change)

Part (d) holds by construction (run-flow-gate-analysis §6). A lightweight regression note
rather than a full delta test: assert that an adopted session's `tasks.json` is a normal,
schema-valid backlog (so it diff-baselines like any completed session) and that `.adopted`
is a plain marker nothing special-cases. This is already covered by S2's
`createAdoptedBaseline` schema test + the delta-path unit tests — S3 need NOT add a new one.
Mention in the PRP that (d) requires no code and is locked by existing tests.

## 7. Coverage gate (vitest.config.ts enforces 100% globally)

The new branches: `skipExecutionLoop` true (the recomputing guard) and false (existing
executeBacklog body). Test A covers the true branch; the existing executeBacklog tests cover
the false branch. Test A's `expect(...).toBe(1)` on BOTH counts ensures the recompute lines
are exercised (not just entered). No new uncovered branch is introduced.