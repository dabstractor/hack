---
name: "P7.M1.T4.S1 — README.md: rewrite auth + logging framing to the new reality (Mode B docs sweep)"
description: |
  Mode B (changeset-level) documentation task — the FINAL docs sweep for the P7.M1 auth & logging
  hardening changeset. `README.md` (last edited Jun 23) still presents the **Anthropic-shell auth
  model as PRIMARY** in its Prerequisites, env-var table, Setup block, "How It Works / Variable
  Mapping" narrative, the z.ai `.env` example, and the Troubleshooting section. The SHIPPED code
  (`src/config/harness.ts`, `src/config/environment.ts`, `src/config/types.ts`, `src/utils/logger.ts`)
  and the already-updated sibling docs (`docs/CONFIGURATION.md`, `docs/INSTALLATION.md`, `.env.example`)
  are on the new **provider-agnostic** model (PRD §9.2.6 / §9.2.7 / §9.6). README is the last stale
  surface. This task rewrites ONLY `README.md` (root) so auth + logging prose is consistent with the
  shipped behavior; it does not touch any `src/` file, `PRD.md`, `PROMPTS.md`, `.env.example`, or
  `docs/*.md` (T4.S2 owns `docs/ARCHITECTURE.md`).
---

## Goal

**Feature Goal**: `README.md` auth + logging sections stop describing the old Anthropic-primary,
`AUTH_TOKEN → API_KEY`-on-startup reality and instead describe the **shipped** provider-agnostic
model: `pi /login` / `ZAI_API_KEY` is the primary auth path; `ANTHROPIC_AUTH_TOKEN` /
`ANTHROPIC_API_KEY` are demoted to *optional anthropic-provider aliases*; the fail-fast auth
preflight is documented; and no logging prose implies worker-thread transports.

**Deliverable**: A modified `README.md` (root file) whose Prerequisites, Environment Variables
table, Setup block, "How It Works" narrative, z.ai `.env` example, and Troubleshooting section are
consistent with `src/config/harness.ts` + `src/config/environment.ts` + `src/config/types.ts`
(`runAuthPreflight`, `resolveApiKeyForProvider`, `AuthPreflightError`) and `src/utils/logger.ts`.
No other file is modified.

**Success Definition** (maps 1:1 to the work-item OUTPUT/LOGIC):
- `pi /login` / `ZAI_API_KEY` is presented as the **PRIMARY** auth path; `ANTHROPIC_AUTH_TOKEN` /
  `ANTHROPIC_API_KEY` are presented as **OPTIONAL**, anthropic-provider-only aliases.
- The "AUTH_TOKEN mapped to API_KEY on startup" narrative is **removed as the primary flow**; it
  survives at most as a one-line backward-compat note scoped to the `anthropic` provider.
- The fail-fast auth preflight (PRD §9.2.7) is reflected — either inline or by linking the canonical
  `docs/INSTALLATION.md` / `docs/CONFIGURATION.md` sections.
- No README prose implies worker-thread logging transports (a verification sweep — none exists today,
  so this is "confirm and keep it that way").
- `npx prettier --check README.md` still passes; `rg` asserts show zero stale auth framing and the
  new framing present; all README doc-links resolve to existing files.

## User Persona (if applicable)

**Target User**: A new contributor / installer reading the README to get authenticated and run their
first pipeline. Today they are told to `export ANTHROPIC_AUTH_TOKEN=…`, which is **wrong for the
default `pi` + `zai` path** — it is ignored for the `zai` provider, so their first run aborts at the
preflight with a confusing error. This task makes the README's first instruction correct.

**Use Case**: `git clone … && npm install` → authenticate → `npm run dev -- --prd ./PRD.md`.

**User Journey**: Read Prerequisites → read Setup → run `pi /login` (or `export ZAI_API_KEY=…`) →
run the pipeline → (on misconfig) read the Troubleshooting entry that matches the actual preflight
error and remediation.

**Pain Points Addressed**: (1) README tells users to set an Anthropic env var that the default path
ignores; (2) README's "How It Works" describes a code path (`AUTH_TOKEN→API_KEY`) that now only runs
under the `anthropic` provider; (3) README's Troubleshooting cannot explain the real preflight abort.

## Why

- **Correctness / install success.** Auth misconfiguration is the #1 install failure (PRD §9.2.7
  "Problem"). The README must not *cause* it by directing users to a credential the default path
  ignores. P7.M1.T2 + T3 made the pipeline provider-agnostic and fail-fast; the README is the last
  artifact still describing the bypassed Anthropic-shell convention.
