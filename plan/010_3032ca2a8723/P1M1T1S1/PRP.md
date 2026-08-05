# PRP — P1.M1.T1.S1: Confirm PRD diff is purely cosmetic and verify zero downstream impact

> **Verification task** (not a feature build). Session 010 was spawned because `PRD.md`
> bytes changed from session 009's `prd_snapshot.md`. This PRP's job is to (1) rigorously
> PROVE the delta is 100% cosmetic, (2) confirm zero downstream code/config/test/docs
> impact, (3) add one documentation test case so the change classifier's COSMETIC path is
> exercised against the specific markdown-table-realignment pattern of THIS delta.

---

## Goal

**Feature Goal**: Prove — with deterministic, re-runnable commands, not just the architecture
doc's assertion — that the session-009→010 PRD diff is purely cosmetic (markdown table column
re-alignment + one trailing blank line), confirm no source/config/test/docs code depends on the
PRD's table formatting, and lock that conclusion in with (a) a written assertion and (b) one
focused classifier test case covering the table-realignment pattern.

**Deliverable**:
1. **Rigorous cosmetic proof** — the deterministic commands (semantic-char-only byte equality +
   per-table normalized-row equality) captured as the success evidence.
2. **Zero-impact confirmation** — `grep` proof that no `src/` code parses PRD table cell
   formatting for behavior.
3. **One test case** added to `tests/unit/core/change-classifier.test.ts`:
   `createCosmeticTableDiffFixture()` + `it('classifies a whitespace-only markdown-table-realignment
   DiffSummary as COSMETIC', …)`.
4. **Written assertion** (this PRP §"Conclusion / Architecture Note") that the delta requires
   zero implementation work.

**Success Definition**:
- `diff <(tr -d ' \t\n|-' < plan/009_94353b1a9fd3/prd_snapshot.md) <(tr -d ' \t\n|-' < PRD.md)`
  produces **no output** (byte-identical after stripping whitespace+pipes+dashes).
