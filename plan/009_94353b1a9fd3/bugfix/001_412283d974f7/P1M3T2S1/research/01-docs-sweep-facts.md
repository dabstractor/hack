# Research Notes — P1.M3.T2.S1 (changeset-level docs sweep: BUG-001/002/003)

> Documentation-only (Mode B). Verified against the working tree + the implemented source at research time.
> The three code fixes are DONE (BUG-001) / in-flight (BUG-003) / DONE (BUG-002); this item sweeps the
> external `docs/*.md` + `README.md` to accurately reflect them. NO source/test changes.

## The changeset being documented (the 3 fixes)

### BUG-001 (Critical, DONE) — subcommands now resolve at the repo root
- **Root cause (was):** subcommand `.action()` handlers run INSIDE `program.parse()` (inside
  `parseCLIArgs()`), BEFORE `main()`'s `process.chdir(repoRoot)`. So 6 of 7 subcommands
  (task/status/cache/inspect/artifacts/validate-state) resolved `plan/`+`PRD.md` against INVOCATION_CWD.
- **Fix (DONE):** `program.hook('preAction', …)` at **`src/cli/index.ts:852`** calls `bootstrapRepoRoot()`
  (idempotent resolve + `process.chdir`) for the root default path AND EVERY subcommand, AFTER options are
  parsed (`program.opts()` has `--repo-root`), BEFORE the action body. `main()` now reads the cached
  `getRepoRoot()` singleton (`src/index.ts:143`) instead of doing the chdir itself.
  - The hook is **idempotent** (`_bootstrapped` guard in `bootstrapRepoRoot`, `src/utils/repo-root.ts`) so
    the program+subcommand double-fire is a no-op.
  - `--help`/`--version` short-circuit during parse before any action → hook does NOT fire (they work anywhere).
  - A hook-thrown `NotARepositoryError` propagates through `program.parse()` → `main().catch()`'s dedicated
    clean arm (single `❌` line, no stack).
  - `INVOCATION_CWD` is captured at module scope in `src/index.ts` (for `--prd` pre-resolution); `--repo-root`
    short-circuits the upward `.git` search (§9.8.6).
- **Behavioral outcome:** ALL subcommands (`task`/`status`/`cache`/`inspect`/`artifacts`/`validate-state`/`config`)
  resolve `plan/`, `PRD.md`, `.hack`, `.env` at the repo root from any cwd inside the repo; outside any repo →
  exit 1 with the `NotARepositoryError` + `--repo-root` remediation (§9.8.5/§9.8.7/§9.8.9).

### BUG-002 (Minor, DONE) — config errors render cleanly
- **Was:** `.hack` validation/secrets/BOM errors rendered via `main()`'s DEFAULT catch arm
  (`❌ Fatal error in main():` + full stack trace), inconsistent with the clean single-line arms for
  `NotARepositoryError`/`AuthPreflightError`/etc.
- **Fix (DONE):** `HackConfigError` typed class (`src/config/types.ts`) at the 9 throw sites +
  `EnvironmentValidationError`; dedicated clean `main().catch()` arms print a single `❌ <message>` line
  (no stack). The `config` subcommand's own catch now detects `NotARepositoryError` + renders cleanly too.

### BUG-003 (Minor, in-flight = P1.M3.T1.S1) — relational constraint enforced
- **Was:** `[commit] retry_delay_cap_ms` validated only as `int >= 0`; cap < delay silently accepted.
- **Fix (P1.M3.T1.S1, parallel):** post-per-key relational check in `validateHackTier` (the chokepoint both
  `hack config validate` + startup `loadHackConfig` funnel through) throws `HackConfigError` when
  `retry_delay_cap_ms < retry_delay_ms` (both present). Message: `[commit] retry_delay_cap_ms in <file>:
  <cap> is less than retry_delay_ms (<delay>); the cap must be ≥ the base delay.` The two "DOCUMENTED GAP"
  comments are removed/updated.

## The 4 docs — current state + the needed edit (verified)

### docs/CONFIGURATION.md
- **Schema summary table (line 95):** `[commit]` row lists `retry_max, retry_delay_ms, retry_delay_cap_ms,
  classifier_retry_max` — NO relational-constraint note. The notes block after the table (lines 110-113)
  covers env-over-file + secrets policy + "type/range/enum mismatches are hard errors" but NOT the cross-key
  relational constraint or its enforcement.
- **`COMMIT_RETRY_DELAY_CAP` env-var row (line 240):** "Maximum delay cap in milliseconds … See PRD §5.1." —
  does NOT mention it must be ≥ `COMMIT_RETRY_DELAY` nor that it's enforced.
- **EDIT (BUG-003):** add a relational-constraint note in the schema-summary notes block; append the
  constraint to the `COMMIT_RETRY_DELAY_CAP` env-var row.
- **EDIT (BUG-002, light):** the notes block says type/range/enum/secrets are hard errors but not HOW they
  render. Add that a misconfigured `.hack` surfaces as a single actionable `❌` line at startup (no stack),
  mirroring §9.2.7 fail-fast. (Honors the OUTPUT point "config errors render cleanly".)

