# PRP — P1.M3.T1.S3: Update `README.md` — `hack update` command + commit style layer

> Delta 012, **P1.M3.T1.S3 — Mode B changeset-level documentation sync into `README.md`**. Two Delta-012
> features are now SHIPPED and configurable but absent from the project's front-door README:
> **(Feature 1)** the **commit-message style layer** (`PRP_COMMIT_STYLE` `auto`/`plain`/`conventional`/
> `gitmoji`, P1.M1.* Complete) and **(Feature 2)** the **`hack update`** manual-status CLI (P1.M2.*
> Complete/wired). Today `README.md` documents ONLY the position layer — a single env-var table row at
> **L398** (`PRP_COMMIT_FORMAT`, `task-prefix`/`plain`) — and has no mention of `hack update`. This task
> brings the README into alignment in THREE localized edits: **(a)** add `update` to the subcommand
> enumeration in `## Running from Anywhere` (L114–115); **(b)** add a NEW `### Manual Status Update
> (hack update)` subsection right after `### Task Status (hack status / hack task)` (after L310); **(c)**
> extend the L398 env-var row to name the orthogonal style layer + add `PRP_COMMIT_STYLE` and
> `PRP_COMMIT_STYLE_EXAMPLES` rows. The authoritative surface contract is
> `architecture/implementation-status.md §Feature 3` (README row) + PRD §5.1 (style layer) + PRD §5.4
> (`hack update`). **Sibling S1 (P1.M3.T1.S1, COMPLETE)** owns `docs/CONFIGURATION.md` only (its
> commit rows + `### \`hack update\`` subsection are LANDED → cross-link anchors are verified stable);
> **sibling S2 (P1.M3.T1.S2, parallel)** owns `docs/ARCHITECTURE.md` only. This task cross-references
> CONFIGURATION.md, NEVER duplicates it. Single-file scope: `git diff --name-only` ⇒ exactly `README.md`.

---

## Goal

**Feature Goal**: Bring `README.md` (the project's front-door overview) into alignment with the two shipped
Delta-012 features so a reader discovers, from the README alone, (a) that `hack update <task-id> <status>`
manually rewrites a task's status with fuzzy-matched ID + status, downward `Complete` cascade, bottom-up
min-status ancestor recompute, and lock-serialized atomic writes; and (b) that a generated commit message
is governed by an orthogonal **style layer** (`PRP_COMMIT_STYLE` `auto`/`plain`/`conventional`/`gitmoji`)
alongside the existing **position layer** (`PRP_COMMIT_FORMAT`), with both rows linking to the detailed
CONFIGURATION.md reference.

**Deliverable**: An edited `README.md` (and ONLY that file) containing:
1. **Edit (a)** — `update` added to the subcommand enumeration list at L114–115
   (`… validate-state`, `config`, and now `update …`).
2. **Edit (b)** — a new `### Manual Status Update (hack update)` subsection inserted AFTER the
   `### Task Status (hack status / hack task)` block (after L310) and BEFORE `### Resume Interrupted
   Session` (L312): a prose intro + a ```bash block of 5 example invocations + a callout linking to
   CONFIGURATION.md's Task & Status Commands section.
3. **Edit (c)** — in the Environment Variables table (L386–398): the `PRP_COMMIT_FORMAT` row's Description
   reworded to name it the position layer (orthogonal to the style layer), PLUS two new rows
   (`PRP_COMMIT_STYLE`, `PRP_COMMIT_STYLE_EXAMPLES`), each linking to
   `docs/CONFIGURATION.md#resilience-tuning`.

**Success Definition**:
- `README.md` lists `update` among the `hack` subcommands that resolve the repo root (L114–115).
- `README.md` has a `### Manual Status Update (hack update)` subsection whose prose covers fuzzy ID +
  status matching, downward `Complete` cascade, bottom-up ancestor recompute, and lock-serialized atomic
  write, with a ```bash block and a CONFIGURATION.md cross-link.
- The `PRP_COMMIT_FORMAT` env-var row names the orthogonal style layer; `PRP_COMMIT_STYLE` and
  `PRP_COMMIT_STYLE_EXAMPLES` rows are present and link to `docs/CONFIGURATION.md#resilience-tuning`.
- `npm run format:check` passes on `README.md` (run `npm run format` first to normalize table reflow).
- `git diff --name-only` lists EXACTLY `README.md` — no `src/`, no `CONFIGURATION.md` (S1), no
  `ARCHITECTURE.md` (S2), no `PRD.md`.

---

## User Persona (if applicable)

**Target User**: New user / contributor / maintainer reading `README.md` to learn the `hack` CLI surface
and the commit-message configurability.

**Use Case**: "What `hack` subcommands exist?" (discover `hack update`) and "Can I make the auto-commits
match my project's commit style (Conventional Commits / gitmoji)?" (discover `PRP_COMMIT_STYLE`).

**User Journey**: User opens README → in "Running from Anywhere" sees `update` listed → in the Usage
Examples area finds the `### Manual Status Update` subsection with copy-pasteable examples → in the
Configuration → Environment Variables table sees the three commit rows (position + style + examples) and
clicks through to CONFIGURATION.md for detail.

**Pain Points Addressed**: The README currently hides `hack update` (only documented in CONFIGURATION.md)
and implies commits are governed by a single position layer (`PRP_COMMIT_FORMAT`); a front-door reader
cannot discover the manual status-override command or the style configurability.

---

## Why

- **Mode B docs must reflect shipped features at the front door.** The style layer (`PRP_COMMIT_STYLE`,
  P1.M1.*) and `hack update` (P1.M2.*) are real, configurable, user-facing surfaces. `README.md` is the
  first doc a user/contributor reads; it currently documents only the position layer (one env-var row at
  L398) and is silent on `hack update`. This task closes that gap so the README matches the shipped system.
- **README is a pointer, not the spec.** The README's env-var table is deliberately terse (one-line
  descriptions that link out to `docs/CONFIGURATION.md` for detail). This task keeps that style: the new
  rows are short and link to CONFIGURATION.md; the new `hack update` subsection gives copy-pasteable
  examples + a behavior summary + a cross-link. The DETAILED two-layer model is S2's ARCHITECTURE.md job;
  the full env-var/`.hack` reference + `hack update` syntax table is S1's CONFIGURATION.md job. README
  complements, never duplicates.
