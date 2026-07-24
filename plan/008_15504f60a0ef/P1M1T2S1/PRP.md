# PRP — P1.M1.T2.S1: Thread `resolvePRD` through `hashPRD`, `initialize`, and snapshot write

> Consumes S2's LANDED `resolvePRD` (session-utils.ts:495 — verified in-repo). Threads it through
> the hash + snapshot paths so PRD §2.3's "single canonical resolved document downstream" invariant
> holds: **hash and snapshot are computed over the SAME fully-resolved, include-expanded bytes,
> resolved exactly once per `initialize()`**. S3 (markers/idempotency, in-flight) is consumed as a
> contract; this subtask does NOT touch `resolvePRD`'s body. The `createDeltaSession`/`findSessionByHash`
> sites become resolved-correct automatically via the refactored `hashPRD` — their snapshot threading
> is P1.M1.T2.S2.

---

## Goal

**Feature Goal**: Make every hash and snapshot operation run over the **fully-resolved, include-expanded
PRD document** (PRD §2.3 / §4.1 step 2). Today `hashPRD` hashes the RAW entry file and `initialize()`
writes the snapshot from a *separate* RAW `readFile` — both wrong once `@`-includes exist, and able to
diverge. Add a pure `hashPRDContent(resolved)` primitive, refactor `hashPRD(prdPath)` to
resolve-then-hash, and rewrite `initialize()` to **resolve once** and feed that single resolved string
into **both** the hash and the snapshot (via a revived `snapshotPRD`).

**Deliverable**:
1. **`src/core/session-utils.ts`** — (a) NEW exported `hashPRDContent(resolved: string): string`
   (pure SHA-256); (b) REFACTOR `hashPRD(prdPath)` → `resolvePRD(prdPath)` then `hashPRDContent`;
   (c) `createSessionDirectory` gains an optional `precomputedHash?: string` 4th param; (d) `snapshotPRD`
   gains an optional `resolvedContent?: string` 3rd param (revives it as resolve-correct).
2. **`src/core/session-manager.ts`** — EDIT `initialize()` ONLY: resolve once, hash via
   `hashPRDContent`, write snapshot via `snapshotPRD(..., resolved)`, set `prdSnapshot: resolved`.
3. **`tests/unit/core/session-utils.test.ts`** — EDIT: rework the `hashPRD` happy-path → test
   `hashPRDContent` (pure); rework the `createSessionDirectory` block to pass `precomputedHash`.
4. **`tests/unit/core/session-manager.test.ts`** — EDIT: extend the `session-utils` mock with
   `resolvePRD`/`hashPRDContent`/`snapshotPRD`; update the `initialize` assertions accordingly.
5. **Docs (Mode A)** — brief resolved-document-invariant note in `docs/ARCHITECTURE.md`; JSDoc on
   `hashPRDContent`.

**Success Definition**:
- `initialize()` calls `resolvePRD` **exactly once**; the hash (`hashPRDContent`) and the snapshot
  (`snapshotPRD`) consume the **same** resolved string.
- `prd_snapshot.md` and `SessionState.prdSnapshot` hold the **resolved** document (includes expanded).
- `hashPRD(prdPath)` now hashes the **resolved** document for ALL callers (verified via the refactored
  body) — so `findSessionByHash` (static, L1383) and `createDeltaSession` (L624) are resolved-correct
  without further edits.
- For a directive-free PRD, behavior is byte-identical to before (`resolvePRD` is a no-op on content
  with no `@tokens`) — `session-hash-detection.test.ts` passes unchanged.
- `npm run typecheck && npm run lint && npm run format:check` clean; `npm run test:run` green (incl.
  the reworked blocks); touched source lines at 100% coverage.

---

## Why

- **PRD §2.3 mandates a single canonical resolved document downstream** for hashing (§4.1 step 2),
  `prd_snapshot.md` writes, delta detection (§4.3), and section indexing (§4.2). Today hash + snapshot
  run over RAW — silently wrong with includes. S1+S2+S3 built the resolver; T2.S1 is where it becomes
  *load-bearing* for the session lifecycle.
- **Idempotency (S3) is what makes this safe.** Because `resolvePRD(resolvePRD(x)) === resolvePRD(x)`,
  resolving once in `initialize()` and again inside the standalone `hashPRD` callers yields identical
  bytes — no divergence. T2.S1 relies on that guarantee (already S3-verified) rather than re-proving it.
- **Eliminates the RAW-read divergence + 2–4× resolution.** Currently the entry file is read for the
  hash, read again inside `createSessionDirectory`'s `hashPRD`, and read a third time for the snapshot
  (system_context.md §5). Threading one resolved string through all three collapses it to one
  `resolvePRD` call and guarantees hash===snapshot bytes.
- **Revives dead code.** `snapshotPRD()` (session-utils.ts:947) has zero callers today
  (system_context.md §6); `initialize()` has an inline `writeFile` instead. T2.S1 makes
  `snapshotPRD` the live resolve-correct path (contract item d), removing the divergence at the source.
- **Unblocks P1.M1.T2.S2.** S2 threads `resolvePRD` into `createDeltaSession`/`findSessionByHash`/delta
  workflow. T2.S1's `hashPRD` refactor means S2's two hash sites are already resolved-correct; S2 only
  needs to thread resolve into the *delta snapshot write*.
- **Out of scope (hard boundary):** editing `resolvePRD`/`expandIncludesRecursive`/`ResolveOpts` (S3's
  code), `createDeltaSession`/`findSessionByHash`/delta workflow (S2), the PRD validator (L312, still
  reads RAW — future work, NOT here), mdsel/section indexing (P1.M2), full docs framing (P6).

---

## What

### User-visible behavior
None at the CLI surface. Indirectly: a multi-file PRD (with `@docs/x.md` includes) now produces a
`prd_snapshot.md` containing the **expanded** content, and its session hash is stable regardless of
how the includes are split across files (only the merged document is hashed). A monolithic/directive-free
PRD behaves byte-identically to before.

### Technical requirements (exact contract)

