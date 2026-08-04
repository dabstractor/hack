# PRP — P1.M2.T1.S2: Wire `classifyChangeWithRetry` into `initializeSession` + correct the misleading JSDoc

> Bugfix 002, **BUG-002 (MAJOR) Part A** — the wiring slice. The two LLM change
> classifiers are fully implemented but never called; today `initializeSession`
> (`prp-pipeline.ts:781`) routes EVERY PRD change (even whitespace-only) straight to
> `handleDelta()` via a pure-hash `hasSessionChanged()` check. S1 (parallel) adds the
> SessionManager seam (`getChangeDiffSummary` + `absorbCosmeticChange`); **S2 wires the
> classifier into `initializeSession`**: classify the diff → SUBSTANTIVE routes to
> `handleDelta`, COSMETIC is absorbed via `absorbCosmeticChange` (no delta session). A
> pipeline-level try/catch defaults to SUBSTANTIVE if the classifier itself throws
> (defense-in-depth; the contract's "unavailable classifier → SUBSTANTIVE" fail-safe).
> The misleading `handleDelta` JSDoc (which claims classification is "NOT wired — a
> separate work item") is corrected to describe the now-real contract.

---

## Goal

**Feature Goal**: Wire `classifyChangeWithRetry(diffSummary)` into
`PRPPipeline.initializeSession()` so a detected PRD change is classified before any
delta session is spawned: SUBSTANTIVE → `handleDelta()` (unchanged behavior);
COSMETIC → `sessionManager.absorbCosmeticChange()` (NEW — refresh baseline, no delta
session). Add a pipeline-level try/catch so a classifier throw degrades to SUBSTANTIVE
(never silently skips the delta session). Correct the false `handleDelta` JSDoc.

**Deliverable**:
1. **`src/workflows/prp-pipeline.ts`** — EDIT: (a) add `import { classifyChangeWithRetry } from '../core/change-classifier.js';`
   (NOT currently imported); (b) rewrite the `initializeSession` detection block
   (~781-786): `hasSessionChanged()` → `getChangeDiffSummary()` → (optional empty-diff
   pre-filter) → `classifyChangeWithRetry()` in a protective try/catch → SUBSTANTIVE ⇒
   `handleDelta()` / COSMETIC ⇒ `absorbCosmeticChange()`; (c) correct the misleading
   `CONTRACT INPUT` JSDoc on `handleDelta()` (~845-849) to describe the now-real contract.
2. **`tests/unit/workflows/prp-pipeline.test.ts`** — EDIT: (a) add
   `vi.mock('../../../src/core/change-classifier.js', …)` + a `mockClassifyChange` handle
   defaulting to `'SUBSTANTIVE'`; (b) extend `createMockSessionManager` (+ the `beforeEach`
   default mock) with `getChangeDiffSummary` + `absorbCosmeticChange`; (c) add explicit
   SUBSTANTIVE / COSMETIC / reject→SUBSTANTIVE (+(optional) empty-diff) tests under
   `describe('initializeSession')`. The existing "should call handleDelta when
   hasSessionChanged returns true" test (~2048) stays GREEN via the SUBSTANTIVE default.

**Success Definition**:
- A SUBSTANTIVE PRD change → `handleDelta()` runs (delta session), `absorbCosmeticChange()` does NOT.
- A COSMETIC PRD change → `absorbCosmeticChange()` runs (baseline refreshed, no delta session),
  `handleDelta()` does NOT.
- A classifier throw/reject (mocked) → the pipeline defaults to SUBSTANTIVE → `handleDelta()` runs
  (fail-safe; never silently skips).
- (Optional) An empty `diffSummary.changes` (pure-whitespace, normalized away) → COSMETIC path
  WITHOUT calling the classifier (cheap pre-filter skips the LLM).
- `hasSessionChanged() === false` → the whole block is skipped (byte-equivalent to today).
- The misleading JSDoc is corrected; `classifyChangeWithRetry` is imported + called.
- `npm run typecheck && npm run lint && npm run format:check` clean; the targeted test file is GREEN
  (existing + new tests); no regression from the mock-helper change.

---

## Why

- **BUG-002: the classifiers are dead code.** `classifyChangeWithRetry` (change-classifier.ts:206)
  is fully implemented with the correct PRD §4.3 protective default (exhaustion → SUBSTANTIVE) but
  is NEVER CALLED in production. The only non-definition reference is a JSDoc comment that
  MISREPRESENTS the behavior. S2 makes the comment true by actually wiring the classifier.
- **PRD §4.3 step 1 requires classification before delta spawn.** Today every edit — including a
  whitespace-only COSMETIC edit — triggers a full delta session (DeltaAnalysisWorkflow + architect
  decomposition + patching), wasting LLM tokens and pointlessly re-running the architect. S2 makes
  COSMETIC edits cheap (absorb) and reserves the delta session for SUBSTANTIVE changes.
- **Closes the loop on S1's seam.** S1 (parallel) adds `getChangeDiffSummary` + `absorbCosmeticChange`
  to SessionManager specifically so S2 can call them from `initializeSession`. Without S2, S1's
  methods are unused; without S1, S2 has no seam. They are a matched pair (file-disjoint: S1 =
  session-manager.ts, S2 = prp-pipeline.ts).
- **Fail-safe preservation.** The contract: "Exhaustion/unavailable classifier → SUBSTANTIVE (current
  behavior preserved)." The classifier's own catch handles retry-exhaustion; S2's pipeline-level
  try/catch additionally guards an unexpected throw around the classifier (module-load failure, a
  non-transient error) → still SUBSTANTIVE → still spawns the delta session. COSMETIC skipping is
  OPT-IN (only on a confident COSMETIC verdict); any failure → SUBSTANTIVE → safe.
- **Docs accuracy (Mode A).** The `handleDelta` JSDoc currently claims "Classification is NOT wired
  by this item — it is upstream and a separate work item." That was always false (it was never
  wired anywhere). S2 makes it true and corrects the comment to match.
