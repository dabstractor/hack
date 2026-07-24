/**
 * Unit tests for the cleanup-runner seam (P3.M1.T3.S2) + its default runner's
 * cleanup-persona invocation (P3.M1.T3.S3).
 *
 * @remarks
 * Validates BOTH:
 *  - The SEAM contract (P3.M1.T3.S2) — pure types + the injection contract.
 *    No real filesystem, no real git, no real agent.
 *  - The DEFAULT runner's persona invocation (P3.M1.T3.S3) — the runner built
 *    by `createCleanupRunner()` now invokes `createCleanupAgent()` (the S2
 *    no-op placeholder is GONE). `createCleanupAgent` is mocked so no real
 *    agent/LLM fires; the mock agent's `prompt` return is parameterized to
 *    verify the `r.status` → `CleanupResult` mapping.
 *
 * @see {@link ../../src/core/cleanup-runner.ts}
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Subtask, Status } from '../../../src/core/models.js';

// Mock the cleanup agent factory so no real agent/LLM fires. The mock returns a
// fresh { prompt } callable per call; tests override the prompt mock's return to
// exercise the status → CleanupResult mapping.
vi.mock('../../../src/agents/agent-factory.js', () => ({
  createCleanupAgent: vi.fn(() => ({
    prompt: vi.fn(() =>
      Promise.resolve({ status: 'success', data: 'moved 2 docs to docs/' })
    ),
  })),
}));

import {
  createCleanupRunner,
  type CleanupContext,
  type CleanupResult,
} from '../../../src/core/cleanup-runner.js';
import { createCleanupAgent } from '../../../src/agents/agent-factory.js';

const mockCreateCleanupAgent = vi.mocked(createCleanupAgent);

/** Minimal subtask factory for seam/runner tests. */
const makeSubtask = (): Subtask => ({
  id: 'P3.M1.T3.S3',
  type: 'Subtask',
  title: 'Create cleanup agent persona',
  status: 'Planned' as Status,
  story_points: 2,
  dependencies: [],
  context_scope: 'Test scope',
  prd_selectors: [],
});

/** Minimal CleanupContext for invoking the seam/runner. */
const makeContext = (): CleanupContext => ({
  sessionPath: '/repo/plan/008_15504f60a0ef',
  subtask: makeSubtask(),
  repoRoot: '/repo',
});

describe('cleanup-runner seam', () => {
  describe('createCleanupRunner()', () => {
    it('should return a callable function', () => {
      const runner = createCleanupRunner();
      expect(typeof runner).toBe('function');
    });

    it('should resolve a CleanupResult with a summary string', async () => {
      const runner = createCleanupRunner();
      const result: CleanupResult = await runner(makeContext());

      expect(result.success).toBe(true);
      expect(typeof result.summary).toBe('string');
    });

    it('should not throw on the happy path', async () => {
      const runner = createCleanupRunner();
      await expect(runner(makeContext())).resolves.toMatchObject({
        success: true,
      });
    });
  });

  describe('custom CleanupRunner (injection contract)', () => {
    it('should be invokable with a CleanupContext and return a CleanupResult', async () => {
      // A user-supplied (S3-style) runner that records the context it received.
      let received: CleanupContext | null = null;
      const customRunner = async (
        ctx: CleanupContext
      ): Promise<CleanupResult> => {
        received = ctx;
        return { success: true, summary: 'custom cleanup ran' };
      };

      const ctx = makeContext();
      const result = await customRunner(ctx);

      expect(result.success).toBe(true);
      expect(result.summary).toBe('custom cleanup ran');
      expect(received).not.toBeNull();
      expect(received!.sessionPath).toBe('/repo/plan/008_15504f60a0ef');
      expect(received!.subtask.id).toBe('P3.M1.T3.S3');
      expect(received!.repoRoot).toBe('/repo');
    });

    it('should allow a custom runner to report failure non-fatally', async () => {
      const failingRunner = async (): Promise<CleanupResult> => ({
        success: false,
        error: 'simulated cleanup failure',
      });

      const result = await failingRunner(makeContext());

      expect(result.success).toBe(false);
      expect(result.error).toBe('simulated cleanup failure');
    });
  });
});

