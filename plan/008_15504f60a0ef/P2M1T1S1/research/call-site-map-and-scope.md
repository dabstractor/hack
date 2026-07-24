# Research — P2.M1.T1.S1: Tier Rename (opus/sonnet/haiku → high/balanced/fast)

> Captures every fact the executor needs. The single most important finding is in
> §3 (the **green-tree constraint forces S1 to update `getModel()` call sites**,
> which overlaps P2.M1.T1.S3 — see §4).

---

## 1. The three renamed symbols (contract LOGIC a/b/c) — exact before/after

### (a) `src/config/types.ts:23` — `ModelTier` type (VALUES change)
```ts
// BEFORE
export type ModelTier = 'opus' | 'sonnet' | 'haiku';
// AFTER
export type ModelTier = 'high' | 'balanced' | 'fast';
```
Mapping: `opus→high`, `sonnet→balanced`, `haiku→fast` (PRD §9.2.8). The
`ModelTier` JSDoc (types.ts:9–22) must be rewritten to describe high/balanced/fast.

### (b) `src/config/constants.ts:43–50` — `MODEL_NAMES` (KEYS change; VALUES unchanged)
```ts
// BEFORE
export const MODEL_NAMES = {
  opus: 'glm-5.2',
  sonnet: 'glm-5.2',
  haiku: 'glm-5-turbo',
} as const;
// AFTER  (values byte-identical)
export const MODEL_NAMES = {
  high: 'glm-5.2',
  balanced: 'glm-5.2',
  fast: 'glm-5-turbo',
} as const;
```

### (c) `src/config/constants.ts:65–69` — `MODEL_ENV_VARS` (KEYS change; VALUES unchanged)
```ts
// BEFORE
export const MODEL_ENV_VARS = {
  opus: 'ANTHROPIC_DEFAULT_OPUS_MODEL',
  sonnet: 'ANTHROPIC_DEFAULT_SONNET_MODEL',
  haiku: 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
} as const;
// AFTER  (env-var NAME strings unchanged — S2 owns canonical PRP_MODEL_* names)
export const MODEL_ENV_VARS = {
  high: 'ANTHROPIC_DEFAULT_OPUS_MODEL',
  balanced: 'ANTHROPIC_DEFAULT_SONNET_MODEL',
  fast: 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
} as const;
```
**Critical:** only the KEYS change. The VALUES (the legacy `ANTHROPIC_DEFAULT_*`
env-var name strings) stay exactly as-is. Introducing the canonical
`PRP_MODEL_HIGH` / `PRP_MODEL_BALANCED` / `PRP_MODEL_FAST` names + the
canonical-first-with-fallback loader + deprecation warning is **P2.M1.T1.S2**,
NOT S1. S1 is a pure key rename.

### DOCS (Mode A — rides with the work)
JSDoc on `ModelTier` (types.ts) and `MODEL_NAMES` (constants.ts) describing the
new tier names. Also update the `MODEL_ENV_VARS` JSDoc (its keys are renamed).
The `getModel` JSDoc tier-mapping comment block (environment.ts:100–122) must be
updated to high/balanced/fast so it is not stale.

---

## 2. The `getModel()` consumer (the coupling that drives scope)

```ts
// src/config/environment.ts:150–153  (BODY unchanged by S1 — generic over tier)
export function getModel(tier: ModelTier): string {
  const envVar = MODEL_ENV_VARS[tier];
  return qualifyModel(process.env[envVar] ?? MODEL_NAMES[tier]);
}
```
The body is generic over `tier` and compiles fine after the key rename (keys +
type stay in lockstep). The breakage is at **callers that pass literal tier
strings** — after the rename, `getModel('sonnet')` is a TYPE ERROR
(`'"sonnet"'` not assignable to `ModelTier`).

