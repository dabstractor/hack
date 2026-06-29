---
name: "P7.M1.T4.S2 — docs/ARCHITECTURE.md: refresh top-level capability framing (Anthropic-only / worker-thread logging) [Mode B]"
description: |
  Mode B (changeset-level) documentation task — the FINAL docs sweep for the P7.M1 auth & logging
  hardening changeset, scoped to `docs/ARCHITECTURE.md` (917 lines, last-updated 2026-01-23). The doc
  has ONE stale capability example: the `### Agent Creation` code block (L348-367) hardcodes
  `apiKey: process.env.ANTHROPIC_API_KEY!` + `model: 'claude-opus-4-5-20251101'`, implying Anthropic is
  the only provider (check a) AND omitting the harness/provider orthogonality that PRD §9.4 mandates
  (check c — the doc never mentions `pi`, `zai`, `harness`, or `configureHarnesses` at all). The
  SHIPPED model (P7.M1.T2: `src/config/harness.ts` + `src/config/constants.ts`) is provider-agnostic
  (`pi` default harness + `zai` default provider, auth resolved via override → provider env var →
  `~/.pi/agent/auth.json`). The logging half (check b) is a VERIFIED NO-OP: zero worker-thread /
  transport / pino framing exists in the doc (documented finding per the work item OUTPUT §4). This
  task rewrites ONLY the Agent Creation block to the canonical provider-aware `configureHarnesses()`
  example (mirroring `docs/GROUNDSWELL_GUIDE.md`), lightly refreshes the External References section,
  and records the logging no-op finding. It does NOT touch any other `docs/*.md`, `README.md`
  (T4.S1 owns it, running in parallel), `.env.example`, `PRD.md`, `PROMPTS.md`, or any `src/` file.
---

## Goal

**Feature Goal**: `docs/ARCHITECTURE.md` stops presenting Anthropic as the only provider/auth in its
sole capability code example, and instead presents the **shipped** provider-agnostic model: the
`pi` harness + `zai` provider are selected **independently** via `configureHarnesses()`; the model
string is provider-qualified (`zai/glm-5.2`, never harness-qualified); auth is provider-aware. The
logging half is confirmed free of worker-thread framing (no edit).

**Deliverable**: A modified `docs/ARCHITECTURE.md` (only file touched) whose `### Agent Creation`
block (L348-367) is rewritten to the canonical provider-aware `configureHarnesses()` +
`createAgent({ model: 'zai/glm-5.2' })` example with a short harness/provider-orthogonality note, and
whose `### External References` section (L906-912) no longer lists Anthropic as the sole LLM API
reference. No logging edit is made (verified no-op). No other file is modified.

**Success Definition** (maps 1:1 to the work-item OUTPUT/LOGIC, checks a/b/c):
- Check **(a)** — No code example or framing in `docs/ARCHITECTURE.md` implies Anthropic is the
  primary/only provider: `ANTHROPIC_API_KEY!` and `claude-opus-4-5-20251101` are gone from the Agent
  Creation block; the model is `zai/glm-5.2`; Anthropic appears only as the optional `claude-code` /
  `anthropic` path.
- Check **(b)** — Logging no-op: `rg -ni 'pino|transport|worker.?thread|threadstream|async.?log' docs/ARCHITECTURE.md`
  returns zero hits (confirmed; no edit made; finding recorded).
- Check **(c)** — Harness/provider orthogonality is now present: `pi` (default harness), `zai`
  (default provider), `configureHarnesses`, and `PRP_AGENT_HARNESS` appear in the rewritten block with
  a link to the canonical `docs/GROUNDSWELL_GUIDE.md`.
- `npx markdownlint docs/ARCHITECTURE.md` and `npx prettier --check docs/ARCHITECTURE.md` both still
  pass (BOTH are enforced gates for this file — unlike the README).

## User Persona (if applicable)

**Target User**: A developer / contributor reading `docs/ARCHITECTURE.md` to understand how agents are
constructed and configured. Today the ONLY code example tells them to pass `ANTHROPIC_API_KEY` and a
`claude-opus-*` model — which is **wrong for the default `pi` + `zai` path** and omits the harness
selection that PRD §9.4 makes central. This task makes the architecture doc's one capability example
match the shipped runtime.

**Use Case**: Onboarding — "how does the pipeline create an agent and select its runtime/provider?"