**File 1 — `src/core/session-utils.ts`** (consume S2's landed `resolvePRD`; do NOT edit its body):

(a) NEW pure primitive — place directly above `hashPRD` (L243):
```ts
/**
 * Hash the fully-resolved PRD document (PRD §2.3 / §4.1 step 2).
 *
 * @remarks
 * Pure: no filesystem I/O. This is the canonical "hash a resolved document" primitive.
 * Callers that already hold resolved content (e.g. {@link SessionManager.initialize}, which resolves
 * once and feeds the SAME string to the hash AND the snapshot) use this directly to avoid a second
 * resolution. Callers with only a path use {@link hashPRD}, which resolves then delegates here.
 *
 * Hashing the RESOLVED (include-expanded) document — never the raw entry file — is what guarantees
 * hash/snapshot/delta consistency for distributed (multi-file) PRDs (PRD §2.3 "Single canonical
 * document downstream"). Idempotency of {@link resolvePRD} (S3) makes a single resolution safe.
 *
 * @param resolved - The fully include-expanded PRD document.
 * @returns 64-character lowercase-hex SHA-256 digest.
 */
export function hashPRDContent(resolved: string): string {
  const fullHash = createHash('sha256').update(resolved).digest('hex');
  logger().debug({ hash: fullHash.slice(0, 12), fullHashLength: fullHash.length }, 'Resolved PRD hash computed');
  return fullHash;
}
```

(b) REFACTOR `hashPRD(prdPath)` (L243) — keep signature + JSDoc intent, change body to resolve-then-hash:
```ts
export async function hashPRD(prdPath: string): Promise<string> {
  try {
    logger().debug({ prdPath, operation: 'hashPRD' }, 'Resolving + hashing PRD');
    const resolved = await resolvePRD(prdPath);     // ← NEW: expand includes first (PRD §2.3)
    return hashPRDContent(resolved);                 // delegate to the pure primitive
  } catch (error) {
    // PRESERVE existing error envelope: SessionFileError(prdPath, 'read PRD', cause)
    const err = error as NodeJS.ErrnoException;
    logger().error({ prdPath, errorCode: err?.code, errorMessage: err?.message, operation: 'hashPRD' }, 'Failed to resolve/hash PRD');
    if (error instanceof SessionFileError) throw error;          // resolvePRD/readUTF8FileStrict already wraps
    throw new SessionFileError(prdPath, 'read PRD', error as Error);
  }
}
```
(`resolvePRD` is defined in the SAME file at L495 — no import needed. `createHash`/`logger`/`SessionFileError`
already imported.)

(c) `createSessionDirectory(prdPath, sequence, planDir?, precomputedHash?)` (L547) — add a 4th optional param;
inside, replace `const fullHash = await hashPRD(prdPath);` (L554) with:
```ts
const fullHash = precomputedHash ?? (await hashPRD(prdPath));
```
Add `precomputedHash?: string` to the JSDoc `@param` (note: when supplied, skips re-resolution — used by
`initialize()` which already resolved+hashed). Backward-compatible: existing 3-arg callers unchanged.

(d) `snapshotPRD(sessionPath, prdPath, resolvedContent?)` (L947) — add a 3rd optional param; replace the
`const content = await readUTF8FileStrict(absPRDPath, 'read PRD');` (L~978) with:
```ts
const content = resolvedContent ?? (await resolvePRD(absPRDPath));
```
Add `resolvedContent?: string` to the JSDoc `@param` (note: when supplied, writes it directly — used by
`initialize()` which already resolved; otherwise resolves the entry file). Backward-compatible.

**File 2 — `src/core/session-manager.ts`** — EDIT `initialize()` ONLY (L277–510):

Imports (L37–43): add `resolvePRD`, `hashPRDContent`, `snapshotPRD` to the existing
`import { hashPRD, createSessionDirectory, readTasksJSON, writeTasksJSON, SessionFileError } from './session-utils.js';`
(keep `hashPRD` — still used by `createDeltaSession`@624, which is S2's domain).

In `initialize()`:
1. Replace L294 `const fullHash = await hashPRD(this.prdPath);` with:
```ts
const resolved = await resolvePRD(this.prdPath);   // resolve ONCE (PRD §2.3)
const fullHash = hashPRDContent(resolved);          // pure hash of the resolved bytes
```
(Keep the surrounding debug logs; update the `'Computing PRD hash'`/`'PRD hash computed'` log context to
include `{ resolvedLength: resolved.length }`.)
2. `createSessionDirectory(this.prdPath, sequence, this.planDir, fullHash)` — pass `fullHash` as the new
4th arg (L441) so it does NOT re-resolve/re-hash.
3. Replace the L456–475 RAW-read + inline-write block:
```ts
// OLD: const prdContent = await readFile(this.prdPath, 'utf-8'); … writeFile(snapshotPath, prdContent, {mode:0o644});
await snapshotPRD(sessionPath, this.prdPath, resolved);   // write the SAME resolved bytes (PRD §2.3)
```
(Remove the now-unused `snapshotPath` local + its debug log, OR keep a debug log inside the call. Keep the
`'PRD snapshot created'` info log keyed on `sessionId`/size.)
4. L493: `prdSnapshot: resolved,` (was `prdContent`).

**DO NOT** touch: `validator.validate(this.prdPath)`@312 (out of scope), `loadSession`@560 (reads the
snapshot we wrote — already resolved), `createDeltaSession`@610 (S2), static `findSessionByHash`@1383
(becomes correct via the refactored `hashPRD`; no edit).

### Success Criteria
- [ ] `hashPRDContent(resolved: string): string` exported; pure (no `readFile`/`stat`); returns 64-hex SHA-256.
- [ ] `hashPRD(prdPath)` resolves via `resolvePRD` then delegates to `hashPRDContent`; preserves the
      `SessionFileError(prdPath,'read PRD',…)` error envelope.
- [ ] `createSessionDirectory(prdPath, seq, planDir?, precomputedHash?)` — 4th optional param skips
      re-hash when supplied; 3-arg callers behave identically.
- [ ] `snapshotPRD(sessionPath, prdPath, resolvedContent?)` — 3rd optional param writes directly when
      supplied; otherwise resolves the entry file.
- [ ] `initialize()` calls `resolvePRD` exactly once; `hashPRDContent(resolved)` + `snapshotPRD(…, resolved)`
      consume the same string; `prdSnapshot === resolved`.
- [ ] For directive-free PRDs, `session-hash-detection.test.ts` passes **unchanged** (resolvePRD no-op).
- [ ] `npm run typecheck && npm run lint && npm run format:check` clean; `npm run test:run` green.

---

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed?_ **Yes** — exact
before/after for every edit with verified line numbers, the full 3-file test cascade with the precise
mock incompatibility (`TextDecoder` mocked → undefined) that causes it, the real-tmpdir safety net
that proves correctness, the S2 handoff, and executable validation commands.

### Documentation & References

```yaml
# MUST READ — the resolver this threads (S2 LANDED, verified in-repo at session-utils.ts:495)
- file: plan/008_15504f60a0ef/P1M1T1S2/PRP.md
  why: Defines resolvePRD(prdPath, opts?) → Promise<string> (fully include-expanded document) and
        expandIncludesRecursive (the recursive worker). T2.S1 CALLS resolvePRD; it does NOT edit it.
  critical: resolvePRD reads the entry via readUTF8FileStrict (Buffer + fatal TextDecoder), NOT
        readFile(path,'utf-8'). This is WHY the mock-based hashPRD tests break (see research note §3b).

# MUST READ — S3 (in-flight): markers + IDEMPOTENCY guarantee T2.S1 relies on
- file: plan/008_15504f60a0ef/P1M1T1S3/PRP.md
  why: S3 guarantees resolve(resolve(x)) === resolve(x). T2.S1 relies on this: resolving once in
        initialize() and again inside standalone hashPRD callers yields identical bytes (no divergence).
  critical: Do NOT assume markers/stale-warning behavior — T2.S1 is agnostic to it. Just consume
        resolvePRD as a (prdPath, opts?) → resolved-string function.

# MUST READ — design + cascade proof (authored with this PRP)
- docfile: plan/008_15504f60a0ef/P1M1T2S1/research/resolve-threading-design.md
  section: "1. Current data flow", "2. Design decision", "3. The test cascade", "4. Parallel-execution check"
  why: Verified line numbers for every call site, the hashPRDContent/hashPRD/createSessionDirectory/
        snapshotPRD design table, the EXACT mock incompatibility that breaks session-utils.test.ts
        (TextDecoder mocked → undefined), and the file-disjoint proof vs S3 + S2. READ BEFORE IMPLEMENTING.

# MUST READ — PRD spec
- docfile: PRD.md
  section: "§2.3 Distributed (Multi-File) PRDs" (esp. "Idempotency" + "Single canonical document downstream")
        and "§4.1 Initialization & Breakdown" step 2 (hash over the resolved document).
  why: Authoritative invariant. (Also inline in this PRP's <selected_prd_content>.)

# PATTERN FILES
- file: src/core/session-utils.ts
  why: hashPRD (L243 — refactor), resolvePRD (L495 — consume, do NOT edit), createSessionDirectory
        (L547 — add optional param), snapshotPRD (L947 — add optional param + revive). All four
        edits land here. createHash/logger/SessionFileError already imported; resolvePRD is same-file.
  pattern: "export async function hashPRD(prdPath): Promise<string> { try {...} catch { throw new SessionFileError(prdPath,'read PRD',e); } }"
  gotcha: resolvePRD uses readUTF8FileStrict (Buffer+TextDecoder), NOT readFile(…,'utf-8'). The mock
          tests must account for this (see cascade).

- file: src/core/session-manager.ts
  why: initialize() L277–510 (the ONLY method to edit). createSessionDirectory call @441, snapshot
        readFile/writeFile @460/@473, prdSnapshot @493. Imports @37–43 (add resolvePRD/hashPRDContent/snapshotPRD).
  gotcha: Do NOT edit createDeltaSession@610 or findSessionByHash@1383 (S2 owns them; they become
          resolved-correct automatically via the refactored hashPRD).

- file: tests/unit/core/session-hash-detection.test.ts
  why: REAL-tmpdir + REAL-crypto hashPRD tests. Directive-free fixtures ⇒ resolvePRD is a no-op ⇒
        hashes identical ⇒ THIS FILE PASSES UNCHANGED. It is the end-to-end safety net.
  gotcha: Do NOT add @-directives to its fixtures (that would change the hashes). Leave it entirely alone.

- file: tests/unit/core/session-utils.test.ts
  why: Mock-based. The hashPRD happy-path (L231) + createSessionDirectory block (L307–422) BREAK because
        hashPRD now routes through resolvePRD→readUTF8FileStrict and the file mocks TextDecoder→undefined.
  pattern: File-level vi.mock('node:fs/promises'), vi.mock('node:crypto'), vi.mock('node:util',()=>({TextDecoder:vi.fn()})).
  gotcha: error-path hashPRD tests (readFile rejects) STILL PASS (SessionFileError propagates). Only the
          happy-path + createSessionDirectory (which calls hashPRD) need rework — see Tasks.

- file: tests/unit/core/session-manager.test.ts
  why: Mocks session-utils at the boundary (L47–48). initialize() now calls resolvePRD/hashPRDContent/
        snapshotPRD instead of hashPRD ⇒ mock factory + initialize assertions must update.
  pattern: "hashPRD: vi.fn(), createSessionDirectory: vi.fn()" — EXTEND with the 3 new fns.
```

### Current Codebase tree (relevant slice)

```bash
src/core/
├── session-utils.ts     # EDIT: +hashPRDContent (new); refactor hashPRD; +optional params on createSessionDirectory & snapshotPRD
└── session-manager.ts   # EDIT: initialize() ONLY (+imports)
tests/unit/core/
├── session-utils.test.ts           # EDIT: hashPRD happy-path → hashPRDContent; createSessionDirectory → precomputedHash
├── session-manager.test.ts         # EDIT: extend mock + initialize assertions
└── session-hash-detection.test.ts  # UNCHANGED (real tmpdir, directive-free → resolvePRD no-op)
docs/
└── ARCHITECTURE.md                 # EDIT (Mode A): brief resolved-document-invariant note
```

### Desired Codebase tree with files to be added/edited

```bash
src/core/session-utils.ts            # MODIFIED (hashPRDContent new; hashPRD/createSessionDirectory/snapshotPRD edited)
src/core/session-manager.ts          # MODIFIED (initialize + imports only)
tests/unit/core/session-utils.test.ts    # MODIFIED (hashPRD + createSessionDirectory blocks)
tests/unit/core/session-manager.test.ts  # MODIFIED (mock factory + initialize block)
docs/ARCHITECTURE.md                 # MODIFIED (Mode A note)
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — resolvePRD (session-utils.ts:495, S2-landed) reads via readUTF8FileStrict: readFile(path)
//   (NO 'utf-8' arg → Buffer) + new TextDecoder('utf-8',{fatal:true}).decode(buffer). The mock-based
//   session-utils.test.ts mocks readFile→STRING and TextDecoder→vi.fn() (returns undefined). After the
//   refactor, hashPRD→resolvePRD hits this chain ⇒ TypeError on undefined.decode(). This is THE reason
//   the hashPRD happy-path + createSessionDirectory mock tests must be reworked (research §3b). The
//   real-tmpdir session-hash-detection.test.ts is unaffected (real fs + real TextDecoder).

// CRITICAL — resolvePRD is DEFINED IN THE SAME FILE as hashPRD (session-utils.ts). Do NOT add an import
//   for it. Just call resolvePRD(prdPath). createHash/logger/SessionFileError are already imported.

// CRITICAL — preserve hashPRD's error envelope. resolvePRD/readUTF8FileStrict throw SessionFileError
//   already; re-throw it as-is (instanceof check). Only wrap NON-SessionFileError throws in
//   SessionFileError(prdPath,'read PRD',cause) to match the pre-refactor contract.

// CRITICAL — initialize() must call resolvePRD EXACTLY ONCE. Do NOT also call hashPRD(this.prdPath)
//   (that would resolve a 2nd time). Use hashPRDContent(resolved) for the hash and pass `fullHash` to
//   createSessionDirectory (4th arg) so IT doesn't re-resolve either. Single resolution = the win.

// CRITICAL — the validator at L312 (validator.validate(this.prdPath)) still reads RAW. It is OUT OF
//   SCOPE (contract lists only hash + snapshot). Do NOT touch it. (Future work: validate resolved.)

// GOTCHA — loadSession()@560 reads prd_snapshot.md (now resolved) → returns resolved as prdSnapshot.
//   Consistent with initialize(). NO change needed — it reads what we write.

// GOTCHA — prettier is ERROR-enforced. Run `npm run fix` (lint:fix + prettier --write) before
//   format:check. The new JSDoc + optional-param additions may need it.

// GOTCHA — vitest.config.ts enforces 100% coverage on src/**/*.ts. The new hashPRDContent is one
//   statement (fully covered by any hashPRDContent test). hashPRD's new body has 2 branches
//   (precomputedHash supplied vs not in createSessionDirectory; resolvedContent supplied vs not in
//   snapshotPRD) — covered by the reworked tests passing/not-passing the optional args. If coverage
//   drops, add a case that exercises the omitted-arg branch (3-arg createSessionDirectory call).

// GOTCHA — optional params are backward-compatible by design. S2 (next) calls createSessionDirectory
//   from createDeltaSession WITHOUT the 4th arg ⇒ it recomputes via hashPRD (which resolves). No
//   breakage. Do NOT make the params required.
```

---

## Implementation Blueprint

### Data models and structure

No new data models. The "models" are four function signatures (three edited, one new):

```ts
// src/core/session-utils.ts
export function hashPRDContent(resolved: string): string;                         // NEW (pure)
export async function hashPRD(prdPath: string): Promise<string>;                  // REFACTOR (resolve-then-hash)
export async function createSessionDirectory(
  prdPath: string, sequence: number, planDir?: string, precomputedHash?: string
): Promise<string>;                                                                // +optional 4th param
export async function snapshotPRD(
  sessionPath: string, prdPath: string, resolvedContent?: string
): Promise<void>;                                                                  // +optional 3rd param

// src/core/session-manager.ts — initialize() internal flow (no signature change)
async initialize(): Promise<SessionState>;  // body only
```

### Implementation Tasks (ordered by dependencies — implicit TDD: RED first, then GREEN)

```yaml
Task 1: EDIT tests/unit/core/session-utils.test.ts   (RED for hashPRDContent + cascade fixes)
  - IMPORT: add hashPRDContent to the existing '../../../src/core/session-utils.js' import.
  - ADD describe('hashPRDContent'):
      * it('hashes a resolved string with SHA-256 (64 hex)'): mockCreateHash.mockReturnValue(new MockHash());
        expect(hashPRDContent('resolved-doc')).toBe(MockHash digest); expect(mockCreateHash).toHaveBeenCalledWith('sha256');
        expect(MockHash.update).toHaveBeenCalledWith('resolved-doc'). (PURE — no readFile/TextDecoder.)
      * it('is pure (no fs I/O)'): call twice with same input → same output; assert mockReadFile NOT called.
  - REWORK describe('hashPRD') happy-path (L231 'should compute SHA-256 hash of PRD file'):
      The old test mocked readFile→'# Test PRD' (string) + createHash→MockHash and asserted the hash.
      After refactor hashPRD→resolvePRD→readUTF8FileStrict needs readFile→Buffer + working TextDecoder
      (mocked→undefined). Simplest correct rework: make readFile mock return Buffer.from('# Test PRD')
      AND temporarily use a real TextDecoder for this test (vi.doUnmock is awkward at file level), OR —
      PREFERRED — replace the happy-path assertion with: "hashPRD delegates to resolvePRD + hashPRDContent"
      by mocking is not possible for same-module calls. THEREFORE: delete the mock-based happy-path
      assertion and rely on session-hash-detection.test.ts (real tmpdir) for end-to-end coverage, KEEPING
      only the 3 error-path tests (which make readFile reject → SessionFileError propagates unchanged).
      Add a comment: "// End-to-end happy-path coverage lives in session-hash-detection.test.ts (real tmpdir)."
  - KEEP the 3 hashPRD error-path tests (L249 ENOENT, L275 EACCES, L295 generic): they mock readFile to
      REJECT; resolvePRD→readUTF8FileStrict catches and throws SessionFileError ⇒ still pass. (If the
      'generic read error' test relied on a non-ENOENT readFile rejection that readUTF8FileStrict wraps
      differently, assert toThrow(SessionFileError) only — the operation string is still 'read PRD'.)
  - REWORK describe('createSessionDirectory') (L307–422): beforeEach currently sets
      mockReadFile.mockResolvedValue('# Test PRD') + createHash→MockHash to satisfy the internal hashPRD.
      After refactor that path crashes (TextDecoder). FIX: pass the new 4th arg `precomputedHash` to
      EVERY happy-path createSessionDirectory call so it SKIPS hashPRD entirely:
        const sessionPath = await createSessionDirectory('/test/PRD.md', 1, undefined, '14b9dc2a33c7abcd...');
      (Use a 64-char hex string; assertions on '001_14b9dc2a33c7' still hold since slice(0,12) is applied.)
      Update the beforeEach to NOT need readFile/createHash for these (or leave them — harmless).
      KEEP the 'propagate SessionFileError from hashPRD' test (L392): call createSessionDirectory WITHOUT
      precomputedHash (so it calls hashPRD→resolvePRD→readUTF8FileStrict) with mockReadFile rejecting ENOENT
      ⇒ rejects SessionFileError. Assert sessionError.operation === 'read PRD'.
      ADD: it('uses precomputedHash when supplied (skips hashPRD)'): pass precomputedHash, assert mockReadFile
      NOT called (proves the skip) AND the session id embeds the supplied hash's first 12 chars.
  - EXPECTED NOW (before src edits): hashPRDContent import fails → RED.

Task 2: EDIT tests/unit/core/session-manager.test.ts   (RED for initialize flow)
  - EXTEND the session-utils mock factory (L47–48): add resolvePRD: vi.fn(), hashPRDContent: vi.fn(),
    snapshotPRD: vi.fn(). Add const casts (mockResolvePRD etc.).
  - In the initialize test beforeEach: mockResolvePRD.mockResolvedValue('# Test PRD');
    mockHashPRDContent.mockReturnValue('14b9dc2a33c7...64hex'); mockCreateSessionDirectory.mockResolvedValue('/plan/001_...');
    mockSnapshotPRD.mockResolvedValue(undefined).
  - UPDATE assertions:
      * 'should hash PRD using hashPRD()' (L436) → 'should resolve PRD once and hash the resolved doc':
        expect(mockResolvePRD).toHaveBeenCalledWith(this.prdPath); expect(mockResolvePRD).toHaveBeenCalledTimes(1);
        expect(mockHashPRDContent).toHaveBeenCalledWith('# Test PRD'); expect(mockHashPRD).not.toHaveBeenCalled().
      * 'should write PRD snapshot' (L483) → expect(mockSnapshotPRD).toHaveBeenCalledWith(sessionPath, this.prdPath, '# Test PRD').
      * 'should return SessionState with … prdSnapshot' (L519) → prdSnapshot: '# Test PRD' still holds (resolvePRD mock returns it).
      * 'propagate SessionFileError from hashPRD()' (L628) → rename 'from resolvePRD()'; mockResolvePRD.mockRejectedValue(new SessionFileError(...)).
      * 'propagate SessionFileError from createSessionDirectory()' (L638) → keep (still mocked) but now
        initialize passes fullHash as 4th arg: assert mockCreateSessionDirectory called with (prdPath, seq, planDir, <hash>).
  - EXPECTED NOW: resolvePRD/hashPRDContent/snapshotPRD not exported from session-utils → mock is fine,
        but the real initialize() still calls hashPRD → assertion (not called) fails → RED.

Task 3: EDIT src/core/session-utils.ts   (GREEN)
  - ADD hashPRDContent(resolved): string (pure) directly above hashPRD (L243), with the JSDoc above.
  - REFACTOR hashPRD(prdPath): resolve via resolvePRD then return hashPRDContent(resolved); preserve the
        try/catch + SessionFileError(prdPath,'read PRD',…) envelope (instanceof re-throw).
  - EDIT createSessionDirectory signature (L547): add `precomputedHash?: string` 4th param + JSDoc;
        replace `const fullHash = await hashPRD(prdPath);` with `const fullHash = precomputedHash ?? (await hashPRD(prdPath));`.
  - EDIT snapshotPRD signature (L947): add `resolvedContent?: string` 3rd param + JSDoc; replace
        `const content = await readUTF8FileStrict(absPRDPath, 'read PRD');` with
        `const content = resolvedContent ?? (await resolvePRD(absPRDPath));`.
  - DO NOT edit resolvePRD/expandIncludesRecursive/ResolveOpts (S2/S3 code). DO NOT remove readUTF8FileStrict
        import (still used by snapshotPRD's fallback? — no, fallback now uses resolvePRD; but readUTF8FileStrict
        is used by resolvePRD itself and elsewhere — keep the import).
  - EXPECTED: session-utils.test.ts hashPRDContent + createSessionDirectory tests turn GREEN.

Task 4: EDIT src/core/session-manager.ts   (GREEN — initialize only)
  - IMPORTS (L37–43): add resolvePRD, hashPRDContent, snapshotPRD to the session-utils import (keep hashPRD
        for createDeltaSession@624).
  - initialize(): replace L294 hashPRD call with resolvePRD+hashPRDContent (resolve ONCE); pass fullHash as
        4th arg to createSessionDirectory@441; replace the L456–475 readFile+writeFile block with
        `await snapshotPRD(sessionPath, this.prdPath, resolved);`; set prdSnapshot: resolved@493.
  - DO NOT touch validator@312, loadSession@560, createDeltaSession@610, findSessionByHash@1383.
  - EXPECTED: session-manager.test.ts initialize block turns GREEN; full suite green.

Task 5: EDIT docs/ARCHITECTURE.md   (Mode A — brief note)
  - ADD a short subsection (under the session/PRD-handling area) titled e.g. "Resolved-document invariant":
        "The session hash (§4.1 step 2) and prd_snapshot.md are computed over the FULLY-RESOLVED,
        include-expanded PRD (§2.3), never the raw entry file. initialize() resolves once via resolvePRD
        and feeds that single string to both hashPRDContent and snapshotPRD, guaranteeing hash===snapshot
        bytes. (Full multi-file-PRD capability framing: P6.)" Keep it brief — the comprehensive docs land in P6.
  - (No README/CONFIGURATION edits — those are P6.)

Task 6: FORMAT + VERIFY
  - RUN: npm run fix → npm run typecheck → npm run lint → npm run format:check.
  - RUN: npx vitest run tests/unit/core/session-utils.test.ts (reworked blocks green).
  - RUN: npx vitest run tests/unit/core/session-manager.test.ts (initialize block green).
  - RUN: npx vitest run tests/unit/core/session-hash-detection.test.ts (UNCHANGED — must stay green).
  - RUN: npx vitest run tests/unit/core/prd-resolve.test.ts tests/unit/core/prd-includes.test.ts (S1/S2/S3 regression — untouched, green).
  - RUN: npx vitest run (full suite — no regression).
  - EXPECTED: all green; touched src lines at 100% coverage.
```

### Implementation Patterns & Key Details

```ts
// ---- src/core/session-utils.ts (EDITS) ----

// (a) NEW pure primitive (above hashPRD):
export function hashPRDContent(resolved: string): string {
  const fullHash = createHash('sha256').update(resolved).digest('hex');
  logger().debug({ hash: fullHash.slice(0, 12), fullHashLength: fullHash.length }, 'Resolved PRD hash computed');
  return fullHash;
}

// (b) REFACTOR hashPRD (resolve-then-hash; preserve error envelope):
export async function hashPRD(prdPath: string): Promise<string> {
  try {
    logger().debug({ prdPath, operation: 'hashPRD' }, 'Resolving + hashing PRD');
    const resolved = await resolvePRD(prdPath);   // PRD §2.3: hash the resolved document
    return hashPRDContent(resolved);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    logger().error({ prdPath, errorCode: err?.code, errorMessage: err?.message, operation: 'hashPRD' }, 'Failed to resolve/hash PRD');
    if (error instanceof SessionFileError) throw error;
    throw new SessionFileError(prdPath, 'read PRD', error as Error);
  }
}

// (c) createSessionDirectory — +optional precomputedHash (skip re-resolution):
export async function createSessionDirectory(
  prdPath: string, sequence: number, planDir: string = resolve('plan'), precomputedHash?: string,
): Promise<string> {
  // …
  const fullHash = precomputedHash ?? (await hashPRD(prdPath));   // was: await hashPRD(prdPath)
  const sessionHash = fullHash.slice(0, 12);
  // … (rest unchanged)
}

// (d) snapshotPRD — +optional resolvedContent (revive as resolve-correct):
export async function snapshotPRD(sessionPath: string, prdPath: string, resolvedContent?: string): Promise<void> {
  // …
  const content = resolvedContent ?? (await resolvePRD(absPRDPath));   // was: readUTF8FileStrict(absPRDPath,'read PRD')
  // … writeFile(snapshotPath, content, { mode: 0o644 }) … (rest unchanged)
}

// ---- src/core/session-manager.ts (EDIT initialize only) ----
// imports: add resolvePRD, hashPRDContent, snapshotPRD (keep hashPRD for createDeltaSession)
//   const resolved = await resolvePRD(this.prdPath);   // resolve ONCE
//   const fullHash = hashPRDContent(resolved);          // pure hash
//   … findSessionByHash(sessionHash) …
//   const sessionPath = await createSessionDirectory(this.prdPath, sequence, this.planDir, fullHash);
//   await snapshotPRD(sessionPath, this.prdPath, resolved);   // write SAME resolved bytes
//   … prdSnapshot: resolved, …

// ---- tests/unit/core/session-utils.test.ts (key reworks) ----
describe('hashPRDContent', () => {
  it('hashes a resolved string with SHA-256 (pure)', () => {
    mockCreateHash.mockReturnValue(new MockHash());
    expect(hashPRDContent('resolved-doc')).toBe('14b9dc2a33c7…');
    expect(mockCreateHash).toHaveBeenCalledWith('sha256');
  });
  it('does not touch the filesystem', () => {
    mockCreateHash.mockReturnValue(new MockHash());
    hashPRDContent('x'); hashPRDContent('x');
    expect(mockReadFile).not.toHaveBeenCalled();   // pure
  });
});
// createSessionDirectory happy-paths now pass precomputedHash:
const sessionPath = await createSessionDirectory('/test/PRD.md', 1, undefined, '14b9dc2a33c7abcdef…');
// → skips hashPRD entirely (mockReadFile not called); session id embeds '001_14b9dc2a33c7'.

// ---- tests/unit/core/session-manager.test.ts (mock factory + assertions) ----
vi.mock('../../../src/core/session-utils.js', () => ({
  hashPRD: vi.fn(), createSessionDirectory: vi.fn(), readTasksJSON: vi.fn(), writeTasksJSON: vi.fn(),
  resolvePRD: vi.fn(), hashPRDContent: vi.fn(), snapshotPRD: vi.fn(), SessionFileError, // +3 new
}));
// beforeEach: mockResolvePRD.mockResolvedValue('# Test PRD'); mockHashPRDContent.mockReturnValue('14b9…');
//   mockSnapshotPRD.mockResolvedValue(undefined);
// 'resolve once + hash resolved': expect(mockResolvePRD).toHaveBeenCalledTimes(1);
//   expect(mockHashPRDContent).toHaveBeenCalledWith('# Test PRD'); expect(mockHashPRD).not.toHaveBeenCalled();
// 'snapshot via snapshotPRD': expect(mockSnapshotPRD).toHaveBeenCalledWith(sessionPath, prdPath, '# Test PRD');
```

### Integration Points

```yaml
SESSION-UTILS (src/core/session-utils.ts):
  - NEW export: hashPRDContent(resolved): string
  - REFACTOR: hashPRD(prdPath) → resolvePRD + hashPRDContent
  - +optional param: createSessionDirectory(…, precomputedHash?) and snapshotPRD(…, resolvedContent?)
  - PRESERVE: resolvePRD/expandIncludesRecursive/ResolveOpts (S2/S3), all error envelopes, readUTF8FileStrict

SESSION-MANAGER (src/core/session-manager.ts):
  - initialize() ONLY: resolve once → hashPRDContent → snapshotPRD(resolved) → prdSnapshot: resolved
  - imports: +resolvePRD, +hashPRDContent, +snapshotPRD (keep hashPRD)
  - DO NOT EDIT: validator@312, loadSession@560, createDeltaSession@610, findSessionByHash@1383

DOWNSTREAM CONSUMERS (become correct AUTOMATICALLY — no edit by this subtask):
  - static findSessionByHash@1383: calls hashPRD(absPath) → now resolved (via the refactor)
  - createDeltaSession@624: calls hashPRD(newPRDPath) → now resolved. Its SNAPSHOT threading (@648/@667)
        is P1.M1.T2.S2's job. T2.S1 hands off a hashPRD that already resolves.

DOCS (Mode A):
  - docs/ARCHITECTURE.md: brief "Resolved-document invariant" note (full framing = P6)
  - JSDoc on hashPRDContent (idempotency reliance + resolved-document rationale, cite PRD §2.3)
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run fix                  # lint:fix + prettier --write (run first — JSDoc/optional-params may need it)
npm run typecheck            # tsc --noEmit -p tsconfig.build.json — clean
npm run lint                 # eslint . --ext .ts — clean (watch unused imports if hashPRD becomes unused anywhere)
npm run format:check         # prettier --check — clean
# Expected: all clean. If lint flags an unused `hashPRD` import in session-manager.ts, confirm
# createDeltaSession@624 still calls it (it does — S2's domain). Do NOT remove the import.
```

### Level 2: Unit Tests (Component Validation)

```bash
# Directly affected suites:
npx vitest run tests/unit/core/session-utils.test.ts        # reworked hashPRDContent + createSessionDirectory blocks
npx vitest run tests/unit/core/session-manager.test.ts      # initialize block
# The safety net (must pass UNCHANGED — proves hashPRD end-to-end on directive-free PRDs):
npx vitest run tests/unit/core/session-hash-detection.test.ts
# S1/S2/S3 regression (untouched — must stay green):
npx vitest run tests/unit/core/prd-includes.test.ts tests/unit/core/prd-resolve.test.ts tests/unit/core/prd-markers.test.ts
# Full suite:
npm run test:run
# Coverage on touched source files:
npx vitest run tests/unit/core/session-utils.test.ts tests/unit/core/session-manager.test.ts tests/unit/core/session-hash-detection.test.ts --coverage
# Expected: all green. If session-utils.ts coverage <100%, ensure the createSessionDirectory
# precomputedHash-supplied AND -omitted branches are both hit (the "uses precomputedHash" test + the
# "propagate SessionFileError" test that omits it).
```

### Level 3: Integration Testing (System Validation)

```bash
# Prove initialize() resolves once and writes a resolved snapshot, end-to-end on a REAL multi-file PRD:
npx tsx -e "
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os'; import { join } from 'node:path';
import { SessionManager } from './src/core/session-manager.ts';
const d = mkdtempSync(join(tmpdir(), 'thr-'));
writeFileSync(join(d, 'part.md'), 'INCLUDED BODY');
writeFileSync(join(d, 'PRD.md'), '# Top\n\n@part.md\n');
const m = new SessionManager(join(d, 'PRD.md'), join(d, 'plan'));
m.initialize().then(s => {
  const snap = readFileSync(join(s.metadata.path, 'prd_snapshot.md'), 'utf-8');
  console.log('snapshot contains expanded include:', snap.includes('INCLUDED BODY'));
  rmSync(d, { recursive: true, force: true });
});
"
# Expected stdout: "snapshot contains expanded include: true" (the snapshot holds the RESOLVED doc).
# (Adjust the SessionManager constructor arity to match src/index.ts — if it takes >2 args, pass the
#  real signature; the point is to observe the expanded include in prd_snapshot.md.)
```

### Level 4: Creative & Domain-Specific Validation

```bash
# No MCP/DB/HTTP. Domain checks (record in commit message):
#   1. hash === snapshot bytes: in initialize(), fullHash = hashPRDContent(resolved) and the snapshot
#      is written from the SAME `resolved` ⇒ SHA-256(snapshotFile) === fullHash. (The §2.3 invariant.)
#   2. Single resolution: initialize() calls resolvePRD exactly once (grep/step through). createSessionDirectory
#      receives fullHash (4th arg) ⇒ does NOT call hashPRD ⇒ no 2nd resolution.
#   3. Directive-free parity: a PRD with no @tokens hashes identically to before (resolvePRD no-op) —
#      proven by session-hash-detection.test.ts passing unchanged.
#   4. findSessionByHash/createDeltaSession resolved-correct via the refactored hashPRD — no edit needed
#      (handoff to S2 for the delta snapshot write only).
#   5. Backward compat: 3-arg createSessionDirectory and 2-arg snapshotPRD callers behave as before
#      (optional params default to recomputing via the now-resolving paths).
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` clean.
- [ ] `npm run lint` clean (no unused-import on `hashPRD` — still used by createDeltaSession@624).
- [ ] `npm run format:check` clean.
- [ ] `npx vitest run tests/unit/core/session-utils.test.ts` green (reworked blocks).
- [ ] `npx vitest run tests/unit/core/session-manager.test.ts` green (initialize block).
- [ ] `npx vitest run tests/unit/core/session-hash-detection.test.ts` green (UNCHANGED).
- [ ] `npx vitest run` (full suite) green — no regression (incl. S1/S2/S3 suites).
- [ ] Touched lines in `src/core/session-utils.ts` and `src/core/session-manager.ts` at 100% coverage.

### Feature Validation
- [ ] `hashPRDContent(resolved)` exported, pure (no fs), 64-hex SHA-256.
- [ ] `hashPRD(prdPath)` resolves via `resolvePRD` then delegates to `hashPRDContent`; preserves
      `SessionFileError(prdPath,'read PRD',…)` envelope.
- [ ] `createSessionDirectory(…, precomputedHash?)` skips re-hash when supplied; 3-arg callers unchanged.
- [ ] `snapshotPRD(…, resolvedContent?)` writes supplied content directly; otherwise resolves.
- [ ] `initialize()` calls `resolvePRD` **once**; `hashPRDContent(resolved)` + `snapshotPRD(…, resolved)`
      consume the same string; `prdSnapshot === resolved`.
- [ ] A multi-file PRD's `prd_snapshot.md` contains the EXPANDED includes (Level 3 smoke test).
- [ ] A directive-free PRD hashes identically to before (session-hash-detection.test.ts unchanged).

### Code Quality Validation
- [ ] Consumes S2's `resolvePRD` (L495) WITHOUT editing its body or `expandIncludesRecursive`/`ResolveOpts`.
- [ ] Optional params are backward-compatible (S2's createDeltaSession call still works without them).
- [ ] Does NOT edit `resolvePRD`, `createDeltaSession`, `findSessionByHash`, `validator`, or `loadSession`.
- [ ] Error envelopes preserved (`SessionFileError(prdPath,'read PRD',…)` from hashPRD).
- [ ] One coherent design: pure primitive (`hashPRDContent`) + thin wrappers; no duplicated resolution.

### Documentation & Deployment
- [ ] JSDoc on `hashPRDContent` (resolved-document rationale + idempotency reliance; cite PRD §2.3).
- [ ] JSDoc `@param` additions on `createSessionDirectory` (`precomputedHash?`) and `snapshotPRD` (`resolvedContent?`).
- [ ] Brief "Resolved-document invariant" note in `docs/ARCHITECTURE.md` (Mode A; full framing = P6).
- [ ] Commit message notes: resolve-once threading; hashPRDContent primitive; cascade in
      session-utils.test.ts (TextDecoder mock) + session-manager.test.ts (mock boundary); S2 handoff.

---

## Anti-Patterns to Avoid

- ❌ Don't call `resolvePRD` more than once in `initialize()` — resolve ONCE and feed `resolved` to BOTH
      `hashPRDContent` and `snapshotPRD`. Calling `hashPRD(this.prdPath)` in initialize would resolve a
      2nd time (and skip the single-resolution win).
- ❌ Don't make `createSessionDirectory`/`snapshotPRD` optional params REQUIRED — they're backward-compat
      by design; S2 (next) and any other caller must keep working without them.
- ❌ Don't edit `resolvePRD`/`expandIncludesRecursive`/`ResolveOpts` — that's S2/S3's landed code. T2.S1
      only CALLS `resolvePRD`.
- ❌ Don't touch `createDeltaSession`@610, `findSessionByHash`@1383, `validator`@312, or `loadSession`@560 —
      S2 owns the delta/hash sites; the validator is out of scope; loadSession already reads what we write.
- ❌ Don't leave the `session-utils.test.ts` mock-based `hashPRD` happy-path asserting the old readFile-string
      flow — it WILL crash (TextDecoder mocked → undefined). Either delete it (coverage lives in
      session-hash-detection.test.ts) or convert it to a `hashPRDContent` test. Keep the error-path tests.
- ❌ Don't forget to extend the `session-utils` mock in `session-manager.test.ts` with `resolvePRD`/
      `hashPRDContent`/`snapshotPRD` — `initialize()` no longer calls `hashPRD`, so the old
      `expect(mockHashPRD).toHaveBeenCalled()` assertion will fail.
- ❌ Don't change `hashPRD`'s error envelope — callers (and error-path tests) expect
      `SessionFileError(prdPath, 'read PRD', cause)`. Re-throw `SessionFileError` as-is; wrap only others.
- ❌ Don't make the validator read resolved content — it's explicitly out of scope (contract = hash + snapshot only).
- ❌ Don't write a full ARCHITECTURE.md/README section — Mode A here is a BRIEF note; the comprehensive
      framing is P6 (M6).
- ❌ Don't skip the failing-test-first (RED) step — the project mandates implicit TDD.

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: The change is a focused, cohesive refactor: one new pure primitive (`hashPRDContent`), one
resolve-then-hash refactor (`hashPRD`), two backward-compatible optional params, and an `initialize()`
edit that resolves once and threads the same string to hash + snapshot. The consumed input (`resolvePRD`)
is verified LANDED in-repo (L495) with S3's idempotency guarantee making single-resolution safe. The one
non-obvious trap — the mock-based `session-utils.test.ts` crashes because `resolvePRD`→`readUTF8FileStrict`
needs a Buffer + real `TextDecoder` while the file mocks `TextDecoder`→undefined — is fully documented with
the exact rework (test `hashPRDContent` directly; pass `precomputedHash` to `createSessionDirectory`), and
the real-tmpdir `session-hash-detection.test.ts` proves end-to-end correctness on directive-free PRDs
unchanged. The `session-manager.test.ts` boundary-mock update is mechanical. File-disjoint from S3
(in-flight) and from S2's `createDeltaSession`/`findSessionByHash` edits; the `hashPRD` refactor actively
HELPS S2 (its hash sites become resolved-correct automatically). Residual risks: (a) a prettier nit
(auto-fixed via `npm run fix`), (b) the exact `SessionManager` constructor arity in the Level 3 smoke test
(adjust to match `src/index.ts`), (c) coverage of the optional-param-omitted branch needing an explicit
test (recipe provided). No external/runtime unknowns.