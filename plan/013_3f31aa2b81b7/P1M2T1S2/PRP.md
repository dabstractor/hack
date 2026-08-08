# PRP — P1.M2.T1.S2: `docs/ARCHITECTURE.md` — per-role reasoning as an axis orthogonal to model tier + QA split

> Plan 013, PRD §9.2.9 (Per-Role Reasoning Level) → **Mode B changeset doc sync.** The feature
> (P1.M1 T1–T4, Complete) decoupled the reasoning budget from model selection, split the shared QA
> persona so bug-finder/validation resolve independent levels, and moved the §9.2.9 roles from a
> hard `xhigh` pin to configurable `high`/`off` defaults. This task extends `docs/ARCHITECTURE.md`'s
> agent/model sections to describe the **two-axes model** (tier from `ROLE_CONFIG` — unchanged;
> reasoning level per agent-identity from `PRP_REASONING_*`), the **QA split**, the research-leaning
> assignment, and the **Groundswell harness seam** (cross-repo dependency). Doc-only; no `src/`,
> no `PRD.md`.

---

## Goal

**Feature Goal**: Make `docs/ARCHITECTURE.md` accurately describe the per-role reasoning axis as
**orthogonal to the model tier**, matching the §9.2.9 design shipped in P1.M1 — so a reader of the
architecture doc understands (a) the role→tier model mapping is unchanged, (b) the reasoning level
is resolved per agent-identity from `PRP_REASONING_*` (defaults `high`/`high`/`high`/`high`/`off`),
(c) the formerly-shared QA persona is split (bug-finder vs validation resolve distinct levels;
delta-analysis + change-classifier are research-leaning), and (d) the level is stored on
`AgentConfig.thinking` as a pipeline-internal marker whose harness-side `--thinking` wiring is a
noted cross-repo dependency. Corrects the stale `xhigh`/`normal`/`max`-vocabulary content.

**Deliverable** — EDIT `docs/ARCHITECTURE.md` (extend existing sections; do NOT rewrite the file):
1. **`#### Agent Types`** (under `### 3. Agent Runtime`, ~line 319-329) — update the intro + the
   "Reasoning budget" table column from the old coupled/single-map design to the two-axes model +
   the new per-identity defaults.
2. **`## Model Roles & Reasoning Budget`** (~line 681-709, the PRIMARY section) — rewrite the intro
   + role table + bullets to the two-axes model; **correct the `### How thinking is wired`
   vocabulary** (`'off'|'low'|'medium'|'high'|'xhigh'|'max'` → `'off'|'minimal'|'low'|'medium'|
   'high'|'xhigh'`); add the QA-split + research-leaning + auxiliary-hardcoded-off + harness-seam
   notes. Keep the existing CONFIGURATION.md cross-link (line 709).

**Success Definition**:
- ARCHITECTURE.md states the two-axes model: tier (model) from `ROLE_CONFIG` (unchanged); reasoning
  level per agent-identity from `PRP_REASONING_*` (defaults `high`/`high`/`high`/`high`/`off`);
  tuning one axis never perturbs the other.
- The QA split is documented: `createQAAgent(reasoningLevel)` is shared by 4 callers; bug-finder +
  validation resolve distinct levels; delta-analysis + change-classifier are research-leaning
  (`PRP_REASONING_AGENT`).
- The Groundswell harness seam is stated honestly: the level is resolved→validated→stored on
  `AgentConfig.thinking` (a pipeline-internal marker); harness-side `--thinking` wiring is a
  cross-repo dependency (out of scope for §9.2.9).
- The stale content is GONE: no "selects both the model tier AND the reasoning budget via
  ROLE_CONFIG", no `xhigh (max)` / `normal` reasoning-budget cells, no `'…| max'` vocabulary.
- `npm run format:check` + `npm run docs:lint` + `npm run docs:check` clean; the CONFIGURATION.md
  cross-link resolves; `git diff --name-only` shows ONLY `docs/ARCHITECTURE.md`.

---

## Why

- **Mode B changeset doc sync.** The §9.2.9 feature shipped without `ARCHITECTURE.md` updated: its
  agent/model sections still describe the OLD hard-wired design (the role selects BOTH tier AND
  budget from one `ROLE_CONFIG` map; the Reasoning role is pinned to `xhigh`; Research/Implementation
  are "normal"/model-default; the `ThinkingLevel` vocabulary still lists `max`). This task brings
  the architecture description back in sync with the code.
- **The two-axes model is the headline architectural change** — it belongs in the architecture doc,
  not only the config reference. A reader of ARCHITECTURE.md needs to grasp that model tier and
  reasoning level are independent axes (the §9.2.9 "Problem" — previously the only lever to reduce
  reasoning was to drop model tiers) before drilling into the per-role knobs in CONFIGURATION.md.
- **The QA split is an architectural fact.** The shared `createQAAgent` persona was previously one
  identity pinned to `xhigh`; it is now parameterized so bug-finder and validation resolve
  independent levels, and delta-analysis/change-classifier are explicitly research-leaning. That
  caller/identity structure is architecture-level knowledge that belongs here.
- **Honesty about the harness seam.** `AgentConfig.thinking` is a pipeline-internal marker that
  Groundswell does not yet consume; the `--thinking` wiring is a cross-repo dependency. ARCHITECTURE.md
  must state this so a reader doesn't infer the level is already driving the harness.
