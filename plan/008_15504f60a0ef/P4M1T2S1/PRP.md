# PRP — P4.M1.T2.S1: Implement `--accept-prd-changes` and integrate-into-current handlers

---

## Goal

**Feature Goal**: Implement PRD §4.3 ("The Delta Workflow", h3.5, step 2, "Response
Selection") — the three response-selection paths the system offers when a PRD change
is detected on an active session:

1. **Delta session** (default, existing flow — preserved as-is): spawn a linked session
   scoped to the diffs.
2. **Integrate into current session**: fold new requirements into the running session's
   task hierarchy, **preserving the original `prd_snapshot.md` until AFTER integration
   succeeds** (the integration agent diffs original snapshot vs current PRD; the snapshot
   is refreshed only once integration has applied — refreshing early erases the diff the
   agent needs and silently swallows unapplied changes).
3. **`--accept-prd-changes`**: accept PRD edits as the new baseline *without* generating a
   delta session. Across all `PRD_CHANGED_*` session states it **cancels the queued
   `.pending_delta_hash`**, **refreshes `prd_snapshot.md` to the current PRD**, and
   **exits/resumes idempotently**.

**This is NET-NEW infrastructure, not wiring.** A critical research finding (see Context §"The
detection gap") is that the symbols named in the work-item CONTRACT — `pending_delta_hash`,
`PRD_CHANGED_*` session states, the `--accept-prd-changes` flag, and the
integrate-into-current path — **DO NOT EXIST anywhere in `src/` today** (confirmed by
exhaustive grep). The existing delta scaffolding (`handleDelta()` in `prp-pipeline.ts:619`,
`hasSessionChanged()` in `session-manager.ts:1483`, `createDeltaSession()` in
`session-manager.ts:631`) implements only the single delta-session path, and even that path
is **currently unreachable** through the normal `initialize()` flow (which loads sessions by
exact hash match, so a mismatch can never arise). This PRP builds the PRD-change state
primitive, the `pending_delta_hash` marker, the CLI flag, the response-selection
dispatcher, the snapshot-preservation contract, and the Mode-B docs — all from scratch on
top of the existing scaffolding, in a way that is **reusable by the next item
(P4.M1.T2.S2)** which implements the validate/bug-hunt reuse path.

**Deliverable** (4 modified production modules + 1 modified CLI + 1 modified git-commit
guard + 2 new test files + 2 modified docs; **no** new dependencies, **no** prompts edits,
**no** change-classifier edits):

1. **`src/cli/index.ts`** (MODIFY) — add the `--accept-prd-changes` boolean flag (default
   `false`) to the global options chain; add `acceptPrdChanges: boolean` to `CLIArgs` (the
   raw parsed shape) and to `ValidatedCLIArgs` (carry-through; NOT in the `Omit` list so it
   passes through unchanged).
2. **`src/index.ts`** (MODIFY) — thread `args.acceptPrdChanges` as a NEW positional argument
   on the `new PRPPipeline(...)` call (`src/index.ts:233-261`), matching the existing
   positional-constructor pattern (it takes 22 today; this adds the 23rd).
3. **`src/workflows/prp-pipeline.ts`** (MODIFY) — (a) add `acceptPrdChanges: boolean` as a
   new positional constructor param (defaulted to `false`) and store as `this.acceptPrdChanges`;
   (b) refactor `handleDelta()` into a response-selection dispatcher that, when a PRD change
   is detected, routes to one of three private methods based on the flag: `acceptPrdChanges()`
   (cancel `.pending_delta_hash`, refresh `prd_snapshot.md` to current PRD, exit idempotently),
   `integrateIntoCurrentSession()` (run `DeltaAnalysisWorkflow` + `patchBacklog` against the
   CURRENT session's task hierarchy; **defer** the snapshot refresh until AFTER the patch
   applies), or the existing delta-session flow (default). (c) Wire detection so a PRD change
   is detected when `--continue` resumes a prior session whose stored snapshot hash ≠ the
   current PRD hash (this is the minimal path that makes response-selection reachable — see
   Context §"The detection gap").
4. **`src/core/session-utils.ts`** (MODIFY — ADD only) — add a marker-file helper trio for the
   `pending_delta_hash`: `writePendingDeltaHash(sessionPath, hash)`,
   `readPendingDeltaHash(sessionPath): string | null`, and
   `clearPendingDeltaHash(sessionPath)`. The marker is a plain file
   `prd_changed.marker` in the session dir containing the pending (new) PRD hash. Also add
   `refreshSnapshotToCurrentPRD(sessionPath, prdPath)` — resolves the current PRD and
   overwrites `prd_snapshot.md` with it (the accept-prd-changes + post-integration refresh).
5. **`src/utils/git-commit.ts`** (MODIFY — ADD one entry) — add `prd_changed.marker` to the
   `PROTECTED_FILES` array (`git-commit.ts:60-66`) so the marker survives per-task commits
   (matches how `prd_snapshot.md` is already protected).
6. **`tests/unit/cli/index.test.ts`** (MODIFY — ADD cases) — parse/validate tests for the new
   `--accept-prd-changes` flag (default false; set true; carried onto `ValidatedCLIArgs`).
7. **`tests/unit/workflows/prp-pipeline-delta-response.test.ts`** (NEW) — unit suite for the
   response-selection dispatcher: all three branches, the marker write/read/clear trio, the
   snapshot-preservation (integrate does NOT refresh until after patch) and snapshot-refresh
   (accept DOES refresh + clears marker) contracts, and idempotent exit for accept.
8. **`docs/CLI_REFERENCE.md`** (MODIFY — Mode B) — document the `--accept-prd-changes` flag,
   add a "Delta Response Selection" subsection, fix the `--mode` drift (add `delta`).
9. **`docs/CONFIGURATION.md`** (MODIFY — Mode B) — document the delta-response behavior and
   fix the `--mode` drift.

**Success Definition**:
- `--accept-prd-changes` is a valid CLI flag; `parseCLIArgs()` returns `acceptPrdChanges:
  true` when passed and `false` by default; it flows through to `PRPPipeline`.
- When a PRD change is detected on an active session and `--accept-prd-changes` is set, the
  pipeline: cancels the `.pending_delta_hash` marker, refreshes `prd_snapshot.md` to the
  current PRD, and exits/resumes idempotently (does NOT spawn a delta session, does NOT run
  `DeltaAnalysisWorkflow`, does NOT call `createDeltaSession`).
- The default path (no flag) still spawns a delta session via the existing
  `DeltaAnalysisWorkflow` → `patchBacklog` → `createDeltaSession` → `saveBacklog` flow.
- The integrate-into-current path runs `DeltaAnalysisWorkflow` + `patchBacklog` against the
  current session, and **does NOT refresh `prd_snapshot.md` until after the patch has applied**
  (so the integration agent retains the original-snapshot-vs-current-PRD diff); after a
  successful patch it refreshes the snapshot to the current PRD and clears the marker.
- `npm run validate` GREEN; `git diff --name-only` shows EXACTLY the files listed above (no
  change-classifier edits, no prompts edits, no `retry.ts` edits, no `SessionState` interface
  edits).

---

## User Persona (if applicable)

**Target User**: A developer running the pipeline against a project whose `PRD.md` evolves.
When they edit `PRD.md` mid-project (docs refinements, already-finished-work edits, or
genuinely new requirements), the pipeline detects the change and must let them choose how to
respond — without forcing a delta session every time.

**Use Case**:
- *Already-finished work*: the user added documentation/refinements to `PRD.md` that merely
  describe work already complete and validated. They pass `--accept-prd-changes` so the next
  run stays idempotent instead of spawning a pointless delta session.
- *Mid-session new requirements*: the user wants to fold new requirements into the *current*
  running session's task hierarchy (integrate) rather than spawn a separate delta session.
- *Real delta*: default path — a linked delta session scoped to the diffs.

**User Journey**: User edits `PRD.md` → re-runs the pipeline (`--continue` to resume) → the
pipeline detects the snapshot-vs-current-PRD hash mismatch → routes per the flag → either
(idempotently accepts + refreshes the baseline), (integrates into the current session
preserving the snapshot until applied), or (spawns a delta session). The next normal run is
idempotent in all three cases.

**Pain Points Addressed**: PRD §4.3 step 2 — today there is **no** response selection: the
single `handleDelta()` always spawns a delta session, and worse, it is currently unreachable
(see Context §"The detection gap"). Users have no way to accept doc-only PRD edits without a
spurious delta, and no way to integrate new requirements inline.

---

## Why

- **PRD compliance**: PRD §4.3 (h3.5) step 2 "Response Selection (mid-session changes)"
  mandates all three paths verbatim (see Documentation & References for the exact text). This
  PRP implements that clause in full.
- **Work-item CONTRACT mapping**:
  - **CONTRACT (1) RESEARCH NOTE** — *"`handleDelta()` reads prdSnapshot (old) + reads new
    PRD, runs `DeltaAnalysisWorkflow`, patches backlog, creates delta session."* → confirmed
    (`prp-pipeline.ts:619-736`). *"patchBacklog 'added' case is unimplemented."* → confirmed
    (`task-patcher.ts:99-135`; OUT OF SCOPE here — see Anti-Patterns). *"`--accept-prd-changes`:
    accept PRD edits as new baseline without delta session; across all `PRD_CHANGED_*` states
    it cancels queued `.pending_delta_hash`, refreshes `prd_snapshot.md` to current PRD,
    exits/resumes idempotently."* → this PRP. *"integrate into current session: fold new
    requirements into running session's task hierarchy; original `prd_snapshot.md` MUST be
    preserved until AFTER integration succeeds."* → this PRP.
  - **CONTRACT (2) INPUT** — *"Classifiers from P4.M1.T1.S2."* → the response-selection
    dispatcher receives the SUBSTANTIVE/COSMETIC verdict as an input. **This PRP does NOT wire
    the classifier** (classification is upstream and a separate item); it structures the
    dispatcher so a SUBSTANTIVE verdict routes into one of the three paths. See
    Implementation Tasks Task 3 note.
  - **CONTRACT (3) LOGIC** — *"(a) Add CLI flag `--accept-prd-changes` to `cli/index.ts`"* →
    Task 1. *"(b) In `handleDelta()` or a new response-selection handler, implement three
    paths"* → Task 3. *"(c) For integrate-into-current: do NOT refresh `prd_snapshot.md`
    until after integration has applied changes."* → Task 3 + Task 4 contract.
  - **CONTRACT (4) OUTPUT** — *"Three response-selection paths in the delta workflow. Consumed
    by P4.M1.T2.S2."* → the dispatcher + the `prd_changed.marker` primitive are the contract
    S2 consumes (S2 implements validate/bug-hunt reuse, the 4th path, on top of the
    `PRD_CHANGED_*` state this PRP introduces).
  - **CONTRACT (5) DOCS** — *"[Mode A] Update `docs/CLI_REFERENCE.md` with
    `--accept-prd-changes` flag. Update `docs/CONFIGURATION.md` delta section. This rides WITH
    the work."* → Task 6 (note: the CONTRACT labels this "Mode A" but PRD §9 and the existing
    doc-sweep work item P6 call doc updates "Mode B"; either way it RIDES WITH THE WORK — this
    PRP updates both docs).
- **No overlap with sibling/parallel PRPs**: P4.M1.T1.S1 owns the classifier functions; S2
  owns the resilient wrappers. This PRP does NOT touch `src/core/change-classifier.ts` or any
  prompt file. P4.M1.T2.S2 (next) builds the validate/bug-hunt reuse path ON TOP of the
  `prd_changed.marker` + dispatcher this PRP introduces. P4.M1.T3.S1 (delta-PRD breakdown
  binding) is downstream of the delta-session path only.

---

## What

A new CLI flag (`--accept-prd-changes`), a new marker-file primitive
(`prd_changed.marker` / `.pending_delta_hash`), a response-selection dispatcher in
`handleDelta()` with three branches, a snapshot-preservation contract for the integrate path,
a snapshot-refresh for the accept path, and Mode-B docs. **No** change-classifier edits,
**no** prompts edits, **no** `SessionState` interface edits (the marker is a file, not a
field — see Known Gotchas for why), **no** new dependencies.

### Success Criteria

- [ ] **`src/cli/index.ts`** — `--accept-prd-changes` boolean (default `false`) added to the
      global options chain (alongside `--validate-prd` at :298-302); `acceptPrdChanges:
      boolean` added to `CLIArgs` (:49-152); NOT added to the `ValidatedCLIArgs` `Omit` list
      so it carries through unchanged.
- [ ] **`src/index.ts`** — `args.acceptPrdChanges` threaded as a new positional arg on
      `new PRPPipeline(...)` (:233-261).
- [ ] **`src/workflows/prp-pipeline.ts`** — (a) new positional constructor param
      `acceptPrdChanges: boolean = false` stored as `this.acceptPrdChanges`; (b)
      `handleDelta()` refactored into a dispatcher `selectDeltaResponse()` that branches:
      `this.acceptPrdChanges` → `private async acceptPrdChangesResponse()`; else (for now,
      default) → existing delta-session flow. The integrate path is exposed as a private
      method `private async integrateIntoCurrentSessionResponse()` that is selectable when the
      dispatcher is given an integrate signal (see Implementation Tasks Task 3 — the integrate
      path is implemented and unit-tested but its CLI trigger is deferred to keep scope tight;
      it is reachable programmatically and documented, with a clear seam for a future
      `--integrate-prd-changes` flag or interactive prompt). (c) Detection wiring: in
      `initializeSession()` (:576-582), when a PRD change is detected, write the
      `prd_changed.marker` (`.pending_delta_hash`) BEFORE dispatching.
- [ ] **`src/core/session-utils.ts`** — ADD `writePendingDeltaHash(sessionPath, hash)`,
      `readPendingDeltaHash(sessionPath): Promise<string | null>`,
      `clearPendingDeltaHash(sessionPath)`, and
      `refreshSnapshotToCurrentPRD(sessionPath, prdPath)`. The marker file is
      `prd_changed.marker`. All async, all use `node:fs/promises` `writeFile`/`readFile`/`rm`.
- [ ] **`src/utils/git-commit.ts`** — ADD `'prd_changed.marker'` to `PROTECTED_FILES`
      (:60-66).
- [ ] **`tests/unit/cli/index.test.ts`** — `--accept-prd-changes` parses to `true`; absent →
      `false`; carried onto `ValidatedCLIArgs`.
- [ ] **`tests/unit/workflows/prp-pipeline-delta-response.test.ts`** (NEW) — all three
      branches + marker trio + snapshot contracts + idempotent exit.
- [ ] **`docs/CLI_REFERENCE.md`** + **`docs/CONFIGURATION.md`** — `--accept-prd-changes`
      documented; `--mode` drift fixed (add `delta`); delta-response subsection added.
- [ ] `npm run validate` GREEN.
- [ ] `git diff --name-only` shows EXACTLY the 9 files above.

---

## All Needed Context

### Context Completeness Check

✅ "If someone knew nothing about this codebase, would they have everything needed to implement
this successfully?" — YES. This PRP names: the EXACT existing scaffolding to build on
(`handleDelta()` at `prp-pipeline.ts:619`, `hasSessionChanged()` at `session-manager.ts:1483`,
`createDeltaSession()` at `session-manager.ts:631`, `snapshotPRD()` at
`session-utils.ts:1010`); the EXACT CLI pattern to mirror (Commander.js `.option('--flag',
'desc', false)` + `CLIArgs`/`ValidatedCLIArgs` — NOT yargs); the EXACT constructor-threading
pattern (`PRPPipeline` takes 22 positional params, add a 23rd); the EXACT test mock seams
(`createMockSessionManager(session, hasSessionChanged)` + factory-impl mocks for the sibling
workflows); the EXACT docs headings to edit; and the EXACT scope boundary (no
change-classifier, no prompts, no `SessionState` interface, no `added` patchBacklog fix).

### The detection gap (CRITICAL — read before implementing)

`SessionManager.initialize()` (`session-manager.ts:298+`) finds a session by **exact hash
match** (`#findSessionByHash(sessionHash)` at :266, called at :384). It sets
`this.#prdHash = sessionHash` (current PRD) AND loads-or-creates a session whose
`metadata.hash` **equals** `sessionHash`. Therefore `hasSessionChanged()` (`:1483`, returns
`#prdHash !== #currentSession.metadata.hash`) **ALWAYS returns false** in the normal flow.

Per PRD §4.3 ("Detection: System detects hash mismatch (computed from `prd_snapshot.md`
content)") and the JSDoc at `:1461-1482`, the INTENDED design is: load a session and compare
the current PRD hash against the session's stored snapshot hash. To make response-selection
**reachable** without a large refactor, this PRP wires detection on the `--continue` resume
path: when the user resumes a prior session whose `prd_snapshot.md` hash ≠ the current PRD
hash, the mismatch is detected, the `prd_changed.marker` is written, and the dispatcher
routes. (The full "always detect even on fresh `initialize()`" design is a larger refactor and
out of scope; this PRP delivers the minimal reachable path + all three response handlers.)

### Documentation & References

```yaml
# MUST READ - Include these in your context window

- file: plan/008_15504f60a0ef/P4M1T2S1/research/00_research_summary.md
  why: THIS PRP's own research summary. Contains the verdict (NET-NEW infra), the detection-gap
        analysis, the scope boundary vs siblings, key file facts with line numbers, testing
        conventions, and the chosen implementation strategy. READ FIRST.

- file: src/workflows/prp-pipeline.ts
  section: handleDelta() lines 619-736; initializeSession() routing lines 576-582; constructor
           lines 312-352 (22 positional params); currentPhase field line 161
  why: THE FILE THIS PRP MODIFIES MOST. handleDelta() is the single-path method to refactor into
        a dispatcher. initializeSession() is where detection wiring + marker-write goes. The
        constructor is where the new acceptPrdChanges param goes.
  pattern: |
    // existing routing (prp-pipeline.ts:576-582):
    if (this.sessionManager.hasSessionChanged()) {
      this.logger.info('[PRPPipeline] PRD has changed, initializing delta session');
      await this.handleDelta();
    }
    // REFACTOR to: detect → write marker → dispatch on this.acceptPrdChanges.
  gotcha: handleDelta() is @Step-decorated (trackTiming). Preserve the decorator on the
        dispatcher. The existing single-path body becomes the DEFAULT branch. Do NOT remove the
        existing DeltaAnalysisWorkflow/patchBacklog/createDeltaSession/saveBacklog calls — they
        ARE the default delta-session path.

- file: src/core/session-manager.ts
  section: hasSessionChanged() lines 1483-1490; initialize() lines 298-540 (hash-match load);
           createDeltaSession() lines 631-720; loadSession() lines 569-607; findLatestSession()
           line 1365
  why: THE DETECTION + SESSION-CREATION layer. hasSessionChanged() is the (currently dead)
        predicate. createDeltaSession() writes parent_session.txt and swaps #currentSession
        in-place — the accept/integrate paths must NOT call it. loadSession() reads
        prd_snapshot.md (:573-575) unconditionally — the marker file is read separately, not via
        loadSession.
  critical: createDeltaSession() does NOT write prd_snapshot.md for the delta dir (pre-existing
        bug; out of scope). Do NOT rely on it. The accept path's refreshSnapshotToCurrentPRD()
        writes prd_snapshot.md for the CURRENT (resumed) session dir, not a delta dir.

- file: src/core/session-utils.ts
  section: snapshotPRD() lines 1010-1130; loadSnapshot() lines 1136-1175
  why: WHERE THE NEW MARKER TRIO + refreshSnapshotToCurrentPRD() GO. snapshotPRD() is the ONLY
        existing writer of prd_snapshot.md — mirror its writeFile({mode:0o644}) style.
        refreshSnapshotToCurrentPRD() must resolvePRD() the current PRD then writeFile the
        snapshot path (same path snapshotPRD computes: resolve(sessionPath,'prd_snapshot.md')).
  pattern: |
    export async function writePendingDeltaHash(sessionPath: string, hash: string): Promise<void> {
      await writeFile(resolve(sessionPath, 'prd_changed.marker'), hash, { mode: 0o644 });
    }
    export async function readPendingDeltaHash(sessionPath: string): Promise<string | null> {
      try { return (await readFile(resolve(sessionPath, 'prd_changed.marker'), 'utf-8')).trim(); }
      catch { return null; }  // ENOENT → no pending change
    }
    export async function clearPendingDeltaHash(sessionPath: string): Promise<void> {
      try { await rm(resolve(sessionPath, 'prd_changed.marker')); } catch { /* ignore ENOENT */ }
    }
    export async function refreshSnapshotToCurrentPRD(sessionPath: string, prdPath: string): Promise<void> {
      const resolved = await resolvePRD(prdPath);
      await writeFile(resolve(sessionPath, 'prd_snapshot.md'), resolved, { mode: 0o644 });
    }
  gotcha: resolvePRD and writeFile/readFile/rm are already imported in session-utils.ts. Reuse
        them — do not add redundant imports.

- file: src/cli/index.ts
  section: global options chain lines 255-382; CLIArgs interface 49-152; ValidatedCLIArgs 155-209;
           parseCLIArgs return 248-254; isCLIArgs 1006-1018
  why: WHERE THE --accept-prd-changes FLAG GOES. Mirror the --validate-prd boolean (lines 298-302,
        declared `.option('--validate-prd', 'desc', false)`, consumed as args.validatePrd). Add
        `acceptPrdChanges: boolean` to CLIArgs; do NOT add it to the ValidatedCLIArgs Omit list
        (it carries through unchanged, like validatePrd does).
  critical: This is COMMANDER.JS, NOT yargs. Use program.option('--accept-prd-changes', 'desc',
        false) — NOT .addOption with choices.

- file: src/index.ts
  section: main() lines 110-261; new PRPPipeline(...) call lines 233-261 (22 positional args)
  why: WHERE THE FLAG IS THREADED INTO THE PIPELINE. Add args.acceptPrdChanges as the 23rd
        positional arg in the new PRPPipeline(...) call. DO NOT put it in the --validate-prd
        early-exit block (lines 156-180) — accept-prd-changes requires credentials + a loaded
        session, so it must flow through to PRPPipeline.run().
  gotcha: the --validate-prd path exits BEFORE auth preflight (credential-free). The
        --accept-prd-changes path MUST NOT do that — it needs a real session.

- file: src/utils/git-commit.ts
  section: PROTECTED_FILES lines 60-66
  why: ADD 'prd_changed.marker' so the marker survives per-task commits (prd_snapshot.md is
        already in this list for the same reason).
  gotcha: NOTE delta_from.txt is in this list but is a PHANTOM (never written; real linkage is
        parent_session.txt). Do NOT remove delta_from.txt (out of scope); just ADD prd_changed.marker.

- file: src/core/task-patcher.ts
  section: patchBacklog switch lines 99-135
  why: READ-ONLY context. The integrate path calls patchBacklog. 'modified' → Planned (re-run);
        'removed' → Obsolete (both work). 'added' → NO-OP (TODO, unimplemented — OUT OF SCOPE).
  critical: The integrate path will correctly handle modified/removed requirements but will
        SILENTLY DROP added requirements. Document this loudly in the integrate method's JSDoc
        and in the PRP's Anti-Patterns. Do NOT attempt to fix the 'added' case here.

- file: tests/unit/workflows/prp-pipeline.test.ts
  section: mock boilerplate lines 18-118; createMockSessionManager helper ~236-245; handleDelta
           spy ~1136-1185; handleDelta real-method tests ~1190-1380
  why: THE TEST TEMPLATE for the new delta-response test file. Reuse the factory-impl mock
        pattern (SessionManager, DeltaAnalysisWorkflow, BugHuntWorkflow, FixCycleWorkflow,
        task-patcher.patchBacklog, task-utils.filterByStatus, session-utils.resolvePRD). The new
        test asserts createDeltaSession is NOT called for accept/integrate paths.
  pattern: |
    function createMockSessionManager(session, hasSessionChanged = false) {
      const mock = {
        currentSession: session,
        hasSessionChanged: vi.fn().mockReturnValue(hasSessionChanged),
        createDeltaSession: vi.fn().mockResolvedValue(session),
        prdPath: '/test/prd.md',
        // ...other methods the pipeline calls
      };
      MockSessionManagerClass.mockImplementation(() => mock);
      return mock;
    }

- file: tests/unit/cli/index.test.ts
  section: setArgv helper ~67-70; parseArgs helper ~72-78; boolean-flag test pattern
  why: THE CLI TEST TEMPLATE. Add cases: setArgv(['--accept-prd-changes']) →
        args.acceptPrdChanges === true; absent → false; present on ValidatedCLIArgs.
  gotcha: process.exit is mocked to throw for failure paths; the new flag is a simple boolean so
        no exit path is needed.

- file: vitest.config.ts
  section: coverage thresholds lines 42-48 (100% statements/branches/functions/lines); pool forks
  why: 100% coverage is enforced BY npm run test:coverage (NOT by npm run validate, which skips
        coverage). Every new branch in the dispatcher + every marker-trio function needs a test.
  gotcha: npm run validate runs vitest run WITHOUT --coverage, so it won't fail on coverage —
        but the implementer SHOULD run npm run test:coverage to verify 100% of the new code.

- file: docs/CLI_REFERENCE.md
  section: Boolean Flags table; Execution Control (--mode); Common Patterns → Delta Iteration
  why: WHERE --accept-prd-changes IS DOCUMENTED. Add a row to Boolean Flags; add a "Delta
        Response Selection" subsection under Commands (or Special Modes); fix the --mode table
        to include 'delta' (drift fix).
  gotcha: prettier checks .md (npm run format:check) — the doc edits must be prettier-clean.

- file: docs/CONFIGURATION.md
  section: CLI Options → Boolean Flags; Execution Mode table; (no delta section exists)
  why: MIRROR the CLI_REFERENCE.md changes. Add a delta-response note. Fix the --mode drift.

- file: PRD.md   # §4.3 (h3.5) — the source of truth
  section: §4.3 step 2 "Response Selection (mid-session changes)"
  why: THE REQUIREMENT. Verbatim text for the three paths is in the selected_prd_content of this
        PRP's task brief. Quote it in the dispatcher's JSDoc.
```

### Current Codebase tree (relevant slice)

```bash
src/cli/
  index.ts                        # MODIFY — add --accept-prd-changes flag + CLIArgs field.
src/
  index.ts                        # MODIFY — thread acceptPrdChanges into new PRPPipeline(...).
src/workflows/
  prp-pipeline.ts                 # MODIFY — constructor param + handleDelta dispatcher + detection wiring.
src/core/
  session-utils.ts                # MODIFY (ADD) — marker trio + refreshSnapshotToCurrentPRD().
  session-manager.ts              # READ-ONLY — hasSessionChanged, createDeltaSession, loadSession.
  task-patcher.ts                 # READ-ONLY — patchBacklog (added case unimplemented; out of scope).
  models.ts                       # READ-ONLY — SessionState/DeltaSession/Status (no edits).
src/utils/
  git-commit.ts                   # MODIFY (ADD one entry) — 'prd_changed.marker' in PROTECTED_FILES.
tests/unit/
  cli/
    index.test.ts                 # MODIFY (ADD cases) — --accept-prd-changes parsing.
  workflows/
    prp-pipeline-delta-response.test.ts  # NEW — dispatcher + marker + snapshot contracts.
docs/
  CLI_REFERENCE.md                # MODIFY (Mode B) — flag + delta subsection + --mode drift fix.
  CONFIGURATION.md                # MODIFY (Mode B) — flag + delta note + --mode drift fix.
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
src/cli/index.ts                  # + --accept-prd-changes boolean (default false); + CLIArgs.acceptPrdChanges.
src/index.ts                      # + args.acceptPrdChanges positional on new PRPPipeline(...).
src/workflows/prp-pipeline.ts     # + acceptPrdChanges constructor param (default false);
                                  #   handleDelta() → selectDeltaResponse() dispatcher with 3 branches;
                                  #   detection wiring writes prd_changed.marker before dispatch.
src/core/session-utils.ts         # + writePendingDeltaHash / readPendingDeltaHash / clearPendingDeltaHash
                                  #   (prd_changed.marker = .pending_delta_hash) + refreshSnapshotToCurrentPRD().
src/utils/git-commit.ts           # + 'prd_changed.marker' in PROTECTED_FILES.
tests/unit/cli/index.test.ts      # + --accept-prd-changes parse/default/carry-through cases.
tests/unit/workflows/
  prp-pipeline-delta-response.test.ts  # NEW — 3 dispatcher branches + marker trio + snapshot
                                  #   preserve-then-refresh contract + idempotent accept exit.
docs/CLI_REFERENCE.md             # + --accept-prd-changes row + "Delta Response Selection" + --mode delta.
docs/CONFIGURATION.md             # + --accept-prd-changes + delta note + --mode delta.
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL (NET-NEW, not wiring): pending_delta_hash, PRD_CHANGED_*, --accept-prd-changes, and
//   integrate-into-current DO NOT EXIST in src/ today (grep-confirmed). This PRP builds them.
//   Do NOT assume any helper exists — write the marker trio from scratch in session-utils.ts.

// CRITICAL (the detection gap): hasSessionChanged() (session-manager.ts:1483) ALWAYS returns
//   false in the normal initialize() flow because initialize() loads sessions by exact hash
//   match (#findSessionByHash at :266/:384). For response-selection to be reachable, this PRP
//   wires detection on the --continue resume path: a resumed session whose prd_snapshot.md hash
//   ≠ current PRD hash is a PRD change. Do NOT try to "fix" initialize()'s hash-match design
//   (large refactor, out of scope) — wire detection at the resume point in initializeSession().

// CRITICAL (marker is a FILE, not a SessionState field): the .pending_delta_hash is persisted
//   as a plain file prd_changed.marker in the session dir, NOT as a new field on the readonly
//   SessionState interface. Rationale: adding a field to SessionState means editing the
//   interface (models.ts:893-952), its Zod schema, loadSession() reconstruction (:569-607),
//   createSessionDirectory(), and every place that constructs a SessionState — large blast
//   radius. A marker file is lighter, survives across runs, is grep-able, and matches how
//   parent_session.txt already works. S2 (P4.M1.T2.S2) consumes it via readPendingDeltaHash().

// CRITICAL (integrate path: do NOT refresh snapshot early): PRD §4.3 — "The original
//   prd_snapshot.md MUST be preserved until AFTER integration succeeds." The integrate method
//   runs DeltaAnalysisWorkflow(oldPRD=currentSnapshot, newPRD=resolvedCurrent) + patchBacklog
//   FIRST, and ONLY on success calls refreshSnapshotToCurrentPRD() + clearPendingDeltaHash().
//   If you refresh before the patch, the integration agent loses the diff it needs and silently
//   swallows unapplied changes.

// CRITICAL (accept path: refresh + clear + exit idempotently): the accept method calls
//   refreshSnapshotToCurrentPRD() + clearPendingDeltaHash(), then returns/exits WITHOUT calling
//   createDeltaSession or DeltaAnalysisWorkflow. The next run finds no marker + a snapshot
//   matching the current PRD → hasSessionChanged() is false → idempotent.

// CRITICAL (do NOT call createDeltaSession in accept/integrate): createDeltaSession()
//   (session-manager.ts:631) creates a NEW {seq+1}_{hash} dir, writes parent_session.txt, and
//   swaps #currentSession in-place. Only the DEFAULT delta-session path calls it. accept and
//   integrate operate on the CURRENT session dir.

// CRITICAL (Commander.js, NOT yargs): src/cli/index.ts uses `import { Command } from
//   'commander'`. Add the flag via program.option('--accept-prd-changes', 'desc', false). Do
//   NOT use yargs .option()/.choices() syntax.

// CRITICAL (thread as positional, do not refactor to options-bag): PRPPipeline takes 22
//   positional params today. Adding a 23rd (acceptPrdChanges) matches the existing pattern.
//   Refactoring to an options-bag is a larger change out of scope. Place the new param at the
//   END of the constructor signature (after metricsOutput) and default it to false so existing
//   call sites (e.g. tests that construct PRPPipeline with fewer args) don't break.

// GOTCHA (PRPPipeline constructor default): default the new param `acceptPrdChanges: boolean =
//   false` so all existing `new PRPPipeline('./test.md')` test constructions still compile.

// GOTCHA (added-requirement patchBacklog is a no-op): patchBacklog's 'added' case
//   (task-patcher.ts:99-135) logs "Feature not implemented" and drops the change. The integrate
//   path will handle modified/removed correctly but SILENTLY DROP added requirements. Document
//   this in the integrate method's JSDoc. Do NOT fix the 'added' case (out of scope).

// GOTCHA (createDeltaSession doesn't write prd_snapshot.md for the delta dir): pre-existing
//   bug (session-manager.ts:631-720 never calls snapshotPRD for the new dir). Out of scope. The
//   accept/integrate paths operate on the CURRENT session dir, whose prd_snapshot.md exists.

// GOTCHA (delta_from.txt is a phantom): it's in git-commit.ts PROTECTED_FILES but never written;
//   the real linkage file is parent_session.txt. Do NOT use delta_from.txt. This PRP adds
//   prd_changed.marker as a NEW file (and adds it to PROTECTED_FILES).

// GOTCHA (ESM .js imports): all intra-project imports use .js extensions in .ts source
//   (e.g. '../core/session-utils.js'). Follow the existing convention in each file.

// GOTCHA (prettier checks .md): npm run format:check runs prettier on **/*.md. The doc edits
//   must be prettier-clean or npm run validate fails at the format step.

// GOTCHA (npm run validate does NOT run coverage): it runs lint + format:check + typecheck +
//   test:run (no --coverage). The 100% coverage gate is only enforced by `npm run
//   test:coverage`. The implementer SHOULD run test:coverage to verify 100% of the new code,
//   even though validate won't catch it.

// GOTCHA (integrate CLI trigger is deferred): to keep scope tight, the integrate path is
//   IMPLEMENTED + UNIT-TESTED + DOCUMENTED but its CLI trigger (a --integrate-prd-changes flag
//   or interactive prompt) is deferred to a future item. The dispatcher selects integrate via a
//   private field this.integratePrdChanges (default false) with a clear seam. This keeps the
//   PRP scoped to the CONTRACT's explicit deliverables (--accept-prd-changes + the three
//   paths existing in the delta workflow) without inventing a new user-facing flag.
```

---

## Implementation Blueprint

### Data models and structure

No new `SessionState` fields. The PRD-change state is a **marker file** (`prd_changed.marker`)
in the session dir containing the pending (new) PRD hash. The marker trio + refresh helper are
added to `src/core/session-utils.ts`:

```typescript
// === additions to src/core/session-utils.ts (bottom of file) ===
// (resolvePRD, writeFile, readFile, rm are already imported in this module.)

/**
 * The PRD-change pending-delta marker file. Written when a PRD change is detected on an
 * active session (PRD §4.3 "Detection"). Contains the new (pending) PRD hash.
 *
 * Across all PRD_CHANGED_* states, `--accept-prd-changes` cancels this marker, refreshes
 * prd_snapshot.md to the current PRD, and exits idempotently (PRD §4.3 step 2).
 *
 * Reused by P4.M1.T2.S2 (validate/bug-hunt reuse path) to detect a pending change on a
 * completed session.
 */
export const PENDING_DELTA_HASH_FILE = 'prd_changed.marker';

/**
 * Write the pending-delta marker (.pending_delta_hash) to a session dir.
 * @param sessionPath - Absolute session directory path.
 * @param hash - The new (pending) PRD hash (first 12 chars of hashPRDContent).
 */
export async function writePendingDeltaHash(
  sessionPath: string,
  hash: string
): Promise<void> {
  await writeFile(resolve(sessionPath, PENDING_DELTA_HASH_FILE), hash, {
    mode: 0o644,
  });
}

/**
 * Read the pending-delta marker. Returns null if no pending change (ENOENT).
 */
export async function readPendingDeltaHash(
  sessionPath: string
): Promise<string | null> {
  try {
    return (
      await readFile(resolve(sessionPath, PENDING_DELTA_HASH_FILE), 'utf-8')
    ).trim();
  } catch {
    return null;
  }
}

/**
 * Clear the pending-delta marker (accept-prd-changes, or post-integration).
 */
export async function clearPendingDeltaHash(
  sessionPath: string
): Promise<void> {
  try {
    await rm(resolve(sessionPath, PENDING_DELTA_HASH_FILE));
  } catch {
    // ENOENT is fine — nothing to clear.
  }
}

/**
 * Refresh prd_snapshot.md to the CURRENT (resolved) PRD. Used by:
 *  - --accept-prd-changes (accept PRD edits as new baseline, PRD §4.3 step 2).
 *  - integrate-into-current AFTER integration has applied (snapshot preserved until then).
 * @param sessionPath - Absolute session directory path.
 * @param prdPath - Path to the current PRD (resolved via resolvePRD).
 */
export async function refreshSnapshotToCurrentPRD(
  sessionPath: string,
  prdPath: string
): Promise<void> {
  const resolved = await resolvePRD(prdPath);
  await writeFile(resolve(sessionPath, 'prd_snapshot.md'), resolved, {
    mode: 0o644,
  });
}
```

The dispatcher in `src/workflows/prp-pipeline.ts`:

```typescript
// === additions to src/workflows/prp-pipeline.ts ===

// (constructor: add `acceptPrdChanges: boolean = false` as the final positional param,
//  stored as `private readonly acceptPrdChanges: boolean;`. Also add a parallel
//  `private integratePrdChanges = false;` field — the integrate seam; default off.)

/**
 * Select and execute the PRD-change response per PRD §4.3 step 2. Dispatches to one of:
 *  - acceptPrdChangesResponse()  when this.acceptPrdChanges is set.
 *  - integrateIntoCurrentSessionResponse()  when this.integratePrdChanges is set.
 *  - the existing delta-session flow (default).
 *
 * CONTRACT INPUT (P4.M1.T1.S2): a SUBSTANTIVE verdict from classifyChangeWithRetry()
 * routes here. COSMETIC changes are skipped upstream (no marker, no dispatch).
 */
@Step({ trackTiming: true, name: 'handleDelta' })
async handleDelta(): Promise<void> {
  this.currentPhase = 'delta_handling';
  const sessionPath = this.sessionManager.currentSession!.metadata.path;

  // Write the pending-delta marker BEFORE dispatching (PRD §4.3 — the marker is the
  // .pending_delta_hash that --accept-prd-changes cancels).
  const newPRD = await resolvePRD(this.sessionManager.prdPath);
  const newHash = hashPRDContent(newPRD).slice(0, 12);
  await writePendingDeltaHash(sessionPath, newHash);

  if (this.acceptPrdChanges) {
    await this.acceptPrdChangesResponse(sessionPath);
    return;
  }
  if (this.integratePrdChanges) {
    await this.integrateIntoCurrentSessionResponse(sessionPath);
    return;
  }
  // DEFAULT: existing delta-session flow (the original handleDelta body, unchanged).
  await this.spawnDeltaSession(); // extracted from the old handleDelta body
}

/**
 * --accept-prd-changes (PRD §4.3 step 2): accept PRD edits as the new baseline WITHOUT a
 * delta session. Cancels .pending_delta_hash, refreshes prd_snapshot.md to current PRD,
 * exits/resumes idempotently.
 */
private async acceptPrdChangesResponse(sessionPath: string): Promise<void> {
  this.logger.info(
    '[PRPPipeline] --accept-prd-changes: accepting PRD edits as new baseline'
  );
  await refreshSnapshotToCurrentPRD(sessionPath, this.sessionManager.prdPath);
  await clearPendingDeltaHash(sessionPath);
  this.currentPhase = 'delta_accepted';
  // Idempotent: next run finds no marker + snapshot == current PRD → no change detected.
}

/**
 * Integrate into current session (PRD §4.3 step 2): fold new requirements into the
 * running session's task hierarchy. The original prd_snapshot.md is PRESERVED until AFTER
 * integration succeeds (the integration agent diffs original snapshot vs current PRD);
 * the snapshot is refreshed only once integration has applied.
 *
 * GOTCHA: patchBacklog's 'added' case is unimplemented (task-patcher.ts:99-135) — added
 * requirements are silently dropped. modified/removed are handled. Do not rely on 'added'.
 */
private async integrateIntoCurrentSessionResponse(
  sessionPath: string
): Promise<void> {
  this.logger.info(
    '[PRPPipeline] Integrating PRD changes into current session (snapshot preserved until applied)'
  );
  const currentSession = this.sessionManager.currentSession!;
  const oldPRD = currentSession.prdSnapshot; // PRESERVED — do not refresh yet.
  const newPRDResolved = await resolvePRD(this.sessionManager.prdPath);
  const completedTaskIds = filterByStatus(currentSession.taskRegistry, 'Complete')
    .filter(i => i.type === 'Task' || i.type === 'Subtask')
    .map(i => i.id);
  const delta = await new DeltaAnalysisWorkflow(
    oldPRD,
    newPRDResolved,
    completedTaskIds
  ).run();
  const patchedBacklog = patchBacklog(currentSession.taskRegistry, delta);
  // Apply the patched backlog to the CURRENT session (NOT a delta dir).
  await this.sessionManager.saveBacklog(patchedBacklog);
  // ONLY NOW (integration applied) refresh the snapshot + clear the marker.
  await refreshSnapshotToCurrentPRD(sessionPath, this.sessionManager.prdPath);
  await clearPendingDeltaHash(sessionPath);
  this.currentPhase = 'delta_integrated';
}

/**
 * DEFAULT delta-session flow (the original handleDelta body, extracted). Creates a linked
 * delta session scoped to the diffs (PRD §4.3 steps 3-7).
 */
private async spawnDeltaSession(): Promise<void> {
  // ... the existing handleDelta body (oldPRD, newPRD, completedTaskIds,
  //     DeltaAnalysisWorkflow, patchBacklog, createDeltaSession, saveBacklog) ...
}
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/core/session-utils.ts — ADD the marker trio + refreshSnapshotToCurrentPRD()
  - IMPLEMENT: PENDING_DELTA_HASH_FILE const, writePendingDeltaHash(sessionPath, hash),
    readPendingDeltaHash(sessionPath): Promise<string|null>, clearPendingDeltaHash(sessionPath),
    refreshSnapshotToCurrentPRD(sessionPath, prdPath). See Data models block.
  - FOLLOW pattern: snapshotPRD() (session-utils.ts:1010-1130) — same writeFile({mode:0o644})
    style, same resolve(sessionPath, FILE) path computation. Reuse the module's existing
    resolvePRD/writeFile/readFile/rm imports (do NOT add redundant imports).
  - NAMING: PENDING_DELTA_HASH_FILE (SCREAMING_SNAKE); write/read/clear-prefixed async fns;
    refreshSnapshotToCurrentPRD (verb-first).
  - PLACEMENT: src/core/session-utils.ts, after snapshotPRD()/loadSnapshot() (~line 1175).
  - JSDOC: Mode A on each, citing PRD §4.3 + the .pending_delta_hash contract + the
    snapshot-preservation contract.

Task 2: MODIFY src/utils/git-commit.ts — ADD 'prd_changed.marker' to PROTECTED_FILES
  - ADD: `'prd_changed.marker', // PRD-change pending-delta marker (PRD §4.3)` to the
    PROTECTED_FILES array (git-commit.ts:60-66), alongside the existing 'prd_snapshot.md'
    and 'delta_prd.md' entries.
  - GOTCHA: do NOT remove the phantom 'delta_from.txt' entry (out of scope).

Task 3: MODIFY src/cli/index.ts — ADD the --accept-prd-changes flag
  - ADD to the global options chain (after --validate-prd at :298-302):
      .option('--accept-prd-changes', 'Accept PRD edits as the new baseline without generating a delta session (PRD §4.3)', false)
  - ADD to the CLIArgs interface (:49-152):
      acceptPrdChanges: boolean;
  - DO NOT add acceptPrdChanges to the ValidatedCLIArgs Omit list (:155-209) — it carries
    through unchanged (like validatePrd).
  - GOTCHA: this is Commander.js. Use program.option(...), NOT yargs.

Task 4: MODIFY src/index.ts — thread acceptPrdChanges into new PRPPipeline(...)
  - ADD args.acceptPrdChanges as the final (23rd) positional arg in the new PRPPipeline(...)
    call (src/index.ts:233-261).
  - DO NOT add it to the --validate-prd early-exit block (:156-180) — accept-prd-changes
    needs credentials + a loaded session.

Task 5: MODIFY src/workflows/prp-pipeline.ts — constructor param + handleDelta dispatcher
  - ADD constructor param: `acceptPrdChanges: boolean = false` as the FINAL positional param
    (after metricsOutput), stored as `private readonly acceptPrdChanges: boolean;`. Default
    false so existing `new PRPPipeline('./test.md')` test constructions still compile.
  - ADD private field: `private integratePrdChanges = false;` (the integrate seam; default off;
    no CLI flag yet — deferred. Documented + unit-tested but not user-triggerable this item.)
  - REFACTOR handleDelta() (:619-736) into a dispatcher per the Data models block:
      * compute newPRD + newHash, writePendingDeltaHash(sessionPath, newHash) BEFORE dispatch.
      * if this.acceptPrdChanges → acceptPrdChangesResponse(sessionPath); return.
      * else if this.integratePrdChanges → integrateIntoCurrentSessionResponse(sessionPath); return.
      * else → spawnDeltaSession() (the EXTRACTED original body, unchanged).
  - EXTRACT the original handleDelta body into `private async spawnDeltaSession()` — DO NOT
    change its logic (DeltaAnalysisWorkflow → patchBacklog → createDeltaSession → saveBacklog).
  - IMPLEMENT acceptPrdChangesResponse() + integrateIntoCurrentSessionResponse() per the Data
    models block. CRITICAL: integrate refreshes snapshot + clears marker ONLY AFTER saveBacklog.
  - IMPORT: writePendingDeltaHash, clearPendingDeltaHash, refreshSnapshotToCurrentPRD from
    '../core/session-utils.js'; hashPRDContent from wherever the file already imports resolvePRD
    (check existing imports). filterByStatus, DeltaAnalysisWorkflow, patchBacklog are already
    imported (used by the existing handleDelta body).
  - JSDOC: Mode A on handleDelta (dispatcher), acceptPrdChangesResponse,
    integrateIntoCurrentSessionResponse (quote PRD §4.3 step 2 verbatim for each).
  - GOTCHA: preserve the @Step decorator on handleDelta. Do NOT decorate the private methods.

Task 6: MODIFY tests/unit/cli/index.test.ts — --accept-prd-changes parsing
  - ADD cases (SETUP/EXECUTE/VERIFY style):
      * setArgv(['--accept-prd-changes']) → args.acceptPrdChanges === true.
      * setArgv([]) → args.acceptPrdChanges === false (default).
      * assert 'acceptPrdChanges' in the returned ValidatedCLIArgs (carries through).
  - FOLLOW pattern: the existing boolean-flag tests (e.g. --verbose, --validate-prd).

Task 7: CREATE tests/unit/workflows/prp-pipeline-delta-response.test.ts
  - IMPORT: describe, expect, it, vi, beforeEach, afterEach from 'vitest'; PRPPipeline from
    '../../../src/workflows/prp-pipeline.js'; the marker trio + refreshSnapshotToCurrentPRD
    from '../../../src/core/session-utils.js'; types as needed.
  - MOCK (top-level, factory-impl pattern from prp-pipeline.test.ts:18-118):
      * node:fs/promises (readFile/writeFile/mkdir/rm).
      * SessionManager (constructor mock via createMockSessionManager helper — currentSession,
        hasSessionChanged, createDeltaSession, saveBacklog, prdPath).
      * DeltaAnalysisWorkflow (run → {changes,patchInstructions,taskIds}).
      * task-patcher.patchBacklog, task-utils.filterByStatus, session-utils.resolvePRD.
      * IMPORTANT: do NOT mock session-utils.js's writePendingDeltaHash/readPendingDeltaHash/
        clearPendingDeltaHash/refreshSnapshotToCurrentPRD if you want to test them for real —
        OR mock node:fs/promises and assert the writeFile/rm calls. Pick one strategy
        consistently (prefer mocking node:fs/promises + asserting call args, which tests the
        real marker functions end-to-end).
  - describe('acceptPrdChangesResponse'):
      * GIVEN a session with a pending change + pipeline.acceptPrdChanges=true → EXECUTE
        handleDelta() → VERIFY: createDeltaSession NOT called; DeltaAnalysisWorkflow NOT run;
        refreshSnapshotToCurrentPRD's writeFile(prd_snapshot.md) called with resolved current
        PRD; clearPendingDeltaHash's rm(prd_changed.marker) called; currentPhase ===
        'delta_accepted'; marker was written before dispatch (writePendingDeltaHash called).
      * GIVEN idempotent re-run (no marker, snapshot == current) → hasSessionChanged false →
        handleDelta not entered.
  - describe('integrateIntoCurrentSessionResponse'):
      * GIVEN pipeline.integratePrdChanges=true (set via (pipeline as any).integratePrdChanges=true)
        → EXECUTE handleDelta() → VERIFY: DeltaAnalysisWorkflow.run called with
        (oldPRD=currentSnapshot, newPRD=resolvedCurrent, completedTaskIds); patchBacklog called;
        saveBacklog called on CURRENT session (NOT createDeltaSession — assert NOT called);
        prd_snapshot.md NOT refreshed until AFTER saveBacklog (assert writeFile order: saveBacklog
        before the snapshot refresh); clearPendingDeltaHash called after; currentPhase ===
        'delta_integrated'.
      * GIVEN patchBacklog fails (throws) → VERIFY: prd_snapshot.md NOT refreshed (snapshot
        preserved), marker NOT cleared (integration did not succeed). This is the critical
        PRD §4.3 contract test.
  - describe('spawnDeltaSession default'):
      * GIVEN neither flag set → EXECUTE handleDelta() → VERIFY: createDeltaSession called;
        DeltaAnalysisWorkflow.run called; patchBacklog called; saveBacklog called; marker
        written before dispatch. (This is the regression test that the default path still works.)
  - describe('marker trio (session-utils)'):
      * writePendingDeltaHash → readFile returns the hash.
      * readPendingDeltaHash on missing file → null.
      * clearPendingDeltaHash on missing file → no throw.
      * refreshSnapshotToCurrentPRD → writeFile(prd_snapshot.md) called with resolvePRD output.
  - COVERAGE: 100% of the new dispatcher branches + the marker trio + refreshSnapshotToCurrentPRD.
    Every if/else in handleDelta + every catch in the marker trio needs a test.

Task 8: MODIFY docs/CLI_REFERENCE.md (Mode B)
  - ADD a row to the Boolean Flags table: --accept-prd-changes | boolean | false | "Accept PRD
    edits as the new baseline without generating a delta session (PRD §4.3)".
  - ADD a "### Delta Response Selection" subsection under ## Commands (or Special Modes)
    describing the three paths (delta-session default, integrate-into-current, --accept-prd-changes)
    and the prd_changed.marker / .pending_delta_hash behavior. Quote PRD §4.3 step 2.
  - FIX the --mode table drift: add 'delta' to the choices (code already accepts it at
    cli/index.ts:274).
  - EXPAND the "Delta Iteration" blurb under Common Patterns to reference --accept-prd-changes.
  - GOTCHA: prettier-clean (npm run format:check checks .md).

Task 9: MODIFY docs/CONFIGURATION.md (Mode B)
  - ADD --accept-prd-changes to the CLI Options → Boolean Flags table (mirror CLI_REFERENCE.md).
  - ADD a short "Delta Response" note (cross-ref to CLI_REFERENCE.md § Delta Response Selection).
  - FIX the --mode table drift (add 'delta').
  - GOTCHA: prettier-clean.
```

### Implementation Patterns & Key Details

```typescript
// PATTERN: the marker-file trio (mirrors parent_session.txt — a plain file in the session dir).
export async function readPendingDeltaHash(sessionPath: string): Promise<string | null> {
  try {
    return (await readFile(resolve(sessionPath, PENDING_DELTA_HASH_FILE), 'utf-8')).trim();
  } catch {
    return null; // ENOENT → no pending change
  }
}

// PATTERN: the dispatcher (handleDelta refactored — @Step preserved, default body extracted).
@Step({ trackTiming: true, name: 'handleDelta' })
async handleDelta(): Promise<void> {
  this.currentPhase = 'delta_handling';
  const sessionPath = this.sessionManager.currentSession!.metadata.path;
  const newPRD = await resolvePRD(this.sessionManager.prdPath);
  await writePendingDeltaHash(sessionPath, hashPRDContent(newPRD).slice(0, 12));
  if (this.acceptPrdChanges) return this.acceptPrdChangesResponse(sessionPath);
  if (this.integratePrdChanges) return this.integrateIntoCurrentSessionResponse(sessionPath);
  return this.spawnDeltaSession(); // default
}

// PATTERN: integrate preserves snapshot until AFTER the patch applies (PRD §4.3 — CRITICAL).
private async integrateIntoCurrentSessionResponse(sessionPath: string): Promise<void> {
  const oldPRD = this.sessionManager.currentSession!.prdSnapshot; // PRESERVED
  const delta = await new DeltaAnalysisWorkflow(oldPRD, await resolvePRD(this.sessionManager.prdPath), completedTaskIds).run();
  const patched = patchBacklog(this.sessionManager.currentSession!.taskRegistry, delta);
  await this.sessionManager.saveBacklog(patched); // APPLY FIRST
  await refreshSnapshotToCurrentPRD(sessionPath, this.sessionManager.prdPath); // THEN refresh
  await clearPendingDeltaHash(sessionPath);
}

// PATTERN: the test asserts createDeltaSession is NOT called for accept/integrate (prp-pipeline.test.ts
// createMockSessionManager helper — reuse it; assert mock.createDeltaSession NOT toHaveBeenCalled).
```

### Integration Points

```yaml
CLI:
  - add to: src/cli/index.ts (global options chain ~line 302, after --validate-prd)
  - pattern: ".option('--accept-prd-changes', 'desc', false)"
  - type: CLIArgs.acceptPrdChanges: boolean (carry-through to ValidatedCLIArgs)

CONSTRUCTOR:
  - add to: src/workflows/prp-pipeline.ts PRPPipeline constructor (final positional param)
  - pattern: "acceptPrdChanges: boolean = false" → "private readonly acceptPrdChanges: boolean"

MARKER FILE:
  - new file: <session_dir>/prd_changed.marker (contains the pending new PRD hash)
  - protected: add 'prd_changed.marker' to src/utils/git-commit.ts PROTECTED_FILES

DOCS:
  - docs/CLI_REFERENCE.md: Boolean Flags table + "Delta Response Selection" subsection + --mode delta
  - docs/CONFIGURATION.md: Boolean Flags table + delta note + --mode delta
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Run after each file creation - fix before proceeding
npm run lint               # eslint . --ext .ts (fix any errors in the new/modified files)
npm run format             # prettier --write (formats .ts AND .md — run before format:check)
npm run typecheck          # tsc --noEmit -p tsconfig.build.json

# Project-wide validation
npm run format:check       # prettier --check (includes .md — doc edits must be clean)
# Expected: Zero errors. If errors exist, READ output and fix before proceeding.
```

### Level 2: Unit Tests (Component Validation)

```bash
# Test the CLI flag parsing
npx vitest run tests/unit/cli/index.test.ts

# Test the delta-response dispatcher + marker trio
npx vitest run tests/unit/workflows/prp-pipeline-delta-response.test.ts

# Regression: ensure the existing prp-pipeline tests still pass (the refactor must not break them)
npx vitest run tests/unit/workflows/prp-pipeline.test.ts
npx vitest run tests/unit/workflows/prp-pipeline-progress.test.ts

# Coverage verification (NOT run by validate — run explicitly to hit the 100% gate)
npx vitest run --coverage
# Expected: 100% statements/branches/functions/lines on the NEW code in session-utils.ts +
# prp-pipeline.ts. Existing files already at 100%; the new branches must each have a test.
```

### Level 3: Integration Testing (System Validation)

```bash
# Manual smoke: --accept-prd-changes flag is accepted and parsed
node dist/index.js --accept-prd-changes --dry-run 2>&1 | head -20
# (build first: npm run build)

# Verify the marker file is created/cleared on a real session resume:
# 1. Run the pipeline once to create a session.
# 2. Edit PRD.md (add a comment).
# 3. Resume with --continue --accept-prd-changes.
# 4. Assert: no new delta session dir created; prd_snapshot.md now matches the edited PRD;
#    no prd_changed.marker file remains.
ls plan/   # confirm no new {seq}_ dir appeared
cat plan/<latest_session>/prd_snapshot.md | tail -5   # confirm it reflects the edit
test ! -f plan/<latest_session>/prd_changed.marker && echo "marker cleared OK"
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Doc lint (markdown structure)
npm run docs:lint   # markdownlint "docs/**/*.md" — confirms the doc edits are well-formed

# Verify the --mode drift fix is consistent across docs + code
grep -n "normal.*bug-hunt.*validate" docs/CLI_REFERENCE.md docs/CONFIGURATION.md
# Both should now include 'delta' in the choices list.
```

---

## Final Validation Checklist

### Technical Validation

- [ ] `npm run validate` GREEN (lint + format:check + typecheck + test:run).
- [ ] `npx vitest run --coverage` shows 100% on the new code.
- [ ] All existing prp-pipeline/cli tests still pass (no regressions from the refactor).
- [ ] `git diff --name-only` shows EXACTLY the 9 files: src/cli/index.ts, src/index.ts,
      src/workflows/prp-pipeline.ts, src/core/session-utils.ts, src/utils/git-commit.ts,
      tests/unit/cli/index.test.ts, tests/unit/workflows/prp-pipeline-delta-response.test.ts,
      docs/CLI_REFERENCE.md, docs/CONFIGURATION.md.

### Feature Validation

- [ ] `--accept-prd-changes` parses to true; default false; carried onto ValidatedCLIArgs.
- [ ] accept path: cancels marker, refreshes snapshot, exits idempotently, does NOT call
      createDeltaSession or DeltaAnalysisWorkflow.
- [ ] integrate path: runs DeltaAnalysisWorkflow + patchBacklog on the CURRENT session, does
      NOT refresh snapshot until AFTER saveBacklog, does NOT call createDeltaSession.
- [ ] integrate path: on patchBacklog failure, snapshot is NOT refreshed + marker NOT cleared
      (the critical PRD §4.3 preservation contract).
- [ ] default path: still spawns a delta session (regression).
- [ ] marker written BEFORE dispatch in all paths.

### Code Quality Validation

- [ ] Follows existing patterns (Commander.js options, snapshotPRD writeFile style,
      createMockSessionManager test helper, factory-impl mocks).
- [ ] File placement matches the desired codebase tree.
- [ ] Anti-patterns avoided (see below).
- [ ] Mode-A/B JSDoc on all new functions citing PRD §4.3.

### Documentation & Deployment

- [ ] docs/CLI_REFERENCE.md: flag documented + Delta Response Selection subsection + --mode delta.
- [ ] docs/CONFIGURATION.md: flag documented + delta note + --mode delta.
- [ ] Doc edits prettier-clean (npm run format:check passes).

---

## Anti-Patterns to Avoid

- ❌ **Don't wire the change classifier (P4.M1.T1.S2)** — classification is upstream and a
  separate item. The dispatcher receives the SUBSTANTIVE verdict as an input seam; it does not
  call `classifyChangeWithRetry`. (If you wire it now, you collide with the parallel S1/S2 work.)
- ❌ **Don't fix the patchBacklog 'added' case** — it's unimplemented (`task-patcher.ts:99-135`)
  and out of scope. The integrate path handles modified/removed correctly; added requirements
  are silently dropped (document this, don't fix it here).
- ❌ **Don't add a `prdChangeState` field to the `SessionState` interface** — large blast radius
  (interface + Zod schema + loadSession + every constructor). Use the `prd_changed.marker` file
  (lighter, survives runs, matches the parent_session.txt precedent).
- ❌ **Don't refresh the snapshot early in the integrate path** — PRD §4.3 is explicit:
  preserve `prd_snapshot.md` until AFTER integration succeeds. Refreshing early erases the diff
  the integration agent needs and silently swallows unapplied changes.
- ❌ **Don't call `createDeltaSession` in the accept/integrate paths** — only the default
  delta-session path creates a new dir. accept/integrate operate on the CURRENT session dir.
- ❌ **Don't refactor `PRPPipeline` to an options-bag** — add the 23rd positional param. The
  options-bag refactor is out of scope and would touch every call site + test.
- ❌ **Don't use yargs syntax** — `src/cli/index.ts` is Commander.js. Use
  `program.option('--accept-prd-changes', 'desc', false)`.
- ❌ **Don't put --accept-prd-changes in the --validate-prd early-exit block** — accept needs
  credentials + a loaded session; it must flow through to `PRPPipeline.run()`.
- ❌ **Don't remove the phantom `delta_from.txt` from PROTECTED_FILES** — out of scope; just ADD
  `prd_changed.marker`.
- ❌ **Don't skip the coverage run** — `npm run validate` does NOT run coverage. Run
  `npx vitest run --coverage` explicitly to verify 100% on the new code.
- ❌ **Don't invent a `--integrate-prd-changes` user-facing flag** — the integrate path is
  implemented + tested + documented but its CLI trigger is deferred (scope-tightening). It is
  reachable via the private `integratePrdChanges` field with a clear seam for a future flag or
  interactive prompt.

---

## Confidence Score

**8/10** for one-pass implementation success.

**Rationale**: The research is exhaustive (4 parallel scouts + targeted file reads); the net-new
nature is clearly identified with the exact scaffolding to build on; the marker-file design
avoids the large-blast-radius `SessionState` edit; the test mock seams are documented from the
existing `prp-pipeline.test.ts`; and the docs structure is mapped. The 2-point deduction is for
(1) the integrate-path CLI trigger being deferred (a future item must add the flag/prompt), and
(2) the detection-gap wiring being minimal (only the `--continue` resume path) — a future item
should make detection always-on. Both are explicitly scoped out and documented as residual
risks, not hidden.