# Research — `SessionManager.getChangeDiffSummary()` + `absorbCosmeticChange()`

Findings anchoring P1.M2.T1.S1 (bugfix 002, BUG-002 Part A step 1+2). All line
numbers verified against the working tree.

## 1. All building blocks are ALREADY imported in session-manager.ts

`src/core/session-manager.ts` already imports (lines 38-46):
- `resolvePRD` (38), `hashPRDContent` (39), `snapshotPRD` (41) from `./session-utils.js`
- `diffPRDs` from `./prd-differ.js` (46)

And already uses them:
- `resolvePRD(this.prdPath)` — initialize:397, createDeltaSession:806
- `hashPRDContent(resolved)` — initialize:398, createDeltaSession:807
- `snapshotPRD(sessionPath, this.prdPath, resolved)` — initialize:574
- `diffPRDs(oldPRD, newPRD)` — createDeltaSession:812

➡️ `getChangeDiffSummary` + `absorbCosmeticChange` need **no new imports** except the
`DiffSummary` **type** (type-only) from `./prd-differ.js` for the method signature.

## 2. `DiffSummary` shape (prd-differ.ts:112-134)

```ts
export interface DiffSummary {
  readonly changes: SectionChange[];
  readonly summaryText: string;
  readonly stats: { totalAdded; totalModified; totalRemoved; sectionsAffected: string[]; … };
}
```
`diffPRDs(oldPRD, newPRD): DiffSummary` — the EXACT type
`classifyChangeWithRetry(diffSummary)` consumes (BUG-002 Part A step 3, = S2).
`createDeltaSession` only stores `diffResult.summaryText`; the classifier needs the
FULL object → that's why `getChangeDiffSummary` returns `DiffSummary`, not a string.

## 3. `getChangeDiffSummary()` — mirror createDeltaSession's diff (811-812)

```ts
async getChangeDiffSummary(): Promise<DiffSummary> {
  if (!this.#currentSession) {
    throw new Error('Cannot compute change diff: no session loaded');
  }
  return diffPRDs(this.#currentSession.prdSnapshot, await resolvePRD(this.prdPath));
}
```
- `oldPRD` = `this.#currentSession.prdSnapshot` (the resolved snapshot — createDeltaSession:811).
- `newPRD` = `await resolvePRD(this.prdPath)` (the live resolved PRD — createDeltaSession:806).
- Guard mirrors `hasSessionChanged` (1690: `throw if !#currentSession`). `#prdHash` is NOT
  needed here (only prdSnapshot + prdPath), so guard `!#currentSession` only.
- Pure read — does NOT mutate state. Async only because `resolvePRD` is async.

## 4. `absorbCosmeticChange()` — refresh baseline WITHOUT a delta session

Contract: resolve ONCE → rewrite `prd_snapshot.md` via `snapshotPRD` → set
`metadata.hash` + `#prdHash` = `hashPRDContent(resolved)` → `hasSessionChanged()` is false.

```ts
async absorbCosmeticChange(): Promise<void> {
  if (!this.#currentSession) {
    throw new Error('Cannot absorb cosmetic change: no session loaded');
  }
  const sessionPath = this.#currentSession.metadata.path;
  // Resolve ONCE (PRD §2.3) — feeds both the snapshot rewrite and the new hash
  // (mirrors initialize:397 + createDeltaSession:806 "resolve ONCE" pattern).
  const resolved = await resolvePRD(this.prdPath);
  await snapshotPRD(sessionPath, this.prdPath, resolved);   // rewrite prd_snapshot.md
  const newHash = hashPRDContent(resolved);
  // CRITICAL: SessionMetadata.hash is readonly (models.ts:1034) → rebuild the state
  // object immutably (mirrors createDeltaSession:836-857 fresh-object assignment).
  this.#currentSession = {
    ...this.#currentSession,
    metadata: { ...this.#currentSession.metadata, hash: newHash },
    prdSnapshot: resolved,
  };
  this.#prdHash = newHash;
}
```

### 4a. CRITICAL — `metadata.hash` is `readonly` (models.ts:1034)
You CANNOT write `this.#currentSession.metadata.hash = newHash` (TS error + it's the
immutable contract). You MUST rebuild: `{ ...this.#currentSession, metadata: { ...md, hash } }`.
This is the SAME pattern `createDeltaSession` uses (builds a fresh `deltaSession` object at
836-857 and assigns `this.#currentSession = deltaSession` at 858). The spread preserves any
`DeltaSession`-specific fields (oldPRD/newPRD/diffSummary) if the current session is a delta.

