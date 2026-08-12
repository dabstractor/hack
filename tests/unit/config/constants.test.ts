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
  DEFAULT_BUG_FINDER_AGENT,
  BUGFIX_SCOPE,
  BUGFIX_SCOPE_VALUES,
  DEFAULT_BUGFIX_SCOPE,
  getBugfixScope,
  API_TIMEOUT_MS,
  DEFAULT_API_TIMEOUT_MS,
  getApiTimeoutMs,
  REASONING_LEVELS,
  resolveReasoningLevel,
  getReasoningAgent,
  getReasoningBreakdown,
  getReasoningBugFinder,
  getReasoningValidation,
  getReasoningImpl,
  validateAllReasoningLevels,
  FORMAT_NUDGE_MAX,
} from '../../../src/config/constants.js';
import {
  type ModelTier,
  ReasoningConfigError,
} from '../../../src/config/types.js';

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
    // SETUP — ensure the var is truly absent (the host env may set it, e.g.
    // PARALLEL_RESEARCH=true loaded via .env in tests/setup.ts). Remove it for
    // this assertion, then restore the original value afterwards.
    const saved = process.env.PARALLEL_RESEARCH;
    delete process.env.PARALLEL_RESEARCH;
    try {
      // EXECUTE & VERIFY — unset env path: the !== 'true' branch (default false)
      expect(isParallelResearch()).toBe(false);
    } finally {
      if (saved !== undefined) {
        process.env.PARALLEL_RESEARCH = saved;
      }
    }
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

describe('config/constants: DEFAULT_BUG_FINDER_AGENT (pizr)', () => {
  it('SHOULD be "pizr" (PRD §4.4/§9.2.2 — reasoning-tier bug-finder agent, default pizr)', () => {
    expect(DEFAULT_BUG_FINDER_AGENT).toBe('pizr');
  });
});

describe('config/constants: DEFAULT_VALIDATION_TIMEOUT_SECONDS (7200)', () => {
  it('SHOULD be 7200 (PRD §4.4/§9.2.2 — 2h; validation runs full suites)', () => {
    expect(DEFAULT_VALIDATION_TIMEOUT_SECONDS).toBe(7200);
  });
});

// ===========================================================================
// BUGFIX_SCOPE — runtime consumer for .hack [bug_hunt] fix_scope (Finding 2)
// ===========================================================================
describe('config/constants: BUGFIX_SCOPE (getBugfixScope)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('exposes the BUGFIX_SCOPE env-var name + accepted values + default', () => {
    expect(BUGFIX_SCOPE).toBe('BUGFIX_SCOPE');
    expect(BUGFIX_SCOPE_VALUES).toEqual(['subtask', 'task']);
    expect(DEFAULT_BUGFIX_SCOPE).toBe('subtask');
  });

  it('returns the default (subtask) when unset', () => {
    vi.stubEnv('BUGFIX_SCOPE', '');
    expect(getBugfixScope()).toBe('subtask');
  });

  it('returns the configured value for a recognized scope', () => {
    vi.stubEnv('BUGFIX_SCOPE', 'task');
    expect(getBugfixScope()).toBe('task');
  });

  it('falls back to the default for an unrecognized value', () => {
    vi.stubEnv('BUGFIX_SCOPE', 'milestone');
    expect(getBugfixScope()).toBe('subtask');
  });
});

// ===========================================================================
// API_TIMEOUT_MS — runtime consumer for .hack [api] timeout_ms (Finding 2)
// ===========================================================================
describe('config/constants: API_TIMEOUT_MS (getApiTimeoutMs)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('exposes the API_TIMEOUT_MS env-var name + default', () => {
    expect(API_TIMEOUT_MS).toBe('API_TIMEOUT_MS');
    expect(DEFAULT_API_TIMEOUT_MS).toBe(60000);
  });

  it('returns the default (60000) when unset', () => {
    vi.stubEnv('API_TIMEOUT_MS', '');
    expect(getApiTimeoutMs()).toBe(60000);
  });

  it('returns the configured value for a valid positive integer', () => {
    vi.stubEnv('API_TIMEOUT_MS', '120000');
    expect(getApiTimeoutMs()).toBe(120000);
  });

  it('falls back to the default on non-numeric input', () => {
    vi.stubEnv('API_TIMEOUT_MS', 'oops');
    expect(getApiTimeoutMs()).toBe(60000);
  });

  it('falls back to the default on non-positive input', () => {
    vi.stubEnv('API_TIMEOUT_MS', '0');
    expect(getApiTimeoutMs()).toBe(60000);
  });
});

// ============================================================================
// resolveReasoningLevel + ReasoningConfigError (PRD §9.2.9 — Per-Role Reasoning Level)
// ============================================================================

