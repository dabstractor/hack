# PRP — P5.M1.T1.S3: Validation and bug-hunt still run in adopt mode

---

## Goal

**Feature Goal**: Close out Adopt Mode (PRD §4.6) by guaranteeing that an `--adopt-prd`
fresh-project run — where S2's `skipExecutionLoop` skips `decomposePRD()`/`executeBacklog()`
— **still runs validation (`validate.sh` via `ValidationWorkflow`) and the bug hunt
(`BugHuntWorkflow`)** against the real codebase + PRD, and that the session is reported as
genuinely complete. The one real defect S2 leaves is a **stale `completedTasks` field** (it is
only set inside `executeBacklog()`'s body, which the skip guard bypasses), so an adopt run
reports `completedTasks: 0, totalTasks: 1`. S3 extends S2's skip guard to recompute both
counts from the seeded all-`Complete` baseline so the session behaves "as for a normal
completed session", and adds regression tests proving validation + bug-hunt run.

**Deliverable**:
1. A 3-line extension of S2's `executeBacklog()` skip guard in `src/workflows/prp-pipeline.ts`:
   before the early `return`, set `this.totalTasks = this.#countTasks()` and
   `this.completedTasks = this.#countCompletedTasks()` (both read the seeded in-memory
   registry → `1`/`1`), and update the info-log text to note validation + bug-hunt still run.
2. TDD regression tests in `tests/unit/workflows/prp-pipeline.test.ts` (a new
   `describe('adopt mode: validation + bug-hunt still run (PRD §4.6)')` block) covering: (A)
   the skip guard recomputes counts to 1/1; (B) `runQACycle()` RUNS (not skipped) for the
   adopted baseline; (C) `run()` invokes both `ValidationWorkflow` and `BugHuntWorkflow` in
   adopt mode and returns a complete result. Reuses the file's existing module mocks +
   S2's `createAdoptedBaseline` import.
3. No docs (work-item DOCS line: "none — no change beyond S1/S2").

**Success Definition**: On a fresh-project adopt run, after `executeBacklog()` early-returns,
`this.totalTasks === this.completedTasks` (the session is "complete"); `#runValidation()`
runs (it always does — no gate); `runQACycle()` does NOT skip (`#allTasksComplete()` reads the
all-`Complete` baseline); the `PipelineResult` reports `completedTasks === totalTasks === 1`;
the next `PRD.md` edit produces a normal delta session (no code change — holds by
construction). `npm run validate` GREEN; `npm run test:coverage` 100%;
`git diff --name-only` = exactly `src/workflows/prp-pipeline.ts` +
`tests/unit/workflows/prp-pipeline.test.ts`.

---

## User Persona (if applicable)

**Target User**: A pipeline operator whose codebase already ships and who ran
`npm run dev -- --prd ./PRD.md --adopt-prd`. They expect the adoption to validate the real
codebase against the PRD and hunt for bugs — NOT to silently skip QA.

**User Journey**: S1 parses `--adopt-prd` → S2 seeds the all-`Complete` baseline + `.adopted`
+ sets `skipExecutionLoop` → `decomposePRD()` auto-skips → **S3**: `executeBacklog()` skip
guard recomputes the counts (session = complete) → `#runValidation()` generates + runs
`validate.sh` on the real codebase → `runQACycle()` runs `BugHuntWorkflow` against the real
codebase + PRD → result reports the session complete; the next `PRD.md` edit deltas against
this baseline.

**Pain Points Addressed**: Without S3, an adopt run reports `completedTasks: 0` (misleading)
and the "QA runs as for a normal completed session" guarantee rests on an implicit invariant
(`#allTasksComplete` reading the seeded registry). S3 makes completion explicit + locks the
behavior with regression tests so a future change to `executeBacklog`/`runQACycle` cannot
silently regress adopt mode.

---

## Why

- **PRD compliance (§4.6)**: verbatim — *"Sets `SKIP_EXECUTION_LOOP=true`: implementation is
  skipped, but **validation + bug hunt still run** against the real codebase + PRD."* and
  *"so `is_session_complete` is true and this session becomes the idempotent baseline."*
- **Work-item CONTRACT mapping**:
  - **(1) RESEARCH NOTE** — `phase_findings.md §PHASE 5` (seed baseline + `.adopted` +
    `SKIP_EXECUTION_LOOP`) + this PRP's `research/run-flow-gate-analysis.md` (the run() step
    order + the `completedTasks` gap + the `#allTasksComplete` gate).
  - **(2) INPUT** — the baseline session from **P5.M1.T1.S2**: the `skipExecutionLoop` field,
    `seedAdoptedBaseline()`, and the exported `createAdoptedBaseline()` factory.
  - **(3) LOGIC** — (a) skip decompose/executeBacklog: **S2 already does this** (S3 reuses it
    unchanged); (b) still run validation + bug-hunt: **validation runs always** (no gate —
    `research §3`); **bug-hunt runs** because `#allTasksComplete()` reads the seeded all-`Complete`
    registry (`research §4`); (c) `is_session_complete` true: **S3 makes it explicit** by
    recomputing `completedTasks === totalTasks` in the skip guard (`research §5`); (d) next
    edit → delta: **holds by construction** — S2 reuses `initialize()` so the session is
    hash-registered for delta detection (`research §6`).
  - **(4) OUTPUT** — "Adopt mode skips execution but runs validation + bug hunt. Completes P5.M1."
  - **(5) DOCS** — "none".
