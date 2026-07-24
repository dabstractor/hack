# PRP — P2.M1.T1.S2: Canonical-first-with-fallback env loader and deprecation warning

---

## Goal

**Feature Goal**: Implement PRD §9.2.8's **backward-compatible canonical env-var
migration** on top of P2.M1.T1.S1's renamed tiers: introduce canonical provider-neutral
`PRP_MODEL_HIGH` / `PRP_MODEL_BALANCED` / `PRP_MODEL_FAST` and `PRP_API_BASE_URL` env
vars, make the loader read **canonical-first with legacy `ANTHROPIC_*` fallback**, and
emit a **one-time deprecation warning** (naming the canonical replacement) whenever a
legacy alias is the source. This is a **forward-compatible, additive** change: every
existing `.env` keeps working (legacy still readable), and the new canonical names
become the documented default.

**Deliverable**:
1. **`src/config/constants.ts`** — EDIT: (a) `MODEL_ENV_VARS` VALUES → canonical
   `{ high:'PRP_MODEL_HIGH', balanced:'PRP_MODEL_BALANCED', fast:'PRP_MODEL_FAST' }`;
   (b) NEW `LEGACY_MODEL_ENV_VARS` map holding the `ANTHROPIC_DEFAULT_*` names; (c) NEW
   `export const PRP_API_BASE_URL = 'PRP_API_BASE_URL'` (env-var name constant, mirrors
   `PRP_API_KEY`); (d) `REQUIRED_ENV_VARS.baseURL` → `'PRP_API_BASE_URL'`. (+ JSDoc)
2. **`src/config/environment.ts`** — EDIT: (a) `getModel()` body → canonical-first with
   legacy fallback + one-time deprecation warning; (b) `configureEnvironment()` baseURL
   block → read `PRP_API_BASE_URL` canonical-first, `ANTHROPIC_BASE_URL` legacy fallback
   (+ default for zai), WRITE the resolved value into `process.env.ANTHROPIC_BASE_URL`
   (the SDK contract); (c) NEW module-private one-time dedup `Set` + `warnLegacyModelVar`
   /`warnLegacyBaseUrl` helpers + exported test hook `_resetDeprecationWarnings()`. (+ JSDoc)
3. **`tests/unit/config/constants.test.ts`** — EDIT (created by S1): flip S1's
   `MODEL_ENV_VARS` value assertions to the canonical `PRP_MODEL_*` names and ADD a
   `LEGACY_MODEL_ENV_VARS` describe block; ADD `PRP_API_BASE_URL` + updated
   `REQUIRED_ENV_VARS.baseURL` assertions.
4. **`tests/unit/config/environment.test.ts`** — EDIT: top-level `console.warn` spy +
   `_resetDeprecationWarnings()` in afterEach; rewrite S1's `describe('getModel')` env
   cases to the canonical/legacy/default × warning matrix; ADD `configureEnvironment`
   canonical-baseURL + deprecation cases.
5. **`.env.example`** — EDIT (Mode A): document ONLY canonical `PRP_*` names as primary;
   legacy `ANTHROPIC_*` names in a "Deprecation" note.
6. **`docs/CONFIGURATION.md`** — EDIT (Mode A): update model/auth/endpoint prose +
   tables to canonical `PRP_*` primary names with a deprecation note (scope: env-var
   NAMES only; broader doc refresh is P6.M1.T1.S3).

**Success Definition**:
- `MODEL_ENV_VARS` values are the canonical names; `LEGACY_MODEL_ENV_VARS` holds the
  legacy `ANTHROPIC_DEFAULT_*` names; both keyed high/balanced/fast (`as const`).
- `getModel(tier)` resolves `PRP_MODEL_*` → (legacy `ANTHROPIC_DEFAULT_*` + one-time
  warning) → `MODEL_NAMES[tier]` default; provider-qualified via `qualifyModel`.
- `configureEnvironment()` resolves `PRP_API_BASE_URL` → (`ANTHROPIC_BASE_URL` + one-time
  warning) → z.ai default (zai only) and writes the result to `process.env.ANTHROPIC_BASE_URL`.
