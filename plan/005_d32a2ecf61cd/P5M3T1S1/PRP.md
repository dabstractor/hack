# PRP — P5.M3.T1.S1: Add self-healing/resilience blurb to README.md

## Goal

**Feature Goal**: Implement the **Mode B changeset-level documentation sweep** (PRD §6.1 / §6.4; delta_prd.md §3) for the root `README.md`. Now that all R1–R4 resilience work has landed (P5.M1 Complete; P5.M2 implementation in parallel — treated as a CONTRACT), surface those capabilities in the one place that currently has **zero** resilience content: the project README. Add a short, accurate **`Self-Healing & Resilience`** blurb naming the three mechanisms and their env-var knobs, **linking** to the detailed Mode A docs rather than duplicating them.

**Deliverable**:
1. **MODIFY `README.md`** (project root) — the ONLY file changed:
   - Add **one bullet** to the existing `## Features` list surfacing self-healing/resilience.
   - Add a new **`## Self-Healing & Resilience`** section (the blurb) — placed immediately after the `## Features` bullet list and before `## Usage Examples` — that names the three implemented mechanisms, their env-var knobs + defaults, and **links** to the three Mode A docs (`docs/CONFIGURATION.md#resilience-tuning`, `docs/WORKFLOWS.md#issue-driven-re-planning`, `docs/ARCHITECTURE.md#tasksjson-protection--smart-recovery`).
2. No code, no tests, no other docs touched.

**Success Definition**: `npm run docs:lint` green (exit 0 — trivially, since README is not in its glob; do NOT touch `docs/*.md`), `npm run format:check` green (prettier checks README), `git diff --stat` shows **ONLY** `README.md`, the new section states **only what is implemented** (non-stale), and every claim links to its detailed Mode A doc instead of duplicating it.

## User Persona

**Target User**: A developer/evaluator reading the project README to understand what the pipeline can do. They want a 30-second answer to "does this pipeline survive agent failures?" before reading the deep docs.

**Use Case**: Skimming the README's `## Features` / high-level sections to assess pipeline robustness. Today they find delta sessions, bug hunt, resumable sessions — but **nothing** about self-healing, despite three resilience mechanisms being implemented. This blurb closes that gap and routes interested readers to the detailed docs.

**User Journey**: open README → see "Self-Healing & Resilience" in the Features list → read the 3-mechanism blurb → click the link to `docs/CONFIGURATION.md#resilience-tuning` (or WORKFLOWS.md / ARCHITECTURE.md) for the deep dive.

**Pain Points Addressed**: README currently misrepresents the pipeline's maturity by omitting implemented resilience features (grep for `resilien|self-heal|recovery|re-plan|RESEARCH_TIMEOUT|ISSUE_RETRY_MAX` returns nothing). Readers underestimate the system; the docs feel stale relative to the code.

## Why

- **Business value**: Completes the **Mode B** doc-sync obligation introduced by R3 (PRD §6.1 two-mode rule). Mode A already added the per-item docs (CONFIGURATION.md rows, WORKFLOWS.md subsection, ARCHITECTURE.md narrative). Mode B is the **single final task** that reconciles the cross-cutting, changeset-level surfaces (README + later the WORKFLOWS/ARCHITECTURE overview in the sibling S2) — it depends on all implementing subtasks by design, so the content is stable.
- **Scope boundary**: This subtask owns **`README.md` only**. The sibling subtask **P5.M3.T1.S2** ("Reconcile WORKFLOWS.md + ARCHITECTURE.md into a coherent resilience narrative") owns the `docs/` reconciliation. S1 must NOT touch `docs/*.md` (would collide with S2 and duplicate Mode A work).
- **Non-stale contract**: Only state what is implemented. R1 (research deadline + synchronous fallback, `RESEARCH_TIMEOUT`) ✓ Complete; R2 (issue-driven re-planning, `ISSUE_RETRY_MAX`) ✓ Complete; R4 (tasks.json protection & git-history smart recovery) — primitives + routine Complete, wiring in parallel (CONTRACT). All three are real → safe to document.