- **Cohesion across the changeset.** `docs/INSTALLATION.md`, `docs/CONFIGURATION.md`, and
  `.env.example` were already updated to the new model in T2/T3. The README is the top-of-funnel
  entry point and must agree with them, or users hit contradictory instructions.
- **No harm to future work.** This is a docs-only sweep scoped to `README.md`. T4.S2 separately owns
  `docs/ARCHITECTURE.md`; nothing here touches `src/`, `PRD.md`, or the canonical docs.

## What

Rewrite the stale auth surfaces of `README.md` to match the shipped provider-agnostic model, and
sweep for any worker-thread logging framing (none expected). Concretely:

1. **Prerequisites** — replace the Anthropic-key requirement with `pi /login` or `ZAI_API_KEY`.
2. **Environment Variables table** — make `ZAI_API_KEY` the required-default row; demote the
   Anthropic rows to optional/anthropic-provider-only; add the `PRP_AGENT_HARNESS` row; keep model
   rows. Replace the "Either … is required" note with the provider-aware requirement note.
3. **Setup block** — lead with `pi /login` / `ZAI_API_KEY`; move Anthropic exports under an
   "Optional (anthropic provider / claude-code harness)" heading.
4. **"How It Works / Variable Mapping"** — DROP the `AUTH_TOKEN→API_KEY`-as-primary narrative.
   Replace with the provider-aware resolution order (override → provider env var → `auth.json`). The
   `AUTH_TOKEN→API_KEY` mapping may remain as a **one-line backward-compat note scoped to the
   `anthropic` provider** only.
5. **z.ai `.env` example** — replace `ANTHROPIC_AUTH_TOKEN=your-zai-api-token-here` with
   `ZAI_API_KEY=…` (+ a commented `pi /login` note), mirroring `.env.example`.
6. **Troubleshooting** — replace the "ANTHROPIC_API_KEY not found" entry with the actual preflight
   abort message + remediation (`pi /login` or `export ZAI_API_KEY=…`).
7. **Logging sweep** — confirm no prose implies worker-thread/transport logging (verify, do not
   fabricate a logging-architecture section — that is out of scope for a user-facing README).

### Success Criteria

- [ ] `rg -n 'ANTHROPIC_API_KEY .or. ANTHROPIC_AUTH_TOKEN' README.md` no longer appears in
      **Prerequisites** (L~81), the **env table required column** (L~232–233), the **Setup block**
      (L~248–252), or the **primary How-It-Works narrative** (L~267–279).
- [ ] `ZAI_API_KEY` and `pi /login` appear as the documented **primary** auth path.
- [ ] The `AUTH_TOKEN → API_KEY` mapping is absent as a **primary** flow (at most a backward-compat
      note scoped to the `anthropic` provider).
- [ ] The preflight (PRD §9.2.7) is reflected — inline or via link to the canonical doc.
- [ ] `rg -ni 'transport|worker thread|threadstream' README.md` returns **zero** hits.
- [ ] `npx prettier --check README.md` passes; every README doc-link resolves to an existing file.

## All Needed Context

### Context Completeness Check

_Before writing this PRP, validate: "If someone knew nothing about this codebase, would they have
everything needed to implement this successfully?"_ — **YES.** This PRP pins the exact stale line
ranges, the exact replacement text/tables, the exact shipped behavior (with source-file anchors), the
canonical sibling docs to mirror, and the exact validation commands. No codebase intuition required.

### Documentation & References