### 2a. src call sites passing literal tier strings (EXHAUSTIVE — `rg "getModel\(" src/`)
| File:line | Current | After S1 |
|---|---|---|
| `src/config/environment.ts:48` | `getModel('sonnet')` (in `getResolvedProvider`) | `getModel('balanced')` |
| `src/config/harness.ts:229` | `getModel('sonnet')` (in `runAuthPreflight`) | `getModel('balanced')` |
| `src/scripts/validate-api.ts:164` | `getModel('sonnet')` | `getModel('balanced')` |
| `src/scripts/validate-api.ts:268` | `getModel('sonnet')` | `getModel('balanced')` |
| `src/scripts/validate-api.ts:335` | `getModel('sonnet')` | `getModel('balanced')` |
| `src/agents/agent-factory.ts:175` | `getModel('sonnet')` (`createBaseConfig` default) | `getModel('balanced')` |
| `src/agents/agent-factory.ts:290` | `getModel('haiku')` (`createCoderAgent` override) | `getModel('fast')` |

**Role→tier mapping is UNCHANGED** (contract): `sonnet→balanced`, `haiku→fast`.
This is a pure 1:1 literal swap with ZERO behavior change. The agent-factory
comments at 172–174 already describe "balanced"/"fast" tiers aspirationally;
line-288 comment still says `'sonnet'`/`'haiku'` and should be updated to match.

### 2b. JSDoc/comment references to the old tier names in src (stale after rename)
- `src/config/types.ts:12–14, 20` (ModelTier JSDoc)
- `src/config/constants.ts:37–40` (MODEL_NAMES JSDoc `@example`)
- `src/config/environment.ts:22, 102–106, 114–116, 120` (getModel + getResolvedProvider JSDoc)
- `src/agents/agent-factory.ts:288` (createCoderAgent comment)

### 2c. Test call sites
| File | Status in `npm run validate` | getModel tier args to update |
|---|---|---|
| `tests/unit/config/environment.test.ts` (`describe('getModel')` lines 144–235) | **GATED** — `test:run` runs it; **breaks** if not updated | 8× `getModel('opus'\|'sonnet'\|'haiku')` → `'high'\|'balanced'\|'fast'`; 3× `MODEL_NAMES.opus/.sonnet/.haiku` → `.high/.balanced/.fast` |
| `tests/unit/config/harness-provider-compat.test.ts:139` | comment only (no call) | stale comment — optional |
| `tests/manual/env-test.ts` (73–110) | **NOT gated** (not `*.test.ts`) | 6× getModel tier args — consistency-only |
| `tests/validation/zai-api-test.ts` (192–234) | **NOT gated** (not `*.test.ts`) | 3× getModel tier args — consistency-only |

---

## 3. THE GREEN-TREE CONSTRAINT (decisive)

`package.json` scripts:
- `npm run typecheck` = `tsc --noEmit -p tsconfig.build.json`. `tsconfig.build.json`
  `include = ["src/**/*"]`, `exclude = ["…","tests"]` → **typecheck is SRC-ONLY**.
  ⇒ The 7 src `getModel('sonnet'\|'haiku')` call sites (§2a) MUST be updated or
  `typecheck` is RED. A red typecheck fails `npm run validate` AND `npm run build`.
- `npm run test:run` = `vitest run`; `vitest.config.ts` `include =
  ['tests/**/*.{test,spec}.ts']` ⇒ `tests/unit/config/environment.test.ts` IS run
  (its `getModel('opus')` would throw `TypeError: undefined.includes` at runtime
  because `MODEL_ENV_VARS['opus']` → `undefined`). ⇒ the `describe('getModel')`
  block MUST be updated or `test:run` is RED.
- `npm run validate` = `lint && format:check && typecheck && test:run` — **all green**.

**Conclusion:** A literal-rename of `ModelTier` to `'high'|'balanced'|'fast'`
CANNOT leave `npm run validate` green unless the `getModel()` literal-string call
sites (7 in src) AND the `environment.test.ts` getModel block are updated in the
SAME change. There is no narrower TS technique (a type-literal rename to a
disjoint-narrower union always invalidates callers passing the old literals).

