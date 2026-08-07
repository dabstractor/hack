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
import {
  buildCommitMessageSystemPrompt,
  createCommitMessageAgent,
} from '../../../src/agents/commit-message-agent.js';

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

    it('should use a supplied systemPrompt when provided (dynamic prompt passthrough)', () => {
      // EXECUTE — pass an explicit custom system prompt (the style-resolved
      // prompt produced by buildCommitMessageSystemPrompt in P1.M1.T3.S1).
      createCommitMessageAgent('CUSTOM PLAIN CONTRACT TEXT');

      // VERIFY — the supplied prompt flows into the agent's `system:` field
      // verbatim, overriding the default plain contract.
      const cfg = mockCreateAgent.mock.calls.at(-1)![0] as { system: string };
      expect(cfg.system).toBe('CUSTOM PLAIN CONTRACT TEXT');
    });

    it('should default to the plain COMMIT_MESSAGE_SYSTEM when no prompt is supplied', () => {
      // EXECUTE — no-arg call (existing behavior, unchanged).
      createCommitMessageAgent();

      // VERIFY — the `??` default branch falls back to the plain contract
      // (COMMIT_MESSAGE_SYSTEM), byte-for-byte identical to today. Robust
      // substrings of COMMIT_MESSAGE_SYSTEM confirm the default path.
      const cfg = mockCreateAgent.mock.calls.at(-1)![0] as { system: string };
      expect(cfg.system).toContain('imperative');
      expect(cfg.system).toContain('HARD RULES');
    });
  });

  describe('buildCommitMessageSystemPrompt', () => {
    it('plain mode returns the plain contract verbatim (imperative, ≤72, forbids type prefix)', () => {
      // EXECUTE
      const prompt = buildCommitMessageSystemPrompt('plain');

      // VERIFY — the plain contract: imperative mood, ≤72 char subject, and the
      // prohibition on a Conventional-Commit type prefix / (scope) / work-item id.
      expect(prompt).toContain('imperative');
      expect(prompt).toMatch(/≤72/);
      expect(prompt).toMatch(/Do NOT add a Conventional-Commit type prefix/i);
    });

    it('plain mode is byte-for-byte identical to the plain contract returned by the agent factory', () => {
      // EXECUTE — capture the factory's system prompt and compare verbatim.
      createCommitMessageAgent();
      const factorySystem = mockCreateAgent.mock.calls[0][0] as {
        system: string;
      };

      // VERIFY — buildCommitMessageSystemPrompt('plain') returns the exact same
      // string the (unchanged) factory uses as its system prompt.
      expect(buildCommitMessageSystemPrompt('plain')).toBe(
        factorySystem.system
      );
    });

    it('conventional mode returns a type(scope): description contract with all 11 types + discipline', () => {
      // EXECUTE
      const prompt = buildCommitMessageSystemPrompt('conventional');

      // VERIFY — Conventional Commits form + the standard 11-type vocabulary.
      expect(prompt).toContain('type(scope): description');
      // All 11 types present.
      for (const type of [
        'feat',
        'fix',
        'docs',
        'style',
        'refactor',
        'perf',
        'test',
        'build',
        'ci',
        'chore',
        'revert',
      ]) {
        expect(prompt).toContain(type);
      }
      // ~50-char imperative description guidance.
      expect(prompt).toMatch(/~50/);
      expect(prompt).toContain('imperative');
      // Output discipline (shared) — forbids position prefix / [PRP Auto] /
      // Co-Authored-By trailer (the caller layers those).
      expect(prompt).toMatch(/position prefix/i);
      expect(prompt).toContain('[PRP Auto]');
      expect(prompt).toContain('Co-Authored-By');
    });

    it('gitmoji mode instructs exactly ONE emoji character (not :shortcode:) + embeds the table + discipline', () => {
      // EXECUTE
      const prompt = buildCommitMessageSystemPrompt('gitmoji');

      // VERIFY — exactly ONE emoji character + space + description.
      expect(prompt).toMatch(/EXACTLY ONE .* emoji/i);
      // MUST instruct the emoji CHARACTER, NOT a :shortcode:.
      expect(prompt).toMatch(/not a ":shortcode:"/i);
      expect(prompt).not.toMatch(/emit a :shortcode:/i);
      // The full reference table is embedded (spot-check several entries).
      expect(prompt).toContain('✨');
      expect(prompt).toContain('🐛');
      expect(prompt).toContain('♻️');
      expect(prompt).toContain('🔥');
      // Output discipline.
      expect(prompt).toMatch(/position prefix/i);
      expect(prompt).toContain('Co-Authored-By');
    });

    it('gitmoji mode embeds the full canonical 72-entry table', () => {
      // EXECUTE
      const prompt = buildCommitMessageSystemPrompt('gitmoji');

      // VERIFY — the reference table header + a broad sample of entries spanning
      // the whole table (not just the first few). Confirms it is the full
      // compiled-in set, not a truncated/runtime-fetched subset.
      expect(prompt).toMatch(/GITMOJI REFERENCE TABLE/i);
      const sampled = [
        '🎨',
        '🚀',
        '🔒',
        '♻️',
        '🌐',
        '📦️',
        '♿️',
        '🏷️',
        '🩹',
        '🦺',
      ];
      for (const emoji of sampled) {
        expect(prompt).toContain(emoji);
      }
    });

    it('auto mode with >1 examples lists them verbatim (trimmed) + anti-reuse + ignore-position-prefix + discipline', () => {
      // SETUP — two example messages, one carrying a leading position prefix
      // (which the agent must IGNORE, not imitate) and one without.
      const examples = [
        '1.2.1.1: feat(api): add endpoint',
        'fix(ui): tighten padding  ', // trailing whitespace — must be trimmed
      ];

      // EXECUTE
      const prompt = buildCommitMessageSystemPrompt('auto', examples);

      // VERIFY — BOTH examples appear VERBATIM (trimmed of leading/trailing
      // whitespace only) as a STYLE reference. The position prefix is part of
      // the example text, so it is preserved in the listing verbatim; the
      // *instruction* (asserted below) tells the agent to ignore it when
      // imitating style. Trailing whitespace on example 2 is trimmed.
      expect(prompt).toContain('1. 1.2.1.1: feat(api): add endpoint');
      expect(prompt).toContain('2. fix(ui): tighten padding');
      // Anti-reuse instruction (advisory, not a hard gate).
      expect(prompt).toMatch(/NEVER copy/i);
      expect(prompt).toMatch(/ORIGINAL/i);
      // Ignore-position-prefix instruction (with the canonical example prefix).
      expect(prompt).toMatch(/IGNORE.*position prefix|1\.2\.1\.1/i);
      // Output discipline.
      expect(prompt).toMatch(/position prefix/i);
      expect(prompt).toContain('Co-Authored-By');
    });

    it('auto mode degrades to the plain contract when examples is undefined', () => {
      // EXECUTE + VERIFY — undefined → degrade to plain (PRD §5.1 "≤1 commit").
      expect(buildCommitMessageSystemPrompt('auto')).toBe(
        buildCommitMessageSystemPrompt('plain')
      );
    });

    it('auto mode degrades to the plain contract when examples is empty', () => {
      // EXECUTE + VERIFY — [] → degrade to plain.
      expect(buildCommitMessageSystemPrompt('auto', [])).toBe(
        buildCommitMessageSystemPrompt('plain')
      );
    });

    it('auto mode degrades to the plain contract with a SINGLE example (≤1 threshold, not ===0)', () => {
      // EXECUTE + VERIFY — a single example ALSO degrades (PRD §5.1 says "≤1
      // commit", NOT length === 0).
      expect(buildCommitMessageSystemPrompt('auto', ['only one example'])).toBe(
        buildCommitMessageSystemPrompt('plain')
      );
    });

    it('conventional mode ignores the examples argument (explicit modes omit history)', () => {
      // EXECUTE + VERIFY — passing examples does NOT change the conventional
      // contract (PRD §5.1: explicit modes omit history examples entirely).
      expect(
        buildCommitMessageSystemPrompt('conventional', [
          'feat(old): irrelevant history',
          'fix(old): more history',
        ])
      ).toBe(buildCommitMessageSystemPrompt('conventional'));
    });

    it('gitmoji mode ignores the examples argument (explicit modes omit history)', () => {
      // EXECUTE + VERIFY — passing examples does NOT change the gitmoji contract.
      expect(
        buildCommitMessageSystemPrompt('gitmoji', [
          '✨ old history',
          '🐛 old history',
        ])
      ).toBe(buildCommitMessageSystemPrompt('gitmoji'));
    });

    it('plain mode ignores the examples argument (explicit modes omit history)', () => {
      // EXECUTE + VERIFY — passing examples does NOT change the plain contract.
      expect(
        buildCommitMessageSystemPrompt('plain', [
          'old history one',
          'old history two',
        ])
      ).toBe(buildCommitMessageSystemPrompt('plain'));
    });
  });
});
