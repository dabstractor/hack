/**
 * Unit tests for the Change / Artifact LLM classifiers (PRD §4.3).
 *
 * @remarks
 * Tests validate `classifyChange` and `classifyArtifact` from
 * `src/core/change-classifier.ts` with comprehensive coverage. Tests follow the
 * Strategy-A mock pattern (see `tests/unit/workflows/delta-analysis-workflow.test.ts`)
 * and the GIVEN / SHOULD + SETUP / EXECUTE / VERIFY style.
 *
 * P4.M1.T1.S1 vs S2 scope boundary: S1 is the inner LLM call. It MUST throw a
 * transient `AgentError` (code `PIPELINE_AGENT_LLM_FAILED`) on any non-success /
 * empty / enum-invalid model output — that throw is the boundary the S2 retry layer
 * wraps. These tests assert that boundary directly.
 *
 * @see {@link https://vitest.dev/ | Vitest Documentation}
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { DiffSummary } from '../../../src/core/prd-differ.js';

// Mock agent factory (Strategy A — the workflow pattern).
vi.mock('../../../src/agents/agent-factory.js', () => ({
  createQAAgent: vi.fn(),
}));

// Mock the prompt generators so the test controls the Prompt<T> threaded into the
// agent and can assert the DiffSummary / content is passed verbatim.
vi.mock('../../../src/agents/prompts/change-classifier-prompt.js', () => ({
  createChangeClassificationPrompt: vi.fn(),
  createArtifactClassificationPrompt: vi.fn(),
}));

// Import the system under test + the mocked modules.
import {
  classifyChange,
  classifyArtifact,
} from '../../../src/core/change-classifier.js';
import { createQAAgent } from '../../../src/agents/agent-factory.js';
import {
  createChangeClassificationPrompt,
  createArtifactClassificationPrompt,
} from '../../../src/agents/prompts/change-classifier-prompt.js';
import { CHANGE_CLASSIFIER_PROMPT } from '../../../src/agents/prompts.js';
import { isAgentError } from '../../../src/utils/errors.js';
import {
  ChangeClassificationSchema,
  ArtifactClassificationSchema,
} from '../../../src/core/change-classifier.js';

// Cast mocked functions.
const mockCreateQAAgent = createQAAgent as any;
const mockCreateChangeClassificationPrompt =
  createChangeClassificationPrompt as any;
const mockCreateArtifactClassificationPrompt =
  createArtifactClassificationPrompt as any;

/**
 * Build a DiffSummary fixture (prd-differ.test.ts style — inline literal, all
 * readonly fields).
 */
function createDiffFixture(): DiffSummary {
  return {
    changes: [
      {
        type: 'added',
        sectionTitle: 'Performance',
        lineNumber: 42,
        newContent: 'Response time must be < 200ms p99.',
        impact: 'high',
      },
      {
        type: 'modified',
        sectionTitle: 'Auth',
        lineNumber: 80,
        oldContent: 'Implement login.',
        newContent: 'Implement login with OAuth2.',
        impact: 'medium',
      },
    ],
    summaryText: '1 section added, 1 modified',
    stats: {
      totalAdded: 1,
      totalModified: 1,
      totalRemoved: 0,
      sectionsAffected: ['Performance', 'Auth'],
    },
  };
}

/**
 * Configure the mock QA agent's prompt() to resolve with the given AgentResponse.
 */
function mockAgentResponse(response: Record<string, unknown>): void {
  mockCreateQAAgent.mockReturnValue({
    prompt: vi.fn().mockResolvedValue(response),
  });
}

