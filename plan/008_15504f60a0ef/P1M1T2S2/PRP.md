# PRP — P1.M1.T2.S2: Wire resolver through `createDeltaSession`, `findSessionByPRD`, and the delta workflow

> Consumes S1's LANDED outputs: `hashPRDContent(resolved)` (pure), the resolve-aware `hashPRD(prdPath)`,
> `createSessionDirectory(…, precomputedHash?)` (4th optional arg), and the `resolvePRD`/`hashPRDContent`
> imports already added to `session-manager.ts` + the `session-manager.test.ts` mock factory. Threads
> `resolvePRD` into the two real resolved-vs-RAW diff sites in the delta path (`createDeltaSession`
> and `handleDelta`), verifies `findSessionByPRD` is already resolved-correct via S1's `hashPRD`
> refactor (no functional change — JSDoc only), and adds a resolved-content JSDoc note to the
> `DeltaAnalysisWorkflow` constructor. PRD §2.3 "Single canonical document downstream" + §4.3 delta
> detection now hold end-to-end across init → lookup → delta.

---

## Goal

**Feature Goal**: Make every hash, diff, and in-memory-snapshot operation in the **delta path** run
over the **fully-resolved, include-expanded PRD document** (PRD §2.3 / §4.3). Today two sites diff
**resolved-vs-RAW**: `createDeltaSession` (`session-manager.ts`) hashes correctly (S1) but reads RAW
`readFile` for its diff + stores RAW `newPRD` as the in-memory `prdSnapshot`; `handleDelta`
(`prp-pipeline.ts`) reads RAW `readFile` for the new PRD and feeds a resolved-vs-RAW pair to
`DeltaAnalysisWorkflow`. Resolve `newPRD` once at each site and thread the resolved string through
hash + diff + in-memory snapshot.

