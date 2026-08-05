# Research — P1.M1.T2.S1: Verify docs need no updates for the cosmetic delta

## 1. The delta (from P1.M1.T1.S1, CONTRACT)

Session 010's PRD change is **purely cosmetic**: markdown-table column-padding + separator-dash
re-alignment of the §9.7.3 table (5 cols) and the §9.7.5 table (5 cols × ~36 rows), plus one
trailing blank line. Proven by semantic-char-only byte equality (`diff <(tr -d ' \t\n|-' < 009
prd_snapshot) <(tr -d ' \t\n|-' < PRD.md)` → no output). **No requirement added/modified/removed.**

T2.S1's job: verify NO documentation file contains a **verbatim copy** of either PRD table that
would need the same column re-alignment. If none do (expected), document the finding. If any do,
re-align it.

## 2. The verification (DONE — re-runnable greps confirm the finding)

### 2a. Distinctive PRD table headers appear in ZERO doc files
```
§9.7.3 header tokens  → grep -rln "Git-tracked\|Secrets allowed" README.md docs/ → (none)
§9.7.5 header tokens  → grep -rln "TOML key.*Env var.*CLI flag\|\[models\] high.*PRP_MODEL_HIGH" → (none)
```
**No doc contains a verbatim copy of either PRD table's header row.** A verbatim copy would reproduce
these distinctive 5-column headers; none does.

### 2b. Per-file finding (what each doc ACTUALLY contains — all doc-native formats)

**`docs/CONFIGURATION.md` (53KB):**
- §9.7.3-derived **tier table** (L74–78) — but **4 cols** (`Tier | File | Committable? | Secrets?`),
  NOT the PRD's 5-col `Layer | Path | Purpose | Git-tracked? | Secrets allowed?`. Self-contained
  column widths; the PRD's re-alignment cannot affect it.
- §9.7.5-derived **summary table** (L89–103) — **3 cols** (`[section] | Keys (summary) | Maps to env
  vars / CLI flags (sample)`), NOT the PRD's 5-col × 36-row schema table. Doc-native reformatting.
- Its OWN canonical env-var tables (L50, L151, L192–194) in `Variable | Required | Default | Description`
  format — CONFIGURATION.md's house style, independent of the PRD.
- Models tier table (L413–415): `**high** | glm-5.2 | 8192 | …` — doc-native.
→ **NOT a verbatim copy.** No re-alignment needed.

**`README.md` (37KB):**
- §9.7.3-derived tier table (L366–368) — **4 cols** (`Global | path | n/a | Refused`), same shape as
  CONFIGURATION.md's. NOT the PRD's 5-col table.
- 2 conceptual `.hack` references (L113, L357–377). No §9.7.5 table at all.
→ **NOT a verbatim copy.** No re-alignment needed.

**`docs/ARCHITECTURE.md` (51KB):**
- Refers to `.hack` conceptually (L89, L141–151). **Delegates** the full schema to CONFIGURATION.md
  (L150–151: "For the full `.hack` schema, see Configuration → .hack Configuration File").
- NO markdown table reproduces §9.7.3 or §9.7.5. The bootstrap-ordering table (L120) is its own
  `Step | Detail | File | PRD ref` 4-col format.
→ **No table copy at all.** No re-alignment needed.

**`.env.example` (6KB):**
- Plain `KEY=value` env-var assignments (e.g. `PRP_MODEL_HIGH=glm-5.2` L55,
  `PRP_API_BASE_URL=…` L34). **No markdown tables whatsoever.** A verbatim table copy is
  structurally impossible here.
→ **No table copy.** No re-alignment needed (or possible).

## 3. Why doc-native tables are immune to the PRD's cosmetic change

The PRD's delta changes column *widths* (padding) within two specific 5-column tables. A doc table is
only affected if it (a) reproduces one of those tables VERBATIM (same header, same row order, same
cell text) AND (b) had its own column padding coupled to the PRD's. The docs instead **re-express**
the same information in their own column structures (3-col summary, 4-col tier, 4-col env-var). Their
padding is determined by THEIR content, not the PRD's. Column re-alignment in the PRD therefore has
**zero transitive effect** on any doc table. (Confirmed: no doc shares either PRD table's header.)

## 4. The content is still consistent (no staleness either)

Spot-check: the doc tables' VALUES match the PRD's current schema —
- `glm-5.2` / `glm-5-turbo` model defaults (CONFIGURATION.md L192–194, .env.example L55–61) ✅ match
  PRD §9.7.5 `[models] high/balanced = "glm-5.2"`, `fast = "glm-5-turbo"`.
- `PRP_API_BASE_URL` default `https://api.z.ai/api/anthropic` (CONFIGURATION.md L53/L157, .env.example L34) ✅.
- `PRP_MODEL_HIGH/BALANCED/FAST` canonical names ✅.
So the docs aren't *stale* either — they're consistent, just in their own format. Nothing to update.

## 5. Expected outcome / output

**Expected outcome: NO documentation files require updates.** The deliverable is a **verified written
assertion** (the finding) backed by re-runnable greps — NOT a file edit. (A file edit only happens in
the unexpected case a verbatim copy is found; §2 proves none exists.)

The implementer's job is to RE-RUN the §2 greps to confirm the finding (deterministic, re-runnable),
then record the conclusion in the task result / commit message. No source/config/test changes.

## 6. Decisions locked

- **Primary path = document the finding** (no edits). The verification greps in §2 are the acceptance
  evidence; the implementer re-runs them.
- **Fallback path = update IF a verbatim copy is found** — but §2a/2b prove none exists, so the
  fallback is not expected to trigger. If it somehow does (e.g. a doc was edited to paste a PRD table),
  re-align that one table's columns to match the PRD (drop into the doc's existing table style, not a
  raw paste — docs use their own column structures).
- **No source/config/test edits.** This is a documentation-verification task (the item's "DOCS: this
  IS the documentation sync task"). Depends on P1.M1.T1.S1's cosmetic confirmation (CONTRACT).
- The finding is **idempotent / re-runnable**: the greps are stable; re-running them after any future
  doc edit reproduces the same (no-verbatim-copy) conclusion unless someone deliberately pastes a PRD
  table into a doc.