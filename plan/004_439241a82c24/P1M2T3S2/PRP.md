# PRP — P1.M2.T3.S2: Create docs/GROUNDSWELL_GUIDE.md with a Harness System section

---

## Goal

**Feature Goal**: **Create** a new, user-facing `docs/GROUNDSWELL_GUIDE.md` whose
core payload is a **"Harness System"** section that mirrors PRD §9.4
(§9.4.1–§9.4.4) and reflects the **already-shipped** pluggable-harness wiring
(P1.M1.T1.S2 + P1.M1.T2.S2). A reader should be able to understand the two
supported harnesses (`pi` default / `claude-code` optional), how to configure them
via `configureHarnesses({ defaultHarness:'pi', defaultModelProvider:'zai',
harnessDefaults })`, the four critical rules (model string never harness-qualified;
`claude-code` Anthropic-only; feature parity via `MCPHandler`; cache isolation by
harness×provider), and the capability matrix — **without reading source code**.
This is a **documentation-only CREATE** — no source, test, or schema changes.

**Deliverable**: A new file at **`docs/GROUNDSWELL_GUIDE.md`** (does not exist
today — confirmed) containing: a header block, a one-line intro, a Table of
Contents, a short **Overview**, a **`## Harness System`** section (anchor
**`#harness-system`** — the cross-link target consumed by sibling P1.M2.T3.S1)
with five subsections — Supported Harnesses (§9.4.1 table), Configuration
(§9.4.2 `configureHarnesses()` + `PRP_AGENT_HARNESS` + cascade), Critical Rules
(§9.4.3), Capability Reference (§9.4.4 table), Integration Example (the PRP
startup call) — and a **See Also** that reciprocally cross-links back to
`./CONFIGURATION.md`. Passes `npm run format:check` (authoritative) and introduces
**no avoidable markdownlint rule violations** beyond the accepted `docs/`
convention of wide tables tripping MD013.

**Success Definition** (the contract from the work item):

- `docs/GROUNDSWELL_GUIDE.md` **exists** at the repo path (not just under
  `plan/003_…`) and contains a `## Harness System` heading whose GitHub slug is
  exactly `#harness-system` (sibling P1.M2.T3.S1 links here).
- Content **mirrors PRD §9.4** at minimum: the supported-harnesses table
  (§9.4.1), the `configureHarnesses({ defaultHarness:'pi',
  defaultModelProvider:'zai', harnessDefaults })` startup config (§9.4.2), the
  four critical rules (§9.4.3), and the capability reference table (§9.4.4), plus
  a short integration example showing the PRP startup call.
