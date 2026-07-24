/**
 * Unit tests for PRPPipeline validate/bug-hunt session reuse (PRD §4.3 step 2).
 *
 * @remarks
 * Covers P4.M1.T2.S2: "Validate/bug-hunt re-runs reuse the completed session."
 *
 * When the pipeline runs in `--mode validate` or `--mode bug-hunt` against an
 * already-completed session that has a pending PRD change, the system reuses the
 * latest completed session instead of letting SessionManager.initialize() create a
 * new empty session. The pending change is left in place for the next normal run.
 *
 * Mock structure mirrors tests/unit/workflows/prp-pipeline.test.ts (12-module mock
 * block + createMockSessionManager helper + data factories), extended with:
 *  - `planDir` + `loadSessionAsCurrent` on the mock manager (the reuse path reads
 *    `planDir` and calls the new resume helper).
 *  - a controllable STATIC `findLatestSession` on the mocked SessionManager class.
 *  - controllable `hashPRD` / `readTasksJSON` on session-utils (the detection
 *    primitives) while keeping the rest passthrough-real.
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { PRPPipeline } from '../../../src/workflows/prp-pipeline.js';
import { Backlog, SessionState, Status } from '../../../src/core/models.js';
import type { SessionMetadata } from '../../../src/core/models.js';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

// Mock the node:fs/promises module (loadSession reads prd_snapshot.md via this).
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn().mockResolvedValue(undefined),
  copyFile: vi.fn().mockResolvedValue(undefined),
  stat: vi.fn().mockResolvedValue({ mtime: new Date() }),
}));

// Mock the sync node:fs module (SessionManager's constructor validates the PRD
// path via statSync). Required so the REAL SessionManager can be constructed in
// the loadSessionAsCurrent contract test below.
vi.mock('node:fs', () => ({
  statSync: vi.fn().mockReturnValue({
    isFile: () => true,
    mtime: new Date(),
  }),
}));

// Mock session-utils: passthrough-real EXCEPT the three primitives the reuse path
// consumes. resolvePRD is overridden (drives hashPRD); hashPRD + readTasksJSON are
// controllable vi.fns so we can shape the current-hash / completion-probe outcomes.
vi.mock('../../../src/core/session-utils.js', async importOriginal => {
  const actual =
    await importOriginal<typeof import('../../../src/core/session-utils.js')>();
  return {
    ...actual,
    resolvePRD: vi.fn(),
    hashPRD: vi.fn(),
    readTasksJSON: vi.fn(),
  };
});

// Mock SessionManager: instance factory (matches prp-pipeline.test.ts) PLUS a
// controllable static findLatestSession (the reuse path calls the static).
vi.mock('../../../src/core/session-manager.js', () => {
  const SessionManager = vi.fn();
  // Default static: returns null (no sessions). Individual tests override this.
  (SessionManager as any).findLatestSession = vi.fn().mockResolvedValue(null);
  return { SessionManager };
});

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

// Mock prompts — passthrough-real (dynamically-imported architect-prompt reads it).
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

// ---------------------------------------------------------------------------
// Mocked-module references
// ---------------------------------------------------------------------------

import { readFile } from 'node:fs/promises';
import { SessionManager as SessionManagerClass } from '../../../src/core/session-manager.js';
import {
  resolvePRD,
  hashPRD,
  readTasksJSON,
} from '../../../src/core/session-utils.js';
import {
  validateNestedExecution,
  isNestedExecutionError,
} from '../../../src/utils/validation/execution-guard.js';

const mockReadFile = readFile as any;
const mockResolvePRD = resolvePRD as any;
const mockHashPRD = hashPRD as any;
const mockReadTasksJSON = readTasksJSON as any;
const mockValidateNestedExecution = validateNestedExecution as any;
const mockIsNestedExecutionError = isNestedExecutionError as any;
const MockSessionManagerClass = SessionManagerClass as any;

// ---------------------------------------------------------------------------
// Test data factories (cloned from prp-pipeline.test.ts)
// ---------------------------------------------------------------------------

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
  sessionPath: string = '/plan/001_14b9dc2a33c7',
  hash: string = '14b9dc2a33c7'
): SessionState => ({
  metadata: {
    id: '001_14b9dc2a33c7',
    hash,
    path: sessionPath,
    createdAt: new Date(),
    parentSession: null,
  },
  prdSnapshot,
  taskRegistry: backlog,
  currentItemId: null,
});

/** A backlog where every subtask is Complete (a finished session). */
const createCompletedBacklog = (): Backlog =>
  createTestBacklog([
    createTestPhase('P1', 'Phase 1', 'Complete', [
      createTestMilestone('P1.M1', 'Milestone 1', 'Complete', [
        createTestTask('P1.M1.T1', 'Task 1', 'Complete', [
          createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Complete'),
          createTestSubtask('P1.M1.T1.S2', 'Subtask 2', 'Complete'),
        ]),
      ]),
    ]),
  ]);

