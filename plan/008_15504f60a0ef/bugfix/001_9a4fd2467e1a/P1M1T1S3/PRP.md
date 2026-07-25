# PRP — P1.M1.T1.S3: Integration test — full `handleDelta` → `spawnDeltaSession` → `decomposePRD` with a non-empty parent backlog

> Bugfix 001, **Issue 1 (CRITICAL)** acceptance test. S1 (LANDED) reordered `decomposePRD()` so
> the delta branch is reachable; S2 (CONTRACT — assume landed) adds `mergeBacklogs(...)` at the
> `saveBacklog` seam so the delta `tasks.json` ends up with BOTH patched statuses AND new
> added-requirement tasks. **S3 is the integration test that PROVES it end-to-end** with the
> NON-EMPTY parent backlog precondition that masked the bug in `delta-prd.test.ts` CASE A. Test-only;
> no production code or docs change.

---

## Goal

**Feature Goal**: Add a passing integration test that drives the FULL delta-breakdown path —
`handleDelta()` → (default) `spawnDeltaSession()` → `decomposePRD()` — starting from a parent
session with a **non-empty** backlog (≥1 Phase, ≥1 Task), and asserts: (d) the Architect breakdown
runs over **`delta_prd.md`** content (NOT the full PRD / `prdSnapshot`), (e) the delta session's
`tasks.json` contains NEW tasks for the ADDED requirement (not just the parent's patched tasks), and
(f) existing MODIFIED tasks are still `Planned` and REMOVED tasks are `Obsolete` (patched statuses
survived the S2 merge). This is the regression lock that prevents the dead-branch bug from recurring.

**Deliverable**:
1. **`tests/integration/core/delta-breakdown-integration.test.ts`** — NEW integration test file
   (distinct from the unit `tests/unit/core/delta-prd.test.ts` and the integration `delta-session.test.ts`).
   Real tmpdir file I/O + mocked agents/SessionManager (stateful), mirroring `delta-prd.test.ts`'s
   `vi.mock` surface and extending it for the full path.

**Success Definition**:
- The test seeds a **non-empty** parent backlog (Phase/Milestone/Task), creates a delta with an
  `'added'` RequirementChange (+ `'modified'` + `'removed'`), and drives `handleDelta()` then
  `decomposePRD()` against a real tmpdir layout.
- `createArchitectPrompt` is called exactly once, and its **first argument** equals the `delta_prd.md`
  content (contains `# Delta PRD` + `## Added` + the added `itemId`), NOT the full PRD and NOT the
  parent `prdSnapshot` — proving `hasBacklog` did NOT short-circuit the delta branch.
- The delta session's final `tasks.json` contains a NEW task for the added requirement (e.g.
  `P1.M2.T1`) that did NOT exist in the parent, AND the modified task (`P1.M1.T1`) is `Planned` and
  the removed task (`P1.M1.T2`) is `Obsolete`.
- `npx vitest run tests/integration/core/delta-breakdown-integration.test.ts` is GREEN.
- `tests/unit/core/delta-prd.test.ts` (S1/S2 regression) + `tests/unit/core/backlog-merger.test.ts`
  (S2) stay GREEN; `npm run typecheck && npm run lint && npm run format:check` clean.

---

## Why

- **Locks in the Issue-1 fix.** S1 made the delta branch reachable; S2 made its output correct
  (merge). Without an end-to-end test using the REAL precondition (non-empty parent backlog), a
  future refactor could re-introduce the `hasBacklog`-before-`isDelta` ordering and silently drop
  added requirements again — exactly as the original `delta-prd.test.ts` CASE A masked it (empty
  backlog never occurs in production). PRD §4.3 step 5 ("Breakdown MUST consume the delta PRD") and
  step 6 ("Identifies new requirements → Adds new tasks") need a concrete regression lock.
- **Proves the merge, not just the reorder.** Assertion (f) (modified→Planned, removed→Obsolete
  survive) is only satisfiable if S2's merge ran — so the test also guards S2 against regression.
- **Fills the documented coverage gap.** The bug report's Testing Summary explicitly calls out:
  "The end-to-end delta workflow (handleDelta → createDeltaSession → writeDeltaPRD → decomposePRD)
  is not covered by a realistic integration test." This is that test.
- **Scope discipline.** S3 writes ONLY a test file. It does NOT modify `prp-pipeline.ts`,
  `backlog-merger.ts`, `task-patcher.ts`, or any production code. It does NOT touch the existing
  `delta-prd.test.ts` (S1/S2 regression-locked) or `delta-session.test.ts`.

---

## What

### User-visible behavior
None (test-only). Indirectly: this is the acceptance gate for "editing PRD.md to ADD a requirement
now produces new tasks in the delta session."

### Technical requirements (exact contract)

**File — `tests/integration/core/delta-breakdown-integration.test.ts`** (NEW). A single
`describe('delta breakdown — full handleDelta → spawnDeltaSession → decomposePRD (non-empty parent backlog)')`
with (at minimum) the cases below. Real tmpdir (`mkdtempSync`/`rmSync` in before/afterEach); the
`vi.mock` surface mirrors `tests/unit/core/delta-prd.test.ts` and EXTENDS it for the full path.