- **Scope discipline.** S2 edits ONLY `prp-pipeline.ts` (the wiring + JSDoc + import) + its test
  file. It does NOT touch `session-manager.ts` (S1), `change-classifier.ts` (read-only import),
  `prd-differ.ts` (read-only), the CLEAN/DIRTY artifact guard around `delta_prd.md`
  (P1.M2.T2.S1 — a separate subtask), or `acceptPrdChangesResponse` (an optional follow-up).
- **Out of scope (hard boundary):** the artifact classifier `classifyArtifactWithRetry` (P1.M2.T2.S1),
  `session-manager.ts` (S1), `change-classifier.ts` edits, refactoring `acceptPrdChangesResponse` to
  delegate to `absorbCosmeticChange` (nice follow-up, not required), any `docs/*.md` (Mode A = the
  JSDoc correction only), and the broader test-suite green-up (BUG-004, P1.M4).

---

## What

### User-visible behavior
A whitespace-only (COSMETIC) PRD edit on an active session no longer spawns a full delta session —
it is absorbed silently (the baseline is refreshed). A SUBSTANTIVE edit still spawns the delta
session exactly as today. No CLI surface change.

### Technical requirements (exact contract)

**`src/workflows/prp-pipeline.ts`** — add the import (top, near the other `../core/` imports ~73-74):
```ts
import { classifyChangeWithRetry } from '../core/change-classifier.js';
```