- **Standalone & scoped.** Doc-only; edits ONLY `docs/ARCHITECTURE.md`. File-disjoint from the
  parallel S1 (`docs/CONFIGURATION.md`) and the sibling S3 (`README.md`) — different files, no merge
  conflict. ARCHITECTURE.md cross-links to CONFIGURATION.md for the env-var/`.hack` knob tables
  (already does at line 709); it does NOT duplicate them.
- **Out of scope (hard boundary):** `docs/CONFIGURATION.md` (S1 — the config reference owns the env-var
  + `.hack` tables), `README.md` (S3), any `src/` file (the feature is Complete), `PRD.md`,
  `.env.example` (P1.M1.T1.S4 already updated), `tasks.json`, `prd_snapshot.md`.

---

## What

### User-visible behavior
None (documentation). Indirectly: a reader of ARCHITECTURE.md can now understand the per-role
reasoning architecture and follow the cross-link to CONFIGURATION.md for the knobs.

### Technical requirements (exact contract — extend two sections of `docs/ARCHITECTURE.md`)

All factual content is **verified against shipped code** (`src/agents/agent-factory.ts:129,132,308-
311,369,407,446,493,547`; `src/agents/commit-message-agent.ts:341,364-367`; `src/config/constants.ts:
1519,1534,1681-1794`; the 4 `createQAAgent` call sites) and **PRD §9.2.3 / §9.2.9 / §6.1**, cross-
referenced with `architecture/system-context.md §3-§5,§9`.

**EDIT 1 — `#### Agent Types` (~line 319-329).** Rewrite the intro sentence (line 321) + the
"Reasoning budget" table column:
- **Intro** — replace "selects both the model **tier** and the **reasoning budget** via `ROLE_CONFIG`"
  with the two-axes statement: each persona maps to a model **role** that selects the model **tier**
  via `ROLE_CONFIG` (UNCHANGED); the **reasoning level** is a separate axis resolved per
  agent-identity from `PRP_REASONING_*` (PRD §9.2.9). Tuning one axis never perturbs the other.
- **Table "Reasoning budget" column** — replace `xhigh (max)` / `normal` with the per-identity
  defaults: Architect=`high` (`PRP_REASONING_BREAKDOWN_AGENT`), Researcher=`high`
  (`PRP_REASONING_AGENT`), Coder=`off` (`PRP_REASONING_IMPL_AGENT`), QA=`high`
  (split — bug-finder `PRP_REASONING_BUG_FINDER_AGENT` / validation `PRP_REASONING_VALIDATION_AGENT`;
  see [Model Roles & Reasoning Budget](#model-roles--reasoning-budget)), Cleanup=`off` (hardcoded;
  not a §9.2.9 role).

**EDIT 2 — `## Model Roles & Reasoning Budget` (~line 681-709, the PRIMARY section).** This is where
the reasoning axis is described in depth. Extend (keep the section + its CONFIGURATION.md cross-link):
- **Intro** — state the two-axes model: the role→tier model mapping is driven by `ROLE_CONFIG`
  (single source of truth for the **model** — UNCHANGED); the **reasoning level** is resolved
  **per agent-identity** from `PRP_REASONING_<ROLE>` (PRD §9.2.9), independent of the tier.
- **Role table** — keep the three model roles (Research/Reasoning/Implementation → balanced/balanced/
  fast) but replace the "Reasoning budget" column with a pointer: the level is per-agent-identity
  (see the per-identity table below / CONFIGURATION.md). Add a **per-identity reasoning table**:
  research (`PRP_REASONING_AGENT`, default `high`), breakdown (`PRP_REASONING_BREAKDOWN_AGENT`,
  `high`), bug-finder (`PRP_REASONING_BUG_FINDER_AGENT`, `high`), validation
  (`PRP_REASONING_VALIDATION_AGENT`, `high`), implementation (`PRP_REASONING_IMPL_AGENT`, `off`).
- **QA split note** — `createQAAgent(reasoningLevel)` (agent-factory.ts) is shared by 4 callers:
  bug-finder (`bug-hunt-workflow.ts`) + validation (`validation-workflow.ts`) resolve **distinct**
  levels via their own getters; delta-analysis (`delta-analysis-workflow.ts`) + change-classifier
  (`change-classifier.ts`, `classifyChange`/`classifyArtifact`) are **research-leaning** → they
  resolve to the research role's level (`PRP_REASONING_AGENT`), because they perform PRD-diff/artifact
  analysis, not adversarial bug-hunting or contract validation.
- **Auxiliary factories note** — `createCleanupAgent` + `createCommitMessageAgent` are NOT §9.2.9
  roles; they hardcode `thinking: 'off'` (mechanical/single-shot), so tuning the five
  `PRP_REASONING_*` knobs never surprises them.
- **`### How thinking is wired` (line 695-697) — CORRECT THE VOCABULARY.** Replace
  `'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'` with the canonical
  `'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'` (`minimal` added, `max` dropped;
  `ThinkingLevel` is now an alias of `ReasoningLevel`, agent-factory.ts:129). State the harness seam:
  the level is resolved→validated→stored on `AgentConfig.thinking` (a pipeline-internal marker);
  Groundswell's `createAgent` does not consume it, so harness-side wiring (`pi --thinking <level>` /
  claude-code `maxThinkingTokens`) is a **cross-repo dependency**, out of scope for §9.2.9 (noted,
  not implemented). Keep the existing CONFIGURATION.md cross-link (line 709).

