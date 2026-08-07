# Research Notes — P1.M3.T1.S3 (Update README.md — hack update + commit style layer)

> Source of truth for the PRP. Every claim verified against the working tree (HEAD) + the landed
> S1 doc (CONFIGURATION.md is COMPLETE) + the sibling S2 PRP (ARCHITECTURE.md, parallel). Captured
> via direct reads (the surface is a single README.md + 2 cross-link targets; no delegation needed).

## 1. The deliverable surface (the ONLY file S3 edits: `README.md`)

`README.md` is 890 lines. Two features must land in it:

### 1a. `hack update` command — TWO homes where CLI commands are listed

**Home 1 — the subcommand enumeration list (L114–115), `## Running from Anywhere`:**
```
This applies to **every** subcommand — `task`, `status`, `cache`, `inspect`, `artifacts`, `validate-state`,
and `config` — not just the default pipeline run, …
```
`hack update` resolves the repo root the same way (it runs `findLatestSession` etc.), so `update` belongs
in this list. Add `update` alongside `task`/`status`. (Small, safe, complete.)

**Home 2 — a NEW `### Manual Status Update (hack update)` subsection** inserted AFTER the existing
`### Task Status (hack status / hack task)` block (ends ~L310) and BEFORE `### Resume Interrupted Session`
(L312). This mirrors how `hack status`/`hack task` are presented (prose + bash block + cross-link) and is
the canonical commands-list home. Heading-uniqueness (markdownlint MD024 `siblings_only`): the new heading
`### Manual Status Update (hack update)` is unique among the L284–312 siblings (`Task Status`, `Resume
Interrupted Session`) — verified via the `### ` grep. PASS.

The current `### Task Status (hack status / hack task)` block (L284–310) has: a prose intro, a ```bash
block (4 commands: `hack status`, `hack task`, `hack task next`, `hack task status`), and a
breakdown-in-progress callout. Model the new subsection on this shape (prose + ```bash block + callout).

### 1b. Commit style layer — the Environment Variables table (L386–398)

The README's ONLY commit-format surface is the env-var table row at **L398**:
```
| `PRP_COMMIT_FORMAT`    | No       | `task-prefix`                    | `task-prefix`/`plain`: [Config](docs/CONFIGURATION.md#resilience-tuning)       |
```
The table (L386–398) has 4 columns: `Variable | Required | Default | Description`. The commit row is the
LAST data row; the table is followed (L400) by the deprecation `>` callout. There is NO other commit-
format/style description in README (the "Self-Healing & Resilience" L163 section + "Two-Phase Commits"
bullets describe commit TIMING/resilience, not FORMAT/style). So L398 is THE place.

**Edit:** tweak the `PRP_COMMIT_FORMAT` row's Description to note it is the **position layer**, orthogonal
to a new **style layer**, and ADD two new rows: `PRP_COMMIT_STYLE` and `PRP_COMMIT_STYLE_EXAMPLES` — each
linking to the stable `docs/CONFIGURATION.md#resilience-tuning` anchor (S1's section, verified present at
CONFIGURATION.md L241, contains all three commit rows at L255–257). prettier reflows table column widths,
so do NOT hand-pad — match the 4-column structure and let `npm run format` align.

## 2. The contract this realizes

### 2a. Feature 3 doc map — `architecture/implementation-status.md` §"Feature 3" (verbatim table row)

> | `README.md` | `hack update` in commands list; style layer in commit-behavior section |

(Lines 417.) The other two rows: `docs/CONFIGURATION.md` (S1, DONE) + `docs/ARCHITECTURE.md` (S2,
parallel). S3 owns ONLY README.md.

### 2b. PRD §5.4 (hack update) — provided in `selected_prd_content`

- Command: `hack update <task-id> <status> [-f <file>] [--session <hash>] [-o text|json]`.
- Fuzzy ID: canonical / concatenated / numeric (`1.1.1.1`, `1.2`); trailing segments optional.
- Fuzzy status: synonyms (`done`/`re`/`comp`), canonical, prefix, substring; `r` ambiguous → Ready/Researching.
- Cascade: parent→Complete cascades down; ancestors recompute bottom-up as MIN (Failed excluded unless all
  Failed; Obsolete terminal, loses ties to Complete).
- Concurrency: serialized under `tasks.json.lock` + atomic (temp+rename).
- Output: `Updated <ID> status to <Status>` (text) / `{id,status,title}` (json); errors → stderr + nonzero.

### 2c. PRD §5.1 style layer — provided in `selected_prd_content`

Two orthogonal layers: **position** (`PRP_COMMIT_FORMAT`, `task-prefix`|`plain`) + **style**
(`PRP_COMMIT_STYLE`, `auto`|`plain`|`conventional`|`gitmoji`). `auto` learns from the last
`PRP_COMMIT_STYLE_EXAMPLES` (default 5) commits (verbatim examples + anti-reuse + ignore-position-prefix;
≤1 commit or `EXAMPLES=0` → `plain`). README keeps this TERSE (rows link out to CONFIGURATION.md for
detail — S1 carries the full prose; ARCHITECTURE.md S2 carries the two-layer model).