## What

### User-visible behavior

A new `## Self-Healing & Resilience` section appears in the README (after Features), plus one new bullet in the Features list. The section describes the three self-healing mechanisms in plain prose, names the two env-var knobs with defaults, and links to the detailed docs for each. No behavioral/code change.

### Technical requirements (the CONTRACT)

1. **EDIT `README.md` ONLY.** `git diff --stat` must show exactly one file: `README.md`.
2. **Add one bullet to `## Features`** (the capabilities list, ≈ L108–118). Keep it one line, consistent with the existing bullet voice (bold lead-in + short description). It must surface the capability and may link to the new section.
3. **Add a new `## Self-Healing & Resilience` section** immediately AFTER the `## Features` bullet list and BEFORE `## Usage Examples` (≈ between L118 and L120). It must:
   - Open with one sentence framing the three mechanisms.
   - List the **three** mechanisms as bullets, each naming: the mechanism, its env-var knob + default (where one exists), and a one-line "what it does". The three mechanisms (verbatim scope):
     1. **Research deadline & synchronous fallback** — `RESEARCH_TIMEOUT` (default `300`s; PRD §4.2). Background research is bounded by a deadline; on expiry the in-flight work is abandoned and the item is re-researched synchronously inline so a single hung agent cannot stall the pipeline.
     2. **Issue-driven re-planning** — `ISSUE_RETRY_MAX` (default `3`; PRD §4.5). When a coder reports an `issue` (a recoverable planning gap), the stale PRP is deleted, the item is reset, and research re-runs with the captured feedback; re-plans are bounded before the item hard-fails.
     3. **`tasks.json` corruption recovery** — no env-var knob (automatic, non-fatal; PRD §5.1). After every agent run the orchestrator re-applies only the legitimate status delta (discarding unauthorized mutations) and restores a corrupted `tasks.json` from git history.
   - End with a short "For details, see …" sentence/link line pointing to the three Mode A docs.
4. **LINK, do not DUPLICATE.** Do NOT copy the CONFIGURATION.md table rows, the WORKFLOWS.md re-planning flow steps, or the ARCHITECTURE.md recovery narrative into the README. Summarize in ≤1 line per mechanism and link. The README env-var table (`### Environment Variables`) must NOT gain `RESEARCH_TIMEOUT`/`ISSUE_RETRY_MAX` rows — that would duplicate `docs/CONFIGURATION.md#resilience-tuning` and create a staleness vector.
5. **Non-stale.** State only what is implemented (the three mechanisms above). Do **not** mention a `Ready` status (it does not exist — readiness is internal to the research queue). Do **not** promise behaviors that are not built.
6. **Heading uniqueness (markdownlint MD024 siblings_only).** `## Self-Healing & Resilience` must be unique among `##` siblings. Verified: no existing `Self-Healing`/`Resilience` heading in README. (README is not in the `docs:lint` glob, but follow the rule for quality.)
7. **Prettier compliance (the binding gate).** `.prettierrc` has no `proseWrap` → defaults to **`preserve`** (prose is NOT rewrapped, so long lines are fine). Markdown **tables** ARE reformatted by prettier — so the blurb uses **prose + bullets only (NO table)** to keep `format:check` green with zero risk. After editing, run `npm run format` (writes) then verify `npm run format:check`.
8. **Do NOT touch**: any `docs/*.md` (Mode A — done; S2 owns reconciliation), `PRD.md`, `tasks.json`, `.gitignore`, the two mermaid `flowchart LR` diagrams in README, `.markdownlint.json`, `.prettierrc`, any `src/`/`tests/` file.

### Success Criteria

- [ ] `## Self-Healing & Resilience` section added after `## Features`, before `## Usage Examples`.
- [ ] One new bullet added to the `## Features` list.
- [ ] All **three** mechanisms named with correct env-var knobs + defaults (`RESEARCH_TIMEOUT`=300s, `ISSUE_RETRY_MAX`=3, tasks.json recovery = automatic/no knob).
- [ ] Each mechanism links (or the section links) to its Mode A doc; no Mode A content is duplicated into README.
- [ ] No `RESEARCH_TIMEOUT`/`ISSUE_RETRY_MAX` rows added to the README `### Environment Variables` table.
- [ ] No mention of a non-existent `Ready` status; nothing stated that is not implemented.
- [ ] `npm run docs:lint` green (exit 0).
- [ ] `npm run format:check` green (README prettier-compliant).
- [ ] `git diff --stat` shows ONLY `README.md`.