- Both tables' normalized data rows (separator dropped, cells trimmed) are identical old vs new.
- `grep` confirms no `src/` behavioral code parses PRD table cell formatting (only
  `prd-differ.ts:324`'s boolean presence check, which is format-agnostic).
- `npx vitest run tests/unit/core/change-classifier.test.ts` is green, including the new
  table-realignment COSMETIC case.
- (If the test case is added) `npm run typecheck && npm run lint && npm run format:check` clean.
- **No source/config/docs files are modified** — the only edit is the one test case (test-only).

---

## Why

- **Avoids phantom work.** A naive reading of the 96-line `diff` (or the 10-line `diff -w`)
  looks like a real PRD change. The rigorous proof prevents the pipeline (or a human) from
  spawning a substantive delta session, re-decomposing tasks, or editing docs for what is
  actually zero-semantic-change formatting.
- **Locks in the §4.3 cosmetic-classification contract.** PRD §4.3 step 1 says trivial
  whitespace/formatting changes are COSMETIC. Adding a test case that uses the *actual*
  table-realignment pattern of this delta documents that path and guards against a future
  heuristic pre-filter that might mis-handle it.
- **Honesty about the classifier's nature.** The classifier is LLM-driven
  (`classifyChange` → QA agent → `z.enum` validation). A unit test mocks the agent, so it proves
  the WIRING, not the LLM's real judgment. The PRP states this explicitly so no one mistakes the
  test for a guarantee that real LLM calls will always return COSMETIC for table realignment.

---

## What

### User-visible behavior
None. This is an internal verification + one test-only change. No user/config/API surface change
(Mode A = the written assertion + test JSDoc). The cosmetic delta itself lives in `PRD.md`
(human-owned, read-only — NOT modified by this task).

### Technical requirements (exact contract)

**(a) Rigorous cosmetic proof (verification commands — re-run and capture output):**
```bash
# Strongest proof: strip ALL whitespace, table pipes, and separator dashes → must be byte-identical.
diff <(tr -d ' \t\n|-' < plan/009_94353b1a9fd3/prd_snapshot.md) <(tr -d ' \t\n|-' < PRD.md)
# Expected: NO output (identical).

# Per-table: drop separator rows, trim cells, sort → identical.
norm() { sed -n "$1p" "$2" | grep -v '^ *[|] *[-]\{2,\} *[|]' | tr -d ' ' | sort; }
diff <(norm '832,836' plan/009_94353b1a9fd3/prd_snapshot.md) <(norm '832,836' PRD.md)   # §9.7.3 table → identical
diff <(norm '858,897' plan/009_94353b1a9fd3/prd_snapshot.md) <(norm '858,897' PRD.md)   # §9.7.5 table → identical
```
The complete delta is exactly: (1) §9.7.3 column-padding + separator dash re-alignment,
(2) §9.7.5 same (36 rows), (3) one trailing blank line at 1036.

> NOTE: `diff -w` (ignore whitespace) returns 10 lines — that is a FALSE ALARM: it flags the
> separator rows (`| ----- |` → `| ------------- |`) because dashes are not whitespace. The
> semantic-char-only diff above is the correct proof.

**(b) Zero-impact confirmation:**
```bash
# No src/ behavioral code parses PRD table cell formatting (only prd-differ.ts:324 boolean presence).
grep -rn "split('|')\|markdown.*table.*parse\|table.*cell" src/ | grep -v '.test.ts'
# Expected: no behavioral hits (build-logger.ts mentions tables but generates BUILD_LOG.md, unrelated).
```

**(c) One test case** in `tests/unit/core/change-classifier.test.ts` (append, mirror the existing
mock pattern at lines 22–54):
- A `createCosmeticTableDiffFixture(): DiffSummary` builder returning two `type:'modified'`
  sections (e.g. `sectionTitle: '9.7.3 Discovery, Layering & File Locations'` and
  `'9.7.5 Schema Reference'`) whose `oldContent`/`newContent` differ ONLY in markdown table
  column padding (copy a short before/after snippet from the actual diff). `stats.totalModified = 2`,
  `sectionsAffected: [<the two titles>]`.
- `it('classifies a whitespace-only markdown-table-realignment DiffSummary as COSMETIC', async () => { … })`
  that calls `mockAgentResponse({ status: 'success', data: 'COSMETIC' })`, invokes
  `await classifyChange(fixture)`, asserts `result === 'COSMETIC'`, AND asserts
  `mockCreateChangeClassificationPrompt` was called with `fixture` (verbatim threading, mirroring
  line 131). Include a comment: the agent is mocked — this proves wiring, not real LLM judgment.

### Success Criteria
- [ ] Semantic-char-only `diff` of the two PRDs → no output (byte-identical).
- [ ] Both tables' normalized data rows identical (old vs new).
- [ ] `grep` confirms no `src/` behavioral code parses PRD table cell formatting.
- [ ] New `createCosmeticTableDiffFixture` + COSMETIC case added; `classifyChange(fixture) === 'COSMETIC'`.
- [ ] Existing classifier tests still green; `npm run typecheck && npm run lint && npm run format:check` clean.
- [ ] **No source/config/docs files modified** (test-only edit).

---

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed to implement
this successfully?_ **Yes** — the deterministic proof commands (with expected outputs), the
zero-impact grep, the exact test file + mock pattern to mirror (with line numbers), the
DiffSummary shape for a realistic fixture, and the honest caveat about the LLM-driven classifier
are all specified below.

### Documentation & References

```yaml
# MUST READ — the delta analysis (asserts cosmetic; this PRP proves it rigorously)
- docfile: plan/010_3032ca2a8723/architecture/delta-analysis.md
  section: "Delta Classification: COSMETIC" and "Impact Assessment"
  why: States the cosmetic claim + the zero-impact table. This PRP replaces the claim with
        deterministic proof (semantic-char-only byte equality) and notes the `diff -w` false alarm.

# MUST READ — rigorous proof + scope decision (authored with this PRP)
- docfile: plan/010_3032ca2a8723/P1M1T1S1/research/cosmetic-delta-verification.md
  section: "1. RIGOROUS PROOF" and "5. Actionable output"
  why: The semantic-char-only equality commands, the per-table normalization, the `diff -w` false
        alarm explanation, and the decision to add ONE documentation test case.

# PATTERN FILE 1 — the classifier under test
- file: src/core/change-classifier.ts
  why: classifyChange(diffSummary) → QA agent → z.enum(['COSMETIC','SUBSTANTIVE']) validation.
        LLM-driven (NOT a heuristic). Tests mock the agent, so they prove wiring, not real judgment.
  pattern: "export async function classifyChange(diffSummary): Promise<ChangeClassification> { const response = await agent.prompt(prompt); … }"
  gotcha: The classifier has NO table-realignment-specific logic — it passes the DiffSummary to the
        LLM. So a unit test's fixture content is decorative for the wiring; its value is documentation.

# PATTERN FILE 2 — the test file to extend (mirror its mock pattern exactly)
- file: tests/unit/core/change-classifier.test.ts
  why: Already mocks agent-factory.js (L22) + change-classifier-prompt.js (L28); has
        createDiffFixture() (L61) and the COSMETIC case at L136. Add createCosmeticTableDiffFixture()
        + the new it(...) in the same describe, reusing mockAgentResponse (L93).
  pattern: "mockAgentResponse({ status:'success', data:'COSMETIC' }); const result = await classifyChange(fixture); expect(result).toBe('COSMETIC'); expect(mockCreateChangeClassificationPrompt).toHaveBeenCalledWith(fixture);"
  gotcha: The existing COSMETIC test (L136) uses a GENERIC fixture (Performance/Auth), not table
        realignment. The new case uses the actual §9.7.3/§9.7.5 table-padded before/after so the
        pattern is documented. Do NOT modify the existing tests — append only.

# VERIFIED FACTS
- fact: "diff -w returns 10 lines — FALSE ALARM (flags separator-row dashes, which aren't whitespace). Use the semantic-char-only diff instead."
- fact: "prd-differ.ts:324 `const hasTables = /\\|.*\\|/.test(content)` is a boolean presence check — format-agnostic. No behavioral code parses table cells."
- fact: "DiffSummary (prd-differ.ts:112) is section-based (parsePRDSections extracts by '#' headers). This delta's realistic fixture = 2 'modified' sections (§9.7.3, §9.7.5), content differs only in table padding."
- fact: "Classifier is LLM-driven → mocked in unit tests → test proves wiring, not real LLM judgment (state this in the test comment)."
```

### Current Codebase tree (relevant slice)

```bash
PRD.md                                # READ-ONLY (human-owned — the cosmetic delta lives here; NOT modified)
plan/009_94353b1a9fd3/prd_snapshot.md # READ-ONLY (the baseline for the cosmetic diff proof)
src/core/change-classifier.ts         # READ-ONLY (the classifier under test — NOT modified)
src/core/prd-differ.ts                # READ-ONLY (DiffSummary type + the L324 hasTables presence check)
tests/unit/core/change-classifier.test.ts  # EDIT — append createCosmeticTableDiffFixture + one it(...) case
```

### Desired Codebase tree with files to be added/edited

```bash
tests/unit/core/change-classifier.test.ts  # MODIFIED (append-only: 1 fixture builder + 1 test case)
# No source/config/docs changes. PRD.md is read-only. This is a verification + test-only task.
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — `diff -w` is NOT the right cosmetic proof here. It returns 10 lines because the
//   markdown table SEPARATOR rows (`| ----- |` → `| ------------- |`) differ in dash COUNT, and
//   dashes are not whitespace. Use the semantic-char-only diff (tr -d ' \t\n|-') → must be empty.

// CRITICAL — the classifier is LLM-DRIVEN, not a heuristic. classifyChange passes the DiffSummary
//   to a QA agent and validates the response. Unit tests MOCK the agent, so they prove the WIRING
//   (DiffSummary → prompt → agent → z.enum validation → return), NOT that a real LLM will always
//   return COSMETIC for table realignment. State this in the test comment — don't oversell it.

// GOTCHA — the existing COSMETIC test (change-classifier.test.ts:136) already covers the wiring
//   with a generic fixture. The new case ADDS pattern-specific documentation (table realignment),
//   it does not replace or duplicate the existing coverage. Append only; do not modify existing tests.

// GOTCHA — DiffSummary is section-based (parsePRDSections splits on '#' headers, not table rows).
//   So the realistic fixture for THIS delta is TWO 'modified' sections (§9.7.3 + §9.7.5), each with
//   oldContent/newContent differing only in table column padding — NOT a fixture of raw table rows.

// GOTCHA — do NOT modify PRD.md. It is human-owned read-only. The cosmetic delta is already IN it;
//   this task only verifies it and (optionally) adds a test. The downstream action is to absorb the
//   cosmetic change as the new baseline (≡ --accept-prd-changes per §4.3), which the orchestrator
//   handles by refreshing prd_snapshot.md — NOT by editing PRD.md.

// GOTCHA — prettier is ERROR-enforced. If the new fixture/case is added, run `npm run fix` before
//   format:check. Long markdown-table strings in the fixture may need prettier-stable formatting.

// GOTCHA — vitest.config.ts enforces 100% coverage on src/**/*.ts. This task adds NO src/ lines
//   (test-only), so coverage is unaffected. The existing change-classifier.ts is already at 100%.
```

---

## Implementation Blueprint

### Data models and structure
None new. The fixture reuses the existing `DiffSummary` interface (`prd-differ.ts:112`):
`{ changes: {type, sectionTitle, lineNumber, oldContent?, newContent?, impact}[], summaryText, stats }`.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: VERIFY cosmetic proof (run + capture, no file edits)
  - RUN: diff <(tr -d ' \t\n|-' < plan/009_94353b1a9fd3/prd_snapshot.md) <(tr -d ' \t\n|-' < PRD.md)
        → MUST produce no output (byte-identical after stripping whitespace+pipes+dashes).
  - RUN: the per-table normalized diffs (§9.7.3 lines 832-836; §9.7.5 lines 858-897) → identical.
  - RECORD: the proof output (or "no output") as the success evidence in the task result.
  - NOTE: `diff -w` returns 10 lines (separator-dash false alarm) — explain why it's not the proof.

Task 2: VERIFY zero downstream impact (run + capture, no file edits)
  - RUN: grep -rn "split('|')\|markdown.*table.*parse\|table.*cell" src/ | grep -v '.test.ts'
        → confirm no behavioral code parses PRD table formatting (prd-differ.ts:324 is a boolean
        presence check only; build-logger.ts is BUILD_LOG.md generation, unrelated).
  - RECORD: the grep result as evidence.

Task 3: EDIT tests/unit/core/change-classifier.test.ts — add the documentation case
  - APPEND a builder: createCosmeticTableDiffFixture(): DiffSummary returning TWO 'modified' sections
        (titles '9.7.3 Discovery, Layering & File Locations' + '9.7.5 Schema Reference'), with
        oldContent/newContent copied from a short snippet of the actual before/after (unaligned vs
        column-aligned table rows). stats: { totalAdded:0, totalModified:2, totalRemoved:0,
        sectionsAffected: [the two titles] }. summaryText: '2 sections modified (table formatting)'.
  - APPEND a case in the existing describe('GIVEN classifyChange', …):
        it('classifies a whitespace-only markdown-table-realignment DiffSummary as COSMETIC', async () => {
          const fixture = createCosmeticTableDiffFixture();
          mockAgentResponse({ status: 'success', data: 'COSMETIC' });
          const result = await classifyChange(fixture);
          expect(result).toBe('COSMETIC');
          expect(mockCreateChangeClassificationPrompt).toHaveBeenCalledWith(fixture); // verbatim threading
        });
  - ADD a comment in the case: "// The agent is mocked — this proves the classifier WIRING returns
        COSMETIC for a table-realignment DiffSummary, not that a real LLM always will (LLM-driven per §4.3)."
  - DO NOT modify existing tests or the production classifier. Append only.
  - PLACEMENT: tests/unit/core/change-classifier.test.ts (alongside the existing COSMETIC case at L136).

Task 4: FORMAT + VERIFY
  - RUN: npm run fix → npm run typecheck → npm run lint → npm run format:check (clean — test-only change).
  - RUN: npx vitest run tests/unit/core/change-classifier.test.ts → green (existing + new case).
  - EXPECTED: all green. If the new fixture triggers a type error, align its shape to DiffSummary exactly.

Task 5: WRITE the architecture-note assertion (in the task result / commit message)
  - "Session 010 delta is rigorously proven cosmetic (semantic-char-only byte equality; both tables'
        normalized data rows identical). Zero implementation work: no source/config/test/docs changes
        required beyond one documentation test case. Downstream action = absorb as new baseline
        (≡ --accept-prd-changes per §4.3)."