- **Milestone completion**: S1 (flag + guard rails) ✓ Complete; S2 (seeding) in flight; S3
  (this) is the capstone that makes adopt mode genuinely validate + QA the real codebase and
  reports it as complete — **completing P5.M1**.

---

## What

On a fresh-project `--adopt-prd` run, after S2 sets `skipExecutionLoop=true` and seeds the
all-`Complete` baseline, `run()` proceeds: `decomposePRD()` auto-skips (non-empty backlog),
`executeBacklog()` hits S2's skip guard — **which S3 extends to recompute
`this.totalTasks`/`this.completedTasks` from the seeded registry before returning** — then
`#runValidation()` runs `ValidationWorkflow` (generate + run `validate.sh` on the real
codebase; abort-on-failure), then `runQACycle()` runs `BugHuntWorkflow` (the gate passes
because `#allTasksComplete()` reads the all-`Complete` baseline). The `PipelineResult`
reports the session complete. The next `PRD.md` edit produces a normal delta session.

**No** new CLI flag (S1), **no** new config/env constant (the `SKIP_EXECUTION_LOOP` *env var*
is intentionally NOT wired — the mechanism is S2's `skipExecutionLoop` field; reading the env
var would violate the work-item's "no config surface change" line), **no** change to
`decomposePRD()`/`#runValidation()`/`runQACycle()`/`SessionManager`/`BugHuntWorkflow`/
`ValidationWorkflow`, **no** docs, **no** new dependency.

### Success Criteria

- [ ] `executeBacklog()`'s `skipExecutionLoop` guard sets `this.totalTasks = this.#countTasks()`
      AND `this.completedTasks = this.#countCompletedTasks()` before the early `return`, so for
      the adopted baseline both equal `1` and `currentPhase === 'backlog_complete'`.
- [ ] `#runValidation()` is **unchanged** and still invoked from `run()` in adopt mode
      (validation runs against the real codebase + PRD — locked by Test C).
- [ ] `runQACycle()` does NOT skip for the adopted baseline (normal mode): `#allTasksComplete()`
      returns true ⇒ `BugHuntWorkflow` runs (locked by Test B + Test C).
- [ ] `PipelineResult` from an adopt-mode `run()` reports `completedTasks === totalTasks === 1`
      (locked by Test C).
- [ ] The next `PRD.md` edit produces a normal delta session (no production change — locked by
      existing delta-path tests + S2's `createAdoptedBaseline` schema test; documented in `research §6`).
- [ ] `npm run validate` GREEN; `npm run test:coverage` 100%; `git diff --name-only` = exactly
      the 2 listed files.

---

## All Needed Context

### Context Completeness Check

✅ "No Prior Knowledge" — an agent with zero codebase knowledge can implement this from: the
verbatim `run()` step order, the exact S2 skip guard to extend (quoted), the exact
`#countTasks`/`#countCompletedTasks`/`#allTasksComplete` behavior (quoted), the proof that
validation runs always + QA runs via `#allTasksComplete` (`research §3-§4`), the verbatim test
bodies (`research/test-strategy.md`), and S2's PRP (the `skipExecutionLoop` field +
`createAdoptedBaseline`/`seedAdoptedBaseline` contract). No inference required.

### Documentation & References

```yaml
# MUST READ — this PRP's own analysis (the WHY + the gate proof)
- file: plan/008_15504f60a0ef/P5M1T1S3/research/run-flow-gate-analysis.md
  why: §1 run() step order; §2 the completedTasks gap (S2 leaves it 0); §3 #runValidation runs
       ALWAYS (no gate — S3 adds none); §4 runQACycle's normal-mode gate + #allTasksComplete
       reads the in-memory backlog ⇒ QA runs for the adopted baseline; §5 the S3 fix (extend
       S2's guard to recompute counts); §6 part (d) holds by construction (no code); §7 scope
       guardrails; §8 why this is 1 point.
- file: plan/008_15504f60a0ef/P5M1T1S3/research/test-strategy.md
  why: the existing module mocks to REUSE; the shared adopted-baseline fixture; verbatim Test
       A (recompute), Test B (runQACycle runs), Test C (run() runs validation + bug-hunt);
       coverage-gate reasoning.

# MUST READ — the PREVIOUS PRP (P5.M1.T1.S2) = the contract S3 consumes/extends
- file: plan/008_15504f60a0ef/P5M1T1S2/PRP.md
  why: S2 ships the `private skipExecutionLoop: boolean = false` field, the `seedAdoptedBaseline()`
       method, the exported `createAdoptedBaseline(): Backlog` factory (the all-Complete
       hierarchy), and the `executeBacklog()` skip guard S3 EXTENDS (Task 3c). S3 consumes
       `this.skipExecutionLoop` + `createAdoptedBaseline()` and edits the guard's body.
  section: "Task 3c (executeBacklog skip guard)" + "Data models (createAdoptedBaseline)" +
           "Success Criteria (skipExecutionLoop field)".

# MUST READ — the pipeline file S3 modifies (THE primary target)
- file: src/workflows/prp-pipeline.ts
  section: "executeBacklog() (:1225) — S2's skip guard is the FIRST statement; S3 extends its
            body. #countTasks() (:2526) + #countCompletedTasks() (:2552) read
            sessionManager.currentSession.taskRegistry. run() (:2296) step order
            initializeSession→decomposePRD→rebuildQueue→executeBacklog→#runValidation(:2430)
            →runQACycle(:2432). #runValidation() (:1489, #private, runs ALWAYS). runQACycle()
            (:1533) normal-mode gate (:1558 totalTasks===0 / :1564 !#allTasksComplete()).
            #allTasksComplete() (:2583) reads the in-memory backlog. totalTasks/completedTasks
            are public fields (:218/:221) surfaced in PipelineResult (:2453/:2475)."
  pattern: |
    # S2's guard TODAY (the body S3 replaces) — FIRST statement of executeBacklog():
    if (this.skipExecutionLoop) {
      this.logger.info('[PRPPipeline] Skipping execution loop (adopt mode / SKIP_EXECUTION_LOOP)');
      this.currentPhase = 'backlog_complete';
      return;
    }
    # S3's replacement (recompute BOTH counts from the seeded registry before returning):
    if (this.skipExecutionLoop) {
      this.logger.info('[PRPPipeline] Skipping execution loop (adopt mode / SKIP_EXECUTION_LOOP); validation + bug-hunt still run (PRD §4.6)');
      this.totalTasks = this.#countTasks();          // 1 for the adopted baseline
      this.completedTasks = this.#countCompletedTasks(); // 1 (all-Complete) — was 0 without this
      this.currentPhase = 'backlog_complete';
      return;
    }
  gotcha: |
    - #runValidation is `#`-private ⇒ ONLY reachable via run(). Test it at the run() level
      (Test C) — never try to call it directly.
    - Do NOT add a skip/gate to #runValidation or runQACycle — validation runs always and QA's
      gate already passes for the adopted baseline. S3 touches ONLY executeBacklog's guard.
    - Do NOT read process.env.SKIP_EXECUTION_LOOP — the mechanism is the `skipExecutionLoop`
      FIELD (S2 sets it on adoptFresh). The env var appears only in comments (:200/:654/:666).

# MUST READ — the test file S3 extends (mock idioms + cast references to REUSE)
- file: tests/unit/workflows/prp-pipeline.test.ts
  section: "module mocks (:41 SessionManager, :50 TaskOrchestrator, :73 DeltaAnalysisWorkflow,
            :84 BugHuntWorkflow, :96 FixCycleWorkflow, :113 validation-workflow [vi.hoisted
            MockValidationWorkflow — default PASSES], :138 task-patcher, :143 task-utils,
            :148 execution-guard). Cast refs: MockSessionManagerClass, MockBugHuntWorkflow,
            MockValidationWorkflow, mockValidateNestedExecution, mockIsNestedExecutionError.
            Existing idiom: new PRPPipeline('./test.md'); field injection pipeline.totalTasks=2
            (:606). S2 adds describe('--adopt-prd baseline seeding') here — S3 sits alongside it."
  pattern: |
    MockSessionManagerClass.mockImplementation(() => ({ currentSession: { metadata:{...},
      prdSnapshot:'# PRD', taskRegistry: createAdoptedBaseline(), currentItemId:null },
      initialize: vi.fn(), saveBacklog: vi.fn(), hasAnySessions: vi.fn().mockResolvedValue(false),
      planDir: '/plan' }));
    const pipeline = new PRPPipeline('./test.md');
    (pipeline as any).skipExecutionLoop = true;
    await pipeline.executeBacklog();
    expect(pipeline.totalTasks).toBe(1); expect(pipeline.completedTasks).toBe(1);
  gotcha: |
    - Re-S2: import createAdoptedBaseline from '../../../src/core/session-manager.js' (S2 export).
    - The validation mock is vi.hoisted (MockValidationWorkflow) — re-mockImplementation
      per-test to control the outcome (default passes; Test C can re-affirm the passing impl).
    - run() calls validateNestedExecution — set mockValidateNestedExecution(()=>{}) +
      mockIsNestedExecutionError.mockReturnValue(false) so run() doesn't throw on the guard.