**Therefore S1's PRP performs the COMPLETE mechanical 1:1 rename** (role→tier
mapping unchanged) so the tree stays green — exactly as PRD §9.2.8 describes the
rename ("touches `MODEL_NAMES`, `MODEL_ENV_VARS`, `getModel(tier)`, the
`ModelTier` type, and the agent factory's per-persona tier selection").

---

## 4. SCOPE BOUNDARY vs P2.M1.T1.S3 (must be disclosed to orchestrator)

`P2.M1.T1.S3` is titled **"Update getModel and all call sites for new tier
names" (2 points).** Because S1 MUST update those exact call sites to keep
`npm run validate` green (§3), **S3's separately-allocated call-site work is
FULLY COVERED by S1.** The executor should NOT re-do it.

Recommendation to orchestrator (S1's PRP states this; it cannot edit tasks.json):
- **Treat S3 as satisfied / merge S3 into S1**, OR
- **Repurpose S3** for the deeper persona→role remapping that is the *real*
  remaining Phase-2 work — but that mapping actually lives in
  **P2.M2.T1 (Three Model Roles and Maximum Reasoning Budget)**, where
  `createBaseConfig`/`createCoderAgent` gain a role + reasoning-budget parameter.
  P2.M1.T1.S3's literal-string rename is mechanical, not that deeper work.

This disclosure prevents the S3 executor from either (a) finding nothing to do
and being confused, or (b) duplicating S1's edits and causing a conflict.

---

## 5. Things explicitly OUT of S1's scope (hard boundaries)

- **`MODEL_ENV_VARS` VALUES** (`ANTHROPIC_DEFAULT_OPUS_MODEL` etc.) — unchanged.
  Canonical `PRP_MODEL_*` names + canonical-first-with-fallback loader +
  deprecation warning = **P2.M1.T1.S2**.
- **`.env.example`** (lines 49/52/55 use the `ANTHROPIC_DEFAULT_*` names) — S2
  owns the canonical-name rewrite + deprecation note. S1 is JSDoc-only (Mode A).
- **`EnvironmentConfig` interface fields** (`opusModel`/`sonnetModel`/`haikuModel`,
  types.ts:53/55/57) — DECLARED but NEVER constructed or read anywhere in src/
  (vestigial; verified: no `.opusModel` access, no construction site). S1 LEAVES
  them unchanged (not in the contract's 3 changes). Renaming them is a separate
  decision (and would require a consumer audit). Their JSDoc tier-wording is
  mildly stale but out of S1 scope.
- **PROMPTS.md / README.md / docs/\*.md** — Mode A = JSDoc only; no `.md` edits.
- **`PRP_API_BASE_URL` / `PRP_MODEL_*` canonical env vars** — S2.
- **The persona→role remapping (research/reasoning/impl) + xhigh budget** — P2.M2.

---

## 6. Test strategy

- **No existing `constants.test.ts` / `types.test.ts`** (`ls tests/unit/config/`).
  CREATE `tests/unit/config/constants.test.ts` to lock the renamed keys/values
  and `ModelTier` acceptance — guards against regressions and documents intent.
- The renamed `MODEL_NAMES`/`MODEL_ENV_VARS` keys are ALREADY exercised indirectly
  via `environment.test.ts` `describe('getModel')` once its tier args/keys are
  updated — that suite keeps 100% coverage of `getModel`/`qualifyModel`.
- The new `constants.test.ts` must be pure/deterministic (no env mutation) so it
  runs under the 100%-coverage gate (`vitest.config.ts` thresholds: stmts/branches/
  funcs/lines all 100) without flakiness.
- Baseline: `npm run test:run` is currently GREEN (run it before editing to
  establish the pre-S1 baseline). Unlike P1.M2.T1.S3, there is NO known
  pre-existing red suite in the config area.

---

## 7. Exact edit anchors (for the implementation tasks)

types.ts:23 (type) + 9–22 (JSDoc).
constants.ts:43–50 (MODEL_NAMES) + 28–42 (JSDoc); 65–69 (MODEL_ENV_VARS) + 58–64 (JSDoc).
environment.ts:48 (getModelProvider body) + 100–122 (getModel JSDoc) + 22 (getResolvedProvider @example).
harness.ts:229.
validate-api.ts:164, 268, 335.
agent-factory.ts:175, 288 (comment), 290.
environment.test.ts:154,164,174,184,192,200 (getModel tier args) + 156,166,176 (MODEL_NAMES keys) + 226,234 (qualifyModel-block getModel args).
NEW tests/unit/config/constants.test.ts.
(consistency) env-test.ts:73,74,75,108; zai-api-test.ts:192,193,194.