```

### Implementation Patterns & Key Details

```ts
// PATTERN — the cosmetic table-realignment fixture (DiffSummary; two modified sections, padding-only).
function createCosmeticTableDiffFixture(): DiffSummary {
  return {
    changes: [
      {
        type: 'modified',
        sectionTitle: '9.7.3 Discovery, Layering & File Locations',
        lineNumber: 832,
        oldContent: '| Layer | Path | Purpose |\n| ----- | ---- | ------- |\n| Project | `<repoRoot>/.hack` | Team-wide defaults. |',
        newContent: '| Layer   | Path                | Purpose             |\n| ------- | ------------------ | ------------------- |\n| Project | `<repoRoot>/.hack` | Team-wide defaults. |',
        impact: 'none',
      },
      {
        type: 'modified',
        sectionTitle: '9.7.5 Schema Reference',
        lineNumber: 858,
        oldContent: '| TOML key | Env var |\n| -------- | ------- |\n| `[models] high` | `PRP_MODEL_HIGH` |',
        newContent: '| TOML key        | Env var          |\n| --------------- | ---------------- |\n| `[models] high` | `PRP_MODEL_HIGH` |',
        impact: 'none',
      },
    ],
    summaryText: '2 sections modified (table formatting only)',
    stats: { totalAdded: 0, totalModified: 2, totalRemoved: 0, sectionsAffected: [
      '9.7.3 Discovery, Layering & File Locations', '9.7.5 Schema Reference',
    ] },
  };
}