## All Needed Context

### Context Completeness Check

_Pass_: An agent with zero codebase knowledge can implement this from (a) the exact insertion points (after `## Features` bullets / before `## Usage Examples`), (b) the ready-to-paste markdown block in "Implementation Blueprint", (c) the verified doc anchors + env-var defaults, and (d) the verified validation commands (`npm run docs:lint`, `npm run format:check`). Every link target and every claim resolves to a real, implemented feature today.

### Documentation & References

```yaml
# MUST READ — the file being edited (the ONLY deliverable)
- file: README.md
  why: |
    The README to edit. Key anchors:
      ## Features          (≈ L108) — bullet list of capabilities → ADD one bullet here.
      ## Usage Examples    (≈ L120) — the section AFTER which the new blurb must NOT go (insert BEFORE it).
      ## Configuration > ### Environment Variables (≈ L205) — DO NOT add rows here (duplicates CONFIGURATION.md).
      ## Architecture Overview (≈ L390) — has Core Components; the blurb links OUT to docs/, not into this section.
    Two mermaid flowchart LR diagrams exist (≈ L14 and L392) — DO NOT touch.
  section: "## Features, ## Usage Examples, ### Environment Variables"

# MUST READ — Mode A docs to LINK to (verified headings + anchors)
- file: docs/CONFIGURATION.md
  why: |
    §"Resilience Tuning" (≈ L127) — the env-var knob table the blurb links to:
      | RESEARCH_TIMEOUT | No | 300 | … §4.2 |
      | ISSUE_RETRY_MAX  | No | 3   | … §4.5 |
    Anchor: #resilience-tuning. The blurb names the knobs inline AND links here (does NOT copy the table).
  section: "### Resilience Tuning (L127-134)"

- file: docs/WORKFLOWS.md
  why: |
    §"Issue-Driven Re-planning" (≈ L377) — the R2 deep dive (5-step flow, ISSUE_RETRY_MAX bounding,
    dependency/identity preservation, retry-dimension distinction). The blurb links here for mechanism #2.
    Anchor: #issue-driven-re-planning.
  section: "### Issue-Driven Re-planning (L377-425)"

- file: docs/ARCHITECTURE.md
  why: |
    §"tasks.json Protection & Smart Recovery" (≈ L700) — the R4 narrative (re-apply legitimate delta,
    git-history restore, preserve Researching/Retrying, non-fatal, no Ready status). The blurb links here
    for mechanism #3. Anchor: #tasksjson-protection--smart-recovery (lowercase, strip '.'/'&', spaces→hyphens).
  section: "### tasks.json Protection & Smart Recovery (L700-720)"

# MUST READ — the source-of-truth facts (env-var names + defaults + PRD refs)
- file: src/config/constants.ts
  why: |
    Confirms the canonical names + defaults (so the blurb is non-stale/accurate):
      RESEARCH_TIMEOUT = 'RESEARCH_TIMEOUT' ; DEFAULT_RESEARCH_TIMEOUT_SECONDS = 300 ; getResearchTimeoutSeconds()
      ISSUE_RETRY_MAX  = 'ISSUE_RETRY_MAX'  ; DEFAULT_ISSUE_RETRY_MAX = 3            ; getIssueRetryMax()
  section: "RESEARCH_TIMEOUT (L165), ISSUE_RETRY_MAX (L222)"

# MUST READ — the contract that defines this Mode B task
- file: plan/005_d32a2ecf61cd/delta_prd.md
  why: |
    §3 "Sync Changeset-Level Documentation (Mode B)" — the exact requirement: README gets a
    "Self-healing / resilience" blurb covering research deadline, issue re-planning, tasks.json recovery.
    Confirms this is a single final task depending on all implementing subtasks.
  section: "§3 (L111-123)"

# REFERENCE — what the parallel sibling S3 produces (R4 wiring) — confirms R4 is real/safe to document
- file: plan/005_d32a2ecf61cd/P5M2T1S3/PRP.md
  why: |
    The R4 wiring CONTRACT (in parallel): wires recoverTasksJson into the orchestrator after every agent run,
    non-fatal, reload from recovered disk. Confirms the tasks.json-recovery mechanism (blurb mechanism #3) is
    implemented and safe to state as a feature.
  section: "Goal, What (call site + non-fatal invariant)"

# REFERENCE — lint/format configuration that governs the validation gates
- file: .markdownlint.json
  why: |
    { default: true, MD013: false, MD024: { siblings_only: true }, MD036: false }. README is NOT in the
    docs:lint glob (docs/**/*.md), so these rules aren't enforced on README — but MD024 siblings_only is
    followed anyway (heading uniqueness) for quality.
- file: .prettierrc
  why: |
    No proseWrap → preserve (prose not rewrapped; tables ARE aligned). The blurb uses prose + bullets
    (NO table) to keep format:check green with zero risk.
- file: package.json
  why: |
    Confirms the exact gate scripts:
      docs:lint    = markdownlint "docs/**/*.md"   (does NOT cover root README.md)
      format:check = prettier --check "**/*.{ts,js,json,md,yml,yaml}"  (DOES cover README.md)
      format       = prettier --write "…"          (use to auto-align after edit)
  section: "scripts.docs:lint, scripts.format:check, scripts.format"
```

