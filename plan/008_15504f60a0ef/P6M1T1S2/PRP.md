# PRP — P6.M1.T1.S2: Update docs/ARCHITECTURE.md for resolved-document invariant and new behaviors

---

## Goal

**Feature Goal**: Bring `docs/ARCHITECTURE.md` into sync with every architectural behavior
shipped in Phases 1–5 of session 008, so a reader of the architecture doc sees an accurate,
top-level picture of the pipeline as it exists today. Concretely, add four capability-level
sections: **(a)** the **resolved-document invariant** for distributed (multi-file) PRDs
(§2.3), **(b)** the **three model roles + reasoning budget** (research/reasoning/
implementation, with the reasoning role pinned to the `xhigh` maximum budget), **(c)** the
**two-phase commit + state-integrity protections** (pre/post-cleanup `stagecoach` commits,
`restore_critical_files`, `flock` mutex on `tasks.json`, orphaned-`plan/` recovery, terminal
watchdog kills, `NO_ISSUES_FOUND.md`), and **(d)** **adopt mode** (`--adopt-prd`). Replace
any stale framing if present (single-slot prefetch, simplified bug-fix breakdown, old tier
names opus/sonnet/haiku).

**Deliverable**: An updated `docs/ARCHITECTURE.md` (single file). Four new sections are
added at the top level, the `#### Agent Types` table in §3 is refreshed with role/tier/
budget columns, the brief Session-Manager resolved-document subsection is trimmed to a
cross-reference, the Table of Contents is updated, and the doc stays prettier-clean +
markdownlint-clean. No source code, tests, configs, or other docs are touched.