**Keep the rest of the section** (`### Model strings are provider-qualified`, `### Canonical ↔
legacy environment variables`, the bash-pipeline equivalence cross-ref, the closing CONFIGURATION.md
link) UNCHANGED.

### Success Criteria
- [ ] `#### Agent Types` intro states the two-axes model (tier from ROLE_CONFIG unchanged; level per-identity from PRP_REASONING_*).
- [ ] The Agent Types table's reasoning column shows the per-identity defaults (`high`/`high`/`off`/`high`/`off`), not `xhigh (max)`/`normal`.
- [ ] `## Model Roles & Reasoning Budget` states the two-axes model + the per-identity reasoning table.
- [ ] The QA split (bug-finder vs validation distinct; delta-analysis + change-classifier research-leaning) is documented.
- [ ] `### How thinking is wired` vocab is `'off'|'minimal'|'low'|'medium'|'high'|'xhigh'` (no `max`).
- [ ] The Groundswell harness seam (AgentConfig.thinking is a pipeline-internal marker; --thinking wiring is a cross-repo dependency) is stated.
- [ ] No stale content remains (`selects both the model tier AND the reasoning budget`, `xhigh (max)`, `'…| max'`).
- [ ] `npm run format:check` + `npm run docs:lint` + `npm run docs:check` clean; CONFIGURATION.md cross-link resolves.
- [ ] `git diff --name-only` shows ONLY `docs/ARCHITECTURE.md`.

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_ **Yes** — the two
exact sections to extend (with line numbers), the verbatim new content's factual basis (verified
against shipped agent-factory/constants code + the 4 QA call sites), the stale strings to remove, the
vocab correction, the harness-seam wording, the scope boundary vs S1 (CONFIGURATION.md owns the
env-var/`.hack` tables; ARCHITECTURE.md cross-links), and the executable doc-validation commands. See
`research/architecture-reasoning-axis.md` for the per-claim evidence.

### Documentation & References
```yaml
# MUST READ — the authoritative requirement (§9.2.9) + the model-role context (§9.2.3) + the persona reasoning note (§6.1)
- docfile: plan/013_3f31aa2b81b7/prd_snapshot.md
  section: "#### 9.2.9 Per-Role Reasoning Level" (h4.8) + "#### 9.2.3 Model Selection" (h4.2) + "### 6.1 Task Breakdown System Prompt" (h3.13)
  why: §9.2.9 is the two-axes decoupling + the per-role env vars/defaults (high/high/high/high/off) +
        the vocab + the behavior change (xhigh→high default; xhigh still available). §9.2.3 is the
        role→tier model mapping (UNCHANGED by §9.2.9). §6.1 notes decomposition defaults to high.
  critical: The role→tier model mapping is UNCHANGED — only the role→level coupling was severed. State both axes.

# MUST READ — the verified architecture findings (decoupling principle + QA-split-by-4-callers + harness seam)
- docfile: plan/013_3f31aa2b81b7/architecture/system-context.md
  section: "3. The core decoupling principle", "4. The shared-QA-persona split (verified — 4 callers)",
           "5. Auxiliary factories NOT in the §9.2.9 vocabulary", "9. The Groundswell harness seam"
  why: §3 = tier from ROLE_CONFIG (unchanged), level per agent-identity from PRP_REASONING_*. §4 = the
        4 createQAAgent callers + their resolved getters (bug-finder/validation distinct; delta-analysis/
        change-classifier research-leaning). §5 = cleanup + commit-message hardcoded 'off'. §9 = AgentConfig.thinking
        is a pipeline-internal marker; --thinking wiring is a cross-repo dependency (out of scope).
  critical: The QA persona is shared by FOUR callers (not 3): bug-finder, validation, delta-analysis, change-classifier (×2).

# MUST READ — this subtask's research (the exact sections to edit + stale strings + scope)
- docfile: plan/013_3f31aa2b81b7/P1M2T1S2/research/architecture-reasoning-axis.md
  section: "1. The two ARCHITECTURE.md sections to EXTEND", "2. two-axes model", "3. QA split",
           "5. harness seam", "6. vocab correction", "7. scope vs sibling Mode B tasks", "8. validation"
  why: Pins the two edit sites (Agent Types ~319-329; Model Roles & Reasoning Budget ~681-709), the stale
        strings to remove, the corrected vocab, and the file-disjointness vs S1 (CONFIGURATION.md) / S3 (README.md).

# THE FILE TO EDIT (the two sections, with line anchors)
- file: docs/ARCHITECTURE.md
  why: EDIT (extend, not rewrite). Section A: `#### Agent Types` under `### 3. Agent Runtime` (intro L321 +
        table L323-329). Section B: `## Model Roles & Reasoning Budget` (L681-709) — intro L683, role table
        L685-689, bullets L691-693, `### How thinking is wired` L695-697 (STALE vocab on L697).
  pattern: "## Model Roles & Reasoning Budget\n\nThe pipeline uses **three separate model roles** … (L681-683)"
  critical: KEEP the section structure, the `### Model strings are provider-qualified` / `### Canonical ↔ legacy
        environment variables` subsections, and the closing CONFIGURATION.md cross-link (L709). EXTEND the intro/
        table/bullets/How-thinking-wired; do NOT rewrite the whole section or remove the cross-link.
  gotcha: The `### How thinking is wired` line (L697) lists the OLD vocab `'off'|'low'|'medium'|'high'|'xhigh'|'max'`
        — it MUST be corrected to `'off'|'minimal'|'low'|'medium'|'high'|'xhigh'` (minimal added, max dropped).

