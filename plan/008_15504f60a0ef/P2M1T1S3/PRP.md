# PRP — P2.M1.T1.S3: Update getModel and all call sites for new tier names

---

## Goal

**Feature Goal**: Complete the provider-neutral tier-rename cleanup (PRD §9.2.8) by
sweeping the **tier-name references that S1 and S2 left behind**, and **fixing a latent
bug** S1's rename introduced. Concretely: (1) repair `tests/unit/agents/cache-key-isolation.test.ts`
where `MODEL_NAMES.sonnet` now resolves to `undefined` post-rename; (2) refresh stale tier
WORDS (`sonnet`/`haiku`) in the `createBaseConfig` function JSDoc and a gated test comment;
(3) verify the `getModel` JSDoc documents both canonical-first resolution **and** the tier
names (already satisfied by S1+S2 — confirm only); (4) optional cosmetic consistency in the
non-gated validation script. The OUTPUT is the contract's stated end state: **all functional
`getModel()` calls and tier-name references use the new `high`/`balanced`/`fast` names** —
ready to be consumed by P2.M2.T1.S1.

> **Scope-reconciliation note (read first).** S3's contract **literally** specifies the
> `getModel()` call-site rename (`sonnet`→`balanced`, `haiku`→`fast`) plus a `getModel`
> JSDoc. That literal scope is **already complete**:
> - **S1** (committed `260eb40` "feat(config): rename model tiers to neutral names") renamed
>   every `getModel()` call site, the `describe('getModel')` test args, and created
>   `constants.test.ts` — verified: zero `getModel('(opus|sonnet|haiku)')` remain in `src/`
>   or `tests/`. S1's own PRP disclosed that "S3's separately-allocated call-site work is
>   fully covered by S1."
> - **S2** (applied in the uncommitted working tree) added the canonical-first loader +
>   `LEGACY_MODEL_ENV_VARS` + `PRP_API_BASE_URL` + deprecation machinery, AND the
>   comprehensive `getModel` JSDoc (environment.ts:175–210) that documents **both**
>   canonical-first-with-fallback resolution **and** the tier names.
>
> **Therefore S3 is the bounded CLEANUP remainder** (§1 latent-bug fix + §2–3 stale-word
> sweep + §4 verify + §5 optional). Do **NOT** re-edit S1's call sites or S2's loader/JSDoc
> — that conflicts. S3 only fills the gaps enumerated below.

**Deliverable**:
1. **`tests/unit/agents/cache-key-isolation.test.ts`** — EDIT line 34: `MODEL_NAMES.sonnet`
   → `MODEL_NAMES.balanced`; rename const `ZAI_GLM_47` → `ZAI_BALANCED` + update its comment
   to `// 'zai/glm-5.2' (balanced tier)` (the latent `undefined`-bug fix).
2. **`src/agents/agent-factory.ts`** — EDIT lines 150-151: drop legacy tier words in the
   `createBaseConfig` function-level JSDoc (`"the \`sonnet\` (balanced) model tier … the
   \`haiku\` (fast) tier"` → `"the balanced model tier … the fast tier"`).
3. **`tests/unit/agents/agent-factory.test.ts`** — EDIT line 88 comment: `"All personas use
   sonnet tier"` → `"All personas use balanced tier"`.
4. **`src/config/environment.ts`** — VERIFY ONLY (no edit unless a gap): the `getModel` JSDoc
   (175–210) already documents canonical-first resolution + the `high`/`balanced`/`fast`
   tiers. If intact, leave it (S2 owns it).
5. **`tests/validation/zai-api-test.ts`** — EDIT (optional, NOT gated): rename local labels
   `opusModel/sonnetModel/haikuModel` → `highModel/balancedModel/fastModel` (192–194) and the
   detail-object keys `opus/sonnet/haiku` → `high/balanced/fast` (232–234) for full tier-name
   consistency.

