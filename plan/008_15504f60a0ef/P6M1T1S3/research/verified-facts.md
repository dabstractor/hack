# P6.M1.T1.S3 — Verified Implementation Facts (for docs/CONFIGURATION.md coherence sweep)

Source: direct reads of `docs/CONFIGURATION.md` (full), `src/config/constants.ts` (full),
`src/config/environment.ts` (:1-80 + grep), `src/cli/index.ts` (grep), `.env.example` (full),
`docs/CLI_REFERENCE.md`, and the sibling PRP `P6M1T1S2/research/verified-facts.md`. All line
numbers current as of session 008.

This task is a **Mode B documentation sweep** (not new feature docs). The per-file Mode A docs
from implementing subtasks (P1–P5) already added individual env-var entries, so
`docs/CONFIGURATION.md` is already ~90% complete. The DELTA is **completeness + coherence**:
fill the gaps, fix the accuracy issues, reconcile the contradictions, and confirm the
deprecation table is the authoritative legacy↔canonical mapping.

---

## 1. Current docs/CONFIGURATION.md structure (headings + line numbers)

```
# Configuration Reference                                       :1
## Table of Contents                                             :9
## Quick Reference                                               :36
## Environment Variables                                         :52
  ### API Authentication                                         :54
  ### Model Selection                  (env-var TABLE)           :92   ← DUPLICATE NAME (see §6)
  ### Agent Runtime (Harness)                                    :109
  ### Pipeline Control                                           :137
  ### Resilience Tuning                                          :147
  ### Distributed PRDs                                           :161
  ### Bug Hunt Configuration                                     :172
  ### Validation Control                                         :182
  ### Advanced Configuration                                     :191
## CLI Options                                                   :201
  ### Required Options / ### Execution Mode / ### Boolean Flags /
  ### Limit Options / ### Delta Response / ### Adopt Mode (`--adopt-prd`) :263
## Model Selection                    (CONCEPTUAL — tiers/roles) :273   ← DUPLICATE NAME (see §6)
  ### Model Tiers / ### When to Use Each Tier / ### Model Roles /
  ### Model Override / ### Deprecation (legacy ANTHROPIC_* aliases) :338
## Configuration Priority                                       :359
  ### Example: Priority in Action / ### Special Case: Provider-Aware Resolution
## Security / ### API Key Security / ### API Endpoint Security  :392 / :412
## Example Configuration                                        :429
## Common Gotchas                                               :530
## See Also                                                     :655
```

