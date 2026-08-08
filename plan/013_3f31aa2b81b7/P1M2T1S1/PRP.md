# PRP — P1.M2.T1.S1: `docs/CONFIGURATION.md` — env vars, `[reasoning]` keys, two-axes model, vocab/defaults/empty/fail-fast, behavior change

> Plan 013, PRD §9.2.9 (Per-Role Reasoning Level) → **Mode B changeset doc sync.** The feature
> (P1.M1 T1–T4) ships 5 `PRP_REASONING_*` env vars + 5 `[reasoning]` `.hack` keys, the model/reasoning
> decoupling, the startup fail-fast, and the §9.2.9 default change (`high/high/high/high/off`). This
> task extends the canonical `docs/CONFIGURATION.md` to document that surface — adding the missing
> env-var subsection + `.hack` table row, and **correcting the now-stale** `## Models, Roles &
> Reasoning Budget` section (which still documents the old hard-wired `xhigh`/`normal`/`model-default`
> design). Doc-only; no `src/`, no `PRD.md`.

---

## Goal

**Feature Goal**: Make `docs/CONFIGURATION.md` the complete, accurate user-facing reference for the
per-role reasoning surface shipped in P1.M1 — so a user can discover the 5 env vars, the 5 `.hack`
keys, the vocabulary, the defaults, the empty-value and fail-fast behavior, the two-axes model, and
the §9.2.9 behavior change, with all cross-links resolving.

**Deliverable** — EDIT `docs/CONFIGURATION.md` (extend existing sections; do NOT rewrite the file):
1. **ToC** — add a `Reasoning Levels` entry (anchor `#reasoning-levels`).
2. **NEW `### Reasoning Levels` env-var subsection** (inside `## Environment Variables`, after
   `### Agent Runtime (Harness)`, before `### Pipeline Control`) — the 5 `PRP_REASONING_*` rows +
   vocab + empty→default + invalid→hard-error + two-axes cross-link + `.hack` key pointer.
3. **`.hack Schema summary` table** — add a `[reasoning]` row.
4. **`## Models, Roles & Reasoning Budget` section** — UPDATE the stale intro + Model Roles table +
   "maximum reasoning budget" note to the two-axes model, the corrected per-role defaults
   (`high`/`high`/`off`), and the §9.2.9 behavior-change explanation.

**Success Definition**:
- `docs/CONFIGURATION.md` documents all 5 `PRP_REASONING_*` vars (defaults `high/high/high/high/off`,
  vocab `off|minimal|low|medium|high|xhigh`, empty→default, invalid→hard startup error) and all 5
  `[reasoning]` `.hack` keys.
- The `## Models, Roles & Reasoning Budget` section no longer claims `xhigh`/`normal`/`model-default`;
  it states the two-axes model + the new defaults + the behavior change (`xhigh` still available).
- All cross-links resolve (ToC `#reasoning-levels` matches the new heading; no duplicate headings).
- `npm run format:check` + `npm run docs:lint` clean; `git diff --name-only` shows ONLY
  `docs/CONFIGURATION.md`.

---

## Why

- **Mode B changeset doc sync.** The feature shipped without its user-facing reference updated:
  `CONFIGURATION.md`'s env-var reference has NO reasoning subsection, its `.hack` summary table has
  no `[reasoning]` row, and its `## Models, Roles & Reasoning Budget` section actively contradicts
  the shipped behavior (it still says the Reasoning role runs at a hard `xhigh` budget and
  Research/Implementation at an unspecified "normal"/model-default — all replaced by §9.2.9). This
  task closes that gap so the canonical config doc matches the code.
- **Two-axes discoverability.** The headline UX win of §9.2.9 is that reasoning is now an
  independent axis from the model tier (a user no longer drops model tiers to disable thinking).
  That model must be stated explicitly in the doc users read first, with a pointer to the per-role knobs.
- **Fail-fast + empty-value discipline.** Users need to know an invalid level (`=ultra`) aborts at
  startup (not a deep runtime error) and an empty value falls back to the default (never forwarded).
  These are operational facts that belong in the reference.
- **Standalone & scoped.** Doc-only; edits ONLY `docs/CONFIGURATION.md`. File-disjoint from the
  parallel P1.M1.T4.S2 (a test file) and from the sibling Mode B tasks S2 (`ARCHITECTURE.md`) /
  S3 (`README.md`) — different files, sequenced, no merge conflict.
- **Out of scope (hard boundary):** `docs/ARCHITECTURE.md` (S2), `README.md` (S3),
  `docs/CLI_REFERENCE.md`, `docs/GROUNDSWELL_GUIDE.md`, any `src/` file (the feature is complete),
  `PRD.md`, `.env.example` (T1.S4 already added the reasoning subsection there), `tasks.json`,
  `prd_snapshot.md`.

