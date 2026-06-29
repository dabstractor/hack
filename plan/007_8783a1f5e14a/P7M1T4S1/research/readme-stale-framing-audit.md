# README.md Stale Auth/Logging Framing — Audit Notes (P7.M1.T4.S1)

## Mission
`README.md` (last touched Jun 23) still frames the Anthropic-shell auth model as PRIMARY.
The shipped code (`src/config/harness.ts`, `src/config/environment.ts`, `src/config/types.ts`,
`src/utils/logger.ts`) and the sibling docs (`docs/CONFIGURATION.md`, `docs/INSTALLATION.md`,
`.env.example` — all updated Jun 29) are ALREADY on the new provider-agnostic model. README is
the last stale surface.

## The canonical NEW framing (already shipped — README must match these)
- **Primary auth**: `pi /login` (writes `~/.pi/agent/auth.json`) **OR** `export ZAI_API_KEY=…`.
- **Resolution order** (`resolveApiKeyForProvider`, src/config/harness.ts):
  1. `PRP_API_KEY` (explicit override, highest precedence, non-empty only)
  2. provider-native env var — `ZAI_API_KEY` for `zai`; `ANTHROPIC_OAUTH_TOKEN`→`ANTHROPIC_API_KEY` for `anthropic`
  3. `~/.pi/agent/auth.json` (pi file-backed `AuthStorage`, via `pi /login`)
- **ANTHROPIC_AUTH_TOKEN/ANTHROPIC_API_KEY**: OPTIONAL; consulted ONLY when resolved provider is `anthropic`.
  `configureEnvironment()` maps `AUTH_TOKEN`→`API_KEY` ONLY when provider === 'anthropic' (backward-compat alias).
- **Preflight** (`runAuthPreflight`, src/config/harness.ts): runs after `configureEnvironment()`, before
  `ensureHarnessInitialized()`. Empty/whitespace == "not configured". On failure throws `AuthPreflightError`
  (src/config/types.ts) → pipeline aborts exit 1, no session dir, no agent run.
- **Harness** (`PRP_AGENT_HARNESS`, default `pi`): orthogonal to provider. `claude-code` is Anthropic-only
  and rejects the default `zai` provider (`HarnessProviderMismatchError`).
- **Base URL** (`ANTHROPIC_BASE_URL`): defaults to `https://api.z.ai/api/anthropic` ONLY when provider === 'zai'.

## Exact preflight error message (buildPreflightMessage, src/config/types.ts)
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
(`authPath` honors `PI_CODING_AGENT_DIR` if set; env-var name + export command vary by provider.)

## README.md — STALE LOCATIONS (exact line refs, current content)
1. **L81 Prerequisites**: `- Anthropic API key (via ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN)`
2. **L228–239 Env table + note**: `ANTHROPIC_AUTH_TOKEN` Yes\*, `ANTHROPIC_API_KEY` Yes\*; note "Either … is required."
3. **L241–256 Setup block**: `export ANTHROPIC_AUTH_TOKEN=…` / `export ANTHROPIC_API_KEY=…`
4. **L262–300 "How It Works / Variable Mapping"**: AUTH_TOKEN→API_KEY as the PRIMARY flow narrative + the
   `if (AUTH_TOKEN && !API_KEY) map` code block. THIS is the narrative the task says to DROP as primary.
5. **L345–369 z.ai Configuration .env example**: `ANTHROPIC_AUTH_TOKEN=your-zai-api-token-here`
6. **L381–390 Troubleshooting**: "ANTHROPIC_API_KEY not found" error → maps AUTH_TOKEN→API_KEY.
7. **L194 z.ai "Why" prose** ("uses z.ai as a compatible proxy for the Anthropic API") — framing is OK but
   the surrounding model/binding details must align with provider-aware resolution.

## README.md — LOGGING prose sweep
README has almost NO logging prose. Confirmed present: `--verbose` flag (L221), `logger.ts # Logging utilities`
(L569 project tree). NO mention of transports/worker threads/pino/ThreadStream. The task's logging directive
("ensure logging prose does not imply worker-thread transports") is therefore a VERIFICATION/sweep, not a
rewrite — confirm nothing stale exists; do NOT fabricate logging architecture prose that does not belong in
a user-facing README. (REQ-L1/L2/L3 details live in PRD §9.6 + the logger code; a README "How It Works"
user does not need them.)

## Validation tooling reality
- `npm run docs:lint` globs `docs/**/*.md` ONLY → **README.md is NOT covered** by markdownlint CI.
  `npx markdownlint README.md` today FAILS with MD033 (inline HTML) for the existing badge block (L3–16)
  — that is PRE-EXISTING and OUT OF SCOPE. Do not "fix" the badges.
- `.prettierrc` formats `.md`; `npx prettier --check README.md` PASSES today and MUST still pass after edits.
- No unit tests apply (docs-only change). Validation = prettier + grep assertions + link integrity.

## Sibling docs to align with (README should link to them, not duplicate)
- `docs/INSTALLATION.md` (Jun 29 17:59) — auth setup + preflight troubleshooting (canonical).
- `docs/CONFIGURATION.md` (Jun 29 17:06) — env-var tables + provider-aware resolution (canonical).
- `docs/ARCHITECTURE.md` — top-level framing is P7.M1.T4.S2's target; README's only ref is the "comprehensive
  architecture documentation" link (L483) which is fine.

## Scope boundary (do NOT do these)
- Do NOT touch `docs/*.md` (those are already correct; T4.S2 owns ARCHITECTURE.md).
- Do NOT touch `.env.example` (already correct).
- Do NOT touch `PRD.md`, `PROMPTS.md`, or any `src/` file.
- Do NOT add a logging-architecture section to the README (out of scope; over-specifies for end users).