**Success Definition**: Every architectural claim in the updated doc is accurate against the
implementation (file:line citations in the research notes). `npx prettier --check
docs/ARCHITECTURE.md` PASSES; `npm run docs:lint` (markdownlint, currently a clean baseline)
stays GREEN with no NEW violations; `npm run validate` GREEN; `git diff --name-only` =
exactly `docs/ARCHITECTURE.md` (plus this PRP's own `plan/` artifacts). A grep confirms none
of the four new behaviors is missing and none of the stale terms leaked in.

---

## User Persona (if applicable)

**Target User**: A developer or contributor reading `docs/ARCHITECTURE.md` to understand the
pipeline's internal design — how the resolved PRD flows through the system, how models/roles/
reasoning budgets are chosen, how a subtask is safely committed and how `tasks.json` is
guarded, and how adopt mode bootstraps a legacy codebase.

**Use Case**: Read System Overview → Resolved-Document Invariant → Model Roles → State
Integrity → Adopt Mode, then jump to `docs/CONFIGURATION.md` for env-var depth and
`docs/CLI_REFERENCE.md` for flag detail.

**User Journey**: A new contributor opens ARCHITECTURE.md expecting a true picture of the
current pipeline. Today they get a generic "Architect/Researcher/Coder/QA" table with token
limits and NO mention of model roles, reasoning budgets, distributed PRDs, two-phase commits,
integrity protections, or adopt mode — so the doc misrepresents the system.

**Pain Points Addressed**: The doc (a) omits the resolved-document invariant at the
capability level (only a brief note buried under Session Manager), (b) has no model-role /
reasoning-budget framing at all, (c) documents `tasks.json` recovery but not the two-phase
commit, `flock`, `restore_critical_files`, orphaned-plan recovery, terminal watchdog kills,
or the `NO_ISSUES_FOUND.md` marker, and (d) never mentions adopt mode.

---

## Why

- **Work-item CONTRACT mapping (verbatim from item description):**
  - **(1) RESEARCH NOTE** — PRD §6 (Phase 6) specifies `docs/ARCHITECTURE.md` should refresh
    top-level capability framing for: the resolved-document invariant (§2.3), the three model
    roles + reasoning budget, the two-phase commit + integrity protections, and adopt mode.
    Ensure no stale 'single-slot prefetch' / 'simplified bug-fix breakdown' framing remains.
  - **(2) INPUT** — all implementing subtasks from Phases 1–5 (all marked Complete in
    `<plan_status>`).
  - **(3) LOGIC** — (a) add resolved-document invariant §2.3; (b) add three model roles +
    reasoning budget (xhigh for decomposition); (c) add two-phase commit + integrity
    protections; (d) add adopt mode; (e) remove/replace stale references (single-slot prefetch
    → depth-chained; simplified bug-fix breakdown → standard full breakdown; opus/sonnet/haiku
    → high/balanced/fast).
  - **(4) OUTPUT** — updated `docs/ARCHITECTURE.md`; no further subtask consumes it; completes
    part of P6.M1.
  - **(5) DOCS** — [Mode B] this IS the documentation task (changeset-level sweep).
- **PRD compliance**: §2.3 (distributed PRDs), §4.2 step 4 (two-phase commit), §4.4
  (`NO_ISSUES_FOUND.md`, terminal watchdog kills), §4.6 (adopt mode), §5.1 (flock mutex,
  `restore_critical_files`, orphaned-plan recovery, tasks.json restore), §9.2.3 (three model
  roles + xhigh reasoning budget), §9.3.2 (stateless single-shot, watchdog-terminal).
- **Sibling coordination (parallel execution)**: P6.M1.T1.S1 owns `README.md` (high-level
  summary that *links* to ARCHITECTURE.md for depth); P6.M1.T1.S3 owns `docs/CONFIGURATION.md`
  (the canonical env-var reference). This item owns `docs/ARCHITECTURE.md` **only**. S1's PRP
  deep-links into ARCHITECTURE.md anchors (e.g. `#tasksjson-protection--smart-recovery`); the
  new sections MUST preserve that existing anchor and use markdown slug-safe headings so any
  S1 cross-link still resolves. ARCHITECTURE.md links OUT to CONFIGURATION.md for env-var knobs
  and to CLI_REFERENCE.md for flag detail — it does not duplicate them.

---

## What

A documentation-only (Mode B) update to the single file `docs/ARCHITECTURE.md`. No source code,
no tests, no config files, no other docs. The edits, in dependency order:

1. **NEW top-level section `## Resolved-Document Invariant (Distributed PRDs)`** — placed
   immediately after `## System Overview` (before `## Four Core Processing Engines`). Full
   capability framing: include directives + expansion rules (boundary/existence), project-
   root-relative resolution, recursive expansion with cycle detection up to
   `PRD_INCLUDE_MAX_DEPTH` (default 10), idempotency, optional `PRD_INCLUDE_MARKERS`, the
   stale-include stderr warning, and the **single canonical resolved document downstream**
   (hashing, `prd_snapshot.md`, delta detection, delta-PRD inputs, integration/validation/
   bug-finder prompts, `prd_selectors`/mdsel all operate over the fully-resolved document).
   Cite PRD §2.3. Link to `docs/CONFIGURATION.md` for the env knobs.
2. **TRIM the existing `##### Resolved-document invariant` subsection** (under "1. Session
   Manager") to a one-line cross-reference to the new top-level section, so the invariant is
   documented once, at the capability level.
3. **REFRESH the `#### Agent Types` table** (§3 Agent Runtime) — add **Role**, **Tier**,
   **Reasoning budget** columns alongside the existing Persona/Responsibility/Token-limit
   columns, reflecting the persona→role mapping (`research/verified-facts.md` §b). Use tier
   names `high/balanced/fast` (NEVER opus/sonnet/haiku).
4. **NEW top-level section `## Model Roles & Reasoning Budget`** — placed after
   `## Multi-Agent Architecture`. Document the three roles (research/reasoning/implementation),
   the `ROLE_CONFIG` mapping (research→balanced/normal; reasoning→balanced/`xhigh`;
   implementation→fast/normal), why decomposition/validation/bug-finding pin the maximum
   reasoning budget, the canonical↔legacy env-var names with the one-time deprecation warning,
   and that models are provider-qualified (`zai/glm-5.2`) never harness-qualified. Cite PRD
   §9.2.3 / §6.1. Link to CONFIGURATION.md for the full env-var table.
5. **NEW subsection `### Two-Phase Commit (Per-Item Survival)`** — placed under
   `## State Management and Persistence`, adjacent to the existing `### tasks.json Protection
   & Smart Recovery` subsection. Document the pre-cleanup survival commit (source + `plan/` +
   Complete status, via `stagecoach`) and the post-cleanup doc-reorg commit, and WHY (a
   force-interrupt during cleanup can no longer orphan `plan/`). Cite PRD §4.2 step 4.
6. **NEW subsection `### State Integrity Protections`** — placed immediately after the
   two-phase-commit subsection. Document: `flock`-based process-level mutex on `tasks.json`
   RMW (`withLockedTasksJSON`), `restore_critical_files` (mechanical `PRD.md`/`PRP.md`
   deletion protection, the backstop to the prompt layer), orphaned-`plan/` recovery (the
   skip-recovery HEAD `tasks.json` Completed check + stranded-state commit), terminal
   watchdog kills (exit 124 / `timedOut` → hard failure, never retried, run aborts before
   bug-hunt), and the `NO_ISSUES_FOUND.md` hunt marker (clean vs. never-hunted). Cite PRD
   §5.1 / §4.4 / §9.3.2. The existing `### tasks.json Protection & Smart Recovery` subsection
   stays accurate — keep it and reference it from here.
7. **NEW top-level section `## Adopt Mode (--adopt-prd)`** — placed after
   `## Task Hierarchy and Execution Flow`, before `## See Also`. Document: declaring an
   already-shipped codebase as the PRD's baseline on a fresh project (no `plan/` sessions); the
   `.adopted` marker + a single completed baseline `tasks.json` (one Phase→Milestone→Task→
   "Adopt existing codebase" Subtask, all Complete) with no breakdown and no agent tokens;
   `SKIP_EXECUTION_LOOP` (execution skipped, **validation + bug-hunt still run**); the guard
   rails (requires PRD; fresh-project only / no-op otherwise; rejects empty session dir;
   `mkdir -p` plan dir first). Cite PRD §4.6. Link to CLI_REFERENCE.md for the flag.
8. **UPDATE `## Table of Contents`** — add entries for the four new top-level sections
   (Resolved-Document Invariant, Model Roles & Reasoning Budget, Adopt Mode) and note the two
   new subsections under State Management.
9. **STALE SWEEP (e)** — grep-verify the final doc contains NONE of: `single-slot`,
   `single slot`, `simplified bug-fix`, `Opus`, `Sonnet`, `Haiku`, `ANTHROPIC_DEFAULT`. (None
   exist today; this guards against introducing any.) Depth-chained research is framed as such;
   bugfix breakdowns are framed as the standard full breakdown.

### Success Criteria

- [ ] A `## Resolved-Document Invariant (Distributed PRDs)` top-level section exists, covering
      include directives, expansion rules (boundary/existence), project-root-relative
      resolution, cycle detection + `PRD_INCLUDE_MAX_DEPTH` (default 10), idempotency,
      `PRD_INCLUDE_MARKERS`, stale-include warning, and the single-canonical-document
      downstream list (hashing, snapshot, delta detection, prompts, `prd_selectors`). PRD §2.3
      cited.
- [ ] The brief Session-Manager resolved-document subsection is trimmed to a one-line
      cross-reference (no duplication).
- [ ] The `#### Agent Types` table has Role / Tier / Reasoning-budget columns; tiers are
      high/balanced/fast (no opus/sonnet/haiku).
- [ ] A `## Model Roles & Reasoning Budget` top-level section documents the three roles +
      `ROLE_CONFIG` (reasoning role = balanced @ `xhigh`), the canonical↔legacy env-var names +
      deprecation warning, and provider-qualified-not-harness-qualified model strings. PRD
      §9.2.3/§6.1 cited.
- [ ] A `### Two-Phase Commit (Per-Item Survival)` subsection documents the pre-cleanup
      survival commit + post-cleanup doc-reorg commit via stagecoach and the orphan-prevention
      rationale. PRD §4.2 step 4 cited.
- [ ] A `### State Integrity Protections` subsection documents flock mutex
      (`withLockedTasksJSON`), `restore_critical_files` (`PRD.md`/`PRP.md`), orphaned-`plan/`
      recovery (skip-recovery HEAD check), terminal watchdog kills (exit 124/`timedOut`), and
      `NO_ISSUES_FOUND.md`. PRD §5.1/§4.4/§9.3.2 cited.
- [ ] A `## Adopt Mode (--adopt-prd)` top-level section documents the baseline seeding
      (`.adopted` + completed `tasks.json`, no breakdown/tokens), `SKIP_EXECUTION_LOOP`
      (validation + bug-hunt still run), and the guard rails. PRD §4.6 cited.
- [ ] Table of Contents lists the four new top-level sections.
- [ ] `npx prettier --check docs/ARCHITECTURE.md` PASSES; `npm run docs:lint` GREEN with no
      NEW violations (clean baseline); `npm run validate` GREEN; `git diff --name-only` =
      exactly `docs/ARCHITECTURE.md`.
- [ ] Final grep confirms NONE of: `single-slot`, `simplified bug-fix`, `Opus|Sonnet|Haiku`,
      `ANTHROPIC_DEFAULT`.

---

## All Needed Context

### Context Completeness Check

✅ "No Prior Knowledge" — an agent with zero codebase knowledge can implement this from: the
FULL current `docs/ARCHITECTURE.md` (read first), the verified-facts research notes (every
architectural behavior cited to file:line), the verbatim PRD sections (§2.3/§4.2/§4.4/§4.6/
§5.1/§9.2.3/§9.3.2 — provided upstream in the PRP prompt's `<selected_prd_content>`), the
exact section-placement plan, and the validation gates. No inference required — every claim
is grounded.

### Documentation & References

```yaml
# MUST READ — the file being edited (the ONLY deliverable)
- file: docs/ARCHITECTURE.md
  why: The current architecture doc. Every edit is here. Read it fully first.
  pattern: |
    Current structure (headings):
      # Architecture Overview → ## Table of Contents → ## System Overview
        (### Design Philosophy / ### High-Level Architecture / ### System Flow Description)
      ## Four Core Processing Engines
        ### 1. Session Manager     (has brief "##### Resolved-document invariant" → TRIM)
        ### 2. Task Orchestrator
        ### 3. Agent Runtime       (has "#### Agent Types" table → REFRESH w/ role/tier/budget)
        ### 4. Pipeline Controller
      ## Groundswell Framework Integration
      ## Multi-Agent Architecture
      ## State Management and Persistence
        ### tasks.json Protection & Smart Recovery   (ACCURATE — keep)
      ## Task Hierarchy and Execution Flow
      ## See Also
    Placement targets for the four new behaviors: see "What" §1-8 above.

# MUST READ — the verified facts (every architectural claim, cited to file:line)
- file: plan/008_15504f60a0ef/P6M1T1S2/research/verified-facts.md
  why: §a resolved-document invariant; §b three model roles + ROLE_CONFIG + persona→role
       mapping table; §c two-phase commit + flock + restore_critical_files + orphaned-plan
       recovery + watchdog-terminal + NO_ISSUES_FOUND; §d adopt mode; §e stale-sweep
       confirmation; validation gates; current-doc structure; placement plan.
  section: "(a)/(b)/(c)/(d)/(e) + Placement plan"

# REFERENCE — sibling docs to mirror wording / link to (do NOT duplicate)
- file: docs/CLI_REFERENCE.md
  why: ALREADY updated. The --adopt-prd flag (:324/:252/:272) + --accept-prd-changes +
       --mode (validate/bug-hunt) + prd status alias wording is canonical; reuse its concise
       phrasing for the Adopt Mode section so the two docs stay consistent.
- file: docs/CONFIGURATION.md
  why: P6.M1.T1.S3 owns it; ARCHITECTURE.md LINKS to it for env-var knobs
       (PRD_INCLUDE_MAX_DEPTH/PRD_INCLUDE_MARKERS, PRP_MODEL_*, RESEARCH_DEPTH, etc.) rather
       than duplicating the table. Verify the #anchors you link to exist.

# REFERENCE — the authoritative source files (read to confirm any claim; do NOT edit)
- file: src/agents/agent-factory.ts
  why: ROLE_CONFIG (~:253-258), ThinkingLevel (:123), createArchitectAgent (:354,
       'reasoning'), createResearcherAgent (:386, 'research'), createCoderAgent (:419,
       'implementation'), createQAAgent (:453, 'reasoning'), createCleanupAgent (:506,
       'implementation'). The persona→role→tier→budget mapping.
- file: src/config/constants.ts
  why: MODEL_NAMES {high=glm-5.2, balanced=glm-5.2, fast=glm-5-turbo} (:44-50); MODEL_ENV_VARS
       (:70-73); LEGACY_MODEL_ENV_VARS (:92-95); VALIDATION_AGENT/DEFAULT pizr (:704/720);
       BUG_FINDER_AGENT/DEFAULT pizr (:843/859); RESEARCH_DEPTH default 2 (:315);
       PARALLEL_RESEARCH (:355); RESEARCH_TIMEOUT default 1800s (:249); ISSUE_RETRY_MAX
       default 3 (:405).
- file: src/core/task-orchestrator.ts
  why: executeSubtask two-phase commit (~:1056-1124 — pre-cleanup :1061, cleanup :1077-1090,
       post-cleanup :1113); orphaned-plan skip-recovery HEAD check (:1287, :781-803).
- file: src/core/file-lock.ts
  why: flock-equivalent process-level mutex on tasks.json RMW; withLockedTasksJSON accessor;
       two-layer (in-process async mutex + O_EXCL lockfile).
- file: src/utils/git-commit.ts
  why: restore_critical_files (:288, called from smartCommit :468/:469) — staged-deletion
       detection, PRD.md/PRP.md basename protection, HEAD-checkout/unstage strategy, non-fatal.
- file: src/core/tasks-json-recovery.ts
  why: the already-documented smart recovery (re-apply delta + git-history restore + preserve
       Researching/Retrying). Confirms the existing ARCHITECTURE.md subsection is accurate.
- file: src/agents/prp-executor.ts
  why: terminal watchdog-kill handling (:386-394, :558 timedOut||exitCode===124).
- file: src/workflows/validation-workflow.ts
  why: watchdog kill = timedOut===true OR exitCode===124, BOTH terminal (:22-29).
- file: src/workflows/bug-hunt-workflow.ts
  why: NO_ISSUES_FOUND.md write/remove (:480-594); clean-hunt commit (:505).
- file: src/core/session-manager.ts
  why: seedAdoptedBaseline (~:841) — .adopted marker (:864) + createAdoptedBaseline +
       writeTasksJSON; in-memory registry update so decomposePRD auto-skips the Architect.
- file: src/workflows/prp-pipeline.ts
  why: adoptPrd (:203), skipExecutionLoop (:212/:698/:1258); guard rails (:659-698) — fresh-
       project-only no-op (:667-671), validation+bug-hunt still run (:1260).
- file: src/core/session-utils.ts
  why: resolvePRD (:564) + resolveIncludes (:366); resolved-document hashing (:279) +
       snapshotPRD (:1080).

# REFERENCE — the PRD sections (provided verbatim upstream in the PRP prompt's
# selected_prd_content; re-read there for exact wording to paraphrase)
- docfile: PRD.md
  section: "§2.3 Distributed (Multi-File) PRDs"
- docfile: PRD.md
  section: "§4.2 The Execution Loop (two-phase commit step 4; depth-chained research)"
- docfile: PRD.md
  section: "§4.4 The QA & Bug Hunt Loop (NO_ISSUES_FOUND.md; terminal watchdog kills)"
- docfile: PRD.md
  section: "§4.6 Adopt Mode (--adopt-prd)"
- docfile: PRD.md
  section: "§5.1 State & File Management (flock; restore_critical_files; orphaned-plan recovery)"
- docfile: PRD.md
  section: "§9.2.3 Model Selection (three roles + xhigh reasoning budget)"
- docfile: PRD.md
  section: "§9.3.2 Task Orchestrator (stateless single-shot; watchdog-terminal)"
```

### Current Codebase tree (relevant slice)

```bash
docs/ARCHITECTURE.md                     # MODIFY — the single deliverable (docs-only)

# AUTHORITATIVE REFERENCES (read, do not edit):
docs/CLI_REFERENCE.md                    # already updated; wording reference for Adopt Mode
docs/CONFIGURATION.md                    # P6.M1.T1.S3 owns it; ARCHITECTURE links to it
src/agents/agent-factory.ts              # ROLE_CONFIG + persona→role factories
src/config/constants.ts                  # MODEL_NAMES / MODEL_ENV_VARS / *_AGENT defaults
src/core/task-orchestrator.ts            # two-phase commit + skip-recovery
src/core/file-lock.ts                    # flock-equivalent withLockedTasksJSON
src/utils/git-commit.ts                  # restore_critical_files + smartCommit
src/core/session-manager.ts              # seedAdoptedBaseline
src/workflows/prp-pipeline.ts            # adoptPrd guard rails + skipExecutionLoop
src/core/session-utils.ts                # resolvePRD + downstream threading
PRD.md                                   # §2.3/§4.x/§5.x/§9.2.3/§9.3.2 (verbatim in PRP prompt)
```

### Desired Codebase tree with files to be modified

```bash
docs/ARCHITECTURE.md
  # Table of Contents: + Resolved-Document Invariant, Model Roles & Reasoning Budget, Adopt Mode
  # + NEW "## Resolved-Document Invariant (Distributed PRDs)" (after System Overview)
  # §1 Session Manager: TRIM "##### Resolved-document invariant" → one-line cross-ref
  # §3 Agent Runtime: REFRESH "#### Agent Types" table with Role/Tier/Reasoning-budget cols
  # + NEW "## Model Roles & Reasoning Budget" (after Multi-Agent Architecture)
  # State Management: + "### Two-Phase Commit (Per-Item Survival)"
  # State Management: + "### State Integrity Protections" (flock/restore_critical_files/
  #   orphaned-plan/watchdog-terminal/NO_ISSUES_FOUND)
  # + NEW "## Adopt Mode (--adopt-prd)" (after Task Hierarchy, before See Also)
# (NO other files modified. plan/008_15504f60a0ef/P6M1T1S2/* are this PRP's own artifacts.)
```

### Known Gotchas of our codebase & Library Quirks

```markdown
<!-- CRITICAL: markdownlint IS a hard gate for docs/ARCHITECTURE.md. Unlike the root README
     (where markdownlint isn't a CI gate), `npm run docs:lint` = `markdownlint "docs/**/*.md"`
     and `.markdownlintignore` excludes ONLY docs/api/. ARCHITECTURE.md currently PASSES CLEAN
     (verified). Config: default:true, MD013 (line length) OFF, MD024 (no-duplicate-heading)
     siblings_only:true, MD036 (emphasis-as-heading) OFF. So:
       - Every NEW fenced code block MUST have a language tag (```mermaid/```typescript/
         ```text/```json) — MD040-safe. The existing mermaid/ts/json/text fences already do.
       - Do NOT create a heading with the SAME text as a sibling heading at the same level
         (MD024 siblings_only). The new top-level headings are all unique.
       - MD013 is OFF, so long prose lines are fine (no need to hard-wrap). -->

<!-- CRITICAL: prettier format:check covers docs/ARCHITECTURE.md. Scope is `**/*.{ts,js,json,
     md,yml,yaml}` and ARCHITECTURE.md is NOT in .prettierignore. Tables and code fences must
     be prettier-clean. Run `npm run format` (or `npx prettier --write docs/ARCHITECTURE.md`)
     to auto-fix if format:check fails. -->

<!-- CRITICAL: sibling coordination (parallel execution). S1 (README) deep-links into
     ARCHITECTURE.md anchors, e.g. #tasksjson-protection--smart-recovery. PRESERVE that
     existing anchor (the heading "tasks.json Protection & Smart Recovery" stays verbatim).
     For any NEW heading, the markdown anchor slug = lowercase, spaces→hyphens, punctuation
     stripped (e.g. "Model Roles & Reasoning Budget" → #model-roles--reasoning-budget).
     S1's PRP links to #tasksjson-protection--smart-recovery — do NOT rename that heading. -->

<!-- CRITICAL: tier names are high/balanced/fast (NOT opus/sonnet/haiku). The DEFAULT model
     VALUES are unchanged (glm-5.2 / glm-5.2 / glm-5-turbo). The rename is opus→high,
     sonnet→balanced, haiku→fast. NEVER write "Opus tier" or "Sonnet model" in the new
     content. Use the canonical env-var names (PRP_MODEL_HIGH/BALANCED/FAST), and only mention
     the legacy ANTHROPIC_DEFAULT_* names inside the canonical↔legacy deprecation note. -->

<!-- CRITICAL: model strings are provider-qualified ('zai/glm-5.2'), NEVER harness-qualified
     ('pi/zai/glm-5.2' is INVALID). Keep this rule visible in the Model Roles section. -->

<!-- GOTCHA: the resolved-document invariant is ALREADY documented (briefly) under §1 Session
     Manager ("##### Resolved-document invariant", which defers to "P6"). This PRP IS that P6
     framing. Do NOT duplicate the full explanation in both places — put the capability-level
     framing in the NEW top-level section and TRIM the Session-Manager note to a one-line
     cross-reference. -->

<!-- GOTCHA: the existing "### tasks.json Protection & Smart Recovery" subsection is ACCURATE
     (re-apply delta + git-history restore + preserve Researching/Retrying; "There is no Ready
     status"). Keep it. The NEW "State Integrity Protections" subsection is its SIBLING —
     cross-reference it, do not re-explain recovery there. The NEW "Two-Phase Commit"
     subsection is ALSO a sibling — it covers the per-item commit lifecycle, recovery covers
     corruption survival. They complement each other. -->

<!-- GOTCHA: the reasoning budget is realized via a `thinking` field that RIDES on the agent
     config object for downstream harness wiring (Groundswell's AgentConfig does not natively
     model thinking). State this accurately — do NOT claim Groundswell consumes `thinking`
     directly. Only the Reasoning role sets `thinking: 'xhigh'`; research/implementation omit
     it (normal budget). -->

<!-- GOTCHA: 'pizr' / 'piznt' are BASH-PIPELINE identifiers (PRD §9.2.3), referenced in the
     source JSDoc as historical cross-refs. In the TS rewrite the personas are
     Architect/Researcher/Coder/QA/Cleanup. Mention pizr/piznt ONLY as a parenthetical
     equivalence if at all; lead with the TS persona names + role/tier/budget. -->

<!-- GOTCHA: NO_ISSUES_FOUND.md, terminal watchdog kills, and the flock mutex are PHASE-3/4
     behaviors — ensure each is attributed to its PRD section (§4.4 / §9.3.2 / §5.1) so a
     reader can trace it. -->
```

---

## Implementation Blueprint

### Data models and structure

None — documentation-only. The only "model" is the **persona → role → tier → reasoning-budget
mapping**, the authoritative source for the Agent Types table refresh and the Model Roles
section. From `research/verified-facts.md` §b:

| Persona   | Factory                       | Role          | Tier (MODEL_NAMES) | Reasoning budget | Purpose |
|-----------|-------------------------------|---------------|--------------------|------------------|---------|
| Architect | `createArchitectAgent`        | Reasoning     | balanced (glm-5.2) | **`xhigh`**      | Task decomposition |
| Researcher| `createResearcherAgent`       | Research      | balanced (glm-5.2) | normal           | PRP creation / research |
| Coder     | `createCoderAgent`            | Implementation| fast (glm-5-turbo) | normal           | PRP execution / fix |
| QA        | `createQAAgent`               | Reasoning     | balanced (glm-5.2) | **`xhigh`**      | Validation + bug-finder (`pizr`) |
| Cleanup   | `createCleanupAgent`          | Implementation| fast (glm-5-turbo) | normal           | Post-validation doc reorg (stateless) |

`ROLE_CONFIG` = `{ research:{tier:'balanced'}, reasoning:{tier:'balanced',thinking:'xhigh'},
implementation:{tier:'fast'} }`. Tier rename: opus→high, sonnet→balanced, haiku→fast. Canonical
env vars: `PRP_MODEL_HIGH/BALANCED/FAST` (legacy `ANTHROPIC_DEFAULT_*` deprecated, one-time
warning).

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: READ the current doc + references (no edits yet)
  - READ: docs/ARCHITECTURE.md (full), this PRP's research/verified-facts.md (the fact base),
    and skim docs/CLI_REFERENCE.md (Adopt Mode wording reference). Re-confirm the current-doc
    structure in verified-facts.md "Current ARCHITECTURE.md structure" against the live file
    before editing (it may have shifted).

Task 1: ADD the "## Resolved-Document Invariant (Distributed PRDs)" top-level section
  - PLACE: immediately after "## System Overview" (before "## Four Core Processing Engines").
  - CONTENT (grounded in verified-facts.md §a): A PRD may be authored across multiple files
    (architecture, API, data model, companion docs) and assembled into ONE canonical document at
    load time (PRD §2.3). An `@path/to/file.md` token is an include directive replaced inline by
    the referenced file's contents. Expansion rules — a token expands only when BOTH (1)
    boundary (the `@` is at the start of a line OR preceded by a non-path char, so `foo@bar.com`
    stays literal) AND (2) existence (the path resolves to an existing file). Includes resolve
    PROJECT-ROOT-RELATIVE (to the entry PRD's directory), recursively with cycle detection, up
    to `PRD_INCLUDE_MAX_DEPTH` (default 10). Re-resolution is IDEMPOTENT (identical bytes →
    hash/snapshot consistency). Optional `PRD_INCLUDE_MARKERS` emits `<!-- @include: path -->` /
    `<!-- @end-include -->` markers; a stale include warns on stderr.
  - KEY POINT (the invariant): everything downstream operates over the FULLY-RESOLVED,
    include-expanded document, never the raw entry file — list: hashing (§4.1 step 2), delta
    detection (§4.3), `prd_snapshot.md` writes, delta-PRD inputs, integration/validation/bug-
    finder prompts, and `prd_selectors`/mdsel section indexing (§4.2, run over a materialized
    resolved copy). Agent prompts state the text they receive is the complete merged document
    (agents must not chase includes themselves). Cite PRD §2.3.
  - LINK: "See [Configuration](./CONFIGURATION.md) for the include-expansion env knobs." (verify
    the CONFIGURATION.md anchor exists; if unsure, link to the file root.)

Task 2: TRIM the "##### Resolved-document invariant" subsection (§1 Session Manager)
  - REPLACE the current multi-sentence paragraph (the one ending "(Full multi-file-PRD
    capability framing: P6.)") with a ONE-paragraph cross-reference, e.g.:
    "The session hash and `prd_snapshot.md` are computed over the fully-resolved, include-
    expanded PRD — see [Resolved-Document Invariant (Distributed PRDs)](#resolved-document-
    invariant-distributed-prds) for the full capability framing (PRD §2.3)."
  - REASON: document the invariant ONCE, at the capability level (Task 1); avoid duplication.

Task 3: REFRESH the "#### Agent Types" table (§3 Agent Runtime)
  - REPLACE the current 4-row table (Persona/Responsibility/Token Limit) with a 5-row table
    adding Role / Tier / Reasoning-budget columns, per the persona→role mapping table above.
    Use tier NAMES high/balanced/fast (NEVER opus/sonnet/haiku). Add the Cleanup row (currently
    absent). Token limits stay (architect 8192; others 4096).

Task 4: ADD the "## Model Roles & Reasoning Budget" top-level section
  - PLACE: after "## Multi-Agent Architecture" (before "## State Management and Persistence").
  - CONTENT (grounded in verified-facts.md §b): The pipeline uses THREE separate model roles so
    cost, speed, and reasoning depth are tuned per phase (PRD §9.2.3 / §6.1). Role→{tier,
    thinking} is driven by `ROLE_CONFIG` (agent-factory.ts), the single source of truth:
      • Research role — architecture research & PRP creation. Balanced tier, NORMAL reasoning
        budget. Persona: Researcher. Canonical env var `PRP_MODEL_BALANCED` (default glm-5.2).
      • Reasoning role — task decomposition, creative bug-finding, validation. Balanced tier at
        the MAXIMUM reasoning budget (`thinking: 'xhigh'`), because synthesizing research into a
        strict Phase→Milestone→Task→Subtask hierarchy, adversarial bug-finding, and validating
        against the full PRD are the most reasoning-intensive steps. Personas: Architect (break-
        down) and QA (bug-finder/validation; `BUG_FINDER_AGENT`/`VALIDATION_AGENT`, default
        `pizr`). Canonical env var `PRP_MODEL_BALANCED` @ `xhigh`.
      • Implementation role — code-writing (PRP execution, post-validation fix, cleanup).
        Fast tier, normal budget. Personas: Coder, Cleanup. Canonical env var `PRP_MODEL_FAST`
        (default glm-5-turbo).
    NOTE the `thinking` field rides on the agent config for downstream harness wiring
    (Groundswell's AgentConfig does not natively model thinking); only the Reasoning role sets
    `xhigh`. MODELS ARE PROVIDER-QUALIFIED (`zai/glm-5.2`), NEVER harness-qualified
    (`pi/zai/glm-5.2` is invalid). Read at runtime, not hardcoded. Canonical↔legacy: tier rename
    opus→high / sonnet→balanced / haiku→fast; `PRP_MODEL_*` are primary, the `ANTHROPIC_DEFAULT_*`
    names are deprecated aliases (one-time warning, slated for future removal, PRD §9.2.8).
    (bash-pipeline equivalence, for cross-ref: research=`pi`, reasoning=`pizr`=`pi --thinking
    xhigh`, implementation=`piznt`.)
  - LINK: "See [Configuration](./CONFIGURATION.md) for the full environment-variable table and
    [Model Roles] cross-references in CONFIGURATION.md." (verify anchor or link to file root.)

Task 5: ADD the "### Two-Phase Commit (Per-Item Survival)" subsection
  - PLACE: under "## State Management and Persistence", immediately AFTER the existing
    "### tasks.json Protection & Smart Recovery" subsection (or immediately before — keep them
    adjacent).
  - CONTENT (grounded in verified-facts.md §c): Each subtask commits in TWO phases via the Smart
    Commit tool (`stagecoach`, which LLM-generates the commit message with bounded retry +
    exponential backoff and a last-resort placeholder fallback) (PRD §4.2 step 4):
      1. Pre-cleanup SURVIVAL commit — BEFORE the long, interruptible cleanup agent runs, the
         orchestrator commits the item's substance: source changes + its `plan/` work directory
         + its `Complete` status. Committing before cleanup GUARANTEES a force-interrupt here can
         no longer leave an item "Complete on disk but uncommitted" — the state that orphans
         `plan/` directories forever (the cleanup agent is forbidden from touching `plan/`).
      2. Post-cleanup commit — AFTER cleanup reorganizes docs (temp artifacts removed, docs moved
         to `docs/`), a SECOND `stagecoach` commit records the doc reorganization. Runs only when
         cleanup succeeded.
    Cite PRD §4.2 step 4.

Task 6: ADD the "### State Integrity Protections" subsection
  - PLACE: immediately after the Two-Phase Commit subsection (Task 5), adjacent to the tasks.json
    recovery subsection.
  - CONTENT (grounded in verified-facts.md §c) — a bulleted list of the guards, each citing its
    PRD section:
      • flock-guarded tasks.json RMW (§5.1) — every read-modify-write of `tasks.json` is
        serialized under a process-level mutex (`withLockedTasksJSON`: in-process async mutex +
        re-entrancy + an O_EXCL `<sessionDir>/tasks.json.lock` lockfile), preventing lost updates
        between the foreground executor, the background research supervisor, and recovery.
      • restore_critical_files (§5.1) — the MECHANICAL backstop to the prompt layer: after
        staging, before commit, `smartCommit` detects any staged DELETION whose basename is
        `PRD.md` or `PRP.md` (root + every nested `PRP.md`) and restores it from HEAD (or
        unstages it); non-fatal/best-effort.
      • tasks.json smart recovery (§5.1) — after every agent run the legitimate status delta is
        re-applied and, on parse/validation failure, the last valid version is restored from git
        history; `Researching`/`Retrying` statuses survive a restore. (See [tasks.json Protection
        & Smart Recovery](#tasksjson-protection--smart-recovery) above.)
      • Orphaned-plan/ recovery / skip-recovery (§5.1) — before skipping an item, the
        orchestrator checks HEAD's `tasks.json` for the item's Completed status; if the working
        tree shows Complete but HEAD disagrees (stranded `plan/`), it runs a recovery
        `smartCommit` to persist the stranded state before skipping.
      • Watchdog kills are terminal (§9.3.2) — a watchdog kill (`result.timedOut === true` OR
        `result.exitCode === 124`) is a HARD, never-retried failure: a hung process simply
        re-hangs, so a watchdog-killed validation aborts the run BEFORE bug-hunt and is not
        retried.
      • NO_ISSUES_FOUND.md marker (§4.4) — a clean bug hunt writes `NO_ISSUES_FOUND.md` (and
        commits); a buggy hunt removes a stale marker — distinguishing "already hunted (clean)"
        from "never hunted".
    Cite PRD §5.1 / §4.4 / §9.3.2.

Task 7: ADD the "## Adopt Mode (--adopt-prd)" top-level section
  - PLACE: after "## Task Hierarchy and Execution Flow", before "## See Also".
  - CONTENT (grounded in verified-facts.md §d): To integrate the pipeline into an ALREADY-
    IMPLEMENTED project after writing the PRD — without wasting a full breakdown + implementation
    pass on code that already exists — `--adopt-prd` declares the PRD the source of truth for a
    shipped codebase (PRD §4.6). On a FRESH PROJECT (no `plan/` sessions) it:
      1. Creates a baseline session and stamps it with a `.adopted` marker.
      2. Seeds a single completed `tasks.json` (one Phase → Milestone → Task → "Adopt existing
         codebase" Subtask, all `Complete`) WITH NO BREAKDOWN AND NO AGENT TOKENS, so
         `is_session_complete` is true and this session becomes the idempotent baseline that
         future deltas diff against.
      3. Sets `SKIP_EXECUTION_LOOP=true`: implementation is skipped, but VALIDATION + BUG HUNT
         STILL RUN against the real codebase + PRD.
    The next `PRD.md` edit produces a normal delta session against the adopted baseline.
    GUARD RAILS (PRD §4.6): requires the PRD to exist (exits loudly if missing — never scribbles
    session files near the filesystem root); fresh-project ONLY (a no-op that warns + proceeds
    with normal session resolution if sessions already exist); rejects an empty `SESSION_DIR`;
    `mkdir -p`s the plan dir first.
  - LINK: "See [CLI Reference](./CLI_REFERENCE.md) for the `--adopt-prd` flag." (anchor exists.)

Task 8: UPDATE the "## Table of Contents"
  - ADD entries for the three new top-level sections in document order:
      - "- [Resolved-Document Invariant (Distributed PRDs)](#resolved-document-invariant-distributed-prds)"
        (after the System Overview entries)
      - "- [Model Roles & Reasoning Budget](#model-roles--reasoning-budget)"
        (after Multi-Agent Architecture)
      - "- [Adopt Mode (--adopt-prd)](#adopt-mode---adopt-prd)"
        (after Task Hierarchy and Execution Flow)
  - NOTE the two new State-Management subsections are covered by the existing
    "State Management and Persistence" entry (no separate TOC line needed unless you add sub-
    bullets). Verify each TOC anchor matches the heading slug EXACTLY (markdown slug rules).

Task 9: STALE SWEEP + VERIFY (validation gates)
  - GREP-VERIFY no stale terms (requirement (e)):
      grep -niE "single-slot|single slot|simplified bug-fix|Opus|Sonnet|Haiku|ANTHROPIC_DEFAULT" docs/ARCHITECTURE.md
      # Expected: EMPTY (none of these should appear anywhere in the doc).
  - GREP-VERIFY the four behaviors are present:
      grep -niE "Resolved-Document Invariant|include directive|PRD_INCLUDE_MAX_DEPTH" docs/ARCHITECTURE.md  # present
      grep -niE "Model Roles|Reasoning Budget|ROLE_CONFIG|xhigh" docs/ARCHITECTURE.md                        # present
      grep -niE "Two-Phase Commit|restore_critical_files|withLockedTasksJSON|orphaned|NO_ISSUES_FOUND" docs/ARCHITECTURE.md  # present
      grep -niE "Adopt Mode|adopt-prd|\.adopted|SKIP_EXECUTION_LOOP" docs/ARCHITECTURE.md                    # present
  - RUN: `npx prettier --check docs/ARCHITECTURE.md` → PASS (run `npm run format` to auto-fix).
  - RUN: `npm run docs:lint` → GREEN (clean baseline; NO new markdownlint violations). Confirm
    every new fenced block has a language tag and no duplicate sibling headings.
  - RUN: `npm run validate` → GREEN (format:check is the step covering this doc).
  - SCOPE guard: `git diff --name-only` → EXACTLY `docs/ARCHITECTURE.md`
      (+ this PRP's plan/ artifacts, which are gitignored under plan/).
      git diff --name-only | grep -vE "^docs/ARCHITECTURE\.md$" | grep -vE "^plan/008_15504f60a0ef/P6M1T1S2/"  # EMPTY
```

### Implementation Patterns & Key Details

```markdown
<!-- PATTERN: top-level capability section opening (concise lead + the invariant) -->
## Resolved-Document Invariant (Distributed PRDs)

A PRD of any real size may be authored across multiple files (architecture, API, data model,
companion docs) and assembled into ONE canonical document at load time (PRD §2.3). An
`@path/to/file.md` token is an *include directive* — replaced inline by the referenced file's
contents. … Everything downstream — hashing, `prd_snapshot.md`, delta detection, delta-PRD
inputs, integration/validation/bug-finder prompts, and `prd_selectors`/mdsel indexing —
operates over the **fully-resolved, include-expanded document**, never the raw entry file.

<!-- PATTERN: refreshed Agent Types table (tiers high/balanced/fast; never opus/sonnet/haiku) -->
| Persona   | Role          | Tier (model)            | Reasoning budget | Responsibility |
|-----------|---------------|-------------------------|------------------|----------------|
| Architect | Reasoning     | balanced (`glm-5.2`)    | `xhigh` (max)    | Decompose PRD into tasks |
| Researcher| Research      | balanced (`glm-5.2`)    | normal           | Generate PRPs |
| Coder     | Implementation| fast (`glm-5-turbo`)    | normal           | Execute PRPs → code |
| QA        | Reasoning     | balanced (`glm-5.2`)    | `xhigh` (max)    | Validate + bug-hunt (`pizr`) |
| Cleanup   | Implementation| fast (`glm-5-turbo`)    | normal           | Post-validation doc reorg |

<!-- PATTERN: integrity-protection bullet (one PRD cite each, cross-link the existing subsection) -->
- **flock-guarded `tasks.json` RMW (PRD §5.1)** — every read-modify-write is serialized under a
  process-level mutex (`withLockedTasksJSON`), preventing lost updates.
- **`restore_critical_files` (PRD §5.1)** — mechanical backstop: staged deletions of `PRD.md` /
  `PRP.md` are restored/unstaged before commit.
- **tasks.json smart recovery (PRD §5.1)** — see
  [tasks.json Protection & Smart Recovery](#tasksjson-protection--smart-recovery).

<!-- ANTI-PATTERN (forbidden): using opus/sonnet/haiku as current tier names. -->
<!-- ANTI-PATTERN (forbidden): harness-qualified model strings (`pi/zai/glm-5.2` is INVALID). -->
<!-- ANTI-PATTERN (forbidden): renaming the "tasks.json Protection & Smart Recovery" heading
     (breaks the S1 README anchor #tasksjson-protection--smart-recovery). -->
<!-- ANTI-PATTERN (forbidden): duplicating the resolved-document explanation in BOTH the new
     top-level section AND the Session-Manager subsection (TRIM the latter). -->
<!-- ANTI-PATTERN (forbidden): adding fenced blocks without a language tag (markdownlint MD040). -->
<!-- ANTI-PATTERN (forbidden): touching any file other than docs/ARCHITECTURE.md
     (S1 owns README.md, S3 owns docs/CONFIGURATION.md). -->
```

### Integration Points

```yaml
FILES:
  - modify: "docs/ARCHITECTURE.md — the ONLY deliverable"
  - read-only references: docs/CLI_REFERENCE.md, docs/CONFIGURATION.md, src/agents/agent-factory.ts,
    src/config/constants.ts, src/core/task-orchestrator.ts, src/core/file-lock.ts,
    src/utils/git-commit.ts, src/core/session-manager.ts, src/workflows/prp-pipeline.ts,
    src/core/session-utils.ts, src/agents/prp-executor.ts, src/workflows/validation-workflow.ts,
    src/workflows/bug-hunt-workflow.ts, PRD.md

NO DATABASE / NO ROUTES / NO SOURCE CODE / NO TESTS / NO CONFIG FILES / NO OTHER DOCS.
ARCHITECTURE.md links OUT to docs/CONFIGURATION.md (env knobs) and docs/CLI_REFERENCE.md
(flag detail) rather than duplicating them. Preserve the existing
#tasksjson-protection--smart-recovery anchor (S1 README links to it). Verify any new docs/X.md
anchor you add resolves in the target file before linking.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npx prettier --check docs/ARCHITECTURE.md   # HARD gate (format:check covers **/*.md)
# If it fails, run `npm run format` (or `npx prettier --write docs/ARCHITECTURE.md`) and re-check.

npm run docs:lint                            # = markdownlint "docs/**/*.md"; ARCHITECTURE.md IS
                                             # linted (.markdownlintignore excludes only docs/api/).
                                             # Currently PASSES CLEAN. Expected: still GREEN, NO new
                                             # violations. Any new MD040 → add a language tag to the
                                             # new fence. Any new MD024 → rename the duplicate sibling.

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
# Accuracy cross-check (the real validation for a docs task). Re-run and confirm PASS:

# (a) Resolved-document invariant present:
grep -niE "Resolved-Document Invariant|include directive|PRD_INCLUDE_MAX_DEPTH|fully-resolved" docs/ARCHITECTURE.md
# (b) Model roles + reasoning budget present, NO old tier names:
grep -niE "Model Roles|Reasoning Budget|ROLE_CONFIG|xhigh|Research role|Reasoning role|Implementation role" docs/ARCHITECTURE.md
grep -niE "Opus|Sonnet|Haiku" docs/ARCHITECTURE.md            # EMPTY (none anywhere)
# (c) Two-phase commit + integrity protections present:
grep -niE "Two-Phase Commit|restore_critical_files|withLockedTasksJSON|orphaned|NO_ISSUES_FOUND|watchdog|exit 124|timedOut" docs/ARCHITECTURE.md
# (d) Adopt mode present:
grep -niE "Adopt Mode|adopt-prd|\.adopted|SKIP_EXECUTION_LOOP" docs/ARCHITECTURE.md
# (e) Stale sweep — NONE of these:
grep -niE "single-slot|single slot|simplified bug-fix|ANTHROPIC_DEFAULT" docs/ARCHITECTURE.md   # EMPTY

# Anchor integrity (S1 README links to these; new anchors must resolve):
grep -n "tasksjson-protection--smart-recovery" docs/ARCHITECTURE.md   # heading preserved verbatim
grep -nE "docs/CONFIGURATION.md|docs/CLI_REFERENCE.md" docs/ARCHITECTURE.md   # confirm links/anchors

# Scope guard:
git diff --name-only
# Expected: EXACTLY docs/ARCHITECTURE.md (+ this PRP's plan/ artifacts, gitignored under plan/).
git diff --name-only | grep -vE "^docs/ARCHITECTURE\.md$" | grep -vE "^plan/008_15504f60a0ef/P6M1T1S2/"  # EMPTY
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Read-through review (no live system needed):
#   1. A contributor reads System Overview → Resolved-Document Invariant and understands split
#      PRDs behave identically to monolithic ones downstream. ✓
#   2. The Agent Types table + Model Roles section show the three roles, tiers (balanced/fast),
#      and the xhigh reasoning budget for decomposition/validation — with no opus/sonnet/haiku. ✓
#   3. State Management shows the two-phase commit lifecycle AND the integrity guards (flock,
#      restore_critical_files, orphaned-plan recovery, terminal watchdog kills, NO_ISSUES_FOUND),
#      cross-referencing the existing tasks.json-recovery subsection. ✓
#   4. Adopt Mode explains baseline seeding + SKIP_EXECUTION_LOOP (validation/bug-hunt still run)
#      + the guard rails. ✓
#   5. The TOC lists all new sections; every anchor resolves. ✓

# Optional link check (docs:links not a CI gate here; spot-check docs/ anchors manually):
#   For each docs/CONFIGURATION.md#anchor / docs/CLI_REFERENCE.md#anchor link, open the target
#   and confirm the heading exists (else link to the file root).
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npx prettier --check docs/ARCHITECTURE.md` PASSES.
- [ ] `npm run docs:lint` GREEN with NO new markdownlint violations (clean baseline preserved).
- [ ] `npm run validate` GREEN (format:check step covers this doc).
- [ ] `git diff --name-only` = exactly `docs/ARCHITECTURE.md` (plus this PRP's own `plan/` artifacts).

### Feature Validation
- [ ] `## Resolved-Document Invariant (Distributed PRDs)` top-level section present; PRD §2.3 cited; includes directives, expansion rules, `PRD_INCLUDE_MAX_DEPTH` (default 10), `PRD_INCLUDE_MARKERS`, stale-include warning, single-canonical-document downstream list.
- [ ] Session-Manager resolved-document subsection trimmed to a one-line cross-reference.
- [ ] `#### Agent Types` table refreshed with Role / Tier / Reasoning-budget columns (5 rows incl. Cleanup); tiers high/balanced/fast.
- [ ] `## Model Roles & Reasoning Budget` top-level section present; `ROLE_CONFIG` (reasoning = balanced @ `xhigh`), canonical↔legacy env vars + deprecation warning, provider-qualified-not-harness-qualified. PRD §9.2.3/§6.1 cited.
- [ ] `### Two-Phase Commit (Per-Item Survival)` subsection present (pre-cleanup survival commit + post-cleanup doc-reorg commit via stagecoach). PRD §4.2 step 4 cited.
- [ ] `### State Integrity Protections` subsection present (flock/`withLockedTasksJSON`, `restore_critical_files`, orphaned-plan recovery, terminal watchdog kills, `NO_ISSUES_FOUND.md`). PRD §5.1/§4.4/§9.3.2 cited.
- [ ] `## Adopt Mode (--adopt-prd)` top-level section present (`.adopted` + completed baseline tasks.json, no breakdown/tokens, `SKIP_EXECUTION_LOOP`, validation+bug-hunt still run, guard rails). PRD §4.6 cited.
- [ ] Table of Contents lists the new top-level sections; all anchors resolve.

### Code Quality Validation
- [ ] Every claim grounded in `research/verified-facts.md` (file:line-cited) — no invented detail.
- [ ] Every new fenced code block has a language tag (MD040-safe); no duplicate sibling headings (MD024-safe).
- [ ] `#tasksjson-protection--smart-recovery` anchor preserved (S1 README cross-link integrity).
- [ ] Links out to CONFIGURATION.md / CLI_REFERENCE.md (no verbatim duplication of their tables).
- [ ] No opus/sonnet/haiku, no `ANTHROPIC_DEFAULT_*` as current names, no harness-qualified model strings.

### Documentation & Deployment
- [ ] PRD section citations present wherever a behavior is described (§2.3/§4.2/§4.4/§4.6/§5.1/§9.2.3/§9.3.2).
- [ ] Consistent wording with `docs/CLI_REFERENCE.md` (Adopt Mode) and tier naming with `docs/CONFIGURATION.md`.

---

## Anti-Patterns to Avoid

- ❌ Don't use opus/sonnet/haiku as current tier names — the rename is opus→high, sonnet→balanced, haiku→fast; `PRP_MODEL_*` are primary, `ANTHROPIC_DEFAULT_*` are deprecated aliases only.
- ❌ Don't write harness-qualified model strings (`pi/zai/glm-5.2` is INVALID); models are provider-qualified only.
- ❌ Don't claim Groundswell's `AgentConfig` natively consumes `thinking` — it rides on the config object for downstream harness wiring; only the Reasoning role sets `xhigh`.
- ❌ Don't rename the `tasks.json Protection & Smart Recovery` heading — S1's README links to `#tasksjson-protection--smart-recovery`.
- ❌ Don't duplicate the resolved-document invariant in both the new top-level section AND the Session-Manager subsection — TRIM the latter to a cross-reference.
- ❌ Don't re-explain `tasks.json` smart recovery in the new "State Integrity Protections" subsection — cross-reference the existing accurate subsection.
- ❌ Don't add fenced code blocks without a language tag (markdownlint MD040 is a hard gate here, unlike for README).
- ❌ Don't create duplicate sibling headings (markdownlint MD024 siblings_only).
- ❌ Don't touch any file other than `docs/ARCHITECTURE.md` (S1 owns README.md, S3 owns docs/CONFIGURATION.md; source/tests/config are out of scope).
- ❌ Don't add unverified `docs/X.md#anchor` links — confirm the heading slug exists first, else link to the file root.
- ❌ Don't introduce `single-slot`, `simplified bug-fix`, or `ANTHROPIC_DEFAULT_*` anywhere (requirement (e) stale sweep).

---

## Success Metrics

**Confidence Score: 9/10** — this is a low-risk, single-file documentation sweep with an
unambiguous, fully-grounded spec: (a) every architectural behavior is cited to file:line in
`research/verified-facts.md` (ROLE_CONFIG, persona→role factories, two-phase commit sites,
`withLockedTasksJSON`, `restore_critical_files`, skip-recovery HEAD check, terminal watchdog
handling, `NO_ISSUES_FOUND.md`, `seedAdoptedBaseline`/guard rails); (b) none of the stale terms
exist today (confirmed by grep), so requirement (e) is a guard-rail, not a hunt; (c) the persona
→role→tier→budget mapping table is fixed by `agent-factory.ts` + `constants.ts`; (d)
`docs/CLI_REFERENCE.md` is ALREADY updated and serves as the wording reference for the Adopt
Mode section; (e) the PRD sections defining each behavior are provided verbatim upstream. The
two automated gates (`npx prettier --check docs/ARCHITECTURE.md`, `npm run docs:lint`) are
trivially satisfiable (the doc currently passes both clean), and the real validation is a
grep-based accuracy contract with exact expected strings. Residual risks (caught by Level 1/3):
a new fenced block missing a language tag (markdownlint MD040, caught by `npm run docs:lint`),
a duplicate sibling heading (MD024, same gate), or a broken `docs/` anchor (Level 3
anchor-check). One-pass success is highly likely.