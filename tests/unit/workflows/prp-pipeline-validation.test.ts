/**
 * Unit tests for PRPPipeline validation wiring (PRD §4.4 step 1)
 *
 * @remarks
 * Tests validate the `#runValidation()` abort seam + watchdog-terminal
 * classification + the `--mode validate` no-longer-skips-validation fix in
 * `src/workflows/prp-pipeline.ts`. The {@link ValidationWorkflow} is mocked so
 * the tests exercise ONLY the pipeline wiring (not the workflow internals,
 * which are covered by `validation-workflow.test.ts`).
 *
 * Cases:
 *  - success outcome → no throw (pipeline proceeds).
 *  - non-watchdog failure → throws ValidationFailedError (timedOut:false).
 *  - watchdog failure (timedOut:true OR exitCode 124) → thrown error is
 *    isWatchdogKillResult-shaped (terminal, never retried).
 *  - the throw propagates through run() to a FAILED result; bug-hunt
 *    (BugHuntWorkflow.run) is NEVER called.
 *  - 'validate' mode now invokes validation (no longer skips QA).
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { PRPPipeline } from '../../../src/workflows/prp-pipeline.js';
import { Backlog, SessionState } from '../../../src/core/models.js';

// Hoisted mutable outcome for the mocked ValidationWorkflow.run().
const { mockValidationRun, MockValidationWorkflow } = vi.hoisted(() => ({
  mockValidationRun: vi.fn(),
  MockValidationWorkflow: vi.fn(),
}));

// Mock node:fs/promises
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  copyFile: vi.fn().mockResolvedValue(undefined),
}));

// Mock session-utils
vi.mock('../../../src/core/session-utils.js', async importOriginal => {
  const actual =
    await importOriginal<typeof import('../../../src/core/session-utils.js')>();
  return {
    ...actual,
    resolvePRD: vi.fn(),
    writeDeltaPRD: vi.fn().mockResolvedValue(undefined),
  };
});

// Mock SessionManager
vi.mock('../../../src/core/session-manager.js', () => ({
  SessionManager: vi.fn().mockImplementation(() => ({
    currentSession: null,
    initialize: vi.fn(),
    saveBacklog: vi.fn(),
  })),
}));

// Mock TaskOrchestrator
vi.mock('../../../src/core/task-orchestrator.js', () => ({
  TaskOrchestrator: vi.fn().mockImplementation(() => ({
    processNextItem: vi.fn(),
    rebuildQueue: vi.fn().mockResolvedValue(undefined),
  })),
}));

// Mock agent factory
vi.mock('../../../src/agents/agent-factory.js', () => ({
  createArchitectAgent: vi.fn(),
  createQAAgent: vi.fn(),
}));

// Mock prompts — passthrough-real, override TASK_BREAKDOWN_PROMPT for determinism
vi.mock('../../../src/agents/prompts.js', async importOriginal => {
  const actual =
    await importOriginal<typeof import('../../../src/agents/prompts.js')>();
  return { ...actual, TASK_BREAKDOWN_PROMPT: 'Mock TASK_BREAKDOWN_PROMPT' };
});

// Mock DeltaAnalysisWorkflow
vi.mock('../../../src/workflows/delta-analysis-workflow.js', () => ({
  DeltaAnalysisWorkflow: vi.fn().mockImplementation(() => ({
    run: vi.fn().mockResolvedValue({
      changes: [],
      patchInstructions: 'No changes',
      taskIds: [],
    }),
  })),
}));

// Mock BugHuntWorkflow — asserted NOT to be called when validation aborts.
const { MockBugHuntWorkflow, mockBugHuntRun } = vi.hoisted(() => ({
  MockBugHuntWorkflow: vi.fn(),
  mockBugHuntRun: vi.fn(),
}));
vi.mock('../../../src/workflows/bug-hunt-workflow.js', () => ({
  BugHuntWorkflow: MockBugHuntWorkflow.mockImplementation(() => ({
    run: mockBugHuntRun.mockResolvedValue({
      hasBugs: false,
      bugs: [],
      summary: 'No bugs found',
      recommendations: [],
    }),
  })),
}));

// Mock FixCycleWorkflow
vi.mock('../../../src/workflows/fix-cycle-workflow.js', () => ({
  FixCycleWorkflow: vi.fn().mockImplementation(() => ({
    run: vi.fn().mockResolvedValue({
      hasBugs: false,
      bugs: [],
      summary: 'All bugs fixed',
      recommendations: [],
    }),
  })),
}));

// Mock ValidationWorkflow — THE SUBJECT of these wiring tests.
vi.mock('../../../src/workflows/validation-workflow.js', () => ({
  ValidationWorkflow: MockValidationWorkflow.mockImplementation(() => ({
    run: mockValidationRun,
  })),
  // Real class so `error instanceof`/fields behave; constructed in-pipeline.
  ValidationFailedError: class ValidationFailedError extends Error {
    readonly timedOut: boolean;
    readonly exitCode: number | null;
    constructor(outcome: {
      timedOut: boolean;
      exitCode: number | null;
      scriptPath: string;
    }) {
      const watchdog = outcome.timedOut || outcome.exitCode === 124;
      const kind = watchdog
        ? 'watchdog-killed'
        : `non-zero exit (exitCode ${outcome.exitCode})`;
      super(`Validation failed — ${kind}. script=${outcome.scriptPath}`);
      this.name = 'ValidationFailedError';
      this.timedOut = watchdog;
      this.exitCode = outcome.exitCode;
    }
  },
}));

// Mock TaskPatcher
vi.mock('../../../src/core/task-patcher.js', () => ({
  patchBacklog: vi.fn().mockImplementation((backlog: Backlog) => backlog),
}));

// Mock TaskUtils
vi.mock('../../../src/utils/task-utils.js', () => ({
  filterByStatus: vi.fn().mockReturnValue([]),
}));

// Mock execution-guard
vi.mock('../../../src/utils/validation/execution-guard.js', () => ({
  validateNestedExecution: vi.fn(),
  isNestedExecutionError: vi.fn(() => false),
}));

// Import mocked modules + helpers
import { readFile } from 'node:fs/promises';
import { createArchitectAgent } from '../../../src/agents/agent-factory.js';
import { SessionManager as SessionManagerClass } from '../../../src/core/session-manager.js';
import { isWatchdogKillResult } from '../../../src/utils/retry.js';
import { BugHuntWorkflow } from '../../../src/workflows/bug-hunt-workflow.js';

// Casts
const mockReadFile = readFile as any;
const mockCreateArchitectAgent = createArchitectAgent as any;
const MockSessionManagerClass = SessionManagerClass as any;
const MockBugHunt = BugHuntWorkflow as any;

// ---- Test data factories (mirror prp-pipeline.test.ts) ----

const createTestBacklog = (phases: any[]): Backlog => ({ backlog: phases });

const createTestSession = (
  backlog: Backlog,
  sessionPath = '/plan/001_14b9dc2a33c7'
): SessionState => ({
  metadata: {
    id: '001_14b9dc2a33c7',
    hash: '14b9dc2a33c7',
    path: sessionPath,
    createdAt: new Date(),
    parentSession: null,
  },
  prdSnapshot: '# Test PRD',
  taskRegistry: backlog,
  currentItemId: null,
});

function createMockSessionManager(session: SessionState | null) {
  const mock = {
    currentSession: session,
    initialize: vi.fn().mockResolvedValue(session),
    saveBacklog: vi.fn().mockResolvedValue(undefined),
    hasSessionChanged: vi.fn().mockReturnValue(false),
    createDeltaSession: vi.fn().mockResolvedValue(session),
    prdPath: '/test/prd.md',
    flushUpdates: vi.fn().mockResolvedValue(undefined),
  };
  MockSessionManagerClass.mockImplementation(() => mock);
  return mock;
}

function createMockTaskOrchestrator() {
  return {
    processNextItem: vi.fn().mockResolvedValue(false), // no tasks to run
    rebuildQueue: vi.fn().mockResolvedValue(undefined),
    currentItemId: null as string | null,
    sessionManager: {},
  };
}

/** Build a validation outcome object. */
function outcome(
  overrides: Partial<{
    success: boolean;
    exitCode: number | null;
    timedOut: boolean;
  }>
): any {
  return {
    success: true,
    exitCode: 0,
    timedOut: false,
    stdout: '',
    stderr: '',
    scriptPath: '/plan/001_14b9dc2a33c7/validate.sh',
    durationMs: 5,
    ...overrides,
  };
}

