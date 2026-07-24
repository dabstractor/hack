/**
 * Unit tests for MODEL_NAMES / MODEL_ENV_VARS / ModelTier (PRD §9.2.8 — provider-neutral tiers)
 *
 * @remarks
 * Locks the renamed vendor-neutral tier KEYS (`opus/sonnet/haiku` → `high/balanced/fast`)
 * and their byte-identical VALUES. Pure & deterministic — no environment mutation — so it
 * stays stable under the project's 100%-coverage gate.
 *
 * Contract locked here (P2.M1.T1.S1):
 * - `type ModelTier = 'high' | 'balanced' | 'fast'`
 * - `MODEL_NAMES`: keys high/balanced/fast; values `glm-5.2`/`glm-5.2`/`glm-5-turbo` (UNCHANGED)
 * - `MODEL_ENV_VARS`: keys high/balanced/fast; values = legacy `ANTHROPIC_DEFAULT_*` name
 *   strings (UNCHANGED — canonical `PRP_MODEL_*` names land in P2.M1.T1.S2)
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { describe, expect, it } from 'vitest';
import { MODEL_ENV_VARS, MODEL_NAMES } from '../../../src/config/constants.js';
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
  it('SHOULD map vendor-neutral tier keys to the legacy ANTHROPIC_DEFAULT_* env-var names', () => {
    // EXECUTE & VERIFY — VALUES unchanged (canonical PRP_MODEL_* names are P2.M1.T1.S2)
    expect(MODEL_ENV_VARS.high).toBe('ANTHROPIC_DEFAULT_OPUS_MODEL');
    expect(MODEL_ENV_VARS.balanced).toBe('ANTHROPIC_DEFAULT_SONNET_MODEL');
    expect(MODEL_ENV_VARS.fast).toBe('ANTHROPIC_DEFAULT_HAIKU_MODEL');
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

  it('SHOULD align with MODEL_NAMES / MODEL_ENV_VARS keys', () => {
    // VERIFY: the ModelTier-typed set equals the keys of both constant maps
    const tiers: ModelTier[] = ['high', 'balanced', 'fast'];
    expect(Object.keys(MODEL_NAMES).sort()).toEqual([...tiers].sort());
    expect(Object.keys(MODEL_ENV_VARS).sort()).toEqual([...tiers].sort());
  });
});
