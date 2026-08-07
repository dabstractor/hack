# Research Notes — P1.M3.T1.S2 (docs/ARCHITECTURE.md: two-layer commit model + hack update note)

> Verified facts gathered while writing the PRP. This is a **Mode B documentation-sync**
> task: the single deliverable is an edited `docs/ARCHITECTURE.md`. No `src/`, no tests.

## 1. Scope boundary (disjoint from siblings)

| Sibling | File owned | This task's relation |
|---|---|---|
| **S1 (P1.M3.T1.S1)** | `docs/CONFIGURATION.md` (env-var rows + `.hack` keys + `### hack update` subsection) | **Different file — zero overlap.** Cross-REFERENCE it; do NOT duplicate. |
| **S2 (this)** | `docs/ARCHITECTURE.md` | The deliverable. |
| **S3 (P1.M3.T1.S3)** | `README.md` | Different file. Do NOT touch. |

This task edits **ONLY** `docs/ARCHITECTURE.md`. Do not touch `CONFIGURATION.md` (S1), `README.md`
(S3), `PRD.md`, `PROMPTS.md`, any `src/`, or any test.

## 2. The features are SHIPPED (docs must reflect reality, not aspiration)

Verified present in the working tree (so the docs describe real surfaces):

**Feature 1 — Commit Message Style Layer (P1.M1, all subtasks Complete):**
- `src/config/constants.ts`: `PRP_COMMIT_STYLE` (L796), `DEFAULT_PRP_COMMIT_STYLE='auto'` (L814),
  `type PrpCommitStyle = 'auto'|'plain'|'conventional'|'gitmoji'` (L828), `getPrpCommitStyle()`
  (L831+, **case-insensitive** trim+lowercase match, unknown→`'auto'`). Plus `PRP_COMMIT_STYLE_EXAMPLES`
  + `getPrpCommitStyleExamples()` (default 5; `0` disables).
- `src/tools/git-mcp.ts`: `getRecentCommitMessages(count, repoPath?)` (L583; exported L880). `count===0`→`[]`.
- `src/agents/commit-message-agent.ts`: `buildCommitMessageSystemPrompt(style, examples?)` (L303);
  `createCommitMessageAgent(systemPrompt?)` now accepts the dynamic prompt (defaults to the `plain`
  contract for backward compat). Compiled-in gitmoji reference table for `gitmoji` mode.
- `src/utils/git-commit.ts`: `generateCommitMessage` (L290+) resolves `getPrpCommitStyle()`, and under
  `'auto'` fetches the last-N commits via `getRecentCommitMessages` (N=`getPrpCommitStyleExamples()`)
  as style examples (degrades to `plain` for ≤1-commit repos / `EXAMPLES=0`), then drives
  `buildCommitMessageSystemPrompt` (imports at L31/40/48/49, JSDoc L305–310).

**Feature 2 — `hack update` (P1.M2.T1–T3 Complete; T4 Ready — CLI wired):**
- `src/utils/task-utils.ts`: `normalizeTaskId` (L135), `findItemByLooseId`, `matchStatus`,
  `cascadeCompleteDown`, `recomputeAncestorsUp` — all present.
- `src/cli/index.ts`: imports the five helpers (L52–55); `updateAction` (L907); `.command('update')`
  registered (L1040) with `<task-id> <status>` args + `-f/--session/-o` options (L1050).

→ Both features are real and configurable. The docs should describe them as shipped.

## 3. The exact edit site for Part (a) — the commit-message paragraph

`docs/ARCHITECTURE.md` is 1162 lines. The commit-message content is a SINGLE paragraph at **line 934**,
the trailing prose of the `### Two-Phase Commit (Per-Item Survival)` section (heading L925), which sits
under `## State Management and Persistence`. Verbatim current text (the `oldText` to replace):

> `Commit subjects use the \`<phase>.<milestone>.<task>.<subtask>:\` **task-prefix** by default
> (\`PRP_COMMIT_FORMAT=task-prefix\`; \`plain\` opts out; non-backlog commits carry no prefix) and
> **never** carry the legacy auto-generated banner prefix (PRD §5.1). The
> \`Co-Authored-By: Claude <noreply@anthropic.com>\` trailer is **preserved** on every commit. See
> [Configuration](CONFIGURATION.md#resilience-tuning) for the flag.`

This paragraph documents ONLY the **position layer** (`PRP_COMMIT_FORMAT`). Part (a) extends it to the
**two-layer model**: position layer (UNCHANGED) + style layer (`PRP_COMMIT_STYLE`, NEW). The preceding
line 932 ("This complements [tasks.json Protection…]…") STAYS — only line 934 is replaced.

Surrounding anchors (do NOT remove): L925 `### Two-Phase Commit (Per-Item Survival)`; L936
`### State Integrity Protections`. The new content sits between L932 and L936.

## 4. The exact edit site for Part (b) — the hack update note

There is **no dedicated "Task Management" section** in ARCHITECTURE.md. The closest is
`## Task Hierarchy and Execution Flow` (L949), whose subsections are: Four-Level Hierarchy (L953),
DFS Traversal Algorithm (L977), Dependency Resolution (L1020), Execution Flow Diagram (L1062, a mermaid
block). It is followed by a `---` separator and `## Adopt Mode (--adopt-prd)` (L1110).

