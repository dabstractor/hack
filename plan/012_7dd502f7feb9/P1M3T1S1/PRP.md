# PRP — P1.M3.T1.S1: Update docs/CONFIGURATION.md — commit-style env vars, .hack keys, hack update

> Delta 012, **P1.M3.T1.S1 — Mode B changeset-level documentation sync into `docs/CONFIGURATION.md`
> ONLY**. The two features shipped: (Feature 1) the commit-message **style layer** (PRD §5.1) —
> `PRP_COMMIT_STYLE` + `PRP_COMMIT_STYLE_EXAMPLES` env vars + the `[pipeline] commit_style` /
> `commit_style_examples` `.hack` keys (P1.M1.* Complete); (Feature 2) the **`hack update`**
> manual-status-update command (PRD §5.4 — P1.M2.T1–T3 Complete, P1.M2.T4.S1 in-flight). This task
> documents both into the single file `docs/CONFIGURATION.md` across three zones: the `.hack`
> schema-summary table, the commit env-var table, and a new `### hack update` subsection. **No `src/`,
> no tests — documentation only.** Sibling Mode B tasks P1.M3.T1.S2 (docs/ARCHITECTURE.md) and
> P1.M3.T1.S3 (README.md) own the OTHER docs.

---

## Goal

**Feature Goal**: Bring `docs/CONFIGURATION.md` into alignment with the two Delta-012 features so a
user can discover + configure the commit-message style layer (`PRP_COMMIT_STYLE` /
`PRP_COMMIT_STYLE_EXAMPLES` env vars + `[pipeline] commit_style` / `commit_style_examples` `.hack`
keys) and learn + use the `hack update` manual-status-update command — all from this single
configuration reference, consistent with PRD §5.1 / §5.4 / §9.2.2 / §9.7.5.

**Deliverable** (one file, three zones — all additive):
1. **`docs/CONFIGURATION.md` — Zone A (env-var table, ~L255):** INSERT two new rows
   (`PRP_COMMIT_STYLE`, `PRP_COMMIT_STYLE_EXAMPLES`) immediately AFTER the existing
   `PRP_COMMIT_FORMAT` row in the `### Resilience Tuning` table.
2. **`docs/CONFIGURATION.md` — Zone B (`.hack` schema-summary table, ~L94):** APPEND `commit_style`,
   `commit_style_examples` to the `[pipeline]` row's keys cell and `PRP_COMMIT_STYLE`,
   `PRP_COMMIT_STYLE_EXAMPLES` to its env-vars cell.
3. **`docs/CONFIGURATION.md` — Zone C (`## Task & Status Commands`, ~L823):** INSERT a new
   `### \`hack update\`` subsection (after the breakdown-in-progress blockquote, before `## See Also`)
   documenting the command syntax, fuzzy task-ID matching, fuzzy status matching (+ synonym table),
   cascade semantics, lock/concurrency behavior, output formats, and error cases.

**Success Definition**:
- The two new env vars are documented with their modes/default/`.hack` key/§5.1 citation, adjacent
  to `PRP_COMMIT_FORMAT`.
- The `.hack` schema-summary `[pipeline]` row lists all seven pipeline keys (incl. `commit_style`
  + `commit_style_examples`) and their seven env vars.
- A user reading `## Task & Status Commands` can learn `hack update`'s full surface (syntax, fuzzy
  ID/status matching, cascade, lock, output, errors) and is pointed to CLI_REFERENCE.md + PRD §5.4
  for the exhaustive reference.
- `git diff --name-only` lists EXACTLY `docs/CONFIGURATION.md`.
- `npm run format:check` clean (prettier on `.md`).

---

## Why

- **Mode B docs must reflect shipped features.** The style layer (P1.M1.*) and `hack update`
  (P1.M2.*) are real, configurable surfaces. `docs/CONFIGURATION.md` is the project's
  configuration/command reference; without these entries a user cannot discover `PRP_COMMIT_STYLE`
  (the descriptive-message style — orthogonal to the already-documented `PRP_COMMIT_FORMAT`
  position layer), the two new `[pipeline]` `.hack` keys, or the `hack update` command.
- **The position-vs-style distinction is load-bearing.** `PRP_COMMIT_FORMAT` (position prefix) and
  `PRP_COMMIT_STYLE` (descriptive-message wording) are ORTHOGONAL axes (PRD §5.1). Documenting them
  adjacent (Zone A) — with the style row naming all four modes + the `auto` learning behavior + the
  ≤1-commit / `EXAMPLES=0` `plain` fallback — prevents the exact confusion the PRD spent a paragraph
  disambiguating.
- **`hack update` needs a discoverable home.** The read-only trio (`hack status`/`task`/`task next`)
  is already documented (Zone C). The write-side `hack update` is the manual-override counterpart
  (PRD §5.4) and belongs in the SAME section so the Task/Status command surface is complete in one
  place. Its fuzzy matching + cascade + lock semantics are non-obvious enough to summarize in-doc
  (pointing to CLI_REFERENCE.md / PRD §5.4 for the exhaustive spec).
- **Single-file scope.** This task owns ONLY `docs/CONFIGURATION.md`. The two-layer commit-model
  architecture note + README commands-list are P1.M3.T1.S2 / P1.M3.T1.S3 — disjoint files, no
  merge conflict.
- **Scope discipline.** No `src/`, no tests, no `PRD.md`/`spec/*`/`tasks.json`/`prd_snapshot.md`,
  no `PROMPTS.md`. The sibling implementing tasks own the code + its tests; this task documents the
  user-facing knobs + command.