# REFERENCE — architecture findings (the RESEARCH NOTE the contract cites)
- file: plan/008_15504f60a0ef/architecture/phase_findings.md
  section: "§PHASE 5 Adopt Mode — Required Changes: seed completed baseline, .adopted marker,
            SKIP_EXECUTION_LOOP (skip implementation but run validation + bug hunt)."
```

### Current Codebase tree (relevant slice)

```bash
src/workflows/prp-pipeline.ts            # MODIFY — extend S2's executeBacklog() skip guard
                                         #   to recompute totalTasks/completedTasks (+ log text).
tests/unit/workflows/prp-pipeline.test.ts # MODIFY — + describe('adopt mode: validation +
                                         #   bug-hunt still run') with Tests A/B/C.

# REUSED / NOT MODIFIED (S2 owns these; S3 consumes):
src/core/session-manager.ts              # createAdoptedBaseline() + seedAdoptedBaseline() (S2)
src/workflows/validation-workflow.ts     # #runValidation calls it unchanged (runs always)
src/workflows/bug-hunt-workflow.ts       # runQACycle calls it unchanged (gate passes)
src/cli/index.ts                         # S1 owns --adopt-prd
docs/CONFIGURATION.md                    # S2 owns the Adopt Mode subsection (Mode A)
```

### Desired Codebase tree with files to be added/modified

```bash
src/workflows/prp-pipeline.ts
  # executeBacklog(): extend S2's skipExecutionLoop guard — recompute totalTasks +
  #   completedTasks (#countTasks/#countCompletedTasks) before the early return; update log text.
