# PRP — P1.M2.T2.S2: Cache-key isolation test (harness × provider/model)

---

## Goal

**Feature Goal**: Prove, with a green deterministic test suite, that Groundswell's
cache keys are partitioned by **both** the **harness** (`pi` vs `claude-code`) **and**
the **provider/model** (`zai/GLM-4.7` vs `anthropic/claude-…`) — encoding PRD
§9.4.3 ("Cache isolation. Cache keys incorporate **both** the harness and the
provider/model") and PRD §9.4.2/§9.2.3 (provider-qualified `provider/model`
strings, harness never in the model string) as **executable assertions** against
the linked Groundswell build. **No LLM, no network, no Anthropic key, no real
harness instantiated** — Groundswell exposes a public key-builder
(`generateCacheKey`) and an in-memory cache (`LLMCache`); the test exercises both
directly (the contract's explicitly-permitted strategy).

**Deliverable**:

1. **`tests/unit/agents/cache-key-isolation.test.ts`** — **CREATE**: a
   characterization test with two assertion groups and **zero production-code
   change**. **Group 1 (key-builder direct)** calls Groundswell's
   `generateCacheKey(inputs)` and asserts that inputs differing on exactly one
   axis (harness, provider, or model) produce **distinct** 64-char SHA-256 keys,
   while identical inputs produce the same key — including the pipeline's real
   config (`pi` + `zai/GLM-4.7`) vs the contrasting `claude-code` +
   `anthropic/claude-sonnet-4`. **Group 2 (cache get/set surface)** proves the
   key differences manifest as real partitioning in a fresh `new LLMCache()`
   (set under one axis → get under the other → MISS; identical axes → HIT). No
   new `src/**/*.ts` is created → the 100% coverage gate is unaffected.

**Success Definition** (the contract from the work item):

- **Harness-axis isolation**: two entries differing **only** by harness
  (`pi` vs `claude-code`) with the same provider/model produce **distinct** keys.
- **Provider/model-axis isolation**: two entries differing **only** by
  provider/model (`zai/GLM-4.7` vs `anthropic/claude-sonnet-4`) produce
  **distinct** keys (provider-only and model-only variations also distinct).
- **Tuple uniqueness**: keys are distinct across the full
  `(harness, provider, model)` cross-product; all keys are 64-char hex SHA-256.
- **Store-level partitioning**: `LLMCache.set` under one axis' key → `get` under
  the other axis' key returns `undefined`; identical axes round-trip the value.
- **No real LLM / network / Anthropic key / harness** — the `claude-code`+`zai`
  combination is exercised purely at the key-builder + cache-store layer (the
  harness/provider compatibility guard is intentionally never invoked).
- `npm run validate` passes; the relevant `npm run test:run` passes with **100%
  coverage** retained on all `src/**/*.ts` (no new src file → no new coverage
  obligation).

---

## Why

- **PRD §9.4.3 is the contract.** _"Cache isolation. Cache keys incorporate **both**
  the harness and the provider/model."_ This subtask turns that one-sentence
  architectural promise into executable proof at the hacky-hack integration
  boundary — for the pipeline's **actual** config (`pi` + `zai/GLM-4.7`) and its
  only contrasting axis (`claude-code` + `anthropic/*`).
- **Closes the genuine gap.** Groundswell ships its own tests
  (`src/__tests__/unit/cache-key.test.ts`, `agent-cache-key-isolation.test.ts`),
  but those live in the **read-only Groundswell repo**. hacky-hack has **no**
  cache-key isolation test. The closest hacky-hack file,
  `tests/unit/agents/cache-verification.test.ts`, `vi.mock('groundswell')`s and
  tests a **fake** `agent.prompt()`'s timing/hit-rate — it never calls the real
  `generateCacheKey`, never varies the harness or provider axis, and proves
  nothing about §9.4.3. See `research/cache-key-isolation-strategy.md §4/§12`.
- **The architectural fact being locked.** `generateCacheKey` (in the linked
  `dist/cache/cache-key.js`) **conditionally appends** `harness` and `provider`
  to the object fed to `deterministicStringify` → SHA-256 (verified at lines
  169-173). Because the append is _conditional_, a future Groundswell refactor
  that drops those lines, or an agent build-site that forgets to pass them,
  silently re-collapses `pi` and `claude-code` into one cache namespace — a
  correctness/cost bug (cross-harness cache poisoning). This test pins the
  invariant so that regression fails fast. See research §2.
- **Pairs with, and is disjoint from, the parallel P1.M2.T2.S1.** S1 covers
  **tool** discovery/execution parity (`tests/unit/tools/mcp-tool-parity.test.ts`).
  This item covers **cache-key** isolation. Disjoint layer (cache vs tools),
  disjoint directory (`tests/unit/agents/` vs `tests/unit/tools/`), no merge
  conflict. Also disjoint from P1.M2.T1.S1 (provider-endpoint guard) and
  P1.M2.T1.S2 (harness/provider compatibility **rejection** — that throws
  `HarnessProviderMismatchError` for `claude-code`+`zai` at `configureHarness()`;
  this test **never calls `configureHarness()`**, it feeds `CacheKeyInputs` to
  `generateCacheKey` directly, so no throw and no overlap — see Known Gotchas).
- **Out of scope (hard boundary):** the harness↔provider compatibility guard
  (`src/config/harness.ts`, `HarnessProviderMismatchError` — M2.T1.S2), the
  provider-endpoint guard (`src/config/endpoint-guard.ts` — M2.T1.S1), tool
  parity (M2.T2.S1), docs (M2.T3), any change to `generateCacheKey`/`LLMCache`
  (Groundswell-owned, read-only), any change to hacky-hack `src/**/*.ts`, and
  any new `src/**/*.ts`. This is a **test-only** subtask.

---

## What

### User-visible behavior

None at runtime/CLI. This is a pure characterization test. Observable change:
one new green test file under `tests/unit/agents/`. No new env vars, no new
public API, no behavior change anywhere.

### Technical requirements (exact contract)

**`tests/unit/agents/cache-key-isolation.test.ts`** (CREATE) — a single
`describe` block
`'Groundswell cache-key isolation — harness × provider/model (PRD §9.4.3)'`
with two assertion groups. All determinism comes from `generateCacheKey` (a pure
function) and a fresh `new LLMCache()`; no LLM/network/harness.

**Imports** (exact — all verified re-exported from the `groundswell` package
root, see research §1):

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateCacheKey, LLMCache, type CacheKeyInputs } from 'groundswell';
import {
  DEFAULT_HARNESS,
  DEFAULT_MODEL_PROVIDER,
  MODEL_NAMES,
} from '../../../src/config/constants.js';
```

**Hooks** (mirror `tests/unit/agents/agent-factory.test.ts` so the global
`tests/setup.ts` provider-endpoint guard stays happy — see Known Gotchas):

```ts
beforeEach(() => {
  vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'stubbed-token');
  vi.stubEnv('ANTHROPIC_API_KEY', 'stubbed-token');
  vi.stubEnv('ANTHROPIC_BASE_URL', 'https://api.z.ai/api/anthropic'); // NOT Anthropic
});
afterEach(() => vi.unstubAllEnvs());
```

**Shared fixtures** (bind the test to the pipeline's real config — research §5):

```ts
// The pipeline's actual resolved config (P1.M1.T1.S2 / P1.M1.T2.S2):
const ZAI_GLM_47 = `${DEFAULT_MODEL_PROVIDER}/${MODEL_NAMES.sonnet}`; // 'zai/GLM-4.7'
// The contrasting axis — claude-code's Anthropic-only world (PRD §9.4.3):
const ANTHROPIC_CLAUDE = 'anthropic/claude-sonnet-4';

