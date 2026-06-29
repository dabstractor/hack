---
name: "P7.M1.T2.S1 — Provider-aware auth resolution in hacky-hack (src/config/harness.ts + environment.ts)"
description: |
  Replace the Anthropic-shell-only auth contract with a provider-aware resolver so the default
  `pi` + `zai` path authenticates via `pi /login` (`~/.pi/agent/auth.json`, honored by Groundswell
  once T2.S2 lands) OR `ZAI_API_KEY` — with NO Anthropic env var required. The resolver checks, for
  the resolved provider (default `zai`, from `getModel('sonnet').split('/')[0]`), in priority order
  (first non-empty wins): (1) explicit override (`PRP_API_KEY` env / `options.apiKey`);
  (2) provider-native env var via pi's `getEnvApiKey(provider)` (`ZAI_API_KEY` for `zai`,
  `ANTHROPIC_OAUTH_TOKEN`→`ANTHROPIC_API_KEY` for `anthropic`); (3) `auth.json` — hacky-hack
  forwards NOTHING and lets pi's file-backed `AuthStorage` resolve natively (T2.S2). An override is
  forwarded ONLY when non-empty (eliminating the `?? ''` empty-string shadowing; whitespace-only ==
  "not configured"). `ANTHROPIC_AUTH_TOKEN` is demoted to a backward-compat alias used ONLY when the
  provider is `anthropic`. `ANTHROPIC_BASE_URL` defaults to the z.ai endpoint ONLY when the provider
  is `zai` (the §9.2.4 `endpoint-guard.ts` safeguard stays intact). `ensureHarnessInitialized()`
  uses the resolver. Satisfies PRD §9.2.6; unblocks T3's preflight (which reuses the resolver).
  [Mode A] docs ride with the work: `.env.example`, `docs/CONFIGURATION.md`, JSDoc on the new functions.
---

## Goal

**Feature Goal**: hacky-hack authenticates the **provider of the resolved model** (default `zai`),
not Anthropic. A new provider-aware resolver — `resolveApiKeyForProvider(provider, options?)` in
`src/config/harness.ts` — returns the credential to forward into the harness `options.apiKey`,
following PRD §9.2.6's priority order (override → provider-native env var → `auth.json`-deferred).
Forwarding happens ONLY for a non-empty resolved credential; empty/whitespace is "not configured".
The default `pi` + `zai` path works with **only** `ZAI_API_KEY` **or** `~/.pi/agent/auth.json`.
`ANTHROPIC_AUTH_TOKEN`/`ANTHROPIC_API_KEY` are accepted **only** for the `anthropic` provider.

**Deliverable**:
1. **`src/config/constants.ts` (MODIFIED)** — add `PRP_API_KEY` env-var-name constant (optional override source).
2. **`src/config/environment.ts` (MODIFIED)** — add exported `getResolvedProvider()`; rewrite
   `configureEnvironment()` to (a) demote the `ANTHROPIC_AUTH_TOKEN`→`ANTHROPIC_API_KEY` mapping to a
   provider-conditional alias (`anthropic` only) and (b) default `ANTHROPIC_BASE_URL` to the z.ai
   endpoint ONLY when the provider is `zai`. Update JSDoc.