- **`hack update` belongs in two lists.** It is a `hack` subcommand like `task`/`status`, so it belongs in
  the "Running from Anywhere" enumeration (it resolves the repo root identically). It is also a user-facing
  command, so it deserves a Usage Examples subsection modeled on the `hack status`/`hack task` block.
- **Single-file scope, no code/test risk.** This task owns ONLY `README.md`. It cannot break the build or
  the (pre-existing-red) test suite; the gate is prettier + content greps.

---

## What

### User-visible behavior
None beyond the docs. Observable change: `README.md` gains one word in a list (L114–115), one new `###`
subsection (after L310), and two new table rows + one reworded row (L398).

### Technical requirements (exact contract)

**Edit (a) — add `update` to the subcommand enumeration (L114–115).** The current sentence:

> `This applies to **every** subcommand — `task`, `status`, `cache`, `inspect`, `artifacts`,
> `validate-state`, and `config` — not just the default pipeline run, …`

becomes (add `update` — keep alphabetical-ish/grouped ordering consistent with how the list reads; place it
after `status` since it is a task/status-family command):

> `This applies to **every** subcommand — `task`, `status`, `update`, `cache`, `inspect`, `artifacts`,
> `validate-state`, and `config` — not just the default pipeline run, …`

(One-token insertion; the sentence's grammar and the `— not just …` tail are UNCHANGED.)

**Edit (b) — NEW `### Manual Status Update (hack update)` subsection** inserted AFTER the
`### Task Status (hack status / hack task)` block (after its breakdown-in-progress callout ends ~L310) and
BEFORE `### Resume Interrupted Session` (L312). Verbatim new content (let `npm run format` normalize prose
line wrapping):

```markdown
### Manual Status Update (`hack update`)

`hack update <task-id> <status>` (PRD §5.4) manually rewrites a task item's status from the command line,
with **both** the task ID and the target status **fuzzy-matched**: canonical (`P1.M1.T1.S1`),
concatenated (`p1m1t1s1`), and numeric (`1.1.1.1`, `1.2`) IDs all resolve (trailing segments optional →
Phase/Milestone/Task/Subtask), and statuses accept synonyms (`done`, `re`, `comp`), canonical words,
prefixes, and substrings (`r` is ambiguous → Ready/Researching). Setting a parent `Complete` **cascades
`Complete` down** to every descendant; after any change every ancestor **recomputes bottom-up** to the
least-progressed child, so marking the last subtask `Complete` promotes its Task/Milestone/Phase and
resetting a subtask back to `Planned` drops its ancestors accordingly. It is the write-side counterpart to
the read-only `hack status` / `hack task` above.

```bash
hack update P1.M1.T1.S1 ready        # full canonical form
hack update p1m1t1s1 ready           # concatenated, case-insensitive
hack update 1.1.1.1 re               # numeric form + synonym status
hack update 1.2 done                 # milestone + synonym status
hack update 2 comp                   # phase + prefix status
```

> The command is a serialized, lock-guarded, atomic read-modify-write under the same `tasks.json.lock` as
> the orchestrator (PRD §5.1, §5.4) — it can neither corrupt `tasks.json` nor race a concurrent writer. See
> [Configuration → Task & Status Commands](docs/CONFIGURATION.md#task--status-commands) for the full syntax
> (loose-ID normalization, the status synonym/prefix/substring table, and the cascade/ancestor-recompute
> rules).
```

**Edit (c) — extend the commit rows in the Environment Variables table (L398).** The current single row:

```
| `PRP_COMMIT_FORMAT`    | No       | `task-prefix`                    | `task-prefix`/`plain`: [Config](docs/CONFIGURATION.md#resilience-tuning)       |
```

is replaced by THREE rows (tweak `PRP_COMMIT_FORMAT`'s Description to name the position layer + orthogonality,
and add `PRP_COMMIT_STYLE` + `PRP_COMMIT_STYLE_EXAMPLES`). Verbatim new rows (4 columns each; prettier
reflows column widths — do NOT hand-pad):

```
| `PRP_COMMIT_FORMAT`        | No  | `task-prefix` | **Position layer** — `task-prefix` (`<phase>.<milestone>.<task>.<subtask>:`) or `plain`. Orthogonal to `PRP_COMMIT_STYLE`. [Config](docs/CONFIGURATION.md#resilience-tuning) |
| `PRP_COMMIT_STYLE`         | No  | `auto`        | **Style layer** for the descriptive message `stagecoach` writes — `auto` (learn from history), `plain`, `conventional`, or `gitmoji`. [Config](docs/CONFIGURATION.md#resilience-tuning) |
| `PRP_COMMIT_STYLE_EXAMPLES`| No  | `5`           | Commits sent as style examples under `auto`; `0` disables learning (degrades to `plain`). [Config](docs/CONFIGURATION.md#resilience-tuning) |
```

The table's 4-column header (`Variable | Required | Default | Description`) and all other rows are
UNCHANGED; the deprecation `>` callout that follows the table (L400) is UNCHANGED.

### Success Criteria
- [ ] `README.md` L114–115 enumeration includes `update` (one-token add; sentence otherwise unchanged).
- [ ] A `### Manual Status Update (hack update)` subsection exists after `### Task Status (hack status /
      hack task)` and before `### Resume Interrupted Session`.
- [ ] The subsection prose covers fuzzy ID + status matching, downward `Complete` cascade, bottom-up
      ancestor recompute, and lock-serialized atomic write; has a 5-command ```bash block; cross-links to
      `docs/CONFIGURATION.md#task--status-commands`.
- [ ] The env-var table has `PRP_COMMIT_FORMAT` (reworded to "position layer" + orthogonal note),
      `PRP_COMMIT_STYLE`, and `PRP_COMMIT_STYLE_EXAMPLES` rows, each linking to
      `docs/CONFIGURATION.md#resilience-tuning`.
- [ ] `npm run format:check` passes on `README.md` (run `npm run format` first).
- [ ] `git diff --name-only` ⇒ exactly `README.md`.

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_ **Yes** — the three exact
edit sites (L114–115 one-token add; insert a subsection between L310 and L312; replace the L398 table row
with 3 rows) with the verbatim old + new markdown, the verified stable cross-link anchors (S1 LANDED), the
shipped-feature confirmation (grep-verified symbols), the prettier-only gate (markdownlint does not cover
root README), and the hard sibling boundary (S1=CONFIGURATION.md, S2=ARCHITECTURE.md). See
`research/01-readme-facts.md` for per-claim evidence.

### Documentation & References
```yaml
# MUST READ — the authoritative Mode B doc map (README row)
- docfile: plan/012_7dd502f7feb9/architecture/implementation-status.md
  section: "Feature 3 — Cross-cutting documentation (Mode B)"
  why: Maps the Mode B doc work: README.md ← "hack update in commands list; style layer in commit-behavior
       section". Gives the exact two surface areas to touch.
  critical: This task = the README.md row. CONFIGURATION.md is S1 (DONE); ARCHITECTURE.md is S2 (parallel).

# MUST READ — PRD §5.4 (hack update contract) — provided in selected_prd_content
- file: PRD.md
  section: "5.4 Manual Status Updates (hack update)"
  why: Command surface, fuzzy ID + status matching, cascade (downward Complete; bottom-up min recompute with
       Failed/Obsolete rules), lock-serialized atomic write, output format. The subsection summarizes these.
  critical: `r` is ambiguous (Ready/Researching); the command is a WRITE (serialized under tasks.json.lock).

# MUST READ — PRD §5.1 (style layer contract) — provided in selected_prd_content
- file: PRD.md
  section: "5.1 Commit Message Format → 'Commit Message Style (Learning & Explicit Modes)'"
  why: Two orthogonal layers (position + style); PRP_COMMIT_STYLE auto/plain/conventional/gitmoji; auto learns
       from last PRP_COMMIT_STYLE_EXAMPLES (default 5); EXAMPLES=0 → plain. The env-var rows are the terse
       README rendering of this.
  critical: README rows are TERSE — link out to CONFIGURATION.md; do NOT restate the full two-layer model
            (that is S2 ARCHITECTURE.md's job).

# THE FILE TO EDIT (the only file) — 3 localized edits
- file: README.md
  why: EDIT. (a) L114-115 subcommand list: add `update`. (b) insert `### Manual Status Update (hack update)`
       subsection between the Task Status block (ends ~L310) and `### Resume Interrupted Session` (L312).
       (c) L398 env-var table: reword PRP_COMMIT_FORMAT row + add PRP_COMMIT_STYLE + PRP_COMMIT_STYLE_EXAMPLES.
  pattern_subsection: "mirror the existing `### Task Status (hack status / hack task)` block (L284-310):
       prose intro → ```bash block → `>` callout with a CONFIGURATION.md cross-link)."
  pattern_table: "the Environment Variables table (L386-398) is 4 columns: Variable | Required | Default |
       Description. Each commit row's Description ends with a `[Config](docs/CONFIGURATION.md#...)` link.
       prettier reflows column widths — do NOT hand-pad."
  critical: PRESERVE the L400 deprecation `>` callout that follows the env-var table, the table header row,
            and ALL other table rows. PRESERVE the L312 `### Resume Interrupted Session` heading (insert ABOVE
            it, do not move it).

# CROSS-LINK TARGETS (verified stable — S1 LANDED)
- file: docs/CONFIGURATION.md
  why: READ-ONLY. The `### Resilience Tuning` section (L241) holds all 3 commit rows (L255-257) → anchor
       `#resilience-tuning` is STABLE. The `## Task & Status Commands` section (L807) holds S1's
       `### \`hack update\` — manual status updates (PRD §5.4)` subsection (L828) → use the SECTION anchor
       `#task--status-commands` (NOT the fragile heading anchor with backticks/parens/§).
  critical: Link to `#resilience-tuning` for the commit flags and `#task--status-commands` for hack-update
            syntax. Do NOT use the `### \`hack update\` …` heading anchor (brittle).

# SHIPPED SOURCE (read-only — confirms the prose names real symbols; do NOT edit)
- file: src/config/constants.ts
  why: PRP_COMMIT_STYLE (L796) / DEFAULT_PRP_COMMIT_STYLE='auto' (L814) / PrpCommitStyle union (L828, the 4
       modes) / getPrpCommitStyle() (case-INSENSITIVE); PRP_COMMIT_STYLE_EXAMPLES / DEFAULT=5. Confirms the
       row text names real env vars + defaults.
- file: src/cli/index.ts + src/utils/task-utils.ts
  why: .command('update') (cli L1040) → updateAction (L907); normalizeTaskId/findItemByLooseId/matchStatus/
       cascadeCompleteDown/recomputeAncestorsUp (task-utils). Confirms hack update + cascade/lock shipped.
- file: src/agents/commit-message-agent.ts + src/utils/git-commit.ts
  why: buildCommitMessageSystemPrompt(style, examples?) (L303) + generateCommitMessage resolves style →
       getRecentCommitMessages under auto → formatCommitMessage wraps position AFTER. Confirms two-layer
       ordering + the auto history-learning the rows describe.

# SIBLING CONTRACT (S1 — P1.M3.T1.S1, COMPLETE; do NOT duplicate; cross-reference only)
- docfile: plan/012_7dd502f7feb9/P1M3T1S1/PRP.md
  why: S1 edited ONLY docs/CONFIGURATION.md: the 3 commit rows in `### Resilience Tuning`, the two `.hack`
       `[pipeline]` keys (commit_style, commit_style_examples) in the schema-summary, and the
       `### \`hack update\`` subsection under `## Task & Status Commands`. This task's README rows/subsection
       are the front-door counterpart: link to CONFIGURATION.md instead of restating the detail.
  critical: ZERO file overlap (S1=CONFIGURATION.md, S3=README.md). Use the verified anchors
            (#resilience-tuning, #task--status-commands).

# SIBLING CONTRACT (S2 — P1.M3.T1.S2, parallel; do NOT touch)
- docfile: plan/012_7dd502f7feb9/P1M3T1S2/PRP.md
  why: S2 edits ONLY docs/ARCHITECTURE.md: the two-layer commit model + a hack-update short note. README does
       NOT duplicate the two-layer PROSE — it keeps the env-var rows terse and links out. Do NOT edit
       ARCHITECTURE.md here.

# OUT OF SCOPE (hard boundary — DO NOT touch in S3)
- file: docs/CONFIGURATION.md     # S1 (DONE)
- file: docs/ARCHITECTURE.md      # S2 (parallel)
- file: docs/CLI_REFERENCE.md     # NOT in the Feature 3 table; item names README only
- file: PRD.md, PROMPTS.md, tasks.json, prd_snapshot.md, any src/ or tests/   # never
```

### Current Codebase tree (relevant slice)
```bash
README.md                                  # EDIT (only file): 3 localized edits (L114-115 word; +1 subsection ~L310; L398 table row → 3 rows)
docs/CONFIGURATION.md                      # READ-ONLY (S1 DONE): cross-link targets (#resilience-tuning, #task--status-commands)
docs/ARCHITECTURE.md                       # READ-ONLY (S2 parallel): owns the two-layer model prose
plan/012_7dd502f7feb9/architecture/implementation-status.md  # READ-ONLY: Feature 3 doc map
PRD.md                                     # READ-ONLY: §5.1 (style) + §5.4 (hack update) contract
src/config/constants.ts                    # READ-ONLY: confirms PRP_COMMIT_STYLE symbols + defaults
src/cli/index.ts + src/utils/task-utils.ts # READ-ONLY: confirms hack update + cascade shipped
src/agents/commit-message-agent.ts + src/utils/git-commit.ts  # READ-ONLY: confirms two-layer ordering
```

### Desired Codebase tree with files to be added/edited
```bash
README.md                                  # MODIFIED (+1 word in subcommand list; +1 ### subsection; L398 row → 3 rows)
# (no new files; no src/; no tests; no other docs)
```

### Known Gotchas of our codebase & Library Quirks
```markdown
<!-- CRITICAL — Single-file scope. Edit ONLY README.md. Do NOT touch docs/CONFIGURATION.md (S1),
     docs/ARCHITECTURE.md (S2), docs/CLI_REFERENCE.md, PRD.md, PROMPTS.md, any src/, or any test.
     git diff --name-only must list exactly one file. -->

<!-- CRITICAL — Use the verified STABLE anchors for the CONFIGURATION.md cross-links:
     - commit flags → docs/CONFIGURATION.md#resilience-tuning (S1's section at L241 holds all 3 commit rows).
     - hack-update syntax → docs/CONFIGURATION.md#task--status-commands (the ## Task & Status Commands
       section at L807 holds S1's ### `hack update` subsection at L828).
     Do NOT use the `### \`hack update\` — manual status updates (PRD §5.4)` HEADING anchor — backticks,
     parens, and § make it brittle. The section anchor is stable and contains the subsection. -->

<!-- CRITICAL — Edit (c) is a REPLACE of the L398 row, not an append-and-leave. The old single PRP_COMMIT_FORMAT
     row's description ("`task-prefix`/`plain`: [Config]…") must be REPLACED by the reworded "position layer"
     row + the two new style rows, so the table does not duplicate/contradict itself. -->

<!-- GOTCHA — prettier (npm run format) WILL reflow the env-var table's column widths when the new long
     Descriptions are added (the existing table is hand-padded to ~80-char columns). That is EXPECTED — run
     `npm run format` FIRST (write), then `npm run format:check`. Do NOT hand-pad the new rows; let prettier
     align them. -->

<!-- GOTCHA — `npm run docs:lint` (markdownlint "docs/**/*.md") does NOT cover README.md (repo root). So
     markdownlint is NOT a gate for README — prettier (format/format:check, glob "**/*.md") is. BUT keep the
     .markdownlint.json conventions for consistency (blank lines around the ```bash block and around the table
     — MD031/MD032; the existing README already fences these; MD024 siblings_only is satisfied because the
     new `### Manual Status Update (hack update)` heading is unique among the L284-312 siblings). -->

<!-- CRITICAL — Do NOT duplicate the full two-layer PROSE in README. The README env-var rows are deliberately
     terse (one-line description + link out). The DETAILED two-layer model is S2 ARCHITECTURE.md's job; the
     full env-var/`.hack` reference + `hack update` syntax TABLE is S1 CONFIGURATION.md's job. README
     complements, never duplicates. -->

<!-- GOTCHA — Edit (b) insertion point: insert the new ### subsection AFTER the `### Task Status (hack status
     / hack task)` block (which ends with its breakdown-in-progress `>` callout ~L310) and BEFORE the
     `### Resume Interrupted Session` heading (L312). Preserve a blank line before and after the new
     subsection (MD031). Do NOT move or rename `### Resume Interrupted Session`. -->

<!-- GOTCHA — The pre-existing `npm run test:run` is RED (BUG-004, unrelated) and typecheck/lint are src-only.
     This task's gate is format/format:check on README.md + grep/git-diff checks. Do NOT gate on test:run /
     typecheck / lint. -->

<!-- CRITICAL — Describe the features as SHIPPED (they are — verified in src/). Use present tense
     ("rewrites", "cascades", "learns", "governs"), not "will"/"should". The README records the as-built system. -->
```

---

## Implementation Blueprint

### Data models and structure
None — this is a documentation edit. The "model" is: `hack update` (a CLI subcommand) rendered as a Usage
subsection, and the commit configurability rendered as three terse env-var table rows (position + style +
examples) that link out to CONFIGURATION.md.

### Implementation Tasks (ordered; each leaves the doc prettier-clean)
```yaml
Task 1: EDIT README.md — Edit (a): add `update` to the subcommand enumeration (L114-115)
  - LOCATE the sentence at L114-115: "This applies to **every** subcommand — `task`, `status`, `cache`,
    `inspect`, `artifacts`, `validate-state`, and `config` — not just the default pipeline run, …"
  - INSERT `update` after `status` (it is a task/status-family command, grouped with status): →
    "… — `task`, `status`, `update`, `cache`, `inspect`, `artifacts`, `validate-state`, and `config` — …"
  - One-token insertion; the sentence's grammar and the "— not just …" tail are UNCHANGED.
  - VERIFY: `npm run format:check` passes (a word in prose — no reflow expected).

Task 2: EDIT README.md — Edit (b): insert the `### Manual Status Update (hack update)` subsection
  - LOCATE the end of the `### Task Status (hack status / hack task)` block (its breakdown-in-progress `>`
    callout ends ~L310) and the `### Resume Interrupted Session` heading (L312).
  - INSERT (between L310 and L312, with blank lines fencing it — MD031) the new `### Manual Status Update
    (\`hack update\`)` subsection: prose intro + 5-command ```bash block + the lock/cross-link `>` callout.
    Use the verbatim markdown in "Technical requirements (Edit b)".
  - PRESERVE the `### Resume Interrupted Session` heading and everything after it UNCHANGED.
  - VERIFY: `npm run format:check` passes (the ```bash block must be blank-line fenced).

Task 3: EDIT README.md — Edit (c): extend the commit rows in the Environment Variables table (L398)
  - LOCATE the single `PRP_COMMIT_FORMAT` row at L398 (the last data row of the L386-398 table, immediately
    before the L400 deprecation `>` callout).
  - REPLACE that one row with THREE rows (reworded `PRP_COMMIT_FORMAT` "position layer" + new
    `PRP_COMMIT_STYLE` + new `PRP_COMMIT_STYLE_EXAMPLES`), each with a `[Config](docs/CONFIGURATION.md#resilience-tuning)`
    link. Use the verbatim markdown in "Technical requirements (Edit c)".
  - PRESERVE the table header row, ALL other table rows, and the L400 deprecation `>` callout UNCHANGED.
  - DO NOT hand-pad column widths — prettier reflows them in Task 4.
  - VERIFY: the table still has exactly 4 columns (Variable | Required | Default | Description) on every row.

Task 4: FORMAT + VERIFY
  - RUN: npm run format              # prettier --write (reflows the env-var table column widths — EXPECTED)
  - RUN: npm run format:check        # prettier --check — must pass
  - GREP checks (see Validation Loop Level 3).
  - RUN: git diff --name-only        # MUST list exactly "README.md"
  - DO NOT run `npm run docs:lint` as a gate (it globs docs/**, NOT root README). DO NOT run
    `npm run test:run` / `npm run typecheck` / `npm run lint` (src-only / pre-existing-red).
  - EXPECTED: format:check clean; greps hit; single-file diff. If format:check fails → re-run `npm run format`
    (write) then format:check (the table reflow is the only likely diff).
```

### Implementation Patterns & Key Details
```markdown
<!-- Edit (a) — one-token add in a prose enumeration; preserves the list's backtick-code-span style
     (`update` in backticks) and the sentence's em-dash structure. -->

<!-- Edit (b) — the new subsection mirrors the existing `### Task Status (hack status / hack task)` shape:
     1) a prose intro that names the command + the fuzzy-matching + cascade behavior; 2) a ```bash block of
     copy-pasteable examples (use the PRD §5.4 example set verbatim); 3) a `>` callout with the
     lock-serialized-atomic-write guarantee + the CONFIGURATION.md cross-link (section anchor
     #task--status-commands). Bold the key terms (cascades Complete down; recomputes bottom-up) to match the
     README's bold-term prose density. -->

<!-- Edit (c) — the three table rows are TERSE (one-line Description each + a #resilience-tuning link). The
     reworded PRP_COMMIT_FORMAT row leads with "**Position layer**" and ends with "Orthogonal to
     `PRP_COMMIT_STYLE`." to surface the two-layer relationship at a glance; the PRP_COMMIT_STYLE row leads
     with "**Style layer**" and lists the 4 modes. prettier owns the column alignment. -->
```

### Integration Points
```yaml
README.MD (the only edit):
  - Edit (a): +`update` in the ## Running from Anywhere subcommand enumeration (L114-115).
  - Edit (b): +`### Manual Status Update (hack update)` subsection (after the Task Status block, before
    ### Resume Interrupted Session).
  - Edit (c): L398 PRP_COMMIT_FORMAT row → reworded + 2 new rows (PRP_COMMIT_STYLE, PRP_COMMIT_STYLE_EXAMPLES).
  - PRESERVE: the table header + all other table rows + the L400 deprecation callout; the ### Resume
    Interrupted Session heading; every other section.

DOCS/CONFIGURATION.MD (S1 owns — DO NOT EDIT):
  - Cross-reference target only. Anchors #resilience-tuning (commit rows) + #task--status-commands
    (hack-update subsection) are STABLE (S1 LANDED).

DOCS/ARCHITECTURE.MD (S2 owns — DO NOT EDIT):
  - Owns the detailed two-layer model prose + hack-update short note. README does NOT duplicate it.

DOCS/CLI_REFERENCE.MD (NOT in scope):
  - The Feature 3 table names README only; CLI_REFERENCE.md is untouched (and may already cover hack update
    via the general CLI docs — out of scope here).

NO CODE / NO TESTS:
  - src/, tests/, lib/, plugin/ are UNTOUCHED. The vitest 100%-coverage gate and the pre-existing-red
    test:run are irrelevant to a .md edit; the gate is format/format:check + content greps.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
npm run format              # prettier --write "**/*.{...,md,...}" — normalizes the new subsection + table reflow (run FIRST)
npm run format:check        # prettier --check — must pass
# Expected: format:check clean. Likely failure:
#   - prettier reflow diff on the env-var table (the new long Descriptions widen the columns) → run
#     `npm run format` (write) first; it owns the column alignment.
# NOTE: `npm run docs:lint` (markdownlint "docs/**/*.md") does NOT cover root README.md — it is NOT a gate.
#       The blank-line fencing around the ```bash block + the table already satisfies MD031/MD032 by
#       construction (mirror the existing Task Status block's fencing).
```

### Level 2: Unit Tests (Component Validation)
```bash
# N/A — this is a markdown documentation edit. There is no test suite for README.md.
# (Do NOT run `npm run test:run` — it is pre-existing-red (BUG-004) and unrelated to a .md change.)
```

### Level 3: Integration / Regression (System Validation)
```bash
# Edit (a) — `update` added to the subcommand enumeration:
grep -n "\`update\`" README.md                                              # expect ≥1 (the L114-115 enumeration; may also hit the new subsection)
grep -n "task\`, \`status\`, \`update\`" README.md                           # expect 1 (the Running from Anywhere sentence)
# Edit (b) — the hack update subsection landed:
grep -n "### Manual Status Update" README.md                                # expect 1 (new subsection heading, unique sibling)
grep -n "hack update P1.M1.T1.S1 ready" README.md                           # expect 1 (the ```bash example)
grep -n "cascades" README.md                                                # expect ≥1 (the cascade sentence)
grep -n "task--status-commands" README.md                                   # expect 1 (the cross-link to CONFIGURATION.md)
# Edit (c) — the three commit rows landed + the old single description gone:
grep -n "PRP_COMMIT_STYLE" README.md                                        # expect ≥1 (the new style row)
grep -n "PRP_COMMIT_STYLE_EXAMPLES" README.md                               # expect 1 (the new examples row)
grep -n "Position layer\|Style layer" README.md                             # expect ≥2 (the bolded layer leads)
grep -n "Orthogonal to \`PRP_COMMIT_STYLE\`" README.md                      # expect 1 (the orthogonality note)
grep -n "resilience-tuning" README.md                                       # expect ≥3 (3 commit rows; may also hit L191/L398-area)
# Single-file scope:
git diff --name-only                                                        # MUST list exactly "README.md"
# Expected: every grep returns its expected hit count; the subsection + 3 rows present; the cross-links use
#   the stable section anchors; diff is exactly one file.
```

### Level 4: Creative & Domain-Specific Validation
```bash
# Rendered-markdown sanity (no tool required — visual/mental check; record observations in the commit msg):
#   1. Edit (a): the "Running from Anywhere" sentence reads naturally with `update` inserted after `status`;
#      the em-dash list still parses.
#   2. Edit (b): the new `### Manual Status Update (hack update)` subsection renders with a prose intro, a
#      fenced ```bash block (5 commands with `# comment` annotations), and a `>` callout. The cascade rule is
#      accurate (downward Complete; bottom-up MIN with Failed-excluded-unless-all-Failed + Obsolete-terminal).
#      The cross-link resolves to CONFIGURATION.md's Task & Status Commands section (which contains S1's
#      `### \`hack update\`` subsection).
#   3. Edit (c): the env-var table renders with 4 aligned columns; the PRP_COMMIT_FORMAT row is labeled
#      "Position layer" and notes orthogonality; the PRP_COMMIT_STYLE row lists the 4 modes; the
#      PRP_COMMIT_STYLE_EXAMPLES row notes `0` disables learning. Each row's `[Config]` link resolves to
#      CONFIGURATION.md#resilience-tuning.
#   4. The README still reads as as-built (present tense, no "will/should" hedging) and does NOT duplicate the
#      detailed two-layer prose (it links out).
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run format:check` passes on `README.md` (run `npm run format` first).
- [ ] `git diff --name-only` ⇒ exactly `README.md`.

### Feature Validation
- [ ] `update` appears in the `## Running from Anywhere` subcommand enumeration (L114–115).
- [ ] `### Manual Status Update (hack update)` subsection exists between `### Task Status` and `### Resume Interrupted Session`.
- [ ] Subsection covers fuzzy ID+status matching, downward `Complete` cascade, bottom-up min-status ancestor recompute, lock-serialized atomic write.
- [ ] Subsection has a 5-command ```bash block + a `>` callout cross-linking to `docs/CONFIGURATION.md#task--status-commands`.
- [ ] Env-var table has `PRP_COMMIT_FORMAT` (reworded "Position layer" + orthogonal note), `PRP_COMMIT_STYLE`, `PRP_COMMIT_STYLE_EXAMPLES` rows, each linking to `docs/CONFIGURATION.md#resilience-tuning`.

### Code Quality Validation
- [ ] Markdown follows the README's existing conventions (backticked code-spans/IDs, bold key terms, `PRD §X` citations, terse one-line table Descriptions that link out).
- [ ] New `###` heading is unique among siblings (MD024 `siblings_only`).
- [ ] ```bash block and table are blank-line fenced (MD031/MD032) — mirroring the existing Task Status block.
- [ ] The L400 deprecation `>` callout, the table header, all other table rows, the `### Resume Interrupted Session` heading, and all unrelated content are UNCHANGED.
- [ ] Only `README.md` modified.

### Documentation & Deployment
- [ ] Describes features as SHIPPED (present tense; verified in `src/`).
- [ ] Cross-references CONFIGURATION.md (S1) for the full commit-flag/`.hack` reference + hack-update syntax — no duplication.
- [ ] Commit message records: P1.M3.T1.S3; Mode B doc sync; the 3 edits (subcommand-list word, +1 subsection, L398 row → 3 rows); the source-of-truth (implementation-status.md §Feature 3 README row + PRD §5.1/§5.4); the S1/S2 file-ownership boundary; the stable cross-link anchors (#resilience-tuning, #task--status-commands); the prettier-only gate.
---

## Anti-Patterns to Avoid

- ❌ Don't edit any file other than `README.md`. S1 owns `CONFIGURATION.md` (DONE), S2 owns `ARCHITECTURE.md`
      (parallel); `CLI_REFERENCE.md`, `PRD.md`, `PROMPTS.md`, `src/`, `tests/` are all off-limits.
      `git diff --name-only` must be one file.
- ❌ Don't APPEND a new `PRP_COMMIT_STYLE` row and leave the old `PRP_COMMIT_FORMAT` description untouched.
      Edit (c) is a **REPLACE** of the L398 row — reword it to "Position layer" + add the 2 style rows — so
      the table surfaces the two-layer relationship rather than implying `PRP_COMMIT_FORMAT` is the whole story.
- ❌ Don't restate the full two-layer PROSE in README. The README env-var rows are deliberately terse; the
      detailed two-layer model is S2 ARCHITECTURE.md's job and the full flag reference is S1 CONFIGURATION.md's
      job. Keep README rows one-line + link out.
- ❌ Don't restate the full `hack update` CLI syntax TABLE in README. Give copy-pasteable examples + a behavior
      summary + a CONFIGURATION.md cross-link (the syntax table is S1's job). Keep the subsection focused.
- ❌ Don't use the fragile `### \`hack update\` — manual status updates (PRD §5.4)` HEADING anchor for the
      CONFIGURATION.md cross-link (backticks/parens/§ make it brittle). Use the STABLE section anchor
      `#task--status-commands` (and `#resilience-tuning` for the commit flags).
- ❌ Don't hand-pad the env-var table column widths. The new long Descriptions will reflow under prettier —
      run `npm run format` (write) first; let prettier own the alignment.
- ❌ Don't forget the blank lines around the new ```bash block (MD031). Mirror the existing Task Status
      block's fencing (blank line before ```bash and after the closing ```).
- ❌ Don't reuse an existing `###` heading text (MD024 `siblings_only`). `### Manual Status Update
      (hack update)` is unique among the L284–312 siblings — keep it.
- ❌ Don't gate on `npm run docs:lint` / `test:run` / `typecheck` / `lint`. `docs:lint` globs `docs/**`
      (not root README); the others are src-only or pre-existing-red. The gate is `format`/`format:check` +
      the content greps.
- ❌ Don't hedge with "will"/"should". Both features are shipped — write present-tense as-built prose
      ("rewrites", "cascades", "learns", "governs").
- ❌ Don't describe `PRP_COMMIT_FORMAT` as new. It is the UNCHANGED position layer (just reworded in README
      to name the orthogonality); only `PRP_COMMIT_STYLE` is the new surface. Mixing them up is the core
      conceptual error this edit exists to prevent.

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: This is a small, fully-specified, single-file documentation edit. All three edit sites are verified
against the working tree (L114–115 one-token add; insert a subsection between the verified L310 Task Status
block end and the L312 Resume heading; replace the verified L398 table row with 3 rows). Both features are
**confirmed shipped** in `src/` (constants.ts, cli/index.ts, task-utils.ts, commit-message-agent.ts,
git-commit.ts all grep-verified), so the prose describes real surfaces — no guessing. Critically, **S1 is
COMPLETE**, so the two cross-link targets are **verified present and stable**
(`#resilience-tuning` holds all 3 commit rows at CONFIGURATION.md L241/L255–257; `#task--status-commands`
holds the `### \`hack update\`` subsection at L807/L828) — no fragile anchors. The verbatim new markdown
(the subsection + 5-example ```bash block + callout + the 3 terse table rows) is supplied in full, matching
the README's existing prose density/style and the authoritative PRD §5.1 / §5.4 contracts. The non-obvious
risks are all enumerated and mitigated: (a) prettier reflows the env-var table (run `npm run format` first);
(b) markdownlint does NOT gate root README (prettier does); (c) the REPLACE-not-append semantics for L398;
(d) the stable section anchors (avoiding the brittle heading anchor); (e) not duplicating the two-layer
prose (S2 owns it); (f) the S1/S2 file-ownership boundary (one-file diff); (g) MD024 heading uniqueness
(the new heading is unique). No code/test/build unknowns. Residual risks: a prettier reflow on the table
(normalized via `npm run format`) and the rare chance a maintainer runs markdownlint on root README manually
(the blank-line fencing + unique heading satisfy it by construction). The Mode B doc-sync is conceptually
simple and the content is prescribed verbatim.