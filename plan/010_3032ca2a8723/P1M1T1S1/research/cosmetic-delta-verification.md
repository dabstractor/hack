# Research — P1.M1.T1.S1 (confirm cosmetic PRD delta + zero downstream impact)

Verification task for session 010. The PRD diff (session 009 `prd_snapshot.md` →
current `PRD.md`) is asserted by `architecture/delta-analysis.md` to be 100%
cosmetic. This note rigorously proves it and scopes the (minimal) actionable work.

## 1. RIGOROUS PROOF the delta is purely cosmetic (verified, not assumed)

The architecture doc CLAIMS cosmetic; `diff -w` returns 10 lines (NOT 0), which is a
**false alarm**: the residual is the markdown table SEPARATOR rows (`| ----- |` →
`| ------------- |`) — dashes are not whitespace, so `-w` flags them. The real proof:

**Strongest proof — semantic-characters-only equality:**
```bash
strip() { tr -d ' \t\n|-' < "$1"; }
diff <(strip plan/009_94353b1a9fd3/prd_snapshot.md) <(strip PRD.md)
# → (no output)  IDENTICAL
```
After removing ALL whitespace, ALL table pipes `|`, and ALL separator dashes `-`, the
two files are **byte-identical**. This proves NO semantic text was added, removed, or
changed anywhere in the document.

**Per-table proof (data rows, separator dropped, cells trimmed):**
- Table 1 (§9.7.3, lines 832–836): normalized data rows IDENTICAL.
- Table 2 (§9.7.5, lines 858–897): normalized data rows IDENTICAL.

**The complete delta is exactly three things, all formatting:**
1. §9.7.3 table — column padding re-alignment (data rows) + separator dash-count re-alignment.
2. §9.7.5 table — same (36 schema rows; all data identical).
3. One trailing blank line at line 1036.

No requirement was added, modified, or removed.

## 2. ZERO downstream impact (verified via grep)

- **No code parses PRD table cell formatting for behavior.** The ONLY table-aware line in
  `src/` is `src/core/prd-differ.ts:324` `const hasTables = /\|.*\|/.test(content);` — a
  boolean presence check used to pick a diff strategy, NOT cell-format extraction. Table
  re-alignment does not change `hasTables` (true either way).
- **No config values live in PRD tables** — all tunables are in `src/config/constants.ts`
  (the `.hack` schema in §9.7.5 documents them; it doesn't drive them).
- **No test fixture asserts exact table formatting** — `tests/` greps for table-pipe parsing
  return only `build-logger.ts` (BUILD_LOG.md generation, unrelated to PRD parsing).
- **docs/ + README** reference the `.hack` config conceptually, not the per-row table bytes.

Conclusion: **zero source/config/test/docs changes are required for this delta.**

## 3. The change classifier (src/core/change-classifier.ts) — LLM-driven, mocked in tests

- `classifyChange(diffSummary: DiffSummary): Promise<'COSMETIC'|'SUBSTANTIVE'>` — calls a QA
  agent over the DiffSummary; validates the response against `z.enum(['COSMETIC','SUBSTANTIVE'])`;
  throws a transient AgentError on status:'error'/no-data. `classifyChangeWithRetry` wraps it
  with bounded retry + **protective SUBSTANTIVE default** on exhaustion (§4.3).
- **It is NOT a heuristic** — it does not deterministically detect "table realignment". In unit
  tests the agent is `vi.mock`'d, so a test only proves the WIRING (DiffSummary → prompt → agent
  → validated output), not the LLM's real judgment.
- `DiffSummary` shape (`prd-differ.ts:112`): `{ changes: {type:'added'|'modified'|'removed',
  sectionTitle, lineNumber, oldContent?, newContent?, impact}[], summaryText, stats }`.
  `parsePRDSections` extracts by markdown HEADERS (`#`), so this delta's realistic fixture is
  **two 'modified' sections** (§9.7.3, §9.7.5) whose oldContent/newContent differ ONLY in table
  padding.

## 4. Existing classifier test coverage

`tests/unit/core/change-classifier.test.ts` ALREADY has:
- `it('SHOULD return COSMETIC on a successful COSMETIC response')` (line 136) — mocks agent →
  `{status:'success', data:'COSMETIC'}`, asserts `classifyChange(fixture) === 'COSMETIC'`.
- `createDiffFixture()` (line 61) builds a GENERIC DiffSummary ("Performance added / Auth
  modified") — NOT a table-realignment/whitespace-only fixture.
- It asserts the DiffSummary is threaded verbatim into the prompt generator (line 131).

So the COSMETIC **wiring** is already covered. The fixture does NOT specifically represent the
markdown-table-realignment pattern of THIS delta.

## 5. Actionable output (minimal + honest)

Because the classifier is an LLM pass-through, the fixture's specific content is decorative for
the wiring test — the existing COSMETIC test IS sufficient at the wiring level. To genuinely
"cover this specific pattern" (the contract's `if such a test exists, verify it covers this
specific pattern`) AND add documentation/regression value, add **ONE focused test case**:
- A new fixture builder `createCosmeticTableDiffFixture()` returning a DiffSummary with two
  'modified' sections (titles `§9.7.3`/`§9.7.5`-style) whose oldContent/newContent differ only
  in markdown table column padding (copy a snippet of the actual before/after).
- `it('classifies a whitespace-only markdown-table-realignment DiffSummary as COSMETIC', ...)`
  mocks the agent → COSMETIC, asserts `classifyChange(fixture) === 'COSMETIC'`, and asserts the
  fixture is passed verbatim to the prompt (mirroring line 131).

This documents the specific scenario. It does NOT (and cannot, in a mocked unit test) prove the
real LLM judges table realignment as COSMETIC — that's an inherent property of the LLM-driven
design, noted honestly.

## 6. The architecture-note assertion (contract OUTPUT #4)

Record in the PRP (and the implementation agent surfaces it): **"Session 010 delta is rigorously
proven cosmetic (semantic-char-only byte equality; both tables' normalized data rows identical).
Zero implementation work: no source/config/test/docs changes required. The only artifact is an
optional documentation test case. Downstream action = absorb as new baseline (≡ `--accept-prd-changes`
per §4.3)."**

## 7. Validation

- Cosmetic proof commands (§1) — re-runnable, deterministic.
- `grep` proof no code parses table formatting (§2).
- `npx vitest run tests/unit/core/change-classifier.test.ts` — green (existing) + the new case green.
- `npm run typecheck && npm run lint && npm run format:check` — clean (only if the test case is added).
- NO `npm run test:run` regression risk — the change is test-only (one new case) or zero-code.