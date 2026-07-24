# PRP — P4.M1.T2.S2: Validate/bug-hunt reuse completed session with pending change

---

## Goal

**Feature Goal**: Implement PRD §4.3 (h3.5, step 2, last bullet — "Validate/bug-hunt re-runs
reuse the completed session") inside the **session-selection layer** of the pipeline. When the
pipeline runs in `--mode validate` or `--mode bug-hunt` against an **already-completed**
session that has a **pending PRD change** (current-PRD hash ≠ the session's stored hash), the
system MUST **reuse the latest completed session** instead of letting `SessionManager.initialize()`
create a brand-new empty session (which has no `tasks.json` and would make the validate/bug-hunt
gates bail). The pending PRD change is intentionally **left in place** (the session's
`prd_snapshot.md` is NOT refreshed) so the *next normal* run (without `--validate`) still
processes it into a proper delta session.

**This is a surgical guard in `initializeSession()` + one new small `SessionManager` resume
helper — NOT a new mode, NOT a CLI flag, NOT a doc change, and it does NOT touch the
`handleDelta()` response-dispatcher that P4.M1.T2.S1 owns.**

A critical research finding (see Context §"The root cause") is that `PRPPipeline.run()` runs a
**fixed, mode-independent** sequence (`initializeSession()` → `decomposePRD()` →
`executeBacklog()` → `runQACycle()`), and `mode` is consulted **only** inside `runQACycle()`
(`prp-pipeline.ts:1122-1180`). `SessionManager.initialize()` (`session-manager.ts:298-556`) is
**hash-based only**: on a pending change it finds no hash match and **creates a new empty
session dir** — so validate/bug-hunt today operate on a fresh (wrong) task set, not the
completed session the user intended. The reuse decision must therefore be injected **before**
`initialize()` runs, inside `initializeSession()`.

**Deliverable** (2 modified production modules + 1 new test file + 0 doc edits; **no** new CLI
flag, **no** new dependency, **no** `SessionState` interface change, **no** change to
`runQACycle()` or the `--mode` surface, **no** overlap with S1):

1. **`src/core/session-manager.ts`** (MODIFY — ADD one public method) — add
   `loadSessionAsCurrent(sessionPath: string): Promise<SessionState>`: calls the existing public
   `loadSession(sessionPath)` AND assigns `#currentSession` to its result AND sets `#prdHash` to
   the **current** PRD hash (so `hasSessionChanged()` returns `false` afterward — no delta
   branch can fire). This is the minimal surface that makes a session "current" without
   `initialize()` re-hashing-and-creating-an-empty-session and without `createDeltaSession()`
   creating a new dir.
2. **`src/workflows/prp-pipeline.ts`** (MODIFY — ADD a guarded reuse path in
   `initializeSession()` + one private helper) — at the top of `initializeSession()`'s `try`
   block, **before** `await this.sessionManager.initialize()`, when `this.mode === 'validate' ||
   'bug-hunt'`: call a new private `tryReuseCompletedSessionForReRun()` that (a) computes the
   current-PRD hash, (b) finds the latest session via `SessionManager.findLatestSession(planDir)`,
   (c) returns early (no reuse) if there's no latest session, if its hash already matches the
   current PRD (no pending change), or if its tasks are NOT all `Complete`; otherwise (d) reuses
   it via `loadSessionAsCurrent()`, logs an explanatory message, and signals `initializeSession()`
   to **skip** the normal `initialize()` path (which would otherwise create an empty session) and
   proceed straight to building the TaskOrchestrator against the reused session. The pending
   change stays in place (no snapshot refresh, no `createDeltaSession`).
3. **`tests/unit/workflows/prp-pipeline-validate-reuse.test.ts`** (NEW) — unit suite mirroring
   the mock block + `createMockSessionManager` helper from `prp-pipeline.test.ts:17-243`, covering:
   validate-mode reuse (completed session, pending change → session reused, `initialize()` NOT
   called, `handleDelta` NOT called, `createDeltaSession` NOT called, no snapshot refresh, QA
   still runs/ skips per mode); bug-hunt-mode reuse (same); the three no-reuse fall-throughs (no
   latest session; latest-hash == current-hash → no pending change; latest session not all
   complete → fall through to `initialize()`); and the `loadSessionAsCurrent()` helper contract
   (sets currentSession + #prdHash so `hasSessionChanged()` is false).

**Success Definition**:
- In `--mode validate` or `--mode bug-hunt`, when the latest session is **completed** (all
  subtasks `Complete`) and has a **pending PRD change** (current-PRD hash ≠ that session's
  `metadata.hash`), the pipeline reuses that session as the current session and does **NOT**
  call `SessionManager.initialize()`, `handleDelta()`, or `createDeltaSession()`, and does **NOT**
  refresh `prd_snapshot.md`. The pending change remains detectable on the next normal run.
- Downstream steps tolerate the reused session: `decomposePRD()` skips (backlog already present,
  `:747-762`), `executeBacklog()` is effectively a no-op (orchestrator's ready-queue is empty
  when all subtasks are Complete — confirmed `task-orchestrator.ts:540`), and `runQACycle()`
  behaves per its existing mode dispatch (`bug-hunt` runs QA over the reused session's completed
  tasks; `validate` skips QA).
- When there is **no** latest session, or the latest session has **no pending change** (hash
  matches), or the latest session is **not all complete**, the guard falls through to the normal
  `initialize()` path unchanged (zero behavior change for those cases).
- `npm run validate` GREEN; `npm run test:coverage` shows 100% on the new code (every new branch
  has a test).
- `git diff --name-only` shows EXACTLY the 3 files above — **no** `handleDelta`/marker edits (S1),
  **no** `runQACycle` edits, **no** CLI/`--mode` edits, **no** docs edits, **no**
  `SessionState`/`models.ts` edits.

---

## User Persona (if applicable)

**Target User**: A developer who ran the pipeline to completion (all tasks implemented,
committed, validated) and then edited `PRD.md` (added docs, refinements, or genuinely new
requirements) before re-running the pipeline to **re-validate** (`--mode validate`) or
**bug-hunt** (`--mode bug-hunt`) the finished work.

**Use Case**: "My session is complete and committed. I tweaked `PRD.md` to clarify a spec. I
want to re-run the QA/bug-hunt against the *completed* work — NOT against a fresh empty session
spawned by the PRD change, and I don't want to lose the pending change (the next normal run
should still process it into a proper delta)."

**User Journey**: Run pipeline to completion → edit `PRD.md` → run `--mode validate` (or
`--mode bug-hunt`) → pipeline detects (validate/bug-hunt mode) + (pending change) + (completed
latest session) → **reuses** the completed session as-is → runs QA/skips QA per mode → exits.
The pending PRD change is untouched. The next `--mode normal` run processes the change into a
delta session normally.

**Pain Points Addressed**: PRD §4.3 step 2 last bullet — today, a validate/bug-hunt re-run after
a PRD edit creates a **new empty session** (because `initialize()` hash-mismatches), so the
validate/bug-hunt gates see "no tasks to act on" (or, worse, decompose the changed full PRD into
a fresh unrelated task set) instead of the completed work the user wanted to re-check.

---

## Why

- **PRD compliance**: PRD §4.3 (h3.5) step 2 mandates verbatim (see selected_prd_content):
  *"Validate/bug-hunt re-runs reuse the completed session: When invoked in validate-only
  (`--validate`) or bug-hunt-only (`--bug-hunt`) mode against an already-completed session that
  has a pending PRD change, the system MUST **reuse the latest completed session** instead of
  forking an empty delta session — an empty delta has no `tasks.json` and would make the
  validate/bug-hunt gates bail with 'no tasks to act on.' The PRD change is intentionally left
  pending (not actioned) so the *next normal* run (without `--validate`) still processes it into
  a proper delta session. This keeps one-off re-runs idempotent while preserving the queued
  change."* (Note: the PRD prose says `--validate`/`--bug-hunt` as shorthand; the codebase
  implements these as `--mode validate` / `--mode bug-hunt` — see Context §"CLI mode surface".)
- **Work-item CONTRACT mapping**:
  - **CONTRACT (1) RESEARCH NOTE** — *"`runQACycle()` (prp-pipeline.ts:1112) mode dispatch:
    bug-hunt always runs; validate skips QA; normal runs QA only if all tasks complete."* →
    confirmed (`runQACycle()` `:1122-1180`; the line-number drift `1112` vs `1122` is a stale
    citation in the contract). *"PRD §4.3 specifies in --validate/--bug-hunt mode against an
    already-completed session with a pending change, MUST reuse the latest completed session (an
    empty delta has no tasks.json and would make the gates bail). The change is left pending so
    the next normal run processes it."* → THIS PRP. **The reuse is NOT in `runQACycle()`** — it
    is in the session-selection layer (`initializeSession()`), because by the time
    `runQACycle()` runs, the wrong (empty) session has already been selected.
  - **CONTRACT (2) INPUT** — *"Response-selection handlers from P4.M1.T2.S1."* → S1 builds the
    `handleDelta()` response dispatcher + the `prd_changed.marker` primitive. **S2 does NOT call
    S1's handlers** (S2 bypasses `handleDelta()` entirely — the reuse path returns from
    `initializeSession()` before the delta branch at `:577-581` can fire). S2 treats S1 as a
    CONTRACT only insofar as it must not collide: S1 edits `handleDelta()` + adds the marker trio
    + the `--accept-prd-changes` flag; S2 edits `initializeSession()` + adds
    `loadSessionAsCurrent()`. **No overlapping files at the implementation seam** (both touch
    `prp-pipeline.ts` and `session-manager.ts`, but in disjoint regions — see Anti-Patterns).
  - **CONTRACT (3) LOGIC** — *"(a) Do NOT create a new empty delta session."* → Task 2 guard
    skips `initialize()`. *"(b) Reuse the latest completed session for validation/bug-hunting."*
    → `findLatestSession` + all-Complete check + `loadSessionAsCurrent()`. *"(c) Leave the
    pending change in place so the next normal run processes it."* → no `prd_snapshot.md`
    refresh, no `clearPendingDeltaHash`, `#prdHash` set to current PRD hash so the in-memory
    session reports no change, but the **on-disk session's `metadata.hash` (old) still differs
    from the current PRD** — so the next process to re-hash detects it. *"(d) Add a log/info
    message explaining the session is being reused."* → explicit `this.logger.info(...)` in the
    reuse path.
  - **CONTRACT (4) OUTPUT** — *"Validate/bug-hunt reuses completed session. Completes P4.M1.T2."*
    → this PRP delivers the reuse; it is the last subtask of P4.M1.T2.
  - **CONTRACT (5) DOCS** — *"none — no user-facing/config/API surface change."* → **no doc
    edits** (unlike S1, which edits docs). This PRP's only surface is internal session-selection
    behavior; `--mode validate`/`--mode bug-hunt` already exist and are documented.