tests/unit/workflows/prp-pipeline.test.ts
  # + describe('adopt mode: validation + bug-hunt still run (PRD §4.6)')
  #     Test A — skip guard recomputes counts to 1/1.
  #     Test B — runQACycle runs (MockBugHuntWorkflow called; not qa_skipped).
  #     Test C — run() runs validation + bug-hunt; result.completedTasks===totalTasks===1.
```

> **No new files. No new production symbols.** One guard-body edit + one test describe block.

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL: completedTasks is ONLY set inside executeBacklog()'s body (:1286,:1423). S2's skip
//   guard returns BEFORE that body, so without S3's recompute completedTasks stays 0 even though
//   the seeded baseline is 100% Complete → PipelineResult reports 0/1 (wrong) + the session is
//   not "complete" by the field. S3 recomputes BOTH counts in the guard. (research §2/§5)

// CRITICAL: do NOT add/remove any gate on #runValidation or runQACycle. #runValidation runs in
//   ALL modes (run() comment :2424). runQACycle's normal-mode gate PASSES for the adopted
//   baseline because #allTasksComplete() reads the in-memory all-Complete registry (:2583).
//   S3 changes ONLY executeBacklog's guard body. (research §3/§4)

// CRITICAL: #runValidation is `#`-private — unreachable from tests except via run(). Test it at
//   the run() level (Test C). Never try (pipeline as any)['#runValidation']. (research §3)

