# BUG-002 — Wire COSMETIC/SUBSTANTIVE + CLEAN/DIRTY classifiers

**Severity:** Major · **Status:** confirmed dead code against HEAD `727db29`

## Root cause (verified)
`src/core/change-classifier.ts` fully implements both classifiers with correct protective
defaults, but **nothing in production calls them**:
- `classifyChangeWithRetry(diffSummary): Promise<'COSMETIC'|'SUBSTANTIVE'>` (line 206) —
  protective default **SUBSTANTIVE**.
- `classifyArtifactWithRetry(content): Promise<'CLEAN'|'DIRTY'>` (line 257) —
  protective default **DIRTY**.

Reference census (whole `src/`): the only non-definition references are a **misleading JSDoc**
at `prp-pipeline.ts:845-849` (claims "a SUBSTANTIVE verdict from classifyChangeWithRetry()
routes here. COSMETIC changes are skipped upstream" — false) and a constants comment. The
module is imported only by `agents/prompts/change-classifier-prompt.ts` (type-only, circular).

Actual detection (`prp-pipeline.ts:781`, inside `initializeSession`):
```
if (this.sessionManager.hasSessionChanged()) {   // session-manager.ts:1688 — PURE HASH compare
  await this.handleDelta();
}
```
`hasSessionChanged()` is `#prdHash !== currentSession.metadata.hash` — a pure byte hash. So
**every** PRD change, even whitespace-only, triggers a full delta session (DeltaAnalysisWorkflow
+ architect + patching), wasting LLM tokens — violating PRD §4.3 step 1.

## LLM plumbing (already implemented — just unwired)
- Client: `createQAAgent()` → Groundswell `Agent` (`qa` persona, balanced tier, `xhigh`).
- Method: bare `agent.prompt(prompt)` (S1 inner); S2 `*WithRetry` wraps `retry()` +
  protective default. `CLASSIFIER_RETRY_MAX` (default 4) controls budget
  (`src/config/constants.ts:513`).
- The prompt carries `responseFormat: <ZodSchema>` so Groundswell validates the single emitted
  token against the enum.
- Requires PiHarness initialized. If not, it throws transient → exhausts → protective default.
  This is the intended fail-safe.

## Where the DiffSummary comes from (reuse existing logic)
`SessionManager.createDeltaSession` (`session-manager.ts:791`) ALREADY computes it:
```
const oldPRD = this.#currentSession.prdSnapshot;     // line 811 — the snapshot (resolved)
const newPRD = await resolvePRD(newPRDPath);          // current PRD (resolved)
const diffResult = diffPRDs(oldPRD, newPRD);          // src/core/prd-differ.ts
```
`diffPRDs(oldPRD, newPRD): DiffSummary` (`src/core/prd-differ.ts`) is the exact type
`classifyChangeWithRetry(diffSummary: DiffSummary)` consumes. (`DeltaSession.diffSummary` only
stores `summaryText`; the classifier needs the full `DiffSummary` object, so expose the object.)

## Fix design

### Part A — change classifier wired into detection (COSMETIC skip)
1. Add a `SessionManager` method to expose the change diff against the live PRD, reusing the
   createDeltaSession diff:
   `getChangeDiffSummary(): Promise<DiffSummary>` →
   `diffPRDs(this.#currentSession.prdSnapshot, await resolvePRD(this.prdPath))`.
   (`prdSnapshot`, `prdPath`, `resolvePRD` are all in SessionManager's scope; the field is
   private so a method is the clean seam.)
2. Add `SessionManager.absorbCosmeticChange(): Promise<void>` — refresh the baseline WITHOUT a
   delta session: rewrite `prd_snapshot.md` to the current resolved PRD, update
   `metadata.hash` + `#prdHash` to the current PRD hash (so `hasSessionChanged()` next run is
   false). Reuse `snapshotPRD` (already imported `session-manager.ts:41`) + the hash path. This
   mirrors `acceptPrdChangesResponse`'s refresh — consider extracting shared logic.
3. In `initializeSession` (`prp-pipeline.ts:~781`):
   ```
   if (this.sessionManager.hasSessionChanged()) {
     const diffSummary = await this.sessionManager.getChangeDiffSummary();
     const verdict = await classifyChangeWithRetry(diffSummary);   // protective default SUBSTANTIVE
     if (verdict === 'SUBSTANTIVE') {
       await this.handleDelta();
     } else {  // COSMETIC
       this.logger.info('[PRPPipeline] PRD change is COSMETIC — absorbing without delta session');
       await this.sessionManager.absorbCosmeticChange();
     }
   }
   ```
   Optional cheap pre-filter: if `diffSummary.changes.length === 0` (pure whitespace, already
   normalized away by `normalizeMarkdown`) skip the LLM call and treat as COSMETIC directly.
4. **Correct the misleading JSDoc** at `prp-pipeline.ts:845-849` to describe the now-real
   contract (SUBSTANTIVE routes here; COSMETIC is absorbed upstream). [Mode A docs]

### Part B — artifact classifier around delta_prd.md
`decomposePRD` (`prp-pipeline.ts:1295`) loads `prdContent = await loadDeltaPRD(sessionPath)`
then feeds it straight to the architect. Wire the guard before consumption:
```
const artifactVerdict = await classifyArtifactWithRetry(prdContent); // protective default DIRTY
if (artifactVerdict === 'DIRTY') {
  // PRD §4.3 protective action for a malformed delta_prd.md.
  // Fail-safe: do NOT feed malformed content to the architect unprotected.
  // (Read PRD §4.3 to confirm the exact action; default = log warn + abort breakdown
  //  so the next run regenerates delta_prd.md via the delta spawn path.)
  throw new Error('delta_prd.md classified DIRTY/malformed — refusing to feed architect; re-run to regenerate');
}
// CLEAN → proceed to architect
```
**Action-on-DIRTY is the one genuinely ambiguous point** — the bug report requires "protection"
but does not quote §4.3's exact wording. The implementing agent MUST read PRD §4.3 to confirm.
The fail-safe default (abort + regenerate-next-run) preserves the "never consume unprotected"
contract. If §4.3 instead specifies warn-and-proceed, implement that. **Flag as a decision
point in the commit message either way.** Note: because the protective default on classifier
exhaustion is DIRTY, abort-on-DIRTY means classifier-down → delta breakdown aborts → next run
retries; verify this does not create an infinite loop (the delta spawn path regenerates
delta_prd.md each run, so re-classification gets fresh input — acceptable).

## Test plan (TDD)
- Unit: detection path — mock `getChangeDiffSummary` + `classifyChangeWithRetry` → COSMETIC
  triggers `absorbCosmeticChange` and does NOT call `handleDelta`; SUBSTANTIVE calls
  `handleDelta`. Cover exhaustion → SUBSTANTIVE (fail-safe).
- Unit: artifact guard — CLEAN proceeds to architect; DIRTY throws before architect.
- Integration: a whitespace-only PRD edit (that diffPRDs normalizes to zero changes) does not
  spawn a delta session.
- Existing change-classifier unit tests (`tests/unit/core/change-classifier*.test.ts`) stay
  valid (they test the wrappers in isolation).

## Files
- `src/core/session-manager.ts` — `getChangeDiffSummary()`, `absorbCosmeticChange()` (reuse `snapshotPRD`/`resolvePRD`/`hashPRDContent`).
- `src/workflows/prp-pipeline.ts` — detection wiring (`initializeSession`), artifact guard (`decomposePRD`), JSDoc correction.
- `src/core/change-classifier.ts` — read-only (already correct); import its two `*WithRetry` exports into `prp-pipeline.ts`.
- `src/core/prd-differ.ts` — read-only (provides `DiffSummary`).
- (Read-only context) `src/agents/prompts/change-classifier-prompt.ts`, `src/config/constants.ts:513`.