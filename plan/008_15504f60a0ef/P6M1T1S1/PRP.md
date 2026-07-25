# PRP — P6.M1.T1.S1: Update README.md with all new features and flags

---

## Goal

**Feature Goal**: Bring the root `README.md` into sync with every delta feature shipped in
Phases 1–5 of session 008, so a new reader's first impression of the pipeline reflects what
the code actually does today. Concretely: document the **distributed (multi-file) PRD**
feature (P1), the **canonical `PRP_*` config names** with an `ANTHROPIC_*` deprecation note
(P2), the **`--adopt-prd` / `--accept-prd-changes` flags** and the **validate/bug-hunt
modes** (P4/P5), the **`prd status` alias** (P2), and the **depth-chained research /
two-phase commit / state-integrity-protection** behaviors (P3/P4) — while confirming the
§9.2.6 provider-aware auth narrative (session 007) stays consistent.

**Deliverable**: An updated `README.md` (root, single file) whose Features list, Usage
Examples, CLI Options table, Configuration section (env vars + model tiers + example
.env), Self-Healing & Resilience section, and Troubleshooting section all reflect the
canonical/current names and behaviors. Two short new subsections are added (Distributed
PRDs; Task Status / `prd status`). README remains a high-level summary that deep-links to
`docs/CONFIGURATION.md`, `docs/ARCHITECTURE.md`, and `docs/CLI_REFERENCE.md` rather than
duplicating their exhaustive detail.

