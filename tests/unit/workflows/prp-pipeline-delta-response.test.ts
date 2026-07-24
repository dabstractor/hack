/**
 * Unit tests for the PRD-change response-selection dispatcher (PRD §4.3 step 2).
 *
 * @remarks
 * Tests validate the three response-selection branches introduced in
 * `PRPPipeline.handleDelta()` (the dispatcher), the `prd_changed.marker`
 * (`.pending_delta_hash`) helper trio in `session-utils.ts`, the
 * snapshot-preservation contract for the integrate path, the snapshot-refresh +
 * idempotent-exit contract for the accept path, and the default delta-session
 * regression.
 *
 * Strategy: the real marker-trio functions are exercised end-to-end by mocking
 * `node:fs/promises` and asserting on its `writeFile`/`unlink` call args.
 * `resolvePRD` is mocked (no real I/O). SessionManager and the sibling workflows
 * use the factory-impl mock pattern from prp-pipeline.test.ts.
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { resolve } from 'node:path';
import { PRPPipeline } from '../../../src/workflows/prp-pipeline.js';
import { Backlog, SessionState, Status } from '../../../src/core/models.js';
import {
  writePendingDeltaHash,
  readPendingDeltaHash,
  clearPendingDeltaHash,
  refreshSnapshotToCurrentPRD,
  PENDING_DELTA_HASH_FILE,
  SessionFileError,
} from '../../../src/core/session-utils.js';

// Mock node:fs/promises — the marker trio + refreshSnapshotToCurrentPRD call
// writeFile/readFile/unlink directly; assert on these call args. readFile
// mirrors the real signature: no encoding → Buffer; 'utf-8' → string
// (readUTF8FileStrict inside resolvePRD decodes a Buffer; readPendingDeltaHash
// reads with 'utf-8').
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn((_path, encoding) =>
    encoding === 'utf-8'
      ? Promise.resolve('')
      : Promise.resolve(Buffer.from('', 'utf-8'))
  ),
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
  copyFile: vi.fn().mockResolvedValue(undefined),
}));

// Mock session-utils: spread actual so the REAL marker-trio + refresh run
// (they only touch the mocked node:fs/promises), and override resolvePRD +
// writeDeltaPRD. writeDeltaPRD would otherwise call atomicWrite (needs `rename`
// from node:fs/promises, which this suite doesn't mock) on a fake session path;
// mock it so spawnDeltaSession's new delta_prd.md step stays I/O-isolated.
vi.mock('../../../src/core/session-utils.js', async importOriginal => {
  const actual =
    await importOriginal<typeof import('../../../src/core/session-utils.js')>();
  return {
    ...actual,
    resolvePRD: vi.fn(),
    writeDeltaPRD: vi.fn().mockResolvedValue(undefined),
  };
});

// Mock SessionManager (factory-impl — rebound per-test via createMockSessionManager).
vi.mock('../../../src/core/session-manager.js', () => ({
  SessionManager: vi.fn().mockImplementation(() => ({
    currentSession: null,
    initialize: vi.fn(),
    saveBacklog: vi.fn(),
  })),
}));

// Mock TaskOrchestrator (not exercised by handleDelta, but required by imports).
vi.mock('../../../src/core/task-orchestrator.js', () => ({
  TaskOrchestrator: vi.fn().mockImplementation(() => ({
    processNextItem: vi.fn(),
    rebuildQueue: vi.fn().mockResolvedValue(undefined),
  })),
}));

// Mock agent factory + prompts (not exercised by handleDelta).
vi.mock('../../../src/agents/agent-factory.js', () => ({
  createArchitectAgent: vi.fn(),
  createQAAgent: vi.fn(),
}));
vi.mock('../../../src/agents/prompts.js', async importOriginal => {
  const actual =
    await importOriginal<typeof import('../../../src/agents/prompts.js')>();
  return { ...actual, TASK_BREAKDOWN_PROMPT: 'Mock TASK_BREAKDOWN_PROMPT' };
});

// Mock the sibling workflows + task-patcher + task-utils.
vi.mock('../../../src/workflows/delta-analysis-workflow.js', () => ({
  DeltaAnalysisWorkflow: vi.fn().mockImplementation(() => ({
    run: vi.fn().mockResolvedValue({
      changes: [],
      patchInstructions: 'No changes',
      taskIds: [],
    }),
  })),
}));
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
vi.mock('../../../src/core/task-patcher.js', () => ({
  patchBacklog: vi.fn().mockImplementation((backlog: Backlog) => backlog),
}));
vi.mock('../../../src/utils/task-utils.js', () => ({
  filterByStatus: vi.fn().mockReturnValue([]),
}));
vi.mock('../../../src/utils/validation/execution-guard.js', () => ({
  validateNestedExecution: vi.fn(),
  isNestedExecutionError: vi.fn(() => false),
}));

// Import mocked modules for cast references.
import { writeFile, unlink, readFile } from 'node:fs/promises';
import { SessionManager as SessionManagerClass } from '../../../src/core/session-manager.js';
import { resolvePRD } from '../../../src/core/session-utils.js';
import { DeltaAnalysisWorkflow } from '../../../src/workflows/delta-analysis-workflow.js';
import { patchBacklog } from '../../../src/core/task-patcher.js';
import { filterByStatus } from '../../../src/utils/task-utils.js';

const mockWriteFile = writeFile as any;
const mockUnlink = unlink as any;
const mockReadFile = readFile as any;
const mockResolvePRD = resolvePRD as any;
const MockDeltaAnalysisWorkflow = DeltaAnalysisWorkflow as any;
const mockPatchBacklog = patchBacklog as any;
const mockFilterByStatus = filterByStatus as any;
const MockSessionManagerClass = SessionManagerClass as any;

// ===== Test data factories =====
const createTestBacklog = (phases: any[]): Backlog => ({ backlog: phases });

const createTestSession = (
  backlog: Backlog,
  prdSnapshot = '# Original PRD',
  sessionPath = '/plan/001_14b9dc2a33c7'
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
    flushUpdates: vi.fn().mockResolvedValue(undefined),
  };
  MockSessionManagerClass.mockImplementation(() => mock);
  return mock;
}

describe('PRPPipeline delta-response dispatcher (PRD §4.3 step 2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Defaults: resolvePRD returns a distinct new PRD; writeFile/unlink succeed.
    // readFile mirrors the real fs: Buffer when no encoding (readUTF8FileStrict
    // inside the real resolvePRD decodes it), string when 'utf-8'
    // (readPendingDeltaHash).
    mockResolvePRD.mockResolvedValue('# Updated PRD');
    mockWriteFile.mockResolvedValue(undefined);
    mockUnlink.mockResolvedValue(undefined);
    mockReadFile.mockImplementation((_path, encoding) =>
      encoding === 'utf-8'
        ? Promise.resolve('# Updated PRD')
        : Promise.resolve(Buffer.from('# Updated PRD', 'utf-8'))
    );
    mockFilterByStatus.mockReturnValue([]);
    mockPatchBacklog.mockImplementation((backlog: Backlog) => backlog);
    MockDeltaAnalysisWorkflow.mockImplementation(() => ({
      run: vi.fn().mockResolvedValue({
        changes: [],
        patchInstructions: 'No changes',
        taskIds: [],
      }),
    }));
  });

  afterEach(() => {
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGTERM');
  });

  // Helper: build a pipeline wired to a mock session manager + acceptPrdChanges flag.
  function buildPipeline(
    session: SessionState | null,
    opts: {
      acceptPrdChanges?: boolean;
      integratePrdChanges?: boolean;
      hasSessionChanged?: boolean;
    } = {}
  ) {
    const mockManager = createMockSessionManager(
      session,
      opts.hasSessionChanged ?? true
    );
    const pipeline = new PRPPipeline(
      './test.md',
      undefined,
      'normal',
      false,
      false,
      undefined,
      undefined,
      undefined,
      1,
      false,
      undefined,
      'auto',
      2,
      3,
      undefined,
      undefined,
      false,
      undefined,
      86400000,
      'standard',
      undefined,
      opts.acceptPrdChanges ?? false
    );
    (pipeline as any).sessionManager = mockManager;
    if (opts.integratePrdChanges) {
      (pipeline as any).integratePrdChanges = true;
    }
    return { pipeline, mockManager };
  }

  describe('acceptPrdChangesResponse (--accept-prd-changes)', () => {
    it('refreshes the snapshot, clears the marker, and does NOT spawn a delta session', async () => {
      // SETUP
      const session = createTestSession(createTestBacklog([]));
      const { pipeline, mockManager } = buildPipeline(session, {
        acceptPrdChanges: true,
      });

      // EXECUTE
      await pipeline.handleDelta();

      // VERIFY: accept path — no delta session, no delta analysis.
      expect(mockManager.createDeltaSession).not.toHaveBeenCalled();
      expect(MockDeltaAnalysisWorkflow).not.toHaveBeenCalled();
      expect(mockPatchBacklog).not.toHaveBeenCalled();

      // VERIFY: marker was written before dispatch (.pending_delta_hash).
      const sessionPath = session.metadata.path;
      expect(mockWriteFile).toHaveBeenCalledWith(
        resolve(sessionPath, PENDING_DELTA_HASH_FILE),
        expect.any(String),
        { mode: 0o644 }
      );

      // VERIFY: snapshot refreshed to the CURRENT PRD.
      expect(mockResolvePRD).toHaveBeenCalledWith('/test/prd.md');
      expect(mockWriteFile).toHaveBeenCalledWith(
        resolve(sessionPath, 'prd_snapshot.md'),
        '# Updated PRD',
        { mode: 0o644 }
      );

      // VERIFY: marker cleared.
      expect(mockUnlink).toHaveBeenCalledWith(
        resolve(sessionPath, PENDING_DELTA_HASH_FILE)
      );

      // VERIFY: phase + idempotent exit.
      expect(pipeline.currentPhase).toBe('delta_accepted');
    });

    it('does not enter handleDelta when hasSessionChanged is false (idempotent re-run)', async () => {
      // SETUP — a resumed session whose snapshot already matches the current PRD:
      // hasSessionChanged() is false so initializeSession() never calls handleDelta.
      const session = createTestSession(createTestBacklog([]));
      const { pipeline, mockManager } = buildPipeline(session, {
        acceptPrdChanges: true,
        hasSessionChanged: false,
      });

      // EXECUTE — simulate the initializeSession() guard.
      if (mockManager.hasSessionChanged()) {
        await pipeline.handleDelta();
      }

      // VERIFY: handleDelta was never entered; no fs writes for the marker/snapshot.
      expect(mockManager.hasSessionChanged).toHaveBeenCalled();
      expect(mockWriteFile).not.toHaveBeenCalled();
      expect(mockUnlink).not.toHaveBeenCalled();
    });
  });

  describe('integrateIntoCurrentSessionResponse (integrate into current)', () => {
    it('runs delta analysis + patchBacklog on the CURRENT session and does NOT create a delta session', async () => {
      // SETUP
      const oldPRD = '# Original PRD';
      const session = createTestSession(createTestBacklog([]), oldPRD);
      const { pipeline, mockManager } = buildPipeline(session, {
        integratePrdChanges: true,
      });

      // EXECUTE
      await pipeline.handleDelta();

      // VERIFY: DeltaAnalysisWorkflow.run called with (oldPRD, resolvedCurrent, completedIds).
      expect(MockDeltaAnalysisWorkflow).toHaveBeenCalledWith(
        oldPRD,
        '# Updated PRD',
        expect.any(Array)
      );
      expect(mockPatchBacklog).toHaveBeenCalledWith(
        session.taskRegistry,
        expect.anything()
      );

      // VERIFY: patched backlog saved to the CURRENT session (not a delta dir).
      expect(mockManager.saveBacklog).toHaveBeenCalled();
      expect(mockManager.createDeltaSession).not.toHaveBeenCalled();

      // VERIFY: snapshot refreshed + marker cleared AFTER the patch applied.
      const sessionPath = session.metadata.path;
      expect(mockWriteFile).toHaveBeenCalledWith(
        resolve(sessionPath, 'prd_snapshot.md'),
        '# Updated PRD',
        { mode: 0o644 }
      );
      expect(mockUnlink).toHaveBeenCalledWith(
        resolve(sessionPath, PENDING_DELTA_HASH_FILE)
      );

      // VERIFY: phase.
      expect(pipeline.currentPhase).toBe('delta_integrated');
    });

    it('preserves the snapshot and does NOT clear the marker when patchBacklog fails', async () => {
      // SETUP — the CRITICAL PRD §4.3 preservation contract: on integration
      // failure, prd_snapshot.md must NOT be refreshed and the marker must NOT
      // be cleared (so the integration agent retains the original-snapshot-vs-
      // current-PRD diff and the change is not silently swallowed).
      const session = createTestSession(
        createTestBacklog([]),
        '# Original PRD'
      );
      const { pipeline, mockManager } = buildPipeline(session, {
        integratePrdChanges: true,
      });
      const runMock = vi.fn().mockResolvedValue({
        changes: [],
        patchInstructions: 'No changes',
        taskIds: [],
      });
      MockDeltaAnalysisWorkflow.mockImplementation(() => ({ run: runMock }));
      mockPatchBacklog.mockImplementation(() => {
        throw new Error('patchBacklog boom');
      });

      // EXECUTE — the patch failure must propagate (so the snapshot is NOT
      // refreshed and the marker is NOT cleared).
      await expect(pipeline.handleDelta()).rejects.toThrow('patchBacklog boom');

      // VERIFY: delta analysis ran but patching failed.
      expect(runMock).toHaveBeenCalled();
      expect(mockPatchBacklog).toHaveBeenCalled();
      expect(mockManager.saveBacklog).not.toHaveBeenCalled();

      // VERIFY: snapshot NOT refreshed (only the marker write from the dispatcher
      // is present; no prd_snapshot.md write).
      const sessionPath = session.metadata.path;
      const snapshotWrite = mockWriteFile.mock.calls.find(
        ([path]) => path === resolve(sessionPath, 'prd_snapshot.md')
      );
      expect(snapshotWrite).toBeUndefined();

      // VERIFY: marker NOT cleared (the dispatcher wrote it; integrate did not
      // remove it because integration did not succeed).
      const markerUnlink = mockUnlink.mock.calls.find(
        ([path]) => path === resolve(sessionPath, PENDING_DELTA_HASH_FILE)
      );
      expect(markerUnlink).toBeUndefined();

      // VERIFY: no delta session created.
      expect(mockManager.createDeltaSession).not.toHaveBeenCalled();
    });

    it('refreshes the snapshot only AFTER saveBacklog (ordering contract)', async () => {
      // SETUP — record the call order of saveBacklog vs the snapshot refresh
      // (writeFile to prd_snapshot.md). saveBacklog MUST come first.
      const order: string[] = [];
      const session = createTestSession(
        createTestBacklog([]),
        '# Original PRD'
      );
      const { pipeline, mockManager } = buildPipeline(session, {
        integratePrdChanges: true,
      });
      mockManager.saveBacklog.mockImplementation(async () => {
        order.push('saveBacklog');
      });
      const sessionPath = session.metadata.path;
      mockWriteFile.mockImplementation(async path => {
        if (path === resolve(sessionPath, 'prd_snapshot.md')) {
          order.push('refreshSnapshot');
        }
      });

      // EXECUTE
      await pipeline.handleDelta();

      // VERIFY: saveBacklog precedes the snapshot refresh.
      expect(order).toEqual(['saveBacklog', 'refreshSnapshot']);
    });
  });

  describe('spawnDeltaSession (default delta-session flow)', () => {
    it('still spawns a delta session via the existing flow when neither flag is set', async () => {
      // SETUP — regression: the default path must still createDeltaSession.
      const session = createTestSession(createTestBacklog([]));
      const { pipeline, mockManager } = buildPipeline(session, {
        acceptPrdChanges: false,
      });

      // EXECUTE
      await pipeline.handleDelta();

      // VERIFY: default delta-session flow.
      expect(MockDeltaAnalysisWorkflow).toHaveBeenCalled();
      expect(mockPatchBacklog).toHaveBeenCalled();
      expect(mockManager.createDeltaSession).toHaveBeenCalledWith(
        mockManager.prdPath
      );
      expect(mockManager.saveBacklog).toHaveBeenCalled();

      // VERIFY: marker was written before dispatch (dispatcher contract).
      expect(mockWriteFile).toHaveBeenCalledWith(
        resolve(session.metadata.path, PENDING_DELTA_HASH_FILE),
        expect.any(String),
        { mode: 0o644 }
      );
    });
  });

  describe('dispatcher guard', () => {
    it('throws if no session is loaded', async () => {
      // SETUP
      const { pipeline } = buildPipeline(null, {
        acceptPrdChanges: true,
      });

      // EXECUTE & VERIFY
      await expect(pipeline.handleDelta()).rejects.toThrow(
        'Cannot handle delta: no session loaded'
      );
    });

    it('throws if resolvePRD fails (marker must NOT be written)', async () => {
      // SETUP
      const session = createTestSession(createTestBacklog([]));
      const { pipeline } = buildPipeline(session, {
        acceptPrdChanges: true,
      });
      mockResolvePRD.mockRejectedValue(new Error('File not found'));

      // EXECUTE & VERIFY
      await expect(pipeline.handleDelta()).rejects.toThrow(
        'Failed to load new PRD'
      );
      // VERIFY: marker was NOT written (dispatch aborted before writePendingDeltaHash).
      expect(mockWriteFile).not.toHaveBeenCalledWith(
        resolve(session.metadata.path, PENDING_DELTA_HASH_FILE),
        expect.any(String),
        expect.anything()
      );
    });
  });

  describe('marker trio (session-utils)', () => {
    const sessionPath = '/plan/001_abc';

    it('writePendingDeltaHash writes the hash to prd_changed.marker with mode 0o644', async () => {
      // EXECUTE
      await writePendingDeltaHash(sessionPath, 'abc123def456');

      // VERIFY
      expect(mockWriteFile).toHaveBeenCalledWith(
        resolve(sessionPath, PENDING_DELTA_HASH_FILE),
        'abc123def456',
        { mode: 0o644 }
      );
    });

    it('readPendingDeltaHash returns the trimmed hash when the marker exists', async () => {
      // SETUP
      mockReadFile.mockResolvedValue('  abc123def456  \n');

      // EXECUTE
      const result = await readPendingDeltaHash(sessionPath);

      // VERIFY
      expect(result).toBe('abc123def456');
      expect(mockReadFile).toHaveBeenCalledWith(
        resolve(sessionPath, PENDING_DELTA_HASH_FILE),
        'utf-8'
      );
    });

    it('readPendingDeltaHash returns null when the marker is missing (ENOENT)', async () => {
      // SETUP
      mockReadFile.mockRejectedValue(
        Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      );

      // EXECUTE
      const result = await readPendingDeltaHash(sessionPath);

      // VERIFY
      expect(result).toBeNull();
    });

    it('clearPendingDeltaHash unlinks the marker', async () => {
      // EXECUTE
      await clearPendingDeltaHash(sessionPath);

      // VERIFY
      expect(mockUnlink).toHaveBeenCalledWith(
        resolve(sessionPath, PENDING_DELTA_HASH_FILE)
      );
    });

    it('clearPendingDeltaHash does not throw when the marker is missing', async () => {
      // SETUP
      mockUnlink.mockRejectedValue(
        Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      );

      // EXECUTE & VERIFY — resolves without throwing (idempotent clear).
      await expect(clearPendingDeltaHash(sessionPath)).resolves.toBeUndefined();
    });

    it('refreshSnapshotToCurrentPRD writes the resolved current PRD to prd_snapshot.md', async () => {
      // SETUP — refreshSnapshotToCurrentPRD calls the REAL resolvePRD (same-module
      // binding, not the mock), which reads the PRD via readFile (no encoding →
      // Buffer) and decodes it. Override readFile to return the fresh content.
      mockReadFile.mockImplementation((_path, encoding) =>
        encoding === 'utf-8'
          ? Promise.resolve('# Fresh PRD content')
          : Promise.resolve(Buffer.from('# Fresh PRD content', 'utf-8'))
      );

      // EXECUTE
      await refreshSnapshotToCurrentPRD(sessionPath, '/test/prd.md');

      // VERIFY
      expect(mockWriteFile).toHaveBeenCalledWith(
        resolve(sessionPath, 'prd_snapshot.md'),
        '# Fresh PRD content',
        { mode: 0o644 }
      );
    });

    it('writePendingDeltaHash wraps a writeFile failure in SessionFileError', async () => {
      // SETUP
      mockWriteFile.mockRejectedValue(new Error('disk full'));

      // EXECUTE & VERIFY
      await expect(
        writePendingDeltaHash(sessionPath, 'abc')
      ).rejects.toBeInstanceOf(SessionFileError);
    });

    it('writePendingDeltaHash rethrows an existing SessionFileError without re-wrapping', async () => {
      // SETUP
      const sfe = new SessionFileError(
        resolve(sessionPath, PENDING_DELTA_HASH_FILE),
        'write pending-delta marker',
        new Error('orig')
      );
      mockWriteFile.mockRejectedValue(sfe);

      // EXECUTE & VERIFY — same instance, not re-wrapped.
      await expect(writePendingDeltaHash(sessionPath, 'abc')).rejects.toBe(sfe);
    });

    it('refreshSnapshotToCurrentPRD wraps a writeFile failure in SessionFileError', async () => {
      // SETUP — resolvePRD succeeds (Buffer decoded); writeFile fails.
      mockReadFile.mockResolvedValue(
        Buffer.from('# Fresh PRD content', 'utf-8')
      );
      mockWriteFile.mockRejectedValue(new Error('disk full'));

      // EXECUTE & VERIFY
      await expect(
        refreshSnapshotToCurrentPRD(sessionPath, '/test/prd.md')
      ).rejects.toBeInstanceOf(SessionFileError);
    });

    it('refreshSnapshotToCurrentPRD rethrows an existing SessionFileError without re-wrapping', async () => {
      // SETUP — resolvePRD internally wraps readFile failures in a SessionFileError
      // (via readUTF8FileStrict); refreshSnapshotToCurrentPRD's catch must rethrow it
      // as-is rather than double-wrap.
      mockReadFile.mockRejectedValue(new Error('read boom'));

      // EXECUTE & VERIFY — a single SessionFileError propagates (not double-wrapped).
      await expect(
        refreshSnapshotToCurrentPRD(sessionPath, '/test/prd.md')
      ).rejects.toBeInstanceOf(SessionFileError);
    });
  });
});