/** A backlog with at least one non-Complete subtask (an unfinished session). */
const createIncompleteBacklog = (): Backlog =>
  createTestBacklog([
    createTestPhase('P1', 'Phase 1', 'Planned', [
      createTestMilestone('P1.M1', 'Milestone 1', 'Planned', [
        createTestTask('P1.M1.T1', 'Task 1', 'Planned', [
          createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Complete'),
          createTestSubtask('P1.M1.T1.S2', 'Subtask 2', 'Planned'),
        ]),
      ]),
    ]),
  ]);

/** Build a SessionMetadata shape for findLatestSession's return value. */
const createLatestMetadata = (hash: string): SessionMetadata => ({
  id: `001_${hash}`,
  hash,
  path: `/plan/001_${hash}`,
  createdAt: new Date(),
  parentSession: null,
});

// ---------------------------------------------------------------------------
// Mock SessionManager factory (cloned + extended with reuse-path fields)
// ---------------------------------------------------------------------------

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
    planDir: '/test/plan',
    loadSessionAsCurrent: vi.fn().mockResolvedValue(session),
    flushUpdates: vi.fn().mockResolvedValue(undefined),
  };
  MockSessionManagerClass.mockImplementation(() => mock);
  return mock;
}

// ===========================================================================
// Tests
// ===========================================================================

