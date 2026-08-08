# Research — docs/CONFIGURATION.md reasoning-surface documentation (Mode B)

Findings anchoring P1.M2.T1.S1 (PRD §9.2.9 doc sync). All line numbers verified
against the working tree; all shipped defaults verified in `src/config/constants.ts`.

## 1. Shipped behavior to document (verified in source — NOT just the PRD)

`src/config/constants.ts`:
- `ReasoningLevel` type (1519-1526) = `'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'`.
- `REASONING_LEVELS` tuple (1534-1541) — same 6 tokens, the validated vocabulary.
- Env-var name constants (1552-1593): `PRP_REASONING_AGENT`, `PRP_REASONING_BREAKDOWN_AGENT`,
  `PRP_REASONING_BUG_FINDER_AGENT`, `PRP_REASONING_VALIDATION_AGENT`, `PRP_REASONING_IMPL_AGENT`.
- Defaults (1598-1621): `DEFAULT_REASONING_AGENT='high'`, `_BREAKDOWN_AGENT='high'`,
  `_BUG_FINDER_AGENT='high'`, `_VALIDATION_AGENT='high'`, **`_IMPL_AGENT='off'`** (1621 — the
  only non-`high` default; CONFIRMED).
- `resolveReasoningLevel(raw, key, default)` — case-insensitive, trims whitespace; empty/whitespace
  → the role default (empty is never forwarded); invalid token → throws `ReasoningConfigError`
  (fail-fast). `validateAllReasoningLevels()` runs on the startup path (T4.S1 COMPLETE).

`src/config/hack-config.ts` SCHEMA_MAP (213-256) + HACK_CONFIG_SCHEMA `reasoning` block (691-695):
- 5 entries, `section:'reasoning'`, keys `agent`/`breakdown_agent`/`bug_finder_agent`/
  `validation_agent`/`impl_agent`, each `envVar` = the matching `PRP_REASONING_*`, `enum:
  REASONING_LEVELS`. The loader canonicalizes case (639-643: `'HIGH'`→`'high'`).

➡️ The doc MUST state: vocab `off|minimal|low|medium|high|xhigh` (case-insensitive); defaults
`high/high/high/high/off`; empty→default (never forwarded); invalid→hard startup error
(`ReasoningConfigError`, exit 1, before any session/agent); the 5 env vars + the 5 `[reasoning]`
.hack keys; the two-axes model; the §9.2.9 behavior change.

## 2. CONFIGURATION.md structure — the 4 edit sites (verified)

`docs/CONFIGURATION.md` (862 lines). It is the canonical user-facing config reference. The file
ALREADY documents env vars + the `.hack` mapping; **this task EXTENDS existing sections (no rewrite).**

### Edit site A — ToC (lines 9-40)
Add `  - [Reasoning Levels](#reasoning-levels)` to the env-var subsection list. Place it after
`- [Agent Runtime (Harness)](#agent-runtime-harness)` (line 16) and before
`- [Pipeline Control](#pipeline-control)` (line 17) — mirrors the PRD §9.2.2 ordering
(API → Harness → Reasoning → Pipeline).

