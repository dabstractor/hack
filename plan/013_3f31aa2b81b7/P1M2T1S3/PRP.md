# PRP — P1.M2.T1.S3: README.md — per-role reasoning is independently configurable (link CONFIGURATION)

> Plan 013, PRD §9.2.9 (Per-Role Reasoning Level) → **Mode B changeset doc sync.** The feature
> (P1.M1 T1–T4, Complete) decoupled the reasoning budget from model selection and made it a
> first-class per-role setting. S1 (Complete) wrote the canonical reference in `docs/CONFIGURATION.md`;
> S2 (Implementing) extends `docs/ARCHITECTURE.md`. **This task surfaces the capability in README.md**
> with a concise feature-blurb + a pointer to CONFIGURATION.md — the README entry point a user hits
> first. Doc-only; no `src/`, no `PRD.md`, no other docs.

---

## Goal

**Feature Goal**: Add ONE concise blurb to README.md's agent/model-configuration summary
(`### Model Tiers`) so a user discovers that the extended-thinking (reasoning) level is
**independently configurable per role** (`off`/`minimal`/`low`/`medium`/`high`/`xhigh`),
**decoupled from model selection** (PRD §9.2.9), with a working link to `docs/CONFIGURATION.md`
for the per-role env vars and defaults. The detail lives in CONFIGURATION (S1) / ARCHITECTURE
(S2); README only surfaces + points.

**Deliverable** — EDIT `README.md` ONLY (extend, do not rewrite):
1. In `### Model Tiers` (under `## Configuration`, ~line 458-465), add a `>` blockquote note
   immediately AFTER the existing "Tier names were renamed…" note stating reasoning is a
   separate per-role axis (vocab + decoupling + link). Feature-blurb scope (≤5 lines).

**Success Definition**:
- README.md `### Model Tiers` contains a concise note that reasoning level is independently
  configurable per role (`off`/`minimal`/`low`/`medium`/`high`/`xhigh`), decoupled from model
  selection, with a link `docs/CONFIGURATION.md#reasoning-levels`.
- The link resolves: the anchor `#reasoning-levels` matches the unique `### Reasoning Levels`
  heading at `docs/CONFIGURATION.md:233` (S1); the relative path matches README's existing
  `docs/CONFIGURATION.md#…` link convention.
- No env-var table, per-role default table, or vocab detail is duplicated in README (that lives
  in CONFIGURATION.md — the blurb only points).
- `npm run format:check` clean (prettier covers README.md). `git diff --name-only` shows ONLY
  `README.md`. No `src/`, `PRD.md`, `PROMPTS.md`, `tasks.json`, `prd_snapshot.md`, or sibling
  doc edits.

---

## Why