**Success Definition**: Every claim in the updated README is accurate against the
implementation — flags match `src/cli/index.ts`; env-var names match `.env.example` +
`src/config/constants.ts`; tier names match the `high`/`balanced`/`fast` rename; new
behaviors match the PRD sections cited. `npx prettier --check README.md` PASSES (it is the
one automated gate that covers the root README); `npm run validate` GREEN; no NEW
markdownlint violations beyond the pre-existing MD033/MD040 baseline; `git diff --name-only`
= exactly `README.md` (plus the PRP's own plan/ artifacts).

---

## User Persona (if applicable)

**Target User**: A developer/operators reading the project README on GitHub (or locally) to
understand what the pipeline does, how to configure it, and what flags exist — before
reading the deeper `docs/`.

**Use Case**: Skim Features → Quick Start → Usage Examples → Configuration, then jump to
`docs/CLI_REFERENCE.md` / `docs/CONFIGURATION.md` for depth. They must not be misled by
stale `ANTHROPIC_*_MODEL` names or missing flags.

**User Journey**: Land on README → see distributed-PRD capability → see canonical config
names (and the deprecation note for the old ones) → see the new flags (`--adopt-prd`,
`--accept-prd-changes`) and modes (`--mode validate`/`--mode bug-hunt`) → run their first
pipeline. A user who previously configured the old names sees the deprecation note and
knows to migrate.

**Pain Points Addressed**: Today's README (a) shows only deprecated `ANTHROPIC_*` config
names as primary, (b) uses the old Opus/Sonnet/Haiku tier names, (c) omits the distributed-
PRD feature entirely, (d) omits `--accept-prd-changes`, the `prd status` alias, depth-chained
research, two-phase commit, and integrity protection. New readers get a stale picture.

---

## Why

- **Work-item CONTRACT mapping (verbatim from item description):**
  - **(1) RESEARCH NOTE** — PRD §6 (Phase 6) specifies README.md should add: the
    distributed-PRD feature; the `--adopt-prd` / `--accept-prd-changes` / `--validate` /
    `--bug-hunt` flags; the canonical (`PRP_*`) config names (with `ANTHROPIC_*` deprecation
    note); the depth-chained research + two-phase commit + integrity-protection behavior;
    and the `prd status` alias. Reconcile with the §9.2.6 auth rewrite landed in 007.
    *(See "Flag reconciliation" gotcha below: `--validate`/`--bug-hunt` are `--mode` values,
    not standalone flags.)*
  - **(2) INPUT** — all implementing subtasks from Phases 1–5 (all marked Complete/Ready in
    `<plan_status>`).
  - **(3) LOGIC** — (a) distributed-PRD feature description; (b) the four flags surfaced in
    usage/CLI; (c) canonical `PRP_*` names + deprecation note; (d) depth-chained research +
    two-phase commit + integrity protection; (e) `prd status` alias; (f) reconcile §9.2.6.
  - **(4) OUTPUT** — updated README reflecting all delta features; no further subtask consumes
    it; completes part of P6.M1.
  - **(5) DOCS** — [Mode B] this IS the documentation task (changeset-level sweep).
- **PRD compliance**: §2.3 (distributed PRDs), §4.2 (depth-chained research + two-phase
  commit step 4), §4.3 (`--accept-prd-changes`), §4.4 (NO_ISSUES_FOUND), §4.6 (`--adopt-prd`),
  §5.1 (integrity protection), §5.3 (`prd status` alias), §9.2.6/§9.2.7 (auth + preflight),
  §9.2.8 (canonical naming).
- **Sibling coordination**: P6.M1.T1.S2 owns `docs/ARCHITECTURE.md`; P6.M1.T1.S3 owns
  `docs/CONFIGURATION.md`. This item owns `README.md` **only** and links out to those docs.
  `docs/CLI_REFERENCE.md` is ALREADY updated and is the wording reference for README.

---

## What

A documentation-only (Mode B) update to the single file `README.md`. No source code, no
tests, no config files, no other docs are touched. The edits:

1. **Features list** — add bullets for distributed/multi-file PRDs, depth-chained parallel
   research, two-phase commits, and state-integrity protection.
2. **Self-Healing & Resilience** — extend with depth-chained research (`RESEARCH_DEPTH` +
   synchronous fallback), the two-phase commit (pre-cleanup survival commit + post-cleanup
   commit via `stagecoach`), and integrity protection (flock mutex on `tasks.json`,
   `restore_critical_files`, watchdog kills terminal, `NO_ISSUES_FOUND.md` marker).
3. **Usage Examples** — add "Adopt an Existing Codebase (`--adopt-prd`)", "Accept PRD Edits
   as Baseline (`--accept-prd-changes`)", and "Task Status (`prd status`)" blocks.
4. **CLI Options table** — add an `--accept-prd-changes` row; keep `--adopt-prd`, the
   `--mode` row (which already lists `validate`/`bug-hunt`), and `--validate-prd`.
5. **Configuration → Environment Variables** — rewrite the table so canonical `PRP_*` names
   are primary and the legacy `ANTHROPIC_*` names are a deprecation note.
6. **Model Tiers** (two places: the bullets and the z.ai table) — rename Opus/Sonnet/Haiku →
   high/balanced/fast.
7. **Example .env File** — use canonical `PRP_*` names.
8. **Troubleshooting** — switch the model/harness examples to `PRP_MODEL_BALANCED`.
9. **NEW subsection "Distributed (Multi-File) PRDs"** — include directives, `prd_selectors`,
   env knobs (`PRD_INCLUDE_MAX_DEPTH`, `PRD_INCLUDE_MARKERS`).
10. **NEW subsection "Task Status & Querying"** — `prd status` / `prd task` alias + examples.

The §9.2.6 auth narrative ("How It Works → Authentication is provider-aware") is **already
accurate** and is NOT rewritten — requirement (f) is satisfied by confirming, during the
Configuration rewrite, that the auth resolution order (override → provider env → `auth.json`)
and the `ANTHROPIC_AUTH_TOKEN` backward-compat note remain intact and that no stale
`ANTHROPIC_*_MODEL` names leak back into the table.

### Success Criteria

- [ ] `--accept-prd-changes` is present in the CLI Options table; `--adopt-prd` remains;
      validate/bug-hunt are documented as `--mode` values (NOT invented as standalone flags).
- [ ] The Environment Variables table lists `PRP_API_BASE_URL`, `PRP_MODEL_HIGH`,
      `PRP_MODEL_BALANCED`, `PRP_MODEL_FAST` as PRIMARY, with a deprecation note for the
      `ANTHROPIC_*` legacy aliases; `ZAI_API_KEY`, `PRP_API_KEY`, `ANTHROPIC_API_KEY`/
      `ANTHROPIC_AUTH_TOKEN` retained as provider-native credentials.
- [ ] Model Tiers (both places) use high/balanced/fast; Opus/Sonnet/Haiku appear only (if at
      all) as the legacy mapping in the deprecation note.
- [ ] A "Distributed (Multi-File) PRDs" subsection exists and mentions `@path/to/file.md`
      include directives, project-root-relative resolution, the single canonical resolved
      document downstream, `PRD_INCLUDE_MAX_DEPTH` (default 10), `PRD_INCLUDE_MARKERS`, and
      `prd_selectors`.
- [ ] `prd status` (alias of `prd task`) is mentioned with at least one example.
- [ ] Self-Healing & Resilience covers depth-chained research, the two-phase commit, and
      integrity protection (flock/restore_critical_files/watchdog-terminal/NO_ISSUES_FOUND).
- [ ] The §9.2.6 auth narrative is unchanged and consistent with the rewritten config table.
- [ ] `npx prettier --check README.md` PASSES; `npm run validate` GREEN; no NEW markdownlint
      violations (pre-existing MD033 badge HTML + MD040 fences are acceptable baseline);
      `git diff --name-only` = exactly `README.md`.

---

## All Needed Context

### Context Completeness Check

✅ "No Prior Knowledge" — an agent with zero codebase knowledge can implement this from:
the FULL current `README.md` (read first), the canonical-name table + tier mapping (below),
the exact flag reconciliation (`--validate`/`--bug-hunt` are `--mode` values, not flags), the
already-updated `docs/CLI_REFERENCE.md` (wording reference), the verbatim PRD sections
(§2.3/§4.2/§4.3/§4.4/§4.6/§5.1/§5.3/§9.2.6/§9.2.8 — provided in the PRP's `selected_prd_content`
upstream), and the edit inventory (research/readme-staleness-map.md §7). No inference required.

### Documentation & References

```yaml
# MUST READ — the file being edited (the ONLY deliverable)
- file: README.md
  why: The current root README. Every edit is here. Read it fully first.
  pattern: |
    Stale spots (from research/readme-staleness-map.md §1):
      - "Configuration → Environment Variables" table: rows show ANTHROPIC_BASE_URL,
        ANTHROPIC_DEFAULT_OPUS_MODEL, ANTHROPIC_DEFAULT_SONNET_MODEL,
        ANTHROPIC_DEFAULT_HAIKU_MODEL as PRIMARY. Rewrite to canonical PRP_* (see §1 table).
      - "Model Tiers" bullets + "z.ai Configuration → Model Tiers" table: Opus/Sonnet/Haiku.
        Rewrite to high/balanced/fast.
      - "z.ai Configuration → Example .env File": uncommented ANTHROPIC_DEFAULT_*.
        Rewrite to PRP_MODEL_*.
      - "CLI Options" table: MISSING --accept-prd-changes (--adopt-prd already present).
      - Troubleshooting "Model not found" + "claude-code harness" examples use
        ANTHROPIC_DEFAULT_SONNET_MODEL. Rewrite to PRP_MODEL_BALANCED.
    Missing spots (add): distributed-PRD subsection; prd status subsection; Usage Examples
      for --adopt-prd / --accept-prd-changes / prd status; depth-chained research +
      two-phase commit + integrity protection in Self-Healing.

# MUST READ — the already-updated sibling doc to mirror (wording reference)
- file: docs/CLI_REFERENCE.md
  why: ALREADY updated with --adopt-prd (:252/:272), --accept-prd-changes (:164/:251/:270),
       prd status alias (:182/:195), --mode table incl validate/bug-hunt (:215/:453), and
       canonical tier naming. Reuse its concise, accurate phrasing for the README summary so
       the two docs stay consistent. README = summary; CLI_REFERENCE = exhaustive.
  pattern: mirror the flag descriptions (one line each) for --adopt-prd, --accept-prd-changes,
           and the prd status alias verbatim-in-spirit.

# MUST READ — canonical env-var source of truth (for the Configuration rewrite)
- file: .env.example
  why: ALREADY canonical-first. Documents PRP_API_BASE_URL, PRP_MODEL_HIGH/BALANCED/FAST as
       primary with the ANTHROPIC_* aliases in a DEPRECATED comment block. Copy this framing
       into the README env-var table + example .env + the deprecation note.
- file: src/config/constants.ts
  why: MODEL_NAMES {high,balanced,fast} (:44), MODEL_ENV_VARS {high:PRP_MODEL_HIGH,...} (:71),
       LEGACY_MODEL_ENV_VARS {high:ANTHROPIC_DEFAULT_OPUS_MODEL,...} (:93), PRP_API_BASE_URL
       (:213). These are the authoritative canonical↔legacy mapping for the table.
  section: "MODEL_NAMES / MODEL_ENV_VARS / LEGACY_MODEL_ENV_VARS / PRP_API_BASE_URL".
- file: src/config/environment.ts
  why: getModel(tier) reads canonical-first then legacy with a ONE-TIME deprecation warning
       (:71/:94). Documents the exact deprecation message wording to paraphrase.
  section: "warnLegacyModelVar / warnLegacyBaseURL / getModel".

# MUST READ — flag reconciliation (do NOT invent --validate / --bug-hunt standalone flags)
- file: src/cli/index.ts
  why: Authoritative list of real CLI flags/modes. --adopt-prd + --accept-prd-changes are
       boolean flags (search for 'adopt-prd' / 'accept-prd-changes'). validate/bug-hunt are
       CHOICES of --mode (`.choices(['normal','delta','bug-hunt','validate'])`), NOT flags.
       --validate-prd is a SEPARATE boolean flag (validate PRD syntax, exit, no agent).
       'task' and 'status' subcommands exist (status = alias of task; PRD §5.3).
  pattern: for README, surface validate/bug-hunt via the existing --mode row + Usage blocks;
           add --accept-prd-changes as a boolean row; keep --validate-prd distinct from
           --mode validate.
  gotcha: NEVER write `npm run dev -- --validate` or `--bug-hunt` as if they were flags —
          they are not in the parser. Use `--mode validate` / `--mode bug-hunt`.

# REFERENCE — the PRD sections that define each new behavior (provided upstream in the PRP
# prompt's <selected_prd_content>; re-read there for exact wording to paraphrase)
- docfile: PRD.md
  section: "§2.3 Distributed (Multi-File) PRDs" (include directives, expansion rules,
           idempotency, single canonical document downstream, markers, stale-include warning)
- docfile: PRD.md
  section: "§4.2 The Execution Loop" (depth-chained parallel research RESEARCH_DEPTH default 2,
           RESEARCH_TIMEOUT fallback; two-phase commit step 4 — pre-cleanup survival commit +
           post-cleanup commit via stagecoach)
- docfile: PRD.md
  section: "§4.3 The Delta Workflow" (--accept-prd-changes; COSMETIC/SUBSTANTIVE classifier
           with transient-API retry → protective default)
- docfile: PRD.md
  section: "§4.4 The QA & Bug Hunt Loop" (NO_ISSUES_FOUND.md marker; VALIDATION_AGENT/
           VALIDATION_TIMEOUT; BUG_FINDER_AGENT)
- docfile: PRD.md
  section: "§4.6 Adopt Mode (--adopt-prd)" (baseline session, .adopted marker,
           SKIP_EXECUTION_LOOP, validation+bug-hunt still run, guard rails)
- docfile: PRD.md
  section: "§5.1 State & File Management" (flock mutex on tasks.json RMW;
           restore_critical_files in smartCommit; status-delta re-apply + git restore)
- docfile: PRD.md
  section: "§5.3 Task Management" (prd status alias of prd task; task-file discovery priority)
- docfile: PRD.md
  section: "§9.2.6/§9.2.7 Authentication" (provider-aware auth resolution; preflight)
- docfile: PRD.md
  section: "§9.2.8 Provider-Neutral Configuration Naming" (the canonical↔legacy table;
           tier rename opus→high, sonnet→balanced, haiku→fast; one-time deprecation warning)

# REFERENCE — the research notes (the exact staleness map + edit inventory)
- file: plan/008_15504f60a0ef/P6M1T1S1/research/readme-staleness-map.md
  why: §0 validation approach; §1 the canonical↔legacy table + the exact stale README
       locations; §2 flag reconciliation; §3 new features to surface; §4 prd status; §5 §9.2.6
       cross-check; §7 the in-scope edit inventory (the implementer's checklist).
```

### Current Codebase tree (relevant slice)

```bash
README.md                              # MODIFY — the single deliverable (docs-only)

# AUTHORITATIVE REFERENCES (read, do not edit):
docs/CLI_REFERENCE.md                  # already updated; wording reference for README
docs/CONFIGURATION.md                  # P6.M1.T1.S3 owns it; README links to it
docs/ARCHITECTURE.md                   # P6.M1.T1.S2 owns it; README links to it
.env.example                           # canonical-first env var template
src/config/constants.ts                # MODEL_NAMES / *_ENV_VARS / PRP_API_BASE_URL
src/config/environment.ts              # getModel() + deprecation warnings
src/cli/index.ts                       # authoritative CLI flags + modes + subcommands
PRD.md                                 # §2.3/§4.x/§5.x/§9.2.x (verbatim in PRP prompt)
```

### Desired Codebase tree with files to be modified

```bash
README.md
  # Features bullets: + distributed PRDs, depth-chained research, two-phase commit,
  #   integrity protection.
  # + NEW subsection "Distributed (Multi-File) PRDs" (after "What is PRP Pipeline?").
  # Usage Examples: + Adopt an Existing Codebase, Accept PRD Edits, Task Status (prd status).
  # CLI Options table: + --accept-prd-changes row (keep --adopt-prd, --mode, --validate-prd).
  # Configuration → Environment Variables table: rewrite to canonical PRP_* primary + legacy
  #   deprecation note; keep ZAI_API_KEY / PRP_API_KEY / ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN.
  # Configuration → Model Tiers + z.ai Model Tiers table: high/balanced/fast.
  # z.ai Configuration → Example .env File: canonical PRP_*.
  # Troubleshooting model/harness examples: PRP_MODEL_BALANCED.
  # Self-Healing & Resilience: + depth-chained research, two-phase commit, integrity protection.
# (NO other files modified. plan/008_15504f60a0ef/P6M1T1S1/* are this PRP's own artifacts.)
```

### Known Gotchas of our codebase & Library Quirks

```markdown
<!-- CRITICAL: --validate and --bug-hunt are NOT standalone flags. They are VALUES of
     --mode (`--mode validate`, `--mode bug-hunt`). src/cli/index.ts defines them as
     `.choices(['normal','delta','bug-hunt','validate'])`. Writing `npm run dev -- --validate`
     in the README would be inaccurate and mislead users. The README's --mode row already
     lists them; surface them via Usage blocks + the --mode row, never as invented flags.
     (research/readme-staleness-map.md §2) -->

<!-- CRITICAL: --validate-prd (boolean) is a DIFFERENT thing from --mode validate.
     --validate-prd = validate PRD syntax & exit, no agent, no credential (pure-local).
     --mode validate = run the validation agent phase on a real session. Keep both, clearly
     distinct. The README already documents both — preserve the distinction. -->

<!-- CRITICAL: provider-native credentials are NOT renamed by §9.2.8. ZAI_API_KEY,
     ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN stay as-is (they are the provider's own native
     credential names). ONLY pipeline-global vars are neutralized (PRP_API_BASE_URL,
     PRP_MODEL_*). Do not "fix" ANTHROPIC_API_KEY → PRP_API_KEY in the README — that would
     be wrong (PRP_API_KEY is the explicit override; ANTHROPIC_API_KEY is anthropic-provider
     native). -->

<!-- CRITICAL: the §9.2.6 auth narrative ("How It Works → Authentication is provider-aware")
     is ALREADY accurate and must NOT be rewritten. Requirement (f) = cross-check only: while
     rewriting the env-var table, keep the auth resolution order (PRP_API_KEY override →
     provider-native env → ~/.pi/agent/auth.json) and the ANTHROPIC_AUTH_TOKEN backward-compat
     note intact, and don't let stale ANTHROPIC_*_MODEL names leak back. -->

<!-- GOTCHA: markdownlint is NOT a CI gate for README. The npm `docs:lint` script targets
     docs/**/*.md only. Running `npx markdownlint README.md` shows PRE-EXISTING violations
     (MD033 inline HTML in the badge block lines 3–21; MD040 fences without language at the
     Project Structure tree ~307/315/379/563). These are acceptable baseline — DO NOT remove
     the badges. But any NEW fenced block MUST specify a language (```bash / ```markdown /
     ```text) so MD040 doesn't grow, and avoid NEW inline HTML. -->