describe('createCleanupRunner — persona invocation (P3.M1.T3.S3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should invoke createCleanupAgent().prompt exactly once', async () => {
    // EXECUTE
    const runner = createCleanupRunner();
    await runner(makeContext());

    // VERIFY — the default runner builds + invokes the cleanup persona (the S2
    // no-op summary 'cleanup disabled (no persona wired yet)' is GONE).
    expect(mockCreateCleanupAgent).toHaveBeenCalledTimes(1);
    const mockAgent = mockCreateCleanupAgent.mock.results[0].value as {
      prompt: ReturnType<typeof vi.fn>;
    };
    expect(mockAgent.prompt).toHaveBeenCalledTimes(1);
  });

  it('should build a user prompt containing sessionPath + subtask.id + subtask.title', async () => {
    // EXECUTE
    const runner = createCleanupRunner();
    await runner(makeContext());

    // VERIFY — capture the createPrompt-built prompt object's `user` field.
    const mockAgent = mockCreateCleanupAgent.mock.results[0].value as {
      prompt: ReturnType<typeof vi.fn>;
    };
    const promptArg = mockAgent.prompt.mock.calls[0][0] as { user: string };
    expect(promptArg.user).toContain('/repo/plan/008_15504f60a0ef');
    expect(promptArg.user).toContain('P3.M1.T3.S3');
    expect(promptArg.user).toContain('Create cleanup agent persona');
  });

  it('should restate the forbidden paths in the user prompt (PRD §5.1)', async () => {
    // EXECUTE
    const runner = createCleanupRunner();
    await runner(makeContext());

    // VERIFY — the runner's user prompt restates the hard rules so the agent
    // cannot misread the system prompt in isolation.
    const mockAgent = mockCreateCleanupAgent.mock.results[0].value as {
      prompt: ReturnType<typeof vi.fn>;
    };
    const promptArg = mockAgent.prompt.mock.calls[0][0] as { user: string };
    expect(promptArg.user).toContain('PRD.md');
    expect(promptArg.user).toContain('PRP.md');
    expect(promptArg.user).toContain('plan/');
  });

  it('should map r.status==="success" → { success: true, summary }', async () => {
    // SETUP — default mock returns { status:'success', data:'moved 2 docs...' }
    const runner = createCleanupRunner();
    const result = await runner(makeContext());

    // VERIFY
    expect(result.success).toBe(true);
    expect(result.summary).toBe('moved 2 docs to docs/');
    expect(result.error).toBeUndefined();
  });

  it('should map r.status==="error" → { success: false, error }', async () => {
    // SETUP — override the mock agent to return an error status.
    mockCreateCleanupAgent.mockReturnValueOnce({
      prompt: vi.fn(() =>
        Promise.resolve({
          status: 'error',
          data: null,
          error: { message: 'boom' },
        })
      ),
    } as unknown as ReturnType<typeof createCleanupAgent>);

    // EXECUTE
    const runner = createCleanupRunner();
    const result = await runner(makeContext());

    // VERIFY — non-fatal: returns success:false (does NOT throw).
    expect(result.success).toBe(false);
    expect(result.error).toBe('boom');
    expect(result.summary).toBeUndefined();
  });

  it('should map r.status==="partial" → { success: true, summary } (partial carries data)', async () => {
    // SETUP — partial still has data; treat as success per Groundswell semantics.
    mockCreateCleanupAgent.mockReturnValueOnce({
      prompt: vi.fn(() =>
        Promise.resolve({
          status: 'partial',
          data: 'partial cleanup done',
          error: null,
        })
      ),
    } as unknown as ReturnType<typeof createCleanupAgent>);

    // EXECUTE
    const runner = createCleanupRunner();
    const result = await runner(makeContext());

    // VERIFY
    expect(result.success).toBe(true);
    expect(result.summary).toBe('partial cleanup done');
  });

  it('should return { success: false, error } when agent.prompt rejects (non-fatal)', async () => {
    // SETUP — an unexpected throw from the agent (e.g. construction/network).
    mockCreateCleanupAgent.mockReturnValueOnce({
      prompt: vi.fn(() => Promise.reject(new Error('network down'))),
    } as unknown as ReturnType<typeof createCleanupAgent>);

    // EXECUTE
    const runner = createCleanupRunner();
    const result = await runner(makeContext());

    // VERIFY — the runner catches + returns non-fatal failure (S2's nested
    // try/catch is the outer belt-and-suspenders guard). Does NOT rethrow.
    expect(result.success).toBe(false);
    expect(result.error).toContain('network');
  });

  it('should default an empty agent summary to "cleanup complete"', async () => {
    // SETUP — agent succeeds but returns empty/whitespace data.
    mockCreateCleanupAgent.mockReturnValueOnce({
      prompt: vi.fn(() => Promise.resolve({ status: 'success', data: '   ' })),
    } as unknown as ReturnType<typeof createCleanupAgent>);

    // EXECUTE
    const runner = createCleanupRunner();
    const result = await runner(makeContext());

    // VERIFY
    expect(result.success).toBe(true);
    expect(result.summary).toBe('cleanup complete');
  });
});