---

## What

### User-visible behavior
None beyond the docs. Observable change: `docs/CONFIGURATION.md` gains two env-var rows, two
`.hack` key entries, and one new `### hack update` subsection.

### Technical requirements (exact contract)

The authoritative sources: PRD §5.1 / §5.4 / §9.2.2 / §9.7.5 (read-only) + the P1.M2.T4.S1 PRP
(the `hack update` CLI contract — treat as already-shipped).

**Zone A — INSERT two rows after the `PRP_COMMIT_FORMAT` row (~L255)** in the
`### Resilience Tuning` table (4-col: `| Variable | Required | Default | Description |`). The
`PRP_COMMIT_FORMAT` row is the LAST row of that table; the next non-blank line is
`### Distributed PRDs`. Insert verbatim (matching the existing row's prose density + the `**.hack key:**`
cross-reference convention used by the `PRP_COMMIT_FORMAT` row):

```markdown
| `PRP_COMMIT_STYLE`          | No | `auto` | Commit-message **style layer** — the contract for the descriptive message `stagecoach` generates (PRD §5.1 "Commit Message Style"). Orthogonal to `PRP_COMMIT_FORMAT` (position vs. wording). `auto` (default) learns the project's style by sending the last `PRP_COMMIT_STYLE_EXAMPLES` commit messages as style examples with an anti-reuse instruction (match STYLE, not wording; ignore any leading numeric position prefix like `1.2.1.1:`); degrades to `plain` when the repo has ≤1 commit. Explicit modes replace the examples with a fixed contract: `plain` (imperative descriptive summary, ≤72-char subject, no type prefix/scope/emoji), `conventional` (`type(scope): description` from the standard vocabulary), or `gitmoji` (one leading emoji + description). Case-insensitive; any unrecognized value falls back to `auto`. Applies only to generated descriptive messages — never to the Smart Commit fallback placeholder or non-generated commits; existing history is never rewritten. **`.hack` key:** `[pipeline] commit_style` (see [.hack Configuration File](#hack-configuration-file)). |
| `PRP_COMMIT_STYLE_EXAMPLES` | No | `5`    | How many recent commit messages `auto` style learning sends as examples in the generation request (PRD §5.1). Integer ≥ 0; default **5**. `0` **disables** style learning (degrades to `plain`) even when `PRP_COMMIT_STYLE=auto`. Has no effect under explicit modes (`plain`/`conventional`/`gitmoji`). **`.hack` key:** `[pipeline] commit_style_examples` (see [.hack Configuration File](#hack-configuration-file)). |
```

**Zone B — APPEND to the `[pipeline]` row (~L94)** in the `### Schema summary` table. Current row:
```markdown
| `[pipeline]` | `parallel_research`, `research_depth`, `research_timeout_seconds`, `issue_retry_max`, `commit_format` | `PARALLEL_RESEARCH`, `RESEARCH_DEPTH`, `RESEARCH_TIMEOUT`, `ISSUE_RETRY_MAX`, `PRP_COMMIT_FORMAT` |
```
Change to (append the two keys + two env vars; keep them grouped with `commit_format`):
```markdown
| `[pipeline]` | `parallel_research`, `research_depth`, `research_timeout_seconds`, `issue_retry_max`, `commit_format`, `commit_style`, `commit_style_examples` | `PARALLEL_RESEARCH`, `RESEARCH_DEPTH`, `RESEARCH_TIMEOUT`, `ISSUE_RETRY_MAX`, `PRP_COMMIT_FORMAT`, `PRP_COMMIT_STYLE`, `PRP_COMMIT_STYLE_EXAMPLES` |
```
(Do NOT add to `[commit]` — per PRD §9.7.5 + the landed SCHEMA_MAP, `commit_style` /
`commit_style_examples` are `[pipeline]` keys, alongside `commit_format`.)

**Zone C — INSERT a new `### \`hack update\`` subsection** under `## Task & Status Commands`, AFTER
the breakdown-in-progress blockquote (~L823) and BEFORE the `---` / `## See Also`. Content (a
SUMMARY — point to `./CLI_REFERENCE.md` + PRD §5.4 for the exhaustive reference, mirroring how the
`hack config` section at L129–143 summarizes + defers):

