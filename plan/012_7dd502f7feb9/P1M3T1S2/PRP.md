# PRP — P1.M3.T1.S2: Update `docs/ARCHITECTURE.md` — two-layer commit model + `hack update` note

> Delta 012, **P1.M3.T1.S2 — Mode B changeset-level documentation sync into `docs/ARCHITECTURE.md`**.
> Two Delta-012 features are now SHIPPED and configurable but absent from the architecture doc:
> **(Feature 1)** the **commit-message style layer** (`PRP_COMMIT_STYLE` auto/plain/conventional/gitmoji,
> P1.M1.* Complete) and **(Feature 2)** the **`hack update`** manual-status CLI (P1.M2.* Complete/wired).
> Today `docs/ARCHITECTURE.md` documents ONLY the position layer (`PRP_COMMIT_FORMAT`, a single paragraph
> at **L934**) and has no mention of `hack update`. This task brings the doc into alignment in TWO edits:
> **(a)** extend the L934 commit-message paragraph into a **two-layer model** (position UNCHANGED +
> style NEW, with the auto learned-from-history behavior and the conventional/gitmoji↔task-prefix
> double-up); **(b)** add a SHORT `hack update` note in the task-management area. The authoritative
> surface contract is `architecture/implementation-status.md §Feature 3` + PRD §5.1 (style layer) +
> PRD §5.4 (`hack update`). **Sibling S1 (P1.M3.T1.S1)** owns `docs/CONFIGURATION.md` only — this task
> cross-references it, never duplicates it. Single-file scope: `git diff --name-only` ⇒ exactly
> `docs/ARCHITECTURE.md`.

---

## Goal

**Feature Goal**: Bring `docs/ARCHITECTURE.md` into alignment with the two shipped Delta-012 features so a
reader of the architecture doc understands, from this one file, (a) that a generated commit message is
governed by **two orthogonal layers** — the position layer (`PRP_COMMIT_FORMAT`, unchanged) and the style
layer (`PRP_COMMIT_STYLE`, new) — resolved independently (the `stagecoach` agent authors the descriptive
message under the style contract, then `formatCommitMessage` wraps the position prefix), including the
`auto` learned-from-history behavior and the double-up when a prefix-producing style meets `task-prefix`;
and (b) that a user can manually rewrite any item's status via `hack update` with fuzzy-matched ID +
status, downward `Complete` cascade, bottom-up min-status ancestor recompute, serialized under the
`tasks.json` lock.

**Deliverable**: An edited `docs/ARCHITECTURE.md` (and ONLY that file) containing:
1. **Part (a)** — the L934 single-paragraph commit-message note REPLACED by a new `### Commit Message
   Format (Two-Layer Model)` subsection (a 2-row layer table + position-layer paragraph + style-layer
   paragraph with the 4 modes + layer-interaction/double-up paragraph), sitting between the
   `### Two-Phase Commit (Per-Item Survival)` section and `### State Integrity Protections`.
2. **Part (b)** — a new short `### Manual Status Updates (`hack update`)` subsection appended at the END
   of `## Task Hierarchy and Execution Flow` (after the Execution Flow Diagram, before the `---` /
   `## Adopt Mode` separator).

**Success Definition**:
- `docs/ARCHITECTURE.md` describes the two-layer model: names `PRP_COMMIT_FORMAT` (position, default
  `task-prefix`, plain opt-out) AND `PRP_COMMIT_STYLE` (style, default `auto`, + `plain`/`conventional`/
  `gitmoji`); states the style layer controls the descriptive message while the position layer wraps it
  afterward via `formatCommitMessage`; describes `auto`'s learned-from-history approach (last
  `PRP_COMMIT_STYLE_EXAMPLES` commits as verbatim style examples + anti-reuse + ignore-position-prefix;
  ≤1-commit/`EXAMPLES=0` → `plain`); and documents the double-up (`<position>: type(scope): description`
  / `<position>: <emoji> description`) with the `PRP_COMMIT_FORMAT=plain` remedy.
- `docs/ARCHITECTURE.md` contains a `hack update` note covering: fuzzy ID + status matching, downward
  `Complete` cascade, bottom-up min-status ancestor recompute, and serialization under the `tasks.json`
  lock with atomic writes.
- The existing `Co-Authored-By` trailer note, the `[PRP Auto]`-never-emitted note, the "This complements…"
  sentence (L932), and ALL other content are PRESERVED (only L934 is replaced; one subsection is added).
- `npm run docs:lint` (markdownlint) passes on `docs/ARCHITECTURE.md`; `npm run format:check` passes
  (run `npm run format` first to normalize).
- `git diff --name-only` lists EXACTLY `docs/ARCHITECTURE.md` — no `src/`, no `CONFIGURATION.md` (S1),
  no `README.md` (S3), no `PRD.md`.

---

## User Persona (if applicable)

**Target User**: Developer / maintainer / new contributor reading `docs/ARCHITECTURE.md` to understand how
the pipeline commits and how task status can be hand-corrected.

**Use Case**: "How are commit messages formatted, and can I match my project's existing commit style?"
and "Can I manually fix a task's status without editing `tasks.json` by hand?"