- Exactly ONE deprecation warning per legacy var per process (dedup'd), each naming the
  canonical replacement + PRD §9.2.8 + "removed in a future major version".
- `REQUIRED_ENV_VARS.baseURL === 'PRP_API_BASE_URL'`; `PRP_API_BASE_URL` constant exists.
- `npm run validate` GREEN; `npm run build` compiles; 100% coverage on edited src files.
- `.env.example` + `docs/CONFIGURATION.md` show canonical primary, legacy deprecated.

---

## Why

### 1. The `ANTHROPIC_BASE_URL` SDK-contract subtlety (read this first)
The contract says "update configureEnvironment() to read PRP_API_BASE_URL canonical-first,
ANTHROPIC_BASE_URL legacy fallback" — but `process.env.ANTHROPIC_BASE_URL` is the **SDK
contract** read downstream by `endpoint-guard.ts:89`, `runtime-api-validator.ts:74,144`,
`agent-factory.ts:199`, `validate-api.ts:104,158`, and `validateEnvironment()`
(environment.ts:192). The canonical `PRP_API_BASE_URL` is only the preferred **input
source**. So `configureEnvironment()` must (a) resolve canonical→legacy→z.ai-default and
then (b) **WRITE the resolved value into `process.env.ANTHROPIC_BASE_URL`** so every
downstream consumer keeps working unchanged. Renaming the SDK env var would be a
breaking change far outside this subtask's scope; this PRP deliberately does NOT do that.

### 2. The deprecation warning is one-time, synchronous, and fires before the logger exists
`getModel()` runs per agent creation (many times); a naive warning would spam. PRD §9.6
mandates **synchronous** logging destinations. `src/utils/logger.ts` (pino) is configured
AFTER `configureEnvironment()` (it needs CLI `--verbose`/`--machine-readable` flags), so it
cannot carry a startup deprecation warning reliably. Solution: synchronous `console.warn`
(stderr, §9.6-compliant) + a module-private `Set` dedup keyed by `model:${tier}` /
`'baseURL'`, plus an exported `_resetDeprecationWarnings()` test hook (mirrors
`clearLoggerCache()` in logger.ts). This matches the codebase precedent of `console.error`
for actionable startup messages (`index.ts:337-348`).

### 3. The S1→S2 test reconciliation (CRITICAL — both S1's test files must be edited)
Implementation order is **S1 then S2** (S2 consumes S1's renamed tiers). S1 creates
`tests/unit/config/constants.test.ts` asserting `MODEL_ENV_VARS.* === 'ANTHROPIC_DEFAULT_*'`,
and renames `environment.test.ts`'s getModel args to high/balanced/fast while KEEPING the
`stubEnv('ANTHROPIC_DEFAULT_*', …)` names. S2 changes the MODEL_ENV_VARS VALUES to
`PRP_MODEL_*` and makes those legacy stubs the deprecation-fallback path. **Therefore S2
MUST edit both of S1's test files** (Conflict A: constants.test.ts value assertions flip +
new LEGACY block; Conflict B/C: environment.test.ts warning spy + reset + new cases). A PRP
that only edits src would leave `constants.test.ts` RED and emit unasserted warnings.

### 4. Business value
PRD §9.2.8: the `ANTHROPIC_*`-prefixed pipeline-global vars imply a hard Anthropic
dependency that is actively misleading under the `pi` + `zai` default. Canonical
`PRP_*` names make the vendor-neutral pipeline self-describing while keeping every
existing `.env` working (forward-compatible). S1 renamed the tier keys; S2 renames the
env-var NAMES + adds the loader + deprecation. Consumed by P2.M1.T1.S3 (getModel/call-site
touch-ups, largely covered by S1) and the broader P2.M2 role work.

### 5. Out of scope (hard boundaries)
- `getModel()` / `getResolvedProvider()` **call sites** — already high/balanced/fast
  post-S1; S2 does NOT touch them.
- `type ModelTier` / `MODEL_NAMES` values — owned by S1; unchanged by S2.
- `validateEnvironment()` body — unchanged (checks the SDK-populated
  `ANTHROPIC_BASE_URL`/`ANTHROPIC_API_KEY`).
- `endpoint-guard.ts` / `runtime-api-validator.ts` / `agent-factory.ts` — unchanged
  (read `ANTHROPIC_BASE_URL`, which configureEnvironment keeps populating).
- `EnvironmentConfig.opusModel/sonnetModel/haikuModel` (types.ts) — vestigial, unchanged.
- Provider-native `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` — NOT renamed (§9.2.8
  exception; they are the anthropic provider's own credentials).
- Persona→role remapping + xhigh budget — P2.M2.
- Broader docs/CONFIGURATION.md refresh (CLI, resilience, bug-hunt prose) — P6.M1.T1.S3.

---

## What

### User-visible behavior
- Setting `PRP_MODEL_HIGH` / `PRP_MODEL_BALANCED` / `PRP_MODEL_FAST` overrides the
  respective tier (canonical, no warning).
- Setting only the legacy `ANTHROPIC_DEFAULT_OPUS_MODEL` / `..._SONNET_MODEL` /
  `..._HAIKU_MODEL` STILL overrides (backward-compat) but prints a one-time deprecation
  warning naming the canonical replacement.
- Setting both → canonical wins; no warning.
- Setting neither → `MODEL_NAMES` default (no warning).
- Setting `PRP_API_BASE_URL` overrides the endpoint (canonical); setting only
  `ANTHROPIC_BASE_URL` still works with a one-time deprecation warning. The resolved
  endpoint is always mirrored into `process.env.ANTHROPIC_BASE_URL` for the SDK.

### Technical requirements (exact contract)

**`src/config/constants.ts`** — post-S1 `MODEL_ENV_VARS` has high/balanced/fast KEYS with
`ANTHROPIC_DEFAULT_*` VALUES. S2 changes VALUES + adds maps:

```ts
/**
 * Canonical provider-neutral model-override env-var names (PRD §9.2.8).
 *
 * @remarks
 * KEYS are the vendor-neutral tiers (S1). VALUES are the CANONICAL PRP_* names.
 * The loader (environment.ts getModel) reads canonical-first and falls back to the
 * deprecated LEGACY_MODEL_ENV_VARS aliases, emitting a one-time deprecation warning.
 */
export const MODEL_ENV_VARS = {
  high: 'PRP_MODEL_HIGH',
  balanced: 'PRP_MODEL_BALANCED',
  fast: 'PRP_MODEL_FAST',
} as const;

/**
 * Deprecated legacy model-override env-var names (PRD §9.2.8 backward-compat).
 *
 * @remarks
 * Read ONLY when the canonical {@link MODEL_ENV_VARS} var is unset; triggers a one-time
 * deprecation warning naming the canonical replacement. Slated for removal in a future
 * major version.
 */
export const LEGACY_MODEL_ENV_VARS = {
  high: 'ANTHROPIC_DEFAULT_OPUS_MODEL',
  balanced: 'ANTHROPIC_DEFAULT_SONNET_MODEL',
  fast: 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
} as const;
```

Add (near `PRP_API_KEY`, mirroring its "env-var name constant" pattern + JSDoc):
```ts
/**
 * Environment variable name: canonical LLM provider endpoint (PRD §9.2.8).
 *
 * @remarks
 * Provider-neutral pipeline-global endpoint. The loader (configureEnvironment) reads this
 * canonical-first, falling back to the deprecated ANTHROPIC_BASE_URL alias (one-time
 * deprecation warning), and writes the resolved value into process.env.ANTHROPIC_BASE_URL
 * (the SDK contract consumed by endpoint-guard / agent-factory / runtime-api-validator).
 */
export const PRP_API_BASE_URL = 'PRP_API_BASE_URL';
```

Change (the dead-code constant — value only):
```ts
export const REQUIRED_ENV_VARS = {
  apiKey: 'ANTHROPIC_API_KEY',   // provider-native credential (§9.2.8 exception) — NOT renamed
  baseURL: 'PRP_API_BASE_URL',   // canonical pipeline-global endpoint (legacy alias ANTHROPIC_BASE_URL)
} as const;
```

**`src/config/environment.ts`** — imports add `LEGACY_MODEL_ENV_VARS, PRP_API_BASE_URL`:

```ts
// Module-private one-time deprecation dedup (PRD §9.2.8). Keyed by 'model:<tier>' | 'baseURL'.
const _deprecatedWarned = new Set<string>();

/**
 * Reset the one-time deprecation-warning guards.
 *
 * @internal Test-only hook (mirrors logger.ts clearLoggerCache). Production code never calls this.
 */
export function _resetDeprecationWarnings(): void {
  _deprecatedWarned.clear();
}

function warnLegacyModelVar(tier: ModelTier): void {
  const key = `model:${tier}`;
  if (_deprecatedWarned.has(key)) return;
  _deprecatedWarned.add(key);
  console.warn(
    `[PRP] Deprecation: environment variable ${LEGACY_MODEL_ENV_VARS[tier]} is deprecated; ` +
      `use the canonical ${MODEL_ENV_VARS[tier]} instead (PRD §9.2.8). ` +
      `The legacy alias will be removed in a future major version.`
  );
}

function warnLegacyBaseUrl(): void {
  const key = 'baseURL';
  if (_deprecatedWarned.has(key)) return;
  _deprecatedWarned.add(key);
  console.warn(
    `[PRP] Deprecation: environment variable ANTHROPIC_BASE_URL is deprecated for the ` +
      `pipeline endpoint; use the canonical ${PRP_API_BASE_URL} instead (PRD §9.2.8). ` +
      `The legacy alias will be removed in a future major version.`
  );
}
```

`getModel()` body (replace the post-S1 3-line body):
```ts
export function getModel(tier: ModelTier): string {
  const canonical = process.env[MODEL_ENV_VARS[tier]];
  if (canonical) return qualifyModel(canonical);
  const legacy = process.env[LEGACY_MODEL_ENV_VARS[tier]];
  if (legacy) {
    warnLegacyModelVar(tier);
    return qualifyModel(legacy);
  }
  return qualifyModel(MODEL_NAMES[tier]);
}
```

`configureEnvironment()` baseURL block (replace the post-S1
`if (!process.env.ANTHROPIC_BASE_URL && provider === 'zai') …` block):
```ts
  // PRP_API_BASE_URL canonical-first; ANTHROPIC_BASE_URL legacy fallback (PRD §9.2.8).
  // The resolved endpoint is written into process.env.ANTHROPIC_BASE_URL — the SDK contract
  // consumed downstream by endpoint-guard / agent-factory / runtime-api-validator / validate-api.
  const canonicalBaseUrl = process.env[PRP_API_BASE_URL];
  const legacyBaseUrl = process.env.ANTHROPIC_BASE_URL;
  let resolvedBaseUrl: string | undefined;
  if (canonicalBaseUrl) {
    resolvedBaseUrl = canonicalBaseUrl;
  } else if (legacyBaseUrl) {
    warnLegacyBaseUrl();
    resolvedBaseUrl = legacyBaseUrl;
  } else if (provider === 'zai') {
    resolvedBaseUrl = DEFAULT_BASE_URL;
  }
  if (resolvedBaseUrl && process.env.ANTHROPIC_BASE_URL !== resolvedBaseUrl) {
    process.env.ANTHROPIC_BASE_URL = resolvedBaseUrl;
  }
```
(The AUTH_TOKEN→API_KEY block above it is UNCHANGED.)

**`.env.example`** (Mode A) — MODEL CONFIGURATION + API ENDPOINT sections: canonical
`PRP_*` primary; legacy `ANTHROPIC_*` in a `# DEPRECATED (still readable)` note. Keep
`ZAI_API_KEY`, `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` (provider-native, NOT renamed),
`PRP_API_KEY`, `PRP_AGENT_HARNESS` unchanged.

**`docs/CONFIGURATION.md`** (Mode A) — Quick Reference + Environment Variables tables +
Model Selection prose: `PRP_API_BASE_URL` primary (ANTHROPIC_BASE_URL deprecated),
`PRP_MODEL_HIGH/BALANCED/FAST` primary (ANTHROPIC_DEFAULT_* deprecated). Add a short
"Deprecation" note. Scope = env-var NAMES in model/auth/endpoint prose only.

### Success Criteria
- [ ] `MODEL_ENV_VARS` = canonical `PRP_MODEL_*`; `LEGACY_MODEL_ENV_VARS` = `ANTHROPIC_DEFAULT_*`; both high/balanced/fast `as const`.
- [ ] `getModel()`: canonical→(legacy+warning)→default; provider-qualified; correct value in all branches.
- [ ] `configureEnvironment()`: `PRP_API_BASE_URL`→(ANTHROPIC_BASE_URL+warning)→z.ai default; resolved written to `process.env.ANTHROPIC_BASE_URL`.
- [ ] One-time deprecation (dedup'd per legacy var); each warning names canonical replacement + §9.2.8.
- [ ] `PRP_API_BASE_URL` constant exists; `REQUIRED_ENV_VARS.baseURL === 'PRP_API_BASE_URL'`.
- [ ] S1's `constants.test.ts` flipped to canonical values + LEGACY block; `environment.test.ts` has warning spy + reset + canonical/legacy/default matrix.
- [ ] `npm run validate` GREEN; `npm run build` compiles; 100% coverage on edited src files.
- [ ] `.env.example` + `docs/CONFIGURATION.md` canonical-primary with deprecation notes.

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_
**Yes.** The post-S1 starting state of every edited symbol is given verbatim (research
§1). The two non-obvious decisions are proven: (a) `ANTHROPIC_BASE_URL` is the SDK
contract read by 5 downstream files, so `configureEnvironment` keeps WRITING it (research
§3); (b) the deprecation warning must be synchronous + fire before the logger exists, so
`console.warn` + a dedup Set + test hook (research §5). The S1→S2 test reconciliation
(research §2) is mandatory and fully specified. `REQUIRED_ENV_VARS` is proven dead code
(value-only change). Exact before/after code blocks are provided for every edit.

### Documentation & References
```yaml
# MUST READ — the PRD spec
- docfile: PRD.md
  section: "9.2.8 Provider-Neutral Configuration Naming" (h4.7)
  why: Canonical-names table (PRP_MODEL_HIGH/BALANCED/FAST, PRP_API_BASE_URL) + legacy alias
        contract ("falls back to the legacy alias and emits a one-time deprecation warning
        naming the canonical replacement"); model-tier rename note; §9.2.8 exception
        (ANTHROPIC_API_KEY/AUTH_TOKEN NOT renamed). .env.example "documents only the canonical names."
  critical: Provider-native ANTHROPIC_API_KEY/AUTH_TOKEN are NOT renamed. Legacy aliases remain
        readable (forward-compatible) but emit one-time deprecation warnings.

- docfile: PRD.md
  section: "9.2.1 Configuration Source Priority" (h4.0)
  why: Confirms env loading order (shell → .env → runtime overrides) — S2 changes the SOURCE
        preference within a single var family, not the priority across sources.

- docfile: PRD.md
  section: "9.2.3 Model Selection" (h4.2) + "9.2.4 API Endpoint Safeguards" (h4.x)
  why: getModel() reads env at runtime; models are provider-qualified; endpoint safeguard reads
        the SDK-contract ANTHROPIC_BASE_URL (so configureEnvironment must keep populating it).

# MUST READ — the S1 contract input (ASSUMED ALREADY MERGED when S2 runs)
- docfile: plan/008_15504f60a0ef/P2M1T1S1/PRP.md
  section: "Technical requirements", "Data models and structure", Task 5/6 (test edits)
  why: Defines the POST-S1 state S2 builds on: ModelTier='high'|'balanced'|'fast', MODEL_NAMES
        keys renamed (values unchanged), MODEL_ENV_VARS KEYS renamed (VALUES still ANTHROPIC_*),
        getModel() body UNCHANGED/generic, + S1 CREATES constants.test.ts (which S2 must flip).
  critical: S1's constants.test.ts asserts MODEL_ENV_VARS.* === ANTHROPIC_DEFAULT_*; S2 changes
        those VALUES → S2 MUST edit S1's constants.test.ts. S1's environment.test.ts keeps
        stubEnv('ANTHROPIC_DEFAULT_*') → S2 must add the warning spy + canonical/legacy matrix.

# MUST READ — this subtask's research
- docfile: plan/008_15504f60a0ef/P2M1T1S2/research/s2-design-and-conflicts.md
  section: §1 post-S1 state, §2 S1→S2 conflicts, §3 ANTHROPIC_BASE_URL SDK contract, §4 dead
           REQUIRED_ENV_VARS, §5 deprecation mechanism, §6 warning text, §7 getModel ordering
  why: Proven facts: the 5 downstream ANTHROPIC_BASE_URL readers; REQUIRED_ENV_VARS is dead code;
        logger is post-configureEnvironment so use console.warn; dedup keyed by model:<tier>/baseURL.

# THE FILES TO EDIT — exact current (post-S1) state
- file: src/config/constants.ts
  why: EDIT MODEL_ENV_VARS VALUES → PRP_MODEL_*; ADD LEGACY_MODEL_ENV_VARS; ADD PRP_API_BASE_URL;
        change REQUIRED_ENV_VARS.baseURL → PRP_API_BASE_URL. (+ JSDoc)
  pattern: mirror the "env-var name constant" pattern of PRP_API_KEY / PRP_AGENT_HARNESS for PRP_API_BASE_URL.
  gotcha: MODEL_ENV_VARS KEYS stay high/balanced/fast (S1) — only VALUES change. Keep `as const` on both maps.

- file: src/config/environment.ts
  why: EDIT getModel() body + configureEnvironment() baseURL block; ADD dedup Set + two warn helpers +
        _resetDeprecationWarnings() test hook; extend imports. (+ JSDoc)
  pattern: warn helpers mirror logger.ts clearLoggerCache (underscore-prefixed test reset hook).
  gotcha: KEEP writing process.env.ANTHROPIC_BASE_URL (SDK contract). Do NOT refactor validateEnvironment.
          Do NOT touch the AUTH_TOKEN→API_KEY block. getResolvedProvider stays getModel('balanced').

- file: tests/unit/config/constants.test.ts   # CREATED BY S1 — S2 EDITS IT
  why: FLIP S1's MODEL_ENV_VARS.* value assertions (ANTHROPIC_DEFAULT_* → PRP_MODEL_*); ADD describe
        block for LEGACY_MODEL_ENV_VARS (assert ANTHROPIC_DEFAULT_* values + no canonical keys); ADD
        PRP_API_BASE_URL === 'PRP_API_BASE_URL' + REQUIRED_ENV_VARS.baseURL === 'PRP_API_BASE_URL'.
  pattern: pure/deterministic (S1 already set this style); no env mutation.
  gotcha: This file is S1's output. If S1 asserted `MODEL_ENV_VARS.balanced === 'ANTHROPIC_DEFAULT_SONNET_MODEL'`,
          S2 changes it to `'PRP_MODEL_BALANCED'` or the suite is RED.

- file: tests/unit/config/environment.test.ts
  why: ADD top-level `const warnSpy = vi.spyOn(console,'warn').mockImplementation(()=>{})` in a
        beforeEach + `warnSpy.mockRestore()` + `_resetDeprecationWarnings()` in afterEach; rewrite
        describe('getModel') env cases to canonical/legacy/default × warning matrix; ADD configureEnvironment
        canonical-baseURL + deprecation cases.
  pattern: the file already uses beforeEach/afterEach + vi.stubEnv/vi.unstubAllEnvs.
  gotcha: S1's getModel tests keep stubEnv('ANTHROPIC_DEFAULT_*') — post-S2 those are the LEGACY path
          (value still resolves, but a warning now fires). Add canonical-wins + warning-one-time cases.

- file: .env.example   # Mode A docs
  why: MODEL CONFIGURATION → PRP_MODEL_HIGH/BALANCED/FAST primary (legacy ANTHROPIC_DEFAULT_* in a
        deprecation note); API ENDPOINT → PRP_API_BASE_URL primary (ANTHROPIC_BASE_URL deprecated).
  gotcha: Do NOT touch ZAI_API_KEY / ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN (provider-native, §9.2.8 exception).

- file: docs/CONFIGURATION.md   # Mode A docs
  why: Quick Reference + Environment Variables (API Authentication, Model Selection) tables + Model
        Selection prose → canonical PRP_* primary, legacy deprecated. Add a short Deprecation note.
  gotcha: Scope = env-var NAMES in model/auth/endpoint prose only. The broader refresh (CLI, resilience,
          bug-hunt) is P6.M1.T1.S3. Optionally align the stale GLM-4.7/GLM-4.5-Air values to glm-5.2/
          glm-5.2/glm-5-turbo (matches MODEL_NAMES) in the same prose blocks if convenient.

# DOWNSTREAM CONSUMERS (DO NOT EDIT — read ANTHROPIC_BASE_URL, kept populated by configureEnvironment)
- file: src/config/endpoint-guard.ts:89
  why: checkProviderEndpoint(process.env.ANTHROPIC_BASE_URL ?? ''). Proves ANTHROPIC_BASE_URL is the SDK contract.
- file: src/agents/agent-factory.ts:199
  why: ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL ?? '' into agent env. Unchanged.
- file: src/scripts/validate-api.ts:104,158
  why: endpoint guard + baseURL = process.env.ANTHROPIC_BASE_URL!. Unchanged.
- file: src/utils/runtime-api-validator.ts:74,144
  why: reads process.env.ANTHROPIC_BASE_URL. Unchanged.

# PATTERN FILES
- file: src/utils/logger.ts
  why: clearLoggerCache() = the underscore-prefixed-ish test-reset-hook precedent mirrored by
        _resetDeprecationWarnings(); also confirms pino logger is lazy + configured post-startup
        (so console.warn is the right synchronous channel for startup deprecations).
- file: src/config/constants.ts (PRP_API_KEY / PRP_AGENT_HARNESS blocks)
  why: the "export const FOO = 'FOO'" env-var-name-constant + JSDoc pattern to copy for PRP_API_BASE_URL.
```

### Current Codebase tree (relevant slice — POST-S1)
```bash
src/config/
├── types.ts                 # UNCHANGED (ModelTier already high/balanced/fast post-S1)
├── constants.ts             # EDIT — MODEL_ENV_VARS values + LEGACY_MODEL_ENV_VARS + PRP_API_BASE_URL + REQUIRED_ENV_VARS.baseURL
└── environment.ts           # EDIT — getModel() + configureEnvironment() baseURL + dedup Set + warn helpers + test hook
src/config/endpoint-guard.ts         # UNCHANGED (reads ANTHROPIC_BASE_URL)
src/utils/runtime-api-validator.ts   # UNCHANGED (reads ANTHROPIC_BASE_URL)
src/agents/agent-factory.ts          # UNCHANGED (passes ANTHROPIC_BASE_URL into agent env)
src/scripts/validate-api.ts          # UNCHANGED (reads ANTHROPIC_BASE_URL)
tests/unit/config/
├── constants.test.ts        # EDIT (S1's file) — flip MODEL_ENV_VARS values to canonical + add LEGACY block + PRP_API_BASE_URL
└── environment.test.ts      # EDIT (S1-renamed getModel args) — warn spy + reset + canonical/legacy/default matrix
.env.example                 # EDIT (Mode A) — canonical PRP_* primary, legacy deprecated
docs/CONFIGURATION.md        # EDIT (Mode A) — model/auth/endpoint prose → canonical
```

### Desired Codebase tree with files to be added/edited
```bash
src/config/constants.ts               # MODIFIED (MODEL_ENV_VARS values → PRP_MODEL_*; +LEGACY_MODEL_ENV_VARS; +PRP_API_BASE_URL; REQUIRED_ENV_VARS.baseURL → PRP_API_BASE_URL)
src/config/environment.ts             # MODIFIED (getModel canonical-first+fallback+warn; configureEnvironment baseURL canonical-first+fallback+warn; +dedup Set; +2 warn helpers; +_resetDeprecationWarnings; imports)
tests/unit/config/constants.test.ts   # MODIFIED (flip MODEL_ENV_VARS values to canonical; +LEGACY_MODEL_ENV_VARS block; +PRP_API_BASE_URL/REQUIRED_ENV_VARS asserts)
tests/unit/config/environment.test.ts # MODIFIED (console.warn spy + _resetDeprecationWarnings in afterEach; getModel canonical/legacy/default×warning matrix; +configureEnvironment baseURL deprecation cases)
.env.example                          # MODIFIED (canonical PRP_* primary, legacy ANTHROPIC_* deprecated)
docs/CONFIGURATION.md                 # MODIFIED (model/auth/endpoint prose → canonical + deprecation note)
```

### Known Gotchas of our codebase & Library Quirks
```ts
// CRITICAL — ANTHROPIC_BASE_URL is the SDK CONTRACT. configureEnvironment MUST keep WRITING it
//   (read by endpoint-guard.ts:89, runtime-api-validator.ts:74,144, agent-factory.ts:199,
//   validate-api.ts:104,158, environment.ts validateEnvironment:192). PRP_API_BASE_URL is only the
//   preferred INPUT source. Do NOT rename the SDK env var.

// CRITICAL — S1→S2 test reconciliation. S1's constants.test.ts asserts MODEL_ENV_VARS.* === 'ANTHROPIC_DEFAULT_*';
//   S2 flips the VALUES to PRP_MODEL_* → that test file MUST be edited or the suite is RED. S1's
//   environment.test.ts keeps stubEnv('ANTHROPIC_DEFAULT_*') → post-S2 those are the legacy-fallback
//   path (warning fires) → MUST add console.warn spy + _resetDeprecationWarnings + canonical matrix.

// CRITICAL — logger (pino) is configured AFTER configureEnvironment() (needs CLI --verbose/--machine-readable).
//   Use synchronous console.warn (stderr, §9.6-compliant) for startup deprecations; match the console.error
//   precedent in index.ts:337-348.

// CRITICAL — "one-time": getModel() runs per agent creation (many times). Dedup via module-private
//   const _deprecatedWarned = new Set<string>() keyed by `model:${tier}` | 'baseURL'. Export
//   _resetDeprecationWarnings() (test-only, mirrors logger.ts clearLoggerCache) so tests can re-arm.

// CRITICAL — getModel ordering: configureEnvironment() line 1 calls getResolvedProvider() → getModel('balanced').
//   If only legacy balanced var set, the model deprecation fires here (once) BEFORE the baseURL logic. Both
//   one-time + independent. No recursion. Safe.

// GOTCHA — MODEL_ENV_VARS KEYS stay high/balanced/fast (S1). Only VALUES change. Keep `as const` on
//   MODEL_ENV_VARS AND LEGACY_MODEL_ENV_VARS (preserves literal key types ↔ ModelTier).

// GOTCHA — REQUIRED_ENV_VARS is DEAD CODE (only declared at constants.ts:78; never read). Changing its
//   .baseURL value is contract-alignment only — zero runtime effect. validateEnvironment does NOT use it
//   and KEEPS checking ANTHROPIC_BASE_URL (SDK contract configureEnvironment guarantees is set). Do NOT
//   refactor validateEnvironment.

// GOTCHA — provider-native ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN are NOT renamed (§9.2.8 exception).
//   The AUTH_TOKEN→API_KEY mapping block in configureEnvironment is UNCHANGED.

// GOTCHA — prettier is ERROR-enforced (format:check). Run `npm run fix` before `npm run validate`.
//   100% coverage globally enforced (vitest.config.ts). Every getModel branch (canonical/legacy/default)
//   and every warn helper + _resetDeprecationWarnings MUST be exercised by tests.

// GOTCHA — vitest does NOT reset module state between it() blocks in a file, so the module-private
//   _deprecatedWarned Set persists across tests. ALWAYS call _resetDeprecationWarnings() in afterEach
//   (the file already uses afterEach for vi.unstubAllEnvs()).
```

---

## Implementation Blueprint

### Data models and structure
No new public types. Adds two `as const` maps (`LEGACY_MODEL_ENV_VARS`), one string
constant (`PRP_API_BASE_URL`), and one internal test hook (`_resetDeprecationWarnings`).

```ts
// src/config/constants.ts (post-S2)
export const MODEL_ENV_VARS = { high: 'PRP_MODEL_HIGH', balanced: 'PRP_MODEL_BALANCED', fast: 'PRP_MODEL_FAST' } as const;
export const LEGACY_MODEL_ENV_VARS = {
  high: 'ANTHROPIC_DEFAULT_OPUS_MODEL', balanced: 'ANTHROPIC_DEFAULT_SONNET_MODEL', fast: 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
} as const;
export const PRP_API_BASE_URL = 'PRP_API_BASE_URL';
export const REQUIRED_ENV_VARS = { apiKey: 'ANTHROPIC_API_KEY', baseURL: 'PRP_API_BASE_URL' } as const;

// src/config/environment.ts (post-S2)
const _deprecatedWarned = new Set<string>();
export function _resetDeprecationWarnings(): void { _deprecatedWarned.clear(); }
function warnLegacyModelVar(tier: ModelTier): void { /* dedup + console.warn naming MODEL_ENV_VARS[tier] */ }
function warnLegacyBaseUrl(): void { /* dedup + console.warn naming PRP_API_BASE_URL */ }
export function getModel(tier: ModelTier): string {
  const canonical = process.env[MODEL_ENV_VARS[tier]];
  if (canonical) return qualifyModel(canonical);
  const legacy = process.env[LEGACY_MODEL_ENV_VARS[tier]];
  if (legacy) { warnLegacyModelVar(tier); return qualifyModel(legacy); }
  return qualifyModel(MODEL_NAMES[tier]);
}
// configureEnvironment baseURL block: PRP_API_BASE_URL → (ANTHROPIC_BASE_URL+warn) → z.ai default; write to ANTHROPIC_BASE_URL.
```

### Implementation Tasks (ordered by dependencies)
```yaml
Task 1: EDIT src/config/constants.ts   (the canonical names — foundational)
  - CHANGE MODEL_ENV_VARS VALUES (post-S1 keys high/balanced/fast stay): opus-name→'PRP_MODEL_HIGH',
        sonnet-name→'PRP_MODEL_BALANCED', haiku-name→'PRP_MODEL_FAST'. Update JSDoc (note canonical-first loader + S2).
  - ADD export const LEGACY_MODEL_ENV_VARS = { high:'ANTHROPIC_DEFAULT_OPUS_MODEL', balanced:'ANTHROPIC_DEFAULT_SONNET_MODEL',
        fast:'ANTHROPIC_DEFAULT_HAIKU_MODEL' } as const; (+ deprecation JSDoc).
  - ADD export const PRP_API_BASE_URL = 'PRP_API_BASE_URL'; near PRP_API_KEY (mirror its env-var-name-constant JSDoc pattern).
  - CHANGE REQUIRED_ENV_VARS.baseURL: 'ANTHROPIC_BASE_URL' → 'PRP_API_BASE_URL' (value-only; dead code).
  - KEEP `as const` on MODEL_ENV_VARS + LEGACY_MODEL_ENV_VARS. EXPECTED: constants.ts self-consistent; typecheck green.

Task 2: EDIT src/config/environment.ts   (the loader + deprecation)
  - EXTEND imports: add LEGACY_MODEL_ENV_VARS, PRP_API_BASE_URL from './constants.js' (MODEL_ENV_VARS already imported).
  - ADD module-private `const _deprecatedWarned = new Set<string>();` + exported `_resetDeprecationWarnings()` (test hook).
  - ADD private `warnLegacyModelVar(tier)` + `warnLegacyBaseUrl()` (dedup via _deprecatedWarned; console.warn naming canonical
        replacement + §9.2.8 + "removed in a future major version").
  - REPLACE getModel() body: canonical→(legacy+warn)→default (qualifyModel each branch). Keep signature (tier: ModelTier).
  - REPLACE configureEnvironment() baseURL block: PRP_API_BASE_URL → (ANTHROPIC_BASE_URL+warn) → z.ai default (zai only);
        write resolved into process.env.ANTHROPIC_BASE_URL. KEEP the AUTH_TOKEN→API_KEY block above it UNCHANGED.
  - UPDATE getModel/configureEnvironment JSDoc to describe canonical-first + legacy fallback + deprecation.
  - DO NOT touch getResolvedProvider(), validateEnvironment(), qualifyModel(), or the re-exports.
  - EXPECTED: `npm run typecheck` green.

Task 3: EDIT tests/unit/config/constants.test.ts   # S1's file — flip values + add LEGACY block
  - FLIP S1's MODEL_ENV_VARS assertions: high→'PRP_MODEL_HIGH', balanced→'PRP_MODEL_BALANCED', fast→'PRP_MODEL_FAST'.
  - ADD describe('LEGACY_MODEL_ENV_VARS'): high→'ANTHROPIC_DEFAULT_OPUS_MODEL', balanced→'ANTHROPIC_DEFAULT_SONNET_MODEL',
        fast→'ANTHROPIC_DEFAULT_HAIKU_MODEL'; assert no PRP_* keys leak into it.
  - ADD it() for PRP_API_BASE_URL === 'PRP_API_BASE_URL' and REQUIRED_ENV_VARS.baseURL === 'PRP_API_BASE_URL'
        (and REQUIRED_ENV_VARS.apiKey === 'ANTHROPIC_API_KEY' — provider-native, unchanged).
  - KEEP pure/deterministic (no env mutation). EXPECTED: green.

Task 4: EDIT tests/unit/config/environment.test.ts   # S1-renamed getModel args — add warning matrix
  - ADD in the top-level describe('config/environment'): a beforeEach that sets
        `const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})` (store on a closure var) and an
        afterEach that calls `warnSpy.mockRestore(); _resetDeprecationWarnings();` (alongside existing vi.unstubAllEnvs()).
        Import _resetDeprecationWarnings from '../../../src/config/environment.js'.
  - REWRITE describe('getModel') env cases into a canonical/legacy/default × warning matrix:
        * canonical wins, no warning: stubEnv('PRP_MODEL_BALANCED','canon'); expect getModel('balanced')==='zai/canon'; expect(warnSpy).not.toHaveBeenCalled().
        * canonical beats legacy when BOTH set: stub both PRP_MODEL_FAST + ANTHROPIC_DEFAULT_HAIKU_MODEL; expect 'zai/<canon>'; no warning.
        * legacy-only resolves + warns ONCE: stubEnv('ANTHROPIC_DEFAULT_OPUS_MODEL','leg'); _resetDeprecationWarnings(); getModel('high')→'zai/leg';
          expect(warnSpy).toHaveBeenCalledTimes(1) AND the message includes 'PRP_MODEL_HIGH'; call getModel('high') again → still 1 warning (dedup).
        * default, no warning: nothing set; getModel('fast')===`zai/${MODEL_NAMES.fast}`; warnSpy not called.
        * cover all three tiers' legacy names at least once (high/balanced/fast) for branch coverage.
  - ADD describe('configureEnvironment') baseURL cases:
        * canonical PRP_API_BASE_URL → written to ANTHROPIC_BASE_URL, no warning.
        * legacy ANTHROPIC_BASE_URL only → preserved on ANTHROPIC_BASE_URL, ONE warning naming 'PRP_API_BASE_URL'.
        * neither set + zai provider → ANTHROPIC_BASE_URL === DEFAULT_BASE_URL, no warning.
        * neither set + anthropic provider → ANTHROPIC_BASE_URL stays undefined, no warning.
  - KEEP the existing value-preservation tests (custom BASE_URL preserved; AUTH_TOKEN mapping). They still pass; the
        warnSpy prevents output noise. EXPECTED: green; 100% on environment.ts.

Task 5: EDIT .env.example   (Mode A — canonical primary, legacy deprecated)
  - MODEL CONFIGURATION section: replace the three ANTHROPIC_DEFAULT_* lines with PRP_MODEL_HIGH/BALANCED/FAST (primary,
        uncommented). Add a `# DEPRECATED legacy aliases (still readable, emit a one-time warning; PRD §9.2.8):` note
        listing ANTHROPIC_DEFAULT_OPUS_MODEL / ..._SONNET_MODEL / ..._HAIKU_MODEL (commented out).
  - API ENDPOINT section: replace `# ANTHROPIC_BASE_URL=…` with `# PRP_API_BASE_URL=https://api.z.ai/api/anthropic`
        (primary) and a deprecation note for `ANTHROPIC_BASE_URL` (commented).
  - DO NOT touch ZAI_API_KEY / ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / PRP_API_KEY (provider-native or already canonical).

Task 6: EDIT docs/CONFIGURATION.md   (Mode A — model/auth/endpoint prose → canonical)
  - Quick Reference table + API Authentication table: ANTHROPIC_BASE_URL row → PRP_API_BASE_URL (primary; note legacy alias).
  - Model Selection table: ANTHROPIC_DEFAULT_OPUS/SONNET/HAIKU_MODEL → PRP_MODEL_HIGH/BALANCED/FAST (tier column high/balanced/fast).
  - Add a short "## Deprecation (legacy `ANTHROPIC_*` aliases)" note: legacy names still readable, emit one-time warning,
        slated for removal in a future major version (PRD §9.2.8).
  - Scope = env-var NAMES in model/auth/endpoint prose. Optionally align stale model VALUES (GLM-4.7→glm-5.2 etc.) in the
        same blocks. Leave CLI/resilience/bug-hunt prose to P6.M1.T1.S3.

Task 7: FORMAT + VERIFY
  - RUN: npm run fix → npm run validate (lint + format:check + typecheck + test:run). MUST be green.
  - RUN: npm run build (tsc -p tsconfig.build.json). MUST compile.
  - RUN: npx vitest run tests/unit/config/ --coverage (config suite green; 100% on constants.ts/environment.ts).
  - RUN: rg -n "ANTHROPIC_DEFAULT_(OPUS|SONNET|HAIKU)_MODEL|ANTHROPIC_BASE_URL" src/config/constants.ts — EXPECTED: only
        inside LEGACY_MODEL_ENV_VARS / the baseURL fallback (constants.ts) and loader (environment.ts); no stray primary usage.
  - EXPECTED: full green; canonical names primary everywhere; legacy only as documented fallback.
```

### Implementation Patterns & Key Details
```ts
// ---- constants.ts: canonical map + legacy map + endpoint constant ----
export const MODEL_ENV_VARS = { high: 'PRP_MODEL_HIGH', balanced: 'PRP_MODEL_BALANCED', fast: 'PRP_MODEL_FAST' } as const;
export const LEGACY_MODEL_ENV_VARS = {
  high: 'ANTHROPIC_DEFAULT_OPUS_MODEL', balanced: 'ANTHROPIC_DEFAULT_SONNET_MODEL', fast: 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
} as const;
export const PRP_API_BASE_URL = 'PRP_API_BASE_URL';
export const REQUIRED_ENV_VARS = { apiKey: 'ANTHROPIC_API_KEY', baseURL: 'PRP_API_BASE_URL' } as const;

// ---- environment.ts: one-time dedup + synchronous warn (§9.6) ----
const _deprecatedWarned = new Set<string>();
export function _resetDeprecationWarnings(): void { _deprecatedWarned.clear(); }   // test-only (cf. logger.clearLoggerCache)
function warnLegacyModelVar(tier: ModelTier): void {
  const key = `model:${tier}`;
  if (_deprecatedWarned.has(key)) return;
  _deprecatedWarned.add(key);
  console.warn(`[PRP] Deprecation: ${LEGACY_MODEL_ENV_VARS[tier]} is deprecated; use ${MODEL_ENV_VARS[tier]} (PRD §9.2.8). Removed in a future major version.`);
}
function warnLegacyBaseUrl(): void {
  if (_deprecatedWarned.has('baseURL')) return;
  _deprecatedWarned.add('baseURL');
  console.warn(`[PRP] Deprecation: ANTHROPIC_BASE_URL is deprecated for the pipeline endpoint; use ${PRP_API_BASE_URL} (PRD §9.2.8). Removed in a future major version.`);
}

// ---- getModel: canonical → (legacy+warn) → default ----
export function getModel(tier: ModelTier): string {
  const canonical = process.env[MODEL_ENV_VARS[tier]];
  if (canonical) return qualifyModel(canonical);
  const legacy = process.env[LEGACY_MODEL_ENV_VARS[tier]];
  if (legacy) { warnLegacyModelVar(tier); return qualifyModel(legacy); }
  return qualifyModel(MODEL_NAMES[tier]);
}

// ---- configureEnvironment baseURL: canonical → (legacy+warn) → z.ai default; WRITE to ANTHROPIC_BASE_URL ----
const canonicalBaseUrl = process.env[PRP_API_BASE_URL];
const legacyBaseUrl = process.env.ANTHROPIC_BASE_URL;
let resolvedBaseUrl: string | undefined;
if (canonicalBaseUrl) resolvedBaseUrl = canonicalBaseUrl;
else if (legacyBaseUrl) { warnLegacyBaseUrl(); resolvedBaseUrl = legacyBaseUrl; }
else if (provider === 'zai') resolvedBaseUrl = DEFAULT_BASE_URL;
if (resolvedBaseUrl && process.env.ANTHROPIC_BASE_URL !== resolvedBaseUrl) process.env.ANTHROPIC_BASE_URL = resolvedBaseUrl;

// ---- test matrix (environment.test.ts) ----
// beforeEach: warnSpy = vi.spyOn(console,'warn').mockImplementation(()=>{}); afterEach: warnSpy.mockRestore(); _resetDeprecationWarnings();
// canonical-wins: stubEnv('PRP_MODEL_BALANCED','c'); getModel('balanced')==='zai/c'; warnSpy not called.
// legacy+warn-once: _resetDeprecationWarnings(); stubEnv('ANTHROPIC_DEFAULT_OPUS_MODEL','l'); getModel('high')==='zai/l';
//                    expect(warnSpy).toHaveBeenCalledTimes(1); expect(warnSpy.mock.calls[0][0]).toContain('PRP_MODEL_HIGH');
//                    getModel('high'); expect(warnSpy).toHaveBeenCalledTimes(1);  // dedup
```

### Integration Points
```yaml
CONSTANTS (src/config/constants.ts):
  - MODEL_ENV_VARS values: ANTHROPIC_DEFAULT_* → PRP_MODEL_HIGH/BALANCED/FAST (keys unchanged). (+ JSDoc)
  - + LEGACY_MODEL_ENV_VARS { high/balanced/fast → ANTHROPIC_DEFAULT_* } as const. (+ deprecation JSDoc)
  - + PRP_API_BASE_URL = 'PRP_API_BASE_URL' (env-var name constant; mirrors PRP_API_KEY). (+ JSDoc)
  - REQUIRED_ENV_VARS.baseURL: 'ANTHROPIC_BASE_URL' → 'PRP_API_BASE_URL' (value-only; dead code).

LOADER (src/config/environment.ts):
  - getModel(): canonical → (legacy + one-time warn) → MODEL_NAMES default.
  - configureEnvironment(): PRP_API_BASE_URL → (ANTHROPIC_BASE_URL + one-time warn) → z.ai default (zai only);
        resolved WRITTEN to process.env.ANTHROPIC_BASE_URL (SDK contract).
  - + _deprecatedWarned Set + warnLegacyModelVar/warnLegacyBaseUrl + _resetDeprecationWarnings (test hook).

TESTS:
  - constants.test.ts (S1's): flip MODEL_ENV_VARS values to canonical + add LEGACY block + PRP_API_BASE_URL/REQUIRED_ENV_VARS.
  - environment.test.ts: console.warn spy + _resetDeprecationWarnings in afterEach + canonical/legacy/default × warning matrix.

DOCS (Mode A):
  - .env.example: canonical PRP_* primary; legacy ANTHROPIC_* in deprecation note. (provider-native ANTHROPIC_API_KEY/AUTH_TOKEN untouched)
  - docs/CONFIGURATION.md: model/auth/endpoint prose + tables → canonical; short Deprecation note.

NO CHANGES TO (hard boundary):
  - getModel()/getResolvedProvider() call sites (post-S1 high/balanced/fast); type ModelTier; MODEL_NAMES values.
  - validateEnvironment() body (checks SDK-contract ANTHROPIC_BASE_URL/ANTHROPIC_API_KEY).
  - endpoint-guard.ts / runtime-api-validator.ts / agent-factory.ts / validate-api.ts (read ANTHROPIC_BASE_URL, kept populated).
  - AUTH_TOKEN→API_KEY block; provider-native ANTHROPIC_API_KEY/AUTH_TOKEN names (§9.2.8 exception).
  - EnvironmentConfig.opusModel/sonnetModel/haikuModel (vestigial); persona→role remapping + xhigh budget (P2.M2);
    broader docs/CONFIGURATION.md refresh (P6.M1.T1.S3).
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
npm run fix            # lint:fix + prettier --write (run first)
npm run typecheck      # tsc --noEmit -p tsconfig.build.json (SRC-ONLY — must be green after Task 2)
# Targeted:
npx eslint src/config/constants.ts src/config/environment.ts
npx prettier --check src/config/constants.ts src/config/environment.ts
# Expected: Zero errors. Most likely failure: a typo in a canonical name string or a missed `as const`.
# Confirm legacy names survive ONLY as documented fallback (no stray primary usage):
rg -n "ANTHROPIC_DEFAULT_(OPUS|SONNET|HAIKU)_MODEL" src/config/constants.ts   # ONLY inside LEGACY_MODEL_ENV_VARS
rg -n "'ANTHROPIC_BASE_URL'" src/config/                                        # ONLY inside configureEnvironment fallback / REQUIRED_ENV_VARS comment
```

### Level 2: Unit Tests (Component Validation)
```bash
# The flipped canonical constants (S1's file, edited by S2):
npx vitest run tests/unit/config/constants.test.ts
#   Expected: green. If a MODEL_ENV_VARS.* === 'PRP_MODEL_*' assertion fails, the value flip (Task 1) is wrong;
#   if LEGACY_MODEL_ENV_VARS.* === 'ANTHROPIC_DEFAULT_*' fails, the new map is mis-keyed.

# The loader + deprecation matrix (the gated red-tree risk):
npx vitest run tests/unit/config/environment.test.ts
#   Expected: green, incl. canonical/legacy/default × warning cases. If a deprecation-warn-once assertion fails
#   (>1 call), _resetDeprecationWarnings() is missing in afterEach or the dedup key collides. If a value assertion
#   fails, getModel/configureEnvironment branch order is wrong (canonical must win).

# Full config suite (proves no regression to auth/harness/endpoint guards):
npx vitest run tests/unit/config/ --coverage
#   Expected: green; 100% coverage on constants.ts + environment.ts (every getModel branch + both warn helpers +
#   _resetDeprecationWarnings must be exercised — uncovered branches = a missing matrix case).
```

### Level 3: Integration / Regression (System Validation)
```bash
# Full validate gate (the green-tree proof):
npm run validate      # = lint && format:check && typecheck && test:run  → MUST exit 0
npm run build         # tsc -p tsconfig.build.json → dist/ emits cleanly
# Whole suite — no NEW regressions:
npm run test:run
# Expected: all green. If a non-config test fails on a legacy env var, it likely stubs ANTHROPIC_DEFAULT_* and now
#   gets a console.warn — that does NOT fail vitest, but if it asserts exact console output, suppress with a warn spy.
#   `rg -n "ANTHROPIC_DEFAULT_(OPUS|SONNET|HAIKU)_MODEL|ANTHROPIC_BASE_URL" tests/` to audit.
```

### Level 4: Creative & Domain-Specific Validation
```bash
# No MCP/DB/HTTP. Domain checks (record in commit message):
#   1. Canonical-first resolution — prove getModel prefers PRP_* and configureEnvironment prefers PRP_API_BASE_URL:
node --input-type=module -e "
const { _resetDeprecationWarnings, getModel, configureEnvironment } = await import('./dist/config/environment.js');
_resetDeprecationWarnings();
process.env.PRP_MODEL_FAST = 'glm-flash';
console.log('canonical fast =', getModel('fast'));  // 'zai/glm-flash'  (no warning)
delete process.env.PRP_MODEL_FAST;
process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL = 'glm-leg';
console.log('legacy fast   =', getModel('fast'));   // 'zai/glm-leg'     (ONE deprecation warning naming PRP_MODEL_FAST)
delete process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL;
console.log('default fast  =', getModel('fast'));   // 'zai/glm-5-turbo' (no warning)
process.env.PRP_API_BASE_URL = 'https://canon.example/api';
configureEnvironment();
console.log('ANTHROPIC_BASE_URL =', process.env.ANTHROPIC_BASE_URL);  // 'https://canon.example/api' (mirrored)
"   # (run `npm run build` first; Expected: canonical wins, legacy warns once, baseURL mirrored to SDK var.)
#   2. Backward compatibility — a legacy-only .env still resolves (just warns). Prove no BREAKING change:
#        unset PRP_*; set ANTHROPIC_DEFAULT_SONNET_MODEL=glm-5.2 → getModel('balanced') === 'zai/glm-5.2' + 1 warning.
#   3. Deprecation is ONE-TIME per legacy var per process:
#        call getModel('balanced') 5× with legacy set → exactly 1 console.warn line for that tier.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` exits 0 (src-only; constants.ts + environment.ts compile).
- [ ] `npm run validate` exits 0 (lint + format:check + typecheck + test:run).
- [ ] `npm run build` compiles (dist/ emits).
- [ ] `npx vitest run tests/unit/config/ --coverage` exits 0; 100% on constants.ts + environment.ts.
- [ ] `rg "ANTHROPIC_DEFAULT_(OPUS|SONNET|HAIKU)_MODEL" src/config/constants.ts` → only inside `LEGACY_MODEL_ENV_VARS`.

### Feature Validation
- [ ] `MODEL_ENV_VARS` = canonical `PRP_MODEL_HIGH/BALANCED/FAST`; `LEGACY_MODEL_ENV_VARS` = `ANTHROPIC_DEFAULT_*`; both `as const`.
- [ ] `getModel()`: canonical wins; legacy resolves + warns once; default when neither set. All three branches covered.
- [ ] `configureEnvironment()`: `PRP_API_BASE_URL` → (ANTHROPIC_BASE_URL+warn) → z.ai default; resolved written to `process.env.ANTHROPIC_BASE_URL`.
- [ ] Deprecation warnings are one-time per legacy var, synchronous (console.warn/stderr), name the canonical replacement + §9.2.8.
- [ ] `PRP_API_BASE_URL` constant exists; `REQUIRED_ENV_VARS.baseURL === 'PRP_API_BASE_URL'`; `apiKey` unchanged (provider-native).
- [ ] S1's `constants.test.ts` flipped to canonical values + LEGACY block; `environment.test.ts` has warn spy + reset + matrix.
- [ ] `.env.example` + `docs/CONFIGURATION.md` canonical-primary with deprecation notes; provider-native vars untouched.

### Code Quality Validation
- [ ] `as const` on MODEL_ENV_VARS + LEGACY_MODEL_ENV_VARS (literal key types ↔ ModelTier).
- [ ] `ANTHROPIC_BASE_URL` still WRITTEN by configureEnvironment (SDK contract preserved; 5 downstream readers unaffected).
- [ ] `validateEnvironment()` body unchanged; AUTH_TOKEN→API_KEY block unchanged; getResolvedProvider still `getModel('balanced')`.
- [ ] `_resetDeprecationWarnings()` is underscore-prefixed + JSDoc'd internal/test-only (mirrors logger.clearLoggerCache).
- [ ] No getModel/getResolvedProvider call-site edits (post-S1 correct); no type/ModelTier/MODEL_NAMES-value edits.

### Documentation & Deployment
- [ ] Mode-A JSDoc on MODEL_ENV_VARS / LEGACY_MODEL_ENV_VARS / PRP_API_BASE_URL / getModel / configureEnvironment describes canonical-first + fallback + deprecation.
- [ ] `.env.example` documents only canonical names as primary (legacy in deprecation note) — PRD §9.2.8 requirement.
- [ ] Commit message notes: the ANTHROPIC_BASE_URL SDK-contract preservation, the synchronous console.warn + dedup choice (logger is post-startup), the S1→S2 test reconciliation, and that legacy aliases remain readable (forward-compatible).

---

## Anti-Patterns to Avoid

- ❌ Don't stop writing `process.env.ANTHROPIC_BASE_URL` — it's the SDK contract read by endpoint-guard/runtime-api-validator/agent-factory/validate-api/validateEnvironment. `PRP_API_BASE_URL` is only the preferred INPUT source; configureEnvironment mirrors the resolved value into ANTHROPIC_BASE_URL.
- ❌ Don't rename provider-native `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` — §9.2.8 explicitly exempts them; the AUTH_TOKEN→API_KEY block stays.
- ❌ Don't use the pino logger for the deprecation warning — it's configured AFTER configureEnvironment() (needs CLI flags). Use synchronous `console.warn` (stderr, §9.6-compliant).
- ❌ Don't emit the deprecation warning on every getModel() call — dedup via the module-private `_deprecatedWarned` Set (one warning per legacy var per process).
- ❌ Don't skip editing S1's `constants.test.ts` — it asserts `MODEL_ENV_VARS.* === 'ANTHROPIC_DEFAULT_*'`; after S2 flips the values, that test is RED unless updated. Same for `environment.test.ts` (legacy stubs now warn).
- ❌ Don't refactor `validateEnvironment()` to read `PRP_API_BASE_URL` or `REQUIRED_ENV_VARS` — it checks the SDK-contract `ANTHROPIC_BASE_URL`/`ANTHROPIC_API_KEY` that configureEnvironment guarantees are set. `REQUIRED_ENV_VARS` is dead code; only its `.baseURL` value changes.
- ❌ Don't change `getModel()`/`getResolvedProvider()` call sites, `type ModelTier`, or `MODEL_NAMES` values — those are post-S1 correct and out of scope.
- ❌ Don't forget `_resetDeprecationWarnings()` in afterEach — vitest doesn't reset module state between tests, so the dedup Set would suppress warnings in later cases.
- ❌ Don't drop `as const` on MODEL_ENV_VARS / LEGACY_MODEL_ENV_VARS — literal key types must match `ModelTier`.
- ❌ Don't expand docs/CONFIGURATION.md beyond model/auth/endpoint prose — the broader refresh is P6.M1.T1.S3.

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: This is a well-bounded, additive, backward-compatible change on top of S1's
renamed tiers. The two genuinely non-obvious decisions are proven from the codebase: (1)
`ANTHROPIC_BASE_URL` is the SDK contract read by 5 named downstream files, so
`configureEnvironment` keeps mirroring the resolved value into it (research §3); (2) the
deprecation warning must be synchronous and fire before the pino logger is configured, so
`console.warn` + a dedup Set + a `clearLoggerCache`-style test hook (research §5). The
mandatory S1→S2 test reconciliation is explicitly enumerated (S1's constants.test.ts value
flip + LEGACY block; environment.test.ts warn spy + reset + canonical/legacy/default
matrix). `REQUIRED_ENV_VARS` is proven dead code (value-only change). Exact before/after
code blocks are given for every src edit; the test matrix is fully specified to hit every
branch for the 100%-coverage gate. Residual risks are mechanical and gate-caught: (a) a
typo in a canonical name → constants.test.ts assertion names it exactly (close the typo);
(b) a missed matrix case → coverage report names the uncovered branch (add the case); (c)
a prettier nit (auto-fixed via `npm run fix`). No runtime/network/LLM unknowns; legacy
`.env` files keep working (forward-compatible), so no behavior regression.