```yaml
# MUST READ — the SHIPPED behavior README must match (these are the source of truth for the rewrite)
- file: src/config/harness.ts
  why: "Defines resolveApiKeyForProvider() (auth resolution order PRD §9.2.6), configureHarness()
        (PRP_AGENT_HARNESS default 'pi', claude-code is Anthropic-only → HarnessProviderMismatchError),
        ensureHarnessInitialized(), and runAuthPreflight() (PRD §9.2.7 — checks override/env then
        AuthStorage.create().getAuthStatus(provider).configured)."
  pattern: "Provider-aware auth: override (PRP_API_KEY) → provider-native env var (ZAI_API_KEY for
            zai) → ~/.pi/agent/auth.json. Empty/whitespace == 'not configured' (via .trim())."
  gotcha: "hacky-hack forwards NOTHING for the auth.json source; pi's file-backed AuthStorage
           (Groundswell T2.S2) resolves it natively. README must say auth.json is auto-detected,
           not 'injected'."

- file: src/config/environment.ts
  why: "configureEnvironment() maps ANTHROPIC_AUTH_TOKEN→ANTHROPIC_API_KEY ONLY when provider ===
        'anthropic'; sets ANTHROPIC_BASE_URL default to z.ai ONLY when provider === 'zai'."
  pattern: "The AUTH_TOKEN→API_KEY alias is provider-conditional, NOT a global primary flow."
  gotcha: "validateEnvironment() is a legacy helper NOT on the startup path (PRD §9.2.7 Problem) —
           do not describe it as the auth check; the preflight is."

- file: src/config/types.ts
  why: "AuthPreflightError + buildPreflightMessage() define the EXACT actionable abort message
        README's Troubleshooting must quote (harness, provider/model, checked sources, remediation)."
  pattern: "Message names: Override PRP_API_KEY, the provider env-var name (ZAI_API_KEY), the
            auth.json path (honors PI_CODING_AGENT_DIR), and BOTH remediation commands."
  section: "lines ~160–240 (HarnessProviderMismatchError + AuthPreflightError + buildPreflightMessage)"

- file: src/config/constants.ts
  why: "Exact names: PRP_AGENT_HARNESS (default 'pi'), DEFAULT_MODEL_PROVIDER ('zai'), PRP_API_KEY,
        SUPPORTED_HARNESSES (['pi','claude-code']), DEFAULT_BASE_URL, MODEL_NAMES, MODEL_ENV_VARS."
  pattern: "Use these literal names in the README tables; do not invent env-var names."

- file: src/utils/logger.ts
  why: "REQ-L1/L2/L3 logging (synchronous pino-pretty destination, lazy pino, single root per mode).
        Confirms there is NO transport/worker-thread config — README must not imply otherwise."
  pattern: "pretty() used as a direct destination (NOT a transport target); getRoot() memoizes one
            root per mode; getLogger() is lazy."
  gotcha: "Do NOT add a logging-architecture section to the README — that detail belongs in PRD §9.6
           + the code, not a user-facing quickstart. The directive is 'no worker-thread framing'."

- file: docs/CONFIGURATION.md
  why: "CANONICAL new framing — already updated Jun 29. README tables/narrative must MATCH this and
        may LINK to it. Contains the env-var table, provider-aware resolution order, harness table,
        and the .env example."
  pattern: "Mirror its table rows (ZAI_API_KEY Yes* primary; ANTHROPIC_* No** optional anthropic-only;
            PRP_AGENT_HARNESS default 'pi') and its resolution-order bullets."
  section: "lines ~38–123 (env tables + provider-aware resolution + harness), ~290–365 (resolution
            order + .env example)"

- file: docs/INSTALLATION.md
  why: "CANONICAL auth setup + preflight troubleshooting — already updated Jun 29 17:59. README's
        Setup + Troubleshooting must align; README should LINK here for the full walkthrough."
  pattern: "Option A: pi /login (writes ~/.pi/agent/auth.json). Option B: export ZAI_API_KEY=<key>.
            Preflight abort message + remediation (lines ~548–575)."
  section: "lines ~67–83 (auth options), ~255–270 (env table), ~300–315 + ~548–575 (preflight + fix)"

- file: .env.example
  why: "CANONICAL .env template — already updated. README's z.ai .env example block must MATCH it
        (ZAI_API_KEY primary, commented ANTHROPIC_* optional, commented pi /login note)."
  pattern: "PRIMARY block: commented pi /login + ZAI_API_KEY=your-zai-key-here. OPTIONAL block:
            commented ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY (anthropic provider only)."

- file: README.md  # THE TARGET FILE — read fully before editing
  why: "The file under edit. Stale locations are pinned by exact line number + exact current text below."
  pattern: "Existing section order/heading style: '## Quick Start' > '### Prerequisites' > '### Installation'
            > '### Run Your First Pipeline'; '## Configuration' > '### Environment Variables' (pipe table)
            > '### Setup' (fenced bash) > '### Model Tiers' > '### How It Works' > '### API Safeguards'."
  gotcha: "Preserve the badge block (L3–16, inline HTML) and the Mermaid diagrams — do NOT 'fix' the
           pre-existing markdownlint MD033 warnings; README is NOT covered by `npm run docs:lint`."

- docfile: plan/007_8783a1f5e14a/P7M1T4S1/research/readme-stale-framing-audit.md
  why: "Companion audit: exact stale line refs, exact preflight message, validation-tooling reality."
  section: "Stale locations (1–7) + 'Validation tooling reality'"
```

### Current Codebase tree (relevant slice)