→ Insert a new `### Manual Status Updates (`hack update`)` subsection at the **END of
`## Task Hierarchy and Execution Flow`** — i.e. AFTER the Execution Flow Diagram mermaid block, BEFORE
the `---`/`## Adopt Mode` separator. This is the "task-management area" the item names.

## 5. TOC + heading conventions (no TOC change needed)

The Table of Contents (L11–25) lists **only `##`-level sections**. Both edits add **`###` subsections**
within EXISTING `##` sections → **NO TOC update required**. (Do not touch the TOC.)

Markdown style observed: bold for key terms; backticks for code/IDs/env-vars; `PRD §X` citations;
tables with `| col | col |` rows (see "Hierarchy Levels" table L965); mermaid blocks;
`[Configuration](CONFIGURATION.md#resilience-tuning)` cross-references. MD024 is `siblings_only`
→ new `###` headings must be unique among their siblings (both proposed headings are unique).

## 6. Markdown validation tooling (the gate — no test suite for .md)

- `npm run docs:lint` = `markdownlint "docs/**/*.md"` (markdownlint-cli ^0.49.0 installed).
  Config `.markdownlint.json`: `MD013` (line-length) OFF; `MD024` `siblings_only:true` (no duplicate
  sibling headings); `MD036` (emphasis-as-heading) OFF; everything else default-true. → Watch blank
  lines around tables/lists (MD031/MD032) and duplicate sibling headings (MD024).
- `npm run docs:lint:fix` auto-fixes what it can.
- `npm run format` = `prettier --write "**/*.{ts,js,json,md,yml,yaml}"` (covers `.md`); run BEFORE
  `npm run format:check` (prettier will reflow the table + prose).
- `npm run validate` runs lint+format:check+typecheck+test:run — the test:run is PRE-EXISTING-RED
  (BUG-004, unrelated) and typecheck/lint are src-only; for THIS task the gate is **`docs:lint` +
  `format:check`** on the one file, plus grep/git-diff checks. Do NOT gate on `npm run test:run`.

## 7. Content accuracy cheat-sheet (what the new prose must say)

**Two-layer model (Part a):**
- Two ORTHOGONAL layers, resolved independently. `stagecoach` authors the descriptive message under
  the style contract FIRST; `formatCommitMessage` wraps the position layer AFTER. `[PRP Auto]` never emitted.
- Position layer `PRP_COMMIT_FORMAT` (`task-prefix` default | `plain`): UNCHANGED — `<p>.<m>.<t>.<s>:`
  prefix, trailing-level elision, non-backlog→plain, no `[PRP Auto]`. Never touches wording.
- Style layer `PRP_COMMIT_STYLE` (`auto` default | `plain` | `conventional` | `gitmoji`): NEW — governs
  the descriptive message's tone/length/type-prefix-or-emoji. `auto` learns from last
  `PRP_COMMIT_STYLE_EXAMPLES` (default 5) commits as VERBATIM style examples + anti-reuse +
  ignore-position-prefix instruction; degrades to `plain` for ≤1-commit repos or `EXAMPLES=0`. Explicit
  modes replace the examples block with the mode's contract (history consulted only under `auto`).
  Agent emits ONLY the descriptive message in every mode (no position prefix/banner/trailer).
- **Double-up:** when a prefix-producing style (`conventional`/`gitmoji`) meets `PRP_COMMIT_FORMAT=task-prefix`,
  BOTH prefixes render → `<position>: type(scope): description` (or `<position>: <emoji> description`);
  set `PRP_COMMIT_FORMAT=plain` for a clean style history. Same can happen under `auto` if learned style
  is conventional/gitmoji. Toggling affects only new messages; history never rewritten.
- Trailer preserved in both modes. Cross-ref CONFIGURATION.md for flags.

**hack update note (Part b) — SHORT:**
- `hack update <task-id> <status>` (PRD §5.4): manual status rewrite, fuzzy-matched on BOTH args
  (ID: canonical/concatenated/numeric with optional trailing segments; status: synonyms/canonical/prefix/substring, `r` ambiguous).
- Setting a parent `Complete` cascades `Complete` DOWN to all descendants; after any change ancestors
  recomputed bottom-up as the MIN (least-progressed) child status (Failed excluded unless all Failed;
  Obsolete terminal, loses ties to Complete).
- Serialized read-modify-write under the same `tasks.json.lock` as the orchestrator (§5.1), validated
  via the canonical backlog schema, written atomically — can't corrupt or race. Cross-ref CONFIGURATION.md
  for full syntax (S1 owns the detailed `### hack update` subsection there).

## 8. Risk register

- **MD024 duplicate-heading**: both new `###` headings are unique among siblings — clear.
- **MD031/MD032 (blanks around lists/tables)**: ensure blank lines fence the new table + bullet lists.
- **Fragile CONFIGURATION.md anchor for hack update**: S1's exact `### hack update` heading anchor is
  uncertain → link generically to `[Configuration](CONFIGURATION.md)` (safe) rather than a brittle
  `#hack-update` anchor. The commit-format cross-ref keeps the existing `#resilience-tuning` anchor
  (already used in the current doc).
- **Prettier reflow**: the new table + long prose will reflow under `npm run format` — that is EXPECTED
  and fine; run format FIRST, then format:check.
- **Scope creep**: do NOT also edit README.md (S3) or CONFIGURATION.md (S1). One file only.