```markdown
### `hack update` — manual status updates (PRD §5.4)

`hack update` rewrites a task item's status from the command line, with **both** the task ID and the
target status fuzzy-matched so the command is easy to type. It is the write-side counterpart to the
read-only `hack status` / `hack task` trio above.

```bash
hack update <task-id> <status> [-f <file>] [--session <hash>] [-o text|json]
```

```bash
hack update P1.M1.T1.S1 ready        # full canonical form
hack update p1m1t1s1 ready           # concatenated, case-insensitive
hack update 1.1.1.1 re               # numeric form + synonym status
hack update 1.2 done                 # milestone + synonym status
hack update 2 comp                   # phase + prefix status
```

- **Loose task-ID matching.** The `<task-id>` is normalized before lookup: `P1.M1.T1.S1`,
  `p1.m1.t1.s1`, `p1m1t1s1`, and `1.1.1.1` are all equivalent. Segments map positionally
  Phase → Milestone → Task → Subtask; trailing segments may be omitted (`1` → Phase, `1.2` →
  Milestone, `1.2.3` → Task, `1.2.3.4` → Subtask).
- **Loose status matching.** The `<status>` is fuzzy-matched in this order: (1) synonym table
  (`d`/`done`/`fin`/`finished`/`completed` → **Complete**; `re`/`rdy` → **Ready**); (2) canonical
  exact (case-insensitive); (3) unique prefix (`c`→Complete, `p`→Planned, `i`→Implementing, …);
  (4) unique substring; (5) ambiguous (e.g. `r` matches both Ready and Researching) → error listing
  candidates; unknown → error listing valid statuses. The manually-settable set is
  `Planned, Researching, Ready, Implementing, Complete, Failed, Obsolete` (`Retrying` is an internal
  transitional status — NOT manually settable; reset a stuck `Retrying` item via `Planned`/`Ready`).
- **Cascade semantics.** Setting a parent to `Complete` cascades `Complete` to every descendant
  (`hack update 1 done` marks the whole phase tree). After any change, ancestors are recomputed
  bottom-up as the **minimum** (least-progressed) status among non-`Failed` children (`Failed`
  children excluded unless ALL are `Failed` → parent `Failed`; `Obsolete` is terminal and loses ties
  to `Complete`). Marking the last incomplete subtask `Complete` promotes its Task/Milestone/Phase;
  resetting a subtask back to `Planned` drops its ancestors accordingly.
- **File discovery + lock.** Resolves the target `tasks.json` with the same priority as
  `hack task`/`status` (`--file` override → `--session` → latest session, preferring a bugfix
  child). Unlike the read-only trio, `update` is a **write**: a missing *discovered* `tasks.json`
  (breakdown-in-progress) is a **hard error** — NOT the calm `awaiting_breakdown` notice — so wait
  for breakdown or pass `--file`. Every update is a serialized read-modify-write under the same
  exclusive `tasks.json.lock` used by the orchestrator/research supervisor, then an atomic
  schema-validated write (temp + rename) — it can never corrupt `tasks.json` or race a concurrent
  writer (PRD §5.1). A lock that cannot be acquired within the timeout fails fast with a clear
  message rather than blocking.
- **Output.** Success: `Updated <ID> status to <Status>` on stdout (text), or
  `{ "id", "status", "title" }` (`-o json`). Errors (task not found, ambiguous/unknown status, file
  not found, lock timeout) print to stderr and exit non-zero.

See [CLI Reference](./CLI_REFERENCE.md) for the exhaustive `hack update` reference and PRD §5.4 for
the full contract.
```

### Success Criteria
- [ ] Zone A: `PRP_COMMIT_STYLE` + `PRP_COMMIT_STYLE_EXAMPLES` rows present, adjacent to
      `PRP_COMMIT_FORMAT`, with the four modes / `auto` default / examples default 5 / `0`-disables /
      `.hack` key / §5.1 citation.
- [ ] Zone B: the `[pipeline]` schema-summary row lists `commit_style` + `commit_style_examples`
      keys and `PRP_COMMIT_STYLE` + `PRP_COMMIT_STYLE_EXAMPLES` env vars.
- [ ] Zone C: a `### hack update` subsection documents syntax, fuzzy ID matching, fuzzy status
      matching (+ synonym table), cascade semantics, lock behavior (hard error on missing
      discovered tasks.json), output formats, error cases, with a CLI_REFERENCE/§5.4 pointer.
- [ ] `git diff --name-only` lists EXACTLY `docs/CONFIGURATION.md`.
- [ ] `npm run format:check` clean.

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_ **Yes** — the
single file + the three exact line-anchored zones, the verbatim new rows/subsection content, the
authoritative PRD sections (§5.1/§5.4/§9.2.2/§9.7.5 quoted), the P1.M2.T4.S1 CLI contract (flags,
output strings, error strings, hard-error-on-missing-discovered), the prettier-only validation
approach, and the grep semantic gate. See `research/configuration-doc-strategy.md` for per-claim
evidence.