<!-- GOTCHA: the one automated gate that covers README is prettier: `npx prettier --check
     README.md` (README is in format:check scope; not in .prettierignore). Markdown tables
     and code fences must be prettier-clean. Run `npm run format` to auto-fix if needed. -->

<!-- GOTCHA: README is a SUMMARY. Do not copy docs/CONFIGURATION.md's exhaustive env-var
     table or docs/ARCHITECTURE.md's internals verbatim — link to them. The new "Distributed
     PRDs" subsection should be ~1 short paragraph + the 2 env knobs + a link, not a re-spec.
     (Sibling coordination: S2=ARCHITECTURE.md, S3=CONFIGURATION.md — no overlap.) -->

<!-- GOTCHA: tier rename is opus→high, sonnet→balanced, haiku→fast. The DEFAULT model values
     are unchanged (glm-5.2 / glm-5.2 / glm-5-turbo). The "Opus (glm-5.2): Architect agent"
     bullet becomes "High (glm-5.2): Architect agent", etc. Keep the role→tier mapping
     (planning/research→balanced; implementation→fast) implicit in the use-case column. -->
```

---

## Implementation Blueprint

### Data models and structure

None — this is a documentation-only task. There are no types, schemas, or runtime artifacts.
The only "model" is the canonical↔legacy env-var mapping (from `src/config/constants.ts`),
reproduced below as the source of truth for the Configuration rewrite:

| Canonical (PRIMARY) | Legacy alias (DEPRECATED)      | Default                  |
| ------------------- | ------------------------------ | ------------------------ |
| `PRP_API_BASE_URL`  | `ANTHROPIC_BASE_URL`           | z.ai endpoint for `zai`  |
| `PRP_MODEL_HIGH`    | `ANTHROPIC_DEFAULT_OPUS_MODEL` | `glm-5.2`                |
| `PRP_MODEL_BALANCED`| `ANTHROPIC_DEFAULT_SONNET_MODEL`| `glm-5.2`               |
| `PRP_MODEL_FAST`    | `ANTHROPIC_DEFAULT_HAIKU_MODEL`| `glm-5-turbo`            |

Tier rename: `opus`→`high`, `sonnet`→`balanced`, `haiku`→`fast`. Legacy names remain readable
with a one-time deprecation warning and are slated for future removal.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: READ the current README + references (no edits yet)
  - READ: README.md (full), docs/CLI_REFERENCE.md, .env.example, and this PRP's
    research/readme-staleness-map.md (the edit inventory §7). Skim src/config/constants.ts
    MODEL_NAMES/ENV_VARS and src/cli/index.ts flag list. Re-confirm the staleness map against
    the live README before editing (README may have shifted since this PRP was written).

Task 1: REWRITE the Configuration → Environment Variables table (canonical PRP_* primary)
  - EDIT the "### Environment Variables" table so the PRIMARY rows are PRP_API_BASE_URL,
    PRP_MODEL_HIGH, PRP_MODEL_BALANCED, PRP_MODEL_FAST (defaults per the table above), with a
    one-line deprecation note naming the legacy ANTHROPIC_BASE_URL / ANTHROPIC_DEFAULT_*
    aliases + "one-time warning, slated for future removal (PRD §9.2.8)".
  - KEEP rows for ZAI_API_KEY (required for default path), PRP_API_KEY (explicit override),
    PRP_AGENT_HARNESS, ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN (anthropic-provider only,
    optional). Mirror .env.example's framing.
  - KEEP the footnotes (* required, ** optional) and the §9.2.7 preflight note.

Task 2: REWRITE Model Tiers (both places) + Example .env + Troubleshooting to canonical names
  - "### Model Tiers" bullets: High/Balanced/Fast (values glm-5.2/glm-5.2/glm-5-turbo; roles
    Architect / default / simple-ops). Optionally note the legacy mapping in the deprecation
    note from Task 1.
  - "### z.ai Configuration → Model Tiers" table: rows High/Balanced/Fast.
  - "### z.ai Configuration → Example .env File": uncommented PRP_MODEL_HIGH=glm-5.2 etc.;
    keep the commented ANTHROPIC_* as "DEPRECATED" examples.
  - Troubleshooting "Model not found: glm-5.2": `export PRP_MODEL_BALANCED="…"`.
  - Troubleshooting "claude-code harness + default zai models": `export
    PRP_MODEL_BALANCED="anthropic/claude-sonnet-4"`.

Task 3: ADD the --accept-prd-changes row to the CLI Options table + surface modes
  - ADD a row: `| --accept-prd-changes | - | boolean | false | Accept PRD edits as the new
    baseline without a delta session (PRD §4.3) |` (place near --adopt-prd).
  - KEEP --adopt-prd, --mode (with the four choices incl validate/bug-hunt), --validate-prd.
  - DO NOT add --validate or --bug-hunt as standalone flags (they are --mode values).

Task 4: ADD Usage Example blocks
  - "### Adopt an Existing Codebase (--adopt-prd)" — `npm run dev -- --prd ./PRD.md --adopt-prd`
    + one sentence: seeds a completed baseline session so future PRD edits delta against the
    real code; validation + bug-hunt still run (PRD §4.6); fresh-project only.
  - "### Accept PRD Edits as Baseline (--accept-prd-changes)" — `npm run dev -- --prd ./PRD.md
    --continue --accept-prd-changes` + one sentence: for doc-only edits / already-finished
    work; cancels the queued delta, refreshes prd_snapshot.md, resumes idempotently (PRD §4.3).
  - "### Task Status (prd status / prd task)" — `prd status`, `prd task next`,
    `prd task status` + one sentence: `prd status` is an alias of `prd task` (git muscle
    memory; PRD §5.3); bugfix tasks discovered before main-session tasks.

Task 5: ADD the "## Distributed (Multi-File) PRDs" subsection
  - PLACE: after the "What is PRP Pipeline?" / Quick Start area (a feature-level explainer).
  - CONTENT (~1 paragraph + the 2 env knobs + a link): an `@path/to/file.md` token is an
    include directive replaced inline by the referenced file's contents (project-root-relative
    to the entry PRD's dir, recursive with cycle detection up to PRD_INCLUDE_MAX_DEPTH default
    10); optional PRD_INCLUDE_MARKERS emits `<!-- @include: path -->` markers; a stale include
    warns on stderr. Everything downstream (hashing, prd_snapshot.md, delta detection,
    prd_selectors/mdsel) operates over the fully-resolved document. prd_selectors feed each
    researcher only the relevant PRD sections. Link to docs/CONFIGURATION.md for the knobs.
  - CITE PRD §2.3.

Task 6: EXTEND "## Self-Healing & Resilience" (depth-chained research, two-phase commit,
        integrity protection)
  - DEPTH-CHAINED RESEARCH: a bullet noting background research now prefetches a CHAIN of up
    to RESEARCH_DEPTH (default 2) items ahead (PRD §4.2); on RESEARCH_TIMEOUT (default 1800s)
    it falls back to synchronous inline research; settings forward to bugfix children. Link to
    docs/CONFIGURATION.md#resilience-tuning.
  - TWO-PHASE COMMIT: a bullet that each item commits twice — a pre-cleanup survival commit
    (source + plan/ + Complete status) and a post-cleanup commit (doc reorg), both via the
    Smart Commit tool (stagecoach) — so a force-interrupt can't orphan a "Complete on disk but
    uncommitted" plan/ directory (PRD §4.2 step 4 / §5.1).
  - INTEGRITY PROTECTION: a bullet listing the guards — flock-based process-level mutex on
    tasks.json read-modify-write; restore_critical_files in smartCommit (forbidden-critical-
    file deletion protection); status-delta re-apply + git-history restore after each agent
    run; watchdog kills (exit 124) are terminal and never retried; NO_ISSUES_FOUND.md marker
    distinguishes "already hunted" from "never hunted" (PRD §4.4); COSMETIC/SUBSTANTIVE change
    classification with transient-API retry → protective default (PRD §4.3). Link to
    docs/ARCHITECTURE.md#tasksjson-protection--smart-recovery.

Task 7: ADD bullets to the "## Features" list
  - "- **Distributed (Multi-File) PRDs**: `@include` directives assemble a canonical resolved
    document; `prd_selectors` scope each researcher to relevant PRD sections."
  - "- **Depth-Chained Parallel Research**: prefetch up to N items ahead with synchronous
    fallback (see [Self-Healing & Resilience](#self-healing--resilience))."
  - "- **Two-Phase Commits**: a survival commit before cleanup + a doc-reorg commit after,
    so interrupted runs never orphan `plan/` directories."
  - "- **State Integrity Protection**: flock-guarded `tasks.json`, critical-file restore,
    terminal watchdog kills, and a `NO_ISSUES_FOUND.md` hunt marker."

Task 8: VERIFY (validation gates)
  - RUN: `npx prettier --check README.md` → PASS (run `npm run format` to auto-fix if not).
  - RUN: `npm run validate` → GREEN (format:check is the README-relevant step).
  - RUN: `npx markdownlint README.md` → NO NEW violations vs. the pre-existing baseline
    (MD033 badge HTML lines ~3–21; MD040 fences at the Project Structure tree). Confirm any
    new fenced blocks you added carry a language tag.
  - GREP-VERIFY (the accuracy contract):
      grep -n "PRP_MODEL_HIGH\|PRP_MODEL_BALANCED\|PRP_MODEL_FAST\|PRP_API_BASE_URL" README.md   # present (canonical primary)
      grep -n "ANTHROPIC_DEFAULT_OPUS_MODEL\|ANTHROPIC_DEFAULT_SONNET_MODEL\|ANTHROPIC_DEFAULT_HAIKU_MODEL" README.md  # ONLY in a deprecation note, NOT as primary table rows
      grep -n "accept-prd-changes" README.md      # present (CLI row + Usage block)
      grep -n "adopt-prd" README.md               # present (CLI row + Usage block)
      grep -n "prd status" README.md              # present
      grep -nE "Distributed \(Multi-File\) PRDs|@include|prd_selectors|PRD_INCLUDE_MAX_DEPTH" README.md  # present
      grep -niE "two-phase|depth-chained|RESEARCH_DEPTH|integrity protection|NO_ISSUES_FOUND" README.md # present
      grep -nE "Opus|Sonnet|Haiku" README.md      # ONLY (if at all) in the deprecation/legacy mapping note
  - SCOPE guard: `git diff --name-only` → EXACTLY `README.md`.
      git diff --name-only | grep -vE "^README\.md$" | grep -vE "^plan/008_15504f60a0ef/P6M1T1S1/"  # EMPTY
```