**Mock surface (hoisted `vi.mock`, self-contained or via `vi.hoisted`):**
- `agents/prompts/architect-prompt.js` → `createArchitectPrompt` SPY (assert 1st arg).
- `agents/agent-factory.js` → `createArchitectAgent` returns `{ prompt: vi.fn() }` whose impl
  WRITES `tasks.json` (the architect's added-req output) to the delta session dir and resolves
  `{ status: 'success', output: '' }`. Path is shared via `vi.hoisted` (see Blueprint §3).
- `workflows/delta-analysis-workflow.js` → `DeltaAnalysisWorkflow` constructor returns `{ run: vi.fn() }`
  resolving a `DeltaAnalysis` with `changes = [modified, removed, added]`.
- `core/task-patcher.js` → `patchBacklog` returns a NON-EMPTY patched backlog (modified→Planned,
  removed→Obsolete); structure preserved.
- `utils/task-utils.js` → `filterByStatus` returns `[]` (no completed tasks → simpler render).
- `core/session-manager.js` → `SessionManager` class is a bare `vi.fn()` (the real constructor's
  instance is overwritten — see Blueprint §3 — with a **stateful** mock whose `currentSession` is a
  live getter, `createDeltaSession` switches it to the delta session + `mkdirSync`s the delta dir,
  and `saveBacklog` SYNCS `taskRegistry` in memory AND writes `tasks.json` to disk).
- `workflows/bug-hunt-workflow.js` + `workflows/fix-cycle-workflow.js` → bare `vi.fn()` (constructor
  side-effect avoidance — mirror delta-prd.test.ts).
- `utils/validation/execution-guard.js` → `{ validateNestedExecution, isNestedExecutionError }`.
- **NOT mocked**: `core/session-utils.js` (real `resolvePRD`, `renderDeltaPRD`, `writeDeltaPRD`,
  `loadDeltaPRD`, `writePendingDeltaHash`, `hashPRDContent`) + real tmpdir file I/O.

**Test cases (each independently assertable; can be one rich `it` or split):**
1. `it('drives the full delta path with a non-empty parent backlog')` — the headline case: builds
   the fixtures, `await pipeline.handleDelta()`, `await pipeline.decomposePRD()`, then runs the
   assertions below.
2. (Recommended split) `it('sources delta_prd.md (NOT prdSnapshot) to the architect')` — (d).
3. `it('produces NEW tasks for the added requirement in the delta tasks.json')` — (e).
4. `it('preserves patched statuses: modified→Planned, removed→Obsolete')` — (f).
5. `it('does NOT short-circuit via hasBacklog (architect invoked exactly once)')` — proves the
   dead-branch bug is gone (`createArchitectPrompt` called once; NOT the "skipping generation" path).

### Success Criteria
- [ ] New file at `tests/integration/core/delta-breakdown-integration.test.ts`.
- [ ] Parent backlog is NON-EMPTY (≥1 Phase, ≥1 Task) — the precondition that masked the bug.
- [ ] `DeltaAnalysis.changes` includes a `{ type: 'added', ... }` change (+ modified + removed).
- [ ] `createArchitectPrompt` first arg contains `# Delta PRD` + `## Added` + the added `itemId`;
      it is NOT the full PRD string and NOT the parent `prdSnapshot`.
- [ ] `createArchitectPrompt` called exactly once (hasBacklog did NOT short-circuit).
- [ ] Delta `tasks.json` contains a NEW task (e.g. `P1.M2.T1`) absent from the parent.
- [ ] Modified task (`P1.M1.T1`) status === `'Planned'`; removed task (`P1.M1.T2`) status === `'Obsolete'`.
- [ ] `npx vitest run tests/integration/core/delta-breakdown-integration.test.ts` GREEN.
- [ ] `tests/unit/core/delta-prd.test.ts` + `tests/unit/core/backlog-merger.test.ts` still GREEN.
- [ ] `npm run typecheck && npm run lint && npm run format:check` clean.

---

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed to implement
this successfully?_ **Yes** — the exact S1+S2 contracts (with line numbers), the exact `vi.mock`
surface to mirror (from the landed `delta-prd.test.ts`), the stateful-SessionManager-mock technique
(why `currentSession` must be a getter + why `saveBacklog` must sync memory), the `vi.hoisted`
pattern for the architect's tasks.json side-effect, the full fixture design (parent backlog /
delta / patchedBacklog / architectBacklog) with schema-valid `RequirementChange`/`DeltaAnalysis`
shapes, the exact drive sequence + per-assertion recipes, and the executable validation commands.

### Documentation & References

```yaml
# MUST READ — the S1 CONTRACT (LANDED reorder) + S2 CONTRACT (merge seam)
- file: plan/008_15504f60a0ef/bugfix/001_9a4fd2467e1a/P1M1T1S1/PRP.md
  why: Documents the post-S1 decomposePRD() control flow (isDelta FIRST; hasBacklog wrapped in
        `if (!isDelta)`). S3's test PROVES this is reachable with a non-empty backlog.
- file: plan/008_15504f60a0ef/bugfix/001_9a4fd2467e1a/P1M1T1S2/PRP.md
  why: Documents the S2 merge seam: `mergeBacklogs(currentSession.taskRegistry, parsedBacklog)` at
        the `saveBacklog` call. S3's assertion (f) (patched statuses survive) PROVES the merge ran.

# MUST READ — test design rationale (authored with this PRP)
- docfile: plan/008_15504f60a0ef/bugfix/001_9a4fd2467e1a/P1M1T1S3/research/delta-breakdown-integration-test-design.md
  section: "3. THE key technique: a STATEFUL SessionManager mock" and "4. THE architect mock side effect" and "5. Fixture design"
  why: The stateful-mock + vi.hoisted + fixture-match-by-title decisions. READ BEFORE IMPLEMENTING.

# MUST READ — root cause + why the existing test masked the bug
- docfile: plan/008_15504f60a0ef/bugfix/001_9a4fd2467e1a/architecture/delta_workflow.md
  section: "Issue 1" → "Integration Test Requirements"
  why: Spells out the exact full-path the test MUST drive + the 6 assertions.

# MUST READ — the test whose mock surface S3 MIRRORS (do NOT edit it; S1/S2 regression-locked)
- file: tests/unit/core/delta-prd.test.ts
  why: The vi.mock surface (architect-prompt, agent-factory, session-manager, delta-analysis-workflow,
        task-patcher, task-utils, bug-hunt, fix-cycle, execution-guard) + the createMockSessionManager
        shape + the PRPPipeline construction pattern (`new PRPPipeline('./test.md')` then
        `(pipeline as any).sessionManager = mock` + afterEach `process.removeAllListeners`).
  pattern: "vi.mock('../../../src/agents/agent-factory.js', () => ({ createArchitectAgent: vi.fn()... }))"
  gotcha: Its `makeDeltaSession()` seeds an EMPTY backlog (`{ backlog: [] }`) — that is the BUG MASK.
        S3 deliberately uses a NON-EMPTY parent backlog (the production precondition).

# PATTERN FILE 2 — a real-tmpdir integration test (delta-session) for file-scaffolding style
- file: tests/integration/core/delta-session.test.ts
  why: Real-tmpdir integration style (mkdtempSync/writeFileSync/mkdirSync/rmSync) for the delta path.
        S3 lives in this same dir (tests/integration/core/) but is a NEW, distinctly-named file.

# SOURCE — the production code under test (READ-ONLY for S3; do not modify)
- file: src/workflows/prp-pipeline.ts
  why: handleDelta() (:821) → spawnDeltaSession() (:973) → decomposePRD() (:1110). The exact step
        sequence S3 drives: resolvePRD → writePendingDeltaHash → [default] spawnDeltaSession →
        (DeltaAnalysisWorkflow.run → patchBacklog → createDeltaSession → writeDeltaPRD →
        saveBacklog(patched)) → [then] decomposePRD (isDelta → loadDeltaPRD → architect.prompt →
        read tasks.json → mergeBacklogs → saveBacklog(merged)).
  gotcha: handleDelta is decorated `@Step({ trackTiming: true })`; it reads
        `this.sessionManager.prdPath` + `currentSession.metadata.path` and calls resolvePRD (real).
        Both session dirs (parent + delta) must exist for the real session-utils file ops.

# SOURCE — data shapes (RequirementChange / DeltaAnalysis / Backlog)
- file: src/core/models.ts
  why: RequirementChange (:1569) = { itemId, type:'added'|'modified'|'removed', description, impact }.
        DeltaAnalysis (:1670) = { changes: RequirementChange[], patchInstructions: string,
        taskIds: string[] }. All readonly. Backlog/Phase/Milestone/Task/Subtask shapes for fixtures.

# SOURCE — real session-utils functions the test exercises (NOT mocked)
- file: src/core/session-utils.ts
  why: resolvePRD (:564 — reads a real file, expands @-includes; no includes → identity),
        renderDeltaPRD / writeDeltaPRD / loadDeltaPRD (real tmpdir round-trip), writePendingDeltaHash,
        hashPRDContent (pure string→hash). S3's fixtures write a real PRD file + real session dirs.
```

