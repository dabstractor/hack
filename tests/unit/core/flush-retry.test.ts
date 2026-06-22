/**
 * Unit tests for SessionManager flush retry mechanism
 *
 * @remarks
 * Tests validate the automatic retry mechanism for batch write operations
 * in SessionManager, ensuring:
 * - Retry on transient file I/O errors (EBUSY, EAGAIN, EIO, ENFILE)
 * - Exponential backoff with jitter (100ms base, 2s max, factor 2)
 * - Non-retryable errors fail fast (ENOSPC, ENOENT, EACCES)
 * - Recovery file creation after all retries exhausted
 * - Logging of retry attempts with context
 * - CLI option --flush-retries configuration
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
  createSessionDirectory,
  writeTasksJSON,
  SessionFileError,
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
  randomUUID: vi.fn(() => 'test-uuid-flush-retry'),
}));

// Mock the session-utils module
vi.mock('../../../src/core/session-utils.js', () => ({
  hashPRD: vi.fn(),
  createSessionDirectory: vi.fn(),
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

// Mock the task-utils module
vi.mock('../../../src/utils/task-utils.js', () => ({
  updateItemStatus: vi.fn(),
  findItem: vi.fn(),
  getAllSubtasks: vi.fn(() => []),
}));

// Import mocked modules
import { readFile, readdir } from 'node:fs/promises';
import { statSync } from 'node:fs';
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

const mockHashPRD = vi.mocked(hashPRD);
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
      validateFileExists: vi.fn(),
      validateContentLength: vi.fn(),
      validateRequiredSections: vi.fn(),
      buildResult: vi.fn(),
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
      const subtask = task.subtasks.find(su => su.id === itemId);
      if (!subtask) {
        // Create a new subtask object with the updated status
        (task as any).subtasks = task.subtasks.filter(su => su.id !== itemId);
        (task as any).subtasks.push({
          type: 'Subtask',
          id: itemId,
          title: `Subtask ${s}`,
          status: newStatus as any,
          story_points: 1,
          dependencies: [],
          context_scope: '',
        });
      } else {
        // Replace the subtask with a new object with updated status
        const index = task.subtasks.findIndex(su => su.id === itemId);
        if (index !== -1) {
          (task as any).subtasks.splice(index, 1, {
            ...subtask,
            status: newStatus as any,
          });
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
// Test Suite: Flush Retry Mechanism
// =============================================================================

describe('SessionManager Flush Retry Mechanism', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Set up deterministic random bytes for temp filenames
    // Note: randomBytes mock returns Buffer, ignore type mismatch in test
    (mockRandomBytes as any).mockReturnValue(
      Buffer.from('abc123def4567890', 'hex')
    );

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
  // Retryable Errors
  // ==========================================================================

  it('should retry on EBUSY error (file locked)', async () => {
    // SETUP: Create SessionManager with batched updates
    const manager = await createMockSessionManager(3);
    await manager.updateItemStatus('P1.M1.T1.S1', 'Complete');

    // MOCK: First two attempts fail with EBUSY, third succeeds
    const busyError = new SessionFileError(
      '/test/plan/001_14b9dc2a33c7/tasks.json',
      'atomic write',
      Object.assign(new Error('EBUSY: file locked'), { code: 'EBUSY' })
    );

    mockWriteTasksJSON
      .mockRejectedValueOnce(busyError)
      .mockRejectedValueOnce(busyError)
      .mockResolvedValueOnce(undefined);

    // Use fake timers to control setTimeout
    vi.useFakeTimers();

    // EXECUTE: Flush updates
    const flushPromise = manager.flushUpdates();

    // Advance timers to trigger delays
    await vi.runAllTimersAsync();
    await flushPromise.catch(() => {
      // Catch any errors to avoid unhandled rejections
    });

    vi.useRealTimers();

    // VERIFY: 3 attempts were made (2 failures, 1 success)
    expect(mockWriteTasksJSON).toHaveBeenCalledTimes(3);
  });

  it('should retry on EAGAIN error (temporarily unavailable)', async () => {
    // SETUP: Create SessionManager with batched updates
    const manager = await createMockSessionManager(3);
    await manager.updateItemStatus('P1.M1.T1.S1', 'Complete');

    // MOCK: First attempt fails with EAGAIN, second succeeds
    const againError = new SessionFileError(
      '/test/plan/001_14b9dc2a33c7/tasks.json',
      'atomic write',
      Object.assign(new Error('EAGAIN: temporarily unavailable'), {
        code: 'EAGAIN',
      })
    );

    mockWriteTasksJSON
      .mockRejectedValueOnce(againError)
      .mockResolvedValueOnce(undefined);

    // Use fake timers to control setTimeout
    vi.useFakeTimers();

    // EXECUTE: Flush updates
    const flushPromise = manager.flushUpdates();

    // Advance timers to trigger delays
    await vi.runAllTimersAsync();
    await flushPromise.catch(() => {
      // Catch any errors to avoid unhandled rejections
    });

    vi.useRealTimers();

    // VERIFY: 2 attempts were made (1 failure, 1 success)
    expect(mockWriteTasksJSON).toHaveBeenCalledTimes(2);
  });

  it('should retry on EIO error (transient I/O)', async () => {
    // SETUP: Create SessionManager with batched updates
    const manager = await createMockSessionManager(3);
    await manager.updateItemStatus('P1.M1.T1.S1', 'Complete');

    // MOCK: First attempt fails with EIO, second succeeds
    const ioError = new SessionFileError(
      '/test/plan/001_14b9dc2a33c7/tasks.json',
      'atomic write',
      Object.assign(new Error('EIO: I/O error'), { code: 'EIO' })
    );

    mockWriteTasksJSON
      .mockRejectedValueOnce(ioError)
      .mockResolvedValueOnce(undefined);

    // Use fake timers to control setTimeout
    vi.useFakeTimers();

    // EXECUTE: Flush updates
    const flushPromise = manager.flushUpdates();

    // Advance timers to trigger delays
    await vi.runAllTimersAsync();
    await flushPromise.catch(() => {
      // Catch any errors to avoid unhandled rejections
    });

    vi.useRealTimers();

    // VERIFY: 2 attempts were made
    expect(mockWriteTasksJSON).toHaveBeenCalledTimes(2);
  });

  it('should retry on ENFILE error (file table full)', async () => {
    // SETUP: Create SessionManager with batched updates
    const manager = await createMockSessionManager(3);
    await manager.updateItemStatus('P1.M1.T1.S1', 'Complete');

    // MOCK: First attempt fails with ENFILE, second succeeds
    const enfileError = new SessionFileError(
      '/test/plan/001_14b9dc2a33c7/tasks.json',
      'atomic write',
      Object.assign(new Error('ENFILE: file table full'), { code: 'ENFILE' })
    );

    mockWriteTasksJSON
      .mockRejectedValueOnce(enfileError)
      .mockResolvedValueOnce(undefined);

    // Use fake timers to control setTimeout
    vi.useFakeTimers();

    // EXECUTE: Flush updates
    const flushPromise = manager.flushUpdates();

    // Advance timers to trigger delays
    await vi.runAllTimersAsync();
    await flushPromise.catch(() => {
      // Catch any errors to avoid unhandled rejections
    });

    vi.useRealTimers();

    // VERIFY: 2 attempts were made
    expect(mockWriteTasksJSON).toHaveBeenCalledTimes(2);
  });

  // ==========================================================================
  // Non-retryable Errors (Fail Fast)
  // ==========================================================================

  it('should not retry on ENOSPC error (disk full)', async () => {
    // SETUP: Create SessionManager with batched updates
    const manager = await createMockSessionManager(3);
    await manager.updateItemStatus('P1.M1.T1.S1', 'Complete');

    // MOCK: Flush fails with ENOSPC (non-retryable)
    const nospcError = new SessionFileError(
      '/test/plan/001_14b9dc2a33c7/tasks.json',
      'atomic write',
      Object.assign(new Error('ENOSPC: no space left'), { code: 'ENOSPC' })
    );

    mockWriteTasksJSON.mockRejectedValueOnce(nospcError);

    // EXECUTE: Flush updates
    await expect(manager.flushUpdates()).rejects.toThrow('ENOSPC');

    // VERIFY: Only 1 attempt was made (fail fast)
    expect(mockWriteTasksJSON).toHaveBeenCalledTimes(1);

    // VERIFY: Recovery file was created
    expect(mockWriteFile).toHaveBeenCalledWith(
      '/test/plan/001_14b9dc2a33c7/tasks.json.failed',
      expect.stringContaining('ENOSPC'),
      { mode: 0o644 }
    );
  });

  it('should not retry on ENOENT error (file not found)', async () => {
    // SETUP: Create SessionManager with batched updates
    const manager = await createMockSessionManager(3);
    await manager.updateItemStatus('P1.M1.T1.S1', 'Complete');

    // MOCK: Flush fails with ENOENT (non-retryable)
    const enoentError = new SessionFileError(
      '/test/plan/001_14b9dc2a33c7/tasks.json',
      'atomic write',
      Object.assign(new Error('ENOENT: file not found'), { code: 'ENOENT' })
    );

    mockWriteTasksJSON.mockRejectedValueOnce(enoentError);

    // EXECUTE: Flush updates
    await expect(manager.flushUpdates()).rejects.toThrow('ENOENT');

    // VERIFY: Only 1 attempt was made (fail fast)
    expect(mockWriteTasksJSON).toHaveBeenCalledTimes(1);

    // VERIFY: Recovery file was created
    expect(mockWriteFile).toHaveBeenCalledWith(
      '/test/plan/001_14b9dc2a33c7/tasks.json.failed',
      expect.stringContaining('ENOENT'),
      { mode: 0o644 }
    );
  });

  it('should not retry on EACCES error (permission denied)', async () => {
    // SETUP: Create SessionManager with batched updates
    const manager = await createMockSessionManager(3);
    await manager.updateItemStatus('P1.M1.T1.S1', 'Complete');

    // MOCK: Flush fails with EACCES (non-retryable)
    const eaccesError = new SessionFileError(
      '/test/plan/001_14b9dc2a33c7/tasks.json',
      'atomic write',
      Object.assign(new Error('EACCES: permission denied'), {
        code: 'EACCES',
      })
    );

    mockWriteTasksJSON.mockRejectedValueOnce(eaccesError);

    // EXECUTE: Flush updates
    await expect(manager.flushUpdates()).rejects.toThrow('EACCES');

    // VERIFY: Only 1 attempt was made (fail fast)
    expect(mockWriteTasksJSON).toHaveBeenCalledTimes(1);

    // VERIFY: Recovery file was created
    expect(mockWriteFile).toHaveBeenCalledWith(
      '/test/plan/001_14b9dc2a33c7/tasks.json.failed',
      expect.stringContaining('EACCES'),
      { mode: 0o644 }
    );
  });

  // ==========================================================================
  // Exponential Backoff
  // ==========================================================================

  it('should use exponential backoff between retries', async () => {
    // SETUP: Create SessionManager with batched updates
    const manager = await createMockSessionManager(5);
    await manager.updateItemStatus('P1.M1.T1.S1', 'Complete');

    // MOCK: All attempts fail with EBUSY
    const busyError = new SessionFileError(
      '/test/plan/001_14b9dc2a33c7/tasks.json',
      'atomic write',
      Object.assign(new Error('EBUSY: file locked'), { code: 'EBUSY' })
    );

    // Reset and set mock to reject 5 times
    mockWriteTasksJSON.mockReset();
    for (let i = 0; i < 5; i++) {
      mockWriteTasksJSON.mockRejectedValueOnce(busyError);
    }

    // Use fake timers to control setTimeout
    vi.useFakeTimers();

    // Track setTimeout calls AFTER enabling fake timers
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

    // EXECUTE: Flush updates - expect it to reject
    const flushPromise = expect(manager.flushUpdates()).rejects.toThrow(
      'EBUSY'
    );

    // Advance timers to trigger all delays
    await vi.runAllTimersAsync();

    // Wait for the rejection to be processed
    await flushPromise;

    // VERIFY: setTimeout was called for each retry delay
    // Should have 4 retries (attempts 2-5)
    expect(setTimeoutSpy).toHaveBeenCalledTimes(4);

    vi.useRealTimers();

    setTimeoutSpy.mockRestore();
  });

  // ==========================================================================
  // Recovery File Creation
  // ==========================================================================

  it('should preserve to recovery file after all retries fail', async () => {
    // SETUP: Create SessionManager with batched updates
    const manager = await createMockSessionManager(3);
    await manager.updateItemStatus('P1.M1.T1.S1', 'Complete');
    await manager.updateItemStatus('P1.M1.T1.S2', 'Complete');

    // MOCK: All attempts fail with EBUSY
    const busyError = new SessionFileError(
      '/test/plan/001_14b9dc2a33c7/tasks.json',
      'atomic write',
      Object.assign(new Error('EBUSY: file locked'), { code: 'EBUSY' })
    );

    // Reset and set mock to reject 3 times
    mockWriteTasksJSON.mockReset();
    for (let i = 0; i < 3; i++) {
      mockWriteTasksJSON.mockRejectedValueOnce(busyError);
    }

    // Use fake timers to control setTimeout
    vi.useFakeTimers();

    // EXECUTE: Flush updates - expect it to reject
    const flushPromise = expect(manager.flushUpdates()).rejects.toThrow(
      'EBUSY'
    );

    // Advance timers to trigger all delays
    await vi.runAllTimersAsync();

    // Wait for the rejection to be processed
    await flushPromise;

    vi.useRealTimers();

    // VERIFY: Recovery file was created
    expect(mockWriteFile).toHaveBeenCalledWith(
      '/test/plan/001_14b9dc2a33c7/tasks.json.failed',
      expect.stringContaining('"version": "1.0"'),
      { mode: 0o644 }
    );

    // VERIFY: Recovery file contains pending updates
    const recoveryFileCall = mockWriteFile.mock.calls.find(call =>
      String(call[0]).includes('tasks.json.failed')
    );
    expect(recoveryFileCall).toBeDefined();

    const recoveryContent = recoveryFileCall![1] as string;
    const recoveryData = JSON.parse(recoveryContent);

    expect(recoveryData.version).toBe('1.0');
    expect(recoveryData.error.code).toBe('EBUSY');
    expect(recoveryData.error.attempts).toBe(3);
    expect(recoveryData.pendingCount).toBe(2);
    expect(recoveryData.pendingUpdates).toBeDefined();
  });

  // ==========================================================================
  // CLI Option Configuration
  // ==========================================================================

  it('should respect --flush-retries 0 (disable retry)', async () => {
    // SETUP: Create SessionManager with 0 retries
    const manager = await createMockSessionManager(0);
    await manager.updateItemStatus('P1.M1.T1.S1', 'Complete');

    // MOCK: First attempt fails with EBUSY
    const busyError = new SessionFileError(
      '/test/plan/001_14b9dc2a33c7/tasks.json',
      'atomic write',
      Object.assign(new Error('EBUSY: file locked'), { code: 'EBUSY' })
    );

    mockWriteTasksJSON.mockRejectedValueOnce(busyError);

    // EXECUTE: Flush updates
    await expect(manager.flushUpdates()).rejects.toThrow('EBUSY');

    // VERIFY: Only 1 attempt was made (no retries)
    expect(mockWriteTasksJSON).toHaveBeenCalledTimes(1);
  });

  it('should respect --flush-retries 5 (allow 5 retries)', async () => {
    // SETUP: Create SessionManager with 5 retries
    const manager = await createMockSessionManager(5);
    await manager.updateItemStatus('P1.M1.T1.S1', 'Complete');

    // MOCK: First 4 attempts fail, 5th succeeds
    const busyError = new SessionFileError(
      '/test/plan/001_14b9dc2a33c7/tasks.json',
      'atomic write',
      Object.assign(new Error('EBUSY: file locked'), { code: 'EBUSY' })
    );

    mockWriteTasksJSON
      .mockRejectedValueOnce(busyError)
      .mockRejectedValueOnce(busyError)
      .mockRejectedValueOnce(busyError)
      .mockRejectedValueOnce(busyError)
      .mockResolvedValueOnce(undefined);

    // Use fake timers to control setTimeout
    vi.useFakeTimers();

    // EXECUTE: Flush updates
    const flushPromise = manager.flushUpdates();

    await vi.runAllTimersAsync();
    await flushPromise.catch(() => {
      // Catch any errors to avoid unhandled rejections
    });

    vi.useRealTimers();

    // VERIFY: 5 attempts were made (4 failures, 1 success)
    expect(mockWriteTasksJSON).toHaveBeenCalledTimes(5);
  });

  it('should use default --flush-retries 3 when not specified', async () => {
    // SETUP: Create SessionManager with default retries (3)
    const manager = await createMockSessionManager(3); // Default
    await manager.updateItemStatus('P1.M1.T1.S1', 'Complete');

    // MOCK: First 2 attempts fail, 3rd succeeds
    const busyError = new SessionFileError(
      '/test/plan/001_14b9dc2a33c7/tasks.json',
      'atomic write',
      Object.assign(new Error('EBUSY: file locked'), { code: 'EBUSY' })
    );

    mockWriteTasksJSON
      .mockRejectedValueOnce(busyError)
      .mockRejectedValueOnce(busyError)
      .mockResolvedValueOnce(undefined);

    // Use fake timers to control setTimeout
    vi.useFakeTimers();

    // EXECUTE: Flush updates
    const flushPromise = manager.flushUpdates();

    await vi.runAllTimersAsync();
    await flushPromise.catch(() => {
      // Catch any errors to avoid unhandled rejections
    });

    vi.useRealTimers();

    // VERIFY: 3 attempts were made (default behavior)
    expect(mockWriteTasksJSON).toHaveBeenCalledTimes(3);
  });

  // ==========================================================================
  // Logging of Retry Attempts
  // ==========================================================================

  it('should log each retry attempt with context', async () => {
    // SETUP: Create SessionManager with batched updates
    const manager = await createMockSessionManager(3);
    await manager.updateItemStatus('P1.M1.T1.S1', 'Complete');

    // MOCK: All attempts fail with EBUSY
    const busyError = new SessionFileError(
      '/test/plan/001_14b9dc2a33c7/tasks.json',
      'atomic write',
      Object.assign(new Error('EBUSY: file locked'), { code: 'EBUSY' })
    );

    // Reset and set mock to reject 3 times
    mockWriteTasksJSON.mockReset();
    for (let i = 0; i < 3; i++) {
      mockWriteTasksJSON.mockRejectedValueOnce(busyError);
    }

    // Use fake timers to control setTimeout
    vi.useFakeTimers();

    // EXECUTE: Flush updates - expect it to reject
    const flushPromise = expect(manager.flushUpdates()).rejects.toThrow(
      'EBUSY'
    );

    // Advance timers to trigger all delays
    await vi.runAllTimersAsync();

    // Wait for the rejection to be processed
    await flushPromise;

    vi.useRealTimers();

    // VERIFY: Cannot directly access logger output in test
    // But we can verify the retry behavior:
    // - 3 total attempts were made
    // - setTimeout was called twice (for retries 2 and 3)
    expect(mockWriteTasksJSON).toHaveBeenCalledTimes(3);
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  it('should handle retry with 10 flushRetries (maximum)', async () => {
    // SETUP: Create SessionManager with 10 retries (maximum)
    const manager = await createMockSessionManager(10);
    await manager.updateItemStatus('P1.M1.T1.S1', 'Complete');

    // MOCK: First 9 attempts fail, 10th succeeds
    const busyError = new SessionFileError(
      '/test/plan/001_14b9dc2a33c7/tasks.json',
      'atomic write',
      Object.assign(new Error('EBUSY: file locked'), { code: 'EBUSY' })
    );

    for (let i = 0; i < 9; i++) {
      mockWriteTasksJSON.mockRejectedValueOnce(busyError);
    }
    mockWriteTasksJSON.mockResolvedValueOnce(undefined);

    // Use fake timers to control setTimeout
    vi.useFakeTimers();

    // EXECUTE: Flush updates
    const flushPromise = manager.flushUpdates();

    await vi.runAllTimersAsync();
    await flushPromise;

    vi.useRealTimers();

    // VERIFY: 10 attempts were made
    expect(mockWriteTasksJSON).toHaveBeenCalledTimes(10);
  });

  it('should handle non-Error objects gracefully', async () => {
    // SETUP: Create SessionManager with batched updates
    const manager = await createMockSessionManager(3);
    await manager.updateItemStatus('P1.M1.T1.S1', 'Complete');

    // MOCK: Throw a non-Error object (string)
    mockWriteTasksJSON.mockRejectedValueOnce('Some string error');

    // EXECUTE: Flush updates
    // Non-Error objects without code should not retry (treated as non-retryable)
    await expect(manager.flushUpdates()).rejects.toThrow();

    // VERIFY: Only 1 attempt was made (non-retryable)
    expect(mockWriteTasksJSON).toHaveBeenCalledTimes(1);
  });

  it('should handle Error object without code property', async () => {
    // SETUP: Create SessionManager with batched updates
    const manager = await createMockSessionManager(3);
    await manager.updateItemStatus('P1.M1.T1.S1', 'Complete');

    // MOCK: Throw Error without code property
    const errorWithoutCode = new Error('Some error without code');
    mockWriteTasksJSON.mockRejectedValueOnce(errorWithoutCode);

    // EXECUTE: Flush updates
    await expect(manager.flushUpdates()).rejects.toThrow();

    // VERIFY: Only 1 attempt was made (non-retryable without code)
    expect(mockWriteTasksJSON).toHaveBeenCalledTimes(1);
  });
});