describe('config/constants: resolveReasoningLevel', () => {
  it('returns the default for undefined (env var unset)', () => {
    expect(
      resolveReasoningLevel(undefined, 'PRP_REASONING_AGENT', 'high')
    ).toBe('high');
  });

  it('returns the default for an empty string', () => {
    expect(resolveReasoningLevel('', 'PRP_REASONING_AGENT', 'off')).toBe('off');
  });

  it('returns the default for a whitespace-only string', () => {
    expect(resolveReasoningLevel('   ', 'PRP_REASONING_AGENT', 'high')).toBe(
      'high'
    );
  });

  it('accepts a valid lowercase token', () => {
    expect(resolveReasoningLevel('high', 'PRP_REASONING_AGENT', 'off')).toBe(
      'high'
    );
    expect(resolveReasoningLevel('minimal', 'X', 'high')).toBe('minimal');
    expect(resolveReasoningLevel('xhigh', 'X', 'off')).toBe('xhigh');
  });

  it('accepts valid tokens CASE-INSENSITIVELY and returns the lowercased token', () => {
    expect(resolveReasoningLevel('HIGH', 'PRP_REASONING_AGENT', 'off')).toBe(
      'high'
    );
    expect(resolveReasoningLevel('xHigh', 'PRP_REASONING_AGENT', 'off')).toBe(
      'xhigh'
    );
    expect(resolveReasoningLevel('Off', 'X', 'high')).toBe('off');
  });

  it('trims surrounding whitespace before matching', () => {
    expect(resolveReasoningLevel('  high  ', 'X', 'off')).toBe('high');
  });

  it('REASONING_LEVELS deep-equals the pi-SDK vocabulary (off/minimal/low/medium/high/xhigh)', () => {
    expect([...REASONING_LEVELS]).toEqual([
      'off',
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
    ]);
  });

  it('throws ReasoningConfigError on an invalid value (carrying key + value + actionable message)', () => {
    const KEY = 'PRP_REASONING_AGENT';
    try {
      resolveReasoningLevel('ultra', KEY, 'high');
      throw new Error('expected resolveReasoningLevel to throw');
    } catch (e) {
      const err = e as ReasoningConfigError;
      expect(err).toBeInstanceOf(ReasoningConfigError);
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe('ReasoningConfigError');
      expect(err.key).toBe(KEY);
      expect(err.value).toBe('ultra');
      expect(err.message).toContain(KEY);
      expect(err.message).toContain("'ultra'");
      expect(err.message).toContain('off, minimal, low, medium, high, xhigh');
      expect(err.message).toContain('case-insensitive');
    }
  });

  it('throws on a second invalid token (proves the throw is not token-specific)', () => {
    expect(() => resolveReasoningLevel('yes', 'X', 'high')).toThrow(
      ReasoningConfigError
    );
  });
});