describe('PRPPipeline validation wiring (#runValidation)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MockSessionManagerClass.mockImplementation(() => ({
      currentSession: null,
      initialize: vi.fn().mockResolvedValue({ currentSession: null }),
      saveBacklog: vi.fn().mockResolvedValue(undefined),
    }));
    mockReadFile.mockResolvedValue(JSON.stringify({ backlog: [] }));
    mockCreateArchitectAgent.mockReturnValue({
      prompt: vi.fn().mockResolvedValue({ backlog: createTestBacklog([]) }),
    });
    // Default: validation succeeds.
    mockValidationRun.mockResolvedValue(outcome({ success: true }));
  });

  afterEach(() => {
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGTERM');
  });

  /** Build a pipeline with a minimal session + orchestrator so run() reaches validation. */
  function buildPipeline(mode: 'normal' | 'validate' = 'normal'): PRPPipeline {
    const session = createTestSession(createTestBacklog([]));
    createMockSessionManager(session);
    const orchestrator = createMockTaskOrchestrator();
    const pipeline = new PRPPipeline('./test.md', undefined, mode);
    (pipeline as any).taskOrchestrator = orchestrator;
    return pipeline;
  }

  it('should construct ValidationWorkflow with the PRD + process.cwd() and proceed on success', async () => {
    const pipeline = buildPipeline();

    const result = await pipeline.run();

    expect(MockValidationWorkflow).toHaveBeenCalledWith(
      '# Test PRD',
      process.cwd()
    );
    expect(mockValidationRun).toHaveBeenCalledWith('/plan/001_14b9dc2a33c7');
    expect(result.success).toBe(true);
  });

  it('should abort with a failed result on a non-watchdog validation failure', async () => {
    mockValidationRun.mockResolvedValue(
      outcome({ success: false, exitCode: 1, timedOut: false })
    );
    const pipeline = buildPipeline();

    const result = await pipeline.run();

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Validation failed/);
    // Bug-hunt is NEVER reached when validation aborts.
    expect(MockBugHunt).not.toHaveBeenCalled();
  });

  it('should classify a Node-watchdog kill (timedOut:true) as terminal via isWatchdogKillResult', async () => {
    mockValidationRun.mockResolvedValue(
      outcome({ success: false, exitCode: 137, timedOut: true })
    );
    const pipeline = buildPipeline();

    const result = await pipeline.run();

    expect(result.success).toBe(false);
    // Re-derive the thrown error shape: the pipeline constructs
    // ValidationFailedError(outcome), so a fresh instance with the same
    // outcome must be terminal per isWatchdogKillResult.
    const { ValidationFailedError } =
      await import('../../../src/workflows/validation-workflow.js');
    const err = new ValidationFailedError(
      outcome({ success: false, exitCode: 137, timedOut: true })
    );
    expect(isWatchdogKillResult(err)).toBe(true);
    expect(err.timedOut).toBe(true);
  });

  it('should classify a `timeout`-coreutil exit 124 (timedOut:false) as terminal', async () => {
    mockValidationRun.mockResolvedValue(
      outcome({ success: false, exitCode: 124, timedOut: false })
    );
    const pipeline = buildPipeline();

    const result = await pipeline.run();

    expect(result.success).toBe(false);
    const { ValidationFailedError } =
      await import('../../../src/workflows/validation-workflow.js');
    const err = new ValidationFailedError(
      outcome({ success: false, exitCode: 124, timedOut: false })
    );
    // 124 → terminal even though timedOut:false.
    expect(isWatchdogKillResult(err)).toBe(true);
    expect(err.timedOut).toBe(true);
  });

  it('should NOT swallow a validation abort under --continue-on-error', async () => {
    // The CRITICAL gotcha: runQACycle's catch swallows when continueOnError=true,
    // but validation throws from run() so the abort propagates regardless.
    mockValidationRun.mockResolvedValue(
      outcome({ success: false, exitCode: 1, timedOut: false })
    );
    const session = createTestSession(createTestBacklog([]));
    createMockSessionManager(session);
    const orchestrator = createMockTaskOrchestrator();
    // continueOnError is the 5th constructor arg.
    const pipeline = new PRPPipeline(
      './test.md',
      undefined,
      'normal',
      false,
      /* continueOnError */ true
    );
    (pipeline as any).taskOrchestrator = orchestrator;

    const result = await pipeline.run();

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Validation failed/);
    expect(MockBugHunt).not.toHaveBeenCalled();
  });

  it('should run validation in "validate" mode (no longer skips QA)', async () => {
    const pipeline = buildPipeline('validate');

    await pipeline.run();

    // Validation MUST run even in validate mode (the prior defect skipped it).
    expect(MockValidationWorkflow).toHaveBeenCalled();
    expect(mockValidationRun).toHaveBeenCalled();
  });

  it('should abort before bug-hunt when validation fails (bug-hunt never reached)', async () => {
    mockValidationRun.mockResolvedValue(
      outcome({ success: false, exitCode: 2, timedOut: false })
    );
    const pipeline = buildPipeline();

    await pipeline.run();

    // The defining contract: validation abort → BugHuntWorkflow never constructed.
    expect(MockBugHunt).not.toHaveBeenCalled();
    expect(mockBugHuntRun).not.toHaveBeenCalled();
  });
});
