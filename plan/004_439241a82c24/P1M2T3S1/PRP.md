# PRP — P1.M2.T3.S1: Update docs/CONFIGURATION.md (harness env var + provider-qualified models)

---

## Goal

**Feature Goal**: Document the already-implemented **pluggable harness** and
**provider-qualified model** configuration in `docs/CONFIGURATION.md` so a reader
can configure the pipeline's agent runtime and models correctly without reading
source code. Concretely, add `PRP_AGENT_HARNESS` (`pi` default | `claude-code`),
the harness↔provider **independence**, the **provider-qualified** `provider/model`
format (e.g. `zai/GLM-4.7`), the runtime **model env-var overrides** and how bare
names are qualified, and a note that **`claude-code` is Anthropic-only and
incompatible with z.ai** (PRD §9.2.2 / §9.2.3 / §9.4.2, cross-referencing §9.2.4).
This is a **documentation-only** edit — no source, test, or schema changes.

**Deliverable**: An updated `docs/CONFIGURATION.md` (same file, ~1.0.0 → 1.1.0)
that: (a) lists `PRP_AGENT_HARNESS` in the Quick Reference and a new
`### Agent Runtime (Harness)` env-var subsection; (b) explains provider-qualified
models + override behavior in both the env-var `### Model Selection` block and the
top-level `## Model Selection` section; (c) adds a `.env` harness block to the
Example Configuration; (d) adds two Common Gotchas (invalid harness-in-model-string,
claude-code+z.ai incompatibility); (e) cross-links to the Harness System section in
`docs/GROUNDSWELL_GUIDE.md` (created by sibling **P1.M2.T3.S2**); and (f) passes
`npm run format:check` (prettier) and introduces **no new** markdownlint rule
violations beyond the established baseline.

**Success Definition** (the contract from the work item):

- `docs/CONFIGURATION.md` now documents all five topics from the contract
  (`PRP_AGENT_HARNESS`, harness/provider independence, `provider/model` format,
  runtime model overrides, claude-code↔z.ai incompatibility) — mirrored from
  PRD §9.2.2 / §9.2.3 / §9.4.2, with a §9.2.4 compatibility cross-reference.
- Content **matches the existing doc style** (status header, TOC, `### ` env-var
  subsections, padded pipe tables, `bash`/`typescript` code fences, `> ` warning
  blockquotes, "See Also" list).
- `npm run format:check` is green (the **authoritative**, installed gate).
- `npm run validate` is green (only `format:check` is relevant for a `.md` change;
  `lint`/`typecheck` are unaffected — no `.ts` touched).
- `npx markdownlint-cli2 docs/CONFIGURATION.md` introduces **no new rule
  violations** beyond the established **baseline** (57×MD013/line-length,
  1×MD051/link-fragments, 1×MD024/no-duplicate-heading — see
  `research/validation-environment-and-baseline.md`). No new duplicate headings,
  no new broken anchors.
- Cross-link to `docs/GROUNDSWELL_GUIDE.md#harness-system` is present (the
  sibling P1.M2.T3.S2 creates that file/anchor).
- **No** source/test/schema/`.env.example` changes.

---

## User Persona (if applicable)

**Target User**: A **developer/operator** configuring the PRP Pipeline locally
(writing a `.env`, selecting models, optionally switching the agent harness).

**Use Case**: Setting up or reconfiguring the pipeline — choosing the agent
runtime and the LLM models, and understanding which combinations are valid.

**User Journey**:

1. Opens `docs/CONFIGURATION.md`.
2. Sees `PRP_AGENT_HARNESS` in **Quick Reference** (default `pi`).
3. Reads **Agent Runtime (Harness)** subsection → learns the harness is
   independent of the provider/model, and that `claude-code` is Anthropic-only.
4. Reads **Model Selection** → learns models resolve to `provider/model`
   (e.g. `zai/GLM-4.7`) and how env-var overrides behave.
5. Follows the **Example Configuration** to populate `.env`.
6. (Optional) Follows the cross-link to the **Groundswell Guide** for the full
   harness capability matrix.

**Pain Points Addressed**:

- "What is `PRP_AGENT_HARNESS` and what do I set it to?" (currently undocumented).
- "Why is my model `zai/GLM-4.7` and not `GLM-4.7`?" (provider-qualification is
  undocumented in the reference doc).
- "Can I use `claude-code` with my z.ai key?" (no — and the doc must say why).

---

## Why