**User Journey**: Reader opens ARCHITECTURE.md → finds the commit section → learns the two-layer model
(position vs style) and the `auto` history-learning → sees the double-up caveat → later, in the
task-hierarchy section, finds the `hack update` note for manual status overrides.

**Pain Points Addressed**: The architecture doc currently implies commits are governed by a single
position layer and is silent on `hack update`; a reader cannot discover the style configurability or the
manual status-override command from the architecture doc.

---

## Why

- **Mode B docs must reflect shipped features.** The style layer (`PRP_COMMIT_STYLE`, P1.M1.*) and
  `hack update` (P1.M2.*) are real, configurable, user-facing surfaces. `docs/ARCHITECTURE.md` is the
  canonical architecture reference; it currently documents only the position layer and omits
  `hack update` entirely. This task closes that gap so the doc matches the shipped system.
- **The two-layer model is the load-bearing concept.** A generated commit message is governed by TWO
  orthogonal axes (position + style), resolved independently — this is non-obvious and is exactly the
  kind of "how it's built" knowledge a PRP must make explicit. The current single paragraph makes it
  look like `PRP_COMMIT_FORMAT` is the whole story; the `auto` learned-from-history mode and the
  conventional/gitmoji↔task-prefix double-up are the subtle behaviors a reader needs documented.
- **`hack update` needs an architecture-level mention.** S1 documents the full command *syntax* in
  `CONFIGURATION.md`; ARCHITECTURE.md needs the short *behavioral* note (fuzzy match + cascade +
  ancestor recompute + lock-serialized atomic write) so the task-management area is complete. The two
  docs complement, not duplicate.
- **Single-file scope, no code/test risk.** This task owns ONLY `docs/ARCHITECTURE.md`. It cannot break
  the build or the (pre-existing-red) test suite; the gate is markdown lint + prettier + content greps.

---

## What

### User-visible behavior
None beyond the docs. Observable change: `docs/ARCHITECTURE.md` gains one REPLACED paragraph (→ a
two-layer subsection) and one NEW subsection (`hack update` note).

### Technical requirements (exact contract)

**Part (a) — REPLACE the L934 paragraph.** The current single paragraph at line 934 (verbatim `oldText`):

> `Commit subjects use the \`<phase>.<milestone>.<task>.<subtask>:\` **task-prefix** by default
> (\`PRP_COMMIT_FORMAT=task-prefix\`; \`plain\` opts out; non-backlog commits carry no prefix) and
> **never** carry the legacy auto-generated banner prefix (PRD §5.1). The
> \`Co-Authored-By: Claude <noreply@anthropic.com>\` trailer is **preserved** on every commit. See
> [Configuration](CONFIGURATION.md#resilience-tuning) for the flag.`

…is REPLACED by this new `###` subsection (place it so it sits between the L932 "This complements…"
sentence and the L936 `### State Integrity Protections` heading — i.e. as a new sibling subsection under
`## State Management and Persistence`). Verbatim new content (let `npm run format` normalize table/prose):

```markdown
### Commit Message Format (Two-Layer Model)

A generated commit message is governed by **two orthogonal layers**, resolved independently: the
`stagecoach` agent first authors the **descriptive message** under the style contract, then
`formatCommitMessage` wraps the **position** prefix around it. The legacy `[PRP Auto]` banner is never
emitted (PRD §5.1).

| Layer     | Toggle               | Default       | Controls                                            |
| --------- | -------------------- | ------------- | --------------------------------------------------- |
| Position  | `PRP_COMMIT_FORMAT`  | `task-prefix` | Whether/how the item's position is prepended        |
| Style     | `PRP_COMMIT_STYLE`   | `auto`        | The wording of the descriptive message itself       |

**Position layer (unchanged).** `PRP_COMMIT_FORMAT=task-prefix` (default) prepends the item's 1-indexed
`<phase>.<milestone>.<task>.<subtask>:` position, eliding trailing levels the item does not use
(`1.2.1`, never `1.2.1.0`); non-backlog commits (initial, fallback, scaffolding) carry no prefix, and
`PRP_COMMIT_FORMAT=plain` opts out entirely. This layer never touches the wording of the descriptive
message. The `Co-Authored-By: Claude <noreply@anthropic.com>` trailer is **preserved** on every commit
in both modes.

**Style layer.** `PRP_COMMIT_STYLE` governs the descriptive message `stagecoach` actually writes — its
tone, length, and whether it carries a Conventional-Commit type/scope or a gitmoji:

- `auto` (default) **learns from history**: the generation request includes the last
  `PRP_COMMIT_STYLE_EXAMPLES` (default 5) commit messages as verbatim **style examples**, with a hard
  anti-reuse instruction (match the examples' style — format, tone, length, prefix/emoji — but produce
  entirely original wording for this change) and an instruction to **ignore any leading numeric position
  prefix** in the examples (that marker is added by the position layer, not part of the style). A repo
  with ≤1 commit — or `PRP_COMMIT_STYLE_EXAMPLES=0` — has nothing to learn, so `auto` degrades to the
  `plain` contract.
- `plain` — imperative summary, ≤72-char subject, no type prefix, no scope, no emoji (the prior fixed
  prompt, promoted to a named mode; also the `auto` fallback).
- `conventional` — `type(scope): description` from the standard Conventional-Commits vocabulary; scope
  optional.
- `gitmoji` — the subject begins with exactly one gitmoji (the emoji character, not a `:shortcode:`),
  followed by a space and the description.

An explicit (non-`auto`) mode **replaces** the style-examples block with that mode's contract; history is
consulted only under `auto`. The agent's system prompt is built dynamically from the resolved mode (the
former hardcoded prompt is the `plain` contract). In every mode the agent emits ONLY the descriptive
message — never a position prefix, the `[PRP Auto]` banner, or the `Co-Authored-By` trailer (those remain
`formatCommitMessage`'s job).

**Interaction between the layers.** Both layers apply in sequence and independently. When a
prefix-producing style (`conventional`, `gitmoji`) is combined with `PRP_COMMIT_FORMAT=task-prefix`,
**both prefixes render** and the subject takes the form `<position>: type(scope): description` (or
`<position>: <emoji> description`) — the descriptive message is still kept verbatim. A team that wants a
clean Conventional-Commit or gitmoji history sets `PRP_COMMIT_FORMAT=plain` so the position layer does not
double up. (Under `auto`, the same double-up can occur when the learned style is conventional/gitmoji —
that is the project's own voice being matched, and the same `plain` remedy applies.) Toggling either layer
affects only newly generated messages; existing history is never rewritten.

See [Configuration](CONFIGURATION.md#resilience-tuning) for the env-var flags and `.hack` keys.
```

