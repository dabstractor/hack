# P2.M1.T1.S3 Research — Scope Reconciliation & Genuine Remainders

## 0. Headline

S3's contract **literally** specifies the `getModel()` call-site rename (`sonnet`→`balanced`,
`haiku`→`fast`) + a `getModel` JSDoc. That work is **already complete**:

- **S1 (committed `260eb40` "feat(config): rename model tiers to neutral names")** renamed
  EVERY `getModel()` call site + the `describe('getModel')` test args + created
  `constants.test.ts`. Verified by grep: zero `getModel('(opus|sonnet|haiku)')` remain in
  `src/` or `tests/`. S1's PRP **explicitly disclosed** that "S3's separately-allocated
  call-site work is fully covered by S1" and recommended the orchestrator reconcile S3.
- **S2 (applied in the uncommitted working tree; `constants.ts` + `environment.ts` dirty)**
  added the canonical-first loader + `LEGACY_MODEL_ENV_VARS` + `PRP_API_BASE_URL` + the
  deprecation machinery, AND a comprehensive `getModel` JSDoc (environment.ts:175–210) that
  documents **BOTH** canonical-first-with-fallback resolution **AND** the tier names
  (the "Model tier mappings" block lists high/balanced/fast; `@example` shows
  `getModel('high'/'balanced'/'fast')`). ⇒ Contract DOCS item (5) is **already satisfied**.

**Therefore S3 is reframed as the bounded tier-name CLEANUP that S1/S2 explicitly deferred
or that fell through the cracks** — including one real latent bug. This is honest,
non-overlapping, and produces the contract's OUTPUT ("All getModel calls use new tier names"
→ true for functional `src` calls) consumed by P2.M2.T1.S1.

## 1. The latent bug S1 introduced (gated `*.test.ts` — MUST fix)

`tests/unit/agents/cache-key-isolation.test.ts:34`:
```ts
const ZAI_GLM_47 = `${DEFAULT_MODEL_PROVIDER}/${MODEL_NAMES.sonnet}`; // 'zai/GLM-4.7'
```
After S1 renamed `MODEL_NAMES` keys to `high/balanced/fast`, `MODEL_NAMES.sonnet` is
**`undefined`** ⇒ `ZAI_GLM_47 === 'zai/undefined'`. It is NOT caught because:
- `tsc` (typecheck, src-only via `tsconfig.build.json`) excludes `tests/`.
- vitest uses esbuild (no typecheck on test files).
- the test only asserts cache-key **distinctness** + hex format, never the literal value,
  so `'zai/undefined'` still "passes".

This is precisely contract item (d): "Update any constants or tests that reference tier
names by string." Fix: `MODEL_NAMES.sonnet` → `MODEL_NAMES.balanced`. Rename the const
`ZAI_GLM_47` → `ZAI_BALANCED` and its comment `// 'zai/GLM-4.7'` → `// 'zai/glm-5.2'`
(balanced tier)` so the line is not self-contradictory (the value becomes `zai/glm-5.2`).

OUT OF SCOPE (pre-existing model-VALUE staleness, NOT tier-name references): the unrelated
`'GLM-4.7'` literal strings at `baseInputs.model` (line ~33), the `models` array (line ~119),
and the `it('...glm-4.7...')` title in `agent-factory.test.ts:87`. These are old default-
model-name drift and are NOT what S3 touches.

## 2. Stale tier WORDS in src JSDoc (gated by lint/format/typecheck)

`src/agents/agent-factory.ts:150-151` — `createBaseConfig` FUNCTION-level JSDoc (S1 updated
the INLINE comments at 172-174 and 288-290 but NOT this function JSDoc):
```
 * the specified persona. Personas default to the `sonnet` (balanced) model
 * tier (glm-5.2); the Coder overrides to the `haiku` (fast) tier per its