- **No overlap with sibling/parallel PRPs**: S1 (`P4.M1.T2.S1`) owns `handleDelta()` + the
  marker trio + `--accept-prd-changes` + integrate-into-current + docs. This PRP owns the
  `initializeSession()` guard + `loadSessionAsCurrent()` + its test. The two touch
  `prp-pipeline.ts` and `session-manager.ts` in **disjoint regions** (S1: `handleDelta()` `:619+`
  + session-utils marker functions; S2: `initializeSession()` `:528-570` + one new method near
  `loadSession()` `:569`). P4.M1.T3.S1 (delta-PRD breakdown binding) is downstream of the
  delta-session path only and unaffected.

---

## What

A mode-guarded reuse path in `PRPPipeline.initializeSession()` plus one new public
`SessionManager.loadSessionAsCurrent()` helper. **No** new CLI flag, **no** new mode, **no**
`runQACycle()` change, **no** `SessionState` field, **no** doc change, **no** dependency.

### Success Criteria

- [ ] **`src/core/session-manager.ts`** — ADD `loadSessionAsCurrent(sessionPath: string):
      Promise<SessionState>` (public, async). It calls the existing public `loadSession()`,
      assigns the result to `#currentSession`, resolves+hashes the current PRD via `hashPRD()`
      and assigns to `#prdHash`, and returns the `SessionState`. (Mirrors what `initialize()`
      does at `:405`/`:505`/`:327` but for an externally-chosen path.)
- [ ] **`src/workflows/prp-pipeline.ts`** — (a) at the top of `initializeSession()`'s `try`
      block (BEFORE `await this.sessionManager.initialize()` at `:536`), add a guarded reuse
      path: `if (this.mode === 'validate' || this.mode === 'bug-hunt') { const reused = await
      this.tryReuseCompletedSessionForReRun(); if (reused) { /* skip the rest of the normal init
      path but still build the TaskOrchestrator + set currentPhase */ } }`. (b) ADD private
      `tryReuseCompletedSessionForReRun(): Promise<boolean>` that performs the 4-step detection
      (hash, find-latest, no-match-fallthrough, all-complete-check) + reuse + log, returning
      `true` on reuse and `false` on any fall-through. (c) The reused branch must STILL build the
      `TaskOrchestrator` (so `executeBacklog`/`runQACycle` have an orchestrator) and set
      `currentPhase = 'session_initialized'` exactly like the normal path. **It must NOT call
      `initialize()`, `handleDelta()`, `createDeltaSession()`, or refresh `prd_snapshot.md`.**
- [ ] **`tests/unit/workflows/prp-pipeline-validate-reuse.test.ts`** (NEW) — all reuse branches
      + all fall-through branches + the `loadSessionAsCurrent()` contract + the
      no-`createDeltaSession`/no-`handleDelta`/no-snapshot-refresh assertions.
- [ ] `npm run validate` GREEN.
- [ ] `npm run test:coverage` shows 100% on the new branches.
- [ ] `git diff --name-only` shows EXACTLY the 3 files above.

---

## All Needed Context

### Context Completeness Check

✅ "If someone knew nothing about this codebase, would they have everything needed to implement
this successfully?" — YES. This PRP names: the EXACT root cause (mode-blind `initialize()`
creates an empty session on hash mismatch — `session-manager.ts:298-556`); the EXACT seam (the
top of `initializeSession()`'s `try` block at `prp-pipeline.ts:536`, BEFORE
`this.sessionManager.initialize()`); the EXACT detection primitives to compose
(`findLatestSession` `:1365`, `readTasksJSON` `session-utils.ts:841`, `hashPRD`
`session-utils.ts:273`, `loadSession` `:569`); the EXACT missing piece (`loadSession` is public
but does NOT set `#currentSession` — so we add `loadSessionAsCurrent`); the EXACT test mock block
to copy (`prp-pipeline.test.ts:17-243`); and the EXACT scope boundary (no S1 overlap, no docs,
no CLI, no `runQACycle`, no `SessionState` field).

### The root cause (CRITICAL — read before implementing)