// Canonical base inputs — EVERY field identical except the single axis under test.
const baseInputs: CacheKeyInputs = {
  user: 'Cache me if you can',
  system: 'isolation-test-system-prompt',
  model: 'GLM-4.7',
  temperature: 0,
  maxTokens: 1024,
};
```

**Group 1 — `generateCacheKey` partitions by harness × provider/model** (the
contract's "If Groundswell exposes a key-builder, call it directly" clause):

```ts
describe('generateCacheKey — direct key-builder isolation', () => {
  it('keys differ when ONLY the harness differs (pi vs claude-code), same provider/model', () => {
    const pi = generateCacheKey({
      ...baseInputs,
      provider: 'zai',
      harness: 'pi',
    });
    const cc = generateCacheKey({
      ...baseInputs,
      provider: 'zai',
      harness: 'claude-code',
    });
    expect(pi).not.toBe(cc);
    expect(pi).toMatch(/^[a-f0-9]{64}$/);
    expect(cc).toMatch(/^[a-f0-9]{64}$/);
  });

  it('keys differ when ONLY the provider differs (zai vs anthropic), same harness + model', () => {
    const zai = generateCacheKey({
      ...baseInputs,
      harness: 'pi',
      provider: 'zai',
    });
    const ant = generateCacheKey({
      ...baseInputs,
      harness: 'pi',
      provider: 'anthropic',
    });
    expect(zai).not.toBe(ant);
  });

  it('keys differ when ONLY the model differs (GLM-4.7 vs GLM-4.5-Air), same harness + provider', () => {
    const a = generateCacheKey({
      ...baseInputs,
      harness: 'pi',
      provider: 'zai',
      model: 'GLM-4.7',
    });
    const b = generateCacheKey({
      ...baseInputs,
      harness: 'pi',
      provider: 'zai',
      model: 'GLM-4.5-Air',
    });
    expect(a).not.toBe(b);
  });

  it('the pipeline scenario: pi+zai/GLM-4.7 vs claude-code+anthropic/claude-sonnet-4 → distinct', () => {
    // PRD §9.4.3 — the two configs the pipeline actually selects between.
    const pipelineKey = generateCacheKey({
      ...baseInputs,
      model: ZAI_GLM_47,
      provider: DEFAULT_MODEL_PROVIDER,
      harness: DEFAULT_HARNESS,
    });
    const claudeKey = generateCacheKey({
      ...baseInputs,
      model: ANTHROPIC_CLAUDE,
      provider: 'anthropic',
      harness: 'claude-code',
    });
    expect(pipelineKey).not.toBe(claudeKey);
  });

  it('all (harness, provider, model) tuples in the cross-product yield DISTINCT keys', () => {
    const harnesses = ['pi', 'claude-code'] as const;
    const providers = ['zai', 'anthropic'] as const;
    const models = ['GLM-4.7', 'claude-sonnet-4'];
    const keys = new Set<string>();
    for (const h of harnesses) {
      for (const p of providers) {
        for (const m of models) {
          keys.add(
            generateCacheKey({
              ...baseInputs,
              harness: h,
              provider: p,
              model: m,
            })
          );
        }
      }
    }
    expect(keys.size).toBe(harnesses.length * providers.length * models.length); // 8 distinct
    for (const k of keys) expect(k).toMatch(/^[a-f0-9]{64}$/);
  });

  it('CONTROL — identical inputs produce the identical key (deterministic)', () => {
    const a = generateCacheKey({
      ...baseInputs,
      harness: 'pi',
      provider: 'zai',
    });
    const b = generateCacheKey({
      ...baseInputs,
      harness: 'pi',
      provider: 'zai',
    });
    expect(a).toBe(b);
  });

  it('harness actually feeds the digest: omitting it yields a DIFFERENT key than providing it', () => {
    const without = generateCacheKey({ ...baseInputs, provider: 'zai' });
    const withPi = generateCacheKey({
      ...baseInputs,
      provider: 'zai',
      harness: 'pi',
    });
    expect(without).not.toBe(withPi);
  });

  it('provider actually feeds the digest: omitting it yields a DIFFERENT key than providing it', () => {
    const without = generateCacheKey({ ...baseInputs, harness: 'pi' });
    const withZai = generateCacheKey({
      ...baseInputs,
      harness: 'pi',
      provider: 'zai',
    });
    expect(without).not.toBe(withZai);
  });
});
```

**Group 2 — `LLMCache` get/set surface partitions by the same axes** (the
contract's "Use Groundswell's cache with an in-memory/in-test store" clause).
Uses a **fresh `new LLMCache()`** per case — hermetic, no singleton pollution
(research §3):

```ts
describe('LLMCache get/set surface — store-level partitioning', () => {
  it('set under pi key → get under claude-code key is a MISS (undefined)', async () => {
    const cache = new LLMCache();
    const piKey = generateCacheKey({
      ...baseInputs,
      provider: 'zai',
      harness: 'pi',
    });
    const ccKey = generateCacheKey({
      ...baseInputs,
      provider: 'zai',
      harness: 'claude-code',
    });
    await cache.set(piKey, 'pi-response');
    expect(await cache.get(ccKey)).toBeUndefined(); // different harness → different namespace
    expect(await cache.get(piKey)).toBe('pi-response'); // sanity: the set key is a HIT
  });

  it('set under zai/GLM-4.7 key → get under anthropic/claude key is a MISS', async () => {
    const cache = new LLMCache();
    const zaiKey = generateCacheKey({
      ...baseInputs,
      model: ZAI_GLM_47,
      provider: DEFAULT_MODEL_PROVIDER,
      harness: DEFAULT_HARNESS,
    });
    const antKey = generateCacheKey({
      ...baseInputs,
      model: ANTHROPIC_CLAUDE,
      provider: 'anthropic',
      harness: 'claude-code',
    });
    await cache.set(zaiKey, { role: 'assistant', content: 'glm-response' });
    expect(await cache.get(antKey)).toBeUndefined(); // different provider/model → MISS
    expect(await cache.get(zaiKey)).toEqual({
      role: 'assistant',
      content: 'glm-response',
    });
  });

  it('CONTROL — identical axes round-trip the value (HIT)', async () => {
    const cache = new LLMCache();
    const key = generateCacheKey({
      ...baseInputs,
      model: ZAI_GLM_47,
      provider: DEFAULT_MODEL_PROVIDER,
      harness: DEFAULT_HARNESS,
    });
    await cache.set(key, 'cached');
    expect(await cache.get(key)).toBe('cached');
    expect(cache.has(key)).toBe(true);
  });
});
```

### Success Criteria

- [ ] `tests/unit/agents/cache-key-isolation.test.ts` exists and is green.
- [ ] Group 1: keys differ when ONLY harness differs; ONLY provider differs;
      ONLY model differs; the pipeline scenario (`pi`+`zai/GLM-4.7` vs
      `claude-code`+`anthropic/claude-sonnet-4`) differs; all 8 tuples in the
      cross-product are distinct; identical inputs → identical key; omitting
      harness/provider yields a different key (proves each feeds the digest).
- [ ] Group 2: `set` under one axis' key → `get` under the other → `undefined`;
      identical axes round-trip the value (HIT).
- [ ] All keys asserted to match `/^[a-f0-9]{64}$/` (SHA-256 hex).
- [ ] No real LLM / network / Anthropic key / harness instantiated (key-builder + fresh `LLMCache` only).
- [ ] `npm run validate` exits 0; `npm run test:run` exits 0 with 100% coverage
      retained (no new uncovered `src/**/*.ts` file).

---

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed
to implement this successfully?_ **Yes** — the exact file path, every import
(verified re-exported from the `groundswell` package root in `dist/`), both
hooks (copied from the already-green `agent-factory.test.ts`), the shared
fixtures (derived from the real `src/config/constants.ts` values), and **all
eleven assertions across both groups** are written out verbatim. The
non-obvious facts are documented with proof: (1) `generateCacheKey` already
threads harness+provider in the linked build → the test is GREEN on first run
(research §2); (2) the contract permits the key-builder-direct strategy
("If Groundswell exposes a key-builder, call it directly") and we additionally
cover the cache get/set surface — both clauses satisfied (research §1/§3/§4);
(3) use `new LLMCache()`, NOT the `defaultCache` singleton (research §3); (4)
this test never calls `configureHarness()`, so `claude-code`+`zai` does NOT
throw here (research §7). The disjoint-from-siblings boundaries are enumerated
(research §7).

### Documentation & References

```yaml
# MUST READ — PRD sections this item implements
- docfile: PRD.md
  section: "9.4.3 Critical Rules" (h4.11)
  why: >
    "Cache isolation. Cache keys incorporate BOTH the harness and the provider/model."
    Also "The harness never appears in the model string" and "Provider/harness
    compatibility (claude-code runs anthropic/* only)". This is THE invariant under test.
  critical: The harness and the provider/model are INDEPENDENT axes that BOTH feed the cache key.
- docfile: PRD.md
  section: "9.4.2 Configuration" (h4.10) + "9.2.3 Model Selection" (h4.2)
  why: >
    Provider-qualified 'provider/model' strings (zai/GLM-4.7); harness selected by
    PRP_AGENT_HARNESS (default 'pi'); model strings NEVER harness-qualified. These are
    the exact axis values the test varies.

# MUST READ — this subtask's research (THE load-bearing facts + strategy choice)
- docfile: plan/004_439241a82c24/P1M2T2S2/research/cache-key-isolation-strategy.md
  section: "1. key-builder exposed", "2. already threads both axes (GREEN on first run)",
           "3. LLMCache get/set surface + use new LLMCache() NOT defaultCache",
           "4. why NOT mock the harness execute path", "5. real config values",
           "6. axes under test", "7. disjointness", "8. env stubbing", "11. placement"
  why: >
    The generateCacheKey/CacheKeyInputs/LLMCache export map + the "already shipped,
    characterization test" verdict + the two-strategy contract resolution (key-builder
    direct AND cache get/set, NOT the heavyweight Agent+mock-harness path) + the exact
    (harness, provider, model) axis matrix + the disjoint-from-siblings map.

# MUST READ — the Groundswell surface under test (read-only dependency)
- file: ~/projects/groundswell/src/cache/cache-key.ts
  why: generateCacheKey() + CacheKeyInputs (harness?, provider? optional fields) +
        deterministicStringify (sorted-key JSON) + SHA-256. THE function under test.
  pattern: "if (inputs.harness !== undefined) normalized.harness = inputs.harness; if (inputs.provider !== undefined) normalized.provider = inputs.provider; ... return createHash('sha256').update(deterministicStringify(normalized),'utf8').digest('hex');"
  gotcha: harness/provider are CONDITIONALLY appended — omitting them yields the
          pre-isolation key (a different digest). The "omitting vs providing" tests
          prove the axes actually feed the digest.
- file: ~/projects/groundswell/src/cache/cache.ts
  why: LLMCache class — async get/set, has(key), clear(). Wraps lru-cache. THE store
        used in Group 2.
  pattern: "const cache = new LLMCache(); await cache.set(key, value); await cache.get(key);"
  gotcha: module also exports a `defaultCache` SINGLETON — DO NOT use it (cross-test
          pollution); instantiate `new LLMCache()` per case for a hermetic store.

# MUST READ — the integration boundary (hacky-hack's real config values)
- file: src/config/constants.ts
  why: DEFAULT_HARNESS ('pi'), DEFAULT_MODEL_PROVIDER ('zai'), MODEL_NAMES.sonnet
        ('GLM-4.7') — the pipeline's actual resolved axes. Imported by the test to
        build ZAI_GLM_47 = `${DEFAULT_MODEL_PROVIDER}/${MODEL_NAMES.sonnet}` so the
        assertion tracks the real config.
  pattern: "export const DEFAULT_HARNESS = 'pi' as const; export const DEFAULT_MODEL_PROVIDER = 'zai' as const; export const MODEL_NAMES = { sonnet: 'GLM-4.7', ... } as const;"
  gotcha: constants.ts is PURE (no imports, no side-effect calls) — importing it does
          NOT trigger configureEnvironment()/configureHarness(). Safe to import without
          env stubs. (Contrast: src/config/environment.ts and src/agents/agent-factory.ts
          DO have module-load side effects — do NOT import them.)

# PATTERN FILES — copy these conventions exactly
- file: tests/unit/agents/agent-factory.test.ts
  why: CLOSEST template for the env-stubbing hooks. Uses vi.stubEnv for
        ANTHROPIC_AUTH_TOKEN/API_KEY/BASE_URL(=z.ai) in beforeEach and
        afterEach(() => vi.unstubAllEnvs()). The cache-isolation test copies this
        hook layout verbatim (the ONLY reason for the stubs is the global
        tests/setup.ts endpoint guard).
  pattern: "beforeEach(() => { vi.stubEnv('ANTHROPIC_AUTH_TOKEN','test-token'); vi.stubEnv('ANTHROPIC_BASE_URL','https://api.z.ai/api/anthropic'); vi.stubEnv('ANTHROPIC_API_KEY','test-token'); }); afterEach(() => vi.unstubAllEnvs());"

- file: ~/projects/groundswell/src/__tests__/unit/cache-key.test.ts
  why: The upstream analog — its `describe('cache key isolation — harness + provider')`
        block uses the EXACT {...base, harness, provider} spread idiom our Group 1
        mirrors. CONFIRMS the new test is the hacky-hack-side counterpart to an
        invariant Groundswell tests in its own repo.
  pattern: "const base = { user: 'Hello', model: '...' }; const pi = generateCacheKey({ ...base, harness: 'pi' }); const cc = generateCacheKey({ ...base, harness: 'claude-code' }); expect(pi).not.toBe(cc);"

# CONSUMERS (read-only — proves non-breaking + non-overlapping)
- file: tests/unit/agents/cache-verification.test.ts
  why: The existing "agent cache" test. CONFIRMS the new file is DISJOINT — that file
        vi.mock('groundswell') and tests a FAKE agent.prompt() timing/hit-rate; it
        never calls the real generateCacheKey, never varies harness/provider, and
        proves nothing about §9.4.3. The two files coexist cleanly (mocks are
        file-scoped; this test uses the REAL groundswell).
- file: tests/setup.ts
  why: Global beforeEach runs validateProviderEndpoint() (reads ANTHROPIC_BASE_URL).
        Stubbing BASE_URL to the z.ai URL in the LOCAL beforeEach keeps the global
        guard happy. Global afterEach already calls vi.unstubAllEnvs(); the local
        afterEach mirrors it.
- file: src/config/harness.ts
  why: CONSUME (read-only) — the harness/provider MISMATCH guard is SEPARATE (M2.T1.S2).
        The cache-isolation test does NOT call configureHarness(); it builds
        CacheKeyInputs objects only.

# ARCHITECTURE (authoritative current-vs-target inventory)
- docfile: plan/004_439241a82c24/architecture/external_deps.md
  section: "1. Types" (HarnessId, ModelProviderId) and the cache re-export note
  why: Confirms generateCacheKey/CacheKeyInputs/LLMCache ship in the linked groundswell build.
- docfile: plan/004_439241a82c24/architecture/delta_impact.md
  section: "A. Configuration layer" (constants) + "E. NOT changing"
  why: Confirms cache-key/cache.ts are NOT being changed by Session 004 (Groundswell-owned,
       read-only) and constants.ts is the source of the real harness/provider/model values.

# PARALLEL-SIBLING CONTRACT (assume implemented as-specified — do not duplicate)
- docfile: plan/004_439241a82c24/P1M2T2S1/PRP.md
  why: >
    The parallel previous item (tool parity). Defines the same characterization-test
    posture (GREEN on first run), the same env-stubbing hooks, the same "config-layer
    strategy over real-harness-mock" decision, and the same disjointness boundaries.
    This PRP mirrors its rigor; the two are disjoint (tools/ vs agents/, tool vs cache).
- docfile: plan/004_439241a82c24/P1M2T1S2/PRP.md
  why: >
    Defines HarnessProviderMismatchError + the configureHarness() throw for
    claude-code+zai. The cache-isolation test INTENTIONALLY bypasses configureHarness()
    (builds CacheKeyInputs only) so it is disjoint — claude-code+zai does NOT throw here.
```

### Current Codebase tree (relevant slice)

```bash
src/config/constants.ts                      # CONSUME — DEFAULT_HARNESS/DEFAULT_MODEL_PROVIDER/MODEL_NAMES (pure, side-effect-free)
src/config/harness.ts                        # CONSUME (read-only) — SEPARATE mismatch guard (M2.T1.S2); NOT invoked here
src/config/environment.ts                    # DO NOT IMPORT — module-load side effects (configureEnvironment)
src/agents/agent-factory.ts                  # DO NOT IMPORT — module-load side effects (configureHarness); S1 owns its tests
~/projects/groundswell/src/cache/cache-key.ts  # CONSUME (read-only) — generateCacheKey + CacheKeyInputs (the key-builder)
~/projects/groundswell/src/cache/cache.ts      # CONSUME (read-only) — LLMCache (the in-memory store)
tests/unit/agents/
├── agent-factory.test.ts                    # UNCHANGED — hook-template source (env stubbing)
├── cache-verification.test.ts               # UNCHANGED — DISJOINT (mocks groundswell; fake agent.prompt timing)
└── cache-key-isolation.test.ts              # ← THIS SUBTASK CREATES (real generateCacheKey + LLMCache; harness×provider/model)
tests/setup.ts                               # UNCHANGED — global endpoint guard (kept happy by local env stubs)
```

### Desired Codebase tree with files to be added

```bash
tests/unit/agents/cache-key-isolation.test.ts   # NEW — cache-key isolation across harness × provider/model (generateCacheKey + LLMCache)
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — GREEN ON FIRST RUN (characterization test). generateCacheKey in the
//   LINKED build (dist/cache/cache-key.js:169-173) ALREADY conditionally appends
//   harness + provider to the SHA-256 digest (PRD §7.14.5). So every "keys differ"
//   assertion is immediately green. The RED state is the REGRESSION this guards:
//   if Groundswell ever drops those lines (or an agent build-site forgets to pass
//   them), the test fails. Do NOT weaken assertions to manufacture a RED→GREEN arc.
//   A RED means Groundswell regressed or the wrong build is linked — investigate.
//   See research §2.

// CRITICAL — CONTRACT STRATEGY. The work item offers: "If Groundswell exposes a
//   key-builder, call it directly; otherwise assert through the cache get/set
//   surface." Groundswell DOES expose generateCacheKey (dist/index.js:42). We do
//   BOTH: Group 1 calls generateCacheKey directly (clause A); Group 2 asserts
//   through LLMCache get/set (clause B + the "in-memory/in-test store" mandate).
//   We deliberately do NOT replicate Groundswell's heavyweight
//   agent-cache-key-isolation.test.ts (Agent + HarnessRegistry + createMockHarness)
//   — that is out of hacky-hack's ownership, fragile, and redundant with
//   Groundswell's own coverage. See research §4.

// CRITICAL — TWO different ToolExecutor/... n/a here. The relevant distinction:
//   generateCacheKey returns a STRING (64-hex digest); LLMCache.get returns
//   Promise<T | undefined>. Group 1 compares strings (toBe / not.toBe); Group 2
//   awaits cache.get and compares to undefined (MISS) or the stored value (HIT).

// CRITICAL — USE `new LLMCache()`, NOT `defaultCache`. cache.ts exports a
//   `defaultCache` SINGLETON (shared module state). Importing it risks cross-test
//   pollution (Groundswell's own tests must `await defaultCache.clear()` to work
//   around this). A fresh `new LLMCache()` per test case is hermetic — no clear,
//   no leakage, no ordering sensitivity. See research §3.

// CRITICAL — harness/provider are CONDITIONALLY appended. generateCacheKey only
//   includes harness/provider in the digest IF they are present on the inputs.
//   Omitting them yields the pre-isolation key. The "omitting vs providing" tests
//   (Group 1, last two its) PROVE the axes actually feed the digest (not just that
//   two different values happen to hash differently). Keep those assertions.

// CRITICAL — DISJOINT FROM M2.T1.S2. That item throws HarnessProviderMismatchError
//   when configureHarness() sees claude-code+zai. This test builds CacheKeyInputs
//   objects with harness:'claude-code' + provider:'zai' and feeds them to
//   generateCacheKey WITHOUT calling configureHarness() — so NO throw and NO
//   overlap. Add an inline comment noting the compatibility guard is intentionally
//   bypassed. Do NOT call configureHarness()/configureHarnesses() here.

// GOTCHA — tests/setup.ts registers a global beforeEach running validateProviderEndpoint()
//   (reads process.env.ANTHROPIC_BASE_URL) and a global afterEach calling
//   vi.unstubAllEnvs(). Stub ANTHROPIC_BASE_URL to the z.ai URL in the LOCAL
//   beforeEach (z.ai is allowed; Anthropic is BLOCKED). Mirror agent-factory.test.ts's
//   hook layout EXACTLY. The env stubs exist solely to satisfy this global guard —
//   the code under test (generateCacheKey, LLMCache) does not read them.

// GOTCHA — DO NOT import src/agents/agent-factory.ts or src/config/environment.ts.
//   Both run configureEnvironment()/configureHarness() at module load (cached side
//   effects). Import ONLY src/config/constants.ts (pure consts, zero side effects).
//   This keeps the test hermetic and avoids the module-load configureHarness()
//   interaction entirely. See research §5/§8.

// GOTCHA — vi.mock is FILE-SCOPED. This file does NOT vi.mock('groundswell'); it
//   imports the REAL generateCacheKey + LLMCache (mocking would test a stub of our
//   own invention, proving nothing about Groundswell's actual behavior). Other
//   files' vi.mock('groundswell') (e.g. cache-verification.test.ts) does not leak.

// GOTCHA — 100% coverage is enforced (vitest.config.ts include src/**/*.ts). This
//   subtask adds NO new src file (test-only) → NO new coverage obligation. The new
//   test file is in tests/** (excluded from measurement). Groundswell is outside src/**
//   so importing generateCacheKey/LLMCache adds nothing to the coverage gate.

