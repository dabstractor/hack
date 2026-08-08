/**
 * Unit tests for the cleanup agent persona factory (PRP P3.M1.T3.S3).
 *
 * @remarks
 * Asserts the factory (1) expands the `AgentPersona` union with `'cleanup'`,
 * (2) calls `createBaseConfig('cleanup', 'implementation')` (fast tier per PRD
 * §9.2.3), (3) sets `system === CLEANUP_PROMPT`, (4) carries `MCP_TOOLS`
 * (cleanup mutates the filesystem — the key divergence from the tool-less
 * commit-message-agent), and (5) disables reflection + cache (stateless
 * single-shot per PRD §9.3.3).
 *
 * Mocking strategy: unlike `commit-message-agent` (a thin factory in its OWN
 * module, so its test can mock `createBaseConfig` alone), `createCleanupAgent`
 * lives IN `agent-factory.ts` next to `createBaseConfig`. A partial mock cannot
 * spy on the internal same-module call. Instead, this test lets the REAL
 * `createCleanupAgent` + `createBaseConfig` run end-to-end, stubbing only the
 * layers they touch that have side effects: `groundswell.createAgent` (capture
 * the config) and the config modules (`environment.js` / `harness.js` — no real
 * env/harness resolution). This exercises the factory's ACTUAL spread/override
 * logic, so a regression (e.g. forgetting `mcps`) fails the test.
 *
 * The REAL `CLEANUP_PROMPT` is imported (prompts.ts is NOT mocked) so
 * `cfg.system === CLEANUP_PROMPT` ties the factory to the actual prompt.
 *
 * @see {@link ../../src/agents/agent-factory.ts}
 * @see {@link ./commit-message-agent.test.ts} — the sibling factory test.
 */

import { describe, expect, it, vi } from 'vitest';

// Stub the config layer so createBaseConfig does not require real env/harness
// resolution. getModel returns the fast-tier model; provider/key resolution
// returns harmless stubs; configureHarness returns a stub harness id.
vi.mock('../../../src/config/environment.js', () => ({
  configureEnvironment: vi.fn(() => undefined),
  getModel: vi.fn((tier: string) =>
    tier === 'fast' ? 'zai/glm-5-turbo' : 'zai/glm-5.2'
  ),
  getResolvedProvider: vi.fn(() => 'anthropic'),
}));
vi.mock('../../../src/config/harness.js', () => ({
  configureHarness: vi.fn(() => 'pi'),
  resolveApiKeyForProvider: vi.fn(() => 'stub-key'),
}));

// Mock groundswell: pass through all real exports (MCPHandler, MCPServer, etc.
// — needed by the real agent-factory.ts MCP tool imports) but override
// createAgent to capture the config object, so the test can assert the factory
// overrides (system/mcps/enableReflection/enableCache) without instantiating a
// real agent.
vi.mock('groundswell', async importOriginal => {
  const actual = await importOriginal<typeof import('groundswell')>();
  return {
    ...actual,
    createAgent: vi.fn((cfg: unknown) => ({ __cfg: cfg })),
  };
});

import { createAgent } from 'groundswell';
import { createCleanupAgent } from '../../../src/agents/agent-factory.js';
// REAL prompt constant — do NOT mock prompts.ts so cfg.system ties to the truth.
import { CLEANUP_PROMPT } from '../../../src/agents/prompts.js';

const mockCreateAgent = vi.mocked(createAgent);