`PRPPipeline.run()` (`prp-pipeline.ts:1745`) runs a **fixed, mode-independent** sequence:
`initializeSession()` (`:1829`) → `decomposePRD()` → `executeBacklog()` → `runQACycle()` (`:1872`).
**`this.mode` is read in exactly one place in the whole execution path: inside `runQACycle()`
at `:1122-1180`** (`bug-hunt` → run QA; `validate` → skip QA; `normal` → QA iff all complete).

`initializeSession()` (`:528`) calls `this.sessionManager.initialize()` **unconditionally** with
**no** mode/`--continue` argument. `SessionManager.initialize()` (`session-manager.ts:298-556`)
is **hash-based only**: it hashes the current PRD (`:316-323`), then
`#findSessionByHash(sessionHash)` (`:384`, exact match on dir-name hash). On a match it
`loadSession()`s it (`:405`); on a **mismatch** it **creates a brand-new empty session dir**
(`:478-525`, `taskRegistry.backlog: []`).

**Consequence for validate/bug-hunt with a pending change**: current-PRD hash ≠ any session's
hash → `#findSessionByHash` returns `null` → `initialize()` creates a new empty session →
`decomposePRD()` then runs the Architect over the **changed full PRD** producing a fresh task
set → `runQACycle()` operates on that fresh set, NOT the completed session the user wanted.
This is exactly the "empty delta has no tasks.json" failure PRD §4.3 warns about.

**Where the fix goes**: inject the reuse decision at the **top of `initializeSession()`'s `try`
block**, BEFORE `initialize()` runs. When `mode==='validate'||'bug-hunt'` AND the latest session
is completed AND has a pending change, call the new `loadSessionAsCurrent()` and **return early**
from `initializeSession()` (after building the orchestrator + setting the phase), so `initialize()`
never creates the empty session.

### CLI mode surface (the `--validate`/`--bug-hunt` shorthand)

PRD §4.3 prose says `--validate`/`--bug-hunt`. The codebase implements these as
**`--mode validate` / `--mode bug-hunt`** (a single `--mode <mode>` Commander choice option at
`cli/index.ts:270-276`, choices `['normal','delta','bug-hunt','validate']`, default `'normal'`).
`args.mode` flows 1:1 (no remapping) into the 3rd positional arg of `new PRPPipeline(...)`
(`src/index.ts:233-256`) and is stored on the public `PRPPipeline.mode` field
(`prp-pipeline.ts:163-164`). **This PRP does NOT change the CLI surface** — it only reads
`this.mode` inside `initializeSession()`. (Note: `--validate-prd` at `cli/index.ts:299-303` is a
**separate, unrelated** flag that short-circuits the pipeline entirely to run only
`PRDValidator`; do not confuse the two.)

### Documentation & References

```yaml
# MUST READ - Include these in your context window

- file: plan/008_15504f60a0ef/P4M1T2S2/research/00_research_summary.md
  why: THIS PRP's own research summary. Contains the root-cause analysis, the S1-vs-S2
        non-overlap proof, the design (guard in initializeSession + loadSessionAsCurrent), the
        detection-primitive table, the downstream-tolerance argument, and the test patterns.
        READ FIRST.

- file: src/workflows/prp-pipeline.ts
  section: initializeSession() lines 528-601 (esp. the try-block top at :535-541, the
           sessionManager.initialize() call at :536, and the delta branch at :577-581 which
           must NOT fire for the reused session); run() ordering :1745-1903 (initializeSession
           :1829 → decomposePRD → executeBacklog → runQACycle :1872); runQACycle() mode dispatch
           :1122-1180 (bug-hunt runs QA :1132, validate skips QA :1138); mode field :163-164;
           #allTasksComplete() :2023-2040; #prdPath / #planDir private fields :237/planDir
  why: THE FILE THIS PRP MODIFIES. The guard goes at the top of initializeSession()'s try block.
        The reused branch must still build TaskOrchestrator and set currentPhase, exactly like
        the normal path does after the initialize() call (mirror lines :543-570 for orchestrator
        construction + the delta-check at :577 which we deliberately bypass).
  pattern: |
    // existing (prp-pipeline.ts:535-582):
    try {
      const session = await this.sessionManager.initialize();   // :536 — creates empty session on mismatch
      this.logger.info(`...Session: ${session.metadata.id}`);
      // ... build TaskOrchestrator (new TaskOrchestratorClass(...)) ...
      if (this.sessionManager.hasSessionChanged()) {            // :577
        await this.handleDelta();                                // :581 — must NOT fire for reused session
      }
      this.currentPhase = 'session_initialized';
    }
    // REFACTOR to: guard at the very top of the try block.
  gotcha: The reused branch MUST still construct TaskOrchestrator (the normal path does so after
        initialize(); if you skip orchestrator construction the later rebuildQueue() in run()
        (:1887) throws on `this.taskOrchestrator` being null). Mirror the orchestrator-construction
        lines from the normal path. The simplest structure: extract orchestrator-construction
        into a tiny private helper used by BOTH the normal path and the reused path, OR inline
        the same construction in the reused branch.

- file: src/core/session-manager.ts
  section: #currentSession field :169 (private); currentSession getter :244-246; #prdHash :172
           (private, set in initialize() at :327); loadSession() :569-607 (PUBLIC — reads
           tasks.json + prd_snapshot.md, returns SessionState, does NOT set #currentSession);
           createDeltaSession() :631-707 (creates NEW dir + parent_session.txt + overwrites
           #currentSession — DO NOT call); initialize() :298-556 (hash-based new-or-load);
           #findSessionByHash :266; findLatestSession() :1365 (static public, returns highest-seq
           SessionMetadata | null); listSessions() :1302 (static public); planDir readonly :166
  why: WHERE loadSessionAsCurrent() GOES (near loadSession() :569). It is the minimal public
        surface that makes a chosen session "current" without initialize() re-hashing and without
        createDeltaSession() creating a new dir. findLatestSession() + the hash comparison are
        the detection. loadSession() already does the file reads; loadSessionAsCurrent just wraps
        it + assigns #currentSession + sets #prdHash.
  critical: #currentSession and #prdHash are PRIVATE. loadSessionAsCurrent MUST be a method ON
        SessionManager (not an external function) to assign them. Do NOT make them public.
        loadSessionAsCurrent sets #prdHash to the CURRENT PRD hash (via hashPRD) so
        hasSessionChanged() returns false afterward — this is deliberate (the in-memory reused
        session should report "no change" so the :577 delta branch never fires); the on-disk
        session's metadata.hash (old) still differs from the current PRD, so the NEXT process
        detects the pending change.
  pattern: |
    // new public method on SessionManager (add near loadSession, ~line 607):
    async loadSessionAsCurrent(sessionPath: string): Promise<SessionState> {
      const session = await this.loadSession(sessionPath);
      this.#currentSession = session;
      this.#prdHash = (await hashPRD(this.prdPath)).slice(0, 12);  // current PRD hash
      return session;
    }
    // (hashPRD is already imported in session-manager.ts — used by initialize() at :316-323.

- file: src/core/session-utils.ts
  section: hashPRD() :273-298 (async, resolvePRD + hashPRDContent, returns FULL hash string —
           slice(0,12) yourself); readTasksJSON() :841 (standalone export, reads+validates
           tasks.json from a session dir — use to check completion WITHOUT loadSession)
  why: THE DETECTION PRIMITIVES. tryReuseCompletedSessionForReRun() calls hashPRD(this.prdPath)
        to get the current hash, and readTasksJSON(latest.metadata.path) to load the latest
        session's Backlog for the all-complete check. readTasksJSON is lighter than loadSession
        (no prd_snapshot.md read) — use it for the completion probe.
  gotcha: hashPRD returns the FULL 64-char hash; session metadata.hash is the 12-char prefix.
        Compare `fullHash.slice(0,12) === latest.metadata.hash`. initialize() does the same slice
        at :323.

- file: tests/unit/workflows/prp-pipeline.test.ts
  section: vi.mock() block :17-114 (12 mocked modules); createMockSessionManager helper :226-243;
           the "should (not) call handleDelta" tests :684-728 (the exact vi.spyOn + not.toHaveBeenCalled
           precedent); beforeEach :258-283 (vi.clearAllMocks + SessionManager mock reset);
           afterEach signal cleanup; data factories createTestSubtask/Task/Milestone/Phase/Backlog/Session
           :170-224
  why: THE TEST TEMPLATE for the new file. Copy the FULL vi.mock block + the
        createMockSessionManager helper. The new file asserts initialize()/handleDelta/
        createDeltaSession are NOT called in the reuse path (vi.spyOn on pipeline.handleDelta +
        expect(mock.createDeltaSession).not.toHaveBeenCalled()). build a "completed" SessionState
        via the data factories with all subtasks status 'Complete'.
  pattern: |
    function createMockSessionManager(session, hasSessionChanged = false) {  // :226-243
      const mock = {
        currentSession: session,
        initialize: vi.fn().mockResolvedValue(session),
        saveBacklog: vi.fn().mockResolvedValue(undefined),
        hasSessionChanged: vi.fn().mockReturnValue(hasSessionChanged),
        createDeltaSession: vi.fn().mockResolvedValue(session),
        prdPath: '/test/prd.md',
        planDir: '/test/plan',          // ADD for this test (findLatestSession arg)
        loadSessionAsCurrent: vi.fn().mockResolvedValue(session),  // ADD for this test
        flushUpdates: vi.fn().mockResolvedValue(undefined),
      };
      MockSessionManagerClass.mockImplementation(() => mock);
      return mock;
    }
  gotcha: Because the reuse path calls SessionManager.findLatestSession (a STATIC method), you
        must also mock the static. Either vi.spyOn(SessionManager, 'findLatestSession') OR mock
        session-manager's module so findLatestSession is controllable. Prefer vi.spyOn on the
        real class (findLatestSession is a real static — spy it to return your test metadata).

- file: src/core/task-orchestrator.ts
  section: processNextItem() :540 comment ("queue stays empty, processNextItem() returns false
           immediately")
  why: PROVES executeBacklog() is effectively a no-op when all subtasks are Complete (the
        ready-queue is empty). This is why the reused completed session flows safely through
        run()'s executeBacklog() step. Do NOT rely on executeBacklog being skipped (it isn't —
        it runs but processes 0 items); rely on the orchestrator returning immediately.

- file: PRD.md   # §4.3 (h3.5) — the source of truth
  section: §4.3 step 2, last bullet ("Validate/bug-hunt re-runs reuse the completed session")
  why: THE REQUIREMENT. Verbatim text is in the selected_prd_content of this PRP's task brief.
        Quote it in the reuse helper's JSDoc.
```