---

## What

### User-visible behavior
None (documentation). Indirectly: users can now discover and correctly configure per-role reasoning
from the canonical reference.

### Technical requirements (exact contract — 4 edits to `docs/CONFIGURATION.md`)

All factual content below is **verified against shipped code** (`src/config/constants.ts:1519-1621`,
`src/config/hack-config.ts:213-256,691-695`) and **PRD §9.2.9 / §9.7.5**.

**EDIT 1 — ToC (lines 9-40).** Add one line after
`- [Agent Runtime (Harness)](#agent-runtime-harness)` (line 16):
```markdown
  - [Reasoning Levels](#reasoning-levels)
```

**EDIT 2 — `.hack Schema summary` table (lines 82-95).** Insert a `[reasoning]` row between the
`[models]` row (~line 85) and the `[endpoint]` row (~line 86), matching the existing 3-column
format (`[section]` | Keys (summary) | Maps to env vars / CLI flags):
```markdown
| `[reasoning]`        | `agent`, `breakdown_agent`, `bug_finder_agent`, `validation_agent`, `impl_agent`                               | `PRP_REASONING_AGENT` / `_BREAKDOWN_AGENT` / `_BUG_FINDER_AGENT` / `_VALIDATION_AGENT` / `_IMPL_AGENT`                                             |
```

**EDIT 3 — NEW `### Reasoning Levels` env-var subsection.** Insert inside `## Environment Variables`
(145), AFTER `### Agent Runtime (Harness)` (ends ~229) and BEFORE `### Pipeline Control` (231).
Verbatim content:
```markdown
### Reasoning Levels

The extended-thinking ("reasoning") budget is a **first-class, independently-configurable
per-role setting**, fully decoupled from the model id (PRD §9.2.9). Which **model** a role runs
(chosen per tier, see [Model Selection](#model-selection)) and **how hard it reasons** (chosen per
role, below) are **two independent axes** — tuning one never forces a compromise on the other. See
[Models, Roles & Reasoning Budget](#models-roles--reasoning-budget) for the role-level view.

| Variable                          | Required | Default | Description                                                                                                                                                                                                                          |
| --------------------------------- | -------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PRP_REASONING_AGENT`             | No       | `high`  | Reasoning level for the **research / PRP** role (`AGENT`). Analysis-heavy; strong reasoning improves PRP quality.                                                                                                                  |
| `PRP_REASONING_BREAKDOWN_AGENT`   | No       | `high`  | Reasoning level for the **task-decomposition** role (`BREAKDOWN_AGENT`). Synthesizing the strict Phase→Milestone→Task→Subtask hierarchy is reasoning-intensive.                                                                     |
| `PRP_REASONING_BUG_FINDER_AGENT`  | No       | `high`  | Reasoning level for the **bug-finder** role (`BUG_FINDER_AGENT`). Adversarial analysis; weak reasoning misses bugs.                                                                                                                 |
| `PRP_REASONING_VALIDATION_AGENT`  | No       | `high`  | Reasoning level for the **validation** role (`VALIDATION_AGENT`). Validating against the full PRD rewards strong reasoning.                                                                                                         |
| `PRP_REASONING_IMPL_AGENT`        | No       | `off`   | Reasoning level for the **implementation / codegen** role (`IMPL_AGENT`). Codegen executes a complete PRP contract and needs no extended thinking — `off` is faster, cheaper, and decouples reasoning from model choice.           |

**Vocabulary (case-insensitive):** `off`, `minimal`, `low`, `medium`, `high`, `xhigh` (`xhigh` is
the maximum). These are the canonical tokens forwarded to the selected harness; the `pi` harness
maps them to its `--thinking <level>` argument, and `claude-code` maps them to its extended-thinking
budget.

**Resolution & fail-fast (PRD §9.2.9):**

- Each role resolves its `PRP_REASONING_<ROLE>` through the standard
  [Configuration Priority](#configuration-priority) layer stack (built-in default < `.hack` <
  `.hack.local` < `.env` < shell env < CLI). A user-set value is authoritative — whatever level a
  role resolves to is exactly what it runs.
- **Empty / whitespace-only** value → treated as "unset" → falls back to the role's default. An
  empty value is **never** forwarded to the harness (consistent with the §9.2.7 empty-string policy).
- **Invalid value** (outside the vocabulary, e.g. `PRP_REASONING_AGENT=ultra`) → **hard startup
  error**: the pipeline aborts with exit code `1` (`ReasoningConfigError`) — naming the offending
  key, the value, and the accepted levels — **before** any session is created or agent invoked. A
  bad reasoning level must never surface as a deep runtime error inside the first agent call.

