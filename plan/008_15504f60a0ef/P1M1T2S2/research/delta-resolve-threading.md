# Research — Wiring `resolvePRD` through the delta workflow (P1.M1.T2.S2)

Exact call-site inventory, the design decision (resolve-once per site, mirroring S1's
`initialize()`), the `findSessionByPRD` no-op+JSDoc finding, and the full unit-test
cascade with before/after transformation patterns.

## 1. Call-site inventory (verified against current source)

### createDeltaSession — `src/core/session-manager.ts:610–680`
```ts
// L624  HASH  — calls hashPRD(newPRDPath). S1 made hashPRD resolve-aware, so the HASH
//               is already resolved-correct. But it resolves SEPARATELY from the diff read.
const newHash = await hashPRD(newPRDPath);
const sessionHash = newHash.slice(0, 12);
// L631  oldPRD — from in-memory prdSnapshot (RESOLVED after S1's initialize). ✓
const oldPRD = this.#currentSession.prdSnapshot;
// L634  DIFF INPUT — RAW readFile. BUG: resolved-vs-RAW diff + stored as RAW snapshot.
const newPRD = await readFile(absPath, 'utf-8');
// L637  diff — resolved(oldPRD) vs RAW(newPRD)  ← INCONSISTENT
const diffResult = diffPRDs(oldPRD, newPRD);
// L648  createSessionDirectory — 3-arg (re-resolves via hashPRD internally)
const sessionPath = await createSessionDirectory(newPRDPath, newSeq, this.planDir);
// L668  in-memory delta prdSnapshot — RAW newPRD
prdSnapshot: newPRD,
// L672  delta oldPRD/newPRD fields — RAW newPRD
oldPRD, newPRD,
```
**Design (resolve once, mirror initialize):** resolve `newPRD` ONCE via `resolvePRD`,
feed it to `hashPRDContent` (the hash), `diffPRDs` (the diff), the in-memory
`prdSnapshot`/`newPRD` fields, AND pass the hash as `createSessionDirectory`'s 4th
`precomputedHash` arg (S1 added it for exactly this). `oldPRD` is already resolved. This
collapses 3 resolutions to 1 and makes hash/diff/snapshot all share the same resolved bytes.

### handleDelta — `src/workflows/prp-pipeline.ts:627–689`
```ts
// L638  oldPRD — currentSession.prdSnapshot (RESOLVED after S1). ✓
const oldPRD = currentSession.prdSnapshot;
// L645  newPRD — RAW readFile. BUG: resolved-vs-RAW diff into DeltaAnalysisWorkflow.
newPRD = await readFile(this.sessionManager.prdPath, 'utf-8');
// L666  DeltaAnalysisWorkflow(oldPRD, newPRD, …) — resolved vs RAW  ← INCONSISTENT
const workflow = new DeltaAnalysisWorkflow(oldPRD, newPRD, completedTaskIds);
// L686  createDeltaSession(prdPath) — S2 fixes its internals (§1 above)
await this.sessionManager.createDeltaSession(this.sessionManager.prdPath);
```
**Design:** replace L645 `readFile` with `resolvePRD(this.sessionManager.prdPath)`.
Now `DeltaAnalysisWorkflow` receives resolved-vs-resolved. `oldPRD` stays from the
snapshot (resolved). `handleDelta` and `createDeltaSession` each resolve independently —
this is INTENTIONAL (different components; cross-threading the resolved string would cross
the pipeline→manager boundary). Idempotency (S3) guarantees both yield identical bytes.

### findSessionByPRD (static) — `src/core/session-manager.ts:1360–1389`
> NOTE: the work item / `phase_findings.md` call this "findSessionByHash @ 1383", but the
> actual symbol is the **static `findSessionByPRD`** (the private `#findSessionByHash(hash)`
> at L248 takes a PRECOMPUTED hash and never hashes — it's called by `initialize()`@360 with
> the S1-computed `sessionHash`). The line number + "hashes RAW / route through resolvePRD
> before hashing" unambiguously point at `findSessionByPRD`.

```ts
// L1383  HASH — calls hashPRD(absPath). S1 made hashPRD resolve-aware ⇒ ALREADY resolved.
const fullHash = await hashPRD(absPath);
const sessionHash = fullHash.slice(0, 12);
```
**Design: NO functional change.** S1's `hashPRD` refactor already makes this site
resolved-correct (it resolves inside `hashPRD`). Lookup hash = SHA-256(resolvePRD(absPath))
=== init hash = SHA-256(resolved) (idempotency guarantees identical bytes) ⇒ hashes MATCH
between init and lookup, exactly the work-item invariant. **S2's only contribution here is
JSDoc** documenting the resolved-content invariant (contract DOCS point). Do NOT refactor
to `resolvePRD`+`hashPRDContent` — `findSessionByPRD` needs only a hash (no snapshot), so a
single `hashPRD` call (one resolve) is already optimal; refactoring buys nothing.