**Pain Points Addressed**: (1) The doc's lone agent-creation example describes a non-default path as
if it were the only one; (2) the doc never surfaces the harness/provider independence that is core to
the project's vendor-neutral design (PRD §9.4 / §9.1).

## Why

- **Correctness / onboarding accuracy.** `docs/ARCHITECTURE.md` is the canonical architecture overview
  and the only doc that shows a `createAgent` code example. That example must reflect the shipped
  provider-agnostic runtime (P7.M1.T2) and the harness/provider orthogonality (PRD §9.4), or
  contributors copy a stale Anthropic-only pattern.
- **Cohesion across the changeset.** `docs/GROUNDSWELL_GUIDE.md`, `docs/CONFIGURATION.md`, and
  `docs/INSTALLATION.md` were already updated to the `pi` + `zai` default. ARCHITECTURE.md is the last
  capability-level doc still showing the bypassed Anthropic-shell convention. (T4.S1 owns the root
  `README.md` in parallel; this task must agree with, and not duplicate, that work.)
- **No harm to future work.** Docs-only, scoped to ONE file, structure preserved (no new sections).
  Logging is explicitly out of edit scope (verified no-op), preventing over-specification.

## What

Rewrite the single stale capability example to match the shipped provider-agnostic model, lightly
refresh the External References, and record the logging no-op. Concretely:

1. **`### Agent Creation` block (L348-367)** — DROP `apiKey: process.env.ANTHROPIC_API_KEY!` and
   `model: 'claude-opus-4-5-20251101'` from `createAgent`. Replace the example with the canonical
   `configureHarnesses({ defaultHarness: 'pi', defaultModelProvider: 'zai', harnessDefaults: {
   'claude-code': {...} } })` + `createAgent({ model: 'zai/glm-5.2', ... })` pattern, mirroring
   `docs/GROUNDSWELL_GUIDE.md`. Add a 1-3 line note stating the harness and provider/model are
   selected **independently** and linking to `./GROUNDSWELL_GUIDE.md` (and optionally `../PRD.md` §9.4).
2. **`### External References` (L906-912)** — Reframe the "Anthropic Claude API" line as the optional
   `anthropic` provider / `claude-code` harness path; do NOT fabricate a z.ai URL (prefer an in-repo
   link to `./CONFIGURATION.md`). Leave the Groundswell URL as-is unless it demonstrably 404s.
3. **Logging (check b)** — No edit. VERIFY `rg -ni 'pino|transport|worker.?thread|threadstream|async.?log'`
  returns zero hits (it does) and record the finding. Do NOT add a logging-architecture section.

### Success Criteria

- [ ] `rg -n 'ANTHROPIC_API_KEY!|claude-opus' docs/ARCHITECTURE.md` returns **ZERO** hits.
- [ ] `rg -n "model: 'zai/glm-5.2'|configureHarnesses|defaultHarness: 'pi'|defaultModelProvider: 'zai'" docs/ARCHITECTURE.md`
      returns hits inside the rewritten Agent Creation block.
- [ ] `rg -n '\bpi\b|\bzai\b|harness|provider' docs/ARCHITECTURE.md` is **non-empty** (was empty before —
      cures the check-(c) omission).
- [ ] `rg -ni 'pino|transport|worker.?thread|threadstream|async.?log' docs/ARCHITECTURE.md` returns
      **ZERO** hits (logging no-op verified).
- [ ] `npx markdownlint docs/ARCHITECTURE.md` passes (exit 0).
- [ ] `npx prettier --check docs/ARCHITECTURE.md` passes.
- [ ] Every link target in the doc resolves to an existing file.

## All Needed Context

### Context Completeness Check

_Before writing this PRP, validate: "If someone knew nothing about this codebase, would they have
everything needed to implement this successfully?"_ — **YES.** This PRP pins the exact stale line
range, the exact current text, the exact canonical replacement (with the in-repo source file + line
anchors), the exact shipped env-var/model literals, the validation-tooling reality (both gates), and
the exact grep assertions. No codebase intuition required.

### Documentation & References

```yaml
# MUST READ — the file under edit + the canonical sources to mirror + the shipped behavior
- file: docs/ARCHITECTURE.md
  why: "THE TARGET FILE (917 lines). Read it fully before editing. Stale location: the
        `### Agent Creation` code block L348-367 (apiKey: process.env.ANTHROPIC_API_KEY! +
        model: 'claude-opus-4-5-20251101'). Secondary: `### External References` L906-912."
  pattern: "Existing section style: '## Groundswell Framework Integration' > '### @Workflow Decorator'
            > '### @Step Decorator' > '### @ObservedState Pattern' > '### Agent Creation' >
            '### Tool Registration' > '### Groundswell Caching'. Preserve this order & heading depth."
  gotcha: "This file IS covered by BOTH `npm run docs:lint` (markdownlint docs/**/*.md) AND prettier
           (NOT in .prettierignore). BOTH pass today and MUST stay green. This differs from the root
           README (T4.S1), which markdownlint does NOT gate."

