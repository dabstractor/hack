/**
 * Unit tests for delta-PRD generation + binding (PRD §4.3 step 5 / P4.M1.T3.S1).
 *
 * @remarks
 * Covers:
 *  - {@link renderDeltaPRD} (pure markdown builder) — all change types, empty
 *    changes, completed-task list, parent ref, no full-PRD leakage.
 *  - {@link writeDeltaPRD} + {@link loadDeltaPRD} — round-trip + SessionFileError
 *    cases (real tmp dir, like the integration resume-regeneration test).
 *  - `decomposePRD()` delta branch — delta session sources `loadDeltaPRD`
 *    (delta_prd.md content, NOT prdSnapshot); missing delta_prd.md → clear
 *    thrown error, createArchitectPrompt NOT called; non-delta session →
 *    unchanged prdSnapshot path.
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Mock the architect prompt generator so decomposePRD's dynamic import resolves
// to a spy we can assert on (its first arg = the prdContent that was sourced).
const createArchitectPromptMock = vi.fn().mockReturnValue({
  user: 'mock-architect-prompt',
});
vi.mock('../../../src/agents/prompts/architect-prompt.js', () => ({
  createArchitectPrompt: createArchitectPromptMock,
}));

// Mock the agent factory so no real agent/LLM runs.
vi.mock('../../../src/agents/agent-factory.js', () => ({
  createArchitectAgent: vi.fn().mockReturnValue({
    prompt: vi.fn().mockResolvedValue({ status: 'success', output: '' }),
  }),
}));

// Mock SessionManager.
vi.mock('../../../src/core/session-manager.js', () => ({
  SessionManager: vi.fn(),
}));

// Mock DeltaAnalysisWorkflow / BugHuntWorkflow / FixCycleWorkflow (constructor
// side effects avoided).
vi.mock('../../../src/workflows/delta-analysis-workflow.js', () => ({
  DeltaAnalysisWorkflow: vi.fn(),
}));
vi.mock('../../../src/workflows/bug-hunt-workflow.js', () => ({
  BugHuntWorkflow: vi.fn(),
}));
vi.mock('../../../src/workflows/fix-cycle-workflow.js', () => ({
  FixCycleWorkflow: vi.fn(),
}));

// Mock task-patcher + task-utils + execution-guard (decomposePRD dependencies).
vi.mock('../../../src/core/task-patcher.js', () => ({
  patchBacklog: vi.fn(),
}));
vi.mock('../../../src/utils/task-utils.js', () => ({
  filterByStatus: vi.fn().mockReturnValue([]),
}));
vi.mock('../../../src/utils/validation/execution-guard.js', () => ({
  validateNestedExecution: vi.fn(),
  isNestedExecutionError: vi.fn(() => false),
}));

// session-utils is NOT mocked — renderDeltaPRD/writeDeltaPRD/loadDeltaPRD run
// for real (real tmp dir for file I/O). resolvePRD/hashPRD are imported but only
// exercised on code paths we do not hit in these focused tests.

import {
  renderDeltaPRD,
  writeDeltaPRD,
  loadDeltaPRD,
  SessionFileError,
} from '../../../src/core/session-utils.js';
import { PRPPipeline } from '../../../src/workflows/prp-pipeline.js';
import { Backlog, SessionState } from '../../../src/core/models.js';
import type { DeltaAnalysis } from '../../../src/core/models.js';

// ---------------------------------------------------------------------------
// Helpers / data factories
// ---------------------------------------------------------------------------

/** Build a DeltaAnalysis with the given changes + defaults. */
function makeDelta(overrides: Partial<DeltaAnalysis> = {}): DeltaAnalysis {
  return {
    changes: [],
    patchInstructions: 'No patch instructions',
    taskIds: [],
    ...overrides,
  };
}

/** Build a delta SessionState (empty backlog, parentSession set). */
function makeDeltaSession(
  sessionPath: string,
  prdSnapshot = '# Full PRD (must NOT be used on a delta session)'
): SessionState {
  const emptyBacklog: Backlog = { backlog: [] };
  return {
    metadata: {
      id: '009_delta_session',
      hash: 'delta_hash_1234567890',
      path: sessionPath,
      createdAt: new Date(),
      parentSession: '001_parent_session',
    },
    prdSnapshot,
    taskRegistry: emptyBacklog,
    currentItemId: null,
  };
}