**`initializeSession()` detection block** — replace the body of the `if (hasSessionChanged())`
block (~781-786). The `if (hasSessionChanged())` GUARD stays (it's the gate); only its body changes:
```ts
      if (this.sessionManager.hasSessionChanged()) {
        // BUG-002 Part A: classify the change before spawning a delta session (PRD §4.3 step 1).
        // hasSessionChanged() is a pure hash compare, so EVERY edit reaches here; the classifier
        // decides whether the change is SUBSTANTIVE (→ delta session) or COSMETIC (→ absorb the new
        // baseline without a delta session). Any classification failure degrades to SUBSTANTIVE
        // (the protective default — never silently skip a delta session on a classifier failure).
        const diffSummary = await this.sessionManager.getChangeDiffSummary();

        // Cheap pre-filter: diffPRDs already normalizes whitespace away, so a pure-whitespace
        // edit yields zero changes → COSMETIC without an LLM call.
        if (diffSummary.changes.length === 0) {
          this.logger.info(
            '[PRPPipeline] PRD diff is empty after normalization — absorbing as COSMETIC'
          );
          await this.sessionManager.absorbCosmeticChange();
        } else {
          let verdict: 'COSMETIC' | 'SUBSTANTIVE';
          try {
            verdict = await classifyChangeWithRetry(diffSummary);
          } catch (error) {
            // Protective default (PRD §4.3): classifyChangeWithRetry already fails to SUBSTANTIVE
            // on retry exhaustion; this guards the residual "classifier threw around its own catch"
            // case (e.g. module-load failure) — never silently skip the delta session.
            this.logger.warn(
              { error },
              '[PRPPipeline] Change classifier threw; failing to protective default SUBSTANTIVE'
            );
            verdict = 'SUBSTANTIVE';
          }
          if (verdict === 'SUBSTANTIVE') {
            this.logger.info(
              '[PRPPipeline] PRD change is SUBSTANTIVE — initializing delta session'
            );
            await this.handleDelta();
          } else {
            this.logger.info(
              '[PRPPipeline] PRD change is COSMETIC — absorbing without delta session'
            );
            await this.sessionManager.absorbCosmeticChange();
          }
        }
      }
```

**`handleDelta()` JSDoc correction** (~845-849) — replace the misleading `CONTRACT INPUT` block:
```diff
- * CONTRACT INPUT (P4.M1.T1.S2): a SUBSTANTIVE verdict from
- * `classifyChangeWithRetry()` routes here. COSMETIC changes are skipped
- * upstream (no marker, no dispatch). Classification is NOT wired by this
- * item — it is upstream and a separate work item; the dispatcher treats the
- * verdict as an input seam.
+ * CONTRACT INPUT: `initializeSession()` classifies a detected PRD change via
+ * `classifyChangeWithRetry()` (PRD §4.3 step 1). A `SUBSTANTIVE` verdict routes
+ * here (delta session). A `COSMETIC` verdict is absorbed upstream via
+ * `SessionManager.absorbCosmeticChange()` — it does NOT route here and does NOT
+ * spawn a delta session. Any classifier failure (exhaustion or an unexpected
+ * throw) degrades to `SUBSTANTIVE`, so this method runs on every change that is
+ * not confidently COSMETIC.
```

**`tests/unit/workflows/prp-pipeline.test.ts`** — mock additions + new tests (see Implementation Tasks).

### Success Criteria
- [ ] `classifyChangeWithRetry` is imported from `'../core/change-classifier.js'` and called inside
      the `hasSessionChanged()` branch.
- [ ] SUBSTANTIVE verdict → `handleDelta()` called; `absorbCosmeticChange()` NOT called.
- [ ] COSMETIC verdict → `absorbCosmeticChange()` called; `handleDelta()` NOT called.
- [ ] Classifier throw/reject (mocked) → `handleDelta()` called (protective SUBSTANTIVE default).
- [ ] Empty `diffSummary.changes` → `absorbCosmeticChange()` called, `classifyChangeWithRetry` NOT called.
- [ ] `hasSessionChanged() === false` → block skipped (byte-equivalent to today).
- [ ] `handleDelta` JSDoc corrected (no "NOT wired by this item" falsehood).
- [ ] Existing "should call handleDelta when hasSessionChanged returns true" test (~2048) stays GREEN.
- [ ] `npm run typecheck && npm run lint && npm run format:check` clean; targeted test file GREEN.

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_ **Yes** — the
exact insertion site (the body of the `if (hasSessionChanged())` block at ~781-786), the verbatim
replacement block, the import line, the verbatim JSDoc diff, the S1 contract (the two SessionManager
methods S2 calls), the classifier signature + its already-correct protective default, the CRITICAL
existing-test breakage (`prp-pipeline.test.ts:2048`) with the exact mock-helper extension that keeps
it green, the pipeline-level try/catch rationale (the contract's reject→SUBSTANTIVE test), and the
executable validation commands. See `research/classifier-wiring.md` for the per-claim evidence.

### Documentation & References
```yaml
# MUST READ — the BUG-002 fix design (what S2 implements: Part A step 3 + 4)
- docfile: plan/008_15504f60a0ef/bugfix/002_86589b7d57d2/architecture/bug-002-classifiers.md
  section: "Fix design → Part A — change classifier wired into detection"
  why: Prescribes the exact wiring (getChangeDiffSummary → classifyChangeWithRetry → SUBSTANTIVE⇒handleDelta /
        COSMETIC⇒absorbCosmeticChange), the optional empty-diff pre-filter, and the JSDoc correction.
  critical: The fail-safe is SUBSTANTIVE — COSMETIC skipping is opt-in ONLY on a confident COSMETIC verdict.

# MUST READ — this subtask's research (the traps + exact edit map)
- docfile: plan/008_15504f60a0ef/bugfix/002_86589b7d57d2/P1M2T1S2/research/classifier-wiring.md
  section: "1. insertion site", "3. classifyChangeWithRetry signature", "4. misleading JSDoc",
           "5. pipeline-level try/catch REQUIRED", "6. CRITICAL existing test breakage", "7. new tests"
  why: The exact current code to replace; the classifier's own protective catch (so the pipeline try/catch
        is defense-in-depth for the contract's reject test); the prp-pipeline.test.ts:2048 breakage + the
        mock-helper extension that keeps it green; the 4 new test cases.

# CONTEXT — S1 (the seam S2 consumes) — read the CONTRACT, do NOT implement it
- file: plan/008_15504f60a0ef/bugfix/002_86589b7d57d2/P1M2T1S1/PRP.md
  why: S1 adds SessionManager.getChangeDiffSummary(): Promise<DiffSummary> + absorbCosmeticChange(): Promise<void>.
        S2 calls BOTH from initializeSession. S1 is file-disjoint (session-manager.ts); S2 MUST NOT touch it.

# THE FILE TO EDIT + the classifier to import
- file: src/workflows/prp-pipeline.ts
  why: EDIT initializeSession() (~781-786) — replace the if-body with the classify wiring; add the import;
        correct the handleDelta JSDoc (~845-849).
  pattern: "if (this.sessionManager.hasSessionChanged()) { this.logger.info('...delta session'); await this.handleDelta(); }"
  critical: Keep the outer `if (hasSessionChanged())` GUARD — only its body changes. initializeSession has its
        own outer try/catch (catch at ~791 → #trackFailure + session_failed); getChangeDiffSummary() stays
        OUTSIDE the protective try (its failure is an I/O error → propagate); only classifyChangeWithRetry
        is inside the protective try (its failure → SUBSTANTIVE default).

- file: src/core/change-classifier.ts
  why: READ-ONLY — provides `export async function classifyChangeWithRetry(diffSummary): Promise<'COSMETIC'|'SUBSTANTIVE'>`
        (line 206). Its own catch already returns SUBSTANTIVE on retry-exhaustion (225-232). Import the FUNCTION
        (value) into prp-pipeline.ts; do NOT edit this file.
  gotcha: classifyChangeWithRetry ALWAYS resolves in normal operation (it catches exhaustion). The contract's
        "throw/reject → SUBSTANTIVE" test mocks a REJECT at the pipeline seam → requires the pipeline-level
        try/catch (defense-in-depth) to still route to handleDelta.

- file: src/core/prd-differ.ts
  why: READ-ONLY — `DiffSummary` (112) has `changes: SectionChange[]` (114). The empty-diff pre-filter
        (`diffSummary.changes.length === 0`) is how a pure-whitespace edit (normalized away by diffPRDs)
        skips the LLM call.

# PATTERN FILE — the test file S2 edits + its mock helpers
- file: tests/unit/workflows/prp-pipeline.test.ts
  why: EDIT — (1) add vi.mock('../../../src/core/change-classifier.js') + mockClassifyChange handle; (2) extend
        createMockSessionManager (line 269) + the beforeEach default mock (line 313) with getChangeDiffSummary +
        absorbCosmeticChange; (3) add SUBSTANTIVE/COSMETIC/reject/empty-diff tests under describe('initializeSession').
  pattern: "vi.mock('../../../src/core/session-manager.js', () => ({ SessionManager: vi.fn() … }));  const MockSessionManagerClass = SessionManager as any;"
  critical: The existing 'should call handleDelta when hasSessionChanged returns true' test (line 2048) WILL BREAK
        without the mock additions (getChangeDiffSummary is undefined on the mock; classifyChangeWithRetry is the
        real fn → LLM). Fix = default mockClassifyChange to mockResolvedValue('SUBSTANTIVE') in beforeEach so 2048
        stays GREEN with zero edits to its body. The 'should NOT call handleDelta when hasSessionChanged returns
        false' test (2073) is UNAFFECTED (the whole block is skipped).

# CONSUMER-ADJACENT (read-only — do NOT edit in S2)
- file: src/core/session-manager.ts
  why: S1 adds getChangeDiffSummary + absorbCosmeticChange here. S2 calls them via the sessionManager instance.
        Do NOT edit (S1's file).
- file: src/workflows/prp-pipeline.ts (acceptPrdChangesResponse, ~907)
  why: Uses refreshSnapshotToCurrentPRD + clearPendingDeltaHash — a DIFFERENT refresh path. absorbCosmeticChange
        is the COSMETIC analogue. Refactoring acceptPrdChangesResponse to delegate to absorbCosmeticChange is a
        nice FOLLOW-UP but is NOT required by this contract — flag it, don't do it.
```

### Current Codebase tree (relevant slice)
```bash
src/workflows/prp-pipeline.ts                  # EDIT — initializeSession wiring + import + handleDelta JSDoc
src/core/change-classifier.ts                  # READ-ONLY (import classifyChangeWithRetry)
src/core/session-manager.ts                    # UNCHANGED (parallel S1 adds the two methods S2 calls)
src/core/prd-differ.ts                         # READ-ONLY (DiffSummary shape)
tests/unit/workflows/prp-pipeline.test.ts      # EDIT — +change-classifier mock, +mock-helper methods, +new tests
```

### Desired Codebase tree with files to be added/edited
```bash
src/workflows/prp-pipeline.ts                  # MODIFIED (import + initializeSession body + handleDelta JSDoc)
tests/unit/workflows/prp-pipeline.test.ts      # MODIFIED (mock additions + 3-4 new initializeSession tests)
```

### Known Gotchas of our codebase & Library Quirks
```ts
// CRITICAL — the existing test 'should call handleDelta when hasSessionChanged returns true' (prp-pipeline.test.ts:2048)
//   WILL BREAK after the wiring: hasSessionChanged()=true now calls getChangeDiffSummary() (undefined on the mock
//   → TypeError) and classifyChangeWithRetry() (the real fn → LLM). FIX = add the change-classifier vi.mock
//   (default mockResolvedValue('SUBSTANTIVE')) + extend createMockSessionManager + the beforeEach default mock with
//   getChangeDiffSummary + absorbCosmeticChange. With the SUBSTANTIVE default, test 2048 stays GREEN unedited.

// CRITICAL — the pipeline-level try/catch around classifyChangeWithRetry is REQUIRED by the contract's
//   "Mock classifyChangeWithRetry to throw/reject → SUBSTANTIVE fail-safe" test. classifyChangeWithRetry's OWN catch
//   handles retry-exhaustion (→ resolve SUBSTANTIVE), so it never rejects in normal operation; the pipeline try/catch
//   is defense-in-depth for an unexpected throw (module-load failure, non-transient error). Without it, a mocked
//   reject propagates to initializeSession's outer catch → session_failed → handleDelta NOT called → test fails.

// CRITICAL — getChangeDiffSummary() stays OUTSIDE the protective try/catch. Its failure (e.g. resolvePRD I/O error)
//   is a real error → propagate to initializeSession's outer catch (consistent with today's handleDelta resolvePRD
//   behavior). Only classifyChangeWithRetry is inside the protective try (its failure → SUBSTANTIVE default).

// CRITICAL — keep the outer `if (this.sessionManager.hasSessionChanged())` GUARD. Only its BODY changes. hasSessionChanged()
//   is the gate (pure hash compare); the classify wiring is the body. Do NOT remove the guard or restructure the block.

// GOTCHA — classifyChangeWithRetry is NOT currently imported in prp-pipeline.ts (the only reference is the misleading
//   JSDoc at :846). S2 adds: import { classifyChangeWithRetry } from '../core/change-classifier.js'; (value import).

// GOTCHA — the empty-diff pre-filter (diffSummary.changes.length === 0 → COSMETIC, skip LLM) is OPTIONAL but recommended
//   (saves an LLM call for pure-whitespace edits that diffPRDs already normalized away). If included, add a test asserting
//   classifyChangeWithRetry is NOT called when changes is empty. If you'd rather keep the wiring minimal, drop the pre-filter
//   and let the classifier handle empty diffs (it will — an empty DiffSummary classifies as COSMETIC).

// GOTCHA — bugfix BUG-004: the FULL `npm run test:run` is PRE-EXISTING-RED (178 failures — P1.M4 scope). Do NOT use it as
//   the gate. Gate = typecheck + lint + format:check + the TARGETED prp-pipeline.test.ts. The wiring + mock additions cannot
//   increase the red count; verify the existing initializeSession tests (2048/2073) + the new ones are green.

// GOTCHA — 100% coverage globally enforced (vitest.config.ts). The new branches (SUBSTANTIVE/COSMETIC/try-catch/empty-diff)
//   must each have a test or prp-pipeline.ts coverage drops. The try/catch's catch branch needs the reject-test; the COSMETIC
//   branch needs the COSMETIC-test; the empty-diff branch needs its own test (if the pre-filter is included).

// GOTCHA — prettier is ERROR-enforced (format:check). Run `npm run fix` before validate. The multi-line wiring block + JSDoc
//   diff may reflow — let `npm run fix` handle it.

// CRITICAL — DO NOT touch session-manager.ts (parallel S1), change-classifier.ts (read-only import), prd-differ.ts (read-only),
//   the artifact classifier classifyArtifactWithRetry / decomposePRD guard (P1.M2.T2.S1 — a SEPARATE subtask),
//   acceptPrdChangesResponse (optional follow-up — flag, don't do), or any docs/*.md (Mode A = the JSDoc correction only).
```

---

## Implementation Blueprint

### Data models and structure
No new data models. S2 consumes `DiffSummary` (prd-differ.ts:112), `ChangeClassification` (change-classifier.ts:63),
and S1's two SessionManager methods. The only "structure" is the wiring block (verbatim above), the import, the
JSDoc diff, and the test mock additions.

### Implementation Tasks (ordered by dependencies — implicit TDD: RED first, then GREEN)
```yaml
Task 1: EDIT tests/unit/workflows/prp-pipeline.test.ts  (RED — add the change-classifier mock + mock-helper methods + new tests FIRST)
  - ADD a vi.mock near the other top-of-file mocks (after the session-manager mock ~47):
        vi.mock('../../../src/core/change-classifier.js', () => ({
          classifyChangeWithRetry: vi.fn(),
        }));
    And (near the other `as any` handles): import { classifyChangeWithRetry } from '../../../src/core/change-classifier.js';
        const mockClassifyChange = classifyChangeWithRetry as unknown as ReturnType<typeof vi.fn>;
  - EXTEND createMockSessionManager (line 269) — add to the returned `mock` object:
        getChangeDiffSummary: vi.fn().mockResolvedValue({ changes: [{ type:'modified', sectionTitle:'X', lineNumber:1, impact:'low' }], summaryText:'changed', stats:{ totalAdded:1, totalModified:0, totalRemoved:0, sectionsAffected:['X'] } }),
        absorbCosmeticChange: vi.fn().mockResolvedValue(undefined),
    (Default NON-empty changes so the pre-filter doesn't short-circuit the SUBSTANTIVE/COSMETIVE classify path.)
  - EXTEND the beforeEach default MockSessionManagerClass.mockImplementation (line ~313) with the same two methods
    (some tests construct via the default mock — they'd otherwise hit `undefined`).
  - ADD in beforeEach: mockClassifyChange.mockResolvedValue('SUBSTANTIVE');  (default → keeps test 2048 green).
  - ADD under describe('initializeSession') (near line 2048):
      * it('routes a SUBSTANTIVE verdict to handleDelta (not absorbCosmeticChange)'): mockClassifyChange.mockResolvedValueOnce('SUBSTANTIVE');
        drive initializeSession with hasSessionChanged=true; assert handleDelta called, absorbCosmeticChange NOT called.
      * it('routes a COSMETIC verdict to absorbCosmeticChange (not handleDelta)'): mockClassifyChange.mockResolvedValueOnce('COSMETIC');
        assert absorbCosmeticChange called, handleDelta NOT called, currentPhase 'session_initialized'.
      * it('fails to SUBSTANTIVE when the classifier throws (protective default)'): mockClassifyChange.mockRejectedValueOnce(new Error('boom'));
        assert handleDelta called, absorbCosmeticChange NOT called (the pipeline try/catch defaults to SUBSTANTIVE).
      * (optional, if pre-filter included) it('absorbs as COSMETIC without an LLM call when the diff is empty'):
        mockManager.getChangeDiffSummary.mockResolvedValueOnce({ changes:[], summaryText:'', stats:{...} });
        assert absorbCosmeticChange called, mockClassifyChange NOT called.
  - EXPECTED NOW: the 3-4 new tests FAIL (no wiring yet) → RED. The existing 2048 test stays green (mockClassifyChange default SUBSTANTIVE
    + the new getChangeDiffSummary/absorbCosmeticChange on the mock). The existing 2073 test (hasSessionChanged=false) unaffected.

Task 2: EDIT src/workflows/prp-pipeline.ts  (GREEN — the import + the wiring)
  - ADD import: import { classifyChangeWithRetry } from '../core/change-classifier.js';  (near the other ../core/ imports ~73-74).
  - REPLACE the body of the `if (this.sessionManager.hasSessionChanged())` block (~781-786) with the verbatim wiring block
    from "Technical requirements" (getChangeDiffSummary → empty-diff pre-filter → try/catch classifyChangeWithRetry →
    SUBSTANTIVE⇒handleDelta / COSMETIC⇒absorbCosmeticChange). Keep the outer `if (hasSessionChanged())` guard.
  - DO NOT: remove the hasSessionChanged guard; move getChangeDiffSummary inside the protective try; touch handleDelta's body,
    acceptPrdChangesResponse, spawnDeltaSession, or decomposePRD; edit session-manager.ts/change-classifier.ts.
  - EXPECTED: Task 1's new tests turn GREEN; existing 2048/2073 stay GREEN.

Task 3: EDIT src/workflows/prp-pipeline.ts  (JSDoc — Mode A)
  - Replace the misleading CONTRACT INPUT block on handleDelta() (~845-849) with the verbatim diff in "Technical requirements"
    (documents: initializeSession classifies; SUBSTANTIVE routes here; COSMETIC absorbed upstream via absorbCosmeticChange;
    any failure → SUBSTANTIVE). Remove the "Classification is NOT wired by this item" falsehood.
  - DO NOT change handleDelta's signature, @param, the rest of its JSDoc, or its body.
  - EXPECTED: no behavior change; typecheck/format pass.

Task 4: FORMAT + VERIFY
  - RUN: npm run fix → npm run typecheck → npm run lint → npm run format:check.
  - RUN: npx vitest run tests/unit/workflows/prp-pipeline.test.ts   # existing + new initializeSession tests → GREEN.
  - RUN: npx vitest run tests/unit/core/change-classifier.test.ts tests/unit/core/change-classifier-resilient.test.ts  # classifier unchanged → green.
  - DO NOT run the full `npm run test:run` (pre-existing red — bugfix BUG-004, P1.M4 scope).
  - EXPECTED: typecheck/lint/format clean; prp-pipeline.test.ts green (incl. 2048/2073 + the 3-4 new tests); classifier tests green.
    If 2048 fails → mockClassifyChange default isn't SUBSTANTIVE (check beforeEach). If a new test fails → the wiring branch
    wasn't hit (check the verdict mock + the mock-helper methods). If coverage drops on prp-pipeline.ts → a branch (COSMETIC/
    try-catch/empty-diff) lacks a test.
```

### Implementation Patterns & Key Details
```ts
// ---- src/workflows/prp-pipeline.ts: the import (near ../core/ imports ~73-74) ----
import { classifyChangeWithRetry } from '../core/change-classifier.js';

// ---- initializeSession: the wiring (replaces the if-body at ~781-786) ----
if (this.sessionManager.hasSessionChanged()) {
  const diffSummary = await this.sessionManager.getChangeDiffSummary();
  if (diffSummary.changes.length === 0) {
    this.logger.info('[PRPPipeline] PRD diff is empty after normalization — absorbing as COSMETIC');
    await this.sessionManager.absorbCosmeticChange();
  } else {
    let verdict: 'COSMETIC' | 'SUBSTANTIVE';
    try {
      verdict = await classifyChangeWithRetry(diffSummary);
    } catch (error) {
      this.logger.warn({ error }, '[PRPPipeline] Change classifier threw; failing to protective default SUBSTANTIVE');
      verdict = 'SUBSTANTIVE';
    }
    if (verdict === 'SUBSTANTIVE') {
      this.logger.info('[PRPPipeline] PRD change is SUBSTANTIVE — initializing delta session');
      await this.handleDelta();
    } else {
      this.logger.info('[PRPPipeline] PRD change is COSMETIC — absorbing without delta session');
      await this.sessionManager.absorbCosmeticChange();
    }
  }
}

// ---- tests/unit/workflows/prp-pipeline.test.ts: the mock + helper extension ----
vi.mock('../../../src/core/change-classifier.js', () => ({
  classifyChangeWithRetry: vi.fn(),
}));
import { classifyChangeWithRetry } from '../../../src/core/change-classifier.js';
const mockClassifyChange = classifyChangeWithRetry as unknown as ReturnType<typeof vi.fn>;
// in createMockSessionManager (line 269), add to the returned mock:
//   getChangeDiffSummary: vi.fn().mockResolvedValue({ changes:[{type:'modified',sectionTitle:'X',lineNumber:1,impact:'low'}], summaryText:'changed', stats:{totalAdded:1,totalModified:0,totalRemoved:0,sectionsAffected:['X']} }),
//   absorbCosmeticChange: vi.fn().mockResolvedValue(undefined),
// in beforeEach: mockClassifyChange.mockResolvedValue('SUBSTANTIVE');

// ---- the COSMETIC test (the headline new assertion) ----
it('routes a COSMETIC verdict to absorbCosmeticChange (not handleDelta)', async () => {
  mockClassifyChange.mockResolvedValueOnce('COSMETIC');
  const mockManager = createMockSessionManager(createTestSession(createTestBacklog([])), true);
  const pipeline = new PRPPipeline('./test.md');
  (pipeline as any).sessionManager = mockManager;
  const handleDeltaSpy = vi.spyOn(pipeline, 'handleDelta').mockResolvedValue(undefined);
  await pipeline.initializeSession();
  expect(mockClassifyChange).toHaveBeenCalled();
  expect(mockManager.absorbCosmeticChange).toHaveBeenCalled();
  expect(handleDeltaSpy).not.toHaveBeenCalled();
  expect(pipeline.currentPhase).toBe('session_initialized');
  handleDeltaSpy.mockRestore();
});
```

### Integration Points
```yaml
PRP-PIPELINE.TS (src/workflows/prp-pipeline.ts):
  - +import { classifyChangeWithRetry } from '../core/change-classifier.js'
  - initializeSession (~781): replace the if(hasSessionChanged()) BODY with the classify→route wiring (guard stays).
  - handleDelta JSDoc (~845-849): correct the misleading CONTRACT INPUT block (Mode A).
  - PRESERVE: the hasSessionChanged guard; handleDelta/acceptPrdChangesResponse/spawnDeltaSession/decomposePRD bodies;
    initializeSession's outer try/catch.

SESSION-MANAGER.TS (src/core/session-manager.ts): UNCHANGED — S1 adds the two methods S2 calls (file-disjoint).

CHANGE-CLASSIFIER.TS (src/core/change-classifier.ts): READ-ONLY — S2 imports classifyChangeWithRetry (value).

TEST (tests/unit/workflows/prp-pipeline.test.ts):
  - +vi.mock(change-classifier.js) + mockClassifyChange handle (default SUBSTANTIVE in beforeEach).
  - +getChangeDiffSummary + absorbCosmeticChange on createMockSessionManager AND the beforeEach default mock.
  - +3-4 new initializeSession tests (SUBSTANTIVE/COSMETIC/reject→SUBSTANTIVE/empty-diff). PRESERVE 2048/2073.

DOCS (Mode A — the JSDoc correction rides with the work):
  - The handleDelta CONTRACT INPUT JSDoc edit is the ONLY doc artifact. NO docs/*.md.

DOWNSTREAM / OUT OF SCOPE:
  - P1.M2.T2.S1 wires classifyArtifactWithRetry (CLEAN/DIRTY) around delta_prd.md in decomposePRD — a SEPARATE subtask; do NOT do it here.
  - acceptPrdChangesResponse delegating to absorbCosmeticChange is a nice follow-up — flag it, don't do it.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
npm run fix            # lint:fix + prettier --write (run first — the wiring block + JSDoc may reflow)
npm run typecheck      # tsc --noEmit -p tsconfig.build.json — clean
npm run lint           # eslint . --ext .ts — clean
npm run format:check   # prettier --check — clean
# Expected: all clean. Likely failure: a type error if the verdict union or the import path is wrong.
```

### Level 2: Unit Tests (Component Validation)
```bash
# The directly-affected suite — MUST be GREEN (existing 2048/2073 + 3-4 new initializeSession tests):
npx vitest run tests/unit/workflows/prp-pipeline.test.ts
# The classifier is UNCHANGED — its own suites must stay green (proves S2 only imported it):
npx vitest run tests/unit/core/change-classifier.test.ts tests/unit/core/change-classifier-resilient.test.ts
# Expected: all green. If 2048 fails → mockClassifyChange default isn't SUBSTANTIVE (check beforeEach). If a new test fails
#   → the wiring branch wasn't hit (check the verdict mock + getChangeDiffSummary/absorbCosmeticChange on the mock helper).
# Do NOT run the full `npm run test:run` — pre-existing red (bugfix BUG-004, P1.M4 scope).
```

### Level 3: Integration / Regression (System Validation)
```bash
# Confirm the wiring + import + JSDoc correction landed:
grep -n "classifyChangeWithRetry" src/workflows/prp-pipeline.ts   # Expect: 1 import + 1 call (+ the corrected JSDoc ref) ≥3 hits.
grep -n "NOT wired by this item" src/workflows/prp-pipeline.ts    # Expect: ZERO hits (the falsehood is removed).
grep -n "absorbCosmeticChange" src/workflows/prp-pipeline.ts      # Expect: ≥2 hits (the COSMETIC branch + the empty-diff branch).
# Build emits dist/ cleanly (proves the import + wiring compile):
npx tsc -p tsconfig.build.json
# Sibling regression — session-manager (S1's file) tests stay green (S2 doesn't touch it):
npx vitest run tests/unit/core/session-manager.test.ts
# Expected: grep confirms the wiring; build clean; session-manager.test.ts green (S2 is file-disjoint from S1).
```

### Level 4: Creative & Domain-Specific Validation
```bash
# No MCP/DB/HTTP (the classifier is mocked in tests). Domain checks (record in commit message):
#   1. SUBSTANTIVE ⇒ handleDelta (delta session) — unchanged behavior for real changes.
#   2. COSMETIC ⇒ absorbCosmeticChange (baseline refreshed, NO delta session) — the new cost-saving path.
#   3. Classifier throw ⇒ SUBSTANTIVE (protective default) — never silently skip a delta session (PRD §4.3).
#   4. Empty diff (pure whitespace, normalized away) ⇒ COSMETIC without an LLM call (cheap pre-filter).
#   5. hasSessionChanged()=false ⇒ block skipped (byte-equivalent to today).
#   6. The misleading JSDoc is corrected (the comment now matches the code).
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` clean.
- [ ] `npm run lint` clean.
- [ ] `npm run format:check` clean.
- [ ] `npx vitest run tests/unit/workflows/prp-pipeline.test.ts` GREEN (existing 2048/2073 + new tests).
- [ ] `npx vitest run tests/unit/core/change-classifier.test.ts tests/unit/core/change-classifier-resilient.test.ts` GREEN.
- [ ] `npx vitest run tests/unit/core/session-manager.test.ts` GREEN (S1 regression — S2 is file-disjoint).

### Feature Validation
- [ ] `classifyChangeWithRetry` imported + called inside the `hasSessionChanged()` branch.
- [ ] SUBSTANTIVE → `handleDelta()`; COSMETIC → `absorbCosmeticChange()`.
- [ ] Classifier throw/reject → SUBSTANTIVE → `handleDelta()` (protective default).
- [ ] Empty `diffSummary.changes` → `absorbCosmeticChange()` without calling the classifier (pre-filter).
- [ ] `hasSessionChanged() === false` → block skipped.
- [ ] `handleDelta` JSDoc corrected (no "NOT wired by this item" falsehood).

### Code Quality Validation
- [ ] The outer `if (hasSessionChanged())` guard preserved; only its body changed.
- [ ] `getChangeDiffSummary()` outside the protective try; `classifyChangeWithRetry()` inside it.
- [ ] Only `src/workflows/prp-pipeline.ts` + `tests/unit/workflows/prp-pipeline.test.ts` modified.
- [ ] `session-manager.ts`, `change-classifier.ts`, `prd-differ.ts`, `decomposePRD`, `acceptPrdChangesResponse` UNTOUCHED.

### Documentation & Deployment
- [ ] The handleDelta JSDoc CONTRACT INPUT correction is the only doc artifact (Mode A).
- [ ] No `docs/*.md`, README, or `.env.example` changes.
- [ ] Commit message notes: the classifier wiring (SUBSTANTIVE/COSMETIC routing), the pipeline-level protective try/catch
      (defense-in-depth for the contract's reject test), the empty-diff pre-filter, the existing-test-2048 breakage + the
      mock-helper fix, the JSDoc correction, and the S1 seam cross-reference.

---

## Anti-Patterns to Avoid

- ❌ Don't remove the outer `if (this.sessionManager.hasSessionChanged())` guard — it's the gate (pure hash compare).
      Only its BODY changes (the classify→route wiring). Removing the guard would classify on every initialize.
- ❌ Don't omit the pipeline-level try/catch around `classifyChangeWithRetry`. The contract explicitly tests a reject →
      SUBSTANTIVE fail-safe. `classifyChangeWithRetry`'s own catch handles retry-exhaustion, but a mocked reject at the
      pipeline seam propagates without the try/catch → session_failed → handleDelta NOT called → the fail-safe test fails.
- ❌ Don't put `getChangeDiffSummary()` inside the protective try. Its failure is an I/O error (resolvePRD) → propagate to
      initializeSession's outer catch (consistent with today's handleDelta resolvePRD behavior). Only the CLASSIFIER is
      inside the protective try (its failure → SUBSTANTIVE default).
- ❌ Don't break the existing `prp-pipeline.test.ts:2048` test. The wiring makes `hasSessionChanged()=true` call
      `getChangeDiffSummary` (undefined on the mock) + `classifyChangeWithRetry` (real fn → LLM). FIX = add the
      change-classifier vi.mock (default SUBSTANTIVE) + extend createMockSessionManager + the beforeEach default mock.
      With the SUBSTANTIVE default, 2048 stays green unedited.
- ❌ Don't edit `session-manager.ts` (parallel S1 owns the two methods S2 calls), `change-classifier.ts` (read-only —
      import only), or `prd-differ.ts` (read-only — DiffSummary). S2 = prp-pipeline.ts + its test only.
- ❌ Don't wire the artifact classifier (`classifyArtifactWithRetry` / CLEAN-DIRTY around delta_prd.md) — that's
      P1.M2.T2.S1, a SEPARATE subtask. S2 is ONLY the change classifier (COSMETIC/SUBSTANTIVE).
- ❌ Don't refactor `acceptPrdChangesResponse` to delegate to `absorbCosmeticChange` — it's a nice follow-up but NOT
      required by this contract (and risks scope creep). Flag it in the commit message; don't do it.
- ❌ Don't run the full `npm run test:run` as the gate — it's pre-existing red (bugfix BUG-004, 178 failures, P1.M4 scope).
      Gate = typecheck + lint + format:check + the targeted prp-pipeline.test.ts + the classifier suites.
- ❌ Don't leave the misleading JSDoc. The whole point of "correct the misleading JSDoc" is that the comment currently
      CLAIMS classification is wired upstream when it's dead code. After S2 it IS wired — rewrite the comment to match.
- ❌ Don't add the empty-diff pre-filter WITHOUT a test, or coverage on prp-pipeline.ts drops. Each new branch (SUBSTANTIVE/
      COSMETIC/try-catch/empty-diff) needs a test. (If you'd rather keep it minimal, drop the pre-filter entirely — the
      classifier handles empty diffs as COSMETIC — and drop its test.)