describe('config/types: ReasoningConfigError', () => {
  it('carries key + value and sets name (rich AuthPreflightError form)', () => {
    const err = new ReasoningConfigError({
      key: 'PRP_REASONING_IMPL_AGENT',
      value: 'turbo',
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ReasoningConfigError');
    expect(err.key).toBe('PRP_REASONING_IMPL_AGENT');
    expect(err.value).toBe('turbo');
    expect(err.message).toBe(
      "Invalid reasoning level for 'PRP_REASONING_IMPL_AGENT': 'turbo'. " +
        'Accepted (case-insensitive): off, minimal, low, medium, high, xhigh.'
    );
  });
});

// ============================================================================
// Per-role reasoning getters + validateAllReasoningLevels (P1.M1.T1.S2 — PRD §9.2.9)
// ============================================================================
// S2 adds 5 per-role getters (one-line wrappers over S1's resolveReasoningLevel) + a fail-fast
// aggregate validator. Each getter routes process.env[PRP_REASONING_*] through the shared
// validator (case-insensitive, empty/whitespace→default, invalid→throws). Defaults: Agent /
// Breakdown / BugFinder / Validation = 'high'; Impl = 'off' (the one non-high default).

describe('config/constants: per-role reasoning getters', () => {
  // Restore env after each test so stubs never leak across the 100%-coverage gate.
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // Data-driven [getter, envName, default] tuples cover all 5 getters DRY (each is a branchless
  // one-liner over resolveReasoningLevel; the branches live in resolveReasoningLevel, covered above).
  const cases: Array<{
    name: string;
    getter: () => string;
    envName: string;
    def: string;
  }> = [
    {
      name: 'getReasoningAgent',
      getter: getReasoningAgent,
      envName: 'PRP_REASONING_AGENT',
      def: 'high',
    },
    {
      name: 'getReasoningBreakdown',
      getter: getReasoningBreakdown,
      envName: 'PRP_REASONING_BREAKDOWN_AGENT',
      def: 'high',
    },
    {
      name: 'getReasoningBugFinder',
      getter: getReasoningBugFinder,
      envName: 'PRP_REASONING_BUG_FINDER_AGENT',
      def: 'high',
    },
    {
      name: 'getReasoningValidation',
      getter: getReasoningValidation,
      envName: 'PRP_REASONING_VALIDATION_AGENT',
      def: 'high',
    },
    {
      name: 'getReasoningImpl',
      getter: getReasoningImpl,
      envName: 'PRP_REASONING_IMPL_AGENT',
      def: 'off', // the one non-high default
    },
  ];

  for (const { name, getter, envName, def } of cases) {
    describe(`${name} (${envName}, default ${def})`, () => {
      it('returns the role default when the env var is unset', () => {
        // Unset (no stub) → default. Stub '' first to clear any .env leakage, then delete to exercise
        // the `raw === undefined` branch in resolveReasoningLevel.
        vi.stubEnv(envName, '');
        expect(getter()).toBe(def);
        delete process.env[envName];
        expect(getter()).toBe(def);
      });

      it('returns the role default when the env var is empty or whitespace-only', () => {
        vi.stubEnv(envName, '');
        expect(getter()).toBe(def);
        vi.stubEnv(envName, '   ');
        expect(getter()).toBe(def);
        vi.stubEnv(envName, '\t\n');
        expect(getter()).toBe(def);
      });

      it('honors a set value case-insensitively (lowercased)', () => {
        vi.stubEnv(envName, 'medium');
        expect(getter()).toBe('medium');
        vi.stubEnv(envName, 'HIGH');
        expect(getter()).toBe('high');
        vi.stubEnv(envName, 'Xhigh');
        expect(getter()).toBe('xhigh');
      });

      it('throws ReasoningConfigError on an invalid value (key + value carried)', () => {
        vi.stubEnv(envName, 'ultra');
        let err: unknown;
        try {
          getter();
        } catch (e) {
          err = e;
        }
        expect(err).toBeInstanceOf(ReasoningConfigError);
        const rce = err as ReasoningConfigError;
        expect(rce.name).toBe('ReasoningConfigError');
        expect(rce.key).toBe(envName);
        expect(rce.value).toBe('ultra');
        expect(rce.message).toContain(envName);
        expect(rce.message).toContain('ultra');
      });
    });
  }

  // Explicit guard on the one non-high default (easy to mis-wire to 'high').
  it('getReasoningImpl default is off (the one non-high default)', () => {
    vi.stubEnv('PRP_REASONING_IMPL_AGENT', '');
    expect(getReasoningImpl()).toBe('off');
  });

  describe('validateAllReasoningLevels', () => {
    it('is a no-op (returns void) when all five roles are valid/unset', () => {
      // Clear all five so none is invalid (unset → default).
      vi.stubEnv('PRP_REASONING_AGENT', '');
      vi.stubEnv('PRP_REASONING_BREAKDOWN_AGENT', '');
      vi.stubEnv('PRP_REASONING_BUG_FINDER_AGENT', '');
      vi.stubEnv('PRP_REASONING_VALIDATION_AGENT', '');
      vi.stubEnv('PRP_REASONING_IMPL_AGENT', '');
      expect(() => validateAllReasoningLevels()).not.toThrow();
    });

    it('throws ReasoningConfigError when ANY role is invalid (fail-fast)', () => {
      vi.stubEnv('PRP_REASONING_AGENT', 'ultra'); // invalid → first getter throws
      let err: unknown;
      try {
        validateAllReasoningLevels();
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(ReasoningConfigError);
      const rce = err as ReasoningConfigError;
      expect(rce.key).toBe('PRP_REASONING_AGENT');
      expect(rce.value).toBe('ultra');
    });

    it('throws on the LAST role too (getReasoningImpl) when it alone is invalid', () => {
      // Only the 5th getter (Impl) is invalid — proves validateAll reaches the tail.
      vi.stubEnv('PRP_REASONING_IMPL_AGENT', 'turbo');
      let err: unknown;
      try {
        validateAllReasoningLevels();
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(ReasoningConfigError);
      const rce = err as ReasoningConfigError;
      expect(rce.key).toBe('PRP_REASONING_IMPL_AGENT');
      expect(rce.value).toBe('turbo');
    });
  });
});

describe('config/constants: FORMAT_NUDGE_MAX', () => {
  it('SHOULD lock FORMAT_NUDGE_MAX at the §4.5.1 default of 2', () => {
    // VERIFY — fixed internal constant (NOT env/.hack-configurable per §4.5.1).
    expect(FORMAT_NUDGE_MAX).toBe(2);
  });
});