// GOTCHA — prettier is an ERROR (eslint prettier/prettier: error). Run `npm run fix`
//   (lint:fix + format) before `npm run validate`. Match the trailing-comma + JSDoc
//   style of agent-factory.test.ts / the existing tests/unit/agents/*.test.ts files.

// GOTCHA — the contrasting model string 'anthropic/claude-sonnet-4' is a LITERAL
//   fixture (the contract's "anthropic/claude-..." example), NOT derived from
//   constants. It represents the claude-code harness's Anthropic-only world (PRD
//   §9.4.3) — the axis the pipeline would switch to if it selected claude-code.
//   The pipeline's own config (zai/GLM-4.7) IS derived from constants so the test
//   tracks the real defaults.
```

---

## Implementation Blueprint

### Data models and structure

No new data models. This subtask consumes Groundswell's public cache API
(`generateCacheKey`, `CacheKeyInputs`, `LLMCache` — re-exported from the
`groundswell` package root) and hacky-hack's pure config constants
(`DEFAULT_HARNESS`, `DEFAULT_MODEL_PROVIDER`, `MODEL_NAMES` from
`src/config/constants.ts`). The only "structure" is the test's local fixtures:
`baseInputs`, `ZAI_GLM_47`, `ANTHROPIC_CLAUDE` — all defined above in the What
section.

### Implementation Tasks (ordered by dependencies — implicit TDD: the test encodes the invariant; against the linked build it is GREEN on first run)

```yaml
Task 1: CREATE tests/unit/agents/cache-key-isolation.test.ts   (GREEN — characterization suite)
  - IMPORT: vitest primitives; generateCacheKey + LLMCache + type CacheKeyInputs from 'groundswell';
    DEFAULT_HARNESS + DEFAULT_MODEL_PROVIDER + MODEL_NAMES from '../../../src/config/constants.js'.
  - HOOKS: beforeEach (stub ANTHROPIC_AUTH_TOKEN/API_KEY/BASE_URL=z.ai); afterEach (vi.unstubAllEnvs).
    Mirror agent-factory.test.ts's hook layout EXACTLY.
  - FIXTURES: baseInputs (canonical CacheKeyInputs with user/system/model/temperature/maxTokens),
    ZAI_GLM_47 = `${DEFAULT_MODEL_PROVIDER}/${MODEL_NAMES.sonnet}`, ANTHROPIC_CLAUDE literal.
  - GROUP 1 (generateCacheKey direct — 8 its):
      * keys differ when ONLY harness differs (pi vs claude-code) + both 64-hex
      * keys differ when ONLY provider differs (zai vs anthropic)
      * keys differ when ONLY model differs (GLM-4.7 vs GLM-4.5-Air)
      * pipeline scenario: pi+zai/GLM-4.7 vs claude-code+anthropic/claude-sonnet-4 → distinct
      * cross-product (2×2×2 = 8 tuples) all distinct + all 64-hex
      * CONTROL: identical inputs → identical key
      * omitting harness yields a different key than providing it (proves harness feeds digest)
      * omitting provider yields a different key than providing it (proves provider feeds digest)
  - GROUP 2 (LLMCache get/set surface — 3 its):
      * set under pi key → get under cc key = undefined (MISS); get under pi key = value (HIT)
      * set under zai/GLM-4.7 key → get under anthropic/claude key = undefined (MISS); zai key HIT
      * CONTROL: identical axes round-trip the value (HIT) + cache.has(key) === true
  - INLINE COMMENT: in Group 1's harness/claude-code case (or at the top of Group 1), note that
    constructing harness:'claude-code'+provider:'zai' inputs does NOT call configureHarness(), so
    the M2.T1.S2 compatibility guard is intentionally bypassed (we never execute an agent).
  - NAMING: describe('Groundswell cache-key isolation — harness × provider/model (PRD §9.4.3)');
    nested describes 'generateCacheKey — direct key-builder isolation' and
    'LLMCache get/set surface — store-level partitioning'; it('...') per case (use the verbatim
    strings from the What section).
  - PLACEMENT: tests/unit/agents/cache-key-isolation.test.ts (sibling of cache-verification.test.ts).
  - EXPECTED: GREEN on first run — this is a CHARACTERIZATION test of an already-shipped Groundswell
    invariant (PRD §7.14.5/§9.4.3). There is nothing new to "wire"; the test pins the invariant.
    (If a Group-1 "keys differ" assertion FAILS, generateCacheKey stopped threading the axis —
    investigate; do NOT weaken the assertion to force green without understanding why. Most likely
    cause of an unexpected RED: the wrong/stale Groundswell build is linked — re-run the
    groundswell linker / confirm dist/cache/cache-key.js contains the harness/provider lines.)