- **PRD §9.2.2 / §9.2.3 / §9.4.2 are the source of truth** for this configuration,
  and the implemented code (P1.M1.T1.S2's `PRP_AGENT_HARNESS` + harness/provider
  guard; P1.M1.T2.S1's `qualifyModel()` + `zai/<model>`) is already shipped.
  `docs/CONFIGURATION.md` is the **canonical reference** for env vars and
  currently has **zero** mentions of `PRP_AGENT_HARNESS` or provider-qualified
  models (confirmed by `grep` and by `architecture/delta_impact.md` §D). This
  closes that doc/code drift.
- **Prevents misconfiguration.** The two highest-impact footguns are
  (1) writing `pi/zai/GLM-4.7` (harness-qualified — invalid per PRD §9.4.3) and
  (2) selecting `claude-code` while still pointing at z.ai (Anthropic-only
  harness vs z.ai provider — incompatible per §9.2.4). Documenting both keeps the
  default `pi` + `zai` configuration working and the z.ai **cost safeguard**
  effective (§9.2.4's endpoint guard is provider-side; `claude-code` would require
  disabling it).
- **Cohesion with the sibling doc.** P1.M2.T3.S2 creates `docs/GROUNDSWELL_GUIDE.md`
  with a full "Harness System" section (capability table, `configureHarnesses()`,
  parity rules). This task keeps CONFIGURATION.md **focused on env-var + override
  configuration** and cross-links out to the Guide for the system overview — no
  duplication, no conflict, no overlap in files owned.

---

## What

### User-visible behavior

None at runtime/CLI. Observable change: `docs/CONFIGURATION.md` gains a new env-var
subsection + model-format notes + example block + two gotchas + one See-Also link,
and its header is versioned `1.0.0 → 1.1.0` with an updated `Last Updated` date.
No new env vars, no new API, no behavior change anywhere.

### Technical requirements (exact contract — the five topics)

Mirror PRD §9.2.2 / §9.2.3 / §9.4.2 (and reference §9.2.4 / §9.4.3). All wording
must be consistent with the **implemented** code:

| Topic (PRD ref)                                                             | Required content in CONFIGURATION.md                                                                                                                                                                                                                                                                                   | Implemented source of truth (read-only)                                                                                                |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `PRP_AGENT_HARNESS` (§9.2.2, §9.4.2)                                        | New env var. Default `pi`. Choices `pi` / `claude-code`. States it is **orthogonal to the LLM provider** (selected independently from the model).                                                                                                                                                                      | `src/config/constants.ts`: `PRP_AGENT_HARNESS='PRP_AGENT_HARNESS'`, `DEFAULT_HARNESS='pi'`, `SUPPORTED_HARNESSES=['pi','claude-code']` |
| Provider-qualified model format (§9.2.3, §9.4.3)                            | Models are `provider/model` (e.g. `zai/GLM-4.7`). The harness **never** appears in the model string (`pi/zai/GLM-4.7` is **invalid**). Bare names (`GLM-4.7`) are auto-qualified to `zai/GLM-4.7` (idempotent).                                                                                                        | `src/config/environment.ts`: `qualifyModel()` (idempotent; default provider `zai`), `getModel('sonnet')` → `'zai/GLM-4.7'`             |
| Runtime model env-var overrides (§9.2.3)                                    | `ANTHROPIC_DEFAULT_SONNET_MODEL` (default `GLM-4.7` → `zai/GLM-4.7`), `ANTHROPIC_DEFAULT_HAIKU_MODEL` (default `GLM-4.5-Air` → `zai/GLM-4.5-Air`); values read from env at runtime, never hardcoded. (OPUS already documented; preserve it, add qualification note.)                                                   | `src/config/environment.ts` `getModel()` reads `MODEL_ENV_VARS[tier]` then `MODEL_NAMES[tier]`                                         |
| `claude-code` Anthropic-only / z.ai incompatibility (§9.2.4, §9.4.1/§9.4.3) | `claude-code` runs `anthropic/*` models **only**; it is **incompatible with the z.ai provider** (the default). Selecting it requires switching to `anthropic/*` models and disabling the z.ai endpoint safeguard. Pipeline validates this at startup and fails fast. Cross-reference §9.2.4 / "API Endpoint Security". | PRD §9.2.4 Harness note; §9.4.1 supported-harnesses table                                                                              |
| Cross-link to Harness System (P1.M2.T3.S2)                                  | In See Also AND in the harness subsection: link to `./GROUNDSWELL_GUIDE.md#harness-system` for the full system (capability table, `configureHarnesses()` config, parity rules). Do NOT duplicate that table here.                                                                                                      | Created by sibling P1.M2.T3.S2                                                                                                         |

### Placement plan (which existing sections change)

| Existing section in `docs/CONFIGURATION.md` | Change                                                                                                                                                               |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Header (`Status`/`Last Updated`/`Version`)  | `Version: 1.0.0 → 1.1.0`; `Last Updated: 2026-01-23 → 2026-06-20`                                                                                                    |
| `## Table of Contents`                      | Add `- [Agent Runtime (Harness)](#agent-runtime-harness)` under the Environment Variables group                                                                      |
| `## Quick Reference` (table)                | Add row: `PRP_AGENT_HARNESS` (Required: No, Default: `pi`)                                                                                                           |
| `### Model Selection` (env-var subsection)  | Add a `>` note after the table: models are provider-qualified at runtime; bare `GLM-4.7` → `zai/GLM-4.7`; never harness-qualified                                    |
| (NEW) `### Agent Runtime (Harness)`         | New env-var subsection (insert after `### Model Selection`, before `### Pipeline Control`): the harness table + independence bullets + claude-code note + cross-link |
| `## Model Selection` → "Model Override"     | Update the `bash` example: bare names get qualified; show fully-qualified `zai/<model>` option                                                                       |
| `## Example Configuration` (`.env` block)   | Add an `# AGENT RUNTIME (HARNESS) — OPTIONAL` block with `# PRP_AGENT_HARNESS=pi` + a comment that `claude-code` needs `anthropic/*` models                          |
| `## Common Gotchas`                         | Add 2 gotchas: (1) "Harness in the model string is invalid" (2) "claude-code + z.ai is incompatible"                                                                 |
| `## See Also`                               | Add `**[Groundswell Guide](./GROUNDSWELL_GUIDE.md)** - Harness system, capabilities, and parity rules`                                                               |

### Success Criteria

- [ ] All five contract topics present and consistent with implemented code.
- [ ] Existing doc style preserved (headers, padded tables, code fences, blockquotes).
- [ ] `npm run format:check` green; `npm run validate` green.
- [ ] No **new** markdownlint rule violations vs the baseline (no new MD024 / MD051;
      MD013 increases from new wide-table rows are acceptable — match existing style).
- [ ] Cross-link to `docs/GROUNDSWELL_GUIDE.md#harness-system` present.
- [ ] No source/test/schema/`.env.example` files modified.

---

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed
to implement this successfully?_ **Yes** — the exact file (`docs/CONFIGURATION.md`,
435 lines, exists), the exact five topics with their PRD section refs, the exact
implemented source values they must mirror (constants/environment), the exact
placement plan (which sections change and what to add), the exact validation
commands (with the critical caveat that `npm run docs:lint`'s `markdownlint`
binary is **not installed** — use `npx markdownlint-cli2` instead, and rely on
`npm run format:check` as the authoritative gate), and the established
markdownlint baseline counts (57/1/1) so "don't introduce new errors" is
unambiguous. The non-obvious facts are proven in the research note:
`research/validation-environment-and-baseline.md`.

### Documentation & References

```yaml
# MUST READ — PRD sections this item documents (the source of truth for wording)
- docfile: PRD.md
  section: "9.2.2 Required Environment Variables" (h4.1)
  why: >
    Defines PRP_AGENT_HARNESS ("Agent Runtime (Harness): PRP_AGENT_HARNESS: Agent
    runtime/SDK to use — pi (pi.dev, default) or claude-code. Orthogonal to the LLM
    provider"). This is THE env-var definition to mirror.
  critical: The harness is explicitly "Orthogonal to the LLM provider" — this exact
            independence phrasing must appear in the doc.
- docfile: PRD.md
  section: "9.2.3 Model Selection" (h4.2)
  why: >
    Provider-qualified strings (provider/model); ANTHROPIC_DEFAULT_SONNET_MODEL
    (default GLM-4.7 → zai/GLM-4.7) and ANTHROPIC_DEFAULT_HAIKU_MODEL (default
    GLM-4.5-Air → zai/GLM-4.5-Air); "read from the environment at runtime, not
    hardcoded"; "Model strings are never harness-qualified (e.g., pi/zai/GLM-4.7
    is invalid)".
  critical: The invalid-example (pi/zai/GLM-4.7) and the "never harness-qualified"
            rule must appear verbatim in the doc's gotcha + model notes.
- docfile: PRD.md
  section: "9.4.2 Configuration" (h4.10)
  why: >
    configureHarnesses({ defaultHarness:'pi', defaultModelProvider:'zai', ... });
    "PRP_AGENT_HARNESS (pi | claude-code, default pi): selects the runtime";
    "Harness selection cascades: global default → agent config → prompt overrides".
  critical: defaultHarness 'pi' and defaultModelProvider 'zai' are the values to state.
- docfile: PRD.md
  section: "9.2.4 API Endpoint Safeguards" (h4.3) — "Harness note" blockquote
  why: >
    "the optional claude-code harness is Anthropic-only and therefore incompatible
    with the z.ai provider — selecting it requires switching to anthropic/* models
    and disabling this safeguard." THE incompatibility wording to cross-reference.
- docfile: PRD.md
  section: "9.4.3 Critical Rules" (h4.11)
  why: >
    "The harness never appears in the model string. pi/zai/GLM-4.7 and cc/anthropic/...
    are invalid. Always use provider/model."; "Provider/harness compatibility.
    claude-code runs anthropic/* models only."
  critical: These two rules underpin the two Common Gotchas to add.

# MUST READ — the implemented code this doc must match (read-only; do NOT edit)
- file: src/config/constants.ts
  why: >
    Source of truth for PRP_AGENT_HARNESS env-var name, DEFAULT_HARNESS='pi',
    DEFAULT_MODEL_PROVIDER='zai', SUPPORTED_HARNESSES=['pi','claude-code'],
    MODEL_NAMES={opus:'GLM-4.7',sonnet:'GLM-4.7',haiku:'GLM-4.5-Air'},
    MODEL_ENV_VARS={opus:'ANTHROPIC_DEFAULT_OPUS_MODEL',sonnet:'..._SONNET_MODEL',
    haiku:'..._HAIKU_MODEL'}. The doc's defaults MUST equal these values.
  pattern: "export const PRP_AGENT_HARNESS = 'PRP_AGENT_HARNESS'; export const DEFAULT_HARNESS = 'pi' as const; export const DEFAULT_MODEL_PROVIDER = 'zai' as const; export const SUPPORTED_HARNESSES = ['pi', 'claude-code'] as const;"
  gotcha: OPUS is documented in the existing doc and exists in MODEL_NAMES — PRESERVE
          it (do not delete the OPUS row). Just add the provider-qualification note.
- file: src/config/environment.ts
  why: >
    qualifyModel() is idempotent (returns name unchanged if it contains '/'); defaults
    to DEFAULT_MODEL_PROVIDER ('zai'); getModel(tier) = qualifyModel(env ?? MODEL_NAMES[tier]).
    This is the EXACT runtime override + qualification behavior to document.
  pattern: "export function qualifyModel(name, provider = DEFAULT_MODEL_PROVIDER) { return name.includes('/') ? name : `${provider}/${name}`; }"
  gotcha: "Bare GLM-4.7 → zai/GLM-4.7" and "already-qualified zai/GLM-4.7 unchanged"
          are BOTH true (idempotent). Document both.

# MUST READ — the file being edited (its full current style + sections)
- file: docs/CONFIGURATION.md
  why: >
    THE edit target (435 lines). Existing sections to follow for style: header
    (Status/Last Updated/Version), Table of Contents, Quick Reference (padded pipe
    table), ### env-var subsections with pipe tables + `> ` notes, ## Model Selection
    (tiers + when-to-use + Model Override bash block), ## Example Configuration
    (sectioned .env with ===== dividers), ## Common Gotchas (### per-gotcha with
    "What you see"/"Why"/"How to fix" code blocks), ## See Also (bulleted links).
  pattern: "### Model Selection\n\n<table>\n\nSee [Model Selection](#model-selection)..."
  gotcha: There are ALREADY two "Model Selection" headings (### under Env Vars +
          ## top-level) — that is the pre-existing MD024 duplicate. Do NOT add a
          THIRD "Model Selection"; use a distinct name like '### Agent Runtime (Harness)'.
          The TOC uses [Model Selection](#model-selection-1) for the subsection.

# MUST READ — this subtask's research (THE load-bearing validation facts)
- docfile: plan/004_439241a82c24/P1M2T3S1/research/validation-environment-and-baseline.md
  section: "1 (docs:lint binary NOT installed — use format:check + npx markdownlint-cli2)",
           "2 (markdownlint baseline = 57 MD013 / 1 MD051 / 1 MD024; do not add NEW rule violations)",
           "3 (prettier is the authoritative gate; doc PASSES today)",
           "4 (npm run validate only checks .md via format:check)",
           "5 (the exact validation recipe)"
  why: >
    The single most important non-obvious fact: `npm run docs:lint` FAILS at the
    package level (markdownlint not installed), so the implementer must NOT treat a
    docs:lint failure as a lint-content failure. The authoritative gate is
    `npm run format:check`. Use `npx markdownlint-cli2` for the equivalent content
    check and compare against the documented baseline counts.

# ARCHITECTURE — confirms scope (docs/ is in scope; source is NOT)
- docfile: plan/004_439241a82c24/architecture/delta_impact.md
  section: "D. Documentation" (CONFIGURATION.md row) + "E. NOT changing"
  why: >
    Confirms docs/CONFIGURATION.md EXISTS (16KB), documents z.ai env vars, has 0
    mentions of PRP_AGENT_HARNESS or provider-qualified models, and that the target
    is to "Add PRP_AGENT_HARNESS env var, provider-qualified model format,
    harness/provider independence (mirror PRD §9.2.2 / §9.4.2)". Also confirms source
    files are NOT changing in this subtask.

# PARALLEL-SIBLING CONTRACT (assume implemented as-specified — do not duplicate)
- docfile: plan/004_439241a82c24/P1M2T3S2/PRP.md  (when available; dir is empty at research time)
  why: >
    Sibling P1.M2.T3.S2 CREATES docs/GROUNDSWELL_GUIDE.md with a "Harness System"
    section (supported-harnesses table, configureHarnesses() config, critical rules,
    capability reference) mirroring PRD §9.4. This PRP CROSS-LINKS to
    ./GROUNDSWELL_GUIDE.md#harness-system but does NOT create that file and does NOT
    duplicate its capability table (keeps CONFIGURATION.md focused on env-var config).
    The forward link lands correctly when both tasks merge.

# FORMAT CONFIG (must obey — prettier reformats tables)
- file: .prettierrc
  why: printWidth 80, singleQuote, trailingComma 'es5', tabWidth 2, endOfLine 'lf'.
        Prettier WILL reflow markdown tables to its own alignment; let it.
- file: .prettierignore
  why: docs/ is NOT ignored → format:check enforces docs/CONFIGURATION.md.
```

### Current Codebase tree (relevant slice)

```bash
docs/CONFIGURATION.md                  # ← THE EDIT TARGET (435 lines; z.ai env vars; 0 harness/qualified-model mentions)
docs/GROUNDSWELL_GUIDE.md              # DOES NOT EXIST — created by sibling P1.M2.T3.S2 (cross-link target: #harness-system)
docs/INSTALLATION.md, docs/CLI_REFERENCE.md, docs/ARCHITECTURE.md ...  # other docs (read-only reference for style)
src/config/constants.ts                # CONSUME (read-only) — PRP_AGENT_HARNESS, DEFAULT_HARNESS='pi', DEFAULT_MODEL_PROVIDER='zai', MODEL_NAMES, MODEL_ENV_VARS
src/config/environment.ts              # CONSUME (read-only) — qualifyModel() (idempotent, default zai), getModel() override behavior
src/agents/agent-factory.ts            # NOT IN SCOPE (runtime wiring; already implemented by M1.T1.S2) — do NOT edit
.env.example                           # NOT IN SCOPE (already documents *_MODEL overrides with bare names; leave as-is)
package.json                           # READ-ONLY — docs:lint / format:check / validate / fix script definitions
.prettierrc / .prettierignore          # READ-ONLY — prettier rules (enforced by format:check)
plan/004_439241a82c24/P1M2T3S1/research/validation-environment-and-baseline.md   # THIS TASK'S RESEARCH NOTE
```

### Desired Codebase tree with files to be added

```bash
docs/CONFIGURATION.md   # MODIFIED IN PLACE — add harness env var + provider-qualified models + cross-link (+5 topic areas, ~1 new subsection, 1 new table row, 1 .env block, 2 gotchas, 1 See-Also link, version bump)
# NO new files created by this subtask (docs/GROUNDSWELL_GUIDE.md is owned by sibling P1.M2.T3.S2)
```

### Known Gotchas of our codebase & Library Quirks

```markdown
<!-- CRITICAL — `npm run docs:lint` DOES NOT LINT in this environment. The
     `markdownlint` binary is NOT installed (not in node_modules/.bin, not in
     devDependencies). `npm run docs:lint` errors with "could not determine
     executable to run" at the PACKAGE level — this is a pre-existing env gap,
     NOT a content failure and NOT this task's job to fix. The authoritative,
     installed gate is `npm run format:check` (prettier). For an equivalent
     markdown content check, run `npx markdownlint-cli2 docs/CONFIGURATION.md`
     (auto-installs). See research/validation-environment-and-baseline.md §1. -->

<!-- CRITICAL — the doc ALREADY has 59 markdownlint errors (baseline). Running
     `npx markdownlint-cli2 docs/CONFIGURATION.md` today reports 57×MD013/line-length
     (wide tables), 1×MD051/link-fragments, 1×MD024/no-duplicate-heading. This is
     the ESTABLISHED BASELINE — the file never passed markdownlint. The task scope
     is "fix lint/format issues INTRODUCED", i.e. do NOT add NEW rule violations
     (no new MD024 duplicate headings, no new MD051 broken anchors, no MD009/MD012/MD040).
     An increase in MD013 count from new wide-table rows is acceptable (it matches
     the existing table style — every existing table already exceeds 80 cols). Do
     NOT attempt to zero out the pre-existing 59 (would require rewriting every
     table — out of scope). See research §2. -->

<!-- CRITICAL — there are ALREADY two "Model Selection" headings in the file:
       - `### Model Selection`  (env-var subsection; TOC anchor #model-selection-1)
       - `## Model Selection`   (top-level section;      TOC anchor #model-selection)
     That duplication is the pre-existing MD024 violation. Do NOT add a THIRD
     "Model Selection". Name the new subsection distinctly: `### Agent Runtime (Harness)`
     (unique anchor #agent-runtime-harness — no collision). Add exactly ONE new
     TOC entry pointing at that anchor, and verify it resolves. -->

<!-- CRITICAL — prettier REFORMATS markdown tables. After editing, run `npm run fix`
     (lint:fix + prettier --write) so prettier aligns the new table columns to its
     own style, THEN run `npm run format:check`. Do NOT hand-align columns to match
     the file's current padding (prettier owns table formatting and the file already
     passes prettier today). Let prettier win. -->

<!-- GOTCHA — provider-qualification is IDEMPOTENT and the provider default is 'zai'.
     qualifyModel('GLM-4.7') → 'zai/GLM-4.7'; qualifyModel('zai/GLM-4.7') → 'zai/GLM-4.7'
     (unchanged). Document BOTH behaviors: bare names get qualified, already-qualified
     names pass through. Source: src/config/environment.ts qualifyModel(). -->

<!-- GOTCHA — the model string is NEVER harness-qualified. `pi/zai/GLM-4.7` is INVALID
     (PRD §9.4.3). This is the #1 footgun to call out in a Common Gotcha, with the
     "how to fix" = use `zai/GLM-4.7` (provider/model only). -->

<!-- GOTCHA — claude-code is Anthropic-ONLY and incompatible with the z.ai provider
     (PRD §9.2.4 Harness note + §9.4.3). The default config is pi + zai. Selecting
     claude-code requires (a) switching to anthropic/* models and (b) disabling the
     z.ai endpoint safeguard. The pipeline fails fast at startup on the mismatch.
     This is the #2 footgun to call out, cross-referencing "API Endpoint Security". -->

<!-- GOTCHA — PRESERVE the existing OPUS model documentation. The existing Model
     Selection table documents opus/sonnet/haiku (and MODEL_NAMES has all three).
     PRD §9.2.3 only mentions sonnet + haiku, but the code has opus too — keep the
     OPUS row as-is; just add the provider-qualification note that applies to all tiers. -->

<!-- GOTCHA — version + date convention. The header has Status: Published /
     Last Updated: 2026-01-23 / Version: 1.0.0. Bump to Version: 1.1.0 and
     Last Updated: 2026-06-20 (current date) to reflect the new harness/model docs.
     Do not change Status. -->

<!-- GOTCHA — do NOT edit .env.example. It already documents the *_MODEL overrides
     (with bare names) and is out of scope for this docs-only subtask. .env.example
     changes belong to a config-layer task, not the docs task. -->
```

---

## Implementation Blueprint

### Data models and structure

None. This is a documentation edit; there are no data models, schemas, or types.
The only "structure" is the markdown document's section layout (described in the
Placement Plan under **What**).

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: READ the current docs/CONFIGURATION.md and the two source files
  - READ: docs/CONFIGURATION.md (full 435 lines) to internalize the existing style
    (header, TOC, Quick Reference table, ### env-var subsections, ## Model Selection,
    Example Configuration .env block, Common Gotchas, See Also).
  - READ: src/config/constants.ts (PRP_AGENT_HARNESS, DEFAULT_HARNESS='pi',
    DEFAULT_MODEL_PROVIDER='zai', SUPPORTED_HARNESSES, MODEL_NAMES, MODEL_ENV_VARS)
    and src/config/environment.ts (qualifyModel idempotent, getModel override).
  - CONFIRM the values to mirror (see Documentation & References above).

Task 2: MODIFY the header (version + date)
  - EDIT: the top-of-file block — Version: 1.0.0 → 1.1.0; Last Updated: 2026-01-23 → 2026-06-20.
    Keep Status: Published unchanged.

Task 3: MODIFY ## Table of Contents
  - ADD: under the Environment Variables group, after the Model Selection entry,
    add `- [Agent Runtime (Harness)](#agent-runtime-harness)` (unique anchor).
  - VERIFY: the anchor matches the new subsection heading exactly (GitHub slug:
    lowercase, spaces→'-'; 'Agent Runtime (Harness)' → 'agent-runtime-harness').

Task 4: MODIFY ## Quick Reference table
  - ADD row (preserve the existing column alignment; prettier will finalize):
    `| PRP_AGENT_HARNESS | No | \`pi\` | Agent runtime/SDK (\`pi\` or \`claude-code\`); orthogonal to the LLM provider |`
  - NOTE: keep it concise here; the subsection has the detail.

Task 5: MODIFY ### Model Selection (env-var subsection) — add provider-qualification note
  - PRESERVE the existing opus/sonnet/haiku table (do NOT delete OPUS).
  - ADD after the table a blockquote note:
    "> Models are **provider-qualified** at runtime. A bare model name (e.g. `GLM-4.7`)
    > resolves to `zai/GLM-4.7` (provider `zai`, the default); an already-qualified
    > `provider/model` (e.g. `zai/GLM-4.7`) passes through unchanged. Values are read
    > from the environment at runtime — never hardcoded. The model string is always
    > `provider/model`; it is never harness-qualified (see
    > [Agent Runtime (Harness)](#agent-runtime-harness))."

Task 6: CREATE ### Agent Runtime (Harness) subsection  (NEW — insert AFTER ### Model Selection, BEFORE ### Pipeline Control)
  - ADD a one-line intro citing PRD §9.2.2 / §9.4.2.
  - ADD the harness env-var table:
    `| Variable | Required | Default | Choices | Description |` with the single row
    `PRP_AGENT_HARNESS | No | pi | pi, claude-code | Agent runtime/SDK to use. \`pi\` (pi.dev) is vendor-neutral; \`claude-code\` runs Anthropic-only models.`
  - ADD "Harness ↔ provider independence" bullets:
      * harness and provider/model are selected independently;
      * the harness NEVER appears in the model string (`pi/zai/GLM-4.7` is invalid);
      * `claude-code` is Anthropic-only and incompatible with z.ai — selecting it
        requires switching to `anthropic/*` models and disabling the z.ai endpoint
        safeguard (cross-link [API Endpoint Security](#api-endpoint-security) + PRD §9.2.4);
        the pipeline fails fast at startup.
  - ADD a cross-link line: "For the full harness system (supported harnesses,
    `configureHarnesses()` configuration, capability reference, and parity rules),
    see the **[Harness System](./GROUNDSWELL_GUIDE.md#harness-system)** section of
    the Groundswell Guide."

Task 7: MODIFY ## Model Selection → "Model Override" bash block
  - UPDATE the override example so it reflects qualification. Keep opus/sonnet/haiku
    rows but annotate resolution, and add the fully-qualified option:
      export ANTHROPIC_DEFAULT_SONNET_MODEL="GLM-4.7"      # resolves to zai/GLM-4.7
      export ANTHROPIC_DEFAULT_HAIKU_MODEL="GLM-4.5-Air"   # resolves to zai/GLM-4.5-Air
      # Or set a fully-qualified provider/model directly:
      # export ANTHROPIC_DEFAULT_SONNET_MODEL="zai/GLM-4.7"

Task 8: MODIFY ## Example Configuration — add a harness .env block
  - INSERT (between the MODEL CONFIGURATION block and the PIPELINE CONTROL block, or
    after MODEL CONFIGURATION) a new sectioned block:
      # =============================================================================
      # AGENT RUNTIME (HARNESS) — OPTIONAL
      # =============================================================================
      # Agent runtime/SDK. INDEPENDENT of the LLM provider/model above.
      # Default: pi (pi.dev, vendor-neutral — runs any provider, incl. z.ai).
      # claude-code requires anthropic/* models (incompatible with the z.ai provider).
      # PRP_AGENT_HARNESS=pi

Task 9: MODIFY ## Common Gotchas — add two gotchas
  - ADD ### "Harness appearing in the model string is invalid":
      What you see: a model string like `pi/zai/GLM-4.7` is rejected / mis-resolved.
      Why: the harness never appears in the model string (PRD §9.4.3). Models are
      `provider/model` only.
      How to fix: use `zai/GLM-4.7` (provider/model). Select the harness separately
      via PRP_AGENT_HARNESS.
  - ADD ### "Using claude-code with a z.ai key":
      What you see: startup fails fast with a harness/provider configuration error.
      Why: `claude-code` runs Anthropic-only models and is incompatible with the z.ai
      provider (PRD §9.2.4 / §9.4.3).
      How to fix: either keep the default `pi` harness (works with z.ai), or — if you
      need `claude-code` — switch to `anthropic/*` models and disable the z.ai
      endpoint safeguard.

Task 10: MODIFY ## See Also — add the Groundswell Guide link
  - ADD bullet: `- **[Groundswell Guide](./GROUNDSWELL_GUIDE.md)** - Harness system,
    supported runtimes, capability reference, and parity rules`

Task 11: FORMAT + VERIFY (the validation gate — research §5)
  - RUN: `npm run fix`            # lint:fix + prettier --write (aligns the new tables)
  - RUN: `npm run format:check`  # MUST be green (authoritative, installed gate)
  - RUN: `npm run validate`      # MUST be green (only format:check is relevant for .md)
  - RUN: `npx markdownlint-cli2 docs/CONFIGURATION.md`  # compare to baseline:
        57 MD013 / 1 MD051 / 1 MD024. Ensure NO new rule violations are introduced
        (no new MD024 duplicate heading, no new MD051 broken anchor, no MD009/MD012/MD040).
        An increased MD013 count from new wide-table rows is acceptable.
  - DO NOT run `npm run docs:lint` as the gate — markdownlint binary is not installed;
        it errors at the package level (pre-existing gap, out of scope).
  - EXPECTED: format:check + validate green; markdownlint shows no NEW rule violations.
```

### Implementation Patterns & Key Details

```markdown
<!-- NEW SUBSECTION — drop in between '### Model Selection' and '### Pipeline Control'.
     Match the surrounding style: blank lines around headings, padded pipe table,
     '>' blockquote, bulleted list, relative markdown link. -->

### Agent Runtime (Harness)

The agent runtime (harness) drives prompting, tool execution, and streaming. It is
**independent of the LLM provider** — it is selected separately from the model
(see [Model Selection](#model-selection-1)). Mirrors PRD §9.2.2 / §9.4.2.

| Variable            | Required | Default | Choices             | Description                                                                                                                     |
| ------------------- | -------- | ------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `PRP_AGENT_HARNESS` | No       | `pi`    | `pi`, `claude-code` | Agent runtime/SDK to use. `pi` (pi.dev) is vendor-neutral and runs any provider; `claude-code` runs Anthropic-only models only. |

**Harness ↔ provider independence:**

- The **harness** (`PRP_AGENT_HARNESS`) and the **provider/model** (see
  [Model Selection](#model-selection-1)) are selected independently.
- The harness **never** appears in the model string. `pi/zai/GLM-4.7` is **invalid**;
  always use `provider/model` (e.g. `zai/GLM-4.7`).
- **`claude-code` is Anthropic-only** and is **incompatible with the z.ai provider**
  used by default. Selecting it requires switching to `anthropic/*` models and
  disabling the z.ai endpoint safeguard (see
  [API Endpoint Security](#api-endpoint-security) and PRD §9.2.4). The pipeline
  validates this at startup and fails fast with a configuration error.

For the full harness system — supported harnesses, `configureHarnesses()`
configuration, the capability reference, and feature-parity rules — see the
**[Harness System](./GROUNDSWELL_GUIDE.md#harness-system)** section of the
Groundswell Guide.
```

```markdown
<!-- PROVIDER-QUALIFICATION NOTE — add directly after the ### Model Selection
     (env-var) table, before 'See [Model Selection](#model-selection) ...'. -->

> Models are **provider-qualified** at runtime. A bare model name (e.g. `GLM-4.7`)
> resolves to `zai/GLM-4.7` (provider `zai`, the default); an already-qualified
> `provider/model` (e.g. `zai/GLM-4.7`) passes through unchanged. Values are read
> from the environment at runtime — never hardcoded. The model string is always
> `provider/model`; it is never harness-qualified (see
> [Agent Runtime (Harness)](#agent-runtime-harness)).
```

```markdown
<!-- EXAMPLE .env BLOCK — add inside ## Example Configuration, after the
     MODEL CONFIGURATION block. Match the existing ===== divider style. -->

# =============================================================================

# AGENT RUNTIME (HARNESS) — OPTIONAL

# =============================================================================

# Agent runtime/SDK. INDEPENDENT of the LLM provider/model above.

# Default: pi (pi.dev, vendor-neutral — runs any provider, incl. z.ai).

# claude-code requires anthropic/\* models (incompatible with the z.ai provider).

# PRP_AGENT_HARNESS=pi
```

### Integration Points

```yaml
DOCUMENTATION (docs/CONFIGURATION.md — the only file modified):
  - header:       Version 1.0.0 → 1.1.0; Last Updated → 2026-06-20
  - TOC:          + [Agent Runtime (Harness)](#agent-runtime-harness)
  - Quick Ref:    + PRP_AGENT_HARNESS row (No | pi | ...)
  - Env Vars:     ### Model Selection gains a provider-qualification blockquote note
  - Env Vars:     NEW ### Agent Runtime (Harness) subsection (table + independence + cross-link)
  - Model Sel:    "Model Override" bash block updated (qualification comments + qualified option)
  - Example:      + AGENT RUNTIME (HARNESS) — OPTIONAL .env block
  - Gotchas:      + "Harness in model string is invalid"; + "claude-code + z.ai incompatible"
  - See Also:     + Groundswell Guide (./GROUNDSWELL_GUIDE.md)

CROSS-LINKS (forward links to sibling P1.M2.T3.S2 output — land correctly on merge):
  - ./GROUNDSWELL_GUIDE.md           (See Also)
  - ./GROUNDSWELL_GUIDE.md#harness-system  (Agent Runtime subsection)

NO CHANGES TO (hard boundary):
  - src/**, tests/**, package.json, .env.example, .prettierrc, tsconfig*, any other file
  - docs/GROUNDSWELL_GUIDE.md (created by sibling P1.M2.T3.S2 — do NOT create/duplicate)
  - PRD.md, plan/**, tasks.json (read-only / protected)
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Format the edited file (prettier owns markdown table alignment).
npm run fix                       # = lint:fix (ts only) + prettier --write (incl. *.md)

# Authoritative installed gate — MUST be green.
npm run format:check              # prettier --check "**/*.{ts,js,json,md,yml,yaml}"
npm run validate                  # = lint && format:check && typecheck (only format:check matters for .md)

# Targeted (faster feedback on just the edited file):
npx prettier --check docs/CONFIGURATION.md

# Expected: Zero errors. format:check passes today on the unedited file, so a
# failure after editing means the edit introduced a prettier violation — re-run
# `npm run fix` and let prettier re-align the new tables.
```

### Level 2: Markdown Lint Content Check (equivalent, no-install)

```bash
# `npm run docs:lint` references the `markdownlint` binary, which is NOT installed
# in this environment (errors at the package level — pre-existing gap, out of scope).
# Use markdownlint-cli2 (auto-installs) for the equivalent content check:
npx markdownlint-cli2 docs/CONFIGURATION.md

# EXPECTED: the file reports violations, but they must match the ESTABLISHED BASELINE
# in kind — primarily MD013/line-length on wide tables (acceptable; matches existing
# style). CRITICAL: ensure NO NEW violations of rules absent from the baseline:
#   - no NEW MD024/no-duplicate-heading  (there is already 1: "Model Selection" x2;
#     the new subsection is uniquely named 'Agent Runtime (Harness)')
#   - no NEW MD051/link-fragments        (verify the new TOC entry + cross-links resolve)
#   - no  MD009/trailing-space, MD012/multiple-blanks, MD040/fenced-code-language
# An increased MD013 count from new wide-table rows is acceptable (baseline style).
# Do NOT attempt to zero out the pre-existing ~59 baseline errors (out of scope).
```

### Level 3: Manual / Render Verification (System Validation)

```bash
# Render sanity: open docs/CONFIGURATION.md in a markdown previewer (or GitHub view)
# and confirm:
#   1. The new 'Agent Runtime (Harness)' subsection renders under Environment Variables.
#   2. The TOC entry [Agent Runtime (Harness)](#agent-runtime-harness) jumps to it.
#   3. The cross-link ./GROUNDSWELL_GUIDE.md#harness-system is a valid relative link
#      (will resolve once sibling P1.M2.T3.S2 merges the target file).
#   4. The Model Selection blockquote note + Example .env block render cleanly.
#   5. Both new Common Gotchas render with their code fences intact.

# No service to start, no DB, no network — documentation-only subtask.

# Expected: all five render checks pass; no broken anchors; version header shows 1.1.0.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Documentation correctness review (record in commit message):
#   1. Every default/choice matches the IMPLEMENTED code:
#        PRP_AGENT_HARNESS default 'pi'; choices 'pi','claude-code'; provider 'zai';
#        sonnet 'GLM-4.7' → 'zai/GLM-4.7'; haiku 'GLM-4.5-Air' → 'zai/GLM-4.5-Air'.
#      (Cross-check against src/config/constants.ts + src/config/environment.ts.)
#   2. The five contract topics are all present: PRP_AGENT_HARNESS, harness/provider
#      independence, provider/model format, runtime model overrides, claude-code↔z.ai
#      incompatibility.
#   3. No claim contradicts PRD §9.2.2/§9.2.3/§9.2.4/§9.4.2/§9.4.3.
#   4. No duplication of the sibling's capability table (CONFIGURATION.md stays
#      env-var-focused; the full system lives in GROUNDSWELL_GUIDE.md).
#   5. Scope discipline: no source/test/.env.example/package.json edits.
```

---

## Final Validation Checklist

### Technical Validation

- [ ] `npm run format:check` exits 0 (authoritative, installed gate).
- [ ] `npm run validate` exits 0 (only `format:check` is relevant for the `.md` change).
- [ ] `npx markdownlint-cli2 docs/CONFIGURATION.md` introduces **no new rule
      violations** beyond the baseline (no new MD024/MD051; no MD009/MD012/MD040).
      Increased MD013 count from new wide-table rows is acceptable.
- [ ] `npm run docs:lint` is **not** required to pass (markdownlint binary not
      installed — pre-existing env gap; documented and out of scope).

### Feature Validation

- [ ] `PRP_AGENT_HARNESS` documented (default `pi`, choices `pi`/`claude-code`,
      orthogonal to provider) in Quick Reference AND a new `### Agent Runtime (Harness)`.
- [ ] Provider-qualified `provider/model` format documented (bare `GLM-4.7` →
      `zai/GLM-4.7`; idempotent; never harness-qualified) in the Model Selection
      note AND the Model Override example.
- [ ] Runtime model env-var overrides documented (`ANTHROPIC_DEFAULT_SONNET_MODEL`,
      `ANTHROPIC_DEFAULT_HAIKU_MODEL`, runtime-read, OPUS preserved).
- [ ] `claude-code` Anthropic-only / z.ai incompatibility documented with a §9.2.4
      cross-reference and a Common Gotcha.
- [ ] Cross-link to `./GROUNDSWELL_GUIDE.md#harness-system` present (See Also + subsection).
- [ ] Header versioned `1.0.0 → 1.1.0`; `Last Updated → 2026-06-20`.
- [ ] All five contract topics verified consistent with `src/config/constants.ts`
      and `src/config/environment.ts`.

### Code Quality Validation

- [ ] Matches existing doc style (headers, padded pipe tables, code fences,
      blockquotes, See Also list, ===== `.env` dividers).
- [ ] New subsection heading is unique (no MD024 duplicate; avoids "Model Selection").
- [ ] New TOC entry + cross-links resolve to real anchors (no MD051).
- [ ] No content duplicated from the sibling's GROUNDSWELL_GUIDE.md capability table.
- [ ] No source/test/`.env.example`/`package.json`/config files modified.

### Documentation & Deployment

- [ ] Commit message documents: the five topics added; the version bump; the
      cross-link to the Groundswell Guide (sibling P1.M2.T3.S2); the validation
      caveat (`docs:lint` binary not installed → relied on `format:check` +
      `npx markdownlint-cli2` vs the documented baseline).
- [ ] No new env vars introduced (documents existing `PRP_AGENT_HARNESS` only).

---

## Anti-Patterns to Avoid

- ❌ Don't run `npm run docs:lint` and treat its failure as a content failure — the
  `markdownlint` binary is **not installed**; it errors at the package level. Use
  `npm run format:check` (authoritative) + `npx markdownlint-cli2` (equivalent). See
  research §1.
- ❌ Don't attempt to make the whole file pass markdownlint — it has a 59-error
  baseline (57 MD013 on wide tables + 1 MD051 + 1 MD024) that predates this task.
  Scope is "don't introduce NEW rule violations." See research §2.
- ❌ Don't hand-align markdown table columns — let `npm run fix` (prettier) own table
  formatting. The file already passes prettier today; keep it passing.
- ❌ Don't add a third "Model Selection" heading (there are already two → the existing
  MD024). Name the new subsection distinctly (`### Agent Runtime (Harness)`).
- ❌ Don't duplicate the harness capability table / `configureHarnesses()` detail from
  the sibling's GROUNDSWELL_GUIDE.md — CONFIGURATION.md stays env-var-focused and
  cross-links out.
- ❌ Don't edit `src/**`, `tests/**`, `.env.example`, `package.json`, or any config —
  this is a **documentation-only** subtask. `.env.example` already documents the
  `*_MODEL` overrides; leave it.
- ❌ Don't delete the OPUS model row — it exists in `MODEL_NAMES` and is already
  documented; just add the provider-qualification note that applies to all tiers.
- ❌ Don't invent values — mirror the IMPLEMENTED code exactly (`pi` default,
  `zai/GLM-4.7`, `zai/GLM-4.5-Air`) and the PRD wording (§9.2.2/§9.2.3/§9.2.4/§9.4.2/§9.4.3).