### Current Codebase tree (relevant slice)

```bash
src/workflows/prp-pipeline.ts        # READ-ONLY (S1 reorder LANDED; S2 merge seam = CONTRACT)
src/core/backlog-merger.ts           # READ-ONLY (S2 — mergeBacklogs; S3 proves it via assertion (f))
src/core/session-utils.ts            # READ-ONLY (real resolvePRD/renderDeltaPRD/writeDeltaPRD/loadDeltaPRD)
src/core/models.ts                   # READ-ONLY (RequirementChange/DeltaAnalysis/Backlog shapes)
tests/unit/core/delta-prd.test.ts    # UNCHANGED (S1/S2 regression-locked — do NOT edit)
tests/unit/core/backlog-merger.test.ts  # UNCHANGED (S2 — do NOT edit)
tests/integration/core/
├── delta-session.test.ts            # UNCHANGED (integration precedent; do NOT edit)
└── delta-breakdown-integration.test.ts   # ← S3 CREATES (the non-empty-parent-backlog test)
```

### Desired Codebase tree with files to be added

```bash
tests/integration/core/delta-breakdown-integration.test.ts   # NEW (test-only — the ONLY artifact)
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — S3 writes ONLY a test file. Do NOT modify prp-pipeline.ts, backlog-merger.ts,
//   task-patcher.ts, delta-prd.test.ts, backlog-merger.test.ts, or delta-session.test.ts.

// CRITICAL — the parent backlog MUST be NON-EMPTY (≥1 Phase, ≥1 Task). The whole point: the empty
//   backlog in delta-prd.test.ts CASE A masked the bug. A non-empty parent is the production precondition
//   (a completed session always has tasks; spawnDeltaSession step 7 always saves non-empty patchedBacklog).

// CRITICAL — currentSession is read MULTIPLE times across the path (handleDelta, spawnDeltaSession as
//   PARENT, then createDeltaSession switches it to the DELTA session, then decomposePRD reads it). A
//   stateless mock (fixed currentSession) CANNOT model this. Use a GETTER backed by a mutable `current`
//   (Blueprint §3). createDeltaSession's mock switches current → deltaSession + mkdirSync(deltaDir).

// CRITICAL — SessionManager.saveBacklog must SYNC MEMORY (`current.taskRegistry = b`) in its mock, not
//   just be a bare vi.fn(). The S2 merge reads `currentSession.taskRegistry` as the patched backlog at
//   the seam; if saveBacklog didn't sync it, the merge would read a STALE/empty registry. Also have it
//   write tasks.json to disk so the FINAL tasks.json = merged (the real artifact you assert on).

// CRITICAL — the architect mock must WRITE tasks.json (a side effect of prompt()). decomposePRD reads
//   tasks.json from disk after prompt() (the agent writes it in production). Use vi.hoisted to share
//   the delta session path + the architect backlog between the (hoisted) mock factory and the test body
//   (factories can't reference non-`mock`-prefixed outer vars).

// CRITICAL — assertion (d): createArchitectPrompt's FIRST arg is the prdContent. For a delta session
//   that is loadDeltaPRD(...) (delta_prd.md). Assert it contains '# Delta PRD' + '## Added' + the added
//   itemId; assert it is NOT prdSnapshot and NOT the raw new-PRD string. createArchitectPrompt called
//   EXACTLY ONCE proves hasBacklog did NOT short-circuit (the dead-branch bug).

// CRITICAL — assertion (f) depends on S2's merge being LANDED. If S2 is NOT yet landed when S3 runs,
//   assertion (f) will FAIL (the merge didn't run → patched statuses were clobbered by the architect's
//   disk write). S3's PRP treats S2 as a CONTRACT; the orchestrator sequences S2 before S3. If (f)
//   fails in isolation, verify S2 (backlog-merger.ts + the seam) is present first.

// GOTCHA — resolvePRD (real) reads the file at sm.prdPath. Write a real PRD file there (tmp/prd.md);
//   a file with no @-includes is returned as-is. Both handleDelta and spawnDeltaSession call resolvePRD
//   on it (the "new PRD"). spawnDeltaSession also reads oldPRD = currentSession.prdSnapshot (set it
//   non-empty or spawnDeltaSession throws "no PRD snapshot").

// GOTCHA — handleDelta calls writePendingDeltaHash(parentSessionPath, ...) (real file op) BEFORE
//   spawnDeltaSession. So the PARENT session dir must exist. createDeltaSession's mock must mkdirSync
//   the DELTA dir (writeDeltaPRD + the architect write land there).

// GOTCHA — vi.mock is HOISTED. For spies you assert on, use the `const xMock = vi.fn(); vi.mock(path, () =>
//   ({ f: xMock }))` pattern (works in this project — delta-prd.test.ts does it) OR vi.hoisted. For the
//   architect's tasks.json side effect, use vi.hoisted (shared mutable state). Do NOT reference ordinary
//   outer vars inside a vi.mock factory (ReferenceError at runtime).

// GOTCHA — the DeltaAnalysisWorkflow mock must be a CONSTRUCTOR returning { run }. spawnDeltaSession does
//   `new DeltaAnalysisWorkflow(oldPRD, newPRD, completedTaskIds)` then `await workflow.run()`. So:
//   `vi.mock(path, () => ({ DeltaAnalysisWorkflow: vi.fn().mockImplementation(() => ({ run: vi.fn().mockResolvedValue(delta) })) }))`.

// GOTCHA — patchBacklog is mocked (delta-prd.test.ts mocks it too). Give it an IMPLEMENTATION that returns
//   a NON-EMPTY patched backlog (T1→Planned [modified], T2→Obsolete [removed]); don't leave it a bare vi.fn()
//   (returns undefined → saveBacklog(undefined) → merge crashes). Keep the parent STRUCTURE (same phase/
//   milestone/task ids) so the merge can match by title and the assertions can find T1/T2.

// GOTCHA — do NOT run the full `npm run test:run` as the gate. The suite is PRE-EXISTING-RED (297 failures,
//   bugfix Issue 3 — P2/P3 scope). S3's gate: the new file + the targeted regression files + typecheck/
//   lint/format. Adding this file INCREASES coverage of the delta path (it cannot reduce it).

// GOTCHA — afterEach must `process.removeAllListeners('SIGINT'/'SIGTERM')` (PRPPipeline registers signal
//   handlers in its constructor — mirror delta-prd.test.ts) + rmSync the tmp dir + vi.restoreAllMocks().

// GOTCHA — handleDelta is decorated `@Step({ trackTiming: true })`. The decorator wraps timing/telemetry
//   around the method; it should not impede the call (other integration tests call decorated methods). If
//   it surfaces an unexpected error, it is a Workflow-base-class concern — investigate, don't work around.
```

---

## Implementation Blueprint

### Data models and structure (test fixtures)

```ts
import type { Backlog, DeltaAnalysis, SessionState } from '../../../src/core/models.js';

// RequirementChange / DeltaAnalysis are `readonly` — build plain literals (no mutation needed).
// Backlog items: Phase→Milestone→Task→Subtask. context_scope is a free-form string on Subtask.
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE tests/integration/core/delta-breakdown-integration.test.ts
  - IMPORTS: vitest primitives (describe/it/expect/beforeEach/afterEach/vi); node:fs
        (mkdtempSync/mkdirSync/writeFileSync/readFileSync/rmSync); node:os tmpdir; node:path join;
        types { Backlog, DeltaAnalysis, SessionState } from '../../../src/core/models.js';
        PRPPipeline from '../../../src/workflows/prp-pipeline.js' (AFTER the vi.mock block).
  - vi.mock BLOCK (mirror delta-prd.test.ts + the full-path extensions):
      * vi.hoisted for: createArchitectPromptMock (vi.fn().mockReturnValue({user:'mock-prompt'})) AND
            a shared mockState { deltaSessionPath:'', architectBacklog:null }.
      * vi.mock('.../architect-prompt.js', () => ({ createArchitectPrompt: createArchitectPromptMock })).
      * vi.mock('.../agent-factory.js', () => ({ createArchitectAgent: vi.fn().mockReturnValue({
            prompt: vi.fn().mockImplementation(async () => { writeFileSync(join(mockState.deltaSessionPath,'tasks.json'), JSON.stringify(mockState.architectBacklog)); return { status:'success', output:'' }; }) }) })).
      * vi.mock('.../delta-analysis-workflow.js', () => ({ DeltaAnalysisWorkflow: vi.fn().mockImplementation(() => ({ run: vi.fn().mockResolvedValue(<the DeltaAnalysis fixture>) })) })).
      * vi.mock('.../task-patcher.js', () => ({ patchBacklog: vi.fn().mockImplementation((b) => <patched backlog fixture: T1 Planned, T2 Obsolete>) })).
      * vi.mock('.../task-utils.js', () => ({ filterByStatus: vi.fn().mockReturnValue([]) })).
      * vi.mock('.../session-manager.js', () => ({ SessionManager: vi.fn() })).
      * vi.mock('.../bug-hunt-workflow.js', () => ({ BugHuntWorkflow: vi.fn() })).
      * vi.mock('.../fix-cycle-workflow.js', () => ({ FixCycleWorkflow: vi.fn() })).
      * vi.mock('.../execution-guard.js', () => ({ validateNestedExecution: vi.fn(), isNestedExecutionError: vi.fn(()=>false) })).
  - FIXTURE BUILDERS (module scope): makeParentBacklog() (non-empty: P1→P1.M1→T1[Complete],T2[Complete]),
        makePatchedBacklog() (same structure; T1 Planned, T2 Obsolete), makeArchitectBacklog() (Phase title
        'Foundation' [extends patched by title] → new Milestone P1.M2 title 'New Feature' → Task P1.M2.T1
        + Subtask P1.M2.T1.S1 — NEW ids, no collision), makeDelta() (changes: modified P1.M1.T1, removed
        P1.M1.T2, added P1.M2; patchInstructions; taskIds:[]).
  - STATEFUL SessionManager BUILDER: makeStatefulSessionManager(parentSession, deltaSessionPath, deltaSession)
        — getter currentSession returns live `_current`; createDeltaSession switches _current→deltaSession
        + mkdirSync(deltaSessionPath); saveBacklog syncs _current.taskRegistry AND writes tasks.json to disk;
        prdPath set to the real tmp PRD file. (See §3 of research note.)
  - TEST BODY (it('drives the full delta path with a non-empty parent backlog')):
      1. mkdirSync parentSessionPath; writeFileSync prdPath ('# New PRD\n...added requirement...').
      2. Build parentSession (metadata.parentSession=null, prdSnapshot='# Old PRD', taskRegistry=parentBacklog,
            metadata.path=parentSessionPath).
      3. Build deltaSession (metadata.parentSession='001_parent', prdSnapshot='# Full new PRD (must NOT be used)',
            taskRegistry=patchedBacklog, metadata.path=deltaSessionPath).
      4. mockState.deltaSessionPath = deltaSessionPath; mockState.architectBacklog = makeArchitectBacklog().
      5. const pipeline = new PRPPipeline(prdPath); (pipeline as any).sessionManager = sm.
      6. await pipeline.handleDelta();   // → spawnDeltaSession (default): real resolvePRD, writePendingDeltaHash,
            DeltaAnalysisWorkflow.run mock, patchBacklog mock, createDeltaSession mock [switch→delta + mkdir],
            writeDeltaPRD real, saveBacklog(patched) mock.
      7. await pipeline.decomposePRD();  // isDelta true → loadDeltaPRD real [reads delta_prd.md] →
            architect.prompt mock [writes tasks.json] → read tasks.json → mergeBacklogs(patched, architect)
            [S2] → saveBacklog(merged) mock [writes merged to disk].
      8. ASSERTIONS (d)/(e)/(f) below.
  - afterEach: rmSync(tmp, {recursive:true,force:true}); process.removeAllListeners('SIGINT'/'SIGTERM');
        vi.restoreAllMocks(); vi.clearAllMocks().
  - PLACEMENT: tests/integration/core/delta-breakdown-integration.test.ts.

Task 2: ASSERTIONS (map 1:1 to the contract)
  - (d) createArchitectPromptMock called exactly once; first call's arg[0] (prdContent):
        expect(createArchitectPromptMock).toHaveBeenCalledTimes(1);
        const sourced = createArchitectPromptMock.mock.calls[0][0] as string;
        expect(sourced).toContain('# Delta PRD'); expect(sourced).toContain('## Added');
        expect(sourced).toContain('P1.M2');                    // the added itemId
        expect(sourced).not.toBe(parentSession.prdSnapshot);   // NOT the snapshot
        expect(sourced).not.toContain('# New PRD');            // NOT the raw new-PRD file content
  - (e) read final tasks.json from disk; it has the NEW added-req task:
        const final = JSON.parse(readFileSync(join(deltaSessionPath,'tasks.json'),'utf-8')) as Backlog;
        const ids = collectAllIds(final);                      // helper: walk P/M/T/S ids
        expect(ids).toContain('P1.M2.T1');                     // NEW task from the architect
        expect(ids).not.toEqual(expect.arrayContaining(/* only parent ids */)); // it's strictly richer
  - (f) patched statuses survived the merge:
        const t1 = findTaskById(final, 'P1.M1.T1'); expect(t1.status).toBe('Planned');   // modified
        const t2 = findTaskById(final, 'P1.M1.T2'); expect(t2.status).toBe('Obsolete');  // removed
        (findTaskById = small walk helper; OR reuse src/utils/task-utils findItem IF not mocked — but it IS
         mocked here, so write a 5-line local walker.)
  - (regression) architect invoked exactly once already proven in (d); optionally assert the
        "Existing backlog found, skipping generation" log was NOT emitted (spy the logger if desired).

Task 3: FORMAT + VERIFY
  - RUN: npm run fix (lint:fix + prettier --write) → npm run typecheck → npm run lint → npm run format:check.
  - RUN: npx vitest run tests/integration/core/delta-breakdown-integration.test.ts   # NEW — GREEN.
  - RUN: npx vitest run tests/unit/core/delta-prd.test.ts        # S1/S2 regression — GREEN.
  - RUN: npx vitest run tests/unit/core/backlog-merger.test.ts   # S2 regression — GREEN.
  - EXPECTED: all clean. If (f) fails in isolation, confirm S2 (src/core/backlog-merger.ts + the
        decomposePRD seam) is LANDED before debugging the test. If createArchitectPrompt was NOT called,
        hasBacklog short-circuited — confirm the parent backlog is non-empty AND S1's reorder is present.
```

### Implementation Patterns & Key Details

```ts
// ---- tests/integration/core/delta-breakdown-integration.test.ts (NEW — skeleton) ----
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Backlog, DeltaAnalysis, SessionState } from '../../../src/core/models.js';