**Success Definition**:
- `rg -n "MODEL_NAMES\.(opus|sonnet|haiku)" src/ tests/` → **zero matches** (the §1 bug is gone).
- `rg -nw "sonnet|haiku|opus" src/` → only the intentional legacy-mapping notes in
  `types.ts`/`constants.ts` JSDoc (the `opus→high/sonnet→balanced/haiku→fast` legend) and the
  vestigial `EnvironmentConfig` field NAMES (S1's hard boundary); no stale tier words in
  `agent-factory.ts` or its test.
- `getModel` JSDoc documents both canonical-first resolution and the three tiers (verified).
- `npm run validate` GREEN; `npm run build` compiles; config + agents test suites green; 100%
  coverage on `src/**/*.ts` unchanged (S3 edits no src logic body).

---

## Why

### 1. The latent `MODEL_NAMES.sonnet` bug is the real deliverable (read this first)
S1 renamed `MODEL_NAMES` keys from `opus/sonnet/haiku` to `high/balanced/fast`. But
`cache-key-isolation.test.ts:34` still reads `MODEL_NAMES.sonnet`, which is now **`undefined`**,
so the const `ZAI_GLM_47` silently evaluates to the string `'zai/undefined'`. It escapes the
gates because: `tsc` (typecheck) is **src-only** (`tsconfig.build.json` excludes `tests/`);
vitest uses esbuild (no test-file typecheck); and the test only asserts cache-key
**distinctness** + hex format, never the literal model value — so `'zai/undefined'` still
"passes". This is a genuine correctness/clarity defect introduced by S1's rename and is
exactly contract item (d) ("Update any constants or tests that reference tier names by
string"). Fixing it is S3's highest-value, non-overlapping work.

### 2. Stale tier words in JSDoc/comments are the S1 remainder
S1 updated the **inline** comments in `agent-factory.ts` (lines 172-174, 288-290) and
`environment.ts`/`harness.ts`/`validate-api.ts`, but it did **not** reach the
`createBaseConfig` **function-level JSDoc** (150-151) or the `agent-factory.test.ts:88`
comment — both still say `sonnet`/`haiku`. These are tier-name references S3 sweeps for the
contract's "all tier references use new names" OUTPUT. (S1 flagged this class of remainder
as expected.)

### 3. The DOCS item is already satisfied by S1+S2 — S3 only verifies
Contract item (5) asks for "JSDoc on getModel documenting canonical-first resolution and
tier names." S2's `getModel` JSDoc (environment.ts:175-210) already lists the canonical→
legacy→default resolution **and** a "Model tier mappings (defaults)" block with
`high`/`balanced`/`fast`, plus an `@example` using `getModel('high'|'balanced'|'fast')`.
S3 confirms this is intact and fills a gap only if one exists — it does not rewrite S2's JSDoc.

### 4. Business value & boundaries
This closes out P2.M1.T1 (the tier rename + canonical config milestone) cleanly: no lingering
`MODEL_NAMES.<old>` reads, no stale tier words in src, getModel self-documenting. P2.M2.T1.S1
(persona→role remapping + reasoning budget) then builds on tiers that are consistently named
everywhere they're referenced. S3 deliberately stays inside the tier-NAME cleanup lane — it
does **not** touch env-var NAMES (S2), `ModelTier`/`MODEL_NAMES` values (S1), or docs prose
(P6).

### 5. Out of scope (hard boundaries)
- **Functional `getModel()` call sites** — already high/balanced/fast post-S1; re-editing
  conflicts.
- **`getModel()` body / canonical loader / deprecation machinery / `getModel` JSDoc** — S2
  (working tree); S3 verifies only.
- **`type ModelTier`, `MODEL_NAMES`/`MODEL_ENV_VARS` keys & values** — S1; unchanged.
- **`docs/CUSTOM_AGENTS.md`** (stale `getModel('sonnet')` example + opus/sonnet/haiku prose),
  **`docs/CONFIGURATION.md:512`**, **`README.md:411`**, **`docs/research/prp-research-summary.md`** —
  broader doc prose sweep (Mode A = JSDoc-primary here; docs sweep = P6). FLAG for orchestrator.
- **`src/config/types.ts` vestigial `EnvironmentConfig.opusModel/sonnetModel/haikuModel`
  fields + their JSDoc** — S1's hard boundary (never constructed/read). NOTE only.
- **Pre-existing model-VALUE staleness** (`GLM-4.7`, `claude-3-5-sonnet-20241022`,
  `glm-4.7`) — NOT tier-name references; out of scope.
- **persona→role remapping + xhigh reasoning budget** — P2.M2.T1.

---

## What

### User-visible behavior
None. This is an internal correctness/clarity cleanup: one test stops silently building the
string `'zai/undefined'`, and stale tier words in JSDoc/comments are refreshed. No CLI, env,
or runtime behavior changes.

### Technical requirements (exact contract)

**`tests/unit/agents/cache-key-isolation.test.ts`** — EDIT line 34 (the latent bug):
```ts
// BEFORE (post-S1 — MODEL_NAMES.sonnet is now undefined → 'zai/undefined'):
const ZAI_GLM_47 = `${DEFAULT_MODEL_PROVIDER}/${MODEL_NAMES.sonnet}`; // 'zai/GLM-4.7'

// AFTER:
const ZAI_BALANCED = `${DEFAULT_MODEL_PROVIDER}/${MODEL_NAMES.balanced}`; // 'zai/glm-5.2' (balanced tier)
```
Then update the two references to `ZAI_GLM_47` (the "pipeline scenario" test ~line 88 and the
store-level test ~line 130) to `ZAI_BALANCED`. Leave the unrelated `'GLM-4.7'` literal strings
in `baseInputs.model` and the `models` array — those are pre-existing model-VALUE staleness,
not tier-name references.

**`src/agents/agent-factory.ts`** — EDIT lines 150-151 (function JSDoc):
```ts
// BEFORE:
 * the specified persona. Personas default to the `sonnet` (balanced) model
 * tier (glm-5.2); the Coder overrides to the `haiku` (fast) tier per its

// AFTER:
 * the specified persona. Personas default to the balanced model tier
 * (glm-5.2); the Coder overrides to the fast tier per its IMPL_AGENT role
```

**`tests/unit/agents/agent-factory.test.ts`** — EDIT line 88 (comment only):
```ts
// BEFORE:
// VERIFY: All personas use sonnet tier → zai/glm-5.2 (provider-qualified, lowercase id

// AFTER:
// VERIFY: All personas use balanced tier → zai/glm-5.2 (provider-qualified, lowercase id
```
(Leave the `it('should use qualified glm-4.7 model for all personas', …)` title at :87 — that
is pre-existing model-value staleness, out of scope.)

**`src/config/environment.ts`** — VERIFY ONLY (lines 175-210). Confirm the `getModel` JSDoc
contains: (a) the canonical→legacy(+deprecation)→default resolution steps, and (b) a tier
mapping listing `high`/`balanced`/`fast`. It does (post-S2). No edit. (If a future merge
drops the tier block, re-add the "Model tier mappings (defaults)" lines — but do not rewrite
S2's loader JSDoc.)

**`tests/validation/zai-api-test.ts`** — EDIT (optional, NOT gated) for full consistency:
```ts
// BEFORE (192-194):
const opusModel = getModel('high');
const sonnetModel = getModel('balanced');
const haikuModel = getModel('fast');
// ... (232-234) details object:
opus: opusModel, sonnet: sonnetModel, haiku: haikuModel,

// AFTER:
const highModel = getModel('high');
const balancedModel = getModel('balanced');
const fastModel = getModel('fast');
// ... details object:
high: highModel, balanced: balancedModel, fast: fastModel,
```

### Success Criteria
- [ ] `rg -n "MODEL_NAMES\.(opus|sonnet|haiku)" src/ tests/` → zero matches.
- [ ] `cache-key-isolation.test.ts` uses `MODEL_NAMES.balanced` (no `undefined` model string).
- [ ] `agent-factory.ts` `createBaseConfig` JSDoc + `agent-factory.test.ts:88` use balanced/fast wording.
- [ ] `getModel` JSDoc documents canonical-first resolution AND high/balanced/fast tiers (verified).
- [ ] `npm run validate` GREEN; `npm run build` compiles; agents + config suites green; 100% src coverage unchanged.
- [ ] No re-edits to S1 call sites or S2 loader/JSDoc (no conflict).

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_
**Yes.** The headline fact — that S3's literal call-site scope is already done by S1
(committed) and the `getModel` JSDoc/loader by S2 (working tree) — is stated up front with
the verifying git/grep evidence. The genuine remainder is enumerated with exact file:line
anchors and before/after blocks (research §1–5). The latent bug is proven from the toolchain
config (src-only typecheck + esbuild vitest + distinctness-only assertions). The hard
boundaries (docs → P6; vestigial `EnvironmentConfig` fields → S1; model-value staleness)
are fenced. Every edit is small and precisely anchored.

### Documentation & References
```yaml
# MUST READ — the PRD spec
- docfile: PRD.md
  section: "9.2.8 Provider-Neutral Configuration Naming" (h4.7) → "Model-tier rename"
  why: Mandates opus→high, sonnet→balanced, haiku→fast; "This touches MODEL_NAMES, MODEL_ENV_VARS,
        getModel(tier), the ModelTier type, and the agent factory's per-persona tier selection";
        role→tier mapping unchanged. S3 sweeps the tier-name REFERENCES this rename leaves behind.
  critical: The rename is the source of the §1 latent bug (MODEL_NAMES.<old> reads). S3 fixes that
        class of remainder; it does not change the rename itself (S1) or env names (S2).
- docfile: PRD.md
  section: "9.2.3 Model Selection" (h4.2)
  why: Confirms the role→tier mapping (planning/research→balanced, implementation→fast) the refreshed
        JSDoc/comments must continue to describe accurately.

# MUST READ — the upstream PRPs that already did the literal scope (treat as CONTRACTS)
- docfile: plan/008_15504f60a0ef/P2M1T1S1/PRP.md
  section: "Scope boundary vs P2.M1.T1.S3", "Anti-Patterns to Avoid"
  why: S1 explicitly states its call-site edits "FULLY COVER P2.M1.T1.S3's scope" and recommends the
        orchestrator reconcile S3. S3 honors this by NOT re-editing call sites and instead owning the
        deferred cleanup (latent bug + stale words). Confirms ModelTier/MODEL_NAMES rename is S1's.
- docfile: plan/008_15504f60a0ef/P2M1T1S2/PRP.md
  section: "Goal", "Out of scope"
  why: S2 owns getModel() body + canonical-first loader + deprecation + the getModel JSDoc (which
        already documents canonical-first AND tier names). S2 lists getModel/getResolvedProvider call
        sites as out of scope ("already high/balanced/fast post-S1; S2 does NOT touch them"). S3
        inherits that and only VERIFIES the JSDoc.

# MUST READ — this subtask's research (proven facts)
- docfile: plan/008_15504f60a0ef/P2M1T1S3/research/s3-scope-and-remainders.md
  section: §0 headline, §1 latent bug, §2-3 stale words, §4 JSDoc verify, §6 out-of-scope, §7 validation
  why: Proven: zero getModel('(opus|sonnet|haiku)') remain (S1 done); S2 applied in working tree;
        MODEL_NAMES.sonnet→undefined is latent (src-only typecheck + esbuild + distinctness-only
        assertions); vitest include globs make zai-api-test.ts/env-test.ts NOT gated.

# THE FILES TO EDIT — exact current (post-S1, with-S2-working-tree) state
- file: tests/unit/agents/cache-key-isolation.test.ts
  why: EDIT line 34 MODEL_NAMES.sonnet → MODEL_NAMES.balanced (latent undefined bug); rename const
        ZAI_GLM_47 → ZAI_BALANCED + comment; update the 2 usages. GATED (*.test.ts).
  pattern: characterization test; only cache-key DISTINCTNESS is asserted, so the model value is free
        to become 'zai/glm-5.2' — tests still pass.
  gotcha: Do NOT touch the unrelated 'GLM-4.7' literal strings in baseInputs.model / models array /
        the it('...glm-4.7...') title — pre-existing model-VALUE staleness, out of scope.

- file: src/agents/agent-factory.ts
  why: EDIT lines 150-151 createBaseConfig FUNCTION JSDoc: drop "`sonnet` (balanced)"/"`haiku` (fast)"
        legacy tier wording → balanced/fast. (S1 updated inline comments 172-174 + 288-290, not this
        function JSDoc.)
  gotcha: Do NOT re-edit the getModel('balanced') call at :175 or getModel('fast') at :290 — S1 done.
        Do NOT re-edit the inline comment at 288-290 — S1 done.

- file: tests/unit/agents/agent-factory.test.ts
  why: EDIT line 88 comment "sonnet tier" → "balanced tier". GATED (*.test.ts) but comment-only.
  gotcha: Leave the it('...glm-4.7...') title at :87 (pre-existing model-value staleness).

- file: src/config/environment.ts
  why: VERIFY ONLY (175-210). getModel JSDoc already documents canonical-first + high/balanced/fast.
  gotcha: S2 owns this JSDoc. Do NOT rewrite it. Only re-add the tier-mapping block if a future merge
        dropped it.

# CONSISTENCY (NOT gated — zai-api-test.ts is *-test.ts, not *.test.ts)
- file: tests/validation/zai-api-test.ts
  why: OPTIONAL rename of local labels opusModel/sonnetModel/haikuModel → highModel/balancedModel/
        fastModel (192-194) + detail keys opus/sonnet/haiku → high/balanced/fast (232-234). The
        getModel CALLS are already correct (S1); only the labels lag.
  gotcha: Not run by vitest (filename uses a dash), not typechecked. Skippable without breaking
        `npm run validate`; include only for full tier-name consistency.

# UPSTREAM OWNERS (DO NOT EDIT — verify only)
- file: src/config/constants.ts
  why: S1+S2 own MODEL_NAMES (keys high/balanced/fast), MODEL_ENV_VARS (values PRP_MODEL_*),
        LEGACY_MODEL_ENV_VARS, PRP_API_BASE_URL. Unchanged by S3.
- file: src/config/environment.ts (getModel body, configureEnvironment, dedup helpers)
  why: S2 owns the canonical-first loader + deprecation. S3 verifies the JSDoc only.

# PATTERN FILES
- file: vitest.config.ts
  why: include: ['tests/**/*.{test,spec}.ts'] → cache-key-isolation.test.ts + agent-factory.test.ts
        ARE gated; zai-api-test.ts / env-test.ts (*-test.ts with a dash) are NOT. Explains why §1 is
        latent (test files are esbuild-transpiled, not typechecked; src-only tsc).
- file: tsconfig.build.json
  why: include src/**, exclude tests → test files are NOT typechecked by `npm run typecheck`.
```

### Current Codebase tree (relevant slice — POST-S1 committed + S2 working-tree)
```bash
src/config/
├── types.ts                 # UNCHANGED (ModelTier high/balanced/fast; vestigial EnvironmentConfig.*Model fields — S1 boundary)
├── constants.ts             # UNCHANGED by S3 (S1 keys + S2 canonical values; MODEL_NAMES.balanced='glm-5.2')
└── environment.ts           # VERIFY ONLY (getModel JSDoc 175-210 already documents canonical-first + tiers — S2)
src/agents/
└── agent-factory.ts         # EDIT 150-151 (createBaseConfig function JSDoc tier words)
tests/unit/agents/
├── cache-key-isolation.test.ts  # EDIT line 34 (MODEL_NAMES.sonnet→.balanced latent bug) + 2 usages
└── agent-factory.test.ts        # EDIT line 88 comment (sonnet tier→balanced tier)
tests/validation/
└── zai-api-test.ts          # OPTIONAL EDIT (192-194 var names + 232-234 detail keys) — NOT gated
```

### Desired Codebase tree with files to be edited
```bash
src/agents/agent-factory.ts             # MODIFIED (createBaseConfig function JSDoc: drop legacy tier words)
tests/unit/agents/cache-key-isolation.test.ts  # MODIFIED (MODEL_NAMES.sonnet→.balanced; const rename; comment; 2 usages)
tests/unit/agents/agent-factory.test.ts        # MODIFIED (line 88 comment: sonnet tier→balanced tier)
src/config/environment.ts               # VERIFIED (no edit unless JSDoc gap — none expected)
tests/validation/zai-api-test.ts        # OPTIONALLY MODIFIED (local var/key labels → high/balanced/fast)
```

### Known Gotchas of our codebase & Library Quirks
```ts
// CRITICAL — MODEL_NAMES.sonnet is UNDEFINED post-S1 (keys are high/balanced/fast). cache-key-isolation.test.ts:34
//   reads it, silently producing 'zai/undefined'. NOT caught by: tsc (src-only; tests excluded), vitest (esbuild,
//   no test typecheck), or the assertions (distinctness-only). Fix to MODEL_NAMES.balanced. This is S3's core fix.

// CRITICAL — do NOT re-edit S1's getModel('balanced'/'fast') call sites or S2's getModel body/loader/JSDoc.
//   S1 (committed) + S2 (working tree) already did them; re-editing conflicts and risks regressions. S3 sweeps
//   ONLY the deferred tier-name references (the latent bug + stale words).

// GOTCHA — vitest include is 'tests/**/*.{test,spec}.ts'. cache-key-isolation.test.ts and agent-factory.test.ts
//   ARE gated; tests/validation/zai-api-test.ts and tests/manual/env-test.ts (filenames '*-test.ts' with a DASH)
//   are NOT. So the §1 fix is gated (real); the §5 cosmetic rename is not (optional).

// GOTCHA — leave the unrelated 'GLM-4.7'/'glm-4.7' literal strings (cache-key-isolation baseInputs.model,
//   models array, agent-factory.test.ts it() title) alone — pre-existing model-VALUE staleness, NOT tier names.

// GOTCHA — leave docs/ (CUSTOM_AGENTS.md, CONFIGURATION.md, README.md) alone — Mode A is JSDoc-primary; the docs
//   prose sweep is P6 (README/ARCHITECTURE/CONFIGURATION). CUSTOM_AGENTS.md is unassigned → FLAG for orchestrator.

// GOTCHA — leave src/config/types.ts EnvironmentConfig opusModel/sonnetModel/haikuModel fields + their JSDoc
//   alone — S1's hard boundary (vestigial; never constructed/read).

// GOTCHA — prettier is ERROR-enforced (format:check). Run `npm run fix` before `npm run validate`.
//   100% coverage is globally enforced on src/**/*.ts; S3 edits NO src logic body (only JSDoc + a test comment),
//   so coverage is unaffected. The §1 fix is test-only.
```

---

## Implementation Blueprint

### Data models and structure
No type/constant changes. S3 is a pure edit of one test (bug fix) + two comments/JSDoc +
optional cosmetic labels. No new symbols.

### Implementation Tasks (ordered by dependencies)
```yaml
Task 1: EDIT tests/unit/agents/cache-key-isolation.test.ts   (the latent-bug fix — highest value)
  - CHANGE line 34: `${DEFAULT_MODEL_PROVIDER}/${MODEL_NAMES.sonnet}` → `${DEFAULT_MODEL_PROVIDER}/${MODEL_NAMES.balanced}`.
  - RENAME the const ZAI_GLM_47 → ZAI_BALANCED and its trailing comment `// 'zai/GLM-4.7'` → `// 'zai/glm-5.2' (balanced tier)`.
  - UPDATE the 2 usages of ZAI_GLM_47 (the "pipeline scenario" test ~line 88 `model: ZAI_GLM_47` and the store-level
        "set under zai/GLM-4.7 key" test ~line 130 `model: ZAI_GLM_47`) to ZAI_BALANCED.
  - LEAVE the unrelated 'GLM-4.7' literals in baseInputs.model + the models array (pre-existing model-value staleness).
  - EXPECTED: `npx vitest run tests/unit/agents/cache-key-isolation.test.ts` GREEN; the const now holds 'zai/glm-5.2'.

Task 2: EDIT src/agents/agent-factory.ts   (createBaseConfig function JSDoc tier words)
  - EDIT lines 150-151: "Personas default to the `sonnet` (balanced) model tier (glm-5.2); the Coder overrides to
        the `haiku` (fast) tier per its IMPL_AGENT role" → "Personas default to the balanced model tier (glm-5.2);
        the Coder overrides to the fast tier per its IMPL_AGENT role".
  - DO NOT touch the getModel('balanced') call (:175), getModel('fast') (:290), or the inline comments (172-174,
        288-290) — S1 done. EXPECTED: `npm run typecheck` + lint green (JSDoc-only change).

Task 3: EDIT tests/unit/agents/agent-factory.test.ts   (line 88 comment)
  - EDIT line 88: "// VERIFY: All personas use sonnet tier → zai/glm-5.2 …" → "// VERIFY: All personas use balanced
        tier → zai/glm-5.2 …".
  - LEAVE the it('should use qualified glm-4.7 model for all personas', …) title (:87) — pre-existing model-value
        staleness. EXPECTED: green (comment-only).

Task 4: VERIFY src/config/environment.ts getModel JSDoc   (DOCS contract item 5 — confirm, no edit expected)
  - READ lines 175-210. CONFIRM the JSDoc contains: (a) canonical-first (`PRP_MODEL_HIGH/BALANCED/FAST`) → legacy
        (`ANTHROPIC_DEFAULT_*` + one-time deprecation) → MODEL_NAMES default; (b) a "Model tier mappings" block
        listing high/balanced/fast; (c) @example with getModel('high'|'balanced'|'fast').
  - IF intact (expected post-S2): NO edit. IF a tier-mapping line was dropped in a future merge: re-add the
        "Model tier mappings (defaults)" block ONLY — do not rewrite S2's loader prose.
  - EXPECTED: documentation present; `npm run validate` unaffected.

Task 5: EDIT tests/validation/zai-api-test.ts   (OPTIONAL — NOT gated; full tier-name consistency)
  - RENAME local vars (192-194): opusModel→highModel, sonnetModel→balancedModel, haikuModel→fastModel.
  - RENAME detail-object keys (232-234): opus→high, sonnet→balanced, haiku→fast.
  - NOTE: not run by vitest (*-test.ts); cosmetic only. EXPECTED: no effect on `npm run validate`.

Task 6: FORMAT + VERIFY
  - RUN: npm run fix → npm run validate (lint + format:check + typecheck + test:run). MUST be green.
  - RUN: npm run build (tsc -p tsconfig.build.json). MUST compile.
  - RUN: npx vitest run tests/unit/agents/ tests/unit/config/ --coverage (agents + config suites green; 100% src coverage).
  - RUN: rg -n "MODEL_NAMES\.(opus|sonnet|haiku)" src/ tests/   (EXPECTED: zero matches — the §1 bug is gone).
  - RUN: rg -nw "sonnet|haiku" src/agents/agent-factory.ts tests/unit/agents/agent-factory.test.ts
        (EXPECTED: zero matches in those two files — stale words swept).
  - EXPECTED: full green; no MODEL_NAMES.<old> reads; no stale tier words in the edited files.
```

### Implementation Patterns & Key Details
```ts
// ---- cache-key-isolation.test.ts: the latent-bug fix ----
// BEFORE (post-S1): MODEL_NAMES.sonnet === undefined  →  'zai/undefined'  (passes only by luck)
const ZAI_GLM_47 = `${DEFAULT_MODEL_PROVIDER}/${MODEL_NAMES.sonnet}`; // 'zai/GLM-4.7'
// AFTER:
const ZAI_BALANCED = `${DEFAULT_MODEL_PROVIDER}/${MODEL_NAMES.balanced}`; // 'zai/glm-5.2' (balanced tier)
// (update the 2 usages: pipeline-scenario test + store-level test)

// ---- agent-factory.ts createBaseConfig function JSDoc (drop legacy tier words) ----
// BEFORE: "Personas default to the `sonnet` (balanced) model tier (glm-5.2); the Coder overrides to the `haiku` (fast) tier per its IMPL_AGENT role"
// AFTER:  "Personas default to the balanced model tier (glm-5.2); the Coder overrides to the fast tier per its IMPL_AGENT role"

// ---- agent-factory.test.ts:88 comment ----
// BEFORE: "// VERIFY: All personas use sonnet tier → zai/glm-5.2 …"
// AFTER:  "// VERIFY: All personas use balanced tier → zai/glm-5.2 …"

// ---- getModel JSDoc (environment.ts:175-210) — VERIFY, already present post-S2 ----
//   @remarks: canonical-first (PRP_MODEL_*) → legacy (ANTHROPIC_DEFAULT_* + one-time deprecation) → MODEL_NAMES default
//   "Model tier mappings (defaults)": high glm-5.2 / balanced glm-5.2 / fast glm-5-turbo
//   @example: getModel('high'|'balanced'|'fast')

// ---- zai-api-test.ts (OPTIONAL consistency; NOT gated) ----
// const highModel = getModel('high'); const balancedModel = getModel('balanced'); const fastModel = getModel('fast');
// details: { high: highModel, balanced: balancedModel, fast: fastModel }
```

### Integration Points
```yaml
TESTS (gated):
  - tests/unit/agents/cache-key-isolation.test.ts: MODEL_NAMES.sonnet → .balanced; const rename; 2 usages. (bug fix)
  - tests/unit/agents/agent-factory.test.ts:88: comment sonnet→balanced.
SRC JSDOC:
  - src/agents/agent-factory.ts:150-151: createBaseConfig function JSDoc drops `sonnet`/`haiku` tier words.
VERIFY (no edit expected):
  - src/config/environment.ts:175-210: getModel JSDoc documents canonical-first + high/balanced/fast (S2).
CONSISTENCY (NOT gated, optional):
  - tests/validation/zai-api-test.ts: local var + detail-key labels → high/balanced/fast.

NO CHANGES TO (hard boundary):
  - Functional getModel() call sites (S1, committed); getModel body/loader/deprecation + its JSDoc (S2, working tree).
  - type ModelTier; MODEL_NAMES/MODEL_ENV_VARS keys & values; LEGACY_MODEL_ENV_VARS; PRP_API_BASE_URL.
  - docs/*.md + README.md + PROMPTS.md (Mode A; docs sweep = P6).
  - src/config/types.ts vestigial EnvironmentConfig opusModel/sonnetModel/haikuModel fields (S1 boundary).
  - Pre-existing model-VALUE staleness (GLM-4.7, claude-3-5-sonnet-20241022).
  - persona→role remapping + xhigh reasoning budget (P2.M2.T1).
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
npm run fix            # lint:fix + prettier --write (run first)
npm run typecheck      # tsc --noEmit -p tsconfig.build.json (src-only) — green (S3 edits no src types)
# Targeted:
npx eslint src/agents/agent-factory.ts
npx prettier --check src/agents/agent-factory.ts tests/unit/agents/cache-key-isolation.test.ts \
           tests/unit/agents/agent-factory.test.ts
# Expected: Zero errors. Confirm the latent bug is gone + no stale tier words in edited files:
rg -n "MODEL_NAMES\.(opus|sonnet|haiku)" src/ tests/     # MUST be empty (the §1 fix)
rg -nw "sonnet|haiku" src/agents/agent-factory.ts tests/unit/agents/agent-factory.test.ts   # MUST be empty
```

### Level 2: Unit Tests (Component Validation)
```bash
# The latent-bug fix (the gated red-tree risk — was passing by luck on 'zai/undefined'):
npx vitest run tests/unit/agents/cache-key-isolation.test.ts
#   Expected: green. The const now holds 'zai/glm-5.2'; cache-key distinctness assertions still hold.
#   If RED, MODEL_NAMES.balanced was mis-typed or a usage of ZAI_GLM_47 was missed (rename it too).

# The comment edit (no runtime effect — sanity):
npx vitest run tests/unit/agents/agent-factory.test.ts
#   Expected: green.

# Full agents + config suites (proves no regression from S1/S2):
npx vitest run tests/unit/agents/ tests/unit/config/ --coverage
#   Expected: green; 100% on src/**/*.ts unchanged (S3 edits no src logic body).
```

### Level 3: Integration / Regression (System Validation)
```bash
# Full validate gate (the green-tree proof):
npm run validate      # = lint && format:check && typecheck && test:run  → MUST exit 0
npm run build         # tsc -p tsconfig.build.json → dist/ emits cleanly
npm run test:run      # whole suite — no NEW regressions
# Expected: all green. If a non-agents/config test references MODEL_NAMES.<old>, that's another S1
#   remainder — `rg -n "MODEL_NAMES\.(opus|sonnet|haiku)" tests/` finds it; fix it (same pattern).
```

### Level 4: Creative & Domain-Specific Validation
```bash
# No MCP/DB/HTTP. Domain checks (record in commit message):
#   1. The latent bug is gone — prove the const no longer evaluates to 'zai/undefined':
node --input-type=module -e "
import { MODEL_NAMES, DEFAULT_MODEL_PROVIDER } from './dist/config/constants.js';
const v = `${DEFAULT_MODEL_PROVIDER}/${MODEL_NAMES.balanced}`;
console.log('balanced-tier model =', v);   // 'zai/glm-5.2'  (was 'zai/undefined' via .sonnet)
if (v.includes('undefined')) { console.error('STILL BROKEN'); process.exit(1); }
"   # (run `npm run build` first; Expected: 'zai/glm-5.2', exit 0.)
#   2. No stale tier words survive in the edited src/test files:
rg -nw "sonnet|haiku|opus" src/agents/agent-factory.ts tests/unit/agents/agent-factory.test.ts tests/unit/agents/cache-key-isolation.test.ts
#   Expected: empty (the MODEL_NAMES.<old> read + the comment/JSDoc tier words are swept).
#   3. getModel JSDoc self-documents canonical-first + tiers (manual read of environment.ts:175-210).
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` exits 0 (src-only; no src type changes by S3).
- [ ] `npm run validate` exits 0 (lint + format:check + typecheck + test:run).
- [ ] `npm run build` compiles (dist/ emits).
- [ ] `npx vitest run tests/unit/agents/ tests/unit/config/ --coverage` exits 0; 100% src coverage unchanged.
- [ ] `rg -n "MODEL_NAMES\.(opus|sonnet|haiku)" src/ tests/` is empty (the §1 latent bug is gone).

### Feature Validation
- [ ] `cache-key-isolation.test.ts` uses `MODEL_NAMES.balanced` (const holds `'zai/glm-5.2'`, never `'zai/undefined'`).
- [ ] `agent-factory.ts` `createBaseConfig` function JSDoc (150-151) uses balanced/fast wording (no `sonnet`/`haiku`).
- [ ] `agent-factory.test.ts:88` comment uses "balanced tier".
- [ ] `getModel` JSDoc (environment.ts:175-210) documents canonical-first resolution AND high/balanced/fast tiers (verified).
- [ ] (Optional) `zai-api-test.ts` local labels use high/balanced/fast.

### Code Quality Validation
- [ ] No re-edits to S1's `getModel('balanced'/'fast')` call sites or S2's getModel body/loader/JSDoc (no conflict).
- [ ] No edits to `ModelTier`, `MODEL_NAMES`/`MODEL_ENV_VARS` values, docs, or vestigial `EnvironmentConfig` fields.
- [ ] Pre-existing model-VALUE staleness (`GLM-4.7`) left untouched (correctly out of scope).
- [ ] All edits are JSDoc/comment/test-only; no src logic-body change (coverage unaffected).

### Documentation & Deployment
- [ ] The `getModel` JSDoc (S2) is the documentation artifact; S3 confirms it (DOCS contract item 5).
- [ ] Commit message notes: S1 (committed) already did the literal call-site scope; S2 (working tree) did the loader +
      JSDoc; S3 owns the deferred remainder — notably the latent `MODEL_NAMES.sonnet`→`undefined` bug fix, the stale
      tier-word sweep in `agent-factory.ts` JSDoc + the test comment, and the optional validation-script consistency.

---

## Anti-Patterns to Avoid

- ❌ Don't re-edit S1's `getModel('balanced'/'fast')` call sites or S2's `getModel()` body / canonical loader / deprecation machinery / `getModel` JSDoc — S1 (committed) and S2 (working tree) already did them; re-editing causes conflicts and regressions. S3 sweeps ONLY the deferred tier-name references.
- ❌ Don't "fix" `cache-key-isolation.test.ts` by changing the unrelated `'GLM-4.7'` literals in `baseInputs.model` / the `models` array — those are pre-existing model-VALUE staleness, not tier-name references; out of scope.
- ❌ Don't edit `docs/` (CUSTOM_AGENTS.md, CONFIGURATION.md, README.md) for tier words — Mode A is JSDoc-primary here; the docs prose sweep is P6. Flag the unassigned CUSTOM_AGENTS.md for the orchestrator instead.
- ❌ Don't rename `src/config/types.ts` vestigial `EnvironmentConfig.opusModel/sonnetModel/haikuModel` fields or their JSDoc — S1's hard boundary (never constructed/read).
- ❌ Don't assume `npm run validate` will catch a stale `MODEL_NAMES.<old>` read in a test file — `tsc` is src-only and vitest uses esbuild (no test-file typecheck). The §1 bug is latent precisely because of this; verify with the explicit `rg` + the Level-4 node check.
- ❌ Don't widen S3 into the persona→role remapping or xhigh reasoning budget — that is P2.M2.T1, a separate work item.
- ❌ Don't skip the optional `zai-api-test.ts` consistency edit and then claim "all tier references use new names" — either do it or explicitly scope the OUTPUT to functional `src` getModel calls + gated tests.

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: The literal contract scope is already complete (S1 committed the call-site rename;
S2 applied the canonical loader + the `getModel` JSDoc that satisfies the DOCS item). S3's
genuine remainder is small, precisely anchored, and high-value: one latent-bug fix
(`MODEL_NAMES.sonnet` → `.balanced`, proven undefined post-S1 and proven to escape the gates
via src-only `tsc` + esbuild vitest + distinctness-only assertions), one src JSDoc tier-word
sweep (`agent-factory.ts:150-151`), one test-comment tier-word sweep (`agent-factory.test.ts:88`),
a verify-only step on the already-present `getModel` JSDoc, and one optional cosmetic
consistency edit in a non-gated validation script. Every edit is JSDoc/comment/test-only — no
src logic-body change, so the 100%-coverage gate and runtime behavior are unaffected. Residual
risks are mechanical and gate-caught: (a) a missed `ZAI_GLM_47` usage after the const rename →
`vitest run cache-key-isolation.test.ts` names it (rename the usage); (b) a prettier nit on a
JSDoc reflow (auto-fixed via `npm run fix`); (c) a stray `MODEL_NAMES.<old>` elsewhere → the
explicit `rg -n "MODEL_NAMES\.(opus|sonnet|haiku)" src/ tests/` audit catches it. No
runtime/network/LLM unknowns; no pre-existing red suite introduced.