### 4b. "Reuse/extract — do not duplicate" (the item's directive)
`acceptPrdChangesResponse` (prp-pipeline.ts:907) refreshes via
`refreshSnapshotToCurrentPRD(sessionPath, prdPath)` (session-utils.ts:1491), which internally
does `resolvePRD + writeFile(snapshotPath, resolved)`. BUT that helper resolves the PRD itself
and does NOT touch SessionManager's in-memory hashes/prdSnapshot. `absorbCosmeticChange` must
update `#prdHash` + `metadata.hash` + `prdSnapshot` too, and must resolve ONCE (to feed both
snapshotPRD and hashPRDContent — the codebase's "resolve ONCE" invariant, initialize:397).
➡️ Use `snapshotPRD(sessionPath, prdPath, resolved)` (the resolve-once variant, already
imported + used at initialize:574), NOT `refreshSnapshotToCurrentPRD` (would double-resolve).
This reuses the existing file-op helper (no inline `writeFile`) — satisfying "do not duplicate."
Editing `acceptPrdChangesResponse` itself to delegate is in prp-pipeline.ts (= S2's region) →
out of scope for S1; flag as an optional follow-up.

### 4c. Do NOT call `clearPendingDeltaHash`
`acceptPrdChangesResponse` also calls `clearPendingDeltaHash` (cancels a `.pending_delta_hash`
marker). The COSMETIC-absorb path runs in `initializeSession` BEFORE `handleDelta`/delta spawn,
so NO `.pending_delta_hash` exists yet. `absorbCosmeticChange` must NOT clear it (would be a
no-op at best, misleading at worst). Keep the method focused on snapshot + hash refresh.

## 5. Persistence model — what "persist metadata if needed" means here

- `metadata.hash` is **dir-name-derived**: `loadSession` (690) parses it from the `NNN_hash`
  directory name; `#findSessionByHash` (339) matches `s.hash === hash` from the dir name.
- `SessionState`/`metadata` is NOT serialized to a standalone metadata file — `loadSession`
  reads `prd_snapshot.md` + `tasks.json` + derives metadata from the dir name + parent_session.txt.
- ➡️ The PERSISTED artifact of `absorbCosmeticChange` is the rewritten `prd_snapshot.md` (via
  `snapshotPRD`). There is no separate metadata file to write; the dir name is immutable
  mid-session. The in-memory `#currentSession.metadata.hash` + `#prdHash` updates make
  `hasSessionChanged()` false **in-process** (the contract's literal test).
- Cross-process note: this matches `acceptPrdChangesResponse`'s model exactly (it also only
  refreshes the snapshot, not the dir name). A deeper dir-name-rename for cross-process
  idempotency is out of scope (the contract + test are in-process: "verify
  hasSessionChanged() flips to false after absorb"). Document this; do not over-engineer.

## 6. Consumers + scope boundaries

- **Consumed by P1.M2.T1.S2** (prp-pipeline.ts `initializeSession` ~781): after
  `hasSessionChanged()` → `getChangeDiffSummary()` → `classifyChangeWithRetry()` →
  COSMETIC ⇒ `absorbCosmeticChange()`; SUBSTANTIVE ⇒ `handleDelta()`. S1 provides the two
  methods; S2 wires them. S1 does NOT touch prp-pipeline.ts (S2's file).
- **File-disjoint from the parallel P1.M1.T1.S3** (BUG-001 test file) — no overlap.
- `src/core/change-classifier.ts` (the classifier) is READ-ONLY for S1 (S2 imports it into
  prp-pipeline). `src/core/prd-differ.ts` is READ-ONLY (provides `DiffSummary`/`diffPRDs`).
- DOCS: none (internal methods — the item says "DOCS: none"). No JSDoc mandate, though a
  brief JSDoc on each method is good hygiene (Mode-A-adjacent; optional).

## 7. Test patterns — tests/unit/core/session-manager.test.ts

The existing suite mocks `node:fs/promises`, `node:fs`, `session-utils` (mockResolvePRD @143,
mockSnapshotPRD @241), `task-utils`, `file-lock`, `prd-validator`. Construct via
`new SessionManager('/test/PRD.md', resolve('plan'))`.

For the new methods:
- Ensure `hashPRDContent` is mocked in the `session-utils` `vi.mock` block (add
  `mockHashPRDContent` if not present — verify; `diffPRDs` may also need a mock or can run real
  since it's pure). The `session-utils` mock is at test line 52.
- `getChangeDiffSummary`: stub `resolvePRD` → '# New', set `#currentSession.prdSnapshot` =
  '# Old' (via initialize mock or `loadSessionAsCurrent`), stub `diffPRDs` → a DiffSummary
  fixture; assert the returned object + that it throws when no current session.
- `absorbCosmeticChange`: stub `resolvePRD` → '# Resolved', `hashPRDContent` → 'newhash123',
  `snapshotPRD` → undefined; set `#currentSession` + `#prdHash` (mismatched, so
  `hasSessionChanged()` is true BEFORE); call `absorbCosmeticChange()`; assert
  `snapshotPRD` called with `(sessionPath, prdPath, '# Resolved')`,
  `hasSessionChanged() === false` AFTER, `currentSession.metadata.hash === 'newhash123'`,
  `currentSession.prdSnapshot === '# Resolved'`. Assert it throws when no current session.

## 8. Coverage & validation

- `session-manager.ts` is in `src/` ⇒ 100% coverage globally enforced (vitest.config.ts). The
  two new methods + their `!#currentSession` throw branches are exercised by the unit tests.
- **Bugfix BUG-004 caveat:** the FULL `npm run test:run` is PRE-EXISTING-RED (178 failures —
  P1.M4 scope, NOT S1's concern). S1's gate: `npm run typecheck && npm run lint && npm run
  format:check` clean + `npx vitest run tests/unit/core/session-manager.test.ts` GREEN. Do NOT
  use the full suite as the gate.
- Commands (package.json): `npm run fix` (lint:fix + format), `npm run validate` (lint +
  format:check + typecheck), `npm run typecheck` (tsc -p tsconfig.build.json, src/ only).