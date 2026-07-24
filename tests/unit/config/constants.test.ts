/**
 * Unit tests for MODEL_NAMES / MODEL_ENV_VARS / ModelTier (PRD §9.2.8 — provider-neutral tiers)
 *
 * @remarks
 * Locks the renamed vendor-neutral tier KEYS (`opus/sonnet/haiku` → `high/balanced/fast`)
 * and their byte-identical VALUES. Pure & deterministic — no environment mutation — so it
 * stays stable under the project's 100%-coverage gate.
 *
 * Contract locked here (P2.M1.T1.S2 — canonical-first-with-fallback):
 * - `type ModelTier = 'high' | 'balanced' | 'fast'`
 * - `MODEL_NAMES`: keys high/balanced/fast; values `glm-5.2`/`glm-5.2`/`glm-5-turbo` (UNCHANGED)
 * - `MODEL_ENV_VARS`: keys high/balanced/fast; values = CANONICAL `PRP_MODEL_*` name strings
 * - `LEGACY_MODEL_ENV_VARS`: keys high/balanced/fast; values = deprecated `ANTHROPIC_DEFAULT_*`
 *   name strings (read ONLY when the canonical var is unset; one-time deprecation warning)
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { describe, expect, it } from 'vitest';
import {
  LEGACY_MODEL_ENV_VARS,
  MODEL_ENV_VARS,
  MODEL_NAMES,
  PRP_API_BASE_URL,
  REQUIRED_ENV_VARS,
} from '../../../src/config/constants.js';
import type { ModelTier } from '../../../src/config/types.js';

describe('config/constants: MODEL_NAMES', () => {
  it('SHOULD map vendor-neutral tiers to model ids', () => {
    // EXECUTE & VERIFY — values byte-identical to the pre-rename opus/sonnet/haiku
    expect(MODEL_NAMES.high).toBe('glm-5.2');
    expect(MODEL_NAMES.balanced).toBe('glm-5.2');
    expect(MODEL_NAMES.fast).toBe('glm-5-turbo');
  });

  it('SHOULD NOT expose legacy opus/sonnet/haiku keys', () => {
    // VERIFY: only the renamed vendor-neutral keys exist
    const legacy = MODEL_NAMES as Record<string, unknown>;
    expect(legacy.opus).toBeUndefined();
    expect(legacy.sonnet).toBeUndefined();
    expect(legacy.haiku).toBeUndefined();
  });

  it('SHOULD expose exactly the high/balanced/fast keys (matches ModelTier)', () => {
    // VERIFY: keys match the ModelTier union
    expect(Object.keys(MODEL_NAMES).sort()).toEqual(
      ['high', 'balanced', 'fast'].sort()
    );
  });
});

describe('config/constants: MODEL_ENV_VARS', () => {
  it('SHOULD map vendor-neutral tier keys to the canonical PRP_MODEL_* env-var names', () => {
    // EXECUTE & VERIFY — VALUES are the canonical PRP_* names (PRD §9.2.8)
    expect(MODEL_ENV_VARS.high).toBe('PRP_MODEL_HIGH');
    expect(MODEL_ENV_VARS.balanced).toBe('PRP_MODEL_BALANCED');
    expect(MODEL_ENV_VARS.fast).toBe('PRP_MODEL_FAST');
  });

  it('SHOULD NOT expose legacy opus/sonnet/haiku keys', () => {
    // VERIFY: only the renamed vendor-neutral keys exist
    const legacy = MODEL_ENV_VARS as Record<string, unknown>;
    expect(legacy.opus).toBeUndefined();
    expect(legacy.sonnet).toBeUndefined();
    expect(legacy.haiku).toBeUndefined();
  });

  it('SHOULD expose exactly the high/balanced/fast keys (matches ModelTier)', () => {
    // VERIFY: keys match the ModelTier union
    expect(Object.keys(MODEL_ENV_VARS).sort()).toEqual(
      ['high', 'balanced', 'fast'].sort()
    );
  });

  it('SHOULD NOT leak legacy ANTHROPIC_DEFAULT_* values into MODEL_ENV_VARS', () => {
    // VERIFY: only canonical PRP_MODEL_* values are present
    const values = Object.values(MODEL_ENV_VARS);
    expect(values).not.toContain('ANTHROPIC_DEFAULT_OPUS_MODEL');
    expect(values).not.toContain('ANTHROPIC_DEFAULT_SONNET_MODEL');
    expect(values).not.toContain('ANTHROPIC_DEFAULT_HAIKU_MODEL');
  });
});

describe('config/constants: LEGACY_MODEL_ENV_VARS', () => {
  it('SHOULD map vendor-neutral tier keys to the deprecated ANTHROPIC_DEFAULT_* env-var names', () => {
    // EXECUTE & VERIFY — VALUES are the deprecated legacy aliases (PRD §9.2.8 backward-compat)
    expect(LEGACY_MODEL_ENV_VARS.high).toBe('ANTHROPIC_DEFAULT_OPUS_MODEL');
    expect(LEGACY_MODEL_ENV_VARS.balanced).toBe(
      'ANTHROPIC_DEFAULT_SONNET_MODEL'
    );
    expect(LEGACY_MODEL_ENV_VARS.fast).toBe('ANTHROPIC_DEFAULT_HAIKU_MODEL');
  });

  it('SHOULD NOT expose legacy opus/sonnet/haiku keys', () => {
    // VERIFY: only the vendor-neutral keys exist
    const legacy = LEGACY_MODEL_ENV_VARS as Record<string, unknown>;
    expect(legacy.opus).toBeUndefined();
    expect(legacy.sonnet).toBeUndefined();
    expect(legacy.haiku).toBeUndefined();
  });

  it('SHOULD expose exactly the high/balanced/fast keys (matches ModelTier)', () => {
    // VERIFY: keys match the ModelTier union
    expect(Object.keys(LEGACY_MODEL_ENV_VARS).sort()).toEqual(
      ['high', 'balanced', 'fast'].sort()
    );
  });

  it('SHOULD NOT leak canonical PRP_MODEL_* values into LEGACY_MODEL_ENV_VARS', () => {
    // VERIFY: only legacy ANTHROPIC_DEFAULT_* values are present
    const values = Object.values(LEGACY_MODEL_ENV_VARS);
    expect(values).not.toContain('PRP_MODEL_HIGH');
    expect(values).not.toContain('PRP_MODEL_BALANCED');
    expect(values).not.toContain('PRP_MODEL_FAST');
  });
});

describe('config/constants: PRP_API_BASE_URL + REQUIRED_ENV_VARS', () => {
  it('SHOULD expose the canonical PRP_API_BASE_URL env-var name constant', () => {
    // EXECUTE & VERIFY — the canonical endpoint env-var name (PRD §9.2.8)
    expect(PRP_API_BASE_URL).toBe('PRP_API_BASE_URL');
  });

  it('SHOULD point REQUIRED_ENV_VARS.baseURL at the canonical endpoint name', () => {
    // EXECUTE & VERIFY — canonical pipeline-global endpoint (legacy alias ANTHROPIC_BASE_URL)
    expect(REQUIRED_ENV_VARS.baseURL).toBe('PRP_API_BASE_URL');
  });

  it('SHOULD keep REQUIRED_ENV_VARS.apiKey as the provider-native ANTHROPIC_API_KEY (§9.2.8 exception)', () => {
    // EXECUTE & VERIFY — provider-native credential NOT renamed
    expect(REQUIRED_ENV_VARS.apiKey).toBe('ANTHROPIC_API_KEY');
  });
});

describe('config/types: ModelTier', () => {
  it('SHOULD accept the three vendor-neutral tier literals (type-level guard)', () => {
    // VERIFY: each renamed tier literal compiles as a ModelTier
    const high: ModelTier = 'high';
    const balanced: ModelTier = 'balanced';
    const fast: ModelTier = 'fast';

    // Touch the consts so they are not flagged as unused (and the case is meaningful).
    expect([high, balanced, fast]).toEqual(['high', 'balanced', 'fast']);
  });

  it('SHOULD align with MODEL_NAMES / MODEL_ENV_VARS / LEGACY_MODEL_ENV_VARS keys', () => {
    // VERIFY: the ModelTier-typed set equals the keys of all three constant maps
    const tiers: ModelTier[] = ['high', 'balanced', 'fast'];
    expect(Object.keys(MODEL_NAMES).sort()).toEqual([...tiers].sort());
    expect(Object.keys(MODEL_ENV_VARS).sort()).toEqual([...tiers].sort());
    expect(Object.keys(LEGACY_MODEL_ENV_VARS).sort()).toEqual(
      [...tiers].sort()
    );
  });
});