### Current Codebase tree (relevant slice)

```bash
. (project root)
├── README.md                 # MODIFY (the ONLY change) — add Features bullet + ## Self-Healing & Resilience section
├── PRD.md                    # READ-ONLY (never touch)
├── docs/
│   ├── CONFIGURATION.md      # LINK TARGET (#resilience-tuning) — DO NOT edit (Mode A done)
│   ├── WORKFLOWS.md          # LINK TARGET (#issue-driven-re-planning) — DO NOT edit (S2 owns reconciliation)
│   └── ARCHITECTURE.md       # LINK TARGET (#tasksjson-protection--smart-recovery) — DO NOT edit (S2 owns)
├── .markdownlint.json        # governs docs:lint (README not in glob) — DO NOT edit
├── .prettierrc               # governs format:check (README IS covered) — DO NOT edit
└── package.json              # gate scripts (docs:lint, format:check, format) — DO NOT edit
```

### Desired Codebase tree with files to be modified

```bash
. (project root)
└── README.md                 # MODIFIED — +1 Features bullet, +## Self-Healing & Resilience section
```

> **File-placement decision**: pure documentation, single file. No new modules, no code, no tests, no other docs. The sibling S2 (P5.M3.T1.S2) separately reconciles `docs/WORKFLOWS.md` + `docs/ARCHITECTURE.md`; S1 must not touch those.

### Known Gotchas of our codebase & Library Quirks

```markdown
<!-- CRITICAL: `npm run docs:lint` = `markdownlint "docs/**/*.md"` does NOT match root README.md. So the ONLY gate
     that actually checks the README edit is `npm run format:check` (prettier, which covers "**/*.md"). docs:lint
     stays green automatically AS LONG AS you do not touch any docs/*.md. Do not be fooled into thinking docs:lint
     validates the README — it does not. -->

<!-- CRITICAL: prettier has NO `proseWrap` set → defaults to `preserve`. Prose paragraphs are NOT rewrapped, so long
     lines pass `format:check`. BUT markdown TABLES are reformatted (pipe/column alignment). DECISION: the blurb uses
     prose + bullets ONLY (no table) → format:check stays green with zero risk. If you add a table, run `npm run format`
     to align it before re-checking. -->

<!-- CRITICAL: Do NOT add RESEARCH_TIMEOUT / ISSUE_RETRY_MAX rows to the README `### Environment Variables` table. That
     duplicates docs/CONFIGURATION.md#resilience-tuning and creates a two-place staleness vector. Name the knobs INLINE
     in the blurb's bullets and LINK to CONFIGURATION.md. (Contract: "link instead of duplicate".) -->

