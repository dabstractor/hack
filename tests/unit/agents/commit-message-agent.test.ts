/**
 * Unit tests for the stagecoach commit-message-generation agent factory
 *
 * @remarks
 * Asserts the factory (PRP P3.M1.T3.S1) reuses `createBaseConfig` (persona
 * `'researcher'`, role `'research'` — NO `AgentPersona` union expansion) and
 * overrides `name`/`system`/`maxTokens`/`enableReflection`/`enableCache` while
 * carrying NO MCP tools. `createBaseConfig` and `createAgent` are mocked so the
 * test does not require real harness/env resolution.
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { describe, expect, it, vi } from 'vitest';

// Mock createBaseConfig so the factory does not require real harness/env
// resolution. Returns a known fixture the test can override-check against.
vi.mock('../../../src/agents/agent-factory.js', () => ({
  createBaseConfig: vi.fn(() => ({
    name: 'ResearcherAgent',
    model: 'zai/glm-5.2',
    harness: 'pi',
    enableCache: true,
    enableReflection: true,
    maxTokens: 4096,
    system: 'placeholder',
    env: { ANTHROPIC_API_KEY: '', ANTHROPIC_BASE_URL: '' },
  })),
}));

// Mock groundswell's createAgent to capture the config object passed in, so the
// test can assert the D1 overrides (maxTokens/enableReflection/enableCache/name)
// without instantiating a real agent.
vi.mock('groundswell', () => ({
  createAgent: vi.fn((cfg: unknown) => ({ __cfg: cfg })),
}));

import { createAgent } from 'groundswell';
import { createBaseConfig } from '../../../src/agents/agent-factory.js';
import { createCommitMessageAgent } from '../../../src/agents/commit-message-agent.js';

const mockCreateAgent = vi.mocked(createAgent);
const mockCreateBaseConfig = vi.mocked(createBaseConfig);

describe('agents/commit-message-agent', () => {
  describe('createCommitMessageAgent', () => {
    it('should reuse createBaseConfig with researcher persona + research role', () => {
      // EXECUTE
      createCommitMessageAgent();

      // VERIFY — NO expansion of the AgentPersona union (D1)
      expect(mockCreateBaseConfig).toHaveBeenCalledWith(
        'researcher',
        'research'
      );
    });

    it('should return an Agent produced by createAgent', () => {
      // EXECUTE
      const agent = createCommitMessageAgent();

      // VERIFY
      expect(mockCreateAgent).toHaveBeenCalledTimes(1);
      expect(agent).toBeDefined();
    });

    it('should override name to "CommitMessageAgent"', () => {
      // EXECUTE
      createCommitMessageAgent();

      // VERIFY
      const cfg = mockCreateAgent.mock.calls[0][0] as { name: string };
      expect(cfg.name).toBe('CommitMessageAgent');
    });

    it('should override maxTokens to 512', () => {
      // EXECUTE
      createCommitMessageAgent();

      // VERIFY
      const cfg = mockCreateAgent.mock.calls[0][0] as { maxTokens: number };
      expect(cfg.maxTokens).toBe(512);
    });

    it('should disable reflection (single-shot generation)', () => {
      // EXECUTE
      createCommitMessageAgent();

      // VERIFY
      const cfg = mockCreateAgent.mock.calls[0][0] as {
        enableReflection: boolean;
      };
      expect(cfg.enableReflection).toBe(false);
    });

    it('should disable cache (diffs are unique)', () => {
      // EXECUTE
      createCommitMessageAgent();

      // VERIFY
      const cfg = mockCreateAgent.mock.calls[0][0] as {
        enableCache: boolean;
      };
      expect(cfg.enableCache).toBe(false);
    });

    it('should carry NO MCP tools (reads diff from prompt)', () => {
      // EXECUTE
      createCommitMessageAgent();

      // VERIFY — the agent spreads baseConfig (which has no mcps) and adds no
      // mcps field of its own.
      const cfg = mockCreateAgent.mock.calls[0][0] as { mcps?: unknown };
      expect(cfg.mcps).toBeUndefined();
    });

    it('should mark itself stateless (single-shot, PRD §9.3.2)', () => {
      // EXECUTE
      createCommitMessageAgent();

      // VERIFY — override forces stateless:true over the researcher base
      // (researcher is NOT in STATELESS_PERSONAS). P3.M2.T3.S1.
      const cfg = mockCreateAgent.mock.calls[0][0] as { stateless: boolean };
      expect(cfg.stateless).toBe(true);
    });

    it('should set a system prompt instructing a plain descriptive imperative summary', () => {
      // EXECUTE
      createCommitMessageAgent();

      // VERIFY — the system prompt locks the agent to a bare plain descriptive
      // imperative summary (the caller layers the task-prefix + trailer via
      // formatCommitMessage; PRD §5.1 forbids Conventional-Commit type/scope).
      const cfg = mockCreateAgent.mock.calls[0][0] as { system: string };
      // MUST NOT mandate a Conventional-Commit type/scope (PRD §5.1 forbids it;
      // the task-prefix carries the item's position). The explicit "Do NOT add
      // a Conventional-Commit type prefix" prohibition is allowed; the mandate
      // form ("Follow Conventional Commits" / "Type prefix: feat, fix, ..." list)
      // must be gone.
      expect(cfg.system).not.toMatch(/Follow Conventional Commits/i);
      expect(cfg.system).not.toMatch(/^\s*-\s*Type prefix:\s*feat/i);
      // MUST NOT instruct referencing a work-item id in the subject (the
      // task-prefix already encodes position). The explicit "Do NOT reference
      // any work-item id ... in the subject" prohibition is allowed; the old
      // mandate form ("If a work-item id appears in changed paths ... reference
      // it in the subject") must be gone.
      expect(cfg.system).not.toMatch(/work-item id appears in changed paths/i);
      // STILL requires an imperative summary.
      expect(cfg.system).toContain('imperative');
      // STILL forbids the agent emitting [PRP Auto]/Co-Authored-By (caller adds
      // the trailer).
      expect(cfg.system).toContain('[PRP Auto]');
      expect(cfg.system).toContain('Co-Authored-By');
    });

    it('should preserve the balanced-tier model from createBaseConfig', () => {
      // EXECUTE
      createCommitMessageAgent();

      // VERIFY — the override spreads baseConfig, so model/harness/env come
      // from createBaseConfig('researcher', 'research') untouched.
      const cfg = mockCreateAgent.mock.calls[0][0] as {
        model: string;
        harness: string;
        env: unknown;
      };
      expect(cfg.model).toBe('zai/glm-5.2');
      expect(cfg.harness).toBe('pi');
      expect(cfg.env).toBeDefined();
    });
  });
});