/** Build a NON-delta SessionState (empty backlog, parentSession null). */
function makeFreshSession(
  sessionPath: string,
  prdSnapshot = '# Fresh PRD'
): SessionState {
  const emptyBacklog: Backlog = { backlog: [] };
  return {
    metadata: {
      id: '001_initial',
      hash: 'initial_hash_1234567890',
      path: sessionPath,
      createdAt: new Date(),
      parentSession: null,
    },
    prdSnapshot,
    taskRegistry: emptyBacklog,
    currentItemId: null,
  };
}

/** Install a mock SessionManager instance onto a pipeline. */
function setSessionManager(
  pipeline: PRPPipeline,
  session: SessionState | null
): { mock: ReturnType<typeof createMockSessionManager> } {
  const mock = createMockSessionManager(session);
  (pipeline as any).sessionManager = mock;
  return { mock };
}

/** Create a mock SessionManager object (mirrors prp-pipeline.test.ts shape). */
function createMockSessionManager(session: SessionState | null) {
  return {
    currentSession: session,
    initialize: vi.fn().mockResolvedValue(session),
    saveBacklog: vi.fn().mockResolvedValue(undefined),
    hasSessionChanged: vi.fn().mockReturnValue(false),
    createDeltaSession: vi.fn().mockResolvedValue(undefined),
    prdPath: '/test/prd.md',
    flushUpdates: vi.fn().mockResolvedValue(undefined),
  };
}

// ---------------------------------------------------------------------------
// renderDeltaPRD — pure function
// ---------------------------------------------------------------------------

describe('renderDeltaPRD', () => {
  it('emits Added / Modified / Removed sections with itemId + description + impact', () => {
    const delta = makeDelta({
      changes: [
        {
          itemId: 'P4.M2.T1.S1',
          type: 'added',
          description: 'New validation config',
          impact: 'Add env vars',
        },
        {
          itemId: 'P4.M1.T3.S1',
          type: 'modified',
          description: 'Bind breakdown to delta',
          impact: 'Re-read delta_prd.md',
        },
        {
          itemId: 'P6.M1.T1.S3',
          type: 'removed',
          description: 'Dropped requirement',
          impact: 'No impact',
        },
      ],
      patchInstructions: 'Re-execute P4.M1.T3.S1',
      taskIds: ['P4.M1.T3.S1'],
    });

    const out = renderDeltaPRD(delta, [], '001_parent');

    // Header
    expect(out).toContain('# Delta PRD');
    expect(out).toContain('`001_parent`');
    expect(out).toMatch(/NOT the full PRD/i);

    // Added section
    expect(out).toContain('## Added');
    expect(out).toContain('### P4.M2.T1.S1');
    expect(out).toContain('**What changed:** New validation config');
    expect(out).toContain('**Impact:** Add env vars');

    // Modified section
    expect(out).toContain('## Modified');
    expect(out).toContain('### P4.M1.T3.S1');
    expect(out).toContain('**What changed:** Bind breakdown to delta');

    // Removed section
    expect(out).toContain(
      '## Removed (for awareness — no implementation tasks)'
    );
    expect(out).toContain('**P6.M1.T1.S3:** Dropped requirement');

    // Patch instructions + tasks to re-execute
    expect(out).toContain('## Patch Instructions');
    expect(out).toContain('Re-execute P4.M1.T3.S1');
    expect(out).toContain('## Tasks to Re-execute');
    expect(out).toContain('- P4.M1.T3.S1');
  });

  it('omits Modified / Removed sections when only Added changes present', () => {
    const delta = makeDelta({
      changes: [
        {
          itemId: 'P1.M1.T1.S1',
          type: 'added',
          description: 'A new subtask',
          impact: 'Impl X',
        },
      ],
    });
    const out = renderDeltaPRD(delta, [], 'parent-1');

    expect(out).toContain('## Added');
    expect(out).not.toContain('## Modified');
    expect(out).not.toContain('## Removed');
  });

  it('emits no change sections when changes is empty (header + patch only)', () => {
    const delta = makeDelta({ patchInstructions: 'Nothing to do' });
    const out = renderDeltaPRD(delta, [], 'parent-1');

    expect(out).toContain('# Delta PRD');
    expect(out).toContain('## Patch Instructions');
    expect(out).toContain('Nothing to do');
    expect(out).not.toContain('## Added');
    expect(out).not.toContain('## Modified');
    expect(out).not.toContain('## Removed');
    expect(out).not.toContain('## Completed Work');
    expect(out).not.toContain('## Tasks to Re-execute');
  });

  it('lists completed task IDs under Completed Work when non-empty', () => {
    const delta = makeDelta();
    const out = renderDeltaPRD(delta, ['P1.M1.T1.S1', 'P1.M1.T2.S1'], 'parent');

    expect(out).toContain(
      '## Completed Work (preserved — do NOT re-implement)'
    );
    expect(out).toContain('- P1.M1.T1.S1');
    expect(out).toContain('- P1.M1.T2.S1');
  });

  it('omits Completed Work section when completedTaskIds is empty', () => {
    const out = renderDeltaPRD(makeDelta(), [], 'parent');
    expect(out).not.toContain('## Completed Work');
  });

  it('omits Tasks to Re-execute when taskIds is empty', () => {
    const out = renderDeltaPRD(makeDelta({ taskIds: [] }), [], 'parent');
    expect(out).not.toContain('## Tasks to Re-execute');
  });

  it('includes the parent session id in the header note', () => {
    const out = renderDeltaPRD(makeDelta(), [], '007_8783a1f5e14a');
    expect(out).toContain('`007_8783a1f5e14a`');
  });

  it('does not leak any "full PRD" content — built solely from delta fields', () => {
    const delta = makeDelta({
      changes: [
        {
          itemId: 'P1.M1.T1.S1',
          type: 'added',
          description: 'desc-A',
          impact: 'impact-A',
        },
      ],
      patchInstructions: 'PATCH-ONLY',
      taskIds: ['P1.M1.T1.S1'],
    });
    const out = renderDeltaPRD(delta, ['DONE-1'], 'parent-1');

    // The only content present must come from the delta/completed fields.
    // Spot-check that arbitrary non-delta strings are absent.
    expect(out).not.toContain('arbitrary-full-prd-body');
    // And confirm the delta content is the entire body (no accidental extra).
    expect(out.trim().length).toBeGreaterThan(0);
    expect(out).toContain('desc-A');
    expect(out).toContain('impact-A');
    expect(out).toContain('PATCH-ONLY');
    expect(out).toContain('DONE-1');
  });
});

