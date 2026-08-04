# PRP — P1.M2.T2.S1: Wire `classifyArtifactWithRetry` guard into `decomposePRD`

> Bugfix 002, **BUG-002 (MAJOR) Part B** — the artifact-classifier slice. The two
> LLM change classifiers are fully implemented but never called. **Part A**
> (parallel P1.M2.T1.S2) wires the COSMETIC/SUBSTANTIVE change classifier into
> `initializeSession`; **Part B (this item) wires the CLEAN/DIRTY artifact
> classifier around `delta_prd.md` consumption in `decomposePRD`.** Today
> `decomposePRD` (`prp-pipeline.ts:1295`) loads `prdContent = await
> loadDeltaPRD(sessionPath)` and feeds it straight to the architect — so a
> DIRTY/malformed delta PRD is consumed unprotected, contrary to PRD §4.3's
> protective requirement. This item classifies the artifact immediately after
> load (delta-only) and ABORTS the breakdown on DIRTY, so malformed content is
> never fed to the architect unprotected; the next run regenerates
> `delta_prd.md` fresh via the delta spawn path and re-classifies (no infinite
> loop). Mode A: a JSDoc note documents the guard.

---

## Goal

**Feature Goal**: Wire `classifyArtifactWithRetry(prdContent)` into
`PRPPipeline.decomposePRD()` so the generated `delta_prd.md` artifact is
classified as CLEAN/DIRTY **before** it is fed to the architect (PRD §4.3 step 1
"CLEAN/DIRTY classifier guards generated artifacts (e.g., the delta PRD) … never
… proceed unprotected"). **CLEAN → proceed** to the architect (unchanged);
**DIRTY → abort the breakdown** (`logger.warn` + `throw`) so the architect is
never called on malformed content. The guard is **delta-only** (the non-delta
full PRD is human-authored and is intentionally never classified).

**Deliverable**:
1. **`src/workflows/prp-pipeline.ts`** — EDIT: (a) add
   `import { classifyArtifactWithRetry } from '../core/change-classifier.js';`
   (NOT currently imported); (b) insert a delta-scoped guard block in
   `decomposePRD` immediately after the `prdContent` assignment (before
   `createArchitectPrompt`, ~line 1309) that classifies and aborts on DIRTY;
   (c) [Mode A] add/extend the `decomposePRD` JSDoc with a note documenting the
   artifact-classifier guard + the DIRTY action.
2. **`tests/unit/workflows/prp-pipeline.test.ts`** — EDIT: (a) extend the
   existing `change-classifier.js` mock with `classifyArtifactWithRetry: vi.fn()`
   + a `mockClassifyArtifact` handle (default `CLEAN` in `beforeEach`); (b)
   extend the existing `session-utils.js` mock with
   `loadDeltaPRD: vi.fn().mockResolvedValue('# Sample delta PRD content')`; (c)
   add 3 new tests under `describe('decomposePRD')`: CLEAN→proceeds,
   DIRTY→aborts (architect NOT called), non-delta→NOT classified.

**Success Definition**:
- A delta session with a CLEAN `delta_prd.md` → the architect IS invoked and
  `currentPhase === 'prd_decomposed'` (unchanged success path).
- A delta session with a DIRTY `delta_prd.md` → the architect is NEVER invoked;
  a prominent `logger.warn` is emitted; `currentPhase === 'prd_decomposition_failed'`
  (the outer catch's non-fatal handling — same as the existing "Architect agent
  failed" throw).
- A non-delta (initial) session → the full PRD is NEVER classified
  (`mockClassifyArtifact` not called); the architect IS invoked.
- Classifier exhaustion → protective default DIRTY → abort (the classifier's own
  catch returns DIRTY; the guard then aborts — fail-safe preserved, no infinite
  loop because the delta spawn regenerates fresh `delta_prd.md` each run).
- `classifyArtifactWithRetry` is imported + called in the delta branch.
- `npm run typecheck && npm run lint && npm run format:check` clean; the targeted
  test file is GREEN (existing + 3 new tests); classifier suites unchanged-green.

---

## Why

- **BUG-002: the artifact classifier is dead code.** `classifyArtifactWithRetry`
  (change-classifier.ts:257) is fully implemented with the correct PRD §4.3
  protective default (exhaustion → DIRTY) but is NEVER CALLED in production.
  This item makes the second of the two classifiers live.
- **PRD §4.3's protective requirement.** §4.3 step 1: "A parallel CLEAN/DIRTY
  classifier **guards** generated artifacts (e.g., the delta PRD) … **never
  silently fall through to 'could not classify' and proceed unprotected**."
  Today `decomposePRD` consumes `delta_prd.md` with no guard, so a
  DIRTY/malformed artifact is fed to the architect unprotected. This item closes
  that gap.
- **The action-on-DIRTY is ABORT, verified against §4.3.** §4.3 does not name the
  exact mechanism, but its governing principle ("never proceed unprotected")
  RULES OUT warn-and-proceed (that would feed DIRTY content to the architect).
  ABORT is the only consistent action. It mirrors TWO existing aborts in the same
  function — the `loadDeltaPRD`-missing throw (~1297) and the "Architect agent
  failed" throw (~1318) — so it is consistent with established handling. See
  `research/action-on-dirty-and-test-scaffolding.md §2` for the full rationale.
- **Closes the loop on Part A.** Part A (P1.M2.T1.S2) wires the change classifier
  into detection; Part B wires the artifact classifier around consumption. They
  are a matched pair (Part A = `initializeSession`, Part B = `decomposePRD`),
  editing different functions + different classifier mock handles in the same two
  files — a clean additive merge (see Disjointness).
- **No infinite loop (verified).** The classifier's exhaustion default is DIRTY,
  so classifier-down → DIRTY → abort → next run. On resume the delta spawn
  (DeltaAnalysisWorkflow) regenerates `delta_prd.md` fresh and the guard
  re-classifies the new content. Fresh input each run ⇒ terminates.
- **Docs accuracy (Mode A).** A JSDoc note on `decomposePRD`'s delta branch
  documents the guard + the DIRTY action + rationale. NO `docs/*.md`.
- **Scope discipline.** This item edits ONLY `prp-pipeline.ts` (the import + the
  guard + the JSDoc) + its test file. It does NOT touch `change-classifier.ts`
  (read-only import), `session-manager.ts` (Part A's seam), `prd-differ.ts`
  (read-only), `loadDeltaPRD`'s definition in `session-utils.ts` (read-only —
  only its MOCK changes), or Part A's `initializeSession`/`handleDelta` work.
- **Out of scope (hard boundary):** Part A's change classifier wiring
  (`initializeSession`/`handleDelta`/`classifyChangeWithRetry`), `change-classifier.ts`
  edits, `session-manager.ts`, `session-utils.ts` source, `decomposePRD`'s
  non-guard body, the backlog-merge/patch logic, any `docs/*.md` (Mode A = the
  JSDoc note only), and the broader test-suite green-up (BUG-004, P1.M4).

---

## What

### User-visible behavior
A delta session whose generated `delta_prd.md` is DIRTY/malformed no longer feeds
that content to the architect — the breakdown aborts with a prominent warning and
`currentPhase='prd_decomposition_failed'`; the next run regenerates a fresh
`delta_prd.md`. A CLEAN delta PRD breaks down exactly as today. An initial
(non-delta) session is entirely unaffected (the full PRD is never classified). No
CLI surface change.

### Technical requirements (exact contract)

**`src/workflows/prp-pipeline.ts`** — add the import (top, near the other
`../core/` imports, e.g. alongside the Part A `classifyChangeWithRetry` import
that P1.M2.T1.S2 adds — if S2 hasn't landed yet, place near the existing
`../core/session-utils.js` import ~61):
```ts
import { classifyArtifactWithRetry } from '../core/change-classifier.js';
```

**`decomposePRD()` guard** — insert a delta-scoped block immediately BEFORE
`const architectPrompt = createArchitectPrompt(prdContent, sessionPath);`
(~line 1309), i.e. right after the `if (isDelta) { … loadDeltaPRD … } else { … }`
assignment block. Verbatim:
```ts
      // BUG-002 Part B: guard the GENERATED delta_prd.md artifact (PRD §4.3 step 1).
      // classifyArtifactWithRetry returns 'CLEAN' | 'DIRTY', failing to the protective
      // default 'DIRTY' on exhaustion (PRD §4.3: "never … proceed unprotected"). A DIRTY
      // verdict (malformed artifact OR classifier-down) MUST NOT be fed to the architect
      // unprotected — abort this breakdown so the next run regenerates delta_prd.md fresh
      // via the delta spawn path and re-classifies (no infinite loop: the delta spawn
      // regenerates the file each run). §4.3's "never proceed unprotected" rules out
      // warn-and-proceed. The plain Error is caught by the outer catch as NON-fatal
      // (isFatalError treats a plain Error as non-fatal) → #trackFailure + warn +
      // currentPhase='prd_decomposition_failed' — identical handling to the
      // 'Architect agent failed' throw below and the loadDeltaPRD-missing throw above.
      // DELTA-ONLY: the non-delta path's prdContent is the full human-authored PRD
      // (currentSession.prdSnapshot), NOT a generated artifact — it is intentionally
      // NEVER classified (classifying it would block every initial breakdown on
      // classifier availability).
      if (isDelta) {
        const artifactVerdict = await classifyArtifactWithRetry(prdContent);
        if (artifactVerdict === 'DIRTY') {
          this.logger.warn(
            '[PRPPipeline] delta_prd.md classified DIRTY/malformed (PRD §4.3) — ' +
              'aborting breakdown; refusing to feed the architect unprotected. ' +
              'Re-run to regenerate delta_prd.md via the delta spawn path.'
          );
          throw new Error(
            'delta_prd.md classified DIRTY/malformed (PRD §4.3) — refusing to feed ' +
              'the architect unprotected. Re-run to regenerate delta_prd.md via the ' +
              'delta spawn path.'
          );
        }
      }
```

**[Mode A] `decomposePRD` JSDoc** — add/extend the JSDoc above `decomposePRD`
(~line 1231) with a note documenting the guard. If a JSDoc block already exists,
append a `@remarks` line; if not, add a concise one. Required content:
> `@remarks` **BUG-002 Part B (PRD §4.3):** on a delta session the generated
> `delta_prd.md` is classified CLEAN/DIRTY via `classifyArtifactWithRetry` before
> it is fed to the architect. CLEAN proceeds; DIRTY aborts the breakdown
> (`currentPhase='prd_decomposition_failed'`) so malformed content is never
> consumed unprotected. The non-delta full PRD is never classified.
(The detailed rationale lives in the inline comment block above — that is the
primary documentation of the action + decision, per item LOGIC §3.)

**`tests/unit/workflows/prp-pipeline.test.ts`** — mock + helper extensions + new
tests (see Implementation Tasks).

### Success Criteria
- [ ] `classifyArtifactWithRetry` is imported from `'../core/change-classifier.js'` and called inside the delta branch of `decomposePRD`.
- [ ] CLEAN verdict (delta) → architect invoked; `currentPhase === 'prd_decomposed'`.
- [ ] DIRTY verdict (delta) → architect NOT invoked; `logger.warn` called; `currentPhase === 'prd_decomposition_failed'`.
- [ ] Non-delta session → `classifyArtifactWithRetry` NOT called; architect invoked.
- [ ] The guard is wrapped in `if (isDelta)` (full PRD never classified).
- [ ] JSDoc note added (Mode A); `change-classifier.ts`/`session-utils.ts` source untouched.
- [ ] Existing decomposePRD tests (448/463/etc.) stay GREEN (mock defaults make the non-delta path unaffected).
- [ ] `npm run typecheck && npm run lint && npm run format:check` clean; targeted test file GREEN.

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_ **Yes** —
the exact insertion site (immediately before `createArchitectPrompt` at ~1309), the verbatim guard block, the import line, the verified action-on-DIRTY decision (ABORT, with the §4.3 rationale ruling out warn-and-proceed), the outer-catch NON-fatal handling (plain Error → `prd_decomposition_failed`, identical to the existing architect-failed throw), the delta-only design decision (with its rationale), the classifier signature + its already-correct protective default, the THREE existing test mocks to extend (additively — no replacement), the `createTestSession` delta-override pattern (`parentSession` spread), and the three new test cases. See `research/action-on-dirty-and-test-scaffolding.md` for per-claim evidence.

### Documentation & References
```yaml
# MUST READ — the BUG-002 fix design (what this item implements: Part B)
- docfile: plan/008_15504f60a0ef/bugfix/002_86589b7d57d2/architecture/bug-002-classifiers.md
  section: "Fix design → Part B — artifact classifier around delta_prd.md"
  why: Prescribes the wiring (classifyArtifactWithRetry(prdContent) before architect consumption; DIRTY → abort + regenerate-next-run) and flags the action-on-DIRTY as the one ambiguous point to verify against §4.3.
  critical: §4.3 verified — "never proceed unprotected" RULES OUT warn-and-proceed; ABORT is correct.

# MUST READ — this subtask's research (the decision + exact edit map + test scaffolding)
- docfile: plan/008_15504f60a0ef/bugfix/002_86589b7d57d2/P1M2T2S1/research/action-on-dirty-and-test-scaffolding.md
  section: "1. PRD §4.3 exact contract", "2. ACTION-ON-DIRTY decision (ABORT)", "3. insertion point",
           "4. delta-only design", "5. classifyArtifactWithRetry signature", "6. test scaffolding", "8. disjointness"
  why: The §4.3 verbatim quote; the ABORT decision + why warn-and-proceed is ruled out; the decomposePRD structure
        + exact line to insert before; why no pipeline-level try/catch is needed (the classifier's own catch returns
        DIRTY — the DIRTY path IS the exhaustion path); the 3 mocks to extend + the createTestSession delta override;
        the 3 new tests; the additive-merge story with Part A.

# MUST READ — PRD §4.3 (the contract this item enforces)
- file: PRD.md
  section: "4.3 The 'Delta' Workflow (Change Management)" (lines 78-84, step 1 "Change Classification")
  why: Verbatim: "A parallel CLEAN/DIRTY classifier guards generated artifacts (e.g., the delta PRD) … On
        exhaustion they MUST fail to the protective/conservative default (treat as SUBSTANTIVE / DIRTY) — never
        silently fall through to 'could not classify' and proceed unprotected."
  critical: The governing principle is "never … proceed unprotected" → ABORT (not warn-and-proceed) on DIRTY.

# THE FILE TO EDIT + the classifier to import
- file: src/workflows/prp-pipeline.ts
  why: EDIT decomposePRD() — insert the delta-scoped guard before createArchitectPrompt (~1309); add the import;
        add/extend the decomposePRD JSDoc (Mode A).
  pattern: "if (isDelta) { try { prdContent = await loadDeltaPRD(sessionPath); } catch { throw new Error('… re-run to regenerate …'); } } else { prdContent = …prdSnapshot ?? ''; }   ← INSERT GUARD AFTER THIS, BEFORE createArchitectPrompt"
  critical: The guard MUST be wrapped in `if (isDelta)` (delta-only). The throw is a plain Error → caught NON-fatal
        by the outer catch (~1366) → #trackFailure + currentPhase='prd_decomposition_failed' (identical to the
        existing 'Architect agent failed' throw at ~1318 and the loadDeltaPRD-missing throw at ~1297). Do NOT make
        it a fatal error type (no caller-behavior change, no scope creep).

- file: src/core/change-classifier.ts
  why: READ-ONLY — provides `export async function classifyArtifactWithRetry(content: string): Promise<'CLEAN'|'DIRTY'>`
        (line 257). Its own catch already returns DIRTY on retry-exhaustion (282-289) — so it NEVER throws in normal
        operation (NO pipeline-level try/catch needed around it, unlike Part A's classifyChangeWithRetry reject test).
        Import the FUNCTION (value) into prp-pipeline.ts; do NOT edit this file.
  gotcha: classifyArtifactWithRetry ALWAYS resolves (CLEAN/DIRTY) in normal operation. The DIRTY path IS the
        exhaustion/protective-default path — so mocking it to DIRTY covers both "malformed artifact" and
        "classifier-down" in one test. Requires PiHarness initialized at runtime — MOCKED in unit tests (no harness).

# PATTERN FILES — the test file this item edits + its mock helpers
- file: tests/unit/workflows/prp-pipeline.test.ts
  why: EDIT — (1) extend the change-classifier.js mock (~56, currently {classifyChangeWithRetry:vi.fn()}) with
        classifyArtifactWithRetry:vi.fn() + a mockClassifyArtifact handle (default CLEAN in beforeEach); (2) extend
        the session-utils.js mock (~36, spreads ...actual) with loadDeltaPRD:vi.fn().mockResolvedValue('# Sample
        delta PRD content'); (3) add 3 tests under describe('decomposePRD') (line 423): CLEAN/DIRTY/non-delta.
  pattern: "vi.mock('../../../src/core/change-classifier.js', () => ({ classifyChangeWithRetry: vi.fn(), classifyArtifactWithRetry: vi.fn() }));  const mockClassifyArtifact = classifyArtifactWithRetry as unknown as ReturnType<typeof vi.fn>;"
  critical: createTestSession (264) hardcodes parentSession:null. Build a delta session via spread:
        { ...createTestSession(backlog), metadata: { ...createTestSession(backlog).metadata, parentSession: '/plan/000_prev' } }.
        The existing non-delta decomposePRD tests (448/463) stay GREEN because isDelta=false → guard skipped →
        mockClassifyArtifact never called. mockClassifyArtifact default CLEAN keeps any delta test that forgets to
        set it on the success path.

- file: tests/unit/workflows/prp-pipeline.test.ts (the "reuses the same single Architect agent instance" test, ~496)
  why: PATTERN for the architect-SUCCESS path the CLEAN test needs: mockCreateArchitectAgent.mockReturnValue({ prompt:
        vi.fn().mockResolvedValue({ status:'success', output:'' }) }); mockReadFile.mockResolvedValueOnce(JSON.stringify({ backlog: [] })).
        Copy this setup for the CLEAN delta test (plus isDelta=true + mockClassifyArtifact CLEAN + loadDeltaPRD mocked).

# CONSUMER-ADJACENT (read-only — do NOT edit)
- file: src/core/session-utils.ts
  why: loadDeltaPRD is DEFINED here (line 1632). READ-ONLY — only its MOCK changes in the test. Do NOT edit the source.
- file: src/utils/errors.ts
  why: isFatalError (835) — a plain Error with continueOnError=false (the default) is NON-fatal. This is WHY the DIRTY
        throw is caught and tracked (not propagated). Read-only — confirms the abort handling.

# PARALLEL-SIBLING CONTRACT (assume implemented as-specified — additive merge, no conflict)
- docfile: plan/008_15504f60a0ef/bugfix/002_86589b7d57d2/P1M2T1S2/PRP.md
  why: Part A. Edits initializeSession (~781) + the handleDelta JSDoc (~845); mocks classifyChangeWithRetry. This
        item edits decomposePRD (~1309) + the decomposePRD JSDoc; mocks classifyArtifactWithRetry. DIFFERENT functions,
        DIFFERENT JSDoc, DIFFERENT classifier mock handle — SAME two files (clean additive merge: both extend the
        change-classifier.js mock by one key each; both add one mock* handle + one beforeEach default; Part A doesn't
        touch session-utils, this adds loadDeltaPRD to it). Reference its contract; do NOT duplicate its work.
```

### Current Codebase tree (relevant slice)
```bash
src/workflows/prp-pipeline.ts                  # EDIT — decomposePRD guard + import + JSDoc
src/core/change-classifier.ts                  # READ-ONLY (import classifyArtifactWithRetry)
src/core/session-utils.ts                      # READ-ONLY (loadDeltaPRD definition; only its MOCK changes)
src/utils/errors.ts                            # READ-ONLY (isFatalError — confirms non-fatal handling)
tests/unit/workflows/prp-pipeline.test.ts      # EDIT — +classifyArtifactWithRetry mock, +loadDeltaPRD mock, +3 tests
```

### Desired Codebase tree with files to be added/edited
```bash
src/workflows/prp-pipeline.ts                  # MODIFIED (import + decomposePRD delta guard + JSDoc note)
tests/unit/workflows/prp-pipeline.test.ts      # MODIFIED (mock extensions + 3 new decomposePRD tests)
```

### Known Gotchas of our codebase & Library Quirks
```ts
// CRITICAL — ACTION-ON-DIRTY = ABORT (logger.warn + throw), verified against §4.3. §4.3's "never proceed
//   unprotected" RULES OUT warn-and-proceed (that feeds DIRTY content to the architect). The throw is a PLAIN
//   Error → caught NON-fatal by decomposePRD's outer catch (~1366) → #trackFailure + logger.warn +
//   currentPhase='prd_decomposition_failed' (architect NEVER called). This is IDENTICAL to the existing
//   'Architect agent failed' throw (~1318) + the loadDeltaPRD-missing throw (~1297). Do NOT make it a fatal
//   error type (would change caller behavior / scope creep). See research §2.

// CRITICAL — the guard is DELTA-ONLY. Wrap it in `if (isDelta)`. The non-delta prdContent is the full
//   human-authored PRD (currentSession.prdSnapshot) — NOT a generated artifact. Classifying it would (a) be
//   semantically wrong and (b) block EVERY initial breakdown on classifier availability (classifier-down → DIRTY
//   → abort every new session). §4.3 scopes the classifier to "generated artifacts (e.g., the delta PRD)".

// CRITICAL — NO pipeline-level try/catch is needed around classifyArtifactWithRetry (unlike Part A's
//   classifyChangeWithRetry). classifyArtifactWithRetry's OWN catch returns DIRTY on retry-exhaustion
//   (change-classifier.ts:282-289) — it NEVER throws in normal operation. The DIRTY path IS the exhaustion path,
//   so one DIRTY test covers both "malformed artifact" and "classifier-down".

// CRITICAL — createTestSession (prp-pipeline.test.ts:264) hardcodes parentSession:null → isDelta=false. To test
//   the delta branch, build a delta session via spread: { ...createTestSession(backlog), metadata: { ...base.metadata,
//   parentSession: '/plan/000_prev' } }. (isDelta = currentSession?.metadata.parentSession != null — prp-pipeline.ts:1240.)

// CRITICAL — for the CLEAN delta test, the architect-SUCCESS path needs: mockCreateArchitectAgent.mockReturnValue(
//   { prompt: vi.fn().mockResolvedValue({ status:'success', output:'' }) }) AND mockReadFile.mockResolvedValueOnce(
//   JSON.stringify({ backlog: [] })). Mirror the "reuses the same single Architect agent instance" test (~496).

// GOTCHA — the DIRTY test asserts decomposePRD() RESOLVES (not rejects). The plain-Error throw is caught NON-fatal
//   → method resolves with currentPhase='prd_decomposition_failed'. Assert: mockCreateArchitectAgent NOT called +
//   currentPhase==='prd_decomposition_failed' + logger.warn called. Do NOT `expect(pipeline.decomposePRD()).rejects`.

// GOTCHA — the existing change-classifier.js mock (~56) returns { classifyChangeWithRetry: vi.fn() } (added by Part A).
//   ADD classifyArtifactWithRetry: vi.fn() to the SAME object (additive — do NOT replace classifyChangeWithRetry).
//   The session-utils.js mock (~36) spreads ...actual then overrides — ADD loadDeltaPRD:vi.fn().mockResolvedValue(...)
//   AFTER the ...actual spread so the override wins.

// GOTCHA — bugfix BUG-004: the FULL `npm run test:run` is PRE-EXISTING-RED (178 failures — P1.M4 scope). Do NOT use
//   it as the gate. Gate = typecheck + lint + format:check + the TARGETED prp-pipeline.test.ts. The guard + mock
//   additions cannot increase the red count; verify the existing decomposePRD tests (448/463/etc.) + the 3 new ones.

// GOTCHA — 100% coverage globally enforced (vitest.config.ts). The guard's `if (isDelta)` true branch + the
//   `if (DIRTY)` both branches need tests (CLEAN covers the proceed branch; DIRTY covers the throw branch; the
//   existing non-delta tests + the new non-delta assertion cover the `if (isDelta)` false branch). All covered.

// GOTCHA — prettier is ERROR-enforced (format:check). Run `npm run fix` before validate. The multi-line guard block
//   + JSDoc may reflow — let `npm run fix` handle it.

// CRITICAL — DO NOT touch change-classifier.ts (read-only import), session-utils.ts source (only its MOCK changes),
//   errors.ts (read-only), initializeSession/handleDelta (Part A's surface), session-manager.ts, prd-differ.ts,
//   decomposePRD's non-guard body, or any docs/*.md (Mode A = the JSDoc note only).
```

---

## Implementation Blueprint

### Data models and structure
No new data models. This item consumes `ArtifactClassification = 'CLEAN'|'DIRTY'` (change-classifier.ts) and the existing `prdContent: string`. The only "structure" is the guard block (verbatim above), the import, the JSDoc note, and the test mock extensions.

### Implementation Tasks (ordered by dependencies — implicit TDD: RED first, then GREEN)
```yaml
Task 1: EDIT tests/unit/workflows/prp-pipeline.test.ts  (RED — extend mocks + add the 3 tests FIRST)
  - EXTEND the change-classifier.js mock (~56) — ADD classifyArtifactWithRetry: vi.fn() to the returned object
    (keep classifyChangeWithRetry from Part A). Then near the other `as any` handles:
        import { classifyArtifactWithRetry } from '../../../src/core/change-classifier.js';
        const mockClassifyArtifact = classifyArtifactWithRetry as unknown as ReturnType<typeof vi.fn>;
  - EXTEND the session-utils.js mock (~36) — ADD to the returned object (after ...actual):
        loadDeltaPRD: vi.fn().mockResolvedValue('# Sample delta PRD content'),
  - EXTEND beforeEach: mockClassifyArtifact.mockResolvedValue('CLEAN');   (safe default → proceeds; keeps any
    delta test that forgets to set it on the success path).
  - ADD a small delta-session helper near createTestSession (or inline the spread in each delta test):
        function createDeltaSession(backlog, prdSnapshot='# Test PRD', sessionPath='/plan/001_14b9dc2a33c7') {
          const base = createTestSession(backlog, prdSnapshot, sessionPath);
          return { ...base, metadata: { ...base.metadata, parentSession: '/plan/000_prev' } };
        }
  - ADD under describe('decomposePRD') (line 423):
      * it('classifies delta_prd.md CLEAN and proceeds to the architect (delta session)'):
          mockClassifyArtifact.mockResolvedValueOnce('CLEAN');
          mockCreateArchitectAgent.mockReturnValue({ prompt: vi.fn().mockResolvedValue({ status:'success', output:'' }) } as never);
          mockReadFile.mockResolvedValueOnce(JSON.stringify({ backlog: [] }));
          const pipeline = new PRPPipeline('./test.md');
          (pipeline as any).sessionManager = createMockSessionManager(createDeltaSession(createTestBacklog([])));
          await pipeline.decomposePRD();
          expect(mockClassifyArtifact).toHaveBeenCalledWith('# Sample delta PRD content');
          expect(mockCreateArchitectAgent).toHaveBeenCalled();
          expect(pipeline.currentPhase).toBe('prd_decomposed');
      * it('aborts the breakdown (architect NOT called) when delta_prd.md is DIRTY (PRD §4.3)'):
          mockClassifyArtifact.mockResolvedValueOnce('DIRTY');
          const pipeline = new PRPPipeline('./test.md');
          (pipeline as any).sessionManager = createMockSessionManager(createDeltaSession(createTestBacklog([])));
          await pipeline.decomposePRD();   // resolves (non-fatal catch)
          expect(mockClassifyArtifact).toHaveBeenCalled();
          expect(mockCreateArchitectAgent).not.toHaveBeenCalled();
          expect(pipeline.currentPhase).toBe('prd_decomposition_failed');
      * it('does NOT classify the full PRD on a non-delta (initial) session'):
          const pipeline = new PRPPipeline('./test.md');
          (pipeline as any).sessionManager = createMockSessionManager(createTestSession(createTestBacklog([])));
          // mockCreateArchitectAgent default (or set a success mock) so the architect path runs:
          mockCreateArchitectAgent.mockReturnValue({ prompt: vi.fn().mockResolvedValue({ status:'success', output:'' }) } as never);
          mockReadFile.mockResolvedValueOnce(JSON.stringify({ backlog: [] }));
          await pipeline.decomposePRD();
          expect(mockClassifyArtifact).not.toHaveBeenCalled();
          expect(mockCreateArchitectAgent).toHaveBeenCalled();
  - EXPECTED NOW: the 3 new tests FAIL (no wiring yet) → RED. The existing non-delta decomposePRD tests (448/463/etc.)
    stay GREEN (isDelta=false → guard skipped → mockClassifyArtifact never called; createArchitectAgent still invoked).

Task 2: EDIT src/workflows/prp-pipeline.ts  (GREEN — the import + the guard)
  - ADD import: import { classifyArtifactWithRetry } from '../core/change-classifier.js';  (near the other ../core/
    imports; if Part A's classifyChangeWithRetry import is present, place alongside it).
  - INSERT the delta-scoped guard block (verbatim from "Technical requirements") immediately BEFORE
    `const architectPrompt = createArchitectPrompt(prdContent, sessionPath);` (~1309) — i.e. right after the
    `if (isDelta) { … loadDeltaPRD … } else { … prdSnapshot … }` assignment block.
  - DO NOT: classify the non-delta prdContent; remove the isDelta wrapper; add a pipeline-level try/catch around
    classifyArtifactWithRetry (unnecessary — its own catch returns DIRTY); touch decomposePRD's non-guard body,
    initializeSession, handleDelta, loadDeltaPRD's source, or session-manager.ts/change-classifier.ts.
  - EXPECTED: Task 1's new tests turn GREEN; existing decomposePRD tests stay GREEN.

Task 3: EDIT src/workflows/prp-pipeline.ts  (JSDoc — Mode A)
  - Add/extend the JSDoc above decomposePRD (~1231) with the @remarks note from "Technical requirements" documenting
    the artifact-classifier guard + the DIRTY action (CLEAN proceeds; DIRTY aborts; non-delta never classified).
    The detailed rationale lives in the inline comment block at the guard (added in Task 2).
  - DO NOT change decomposePRD's signature, @param, or body (beyond Task 2's guard).
  - EXPECTED: no behavior change; typecheck/format pass.

Task 4: FORMAT + VERIFY
  - RUN: npm run fix → npm run typecheck → npm run lint → npm run format:check.
  - RUN: npx vitest run tests/unit/workflows/prp-pipeline.test.ts   # existing + 3 new decomposePRD tests → GREEN.
  - RUN: npx vitest run tests/unit/core/change-classifier.test.ts tests/unit/core/change-classifier-resilient.test.ts  # classifier unchanged → green.
  - DO NOT run the full `npm run test:run` (pre-existing red — bugfix BUG-004, P1.M4 scope).
  - EXPECTED: typecheck/lint/format clean; prp-pipeline.test.ts green (incl. 448/463 + the 3 new tests); classifier
    tests green. If 448/463 fail → mockClassifyArtifact default isn't CLEAN (check beforeEach) OR the guard isn't
    wrapped in `if (isDelta)` (the non-delta path would then call the classifier). If a new test fails → the guard
    branch wasn't hit (check isDelta via the parentSession spread + the loadDeltaPRD mock). If coverage drops on
    prp-pipeline.ts → a guard branch (DIRTY throw / CLEAN proceed / isDelta false) lacks a test.
```

### Implementation Patterns & Key Details
```ts
// ---- src/workflows/prp-pipeline.ts: the import (near ../core/ imports ~61) ----
import { classifyArtifactWithRetry } from '../core/change-classifier.js';

// ---- decomposePRD: the guard (insert BEFORE createArchitectPrompt, ~1309) ----
if (isDelta) {
  const artifactVerdict = await classifyArtifactWithRetry(prdContent);
  if (artifactVerdict === 'DIRTY') {
    this.logger.warn(
      '[PRPPipeline] delta_prd.md classified DIRTY/malformed (PRD §4.3) — ' +
        'aborting breakdown; refusing to feed the architect unprotected. ' +
        'Re-run to regenerate delta_prd.md via the delta spawn path.'
    );
    throw new Error(
      'delta_prd.md classified DIRTY/malformed (PRD §4.3) — refusing to feed ' +
        'the architect unprotected. Re-run to regenerate delta_prd.md via the ' +
        'delta spawn path.'
    );
  }
}

// ---- tests/unit/workflows/prp-pipeline.test.ts: the mock + helper extensions ----
// 1) change-classifier.js mock (~56) — ADD classifyArtifactWithRetry (keep Part A's classifyChangeWithRetry):
vi.mock('../../../src/core/change-classifier.js', () => ({
  classifyChangeWithRetry: vi.fn(),
  classifyArtifactWithRetry: vi.fn(),
}));
import { classifyArtifactWithRetry } from '../../../src/core/change-classifier.js';
const mockClassifyArtifact = classifyArtifactWithRetry as unknown as ReturnType<typeof vi.fn>;
// 2) session-utils.js mock (~36) — ADD loadDeltaPRD (after ...actual):
//      loadDeltaPRD: vi.fn().mockResolvedValue('# Sample delta PRD content'),
// 3) beforeEach: mockClassifyArtifact.mockResolvedValue('CLEAN');
// 4) delta-session helper (createTestSession hardcodes parentSession:null):
function createDeltaSession(backlog: Backlog) {
  const base = createTestSession(backlog);
  return { ...base, metadata: { ...base.metadata, parentSession: '/plan/000_prev' } } as SessionState;
}

// ---- the DIRTY test (the headline new assertion) ----
it('aborts the breakdown (architect NOT called) when delta_prd.md is DIRTY (PRD §4.3)', async () => {
  mockClassifyArtifact.mockResolvedValueOnce('DIRTY');
  const pipeline = new PRPPipeline('./test.md');
  (pipeline as any).sessionManager = createMockSessionManager(createDeltaSession(createTestBacklog([])));
  await pipeline.decomposePRD(); // resolves — the plain-Error throw is caught NON-fatal
  expect(mockClassifyArtifact).toHaveBeenCalled();
  expect(mockCreateArchitectAgent).not.toHaveBeenCalled();
  expect(pipeline.currentPhase).toBe('prd_decomposition_failed');
});
```

### Integration Points
```yaml
PRP-PIPELINE.TS (src/workflows/prp-pipeline.ts):
  - +import { classifyArtifactWithRetry } from '../core/change-classifier.js'
  - decomposePRD (~1309): insert the delta-scoped CLEAN/DIRTY guard before createArchitectPrompt.
  - decomposePRD JSDoc (~1231): add/extend with the @remarks artifact-guard note (Mode A).
  - PRESERVE: the isDelta computation; the loadDeltaPRD try/catch; createArchitectPrompt/retryAgentPrompt/mergeBacklogs;
    decomposePRD's outer try/catch; initializeSession/handleDelta (Part A's surface).

CHANGE-CLASSIFIER.TS: READ-ONLY — import classifyArtifactWithRetry (value).
SESSION-UTILS.TS: READ-ONLY — loadDeltaPRD source unchanged (only its MOCK changes).
ERRORS.TS: READ-ONLY — isFatalError confirms the non-fatal handling of the plain-Error throw.

TEST (tests/unit/workflows/prp-pipeline.test.ts):
  - +classifyArtifactWithRetry on the change-classifier.js mock + mockClassifyArtifact handle (default CLEAN).
  - +loadDeltaPRD on the session-utils.js mock (returns sample content).
  - +createDeltaSession helper (parentSession spread) + 3 new decomposePRD tests. PRESERVE 448/463/etc.

DOCS (Mode A — the JSDoc note rides with the work):
  - The decomposePRD @remarks note is the ONLY doc artifact. NO docs/*.md.

DOWNSTREAM / OUT OF SCOPE:
  - P1.M2.T1.S2 wires classifyChangeWithRetry into initializeSession — Part A; do NOT do it here.
  - The loadDeltaPRD-missing throw (~1297) and the Architect-failed throw (~1318) are PRE-EXISTING aborts the DIRTY
    abort mirrors — do NOT change them.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
npm run fix            # lint:fix + prettier --write (run first — the guard block + JSDoc may reflow)
npm run typecheck      # tsc --noEmit -p tsconfig.build.json — clean
npm run lint           # eslint . --ext .ts — clean
npm run format:check   # prettier --check — clean
# Expected: all clean. Likely failure: a type error if the import path/ArtifactClassification union is wrong.
```

### Level 2: Unit Tests (Component Validation)
```bash
# The directly-affected suite — MUST be GREEN (existing decomposePRD tests + 3 new ones):
npx vitest run tests/unit/workflows/prp-pipeline.test.ts
# The classifier is UNCHANGED — its own suites must stay green (proves this item only imported it):
npx vitest run tests/unit/core/change-classifier.test.ts tests/unit/core/change-classifier-resilient.test.ts
# Expected: all green. If 448/463 fail → mockClassifyArtifact default isn't CLEAN OR the guard isn't wrapped in
#   `if (isDelta)` (non-delta path would call the classifier). If a new test fails → the guard branch wasn't hit
#   (check isDelta via the parentSession spread + the loadDeltaPRD mock returning sample content).
# Do NOT run the full `npm run test:run` — pre-existing red (bugfix BUG-004, P1.M4 scope).
```

### Level 3: Integration / Regression (System Validation)
```bash
# Confirm the guard + import + JSDoc landed:
grep -n "classifyArtifactWithRetry" src/workflows/prp-pipeline.ts   # Expect: 1 import + 1 call ≥2 hits.
grep -n "classified DIRTY/malformed" src/workflows/prp-pipeline.ts  # Expect: ≥2 hits (warn + throw messages).
grep -n "if (isDelta)" src/workflows/prp-pipeline.ts                # Expect: the loadDeltaPRD block + the guard block (≥2).
# Build emits dist/ cleanly (proves the import + guard compile):
npx tsc -p tsconfig.build.json
# Sibling regression — change-classifier + session-utils source unchanged:
npx vitest run tests/unit/core/change-classifier.test.ts tests/unit/core/change-classifier-resilient.test.ts
# Expected: grep confirms the wiring; build clean; classifier suites green (this item only imported classifyArtifactWithRetry).
```

### Level 4: Creative & Domain-Specific Validation
```bash
# No MCP/DB/HTTP (the classifier + loadDeltaPRD are mocked in tests). Domain checks (record in commit message):
#   1. CLEAN (delta) ⇒ architect invoked ⇒ prd_decomposed — unchanged success path for well-formed deltas.
#   2. DIRTY (delta) ⇒ architect NOT invoked ⇒ prd_decomposition_failed + prominent warn — malformed content never
#      fed to the architect unprotected (PRD §4.3 "never proceed unprotected").
#   3. Non-delta ⇒ full PRD NEVER classified (delta-only design; §4.3 scopes the classifier to "generated artifacts").
#   4. Classifier exhaustion ⇒ protective default DIRTY ⇒ abort (fail-safe). No infinite loop: the delta spawn path
#      regenerates delta_prd.md fresh each run and re-classifies new content.
#   5. The DIRTY abort is consistent with the loadDeltaPRD-missing throw + the Architect-failed throw (same outer
#      catch, same non-fatal handling) — no caller-behavior change.
#   6. Action-on-DIRTY decision (ABORT, not warn-and-proceed) + §4.3 rationale recorded in the inline comment AND
#      the commit message (item LOGIC §3).
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` clean.
- [ ] `npm run lint` clean.
- [ ] `npm run format:check` clean.
- [ ] `npx vitest run tests/unit/workflows/prp-pipeline.test.ts` GREEN (existing + 3 new decomposePRD tests).
- [ ] `npx vitest run tests/unit/core/change-classifier.test.ts tests/unit/core/change-classifier-resilient.test.ts` GREEN.

### Feature Validation
- [ ] `classifyArtifactWithRetry` imported + called inside the delta branch of `decomposePRD`.
- [ ] CLEAN (delta) → architect invoked; `currentPhase === 'prd_decomposed'`.
- [ ] DIRTY (delta) → architect NOT invoked; `logger.warn` called; `currentPhase === 'prd_decomposition_failed'`.
- [ ] Non-delta → `classifyArtifactWithRetry` NOT called; architect invoked.
- [ ] Guard wrapped in `if (isDelta)` (full PRD never classified).

### Code Quality Validation
- [ ] The guard is delta-scoped; inserted before `createArchitectPrompt`, after the `prdContent` assignment.
- [ ] No pipeline-level try/catch around `classifyArtifactWithRetry` (its own catch returns DIRTY).
- [ ] Only `src/workflows/prp-pipeline.ts` + `tests/unit/workflows/prp-pipeline.test.ts` modified.
- [ ] `change-classifier.ts`, `session-utils.ts`, `errors.ts`, `session-manager.ts`, `initializeSession`/`handleDelta` UNTOUCHED.
- [ ] Existing non-delta decomposePRD tests (448/463/etc.) stay GREEN.

### Documentation & Deployment
- [ ] The decomposePRD `@remarks` note is the only doc artifact (Mode A); the detailed rationale is in the inline comment.
- [ ] No `docs/*.md`, README, or `.env.example` changes.
- [ ] Commit message records: the artifact-classifier wiring; the ABORT action-on-DIRTY decision + the §4.3 rationale
      (warn-and-proceed ruled out by "never proceed unprotected"); the delta-only design; the no-infinite-loop argument
      (delta spawn regenerates fresh); the consistency with the loadDeltaPRD-missing + Architect-failed aborts; the
      Part A cross-reference; the 3 mocks extended + the createTestSession delta override.

---

## Anti-Patterns to Avoid

- ❌ Don't warn-and-proceed on DIRTY. §4.3's governing principle is "never proceed unprotected" — feeding a DIRTY
      artifact to the architect violates it. ABORT (logger.warn + throw) is the only consistent action.
- ❌ Don't make the DIRTY throw a FATAL error type (EnvironmentError/SessionError/etc.). A plain Error is caught
      NON-fatal → `prd_decomposition_failed` — identical to the existing Architect-failed + loadDeltaPRD-missing
      throws. A fatal error would re-throw out of decomposePRD and change caller behavior (scope creep).
- ❌ Don't classify the non-delta full PRD. The guard MUST be wrapped in `if (isDelta)`. The full PRD is human-authored
      (not a generated artifact); classifying it would block every initial breakdown on classifier availability
      (classifier-down → DIRTY → abort every new session).
- ❌ Don't assert `pipeline.decomposePRD()` REJECTS in the DIRTY test. The plain-Error throw is caught NON-fatal → the
      method RESOLVES with `currentPhase='prd_decomposition_failed'`. Assert architect-NOT-called + the phase + warn.
- ❌ Don't add a pipeline-level try/catch around `classifyArtifactWithRetry`. Unlike Part A's `classifyChangeWithRetry`
      (which has a reject test), `classifyArtifactWithRetry`'s OWN catch returns DIRTY on exhaustion — it never throws
      in normal operation. The DIRTY path IS the exhaustion path.
- ❌ Don't REPLACE the change-classifier.js mock's `classifyChangeWithRetry` (Part A added it). ADD
      `classifyArtifactWithRetry` alongside it (additive merge). Same for the session-utils.js mock: ADD `loadDeltaPRD`
      after the `...actual` spread (don't remove resolvePRD/writeDeltaPRD).
- ❌ Don't forget the `parentSession` spread to make `isDelta === true`. `createTestSession` hardcodes
      `parentSession:null`. Without the override, `isDelta === false` → the guard is skipped → the CLEAN/DIRTY tests
      never call `mockClassifyArtifact` and fail.
- ❌ Don't forget the architect-SUCCESS setup for the CLEAN test (`mockCreateArchitectAgent.mockReturnValue({prompt:
      vi.fn().mockResolvedValue({status:'success',output:''})})` + `mockReadFile.mockResolvedValueOnce(JSON.stringify(
      {backlog:[]}))`). Without it the CLEAN test blows up past the guard in the architect/readFile path.
- ❌ Don't edit `change-classifier.ts` (read-only import), `session-utils.ts` source (only its MOCK changes),
      `errors.ts` (read-only), `initializeSession`/`handleDelta` (Part A's surface), `session-manager.ts`,
      `prd-differ.ts`, or `decomposePRD`'s non-guard body.
- ❌ Don't run the full `npm run test:run` as the gate — it's pre-existing red (bugfix BUG-004, 178 failures, P1.M4 scope).
      Gate = typecheck + lint + format:check + the targeted prp-pipeline.test.ts + the classifier suites.
- ❌ Don't edit any `docs/*.md` — DOCS is Mode A (the decomposePRD `@remarks` JSDoc note only).

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: This is a focused wiring task with every dependency already in place: the classifier
(`classifyArtifactWithRetry`, change-classifier.ts:257) is fully implemented with its protective default and never
throws (its own catch returns DIRTY); the insertion site (immediately before `createArchitectPrompt` at ~1309) is
precise; the guard block is specified verbatim; and the ambiguous action-on-DIRTY is RESOLVED by direct verification
of PRD §4.3 ("never proceed unprotected" rules out warn-and-proceed → ABORT), with the abort's handling proven
identical to two existing throws in the same function (loadDeltaPRD-missing + Architect-failed → non-fatal catch →
`prd_decomposition_failed`). The delta-only design decision is documented with its rationale + a locking test. The
test scaffolding is fully mapped: the THREE existing mocks to extend (additively — no replacement), the
`createTestSession` delta-override pattern, and the three new tests (CLEAN/DIRTY/non-delta) with verbatim assertions.
The ONE non-obvious risk — the DIRTY test must assert RESOLVE (not reject) because the plain-Error throw is caught
non-fatal — is documented. The additive-merge story with Part A (P1.M2.T1.S2) is verified: different functions,
different JSDoc, different classifier mock handle, same two files — clean merge. The no-infinite-loop argument
(delta spawn regenerates fresh `delta_prd.md` each run) is verified. The caveat that the full suite is pre-existing
red (bugfix BUG-004) is handled by gating on the targeted prp-pipeline.test.ts + the classifier suites. Residual
risks: (a) a missing beforeEach default for `mockClassifyArtifact` (enumerated — default CLEAN); (b) forgetting the
architect-success setup for the CLEAN test (enumerated); (c) a prettier reflow (auto-fixed via `npm run fix`). No
runtime/network/LLM unknowns — the classifier + loadDeltaPRD are mocked in tests.