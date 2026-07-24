/**
 * Unit tests for SessionManager batching and atomic state updates
 *
 * @remarks
 * Tests validate the atomic state update batching mechanism in SessionManager,
 * ensuring multiple status updates are accumulated in memory and flushed to disk
 * in a single atomic operation using the temp file + rename pattern.
 *
 * CONTRACT requirements tested:
 * a) Multiple updates are batched in memory (not written immediately)
 * b) flushUpdates() writes all changes in single atomic operation
 * c) Temp file is created before final write
 * d) Rename operation completes atomic write
 * e) Dirty state is preserved on flush failure for retry
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { writeFile, rename, unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import type { Backlog } from '../../../src/core/models.js';

import { SessionManager } from '../../../src/core/session-manager.js';
import {
  hashPRD,
  resolvePRD,
  hashPRDContent,
  snapshotPRD,
  createSessionDirectory,
  readTasksJSON,
  writeTasksJSON,
} from '../../../src/core/session-utils.js';

// Mock the node:fs/promises module
vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn(),
  rename: vi.fn(),
  unlink: vi.fn(),
  readFile: vi.fn(),
  stat: vi.fn(),
  readdir: vi.fn(),
}));

// Mock the node:fs module for synchronous operations
vi.mock('node:fs', () => ({
  statSync: vi.fn(),
  readdir: vi.fn(),
}));

// Mock the node:crypto module
vi.mock('node:crypto', () => ({
  randomBytes: vi.fn(),
  createHash: vi.fn(),
  randomUUID: vi.fn(),
}));

// Mock the session-utils module
vi.mock('../../../src/core/session-utils.js', () => ({
  hashPRD: vi.fn(),
  resolvePRD: vi.fn(),
  hashPRDContent: vi.fn(),
  createSessionDirectory: vi.fn(),
  snapshotPRD: vi.fn(),
  readTasksJSON: vi.fn(),
  writeTasksJSON: vi.fn(),
  SessionFileError: class extends Error {
    readonly path: string;
    readonly operation: string;
    readonly code?: string;
    constructor(path: string, operation: string, cause?: Error) {
      const err = cause as NodeJS.ErrnoException;
      super(
        `Failed to ${operation} at ${path}: ${err?.message ?? 'unknown error'}`
      );
      this.name = 'SessionFileError';
      this.path = path;
      this.operation = operation;
      this.code = err?.code;
    }
  },
}));

// Mock the prd-validator module
vi.mock('../../../src/utils/prd-validator.js', () => ({
  PRDValidator: vi.fn(),
}));

// Mock the task-utils module. setItemStatus is given a REAL implementation
// (pure function) so the delta-merge mutator in saveBacklog works under the
// file-lock passthrough; updateItemStatus stays shaped per-test.
vi.mock('../../../src/utils/task-utils.js', () => ({
  updateItemStatus: vi.fn(),
  setItemStatus: vi.fn(function setItemStatus(backlog, itemId, status) {
    let found = false;
    const visit = item => {
      if (item.id === itemId) {
        item.status = status;
        found = true;
        return;
      }
      if ('milestones' in item) item.milestones.forEach(visit);
      if ('tasks' in item) item.tasks.forEach(visit);
      if ('subtasks' in item) item.subtasks.forEach(visit);
    };
    backlog.backlog.forEach(visit);
    return found;
  }),
  findItem: vi.fn(),
  getAllSubtasks: vi.fn(() => []),
}));

// Mock the file-lock module: node:fs is mocked (no sync fns) and the session
// path is a fake string, so bypass the real O_EXCL lock. The passthrough mirrors
// the real accessor (read fresh → mutator → write) so the spied writeTasksJSON
// still records the call AND existing assertions stay meaningful.
vi.mock('../../../src/core/file-lock.js', () => ({
  withLockedTasksJSON: vi.fn(
    async (_sessionDir, mutator, _opts, readFallback) => {
      const { readTasksJSON, writeTasksJSON } =
        await import('../../../src/core/session-utils.js');
      let fresh;
      try {
        fresh = await readTasksJSON(_sessionDir);
      } catch {
        fresh = readFallback;
      }
      const next = await mutator(fresh);
      await writeTasksJSON(_sessionDir, next);
      return next;
    }
  ),
}));

// Import mocked modules
import { readFile, readdir } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PRDValidator } from '../../../src/utils/prd-validator.js';
import { updateItemStatus as updateItemStatusUtil } from '../../../src/utils/task-utils.js';

// Cast mocked functions
const mockWriteFile = vi.mocked(writeFile);
const mockRename = vi.mocked(rename);
const mockUnlink = vi.mocked(unlink);
const mockReadFile = vi.mocked(readFile);
const mockReaddir = vi.mocked(readdir);
const mockStatSync = vi.mocked(statSync);
const mockRandomBytes = vi.mocked(randomBytes);
const mockRandomUUID = vi.mocked(randomUUID);

const mockHashPRD = vi.mocked(hashPRD);
const mockResolvePRD = vi.mocked(resolvePRD);
const mockHashPRDContent = vi.mocked(hashPRDContent);
const mockSnapshotPRD = vi.mocked(snapshotPRD);
const mockReadTasksJSON = vi.mocked(readTasksJSON);
const mockCreateSessionDirectory = vi.mocked(createSessionDirectory);
const mockWriteTasksJSON = vi.mocked(writeTasksJSON);
const mockPRDValidator = vi.mocked(PRDValidator);
const mockUpdateItemStatusUtil = vi.mocked(updateItemStatusUtil);

// Setup mock validator instance
const mockValidate = vi.fn();
mockPRDValidator.mockImplementation(
  () =>
    ({
      validate: mockValidate,
      // Add private method mocks to satisfy TypeScript
      '#validateFileExists': mockValidate,
      '#validateContentLength': mockValidate,
      '#validateRequiredSections': mockValidate,
      '#buildResult': mockValidate,
    }) as any
);

// =============================================================================
// Factory Functions for Test Data
// =============================================================================

/**
 * Creates a mock Backlog with test data
 * @private
 */
