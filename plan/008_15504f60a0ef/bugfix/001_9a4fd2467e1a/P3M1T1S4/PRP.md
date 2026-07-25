# PRP — P3.M1.T1.S4: Tests for numbered bugfix iteration lifecycle

---

## Goal

**Feature Goal**: Add an end-to-end **lifecycle** test suite proving the numbered
bugfix-iteration system works as a coherent whole across multiple QA iterations
— exercising S1's `nextBugfixDir` helper, S2's `runQACycle` numbered-creation
path, and S3's `#detectInterruptedBugfix` numbered-scan TOGETHER (contract
items 3a-e). S2 and S3 are each proven in **isolation** (S2: single-call
creation; S3: per-component detection); S4 proves the **multi-iteration
integration** neither covers: create `001` → create `002` (001 preserved) →
detect-most-recent-interrupted → detect-skips-healthy → resume-targets-correct-
numbered-dir. This is a **TEST-ONLY** task — zero source changes.

**Deliverable** (1 file):
- **`tests/unit/workflows/prp-pipeline.test.ts`** — ADD a new
  `describe('numbered bugfix iteration lifecycle', …)` block (placed AFTER the
  existing `describe('resume interrupted bugfix breakdowns', …)` suite, ≈line
  1113) with 5 lifecycle tests covering contract items 3a-e:
  1. **(3a)** Two-iteration creation: `runQACycle` ×2 on the same pipeline →
     `mkdir` called with `bugfix/001_<hash>/` then `bugfix/002_<hash>/`; BOTH
     receive `TEST_RESULTS.md` copy (`copyFile`); 001 is PRESERVED (not
     overwritten).
  2. **(3b)** (folded into 3a — second iteration preserves the first; OR a
     standalone assertion that after 2 calls the simulated disk contains both
     `001_*` and `002_*`).
  3. **(3c)** Detect-most-recent-interrupted: `bugfix/` has `001_<hash>/`
     (interrupted) + `002_<hash>/` (interrupted) → `runQACycle`'s detection
     returns `002_<hash>/` (most recent); `MockFixCycleWorkflow` called with
     `…/bugfix/002_<hash>/`; fresh `MockBugHuntWorkflow` NOT called (resume
     pre-empts).
  4. **(3d)** Detect-skips-healthy: `bugfix/` has `001_<hash>/` (healthy, valid
     tasks.json) + `002_<hash>/` (interrupted) → detection returns `002_<hash>/`
     (001 skipped); fresh hunt NOT called.
  5. **(3e)** Resume-targets-correct-numbered-dir (folded into 3c/3d — assert
     `MockFixCycleWorkflow` receives the EXACT `002_<hash>` path, not `001` and
     not flat `bugfix`); PLUS a single-healthy-child case: `001_<hash>/` healthy
     only → detection returns null → fresh hunt runs (`MockBugHuntWorkflow`
     called once).

**Success Definition**:
- Calling `runQACycle` twice on the same pipeline (mocked bug-hunt + fix each
  time, simulated advancing disk) results in `mkdir` calls for BOTH
  `bugfix/001_<12hex>/` and `bugfix/002_<12hex>/` — prior iteration preserved.
- When `bugfix/` has two interrupted numbered children, detection (via
  `runQACycle`, not just the private method) selects the MOST RECENT (`002`).
- When `bugfix/` has a healthy `001` + interrupted `002`, detection skips the
  healthy child and resumes `002`.
- When all numbered children are healthy, detection returns null and a fresh
  hunt runs.
- Resume (`MockFixCycleWorkflow`) is called with the EXACT interrupted numbered
  path (e.g. `…/bugfix/002_bbbbbbbbbbbb`), not `001` and not flat `bugfix`.