- **README is the entry point.** It is the first doc a user reads; the per-role reasoning
  surface (a headline §9.2.9 capability — "you no longer have to drop model tiers to disable
  thinking") is invisible there today. S1 wrote the reference; S3 makes it discoverable from
  the README's configuration section.
- **Mode B changeset doc sync.** This subtask IS the README slice of the changeset-level
  documentation sweep for the per-role reasoning feature (S1=CONFIGURATION, S2=ARCHITECTURE,
  S3=README).
- **Decoupling is the headline.** The §9.2.9 "Problem" was that the only lever to reduce
  reasoning was to switch to a lower-tier model. README's `### Model Tiers` is exactly where a
  user thinks about tiers — placing the "reasoning is a SEPARATE axis" note right there delivers
  the a-ha at the moment the user is reasoning about model choice.
- **Scoped & non-duplicative.** One blurb + one link. No env-var/`.hack`/default tables (those
  are CONFIGURATION.md's job — the blurb links there). No architecture prose (ARCHITECTURE.md's
  job). File-disjoint from S1/S2 → no merge conflict.
- **Out of scope (hard boundary):** `docs/CONFIGURATION.md` (S1, Complete), `docs/ARCHITECTURE.md`
  (S2, Implementing), any `src/` (feature Complete), `PRD.md`, `PROMPTS.md`, `.env.example`,
  `tasks.json`, `prd_snapshot.md`. The two-axes detail + per-role env vars stay in the linked docs.

---

## What

### User-visible behavior
None (documentation). Indirectly: a reader of README's configuration section now learns reasoning
is a separate, per-role axis and can follow the link to the env-var/defaults reference.

### Technical requirements (exact contract)

**EDIT `README.md` — `### Model Tiers` (~line 458-465).** Insert the following `>` blockquote note
IMMEDIATELY AFTER the existing "Tier names were renamed…" note (after line 465), so the section
reads: tier bullets → tier-rename note → reasoning-is-a-separate-axis note:

```markdown
> **Reasoning is a separate, per-role axis** (PRD §9.2.9): each agent role's
> extended-thinking budget is independently configurable — `off` / `minimal` / `low`
> / `medium` / `high` / `xhigh` — and is decoupled from model selection, so you can
> run a strong model with thinking off or a fast model with thinking on. See
> [Configuration → Reasoning Levels](docs/CONFIGURATION.md#reasoning-levels) for the
> per-role env vars and defaults.
```

That is the **entire** deliverable. Constraints:
- **Link**: `docs/CONFIGURATION.md#reasoning-levels`. Matches README's existing relative-link
  convention (e.g. line 410 `docs/CONFIGURATION.md#hack-configuration-file`). The anchor
  `#reasoning-levels` matches the unique `### Reasoning Levels` heading at `docs/CONFIGURATION.md:233`
  (added by S1).
- **Vocab**: `off` / `minimal` / `low` / `medium` / `high` / `xhigh` — the canonical §9.2.9
  vocabulary (S1/S2 use the same). Do NOT use `max` (dropped) or omit `minimal`.
- **Decoupling**: state "decoupled from model selection" — the §9.2.9 headline. Do NOT imply
  reasoning is still tied to model tier.
- **Scope**: feature-blurb only. Do NOT add the per-role env-var table (`PRP_REASONING_*`) or
  the defaults table — those live in CONFIGURATION.md (the blurb links there).

**Do NOT** rewrite the `### Model Tiers` section, change the tier bullets, touch any other
README section, or edit any other file.

### Success Criteria
- [ ] README.md `### Model Tiers` has a `>` note stating reasoning is independently configurable
      per role, decoupled from model selection, with the canonical vocab + a link to
      `docs/CONFIGURATION.md#reasoning-levels`.
- [ ] The link's anchor `#reasoning-levels` matches a unique heading in `docs/CONFIGURATION.md`
      (the S1 `### Reasoning Levels` subsection).
- [ ] No env-var/defaults table or vocab detail duplicated in README (CONFIGURATION owns those).
- [ ] `npm run format:check` clean.
- [ ] `git diff --name-only` shows ONLY `README.md`.

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_ **Yes** — the
exact insertion point (README `### Model Tiers`, after the existing "Tier names were renamed" note
at line 465), the verbatim blurb, the verified link target (`docs/CONFIGURATION.md#reasoning-levels`
↔ unique `### Reasoning Levels` at line 233), the canonical vocab, the README link convention
(verified: relative `docs/CONFIGURATION.md#…`), the validation surface (prettier `format:check`
covers README; `docs:check`/`docs:lint`/`docs:links` are scoped to `./docs` and do NOT scan
README → manual link verification), the scope boundary (no table duplication; CONFIGURATION=S1,
ARCHITECTURE=S2), and the executable gates. See `research/readme-reasoning-blurb.md` for evidence.

### Documentation & References
```yaml
# MUST READ — the authoritative requirement
- docfile: plan/013_3f31aa2b81b7/prd_snapshot.md
  section: "#### 9.2.9 Per-Role Reasoning Level" (h4.8) + "#### 9.2.3 Model Selection" (h4.2)
  why: §9.2.9 = the decoupling (reasoning is a first-class per-role setting, independent of model id)
        + the vocab (off/minimal/low/medium/high/xhigh) + the defaults (high/high/high/high/off).
        §9.2.3 = the role→tier model mapping (UNCHANGED — reasoning is the OTHER axis).
  critical: State the DECOUPLING (the §9.2.9 headline: "no longer forced to drop model tiers to disable
        thinking"). Do NOT imply reasoning is tied to tier. Use the canonical vocab (minimal added, max dropped).

# MUST READ — this subtask's research (insertion point + link target + validation surface + scope)
- docfile: plan/013_3f31aa2b81b7/P1M2T1S3/research/readme-reasoning-blurb.md
  section: "1. The insertion point", "2. NO existing reasoning mention", "3. The link target",
           "4. The validation surface for README.md", "5. Scope boundary", "6. The blurb wording"
  why: Pins README `### Model Tiers` (458-465) + the existing `>` note pattern; proves the link target
        (docs/CONFIGURATION.md#reasoning-levels ↔ S1 line 233, unique); proves prettier (not docs:*) is
        the README gate (docs:check is scoped to ./docs); confirms zero existing reasoning mention.

# CONTRACT — the sibling whose file S3 must NOT touch + whose content S3 defers to (the link target)
- file: plan/013_3f31aa2b81b7/P1M2T1S1/PRP.md
  why: S1 (Complete) added `### Reasoning Levels` (docs/CONFIGURATION.md:233, anchor #reasoning-levels)
        + the `## Models, Roles & Reasoning Budget` section. S3's README blurb LINKS to that subsection;
        it does NOT duplicate the env-var/defaults tables (CONFIGURATION owns those).
  critical: Do NOT edit docs/CONFIGURATION.md (S1's file). Do NOT add the per-role env-var table to README.

# CONTRACT — the parallel sibling (file-disjoint; S3 must NOT touch docs/ARCHITECTURE.md)
- file: plan/013_3f31aa2b81b7/P1M2T1S2/PRP.md
  why: S2 (Implementing) extends docs/ARCHITECTURE.md's agent/model sections to the two-axes model +
        the QA split + the harness seam. S3's README blurb is the user-facing surface; ARCHITECTURE is
        the architecture description. Different files, no overlap.

# THE FILE TO EDIT — exact insertion site + the existing note pattern to mirror
- file: README.md
  why: EDIT — `### Model Tiers` (under `## Configuration`, ~line 458-465). Insert the new `>` note
        AFTER the existing "Tier names were renamed `opus`→`high`…" note (after line 465).
  pattern: "> Tier names were renamed `opus`→`high`, `sonnet`→`balanced`, `haiku`→`fast` (PRD §9.2.8).\n> The legacy `ANTHROPIC_DEFAULT_*` env vars still work with a one-time deprecation warning."
  gotcha: README's existing relative-link convention is `docs/CONFIGURATION.md#anchor` (verified lines
          410/426/427/428/438). Use `docs/CONFIGURATION.md#reasoning-levels` (NOT a leading slash, NOT
          an absolute path). The `>` blockquote multi-line syntax is already used in this section.

# THE LINK TARGET (read-only — verify the anchor resolves before/after editing)
- file: docs/CONFIGURATION.md
  why: S1 added `### Reasoning Levels` at line 233 (anchor `#reasoning-levels`). The README blurb links
        here for the per-role env vars (`PRP_REASONING_*`), the `.hack` `[reasoning]` keys, the vocab,
        the defaults, the empty-value/fail-fast behavior, and the behavior-change note.
  pattern: "### Reasoning Levels   (docs/CONFIGURATION.md:233)"
  critical: The anchor slug is `reasoning-levels` (lowercase, spaces→hyphens). Verified UNIQUE in
        CONFIGURATION.md (only line 233 matches). If S1 is somehow not yet landed when S3 runs, the link
        would dangle — verify with `grep -nE "^### Reasoning Levels" docs/CONFIGURATION.md` (expect 1 hit).

# VALIDATION — what actually gates README.md (prettier covers it; docs:* do NOT)
- file: package.json
  why: `format:check` = `prettier --check "**/*.{ts,js,json,md,yml,yaml}"` (line 44) — covers README.md
        (NOT in .prettierignore). `docs:check`/`docs:lint`/`docs:links` are scoped to `docs/**/*.md`
        (lines 57-60) and do NOT scan README.md. So the deterministic README gate = `format:check`;
        the link must be verified MANUALLY (grep the anchor + the relative path).
  gotcha: Do NOT claim `docs:check` validates the README link — it doesn't (scripts/check-docs.ts
        constructor docsPath='./docs', line 33). Verify the link by grepping the target heading.
```

### Current Codebase tree (relevant slice)
```bash
README.md                  # EDIT — `### Model Tiers` += one `>` reasoning-axis blurb + link
docs/CONFIGURATION.md      # LINK TARGET (S1, Complete) — #reasoning-levels subsection @233 — UNCHANGED here
docs/ARCHITECTURE.md       # UNCHANGED here (S2, Implementing — file-disjoint)
```

### Desired Codebase tree with files to be added/edited
```bash
README.md                  # MODIFIED (one `>` note added after the Model Tiers rename note)
# (NO other files — doc-only, single file)
```

### Known Gotchas of our codebase & Library Quirks
```markdown
<!-- CRITICAL — EXTEND, do not rewrite. README.md is ~42KB. Add ONE `>` note to `### Model Tiers`; touch
     nothing else. Do not reorder the tier bullets, do not edit any other section. -->

<!-- CRITICAL — the link is `docs/CONFIGURATION.md#reasoning-levels`. README's convention is a RELATIVE path
     from the repo root (verified lines 410/426-428/438). Do NOT use a leading slash, an absolute path, or a
     GitHub URL. The anchor slug `reasoning-levels` matches the unique `### Reasoning Levels` heading at
     docs/CONFIGURATION.md:233 (S1). Verify with `grep -nE "^### Reasoning Levels" docs/CONFIGURATION.md`. -->

<!-- CRITICAL — use the canonical vocab: `off` / `minimal` / `low` / `medium` / `high` / `xhigh`. Do NOT use
     `max` (dropped in §9.2.9) and do NOT omit `minimal` (added). S1/S2 use the same vocab. -->

<!-- CRITICAL — state the DECOUPLING. The §9.2.9 headline is "reasoning is decoupled from model selection —
     you no longer drop model tiers to disable thinking." Do NOT imply reasoning is tied to tier. -->

<!-- CRITICAL — DO NOT duplicate the env-var table (`PRP_REASONING_AGENT` etc.) or the per-role defaults table
     in README. Those live in CONFIGURATION.md (S1). The blurb POINTS there ("See … for the per-role env vars
     and defaults"). Feature-blurb scope only. -->

<!-- GOTCHA — README.md is at the repo ROOT, so `docs:check` (scripts/check-docs.ts, docsPath='./docs'),
     `docs:lint` (markdownlint docs/**/*.md), and `docs:links` (markdown-link-check docs/**/*.md) do NOT scan
     it. The deterministic README gate is `npm run format:check` (prettier --check **/*.md, README not in
     .prettierignore). The link must be verified MANUALLY (grep the target heading + the relative path). -->

<!-- GOTCHA — prettier formats markdown: it will rewrap prose lines and normalize the blockquote. Run
     `npm run format` (prettier --write README.md) BEFORE `npm run format:check`, or format:check fails on
     a reflow nit. Let prettier handle line-wrapping of the multi-line `>` note. -->

<!-- GOTCHA — the `>` blockquote multi-line syntax: each line begins with `> `. Prettier preserves it. A blank
     `>` line inside the blockquote is optional; keep the note contiguous (no blank line mid-note) to read as
     one block. -->

<!-- CRITICAL — DO NOT edit docs/CONFIGURATION.md (S1, Complete), docs/ARCHITECTURE.md (S2, Implementing),
     any src/ file (feature Complete), PRD.md, PROMPTS.md, .env.example, tasks.json, or prd_snapshot.md.
     `git diff --name-only` must show ONLY README.md. -->
```

---

## Implementation Blueprint

### Data models and structure
None — documentation only. No `src/`, no types, no tests. The "structure" is one `>` blockquote note
appended to the `### Model Tiers` section.

### Implementation Tasks (ordered by dependencies)
```yaml
Task 1: EDIT README.md — add the reasoning-axis blurb to `### Model Tiers`
  - LOCATE `### Model Tiers` (under `## Configuration`, ~line 458). Find the existing note:
        "> Tier names were renamed `opus`→`high`, `sonnet`→`balanced`, `haiku`→`fast` (PRD §9.2.8).
         > The legacy `ANTHROPIC_DEFAULT_*` env vars still work with a one-time deprecation warning."
    (ends ~line 465).
  - INSERT immediately AFTER that note (and a single blank line) the verbatim `>` note from
    "Technical requirements":
        > **Reasoning is a separate, per-role axis** (PRD §9.2.9): each agent role's
        > extended-thinking budget is independently configurable — `off` / `minimal` / `low`
        > / `medium` / `high` / `xhigh` — and is decoupled from model selection, so you can
        > run a strong model with thinking off or a fast model with thinking on. See
        > [Configuration → Reasoning Levels](docs/CONFIGURATION.md#reasoning-levels) for the
        > per-role env vars and defaults.
  - DO NOT modify the tier bullets, the existing rename note, the `### How It Works` section
    that follows, or any other README section.
  - DO NOT add the env-var table or per-role defaults — the blurb links to CONFIGURATION.md.

Task 2: VERIFY the link resolves (manual — docs:* do NOT scan README)
  - RUN: grep -nE "^### Reasoning Levels" docs/CONFIGURATION.md   # expect: exactly 1 hit (line 233).
    (If 0 hits, S1's `### Reasoning Levels` subsection is absent — the link dangles. S1 is Complete,
     so this should not happen; if it does, STOP and flag the S1 dependency rather than inventing a
     different anchor.)
  - CONFIRM the slug: "Reasoning Levels" → `reasoning-levels` (lowercase, spaces→hyphens). The link
    `docs/CONFIGURATION.md#reasoning-levels` matches.
  - CONFIRM the relative-path convention matches README's other links (e.g. line 410).

Task 3: FORMAT + VERIFY
  - RUN: npm run format         # prettier --write README.md (rewraps the multi-line `>` note to house style).
  - RUN: npm run format:check   # prettier --check **/*.md — MUST be clean (this is the README gate).
  - GREP (new content PRESENT): grep -nE "Reasoning is a separate, per-role axis|reasoning-levels" README.md  # expect ≥2 hits.
  - GREP (no accidental duplication): grep -ciE "PRP_REASONING" README.md  # expect 0 (no env-var table leaked into README).
  - RUN: git diff --name-only   # expect: ONLY README.md.
  - EXPECTED: format:check clean; the blurb present; no env-var leakage; only README.md changed.
    NOTE: docs:check / docs:lint / docs:links are scoped to docs/ and do NOT validate README — do not rely on them.
```

### Implementation Patterns & Key Details
```markdown
<!-- ---- README.md `### Model Tiers` — the new note (placed after the existing rename note) ---- -->
### Model Tiers

- **High** (glm-5.2): Highest quality, used for Architect agent
- **Balanced** (glm-5.2): Balanced quality/speed, default for planning & research roles
- **Fast** (glm-5-turbo): Fastest, used for the implementation role (simple operations)

> Tier names were renamed `opus`→`high`, `sonnet`→`balanced`, `haiku`→`fast` (PRD §9.2.8).
> The legacy `ANTHROPIC_DEFAULT_*` env vars still work with a one-time deprecation warning.

> **Reasoning is a separate, per-role axis** (PRD §9.2.9): each agent role's
> extended-thinking budget is independently configurable — `off` / `minimal` / `low`
> / `medium` / `high` / `xhigh` — and is decoupled from model selection, so you can
> run a strong model with thinking off or a fast model with thinking on. See
> [Configuration → Reasoning Levels](docs/CONFIGURATION.md#reasoning-levels) for the
> per-role env vars and defaults.

### How It Works
...
```

### Integration Points
```yaml
README.MD:
  - `### Model Tiers` (under `## Configuration`): += one `>` note (reasoning-axis blurb + link).
  - PRESERVE: the tier bullets, the existing rename note, `### How It Works`, and every other section.

NO OTHER FILES (hard boundary):
  - docs/CONFIGURATION.md (S1, Complete — the link TARGET; do NOT edit; do NOT duplicate its tables).
  - docs/ARCHITECTURE.md (S2, Implementing — file-disjoint).
  - any src/ (feature Complete), PRD.md, PROMPTS.md, .env.example, tasks.json, prd_snapshot.md.

DOCS (Mode B — this subtask IS the README changeset-level doc update):
  - No env-var/defaults table in README (CONFIGURATION owns those; the blurb links there).
  - Feature-blurb scope: capability + pointer only.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
npm run format         # prettier --write README.md (rewraps the multi-line `>` note to house style) — run FIRST
npm run format:check   # prettier --check **/*.md — MUST be clean (this is the README gate)
# Expected: clean. If format:check fails, re-run `npm run format` (prettier auto-fixes markdown reflow).
# NOTE: `npm run docs:lint` (markdownlint docs/**/*.md) and `npm run docs:check` (scripts/check-docs.ts,
#   docsPath='./docs') do NOT scan README.md (repo root) — they are not gates for this task. Do not rely on them.
```

### Level 2: Link Verification (manual — no automated gate for root .md links)
```bash
# The link target heading MUST exist and be unique:
grep -nE "^### Reasoning Levels" docs/CONFIGURATION.md   # expect: exactly 1 hit (line 233)
# The slug matches: "Reasoning Levels" → `reasoning-levels` (lowercase, spaces→hyphens)
# The README link uses the relative-path convention (matches line 410 etc.):
grep -nE "docs/CONFIGURATION\.md#reasoning-levels" README.md   # expect: ≥1 hit (the new blurb)
# Expected: 1 unique heading hit; the README blurb carries the exact `docs/CONFIGURATION.md#reasoning-levels` link.
#   If the heading is absent (S1 not landed), STOP and flag the S1 dependency — do NOT invent a different anchor.
```

### Level 3: Content & Scope (System Validation)
```bash
# New content PRESENT:
grep -nE "Reasoning is a separate, per-role axis|reasoning-levels" README.md   # expect: ≥2 hits (the blurb + the link)
# No env-var leakage (the detail stays in CONFIGURATION, not README):
grep -ciE "PRP_REASONING_" README.md   # expect: 0
# Scope — ONLY README.md changed:
git diff --name-only   # expect: README.md (and only README.md)
# Expected: blurb present + link present; no PRP_REASONING_ env-var table in README; only README.md in the diff.
```

### Level 4: Creative & Domain-Specific Validation
```bash
# Doc-only — no MCP/DB/HTTP. Domain checks (record in commit message):
#   1. The §9.2.9 capability is discoverable from README's configuration section (a user reading Model Tiers
#      now learns reasoning is a separate, per-role axis).
#   2. The link `docs/CONFIGURATION.md#reasoning-levels` resolves to S1's reference subsection (verified unique).
#   3. The decoupling headline is stated (the §9.2.9 "Problem" — no longer forced to drop model tiers).
#   4. No duplication: the env-var table + per-role defaults stay in CONFIGURATION.md (README only points).
#   5. git diff --name-only shows ONLY README.md.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run format:check` clean (prettier covers README.md).
- [ ] `grep -nE "^### Reasoning Levels" docs/CONFIGURATION.md` returns exactly 1 hit (link target valid + unique).
- [ ] `grep -nE "docs/CONFIGURATION\.md#reasoning-levels" README.md` returns ≥1 hit (the link is present).
- [ ] `git diff --name-only` shows ONLY `README.md`.

### Feature Validation
- [ ] README `### Model Tiers` has a `>` note stating reasoning is independently configurable per role.
- [ ] The note lists the canonical vocab (`off`/`minimal`/`low`/`medium`/`high`/`xhigh`).
- [ ] The note states reasoning is decoupled from model selection (the §9.2.9 headline).
- [ ] The note links to `docs/CONFIGURATION.md#reasoning-levels` (resolves to S1's subsection).

### Code Quality Validation
- [ ] Only ONE `>` note added; the rest of `### Model Tiers` and README untouched.
- [ ] No env-var table / per-role defaults table duplicated in README (`grep -ciE "PRP_REASONING_" README.md` = 0).
- [ ] Vocab matches §9.2.9 (minimal present, max absent).
- [ ] Relative link matches README's existing `docs/CONFIGURATION.md#…` convention (no leading slash / absolute path).

### Documentation & Deployment
- [ ] This subtask IS the Mode B changeset-level doc update for README.md.
- [ ] No `PRD.md`, `PROMPTS.md`, `.env.example`, `tasks.json`, `prd_snapshot.md`, `src/`, or sibling-doc edits.
- [ ] Commit message notes: README surfaces the per-role reasoning axis + links to CONFIGURATION; feature-blurb
      scope (no table duplication); file-disjoint from S1 (CONFIGURATION) / S2 (ARCHITECTURE); prettier is the gate.

---

## Anti-Patterns to Avoid

- ❌ Don't rewrite the `### Model Tiers` section or README. EXTEND — append ONE `>` note after the existing
      rename note. Leave the tier bullets, `### How It Works`, and every other section untouched.
- ❌ Don't use a broken/dangling link. The anchor MUST be `#reasoning-levels` matching the unique `### Reasoning
      Levels` heading at `docs/CONFIGURATION.md:233` (S1). Verify with grep. If S1's subsection is absent, STOP
      and flag the dependency — don't invent a different anchor.
- ❌ Don't use a non-conventional link. README uses relative `docs/CONFIGURATION.md#…` (verified). No leading slash,
      no absolute path, no GitHub URL.
- ❌ Don't use the old/incomplete vocab. The canonical set is `off`/`minimal`/`low`/`medium`/`high`/`xhigh`. No `max`
      (dropped); don't omit `minimal` (added).
- ❌ Don't omit the decoupling. The §9.2.9 headline is "reasoning is decoupled from model selection." Stating only
      "reasoning is configurable" without "decoupled from model selection" misses the point.
- ❌ Don't duplicate the env-var table (`PRP_REASONING_*`) or per-role defaults table in README. Those live in
      CONFIGURATION.md (S1). The blurb POINTS there. `grep -ciE "PRP_REASONING_" README.md` must be 0.
- ❌ Don't rely on `docs:check` / `docs:lint` / `docs:links` to validate README — they're scoped to `docs/` and do
      NOT scan the repo-root README. The gate is `format:check` (prettier) + manual link verification (grep).
- ❌ Don't edit `docs/CONFIGURATION.md` (S1, Complete — the link target), `docs/ARCHITECTURE.md` (S2, Implementing),
      any `src/`, `PRD.md`, `PROMPTS.md`, `.env.example`, `tasks.json`, or `prd_snapshot.md`. `git diff --name-only`
      must show ONLY `README.md`.
- ❌ Don't skip `npm run format` before `format:check` — prettier rewraps the multi-line `>` note; skipping it makes
      format:check fail on a reflow nit.

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: This is the smallest possible Mode B doc task — ONE `>` blockquote note appended to one
located README section (`### Model Tiers`, after the existing rename note at line 465). The verbatim
blurb is given; the link target is verified (`docs/CONFIGURATION.md#reasoning-levels` ↔ the unique
`### Reasoning Levels` heading S1 added at line 233); the relative-link convention is confirmed against
README's existing links (line 410/426-428/438); the vocab is fixed (canonical §9.2.9 set); and the
decoupling headline is prescribed. The one non-obvious fact — that `docs:check`/`docs:lint`/`docs:links`
are scoped to `./docs` and do NOT scan the repo-root README (verified via `scripts/check-docs.ts`
`docsPath='./docs'`), so the gate is `format:check` (prettier, README not in `.prettierignore`) + manual
link verification — is explicit. Scope is airtight: file-disjoint from S1 (CONFIGURATION) and S2
(ARCHITECTURE); no env-var/defaults duplication (the blurb only points). Residual risks: (a) a prettier
reflow nit (auto-fixed via `npm run format`); (b) the link dangling IF S1 were somehow absent at S3's
run (S1 is Complete, so this should not happen — the grep gate catches it and says STOP-and-flag rather
than invent an anchor). No runtime/network/LLM unknowns — pure documentation.