### Documentation & References
```yaml
# MUST READ — PRD §5.1 (the style-layer contract this documents)
- docfile: spec/05-state-and-file-management.md   # (or the merged PRD §5.1 "Commit Message Style (Learning & Explicit Modes)")
  section: "Commit Message Style (Learning & Explicit Modes)"
  why: The authoritative four-mode contract (auto/plain/conventional/gitmoji), the auto learning behavior (last-N examples + anti-reuse + ignore-position-prefix), the ≤1-commit / EXAMPLES=0 plain fallback, the orthogonality with PRP_COMMIT_FORMAT.
  critical: PRP_COMMIT_STYLE is the STYLE layer (descriptive-message wording); PRP_COMMIT_FORMAT is the POSITION layer (the 1.2.1.1: prefix). They are orthogonal. Document them as such.

# MUST READ — PRD §5.4 (the hack update contract this documents)
- docfile: spec/05-state-and-file-management.md   # §5.4 "Manual Status Updates (hack update)"
  section: "5.4 Manual Status Updates (hack update)"
  why: The authoritative command surface, fuzzy ID/status matching (incl. the synonym table), cascade semantics (downward Complete + bottom-up min-status recompute), lock/concurrency, output, error cases, acceptance criteria.
  critical: The matchable status set is Planned/Researching/Ready/Implementing/Complete/Failed/Obsolete (7 — Retrying is NOT manually settable). A missing DISCOVERED tasks.json is a HARD ERROR (update is a write), distinct from the read-only awaiting_breakdown notice.

# MUST READ — PRD §9.2.2 + §9.7.5 (the env-var + .hack schema groupings)
- docfile: spec/ (§9.2.2 "Required Environment Variables" Commit Configuration bullet group + §9.7.5 Schema Reference table)
  why: §9.2.2 groups PRP_COMMIT_FORMAT/PRP_COMMIT_STYLE/PRP_COMMIT_STYLE_EXAMPLES under "Commit Configuration"; §9.7.5 lists [pipeline] commit_style + commit_style_examples (type/default). The doc rows must match these.
  critical: commit_style + commit_style_examples are [pipeline] keys (NOT [commit]); defaults auto / 5.

# MUST READ — this subtask's research (the three verified line-anchored zones + the P1.M2.T4.S1 CLI contract)
- docfile: plan/012_7dd502f7feb9/P1M3T1S1/research/configuration-doc-strategy.md
  section: "1. The two authoritative sources", "2. The THREE edit zones (VERIFIED line anchors)", "3. ToC consideration", "4. Formatting/validation", "5. Disjointness"
  why: The exact current content of L94 ([pipeline] row), L255 (PRP_COMMIT_FORMAT row), L805-824 (Task & Status Commands); the P1.M2.T4.S1 settled specifics (flags, output strings, hard-error-on-missing); the prettier-only gate; the single-file scope.

# THE FILE TO EDIT (the ONLY file this task touches)
- file: docs/CONFIGURATION.md
  why: EDIT three zones — Zone A (L255, +2 env-var rows after PRP_COMMIT_FORMAT), Zone B (L94, append 2 keys + 2 env vars to the [pipeline] row), Zone C (~L823, +### hack update subsection before ## See Also).
  pattern_env_row: "| `PRP_COMMIT_FORMAT` | No | `task-prefix` | … description … **`.hack` key:** `[pipeline] commit_format` (see [.hack Configuration File](#hack-configuration-file)); … See PRD §5.1. |"  # the row to mirror for the 2 new style rows
  pattern_subcommand_section: "### `hack config` subcommand (L129–143) — a SUMMARY table + a 'See [CLI Reference](./CLI_REFERENCE.md)' pointer. Mirror this summarize-then-defer style for the ### hack update subsection."
  gotcha: prettier reformats the wide table rows; run `npm run fix` first and accept the reflow. The semantic gate is grep, not byte-stability of column widths.

# THE CLI CONTRACT (read-only — P1.M2.T4.S1 owns the implementation; this task documents it)
- docfile: plan/012_7dd502f7feb9/P1M2T4S1/PRP.md
  why: The settled `hack update` specifics: registration (.command('update') + <task-id> <status> + -f/--file + --session + -o/--output default 'text'); success text `Updated <canonicalId> status to <Status>`; success json {id,status,title}; errors (Task not found / Ambiguous status / Unknown status / lock-timeout) to stderr + exit 1; missing discovered tasks.json = HARD ERROR (NOT awaiting_breakdown); serialized RMW via withLockedTasksJSON + atomic schema-validated write.
  critical: Document the EXACT flag forms (-f/--file, --session <hash>, -o/--output text|json) and the EXACT success/error strings so the doc matches the shipped CLI.

# DO NOT EDIT (disjoint — owned by sibling Mode B tasks)
- file: docs/ARCHITECTURE.md   # P1.M3.T1.S2 owns the two-layer commit-model note + hack update note
- file: README.md              # P1.M3.T1.S3 owns the commands-list + style-layer entry
- file: PROMPTS.md             # not in scope for Delta 012 Mode B
- file: src/cli/index.ts       # P1.M2.T4.S1 owns the update command; READ-ONLY here
- file: PRD.md / spec/*        # human-owned
- file: tasks.json / prd_snapshot.md   # orchestrator-owned
```

### Current Codebase tree (relevant slice)
```bash
docs/CONFIGURATION.md          # EDIT (Zone A + Zone B + Zone C — the ONLY file this task touches)
docs/ARCHITECTURE.md           # DO NOT EDIT (P1.M3.T1.S2)
README.md                      # DO NOT EDIT (P1.M3.T1.S3)
spec/ (PRD §5.1/§5.4/§9.2.2/§9.7.5)  # READ-ONLY (the contract)
src/cli/index.ts               # READ-ONLY (the hack update impl — P1.M2.T4.S1)
```

### Desired Codebase tree with files to be edited
```bash
docs/CONFIGURATION.md          # MODIFIED (+2 env-var rows, +2 .hack keys in [pipeline], +### hack update subsection)
```

