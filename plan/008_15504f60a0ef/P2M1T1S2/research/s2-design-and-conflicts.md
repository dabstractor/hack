# P2.M1.T1.S2 — Research: canonical-first env loader + deprecation warning

Scope: build the **canonical `PRP_*` env names with legacy `ANTHROPIC_*` fallback +
one-time deprecation warning** on top of P2.M1.T1.S1's renamed tiers (high/balanced/fast).

Implementation order is **S1 → S2 (sequential)**: S2's executor runs AFTER S1's
edits are in the tree. This research assumes the POST-S1 state (keys already
high/balanced/fast; `getModel` body generic over tier; S1's `constants.test.ts`
already asserting `MODEL_ENV_VARS.* === 'ANTHROPIC_DEFAULT_*'`).

---

## 1. Post-S1 state of the files S2 edits (the CONTRACT input)

`src/config/types.ts:23`
```ts
export type ModelTier = 'high' | 'balanced' | 'fast';
```

`src/config/constants.ts` (post-S1 keys, values UNCHANGED by S1)
```ts
export const MODEL_NAMES = { high: 'glm-5.2', balanced: 'glm-5.2', fast: 'glm-5-turbo' } as const;
export const MODEL_ENV_VARS = {
  high:     'ANTHROPIC_DEFAULT_OPUS_MODEL',
  balanced: 'ANTHROPIC_DEFAULT_SONNET_MODEL',
  fast:     'ANTHROPIC_DEFAULT_HAIKU_MODEL',
} as const;
export const REQUIRED_ENV_VARS = { apiKey: 'ANTHROPIC_API_KEY', baseURL: 'ANTHROPIC_BASE_URL' } as const;
// (PRP_API_KEY, PRP_AGENT_HARNESS, DEFAULT_BASE_URL, DEFAULT_MODEL_PROVIDER already exist)
```

`src/config/environment.ts` (post-S1)
```ts
export function getResolvedProvider(): string { return getModel('balanced').split('/')[0]; }   // S1: sonnet→balanced
export function configureEnvironment(): void {
  const provider = getResolvedProvider();
  if (provider === 'anthropic' && process.env.ANTHROPIC_AUTH_TOKEN && !process.env.ANTHROPIC_API_KEY)
    process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_AUTH_TOKEN;
  if (!process.env.ANTHROPIC_BASE_URL && provider === 'zai')
    process.env.ANTHROPIC_BASE_URL = DEFAULT_BASE_URL;
}
export function getModel(tier: ModelTier): string {
  const envVar = MODEL_ENV_VARS[tier];
  return qualifyModel(process.env[envVar] ?? MODEL_NAMES[tier]);
}
export function validateEnvironment(): void {
  const missing: string[] = [];
  if (!process.env.ANTHROPIC_API_KEY) missing.push('ANTHROPIC_API_KEY');
  if (!process.env.ANTHROPIC_BASE_URL) missing.push('ANTHROPIC_BASE_URL');
  if (missing.length > 0) throw new EnvironmentValidationError(missing);
}
```

