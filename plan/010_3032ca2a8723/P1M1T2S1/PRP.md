# PRP — P1.M1.T2.S1: Verify README, CONFIGURATION, ARCHITECTURE, and .env.example need no updates for the cosmetic delta

> **Verification task** (documentation sync for a cosmetic PRD delta). Session 010's PRD change is
> purely cosmetic (markdown-table column-padding + separator re-alignment of §9.7.3 + §9.7.5, plus one
> trailing blank line — proven in P1.M1.T1.S1). **This task verifies NO documentation file contains a
> verbatim copy of either PRD table that would need the same re-alignment.** The verified outcome: none
> do — the docs re-express the same info in their own column structures. Deliverable = a documented
> finding (re-runnable grep evidence), not a file edit. This IS the documentation-sync task.

---

## Goal

**Feature Goal**: Verify — with deterministic, re-runnable commands — that none of `README.md`,
`docs/CONFIGURATION.md`, `docs/ARCHITECTURE.md`, or `.env.example` contains a **verbatim copy** of the
PRD's §9.7.3 table (`Layer | Path | Purpose | Git-tracked? | Secrets allowed?`) or §9.7.5 table
(`TOML key | Env var | CLI flag | Type | Default`) whose column padding would need to track the PRD's
cosmetic re-alignment. Document the finding. Update a doc ONLY if an unexpected verbatim copy is found.

**Deliverable**:
1. **Re-runnable verification evidence** — the grep commands (distinctive-table-header search +
   per-file content cross-check) captured as the success proof.
2. **A verified written assertion** (task result / commit message): "No documentation file contains a
   verbatim copy of PRD §9.7.3 or §9.7.5; the docs use doc-native table formats; zero updates required
   for the cosmetic delta."
3. **(Conditional) a doc edit** — ONLY if the re-run grep reveals a verbatim table copy not present at
   research time. (Expected: this does NOT trigger — see research note §2.)

**Success Definition**:
- `grep -rln` for the §9.7.3 distinctive header tokens (`Git-tracked`, `Secrets allowed`) across
  `README.md` + `docs/` → **no output** (no verbatim §9.7.3 copy).
- `grep -rln` for the §9.7.5 distinctive header/row tokens (`TOML key.*Env var.*CLI flag`,
  `[models] high.*PRP_MODEL_HIGH`) across `README.md` + `docs/` + `.env.example` → **no output**.
- Per-file cross-check confirms each doc's §9.7-related content uses a **doc-native column structure**
  (3-col / 4-col), not the PRD's 5-col tables — so the PRD's re-alignment has zero transitive effect.
- **No source/config/test files modified.** At most one doc file edited — and only if the re-run grep
  finds a verbatim copy (not expected).
- (If a doc IS edited) `npm run format:check` clean on the touched markdown.

---

## Why

- **Closes the doc-sync loop for the cosmetic delta.** P1.M1.T1.S1 proved the PRD delta is cosmetic
  and has zero code/config/test impact. T2.S1 closes the last axis — docs — by proving no doc mirrors
  the PRD's table formatting closely enough to drift. Together they establish "zero implementation
  work" comprehensively (code + config + tests + docs).