Task 2: FORMAT + VERIFY
  - RUN: npm run fix; then npm run validate;
    then npx vitest run tests/unit/agents/cache-key-isolation.test.ts;
    then npx vitest run tests/unit/agents/ (all agent tests green, incl. cache-verification);
    then npm run test:run (full regression, 100% coverage retained).
  - EXPECTED: all green. If the full suite regresses, the most likely cause is an env-stub
    omission (the global tests/setup.ts endpoint guard throws if ANTHROPIC_BASE_URL is unset or
    Anthropic). Confirm the LOCAL beforeEach stubs all three ANTHROPIC_* vars exactly like
    agent-factory.test.ts.
```

### Implementation Patterns & Key Details

```ts
// ---- tests/unit/agents/cache-key-isolation.test.ts (NEW — full reference) ----
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateCacheKey, LLMCache, type CacheKeyInputs } from 'groundswell';
import {
  DEFAULT_HARNESS,
  DEFAULT_MODEL_PROVIDER,
  MODEL_NAMES,
} from '../../../src/config/constants.js';

describe('Groundswell cache-key isolation — harness × provider/model (PRD §9.4.3)', () => {
  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'stubbed-token');
    vi.stubEnv('ANTHROPIC_API_KEY', 'stubbed-token');
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://api.z.ai/api/anthropic'); // NOT Anthropic
  });
  afterEach(() => vi.unstubAllEnvs());

  // The pipeline's actual resolved config (P1.M1.T1.S2 / P1.M1.T2.S2):
  const ZAI_GLM_47 = `${DEFAULT_MODEL_PROVIDER}/${MODEL_NAMES.sonnet}`; // 'zai/GLM-4.7'
  // The contrasting axis — claude-code's Anthropic-only world (PRD §9.4.3):
  const ANTHROPIC_CLAUDE = 'anthropic/claude-sonnet-4';

  // Canonical base inputs — EVERY field identical except the single axis under test.
  const baseInputs: CacheKeyInputs = {
    user: 'Cache me if you can',
    system: 'isolation-test-system-prompt',
    model: 'GLM-4.7',
    temperature: 0,
    maxTokens: 1024,
  };

  describe('generateCacheKey — direct key-builder isolation', () => {
    // NOTE: building inputs with harness:'claude-code' + provider:'zai' does NOT
    // call configureHarness() — the M2.T1.S2 compatibility guard
    // (HarnessProviderMismatchError) is intentionally bypassed. We feed
    // CacheKeyInputs to a pure function; we never execute an agent.
    it('keys differ when ONLY the harness differs (pi vs claude-code), same provider/model', () => {
      const pi = generateCacheKey({
        ...baseInputs,
        provider: 'zai',
        harness: 'pi',
      });
      const cc = generateCacheKey({
        ...baseInputs,
        provider: 'zai',
        harness: 'claude-code',
      });
      expect(pi).not.toBe(cc);
      expect(pi).toMatch(/^[a-f0-9]{64}$/);
      expect(cc).toMatch(/^[a-f0-9]{64}$/);
    });

    it('keys differ when ONLY the provider differs (zai vs anthropic), same harness + model', () => {
      const zai = generateCacheKey({
        ...baseInputs,
        harness: 'pi',
        provider: 'zai',
      });
      const ant = generateCacheKey({
        ...baseInputs,
        harness: 'pi',
        provider: 'anthropic',
      });
      expect(zai).not.toBe(ant);
    });

    it('keys differ when ONLY the model differs (GLM-4.7 vs GLM-4.5-Air), same harness + provider', () => {
      const a = generateCacheKey({
        ...baseInputs,
        harness: 'pi',
        provider: 'zai',
        model: 'GLM-4.7',
      });
      const b = generateCacheKey({
        ...baseInputs,
        harness: 'pi',
        provider: 'zai',
        model: 'GLM-4.5-Air',
      });
      expect(a).not.toBe(b);
    });

    it('the pipeline scenario: pi+zai/GLM-4.7 vs claude-code+anthropic/claude-sonnet-4 → distinct', () => {
      const pipelineKey = generateCacheKey({
        ...baseInputs,
        model: ZAI_GLM_47,
        provider: DEFAULT_MODEL_PROVIDER,
        harness: DEFAULT_HARNESS,
      });
      const claudeKey = generateCacheKey({
        ...baseInputs,
        model: ANTHROPIC_CLAUDE,
        provider: 'anthropic',
        harness: 'claude-code',
      });
      expect(pipelineKey).not.toBe(claudeKey);
    });

    it('all (harness, provider, model) tuples in the cross-product yield DISTINCT keys', () => {
      const harnesses = ['pi', 'claude-code'] as const;
      const providers = ['zai', 'anthropic'] as const;
      const models = ['GLM-4.7', 'claude-sonnet-4'];
      const keys = new Set<string>();
      for (const h of harnesses) {
        for (const p of providers) {
          for (const m of models) {
            keys.add(
              generateCacheKey({
                ...baseInputs,
                harness: h,
                provider: p,
                model: m,
              })
            );
          }
        }
      }
      expect(keys.size).toBe(
        harnesses.length * providers.length * models.length
      ); // 8 distinct
      for (const k of keys) {
        expect(k).toMatch(/^[a-f0-9]{64}$/);
      }
    });

    it('CONTROL — identical inputs produce the identical key (deterministic)', () => {
      const a = generateCacheKey({
        ...baseInputs,
        harness: 'pi',
        provider: 'zai',
      });
      const b = generateCacheKey({
        ...baseInputs,
        harness: 'pi',
        provider: 'zai',
      });
      expect(a).toBe(b);
    });

    it('harness actually feeds the digest: omitting it yields a DIFFERENT key than providing it', () => {
      const without = generateCacheKey({ ...baseInputs, provider: 'zai' });
      const withPi = generateCacheKey({
        ...baseInputs,
        provider: 'zai',
        harness: 'pi',
      });
      expect(without).not.toBe(withPi);
    });

    it('provider actually feeds the digest: omitting it yields a DIFFERENT key than providing it', () => {
      const without = generateCacheKey({ ...baseInputs, harness: 'pi' });
      const withZai = generateCacheKey({
        ...baseInputs,
        harness: 'pi',
        provider: 'zai',
      });
      expect(without).not.toBe(withZai);
    });
  });

  describe('LLMCache get/set surface — store-level partitioning', () => {
    // Fresh LLMCache() per case — hermetic (NOT the defaultCache singleton).
    it('set under pi key → get under claude-code key is a MISS (undefined)', async () => {
      const cache = new LLMCache();
      const piKey = generateCacheKey({
        ...baseInputs,
        provider: 'zai',
        harness: 'pi',
      });
      const ccKey = generateCacheKey({
        ...baseInputs,
        provider: 'zai',
        harness: 'claude-code',
      });
      await cache.set(piKey, 'pi-response');
      expect(await cache.get(ccKey)).toBeUndefined();
      expect(await cache.get(piKey)).toBe('pi-response');
    });

    it('set under zai/GLM-4.7 key → get under anthropic/claude key is a MISS', async () => {
      const cache = new LLMCache();
      const zaiKey = generateCacheKey({
        ...baseInputs,
        model: ZAI_GLM_47,
        provider: DEFAULT_MODEL_PROVIDER,
        harness: DEFAULT_HARNESS,
      });
      const antKey = generateCacheKey({
        ...baseInputs,
        model: ANTHROPIC_CLAUDE,
        provider: 'anthropic',
        harness: 'claude-code',
      });
      await cache.set(zaiKey, { role: 'assistant', content: 'glm-response' });
      expect(await cache.get(antKey)).toBeUndefined();
      expect(await cache.get(zaiKey)).toEqual({
        role: 'assistant',
        content: 'glm-response',
      });
    });

    it('CONTROL — identical axes round-trip the value (HIT)', async () => {
      const cache = new LLMCache();
      const key = generateCacheKey({
        ...baseInputs,
        model: ZAI_GLM_47,
        provider: DEFAULT_MODEL_PROVIDER,
        harness: DEFAULT_HARNESS,
      });
      await cache.set(key, 'cached');
      expect(await cache.get(key)).toBe('cached');
      expect(cache.has(key)).toBe(true);
    });
  });
});
```

### Integration Points

```yaml
NEW TEST (tests/unit/agents/cache-key-isolation.test.ts):
  - imports REAL generateCacheKey + LLMCache + type CacheKeyInputs from 'groundswell'
    (vitest alias → ../groundswell/dist/index.js)
  - consumes: DEFAULT_HARNESS + DEFAULT_MODEL_PROVIDER + MODEL_NAMES from src/config/constants.js (pure)
  - no vi.mock of 'groundswell' (uses the REAL key-builder + cache)
  - env: stubs ANTHROPIC_AUTH_TOKEN/API_KEY/BASE_URL(z.ai) in beforeEach; unstubAllEnvs in afterEach
  - no real harness instantiated; no LLM; no network; no Anthropic key; no configureHarness() call

