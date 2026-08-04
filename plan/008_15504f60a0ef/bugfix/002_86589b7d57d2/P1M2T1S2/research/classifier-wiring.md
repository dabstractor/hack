# Research: Wire classifyChangeWithRetry into initializeSession (P1.M2.T1.S2)

Bugfix 002, **BUG-002 Part A** — the wiring slice. Verified against current source
on 2026-08-04. All line numbers from the live tree.

## 1. The exact insertion site + current code

`prp-pipeline.ts` `initializeSession()` — the detection block at **lines 781-786**:
```ts
if (this.sessionManager.hasSessionChanged()) {
  this.logger.info('[PRPPipeline] PRD has changed, initializing delta session');
  await this.handleDelta();
}
```
This sits inside initializeSession's outer try/catch (the catch at 791 does
`#trackFailure` + `currentPhase='session_failed'`). `hasSessionChanged()`
(session-manager.ts:1688) is a PURE HASH compare (`#prdHash !== metadata.hash`) —
so today EVERY edit triggers a full delta session. **S2 replaces the body of this
`if` with the classify→route wiring.** The `if (hasSessionChanged())` guard itself
stays (it's the gate).

## 2. What S1 (parallel) provides — the CONTRACT to consume

P1.M2.T1.S1 adds to `src/core/session-manager.ts` (treat as landed):
- `async getChangeDiffSummary(): Promise<DiffSummary>` →
  `diffPRDs(currentSession.prdSnapshot, await resolvePRD(prdPath))`; throws if no session.
- `async absorbCosmeticChange(): Promise<void>` → resolve ONCE → `snapshotPRD` →
  re-baseline `metadata.hash` + `#prdHash` + `prdSnapshot` so `hasSessionChanged()` flips false.

S2 calls BOTH from initializeSession. S2 does NOT touch session-manager.ts (S1's file).

## 3. classifyChangeWithRetry — signature + protective default (read-only, import it)

`src/core/change-classifier.ts:206`:
```ts
export async function classifyChangeWithRetry(diffSummary: DiffSummary): Promise<ChangeClassification>
```
(`ChangeClassification = 'COSMETIC' | 'SUBSTANTIVE'`, line 63.) It wraps `retry()` and
**catches exhaustion → returns `'SUBSTANTIVE'`** (the PRD §4.3 protective default, lines
225-232). So under normal operation it ALWAYS resolves (never rejects). It is **NOT
currently imported** in prp-pipeline.ts (the only reference is the misleading JSDoc at
:846). S2 adds: `import { classifyChangeWithRetry } from '../core/change-classifier.js';`.

`DiffSummary` (prd-differ.ts:112) has `changes: SectionChange[]` (line 114) — so the
optional cheap pre-filter `diffSummary.changes.length === 0 → COSMETIC` is viable
(`diffPRDs` already normalizes whitespace away, so a pure-whitespace edit yields 0 changes).

## 4. The misleading JSDoc to correct (handleDelta, lines 845-849)

Current text (verbatim):
```
 * CONTRACT INPUT (P4.M1.T1.S2): a SUBSTANTIVE verdict from
 * `classifyChangeWithRetry()` routes here. COSMETIC changes are skipped
 * upstream (no marker, no dispatch). Classification is NOT wired by this
 * item — it is upstream and a separate work item; the dispatcher treats the
 * verdict as an input seam.
```
This is FALSE today (classification is dead code — never wired). After S2 it BECOMES
true (initializeSession wires it). So S2 rewrites this block to describe the now-real
contract: `initializeSession` classifies via `classifyChangeWithRetry`; SUBSTANTIVE
routes here; COSMETIC is absorbed upstream via `absorbCosmeticChange` (no handleDelta,
no delta session). **Remove the "Classification is NOT wired by this item" falsehood.**

## 5. The pipeline-level try/catch — REQUIRED by the contract's fail-safe test

The contract (item 5): "Mock classifyChangeWithRetry to throw/reject to assert
SUBSTANTIVE fail-safe." `classifyChangeWithRetry`'s OWN catch handles retry-exhaustion
(→ resolve SUBSTANTIVE), so under normal operation it never rejects. But the contract
explicitly tests a REJECT at the pipeline seam → to make `handleDelta` still run on a
reject, the pipeline MUST wrap the classify call in a try/catch defaulting to SUBSTANTIVE
(defense-in-depth: an unexpected throw around the classifier — e.g. module-load failure,
a non-transient error — still routes to the delta session, never silently skips it).
The architecture doc's pseudocode shows `// protective default SUBSTANTIVE` as a comment
on the call; the try/catch realizes that comment at the pipeline layer. **This is the
"unavailable classifier → SUBSTANTIVE" branch (item 4).** `getChangeDiffSummary()` stays
OUTSIDE the protective try (its failure is an I/O error → propagate to initializeSession's
outer catch, consistent with today's handleDelta resolvePRD behavior); only
`classifyChangeWithRetry` is inside it.

## 6. CRITICAL — existing test breakage (prp-pipeline.test.ts:2048)

`tests/unit/workflows/prp-pipeline.test.ts` has (line 2048):
```ts
it('should call handleDelta when hasSessionChanged returns true', async () => {
  const mockManager = createMockSessionManager(mockSession, true); // hasSessionChanged = true
  const handleDeltaSpy = vi.spyOn(pipeline, 'handleDelta').mockResolvedValue(undefined);
  await pipeline.initializeSession();
  expect(handleDeltaSpy).toHaveBeenCalled();
});
```
After S2's wiring, `hasSessionChanged()=true` → `getChangeDiffSummary()` →
`classifyChangeWithRetry(...)`. The mock SessionManager (`createMockSessionManager`,
line 269) does NOT define `getChangeDiffSummary`/`absorbCosmeticChange`, and
`classifyChangeWithRetry` is NOT mocked → the test would throw
`TypeError: getChangeDiffSummary is not a function` (and/or hit the real classifier).

**FIX (S2 must do this — it's part of the wiring's blast radius):**
1. Add at the top of `prp-pipeline.test.ts` (near the other `vi.mock` blocks):
   ```ts
   vi.mock('../../../src/core/change-classifier.js', () => ({
     classifyChangeWithRetry: vi.fn(),
   }));
   ```
   + a `const mockClassifyChange = classifyChangeWithRetry as unknown as ReturnType<typeof vi.fn>;`
   handle (mirror the existing `MockSessionManagerClass` pattern). Default it to
   `mockResolvedValue('SUBSTANTIVE')` in `beforeEach` so the existing 2048 test stays GREEN
   (SUBSTANTIVE → handleDelta) with ZERO edits to that test's body.
2. Extend `createMockSessionManager` (line 269) with:
   ```ts
   getChangeDiffSummary: vi.fn().mockResolvedValue({ changes: [{ /* SectionChange fixture */ }], summaryText: 'changed', stats: { totalAdded:1, totalModified:0, totalRemoved:0, sectionsAffected: ['X'] } }),
   absorbCosmeticChange: vi.fn().mockResolvedValue(undefined),
   ```
   (Default non-empty changes so the pre-filter doesn't short-circuit the SUBSTANTIVE path.)
3. Also extend the `beforeEach` default `MockSessionManagerClass.mockImplementation` (line 313)
   with the same two methods (some tests construct via the default mock).

The "should NOT call handleDelta when hasSessionChanged returns false" test (line 2073) is
UNAFFECTED (hasSessionChanged=false → the whole block is skipped).

## 7. New tests (implicit TDD for S2's behavior)

Under `describe('initializeSession')` (where the 2048/2073 tests live), add:
- **SUBSTANTIVE**: `mockClassifyChange.mockResolvedValueOnce('SUBSTANTIVE')` → handleDelta
  called, absorbCosmeticChange NOT called. (The existing 2048 test covers the default path;
  this makes the verdict explicit.)
- **COSMETIC**: `mockClassifyChange.mockResolvedValueOnce('COSMETIC')` → handleDelta NOT
  called, absorbCosmeticChange called, currentPhase 'session_initialized'.
- **classifier rejects → SUBSTANTIVE fail-safe**: `mockClassifyChange.mockRejectedValueOnce(new Error('boom'))`
  → handleDelta called (the pipeline try/catch defaults to SUBSTANTIVE), absorbCosmeticChange NOT called.
- **(optional) empty-diff pre-filter**: `mockManager.getChangeDiffSummary.mockResolvedValueOnce({changes:[],...})`
  → absorbCosmeticChange called, classifyChangeWithRetry NOT called (the cheap pre-filter skips the LLM).

## 8. Disjointness + scope

- S2 edits ONLY `src/workflows/prp-pipeline.ts` (initializeSession wiring + handleDelta JSDoc
  + the change-classifier import) + `tests/unit/workflows/prp-pipeline.test.ts` (mock additions
  + new tests + the 2048 test stays green via the SUBSTANTIVE default).
- S2 does NOT touch: `session-manager.ts` (parallel S1), `change-classifier.ts` (read-only —
  import only), `prd-differ.ts` (read-only — DiffSummary), the `decomposePRD` artifact guard
  (that's P1.M2.T2.S1 — the CLEAN/DIRTY classifier, a SEPARATE subtask), `acceptPrdChangesResponse`
  (could delegate to absorbCosmeticChange but that's a follow-up, not required here), any `docs/*.md`
  (Mode A = JSDoc correction only).
- The artifact classifier (CLEAN/DIRTY around delta_prd.md) is P1.M2.T2 — NOT this subtask.