**Part (b) — ADD the `hack update` note.** Insert this new `###` subsection at the **END of
`## Task Hierarchy and Execution Flow`** — i.e. AFTER the Execution Flow Diagram's mermaid block
(`### Execution Flow Diagram`, ~L1062) and BEFORE the `---` separator that precedes
`## Adopt Mode (--adopt-prd)` (~L1110). Verbatim new content:

```markdown
### Manual Status Updates (`hack update`)

`hack update <task-id> <status>` (PRD §5.4) rewrites a task item's status from the command line, with
**both** the task ID and the target status **fuzzy-matched** for ergonomics: the ID accepts canonical
(`P1.M1.T1.S1`), concatenated (`p1m1t1s1`), and numeric (`1.1.1.1`, `1.2`) forms (trailing segments
optional → Phase/Milestone/Task/Subtask), and the status accepts synonyms (`done`, `re`, `comp`),
canonical words, unique prefixes, and unique substrings (`r` is ambiguous → Ready/Researching).

Setting a parent `Complete` **cascades `Complete` down** to every descendant; after any change, every
ancestor is **recomputed bottom-up** as the minimum (least-progressed) status among its children
(`Failed` children are excluded unless all children are `Failed`; `Obsolete` is terminal and loses ties to
`Complete`) — so marking the last subtask `Complete` promotes its Task/Milestone/Phase, and resetting a
subtask back to `Planned` drops its ancestors accordingly. The command is a serialized read-modify-write
under the same `tasks.json.lock` used by the orchestrator (§5.1), validates through the canonical backlog
schema, and writes atomically (temp file + rename) — it can neither corrupt `tasks.json` nor race a
concurrent writer. See [Configuration](CONFIGURATION.md) for the full syntax.
```

> **Heading-uniqueness note (markdownlint MD024, `siblings_only`):** `### Commit Message Format
> (Two-Layer Model)` is unique among the `## State Management and Persistence` siblings, and
> `### Manual Status Updates (`hack update`)` is unique among the `## Task Hierarchy and Execution Flow`
> siblings — both pass MD024. (The TOC at L11–25 lists only `##` sections, so NO TOC edit is required.)

### Success Criteria
- [ ] L934's single paragraph is GONE; in its place is a `### Commit Message Format (Two-Layer Model)`
      subsection with the 2-row layer table + position/style/interaction paragraphs.
- [ ] The two-layer subsection names `PRP_COMMIT_FORMAT` AND `PRP_COMMIT_STYLE` with their defaults
      (`task-prefix`, `auto`); states the style layer controls the descriptive message and the position
      layer wraps it after via `formatCommitMessage`; documents `auto`'s history-learning (last
      `PRP_COMMIT_STYLE_EXAMPLES` examples + anti-reuse + ignore-position-prefix; ≤1-commit/`EXAMPLES=0`
      → `plain`); and documents the double-up + the `PRP_COMMIT_FORMAT=plain` remedy.
- [ ] A `### Manual Status Updates (`hack update`)` subsection exists at the end of
      `## Task Hierarchy and Execution Flow`, covering fuzzy ID+status matching, downward `Complete`
      cascade, bottom-up min-status ancestor recompute, and lock-serialized atomic writes.
- [ ] The L932 "This complements…" sentence, the `Co-Authored-By`-preserved note, the `[PRP Auto]`
      -never-emitted note, and all other existing content are UNCHANGED.