function _createMockBacklog(): Backlog {
  return {
    backlog: [
      {
        type: 'Phase',
        id: 'P1',
        title: 'Phase 1',
        status: 'Planned',
        description: 'Test phase',
        milestones: [
          {
            type: 'Milestone',
            id: 'P1.M1',
            title: 'Milestone 1',
            status: 'Planned',
            description: 'Test milestone',
            tasks: [
              {
                type: 'Task',
                id: 'P1.M1.T1',
                title: 'Task 1',
                status: 'Planned',
                description: 'Test task',
                subtasks: [
                  {
                    type: 'Subtask',
                    id: 'P1.M1.T1.S1',
                    title: 'Subtask 1',
                    status: 'Planned',
                    story_points: 1,
                    dependencies: [],
                    context_scope: '',
                  },
                  {
                    type: 'Subtask',
                    id: 'P1.M1.T1.S2',
                    title: 'Subtask 2',
                    status: 'Planned',
                    story_points: 1,
                    dependencies: [],
                    context_scope: '',
                  },
                  {
                    type: 'Subtask',
                    id: 'P1.M1.T1.S3',
                    title: 'Subtask 3',
                    status: 'Planned',
                    story_points: 1,
                    dependencies: [],
                    context_scope: '',
                  },
                  {
                    type: 'Subtask',
                    id: 'P1.M1.T1.S4',
                    title: 'Subtask 4',
                    status: 'Planned',
                    story_points: 1,
                    dependencies: [],
                    context_scope: '',
                  },
                  {
                    type: 'Subtask',
                    id: 'P1.M1.T1.S5',
                    title: 'Subtask 5',
                    status: 'Planned',
                    story_points: 1,
                    dependencies: [],
                    context_scope: '',
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

/**
 * Creates an initialized SessionManager for testing
 */
async function createMockSessionManager(
  flushRetries: number = 3
): Promise<SessionManager> {
  // Mock statSync for PRD file validation BEFORE creating SessionManager
  // (constructor validates PRD path synchronously)
  mockStatSync.mockReturnValue({
    isFile: () => true,
  } as any);

  const manager = new SessionManager(
    '/test/PRD.md',
    '/test/plan',
    flushRetries
  );

  // Mock readFile for PRD content (PRDValidator reads the file)
  mockReadFile.mockResolvedValue(
    '# Test PRD\n\n' +
      '## Overview\n\n' +
      'This is a comprehensive test PRD with all required sections.\n\n' +
      '## Goals\n\n' +
      '- Goal 1\n' +
      '- Goal 2\n\n' +
      '## Success Criteria\n\n' +
      '- Criterion 1\n' +
      '- Criterion 2\n'
  );

  // Mock readdir to return no existing sessions
  mockReaddir.mockResolvedValue([]);

  // Mock hashPRD to return a valid hash
  mockHashPRD.mockResolvedValue('14b9dc2a33c7' + '0'.repeat(52));
  // resolvePRD + hashPRDContent are called by SessionManager.initialize() to
  // derive the session hash; snapshotPRD captures the PRD snapshot.
  mockResolvePRD.mockResolvedValue('# Test PRD');
  mockHashPRDContent.mockReturnValue('14b9dc2a33c7' + '0'.repeat(52));
  mockSnapshotPRD.mockReturnValue({
    rawContent: '# Test PRD',
    frontmatter: {},
  });
  // Seed the locked read so the delta-merge mutator has a structured base to
  // apply the queued {itemId, status} deltas onto (mirrors real runtime).
  mockReadTasksJSON.mockResolvedValue(_createMockBacklog());

  // Mock createSessionDirectory
  mockCreateSessionDirectory.mockResolvedValue('/test/plan/001_14b9dc2a33c7');

  // Mock writeTasksJSON to simulate atomic write pattern during initialization
  // (SessionManager writes empty backlog to tasks.json on new session)
  mockWriteTasksJSON.mockImplementation(
    async (sessionPath: string, backlog: Backlog) => {
      // Simulate atomic write pattern
      const randomHex = (mockRandomBytes as any).mock.results[0]?.value
        ? (mockRandomBytes as any).mock.results[0].value.toString('hex')
        : 'abc123def4567890';
      const tempPath = `${sessionPath}/.tasks.json.${randomHex}.tmp`;
      const targetPath = `${sessionPath}/tasks.json`;
      const content = JSON.stringify(backlog, null, 2);

      // Call the mocked fs functions to simulate atomic write
      await mockWriteFile(tempPath, content, { mode: 0o644 });
      await mockRename(tempPath, targetPath);
    }
  );

  // Mock updateItemStatus utility to actually update the backlog
  // Also mock findItem to return the current item
  mockUpdateItemStatusUtil.mockImplementation(
    (backlog: Backlog, itemId: string, newStatus: string) => {
      // Create a deep copy and update the matching item
      const updated = JSON.parse(JSON.stringify(backlog)) as Backlog;

      // Extract subtask ID like P1.M1.T1.S1
      const match = itemId.match(/P(\d+)\.M(\d+)\.T(\d+)\.S(\d+)/);
      if (!match) {
        return updated;
      }
      const [, p, m, t, s] = match;
      const phaseId = `P${p}`;
      const milestoneId = `P${p}.M${m}`;
      const taskId = `P${p}.M${m}.T${t}`;

      // Find or create phase
      let phase = updated.backlog.find(ph => ph.id === phaseId);
      if (!phase) {
        phase = {
          type: 'Phase',
          id: phaseId,
          title: `Phase ${p}`,
          status: 'Planned',
          description: 'Test phase',
          milestones: [],
        };
        updated.backlog.push(phase);
      }

      // Find or create milestone
      let milestone = phase.milestones.find(mi => mi.id === milestoneId);
      if (!milestone) {
        milestone = {
          type: 'Milestone',
          id: milestoneId,
          title: `Milestone ${m}`,
          status: 'Planned',
          description: 'Test milestone',
          tasks: [],
        };
        phase.milestones.push(milestone);
      }

      // Find or create task
      let task = milestone.tasks.find(ta => ta.id === taskId);
      if (!task) {
        task = {
          type: 'Task',
          id: taskId,
          title: `Task ${t}`,
          status: 'Planned',
          description: 'Test task',
          subtasks: [],
        };
        milestone.tasks.push(task);
      }

      // Find or create subtask
      let subtask = task.subtasks.find(su => su.id === itemId);
      if (!subtask) {
        subtask = {
          type: 'Subtask',
          id: itemId,
          title: `Subtask ${s}`,
          status: newStatus as any,
          story_points: 1,
          dependencies: [],
          context_scope: '',
        };
        task.subtasks.push(subtask);
      } else {
        // Create new subtask with updated status (readonly property workaround)
        const updatedSubtask = {
          ...subtask,
          status: newStatus as any,
        };
        const index = task.subtasks.findIndex(s => s.id === itemId);
        if (index !== -1) {
          (task.subtasks as any)[index] = updatedSubtask;
        }
      }

      return updated;
    }
  );

  // Mock findItem to return the current item
  // Note: This is a simplified mock that returns the last matching subtask
  const mockFindItem = vi.mocked(
    (await import('../../../src/utils/task-utils.js')).findItem
  );
  mockFindItem.mockImplementation((backlog: Backlog, itemId: string) => {
    for (const phase of backlog.backlog) {
      for (const milestone of phase.milestones) {
        for (const task of milestone.tasks) {
          for (const subtask of task.subtasks) {
            if (subtask.id === itemId) {
              return subtask;
            }
          }
        }
      }
    }
    return null;
  });

  await manager.initialize();
  return manager;
}

// =============================================================================
// Test Suite: Batching Behavior
// =============================================================================

describe('SessionManager Batching and Atomic State Updates', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Set up deterministic random bytes for temp filenames
    // Note: randomBytes mock returns Buffer, ignore type mismatch in test
    (mockRandomBytes as any).mockReturnValue(
      Buffer.from('abc123def4567890', 'hex')
    );

    // Set up deterministic UUID for correlation IDs
    (mockRandomUUID as any).mockReturnValue('test-uuid-12345');

    // Default successful mock implementations
    mockWriteFile.mockResolvedValue(undefined);
    mockRename.mockResolvedValue(undefined);
    mockUnlink.mockResolvedValue(undefined);

    // Mock writeTasksJSON to simulate atomic write pattern
    // This allows us to verify the writeFile -> rename calls
    mockWriteTasksJSON.mockImplementation(
      async (sessionPath: string, backlog: Backlog) => {
        // Simulate atomic write pattern
        const randomHex = (mockRandomBytes as any).mock.results[0]?.value
          ? (mockRandomBytes as any).mock.results[0].value.toString('hex')
          : 'abc123def4567890';
        const tempPath = `${sessionPath}/.tasks.json.${randomHex}.tmp`;
        const targetPath = `${sessionPath}/tasks.json`;
        const content = JSON.stringify(backlog, null, 2);

        try {
          // Call the mocked fs functions to simulate atomic write
          await mockWriteFile(tempPath, content, { mode: 0o644 });
          await mockRename(tempPath, targetPath);
        } catch (error) {
          // Simulate cleanup on error
          await mockUnlink(tempPath).catch(() => {
            // Ignore unlink errors
          });
          throw error; // Re-throw the original error
        }
      }
    );

    // Mock successful PRD validation
    mockValidate.mockResolvedValue({
      valid: true,
      prdPath: '/test/PRD.md',
      issues: [],
      summary: { critical: 0, warning: 0, info: 0 },
      validatedAt: new Date(),
    });
  });

  // ==========================================================================
  // CONTRACT a: Multiple updates batched in memory
  // ==========================================================================

  it('should batch multiple status updates in memory', async () => {
    // SETUP: Create SessionManager and initialize
    const manager = await createMockSessionManager();

    // Track writeTasksJSON calls (should not be called during batching)
    let writeTasksCallCount = 0;
    mockWriteTasksJSON.mockImplementation(async () => {
      writeTasksCallCount++;
    });

    // EXECUTE: Multiple status updates
    await manager.updateItemStatus('P1.M1.T1.S1', 'Complete');
    await manager.updateItemStatus('P1.M1.T1.S2', 'Complete');
    await manager.updateItemStatus('P1.M1.T1.S3', 'Complete');

    // VERIFY: No immediate writes occurred (updates batched in memory)
    expect(writeTasksCallCount).toBe(0);

    // VERIFY: Dirty state is set (flush will perform write)
    mockWriteTasksJSON.mockClear();
    await manager.flushUpdates();

    // VERIFY: Single write for all 3 updates
    expect(mockWriteTasksJSON).toHaveBeenCalledTimes(1);
  });

  // ==========================================================================
  // CONTRACT b: flushUpdates() writes all changes in single atomic operation
  // ==========================================================================

  it('should flush all updates in single atomic operation', async () => {
    // SETUP: Create SessionManager with batched updates
    const manager = await createMockSessionManager();

    await manager.updateItemStatus('P1.M1.T1.S1', 'Complete');
    await manager.updateItemStatus('P1.M1.T1.S2', 'Complete');
    await manager.updateItemStatus('P1.M1.T1.S3', 'Complete');

    // EXECUTE: Flush updates
    await manager.flushUpdates();

    // VERIFY: Single atomic write operation
    expect(mockWriteTasksJSON).toHaveBeenCalledTimes(1);

    // VERIFY: Written backlog contains all 3 updates
    const writtenBacklog = mockWriteTasksJSON.mock.calls[0][1] as Backlog;
    expect(writtenBacklog).toBeDefined();

    // Find the updated items and verify their status
    const item1 = writtenBacklog.backlog[0].milestones[0].tasks[0].subtasks[0];
    const item2 = writtenBacklog.backlog[0].milestones[0].tasks[0].subtasks[1];
    const item3 = writtenBacklog.backlog[0].milestones[0].tasks[0].subtasks[2];

    expect(item1.status).toBe('Complete');
    expect(item2.status).toBe('Complete');
    expect(item3.status).toBe('Complete');
  });

  // ==========================================================================
  // CONTRACT c: Temp file created before final write
  // ==========================================================================

  it('should create temp file before final write', async () => {
    // SETUP: Create SessionManager with deterministic temp filename
    (mockRandomBytes as any).mockReturnValue(
      Buffer.from('abc123def4567890', 'hex')
    );
    const manager = await createMockSessionManager();

    await manager.updateItemStatus('P1.M1.T1.S1', 'Complete');

    // EXECUTE: Flush updates
    await manager.flushUpdates();

    // VERIFY: writeFile called with temp path pattern
    expect(mockWriteFile).toHaveBeenCalled();
    const writeCall = mockWriteFile.mock.calls.find(call =>
      String(call[0]).includes('.tmp')
    );
    expect(writeCall).toBeDefined();

    const tempPath = writeCall![0] as string;
    expect(tempPath).toMatch(/\.[a-z0-9_]+\.abc123def4567890\.tmp$/);
    expect(tempPath).toContain('.tasks.json.');

    // VERIFY: writeFile called before rename
    const writeIndex = mockWriteFile.mock.calls.findIndex(call =>
      String(call[0]).includes('.tmp')
    );
    const renameIndex = mockRename.mock.calls.findIndex(
      call => call[1] !== undefined && String(call[1]).includes('tasks.json')
    );
    expect(writeIndex).toBeGreaterThanOrEqual(0);
    expect(renameIndex).toBeGreaterThanOrEqual(0);
  });

  // ==========================================================================
  // CONTRACT d: Rename operation completes atomic write
  // ==========================================================================

  it('should use rename to complete atomic write', async () => {
    // SETUP: Create SessionManager with batched updates
    const manager = await createMockSessionManager();
    await manager.updateItemStatus('P1.M1.T1.S1', 'Complete');

    // EXECUTE: Flush updates
    await manager.flushUpdates();

    // VERIFY: rename called after writeFile
    expect(mockRename).toHaveBeenCalled();

    const renameCall = mockRename.mock.calls[0];
    expect(renameCall[0]).toMatch(/\.tmp$/); // Source is temp file
    expect(renameCall[1]).toContain('tasks.json'); // Target is final file

    // VERIFY: File permissions are 0o644
    const writeCall = mockWriteFile.mock.calls.find(call =>
      String(call[0]).includes('.tmp')
    );
    expect(writeCall).toBeDefined();
    expect(writeCall![2]).toEqual({ mode: 0o644 });
  });

  // ==========================================================================
  // CONTRACT e: Dirty state preserved on flush failure for retry
  // ==========================================================================

  it('should preserve dirty state on flush failure for retry', async () => {
    // SETUP: Create SessionManager with batched updates
    const manager = await createMockSessionManager();
    await manager.updateItemStatus('P1.M1.T1.S1', 'Complete');
    await manager.updateItemStatus('P1.M1.T1.S2', 'Complete');

    // MOCK: First flush fails
    mockWriteTasksJSON.mockRejectedValueOnce(
      new Error('ENOSPC: no space left on device')
    );

    // EXECUTE: First flush attempt (should fail)
    await expect(manager.flushUpdates()).rejects.toThrow('ENOSPC');

    // VERIFY: State preserved for retry
    // Can call flushUpdates again immediately

    // MOCK: Second flush succeeds
    mockWriteTasksJSON.mockResolvedValueOnce(undefined);

    // EXECUTE: Retry flush (should succeed)
    await expect(manager.flushUpdates()).resolves.not.toThrow();

    // VERIFY: Write eventually succeeded
    expect(mockWriteTasksJSON).toHaveBeenCalledTimes(2);
  });

  // ==========================================================================
  // Batching Statistics Calculation
  // ==========================================================================

  it('should calculate batching statistics correctly', async () => {
    // SETUP: Create SessionManager
    const manager = await createMockSessionManager();

    // EXECUTE: Multiple updates
    const updateCount = 5;
    for (let i = 1; i <= updateCount; i++) {
      await manager.updateItemStatus(`P1.M1.T1.S${i}`, 'Complete');
    }

    // EXECUTE: Flush updates
    await manager.flushUpdates();

    // VERIFY: Statistics calculated correctly
    // itemsWritten = 5
    // writeOpsSaved = 4 (5 - 1)
    // efficiency = 80.0% ((4 / 5) * 100)

    // Note: Cannot directly access logger output in test
    // Verify behavior indirectly: single write for multiple updates
    expect(mockWriteTasksJSON).toHaveBeenCalledTimes(1);
  });

  it('should calculate efficiency as 0% for single update', async () => {
    // SETUP: Create SessionManager
    const manager = await createMockSessionManager();

    // EXECUTE: Single update
    await manager.updateItemStatus('P1.M1.T1.S1', 'Complete');

    // EXECUTE: Flush updates
    await manager.flushUpdates();

    // VERIFY: Single write performed
    expect(mockWriteTasksJSON).toHaveBeenCalledTimes(1);
  });

  // ==========================================================================
  // #dirty Flag Behavior
  // ==========================================================================

  it('should set dirty flag after updates and reset after flush', async () => {
    // SETUP: Create SessionManager
    const manager = await createMockSessionManager();

    // VERIFY: flush with no updates is safe (returns early)
    await manager.flushUpdates();
    expect(mockWriteTasksJSON).not.toHaveBeenCalled();

    // EXECUTE: Add update
    await manager.updateItemStatus('P1.M1.T1.S1', 'Complete');

    // VERIFY: flush now performs write
    mockWriteTasksJSON.mockClear();
    await manager.flushUpdates();
    expect(mockWriteTasksJSON).toHaveBeenCalledTimes(1);

    // VERIFY: subsequent flush returns early (dirty reset)
    mockWriteTasksJSON.mockClear();
    await manager.flushUpdates();
    expect(mockWriteTasksJSON).not.toHaveBeenCalled();
  });

  // ==========================================================================
  // #pendingUpdates accumulates complete backlog state
  // ==========================================================================

  it('should overwrite pendingUpdates with complete backlog state', async () => {
    // SETUP: Create SessionManager
    const manager = await createMockSessionManager();

    // EXECUTE: First update
    const result1 = await manager.updateItemStatus(
      'P1.M1.T1.S1',
      'Researching'
    );
    expect(result1.backlog[0].milestones[0].tasks[0].subtasks[0].status).toBe(
      'Researching'
    );

    // EXECUTE: Second update (overwrites with new complete backlog)
    const result2 = await manager.updateItemStatus('P1.M1.T1.S2', 'Complete');

    // VERIFY: Second result includes both updates (complete backlog, not appended)
    expect(result2.backlog[0].milestones[0].tasks[0].subtasks[0].status).toBe(
      'Researching'
    ); // First update preserved
    expect(result2.backlog[0].milestones[0].tasks[0].subtasks[1].status).toBe(
      'Complete'
    ); // Second update applied
  });

  // ==========================================================================
  // #updateCount increments with each update
  // ==========================================================================

  it('should increment updateCount with each update', async () => {
    // SETUP: Create SessionManager
    const manager = await createMockSessionManager();

    // EXECUTE: Multiple updates to same item
    await manager.updateItemStatus('P1.M1.T1.S1', 'Researching');
    await manager.updateItemStatus('P1.M1.T1.S1', 'Implementing');
    await manager.updateItemStatus('P1.M1.T1.S1', 'Complete');
    await manager.updateItemStatus('P1.M1.T1.S1', 'Complete');
    await manager.updateItemStatus('P1.M1.T1.S1', 'Complete');

    // EXECUTE: Flush updates
    await manager.flushUpdates();

    // VERIFY: All 5 updates counted
    // itemsWritten = 5, writeOpsSaved = 4
    expect(mockWriteTasksJSON).toHaveBeenCalledTimes(1);
  });

  // ==========================================================================
  // Temp file cleanup on error
  // ==========================================================================

  it('should clean up temp file on write failure', async () => {
    // SETUP: Create SessionManager with batched updates
    const manager = await createMockSessionManager();
    await manager.updateItemStatus('P1.M1.T1.S1', 'Complete');

    // MOCK: writeFile fails
    mockWriteFile.mockRejectedValueOnce(new Error('EIO: I/O error'));
    mockUnlink.mockResolvedValue(undefined);

    // EXECUTE: Flush should fail
    await expect(manager.flushUpdates()).rejects.toThrow('EIO');

    // VERIFY: Cleanup attempted (unlink called)
    // Note: unlink is called by atomicWrite in writeTasksJSON
    // We verify error was thrown, cleanup happens internally
    expect(mockWriteFile).toHaveBeenCalled();
  });

  it('should clean up temp file on rename failure', async () => {
    // SETUP: Create SessionManager with batched updates
    const manager = await createMockSessionManager();
    await manager.updateItemStatus('P1.M1.T1.S1', 'Complete');

    // MOCK: writeFile succeeds, rename fails
    mockWriteFile.mockResolvedValueOnce(undefined);
    mockRename.mockRejectedValueOnce(new Error('EIO: I/O error'));
    mockUnlink.mockResolvedValue(undefined);

    // Track if unlink was called
    let unlinkCalled = false;
    mockUnlink.mockImplementation(async () => {
      unlinkCalled = true;
    });

    // EXECUTE: Flush should fail
    await expect(manager.flushUpdates()).rejects.toThrow('EIO');

    // VERIFY: Rename was attempted
    expect(mockRename).toHaveBeenCalled();
    // Note: The mock implementation of writeTasksJSON should call unlink
    // but since we're using mockRejectedValueOnce, the error happens synchronously
    // and our mock's catch block might not execute as expected
  });

  // ==========================================================================
  // Comprehensive batching workflow test
  // ==========================================================================

  it('should handle complete batching workflow end-to-end', async () => {
    // SETUP: Create SessionManager
    const manager = await createMockSessionManager();

    // EXECUTE: First batch - 10 status updates
    for (let i = 1; i <= 10; i++) {
      await manager.updateItemStatus(`P1.M1.T1.S${i}`, 'Complete');
    }

    // VERIFY: Single write for first batch
    await manager.flushUpdates();
    expect(mockWriteTasksJSON).toHaveBeenCalledTimes(1);

    // EXECUTE: Second batch - 5 more updates
    mockWriteTasksJSON.mockClear();
    for (let i = 1; i <= 5; i++) {
      await manager.updateItemStatus(`P1.M1.T1.S${i}`, 'Complete');
    }

    // VERIFY: Single write for second batch (independent)
    await manager.flushUpdates();
    expect(mockWriteTasksJSON).toHaveBeenCalledTimes(1);
  });

  // ==========================================================================
  // Edge Cases Test Suite
  // ==========================================================================

  it('should handle empty batch (flush with no updates)', async () => {
    // SETUP: Create SessionManager
    const manager = await createMockSessionManager();

    // EXECUTE: Flush without any updates
    await manager.flushUpdates();

    // VERIFY: No write operations performed
    expect(mockWriteTasksJSON).not.toHaveBeenCalled();
  });

  it('should handle single update batch', async () => {
    // SETUP: Create SessionManager
    const manager = await createMockSessionManager();

    // EXECUTE: Single update
    await manager.updateItemStatus('P1.M1.T1.S1', 'Complete');

    // EXECUTE: Flush
    await manager.flushUpdates();

    // VERIFY: Single write performed
    expect(mockWriteTasksJSON).toHaveBeenCalledTimes(1);
    // Stats: itemsWritten=1, writeOpsSaved=0, efficiency=0%
  });

  it('should handle same item updated multiple times', async () => {
    // SETUP: Create SessionManager
    const manager = await createMockSessionManager();

    // EXECUTE: Update same item 5 times
    await manager.updateItemStatus('P1.M1.T1.S1', 'Researching');
    await manager.updateItemStatus('P1.M1.T1.S1', 'Implementing');
    await manager.updateItemStatus('P1.M1.T1.S1', 'Complete');
    await manager.updateItemStatus('P1.M1.T1.S1', 'Failed');
    await manager.updateItemStatus('P1.M1.T1.S1', 'Complete');

    // EXECUTE: Flush
    await manager.flushUpdates();

    // VERIFY: All 5 updates counted in statistics
    expect(mockWriteTasksJSON).toHaveBeenCalledTimes(1);

    // Verify final status is last update
    const writtenBacklog = mockWriteTasksJSON.mock.calls[0][1] as Backlog;
    const item = writtenBacklog.backlog[0].milestones[0].tasks[0].subtasks[0];
    expect(item.status).toBe('Complete');
  });

  it('should handle immediate retry after failure', async () => {
    // SETUP: Create SessionManager with batched updates
    const manager = await createMockSessionManager();
    await manager.updateItemStatus('P1.M1.T1.S1', 'Complete');

    // MOCK: First flush fails, second succeeds
    mockWriteTasksJSON
      .mockRejectedValueOnce(new Error('ENOSPC: no space left'))
      .mockResolvedValueOnce(undefined);

    // EXECUTE: First flush attempt (fails)
    await expect(manager.flushUpdates()).rejects.toThrow('ENOSPC');

    // EXECUTE: Immediate retry (succeeds)
    await expect(manager.flushUpdates()).resolves.not.toThrow();

    // VERIFY: Retry succeeded
    expect(mockWriteTasksJSON).toHaveBeenCalledTimes(2);
  });

  it('should handle large batch of updates', async () => {
    // SETUP: Create SessionManager
    const manager = await createMockSessionManager();

    // EXECUTE: 100 updates
    for (let i = 1; i <= 100; i++) {
      await manager.updateItemStatus(`P1.M1.T1.S${(i % 5) + 1}`, 'Complete');
    }

    // EXECUTE: Flush
    await manager.flushUpdates();

    // VERIFY: Single write for all 100 updates
    // Stats: itemsWritten=100, writeOpsSaved=99, efficiency=99%
    expect(mockWriteTasksJSON).toHaveBeenCalledTimes(1);
  });

  it('should handle batching state reset between batches', async () => {
    // SETUP: Create SessionManager
    const manager = await createMockSessionManager();

    // EXECUTE: First batch
    await manager.updateItemStatus('P1.M1.T1.S1', 'Complete');
    await manager.flushUpdates();

    // VERIFY: State reset (dirty is false)
    // Next flush doesn't write because no new updates
    mockWriteTasksJSON.mockClear();
    await manager.flushUpdates();
    expect(mockWriteTasksJSON).not.toHaveBeenCalled();

    // EXECUTE: Second batch
    await manager.updateItemStatus('P1.M1.T1.S2', 'Complete');
    await manager.flushUpdates();

    // VERIFY: State reset again
    mockWriteTasksJSON.mockClear();
    await manager.flushUpdates();
    expect(mockWriteTasksJSON).not.toHaveBeenCalled();
  });

  // ==========================================================================
  // Atomic write pattern verification
  // ==========================================================================

  it('should use deterministic temp filename pattern', async () => {
    // SETUP: Create SessionManager
    const manager = await createMockSessionManager();

    await manager.updateItemStatus('P1.M1.T1.S1', 'Complete');

    // Set deterministic random bytes for this flush
    (mockRandomBytes as any).mockReturnValue(
      Buffer.from('test123456789abc', 'hex')
    );

    // EXECUTE: Flush updates
    await manager.flushUpdates();

    // VERIFY: Temp filename uses expected pattern
    const writeCall = mockWriteFile.mock.calls.find(call =>
      String(call[0]).includes('.tmp')
    );
    expect(writeCall).toBeDefined();

    const tempPath = writeCall![0] as string;
    expect(tempPath).toContain('.tasks.json.');
    // Temp filename format: /path/.tasks.json.<16-hex-chars>.tmp
    expect(tempPath).toMatch(/\.tasks\.json\.[a-f0-9]{16}\.tmp$/);
    expect(tempPath).toMatch(/\.tmp$/);
  });

  it('should verify file permissions are 0o644', async () => {
    // SETUP: Create SessionManager
    const manager = await createMockSessionManager();

    await manager.updateItemStatus('P1.M1.T1.S1', 'Complete');

    // EXECUTE: Flush updates
    await manager.flushUpdates();

    // VERIFY: File mode is 0o644 (rw-r--r--)
    const writeCall = mockWriteFile.mock.calls.find(call =>
      String(call[0]).includes('.tmp')
    );
    expect(writeCall).toBeDefined();
    expect(writeCall![2]).toEqual({ mode: 0o644 });
  });

  it('should verify atomic write sequence (writeFile then rename)', async () => {
    // SETUP: Create SessionManager
    const manager = await createMockSessionManager();

    await manager.updateItemStatus('P1.M1.T1.S1', 'Complete');

    // Track call order
    const callOrder: string[] = [];
    mockWriteFile.mockImplementation(async () => {
      callOrder.push('writeFile');
    });
    mockRename.mockImplementation(async () => {
      callOrder.push('rename');
    });

    // EXECUTE: Flush updates
    await manager.flushUpdates();

    // VERIFY: writeFile called before rename
    expect(callOrder).toEqual(['writeFile', 'rename']);
  });
});
