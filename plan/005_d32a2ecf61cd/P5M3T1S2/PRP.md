# PRP — P5.M3.T1.S2: Reconcile WORKFLOWS.md + ARCHITECTURE.md into a coherent resilience narrative

## Goal

**Feature Goal**: Implement the **Mode B documentation reconciliation** (PRD §6.1 two-mode rule; delta_prd.md §3) for the two deep-dive docs. R1/R2/R4 already landed their **Mode A** per-item additions — R1 in code (no doc), R2.S4 added `### Issue-Driven Re-planning` to `docs/WORKFLOWS.md`, and R4.S2 added `### tasks.json Protection & Smart Recovery` to `docs/ARCHITECTURE.md`. This subtask makes the cross-cutting **resilience narrative coherent end-to-end** with three small, link-based edits: (a) the WORKFLOWS.md execution-loop narrative (Phase 4) gains the **R1 research-deadline + synchronous-fallback** mention and a **cross-reference to the R2 re-planning** subsection; (b) a short new **`## Pipeline Resilience`** overview in WORKFLOWS.md ties research-deadline + issue-re-planning + tasks.json-recovery together and **links to the ARCHITECTURE.md state-management** narrative; (c) the ARCHITECTURE.md state-management overview intro gains a **forward-link to the R4 smart-recovery** subsection so it is discoverable. No per-item detail is restated — everything links out.