- Content is **consistent with the implemented code** — `defaultModelProvider:
  'zai'` (NOT the upstream's `'anthropic'`), `PRP_AGENT_HARNESS` default `pi`,
  supported set `['pi','claude-code']`, models are `provider/model`
  (e.g. `zai/GLM-4.7`), `claude-code`+z.ai rejected at startup.
- Style **matches the established `docs/` convention** (header block, `>`
  blockquote intro, padded pipe tables, `bash`/`typescript` code fences, See Also
  with relative links) — borrow the shell of the prior guide at
  `plan/003_b3d3efdaf0ed/docs/GROUNDSWELL_GUIDE.md` for tone only.
- `npm run format:check` is **green** (the authoritative, installed gate).
- `npm run validate` is **green** (only `format:check` is relevant for a `.md`
  change; `lint`/`typecheck` are unaffected — no `.ts` touched).
- `npx markdownlint-cli2 docs/GROUNDSWELL_GUIDE.md` introduces **no avoidable**
  rule violations: the only acceptable violations are **MD013/line-length on the
  two required wide reference tables** (matches every existing `docs/` file's
  convention); there must be **zero** MD024 duplicate headings, **zero** MD051
  broken anchors, and **zero** MD009/MD012/MD040/MD031/MD032/MD033.
- `npm run docs:lint` is **not** required to pass — the `markdownlint` binary is
  **not installed** in this environment (pre-existing gap; errors at the
  package-resolution level). Documented and out of scope.
- **No** source/test/schema/`.env.example`/`package.json`/config files modified.

---

## User Persona (if applicable)

**Target User**: A **developer/operator/integrator** who wants to understand or
switch the PRP Pipeline's agent **runtime (harness)** — e.g. deciding whether to
keep the default `pi` runtime or adopt `claude-code`, and what each implies for
providers, tools, and caching.

**Use Case**: Reading the Groundswell Guide to understand the harness system end
to end (what the harness is, how it differs from the LLM provider, how to
configure it, what's compatible, and what capabilities each harness has) —
**before** touching env vars or agent configs.

**User Journey**:

1. Follows the cross-link from `docs/CONFIGURATION.md` → "Harness System"
   (`./GROUNDSWELL_GUIDE.md#harness-system`), or opens the Guide directly.
2. Reads **Overview** → learns Groundswell's role and the harness concept.
3. Reads **Supported Harnesses** → sees `pi` (default, vendor-neutral) vs
   `claude-code` (optional, Anthropic-only).
4. Reads **Configuration** → sees the `configureHarnesses()` startup call, the
   `PRP_AGENT_HARNESS` env var, and the cascade rule.
5. Reads **Critical Rules** → internalizes the four invariants (esp. "model
   string never harness-qualified" and "claude-code is Anthropic-only").
6. Reads **Capability Reference** → compares MCP/Skills/LSP/streaming/etc. across
   harnesses.
7. Reads **Integration Example** → sees the real PRP startup call.
8. Follows **See Also** back to CONFIGURATION.md for env-var details.

**Pain Points Addressed**:

- "What is a harness and how is it different from the model/provider?" (orthogonality).
- "Can I run `claude-code` with my z.ai key?" (no — Anthropic-only; fail-fast).
- "Is `pi` missing MCP/Skills/LSP that `claude-code` has?" (no — parity via
  `MCPHandler`).
- "Why is my model `zai/GLM-4.7` and not `pi/zai/GLM-4.7`?" (harness never in the
  model string).

---

## Why

- **PRD §9.4 is the source of truth** for the harness system, and the implemented
  wiring (P1.M1.T1.S2's `configureHarness()` + compatibility guard; P1.M1.T2.S2's
  provider-qualified models) is **already shipped and passing its tests**
  (M2.T1/M2.T2 Complete). There is currently **no** user-facing doc for the
  harness system in `docs/` — `docs/GROUNDSWELL_GUIDE.md` does not exist (arch
  note `implementation_notes.md` §6; confirmed by `ls`). This task closes that
  doc/code gap with the canonical guide.
- **The cross-link contract is bidirectional.** Sibling P1.M2.T3.S1
  (`docs/CONFIGURATION.md`) is implemented in parallel and adds forward links to
  `./GROUNDSWELL_GUIDE.md#harness-system`. Those links resolve to an empty file
  until **this** task creates the target heading. Delivering the `## Harness
  System` heading (slug `#harness-system`) is a **hard requirement** for the
  sibling's links to land.
- **Prevents misconfiguration at the system level.** The two highest-impact
  footguns — (1) writing `pi/zai/GLM-4.7` (harness-qualified — invalid; PRD
  §9.4.3) and (2) selecting `claude-code` while still on the z.ai provider
  (Anthropic-only; PRD §9.2.4/§9.4.3, fails fast at startup) — are architectural
  invariants. Documenting them in the system guide keeps the default `pi` + `zai`
  configuration working and the z.ai **cost safeguard** effective.
- **Scope discipline + cohesion.** CONFIGURATION.md stays focused on **env-var +
  override configuration** (sibling S1); the **system overview** (capability
  matrix, `configureHarnesses()` semantics, parity rules, the why behind the
  rules) lives here. No file ownership overlap, no content duplication.

---

## What

### User-visible behavior

None at runtime/CLI. Observable change: a new file `docs/GROUNDSWELL_GUIDE.md`
appears, consumable by users and resolvable as the `#harness-system` cross-link
target from CONFIGURATION.md. No new env vars, no new API, no behavior change.

### Technical requirements (exact contract — the five payloads)

Mirror PRD §9.4 (verbatim content is in the PRP's `<selected_prd_content>` /
PRD §9.4.1–§9.4.4). All wording must be consistent with the **implemented** code:

| Payload (PRD ref)                                  | Required content in GROUNDSWELL_GUIDE.md                                                                                                                                                                                                                                                                                                                | Implemented source of truth (read-only)                                                                                                  |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Supported Harnesses (§9.4.1, h4.9)                 | A padded pipe table with rows `pi` (Default: **Yes**; Notes: vendor-neutral, runs any provider incl. z.ai; MCP/Skills/LSP via `MCPHandler`) and `claude-code` (Default: No/optional; Notes: Anthropic-only, incompatible with z.ai, parity-maintained fallback). Include the "Default selection" note: `PRP_AGENT_HARNESS` defaults to `pi`. | `src/config/constants.ts`: `DEFAULT_HARNESS='pi'`, `SUPPORTED_HARNESSES=['pi','claude-code']`; PRD §9.4.1 table                           |
| Configuration (§9.4.2, h4.10)                      | A `typescript` code block: `configureHarnesses({ defaultHarness:'pi', defaultModelProvider:'zai', harnessDefaults:{ 'claude-code':{ apiKey: process.env.ANTHROPIC_API_KEY } } })`. Plus: `PRP_AGENT_HARNESS` (`pi` \| `claude-code`, default `pi`); cascade rule (global default → agent config → prompt overrides); harness-specific options MAY extend base `HarnessOptions`. | `src/config/harness.ts` `configureHarness()`; arch `external_deps.md` §2; PRD §9.4.2                                                       |
| Critical Rules (§9.4.3, h4.11)                     | Four bullets, verbatim intent: (1) harness never in model string — `pi/zai/GLM-4.7` and `cc/anthropic/...` are **invalid**; always `provider/model`; (2) `claude-code` runs `anthropic/*` only — z.ai on `claude-code` is a config error surfaced at `initialize()`/`execute()`; (3) feature parity — MCP/skills/hooks/`AgentResponse`/caching/events identical across both; tools flow through `MCPHandler` for both so `pi`'s lack of built-in MCP/LSP is **not** a gap; (4) cache isolation — keys incorporate **both** harness and provider/model. | `src/config/harness.ts` `HarnessProviderMismatchError`; arch `external_deps.md` §3 (`parseModelSpec` throws on 3-segment) + §5; PRD §9.4.3 |
| Capability Reference (§9.4.4, h4.12)               | Padded pipe matrix: rows = MCP, Skills, LSP, Streaming, Sessions, Extended Thinking, LLM providers; columns = `pi`, `claude-code`. Values per PRD §9.4.4 (e.g. MCP: `pi` = via `MCPHandler`, `claude-code` = built-in AND via `MCPHandler`; LLM providers: `pi` = any, `claude-code` = Anthropic only).                                                   | PRD §9.4.4 table; arch `external_deps.md` §5                                                                                              |
| Integration Example (optional but specified)       | A short `typescript`/`bash` snippet showing the **PRP startup call** — i.e. that the pipeline calls `configureHarnesses({...})` once at startup (via `src/config/harness.ts`'s `configureHarness()`), after `configureEnvironment()`.                                                                                                                  | `src/config/harness.ts` `configureHarness()` (the real call)                                                                              |

### Document structure (the exact layout to produce)

```bash
# Groundswell Guide
> <one-sentence blockquote: what this guide covers>
**Status**: Published
**Last Updated**: 2026-06-20
**Version**: 1.0.0
## Table of Contents
## Overview                      (1–2 paragraphs; Groundswell role + upstream link)
## Harness System                ← anchor #harness-system (CROSS-LINK TARGET — do not rename/pluralize)
  ### Supported Harnesses        (§9.4.1 table)
  ### Configuration              (§9.4.2 code block + env var + cascade)
  ### Critical Rules             (§9.4.3 four bullets)
  ### Capability Reference       (§9.4.4 matrix table)
  ### Integration Example        (PRP startup call)
## See Also                      (reciprocal links: CONFIGURATION.md, ARCHITECTURE.md, INSTALLATION.md, Groundswell upstream)
```

### Success Criteria

- [ ] `docs/GROUNDSWELL_GUIDE.md` exists at the repo root path (`docs/`).
- [ ] Contains `## Harness System` (slug `#harness-system`).
- [ ] All five payloads present and consistent with implemented code + PRD §9.4.
- [ ] Existing `docs/` style preserved (header, blockquote, padded tables, code
      fences with languages, See Also relative links).
- [ ] `npm run format:check` green; `npm run validate` green.
- [ ] `npx markdownlint-cli2` shows **only** MD013 on the two wide reference
      tables (accepted convention); zero MD024/MD051/MD009/MD012/MD040/MD031/
      MD032/MD033.
- [ ] Reciprocal cross-link back to `./CONFIGURATION.md` present in See Also.
- [ ] No source/test/schema/`.env.example`/`package.json` files modified.

---

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed
to implement this successfully?_ **Yes** — the exact target path (a NEW file at
`docs/GROUNDSWELL_GUIDE.md`, confirmed absent), the exact five payloads with their
PRD section refs (content verbatim in the PRP's selected PRD context), the exact
implemented source values they must mirror (`src/config/harness.ts`,
`src/config/constants.ts`, `architecture/external_deps.md`), the exact document
layout (structure tree under **What**), the style reference file, the hard anchor
contract (`#harness-system`), the cross-link reciprocity requirement, and the
validation recipe with the critical caveat that `npm run docs:lint`'s
`markdownlint` binary is **not installed** (use `npm run format:check` as the
authoritative gate and `npx markdownlint-cli2` for the equivalent content check,
expecting only MD013 on the two wide tables). All non-obvious facts are proven in
`research/context-and-validation.md`.

### Documentation & References

```yaml
# MUST READ — PRD sections this doc mirrors (the authoritative content source)
- docfile: PRD.md
  section: "9.4 Agent Harness System (Runtime Selection)" (h3.18) + §9.4.1–§9.4.4 (h4.9–h4.12)
  why: >
    THE content source. §9.4 intro (harness orthogonal to provider/model);
    §9.4.1 supported-harnesses table (pi default / claude-code optional + Notes);
    §9.4.2 configureHarnesses({ defaultHarness:'pi', defaultModelProvider:'zai',
    harnessDefaults }) + PRP_AGENT_HARNESS + cascade; §9.4.3 four critical rules;
    §9.4.4 capability reference matrix. Mirror wording/intent.
  critical: Use defaultModelProvider 'zai' (project default), NOT the upstream's
            'anthropic'. The §9.4.1 "Default selection" note (PRP_AGENT_HARNESS
            defaults to pi) and the §9.4.3 invalid examples (pi/zai/GLM-4.7,
            cc/anthropic/...) must appear.
- docfile: PRD.md
  section: "9.2.4 API Endpoint Safeguards — Harness note" (h4.3)
  why: >
    Cross-reference target for the claude-code↔z.ai incompatibility rule: "the
    optional claude-code harness is Anthropic-only and therefore incompatible with
    the z.ai provider — selecting it requires switching to anthropic/* models and
    disabling this safeguard."
- docfile: PRD.md
  section: "9.3.3 Agent Runtime & Personas" (h4.7)
  why: >
    Context for the Integration Example: tools execute locally via MCPHandler
    regardless of harness; the harness only reports tool calls back. Underpins
    §9.4.3 rule (3) feature parity.

# MUST READ — architecture notes (authoritative local Groundswell API surface + gotchas)
- docfile: plan/004_439241a82c24/architecture/external_deps.md
  section: "1 (types: HarnessId, HarnessOptions, GlobalHarnessConfig, ModelSpec)",
           "2 (configureHarnesses/getGlobalHarnessConfig/resolveHarnessConfig/resetGlobalHarnessConfig)",
           "3 (parseModelSpec — throws on 3-segment 'pi/zai/GLM-4.7')",
           "4 (AgentConfig.model/harness/harnessOptions)",
           "5 (PiHarness/ClaudeCodeHarness/registerDefaultHarnesses idempotent; claude-code Anthropic-only)",
           "6 (z.ai safeguard constrains the provider, not the harness)"
  why: >
    Authoritative signatures to cite verbatim. CRITICAL fact: configureHarnesses()
    validates ONLY defaultHarness + harnessDefaults keys — defaultModelProvider is
    an OPEN SET, NOT validated — so the PRP pipeline OWNS the claude-code↔z.ai rule.
- docfile: plan/004_439241a82c24/architecture/implementation_notes.md
  section: "6 (docs/GROUNDSWELL_GUIDE.md is a CREATE, not an edit; prior copy is tone-only)",
           "1 (WHERE the compatibility check must live — PRP owns it)",
           "2 (model string flow; parseModelSpec throws on 3-segment; never pi/zai/GLM-4.7)"
  why: >
    Confirms CREATE operation, the prior-copy-is-style-only rule, and the model-string
    invariant underpinning §9.4.3 rule (1).

# MUST READ — the implemented code this doc must match (read-only; do NOT edit)
- file: src/config/harness.ts
  why: >
    THE real startup call for the Integration Example. configureHarness() reads
    process.env[PRP_AGENT_HARNESS] ?? DEFAULT_HARNESS, validates against
    SUPPORTED_HARNESSES, throws HarnessProviderMismatchError if
    harness==='claude-code' && DEFAULT_MODEL_PROVIDER==='zai', then calls
    configureHarnesses({ defaultHarness, defaultModelProvider:'zai',
    harnessDefaults:{ 'claude-code':{ apiKey: process.env.ANTHROPIC_API_KEY } } }).
    Must run AFTER configureEnvironment().
  pattern: "export function configureHarness(): AgentHarness { … configureHarnesses({ defaultHarness: harness, defaultModelProvider: DEFAULT_MODEL_PROVIDER, harnessDefaults: { 'claude-code': { apiKey: process.env.ANTHROPIC_API_KEY } } }); }"
  gotcha: The doc's snippet must use defaultModelProvider 'zai' (DEFAULT_MODEL_PROVIDER),
          matching the code — NOT 'anthropic' (the Groundswell upstream example).
- file: src/config/constants.ts
  why: >
    Source of truth for the exact values to state: PRP_AGENT_HARNESS='PRP_AGENT_HARNESS',
    DEFAULT_HARNESS='pi', DEFAULT_MODEL_PROVIDER='zai',
    SUPPORTED_HARNESSES=['pi','claude-code'].
  pattern: "export const DEFAULT_HARNESS = 'pi' as const; export const DEFAULT_MODEL_PROVIDER = 'zai' as const; export const SUPPORTED_HARNESSES = ['pi', 'claude-code'] as const;"

# MUST READ — style/tone reference (borrow the SHELL only; it has NO harness content)
- file: plan/003_b3d3efdaf0ed/docs/GROUNDSWELL_GUIDE.md
  why: >
    Prior-session guide (1500 lines, v1.0.0). Use ONLY for tone/structure: header
    block (Status/Last Updated/Version), '> ' blockquote intro, '## Table of
    Contents' with anchor links, padded pipe tables, fenced code with language
    tags, '## See Also' with relative markdown links. It contains ZERO harness
    content (grep-confirmed) — do NOT copy its body.
  pattern: "# Groundswell Framework Guide\n\n> <blockquote>\n\n**Status**: Published\n**Last Updated**: …\n**Version**: 1.0.0"
  gotcha: Do NOT recreate the 1500-line comprehensive guide — scope is the Harness
          System (2-point task). Ship the focused layout in the structure tree above.

# MUST READ — sibling contract (the inbound cross-link this doc must satisfy)
- docfile: plan/004_439241a82c24/P1M2T3S1/PRP.md
  section: "What → Placement plan (See Also + Agent Runtime subsection both link to ./GROUNDSWELL_GUIDE.md#harness-system)"
  why: >
    Sibling P1.M2.T3.S1 (CONFIGURATION.md) is implemented in PARALLEL and adds
    forward links to ./GROUNDSWELL_GUIDE.md#harness-system. This task MUST create
    a heading whose slug is exactly #harness-system (i.e. '## Harness System').
    Treat the sibling PRP as a contract; reciprocate with a See Also link back to
    ./CONFIGURATION.md.
  critical: Heading '## Harness System' → slug '#harness-system'. Do NOT use
            'Harness Systems' (plural → '#harness-systems', breaks the link) or
            a deeper nesting that changes the slug.

# MUST READ — this subtask's research (load-bearing validation + layout facts)
- docfile: plan/004_439241a82c24/P1M2T3S2/research/context-and-validation.md
  section: "1 (CREATE, not edit; prior copy is tone-only)",
           "2 (PRD §9.4 → doc subsection map)",
           "4 (Groundswell API surface verbatim)",
           "6 (anchor contract #harness-system)",
           "7 (scope decision: focused guide, not 1500-line recreation)",
           "8 (validation env: format:check authoritative; docs:lint binary NOT installed; new-file markdownlint guidance)",
           "9 (cross-link reciprocity)",
           "10 (header convention v1.0.0 / 2026-06-20)"
  why: >
    The single most important non-obvious fact: `npm run docs:lint` FAILS at the
    package level (markdownlint not installed) — do NOT treat its failure as a
    content failure. Authoritative gate = `npm run format:check`; equivalent
    content check = `npx markdownlint-cli2 docs/GROUNDSWELL_GUIDE.md` (expect only
    MD013 on the two wide tables; zero of every other rule).

# MUST READ — sibling's validation research (same environment; authoritative gates)
- docfile: plan/004_439241a82c24/P1M2T3S1/research/validation-environment-and-baseline.md
  section: "1 (docs:lint binary NOT installed — use format:check + npx markdownlint-cli2)",
           "3 (prettier IS the authoritative gate)",
           "4 (npm run validate covers .md via format:check)",
           "5 (validation recipe)"
  why: >
    Confirms the validation environment for THIS repo (identical situation). Use
    npm run format:check as the authoritative gate; npx markdownlint-cli2 for the
    equivalent content check. Note: that note's "baseline" (59 errors) applies to
    CONFIGURATION.md specifically — for THIS new file there is NO baseline; aim
    for clean except MD013 on wide tables.

# EXTERNAL — Groundswell upstream docs (authoritative; cite as "full reference" links)
- url: ~/projects/groundswell/docs/harnesses.md
  why: >
    The Groundswell library's authoritative 586-line harness reference. Cite
    section anchors in See Also / prose: #supported-harnesses, #harness-identifier,
    #global-harness-configuration, #validation-behavior, #configuration-cascade,
    #model-and-provider-specification, #feature-parity, #mcp-skills-and-lsp-integration.
  critical: Upstream's configureHarnesses example uses defaultModelProvider
            'anthropic'; the PRP doc MUST use 'zai'. Note this divergence if helpful.
- url: ~/projects/groundswell/README.md
  why: Top-level Groundswell readme; See Also link (matches prior guide).

# FORMAT CONFIG (must obey — prettier reformats tables)
- file: .prettierrc
  why: printWidth 80, singleQuote, trailingComma 'es5', tabWidth 2, endOfLine 'lf',
        arrowParens 'avoid'. Prettier WILL reflow markdown tables to its own
        alignment; let it (run `npm run fix`). Prettier does NOT reflow prose —
        wrap prose lines at ~80 manually.
- file: .prettierignore
  why: docs/ is NOT ignored → format:check enforces docs/GROUNDSWELL_GUIDE.md.
```

### Current Codebase tree (relevant slice)

```bash
docs/GROUNDSWELL_GUIDE.md              # ← THE CREATE TARGET (does NOT exist today; confirmed by `ls`)
docs/CONFIGURATION.md                  # sibling P1.M2.T3.S1 edits this in parallel; adds inbound link to ./GROUNDSWELL_GUIDE.md#harness-system
docs/ARCHITECTURE.md, docs/INSTALLATION.md, docs/CLI_REFERENCE.md  # neighbor docs (read-only; See Also candidates; style reference)
src/config/harness.ts                  # CONSUME (read-only) — configureHarness(): the real startup call (Integration Example source)
src/config/constants.ts                # CONSUME (read-only) — DEFAULT_HARNESS='pi', DEFAULT_MODEL_PROVIDER='zai', SUPPORTED_HARNESSES
src/agents/agent-factory.ts            # CONSUME (read-only) — RESOLVED_HARNESS wiring (context only)
package.json                           # READ-ONLY — docs:lint / format:check / validate / fix script definitions
.prettierrc / .prettierignore          # READ-ONLY — prettier rules (enforced by format:check)
plan/003_b3d3efdaf0ed/docs/GROUNDSWELL_GUIDE.md  # STYLE REFERENCE ONLY (prior session; no harness content)
plan/004_439241a82c24/P1M2T3S2/research/context-and-validation.md  # THIS TASK'S RESEARCH NOTE
plan/004_439241a82c24/P1M2T3S1/research/validation-environment-and-baseline.md  # sibling validation research (same env)
plan/004_439241a82c24/architecture/external_deps.md    # Groundswell API surface (authoritative local ref)
plan/004_439241a82c24/architecture/implementation_notes.md  # §6 CREATE-not-edit; §1/§2 invariants
```

### Desired Codebase tree with files to be added

```bash
docs/GROUNDSWELL_GUIDE.md   # NEW FILE — focused guide: header + intro + TOC + Overview + ## Harness System (5 subsections mirroring PRD §9.4) + See Also
# No other files created or modified (docs/CONFIGURATION.md is owned by sibling P1.M2.T3.S1)
```

### Known Gotchas of our codebase & Library Quirks

```markdown
<!-- CRITICAL — this is a CREATE, not an edit. docs/GROUNDSWELL_GUIDE.md does NOT
     exist in hacky-hack/docs/ (confirmed by `ls`). The prior-session copy at
     plan/003_b3d3efdaf0ed/docs/GROUNDSWELL_GUIDE.md is a STYLE/TONE reference
     ONLY — it has ZERO harness content (the harness system is new in session 004).
     Do NOT copy its 1500-line body; borrow only its shell (header, blockquote,
     TOC, padded tables, code fences, See Also). See research §1/§7. -->

<!-- CRITICAL — the anchor contract. Sibling P1.M2.T3.S1 links to
     ./GROUNDSWELL_GUIDE.md#harness-system. The heading MUST be exactly
     '## Harness System' → GitHub slug '#harness-system'. Do NOT pluralize
     ('Harness Systems' → '#harness-systems' = broken link) or rename. Verify
     with: grep -n '## Harness System' docs/GROUNDSWELL_GUIDE.md -->

<!-- CRITICAL — use defaultModelProvider 'zai' (the project default), NOT
     'anthropic'. The Groundswell upstream harnesses.md example uses 'anthropic',
     but the PRP pipeline defaults to 'zai' (src/config/constants.ts
     DEFAULT_MODEL_PROVIDER='zai'; src/config/harness.ts passes
     defaultModelProvider: DEFAULT_MODEL_PROVIDER). Mirroring the upstream here
     would be a factual error. -->

<!-- CRITICAL — `npm run docs:lint` DOES NOT LINT in this environment. The
     `markdownlint` binary is NOT installed (not in node_modules/.bin, not in
     devDependencies). `npm run docs:lint` errors with "could not determine
     executable to run" at the PACKAGE level — a pre-existing env gap, NOT a
     content failure and NOT this task's job to fix. Authoritative gate =
     `npm run format:check` (prettier, installed). Equivalent content check =
     `npx markdownlint-cli2 docs/GROUNDSWELL_GUIDE.md` (auto-installs). See
     research §8 + sibling validation-environment-and-baseline.md §1. -->

<!-- CRITICAL — this is a NEW file with NO markdownlint baseline (unlike
     CONFIGURATION.md's 59-error baseline). Aim for the file to be as clean as
     feasible: the ONLY acceptable markdownlint violations are MD013/line-length
     on the two inherently-wide reference tables (§9.4.1 Supported Harnesses,
     §9.4.4 Capability Reference) — this matches every existing docs/ file's
     convention. There MUST BE ZERO of: MD024 (duplicate headings — make every
     heading + TOC entry unique), MD051 (broken anchors — verify every #anchor
     resolves), MD040 (fenced code without language — always use ```bash /
     ```typescript), MD009 (trailing space), MD012 (>1 blank line), MD033 (inline
     HTML), MD031/MD032 (blanks around fences/lists). Wrap PROSE at ~80 cols
     (prettier does NOT reflow markdown prose). See research §8. -->

<!-- GOTCHA — prettier REFORMATS markdown tables to its own column alignment and
     does NOT reflow prose. After writing, run `npm run fix` (lint:fix +
     prettier --write) so prettier aligns the new table columns, THEN run
     `npm run format:check`. Do NOT hand-align table columns; let prettier own
     them. Manually wrap prose lines at ~80 to keep MD013 low where natural. -->

<!-- GOTCHA — the model string is NEVER harness-qualified. `pi/zai/GLM-4.7` is
     INVALID (PRD §9.4.3; Groundswell parseModelSpec THROWS on 3-segment strings
     per external_deps.md §3). Always `provider/model` (e.g. `zai/GLM-4.7`).
     State this plainly in Critical Rules with the invalid examples. -->

<!-- GOTCHA — claude-code is Anthropic-ONLY and incompatible with the z.ai
     provider (PRD §9.2.4/§9.4.3). configureHarnesses() does NOT validate
     defaultModelProvider (open set), so the PRP pipeline owns this rule and
     rejects it at startup via HarnessProviderMismatchError (src/config/harness.ts).
     State the fail-fast behavior and cross-reference PRD §9.2.4. -->

<!-- GOTCHA — feature parity is a hard invariant, not aspirational. Tools
     execute locally through MCPHandler for BOTH harnesses (PRD §9.3.3), so pi's
     lack of built-in MCP/LSP is NOT a capability gap. State this in Critical
     Rules (§9.4.3 rule 3) and reflect it in the Capability Reference table
     (MCP: pi = via MCPHandler; claude-code = built-in AND via MCPHandler). -->

<!-- GOTCHA — cache keys incorporate BOTH the harness and the provider/model
     (§9.4.3 rule 4). This is why switching harness or provider is cache-safe.
     State it as the 4th critical rule. -->

<!-- GOTCHA — header convention for a NEW doc: Version 1.0.0 (not a bump from
     an existing file), Last Updated 2026-06-20 (current date), Status Published.
     Match the prior guide's header shape (bold labels). -->

<!-- GOTCHA — do NOT recreate the comprehensive 1500-line guide. Scope (2 points)
     is the Harness System. Ship the focused layout (Overview + Harness System +
     See Also). Future tasks can add Workflow/Agent/MCP/Caching sections. -->

<!-- GOTCHA — reciprocal cross-link. See Also MUST link back to ./CONFIGURATION.md
     (sibling S1 owns it; it links here). Also link neighbor docs and the
     Groundswell upstream (~/projects/groundswell/README.md,
     ~/projects/groundswell/docs/harnesses.md). Use relative paths for repo docs. -->
```

---

## Implementation Blueprint

### Data models and structure

None. This is a documentation CREATE; there are no data models, schemas, or types.
The only "structure" is the markdown document's section layout (the structure
tree under **What**) and the verbatim payloads (PRD §9.4 tables + the
`configureHarnesses()` snippet).

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: READ the authoritative sources (content + code + style)
  - READ: PRD §9.4 (§9.4.1–§9.4.4) — the content source (in the PRP's selected_prd_content).
  - READ: plan/004_439241a82c24/architecture/external_deps.md (§1–§6) — Groundswell API
    surface verbatim (configureHarnesses, HarnessId, HarnessOptions, parseModelSpec,
    registerDefaultHarnesses, PiHarness/ClaudeCodeHarness).
  - READ: plan/004_439241a82c24/architecture/implementation_notes.md §6 (CREATE not edit),
    §1 (compatibility check location), §2 (model-string invariant).
  - READ: src/config/harness.ts (the real configureHarness() startup call — Integration
    Example source) and src/config/constants.ts (DEFAULT_HARNESS='pi',
    DEFAULT_MODEL_PROVIDER='zai', SUPPORTED_HARNESSES).
  - SKIM: plan/003_b3d3efdaf0ed/docs/GROUNDSWELL_GUIDE.md header + a section + See Also
    (tone/structure ONLY — it has no harness content).
  - CONFIRM: docs/GROUNDSWELL_GUIDE.md does not exist (ls). Confirm sibling cross-link
    target (#harness-system) in plan/004_439241a82c24/P1M2T3S1/PRP.md.

Task 2: CREATE docs/GROUNDSWELL_GUIDE.md — header + intro + TOC + Overview
  - WRITE: '# Groundswell Guide' H1.
  - WRITE: a one-sentence '> ' blockquote intro describing what the guide covers.
  - WRITE: header block — **Status**: Published / **Last Updated**: 2026-06-20 /
    **Version**: 1.0.0.
  - WRITE: '## Table of Contents' with anchor links to #overview, #harness-system,
    #supported-harnesses, #configuration, #critical-rules, #capability-reference,
    #integration-example, #see-also (verify each slug matches its heading).
  - WRITE: '## Overview' — 1–2 paragraphs: Groundswell is the workflow/agent
    orchestration engine; the harness is the pluggable agent runtime, orthogonal to
    the LLM provider; link the Groundswell upstream readme.

Task 3: CREATE ## Harness System (the core — anchor #harness-system)
  - WRITE: '## Harness System' (EXACT heading — slug must be #harness-system; this is
    the cross-link target). One-sentence intro citing PRD §9.4.
  - WRITE: '### Supported Harnesses' (§9.4.1) — a padded pipe table with columns
    Harness | SDK / Package | Default? | Notes. Rows:
      * `pi` | Pi SDK — `@earendil-works/pi-coding-agent` (pi.dev) | **Yes** |
        Vendor-neutral runtime; runs any LLM provider (incl. z.ai). MCP, Skills, and
        LSP supplied by Groundswell's MCPHandler.
      * `claude-code` | Claude Code SDK — `@anthropic-ai/claude-agent-sdk` | No (optional) |
        Anthropic-only models. Incompatible with the z.ai provider (PRD §9.2.4).
        Parity-maintained fallback for users locked into Anthropic's ecosystem.
    Add the "Default selection" note: PRP_AGENT_HARNESS defaults to `pi` (the only
    harness compatible with the default z.ai provider + the §9.2.4 cost safeguard).

Task 4: CREATE ### Configuration (§9.4.2)
  - WRITE: a `typescript` fenced code block (MUST have language tag — MD040):
        import { configureHarnesses } from 'groundswell';
        configureHarnesses({
          defaultHarness: 'pi',              // vendor-neutral default (pi.dev)
          defaultModelProvider: 'zai',       // LLM host — INDEPENDENT of the harness
          harnessDefaults: {
            'claude-code': { apiKey: process.env.ANTHROPIC_API_KEY },
          },
        });
  - WRITE: bullet list —
      * PRP_AGENT_HARNESS (`pi` | `claude-code`, default `pi`): selects the runtime.
      * The harness and the provider/model are selected INDEPENDENTLY.
      * Harness selection cascades: global default → agent config → prompt overrides.
      * Harness-specific options (e.g. skillsDirs on pi) MAY extend the base HarnessOptions.
  - NOTE: call configureHarnesses() ONCE at startup, after configureEnvironment()
    (maps ANTHROPIC_AUTH_TOKEN → ANTHROPIC_API_KEY so the harnessDefaults apiKey binds).

Task 5: CREATE ### Critical Rules (§9.4.3) — four bullets (verbatim intent)
  - BULLET 1: The harness NEVER appears in the model string. `pi/zai/GLM-4.7` and
    `cc/anthropic/...` are INVALID. Always use `provider/model` (e.g. `zai/GLM-4.7`).
    (Groundswell parseModelSpec throws on 3-segment strings.)
  - BULLET 2: Provider/harness compatibility. `claude-code` runs `anthropic/*` models
    ONLY. Requesting the z.ai provider on `claude-code` is a configuration error
    surfaced at initialize()/execute() — the PRP pipeline rejects it at startup
    (HarnessProviderMismatchError). Cross-ref PRD §9.2.4.
  - BULLET 3: Feature parity. All features (MCP tools, skills, hooks, AgentResponse,
    caching, workflow events) work identically across both harnesses. Tool execution
    flows through MCPHandler for both, so pi's lack of built-in MCP/LSP is NOT a
    capability gap.
  - BULLET 4: Cache isolation. Cache keys incorporate BOTH the harness and the
    provider/model.

Task 6: CREATE ### Capability Reference (§9.4.4) — padded pipe matrix
  - WRITE: a table with columns Capability | `pi` | `claude-code`. Rows (per PRD §9.4.4):
      * MCP               | via Groundswell MCPHandler        | built-in AND via MCPHandler
      * Skills            | ✓ native (agentskills.io; loads ~/.claude/skills) | ✓ native (system prompt)
      * LSP               | via MCP plugins through MCPHandler | via MCP plugins
      * Streaming         | ✓                                 | ✓
      * Sessions          | ✓                                 | ✓
      * Extended Thinking | ✓                                 | ✓
      * LLM providers     | any                               | Anthropic only

Task 7: CREATE ### Integration Example (the PRP startup call)
  - WRITE: a short intro: at startup the PRP pipeline calls configureHarnesses() once,
    via src/config/harness.ts's configureHarness(), after configureEnvironment().
  - WRITE: a `typescript` block showing the effective call (defaultHarness from
    PRP_AGENT_HARNESS ?? 'pi'; defaultModelProvider 'zai'; harnessDefaults for
    claude-code) — mirror src/config/harness.ts.
  - WRITE: a `bash` block showing the env var: `# PRP_AGENT_HARNESS=pi` (default;
    claude-code requires anthropic/* models).
  - CROSS-LINK: "For the env-var/override details, see
    [Configuration](./CONFIGURATION.md)."

Task 8: CREATE ## See Also (reciprocal cross-links)
  - WRITE: a bulleted list with relative links:
      * **[Configuration](./CONFIGURATION.md)** — Environment variables, model
        overrides, and the PRP_AGENT_HARNESS env var (sibling P1.M2.T3.S1).
      * **[Architecture](./ARCHITECTURE.md)** — High-level system architecture.
      * **[Installation](./INSTALLATION.md)** — Setup incl. Groundswell linking.
      * **[Groundswell Harnesses](~/projects/groundswell/docs/harnesses.md)** —
        Upstream authoritative harness reference.
      * **[Groundswell README](~/projects/groundswell/README.md)** — Official docs.
  - VERIFY: every relative link target exists (./CONFIGURATION.md, ./ARCHITECTURE.md,
    ./INSTALLATION.md all present in docs/).

Task 9: FORMAT + VERIFY (the validation gate — research §8)
  - RUN: `npm run fix`            # lint:fix + prettier --write (aligns the new tables)
  - RUN: `npm run format:check`  # MUST be green (authoritative, installed gate)
  - RUN: `npm run validate`      # MUST be green (only format:check is relevant for .md)
  - RUN: `npx markdownlint-cli2 docs/GROUNDSWELL_GUIDE.md`  # expect ONLY MD013 on the
        two wide tables; ZERO MD024/MD051/MD040/MD009/MD012/MD031/MD032/MD033. Fix any
        non-MD013 violation (it is avoidable for a new file).
  - DO NOT run `npm run docs:lint` as the gate — markdownlint binary is not installed;
        it errors at the package level (pre-existing gap, out of scope).
  - VERIFY anchor: `grep -n '## Harness System' docs/GROUNDSWELL_GUIDE.md` and confirm
        the slug is #harness-system (sibling cross-link target).
  - EXPECTED: format:check + validate green; markdownlint shows only MD013 on wide tables.
```

### Implementation Patterns & Key Details

```markdown
<!-- DOCUMENT SHELL — borrow the prior guide's header shape. Keep prose wrapped ~80. -->

# Groundswell Guide

> Guide to the Groundswell integration in the PRP Pipeline — focusing on the
> pluggable agent **harness** system (the runtime that drives prompting, tool
> execution, and streaming), which is selected independently of the LLM provider.

**Status**: Published
**Last Updated**: 2026-06-20
**Version**: 1.0.0

## Table of Contents

- [Overview](#overview)
- [Harness System](#harness-system)
  - [Supported Harnesses](#supported-harnesses)
  - [Configuration](#configuration)
  - [Critical Rules](#critical-rules)
  - [Capability Reference](#capability-reference)
  - [Integration Example](#integration-example)
- [See Also](#see-also)
```

````markdown
<!-- THE CORE SECTION — heading slug MUST be #harness-system (cross-link target). -->

## Harness System

The **harness** is the agent runtime/SDK that drives prompting, tool execution,
and streaming. It is **orthogonal** to the LLM **provider/model** — the two are
selected independently (see [Configuration](#configuration)). Mirrors PRD §9.4;
see the upstream [Groundswell Harnesses](~/projects/groundswell/docs/harnesses.md)
reference for full detail.

### Supported Harnesses

| Harness       | SDK / Package                                       | Default?      | Notes                                                                                                                                  |
| ------------- | --------------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `pi`          | Pi SDK — `@earendil-works/pi-coding-agent` (pi.dev) | **Yes**       | Vendor-neutral runtime; runs any LLM provider (incl. z.ai). MCP, Skills, and LSP supplied by Groundswell's `MCPHandler`.               |
| `claude-code` | Claude Code SDK — `@anthropic-ai/claude-agent-sdk`  | No (optional) | Anthropic-only models. Incompatible with the z.ai provider (PRD §9.2.4). Retained as a parity-maintained fallback for Anthropic users. |

**Default selection.** `PRP_AGENT_HARNESS` defaults to `pi`. This is the only
harness compatible with the project's default z.ai provider and the §9.2.4 cost
safeguard.

### Configuration

```ts
import { configureHarnesses } from 'groundswell';

configureHarnesses({
  defaultHarness: 'pi', // vendor-neutral default (pi.dev)
  defaultModelProvider: 'zai', // LLM host — INDEPENDENT of the harness
  harnessDefaults: {
    'claude-code': { apiKey: process.env.ANTHROPIC_API_KEY },
  },
});
```

- **`PRP_AGENT_HARNESS`** (`pi` | `claude-code`, default `pi`): selects the runtime.
- The harness and the provider/model are selected **independently**.
- Harness selection cascades: global default → agent config → prompt overrides.
- Harness-specific options (e.g. `skillsDirs` on `pi`) MAY extend the base
  `HarnessOptions`.

Call `configureHarnesses()` **once** at startup, after `configureEnvironment()`
(which maps `ANTHROPIC_AUTH_TOKEN` → `ANTHROPIC_API_KEY` so the `harnessDefaults`
apiKey binding is populated).

### Critical Rules

- **The harness never appears in the model string.** `pi/zai/GLM-4.7` and
  `cc/anthropic/...` are **invalid**. Always use `provider/model`
  (e.g. `zai/GLM-4.7`). (Groundswell's `parseModelSpec` throws on 3-segment strings.)
- **Provider/harness compatibility.** `claude-code` runs `anthropic/*` models only.
  Requesting the z.ai provider on `claude-code` is a configuration error surfaced
  at `initialize()`/`execute()`; the PRP pipeline rejects it at startup
  (`HarnessProviderMismatchError`). See PRD §9.2.4.
- **Feature parity.** All features (MCP tools, skills, hooks, `AgentResponse`,
  caching, workflow events) work identically across both harnesses. Tool execution
  flows through `MCPHandler` for both, so `pi`'s lack of built-in MCP/LSP is **not**
  a capability gap.
- **Cache isolation.** Cache keys incorporate **both** the harness and the
  provider/model.

### Capability Reference

| Capability        | `pi`                                                | `claude-code`                     |
| ----------------- | --------------------------------------------------- | --------------------------------- |
| MCP               | via Groundswell `MCPHandler`                        | built-in **and** via `MCPHandler` |
| Skills            | ✓ native (agentskills.io; loads `~/.claude/skills`) | ✓ native (system prompt)          |
| LSP               | via MCP plugins through `MCPHandler`                | via MCP plugins                   |
| Streaming         | ✓                                                   | ✓                                 |
| Sessions          | ✓                                                   | ✓                                 |
| Extended Thinking | ✓                                                   | ✓                                 |
| LLM providers     | any                                                 | Anthropic only                    |

### Integration Example

At startup the PRP pipeline calls `configureHarnesses()` once (via
`src/config/harness.ts`'s `configureHarness()`), after `configureEnvironment()`:

```ts
// src/config/harness.ts (effective behavior)
const harness = (process.env.PRP_AGENT_HARNESS ?? 'pi') as 'pi' | 'claude-code';
// claude-code + zai is rejected here with HarnessProviderMismatchError
configureHarnesses({
  defaultHarness: harness,
  defaultModelProvider: 'zai',
  harnessDefaults: {
    'claude-code': { apiKey: process.env.ANTHROPIC_API_KEY },
  },
});
```

```bash
# .env — agent runtime (optional; defaults to pi)
# PRP_AGENT_HARNESS=pi
# NOTE: claude-code requires anthropic/* models (incompatible with the z.ai provider).
```

For the env-var and model-override details, see
[Configuration](./CONFIGURATION.md).
````

```markdown
<!-- SEE ALSO — reciprocal links. ./CONFIGURATION.md is the inbound-link source. -->

## See Also

- **[Configuration](./CONFIGURATION.md)** - Environment variables, model overrides,
  and the `PRP_AGENT_HARNESS` env var
- **[Architecture](./ARCHITECTURE.md)** - High-level system architecture and design
- **[Installation](./INSTALLATION.md)** - Setup instructions incl. Groundswell linking
- **[Groundswell Harnesses](~/projects/groundswell/docs/harnesses.md)** - Upstream
  authoritative harness reference
- **[Groundswell README](~/projects/groundswell/README.md)** - Official Groundswell docs
```

### Integration Points

```yaml
DOCUMENTATION (docs/GROUNDSWELL_GUIDE.md — the ONLY file created):
  - NEW FILE at docs/GROUNDSWELL_GUIDE.md (does not exist today)
  - header:       Status Published / Last Updated 2026-06-20 / Version 1.0.0
  - TOC:          anchors #overview, #harness-system, #supported-harnesses,
                  #configuration, #critical-rules, #capability-reference,
                  #integration-example, #see-also (all must resolve — MD051)
  - Overview:     1–2 paragraphs + upstream link
  - Harness Sys:  ## Harness System (slug #harness-system) + 5 subsections (PRD §9.4)
  - See Also:     reciprocal links incl. ./CONFIGURATION.md

CROSS-LINKS (satisfy inbound + reciprocate outbound):
  - INBOUND (from sibling P1.M2.T3.S1, implemented in parallel):
      ./GROUNDSWELL_GUIDE.md#harness-system   ← MUST resolve (## Harness System)
  - OUTBOUND (this task):
      ./CONFIGURATION.md     (See Also + Integration Example)
      ./ARCHITECTURE.md      (See Also)
      ./INSTALLATION.md      (See Also)
      ~/projects/groundswell/docs/harnesses.md  (See Also + prose)
      ~/projects/groundswell/README.md          (See Also + Overview)

NO CHANGES TO (hard boundary):
  - src/**, tests/**, package.json, .env.example, .prettierrc, tsconfig*, any other file
  - docs/CONFIGURATION.md (owned by sibling P1.M2.T3.S1 — do NOT edit/duplicate)
  - PRD.md, plan/**, tasks.json (read-only / protected)
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Format the new file (prettier owns markdown table alignment; does NOT reflow prose).
npm run fix                       # = lint:fix (ts only) + prettier --write (incl. *.md)

# Authoritative installed gate — MUST be green.
npm run format:check              # prettier --check "**/*.{ts,js,json,md,yml,yaml}"
npm run validate                  # = lint && format:check && typecheck (only format:check matters for .md)

# Targeted (faster feedback on just the new file):
npx prettier --check docs/GROUNDSWELL_GUIDE.md

# Expected: Zero errors. format:check must pass. If it fails after writing, re-run
# `npm run fix` and let prettier re-align the new tables.
```

### Level 2: Markdown Lint Content Check (equivalent, no-install)

```bash
# `npm run docs:lint` references the `markdownlint` binary, which is NOT installed
# in this environment (errors at the package level — pre-existing gap, out of scope).
# Use markdownlint-cli2 (auto-installs) for the equivalent content check:
npx markdownlint-cli2 docs/GROUNDSWELL_GUIDE.md

# EXPECTED for a NEW file (no baseline): the ONLY acceptable violations are
# MD013/line-length on the two inherently-wide reference tables (Supported
# Harnesses, Capability Reference) — this matches every existing docs/ file's
# convention. CRITICAL: there must be ZERO violations of every other rule:
#   - no MD024/no-duplicate-heading  (every heading + TOC entry unique)
#   - no MD051/link-fragments        (every #anchor resolves; verify #harness-system)
#   - no MD040/fenced-code-language  (every ``` fence has bash/typescript)
#   - no MD009/trailing-space, MD012/multiple-blanks, MD033/inline-html,
#     MD031/blanks-around-fences, MD032/blanks-around-lists
# An MD013 count from the two wide tables is acceptable; any OTHER rule violation
# is avoidable for a new file and MUST be fixed before completion.
```

### Level 3: Manual / Render + Anchor Verification (System Validation)

```bash
# Anchor contract (the cross-link target — HARD requirement):
grep -n '## Harness System' docs/GROUNDSWELL_GUIDE.md
#   → must print the heading; GitHub slug = #harness-system (sibling links here).

# TOC + cross-link resolution (no MD051):
grep -nE '\]\(#' docs/GROUNDSWELL_GUIDE.md          # every (#anchor) must match a heading
grep -nE '\]\(\./' docs/GROUNDSWELL_GUIDE.md        # every ./relative link target must exist:
ls docs/CONFIGURATION.md docs/ARCHITECTURE.md docs/INSTALLATION.md   # all must exist

# Render sanity: open docs/GROUNDSWELL_GUIDE.md in a markdown previewer (or GitHub view)
# and confirm:
#   1. ## Harness System renders and the sibling's #harness-system link jumps to it.
#   2. The TOC entries all resolve to their subsections.
#   3. The Supported Harnesses + Capability Reference tables render cleanly.
#   4. The configureHarnesses() typescript block + the .env bash block render.
#   5. See Also links (./CONFIGURATION.md etc.) are valid relative links.

# No service to start, no DB, no network — documentation-only subtask.
# Expected: all render checks pass; no broken anchors; header shows Version 1.0.0.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Documentation correctness review (record in commit message):
#   1. Every value matches the IMPLEMENTED code:
#        defaultHarness 'pi'; defaultModelProvider 'zai' (NOT 'anthropic');
#        SUPPORTED_HARNESSES ['pi','claude-code']; models are 'provider/model'
#        (e.g. 'zai/GLM-4.7'); claude-code+z.ai rejected at startup.
#      (Cross-check src/config/harness.ts + src/config/constants.ts.)
#   2. All five payloads present: Supported Harnesses (§9.4.1), Configuration
#      (§9.4.2), Critical Rules (§9.4.3 — all four), Capability Reference (§9.4.4),
#      Integration Example.
#   3. No claim contradicts PRD §9.2.4 / §9.3.3 / §9.4.1–§9.4.4.
#   4. No duplication of CONFIGURATION.md's env-var detail (this guide is the SYSTEM
#      overview; env-var specifics live in CONFIGURATION.md and are cross-linked).
#   5. Scope discipline: no source/test/.env.example/package.json edits; focused
#      guide (not a 1500-line recreation).
```

---

## Final Validation Checklist

### Technical Validation

- [ ] `npm run format:check` exits 0 (authoritative, installed gate).
- [ ] `npm run validate` exits 0 (only `format:check` is relevant for the `.md` change).
- [ ] `npx markdownlint-cli2 docs/GROUNDSWELL_GUIDE.md` shows **only** MD013 on the
      two wide reference tables; **zero** MD024/MD051/MD040/MD009/MD012/MD031/MD032/MD033.
- [ ] `npm run docs:lint` is **not** required to pass (markdownlint binary not
      installed — pre-existing env gap; documented and out of scope).

### Feature Validation

- [ ] `docs/GROUNDSWELL_GUIDE.md` exists at the repo path (`docs/`).
- [ ] Contains `## Harness System` (slug `#harness-system` — verified by grep).
- [ ] **Supported Harnesses** (§9.4.1): `pi` default + `claude-code` optional table
      with Notes + "Default selection" note.
- [ ] **Configuration** (§9.4.2): `configureHarnesses({ defaultHarness:'pi',
      defaultModelProvider:'zai', harnessDefaults })` block + `PRP_AGENT_HARNESS` +
      cascade + independence.
- [ ] **Critical Rules** (§9.4.3): all four bullets (model-string, claude-code
      Anthropic-only, feature parity via MCPHandler, cache isolation).
- [ ] **Capability Reference** (§9.4.4): MCP/Skills/LSP/Streaming/Sessions/Extended
      Thinking/LLM providers matrix.
- [ ] **Integration Example**: the PRP startup call (mirrors `src/config/harness.ts`).
- [ ] Reciprocal cross-link to `./CONFIGURATION.md` present (See Also + example).
- [ ] All values consistent with `src/config/harness.ts` + `src/config/constants.ts`.

### Code Quality Validation

- [ ] Matches existing `docs/` style (header block, blockquote intro, padded pipe
      tables, fenced code with language tags, See Also relative links).
- [ ] Every heading + TOC entry unique (no MD024); every `#anchor` resolves (no MD051).
- [ ] Every code fence has a language tag (no MD040).
- [ ] No content duplicated from CONFIGURATION.md (system overview vs env-var focus).
- [ ] No source/test/`.env.example`/`package.json`/config files modified.

### Documentation & Deployment

- [ ] Commit message documents: the new file; the five payloads; the `#harness-system`
      cross-link contract with sibling P1.M2.T3.S1; the validation caveat
      (`docs:lint` binary not installed → relied on `format:check` +
      `npx markdownlint-cli2`, expecting only MD013 on wide tables).
- [ ] No new env vars introduced (documents existing `PRP_AGENT_HARNESS` only).

---

## Anti-Patterns to Avoid

- ❌ Don't run `npm run docs:lint` and treat its failure as a content failure — the
  `markdownlint` binary is **not installed**; it errors at the package level. Use
  `npm run format:check` (authoritative) + `npx markdownlint-cli2` (equivalent). See
  research §8.
- ❌ Don't aim for "no worse than a baseline" — this is a **NEW** file with no
  baseline. The only acceptable markdownlint violations are MD013 on the two wide
  reference tables; every other rule violation is avoidable and MUST be fixed.
- ❌ Don't hand-align markdown table columns — let `npm run fix` (prettier) own table
  formatting. Manually wrap prose at ~80 (prettier won't reflow prose).
- ❌ Don't pluralize/rename `## Harness System` — the slug MUST be `#harness-system`
  (sibling P1.M2.T3.S1 links here). `## Harness Systems` → `#harness-systems` = broken.
- ❌ Don't use `defaultModelProvider: 'anthropic'` — the project default is `'zai'`
  (src/config/constants.ts / harness.ts). The Groundswell upstream example uses
  `'anthropic'`; mirroring it here is a factual error.
- ❌ Don't recreate the comprehensive 1500-line guide from
  `plan/003_b3d3efdaf0ed/docs/GROUNDSWELL_GUIDE.md` — that's scope creep (2-point
  task) and stale vs session 004. Use it for TONE/SHELL only; it has no harness content.
- ❌ Don't copy the prior guide's body verbatim — it documents a pre-harness system.
  All harness content comes from PRD §9.4 + the implemented code.
- ❌ Don't duplicate CONFIGURATION.md's env-var/override detail — this guide is the
  SYSTEM overview (capability matrix, configureHarnesses semantics, parity rules,
  the why). Cross-link to CONFIGURATION.md for env-var specifics.
- ❌ Don't omit a code-fence language — every ` ``` ` needs `bash`/`typescript`
  (MD040). The new file should have zero avoidable lint violations.
- ❌ Don't edit `src/**`, `tests/**`, `docs/CONFIGURATION.md`, `.env.example`,
  `package.json`, or any config — this is a **documentation-only CREATE**.
- ❌ Don't invent values — mirror the IMPLEMENTED code exactly (`pi` default,
  `zai` provider, `['pi','claude-code']`, `provider/model` models) and the PRD
  wording (§9.4.1–§9.4.4, §9.2.4, §9.3.3).
- ❌ Don't soften the claude-code↔z.ai incompatibility or the "harness never in the
  model string" rule — both are hard invariants (§9.4.3/§9.2.4) enforced at startup;
  the doc must state them plainly with the invalid examples.

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: This is a single-file, additive, documentation-only CREATE whose
content is fully specified. The authoritative content source (PRD §9.4.1–§9.4.4)
is included verbatim in the PRP's selected context, and every value to mirror is
sourced from the read-only implemented code (`src/config/harness.ts`,
`src/config/constants.ts`) and cross-checked against `architecture/external_deps.md`
+ `implementation_notes.md` §6. The exact document layout, the verbatim markdown
for each subsection (header shell, the two reference tables, the
`configureHarnesses()` snippet, the four critical-rule bullets, the integration
example, See Also), and the anchor contract (`## Harness System` →
`#harness-system`) are all spelled out in Implementation Patterns. The genuinely
non-obvious risks are fully mitigated: (1) `npm run docs:lint` failing because
`markdownlint` is not installed — documented as a pre-existing gap with an
unambiguous alternative (`format:check` authoritative; `markdownlint-cli2` for the
content check); (2) the new-file markdownlint expectation (only MD013 on wide
tables acceptable) is stated precisely; (3) the `defaultModelProvider: 'zai'`
divergence from the upstream's `'anthropic'` example is called out; (4) the
sibling cross-link boundary (CONFIGURATION.md is owned by P1.M2.T3.S1) is explicit
and the inbound `#harness-system` link is the hard anchor requirement. The only
residual risk is a minor anchor/lint nit, which the Level 1–3 gates (prettier +
markdownlint-cli2 + grep anchor verification) will catch and which `npm run fix`
resolves automatically.