- file: docs/GROUNDSWELL_GUIDE.md
  why: "CANONICAL in-repo, lint-passing source for the replacement code. L61-72 ('Configuration') is
        the exact configureHarnesses({...}) block; L116-130 ('Integration Example') shows the
        startup wiring (configureHarness() in src/config/harness.ts wrapping Groundswell's
        configureHarnesses()). Mirror these VERBATIM — do not invent the API shape."
  pattern: "configureHarnesses({ defaultHarness: 'pi', defaultModelProvider: 'zai', harnessDefaults:
            { 'claude-code': { apiKey: process.env.ANTHROPIC_API_KEY } } }). Import name is
            `configureHarnesses` (plural) from 'groundswell'."
  section: "L50-135 (Harness System + Configuration + Critical Rules + Capability Reference + Integration Example)"
  gotcha: "GROUNDSWELL_GUIDE uses zai/GLM-4.7 as an example model. ARCHITECTURE.md must use the
           SHIPPED default tier: zai/glm-5.2 (src/config/constants.ts MODEL_NAMES.sonnet). Model ids
           are lowercase (PRD §9.2.3)."

- file: src/config/constants.ts
  why: "Exact shipped literals: DEFAULT_HARNESS='pi', DEFAULT_MODEL_PROVIDER='zai',
        SUPPORTED_HARNESSES=['pi','claude-code'], MODEL_NAMES={opus:'glm-5.2',sonnet:'glm-5.2',
        haiku:'glm-5-turbo'}, PRP_AGENT_HARNESS='PRP_AGENT_HARNESS'. Use these verbatim."
  pattern: "Provider-qualified model string = zai/glm-5.2 (sonnet tier). NEVER harness-qualified
            (pi/zai/glm-5.2 is INVALID — PRD §9.4.3)."

- file: src/config/harness.ts
  why: "Shipped runtime: exports configureHarness() (singular) which WRAPS Groundswell's
        configureHarnesses() (plural); resolveApiKeyForProvider() = auth resolution order
        (override PRP_API_KEY → provider env var ZAI_API_KEY → ~/.pi/agent/auth.json);
        runAuthPreflight() (PRD §9.2.7); claude-code+zai rejected with HarnessProviderMismatchError."
  pattern: "Auth is provider-aware and resolved by the harness; the default-path createAgent does NOT
            take a top-level apiKey. Anthropic creds appear ONLY under harnessDefaults['claude-code']."
  gotcha: "The doc code example imports `configureHarnesses` from 'groundswell' (the Groundswell API),
           NOT hacky-hack's configureHarness() wrapper — this mirrors GROUNDSWELL_GUIDE.md exactly."

- docfile: plan/007_8783a1f5e14a/P7M1T4S2/research/architecture-stale-framing-audit.md
  why: "Companion audit: exact stale line refs, the canonical replacement source, the logging no-op
        finding (check b), and the validation-tooling reality. Read before implementing."
  section: "Sections 1-6 (stale locations, logging no-op, tooling reality, link integrity, scope)"

- docfile: plan/007_8783a1f5e14a/P7M1T4S1/PRP.md
  why: "PARALLEL sibling task (root README.md rewrite). Its shipped-behavior references
        (src/config/harness.ts, environment.ts, types.ts, constants.ts, logger.ts) are reused here.
        This task is INDEPENDENT of T4.S1's output (different files) but must not conflict with it."
  section: "Goal + 'All Needed Context' (shared shipped-behavior anchors)"