### Current Codebase tree (relevant slice)

```bash
src/workflows/
  prp-pipeline.ts            # MODIFY — initializeSession() guard + tryReuseCompletedSessionForReRun().
src/core/
  session-manager.ts         # MODIFY (ADD) — loadSessionAsCurrent().
  session-utils.ts           # READ-ONLY — hashPRD, readTasksJSON (detection primitives).
  models.ts                  # READ-ONLY — SessionState/SessionMetadata/Status (no edits).
  task-orchestrator.ts       # READ-ONLY — processNextItem no-op-on-empty-queue proof.
tests/unit/workflows/
  prp-pipeline-validate-reuse.test.ts   # NEW — reuse + fall-through + helper-contract tests.
  prp-pipeline.test.ts       # READ-ONLY — mock template + createMockSessionManager + factories.
src/cli/index.ts             # READ-ONLY — confirm --mode surface (no edits).
src/index.ts                 # READ-ONLY — confirm mode flows to PRPPipeline (no edits).
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
src/core/session-manager.ts  # + loadSessionAsCurrent(sessionPath): Promise<SessionState>
                             #   (wraps loadSession + assigns #currentSession + sets #prdHash
                             #   to current PRD hash so hasSessionChanged() is false).
src/workflows/prp-pipeline.ts # + guarded reuse path at top of initializeSession() try block;
                              #   + private tryReuseCompletedSessionForReRun(): Promise<boolean>
                              #   (4-step detection: hash, find-latest, no-pending-change/
                              #   not-complete fall-throughs, reuse+log).
tests/unit/workflows/
  prp-pipeline-validate-reuse.test.ts  # NEW — validate/bug-hunt reuse; 3 fall-throughs;
                              #   loadSessionAsCurrent contract; no-initialize/handleDelta/
                              #   createDeltaSession/snapshot-refresh assertions.
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL (the reuse lives in the SESSION-SELECTION layer, not runQACycle or handleDelta):
//   runQACycle()'s mode dispatch already does the right thing (bug-hunt runs QA, validate skips).
//   The bug is UPSTREAM: by the time runQACycle() runs, initialize() has already selected the
//   wrong (empty) session. So the guard MUST go in initializeSession() BEFORE initialize(). Do
//   NOT try to fix this in runQACycle() or handleDelta() — it's too late there.

// CRITICAL (the reused branch must STILL build the TaskOrchestrator): run() calls
//   this.taskOrchestrator.rebuildQueue() at :1887. If initializeSession()'s reused branch
//   returns without constructing the orchestrator, rebuildQueue throws on null. Mirror the
//   orchestrator construction the normal path does (new TaskOrchestratorClass(...)). Simplest:
//   extract a tiny private buildTaskOrchestrator() helper called by both paths, OR inline the
//   same `new TaskOrchestratorClass(...)` in the reused branch.

// CRITICAL (#currentSession + #prdHash are PRIVATE on SessionManager): only initialize() and
//   createDeltaSession() assign them today. loadSessionAsCurrent() must be a METHOD on
//   SessionManager (not an external session-utils function) to assign them. Do NOT make the
//   fields public. The method sets #prdHash to the CURRENT PRD hash (via hashPRD) so the
//   in-memory reused session reports hasSessionChanged() === false (the :577 delta branch
//   cannot fire). The on-disk session's metadata.hash (old) still differs from the current PRD,
//   so the NEXT process detects the pending change — this is how the change "stays pending."

// CRITICAL (leave the pending change in place): do NOT refresh prd_snapshot.md, do NOT call
//   S1's clearPendingDeltaHash() (different code path anyway), do NOT call createDeltaSession().
//   The contract: "The PRD change is intentionally left pending so the next normal run still
//   processes it." loadSessionAsCurrent sets #prdHash to the current PRD hash in MEMORY only;
//   the on-disk prd_snapshot.md is untouched.

// CRITICAL (no overlap with S1): S1 edits handleDelta() (:619+), adds the marker trio to
//   session-utils.ts, adds --accept-prd-changes to cli/index.ts, edits docs. S2 edits
//   initializeSession() (:528-570) and adds loadSessionAsCurrent to session-manager.ts (near
//   :569). DISJOINT regions. Do NOT touch handleDelta, the marker functions, the accept flag,
//   or docs.

// CRITICAL (findLatestSession is STATIC): tryReuseCompletedSessionForReRun() calls
//   SessionManager.findLatestSession(this.sessionManager.planDir). In tests, vi.spyOn the real
//   SessionManager class static (vi.spyOn(SessionManager, 'findLatestSession').mockResolvedValue(meta))
//   — do NOT try to stub it via the instance mock.

// CRITICAL (the latest session's hash is its DIR-NAME hash, 12 chars): metadata.hash comes from
//   the dir name split on '_' (loadSession :578-602). Compare against currentHash.slice(0,12).
//   hashPRD returns the FULL hash; slice it.

// CRITICAL (completion has NO session-level field): SessionMetadata (models.ts:838-891) and
//   SessionState (models.ts:937-985) have NO status field. Completion is DERIVED from tasks.json:
//   all subtasks 'Complete'. Probe with readTasksJSON(path) then iterate phases→milestones→
//   tasks→subtasks (mirror #allTasksComplete() at prp-pipeline.ts:2023). Do NOT add a status
//   field (large blast radius; out of scope).

// GOTCHA (validate mode does NOT skip executeBacklog): --mode validate still runs executeBacklog
//   (all tasks); it only skips QA. For a REUSED COMPLETED session this is fine — the orchestrator's
//   ready-queue is empty (task-orchestrator.ts:540) so executeBacklog processes 0 items and
//   returns. Do NOT add an executeBacklog skip for the reused branch; rely on the empty queue.

// GOTCHA (decomposePRD skips on existing backlog): :747-762 — the reused completed session has
//   its full backlog, so decomposePRD is a no-op. No special handling needed.

// GOTCHA (ESM .js imports): all intra-project imports use .js extensions in .ts source (e.g.
//   '../core/session-manager.js'). Follow the existing convention. hashPRD/readTasksJSON are
//   already imported where needed or import them in the new code.

// GOTCHA (afterEach signal cleanup is mandatory): PRPPipeline's constructor registers SIGINT/
//   SIGTERM handlers. The new test's afterEach MUST process.removeAllListeners('SIGINT') +
//   'SIGTERM' or the forked test pool leaks listeners across tests (precedent: prp-pipeline.test.ts).

// GOTCHA (npm run validate does NOT run coverage): it runs lint + format:check + typecheck +
//   test:run (no --coverage). The 100% gate is only enforced by `npm run test:coverage`. The
//   implementer MUST run test:coverage explicitly to verify 100% on the new branches (the if
//   validate/bug-hunt, the if reused, the 3 fall-through returns in tryReuseCompletedSessionForReRun,
//   and the loadSessionAsCurrent method).
```