- **Prevents phantom doc edits.** A naive reading ("the PRD's schema table changed → update
  CONFIGURATION.md") would spawn unnecessary churn. The verification proves CONFIGURATION.md already
  uses its OWN 3-col summary table and 4-col env-var tables — independent of the PRD's 5-col schema
  table — so there is nothing to re-align.
- **Locks the finding as re-runnable.** The greps are deterministic and stable; re-running them after
  any future doc edit reproduces the same conclusion unless someone deliberately pastes a raw PRD table
  into a doc (which the fallback path then catches).
- **Scope discipline.** T2.S1 = verification + documented finding (+ conditional edit). It does NOT
  modify `PRD.md` (read-only), source, config, or tests. It depends on P1.M1.T1.S1's cosmetic
  confirmation (CONTRACT — assume the proof is recorded).

---

## What

### User-visible behavior
None. This is an internal documentation-verification task. No user/config/API/runtime surface changes.
The cosmetic delta itself lives in `PRD.md` (human-owned, read-only — NOT modified).

### Technical requirements (exact contract)

**(a) Verification — re-run and capture (deterministic, re-runnable):**
```bash
# §9.7.3 verbatim-copy search: the PRD table's distinctive header columns appear in NO doc.
grep -rln "Git-tracked\|Secrets allowed" README.md docs/
# Expected: NO output (no doc reproduces the §9.7.3 5-col header).

# §9.7.5 verbatim-copy search: the PRD schema table's distinctive header + a canonical row.
grep -rln "TOML key.*Env var.*CLI flag\|\[models\] high.*PRP_MODEL_HIGH" README.md docs/ .env.example
# Expected: NO output (no doc reproduces the §9.7.5 5-col header / row shape).

# Content cross-check (docs DO carry the values, in their own formats — confirms doc-native, not stale):
grep -rln "PRP_MODEL_HIGH\|glm-5-turbo\|pizr\|PRP_API_BASE_URL" README.md docs/ .env.example
# Expected: README.md, docs/CONFIGURATION.md, docs/ARCHITECTURE.md, docs/INSTALLATION.md, .env.example
#   (values present — but the per-file inspection below confirms they're in doc-native table shapes,
#    NOT verbatim PRD-table copies).
```

**(b) Per-file finding (confirm each doc's §9.7 content uses a doc-native column structure):**

| File | §9.7-related content | Column structure | Verbatim PRD table? |
|---|---|---|---|
| `docs/CONFIGURATION.md` | §9.7.3 tier table (~L74–78); §9.7.5 summary table (~L89–103); own env-var tables (L50, L151, L192–194); models tier table (L413–415) | 4-col `Tier\|File\|Committable?\|Secrets?`; 3-col `[section]\|Keys\|Maps to env`; 4-col `Variable\|Required\|Default\|Description` | **No** — all doc-native |
| `README.md` | §9.7.3 tier table (~L366–368); 2 conceptual `.hack` refs (L113, L357–377) | 4-col `Global\|path\|n/a\|Refused` | **No** — no §9.7.5 table at all |
| `docs/ARCHITECTURE.md` | Conceptual `.hack` refs (L89, L141–151); delegates full schema to CONFIGURATION.md (L150–151) | no §9.7 table copy (own `Step\|Detail\|File\|PRD ref` table at L120 is unrelated) | **No** |
| `.env.example` | plain `KEY=value` assignments (L34, L55–61) | no markdown tables at all | **No** (structurally impossible) |

Confirm via `grep -n` that the doc tables' header rows are NOT the PRD's 5-col headers (e.g.
`grep -n "^| Tier\|^| Global\|^| \[section\]\|^| Variable" docs/CONFIGURATION.md README.md` → the
doc-native headers, never `| Layer |` or `| TOML key |`).

**(c) Conditional fallback — IF a verbatim copy is found (NOT expected):**
If the re-run grep unexpectedly returns a doc file (meaning someone pasted a raw PRD table into it),
re-align THAT table's columns to match the PRD's current formatting — BUT drop it into the doc's
existing table style (don't paste raw PRD markdown; the docs deliberately use their own column
structures). Then `npm run format:check` the touched file. (Research note §2 proves this won't trigger.)

### Success Criteria
- [ ] §9.7.3 distinctive-header grep → no output.
- [ ] §9.7.5 distinctive-header/row grep → no output.
- [ ] Per-file cross-check confirms each doc uses a doc-native column structure (not the PRD's 5-col tables).
- [ ] No source/config/test files modified.
- [ ] Written assertion recorded (task result / commit message).
- [ ] (Conditional) any doc edit + `npm run format:check` clean — only if the fallback triggered.

---

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed?_ **Yes** — the
deterministic verification greps (with expected outputs), the per-file table-structure inventory
(with line numbers + column shapes), the proof that doc-native tables are immune to the PRD's
column-width change, and the fallback procedure are all below.

### Documentation & References

```yaml
# MUST READ — the cosmetic-delta proof this task complements (CONTRACT — assume recorded)
- file: plan/010_3032ca2a8723/P1M1T1S1/PRP.md
  why: Proves the PRD delta is purely cosmetic (semantic-char-only byte equality) and has zero
        code/config/test impact. T2.S1 closes the docs axis on the same "zero work" conclusion.
  critical: The delta is column-PADDING + separator-dash re-alignment of TWO specific 5-col PRD
        tables (§9.7.3, §9.7.5). A doc is affected ONLY if it reproduces one VERBATIM.

# MUST READ — the verification findings (authored with this PRP; the greps are re-runnable)
- docfile: plan/010_3032ca2a8723/P1M1T2S1/research/doc-sync-verification.md
  section: "2. The verification (DONE)" and "3. Why doc-native tables are immune"
  why: The exact greps + expected (empty) outputs, the per-file column-structure inventory, and the
        proof that doc-native 3/4-col tables are independent of the PRD's 5-col table widths. READ
        BEFORE IMPLEMENTING — it is the pre-done verification the implementer re-runs/confirms.

# MUST READ — the doc analysis (asserts no doc impact; this PRP proves it per-file)
- docfile: plan/010_3032ca2a8723/architecture/implementation_status.md
  section: "Cross-Cutting Requirements > §9.7 .hack Configuration File" + the closing Summary
  why: States §9.7 is FULLY IMPLEMENTED and "this delta session (010) was triggered by a purely
        cosmetic PRD change … No implementation work is required." T2.S1 is the docs-level proof.

# READ-ONLY — the doc files under verification (inspect, do NOT edit unless the fallback triggers)
- file: docs/CONFIGURATION.md
  why: 53KB; the doc most likely to MIRROR the PRD schema. Verified: it does NOT — §9.7.3 is a 4-col
        tier table (L74–78), §9.7.5 is a 3-col summary table (L89–103), env vars are in its own
        4-col `Variable|Required|Default|Description` tables (L50, L151, L192–194).
  gotcha: Do NOT "re-align" these to the PRD — they are intentionally doc-native reformats. Their
        column widths are determined by their own content, not the PRD's.

- file: README.md
  why: Has a 4-col §9.7.3 tier table (L366–368) mirroring CONFIGURATION.md's shape (NOT the PRD's
        5-col table); 2 conceptual `.hack` refs. No §9.7.5 table.

- file: docs/ARCHITECTURE.md
  why: Refers to `.hack` conceptually (L89, L141–151) and DELEGATES the full schema to CONFIGURATION.md
        (L150–151). No §9.7.3/§9.7.5 table copy. Its bootstrap table (L120) is an unrelated 4-col format.

- file: .env.example
  why: Plain `KEY=value` assignments (L34 PRP_API_BASE_URL, L55–61 PRP_MODEL_HIGH/BALANCED/FAST). No
        markdown tables — a verbatim table copy is structurally impossible here.

# READ-ONLY — the PRD tables whose formatting changed (the cosmetic delta)
- docfile: PRD.md
  section: "§9.7.3 Discovery, Layering & File Locations" (5-col table) and "§9.7.5 Schema Reference" (5-col × ~36-row table)
  why: These are the two tables whose column PADDING changed. A doc is affected only if it copies one
        VERBATIM (same 5-col header). (Also inline in this PRP's <selected_prd_content>.)

# VERIFIED FACTS
- fact: "grep for the §9.7.3 header tokens ('Git-tracked', 'Secrets allowed') across README.md + docs/ → NO output."
- fact: "grep for the §9.7.5 header ('TOML key.*Env var.*CLI flag') + canonical row ('[models] high.*PRP_MODEL_HIGH') → NO output."
- fact: "docs/CONFIGURATION.md §9.7.3 coverage is a 4-col tier table (Tier|File|Committable?|Secrets?); §9.7.5 is a 3-col summary ([section]|Keys|Maps to env). Neither is the PRD's 5-col table."
- fact: ".env.example has no markdown tables at all (plain KEY=value)."
- fact: "Doc-native tables' column widths are determined by their own content, so the PRD's column-padding change has zero transitive effect on them."
```

### Current Codebase tree (relevant slice)

```bash
README.md                # VERIFY (4-col §9.7.3 tier table; conceptual .hack refs) — no verbatim PRD table
docs/CONFIGURATION.md    # VERIFY (4-col tier + 3-col summary + own env-var tables) — no verbatim PRD table
docs/ARCHITECTURE.md     # VERIFY (conceptual refs; delegates schema to CONFIGURATION.md) — no table copy
.env.example             # VERIFY (plain KEY=value; no markdown tables) — no table copy possible
PRD.md                   # READ-ONLY (human-owned; the cosmetic delta lives here — NOT modified)
plan/010_3032ca2a8723/architecture/implementation_status.md  # READ-ONLY (the doc-analysis assertion)
```

### Desired Codebase tree with files to be added/edited

```bash
# PRIMARY PATH (expected): NO files edited. Deliverable = the written assertion (task result / commit msg).
# FALLBACK PATH (not expected): at most ONE of README.md / docs/CONFIGURATION.md / docs/ARCHITECTURE.md
#   edited to re-align a verbatim table copy — ONLY if the re-run grep finds one.
# No source/config/test changes. PRD.md never modified.
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — the cosmetic delta changes COLUMN PADDING inside two specific 5-col PRD tables. A doc is
//   affected ONLY if it reproduces one VERBATIM (same header, same row shape). The verification greps
//   target the distinctive headers; empty output = no verbatim copy = nothing to re-align.

// CRITICAL — docs/CONFIGURATION.md and README.md DO have §9.7.3-derived tier tables, but with a 4-col
//   structure (Tier|File|Committable?|Secrets?) — NOT the PRD's 5-col table. Do NOT "fix" these by
//   re-aligning them to the PRD; they are intentionally doc-native reformats whose widths are
//   self-determined. Editing them would be phantom work (the PRD change doesn't affect them).

// CRITICAL — .env.example has NO markdown tables (plain KEY=value). A verbatim table copy is
//   structurally impossible there. Don't "re-align" env-var assignments — they aren't tables.

// CRITICAL — do NOT modify PRD.md. It is human-owned read-only; the cosmetic delta is already in it.
//   This task only VERIFIES the docs don't mirror its table formatting.

// GOTCHA — the content cross-check grep (PRP_MODEL_HIGH/glm-5-turbo/pizr) WILL return the doc files —
//   that's EXPECTED (the docs carry the values in their own formats). It is NOT evidence of a verbatim
//   table copy. The verbatim-copy evidence is the HEADER greps (Git-tracked / TOML key | Env var | CLI
//   flag), which return empty.

// GOTCHA — prettier is ERROR-enforced on markdown. IF the fallback path edits a doc, run
//   `npm run fix` (or `npx prettier --write <file>`) before `npm run format:check`. The primary path
//   (no edits) has no format gate.

// GOTCHA — the finding is deterministic and re-runnable. If a future doc edit pastes a raw PRD table,
//   re-running these greps will surface it (the header tokens will match) — that's the regression net.

// GOTCHA — this task does NOT add tests. It's a docs-verification task (the item's "DOCS: this IS the
//   documentation sync task"). No src coverage impact (no src edits).
```

---

## Implementation Blueprint

### Data models and structure
None — this is a verification task. No types/classes/source. The "structure" is the per-file
table-format inventory (above) + the verification greps.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: RE-RUN the verbatim-copy verification greps (capture output — no edits)
  - RUN: grep -rln "Git-tracked\|Secrets allowed" README.md docs/
        → EXPECT no output (no §9.7.3 verbatim copy).
  - RUN: grep -rln "TOML key.*Env var.*CLI flag\|\[models\] high.*PRP_MODEL_HIGH" README.md docs/ .env.example
        → EXPECT no output (no §9.7.5 verbatim copy).
  - IF both are empty (EXPECTED): proceed to Task 2 (document the finding). No file edits.
  - IF either returns a file (UNEXPECTED): proceed to Task 3 (the fallback edit).

Task 2: CONFIRM per-file doc-native structure (capture — no edits)
  - RUN: grep -n "^| Tier\|^| Global\|^| \[section\]\|^| Variable\|^| Command" docs/CONFIGURATION.md README.md
        → confirm the doc-native header rows exist (Tier/Global/[section]/Variable/Command), NOT the
        PRD's "| Layer |" / "| TOML key |".
  - RUN: grep -rln "PRP_MODEL_HIGH\|glm-5-turbo\|PRP_API_BASE_URL" README.md docs/ .env.example
        → confirm values ARE present (doc-native carry) — this is expected, NOT a verbatim-copy signal.
  - RECORD: the per-file finding (CONFIGURATION.md 4-col tier + 3-col summary; README 4-col tier;
        ARCHITECTURE delegates; .env.example plain KEY=value) as evidence the docs are immune to the
        PRD's column-width change.

Task 3 (FALLBACK — only if Task 1 returned a file; NOT expected): re-align the verbatim copy
  - IDENTIFY the doc file + table the grep flagged.
  - RE-ALIGN that table's column padding to match the PRD's current formatting — BUT keep it in the
        doc's own table style (do NOT paste raw PRD markdown; the docs deliberately use their own
        column structures). The goal is column consistency within the doc, not mirroring the PRD byte-
        for-byte.
  - RUN: npx prettier --write <touched file> → npm run format:check (clean on the touched markdown).
  - NOTE in the task result: which file/table was re-aligned and why (the grep caught a verbatim copy).
  - (Per research note §2, this task is not expected to execute.)

Task 4: WRITE the verified assertion (task result / commit message)
  - ASSERTION: "Verified: no documentation file (README.md, docs/CONFIGURATION.md, docs/ARCHITECTURE.md,
        .env.example) contains a verbatim copy of PRD §9.7.3 or §9.7.5. The docs re-express the .hack
        schema/layering in doc-native table formats (CONFIGURATION.md: 4-col tier + 3-col section
        summary + own env-var tables; README: 4-col tier + conceptual refs; ARCHITECTURE: delegates to
        CONFIGURATION; .env.example: plain KEY=value, no tables). The PRD's cosmetic column-padding
        change therefore requires ZERO documentation updates. [Fallback did/did-not trigger.]"
  - This assertion IS the deliverable (alongside the captured grep evidence from Tasks 1–2).
```

### Implementation Patterns & Key Details

```bash
# PATTERN — the verbatim-copy verification (deterministic, re-runnable; empty output = pass).
# §9.7.3 (5-col: Layer|Path|Purpose|Git-tracked?|Secrets allowed?) — distinctive tokens:
grep -rln "Git-tracked\|Secrets allowed" README.md docs/                 # → (empty)

# §9.7.5 (5-col: TOML key|Env var|CLI flag|Type|Default) — distinctive header + canonical row:
grep -rln "TOML key.*Env var.*CLI flag\|\[models\] high.*PRP_MODEL_HIGH" README.md docs/ .env.example   # → (empty)

# PATTERN — the doc-native-header confirmation (these SHOULD match; proves doc-native, not PRD-mirror):
grep -n "^| Tier\|^| Global\|^| \[section\]\|^| Variable" docs/CONFIGURATION.md README.md
# → docs/CONFIGURATION.md:50:| Variable ... ; :74:| Tier ... ; :89:| `[section]` ...
#   README.md:366:| Global ...

# PATTERN — content cross-check (values present in doc-native form; expected, NOT a copy signal):
grep -rln "PRP_MODEL_HIGH\|glm-5-turbo\|PRP_API_BASE_URL" README.md docs/ .env.example
# → README.md, docs/CONFIGURATION.md, docs/ARCHITECTURE.md, docs/INSTALLATION.md, .env.example
```

### Integration Points

```yaml
NO SOURCE/CONFIG/TEST INTEGRATION: this task changes NO src/config/test files. It is a docs-verification
  task (the item's "DOCS: this IS the documentation sync task").

DEPENDS ON (CONTRACT — assume recorded):
  - P1.M1.T1.S1 (cosmetic-delta proof): establishes the delta is purely cosmetic + zero code/config/
    test impact. T2.S1 closes the docs axis on the same "zero work" conclusion.

DOWNSTREAM (orchestrator-level, NOT this task):
  - Absorb the cosmetic delta as the new baseline (refresh prd_snapshot.md to current PRD.md),
    equivalent to --accept-prd-changes (§4.3). This is the orchestrator's bookkeeping, not a doc edit.

NO PER-DOC CHANGES expected. The fallback (Task 3) is a safety net for an unexpected verbatim copy;
  research note §2 proves none exists at this time.
```

---

## Validation Loop

### Level 1: Syntax & Style (only if the fallback Task 3 edits a doc)

```bash
# PRIMARY PATH (no edits): no format gate — nothing to check.
# FALLBACK PATH (a doc edited):
npx prettier --write <touched-file.md>   # or `npm run fix`
npm run format:check                      # clean on the touched markdown
# Expected: clean. (Not expected to run — research note §2 proves no verbatim copy exists.)
```

### Level 2: The verification (the PRIMARY acceptance gate — deterministic)

```bash
# §9.7.3 verbatim-copy search → MUST be empty:
grep -rln "Git-tracked\|Secrets allowed" README.md docs/
# §9.7.5 verbatim-copy search → MUST be empty:
grep -rln "TOML key.*Env var.*CLI flag\|\[models\] high.*PRP_MODEL_HIGH" README.md docs/ .env.example
# Expected: no output from either. If either returns a file, run Task 3 (fallback) on that file.
```

### Level 3: Per-file doc-native confirmation (evidence the docs are immune)

```bash
# Doc-native headers present (NOT the PRD's 5-col headers):
grep -n "^| Tier\|^| Global\|^| \[section\]\|^| Variable" docs/CONFIGURATION.md README.md
# Values carried in doc-native form (expected matches — NOT a verbatim-copy signal):
grep -rln "PRP_MODEL_HIGH\|glm-5-turbo\|PRP_API_BASE_URL" README.md docs/ .env.example
# Expected: doc-native headers in CONFIGURATION.md/README.md; values present across the doc set.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# N/A — a docs-verification task with no runtime surface. Domain checks (record in the assertion):
#   - No doc reproduces the PRD's §9.7.3 5-col header or §9.7.5 5-col header (grep-empty proof).
#   - Each doc's §9.7 content uses a doc-native column structure (3/4-col), so the PRD's column-padding
#     change has zero transitive effect on any doc table.
#   - The doc values (glm-5.2, PRP_MODEL_HIGH, PRP_API_BASE_URL, …) match the PRD's current schema →
#     the docs are consistent (not stale), just in their own format.
#   - .env.example has no markdown tables → verbatim table copy is structurally impossible there.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] §9.7.3 distinctive-header grep (`Git-tracked` / `Secrets allowed`) → no output.
- [ ] §9.7.5 distinctive-header/row grep (`TOML key.*Env var.*CLI flag` / `[models] high.*PRP_MODEL_HIGH`) → no output.
- [ ] Per-file doc-native-header grep confirms CONFIGURATION.md/README.md use Tier/Global/[section]/Variable (not Layer/TOML key).
- [ ] (Fallback only) `npm run format:check` clean on any touched markdown.
- [ ] No source/config/test files modified.

### Feature Validation
- [ ] Verified: no documentation file contains a verbatim copy of PRD §9.7.3 or §9.7.5.
- [ ] Verified: each doc's §9.7 content uses a doc-native column structure (immune to the PRD's column-width change).
- [ ] Verified: doc values match the PRD's current schema (consistent, not stale).
- [ ] Written assertion recorded (task result / commit message) with the captured grep evidence.

### Code Quality Validation
- [ ] Primary path: NO files edited (verification + finding only).
- [ ] Fallback path (if triggered): only the flagged doc's table re-aligned, in the doc's own style.
- [ ] PRD.md untouched (read-only); no source/config/test changes.

### Documentation & Deployment
- [ ] The written assertion IS the documentation deliverable (closes the docs axis of the cosmetic delta).
- [ ] Commit message notes: no doc mirrors the PRD's table formatting; doc-native tables are immune;
      zero doc updates required; fallback did/did-not trigger.

---

## Anti-Patterns to Avoid

- ❌ Don't "re-align" CONFIGURATION.md's or README's §9.7.3 tier tables to the PRD — they're 4-col
      doc-native reformats (Tier|File|Committable?|Secrets?), NOT the PRD's 5-col table. Their widths
      are self-determined; the PRD change doesn't affect them. Editing them is phantom work.
- ❌ Don't treat the content-cross-check grep (PRP_MODEL_HIGH/glm-5-turbo matching the docs) as evidence
      of a verbatim copy — the docs carry the VALUES in their own formats. The verbatim-copy evidence is
      the HEADER greps, which are empty.
- ❌ Don't modify `PRD.md` — human-owned read-only; the cosmetic delta is already in it.
- ❌ Don't modify source/config/test files — this is a docs-verification task (no code impact; the
      item's "DOCS: this IS the documentation sync task").
- ❌ Don't skip the per-file cross-check — the header greps alone prove "no verbatim copy," but the
      per-file inventory proves WHY (doc-native structures) and guards against a misread where a doc
      table happens to share a header token incidentally.
- ❌ Don't add tests — this task produces a documented finding, not test coverage.
- ❌ Don't run the fallback (Task 3) unless Task 1's grep actually returns a file — research note §2
      proves none exists; running the fallback speculatively would create phantom edits.
- ❌ Don't claim the docs are "stale" — the values match the PRD's current schema; they're consistent,
      just in doc-native formats.

---

## Confidence Score

**10/10** — one-pass success likelihood.

Rationale: This is a verification task whose conclusion is **already deterministically established** in
the research note (§2): both distinctive-header greps return empty across all four doc files, and the
per-file inventory confirms each doc uses a doc-native column structure (3/4-col) independent of the
PRD's 5-col tables. The PRD's cosmetic change is column *padding* inside two specific tables; no doc
reproduces either table verbatim, so there is provably nothing to re-align. The implementer's job is to
re-run the stable greps (confirming the finding) and record the assertion — a deterministic, re-runnable
operation with no external/runtime unknowns. The fallback (a doc edit) is explicitly gated on a grep
result that research proves won't occur. The only "risk" is a future doc edit pasting a raw PRD table —
which the greps would then catch (the regression net), and which is not the state at implementation
time. No source/config/test impact (docs-verification only).