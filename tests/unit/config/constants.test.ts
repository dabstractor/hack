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

import { describe, expect, it, afterEach, vi } from 'vitest';
import {
  LEGACY_MODEL_ENV_VARS,
  MODEL_ENV_VARS,
  MODEL_NAMES,
  PRP_API_BASE_URL,
  REQUIRED_ENV_VARS,
  DEFAULT_RESEARCH_DEPTH,
  RESEARCH_DEPTH,
  getResearchDepth,
  PARALLEL_RESEARCH,
  isParallelResearch,
  DEFAULT_RESEARCH_TIMEOUT_SECONDS,
  DEFAULT_VALIDATION_AGENT,
  DEFAULT_VALIDATION_TIMEOUT_SECONDS,
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

describe('config/constants: RESEARCH_DEPTH', () => {
  // Restore env after each test so stubs never leak across the 100%-coverage gate.
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('SHOULD expose DEFAULT_RESEARCH_DEPTH === 2 (PRD §4.2 default)', () => {
    expect(DEFAULT_RESEARCH_DEPTH).toBe(2);
  });

  it('SHOULD expose the RESEARCH_DEPTH env-var name constant', () => {
    expect(RESEARCH_DEPTH).toBe('RESEARCH_DEPTH');
  });

  it('SHOULD return DEFAULT_RESEARCH_DEPTH (2) when RESEARCH_DEPTH is unset', () => {
    // EXECUTE & VERIFY — unset env path: getter falls through to the default
    expect(getResearchDepth()).toBe(DEFAULT_RESEARCH_DEPTH);
    expect(getResearchDepth()).toBe(2);
  });

  it('SHOULD return the configured value when RESEARCH_DEPTH is a valid positive integer', () => {
    // EXECUTE & VERIFY — valid env path (the non-fallback branch)
    vi.stubEnv('RESEARCH_DEPTH', '5');
    expect(getResearchDepth()).toBe(5);
  });

  it('SHOULD fall back to default on non-numeric input (NaN branch)', () => {
    // EXECUTE & VERIFY — NaN fallback branch
    vi.stubEnv('RESEARCH_DEPTH', 'abc');
    expect(getResearchDepth()).toBe(DEFAULT_RESEARCH_DEPTH);
  });

  it('SHOULD fall back to default on non-positive input (<=0 branch)', () => {
    // EXECUTE & VERIFY — <=0 fallback branch
    vi.stubEnv('RESEARCH_DEPTH', '0');
    expect(getResearchDepth()).toBe(DEFAULT_RESEARCH_DEPTH);

    vi.stubEnv('RESEARCH_DEPTH', '-3');
    expect(getResearchDepth()).toBe(DEFAULT_RESEARCH_DEPTH);
  });
});

describe('config/constants: PARALLEL_RESEARCH', () => {
  // Restore env after each test so stubs never leak across the 100%-coverage gate.
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('SHOULD expose the PARALLEL_RESEARCH env-var name constant', () => {
    expect(PARALLEL_RESEARCH).toBe('PARALLEL_RESEARCH');
  });

  it('SHOULD return false when PARALLEL_RESEARCH is unset', () => {
    // EXECUTE & VERIFY — unset env path: the !== 'true' branch (default false)
    expect(isParallelResearch()).toBe(false);
  });

  it('SHOULD return true ONLY for the literal "true" (case-sensitive)', () => {
    // EXECUTE & VERIFY — the === 'true' true-branch
    vi.stubEnv('PARALLEL_RESEARCH', 'true');
    expect(isParallelResearch()).toBe(true);
  });

  it('SHOULD return false for any value other than the literal "true"', () => {
    // EXECUTE & VERIFY — !== 'true' false-branch covers footguns
    vi.stubEnv('PARALLEL_RESEARCH', 'false');
    expect(isParallelResearch()).toBe(false);

    vi.stubEnv('PARALLEL_RESEARCH', '1');
    expect(isParallelResearch()).toBe(false);

    vi.stubEnv('PARALLEL_RESEARCH', 'TRUE');
    expect(isParallelResearch()).toBe(false);

    vi.stubEnv('PARALLEL_RESEARCH', '');
    expect(isParallelResearch()).toBe(false);
  });
});

describe('config/constants: DEFAULT_RESEARCH_TIMEOUT_SECONDS (1800)', () => {
  it('SHOULD be 1800 (PRD §4.2 — 30min default, was the buggy 300)', () => {
    expect(DEFAULT_RESEARCH_TIMEOUT_SECONDS).toBe(1800);
  });
});

describe('config/constants: DEFAULT_VALIDATION_AGENT (pizr)', () => {
  it('SHOULD be "pizr" (PRD §4.4/§9.2.2 — reasoning-tier agent, default pizr)', () => {
    expect(DEFAULT_VALIDATION_AGENT).toBe('pizr');
  });
});

describe('config/constants: DEFAULT_VALIDATION_TIMEOUT_SECONDS (7200)', () => {
  it('SHOULD be 7200 (PRD §4.4/§9.2.2 — 2h; validation runs full suites)', () => {
    expect(DEFAULT_VALIDATION_TIMEOUT_SECONDS).toBe(7200);
  });
});