- ❌ Don't create `docs/GROUNDSWELL_GUIDE.md` — that is sibling P1.M2.T3.S2's deliverable.
  Only cross-link to it.
- ❌ Don't soften the claude-code↔z.ai incompatibility — it is a hard constraint
  (§9.2.4/§9.4.3) with a fail-fast startup guard; the doc must state it plainly.

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: This is a single-file, additive, documentation-only edit to a file whose
full structure and style have been read and indexed here. Every value to mirror is
sourced from the read-only implemented code (`src/config/constants.ts`,
`src/config/environment.ts`) and cross-checked against the PRD sections. The
placement plan names the exact sections to change and the exact new content (with
verbatim markdown snippets in Implementation Patterns). The single genuinely
non-obvious risk — `npm run docs:lint` failing because `markdownlint` is not
installed, which could mislead the agent into thinking its content is wrong — is
fully documented in the research note and converted into an unambiguous validation
recipe (`format:check` as the authoritative gate; `markdownlint-cli2` vs the
documented 57/1/1 baseline for the content check). The sibling boundary
(`docs/GROUNDSWELL_GUIDE.md` is owned by P1.M2.T3.S2) is explicit, and the
cross-link is forward-only (lands on merge). The only residual risk is a minor
markdown style/anchor nit, which the Level 1–2 gates (prettier + markdownlint-cli2
baseline comparison) will catch and which `npm run fix` resolves automatically.