### Known Gotchas of our codebase & Library Quirks
```markdown
<!-- CRITICAL — SINGLE-FILE scope. Edit ONLY docs/CONFIGURATION.md. Do NOT touch docs/ARCHITECTURE.md
     (P1.M3.T1.S2), README.md (P1.M3.T1.S3), PROMPTS.md, src/, tests/, PRD.md/spec/*, tasks.json,
     or prd_snapshot.md. git diff --name-only must list EXACTLY docs/CONFIGURATION.md. -->

<!-- CRITICAL — commit_style + commit_style_examples are [pipeline] keys, NOT [commit]. Per PRD §9.7.5
     + the landed SCHEMA_MAP (P1.M1.T1.S2), they sit alongside commit_format in [pipeline]. Zone B
     appends to the [pipeline] row; do NOT add them to [commit]. -->

<!-- CRITICAL — PRP_COMMIT_STYLE vs PRP_COMMIT_FORMAT are ORTHOGONAL. PRP_COMMIT_FORMAT = POSITION
     layer (the 1.2.1.1: prefix); PRP_COMMIT_STYLE = STYLE layer (the descriptive-message wording:
     tone/type-prefix/gitmoji). The Zone A rows MUST state this orthogonality (mirror PRD §5.1's
     "Position layer / Style layer" framing) so readers don't conflate them. -->

<!-- CRITICAL — hack update on a missing DISCOVERED tasks.json is a HARD ERROR (exit 1), NOT the calm
     awaiting_breakdown notice. update is a WRITE; the read-only trio gets the calm notice. The Zone C
     subsection MUST state this distinction (it is a PRD §5.4 acceptance criterion). -->

<!-- CRITICAL — matchable status set is 7 (Planned/Researching/Ready/Implementing/Complete/Failed/
     Obsolete). Retrying is NOT manually settable. Document the 7 + the Retrying exclusion in Zone C. -->

<!-- CRITICAL — the synonym table is the FIRST match tier (preempts ambiguity): d/done/fin/finished/
     completed → Complete; re/rdy → Ready. So `re` → Ready (NOT ambiguous), but bare `r` → ambiguous
     (Ready vs Researching). Document the table + the precedence in Zone C. -->

<!-- GOTCHA — prettier is the ONLY build gate for .md (typecheck/eslint gate .ts only). Run `npm run fix`
     (prettier --write) FIRST; the wide Zone A rows + the Zone C subsection may reflow. Accept the
     reflow — the semantic gate is the grep table, not column-width byte-stability. -->

<!-- GOTCHA — ToC: the [Task & Status Commands](#task--status-commands) entry already covers the
     section. A new ### hack update SUBSECTION under it needs NO new ToC bullet (the ToC stops at
     ###-depth for most sections; the `hack config` subsection at L129 has no ToC bullet either). -->

<!-- GOTCHA — Do NOT add a vitest test. This is docs-only ("This IS the documentation task"). The
     sibling implementing tasks (P1.M1.*, P1.M2.*) own the code + tests. The semantic gate is grep. -->

<!-- GOTCHA — Do NOT run the full `npm run test:run` as a gate (orthogonal pre-existing failures per
     the session's architecture docs). Gate = `npm run fix` + `npm run format:check` + the grep table
     + `git diff --name-only`. -->
```

---

## Implementation Blueprint

### Data models and structure
None — documentation. The "structure" is: two new markdown table rows (Zone A), an edited table row
(Zone B), and one new subsection with a syntax block + bulleted semantics (Zone C). All wording is
anchored to PRD §5.1 / §5.4 / §9.2.2 / §9.7.5 + the P1.M2.T4.S1 CLI contract.

### Implementation Tasks (ordered — three additive edits to one file)
```yaml
Task 1: EDIT docs/CONFIGURATION.md — Zone A (commit env-var rows, ~L255)
  - LOCATE the `### Resilience Tuning` table; the `PRP_COMMIT_FORMAT` row is its LAST row (~L255),
    immediately before a blank line + `### Distributed PRDs`.
  - INSERT the two new rows (`PRP_COMMIT_STYLE`, `PRP_COMMIT_STYLE_EXAMPLES`) verbatim from the
    "Technical requirements" Zone A block, AFTER the `PRP_COMMIT_FORMAT` row. Match the existing
    row's prose density + the `**`.hack` key:**` cross-reference convention.
  - VERIFY: each new row names the four modes / the `auto` default / the examples default 5 / the
    `0`-disables semantics / the `.hack` key / the §5.1 citation; the STYLE-vs-POSITION orthogonality
    is stated.
  - DO NOT: move PRP_COMMIT_FORMAT to a new subsection; edit COMMIT_RETRY_* rows; touch other tables.

Task 2: EDIT docs/CONFIGURATION.md — Zone B (.hack schema-summary [pipeline] row, ~L94)
  - LOCATE the `### Schema summary` table; the `[pipeline]` row (~L94) currently lists keys
    `parallel_research, research_depth, research_timeout_seconds, issue_retry_max, commit_format`
    and env vars `…, PRP_COMMIT_FORMAT`.
  - APPEND `commit_style, commit_style_examples` to the keys cell and `PRP_COMMIT_STYLE,
    PRP_COMMIT_STYLE_EXAMPLES` to the env-vars cell (keep them grouped with commit_format).
  - DO NOT add to the `[commit]` row — these are [pipeline] keys.
  - VERIFY: grep the row shows all 7 pipeline keys + 7 env vars.