```bash
README.md                 # ← THE TARGET (root; Jun 23, stale)
.env.example              # ← already correct (Jun 29) — MIRROR this
docs/
├── INSTALLATION.md       # ← canonical auth setup + preflight (Jun 29 17:59) — ALIGN + LINK
├── CONFIGURATION.md      # ← canonical env tables + resolution (Jun 29 17:06) — ALIGN + LINK
├── ARCHITECTURE.md       # ← T4.S2's target; README only links to it (L483) — leave the link as-is
└── ... (other docs)
src/config/
├── harness.ts            # resolveApiKeyForProvider, configureHarness, runAuthPreflight (shipped)
├── environment.ts        # configureEnvironment (provider-conditional mapping) (shipped)
├── constants.ts          # exact env-var names + defaults (shipped)
└── types.ts              # AuthPreflightError + buildPreflightMessage (shipped)
src/utils/logger.ts       # REQ-L1/L2/L3 logger (shipped) — README only verifies no transport framing
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
README.md                 # MODIFIED (only file touched). Auth + logging framing rewritten to match
                          #   shipped provider-agnostic model; no other file changes.
```
(No files are added or deleted. This is a single-file documentation edit.)

### Known Gotchas of our codebase & Library Quirks

```markdown
# CRITICAL — README is NOT linted by CI.
# `npm run docs:lint` globs `docs/**/*.md` ONLY (package.json L57). The root README.md is excluded.
# `npx markdownlint README.md` FAILS TODAY with MD033 (inline-HTML badges at L3–16). That is
# PRE-EXISTING and OUT OF SCOPE — do NOT "fix" the badges or any other pre-existing markdownlint
# warning. The only enforced gate that covers README is `prettier --check`.

# CRITICAL — do not describe validateEnvironment() as the auth check.
# src/config/environment.ts validateEnvironment() is a legacy helper NOT on the startup path (PRD
# §9.2.7 "Problem"). The startup auth check is runAuthPreflight() in src/config/harness.ts.

# CRITICAL — the AUTH_TOKEN→API_KEY mapping is provider-CONDITIONAL, not global.
# configureEnvironment() maps AUTH_TOKEN→API_KEY ONLY when provider === 'anthropic'. For the default
# zai path it is NOT consulted. README must not present it as the primary startup flow.

# CRITICAL — auth.json is auto-detected, NOT injected.
# hacky-hack forwards nothing for the auth.json source; pi's file-backed AuthStorage (Groundswell
# T2.S2) reads ~/.pi/agent/auth.json natively. Say "auto-detected", never "injected/mapped".

# GOTCHA — empty/whitespace credentials are "not configured".
# resolveApiKeyForProvider() trims; runAuthPreflight() treats whitespace-only as missing. The README
# Troubleshooting must reflect this (a stray-space env var still fails the preflight).

# GOTCHA — do not over-specify logging in a user-facing README.
# PRD §9.6 (REQ-L1/L2/L3) is implementation detail. The README directive is ONLY "no worker-thread
# framing exists/is implied". Do NOT add a logging-architecture section.
```

## Implementation Blueprint

### Data models and structure

_N/A — documentation-only task. No data models, schemas, or code are produced. The "model" is the
README's information structure: Prerequisites → Env table → Setup → How It Works → Troubleshooting,
each reflecting the shipped provider-agnostic auth + preflight behavior._

### Implementation Tasks (ordered by dependencies)

The file under edit is `README.md` (root). All tasks are edits to that single file. Read the whole
file once before starting (it is 698 lines). Preserve: the badge block (L3–16), all Mermaid diagrams,
the CLI Options table, the Project Structure tree, the Development/Contributing/License sections.

