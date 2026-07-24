# Research — P1.M1.T2.S1: Thread `resolvePRD` through `hashPRD`, `initialize`, snapshot write

## 1. Current data flow (verified line numbers — S1/S2 shifted them)

```
initialize()  src/core/session-manager.ts
  L294  const fullHash = await hashPRD(this.prdPath)     ← reads RAW, hashes RAW
  L312  validator.validate(this.prdPath)                 ← reads RAW (OUT OF SCOPE — leave alone)
  L360  this.#findSessionByHash(sessionHash)             ← takes hash, scans dirs (no hashPRD)
  L441  createSessionDirectory(this.prdPath, seq, planDir) ← internally calls hashPRD AGAIN (L554)
  L460  const prdContent = await readFile(this.prdPath,'utf-8')  ← SEPARATE RAW read for snapshot
  L473  await writeFile(snapshotPath, prdContent, {mode:0o644})  ← inline snapshot write (RAW)
  L493  prdSnapshot: prdContent                          ← state holds RAW

createDeltaSession()  src/core/session-manager.ts (P1.M1.T2.S2's domain — DO NOT EDIT here)
  L624  const newHash = await hashPRD(newPRDPath)        ← S2 threads resolve here
  L629  const newPRD = await readFile(absPath,'utf-8')   ← S2 threads resolve here
  L648  writeFile(... parent_session.txt ...)            ← (not the snapshot)
  L667  prdSnapshot: newPRD

static findSessionByHash(prdPath)  src/core/session-manager.ts L1383
  L1383 const fullHash = await hashPRD(absPath)          ← standalone caller

hashPRD(prdPath)  src/core/session-utils.ts L243
  L253  const content = await readFile(prdPath,'utf-8')  ← RAW read
  L254  createHash('sha256').update(content).digest('hex')

snapshotPRD(sessionPath, prdPath)  src/core/session-utils.ts L947   ← DEAD CODE (zero callers)
  reads RAW prdPath via readUTF8FileStrict → writeFile(snapshotPath, content)

resolvePRD(prdPath, opts?)  src/core/session-utils.ts L495   ← S2 LANDED (verified in-repo)
  reads entry via readUTF8FileStrict (Buffer + fatal TextDecoder) → expandIncludesRecursive
  → returns fully include-expanded document. Idempotent (S3 guarantee).
```

**The bug (PRD §2.3):** hash + snapshot are computed over the RAW entry file, NOT the resolved
document. With `@`-includes, the hash/snapshot silently omit expanded content. Also the entry file
is read 2–4× per init (hashPRD@294, createSessionDirectory→hashPRD@554, readFile@460) and the RAW
hash vs RAW snapshot can diverge if the file changes between reads.

## 2. Design decision (resolves contract items a–d; minimizes total churn)

Canonical primitive first, then two thin wrappers:

| Function | Kind | Body |
|---|---|---|
| `hashPRDContent(resolved: string): string` | NEW pure (no I/O) | `createHash('sha256').update(resolved).digest('hex')` |
| `hashPRD(prdPath): Promise<string>` | REFACTOR | `const r = await resolvePRD(prdPath); return hashPRDContent(r);` — makes ALL prdPath callers (findSessionByHash@1383, createDeltaSession@624, createSessionDirectory) resolved-correct automatically |
| `createSessionDirectory(prdPath, seq, planDir?, precomputedHash?)` | ADD optional 4th param | if `precomputedHash` provided use it (slice 12) else `await hashPRD(prdPath)` — lets `initialize()` pass its computed hash ⇒ **single resolution** |
| `snapshotPRD(sessionPath, prdPath, resolvedContent?)` | ADD optional 3rd param + revive | if `resolvedContent` provided write it directly else `await resolvePRD(prdPath)` then write — revives the dead fn (contract item d), resolves-correct |

**`initialize()`** (the only session-manager.ts edit):
1. `const resolved = await resolvePRD(this.prdPath);`  — resolve ONCE (replaces the L460 readFile too)
2. `const fullHash = hashPRDContent(resolved);`  — sync pure hash (replaces `await hashPRD`@294)
3. `createSessionDirectory(this.prdPath, seq, planDir, fullHash)`  — pass hash ⇒ no re-resolution
4. `await snapshotPRD(sessionPath, this.prdPath, resolved);`  — write resolved (replaces inline readFile@460+writeFile@473; honors item d)
5. `prdSnapshot: resolved`  — state holds resolved (@493)

**Result:** exactly ONE `resolvePRD` call in `initialize()`. hash + snapshot come from the SAME
`resolved` bytes ⇒ PRD §2.3 invariant holds. The two other hash call sites (createDeltaSession@624,
findSessionByHash@1383) are resolved-correct automatically via the refactored `hashPRD` — **no edit
needed to those sites by THIS subtask** (createDeltaSession's snapshot threading is S2's job).

## 3. The test cascade (3 files — MANDATORY; `npm run test:run` is a gate)

