/**
 * Cache-key isolation test — harness × provider/model (PRD §9.4.3)
 *
 * @remarks
 * Characterization test proving Groundswell's cache keys are partitioned by BOTH
 * the harness (pi vs claude-code) AND the provider/model (zai/GLM-4.7 vs anthropic/claude-sonnet-4).
 * Uses the REAL generateCacheKey + a fresh LLMCache() per case — no mock, no LLM, no network.
 * This test intentionally bypasses configureHarness() (the M2.T1.S2 compatibility guard):
 * we build CacheKeyInputs objects and feed them to a pure function, never executing an agent.
 *
 * @see {@link https://example.com/PRD | PRD §9.4.3 Critical Rules}
 */

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
    vi.stubEnv(
      'ANTHROPIC_BASE_URL',
      'https://api.z.ai/api/anthropic' // NOT Anthropic
    );
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

    it('keys differ when ONLY the model differs (GLM-4.7 vs glm-5-turbo), same harness + provider', () => {
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
        model: 'glm-5-turbo',
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
});