### Implementation Patterns & Key Details

```markdown
<!-- PATTERN: canonical env-var table row (mirror .env.example framing) -->
| `PRP_API_BASE_URL`  | No  | `https://api.z.ai/api/anthropic` | LLM provider endpoint (z.ai default for the `zai` provider). Legacy alias `ANTHROPIC_BASE_URL` (deprecated, PRD §9.2.8). |
| `PRP_MODEL_HIGH`    | No  | `glm-5.2`     | Highest-quality model tier — Architect agent. Legacy alias `ANTHROPIC_DEFAULT_OPUS_MODEL`. |
| `PRP_MODEL_BALANCED`| No  | `glm-5.2`     | Balanced/default tier — planning & research roles. Legacy alias `ANTHROPIC_DEFAULT_SONNET_MODEL`. |
| `PRP_MODEL_FAST`    | No  | `glm-5-turbo` | Fast/codegen tier — implementation role. Legacy alias `ANTHROPIC_DEFAULT_HAIKU_MODEL`. |

<!-- PATTERN: deprecation note (one line under the table) -->
> **Deprecation (PRD §9.2.8):** the `ANTHROPIC_BASE_URL` and `ANTHROPIC_DEFAULT_*` names are
> deprecated aliases — still readable, they emit a one-time warning and are slated for future
> removal. Set the canonical `PRP_*` names instead. Provider-native credentials
> (`ZAI_API_KEY`, `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`) are NOT renamed.