// vi.hoisted: assertable spy + shared mutable state (factories are hoisted; can't see plain vars).
const { createArchitectPromptMock, mockState } = vi.hoisted(() => ({
  createArchitectPromptMock: vi.fn().mockReturnValue({ user: 'mock-architect-prompt' }),
  mockState: { deltaSessionPath: '', architectBacklog: null as Backlog | null },
}));

vi.mock('../../../src/agents/prompts/architect-prompt.js', () => ({
  createArchitectPrompt: createArchitectPromptMock,
}));
vi.mock('../../../src/agents/agent-factory.js', () => ({
  createArchitectAgent: vi.fn().mockReturnValue({
    // The architect WRITES tasks.json itself in production — the mock must too.
    prompt: vi.fn().mockImplementation(async () => {
      const { writeFileSync } = await import('node:fs');
      const { join } = await import('node:path');
      if (mockState.deltaSessionPath && mockState.architectBacklog) {
        writeFileSync(
          join(mockState.deltaSessionPath, 'tasks.json'),
          JSON.stringify(mockState.architectBacklog)
        );
      }
      return { status: 'success', output: '' };
    }),
  }),
}));
vi.mock('../../../src/workflows/delta-analysis-workflow.js', () => ({
  // Constructor → { run } returning our delta fixture (an 'added' change among others).
  DeltaAnalysisWorkflow: vi.fn().mockImplementation(() => ({
    run: vi.fn().mockResolvedValue({
      changes: [
        { itemId: 'P1.M1.T1', type: 'modified', description: 'T1 changed', impact: 're-run' },
        { itemId: 'P1.M1.T2', type: 'removed', description: 'T2 dropped', impact: 'drop' },
        { itemId: 'P1.M2', type: 'added', description: 'New feature section added', impact: 'New tasks' },
      ],
      patchInstructions: 'Re-execute P1.M1.T1',
      taskIds: ['P1.M1.T1'],
    } satisfies DeltaAnalysis),
  })),
}));
vi.mock('../../../src/core/task-patcher.js', () => ({
  // patchBacklog → NON-EMPTY patched backlog (T1 Planned [modified], T2 Obsolete [removed]).
  patchBacklog: vi.fn().mockImplementation((b: Backlog) => patchParentBacklog(b)),
}));
vi.mock('../../../src/utils/task-utils.js', () => ({ filterByStatus: vi.fn().mockReturnValue([]) }));
vi.mock('../../../src/core/session-manager.js', () => ({ SessionManager: vi.fn() }));
vi.mock('../../../src/workflows/bug-hunt-workflow.js', () => ({ BugHuntWorkflow: vi.fn() }));
vi.mock('../../../src/workflows/fix-cycle-workflow.js', () => ({ FixCycleWorkflow: vi.fn() }));
vi.mock('../../../src/utils/validation/execution-guard.js', () => ({
  validateNestedExecution: vi.fn(),
  isNestedExecutionError: vi.fn(() => false),
}));