```

### Current Codebase tree (relevant slice)

```bash
docs/
├── ARCHITECTURE.md        # ← THE TARGET (917 lines; 2026-01-23; stale Agent Creation block L348-367)
├── GROUNDSWELL_GUIDE.md   # ← canonical configureHarnesses() example to MIRROR (L61-72, L116-130)
├── CONFIGURATION.md       # ← canonical provider-aware env/resolution (Jun 29) — link target
├── INSTALLATION.md        # ← canonical auth setup + preflight (Jun 29) — link target
├── CLI_REFERENCE.md  WORKFLOWS.md  TESTING.md  ...   # ← untouched
└── api/{index.html, media/architecture.md}            # ← EXISTING link targets (verified)
README.md                  # ← T4.S1's target (parallel) — DO NOT TOUCH
src/config/
├── harness.ts             # configureHarness (wraps configureHarnesses), resolveApiKeyForProvider, runAuthPreflight
├── constants.ts           # DEFAULT_HARNESS='pi', DEFAULT_MODEL_PROVIDER='zai', MODEL_NAMES.sonnet='glm-5.2'
├── environment.ts         # provider-conditional AUTH_TOKEN→API_KEY mapping
└── types.ts               # AuthPreflightError / HarnessProviderMismatchError
src/utils/logger.ts        # REQ-L1/L2/L3 logger (logging is OUT of edit scope here)
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
docs/ARCHITECTURE.md       # MODIFIED (only file touched). Agent Creation block rewritten to the
                           #   canonical provider-aware configureHarnesses() + zai/glm-5.2 example;
                           #   External References lightly refreshed; logging no-op recorded (no edit).
```
(No files are added or deleted. This is a single-file documentation edit.)

### Known Gotchas of our codebase & Library Quirks

```markdown
# CRITICAL — docs/ARCHITECTURE.md IS gated by BOTH markdownlint AND prettier (unlike the README).
# `npm run docs:lint` globs docs/**/*.md (package.json L57); .markdownlintignore excludes only docs/api/.
# `docs/ARCHITECTURE.md` is NOT in .prettierignore. BOTH pass today and MUST stay green after edits.
# Run: `npx markdownlint docs/ARCHITECTURE.md` AND `npx prettier --check docs/ARCHITECTURE.md`.

# CRITICAL — keep the doc's existing structure.
# Do NOT add new top-level sections (no "Agent Harness System" H2). Edit only the stale Agent Creation
# block + the short note + the External References line. The work item says: "Keep the doc's existing
# structure; edit only the stale capability/auth/logging statements."

# CRITICAL — model string is provider-qualified, lowercase, and uses the SHIPPED default tier.
# Use `zai/glm-5.2` (src/config/constants.ts MODEL_NAMES.sonnet). NEVER harness-qualified
# (`pi/zai/glm-5.2` is INVALID — PRD §9.4.3). GROUNDSWELL_GUIDE.md uses zai/GLM-4.7 as an EXAMPLE;
# do NOT copy that example model verbatim — use the shipped glm-5.2.

# CRITICAL — import name is configureHarnesses (plural) from 'groundswell', NOT hacky-hack's
# configureHarness() wrapper. Mirror docs/GROUNDSWELL_GUIDE.md exactly; it is the lint-passing source.

# CRITICAL — auth is provider-aware; do NOT put apiKey on the default-path createAgent.
# The default path resolves auth via the harness (override → ZAI_API_KEY → ~/.pi/agent/auth.json).
# Anthropic creds appear ONLY under harnessDefaults['claude-code']. Putting apiKey back on createAgent
# re-introduces the Anthropic-primary framing this task removes.

# GOTCHA — logging (check b) is a VERIFIED NO-OP. Do NOT edit any logging prose and do NOT add a
# logging-architecture section. REQ-L1/L2/L3 detail belongs in PRD §9.6 + src/utils/logger.ts, not in
# this architecture overview. Record the no-op finding in the Validation Loop.

# GOTCHA — do NOT fabricate external URLs.
# The Groundswell URL (github.com/anthropics/groundswell) is unverified — leave it unless it 404s.
# Do NOT invent a z.ai docs URL. For the LLM-provider reference, prefer an in-repo link
# (./CONFIGURATION.md) over an external URL.

# GOTCHA — T4.S1 (README.md) runs in PARALLEL. Do NOT touch README.md or any docs/*.md other than
# ARCHITECTURE.md. The two tasks are file-disjoint and must not conflict.
```

## Implementation Blueprint

### Data models and structure

_N/A — documentation-only task. No data models, schemas, or code are produced. The "model" is the
doc's information structure: the `### Agent Creation` block must show harness config (provider-agnostic)
BEFORE agent creation, with a provider-qualified model string and a one-line orthogonality note._

### Implementation Tasks (ordered by dependencies)