---

## Implementation Blueprint

### Data models and structure

**No new data models.** The reuse reuses existing `SessionState` / `SessionMetadata` / `Status`.
Completion is derived (not stored). The two new code units are methods:

```typescript
// === addition to src/core/session-manager.ts (near loadSession, ~line 607) ===
// (hashPRD is already imported in this module — used by initialize() at :316-323.)

/**
 * Load an existing session and make it the current session WITHOUT running the
 * hash-based initialize() lookup and WITHOUT creating a new dir (createDeltaSession).
 *
 * Sets #prdHash to the CURRENT PRD hash so hasSessionChanged() returns false — the
 * in-memory reused session reports no change (the on-disk session's metadata.hash may
 * still differ from the current PRD; that pending difference is what the next normal
 * run detects and processes).
 *
 * Used by PRP §4.3 step 2 (validate/bug-hunt reuse completed session): the reuse path
 * selects a chosen session as current and leaves any pending PRD change in place.
 *
 * @param sessionPath - Absolute path to an existing session directory.
 * @returns The loaded SessionState (also assigned to #currentSession).
 */
async loadSessionAsCurrent(sessionPath: string): Promise<SessionState> {
  const session = await this.loadSession(sessionPath);
  this.#currentSession = session;
  // Match initialize()'s hash caching (:316-323): current PRD hash, 12-char prefix.
  this.#prdHash = (await hashPRD(this.prdPath)).slice(0, 12);
  return session;
}
```

```typescript
// === additions to src/workflows/prp-pipeline.ts ===
// (hashPRD, readTasksJSON import from '../core/session-utils.js'; SessionManager already imported;
//  TaskOrchestratorClass alias already set in the existing orchestrator construction.)

/**
 * PRD §4.3 step 2 (validate/bug-hunt reuse completed session): when the pipeline runs in
 * validate-only or bug-hunt-only mode against an already-completed session that has a pending
 * PRD change, reuse the latest completed session instead of forking an empty delta session.
 * The pending change is left in place so the next normal run processes it.
 *
 * @returns true if a completed session with a pending change was reused; false to fall through
 *          to the normal initialize() path.
 */
private async tryReuseCompletedSessionForReRun(): Promise<boolean> {
  const planDir = this.sessionManager.planDir;
  const latest = await SessionManager.findLatestSession(planDir);
  if (!latest) {
    // No sessions at all — normal initialize() will create the first one.
    return false;
  }
  // Current PRD hash (resolved + hashed, 12-char prefix to match dir-name hashes).
  const currentHash = (await hashPRD(this.sessionManager.prdPath)).slice(0, 12);
  if (latest.hash === currentHash) {
    // No pending change on the latest session — normal initialize() will load it by hash.
    return false;
  }
  // Pending change detected. Check whether the latest session is COMPLETED.
  const backlog = await readTasksJSON(latest.path);
  if (!this.#isBacklogComplete(backlog)) {
    // Latest session is incomplete — do not reuse; fall through to normal init.
    return false;
  }
  // REUSE: load the completed session as current WITHOUT initialize()/createDeltaSession.
  this.logger.info(
    `[PRPPipeline] ${this.mode} mode: reusing completed session ${latest.id} ` +
      'for re-run; pending PRD change left in place for the next normal run'
  );
  await this.sessionManager.loadSessionAsCurrent(latest.path);
  return true;
}

/**
 * All-subtasks-Complete predicate over a Backlog (standalone — mirrors #allTasksComplete()
 * at :2023 but operates on an arbitrary Backlog rather than the current session).
 */
#isBacklogComplete(backlog: Backlog): boolean {
  for (const phase of backlog.backlog) {
    for (const milestone of phase.milestones) {
      for (const task of milestone.tasks) {
        for (const subtask of task.subtasks) {
          if (subtask.status !== 'Complete') return false;
        }
      }
    }
  }
  return true;
}
```

The guard in `initializeSession()`:

```typescript
// === refactor of initializeSession() try-block top (prp-pipeline.ts:535+) ===

try {
  // PRP §4.3 step 2 (validate/bug-hunt reuse completed session): if we're in validate or
  // bug-hunt mode and the latest session is completed with a pending PRD change, reuse it
  // instead of letting initialize() create a new empty session (which has no tasks.json and
  // would make the validate/bug-hunt gates bail). The pending change is left in place.
  if (this.mode === 'validate' || this.mode === 'bug-hunt') {
    const reused = await this.tryReuseCompletedSessionForReRun();
    if (reused) {
      const session = this.sessionManager.currentSession!;
      this.logger.info(`[PRPPipeline] Session: ${session.metadata.id}`);
      this.logger.info(`[PRPPipeline] Path: ${session.metadata.path}`);
      this.logger.info(
        `[PRPPipeline] Existing: ${session.taskRegistry.backlog.length > 0}`
      );
      // Build the TaskOrchestrator against the reused session (mirrors the normal path —
      // run()'s rebuildQueue() at :1887 requires a non-null orchestrator).
      await this.#buildTaskOrchestrator();   // EXTRACT from the normal path, OR inline it
      this.currentPhase = 'session_initialized';
      this.logger.info('[PRPPipeline] Session initialized successfully (reused)');
      return;   // SKIP initialize() + the :577 delta branch entirely.
    }
    // else: fall through to the normal initialize() path.
  }

  // === existing normal path (unchanged) ===
  const session = await this.sessionManager.initialize();
  this.logger.info(`[PRPPipeline] Session: ${session.metadata.id}`);
  // ... existing logging + orchestrator construction + delta check + phase set ...
}
```