**`.hack` keys:** each var is seeded by a `[reasoning]` key in `.hack`
(`agent`, `breakdown_agent`, `bug_finder_agent`, `validation_agent`, `impl_agent` — see
[.hack Configuration File](#hack-configuration-file) and PRD §9.7.5); real shell env still wins
per the env-over-file rule. `hack config show --src` reports each role's resolved level together
with its winning source layer.
```

**EDIT 4 — UPDATE `## Models, Roles & Reasoning Budget` (lines 397-460).** Three sub-edits:

*(4a)* Rewrite the section **intro** (399-404) to state the two-axes model. Replace the "Each role
maps to a quality tier and a reasoning budget … the role → {tier, budget} mapping is fixed in
`ROLE_CONFIG`" framing with:
```markdown
The pipeline selects models via **three roles** — research, reasoning, and implementation. Each
role is the composition of **two independent axes**: a quality **tier** (high / balanced / fast,
which picks the model id + max tokens) and a **reasoning level** (the extended-thinking budget).
Tuning one axis never perturbs the other — you can run a strong model with reasoning off, or a fast
model with reasoning on. The `PRP_MODEL_*` env vars override the tier defaults
([Model Selection](#model-selection)); the per-role reasoning level is configured independently via
the `PRP_REASONING_*` env vars ([Reasoning Levels](#reasoning-levels), PRD §9.2.9). The role→tier
binding lives in `ROLE_CONFIG` (`src/agents/agent-factory.ts`, PRD §9.2.3 / §6.1).
```

*(4b)* Fix the **stale tier↔role note** (419-420) and the **Model Roles table** (446-453). The note
that says "Reasoning at the `xhigh` reasoning budget" and the table's `Reasoning Budget` column
(`normal` / `xhigh` / `normal`) describe the OLD hard-wired design. Update the table's column header
to **"Reasoning Level (default)"** and the cells to the §9.2.9 defaults, and append a pointer:
```markdown
| Role               | Tier     | Reasoning Level (default) | Pipeline agents                                   |
| ------------------ | -------- | ------------------------- | ------------------------------------------------- |
| **Research**       | balanced | `high`                    | Researcher (PRP creation, architecture research)  |
| **Reasoning**      | balanced | `high`                    | Architect (decomposition), Bug-finder, Validation |
| **Implementation** | fast     | `off`                     | Coder (PRP execution, post-validation fix)        |

> **Reasoning is a separate axis.** Each role's reasoning level is its `PRP_REASONING_*` default
> (above) and is **independently configurable** — see [Reasoning Levels](#reasoning-levels). The
> Reasoning role covers three agent identities (`BREAKDOWN_AGENT` / `BUG_FINDER_AGENT` /
> `VALIDATION_AGENT`), each with its own `PRP_REASONING_*` var (all default `high`).
```
(Also delete/replace the stale 419-420 "Reasoning at the `xhigh` reasoning budget" sentence and the
456-460 "Maximum reasoning budget … `xhigh` … normal budget (`thinking` omitted → `undefined`)" note.)

*(4c)* Add the **§9.2.9 behavior-change note** where the old "maximum reasoning budget" note was
(~456-460):
```markdown
> **Behavior change vs. the prior hard-wired design (PRD §9.2.9).** Previously the reasoning budget
> was hard-wired to the role: the Reasoning role was pinned to the **maximum** (`xhigh`), Research
> ran at an unspecified "normal" budget, and Implementation inherited its model's default. Under
> §9.2.9 these become configurable **defaults** — Reasoning and Research move to an explicit
> **`high`**, and Implementation is now explicitly **`off`**. These are deliberate default changes;
> nothing removes the prior capability — **`xhigh` remains available everywhere** via explicit config
> (e.g. `PRP_REASONING_BREAKDOWN_AGENT=xhigh`).
```

### Success Criteria
- [ ] ToC has `- [Reasoning Levels](#reasoning-levels)`.
- [ ] `.hack Schema summary` table has a `[reasoning]` row (5 keys → 5 env vars).
- [ ] `### Reasoning Levels` subsection exists with the 5 rows, the vocab (incl. `minimal`), the
      `high/high/high/high/off` defaults, empty→default, invalid→hard-error, and cross-links.
- [ ] `## Models, Roles & Reasoning Budget` states the two-axes model; the Model Roles table shows
      `high`/`high`/`off`; the stale `xhigh`/`normal`/`model-default` claims are gone; the
      behavior-change note is present (`xhigh` still available).
- [ ] All cross-links resolve; no duplicate headings.
- [ ] `npm run format:check` + `npm run docs:lint` clean; `git diff --name-only` = ONLY
      `docs/CONFIGURATION.md`.

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_ **Yes** — the 4
exact edit sites with line numbers, the verbatim copy-ready prose for the new subsection + table row
+ behavior-change note, the verified shipped defaults/vocab (`high/high/high/high/off`,
`off|minimal|low|medium|high|xhigh`) with source line citations, the exact GitHub-anchor strings, the
list of stale lines to replace (419-420, 446-460), the cross-link verification recipe, and the
doc-only validation commands. See `research/configuration-md-reasoning-doc.md` for the grep evidence.

### Documentation & References
```yaml
# AUTHORITATIVE SPEC — the PRD sections this doc mirrors
- docfile: PRD.md   # (provided in selected_prd_content)
  section: §9.2.9 "Per-Role Reasoning Level" (Problem / Requirement / Vocabulary / Per-role table /
        Resolution / Validation / Behavior change) + §9.2.2 "Reasoning Configuration" + §9.7.5
        "[reasoning]" schema rows + §9.2.3 two-axes framing.
  why: The exact vocab, defaults, empty/invalid behavior, behavior-change wording, and the two-axes
        model the doc must state.
  critical: Defaults are high/high/high/high/off (impl is OFF, not high). Vocab INCLUDES 'minimal'.
        'xhigh' is NOT removed — still available via explicit config. Invalid → hard startup error.

# SHIPPED SOURCE (verified — the doc must match the code, not just the PRD)
- file: src/config/constants.ts
  why: ReasoningLevel type (1519-1526) + REASONING_LEVELS vocab (1534-1541) + the 5 PRP_REASONING_*
        name constants (1552-1593) + DEFAULT_REASONING_* (1598-1621: high/high/high/high/OFF).
  critical: DEFAULT_REASONING_IMPL_AGENT='off' (1621) — the only non-high default. CONFIRMED.
- file: src/config/hack-config.ts
  why: SCHEMA_MAP [reasoning] entries (213-256) + HACK_CONFIG_SCHEMA reasoning block (691-695) — the
        5 keys + envVar mappings + enum:REASONING_LEVELS the .hack table row must summarize.

# EDIT TARGET — the file being extended (read it; locate sections by the line numbers below)
- file: docs/CONFIGURATION.md
  section: ToC (9-40) + .hack Schema summary table (82-95) + ## Environment Variables (145, insert
        after Agent Runtime (Harness) ~229 / before Pipeline Control 231) + ## Models, Roles &
        Reasoning Budget (397-460, STALE — update intro 399-404, tier↔role note 419-420, Model Roles
        table 446-453, "maximum reasoning budget" note 456-460).
  pattern: env-var tables use "| Variable | Required | Default | Description |"; .hack summary uses
        "| [section] | Keys (summary) | Maps to env vars / CLI flags |"; prose cross-links use
        [Title](#github-style-anchor).
  gotcha: The Models section (397-460) is STALE (says xhigh/normal/model-default) — it is the core
        of EDIT 4, not a brand-new section. UPDATE it; do not leave the old claims.

# ACCURACY-GUARDRAIL RESEARCH (read first — the traps)
- docfile: plan/013_3f31aa2b81b7/P1M2T1S1/research/configuration-md-reasoning-doc.md
  section: "1. Shipped behavior", "2. The 4 edit sites", "3. Cross-links", "5. Accuracy guardrails"
  why: The verified defaults/vocab, the exact stale lines to replace, the anchor strings, and the
        "impl is off / vocab includes minimal / xhigh still available" guardrails.

# PARALLEL PREDECESSOR (read as a CONTRACT) — T4.S2 is a TEST file, disjoint from this doc
- docfile: plan/013_3f31aa2b81b7/P1M1T4S2/PRP.md
  why: T4.S2 edits tests/unit/cli/commands/config.test.ts (verify-only). It does NOT touch docs.
        Confirms zero file overlap with this doc task.

# SIBLING MODE B TASKS (sequenced — different files, no overlap)
- file: plan/013_3f31aa2b81b7/tasks.json   # (P1.M2.T1.S2 = ARCHITECTURE.md; S3 = README.md)
  why: S2/S3 edit different doc files; S1 = CONFIGURATION.md only. Sequenced, no merge conflict.
```

### Current Codebase tree (relevant slice)
```bash
docs/CONFIGURATION.md                 # EDIT (4 edits: ToC, .hack table, new subsection, Models section)
src/config/constants.ts               # READ-ONLY (verified defaults/vocab source of truth)
src/config/hack-config.ts             # READ-ONLY (verified SCHEMA_MAP [reasoning] entries)
PRD.md                                # READ-ONLY (§9.2.9 / §9.7.5 / §9.2.2 authoritative spec)
```

### Desired Codebase tree with files to be edited
```bash
docs/CONFIGURATION.md                 # MODIFIED (4 edits — extend, do not rewrite)
# No other files. No src/, no PRD.md, no .env.example, no other docs.
```

### Known Gotchas of our codebase & Library Quirks
```markdown
<!-- CRITICAL — impl default is `off`, NOT `high`. The 5 defaults are high/high/high/high/off.
     Verified constants.ts:1621 (DEFAULT_REASONING_IMPL_AGENT='off'). Getting this wrong is the
     #1 doc-accuracy failure. -->

<!-- CRITICAL — the vocab INCLUDES `minimal` (off|minimal|low|medium|high|xhigh). Do NOT drop it
     (verified constants.ts:1521, REASONING_LEVELS:1534-1541). A 5-token vocab is WRONG. -->

<!-- CRITICAL — `xhigh` is NOT removed. The §9.2.9 change is a DEFAULT change (xhigh→high for the
     reasoning roles), not a capability removal. The behavior-change note MUST say `xhigh` remains
     available via explicit config (e.g. PRP_REASONING_BREAKDOWN_AGENT=xhigh). -->

<!-- CRITICAL — the ## Models, Roles & Reasoning Budget section (397-460) is STALE. It currently
     claims the Reasoning role runs at `xhigh` and Research/Implementation at "normal"/model-default
     (lines 419-420, 446-460). EDIT 4 REPLACES those — do not leave the old claims alongside the new
     ones (contradictory doc). Update the table column to "Reasoning Level (default)" = high/high/off. -->

<!-- CRITICAL — empty → default (never forwarded) AND invalid → hard startup error (ReasoningConfigError,
     exit 1, before session/agent) are BOTH required (PRD §9.2.9 Resolution + Validation). State both. -->

<!-- GOTCHA — GitHub anchors: ### Reasoning Levels → #reasoning-levels; ## Models, Roles & Reasoning
     Budget → #models-roles--reasoning-budget (double hyphen for the &); ## .hack Configuration File →
     #hack-configuration-file (leading dot stripped). The ToC entry must EXACTLY match the heading anchor. -->

<!-- GOTCHA — markdownlint (npm run docs:lint) enforces MD024 (no duplicate headings). Do NOT create a
     second "Reasoning Levels" / "Model Roles" heading. MD040 (fenced code blocks need a language) —
     the bash block in the Model Override section already has ```bash; keep any new fences tagged. -->

<!-- GOTCHA — prettier formats **/*.md (npm run format:check covers it). The new table rows + prose may
     reflow; run `npm run fix` (or `npm run format`) before format:check. Keep blank lines around tables. -->

<!-- GOTCHA — the 5 env vars map to agent IDENTITIES (AGENT/BREAKDOWN_AGENT/BUG_FINDER_AGENT/
     VALIDATION_AGENT/IMPL_AGENT); the 3 model ROLES (Research/Reasoning/Implementation) are coarser.
     The Reasoning Levels subsection is the per-identity reference (5 rows); the Models section stays at
     role granularity (3 rows) with a pointer. Don't conflate them. -->

<!-- CRITICAL — Parallel execution: P1.M1.T4.S2 (running now) edits a TEST file
     (tests/unit/cli/commands/config.test.ts). S1 edits docs/CONFIGURATION.md. ZERO file overlap.
     Sibling Mode B tasks S2/S3 edit ARCHITECTURE.md / README.md (different files, sequenced). -->

<!-- CRITICAL — doc-only. Do NOT edit src/ (feature complete), PRD.md, .env.example (T1.S4 added the
     reasoning subsection there already), docs/CLI_REFERENCE.md, docs/ARCHITECTURE.md (S2), README.md (S3),
     tasks.json, prd_snapshot.md. git diff --name-only must show ONLY docs/CONFIGURATION.md. -->
```

---

## Implementation Blueprint

### Data models and structure
N/A — documentation. The "structure" is 4 markdown edits (ToC line, summary-table row, new
subsection, section rewrite) at the verified line anchors.

### Implementation Tasks (ordered by dependencies)
```yaml
Task 1: EDIT docs/CONFIGURATION.md — ToC entry (EDIT 1)
  - ADD `- [Reasoning Levels](#reasoning-levels)` to the env-var subsection list, immediately AFTER
        `- [Agent Runtime (Harness)](#agent-runtime-harness)` (line 16) and before
        `- [Pipeline Control]` (line 17). Indentation: 2 spaces (matches sibling entries).
  - DO NOT: reorder existing ToC entries; touch non-env-var ToC sections.

Task 2: EDIT docs/CONFIGURATION.md — .hack Schema summary table row (EDIT 2)
  - INSERT the `[reasoning]` row (verbatim in "Technical requirements" EDIT 2) between the `[models]`
        row and the `[endpoint]` row in the Schema summary table (lines ~85-86). Match the 3-column
        format exactly (the table has no Choices column).
  - DO NOT: alter other rows; change the table header.

Task 3: EDIT docs/CONFIGURATION.md — NEW ### Reasoning Levels subsection (EDIT 3)
  - INSERT the full `### Reasoning Levels` subsection (verbatim in "Technical requirements" EDIT 3)
        inside `## Environment Variables`, AFTER `### Agent Runtime (Harness)` (ends ~229) and BEFORE
        `### Pipeline Control` (231). Blank line before `###` and after the subsection.
  - VERIFY the 5 defaults (high/high/high/high/off), the 6-token vocab (incl. minimal), the empty→default
        + invalid→hard-error prose, and the two cross-links ([Models, Roles & Reasoning Budget] +
        [.hack Configuration File]) are all present.
  - DO NOT: add a 6th env var; drop `minimal`; state impl default as `high`; duplicate the section heading.

Task 4: EDIT docs/CONFIGURATION.md — UPDATE ## Models, Roles & Reasoning Budget (EDIT 4)
  - 4a: REPLACE the section intro (399-404) with the two-axes intro (verbatim in EDIT 4a).
  - 4b: REPLACE the stale tier↔role note (419-420) AND the Model Roles table (446-453) — change the
        column header to "Reasoning Level (default)" and cells to high/high/off; add the "Reasoning is
        a separate axis" pointer note (verbatim in EDIT 4b).
  - 4c: REPLACE the "Maximum reasoning budget … xhigh … normal (thinking omitted → undefined)" note
        (456-460) with the §9.2.9 behavior-change note (verbatim in EDIT 4c).
  - DELETE every remaining claim that the Reasoning role runs at `xhigh`, or Research/Implementation
        at "normal"/model-default. grep -n 'xhigh\|normal budget\|thinking.*omitted\|model-default'
        docs/CONFIGURATION.md after the edit → the ONLY `xhigh` mentions should be the vocab list
        (off|minimal|low|medium|high|xhigh) + the behavior-change note ("xhigh remains available").
  - DO NOT: touch Model Tiers (407-424), When to Use Each Tier (424-443), Model Override (462-475),
        or Deprecation (476-496) subsections beyond removing the stale cross-sentence at 419-420.

Task 5: VERIFY cross-links + format + lint
  - RUN: grep -n "#reasoning-levels" docs/CONFIGURATION.md   # → ToC entry + Models-section pointer + heading (≥3 hits, identical anchor).
  - RUN: grep -nc "^### Reasoning Levels$" docs/CONFIGURATION.md   # → exactly 1 (no duplicate heading).
  - RUN: npm run fix (format) → npm run format:check → npm run docs:lint (markdownlint).
  - RUN: git diff --name-only   # → ONLY docs/CONFIGURATION.md (no src/PRD/other-docs edit).
  - EXPECTED: all clean; exactly one Reasoning Levels heading; the anchor is consistent.
```

### Implementation Patterns & Key Details
```markdown
<!-- PATTERN: env-var subsection (mirror the existing Validation Control format) -->
### Reasoning Levels

<intro paragraph with the two-axes model + cross-link to Models, Roles & Reasoning Budget>

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `PRP_REASONING_AGENT` | No | `high` | … |
| … (5 rows; impl default `off`) |

**Vocabulary (case-insensitive):** `off`, `minimal`, `low`, `medium`, `high`, `xhigh` …

**Resolution & fail-fast (PRD §9.2.9):** … empty→default; invalid→ReasoningConfigError exit 1 …

**`.hack` keys:** … [link to .hack Configuration File]

<!-- PATTERN: the Model Roles table column change (old → new) -->
<!-- OLD (STALE): | Role | Tier | Reasoning Budget | … | normal / xhigh / normal | -->
<!-- NEW:        | Role | Tier | Reasoning Level (default) | … | high / high / off | -->

<!-- PATTERN: behavior-change note (replace the old "maximum reasoning budget" note) -->
> **Behavior change vs. the prior hard-wired design (PRD §9.2.9).** … Reasoning/Research → explicit
> `high`; Implementation → explicit `off`; `xhigh` remains available via explicit config.
```

### Integration Points
```yaml
docs/CONFIGURATION.md (the ONLY file edited):
  - ToC: +1 entry (Reasoning Levels → #reasoning-levels)
  - .hack Schema summary table: +1 [reasoning] row
  - ## Environment Variables: +1 ### Reasoning Levels subsection (5 rows + vocab + behavior)
  - ## Models, Roles & Reasoning Budget: intro rewrite (two-axes) + table column update (high/high/off)
        + behavior-change note (replacing the stale xhigh/normal/model-default claims)

CROSS-LINKS (must resolve):
  - ToC (#reasoning-levels) ↔ new ### Reasoning Levels heading  (NEW anchor)
  - ### Reasoning Levels → #models-roles--reasoning-budget (EXISTING — already valid)
  - ### Reasoning Levels → #hack-configuration-file (EXISTING — already valid)
  - Models section → #reasoning-levels (NEW — added in EDIT 4b)

DOCS (Mode B — this IS the changeset doc update):
  - docs/CONFIGURATION.md is the only artifact. No src/, PRD.md, .env.example, or other docs.
  - Commit message notes: Mode B reasoning-surface doc sync; new Reasoning Levels subsection + .hack
        row; corrected the stale Models section (xhigh→high, normal→high, model-default→off); xhigh
        still available; defaults high/high/high/high/off; siblings S2 (ARCHITECTURE.md) / S3 (README).
```

---

## Validation Loop

### Level 1: Format & Lint (doc-only)
```bash
npm run fix            # prettier --write **/*.md (run first — new tables/prose may reflow)
npm run format:check   # prettier --check — clean
npm run docs:lint      # markdownlint "docs/**/*.md" — clean (MD024 no-dup-headings, MD040 fenced-lang)
# Expected: all clean. If markdownlint flags a duplicate heading, you created a second "Reasoning Levels"
#   or "Model Roles" — remove the duplicate. If prettier flags, re-run `npm run fix`.
```

### Level 2: Cross-link & accuracy verification (the item's "Verify cross-links resolve")
```bash
# The new anchor is consistent across ToC + Models-section pointer + the heading itself:
grep -n "#reasoning-levels" docs/CONFIGURATION.md          # ≥3 hits, identical anchor
# Exactly ONE Reasoning Levels heading (no MD024 duplicate):
grep -nc "^### Reasoning Levels$" docs/CONFIGURATION.md    # → 1
# No stale reasoning claims remain (the only xhigh mentions = vocab list + behavior-change note):
grep -n "xhigh\|normal budget\|thinking field is omitted\|model-default\|model's default" docs/CONFIGURATION.md
# All 5 env vars + 5 .hack keys present:
grep -nc "PRP_REASONING_" docs/CONFIGURATION.md            # ≥5
grep -n  "\`agent\`, \`breakdown_agent\`, \`bug_finder_agent\`, \`validation_agent\`, \`impl_agent\`" docs/CONFIGURATION.md  # the .hack row
# impl default is documented as off (not high):
grep -n "PRP_REASONING_IMPL_AGENT.*\`off\`\|impl_agent.*off" docs/CONFIGURATION.md
# Expected: all checks pass; the stale-claims grep returns ONLY the vocab list + the behavior-change note.
```

### Level 3: Regression (no accidental source/spec edits)
```bash
git diff --name-only   # → ONLY docs/CONFIGURATION.md
git diff --stat -- src/ PRD.md .env.example docs/ARCHITECTURE.md docs/CLI_REFERENCE.md README.md
# Expected: empty (no other file touched). If anything shows, prune it — those are out of scope.
# (Optional) confirm the broader doc set still lints (a stale cross-link elsewhere would surface here):
npm run docs:lint
```

### Level 4: Creative & Domain-Specific Validation
```bash
# No MCP/DB/HTTP (documentation). Domain checks (record in commit message):
#   1. The 5 defaults read high/high/high/high/off (impl=off) — matches constants.ts:1598-1621.
#   2. The vocab is the 6-token set incl. minimal — matches REASONING_LEVELS (constants.ts:1534-1541).
#   3. Empty→default + invalid→ReasoningConfigError-exit-1 both stated (PRD §9.2.9 Resolution/Validation).
#   4. The two-axes model is stated in BOTH the new subsection and the updated Models section.
#   5. The behavior-change note says xhigh remains available (capability preserved; only defaults changed).
#   6. The .hack [reasoning] row + the env-var subsection cross-link to each other + to the Models section.
#   7. No stale xhigh/normal/model-default claims remain in the Models section.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run format:check` clean; `npm run docs:lint` clean.
- [ ] `grep -nc "^### Reasoning Levels$" docs/CONFIGURATION.md` === 1 (no duplicate heading).
- [ ] `grep -n "#reasoning-levels"` shows a consistent anchor (ToC + pointer + heading).
- [ ] `git diff --name-only` shows ONLY `docs/CONFIGURATION.md`.

### Feature Validation
- [ ] ToC has `- [Reasoning Levels](#reasoning-levels)`.
- [ ] `.hack Schema summary` table has a `[reasoning]` row (5 keys → 5 env vars).
- [ ] `### Reasoning Levels` subsection: 5 rows, defaults `high/high/high/high/off`, 6-token vocab
      (incl. `minimal`), empty→default, invalid→hard-error, two cross-links.
- [ ] `## Models, Roles & Reasoning Budget`: two-axes intro; Model Roles table column
      "Reasoning Level (default)" = `high`/`high`/`off`; behavior-change note present.
- [ ] No stale `xhigh`/`normal budget`/`model-default` claims remain (only vocab list + change note).

### Code Quality Validation
- [ ] Only `docs/CONFIGURATION.md` edited (extend, not rewrite); existing sections/tables preserved.
- [ ] New tables match the established column format; blank lines surround tables/fences.
- [ ] Cross-links use correct GitHub anchors; all resolve.
- [ ] Defaults/vocab match the SHIPPED code (constants.ts) — impl=`off`, vocab incl. `minimal`.

### Documentation & Deployment
- [ ] Mode B changeset doc sync — `docs/CONFIGURATION.md` is the only artifact.
- [ ] No `src/`, `PRD.md`, `.env.example`, or other doc files touched.
- [ ] Commit message notes: reasoning-surface doc sync; new subsection + .hack row; corrected stale
      Models section; defaults high/high/high/high/off; xhigh still available; siblings S2/S3.

---

## Anti-Patterns to Avoid

- ❌ Don't rewrite `docs/CONFIGURATION.md` — EXTEND it (4 edits at the verified anchors). The file is
      862 lines of established reference; preserve every section you're not explicitly updating.
- ❌ Don't state the impl default as `high` — it's `off` (constants.ts:1621). The 5 defaults are
      `high/high/high/high/off`. This is the #1 accuracy failure.
- ❌ Don't drop `minimal` from the vocabulary — the shipped set is `off|minimal|low|medium|high|xhigh`
      (6 tokens). A 5-token vocab is wrong.
- ❌ Don't say `xhigh` was removed — §9.2.9 is a DEFAULT change (xhigh→high for reasoning roles), not a
      capability removal. The behavior-change note MUST state `xhigh` remains available via explicit config.
- ❌ Don't leave the stale `## Models, Roles & Reasoning Budget` claims (lines 419-420, 446-460: `xhigh`,
      `normal`, `model-default`, "thinking omitted → undefined") alongside the new content —
      contradictory docs are worse than the gap. EDIT 4 REPLACES them.
- ❌ Don't omit either the empty→default OR the invalid→hard-error behavior — both are required
      (PRD §9.2.9 Resolution + Validation).
- ❌ Don't create a duplicate "Reasoning Levels" or "Model Roles" heading — markdownlint MD024 fails.
      The Models section KEEPS its "Model Roles" subsection (updated in place); the new subsection is
      "Reasoning Levels" (under Environment Variables).
- ❌ Don't conflate the 5 agent identities with the 3 model roles — the Reasoning Levels subsection is
      the per-identity reference (5 env-var rows); the Models section stays at role granularity (3 rows)
      with a pointer to the subsection.
- ❌ Don't guess the GitHub anchor — `### Reasoning Levels` → `#reasoning-levels`; the ToC entry must
      match EXACTLY. Verify with `grep -n "#reasoning-levels"`.
- ❌ Don't edit `src/`, `PRD.md`, `.env.example` (T1.S4 already did the reasoning subsection there),
      `docs/ARCHITECTURE.md` (S2), `README.md` (S3), `docs/CLI_REFERENCE.md`, `tasks.json`, or
      `prd_snapshot.md`. `git diff --name-only` must show ONLY `docs/CONFIGURATION.md`.
- ❌ Don't run `npm run typecheck`/`npm run lint` expecting them to validate the doc — they cover `.ts`,
      not `.md`. The doc gates are `npm run format:check` (prettier covers `*.md`) + `npm run docs:lint`
      (markdownlint) + the cross-link/accuracy greps.
- ❌ Don't run the full `npm run test:run` — it's orthogonal to a doc-only task (and has pre-existing
      failures). Gate on format + docs:lint + the verification greps.

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: This is a Mode B doc-only task with every fact verified against shipped code
(`constants.ts:1519-1621` confirms `high/high/high/high/off` + the 6-token vocab; `hack-config.ts:213-256`
confirms the 5 `[reasoning]` entries) and the PRD (§9.2.9 / §9.7.5 / §9.2.2). The 4 edit sites are pinned
to exact line numbers with copy-ready prose, the stale lines to replace are enumerated (419-420, 446-460),
and the cross-link/anchor verification is a deterministic grep. The change is strictly additive to one
doc file, file-disjoint from the parallel T4.S2 (a test file) and the sibling Mode B tasks (different
docs, sequenced). The residual risks are doc-accuracy nits — stating impl as `off` (not `high`),
keeping `minimal` in the vocab, and not leaving stale `xhigh`/`normal` claims — all enumerated as
anti-patterns + verified by the Level-2 greps. A prettier/markdownlint nit is auto-fixed via
`npm run fix`. No runtime/network/LLM unknowns — pure documentation.