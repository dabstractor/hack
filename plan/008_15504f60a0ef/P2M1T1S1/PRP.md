# PRP — P2.M1.T1.S1: Rename ModelTier type and MODEL_NAMES keys to high/balanced/fast

---

## Goal

**Feature Goal**: Execute the **provider-neutral tier rename** mandated by PRD
§9.2.8 ("Provider-Neutral Configuration Naming"): rename the internal model
tiers from Anthropic model-family names (`opus`/`sonnet`/`haiku`) to
vendor-neutral quality tiers (`high`/`balanced`/`fast`). This touches the
`ModelTier` type, the `MODEL_NAMES` and `MODEL_ENV_VARS` constants' KEYS, and
— because a TypeScript type-literal rename to a narrower union cannot otherwise
compile — every `getModel('sonnet'|'haiku')` call site. **The role→tier mapping
is UNCHANGED** (`sonnet→balanced`, `haiku→fast`): this is a pure 1:1 mechanical
rename with zero behavior change. Constant/model VALUES are byte-identical.

**Deliverable**:
1. **`src/config/types.ts`** — EDIT: `type ModelTier` values `opus/sonnet/haiku → high/balanced/fast` + rewritten Mode-A JSDoc.
2. **`src/config/constants.ts`** — EDIT: `MODEL_NAMES` keys + `MODEL_ENV_VARS` keys renamed (`opus/sonnet/haiku → high/balanced/fast`); VALUES unchanged; updated JSDoc on both.
3. **`getModel()` literal-string call sites** — EDIT (mechanically REQUIRED for a green tree — see "Why" §1): 7 sites across `environment.ts`, `harness.ts`, `validate-api.ts`, `agent-factory.ts` renamed 1:1; stale tier-wording in JSDoc/comments updated.
4. **`tests/unit/config/environment.test.ts`** — EDIT: the `describe('getModel')` block's tier args + `MODEL_NAMES` keys renamed (gated by `test:run`).
5. **`tests/unit/config/constants.test.ts`** — CREATE: locks the renamed keys/values and `ModelTier` acceptance (pure, deterministic).
6. **(consistency, ungated)** `tests/manual/env-test.ts`, `tests/validation/zai-api-test.ts` — EDIT: `getModel()` tier args renamed so manual/validation runs aren't left broken.

**Success Definition**:
- `type ModelTier = 'high' | 'balanced' | 'fast';` (exactly).
- `MODEL_NAMES = { high: 'glm-5.2', balanced: 'glm-5.2', fast: 'glm-5-turbo' } as const;` (values byte-identical to today).
- `MODEL_ENV_VARS = { high: 'ANTHROPIC_DEFAULT_OPUS_MODEL', balanced: 'ANTHROPIC_DEFAULT_SONNET_MODEL', fast: 'ANTHROPIC_DEFAULT_HAIKU_MODEL' } as const;` (env-var NAME strings UNCHANGED — canonical `PRP_MODEL_*` names are S2).
- Every `getModel('sonnet')` → `getModel('balanced')`, every `getModel('haiku')` → `getModel('fast')` (1:1; role→tier mapping unchanged).
- `npm run validate` is GREEN (lint + format:check + typecheck + test:run). `npm run build` compiles.
- 100% coverage maintained on all edited src files (config area has no pre-existing red suite).

---

## Why

### 1. The green-tree constraint forces S1 to include the call sites (read this first)
The contract LOGIC lists three changes — `ModelTier` type, `MODEL_NAMES` keys,
`MODEL_ENV_VARS` keys. But renaming `type ModelTier = 'opus'|'sonnet'|'haiku'`
to `'high'|'balanced'|'fast'` is a rename to a **disjoint-narrower union**, so
every `getModel('sonnet')` / `getModel('haiku')` call site becomes a TypeScript
**type error** (`'"sonnet"' is not assignable to ModelTier`). Verified facts:
- `npm run typecheck` = `tsc -p tsconfig.build.json`, whose `include` is
  **`src/**/*` only** (`exclude: […, "tests"]`) → the **7 src** `getModel('sonnet'|'haiku')`
  call sites MUST be renamed or typecheck is RED (which also fails `build` and `validate`).
- `npm run test:run` runs `tests/unit/config/environment.test.ts` (it IS `*.test.ts`);
  its `describe('getModel')` block passes literal tier strings and would throw
  `TypeError: Cannot read properties of undefined (reading 'includes')` at runtime
  (`MODEL_ENV_VARS['opus']` → `undefined`) → `test:run` RED → `validate` RED.

There is **no narrower TS technique** to rename a literal union to a
disjoint-narrower set without updating the callers passing the old literals.
Therefore S1 performs the **complete mechanical 1:1 rename** — exactly what PRD
§9.2.8 says the rename touches: "`MODEL_NAMES`, `MODEL_ENV_VARS`, `getModel(tier)`,
the `ModelTier` type, and the agent factory's per-persona tier selection." A PRP
that asked for only the 3 symbols would instruct a **red `npm run validate`** —
an implementation failure, not a success.