> **Note on `#buildTaskOrchestrator()`**: the existing normal path constructs
> `new TaskOrchestratorClass(this.sessionManager, this.#scope, this.#noCache, ...)` after
> `initialize()` (around `:543-570`). The simplest, lowest-risk approach is to **extract those
> construction lines into a private `#buildTaskOrchestrator()` method** and call it from BOTH
> the normal path and the reused branch. This avoids duplicating the (long) constructor call
> with its retry/research-cache args. If the implementer prefers NOT to refactor the normal
> path, they may inline the same `new TaskOrchestratorClass(...)` call in the reused branch —
> but the extracted-helper approach is preferred (DRY, single source of truth).

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/core/session-manager.ts — ADD loadSessionAsCurrent()
  - IMPLEMENT: `async loadSessionAsCurrent(sessionPath: string): Promise<SessionState>` per the
    Data models block. It calls this.loadSession(sessionPath) (existing public :569), assigns
    #currentSession, sets #prdHash = (await hashPRD(this.prdPath)).slice(0,12), returns session.
  - FOLLOW pattern: initialize()'s hash caching at :316-323 + :405 (loadSession + assign
    #currentSession) + :327 (set #prdHash). loadSessionAsCurrent is the combination.
  - NAMING: loadSessionAsCurrent (verb-first, matches loadSession).
  - PLACEMENT: src/core/session-manager.ts immediately after loadSession() (~line 607).
  - IMPORT: hashPRD is ALREADY imported in session-manager.ts (used by initialize() at :316).
    Confirm; if not, import from './session-utils.js'.
  - JSDOC: Mode A citing PRD §4.3 step 2 + the pending-change-stays explanation.

Task 2: MODIFY src/workflows/prp-pipeline.ts — initializeSession() guard + helper
  - EXTRACT (optional but preferred): the TaskOrchestrator construction in initializeSession()
    (~:543-570, the `new TaskOrchestratorClass(...)` + retryConfig block) into a private
    `async #buildTaskOrchestrator(): Promise<void>` (or sync — match existing). Call it from
    the normal path (replacing the inlined construction) AND the new reused branch. This keeps a
    single source of truth for orchestrator args. (If you choose NOT to extract, inline the same
    `new TaskOrchestratorClass(...)` in the reused branch — either is acceptable; extracted is
    DRY-er.)
  - ADD private `#isBacklogComplete(backlog: Backlog): boolean` per the Data models block (mirrors
    #allTasksComplete() :2023 but on an arbitrary Backlog). Place near #allTasksComplete().
  - ADD private `async tryReuseCompletedSessionForReRun(): Promise<boolean>` per the Data models
    block. It: reads planDir from this.sessionManager.planDir; calls
    SessionManager.findLatestSession(planDir); returns false on null; computes currentHash via
    hashPRD(this.sessionManager.prdPath).slice(0,12); returns false if latest.hash === currentHash;
    loads backlog via readTasksJSON(latest.path); returns false if !#isBacklogComplete(backlog);
    else logs the reuse message, calls this.sessionManager.loadSessionAsCurrent(latest.path),
    returns true.
  - MODIFY initializeSession() try-block top (BEFORE `const session = await
    this.sessionManager.initialize()` at :536): add the `if (this.mode === 'validate' || 'bug-hunt')`
    guard per the Data models block. On reuse: log session id/path/existing, call
    #buildTaskOrchestrator(), set currentPhase='session_initialized', log success, RETURN. On
    fall-through: continue to the existing normal path unchanged.
  - IMPORT: hashPRD + readTasksJSON from '../core/session-utils.js' (check existing imports —
    hashPRDContent is already imported at :45; hashPRD may need adding). SessionManager is already
    imported (used for the instance type). Backlog type from '../core/models.js'.
  - JSDOC: Mode A on tryReuseCompletedSessionForReRun + initializeSession's new branch, quoting
    PRD §4.3 step 2 verbatim.
  - GOTCHA: the reused branch must NOT call initialize(), handleDelta(), createDeltaSession(), or
    refresh prd_snapshot.md. It must set currentPhase='session_initialized' (matching the normal
    path) so downstream phases/log work.

Task 3: CREATE tests/unit/workflows/prp-pipeline-validate-reuse.test.ts
  - IMPORT: describe, expect, it, vi, beforeEach, afterEach from 'vitest'; PRPPipeline from
    '../../../src/workflows/prp-pipeline.js'; SessionManager from
    '../../../src/core/session-manager.js'; types (Backlog, SessionState, SessionMetadata) from
    '../../../src/core/models.js'.
  - COPY the full vi.mock() block from prp-pipeline.test.ts:17-114 (12 modules: node:fs/promises,
    session-utils passthrough with resolvePRD overridden, session-manager factory, task-orchestrator,
    agent-factory, prompts passthrough, delta/bug-hunt/fix-cycle workflows, task-patcher,
    task-utils, execution-guard). ADD overrides as needed: you'll spy findLatestSession (static)
    and the session-utils hashPRD/readTasksJSON (for the completion probe), so ensure session-utils
    is mocked with importOriginal passthrough + only resolvePRD overridden (so hashPRD/readTasksJSON
    run real — OR override them; pick one and be consistent).
  - CLONE createMockSessionManager (prp-pipeline.test.ts:226-243). ADD fields the reuse path needs:
    `planDir: '/test/plan'`, `loadSessionAsCurrent: vi.fn().mockResolvedValue(session)`. Keep
    initialize/createDeltaSession/hasSessionChanged/saveBacklog/flushUpdates/prdPath.
  - CLONE the data factories (createTestSubtask/Task/Milestone/Phase/Backlog/Session :170-224).
    Build a "completed" backlog: all subtasks status 'Complete'. Build a "pending/incomplete"
    backlog: at least one subtask status 'Planned'.
  - beforeEach: vi.clearAllMocks() + reset SessionManager mock to the default (null currentSession)
    + mockValidateNestedExecution(() => {}) + mockIsNestedExecutionError(false). afterEach:
    process.removeAllListeners('SIGINT'/'SIGTERM').
  - describe('loadSessionAsCurrent (SessionManager)'):
      * GIVEN a real-ish SessionManager (or a constructed instance via the factory) → call
        loadSessionAsCurrent(path) → VERIFY currentSession === the loaded session; VERIFY the
        method called loadSession(path); VERIFY #prdHash effect: hasSessionChanged() returns false
        after (since #prdHash === current PRD hash by construction — mock hashPRD to a known
        value and set the session's metadata.hash to the SAME value to assert false, OR to a
        DIFFERENT value to assert the in-memory override makes it false regardless).
        (Since #prdHash is private, assert via hasSessionChanged()'s observable return: true before
        loadSessionAsCurrent, false after.)
  - describe('tryReuseCompletedSessionForReRun / initializeSession reuse'):
      * CASE A (validate mode, completed latest session, pending change): pipeline.mode='validate';
        vi.spyOn(SessionManager,'findLatestSession').mockResolvedValue({id,path,hash:'OLDHASH',...});
        mock hashPRD → 'NEWHASH...' (slice → 'NEWHASH'); mock readTasksJSON → completed backlog;
        EXECUTE pipeline.initializeSession(); VERIFY: findLatestSession called with planDir;
        loadSessionAsCurrent called with latest.path; this.sessionManager.initialize NOT called;
        vi.spyOn(pipeline,'handleDelta') NOT called; mock.createDeltaSession NOT called;
        currentPhase === 'session_initialized'; currentSession is the reused session.
      * CASE B (bug-hunt mode, same as A but mode='bug-hunt'): same assertions.
      * CASE C (fall-through: no latest session): findLatestSession → null; mode='validate';
        EXECUTE initializeSession(); VERIFY: loadSessionAsCurrent NOT called; initialize() WAS
        called (normal path); currentPhase === 'session_initialized' (via normal path).
      * CASE D (fall-through: no pending change — latest.hash === currentHash): findLatestSession →
        {hash:'SAME'}; hashPRD → 'SAME...'; mode='validate'; EXECUTE initializeSession(); VERIFY:
        loadSessionAsCurrent NOT called; readTasksJSON NOT called (short-circuit on hash match);
        initialize() WAS called.
      * CASE E (fall-through: latest session NOT all complete): findLatestSession → {hash:'OLD'};
        hashPRD → 'NEW'; readTasksJSON → incomplete backlog (one 'Planned' subtask); mode='validate';
        EXECUTE initializeSession(); VERIFY: loadSessionAsCurrent NOT called; initialize() WAS called.
      * CASE F (normal mode never enters the guard): mode='normal'; latest completed session with
        pending change; EXECUTE initializeSession(); VERIFY: findLatestSession NOT called (guard
        skipped); initialize() WAS called (normal path). (Tests the `if mode` branch's false side.)
      * CASE G (delta mode never enters the guard): mode='delta'; same as F — findLatestSession NOT
        called; initialize() WAS called.
      * CASE H (#isBacklogComplete predicate): unit-test directly — completed backlog → true;
        incomplete → false; empty backlog (no subtasks) → true (vacuously — edge case to document).
  - COVERAGE: 100% of tryReuseCompletedSessionForReRun (every return) + #isBacklogComplete (both
    branches + the vacuous-true edge) + loadSessionAsCurrent + the new initializeSession branches
    (the `if validate/bug-hunt` true/false, the `if reused` true/false). Run `npm run
    test:coverage` to confirm.
  - GOTCHA: because the reuse path reads this.sessionManager.planDir and calls the STATIC
    findLatestSession, set mock.planDir in createMockSessionManager AND spy the static. Because it
    calls hashPRD + readTasksJSON from session-utils, either let them run real (passthrough mock)
    or override them in the session-utils mock factory — be consistent and assert the observable
    outcome (reuse vs fall-through), not internal call counts, where possible.
```

### Implementation Patterns & Key Details

```typescript
// PATTERN: loadSessionAsCurrent — make a chosen session current without re-hashing or new-dir.
//   Mirrors initialize()'s load branch (:405) + hash caching (:327), minus the hash lookup.
async loadSessionAsCurrent(sessionPath: string): Promise<SessionState> {
  const session = await this.loadSession(sessionPath);
  this.#currentSession = session;
  this.#prdHash = (await hashPRD(this.prdPath)).slice(0, 12); // current PRD → hasSessionChanged() false
  return session;
}

// PATTERN: the guard — top of initializeSession() try block, mode-gated, early-return on reuse.
if (this.mode === 'validate' || this.mode === 'bug-hunt') {
  if (await this.tryReuseCompletedSessionForReRun()) {
    // session reused; build orchestrator + set phase; SKIP initialize() + delta branch.
    await this.#buildTaskOrchestrator();
    this.currentPhase = 'session_initialized';
    return;
  }
}

// PATTERN: the test asserts the reused path does NOT fork (vi.spyOn + not.toHaveBeenCalled).
const handleDeltaSpy = vi.spyOn(pipeline, 'handleDelta').mockResolvedValue(undefined);
await pipeline.initializeSession();
expect(handleDeltaSpy).not.toHaveBeenCalled();            // precedent: prp-pipeline.test.ts:719-728
expect(mockManager.createDeltaSession).not.toHaveBeenCalled();
expect(mockManager.initialize).not.toHaveBeenCalled();    // the KEY new assertion (reuse skips init)
expect(pipeline.currentPhase).toBe('session_initialized');
```

### Integration Points

```yaml
SESSION SELECTION (the seam):
  - guard in: src/workflows/prp-pipeline.ts initializeSession() try-block top (before :536)
  - pattern: "if (mode validate/bug-hunt) { if (tryReuseCompletedSessionForReRun()) { build
              orchestrator + set phase + return; } }"
  - preserved: the normal initialize() path (:536+) is unchanged for non-(validate/bug-hunt)
               modes and for fall-through cases.

