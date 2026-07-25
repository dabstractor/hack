# README.md Staleness Map + Delta-to-Canonical Reference

Purpose: exact, audit-ready map of what in `README.md` is stale vs. the Phases 1–5
implementation, so the P6.M1.T1.S1 PRP can give the implementer surgical edit targets.
All line/section references are against the **current** `README.md` (root) unless noted.

## 0. Validation approach for a root-README (docs-only) task

- **PRIMARY automated gate:** `npx prettier --check README.md` → currently PASSES.
  README.md is in `format:check` scope (`**/*.md`); it is NOT in `.prettierignore`
  (which lists node_modules, dist, coverage, package-lock, artifacts, plan).
  `npm run validate` runs `format:check`, so it covers README too.
- **markdownlint is NOT a CI gate for README:** the `docs:lint` script targets
  `docs/**/*.md` only (not the root README). `.markdownlintignore` = `docs/api/`.
  Running `npx markdownlint README.md` shows PRE-EXISTING violations:
  MD033 (inline HTML in the badge `<p><a><img>` block, lines 3–21) and MD040
  (fence blocks without language at the Project Structure tree, lines 307/315/379/563).
  **These are acceptable baseline** (they exist today and ship fine). The implementer
  must NOT ADD new MD033/MD040 violations; new fenced blocks MUST specify a language
  (```bash / ```markdown / ```text) so MD040 doesn't grow.
- **Accuracy review (the real "test"):** every new claim cross-checked against the
  authoritative sources — `src/cli/index.ts` (flags), `.env.example` + `src/config/constants.ts`
  + `src/config/environment.ts` (canonical env vars + deprecation), `docs/CLI_REFERENCE.md`
  (the ALREADY-UPDATED sibling mirror — reuse its wording), and the PRD sections (provided
  in the PRP). README is the user-facing summary; CLI_REFERENCE is the exhaustive reference.
- **Links:** `npm run docs:links` only checks `docs/**/*.md`. For README, manually verify any
  new relative links/anchors resolve (e.g. `docs/CONFIGURATION.md#…`).

## 1. Canonical env-var naming (PRD §9.2.8) — REWRITE targets in README

Source of truth: `.env.example` (already canonical-first) + `src/config/constants.ts`
(`MODEL_NAMES`, `MODEL_ENV_VARS`, `LEGACY_MODEL_ENV_VARS`, `PRP_API_BASE_URL`) +
`src/config/environment.ts` (`getModel(tier)`, one-time deprecation warning).

| Canonical (PRIMARY)              | Legacy alias (DEPRECATED)         | Default                       |
| -------------------------------- | --------------------------------- | ----------------------------- |
| `PRP_API_BASE_URL`               | `ANTHROPIC_BASE_URL`              | z.ai endpoint for `zai`       |
| `PRP_MODEL_HIGH`                 | `ANTHROPIC_DEFAULT_OPUS_MODEL`    | `glm-5.2`                     |
| `PRP_MODEL_BALANCED`             | `ANTHROPIC_DEFAULT_SONNET_MODEL`  | `glm-5.2`                     |
| `PRP_MODEL_FAST`                 | `ANTHROPIC_DEFAULT_HAIKU_MODEL`   | `glm-5-turbo`                 |

Tier names renamed: `opus`→`high`, `sonnet`→`balanced`, `haiku`→`fast`.
Legacy names remain readable (one-time deprecation warning; slated for future removal).
**Provider-native credentials are NOT renamed:** `ZAI_API_KEY`, `ANTHROPIC_API_KEY`,
`ANTHROPIC_AUTH_TOKEN` stay as-is (§9.2.8 exception). `PRP_API_KEY` is the explicit
override (highest precedence, any provider).

### README sections that STILL show only legacy names (STALE — must rewrite to canonical)
- **"Configuration → Environment Variables" table** — rows `ANTHROPIC_BASE_URL`,
  `ANTHROPIC_DEFAULT_OPUS_MODEL`, `ANTHROPIC_DEFAULT_SONNET_MODEL`,
  `ANTHROPIC_DEFAULT_HAIKU_MODEL` shown as the PRIMARY names. Rewrite so canonical
  `PRP_*` are primary; demote legacy to a deprecation note.
- **"Configuration → Model Tiers"** (bullets) — "Opus/Sonnet/Haiku". Rewrite to
  high/balanced/fast.
- **"Configuration → z.ai Configuration → Model Tiers" table** — Opus/Sonnet/Haiku
  rows. Rewrite to high/balanced/fast.
- **"Configuration → z.ai Configuration → Example .env File"** — uncommented
  `ANTHROPIC_DEFAULT_OPUS_MODEL=…` etc. Rewrite to `PRP_MODEL_HIGH=…`.
- **Troubleshooting → "Model not found: glm-5.2"** — uses
  `ANTHROPIC_DEFAULT_SONNET_MODEL=…`. Rewrite to `PRP_MODEL_BALANCED=…`.
- **Troubleshooting → "`claude-code` harness + default `zai` models"** — uses
  `ANTHROPIC_DEFAULT_SONNET_MODEL=…`. Rewrite to `PRP_MODEL_BALANCED=…`.

## 2. CLI flags — what actually exists (src/cli/index.ts) vs. what README shows

- `--adopt-prd` (boolean, PRD §4.6) — README CLI table HAS it already. ✓ (but Usage
  Examples has NO "Adopt an Existing Codebase" block — add one).
- `--accept-prd-changes` (boolean, PRD §4.3) — README CLI table is MISSING it.
  Add the row + a Usage Example.
- `--validate` / `--bug-hunt` are NOT standalone boolean flags. They are VALUES of
  `--mode` (`--mode validate`, `--mode bug-hunt`). README CLI table already has the
  `--mode` row listing all four values, and "Usage Examples" has a "Bug Hunt Mode"
  block. **DO NOT invent `--validate`/`--bug-hunt` as separate flags** — that would
  be inaccurate to the implementation.
- `--validate-prd` (boolean) is a SEPARATE flag: validate PRD syntax & exit, no agent,
  no credential. Distinct from `--mode validate` (which runs the validation agent phase
  on a real session). README already documents both; keep them distinct.

## 3. New features to surface (Phases 1, 3, 4, 5) — README has NONE of these

- **Distributed / Multi-File PRDs (P1, PRD §2.3):** `@path/to/file.md` include directive,
  project-root-relative resolution, recursive expansion w/ cycle detection up to
  `PRD_INCLUDE_MAX_DEPTH` (default 10), optional `PRD_INCLUDE_MARKERS`, stale-include
  stderr warning, single canonical resolved document downstream (hashing/snapshot/
  delta/selectors/mdsel all operate on the resolved doc), `prd_selectors` field feeds
  researchers only the relevant sections. README has no section — ADD one.
- **Depth-chained parallel research (P3, PRD §4.2):** `PARALLEL_RESEARCH` +
  `RESEARCH_DEPTH` (default 2) — supervisor prefetches a CHAIN of items ahead;
  `RESEARCH_TIMEOUT` (default 1800s) deadline → synchronous inline fallback;
  forwarded to bugfix child. README "Self-Healing & Resilience" mentions research
  deadline already but NOT the depth-chain. ADD.
- **Two-phase commit (P3, PRD §4.2 step 4 / §5.1):** pre-cleanup survival commit
  (source + plan/ + Complete status) via `stagecoach` Smart Commit, then post-cleanup
  commit for doc reorg. Prevents "Complete on disk but uncommitted" orphaned plan/
  dirs. README mentions smart git integration but NOT the two-phase structure. ADD.
- **State integrity protection (P3, PRD §5.1):** flock-based process-level mutex on
  tasks.json read-modify-write; `restore_critical_files` in smartCommit; status
  delta re-apply after each agent run (discards unauthorized mutations) + git-history
  restore; snapshot-before-revert gated on FS evidence; watchdog kills (exit 124) are
  terminal (never retried). README "Self-Healing" mentions tasks.json recovery —
  ADD the flock mutex + restore_critical_files + watchdog-terminal specifics.
- **Change classification (P4, PRD §4.3):** COSMETIC/SUBSTANTIVE + CLEAN/DIRTY LLM
  classifiers with transient-API retry → protective default on exhaustion.
- **NO_ISSUES_FOUND.md marker (P4, PRD §4.4):** clean hunt persists a marker
  (timestamp, session, tasks.json hash, bug-finder agent); distinguishes "already
  hunted" from "never hunted".

## 4. prd status / prd task (P2, PRD §5.3) — README has NOTHING

README never mentions the `task`/`status` subcommands. ADD a Usage/subcommand note:
`prd status` (alias of `prd task`, git muscle memory), `prd task next`,
`prd task status`, `prd task -f <file>`. Task-file discovery priority: incomplete
bugfix session tasks first, then main session tasks.

## 5. §9.2.6 auth (session 007) — README is ALREADY in sync; reconcile = cross-check only

README "How It Works → Authentication is provider-aware" already documents: override
(`PRP_API_KEY`) → provider-native env (`ZAI_API_KEY`; `ANTHROPIC_OAUTH_TOKEN`→
`ANTHROPIC_API_KEY` for `anthropic`) → `~/.pi/agent/auth.json` (`pi /login`);
empty = not configured; `ANTHROPIC_BASE_URL` z.ai default; backward-compat alias note;
preflight (§9.2.7). **No auth rewrite needed** — (f) just means: while rewriting (c)'s
config table, do NOT break this auth narrative, and keep `ANTHROPIC_AUTH_TOKEN` as a
provider-native credential (it is NOT a pipeline-global var, so NOT renamed). Verify the
env-vars table rewrite still lists `ZAI_API_KEY`, `PRP_API_KEY`,
`ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` with the §9.2.6 framing.

## 6. Sibling doc subtasks (P6.M1.T1.S2 / S3) — NO overlap

- S2 = `docs/ARCHITECTURE.md` (resolved-document invariant + new behaviors).
- S3 = `docs/CONFIGURATION.md` (canonical env-var reference).
- **S1 (this) = `README.md` only.** README LINKS to those docs; it must not duplicate
  their exhaustive detail. Keep README a high-level summary; deep links go to
  `docs/CONFIGURATION.md` / `docs/ARCHITECTURE.md` / `docs/CLI_REFERENCE.md`.
- `docs/CLI_REFERENCE.md` is ALREADY fully updated (has `--adopt-prd`,
  `--accept-prd-changes`, `prd status` alias, canonical tier names, `--mode` table).
  Use it as the wording reference for README.

## 7. In-scope edit inventory (the implementer's checklist)

README sections to MODIFY:
1. "Features" bullets — add distributed PRDs, depth-chained research, two-phase commit.
2. "Self-Healing & Resilience" — add depth-chained research, two-phase commit, integrity
   protection (flock/restore_critical_files/watchdog-terminal/NO_ISSUES_FOUND).
3. "Usage Examples" — add "Adopt an Existing Codebase (--adopt-prd)",
   "Accept PRD Edits as Baseline (--accept-prd-changes)", "Task Status (prd status)".
4. "CLI Options" table — add `--accept-prd-changes` row (keep `--adopt-prd`,
   `--mode validate`/`--mode bug-hunt`, `--validate-prd`).
5. "Configuration → Environment Variables" table — rewrite to canonical `PRP_*` primary
   + legacy deprecation note.
6. "Configuration → Model Tiers" + "z.ai Configuration → Model Tiers" — high/balanced/fast.
7. "z.ai Configuration → Example .env File" — canonical `PRP_*`.
8. Troubleshooting model/harness examples — `PRP_MODEL_BALANCED`.

README sections to ADD:
9. New "Distributed (Multi-File) PRDs" subsection (PRD §2.3) — include directives,
   prd_selectors, env knobs.
10. (Optional) New "Task Status & Querying" subsection (prd status / prd task).