describe('agents/cleanup-agent', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('createCleanupAgent', () => {
    it('should call createAgent exactly once', () => {
      // EXECUTE
      createCleanupAgent();

      // VERIFY — the real factory (no partial mock) delegates to createAgent.
      expect(mockCreateAgent).toHaveBeenCalledTimes(1);
    });

    it('should return an Agent produced by createAgent', () => {
      // EXECUTE
      const agent = createCleanupAgent();

      // VERIFY
      expect(agent).toBeDefined();
    });

    it('should derive name "CleanupAgent" (from persona "cleanup")', () => {
      // EXECUTE
      createCleanupAgent();

      // VERIFY — createBaseConfig('cleanup') derives 'CleanupAgent' (capitalized
      // first letter + 'Agent'); the factory does NOT override name.
      const cfg = mockCreateAgent.mock.calls[0][0] as { name: string };
      expect(cfg.name).toBe('CleanupAgent');
    });

    it('should set system to the REAL CLEANUP_PROMPT', () => {
      // EXECUTE
      createCleanupAgent();

      // VERIFY — ties the factory to the actual exported prompt constant.
      const cfg = mockCreateAgent.mock.calls[0][0] as { system: string };
      expect(cfg.system).toBe(CLEANUP_PROMPT);
    });

    it('should carry MCP_TOOLS (cleanup mutates the filesystem)', () => {
      // EXECUTE
      createCleanupAgent();

      // VERIFY — KEY divergence from commit-message-agent (which omits mcps).
      // Cleanup moves docs + removes temp artifacts, so it needs file/bash/git
      // tools. Asserting a populated array catches a forgotten-mcps regression.
      const cfg = mockCreateAgent.mock.calls[0][0] as { mcps?: unknown };
      expect(cfg.mcps).toBeDefined();
      expect(Array.isArray(cfg.mcps)).toBe(true);
      expect((cfg.mcps as unknown[]).length).toBe(3);
    });

    it('should disable reflection (stateless single-shot)', () => {
      // EXECUTE
      createCleanupAgent();

      // VERIFY — overrides baseConfig's true. PRD §9.3.3.
      const cfg = mockCreateAgent.mock.calls[0][0] as {
        enableReflection: boolean;
      };
      expect(cfg.enableReflection).toBe(false);
    });

    it('should disable cache (stateless single-shot)', () => {
      // EXECUTE
      createCleanupAgent();

      // VERIFY — overrides baseConfig's true. PRD §9.3.3.
      const cfg = mockCreateAgent.mock.calls[0][0] as { enableCache: boolean };
      expect(cfg.enableCache).toBe(false);
    });

    it('should use the fast-tier model via the implementation role (maxTokens 4096)', () => {
      // EXECUTE
      createCleanupAgent();

      // VERIFY — createBaseConfig('cleanup', 'implementation') resolves tier
      // 'fast' → getModel('fast') → 'zai/glm-5-turbo'; maxTokens comes from
      // PERSONA_TOKEN_LIMITS.cleanup === 4096.
      const cfg = mockCreateAgent.mock.calls[0][0] as {
        model: string;
        harness: string;
        env: unknown;
        maxTokens: number;
      };
      expect(cfg.model).toBe('zai/glm-5-turbo');
      expect(cfg.harness).toBe('pi');
      expect(cfg.env).toBeDefined();
      expect(cfg.maxTokens).toBe(4096);
    });

    it('should HARDCODE thinking off — NOT coupled to PRP_REASONING_IMPL_AGENT (PRD §9.2.9)', () => {
      // SETUP — set the impl reasoning knob high; if cleanup were coupled to
      // getReasoningImpl(), thinking would become 'high'.
      vi.stubEnv('PRP_REASONING_IMPL_AGENT', 'high');
      mockCreateAgent.mockClear();

      // EXECUTE
      createCleanupAgent();

      // VERIFY — thinking stays 'off' (literal hardcode), and the fast-tier
      // model is unchanged. Cleanup is a mechanical reorg, immune to the impl
      // reasoning env knob.
      const cfg = mockCreateAgent.mock.calls[0][0] as {
        thinking: string;
        model: string;
      };
      expect(cfg.thinking).toBe('off');
      expect(cfg.model).toBe('zai/glm-5-turbo');
    });
  });

  describe('CLEANUP_PROMPT content', () => {
    // Behavioral verification of the prompt itself (PRP Level 4): the job
    // coverage + the PRD §5.1 prompt-layer deletion-protection rules.

    it('should instruct the cleanup job: move docs to docs/, save tasks.json, remove temp', () => {
      expect(CLEANUP_PROMPT).toContain('docs/');
      expect(CLEANUP_PROMPT).toContain('tasks.json');
      expect(CLEANUP_PROMPT).toMatch(/remov|scratch|temp/i);
    });

    it('should name the protected path plan/', () => {
      expect(CLEANUP_PROMPT).toContain('plan/');
    });

    it('should forbid rm / git rm / git clean / mv (PRD §5.1 deletion protection)', () => {
      expect(CLEANUP_PROMPT).toContain('rm');
      expect(CLEANUP_PROMPT).toContain('git rm');
      expect(CLEANUP_PROMPT).toContain('git clean');
      expect(CLEANUP_PROMPT).toContain('mv');
    });

    it('should name the protected files PRD.md and PRP.md', () => {
      expect(CLEANUP_PROMPT).toContain('PRD.md');
      expect(CLEANUP_PROMPT).toContain('PRP.md');
    });

    it('should forbid git commit / git add (no self-commit — stagecoach commits)', () => {
      expect(CLEANUP_PROMPT).toContain('git commit');
      expect(CLEANUP_PROMPT).toContain('git add');
    });
  });
});