### DeltaAnalysisWorkflow constructor — `src/workflows/delta-analysis-workflow.ts:62–100`
Receives `(oldPRD, newPRD, completedTasks: string[])`. After `handleDelta`'s L645 fix, both
strings are resolved. **No code change** to the constructor (it just stores strings). S2 adds
a brief JSDoc note on `oldPRD`/`newPRD` stating they MUST be the resolved (include-expanded)
document (PRD §2.3) — so future callers don't pass raw entry-file content.

## 2. The two real bug sites (resolved-vs-RAW diffs)

Only TWO places diff resolved-vs-RAW today; both are in the delta path:
1. `createDeltaSession` L637 `diffPRDs(oldPRD=resolved, newPRD=RAW)`.
2. `handleDelta` L666 `DeltaAnalysisWorkflow(oldPRD=resolved, newPRD=RAW)`.

Both fixed by resolving `newPRD`. There is no third diff site.

## 3. Unit-test cascade (transformation patterns)

### 3a. `tests/unit/core/session-manager.test.ts` — `createDeltaSession` block (L833–1260)

After S1, the `session-utils` boundary mock factory (L46) already exports
`resolvePRD`/`hashPRDContent`/`snapshotPRD` (S1 added them for `initialize`), and the consts
`mockResolvePRD`/`mockHashPRDContent` exist (S1 declared them). S2 REUSES them — do NOT
re-declare.

EVERY `createDeltaSession` test follows one of two patterns; apply the matching transform:

**Pattern A — "hash new PRD" / "compare hash" tests (assert the hash path):**
```ts
// BEFORE (each test's SETUP for the createDeltaSession call):
mockHashPRD.mockResolvedValueOnce(newHash);            // createDeltaSession's hash
mockReadFile.mockResolvedValue('# New PRD');           // createDeltaSession's newPRD read
…
await manager.createDeltaSession('/new/PRD.md');
expect(mockHashPRD).toHaveBeenCalledWith('/new/PRD.md');

// AFTER:
mockResolvePRD.mockResolvedValueOnce('# New PRD');     // createDeltaSession's resolve (feeds hash+diff+snapshot)
mockHashPRDContent.mockReturnValueOnce(newHash);       // createDeltaSession's hash of resolved
…
await manager.createDeltaSession('/new/PRD.md');
expect(mockResolvePRD).toHaveBeenCalledWith('/new/PRD.md');
expect(mockHashPRDContent).toHaveBeenCalledWith('# New PRD');
expect(mockHashPRD).not.toHaveBeenCalledWith('/new/PRD.md'); // createDeltaSession no longer calls hashPRD
```
NOTE: `initialize()` is ALSO mocked in these tests' SETUP. After S1, `initialize` uses
`mockResolvePRD`+`mockHashPRDContent` (NOT `mockHashPRD`). The shared `mockHashPRD.mockResolvedValue(MOCK_FULL_HASH)`
lines that fed `initialize` must become `mockResolvePRD.mockResolvedValue('# Old PRD')` +
`mockHashPRDContent.mockReturnValue(MOCK_FULL_HASH)`. (S1 may have already adjusted the
shared beforeEach; verify each test's SETUP resolves cleanly — `mockResolvedValueOnce` vs
`mockResolvedValue` ordering matters when `initialize` AND `createDeltaSession` both call
`resolvePRD`. Prefer `mockResolvedValue` for the initialize baseline and `mockResolvedValueOnce`
for the createDeltaSession-specific resolved content, OR use `mockImplementation` keyed on path.)

**Pattern B — `createSessionDirectory` call-arg assertions (L1028, L1264, L1270, L1276, L1349):**
```ts
// BEFORE:
expect(mockCreateSessionDirectory).toHaveBeenCalledWith('/new/PRD.md', 2, resolve('plan'));
// AFTER (createDeltaSession now passes precomputedHash as the 4th arg):
expect(mockCreateSessionDirectory).toHaveBeenCalledWith('/new/PRD.md', 2, resolve('plan'), <fullHash>);
//   where <fullHash> is the mocked 64-hex hash this test set via mockHashPRDContent.mockReturnValueOnce.
// For toHaveBeenNthCalledWith(n, …) triplets (L1264–1276) add the 4th arg to ALL three calls.
```

