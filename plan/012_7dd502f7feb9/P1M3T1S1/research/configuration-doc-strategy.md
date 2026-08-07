# Research — P1.M3.T1.S1: Update docs/CONFIGURATION.md (commit-style env vars, .hack keys, hack update)

## 0. What this task IS (Mode B doc-sync — docs/CONFIGURATION.md only)

Final Mode B documentation task for Delta 012. Summarizes the whole changeset's two features into
**`docs/CONFIGURATION.md`** ONLY: (Feature 1) the commit-message **style layer**
(`PRP_COMMIT_STYLE` + `PRP_COMMIT_STYLE_EXAMPLES` env vars + `[pipeline] commit_style` /
`commit_style_examples` `.hack` keys); (Feature 2) the **`hack update`** subcommand. **No `src/`**,
**no tests** — documentation only. Sibling Mode B tasks P1.M3.T1.S2 (docs/ARCHITECTURE.md) and
P1.M3.T1.S3 (README.md) own the OTHER files; this task touches ONLY docs/CONFIGURATION.md.

## 1. The two authoritative sources (read-only — do NOT edit)

- **PRD §5.1** ("Commit Message Style (Learning & Explicit Modes)") + §5.4 ("Manual Status Updates
  (`hack update`)") + §9.2.2 ("Required Environment Variables" — the Commit Configuration bullet
  group) + §9.7.5 (the schema-reference table). These are the verbatim contract. The doc must match.
- **P1.M2.T4.S1 PRP** (in-flight previous — the `hack update` CLI contract). Settled specifics:
  - Registration: `program.command('update')` → `.argument('<task-id>')` `.argument('<status>')`
    `.option('-f, --file <path>')` `.option('--session <hash>')` `.option('-o, --output <format>', …, 'text')`
    `.action(updateAction)`.
  - Success (text, stdout): `` `Updated ${canonicalId} status to ${sr.status}` `` → e.g.
    `Updated P1.M1.T1.S1 status to Complete`.
  - Success (json): `{ id, status, title }`.
  - Errors (stderr + exit 1): `Task not found: <taskId>`; `Ambiguous status "r": matches …`;
    `Unknown status "bogus". Valid statuses: …`; lock-timeout `Could not acquire tasks.json lock: …`.
  - Missing *discovered* tasks.json → **HARD ERROR** (exit 1), NOT the calm `awaiting_breakdown`
    notice (update is a WRITE, not a read-only observation).
  - Serialized RMW via `withLockedTasksJSON(sessionDir, mutator)`; atomic + schema-validated write.
  - Mutator composes: set target → (if Complete) cascade down → recompute ancestors up.

## 2. docs/CONFIGURATION.md — the THREE edit zones (VERIFIED line anchors)

File is 836 lines. The ToC (L9–40) lists sections; the three relevant zones:

### Zone B — `.hack` schema-summary table (L94 [pipeline] row + L95 [commit] row)
Under `### Schema summary` (L82). A two-column-per-section table grouping `SCHEMA_MAP`:
```
| `[pipeline]` | `parallel_research`, `research_depth`, `research_timeout_seconds`, `issue_retry_max`, `commit_format` | `PARALLEL_RESEARCH`, `RESEARCH_DEPTH`, `RESEARCH_TIMEOUT`, `ISSUE_RETRY_MAX`, `PRP_COMMIT_FORMAT` |
| `[commit]`   | `retry_max`, `retry_delay_ms`, `retry_delay_cap_ms`, `classifier_retry_max` | `COMMIT_RETRY_MAX` / `_DELAY` / `_DELAY_CAP`, `CLASSIFIER_RETRY_MAX` |
```
**Action:** APPEND `commit_style`, `commit_style_examples` to the `[pipeline]` keys cell, and
`PRP_COMMIT_STYLE`, `PRP_COMMIT_STYLE_EXAMPLES` to the env-vars cell. (These two keys live in the
`[pipeline]` section per PRD §9.7.5 + the landed P1.M1.T1.S2 SCHEMA_MAP, NOT `[commit]`.)