// GOTCHA: do NOT read process.env.SKIP_EXECUTION_LOOP. grep confirms it appears ONLY in comments
//   (:200,:654,:666). The mechanism is the `skipExecutionLoop` FIELD S2 sets on adoptFresh.
//   Wiring the env var would violate the work-item's "no config surface change" line.

// GOTCHA: #countTasks/#countCompletedTasks read sessionManager.currentSession.taskRegistry.
//   For the adopted baseline S2 updated the in-memory registry (immutable spread), so they
//   return 1/1. Do NOT hand-roll the count — reuse the private helpers.

// GOTCHA: the validation mock is vi.hoisted (MockValidationWorkflow). In Test C, re-affirm a
//   passing impl via MockValidationWorkflow.mockImplementation(() => ({ run: vi.fn()
//   .mockResolvedValue({success:true, exitCode:0, timedOut:false, ...}) })) and set
//   mockValidateNestedExecution(()=>{}) + mockIsNestedExecutionError.mockReturnValue(false)
//   so run()'s nested-execution guard doesn't throw.

// GOTCHA: 100% coverage gate (vitest.config.ts). The skipExecutionLoop true branch is covered
//   by Test A; the false branch by existing executeBacklog tests. The recompute lines are
//   exercised by Test A's expect(totalTasks).toBe(1) + expect(completedTasks).toBe(1).

// GOTCHA: part (d) "next edit → delta" needs NO production change. S2 reuses initialize() so
//   the session is hash-registered; .adopted is a marker nothing reads. Do NOT add delta
//   special-casing. (research §6)
```

---

## Implementation Blueprint

### Data models and structure

No new models. S3 reuses the `Backlog` produced by S2's `createAdoptedBaseline()` and the
existing private counters `#countTasks()`/`#countCompletedTasks()`. Type safety comes from the
public `totalTasks: number` / `completedTasks: number` fields.

### Implementation Tasks (ordered by dependencies — strict TDD)

