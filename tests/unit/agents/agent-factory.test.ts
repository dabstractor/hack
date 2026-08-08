/**
 * Unit tests for agent factory module
 *
 * @remarks
 * Tests validate persona-based configuration generation with 100% coverage
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  it,
  vi,
} from 'vitest';
import {
  DEFAULT_HARNESS,
  REASONING_LEVELS,
  type ReasoningLevel,
} from '../../../src/config/constants.js';
import {
  createBaseConfig,
  createArchitectAgent,
  createResearcherAgent,
  createCoderAgent,
  createQAAgent,
  MCP_TOOLS,
  ROLE_CONFIG,
  STATELESS_PERSONAS,
  type AgentPersona,
  type ModelRole,
  type ThinkingLevel,
} from '../../../src/agents/agent-factory.js';

describe('agents/agent-factory', () => {
  // CLEANUP: Always restore environment after each test
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('createBaseConfig', () => {
    // SETUP: Ensure environment is configured before tests
    beforeEach(() => {
      vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'test-token');
      vi.stubEnv('ANTHROPIC_BASE_URL', 'https://api.z.ai/api/anthropic');
      vi.stubEnv('ANTHROPIC_API_KEY', 'test-token');
    });

    const personas: AgentPersona[] = ['architect', 'researcher', 'coder', 'qa'];

    it.each(personas)('should return valid config for %s persona', persona => {
      // EXECUTE
      const config = createBaseConfig(persona, 'research', 'high');

      // VERIFY: Required properties exist
      expect(config).toHaveProperty('name');
      expect(config).toHaveProperty('system');
      expect(config).toHaveProperty('model');
      expect(config).toHaveProperty('enableCache');
      expect(config).toHaveProperty('enableReflection');
      expect(config).toHaveProperty('maxTokens');
      expect(config).toHaveProperty('harness');
      expect(config.harness).toBeDefined();
      expect(config).toHaveProperty('env');
    });

    it('should set maxTokens to 8192 for architect persona', () => {
      // EXECUTE
      const config = createBaseConfig('architect', 'research', 'high');

      // VERIFY: Architect gets larger token limit
      expect(config.maxTokens).toBe(8192);
    });

    it.each(['researcher', 'coder', 'qa'] as AgentPersona[])(
      'should set maxTokens to 4096 for %s persona',
      persona => {
        // EXECUTE
        const config = createBaseConfig(persona, 'research', 'high');

        // VERIFY: Standard token limit
        expect(config.maxTokens).toBe(4096);
      }
    );

    it('should enable cache and reflection for all personas', () => {
      // EXECUTE
      const configs = personas.map(p =>
        createBaseConfig(p, 'research', 'high')
      );

      // VERIFY: All configs have caching and reflection enabled
      configs.forEach(config => {
        expect(config.enableCache).toBe(true);
        expect(config.enableReflection).toBe(true);
      });
    });

    it('should use qualified glm-4.7 model for all personas', () => {
      // EXECUTE
      const configs = personas.map(p =>
        createBaseConfig(p, 'research', 'high')
      );

      // VERIFY: All personas use balanced tier → zai/glm-5.2 (provider-qualified, lowercase id
      // as registered in the Pi model registry — ModelRegistry.find() is case-sensitive)
      configs.forEach(config => {
        expect(config.model).toBe('zai/glm-5.2');
      });
    });

    it('should set harness to the resolved runtime (default pi) for all personas', () => {
      // EXECUTE
      const configs = personas.map(p =>
        createBaseConfig(p, 'research', 'high')
      );

      // VERIFY: All personas use the default harness resolved at startup
      configs.forEach(config => {
        expect(config.harness).toBe(DEFAULT_HARNESS); // 'pi'
      });
    });

    it('should properly map environment variables', () => {
      // SETUP: Known environment values
      const expectedBaseUrl = 'https://api.z.ai/api/anthropic';
      vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'test-token-123');
      vi.stubEnv('ANTHROPIC_BASE_URL', expectedBaseUrl);

      // EXECUTE
      const config = createBaseConfig('architect', 'research', 'high');

      // VERIFY: Environment is mapped in config.env
      expect(config.env.ANTHROPIC_API_KEY).toBeDefined();
      expect(config.env.ANTHROPIC_BASE_URL).toBe(expectedBaseUrl);
    });

    it('should generate agent name from persona', () => {
      // EXECUTE & VERIFY: Agent names follow Persona → PersonaAgent pattern
      expect(createBaseConfig('architect', 'research', 'high').name).toBe(
        'ArchitectAgent'
      );
      expect(createBaseConfig('researcher', 'research', 'high').name).toBe(
        'ResearcherAgent'
      );
      expect(createBaseConfig('coder', 'research', 'high').name).toBe(
        'CoderAgent'
      );
      expect(createBaseConfig('qa', 'research', 'high').name).toBe('QaAgent');
    });

    it('should have readonly properties', () => {
      // EXECUTE
      const config = createBaseConfig('architect', 'research', 'high');

      // VERIFY: Properties are readonly (TypeScript enforces this at compile time)
      // At runtime, we can check that the config has the expected structure
      expect(typeof config.name).toBe('string');
      expect(typeof config.model).toBe('string');
      expect(typeof config.maxTokens).toBe('number');
    });

    it('should include system prompt placeholder', () => {
      // EXECUTE
      const config = createBaseConfig('coder', 'research', 'high');

      // VERIFY: System prompt contains the persona name
      expect(config.system).toContain('coder');
    });

    it('should use empty string fallback when env vars are not set', () => {
      // SETUP: Delete environment variables to test fallback behavior
      // Note: configureEnvironment() has already run at module load time
      // This test verifies the fallback behavior when vars are deleted after import
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_BASE_URL;

      // EXECUTE
      const config = createBaseConfig('architect', 'research', 'high');

      // VERIFY: Fallback to empty strings when env vars are not set
      expect(config.env.ANTHROPIC_API_KEY).toBe('');
      expect(config.env.ANTHROPIC_BASE_URL).toBe('');
    });
  });

  describe('stateless single-shot invariant (PRD §9.3.2 / P3.M2.T3.S1)', () => {
    // SETUP: Ensure environment is configured before tests
    beforeEach(() => {
      vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'test-token');
      vi.stubEnv('ANTHROPIC_BASE_URL', 'https://api.z.ai/api/anthropic');
      vi.stubEnv('ANTHROPIC_API_KEY', 'test-token');
    });

    // NOTE: This array is declared INLINE (NOT reusing the `personas` array above,
    // which omits 'cleanup') so the cleanup branch of STATELESS_PERSONAS.has()
    // executes — required for 100% coverage.
    it.each([
      ['coder', true],
      ['qa', true],
      ['cleanup', true],
      ['architect', false],
      ['researcher', false],
    ] as const)(
      'should set stateless=%s for %s persona per STATELESS_PERSONAS',
      (persona, expected) => {
        // EXECUTE
        const config = createBaseConfig(persona, 'research', 'high');

        // VERIFY — persona is the single source of truth for the invariant
        expect(config.stateless).toBe(expected);
      }
    );

    it('should expose STATELESS_PERSONAS matching PRD §9.3.2 (coder, qa, cleanup)', () => {
      // VERIFY — exact membership per the §9.3.2 derivation
      expect(STATELESS_PERSONAS.has('coder')).toBe(true);
      expect(STATELESS_PERSONAS.has('qa')).toBe(true);
      expect(STATELESS_PERSONAS.has('cleanup')).toBe(true);
      expect(STATELESS_PERSONAS.has('architect')).toBe(false);
      expect(STATELESS_PERSONAS.has('researcher')).toBe(false);
      expect(STATELESS_PERSONAS.size).toBe(3);
    });

    it('should expose stateless as a readonly boolean on the config', () => {
      // EXECUTE
      const config = createBaseConfig('coder', 'research', 'high');

      // VERIFY — the field is present, boolean, and reads true for a stateless persona
      expect(typeof config.stateless).toBe('boolean');
      expect(config.stateless).toBe(true);
    });
  });

  describe('model roles & reasoning budget', () => {
    // SETUP: Ensure environment is configured before tests
    beforeEach(() => {
      vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'test-token');
      vi.stubEnv('ANTHROPIC_BASE_URL', 'https://api.z.ai/api/anthropic');
      vi.stubEnv('ANTHROPIC_API_KEY', 'test-token');
    });

    // Each role → resolved MODEL (driven by ROLE_CONFIG → getModel tier). After P1.M1.T3.S1 the
    // reasoning LEVEL is a SEPARATE caller-resolved axis (PRD §9.2.9) — it is NO LONGER derived
    // from the role, so the tier→model table no longer carries a thinking column. The decoupling
    // of role→tier vs caller→thinking is proven by the dedicated tests below.
    // research/reasoning use the balanced tier (glm-5.2); implementation uses fast (glm-5-turbo).
    const roleModelExpectations: Array<{ role: ModelRole; model: string }> = [
      { role: 'research', model: 'zai/glm-5.2' },
      { role: 'reasoning', model: 'zai/glm-5.2' },
      { role: 'implementation', model: 'zai/glm-5-turbo' },
    ];

    it.each(roleModelExpectations)(
      'should resolve the correct tier-derived model for the $role role (thinking is a separate axis)',
      ({ role, model }) => {
        // EXECUTE — pass an explicit thinking level (the caller-resolved axis, §9.2.9)
        const config = createBaseConfig('architect', role, 'high');

        // VERIFY: the MODEL comes from the role→tier mapping (UNCHANGED; PRD §9.2.3).
        // thinking is asserted separately (it equals the PASSED level, not the role).
        expect(config.model).toBe(model);
      }
    );

    it('should default role to research when omitted (balanced tier), composing the passed thinking', () => {
      // EXECUTE: omitting `role` exercises the default-param path; thinking is still required.
      const config = createBaseConfig('architect', undefined, 'high');

      // VERIFY: default 'research' → balanced tier (backward compat for the model axis); the
      // reasoning level is the PASSED 'high' (independent of the role, PRD §9.2.9).
      expect(config.model).toBe('zai/glm-5.2');
      expect(config.thinking).toBe('high');
    });

    it('should map each role to the correct tier ONLY in ROLE_CONFIG (thinking decoupled)', () => {
      // VERIFY: ROLE_CONFIG literal shape — tier ONLY (thinking was removed in P1.M1.T3.S1).
      // The reasoning level is no longer derived from the role.
      expect(ROLE_CONFIG.research).toEqual({ tier: 'balanced' });
      expect(ROLE_CONFIG.reasoning).toEqual({ tier: 'balanced' }); // NO thinking field
      expect(ROLE_CONFIG.implementation).toEqual({ tier: 'fast' });
    });

    it('should not carry a thinking field on any role in ROLE_CONFIG', () => {
      // VERIFY — the §9.2.9 decoupling: ROLE_CONFIG values have ONLY a `tier` key.
      for (const role of Object.keys(ROLE_CONFIG) as ModelRole[]) {
        expect(Object.keys(ROLE_CONFIG[role])).toEqual(['tier']);
      }
    });

    // --- Decoupling proof (PRD §9.2.9 "two independent axes") ---
    // The role (tier) and the thinking level are INDEPENDENT: a role can run a strong model with
    // reasoning off, or a fast model with reasoning on. `createBaseConfig` composes the PASSED
    // thinking verbatim, independent of the role/tier.

    it('decouples thinking from role: a reasoning role can run with thinking off (PRD §9.2.9)', () => {
      // EXECUTE — reasoning role (balanced tier) with thinking OFF
      const config = createBaseConfig('architect', 'reasoning', 'off');

      // VERIFY: model from the role→tier mapping (UNCHANGED); thinking is the PASSED level, NOT xhigh
      expect(config.model).toBe('zai/glm-5.2'); // reasoning role → balanced tier
      expect(config.thinking).toBe('off'); // …but thinking is the PASSED level (decoupled)
    });

    it('decouples thinking from role: an implementation role can run with thinking xhigh', () => {
      // EXECUTE — implementation role (fast tier) with thinking XHIGH
      const config = createBaseConfig('coder', 'implementation', 'xhigh');

      // VERIFY: model from the role→tier mapping (UNCHANGED); thinking is the PASSED level
      expect(config.model).toBe('zai/glm-5-turbo'); // impl role → fast tier
      expect(config.thinking).toBe('xhigh'); // …but thinking is the PASSED level (decoupled)
    });

    it('composes the passed thinking verbatim across all reasoning levels (§9.2.9 vocabulary)', () => {
      // VERIFY — for every level in the reconciled vocabulary, createBaseConfig returns it verbatim.
      for (const level of REASONING_LEVELS) {
        expect(createBaseConfig('researcher', 'research', level).thinking).toBe(
          level
        );
      }
    });
  });

  describe('MCP_TOOLS', () => {
    it('should export MCPServer-compliant objects with name, transport, and tools', () => {
      // VERIFY: Each MCP tool has required MCPServer interface properties
      // This prevents the "MCP server 'undefined' is already registered" bug
      expect(MCP_TOOLS).toHaveLength(3);

      for (const mcp of MCP_TOOLS) {
        expect(mcp).toHaveProperty('name');
        expect(mcp).toHaveProperty('transport');
        expect(mcp).toHaveProperty('tools');
        expect(typeof mcp.name).toBe('string');
        expect(mcp.name).not.toBe('undefined');
        expect(mcp.name.length).toBeGreaterThan(0);
        expect(mcp.transport).toBe('inprocess');
        expect(Array.isArray(mcp.tools)).toBe(true);
      }
    });

    it('should have distinct server names for each MCP tool', () => {
      const names = MCP_TOOLS.map(mcp => mcp.name);

      // VERIFY: No duplicate names
      expect(new Set(names).size).toBe(names.length);

      // VERIFY: Expected names
      expect(names).toContain('bash');
      expect(names).toContain('filesystem');
      expect(names).toContain('git');
    });
  });

  describe('agent creation functions', () => {
    beforeEach(() => {
      vi.stubEnv('ANTHROPIC_API_KEY', 'test-token');
      vi.stubEnv('ANTHROPIC_BASE_URL', 'https://api.test.com');
    });

    it('should create multiple agents without MCP server registration conflicts', () => {
      // REGRESSION TEST: This tests the fix for "MCP server 'undefined' is already registered"
      // The bug occurred because MCPHandler instances didn't expose name/transport/tools properties
      // causing mcp.name to be undefined when Agent tried to register them

      // EXECUTE: Create multiple agents using the same singleton MCP_TOOLS
      // This should NOT throw "MCP server 'undefined' is already registered"
      expect(() => {
        createArchitectAgent();
        createResearcherAgent();
        createCoderAgent();
        createQAAgent();
      }).not.toThrow();
    });

    it('should create architect agent successfully', () => {
      const agent = createArchitectAgent();
      expect(agent).toBeDefined();
      expect(agent.name).toBe('ArchitectAgent');
    });

    it('should create researcher agent successfully', () => {
      const agent = createResearcherAgent();
      expect(agent).toBeDefined();
      expect(agent.name).toBe('ResearcherAgent');
    });

    it('should create coder agent successfully', () => {
      const agent = createCoderAgent();
      expect(agent).toBeDefined();
      expect(agent.name).toBe('CoderAgent');
    });

    it('should create QA agent successfully', () => {
      const agent = createQAAgent();
      expect(agent).toBeDefined();
      expect(agent.name).toBe('QaAgent');
    });
  });
});

describe('ThinkingLevel reconciliation (PRD §9.2.9 / P1.M1.T1.S3)', () => {
  it('aliases ReasoningLevel — minimal present, max absent (runtime vocabulary)', () => {
    // ThinkingLevel is a pure type alias (no runtime value), so verify via REASONING_LEVELS — the
    // `as const` array backing ReasoningLevel, which ThinkingLevel now aliases.
    expect(REASONING_LEVELS).toContain('minimal');
    expect(REASONING_LEVELS).not.toContain('max');
    expect([...REASONING_LEVELS]).toEqual([
      'off',
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
    ]);
  });

  it('ThinkingLevel === ReasoningLevel (type-level)', () => {
    // Enforced by `vitest typecheck` (the canonical "same type" proof).
    expectTypeOf<ThinkingLevel>().toEqualTypeOf<ReasoningLevel>();
    // Compile-time guard: 'max' is no longer assignable. Inert under the default `vitest run` gate
    // (build tsc excludes tests); trips "Unused @ts-expect-error" if 'max' is ever re-added.
    // @ts-expect-error 'max' was dropped from the reconciled vocabulary
    const _rejectedMax: ThinkingLevel = 'max';
    void _rejectedMax;
  });
});