describe('PRPPipeline validate/bug-hunt session reuse (PRD §4.3 step 2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset SessionManager mock to the default (null currentSession).
    MockSessionManagerClass.mockImplementation(() => ({
      currentSession: null,
      initialize: vi.fn().mockResolvedValue({ currentSession: null }),
      saveBacklog: vi.fn().mockResolvedValue(undefined),
    }));
    // Reset the static findLatestSession default: no sessions.
    MockSessionManagerClass.findLatestSession = vi.fn().mockResolvedValue(null);
    // Default fs read for prd_snapshot.md (loadSession path).
    mockReadFile.mockResolvedValue('# Test PRD snapshot');
    // Default validation guards: allow execution.
    mockValidateNestedExecution.mockImplementation(() => {});
    mockIsNestedExecutionError.mockReturnValue(false);
    // Default session-utils primitives: no pending change, no tasks.
    mockResolvePRD.mockResolvedValue('# Test PRD');
    mockHashPRD.mockResolvedValue('NEWHASH0000000000000000000000000000000000');
    mockReadTasksJSON.mockResolvedValue(createTestBacklog([]));
  });

  afterEach(() => {
    // Clean up signal handlers registered by the PRPPipeline constructor.
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGTERM');
  });

  // Helper: build a pipeline wired to the mock manager + a chosen mode.
  function buildPipeline(
    mode: 'normal' | 'delta' | 'bug-hunt' | 'validate',
    session: SessionState
  ) {
    const mockManager = createMockSessionManager(session);
    const pipeline = new PRPPipeline('./test.md');
    (pipeline as any).sessionManager = mockManager;
    (pipeline as any).mode = mode;
    return { pipeline, mockManager };
  }

  // -------------------------------------------------------------------------
  // REUSE PATH (Cases A + B): completed latest session + pending change
  // -------------------------------------------------------------------------

  describe('reuse path (completed session + pending change)', () => {
    const setupReuseScenery = (
      mode: 'validate' | 'bug-hunt'
    ): {
      pipeline: PRPPipeline;
      mockManager: ReturnType<typeof createMockSessionManager>;
      latest: SessionMetadata;
      completedSession: SessionState;
    } => {
      const completedBacklog = createCompletedBacklog();
      const completedSession = createTestSession(
        completedBacklog,
        '# OLD PRD snapshot',
        '/plan/001_OLDHASHaaaa',
        'OLDHASHaaaa'
      );
      // findLatestSession returns a session whose hash DIFFERS from current PRD.
      const latest = createLatestMetadata('OLDHASHaaaa');
      MockSessionManagerClass.findLatestSession = vi
        .fn()
        .mockResolvedValue(latest);
      // hashPRD returns a FULL 64-char hash whose 12-char prefix differs from
      // the latest session's hash (pending change).
      mockHashPRD.mockResolvedValue(
        'NEWHASH0000000000000000000000000000000000'
      );
      // readTasksJSON returns the completed backlog (completion probe passes).
      mockReadTasksJSON.mockResolvedValue(completedBacklog);

      const { pipeline, mockManager } = buildPipeline(mode, completedSession);
      return { pipeline, mockManager, latest, completedSession };
    };

    it('CASE A: validate mode reuses completed session', async () => {
      const { pipeline, mockManager, latest } = setupReuseScenery('validate');

      const handleDeltaSpy = vi
        .spyOn(pipeline, 'handleDelta')
        .mockResolvedValue(undefined);

      await pipeline.initializeSession();

      // Reuse detection ran against the manager's planDir.
      expect(MockSessionManagerClass.findLatestSession).toHaveBeenCalledWith(
        '/test/plan'
      );
      // The completed session was loaded as current (the resume helper).
      expect(mockManager.loadSessionAsCurrent).toHaveBeenCalledWith(
        latest.path
      );
      // The reuse path MUST bypass these entirely.
      expect(mockManager.initialize).not.toHaveBeenCalled();
      expect(mockManager.createDeltaSession).not.toHaveBeenCalled();
      expect(handleDeltaSpy).not.toHaveBeenCalled();
      // The reused session is current and the phase advanced.
      expect(pipeline.sessionManager.currentSession).toBeDefined();
      expect(pipeline.currentPhase).toBe('session_initialized');

      handleDeltaSpy.mockRestore();
    });

    it('CASE B: bug-hunt mode reuses completed session', async () => {
      const { pipeline, mockManager, latest } = setupReuseScenery('bug-hunt');

      const handleDeltaSpy = vi
        .spyOn(pipeline, 'handleDelta')
        .mockResolvedValue(undefined);

      await pipeline.initializeSession();

      expect(MockSessionManagerClass.findLatestSession).toHaveBeenCalledWith(
        '/test/plan'
      );
      expect(mockManager.loadSessionAsCurrent).toHaveBeenCalledWith(
        latest.path
      );
      expect(mockManager.initialize).not.toHaveBeenCalled();
      expect(mockManager.createDeltaSession).not.toHaveBeenCalled();
      expect(handleDeltaSpy).not.toHaveBeenCalled();
      expect(pipeline.currentPhase).toBe('session_initialized');

      handleDeltaSpy.mockRestore();
    });

    it('does NOT refresh prd_snapshot.md on reuse (change stays pending)', async () => {
      // writeFile is the channel for snapshot refresh; the reuse path must not
      // touch the filesystem for the session beyond what loadSession already read.
      const { pipeline } = setupReuseScenery('validate');

      mockReadFile.mockClear();
      await pipeline.initializeSession();

      // loadSession would read prd_snapshot.md, but loadSessionAsCurrent is a
      // mock here, so NO file writes should occur during the reuse path.
      expect(mockReadFile).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // FALL-THROUGH PATHS (Cases C, D, E): normal initialize() runs
  // -------------------------------------------------------------------------

  describe('fall-through to normal initialize()', () => {
    it('CASE C: no latest session → initialize() runs', async () => {
      const session = createTestSession(createTestBacklog([]));
      const { pipeline, mockManager } = buildPipeline('validate', session);
      // findLatestSession default: null (no sessions).

      await pipeline.initializeSession();

      expect(MockSessionManagerClass.findLatestSession).toHaveBeenCalled();
      expect(mockManager.loadSessionAsCurrent).not.toHaveBeenCalled();
      // Fell through to the normal path.
      expect(mockManager.initialize).toHaveBeenCalledTimes(1);
      expect(pipeline.currentPhase).toBe('session_initialized');
    });

    it('CASE D: no pending change (latest.hash === currentHash) → initialize() runs; readTasksJSON NOT called', async () => {
      const session = createTestSession(createTestBacklog([]));
      const { pipeline, mockManager } = buildPipeline('validate', session);
      const sameHash = 'SAMEHASH0000';
      const latest = createLatestMetadata(sameHash);
      MockSessionManagerClass.findLatestSession = vi
        .fn()
        .mockResolvedValue(latest);
      // currentHash prefix === latest.hash → no pending change.
      mockHashPRD.mockResolvedValue(
        'SAMEHASH000000000000000000000000000000000000'
      );

      await pipeline.initializeSession();

      expect(mockManager.loadSessionAsCurrent).not.toHaveBeenCalled();
      // Short-circuited on the hash match: never probed completion.
      expect(mockReadTasksJSON).not.toHaveBeenCalled();
      expect(mockManager.initialize).toHaveBeenCalledTimes(1);
      expect(pipeline.currentPhase).toBe('session_initialized');
    });

    it('CASE E: latest session NOT all complete → initialize() runs', async () => {
      const session = createTestSession(createTestBacklog([]));
      const { pipeline, mockManager } = buildPipeline('validate', session);
      const latest = createLatestMetadata('OLDHASHaaaa');
      MockSessionManagerClass.findLatestSession = vi
        .fn()
        .mockResolvedValue(latest);
      mockHashPRD.mockResolvedValue(
        'NEWHASH0000000000000000000000000000000000'
      );
      // readTasksJSON returns an INCOMPLETE backlog (reuse refused).
      mockReadTasksJSON.mockResolvedValue(createIncompleteBacklog());

      await pipeline.initializeSession();

      expect(mockReadTasksJSON).toHaveBeenCalledWith(latest.path);
      expect(mockManager.loadSessionAsCurrent).not.toHaveBeenCalled();
      expect(mockManager.initialize).toHaveBeenCalledTimes(1);
      expect(pipeline.currentPhase).toBe('session_initialized');
    });
  });

  // -------------------------------------------------------------------------
  // MODE GUARD (Cases F + G): normal/delta modes never enter the guard
  // -------------------------------------------------------------------------

  describe('mode guard skips for non-(validate/bug-hunt) modes', () => {
    it('CASE F: normal mode never calls findLatestSession; initialize() runs', async () => {
      const session = createTestSession(createTestBacklog([]));
      const { pipeline, mockManager } = buildPipeline('normal', session);
      // Even with a reuse-eligible latest session present, the guard is skipped.
      const latest = createLatestMetadata('OLDHASHaaaa');
      MockSessionManagerClass.findLatestSession = vi
        .fn()
        .mockResolvedValue(latest);
      mockHashPRD.mockResolvedValue(
        'NEWHASH0000000000000000000000000000000000'
      );
      mockReadTasksJSON.mockResolvedValue(createCompletedBacklog());

      await pipeline.initializeSession();

      expect(MockSessionManagerClass.findLatestSession).not.toHaveBeenCalled();
      expect(mockManager.loadSessionAsCurrent).not.toHaveBeenCalled();
      expect(mockManager.initialize).toHaveBeenCalledTimes(1);
    });

    it('CASE G: delta mode never calls findLatestSession; initialize() runs', async () => {
      const session = createTestSession(createTestBacklog([]));
      const { pipeline, mockManager } = buildPipeline('delta', session);
      const latest = createLatestMetadata('OLDHASHaaaa');
      MockSessionManagerClass.findLatestSession = vi
        .fn()
        .mockResolvedValue(latest);
      mockHashPRD.mockResolvedValue(
        'NEWHASH0000000000000000000000000000000000'
      );
      mockReadTasksJSON.mockResolvedValue(createCompletedBacklog());

      await pipeline.initializeSession();

      expect(MockSessionManagerClass.findLatestSession).not.toHaveBeenCalled();
      expect(mockManager.loadSessionAsCurrent).not.toHaveBeenCalled();
      expect(mockManager.initialize).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // #isBacklogComplete predicate (Case H) — exercised directly via the reuse path
  // -------------------------------------------------------------------------

  describe('#isBacklogComplete predicate (via reuse path)', () => {
    it('CASE H: completed backlog → reused (predicate true branch)', async () => {
      const completedBacklog = createCompletedBacklog();
      const session = createTestSession(completedBacklog);
      const { pipeline, mockManager } = buildPipeline('validate', session);
      const latest = createLatestMetadata('OLDHASHaaaa');
      MockSessionManagerClass.findLatestSession = vi
        .fn()
        .mockResolvedValue(latest);
      mockHashPRD.mockResolvedValue(
        'NEWHASH0000000000000000000000000000000000'
      );
      mockReadTasksJSON.mockResolvedValue(completedBacklog);

      await pipeline.initializeSession();

      expect(mockManager.loadSessionAsCurrent).toHaveBeenCalledWith(
        latest.path
      );
      expect(pipeline.currentPhase).toBe('session_initialized');
    });

    it('CASE H: empty backlog (no subtasks) is vacuously complete → reused', async () => {
      // Edge case: a backlog with zero subtasks returns true (vacuous). Documents
      // the predicate's behavior on an empty task registry.
      const emptyBacklog = createTestBacklog([]);
      const session = createTestSession(emptyBacklog);
      const { pipeline, mockManager } = buildPipeline('validate', session);
      const latest = createLatestMetadata('OLDHASHaaaa');
      MockSessionManagerClass.findLatestSession = vi
        .fn()
        .mockResolvedValue(latest);
      mockHashPRD.mockResolvedValue(
        'NEWHASH0000000000000000000000000000000000'
      );
      mockReadTasksJSON.mockResolvedValue(emptyBacklog);

      await pipeline.initializeSession();

      expect(mockManager.loadSessionAsCurrent).toHaveBeenCalledWith(
        latest.path
      );
      expect(pipeline.currentPhase).toBe('session_initialized');
    });
  });

  // -------------------------------------------------------------------------
  // loadSessionAsCurrent helper contract (real SessionManager)
  // -------------------------------------------------------------------------

  describe('loadSessionAsCurrent (SessionManager) — real-method contract', () => {
    it('assigns the loaded session as current and sets #prdHash to the current PRD hash so hasSessionChanged() is false', async () => {
      // The workflow test file mocks the SessionManager module, so reach the REAL
      // class via importActual. The real class still consumes the (mocked)
      // session-utils primitives + node:fs/promises that this file controls.
      const actual = await vi.importActual<
        typeof import('../../../src/core/session-manager.js')
      >('../../../src/core/session-manager.js');
      const RealSessionManager = actual.SessionManager;

      const manager = new RealSessionManager('/test/prd.md', '/test/plan');

      // Build a session whose stored hash DIFFERS from the current PRD hash, so
      // that — BEFORE loadSessionAsCurrent — hasSessionChanged() would be true.
      const sessionHash = 'OLDHASHaaaa';
      const completedBacklog = createCompletedBacklog();
      const session = createTestSession(
        completedBacklog,
        '# OLD PRD snapshot',
        `/plan/001_${sessionHash}`,
        sessionHash
      );

      // loadSession reads tasks.json (readTasksJSON) + prd_snapshot.md (readFile).
      mockReadTasksJSON.mockResolvedValue(completedBacklog);
      mockReadFile.mockResolvedValue('# OLD PRD snapshot');
      // The current PRD hash DIFFERS from the session's stored hash (pending change).
      // loadSessionAsCurrent must still report hasSessionChanged() === false by
      // caching the LOADED session's hash as #prdHash (mirrors initialize()'s load
      // branch), NOT the current PRD hash.
      mockHashPRD.mockResolvedValue(
        'NEWHASH0000000000000000000000000000000000'
      );

      // Sanity: no current session yet → hasSessionChanged() throws (precondition).
      expect(() => manager.hasSessionChanged()).toThrow();

      const loaded = await manager.loadSessionAsCurrent(session.metadata.path);

      // The loaded session is the one returned...
      expect(loaded.metadata.hash).toBe(sessionHash);
      // ...and it is now the current session.
      expect(manager.currentSession).toBe(loaded);
      // loadSession was invoked for the chosen path (read tasks.json + snapshot).
      expect(mockReadTasksJSON).toHaveBeenCalledWith(session.metadata.path);
      // #prdHash is cached to the LOADED session's hash (not the current PRD hash),
      // so hasSessionChanged() reports false even though the on-disk PRD differs
      // (the pending change stays detectable by the next fresh process).
      expect(manager.hasSessionChanged()).toBe(false);
    });
  });
});