### 3a. `tests/unit/core/session-hash-detection.test.ts` — **UNCHANGED (safe)**
REAL tmpdir + REAL crypto. Fixtures are directive-free (`'# Test PRD\n\nKnown content...'`,
`'# PRD\n\nContent...'`, `'# Product Requirements Document'`). `resolvePRD` on directive-free
content returns it byte-identical (no `@token` matches → no stat) ⇒ `hashPRDContent` hashes the
same bytes ⇒ **identical hash**. Verified: grep shows zero `@x.md` tokens in any fixture. This file
IS the end-to-end safety net proving `hashPRD` still works after the refactor.

### 3b. `tests/unit/core/session-utils.test.ts` — **hashPRD + createSessionDirectory blocks**
File-level mocks: `vi.mock('node:fs/promises')`, `vi.mock('node:crypto')`, AND
`vi.mock('node:util', () => ({ TextDecoder: vi.fn() }))` — so `new TextDecoder(...)` returns
`undefined`. After the refactor, `hashPRD`→`resolvePRD`→`readUTF8FileStrict`→`readFile` (mock
returns a STRING, not a Buffer) + `new TextDecoder().decode()` (undefined) ⇒ **TypeError**.

- `describe('hashPRD')` (L230–307): the **happy-path** test (L231, mocks readFile→`'# Test PRD'`
  string + createHash→MockHash) BREAKS. The three error-path tests (ENOENT/EACCES/generic, L249/275/295)
  make `readFile` REJECT → `resolvePRD`→`readUTF8FileStrict` catches → throws `SessionFileError` ⇒
  **still pass** (propagation identical). FIX the happy-path by testing `hashPRDContent` directly
  (pure: mock createHash only, pass a string — no fs/TextDecoder).
- `describe('createSessionDirectory')` (L307–422): beforeEach sets `mockReadFile.mockResolvedValue('# Test PRD')`
  + createHash→MockHash; createSessionDirectory internally calls `hashPRD` ⇒ same TextDecoder crash.
  FIX by passing the new `precomputedHash` arg (e.g. `'14b9dc2a33c7...'`) so createSessionDirectory
  SKIPS `hashPRD` entirely (tests the new param + is clean). The "propagate SessionFileError from
  hashPRD" test (L392, readFile rejects) keep by NOT passing precomputedHash (still exercises hashPRD).

### 3c. `tests/unit/core/session-manager.test.ts` — **initialize block**
Mocks `session-utils` at the boundary (`hashPRD: vi.fn()`, `createSessionDirectory: vi.fn()` L47–48).
`initialize` no longer calls `hashPRD`; it calls `resolvePRD` + `hashPRDContent` + `snapshotPRD`.
- Add `resolvePRD`, `hashPRDContent`, `snapshotPRD` to the mock factory (L47–48).
- L436 "should hash PRD using hashPRD()" → assert `resolvePRD` called with `this.prdPath` AND
  `hashPRDContent` called with its return.
- L483 "should write PRD snapshot" → assert `snapshotPRD` called (or writeFile with resolved).
- L519 `prdSnapshot: '# Test PRD'` → make `resolvePRD` mock return `'# Test PRD'` (still passes).
- L628 "propagate SessionFileError from hashPRD()" → make `resolvePRD` mock throw instead.
- L638 "propagate SessionFileError from createSessionDirectory()" → unchanged (still mocked).

## 4. Parallel-execution / file-disjoint check (vs P1.M1.T1.S3 in-flight + P1.M1.T2.S2 next)

- **vs S3 (in-flight):** S3 edits `resolvePRD`/`expandIncludesRecursive`/`ResolveOpts`/`constants.ts`
  + creates `prd-markers.test.ts`. T2.S1 CONSUMES `resolvePRD` (already landed, verified L495) and
  does NOT touch its body. Zero overlap.
- **vs S2 (next, P1.M1.T2.S2):** S2 edits `createDeltaSession`@610 + static `findSessionByHash`@1383 +
  delta workflow in `session-manager.ts`. T2.S1 edits ONLY `initialize()`@277–510 (disjoint from
  createDeltaSession@610 and findSessionByHash@1383). T2.S1's `hashPRD` refactor makes S2's two hash
  sites resolved-correct AUTOMATICALLY — S2 then only needs to thread `resolvePRD` into the delta
  SNAPSHOT write (@648/@667), not the hash call. Documented handoff.
- **`loadSession`@560–561** reads `prd_snapshot.md` (now resolved content) → returns resolved as
  `prdSnapshot`. Consistent with what `initialize` writes. NO change needed.

## 5. Decisions locked

- `hashPRDContent` is the canonical pure primitive; `hashPRD` is the resolve-then-hash wrapper;
  both exported. Single source of truth for "how to hash a PRD."
- `initialize()` resolves ONCE and feeds the SAME `resolved` string to hash + snapshot (PRD §2.3).
- `createSessionDirectory` + `snapshotPRD` gain backward-compatible optional params (no caller breaks;
  enables single-resolution + revives the dead snapshot fn).
- The PRD validator (L312, reads RAW) is **out of scope** — the contract lists only hash + snapshot.
  (Future: it should also resolve; tracked separately, NOT here.)
- DOCS (Mode A): a brief resolved-document-invariant note in `docs/ARCHITECTURE.md` + JSDoc on
  `hashPRDContent`. The full capability framing lands in P6.