SESSION MANAGER (the helper):
  - add to: src/core/session-manager.ts (near loadSession ~:607)
  - method: "loadSessionAsCurrent(sessionPath): Promise<SessionState>"
  - internal: assigns #currentSession + #prdHash (private fields; do NOT expose)

NO OTHER INTEGRATION POINTS:
  - CLI: none (--mode surface unchanged; args.mode already flows to PRPPipeline.mode).
  - CONFIG: none (no new env var).
  - ROUTES/MIGRATIONS: none.
  - DOCS: none (CONTRACT item 5: "DOCS: none").
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Run after each file creation - fix before proceeding
npm run lint               # eslint . --ext .ts (fix any errors in the new/modified files)
npm run format             # prettier --write (.ts)
npm run typecheck          # tsc --noEmit -p tsconfig.build.json

# Project-wide validation
npm run format:check       # prettier --check (.ts — no .md changes in this PRP)
# Expected: Zero errors. If errors exist, READ output and fix before proceeding.
```

### Level 2: Unit Tests (Component Validation)

```bash
# Test the new reuse path
npx vitest run tests/unit/workflows/prp-pipeline-validate-reuse.test.ts

# Regression: ensure existing prp-pipeline tests still pass (the initializeSession refactor must
# not break the normal path)
npx vitest run tests/unit/workflows/prp-pipeline.test.ts
npx vitest run tests/unit/workflows/prp-pipeline-progress.test.ts

# Coverage verification (NOT run by validate — run explicitly to hit the 100% gate)
npx vitest run --coverage
# Expected: 100% statements/branches/functions/lines on the NEW code in session-manager.ts
# (loadSessionAsCurrent) + prp-pipeline.ts (tryReuseCompletedSessionForReRun, #isBacklogComplete,
# the initializeSession guard branches). Existing files already at 100%; new branches each need
# a test (Cases A–H in Implementation Tasks Task 3).
```

### Level 3: Integration Testing (System Validation)

```bash
# Build
npm run build

