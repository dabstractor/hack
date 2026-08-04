# PRP — P1.M2.T1.S1: Add `SessionManager.getChangeDiffSummary()` + `absorbCosmeticChange()`

> Bugfix 002, **BUG-002 (MAJOR)** Part A — the SessionManager seam. The two LLM change
> classifiers (`classifyChangeWithRetry` / `classifyArtifactWithRetry`) are fully implemented
> but never wired in. S1 adds the two SessionManager methods that S2 (P1.M2.T1.S2) will call
> from `initializeSession`: `getChangeDiffSummary()` exposes the resolved-vs-resolved
> `DiffSummary` the classifier consumes; `absorbCosmeticChange()` refreshes the baseline
> (rewrites `prd_snapshot.md` + re-baselines the hashes) so a COSMETIC change is absorbed
> WITHOUT spawning a delta session. All building blocks (`resolvePRD`/`hashPRDContent`/
> `snapshotPRD`/`diffPRDs`) are already imported + used in this file. S1 edits ONLY
> `session-manager.ts` + its unit test; it does NOT touch `prp-pipeline.ts` (S2's file).

---

## Goal

**Feature Goal**: Add two `public async` methods to `src/core/session-manager.ts` that become
the seam for BUG-002 Part A (COSMETIC-change skipping):
1. `getChangeDiffSummary(): Promise<DiffSummary>` — `diffPRDs(this.#currentSession.prdSnapshot, await resolvePRD(this.prdPath))`; throws if no current session (mirrors `hasSessionChanged`'s guard).
2. `absorbCosmeticChange(): Promise<void>` — resolve ONCE → `snapshotPRD(sessionPath, this.prdPath, resolved)` → re-baseline `metadata.hash` + `#prdHash` + `prdSnapshot` to the resolved PRD so the next `hasSessionChanged()` is false.

**Deliverable**:
1. **`src/core/session-manager.ts`** — EDIT: add the two public methods (near `createDeltaSession` / `hasSessionChanged`), + a type-only `DiffSummary` import from `./prd-differ.js` for the signature.
2. **`tests/unit/core/session-manager.test.ts`** — EDIT (additive): unit tests for both methods (happy path + no-current-session throw +, for absorb, the `hasSessionChanged()` flips-to-false + `snapshotPRD` called + immutable hash/prdSnapshot update).

**Success Definition**:
- `getChangeDiffSummary()` returns `diffPRDs(currentSession.prdSnapshot, resolvePRD(prdPath))` and throws a clear error when no session is loaded.
- `absorbCosmeticChange()` rewrites `prd_snapshot.md` (via `snapshotPRD`), updates `#currentSession.metadata.hash` + `#prdHash` + `#currentSession.prdSnapshot` to the resolved PRD's hash/content, so `hasSessionChanged()` returns `false` afterward (in-process); throws a clear error when no session is loaded.
- Neither method changes `hasSessionChanged()`, `createDeltaSession()`, `loadSession()`, or any existing method. No new imports beyond the `DiffSummary` type.
- `npm run typecheck && npm run lint && npm run format:check` clean; `npx vitest run tests/unit/core/session-manager.test.ts` GREEN; `session-manager.ts` stays at 100% coverage.

---

## Why

- **Unblocks BUG-002 Part A (S2).** PRD §4.3 step 1 requires PRD changes to be classified
  (COSMETIC vs SUBSTANTIVE) before a delta session is spawned. Today `prp-pipeline.ts:781`
  calls `hasSessionChanged()` (a pure hash compare) → every edit, even whitespace-only,
  triggers a full delta session. S2 will wire `classifyChangeWithRetry(getChangeDiffSummary())`
  into `initializeSession`; S1 provides the two methods S2 calls. Without S1, S2 has no seam.
- **`getChangeDiffSummary` exposes the full object the classifier needs.** `createDeltaSession`
  already computes `diffPRDs(...)` (812) but stores only `summaryText`. The classifier
  (`classifyChangeWithRetry(diffSummary: DiffSummary)`) needs the full `DiffSummary` (changes +
  stats). A method is the clean seam (the fields are private).
- **`absorbCosmeticChange` makes COSMETIC absorption a SessionManager capability.** Refreshing
  the baseline (rewrite snapshot + re-baseline hashes) is inherently session-state management —
  it belongs in SessionManager, not the pipeline. It mirrors `acceptPrdChangesResponse`'s
  refresh but for the no-delta-session COSMETIC path.
- **Standalone & scoped.** Both methods are pure additions to SessionManager; they don't change
  any existing method, signature, or persisted format. S1 is file-disjoint from S2
  (prp-pipeline.ts) and from the parallel P1.M1.T1.S3 (BUG-001 test file).
- **Out of scope (hard boundary):** wiring the classifiers into `prp-pipeline.ts`
  `initializeSession` (S2), correcting the misleading JSDoc at `prp-pipeline.ts:845` (S2), the
  CLEAN/DIRTY artifact guard around `delta_prd.md` (P1.M2.T2.S1), editing
  `acceptPrdChangesResponse` to delegate to `absorbCosmeticChange` (prp-pipeline.ts = S2's
  region — flag as optional follow-up), any dir-name-rename for cross-process idempotency, and
  any `docs/*.md` (DOCS: none).

---

## What

### User-visible behavior
None at the CLI/runtime surface. The two methods are consumed by S2's `initializeSession` wiring
(not in S1). Observable only via SessionManager inspection: after `absorbCosmeticChange()`,
`hasSessionChanged()` is `false` and `prd_snapshot.md` matches the current PRD.

### Technical requirements (exact contract)

**`src/core/session-manager.ts`** — add a type-only import + two public methods.

Import (alongside the existing `import { diffPRDs } from './prd-differ.js';` at line 46):
```ts
import { diffPRDs, type DiffSummary } from './prd-differ.js';
```

**Method 1 — `getChangeDiffSummary()`** (place near `createDeltaSession` / `hasSessionChanged`):
```ts
/**
 * Compute the resolved-vs-resolved change diff between the loaded session's PRD
 * snapshot and the CURRENT live PRD (the object BUG-002's COSMETIC/SUBSTANTIVE
 * classifier consumes). Pure read — does not mutate session state.
 *
 * @returns The full {@link DiffSummary} (changes + summaryText + stats).
 * @throws {Error} If no session is loaded (mirrors {@link SessionManager.hasSessionChanged}).
 */
async getChangeDiffSummary(): Promise<DiffSummary> {
  if (!this.#currentSession) {
    throw new Error('Cannot compute change diff: no session loaded');
  }
  return diffPRDs(
    this.#currentSession.prdSnapshot,
    await resolvePRD(this.prdPath)
  );
}
```

**Method 2 — `absorbCosmeticChange()`**:
```ts
/**
 * Absorb a COSMETIC PRD change as the new baseline WITHOUT spawning a delta
 * session (BUG-002 Part A). Resolves the live PRD ONCE, rewrites
 * `prd_snapshot.md`, and re-baselines `metadata.hash` + `#prdHash` +
 * `prdSnapshot` so the next {@link SessionManager.hasSessionChanged} is false.
 *
 * @remarks
 * The persisted artifact is the rewritten `prd_snapshot.md` (via {@link snapshotPRD}).
 * `metadata.hash` is dir-name-derived on load ({@link SessionManager.loadSession}), so no
 * separate metadata file is written; the in-memory re-baseline makes `hasSessionChanged()`
 * false in-process (mirrors `acceptPrdChangesResponse`'s refresh model). Does NOT clear
 * `.pending_delta_hash` — the COSMETIC path runs before any delta spawn.
 *
 * @throws {Error} If no session is loaded.
 */
async absorbCosmeticChange(): Promise<void> {
  if (!this.#currentSession) {
    throw new Error('Cannot absorb cosmetic change: no session loaded');
  }
  const sessionPath = this.#currentSession.metadata.path;
  // Resolve ONCE (PRD §2.3) — feeds both the snapshot rewrite and the new hash
  // (mirrors initialize:397 + createDeltaSession:806 "resolve ONCE" pattern).
  const resolved = await resolvePRD(this.prdPath);
  await snapshotPRD(sessionPath, this.prdPath, resolved);
  const newHash = hashPRDContent(resolved);
  // CRITICAL: SessionMetadata.hash is readonly (models.ts:1034) → rebuild the state object
  // immutably (mirrors createDeltaSession:836-858 fresh-object assignment). The spread
  // preserves any DeltaSession-specific fields if the current session is a delta.
  this.#currentSession = {
    ...this.#currentSession,
    metadata: { ...this.#currentSession.metadata, hash: newHash },
    prdSnapshot: resolved,
  };
  this.#prdHash = newHash;
}
```

**`tests/unit/core/session-manager.test.ts`** — additive tests (see Implementation Tasks for
exact cases). Ensure the `session-utils` `vi.mock` block (line ~52) mocks `hashPRDContent`
(add `mockHashPRDContent` if absent) and `diffPRDs` (or let `diffPRDs` run real — it's pure).

### Success Criteria
- [ ] `getChangeDiffSummary()` returns `diffPRDs(currentSession.prdSnapshot, resolvePRD(prdPath))`.
- [ ] `getChangeDiffSummary()` throws a clear error when `#currentSession` is null.
- [ ] `absorbCosmeticChange()` calls `snapshotPRD(sessionPath, prdPath, resolved)`.
- [ ] After `absorbCosmeticChange()`: `#currentSession.metadata.hash` === `hashPRDContent(resolved)`,
      `#prdHash` === same, `#currentSession.prdSnapshot` === resolved, `hasSessionChanged()` === false.
- [ ] `absorbCosmeticChange()` throws a clear error when `#currentSession` is null.
- [ ] No existing method/field changed; no new imports except the `DiffSummary` type.
- [ ] `npm run typecheck && npm run lint && npm run format:check` clean;
      `npx vitest run tests/unit/core/session-manager.test.ts` GREEN.

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_ **Yes** — the
verbatim method bodies, the exact import edit, the readonly-metadata gotcha (rebuild, don't
mutate) with the `createDeltaSession:836-858` precedent, the "resolve ONCE" invariant
(initialize:397), the persistence model (dir-name-derived hash → snapshot is the persisted
artifact), the "do not duplicate" resolution (use `snapshotPRD`, not `refreshSnapshotToCurrentPRD`;
don't edit `acceptPrdChangesResponse` — S2's region), the `clearPendingDeltaHash` exclusion, the
test mock surface (existing `session-utils` mock + `mockResolvePRD`/`mockSnapshotPRD`), the scope
boundaries (don't touch prp-pipeline.ts / S2 / S3), and the pre-existing-red-suite caveat. See
`research/session-manager-classifier-seam.md` for the grep evidence behind every claim.

### Documentation & References
```yaml
# MUST READ — the BUG-002 fix design (what S1 implements: Part A steps 1+2)
- docfile: plan/008_15504f60a0ef/bugfix/002_86589b7d57d2/architecture/bug-002-classifiers.md
  section: "Where the DiffSummary comes from" + "Fix design → Part A — change classifier"
  why: Prescribes getChangeDiffSummary() + absorbCosmeticChange() verbatim; confirms the
        createDeltaSession diff is the thing to reuse and snapshotPRD/resolvePRD/hashPRDContent
        are in scope.
  critical: absorb refreshes the baseline WITHOUT a delta session; COSMETIC ⇒ absorb, SUBSTANTIVE ⇒
        handleDelta. S1 provides the methods; S2 does the wiring.

# MUST READ — this subtask's research (the traps + verbatim bodies)
- docfile: plan/008_15504f60a0ef/bugfix/002_86589b7d57d2/P1M2T1S1/research/session-manager-classifier-seam.md
  section: "4a. CRITICAL — metadata.hash is readonly", "4b. do not duplicate", "4c. do NOT clearPendingDeltaHash",
           "5. Persistence model", "7. Test patterns"
  why: The readonly-rebuild rule, the snapshotPRD-vs-refreshSnapshotToCurrentPRD choice, the
        clearPendingDeltaHash exclusion, the dir-name-derived-hash persistence note, and the test recipe.

# CONTEXT — S2 (the consumer) — read the CONTRACT, do NOT implement it
- file: plan/008_15504f60a0ef/bugfix/002_86589b7d57d2/tasks.json   # (or the S2 PRP when it exists)
  why: S2 wires `if (hasSessionChanged()) { const d = await getChangeDiffSummary(); const v = await
        classifyChangeWithRetry(d); v === 'SUBSTANTIVE' ? handleDelta() : absorbCosmeticChange(); }`
        into prp-pipeline.ts initializeSession (~781) + corrects the JSDoc at ~845. S1 MUST NOT
        touch prp-pipeline.ts (S2's file). S1 only provides the two SessionManager methods.

# PATTERN FILES — the exact edit site + precedents
- file: src/core/session-manager.ts
  why: EDIT — add the two methods + the DiffSummary type import. All building blocks already
        imported (resolvePRD:38, hashPRDContent:39, snapshotPRD:41, diffPRDs:46) and used
        (initialize:397/398/574, createDeltaSession:806/807/812). #currentSession:238, #prdHash:241,
        this.prdPath:302. hasSessionChanged:1688 (the guard to mirror + the comparison to satisfy).
  pattern: "this.#currentSession = deltaSession;  // createDeltaSession:858 — fresh-object assignment"
  gotcha: SessionMetadata.hash is READONLY (models.ts:1034) → rebuild the SessionState immutably;
          do NOT mutate #currentSession.metadata.hash. #currentSession is `SessionState | null` —
          after the `if (!this.#currentSession) throw` guard TS narrows it for the spread.

- file: src/core/prd-differ.ts
  why: READ-ONLY — provides `export interface DiffSummary` (112) + `diffPRDs(old, new): DiffSummary`.
        S1 imports the type (type-only) for getChangeDiffSummary's signature. diffPRDs is already
        imported as a value at session-manager.ts:46.

- file: src/core/session-utils.ts
  why: READ-ONLY — provides resolvePRD (569), hashPRDContent (246), snapshotPRD (1205). All already
        imported into session-manager.ts. snapshotPRD(sessionPath, prdPath, resolved) is the
        resolve-once variant (already used at initialize:574) — preferred over
        refreshSnapshotToCurrentPRD (1491, which double-resolves).

- file: src/core/models.ts
  why: READ-ONLY — SessionMetadata.hash is `readonly` (1034); SessionState (1115). Confirms the
        immutable-rebuild requirement.

# CONSUMER-ADJACENT (read-only — do NOT edit in S1)
- file: src/workflows/prp-pipeline.ts
  why: acceptPrdChangesResponse (907) uses refreshSnapshotToCurrentPRD + clearPendingDeltaHash — the
        "refresh" S1 reuses the spirit of. S2's region (initializeSession ~781 + JSDoc ~845).
        absorbCosmeticChange does NOT call clearPendingDeltaHash (COSMETIC path runs pre-delta-spawn).
  gotcha: Editing acceptPrdChangesResponse to delegate to absorbCosmeticChange is a nice follow-up
          BUT lives in prp-pipeline.ts (S2's file) → out of scope for S1; flag it.

# TEST PATTERN — the file S1's tests join
- file: tests/unit/core/session-manager.test.ts
  why: EDIT (additive). Mocks node:fs/promises, node:fs, session-utils (mockResolvePRD:143,
        mockSnapshotPRD:241), task-utils, file-lock, prd-validator. Construct via
        `new SessionManager('/test/PRD.md', resolve('plan'))`. Add mockHashPRDContent (+ mockDiffPRDs
        if you don't let diffPRDs run real) to the session-utils vi.mock block (line ~52).
  pattern: "const mockResolvePRD = resolvePRD as any; … mockResolvePRD.mockResolvedValue('# Test PRD');"
  gotcha: To set #currentSession in a test, either drive `initialize()` (mocked find/load) or use
          `loadSessionAsCurrent` / assign via the public `currentSession`-adjacent seam the suite
          already uses (check how existing tests establish an active session before hasSessionChanged).
```

### Current Codebase tree (relevant slice)
```bash
src/core/session-manager.ts             # EDIT — +getChangeDiffSummary() +absorbCosmeticChange() +DiffSummary type import
src/core/prd-differ.ts                  # READ-ONLY (DiffSummary + diffPRDs)
src/core/session-utils.ts               # READ-ONLY (resolvePRD/hashPRDContent/snapshotPRD — already imported)
src/core/models.ts                      # READ-ONLY (SessionMetadata.hash readonly)
src/workflows/prp-pipeline.ts           # UNCHANGED (S2's file — acceptPrdChangesResponse/initializeSession)
tests/unit/core/session-manager.test.ts # EDIT (additive tests for both methods)
```

### Desired Codebase tree with files to be added/edited
```bash
src/core/session-manager.ts             # MODIFIED (+2 public methods + type import)
tests/unit/core/session-manager.test.ts # MODIFIED (additive: happy-path + no-session-throw + absorb flips test)
```

### Known Gotchas of our codebase & Library Quirks
```ts
// CRITICAL — SessionMetadata.hash is READONLY (models.ts:1034). You CANNOT write
//   `this.#currentSession.metadata.hash = newHash`. Rebuild the SessionState immutably:
//   `this.#currentSession = { ...this.#currentSession, metadata: { ...md, hash: newHash }, prdSnapshot: resolved };`
//   This mirrors createDeltaSession:836-858 (it builds a fresh deltaSession object + assigns). The
//   spread preserves DeltaSession fields (oldPRD/newPRD/diffSummary) if the current session is a delta.

// CRITICAL — "resolve ONCE" (PRD §2.3; initialize:397, createDeltaSession:806). absorbCosmeticChange
//   MUST resolve once and feed BOTH snapshotPRD(resolved) AND hashPRDContent(resolved). Do NOT call
//   refreshSnapshotToCurrentPRD (session-utils:1491) — it resolves internally → double-resolve. Use
//   snapshotPRD(sessionPath, this.prdPath, resolved) (already imported, already used at initialize:574).

// CRITICAL — DO NOT call clearPendingDeltaHash in absorbCosmeticChange. acceptPrdChangesResponse does
//   (it cancels a .pending_delta_hash marker), but the COSMETIC path runs in initializeSession BEFORE
//   any delta is spawned, so no marker exists. Adding it would be a misleading no-op.

// CRITICAL — DO NOT edit src/workflows/prp-pipeline.ts. acceptPrdChangesResponse (907) + initializeSession
//   (~781) + the JSDoc (~845) are S2's region (S2 wires the classifiers + corrects the JSDoc). S1 = ONLY
//   session-manager.ts + its test. Editing acceptPrdChangesResponse to delegate to absorbCosmeticChange is
//   a nice FOLLOW-UP but is in prp-pipeline.ts → out of scope here; flag it in the commit message.

// GOTCHA — metadata.hash is DIR-NAME-DERIVED (loadSession:690 parses it from NNN_hash; #findSessionByHash:339
//   matches s.hash === hash from the dir name). There is NO standalone metadata file. So the PERSISTED
//   artifact of absorbCosmeticChange is the rewritten prd_snapshot.md; the in-memory metadata.hash + #prdHash
//   re-baseline makes hasSessionChanged() false IN-PROCESS (the contract's literal test). This matches
//   acceptPrdChangesResponse's model. A dir-rename for cross-process idempotency is out of scope — do not
//   over-engineer; the item's test is in-process ("hasSessionChanged() flips to false after absorb").

// GOTCHA — #currentSession is `SessionState | null` (238). After `if (!this.#currentSession) throw …`, TS
//   narrows to SessionState for the rest of the method body (safe to spread + read .metadata.path/.prdSnapshot).
//   Mirror hasSessionChanged's (1688) guard style for the throw message.

// GOTCHA — getChangeDiffSummary is a PURE READ (no state mutation). It must NOT update #prdHash or metadata.
//   Only absorbCosmeticChange mutates. Guard getChangeDiffSummary with `!#currentSession` only (#prdHash not
//   needed — it only reads prdSnapshot + prdPath).

// GOTCHA — 100% coverage globally enforced (vitest.config.ts). Both methods + both `!#currentSession` throw
//   branches must be exercised by the unit tests (happy path + no-session throw). session-manager.ts stays
//   at 100% only if every new branch is hit.

// GOTCHA — prettier is ERROR-enforced (format:check). Run `npm run fix` before validate.

// GOTCHA — bugfix BUG-004: the FULL `npm run test:run` is PRE-EXISTING-RED (178 failures — P1.M4 scope).
//   Do NOT use it as the gate. Gate = typecheck + lint + format:check + the targeted session-manager.test.ts.
//   Adding 2 methods + tests cannot increase the red count; it only adds coverage to session-manager.ts.

// CRITICAL — Parallel execution: P1.M1.T1.S3 (running now) writes ONLY a BUG-001 integration TEST file
//   (delta-breakdown-integration.test.ts). It is file-disjoint from S1 (session-manager.ts + its unit test).
//   Zero overlap, no merge conflict.
```

---

## Implementation Blueprint

### Data models and structure
No new data models. One type-only import + two public async methods. The only structural nuance
is the **immutable rebuild** of `#currentSession` (readonly `metadata.hash`):
```ts
import { diffPRDs, type DiffSummary } from './prd-differ.js';
// …
async getChangeDiffSummary(): Promise<DiffSummary> { /* guard + diffPRDs(prdSnapshot, resolvePRD(prdPath)) */ }
async absorbCosmeticChange(): Promise<void> { /* guard + resolve ONCE + snapshotPRD + immutable rebuild + #prdHash */ }
```

### Implementation Tasks (ordered by dependencies — implicit TDD: RED first, then GREEN)
```yaml
Task 1: EDIT tests/unit/core/session-manager.test.ts  (RED — failing tests for the two new methods FIRST)
  - ENSURE the session-utils vi.mock block (~line 52) exports mocks for resolvePRD, hashPRDContent,
        snapshotPRD, diffPRDs (add mockHashPRDContent / mockDiffPRDs if absent; mirror mockResolvePRD:143).
  - ADD a describe('getChangeDiffSummary', …):
      * it('returns diffPRDs(currentSession.prdSnapshot, resolvePRD(prdPath))'): set #currentSession
        (via the suite's existing active-session setup) with prdSnapshot='# Old'; mockResolvePRD → '# New';
        mockDiffPRDs → a DiffSummary fixture { changes:[…], summaryText:'…', stats:{…} }; call
        getChangeDiffSummary(); assert it returns the fixture AND mockDiffPRDs was called with
        ('# Old','# New') (or, if diffPRDs runs real, assert .changes on the real diff).
      * it('throws when no session is loaded'): clear #currentSession (new manager, no initialize);
        expect(() => manager.getChangeDiffSummary()).rejects.toThrow(/no session loaded/).
  - ADD a describe('absorbCosmeticChange', …):
      * it('rewrites prd_snapshot.md and re-baselines hashes so hasSessionChanged() is false'):
        set #currentSession.metadata.hash='oldhash', #prdHash='different' (so hasSessionChanged() is true
        BEFORE); mockResolvePRD → '# Resolved'; mockHashPRDContent → 'resolvedhash'; mockSnapshotPRD → undef;
        await absorbCosmeticChange(); assert:
          - mockSnapshotPRD called with (currentSession.metadata.path, prdPath, '# Resolved')
          - manager.currentSession!.metadata.hash === 'resolvedhash'
          - manager.currentSession!.prdSnapshot === '# Resolved'
          - manager.hasSessionChanged() === false
      * it('throws when no session is loaded'): expect(() => absorbCosmeticChange()).rejects.toThrow(/no session loaded/).
  - EXPECTED NOW: the new its FAIL (methods don't exist) → RED.

Task 2: EDIT src/core/session-manager.ts  (GREEN — the two methods)
  - IMPORT: change `import { diffPRDs } from './prd-differ.js';` (46) →
        `import { diffPRDs, type DiffSummary } from './prd-differ.js';`
  - ADD getChangeDiffSummary() + absorbCosmeticChange() (verbatim bodies in "Technical requirements").
        Place them near createDeltaSession (after it, ~860) or near hasSessionChanged (~1688) — either is
        fine; keep them as public methods on the class.
  - DO NOT: change hasSessionChanged / createDeltaSession / loadSession / any existing method or field;
        add any import other than the DiffSummary type; mutate metadata.hash directly (rebuild immutably);
        call clearPendingDeltaHash; touch prp-pipeline.ts.
  - EXPECTED: the new tests turn GREEN; existing session-manager tests stay GREEN.

Task 3: FORMAT + VERIFY
  - RUN: npm run fix → npm run typecheck → npm run lint → npm run format:check.
  - RUN: npx vitest run tests/unit/core/session-manager.test.ts   # the affected suite — GREEN.
  - RUN: npx vitest run tests/unit/core/session-manager.test.ts --coverage   # session-manager.ts 100%.
  - DO NOT run the full `npm run test:run` (pre-existing red — bugfix BUG-004, P1.M4 scope).
  - EXPECTED: typecheck/lint/format clean; session-manager.test.ts green; session-manager.ts 100% covered.
```

### Implementation Patterns & Key Details
```ts
// ---- src/core/session-manager.ts: the import edit (line 46) ----
import { diffPRDs, type DiffSummary } from './prd-differ.js';

// ---- getChangeDiffSummary (pure read; mirrors createDeltaSession:811-812 diff) ----
async getChangeDiffSummary(): Promise<DiffSummary> {
  if (!this.#currentSession) {
    throw new Error('Cannot compute change diff: no session loaded');
  }
  return diffPRDs(this.#currentSession.prdSnapshot, await resolvePRD(this.prdPath));
}

// ---- absorbCosmeticChange (immutable rebuild — metadata.hash is readonly) ----
async absorbCosmeticChange(): Promise<void> {
  if (!this.#currentSession) {
    throw new Error('Cannot absorb cosmetic change: no session loaded');
  }
  const sessionPath = this.#currentSession.metadata.path;
  const resolved = await resolvePRD(this.prdPath);     // resolve ONCE (PRD §2.3)
  await snapshotPRD(sessionPath, this.prdPath, resolved);
  const newHash = hashPRDContent(resolved);
  this.#currentSession = {                             // rebuild — metadata.hash is readonly
    ...this.#currentSession,
    metadata: { ...this.#currentSession.metadata, hash: newHash },
    prdSnapshot: resolved,
  };
  this.#prdHash = newHash;                             // → hasSessionChanged() now false
}

// ---- tests/unit/core/session-manager.test.ts: the absorb assertion (the contract test) ----
it('rewrites prd_snapshot.md and re-baselines hashes so hasSessionChanged() is false', async () => {
  // …establish #currentSession (prdSnapshot='# Old', metadata.hash='oldhash') + #prdHash='different'…
  mockResolvePRD.mockResolvedValue('# Resolved');
  mockHashPRDContent.mockReturnValue('resolvedhash');
  mockSnapshotPRD.mockResolvedValue(undefined);

  expect(manager.hasSessionChanged()).toBe(true);      // BEFORE
  await manager.absorbCosmeticChange();

  expect(mockSnapshotPRD).toHaveBeenCalledWith(sessionPath, prdPath, '# Resolved');
  expect(manager.currentSession!.metadata.hash).toBe('resolvedhash');
  expect(manager.currentSession!.prdSnapshot).toBe('# Resolved');
  expect(manager.hasSessionChanged()).toBe(false);     // AFTER — the contract
});
```

### Integration Points
```yaml
SESSION-MANAGER.TS (src/core/session-manager.ts):
  - +import type { DiffSummary } from './prd-differ.js' (alongside diffPRDs @46)
  - +async getChangeDiffSummary(): Promise<DiffSummary>  (guard + diffPRDs(prdSnapshot, resolvePRD(prdPath)))
  - +async absorbCosmeticChange(): Promise<void>  (guard + resolve-ONCE + snapshotPRD + immutable rebuild + #prdHash)
  - PRESERVE: hasSessionChanged, createDeltaSession, loadSession, #currentSession/#prdHash fields, all existing methods.

DOWNSTREAM CONSUMER (S2 — P1.M2.T1.S2; NOT S1):
  - prp-pipeline.ts initializeSession (~781): hasSessionChanged() → getChangeDiffSummary() →
    classifyChangeWithRetry() → COSMETIC ⇒ absorbCosmeticChange(); SUBSTANTIVE ⇒ handleDelta().
  - S2 also corrects the misleading JSDoc at prp-pipeline.ts:845. S1 does NOT touch prp-pipeline.ts.

DOCS (the item says DOCS: none):
  - Brief JSDoc on each method (Mode-A-adjacent hygiene) is the only doc artifact. NO docs/*.md change.
  - Commit message notes: the readonly-rebuild, resolve-ONCE, clearPendingDeltaHash exclusion, the
    dir-name-derived-hash persistence note, and the acceptPrdChangesResponse-delegation follow-up flag.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
npm run fix            # lint:fix + prettier --write (run first)
npm run typecheck      # tsc --noEmit -p tsconfig.build.json — clean (src/; readonly-rebuild must typecheck)
npm run lint           # eslint . --ext .ts — clean
npm run format:check   # prettier --check — clean
# Expected: all clean. Likely typecheck failure if you mutated metadata.hash directly instead of
#   rebuilding (TS2540 "Cannot assign to 'hash' because it is read-only") → switch to the spread rebuild.
```

### Level 2: Unit Tests (Component Validation)
```bash
# The directly-affected suite — MUST be GREEN:
npx vitest run tests/unit/core/session-manager.test.ts
# Coverage on the touched source file (confirm 100% retained — both new methods + both throw branches):
npx vitest run tests/unit/core/session-manager.test.ts --coverage
# Expected: green. If session-manager.ts coverage <100%, a new branch is unexercised — ensure BOTH
#   methods' happy paths AND both `!#currentSession` throw branches have a test. If absorb's
#   hasSessionChanged()-flips-to-false test fails, check that BOTH #prdHash AND metadata.hash were
#   set to newHash (hasSessionChanged compares the two).
# Do NOT run the full `npm run test:run` — pre-existing red (bugfix BUG-004, P1.M4 scope).
```

### Level 3: Integration / Regression (System Validation)
```bash
# Confirm the consumer-adjacent code is UNCHANGED (S1 must not edit prp-pipeline.ts):
git diff --name-only   # Expect ONLY src/core/session-manager.ts + tests/unit/core/session-manager.test.ts.
# Build emits dist/ cleanly (proves the type import + methods compile):
npx tsc -p tsconfig.build.json
# A sibling suite that constructs SessionManager (unchanged — must stay green):
npx vitest run tests/unit/core/session-manager.test.ts   # (same as Level 2; the gate)
# Expected: git diff shows only the 2 files; build clean; session-manager.test.ts green. No other suite
#   imports the new methods yet (S2 will), so no broader regression is possible from S1 alone.
```

### Level 4: Creative & Domain-Specific Validation
```bash
# No MCP/DB/HTTP. Domain checks (record in commit message):
#   1. getChangeDiffSummary is a pure read (no state mutation) — mirrors createDeltaSession's diff (811-812).
#   2. absorbCosmeticChange resolves ONCE (no double-resolve) — uses snapshotPRD(resolved), NOT refreshSnapshotToCurrentPRD.
#   3. metadata.hash rebuilt immutably (readonly) — the spread preserves DeltaSession fields if present.
#   4. After absorb: hasSessionChanged() === false (both #prdHash + metadata.hash re-baselined).
#   5. Persistence = rewritten prd_snapshot.md (dir-name-derived hash model; matches acceptPrdChangesResponse).
#   6. Scope: prp-pipeline.ts UNCHANGED (S2's region); acceptPrdChangesResponse-delegation flagged as a follow-up.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` clean.
- [ ] `npm run lint` clean.
- [ ] `npm run format:check` clean.
- [ ] `npx vitest run tests/unit/core/session-manager.test.ts` GREEN.
- [ ] `src/core/session-manager.ts` remains at 100% coverage.
- [ ] `git diff --name-only` shows ONLY `src/core/session-manager.ts` + `tests/unit/core/session-manager.test.ts`.

### Feature Validation
- [ ] `getChangeDiffSummary()` returns `diffPRDs(prdSnapshot, resolvePRD(prdPath))`; throws when no session.
- [ ] `absorbCosmeticChange()` calls `snapshotPRD(sessionPath, prdPath, resolved)`.
- [ ] After `absorbCosmeticChange()`: `metadata.hash` + `#prdHash` = `hashPRDContent(resolved)`;
      `prdSnapshot` = resolved; `hasSessionChanged()` === false.
- [ ] `absorbCosmeticChange()` throws when no session.
- [ ] No existing method/field changed; no new imports except the `DiffSummary` type.

### Code Quality Validation
- [ ] `metadata.hash` rebuilt immutably (spread), NOT mutated (it's readonly).
- [ ] `absorbCosmeticChange` resolves ONCE (uses `snapshotPRD(resolved)`, not `refreshSnapshotToCurrentPRD`).
- [ ] `absorbCosmeticChange` does NOT call `clearPendingDeltaHash`.
- [ ] `getChangeDiffSummary` is a pure read (no state mutation); guards `!#currentSession`.
- [ ] Only `src/core/session-manager.ts` + `tests/unit/core/session-manager.test.ts` are modified.
- [ ] `src/workflows/prp-pipeline.ts` UNCHANGED (S2's region).

### Documentation & Deployment
- [ ] Brief JSDoc on each method (the only doc artifact; item says DOCS: none).
- [ ] No `docs/*.md`, README, or `.env.example` changes.
- [ ] Commit message notes: the readonly-rebuild, resolve-ONCE, clearPendingDeltaHash exclusion,
      dir-name-derived-hash persistence model, S2-consumer contract, and the
      acceptPrdChangesResponse-delegation follow-up flag.

---

## Anti-Patterns to Avoid

- ❌ Don't mutate `this.#currentSession.metadata.hash` directly — it's `readonly` (models.ts:1034) and
      TS rejects it. Rebuild the SessionState immutably (`{ ...this.#currentSession, metadata: { ...md, hash }, prdSnapshot }`),
      exactly like `createDeltaSession:836-858` builds a fresh object.
- ❌ Don't call `refreshSnapshotToCurrentPRD` inside `absorbCosmeticChange` — it resolves the PRD
      internally, forcing a double-resolve (violates the "resolve ONCE" invariant, initialize:397).
      Use `snapshotPRD(sessionPath, prdPath, resolved)` (resolve-once variant, already imported + used at 574).
- ❌ Don't call `clearPendingDeltaHash` — the COSMETIC-absorb path runs in `initializeSession` BEFORE any
      delta is spawned, so no `.pending_delta_hash` marker exists. That's `acceptPrdChangesResponse`'s concern.
- ❌ Don't edit `src/workflows/prp-pipeline.ts` — `acceptPrdChangesResponse` (907), `initializeSession`
      (~781), and the JSDoc (~845) are S2's region. S1 = ONLY session-manager.ts + its test. Editing
      `acceptPrdChangesResponse` to delegate to `absorbCosmeticChange` is a follow-up (flag it, don't do it).
- ❌ Don't over-engineer cross-process idempotency (dir rename). The contract + test are in-process
      ("hasSessionChanged() flips to false after absorb"). The persisted artifact is `prd_snapshot.md`;
      the dir-name-derived hash model is unchanged (matches `acceptPrdChangesResponse`).
- ❌ Don't mutate state in `getChangeDiffSummary` — it's a pure read. Don't guard it on `#prdHash`
      (it only needs `prdSnapshot` + `prdPath`); guard `!#currentSession` only.
- ❌ Don't change `hasSessionChanged`, `createDeltaSession`, `loadSession`, `#currentSession`/`#prdHash`
      field declarations, or any existing method. The two methods are pure additions.
- ❌ Don't add imports beyond the `DiffSummary` type. `resolvePRD`/`hashPRDContent`/`snapshotPRD`/`diffPRDs`
      are already imported (38-46).
- ❌ Don't run the full `npm run test:run` as the gate — 178 pre-existing failures (bugfix BUG-004,
      P1.M4 scope). Gate = typecheck + lint + format:check + the targeted session-manager.test.ts.
- ❌ Don't touch `src/core/change-classifier.ts` (the classifier — S2 imports it into prp-pipeline) or
      `src/core/prd-differ.ts` (read-only — provides `DiffSummary`/`diffPRDs`).
- ❌ Don't forget BOTH throw branches in the tests — 100% coverage requires the `!#currentSession` throw
      in EACH method to be exercised (two separate "throws when no session" tests).

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: This is a small, self-contained addition — two public async methods to a file that already
imports and uses every building block (`resolvePRD`/`hashPRDContent`/`snapshotPRD`/`diffPRDs`). The
verbatim method bodies are specified, the one real trap (readonly `metadata.hash` → immutable rebuild,
with the in-repo `createDeltaSession:836-858` precedent) is called out at every level, and the
"resolve ONCE / don't duplicate / don't clearPendingDeltaHash" rules are pinned to specific line
numbers. The persistence model (dir-name-derived hash; snapshot is the persisted artifact) is verified
against `loadSession:690` + `#findSessionByHash:339`, so the in-process `hasSessionChanged()→false`
contract is exactly what the test asserts. Scope is airtight: S1 edits only `session-manager.ts` + its
unit test; it is file-disjoint from S2 (`prp-pipeline.ts`) and from the parallel P1.M1.T1.S3 (BUG-001
test file). The test surface mirrors the existing `session-manager.test.ts` mocks (`mockResolvePRD`/
`mockSnapshotPRD` + add `mockHashPRDContent`). The one caveat — the full suite is pre-existing red
(bugfix BUG-004) — is handled by gating on the targeted session-manager.test.ts. Residual risks: (a)
a TS error from mutating readonly `metadata.hash` (the PRP mandates the spread rebuild + the typecheck
gate catches it); (b) a missing mock (`mockHashPRDContent`/`mockDiffPRDs`) in the test's session-utils
block (enumerated in Task 1); (c) a prettier nit (auto-fixed via `npm run fix`). No runtime/network/LLM
unknowns — both methods are local file/state operations.