3. **`src/config/harness.ts` (MODIFIED)** — add `resolveApiKeyForProvider(provider, options?)` (uses
   pi's `getEnvApiKey`); rewrite `ensureHarnessInitialized()` to source `apiKey` from the resolver and
   forward `{ apiKey }` ONLY when non-empty; source `configureHarness()` Step-5 `harnessDefaults['claude-code'].apiKey`
   from `resolveApiKeyForProvider('anthropic')`. Add JSDoc.
4. **`src/agents/agent-factory.ts` (MODIFIED, minimal)** — `createBaseConfig()` `config.env.ANTHROPIC_API_KEY`
   sourced from the resolver (provider-aware) instead of the raw Anthropic env capture (eliminates the
   Anthropic-shell empty-string shadowing named in PRD §9.2.6 #3).
5. **`package.json` (MODIFIED)** — add `"@earendil-works/pi-ai": "^0.79.8"` to `dependencies` (the
   `getEnvApiKey` import is NOT re-exported by `groundswell`/`pi-coding-agent` and not resolvable from
   root today — see verified_facts.md §1).
6. **`tests/unit/config/auth-resolver.test.ts` (NEW)** — coverage-sufficient unit tests for the resolver
   + provider-conditional `configureEnvironment` behavior (override wins; `ZAI_API_KEY` for `zai`;
   empty/whitespace→undefined; `anthropic` provider via `getEnvApiKey`). The comprehensive resolution
   matrix + `auth.json`-on-disk tests are owned by **T2.S3**.
7. **Existing tests UPDATED** — `tests/unit/config/{harness-config,harness-provider-compat,environment}.test.ts`
   to pass under the new provider-aware model; `endpoint-guard.test.ts` re-verified green (no behaviour change).
8. **Docs (Mode A)** — `.env.example` lines 9–17 / 24–25 rewritten (`pi /login` / `ZAI_API_KEY` primary;
   `ANTHROPIC_AUTH_TOKEN` demoted); `docs/CONFIGURATION.md` auth prose refreshed (lines ~40, 56–71,
   281–285, 412–425).

**Success Definition** (maps to PRD §9.2.6 + the work-item OUTPUT contract):
- Default `pi` + `zai` run succeeds with ONLY `ZAI_API_KEY` set (no Anthropic env var): the resolver
  returns the `ZAI` value; `ensureHarnessInitialized` forwards it.
- Default `pi` + `zai` run succeeds with ONLY a valid `~/.pi/agent/auth.json` (no env vars): the
  resolver returns `undefined`; `ensureHarnessInitialized` forwards `undefined`; pi's file-backed
  `AuthStorage` (once T2.S2 lands) resolves natively. *(With T2.S2 absent, this path is caught by the
  T3 preflight — not a T2.S1 regression.)*
- `ANTHROPIC_AUTH_TOKEN` is mapped to `ANTHROPIC_API_KEY` ONLY when the provider is `anthropic`; it is
  NOT consulted for the default `zai` path and is never a hard requirement.
- Empty/whitespace-only `ZAI_API_KEY` / `PRP_API_KEY` / Anthropic vars are treated as "not configured"
  (resolver returns `undefined`; nothing fake is forwarded).
- `ANTHROPIC_BASE_URL` still defaults to `https://api.z.ai/api/anthropic` for `zai`; the §9.2.4
  `endpoint-guard.ts` safeguard is untouched and green.
- `npm run validate` passes; `npm run test:coverage` keeps 100% on the new resolver code.
- T2.S1 exports `resolveApiKeyForProvider` + `getResolvedProvider` (T3's preflight hard-depends on both).

## User Persona (if applicable)

**Target User**: Every `hack` user — especially the `pi`-default user who authenticated with
`pi /login` (and has `~/.pi/agent/auth.json`) or `export ZAI_API_KEY=…`, and was previously
**invisible** to the pipeline (it gated on `ANTHROPIC_AUTH_TOKEN`).

**Use Case**: A user runs `pi /login` once, then `hack run PRD.md`. Today this fails deep inside
`decomposePRD` with `No API key found for zai.` — because hacky-hack forwarded only the Anthropic
env var. After T2.S1 (+T2.S2), the same `pi /login` credential is honored.

**User Journey**: `pi /login` (or `export ZAI_API_KEY=…`) → `hack run PRD.md` → `configureEnvironment()`
(no Anthropic mapping for `zai`) → `ensureHarnessInitialized()` → resolver finds `ZAI_API_KEY` (or
defers to `auth.json`) → `registry.initializeProvider('pi', { apiKey })` → agents run.

**Pain Points Addressed**: (1) the unnatural hard gate on Anthropic-shell env vars for a vendor-neutral
`pi`+`zai` default; (2) the silent `auth.json` invisibility; (3) the `?? ''` empty-string shadowing that
obscured "unset" from "misconfigured" (PRD §9.2.6 problem #1–#3).

## Why

- **Business value**: Delivers the provider-agnostic auth model (PRD §9.2.6) that makes the
  vendor-neutral `pi` harness the true default. This is the keystone of the auth workstream
  (T2.S1 → T2.S2 → T2.S3; T2.S1 → T3.S1 → T3.S2).
- **Integration with existing features**: `resolveApiKeyForProvider` + `getResolvedProvider` are the
  shared seam consumed by `ensureHarnessInitialized()` (this task) and by the T3 fail-fast preflight
  (PRD §9.2.7). The Groundswell-side `auth.json` honoring (T2.S2) is the other half — T2.S1 is correct
  with or without it (see verified_facts.md §11).
- **Problems solved / for whom**: For every `pi`+`zai` user (the default) — removes the Anthropic gate
  and the fake empty-string forwarding. For Anthropic loyalists (`claude-code` harness / `anthropic/*`
  models) — the backward-compat `ANTHROPIC_AUTH_TOKEN` alias keeps working.

## What

User-visible behavior: the default `pi`+`zai` run no longer requires an Anthropic env var; a `pi /login`
or `ZAI_API_KEY` credential is sufficient. Anthropic env vars are optional, `anthropic`-provider-only.
Error surfacing of a genuinely-unconfigured credential is deferred to the T3 preflight (not in scope here);
T2.S1 just stops forwarding fake/empty credentials and stops gating on Anthropic.

### Success Criteria

- [ ] Default `pi`+`zai`: `resolveApiKeyForProvider('zai')` returns the `ZAI_API_KEY` value (no Anthropic var set).
- [ ] Empty/whitespace `ZAI_API_KEY` → resolver returns `undefined` (whitespace-only == "not configured").
- [ ] `PRP_API_KEY` override wins over `ZAI_API_KEY` when both set.
- [ ] `configureEnvironment()` does NOT map `ANTHROPIC_AUTH_TOKEN`→`ANTHROPIC_API_KEY` when provider is `zai`.
- [ ] `configureEnvironment()` DOES map the alias when provider is `anthropic`.
- [ ] `configureEnvironment()` defaults `ANTHROPIC_BASE_URL` to z.ai ONLY when provider is `zai`.
- [ ] `ensureHarnessInitialized()` forwards `{ apiKey }` ONLY when the resolver returns non-empty; else `undefined`.
- [ ] `configureHarness()` `harnessDefaults['claude-code'].apiKey` sourced from `resolveApiKeyForProvider('anthropic')`.
- [ ] `endpoint-guard.ts` untouched; `endpoint-guard.test.ts` green.
- [ ] `npm run validate` passes; new resolver code at 100% coverage.
- [ ] `.env.example` + `docs/CONFIGURATION.md` rewritten (Mode A); JSDoc on new functions.

## All Needed Context

### Context Completeness Check

If someone knew nothing about this codebase, would they have everything needed to implement this
successfully? **Yes.** The authoritative contract is `architecture/implementation_notes.md §T2.S1`;
the pi-side API surface (env-var mapping, `AuthStorage`, `getEnvApiKey`) is `architecture/groundswell_auth_api.md`
§2/§5/§6; every load-bearing empirical finding (incl. the **non-functional import path** and the
chosen fix) is in `P7M1T2S1/research/verified_facts.md`. The only files to edit are listed under
Deliverable above. The PRD binding is §9.2.6 (+§9.2.2/§9.2.4/§9.2.7/§9.4.2).

### Documentation & References

```yaml
# MUST READ — authoritative, file-level contract for this exact subtask
- file: plan/007_8783a1f5e14a/architecture/implementation_notes.md
  why: "§T2.S1 is the verbatim contract — resolver priority order, the 'forward only when non-empty'
        rule, the ANTHROPIC_AUTH_TOKEN demotion, the provider-aware BASE_URL, and the exact list of
        existing tests to update."
  section: "T2 — Provider-Agnostic Authentication Model → T2.S1"
  critical: "The contract says 'Import getEnvApiKey from @earendil-works/pi-ai (re-exported through
             pi-coding-agent)'. That RE-EXPORT DOES NOT EXIST and pi-ai is NOT resolvable from root
             (verified_facts.md §1). Add @earendil-works/pi-ai as a direct dep instead."

# MUST READ — the pi-side auth/env API surface (verbatim from node_modules)
- file: plan/007_8783a1f5e14a/architecture/groundswell_auth_api.md
  why: "§2 AuthStorage class + how the pieces connect (auth.json resolution is pi's job, NOT hacky-hack's);
        §5 the env-var mapping (zai→ZAI_API_KEY; anthropic→ANTHROPIC_OAUTH_TOKEN then ANTHROPIC_API_KEY) and
        getEnvApiKey semantics (pure, sync, returns the VALUE); §6 getAgentDir()/PI_CODING_AGENT_DIR override."
  section: "§2, §5, §6"

# MUST READ — every load-bearing assumption, empirically verified
- file: plan/007_8783a1f5e14a/P7M1T2S1/research/verified_facts.md
  why: "The import-resolution finding + chosen fix (§1), getEnvApiKey semantics (§2), the two `?? ''` sites
        (§4), configureEnvironment changes + test impact (§5), harnessDefaults update (§6), the auth.json
        defer-to-pi seam (§7), the test list (§9), validation commands (§10), scope boundaries (§11)."
  section: "§1–§12 (read all)"

# MUST READ — the PRD requirement being satisfied (binding)
- file: PRD.md
  why: "§9.2.6 (resolution order, AUTH_TOKEN demotion, empty-string policy, provider-aware BASE_URL);
        §9.2.7 (empty/whitespace == not configured); §9.2.2 (env-var summary); §9.2.4 (endpoint safeguard,
        untouched); §9.4.2 (configureHarnesses harnessDefaults)."
  section: "9.2 Environment Configuration → 9.2.6 (primary), 9.2.7, 9.2.2, 9.2.4; 9.4.2"

# MUST READ — the file under edit (resolver home + ensureHarnessInitialized forwarding point)
- file: src/config/harness.ts
  why: "THE primary edit target. Add resolveApiKeyForProvider(); rewrite ensureHarnessInitialized() to use it;
        source configureHarness() Step-5 harnessDefaults['claude-code'].apiKey from it."
  pattern: "Keep the registry has()/register() idempotent guard and the HarnessProviderMismatchError check.
            The provider resolution pattern getModel('sonnet').split('/')[0] already exists at Step 4 — extract
            it to getResolvedProvider() in environment.ts and reuse."
  gotcha: "resolveApiKeyForProvider MUST be exported (T3's preflight imports it). getEnvApiKey is sync+pure —
           safe to call in configureHarness() too."

# MUST READ — the file under edit (configureEnvironment + getResolvedProvider home)
- file: src/config/environment.ts
  why: "Add getResolvedProvider(); rewrite configureEnvironment() to be provider-conditional (AUTH_TOKEN alias
        for anthropic only; BASE_URL z.ai-default for zai only)."
  pattern: "Keep getModel()/qualifyModel() unchanged. getResolvedProvider() = getModel('sonnet').split('/')[0]."
  gotcha: "No circular import: environment.ts imports nothing from harness.ts. Don't make validateEnvironment()
           provider-aware in this task (it still checks ANTHROPIC_API_KEY/BASE_URL for back-compat; the T3
           preflight replaces its startup role)."

# MUST READ — the `?? ''` shadowing site (PRD §9.2.6 problem #3 names createBaseConfig)
- file: src/agents/agent-factory.ts
  why: "createBaseConfig() config.env.ANTHROPIC_API_KEY currently does process.env.ANTHROPIC_API_KEY ?? ''
        (the shadow). Source it from resolveApiKeyForProvider(getResolvedProvider()) instead. MINIMAL change;
        keep the AgentConfig.env field type `string`."
  section: "createBaseConfig() ~L156-185; AgentConfig interface ~L100-113"
  gotcha: "Do NOT make env.ANTHROPIC_API_KEY optional (ripples the type + all createXxxConfig callers + tests).
           Keep a terminal ?? '' ONLY as an honest 'genuinely unconfigured' default (the T3 preflight aborts
           before createBaseConfig runs with nothing configured). ANTHROPIC_BASE_URL stays from process.env
           (configureEnvironment already made it provider-aware)."

# MUST READ — the file under edit (add PRP_API_KEY constant)
- file: src/config/constants.ts
  why: "Add `export const PRP_API_KEY = 'PRP_API_KEY';` (the optional override env-var NAME), mirroring the
        existing PRP_AGENT_HARNESS/RESEARCH_TIMEOUT pattern (env-var NAME as a const + JSDoc)."
  pattern: "Follow the PRP_AGENT_HARNESS / RESEARCH_TIMEOUT block style exactly (NAME const + @remarks +
            @example). Do NOT add a reader getter here — the resolver reads it directly."

# MUST READ — MUST stay intact (do NOT modify)
- file: src/config/endpoint-guard.ts
  why: "The §9.2.4 provider-endpoint safeguard. It is orthogonal to auth resolution and must be unchanged.
        The provider-aware BASE_URL defaulting keeps the zai default on the z.ai endpoint → guard stays green."
  pattern: "READ ONLY. No edits."

# MUST READ — the existing tests to UPDATE (assertion shapes + mock structure)
- file: tests/unit/config/harness-config.test.ts
  why: "Mocks 'groundswell' (NOT pi-ai → real getEnvApiKey runs). Asserts exact configureHarnesses args incl.
        harnessDefaults['claude-code'].apiKey. With the resolver sourcing it from resolveApiKeyForProvider('anthropic'),
        the stubbed ANTHROPIC_API_KEY still flows through (getEnvApiKey reads it) — re-verify the assertion holds
        and update comments to reflect provider-aware sourcing."
- file: tests/unit/config/harness-provider-compat.test.ts
  why: "Same mock shape. Same harnessDefaults assertion. Same update."
- file: tests/unit/config/environment.test.ts
  why: "Asserts unconditional AUTH_TOKEN→API_KEY mapping and unconditional z.ai BASE_URL default. UPDATE to
        provider-conditional: mapping only for anthropic; add a zai case where AUTH_TOKEN is NOT mapped; add
        an anthropic-provider case where BASE_URL is NOT forced to z.ai."

# REFERENCE — pi-ai env-api-keys.js (the mapping the resolver uses)
- url: https://www.npmjs.com/package/@earendil-works/pi-ai
  why: "Confirms @earendil-works/pi-ai is a published package (latest 0.80.2; nested 0.79.8) — adding it as a
        direct dep is valid. The zai/anthropic env-var names are identical across these versions."
  critical: "Verified resolvable after `npm install`. getEnvApiKey is sync + pure (reads process.env only)."
```

### Current Codebase tree (relevant slice)

```bash
src/
  config/
    constants.ts          # ← EDIT: add PRP_API_KEY
    environment.ts        # ← EDIT: add getResolvedProvider(); provider-aware configureEnvironment()
    harness.ts            # ← EDIT: add resolveApiKeyForProvider(); rewrite ensureHarnessInitialized(); harnessDefaults apiKey
    endpoint-guard.ts     # READ ONLY (must stay intact)
    types.ts              # unchanged (HarnessProviderMismatchError, AgentHarness, ModelProvider already exist)
  agents/
    agent-factory.ts      # ← EDIT (minimal): createBaseConfig config.env.ANTHROPIC_API_KEY via resolver
tests/
  unit/
    config/
      harness.test.ts            # constants/types — no change
      harness-config.test.ts     # ← UPDATE (configureHarnesses args / harnessDefaults)
      harness-provider-compat.test.ts  # ← UPDATE
      environment.test.ts        # ← UPDATE (provider-conditional mapping + BASE_URL)
      endpoint-guard.test.ts     # re-verify green (no change)
      auth-resolver.test.ts      # ← NEW (coverage-sufficient resolver + configureEnvironment tests)
package.json             # ← EDIT: add "@earendil-works/pi-ai": "^0.79.8" to dependencies
.env.example             # ← EDIT (Mode A): lines 9-17 / 24-25
docs/CONFIGURATION.md    # ← EDIT (Mode A): lines ~40, 56-71, 281-285, 412-425
plan/007_8783a1f5e14a/
  architecture/implementation_notes.md   # §T2.S1 — authoritative contract
  architecture/groundswell_auth_api.md   # §2/§5/§6 — pi-side auth/env API surface
  P7M1T2S1/research/verified_facts.md    # every empirical finding
  P7M1T2S1/PRP.md                        # this file
```

### Desired Codebase tree with files added/changed

```bash
src/config/constants.ts                 # MODIFIED — +PRP_API_KEY
src/config/environment.ts               # MODIFIED — +getResolvedProvider(); provider-aware configureEnvironment()
src/config/harness.ts                   # MODIFIED — +resolveApiKeyForProvider(); resolver-driven ensureHarnessInitialized()
src/agents/agent-factory.ts             # MODIFIED (minimal) — createBaseConfig config.env.ANTHROPIC_API_KEY via resolver
tests/unit/config/auth-resolver.test.ts # NEW      — resolver + provider-conditional configureEnvironment coverage
tests/unit/config/harness-config.test.ts        # UPDATED
tests/unit/config/harness-provider-compat.test.ts # UPDATED
tests/unit/config/environment.test.ts   # UPDATED
package.json                            # MODIFIED — +@earendil-works/pi-ai dependency
.env.example                            # MODIFIED (Mode A docs)
docs/CONFIGURATION.md                   # MODIFIED (Mode A docs)
# (PRD.md, tasks.json, prd_snapshot.md, .gitignore — READ ONLY, never touch)
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — The contract's stated import path is NON-FUNCTIONAL. implementation_notes.md §T2.S1 says
// "Import getEnvApiKey from @earendil-works/pi-ai (re-exported through pi-coding-agent)." VERIFIED:
//   - pi-coding-agent/dist/index.d.ts re-exports AuthStorage/ModelRegistry/etc. but NOT getEnvApiKey/findEnvKeys.
//   - node -e "require.resolve('@earendil-works/pi-ai')" → MODULE_NOT_FOUND (it's a NESTED transitive dep).
// FIX: add "@earendil-works/pi-ai": "^0.79.8" to package.json dependencies, then
//   `import { getEnvApiKey } from '@earendil-works/pi-ai';`. It IS published (latest 0.80.2; nested 0.79.8);
//   the zai/anthropic env names are identical across versions. (verified_facts.md §1.)

// CRITICAL — getEnvApiKey returns the RAW value (no trim). For zai → process.env.ZAI_API_KEY; for anthropic →
// ANTHROPIC_OAUTH_TOKEN then ANTHROPIC_API_KEY. The resolver MUST `.trim()` and treat empty/whitespace as
// "not configured" (PRD §9.2.7 empty-string policy). Returning '' or '   ' would re-introduce the shadow.

// CRITICAL — Forward an override ONLY when non-empty. Replace `apiKey ? { apiKey } : undefined` (harness.ts:129)
// with resolver-driven: `const apiKey = resolveApiKeyForProvider(provider); registry.initializeProvider('pi',
// apiKey ? { apiKey } : undefined)`. NEVER thread an empty/whitespace string into harness options.

// CRITICAL — auth.json is pi's job, NOT hacky-hack's. When only ~/.pi/agent/auth.json is present (no override,
// no env var), resolveApiKeyForProvider() returns undefined and ensureHarnessInitialized forwards undefined →
// pi's file-backed AuthStorage (T2.S2) resolves natively. T2.S1 MUST NOT read auth.json itself (would duplicate
// pi's resolution and drift). (groundswell_auth_api.md §2 "how the pieces connect"; verified_facts.md §7.)

// CRITICAL — No circular import. environment.ts exports getResolvedProvider() + getModel(); harness.ts imports
// both (it already imports getModel). environment.ts imports NOTHING from harness.ts. Do not invert this.

// GOTCHA — getResolvedProvider() reads getModel('sonnet') which reads ANTHROPIC_DEFAULT_SONNET_MODEL. In tests
// where that env is unset, provider defaults to 'zai' (qualifyModel('glm-5.2','zai') → 'zai/glm-5.2' → 'zai').
// An 'anthropic/*' override → 'anthropic'. Set the env explicitly in tests that need the anthropic branch.

// GOTCHA — configureEnvironment() must run BEFORE configureHarness()/ensureHarnessInitialized() (existing order
// in src/index.ts:113-118). getResolvedProvider() reads env at call time, so provider overrides take effect.

// GOTCHA — harness-config.test.ts / harness-provider-compat.test.ts vi.mock('groundswell') but do NOT mock
// '@earendil-works/pi-ai'. The real getEnvApiKey runs (reads process.env). This is DESIRED (tests the real
// mapping) but REQUIRES the dep installed first. Their beforeEach stubs ANTHROPIC_API_KEY — with the resolver
// sourcing claude-code's apiKey from resolveApiKeyForProvider('anthropic'), the stub still flows through
// getEnvApiKey → ANTHROPIC_API_KEY. Re-verify the { 'claude-code': { apiKey: 'stubbed-key' } } assertion holds.

// GOTCHA — createBaseConfig config.env.ANTHROPIC_API_KEY is typed `readonly string` (inline AgentConfig interface
// ~L100-113). Do NOT make it optional (ripples the type + all createXxxConfig callers + their tests). Source it
// from the resolver and keep a terminal `?? ''` ONLY as an honest 'genuinely unconfigured' default (the T3
// preflight aborts before createBaseConfig runs with nothing configured). This is the minimal, ripple-free way
// to honor "eliminate the Anthropic-shell `?? ''` shadowing" without a wider refactor.

// GOTCHA — endpoint-guard.ts (§9.2.4) MUST stay intact and green. The provider-aware BASE_URL default keeps the
// zai default on https://api.z.ai/api/anthropic. Do not touch endpoint-guard.ts or its test's behavior.

// GOTCHA — coverage gate is 100% (vitest.config.ts). Every new resolver branch (override-wins, provider-env,
// none, trim-empty, anthropic-via-getEnvApiKey) AND every configureEnvironment branch (auth_token mapped for
// anthropic / NOT for zai; base_url defaulted for zai / NOT for anthropic) must be hit by tests. T2.S3 owns the
// full resolution matrix + auth.json-on-disk seeding; T2.S1 adds only coverage-sufficient tests.
```

## Implementation Blueprint

### Data models and structure

No persistence/data-model changes. The new internal shapes are small pure functions + one constant:

```ts
// ===== src/config/constants.ts =====
/** Environment variable name: explicit API-key override for the resolved provider (PRD §9.2.6 #1, optional). */
export const PRP_API_KEY = 'PRP_API_KEY';

// ===== src/config/environment.ts =====
/**
 * Resolve the selected LLM provider id from the resolved model string (PRD §9.2.3 / §9.4.3).
 * @returns e.g. 'zai' (default) or 'anthropic' (from an 'anthropic/*' model override).
 */
export function getResolvedProvider(): string {
  return getModel('sonnet').split('/')[0];
}

// ===== src/config/harness.ts =====
import { getEnvApiKey } from '@earendil-works/pi-ai';
import { getResolvedProvider } from './environment.js';
import { PRP_API_KEY } from './constants.js';

/**
 * Resolve the API key to forward into the harness options for a given provider (PRD §9.2.6).
 *
 * Priority (first NON-EMPTY wins; whitespace-only == "not configured"):
 *   1. Explicit override — options.apiKey, else process.env.PRP_API_KEY.
 *   2. Provider-native env var — pi's getEnvApiKey(provider) (ZAI_API_KEY for zai;
 *      ANTHROPIC_OAUTH_TOKEN then ANTHROPIC_API_KEY for anthropic).
 *   3. ~/.pi/agent/auth.json — hacky-hack forwards NOTHING; pi's file-backed AuthStorage
 *      (Groundswell T2.S2) resolves natively. ⇒ returns undefined here.
 *
 * @returns The non-empty resolved credential, or undefined (forward nothing; let pi resolve).
 */
export function resolveApiKeyForProvider(
  provider: string,
  options?: { override?: string }
): string | undefined {
  // 1. Explicit override (highest precedence, non-empty only).
  const override = (options?.override ?? process.env[PRP_API_KEY])?.trim();
  if (override) return override;

  // 2. Provider-native env var (pi's mapping; trimmed; empty == not configured).
  const envVal = getEnvApiKey(provider)?.trim();
  if (envVal) return envVal;

  // 3. auth.json — deferred to pi's file-backed AuthStorage (T2.S2). Forward nothing.
  return undefined;
}
```

`ensureHarnessInitialized()` and `configureHarness()` consume it (see Patterns). `configureEnvironment()`
becomes provider-conditional (see Patterns).

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: ADD the @earendil-works/pi-ai dependency
  - EDIT package.json → dependencies: add "@earendil-works/pi-ai": "^0.79.8".
  - RUN: npm install   # hoists/resolves pi-ai; getEnvApiKey now importable from src.
  - VERIFY: node -e "console.log(typeof require('@earendil-works/pi-ai').getEnvApiKey)" → 'function'.
  - WHY: getEnvApiKey is NOT re-exported by groundswell/pi-coding-agent and pi-ai is not resolvable from
         root today (verified_facts.md §1). This is the enabling step; nothing else compiles without it.
  - DEPENDENCY: none (do this FIRST).

Task 1: ADD PRP_API_KEY constant to src/config/constants.ts
  - ADD: `export const PRP_API_KEY = 'PRP_API_KEY';` with JSDoc (@remarks: optional override env-var NAME;
         value read at runtime by resolveApiKeyForProvider; not required).
  - FOLLOW pattern: the existing PRP_AGENT_HARNESS / RESEARCH_TIMEOUT block (NAME const + @remarks + @example).
  - PLACEMENT: near the other env-var-name constants (e.g. after PRP_AGENT_HARNESS or in the auth section).
  - DEPENDENCY: Task 0.

Task 2: ADD getResolvedProvider() + provider-aware configureEnvironment() to src/config/environment.ts
  - ADD: `export function getResolvedProvider(): string { return getModel('sonnet').split('/')[0]; }`
         with JSDoc (PRD §9.2.3/§9.4.3; default 'zai').
  - REWRITE configureEnvironment():
      * AUTH_TOKEN alias: `if (getResolvedProvider() === 'anthropic' && process.env.ANTHROPIC_AUTH_TOKEN &&
        !process.env.ANTHROPIC_API_KEY) process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_AUTH_TOKEN;`
        (was unconditional — now anthropic-only; PRD §9.2.6 AUTH_TOKEN demotion).
      * BASE_URL: `if (!process.env.ANTHROPIC_BASE_URL && getResolvedProvider() === 'zai')
        process.env.ANTHROPIC_BASE_URL = DEFAULT_BASE_URL;` (z.ai ONLY when zai; was unconditional).
  - UPDATE JSDoc on configureEnvironment(): state the provider-conditional behavior; drop "ANTHROPIC_AUTH_TOKEN
        is the required credential" framing.
  - KEEP getModel()/qualifyModel()/validateEnvironment() UNCHANGED. (validateEnvironment's startup role is
        superseded by the T3 preflight; do not touch it here.)
  - DEPENDENCY: Task 1 (for PRP_API_KEY if referenced; getResolvedProvider needs getModel only).

Task 3: ADD resolveApiKeyForProvider() + rewire harness.ts to src/config/harness.ts
  - ADD import: `import { getEnvApiKey } from '@earendil-works/pi-ai';`
  - ADD import: `import { getResolvedProvider } from './environment.js';` and `PRP_API_KEY` from './constants.js'.
  - ADD: resolveApiKeyForProvider(provider, options?) (see Data models). Add full JSDoc (priority order + the
        auth.json-defer-to-pi note). EXPORT it (T3 imports it).
  - REWRITE ensureHarnessInitialized(): replace `const apiKey = process.env.ANTHROPIC_API_KEY;` with
        `const apiKey = resolveApiKeyForProvider(getResolvedProvider());` keep
        `await registry.initializeProvider('pi', apiKey ? { apiKey } : undefined);`.
  - REWRITE configureHarness() Step 5 harnessDefaults: `'claude-code': { apiKey:
        resolveApiKeyForProvider('anthropic') ?? undefined }` (was process.env.ANTHROPIC_API_KEY). claude-code
        is Anthropic-only → resolve the anthropic credential.
  - KEEP: the SUPPORTED_HARNESSES validation, the HarnessProviderMismatchError check, the registry has()/register()
        idempotent guard, defaultHarness/defaultModelProvider.
  - DEPENDENCY: Tasks 0-2.

Task 4: MINIMAL createBaseConfig fix in src/agents/agent-factory.ts
  - EDIT createBaseConfig() config.env:
        ANTHROPIC_API_KEY: resolveApiKeyForProvider(getResolvedProvider()) ?? '',
        ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL ?? '',
  - ADD imports: resolveApiKeyForProvider from '../config/harness.js'; getResolvedProvider from '../config/environment.js'.
  - KEEP the AgentConfig.env field type `string` (do NOT make optional — ripples types + callers + tests).
  - WHY: eliminates the Anthropic-shell `process.env.ANTHROPIC_API_KEY ?? ''` shadow (PRD §9.2.6 #3); the value
        is now provider-aware and non-empty whenever a credential is resolvable. The residual `?? ''` is an honest
        'genuinely unconfigured' terminal (T3 preflight aborts before this point with nothing configured).
  - DEPENDENCY: Task 3.

Task 5: CREATE tests/unit/config/auth-resolver.test.ts (coverage-sufficient)
  - FOLLOW pattern: tests/unit/config/environment.test.ts (vitest globals; vi.stubEnv; afterEach vi.unstubAllEnvs).
  - describe 'resolveApiKeyForProvider':
      * it 'returns PRP_API_KEY override when set (wins over provider env)'  (stub both PRP_API_KEY + ZAI_API_KEY).
      * it 'returns ZAI_API_KEY for zai when no override' (clear Anthropic vars).
      * it 'returns undefined when no credential configured' (clear all).
      * it 'treats whitespace-only ZAI_API_KEY as not configured (returns undefined)'.
      * it 'returns ANTHROPIC_API_KEY for anthropic provider (via getEnvApiKey)' (stub ANTHROPIC_API_KEY).
      * it 'options.override wins over PRP_API_KEY env'.
  - describe 'configureEnvironment (provider-conditional)':
      * it 'does NOT map ANTHROPIC_AUTH_TOKEN→ANTHROPIC_API_KEY for default zai provider' (sonnet model unset → zai).
      * it 'maps ANTHROPIC_AUTH_TOKEN→ANTHROPIC_API_KEY only when provider is anthropic' (stub ANTHROPIC_DEFAULT_SONNET_MODEL='anthropic/x').
      * it 'defaults ANTHROPIC_BASE_URL to z.ai for zai'.
      * it 'does NOT force z.ai BASE_URL for anthropic provider'.
  - NAMING: tests/unit/config/auth-resolver.test.ts. NO disk/auth.json seeding (that's T2.S3).
  - COVERAGE: must hit every new branch (100% gate). Add a one-line assertion per uncovered branch if needed.
  - DEPENDENCY: Tasks 1-3.

Task 6: UPDATE existing tests under the new model
  - tests/unit/config/environment.test.ts:
      * 'should map AUTH_TOKEN to API_KEY when API_KEY is not set' → assert it maps ONLY for anthropic provider;
        add the inverse (zai → NOT mapped). Keep the "preserve existing API_KEY" + idempotent + custom-BASE_URL cases.
      * add anthropic-provider BASE_URL case (z.ai NOT forced).
  - tests/unit/config/harness-config.test.ts + harness-provider-compat.test.ts:
      * re-verify the `{ 'claude-code': { apiKey: 'stubbed-key' } }` assertion still holds (resolver sources it
        via getEnvApiKey('anthropic') → reads the stubbed ANTHROPIC_API_KEY). Update comments to state the
        provider-aware sourcing. If a case sets only ZAI_API_KEY (no Anthropic var), the claude-code apiKey
        becomes undefined — assert accordingly.
      * keep all HarnessProviderMismatchError / invalid-id / skip-register assertions.
  - tests/unit/config/endpoint-guard.test.ts: NO change; re-run to confirm green.
  - DEPENDENCY: Tasks 2-3 (and Task 5 for cross-checks).

Task 7: DOCS (Mode A) — ride with the work
  - .env.example (lines 9-17 / 24-25): rewrite the 'API AUTHENTICATION' block so the PRIMARY path is
        `pi /login` (writes ~/.pi/agent/auth.json) OR `export ZAI_API_KEY=…`; DEMOTE ANTHROPIC_AUTH_TOKEN /
        ANTHROPIC_API_KEY to optional `anthropic`-provider-only aliases; add a commented `# PRP_API_KEY=`
        override line. Keep the MODEL CONFIGURATION + ADVANCED blocks unchanged.
  - docs/CONFIGURATION.md (lines ~40, 56-71, 281-285, 412-425): refresh the auth prose — make pi /login /
        ZAI_API_KEY the documented primary; demote the ANTHROPIC_AUTH_TOKEN→ANTHROPIC_API_KEY mapping to an
        optional anthropic-provider alias; update the env-var table (mark ANTHROPIC_* as optional/anthropic-only;
        add ZAI_API_KEY as the default-path var); update the troubleshooting example to the new resolution order.
  - JSDoc on resolveApiKeyForProvider + getResolvedProvider + configureEnvironment (Tasks 2-3).
  - DEPENDENCY: Tasks 1-4.

Task 8: VALIDATE (build not required for unit tests; run the full gate)
  - RUN: npm run validate   # lint + format:check + typecheck + test:run
  - RUN: npm run test:coverage   # 100% on new resolver/configureEnvironment code
  - RUN: npx vitest run tests/unit/config/   # the config suite in isolation
  - RUN (acceptance greps): see Validation Loop Level 3.
  - DEPENDENCY: Tasks 5-7.
```

### Implementation Patterns & Key Details

```ts
// ── resolveApiKeyForProvider() — the shared resolver (harness.ts) ─────────────────────────
import { getEnvApiKey } from '@earendil-works/pi-ai';
import { PRP_API_KEY } from './constants.js';

export function resolveApiKeyForProvider(
  provider: string,
  options?: { override?: string }
): string | undefined {
  // 1. Explicit override — highest precedence; non-empty only.
  const override = (options?.override ?? process.env[PRP_API_KEY])?.trim();
  if (override) return override;
  // 2. Provider-native env var (pi's mapping). zai→ZAI_API_KEY; anthropic→OAUTH_TOKEN then API_KEY.
  const envVal = getEnvApiKey(provider)?.trim();
  if (envVal) return envVal;
  // 3. auth.json — pi's file-backed AuthStorage resolves natively (T2.S2). hacky-hack forwards nothing.
  return undefined;
}

// ── ensureHarnessInitialized() — forward ONLY a non-empty resolved credential ──────────────
export async function ensureHarnessInitialized(): Promise<void> {
  const registry = HarnessRegistry.getInstance();
  if (!registry.has('pi')) registry.register(new PiHarness());
  const apiKey = resolveApiKeyForProvider(getResolvedProvider()); // provider-aware; ''/ws → undefined
  await registry.initializeProvider('pi', apiKey ? { apiKey } : undefined); // forward only when non-empty
}

// ── configureHarness() Step 5 — claude-code apiKey from the resolver ───────────────────────
configureHarnesses({
  defaultHarness: harness,
  defaultModelProvider: DEFAULT_MODEL_PROVIDER,
  harnessDefaults: {
    'claude-code': { apiKey: resolveApiKeyForProvider('anthropic') ?? undefined }, // Anthropic-only harness
  },
});

// ── configureEnvironment() — provider-conditional (environment.ts) ────────────────────────
export function configureEnvironment(): void {
  const provider = getResolvedProvider();
  // ANTHROPIC_AUTH_TOKEN demoted to a backward-compat alias for the anthropic provider ONLY.
  if (
    provider === 'anthropic' &&
    process.env.ANTHROPIC_AUTH_TOKEN &&
    !process.env.ANTHROPIC_API_KEY
  ) {
    process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_AUTH_TOKEN;
  }
  // Provider-aware base URL: z.ai default ONLY for zai.
  if (!process.env.ANTHROPIC_BASE_URL && provider === 'zai') {
    process.env.ANTHROPIC_BASE_URL = DEFAULT_BASE_URL;
  }
}

// ── createBaseConfig() — provider-aware env capture (agent-factory.ts, MINIMAL) ───────────
env: {
  ANTHROPIC_API_KEY: resolveApiKeyForProvider(getResolvedProvider()) ?? '', // provider-aware; honest terminal
  ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL ?? '',
},

// ── auth-resolver.test.ts — the ZAI_API_KEY-only success case (the OUTPUT contract) ───────
it('returns ZAI_API_KEY for zai when no override (no Anthropic var required)', () => {
  vi.stubEnv('ZAI_API_KEY', 'zai-key-123');
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_AUTH_TOKEN;
  delete process.env.PRP_API_KEY;
  expect(resolveApiKeyForProvider('zai')).toBe('zai-key-123');
});

it('treats whitespace-only ZAI_API_KEY as not configured', () => {
  vi.stubEnv('ZAI_API_KEY', '   ');
  delete process.env.PRP_API_KEY;
  expect(resolveApiKeyForProvider('zai')).toBeUndefined();
});
```

### Integration Points

```yaml
CODE (src/config/):
  constants.ts:    ADD `PRP_API_KEY` const (+ JSDoc).
  environment.ts:  ADD `getResolvedProvider()`; REWRITE `configureEnvironment()` (provider-conditional).
  harness.ts:      ADD `resolveApiKeyForProvider()` (EXPORTED); REWRITE `ensureHarnessInitialized()` + Step-5 harnessDefaults.
                   ADD imports: getEnvApiKey (pi-ai), getResolvedProvider (environment), PRP_API_KEY (constants).

CODE (src/agents/agent-factory.ts):
  createBaseConfig(): config.env.ANTHROPIC_API_KEY ← resolveApiKeyForProvider(getResolvedProvider()) ?? ''.
                      ADD imports: resolveApiKeyForProvider (harness), getResolvedProvider (environment).

DEPENDENCY (package.json):
  dependencies: ADD "@earendil-works/pi-ai": "^0.79.8". Then `npm install`.

CONFIG (.env.example + docs/CONFIGURATION.md):  Mode A docs (Task 7).

TESTS:
  NEW:     tests/unit/config/auth-resolver.test.ts.
  UPDATED: tests/unit/config/{environment,harness-config,harness-provider-compat}.test.ts.
  VERIFY:  tests/unit/config/endpoint-guard.test.ts (no change; must stay green).

NO CHANGES TO:
  src/config/endpoint-guard.ts (§9.2.4 safeguard — READ ONLY)
  src/config/types.ts (HarnessProviderMismatchError / AgentHarness / ModelProvider already defined)
  src/scripts/validate-api.ts (uses configureEnvironment + validateEnvironment — still works; the
    startup preflight role is T3's, not this task's)
  PRD.md, tasks.json, prd_snapshot.md, .gitignore (READ ONLY — never touch)
```

## Validation Loop

> Run after the relevant task group. Fix before proceeding to the next level.

### Level 1: Syntax & Style (after Tasks 0–4)

```bash
npm install               # resolve the new @earendil-works/pi-ai dependency (Task 0)
npm run typecheck         # NodeNext, strict — catches resolver/option-shape + import errors
npm run lint              # eslint . --ext .ts — zero errors
npm run format:check      # run `npm run format` if it complains
```
Expected: all pass. typecheck is the primary catcher of a malformed `getEnvApiKey` import, a
`resolveApiKeyForProvider` signature mismatch, or a stale `process.env.ANTHROPIC_API_KEY` reference
left in `ensureHarnessInitialized`/`createBaseConfig`.

### Level 2: Unit + Coverage (after Tasks 5–6)

```bash
# The new resolver + provider-conditional configureEnvironment suite.
npx vitest run tests/unit/config/auth-resolver.test.ts

# The updated config suites must all pass under the new model.
npx vitest run tests/unit/config/

# Full suite + 100% coverage gate. INSPECT the new resolver/configureEnvironment branch %.
npm run test:coverage
```
Expected: all pass; new resolver + configureEnvironment code at 100% statements/branches/functions/lines.
If a branch is <100%, add a one-line assertion that exercises it (e.g. an `options.override`-beats-`PRP_API_KEY`
case, or an anthropic-provider BASE_URL-not-forced case).

### Level 3: Acceptance greps (the §9.2.6 contract invariants)

```bash
# The authoritative harness-forwarding point must use the resolver (no raw ANTHROPIC_API_KEY read there).
rg -n "process\.env\.ANTHROPIC_API_KEY" src/config/harness.ts
# Expected: ZERO hits in ensureHarnessInitialized (the claude-code harnessDefaults line is now resolver-sourced too).

# The Anthropic-shell shadow in createBaseConfig must be resolver-sourced (no raw process.env.ANTHROPIC_API_KEY ?? '').
rg -n "ANTHROPIC_API_KEY:\s*process\.env\.ANTHROPIC_API_KEY\s*\?\?" src/agents/agent-factory.ts
# Expected: ZERO hits (replaced by resolveApiKeyForProvider(...)).

# The provider-aware resolver + getResolvedProvider must be exported (T3 depends on them).
rg -n "export function resolveApiKeyForProvider|export function getResolvedProvider" src/config/
# Expected: 2 hits (harness.ts + environment.ts).

# getEnvApiKey imported from pi-ai (not the non-functional re-export path).
rg -n "from '@earendil-works/pi-ai'" src/config/harness.ts
# Expected: 1 hit.

# endpoint-guard untouched.
rg -n "transport\s*:|ANTHROPIC_AUTH_TOKEN" src/config/endpoint-guard.ts
# Expected: zero hits (unchanged).
```
Expected: all greps return the stated results.

### Level 4: Behavioral smoke (the OUTPUT success contract)

```bash
# ZAI_API_KEY-only path: the resolver returns the ZAI value with NO Anthropic var.
ZAI_API_KEY=zai-smoke ANTHROPIC_API_KEY= ANTHROPIC_AUTH_TOKEN= npx tsx -e \
  "import('./src/config/harness.js').then(m => console.log(m.resolveApiKeyForProvider('zai')))"
# Expected: zai-smoke

# Override precedence: PRP_API_KEY wins over ZAI_API_KEY.
ZAI_API_KEY=zai PRP_API_KEY=override npx tsx -e \
  "import('./src/config/harness.js').then(m => console.log(m.resolveApiKeyForProvider('zai')))"
# Expected: override

# Whitespace == not configured.
ZAI_API_KEY='   ' npx tsx -e \
  "import('./src/config/harness.js').then(m => console.log(String(m.resolveApiKeyForProvider('zai'))))"
# Expected: undefined

# Provider resolution default.
npx tsx -e "import('./src/config/environment.js').then(m => console.log(m.getResolvedProvider()))"
# Expected: zai   (when ANTHROPIC_DEFAULT_SONNET_MODEL unset)
```
Expected: each prints the stated value. (These are quick behavioral checks; the authoritative
acceptance matrix — incl. auth.json-on-disk — is T2.S3.)

## Final Validation Checklist

### Technical Validation
- [ ] Level 1: `npm install`, `npm run typecheck`, `npm run lint`, `npm run format:check` all pass.
- [ ] Level 2: `npm run test:run` passes; `npm run test:coverage` shows the new resolver +
      configureEnvironment code at 100% statements/branches/functions/lines.
- [ ] Level 3: acceptance greps return the stated results (no raw `ANTHROPIC_API_KEY` read in
      `ensureHarnessInitialized`/`createBaseConfig`; resolver + `getResolvedProvider` exported;
      `getEnvApiKey` imported from pi-ai; endpoint-guard untouched).
- [ ] Level 4: behavioral smoke prints the expected values for the ZAI-only / override /
      whitespace / provider-resolution cases.

### Feature Validation (PRD §9.2.6 + work-item OUTPUT)
- [ ] Default `pi`+`zai`: `resolveApiKeyForProvider('zai')` returns the `ZAI_API_KEY` value with no Anthropic var.
- [ ] Empty/whitespace `ZAI_API_KEY`/`PRP_API_KEY` → resolver returns `undefined` (whitespace == not configured).
- [ ] `PRP_API_KEY` (or `options.override`) wins over the provider env var.
- [ ] `ensureHarnessInitialized()` forwards `{ apiKey }` ONLY when the resolver returns non-empty; else `undefined`.
- [ ] `configureEnvironment()` does NOT map `ANTHROPIC_AUTH_TOKEN` for the `zai` provider; DOES for `anthropic`.
- [ ] `configureEnvironment()` defaults `ANTHROPIC_BASE_URL` to z.ai ONLY for `zai`.
- [ ] `ANTHROPIC_AUTH_TOKEN` is no longer a hard requirement of the default path.
- [ ] `endpoint-guard.ts` (§9.2.4) untouched; `endpoint-guard.test.ts` green.

### Code Quality Validation
- [ ] `getResolvedProvider()` extracted once and reused (no duplicated `getModel('sonnet').split('/')[0]`).
- [ ] `resolveApiKeyForProvider` + `getResolvedProvider` are EXPORTED (T3 hard-depends on them).
- [ ] No circular import (environment.ts imports nothing from harness.ts).
- [ ] `createBaseConfig` change is minimal; `AgentConfig.env` field type stays `string` (no type ripple).
- [ ] `auth.json` is NOT read by hacky-hack (deferred to pi's AuthStorage — T2.S2).
- [ ] Follows existing constants/JSDoc/test patterns (PRP_AGENT_HARNESS block; environment.test.ts style).

### Documentation (Mode A — rides with the work)
- [ ] `.env.example` lines 9–17 / 24–25: `pi /login` / `ZAI_API_KEY` primary; `ANTHROPIC_*` demoted; `# PRP_API_KEY=` added.
- [ ] `docs/CONFIGURATION.md` auth prose (lines ~40, 56–71, 281–285, 412–425) refreshed to the new model.
- [ ] JSDoc on `resolveApiKeyForProvider`, `getResolvedProvider`, `configureEnvironment`, and the `PRP_API_KEY` const.

---

## Anti-Patterns to Avoid

- ❌ Don't try `import { getEnvApiKey } from '@earendil-works/pi-ai'` WITHOUT adding the dependency first —
  it is NOT re-exported by `groundswell`/`pi-coding-agent` and is not resolvable from root
  (`MODULE_NOT_FOUND`). Add `@earendil-works/pi-ai` to package.json + `npm install`. (verified_facts.md §1.)
- ❌ Don't read `~/.pi/agent/auth.json` from hacky-hack — that is pi's job (the file-backed `AuthStorage`,
  T2.S2). hacky-hack forwards `undefined` for source #3 and lets pi resolve natively. Duplicating it drifts.
- ❌ Don't forward an empty/whitespace string into `registry.initializeProvider('pi', { apiKey })` — that
  re-introduces the `?? ''` empty-string shadowing (PRD §9.2.6 #3). Forward `{ apiKey }` ONLY when non-empty.
- ❌ Don't forget to `.trim()` the `getEnvApiKey` result — it returns the raw value; whitespace-only must be
  treated as "not configured" (PRD §9.2.7 empty-string policy).
- ❌ Don't make `ANTHROPIC_AUTH_TOKEN`→`ANTHROPIC_API_KEY` unconditional — demote it to the `anthropic`
  provider only. For the default `zai` path it must not pollute `ANTHROPIC_API_KEY`.
- ❌ Don't force the z.ai `ANTHROPIC_BASE_URL` when the provider is `anthropic` — that's wrong and the §9.2.4
  safeguard would then mis-fire. Default z.ai ONLY for `zai`.
- ❌ Don't make `AgentConfig.env.ANTHROPIC_API_KEY` optional to "remove" the `?? ''` — that ripples the type,
  all `createXxxConfig` callers, and their tests. Source it from the resolver and keep a terminal `?? ''`
  as an honest unconfigured default.
- ❌ Don't touch `endpoint-guard.ts` or its test's behavior — it's the §9.2.4 safeguard, orthogonal to auth.
- ❌ Don't duplicate the comprehensive resolution-order / auth.json-on-disk tests — those are T2.S3's. T2.S1
  adds only coverage-sufficient tests.
- ❌ Don't make `validateEnvironment()` provider-aware or remove it — its startup role is superseded by the T3
  preflight (separate task); leave it for back-compat.
- ❌ Don't modify PRD.md, tasks.json, prd_snapshot.md, or .gitignore (READ-ONLY).