import { PRPPipeline } from '../../../src/workflows/prp-pipeline.js';

// ---- fixture builders (small, inline) ----
const CS = 'CONTRACT DEFINITION:\n1. RESEARCH NOTE: x.\n2. INPUT: x.\n3. LOGIC: x.\n4. OUTPUT: x.';
const sub = (id: string, status = 'Planned') => ({ id, type: 'Subtask' as const, title: id, status: status as any, story_points: 1, dependencies: [], context_scope: CS, prd_selectors: [] });

function makeParentBacklog(): Backlog {
  return { backlog: [{ id: 'P1', type: 'Phase', title: 'Foundation', status: 'Planned', description: 'd',
    milestones: [{ id: 'P1.M1', type: 'Milestone', title: 'Core', status: 'Planned', description: 'd',
      tasks: [
        { id: 'P1.M1.T1', type: 'Task', title: 'T1', status: 'Complete', description: 'd', subtasks: [sub('P1.M1.T1.S1','Complete')] },
        { id: 'P1.M1.T2', type: 'Task', title: 'T2', status: 'Complete', description: 'd', subtasks: [sub('P1.M1.T2.S1','Complete')] },
      ] }] }] };
}
// patched: T1→Planned (modified), T2→Obsolete (removed); structure + ids identical.
function patchParentBacklog(parent: Backlog): Backlog {
  const t1 = parent.backlog[0].milestones[0].tasks[0];
  const t2 = parent.backlog[0].milestones[0].tasks[1];
  return { backlog: [{ ...parent.backlog[0], milestones: [{ ...parent.backlog[0].milestones[0],
    tasks: [{ ...t1, status: 'Planned' }, { ...t2, status: 'Obsolete' }] }] }] };
}
// architect output: SAME phase title 'Foundation' (merge EXTENDS by title) → NEW milestone P1.M2 + new task.
function makeArchitectBacklog(): Backlog {
  return { backlog: [{ id: 'P1', type: 'Phase', title: 'Foundation', status: 'Planned', description: 'd',
    milestones: [{ id: 'P1.M2', type: 'Milestone', title: 'New Feature', status: 'Planned', description: 'd',
      tasks: [{ id: 'P1.M2.T1', type: 'Task', title: 'New Task', status: 'Planned', description: 'd', subtasks: [sub('P1.M2.T1.S1')] }] }] }] };
}