The file under edit is `docs/ARCHITECTURE.md` (917 lines). All edits are to that single file. Read the
whole file once before starting. Preserve: the ToC, every heading (order + depth), all Mermaid
diagrams, the `### @Workflow`/`@Step`/`@ObservedState` examples, the Tool Registration / Caching
blocks, the State Management / Task Hierarchy sections, and the See Also project-doc links.

```yaml
Task 1: REWRITE the `### Agent Creation` block (docs/ARCHITECTURE.md L348-367)  [PRIMARY]
  - DROP: `apiKey: process.env.ANTHROPIC_API_KEY!` and `model: 'claude-opus-4-5-20251101'` from the
          createAgent call (these imply Anthropic-only — check (a) — and use a stale model id).
  - REPLACE the lead sentence + the fenced TS block with the canonical provider-aware example. Mirror
    docs/GROUNDSWELL_GUIDE.md L61-72 + L116-130. Target text (adjust prose to match the doc's voice):
      Lead sentence (add 1-3 lines):
        "Agents are created using Groundswell's `createAgent` function. At startup the pipeline first
         configures the **harness** — the agent runtime/SDK — via `configureHarnesses()`, selecting the
         runtime (`pi`, the vendor-neutral default, or `claude-code`) **independently** of the LLM
         **provider/model** (default `zai`). See the [Groundswell Guide](./GROUNDSWELL_GUIDE.md) and
         PRD §9.4."
      Fenced block:
        ```ts
        import { configureHarnesses, createAgent } from 'groundswell';

        // 1. Configure the harness once at startup (harness ⟂ provider/model).
        configureHarnesses({
          defaultHarness: 'pi', // vendor-neutral default (pi.dev); 'claude-code' is Anthropic-only
          defaultModelProvider: 'zai', // LLM host — independent of the harness
          harnessDefaults: {
            'claude-code': { apiKey: process.env.ANTHROPIC_API_KEY },
          },
        });

        // 2. Create an agent. Models are provider-qualified ('zai/glm-5.2'), never harness-qualified
        //    ('pi/zai/glm-5.2' is invalid). Auth is resolved provider-aware (override → provider
        //    env var → ~/.pi/agent/auth.json); the default path passes no top-level apiKey.
        const coderAgent = createAgent({
          model: 'zai/glm-5.2', // default reasoning tier (PRD §9.2.3)
          maxTokens: 8192,
          systemPrompt: CODER_SYSTEM_PROMPT,
        });

        const response = await coderAgent.generate({
          prompt: 'Implement the PRP',
          tools: [bashTool, fileTool, gitTool],
          responseFormat: { type: 'text' },
        });
        ```
  - FOLLOW: docs/GROUNDSWELL_GUIDE.md L61-72 (exact configureHarnesses shape) + src/config/constants.ts
            (zai/glm-5.2, DEFAULT_HARNESS='pi', DEFAULT_MODEL_PROVIDER='zai').
  - NAMING: literals `configureHarnesses`, `pi`, `claude-code`, `zai`, `zai/glm-5.2`, `PRP_AGENT_HARNESS`
            (if referenced in prose). Import name is `configureHarnesses` (plural) from 'groundswell'.
  - CRITICAL: do NOT add `apiKey` back onto the default createAgent; keep it only under
              harnessDefaults['claude-code']. Do NOT add a new heading/section.
  - CHECK: this cures checks (a) AND (c) for the only stale capability example in the doc.

Task 2: REFRESH the `### External References` section (docs/ARCHITECTURE.md L906-912)  [SECONDARY, light]
  - REFRAME: the "Anthropic Claude API" line (currently the sole LLM API reference) so it no longer
             implies Anthropic is the LLM provider. Suggested safe wording:
               "- [Anthropic Claude API](https://docs.anthropic.com/claude/reference/) - Reference for
                 the **optional** `anthropic` provider / `claude-code` harness (the default path uses z.ai)"
             and add an in-repo line for the default provider:
               "- [z.ai provider configuration](./CONFIGURATION.md) - Default LLM provider (z.ai) + auth model"
  - KEEP: the Groundswell, TypeScript, and Mermaid lines unchanged.
  - GOTCHA: do NOT fabricate a z.ai external URL — prefer the in-repo ./CONFIGURATION.md link. Do NOT
            "correct" the Groundswell GitHub URL unless it demonstrably 404s (its real repo is unknown).
  - OPTIONAL: if editing risks markdownlint, prefer the minimal reframe (annotate the Anthropic line)
              over adding rows. This task is secondary to Task 1.

Task 3: LOGGING verification no-op (docs/ARCHITECTURE.md — NO EDIT)  [VERIFICATION]
  - RUN: `rg -ni 'pino|transport|worker.?thread|threadstream|async.?log|log.?dest' docs/ARCHITECTURE.md`
  - EXPECTED: ZERO hits (confirmed during research; every `log` match is "backlog"/"retry logic"/
              "logged"/"Log Blocking" — none imply worker-thread transports).
  - ACTION: if zero hits → record the finding (this PRP's Validation Loop Level 2) and make NO edit.
            If a hit IS found that implies worker-thread/async logging → reword to remove the
            implication (do NOT add a logging-architecture section).
  - CRITICAL: check (b) is explicitly a no-op per the work item OUTPUT §4 ("if no stale framing
              exists, document that finding").

Task 4: VALIDATION GATES (run after Tasks 1-3)
  - RUN: `npx markdownlint docs/ARCHITECTURE.md`           # MUST pass (enforced gate; passes today)
  - RUN: `npx prettier --check docs/ARCHITECTURE.md`       # MUST pass (enforced gate; passes today)
  - RUN: the grep assertions in Validation Loop Level 2 (stale gone, new framing present, logging clean).
  - RUN: the link-integrity check in Validation Loop Level 3 (every link resolves).
  - IF prettier reformats markdown (e.g., list spacing): `npx prettier --write docs/ARCHITECTURE.md`
    then re-check. (Prettier does NOT reformat TS inside fenced blocks — no embedded-language plugin.)
```

### Implementation Patterns & Key Details

```markdown
# PATTERN — provider-aware harness config (the new headline, replaces the Anthropic-only createAgent)
# Source of truth: docs/GROUNDSWELL_GUIDE.md L61-72 + src/config/constants.ts + PRD §9.4.
configureHarnesses({
  defaultHarness: 'pi',          // vendor-neutral default (pi.dev); runs any provider incl. z.ai
  defaultModelProvider: 'zai',   // LLM host — INDEPENDENT of the harness
  harnessDefaults: { 'claude-code': { apiKey: process.env.ANTHROPIC_API_KEY } }, // Anthropic-only harness
});
# Then createAgent({ model: 'zai/glm-5.2', ... }) — provider-qualified, no top-level apiKey.

# PATTERN — model string rules (PRD §9.2.3, §9.4.3)
# provider/model, lowercase, shipped default tier: 'zai/glm-5.2' (sonnet). NEVER harness-qualified.

# PATTERN — auth framing
# Default path: override (PRP_API_KEY) → provider env var (ZAI_API_KEY) → ~/.pi/agent/auth.json.
# Anthropic creds appear ONLY under harnessDefaults['claude-code'] (the optional, Anthropic-only harness).

# ANTI-PATTERN — do NOT put apiKey back on the default-path createAgent (re-introduces check (a)).
# ANTI-PATTERN — do NOT copy GROUNDSWELL_GUIDE's 'zai/GLM-4.7' example model; use shipped 'zai/glm-5.2'.
# ANTI-PATTERN — do NOT add a logging-architecture section (check (b) is a verified no-op).
# ANTI-PATTERN — do NOT add a new top-level section or change the ToC (keep existing structure).
# ANTI-PATTERN — do NOT fabricate external URLs; do NOT touch README.md or other docs/*.md.
```

### Integration Points

```yaml
DOCUMENTATION (read-only alignment; NO edits to these):
  - mirror:     docs/GROUNDSWELL_GUIDE.md   # canonical configureHarnesses() example (L61-72, L116-130)
  - align_with: docs/CONFIGURATION.md       # canonical provider-aware env/resolution (link target)
  - link_to:    docs/GROUNDSWELL_GUIDE.md, docs/CONFIGURATION.md, ../PRD.md  # all EXIST (verified)
  - do_not_touch: README.md (T4.S1, parallel), other docs/*.md, .env.example, PRD.md, PROMPTS.md, src/

CODE (read-only references; NO edits):
  - src/config/harness.ts        # configureHarness (wraps configureHarnesses), resolveApiKeyForProvider
  - src/config/constants.ts      # DEFAULT_HARNESS='pi', DEFAULT_MODEL_PROVIDER='zai', MODEL_NAMES.sonnet='glm-5.2'
  - src/config/environment.ts    # provider-conditional AUTH_TOKEN→API_KEY mapping
  - src/config/types.ts          # AuthPreflightError / HarnessProviderMismatchError
  - src/utils/logger.ts          # confirms no transport/worker-thread config (logging no-op verification only)
```

## Validation Loop

### Level 1: Markdown formatting (BOTH gates are enforced for this file)

```bash
# docs/ARCHITECTURE.md IS covered by `npm run docs:lint` (markdownlint docs/**/*.md) and prettier
# (NOT in .prettierignore). BOTH pass today and MUST stay green after edits.
npx markdownlint docs/ARCHITECTURE.md      # Expected: exit 0, no output.
npx prettier --check docs/ARCHITECTURE.md  # Expected: "All matched files use Prettier code style!"

# If prettier reformats markdown structure (lists/tables), accept it then re-check:
npx prettier --write docs/ARCHITECTURE.md && npx prettier --check docs/ARCHITECTURE.md
# (Prettier does NOT reformat TS inside fenced code blocks — no embedded-language plugin configured.)

# Project-wide sanity (should remain green; only ARCHITECTURE.md changed):
npm run docs:lint        # Expected: clean across all docs/**/*.md
npm run format:check     # Expected: clean
```

### Level 2: Grep assertions (stale framing gone, new framing present, logging clean)

```bash
# 2a. The stale Anthropic-only capability example MUST be gone:
rg -n 'ANTHROPIC_API_KEY!|claude-opus' docs/ARCHITECTURE.md          # expect: ZERO hits
rg -n "apiKey: process.env.ANTHROPIC_API_KEY!," docs/ARCHITECTURE.md # expect: ZERO hits (note: trailing comma)

# 2b. The new provider-aware framing MUST be present (cures checks (a) and (c)):
rg -n "model: 'zai/glm-5.2'" docs/ARCHITECTURE.md        # expect: >=1 hit (Agent Creation block)
rg -n 'configureHarnesses' docs/ARCHITECTURE.md           # expect: >=1 hit
rg -n "defaultHarness: 'pi'|defaultModelProvider: 'zai'" docs/ARCHITECTURE.md  # expect: >=1 hit each
rg -n '\bpi\b|\bzai\b|harness|provider' docs/ARCHITECTURE.md   # expect: NON-EMPTY (was empty before)

# 2c. Logging no-op verification (check b) — Task 3 — MUST be clean (no edit made):
rg -ni 'pino|transport|worker.?thread|threadstream|async.?log|log.?dest' docs/ARCHITECTURE.md
# expect: ZERO hits. RECORD this finding (it satisfies the work item's check (b) no-op requirement).

# Expected: 2a empty; 2b non-empty; 2c empty (and documented).
```

### Level 3: Link integrity (every link resolves to an existing file)

```bash
# Confirm every relative link target in docs/ARCHITECTURE.md exists (extract markdown links).
for f in $(rg -o '\]\((\.\./?[A-Za-z0-9_./-]+|\.(/[A-Za-z0-9_./-]+)+)\)' -r '$1' docs/ARCHITECTURE.md \
           | sed 's|^|docs/|' | sort -u); do
  [ -e "$f" ] && echo "OK   $f" || echo "MISS $f"
done
# Expected: every line "OK" — incl. ../README.md, ./CONFIGURATION.md, ./INSTALLATION.md,
# ./CLI_REFERENCE.md, ./WORKFLOWS.md, ../PROMPTS.md, ./api/media/architecture.md, ./api/index.html,
# and the NEW link ./GROUNDSWELL_GUIDE.md (all verified to exist during research).

# Sanity: confirm the canonical sibling still describes the new model (spot-check, no edit):
rg -n 'configureHarnesses|defaultHarness.*pi|defaultModelProvider.*zai' docs/GROUNDSWELL_GUIDE.md | head
# Expected: multiple hits (this is the file ARCHITECTURE.md must agree with).
```

### Level 4: Cohesion review (read-through)

```bash
# Read the rewritten `## Groundswell Framework Integration` section end-to-end and confirm it tells ONE
# coherent story:
#   @Workflow → @Step → @ObservedState → Agent Creation → Tool Registration → Caching
# The Agent Creation block must agree with GROUNDSWELL_GUIDE.md / CONFIGURATION.md that:
#   - DEFAULT harness = pi (vendor-neutral); DEFAULT provider = zai; the two are INDEPENDENT.
#   - model string = zai/glm-5.2 (provider-qualified; never harness-qualified).
#   - auth is provider-aware; Anthropic creds appear ONLY under harnessDefaults['claude-code'].
# (Manual review — no command; checklist item in Final Validation.)
```

## Final Validation Checklist

### Technical Validation

- [ ] `npx markdownlint docs/ARCHITECTURE.md` passes (exit 0) — enforced gate.
- [ ] `npx prettier --check docs/ARCHITECTURE.md` passes — enforced gate.
- [ ] Grep 2a: `ANTHROPIC_API_KEY!` / `claude-opus` are gone from the Agent Creation block.
- [ ] Grep 2b: `zai/glm-5.2`, `configureHarnesses`, `defaultHarness: 'pi'`, `defaultModelProvider: 'zai'`
      are present; `pi`/`zai`/`harness`/`provider` now appear in the doc (cures check (c)).
- [ ] Grep 2c: zero worker-thread/transport/pino/async-log framing (logging no-op recorded — check (b)).
- [ ] Link integrity: every relative link target resolves to an existing file (incl. the new
      `./GROUNDSWELL_GUIDE.md` link).

### Feature Validation

- [ ] The Agent Creation block no longer implies Anthropic is the primary/only provider (check (a)).
- [ ] The block surfaces the harness/provider orthogonality (pi default + zai default) with a link to
      GROUNDSWELL_GUIDE.md / PRD §9.4 (check (c)).
- [ ] The model string is provider-qualified `zai/glm-5.2` (lowercase, shipped default tier).
- [ ] Auth is framed provider-aware; no top-level apiKey on the default-path createAgent.
- [ ] The External References no longer list Anthropic as the sole LLM API reference (light refresh).
- [ ] Logging prose was verified clean (no edit) and the no-op finding is documented (check (b)).

### Code Quality Validation

- [ ] The doc's existing structure (ToC, headings, Mermaid diagrams, section order) is preserved — no
      new top-level sections, no ToC change.
- [ ] Env-var/model literals are the exact shipped values from `src/config/constants.ts`.
- [ ] The code example mirrors the lint-passing `docs/GROUNDSWELL_GUIDE.md` (import name, API shape).
- [ ] No `README.md`, other `docs/*.md`, `.env.example`, `PRD.md`, `PROMPTS.md`, or `src/` file was
      modified; no external URLs were fabricated.

### Documentation & Deployment

- [ ] ARCHITECTURE.md now agrees with (and links to) the canonical `docs/GROUNDSWELL_GUIDE.md` and
      `docs/CONFIGURATION.md`.
- [ ] No logging-architecture section was added (out of scope; over-specifies for an architecture overview).
- [ ] The logging no-op finding is recorded in the Validation Loop (satisfies work-item OUTPUT §4).

---

## Anti-Patterns to Avoid

- ❌ Don't put `apiKey` back on the default-path `createAgent` — it re-introduces the Anthropic-primary
  framing (check (a)) this task removes. Anthropic creds live ONLY under `harnessDefaults['claude-code']`.
- ❌ Don't copy `zai/GLM-4.7` from GROUNDSWELL_GUIDE.md verbatim — use the **shipped** `zai/glm-5.2`
  (`src/config/constants.ts` `MODEL_NAMES.sonnet`).
- ❌ Don't harness-qualify the model (`pi/zai/glm-5.2` is INVALID — PRD §9.4.3).
- ❌ Don't import `configureHarness` (hacky-hack's singular wrapper) in the doc example — import
  `configureHarnesses` (plural) from `'groundswell'`, mirroring GROUNDSWELL_GUIDE.md.
- ❌ Don't add a logging-architecture section or edit logging prose — check (b) is a verified no-op.
- ❌ Don't add a new top-level section or change the ToC — keep the doc's existing structure.
- ❌ Don't fabricate external URLs (z.ai docs, a "corrected" Groundswell repo URL) — prefer in-repo links.
- ❌ Don't touch `README.md` (T4.S1 owns it, parallel), other `docs/*.md`, `.env.example`, `PRD.md`,
  `PROMPTS.md`, or any `src/` file.
- ❌ Don't skip the markdownlint gate — unlike the README, it IS enforced for `docs/ARCHITECTURE.md`.

---

## Confidence Score

**9/10** for one-pass implementation success. The stale location is a single, precisely-pinned code
block (L348-367) with an exact canonical replacement (in-repo `docs/GROUNDSWELL_GUIDE.md`), the shipped
literals are pinned, the logging half is a verified no-op, and both validation gates are confirmed
passing today with exact commands provided. The only residual risk is a prettier/markdownlint nuance
on the rewritten fenced block, which Level 1 catches immediately.