describe('change-classifier (PRD §4.3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: prompt generators return a sentinel object (the real Prompt<T> is
    // opaque to the classifier — it just threads it into agent.prompt()).
    mockCreateChangeClassificationPrompt.mockReturnValue({
      __prompt: 'change',
    });
    mockCreateArtifactClassificationPrompt.mockReturnValue({
      __prompt: 'artifact',
    });
  });

  describe('GIVEN classifyChange', () => {
    it('SHOULD return SUBSTANTIVE on a successful SUBSTANTIVE response', async () => {
      // SETUP
      const fixture = createDiffFixture();
      mockAgentResponse({
        status: 'success',
        data: 'SUBSTANTIVE',
        error: null,
        metadata: {},
      });

      // EXECUTE
      const result = await classifyChange(fixture);

      // VERIFY
      expect(result).toBe('SUBSTANTIVE');
      expect(mockCreateQAAgent).toHaveBeenCalledTimes(1);
      // The DiffSummary is threaded verbatim into the prompt generator (PRD §4.3
      // + item contract LOGIC (c): the classifier receives the structural diff).
      expect(mockCreateChangeClassificationPrompt).toHaveBeenCalledWith(
        fixture
      );
    });

    it('SHOULD return COSMETIC on a successful COSMETIC response', async () => {
      // SETUP
      const fixture = createDiffFixture();
      mockAgentResponse({
        status: 'success',
        data: 'COSMETIC',
        error: null,
        metadata: {},
      });

      // EXECUTE
      const result = await classifyChange(fixture);

      // VERIFY
      expect(result).toBe('COSMETIC');
    });

    it('SHOULD throw a transient AgentError on status:"error"', async () => {
      // SETUP
      const fixture = createDiffFixture();
      mockAgentResponse({
        status: 'error',
        data: null,
        error: {
          message: 'rate limited',
          code: 'RATE_LIMIT',
          recoverable: true,
        },
        metadata: {},
      });

      // EXECUTE + VERIFY
      await expect(classifyChange(fixture)).rejects.toThrow();
      try {
        await classifyChange(fixture);
        throw new Error('expected classifyChange to throw');
      } catch (err) {
        expect(isAgentError(err)).toBe(true);
        if (isAgentError(err)) {
          // code is HARDCODED to PIPELINE_AGENT_LLM_FAILED (transient — S2 boundary).
          expect(err.code).toBe('PIPELINE_AGENT_LLM_FAILED');
          // Message MUST avoid 'parse'/'parsing' (isTransientError treats those as permanent).
          expect(err.message.toLowerCase()).not.toContain('parse');
        }
      }
    });

    it('SHOULD throw a transient AgentError on status:"partial" (non-success)', async () => {
      // SETUP — mirror delta-analysis-workflow: only 'success' is usable.
      const fixture = createDiffFixture();
      mockAgentResponse({
        status: 'partial',
        data: 'COSMETIC',
        error: null,
        metadata: {},
      });

      // EXECUTE + VERIFY
      await expect(classifyChange(fixture)).rejects.toThrow();
    });

    it('SHOULD throw a transient AgentError on status:"success" with null data', async () => {
      // SETUP
      const fixture = createDiffFixture();
      mockAgentResponse({
        status: 'success',
        data: null,
        error: null,
        metadata: {},
      });

      // EXECUTE + VERIFY
      await expect(classifyChange(fixture)).rejects.toThrow();
      try {
        await classifyChange(fixture);
        throw new Error('expected classifyChange to throw');
      } catch (err) {
        expect(isAgentError(err)).toBe(true);
        if (isAgentError(err)) {
          expect(err.code).toBe('PIPELINE_AGENT_LLM_FAILED');
        }
      }
    });

    it('SHOULD call agent.prompt() BARE (no retry wrapper — S2 owns retry)', async () => {
      // SETUP
      const fixture = createDiffFixture();
      const mockPrompt = vi.fn().mockResolvedValue({
        status: 'success',
        data: 'COSMETIC',
        error: null,
        metadata: {},
      });
      mockCreateQAAgent.mockReturnValue({ prompt: mockPrompt });

      // EXECUTE
      await classifyChange(fixture);

      // VERIFY — the bare prompt() is invoked exactly once with the generated Prompt<T>.
      expect(mockPrompt).toHaveBeenCalledTimes(1);
      expect(mockPrompt).toHaveBeenCalledWith({ __prompt: 'change' });
    });
  });

  describe('GIVEN classifyArtifact', () => {
    it('SHOULD return CLEAN on a successful CLEAN response', async () => {
      // SETUP
      const content =
        '# Delta PRD\n\nWell-formed content with no contamination.';
      mockAgentResponse({
        status: 'success',
        data: 'CLEAN',
        error: null,
        metadata: {},
      });

      // EXECUTE
      const result = await classifyArtifact(content);

      // VERIFY
      expect(result).toBe('CLEAN');
      expect(mockCreateQAAgent).toHaveBeenCalledTimes(1);
      // The content is threaded verbatim into the prompt generator.
      expect(mockCreateArtifactClassificationPrompt).toHaveBeenCalledWith(
        content
      );
    });

    it('SHOULD return DIRTY on a successful DIRTY response', async () => {
      // SETUP
      const content = '# Delta PRD\n\n$ leaked shell transcript $';
      mockAgentResponse({
        status: 'success',
        data: 'DIRTY',
        error: null,
        metadata: {},
      });

      // EXECUTE
      const result = await classifyArtifact(content);

      // VERIFY
      expect(result).toBe('DIRTY');
    });

    it('SHOULD throw a transient AgentError on status:"error"', async () => {
      // SETUP
      const content = 'some artifact';
      mockAgentResponse({
        status: 'error',
        data: null,
        error: {
          message: 'model overloaded',
          code: 'OVERLOADED',
          recoverable: true,
        },
        metadata: {},
      });

      // EXECUTE + VERIFY
      await expect(classifyArtifact(content)).rejects.toThrow();
      try {
        await classifyArtifact(content);
        throw new Error('expected classifyArtifact to throw');
      } catch (err) {
        expect(isAgentError(err)).toBe(true);
        if (isAgentError(err)) {
          expect(err.code).toBe('PIPELINE_AGENT_LLM_FAILED');
          expect(err.message.toLowerCase()).not.toContain('parse');
        }
      }
    });

    it('SHOULD throw a transient AgentError on status:"success" with null data', async () => {
      // SETUP
      const content = 'some artifact';
      mockAgentResponse({
        status: 'success',
        data: null,
        error: null,
        metadata: {},
      });

      // EXECUTE + VERIFY
      await expect(classifyArtifact(content)).rejects.toThrow();
    });

    it('SHOULD throw BEFORE calling the agent on empty content (guard branch)', async () => {
      // SETUP — empty string
      // EXECUTE + VERIFY
      await expect(classifyArtifact('')).rejects.toThrow();
      // The guard short-circuits — the agent is never created.
      expect(mockCreateQAAgent).not.toHaveBeenCalled();
    });

    it('SHOULD throw BEFORE calling the agent on whitespace-only content (guard branch)', async () => {
      // SETUP — whitespace-only string
      // EXECUTE + VERIFY
      await expect(classifyArtifact('   \n\t  ')).rejects.toThrow();
      expect(mockCreateQAAgent).not.toHaveBeenCalled();
    });

    it('SHOULD call agent.prompt() BARE (no retry wrapper — S2 owns retry)', async () => {
      // SETUP
      const content = 'well-formed artifact';
      const mockPrompt = vi.fn().mockResolvedValue({
        status: 'success',
        data: 'CLEAN',
        error: null,
        metadata: {},
      });
      mockCreateQAAgent.mockReturnValue({ prompt: mockPrompt });

      // EXECUTE
      await classifyArtifact(content);

      // VERIFY — the bare prompt() is invoked exactly once with the generated Prompt<T>.
      expect(mockPrompt).toHaveBeenCalledTimes(1);
      expect(mockPrompt).toHaveBeenCalledWith({ __prompt: 'artifact' });
    });
  });

  describe('GIVEN prompt registration (two-layer convention)', () => {
    it('SHOULD expose the CHANGE_CLASSIFIER_PROMPT constant with the full label vocabulary', () => {
      // VERIFY — Layer A constant exists and locks the PRD §4.3 label vocabulary.
      expect(CHANGE_CLASSIFIER_PROMPT).toBeTruthy();
      expect(CHANGE_CLASSIFIER_PROMPT).toContain('COSMETIC');
      expect(CHANGE_CLASSIFIER_PROMPT).toContain('SUBSTANTIVE');
      expect(CHANGE_CLASSIFIER_PROMPT).toContain('CLEAN');
      expect(CHANGE_CLASSIFIER_PROMPT).toContain('DIRTY');
    });

    it('SHOULD register CHANGE_CLASSIFIER in the PROMPTS lookup + PromptKey type', async () => {
      // VERIFY — Layer A registration: the constant is keyed in the PROMPTS lookup.
      const { PROMPTS } = await import('../../../src/agents/prompts.js');
      expect(PROMPTS.CHANGE_CLASSIFIER).toBe(CHANGE_CLASSIFIER_PROMPT);
      // PromptKey is a compile-time type; verify the runtime key exists.
      expect('CHANGE_CLASSIFIER' in PROMPTS).toBe(true);
    });

    it('SHOULD export both prompt generators (Layer B barrel)', async () => {
      // VERIFY — Layer B barrel re-exports both generators.
      const barrel = await import('../../../src/agents/prompts/index.js');
      expect(typeof barrel.createChangeClassificationPrompt).toBe('function');
      expect(typeof barrel.createArtifactClassificationPrompt).toBe('function');
    });

    it('SHOULD export the Zod enum schemas that validate the model output', () => {
      // VERIFY — the schemas accept exactly the PRD §4.3 labels and reject others.
      expect(ChangeClassificationSchema.safeParse('COSMETIC').success).toBe(
        true
      );
      expect(ChangeClassificationSchema.safeParse('SUBSTANTIVE').success).toBe(
        true
      );
      expect(ChangeClassificationSchema.safeParse('CLEAN').success).toBe(false);
      expect(ArtifactClassificationSchema.safeParse('CLEAN').success).toBe(
        true
      );
      expect(ArtifactClassificationSchema.safeParse('DIRTY').success).toBe(
        true
      );
      expect(ArtifactClassificationSchema.safeParse('COSMETIC').success).toBe(
        false
      );
    });
  });
});