<!-- PATTERN: distributed-PRD subsection (concise — link out for depth) -->
## Distributed (Multi-File) PRDs

A PRD can be authored across multiple files and assembled into one canonical document at load
time (PRD §2.3). An `@path/to/file.md` token is an *include directive* — replaced inline by
the referenced file's contents (resolved project-root-relative to the entry PRD's directory,
recursively with cycle detection up to `PRD_INCLUDE_MAX_DEPTH`, default 10). Set
`PRD_INCLUDE_MARKERS` to emit `<!-- @include: path -->` markers; a stale include warns on
stderr. Hashing, `prd_snapshot.md`, delta detection, and `prd_selectors`/mdsel all operate
over the **fully-resolved** document, so a split PRD behaves identically to a monolithic one.
`prd_selectors` additionally scope each researcher to only the relevant PRD sections. See
[Configuration](docs/CONFIGURATION.md) for the env knobs.

<!-- PATTERN: keep validate/bug-hunt as MODE values, never invented flags -->
| `--mode <mode>` | `-m` | string | `normal` | Execution mode: `normal`, `delta`, `bug-hunt`, `validate` |
> `--mode validate` runs the validation agent phase on a real session; `--mode bug-hunt` runs
> the QA bug hunt. (These are `--mode` values — distinct from the pure-local `--validate-prd`
> flag, which validates PRD syntax and exits without invoking any agent.)