**Pattern C — "read new PRD from file" / multi-resolution tests (mockReadFile sequences for newPRD):**
```ts
// BEFORE:
mockReadFile.mockResolvedValueOnce('# PRD v2').mockResolvedValueOnce('# PRD v3');
// AFTER (newPRD content now comes from resolvePRD, not readFile):
mockResolvePRD.mockResolvedValueOnce('# PRD v2').mockResolvedValueOnce('# PRD v3');
//   (any mockReadFile that fed the createDeltaSession newPRD read is removed/repurposed)
```
GOTCHA: `mockReadFile` is STILL used by other paths (e.g. `loadSession` snapshot read, parent_session.txt).
Only the mockReadFile calls that fed the createDeltaSession L634 newPRD read are repurposed to
mockResolvePRD. Read each test before editing — do not blanket-replace mockReadFile.

### 3b. `tests/unit/workflows/prp-pipeline.test.ts` — handleDelta
`handleDelta` is exercised only via `vi.spyOn(pipeline, 'handleDelta')` (L948/L973) — i.e. it is
**mocked, not executed**, in the unit suite. There is NO unit test that drives the real
`handleDelta` body (its `readFile`/`resolvePRD` call). So S2's `readFile→resolvePRD` change in
`handleDelta` has **no direct unit-test break**. (Coverage of the real `handleDelta` body lives in
the integration/e2e delta suites — §3c.) The mock list in this file does NOT mock `session-utils`,
so importing `resolvePRD` there is fine; just ensure `handleDelta`'s spy tests stay green.

### 3c. Integration / e2e delta suites (real filesystem — must stay green)
- `tests/integration/core/delta-session.test.ts`, `tests/integration/delta-prd-generation.test.ts`,
  `tests/integration/delta-resume-regeneration.test.ts`, `tests/e2e/delta.test.ts`.
- These use REAL tmpdirs + REAL `resolvePRD`/`readFile`. For directive-free PRDs `resolvePRD` is a
  no-op ⇒ bytes identical ⇒ these pass UNCHANGED. They are the end-to-end safety net (mirrors how
  S1's `session-hash-detection.test.ts` proves the hash path). Do NOT add `@`-directives to their
  fixtures (would change bytes).

## 4. Unused-import gotcha in prp-pipeline.ts
`readFile` is imported top-level at L26 and used ONLY at L646 (the `handleDelta` newPRD read). The
L803 `const { readFile } = await import('node:fs/promises')` is a SEPARATE dynamic binding inside a
function (reads tasks.json) — leave it. After replacing L646 with `resolvePRD`, the top-level
`readFile` import (L26) becomes UNUSED → eslint `no-unused-vars`/`@typescript-eslint/no-unused-vars`
ERROR. **Remove the L26 import** (add `import { resolvePRD } from '../core/session-utils.js';`).

## 5. Parallel-execution / file-disjoint check vs S1
- S1 edits: `session-utils.ts` (hashPRDContent/hashPRD/createSessionDirectory/snapshotPRD),
  `session-manager.ts` `initialize()` + imports, `session-manager.test.ts` mock-factory + initialize
  block, `docs/ARCHITECTURE.md`.
- S2 edits: `session-manager.ts` `createDeltaSession()` + `findSessionByPRD` JSDoc (reuses S1's
  imports — does NOT re-add resolvePRD/hashPRDContent), `prp-pipeline.ts` `handleDelta()` + import,
  `delta-analysis-workflow.ts` constructor JSDoc, `session-manager.test.ts` createDeltaSession block.
- **Shared file: `session-manager.ts`** — S1 edits `initialize()` (L277–510) + the import line;
  S2 edits `createDeltaSession()` (L610–680) + adds JSDoc to `findSessionByPRD` (L1360). DISJOINT
  methods. The import line: S1 ADDS resolvePRD/hashPRDContent/snapshotPRD; S2 CONSUMES them (no edit).
- **Shared file: `session-manager.test.ts`** — S1 edits mock-factory (L46) + initialize block (L436–640);
  S2 edits createDeltaSession block (L833–1260) + findSessionByPRD block (L2151+, JSDoc-only ⇒ no test
  change). DISJOINT describe blocks. S1 < S2 ordering ⇒ S1 lands first; S2 reuses the mock-factory
  additions and consts.
- **S1 dependency (must-have-before-S2):** `hashPRDContent` export + `createSessionDirectory`
  `precomputedHash?` 4th param + `resolvePRD`/`hashPRDContent`/`snapshotPRD` added to
  session-manager.ts imports AND to the session-manager.test.ts mock factory + consts. S2 assumes
  all of this is merged.