### docs/CLI_REFERENCE.md
- **Task Management section (line 172-212):** documents `hack task`/`hack status` + breakdown-in-progress.
  NO run-from-anywhere note. (cache/inspect/artifacts/validate-state are NOT separately documented as
  sections — only Task Management + Configuration Management have subcommand sections.)
- **Configuration Management section (216-):** `hack config` — already mentions `validate` rejects hard
  errors; no run-from-anywhere note.
- **EDIT (BUG-001):** add a "Run from anywhere" note (after the Task Management breakdown-in-progress note,
  ~line 210) that ALL subcommands (`task`/`status`/`cache`/`inspect`/`artifacts`/`validate-state`/`config`)
  resolve `plan/`/`PRD.md`/`.hack`/`.env` at the repo root regardless of invocation dir (§9.8.7/§9.8.9),
  via the `preAction` hook; `--repo-root` pins; outside-repo → `NotARepositoryError` exit 1.

### docs/ARCHITECTURE.md
- **Bootstrap Layer (lines 87-135):** the prose ("parses the CLI, resolves and chdirs…") + the **mermaid
  diagram** (`A[parseCLIArgs] --> B[resolveRepositoryRoot + chdir]`) + the **step table** (step 1
  `parseCLIArgs()`, step 2 capture INVOCATION_CWD, step 3 `resolveRepositoryRoot`+`chdir`) describe the
  chdir as a SEQUENTIAL step AFTER `parseCLIArgs()`. **This is the BUG-001 root-cause model and is now
  INACCURATE:** the chdir runs DURING `program.parse()` via the `preAction` hook (before each action handler),
  so subcommands resolve correctly; `main()` reads the cached `getRepoRoot()` singleton.
- **EDIT (BUG-001):** update the prose + mermaid + step table to reflect the `preAction` hook (chdir during
  parse, not after); add that subcommand action handlers run AFTER the chdir; main reads the singleton.

### README.md
- **"Running from Anywhere" section (lines 108-126):** ALREADY accurate post-fix (walks up to `.git`,
  chdirs, resolves `PRD.md`/`plan/`/`.hack`/`.env` at root; example `cd src/core/deep/nested && hack status`;
  `NotARepositoryError` + `--repo-root` remediation). **Gap:** does NOT explicitly state ALL subcommands
  benefit — frames it generically ("the same invocation works from anywhere") + shows only `hack status`.
- **Features list (lines 138-160):** does NOT include run-from-anywhere as a bullet (lists 4 engines,
  decomposition, distributed PRDs, delta, QA, scoped, resumable, validation, git, perf, research, two-phase,
  state-integrity, self-healing). The dedicated section (108) is the canonical home — do NOT add a redundant
  Features bullet (keep minimal).
- **EDIT (BUG-001):** add ONE sentence to the "Running from Anywhere" section enumerating that every
  subcommand (`task`/`status`/`cache`/`inspect`/`artifacts`/`validate-state`/`config`) resolves at the repo
  root, not just the default pipeline run.

## Key accuracy facts for the prescribed prose (cite the source)
- `preAction` hook: **`src/cli/index.ts:852`**; `bootstrapRepoRoot()` helper: **`src/utils/repo-root.ts`**;
  `main()` reads singleton: **`src/index.ts:143`** (`getRepoRoot()`).
- Hook fires AFTER options parsed + BEFORE the action body; idempotent (`_bootstrapped`); `--help`/`--version`
  short-circuit before it (they work anywhere); `NotARepositoryError` propagates to the clean `main().catch()`.
- Relational check: **`validateHackTier`** (`src/config/hack-config.ts`) — single chokepoint for BOTH
  `hack config validate` (per-file) AND startup `loadHackConfig` (per-tier). Per-tier scope; cross-tier is a
  KNOWN/ACCEPTED limitation. Defaults (delay 10000 / cap 120000) satisfy it.
- Clean rendering: `HackConfigError` + `EnvironmentValidationError` dedicated `main().catch()` arms
  (`src/index.ts`) → single `❌ <message>` line, no stack.
- PRD sections: §9.8.3 (strategy), §9.8.7/§9.8.9 (run-from-anywhere acceptance), §9.8.5 (NotARepositoryError),
  §9.8.6 (--repo-root), §9.7.5 (schema incl. relational), §9.7.7 (hard errors), §9.2.7 (fail-fast).

## Scope boundary (what this item does NOT touch)
- ANY source file (`src/**`), ANY test file (`tests/**`), `package.json`, the architecture/ docs.
- BUG-002 catch-arm CODE (DONE) + BUG-003 CODE (P1.M3.T1.S1) — this item only documents them in `docs/*.md` + `README.md`.
- Other docs (INSTALLATION.md, TESTING.md, WORKFLOWS.md, user-guide.md, CUSTOM_*.md) — NOT affected by these 3 fixes.

## Validation approach (docs-only)
- No code change → typecheck/lint/format:check stay clean (run them to confirm no accidental breakage).
- Markdown: verify edited files parse (headings/tables/code fences intact); verify any NEW internal anchor
  links resolve (grep the target heading); verify the 4 files still reference each other correctly.
- Accuracy: cross-reference the prescribed prose against the implemented source (the line cites above) +
  the PRD sections (cited above). The implementer should `grep` the cited source lines to confirm.