### Edit site B — NEW `### Reasoning Levels` env-var subsection
There is **NO** reasoning env-var subsection today (the 5 `PRP_REASONING_*` vars are absent from
the `## Environment Variables` reference). INSERT a new `### Reasoning Levels` subsection inside
`## Environment Variables` (145), placed AFTER `### Agent Runtime (Harness)` (ends ~229) and
BEFORE `### Pipeline Control` (231) — matching the PRD §9.2.2 ordering + the ToC entry.
- Table columns mirror the existing env-var tables: `| Variable | Required | Default | Description |`.
- 5 rows (one per var) + a `Choices` note (the vocab).
- Prose: the two-axes reminder (orthogonal to the model id), empty→default, invalid→hard error,
  cross-link to [Models, Roles & Reasoning Budget](#models-roles--reasoning-budget), `.hack` key
  pointer (`[reasoning] …`, link to [.hack Configuration File](#hack-configuration-file)).

### Edit site C — `.hack Schema summary` table (lines 82-95)
ADD a `[reasoning]` row between `[models]` (line ~85) and `[endpoint]` (line ~86):
`| [reasoning] | agent, breakdown_agent, bug_finder_agent, validation_agent, impl_agent | PRP_REASONING_AGENT / _BREAKDOWN_AGENT / _BUG_FINDER_AGENT / _VALIDATION_AGENT / _IMPL_AGENT |`
(mirrors the existing rows' "Keys (summary)" + "Maps to env vars" column style).

### Edit site D — `## Models, Roles & Reasoning Budget` (397-460) — STALE, MUST UPDATE
This section documents the **OLD hard-wired design** and contradicts the shipped §9.2.9 behavior:
- Line 399-404: intro says each role maps to "a reasoning budget" (fixed) — must become the
  two-axes model (model tier + reasoning level are INDEPENDENT).
- Line 419-420: "`balanced` is bound to … (Reasoning at the `xhigh` reasoning budget)" — STALE.
- Lines 446-453 (Model Roles table "Reasoning Budget" column): `normal` / `xhigh` / `normal` — STALE.
- Lines 456-460 ("Maximum reasoning budget … `xhigh` … Research and Implementation roles run at
  their model's normal budget (the `thinking` field is omitted → `undefined`)") — STALE.

UPDATE to: the two-axes explainer ("Model vs Reasoning: two independent axes — tuning one never
forces a compromise on the other"); the corrected per-role reasoning DEFAULTS (Research `high`,
Reasoning `high`, Implementation `off`), each independently configurable via its `PRP_REASONING_*`
var; the §9.2.9 behavior-change note (research xhigh→high; "normal"→explicit high; impl
model-default→explicit off; `xhigh` still available via explicit config); a cross-link to the new
[Reasoning Levels](#reasoning-levels) env-var subsection for the per-identity vars + vocab.

## 3. Cross-links to verify (the item's "Verify cross-links resolve")

GitHub-style anchors (lowercase, spaces→hyphens, punctuation stripped):
- `### Reasoning Levels` → `#reasoning-levels` (NEW; used by the ToC + the Models section).
- `## Models, Roles & Reasoning Budget` → `#models-roles--reasoning-budget` (EXISTING; the new
  Reasoning Levels subsection links TO it — already valid).
- `## .hack Configuration File` → `#hack-configuration-file` (EXISTING; the new subsection's
  `.hack` pointer — already valid).
- Verify: the ToC entry's `(#reasoning-levels)` matches the new heading's anchor EXACTLY;
  no DUPLICATE heading names (markdownlint MD024); the `[reasoning]` row's text doesn't break the
  summary table's column count.

## 4. Sibling doc tasks (Mode B) — scope boundaries

- **P1.M2.T1.S1 (THIS)** = `docs/CONFIGURATION.md` ONLY.
- **P1.M2.T1.S2** = `docs/ARCHITECTURE.md` (per-role reasoning as an axis + QA split) — different
  file, no overlap.
- **P1.M2.T1.S3** = `README.md` (brief mention + link to CONFIGURATION) — different file.
- The three are SEQUENCED (S1 → S2 → S3) under P1.M2.T1; each edits a distinct doc. No merge conflict.
- **File-disjoint from the parallel P1.M1.T4.S2** (`tests/unit/cli/commands/config.test.ts` — a
  test file). Zero overlap.
- The FEATURE (P1.M1 T1-T4) is COMPLETE/Implementing; this is purely the changeset doc sync. Do NOT
  edit `src/` (the feature code), `PRD.md`, `.env.example` (T1.S4 already added the reasoning
  subsection there), or `docs/CLI_REFERENCE.md`.

## 5. Accuracy guardrails (Mode B — the doc must match shipped behavior)

- Defaults are `high/high/high/high/off` — NOT all `high`. `impl` is `off`. (Verified constants.ts:1621.)
- The vocab INCLUDES `minimal` (between `off` and `low`) — do NOT drop it. (Verified 1521.)
- "empty → default, never forwarded" + "invalid → hard startup error (ReasoningConfigError, exit 1)"
  are BOTH required (PRD §9.2.9 Resolution + Validation).
- The behavior change is a DEFAULT change, NOT a capability removal — `xhigh` remains available
  via explicit config. State this explicitly.
- The 5 env vars / 5 `[reasoning]` keys map 1:1 to agent IDENTITIES (AGENT, BREAKDOWN_AGENT,
  BUG_FINDER_AGENT, VALIDATION_AGENT, IMPL_AGENT) — finer-grained than the 3 model ROLES. The
  Reasoning Levels subsection is the per-identity reference; the Models section stays at role
  granularity with a pointer.

## 6. Validation (doc-only)

- `npm run format:check` — prettier formats `**/*.md`; run `npm run fix` first if it flags the new
  tables/prose.
- `npm run docs:lint` (`markdownlint "docs/**/*.md"`) — catches duplicate headings (MD024), table
  format issues, missing blank lines around tables. MUST be clean.
- Cross-link verification: `grep -n "#reasoning-levels" docs/CONFIGURATION.md` → the ToC entry +
  the Models-section pointer + the heading itself all use the identical anchor; confirm no
  duplicate `### Reasoning Levels` heading.
- No `typecheck`/`lint` (those cover `.ts`, not `.md`) — but run them to confirm no accidental
  `src/` edit (git diff shows ONLY `docs/CONFIGURATION.md`).
- Do NOT run the full test suite (orthogonal pre-existing failures are not this doc task's concern).