The ToC (lines 9-34) lists Environment Variables subsections AND a separate
`[Model Selection](#model-selection-1)` (the slug is `-1` because it is the SECOND "Model
Selection" heading — a markdown auto-slug collision).

---

## 2. Contract requirement (a): all new env vars have canonical entries — STATUS

Each canonical env var the contract names, with the verified default from `constants.ts` /
`environment.ts` and whether it is ALREADY documented:

| Canonical env var        | Verified default / behavior                       | In CONFIGURATION.md? |
| ------------------------ | ------------------------------------------------- | -------------------- |
| `PRD_INCLUDE_MAX_DEPTH`  | default `10` (getPrdIncludeMaxDepth)              | ✅ yes (Distributed PRDs :166) |
| `PRD_INCLUDE_MARKERS`    | unset→off; truthy unless `0/false/no/off`         | ✅ yes (Distributed PRDs :167) |
| `PRP_API_BASE_URL`       | `https://api.z.ai/api/anthropic` (zai provider)   | ✅ yes (API Auth :64, Quick Ref :43) |
| `PRP_MODEL_HIGH`         | `glm-5.2`                                         | ✅ yes (Model Selection :98) |
| `PRP_MODEL_BALANCED`     | `glm-5.2`                                         | ✅ yes (Model Selection :99) |
| `PRP_MODEL_FAST`         | `glm-5-turbo`                                     | ✅ yes (Model Selection :100) |
| `PARALLEL_RESEARCH`      | `false` (literal `'true'` enables; isParallelResearch) | ✅ yes (Resilience :152) |
| `RESEARCH_DEPTH`         | `2`                                               | ✅ yes (Resilience :153) |
| `RESEARCH_TIMEOUT`       | `1800` (30min)                                    | ✅ yes (Resilience :151) |
| `COMMIT_RETRY_MAX`       | `5` (TOTAL attempts: initial + retries)           | ✅ yes (Resilience :155) |
| `COMMIT_RETRY_DELAY`     | `10000` (ms; base, doubling)                      | ✅ yes (Resilience :156) |
| `VALIDATION_AGENT`       | `pizr`                                            | ✅ yes (Validation Control :186) |
| `VALIDATION_TIMEOUT`     | `7200` (2h)                                       | ✅ yes (Validation Control :187) |
| `BUG_FINDER_AGENT`       | `pizr`                                            | ✅ yes (Bug Hunt Config :178) |

**Verdict: requirement (a) is ALREADY SATISFIED** — all 14 canonical vars have correct
defaults documented. The sweep CONFIRMS (not adds) these; the only allowed change to them is a
coherence rewording (e.g. reconciling the duplicated Model Selection framing).

---

## 3. Contract requirement (b): deprecation table — STATUS

A `### Deprecation (legacy ANTHROPIC_* aliases)` section EXISTS at CONFIGURATION.md :338-357
with a 4-row table:

| Canonical (provider-neutral) | Legacy alias (deprecated)        |
| ---------------------------- | -------------------------------- |
| `PRP_API_BASE_URL`           | `ANTHROPIC_BASE_URL`             |
| `PRP_MODEL_HIGH`             | `ANTHROPIC_DEFAULT_OPUS_MODEL`   |
| `PRP_MODEL_BALANCED`         | `ANTHROPIC_DEFAULT_SONNET_MODEL` |
| `PRP_MODEL_FAST`             | `ANTHROPIC_DEFAULT_HAIKU_MODEL`  |

This EXACTLY matches source (`LEGACY_MODEL_ENV_VARS`, constants.ts:92-95 + `PRP_API_BASE_URL`
vs `ANTHROPIC_BASE_URL`, environment.ts:159-171). The one-time deprecation warning
(environment.ts:63-107) emits `[PRP] Deprecation: environment variable <legacy> is deprecated;
use the canonical <canonical> instead (PRD §9.2.8). The legacy alias will be removed in a
future major version.` — the doc's prose at :341-346 matches.

**Verdict: requirement (b) is ALREADY SATISFIED and source-accurate.** The sweep should keep
it as the AUTHORITATIVE legacy↔canonical mapping. (Coherence note §6: legacy names ALSO appear
inline in a few canonical table rows + Quick Ref — the sweep should decide whether to keep
brief inline pointers or consolidate to the table per §9.2.8 "legacy names appear solely in a
deprecation note" — that principle is stated for `.env.example`, but for the canonical CONFIG
reference the cleanest coherent read is: the deprecation table is authoritative, inline rows
reference canonical names primarily.)

---

## 4. COMPLETENESS GAPS — pipeline-global env vars in source but MISSING from CONFIGURATION.md

Discovered by grepping `process.env.*` across `src/` (excluding tests) + CLI `--flag` env
overrides in `src/cli/index.ts`:

| Env var                       | Default      | Where read                                  | In CONFIG.md? | In .env.example? |
| ----------------------------- | ------------ | ------------------------------------------- | ------------- | ---------------- |
| `RESEARCH_QUEUE_CONCURRENCY`  | `3` (1-10)   | `src/cli/index.ts:351-352` (`--research-queue-concurrency`) | ❌ NO | ✅ yes |
| `MONITOR_TASK_INTERVAL`       | `1` (1-100)  | `src/cli/index.ts:336-337` (`--monitor-task-interval`) | ❌ NO | ❌ NO |
| `CLASSIFIER_RETRY_MAX`        | `4` (total)  | `src/config/constants.ts` (`DEFAULT_CLASSIFIER_RETRY_MAX`, `getClassifierRetryMax`) — PRD §4.3 delta-classifier retry | ❌ NO | ❌ NO |
| `TASKS_LOCK_STALE_MS`         | `30000` (ms) | `src/config/constants.ts` — PRD §5.1 tasks.json.lock stale age | ❌ NO | ❌ NO |
| `TASKS_LOCK_TIMEOUT_MS`       | `30000` (ms) | `src/config/constants.ts` — PRD §5.1 tasks.json.lock acquisition deadline | ❌ NO | ❌ NO |
| `TASKS_LOCK_POLL_MS`          | `50` (ms)    | `src/config/constants.ts` — PRD §5.1 tasks.json.lock retry interval | ❌ NO | ❌ NO |
| `HACKY_LOG_LEVEL`             | `info`       | `src/cli/index.ts:305-308` (`--log-level`)  | ❌ NO | ❌ NO |
| `HACKY_TASK_RETRY_MAX_ATTEMPTS` | `3` (0-10) | `src/cli/index.ts:366-367` (`--task-retry-max-attempts`) | ❌ NO | ❌ NO |
| `HACKY_FLUSH_RETRIES`         | `3` (0-10)   | `src/cli/index.ts:376-377` (`--flush-retries`) | ❌ NO | ❌ NO |
| `HACKY_PRP_CACHE_TTL`         | (read)       | process.env read; internal cache knob       | ❌ NO | ❌ NO |

**Placement guidance for the sweep:**
- `RESEARCH_QUEUE_CONCURRENCY` + `MONITOR_TASK_INTERVAL` → a NEW `### Concurrency & Monitoring`
  subsection under Environment Variables (RESEARCH_QUEUE_CONCURRENCY is already in
  .env.example's "CONCURRENCY CONFIGURATION" block — mirror that grouping).
- `CLASSIFIER_RETRY_MAX` → the existing `### Resilience Tuning` section (it is the delta-
  classifier analog of the COMMIT_RETRY_* knobs — group the "bounded retry with backoff"
  family together). Cite PRD §4.3.
- `TASKS_LOCK_STALE_MS` / `TASKS_LOCK_TIMEOUT_MS` / `TASKS_LOCK_POLL_MS` → the existing
  `### Advanced Configuration` section (or a new `### tasks.json Lock Tunables` subsection).
  These tune the O_EXCL lockfile (`withLockedTasksJSON`, PRD §5.1). Mark as "rarely tuned."
- `HACKY_*` (CLI-overridable ones: LOG_LEVEL, TASK_RETRY_MAX_ATTEMPTS, FLUSH_RETRIES) → the
  `### Advanced Configuration` section, with a note that the `HACKY_` prefix marks
  framework/Groundswell-level knobs exposed as CLI `--flag` env overrides. (Decision scope:
  include the three CLI-backed ones; `HACKY_PRP_CACHE_TTL` is purely internal — document it as
  internal-only or omit. The implementing agent chooses; the PRP lists all four so nothing is
  silently missed.)

> NOTE: these additions must be canonic NAME + default + one-line purpose + PRD cite where
> applicable, matching the existing table style. Do NOT invent defaults — all defaults above
> are copied verbatim from source.

---

## 5. ACCURACY ISSUES — documented vars with NO (or unverified) source backing

- **`BUGFIX_SCOPE` (documented default `subtask`)** — CONFIGURATION.md :180 (Bug Hunt Config
  table) + :508 (Example). A repo-wide grep for `BUGFIX_SCOPE` returns matches ONLY in
  `docs/CONFIGURATION.md` itself. It is **NOT read anywhere in `src/`**. `BUG_RESULTS_FILE`
  (default `TEST_RESULTS.md`) at least appears in `src/agents/prompts.ts:995/1068-1069` as the
  `$BUG_RESULTS_FILE` prompt template var, so it is real; but **BUGFIX_SCOPE has no backing**.
  → Sweep action: VERIFY (grep `src/` + `docs/` + dist); if genuinely absent, REMOVE the row
  from the Bug Hunt table AND the Example block (it is a hallucinated/stale knob and must not
  remain in the "canonical reference"). If a backing is found, cite it and keep.
- **`API_TIMEOUT_MS` (documented default `60000`)** — CONFIGURATION.md :196 (Advanced table) +
  :525 (Example) + `.env.example`. A `src/` grep for `API_TIMEOUT_MS` returns **NOTHING**. It
  is not read in `src/`. It is almost certainly a **Groundswell/framework-level** knob (the SDK
  / harness consumes it), which is why both docs agree on `60000`. → Sweep action: VERIFY by
  grepping `node_modules/@earendil*` / Groundswell; if confirmed framework-level, KEEP it but
  add a one-line note "framework-level (consumed by the Groundswell SDK)" so a reader is not
  sent hunting in `src/config/`. If genuinely nowhere, mark as legacy/removed. Do NOT delete
  blindly (both the doc and .env.example document it consistently).

---

## 6. COHERENCE ISSUES (requirement (c)) — the substantive sweep work

### 6a. Duplicate "Model Selection" framing (the biggest coherence defect)
There are TWO headings both called "Model Selection":
- `### Model Selection` (Environment Variables, :92) = the **env-var table** (`PRP_MODEL_*`).
- `## Model Selection` (:273) = the **conceptual** section (Model Tiers / When to Use Each
  Tier / Model Roles / Model Override / Deprecation).

The ToC even slug-collides the second to `#model-selection-1`. This is confusing. AND the two
sub-stories mildly contradict:
- `### Model Tiers` table (:278) binds **Agents → tiers** ("high→Architect",
  "balanced→Researcher, Coder, QA", "fast→Future: quick lookups"). This implies agents pick
  tiers directly.
- `### Model Roles` table (:308) binds **roles → {tier, budget} → personas**
  ("Research→balanced/normal→Researcher", "Reasoning→balanced/xhigh→Architect,Bug-finder,
  Validation", "Implementation→fast/normal→Coder"). This is the CORRECT/authoritative story
  (PRD §9.2.3 / §6.1; `ROLE_CONFIG` agent-factory.ts:253-258 — confirmed in sibling
  verified-facts.md §b).

→ Sweep action: RECONCILE so the doc tells ONE coherent story. Recommended framing:
  1. The **env-var table** (`### Model Selection` under Environment Variables) is the
     canonical "which env var overrides which tier" reference — keep it, point to the
     conceptual section for roles.
  2. The **conceptual `## Model Selection`** section leads with: "The pipeline selects models
     via THREE ROLES (research/reasoning/implementation), each mapping to a quality TIER
     (high/balanced/fast) and a reasoning budget. The `PRP_MODEL_*` env vars override the tier
     defaults." Then present Tiers (as quality levels, NOT agent bindings) + Roles (the
     authoritative persona→role→tier→budget mapping) + Override + Deprecation.
  3. FIX the `### Model Tiers` table: drop/soften the stale "Agents" column (or relabel it
     "Role that uses it" and reference the Roles table). The "fast → Future: quick lookups"
     row is STALE (fast IS used — by the Implementation role / Coder / Cleanup). Correct it.
  4. Resolve the duplicate heading: either rename the conceptual section (e.g.
     `## Models, Roles & Reasoning Budget`) or merge. Whatever is chosen, the ToC anchor must
     match and must not collide.

### 6b. `SKIP_EXECUTION_LOOP` description is adopt-mode-incomplete
Pipeline Control table (:141) says `SKIP_EXECUTION_LOOP` = "Skip execution, run validation
only. Set to true to validate PRDs without executing tasks." This omits that **adopt mode**
sets it (PRD §4.6 / §9.2.2) — the Adopt Mode section (:263) already cross-links it, but the
env-var row should note "also set internally by `--adopt-prd`." Similarly `SKIP_BUG_FINDING`
(:140) omits the "also identifies bug fix mode when `true`" nuance (PRD §9.2.2).

### 6c. `### Resilience Tuning` family is split
RESEARCH_TIMEOUT / PARALLEL_RESEARCH / RESEARCH_DEPTH / ISSUE_RETRY_MAX (research/replan
resilience) share a section with COMMIT_RETRY_MAX / COMMIT_RETRY_DELAY / COMMIT_RETRY_DELAY_CAP
(commit resilience). Missing sibling: `CLASSIFIER_RETRY_MAX` (delta-classifier resilience,
PRD §4.3) — add it so all "bounded retry with backoff" knobs are together and cross-referenced
(commit-gen retry vs. classifier retry — both transient-API-sensitive, both total-attempt
counts, both fail to a safe fallback on exhaustion).

### 6d. `.env.example` ↔ `docs/CONFIGURATION.md` drift
`.env.example` has sections CONFIGURATION.md lacks or mismatches:
- `.env.example` has a "CONCURRENCY CONFIGURATION" block (RESEARCH_QUEUE_CONCURRENCY) →
  CONFIGURATION.md has NO concurrency section. Add one (§4).
- `.env.example` lacks the `### Distributed PRDs` knobs? No — it HAS them (PRD_INCLUDE_*).
  Good. But `.env.example` lacks CLASSIFIER_RETRY_MAX, TASKS_LOCK_*, VALIDATION/BUG_FINDER,
  RESEARCH_DEPTH/TIMEOUT... wait — `.env.example` DOES have VALIDATION_*, BUG_FINDER_AGENT,
  PARALLEL_RESEARCH, RESEARCH_DEPTH, RESEARCH_TIMEOUT, COMMIT_RETRY_*. So `.env.example` is
  fairly complete. The drift is mostly CONFIGURATION.md MISSING entries that `.env.example`
  HAS (RESEARCH_QUEUE_CONCURRENCY) and both MISSING CLASSIFIER_RETRY_MAX / TASKS_LOCK_* /
  MONITOR_TASK_INTERVAL.
- `.env.example` documents only canonical names with legacy names in a deprecation NOTE
  (§9.2.8-compliant) — CONFIGURATION.md should mirror that discipline (§6a/§3).

> SCOPE NOTE: `.env.example` is OUT OF SCOPE for this PRP (the contract says update
> `docs/CONFIGURATION.md`; `.env.example` is a separate file and a sibling-responsibility
> question). The sweep should keep CONFIGURATION.md coherent WITH `.env.example` but must NOT
> edit `.env.example`. If a drift is found, document it in CONFIGURATION.md only and flag
> `.env.example` drift as a follow-up note (do not touch it).

### 6e. Adopt Mode coherence
The `### Adopt Mode (--adopt-prd)` CLI subsection (:263) is accurate (`.adopted` marker,
completed baseline tasks.json, SKIP_EXECUTION_LOOP, validation+bug-hunt still run, guard rails)
and matches the sibling ARCHITECTURE.md framing. No change needed beyond ensuring
SKIP_EXECUTION_LOOP (§6b) and the cross-link are coherent.

---

## 7. STALE SWEEP (opus/sonnet/haiku as tier names; ANTHROPIC_DEFAULT as current)

Grep `docs/CONFIGURATION.md` for `\b(opus|sonnet|haiku)\b` → only 2 hits, both LEGITIMATE
Anthropic-provider MODEL-ID EXAMPLES (not tier names):
- :551 `export PRP_MODEL_BALANCED="anthropic/claude-sonnet-4"` (Common Gotchas — example)
- :649 `# export PRP_MODEL_BALANCED="anthropic/claude-sonnet-4-20250514"` (claude-code gotcha)
These are fine (they show an `anthropic/*` model string, not the old "sonnet tier"). KEEP.
`ANTHROPIC_DEFAULT_*` appears only in the deprecation table + legacy-alias inline notes (correct
context). **No stale tier-name usage exists.** The sweep's stale-check is a GUARD (ensure new
edits introduce none), not a cleanup.

---

## 8. Validation gates (docs/CONFIGURATION.md)

- `npx prettier --check docs/CONFIGURATION.md` — format:check scope is `**/*.{ts,js,json,md,
  yml,yaml}`; CONFIGURATION.md is NOT in `.prettierignore`. **HARD gate.** Auto-fix:
  `npm run format` (or `npx prettier --write docs/CONFIGURATION.md`).
- `npm run docs:lint` (= `markdownlint "docs/**/*.md"`) — `.markdownlintignore` excludes only
  `docs/api/`, so CONFIGURATION.md IS linted. Config: `default:true, MD013 (line length) OFF,
  MD024 (no-duplicate-heading) siblings_only:true, MD036 (emphasis-as-heading) OFF`. MD040
  (fenced-code-language) is ON → every fenced block needs a language tag. **The two "Model
  Selection" headings are at different levels (`###` vs `##`) so they are NOT an MD024 violation
  today — but renaming/merging resolves the reader-confusion regardless.**
- `npm run validate` (= lint && format:check && typecheck && test:run) — format:check is the
  step covering this doc; GREEN.
- Scope guard: `git diff --name-only` must = EXACTLY `docs/CONFIGURATION.md`
  (+ this PRP's `plan/008_15504f60a0ef/P6M1T1S3/*` artifacts, gitignored under `plan/`).

---

## 9. Sibling coordination (parallel execution)

- **P6.M1.T1.S1** owns `README.md` (DONE). It links into CONFIGURATION.md for env-var depth.
  Any heading the README links to (verify `#` anchors against the final CONFIGURATION.md
  headings) must keep resolving. If a heading is renamed/merged (§6a), re-verify README's
  `docs/CONFIGURATION.md#...` links and update the README? NO — README is S1's file (DONE,
  out of scope). So prefer heading names that PRESERVE existing anchors; if a rename is
  unavoidable, keep the old heading as an anchor or accept that S1's link may need a later
  follow-up (flag it). SAFEST: do not rename existing top-level headings that README links to.
- **P6.M1.T1.S2** owns `docs/ARCHITECTURE.md` (being implemented in parallel). It LINKS OUT to
  CONFIGURATION.md for env-var knobs (e.g. `#distributed-prds`, model-roles anchors). The
  sweep should preserve existing CONFIGURATION.md anchors that ARCHITECTURE.md links to:
  - `#distributed-prds` (### Distributed PRDs :161) — KEEP
  - the Model Roles content — keep an anchor ARCHITECTURE.md can point at
  - any `#resilience-tuning`, `#validation-control`, `#bug-hunt-configuration` anchors — KEEP
  New subsections (Concurrency, tasks.json Lock Tunables) get new anchors — fine.

---

## 10. Summary of the DELTA the implementing agent must produce

The doc is ~90% there. The DELTA (in dependency order):

1. CONFIRM contract (a) — all 14 canonical vars present w/ correct defaults (§2). No edits
   needed unless coherence (§6a) rewords.
2. CONFIRM contract (b) — deprecation table complete + source-accurate (§3). Keep as
   authoritative; optionally trim inline legacy mentions per §6a.
3. ADD the undocumented pipeline-global env vars (§4): RESEARCH_QUEUE_CONCURRENCY,
   MONITOR_TASK_INTERVAL, CLASSIFIER_RETRY_MAX, TASKS_LOCK_STALE_MS/TIMEOUT_MS/POLL_MS, and
   the CLI-backed HACKY_* knobs (LOG_LEVEL, TASK_RETRY_MAX_ATTEMPTS, FLUSH_RETRIES; note
   HACKY_PRP_CACHE_TTL as internal). Place in coherent sections.
4. FIX accuracy (§5): verify + resolve BUGFIX_SCOPE (likely remove) and API_TIMEOUT_MS (mark
   framework-level or verify).
5. RECONCILE coherence (§6): unify the two Model Selection sections (one coherent
   roles→tiers→budgets→env-vars story; fix the stale "fast→Future" and "Agents" column); fix
   SKIP_EXECUTION_LOOP / SKIP_BUG_FINDING descriptions (adopt mode / bug-fix mode nuance);
   group CLASSIFIER_RETRY_MAX with the retry family; fix ToC slug collision.
6. STALE guard (§7): ensure new edits introduce no opus/sonnet/haiku-as-tier, no harness-
   qualified model strings, no ANTHROPIC_DEFAULT as current names.
7. VALIDATE (§8) + preserve sibling anchors (§9).