- `npm run validate` GREEN (S4 adds tests only — no source coverage risk from
  S4, but S4's tests must pass); 100% coverage on `src/**/*.ts` preserved.

---

## User Persona (if applicable)

**Target User**: The pipeline maintainers / future contributors who need
confidence that the numbered bugfix-iteration system (creation + detection +
resume) works end-to-end across multiple QA cycles — not just each piece in
isolation.
**Use Case**: A contributor refactors `runQACycle` or `#detectInterruptedBugfix`
and runs `npm run test:run`; the lifecycle suite catches a regression where, e.g.,
the 2nd iteration overwrites `001_` instead of creating `002_`, or detection
resumes `001` when `002` is the interrupted one.
**User Journey**: bug-hunt finds bugs → `bugfix/001_<hash>/` created & fixed →
2nd hunt finds more bugs → `bugfix/002_<hash>/` created (001 preserved on disk) →
crash mid-fix in `002` → restart → detection scans, skips healthy `001`, resumes
`002` with the correct numbered path.
**Pain Points Addressed**: PRD §4.4 step 3 / §5.1 mandate numbered iterations;
S2 and S3 implement creation + detection separately, but per the bugfix doc
Testing Summary (h2.4) "the full bug-fix iteration lifecycle also lacks
end-to-end coverage." S4 closes that gap with integration-style lifecycle tests.

---

## Why

- **PRD compliance**: PRD §4.4 step 3 — *"Each bug hunt iteration creates a new
  numbered session: `bugfix/001_hash/`, `bugfix/002_hash/`, etc."*; §5.1 —
  *"Session structure: `plan/NNN_hash/bugfix/NNN_hash/`"*. The bugfix doc Issue 4
  (h3.3) mandates numbered iterations; the Testing Summary (h2.4) explicitly
  calls out "the full bug-fix iteration lifecycle" as an area needing more
  attention. S4 is that coverage.
- **Mutual consistency**: the architecture doc (`bugfix_numbering.md`
  "Mutual Consistency Note") states creation + detection must be mutually
  consistent. S2 and S3 each test their OWN side; only a lifecycle suite proves
  they AGREE on the numbered layout end-to-end.
- **Contract item 4 (OUTPUT)**: *"Passing tests proving numbered iteration
  lifecycle works correctly. Tests run under `npm run test:run`."*

### Out of scope (hard fences)
- **Any source change** → NONE. S4 is TEST-ONLY. S1 (helper), S2 (creation),
  S3 (detection) own all source. S4 consumes them as contracts.
- **S2's single-call creation tests** (lines 814-933) → already landed; S4 does
  NOT duplicate them. S4's two-iteration test CHAINS calls + asserts
  preservation across them (the integration angle).
- **S3's per-component detection tests** (the updated resume suite, 936-1113) →
  S3 owns them. S4 exercises detection THROUGH `runQACycle` (end-to-end), not
  by calling the private `#detectInterruptedBugfix` directly.
- **README.md / docs/ARCHITECTURE.md** → P3.M1.T2.S1. S4 = no docs (contract
  item 5 DOCS: none — test-only).
- **`PRD.md` / `tasks.json` / `prd_snapshot.md` / `vitest.config.ts`** →
  READ-ONLY.
- **Other test files** (fix-cycle-workflow.test.ts, integration suites) →
  UNCHANGED. S4 adds ONLY to `tests/unit/workflows/prp-pipeline.test.ts`.

---

## What

### User-visible behavior
None (test-only; contract item 5 DOCS: none). The lifecycle suite runs under
`npm run test:run` and proves the numbered-iteration system works end-to-end.

### Technical requirements (exact contract — items 3a-e)

The new `describe('numbered bugfix iteration lifecycle', …)` block reuses the
existing module-level mocks (`MockBugHuntWorkflow`, `MockFixCycleWorkflow`,
`mockStat`, `mockReadFile`, the `readdir` ENOENT default) and the existing
factories (`createTestBacklog`, `createTestSession`, `createMockSessionManager`,
`createMockTaskOrchestrator`). It ALSO reuses the resume-suite helper shape
(`buildBugHuntPipeline`, `CLEAN_RESULTS`, `BUG_RESULTS`, `VALID_BACKLOG_JSON`)
— either by referencing them (if hoisted/accessible) or by defining local
lifecycle-scoped equivalents. The 5 tests:

**(3a + 3b) Two-iteration creation lifecycle (prior iteration preserved).**
Use a **simulated advancing disk** (FACT 4 Approach B): a closure-scoped
`diskChildren: string[]` that `mkdir`'s mock implementation pushes into, and
`readdir`'s mock implementation returns as Dirents. Each `runQACycle`:
detection sees no bug reports (all children healthy/absent → null) → fresh hunt
runs (bugs found) → creation calls `nextBugfixDir` (reads `readdir`) →
`mkdir` creates the numbered dir (pushed to `diskChildren`) → `TEST_RESULTS.md`
copied. Assert after 2 calls: `mkdir` called with paths matching
`/bugfix[\\/]001_[a-f0-9]{12}$/` AND `/bugfix[\\/]002_[a-f0-9]{12}$/`;
`diskChildren` contains BOTH `001_*` and `002_*` (001 preserved);
`copyFile` called twice targeting each numbered `TEST_RESULTS.md`.

**(3c) Detect-most-recent-interrupted across two interrupted children.**
Stub `readdir` to return `[{name:'001_aaaaaaaaaaaa',...},{name:'002_bbbbbbbbbbbb',...}]`.
Stub `mockStat` so BOTH children have `TEST_RESULTS.md` but BOTH lack
`tasks.json` (both interrupted). Call `runQACycle` once. Assert:
`MockFixCycleWorkflow` called with `expect.stringMatching(/bugfix[\\/]002_bbbbbbbbbbbb$/)`
(the MOST RECENT interrupted); `MockBugHuntWorkflow` NOT called (resume
pre-empted the fresh hunt).

**(3d) Detect-skips-healthy (healthy 001 + interrupted 002).**
Stub `readdir` to return both children. Stub `mockStat`+`mockReadFile` so
`001_` is HEALTHY (valid `VALID_BACKLOG_JSON` tasks.json) and `002_` is
interrupted (TEST_RESULTS.md present, tasks.json missing). Call `runQACycle`.
Assert: `MockFixCycleWorkflow` called with
`/bugfix[\\/]002_bbbbbbbbbbbb$/` (001 skipped); `MockBugHuntWorkflow` NOT called.

**(3d-variant / 3e-single) All-healthy → fresh hunt.**
Stub `readdir` to return `[{name:'001_aaaaaaaaaaaa',...}]`; stub `mockStat`+
`mockReadFile` so `001_` is HEALTHY. Call `runQACycle`. Assert: detection
returns null → `MockBugHuntWorkflow` called once (fresh hunt); resume did NOT
pre-empt.

**(3e) Resume targets the EXACT numbered dir (folded into 3c/3d + explicit).**
The 3c/3d assertions already pin the exact `002_bbbbbbbbbbbb` hash. Add an
explicit negative assertion in one of those tests:
`expect(MockFixCycleWorkflow).not.toHaveBeenCalledWith(
  expect.stringMatching(/bugfix[\\/]001_/), ...)` — resume did NOT target 001
or the flat dir.

### Success Criteria
- [ ] The lifecycle suite has 5 tests (3a/b creation-preservation, 3c
      most-recent-interrupted, 3d healthy-skip, 3d-variant all-healthy-fresh-hunt,
      3e exact-dir-targeting).
- [ ] Two-iteration test proves `mkdir` called for BOTH `001_` and `002_`, with
      001 preserved on the simulated disk.
- [ ] Most-recent-interrupted test proves detection (via `runQACycle`) selects
      `002` over `001` when both interrupted.
- [ ] Healthy-skip test proves a healthy `001` is skipped and `002` (interrupted)
      is resumed.
- [ ] All-healthy test proves detection returns null → fresh hunt runs.
- [ ] Resume-path assertions pin the EXACT numbered hash (`002_bbbbbbbbbbbb`),
      not `001` and not flat `bugfix`.
- [ ] `npm run validate` GREEN; 100% coverage on `src/**/*.ts` preserved.
- [ ] Zero source files changed (`git diff --name-only` shows only
      `tests/unit/workflows/prp-pipeline.test.ts`).

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_
**Yes.** This is a single-file, test-only addition. Correctness rests on nine
pre-proven facts (all pinned in the gap analysis + below): (1) the **existing
module-level mocks** (`MockBugHuntWorkflow`/`MockFixCycleWorkflow` casts at
181-182, `mockStat`/`mockReadFile` at 176-177, `readdir` ENOENT default at 27-29);
(2) the **existing factories** (`createTestSession(backlog, prd, sessionPath)`,
`createTestBacklog`, `createMockSessionManager`, `createMockTaskOrchestrator`);
(3) the **runQACycle fix-spawn setup pattern** (all-Complete backlog + `mode='bug-hunt'`
+ `MockBugHuntWorkflow(hasBugs:true)` + `MockFixCycleWorkflow(hasBugs:false)`,
lines 814-872); (4) the **resume-suite helper shape** (`buildBugHuntPipeline`,
`CLEAN_RESULTS`, `BUG_RESULTS`, `VALID_BACKLOG_JSON`, `stubMissingTasks`, lines
936-998); (5) the **S2 contract** — `runQACycle` calls `nextBugfixDir(sessionPath,
seed)` → `{dir, sequence}`; the `readdir` mock drives sequencing; (6) the **S3
contract** — `#detectInterruptedBugfix` calls `readdir(bugfixDir, {withFileTypes:true})`,
filters `/^\d{3}_/`, sorts DESC, applies `#isBugfixChildInterrupted` per child
(stat TEST_RESULTS.md → false if missing; stat/readFile/parse/BacklogReadSchema
tasks.json → true on any failure), returns most-recent interrupted or null; (7)
the **simulated-advancing-disk pattern** (FACT 4 Approach B — a closure
`diskChildren` array that `mkdir` pushes to and `readdir` returns); (8) the
**multi-child mockStat disambiguation** by NNN prefix (`s.includes('001_')`);
(9) the **runQACycle resume gate** (source lines 1795-1820: `mode!=='validate'` +
`SKIP_BUG_FINDING!=='true'` + `!sessionPath.includes('bugfix')` → detect → if dir,
resume via `#runBugFixCycle`, else fresh hunt).

### Documentation & References
```yaml
# MUST READ — the PRD spec (provided in selected_prd_content)
- docfile: PRD.md (bugfix doc)
  section: "Issue 4: Bugfix sessions use a flat bugfix/ directory" (h3.3) +
       "Testing Summary" (h2.4 — "the full bug-fix iteration lifecycle also lacks
       end-to-end coverage") + "Overview" (h2.0)
  why: Issue 4 is the normative rule; the Testing Summary explicitly names the
       lifecycle as the coverage gap S4 closes.
  critical: PRD §4.4 step 3 + §5.1 (numbered iterations) are what the lifecycle
            suite validates end-to-end.

# MUST READ — this subtask's research (proven facts about the live tree)
- docfile: plan/008_15504f60a0ef/bugfix/001_9a4fd2467e1a/P3M1T1S4/research/s4-codebase-analysis.md
  section: FACT 1 (S1/S2/S3 contracts + S3 not-yet-landed caveat), FACT 2 (exact
       factories + mock seams + line numbers), FACT 3 (what S2/S3 already cover +
       the lifecycle GAP), FACT 4 (simulated advancing disk — Approach A vs B),
       FACT 5 (multi-child mockStat disambiguation), FACT 6 (runQACycle resume
       gate source), FACT 7 (validation + scope), FACT 8 (hash assertion strategy)
  why: Proves the exact test patterns, the advancing-disk technique, the
       multi-child disambiguation, and precisely what's already covered (no dup).

# MUST READ — S2 contract (creation side; S4 exercises it across 2 iterations)
- docfile: plan/008_15504f60a0ef/bugfix/001_9a4fd2467e1a/P3M1T1S2/PRP.md
  section: "What §a/§d" (runQACycle calls nextBugfixDir; the numbered-dir creation
       test at prp-pipeline.test.ts:814; the 002_ test at 929) + "Known Gotchas"
       (readdir ENOENT default; MockFixCycleWorkflow 5th arg varies by env)
  why: S4's two-iteration test CHAINS the S2 creation pattern across calls +
       asserts preservation. S4 must NOT duplicate S2's single-call tests.

# MUST READ — S3 contract (detection side; S4 exercises it through runQACycle)
- docfile: plan/008_15504f60a0ef/bugfix/001_9a4fd2467e1a/P3M1T1S3/PRP.md
  section: "What §b/§c" (#detectInterruptedBugfix scans numbered children, sorts
       DESC, returns most-recent interrupted; #isBugfixChildInterrupted per-child
       contract) + "Implementation Patterns" (multi-child mockStat disambiguation
       by NNN; BacklogReadSchema lenient)
  why: S4's detect-most-recent + healthy-skip tests exercise S3's scan THROUGH
       runQACycle. S4 must use the NNN-disambiguation mockStat pattern S3
       specifies. S4 must NOT duplicate S3's private-method tests.

# MUST READ — S1 contract (the numbering primitive both sides consume)
- docfile: plan/008_15504f60a0ef/bugfix/001_9a4fd2467e1a/P3M1T1S1/PRP.md
  section: "What §a" (nextBugfixDir: ENOENT→seq 1, max+1; /^(\d{3})_/ regex;
       hashPRDContent(seed).slice(0,12) for the 12-hex suffix)
  why: S4's assertions on NNN (001/002) + 12-hex shape depend on S1's contract.
       The NNN comes from the dir LISTING (not the seed); the hash is the suffix.

# MUST READ — architecture reference (cited by the contract RESEARCH NOTE)
- docfile: plan/008_15504f60a0ef/bugfix/001_9a4fd2467e1a/architecture/bugfix_numbering.md
  section: "### Mutual Consistency Note" + "### Fix Strategy" step 2/3/4
  why: Confirms creation + detection must AGREE on numbered layout — the property
       S4's lifecycle suite proves end-to-end (the gap S2/S3 leave).

# THE FILE TO EDIT — tests (the lifecycle suite)
- file: tests/unit/workflows/prp-pipeline.test.ts
  section: ADD `describe('numbered bugfix iteration lifecycle', …)` AFTER the
       existing `describe('resume interrupted bugfix breakdowns', …)` suite
       (which ends ≈line 1113, before `describe('run', …)` at ≈1185). Reuse the
       module-level MockBugHuntWorkflow/MockFixCycleWorkflow/mockStat/mockReadFile
       + the readdir default. Define lifecycle-scoped helpers
       (buildLifecyclePipeline, disambiguated mockStat) inside the describe.
  why: This is the canonical home for runQACycle integration tests; the existing
       runQACycle + resume suites live here and provide the exact mocking
       patterns to mirror.
  pattern: the existing runQACycle fix-spawn test (814-872) for setup; the
       resume-suite helpers (936-998) for buildBugHuntPipeline/VALID_BACKLOG_JSON.
  gotcha: see Known Gotchas — the advancing-disk pattern, the NNN
       disambiguation, the MockFixCycleWorkflow 5th-arg `expect.anything()`, and
       the readdir-per-call chaining when S3's detection also calls readdir.

# CONTRACT INPUTS (read-only)
- file: src/workflows/prp-pipeline.ts
  section: runQACycle bugfix-dir creation (≈1858-1895) + resume gate (1795-1820)
       + #detectInterruptedBugfix (≈2054, currently flat — S3 will rewrite) +
       #runBugFixCycle (≈2021).
  why: Confirms the flow S4 exercises end-to-end: detect → (resume | fresh-hunt →
       create → fix). READ-ONLY (S4 changes NO source).
- file: src/core/session-utils.ts
  section: nextBugfixDir (S1) — confirms NNN from listing + 12-hex from seed.
  why: S4's assertions on NNN + 12-hex shape. READ-ONLY.
- file: vitest.config.ts
  why: 100/100/100/100 on src/**/*.ts — S4 adds NO source so introduces NO
       coverage risk; but S4's tests must PASS under `npm run test:run`.
- file: package.json
  why: npm run validate = lint + format:check + typecheck + test:run (green gate).
```

### Current Codebase tree (relevant slice)
```bash
src/
  workflows/
    prp-pipeline.ts            # READ-ONLY (S2/S3) — runQACycle creation + #detectInterruptedBugfix detection
  core/
    session-utils.ts           # READ-ONLY (S1) — nextBugfixDir
tests/
  unit/
    workflows/
      prp-pipeline.test.ts     # EDIT — +describe('numbered bugfix iteration lifecycle', …) (5 tests)
vitest.config.ts               # READ-ONLY — 100% coverage thresholds
package.json                   # READ-ONLY — npm run validate gate
PRD.md (bugfix doc)            # READ-ONLY — Issue 4 (h3.3) + Testing Summary (h2.4)
```

### Desired Codebase tree with files to be added and responsibility of file
```bash
tests/unit/workflows/prp-pipeline.test.ts   # MODIFIED — +lifecycle describe block (5 end-to-end tests)
# (no NEW files; no source changes)
```

### Known Gotchas of our codebase & Library Quirks
```ts
// CRITICAL (S3 not yet landed in source — treat its PRP as contract): the
//   current #detectInterruptedBugfix (prp-pipeline.ts:2054-2110) is STILL the
//   FLAT-dir version (no readdir scan, uses BacklogSchema). S4's lifecycle tests
//   ASSUME S3 lands: detection calls readdir(bugfixDir, {withFileTypes:true}),
//   scans NNN_ children. S4's tests will FAIL against the current flat source
//   until S3 lands. This is EXPECTED — S4 is "Researching" in parallel with S3
//   "Ready"; they land together as P3.M1.T1. S4's tests are written against the
//   S3 CONTRACT (the post-S3 behavior).

// CRITICAL (readdir is called by BOTH detection AND creation per runQACycle):
//   once S3 lands, each runQACycle issues up to TWO readdir calls — one from
//   #detectInterruptedBugfix (scan), one from nextBugfixDir (creation, only if
//   fresh hunt runs). The default readdir mock is ENOENT (→ detection null +
//   nextBugfixDir seq 1). For lifecycle tests that need DIFFERENT readdir results
//   across calls or across children, use mockImplementation (not just Once
//   chaining) so BOTH calls see the intended listing. The advancing-disk pattern
//   (FACT 4 Approach B) handles this cleanly: readdir always returns the current
//   diskChildren; mkdir pushes to it.

// CRITICAL (advancing-disk pattern for the two-iteration creation test): use a
//   closure `const diskChildren: string[] = []`; readdir returns it as Dirents;
//   mkdir's mockImplementation parses the NNN_hash from the path
//   (/bugfix[\\/](\d{3}_[a-f0-9]{12})$/) and pushes it. This simulates the
//   on-disk state advancing across runQACycle calls. REMEMBER to also stub
//   mockStat so detection sees NO bug reports in any child (all children
//   "healthy/absent" → detection null → fresh hunt → creation proceeds):
//     mockStat.mockImplementation(async (p) => {
//       const s = String(p);
//       if (s.endsWith('TEST_RESULTS.md')) { const e = new Error('ENOENT') as any; e.code='ENOENT'; throw e; }
//       return {};
//     });
//   RESET diskChildren + all mocks in beforeEach so tests are isolated.

// CRITICAL (multi-child mockStat disambiguates by NNN prefix): for 3c/3d, stub
//   mockStat/mockReadFile with `s.includes('001_')` vs `s.includes('002_')`
//   branches (FACT 5). The paths are …/bugfix/001_<hash>/TEST_RESULTS.md etc.,
//   so the NNN prefix is a reliable disambiguator. The hash bytes after NNN_ are
//   whatever you put in the readdir Dirent name — use a fixed fake like
//   '001_aaaaaaaaaaaa' / '002_bbbbbbbbbbbb' so assertions can pin the EXACT path.

// CRITICAL (assert the EXACT resumed path, including the hash): S3's
//   #detectInterruptedBugfix returns `resolve(bugfixDir, e.name)` — the EXACT
//   name from the readdir Dirent. So if you stub
//   `{name:'002_bbbbbbbbbbbb', isDirectory:()=>true}`, the resumed path is
//   …/bugfix/002_bbbbbbbbbbbb. Assert it exactly:
//     expect.stringMatching(/bugfix[\\/]002_bbbbbbbbbbbb$/)
//   AND a negative assertion:
//     expect(MockFixCycleWorkflow).not.toHaveBeenCalledWith(
//       expect.stringMatching(/bugfix[\\/]001_/), expect.anything(), ...)

// CRITICAL (MockFixCycleWorkflow 5th arg varies by env): the 5th constructor arg
//   is the parallel-research config ({parallelResearch, researchDepth} from
//   P3.M1.T1.S4-of-the-OTHER-plan, or expect.anything()). Use expect.anything()
//   for args 3-5 (orchestrator, sessionManager, parallelConfig) so the assertion
//   doesn't couple to env state. Mirror S2's existing tests (814-872).

// CRITICAL (mode='bug-hunt' is REQUIRED): without it, an all-Complete backlog
//   short-circuits runQACycle (QA skipped for completed sessions). The existing
//   tests set `(pipeline as any).mode = 'bug-hunt'` to force QA to run. S4's
//   lifecycle tests must do the same.

// CRITICAL (sessionPath must NOT contain 'bugfix' for detection to run): the
//   resume gate (prp-pipeline.ts:1799) suppresses detection if
//   sessionPath.includes('bugfix'). S4's lifecycle tests use a MAIN session path
//   (e.g. '/tmp/plan/008_lifecycle') that does NOT contain 'bugfix'. The
//   buildBugHuntPipeline helper (line 975) defaults to '/tmp/plan/008_test' —
//   safe. Do NOT use a path like '/tmp/plan/008_test/bugfix/...' for the MAIN
//   session (that's a child-session path; detection is suppressed there).

// GOTCHA (no source coverage risk from S4): S4 adds tests ONLY. The 100%
//   coverage gate applies to src/**/*.ts; S4 changes no source. But S4's tests
//   MUST pass or npm run validate fails. Run npx vitest run
//   tests/unit/workflows/prp-pipeline.test.ts during development.

// GOTCHA (beforeEach isolation): the module-level mocks (mockStat, mockReadFile,
//   readdir, MockBugHuntWorkflow, MockFixCycleWorkflow) persist across tests.
//   Each lifecycle test MUST reset/override them (mockClear + mockReset +
//   per-test mockImplementation). The existing resume suite uses a beforeEach
//   (line 990-998) to reset BugHunt/FixCycle defaults — mirror that pattern in
//   the lifecycle describe. Reset diskChildren = [] in beforeEach for the
//   advancing-disk test.

// GOTCHA (copyFile assertion for TEST_RESULTS.md preservation): the two-iteration
//   test can assert copyFile was called with a dest matching
//   /bugfix[\\/]\d{3}_[a-f0-9]{12}[\\/]TEST_RESULTS.md$/ for BOTH iterations.
//   This proves TEST_RESULTS.md is copied into EACH numbered dir (not just the
//   latest). Use expect.arrayContaining or two separate toHaveBeenCalledWith
//   assertions (copyFile is called once per runQACycle in the creation path).

// GOTCHA (don't duplicate S2/S3): S2 covers single-call creation (814-933); S3
//   covers per-component detection (the updated resume suite). S4's value is the
//   INTEGRATION — chaining runQACycle calls + exercising creation+detection
//   TOGETHER. If a lifecycle test would be identical to an S2 or S3 test, it
//   belongs to that sibling, not S4. S4's distinguishing angle: multi-call +
//   cross-component.
```

---

## Implementation Blueprint

### Data models and structure
No data models. S4 uses the existing test factories (`createTestBacklog`,
`createTestSession`, `createTestPhase/Milestone/Task/Subtask`,
`createMockSessionManager`, `createMockTaskOrchestrator`) and the existing
mock cast objects (`MockBugHuntWorkflow`, `MockFixCycleWorkflow`, `mockStat`,
`mockReadFile`). The only new structures are closure-scoped test helpers inside
the new describe block (`diskChildren`, a `buildLifecyclePipeline` factory, a
`stubChildState(seq, state)` helper).

### Implementation Tasks (ordered by dependencies)
```yaml
Task 1: ADD describe('numbered bugfix iteration lifecycle', …) scaffold
  - INSERT a new describe block AFTER the existing 'resume interrupted bugfix
    breakdowns' suite (≈line 1113) and BEFORE 'run' (≈1185).
  - INSIDE the describe, define lifecycle-scoped helpers:
      * const VALID_BACKLOG_JSON = JSON.stringify(createTestBacklog([createTestPhase('P1','Phase 1','Planned')]));
        (or reference the resume-suite constant if hoisted — define locally to be safe)
      * const buildLifecyclePipeline = (sessionPath = '/tmp/plan/008_lifecycle') => { ... }
        (mirror buildBugHuntPipeline at line 975: all-Complete backlog, mockManager,
         pipeline wiring, mode='bug-hunt'). CRITICAL: sessionPath must NOT contain 'bugfix'.
      * const resetFsMocks = () => { mockStat.mockReset(); mockReadFile.mockReset(); ... }
  - ADD a beforeEach that resets MockBugHuntWorkflow/MockFixCycleWorkflow to
    defaults (mirror resume-suite beforeEach at 990-998) + resets any
    diskChildren array.
  - FOLLOW pattern: the existing resume-suite structure (936-998).
  - GOTCHA: do NOT shadow the module-level VALID_BACKLOG_JSON if it's in scope;
    if unsure, use a distinct name (LIFECYCLE_VALID_BACKLOG_JSON).

Task 2: ADD test (3a+3b) — two-iteration creation, prior preserved
  - Use the advancing-disk pattern (FACT 4 Approach B):
      const diskChildren: string[] = [];
      const { readdir, mkdir } = await import('node:fs/promises');
      vi.mocked(readdir).mockImplementation(async () =>
        diskChildren.map(name => ({ name, isDirectory: () => true }) as any)
      );
      vi.mocked(mkdir).mockImplementation(async (p: any) => {
        const m = String(p).match(/bugfix[\\/](\d{3}_[a-f0-9]{12})$/);
        if (m) diskChildren.push(m[1]);
        return undefined;
      });
      // detection sees no bug reports → null → fresh hunt each time
      mockStat.mockImplementation(async (p: any) => {
        if (String(p).endsWith('TEST_RESULTS.md')) {
          const e = new Error('ENOENT') as any; e.code = 'ENOENT'; throw e;
        }
        return {};
      });
  - Wire MockBugHuntWorkflow(hasBugs:true, bugs:[...]) + MockFixCycleWorkflow(hasBugs:false).
  - const pipeline = buildLifecyclePipeline();
  - await pipeline.runQACycle();  // creates 001_
  - await pipeline.runQACycle();  // sees 001_, creates 002_
  - ASSERT:
      expect(vi.mocked(mkdir)).toHaveBeenCalledWith(
        expect.stringMatching(/bugfix[\\/]001_[a-f0-9]{12}$/), { recursive: true });
      expect(vi.mocked(mkdir)).toHaveBeenCalledWith(
        expect.stringMatching(/bugfix[\\/]002_[a-f0-9]{12}$/), { recursive: true });
      // 001 preserved on simulated disk:
      expect(diskChildren.filter(n => n.startsWith('001_'))).toHaveLength(1);
      expect(diskChildren.filter(n => n.startsWith('002_'))).toHaveLength(1);
      // TEST_RESULTS.md copied into EACH numbered dir:
      const { copyFile } = await import('node:fs/promises');
      expect(vi.mocked(copyFile)).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringMatching(/bugfix[\\/]001_[a-f0-9]{12}[\\/]TEST_RESULTS\.md$/));
      expect(vi.mocked(copyFile)).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringMatching(/bugfix[\\/]002_[a-f0-9]{12}[\\/]TEST_RESULTS\.md$/));
  - FOLLOW pattern: S2's numbered-dir test (814-872) for the fix-spawn setup.
  - GOTCHA: readdir is called by BOTH detection + creation per runQACycle; the
    advancing-disk mockImplementation handles both uniformly. RESET diskChildren
    in beforeEach.

Task 3: ADD test (3c) — detect-most-recent-interrupted (both interrupted)
  - Stub readdir to return TWO interrupted children:
      vi.mocked(readdir).mockResolvedValue([
        { name: '001_aaaaaaaaaaaa', isDirectory: () => true },
        { name: '002_bbbbbbbbbbbb', isDirectory: () => true },
      ] as any);
  - Stub mockStat so BOTH have TEST_RESULTS.md but BOTH lack tasks.json:
      mockStat.mockImplementation(async (p: any) => {
        const s = String(p);
        if (s.endsWith('TEST_RESULTS.md')) return {};      // both have reports
        // tasks.json for either child → ENOENT (interrupted)
        const e = new Error('ENOENT') as any; e.code = 'ENOENT'; throw e;
      });
  - const pipeline = buildLifecyclePipeline();
  - await pipeline.runQACycle();
  - ASSERT:
      expect(MockFixCycleWorkflow).toHaveBeenCalledWith(
        expect.stringMatching(/bugfix[\\/]002_bbbbbbbbbbbb$/),  // MOST RECENT
        expect.any(String), expect.anything(), expect.anything(), expect.anything());
      expect(MockBugHuntWorkflow).not.toHaveBeenCalled();  // resume pre-empted
  - FOLLOW pattern: the resume-suite stubMissingTasks (997) but NNN-disambiguated
    for multi-child.
  - GOTCHA: S3 sorts NNN DESC + returns FIRST interrupted → 002 wins. The hash
    bytes ('bbbbbbbbbbbb') are from YOUR readdir Dirent name, so pin them exactly.

Task 4: ADD test (3d) — detect-skips-healthy (001 healthy, 002 interrupted)
  - Stub readdir to return both children (same as Task 3).
  - Stub mockStat + mockReadFile with NNN disambiguation (FACT 5):
      mockStat.mockImplementation(async (p: any) => {
        const s = String(p);
        if (s.includes('001_')) return {};                              // 001 healthy (both files)
        if (s.includes('002_') && s.endsWith('TEST_RESULTS.md')) return {}; // 002 has report
        const e = new Error('ENOENT') as any; e.code = 'ENOENT'; throw e;  // 002 tasks.json missing
      });
      mockReadFile.mockImplementation(async (p: any) => {
        if (String(p).includes('001_')) return VALID_BACKLOG_JSON;      // 001 valid
        return '';                                                       // 002 unreadable (not reached)
      });
  - const pipeline = buildLifecyclePipeline();
  - await pipeline.runQACycle();
  - ASSERT:
      expect(MockFixCycleWorkflow).toHaveBeenCalledWith(
        expect.stringMatching(/bugfix[\\/]002_bbbbbbbbbbbb$/),  // 001 SKIPPED
        expect.any(String), expect.anything(), expect.anything(), expect.anything());
      expect(MockBugHuntWorkflow).not.toHaveBeenCalled();
      // 3e negative: resume did NOT target 001 or flat bugfix
      expect(MockFixCycleWorkflow).not.toHaveBeenCalledWith(
        expect.stringMatching(/bugfix[\\/]001_/),
        expect.any(String), expect.anything(), expect.anything(), expect.anything());
  - GOTCHA: VALID_BACKLOG_JSON must pass BacklogReadSchema (lenient) for 001 to
    be "healthy". createTestBacklog([createTestPhase(...)]) yields a valid shape.

Task 5: ADD test (3d-variant) — all-healthy → fresh hunt
  - Stub readdir to return [{name:'001_aaaaaaaaaaaa', isDirectory:()=>true}].
  - Stub mockStat + mockReadFile so 001 is HEALTHY (VALID_BACKLOG_JSON).
  - const pipeline = buildLifecyclePipeline();
  - await pipeline.runQACycle();
  - ASSERT: detection null → fresh hunt:
      expect(MockBugHuntWorkflow).toHaveBeenCalledTimes(1);
      // FixCycle NOT called by resume (BugHunt default CLEAN → no fix-spawn):
      expect(MockFixCycleWorkflow).not.toHaveBeenCalled();
  - GOTCHA: this mirrors S3's "runs a fresh hunt when the dir is HEALTHY" test
    (line ~1085) BUT through the lifecycle describe + a numbered child. Ensure
    it's not an EXACT duplicate — the lifecycle angle is "numbered child, healthy,
    fresh hunt". If it duplicates S3's test exactly, drop it and rely on S3.
    (S4's distinguishing value is the multi-child + multi-call tests; this single-
    healthy case is borderline — include it only if S3 doesn't already cover a
    NUMBERED healthy child. Prefer the multi-child tests as the core deliverable.)

Task 6: VERIFY — no regressions + no source changes
  - RUN npm run typecheck → exit 0 (test-only; new describe compiles).
  - RUN npx vitest run tests/unit/workflows/prp-pipeline.test.ts → ALL green
    (existing runQACycle + resume suites UNCHANGED + new lifecycle tests green).
    NOTE: the lifecycle detection tests (3c/3d) require S3 to have landed (the
    numbered #detectInterruptedBugfix scan). If S3 has NOT landed yet, these
    tests will FAIL against the flat-dir source — that's expected (S3+S4 land
    together). Run them after S3 lands.
  - RUN npx vitest run --coverage → 100/100/100/100 on src/**/*.ts (S4 adds no
    source → no coverage change).
  - RUN npm run validate → GREEN.
  - VERIFY zero source files changed: git diff --name-only → ONLY
    tests/unit/workflows/prp-pipeline.test.ts.
```

### Implementation Patterns & Key Details
```ts
// PATTERN: advancing-disk for two-iteration creation (Task 2):
const diskChildren: string[] = [];
const { readdir, mkdir } = await import('node:fs/promises');
vi.mocked(readdir).mockImplementation(async () =>
  diskChildren.map(name => ({ name, isDirectory: () => true }) as any));
vi.mocked(mkdir).mockImplementation(async (p: any) => {
  const m = String(p).match(/bugfix[\\/](\d{3}_[a-f0-9]{12})$/);
  if (m) diskChildren.push(m[1]);
  return undefined;
});
mockStat.mockImplementation(async (p: any) => {
  if (String(p).endsWith('TEST_RESULTS.md')) {
    const e = new Error('ENOENT') as any; e.code = 'ENOENT'; throw e;  // no reports → detection null
  }
  return {};
});
await pipeline.runQACycle();  // creates 001_ → disk=['001_<hash>']
await pipeline.runQACycle();  // sees 001_, creates 002_ → disk=['001_<hash>','002_<hash>']

// PATTERN: NNN-disambiguated multi-child mockStat (Tasks 3/4):
mockStat.mockImplementation(async (p: any) => {
  const s = String(p);
  if (s.includes('001_')) return {};                                   // 001 healthy
  if (s.includes('002_') && s.endsWith('TEST_RESULTS.md')) return {};  // 002 has report
  const e = new Error('ENOENT') as any; e.code = 'ENOENT'; throw e;    // 002 tasks.json missing
});
vi.mocked(readdir).mockResolvedValue([
  { name: '001_aaaaaaaaaaaa', isDirectory: () => true },
  { name: '002_bbbbbbbbbbbb', isDirectory: () => true },
] as any);
// EXPECT: detection returns …/bugfix/002_bbbbbbbbbbbb (002 interrupted, 001 skipped)

// PATTERN: exact resumed-path assertion (Task 4 / contract 3e):
expect(MockFixCycleWorkflow).toHaveBeenCalledWith(
  expect.stringMatching(/bugfix[\\/]002_bbbbbbbbbbbb$/),  // EXACT interrupted child
  expect.any(String), expect.anything(), expect.anything(), expect.anything());
expect(MockFixCycleWorkflow).not.toHaveBeenCalledWith(
  expect.stringMatching(/bugfix[\\/]001_/),               // NOT the healthy child
  expect.any(String), expect.anything(), expect.anything(), expect.anything());

// CRITICAL: S4 is TEST-ONLY — zero source changes.
// CRITICAL: S3 must land for the detection lifecycle tests (3c/3d) to pass.
// CRITICAL: mode='bug-hunt' + sessionPath NOT containing 'bugfix' (detection gate).
// CRITICAL: MockFixCycleWorkflow args 3-5 = expect.anything() (env-coupled).
// CRITICAL: advancing-disk mockImplementation handles readdir-from-both-paths.
// CRITICAL: NNN-disambiguate multi-child mockStat by s.includes('NNN_').
// CRITICAL: reset diskChildren + all mocks in beforeEach (test isolation).
```

### Integration Points
```yaml
TESTS (tests/unit/workflows/prp-pipeline.test.ts):
  - add: describe('numbered bugfix iteration lifecycle', …) after the resume
    suite (≈line 1113), before 'run' (≈1185).
  - add: 5 lifecycle tests (3a/b two-iteration creation, 3c most-recent-interrupted,
    3d healthy-skip, 3d-variant all-healthy, 3e exact-dir via negative assertion).
  - reuse: module-level MockBugHuntWorkflow/MockFixCycleWorkflow/mockStat/mockReadFile/readdir.

NO SOURCE CHANGE: S4 touches NO src/ files (S1/S2/S3 own all source).
NO OTHER TEST FILES: only tests/unit/workflows/prp-pipeline.test.ts.
NO DOCS (contract item 5 DOCS: none — test-only).
NO PRD.md / NO tasks.json / NO prd_snapshot.md / NO vitest.config.ts.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
npm run typecheck        # tsc --noEmit → exit 0 (new describe + helpers compile)
npm run lint             # eslint . --ext .ts → no new violations
npm run format:check     # prettier --check; run `npm run format` if it complains
# Expected: Zero errors. Test-only addition; mirrors existing patterns.
```

### Level 2: Unit Tests (Component Validation)
```bash
npx vitest run tests/unit/workflows/prp-pipeline.test.ts   # existing suites UNCHANGED + new lifecycle tests green
# NOTE: the detection lifecycle tests (3c/3d) require S3's numbered scan to have
# landed in source. If running before S3 lands, those tests fail against the
# flat-dir source — expected (S3+S4 land together as P3.M1.T1).
npx vitest run --coverage                                  # 100/100/100/100 (S4 adds no source)
npm run test:run                                           # full suite green
# Expected: ALL green after S3 lands. The lifecycle tests prove creation+detection
# work together across multiple iterations.
```

### Level 3: Integration Testing (System Validation)
```bash
npm run validate      # lint + format:check + typecheck + test:run → GREEN (after S3 lands)
npm run build         # tsc -p tsconfig.build.json → succeeds (test-only; no build impact)

# Confirm zero source changed:
git diff --name-only src/   # EXPECT: empty (S4 is test-only)
```

### Level 4: Creative & Domain-Specific Validation
```bash
# Confirm the lifecycle describe block exists:
rg -n "describe\('numbered bugfix iteration lifecycle'" tests/unit/workflows/prp-pipeline.test.ts  # EXPECT: 1

# Confirm the 5 lifecycle tests exist (by name/keyword):
rg -n "two-iteration|preserved|most.recent.interrupted|skips.healthy|all.healthy|exact.*numbered" \
  tests/unit/workflows/prp-pipeline.test.ts   # EXPECT: ≥5 matches across the new tests

# Confirm the advancing-disk pattern is used:
rg -n "diskChildren" tests/unit/workflows/prp-pipeline.test.ts   # EXPECT: ≥3 (decl + mkdir push + readdir return + assertion)

# Confirm NNN-disambiguation is used in multi-child tests:
rg -n "includes\('001_'\)|includes\('002_'\)" tests/unit/workflows/prp-pipeline.test.ts  # EXPECT: ≥2

# Confirm exact-resumed-path assertions:
rg -n "002_bbbbbbbbbbbb" tests/unit/workflows/prp-pipeline.test.ts   # EXPECT: ≥2 (Dirent name + assertion)

# Confirm NO source files changed:
git diff --name-only   # EXPECT: ONLY tests/unit/workflows/prp-pipeline.test.ts
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` exit 0.
- [ ] `npm run validate` GREEN (after S3 lands; lint + format:check + typecheck + test:run).
- [ ] 100% coverage on `src/**/*.ts` preserved (S4 adds no source → no risk).
- [ ] Zero source files changed (`git diff --name-only src/` empty).

### Feature Validation
- [ ] Two-iteration test proves `mkdir` called for BOTH `001_` and `002_`, with
      001 preserved on the simulated disk + `TEST_RESULTS.md` copied into each.
- [ ] Most-recent-interrupted test proves detection (via `runQACycle`) selects
      `002` over `001` when both interrupted; fresh hunt NOT called.
- [ ] Healthy-skip test proves a healthy `001` is skipped and `002` (interrupted)
      is resumed; fresh hunt NOT called.
- [ ] All-healthy test proves detection returns null → fresh hunt runs (if not
      duplicative of S3's existing healthy-child test).
- [ ] Resume-path assertions pin the EXACT numbered hash (`002_bbbbbbbbbbbb`),
      with a negative assertion that `001` was NOT targeted.

### Code Quality Validation
- [ ] New `describe('numbered bugfix iteration lifecycle', …)` placed after the
      resume suite, before 'run'.
- [ ] Reuses module-level mocks + existing factories (no new vi.mock blocks).
- [ ] `beforeEach` resets mocks + `diskChildren` for test isolation.
- [ ] `mode='bug-hunt'` + sessionPath NOT containing 'bugfix' (detection gate).
- [ ] MockFixCycleWorkflow args 3-5 use `expect.anything()` (env-coupled).
- [ ] No duplication of S2's single-call creation tests or S3's per-component
      detection tests (S4's angle: multi-call + cross-component).

### Documentation & Deployment
- [ ] No docs changes (contract item 5 DOCS: none — test-only).
- [ ] No new env vars, no source, no config.

---

## Anti-Patterns to Avoid
- ❌ Don't **change any source file** — S4 is TEST-ONLY. S1 (helper), S2
  (creation), S3 (detection) own all source. `git diff --name-only src/` must be
  empty.
- ❌ Don't **duplicate S2's single-call creation tests** (814-933) or **S3's
  per-component detection tests** (the updated resume suite). S4's value is the
  INTEGRATION: chaining `runQACycle` calls + exercising creation+detection
  TOGETHER. If a proposed test is identical to an S2/S3 test, it belongs to that
  sibling.
- ❌ Don't **forget the advancing-disk pattern needs detection to see NO bug
  reports** in the two-iteration creation test — stub `mockStat` to ENOENT for
  any `TEST_RESULTS.md` path so detection returns null → fresh hunt → creation
  proceeds. Otherwise detection sees a "report" in a child that doesn't exist on
  the simulated disk and short-circuits.
- ❌ Don't **chain `mockResolvedValueOnce` for readdir without accounting for the
  TWO readdir calls per runQACycle** (detection + creation, once S3 lands). Use
  `mockImplementation` (the advancing-disk closure) so BOTH calls see the
  intended listing uniformly.
- ❌ Don't **assert the resumed path without the hash bytes** — S3's
  `#detectInterruptedBugfix` returns `resolve(bugfixDir, e.name)`, i.e. the EXACT
  Dirent name. Use a fixed fake hash (`002_bbbbbbbbbbbb`) in the readdir mock and
  pin it in the assertion (`/bugfix[\\/]002_bbbbbbbbbbbb$/`).
- ❌ Don't **omit the negative assertion** for 3e — proving resume did NOT target
  `001` (or flat `bugfix`) is as important as proving it targeted `002`. Use
  `expect(MockFixCycleWorkflow).not.toHaveBeenCalledWith(expect.stringMatching(
  /bugfix[\\/]001_/), ...)`.
- ❌ Don't **use a sessionPath containing 'bugfix'** for the MAIN session — the
  resume gate (prp-pipeline.ts:1799) suppresses detection. Use a main-session
  path like `/tmp/plan/008_lifecycle`.
- ❌ Don't **forget `mode='bug-hunt'`** — without it, an all-Complete backlog
  short-circuits runQACycle. Mirror the existing tests.
- ❌ Don't **hardcode the parallel-config 5th arg** of MockFixCycleWorkflow — it
  varies by env. Use `expect.anything()` for args 3-5.
- ❌ Don't **skip `beforeEach` reset** — the module-level mocks persist across
  tests; failing to reset them causes cross-test bleed (flaky failures). Reset
  `diskChildren = []` and all mock states.
- ❌ Don't **expect the detection lifecycle tests to pass before S3 lands** —
  they require the numbered `#detectInterruptedBugfix` scan. S3+S4 land together
  as P3.M1.T1; the tests are written against the S3 CONTRACT.
- ❌ Don't touch PRD.md, tasks.json, prd_snapshot.md, or vitest.config.ts.

---

## Confidence Score

**8/10** — One-pass success likelihood is high. S4 is a single-file, test-only
addition with zero source risk. Every pattern is pinned to a named exemplar: the
runQACycle fix-spawn setup (lines 814-872), the resume-suite helpers (936-998),
S2's `002_` test (929, for the readdir override + NNN assertion), and S3's
multi-child mockStat disambiguation (FACT 5). The advancing-disk pattern (FACT 4
Approach B) cleanly handles the "on-disk state advancing across runQACycle calls"
challenge that is the core of the two-iteration creation test. The scope fences
are airtight: S4 edits ONLY `tests/unit/workflows/prp-pipeline.test.ts`.

The two notable risks, both explicitly mitigated: (1) **S3 has not yet landed in
source** — the current `#detectInterruptedBugfix` is still the flat-dir version,
so the detection lifecycle tests (3c/3d) will FAIL until S3 lands. This is
expected (the `<plan_status>` shows S3 "Ready" + S4 "Researching" running in
parallel; they land together as P3.M1.T1). The PRP explicitly states the tests
are written against the S3 CONTRACT. (2) **the readdir-from-two-paths-per-call
subtlety** (detection + creation both call readdir once S3 lands) — mitigated by
recommending `mockImplementation` (the advancing-disk closure) over fragile
`mockResolvedValueOnce` chaining, so both calls see the intended listing. Zero
file overlap with S1 (session-utils), S2 (source runQACycle), or S3 (source
detection + the resume-suite tests) — S4 adds a NEW describe block in the same
test file but does not modify the existing suites.