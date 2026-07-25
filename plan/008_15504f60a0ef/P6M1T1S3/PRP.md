# PRP — P6.M1.T1.S3: Update docs/CONFIGURATION.md as canonical env-var reference

---

## Goal

**Feature Goal**: Make `docs/CONFIGURATION.md` the **coherent, complete canonical reference**
for every pipeline-global environment variable shipped in Phases 1–5 of session 008. The per-file
Mode A docs from the implementing subtasks already added individual env-var entries (so the doc
is ~90% there); this task is a **Mode B changeset-level sweep** that (a) **confirms** every
canonical env var named in the contract is present with a source-accurate default, (b) **confirms**
the legacy↔canonical deprecation table is complete and authoritative, (c) **fills the gaps** —
pipeline-global env vars read in `src/` but not yet documented, (d) **fixes accuracy defects** —
documented knobs with no source backing, and (e) **reconciles coherence defects** — chiefly the
duplicated "Model Selection" framing that tells two mildly-contradictory stories about how models
are selected.

**Deliverable**: An updated `docs/CONFIGURATION.md` (single file). No source code, no tests, no
config files (`.env.example` is OUT OF SCOPE), no other docs. Edits are additive/grooming, not a
rewrite — preserve the existing structure, headings (and their `#` anchors, which README.md and
the parallel ARCHITECTURE.md link into), table style, and voice.

**Success Definition**: Every env var documented matches its source default (file:line-cited in
`research/verified-facts.md`). All undocumented-but-real pipeline-global knobs now have canonical
entries. The deprecation table exactly matches `LEGACY_MODEL_ENV_VARS` + the `PRP_API_BASE_URL`
alias. The Model Selection sections tell ONE coherent roles→tiers→budgets→env-vars story.
`npx prettier --check docs/CONFIGURATION.md` PASSES; `npm run docs:lint` (markdownlint, currently
a clean baseline) stays GREEN with no NEW violations; `npm run validate` GREEN;
`git diff --name-only` = exactly `docs/CONFIGURATION.md` (+ this PRP's `plan/` artifacts). A grep
confirms no opus/sonnet/haiku-as-tier-names and no harness-qualified model strings.

---

## User Persona (if applicable)

**Target User**: An operator or contributor who opens `docs/CONFIGURATION.md` to find the canonical
name, default, and purpose of every environment variable — including the new ones from Phases 1–5
(distributed-PRD knobs, provider-neutral model names, parallel-research/resilience tuning, commit
retry, validation/QA control, adopt mode, and the tasks.json lockfile tunables).

**Use Case**: Scan the Quick Reference, drill into the env-var tables by section, then jump to the
Model Roles/Deprecation tables to understand tier↔role↔budget and the legacy→canonical rename.

**User Journey**: Today a reader finds the doc mostly complete BUT (1) the duplicated "Model
Selection" sections (one env-var table under Environment Variables, one conceptual section with
Tiers/Roles) mildly contradict on whether agents bind to tiers or to roles; (2) several real knobs
read in `src/` (RESEARCH_QUEUE_CONCURRENCY, MONITOR_TASK_INTERVAL, CLASSIFIER_RETRY_MAX,
TASKS_LOCK_*) are absent; (3) `BUGFIX_SCOPE` is documented with a default but is read NOWHERE in
`src/` — a hallucinated entry in a "canonical reference." The sweep resolves all three.

**Pain Points Addressed**: A canonical reference that silently omits real knobs sends users hunting
in source; one that documents non-existent knobs misleads them; one with two Model Selection
framings leaves them unsure which is authoritative.

---

## Why

- **Work-item CONTRACT mapping (verbatim from item description):**
  - **(1) RESEARCH NOTE** — PRD §6 (Phase 6) specifies `docs/CONFIGURATION.md` should be the
    canonical reference for all new/renamed env vars; legacy names appear only in a deprecation
    table. Per-file Mode A docs from implementing subtasks added individual entries; this task
    ensures the full reference is coherent and complete.
  - **(2) INPUT** — all implementing subtasks that added env vars (P1–P5, all Complete).
  - **(3) LOGIC** — (a) ensure all new env vars have canonical entries (the 14 listed); (b) add a
    deprecation table listing all legacy names with the canonical replacement; (c) ensure sections
    for distributed PRDs, model roles, research, commit resilience, validation/QA, and adopt mode
    are coherent.
  - **(4) OUTPUT** — complete canonical `docs/CONFIGURATION.md`. Completes P6.M1 and P6.
  - **(5) DOCS** — [Mode B] this IS the documentation task (changeset-level sweep).
- **PRD compliance**: §2.3 (distributed-PRD knobs), §4.2 (research depth/timeout/parallel),
  §4.3 (CLASSIFIER_RETRY_MAX), §4.4 (validation/bug-hunt control), §4.6 (adopt mode /
  SKIP_EXECUTION_LOOP), §5.1 (commit retry + tasks.json lockfile tunables), §9.2.2 (required env
  vars), §9.2.3/§6.1 (three model roles + xhigh budget), §9.2.8 (provider-neutral naming +
  deprecation aliases).
- **Sibling coordination (parallel execution)**: P6.M1.T1.S1 owns `README.md` (DONE — it links
  into CONFIGURATION.md anchors); P6.M1.T1.S2 owns `docs/ARCHITECTURE.md` (implementing in
  parallel — it links OUT to CONFIGURATION.md for env knobs: `#distributed-prds`, the Model Roles
  content, `#resilience-tuning`, `#validation-control`, `#bug-hunt-configuration`). This item owns
  `docs/CONFIGURATION.md` **only**. **Preserve every existing heading anchor** that README/ARCH
  link to (see research §9); if the Model Selection reconciliation (see "What" task 5) renames a
  linked heading, keep the old slug resolvable (leave a heading or pick a name whose slug matches).

---

## What

A documentation-only (Mode B) sweep of the single file `docs/CONFIGURATION.md`. The edits, in
dependency order (each task lists the verified source facts from
`research/verified-facts.md` it depends on):

1. **CONFIRM contract (a) — all 14 canonical vars present w/ correct defaults** (research §2).
   Read the current doc; verify each of `PRD_INCLUDE_MAX_DEPTH`, `PRD_INCLUDE_MARKERS`,
   `PRP_API_BASE_URL`, `PRP_MODEL_HIGH/BALANCED/FAST`, `PARALLEL_RESEARCH`, `RESEARCH_DEPTH`,
   `RESEARCH_TIMEOUT` (default **1800**), `COMMIT_RETRY_MAX` (default **5**), `COMMIT_RETRY_DELAY`
   (default **10000**), `VALIDATION_AGENT` (default **pizr**), `VALIDATION_TIMEOUT` (default
   **7200**), `BUG_FINDER_AGENT` (default **pizr**) is present with the exact source default.
   These are ALREADY documented correctly — this task CONFIRMS them; the only allowed change to
   these rows is a coherence rewording (task 5). If any default is wrong, fix it to match source.

