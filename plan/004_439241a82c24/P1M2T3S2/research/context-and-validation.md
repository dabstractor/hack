# Research — P1.M2.T3.S2: Create docs/GROUNDSWELL_GUIDE.md (Harness System)

> Load-bearing facts captured 2026-06-20 by direct inspection of the hacky-hack
> repo. This subtask CREATES a brand-new user-facing doc; its single required
> content payload is the **Harness System** section mirroring PRD §9.4.

## 1. Operation type: CREATE (not edit)

`docs/GROUNDSWELL_GUIDE.md` **does not exist** in `hacky-hack/docs/` (confirmed:
`ls docs/GROUNDSWELL_GUIDE.md` → "No such file or directory"). Architecture note
`implementation_notes.md` §6 states verbatim:

> _"docs/GROUNDSWELL_GUIDE.md is a CREATE, not an edit … The doc subtask must
> **create** it (with at least the Harness System section per PRD §9.4). A
> prior-session copy lives at `plan/003_b3d3efdaf0ed/docs/GROUNDSWELL_GUIDE.md`
> and may be referenced for tone, but the new file must live at
> `docs/GROUNDSWELL_GUIDE.md`."_

A prior-session copy exists at `plan/003_b3d3efdaf0ed/docs/GROUNDSWELL_GUIDE.md`
(~1500 lines, Version 1.0.0, dated 2026-01-23). It is a **style/tone reference
only** — it contains **zero** harness content (grep for `harness` /
`configureHarnesses` / `HarnessId` → no matches); the harness system is **new in
session 004**. Do NOT copy its body. Borrow only its shell: header block
(Status/Last Updated/Version), `> ` blockquote intro, `## Table of Contents`,
padded pipe tables, `bash`/`typescript` fenced code, and `## See Also` with
relative markdown links.

## 2. Content source = PRD §9.4 (authoritative, verbatim in the PRP's context)

The work-item contract names PRD §9.4 (§9.4.1–§9.4.4) as the authoritative
content source. The four required payloads, mapped to doc subsections:

| PRD ref        | Doc subsection (`### …` under `## Harness System`) | Payload                                                                                                                                                   |
| -------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §9.4.1 (h4.9)  | Supported Harnesses                                | Table: `pi` (default) / `claude-code` (optional) with the exact Notes text from the PRD.                                                                  |
| §9.4.2 (h4.10) | Configuration                                      | `configureHarnesses({ defaultHarness:'pi', defaultModelProvider:'zai', harnessDefaults })` startup block + `PRP_AGENT_HARNESS` env var + cascade rule.    |
| §9.4.3 (h4.11) | Critical Rules                                     | 4 bullets: (1) harness never in model string; (2) claude-code Anthropic-only; (3) feature parity via MCPHandler; (4) cache isolation by harness×provider. |
| §9.4.4 (h4.12) | Capability Reference                               | Capability×harness matrix (MCP, Skills, LSP, Streaming, Sessions, Extended Thinking, LLM providers).                                                      |

Plus the **optional but specified** integration example (the PRP startup call).

## 3. The implemented code this doc must match (read-only; do NOT edit)

The doc must reflect what is **actually shipped** (P1.M1.T1.S2 + P1.M1.T2.S2):

- **`src/config/harness.ts`** — `configureHarness()` reads
  `process.env[PRP_AGENT_HARNESS] ?? DEFAULT_HARNESS`, validates against
  `SUPPORTED_HARNESSES`, throws `HarnessProviderMismatchError` if
  `harness==='claude-code' && DEFAULT_MODEL_PROVIDER==='zai'`, then calls
  Groundswell `configureHarnesses({ defaultHarness, defaultModelProvider: 'zai',
harnessDefaults: { 'claude-code': { apiKey: process.env.ANTHROPIC_API_KEY } } })`.
  This is the **real startup call** to show in the integration example.
- **`src/config/constants.ts`** — `PRP_AGENT_HARNESS='PRP_AGENT_HARNESS'`,
  `DEFAULT_HARNESS='pi'`, `DEFAULT_MODEL_PROVIDER='zai'`,
  `SUPPORTED_HARNESSES=['pi','claude-code']`.
- **`src/agents/agent-factory.ts`** — `RESOLVED_HARNESS` captured once at startup;
  each persona config carries `harness: RESOLVED_HARNESS` and `model: 'zai/GLM-4.7'`.

So the doc's startup snippet must use `defaultModelProvider: 'zai'` (NOT
`'anthropic'` — note the Groundswell upstream `harnesses.md` example uses
`'anthropic'`, but **this project's default is `zai`**).