- [ ] `npm run docs:lint` passes on `docs/ARCHITECTURE.md`; `npm run format:check` passes.
- [ ] `git diff --name-only` ⇒ exactly `docs/ARCHITECTURE.md`.

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_ **Yes** — the two exact
edit sites (replace L934 verbatim; append a subsection before the `## Adopt Mode` separator) with the
verbatim old + new markdown, the verified fact that both features are shipped (with the precise env-var
names/defaults/modes), the markdown-style + tooling rules (markdownlint MD024/MD031/MD032, prettier), the
sibling ownership boundary (S1=CONFIGURATION.md, S3=README.md), and the validation commands. See
`research/01-docs-facts.md` for per-claim evidence.

### Documentation & References
```yaml
# MUST READ — the authoritative surface contract + the Mode B doc map
- docfile: plan/012_7dd502f7feb9/architecture/implementation-status.md
  section: "Feature 3 — Cross-cutting documentation (Mode B)"
  why: Maps the Mode B doc work: ARCHITECTURE.md ← "Two-layer commit model (position + style); hack update short note".
       Features 1 & 2 give the exact shipped interfaces the prose must name.
  critical: This task = the ARCHITECTURE.md row of that table. CONFIGURATION.md is S1; README.md is S3.

# MUST READ — PRD §5.1 (the two-layer model spec) — provided in selected_prd_content
- file: PRD.md
  section: "5.1 Commit Message Format → 'Commit Message Style (Learning & Explicit Modes)'"
  why: The authoritative contract for the style layer (auto history-learning, plain/conventional/gitmoji,
       double-up, EXAMPLES=0, anti-reuse advisory). The new subsection is a faithful architecture-doc
       rendering of it.
  critical: position layer is UNCHANGED; style layer is the NEW axis; double-up form is
            `<position>: type(scope): description`.

# MUST READ — PRD §5.4 (hack update contract) — provided in selected_prd_content
- file: PRD.md
  section: "5.4 Manual Status Updates (hack update)"
  why: Cascade semantics (downward Complete; bottom-up min-status recompute with Failed/Obsolete rules),
       fuzzy ID + status matching, lock-serialized atomic write. The short note summarizes these.
  critical: `r` is ambiguous (Ready/Researching); Failed excluded unless all Failed; Obsolete terminal.

# THE FILE TO EDIT — replace L934; append a subsection before ## Adopt Mode
- file: docs/ARCHITECTURE.md
  why: EDIT (the only file). Replace the L934 paragraph with the two-layer subsection; add the hack update
       subsection at the end of "## Task Hierarchy and Execution Flow".
  anchors: "### Two-Phase Commit (Per-Item Survival)" L925; commit-message paragraph L934 (REPLACE);
           "### State Integrity Protections" L936; "## Task Hierarchy and Execution Flow" L949;
           "### Execution Flow Diagram" L1062 (insert the hack update subsection AFTER its mermaid block);
           "## Adopt Mode (--adopt-prd)" L1110 (insert BEFORE the preceding `---`).
  critical: PRESERVE the L932 "This complements…" sentence + the Co-Authored-By/NO-[PRP-Auto] notes (fold
            them into the new subsection). Do NOT touch the TOC (L11–25, `##`-only).

# SHIPPED SOURCE (read-only — confirms the prose names real symbols; do NOT edit)
- file: src/config/constants.ts
  why: PRP_COMMIT_FORMAT block (position) + PRP_COMMIT_STYLE/PRP_COMMIT_STYLE_EXAMPLES block (style,
       ~L770–850): PrpCommitFormat='task-prefix'|'plain'; PrpCommitStyle='auto'|'plain'|'conventional'|'gitmoji';
       getPrpCommitStyle() case-INSENSITIVE; DEFAULT_PRP_COMMIT_STYLE_EXAMPLES=5.
- file: src/agents/commit-message-agent.ts
  why: buildCommitMessageSystemPrompt(style, examples?) (L303) — the dynamic per-mode prompt builder; the
       prior COMMIT_MESSAGE_SYSTEM is the `plain` contract. Confirms "agent emits ONLY the descriptive message."
- file: src/utils/git-commit.ts
  why: generateCommitMessage (L290+) resolves getPrpCommitStyle(); under 'auto' fetches getRecentCommitMessages
       (L31 import) as examples (degrades to plain for ≤1 commit / EXAMPLES=0); formatCommitMessage wraps the
       position prefix AFTER. Confirms the two-layer ordering the doc describes.
- file: src/cli/index.ts + src/utils/task-utils.ts
  why: .command('update') (L1040) + updateAction (L907); normalizeTaskId/findItemByLooseId/matchStatus/
       cascadeCompleteDown/recomputeAncestorsUp — confirms hack update is shipped with the cascade/lock behavior.