**Deliverable**: **TWO files modified**, `git diff --name-only` lists exactly `docs/ARCHITECTURE.md` and `docs/WORKFLOWS.md`:
1. **`docs/WORKFLOWS.md`** —
   - **Edit A** (Phase 4): append a `**Resilience During Execution:**` note (prose + 2 bullets) right after the Phase 4 Graceful-Shutdown code block, mentioning `RESEARCH_TIMEOUT` + synchronous fallback (R1) and cross-referencing [Issue-Driven Re-planning](#issue-driven-re-planning) (R2).
   - **Edit B** (new overview): add a short `## Pipeline Resilience` section (intro + 3 bullets + knob link line) immediately **after `## Overview`** and **before `## Workflow Architecture`**, tying the three mechanisms together and linking out to Phase 4, Issue-Driven Re-planning, and `./ARCHITECTURE.md#tasksjson-protection--smart-recovery`.
   - **Edit C** (TOC, non-stale): add the `- [Pipeline Resilience](#pipeline-resilience)` entry to the hand-maintained `## Table of Contents` (after the Overview entry), and add `- [Issue-Driven Re-planning](#issue-driven-re-planning)` under the PRPPipeline block (after Phase 4) — the R2 author omitted it; restoring it serves the "discoverable/coherent" goal.
2. **`docs/ARCHITECTURE.md`** —
   - **Edit D** (discoverability): append one sentence to the `## State Management and Persistence` intro paragraph that forward-links to [tasks.json Protection & Smart Recovery](#tasksjson-protection--smart-recovery).

No code, no tests, no other docs (incl. README — owned by sibling S1; CONFIGURATION.md — Mode A done), no config touched.

**Success Definition**: `npm run docs:lint` green (exit 0), `npm run format:check` green, `git diff --name-only` lists **only** `docs/ARCHITECTURE.md` + `docs/WORKFLOWS.md`, every new link's anchor resolves to a real heading, and nothing stated that is not implemented (non-stale). The three resilience mechanisms now read as one coherent narrative across the two deep docs, with the README blurb (S1) as the entry point.

## User Persona

**Target User**: A developer/operator reading the deep docs (WORKFLOWS.md / ARCHITECTURE.md) to understand *how* the pipeline stays resilient during the execution loop and across agent failures — deeper than the README blurb (S1).

**Use Case**: A reader opens WORKFLOWS.md, wants the resilience story. Today they must stumble onto `### Issue-Driven Re-planning` (R2) deep under Phase 4, find no mention of the research deadline (R1) in the execution loop, and cross to ARCHITECTURE.md to learn about tasks.json recovery (R4) — with no overview tying them together and no link from the state-management overview to R4. This subtask adds the connective tissue: a `## Pipeline Resilience` overview, an R1+R2 mention in Phase 4, and a state-management → smart-recovery forward-link.

**User Journey**: README blurb (S1) → `docs/WORKFLOWS.md#pipeline-resilience` overview → follow the per-mechanism links into Phase 4 (R1), Issue-Driven Re-planning (R2), and `docs/ARCHITECTURE.md#tasksjson-protection--smart-recovery` (R4).

**Pain Points Addressed**: The execution-loop narrative omits the research deadline (R1) entirely; R2's subsection is not cross-referenced from the loop that produces it; R4's subsection is buried in ARCHITECTURE.md with no link from its parent overview; and there is no single "Pipeline Resilience" frame tying the three together. Docs feel stale relative to shipped code.

## Why

- **Business value**: Closes the **Mode B** doc-sync obligation (delta_prd.md §3) for the two deep docs — the single final reconciliation task that depends on all R1/R2/R4 implementing subtasks (all ✅ Complete). Makes the resilience story navigable instead of fragmentary.
- **Scope boundary**: This subtask owns **`docs/WORKFLOWS.md` + `docs/ARCHITECTURE.md` only**. Sibling **P5.M3.T1.S1** owns `README.md` (the high-level blurb). S2 must NOT touch README.md (would collide with S1), CONFIGURATION.md (Mode A, the env-var table S1/S2 both link to), PRD.md, code, or config. Contract: "Do NOT restate full per-item detail — link."
- **Non-stale contract**: Only state what shipped. R1 `RESEARCH_TIMEOUT` (default 300s) ✅; R2 `ISSUE_RETRY_MAX` (default 3) ✅; R4 tasks.json git-history smart recovery (automatic, non-fatal, no `Ready` status) ✅. All real → safe to document and link.

## What

### User-visible behavior

Three documentation edits render as: a new high-level `## Pipeline Resilience` overview in WORKFLOWS.md; an R1 + R2-cross-ref note closing out the Phase 4 execution-loop narrative; a TOC that lists both new/restored entries; and a one-sentence forward-link in the ARCHITECTURE.md state-management overview that surfaces the smart-recovery subsection. No behavioral/code change.

### Technical requirements (the CONTRACT)

1. **EDIT ONLY `docs/WORKFLOWS.md` AND `docs/ARCHITECTURE.md`.** `git diff --name-only` must list exactly those two files.
2. **Edit A — Phase 4 resilience note (WORKFLOWS.md).** Insert, immediately **after the Phase 4 `**Graceful Shutdown:**` typescript code block** and **before `### Issue-Driven Re-planning`**, the `**Resilience During Execution:**` block (verbatim in Implementation Blueprint). It must:
   - Name `RESEARCH_TIMEOUT` (default `300`s; PRD §4.2) + synchronous fallback (R1) — brief, in-loop framing.
   - Cross-reference the tri-state outcome (`issue`) to [Issue-Driven Re-planning](#issue-driven-re-planning) via a same-doc anchor link — do NOT restate the 5-step flow.
3. **Edit B — `## Pipeline Resilience` overview (WORKFLOWS.md).** Insert, immediately **after the `## Overview` section body and before `## Workflow Architecture`**, a new `## Pipeline Resilience` section (verbatim in Implementation Blueprint). It must:
   - Be **one intro sentence** + **three bullets** (research deadline+fallback, issue-driven re-planning, tasks.json corruption recovery), each ≤ ~2 lines and each **linking out**: bullet 1 → `#phase-4-backlog-execution`, bullet 2 → `#issue-driven-re-planning`, bullet 3 → `./ARCHITECTURE.md#tasksjson-protection--smart-recovery` (cross-doc). End with a one-line pointer to `./CONFIGURATION.md#resilience-tuning` for the knobs.
   - Be a `##` heading **unique among `##` siblings** (markdownlint MD024 `siblings_only` — verified unique; no existing "Pipeline Resilience").
4. **Edit C — TOC entries (WORKFLOWS.md).** In the hand-maintained `## Table of Contents`: (a) add `- [Pipeline Resilience](#pipeline-resilience)` as the 2nd entry, immediately after `- [Overview](#overview)` and before `- [Workflow Architecture](#workflow-architecture)`; (b) add `- [Issue-Driven Re-planning](#issue-driven-re-planning)` under the PRPPipeline block, immediately after `- [Phase 4: Backlog Execution](#phase-4-backlog-execution)` and before `- [Phase 5: QA Cycle](#phase-5-qa-cycle)`. Keep indentation (top-level `- ` / nested `  - `) identical to neighbours.
5. **Edit D — state-management forward-link (ARCHITECTURE.md).** Append **one sentence** to the `## State Management and Persistence` intro paragraph (the line "The PRP Pipeline uses a robust state management system with immutable data structures and atomic persistence.") that forward-links to [tasks.json Protection & Smart Recovery](#tasksjson-protection--smart-recovery). Same-doc anchor link. Do NOT add a new heading; do NOT restate the recovery detail.
6. **LINK, do NOT DUPLICATE.** Do NOT copy the Issue-Driven Re-planning 5-step flow, the retry-dimension table, or the `recoverTasksJson` code sample. Summaries + links only.
7. **Non-stale.** State only what is implemented. Do **not** mention a `Ready` status (it does not exist). Do **not** invent future mechanisms. Env-var defaults: `RESEARCH_TIMEOUT`=300s, `ISSUE_RETRY_MAX`=3.
8. **markdownlint compliance (binding — both files ARE in the `docs:lint` glob).** MD022 (blank lines around headings), MD031 (blank lines around fenced code — N/A, no new code blocks), MD032 (blank lines around lists), MD024 siblings_only (unique heading text per sibling group). MD036 is OFF so `**Bold lead-in:**` prose is fine (Phase 4 already uses it). MD013 OFF → long lines OK.
9. **prettier compliance (binding — both files ARE in the `format:check` glob).** No `proseWrap` set → `preserve` (prose not reflowed). Use prose + bullets + links (NO tables) so prettier leaves the edits untouched. After editing, run `npm run format` (writes) then verify `npm run format:check`.
10. **Do NOT touch**: README.md (S1 owns it), `docs/CONFIGURATION.md` (Mode A done; link target only), any other `docs/*.md`, `PRD.md`, `tasks.json`/`prd_snapshot.md`/`delta_prd.md`, `.gitignore`, `.markdownlint.json`, `.prettierrc`, `package.json`, any `src/`/`tests/` file, existing fenced code blocks/diagrams.

### Success Criteria

- [ ] `### Phase 4: Backlog Execution` narrative now mentions `RESEARCH_TIMEOUT` + synchronous fallback (R1) and links to `#issue-driven-re-planning` (R2).
- [ ] New `## Pipeline Resilience` overview in WORKFLOWS.md ties all three mechanisms and links out (incl. cross-doc to ARCHITECTURE.md).
- [ ] WORKFLOWS.md `## Table of Contents` lists `Pipeline Resilience` (top-level) and `Issue-Driven Re-planning` (under PRPPipeline).
- [ ] ARCHITECTURE.md `## State Management and Persistence` intro forward-links to `#tasksjson-protection--smart-recovery`.
- [ ] No per-item detail restated; no `Ready` status; nothing unimplemented stated.
- [ ] `npm run docs:lint` green (exit 0).
- [ ] `npm run format:check` green.
- [ ] `git diff --name-only` lists ONLY `docs/ARCHITECTURE.md` + `docs/WORKFLOWS.md`.
- [ ] Every new link's anchor resolves to a real heading (verified by grep).

## All Needed Context

### Context Completeness Check

_Pass_: An agent with zero codebase knowledge can implement this from (a) the four exact insertion points (named by their neighbours), (b) the ready-to-paste markdown blocks in "Implementation Blueprint", (c) the verified anchors + non-stale facts, and (d) the verified validation commands. Every link target and every claim resolves to real, shipped content today.

### Documentation & References

```yaml
# MUST EDIT — the two deliverable files
- file: docs/WORKFLOWS.md
  why: |
    Edit A: append `**Resilience During Execution:**` note after the Phase 4 Graceful-Shutdown code block
            (L≈371, the closing ``` of the typescript block) and before `### Issue-Driven Re-planning` (L377).
    Edit B: insert new `## Pipeline Resilience` section between `## Overview` body (ends ≈L87) and
            `## Workflow Architecture` (L88).
    Edit C: add two TOC entries in `## Table of Contents` (L9–66): Pipeline Resilience after Overview (L≈70);
            Issue-Driven Re-planning under PRPPipeline after Phase 4 (L≈33 after the Phase 4 TOC line).
  section: "## Table of Contents (L9), ## Overview (L68), ### Phase 4: Backlog Execution (L334)"

- file: docs/ARCHITECTURE.md
  why: |
    Edit D: append one sentence to the `## State Management and Persistence` intro paragraph (L542–544)
            forward-linking to #tasksjson-protection--smart-recovery (the R4 subsection at L700).
  section: "## State Management and Persistence (L542)"

# MUST READ — the existing Mode A content being reconciled (DO NOT EDIT, only link to)
- file: docs/WORKFLOWS.md
  why: |
    `### Issue-Driven Re-planning` (L377–425) = the R2.S4 deep dive (tri-state table, 5-step flow,
    ISSUE_RETRY_MAX bounding, dependency/identity preservation, retry-dimension table). Link target #issue-driven-re-planning.
    Do NOT restate — only link.
  section: "### Issue-Driven Re-planning (L377-425)"

- file: docs/ARCHITECTURE.md
  why: |
    `### tasks.json Protection & Smart Recovery` (L700–725) = the R4.S2 narrative (re-apply legitimate delta,
    git-history restore, preserve Researching/Retrying, non-fatal, no Ready status, recoverTasksJson sample).
    Link target #tasksjson-protection--smart-recovery (double hyphen: 'tasks.json ... & ...' → strip '.'/'&'
    leaves 'tasksjson-protection--smart-recovery'). Do NOT restate — only link.
  section: "### tasks.json Protection & Smart Recovery (L700-725)"

# MUST READ — link targets the overview cross-references (DO NOT EDIT)
- file: docs/CONFIGURATION.md
  why: "### Resilience Tuning (≈L127) — the env-var knob table (RESEARCH_TIMEOUT=300, ISSUE_RETRY_MAX=3).
        Overview's trailing line links here via ./CONFIGURATION.md#resilience-tuning. Mode A (done) — link only."
  section: "### Resilience Tuning"

# MUST READ — non-stale facts (names + defaults) so the prose is accurate
- file: src/config/constants.ts
  why: |
    Confirms canonical names + defaults: RESEARCH_TIMEOUT='RESEARCH_TIMEOUT', DEFAULT_RESEARCH_TIMEOUT_SECONDS=300;
    ISSUE_RETRY_MAX='ISSUE_RETRY_MAX', DEFAULT_ISSUE_RETRY_MAX=3. (PRD §4.2 / §4.5 / §9.2.2.)
  section: "RESEARCH_TIMEOUT (L165), ISSUE_RETRY_MAX (L222)"

# MUST READ — the contract defining this Mode B task
- file: plan/005_d32a2ecf61cd/delta_prd.md
  why: "§3 'Sync Changeset-Level Documentation (Mode B)' — reconciles R2/R4 per-item subsections into a single
        coherent end-to-end narrative; a 'Pipeline Resilience' overview if warranted. Single final task
        depending on all implementing subtasks."
  section: "§3 (L111-123)"

# REFERENCE — sibling S1 (parallel) owns README.md; this PRP must NOT touch it
- file: plan/005_d32a2ecf61cd/P5M3T1S1/PRP.md
  why: "S1 = the README 'Self-Healing & Resilience' blurb (links INTO docs/). S2 owns the docs/ reconciliation.
        No file overlap: S1 = README.md only; S2 = docs/WORKFLOWS.md + docs/ARCHITECTURE.md only."
  section: "Goal, What (scope)"

# REFERENCE — lint/format config governing the gates
- file: .markdownlint.json
  why: "{ default: true, MD013: false, MD024: { siblings_only: true }, MD036: false }. Both target files ARE
        in the docs:lint glob (docs/**/*.md), so MD022/MD024/MD032 ARE enforced. MD036 OFF ⇒ bold lead-ins OK."
- file: .prettierrc
  why: "No proseWrap ⇒ preserve (prose untouched; tables aligned). Edits use prose + bullets + links (no tables) ⇒ prettier-safe."
- file: package.json
  why: |
    Gate scripts (verified): docs:lint = markdownlint "docs/**/*.md" (covers BOTH files);
    format:check = prettier --check "**/*.{ts,js,json,md,yml,yaml}" (covers BOTH files);
    format = prettier --write "…" (run after edits to normalize, then re-check).
  section: "scripts.docs:lint, scripts.format:check, scripts.format"
```

### Current Codebase tree (relevant slice)

```bash
. (project root)
├── README.md                 # DO NOT TOUCH (sibling S1 owns it)
├── PRD.md                    # READ-ONLY (never touch)
├── docs/
│   ├── WORKFLOWS.md          # MODIFY — Edit A (Phase 4 R1+R2 note), Edit B (## Pipeline Resilience), Edit C (TOC)
│   ├── ARCHITECTURE.md       # MODIFY — Edit D (state-mgmt intro forward-link to smart-recovery)
│   ├── CONFIGURATION.md      # LINK TARGET (#resilience-tuning) — DO NOT EDIT (Mode A done)
│   └── ... (other docs)      # DO NOT TOUCH
├── .markdownlint.json        # governs docs:lint (both files covered) — DO NOT EDIT
├── .prettierrc               # governs format:check (both files covered) — DO NOT EDIT
└── package.json              # gate scripts — DO NOT EDIT
```

### Desired Codebase tree with files to be modified

```bash
docs/
├── WORKFLOWS.md     # MODIFIED — +Phase 4 resilience note, +## Pipeline Resilience overview, +2 TOC entries
└── ARCHITECTURE.md  # MODIFIED — +1 sentence forward-link in State Management intro
```

> **File-placement decision**: pure documentation, two files, four edits. No code, no tests, no other docs. The sibling S1 separately owns README.md; CONFIGURATION.md is a Mode A link target only.

### Known Gotchas of our codebase & Library Quirks

```markdown
<!-- CRITICAL: UNLIKE the README (S1), BOTH docs/WORKFLOWS.md AND docs/ARCHITECTURE.md ARE in the `docs:lint`
     glob (docs/**/*.md) AND the format:check glob. So markdownlint rules ARE enforced here. Respect MD022
     (blank lines around headings), MD032 (blank lines around lists), MD024 siblings_only (unique heading text
     among same-level siblings under the same parent). -->

<!-- CRITICAL: MD024 is `siblings_only`, NOT global. So `## Pipeline Resilience` must differ from other `##`
     headings (verified unique). The existing doc has MULTIPLE `### Overview` (under DeltaAnalysis/BugHunt/FixCycle)
     and MULTIPLE `### State Machine` — those are legal because siblings_only allows repeats at DIFFERENT parents.
     Our new `## Pipeline Resilience` is a new top-level sibling; ensure no other `##`/child shares its text. -->

<!-- CRITICAL: The anchor for the ARCHITECTURE.md smart-recovery section is UGLY: "tasks.json Protection & Smart Recovery"
     → `#tasksjson-protection--smart-recovery` (lowercase; strip '.' and '&'; spaces→hyphens; the stripped '&' leaves a
     DOUBLE hyphen). Use it VERBATIM in every link (same-doc in ARCHITECTURE.md, cross-doc `./ARCHITECTURE.md#…` in
     WORKFLOWS.md). The Issue-Driven Re-planning anchor is clean: `#issue-driven-re-planning`. -->

<!-- CRITICAL: Cross-doc link convention in docs/ uses the `./` prefix (see WORKFLOWS.md See Also L1501-1507:
     `./CONFIGURATION.md`, `./user-guide.md#2-…`). From WORKFLOWS.md → ARCHITECTURE.md smart-recovery use
     `[...](./ARCHITECTURE.md#tasksjson-protection--smart-recovery)`. Same-doc links omit the file name (`#anchor`). -->

<!-- CRITICAL: Do NOT restate per-item detail. The Issue-Driven Re-planning 5-step flow, the retry-dimension table,
     and the recoverTasksJson code sample already exist — LINK to them. The overview is ≤1 line/mechanism + links;
     Phase 4 R1 is a brief in-loop mention; R2 is a cross-reference link only. -->

<!-- GOTCHA: Do NOT mention a `Ready` status — it does not exist (readiness is internal to the research queue;
     ARCHITECTURE.md L713 explicitly notes "There is no Ready status"). Stating otherwise is stale/incorrect. -->

<!-- GOTCHA: prettier has NO proseWrap ⇒ preserve. Prose/bullets/links are NOT reformatted; markdown TABLES ARE
     aligned. DECISION: edits use prose + bullets + links ONLY (no tables) ⇒ format:check stays green with zero
     risk. If you accidentally add a table, run `npm run format` to align it before re-checking. -->

<!-- GOTCHA: The WORKFLOWS.md `## Table of Contents` is hand-maintained (NOT auto-generated) and lists every `##`
     section + most `###` under PRPPipeline. A new `##` section MUST get a TOC entry or the TOC is stale. The R2
     author omitted `Issue-Driven Re-planning` from the TOC — restoring it is in-scope ("discoverable/coherent"). -->

<!-- GOTCHA: MD036 is OFF, so `**Resilience During Execution:**` bold lead-in prose is NOT flagged as a heading.
     This matches the existing Phase 4 style (`**Duration:**`, `**Purpose:**`, `**Graceful Shutdown:**`). Use the
     same style; do NOT promote it to a `###`/`####` heading (would risk MD024 + reorder the Issue-Driven sibling). -->

<!-- GOTCHA: Place the new `## Pipeline Resilience` overview AFTER `## Overview` and BEFORE `## Workflow Architecture`.
     Forward-references (linking to Phase 4 / Issue-Driven Re-planning which appear later) are fine in docs — the
     overview sets the mental model, the details follow. Do NOT place it inside the PRPPipeline lifecycle (it is
     cross-cutting, not a phase). -->
```

## Implementation Blueprint

### Data models and structure

None — documentation only. No types, no code.

### Implementation Patterns & Key Details

```markdown
<!-- ====================================================================== -->
<!-- EDIT A (WORKFLOWS.md): Phase 4 resilience note — R1 + R2 cross-ref     -->
<!-- ====================================================================== -->
<!-- FIND the END of the Phase 4 Graceful-Shutdown code block:                          -->
/*   **Graceful Shutdown:**
 *
 *   ```typescript
 *   // Check for shutdown request after each task
 *   if (this.shutdownRequested) {
 *     this.logger.info('Shutdown requested, finishing current task');
 *     this.currentPhase = 'shutdown_interrupted';
 *     break;
 *   }
 *   ```
 */
/* The very next line is `### Issue-Driven Re-planning`. INSERT the block below on a blank line          */
/* BETWEEN the closing ``` and `### Issue-Driven Re-planning`.                                            */

**Resilience During Execution:**

Two mechanisms keep the loop moving when agents misbehave:

- **Research deadline & synchronous fallback** — while executing item _N_, the orchestrator researches item
  _N+1_ in the background, bounded by `RESEARCH_TIMEOUT` (default `300`s; PRD §4.2). If the deadline elapses,
  the in-flight research is abandoned and the item is re-researched synchronously, inline, so a single hung
  agent cannot stall the pipeline.
- **Tri-state outcomes** — each item's execution reports `success`, `fail`, or `issue`. An `issue` (a
  recoverable planning gap, not a code failure) triggers bounded re-research with feedback; see
  [Issue-Driven Re-planning](#issue-driven-re-planning).


<!-- ====================================================================== -->
<!-- EDIT B (WORKFLOWS.md): new ## Pipeline Resilience overview             -->
<!-- ====================================================================== -->
<!-- FIND the END of `## Overview` (its body) and the line `## Workflow Architecture`.   -->
/* INSERT the section below on a blank line BETWEEN them. (## Overview is L68; ## Workflow  */
/* Architecture is L88 — insert around L88.)                                                */

## Pipeline Resilience

The pipeline recovers from common agent failures without human intervention. Three mechanisms — woven into
the execution loop and the state layer — keep a session running:

- **Research deadline & synchronous fallback** — background research for the next item is bounded by
  `RESEARCH_TIMEOUT` (default `300`s; PRD §4.2); on expiry the work is abandoned and re-researched inline.
  See [Phase 4: Backlog Execution](#phase-4-backlog-execution).
- **Issue-driven re-planning** — when a coder reports an `issue` (a recoverable planning gap), the stale PRP
  is deleted and research re-runs with the captured feedback, bounded by `ISSUE_RETRY_MAX` (default `3`;
  PRD §4.5). See [Issue-Driven Re-planning](#issue-driven-re-planning).
- **`tasks.json` corruption recovery** — after every agent run the orchestrator re-applies only the
  legitimate status delta and restores a corrupted `tasks.json` from git history; automatic and non-fatal.
  See [tasks.json Protection & Smart Recovery](./ARCHITECTURE.md#tasksjson-protection--smart-recovery).

For the environment-variable knobs, see [Resilience Tuning](./CONFIGURATION.md#resilience-tuning).


<!-- ====================================================================== -->
<!-- EDIT C (WORKFLOWS.md): TOC entries (hand-maintained)                   -->
<!-- ====================================================================== -->
<!-- C1: in `## Table of Contents`, after `- [Overview](#overview)` add:                  */

- [Pipeline Resilience](#pipeline-resilience)

<!-- (so the order is: Overview, Pipeline Resilience, Workflow Architecture)             */
<!-- C2: under the PRPPipeline block, after `- [Phase 4: Backlog Execution](#phase-4-backlog-execution)` add: */

  - [Issue-Driven Re-planning](#issue-driven-re-planning)

<!-- (2-space indent, matching the nested Phase entries; order: Phase 4, Issue-Driven Re-planning, Phase 5) */


<!-- ====================================================================== -->
<!-- EDIT D (ARCHITECTURE.md): state-management intro forward-link          -->
<!-- ====================================================================== -->
<!-- FIND the intro paragraph under `## State Management and Persistence` (L542-544):     */
/*   "The PRP Pipeline uses a robust state management system with immutable data structures and atomic persistence."  */
/* APPEND (same paragraph) the sentence:                                                  */

 It also self-heals `tasks.json` corruption automatically after every agent run — see
 [tasks.json Protection & Smart Recovery](#tasksjson-protection--smart-recovery).
```

> **Why this shape:** every edit is prose + bullets + links (no tables) → prettier `preserve` leaves them untouched, so `format:check` stays green with zero alignment risk. Every link uses a verified anchor. `**Resilience During Execution:**` mirrors Phase 4's existing bold-lead-in style (MD036 OFF). The overview forward-references Phase 4 / Issue-Driven Re-planning (later in the doc) — acceptable and standard for an overview. The ARCHITECTURE.md edit is a single same-paragraph sentence (no new heading → no MD024 risk, no structural change).

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT docs/WORKFLOWS.md — Phase 4 resilience note (Edit A)
  Step 1 — LOCATE the closing ``` of the `**Graceful Shutdown:**` typescript block (end of ### Phase 4) and the
           immediately-following `### Issue-Driven Re-planning` heading.
  Step 2 — INSERT the `**Resilience During Execution:**` block (verbatim from EDIT A) on a blank line between them.
           Ensure: blank line before `**Resilience During Execution:**`, blank line between the two bullets and
           the surrounding prose, blank line before `### Issue-Driven Re-planning` (MD022/MD032).
  Step 3 — CONTENT checks: `RESEARCH_TIMEOUT` (default 300s) + synchronous fallback present; `[Issue-Driven Re-planning](#issue-driven-re-planning)`
           link present; NO restatement of the 5-step flow; NO `Ready` status.

Task 2: EDIT docs/WORKFLOWS.md — ## Pipeline Resilience overview (Edit B)
  Step 1 — LOCATE the end of `## Overview` body and the `## Workflow Architecture` heading.
  Step 2 — INSERT the `## Pipeline Resilience` section (verbatim from EDIT B) on a blank line between them.
           Ensure: blank line after preceding content, blank line before `## Workflow Architecture` (MD022).
  Step 3 — CONTENT checks: heading is `## Pipeline Resilience` (unique among ## siblings); three bullets each link
           out (→ #phase-4-backlog-execution, → #issue-driven-re-planning, → ./ARCHITECTURE.md#tasksjson-protection--smart-recovery);
           trailing line links to ./CONFIGURATION.md#resilience-tuning; defaults correct (300s / 3); NO `Ready` status.

Task 3: EDIT docs/WORKFLOWS.md — Table of Contents (Edit C)
  Step 3a — After `- [Overview](#overview)` add `- [Pipeline Resilience](#pipeline-resilience)` (top-level `- `).
  Step 3b — Under the PRPPipeline block, after the Phase 4 entry, add `  - [Issue-Driven Re-planning](#issue-driven-re-planning)`
            (2-space nested indent, matching neighbouring Phase entries).
  Step 3c — Verify both anchors match real headings (grep) and indent matches neighbours.

Task 4: EDIT docs/ARCHITECTURE.md — state-management intro forward-link (Edit D)
  Step 1 — LOCATE the `## State Management and Persistence` intro paragraph (the "...atomic persistence." line).
  Step 2 — APPEND the one-sentence forward-link (verbatim from EDIT D) to that same paragraph.
           Ensure: stays a single paragraph (no new heading → no MD024 risk); anchor `#tasksjson-protection--smart-recovery` (double hyphen).

Task 5: FORMAT + VERIFY (validation gates — run after Tasks 1-4)
  - RUN: `npm run format` (prettier --write — normalizes; safe because edits are prose/bullets/links only).
  - RUN: `npm run format:check` — expect "All matched files use Prettier code style!" (zero errors).
  - RUN: `npm run docs:lint` — expect exit 0 (markdownlint on docs/**/*.md; both files covered).
  - SCOPE-VERIFY: `git diff --name-only` lists ONLY `docs/ARCHITECTURE.md` + `docs/WORKFLOWS.md`.
  - ANCHOR-VERIFY (see Validation Loop Level 3): every new link's anchor resolves to a real heading.
  - CONTENT-VERIFY (see Validation Loop Level 2): R1/R2/R4 mentions present; no `Ready` status; TOC entries present.
  DO NOT touch: README.md (S1), docs/CONFIGURATION.md (Mode A), any other docs/*.md, PRD.md, tasks.json,
    .gitignore, .markdownlint.json, .prettierrc, package.json, src/, tests/, existing code blocks/diagrams.
```

### Integration Points

```yaml
SOURCE (the changes):
  - modify: docs/WORKFLOWS.md
      + `**Resilience During Execution:**` note closing ### Phase 4 (R1 mention + R2 cross-ref link)
      + new `## Pipeline Resilience` overview after ## Overview (3 bullets + knob link line)
      + 2 entries in the hand-maintained ## Table of Contents (Pipeline Resilience; Issue-Driven Re-planning)
  - modify: docs/ARCHITECTURE.md
      + 1 sentence appended to the ## State Management and Persistence intro (forward-link to smart-recovery)

NOT TOUCHED (scope guardrails):
  - README.md                     # sibling S1 owns it (the high-level blurb that links INTO these docs)
  - docs/CONFIGURATION.md         # Mode A (done) — LINK TARGET only (#resilience-tuning)
  - any other docs/*.md           # out of scope
  - PRD.md                        # human-owned, READ-ONLY
  - tasks.json / prd_snapshot.md / delta_prd.md   # pipeline state, never touch
  - .gitignore                    # never touch
  - .markdownlint.json / .prettierrc / package.json   # config — never touch
  - src/**, tests/**              # no code change (documentation only)
  - existing fenced code blocks / mermaid diagrams in either doc   # not requested; staleness risk

PRODUCES (the contract this satisfies — closes Mode B for the deep docs):
  - The execution-loop narrative (Phase 4) now states the research-deadline + synchronous-fallback (R1) and
    cross-references the Issue-Driven Re-planning subsection (R2).
  - A single coherent `## Pipeline Resilience` overview ties research-deadline + issue-re-planning +
    tasks.json-recovery together and links to the ARCHITECTURE.md state-management narrative.
  - The ARCHITECTURE.md smart-recovery section (R4) is discoverable from the state-management overview.
  - Mode B docs obligation (delta_prd.md §3) is met; docs are non-stale and accurate to what shipped.

CONSUMES (non-stale facts — all verified shipped):
  - RESEARCH_TIMEOUT (default 300s) + synchronous re-research fallback   # R1 — src/config/constants.ts, PRD §4.2
  - ISSUE_RETRY_MAX (default 3) + issue-driven re-planning               # R2 — WORKFLOWS.md L377, PRD §4.5
  - tasks.json git-history smart recovery (automatic, non-fatal, no Ready status)  # R4 — ARCHITECTURE.md L700, PRD §5.1
```

## Validation Loop

### Level 1: Formatting & Style (Immediate Feedback — the binding gates)

```bash
# After Tasks 1-4 (all edits):
npm run format
# = prettier --write "**/*.{ts,js,json,md,yml,yaml}"
# Auto-formats both docs/*.md. Edits are prose + bullets + links (no tables) → prettier leaves them essentially unchanged.
# Expected: both files listed as compliant or reformatted trivially; zero errors.

npm run format:check
# = prettier --check "**/*.{ts,js,json,md,yml,yaml}"
# Expected: "All matched files use Prettier code style!" — zero errors.
# If it fails on docs/WORKFLOWS.md or docs/ARCHITECTURE.md: inspect `git diff <file>`; the likely cause is an
# accidental table or inconsistent list indentation. Re-run `npm run format`, then re-check.

npm run docs:lint
# = markdownlint "docs/**/*.md"
# Expected: exit 0. BOTH files ARE in this glob, so MD022/MD024/MD032 ARE enforced. Common failures:
#   - MD022/MD032: missing blank line around a heading or list → add blank lines.
#   - MD024 siblings_only: duplicated heading text among siblings → rename or relocate.
#   Fix and re-run until exit 0.
```

### Level 2: Content & Scope Validation

```bash
# Scope: exactly two files changed.
git diff --name-only
# Expected: docs/ARCHITECTURE.md AND docs/WORKFLOWS.md (and nothing else — NOT README.md, NOT CONFIGURATION.md).

# Content (WORKFLOWS.md): R1 + R2 present in Phase 4; overview present; TOC entries present.
grep -n "RESEARCH_TIMEOUT\|synchronous" docs/WORKFLOWS.md          # R1 mention present (Phase 4 + overview)
grep -n "#issue-driven-re-planning" docs/WORKFLOWS.md              # R2 cross-ref link present (≥2: Phase 4 + overview)
grep -n "^## Pipeline Resilience" docs/WORKFLOWS.md                # the new overview heading (exactly 1)
grep -n "Pipeline Resilience\|Issue-Driven Re-planning" docs/WORKFLOWS.md | head   # TOC entries + headings

# Content (ARCHITECTURE.md): state-mgmt intro forward-link present.
grep -n "tasksjson-protection--smart-recovery" docs/ARCHITECTURE.md  # the forward-link + the heading anchor (≥2)

# Non-stale: no invented `Ready` status in the NEW prose.
grep -n "Ready" docs/WORKFLOWS.md docs/ARCHITECTURE.md
# Expected: no NEW `Ready` mention in the added overview/Phase-4-note/intro-sentence
#           (the existing R4 narrative already states "There is no Ready status" — leave that alone).
```

### Level 3: Link & Anchor Integrity (every new link resolves)

```bash
# WORKFLOWS.md same-doc anchors must resolve to real headings.
grep -n "^## Pipeline Resilience" docs/WORKFLOWS.md        # → anchor #pipeline-resilience valid
grep -n "^### Phase 4: Backlog Execution" docs/WORKFLOWS.md # → anchor #phase-4-backlog-execution valid
grep -n "^### Issue-Driven Re-planning" docs/WORKFLOWS.md   # → anchor #issue-driven-re-planning valid

# WORKFLOWS.md cross-doc anchors must resolve to real headings in the target files.
grep -n "^### Resilience Tuning" docs/CONFIGURATION.md      # → ./CONFIGURATION.md#resilience-tuning valid
grep -n "^### tasks.json Protection & Smart Recovery" docs/ARCHITECTURE.md
# → ./ARCHITECTURE.md#tasksjson-protection--smart-recovery valid (double-hyphen anchor)

# ARCHITECTURE.md same-doc anchor must resolve.
grep -n "^### tasks.json Protection & Smart Recovery" docs/ARCHITECTURE.md
# → #tasksjson-protection--smart-recovery valid (the Edit D forward-link target)

# Optional: run the repo's link checker (never fails the gate — `|| true` — but flags broken links).
npm run docs:links 2>&1 | grep -iE "WORKFLOWS.md|ARCHITECTURE.md" | grep -i "link" || echo "no link errors reported for target files"
```

### Level 4: Render / Readability (Manual)

```bash
# Optional: preview the rendered docs (no CLI render step in this repo; a visual skim suffices).
# Confirm:
#   - WORKFLOWS.md: `## Pipeline Resilience` overview reads as one coherent frame; its three bullets each jump
#     to the right place (Phase 4, Issue-Driven Re-planning, ARCHITECTURE.md smart-recovery); the TOC entries
#     navigate correctly.
#   - WORKFLOWS.md: the Phase 4 resilience note flows naturally from Graceful Shutdown into Issue-Driven Re-planning.
#   - ARCHITECTURE.md: the state-management intro sentence links cleanly to the smart-recovery subsection.
#   - End-to-end: README blurb (S1) → WORKFLOWS.md#pipeline-resilience → per-mechanism deep dives forms one story.
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run docs:lint` green (exit 0 — both files ARE in the glob).
- [ ] `npm run format:check` green (both files ARE in the glob).
- [ ] `npm run format` run (to normalize) before the `format:check`.
- [ ] `git diff --name-only` lists ONLY `docs/ARCHITECTURE.md` + `docs/WORKFLOWS.md`.

### Feature Validation

- [ ] Phase 4 narrative mentions `RESEARCH_TIMEOUT` + synchronous fallback (R1) and links to `#issue-driven-re-planning` (R2).
- [ ] `## Pipeline Resilience` overview added between `## Overview` and `## Workflow Architecture`; ties all three mechanisms; each bullet links out (incl. cross-doc to `./ARCHITECTURE.md#tasksjson-protection--smart-recovery`).
- [ ] WORKFLOWS.md `## Table of Contents` lists `Pipeline Resilience` (top-level) and `Issue-Driven Re-planning` (under PRPPipeline).
- [ ] ARCHITECTURE.md `## State Management and Persistence` intro forward-links to `#tasksjson-protection--smart-recovery`.
- [ ] Every new link's anchor resolves to a real heading (Level 3 greps pass).
- [ ] Non-stale: correct defaults (`RESEARCH_TIMEOUT`=300s, `ISSUE_RETRY_MAX`=3); no `Ready` status; nothing unimplemented stated.

### Code Quality Validation

- [ ] Follows each doc's existing voice (bold lead-ins; `./` cross-doc links; hand-maintained TOC style).
- [ ] Headings unique (no markdownlint MD024 sibling conflict); blank lines around headings/lists (MD022/MD032).
- [ ] No tables introduced (prettier-safe); edits are prose + bullets + links.
- [ ] Anti-patterns avoided (see below).
- [ ] No unintended edits to README.md, CONFIGURATION.md, other docs, PRD.md, tasks.json, .gitignore, config, code, or existing code blocks/diagrams.

### Documentation & Deployment

- [ ] The resilience story reads coherently end-to-end across WORKFLOWS.md + ARCHITECTURE.md (with README blurb as entry point).
- [ ] Links route readers to the detailed Mode A content for depth (no duplication).

---

## Anti-Patterns to Avoid

- ❌ Don't restate per-item detail — the Issue-Driven Re-planning 5-step flow, the retry-dimension table, and the `recoverTasksJson` code sample already exist. LINK to them.
- ❌ Don't mention a `Ready` status — it does not exist.
- ❌ Don't state anything not implemented (no future/imagined mechanisms); keep defaults accurate (300s / 3).
- ❌ Don't use markdown tables in the new content (prettier re-aligns them; risk to `format:check`). Use prose + bullets.
- ❌ Don't promote `**Resilience During Execution:**` to a `###`/`####` heading — it would risk MD024 and reorder the Issue-Driven Re-planning sibling. Keep it as bold-lead-in prose (MD036 is OFF).
- ❌ Don't forget the TOC — the `## Pipeline Resilience` section MUST get a TOC entry (hand-maintained TOC lists every `##`); leaving it out makes the doc stale.
- ❌ Don't touch README.md (sibling S1 owns it), `docs/CONFIGURATION.md` (Mode A done; link target only), other `docs/*.md`, `PRD.md`, `tasks.json`, `.gitignore`, config, code, or existing code blocks/diagrams.
- ❌ Don't forget BOTH files are in BOTH gates (`docs:lint` and `format:check`) — unlike the README in S1, markdownlint IS enforced here. Respect MD022/MD024/MD032.
- ❌ Don't mangle the ugly smart-recovery anchor — it is `#tasksjson-protection--smart-recovery` (double hyphen from the stripped `&`). Use it verbatim in all links.