# THE SHIPPED CODE (verified — the facts the doc must state)
- file: src/agents/agent-factory.ts
  why: READ-ONLY — the facts to document. createBaseConfig(persona, role, thinking: ThinkingLevel) L308-311
        (thinking REQUIRED, no default — the load-bearing decoupling); createArchitectAgent L369 /
        createResearcherAgent L407 / createCoderAgent L446 / createCleanupAgent L547 (each passes its
        resolved getter); createQAAgent(reasoningLevel: ReasoningLevel) L493 (the split); ThinkingLevel =
        ReasoningLevel alias L129; ModelRole L132 (research/reasoning/implementation → tier).
- file: src/config/constants.ts
  why: READ-ONLY — ReasoningLevel type L1519, REASONING_LEVELS vocab L1534, the 5 getters L1681-1794
        (getReasoningAgent/Breakdown/BugFinder/Validation/Impl).
- file: src/agents/commit-message-agent.ts
  why: READ-ONLY — createCommitMessageAgent hardcodes thinking:'off' (L341, L364-367) — the auxiliary-
        factory-not-in-§9.2.9-vocab fact.
- file: the 4 createQAAgent call sites (read-only)
  why: bug-hunt-workflow.ts:276 (getReasoningBugFinder); validation-workflow.ts:237 (getReasoningValidation);
        delta-analysis-workflow.ts:124 (getReasoningAgent); change-classifier.ts:117 + :168 (getReasoningAgent).

# SCOPE BOUNDARY — the sibling Mode B task (file-disjoint; do NOT duplicate its content)
- file: plan/013_3f31aa2b81b7/P1M2T1S1/PRP.md
  why: S1 = docs/CONFIGURATION.md (the config reference: 5 PRP_REASONING_* env vars, 5 [reasoning] .hack keys,
        vocab/defaults/empty/fail-fast, behavior change). S2 = docs/ARCHITECTURE.md (architecture description).
        ARCHITECTURE.md states the two-axes model at the architecture level and cross-links to CONFIGURATION.md
        for the knob tables; it does NOT duplicate the env-var/.hack tables.
  critical: Do NOT add the env-var table or .hack key table to ARCHITECTURE.md — that's CONFIGURATION.md's job.