// ---- STATEFUL SessionManager mock (currentSession is a LIVE getter) ----
function makeStatefulSessionManager(parent: SessionState, deltaSessionPath: string, delta: SessionState) {
  let _current = parent;
  return {
    prdPath: '',                                            // set by caller
    get currentSession() { return _current; },              // ALWAYS live across the path
    initialize: vi.fn().mockResolvedValue(parent),
    createDeltaSession: vi.fn().mockImplementation(async () => {
      mkdirSync(deltaSessionPath, { recursive: true });     // real dir for writeDeltaPRD + architect write
      _current = delta;                                     // switch to the DELTA session (parentSession set)
    }),
    saveBacklog: vi.fn().mockImplementation(async (b: Backlog) => {
      _current = { ..._current, taskRegistry: b };           // SYNC MEMORY (the S2 merge reads taskRegistry)
      writeFileSync(join(_current.metadata.path, 'tasks.json'), JSON.stringify(b)); // mirror real SM
    }),
    hasSessionChanged: vi.fn().mockReturnValue(false),
    flushUpdates: vi.fn().mockResolvedValue(undefined),
  } as any;
}

// small id walker (filterByStatus is mocked, so don't rely on task-utils here)
function collectIds(b: Backlog): string[] {
  const ids: string[] = [];
  for (const p of b.backlog) { ids.push(p.id);
    for (const m of p.milestones) { ids.push(m.id);
      for (const t of m.tasks) { ids.push(t.id); for (const s of t.subtasks) ids.push(s.id); } } }
  return ids;
}
function findTask(b: Backlog, id: string) {
  for (const p of b.backlog) for (const m of p.milestones) for (const t of m.tasks) if (t.id === id) return t;
  throw new Error(`task ${id} not found`);
}