```yaml
Task 1: WRITE tests in tests/unit/workflows/prp-pipeline.test.ts  (FAILING-FIRST — before Task 2)
  - IMPORT (add near the existing session-manager import): 
      import { createAdoptedBaseline } from '../../../src/core/session-manager.js';   # S2 export
    (If S2 is still landing, inline an equivalent 1-subtask all-Complete Backlog instead, but
     prefer the import to pin the REAL baseline shape.)
  - ADD a helper near the other test factories:
      function mockSessionWithAdoptedBaseline() {
        return {
          currentSession: {
            metadata: { id:'008_abc', hash:'abc', path:'/plan/008_abc', createdAt:new Date(), parentSession:null },
            prdSnapshot: '# PRD',
            taskRegistry: createAdoptedBaseline(),
            currentItemId: null,
          },
          initialize: vi.fn(), saveBacklog: vi.fn(),
          hasAnySessions: vi.fn().mockResolvedValue(false), planDir: '/plan',
        };
      }
  - ADD a new describe('adopt mode: validation + bug-hunt still run (PRD §4.6)', () => { … })
    alongside S2's describe('--adopt-prd baseline seeding'), with Tests A/B/C verbatim from
    research/test-strategy.md §3/§4/§5. In particular:
      Test A: MockSessionManagerClass.mockImplementation(()=>mockSessionWithAdoptedBaseline());
              const p = new PRPPipeline('./test.md'); (p as any).skipExecutionLoop = true;
              await p.executeBacklog();
              expect(p.totalTasks).toBe(1); expect(p.completedTasks).toBe(1);
              expect(p.currentPhase).toBe('backlog_complete');
      Test B: same mock; p.totalTasks=1; p.completedTasks=1; await p.runQACycle();
              expect(MockBugHuntWorkflow).toHaveBeenCalled();
              expect(p.currentPhase).not.toBe('qa_skipped');
      Test C: same mock; MockValidationWorkflow.mockImplementation(()=>({ run: vi.fn()
                .mockResolvedValue({success:true,exitCode:0,timedOut:false,stdout:'',stderr:'',
                scriptPath:'/plan/008_abc/validate.sh',durationMs:0}) }));
              mockValidateNestedExecution.mockImplementation(()=>{});
              mockIsNestedExecutionError.mockReturnValue(false);
              const p = new PRPPipeline('./test.md'); (p as any).skipExecutionLoop = true;
              const result = await p.run();
              expect(result.success).toBe(true);
              expect(MockValidationWorkflow).toHaveBeenCalled();   # validation ran
              expect(MockBugHuntWorkflow).toHaveBeenCalled();       # bug-hunt ran
              expect(result.totalTasks).toBe(1); expect(result.completedTasks).toBe(1);
  - VERIFY RED: `npx vitest run tests/unit/workflows/prp-pipeline.test.ts` → Test A fails
      (completedTasks stays 0 before Task 2). Tests B/C may pass pre-impl if the gate already
      holds (that's fine — they are regression guards); Test A is the load-bearing RED.

Task 2: MODIFY src/workflows/prp-pipeline.ts — extend S2's executeBacklog() skip guard
  - In executeBacklog() (:1225), REPLACE S2's skip-guard body (the `if (this.skipExecutionLoop)
    { … }` block S2 added as the FIRST statement) with the recompute version:
      if (this.skipExecutionLoop) {
        this.logger.info(
          '[PRPPipeline] Skipping execution loop (adopt mode / SKIP_EXECUTION_LOOP); validation + bug-hunt still run (PRD §4.6)'
        );
        // PRD §4.6: the adopted baseline is all-Complete. executeBacklog()'s body (which sets
        // completedTasks) is skipped, so recompute BOTH counts from the seeded registry so the
        // session reports complete and runQACycle() treats it as a normal completed session.
        this.totalTasks = this.#countTasks();
        this.completedTasks = this.#countCompletedTasks();
        this.currentPhase = 'backlog_complete';
        return;
      }
  - SCOPE: ONLY this guard body. Do NOT touch #runValidation, runQACycle, decomposePRD, or any
    other method. #countTasks/#countCompletedTasks are existing private helpers (:2526/:2552).
  - GOTCHA: if S2's guard is not yet present (S2 still in flight), implement the FULL guard
    above as the FIRST statement of executeBacklog() — it is a superset of S2's, so it is
    forward-compatible. (Confirm against S2's PRP Task 3c first.)

Task 3: VERIFY (validation gates)
  - RUN: `npm run validate` (lint + format:check + typecheck + test:run) → GREEN.
  - RUN: `npm run test:coverage` → 100% (skipExecutionLoop true branch covered by Test A;
      false branch by existing executeBacklog tests).
  - GREP-VERIFY scope: `git diff --name-only` → EXACTLY:
      src/workflows/prp-pipeline.ts, tests/unit/workflows/prp-pipeline.test.ts.
  - GREP guards (untouched): `git diff src/core/session-manager.ts
      src/workflows/validation-workflow.ts src/workflows/bug-hunt-workflow.ts src/cli/index.ts
      docs/CONFIGURATION.md` → EMPTY. `grep -n "process.env.SKIP_EXECUTION_LOOP" src` → still
      ONLY comments (no new env read).
```

### Implementation Patterns & Key Details

```typescript
// PATTERN: the S3 guard (extends S2's) — recompute BOTH counts so the session is "complete".
async executeBacklog(): Promise<void> {
  this.logger.info('[PRPPipeline] Executing backlog');
  // PRD §4.6 Adopt Mode: skip implementation while STILL running validation + bug hunt
  // (called later in run()). The adopted baseline is all-Complete, so recompute the counts
  // here — executeBacklog()'s body (which sets completedTasks) is never reached.
  if (this.skipExecutionLoop) {
    this.logger.info(
      '[PRPPipeline] Skipping execution loop (adopt mode / SKIP_EXECUTION_LOOP); validation + bug-hunt still run (PRD §4.6)'
    );
    this.totalTasks = this.#countTasks();           // 1 for the adopted baseline
    this.completedTasks = this.#countCompletedTasks(); // 1 (all-Complete) — fixes the stale-0 defect
    this.currentPhase = 'backlog_complete';
    return;
  }
  // …existing body (untouched)…
}

// PATTERN (why no other change is needed): the two downstream stages already run —
//   #runValidation(): called unconditionally from run() (:2430); comment :2424 "Runs in ALL
//                     modes". No skipExecutionLoop gate. Generates+runs validate.sh on the
//                     real codebase. (research §3)
//   runQACycle() normal mode: gate (:1558 totalTasks===0 → skip; :1564 !#allTasksComplete()
//                     → skip). For the adopted baseline totalTasks=1 and #allTasksComplete()
//                     reads the all-Complete in-memory registry ⇒ true ⇒ BugHuntWorkflow runs.
//                     (research §4)

// ANTI-PATTERN (forbidden): adding a skip/gate to #runValidation or runQACycle.
// ANTI-PATTERN (forbidden): reading process.env.SKIP_EXECUTION_LOOP (use the field).
// ANTI-PATTERN (forbidden): hand-rolling the count instead of #countTasks/#countCompletedTasks.
// ANTI-PATTERN (forbidden): adding delta special-casing for part (d) (holds by construction).
// ANTI-PATTERN (forbidden): touching SessionManager / validation/bug-hunt workflows / CLI / docs.
```