```

### Current Codebase tree (relevant slice)
```bash
docs/
└── ARCHITECTURE.md          # EDIT — #### Agent Types (~319) + ## Model Roles & Reasoning Budget (~681)
# (docs/CONFIGURATION.md = S1's file — UNCHANGED here; README.md = S3's file — UNCHANGED here)
```

### Desired Codebase tree with files to be added/edited
```bash
docs/ARCHITECTURE.md         # MODIFIED (extend 2 sections: Agent Types table + Model Roles & Reasoning Budget)
```

### Known Gotchas of our codebase & Library Quirks
```markdown
<!-- CRITICAL — EXTEND, do not rewrite. ARCHITECTURE.md is ~57KB / 1190 lines with many cross-links. Edit the
     two sections (Agent Types ~319; Model Roles & Reasoning Budget ~681) in place; keep every other section,
     the ToC anchor (#model-roles--reasoning-budget, L19), and the CONFIGURATION.md cross-link (L709) intact. -->

<!-- CRITICAL — the role→tier model mapping is UNCHANGED. §9.2.9 severed ONLY the role→level coupling. The doc
     MUST state both axes: tier (model) from ROLE_CONFIG (research/reasoning→balanced; implementation→fast) AND
     reasoning level per agent-identity from PRP_REASONING_*. Do not imply the tier mapping changed. -->

<!-- CRITICAL — CORRECT THE VOCAB. The `### How thinking is wired` line (~L697) lists the OLD
     'off'|'low'|'medium'|'high'|'xhigh'|'max'. The canonical vocab is 'off'|'minimal'|'low'|'medium'|'high'|'xhigh'
     (minimal added, max dropped; ThinkingLevel is now an alias of ReasoningLevel). Leaving 'max' / omitting
     'minimal' is a stale-content failure. -->

<!-- CRITICAL — the QA persona is shared by FOUR callers (not 3): bug-finder, validation, delta-analysis,
     change-classifier (classifyChange + classifyArtifact). bug-finder + validation resolve DISTINCT levels;
     delta-analysis + change-classifier are research-leaning (→ PRP_REASONING_AGENT). State all four. -->

<!-- CRITICAL — DO NOT duplicate the env-var table or [reasoning] .hack key table. Those live in CONFIGURATION.md
     (S1's file). ARCHITECTURE.md states the architecture + the per-identity defaults and cross-links to
     CONFIGURATION.md for the full knob reference (the cross-link already exists at L709; keep it). -->

<!-- GOTCHA — state the harness seam HONESTLY. AgentConfig.thinking is a pipeline-internal marker; Groundswell's
     createAgent does NOT consume it (HarnessOptions has no thinking field). Harness-side --thinking wiring
     (pi --thinking / claude-code maxThinkingTokens) is a CROSS-REPO dependency, out of scope for §9.2.9. Do NOT
     imply the level already drives the harness. -->

<!-- GOTCHA — markdownlint (docs:lint) enforces style. Avoid trailing spaces; keep heading hierarchy (don't skip
     levels); table pipes aligned. prettier (format:check) also lints .md. Run `npm run fix` (or prettier --write)
     before format:check. If docs:lint flags a long line, wrap it (markdownlint default line-length is often off,
     but check the repo's .markdownlint.json if a rule fires). -->

<!-- GOTCHA — the CONFIGURATION.md cross-link (#model-roles) must keep resolving. docs:links (markdown-link-check)
     is run as `... || true` (non-gating), but a broken in-repo link is still a defect — verify the anchor exists. -->

<!-- CRITICAL — DO NOT edit docs/CONFIGURATION.md (S1, parallel), README.md (S3), any src/ file (feature is Complete),
     PRD.md, .env.example, tasks.json, or prd_snapshot.md. `git diff --name-only` must show ONLY docs/ARCHITECTURE.md. -->
```

---

## Implementation Blueprint

### Data models and structure
None — documentation only. No `src/`, no types, no tests. The "structure" is the two markdown sections
extended in place.

### Implementation Tasks (ordered by dependencies)
```yaml
Task 1: EDIT docs/ARCHITECTURE.md — `#### Agent Types` (~L319-329)
  - INTRO (L321): replace "selects both the model **tier** and the **reasoning budget** via `ROLE_CONFIG`"
    with the two-axes statement (tier from ROLE_CONFIG, UNCHANGED; reasoning level a separate axis per
    agent-identity from PRP_REASONING_*, PRD §9.2.9; tuning one never perturbs the other). Keep the
    [Model Roles & Reasoning Budget](#model-roles--reasoning-budget) link.
  - TABLE "Reasoning budget" column (L323-329): replace `xhigh (max)`/`normal` with the per-identity
    defaults — Architect: `high` (PRP_REASONING_BREAKDOWN_AGENT); Researcher: `high` (PRP_REASONING_AGENT);
    Coder: `off` (PRP_REASONING_IMPL_AGENT); QA: `high` — split, bug-finder PRP_REASONING_BUG_FINDER_AGENT /
    validation PRP_REASONING_VALIDATION_AGENT (see Model Roles & Reasoning Budget); Cleanup: `off` (hardcoded;
    not a §9.2.9 role). Keep the Persona/Role/Tier/Responsibility/Token-Limit columns unchanged.
  - DO NOT touch the surrounding `### 3. Agent Runtime` responsibilities/Tool System subsections.

Task 2: EDIT docs/ARCHITECTURE.md — `## Model Roles & Reasoning Budget` (~L681-709, the PRIMARY section)
  - INTRO (L683): rewrite to the two-axes model — the role→tier model mapping is driven by ROLE_CONFIG
    (single source of truth for the MODEL, UNCHANGED); the reasoning LEVEL is resolved per agent-identity
    from PRP_REASONING_<ROLE> (PRD §9.2.9), independent of the tier.
  - ROLE TABLE (L685-689): keep the three model roles (Research/Reasoning/Implementation → balanced/balanced/
    fast) but replace the "Reasoning budget" column with a pointer to the per-identity table (the level is
    per agent-identity, not per role). ADD a per-identity reasoning table: research (PRP_REASONING_AGENT, high),
    breakdown (PRP_REASONING_BREAKDOWN_AGENT, high), bug-finder (PRP_REASONING_BUG_FINDER_AGENT, high),
    validation (PRP_REASONING_VALIDATION_AGENT, high), implementation (PRP_REASONING_IMPL_AGENT, off).
  - BULLETS (L691-693): update to the two-axes model + new defaults; note §9.2.9's behavior change (the
    reasoning roles moved from a hard xhigh pin to a configurable high default; xhigh remains available).
  - ADD a QA-split note: createQAAgent(reasoningLevel) is shared by 4 callers — bug-finder (bug-hunt-workflow)
    + validation (validation-workflow) resolve DISTINCT levels; delta-analysis (delta-analysis-workflow) +
    change-classifier (change-classifier classifyChange/classifyArtifact) are research-leaning → PRP_REASONING_AGENT.
  - ADD an auxiliary-factories note: createCleanupAgent + createCommitMessageAgent hardcode thinking:'off'
    (not §9.2.9 roles; tuning the 5 PRP_REASONING_* knobs never surprises them).
  - `### How thinking is wired` (L695-697): CORRECT THE VOCAB ('off'|'low'|'medium'|'high'|'xhigh'|'max' →
    'off'|'minimal'|'low'|'medium'|'high'|'xhigh'; ThinkingLevel is now an alias of ReasoningLevel). ADD the
    harness-seam statement: the level is resolved→validated→stored on AgentConfig.thinking (a pipeline-internal
    marker); Groundswell createAgent does not consume it; harness-side --thinking wiring (pi --thinking /
    claude-code maxThinkingTokens) is a cross-repo dependency, out of scope for §9.2.9.
  - KEEP `### Model strings are provider-qualified`, `### Canonical ↔ legacy environment variables`, the
    bash-pipeline equivalence cross-ref, and the closing CONFIGURATION.md cross-link (L709) UNCHANGED.
  - DO NOT rewrite the whole section; do NOT remove the CONFIGURATION.md cross-link; do NOT add the env-var
    or .hack tables (CONFIGURATION.md owns those).

Task 3: FORMAT + VERIFY (doc-only)
  - RUN: npm run fix  (prettier --write on **/*.md; fixes markdown formatting) — or `npx prettier --write docs/ARCHITECTURE.md`.
  - RUN: npm run format:check   # prettier --check — clean.
  - RUN: npm run docs:lint       # markdownlint docs/**/*.md — clean (fix any flagged style with prettier/markdownlint --fix).
  - RUN: npm run docs:check       # tsx scripts/check-docs.ts — clean.
  - GREP (stale content GONE):
      grep -nE "selects both the model \*\*tier\*\* and the \*\*reasoning budget\*\*" docs/ARCHITECTURE.md   # expect: 0 hits
      grep -nE "xhigh \(max\)|'off' \| 'low' \| 'medium' \| 'high' \| 'xhigh' \| 'max'" docs/ARCHITECTURE.md  # expect: 0 hits
  - GREP (new content PRESENT):
      grep -niE "orthogonal|two.axes|PRP_REASONING_" docs/ARCHITECTURE.md        # expect: ≥3 hits
      grep -niE "createQAAgent\(reasoningLevel\)|research-leaning|cross-repo" docs/ARCHITECTURE.md  # expect: ≥2 hits
  - RUN: npm run docs:links       # markdown-link-check (non-gating `|| true`, but verify the CONFIGURATION.md cross-link resolves).
  - RUN: git diff --name-only     # expect: ONLY docs/ARCHITECTURE.md.
  - EXPECTED: format/docs:lint/docs:check clean; stale strings gone; new content present; only ARCHITECTURE.md changed.
```

### Implementation Patterns & Key Details
```markdown
<!-- ---- EDIT 1: #### Agent Types intro (replace the coupled single-map sentence) ---- -->
Each persona maps to a model **role** (research / reasoning / implementation) that selects the model
**tier** via `ROLE_CONFIG` (the single source of truth in [`src/agents/agent-factory.ts`](../src/agents/agent-factory.ts)).
The **reasoning level** is a separate axis — resolved per agent-identity from `PRP_REASONING_*` (PRD §9.2.9),
independent of the tier; tuning one axis never perturbs the other. Tier names are `high` / `balanced` / `fast`.
See [Model Roles & Reasoning Budget](#model-roles--reasoning-budget) for the role→tier and per-identity level contract.

<!-- ---- EDIT 1: Agent Types table — the reasoning column (per-identity defaults) ---- -->
| Persona        | Role           | Tier (model)         | Reasoning level (default)                          | Responsibility                        | Token Limit |
| -------------- | -------------- | -------------------- | -------------------------------------------------- | ------------------------------------- | ----------- |
| **Architect**  | Reasoning      | balanced (`glm-5.2`) | `high` (`PRP_REASONING_BREAKDOWN_AGENT`)           | Decompose PRD into task backlog       | 8192        |
| **Researcher** | Research       | balanced (`glm-5.2`) | `high` (`PRP_REASONING_AGENT`)                     | Generate PRPs for subtasks            | 4096        |
| **Coder**      | Implementation | fast (`glm-5-turbo`) | `off` (`PRP_REASONING_IMPL_AGENT`)                 | Execute PRPs to produce code          | 4096        |
| **QA**         | Reasoning      | balanced (`glm-5.2`) | `high` — split (bug-finder/validation, see below)  | Validate + bug-hunt (default `pizr`)  | 4096        |
| **Cleanup**    | Implementation | fast (`glm-5-turbo`) | `off` (hardcoded; not a §9.2.9 role)               | Post-validation doc reorg (stateless) | 4096        |

<!-- ---- EDIT 2: ## Model Roles & Reasoning Budget — the per-identity reasoning table (ADD) ---- -->
| Agent identity  | Env var                        | Default | Resolved by                |
| --------------- | ------------------------------ | ------- | -------------------------- |
| Research / PRP  | `PRP_REASONING_AGENT`          | `high`  | `getReasoningAgent()`      |
| Breakdown       | `PRP_REASONING_BREAKDOWN_AGENT`| `high`  | `getReasoningBreakdown()`  |
| Bug finder      | `PRP_REASONING_BUG_FINDER_AGENT` | `high` | `getReasoningBugFinder()`  |
| Validation      | `PRP_REASONING_VALIDATION_AGENT`| `high` | `getReasoningValidation()` |
| Implementation  | `PRP_REASONING_IMPL_AGENT`     | `off`   | `getReasoningImpl()`       |

<!-- ---- EDIT 2: the QA-split + research-leaning note (ADD) ---- -->
**QA persona split.** `createQAAgent(reasoningLevel)` is shared by four callers. Bug-finder
(`bug-hunt-workflow.ts`) and validation (`validation-workflow.ts`) resolve **distinct** levels via
their own getters. Delta-analysis (`delta-analysis-workflow.ts`) and change-classification
(`change-classifier.ts` — `classifyChange`/`classifyArtifact`) are **research-leaning** — they perform
PRD-diff/artifact analysis rather than adversarial bug-hunting or contract validation — so they resolve
to the research role's level (`PRP_REASONING_AGENT`).

<!-- ---- EDIT 2: the harness seam (ADD to "How thinking is wired") ---- -->
The resolved level is validated and stored on `AgentConfig.thinking` as a **pipeline-internal marker**.
Groundswell's `createAgent` does not consume it (`HarnessOptions` has no thinking/thinkingLevel field),
so harness-side wiring (`pi --thinking <level>` / claude-code `maxThinkingTokens`) is a **cross-repo
dependency** that is out of scope for §9.2.9 — noted, not implemented here. The valid levels are the
canonical `ReasoningLevel` vocabulary: `'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'`
(`ThinkingLevel` is an alias of `ReasoningLevel`).
```

### Integration Points
```yaml
ARCHITECTURE.MD (docs/ARCHITECTURE.md):
  - #### Agent Types (~L319-329): intro → two-axes; table reasoning column → per-identity defaults.
  - ## Model Roles & Reasoning Budget (~L681-709): intro → two-axes; + per-identity reasoning table;
        + QA-split/research-leaning note; + auxiliary-hardcoded-off note; How thinking is wired vocab
        CORRECTED + harness seam stated.
  - PRESERVE: the ToC anchor (#model-roles--reasoning-budget, L19); ### Model strings are provider-qualified;
        ### Canonical ↔ legacy environment variables; the bash-pipeline equivalence cross-ref; the closing
        CONFIGURATION.md cross-link (L709); every other section.

NO OTHER FILES (hard boundary):
  - docs/CONFIGURATION.md (S1, parallel — owns the env-var + .hack tables; ARCHITECTURE.md cross-links, does NOT duplicate).
  - README.md (S3); any src/ file (feature Complete); PRD.md; .env.example; tasks.json; prd_snapshot.md.

DOCS (Mode B — this subtask IS the changeset-level doc update for ARCHITECTURE.md):
  - No env-var/.hack duplication (CONFIGURATION.md owns those). ARCHITECTURE.md states the architecture +
        the per-identity defaults and cross-links to CONFIGURATION.md.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
npm run fix            # prettier --write **/*.md (run first — markdown reflow)
npm run format:check   # prettier --check **/*.md — clean
npm run docs:lint      # markdownlint docs/**/*.md — clean
# Expected: clean. If markdownlint flags a rule, fix with `npm run docs:lint:fix` or adjust manually.
#   Do NOT disable a lint rule globally to silence a real style issue.
```

### Level 2: Doc Consistency (Component Validation)
```bash
# Stale content MUST be gone:
grep -nE "selects both the model \*\*tier\*\* and the \*\*reasoning budget\*\*" docs/ARCHITECTURE.md   # 0 hits
grep -nE "xhigh \(max\)" docs/ARCHITECTURE.md                                                            # 0 hits
grep -nE "'off' \| 'low' \| 'medium' \| 'high' \| 'xhigh' \| 'max'" docs/ARCHITECTURE.md               # 0 hits (the OLD vocab)
# New content MUST be present:
grep -niE "orthogonal|two.axes|PRP_REASONING_" docs/ARCHITECTURE.md        # ≥3 hits
grep -niE "createQAAgent\(reasoningLevel\)|research-leaning|cross-repo" docs/ARCHITECTURE.md  # ≥2 hits
grep -nE "'off' \| 'minimal' \| 'low' \| 'medium' \| 'high' \| 'xhigh'" docs/ARCHITECTURE.md  # ≥1 hit (the CORRECT vocab)
# Expected: all grep gates pass. If a stale string remains, hunt it down (there are TWO sections — check both).
```

### Level 3: Cross-Link + Doc-Check (System Validation)
```bash
npm run docs:check      # tsx scripts/check-docs.ts — clean (structural doc check)
npm run docs:links      # markdown-link-check (non-gating `|| true`) — verify the CONFIGURATION.md cross-link resolves
# Confirm the ToC anchor still matches the heading:
grep -nE "model-roles--reasoning-budget|## Model Roles & Reasoning Budget" docs/ARCHITECTURE.md  # ToC anchor + heading both present
# Expected: docs:check clean; the #model-roles--reasoning-budget anchor + the ## Model Roles heading both present (no broken in-doc link).
```

### Level 4: Creative & Domain-Specific Validation
```bash
# Doc-only — no MCP/DB/HTTP. Domain checks (record in commit message):
#   1. Two-axes model stated at the architecture level (tier from ROLE_CONFIG unchanged; level per-identity from PRP_REASONING_*).
#   2. Role→tier model mapping UNCHANGED (research/reasoning→balanced; implementation→fast) — §9.2.9 severed only role→level.
#   3. QA split: 4 createQAAgent callers; bug-finder + validation distinct; delta-analysis + change-classifier research-leaning.
#   4. Vocab corrected (minimal added, max dropped; ThinkingLevel = ReasoningLevel alias).
#   5. Harness seam stated honestly (AgentConfig.thinking is a pipeline-internal marker; --thinking wiring is cross-repo, out of scope).
#   6. No env-var/.hack duplication (CONFIGURATION.md owns those; ARCHITECTURE.md cross-links).
#   7. git diff --name-only shows ONLY docs/ARCHITECTURE.md.
git diff --name-only   # expect: docs/ARCHITECTURE.md
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run format:check` clean.
- [ ] `npm run docs:lint` clean.
- [ ] `npm run docs:check` clean.
- [ ] Stale-content grep gates pass (0 hits for the coupled-single-map phrase, `xhigh (max)`, the old `max` vocab).
- [ ] New-content grep gates pass (orthogonal/two-axes/PRP_REASONING_; createQAAgent(reasoningLevel)/research-leaning/cross-repo; the corrected vocab).
- [ ] `git diff --name-only` shows ONLY `docs/ARCHITECTURE.md`.

### Feature Validation
- [ ] `#### Agent Types` intro states the two-axes model; table reasoning column shows per-identity defaults.
- [ ] `## Model Roles & Reasoning Budget` states the two-axes model + the per-identity reasoning table.
- [ ] QA split (bug-finder vs validation distinct; delta-analysis + change-classifier research-leaning) documented.
- [ ] Auxiliary factories (cleanup + commit-message hardcoded `off`) noted.
- [ ] `### How thinking is wired` vocab corrected; harness seam (cross-repo dependency) stated.
- [ ] ToC anchor + CONFIGURATION.md cross-link still resolve.

### Code Quality Validation
- [ ] Sections extended in place (not rewritten); section structure + cross-links preserved.
- [ ] Role→tier model mapping described as UNCHANGED (only role→level was severed).
- [ ] No env-var / `.hack` table duplicated (CONFIGURATION.md owns those).
- [ ] Only `docs/ARCHITECTURE.md` modified; `docs/CONFIGURATION.md` (S1), `README.md` (S3), all `src/`, `PRD.md` untouched.

### Documentation & Deployment
- [ ] This subtask IS the Mode B changeset-level doc update for ARCHITECTURE.md.
- [ ] Commit message notes: the two-axes extension, the QA split (4 callers), the vocab correction (minimal/max), the
      harness-seam honesty, the S1/S3 file-disjointness, and the cross-link to CONFIGURATION.md.

---

## Anti-Patterns to Avoid

- ❌ Don't rewrite the whole `## Model Roles & Reasoning Budget` section or the file. EXTEND the two sections in place;
      keep `### Model strings are provider-qualified`, `### Canonical ↔ legacy environment variables`, the bash-pipeline
      cross-ref, and the CONFIGURATION.md link (L709) intact.
- ❌ Don't imply the role→tier model mapping changed. §9.2.9 severed ONLY the role→level coupling. State BOTH axes: tier
      from ROLE_CONFIG (unchanged) AND level per agent-identity from PRP_REASONING_*.
- ❌ Don't leave the old vocab. The `### How thinking is wired` line (~L697) lists `'off'|'low'|'medium'|'high'|'xhigh'|'max'`
      — it MUST become `'off'|'minimal'|'low'|'medium'|'high'|'xhigh'` (minimal added, max dropped). Leaving `max` or
      omitting `minimal` is a stale-content failure.
- ❌ Don't say "QA is pinned to xhigh" or use `xhigh (max)` / `normal` reasoning-budget cells. The reasoning roles moved to
      a configurable `high` default (xhigh remains available via explicit config); implementation is `off` by default.
- ❌ Don't duplicate the env-var table or the `[reasoning]` `.hack` key table. Those are CONFIGURATION.md's job (S1).
      ARCHITECTURE.md states the per-identity DEFAULTS at the architecture level and cross-links for the full knob reference.
- ❌ Don't omit the QA-split's 4th+5th callers. It's FOUR callers (bug-finder, validation, delta-analysis, change-classifier
      classifyChange + classifyArtifact) — not 3. delta-analysis + change-classifier are research-leaning (→ PRP_REASONING_AGENT).
- ❌ Don't imply the level already drives the harness. `AgentConfig.thinking` is a pipeline-internal marker; Groundswell
      `createAgent` does not consume it; `--thinking` wiring is a CROSS-REPO dependency (out of scope for §9.2.9). State it honestly.
- ❌ Don't edit `docs/CONFIGURATION.md` (S1, parallel), `README.md` (S3), any `src/` file (feature Complete), `PRD.md`,
      `.env.example`, `tasks.json`, or `prd_snapshot.md`. `git diff --name-only` must show ONLY `docs/ARCHITECTURE.md`.
- ❌ Don't break the ToC anchor (`#model-roles--reasoning-budget`) or the CONFIGURATION.md cross-link. Both must still resolve.
- ❌ Don't skip the grep gates — they're the deterministic check that the stale content is gone and the new content is present
      (markdown prose is hard to assert otherwise).

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: This is a focused, doc-only extension of two located sections in `docs/ARCHITECTURE.md` (Agent Types ~L319-329;
Model Roles & Reasoning Budget ~L681-709). Every fact the doc must state is verified against shipped code
(`agent-factory.ts:129/132/308-311/369/407/446/493/547`, `constants.ts:1519/1534/1681-1794`, `commit-message-agent.ts:341/364-367`,
the 4 `createQAAgent` call sites) and the authoritative `architecture/system-context.md §3-§5,§9` (decoupling principle,
the 4-caller QA split, the auxiliary-hardcoded-off decision, the harness seam). The stale strings to remove are pinned
(the coupled-single-map phrase, `xhigh (max)`, the `max` vocab), the corrected vocab is fixed, and the harness-seam wording
is prescribed. Scope is airtight: S2 edits ONLY ARCHITECTURE.md; it is file-disjoint from S1 (CONFIGURATION.md) and S3
(README.md), and does NOT duplicate the env-var/`.hack` tables. The validation is deterministic (format/docs:lint/docs:check
+ grep gates for stale-gone/new-present + git diff --name-only). Residual risks: (a) a markdownlint/prettier style nit
(auto-fixed via `npm run fix`); (b) a stale string surviving in the second section (the grep gates catch it — there are TWO
sections, check both); (c) an accidental edit to CONFIGURATION.md/README.md (the git diff gate catches it). No runtime/
network/LLM unknowns — pure documentation.