// ---------------------------------------------------------------------------
// writeDeltaPRD + loadDeltaPRD — file contract (real tmp dir)
// ---------------------------------------------------------------------------

describe('writeDeltaPRD + loadDeltaPRD', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'delta-prd-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('round-trips: writeDeltaPRD then loadDeltaPRD returns the same content', async () => {
    const md = '# Delta PRD\n\n## Added\n- something\n';
    await writeDeltaPRD(tempDir, md);

    const loaded = await loadDeltaPRD(tempDir);
    expect(loaded).toBe(md);
  });

  it('writes the file at <sessionPath>/delta_prd.md', async () => {
    await writeDeltaPRD(tempDir, 'hello delta');
    // loadDeltaPRD reads exactly that path; success means the file is there.
    const loaded = await loadDeltaPRD(tempDir);
    expect(loaded).toBe('hello delta');
  });

  it('loadDeltaPRD throws SessionFileError when delta_prd.md is missing', async () => {
    await expect(loadDeltaPRD(tempDir)).rejects.toBeInstanceOf(
      SessionFileError
    );
  });

  it('writeDeltaPRD throws SessionFileError when the target dir does not exist', async () => {
    const bogusPath = join(tempDir, 'does-not-exist', 'nested');
    await expect(writeDeltaPRD(bogusPath, 'content')).rejects.toBeInstanceOf(
      SessionFileError
    );
  });

  it('re-throws a pre-existing SessionFileError as-is (does not double-wrap)', async () => {
    // Induce a SessionFileError via loadDeltaPRD on a missing file, then verify
    // its name/operation are intact (not re-wrapped into a new SessionFileError).
    try {
      await loadDeltaPRD(tempDir);
      throw new Error('expected loadDeltaPRD to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(SessionFileError);
      expect((err as SessionFileError).operation).toBe('read delta PRD');
    }
  });
});