### Integration Points

```yaml
PIPELINE (src/workflows/prp-pipeline.ts):
  - MODIFY: executeBacklog() skipExecutionLoop guard body (recompute counts + log text).
  - CONSUME (from S2): this.skipExecutionLoop field + createAdoptedBaseline() (test fixture).
  - REUSE (unchanged): #countTasks()/:2526, #countCompletedTasks()/:2552, #runValidation()/:1489,
    runQACycle()/:1533, #allTasksComplete()/:2583, decomposePRD()/:1081.

NO DATABASE / NO ROUTES / NO NEW CLI FLAG (S1) / NO NEW CONFIG OR ENV CONSTANT / NO NEW
DEPENDENCY / NO DOCS / NO CHANGE TO SessionManager / validation-workflow / bug-hunt-workflow /
delta path. The only seam is S2's executeBacklog() guard.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run lint            # eslint . --ext .ts  → zero errors
npm run format:check    # prettier --check   → run `npm run format` to fix log-string reflow
npm run typecheck       # tsc --noEmit -p tsconfig.build.json → zero errors
npm run validate        # = lint && format:check && typecheck && test:run → GREEN

# Expected: zero errors. Watch for: a log string prettier wants to reflow; an unused import
# (createAdoptedBaseline if you switched to an inline fixture).
```

### Level 2: Unit Tests (Component Validation)

```bash
npx vitest run tests/unit/workflows/prp-pipeline.test.ts   # Tests A/B/C + S2's adopt tests + all existing
npx vitest run tests/unit/workflows/                        # full touched area

# Expected: all pass. If Test A fails (completedTasks stays 0) the recompute lines are missing
# or placed after the `return`. If Test B skips QA, the fixture's baseline isn't all-Complete
# (check createAdoptedBaseline / the inline fixture). If Test C doesn't invoke
# MockValidationWorkflow, the nested-execution guard threw — set mockValidateNestedExecution.
```

### Level 3: Integration Testing (System Validation)

```bash
npm run test:coverage
# MUST stay 100%. Confirm the skipExecutionLoop true branch is covered (Test A) and no new
# uncovered branch was introduced.

# Grep guards
grep -n "process.env.SKIP_EXECUTION_LOOP" src/workflows/prp-pipeline.ts   # ONLY comments (:200/:654/:666)
grep -n "this.completedTasks = this.#countCompletedTasks" src/workflows/prp-pipeline.ts  # present in the guard

# Scope guard
git diff --name-only
# Expected: EXACTLY src/workflows/prp-pipeline.ts + tests/unit/workflows/prp-pipeline.test.ts.
git diff --name-only | grep -E "session-manager\.ts|validation-workflow\.ts|bug-hunt-workflow\.ts|cli/|CONFIGURATION\.md|PRD\.md|tasks\.json"
# Expected: NO matches (forbidden files untouched).
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Behavioral reasoning (covered by Tests A/B/C; no live LLM needed for S3's path):
#   1. fresh + --adopt-prd → S2 seeds all-Complete baseline + .adopted + skipExecutionLoop=true.
#   2. decomposePRD() sees backlog.length>0 → "Existing backlog found, skipping" → totalTasks=1.
#   3. executeBacklog() skip guard → recomputes totalTasks=1/completedTasks=1 → backlog_complete.
#   4. #runValidation() → ValidationWorkflow generates + runs validate.sh on the REAL codebase.
#   5. runQACycle() → #allTasksComplete()=true → BugHuntWorkflow hunts the real codebase + PRD.
#   6. PipelineResult: completedTasks===totalTasks===1, success=true.
#   7. next PRD.md edit → hash mismatch → handleDelta → createDeltaSession(parent=adopted baseline).

# End-to-end CLI smoke (requires S1+S2 merged; no LLM in S3's logic, but validation/bug-hunt DO
# invoke agents — run in a throwaway dir if you want a live check):
#   rm -rf /tmp/adopt-smoke && mkdir -p /tmp/adopt-smoke && cp PRD.md /tmp/adopt-smoke/PRD.md && \
#     cd /tmp/adopt-smoke && PLAN_DIR=/tmp/adopt-smoke/plan \
#     node /home/dustin/projects/hacky-hack/dist/index.js -- --prd ./PRD.md --adopt-prd
# Expected: validate.sh runs; bug hunt runs; session reported complete. (Optional — Tests A/B/C
# are the authoritative automated proof; this is a manual sanity check.)
```