// PATTERN — the test case (mirrors the existing COSMETIC case + verbatim-threading assertion).
it('classifies a whitespace-only markdown-table-realignment DiffSummary as COSMETIC', async () => {
  const fixture = createCosmeticTableDiffFixture();
  mockAgentResponse({ status: 'success', data: 'COSMETIC' });
  const result = await classifyChange(fixture);
  expect(result).toBe('COSMETIC');
  expect(mockCreateChangeClassificationPrompt).toHaveBeenCalledWith(fixture);
});

// PATTERN — the rigorous cosmetic proof (deterministic, re-runnable).
//   diff <(tr -d ' \t\n|-' < plan/009_.../prd_snapshot.md) <(tr -d ' \t\n|-' < PRD.md)
//   → no output = byte-identical after stripping whitespace+pipes+dashes = purely cosmetic.
```

### Integration Points

```yaml
NO SOURCE INTEGRATION: this task changes NO src/ files. The classifier (src/core/change-classifier.ts)
  is consumed unchanged. The test-only edit adds documentation coverage for the COSMETIC path.

DOWNSTREAM (orchestrator-level, NOT this task):
  - Absorb the cosmetic delta as the new baseline (refresh prd_snapshot.md to current PRD.md),
    equivalent to --accept-prd-changes (§4.3). This is the orchestrator's bookkeeping, not a code edit.
  - P1.M1.T2.S1 (doc sync) separately verifies README/CONFIGURATION/ARCHITECTURE/.env.example need
    no updates for this cosmetic delta (they don't — confirmed in delta-analysis.md §Impact).
```

---

## Validation Loop

### Level 1: Syntax & Style (only if Task 3 test case is added)

```bash
npm run fix                  # lint:fix + prettier --write (the table-string fixture may need it)
npm run typecheck            # clean — test-only change, no src/ edits
npm run lint && npm run format:check   # clean
# Expected: clean. If the fixture's inline table strings trip prettier, wrap them or run `npm run fix`.
```

### Level 2: Unit Tests (the COSMETIC case)

```bash
npx vitest run tests/unit/core/change-classifier.test.ts
# Expected: all green — existing COSMETIC/SUBSTANTIVE/transient-error cases + the new table-realignment
# COSMETIC case. The new case asserts classifyChange(fixture) === 'COSMETIC' AND verbatim threading.
```

### Level 3: The cosmetic proof (the PRIMARY acceptance gate — deterministic)

```bash
# Strongest proof — must be byte-identical after stripping whitespace + pipes + dashes:
diff <(tr -d ' \t\n|-' < plan/009_94353b1a9fd3/prd_snapshot.md) <(tr -d ' \t\n|-' < PRD.md)
# Expected: NO output.

# Per-table normalized data rows (separator dropped, cells trimmed) — identical:
norm() { sed -n "$1p" "$2" | grep -v '^ *[|] *[-]\{2,\} *[|]' | tr -d ' ' | sort; }
diff <(norm '832,836' plan/009_94353b1a9fd3/prd_snapshot.md) <(norm '832,836' PRD.md)   # §9.7.3 → identical
diff <(norm '858,897' plan/009_94353b1a9fd3/prd_snapshot.md) <(norm '858,897' PRD.md)   # §9.7.5 → identical
# Expected: no output from either.

# Zero behavioral dependency on table formatting:
grep -rn "split('|')\|markdown.*table.*parse" src/ | grep -v '.test.ts'   # → no behavioral hits
```

### Level 4: Creative & Domain-Specific Validation

```bash
# N/A — a verification task with no runtime/creative surface. Domain checks (record in commit msg):
#   - Semantic-char-only byte equality proves zero text added/removed/changed anywhere in the PRD.
#   - `diff -w` ≠ 0 is a false alarm (separator dashes); documented so no one re-opens this as "real change".
#   - The classifier test documents the table-realignment COSMETIC path (wiring-level; LLM judgment noted).
```

---

## Final Validation Checklist

### Technical Validation
- [ ] Semantic-char-only `diff` of the two PRDs → no output (byte-identical).
- [ ] Both tables' normalized data rows identical (§9.7.3 + §9.7.5).
- [ ] `grep` confirms no `src/` behavioral code parses PRD table cell formatting.
- [ ] `npm run typecheck && npm run lint && npm run format:check` clean (test-only change).
- [ ] `npx vitest run tests/unit/core/change-classifier.test.ts` green (incl. new case).

### Feature Validation
- [ ] Delta proven purely cosmetic (column padding + separator re-alignment + one blank line).
- [ ] No requirement added/modified/removed (proven by semantic-char equality).
- [ ] New `createCosmeticTableDiffFixture` + COSMETIC case present; asserts COSMETIC + verbatim threading.
- [ ] Test comment states the LLM-driven caveat (wiring proof, not real-judgment guarantee).

### Code Quality Validation
- [ ] Only `tests/unit/core/change-classifier.test.ts` modified (append-only: 1 fixture + 1 case).
- [ ] No source/config/docs files modified. PRD.md untouched (read-only).
- [ ] Existing classifier tests unchanged; new case mirrors their mock pattern.
- [ ] The fixture's DiffSummary shape matches `prd-differ.ts:112` exactly.

### Documentation & Deployment
- [ ] Written assertion (commit message / task result): "Session 010 delta rigorously proven cosmetic; zero implementation work; absorb as baseline (≡ --accept-prd-changes)."
- [ ] Test comment documents the table-realignment COSMETIC path + the LLM-driven caveat.

---

## Conclusion / Architecture Note (contract OUTPUT #4)

**Session 010 delta is rigorously proven COSMETIC.** The deterministic proof: after stripping all
whitespace, table pipes, and separator dashes, `plan/009_94353b1a9fd3/prd_snapshot.md` and `PRD.md`
are **byte-identical**; both affected tables' normalized data rows are identical. The complete
delta is (1) §9.7.3 column-padding + separator re-alignment, (2) §9.7.5 same (36 rows), (3) one
trailing blank line. No requirement was added, modified, or removed.

**Zero implementation work.** No source/config/test/docs code depends on PRD table formatting
(`prd-differ.ts:324` is a format-agnostic boolean presence check). The only artifact is one
documentation test case for the change classifier's COSMETIC path. **Downstream action: absorb
the cosmetic change as the new baseline** (refresh `prd_snapshot.md` to current `PRD.md`),
equivalent to `--accept-prd-changes` per §4.3.

---

## Anti-Patterns to Avoid

- ❌ Don't use `diff -w` as the cosmetic proof — it returns 10 lines (separator-dash false alarm). Use the semantic-char-only diff (`tr -d ' \t\n|-'`).
- ❌ Don't treat the 96-line raw `diff` as "a big change" — it's column padding across two tables; the semantic-char diff proves zero text change.
- ❌ Don't modify `PRD.md` — it's human-owned read-only; the cosmetic delta is already in it.
- ❌ Don't modify `src/core/change-classifier.ts` or any source file — this is test-only (one documentation case).
- ❌ Don't claim the unit test "guarantees the LLM returns COSMETIC for table realignment" — the agent is mocked; the test proves wiring only. State the caveat.
- ❌ Don't duplicate or modify the existing COSMETIC test (L136) — append a pattern-specific case alongside it.
- ❌ Don't spawn a substantive delta session / re-decompose tasks / edit docs for this delta — it's proven cosmetic (zero semantic change).
- ❌ Don't make the fixture a raw-table-rows shape — `DiffSummary` is section-based (`parsePRDSections` splits on `#` headers); use two 'modified' sections with padding-only oldContent/newContent.
- ❌ Don't skip the verbatim-threading assertion (`toHaveBeenCalledWith(fixture)`) — it's the part that proves the fixture actually reaches the prompt.

---

## Confidence Score

**10/10** — one-pass success likelihood.

Rationale: This is a verification task whose headline conclusion is **already deterministically
proven** in this PRP (semantic-char-only byte equality; both tables' normalized rows identical).
The zero-impact claim is grep-verified (only `prd-differ.ts:324`'s boolean presence check touches
tables; it's format-agnostic). The single code artifact — one test case — mirrors an existing,
passing test (`change-classifier.test.ts:136`) with an established mock pattern (`mockAgentResponse`),
so its one-pass success is essentially guaranteed. The one nuance (the classifier is LLM-driven, so
the test proves wiring not real judgment) is explicitly documented so no one over-claims the coverage.
There are no external/runtime unknowns.