# Manual smoke (requires a real completed session + a pending PRD edit):
# 1. Run the pipeline once to completion on a small PRD (all tasks Complete).
# 2. Note the latest session dir: ls plan/   → e.g. plan/005_<hash>/
# 3. Edit PRD.md (add a trivial line).
# 4. Re-run in validate mode:
#      node dist/index.js --pr PRD.md --mode validate
#    EXPECT: log line "...validate mode: reusing completed session 005_<hash> for re-run;
#            pending PRD change left in place..."; NO new plan/006_ dir created; QA skipped.
# 5. Re-run in bug-hunt mode:
#      node dist/index.js --pr PRD.md --mode bug-hunt
#    EXPECT: same reuse log; QA runs against the completed session's tasks.
# 6. Confirm the pending change is STILL pending (next normal run processes it):
#      ls plan/   → still only up to 005 (no delta spawned by the validate/bug-hunt runs)
#      cat plan/005_<hash>/prd_snapshot.md | tail -3   → still the OLD PRD (not refreshed)
# 7. Re-run in normal mode:
#      node dist/index.js --pr PRD.md
#    EXPECT: now a delta session (006_) IS spawned (the pending change is processed).
ls plan/
test -d plan/005_<hash> && echo "completed session preserved"
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Verify no accidental overlap with S1's surface (the two PRPs touch disjoint regions):
git diff --name-only
# EXPECT exactly: src/core/session-manager.ts, src/workflows/prp-pipeline.ts,
#                 tests/unit/workflows/prp-pipeline-validate-reuse.test.ts
# (If handleDelta, the marker functions, --accept-prd-changes, or docs appear, you've collided
#  with S1 — stop and re-scope.)

# Confirm the guard does not fire for normal/delta modes (regression):
grep -n "this.mode === 'validate' || this.mode === 'bug-hunt'" src/workflows/prp-pipeline.ts
# EXPECT exactly one match, inside initializeSession().
```

---

## Final Validation Checklist

### Technical Validation

- [ ] `npm run validate` GREEN (lint + format:check + typecheck + test:run).
- [ ] `npx vitest run --coverage` shows 100% on the new code.
- [ ] All existing prp-pipeline tests still pass (no regressions from the initializeSession refactor).
- [ ] `git diff --name-only` shows EXACTLY the 3 files: src/core/session-manager.ts,
      src/workflows/prp-pipeline.ts, tests/unit/workflows/prp-pipeline-validate-reuse.test.ts.

### Feature Validation

- [ ] validate mode + completed latest session + pending change → session reused; initialize()
      NOT called; handleDelta NOT called; createDeltaSession NOT called; prd_snapshot.md NOT
      refreshed; currentPhase === 'session_initialized'; QA skipped (per runQACycle validate branch).
- [ ] bug-hunt mode + completed latest session + pending change → session reused (same as above);
      QA runs against the reused session's completed tasks.
- [ ] No latest session → fall through to normal initialize() (validate/bug-hunt).
- [ ] Latest session hash == current PRD hash (no pending change) → fall through to normal
      initialize() (which loads it by hash).
- [ ] Latest session NOT all complete → fall through to normal initialize().
- [ ] normal mode and delta mode → guard never entered; normal initialize() runs (regression).
- [ ] Pending change stays pending: prd_snapshot.md untouched; next normal run spawns the delta.

### Code Quality Validation

- [ ] Follows existing patterns (loadSession + hash caching from initialize; vi.spyOn +
      not.toHaveBeenCalled from prp-pipeline.test.ts:719-728; createMockSessionManager helper).
- [ ] File placement matches the desired codebase tree.
- [ ] Anti-patterns avoided (see below).
- [ ] Mode-A JSDoc on loadSessionAsCurrent + tryReuseCompletedSessionForReRun + the
      initializeSession guard, citing PRD §4.3 step 2.

### Documentation & Deployment

- [ ] **No doc edits** (CONTRACT item 5: "DOCS: none"). If tempted to edit docs, STOP — the
      `--mode validate`/`--mode bug-hunt` surface is already documented; this is internal behavior.

---

## Anti-Patterns to Avoid

- ❌ **Don't fix this in `runQACycle()` or `handleDelta()`** — it's too late there. By the time
  either runs, `initialize()` has already selected the wrong (empty) session. The guard MUST go
  in `initializeSession()` before `initialize()`.
- ❌ **Don't touch S1's surface** — `handleDelta()`, the `prd_changed.marker` trio,
  `--accept-prd-changes`, integrate-into-current, and the docs are S1's. This PRP edits
  `initializeSession()` + adds `loadSessionAsCurrent()` in disjoint regions. (Both touch
  `prp-pipeline.ts` and `session-manager.ts`, but in non-overlapping line ranges.)
- ❌ **Don't add a `SessionState.status` / `SessionMetadata.status` field** — completion is
  derived from tasks.json (`#allTasksComplete()` precedent). A status field is a large
  blast-radius change (interface + Zod + loadSession + every constructor), explicitly out of scope.
- ❌ **Don't refresh `prd_snapshot.md` in the reuse path** — the contract is explicit: the
  pending change stays pending for the next normal run. `loadSessionAsCurrent` sets `#prdHash`
  to the current PRD hash **in memory only**; the on-disk snapshot is untouched.
- ❌ **Don't call `createDeltaSession()` in the reuse path** — that creates a NEW dir (exactly
  the empty-delta failure we're avoiding). The reuse operates on the EXISTING session dir.
- ❌ **Don't call `SessionManager.initialize()` in the reuse path** — it re-hashes and, on
  mismatch, creates a new empty session. The whole point of `loadSessionAsCurrent` is to bypass it.
- ❌ **Don't skip building the TaskOrchestrator in the reused branch** — `run()` calls
  `this.taskOrchestrator.rebuildQueue()` at `:1887`; a null orchestrator throws. Mirror the
  normal path's orchestrator construction (prefer extracting `#buildTaskOrchestrator()`).
- ❌ **Don't change the `--mode` CLI surface or add flags** — CONTRACT item 5: no API/config
  change. `--mode validate`/`--mode bug-hunt` already exist; this PRP only reads `this.mode`.
- ❌ **Don't edit docs** — CONTRACT item 5: "DOCS: none". The behavior is internal; the modes
  are already documented.
- ❌ **Don't conflate `--validate-prd` with `--mode validate`** — `--validate-prd`
  (`cli/index.ts:299-303`) is a separate flag that short-circuits to run only `PRDValidator`
  and never constructs `PRPPipeline`. This PRP is about `--mode validate` only.
- ❌ **Don't rely on `executeBacklog` being skipped** — it isn't; it runs but the orchestrator's
  ready-queue is empty for an all-Complete backlog (`task-orchestrator.ts:540`), so it processes
  0 items. Don't add an executeBacklog skip for the reused branch.
- ❌ **Don't skip the coverage run** — `npm run validate` does NOT run coverage. Run
  `npx vitest run --coverage` explicitly to verify 100% on the new branches (Cases A–H).

---

## Confidence Score

**9/10** for one-pass implementation success.

**Rationale**: The research is exhaustive (3 parallel scouts + targeted file reads); the
root cause is crisply identified (mode-blind `initialize()` creates an empty session on hash
mismatch) with the exact seam (top of `initializeSession()` try block); the missing piece
(`loadSession` is public but doesn't set `#currentSession`) has a minimal clean solution
(`loadSessionAsCurrent`, a 4-line method mirroring `initialize()`'s load+hash-cache); the
detection primitives all already exist (`findLatestSession`, `readTasksJSON`, `hashPRD`); the
downstream-tolerance is proven (`decomposePRD` skips on existing backlog; `executeBacklog` is a
no-op on an all-Complete backlog's empty queue; `runQACycle` already does the right per-mode
thing); the test mock seams are documented from the existing `prp-pipeline.test.ts`; and the
S1/S2 non-overlap is verified at the implementation-seam level. The 1-point deduction is for
the orchestrator-construction refactor decision (extract `#buildTaskOrchestrator()` vs inline)
being left to the implementer's judgment — both are acceptable, but the choice slightly affects
diff shape. This is explicitly documented, not hidden.