---

## Final Validation Checklist

### Technical Validation
- [ ] All 4 validation levels completed.
- [ ] `npm run validate` GREEN; `npm run test:coverage` 100%.
- [ ] `git diff --name-only` = exactly the 2 listed files.

### Feature Validation
- [ ] `executeBacklog()` skip guard recomputes `totalTasks` + `completedTasks` (1/1 for the adopted baseline).
- [ ] `#runValidation()` unchanged and still invoked from `run()` in adopt mode (Test C: `MockValidationWorkflow` called).
- [ ] `runQACycle()` does NOT skip for the adopted baseline (Test B/C: `MockBugHuntWorkflow` called; `currentPhase !== 'qa_skipped'`).
- [ ] Adopt-mode `run()` result reports `completedTasks === totalTasks === 1` (Test C).
- [ ] Next `PRD.md` edit → normal delta session (no production change; locked by existing delta tests).

### Code Quality Validation
- [ ] Mirrors existing patterns (field injection test style; `#countTasks`/`#countCompletedTasks` reuse; `createAdoptedBaseline` fixture).
- [ ] File placement matches the desired tree; no new dependency/config/env/CLI/doc.
- [ ] Anti-patterns avoided (no validation/QA gate; no env-var read; no hand-rolled count; no delta special-casing).

### Documentation & Deployment
- [ ] Inline comment in the guard cites PRD §4.6 + explains the recompute (why completedTasks would else stay 0).
- [ ] No standalone docs (work-item DOCS line: "none").

---

## Anti-Patterns to Avoid

- ❌ Don't add/remove a gate on `#runValidation()` or `runQACycle()` — validation runs always; QA's gate already passes for the adopted baseline (research §3/§4).
- ❌ Don't read `process.env.SKIP_EXECUTION_LOOP` — the mechanism is the `skipExecutionLoop` FIELD (S2 sets it); the env var is comments-only and wiring it violates the "no config surface change" line.
- ❌ Don't hand-roll the count — reuse `#countTasks()`/`#countCompletedTasks()` (they read the seeded registry).
- ❌ Don't forget to recompute `completedTasks` (not just `totalTasks`) — the stale-0 defect is the whole point of S3.
- ❌ Don't try to call `#runValidation()` directly from a test — it's `#`-private; test it at the `run()` level (Test C).
- ❌ Don't add delta special-casing for part (d) — it holds by construction (S2 reuses `initialize()`; `.adopted` is a marker) (research §6).
- ❌ Don't touch `SessionManager` / `validation-workflow.ts` / `bug-hunt-workflow.ts` / `cli/` / `docs/CONFIGURATION.md` / `PRD.md` / `tasks.json` — out of scope / S1/S2 territory.
- ❌ Don't write the guard change before Test A (breaks implicit-TDD).
- ❌ Don't duplicate the validation/QA workflow logic — S3 only recomputes counts and lets the existing stages run.

---

## Success Metrics

**Confidence Score: 9/10** — this is a surgical, single-site change (extend one guard body) with
a proven-correct rationale: (a) `research/run-flow-gate-analysis.md` proves validation runs
always + QA runs via `#allTasksComplete()` (so the ONLY real defect is the stale
`completedTasks`); (b) the fix reuses existing private counters (`#countTasks`/`#countCompletedTasks`)
that already read the seeded registry; (c) the test file's module mocks already cover every
`run()` dependency, so a run()-level end-to-end test (Test C) is feasible and is the strongest
proof of the work-item OUTPUT; (d) part (d) needs no code (delta detection is hash-based and
unaffected by `.adopted`). Residual risks (caught by Level 1/2): Test C being heavy if
`run()`'s `initializeSession` side effects resist mocking (fallback = Test A + Test B + the
"validation runs by construction" reasoning), or a coverage gap if the `skipExecutionLoop`
false branch isn't already covered (it is — existing `executeBacklog` tests). One-pass success
is highly likely.