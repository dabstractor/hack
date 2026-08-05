# PRP — P1.M5.T1.S1: Sweep README.md + docs/ARCHITECTURE.md + docs/WORKFLOWS.md for the changeset delta

> Bugfix 002 · **Mode B documentation sweep (SOW §5).** This is the FINAL task of the corrective
> changeset. Every implementing subtask (BUG-001 renumber-merge, BUG-002 classifier wiring,
> BUG-003 task-prefix commit format, BUG-004 green suite) is **Complete** (P1.M4.T4.S1 is the
> in-flight green-suite verification). Per-file/touched docs were already updated **Mode A** by
> those subtasks (`docs/CONFIGURATION.md` for `PRP_COMMIT_FORMAT`; the corrected JSDocs in
> `prp-pipeline.ts` / `backlog-merger.ts` / `git-commit.ts`). **This subtask updates ONLY the
> cross-cutting overview docs** that summarize the whole delta.

> **Scope:** documentation only. Touch exactly three files: `README.md`, `docs/ARCHITECTURE.md`,
> `docs/WORKFLOWS.md`. **NO `src/`, `tests/`, `docs/CONFIGURATION.md`, `PRD.md`, `tasks.json`.**
> Link to `docs/CONFIGURATION.md` for per-flag detail — do NOT duplicate it.

---

## Goal

**Feature Goal**: Bring the three changeset-level overview docs — `README.md`,
`docs/ARCHITECTURE.md`, `docs/WORKFLOWS.md` — into accurate alignment with the **shipped**
Bugfix-002 delta: (1) delta sessions **preserve ADDED requirements** via renumber-on-collision
merge, (2) **COSMETIC PRD changes are skipped** (absorbed without a delta session) by the
now-wired change classifier, and a DIRTY `delta_prd.md` aborts breakdown, and (3) commit
history **no longer carries `[PRP Auto]`** — subjects use the `<phase>.<milestone>.<task>.<subtask>:`
task-prefix (`PRP_COMMIT_FORMAT`, default `task-prefix`; `plain` opt-out; `Co-Authored-By`
trailer preserved). Do this with **minimal, accurate edits** — no per-flag duplication, no churn
where a doc already matches.

**Deliverable**:
- `README.md` — env-var table gains a curated `PRP_COMMIT_FORMAT` row; the **Delta Session**
  usage subsection reflects COSMETIC-skip + added-requirement survival (renumber-merge).
- `docs/ARCHITECTURE.md` — **PRD Hash-Based Change Detection** reflects the
  COSMETIC/SUBSTANTIVE classifier layer (COSMETIC absorbed, no delta session); **Delta Sessions**
  reflects renumber-on-collision merge; **Two-Phase Commit** notes the task-prefix format +
  absence of `[PRP Auto]`.
- `docs/WORKFLOWS.md` — **Phase 3: Delta Handling** reflects COSMETIC-skip (classifier gate),
  renumber-on-collision merge, and the CLEAN/DIRTY artifact guard around `delta_prd.md`.
- `grep -rn "\[PRP Auto\]" README.md docs/ARCHITECTURE.md docs/WORKFLOWS.md` → **ZERO** hits
  (no stale banner in user-facing docs).

**Success Definition**:
- The three overview docs accurately describe the **three shipped behaviors** (verified facts
  below) — no overclaim, no underclaim.
- No per-flag detail duplicated from `docs/CONFIGURATION.md` (every such mention LINKS to
  `docs/CONFIGURATION.md#resilience-tuning`).
- `[PRP Auto]` appears in NONE of the three files.
- Edits are surgical: a doc section that already matches the shipped behavior is LEFT UNCHANGED.
- Markdown lint passes on the edited files.

## User Persona (if applicable)

**Target User**: A developer/maintainer reading the overview docs to understand how PRD changes,
delta sessions, and git commits behave after the corrective changeset. End users are unaffected
by prose.

**Use Case**: "I just pulled the changeset. I open README / ARCHITECTURE / WORKFLOWS to see how
COSMETIC PRD edits, added requirements, and commit messages now work. The docs must match the
code, not the old behavior."

**Pain Points Addressed**: Overview docs drift behind code (COSMETIC-skip, renumber-merge,
task-prefix) — a reader trusting the prose would be misled.

## Why