```
Fix: drop the legacy tier words → "Personas default to the **balanced** model tier
(glm-5.2); the Coder overrides to the **fast** tier per its IMPL_AGENT role".

## 3. Stale tier WORD in a gated test comment

`tests/unit/agents/agent-factory.test.ts:88`:
```
// VERIFY: All personas use sonnet tier → zai/glm-5.2 ...
```
Fix: "sonnet tier" → "balanced tier". (The `it('should use qualified glm-4.7 model...')`
title at :87 is pre-existing model-value staleness — out of scope.)

## 4. getModel JSDoc — VERIFY only (already satisfied by S1+S2)

`src/config/environment.ts:175-210` already documents:
- canonical-first (`PRP_MODEL_HIGH/BALANCED/FAST`) → legacy (`ANTHROPIC_DEFAULT_*` + one-time
  deprecation warning) → `MODEL_NAMES` default;
- the three tiers in a "Model tier mappings (defaults)" block (high/balanced/fast);
- `@example` with `getModel('high'|'balanced'|'fast')`.
⇒ Contract DOCS item (5) met. S3 only CONFIRMS this; if a tier-name line were missing, fill it.

## 5. Cosmetic consistency (NOT gated — `tests/validation/zai-api-test.ts`)

`zai-api-test.ts` filename is `*-test.ts` (dash), which does NOT match vitest's
`include: ['tests/**/*.{test,spec}.ts']` (needs `.test.ts`). Not run by vitest; not typechecked.
Local labels still use legacy tier words:
- `:192-194`  `const opusModel = getModel('high'); const sonnetModel = getModel('balanced'); const haikuModel = getModel('fast');`
- `:232-234`  detail object keys `opus / sonnet / haiku`.
The getModel CALLS are already correct (S1); only the local var/key NAMES lag. Optional rename
to `highModel/balancedModel/fastModel` + keys `high/balanced/fast` for "all tier references use
new names" completeness. Skippable without breaking `npm run validate`.

## 6. Explicit OUT OF SCOPE (hard boundaries — do NOT touch)

- `docs/CUSTOM_AGENTS.md` (lines 129 `getModel('sonnet')` example, 505-507 `MODEL_NAMES`
  opus/sonnet/haiku example, 513 "sonnet tier" prose), `docs/CONFIGURATION.md:512`,
  `README.md:411`, `docs/research/prp-research-summary.md:473` — broader doc prose sweep.
  S1/S2/S3 are Mode A (JSDoc-primary); the docs sweep is P6 (README/ARCHITECTURE/
  CONFIGURATION). CUSTOM_AGENTS.md is not assigned to a P6 task ⇒ FLAG for orchestrator.
- `src/config/types.ts:44-46,55-60` — vestigial `EnvironmentConfig` fields
  `opusModel/sonnetModel/haikuModel` (declared, NEVER constructed/read in src). S1's hard
  boundary. NOTE only.
- Pre-existing model-VALUE staleness (`GLM-4.7`, `claude-3-5-sonnet-20241022`) — not tier-name
  references.

## 7. Validation facts

- `package.json` `validate` = lint && format:check && typecheck && test:run.
- typecheck = `tsc -p tsconfig.build.json`, `include: src/**`, `exclude: [..., tests]`
  ⇒ test files are NOT typechecked (why the §1 bug is latent).
- vitest `include: ['tests/**/*.{test,spec}.ts']` ⇒ `cache-key-isolation.test.ts` and
  `agent-factory.test.ts` ARE gated; `tests/validation/zai-api-test.ts` and
  `tests/manual/env-test.ts` (`*-test.ts`, dash) are NOT.
- coverage thresholds global 100% on `src/**/*.ts` — S3 edits no src logic bodies (only
  JSDoc + a comment), so coverage is unaffected; the §1 fix is test-only.
- prettier is ERROR-enforced (format:check) ⇒ run `npm run fix` before `npm run validate`.

## 8. Confidence

9/10. The core fix set is tiny and precisely anchored (3 real edits + 1 verify + 1 optional).
The one non-obvious fact (the latent `MODEL_NAMES.sonnet`→undefined bug) is proven from the
toolchain config (src-only typecheck + esbuild vitest + distinctness-only assertions). No
runtime/network/LLM unknowns.