<!-- ANTI-PATTERN (forbidden): writing `npm run dev -- --validate` or `--bug-hunt` as flags. -->
<!-- ANTI-PATTERN (forbidden): renaming ANTHROPIC_API_KEY → PRP_API_KEY (the latter is the override). -->
<!-- ANTI-PATTERN (forbidden): rewriting the §9.2.6 auth narrative (it is already accurate). -->
<!-- ANTI-PATTERN (forbidden): duplicating docs/CONFIGURATION.md's exhaustive table verbatim. -->
<!-- ANTI-PATTERN (forbidden): removing the badge HTML (pre-existing MD033 is acceptable). -->
```

### Integration Points

```yaml
FILES:
  - modify: "README.md (root) — the ONLY deliverable"
  - read-only references: docs/CLI_REFERENCE.md, docs/CONFIGURATION.md, docs/ARCHITECTURE.md,
    .env.example, src/config/constants.ts, src/config/environment.ts, src/cli/index.ts, PRD.md

NO DATABASE / NO ROUTES / NO SOURCE CODE / NO TESTS / NO CONFIG FILES / NO OTHER DOCS.
README deep-links to docs/CONFIGURATION.md (env knobs), docs/ARCHITECTURE.md (internals), and
docs/CLI_REFERENCE.md (exhaustive flag reference). Confirm every README→docs/ anchor you add
or keep actually exists in the target doc (e.g. docs/CONFIGURATION.md#resilience-tuning,
docs/ARCHITECTURE.md#tasksjson-protection--smart-recovery — verify the slug before linking).
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npx prettier --check README.md   # the one automated gate that covers the root README
# If it fails, run `npm run format` (or `npx prettier --write README.md`) and re-check.

npm run validate                 # = lint && format:check && typecheck && test:run
                                 # format:check is the README-relevant step; must be GREEN.

npx markdownlint README.md       # NOT a CI gate (docs:lint covers docs/** only), but run it
                                 # to confirm you added NO new violations beyond the
                                 # pre-existing MD033 (badge HTML ~L3-21) + MD040 (tree fences).
# Expected: only the pre-existing baseline violations. Any NEW MD040 → add a language tag to
# the new fence (```bash / ```markdown / ```text). Any NEW MD033 → remove the inline HTML.
```

### Level 2: Unit Tests (Component Validation)

```bash
# Documentation task — no unit tests. The "unit test" is the accuracy cross-check below.
```

### Level 3: Integration Testing (System Validation)

```bash
# Accuracy cross-check (the real validation for a docs task). Re-run these and confirm PASS:
grep -nE "PRP_MODEL_HIGH|PRP_MODEL_BALANCED|PRP_MODEL_FAST|PRP_API_BASE_URL" README.md   # canonical primary names present
grep -nE "ANTHROPIC_DEFAULT_(OPUS|SONNET|HAIKU)_MODEL" README.md                         # ONLY in the deprecation note
grep -nE "ANTHROPIC_BASE_URL" README.md                                                  # ONLY as a deprecated alias / auth context
grep -n "accept-prd-changes" README.md                                                   # present (CLI row + Usage)
grep -n "adopt-prd" README.md                                                            # present (CLI row + Usage)
grep -n "prd status" README.md                                                           # present
grep -nE "Distributed \(Multi-File\) PRDs|prd_selectors|PRD_INCLUDE_MAX_DEPTH" README.md # present
grep -niE "two-phase|depth-chained|RESEARCH_DEPTH|integrity protection|NO_ISSUES_FOUND" README.md  # present
grep -nE "Opus|Sonnet|Haiku" README.md                                                   # ONLY (if at all) in legacy mapping note

# Confirm new README→docs/ anchors resolve (anchors must match the target heading slug):
grep -n "docs/CONFIGURATION.md" README.md        # verify each #anchor exists in the file
grep -n "docs/ARCHITECTURE.md" README.md
grep -n "docs/CLI_REFERENCE.md" README.md

# Scope guard:
git diff --name-only
# Expected: EXACTLY README.md (+ this PRP's plan/ artifacts, which are gitignored under plan/).
git diff --name-only | grep -vE "^README\.md$"   # EMPTY (ignore plan/ which is gitignored)
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Behavioral/read-through review (no live system needed):
#   1. A fresh reader skims Features → sees distributed PRDs, depth-chained research,
#      two-phase commit, integrity protection. ✓
#   2. Configuration table shows canonical PRP_* primary; a user with the old names sees the
#      deprecation note and knows to migrate. ✓
#   3. Model Tiers show high/balanced/fast; the role mapping is clear. ✓
#   4. Usage Examples show --adopt-prd, --accept-prd-changes, and prd status. ✓
#   5. The --mode row + notes make clear validate/bug-hunt are MODES, --validate-prd is
#      separate. ✓
#   6. The §9.2.6 auth section is unchanged and consistent with the rewritten config table. ✓

# Optional link check (docs:links covers docs/** only; spot-check README links manually):
#   For each docs/X.md#anchor link in README, open the target and confirm the heading exists.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npx prettier --check README.md` PASSES.
- [ ] `npm run validate` GREEN (format:check step covers README).
- [ ] `npx markdownlint README.md` shows NO new violations vs. the pre-existing MD033/MD040 baseline.
- [ ] `git diff --name-only` = exactly `README.md` (plus this PRP's own plan/ artifacts).

### Feature Validation
- [ ] Environment Variables table: canonical `PRP_*` primary + legacy `ANTHROPIC_*` deprecation note; provider-native credentials retained.
- [ ] Model Tiers (both places) + Example .env + Troubleshooting use high/balanced/fast + `PRP_MODEL_*`.
- [ ] CLI Options table: `--accept-prd-changes` added; `--adopt-prd`, `--mode` (validate/bug-hunt), `--validate-prd` retained; NO invented `--validate`/`--bug-hunt` standalone flags.
- [ ] Usage Examples: Adopt, Accept-PRD-changes, and Task Status blocks present.
- [ ] "Distributed (Multi-File) PRDs" subsection present (include directives, prd_selectors, env knobs, PRD §2.3).
- [ ] "Self-Healing & Resilience" extended with depth-chained research, two-phase commit, integrity protection.
- [ ] Features list bullets added.
- [ ] §9.2.6 auth narrative unchanged and consistent.

### Code Quality Validation
- [ ] README mirrors `docs/CLI_REFERENCE.md` wording (consistent across docs).
- [ ] Deep-links to `docs/CONFIGURATION.md` / `docs/ARCHITECTURE.md` / `docs/CLI_REFERENCE.md` (no verbatim duplication).
- [ ] New fenced code blocks carry a language tag (MD040-safe).
- [ ] No new inline HTML (MD033-safe); badges preserved.

### Documentation & Deployment
- [ ] Every env-var name / flag / tier name is accurate against the implementation sources.
- [ ] PRD section citations (§2.3/§4.2/§4.3/§4.4/§4.6/§5.1/§5.3/§9.2.6/§9.2.8) present where a behavior is described.

---

## Anti-Patterns to Avoid

- ❌ Don't invent `--validate` / `--bug-hunt` as standalone flags — they are `--mode` values (`src/cli/index.ts`).
- ❌ Don't conflate `--validate-prd` (pure-local PRD-syntax check) with `--mode validate` (validation agent phase on a real session).
- ❌ Don't rename `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN`/`ZAI_API_KEY` — they are provider-native credentials, NOT pipeline-global vars (§9.2.8 exception). `PRP_API_KEY` is the explicit override, not the anthropic credential.
- ❌ Don't rewrite the §9.2.6 auth narrative — it's already accurate; requirement (f) is a cross-check, not a rewrite.
- ❌ Don't leave any `ANTHROPIC_DEFAULT_*`/`ANTHROPIC_BASE_URL` as a PRIMARY row in the config table — they must be demoted to the deprecation note.
- ❌ Don't use Opus/Sonnet/Haiku as the current tier names — the rename is opus→high, sonnet→balanced, haiku→fast.
- ❌ Don't duplicate `docs/CONFIGURATION.md`'s exhaustive table verbatim — README is a summary; link out.
- ❌ Don't remove the badge HTML block (pre-existing MD033 is acceptable; badges ship fine).
- ❌ Don't add fenced code blocks without a language tag (new MD040 violations).
- ❌ Don't touch any file other than `README.md` (S2 owns ARCHITECTURE.md, S3 owns CONFIGURATION.md; source/tests/config are out of scope).
- ❌ Don't add unverified `docs/X.md#anchor` links — confirm the heading slug exists first.

---

## Success Metrics

**Confidence Score: 9/10** — this is a low-risk, single-file documentation sweep with an
unambiguous spec: (a) the canonical↔legacy env-var mapping is fixed by `src/config/constants.ts`
+ `.env.example` (already canonical-first); (b) the flag list is fixed by `src/cli/index.ts`
(with the one reconciliation that `--validate`/`--bug-hunt` are `--mode` values, documented
in the gotchas); (c) `docs/CLI_REFERENCE.md` is ALREADY fully updated and serves as the exact
wording reference, so README ↔ CLI_REFERENCE consistency is a copy-in-spirit exercise; (d) the
PRD sections defining each new behavior are provided verbatim upstream; (e) the §9.2.6 auth
narrative needs no rewrite (cross-check only). The single automated gate (`npx prettier
--check README.md`) is trivial to satisfy, and the real validation is a grep-based accuracy
contract with exact expected strings. Residual risks (caught by Level 1/3): a stale
`ANTHROPIC_*_MODEL` reference left in a Troubleshooting example (grep guard §3 catches it), or
a broken `docs/` anchor (Level 3 anchor-check catches it). One-pass success is highly likely.