# SIBLING CONTRACT (S1 — P1.M3.T1.S1, do NOT duplicate; cross-reference only)
- docfile: plan/012_7dd502f7feb9/P1M3T1S1/PRP.md
  why: S1 edits ONLY docs/CONFIGURATION.md (two env-var rows in `### Resilience Tuning`, two `.hack` keys in
       the `[pipeline]` schema-summary, and a `### hack update` subsection under `## Task & Status Commands`).
       This task's ARCHITECTURE.md note is the architecture-level counterpart: cross-link to CONFIGURATION.md
       for flags/syntax instead of restating them.
  critical: ZERO file overlap (S1=CONFIGURATION.md, S2=ARCHITECTURE.md). Link to CONFIGURATION.md (the
            #resilience-tuning anchor is stable for the commit flags; for hack-update syntax link to the
            file generically — S1's exact `### hack update` anchor is uncertain).

# SIBLING CONTRACT (S3 — P1.M3.T1.S3, do NOT touch)
- docfile: plan/012_7dd502f7feb9/P1M3T1S3/PRP.md   # (planned, not yet written)
  why: S3 will edit README.md (hack update in commands list; style layer in commit-behavior). Do NOT edit
       README.md here.
```

### Current Codebase tree (relevant slice)
```bash
docs/ARCHITECTURE.md                            # EDIT (only file): replace L934; append hack-update subsection
plan/012_7dd502f7feb9/architecture/implementation-status.md  # READ-ONLY: Feature 3 doc map + Feature 1/2 surfaces
PRD.md                                          # READ-ONLY: §5.1 (style layer) + §5.4 (hack update) contract
src/config/constants.ts                         # READ-ONLY: confirms PRP_COMMIT_FORMAT / PRP_COMMIT_STYLE symbols
src/agents/commit-message-agent.ts              # READ-ONLY: confirms buildCommitMessageSystemPrompt
src/utils/git-commit.ts                         # READ-ONLY: confirms two-layer ordering (style first, position wraps)
src/cli/index.ts + src/utils/task-utils.ts      # READ-ONLY: confirms hack update + cascade shipped
docs/CONFIGURATION.md                           # READ-ONLY (S1 owns); cross-reference target
```

### Desired Codebase tree with files to be added/edited
```bash
docs/ARCHITECTURE.md                            # MODIFIED (one paragraph replaced → two-layer subsection; +1 subsection)
# (no new files; no src/; no tests; no other docs)
```

### Known Gotchas of our codebase & Library Quirks
```markdown
<!-- CRITICAL — Single-file scope. Edit ONLY docs/ARCHITECTURE.md. Do NOT touch docs/CONFIGURATION.md (S1),
     README.md (S3), PRD.md, PROMPTS.md, any src/, or any test. git diff --name-only must list exactly one file. -->

<!-- CRITICAL — Part (a) is a REPLACE, not an append. The L934 paragraph must be GONE (it documents only the
     position layer). Replace it with the new ### Commit Message Format (Two-Layer Model) subsection. PRESERVE
     the L932 "This complements…" sentence (it stays as the tail of ### Two-Phase Commit) — only L934 goes. -->

<!-- CRITICAL — Fold the two surviving claims into the new subsection: the [PRP Auto] banner is NEVER emitted,
     and the Co-Authored-By trailer is PRESERVED in both modes. (They are in the verbatim new content above.) -->

<!-- CRITICAL — markdownlint MD024 (siblings_only) forbids duplicate SIBLING ### headings. Both new headings are
     unique among their siblings — verified. Do NOT reuse an existing ### title. -->

<!-- GOTCHA — markdownlint MD031/MD032 require BLANK LINES around the table and around each bullet list. Fence
     the 2-row layer table and the 4 style-mode bullets with blank lines. (npm run docs:lint:fix can help.) -->

<!-- GOTCHA — prettier (npm run format) will reflow the markdown table + long prose lines. That is EXPECTED —
     run `npm run format` FIRST, then `npm run format:check`. MD013 (line length) is OFF, so long lines are fine. -->

<!-- GOTCHA — The TOC (L11–25) lists ONLY ## sections. Both edits add ### subsections inside EXISTING ## sections
     → NO TOC change. Do not edit the TOC. -->

<!-- GOTCHA — Cross-reference safety: the commit-flags link `[Configuration](CONFIGURATION.md#resilience-tuning)`
     reuses an anchor already present in the current doc (stable). For the hack-update syntax link, use the
     generic `[Configuration](CONFIGURATION.md)` — S1's exact `### hack update` anchor is not guaranteed. -->

<!-- GOTCHA — The pre-existing `npm run test:run` is RED (BUG-004, unrelated) and typecheck/lint are src-only.
     This task's gate is docs:lint + format:check on the one file + grep/git-diff checks. Do NOT gate on test:run. -->

<!-- CRITICAL — Describe the features as SHIPPED (they are — verified in src/). Do NOT hedge ("will", "should");
     use present tense ("governs", "learns", "renders"). The doc records the as-built architecture. -->
```

---

## Implementation Blueprint

### Data models and structure
None — this is a documentation edit. The "model" is the two-layer concept (position vs style) rendered as
a 2-row markdown table + prose, plus a short `hack update` behavioral note.

### Implementation Tasks (ordered; each leaves the doc lint-clean)
```yaml
Task 1: EDIT docs/ARCHITECTURE.md — Part (a): replace L934 with the two-layer subsection
  - LOCATE the exact paragraph at L934 (the `oldText` in "Technical requirements (Part a)"). It is the LAST
    line of `### Two-Phase Commit (Per-Item Survival)`, immediately after the L932 "This complements…"
    sentence and immediately before `### State Integrity Protections` (L936).
  - REPLACE that single paragraph with the new `### Commit Message Format (Two-Layer Model)` subsection
    (heading + 2-row layer table + position-layer paragraph + style-layer paragraph with the 4 modes +
    interaction/double-up paragraph + the CONFIGURATION.md cross-link). Use the verbatim markdown supplied
    in "Technical requirements (Part a)".
  - PRESERVE the L932 "This complements…" sentence (do not delete it). Ensure the `[PRP Auto]`-never-emitted
    + Co-Authored-By-preserved claims are present in the new subsection (they are, in the verbatim block).
  - DO NOT add a ## heading or a TOC entry (it is a ### sibling under an existing ## section).

Task 2: EDIT docs/ARCHITECTURE.md — Part (b): append the hack update subsection
  - LOCATE `### Execution Flow Diagram` (~L1062) under `## Task Hierarchy and Execution Flow` (L949). Its
    mermaid block ends shortly before a `---` separator that precedes `## Adopt Mode (--adopt-prd)` (~L1110).
  - INSERT the new `### Manual Status Updates (`hack update`)` subsection AFTER the mermaid block and BEFORE
    that `---` separator (i.e. as the last subsection of `## Task Hierarchy and Execution Flow`). Use the
    verbatim markdown supplied in "Technical requirements (Part b)".
  - Keep it SHORT (two paragraphs): fuzzy-match + cascade/ancestor-recompute + lock-serialized atomic write.
    Do NOT restate the full CLI syntax (that is S1's CONFIGURATION.md job) — cross-link to CONFIGURATION.md.

Task 3: FORMAT + LINT + VERIFY
  - RUN: npm run format              # prettier --write (normalizes the table + prose reflow)
  - RUN: npm run docs:lint           # markdownlint "docs/**/*.md" — must pass (MD024/MD031/MD032 are the risks)
  - RUN: npm run docs:lint:fix       # if any lint error remains, auto-fix then re-run docs:lint
  - RUN: npm run format:check        # prettier --check — must pass
  - GREP checks (see Validation Loop Level 3).
  - RUN: git diff --name-only        # MUST list exactly "docs/ARCHITECTURE.md"
  - DO NOT run `npm run test:run` / `npm run typecheck` / `npm run lint` as gates (src-only / pre-existing-red).
  - EXPECTED: docs:lint clean, format:check clean, greps hit, single-file diff.
```

### Implementation Patterns & Key Details
```markdown
<!-- Part (a) replacement — the anchor paragraph (L934) is unique; replace it wholesale. The new subsection
     starts with a ### heading (unique sibling), then a one-line lead-in, then the 2-row table (blank-line
     fenced), then three **bold-led** paragraphs mirroring the doc's existing bold-term prose style. -->

<!-- Part (b) insertion — find "## Adopt Mode" and insert BEFORE the `---` that precedes it; the new ###
     heading is the last child of "## Task Hierarchy and Execution Flow". Two paragraphs, bold-led terms,
     matching the doc's prose density (compare the "tasks.json Protection" / "Two-Phase Commit" prose). -->

<!-- Cross-links: commit-flags → [Configuration](CONFIGURATION.md#resilience-tuning) (stable anchor, already
     used in the current doc). hack-update syntax → [Configuration](CONFIGURATION.md) (generic; S1 owns the
     detailed ### hack update subsection in CONFIGURATION.md). -->
```

### Integration Points
```yaml
DOCS/ARCHITECTURE.MD (the only edit):
  - REPLACE L934 paragraph → "### Commit Message Format (Two-Layer Model)" subsection (position + style layers).
  - APPEND "### Manual Status Updates (`hack update`)" subsection at the end of "## Task Hierarchy and Execution Flow".
  - PRESERVE: L932 "This complements…" sentence; all other sections, tables, mermaid blocks; the TOC (L11–25).

DOCS/CONFIGURATION.MD (S1 owns — DO NOT EDIT):
  - Cross-reference target only. S1 adds PRP_COMMIT_STYLE/PRP_COMMIT_STYLE_EXAMPLES env-var rows, the two
    .hack keys, and the detailed ### hack update syntax subsection. ARCHITECTURE.md links there.

README.MD (S3 owns — DO NOT EDIT):
  - Out of scope. S3 will add hack update to the commands list + the style layer to the commit-behavior section.

NO CODE / NO TESTS:
  - src/, tests/, lib/, plugin/ are UNTOUCHED. The vitest 100%-coverage gate and the pre-existing-red
    test:run are irrelevant to a .md edit; the gate is docs:lint + format:check + content greps.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
npm run format              # prettier --write "**/*.{...,md,...}" — normalizes the new table + prose (run FIRST)
npm run docs:lint           # markdownlint "docs/**/*.md" — must pass
npm run docs:lint:fix       # auto-fix any fixable lint issues, then re-run docs:lint
npm run format:check        # prettier --check — must pass
# Expected: all clean. Likely failures:
#   - MD024 duplicate sibling heading → rename the new ### to a unique title (both proposed titles are unique).
#   - MD031/MD032 (blanks around table/list) → add blank lines fencing the table + bullet list; docs:lint:fix
#     often repairs these.
#   - prettier reflow diffs → run `npm run format` (write) before format:check.
```

### Level 2: Unit Tests (Component Validation)
```bash
# N/A — this is a markdown documentation edit. There is no test suite for docs/ARCHITECTURE.md.
# (Do NOT run `npm run test:run` — it is pre-existing-red (BUG-004) and unrelated to a .md change.)
```

### Level 3: Integration / Regression (System Validation)
```bash
# Part (a) — the two-layer subsection landed + the old single paragraph is gone + survivors preserved:
grep -c "Commit subjects use the" docs/ARCHITECTURE.md                         # expect 0 (old L934 paragraph removed)
grep -n "### Commit Message Format (Two-Layer Model)" docs/ARCHITECTURE.md     # expect 1 (new subsection heading)
grep -n "PRP_COMMIT_STYLE" docs/ARCHITECTURE.md                                # expect ≥3 (table + style paragraph + modes)
grep -n "PRP_COMMIT_FORMAT" docs/ARCHITECTURE.md                               # expect ≥2 (table + position paragraph)
grep -n "formatCommitMessage" docs/ARCHITECTURE.md                             # expect ≥1 ("wraps the position prefix")
grep -n "double-up\|both prefixes render\|type(scope): description" docs/ARCHITECTURE.md  # expect ≥1 (double-up documented)
grep -n "learns from history\|style examples\|PRP_COMMIT_STYLE_EXAMPLES" docs/ARCHITECTURE.md  # expect ≥1 (auto behavior)
grep -n "This complements \[tasks.json Protection" docs/ARCHITECTURE.md        # expect 1 (L932 sentence PRESERVED)
grep -n "Co-Authored-By: Claude" docs/ARCHITECTURE.md                          # expect ≥1 (trailer-preserved note kept)
grep -n "\[PRP Auto\]" docs/ARCHITECTURE.md                                    # expect ≥1 (the "never emitted" note — it's fine; it says NEVER)
# Part (b) — the hack update subsection landed:
grep -n "### Manual Status Updates" docs/ARCHITECTURE.md                       # expect 1 (new subsection heading)
grep -n "hack update" docs/ARCHITECTURE.md                                     # expect ≥2 (heading + body)
grep -n "cascades .Complete. down\|recomputed bottom-up\|tasks.json.lock" docs/ARCHITECTURE.md  # expect ≥1 each concept
# Single-file scope:
git diff --name-only                                                           # MUST list exactly "docs/ARCHITECTURE.md"
# Expected: every grep returns its expected hit count; the old L934 paragraph is gone; both subsections
#   present; survivors preserved; diff is exactly one file.
```

### Level 4: Creative & Domain-Specific Validation
```bash
# Rendered-markdown sanity (no tool required — visual/mental check; record observations in the commit msg):
#   1. The 2-row layer table renders with both columns aligned (Position | Style) and the defaults are
#      task-prefix / auto.
#   2. The four style modes (auto/plain/conventional/gitmoji) are each described; auto's history-learning
#      + the ≤1-commit/EXAMPLES=0 → plain degradation + the anti-reuse + ignore-position-prefix instructions
#      are stated.
#   3. The double-up example reads `<position>: type(scope): description` (and the gitmoji variant), with
#      the PRP_COMMIT_FORMAT=plain remedy.
#   4. The hack update note's cascade rule is correct: downward Complete; bottom-up MIN with Failed-excluded
#      -unless-all-Failed and Obsolete-terminal-loses-ties-to-Complete.
#   5. Both new subsections sit in the intended parents (State Management / Task Hierarchy) and the TOC is
#      untouched (### subsections are not listed in the ## -only TOC).
#   6. The doc still reads as as-built architecture (present tense, no "will/should" hedging).
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run docs:lint` passes on `docs/ARCHITECTURE.md`.
- [ ] `npm run format:check` passes (run `npm run format` first).
- [ ] `git diff --name-only` ⇒ exactly `docs/ARCHITECTURE.md`.

### Feature Validation
- [ ] L934's old single paragraph is replaced by `### Commit Message Format (Two-Layer Model)`.
- [ ] Two-layer subsection names `PRP_COMMIT_FORMAT` (default `task-prefix`) + `PRP_COMMIT_STYLE` (default `auto`).
- [ ] States style layer controls the descriptive message; position layer wraps it after via `formatCommitMessage`.
- [ ] Documents `auto` learned-from-history (last `PRP_COMMIT_STYLE_EXAMPLES` examples + anti-reuse + ignore-position-prefix; ≤1-commit/`EXAMPLES=0` → `plain`).
- [ ] Documents the double-up (`<position>: type(scope): description` / `<position>: <emoji> description`) + `PRP_COMMIT_FORMAT=plain` remedy.
- [ ] `[PRP Auto]` never-emitted + `Co-Authored-By` preserved notes are present (folded into the new subsection).
- [ ] `### Manual Status Updates (`hack update`)` subsection exists at the end of `## Task Hierarchy and Execution Flow`.
- [ ] hack update note covers fuzzy ID+status matching, downward `Complete` cascade, bottom-up min-status ancestor recompute, lock-serialized atomic write.

### Code Quality Validation
- [ ] Markdown follows the doc's existing conventions (bold key terms, backticked code/IDs, `PRD §X` citations, table style).
- [ ] New `###` headings are unique among siblings (MD024 `siblings_only`).
- [ ] Tables/lists are blank-line fenced (MD031/MD032).
- [ ] L932 "This complements…" sentence + all unrelated content UNCHANGED; TOC untouched.
- [ ] Only `docs/ARCHITECTURE.md` modified.

### Documentation & Deployment
- [ ] Describes features as SHIPPED (present tense; verified in `src/`).
- [ ] Cross-references CONFIGURATION.md for flags/`.hack` keys (S1) and hack-update syntax (S1) — no duplication.
- [ ] Commit message records: P1.M3.T1.S2; Mode B doc sync; the two edits (replace L934 → two-layer subsection;
      append hack-update note); the source-of-truth (implementation-status.md §Feature 3 + PRD §5.1/§5.4);
      the S1/S3 file-ownership boundary; the markdownlint/prettier gate.
---

## Anti-Patterns to Avoid

- ❌ Don't edit any file other than `docs/ARCHITECTURE.md`. S1 owns `CONFIGURATION.md`, S3 owns `README.md`;
      `PRD.md`/`PROMPTS.md`/`src/`/`tests/` are all off-limits. `git diff --name-only` must be one file.
- ❌ Don't APPEND the two-layer content and leave the old L934 paragraph in place. Part (a) is a **REPLACE**
      — the position-only paragraph must be removed, or the doc will contradict itself.
- ❌ Don't delete the L932 "This complements…" sentence or drop the `[PRP Auto]`-never / `Co-Authored-By`
      -preserved notes. Fold them into the new subsection; they are load-bearing claims.
- ❌ Don't restate the full `hack update` CLI syntax in ARCHITECTURE.md. That's S1's job in CONFIGURATION.md.
      Keep the ARCHITECTURE.md note SHORT (behavior: fuzzy match + cascade + recompute + lock).
- ❌ Don't add a `##` section or a TOC entry. Both edits are `###` subsections inside EXISTING `##` sections;
      the `##`-only TOC (L11–25) needs no change.
- ❌ Don't reuse an existing `###` heading text (MD024 `siblings_only`). Both proposed titles are unique — keep them.
- ❌ Don't skip the blank lines around the table/bullets (MD031/MD032). Fence them; `npm run docs:lint:fix` helps.
- ❌ Don't gate on `npm run test:run` / `typecheck` / `lint`. Those are src-only or pre-existing-red and
      irrelevant to a `.md` edit. The gate is `docs:lint` + `format:check` + the content greps.
- ❌ Don't hedge with "will"/"should". Both features are shipped — write present-tense as-built prose
      ("governs", "learns", "renders", "cascades").
- ❌ Don't describe `PRP_COMMIT_FORMAT` as new. It is the UNCHANGED position layer; only `PRP_COMMIT_STYLE`
      is new. Mixing them up is the core conceptual error this doc exists to prevent.
- ❌ Don't use a fragile `#hack-update` anchor for the CONFIGURATION.md cross-link. S1's exact heading anchor
      is uncertain — link generically to `[Configuration](CONFIGURATION.md)` for syntax; use the stable
      `#resilience-tuning` anchor for the commit flags (already present in the current doc).

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: This is a small, fully-specified, single-file documentation edit. Both edit sites are verified
against the working tree (replace L934 — its exact verbatim text is quoted; append before the `## Adopt Mode`
separator at ~L1110). Both features are **confirmed shipped** in `src/` (constants.ts, commit-message-agent.ts,
git-commit.ts, cli/index.ts, task-utils.ts all grep-verified), so the prose describes real surfaces — no
guessing. The verbatim new markdown (subsection + table + 4 style modes + double-up + hack-update note) is
supplied in full, matching the doc's existing prose density/style and the authoritative PRD §5.1 / §5.4
contracts. The non-obvious risks are all enumerated and mitigated: (a) markdownlint MD024 `siblings_only`
(both new headings unique); (b) MD031/MD032 blank-line fencing around the table/bullets; (c) prettier reflow
(run `npm run format` first); (d) the REPLACE-not-append semantics for L934 (old paragraph must go); (e)
preserving the L932 sentence + the trailer/banner notes; (f) the S1/S3 file-ownership boundary (one-file diff);
(g) the generic CONFIGURATION.md cross-link (avoiding a fragile anchor); (h) no test/typecheck gate (it's a
.md edit). No code/test/build unknowns. Residual risks: a markdownlint rule firing on an unanticipated
detail (auto-fixable via `docs:lint:fix`) and a prettier reflow (normalized via `npm run format`). The Mode B
doc-sync is conceptually simple and the content is prescribed verbatim.