## 4. Groundswell API surface (architecture/external_deps.md — authoritative local ref)

`architecture/external_deps.md` catalogs the exports the doc references. Key
exact signatures (copy verbatim into the doc's prose/typescript):

- `configureHarnesses(config: GlobalHarnessConfig): void` — call ONCE at startup.
- `type HarnessId = 'pi' | 'claude-code'` (closed set).
- `HarnessOptions { endpoint?, apiKey?, sessionId?, timeout?, headers? }` —
  `apiKey` is forwarded to the LLM provider, NOT owned by the harness.
- `parseModelSpec('zai/GLM-4.7')` → `{provider:'zai',model:'GLM-4.7',raw:'zai/GLM-4.7'}`;
  `parseModelSpec('pi/zai/GLM-4.7')` **THROWS** ("Harness must not appear in model
  string …"). This is the authority for §9.4.3 rule (1).
- `registerDefaultHarnesses(registry?)` is **idempotent** — registers `pi` and
  `claude-code`.
- `PiHarness`, `ClaudeCodeHarness`, `HarnessRegistry` adapters.
- **Validation gap to state plainly:** `configureHarnesses()` validates ONLY
  `defaultHarness` + `harnessDefaults` keys — `defaultModelProvider` is an **open
  set, NOT validated**. Therefore the **PRP pipeline** owns the claude-code↔z.ai
  incompatibility rule (PRD §9.4.3 / §9.2.4); Groundswell will not reject it.

## 5. Groundswell upstream docs (authoritative external URLs)

The Groundswell library ships its own docs at `~/projects/groundswell/docs/`. The
authoritative harness reference is **`harnesses.md`** (586 lines). Relevant
sections (cite these as "for the full upstream reference" links):

- `~/projects/groundswell/docs/harnesses.md#supported-harnesses`
- `~/projects/groundswell/docs/harnesses.md#harness-identifier`
- `~/projects/groundswell/docs/harnesses.md#global-harness-configuration`
- `~/projects/groundswell/docs/harnesses.md#validation-behavior`
- `~/projects/groundswell/docs/harnesses.md#configuration-cascade`
- `~/projects/groundswell/docs/harnesses.md#model-and-provider-specification`
- `~/projects/groundswell/docs/harnesses.md#feature-parity`
- `~/projects/groundswell/docs/harnesses.md#mcp-skills-and-lsp-integration`

These use the upstream's `defaultModelProvider: 'anthropic'` example — the PRP
doc must use `'zai'` and may note the upstream defaults differ.

## 6. Anchor contract (cross-link target — HARD requirement)

The sibling subtask **P1.M2.T3.S1** (`docs/CONFIGURATION.md`) adds a cross-link
to **`./GROUNDSWELL_GUIDE.md#harness-system`** (confirmed in its PRP: "See Also

- Agent Runtime subsection both link to `./GROUNDSWELL_GUIDE.md#harness-system`").
  Therefore the new file **MUST** contain a heading whose GitHub slug is exactly
  `harness-system`. The heading `## Harness System` produces slug `#harness-system`
  (GitHub: lowercase, spaces→`-`, drop punctuation). Do NOT name it "Harness
  Systems" (plural → `#harness-systems`, breaks the link) or nest it deeper than H2
  in a way that changes the slug. Verify with `grep -n "## Harness System"`.

## 7. Scope decision: focused guide, NOT a 1500-line recreation

The prior-session guide was a comprehensive 1500-line framework guide. The
work-item contract (2 points) is scoped to _"document the Harness System"_ and
says _"at minimum a 'Harness System' section"_. Recreating the full 1500-line
guide is (a) scope creep, (b) at high risk of staleness vs the rest of session
004's changes, and (c) unnecessary for the cross-link. **Decision:** ship a
**focused, self-contained** `docs/GROUNDSWELL_GUIDE.md` whose body is:

```
# Groundswell Guide
> blockquote intro (1 sentence: what this guide covers)
**Status** / **Last Updated** / **Version**
## Table of Contents
## Overview           (1–2 paragraphs: Groundswell role + link to upstream)
## Harness System     ← #harness-system  (the core; §9.4 mirrored)
  ### Supported Harnesses      (§9.4.1 table)
  ### Configuration            (§9.4.2)
  ### Critical Rules           (§9.4.3)
  ### Capability Reference     (§9.4.4 table)
  ### Integration Example      (the PRP startup call)
## See Also
```

This is consumable, professional, cross-link-compatible, and respects the 2-point
scope. Additional sections (Workflow/Agent/MCP/Caching) can be added by future
tasks; this task does not block on them.

## 8. Validation environment (authoritative gates + the docs:lint caveat)

Identical situation to the sibling S1 subtask (see
`P1M2T3S1/research/validation-environment-and-baseline.md`):

| Command                | Definition (package.json)                          | Installed?                                                                    | Reliable?                                                                                                                               |
| ---------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run format:check` | `prettier --check "**/*.{ts,js,json,md,yml,yaml}"` | **Yes** (prettier@^3.7.4)                                                     | ✅ YES — authoritative                                                                                                                  |
| `npm run docs:lint`    | `markdownlint "docs/**/*.md"`                      | **NO** — markdownlint binary not in node_modules/.bin, not in devDependencies | ❌ NO — errors at package-resolution level ("could not determine executable to run"). Pre-existing env gap, NOT this task's job to fix. |
| `npm run validate`     | `lint && format:check && typecheck`                | n/a                                                                           | ✅ passes iff format:check passes (no .ts touched)                                                                                      |

**Equivalent markdown check that works:** `npx markdownlint-cli2
docs/GROUNDSWELL_GUIDE.md` (auto-installs `markdownlint-cli2@0.22.1` /
markdownlint v0.40.0; **no** `.markdownlint.json` / `.markdownlintrc` /
`.markdownlintignore` in the repo → default rules).

### New-file nuance (differs from the CONFIGURATION.md baseline case)

Because this file is **new** (no 59-error baseline like CONFIGURATION.md), the
implementer should aim for the file to be **as markdownlint-clean as feasible**
rather than merely "no worse than a baseline." Concretely:

- **MD013/line-length (80):** the two required reference tables (§9.4.1 Supported
  Harnesses, §9.4.4 Capability Reference) have inherently long "Notes"/cell text
  and **will** exceed 80 cols when formatted as padded tables. This matches the
  established `docs/` convention (every existing doc's tables trip MD013) and is
  **acceptable**. For **prose** lines, wrap at ~80 cols (prettier does NOT reflow
  markdown prose — the author controls line length; the prior guide wraps prose
  at ~80).
- **Must avoid entirely (these rules are absent from a clean new file):**
  - **MD024/no-duplicate-heading** — every heading + TOC entry must be unique.
  - **MD051/link-fragments** — every TOC anchor and cross-link must resolve to a
    real heading (verify `#harness-system`, `#supported-harnesses`,
    `#configuration`, `#critical-rules`, `#capability-reference`,
    `#integration-example`, `#overview`, `#see-also`, and the relative link
    `./CONFIGURATION.md`).
  - **MD040/fenced-code-language** — every ` ``` ` fence needs a language
    (`bash` / `typescript`).
  - **MD009/trailing-space, MD012/multiple-blanks, MD033/no-inline-html,
    MD031/blanks-around-fences, MD032/blanks-around-lists.**

**Authoritative gate = `npm run format:check` (MUST be green).** Run `npm run
fix` first so prettier aligns the new tables, then `npm run format:check`.

### `.prettierrc` (must obey)

`printWidth: 80`, `singleQuote: true`, `trailingComma: "es5"`, `tabWidth: 2`,
`endOfLine: "lf"`, `arrowParens: "avoid"`. Prettier WILL reformat markdown tables
to its own column alignment — let it (do not hand-align columns; run `npm run
fix`). `docs/` is NOT in `.prettierignore` → format:check enforces the new file.

## 9. Cross-link reciprocity (CONFIGURATION.md ↔ GROUNDSWELL_GUIDE.md)

- **Inbound (from sibling S1):** CONFIGURATION.md will link to
  `./GROUNDSWELL_GUIDE.md#harness-system` (See Also + Agent Runtime subsection).
- **Outbound (this task):** GROUNDSWELL_GUIDE.md `## See Also` should link BACK to
  `./CONFIGURATION.md` (for env-var/runtime config) — reciprocal and consistent
  with the prior guide's See Also pattern. Also link the other neighbor docs
  (ARCHITECTURE.md, INSTALLATION.md) and the Groundswell upstream
  (`~/projects/groundswell/README.md`, `~/projects/groundswell/docs/harnesses.md`).

## 10. Header convention for the new file

New doc → `Version: 1.0.0`, `Last Updated: 2026-06-20` (current date), `Status:
Published`. Match the prior guide's header shape exactly (`**Status**: Published`
/ `**Last Updated**: …` / `**Version**: 1.0.0`).