// ---- the test ----
describe('delta breakdown — full handleDelta → spawnDeltaSession → decomposePRD (non-empty parent backlog)', () => {
  let tmp: string;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'delta-brkdn-')); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); process.removeAllListeners('SIGINT'); process.removeAllListeners('SIGTERM'); vi.restoreAllMocks(); });

  it('sources delta_prd.md to the architect AND merges new + patched tasks', async () => {
    const parentPath = join(tmp, '001_parent'); mkdirSync(parentPath, { recursive: true });
    const deltaPath = join(tmp, '009_delta');
    const prdPath = join(tmp, 'prd.md');
    writeFileSync(prdPath, '# New PRD\n\n## Added Feature\n\nnew requirement body\n'); // resolvePRD reads this

    const parent: SessionState = { metadata: { id: '001_parent', hash: 'h'.repeat(12), path: parentPath, createdAt: new Date(), parentSession: null }, prdSnapshot: '# Old PRD', taskRegistry: makeParentBacklog(), currentItemId: null };
    const delta: SessionState = { metadata: { id: '009_delta', hash: 'd'.repeat(12), path: deltaPath, createdAt: new Date(), parentSession: '001_parent' }, prdSnapshot: '# Full new PRD (must NOT be used)', taskRegistry: makeParentBacklog(), currentItemId: null };

    mockState.deltaSessionPath = deltaPath;
    mockState.architectBacklog = makeArchitectBacklog();

    const sm = makeStatefulSessionManager(parent, deltaPath, delta);
    sm.prdPath = prdPath;
    const pipeline = new PRPPipeline(prdPath);
    (pipeline as any).sessionManager = sm;

    await pipeline.handleDelta();     // → spawnDeltaSession (default): patchBacklog, createDeltaSession [switch+mkdir], writeDeltaPRD, saveBacklog(patched)
    await pipeline.decomposePRD();    // isDelta → loadDeltaPRD → architect.prompt [writes tasks.json] → mergeBacklogs → saveBacklog(merged)

    // (d) architect sourced delta_prd.md (NOT prdSnapshot / full PRD); invoked exactly once.
    expect(createArchitectPromptMock).toHaveBeenCalledTimes(1);
    const sourced = createArchitectPromptMock.mock.calls[0][0] as string;
    expect(sourced).toContain('# Delta PRD');
    expect(sourced).toContain('## Added');
    expect(sourced).toContain('P1.M2');                 // the added itemId
    expect(sourced).not.toBe(parent.prdSnapshot);
    expect(sourced).not.toContain('# New PRD');         // not the raw new-PRD file

    // (e) final tasks.json has the NEW added-req task (P1.M2.T1) absent from the parent.
    const final = JSON.parse(readFileSync(join(deltaPath, 'tasks.json'), 'utf-8')) as Backlog;
    expect(collectIds(final)).toContain('P1.M2.T1');

    // (f) patched statuses survived the merge (proves S2 ran).
    expect(findTask(final, 'P1.M1.T1').status).toBe('Planned');   // modified
    expect(findTask(final, 'P1.M1.T2').status).toBe('Obsolete');  // removed
  });
});
```

### Integration Points

```yaml
DEPENDS ON (must be LANDED before S3 runs):
  - P1.M1.T1.S1 (reorder): LANDED — decomposePRD() checks isDelta before hasBacklog. Without it the
        test's createArchitectPrompt would NOT be called (hasBacklog short-circuits).
  - P1.M1.T1.S2 (merge): CONTRACT — mergeBacklogs(currentSession.taskRegistry, parsedBacklog) at the
        saveBacklog seam. Assertion (f) FAILS if S2 is absent (patched statuses get clobbered by the
        architect's disk write). The orchestrator sequences S2 before S3.

NO PRODUCTION/DOCS CHANGE: S3 writes ONLY the test file. prp-pipeline.ts, backlog-merger.ts,
  task-patcher.ts, delta-prd.test.ts, backlog-merger.test.ts, delta-session.test.ts are UNTOUCHED.
NO OTHER INTEGRATION: the test is self-contained (real tmpdir + mocks). It does not touch the CLI,
  the orchestrator, or any other workflow.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run fix                  # lint:fix + prettier --write (run first; the mock block may need it)
npm run typecheck            # tsc --noEmit -p tsconfig.build.json — clean
npm run lint                 # eslint . --ext .ts — clean
npm run format:check         # prettier --check — clean
# Expected: all clean. If typecheck fails on the satisfies DeltaAnalysis or a readonly-field write,
#   adjust the fixture. no-unused-vars: every imported primitive is used; every mock param is read.
```

### Level 2: The Test + Regression Suites

```bash
# S3's new file — MUST be GREEN:
npx vitest run tests/integration/core/delta-breakdown-integration.test.ts
# S1/S2 regression — MUST stay GREEN (do NOT edit these files):
npx vitest run tests/unit/core/delta-prd.test.ts
npx vitest run tests/unit/core/backlog-merger.test.ts
# Expected: all three green. If S3's (f) fails in isolation, confirm S2 (src/core/backlog-merger.ts +
#   the decomposePRD seam) is LANDED first. If createArchitectPrompt was NOT called, hasBacklog
#   short-circuited — confirm the parent backlog is non-empty + S1's reorder is present.
# Do NOT run the full `npm run test:run` — 297 pre-existing failures (bugfix Issue 3, P2/P3 scope).
```

### Level 3: Integration Smoke (the test IS the integration)

```bash
# The new file exercises the FULL real path (resolvePRD/writeDeltaPRD/loadDeltaPRD are REAL; agents +
#   SessionManager are mocked). Running it is the integration proof. A targeted source smoke proving
#   the seam is wired (S2) — useful if (f) is failing and you suspect S2 didn't land:
npx tsx -e "
import { readFileSync } from 'node:fs';
const src = readFileSync('src/workflows/prp-pipeline.ts','utf8');
console.log('reorder present?', /if\s*\(!isDelta\)/.test(src));
console.log('merge wired?', /mergeBacklogs\(/.test(src));
"
# Expected: reorder present? true ; merge wired? true. (If merge wired? is false, S2 hasn't landed —
#   S3's (f) cannot pass yet; do NOT try to "fix" the test, flag the sequencing.)
```

### Level 4: Creative & Domain-Specific Validation

```bash
# No MCP/DB/HTTP surface. Domain checks (record in commit message):
#   - Parent backlog is NON-EMPTY (the production precondition that masked the bug).
#   - createArchitectPrompt's first arg is delta_prd.md content (## Added + the added itemId), NOT the
#     full PRD or prdSnapshot — the dead-branch bug is GONE (architect invoked exactly once).
#   - The delta tasks.json has BOTH the parent's patched items (T1 Planned, T2 Obsolete) AND the new
#     added-req task (P1.M2.T1) — the S2 merge produced a correct superset.
#   - The test is merge-safe with S1/S2: it does NOT edit delta-prd.test.ts / backlog-merger.test.ts.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` clean.
- [ ] `npm run lint` clean.
- [ ] `npm run format:check` clean.
- [ ] `npx vitest run tests/integration/core/delta-breakdown-integration.test.ts` GREEN.
- [ ] `npx vitest run tests/unit/core/delta-prd.test.ts` GREEN (S1/S2 regression).
- [ ] `npx vitest run tests/unit/core/backlog-merger.test.ts` GREEN (S2 regression).

### Feature Validation
- [ ] Parent backlog is NON-EMPTY (≥1 Phase, ≥1 Task) — the bug-masking precondition is now the test's setup.
- [ ] `DeltaAnalysis.changes` includes a `{ type: 'added' }` change (+ modified + removed).
- [ ] (d) `createArchitectPrompt` first arg = delta_prd.md content (`# Delta PRD` + `## Added` + added itemId);
      NOT prdSnapshot; NOT the raw new-PRD file; called EXACTLY ONCE.
- [ ] (e) Final delta `tasks.json` contains a NEW task (`P1.M2.T1`) absent from the parent.
- [ ] (f) Modified task (`P1.M1.T1`) === `Planned`; removed task (`P1.M1.T2`) === `Obsolete`.
- [ ] The full path ran: `handleDelta()` → `spawnDeltaSession()` → `decomposePRD()` (no early skip).

### Code Quality Validation
- [ ] ONLY `tests/integration/core/delta-breakdown-integration.test.ts` is created — no production/docs change.
- [ ] `delta-prd.test.ts` / `backlog-merger.test.ts` / `delta-session.test.ts` UNTOUCHED.
- [ ] Mock surface mirrors `delta-prd.test.ts` (architect-prompt, agent-factory, session-manager,
      delta-analysis-workflow, task-patcher, task-utils, bug-hunt, fix-cycle, execution-guard).
- [ ] `currentSession` is a LIVE getter (stateful mock); `saveBacklog` syncs memory + writes disk.
- [ ] Architect mock WRITES tasks.json (the production side effect) via `vi.hoisted` shared state.
- [ ] Real tmpdir file I/O for session-utils (resolvePRD/writeDeltaPRD/loadDeltaPRD/writePendingDeltaHash).

### Documentation & Deployment
- [ ] No docs change (test-only — matches the item's "DOCS: none").
- [ ] Commit message notes: this is the Issue-1 acceptance test; non-empty parent backlog (the mask);
      depends on S1 (reorder) LANDED + S2 (merge) CONTRACT; assertion (f) guards S2 against regression.

---

## Anti-Patterns to Avoid

- ❌ Don't edit production code or other tests — S3 writes ONLY the new test file. prp-pipeline.ts,
      backlog-merger.ts, task-patcher.ts, delta-prd.test.ts, backlog-merger.test.ts, delta-session.test.ts
      are all UNTOUCHED.
- ❌ Don't seed an EMPTY parent backlog — that is the BUG MASK (delta-prd.test.ts CASE A). The parent
      backlog MUST be non-empty (the production precondition).
- ❌ Don't use a STATELESS SessionManager mock — `currentSession` is read across parent→delta and
      `saveBacklog` must sync `taskRegistry` for the S2 merge. Use the live-getter + side-effecting mock.
- ❌ Don't forget the architect mock's tasks.json side effect — decomposePRD reads tasks.json from disk
      after `prompt()`. A mock that only resolves `{status:'success'}` leaves no tasks.json → ENOENT.
- ❌ Don't reference plain outer vars inside `vi.mock` factories (hoisting → ReferenceError). Use
      `vi.hoisted` for the createArchitectPrompt spy + the architect-write shared state.
- ❌ Don't leave `patchBacklog` as a bare `vi.fn()` (returns undefined → saveBacklog(undefined) → merge
      crash). Give it an impl returning a NON-EMPTY patched backlog (T1 Planned, T2 Obsolete).
- ❌ Don't assert (f) without confirming S2 is landed — (f) is the merge proof; it FAILS if S2 is absent.
      Flag sequencing, don't "fix" the test to paper over a missing S2.
- ❌ Don't run the full `npm run test:run` as the gate — 297 pre-existing failures (Issue 3, P2/P3).
      Gate = the new file + the two targeted regression files + typecheck/lint/format.
- ❌ Don't make the architect's phase title differ from the parent's if you want the merge to EXTEND
      (same title → extend by title; different title → append as new phase). Pick deliberately and
      match the assertion. (The Blueprint uses SAME title 'Foundation' → extend, for a clean superset.)
- ❌ Don't rely on `src/utils/task-utils` findItem/filterByStatus in the test — they're MOCKED. Write a
      tiny local id-walker for the assertions.

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: This is a test-only artifact whose entire mock surface is MIRRORED from the landed,
passing `delta-prd.test.ts` (same vi.mock targets, same PRPPipeline construction, same
removeAllListeners cleanup), extended with exactly two non-obvious-but-fully-specified techniques: a
stateful SessionManager mock (live `currentSession` getter + memory-syncing `saveBacklog`) and a
`vi.hoisted`-shared architect side-effect (writing tasks.json). The S1+S2 contracts (reorder LANDED +
merge seam) are documented with line numbers, the data-flow is verified (decomposePRD reads tasks.json
from disk after the architect writes it; the S2 merge reads `currentSession.taskRegistry` as the
patched backlog), and the per-assertion recipes (d)/(e)/(f) map 1:1 to the contract. The fixture design
(same-phase-title → merge EXTENDS → clean superset with new task + preserved patched statuses) makes
the assertions deterministic. Residual risks: (a) assertion (f) failing if S2 hasn't landed (explicitly
flagged — flag sequencing, don't paper over); (b) a `@Step`-decorator surprise on `handleDelta`
(integration precedent suggests it's fine; investigate if it errors); (c) a prettier/lint nit on the
mock block (auto-fixed via `npm run fix`). No external/runtime unknowns.