- ❌ Don't edit any `docs/*.md` — DOCS is Mode A (the handleDelta JSDoc correction only).

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: This is a focused wiring task with every dependency already in place: the classifier
(`classifyChangeWithRetry`, change-classifier.ts:206) is fully implemented with its protective default; S1
(parallel) provides the exact SessionManager seam (`getChangeDiffSummary` + `absorbCosmeticChange`) S2 calls; and
the insertion site (the body of the `if (hasSessionChanged())` block at prp-pipeline.ts:781-786) is a 4-line block
whose replacement is specified verbatim. The ONE non-obvious risk — the existing `prp-pipeline.test.ts:2048` test
breaking because the mock SessionManager lacks the two new methods and the classifier is unmocked — is fully
documented with the exact mock-helper extension + the SUBSTANTIVE default that keeps 2048 green unedited. The second
non-obvious point — the contract's "throw/reject → SUBSTANTIVE fail-safe" test requiring a pipeline-level try/catch
(the classifier's own catch handles exhaustion, so a mocked reject only routes to handleDelta if the pipeline wraps
the call) — is reconciled and specified verbatim. The work is file-disjoint from S1 (session-manager.ts) and from
P1.M2.T2.S1 (the artifact classifier). The one caveat — the full suite is pre-existing red (bugfix BUG-004) — is
handled by gating on the targeted prp-pipeline.test.ts + the classifier suites. Residual risks: (a) a missing mock
on the `beforeEach` default SessionManager mock (enumerated in Task 1); (b) a coverage drop if a branch lacks a test
(each branch has a specified test); (c) a prettier reflow (auto-fixed via `npm run fix`). No runtime/network/LLM
unknowns — the classifier is mocked in tests.