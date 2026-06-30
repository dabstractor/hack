# System Context — D1 Bugfix Remediation

## Project

**hacky-hack** is an autonomous PRP (Product Requirement Prompt) development pipeline built on
TypeScript + the `groundswell` orchestration engine. It uses the `pi` coding-agent harness
(`@earendil-works/pi-coding-agent`) to run LLM-powered agents (architect, researcher, coder, QA)
against the z.ai API (default provider `zai`, model `zai/glm-5.2`).

## What is "Delta D1"?

Delta D1 (`plan/007_8783a1f5e14a/`) is the **Auth & Logging Hardening** delta. It has four
workstreams:
- **T1 (Logging):** Lazy loggers + synchronous logging destinations (PRD §9.6). ✅ **Excellent —
  fully verified, no issues.**
- **T2 (Auth):** Provider-aware auth resolution (T2.S1) + cross-repo Groundswell file-backed
  `AuthStorage` fix (T2.S2). T2.S1 is correct; **T2.S2 is broken in the deployed build** (Issue 1).
- **T3 (Preflight):** Fail-fast auth preflight (PRD §9.2.7). Correct in isolation.
- **T4 (Docs):** README/docs reframe for auth+logging.

## The Four Issues (this bugfix)

### Issue 1 — CRITICAL: Stale `node_modules/groundswell` defeats auth.json-only auth
The file-backed `AuthStorage.create()` fix was written in the Groundswell **source repo**
(`~/projects/groundswell`) but **never committed/published/deployed**. hacky-hack imports
`groundswell@1.0.0` from the **npm registry tarball** (not a symlink), which still contains the
**pre-fix** code: `AuthStorage.inMemory()`. An in-memory store NEVER reads `~/.pi/agent/auth.json`,
so the documented primary auth flow (`pi /login`) fails at runtime with a misleading
"No API key found for zai" — **after** the preflight has already (falsely) passed.

See `auth_resolution_blindspot.md` for the full divergence analysis and `deployment_strategy.md`
for the deployment path.

### Issue 2 — MAJOR: `createBaseConfig` integration test stale (D1 regression)
`tests/integration/agents.test.ts > createBaseConfig > "should map ANTHROPIC_AUTH_TOKEN to
ANTHROPIC_API_KEY"` asserts the OLD direct-`ANTHROPIC_API_KEY` contract that T2.S1 deliberately
removed. `createBaseConfig()` now uses `resolveApiKeyForProvider(getResolvedProvider())` which
checks `PRP_API_KEY → ZAI_API_KEY → auth.json` — NOT raw `ANTHROPIC_API_KEY` for the default `zai`
provider. **Test-only churn; runtime is correct.**

### Issue 3 — MINOR: Full vitest suite red (33 files / 223 tests)
Mostly **pre-existing** failures outside D1's scope (e.g. model name `GLM-4.7` vs the shipped
`zai/glm-5.2`, and `enableReflection`/`responseFormat` mismatches that are intentional
"FILE-as-contract" design). The **one** D1-attributable failure is Issue 2.

See `test_triage.md` for the full categorization.

### Issue 4 — MINOR: `validate-groundswell.ts` doesn't detect stale dist
The validator only checks exports are importable + version >= 0.0.3. It does NOT verify
`PiHarness` uses a file-backed auth store, which is why the stale tarball passed CI verification.

## Key Code Paths (confirmed by research)

| Concern | File | Key detail |
|---------|------|------------|
| Preflight (reads auth.json ✅) | `src/config/harness.ts:219-281` | `runAuthPreflight()` imports `AuthStorage` from `@earendil-works/pi-coding-agent` and calls `AuthStorage.create()` directly — reads `auth.json` |
| Harness init (broken ❌) | `node_modules/groundswell/dist/harnesses/pi-harness.js:95` | `this.authStorage = AuthStorage.inMemory()` — NEVER reads `auth.json` |
| Provider-aware resolver | `src/config/harness.ts:67-99` | `resolveApiKeyForProvider()` → `PRP_API_KEY → provider env → auth.json (deferred)` |
| createBaseConfig | `src/agents/agent-factory.ts:163-190` | `env.ANTHROPIC_API_KEY: resolveApiKeyForProvider(getResolvedProvider()) ?? ''` |
| Validator | `src/scripts/validate-groundswell.ts` | Checks imports/exports/version only — no auth-store behavior assertion |
| Groundswell fix (source) | `~/projects/groundswell/src/harnesses/pi-harness.ts:148-153` | `AuthStorage.create()` / `ModelRegistry.create()` — UNCOMMITTED |
| Groundswell fix (built dist) | `~/projects/groundswell/dist/harnesses/pi-harness.js:103` | md5 `d3de7234…` (fixed) vs deployed `54cea962…` (stale) |

## Dependency Graph

```
hacky-hack
  └── groundswell@1.0.0 (npm registry tarball, NOT a symlink)
        └── @earendil-works/pi-coding-agent@^0.79.8
              └── @earendil-works/pi-ai@0.79.8 (env-var mapping: zai→ZAI_API_KEY)
```

hacky-hack also imports `AuthStorage` from `@earendil-works/pi-coding-agent` directly (in
`src/config/harness.ts`) for the preflight. This is a DIFFERENT import path than what the
harness uses internally, which is why the preflight and the harness disagree.