<!-- GOTCHA: markdownlint MD024 siblings_only is ON. The new heading `## Self-Healing & Resilience` must be unique among
     `##` siblings. Verified unique (no existing Self-Healing/Resilience heading). Do not reuse an existing heading text. -->

<!-- GOTCHA: Do NOT mention a `Ready` status. It does not exist — readiness is tracked internally by the research queue.
     (ARCHITECTURE.md explicitly notes "There is no Ready status".) Stating otherwise would be stale/incorrect. -->

<!-- GOTCHA: Anchor for the ARCHITECTURE.md section is ugly: "tasks.json Protection & Smart Recovery" →
     `#tasksjson-protection--smart-recovery` (lowercase; strip '.' and '&'; spaces→hyphens; the stripped '&' leaves a
     double hyphen). Use it verbatim. The CONFIGURATION.md (#resilience-tuning) and WORKFLOWS.md (#issue-driven-re-planning)
     anchors are clean. -->

<!-- GOTCHA: Relative link paths from root README.md to docs/ are simply `docs/CONFIGURATION.md#resilience-tuning` etc.
     (no leading slash). Match the existing README link style, e.g. `[PROMPTS.md](PROMPTS.md)` and
     `[Architecture Documentation](docs/architecture.md)`. -->

<!-- GOTCHA: Keep the blurb NON-STALE — state ONLY the three implemented mechanisms. Do not invent future features,
     do not restate the full re-planning flow (that's WORKFLOWS.md's job), and do not copy the recovery code sample
     (that's ARCHITECTURE.md's job). ≤1 line per mechanism + a link. -->

<!-- GOTCHA: There are TWO identical mermaid flowchart LR diagrams in the README (≈ L14 and L392). The contract does NOT
     ask to annotate them with resilience. Leave them untouched — editing them adds staleness risk and is out of scope. -->
```

## Implementation Blueprint

### Data models and structure

None — documentation only. No types, no code.

### Implementation Patterns & Key Details

```markdown
<!-- ============================================================ -->
<!-- EDIT 1 of 2: add ONE bullet to the `## Features` list        -->
<!-- ============================================================ -->
<!-- FIND the `## Features` bullet list (≈ L110-118). It currently ends with:           -->
<!--   - **Performance Optimizations**: PRP caching, I/O batching, and parallel research -->
<!-- ADD this bullet as the new last item (keep the bold-lead-in + short-desc voice):    -->

- **Self-Healing & Resilience**: Research deadlines with fallback, issue-driven re-planning,
  and automatic `tasks.json` recovery (see [Self-Healing & Resilience](#self-healing--resilience))


<!-- ============================================================ -->
<!-- EDIT 2 of 2: add the new section AFTER the Features list,    -->
<!--              BEFORE `## Usage Examples`                       -->
<!-- ============================================================ -->
<!-- FIND the line `## Usage Examples` (≈ L120). INSERT the block below on a blank line -->
<!-- immediately BEFORE it (i.e., after the last Features bullet + one blank line).      -->

## Self-Healing & Resilience

The pipeline recovers from common agent failures without human intervention. Three mechanisms
keep a session running:

- **Research deadline & synchronous fallback** — background research is bounded by
  `RESEARCH_TIMEOUT` (default `300`s; PRD §4.2). If the deadline elapses, the in-flight research
  is abandoned and the item is re-researched synchronously inline, so a single hung agent cannot
  stall the pipeline.
- **Issue-driven re-planning** — when a coder reports an `issue` (a recoverable planning gap),
  the stale PRP is deleted, the item is reset, and research re-runs with the captured feedback.
  Re-plans are bounded by `ISSUE_RETRY_MAX` (default `3`; PRD §4.5) before the item hard-fails.
- **`tasks.json` corruption recovery** — after every agent run the orchestrator re-applies only
  the legitimate status delta (discarding unauthorized mutations) and restores a corrupted
  `tasks.json` from git history. This is automatic and non-fatal (PRD §5.1).

For details, see [Resilience Tuning](docs/CONFIGURATION.md#resilience-tuning) (env-var knobs),
[Issue-Driven Re-planning](docs/WORKFLOWS.md#issue-driven-re-planning) (re-planning flow), and
[tasks.json Protection & Smart Recovery](docs/ARCHITECTURE.md#tasksjson-protection--smart-recovery)
(recovery internals).
```

> **Why this exact shape:** prose + bullets (no table) → prettier `proseWrap: preserve` will not reformat it, so `format:check` stays green with zero alignment risk. Each mechanism is one bullet (≤4 lines) — a summary, not a duplicate. The trailing link line routes to the three Mode A docs. The `#self-healing--resilience` anchor in the Features bullet matches the new `## Self-Healing & Resilience` heading (GitHub anchor algorithm: lowercase, strip `&`, spaces→hyphens → `self-healing--resilience`).

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT README.md — add the Features bullet + the new Self-Healing & Resilience section
  Step 1a — README.md `## Features` list: add ONE bullet (verbatim from "EDIT 1 of 2" above) as the
            new last item, after the "Performance Optimizations" bullet.
  Step 1b — README.md: INSERT the `## Self-Healing & Resilience` block (verbatim from "EDIT 2 of 2")
            on a blank line immediately BEFORE `## Usage Examples`.
  Step 1c — GOTCHA checks before validating:
    - New heading is `## Self-Healing & Resilience` (unique among ## siblings — no MD024 conflict).
    - Section sits between `## Features` (its bullets) and `## Usage Examples` — NOT inside another section.
    - Three mechanisms present with correct knobs: RESEARCH_TIMEOUT=300s, ISSUE_RETRY_MAX=3, tasks.json=no knob.
    - NO rows added to the README `### Environment Variables` table.
    - NO mention of a `Ready` status. NO edits to docs/*.md, PRD.md, the mermaid diagrams, or any code/config.
    - Links use relative paths without leading slash (docs/CONFIGURATION.md#resilience-tuning, etc.).
  DO NOT touch: docs/*.md, PRD.md, tasks.json, .gitignore, .markdownlint.json, .prettierrc, package.json,
    src/, tests/, the mermaid diagrams.

Task 2: FORMAT + VERIFY (validation gates — run after Task 1)
  - RUN: `npm run format` (prettier --write — auto-aligns any markdown; safe because blurb is prose-only).
  - RUN: `npm run format:check` — expect "All matched files use Prettier code style!" (zero errors).
      If it fails on README.md, inspect the diff: the only likely cause is an accidental table or
      inconsistent list indentation. Re-run `npm run format` then re-check.
  - RUN: `npm run docs:lint` — expect exit 0 (README is NOT in its glob; this just confirms no docs/*.md
      was accidentally touched).
  - SCOPE-VERIFY: `git diff --stat` shows ONLY README.md.
      `git diff --name-only` must list exactly `README.md`.
  - CONTENT-VERIFY:
      grep -n "Self-Healing & Resilience\|RESEARCH_TIMEOUT\|ISSUE_RETRY_MAX\|tasks.json corruption recovery" README.md
      → expect ≥4 matches (the heading + the three mechanism knobs/phrases).
      grep -n "Ready status\|Ready\b" README.md → expect NO new mentions of a Ready status in the blurb.
  - LINK-VERIFY (anchors exist in the target files):
      grep -n "^### Resilience Tuning" docs/CONFIGURATION.md   → 1 match (anchor #resilience-tuning valid)
      grep -n "^### Issue-Driven Re-planning" docs/WORKFLOWS.md → 1 match (anchor #issue-driven-re-planning valid)
      grep -n "^### tasks.json Protection & Smart Recovery" docs/ARCHITECTURE.md → 1 match (anchor valid)
```

### Integration Points

```yaml
SOURCE (the change):
  - modify: README.md
      + one bullet in the `## Features` list (surfaces the capability; links into the new section)
      + new `## Self-Healing & Resilience` section between `## Features` and `## Usage Examples`
        (three mechanism bullets + env-var knobs + trailing link line to Mode A docs)

NOT TOUCHED (scope guardrails):
  - docs/CONFIGURATION.md        # Mode A (done) — LINK TARGET only (#resilience-tuning)
  - docs/WORKFLOWS.md            # Mode A (done); S2 (P5.M3.T1.S2) owns reconciliation — LINK TARGET only
  - docs/ARCHITECTURE.md         # Mode A (done); S2 owns reconciliation — LINK TARGET only
  - PRD.md                       # human-owned, READ-ONLY
  - tasks.json / prd_snapshot.md / delta_prd.md   # pipeline state, never touch
  - .gitignore                   # never touch
  - .markdownlint.json / .prettierrc / package.json   # config — never touch
  - src/**, tests/**             # no code change (documentation only)
  - the two mermaid flowchart LR diagrams in README   # not requested; staleness risk

PRODUCES (the contract this satisfies — closes Mode B for README):
  - README now surfaces the three implemented resilience mechanisms (research deadline+fallback,
    issue re-planning, tasks.json recovery) with their env-var knobs, linking to the detailed Mode A
    docs instead of duplicating them. Mode B README obligation (delta_prd.md §3) is met.

CONSUMES (facts stated in the blurb — all verified implemented):
  - RESEARCH_TIMEOUT (default 300s) + synchronous fallback   # R1 — src/config/constants.ts, PRD §4.2
  - ISSUE_RETRY_MAX (default 3) + issue-driven re-planning   # R2 — src/config/constants.ts, PRD §4.5
  - tasks.json git-history smart recovery (automatic, non-fatal)  # R4 — ARCHITECTURE.md §700, PRD §5.1
```

## Validation Loop

### Level 1: Formatting & Style (Immediate Feedback — the binding gate)

```bash
# After Task 1 (edit):
npm run format
# = prettier --write "**/*.{ts,js,json,md,yml,yaml}"
# Auto-formats README.md. The blurb is prose + bullets (no table) → prettier leaves it essentially unchanged.
# Expected: README.md listed as (already) compliant or reformatted trivially; zero errors.

npm run format:check
# = prettier --check "**/*.{ts,js,json,md,yml,yaml}"
# Expected: "All matched files use Prettier code style!" — zero errors.
# If it fails on README.md: inspect `git diff README.md`; the only likely cause is an accidental table or
# inconsistent list indentation. Re-run `npm run format`, then re-check.

npm run docs:lint
# = markdownlint "docs/**/*.md"
# Expected: exit 0. NOTE: this does NOT lint README.md (glob is docs/** only); it only confirms no docs/*.md
# was accidentally touched. (README is not subject to markdownlint, but the blurb follows MD024 siblings_only anyway.)
```

### Level 2: Content & Scope Validation

```bash
# Scope: exactly one file changed.
git diff --stat
# Expected: ONLY README.md.
git diff --name-only
# Expected: README.md (and nothing else).

# Content: the three mechanisms + knobs are present.
grep -n "Self-Healing & Resilience\|RESEARCH_TIMEOUT\|ISSUE_RETRY_MAX\|tasks.json corruption recovery" README.md
# Expected: ≥4 matches (heading + the two knobs + the tasks.json phrase).

# Non-stale: no invented `Ready` status.
grep -n "Ready" README.md
# Expected: no new `Ready` mention introduced by the blurb (the word may appear elsewhere; verify the blurb
# bullets do not reference a Ready status).

# No env-var-table duplication: RESEARCH_TIMEOUT / ISSUE_RETRY_MAX must NOT appear as table rows under
# `### Environment Variables` (only as inline prose in the new section).
awk '/^### Environment Variables/{flag=1} /^### / && !/Environment Variables/{flag=0} flag' README.md | grep -n "RESEARCH_TIMEOUT\|ISSUE_RETRY_MAX" || echo "OK: no resilience rows in the env-var table"
# Expected: "OK: no resilience rows in the env-var table".
```

### Level 3: Link Integrity (anchors resolve)

```bash
# Each linked anchor must exist as a real heading in its target file.
grep -n "^### Resilience Tuning" docs/CONFIGURATION.md
# Expected: 1 match → README link docs/CONFIGURATION.md#resilience-tuning is valid.

grep -n "^### Issue-Driven Re-planning" docs/WORKFLOWS.md
# Expected: 1 match → README link docs/WORKFLOWS.md#issue-driven-re-planning is valid.

grep -n "^### tasks.json Protection & Smart Recovery" docs/ARCHITECTURE.md
# Expected: 1 match → README link docs/ARCHITECTURE.md#tasksjson-protection--smart-recovery is valid.
```

### Level 4: Render / Readability (Manual)

```bash
# Optional: preview the rendered README to confirm the section reads well and links resolve in a viewer.
# (No CLI render step in this repo; a visual skim of the markdown source suffices for Level 4 here.)
# Confirm:
#   - The Features bullet links to #self-healing--resilience and jumps to the new section.
#   - The three mechanism bullets are parallel in structure (bold lead-in + knob + one-line description).
#   - The trailing "For details, see …" line lists all three Mode A docs.
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run format:check` green (README is prettier-compliant — the binding gate).
- [ ] `npm run docs:lint` green (exit 0 — confirms no `docs/*.md` touched).
- [ ] `git diff --stat` shows ONLY `README.md`.

### Feature Validation

- [ ] `## Self-Healing & Resilience` section added between `## Features` and `## Usage Examples`.
- [ ] One new bullet added to the `## Features` list.
- [ ] All three mechanisms named with correct env-var knobs + defaults (`RESEARCH_TIMEOUT`=300s, `ISSUE_RETRY_MAX`=3, tasks.json recovery = automatic/no knob).
- [ ] Each Mode A doc is linked (CONFIGURATION.md#resilience-tuning, WORKFLOWS.md#issue-driven-re-planning, ARCHITECTURE.md#tasksjson-protection--smart-recovery); anchors verified to exist.
- [ ] No Mode A content duplicated into README (no copied table rows, no re-planning flow steps, no recovery code sample).
- [ ] No `RESEARCH_TIMEOUT`/`ISSUE_RETRY_MAX` rows added to the README `### Environment Variables` table.
- [ ] Non-stale: no mention of a non-existent `Ready` status; nothing stated that is not implemented.

### Code Quality Validation

- [ ] Follows existing README voice/format (bold lead-in bullets; relative links without leading slash).
- [ ] Heading unique (no markdownlint MD024 sibling conflict).
- [ ] Anti-patterns avoided (see below).
- [ ] No unintended edits to `docs/`, `PRD.md`, `tasks.json`, `.gitignore`, config files, code, or mermaid diagrams.

### Documentation & Deployment

- [ ] The blurb is self-contained and accurate (a reader can understand the three mechanisms in 30 seconds).
- [ ] Links route readers to the detailed Mode A docs for depth.

---

## Anti-Patterns to Avoid

- ❌ Don't duplicate Mode A docs into the README — link to them (CONFIGURATION.md rows, WORKFLOWS.md flow, ARCHITECTURE.md narrative).
- ❌ Don't add `RESEARCH_TIMEOUT`/`ISSUE_RETRY_MAX` rows to the README env-var table — that duplicates `docs/CONFIGURATION.md#resilience-tuning` and creates staleness.
- ❌ Don't use a markdown table in the blurb (prettier will re-align it; risk to `format:check`). Use prose + bullets.
- ❌ Don't mention a `Ready` status — it does not exist.
- ❌ Don't state anything not implemented (no future/imagined features).
- ❌ Don't touch the mermaid diagrams, `docs/*.md`, `PRD.md`, `tasks.json`, `.gitignore`, or any config/code — README.md is the only change.
- ❌ Don't assume `npm run docs:lint` validates README — it does not (glob is `docs/**`). The real gate on the README is `npm run format:check`.
- ❌ Don't skip `npm run format` before `format:check` if you introduced any table/list indentation manually.