NO CHANGES TO (hard boundary):
  - src/config/constants.ts (consumed read-only), src/config/harness.ts (M2.T1.S2 owns), src/config/endpoint-guard.ts (M2.T1.S1 owns)
  - ~/projects/groundswell/src/cache/* (Groundswell-owned, read-only)
  - src/agents/agent-factory.ts, src/tools/*.ts (M2.T2.S1 / earlier items own)
  - any docs/ file (M2.T3)
  - cache-key isolation sibling concerns (this IS the cache-key item)
  - NO new src/**/*.ts (coverage-safe)
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# After creating the file — auto-fix first, then verify.
npm run fix                  # = lint:fix + prettier --write
npm run validate             # = lint && format:check && typecheck   (MUST be green)

# Targeted checks (optional, faster feedback):
npx eslint tests/unit/agents/cache-key-isolation.test.ts
npx tsc --noEmit -p tsconfig.build.json
npx prettier --check tests/unit/agents/cache-key-isolation.test.ts

# Expected: Zero errors. Most likely failure: a prettier nit (re-run `npm run fix`),
# or a type error if `generateCacheKey`/`LLMCache`/`CacheKeyInputs` were misspelled
# (all three are verified re-exported from the package root — see research §1).
```

### Level 2: Unit Tests (Component Validation)

```bash
# The new suite (must pass):
npx vitest run tests/unit/agents/cache-key-isolation.test.ts