## 3. Shipped symbols (verified, read-only — the prose names real surfaces)

- `src/config/constants.ts`: `PRP_COMMIT_STYLE` (L796), `DEFAULT_PRP_COMMIT_STYLE='auto'` (L814),
  `PrpCommitStyle='auto'|'plain'|'conventional'|'gitmoji'` (L828), `getPrpCommitStyle()` (case-INSENSITIVE).
  (Plus `PRP_COMMIT_STYLE_EXAMPLES` / `DEFAULT_PRP_COMMIT_STYLE_EXAMPLES=5`.)
- `src/cli/index.ts`: `.command('update')` (L1040) → `updateAction` (L907).
- `src/utils/task-utils.ts`: `normalizeTaskId` (L135), `findItemByLooseId` (L166), `matchStatus` (L978),
  `cascadeCompleteDown` (L616), `recomputeAncestorsUp` (L834). (hack update cascade/lock behavior shipped.)
- `src/agents/commit-message-agent.ts`: `buildCommitMessageSystemPrompt(style, examples?)` (L303) — dynamic
  per-mode prompt builder; prior `COMMIT_MESSAGE_SYSTEM` is the `plain` contract.
- `src/utils/git-commit.ts`: `generateCommitMessage` resolves `getPrpCommitStyle()`, under `auto` fetches
  `getRecentCommitMessages` (`src/tools/git-mcp.ts:583`) as examples (degrades to plain ≤1 commit /
  EXAMPLES=0); `formatCommitMessage` wraps the position prefix AFTER. Confirms two-layer ordering.

## 4. Cross-link anchors (verified stable — S1 LANDED)

- **Commit flags:** `docs/CONFIGURATION.md#resilience-tuning` — CONFIGURATION.md `### Resilience Tuning`
  (L241) holds all 3 commit rows (L255–257). STABLE. (README already uses this anchor at L191, L398.)
- **hack update syntax:** `docs/CONFIGURATION.md#task--status-commands` — CONFIGURATION.md
  `## Task & Status Commands` (L807) holds S1's `### \`hack update\` — manual status updates (PRD §5.4)`
  subsection (L828). Use the SECTION anchor (`#task--status-commands`), NOT the fragile
  `### \`hack update\` — manual status updates (PRD §5.4)` heading anchor (backticks/parens/`§` make it
  brittle). The section anchor is stable + contains the subsection.

## 5. Validation gate (verified)

- `npm run format` / `npm run format:check` = `prettier --write/--check "**/*.{ts,js,json,md,yml,yaml}"`
  → **covers README.md** (root). This is the PRIMARY gate. (Verified: `npx prettier --check README.md`
  currently PASSES.)
- `npm run docs:lint` = `markdownlint "docs/**/*.md"` → does **NOT** cover README.md (root). So markdownlint
  is NOT a gate for README. BUT follow `.markdownlint.json` conventions for safety (MD013 line-length OFF;
  MD024 `siblings_only`; MD036 OFF; MD031/MD032 blanks around code block/table — blank lines already fence
  the existing ```bash blocks + the env-var table). The new subsection + table rows must keep blank-line
  fencing.
- `npm run lint` / `npm run typecheck` = src-only (`eslint . --ext .ts` / `tsc`) → irrelevant to a `.md`
  edit. `npm run test:run` = pre-existing RED (BUG-004) → not a gate.
- `git diff --name-only` ⇒ MUST list exactly `README.md`.

## 6. Out-of-scope (hard boundaries — DO NOT touch in S3)

- `docs/CONFIGURATION.md` — S1 (DONE; all 3 commit rows + the `### \`hack update\`` subsection landed).
- `docs/ARCHITECTURE.md` — S2 (parallel; two-layer model + hack-update short note).
- `docs/CLI_REFERENCE.md` — NOT in the Feature 3 table; out of scope (the item names README only).
- `PRD.md`, `PROMPTS.md`, `tasks.json`, `prd_snapshot.md`, any `src/`/`tests/` — never.
- The README's other sections (Features bullets, Self-Healing & Resilience, CLI Options table, etc.) —
  UNCHANGED (they don't describe commit format/style; the env-var table is the sole format surface).

## 7. Confidence drivers

- Single file, ~3 localized edits (subcommand-list word +1, +1 subsection, +2 table rows + 1 row tweak),
  zero code/test risk.
- S1 already landed → cross-link anchors are VERIFIED stable (no guessing).
- Both features are shipped (grep-verified symbols) → describe as-built, present tense.
- The new subsection + table rows are prescribed verbatim (matching README's existing prose density +
  the Task Status subsection shape).
- Non-obvious risks all enumerated: (a) prettier reflows the table (run `npm run format` first); (b)
  blank-line fence the ```bash block + table (MD031/MD032, though not gated — keep consistent); (c) use
  the SECTION anchor `#task--status-commands` for hack-update (not the fragile heading anchor); (d) the
  `### Manual Status Update (hack update)` heading is unique among siblings (MD024 siblings_only); (e)
  do NOT duplicate the full two-layer prose (S2 ARCHITECTURE.md owns it) — README rows link out.