- **Closes the documentation half of Bugfix 002.** Mode A updated the per-file/touched docs as
  each subtask shipped; this is the cross-cutting Mode B sweep that only makes sense once the
  whole delta is in place (per `architecture/system_context.md` "Modes A vs B").
- **Accurate overview = trustable system.** The three docs are the primary entry points for the
  delta/change-detection/commit flow; stale prose there misleads every future reader.
- **Corrective, not feature work.** No PRD/feature change; no new behavior. This syncs existing
  docs to already-shipped, PRD-specified behavior (§4.3 delta/classifier, §5.1 commit format).

## What

Three files, surgical edits only (exact anchor lines are in the audit notes under
`research/doc-surface-audit.md`):

| File | Section (mdsel anchor) | Required edit |
|---|---|---|
| `README.md` | `### Environment Variables` (~L320-334) | ADD one curated row: `PRP_COMMIT_FORMAT` — `task-prefix` (DEFAULT) / `plain` opt-out; link `docs/CONFIGURATION.md#resilience-tuning`. Follow existing row density (table is a curated subset, not exhaustive). |
| `README.md` | `### Delta Session (PRD Changes)` (~L205-217) | ADD 1-2 lines: COSMETIC PRD changes are absorbed without a delta session (change classifier, PRD §4.3); added requirements survive architect-ID collisions via renumber-merge (no requirement is dropped). |
| `docs/ARCHITECTURE.md` | `### PRD Hash-Based Change Detection` (~L714-737) | The hash change now passes a COSMETIC/SUBSTANTIVE classifier: SUBSTANTIVE creates a delta session; COSMETIC is absorbed (snapshot refresh) without one. Replace/qualify the stale "Modified PRD → Create delta session" bullet. |
| `docs/ARCHITECTURE.md` | `### Delta Sessions` (~L738-784) | ADD a line: architect items whose fresh-from-`P1` IDs collide with the patched ID space are **renumbered-and-appended** (never dropped) — added requirements survive. (Prose currently references an EARLIER changeset's `hasBacklog`-gate fix; keep that, add the renumber nuance.) |
| `docs/ARCHITECTURE.md` | `### Two-Phase Commit (Per-Item Survival)` (~L838-843) | ADD one line: commit subjects use the `<p>.<m>.<t>.<s>:` task-prefix (`PRP_COMMIT_FORMAT`, default) — no `[PRP Auto]` banner (PRD §5.1); link `docs/CONFIGURATION.md#resilience-tuning`. |
| `docs/WORKFLOWS.md` | `### Phase 3: Delta Handling` (~L314-348) | Entry Conditions: a hash change first passes the change classifier — COSMETIC is absorbed (no delta session). Process step 8: add a clause that architect items colliding with the patched ID space are renumbered-and-appended (never dropped). ADD one bullet: `decomposePRD` classifies `delta_prd.md` (CLEAN/DIRTY); a DIRTY artifact aborts breakdown. |

### Success Criteria

- [ ] README env-var table lists `PRP_COMMIT_FORMAT` (task-prefix default / plain opt-out), linking CONFIGURATION.md.
- [ ] README Delta Session subsection mentions COSMETIC-skip and added-requirement survival (renumber-merge).
- [ ] ARCHITECTURE Change Detection reflects COSMETIC/SUBSTANTIVE classifier (COSMETIC absorbed, no delta session).
- [ ] ARCHITECTURE Delta Sessions reflects renumber-on-collision merge (no added requirement dropped).
- [ ] ARCHITECTURE Two-Phase Commit notes task-prefix format + absence of `[PRP Auto]`.
- [ ] WORKFLOWS Phase 3: Delta Handling reflects COSMETIC-skip + renumber-merge + CLEAN/DIRTY artifact guard.
- [ ] `grep -rn "\[PRP Auto\]" README.md docs/ARCHITECTURE.md docs/WORKFLOWS.md` → 0 hits.
- [ ] No per-flag detail duplicated from CONFIGURATION.md (all such mentions LINK there).
- [ ] Markdown lint passes on all three edited files.

## All Needed Context

### Context Completeness Check

_Pass._ The "codebase" for a Mode B doc sweep IS the three docs + the shipped src. The auditor
read all three docs in full at the relevant anchors and verified each shipped behavior directly
in `src/` (facts below). No prior knowledge of the project beyond this PRP is required to make
the edits: every section anchor, current text, and required change is enumerated in the
"Doc-Surface Audit" (`research/doc-surface-audit.md`) and in the **Implementation Tasks** below.

### Documentation & References

```yaml
# MUST READ — the shipped behavior (docs must match these EXACTLY; do not paraphrase the contract away)
- file: src/utils/git-commit.ts
  why: formatCommitMessage / buildTaskPrefix / parseItemPosition — the task-prefix + no-[PRP Auto] behavior
  pattern: |
    formatCommitMessage(msg, position?):
      strips stray "[PRP Auto]"; task-prefix+position => "<prefix>: <subject>";
      plain/no-position => bare subject; ALWAYS appends Co-Authored-By trailer; NEVER emits [PRP Auto].
    buildTaskPrefix({1,2,1,1}) => "1.2.1.1"; {1,2,1} => "1.2.1" (trailing-level elision).
  critical: The Co-Authored-By trailer is PRESERVED (not removed). Only the [PRP Auto] banner is gone.

- file: src/config/constants.ts
  why: getPrpCommitFormat() — the env-var contract for the README env-var row
  pattern: "getPrpCommitFormat() => 'task-prefix' (DEFAULT) | 'plain'; ANY other/empty value => 'task-prefix'."
  critical: "task-prefix is the DEFAULT; plain is the explicit opt-out. Unknown/empty falls back to task-prefix."

- file: src/workflows/prp-pipeline.ts
  why: initializeSession classifier wiring (COSMETIC->absorb / SUBSTANTIVE->delta) + decomposePRD DIRTY guard
  pattern: |
    if (hasSessionChanged()) { verdict = classifyChangeWithRetry(diffSummary); // default SUBSTANTIVE
      SUBSTANTIVE => handleDelta();  COSMETIC => absorbCosmeticChange(); }
    In decomposePRD: classifyArtifactWithRetry(delta_prd.md) // default DIRTY; DIRTY => abort breakdown.
  critical: COSMETIC is ABSORBED (snapshot refresh) — no delta session is spawned. DIRTY aborts breakdown.

- file: src/core/backlog-merger.ts
  why: renumber-on-collision merge — the "added requirements survive" behavior
  pattern: "append points renumber architect items against the patched ID space on ID collision (was skip/drop)."
  critical: "mergeBacklogs NEVER drops an architect item — it extends (title match) or appends (renumbered)."

# The audit — anchor lines, current text, and required edit for every touched surface
- docfile: plan/008_15504f60a0ef/bugfix/002_86589b7d57d2/P1M5T1S1/research/doc-surface-audit.md
  why: enumerated per-section current-state + required-edit; THE working list for the Implementation Tasks
  section: "Doc surface inventory"

# The architecture notes — ground truth for what shipped (read to keep prose accurate)
- docfile: plan/008_15504f60a0ef/bugfix/002_86589b7d57d2/architecture/bug-001-backlog-merge.md
  why: BUG-001 renumber-merge design (why renumber-on-collision, not pre-pass)
- docfile: plan/008_15504f60a0ef/bugfix/002_86589b7d57d2/architecture/bug-002-classifiers.md
  why: BUG-002 COSMETIC-absorb + DIRTY-guard wiring + protective defaults (SUBSTANTIVE/DIRTY)
- docfile: plan/008_15504f60a0ef/bugfix/002_86589b7d57d2/architecture/bug-003-commit-format.md
  why: BUG-003 task-prefix format + PRP_COMMIT_FORMAT + Co-Authored-By-preserved decision (PRD §5.1)

# Mode A docs ALREADY DONE — LINK to these, DO NOT EDIT, DO NOT DUPLICATE
- docfile: docs/CONFIGURATION.md
  why: PRP_COMMIT_FORMAT (L165) + CLASSIFIER_RETRY_MAX (L164) under "### Resilience Tuning" (L151)
  section: "Resilience Tuning"
  critical: "Anchor for cross-links is #resilience-tuning. All overview-doc mentions of these flags must LINK here."
```

### Current Codebase tree (overview-doc surface only)

```bash
README.md                 # user-facing overview; env-var table (L320-334), Delta Session (L205-217), Self-Healing (L142-175)
docs/ARCHITECTURE.md      # PRD Hash-Based Change Detection (L714), Delta Sessions (L738), Two-Phase Commit (L838)
docs/WORKFLOWS.md         # Phase 3: Delta Handling (L314), Delta Session Flow mermaid (L612)
docs/CONFIGURATION.md     # DO NOT EDIT (Mode A done) — PRP_COMMIT_FORMAT (L165), CLASSIFIER_RETRY_MAX (L164)
```

### Known Gotchas of our codebase & Library Quirks

```python
# CRITICAL: This is a DOC-SWEEP task. The ONLY files you may modify are:
#   README.md, docs/ARCHITECTURE.md, docs/WORKFLOWS.md
# Do NOT touch: src/, tests/, docs/CONFIGURATION.md, PRD.md, **/tasks.json, JSDocs in src/.

# CRITICAL: docs/CONFIGURATION.md already documents PRP_COMMIT_FORMAT + CLASSIFIER_RETRY_MAX (Mode A).
# LINK to docs/CONFIGURATION.md#resilience-tuning — do NOT duplicate the per-flag table rows.

# CRITICAL: ARCHITECTURE.md "Delta Sessions" prose already references an EARLIER changeset
# ("Issue 1/2", hasBacklog-gate fix). That text is accurate for THAT fix — LEAVE it. Only ADD the
# renumber-on-collision nuance from THIS changeset. Do not rewrite the section.

# CRITICAL: README.md L164 ("Self-Healing") already mentions the classifier retry + protective
# default — that is ACCURATE. Do not duplicate. The COSMETIC->absorb/skip-delta behavior is what's
# new; surface it in the Delta Session subsection, not by re-explaining the retry.

# GOTCHA: "cosmetic" appears in docs/WORKFLOWS.md (L814/823/834/861/945/1070) — but that is the
# BugHunt SEVERITY ("cosmetic bug"), NOT the PRD-change classifier. Do NOT conflate them. The
# classifier COSMETIC/SUBSTANTIVE edit goes in Phase 3: Delta Handling, NOT the BugHunt severity tables.

# GOTCHA: Co-Authored-By trailer is PRESERVED (not removed). Only the [PRP Auto] banner is gone.
# Do not write "commits no longer carry a trailer" — that is wrong.
```

## Implementation Blueprint

### Implementation Tasks (ordered by file)

> Read `research/doc-surface-audit.md` once before starting — it has the exact anchor lines and
> current text for every surface below. Use `edit` (exact oldText → newText); verify each edit
> against the verified facts in the audit. **If a section already matches the shipped behavior,
> leave it unchanged** (no churn).

```yaml
Task 1: EDIT README.md — Environment Variables table (~L320-334)
  - FIND: the env-var table (rows: ZAI_API_KEY ... ANTHROPIC_API_KEY).
  - ADD: one curated row for PRP_COMMIT_FORMAT:
      | `PRP_COMMIT_FORMAT` | No | `task-prefix` | Commit-subject prefix mode: `task-prefix`
        (DEFAULT) layers `<phase>.<milestone>.<task>.<subtask>:`; `plain` opts out (no prefix;
        also used for non-backlog commits). See [Configuration](docs/CONFIGURATION.md#resilience-tuning) and PRD §5.1. |
  - FOLLOW pattern: existing row density (the table is a curated SUBSET — do not add every var).
  - ACCURACY: task-prefix is DEFAULT; plain is opt-out; unknown/empty => task-prefix.
  - DO NOT duplicate the full CONFIGURATION.md row; this is a one-line pointer.

Task 2: EDIT README.md — Delta Session (PRD Changes) subsection (~L205-217)
  - FIND: the paragraph after the delta-mode code block (ends "...removed ones to Obsolete. (PRD §4.3.)").
  - ADD 1-2 sentences covering BOTH shipped behaviors:
      (a) COSMETIC-only PRD edits (whitespace/formatting) are detected by the change classifier
          and absorbed as the new baseline WITHOUT spawning a delta session (PRD §4.3).
      (b) Added requirements survive even when the architect's freshly-numbered IDs collide with
          the patched ID space — colliding items are renumbered-and-appended, never dropped.
  - ACCURACY: only COSMETIC is absorbed; SUBSTANTIVE still spawns a delta session.
  - LINK: see docs/ARCHITECTURE.md#delta-sessions for internals.

Task 3: EDIT docs/ARCHITECTURE.md — PRD Hash-Based Change Detection (~L714-737)
  - FIND: the "Behavior:" bullet list; the stale line "Modified PRD → Create delta session with parent reference".
  - EDIT: qualify that a hash change now passes the COSMETIC/SUBSTANTIVE change classifier
          (protective default SUBSTANTIVE). SUBSTANTIVE -> delta session; COSMETIC -> absorbed
          (prd_snapshot.md + metadata.hash refreshed) WITHOUT a delta session.
  - ACCURACY: classifier protective default is SUBSTANTIVE (so a classifier outage still triggers
          a delta session, never silently skips). This matches src (bug-002-classifiers.md).
  - LINK: docs/CONFIGURATION.md#resilience-tuning for CLASSIFIER_RETRY_MAX.

Task 4: EDIT docs/ARCHITECTURE.md — Delta Sessions (~L738-784)
  - FIND: the paragraph describing decomposePRD merging added requirements with patchBacklog
          (contains "Issue 1/2" / "hasBacklog" references — KEEP that text).
  - ADD: one sentence that architect items whose fresh-from-P1 IDs collide with the patched ID
          space are renumbered-and-appended (unique, hierarchy-consistent IDs), so added
          requirements are never dropped (PRD §4.3 step 6).
  - DO NOT rewrite the section; the hasBacklog-gate fix prose is accurate for its own fix.
  - ACCURACY: renumber happens at the append point with parent context (not a blanket pre-pass).

Task 5: EDIT docs/ARCHITECTURE.md — Two-Phase Commit (Per-Item Survival) (~L838-843)
  - FIND: the two numbered bullets (pre-cleanup survival commit; post-cleanup doc-reorg commit).
  - ADD: one short sentence (end of the intro paragraph or a trailing note): commit subjects use
          the `<p>.<m>.<t>.<s>:` task-prefix by default (PRP_COMMIT_FORMAT=task-prefix; plain opts
          out; non-backlog commits carry no prefix) and NEVER carry the legacy `[PRP Auto]` banner
          (PRD §5.1). The Co-Authored-By trailer is preserved.
  - LINK: docs/CONFIGURATION.md#resilience-tuning for PRP_COMMIT_FORMAT.
  - ACCURACY: trailer PRESERVED; only [PRP Auto] removed.

Task 6: EDIT docs/WORKFLOWS.md — Phase 3: Delta Handling (~L314-348)
  - FIND: "Entry Conditions:" (currently "PRD hash changed from previous session").
  - EDIT entry conditions: a hash change first passes the change classifier — COSMETIC edits are
          absorbed without a delta session; only SUBSTANTIVE changes enter Phase 3.
  - FIND: Process step 8 (decomposePRD merges added-requirement tasks with patched statuses).
  - ADD clause: architect items whose IDs collide with the patched ID space are renumbered-and-
          appended (never dropped).
  - ADD one new bullet/line under Process or Exit Conditions: decomposePRD classifies delta_prd.md
          (CLEAN/DIRTY artifact classifier; protective default DIRTY); a DIRTY/malformed artifact
          aborts breakdown so the next run regenerates delta_prd.md (PRD §4.3).
  - ACCURACY: COSMETIC => absorb (no Phase 3); SUBSTANTIVE => Phase 3; DIRTY => abort.
  - DO NOT touch the BugHunt "cosmetic" severity tables (L814+) — different meaning.

Task 7: VERIFY — no stale [PRP Auto] + accuracy + no CONFIGURATION.md duplication
  - RUN: grep -rn "\[PRP Auto\]" README.md docs/ARCHITECTURE.md docs/WORKFLOWS.md  # expect ZERO
  - RUN: grep -rn "PRP_COMMIT_FORMAT\|CLASSIFIER_RETRY_MAX" README.md docs/ARCHITECTURE.md docs/WORKFLOWS.md
         # each mention must be a ONE-LINE pointer that LINKS to docs/CONFIGURATION.md, not a duplicated table row
  - RUN: npx markdownlint-cli2 README.md docs/ARCHITECTURE.md docs/WORKFLOWS.md  # (or prettier --check; see Validation)
  - SELF-REVIEW each edited section against the verified src facts (research/doc-surface-audit.md):
        * task-prefix DEFAULT, plain opt-out, trailer preserved, [PRP Auto] gone
        * COSMETIC absorbed (no delta session); SUBSTANTIVE => delta; classifier default SUBSTANTIVE
        * renumber-on-collision merge (added reqs survive); DIRTY aborts breakdown
```

### Implementation Patterns & Key Details

```markdown
# Pattern for each edit: ANCHOR → CURRENT-TEXT → ACCURATE-REPLACEMENT.
#   1. Open the file at the mdsel anchor (audit lists exact ~line numbers).
#   2. Read the current sentence(s) verbatim.
#   3. Replace with the accurate shipped behavior (verified facts, not guesses).
#   4. Keep PRD § refs correct: §4.3 = delta/change-classifier; §5.1 = commit format + integrity.

# Pattern for flag mentions: ONE-LINE POINTER, never a duplicated table row.
#   "...controlled by PRP_COMMIT_FORMAT (see docs/CONFIGURATION.md#resilience-tuning; PRD §5.1)."

# Anti-pattern: rewriting a whole section. Mode B is SURGICAL — add a line / qualify a bullet.
#   If a section already matches the shipped behavior, LEAVE IT (record "already matches" in commit).

# Cross-doc consistency: README = brief user view; ARCHITECTURE = internals; WORKFLOWS = process.
#   README states the WHAT (cosmetic skipped; added reqs survive; no [PRP Auto]).
#   ARCHITECTURE states the HOW (classifier wiring; renumber-merge append points; formatCommitMessage).
#   WORKFLOWS states the WHEN (Phase 3 entry gate; artifact guard before architect).
```

### Integration Points

```yaml
DOCS-LINK-TARGET (do NOT edit, link to it):
  - file: docs/CONFIGURATION.md
  - anchor: "#resilience-tuning"
  - holds: PRP_COMMIT_FORMAT (L165), CLASSIFIER_RETRY_MAX (L164) — the per-flag detail

NO-CODE-CHANGES:
  - src/: READ-ONLY (read to keep prose accurate; edit NOTHING)
  - tests/: untouched (docs task)
  - docs/CONFIGURATION.md: READ-ONLY (Mode A done)
```

## Validation Loop

### Level 1: No stale banner + no duplication (Immediate Feedback)

```bash
# MUST be ZERO — no stale [PRP Auto] in any user-facing overview doc.
grep -rn "\[PRP Auto\]" README.md docs/ARCHITECTURE.md docs/WORKFLOWS.md
# expect: no output (exit 1 from grep is the SUCCESS case here)

# Every PRP_COMMIT_FORMAT / CLASSIFIER_RETRY_MAX mention must LINK to CONFIGURATION.md,
# not duplicate its table row.
grep -rn "PRP_COMMIT_FORMAT\|CLASSIFIER_RETRY_MAX" README.md docs/ARCHITECTURE.md docs/WORKFLOWS.md
# expect: a few one-line pointers, each containing "docs/CONFIGURATION.md"
```

### Level 2: Markdown lint / format (Style)

```bash
# Project has .markdownlint.json + .markdownlintignore. Lint the three edited files:
npx markdownlint-cli2 "README.md" "docs/ARCHITECTURE.md" "docs/WORKFLOWS.md" 2>/dev/null \
  || npx --yes markdownlint-cli2 "README.md" "docs/ARCHITECTURE.md" "docs/WORKFLOWS.md"

# Prettier check (project .prettierrc; .prettierignore excludes some paths):
npx prettier --check README.md docs/ARCHITECTURE.md docs/WORKFLOWS.md

# Expected: clean. If markdownlint flags a line you added, fix the lint (don't disable rules).
```

### Level 3: Accuracy review (manual — the real gate for a docs task)

```bash
# For each edited section, re-read it and confirm it matches the verified src facts:
#   README Delta Session       -> cosmetic skipped + added reqs survive
#   ARCHITECTURE Change Det.   -> COSMETIC absorbed (no delta), SUBSTANTIVE => delta, default SUBSTANTIVE
#   ARCHITECTURE Delta Sess.   -> renumber-on-collision merge (no drop); hasBacklog fix prose preserved
#   ARCHITECTURE Two-Phase     -> task-prefix default, no [PRP Auto], trailer PRESERVED
#   WORKFLOWS Phase 3          -> classifier entry gate + renumber-merge + DIRTY artifact guard
# A doc section that ALREADY MATCHED the shipped behavior must show NO diff for that section.
git diff --stat README.md docs/ARCHITECTURE.md docs/WORKFLOWS.md
git diff README.md docs/ARCHITECTURE.md docs/WORKFLOWS.md   # eyeball every hunk for accuracy
```

### Level 4: Cross-doc consistency

```bash
# The three docs must AGREE on each behavior (same facts, different depth).
# Spot-check: do README, ARCHITECTURE, and WORKFLOWS each say COSMETIC is absorbed (not skipped-silently)?
grep -rni "cosmetic" README.md docs/ARCHITECTURE.md docs/WORKFLOWS.md | grep -vi "bug hunt\|severity"
# Confirm the task-prefix facts are consistent:
grep -rni "task-prefix\|PRP_COMMIT_FORMAT" README.md docs/ARCHITECTURE.md docs/WORKFLOWS.md
```

## Final Validation Checklist

### Technical Validation

- [ ] Level 1: `grep -rn "\[PRP Auto\]" README.md docs/ARCHITECTURE.md docs/WORKFLOWS.md` → 0 hits.
- [ ] Level 1: every `PRP_COMMIT_FORMAT`/`CLASSIFIER_RETRY_MAX` mention LINKS to `docs/CONFIGURATION.md`.
- [ ] Level 2: `markdownlint` + `prettier --check` clean on all three files.
- [ ] Level 3: every edited hunk matches the verified src facts (no over/underclaim).
- [ ] No edits to `src/`, `tests/`, `docs/CONFIGURATION.md`, `PRD.md`, `**/tasks.json`.

### Feature Validation

- [ ] README env-var table lists `PRP_COMMIT_FORMAT` (task-prefix default / plain opt-out).
- [ ] README Delta Session mentions COSMETIC-skip + added-requirement survival (renumber-merge).
- [ ] ARCHITECTURE Change Detection reflects COSMETIC/SUBSTANTIVE classifier (COSMETIC absorbed).
- [ ] ARCHITECTURE Delta Sessions reflects renumber-on-collision merge (hasBacklog prose preserved).
- [ ] ARCHITECTURE Two-Phase Commit notes task-prefix format + absence of `[PRP Auto]` + trailer kept.
- [ ] WORKFLOWS Phase 3 reflects COSMETIC-skip + renumber-merge + CLEAN/DIRTY artifact guard.

### Code Quality Validation

- [ ] Edits are surgical (Mode B = add/qualify, not rewrite); unchanged-matching sections left alone.
- [ ] No per-flag detail duplicated from `docs/CONFIGURATION.md` (LINKs instead).
- [ ] PRD § references correct (§4.3 = delta/classifier; §5.1 = commit format).
- [ ] Cross-doc consistency: the three docs agree on each behavior.

### Documentation & Deployment

- [ ] Prose is self-consistent and reads accurately to a maintainer unfamiliar with the changeset.
- [ ] Commit subject uses the landed task-prefix format: **`1.5.1.1: sync overview docs with bugfix 002 changeset`**
      (NO `[PRP Auto]` — forbidden per PRD §5.1 / BUG-003; the `Co-Authored-By` trailer IS preserved).

---

## Anti-Patterns to Avoid

- ❌ Don't rewrite whole sections — Mode B is surgical (add a line / qualify a bullet).
- ❌ Don't duplicate the `PRP_COMMIT_FORMAT` / `CLASSIFIER_RETRY_MAX` table rows — LINK to CONFIGURATION.md.
- ❌ Don't edit `docs/CONFIGURATION.md` (Mode A done) or any `src/`/`tests/`/`PRD.md`/`tasks.json`.
- ❌ Don't conflate BugHunt severity "cosmetic" (WORKFLOWS L814+) with the PRD-change classifier COSMETIC.
- ❌ Don't write "trailer removed" — the `Co-Authored-By` trailer is PRESERVED; only `[PRP Auto]` is gone.
- ❌ Don't overclaim the classifier default — it is SUBSTANTIVE (fail-safe), so an outage still triggers a delta.
- ❌ Don't touch the WORKFLOWS Delta-Session-Flow mermaid unless it actively misleads — prefer a Phase-3 prose edit.
- ❌ Don't skip the grep `[PRP Auto]` check — it's the hard success criterion.

---

## Confidence Score

**9/10** — This is a surgical, well-bounded docs-sweep with all surfaces enumerated (exact anchors +
current text + required edit in `research/doc-surface-audit.md`) and every shipped behavior verified
directly in `src/`. The only residual risk is markdown-lint nits on added lines, which Level 2 catches.
The "no prior knowledge" test passes: the audit + verified facts are self-contained.