2. **CONFIRM contract (b) — deprecation table complete + source-accurate** (research §3). The
   `### Deprecation (legacy ANTHROPIC_* aliases)` table (:338-357) already has the 4 correct rows
   matching `LEGACY_MODEL_ENV_VARS` (constants.ts:92-95) + the `PRP_API_BASE_URL`↔`ANTHROPIC_BASE_URL`
   alias (environment.ts:159-171). Confirm the one-time-warning + "slated for removal" prose
   (:341-346) matches the actual warning (environment.ts:75-107). Keep this table as the
   AUTHORITATIVE legacy↔canonical mapping.

3. **ADD undocumented pipeline-global env vars** (research §4). These are read in `src/` but absent
   from CONFIGURATION.md — add canonical entries (name + default + one-line purpose + PRD cite) in
   coherent sections, matching the existing table style:
   - **NEW `### Concurrency & Monitoring` subsection** under Environment Variables (place it after
     `### Distributed PRDs`, before `### Bug Hunt Configuration`), documenting:
     - `RESEARCH_QUEUE_CONCURRENCY` — default `3` (range 1-10); max concurrent research tasks for
       parallel PRP generation. Source: `src/cli/index.ts:351-352` (CLI `--research-queue-
       concurrency`). Mirrors `.env.example`'s "CONCURRENCY CONFIGURATION" block.
     - `MONITOR_TASK_INTERVAL` — default `1` (range 1-100); monitor resources every Nth task.
       Source: `src/cli/index.ts:336-337`.
   - **ADD `CLASSIFIER_RETRY_MAX`** to the existing `### Resilience Tuning` section — default `4`
     (TOTAL attempt count: initial + retries); max LLM change/artifact classifier attempts before
     failing to the protective/conservative default (treat as SUBSTANTIVE/DIRTY). Source:
     `constants.ts` `DEFAULT_CLASSIFIER_RETRY_MAX` / `getClassifierRetryMax`. Cite PRD §4.3. Group
     it as the delta-classifier sibling of the COMMIT_RETRY_* knobs (both bounded-retry-with-
     backoff over a transient-API boundary; both total-attempt counts; both fail to a safe fallback).
   - **NEW `### tasks.json Lock Tunables` subsection** under Environment Variables (place it after
     `### Advanced Configuration`), documenting the O_EXCL lockfile knobs (PRD §5.1, `withLockedTasksJSON`):
     - `TASKS_LOCK_STALE_MS` — default `30000` (ms); age at which an unreleased `tasks.json.lock` is
       considered stale and forcibly removed.
     - `TASKS_LOCK_TIMEOUT_MS` — default `30000` (ms); deadline to acquire `tasks.json.lock` before
       giving up with `TasksLockAcquisitionError`.
     - `TASKS_LOCK_POLL_MS` — default `50` (ms); retry interval between lock-acquisition attempts.
     Mark these "rarely tuned — only adjust if RMW critical sections are longer than defaults."
     Source: `constants.ts` `DEFAULT_TASKS_LOCK_STALE_MS` / `DEFAULT_TASKS_LOCK_TIMEOUT_MS` /
     `DEFAULT_TASKS_LOCK_POLL_MS`.
   - **ADD CLI-backed `HACKY_*` knobs** to `### Advanced Configuration` (note: the `HACKY_` prefix
     marks Groundswell/framework-level knobs exposed as CLI `--flag` env overrides), documenting:
     - `HACKY_LOG_LEVEL` — default `info`; minimum log level (CLI `--log-level`). Source:
       `src/cli/index.ts:305-308`.
     - `HACKY_TASK_RETRY_MAX_ATTEMPTS` — default `3` (range 0-10); max retry attempts for transient
       errors (CLI `--task-retry-max-attempts`). Source: `src/cli/index.ts:366-367`.
     - `HACKY_FLUSH_RETRIES` — default `3` (range 0-10); max retries for batch write failures (CLI
       `--flush-retries`). Source: `src/cli/index.ts:376-377`.
     - `HACKY_PRP_CACHE_TTL` — internal cache TTL knob; document as "(internal; rarely set
       directly)" if included, or omit. Document all four so nothing is silently missed; the agent
       decides whether to include HACKY_PRP_CACHE_TTL.

4. **FIX accuracy defects** (research §5). Documented knobs with no (or unverified) source backing:
   - **`BUGFIX_SCOPE`** — VERIFY by grepping `src/` + `docs/` + `dist/` for `BUGFIX_SCOPE`. A
     repo-wide grep returns matches ONLY in `docs/CONFIGURATION.md` itself (:180 + :508); it is
     read NOWHERE in `src/`. (`BUG_RESULTS_FILE` IS real — it appears in `src/agents/prompts.ts`
     as the `$BUG_RESULTS_FILE` template var — keep it.) **If the verify confirms BUGFIX_SCOPE is
     absent from source: REMOVE the `BUGFIX_SCOPE` row from the `### Bug Hunt Configuration` table
     AND its line from the Example block (:508)** — a hallucinated knob must not remain in a
     "canonical reference." If a backing IS found, cite it (file:line) and keep.
   - **`API_TIMEOUT_MS`** — VERIFY by grepping `node_modules/@earendil*` / Groundswell (a `src/`
     grep returns nothing). It is documented in BOTH CONFIGURATION.md (:196 + :525) and
     `.env.example` with default `60000`, so it is almost certainly a **framework-level** knob
     consumed by the Groundswell SDK. **If confirmed framework-level: KEEP the row but add a
     one-line note "(framework-level — consumed by the Groundswell SDK, not read in `src/`)"** so a
     reader is not sent hunting in `src/config/`. If genuinely nowhere, mark legacy/removed. Do NOT
     delete blindly (both docs agree).

5. **RECONCILE the duplicate "Model Selection" framing** (research §6a) — the biggest coherence
   defect. There are TWO "Model Selection" headings: `### Model Selection` (:92, the env-var table
   under Environment Variables) and `## Model Selection` (:273, the conceptual Tiers/Roles/Override/
   Deprecation section), and they mildly contradict (the `### Model Tiers` table binds *agents→tiers*
   and says `fast → "Future: quick lookups"`; the `### Model Roles` table binds *roles→{tier,budget}
   →personas* and shows fast IS used by the Implementation role). The Roles table is authoritative
   (PRD §9.2.3 / §6.1; `ROLE_CONFIG` agent-factory.ts:253-258). Reconcile so the doc tells ONE story:
   - **Lead the conceptual section** with: "The pipeline selects models via THREE ROLES
     (research / reasoning / implementation). Each role maps to a quality TIER (high / balanced /
     fast) and a reasoning budget. The `PRP_MODEL_*` env vars override the tier defaults; the role
     → {tier, budget} mapping is fixed in `ROLE_CONFIG` (`src/agents/agent-factory.ts`)."
   - **FIX the `### Model Tiers` table**: present tiers as QUALITY LEVELS (high/balanced/fast +
     default model + max tokens), NOT as agent bindings. Drop or relabel the stale "Agents" column
     (or convert it to "Used by role"). **Correct the stale `fast → "Future: quick lookups"` row** —
     `fast` IS used, by the Implementation role (Coder PRP-execution/fix, Cleanup). Reference the
     Roles table for the authoritative persona→role mapping.
   - **Keep the `### Model Roles` table authoritative** (Research/Reasoning/Implementation → tier +
     reasoning budget → personas; reasoning role = balanced @ `xhigh`). State the maximum-reasoning-
     budget note (PRD §6.1 / §9.2.3: decomposition, creative bug-finding, validation run at `xhigh`).
   - **Keep `### Model Override`** (the `PRP_MODEL_*` bash example) and `### Deprecation` (task 2).
   - **Resolve the duplicate heading + ToC slug collision** (`#model-selection-1`): either rename
     the conceptual section (e.g. `## Models, Roles & Reasoning Budget`) OR merge the env-var table
     reference into it. Whichever is chosen, the ToC anchor MUST match the heading slug EXACTLY and
     MUST NOT collide. **CAUTION**: if a linked heading is renamed, verify README/ARCH anchors still
     resolve (research §9) — prefer a rename whose slug still matches, or leave the old heading as an
     anchor. SAFEST: rename the conceptual `## Model Selection` → `## Models, Roles & Reasoning
     Budget` (new anchor) and update its ToC entry; leave `### Model Selection` (the env-var table)
     and its ToC entry `#model-selection` intact. Do NOT rename anchors S1/S2 link to unless you
     also keep them resolvable.

