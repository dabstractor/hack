/**
 * Unit tests for the resilient Change / Artifact classifier wrappers (PRD §4.3).
 *
 * @remarks
 * P4.M1.T1.S2 — the resilience layer. These tests validate
 * `classifyChangeWithRetry` and `classifyArtifactWithRetry` from
 * `src/core/change-classifier.ts`, which wrap S1's inner `classifyChange` /
 * `classifyArtifact` in a bounded `retry()` loop (default 4 attempts, configurable
 * via `CLASSIFIER_RETRY_MAX`) and fail to the protective/conservative default
 * (`'SUBSTANTIVE'` / `'DIRTY'`) on exhaustion.
 *
 * PRD §4.3: "These classifiers MUST distinguish transient API failures (empty
 * output, connection errors, rate limits, overloaded) from invalid model
 * responses, retrying up to a bounded count (default 4) before giving up. On
 * exhaustion they MUST fail to the protective/conservative default (treat as
 * SUBSTANTIVE / DIRTY) — never silently fall through to 'could not classify' and
 * proceed unprotected."
 *
 * Strategy-A mocking (see `tests/unit/agents/prp-executor.test.ts` for the retry
 * mock + `tests/unit/workflows/delta-analysis-workflow.test.ts` for the
 * agent-factory mock). GIVEN / SHOULD + SETUP / EXECUTE / VERIFY style.
 *
 * S1 vs S2 scope: S1 owns `change-classifier.test.ts` (the inner functions); this
 * file owns the `*WithRetry` wrappers only.
 *
 * @see {@link https://vitest.dev/ | Vitest Documentation}
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { DiffSummary } from '../../../src/core/prd-differ.js';

// Mock agent factory (Strategy A — the workflow pattern). The inner S1
// classifyChange/classifyArtifact call createQAAgent(); mocking it lets the test
// make the inner classifier succeed (success branch) — exhaustion is driven by
// the retry mock rejecting.
vi.mock('../../../src/agents/agent-factory.js', () => ({
  createQAAgent: vi.fn(),
}));

// Mock the prompt generators so S1's inner classifiers can run end-to-end against
// the mocked agent without needing a real prompt shape.
vi.mock('../../../src/agents/prompts/change-classifier-prompt.js', () => ({
  createChangeClassificationPrompt: vi.fn(),
  createArtifactClassificationPrompt: vi.fn(),
}));

// Mock retry.js (Strategy A — prp-executor.test.ts template). retry defaults to a
// pass-through (invokes the inner fn) so the success branch is exercised. Tests
// override mockRetry per-case to simulate exhaustion (always throws) or
// retry-then-success.
vi.mock('../../../src/utils/retry.js', () => ({
  retry: vi.fn(async (fn: () => Promise<unknown>) => fn()),
  createDefaultOnRetry: vi.fn(() => vi.fn()),
}));

// Mock the logger module so the protective-default warn-log can be asserted when
// S2's catch fires. S1's lazy `logger()` accessor caches `_logger` at module load,
// so getLogger must return a STABLE shared object (not a fresh one each call) —
// otherwise the cached `_logger` would diverge from the spy we inspect after
// vi.clearAllMocks(). The shared `mockLogger` persists; clearAllMocks only resets
// its call history, not the reference. vi.hoisted() ensures the shared mock is
// initialized BEFORE the vi.mock() factory runs (vi.mock is hoisted above all
// top-level const declarations).
const { mockLogger, mockLoggerWarn } = vi.hoisted(() => {
  const warn = vi.fn();
  return {
    mockLogger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: warn,
      error: vi.fn(),
    },
    mockLoggerWarn: warn,
  };
});
vi.mock('../../../src/utils/logger.js', () => ({
  getLogger: vi.fn(() => mockLogger),
}));

// NOTE: config/constants.js is NOT mocked — getClassifierRetryMax is pure and cheap
// to test by setting/restoring process.env[CLASSIFIER_RETRY_MAX].

// Import the system under test + the mocked modules. Imports run AFTER the
// vi.mock() calls above, so the mocked implementations are bound.
import {
  classifyChangeWithRetry,
  classifyArtifactWithRetry,
} from '../../../src/core/change-classifier.js';
import { retry, createDefaultOnRetry } from '../../../src/utils/retry.js';
import { createQAAgent } from '../../../src/agents/agent-factory.js';
import {
  CLASSIFIER_RETRY_MAX,
  DEFAULT_CLASSIFIER_RETRY_MAX,
  getClassifierRetryMax,
} from '../../../src/config/constants.js';

// Cast mocked functions.
const mockRetry = retry as unknown as ReturnType<typeof vi.fn>;
const mockCreateDefaultOnRetry = createDefaultOnRetry as unknown as ReturnType<
  typeof vi.fn
>;
const mockCreateQAAgent = createQAAgent as unknown as ReturnType<typeof vi.fn>;

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
    ],
    summaryText: '1 change: added Performance section.',
    stats: {
      totalAdded: 1,
      totalModified: 0,
      totalRemoved: 0,
      sectionsAffected: ['Performance'],
    },
  };
}

describe('classifyChangeWithRetry (PRD §4.3 resilience layer)', () => {
  let diffFixture: DiffSummary;

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: retry passes through (invokes the inner fn).
    mockRetry.mockImplementation(async (fn: () => Promise<unknown>) => fn());
    mockCreateDefaultOnRetry.mockReturnValue(vi.fn());
    diffFixture = createDiffFixture();
  });

  it('SHOULD return the inner classifyChange result on first-attempt success (SUBSTANTIVE)', async () => {
    // GIVEN the inner classifier resolves SUBSTANTIVE on the first attempt.
    mockCreateQAAgent.mockReturnValue({
      prompt: vi.fn().mockResolvedValue({
        status: 'success',
        data: 'SUBSTANTIVE',
        error: null,
        metadata: {},
      }),
    });

    // EXECUTE
    const result = await classifyChangeWithRetry(diffFixture);

    // VERIFY — protective value is returned, retry was threaded.
    expect(result).toBe('SUBSTANTIVE');
    expect(mockRetry).toHaveBeenCalledTimes(1);
  });

  it('SHOULD return COSMETIC on a successful trivial classification', async () => {
    // GIVEN the inner classifier resolves COSMETIC.
    mockCreateQAAgent.mockReturnValue({
      prompt: vi.fn().mockResolvedValue({
        status: 'success',
        data: 'COSMETIC',
        error: null,
        metadata: {},
      }),
    });

    // EXECUTE
    const result = await classifyChangeWithRetry(diffFixture);

    // VERIFY
    expect(result).toBe('COSMETIC');
  });

  it('SHOULD recover when a transient failure is followed by success (the retry layer is between the caller and the inner classifier)', async () => {
    // GIVEN a retry mock that simulates retry\'s real loop semantics: invoke the
    // passed fn up to maxAttempts times, re-throwing only when all attempts fail.
    // This proves the fn threaded into retry() is S1\'s classifyChange (the inner
    // classifier), and that a recovered verdict propagates out of
    // classifyChangeWithRetry. The options.maxAttempts is read from the call.
    mockRetry.mockImplementation(
      async (fn: () => Promise<unknown>, opts?: { maxAttempts?: number }) => {
        const max = opts?.maxAttempts ?? 3;
        let lastErr: unknown;
        for (let i = 0; i < max; i++) {
          try {
            return await fn();
          } catch (err) {
            lastErr = err;
          }
        }
        throw lastErr;
      }
    );
    // AND the inner classifier throws transiently once, then resolves SUBSTANTIVE
    // (i.e. retry\'s second attempt succeeds).
    const transientError = new Error('connection reset');
    const promptFn = vi.fn();
    promptFn.mockRejectedValueOnce(transientError).mockResolvedValueOnce({
      status: 'success',
      data: 'SUBSTANTIVE',
      error: null,
      metadata: {},
    });
    mockCreateQAAgent.mockReturnValue({ prompt: promptFn });

    // EXECUTE
    const result = await classifyChangeWithRetry(diffFixture);

    // VERIFY — the retry layer recovered and returned the successful verdict.
    expect(result).toBe('SUBSTANTIVE');
    expect(mockRetry).toHaveBeenCalledTimes(1);
    expect(promptFn).toHaveBeenCalledTimes(2); // inner classifier ran twice (retry recovered)
  });

  it('SHOULD fail to the protective default SUBSTANTIVE on exhaustion and warn', async () => {
    // GIVEN retry always rethrows (all attempts exhausted).
    const exhaustedError = new Error('rate limit exceeded');
    mockRetry.mockImplementation(async () => {
      throw exhaustedError;
    });

    // EXECUTE
    const result = await classifyChangeWithRetry(diffFixture);

    // VERIFY — protective default applied, never thrown, warn-log fired.
    expect(result).toBe('SUBSTANTIVE');
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ error: exhaustedError }),
      expect.stringContaining('protective default SUBSTANTIVE')
    );
  });

  it('SHOULD thread maxAttempts from getClassifierRetryMax() (default 4) and the onRetry factory into retry()', async () => {
    // GIVEN env var unset (default 4 applies).
    delete process.env[CLASSIFIER_RETRY_MAX];
    mockCreateQAAgent.mockReturnValue({
      prompt: vi.fn().mockResolvedValue({
        status: 'success',
        data: 'SUBSTANTIVE',
        error: null,
        metadata: {},
      }),
    });

    // EXECUTE
    await classifyChangeWithRetry(diffFixture);

    // VERIFY — retry() received the configurable maxAttempts + backoff + onRetry.
    expect(mockRetry).toHaveBeenCalledTimes(1);
    const options = mockRetry.mock.calls[0][1] as {
      maxAttempts: number;
      baseDelay: number;
      maxDelay: number;
      backoffFactor: number;
      onRetry: (...args: unknown[]) => void;
    };
    expect(options.maxAttempts).toBe(DEFAULT_CLASSIFIER_RETRY_MAX); // 4
    expect(options.baseDelay).toBe(1000);
    expect(options.maxDelay).toBe(30000);
    expect(options.backoffFactor).toBe(2);
    expect(typeof options.onRetry).toBe('function');
    // createDefaultOnRetry was called with the operation name + maxAttempts.
    expect(mockCreateDefaultOnRetry).toHaveBeenCalledWith(
      'ChangeClassifier.classifyChange',
      DEFAULT_CLASSIFIER_RETRY_MAX
    );
  });

  it('SHOULD honor a CLASSIFIER_RETRY_MAX env-var override for maxAttempts', async () => {
    // GIVEN env var overrides the default to 7.
    process.env[CLASSIFIER_RETRY_MAX] = '7';
    mockCreateQAAgent.mockReturnValue({
      prompt: vi.fn().mockResolvedValue({
        status: 'success',
        data: 'SUBSTANTIVE',
        error: null,
        metadata: {},
      }),
    });

    // EXECUTE
    await classifyChangeWithRetry(diffFixture);

    // VERIFY — maxAttempts threaded from the env override.
    const options = mockRetry.mock.calls[0][1] as { maxAttempts: number };
    expect(options.maxAttempts).toBe(7);
    expect(mockCreateDefaultOnRetry).toHaveBeenCalledWith(
      'ChangeClassifier.classifyChange',
      7
    );
  });

  it('SHOULD invoke the inner S1 classifyChange (the retry fn is () => classifyChange(diff))', async () => {
    // GIVEN the inner classifier resolves successfully.
    const promptFn = vi.fn().mockResolvedValue({
      status: 'success',
      data: 'SUBSTANTIVE',
      error: null,
      metadata: {},
    });
    mockCreateQAAgent.mockReturnValue({ prompt: promptFn });

    // EXECUTE
    await classifyChangeWithRetry(diffFixture);

    // VERIFY — the inner classifier ran (agent-factory was called + agent.prompt ran).
    expect(mockCreateQAAgent).toHaveBeenCalledTimes(1);
    expect(promptFn).toHaveBeenCalledTimes(1);
  });
});

describe('classifyArtifactWithRetry (PRD §4.3 resilience layer)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: retry passes through.
    mockRetry.mockImplementation(async (fn: () => Promise<unknown>) => fn());
    mockCreateDefaultOnRetry.mockReturnValue(vi.fn());
  });

  it('SHOULD return CLEAN on a successful well-formed classification', async () => {
    // GIVEN the inner classifier resolves CLEAN.
    mockCreateQAAgent.mockReturnValue({
      prompt: vi.fn().mockResolvedValue({
        status: 'success',
        data: 'CLEAN',
        error: null,
        metadata: {},
      }),
    });

    // EXECUTE
    const result = await classifyArtifactWithRetry(
      '# Delta PRD\nfaithful content'
    );

    // VERIFY
    expect(result).toBe('CLEAN');
  });

  it('SHOULD return DIRTY on a successful contaminated classification', async () => {
    // GIVEN the inner classifier resolves DIRTY.
    mockCreateQAAgent.mockReturnValue({
      prompt: vi.fn().mockResolvedValue({
        status: 'success',
        data: 'DIRTY',
        error: null,
        metadata: {},
      }),
    });

    // EXECUTE
    const result = await classifyArtifactWithRetry('hallucinated content');

    // VERIFY
    expect(result).toBe('DIRTY');
  });

  it('SHOULD fail to the protective default DIRTY on exhaustion and warn', async () => {
    // GIVEN retry always rethrows (all attempts exhausted).
    const exhaustedError = new Error('overloaded');
    mockRetry.mockImplementation(async () => {
      throw exhaustedError;
    });

    // EXECUTE
    const result = await classifyArtifactWithRetry('some artifact content');

    // VERIFY — protective default applied, never thrown, warn-log fired.
    expect(result).toBe('DIRTY');
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ error: exhaustedError }),
      expect.stringContaining('protective default DIRTY')
    );
  });

  it('SHOULD thread maxAttempts (default 4) + onRetry into retry() for the artifact classifier', async () => {
    // GIVEN env var unset (default 4 applies).
    delete process.env[CLASSIFIER_RETRY_MAX];
    mockCreateQAAgent.mockReturnValue({
      prompt: vi.fn().mockResolvedValue({
        status: 'success',
        data: 'CLEAN',
        error: null,
        metadata: {},
      }),
    });

    // EXECUTE
    await classifyArtifactWithRetry('artifact content');

    // VERIFY
    const options = mockRetry.mock.calls[0][1] as {
      maxAttempts: number;
      baseDelay: number;
      maxDelay: number;
      backoffFactor: number;
      onRetry: (...args: unknown[]) => void;
    };
    expect(options.maxAttempts).toBe(DEFAULT_CLASSIFIER_RETRY_MAX);
    expect(options.baseDelay).toBe(1000);
    expect(options.maxDelay).toBe(30000);
    expect(options.backoffFactor).toBe(2);
    expect(mockCreateDefaultOnRetry).toHaveBeenCalledWith(
      'ChangeClassifier.classifyArtifact',
      DEFAULT_CLASSIFIER_RETRY_MAX
    );
  });
});

describe('getClassifierRetryMax config trio (PRD §4.3)', () => {
  const originalValue = process.env[CLASSIFIER_RETRY_MAX];

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env[CLASSIFIER_RETRY_MAX];
  });

  afterEach(() => {
    // Restore the original env value across tests.
    if (originalValue === undefined) {
      delete process.env[CLASSIFIER_RETRY_MAX];
    } else {
      process.env[CLASSIFIER_RETRY_MAX] = originalValue;
    }
  });

  it('SHOULD return the default (4) when the env var is unset', () => {
    // GIVEN env var unset.
    delete process.env[CLASSIFIER_RETRY_MAX];

    // EXECUTE + VERIFY
    expect(getClassifierRetryMax()).toBe(DEFAULT_CLASSIFIER_RETRY_MAX);
    expect(DEFAULT_CLASSIFIER_RETRY_MAX).toBe(4);
  });

  it('SHOULD return a valid positive-integer override', () => {
    // GIVEN env var set to a valid positive int.
    process.env[CLASSIFIER_RETRY_MAX] = '8';

    // EXECUTE + VERIFY
    expect(getClassifierRetryMax()).toBe(8);
  });

  it('SHOULD fall back to the default when the env var is non-numeric', () => {
    // GIVEN env var non-numeric.
    process.env[CLASSIFIER_RETRY_MAX] = 'abc';

    // EXECUTE + VERIFY
    expect(getClassifierRetryMax()).toBe(DEFAULT_CLASSIFIER_RETRY_MAX);
  });

  it('SHOULD fall back to the default when the env var is zero', () => {
    // GIVEN env var zero (non-positive guard).
    process.env[CLASSIFIER_RETRY_MAX] = '0';

    // EXECUTE + VERIFY
    expect(getClassifierRetryMax()).toBe(DEFAULT_CLASSIFIER_RETRY_MAX);
  });

  it('SHOULD fall back to the default when the env var is negative', () => {
    // GIVEN env var negative (non-positive guard).
    process.env[CLASSIFIER_RETRY_MAX] = '-1';

    // EXECUTE + VERIFY
    expect(getClassifierRetryMax()).toBe(DEFAULT_CLASSIFIER_RETRY_MAX);
  });

  it('SHOULD floor a fractional override', () => {
    // GIVEN env var fractional.
    process.env[CLASSIFIER_RETRY_MAX] = '2.9';

    // EXECUTE + VERIFY — Math.floor applies.
    expect(getClassifierRetryMax()).toBe(2);
  });
});