### Zone A — commit env-var table (L255 `PRP_COMMIT_FORMAT` row)
Under `### Resilience Tuning` (L241). A 4-col table (Variable | Required | Default | Description).
`PRP_COMMIT_FORMAT` is the LAST row (L255). `COMMIT_RETRY_*` + `CLASSIFIER_RETRY_MAX` are above it.
The next line after L255 is blank → `### Distributed PRDs` (L257).
**Action:** INSERT TWO new rows immediately AFTER the `PRP_COMMIT_FORMAT` row (L255), before the
blank line + `### Distributed PRDs`:
- `PRP_COMMIT_STYLE` — No / `auto` / (style-layer description; four modes; `.hack` key `[pipeline] commit_style`; §5.1).
- `PRP_COMMIT_STYLE_EXAMPLES` — No / `5` / (examples count; int ≥ 0; `0` disables; `.hack` key `[pipeline] commit_style_examples`; §5.1).
**Placement rationale:** the existing doc put `PRP_COMMIT_FORMAT` in "Resilience Tuning" (the
commit-config home in THIS doc — it has no dedicated "Commit Configuration" subsection). The item
LOGIC (a) explicitly says "after the existing PRP_COMMIT_FORMAT row". So the two style rows sit
adjacent to PRP_COMMIT_FORMAT, matching the PRD §9.2.2 "Commit Configuration" grouping.

### Zone C — `## Task & Status Commands` (L805–824) → add `### hack update` subsection
Currently documents `hack status` / `hack task` / `hack task next` (the read-only trio + the
breakdown-in-progress blockquote). It ends at L823 (the blockquote) → blank → `---` (L824) →
`## See Also` (L826).
**Action:** INSERT a new `### \`hack update\` — manual status updates (PRD §5.4)` subsection AFTER
the breakdown-in-progress blockquote (L823) and BEFORE the `---`/`## See Also`. Content: command
syntax, fuzzy task-ID matching, fuzzy status matching (+ synonym table), cascade semantics,
lock/concurrency behavior (hard error on missing discovered tasks.json), output formats, error
cases. Keep it a SUMMARY (point to CLI_REFERENCE.md + PRD §5.4 for the exhaustive reference), mirroring
how the `hack config` section (L129–143) summarizes + points to CLI_REFERENCE.

## 3. ToC consideration

The ToC (L9–40) has a `[Task & Status Commands](#task--status-commands)` entry. A new `### hack
update` *subsection* under that existing heading does NOT need a new ToC entry (the heading anchor
`#task--status-commands` still lands on the section). Do NOT add a ToC bullet unless the existing
pattern adds sub-subsection anchors (it does not — the ToC stops at `###`-depth for most sections).

## 4. Formatting / validation for a docs-only task

- **prettier is the ONLY build gate that applies to `.md`** (`npm run format:check` globs
  `**/*.md`; `typecheck`/`eslint` gate `.ts` only). Run `npm run fix` (prettier --write) before
  format:check — the wide table rows (Zone A) + the new subsection (Zone C) may reflow; accept it.
- **Semantic gate = grep**: assert the two new env-var rows + the two new `.hack` keys + the
  `### hack update` subsection + the §5.1/§5.4 citations are present; assert `git diff --name-only`
  lists EXACTLY `docs/CONFIGURATION.md`.
- **No unit test** — docs-only. The sibling implementing tasks (P1.M1.* Complete, P1.M2.T4.S1
  in-flight) own the code + its tests; this task documents the user-facing knobs + command.

## 5. Disjointness / scope boundaries

- **EDIT:** `docs/CONFIGURATION.md` ONLY (the three zones above).
- **DO NOT EDIT:** `docs/ARCHITECTURE.md` (P1.M3.T1.S2 owns it — two-layer commit model + hack
  update note), `README.md` (P1.M3.T1.S3 owns it — commands list + style layer), `PROMPTS.md`,
  `PRD.md`/`spec/*`, `tasks.json`, `prd_snapshot.md`, any `src/`/`tests/` file.
- **Parallel sibling P1.M2.T4.S1** (in-flight) edits `src/cli/index.ts` (the `update` command) +
  `src/utils/task-utils.ts` (already Complete: normalizeTaskId/findItemByLooseId/matchStatus/
  cascadeCompleteDown/recomputeAncestorsUp) — ZERO `.md` overlap. This task documents the
  command that P1.M2.T4.S1 ships; treat its PRP as the contract (§1 above).