Task 3: EDIT docs/CONFIGURATION.md — Zone C (### hack update subsection, ~L823)
  - LOCATE `## Task & Status Commands` (L805); its content ends with the breakdown-in-progress
    blockquote (~L823), then blank → `---` (L824) → `## See Also` (L826).
  - INSERT the new `### \`hack update\` — manual status updates (PRD §5.4)` subsection verbatim from
    the "Technical requirements" Zone C block, AFTER the blockquote and BEFORE the `---`/`## See Also`.
  - The subsection MUST cover: command syntax (+ the 5 example invocations), loose task-ID matching,
    loose status matching (+ synonym table + the 7-status set + Retrying exclusion), cascade
    semantics (downward Complete + bottom-up min-status recompute), file discovery + lock (hard error
    on missing discovered tasks.json; serialized RMW + atomic write; lock-timeout fails fast), output
    (text/json), errors (stderr + non-zero), and a CLI_REFERENCE + §5.4 pointer.
  - Mirror the `### \`hack config\` subcommand` (L129–143) summarize-then-defer style (a short table
    or syntax block + "See CLI Reference …").
  - DO NOT add a ToC bullet (the section anchor already covers it).
  - VERIFY: grep shows `### \`hack update\``, the synonym examples (`done`/`re`/`comp`), the 7-status
    set, `hard error`, `Updated <ID> status to <Status>`.

Task 4: FORMAT + VERIFY
  - RUN: npm run fix            # prettier --write (reflows the wide rows + subsection; accept it)
  - RUN: npm run format:check   # prettier --check **/*.md → clean
  - SEMANTIC GREP GATE (the real gate):
      grep -c "PRP_COMMIT_STYLE\b" docs/CONFIGURATION.md            # ≥3 (Zone A row + Zone B + Zone C? at least Zone A + Zone B)
      grep -c "PRP_COMMIT_STYLE_EXAMPLES" docs/CONFIGURATION.md     # ≥2 (Zone A + Zone B)
      grep -c "commit_style" docs/CONFIGURATION.md                  # ≥3 (Zone A .hack refs ×2 + Zone B)
      grep -c "### \`hack update\`" docs/CONFIGURATION.md           # 1 (the new subsection)
      grep -c "Updated <ID> status to <Status>" docs/CONFIGURATION.md  # 1 (the output contract)
      grep -c "hard error" docs/CONFIGURATION.md                   # ≥1 (Zone C: missing discovered = hard error)
      grep -c "§5.4" docs/CONFIGURATION.md                         # ≥1 (Zone C citation)
      grep -c "§5.1" docs/CONFIGURATION.md                         # ≥3 (Zone A style rows + the existing format row)
      git diff --name-only                                          # EXACTLY docs/CONFIGURATION.md
  - DO NOT add a test; do NOT run the full npm run test:run as a semantic gate.
  - EXPECTED: format:check clean; greps return the expected counts; exactly one file in the diff.
```

### Implementation Patterns & Key Details
```markdown
<!-- Zone A row skeleton (mirror the PRP_COMMIT_FORMAT row's shape) -->
| `<ENV_VAR>` | No | `<default>` | <one-line role> (PRD §5.1). <modes/fallback semantics>. **`.hack` key:** `[pipeline] <key>` (see [.hack Configuration File](#hack-configuration-file)). |

<!-- Zone B [pipeline] row — append the two keys + two env vars (grouped with commit_format) -->
| `[pipeline]` | `parallel_research`, `research_depth`, `research_timeout_seconds`, `issue_retry_max`, `commit_format`, `commit_style`, `commit_style_examples` | `PARALLEL_RESEARCH`, `RESEARCH_DEPTH`, `RESEARCH_TIMEOUT`, `ISSUE_RETRY_MAX`, `PRP_COMMIT_FORMAT`, `PRP_COMMIT_STYLE`, `PRP_COMMIT_STYLE_EXAMPLES` |

<!-- Zone C subsection skeleton (mirror the ### `hack config` subcommand summarize-then-defer style) -->
### `hack update` — manual status updates (PRD §5.4)
<intro sentence: write-side counterpart to the read-only trio>
```bash
hack update <task-id> <status> [-f <file>] [--session <hash>] [-o text|json]
```
<5 example invocations>
- **Loose task-ID matching.** …
- **Loose status matching.** (synonym table; 7-status set; Retrying exclusion) …
- **Cascade semantics.** (downward Complete + bottom-up min-status recompute) …
- **File discovery + lock.** (hard error on missing discovered; serialized RMW + atomic write; lock-timeout fails fast) …
- **Output.** (text `Updated <ID> status to <Status>` / json `{id,status,title}`; errors stderr + non-zero) …
See [CLI Reference](./CLI_REFERENCE.md) … and PRD §5.4 …

<!-- The hack update CLI contract facts (from P1.M2.T4S1 PRP — document verbatim) -->
- flags: `-f, --file <path>` | `--session <hash>` | `-o, --output <format>` (default 'text')
- success text (stdout): `Updated <canonicalId> status to <Status>` (e.g. `Updated P1.M1.T1.S1 status to Complete`)
- success json: `{ id, status, title }`
- errors (stderr + exit 1): `Task not found: <taskId>` / `Ambiguous status "r": matches …` / `Unknown status "bogus". Valid statuses: …` / lock-timeout `Could not acquire tasks.json lock: …`
- missing discovered tasks.json → HARD ERROR exit 1 (NOT awaiting_breakdown)
- serialized RMW via `withLockedTasksJSON(sessionDir, mutator)`; atomic + schema-validated write (temp + rename)
```

### Integration Points
```yaml
DOCS (the deliverable — docs/CONFIGURATION.md only):
  - Zone A (+2 env-var rows): PRP_COMMIT_STYLE, PRP_COMMIT_STYLE_EXAMPLES — adjacent to PRP_COMMIT_FORMAT.
  - Zone B ([pipeline] schema-summary row): +commit_style, +commit_style_examples keys; +PRP_COMMIT_STYLE, +PRP_COMMIT_STYLE_EXAMPLES env vars.
  - Zone C (+### hack update subsection): syntax, fuzzy matching, cascade, lock, output, errors + CLI_REFERENCE/§5.4 pointer.

NO CHANGES TO (hard boundary):
  - docs/ARCHITECTURE.md (P1.M3.T1.S2), README.md (P1.M3.T1.S3), PROMPTS.md.
  - src/cli/index.ts (P1.M2.T4.S1 — the update command; READ-ONLY here).
  - src/utils/task-utils.ts (P1.M2.T1–T3 — the matchers/cascade; READ-ONLY).
  - src/config/constants.ts + src/config/hack-config.ts (P1.M1.T1 — the style constants/schema; READ-ONLY).
  - PRD.md/spec/* (human-owned), tasks.json, prd_snapshot.md.

CONSISTENCY (the surfaced the doc describes):
  - The two style env vars map to the [pipeline] commit_style / commit_style_examples .hack keys (PRD §9.7.5;
    landed in SCHEMA_MAP by P1.M1.T1.S2). The Zone A rows cross-reference the .hack keys; Zone B lists them.
  - The hack update command is shipped by P1.M2.T4.S1 (CLI) on top of P1.M2.T1–T3 (matchers/cascade). The
    Zone C subsection documents the user-facing surface; it does not duplicate the implementation.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
npm run fix            # prettier --write (the ONLY formatter applying to .md; run first — reflows)
npm run format:check   # prettier --check "**/*.{ts,js,json,md,yml,yaml}" → clean
# (npm run typecheck / npm run lint gate .ts ONLY — unaffected by .md edits. N/A to this task.)
# Expected: format:check clean. Likely "failure": prettier reformats the wide Zone A rows — accept it.
```

### Level 2: Semantic Verification (the real gate — grep, since no unit test applies)
```bash
# Zone A — the two new env-var rows landed + cite §5.1 + name the .hack keys:
grep -c "PRP_COMMIT_STYLE\b" docs/CONFIGURATION.md            # ≥2 (Zone A row + Zone B)
grep -c "PRP_COMMIT_STYLE_EXAMPLES" docs/CONFIGURATION.md     # ≥2 (Zone A + Zone B)
grep -c "conventional\|gitmoji" docs/CONFIGURATION.md         # ≥1 (Zone A names the explicit modes)
grep -c "\[pipeline\] commit_style" docs/CONFIGURATION.md     # ≥2 (Zone A .hack refs for style + examples)
grep -c "§5.1" docs/CONFIGURATION.md                          # ≥3 (Zone A 2 style rows + existing format row)
# Zone B — the [pipeline] row lists the two new keys + env vars:
grep -c "commit_style" docs/CONFIGURATION.md                  # ≥3 (Zone A refs + Zone B)
grep -c "PRP_COMMIT_STYLE_EXAMPLES" docs/CONFIGURATION.md     # ≥2 (confirmed above)
# Zone C — the hack update subsection + its contract facts:
grep -c '### `hack update`' docs/CONFIGURATION.md             # 1 (the new subsection)
grep -c "Updated <ID> status to <Status>" docs/CONFIGURATION.md  # 1 (the output contract)
grep -c "Retrying" docs/CONFIGURATION.md                      # ≥1 (the Retrying-NOT-settable note)
grep -c "hard error" docs/CONFIGURATION.md                    # ≥1 (missing discovered = hard error)
grep -c "§5.4" docs/CONFIGURATION.md                          # ≥1 (the Zone C citation)
# Expected: each grep returns at least its threshold.
```

### Level 3: Regression / Single-File Confirmation
```bash
git diff --name-only          # Expected: EXACTLY docs/CONFIGURATION.md
# Confirm no stray edits to the sibling-owned files / forbidden files:
git diff --name-only | grep -E 'docs/ARCHITECTURE.md|README.md|PROMPTS.md|src/|PRD.md|spec/|tasks.json|prd_snapshot.md' && echo "STRAY EDIT — ABORT" || echo "scope OK"
# Expected: "scope OK" (only docs/CONFIGURATION.md changed).
```

### Level 4: Creative & Domain-Specific Validation
```bash
# No MCP/DB/HTTP (documentation). Domain reasoning (record in commit message):
#   1. The two style env vars are documented as ORTHOGONAL to PRP_COMMIT_FORMAT (position vs. style) —
#      matching PRD §5.1's framing, preventing the conflation the PRD spent a paragraph disambiguating.
#   2. The four modes (auto/plain/conventional/gitmoji) + the auto learning behavior + the ≤1-commit /
#      EXAMPLES=0 plain fallback are all stated, so a user can pick a mode or let auto learn.
#   3. The [pipeline] commit_style / commit_style_examples .hack keys are cross-referenced from the
#      env-var rows AND listed in the schema-summary table — consistent with §9.7.5.
#   4. The hack update subsection documents the full user-facing surface (fuzzy ID/status, cascade,
#      lock, output, errors) and the critical hard-error-on-missing-discovered distinction (a §5.4
#      acceptance criterion), deferring to CLI_REFERENCE/§5.4 for the exhaustive spec.
#   5. Single-file scope honored (git diff --name-only = docs/CONFIGURATION.md only).
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run format:check` clean (prettier on the edited .md).
- [ ] Semantic grep (Zone A/B/C thresholds) returns the expected counts.
- [ ] `git diff --name-only` lists EXACTLY `docs/CONFIGURATION.md`.

### Feature Validation
- [ ] Zone A: `PRP_COMMIT_STYLE` + `PRP_COMMIT_STYLE_EXAMPLES` rows present (4 modes, `auto` default,
      examples default 5, `0`-disables, `.hack` keys, §5.1, style-vs-position orthogonality).
- [ ] Zone B: `[pipeline]` row lists `commit_style` + `commit_style_examples` keys and
      `PRP_COMMIT_STYLE` + `PRP_COMMIT_STYLE_EXAMPLES` env vars.
- [ ] Zone C: `### hack update` subsection covers syntax, fuzzy ID matching, fuzzy status matching
      (+ synonym table + 7-status set + Retrying exclusion), cascade semantics, lock behavior
      (hard error on missing discovered tasks.json), output formats, error cases, + CLI_REFERENCE/§5.4.

### Code Quality Validation
- [ ] Mirrors the existing row/subsection prose conventions (the `PRP_COMMIT_FORMAT` row shape; the
      `### hack config` summarize-then-defer style).
- [ ] Accurate to the P1.M2.T4.S1 CLI contract (flags `-f/--file`, `--session`, `-o/--output`;
      `Updated <ID> status to <Status>`; hard-error-on-missing-discovered; serialized RMW + atomic write).
- [ ] Additive only — no removal/rewrite of existing rows/sections.
- [ ] Single-file scope (only docs/CONFIGURATION.md).

### Documentation & Deployment
- [ ] No `src/`, `tests/`, PRD.md/spec/*, tasks.json, prd_snapshot.md, PROMPTS.md, docs/ARCHITECTURE.md,
      or README.md changes.
- [ ] Commit message records: Mode B doc-sync for Delta 012; the single file + three zones; the
      style-layer orthogonality (position vs. style); the hack update contract (fuzzy matching,
      cascade, lock, hard-error-on-missing-discovered); cross-ref to P1.M1.* (style constants/schema)
      + P1.M2.* (matchers/cascade/CLI) as the implementation owners; the prettier+grep gate.

---

## Anti-Patterns to Avoid

- ❌ Don't edit any file other than `docs/CONFIGURATION.md`. docs/ARCHITECTURE.md is P1.M3.T1.S2;
      README.md is P1.M3.T1.S3; PROMPTS.md, src/, tests/, PRD.md/spec/*, tasks.json, prd_snapshot.md
      are all out of scope. `git diff --name-only` must be exactly one file.
- ❌ Don't add `commit_style`/`commit_style_examples` to the `[commit]` `.hack` row. They are
      `[pipeline]` keys (PRD §9.7.5 + the landed SCHEMA_MAP). Zone B appends to `[pipeline]`, not `[commit]`.
- ❌ Don't conflate PRP_COMMIT_STYLE with PRP_COMMIT_FORMAT. STYLE = descriptive-message wording;
      FORMAT = position prefix. The Zone A rows MUST state the orthogonality (PRD §5.1 framing).
- ❌ Don't soften `hack update`'s missing-discovered-tasks.json behavior to the calm
      `awaiting_breakdown` notice. `update` is a WRITE → missing discovered tasks.json is a HARD ERROR
      (exit 1). This is a PRD §5.4 acceptance criterion; Zone C must state it.
- ❌ Don't list `Retrying` as manually settable. The settable set is 7 (Planned/Researching/Ready/
      Implementing/Complete/Failed/Obsolete); Retrying is internal. Zone C must state the exclusion.
- ❌ Don't drop the synonym table from Zone C. `re`→Ready (synonym, not ambiguous) vs bare `r`→ambiguous
      is non-obvious; the table + precedence (synonym → canonical → prefix → substring → ambiguous/
      unknown) must be documented.
- ❌ Don't add a vitest test or run the full `npm run test:run`. This is docs-only. The semantic gate
      is prettier format:check + the grep table + `git diff --name-only`.
- ❌ Don't gate on `npm run typecheck`/`npm run lint` for this task's changes — they gate `.ts` only.
      The .md gate is prettier + grep.
- ❌ Don't add a ToC bullet for the `### hack update` subsection. The existing
      `[Task & Status Commands](#task--status-commands)` entry covers it; the `hack config` subsection
      (L129) has no ToC bullet either — match that precedent.
- ❌ Don't invent CLI flag names or output strings. Use the P1.M2.T4.S1 contract verbatim
      (`-f/--file`, `--session <hash>`, `-o/--output text|json`; `Updated <ID> status to <Status>`;
      `{id,status,title}`; the error strings). If unsure, read the P1M2T4S1 PRP, not your memory.

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: This is a single-file, three-zone, purely additive documentation task. Every edit's
verbatim content is specified (the two env-var rows, the edited `[pipeline]` row, the full
`### hack update` subsection), with exact line anchors verified against HEAD (L94 Zone B, L255 Zone A,
L805–824 Zone C). The authoritative contracts are read in full: PRD §5.1 (style layer), §5.4 (hack
update), §9.2.2 (env-var grouping), §9.7.5 (.hack schema) — and the P1.M2.T4.S1 PRP settles the exact
CLI surface (flags, output/error strings, hard-error-on-missing-discovered, serialized RMW). The
existing row/subsection conventions are quoted for mirroring (the `PRP_COMMIT_FORMAT` row shape; the
`### hack config` summarize-then-defer style). The non-obvious traps are documented: (1) STYLE vs
FORMAT orthogonality; (2) `[pipeline]` not `[commit]` for the two keys; (3) hard-error-on-missing-
discovered (NOT awaiting_breakdown); (4) 7-status set + Retrying exclusion; (5) synonym-table
precedence; (6) prettier reflow of wide rows (accept it; semantic gate is grep); (7) no ToC bullet;
(8) no vitest test. The work is file-disjoint from the parallel P1.M2.T4.S1 (`src/cli/index.ts` +
`src/utils/task-utils.ts` — zero `.md` overlap) and from P1.M3.T1.S2/S3 (other `.md` files). Residual
risks: (a) prettier reformats the wide Zone A rows (accepted — run `npm run fix`, gate on grep);
(b) under-documenting one contract fact (mitigated by the grep threshold table checking the modes,
defaults, `.hack` keys, hard-error, Retrying, synonym examples, output string, §5.1/§5.4 citations);
(c) a CLI-contract drift from P1.M2.T4.S1 (mitigated: the PRP is the contract; the doc mirrors its
verbatim flag/output/error strings). No runtime/network/LLM unknowns — pure markdown edits + grep.