S1 ALSO creates `tests/unit/config/constants.test.ts` asserting:
- `MODEL_ENV_VARS.{high,balanced,fast}` === `'ANTHROPIC_DEFAULT_OPUS_MODEL'/'..._SONNET_MODEL'/'..._HAIKU_MODEL'`
- `MODEL_NAMES.{high,balanced,fast}` === `'glm-5.2'/'glm-5.2'/'glm-5-turbo'`
- and renames `tests/unit/config/environment.test.ts` describe('getModel') args to
  high/balanced/fast + `MODEL_NAMES.high/.balanced/.fast` keys (but KEEPS
  `stubEnv('ANTHROPIC_DEFAULT_*', …)` names unchanged — those are S2's to change).

## 2. THE CRITICAL S1→S2 CONFLICTS (S2 MUST reconcile S1's tests)

**Conflict A — S1's `constants.test.ts` asserts the OLD `MODEL_ENV_VARS` values.**
S2 changes those VALUES to canonical `PRP_MODEL_*`. So S1's
`MODEL_ENV_VARS.balanced === 'ANTHROPIC_DEFAULT_SONNET_MODEL'` assertion would FAIL
after S2. → **S2 MUST EDIT S1's `constants.test.ts`**: change MODEL_ENV_VARS value
assertions to `PRP_MODEL_HIGH/PRP_MODEL_BALANCED/PRP_MODEL_FAST` and ADD a
`LEGACY_MODEL_ENV_VARS` describe block asserting the ANTHROPIC_DEFAULT_* values.

**Conflict B — S1's `environment.test.ts` getModel tests stub legacy names.**
Post-S1 they `stubEnv('ANTHROPIC_DEFAULT_OPUS_MODEL', …)` and expect
`getModel('high')` → 'zai/custom-…'. After S2 that path is the **legacy fallback**
(which now emits a deprecation warning). The value assertion STILL holds, but:
(i) a deprecation warning now fires (test output noise / spy hygiene), and
(ii) S2 must ADD canonical-wins + warning-one-time tests. → **S2 MUST EDIT
`environment.test.ts`**: add `console.warn` spy + `_resetDeprecationWarnings()` in
afterEach, and add the canonical/legacy/default × warning matrix.

**Conflict C — `configureEnvironment` tests now trigger model deprecation.**
Tests that `stubEnv('ANTHROPIC_DEFAULT_SONNET_MODEL', …)` force the anthropic
provider (3 tests) and `should preserve custom BASE_URL` sets ANTHROPIC_BASE_URL.
Post-S2 these emit deprecation warnings during configureEnvironment(). Same fix as
Conflict B (top-level console.warn spy + reset).

## 3. `ANTHROPIC_BASE_URL` is the SDK CONTRACT (must keep being WRITTEN)

`process.env.ANTHROPIC_BASE_URL` is READ by downstream consumers — S2 must NOT stop
populating it:
- `src/config/endpoint-guard.ts:89` — `checkProviderEndpoint(process.env.ANTHROPIC_BASE_URL ?? '')`
- `src/scripts/validate-api.ts:104,158` — guard + `baseURL = process.env.ANTHROPIC_BASE_URL!`
- `src/utils/runtime-api-validator.ts:74,144`
- `src/agents/agent-factory.ts:199` — `ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL ?? ''` into agent env
- `src/config/environment.ts:192` — `validateEnvironment()` checks it

**Design:** `PRP_API_BASE_URL` is the preferred *input source*; `ANTHROPIC_BASE_URL`
remains the *SDK env contract*. `configureEnvironment()` resolves
canonical→legacy→zai-default and WRITES the result into `process.env.ANTHROPIC_BASE_URL`
so all consumers keep working unchanged. Only the SOURCE-read + a one-time
deprecation warning are added.

## 4. `REQUIRED_ENV_VARS` is DEAD CODE (contract-alignment only)

`rg REQUIRED_ENV_VARS` → only the declaration at `constants.ts:78`. Never read in src
or tests. The contract says "Update REQUIRED_ENV_VARS.baseURL to canonical
'PRP_API_BASE_URL'." → change the constant VALUE only (zero runtime effect).
`validateEnvironment()` does NOT use REQUIRED_ENV_VARS (it hardcodes the string
checks) and KEEPS checking `ANTHROPIC_BASE_URL` (the SDK contract that
configureEnvironment guarantees is set). Do NOT refactor validateEnvironment.

## 5. Deprecation warning mechanism (§9.6-compliant, one-time, testable)

- `src/utils/logger.ts` is pino-based, lazy-loaded, configured AFTER
  `configureEnvironment()` runs (it needs CLI verbose/machineReadable flags).
  Using it for a startup deprecation warning would be (a) heavyweight, (b) ordering-
  fragile. → **Use synchronous `console.warn` (stderr)** — satisfies §9.6
  "synchronous destinations" and matches the codebase precedent of `console.error`
  for actionable startup messages (`index.ts:337-348`).
- "One-time": module-private `const _deprecatedWarned = new Set<string>()` in
  environment.ts, keyed by `model:${tier}` and `'baseURL'`. getModel() is called per
  agent creation; the dedup guarantees exactly one warning per legacy var per process.
- Test hook: export `_resetDeprecationWarnings()` (underscore-prefixed, doc'd
  internal/test-only) — mirrors the existing `clearLoggerCache()` pattern in logger.ts.
- Tests assert via `vi.spyOn(console, 'warn').mockImplementation(() => {})`.

## 6. Warning message content (names the canonical replacement — PRD §9.2.8)

Model (per tier):
`[PRP] Deprecation: environment variable ${LEGACY} is deprecated; use the canonical
${CANONICAL} instead (PRD §9.2.8). The legacy alias will be removed in a future major version.`
where LEGACY/CANONICAL come from the maps for the given tier.

BaseURL:
`[PRP] Deprecation: environment variable ANTHROPIC_BASE_URL is deprecated for the
pipeline endpoint; use the canonical PRP_API_BASE_URL instead (PRD §9.2.8). …`

## 7. getModel ordering subtlety (getResolvedProvider in configureEnvironment)

`configureEnvironment()` line 1 is `const provider = getResolvedProvider();` which
calls `getModel('balanced')`. If only the legacy balanced var is set, the model
deprecation warning fires here (once). Then the baseURL logic may fire the baseURL
warning. Both are independent + one-time. No infinite loop (getResolvedProvider does
not call configureEnvironment). Safe.

## 8. Validation gate (verified)

- `npm run validate` = `lint && format:check && typecheck && test:run`
- `npm run build` = `tsc -p tsconfig.build.json` (src only)
- `npx vitest run tests/unit/config/` — config suite (environment.test.ts,
  constants.test.ts [S1's], research-timeout.test.ts, etc.)
- 100% coverage globally enforced (vitest.config.ts). The new getModel branches
  (canonical/legacy/default × warning/no-warning) MUST each be hit by tests, and the
  `_resetDeprecationWarnings` + two warn helpers must be covered.
- `rg -n "getModel\('(opus|sonnet|haiku)'" src/ tests/` must stay empty (S1's
  responsibility; S2 doesn't touch call sites).

## 9. Out of scope (hard boundaries)

- `getModel()` call sites — already high/balanced/fast post-S1; S2 does NOT touch them.
- `type ModelTier` / `MODEL_NAMES` values — S1 owns; unchanged by S2.
- `validateEnvironment()` body — unchanged (checks the SDK-populated ANTHROPIC_BASE_URL).
- `endpoint-guard.ts` / `runtime-api-validator.ts` / `agent-factory.ts` — unchanged
  (they read ANTHROPIC_BASE_URL which configureEnvironment keeps populating).
- Persona→role remapping + xhigh budget — P2.M2.
- `EnvironmentConfig.opusModel/sonnetModel/haikuModel` (types.ts) — vestigial, unchanged.
- Broader docs/CONFIGURATION.md refresh (CLI, resilience, etc.) — P6.M1.T1.S3. S2 only
  touches model/auth/endpoint prose → canonical + deprecation note.