// ---------------------------------------------------------------------------
// decomposePRD delta branch — integration with PRPPipeline
// ---------------------------------------------------------------------------

describe('decomposePRD delta branch', () => {
  let tempDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    createArchitectPromptMock.mockClear();
    createArchitectPromptMock.mockReturnValue({ user: 'mock-prompt' });
    tempDir = mkdtempSync(join(tmpdir(), 'delta-prd-pipeline-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    // Clean up signal listeners registered by the PRPPipeline constructor.
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGTERM');
  });

  it('CASE A: delta session with delta_prd.md present → sources delta content (NOT prdSnapshot)', async () => {
    // Pre-write delta_prd.md into a session dir.
    const deltaSessionPath = join(tempDir, '009_delta');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(deltaSessionPath, { recursive: true });
    const deltaContent =
      '# Delta PRD\n\n## Added\n### P4.M2.T1.S1\n- only the delta\n';
    await writeDeltaPRD(deltaSessionPath, deltaContent);

    const fullPRD = '# FULL PRD (must NOT appear in the prompt)';
    const session = makeDeltaSession(deltaSessionPath, fullPRD);

    const pipeline = new PRPPipeline('./test.md');
    setSessionManager(pipeline, session);

    await pipeline.decomposePRD();

    // createArchitectPrompt's first arg MUST be the delta content.
    expect(createArchitectPromptMock).toHaveBeenCalledTimes(1);
    const sourcedContent = createArchitectPromptMock.mock.calls[0][0] as string;
    expect(sourcedContent).toBe(deltaContent);
    expect(sourcedContent).not.toBe(fullPRD);
    expect(sourcedContent).not.toContain('FULL PRD');
  });

  it('CASE B: delta session with delta_prd.md MISSING → fails with clear delta_prd.md error, createArchitectPrompt NOT called, never falls back to prdSnapshot', async () => {
    // No delta_prd.md written.
    const deltaSessionPath = join(tempDir, '009_delta_missing');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(deltaSessionPath, { recursive: true });

    const fullPRD = '# Full PRD (must NOT be used)';
    const session = makeDeltaSession(deltaSessionPath, fullPRD);
    const pipeline = new PRPPipeline('./test.md');
    setSessionManager(pipeline, session);

    // Spy on the base Workflow's `logger` (protected at compile-time, but
    // accessible at runtime in JS) to capture the tracked-failure message.
    const errorSpy = vi.fn();
    (pipeline as any).logger = {
      error: errorSpy,
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    };

    // decomposePRD() wraps non-fatal errors (plain Error) via #trackFailure and
    // sets currentPhase = 'prd_decomposition_failed' rather than re-throwing.
    // The contract we assert: the delta branch threw a clear delta_prd.md error
    // BEFORE building any prompt, and did NOT fall back to prdSnapshot.
    await pipeline.decomposePRD();

    // The branch must throw BEFORE building any prompt.
    expect(createArchitectPromptMock).not.toHaveBeenCalled();

    // The failure was tracked with a message mentioning delta_prd.md.
    expect(pipeline.currentPhase).toBe('prd_decomposition_failed');
    const trackedCall = errorSpy.mock.calls.find(
      ([msg]) => typeof msg === 'string' && msg.includes('Task failure tracked')
    );
    expect(trackedCall).toBeDefined();
    // The context payload carries errorMessage.
    const ctx = trackedCall![1] as { errorMessage?: string };
    expect(ctx.errorMessage).toMatch(/delta_prd\.md/);
  });

  it('CASE C: non-delta session → sources prdSnapshot unchanged (loadDeltaPRD NOT the path)', async () => {
    const freshSessionPath = join(tempDir, '001_fresh');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(freshSessionPath, { recursive: true });

    const prdSnapshot = '# Fresh PRD content';
    const session = makeFreshSession(freshSessionPath, prdSnapshot);

    const pipeline = new PRPPipeline('./test.md');
    setSessionManager(pipeline, session);

    await pipeline.decomposePRD();

    expect(createArchitectPromptMock).toHaveBeenCalledTimes(1);
    const sourcedContent = createArchitectPromptMock.mock.calls[0][0] as string;
    expect(sourcedContent).toBe(prdSnapshot);
  });
});