### 2. Scope boundary vs P2.M1.T1.S3 — MUST be disclosed to the orchestrator
`P2.M1.T1.S3` is titled **"Update getModel and all call sites for new tier
names" (2 points).** Because S1 must update those exact call sites to keep
`validate` green (§1 above), **S3's separately-allocated call-site work is fully
covered by S1.** The executor must NOT re-do S3's edits (that would conflict).
**Recommendation to the orchestrator** (S1's PRP cannot edit `tasks.json`): treat
S3 as satisfied/merged into S1, OR repurpose S3 for the deeper persona→role
remapping — which actually lives in **P2.M2.T1 (Three Model Roles and Maximum
Reasoning Budget)**, where `createBaseConfig`/`createCoderAgent` gain a role +
reasoning-budget parameter. The mechanical tier-string rename in P2.M1 is NOT
that deeper work. (This disclosure prevents a confused or duplicate S3 run.)

### 3. Business value
Vendor-neutral naming (PRD §9.2.8): the Anthropic model-family names
`opus`/`sonnet`/`haiku` are misleading under the `pi` + `zai` default — they
imply an Anthropic dependency when the pipeline is vendor-neutral. The rename is
the **foundational** step of P2.M1; S2 (canonical `PRP_MODEL_*` env names +
deprecation fallback) and the broader P2.M2 role work build on these tiers.

### 4. Out of scope (hard boundaries)
- `MODEL_ENV_VARS` **VALUES** (`ANTHROPIC_DEFAULT_OPUS_MODEL` etc.) — unchanged; canonical `PRP_MODEL_*` names + loader + deprecation = **S2**.
- **`.env.example`** (lines 49/52/55) — S2 owns the canonical rewrite; S1 is JSDoc-only (Mode A).
- **`EnvironmentConfig` fields** (`opusModel`/`sonnetModel`/`haikuModel`, types.ts:53/55/57) — declared but **never constructed/read** anywhere in src (vestigial; verified). Left unchanged; renaming is a separate decision.
- **PROMPTS.md / README.md / docs/\*.md** — Mode A = JSDoc only; no `.md` edits.
- **persona→role remapping + xhigh budget** — P2.M2.

---

## What

### User-visible behavior
None. This is an internal rename with the role→tier mapping preserved 1:1
(`sonnet→balanced`, `haiku→fast`); the same models back the same roles. No CLI,
env-var, or runtime behavior changes (the `ANTHROPIC_DEFAULT_*` env-var names are
S2's to change).

### Technical requirements (exact contract)

**`src/config/types.ts`** — EDIT line 23 + JSDoc (lines 9–22):
```ts
/**
 * Model tier identifier for selecting models (PRD §9.2.8 — provider-neutral tiers).
 *
 * @remarks
 * Vendor-neutral QUALITY tiers (renamed from Anthropic model-family names):
 * - 'high':     Highest quality, glm-5.2 (complex reasoning, Architect agent)
 * - 'balanced': Balanced, glm-5.2 (default for most agents — planning/research)
 * - 'fast':     Fastest, glm-5-turbo (codegen / implementation role)
 *
 * The role→tier mapping is unchanged from the legacy opus/sonnet/haiku names:
 * opus→high, sonnet→balanced, haiku→fast.
 *
 * @example
 * ```ts
 * import type { ModelTier } from './config/types.js';
 *
 * const tier: ModelTier = 'balanced';
 * ```
 */
export type ModelTier = 'high' | 'balanced' | 'fast';
```

**`src/config/constants.ts`** — EDIT `MODEL_NAMES` (43–50) + `MODEL_ENV_VARS` (65–69) + their JSDoc:
```ts
/**
 * Default model names for each tier (PRD §9.2.8 — provider-neutral tier keys).
 *
 * @remarks
 * Keys are the vendor-neutral QUALITY tiers (opus→high, sonnet→balanced,
 * haiku→fast). VALUES are the model id strings (unchanged by the rename).
 * Uses const assertion to preserve literal types.
 *
 * - high:     glm-5.2 (highest quality, complex reasoning)
 * - balanced: glm-5.2 (balanced, default for most agents)
 * - fast:     glm-5-turbo (fastest, simple operations / codegen)
 *
 * @example
 * ```ts
 * import { MODEL_NAMES } from './config/constants.js';
 *
 * const highModel = MODEL_NAMES.high; // 'glm-5.2'
 * const fastModel = MODEL_NAMES.fast; // 'glm-5-turbo'
 * ```
 */
export const MODEL_NAMES = {
  /** Highest quality model for complex reasoning tasks */
  high: 'glm-5.2',
  /** Balanced model, default for most agents */
  balanced: 'glm-5.2',
  /** Fast model for simple operations / codegen */
  fast: 'glm-5-turbo',
} as const;

/**
 * Environment variable names used for model overrides (PRD §9.2.8).
 *
 * @remarks
 * KEYS are the vendor-neutral tiers (renamed); VALUES are the (still-legacy)
 * ANTHROPIC_DEFAULT_* env-var name strings. The canonical PRP_MODEL_HIGH /
 * PRP_MODEL_BALANCED / PRP_MODEL_FAST names + canonical-first-with-fallback
 * loader + deprecation warning land in P2.M1.T1.S2.
 *
 * @example
 * ```ts
 * // In shell (legacy alias — still readable until S2):
 * export ANTHROPIC_DEFAULT_OPUS_MODEL="glm-5.2"
 * ```
 */
export const MODEL_ENV_VARS = {
  high: 'ANTHROPIC_DEFAULT_OPUS_MODEL',
  balanced: 'ANTHROPIC_DEFAULT_SONNET_MODEL',
  fast: 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
} as const;
```

**`getModel()` body (`src/config/environment.ts:150–153`)** — UNCHANGED (generic over `tier`); only its JSDoc (100–122) + the `getResolvedProvider` call (line 48) change:
```ts
// line 48 — getResolvedProvider(): getModel('sonnet') → getModel('balanced')
export function getResolvedProvider(): string {
  return getModel('balanced').split('/')[0];
}
```
Update the `getModel` JSDoc tier-mapping comment (lines 102–106) and `@example`
(114–120) to high/balanced/fast, and the `getResolvedProvider` `@example`
(line 22) `getModel('sonnet')` → `getModel('balanced')`.

**Other src call sites** — 1:1 rename (role→tier mapping unchanged):
```ts
// src/config/harness.ts:229           getModel('sonnet') → getModel('balanced')
// src/scripts/validate-api.ts:164     getModel('sonnet') → getModel('balanced')
// src/scripts/validate-api.ts:268     getModel('sonnet') → getModel('balanced')
// src/scripts/validate-api.ts:335     getModel('sonnet') → getModel('balanced')
// src/agents/agent-factory.ts:175     getModel('sonnet') → getModel('balanced')  (createBaseConfig default)
// src/agents/agent-factory.ts:290     getModel('haiku')  → getModel('fast')      (createCoderAgent override)
```
Also update the `createCoderAgent` comment at agent-factory.ts:288
("the balanced 'sonnet' tier … overrides to 'haiku'") to drop the legacy quotes
("the balanced tier (glm-5.2); the Coder overrides to 'fast' (glm-5-turbo)").
The `createBaseConfig` comment at 172–174 already says "balanced"/"fast" — no change needed there.

### Success Criteria
- [ ] `type ModelTier = 'high' | 'balanced' | 'fast';` (exact).
- [ ] `MODEL_NAMES` keys = `high/balanced/fast`; values byte-identical (`'glm-5.2'`, `'glm-5.2'`, `'glm-5-turbo'`).
- [ ] `MODEL_ENV_VARS` keys = `high/balanced/fast`; values UNCHANGED (`'ANTHROPIC_DEFAULT_OPUS_MODEL'` etc.).
- [ ] Every `getModel('sonnet')` → `getModel('balanced')`; every `getModel('haiku')` → `getModel('fast')` (7 src sites + the test block). No `getModel('opus')` remains anywhere.
- [ ] Role→tier mapping UNCHANGED (1:1; no behavior change); `agent-factory` coder still uses the fast tier.
- [ ] `npm run validate` GREEN; `npm run build` compiles; 100% coverage on edited src files.
- [ ] New `tests/unit/config/constants.test.ts` asserts the renamed keys/values + `ModelTier` acceptance, pure/deterministic, green.
- [ ] Mode-A JSDoc on `ModelTier`, `MODEL_NAMES`, `MODEL_ENV_VARS` describes the new tiers (and notes S2 owns canonical env names).

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_
**Yes.** The exact before/after of all three renamed symbols is given (§"Technical
requirements"). The decisive coupling — a literal-union rename breaks
`getModel('sonnet')` callers, and `typecheck` is src-only while `test:run` runs
`environment.test.ts` — is proven from `package.json`/`tsconfig.build.json`/
`vitest.config.ts` (research §3). Every call site is enumerated with file:line and
the 1:1 replacement (research §2). The `getModel` body is shown to need NO change
(generic over `tier`). The S3 overlap is disclosed with a concrete reconciliation
recommendation (research §4). The vestigial `EnvironmentConfig` fields and the
S2-owned `.env.example`/canonical-names are fenced as out of scope (research §5).

### Documentation & References
```yaml
# MUST READ — the PRD spec this implements
- docfile: PRD.md
  section: "9.2.8 Provider-Neutral Configuration Naming" (h4.7) → "Model-tier rename" + canonical-names table
  why: Mandates opus→high, sonnet→balanced, haiku→fast; lists exactly what the rename touches
        (MODEL_NAMES, MODEL_ENV_VARS, getModel(tier), ModelTier type, agent-factory tier selection);
        states role→tier mapping unchanged. The canonical PRP_MODEL_* env names + legacy fallback = S2.
  critical: S1 = tier KEY rename only (values unchanged). S2 = canonical env NAMES + loader + deprecation.

- docfile: PRD.md
  section: "9.2.3 Model Selection" (h4.2)
  why: Defines the role→tier mapping S1 must PRESERVE 1:1: planning/research → balanced (was sonnet);
        implementation → fast (was haiku). Confirms getModel() reads env at runtime, models are provider-qualified.

# MUST READ — this subtask's research (call-site map, green-tree constraint, S3 overlap)
- docfile: plan/008_15504f60a0ef/P2M1T1S1/research/call-site-map-and-scope.md
  section: "1. The three renamed symbols", "2. The getModel() consumer", "3. THE GREEN-TREE CONSTRAINT",
           "4. SCOPE BOUNDARY vs P2.M1.T1.S3", "7. Exact edit anchors"
  why: Proven facts: the 7 src + 1 test-block call sites with file:line and 1:1 replacements; WHY S1 must
        include call sites (typecheck is src-only; environment.test.ts is gated by test:run); the S3
        overlap disclosure; EnvironmentConfig fields are vestigial (unchanged).

# THE FILES TO EDIT — exact current state
- file: src/config/types.ts
  why: EDIT line 23 (ModelTier type) + JSDoc 9–22. The ONLY type change.
  pattern: "export type ModelTier = 'opus' | 'sonnet' | 'haiku';"
  gotcha: EnvironmentConfig.opusModel/sonnetModel/haikuModel (53/55/57) are DECLARED but never
          constructed/read — LEAVE them (out of scope). Only update ModelTier + its JSDoc.

- file: src/config/constants.ts
  why: EDIT MODEL_NAMES (43–50) KEYS + MODEL_ENV_VARS (65–69) KEYS + both JSDoc blocks.
  pattern: "export const MODEL_NAMES = { opus: 'glm-5.2', sonnet: 'glm-5.2', haiku: 'glm-5-turbo' } as const;"
  gotcha: VALUES unchanged. MODEL_ENV_VARS values (the ANTHROPIC_DEFAULT_* NAME strings) MUST stay —
          canonical PRP_MODEL_* names are S2. Keep `as const` on both.

- file: src/config/environment.ts
  why: EDIT line 48 (getResolvedProvider: getModel('sonnet')→'balanced') + getModel JSDoc (100–122) +
        getResolvedProvider @example (22). getModel BODY (150–153) is UNCHANGED (generic over tier).
  pattern: "return getModel('sonnet').split('/')[0];"
  gotcha: Do NOT touch MODEL_ENV_VARS[tier]/MODEL_NAMES[tier] in the getModel body — keys + type stay
          in lockstep, so it compiles unchanged.

- file: src/config/harness.ts
  why: EDIT line 229 (runAuthPreflight: getModel('sonnet')→'balanced').
  pattern: "const model = getModel('sonnet');"

- file: src/scripts/validate-api.ts
  why: EDIT lines 164, 268, 335 (all getModel('sonnet')→'balanced').
  pattern: "const model = getModel('sonnet');"  /  "`Model: ${getModel('sonnet')}`"

- file: src/agents/agent-factory.ts
  why: EDIT line 175 (createBaseConfig default getModel('sonnet')→'balanced'), line 290
        (createCoderAgent getModel('haiku')→'fast'), line 288 comment (drop 'sonnet'/'haiku' quotes).
  pattern: "const model = getModel('sonnet');"  /  "model: getModel('haiku'),"
  gotcha: The comment at 172–174 ALREADY says "balanced"/"fast" — leave it. Only line 288 needs updating.

- file: tests/unit/config/environment.test.ts
  why: EDIT the describe('getModel') block (144–235): rename getModel tier args (154,164,174,184,
        192,200,226,234 → high/balanced/fast) and MODEL_NAMES keys (156,166,176 → .high/.balanced/.fast).
  pattern: "expect(getModel('opus')).toBe(`${DEFAULT_MODEL_PROVIDER}/${MODEL_NAMES.opus}`)"
  gotcha: KEEP the stubEnv('ANTHROPIC_DEFAULT_OPUS_MODEL', …) calls UNCHANGED — those are the env-var
          NAMES (S2's concern). Only the getModel tier ARG and the MODEL_NAMES KEY change.

# PATTERN FILES — test style to mirror
- file: tests/unit/config/research-timeout.test.ts
  why: Mirror its pure, deterministic constants-test style for the NEW constants.test.ts.
  pattern: "describe('…', () => { it('SHOULD …', () => { expect(CONST).toBe(...) }) })"
  gotcha: No env mutation in the new constants tests (assert against static `as const` values + type-level
          `ModelTier` acceptance via a typed const). Keeps the 100%-coverage gate deterministic.

# CONSISTENCY-ONLY (NOT gated by validate — not *.test.ts) — update so manual/validation runs aren't broken
- file: tests/manual/env-test.ts
  why: getModel('opus'/'sonnet'/'haiku') at 73–75,108 → high/balanced/fast. NOT run by vitest (not *.test.ts).
  gotcha: Has pre-existing stale 'GLM-4.7' checks — leave those (out of scope); ONLY rename the tier args.
- file: tests/validation/zai-api-test.ts
  why: getModel('opus'/'sonnet'/'haiku') at 192–194 → high/balanced/fast. NOT run by vitest.
  gotcha: Local object keys at 232–234 (opus/sonnet/haiku) are NOT the ModelTier type — optionally rename
          for consistency but NOT required; only the getModel tier ARGS are mechanical S1 work.
```

### Current Codebase tree (relevant slice)
```bash
src/config/
├── types.ts                 # EDIT — ModelTier type (23) + JSDoc (9–22)
├── constants.ts             # EDIT — MODEL_NAMES (43–50) + MODEL_ENV_VARS (65–69) keys + JSDoc
├── environment.ts           # EDIT — getResolvedProvider (48) + getModel JSDoc (100–122); BODY (150–153) unchanged
└── harness.ts               # EDIT — runAuthPreflight (229)
src/agents/
└── agent-factory.ts         # EDIT — createBaseConfig (175), createCoderAgent (290) + comment (288)
src/scripts/
└── validate-api.ts          # EDIT — 164, 268, 335
tests/unit/config/
├── environment.test.ts      # EDIT — describe('getModel') tier args + MODEL_NAMES keys
└── constants.test.ts        # CREATE — lock renamed keys/values + ModelTier
tests/manual/env-test.ts            # EDIT (consistency) — getModel tier args
tests/validation/zai-api-test.ts    # EDIT (consistency) — getModel tier args
```

### Desired Codebase tree with files to be added/edited
```bash
src/config/types.ts                   # MODIFIED (ModelTier values + JSDoc)
src/config/constants.ts               # MODIFIED (MODEL_NAMES + MODEL_ENV_VARS keys + JSDoc; values unchanged)
src/config/environment.ts             # MODIFIED (getResolvedProvider getModel arg; getModel/getResolvedProvider JSDoc)
src/config/harness.ts                 # MODIFIED (getModel arg)
src/agents/agent-factory.ts           # MODIFIED (2 getModel args + 1 comment)
src/scripts/validate-api.ts           # MODIFIED (3 getModel args)
tests/unit/config/environment.test.ts # MODIFIED (getModel tier args + MODEL_NAMES keys in describe('getModel'))
tests/unit/config/constants.test.ts   # NEW (lock renamed keys/values + ModelTier)
tests/manual/env-test.ts              # MODIFIED (consistency — getModel tier args)
tests/validation/zai-api-test.ts      # MODIFIED (consistency — getModel tier args)
```

### Known Gotchas of our codebase & Library Quirks
```ts
// CRITICAL — a literal-union rename to 'high'|'balanced'|'fast' makes every getModel('sonnet'|'haiku')
//   a TYPE ERROR. typecheck (tsconfig.build.json) is SRC-ONLY, so the 7 src sites break the build.
//   environment.test.ts (a *.test.ts) breaks test:run at runtime. BOTH must be updated for a green
//   `npm run validate`. There is no narrower technique — update the call sites (research §3).

// CRITICAL — role→tier mapping is UNCHANGED. sonnet→balanced, haiku→fast, 1:1. Do NOT reshuffle
//   which persona uses which tier (that's P2.M2's persona→role remapping). createBaseConfig default
//   stays balanced; createCoderAgent stays fast.

// CRITICAL — MODEL_ENV_VARS VALUES (the ANTHROPIC_DEFAULT_* NAME strings) are UNCHANGED. Only the
//   KEYS rename. Canonical PRP_MODEL_HIGH/BALANCED/FAST names + canonical-first loader + deprecation
//   warning = P2.M1.T1.S2. Do NOT introduce PRP_MODEL_* here.

// GOTCHA — getModel BODY (environment.ts:150–153) needs NO change: `MODEL_ENV_VARS[tier]` and
//   `MODEL_NAMES[tier]` stay in lockstep with the renamed type, so it compiles unchanged. Only its
//   JSDoc tier-mapping comment + @example + the getResolvedProvider call (48) change.

// GOTCHA — EnvironmentConfig.opusModel/sonnetModel/haikuModel (types.ts:53/55/57) are declared but
//   NEVER constructed or read in src (vestigial). LEAVE them — not in the contract's 3 changes.

// GOTCHA — keep `as const` on MODEL_NAMES and MODEL_ENV_VARS (preserves literal key types so
//   `keyof typeof MODEL_NAMES` resolves to 'high'|'balanced'|'fast', matching ModelTier).

// GOTCHA — in environment.test.ts, KEEP the stubEnv('ANTHROPIC_DEFAULT_OPUS_MODEL', …) calls unchanged;
//   those are env-var NAMES (S2). Only the getModel tier ARG and the MODEL_NAMES KEY change.

// GOTCHA — prettier is ERROR-enforced (format:check). Run `npm run fix` before `npm run validate`.
//   100% coverage is globally enforced (vitest.config.ts thresholds 100). The new constants.test.ts
//   must be pure/deterministic (no env mutation) to avoid flakiness under the coverage gate.

// CRITICAL — S1's call-site edits FULLY COVER P2.M1.T1.S3's scope. Do NOT re-do them in S3
//   (conflict). Recommend orchestrator reconcile S3 (merge or repurpose for P2.M2's deeper work).
```

---

## Implementation Blueprint

### Data models and structure
No new types. `ModelTier` is renamed in place (`'high'|'balanced'|'fast'`).
`MODEL_NAMES` / `MODEL_ENV_VARS` keep their `as const` shape with renamed keys.

```ts
// src/config/types.ts:23
export type ModelTier = 'high' | 'balanced' | 'fast';

// src/config/constants.ts
export const MODEL_NAMES = { high: 'glm-5.2', balanced: 'glm-5.2', fast: 'glm-5-turbo' } as const;
export const MODEL_ENV_VARS = {
  high: 'ANTHROPIC_DEFAULT_OPUS_MODEL',
  balanced: 'ANTHROPIC_DEFAULT_SONNET_MODEL',
  fast: 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
} as const;

// src/config/environment.ts:150–153  (UNCHANGED — generic over tier)
export function getModel(tier: ModelTier): string {
  const envVar = MODEL_ENV_VARS[tier];
  return qualifyModel(process.env[envVar] ?? MODEL_NAMES[tier]);
}
```

### Implementation Tasks (ordered by dependencies)
```yaml
Task 1: EDIT src/config/types.ts   (the type + JSDoc — the foundational change)
  - CHANGE line 23: `export type ModelTier = 'opus' | 'sonnet' | 'haiku';`
        → `export type ModelTier = 'high' | 'balanced' | 'fast';`
  - REWRITE the ModelTier JSDoc (lines 9–22) to describe high/balanced/fast (see "Technical requirements"),
        noting the opus→high/sonnet→balanced/haiku→fast mapping and that role→tier mapping is unchanged.
  - DO NOT touch EnvironmentConfig (interface fields opusModel/sonnetModel/haikuModel are vestigial — leave them).
  - EXPECTED NOW: typecheck goes RED at the 7 getModel call sites (expected — fixed in Tasks 3–6).

Task 2: EDIT src/config/constants.ts   (MODEL_NAMES + MODEL_ENV_VARS keys + JSDoc)
  - RENAME MODEL_NAMES keys (43–50): opus→high, sonnet→balanced, haiku→fast. VALUES byte-identical.
        Update the inline `/** … */` comments + the JSDoc block (28–42) + @example (37–40).
  - RENAME MODEL_ENV_VARS keys (65–69): opus→high, sonnet→balanced, haiku→fast. VALUES UNCHANGED
        (the ANTHROPIC_DEFAULT_* name strings). Update the JSDoc (58–64) noting S2 owns canonical names.
  - KEEP `as const` on BOTH. EXPECTED: constants.ts self-consistent; getModel body still typechecks.

Task 3: EDIT src/config/environment.ts   (getModel consumer + JSDoc)
  - CHANGE line 48: `return getModel('sonnet').split('/')[0];` → `return getModel('balanced').split('/')[0];`
  - UPDATE getModel JSDoc (100–122): tier-mapping comment (102–106) + @param (106) + @example (114–120)
        to high/balanced/fast. UPDATE getResolvedProvider @example (22): getModel('sonnet')→getModel('balanced').
  - DO NOT change the getModel BODY (150–153). EXPECTED: environment.ts typechecks green.

Task 4: EDIT src/config/harness.ts + src/scripts/validate-api.ts + src/agents/agent-factory.ts   (remaining call sites)
  - harness.ts:229     getModel('sonnet') → getModel('balanced')
  - validate-api.ts:164,268,335   getModel('sonnet') → getModel('balanced')   (3 sites)
  - agent-factory.ts:175  getModel('sonnet') → getModel('balanced')   (createBaseConfig default)
  - agent-factory.ts:290  getModel('haiku')  → getModel('fast')        (createCoderAgent override)
  - agent-factory.ts:288  update comment: drop the legacy 'sonnet'/'haiku' quotes ("the balanced tier
        (glm-5.2); the Coder overrides to 'fast' (glm-5-turbo)"). Leave the 172–174 comment (already balanced/fast).
  - EXPECTED: `npm run typecheck` GREEN (all 7 src sites renamed; typecheck is src-only).

Task 5: EDIT tests/unit/config/environment.test.ts   (the gated test block)
  - IN describe('getModel') (144–235): rename the getModel tier ARG and the MODEL_NAMES KEY in each assertion:
        getModel('opus')→getModel('high');    MODEL_NAMES.opus→MODEL_NAMES.high      (lines 154,156,184,226,234)
        getModel('sonnet')→getModel('balanced'); MODEL_NAMES.sonnet→MODEL_NAMES.balanced  (164,166,192)
        getModel('haiku')→getModel('fast');   MODEL_NAMES.haiku→MODEL_NAMES.fast      (174,176,200)
  - KEEP the stubEnv('ANTHROPIC_DEFAULT_OPUS_MODEL'/'..._SONNET_MODEL'/'..._HAIKU_MODEL', …) calls UNCHANGED
        (those are env-var NAMES — S2). KEEP the test descriptions' intent (rename wording to high/balanced/fast).
  - EXPECTED: `npx vitest run tests/unit/config/environment.test.ts` GREEN.

Task 6: CREATE tests/unit/config/constants.test.ts   (lock the renamed keys/values + ModelTier)
  - IMPORT: MODEL_NAMES, MODEL_ENV_VARS from '../../../src/config/constants.js'; type ModelTier from
        '../../../src/config/types.js' (type-only import).
  - CASES (pure, deterministic, no env mutation):
      * describe('MODEL_NAMES'): SHOULD map high→'glm-5.2', balanced→'glm-5.2', fast→'glm-5-turbo';
        SHOULD NOT have legacy opus/sonnet/haiku keys (`expect((MODEL_NAMES as any).opus).toBeUndefined()` etc.).
      * describe('MODEL_ENV_VARS'): SHOULD map high→'ANTHROPIC_DEFAULT_OPUS_MODEL',
        balanced→'ANTHROPIC_DEFAULT_SONNET_MODEL', fast→'ANTHROPIC_DEFAULT_HAIKU_MODEL'; no legacy keys.
      * describe('ModelTier'): a typed `const t: ModelTier = 'high'` (and 'balanced','fast') compiles
        (type-level guard); optionally assert Object.keys(MODEL_NAMES) / Object.keys(MODEL_ENV_VARS) equal
        ['high','balanced','fast'] (proves keys match the type).
  - FOLLOW pattern: tests/unit/config/research-timeout.test.ts (pure, BDD it('SHOULD …')).
  - EXPECTED: green; adds coverage for the renamed constants.

Task 7: EDIT tests/manual/env-test.ts + tests/validation/zai-api-test.ts   (consistency — NOT gated)
  - env-test.ts:73,74,75,108  getModel('opus'/'sonnet'/'haiku') → getModel('high'/'balanced'/'fast').
        (Leave pre-existing 'GLM-4.7' staleness — out of scope.)
  - zai-api-test.ts:192,193,194  getModel('opus'/'sonnet'/'haiku') → getModel('high'/'balanced'/'fast').
        (Local object keys at 232–234 are optional to rename; only the getModel ARGS are mechanical.)
  - EXPECTED: these files are not run by vitest (not *.test.ts) and not typechecked by validate; updating
        them keeps manual/validation runs from throwing at the renamed tiers.

Task 8: FORMAT + VERIFY
  - RUN: npm run fix → npm run validate (lint + format:check + typecheck + test:run). MUST be green.
  - RUN: npm run build (tsc -p tsconfig.build.json). MUST compile.
  - RUN: npx vitest run tests/unit/config/ --coverage (config suite green; 100% on edited src files).
  - RUN: rg -n "getModel\('(opus|sonnet|haiku)'" src/ tests/   (EXPECTED: zero matches — all renamed).
  - EXPECTED: full green; no lingering legacy tier literals in getModel calls.
```

### Implementation Patterns & Key Details
```ts
// ---- src/config/types.ts:23 (the foundational rename) ----
export type ModelTier = 'high' | 'balanced' | 'fast';

// ---- src/config/constants.ts (keys rename; values unchanged; keep `as const`) ----
export const MODEL_NAMES = {
  high: 'glm-5.2',
  balanced: 'glm-5.2',
  fast: 'glm-5-turbo',
} as const;

export const MODEL_ENV_VARS = {
  high: 'ANTHROPIC_DEFAULT_OPUS_MODEL',
  balanced: 'ANTHROPIC_DEFAULT_SONNET_MODEL',
  fast: 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
} as const;

// ---- src/config/environment.ts:150–153 (BODY UNCHANGED — generic over tier) ----
export function getModel(tier: ModelTier): string {
  const envVar = MODEL_ENV_VARS[tier];
  return qualifyModel(process.env[envVar] ?? MODEL_NAMES[tier]);
}
// line 48 (getResolvedProvider): getModel('sonnet') → getModel('balanced')

// ---- call-site 1:1 rename (role→tier mapping UNCHANGED) ----
// createBaseConfig default:  getModel('sonnet') → getModel('balanced')
// createCoderAgent override: getModel('haiku')  → getModel('fast')

// ---- tests/unit/config/constants.test.ts (NEW — type-level + value lock) ----
import { MODEL_NAMES, MODEL_ENV_VARS } from '../../../src/config/constants.js';
import type { ModelTier } from '../../../src/config/types.js';

describe('MODEL_NAMES', () => {
  it('SHOULD map vendor-neutral tiers to model ids', () => {
    expect(MODEL_NAMES.high).toBe('glm-5.2');
    expect(MODEL_NAMES.balanced).toBe('glm-5.2');
    expect(MODEL_NAMES.fast).toBe('glm-5-turbo');
  });
  it('SHOULD NOT expose legacy opus/sonnet/haiku keys', () => {
    expect((MODEL_NAMES as Record<string, unknown>).opus).toBeUndefined();
    expect((MODEL_NAMES as Record<string, unknown>).sonnet).toBeUndefined();
    expect((MODEL_NAMES as Record<string, unknown>).haiku).toBeUndefined();
  });
});
// (+ MODEL_ENV_VARS analog asserting the UNCHANGED ANTHROPIC_DEFAULT_* values, and a
//    ModelTier type-level acceptance: `const t: ModelTier = 'high' | 'balanced' | 'fast'`.)
```

### Integration Points
```yaml
TYPE (src/config/types.ts):
  - ModelTier: 'opus'|'sonnet'|'haiku' → 'high'|'balanced'|'fast'. (+ Mode-A JSDoc)

CONSTANTS (src/config/constants.ts):
  - MODEL_NAMES keys: opus/sonnet/haiku → high/balanced/fast (VALUES unchanged). (+ JSDoc)
  - MODEL_ENV_VARS keys: opus/sonnet/haiku → high/balanced/fast (VALUES = legacy ANTHROPIC_* names, unchanged). (+ JSDoc)

CONSUMERS (1:1 rename; role→tier mapping unchanged):
  - environment.ts getResolvedProvider (48): sonnet→balanced
  - harness.ts runAuthPreflight (229): sonnet→balanced
  - validate-api.ts (164,268,335): sonnet→balanced
  - agent-factory.ts createBaseConfig (175): sonnet→balanced ; createCoderAgent (290): haiku→fast

TESTS:
  - environment.test.ts describe('getModel'): tier args + MODEL_NAMES keys renamed (stubEnv NAMES unchanged)
  - NEW constants.test.ts: lock renamed keys/values + ModelTier

NO CHANGES TO (hard boundary):
  - MODEL_ENV_VARS values / .env.example / canonical PRP_MODEL_* names → P2.M1.T1.S2
  - EnvironmentConfig fields (opusModel/sonnetModel/haikuModel) — vestigial, unchanged
  - PROMPTS.md / README.md / docs/*.md — Mode A = JSDoc only
  - persona→role remapping + xhigh budget → P2.M2
  - P2.M1.T1.S3's call-site scope — FULLY COVERED by Tasks 3–5 (recommend orchestrator reconcile S3)
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
npm run fix            # lint:fix + prettier --write (run first)
npm run typecheck      # tsc --noEmit -p tsconfig.build.json (SRC-ONLY — must be green after Task 4)
# Targeted:
npx eslint src/config/types.ts src/config/constants.ts src/config/environment.ts \
           src/config/harness.ts src/agents/agent-factory.ts src/scripts/validate-api.ts
npx prettier --check src/config/types.ts src/config/constants.ts src/config/environment.ts
# Expected: Zero errors. Most likely failure: a missed getModel('sonnet'|'haiku') call site → typecheck
#   error "Argument of type '"sonnet"' is not assignable to parameter of type 'ModelTier'". Fix by
#   renaming that site (sonnet→balanced / haiku→fast). Confirm zero residual legacy literals:
rg -n "getModel\('(opus|sonnet|haiku)'" src/   # MUST be empty
```

### Level 2: Unit Tests (Component Validation)
```bash
# The renamed constants (NEW — pure, deterministic):
npx vitest run tests/unit/config/constants.test.ts
#   Expected: green. If a MODEL_NAMES.high / MODEL_ENV_VARS.balanced assertion fails, the key rename is wrong.

# The getModel wiring (gated by test:run — was the red-tree risk):
npx vitest run tests/unit/config/environment.test.ts
#   Expected: green, incl. the renamed describe('getModel') cases. If "TypeError: Cannot read properties of
#   undefined (reading 'includes')" appears, a getModel('opus'/'sonnet'/'haiku') or MODEL_NAMES.<old> remains.

# Full config suite (proves the rename didn't regress auth/harness/endpoint guards):
npx vitest run tests/unit/config/ --coverage
#   Expected: green; 100% coverage on edited src files (types.ts/constants.ts/environment.ts/harness.ts).
```

### Level 3: Integration / Regression (System Validation)
```bash
# Full validate gate (the green-tree proof):
npm run validate      # = lint && format:check && typecheck && test:run  → MUST exit 0
npm run build         # tsc -p tsconfig.build.json → dist/ emits cleanly (proves src compiles)
# Whole suite — no NEW regressions (config area has NO pre-existing red suite):
npm run test:run
# Expected: all green. If a non-config test fails on getModel, it passed a legacy tier literal —
#   `rg -n "getModel\('(opus|sonnet|haiku)'" tests/` to find it and rename (it's a call site S1 owns
#   for a green tree; *.test.ts files are gated, manual/validation are consistency).
```

### Level 4: Creative & Domain-Specific Validation
```bash
# No MCP/DB/HTTP. Domain checks (record in commit message):
#   1. Semantic equivalence — the rename preserves the role→tier mapping 1:1. Prove via getModel:
node --input-type=module -e "
import('./dist/config/environment.js').then(({ getModel }) => {
  // After S1: balanced==old-sonnet, fast==old-haiku, high==old-opus (same models, same env vars).
  console.log('balanced =', getModel('balanced')); // 'zai/glm-5.2'  (was getModel('sonnet'))
  console.log('fast     =', getModel('fast'));     // 'zai/glm-5-turbo' (was getModel('haiku'))
  console.log('high     =', getModel('high'));     // 'zai/glm-5.2'  (was getModel('opus'))
});"   # (run `npm run build` first; Expected: same provider-qualified strings the old tiers produced.)
#   2. Env-override path intact — MODEL_ENV_VARS values unchanged, so overrides still resolve:
#        ANTHROPIC_DEFAULT_HAIKU_MODEL=custom → getModel('fast') === 'zai/custom'  (S2 will canonicalize names)
#   3. No legacy tier literal survives anywhere in src/tests getModel calls:
rg -n "getModel\('(opus|sonnet|haiku)'" src/ tests/   # MUST be empty
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` exits 0 (src-only; all 7 getModel call sites renamed).
- [ ] `npm run validate` exits 0 (lint + format:check + typecheck + test:run).
- [ ] `npm run build` compiles (dist/ emits).
- [ ] `npx vitest run tests/unit/config/ --coverage` exits 0; 100% on edited src files.
- [ ] `rg -n "getModel\('(opus|sonnet|haiku)'" src/ tests/` is empty.

### Feature Validation
- [ ] `type ModelTier = 'high' | 'balanced' | 'fast';` (exact).
- [ ] `MODEL_NAMES` keys = high/balanced/fast; values byte-identical (`glm-5.2`/`glm-5.2`/`glm-5-turbo`).
- [ ] `MODEL_ENV_VARS` keys = high/balanced/fast; values UNCHANGED (`ANTHROPIC_DEFAULT_OPUS_MODEL` etc.).
- [ ] Every former `getModel('sonnet')` → `getModel('balanced')`; `getModel('haiku')` → `getModel('fast')`; `getModel('opus')` → `getModel('high')` (where present). Role→tier mapping unchanged (1:1).
- [ ] `environment.test.ts` describe('getModel') green with renamed args/keys; stubEnv NAMES unchanged.
- [ ] NEW `constants.test.ts` locks the renamed keys/values + ModelTier (green, pure/deterministic).

### Code Quality Validation
- [ ] `as const` preserved on MODEL_NAMES and MODEL_ENV_VARS (literal key types match ModelTier).
- [ ] getModel BODY (environment.ts:150–153) unchanged (generic over tier — needed no edit).
- [ ] Mode-A JSDoc on ModelTier, MODEL_NAMES, MODEL_ENV_VARS describes high/balanced/fast and notes S2 owns canonical env names.
- [ ] EnvironmentConfig fields, .env.example, and all docs/*.md UNCHANGED (out of scope).
- [ ] S3 call-site scope FULLY COVERED; overlap disclosed (recommend orchestrator reconcile S3).

### Documentation & Deployment
- [ ] Mode-A JSDoc is the only doc artifact (rides with the code).
- [ ] Commit message notes: the green-tree constraint (why call sites are in S1), the unchanged role→tier mapping, the unchanged MODEL_ENV_VARS values (S2 owns canonical names), and the S3 overlap/reconciliation recommendation.

---

## Anti-Patterns to Avoid

- ❌ Don't rename `MODEL_ENV_VARS` VALUES (the `ANTHROPIC_DEFAULT_*` strings) or introduce `PRP_MODEL_*` — that's S2. Only the KEYS change.
- ❌ Don't change `MODEL_NAMES` VALUES — they're byte-identical (`glm-5.2`/`glm-5.2`/`glm-5-turbo`). Only the KEYS change.
- ❌ Don't leave `getModel('sonnet'|'haiku')` call sites unrenamed — typecheck is src-only and WILL fail the build; environment.test.ts WILL fail test:run. A red `validate` is implementation failure, not success.
- ❌ Don't reshuffle the persona→tier mapping — it's a 1:1 swap (sonnet→balanced, haiku→fast). The deeper research/reasoning/impl role remapping is P2.M2, NOT this subtask.
- ❌ Don't drop `as const` on MODEL_NAMES/MODEL_ENV_VARS — literal key types must match ModelTier.
- ❌ Don't touch the getModel BODY (`MODEL_ENV_VARS[tier]` / `MODEL_NAMES[tier]`) — keys + type stay in lockstep, so it compiles unchanged. Only its JSDoc + the getResolvedProvider call change.
- ❌ Don't rename `EnvironmentConfig.opusModel/sonnetModel/haikuModel` — they're vestigial (never constructed/read) and out of the contract's 3 changes.
- ❌ Don't edit `.env.example`, `PROMPTS.md`, `README.md`, or `docs/*.md` — Mode A is JSDoc-only; canonical env names are S2.
- ❌ Don't change the `stubEnv('ANTHROPIC_DEFAULT_OPUS_MODEL', …)` calls in environment.test.ts — those are env-var NAMES (S2's scope). Only the getModel tier ARG and MODEL_NAMES KEY change.
- ❌ Don't re-do the call-site rename in P2.M1.T1.S3 — it's fully covered here; doing so again causes a conflict. (Recommend the orchestrator reconcile S3.)

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: This is a mechanical, fully-mapped rename. Every edit is pinned to a
file:line with the exact 1:1 replacement (research §2, §7). The one genuinely
non-obvious decision — that S1 MUST include the `getModel()` call sites for a
green tree — is proven from the toolchain config (`typecheck` is src-only via
`tsconfig.build.json`; `environment.test.ts` is gated by `test:run` via
`vitest.config.ts`) and is mandated by PRD §9.2.8's own enumeration of the rename's
touch points. The S3 overlap is disclosed with a concrete reconciliation path so
the next subtask doesn't conflict. The role→tier mapping is preserved 1:1, so
there is zero behavior risk; `getModel`'s body needs no change (keys + type stay
in lockstep). Residual risks are mechanical and gate-caught: (a) a missed call
site → typecheck error naming the exact file:line (close by renaming it); (b) a
stale `MODEL_NAMES.<old>` in environment.test.ts → runtime TypeError (close by
the key rename); (c) a prettier nit (auto-fixed via `npm run fix`). No
runtime/network/LLM unknowns; no pre-existing red suite in the config area.
```