# The whole agents suite — proves the new file sits cleanly alongside
# cache-verification.test.ts and agent-factory.test.ts:
npx vitest run tests/unit/agents/

# Expected: all green. The isolation test is a characterization of an already-shipped
# Groundswell path, so it should be green immediately (RED would indicate the linked
# Groundswell build dropped the harness/provider threading — investigate; confirm
# dist/cache/cache-key.js still contains the `normalized.harness`/`normalized.provider` lines).
```

### Level 3: Integration / Regression (System Validation)

```bash
# Full suite — MUST stay green. This is the proof that:
#  (1) the new isolation test passes,
#  (2) the env stubs did NOT regress the global tests/setup.ts endpoint guard or any
#      sibling test (esp. agent-factory.test.ts, cache-verification.test.ts, and the
#      tests/unit/config/ suites owned by M2.T1),
#  (3) global coverage remains 100% (no new uncovered src file — this is test-only).
npm run test:run
npm run test:coverage   # optional: confirm 100% statements/branches/functions/lines on src/**

# Build emits dist/ cleanly (proves the test file compiles via tsc):
npx tsc -p tsconfig.build.json

# Expected: full suite green; coverage at 100%; build succeeds.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# No network/LLM/harness/DB in this subtask — pure generateCacheKey + in-memory LLMCache.
# Domain-specific reasoning (record in commit message):
#   1. Cache-isolation proof (PRD §9.4.3): cache keys incorporate BOTH the harness AND
#      the provider/model. Group 1 proves this at the key-builder (generateCacheKey
#      conditionally appends harness + provider to the SHA-256 digest); Group 2 proves
#      it manifests as real store-level partitioning (set under one axis → get under the
#      other → MISS). The "omitting vs providing" tests prove the axes actually feed the
#      digest (not a coincidental hash difference).
#   2. Contract fidelity: the work item offered "call the key-builder directly OR assert
#      through the cache get/set surface" and mandated "Use Groundswell's cache with an
#      in-memory/in-test store" + "No real LLM/network." We did BOTH clauses (Group 1 +
#      Group 2) with a fresh `new LLMCache()` — no real harness, no Agent, no SDK, no key,
#      no network. Document this choice in the commit message.
#   3. Disjointness: this test does NOT call configureHarness() (so claude-code+zai does
#      NOT throw here — that is M2.T1.S2's concern) and does NOT touch the endpoint guard
#      (M2.T1.S1), tool parity (M2.T2.S1), or docs (M2.T3). Pure cache-layer isolation.
```

---

## Final Validation Checklist

### Technical Validation

- [ ] `npm run validate` exits 0 (lint + format:check + typecheck).
- [ ] `npx vitest run tests/unit/agents/cache-key-isolation.test.ts` exits 0.
- [ ] `npm run test:run` (full suite) exits 0 — no regression (esp.
      `cache-verification.test.ts`, `agent-factory.test.ts`, and `tests/unit/config/`).
- [ ] Global coverage remains 100% (no new uncovered `src/**/*.ts` file).
- [ ] `npx tsc -p tsconfig.build.json` compiles with no errors.

### Feature Validation

- [ ] Group 1: keys differ when ONLY harness differs (both 64-hex); ONLY provider differs;
      ONLY model differs; pipeline scenario (`pi`+`zai/GLM-4.7` vs
      `claude-code`+`anthropic/claude-sonnet-4`) differs; all 8 cross-product tuples
      distinct; identical inputs → identical key; omitting harness/provider yields a
      different key (proves each feeds the digest).
- [ ] Group 2: `set` under pi key → `get` under cc key = `undefined` (and vice versa for
      provider/model); identical axes round-trip the value (HIT) + `cache.has(key) === true`.
- [ ] All asserted keys match `/^[a-f0-9]{64}$/` (SHA-256 hex).
- [ ] No real LLM / network / Anthropic key / harness instantiated.

### Code Quality Validation

- [ ] New test file follows `agent-factory.test.ts` conventions (env stubbing in
      `beforeEach`, `afterEach(vi.unstubAllEnvs)`, ESM `.js` specifiers, no `any`).
- [ ] Inline comment documents the intentional bypass of `configureHarness()` (disjoint
      from M2.T1.S2's compatibility guard).
- [ ] No `vi.mock('groundswell')` (uses the REAL `generateCacheKey` + `LLMCache`).
- [ ] Uses `new LLMCache()` (fresh, hermetic) — NOT the `defaultCache` singleton.
- [ ] No new `src/**/*.ts` created (coverage-safe); test placed in `tests/unit/agents/`.
- [ ] Binds to the real pipeline config via `DEFAULT_HARNESS`/`DEFAULT_MODEL_PROVIDER`/
      `MODEL_NAMES` (so the test tracks the actual defaults).

### Documentation & Deployment

- [ ] Commit message documents: (1) the cache-isolation invariant pinned (PRD §9.4.3);
      (2) the two-clause strategy (key-builder direct AND cache get/set surface) + why not
      the heavyweight Agent+mock-harness path (research §4); (3) the "GREEN on first run"
      characterization-test nature (research §2); (4) disjointness from M2.T1.S1/S2 and
      M2.T2.S1.
- [ ] No new env vars introduced (consumes existing `ANTHROPIC_*` stubs only).

---

## Anti-Patterns to Avoid

- ❌ Don't `vi.mock('groundswell')` — the test verifies Groundswell's ACTUAL behavior, so
  it must use the REAL `generateCacheKey` + REAL `LLMCache`. Mocking tests a stub of our
  own invention and proves nothing. (File-scoped mocks in other files don't leak in.)
- ❌ Don't use the `defaultCache` singleton — it's shared module state and risks cross-test
  pollution. Instantiate `new LLMCache()` per test case for a hermetic store.
- ❌ Don't replicate Groundswell's `agent-cache-key-isolation.test.ts` (Agent + HarnessRegistry
  - `createMockHarness` + `resetGlobalConfig`) — that is heavyweight, fragile, Groundswell-
    internal, and already covered upstream. Use the public key-builder + cache-store surface
    (explicitly permitted by the contract's "If Groundswell exposes a key-builder, call it
    directly" clause). See research §4.
- ❌ Don't call `configureHarness()` / `configureHarnesses()` — that is M2.T1.S2's surface
  and would throw `HarnessProviderMismatchError` for `claude-code`+`zai`. Build
  `CacheKeyInputs` objects only; feed them to `generateCacheKey`.
- ❌ Don't import `src/agents/agent-factory.ts` or `src/config/environment.ts` — both run
  module-load side effects (`configureEnvironment()` / `configureHarness()`). Import ONLY
  `src/config/constants.ts` (pure consts).
- ❌ Don't drop the "omitting vs providing" assertions — they are the proof that harness and
  provider ACTUALLY feed the digest (a regression where Groundswell silently stops threading
  an axis would otherwise look identical to "two arbitrary inputs hashing differently").
- ❌ Don't weaken a "keys differ" assertion to force green without understanding why — this
  is a characterization test of an already-shipped path; a RED means `generateCacheKey`
  stopped threading the axis (Groundswell regression or stale/wrong build linked). Investigate.
- ❌ Don't forget the LOCAL `beforeEach` env stubs — the global `tests/setup.ts` runs
  `validateProviderEndpoint()` every test and will throw if `ANTHROPIC_BASE_URL` is unset or
  an Anthropic URL. Stub to the z.ai URL (as `agent-factory.test.ts` does).
- ❌ Don't set `PRP_AGENT_HARNESS=claude-code` anywhere — not needed (we never call
  `configureHarness()`), and it would be a no-op here at best. Leave it unset.
- ❌ Don't create any new `src/**/*.ts` file (would add a coverage obligation) — this is a
  test-only subtask.
- ❌ Don't conflate the harness axis with the provider axis in a single assertion — test each
  axis in isolation (ONLY harness differs / ONLY provider differs / ONLY model differs) so a
  regression pinpoints which axis broke. The cross-product test then covers their interaction.

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: This is a single, self-contained test file with no production-code change and
no new coverage obligation. Every import (`generateCacheKey`, `LLMCache`, `CacheKeyInputs`
from `groundswell`; `DEFAULT_HARNESS`/`DEFAULT_MODEL_PROVIDER`/`MODEL_NAMES` from
`src/config/constants.ts`) is verified re-exported/present in the linked `dist/` build
(research §1). Every hook is copied verbatim from the already-green `agent-factory.test.ts`.
All eleven assertions across both groups are written out verbatim in the What section +
Implementation Patterns, with the exact axis matrix (research §6) and the canonical
`{...baseInputs, harness, provider}` spread idiom mirrored from Groundswell's own
`cache-key.test.ts`. The architectural fact under test — `generateCacheKey` conditionally
appends `harness` and `provider` to the SHA-256 digest — is verified by direct reading of
`dist/cache/cache-key.js:169-173` (research §2). The genuinely novel decisions — (a) doing
BOTH the key-builder-direct (clause A) AND the cache get/set surface (clause B) instead of
picking one; (b) using `new LLMCache()` instead of the `defaultCache` singleton; (c) NOT
replicating Groundswell's heavyweight Agent+mock-harness path — are each documented with a
full rationale (research §3/§4) and are explicitly permitted by the work-item contract. The
non-obvious traps (GREEN on first run vs manufactured RED arc; never call
`configureHarness()`; never import side-effectful modules; never `vi.mock('groundswell')`)
are spelled out in the Gotchas with the exact workaround. Residual risks: (a) a prettier nit
(auto-fixed via `npm run fix`); (b) a misspelled Groundswell type name (`CacheKeyInputs` is
verified present in `dist/cache/cache-key.d.ts` + re-exported at `dist/index.d.ts:32` —
research §1); (c) the global `tests/setup.ts` endpoint guard if env stubbing is omitted
(mitigated by copying `agent-factory.test.ts`'s hook layout exactly). None are structural.
