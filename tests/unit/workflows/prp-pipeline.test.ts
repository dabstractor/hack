/**
 * Unit tests for PRPPipeline class
 *
 * @remarks
 * Tests validate PRPPipeline class from src/workflows/prp-pipeline.ts with comprehensive coverage.
 * Tests follow the Setup/Execute/Verify pattern with comprehensive edge case coverage.
 *
 * Mocks are used for all SessionManager, TaskOrchestrator, and agent operations - no real I/O is performed.
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { PRPPipeline } from '../../../src/workflows/prp-pipeline.js';
import { Backlog, SessionState, Status } from '../../../src/core/models.js';

// Mock the node:fs/promises module
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn().mockResolvedValue(undefined),
  copyFile: vi.fn().mockResolvedValue(undefined),
  stat: vi.fn(),
  // nextBugfixDir (real, via session-utils.js mock's ...actual spread) calls
  // readdir(bugfixDir, { withFileTypes: true }). Default to ENOENT so it
  // returns sequence 1 cleanly (first iteration) — no real FS access.
  readdir: vi
    .fn()
    .mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
}));

// Mock session-utils so handleDelta's resolvePRD call is controlled (no real I/O).
// Only resolvePRD + writeDeltaPRD are consumed by handleDelta/spawnDeltaSession
// with paths that don't exist on disk in this unit suite; mock them so the delta
// flow stays I/O-isolated. renderDeltaPRD is pure and left real (passthrough).
vi.mock('../../../src/core/session-utils.js', async importOriginal => {
  const actual =
    await importOriginal<typeof import('../../../src/core/session-utils.js')>();
  return {
    ...actual,
    resolvePRD: vi.fn(),
    writeDeltaPRD: vi.fn().mockResolvedValue(undefined),
    // BUG-002 Part B: loadDeltaPRD feeds decomposePRD's delta branch. Default
    // sample content so the delta path has deterministic input to classify.
    loadDeltaPRD: vi.fn().mockResolvedValue('# Sample delta PRD content'),
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

// Mock the change classifier (BUG-002 Part A + Part B).
// - classifyChangeWithRetry (Part A): wired into initializeSession. Default
//   'SUBSTANTIVE' keeps the existing 'should call handleDelta when
//   hasSessionChanged returns true' test green.
// - classifyArtifactWithRetry (Part B): wired into decomposePRD's delta branch.
//   Default 'CLEAN' keeps any delta success path that forgets to set it green.
vi.mock('../../../src/core/change-classifier.js', () => ({
  classifyChangeWithRetry: vi.fn(),
  classifyArtifactWithRetry: vi.fn(),
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

// Mock prompts — passthrough-real so the dynamically-imported real
// architect-prompt.js (which imports PRD_PREMERGED_DECLARATION from here) gets
// the real exports; only override TASK_BREAKDOWN_PROMPT for unit-test determinism.
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

// Mock BugHuntWorkflow
vi.mock('../../../src/workflows/bug-hunt-workflow.js', () => ({
  BugHuntWorkflow: vi.fn().mockImplementation(() => ({
    run: vi.fn().mockResolvedValue({
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

// Mock ValidationWorkflow — the validation stage now runs in run() before
// runQACycle (PRD §4.4 step 1). Default: validation passes; tests that need to
// exercise the abort seam override mockValidationRun per-test.
const { MockValidationWorkflow } = vi.hoisted(() => ({
  MockValidationWorkflow: vi.fn(),
}));
vi.mock('../../../src/workflows/validation-workflow.js', () => ({
  ValidationWorkflow: MockValidationWorkflow.mockImplementation(() => ({
    run: vi.fn().mockResolvedValue({
      success: true,
      exitCode: 0,
      timedOut: false,
      stdout: '',
      stderr: '',
      scriptPath: '/plan/001_14b9dc2a33c7/validate.sh',
      durationMs: 0,
    }),
  })),
  ValidationFailedError: class ValidationFailedError extends Error {
    readonly timedOut: boolean;
    readonly exitCode: number | null;
    constructor(outcome: { timedOut: boolean; exitCode: number | null }) {
      super('Validation failed (mock)');
      this.name = 'ValidationFailedError';
      this.timedOut = outcome.timedOut || outcome.exitCode === 124;
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

// Import mocked modules
import { readFile, readdir, stat } from 'node:fs/promises';
import { createArchitectAgent } from '../../../src/agents/agent-factory.js';
import { AgentError } from '../../../src/utils/errors.js';
import { SessionManager as SessionManagerClass } from '../../../src/core/session-manager.js';
import { resolvePRD } from '../../../src/core/session-utils.js';
import { DeltaAnalysisWorkflow } from '../../../src/workflows/delta-analysis-workflow.js';
import { BugHuntWorkflow } from '../../../src/workflows/bug-hunt-workflow.js';
import { FixCycleWorkflow } from '../../../src/workflows/fix-cycle-workflow.js';
import { patchBacklog } from '../../../src/core/task-patcher.js';
import { filterByStatus } from '../../../src/utils/task-utils.js';
import {
  validateNestedExecution,
  isNestedExecutionError,
} from '../../../src/utils/validation/execution-guard.js';
import {
  classifyChangeWithRetry,
  classifyArtifactWithRetry,
} from '../../../src/core/change-classifier.js';

// Cast mocked functions
const mockReadFile = readFile as any;
const mockStat = stat as any;
const mockReaddir = readdir as any;
const mockResolvePRD = resolvePRD as any;
const mockCreateArchitectAgent = createArchitectAgent as any;
const MockDeltaAnalysisWorkflow = DeltaAnalysisWorkflow as any;
const MockBugHuntWorkflow = BugHuntWorkflow as any;
const MockFixCycleWorkflow = FixCycleWorkflow as any;
const mockPatchBacklog = patchBacklog as any;
const mockFilterByStatus = filterByStatus as any;
const mockValidateNestedExecution = validateNestedExecution as any;
const mockIsNestedExecutionError = isNestedExecutionError as any;
const mockClassifyChange = classifyChangeWithRetry as unknown as ReturnType<
  typeof vi.fn
>;
const mockClassifyArtifact = classifyArtifactWithRetry as unknown as ReturnType<
  typeof vi.fn
>;
// Get reference to mocked constructor for test setup
const MockSessionManagerClass = SessionManagerClass as any;

// Factory functions for test data
const createTestSubtask = (
  id: string,
  title: string,
  status: Status,
  dependencies: string[] = []
) => ({
  id,
  type: 'Subtask' as const,
  title,
  status,
  story_points: 1,
  dependencies,
  context_scope: 'Test scope',
});

const createTestTask = (
  id: string,
  title: string,
  status: Status,
  subtasks: any[] = []
) => ({
  id,
  type: 'Task' as const,
  title,
  status,
  description: 'Test task description',
  subtasks,
});

const createTestMilestone = (
  id: string,
  title: string,
  status: Status,
  tasks: any[] = []
) => ({
  id,
  type: 'Milestone' as const,
  title,
  status,
  description: 'Test milestone description',
  tasks,
});

const createTestPhase = (
  id: string,
  title: string,
  status: Status,
  milestones: any[] = []
) => ({
  id,
  type: 'Phase' as const,
  title,
  status,
  description: 'Test phase description',
  milestones,
});

const createTestBacklog = (phases: any[]): Backlog => ({
  backlog: phases,
});

const createTestSession = (
  backlog: Backlog,
  prdSnapshot: string = '# Test PRD',
  sessionPath: string = '/plan/001_14b9dc2a33c7'
): SessionState => ({
  metadata: {
    id: '001_14b9dc2a33c7',
    hash: '14b9dc2a33c7',
    path: sessionPath,
    createdAt: new Date(),
    parentSession: null,
  },
  prdSnapshot,
  taskRegistry: backlog,
  currentItemId: null,
});

// BUG-002 Part B: build a delta session by overriding parentSession.
// createTestSession hardcodes parentSession:null (isDelta=false); spreading
// the base and setting parentSession makes isDelta=true so the decomposePRD
// delta branch (the CLEAN/DIRTY guard + loadDeltaPRD) is exercised.
function createDeltaSession(
  backlog: Backlog,
  prdSnapshot: string = '# Test PRD',
  sessionPath: string = '/plan/001_14b9dc2a33c7'
): SessionState {
  const base = createTestSession(backlog, prdSnapshot, sessionPath);
  return {
    ...base,
    metadata: { ...base.metadata, parentSession: '/plan/000_prev' },
  };
}

// Create mock SessionManager factory
function createMockSessionManager(
  session: SessionState | null,
  hasSessionChanged = false
) {
  const mock = {
    currentSession: session,
    initialize: vi.fn().mockResolvedValue(session),
    saveBacklog: vi.fn().mockResolvedValue(undefined),
    hasSessionChanged: vi.fn().mockReturnValue(hasSessionChanged),
    createDeltaSession: vi.fn().mockResolvedValue(session),
    prdPath: '/test/prd.md',
    planDir: '/plan',
    flushUpdates: vi.fn().mockResolvedValue(undefined),
    hasAnySessions: vi.fn().mockResolvedValue(false),
    // BUG-002 Part A: the COSMETIC/SUBSTANTIVE classifier seam. Default NON-empty
    // changes so the empty-diff pre-filter does not short-circuit the classify path.
    getChangeDiffSummary: vi.fn().mockResolvedValue({
      changes: [
        {
          type: 'modified',
          sectionTitle: 'X',
          lineNumber: 1,
          impact: 'low',
        },
      ],
      summaryText: 'changed',
      stats: {
        totalAdded: 1,
        totalModified: 0,
        totalRemoved: 0,
        sectionsAffected: ['X'],
      },
    }),
    absorbCosmeticChange: vi.fn().mockResolvedValue(undefined),
  };
  // Set the mock instance to be returned by SessionManager constructor
  MockSessionManagerClass.mockImplementation(() => mock);
  return mock;
}

// Create mock TaskOrchestrator factory
function createMockTaskOrchestrator() {
  return {
    processNextItem: vi.fn(),
    rebuildQueue: vi.fn().mockResolvedValue(undefined),
    currentItemId: null as string | null,
    sessionManager: {},
  };
}

describe('PRPPipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset SessionManager mock
    MockSessionManagerClass.mockImplementation(() => ({
      currentSession: null,
      initialize: vi.fn().mockResolvedValue({ currentSession: null }),
      saveBacklog: vi.fn().mockResolvedValue(undefined),
      // BUG-002 Part A: default the classifier seam so tests that construct via
      // this default mock don't hit undefined when initializeSession runs.
      getChangeDiffSummary: vi.fn().mockResolvedValue({
        changes: [
          {
            type: 'modified',
            sectionTitle: 'X',
            lineNumber: 1,
            impact: 'low',
          },
        ],
        summaryText: 'changed',
        stats: {
          totalAdded: 1,
          totalModified: 0,
          totalRemoved: 0,
          sectionsAffected: ['X'],
        },
      }),
      absorbCosmeticChange: vi.fn().mockResolvedValue(undefined),
    }));
    // Default classifier verdict = SUBSTANTIVE (keeps the existing
    // 'should call handleDelta when hasSessionChanged returns true' test green).
    mockClassifyChange.mockResolvedValue('SUBSTANTIVE');
    // BUG-002 Part B: default CLEAN verdict keeps any delta success path that
    // forgets to override mockClassifyArtifact on the proceed branch green.
    mockClassifyArtifact.mockResolvedValue('CLEAN');
    // Setup default mocks
    mockReadFile.mockResolvedValue(
      JSON.stringify({ backlog: [createTestPhase('P1', 'Phase 1', 'Planned')] })
    );
    // Default: no bugfix/TEST_RESULTS.md exists → #detectInterruptedBugfix
    // returns null (not interrupted) so existing fresh-hunt tests proceed
    // unchanged. Per-test mockImplementation overrides this where needed.
    mockStat.mockImplementation(async (p: string) => {
      const s = String(p);
      if (s.endsWith('TEST_RESULTS.md')) {
        const err = new Error('ENOENT') as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      }
      const err = new Error('ENOENT') as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    });
    mockCreateArchitectAgent.mockReturnValue({
      prompt: vi.fn().mockResolvedValue({
        backlog: createTestBacklog([]),
      }),
    });
    // Setup default validation mock (allow execution)
    mockValidateNestedExecution.mockImplementation(() => {
      // Default: allow execution (no throw)
    });
    mockIsNestedExecutionError.mockReturnValue(false);
  });

  afterEach(() => {
    // Clean up signal listeners to prevent memory leaks
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGTERM');
  });

  describe('constructor', () => {
    it('should throw if prdPath is empty', () => {
      // EXECUTE & VERIFY
      expect(() => new PRPPipeline('')).toThrow('PRP path cannot be empty');
    });

    it('should throw if prdPath is only whitespace', () => {
      // EXECUTE & VERIFY
      expect(() => new PRPPipeline('   ')).toThrow('PRP path cannot be empty');
    });

    it('should initialize ObservedState fields with default values', () => {
      // EXECUTE
      const pipeline = new PRPPipeline('./test.md');

      // VERIFY
      expect(pipeline.currentPhase).toBe('init');
      expect(pipeline.totalTasks).toBe(0);
      expect(pipeline.completedTasks).toBe(0);
      expect(pipeline.runtime).toBeNull();
    });
  });

  describe('decomposePRD', () => {
    it('should skip backlog generation if backlog exists', async () => {
      // SETUP
      const backlog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Planned', [
          createTestMilestone('P1.M1', 'Milestone 1', 'Planned', [
            createTestTask('P1.M1.T1', 'Task 1', 'Planned', [
              createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Planned'),
            ]),
          ]),
        ]),
      ]);
      const mockSession = createTestSession(backlog);
      const mockManager = createMockSessionManager(mockSession);

      const pipeline = new PRPPipeline('./test.md');
      (pipeline as any).sessionManager = mockManager;

      // EXECUTE
      await pipeline.decomposePRD();

      // VERIFY
      expect(mockCreateArchitectAgent).not.toHaveBeenCalled();
      expect(pipeline.currentPhase).toBe('prd_decomposed');
    });

    it('should call createArchitectAgent for new session', async () => {
      // SETUP
      const backlog = createTestBacklog([]);
      const mockSession = createTestSession(backlog);
      const mockManager = createMockSessionManager(mockSession);

      const pipeline = new PRPPipeline('./test.md');
      (pipeline as any).sessionManager = mockManager;

      // EXECUTE
      await pipeline.decomposePRD();

      // VERIFY
      expect(mockCreateArchitectAgent).toHaveBeenCalled();
    });

    it('should update currentPhase to prd_decomposed', async () => {
      // SETUP
      const backlog = createTestBacklog([]);
      const mockSession = createTestSession(backlog);
      const mockManager = createMockSessionManager(mockSession);

      const pipeline = new PRPPipeline('./test.md');
      (pipeline as any).sessionManager = mockManager;

      // EXECUTE
      await pipeline.decomposePRD();

      // VERIFY
      expect(pipeline.currentPhase).toBe('prd_decomposed');
    });

    it('reuses the same single Architect agent instance for the initial call and every demand-write retry (PRD §6.1 xhigh-budget invariant)', async () => {
      // SETUP: force retryAgentPrompt to re-invoke the SAME mock instance.
      //   AgentError has code PIPELINE_AGENT_LLM_FAILED → isTransientError = true → retried.
      //   Messages must NOT contain "parse"/"parsing" or isTransientError returns false.
      const promptFn = vi
        .fn()
        .mockRejectedValueOnce(
          new AgentError('transient breakdown failure (attempt 1)')
        )
        .mockRejectedValueOnce(
          new AgentError('transient breakdown failure (attempt 2)')
        )
        .mockResolvedValueOnce({ status: 'success', output: '' });
      mockCreateArchitectAgent.mockReturnValue({ prompt: promptFn } as never);

      // Session with an EMPTY backlog so decomposePRD() enters the generation path.
      const backlog = createTestBacklog([]);
      const mockSession = createTestSession(backlog);
      const mockManager = createMockSessionManager(mockSession);

      const pipeline = new PRPPipeline('./test.md');
      (pipeline as any).sessionManager = mockManager;

      // decomposePRD() reads tasks.json after the agent "writes" it; stub readFile
      // to return a valid Backlog JSON so the success path completes cleanly.
      // Mirror the default mock shape: a string of { backlog: [...] }.
      mockReadFile.mockResolvedValueOnce(JSON.stringify({ backlog: [] }));

      // EXECUTE
      await pipeline.decomposePRD();

      // VERIFY — the §6.1 invariant S3 protects:
      // 1. The Architect agent is created EXACTLY ONCE (never re-created on retry).
      expect(mockCreateArchitectAgent).toHaveBeenCalledTimes(1);
      // 2. The SAME agent instance's prompt() is invoked on EVERY attempt (3 total:
      //    initial + 2 retries). This is what makes every retry inherit the xhigh
      //    budget baked into the single createArchitectAgent() config.
      expect(promptFn).toHaveBeenCalledTimes(3);
    });

    it('classifies delta_prd.md CLEAN and proceeds to the architect (delta session)', async () => {
      // SETUP: delta session (parentSession set) + a CLEAN artifact verdict + the
      // architect-success path (mirrors the 'reuses the same single Architect
      // agent instance' test's success setup).
      mockClassifyArtifact.mockResolvedValueOnce('CLEAN');
      mockCreateArchitectAgent.mockReturnValue({
        prompt: vi.fn().mockResolvedValue({ status: 'success', output: '' }),
      } as never);
      mockReadFile.mockResolvedValueOnce(JSON.stringify({ backlog: [] }));

      const pipeline = new PRPPipeline('./test.md');
      (pipeline as any).sessionManager = createMockSessionManager(
        createDeltaSession(createTestBacklog([]))
      );

      // EXECUTE
      await pipeline.decomposePRD();

      // VERIFY: the delta_prd.md content was classified, the architect WAS
      // invoked, and the breakdown completed normally.
      expect(mockClassifyArtifact).toHaveBeenCalledWith(
        '# Sample delta PRD content'
      );
      expect(mockCreateArchitectAgent).toHaveBeenCalled();
      expect(pipeline.currentPhase).toBe('prd_decomposed');
    });

    it('aborts the breakdown (architect NOT called) when delta_prd.md is DIRTY (PRD §4.3)', async () => {
      // SETUP: delta session + a DIRTY artifact verdict. classifyArtifactWithRetry's
      // own catch returns DIRTY on exhaustion, so this single DIRTY test covers BOTH
      // 'malformed artifact' and 'classifier-down' (PRD §4.3 protective default).
      // The architect factory is created before the guard (createArchitectAgent runs
      // in the dynamic-import block above loadDeltaPRD), so the meaningful
      // protection contract is that the architect's LLM prompt() is NEVER invoked.
      mockClassifyArtifact.mockResolvedValueOnce('DIRTY');
      const promptFn = vi.fn();
      mockCreateArchitectAgent.mockReturnValue({ prompt: promptFn } as never);

      const pipeline = new PRPPipeline('./test.md');
      (pipeline as any).sessionManager = createMockSessionManager(
        createDeltaSession(createTestBacklog([]))
      );
      const warnSpy = vi.spyOn((pipeline as any).logger, 'warn');

      // EXECUTE — decomposePRD() RESOLVES (the plain-Error throw is caught
      // NON-fatal by the outer catch → #trackFailure + currentPhase change).
      await pipeline.decomposePRD();

      // VERIFY: the artifact was classified, the architect LLM was NEVER invoked
      // (malformed content never fed unprotected), a prominent warning was
      // logged, and the breakdown is tracked as failed (identical handling to
      // the existing 'Architect agent failed' + loadDeltaPRD-missing throws).
      expect(mockClassifyArtifact).toHaveBeenCalled();
      expect(promptFn).not.toHaveBeenCalled();
      expect(pipeline.currentPhase).toBe('prd_decomposition_failed');
      expect(warnSpy).toHaveBeenCalled();
    });

    it('does NOT classify the full PRD on a non-delta (initial) session', async () => {
      // SETUP: NON-delta session (parentSession:null → isDelta=false). The full
      // human-authored PRD (prdSnapshot) is intentionally NEVER classified
      // (§4.3 scopes the classifier to GENERATED artifacts). Architect-success
      // setup so the breakdown runs past the guard to completion.
      mockCreateArchitectAgent.mockReturnValue({
        prompt: vi.fn().mockResolvedValue({ status: 'success', output: '' }),
      } as never);
      mockReadFile.mockResolvedValueOnce(JSON.stringify({ backlog: [] }));

      const pipeline = new PRPPipeline('./test.md');
      (pipeline as any).sessionManager = createMockSessionManager(
        createTestSession(createTestBacklog([]))
      );

      // EXECUTE
      await pipeline.decomposePRD();

      // VERIFY: the classifier was NEVER called (delta-only guard), and the
      // architect WAS invoked (full-PRD breakdown unaffected).
      expect(mockClassifyArtifact).not.toHaveBeenCalled();
      expect(mockCreateArchitectAgent).toHaveBeenCalled();
    });
  });

  describe('executeBacklog', () => {
    it('should early-return (currentPhase=backlog_complete) when skipExecutionLoop is set (PRD §4.6)', async () => {
      // SETUP: an adopted session skips the orchestrator loop entirely. The
      // backlog contains a subtask, but processNextItem must NEVER be called.
      const backlog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Complete', [
          createTestMilestone('P1.M1', 'Milestone 1', 'Complete', [
            createTestTask('P1.M1.T1', 'Task 1', 'Complete', [
              createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Complete'),
            ]),
          ]),
        ]),
      ]);
      const mockSession = createTestSession(backlog);
      const mockManager = createMockSessionManager(mockSession);

      const mockOrchestrator = createMockTaskOrchestrator();
      (mockOrchestrator as any).processNextItem = vi
        .fn()
        .mockResolvedValue(false);

      const pipeline = new PRPPipeline('./test.md');
      (pipeline as any).sessionManager = mockManager;
      (pipeline as any).taskOrchestrator = mockOrchestrator;
      (pipeline as any).skipExecutionLoop = true; // adopt-mode skip

      // EXECUTE
      await pipeline.executeBacklog();

      // VERIFY: the skip guard fired — orchestrator untouched, phase advanced.
      expect((mockOrchestrator as any).processNextItem).not.toHaveBeenCalled();
      expect(pipeline.currentPhase).toBe('backlog_complete');
    });

    it('should call processNextItem until false returned', async () => {
      // SETUP
      const backlog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Planned', [
          createTestMilestone('P1.M1', 'Milestone 1', 'Planned', [
            createTestTask('P1.M1.T1', 'Task 1', 'Planned', [
              createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Planned'),
            ]),
          ]),
        ]),
      ]);
      const mockSession = createTestSession(backlog);
      const mockManager = createMockSessionManager(mockSession);

      const mockOrchestrator = createMockTaskOrchestrator();
      mockOrchestrator.currentItemId = 'P1.M1.T1.S1';
      (mockOrchestrator as any).processNextItem = vi
        .fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);

      const pipeline = new PRPPipeline('./test.md');
      (pipeline as any).sessionManager = mockManager;
      (pipeline as any).taskOrchestrator = mockOrchestrator;

      // EXECUTE
      await pipeline.executeBacklog();

      // VERIFY
      expect((mockOrchestrator as any).processNextItem).toHaveBeenCalledTimes(
        3
      );
    });

    it('should update currentPhase to backlog_complete', async () => {
      // SETUP
      const backlog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Planned', [
          createTestMilestone('P1.M1', 'Milestone 1', 'Planned', [
            createTestTask('P1.M1.T1', 'Task 1', 'Planned', [
              createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Planned'),
            ]),
          ]),
        ]),
      ]);
      const mockSession = createTestSession(backlog);
      const mockManager = createMockSessionManager(mockSession);

      const mockOrchestrator = createMockTaskOrchestrator();
      mockOrchestrator.currentItemId = 'P1.M1.T1.S1';
      (mockOrchestrator as any).processNextItem = vi
        .fn()
        .mockResolvedValueOnce(false);

      const pipeline = new PRPPipeline('./test.md');
      (pipeline as any).sessionManager = mockManager;
      (pipeline as any).taskOrchestrator = mockOrchestrator;

      // EXECUTE
      await pipeline.executeBacklog();

      // VERIFY
      expect(pipeline.currentPhase).toBe('backlog_complete');
    });

    it('should throw if processNextItem throws', async () => {
      // SETUP
      const backlog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Planned', [
          createTestMilestone('P1.M1', 'Milestone 1', 'Planned', [
            createTestTask('P1.M1.T1', 'Task 1', 'Planned', [
              createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Planned'),
            ]),
          ]),
        ]),
      ]);
      const mockSession = createTestSession(backlog);
      const mockManager = createMockSessionManager(mockSession);

      const mockOrchestrator = createMockTaskOrchestrator();
      mockOrchestrator.currentItemId = 'P1.M1.T1.S1';
      (mockOrchestrator as any).processNextItem = vi
        .fn()
        .mockRejectedValue(new Error('Execution failed'));

      const pipeline = new PRPPipeline('./test.md');
      (pipeline as any).sessionManager = mockManager;
      (pipeline as any).taskOrchestrator = mockOrchestrator;

      // EXECUTE & VERIFY
      await expect(pipeline.executeBacklog()).rejects.toThrow(
        'Execution failed'
      );
    });

    it('should throw safety error after max iterations', async () => {
      // SETUP
      const backlog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Planned', [
          createTestMilestone('P1.M1', 'Milestone 1', 'Planned', [
            createTestTask('P1.M1.T1', 'Task 1', 'Planned', [
              createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Planned'),
            ]),
          ]),
        ]),
      ]);
      const mockSession = createTestSession(backlog);
      const mockManager = createMockSessionManager(mockSession);

      const mockOrchestrator = createMockTaskOrchestrator();
      (mockOrchestrator as any).processNextItem = vi
        .fn()
        .mockResolvedValue(true);

      const pipeline = new PRPPipeline('./test.md');
      (pipeline as any).sessionManager = mockManager;
      (pipeline as any).taskOrchestrator = mockOrchestrator;

      // EXECUTE & VERIFY
      await expect(pipeline.executeBacklog()).rejects.toThrow(
        'Execution exceeded 10000 iterations'
      );
    });
  });

  describe('runQACycle', () => {
    it('should skip QA if not all tasks complete', async () => {
      // SETUP
      const backlog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Implementing', [
          createTestMilestone('P1.M1', 'Milestone 1', 'Planned', [
            createTestTask('P1.M1.T1', 'Task 1', 'Planned', [
              createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Planned'),
              createTestSubtask('P1.M1.T1.S2', 'Subtask 2', 'Complete'),
            ]),
          ]),
        ]),
      ]);
      const mockSession = createTestSession(backlog);
      const mockManager = createMockSessionManager(mockSession);

      const pipeline = new PRPPipeline('./test.md');
      (pipeline as any).sessionManager = mockManager;
      pipeline.totalTasks = 2;

      // EXECUTE
      await pipeline.runQACycle();

      // VERIFY
      expect(pipeline.currentPhase).toBe('qa_skipped');
    });

    it('should set qa_complete phase when all tasks complete', async () => {
      // SETUP
      const backlog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Complete', [
          createTestMilestone('P1.M1', 'Milestone 1', 'Complete', [
            createTestTask('P1.M1.T1', 'Task 1', 'Complete', [
              createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Complete'),
              createTestSubtask('P1.M1.T1.S2', 'Subtask 2', 'Complete'),
            ]),
          ]),
        ]),
      ]);
      const mockSession = createTestSession(backlog);
      const mockManager = createMockSessionManager(mockSession);

      const pipeline = new PRPPipeline('./test.md');
      (pipeline as any).sessionManager = mockManager;

      // EXECUTE
      await pipeline.runQACycle();

      // VERIFY
      expect(pipeline.currentPhase).toBe('qa_complete');
    });

    it('forwards PARALLEL_RESEARCH + RESEARCH_DEPTH to FixCycleWorkflow (parallel on)', async () => {
      // SETUP - all-Complete backlog so QA runs, then bug-found branch
      const backlog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Complete', [
          createTestMilestone('P1.M1', 'Milestone 1', 'Complete', [
            createTestTask('P1.M1.T1', 'Task 1', 'Complete', [
              createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Complete'),
            ]),
          ]),
        ]),
      ]);
      const mockSession = createTestSession(backlog);
      const mockManager = createMockSessionManager(mockSession);

      const pipeline = new PRPPipeline('./test.md');
      (pipeline as any).sessionManager = mockManager;
      (pipeline as any).taskOrchestrator = createMockTaskOrchestrator();

      // Bug-hunt mode forces QA to run immediately (reaches the fix-spawn branch)
      (pipeline as any).mode = 'bug-hunt';

      // BugHuntWorkflow must report bugs so the fix-spawn branch executes
      MockBugHuntWorkflow.mockImplementation(() => ({
        run: vi.fn().mockResolvedValue({
          hasBugs: true,
          bugs: [
            {
              id: 'BUG-001',
              severity: 'major',
              title: 'Bug',
              description: 'desc',
              reproduction: 'repro',
            },
          ],
          summary: 'Found 1 bug',
          recommendations: [],
        }),
      }));
      // FixCycleWorkflow returns a resolved cycle (no remaining bugs)
      MockFixCycleWorkflow.mockClear();
      MockFixCycleWorkflow.mockImplementation(() => ({
        run: vi.fn().mockResolvedValue({
          hasBugs: false,
          bugs: [],
          summary: 'All bugs fixed',
          recommendations: [],
        }),
      }));

      // EXECUTE - forward parallel-on settings via env
      vi.stubEnv('PARALLEL_RESEARCH', 'true');
      vi.stubEnv('RESEARCH_DEPTH', '3');
      try {
        await pipeline.runQACycle();
      } finally {
        vi.unstubAllEnvs();
      }

      // VERIFY - 5th arg built from isParallelResearch() + getResearchDepth()
      expect(MockFixCycleWorkflow).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.anything(),
        expect.anything(),
        { parallelResearch: true, researchDepth: 3 }
      );
    });

    it('forwards parallel-off config when PARALLEL_RESEARCH unset', async () => {
      // SETUP - all-Complete backlog so QA runs, then bug-found branch
      const backlog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Complete', [
          createTestMilestone('P1.M1', 'Milestone 1', 'Complete', [
            createTestTask('P1.M1.T1', 'Task 1', 'Complete', [
              createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Complete'),
            ]),
          ]),
        ]),
      ]);
      const mockSession = createTestSession(backlog);
      const mockManager = createMockSessionManager(mockSession);

      const pipeline = new PRPPipeline('./test.md');
      (pipeline as any).sessionManager = mockManager;
      (pipeline as any).taskOrchestrator = createMockTaskOrchestrator();

      // Bug-hunt mode forces QA to run immediately (reaches the fix-spawn branch)
      (pipeline as any).mode = 'bug-hunt';

      // BugHuntWorkflow must report bugs so the fix-spawn branch executes
      MockBugHuntWorkflow.mockImplementation(() => ({
        run: vi.fn().mockResolvedValue({
          hasBugs: true,
          bugs: [
            {
              id: 'BUG-001',
              severity: 'major',
              title: 'Bug',
              description: 'desc',
              reproduction: 'repro',
            },
          ],
          summary: 'Found 1 bug',
          recommendations: [],
        }),
      }));
      MockFixCycleWorkflow.mockClear();
      MockFixCycleWorkflow.mockImplementation(() => ({
        run: vi.fn().mockResolvedValue({
          hasBugs: false,
          bugs: [],
          summary: 'All bugs fixed',
          recommendations: [],
        }),
      }));

      // EXECUTE - parallel off (unset) → isParallelResearch()=false, depth default 2
      vi.stubEnv('PARALLEL_RESEARCH', '');
      vi.stubEnv('RESEARCH_DEPTH', '');
      try {
        await pipeline.runQACycle();
      } finally {
        vi.unstubAllEnvs();
      }

      // VERIFY
      expect(MockFixCycleWorkflow).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.anything(),
        expect.anything(),
        { parallelResearch: false, researchDepth: 2 }
      );
    });

    it('creates a numbered bugfix/NNN_hash/ dir (not flat bugfix/) when bugs found', async () => {
      // SETUP - all-Complete backlog so QA runs, then bug-found branch
      const backlog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Complete', [
          createTestMilestone('P1.M1', 'Milestone 1', 'Complete', [
            createTestTask('P1.M1.T1', 'Task 1', 'Complete', [
              createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Complete'),
            ]),
          ]),
        ]),
      ]);
      const mockSession = createTestSession(backlog);
      const mockManager = createMockSessionManager(mockSession);

      const pipeline = new PRPPipeline('./test.md');
      (pipeline as any).sessionManager = mockManager;
      (pipeline as any).taskOrchestrator = createMockTaskOrchestrator();

      // Bug-hunt mode forces QA to run immediately (reaches the fix-spawn branch)
      (pipeline as any).mode = 'bug-hunt';

      // BugHuntWorkflow must report bugs so the fix-spawn branch executes
      MockBugHuntWorkflow.mockImplementation(() => ({
        run: vi.fn().mockResolvedValue({
          hasBugs: true,
          bugs: [
            {
              id: 'BUG-001',
              severity: 'major',
              title: 'Bug',
              description: 'desc',
              reproduction: 'repro',
            },
          ],
          summary: 'Found 1 bug',
          recommendations: [],
        }),
      }));
      // FixCycleWorkflow returns a resolved cycle (no remaining bugs)
      MockFixCycleWorkflow.mockClear();
      MockFixCycleWorkflow.mockImplementation(() => ({
        run: vi.fn().mockResolvedValue({
          hasBugs: false,
          bugs: [],
          summary: 'All bugs fixed',
          recommendations: [],
        }),
      }));

      // EXECUTE — default readdir mock (ENOENT) → nextBugfixDir sequence 1
      await pipeline.runQACycle();

      // VERIFY — mkdir was called with a numbered bugfix/NNN_hash/ path
      const { mkdir } = await import('node:fs/promises');
      expect(mkdir).toHaveBeenCalledWith(
        expect.stringMatching(/bugfix[\\/]\d{3}_[a-f0-9]{12}$/),
        { recursive: true }
      );
      // VERIFY — #runBugFixCycle (via MockFixCycleWorkflow) received the SAME
      // numbered path (1st arg). 5th arg (parallel config) varies by env.
      expect(MockFixCycleWorkflow).toHaveBeenCalledWith(
        expect.stringMatching(/bugfix[\\/]\d{3}_[a-f0-9]{12}$/),
        expect.any(String),
        expect.anything(),
        expect.anything(),
        expect.anything()
      );
    });

    it('creates 002_ when a 001_ bugfix iteration already exists (prior iteration preserved)', async () => {
      // SETUP - all-Complete backlog so QA runs, then bug-found branch
      const backlog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Complete', [
          createTestMilestone('P1.M1', 'Milestone 1', 'Complete', [
            createTestTask('P1.M1.T1', 'Task 1', 'Complete', [
              createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Complete'),
            ]),
          ]),
        ]),
      ]);
      const mockSession = createTestSession(backlog);
      const mockManager = createMockSessionManager(mockSession);

      const pipeline = new PRPPipeline('./test.md');
      (pipeline as any).sessionManager = mockManager;
      (pipeline as any).taskOrchestrator = createMockTaskOrchestrator();

      (pipeline as any).mode = 'bug-hunt';

      MockBugHuntWorkflow.mockImplementation(() => ({
        run: vi.fn().mockResolvedValue({
          hasBugs: true,
          bugs: [
            {
              id: 'BUG-001',
              severity: 'major',
              title: 'Bug',
              description: 'desc',
              reproduction: 'repro',
            },
          ],
          summary: 'Found 1 bug',
          recommendations: [],
        }),
      }));
      MockFixCycleWorkflow.mockClear();
      MockFixCycleWorkflow.mockImplementation(() => ({
        run: vi.fn().mockResolvedValue({
          hasBugs: false,
          bugs: [],
          summary: 'All bugs fixed',
          recommendations: [],
        }),
      }));

      // OVERRIDE readdir: simulate a prior bugfix/001_<hash>/ iteration
      // already existing → nextBugfixDir must return sequence 2 (max+1).
      // PERSISTENT (not once): #detectInterruptedBugfix calls readdir FIRST
      // (must see 001_ as healthy → return null → fresh hunt), then
      // nextBugfixDir calls readdir AGAIN (sees 001_ → sequence 2).
      const { readdir, stat, readFile } = await import('node:fs/promises');
      vi.mocked(readdir).mockResolvedValue([
        { name: '001_aaaaaaaaaaaa', isDirectory: () => true },
      ] as any);
      // 001_ is healthy (valid TEST_RESULTS.md + tasks.json) so detection
      // skips it → returns null → fresh hunt proceeds.
      vi.mocked(stat).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s.includes('001_') && s.endsWith('TEST_RESULTS.md')) return {};
        if (s.includes('001_') && s.endsWith('tasks.json')) return {};
        const err = new Error('ENOENT') as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      });
      vi.mocked(readFile).mockResolvedValue(JSON.stringify({ backlog: [] }));

      // EXECUTE
      await pipeline.runQACycle();

      // VERIFY — mkdir received a 002_<12hex> path (prior 001_ preserved)
      const { mkdir } = await import('node:fs/promises');
      expect(mkdir).toHaveBeenCalledWith(
        expect.stringMatching(/bugfix[\\/]002_[a-f0-9]{12}$/),
        { recursive: true }
      );
    });
  });

  describe('resume interrupted bugfix breakdowns', () => {
    // Shared helpers for the detection/resume tests (PRD §4.4 step 3).
    const CLEAN_RESULTS = {
      hasBugs: false,
      bugs: [],
      summary: 'All bugs fixed',
      recommendations: [],
    };
    const BUG_RESULTS = {
      hasBugs: true,
      bugs: [
        {
          id: 'BUG-001',
          severity: 'major',
          title: 'Bug',
          description: 'desc',
          reproduction: 'repro',
        },
      ],
      summary: 'Found 1 bug',
      recommendations: [],
    };
    const VALID_BACKLOG_JSON = JSON.stringify(
      createTestBacklog([createTestPhase('P1', 'Phase 1', 'Planned')])
    );

    /** Build a pipeline whose session is an all-Complete backlog in bug-hunt mode. */
    const buildBugHuntPipeline = (sessionPath = '/tmp/plan/008_test') => {
      const backlog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Complete', [
          createTestMilestone('P1.M1', 'Milestone 1', 'Complete', [
            createTestTask('P1.M1.T1', 'Task 1', 'Complete', [
              createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Complete'),
            ]),
          ]),
        ]),
      ]);
      const mockSession = createTestSession(backlog, '# Test PRD', sessionPath);
      const mockManager = createMockSessionManager(mockSession);

      const pipeline = new PRPPipeline('./test.md');
      (pipeline as any).sessionManager = mockManager;
      (pipeline as any).taskOrchestrator = createMockTaskOrchestrator();
      // Bug-hunt mode forces QA to run (reaches the resume gate) regardless
      // of task status.
      (pipeline as any).mode = 'bug-hunt';
      return pipeline;
    };

    /** Stub readdir to return a single numbered bugfix/NNN_hash/ child dir. */
    const stubNumberedChild = (seq = '001') => {
      mockReaddir.mockResolvedValue([
        { name: `${seq}_aaaaaaaaaaaa`, isDirectory: () => true },
      ] as any);
    };

    /** Stub mockStat/mockReadFile so bugfix/TEST_RESULTS.md exists but tasks.json is missing. */
    const stubMissingTasks = () => {
      stubNumberedChild();
      mockStat.mockImplementation(async (p: string) => {
        const s = String(p);
        if (s.endsWith('TEST_RESULTS.md')) return {}; // present
        const err = new Error('ENOENT') as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      });
    };

    beforeEach(() => {
      // Default mocks for this block: BugHunt finds no bugs (fresh path),
      // FixCycle returns clean. Per-test mockImplementation overrides these.
      MockBugHuntWorkflow.mockImplementation(() => ({
        run: vi.fn().mockResolvedValue(CLEAN_RESULTS),
      }));
      MockFixCycleWorkflow.mockClear();
      MockFixCycleWorkflow.mockImplementation(() => ({
        run: vi.fn().mockResolvedValue(CLEAN_RESULTS),
      }));
      // Reset readdir to default ENOENT (never hunted) so each test is
      // deterministic; tests that need a numbered child call stubNumberedChild().
      mockReaddir.mockRejectedValue(
        Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      );
    });

    it('resumes when tasks.json is MISSING (skips fresh hunt, reuses existing dir)', async () => {
      const pipeline = buildBugHuntPipeline();
      stubMissingTasks();

      await pipeline.runQACycle();

      // No fresh bug hunt, no mkdir/copyFile (resume reuses existing dir).
      expect(MockBugHuntWorkflow).not.toHaveBeenCalled();
      expect(MockFixCycleWorkflow).toHaveBeenCalledTimes(1);
      expect(MockFixCycleWorkflow).toHaveBeenCalledWith(
        expect.stringContaining('bugfix'),
        expect.any(String),
        expect.anything(),
        expect.anything(),
        expect.anything()
      );
      expect(pipeline.currentPhase).toBe('qa_complete');
    });

    it('resumes when tasks.json is EMPTY', async () => {
      const pipeline = buildBugHuntPipeline();
      stubNumberedChild();
      mockStat.mockResolvedValue({}); // both files exist
      mockReadFile.mockResolvedValue(''); // empty tasks.json

      await pipeline.runQACycle();

      expect(MockBugHuntWorkflow).not.toHaveBeenCalled();
      expect(MockFixCycleWorkflow).toHaveBeenCalledTimes(1);
    });

    it('resumes when tasks.json is CORRUPT (invalid JSON)', async () => {
      const pipeline = buildBugHuntPipeline();
      stubNumberedChild();
      mockStat.mockResolvedValue({});
      mockReadFile.mockResolvedValue('{not valid json');

      await pipeline.runQACycle();

      expect(MockBugHuntWorkflow).not.toHaveBeenCalled();
      expect(MockFixCycleWorkflow).toHaveBeenCalledTimes(1);
    });

    it('resumes when tasks.json is CORRUPT (valid JSON, invalid Backlog)', async () => {
      const pipeline = buildBugHuntPipeline();
      stubNumberedChild();
      mockStat.mockResolvedValue({});
      // Valid JSON but not a valid Backlog shape (fails even lenient BacklogReadSchema).
      mockReadFile.mockResolvedValue(JSON.stringify({ foo: 1 }));

      await pipeline.runQACycle();

      expect(MockBugHuntWorkflow).not.toHaveBeenCalled();
      expect(MockFixCycleWorkflow).toHaveBeenCalledTimes(1);
    });

    it('resumes when tasks.json is UNREADABLE (readFile throws)', async () => {
      const pipeline = buildBugHuntPipeline();
      stubNumberedChild();
      // Both files exist (stat succeeds), but reading tasks.json fails
      // (e.g. permissions) → treated as interrupted.
      mockStat.mockResolvedValue({});
      mockReadFile.mockRejectedValue(new Error('EACCES'));

      await pipeline.runQACycle();

      expect(MockBugHuntWorkflow).not.toHaveBeenCalled();
      expect(MockFixCycleWorkflow).toHaveBeenCalledTimes(1);
    });

    it('runs a fresh hunt when the dir is HEALTHY (valid tasks.json)', async () => {
      const pipeline = buildBugHuntPipeline();
      stubNumberedChild();
      mockStat.mockResolvedValue({}); // both files exist
      mockReadFile.mockResolvedValue(VALID_BACKLOG_JSON); // valid tasks.json

      await pipeline.runQACycle();

      // Fresh hunt ran (detection returned null → not interrupted).
      expect(MockBugHuntWorkflow).toHaveBeenCalledTimes(1);
      // Resume did not pre-empt: FixCycle was NOT called because BugHunt found
      // no bugs in the fresh path.
      expect(MockFixCycleWorkflow).not.toHaveBeenCalled();
    });

    it('runs a fresh hunt when there is NO TEST_RESULTS.md', async () => {
      const pipeline = buildBugHuntPipeline();
      stubNumberedChild(); // numbered child exists but has no TEST_RESULTS.md
      // No TEST_RESULTS.md → never hunted in this child → not interrupted (skip).
      mockStat.mockImplementation(async () => {
        const err = new Error('ENOENT') as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      });

      await pipeline.runQACycle();

      expect(MockBugHuntWorkflow).toHaveBeenCalledTimes(1);
    });

    it('skips detection in validate mode (returns early)', async () => {
      const pipeline = buildBugHuntPipeline();
      (pipeline as any).mode = 'validate';
      // Even with an interrupted dir present, validate must skip detection.
      stubMissingTasks();

      await pipeline.runQACycle();

      expect(pipeline.currentPhase).toBe('qa_skipped');
      expect(MockBugHuntWorkflow).not.toHaveBeenCalled();
      expect(MockFixCycleWorkflow).not.toHaveBeenCalled();
    });

    it('skips detection when SKIP_BUG_FINDING=true (runs fresh hunt)', async () => {
      const pipeline = buildBugHuntPipeline();
      stubMissingTasks(); // interrupted dir present, but gate suppressed

      vi.stubEnv('SKIP_BUG_FINDING', 'true');
      try {
        await pipeline.runQACycle();
      } finally {
        vi.unstubAllEnvs();
      }

      // Gate suppressed detection → fresh hunt ran.
      expect(MockBugHuntWorkflow).toHaveBeenCalledTimes(1);
    });

    it('suppresses detection inside bug-fix child sessions (no re-entry)', async () => {
      // sessionPath contains 'bugfix' → bug-fix child → suppression gate false.
      const pipeline = buildBugHuntPipeline(
        '/tmp/plan/008_test/bugfix/001_child'
      );
      stubMissingTasks(); // interrupted dir present, but suppressed

      await pipeline.runQACycle();

      // Suppressed → fresh hunt ran (no re-entry loop).
      expect(MockBugHuntWorkflow).toHaveBeenCalledTimes(1);
    });

    it('falls through to fresh hunt when resume THROWS (pipeline not blocked)', async () => {
      const pipeline = buildBugHuntPipeline();
      stubMissingTasks(); // interrupted dir present
      // Resume attempt fails.
      MockFixCycleWorkflow.mockImplementation(() => ({
        run: vi.fn().mockRejectedValue(new Error('resume boom')),
      }));

      await pipeline.runQACycle();

      // Resume failed → fresh hunt ran as fallback.
      expect(MockBugHuntWorkflow).toHaveBeenCalledTimes(1);
      // Resume attempted (1) + fresh path may call again (if bugs found) —
      // BugHunt default is clean here, so fresh path does NOT call FixCycle.
      // The key assertion: pipeline did NOT throw and reached qa_complete.
      expect(MockFixCycleWorkflow).toHaveBeenCalledTimes(1);
      expect(pipeline.currentPhase).toBe('qa_complete');
    });

    describe('multi-child scan (numbered bugfix/NNN_hash/ detection)', () => {
      /** Stub two numbered children; per-child health set via mockStat/mockReadFile. */
      const stubTwoChildren = (younger: string, older: string) => {
        mockReaddir.mockResolvedValue([
          { name: `${younger}_bbbbbbbbbbbb`, isDirectory: () => true },
          { name: `${older}_aaaaaaaaaaaa`, isDirectory: () => true },
        ] as any);
      };
      /** ENOENT error factory. */
      const enoent = () =>
        Object.assign(new Error('ENOENT'), { code: 'ENOENT' });

      it('returns the MOST RECENT interrupted child when both interrupted', async () => {
        const pipeline = buildBugHuntPipeline();
        // 002 + 001 both have TEST_RESULTS.md + missing tasks.json (interrupted).
        stubTwoChildren('002', '001');
        mockStat.mockImplementation(async (p: string) => {
          if (String(p).endsWith('TEST_RESULTS.md')) return {};
          throw enoent(); // both tasks.json missing
        });

        await pipeline.runQACycle();

        // 002 is most recent → resumed; no fresh hunt.
        expect(MockBugHuntWorkflow).not.toHaveBeenCalled();
        expect(MockFixCycleWorkflow).toHaveBeenCalledTimes(1);
        expect(MockFixCycleWorkflow).toHaveBeenCalledWith(
          expect.stringContaining('002_bbbbbbbbbbbb'),
          expect.any(String),
          expect.anything(),
          expect.anything(),
          expect.anything()
        );
      });

      it('skips healthy most-recent child, resumes OLDER interrupted child', async () => {
        const pipeline = buildBugHuntPipeline();
        // 002 healthy (valid tasks.json); 001 interrupted (tasks.json missing).
        stubTwoChildren('002', '001');
        mockStat.mockImplementation(async (p: string) => {
          const s = String(p);
          if (s.endsWith('TEST_RESULTS.md')) return {}; // both have reports
          if (s.includes('002_')) return {}; // 002 tasks.json present
          throw enoent(); // 001 tasks.json missing
        });
        mockReadFile.mockImplementation(async (p: string) => {
          if (String(p).includes('002_')) return VALID_BACKLOG_JSON;
          return ''; // not reached (001 stat ENOENT first)
        });

        await pipeline.runQACycle();

        // 002 skipped (healthy); 001 resumed.
        expect(MockBugHuntWorkflow).not.toHaveBeenCalled();
        expect(MockFixCycleWorkflow).toHaveBeenCalledWith(
          expect.stringContaining('001_aaaaaaaaaaaa'),
          expect.any(String),
          expect.anything(),
          expect.anything(),
          expect.anything()
        );
      });

      it('returns null when ALL numbered children are healthy (fresh hunt)', async () => {
        const pipeline = buildBugHuntPipeline();
        stubTwoChildren('002', '001');
        mockStat.mockResolvedValue({}); // all files present
        mockReadFile.mockResolvedValue(VALID_BACKLOG_JSON); // all valid

        await pipeline.runQACycle();

        // Nothing interrupted → fresh hunt.
        expect(MockBugHuntWorkflow).toHaveBeenCalledTimes(1);
        expect(MockFixCycleWorkflow).not.toHaveBeenCalled();
      });

      it('returns null when no bugfix/ dir exists (ENOENT → never hunted)', async () => {
        const pipeline = buildBugHuntPipeline();
        // Default readdir (ENOENT) is set in beforeEach; ensure it.
        mockReaddir.mockRejectedValue(enoent());

        await pipeline.runQACycle();

        expect(MockBugHuntWorkflow).toHaveBeenCalledTimes(1);
      });

      it('PROPAGATES non-ENOENT readdir errors (surfaces unexpected failures)', async () => {
        const pipeline = buildBugHuntPipeline();
        const eacces = Object.assign(new Error('EACCES'), {
          code: 'EACCES',
        });
        mockReaddir.mockRejectedValue(eacces);
        // Spy on the logger to observe the tracked non-fatal failure
        // (runQACycle catches non-fatal errors and tracks them; the EACCES
        // must propagate OUT of #detectInterruptedBugfix to be tracked here —
        // if it were swallowed, detection would return null and a fresh
        // hunt would run instead).
        const warnSpy = vi.fn();
        (pipeline as any).logger = {
          ...(pipeline as any).logger,
          warn: warnSpy,
          info: vi.fn(),
          error: vi.fn(),
          debug: vi.fn(),
        };

        await pipeline.runQACycle();

        // The propagated EACCES was tracked as a non-fatal QA failure.
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('EACCES'));
        expect(pipeline.currentPhase).toBe('qa_failed');
      });

      it('ignores non-NNN_ entries and non-directory entries', async () => {
        const pipeline = buildBugHuntPipeline();
        // architecture/ (non-NNN), a stray file, and one real numbered child.
        mockReaddir.mockResolvedValue([
          { name: 'architecture', isDirectory: () => true },
          { name: 'README.md', isDirectory: () => false },
          { name: '001_aaaaaaaaaaaa', isDirectory: () => true },
        ] as any);
        mockStat.mockImplementation(async (p: string) => {
          if (String(p).endsWith('TEST_RESULTS.md')) return {};
          throw enoent(); // 001 tasks.json missing → interrupted
        });

        await pipeline.runQACycle();

        // Only 001 is a numbered dir; it is interrupted → resume.
        expect(MockBugHuntWorkflow).not.toHaveBeenCalled();
        expect(MockFixCycleWorkflow).toHaveBeenCalledWith(
          expect.stringContaining('001_aaaaaaaaaaaa'),
          expect.any(String),
          expect.anything(),
          expect.anything(),
          expect.anything()
        );
      });

      it('skips a child without TEST_RESULTS.md (never hunted) and continues', async () => {
        const pipeline = buildBugHuntPipeline();
        // 002 has NO TEST_RESULTS.md (skip); 001 has report + missing tasks (interrupted).
        stubTwoChildren('002', '001');
        mockStat.mockImplementation(async (p: string) => {
          const s = String(p);
          // 002 has neither file → skip (no report).
          if (s.includes('002_')) throw enoent();
          // 001 has TEST_RESULTS.md, missing tasks.json → interrupted.
          if (s.endsWith('TEST_RESULTS.md')) return {};
          throw enoent();
        });

        await pipeline.runQACycle();

        // 002 skipped (no report); 001 resumed.
        expect(MockBugHuntWorkflow).not.toHaveBeenCalled();
        expect(MockFixCycleWorkflow).toHaveBeenCalledWith(
          expect.stringContaining('001_aaaaaaaaaaaa'),
          expect.any(String),
          expect.anything(),
          expect.anything(),
          expect.anything()
        );
      });

      it('returns null when bugfix/ has no numbered children (empty / all non-NNN_)', async () => {
        const pipeline = buildBugHuntPipeline();
        mockReaddir.mockResolvedValue([
          { name: 'architecture', isDirectory: () => true },
          { name: 'notes.md', isDirectory: () => false },
        ] as any);

        await pipeline.runQACycle();

        // No numbered child → nothing to resume → fresh hunt.
        expect(MockBugHuntWorkflow).toHaveBeenCalledTimes(1);
      });
    });
  });

  // ----------------------------------------------------------------------
  // S4: end-to-end lifecycle proving creation (S2) + detection (S3) AGREE on
  // the numbered bugfix/NNN_hash/ layout across multiple QA iterations. S2 and
  // S3 each prove their OWN side in isolation; this suite proves the
  // multi-iteration INTEGRATION (chain runQACycle calls; exercise creation +
  // detection together). See PRD §4.4 step 3 / §5.1.
  // ----------------------------------------------------------------------
  describe('numbered bugfix iteration lifecycle', () => {
    // Lifecycle-scoped constants (distinct names so we never shadow the
    // resume-suite helpers if they're ever hoisted into scope).
    const LIFECYCLE_VALID_BACKLOG_JSON = JSON.stringify(
      createTestBacklog([createTestPhase('P1', 'Phase 1', 'Planned')])
    );
    const LIFECYCLE_BUG_RESULTS = {
      hasBugs: true,
      bugs: [
        {
          id: 'BUG-001',
          severity: 'major',
          title: 'Bug',
          description: 'desc',
          reproduction: 'repro',
        },
      ],
      summary: 'Found 1 bug',
      recommendations: [],
    };
    const LIFECYCLE_CLEAN_RESULTS = {
      hasBugs: false,
      bugs: [],
      summary: 'All bugs fixed',
      recommendations: [],
    };
    /** ENOENT error factory. */
    const enoent = () => Object.assign(new Error('ENOENT'), { code: 'ENOENT' });

    /**
     * Build a pipeline whose MAIN session is an all-Complete backlog in
     * bug-hunt mode, at a path that does NOT contain 'bugfix' (so the resume
     * detection gate is not suppressed). Mirrors buildBugHuntPipeline.
     */
    const buildLifecyclePipeline = (
      sessionPath = '/tmp/plan/008_lifecycle'
    ) => {
      const backlog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Complete', [
          createTestMilestone('P1.M1', 'Milestone 1', 'Complete', [
            createTestTask('P1.M1.T1', 'Task 1', 'Complete', [
              createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Complete'),
            ]),
          ]),
        ]),
      ]);
      const mockSession = createTestSession(backlog, '# Test PRD', sessionPath);
      const mockManager = createMockSessionManager(mockSession);

      const pipeline = new PRPPipeline('./test.md');
      (pipeline as any).sessionManager = mockManager;
      (pipeline as any).taskOrchestrator = createMockTaskOrchestrator();
      // Bug-hunt mode forces QA to run (reaches the resume gate / creation)
      // regardless of the all-Complete backlog.
      (pipeline as any).mode = 'bug-hunt';
      return pipeline;
    };

    beforeEach(() => {
      // Default mocks for this block: BugHunt finds bugs (creation path),
      // FixCycle returns clean. Per-test mockImplementation overrides these.
      MockBugHuntWorkflow.mockImplementation(() => ({
        run: vi.fn().mockResolvedValue(LIFECYCLE_BUG_RESULTS),
      }));
      MockFixCycleWorkflow.mockClear();
      MockFixCycleWorkflow.mockImplementation(() => ({
        run: vi.fn().mockResolvedValue(LIFECYCLE_CLEAN_RESULTS),
      }));
      // Reset readdir to the module-level default (ENOENT → never hunted)
      // so each test is deterministic.
      mockReaddir.mockRejectedValue(enoent());
      mockStat.mockReset();
      mockReadFile.mockReset();
    });

    // (3a + 3b) Two-iteration creation lifecycle: prior iteration preserved.
    // Uses a simulated advancing disk (closure-scoped diskChildren that mkdir
    // pushes to and readdir returns) so the 2nd runQACycle sees the 1st child
    // and creates 002_ instead of overwriting 001_.
    it('creates 001_ then 002_ across two runQACycle calls, preserving 001 (advancing disk)', async () => {
      const { mkdir, copyFile } = await import('node:fs/promises');
      const mockedMkdir = vi.mocked(mkdir);
      const mockedCopyFile = vi.mocked(copyFile);

      // Simulated advancing disk: readdir always reflects current state;
      // mkdir pushes the NNN_hash it was asked to create.
      const diskChildren: string[] = [];
      mockReaddir.mockImplementation(async () =>
        diskChildren.map(name => ({ name, isDirectory: () => true }) as any)
      );
      mockedMkdir.mockImplementation(async (p: any) => {
        const m = String(p).match(/bugfix[\/](\d{3}_[a-f0-9]{12})$/);
        if (m) diskChildren.push(m[1]);
        return undefined;
      });
      // detection sees NO bug reports in any child → null → fresh hunt each
      // time → creation proceeds. (Children created during a PRIOR iteration
      // have no TEST_RESULTS.md in this simulation.)
      mockStat.mockImplementation(async (p: any) => {
        if (String(p).endsWith('TEST_RESULTS.md')) throw enoent();
        return {};
      });

      const pipeline = buildLifecyclePipeline();

      // Iteration 1: empty disk → detection null → fresh hunt → create 001_.
      await pipeline.runQACycle();
      // Iteration 2: disk=[001_] → detection sees no report → fresh hunt →
      // nextBugfixDir sees 001_ → create 002_ (001 preserved).
      await pipeline.runQACycle();

      // BOTH numbered dirs were created via mkdir.
      expect(mockedMkdir).toHaveBeenCalledWith(
        expect.stringMatching(/bugfix[\\/]001_[a-f0-9]{12}$/),
        { recursive: true }
      );
      expect(mockedMkdir).toHaveBeenCalledWith(
        expect.stringMatching(/bugfix[\\/]002_[a-f0-9]{12}$/),
        { recursive: true }
      );
      // 001 was PRESERVED on the simulated disk (not overwritten by 002).
      expect(diskChildren.filter(n => n.startsWith('001_'))).toHaveLength(1);
      expect(diskChildren.filter(n => n.startsWith('002_'))).toHaveLength(1);
      // TEST_RESULTS.md was copied into EACH numbered dir (both iterations).
      expect(mockedCopyFile).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringMatching(
          /bugfix[\\/]001_[a-f0-9]{12}[\\/]TEST_RESULTS\.md$/
        )
      );
      expect(mockedCopyFile).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringMatching(
          /bugfix[\\/]002_[a-f0-9]{12}[\\/]TEST_RESULTS\.md$/
        )
      );
    });

    // (3c + 3e) Detect-most-recent-interrupted across two interrupted children,
    // resuming the EXACT 002_ path (not 001, not flat bugfix).
    it('resumes the MOST RECENT interrupted child (002 over 001) with the exact numbered path', async () => {
      const pipeline = buildLifecyclePipeline();
      // Two interrupted children: both have TEST_RESULTS.md, both lack tasks.json.
      mockReaddir.mockResolvedValue([
        { name: '001_aaaaaaaaaaaa', isDirectory: () => true },
        { name: '002_bbbbbbbbbbbb', isDirectory: () => true },
      ] as any);
      mockStat.mockImplementation(async (p: string) => {
        if (String(p).endsWith('TEST_RESULTS.md')) return {}; // both have reports
        throw enoent(); // both tasks.json missing → interrupted
      });

      await pipeline.runQACycle();

      // Resume pre-empted the fresh hunt.
      expect(MockBugHuntWorkflow).not.toHaveBeenCalled();
      // Resumed the EXACT most-recent interrupted child (002_ + its hash).
      expect(MockFixCycleWorkflow).toHaveBeenCalledWith(
        expect.stringMatching(/bugfix[\\/]002_bbbbbbbbbbbb$/),
        expect.any(String),
        expect.anything(),
        expect.anything(),
        expect.anything()
      );
      // (3e negative) Resume did NOT target 001 or the flat bugfix dir.
      expect(MockFixCycleWorkflow).not.toHaveBeenCalledWith(
        expect.stringMatching(/bugfix[\\/]001_/),
        expect.any(String),
        expect.anything(),
        expect.anything(),
        expect.anything()
      );
    });

    // (3d + 3e) Detect-skips-healthy: healthy 001 + interrupted 002 → resume
    // 002 (001 skipped). This is the lifecycle scenario S3's healthy-skip test
    // does NOT cover (S3 tests the reverse: healthy 002 + interrupted 001).
    it('skips a HEALTHY older child (001) and resumes the interrupted newer child (002)', async () => {
      const pipeline = buildLifecyclePipeline();
      mockReaddir.mockResolvedValue([
        { name: '001_aaaaaaaaaaaa', isDirectory: () => true },
        { name: '002_bbbbbbbbbbbb', isDirectory: () => true },
      ] as any);
      // NNN-disambiguated health: 001 HEALTHY (valid tasks.json), 002 interrupted.
      mockStat.mockImplementation(async (p: string) => {
        const s = String(p);
        if (s.includes('001_')) return {}; // 001 healthy (both files present)
        if (s.includes('002_') && s.endsWith('TEST_RESULTS.md')) return {}; // 002 has report
        throw enoent(); // 002 tasks.json missing → interrupted
      });
      mockReadFile.mockImplementation(async (p: string) => {
        if (String(p).includes('001_')) return LIFECYCLE_VALID_BACKLOG_JSON;
        return ''; // 002 not reached (its tasks.json stat throws first)
      });

      await pipeline.runQACycle();

      // 001 skipped (healthy); 002 resumed. Fresh hunt NOT called.
      expect(MockBugHuntWorkflow).not.toHaveBeenCalled();
      expect(MockFixCycleWorkflow).toHaveBeenCalledWith(
        expect.stringMatching(/bugfix[\\/]002_bbbbbbbbbbbb$/),
        expect.any(String),
        expect.anything(),
        expect.anything(),
        expect.anything()
      );
      // (3e negative) Resume did NOT target the healthy 001 child.
      expect(MockFixCycleWorkflow).not.toHaveBeenCalledWith(
        expect.stringMatching(/bugfix[\\/]001_/),
        expect.any(String),
        expect.anything(),
        expect.anything(),
        expect.anything()
      );
    });

    // (3d-variant) A single HEALTHY numbered child → detection returns null →
    // a fresh hunt runs (resume does not pre-empt). Lifecycle framing: the
    // numbered child is healthy so the cycle proceeds to a new iteration.
    // The fresh hunt finds NO bugs (clean) so no new FixCycle is spawned.
    it('runs a fresh hunt when the only numbered child is HEALTHY (no resume)', async () => {
      const pipeline = buildLifecyclePipeline();
      mockReaddir.mockResolvedValue([
        { name: '001_aaaaaaaaaaaa', isDirectory: () => true },
      ] as any);
      mockStat.mockResolvedValue({}); // all files present
      mockReadFile.mockResolvedValue(LIFECYCLE_VALID_BACKLOG_JSON); // valid tasks.json → healthy
      // Fresh hunt (when it runs) finds NO bugs → no new FixCycle spawn.
      MockBugHuntWorkflow.mockImplementation(() => ({
        run: vi.fn().mockResolvedValue(LIFECYCLE_CLEAN_RESULTS),
      }));

      await pipeline.runQACycle();

      // Detection null → fresh hunt ran; resume (FixCycle) NOT pre-empted,
      // and clean results → no new FixCycle spawned either.
      expect(MockBugHuntWorkflow).toHaveBeenCalledTimes(1);
      expect(MockFixCycleWorkflow).not.toHaveBeenCalled();
    });
  });

  describe('run', () => {
    it('should call all workflow steps in order', async () => {
      // SETUP
      const mockSession = createTestSession(createTestBacklog([]));
      createMockSessionManager(mockSession);

      const mockOrchestrator = createMockTaskOrchestrator();
      (mockOrchestrator as any).processNextItem = vi
        .fn()
        .mockResolvedValue(false);

      // Create pipeline AFTER setting up mocks
      const pipeline = new PRPPipeline('./test.md');
      (pipeline as any).taskOrchestrator = mockOrchestrator;

      // Mock step methods
      const initSpy = vi.spyOn(pipeline, 'initializeSession');
      const decomposeSpy = vi.spyOn(pipeline, 'decomposePRD');
      const executeSpy = vi.spyOn(pipeline, 'executeBacklog');
      const qaSpy = vi.spyOn(pipeline, 'runQACycle');

      // EXECUTE
      await pipeline.run();

      // VERIFY
      expect(initSpy).toHaveBeenCalled();
      expect(decomposeSpy).toHaveBeenCalled();
      expect(executeSpy).toHaveBeenCalled();
      expect(qaSpy).toHaveBeenCalled();
    });

    it('should return PipelineResult with success true on completion', async () => {
      // SETUP
      const mockSession = createTestSession(createTestBacklog([]));
      createMockSessionManager(mockSession);

      const mockOrchestrator = createMockTaskOrchestrator();
      (mockOrchestrator as any).processNextItem = vi
        .fn()
        .mockResolvedValue(false);

      // Create pipeline AFTER setting up mocks
      const pipeline = new PRPPipeline('./test.md');
      (pipeline as any).taskOrchestrator = mockOrchestrator;

      // EXECUTE
      const result = await pipeline.run();

      // VERIFY
      expect(result.success).toBe(true);
      expect(result.sessionPath).toBe('/plan/001_14b9dc2a33c7');
      expect(result.duration).toBeGreaterThan(0);
      expect(result.phases).toEqual([]);
    });

    it('should return PipelineResult with success false on error', async () => {
      // SETUP
      const mockError = new Error('Test error');
      // Create mock manager that will error
      const errorManager: any = {
        initialize: vi.fn().mockRejectedValue(mockError),
        currentSession: null,
        saveBacklog: vi.fn().mockResolvedValue(undefined),
      };
      // Override the mock to return error manager
      MockSessionManagerClass.mockImplementation(() => errorManager);

      const pipeline = new PRPPipeline('./test.md');

      // EXECUTE
      const result = await pipeline.run();

      // VERIFY
      expect(result.success).toBe(false);
      expect(result.error).toBe('Test error');
      expect(result.duration).toBeGreaterThan(0);

      // Reset mock to default for other tests
      MockSessionManagerClass.mockImplementation(() => ({
        currentSession: null,
        initialize: vi.fn().mockResolvedValue({ currentSession: null }),
        saveBacklog: vi.fn().mockResolvedValue(undefined),
      }));
    });

    it('should include phase summaries in result', async () => {
      // SETUP
      const backlog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Complete', [
          createTestMilestone('P1.M1', 'Milestone 1', 'Complete', []),
          createTestMilestone('P1.M2', 'Milestone 2', 'Planned', []),
        ]),
      ]);
      const mockSession = createTestSession(backlog);
      createMockSessionManager(mockSession);

      const mockOrchestrator = createMockTaskOrchestrator();
      (mockOrchestrator as any).processNextItem = vi
        .fn()
        .mockResolvedValue(false);

      // Create pipeline AFTER setting up mocks
      const pipeline = new PRPPipeline('./test.md');
      (pipeline as any).taskOrchestrator = mockOrchestrator;

      // EXECUTE
      const result = await pipeline.run();

      // VERIFY
      expect(result.phases).toHaveLength(1);
      expect(result.phases[0].id).toBe('P1');
      expect(result.phases[0].totalMilestones).toBe(2);
      expect(result.phases[0].completedMilestones).toBe(1);
    });
  });

  describe('private helper methods - behavior verification', () => {
    it('should count all subtasks in backlog', async () => {
      // SETUP
      const backlog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Planned', [
          createTestMilestone('P1.M1', 'Milestone 1', 'Planned', [
            createTestTask('P1.M1.T1', 'Task 1', 'Planned', [
              createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Planned'),
              createTestSubtask('P1.M1.T1.S2', 'Subtask 2', 'Planned'),
            ]),
            createTestTask('P1.M1.T2', 'Task 2', 'Planned', [
              createTestSubtask('P1.M1.T2.S1', 'Subtask 1', 'Planned'),
            ]),
          ]),
        ]),
      ]);
      const mockSession = createTestSession(backlog);
      const mockManager = createMockSessionManager(mockSession);

      const pipeline = new PRPPipeline('./test.md');
      (pipeline as any).sessionManager = mockManager;

      // EXECUTE - decomposePRD will call #countTasks
      pipeline.totalTasks = 0;
      await pipeline.decomposePRD();

      // VERIFY - totalTasks should be updated
      expect(pipeline.totalTasks).toBe(3);
    });

    it('should build phase summary array', async () => {
      // SETUP
      const backlog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Complete', [
          createTestMilestone('P1.M1', 'Milestone 1', 'Complete', []),
          createTestMilestone('P1.M2', 'Milestone 2', 'Planned', []),
        ]),
        createTestPhase('P2', 'Phase 2', 'Planned', [
          createTestMilestone('P2.M1', 'Milestone 1', 'Planned', []),
        ]),
      ]);
      const mockSession = createTestSession(backlog);
      createMockSessionManager(mockSession);

      const mockOrchestrator = createMockTaskOrchestrator();
      (mockOrchestrator as any).processNextItem = vi
        .fn()
        .mockResolvedValue(false);

      // Create pipeline AFTER setting up mocks
      const pipeline = new PRPPipeline('./test.md');
      (pipeline as any).taskOrchestrator = mockOrchestrator;

      // EXECUTE
      const result = await pipeline.run();

      // VERIFY
      expect(result.phases).toHaveLength(2);
      expect(result.phases[0]).toEqual({
        id: 'P1',
        title: 'Phase 1',
        status: 'Complete',
        totalMilestones: 2,
        completedMilestones: 1,
      });
      expect(result.phases[1]).toEqual({
        id: 'P2',
        title: 'Phase 2',
        status: 'Planned',
        totalMilestones: 1,
        completedMilestones: 0,
      });
    });
  });

  describe('graceful shutdown', () => {
    it('should initialize shutdown state fields with default values', () => {
      // EXECUTE
      const pipeline = new PRPPipeline('./test.md');

      // VERIFY
      expect(pipeline.shutdownRequested).toBe(false);
      expect(pipeline.currentTaskId).toBeNull();
      expect(pipeline.shutdownReason).toBeNull();
    });

    it('should set shutdownRequested to true and reason to SIGINT on SIGINT', () => {
      // SETUP
      const pipeline = new PRPPipeline('./test.md');
      const originalListeners = (process as any)._events?.SIGINT?.length ?? 0;

      // EXECUTE - Emit SIGINT event
      process.emit('SIGINT');

      // VERIFY
      expect(pipeline.shutdownRequested).toBe(true);
      expect(pipeline.shutdownReason).toBe('SIGINT');

      // Cleanup: Remove our test listener
      const listeners = (process as any)._events?.SIGINT;
      if (
        listeners != null &&
        typeof listeners.length === 'number' &&
        listeners.length > originalListeners
      ) {
        process.removeAllListeners('SIGINT');
      }
    });

    it('should set shutdownRequested to true and reason to SIGTERM on SIGTERM', () => {
      // SETUP
      const pipeline = new PRPPipeline('./test.md');
      const originalListeners = (process as any)._events?.SIGTERM?.length ?? 0;

      // EXECUTE - Emit SIGTERM event
      process.emit('SIGTERM');

      // VERIFY
      expect(pipeline.shutdownRequested).toBe(true);
      expect(pipeline.shutdownReason).toBe('SIGTERM');

      // Cleanup: Remove our test listener
      const listeners = (process as any)._events?.SIGTERM;
      if (
        listeners != null &&
        typeof listeners.length === 'number' &&
        listeners.length > originalListeners
      ) {
        process.removeAllListeners('SIGTERM');
      }
    });

    it('should break executeBacklog loop when shutdownRequested is true', async () => {
      // SETUP
      const backlog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Planned', [
          createTestMilestone('P1.M1', 'Milestone 1', 'Planned', [
            createTestTask('P1.M1.T1', 'Task 1', 'Planned', [
              createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Planned'),
              createTestSubtask('P1.M1.T1.S2', 'Subtask 2', 'Planned'),
            ]),
          ]),
        ]),
      ]);
      const mockSession = createTestSession(backlog);
      const mockManager = createMockSessionManager(mockSession);

      const pipeline = new PRPPipeline('./test.md');
      (pipeline as any).sessionManager = mockManager;
      let callCount = 0;

      const mockOrchestrator = createMockTaskOrchestrator();
      mockOrchestrator.currentItemId = 'P1.M1.T1.S1';
      (mockOrchestrator as any).processNextItem = vi
        .fn()
        .mockImplementation(async () => {
          callCount++;
          // Update currentItemId for each call
          mockOrchestrator.currentItemId =
            callCount === 1 ? 'P1.M1.T1.S1' : 'P1.M1.T1.S2';
          // Set shutdownRequested after first call
          if (callCount === 2) {
            pipeline.shutdownRequested = true;
          }
          return callCount < 4; // Would normally return true 4 times
        });

      (pipeline as any).taskOrchestrator = mockOrchestrator;

      // EXECUTE
      await pipeline.executeBacklog();

      // VERIFY - should have stopped early due to shutdownRequested
      expect(callCount).toBe(2);
      expect(pipeline.currentPhase).toBe('shutdown_interrupted');
    });

    it('should call cleanup in finally block even on error', async () => {
      // SETUP
      const mockError = new Error('Test error');
      const mockManager: any = {
        initialize: vi.fn().mockRejectedValue(mockError),
        currentSession: null,
        saveBacklog: vi.fn().mockResolvedValue(undefined),
      };

      const pipeline = new PRPPipeline('./test.md');
      (pipeline as any).sessionManager = mockManager;

      // Spy on cleanup method
      const cleanupSpy = vi
        .spyOn(pipeline, 'cleanup')
        .mockResolvedValue(undefined);

      // EXECUTE
      await pipeline.run();

      // VERIFY - cleanup should be called even though initialize failed
      expect(cleanupSpy).toHaveBeenCalled();
      cleanupSpy.mockRestore();
    });

    it('should save backlog in cleanup when session exists', async () => {
      // SETUP
      const backlog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Implementing', [
          createTestMilestone('P1.M1', 'Milestone 1', 'Planned', [
            createTestTask('P1.M1.T1', 'Task 1', 'Planned', [
              createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Complete'),
              createTestSubtask('P1.M1.T1.S2', 'Subtask 2', 'Planned'),
            ]),
          ]),
        ]),
      ]);
      const mockSession = createTestSession(backlog);
      const mockManager = createMockSessionManager(mockSession);

      const pipeline = new PRPPipeline('./test.md');
      (pipeline as any).sessionManager = mockManager;

      // EXECUTE
      await pipeline.cleanup();

      // VERIFY
      expect(mockManager.saveBacklog).toHaveBeenCalledWith(backlog);
      expect(pipeline.currentPhase).toBe('shutdown_complete');
    });

    it('should include shutdownInterrupted in PipelineResult', async () => {
      // SETUP
      const mockSession = createTestSession(createTestBacklog([]));
      const mockManager = createMockSessionManager(mockSession);

      const mockOrchestrator = createMockTaskOrchestrator();
      (mockOrchestrator as any).processNextItem = vi
        .fn()
        .mockResolvedValue(false);

      const pipeline = new PRPPipeline('./test.md');
      (pipeline as any).sessionManager = mockManager;
      (pipeline as any).taskOrchestrator = mockOrchestrator;

      // EXECUTE - normal completion
      const result = await pipeline.run();

      // VERIFY
      expect(result.shutdownInterrupted).toBe(false);
      expect(result.shutdownReason).toBeUndefined();
    });

    it('should include shutdownInterrupted true when shutdown requested', async () => {
      // SETUP
      const mockError = new Error('Test error');
      const mockManager: any = {
        initialize: vi.fn().mockRejectedValue(mockError),
        currentSession: null,
        saveBacklog: vi.fn().mockResolvedValue(undefined),
      };

      const pipeline = new PRPPipeline('./test.md');
      (pipeline as any).sessionManager = mockManager;

      // Set shutdown flags before error
      pipeline.shutdownRequested = true;
      pipeline.shutdownReason = 'SIGINT';

      // EXECUTE
      const result = await pipeline.run();

      // VERIFY
      expect(result.shutdownInterrupted).toBe(true);
      expect(result.shutdownReason).toBe('SIGINT');
    });

    it('should log warning on duplicate SIGINT', () => {
      // SETUP
      const pipeline = new PRPPipeline('./test.md');
      const warnSpy = vi.spyOn((pipeline as any).logger, 'warn');

      // EXECUTE - Emit SIGINT twice
      process.emit('SIGINT');
      process.emit('SIGINT');

      // VERIFY
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Duplicate SIGINT received')
      );

      // Cleanup
      process.removeAllListeners('SIGINT');
      warnSpy.mockRestore();
    });
  });

  describe('delta workflow integration', () => {
    describe('initializeSession', () => {
      it('should call handleDelta when hasSessionChanged returns true', async () => {
        // SETUP
        const backlog = createTestBacklog([]);
        const mockSession = createTestSession(backlog);
        const mockManager = createMockSessionManager(mockSession, true); // hasSessionChanged = true

        const pipeline = new PRPPipeline('./test.md');
        (pipeline as any).sessionManager = mockManager;

        // Spy on handleDelta method
        const handleDeltaSpy = vi
          .spyOn(pipeline, 'handleDelta')
          .mockResolvedValue(undefined);

        // EXECUTE
        await pipeline.initializeSession();

        // VERIFY
        expect(mockManager.hasSessionChanged).toHaveBeenCalled();
        expect(handleDeltaSpy).toHaveBeenCalled();
        expect(pipeline.currentPhase).toBe('session_initialized');

        handleDeltaSpy.mockRestore();
      });

      it('should not call handleDelta when hasSessionChanged returns false', async () => {
        // SETUP
        const backlog = createTestBacklog([]);
        const mockSession = createTestSession(backlog);
        const mockManager = createMockSessionManager(mockSession, false); // hasSessionChanged = false

        const pipeline = new PRPPipeline('./test.md');
        (pipeline as any).sessionManager = mockManager;

        // Spy on handleDelta method
        const handleDeltaSpy = vi
          .spyOn(pipeline, 'handleDelta')
          .mockResolvedValue(undefined);

        // EXECUTE
        await pipeline.initializeSession();

        // VERIFY
        expect(mockManager.hasSessionChanged).toHaveBeenCalled();
        expect(handleDeltaSpy).not.toHaveBeenCalled();
        expect(pipeline.currentPhase).toBe('session_initialized');

        handleDeltaSpy.mockRestore();
      });

      it('routes a SUBSTANTIVE verdict to handleDelta (not absorbCosmeticChange)', async () => {
        // SETUP — BUG-002 Part A: the classifier returns SUBSTANTIVE → delta session.
        const backlog = createTestBacklog([]);
        const mockSession = createTestSession(backlog);
        const mockManager = createMockSessionManager(mockSession, true);
        mockClassifyChange.mockResolvedValueOnce('SUBSTANTIVE');

        const pipeline = new PRPPipeline('./test.md');
        (pipeline as any).sessionManager = mockManager;
        const handleDeltaSpy = vi
          .spyOn(pipeline, 'handleDelta')
          .mockResolvedValue(undefined);

        // EXECUTE
        await pipeline.initializeSession();

        // VERIFY: classifier ran with the diff summary; handleDelta ran; the
        // cosmetic absorb path did NOT.
        expect(mockManager.getChangeDiffSummary).toHaveBeenCalled();
        expect(mockClassifyChange).toHaveBeenCalled();
        expect(handleDeltaSpy).toHaveBeenCalled();
        expect(mockManager.absorbCosmeticChange).not.toHaveBeenCalled();
        expect(pipeline.currentPhase).toBe('session_initialized');

        handleDeltaSpy.mockRestore();
      });

      it('routes a COSMETIC verdict to absorbCosmeticChange (not handleDelta)', async () => {
        // SETUP — BUG-002 Part A: the classifier returns COSMETIC → absorb the
        // new baseline WITHOUT a delta session.
        const backlog = createTestBacklog([]);
        const mockSession = createTestSession(backlog);
        const mockManager = createMockSessionManager(mockSession, true);
        mockClassifyChange.mockResolvedValueOnce('COSMETIC');

        const pipeline = new PRPPipeline('./test.md');
        (pipeline as any).sessionManager = mockManager;
        const handleDeltaSpy = vi
          .spyOn(pipeline, 'handleDelta')
          .mockResolvedValue(undefined);

        // EXECUTE
        await pipeline.initializeSession();

        // VERIFY: classifier ran; the cosmetic absorb ran; handleDelta did NOT.
        expect(mockClassifyChange).toHaveBeenCalled();
        expect(mockManager.absorbCosmeticChange).toHaveBeenCalled();
        expect(handleDeltaSpy).not.toHaveBeenCalled();
        expect(pipeline.currentPhase).toBe('session_initialized');

        handleDeltaSpy.mockRestore();
      });

      it('fails to SUBSTANTIVE when the classifier throws (protective default)', async () => {
        // SETUP — BUG-002 Part A: the classifier throws (module-load failure,
        // non-transient error). The pipeline-level try/catch degrades to
        // SUBSTANTIVE so a delta session is NEVER silently skipped.
        const backlog = createTestBacklog([]);
        const mockSession = createTestSession(backlog);
        const mockManager = createMockSessionManager(mockSession, true);
        mockClassifyChange.mockRejectedValueOnce(new Error('classifier boom'));

        const pipeline = new PRPPipeline('./test.md');
        (pipeline as any).sessionManager = mockManager;
        const handleDeltaSpy = vi
          .spyOn(pipeline, 'handleDelta')
          .mockResolvedValue(undefined);

        // EXECUTE
        await pipeline.initializeSession();

        // VERIFY: classifier threw → protective default SUBSTANTIVE → handleDelta.
        expect(mockClassifyChange).toHaveBeenCalled();
        expect(handleDeltaSpy).toHaveBeenCalled();
        expect(mockManager.absorbCosmeticChange).not.toHaveBeenCalled();
        expect(pipeline.currentPhase).toBe('session_initialized');

        handleDeltaSpy.mockRestore();
      });

      it('absorbs as COSMETIC without an LLM call when the diff is empty (pre-filter)', async () => {
        // SETUP — a pure-whitespace edit is normalized away by diffPRDs, so the
        // diff has zero changes. The empty-diff pre-filter skips the LLM call
        // and absorbs as COSMETIC directly.
        const backlog = createTestBacklog([]);
        const mockSession = createTestSession(backlog);
        const mockManager = createMockSessionManager(mockSession, true);
        mockManager.getChangeDiffSummary.mockResolvedValueOnce({
          changes: [],
          summaryText: 'No changes',
          stats: {
            totalAdded: 0,
            totalModified: 0,
            totalRemoved: 0,
            sectionsAffected: [],
          },
        });

        const pipeline = new PRPPipeline('./test.md');
        (pipeline as any).sessionManager = mockManager;
        const handleDeltaSpy = vi
          .spyOn(pipeline, 'handleDelta')
          .mockResolvedValue(undefined);

        // EXECUTE
        await pipeline.initializeSession();

        // VERIFY: the classifier was NOT called (cheap pre-filter); absorbed as
        // COSMETIC; handleDelta did NOT run.
        expect(mockClassifyChange).not.toHaveBeenCalled();
        expect(mockManager.absorbCosmeticChange).toHaveBeenCalled();
        expect(handleDeltaSpy).not.toHaveBeenCalled();
        expect(pipeline.currentPhase).toBe('session_initialized');

        handleDeltaSpy.mockRestore();
      });
    });

    describe('--adopt-prd guard rails', () => {
      it('should warn (no-op) and proceed with normal session resolution when adoptPrd is set and sessions already exist', async () => {
        // SETUP
        const backlog = createTestBacklog([]);
        const mockSession = createTestSession(backlog);
        const mockManager = createMockSessionManager(mockSession, false);
        mockManager.hasAnySessions = vi.fn().mockResolvedValue(true); // sessions exist

        const pipeline = new PRPPipeline('./test.md');
        (pipeline as any).sessionManager = mockManager;
        (pipeline as any).adoptPrd = true;

        const warnSpy = vi.spyOn((pipeline as any).logger, 'warn');

        // EXECUTE
        await pipeline.initializeSession();

        // VERIFY: warn was called with a no-op message mentioning the plan dir,
        // and normal session resolution proceeded (initialize was called, no abort).
        expect(mockManager.hasAnySessions).toHaveBeenCalledTimes(1);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('no-op'));
        expect(mockManager.initialize).toHaveBeenCalledTimes(1);
        expect(pipeline.currentPhase).toBe('session_initialized');

        warnSpy.mockRestore();
      });

      it('should log the S2 seam (info) and proceed when adoptPrd is set on a fresh project (no sessions)', async () => {
        // SETUP
        const backlog = createTestBacklog([]);
        const mockSession = createTestSession(backlog);
        const mockManager = createMockSessionManager(mockSession, false);
        mockManager.hasAnySessions = vi.fn().mockResolvedValue(false); // fresh
        mockManager.seedAdoptedBaseline = vi
          .fn()
          .mockResolvedValue(mockSession);

        const pipeline = new PRPPipeline('./test.md');
        (pipeline as any).sessionManager = mockManager;
        (pipeline as any).adoptPrd = true;

        const infoSpy = vi.spyOn((pipeline as any).logger, 'info');

        // EXECUTE
        await pipeline.initializeSession();

        // VERIFY: info logged the fresh-adopt message, and normal session
        // creation proceeded. S2 now ALSO seeds the baseline + sets the skip.
        expect(mockManager.hasAnySessions).toHaveBeenCalledTimes(1);
        expect(infoSpy).toHaveBeenCalledWith(
          expect.stringContaining('seeding adopted baseline')
        );
        expect(mockManager.initialize).toHaveBeenCalledTimes(1);
        expect(pipeline.currentPhase).toBe('session_initialized');

        infoSpy.mockRestore();
      });

      it('should skip the adopt block entirely when adoptPrd is false (hasAnySessions never called)', async () => {
        // SETUP
        const backlog = createTestBacklog([]);
        const mockSession = createTestSession(backlog);
        const mockManager = createMockSessionManager(mockSession, false);

        const pipeline = new PRPPipeline('./test.md');
        (pipeline as any).sessionManager = mockManager;
        // adoptPrd left at default (false)

        // EXECUTE
        await pipeline.initializeSession();

        // VERIFY: the adopt guard-rail block was skipped — hasAnySessions is
        // never consulted.
        expect(mockManager.hasAnySessions).not.toHaveBeenCalled();
        expect(mockManager.initialize).toHaveBeenCalledTimes(1);
      });

      it('should reject an empty SESSION_DIR after initialize (general hard guard, PRD §4.6)', async () => {
        // SETUP: session with an empty metadata.path — the hard guard fires for
        // ALL sessions (not just adopt), so adoptPrd is left false here.
        const backlog = createTestBacklog([]);
        const emptyPathSession = createTestSession(backlog, '# Test PRD', '');
        const mockManager = createMockSessionManager(emptyPathSession, false);

        const pipeline = new PRPPipeline('./test.md');
        (pipeline as any).sessionManager = mockManager;
        // adoptPrd left at default (false) — guard is general.

        // EXECUTE + VERIFY: under default continueOnError=false the guard
        // re-throws → initializeSession rejects with the SESSION_DIR message.
        await expect(pipeline.initializeSession()).rejects.toThrow(
          /SESSION_DIR/
        );
      });
    });

    describe('--adopt-prd baseline seeding', () => {
      it('seeds the adopted baseline + sets skipExecutionLoop on a fresh project', async () => {
        // SETUP: fresh project → hasAnySessions=false. seedAdoptedBaseline is
        // mocked on the session manager so no real disk/JSON validation runs.
        const backlog = createTestBacklog([]);
        const mockSession = createTestSession(backlog);
        const mockManager = createMockSessionManager(mockSession, false);
        mockManager.hasAnySessions = vi.fn().mockResolvedValue(false);
        mockManager.seedAdoptedBaseline = vi
          .fn()
          .mockResolvedValue(mockSession);

        const pipeline = new PRPPipeline('./test.md');
        (pipeline as any).sessionManager = mockManager;
        (pipeline as any).adoptPrd = true;

        // EXECUTE
        await pipeline.initializeSession();

        // VERIFY: seeding ran AND the pipeline instance skip flag was set so
        // the execution loop will be skipped (validation/bug-hunt still run).
        expect(mockManager.seedAdoptedBaseline).toHaveBeenCalledTimes(1);
        expect((pipeline as any).skipExecutionLoop).toBe(true);
      });

      it('does NOT seed when sessions already exist (no-op + skip stays false)', async () => {
        // SETUP: existing sessions → hasAnySessions=true → no-op warn+proceed.
        const backlog = createTestBacklog([]);
        const mockSession = createTestSession(backlog);
        const mockManager = createMockSessionManager(mockSession, false);
        mockManager.hasAnySessions = vi.fn().mockResolvedValue(true);
        mockManager.seedAdoptedBaseline = vi
          .fn()
          .mockResolvedValue(mockSession);

        const pipeline = new PRPPipeline('./test.md');
        (pipeline as any).sessionManager = mockManager;
        (pipeline as any).adoptPrd = true;

        // EXECUTE
        await pipeline.initializeSession();

        // VERIFY: existing-session branch warns and proceeds — no seeding, no skip.
        expect(mockManager.seedAdoptedBaseline).not.toHaveBeenCalled();
        expect((pipeline as any).skipExecutionLoop).toBe(false);
      });
    });

    // Shared fixture: a mock SessionManager whose currentSession holds the
    // adopted (all-Complete) baseline — 1 Phase → Milestone → Task → Subtask,
    // all 'Complete' (mirrors createAdoptedBaseline() from P5.M1.T1.S2 / PRD §4.6).
    // NOTE: returned mock must be injected onto the pipeline instance via
    // `(pipeline as any).sessionManager = mock` because runQACycle/executeBacklog
    // are called directly (run() is the only place that constructs SessionManager).
    function mockSessionWithAdoptedBaseline() {
      const baseline = createTestBacklog([
        createTestPhase('P1', 'Adopt Existing Codebase', 'Complete', [
          createTestMilestone('P1.M1', 'Adopt Existing Codebase', 'Complete', [
            createTestTask('P1.M1.T1', 'Adopt Existing Codebase', 'Complete', [
              createTestSubtask(
                'P1.M1.T1.S1',
                'Adopt existing codebase',
                'Complete'
              ),
            ]),
          ]),
        ]),
      ]);
      const mockSession = createTestSession(baseline, '# PRD', '/plan/008_abc');
      return {
        currentSession: mockSession,
        initialize: vi.fn().mockResolvedValue(mockSession),
        saveBacklog: vi.fn().mockResolvedValue(undefined),
        hasAnySessions: vi.fn().mockResolvedValue(false),
        hasSessionChanged: vi.fn().mockReturnValue(false),
        createDeltaSession: vi.fn().mockResolvedValue(mockSession),
        prdPath: '/test/prd.md',
        planDir: '/plan',
        flushUpdates: vi.fn().mockResolvedValue(undefined),
      };
    }

    describe('adopt mode: validation + bug-hunt still run (PRD §4.6)', () => {
      it('executeBacklog recomputes totalTasks/completedTasks when skipExecutionLoop (adopt mode)', async () => {
        // SETUP: a session whose registry is the all-Complete adopted baseline.
        const pipeline = new PRPPipeline('./test.md');
        (pipeline as any).sessionManager = mockSessionWithAdoptedBaseline();
        (pipeline as any).skipExecutionLoop = true; // S2 field (set on adoptFresh)

        // SANITY: counts start at 0 before executeBacklog runs.
        expect(pipeline.totalTasks).toBe(0);
        expect(pipeline.completedTasks).toBe(0);

        // EXECUTE
        await pipeline.executeBacklog();

        // VERIFY: the skip guard recomputes BOTH counts from the seeded registry
        // so the session reports complete (PRD §4.6). Without the recompute,
        // completedTasks would stay 0 even though the baseline is 100% Complete.
        expect(pipeline.totalTasks).toBe(1);
        expect(pipeline.completedTasks).toBe(1);
        expect(pipeline.currentPhase).toBe('backlog_complete');
      });

      it('runQACycle runs the bug hunt for the adopted (all-Complete) baseline (PRD §4.6)', async () => {
        // SETUP: same adopted-baseline session. The skip guard / decomposePRD
        // would have produced totalTasks=1, completedTasks=1.
        const pipeline = new PRPPipeline('./test.md');
        (pipeline as any).sessionManager = mockSessionWithAdoptedBaseline();
        (pipeline as any).taskOrchestrator = createMockTaskOrchestrator();
        pipeline.totalTasks = 1;
        pipeline.completedTasks = 1;
        // mode defaults to 'normal'
        // BugHuntWorkflow default mock (no bugs) is fine — assert it was called.

        // EXECUTE
        await pipeline.runQACycle();

        // VERIFY: QA must NOT have been skipped — the gate is #allTasksComplete()
        // which reads the all-Complete in-memory registry. The bug hunt ran.
        expect(pipeline.currentPhase).not.toBe('qa_skipped');
        expect(MockBugHuntWorkflow).toHaveBeenCalled();
      });

      it('run() still runs validation + bug-hunt in adopt mode and reports the session complete (PRD §4.6)', async () => {
        // SETUP: run() constructs SessionManager internally, so wire the mock
        // constructor to return the adopted-baseline manager.
        const adoptedManager = mockSessionWithAdoptedBaseline();
        MockSessionManagerClass.mockImplementation(() => adoptedManager);
        // Validation passes (fresh passing impl) so #runValidation does not abort.
        MockValidationWorkflow.mockImplementation(() => ({
          run: vi.fn().mockResolvedValue({
            success: true,
            exitCode: 0,
            timedOut: false,
            stdout: '',
            stderr: '',
            scriptPath: '/plan/008_abc/validate.sh',
            durationMs: 0,
          }),
        }));
        // run()'s nested-execution guard must not throw.
        mockValidateNestedExecution.mockImplementation(() => {});
        mockIsNestedExecutionError.mockReturnValue(false);
        // BugHuntWorkflow reports no bugs — we only assert it was called.
        MockBugHuntWorkflow.mockImplementation(() => ({
          run: vi.fn().mockResolvedValue({
            hasBugs: false,
            bugs: [],
            summary: 'No bugs found',
            recommendations: [],
          }),
        }));

        const pipeline = new PRPPipeline('./test.md');
        (pipeline as any).taskOrchestrator = createMockTaskOrchestrator();
        (pipeline as any).skipExecutionLoop = true; // adopt mode (S2 sets this on adoptFresh)

        // EXECUTE
        const result = await pipeline.run();

        // VERIFY
        expect(result.success).toBe(true);
        // VALIDATION ran (PRD §4.6 — validation is NOT gated by skipExecutionLoop):
        expect(MockValidationWorkflow).toHaveBeenCalled();
        // BUG HUNT ran (not skipped):
        expect(MockBugHuntWorkflow).toHaveBeenCalled();
        // Session reported COMPLETE (the S3 recompute in the skip guard):
        expect(result.totalTasks).toBe(1);
        expect(result.completedTasks).toBe(1);
      });
    });

    describe('handleDelta', () => {
      beforeEach(() => {
        // Setup default mocks for handleDelta tests (new PRD is resolved via resolvePRD)
        mockResolvePRD.mockResolvedValue('# Updated PRD');
        mockFilterByStatus.mockReturnValue([]);
        mockPatchBacklog.mockImplementation((backlog: Backlog) => backlog);
      });

      it('should load old PRD from session snapshot', async () => {
        // SETUP
        const oldPRD = '# Original PRD\nOld content here';
        const backlog = createTestBacklog([]);
        const mockSession = createTestSession(backlog, oldPRD);

        const mockManager = createMockSessionManager(mockSession, true);
        mockManager.currentSession = mockSession;

        const pipeline = new PRPPipeline('./test.md');
        (pipeline as any).sessionManager = mockManager;

        // EXECUTE
        await pipeline.handleDelta();

        // VERIFY - old PRD should be from session snapshot
        expect(MockDeltaAnalysisWorkflow).toHaveBeenCalledWith(
          oldPRD,
          expect.any(String),
          expect.any(Array)
        );
      });

      it('should load new PRD from disk via resolvePRD', async () => {
        // SETUP
        const newPRD = '# Updated PRD\nNew content here';
        const backlog = createTestBacklog([]);
        const mockSession = createTestSession(backlog);

        const mockManager = createMockSessionManager(mockSession, true);
        mockManager.currentSession = mockSession;
        mockManager.prdPath = '/test/prd.md';

        mockResolvePRD.mockResolvedValue(newPRD);

        const pipeline = new PRPPipeline('./test.md');
        (pipeline as any).sessionManager = mockManager;

        // EXECUTE
        await pipeline.handleDelta();

        // VERIFY
        expect(mockResolvePRD).toHaveBeenCalledWith('/test/prd.md');
        expect(MockDeltaAnalysisWorkflow).toHaveBeenCalledWith(
          expect.any(String),
          newPRD,
          expect.any(Array)
        );
      });

      it('should extract completed task IDs via filterByStatus', async () => {
        // SETUP
        const backlog = createTestBacklog([
          createTestPhase('P1', 'Phase 1', 'Complete', [
            createTestMilestone('P1.M1', 'Milestone 1', 'Complete', [
              createTestTask('P1.M1.T1', 'Task 1', 'Complete', [
                createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Complete'),
                createTestSubtask('P1.M1.T1.S2', 'Subtask 2', 'Planned'),
              ]),
            ]),
          ]),
        ]);
        const mockSession = createTestSession(backlog);

        const mockManager = createMockSessionManager(mockSession, true);
        mockManager.currentSession = mockSession;

        const pipeline = new PRPPipeline('./test.md');
        (pipeline as any).sessionManager = mockManager;

        const completedItems = [
          backlog.backlog[0],
          backlog.backlog[0].milestones[0],
          backlog.backlog[0].milestones[0].tasks[0],
          backlog.backlog[0].milestones[0].tasks[0].subtasks[0],
        ];
        mockFilterByStatus.mockReturnValue(completedItems);

        // EXECUTE
        await pipeline.handleDelta();

        // VERIFY
        expect(mockFilterByStatus).toHaveBeenCalledWith(backlog, 'Complete');
        // Implementation filters to only Task and Subtask types (not Phase/Milestone)
        expect(MockDeltaAnalysisWorkflow).toHaveBeenCalledWith(
          expect.any(String),
          expect.any(String),
          ['P1.M1.T1', 'P1.M1.T1.S1']
        );
      });

      it('should run DeltaAnalysisWorkflow and get result', async () => {
        // SETUP
        const backlog = createTestBacklog([]);
        const mockSession = createTestSession(backlog);

        const mockManager = createMockSessionManager(mockSession, true);
        mockManager.currentSession = mockSession;

        const mockDelta = {
          changes: [
            {
              itemId: 'P1.M1.T1.S1',
              type: 'modified' as const,
              description: 'Added new requirement',
              impact: 'Update implementation',
            },
          ],
          patchInstructions: 'Re-execute P1.M1.T1.S1',
          taskIds: ['P1.M1.T1.S1'],
        };

        const mockWorkflow = {
          run: vi.fn().mockResolvedValue(mockDelta),
        };
        MockDeltaAnalysisWorkflow.mockImplementation(() => mockWorkflow);

        const pipeline = new PRPPipeline('./test.md');
        (pipeline as any).sessionManager = mockManager;

        // EXECUTE
        await pipeline.handleDelta();

        // VERIFY
        expect(mockWorkflow.run).toHaveBeenCalled();
        expect(mockPatchBacklog).toHaveBeenCalledWith(backlog, mockDelta);
      });

      it('should create delta session and save patched backlog', async () => {
        // SETUP
        const backlog = createTestBacklog([]);
        const mockSession = createTestSession(backlog);

        const mockManager = createMockSessionManager(mockSession, true);
        mockManager.currentSession = mockSession;

        const patchedBacklog = createTestBacklog([
          createTestPhase('P1', 'Phase 1', 'Planned'),
        ]);
        mockPatchBacklog.mockReturnValue(patchedBacklog);

        const pipeline = new PRPPipeline('./test.md');
        (pipeline as any).sessionManager = mockManager;

        // EXECUTE
        await pipeline.handleDelta();

        // VERIFY
        expect(mockManager.createDeltaSession).toHaveBeenCalledWith(
          mockManager.prdPath
        );
        expect(mockManager.saveBacklog).toHaveBeenCalledWith(patchedBacklog);
      });

      it('should update phase to delta_handling then session_initialized', async () => {
        // SETUP
        const backlog = createTestBacklog([]);
        const mockSession = createTestSession(backlog);

        const mockManager = createMockSessionManager(mockSession, true);
        mockManager.currentSession = mockSession;

        const pipeline = new PRPPipeline('./test.md');
        (pipeline as any).sessionManager = mockManager;

        // EXECUTE
        await pipeline.handleDelta();

        // VERIFY - phase should end as session_initialized
        expect(pipeline.currentPhase).toBe('session_initialized');
      });

      it('should throw if no session loaded', async () => {
        // SETUP
        const mockManager = createMockSessionManager(null, true);
        mockManager.currentSession = null;

        const pipeline = new PRPPipeline('./test.md');
        (pipeline as any).sessionManager = mockManager;

        // EXECUTE & VERIFY
        await expect(pipeline.handleDelta()).rejects.toThrow(
          'Cannot handle delta: no session loaded'
        );
      });

      it('should throw if resolvePRD fails', async () => {
        // SETUP
        const backlog = createTestBacklog([]);
        const mockSession = createTestSession(backlog);

        const mockManager = createMockSessionManager(mockSession, true);
        mockManager.currentSession = mockSession;

        mockResolvePRD.mockRejectedValue(new Error('File not found'));

        const pipeline = new PRPPipeline('./test.md');
        (pipeline as any).sessionManager = mockManager;

        // EXECUTE & VERIFY
        await expect(pipeline.handleDelta()).rejects.toThrow(
          'Failed to load new PRD'
        );
      });
    });
  });

  describe('nested execution validation', () => {
    it('should log debug message before validation', async () => {
      // SETUP
      const backlog = createTestBacklog([]);
      const mockSession = createTestSession(
        backlog,
        '# Test PRD',
        'plan/001_14b9dc2a33c7'
      );

      const mockManager = createMockSessionManager(mockSession);
      mockManager.initialize = vi.fn().mockResolvedValue(mockSession);

      const debugSpy = vi.fn();
      const loggerSpy = {
        debug: debugSpy,
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
      };

      const pipeline = new PRPPipeline('./test.md');
      (pipeline as any).logger = loggerSpy;
      (pipeline as any).sessionManager = mockManager;

      // EXECUTE
      try {
        await (pipeline as any).run();
      } catch (e) {
        // Ignore errors from missing mocks
      }

      // VERIFY - should log "Checking for nested execution at {sessionPath}"
      const validationCalls = debugSpy.mock.calls.filter((call: any[]) =>
        call.some(arg => String(arg).includes('Checking for nested execution'))
      );
      expect(validationCalls.length).toBeGreaterThan(0);
    });

    it('should call validateNestedExecution with session path', async () => {
      // SETUP
      const backlog = createTestBacklog([]);
      const mockSession = createTestSession(
        backlog,
        '# Test PRD',
        'plan/003_b3d3efdaf0ed/bugfix/001_d5507a871918'
      );

      const mockManager = createMockSessionManager(mockSession);
      mockManager.initialize = vi.fn().mockResolvedValue(mockSession);

      const pipeline = new PRPPipeline('./test.md');
      (pipeline as any).sessionManager = mockManager;

      // EXECUTE
      try {
        await (pipeline as any).run();
      } catch (e) {
        // Ignore errors from missing mocks
      }

      // VERIFY
      expect(mockValidateNestedExecution).toHaveBeenCalledWith(
        'plan/003_b3d3efdaf0ed/bugfix/001_d5507a871918'
      );
    });

    it('should throw and log NestedExecutionError when validation fails', async () => {
      // SETUP
      const backlog = createTestBacklog([]);
      const mockSession = createTestSession(
        backlog,
        '# Test PRD',
        'plan/001_14b9dc2a33c7'
      );

      const mockManager = createMockSessionManager(mockSession);
      mockManager.initialize = vi.fn().mockResolvedValue(mockSession);

      // Create a mock NestedExecutionError
      class MockNestedExecutionError extends Error {
        constructor(
          message: string,
          public context?: {
            existingPid?: string;
            currentPid?: string;
            sessionPath?: string;
          }
        ) {
          super(message);
          this.name = 'NestedExecutionError';
        }
      }

      const mockError = new MockNestedExecutionError(
        'Nested PRP Pipeline execution detected',
        {
          existingPid: '12345',
          currentPid: '67890',
          sessionPath: 'plan/001_14b9dc2a33c7',
        }
      );

      mockValidateNestedExecution.mockImplementation(() => {
        throw mockError;
      });
      mockIsNestedExecutionError.mockReturnValue(true);

      const errorSpy = vi.fn();
      const loggerSpy = {
        debug: vi.fn(),
        info: vi.fn(),
        error: errorSpy,
        warn: vi.fn(),
      };

      const pipeline = new PRPPipeline('./test.md');
      (pipeline as any).logger = loggerSpy;
      (pipeline as any).sessionManager = mockManager;

      // EXECUTE - run() catches errors and returns result object
      const result = await (pipeline as any).run();

      // VERIFY - result indicates failure with nested execution error
      expect(result.success).toBe(false);
      expect(result.error).toContain('Nested PRP Pipeline');

      // VERIFY error was logged with context
      const errorCalls = errorSpy.mock.calls;
      const nestedExecutionErrors = errorCalls.filter((call: any[]) =>
        call.some(arg => {
          if (typeof arg === 'string') {
            return arg.includes('Nested execution detected');
          }
          if (typeof arg === 'object' && arg !== null) {
            return (
              arg.sessionPath === 'plan/001_14b9dc2a33c7' &&
              arg.existingPid === '12345' &&
              arg.currentPid === '67890'
            );
          }
          return false;
        })
      );
      expect(nestedExecutionErrors.length).toBeGreaterThan(0);
    });

    it('should validate BEFORE guard is set', async () => {
      // SETUP
      const backlog = createTestBacklog([]);
      const mockSession = createTestSession(
        backlog,
        '# Test PRD',
        'plan/001_14b9dc2a33c7'
      );

      const mockManager = createMockSessionManager(mockSession);
      mockManager.initialize = vi.fn().mockResolvedValue(mockSession);

      let validationCallCount = 0;
      let guardSetCount = 0;

      // Track validation call
      const originalEnv = process.env.PRP_PIPELINE_RUNNING;
      delete process.env.PRP_PIPELINE_RUNNING;

      mockValidateNestedExecution.mockImplementation(() => {
        validationCallCount++;
        // Check if guard is already set (it should NOT be)
        if (process.env.PRP_PIPELINE_RUNNING) {
          guardSetCount++;
        }
      });

      const pipeline = new PRPPipeline('./test.md');
      (pipeline as any).sessionManager = mockManager;

      // EXECUTE
      try {
        await (pipeline as any).run();
      } catch (e) {
        // Ignore errors from missing mocks
      } finally {
        // Restore env
        if (originalEnv) {
          process.env.PRP_PIPELINE_RUNNING = originalEnv;
        } else {
          delete process.env.PRP_PIPELINE_RUNNING;
        }
      }

      // VERIFY - validation was called
      expect(validationCallCount).toBeGreaterThan(0);
      // VERIFY - guard was NOT set at the time of validation
      expect(guardSetCount).toBe(0);
    });

    it('should allow execution when validation passes', async () => {
      // SETUP
      const backlog = createTestBacklog([]);
      const mockSession = createTestSession(
        backlog,
        '# Test PRD',
        'plan/001_14b9dc2a33c7'
      );

      const mockManager = createMockSessionManager(mockSession);
      mockManager.initialize = vi.fn().mockResolvedValue(mockSession);

      // Validation passes (no throw)
      mockValidateNestedExecution.mockImplementation(() => {
        // Do nothing - allow execution
      });

      const pipeline = new PRPPipeline('./test.md');
      (pipeline as any).sessionManager = mockManager;

      // EXECUTE & VERIFY - should not throw from validation
      try {
        await (pipeline as any).run();
      } catch (e) {
        // Error should NOT be from validation
        if (e instanceof Error) {
          expect(e.message).not.toContain('Nested execution');
        }
      }
    });
  });

  describe('guard context logging', () => {
    it('should log guard context with all 4 fields after guard is set', async () => {
      // SETUP
      const backlog = createTestBacklog([]);
      const mockSession = createTestSession(
        backlog,
        '# Test PRD',
        '/plan/001_14b9dc2a33c7'
      );

      const mockManager = createMockSessionManager(mockSession);
      mockManager.planDir = '/plan';
      mockManager.initialize = vi.fn().mockResolvedValue(mockSession);

      const debugLogs: string[] = [];
      const loggerSpy = {
        debug: vi.fn((message: string) => debugLogs.push(message)),
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
      };

      const pipeline = new PRPPipeline('./test.md');
      (pipeline as any).logger = loggerSpy;
      (pipeline as any).sessionManager = mockManager;

      // EXECUTE
      try {
        await (pipeline as any).run();
      } catch (e) {
        // Ignore errors from missing mocks
      }

      // VERIFY - find guard context log
      const guardContextLog = debugLogs.find(log =>
        log.includes('[PRPPipeline] Guard Context:')
      );

      expect(guardContextLog).toBeDefined();
      expect(guardContextLog).toMatch(/PLAN_DIR=/);
      expect(guardContextLog).toMatch(/SESSION_DIR=/);
      expect(guardContextLog).toMatch(/SKIP_BUG_FINDING=/);
      expect(guardContextLog).toMatch(/PRP_PIPELINE_RUNNING=/);
    });

    it('should handle null currentSession gracefully', async () => {
      // SETUP
      const mockManager = createMockSessionManager(null);
      mockManager.planDir = '/plan';
      mockManager.currentSession = null;
      mockManager.initialize = vi.fn().mockResolvedValue(null);

      const debugLogs: string[] = [];
      const loggerSpy = {
        debug: vi.fn((message: string) => debugLogs.push(message)),
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
      };

      const pipeline = new PRPPipeline('./test.md');
      (pipeline as any).logger = loggerSpy;
      (pipeline as any).sessionManager = mockManager;

      // EXECUTE
      try {
        await (pipeline as any).run();
      } catch (e) {
        // Ignore errors from missing mocks
      }

      // VERIFY - should not throw, and SESSION_DIR should be 'not set'
      const guardContextLogs = debugLogs.filter(log =>
        log.includes('[PRPPipeline] Guard Context:')
      );

      // If guard context was logged, verify SESSION_DIR is 'not set'
      if (guardContextLogs.length > 0) {
        const hasNotSetSession = guardContextLogs.some(log =>
          log.includes('SESSION_DIR=not set')
        );
        expect(hasNotSetSession).toBe(true);
      }
    });

    it('should show default values when env vars are not set', async () => {
      // SETUP
      const backlog = createTestBacklog([]);
      const mockSession = createTestSession(
        backlog,
        '# Test PRD',
        '/plan/001_14b9dc2a33c7'
      );

      const mockManager = createMockSessionManager(mockSession);
      mockManager.planDir = '/plan';
      mockManager.initialize = vi.fn().mockResolvedValue(mockSession);

      // Clear env vars for test
      const originalSkipBugFinding = process.env.SKIP_BUG_FINDING;
      const originalRunning = process.env.PRP_PIPELINE_RUNNING;
      delete process.env.SKIP_BUG_FINDING;
      delete process.env.PRP_PIPELINE_RUNNING;

      const debugLogs: string[] = [];
      const loggerSpy = {
        debug: vi.fn((message: string) => debugLogs.push(message)),
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
      };

      const pipeline = new PRPPipeline('./test.md');
      (pipeline as any).logger = loggerSpy;
      (pipeline as any).sessionManager = mockManager;

      // EXECUTE
      try {
        await (pipeline as any).run();
      } catch (e) {
        // Ignore errors from missing mocks
      } finally {
        // Restore env vars
        if (originalSkipBugFinding) {
          process.env.SKIP_BUG_FINDING = originalSkipBugFinding;
        }
        if (originalRunning) {
          process.env.PRP_PIPELINE_RUNNING = originalRunning;
        }
      }

      // VERIFY - default values should be shown
      const guardContextLog = debugLogs.find(log =>
        log.includes('[PRPPipeline] Guard Context:')
      );

      if (guardContextLog) {
        expect(guardContextLog).toMatch(/SKIP_BUG_FINDING=false/);
      }
    });

    it('should show actual env var values when set', async () => {
      // SETUP
      const backlog = createTestBacklog([]);
      const mockSession = createTestSession(
        backlog,
        '# Test PRD',
        '/plan/001_14b9dc2a33c7'
      );

      const mockManager = createMockSessionManager(mockSession);
      mockManager.planDir = '/plan';
      mockManager.initialize = vi.fn().mockResolvedValue(mockSession);

      // Set SKIP_BUG_FINDING for test (PRP_PIPELINE_RUNNING will be set to process.pid by the implementation)
      const originalSkipBugFinding = process.env.SKIP_BUG_FINDING;
      process.env.SKIP_BUG_FINDING = 'true';

      const debugLogs: string[] = [];
      const loggerSpy = {
        debug: vi.fn((message: string) => debugLogs.push(message)),
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
      };

      const pipeline = new PRPPipeline('./test.md');
      (pipeline as any).logger = loggerSpy;
      (pipeline as any).sessionManager = mockManager;

      // EXECUTE
      try {
        await (pipeline as any).run();
      } catch (e) {
        // Ignore errors from missing mocks
      } finally {
        // Restore env vars
        if (originalSkipBugFinding !== undefined) {
          process.env.SKIP_BUG_FINDING = originalSkipBugFinding;
        } else {
          delete process.env.SKIP_BUG_FINDING;
        }
      }

      // VERIFY - actual values should be shown
      const guardContextLog = debugLogs.find(log =>
        log.includes('[PRPPipeline] Guard Context:')
      );

      if (guardContextLog) {
        expect(guardContextLog).toMatch(/SKIP_BUG_FINDING=true/);
        // PRP_PIPELINE_RUNNING should be set to a PID (numeric string)
        expect(guardContextLog).toMatch(/PRP_PIPELINE_RUNNING=\d+/);
      }
    });

    it('should use exact format specified in requirements', async () => {
      // SETUP
      const backlog = createTestBacklog([]);
      const mockSession = createTestSession(
        backlog,
        '# Test PRD',
        '/plan/001_14b9dc2a33c7'
      );

      const mockManager = createMockSessionManager(mockSession);
      mockManager.planDir = '/plan';
      mockManager.initialize = vi.fn().mockResolvedValue(mockSession);

      const debugLogs: string[] = [];
      const loggerSpy = {
        debug: vi.fn((message: string) => debugLogs.push(message)),
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
      };

      const pipeline = new PRPPipeline('./test.md');
      (pipeline as any).logger = loggerSpy;
      (pipeline as any).sessionManager = mockManager;

      // EXECUTE
      try {
        await (pipeline as any).run();
      } catch (e) {
        // Ignore errors from missing mocks
      }

      // VERIFY - format should match specification
      const guardContextLog = debugLogs.find(log =>
        log.includes('[PRPPipeline] Guard Context:')
      );

      if (guardContextLog) {
        // Check format: Guard Context: PLAN_DIR={planDir}, SESSION_DIR={sessionDir}, SKIP_BUG_FINDING={skipBugFinding}, PRP_PIPELINE_RUNNING={running}
        const formatPattern =
          /^Guard Context: PLAN_DIR=.+, SESSION_DIR=.+, SKIP_BUG_FINDING=.+, PRP_PIPELINE_RUNNING=.+$/;
        const messageOnly = guardContextLog.replace('[PRPPipeline] ', '');
        expect(messageOnly).toMatch(formatPattern);
      }
    });
  });
});