**Deliverable**:
1. **`src/core/session-manager.ts`** — EDIT `createDeltaSession()` (L610–680) ONLY: resolve `newPRD`
   once via `resolvePRD`, hash via `hashPRDContent`, feed the resolved string to `diffPRDs` + the
   in-memory `prdSnapshot`/`newPRD` fields, and pass the hash to `createSessionDirectory` as
   `precomputedHash` (4th arg). ADD resolved-content-invariant JSDoc to `findSessionByPRD` (L1360,
   no functional change — S1's `hashPRD` refactor already makes it resolved-correct).
2. **`src/workflows/prp-pipeline.ts`** — EDIT `handleDelta()` (L627–689) ONLY: replace the RAW
   `readFile(prdPath,'utf-8')` (L646) with `resolvePRD(prdPath)` so `DeltaAnalysisWorkflow` receives
   resolved-vs-resolved. Swap the top-level `readFile` import (L26) for `resolvePRD` from
   `session-utils.js`.
3. **`src/workflows/delta-analysis-workflow.ts`** — EDIT (JSDoc only): note on the constructor
   `oldPRD`/`newPRD` params that they MUST be the resolved (include-expanded) document (PRD §2.3).
4. **`tests/unit/core/session-manager.test.ts`** — EDIT (cascade): rewire the `createDeltaSession`
   block (L833–1260) from `mockHashPRD`/`mockReadFile` to `mockResolvePRD`/`mockHashPRDContent`, and
   add the 4th `precomputedHash` arg to the `createSessionDirectory` call-arg assertions. Reuse the
   `mockResolvePRD`/`mockHashPRDContent` consts S1 declared.
5. **Docs (Mode A)** — JSDoc on `createDeltaSession` and `findSessionByPRD` noting the
   resolved-content invariant (rides WITH the work per the contract DOCS point).

**Success Definition**:
- `createDeltaSession()` resolves `newPRD` **exactly once**; `hashPRDContent(resolved)`,
  `diffPRDs(oldPRD, resolved)`, the in-memory `prdSnapshot`/`newPRD`, and
  `createSessionDirectory(…, precomputedHash)` all consume the SAME resolved string.
- `handleDelta()` reads `newPRD` via `resolvePRD`; `DeltaAnalysisWorkflow(oldPRD, newPRD)` receives
  **resolved-vs-resolved** (oldPRD already resolved from the snapshot).
- `findSessionByPRD` hashes via S1's resolve-aware `hashPRD` ⇒ lookup hash matches init hash
  (documented in JSDoc; no functional change).
- For a directive-free PRD, behavior is byte-identical to before (`resolvePRD` is a no-op on content
  with no `@tokens`) — the integration/e2e delta suites pass **unchanged**.
- `npm run typecheck && npm run lint && npm run format:check` clean; `npm run test:run` green (incl.
  the rewired `createDeltaSession` block); touched source lines at 100% coverage.

---

## Why

- **PRD §2.3 / §4.3 mandate resolved content for delta detection.** "Hashing (§4.3 delta detection),
  `prd_snapshot.md` writes, delta-PRD inputs … all operate over the fully-resolved, include-expanded
  document." S1 made init + the standalone `hashPRD` resolved-correct; S2 closes the loop on the two
  diff sites that still read RAW. Without S2, a multi-file PRD's delta analysis compares an expanded
  old PRD against an unexpanded new PRD → false/missed diffs.
- **Idempotency (S3) is what makes independent per-site resolution safe.** `handleDelta` and
  `createDeltaSession` each resolve `newPRD` independently (different components; threading one string
  across the pipeline→manager boundary would be more invasive and isn't required by the contract).
  Because `resolvePRD(resolvePRD(x)) === resolvePRD(x)` (S3-verified), the two resolutions yield
  identical bytes — no divergence, and each site's hash/diff stay self-consistent.
- **Mirrors S1's "resolve once" architecture.** S1 added `createSessionDirectory`'s `precomputedHash`
  4th param precisely so a caller that already resolved+hashed (like `createDeltaSession`) can skip
  re-resolution. S2 uses it, collapsing createDeltaSession's 3 internal resolutions to 1.
- **`findSessionByPRD` needs no code change.** S1's `hashPRD` refactor already resolves inside, so
  the static lookup hash = SHA-256(resolvePRD(path)) === init hash = SHA-256(resolved). The
  work-item invariant ("resolved hashes must match between init and lookup") is ALREADY satisfied; S2
  only documents it (JSDoc). This resolves the apparent tension with S1's "no edit needed" handoff.
- **Unblocks P1.M1.T2.S3** (agent guidance text stating the PRD is pre-merged), which assumes every
  downstream consumer — including the delta path — already sees resolved content.
- **Out of scope (hard boundary):** editing `resolvePRD`/`expandIncludesRecursive`/`ResolveOpts`
  (S2/S3's resolver code), `initialize()`/`hashPRD`/`snapshotPRD` (S1's landed work), writing a NEW
  `prd_snapshot.md` for the delta session (the current `createDeltaSession` sets an in-memory
  `prdSnapshot` only — pre-existing behavior, not in this contract), the PRD validator (L312, reads
  RAW — future work), mdsel/section indexing (P1.M2), full docs framing (P6).

---

## What

### User-visible behavior
None at the CLI surface. Indirectly: a multi-file PRD (with `@docs/x.md` includes) now produces
correct delta analysis (expanded-vs-expanded) and a stable delta session hash, regardless of how the
includes are split across files. A monolithic/directive-free PRD behaves byte-identically to before.

### Technical requirements (exact contract)

**File 1 — `src/core/session-manager.ts`** — `createDeltaSession()` (L610–680) + `findSessionByPRD` JSDoc.

`createDeltaSession` rewrite of the hash+read+diff cluster (L624–648). Reuses `resolvePRD`/
`hashPRDContent` already imported by S1 — do NOT re-add them. Keep `hashPRD` imported (still used by
`findSessionByPRD`):
```ts
// BEFORE (L624–648):
const newHash = await hashPRD(newPRDPath);
const sessionHash = newHash.slice(0, 12);
const oldPRD = this.#currentSession.prdSnapshot;
const newPRD = await readFile(absPath, 'utf-8');
const diffResult = diffPRDs(oldPRD, newPRD);
…
const sessionPath = await createSessionDirectory(newPRDPath, newSeq, this.planDir);

// AFTER:
// Resolve the new PRD ONCE (PRD §2.3): the resolved document feeds hash + diff + in-memory snapshot.
const newPRD = await resolvePRD(newPRDPath);
const newHash = hashPRDContent(newPRD);          // pure hash of the resolved bytes (was hashPRD)
const sessionHash = newHash.slice(0, 12);
const oldPRD = this.#currentSession.prdSnapshot; // already resolved (S1's initialize writes resolved)
const diffResult = diffPRDs(oldPRD, newPRD);     // resolved-vs-resolved
…
// Pass the already-computed hash so createSessionDirectory does NOT re-resolve/re-hash (S1's 4th param):
const sessionPath = await createSessionDirectory(newPRDPath, newSeq, this.planDir, newHash);
```
The in-memory `prdSnapshot: newPRD` (L668) and `oldPRD, newPRD` (L672) now hold **resolved** content
automatically (they reference the same `newPRD` const). Remove the now-unused `readFile`-for-newPRD
read at L634. KEEP the L625–628 `stat(absPath)` existence check. KEEP the `parent_session.txt` write.

`findSessionByPRD` (L1360–1389): **JSDoc only.** Add a `@remarks` line stating the resolved-content
invariant — the hash is computed over the fully-resolved, include-expanded document via the resolve-
aware `hashPRD` (PRD §2.3 / §4.3), so a lookup hash matches the init hash. Do NOT change the body
(`await hashPRD(absPath)` is already resolved-correct after S1).

**File 2 — `src/workflows/prp-pipeline.ts`** — `handleDelta()` (L627–689) + import swap.
```ts
// Imports: REMOVE `import { readFile } from 'node:fs/promises';` (L26 — now unused; see Gotchas).
//          ADD  `import { resolvePRD } from '../core/session-utils.js';`

// handleDelta L645–651 BEFORE:
try {
  newPRD = await readFile(this.sessionManager.prdPath, 'utf-8');
} catch (error) {
  throw new Error(`Failed to load new PRD from ${this.sessionManager.prdPath}: ${error}`);
}
// AFTER:
try {
  newPRD = await resolvePRD(this.sessionManager.prdPath);   // resolved (PRD §2.3) — was RAW readFile
} catch (error) {
  throw new Error(`Failed to load new PRD from ${this.sessionManager.prdPath}: ${error}`);
}
```
`oldPRD` (L638, `currentSession.prdSnapshot`) stays — already resolved. `DeltaAnalysisWorkflow(oldPRD,
newPRD, …)` (L666) now receives resolved-vs-resolved. KEEP the `createDeltaSession` call (L686),
`patchBacklog`, and `saveBacklog` steps unchanged.

**File 3 — `src/workflows/delta-analysis-workflow.ts`** — constructor JSDoc only (no code change).
Add to the `@param oldPRD`/`@param newPRD` docs that each MUST be the fully-resolved, include-expanded
PRD document (PRD §2.3) — callers (`handleDelta`) resolve before constructing; agents must not chase
includes themselves.

### Success Criteria
- [ ] `createDeltaSession()` calls `resolvePRD(newPRDPath)` **exactly once**; `hashPRDContent`,
      `diffPRDs`, in-memory `prdSnapshot`/`newPRD`, and `createSessionDirectory(…, newHash)` consume
      the same resolved string.
- [ ] `createDeltaSession()` no longer calls `readFile` for the new PRD (the RAW diff read is gone).
- [ ] `handleDelta()` reads `newPRD` via `resolvePRD`; `DeltaAnalysisWorkflow` receives
      resolved-vs-resolved.
- [ ] `findSessionByPRD` hashes via the resolve-aware `hashPRD` (unchanged body); JSDoc documents the
      resolved-content invariant.
- [ ] `DeltaAnalysisWorkflow` constructor JSDoc states the resolved-document requirement.
- [ ] For directive-free PRDs, the integration/e2e delta suites pass **unchanged** (resolvePRD no-op).
- [ ] `npm run typecheck && npm run lint && npm run format:check` clean; `npm run test:run` green.

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_ **Yes** — exact
before/after for every edit with verified line numbers, the two real diff sites isolated, the
`findSessionByPRD` no-op+JSDoc finding (resolving the S1-tension), the full `createDeltaSession`
test-cascade with before/after transformation patterns (3 patterns), the unused-import gotcha, the
parallel-execution file-disjoint proof vs S1, and executable validation commands.

### Documentation & References
```yaml
# MUST READ — the S1 contract this consumes
- file: plan/008_15504f60a0ef/P1M1T2S1/PRP.md
  why: Defines hashPRDContent(resolved) (pure), the resolve-aware hashPRD(prdPath), createSessionDirectory
        (…, precomputedHash?) (4th optional param), and the resolvePRD/hashPRDContent imports S1 ADDS to
        session-manager.ts AND to the session-manager.test.ts mock factory + the mockResolvePRD/
        mockHashPRDContent consts. S2 REUSES all of these — do NOT re-add/re-declare.
  critical: S1 < S2 ordering; assume S1 is merged. S2's createDeltaSession uses the imports/consts S1 added.

# MUST READ — S2/S3 resolver (LANDED at session-utils.ts:493): resolvePRD(prdPath, opts?) → resolved string
- file: plan/008_15504f60a0ef/P1M1T1S2/PRP.md
  why: resolvePRD signature + that it reads via readUTF8FileStrict (Buffer + fatal TextDecoder), NOT
        readFile(path,'utf-8'). Idempotent (S3): resolvePRD(resolvePRD(x)) === resolvePRD(x) — this is why
        handleDelta + createDeltaSession resolving independently is safe.
  critical: Call resolvePRD(prdPath) with NO opts in both sites (default markers/depth from env). Do NOT
        edit resolvePRD's body.

# THIS subtask's research (call-site inventory + test cascade + S1 disjoint proof)
- docfile: plan/008_15504f60a0ef/P1M1T2S2/research/delta-resolve-threading.md
  section: "1. Call-site inventory", "2. The two real bug sites", "3. Unit-test cascade", "5. Parallel-execution check"
  why: Verified line numbers for createDeltaSession/handleDelta/findSessionByPRD, the resolve-once-per-site
        design, the findSessionByPRD no-op+JSDoc decision, and the EXACT before/after test transforms.

# MUST READ — PRD spec (also inline in this PRP's <selected_prd_content>)
- docfile: PRD.md
  section: "§2.3 Distributed (Multi-File) PRDs" (Idempotency + Single canonical document downstream) and
           "§4.3 The Delta Workflow" step 1 (hash mismatch computed from prd_snapshot.md content).
  why: Authoritative invariant. Delta detection + delta-PRD inputs operate over the resolved document.

# PATTERN FILES
- file: src/core/session-manager.ts
  why: createDeltaSession L610–680 (EDIT body), findSessionByPRD L1360–1389 (JSDoc only). Imports L37–43
        already include resolvePRD/hashPRDContent (S1 added them) — CONSUME, do not re-add. hashPRD stays
        (findSessionByPRD uses it). readFile is imported from node:fs/promises (top of file) — after the
        edit, is it still used elsewhere in session-manager.ts? (loadSession@561 reads prd_snapshot.md via
        readFile — YES, keep the readFile import here; it's NOT unused in this file.)
  pattern: "const oldPRD = this.#currentSession.prdSnapshot; const newPRD = await readFile(absPath,'utf-8');"
  gotcha: Only PRP-Pipeline's readFile import goes unused — session-manager's readFile import stays.

- file: src/workflows/prp-pipeline.ts
  why: handleDelta L627–689 (EDIT L645 readFile → resolvePRD). Top-level readFile import L26 becomes UNUSED
        (L646 was its only use) — REMOVE it, ADD resolvePRD import. The L803 dynamic `const { readFile } =
        await import('node:fs/promises')` is a SEPARATE binding (tasks.json) — LEAVE it.
  gotcha: handleDelta is exercised in the unit suite only via vi.spyOn (mocked, not run) — so no direct
          unit-test break from this edit; coverage of the real body is in the integration/e2e delta suites.

- file: src/workflows/delta-analysis-workflow.ts
  why: Constructor L62–100 — JSDoc only on oldPRD/newPRD params (resolved-document requirement). NO code
        change (it stores strings; correctness comes from handleDelta passing resolved strings).

- file: tests/unit/core/session-manager.test.ts
  why: createDeltaSession block L833–1260 (REWIRE cascade). Mock factory L46 + consts mockResolvePRD/
        mockHashPRDContent ALREADY exist (S1). Apply the 3 transform patterns (§3 of the research).
  pattern: "mockHashPRD.mockResolvedValueOnce(newHash) → mockResolvePRD.mockResolvedValueOnce(<resolved>) + mockHashPRDContent.mockReturnValueOnce(newHash)"
  gotcha: Each createDeltaSession test also calls manager.initialize() in SETUP — after S1, initialize
          uses mockResolvePRD/mockHashPRDContent (NOT mockHashPRD). Align each test's SETUP. Mind
          mockResolvedValue vs mockResolvedValueOnce ordering when BOTH initialize and createDeltaSession
          call resolvePRD.

- file: tests/integration/core/delta-session.test.ts (+ delta-prd-generation, delta-resume-regeneration, e2e/delta)
  why: REAL-tmpdir + REAL resolvePRD. Directive-free fixtures ⇒ resolvePRD no-op ⇒ bytes identical ⇒
        THESE PASS UNCHANGED. They are the end-to-end safety net for the delta path.
  gotcha: Do NOT add @-directives to their fixtures. Leave them entirely alone.
```

### Current Codebase tree (relevant slice)
```bash
src/core/
├── session-manager.ts        # EDIT: createDeltaSession() (resolve once) + findSessionByPRD JSDoc
└── session-utils.ts          # CONSUME (resolvePRD@493, hashPRDContent, createSessionDirectory.precomputedHash — all S1)
src/workflows/
├── prp-pipeline.ts           # EDIT: handleDelta() (readFile → resolvePRD) + import swap
└── delta-analysis-workflow.ts# EDIT (JSDoc only): constructor resolved-document note
tests/unit/core/
└── session-manager.test.ts   # EDIT: rewire createDeltaSession block (mockHashPRD→mockResolvePRD+mockHashPRDContent)
tests/integration/core/ + tests/e2e/
└── delta-*.test.ts           # UNCHANGED (real tmpdir, directive-free → resolvePRD no-op)
```

### Desired Codebase tree with files to be added/edited
```bash
src/core/session-manager.ts              # MODIFIED (createDeltaSession body + findSessionByPRD JSDoc)
src/workflows/prp-pipeline.ts            # MODIFIED (handleDelta + import swap)
src/workflows/delta-analysis-workflow.ts # MODIFIED (constructor JSDoc only)
tests/unit/core/session-manager.test.ts  # MODIFIED (createDeltaSession block cascade)
```

### Known Gotchas of our codebase & Library Quirks
```ts
// CRITICAL — S1 < S2 ordering. S1 ADDS resolvePRD/hashPRDContent to session-manager.ts imports AND to the
//   session-manager.test.ts mock factory + declares mockResolvePRD/mockHashPRDContent consts. S2 CONSUMES
//   them — do NOT re-add imports or re-declare consts (duplicate-declaration / unused-import lint errors).

// CRITICAL — findSessionByPRD needs NO functional change. S1's hashPRD refactor already resolves inside,
//   so its hash = SHA-256(resolvePRD(path)) === init hash. The work-item invariant is ALREADY satisfied.
//   S2's only contribution there is JSDoc. Do NOT refactor it to resolvePRD+hashPRDContent (it needs only
//   a hash; one hashPRD call = one resolve = optimal). (See research §1 + §5.)

// CRITICAL — the private #findSessionByHash(hash)@248 is a DIFFERENT method: it takes a PRECOMPUTED hash
//   and never hashes (initialize@360 passes the S1-computed sessionHash). Do NOT touch it. The work item's
//   "findSessionByHash @ 1383" refers to the static findSessionByPRD@1360.

// CRITICAL — resolve once PER SITE, not once globally. handleDelta and createDeltaSession each call
//   resolvePRD independently (different components). Idempotency (S3) guarantees identical bytes. Do NOT
//   try to thread one resolved string across the pipeline→manager boundary (out of scope, more invasive).

// CRITICAL — prp-pipeline.ts: the top-level `import { readFile } from 'node:fs/promises'` (L26) becomes
//   UNUSED after the handleDelta edit (L646 was its only use). REMOVE it and ADD resolvePRD import. The
//   L803 dynamic `const { readFile } = await import('node:fs/promises')` is a SEPARATE binding — LEAVE it.
//   (session-manager.ts's readFile import STAYS — loadSession@561 still reads prd_snapshot.md with it.)

// CRITICAL — pass newHash as createSessionDirectory's 4th arg (precomputedHash) in createDeltaSession so
//   it does NOT re-resolve/re-hash (single-resolution design, mirrors S1's initialize). The createDeltaSession
//   tests that assert mockCreateSessionDirectory call args (L1028, L1264, L1270, L1276, L1349) MUST gain the
//   4th arg (the mocked full hash). See research §3a Pattern B.

// GOTCHA — handleDelta is exercised in the unit suite ONLY via vi.spyOn (mocked) — no direct unit-test
//   break from the readFile→resolvePRD edit. Real-body coverage is the integration/e2e delta suites (real
//   tmpdir; directive-free ⇒ resolvePRD no-op ⇒ pass unchanged).

// GOTCHA — createDeltaSession test SETUP: each test calls manager.initialize() which, after S1, uses
//   mockResolvePRD+mockHashPRDContent (NOT mockHashPRD). Align every createDeltaSession test's SETUP. Mind
//   mockResolvedValue (baseline for initialize) vs mockResolvedValueOnce (createDeltaSession-specific)
//   ordering since BOTH call resolvePRD.

// GOTCHA — 100% coverage is globally enforced (vitest.config.ts). createDeltaSession's new branches
//   (none added — resolvePRD/hashPRDContent are straight-line calls; precomputedHash is always supplied)
//   are covered by the rewired tests. findSessionByPRD/handleDelta/DeltaAnalysisWorkflow have no new
//   branches (JSDoc-only edits). If coverage drops, ensure a createDeltaSession test still exercises the
//   full method (resolve + hash + diff + createSessionDirectory + parent_session write).

// GOTCHA — prettier is ERROR-enforced. Run `npm run fix` (lint:fix + prettier --write) before format:check.

// CRITICAL — DO NOT write a NEW prd_snapshot.md file in createDeltaSession. The current code sets an
//   in-memory prdSnapshot only (no disk write); the contract is silent on a disk write. Making the in-memory
//   prdSnapshot resolved (which S2 does) is the "snapshot threading" S1 handed off. A delta-snapshot disk
//   write is a pre-existing gap, out of scope. Do NOT add snapshotPRD to createDeltaSession.
```

---

## Implementation Blueprint

### Data models and structure
No new data models or signatures. S2 reuses S1's landed primitives:
```ts
// src/core/session-utils.ts (S1 — CONSUME, do not edit)
export function hashPRDContent(resolved: string): string;
export async function resolvePRD(prdPath: string, opts?: ResolveOpts): Promise<string>;
export async function createSessionDirectory(prdPath, sequence, planDir?, precomputedHash?): Promise<string>;
// No signature changes in S2's files (createDeltaSession/handleDelta keep their signatures).
```

### Implementation Tasks (ordered by dependencies — implicit TDD: RED first, then GREEN)
```yaml
Task 1: EDIT tests/unit/core/session-manager.test.ts   (RED — rewire createDeltaSession block)
  - REUSE the mockResolvePRD/mockHashPRDContent consts S1 declared (do NOT re-declare). If S1 named them
    differently, use S1's names.
  - For EACH createDeltaSession test (L833–1260) apply research §3a:
      * Pattern A (hash-path tests, e.g. L895 'should hash new PRD', L943 'compare hash'):
          mockHashPRD.mockResolvedValueOnce(newHash)  →  mockResolvePRD.mockResolvedValueOnce(<resolved newPRD>)
                                                        + mockHashPRDContent.mockReturnValueOnce(newHash)
          expect(mockHashPRD).toHaveBeenCalledWith('/new/PRD.md')
            → expect(mockResolvePRD).toHaveBeenCalledWith('/new/PRD.md')
              + expect(mockHashPRDContent).toHaveBeenCalledWith(<resolved newPRD>)
      * Pattern B (createSessionDirectory call-arg assertions L1028/L1264/L1270/L1276/L1349):
          add the 4th arg = the mocked full hash (e.g. MOCK_FULL_HASH or the test's newHash).
      * Pattern C (newPRD-content tests, e.g. L998 'read new PRD from file', L1260 multi-resolution):
          mockReadFile.mockResolvedValueOnce('# New PRD')  →  mockResolvePRD.mockResolvedValueOnce('# New PRD')
          (only the mockReadFile calls that fed the createDeltaSession L634 newPRD read; leave other
           mockReadFile calls — e.g. loadSession snapshot reads — intact).
  - ALIGN each test's initialize() SETUP to S1's contract (mockResolvePRD+mockHashPRDContent for initialize,
    NOT mockHashPRD). Mind mockResolvedValue vs mockResolvedValueOnce ordering.
  - KEEP the findSessionByPRD block (L2151+) UNCHANGED — S2 adds JSDoc only to the source; no behavior change.
  - EXPECTED NOW: createDeltaSession tests fail (real createDeltaSession still calls hashPRD/readFile) → RED.

Task 2: EDIT src/core/session-manager.ts   (GREEN — createDeltaSession resolve-once + findSessionByPRD JSDoc)
  - createDeltaSession L624–648: replace the hashPRD+readFile cluster with resolvePRD(newPRDPath) once →
        hashPRDContent(newPRD) → diffPRDs(oldPRD, newPRD) → createSessionDirectory(newPRDPath, newSeq,
        this.planDir, newHash). The in-memory prdSnapshot/newPRD fields now reference the resolved const.
        Remove the L634 readFile-for-newPRD. KEEP the L625–628 stat existence check + parent_session write.
  - findSessionByPRD L1360: ADD @remarks JSDoc (resolved-content invariant; lookup hash matches init hash
        via S1's resolve-aware hashPRD; cite PRD §2.3/§4.3). DO NOT change the body.
  - createDeltaSession: ADD a @remarks JSDoc line noting newPRD is resolved once and threads hash+diff+
        in-memory snapshot (resolved-content invariant, PRD §2.3).
  - Imports: CONSUME S1's resolvePRD/hashPRDContent (already imported). KEEP hashPRD (findSessionByPRD).
        KEEP readFile (loadSession@561 still uses it).
  - DO NOT touch initialize() (S1), #findSessionByHash@248, loadSession@560, or the validator@312.
  - EXPECTED: createDeltaSession tests turn GREEN.

Task 3: EDIT src/workflows/prp-pipeline.ts   (GREEN — handleDelta resolvePRD + import swap)
  - Imports: REMOVE `import { readFile } from 'node:fs/promises';` (L26); ADD
        `import { resolvePRD } from '../core/session-utils.js';`. (Verify readFile has no other top-level
        use — it doesn't; L803 is a separate dynamic binding.)
  - handleDelta L645: `readFile(this.sessionManager.prdPath,'utf-8')` → `resolvePRD(this.sessionManager.prdPath)`.
        KEEP the surrounding try/catch (wrap resolvePRD errors in the same `Failed to load new PRD from …`
        Error). oldPRD@638 stays (already resolved). DeltaAnalysisWorkflow@666 now resolved-vs-resolved.
  - DO NOT touch createDeltaSession@686, patchBacklog, saveBacklog, or any other method.
  - EXPECTED: no unit-test break (handleDelta is spied/mocked in prp-pipeline.test.ts); integration/e2e green.

Task 4: EDIT src/workflows/delta-analysis-workflow.ts   (JSDoc only)
  - Constructor @param oldPRD / @param newPRD: add "MUST be the fully-resolved, include-expanded PRD document
        (PRD §2.3). Callers resolve before constructing; agents must not chase includes themselves."
  - NO code change (the constructor stores strings; correctness comes from handleDelta).
  - EXPECTED: delta-analysis-workflow.test.ts constructor tests pass unchanged.

Task 5: FORMAT + VERIFY
  - RUN: npm run fix → npm run typecheck → npm run lint → npm run format:check.
  - RUN: npx vitest run tests/unit/core/session-manager.test.ts (createDeltaSession block GREEN; findSessionByPRD GREEN).
  - RUN: npx vitest run tests/unit/workflows/prp-pipeline.test.ts (handleDelta spy tests GREEN).
  - RUN: npx vitest run tests/unit/workflows/delta-analysis-workflow.test.ts (constructor tests GREEN).
  - RUN: npx vitest run tests/integration/core/delta-session.test.ts tests/integration/delta-prd-generation.test.ts
        tests/integration/delta-resume-regeneration.test.ts tests/e2e/delta.test.ts (UNCHANGED — real tmpdir).
  - RUN: npx vitest run tests/unit/core/session-hash-detection.test.ts tests/unit/core/prd-includes.test.ts
        tests/unit/core/prd-resolve.test.ts tests/unit/core/prd-markers.test.ts (S1/S2/S3 regression — green).
  - RUN: npm run test:run (full suite — no regression).
  - EXPECTED: all green; touched src lines at 100% coverage.
```

### Implementation Patterns & Key Details
```ts
// ---- src/core/session-manager.ts: createDeltaSession (resolve once, mirror initialize) ----
async createDeltaSession(newPRDPath: string): Promise<DeltaSession> {
  // … existence check (stat) unchanged …
  // Resolve the new PRD ONCE (PRD §2.3): hash + diff + in-memory snapshot all share this string.
  const newPRD = await resolvePRD(newPRDPath);
  const newHash = hashPRDContent(newPRD);
  const sessionHash = newHash.slice(0, 12);
  const oldPRD = this.#currentSession.prdSnapshot;          // already resolved (S1)
  const diffResult = diffPRDs(oldPRD, newPRD);              // resolved-vs-resolved
  // …
  const sessionPath = await createSessionDirectory(newPRDPath, newSeq, this.planDir, newHash); // precomputedHash
  // … parent_session.txt write unchanged …
  // … DeltaSession: prdSnapshot: newPRD (resolved), oldPRD, newPRD (resolved) …

// ---- src/core/session-manager.ts: findSessionByPRD (JSDoc only) ----
/**
 * …existing JSDoc…
 * @remarks The hash is computed over the FULLY-RESOLVED, include-expanded document via the resolve-aware
 *   {@link hashPRD} (PRD §2.3 / §4.3). Therefore a lookup hash matches the {@link SessionManager.initialize}
 *   hash for the same PRD — resolved-content consistency between init and lookup.
 */
static async findSessionByPRD(prdPath, planDir = resolve('plan')) { /* body UNCHANGED: await hashPRD(absPath) */ }

// ---- src/workflows/prp-pipeline.ts: handleDelta ----
// import swap: remove readFile; add `import { resolvePRD } from '../core/session-utils.js';`
try {
  newPRD = await resolvePRD(this.sessionManager.prdPath);   // resolved (PRD §2.3) — was RAW readFile
} catch (error) {
  throw new Error(`Failed to load new PRD from ${this.sessionManager.prdPath}: ${error}`);
}
// DeltaAnalysisWorkflow(oldPRD /*resolved*/, newPRD /*resolved*/, completedTaskIds)

// ---- tests/unit/core/session-manager.test.ts: createDeltaSession cascade (key transforms) ----
// BEFORE: mockHashPRD.mockResolvedValueOnce(newHash); mockReadFile.mockResolvedValue('# New PRD');
//   … expect(mockHashPRD).toHaveBeenCalledWith('/new/PRD.md');
// AFTER:  mockResolvePRD.mockResolvedValueOnce('# New PRD'); mockHashPRDContent.mockReturnValueOnce(newHash);
//   … expect(mockResolvePRD).toHaveBeenCalledWith('/new/PRD.md');
//        expect(mockHashPRDContent).toHaveBeenCalledWith('# New PRD');
// createSessionDirectory assertion: add 4th arg (the mocked full hash).
```

### Integration Points
```yaml
SESSION-MANAGER (src/core/session-manager.ts):
  - createDeltaSession(): resolve once (resolvePRD) → hashPRDContent → diffPRDs(resolved,resolved) →
        createSessionDirectory(…, precomputedHash) → in-memory prdSnapshot/newPRD = resolved
  - findSessionByPRD(): JSDoc only (body unchanged; hashPRD already resolves via S1)
  - imports: CONSUME S1's resolvePRD/hashPRDContent; KEEP hashPRD (findSessionByPRD) + readFile (loadSession)
  - DO NOT EDIT: initialize (S1), #findSessionByHash@248, loadSession@560, validator@312

PRP-PIPELINE (src/workflows/prp-pipeline.ts):
  - handleDelta(): readFile → resolvePRD (newPRD resolved); DeltaAnalysisWorkflow resolved-vs-resolved
  - imports: REMOVE top-level readFile (L26); ADD resolvePRD. KEEP L803 dynamic readFile (tasks.json)
  - DO NOT EDIT: createDeltaSession call, patchBacklog, saveBacklog, other methods

DELTA-ANALYSIS-WORKFLOW (src/workflows/delta-analysis-workflow.ts):
  - constructor JSDoc: oldPRD/newPRD MUST be resolved (PRD §2.3). No code change.

DOWNSTREAM (becomes correct via this subtask):
  - DeltaAnalysisWorkflow receives resolved-vs-resolved → accurate delta analysis for multi-file PRDs.
  - createDeltaSession's in-memory prdSnapshot is resolved → consistent with init's resolved snapshot.
  - P1.M1.T2.S3 (agent guidance text) assumes all downstream consumers see resolved content — S2 completes that for the delta path.

DOCS (Mode A — rides with the work):
  - JSDoc on createDeltaSession + findSessionByPRD (resolved-content invariant, cite PRD §2.3/§4.3).
  - JSDoc on DeltaAnalysisWorkflow constructor (resolved-document requirement).
  - (No docs/*.md edits here — comprehensive framing is P6.)
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
npm run fix                  # lint:fix + prettier --write (run first — JSDoc/edits may need it)
npm run typecheck            # tsc --noEmit -p tsconfig.build.json — clean
npm run lint                 # eslint . --ext .ts — clean (watch: unused readFile import in prp-pipeline.ts;
                            #   duplicate mockResolvePRD const in session-manager.test.ts if re-declared)
npm run format:check         # prettier --check — clean
# Expected: all clean. If lint flags an unused readFile import in prp-pipeline.ts, you forgot to remove L26.
```

### Level 2: Unit Tests (Component Validation)
```bash
# Directly affected (createDeltaSession block rewired):
npx vitest run tests/unit/core/session-manager.test.ts
# handleDelta is spied here (no direct body test) — must stay green:
npx vitest run tests/unit/workflows/prp-pipeline.test.ts
# DeltaAnalysisWorkflow constructor (JSDoc only) — unchanged:
npx vitest run tests/unit/workflows/delta-analysis-workflow.test.ts
# Full suite:
npm run test:run
# Coverage on touched source files:
npx vitest run tests/unit/core/session-manager.test.ts tests/integration/core/delta-session.test.ts --coverage
# Expected: all green. If session-manager.ts coverage <100%, ensure a createDeltaSession test still
# exercises resolve→hash→diff→createSessionDirectory→parent_session end-to-end.
```

### Level 3: Integration Testing (System Validation)
```bash
# REAL-tmpdir delta suites (must pass UNCHANGED — directive-free ⇒ resolvePRD no-op):
npx vitest run tests/integration/core/delta-session.test.ts
npx vitest run tests/integration/delta-prd-generation.test.ts
npx vitest run tests/integration/delta-resume-regeneration.test.ts
npx vitest run tests/e2e/delta.test.ts
# S1/S2/S3 regression (untouched — must stay green):
npx vitest run tests/unit/core/session-hash-detection.test.ts tests/unit/core/prd-includes.test.ts \
  tests/unit/core/prd-resolve.test.ts tests/unit/core/prd-markers.test.ts
# Build emits dist/ cleanly (proves the import swap + edits compile):
npx tsc -p tsconfig.build.json
# Expected: all green; build succeeds. These suites are the end-to-end proof that the delta path is
# resolved-correct without regressing directive-free PRDs.
```

### Level 4: Creative & Domain-Specific Validation
```bash
# No MCP/DB/HTTP. Domain checks (record in commit message):
#   1. Resolved-vs-resolved diffs: BOTH diff sites (createDeltaSession L637, handleDelta L666) now compare
#      resolved oldPRD vs resolved newPRD. A multi-file PRD's delta analysis is now correct.
#   2. Single resolution per site: createDeltaSession resolves newPRD once (resolvePRD) and threads it to
#      hashPRDContent + diffPRDs + in-memory snapshot + createSessionDirectory(precomputedHash). handleDelta
#      resolves newPRD once for DeltaAnalysisWorkflow. (Independent per-site; idempotency-safe.)
#   3. Init↔lookup hash parity: findSessionByPRD hashes via S1's resolve-aware hashPRD ⇒ lookup hash ===
#      init hash (SHA-256 of the same resolved bytes). Documented in JSDoc; no code change.
#   4. Directive-free parity: a PRD with no @tokens behaves identically (resolvePRD no-op) — proven by the
#      integration/e2e delta suites passing unchanged.
#   5. No new disk snapshot write: createDeltaSession's in-memory prdSnapshot is resolved (the "snapshot
#      threading" S1 handed off); no new prd_snapshot.md file write added (pre-existing gap, out of scope).
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` clean.
- [ ] `npm run lint` clean (no unused readFile in prp-pipeline.ts; no duplicate mock consts).
- [ ] `npm run format:check` clean.
- [ ] `npx vitest run tests/unit/core/session-manager.test.ts` green (createDeltaSession block rewired; findSessionByPRD green).
- [ ] `npx vitest run tests/unit/workflows/prp-pipeline.test.ts` green (handleDelta spy tests).
- [ ] `npx vitest run tests/unit/workflows/delta-analysis-workflow.test.ts` green (constructor tests unchanged).
- [ ] Integration/e2e delta suites green (UNCHANGED — real tmpdir, directive-free).
- [ ] `npm run test:run` (full suite) green — no regression (incl. S1/S2/S3 resolver suites).
- [ ] Touched lines in `session-manager.ts`, `prp-pipeline.ts`, `delta-analysis-workflow.ts` at 100% coverage.

### Feature Validation
- [ ] `createDeltaSession()` resolves `newPRD` **once**; `hashPRDContent`/`diffPRDs`/in-memory `prdSnapshot`/
      `newPRD`/`createSessionDirectory(…, newHash)` all consume the same resolved string.
- [ ] `createDeltaSession()` no longer calls `readFile` for the new PRD.
- [ ] `handleDelta()` reads `newPRD` via `resolvePRD`; `DeltaAnalysisWorkflow` receives resolved-vs-resolved.
- [ ] `findSessionByPRD` body unchanged; JSDoc documents the resolved-content invariant.
- [ ] `DeltaAnalysisWorkflow` constructor JSDoc states the resolved-document requirement.
- [ ] Directive-free PRDs behave byte-identically (integration/e2e delta suites unchanged).

### Code Quality Validation
- [ ] Consumes S1's `resolvePRD`/`hashPRDContent`/`precomputedHash` WITHOUT re-adding imports/consts.
- [ ] Mirrors S1's "resolve once" architecture (single resolution threaded to hash+diff+snapshot).
- [ ] Does NOT edit `resolvePRD`/`expandIncludesRecursive`/`ResolveOpts`, `initialize`, `hashPRD`/`hashPRDContent`,
      `snapshotPRD`, `#findSessionByHash`, `loadSession`, or the validator.
- [ ] No new disk snapshot write added (in-memory prdSnapshot resolved = the contract scope).
- [ ] Error wrapping preserved (`handleDelta`'s `Failed to load new PRD from …` around `resolvePRD`).

### Documentation & Deployment
- [ ] JSDoc on `createDeltaSession` + `findSessionByPRD` (resolved-content invariant; cite PRD §2.3/§4.3).
- [ ] JSDoc on `DeltaAnalysisWorkflow` constructor params (resolved-document requirement).
- [ ] Commit message notes: two resolved-vs-RAW diff sites fixed; resolve-once-per-site design;
      findSessionByPRD no-op+JSDoc (S1 already made it resolved-correct); the createDeltaSession test cascade;
      unused-import removal in prp-pipeline.ts.

---

## Anti-Patterns to Avoid

- ❌ Don't edit `resolvePRD`/`expandIncludesRecursive`/`ResolveOpts` — that's S1–T1's landed code. S2 only
      CALLS `resolvePRD(prdPath)` (no opts).
- ❌ Don't re-add `resolvePRD`/`hashPRDContent` to `session-manager.ts` imports or re-declare
      `mockResolvePRD`/`mockHashPRDContent` in the test — S1 already added them. CONSUME only.
- ❌ Don't change `findSessionByPRD`'s body — S1's resolve-aware `hashPRD` already makes it resolved-correct.
      S2 adds JSDoc ONLY. (Don't refactor it to resolvePRD+hashPRDContent — it needs only a hash.)
- ❌ Don't confuse `#findSessionByHash(hash)`@248 (private, takes a precomputed hash, never hashes) with the
      static `findSessionByPRD`@1360. The work item's "findSessionByHash @ 1383" is `findSessionByPRD`.
- ❌ Don't try to resolve `newPRD` once GLOBALLY across handleDelta+createDeltaSession — they're different
      components. Resolve once PER SITE; idempotency (S3) guarantees identical bytes.
- ❌ Don't omit `precomputedHash` (4th arg) when calling `createSessionDirectory` in `createDeltaSession` —
      S1 added that param for exactly this caller; passing it avoids a 2nd resolution. (And update the
      createSessionDirectory call-arg assertions in the tests accordingly.)
- ❌ Don't leave the top-level `readFile` import in `prp-pipeline.ts` after swapping L646 to `resolvePRD` —
      it becomes unused (lint error). Remove L26; add the `resolvePRD` import. (Leave the L803 dynamic
      `readFile` binding — it reads tasks.json.)
- ❌ Don't blanket-replace `mockReadFile` with `mockResolvePRD` in the createDeltaSession tests — only the
      `mockReadFile` calls that fed the L634 newPRD read are repurposed; other `mockReadFile` calls (e.g.
      `loadSession` snapshot reads) stay.
- ❌ Don't write a NEW `prd_snapshot.md` file in `createDeltaSession` — the contract scope is the in-memory
      `prdSnapshot` (now resolved). A delta-snapshot disk write is a pre-existing gap, out of scope.
- ❌ Don't touch `initialize()` (S1), `hashPRD`/`hashPRDContent`/`snapshotPRD` (S1), `loadSession`@560,
      `#findSessionByHash`@248, or the validator@312.
- ❌ Don't add `@`-directives to the integration/e2e delta-suite fixtures — they're directive-free by design
      (proves resolvePRD is a no-op there); changing them would break the safety net.
- ❌ Don't skip the failing-test-first (RED) step — rewire the createDeltaSession tests BEFORE editing the
      source so RED → GREEN is observable.

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: The change is a focused, cohesive threading of one landed primitive (`resolvePRD`) into two
isolated diff sites (`createDeltaSession` L634, `handleDelta` L646), plus JSDoc on two already-correct
sites (`findSessionByPRD`, `DeltaAnalysisWorkflow` constructor). The consumed inputs (`resolvePRD`,
`hashPRDContent`, `createSessionDirectory.precomputedHash`, the session-manager imports + test mock
consts) are all S1-landed and verified in-repo. The S1-tension (S1's "findSessionByHash no edit needed"
vs the work item's "route through resolvePRD") is fully resolved: S1's resolve-aware `hashPRD` already
satisfies the lookup invariant, so S2's `findSessionByPRD` work is JSDoc-only — no functional conflict.
The one non-trivial effort — the `createDeltaSession` unit-test cascade (~15 tests rewiring
`mockHashPRD`/`mockReadFile` → `mockResolvePRD`/`mockHashPRDContent` + 4th-arg `createSessionDirectory`
assertions) — is fully documented with three exact before/after transformation patterns and the
initialize-SETUP alignment note. The `handleDelta` edit has no direct unit-test break (it's spied/mocked
in the suite); the integration/e2e delta suites (real tmpdir, directive-free) are the end-to-end safety
net and pass unchanged. File-disjoint from S1 at the method/describe-block level; S1 < S2 ordering
guarantees S1's imports/mock-factory additions land first. Residual risks: (a) a prettier nit (auto-fixed
via `npm run fix`), (b) the `mockResolvedValue` vs `mockResolvedValueOnce` ordering when both `initialize`
and `createDeltaSession` call `resolvePRD` in one test (recipe provided), (c) coverage of the full
`createDeltaSession` path (covered by the rewired happy-path tests). No external/runtime unknowns.