```yaml
Task 1: REWRITE Prerequisites (README.md L~80–82, under "### Prerequisites")
  - REPLACE: "- Anthropic API key (via `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN`)"
  - WITH:    "- A z.ai credential — run `pi /login` (writes `~/.pi/agent/auth.json`) **or**
              `export ZAI_API_KEY=…`. (Anthropic credentials are optional; see
              [Configuration](#configuration).)"
  - FOLLOW: docs/INSTALLATION.md L67–74 (Option A pi /login / Option B ZAI_API_KEY).
  - NAMING: literal `ZAI_API_KEY`, `pi /login`, `~/.pi/agent/auth.json`.
  - GOTCHA: keep Node >= 20.0.0, npm >= 10.0.0, Git bullets unchanged above it.

Task 2: REWRITE the Environment Variables table + its note (README.md L~228–239, "### Environment Variables")
  - REPLACE the two Anthropic-primary rows with a provider-aware table. Use docs/CONFIGURATION.md
    L40–44 + L57–65 as the canonical shape. REQUIRED rows:
      | `ZAI_API_KEY`          | Yes\* | None | z.ai API key (default-path credential for the `zai` provider). |
      | `ANTHROPIC_BASE_URL`   | No    | `https://api.z.ai/api/anthropic` | API endpoint (auto-set to z.ai for the `zai` provider only). |
      | `PRP_API_KEY`          | No    | None | Explicit API-key override (highest precedence, any provider). |
      | `PRP_AGENT_HARNESS`    | No    | `pi` | Agent runtime: `pi` (default) or `claude-code` (Anthropic-only). |
      | `ANTHROPIC_AUTH_TOKEN` | No\*\*| None | **Optional.** Anthropic provider only; mapped to `ANTHROPIC_API_KEY` if unset. |
      | `ANTHROPIC_API_KEY`    | No\*\*| None | **Optional.** Anthropic provider only. |
      | `ANTHROPIC_DEFAULT_OPUS_MODEL`   | No | `glm-5.2`        | Architect agent model (provider-qualified at runtime). |
      | `ANTHROPIC_DEFAULT_SONNET_MODEL` | No | `glm-5.2`        | Researcher/Coder model (default). |
      | `ANTHROPIC_DEFAULT_HAIKU_MODEL`  | No | `glm-5-turbo`    | Simple-operations model (fastest). |
  - REPLACE the note (L239) "_Note: Either `ANTHROPIC_AUTH_TOKEN` or `ANTHROPIC_API_KEY` is required._"
    WITH:
      "_\*Required for the default path: **`ZAI_API_KEY`**, `pi /login` (`~/.pi/agent/auth.json`,
      auto-detected), **or** `PRP_API_KEY`. **\*\*Optional:** Anthropic credentials are consulted
      only when the resolved provider is `anthropic` (via an `anthropic/*` model override); they are
      **ignored** for the default `zai` provider. A startup preflight aborts with an actionable error
      if none is present (see [Troubleshooting](#troubleshooting))._"
  - FOLLOW: docs/CONFIGURATION.md L57–65 (exact wording + Yes\*/No\*\* convention).
  - DEPENDENCIES: Task 1 (consistent prerequisites). 

Task 3: REWRITE the Setup block (README.md L~241–256, "### Setup")
  - REPLACE the three Anthropic-export options with the canonical two primary + one optional:
      ```bash
      # Option 1: pi /login — recommended (writes ~/.pi/agent/auth.json, auto-detected by the harness)
      pi /login

      # Option 2: Set the z.ai provider env var directly
      export ZAI_API_KEY="your-zai-key-here"

      # --- Optional: Anthropic provider only (claude-code harness or anthropic/* models) ---
      # export ANTHROPIC_API_KEY="your-anthropic-key-here"
      # (ANTHROPIC_AUTH_TOKEN is accepted as a backward-compat alias for ANTHROPIC_API_KEY
      #  when the resolved provider is 'anthropic'.)
      ```
  - KEEP the "cp .env.example .env" guidance (align its comment text with .env.example).
  - FOLLOW: docs/INSTALLATION.md L67–83 + .env.example.
  - NAMING: `ZAI_API_KEY`, `pi /login`, `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`.

Task 4: REWRITE "How It Works / Variable Mapping" (README.md L~262–300)
  - DROP the narrative "Shell environment convention: ANTHROPIC_AUTH_TOKEN / SDK expectation:
    ANTHROPIC_API_KEY / the pipeline automatically maps AUTH_TOKEN to API_KEY on startup" as the
    PRIMARY flow.
  - DROP the `if (process.env.ANTHROPIC_AUTH_TOKEN && !process.env.ANTHROPIC_API_KEY)` code block
    as the headline behavior.
  - REPLACE with the **provider-aware auth resolution** (mirror docs/CONFIGURATION.md L298–301):
      "**Authentication is provider-aware** (PRD §9.2.6). For the resolved provider (default `zai`),
      the credential is resolved in order; the first non-empty source wins:
        1. `PRP_API_KEY` — explicit override (highest precedence).
        2. Provider-native env var — `ZAI_API_KEY` for `zai`; `ANTHROPIC_OAUTH_TOKEN`→`ANTHROPIC_API_KEY`
           for `anthropic`.
        3. `~/.pi/agent/auth.json` — written by `pi /login`, auto-detected by the harness.
      Empty/whitespace values are treated as 'not configured'."
  - KEEP a ONE-LINE backward-compat note scoped to the anthropic provider:
      "_Backward-compat alias: when the provider is `anthropic`, `ANTHROPIC_AUTH_TOKEN` is mapped to
      `ANTHROPIC_API_KEY` if the latter is unset. This alias does **not** apply to the default `zai`
      path._"
  - KEEP the BASE_URL idempotency note but scope it: "`ANTHROPIC_BASE_URL` defaults to the z.ai
    endpoint only when the provider is `zai`." (Drop the unconditional `if (!BASE_URL)` framing.)
  - FOLLOW: src/config/harness.ts resolveApiKeyForProvider() + src/config/environment.ts.
  - CRITICAL: the new headline is the resolution ORDER, not the AUTH_TOKEN→API_KEY mapping.

Task 5: REWRITE the z.ai .env example (README.md L~345–369, "### z.ai Configuration" → "Example .env File")
  - REPLACE `ANTHROPIC_AUTH_TOKEN=your-zai-api-token-here` with the canonical primary block (mirror
    .env.example):
      ```bash
      # .env — API Configuration for the default zai provider
      # Option A: pi /login (writes ~/.pi/agent/auth.json, auto-detected by the harness)
      # Option B: set ZAI_API_KEY directly
      ZAI_API_KEY=your-zai-key-here

      # Optional: API endpoint (defaults to z.ai for the zai provider)
      # ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic
      # Optional: Anthropic provider only (ignored for zai)
      # ANTHROPIC_AUTH_TOKEN=…
      # ANTHROPIC_API_KEY=…
      ```
  - KEEP the model override comments (OPUS/SONNET/HAIKU) unchanged.
  - FOLLOW: .env.example (it is the source of truth).

Task 6: REWRITE the Troubleshooting auth entry (README.md L~381–390)
  - REPLACE the "**\"ANTHROPIC_API_KEY not found\" error**" entry (which tells users to set
    AUTH_TOKEN mapped to API_KEY) with the actual preflight abort:
      "**Startup fails with "Authentication preflight failed"**
      The fail-fast preflight (PRD §9.2.7) found no credential for the selected provider before any
      agent ran. The message names the harness, provider/model, every checked source, and the fix:
      ```
      Authentication preflight failed: no credential configured for provider 'zai' (harness 'pi', model 'zai/glm-5.2').

      Checked sources (all empty):
        • Override:     PRP_API_KEY
        • Environment:  ZAI_API_KEY
        • pi auth.json: ~/.pi/agent/auth.json

      Remediation (pick one):
        • pi /login                       # writes ~/.pi/agent/auth.json
        • export ZAI_API_KEY=<your-key>   # provider-native env var
      ```
      Fix: run `pi /login`, or `export ZAI_API_KEY=<your-key>` (or, for the `anthropic` provider,
      `export ANTHROPIC_API_KEY=<your-key>`)."
  - FOLLOW: exact message from src/config/types.ts buildPreflightMessage().
  - KEEP the "Tests fail with 'Anthropic API detected'" + "Model not found" + "Connection timeout"
    entries unchanged (they are still accurate).
  - CRITICAL: do NOT tell users the fix is "set AUTH_TOKEN mapped to API_KEY" — that is the stale path.

Task 7: LOGGING sweep (no rewrite unless a hit is found)
  - RUN: `rg -ni 'transport|worker thread|threadstream|pino' README.md`
  - EXPECTED: zero hits (verified during research; the only logging refs are `--verbose` at L221 and
    `logger.ts # Logging utilities` at L569 — both are fine).
  - IF a hit implies worker-thread logging: reword to remove the implication. DO NOT add a new
    logging-architecture section — that is out of scope for a user-facing README.
  - This task is primarily a VERIFICATION gate; record the (empty) result in the validation loop.

Task 8: LINK INTEGRITY (verification, may add 1–2 links)
  - ENSURE README links to the canonical docs for the deep dive. If not already present, add under
    the rewritten Setup/Configuration area:
      "For the full auth + preflight walkthrough, see [Installation](docs/INSTALLATION.md) and
      [Configuration](docs/CONFIGURATION.md)."
  - VERIFY every README doc-link target exists: docs/INSTALLATION.md, docs/CONFIGURATION.md,
    docs/ARCHITECTURE.md, docs/contributing.md, PROMPTS.md (see Validation Loop Level 3).
```

### Implementation Patterns & Key Details

```markdown
# PATTERN — provider-aware auth resolution (the new headline, replaces the AUTH_TOKEN→API_KEY map)
# Source of truth: src/config/harness.ts resolveApiKeyForProvider() + docs/CONFIGURATION.md L298–301.
# Order (first NON-EMPTY wins; whitespace-only == "not configured"):
#   1. PRP_API_KEY (override, any provider)
#   2. provider-native env var: ZAI_API_KEY (zai) | ANTHROPIC_OAUTH_TOKEN→ANTHROPIC_API_KEY (anthropic)
#   3. ~/.pi/agent/auth.json (pi /login; auto-detected by pi's file-backed AuthStorage — NOT injected)

# PATTERN — the AUTH_TOKEN→API_KEY alias is now a backward-compat footnote, not the primary flow
# Source: src/config/environment.ts configureEnvironment() — maps ONLY when provider === 'anthropic'.
# README: present it as a one-line note under the anthropic provider, never as "how startup auth works".

# PATTERN — preflight abort message (quote verbatim in Troubleshooting)
# Source: src/config/types.ts buildPreflightMessage(). Honors PI_CODING_AGENT_DIR for the auth.json path.

# PATTERN — env table conventions (mirror docs/CONFIGURATION.md exactly)
# Yes\*  = required for the DEFAULT path (ZAI_API_KEY / pi /login / PRP_API_KEY).
# No\*\* = optional, anthropic-provider-only (ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY).

# ANTI-PATTERN — do NOT describe validateEnvironment() as the startup auth check (it is not on the path).
# ANTI-PATTERN — do NOT present ANTHROPIC_AUTH_TOKEN/API_KEY as required in any table row.
# ANTI-PATTERN — do NOT add a logging-architecture section (out of scope; over-specifies for end users).
```

### Integration Points

```yaml
DOCUMENTATION:
  - align_with: docs/INSTALLATION.md       # canonical auth setup + preflight (Jun 29 17:59)
  - align_with: docs/CONFIGURATION.md      # canonical env tables + resolution order (Jun 29 17:06)
  - mirror:     .env.example               # canonical .env template (Jun 29)
  - link_to:    docs/INSTALLATION.md, docs/CONFIGURATION.md  # add deep-dive links if absent
  - do_not_touch: docs/ARCHITECTURE.md (T4.S2 owns it), docs/*.md (already correct), PRD.md, PROMPTS.md

CODE (read-only references; NO edits):
  - src/config/harness.ts        # resolveApiKeyForProvider, configureHarness, runAuthPreflight
  - src/config/environment.ts    # configureEnvironment (provider-conditional mapping)
  - src/config/constants.ts      # exact env-var names + defaults
  - src/config/types.ts          # AuthPreflightError + buildPreflightMessage (exact message)
  - src/utils/logger.ts          # confirms no transport/worker-thread config (logging sweep only)
```

## Validation Loop

### Level 1: Markdown formatting (the only enforced style gate for README)

```bash
# README is NOT covered by `npm run docs:lint` (that globs docs/**/*.md only).
# The enforced gate is prettier. It PASSES today and MUST still pass after edits.
npx prettier --check README.md
# Expected: "All matched files use Prettier code style!"

# If prettier reformats your tables/lists, apply it:
npx prettier --write README.md && npx prettier --check README.md
# Expected: zero diff remaining.

# NOTE: `npx markdownlint README.md` FAILS TODAY (MD033 inline-HTML badges at L3–16) and is NOT a
# gate. Do NOT "fix" those warnings — the badges are pre-existing and out of scope.
```

### Level 2: Grep assertions (stale framing gone, new framing present)

```bash
# 2a. The stale PRIMARY narrative must be GONE from Prerequisites / Setup / How-It-Works:
rg -n 'ANTHROPIC_API_KEY .or. ANTHROPIC_AUTH_TOKEN' README.md          # expect: no hit in those sections
rg -n 'mapped to .ANTHROPIC_API_KEY.' README.md                        # expect: at most the backward-compat note
rg -n 'Either .ANTHROPIC_AUTH_TOKEN. or .ANTHROPIC_API_KEY. is required' README.md   # expect: ZERO hits
rg -n 'ANTHROPIC_AUTH_TOKEN=your-zai-api-token-here' README.md         # expect: ZERO hits

# 2b. The new PRIMARY framing must be PRESENT:
rg -n 'pi /login' README.md                  # expect: >=1 hit (Prerequisites/Setup/How-It-Works/.env/Troubleshooting)
rg -n 'ZAI_API_KEY' README.md                # expect: >=1 hit in env table + Setup + .env + Troubleshooting
rg -n 'provider-aware|resolved provider' README.md   # expect: >=1 hit in How-It-Works

# 2c. Logging sweep — no worker-thread framing (Task 7 verification):
rg -ni 'transport|worker thread|threadstream' README.md   # expect: ZERO hits
# (pino may legitimately appear nowhere; that is correct — README is user-facing.)

# Expected: 2a empty (except the allowed backward-compat note); 2b non-empty; 2c empty.
```

### Level 3: Link integrity (every README doc-link resolves)

```bash
# Extract every docs/ + PROMPTS.md link target from README and confirm the file exists.
for f in $(rg -o '(?:docs/|PROMPTS\.md)[^ )]+' README.md | sort -u); do
  [ -e "$f" ] && echo "OK   $f" || echo "MISS $f"
done
# Expected: every line "OK" — including docs/INSTALLATION.md, docs/CONFIGURATION.md,
# docs/ARCHITECTURE.md, docs/contributing.md (note: docs/contributing.md may be lowercase 'c' —
# if it is missing, fix the link target to the real file, e.g. docs/CONTRIBUTING.md).

# Sanity: confirm the canonical sibling docs still describe the new model (spot-check, no edit):
rg -n 'pi /login|ZAI_API_KEY' docs/INSTALLATION.md docs/CONFIGURATION.md .env.example | head
# Expected: multiple hits (these are the files README must agree with).
```

### Level 4: Cohesion review (read-through)

```bash
# Read the rewritten auth surface end-to-end and confirm it tells ONE coherent story:
#   Prerequisites → Env table → Setup → How It Works → .env example → Troubleshooting
# All six must agree that:
#   - PRIMARY = pi /login OR ZAI_API_KEY (default zai path)
#   - OPTIONAL = ANTHROPIC_* (anthropic provider only)
#   - PREFLIGHT aborts at startup with an actionable message
#   - the AUTH_TOKEN→API_KEY map is at most a backward-compat note scoped to 'anthropic'
# (Manual review — no command; checklist item in Final Validation.)
```

## Final Validation Checklist

### Technical Validation

- [ ] `npx prettier --check README.md` passes (zero diff).
- [ ] Grep 2a: no stale PRIMARY auth framing remains (only the allowed backward-compat note).
- [ ] Grep 2b: `pi /login`, `ZAI_API_KEY`, and "provider-aware/resolved provider" are present.
- [ ] Grep 2c: `rg -ni 'transport|worker thread|threadstream' README.md` returns zero hits.
- [ ] Link integrity: every README doc-link resolves to an existing file.

### Feature Validation

- [ ] Prerequisites no longer require an Anthropic env var.
- [ ] Env-var table marks `ZAI_API_KEY` Yes\* and `ANTHROPIC_*` No\*\* (optional, anthropic-only).
- [ ] Setup leads with `pi /login` / `ZAI_API_KEY`.
- [ ] "How It Works" headline is the provider-aware resolution ORDER, not the AUTH_TOKEN→API_KEY map.
- [ ] `.env` example uses `ZAI_API_KEY` (not `ANTHROPIC_AUTH_TOKEN=your-zai-api-token-here`).
- [ ] Troubleshooting quotes the real preflight abort message + remediation.
- [ ] Logging prose does not imply worker-thread transports (verified, none added).

### Code Quality Validation

- [ ] Wording/tables mirror the canonical `docs/CONFIGURATION.md` + `docs/INSTALLATION.md` + `.env.example`.
- [ ] Env-var names are the exact literals from `src/config/constants.ts`.
- [ ] Badge block, Mermaid diagrams, CLI Options table, Project Structure tree, and
      Development/Contributing/License sections are preserved unchanged.
- [ ] No `src/`, `PRD.md`, `PROMPTS.md`, `.env.example`, or `docs/*.md` file was modified.

### Documentation & Deployment

- [ ] The README now agrees with (and links to) the canonical auth + preflight docs.
- [ ] No fabricated logging-architecture section was added.
- [ ] Pre-existing markdownlint MD033 badge warnings were left untouched (out of scope, not a gate).

---

## Anti-Patterns to Avoid

- ❌ Don't present `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_API_KEY` as required in any table row or Setup step.
- ❌ Don't keep the "AUTH_TOKEN mapped to API_KEY on startup" narrative as the PRIMARY flow.
- ❌ Don't describe `validateEnvironment()` as the startup auth check (it isn't on the path; the
  preflight is).
- ❌ Don't say auth.json is "injected/mapped" — it is auto-detected by pi's file-backed AuthStorage.
- ❌ Don't add a logging-architecture section (REQ-L1/L2/L3 is implementation detail, not README fare).
- ❌ Don't "fix" the pre-existing markdownlint MD033 inline-HTML badge warnings — out of scope.
- ❌ Don't touch `docs/*.md`, `.env.example`, `PRD.md`, `PROMPTS.md`, or any `src/` file.
- ❌ Don't invent env-var names — use the exact literals from `src/config/constants.ts`.