6. **FIX coherence in Pipeline Control descriptions** (research §6b):
   - `SKIP_EXECUTION_LOOP` (:141) — extend the description to note it is **also set internally by
     `--adopt-prd`** (PRD §4.6 / §9.2.2; adopt mode skips execution while validation + bug-hunt
     still run). Cross-link the Adopt Mode subsection.
   - `SKIP_BUG_FINDING` (:140) — add the nuance that when `true` it **also identifies bug-fix
     mode** (PRD §9.2.2), in addition to disabling QA.

7. **UPDATE the Table of Contents** to list any NEW subsections added in task 3 (Concurrency &
   Monitoring; tasks.json Lock Tunables) and to fix any renamed heading (task 5). Verify each ToC
   anchor matches its heading slug EXACTLY (markdown slug rules: lowercase, spaces→hyphens,
   punctuation stripped). The existing ToC already covers Distributed PRDs, Resilience Tuning,
   Validation Control, Bug Hunt Configuration, Adopt Mode — keep those.

8. **STALE GUARD + VALIDATE** (research §7-8):
   - GREP-VERIFY the final doc has NO opus/sonnet/haiku used as CURRENT tier names. (Today the only
     `sonnet` hits are LEGITIMATE `anthropic/claude-sonnet-4` model-id EXAMPLES in Common Gotchas
     (:551, :649) — those are fine, KEEP. Ensure new edits introduce no tier-name usage of
     opus/sonnet/haiku and no harness-qualified model strings like `pi/zai/...`.)
   - GREP-VERIFY every env var added in task 3 is present; every BUGFIX_SCOPE removal (task 4) is
     complete.
   - RUN `npx prettier --check docs/CONFIGURATION.md` → PASS (auto-fix via `npm run format`).
   - RUN `npm run docs:lint` → GREEN (clean baseline; NO new markdownlint violations). Confirm
     every NEW fenced block has a language tag (MD040) and no duplicate sibling headings (MD024).
   - RUN `npm run validate` → GREEN.
   - SCOPE guard: `git diff --name-only` → EXACTLY `docs/CONFIGURATION.md`
     (+ this PRP's `plan/` artifacts, gitignored under `plan/`).

### Success Criteria

- [ ] All 14 contract env vars present with source-accurate defaults (task 1). 
- [ ] Deprecation table complete (4 rows) + source-accurate one-time-warning prose (task 2).
- [ ] `RESEARCH_QUEUE_CONCURRENCY`, `MONITOR_TASK_INTERVAL`, `CLASSIFIER_RETRY_MAX`,
      `TASKS_LOCK_STALE_MS`, `TASKS_LOCK_TIMEOUT_MS`, `TASKS_LOCK_POLL_MS`, and the CLI-backed
      `HACKY_*` knobs documented with source defaults (task 3).
- [ ] `BUGFIX_SCOPE` verified — removed if absent from source; `API_TIMEOUT_MS` verified and marked
      framework-level (or removed if genuinely absent) (task 4).
- [ ] The two "Model Selection" sections reconciled into ONE coherent roles→tiers→budgets→env-vars
      story; the stale `fast → "Future: quick lookups"` row corrected; ToC slug collision resolved
      (task 5).
- [ ] `SKIP_EXECUTION_LOOP` notes adopt mode; `SKIP_BUG_FINDING` notes bug-fix-mode identification
      (task 6).
- [ ] Table of Contents lists new subsections + matches renamed headings (task 7).
- [ ] `npx prettier --check docs/CONFIGURATION.md` PASSES; `npm run docs:lint` GREEN with no NEW
      violations; `npm run validate` GREEN; `git diff --name-only` = exactly `docs/CONFIGURATION.md`
      (task 8).
- [ ] No opus/sonnet/haiku-as-tier-names; no harness-qualified model strings (task 8).

---

## All Needed Context

### Context Completeness Check

✅ "No Prior Knowledge" — an agent with zero codebase knowledge can implement this from: the FULL
current `docs/CONFIGURATION.md` (read first), the verified-facts research notes (every env var's
default + file:line + the exact gaps/accuracy/coherence defects), the verbatim PRD sections (§2.3 /
§4.2 / §4.3 / §4.4 / §4.6 / §5.1 / §9.2.2 / §9.2.3 / §6.1 / §9.2.8 — provided upstream in the PRP
prompt's `<selected_prd_content>`), the exact section-placement plan, and the validation gates. No
inference required — every claim and every default is grounded in source.

### Documentation & References

```yaml
# MUST READ — the file being edited (the ONLY deliverable)
- file: docs/CONFIGURATION.md
  why: The current canonical config reference. ~90% complete. Every edit is here. Read it fully first.
  pattern: |
    Current structure (headings + line numbers) — see research/verified-facts.md §1 for the full
    map. Key landmarks: Quick Reference :36; Environment Variables subsections :52-199 (API Auth
    :54, Model Selection env-table :92, Agent Runtime :109, Pipeline Control :137, Resilience
    Tuning :147, Distributed PRDs :161, Bug Hunt Config :172, Validation Control :182, Advanced
    :191); CLI Options :201 (Adopt Mode :263); conceptual Model Selection :273 (Model Tiers :277,
    When to Use :285, Model Roles :305, Model Override :324, Deprecation :338); Configuration
    Priority :359; Security :392; Example :429; Common Gotchas :530; See Also :655.

# MUST READ — the verified facts (every env var default + file:line + the exact gaps/defects)
- file: plan/008_15504f60a0ef/P6M1T1S3/research/verified-facts.md
  why: §1 current-doc structure; §2 contract (a) status per-var (all 14 already present, defaults);
       §3 contract (b) deprecation-table status; §4 COMPLETENESS GAPS (RESEARCH_QUEUE_CONCURRENCY,
       MONITOR_TASK_INTERVAL, CLASSIFIER_RETRY_MAX, TASKS_LOCK_*, HACKY_*) with defaults + source
       lines; §5 ACCURACY ISSUES (BUGFIX_SCOPE hallucinated, API_TIMEOUT_MS framework-level);
       §6 COHERENCE ISSUES (duplicate Model Selection, SKIP_* descriptions, retry-family grouping);
       §7 stale sweep; §8 validation gates; §9 sibling anchor preservation; §10 DELTA summary.
  section: "all — this is the fact base for every edit"

# MUST READ — the authoritative source for env-var defaults (read, do NOT edit)
- file: src/config/constants.ts
  why: MODEL_NAMES/MODEL_ENV_VARS/LEGACY_MODEL_ENV_VARS (:44-95); RESEARCH_TIMEOUT default 1800 +
       getResearchTimeoutSeconds (:249+); RESEARCH_DEPTH default 2 (:315+); PARALLEL_RESEARCH
       default false (:355+); ISSUE_RETRY_MAX default 3 (:405+); COMMIT_RETRY_MAX default 5 +
       COMMIT_RETRY_DELAY default 10000 + COMMIT_RETRY_DELAY_CAP default 120000; CLASSIFIER_RETRY_MAX
       default 4; VALIDATION_AGENT/VALIDATION_TIMEOUT default pizr/7200; BUG_FINDER_AGENT default
       pizr; PRD_INCLUDE_MAX_DEPTH default 10 + PRD_INCLUDE_MARKERS; TASKS_LOCK_STALE_MS/TIMEOUT_MS/
       POLL_MS defaults 30000/30000/50. THE source of truth for every default.
- file: src/config/environment.ts
  why: canonical-first-with-legacy-fallback getModel (:237+) + PRP_API_BASE_URL/ANTHROPIC_BASE_URL
       resolution (:156-171); one-time deprecation warning format (:63-107). Confirms the
       deprecation table prose.
- file: src/cli/index.ts
  why: CLI-flag env overrides the sweep must document — RESEARCH_QUEUE_CONCURRENCY (:351-352),
       MONITOR_TASK_INTERVAL (:336-337), HACKY_LOG_LEVEL (:305-308),
       HACKY_TASK_RETRY_MAX_ATTEMPTS (:366-367), HACKY_FLUSH_RETRIES (:376-377).
- file: .env.example
  why: REFERENCE ONLY (do NOT edit — out of scope). Confirms which env vars a user is expected to
       set; mirrors canonical-name discipline (legacy in a deprecation note). Has
       RESEARCH_QUEUE_CONCURRENCY, PRD_INCLUDE_*, VALIDATION_*, BUG_FINDER_AGENT, COMMIT_RETRY_* —
       use to keep CONFIGURATION.md coherent WITH .env.example. NOTE drift: .env.example lacks
       CLASSIFIER_RETRY_MAX, TASKS_LOCK_*, MONITOR_TASK_INTERVAL — flag as follow-up, do NOT edit.

# REFERENCE — sibling docs to stay coherent with / linked into (do NOT edit)
- file: docs/CLI_REFERENCE.md
  why: ALREADY updated. The --adopt-prd / --accept-prd-changes / --mode / --parallel-research
       wording is canonical; keep CONFIGURATION.md's Adopt Mode + flag descriptions consistent.
- file: docs/ARCHITECTURE.md
  why: P6.M1.T1.S2 owns it (parallel). It LINKS OUT to CONFIGURATION.md anchors — preserve them:
       #distributed-prds (### Distributed PRDs :161), the Model Roles content, #resilience-tuning,
       #validation-control, #bug-hunt-configuration. Verify these anchors still resolve after edits.

# REFERENCE — the PRD sections (provided verbatim upstream in the PRP prompt's selected_prd_content)
- docfile: PRD.md
  section: "§2.3 Distributed (Multi-File) PRDs (PRD_INCLUDE_MAX_DEPTH/MARKERS)"
- docfile: PRD.md
  section: "§4.2 Execution Loop (RESEARCH_DEPTH/TIMEOUT, PARALLEL_RESEARCH)"
- docfile: PRD.md
  section: "§4.3 Delta Workflow (CLASSIFIER_RETRY_MAX)"
- docfile: PRD.md
  section: "§4.4 QA & Bug Hunt (VALIDATION_AGENT/TIMEOUT, BUG_FINDER_AGENT)"
- docfile: PRD.md
  section: "§5.1 State & File Management (COMMIT_RETRY_*, TASKS_LOCK_*)"
- docfile: PRD.md
  section: "§9.2.2 Required Environment Variables (all env-var purposes)"
- docfile: PRD.md
  section: "§9.2.3/§6.1 Model Selection (three roles + xhigh budget)"
- docfile: PRD.md
  section: "§9.2.8 Provider-Neutral Naming (canonical↔legacy deprecation table)"
```

### Current Codebase tree (relevant slice)

```bash
docs/CONFIGURATION.md                      # MODIFY — the single deliverable (docs-only sweep)

# AUTHORITATIVE REFERENCES (read, do not edit):
src/config/constants.ts                    # every env-var default + getter (source of truth)
src/config/environment.ts                  # getModel canonical-first + deprecation warning
src/cli/index.ts                           # CLI-flag env overrides (HACKY_*, RESEARCH_QUEUE_*, MONITOR_*)
.env.example                               # canonical-name discipline reference (OUT OF SCOPE to edit)
docs/CLI_REFERENCE.md                      # flag wording reference (already updated)
docs/ARCHITECTURE.md                       # sibling (parallel); links INTO CONFIGURATION.md anchors
PRD.md                                     # §2.3/§4.x/§5.1/§9.2.x (verbatim in PRP prompt)
```

### Desired Codebase tree with files to be modified

```bash
docs/CONFIGURATION.md
  # Table of Contents: + Concurrency & Monitoring, + tasks.json Lock Tunables; fix renamed-heading slug
  # ### Pipeline Control: SKIP_EXECUTION_LOOP += adopt-mode note; SKIP_BUG_FINDING += bug-fix-mode note
  # ### Resilience Tuning: + CLASSIFIER_RETRY_MAX (group w/ COMMIT_RETRY_* retry family)
  # + NEW "### Concurrency & Monitoring" (RESEARCH_QUEUE_CONCURRENCY, MONITOR_TASK_INTERVAL)
  # ### Bug Hunt Configuration: VERIFY/REMOVE BUGFIX_SCOPE (hallucinated); keep BUG_RESULTS_FILE
  # ### Advanced Configuration: += API_TIMEOUT_MS framework-level note; += HACKY_* CLI knobs
  # + NEW "### tasks.json Lock Tunables" (TASKS_LOCK_STALE_MS/TIMEOUT_MS/POLL_MS)
  # ## Model Selection → reconcile to ONE roles→tiers→budgets→env-vars story; fix stale fast row;
  #    resolve duplicate-heading/ToC slug collision (rename conceptual section)
  # Example Configuration: remove BUGFIX_SCOPE line if removed above
# (NO other files modified. .env.example is OUT OF SCOPE. plan/008_15504f60a0ef/P6M1T1S3/* = this PRP's artifacts.)
```

### Known Gotchas of our codebase & Library Quirks

```markdown
<!-- CRITICAL: markdownlint IS a hard gate for docs/CONFIGURATION.md. `npm run docs:lint` =
     `markdownlint "docs/**/*.md"` and `.markdownlintignore` excludes ONLY docs/api/.
     CONFIGURATION.md currently PASSES CLEAN. Config: default:true, MD013 (line length) OFF,
     MD024 (no-duplicate-heading) siblings_only:true, MD036 (emphasis-as-heading) OFF, MD040
     (fenced-code-language) ON. So:
       - Every NEW fenced code block MUST have a language tag (```bash / ```typescript) — MD040-safe.
       - The two "Model Selection" headings are ### vs ## (different levels) so NOT an MD024
         violation TODAY — but the reconciliation should still resolve the reader confusion and the
         ToC slug collision. Do NOT introduce a NEW heading with the SAME text as a sibling heading
         at the SAME level (MD024 siblings_only). -->

<!-- CRITICAL: prettier format:check covers docs/CONFIGURATION.md (scope **/*.{ts,js,json,md,yml,yaml},
     not in .prettierignore). Tables and code fences must be prettier-clean. Auto-fix via
     `npm run format` (or `npx prettier --write docs/CONFIGURATION.md`). -->

<!-- CRITICAL: sibling anchor preservation. README.md (P6.M1.T1.S1, DONE) and docs/ARCHITECTURE.md
     (P6.M1.T1.S2, parallel) link INTO docs/CONFIGURATION.md anchors — notably #distributed-prds,
     #resilience-tuning, #validation-control, #bug-hunt-configuration, and Model Roles content.
     PRESERVE those existing headings verbatim. For the Model Selection reconciliation (task 5), the
     SAFEST rename is the conceptual `## Model Selection` → `## Models, Roles & Reasoning Budget`
     (new anchor, update its ToC entry); leave `### Model Selection` (env-var table) + its
     `#model-selection` ToC entry intact. Do NOT rename anchors S1/S2 link to unless you keep them
     resolvable. -->

<!-- CRITICAL: tier names are high/balanced/fast (NOT opus/sonnet/haiku). The canonical env vars are
     PRP_MODEL_HIGH/BALANCED/FAST; legacy ANTHROPIC_DEFAULT_* appear ONLY in the deprecation table
     (+ optional brief inline pointers). Model strings are PROVIDER-QUALIFIED ('zai/glm-5.2'), NEVER
     harness-qualified ('pi/zai/glm-5.2' is INVALID). The DEFAULT VALUES are unchanged (glm-5.2 /
     glm-5.2 / glm-5-turbo). The two existing `sonnet` hits (:551, :649) are LEGITIMATE
     anthropic/claude-sonnet-4 model-id EXAMPLES — keep them. -->

<!-- CRITICAL: this is a COHERENCE/COMPLETENESS SWEEP, not a rewrite. The doc is ~90% done. Preserve
     existing structure, headings (and their anchors), table style, and voice. ADD the gaps, FIX the
     defects, RECONCILE the contradictions — do not reformat wholesale. -->

<!-- GOTCHA: COMMIT_RETRY_MAX is the TOTAL attempt count (initial + retries), NOT the retry count —
     the existing row (:155) already says this; keep that wording when adding CLASSIFIER_RETRY_MAX
     (same semantics: total attempts). Defaults: COMMIT=5, CLASSIFIER=4. -->

<!-- GOTCHA: BUGFIX_SCOPE is documented (default `subtask`) but read NOWHERE in src/ — it is a
     hallucinated/stale entry. VERIFY and remove if absent. Do NOT preserve a non-existent knob in a
     "canonical reference." (BUG_RESULTS_FILE IS real — prompts.ts — keep it.) -->

<!-- GOTCHA: API_TIMEOUT_MS is documented in BOTH CONFIGURATION.md and .env.example (default 60000)
     but read NOWHERE in src/ — it is a framework-level (Groundswell SDK) knob. VERIFY and, if
     confirmed, keep with a "(framework-level)" note. Do NOT delete blindly (two files agree). -->

<!-- GOTCHA: .env.example is OUT OF SCOPE (the contract updates docs/CONFIGURATION.md only).
     .env.example has drift (lacks CLASSIFIER_RETRY_MAX, TASKS_LOCK_*, MONITOR_TASK_INTERVAL) — flag
     as a follow-up NOTE in your summary, do NOT edit .env.example. -->

<!-- GOTCHA: the deprecation table is ALREADY complete and source-accurate (matches
     LEGACY_MODEL_ENV_VARS + PRP_API_BASE_URL alias). Do NOT add/remove rows. At most, decide whether
     to keep the brief inline "Legacy alias: …" pointers in canonical table rows or consolidate to
     the table only (PRD §9.2.8's "legacy names appear solely in a deprecation note" is stated for
     .env.example; for the canonical CONFIG reference, brief inline pointers are acceptable UX as
     long as the deprecation TABLE is authoritative and complete). -->
```

---

## Implementation Blueprint

### Data models and structure

None — documentation-only. The only "model" is the **env-var reference table style** and the
**role→tier→budget→env-var mapping** the Model Selection reconciliation must present coherently.
From `research/verified-facts.md` §2/§3/§6a:

Canonical env-var row style (follow the existing tables): `| Variable | Required | Default | Description (one line, PRD §x cite) |`.

Authoritative role→tier→budget→persona mapping (for the reconciled Model Selection section; from
`ROLE_CONFIG`, agent-factory.ts:253-258, confirmed in sibling verified-facts.md §b):

| Role            | Tier (MODEL_NAMES)    | Reasoning budget | Personas                                              | Canonical env var      |
| --------------- | --------------------- | ---------------- | ----------------------------------------------------- | ---------------------- |
| Research        | balanced (`glm-5.2`)  | normal           | Researcher (PRP creation, research)                   | `PRP_MODEL_BALANCED`   |
| Reasoning       | balanced (`glm-5.2`)  | **`xhigh`**       | Architect (decomposition), Bug-finder, Validation (`pizr`) | `PRP_MODEL_BALANCED` @ xhigh |
| Implementation  | fast (`glm-5-turbo`)  | normal           | Coder (PRP execution/fix), Cleanup                    | `PRP_MODEL_FAST`       |

(Tier `high`/`PRP_MODEL_HIGH` is a quality level override not currently bound to a role; keep it
documented as the highest-quality tier override.) Tier rename (deprecation context only):
opus→high, sonnet→balanced, haiku→fast.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: READ the current doc + references (no edits yet)
  - READ: docs/CONFIGURATION.md (full), this PRP's research/verified-facts.md (the fact base),
    skim src/config/constants.ts (defaults), src/config/environment.ts (deprecation warning),
    src/cli/index.ts (CLI-flag env overrides). Re-confirm the current-doc structure in
    verified-facts.md §1 against the live file before editing (it may have shifted).

Task 1: CONFIRM contract (a) — all 14 canonical vars present w/ correct defaults (research §2)
  - VERIFY each of: PRD_INCLUDE_MAX_DEPTH (10), PRD_INCLUDE_MARKERS, PRP_API_BASE_URL
    (https://api.z.ai/api/anthropic, zai-only), PRP_MODEL_HIGH (glm-5.2), PRP_MODEL_BALANCED
    (glm-5.2), PRP_MODEL_FAST (glm-5-turbo), PARALLEL_RESEARCH (false), RESEARCH_DEPTH (2),
    RESEARCH_TIMEOUT (1800), COMMIT_RETRY_MAX (5), COMMIT_RETRY_DELAY (10000), VALIDATION_AGENT
    (pizr), VALIDATION_TIMEOUT (7200), BUG_FINDER_AGENT (pizr).
  - If any default is wrong → fix to match constants.ts. These are ALREADY documented; the only
    further change to these rows is the task-5 coherence rewording. No new rows here.

Task 2: CONFIRM contract (b) — deprecation table complete + source-accurate (research §3)
  - VERIFY the ### Deprecation table (:338-357) has exactly these 4 rows (matches
    LEGACY_MODEL_ENV_VARS constants.ts:92-95 + PRP_API_BASE_URL alias environment.ts:159-171):
      PRP_API_BASE_URL ↔ ANTHROPIC_BASE_URL
      PRP_MODEL_HIGH   ↔ ANTHROPIC_DEFAULT_OPUS_MODEL
      PRP_MODEL_BALANCED ↔ ANTHROPIC_DEFAULT_SONNET_MODEL
      PRP_MODEL_FAST   ↔ ANTHROPIC_DEFAULT_HAIKU_MODEL
  - VERIFY the one-time-warning + "slated for removal" prose (:341-346) matches
    environment.ts:75-107. Keep this table as the AUTHORITATIVE legacy↔canonical mapping. (Do not
    add/remove rows.)

Task 3: ADD undocumented pipeline-global env vars (research §4)
  - 3a. NEW ### Concurrency & Monitoring subsection (place after ### Distributed PRDs, before
       ### Bug Hunt Configuration): RESEARCH_QUEUE_CONCURRENCY (default 3, 1-10; src/cli/index.ts:351)
       + MONITOR_TASK_INTERVAL (default 1, 1-100; src/cli/index.ts:336). Mirror .env.example's
       "CONCURRENCY CONFIGURATION" grouping for RESEARCH_QUEUE_CONCURRENCY.
  - 3b. ADD CLASSIFIER_RETRY_MAX to ### Resilience Tuning (default 4, total attempts; constants.ts;
       PRD §4.3). Group as the delta-classifier sibling of COMMIT_RETRY_* (both bounded-retry-with-
       backoff over a transient-API boundary; both total-attempt counts; both fail to a safe
       fallback: COMMIT→placeholder commit, CLASSIFIER→SUBSTANTIVE/DIRTY default).
  - 3c. NEW ### tasks.json Lock Tunables subsection (place after ### Advanced Configuration):
       TASKS_LOCK_STALE_MS (30000ms), TASKS_LOCK_TIMEOUT_MS (30000ms), TASKS_LOCK_POLL_MS (50ms);
       constants.ts; PRD §5.1 withLockedTasksJSON. Mark "rarely tuned."
  - 3d. ADD CLI-backed HACKY_* knobs to ### Advanced Configuration (note: HACKY_ prefix = framework/
       Groundswell-level knobs exposed as CLI --flag env overrides): HACKY_LOG_LEVEL (info;
       src/cli/index.ts:305), HACKY_TASK_RETRY_MAX_ATTEMPTS (3, 0-10; :366), HACKY_FLUSH_RETRIES
       (3, 0-10; :376), HACKY_PRP_CACHE_TTL (internal; document as internal-only or omit — your
       call, but list it so nothing is silently missed).
  - NAMING/STYLE: match existing table columns (Variable | Required | Default | Description + PRD cite).
    Defaults copied verbatim from source — do NOT invent.

Task 4: FIX accuracy defects (research §5)
  - 4a. BUGFIX_SCOPE: grep -rn "BUGFIX_SCOPE" src/ docs/ dist/ — expected: ONLY docs/CONFIGURATION.md
       itself. If confirmed absent from source → REMOVE the BUGFIX_SCOPE row from ### Bug Hunt
       Configuration table (:180) AND its line from the Example Configuration block (:508). If a
       backing is found, cite file:line and keep.
  - 4b. API_TIMEOUT_MS: grep node_modules/@earendil* / Groundswell (a src/ grep returns nothing).
       If confirmed framework-level → KEEP the Advanced row (:196) + Example (:525) and add a
       one-line note "(framework-level — consumed by the Groundswell SDK, not read in src/)". If
       genuinely nowhere → mark legacy/removed. Do NOT delete blindly (both docs agree on 60000).

Task 5: RECONCILE the duplicate "Model Selection" framing (research §6a)
  - 5a. Lead the conceptual section (## Model Selection :273) with the one-sentence story:
       "The pipeline selects models via THREE ROLES (research / reasoning / implementation). Each
       role maps to a quality TIER (high / balanced / fast) and a reasoning budget. The PRP_MODEL_*
       env vars override the tier defaults; the role→{tier, budget} mapping is fixed in ROLE_CONFIG
       (src/agents/agent-factory.ts)."
  - 5b. FIX ### Model Tiers table (:278): present tiers as QUALITY LEVELS (high/balanced/fast +
       default model + max tokens), NOT agent bindings. Drop/soften the stale "Agents" column (or
       relabel "Used by role"). CORRECT the stale `fast → "Future: quick lookups"` row — fast IS
       used by the Implementation role (Coder/Cleanup). Reference ### Model Roles for the
       authoritative persona→role mapping.
  - 5c. KEEP ### Model Roles table (:308) authoritative (Research/Reasoning/Implementation → tier +
       budget → personas; reasoning = balanced @ xhigh). Keep the maximum-reasoning-budget note
       (PRD §6.1/§9.2.3: decomposition, creative bug-finding, validation run at xhigh).
  - 5d. KEEP ### Model Override (PRP_MODEL_* bash example) and ### Deprecation (task 2).
  - 5e. Resolve the duplicate-heading/ToC slug collision (### Model Selection env-table :92 vs ##
       Model Selection conceptual :273 → ToC #model-selection-1): SAFEST = rename the conceptual
       ## Model Selection → ## Models, Roles & Reasoning Budget (new anchor) + update its ToC entry;
       leave ### Model Selection (env-table) + #model-selection ToC entry intact. Verify no
       README/ARCH anchor breaks.

Task 6: FIX coherence in Pipeline Control descriptions (research §6b)
  - SKIP_EXECUTION_LOOP (:141): extend description — "Skip execution, run validation only. Also set
       internally by --adopt-prd (PRD §4.6). See [Adopt Mode](#adopt-mode---adopt-prd)."
  - SKIP_BUG_FINDING (:140): add nuance — "Skip bug hunt. When true, also identifies bug-fix mode
       (PRD §9.2.2)."

Task 7: UPDATE the Table of Contents
  - ADD entries for new subsections (### Concurrency & Monitoring; ### tasks.json Lock Tunables) in
    document order.
  - FIX the renamed conceptual heading (task 5e) ToC entry + slug.
  - VERIFY every ToC anchor matches its heading slug EXACTLY (markdown slug rules). Existing ToC
    already covers Distributed PRDs, Resilience Tuning, Validation Control, Bug Hunt Configuration,
    Adopt Mode — keep those.

Task 8: STALE GUARD + VALIDATE (research §7-8)
  - GREP-VERIFY no opus/sonnet/haiku as CURRENT tier names:
      grep -niE "\b(opus|sonnet|haiku)\b" docs/CONFIGURATION.md
      # Expected: only the 2 legit anthropic/claude-sonnet-4 EXAMPLES in Common Gotchas — KEEP.
  - GREP-VERIFY the new env vars are present:
      grep -niE "RESEARCH_QUEUE_CONCURRENCY|MONITOR_TASK_INTERVAL|CLASSIFIER_RETRY_MAX|TASKS_LOCK_STALE_MS|TASKS_LOCK_TIMEOUT_MS|TASKS_LOCK_POLL_MS|HACKY_LOG_LEVEL|HACKY_TASK_RETRY_MAX_ATTEMPTS|HACKY_FLUSH_RETRIES" docs/CONFIGURATION.md
  - GREP-VERIFY BUGFIX_SCOPE removed (if task 4a removed it):
      grep -niE "BUGFIX_SCOPE" docs/CONFIGURATION.md   # EMPTY after removal
  - GREP-VERIFY no harness-qualified model strings:
      grep -niE "pi/zai/|pi/anthropic/" docs/CONFIGURATION.md   # EMPTY
  - RUN npx prettier --check docs/CONFIGURATION.md → PASS (auto-fix: npm run format).
  - RUN npm run docs:lint → GREEN (clean baseline; NO new markdownlint violations).
  - RUN npm run validate → GREEN (format:check step covers this doc).
  - SCOPE guard: git diff --name-only → EXACTLY docs/CONFIGURATION.md
      git diff --name-only | grep -vE "^docs/CONFIGURATION\.md$" | grep -vE "^plan/008_15504f60a0ef/P6M1T1S3/"   # EMPTY
```

### Implementation Patterns & Key Details

```markdown
<!-- PATTERN: canonical env-var table row (match existing style) -->
| Variable          | Required | Default | Description                                                          |
| ----------------- | -------- | ------- | -------------------------------------------------------------------- |
| `CLASSIFIER_RETRY_MAX` | No | `4`  | Max LLM change/artifact classifier attempts before failing to the protective/conservative default (treat as SUBSTANTIVE/DIRTY). Total attempt count (initial + retries). See PRD §4.3. |

<!-- PATTERN: reconciled Model Selection lead (one coherent story) -->
## Models, Roles & Reasoning Budget

The pipeline selects models via **three roles** — research, reasoning, and implementation. Each
role maps to a quality **tier** (high / balanced / fast) and a reasoning budget. The `PRP_MODEL_*`
env vars override the tier defaults; the role → {tier, budget} mapping is fixed in `ROLE_CONFIG`
(`src/agents/agent-factory.ts`, PRD §9.2.3 / §6.1).

### Model Tiers   (quality levels; defaults overridable via PRP_MODEL_*)
### Model Roles   (authoritative: persona → role → tier + budget; reasoning = balanced @ xhigh)
### Model Override
### Deprecation (legacy ANTHROPIC_* aliases)

<!-- PATTERN: corrected fast-tier row (fast IS used) -->
| **fast** | glm-5-turbo | 4096 | Fastest tier — used by the **Implementation** role (Coder PRP execution/fix, Cleanup) |

<!-- ANTI-PATTERN (forbidden): documenting a knob with no source backing (BUGFIX_SCOPE). -->
<!-- ANTI-PATTERN (forbidden): opus/sonnet/haiku as current tier names; harness-qualified model
     strings (pi/zai/...). -->
<!-- ANTI-PATTERN (forbidden): inventing defaults — copy verbatim from constants.ts / cli/index.ts. -->
<!-- ANTI-PATTERN (forbidden): renaming a heading anchor that README.md or docs/ARCHITECTURE.md links
     into (breaks sibling cross-links) without keeping it resolvable. -->
<!-- ANTI-PATTERN (forbidden): editing .env.example (OUT OF SCOPE) or any file other than
     docs/CONFIGURATION.md. -->
<!-- ANTI-PATTERN (forbidden): adding fenced blocks without a language tag (markdownlint MD040). -->
```

### Integration Points

```yaml
FILES:
  - modify: "docs/CONFIGURATION.md — the ONLY deliverable"
  - read-only references: src/config/constants.ts, src/config/environment.ts, src/cli/index.ts,
    .env.example (OUT OF SCOPE to edit), docs/CLI_REFERENCE.md, docs/ARCHITECTURE.md, PRD.md

NO DATABASE / NO ROUTES / NO SOURCE CODE / NO TESTS / NO CONFIG FILES / NO OTHER DOCS.
CONFIGURATION.md is linked INTO by README.md (#anchors) and docs/ARCHITECTURE.md (env-knob anchors)
— PRESERVE those anchors (#distributed-prds, #resilience-tuning, #validation-control,
#bug-hunt-configuration, Model Roles content). .env.example drift (lacks CLASSIFIER_RETRY_MAX,
TASKS_LOCK_*, MONITOR_TASK_INTERVAL) is a follow-up NOTE only — do NOT edit .env.example.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npx prettier --check docs/CONFIGURATION.md   # HARD gate (format:check covers **/*.md)
# If it fails, run `npm run format` (or `npx prettier --write docs/CONFIGURATION.md`) and re-check.

npm run docs:lint                            # = markdownlint "docs/**/*.md"; CONFIGURATION.md IS
                                             # linted (.markdownlintignore excludes only docs/api/).
                                             # Currently PASSES CLEAN. Expected: still GREEN, NO new
                                             # violations. Any new MD040 → add a language tag. Any new
                                             # MD024 → rename the duplicate sibling.

npm run validate                             # = lint && format:check && typecheck && test:run
                                             # format:check is the step covering this doc; GREEN.

# Expected: Zero errors. If errors exist, READ output and fix before proceeding.
```

### Level 2: Unit Tests (Component Validation)

```bash
# Documentation task — no unit tests. The "unit test" is the accuracy cross-check below.
```

### Level 3: Integration Testing (System Validation)

```bash
# Accuracy cross-check (the real validation for a docs sweep). Re-run and confirm PASS:

# (a) All 14 contract canonical vars present with correct defaults:
grep -niE "PRD_INCLUDE_MAX_DEPTH|PRD_INCLUDE_MARKERS|PRP_API_BASE_URL|PRP_MODEL_HIGH|PRP_MODEL_BALANCED|PRP_MODEL_FAST|PARALLEL_RESEARCH|RESEARCH_DEPTH|RESEARCH_TIMEOUT|COMMIT_RETRY_MAX|COMMIT_RETRY_DELAY|VALIDATION_AGENT|VALIDATION_TIMEOUT|BUG_FINDER_AGENT" docs/CONFIGURATION.md
# (b) NEW env vars added:
grep -niE "RESEARCH_QUEUE_CONCURRENCY|MONITOR_TASK_INTERVAL|CLASSIFIER_RETRY_MAX|TASKS_LOCK_STALE_MS|TASKS_LOCK_TIMEOUT_MS|TASKS_LOCK_POLL_MS|HACKY_LOG_LEVEL|HACKY_TASK_RETRY_MAX_ATTEMPTS|HACKY_FLUSH_RETRIES" docs/CONFIGURATION.md
# (c) Deprecation table complete (4 rows):
grep -niE "ANTHROPIC_BASE_URL|ANTHROPIC_DEFAULT_OPUS_MODEL|ANTHROPIC_DEFAULT_SONNET_MODEL|ANTHROPIC_DEFAULT_HAIKU_MODEL" docs/CONFIGURATION.md
# (d) BUGFIX_SCOPE removed (if task 4a removed it):
grep -niE "BUGFIX_SCOPE" docs/CONFIGURATION.md   # EMPTY after removal
# (e) Stale sweep — no opus/sonnet/haiku as tier names, no harness-qualified models:
grep -niE "pi/zai/|pi/anthropic/" docs/CONFIGURATION.md   # EMPTY

# Anchor integrity (README + ARCHITECTURE link to these):
grep -niE "^###? (Distributed PRDs|Resilience Tuning|Validation Control|Bug Hunt Configuration|Model Selection)" docs/CONFIGURATION.md

# Scope guard:
git diff --name-only
# Expected: EXACTLY docs/CONFIGURATION.md (+ this PRP's plan/ artifacts, gitignored under plan/).
git diff --name-only | grep -vE "^docs/CONFIGURATION\.md$" | grep -vE "^plan/008_15504f60a0ef/P6M1T1S3/"  # EMPTY
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Read-through review (no live system needed):
#   1. A reader finds every pipeline-global env var (new + legacy) with a source-accurate default. ✓
#   2. The Model Selection sections tell ONE coherent story: roles → tiers → budgets → env vars;
#      the stale "fast → Future" row is corrected; the duplicate-heading/ToC collision is resolved. ✓
#   3. The resilience family is grouped: research/replan knobs + commit-retry + classifier-retry. ✓
#   4. BUGFIX_SCOPE is gone (or verified-backed); API_TIMEOUT_MS is marked framework-level. ✓
#   5. SKIP_EXECUTION_LOOP notes adopt mode; SKIP_BUG_FINDING notes bug-fix-mode identification. ✓
#   6. The deprecation table is the authoritative legacy↔canonical mapping (4 rows, source-matched). ✓
#   7. ToC lists new subsections; every anchor resolves; README/ARCH cross-links still resolve. ✓

# Optional: cross-check each documented default against src/config/constants.ts /
# src/cli/index.ts one more time (the research notes cite exact source lines).
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npx prettier --check docs/CONFIGURATION.md` PASSES.
- [ ] `npm run docs:lint` GREEN with NO new markdownlint violations (clean baseline preserved).
- [ ] `npm run validate` GREEN (format:check step covers this doc).
- [ ] `git diff --name-only` = exactly `docs/CONFIGURATION.md` (plus this PRP's own `plan/` artifacts).

### Feature Validation
- [ ] All 14 contract canonical env vars present with source-accurate defaults (task 1).
- [ ] Deprecation table complete (4 rows matching LEGACY_MODEL_ENV_VARS + PRP_API_BASE_URL alias) + source-accurate one-time-warning prose (task 2).
- [ ] `RESEARCH_QUEUE_CONCURRENCY`, `MONITOR_TASK_INTERVAL`, `CLASSIFIER_RETRY_MAX`, `TASKS_LOCK_STALE_MS/TIMEOUT_MS/POLL_MS`, CLI-backed `HACKY_*` knobs documented with source defaults (task 3).
- [ ] `BUGFIX_SCOPE` verified — removed if absent; `API_TIMEOUT_MS` verified and marked framework-level (task 4).
- [ ] Duplicate "Model Selection" reconciled to ONE coherent roles→tiers→budgets→env-vars story; stale `fast → Future` corrected; ToC slug collision resolved (task 5).
- [ ] `SKIP_EXECUTION_LOOP` notes adopt mode; `SKIP_BUG_FINDING` notes bug-fix-mode identification (task 6).
- [ ] Table of Contents lists new subsections + matches renamed headings; all anchors resolve (task 7).

### Code Quality Validation
- [ ] Every default copied verbatim from source (constants.ts / cli/index.ts) — no invented values.
- [ ] Every new fenced code block has a language tag (MD040-safe); no duplicate sibling headings (MD024-safe).
- [ ] README.md / docs/ARCHITECTURE.md anchor cross-links still resolve (#distributed-prds, #resilience-tuning, #validation-control, #bug-hunt-configuration, Model Roles content).
- [ ] No opus/sonnet/haiku-as-tier-names; no harness-qualified model strings; no `ANTHROPIC_DEFAULT_*` as current names.
- [ ] `.env.example` NOT modified (out of scope); drift flagged as a follow-up note in the summary.

### Documentation & Deployment
- [ ] PRD section citations present wherever a behavior/knob is described (§2.3/§4.2/§4.3/§4.4/§4.6/§5.1/§9.2.x).
- [ ] Consistent wording with `docs/CLI_REFERENCE.md` (Adopt Mode, flags) and tier naming with the reconciled Model Selection section.

---

## Anti-Patterns to Avoid

- ❌ Don't invent env-var defaults — copy verbatim from `src/config/constants.ts` / `src/cli/index.ts`.
- ❌ Don't document a knob with no source backing (`BUGFIX_SCOPE`) — verify and remove if absent.
- ❌ Don't delete `API_TIMEOUT_MS` blindly — it's documented in two files; verify (framework-level) first.
- ❌ Don't use opus/sonnet/haiku as current tier names — the canonical tiers are high/balanced/fast.
- ❌ Don't write harness-qualified model strings (`pi/zai/glm-5.2` is INVALID); models are provider-qualified only.
- ❌ Don't rename a heading anchor that README.md or docs/ARCHITECTURE.md links into without keeping it resolvable.
- ❌ Don't add/remove rows from the deprecation table — it is already complete and source-matched.
- ❌ Don't add fenced code blocks without a language tag (markdownlint MD040 is a hard gate here).
- ❌ Don't create duplicate sibling headings (markdownlint MD024 siblings_only).
- ❌ Don't edit `.env.example` or any file other than `docs/CONFIGURATION.md` (S1 owns README.md, S2 owns ARCHITECTURE.md; source/tests/config are out of scope).
- ❌ Don't reformat wholesale — this is a coherence/completeness SWEEP; preserve existing structure, headings, anchors, table style, and voice.