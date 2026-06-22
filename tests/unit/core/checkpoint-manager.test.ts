/**
 * Unit tests for CheckpointManager class
 *
 * @remarks
 * Tests validate CheckpointManager class from src/core/checkpoint-manager.ts with comprehensive coverage.
 * Tests follow the Setup/Execute/Verify pattern with comprehensive edge case coverage.
 *
 * Mocks are used for all file system, crypto, and session-utils operations - no real I/O is performed.
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { CheckpointManager } from '../../../src/core/checkpoint-manager.js';
import type {
  CheckpointData,
  CheckpointExecutionState,
  ValidationGateResult,
} from '../../../src/core/checkpoint-manager.js';

// Mock the node:fs/promises module
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));

// Mock the node:fs module for synchronous operations
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
}));

// Mock the session-utils module
vi.mock('../../../src/core/session-utils.js', () => ({
  atomicWrite: vi.fn(),
}));

// Mock the node:crypto module
vi.mock('node:crypto', () => ({
  randomBytes: vi.fn(() => Buffer.from('a1b2c3d4', 'hex')),
  randomUUID: vi.fn(() => 'test-uuid-checkpoint'),
}));

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { atomicWrite } from '../../../src/core/session-utils.js';
import { randomBytes } from 'node:crypto';

// Helper function to create a test execution state
function createTestExecutionState(
  stage: CheckpointExecutionState['stage'] = 'pre-execution'
): CheckpointExecutionState {
  return {
    prpPath: '/path/to/prp.md',
    stage,
    validationResults: [],
    timestamp: new Date('2024-01-12T10:00:00Z'),
  };
}

// Helper function to create a test checkpoint file
function createTestCheckpointFile(
  taskId: string,
  checkpoints: CheckpointData[] = []
): string {
  return JSON.stringify(
    {
      version: '1.0',
      checkpoints,
      lastModified: new Date('2024-01-12T10:00:00Z'),
    },
    null,
    2
  );
}

// Helper function to create a test checkpoint data
function createTestCheckpointData(
  taskId: string,
  stage: CheckpointExecutionState['stage'] = 'pre-execution',
  label: string = 'Test checkpoint',
  createdAt: Date = new Date('2024-01-12T10:00:00Z')
): CheckpointData {
  return {
    id: `${taskId}_1705056000000_${stage}_a1b2c3d4`,
    taskId,
    label,
    state: createTestExecutionState(stage),
    createdAt,
  };
}

describe('CheckpointManager', () => {
  const sessionPath = '/test/session/path';
  const taskId = 'P1.M1.T1.S1';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create instance with default config', () => {
      const manager = new CheckpointManager(sessionPath);

      expect(manager.sessionPath).toBe(sessionPath);
    });

    it('should create instance with custom config', () => {
      const manager = new CheckpointManager(sessionPath, {
        maxCheckpoints: 10,
        enabled: false,
        autoCleanup: false,
      });

      expect(manager.sessionPath).toBe(sessionPath);
    });

    it('should merge partial config with defaults', () => {
      const manager = new CheckpointManager(sessionPath, {
        maxCheckpoints: 15,
      });

      expect(manager.sessionPath).toBe(sessionPath);
    });
  });

  describe('saveCheckpoint', () => {
    it('should save checkpoint when enabled', async () => {
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(atomicWrite).mockResolvedValue();
      vi.mocked(mkdir).mockResolvedValue();

      const manager = new CheckpointManager(sessionPath);
      const state = createTestExecutionState();

      const id = await manager.saveCheckpoint(taskId, 'Test checkpoint', state);

      expect(id).toBeTruthy();
      expect(id).toContain(taskId);
      expect(mkdir).toHaveBeenCalledOnce();
      expect(atomicWrite).toHaveBeenCalledOnce();
    });

    it('should return empty string when disabled', async () => {
      const manager = new CheckpointManager(sessionPath, { enabled: false });
      const state = createTestExecutionState();

      const id = await manager.saveCheckpoint(taskId, 'Test checkpoint', state);

      expect(id).toBe('');
      expect(atomicWrite).not.toHaveBeenCalled();
    });

    it('should load existing checkpoint file when exists', async () => {
      const existingCheckpoint = createTestCheckpointData(taskId);
      const existingFile = createTestCheckpointFile(taskId, [
        existingCheckpoint,
      ]);

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFile).mockResolvedValue(existingFile);
      vi.mocked(atomicWrite).mockResolvedValue();

      const manager = new CheckpointManager(sessionPath);
      const state = createTestExecutionState('coder-response');

      await manager.saveCheckpoint(taskId, 'New checkpoint', state);

      expect(readFile).toHaveBeenCalledOnce();
      expect(atomicWrite).toHaveBeenCalledOnce();
    });

    it('should auto-cleanup old checkpoints when enabled', async () => {
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(atomicWrite).mockResolvedValue();
      vi.mocked(mkdir).mockResolvedValue();

      const manager = new CheckpointManager(sessionPath, {
        maxCheckpoints: 3,
        autoCleanup: true,
      });

      // Create 5 checkpoints
      const stages: CheckpointExecutionState['stage'][] = [
        'pre-execution',
        'coder-response',
        'validation-gate-1',
        'validation-gate-2',
        'validation-gate-3',
      ];

      for (const stage of stages) {
        await manager.saveCheckpoint(
          taskId,
          `Checkpoint ${stage}`,
          createTestExecutionState(stage)
        );
      }

      // Should have called atomicWrite 5 times
      expect(atomicWrite).toHaveBeenCalledTimes(5);
    });

    it('should include error context when provided', async () => {
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(atomicWrite).mockResolvedValue();
      vi.mocked(mkdir).mockResolvedValue();

      const manager = new CheckpointManager(sessionPath);
      const state = createTestExecutionState();
      const error = new Error('Test error');
      (error as { code?: string }).code = 'TEST_ERROR';

      await manager.saveCheckpoint(taskId, 'Error checkpoint', state, error);

      expect(atomicWrite).toHaveBeenCalledOnce();
      const writtenData = vi.mocked(atomicWrite).mock.calls[0][1];
      const parsed = JSON.parse(writtenData);
      expect(parsed.checkpoints[0].error).toBeDefined();
      expect(parsed.checkpoints[0].error.message).toBe('Test error');
      expect(parsed.checkpoints[0].error.code).toBe('TEST_ERROR');
    });

    it('should generate unique checkpoint IDs', async () => {
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(atomicWrite).mockResolvedValue();
      vi.mocked(mkdir).mockResolvedValue();

      // Mock randomBytes to return different values on each call
      let callCount = 0;
      vi.mocked(randomBytes).mockImplementation(() => {
        const values = ['a1b2c3d4', 'b2c3d4e5', 'c3d4e5f6'];
        return Buffer.from(values[callCount++ % values.length], 'hex');
      });

      const manager = new CheckpointManager(sessionPath);
      const state = createTestExecutionState();

      const id1 = await manager.saveCheckpoint(taskId, 'Checkpoint 1', state);
      const id2 = await manager.saveCheckpoint(taskId, 'Checkpoint 2', state);

      expect(id1).not.toBe(id2);
    });
  });

  describe('restoreCheckpoint', () => {
    it('should restore checkpoint by ID', async () => {
      const checkpoint = createTestCheckpointData(taskId);
      const file = createTestCheckpointFile(taskId, [checkpoint]);

      vi.mocked(readFile).mockResolvedValue(file);

      const manager = new CheckpointManager(sessionPath);
      const restored = await manager.restoreCheckpoint(checkpoint.id);

      expect(restored.id).toBe(checkpoint.id);
      expect(restored.taskId).toBe(taskId);
      expect(restored.label).toBe(checkpoint.label);
      expect(restored.state.stage).toBe('pre-execution');
    });

    it('should throw error for invalid checkpoint ID', async () => {
      const manager = new CheckpointManager(sessionPath);

      await expect(manager.restoreCheckpoint('invalid-id')).rejects.toThrow(
        'Invalid checkpoint ID'
      );
    });

    it('should throw error when checkpoint not found', async () => {
      const checkpointId = `${taskId}_1705056000000_pre-execution_a1b2c3d4`;
      const file = createTestCheckpointFile(taskId, []);

      vi.mocked(readFile).mockResolvedValue(file);

      const manager = new CheckpointManager(sessionPath);

      await expect(manager.restoreCheckpoint(checkpointId)).rejects.toThrow(
        'Checkpoint not found'
      );
    });
  });

  describe('getLatestCheckpoint', () => {
    it('should return latest checkpoint when exists', async () => {
      const checkpoint1 = createTestCheckpointData(
        taskId,
        'pre-execution',
        'First'
      );
      const checkpoint2 = createTestCheckpointData(
        taskId,
        'coder-response',
        'Second'
      );
      const file = createTestCheckpointFile(taskId, [checkpoint1, checkpoint2]);

      vi.mocked(readFile).mockResolvedValue(file);

      const manager = new CheckpointManager(sessionPath);
      const latest = await manager.getLatestCheckpoint(taskId);

      expect(latest).not.toBeNull();
      expect(latest?.id).toBe(checkpoint2.id);
      expect(latest?.label).toBe('Second');
    });

    it('should return null when no checkpoints exist', async () => {
      const file = createTestCheckpointFile(taskId, []);

      vi.mocked(readFile).mockResolvedValue(file);

      const manager = new CheckpointManager(sessionPath);
      const latest = await manager.getLatestCheckpoint(taskId);

      expect(latest).toBeNull();
    });

    it('should return null when file not found', async () => {
      vi.mocked(readFile).mockRejectedValue(new Error('File not found'));

      const manager = new CheckpointManager(sessionPath);
      const latest = await manager.getLatestCheckpoint(taskId);

      expect(latest).toBeNull();
    });
  });

  describe('listCheckpoints', () => {
    it('should return all checkpoints sorted by time', async () => {
      const checkpoint1 = createTestCheckpointData(
        taskId,
        'pre-execution',
        'First',
        new Date('2024-01-12T10:00:00Z')
      );
      const checkpoint2 = createTestCheckpointData(
        taskId,
        'coder-response',
        'Second',
        new Date('2024-01-12T11:00:00Z')
      );
      const checkpoint3 = createTestCheckpointData(
        taskId,
        'validation-gate-1',
        'Third',
        new Date('2024-01-12T12:00:00Z')
      );

      // Add out of order
      const file = createTestCheckpointFile(taskId, [
        checkpoint3,
        checkpoint1,
        checkpoint2,
      ]);

      vi.mocked(readFile).mockResolvedValue(file);

      const manager = new CheckpointManager(sessionPath);
      const checkpoints = await manager.listCheckpoints(taskId);

      expect(checkpoints).toHaveLength(3);
      expect(checkpoints[0].id).toBe(checkpoint1.id);
      expect(checkpoints[1].id).toBe(checkpoint2.id);
      expect(checkpoints[2].id).toBe(checkpoint3.id);
    });

    it('should return empty array when no checkpoints exist', async () => {
      const file = createTestCheckpointFile(taskId, []);

      vi.mocked(readFile).mockResolvedValue(file);

      const manager = new CheckpointManager(sessionPath);
      const checkpoints = await manager.listCheckpoints(taskId);

      expect(checkpoints).toEqual([]);
    });

    it('should return empty array when file not found', async () => {
      vi.mocked(readFile).mockRejectedValue(new Error('File not found'));

      const manager = new CheckpointManager(sessionPath);
      const checkpoints = await manager.listCheckpoints(taskId);

      expect(checkpoints).toEqual([]);
    });
  });

  describe('cleanup', () => {
    it('should cleanup old checkpoints respecting maxCheckpoints', async () => {
      const checkpoints = [
        createTestCheckpointData(taskId, 'pre-execution', 'First'),
        createTestCheckpointData(taskId, 'coder-response', 'Second'),
        createTestCheckpointData(taskId, 'validation-gate-1', 'Third'),
        createTestCheckpointData(taskId, 'validation-gate-2', 'Fourth'),
        createTestCheckpointData(taskId, 'validation-gate-3', 'Fifth'),
      ];

      const file = createTestCheckpointFile(taskId, checkpoints);
      vi.mocked(readFile).mockResolvedValue(file);
      vi.mocked(atomicWrite).mockResolvedValue();
      vi.mocked(existsSync).mockReturnValue(true);

      const manager = new CheckpointManager(sessionPath, {
        maxCheckpoints: 3,
      });

      await manager.cleanup(taskId);

      expect(atomicWrite).toHaveBeenCalledOnce();
      const writtenData = vi.mocked(atomicWrite).mock.calls[0][1];
      const parsed = JSON.parse(writtenData);
      expect(parsed.checkpoints).toHaveLength(3);
      // Should keep last 3 checkpoints
      expect(parsed.checkpoints[0].label).toBe('Third');
      expect(parsed.checkpoints[1].label).toBe('Fourth');
      expect(parsed.checkpoints[2].label).toBe('Fifth');
    });

    it('should not cleanup when under limit', async () => {
      const checkpoints = [
        createTestCheckpointData(taskId, 'pre-execution', 'First'),
        createTestCheckpointData(taskId, 'coder-response', 'Second'),
      ];

      const file = createTestCheckpointFile(taskId, checkpoints);
      vi.mocked(readFile).mockResolvedValue(file);
      vi.mocked(existsSync).mockReturnValue(true);

      const manager = new CheckpointManager(sessionPath, {
        maxCheckpoints: 5,
      });

      await manager.cleanup(taskId);

      expect(atomicWrite).not.toHaveBeenCalled();
    });

    it('should use custom retain count when provided', async () => {
      const checkpoints = [
        createTestCheckpointData(taskId, 'pre-execution', 'First'),
        createTestCheckpointData(taskId, 'coder-response', 'Second'),
        createTestCheckpointData(taskId, 'validation-gate-1', 'Third'),
      ];

      const file = createTestCheckpointFile(taskId, checkpoints);
      vi.mocked(readFile).mockResolvedValue(file);
      vi.mocked(atomicWrite).mockResolvedValue();
      vi.mocked(existsSync).mockReturnValue(true);

      const manager = new CheckpointManager(sessionPath);

      await manager.cleanup(taskId, 2);

      expect(atomicWrite).toHaveBeenCalledOnce();
      const writtenData = vi.mocked(atomicWrite).mock.calls[0][1];
      const parsed = JSON.parse(writtenData);
      expect(parsed.checkpoints).toHaveLength(2);
    });
  });

  describe('deleteCheckpoint', () => {
    it('should delete specific checkpoint', async () => {
      const checkpoint1 = createTestCheckpointData(
        taskId,
        'pre-execution',
        'First'
      );
      const checkpoint2 = createTestCheckpointData(
        taskId,
        'coder-response',
        'Second'
      );
      const file = createTestCheckpointFile(taskId, [checkpoint1, checkpoint2]);

      vi.mocked(readFile).mockResolvedValue(file);
      vi.mocked(atomicWrite).mockResolvedValue();

      const manager = new CheckpointManager(sessionPath);

      await manager.deleteCheckpoint(checkpoint1.id);

      expect(atomicWrite).toHaveBeenCalledOnce();
      const writtenData = vi.mocked(atomicWrite).mock.calls[0][1];
      const parsed = JSON.parse(writtenData);
      expect(parsed.checkpoints).toHaveLength(1);
      expect(parsed.checkpoints[0].id).toBe(checkpoint2.id);
    });

    it('should throw error for invalid checkpoint ID', async () => {
      const manager = new CheckpointManager(sessionPath);

      await expect(manager.deleteCheckpoint('invalid-id')).rejects.toThrow(
        'Invalid checkpoint ID'
      );
    });

    it('should throw error when checkpoint not found', async () => {
      // Use a different ID that doesn't exist in the file
      const checkpointId = `${taskId}_9999999999999_pre-execution_deadbeef`;
      const checkpoint1 = createTestCheckpointData(
        taskId,
        'pre-execution',
        'First'
      );
      const file = createTestCheckpointFile(taskId, [checkpoint1]);

      vi.mocked(readFile).mockResolvedValue(file);

      const manager = new CheckpointManager(sessionPath);

      await expect(manager.deleteCheckpoint(checkpointId)).rejects.toThrow(
        'Checkpoint not found'
      );
    });
  });

  describe('hasCheckpoint', () => {
    it('should return true when checkpoints exist', async () => {
      const checkpoint = createTestCheckpointData(taskId);
      const file = createTestCheckpointFile(taskId, [checkpoint]);

      vi.mocked(readFile).mockResolvedValue(file);

      const manager = new CheckpointManager(sessionPath);

      const hasCheck = await manager.hasCheckpoint(taskId);

      expect(hasCheck).toBe(true);
    });

    it('should return false when no checkpoints exist', async () => {
      const file = createTestCheckpointFile(taskId, []);

      vi.mocked(readFile).mockResolvedValue(file);

      const manager = new CheckpointManager(sessionPath);

      const hasCheck = await manager.hasCheckpoint(taskId);

      expect(hasCheck).toBe(false);
    });

    it('should return false when file not found', async () => {
      vi.mocked(readFile).mockRejectedValue(new Error('File not found'));

      const manager = new CheckpointManager(sessionPath);

      const hasCheck = await manager.hasCheckpoint(taskId);

      expect(hasCheck).toBe(false);
    });
  });

  describe('Zod validation', () => {
    it('should validate checkpoint data structure', async () => {
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(atomicWrite).mockResolvedValue();
      vi.mocked(mkdir).mockResolvedValue();

      const manager = new CheckpointManager(sessionPath);
      const state = createTestExecutionState();

      // Should not throw - valid data
      await expect(
        manager.saveCheckpoint(taskId, 'Valid checkpoint', state)
      ).resolves.toBeTruthy();
    });

    it('should handle invalid stage gracefully', async () => {
      const manager = new CheckpointManager(sessionPath);

      // Invalid stage should be caught by Zod
      const invalidState = {
        ...createTestExecutionState(),
        stage: 'invalid-stage' as CheckpointExecutionState['stage'],
      };

      // Zod should catch this during parse
      await expect(
        manager.saveCheckpoint(taskId, 'Invalid checkpoint', invalidState)
      ).rejects.toThrow();
    });
  });

  describe('checkpoint ID generation', () => {
    it('should generate unique IDs with correct format', async () => {
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(atomicWrite).mockResolvedValue();
      vi.mocked(mkdir).mockResolvedValue();

      const manager = new CheckpointManager(sessionPath);
      const state = createTestExecutionState();

      const id = await manager.saveCheckpoint(taskId, 'Test checkpoint', state);

      expect(id).toMatch(
        new RegExp(`^${taskId}_\\d+_pre-execution_[a-f0-9]{8}$`)
      );
    });
  });

  describe('checkpoint file path', () => {
    it('should use correct path format', async () => {
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(atomicWrite).mockResolvedValue();
      vi.mocked(mkdir).mockResolvedValue();

      const manager = new CheckpointManager(sessionPath);
      const state = createTestExecutionState();

      await manager.saveCheckpoint(taskId, 'Test checkpoint', state);

      const expectedPath = expect.stringContaining(
        `artifacts/${taskId}/checkpoints.json`
      );
      expect(atomicWrite).toHaveBeenCalledWith(
        expectedPath,
        expect.any(String)
      );
    });
  });

  describe('coder response and result', () => {
    it('should save checkpoint with coder response', async () => {
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(atomicWrite).mockResolvedValue();
      vi.mocked(mkdir).mockResolvedValue();

      const manager = new CheckpointManager(sessionPath);
      const state: CheckpointExecutionState = {
        prpPath: '/path/to/prp.md',
        stage: 'coder-response',
        coderResponse: 'Implementation complete',
        coderResult: {
          result: 'success',
          message: 'Code implemented successfully',
        },
        validationResults: [],
        timestamp: new Date('2024-01-12T10:00:00Z'),
      };

      await manager.saveCheckpoint(taskId, 'After coder', state);

      expect(atomicWrite).toHaveBeenCalledOnce();
      const writtenData = vi.mocked(atomicWrite).mock.calls[0][1];
      const parsed = JSON.parse(writtenData);
      expect(parsed.checkpoints[0].state.coderResponse).toBe(
        'Implementation complete'
      );
      expect(parsed.checkpoints[0].state.coderResult?.result).toBe('success');
    });
  });

  describe('validation results', () => {
    it('should save checkpoint with validation results', async () => {
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(atomicWrite).mockResolvedValue();
      vi.mocked(mkdir).mockResolvedValue();

      const manager = new CheckpointManager(sessionPath);
      const validationResults: ValidationGateResult[] = [
        {
          level: 1,
          description: 'Syntax check',
          success: true,
          command: 'npx tsc --noEmit',
          stdout: 'No errors',
          stderr: '',
          exitCode: 0,
          skipped: false,
        },
        {
          level: 2,
          description: 'Unit tests',
          success: true,
          command: 'vitest run',
          stdout: 'All tests passed',
          stderr: '',
          exitCode: 0,
          skipped: false,
        },
      ];

      const state: CheckpointExecutionState = {
        prpPath: '/path/to/prp.md',
        stage: 'validation-gate-2',
        validationResults,
        timestamp: new Date('2024-01-12T10:00:00Z'),
      };

      await manager.saveCheckpoint(taskId, 'After validation gate 2', state);

      expect(atomicWrite).toHaveBeenCalledOnce();
      const writtenData = vi.mocked(atomicWrite).mock.calls[0][1];
      const parsed = JSON.parse(writtenData);
      expect(parsed.checkpoints[0].state.validationResults).toHaveLength(2);
    });
  });

  describe('fix attempt tracking', () => {
    it('should save checkpoint with fix attempt number', async () => {
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(atomicWrite).mockResolvedValue();
      vi.mocked(mkdir).mockResolvedValue();

      const manager = new CheckpointManager(sessionPath);
      const state: CheckpointExecutionState = {
        prpPath: '/path/to/prp.md',
        stage: 'validation-gate-1',
        validationResults: [],
        fixAttempt: 2,
        timestamp: new Date('2024-01-12T10:00:00Z'),
      };

      await manager.saveCheckpoint(taskId, 'Fix attempt 2', state);

      expect(atomicWrite).toHaveBeenCalledOnce();
      const writtenData = vi.mocked(atomicWrite).mock.calls[0][1];
      const parsed = JSON.parse(writtenData);
      expect(parsed.checkpoints[0].state.fixAttempt).toBe(2);
    });
  });

  describe('concurrent operations', () => {
    it('should handle multiple concurrent saves', async () => {
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(atomicWrite).mockResolvedValue();
      vi.mocked(mkdir).mockResolvedValue();

      const manager = new CheckpointManager(sessionPath);
      const state = createTestExecutionState();

      const promises = Array.from({ length: 5 }, (_, i) =>
        manager.saveCheckpoint(taskId, `Concurrent ${i}`, state)
      );

      await expect(Promise.all(promises)).resolves.toHaveLength(5);
      expect(atomicWrite).toHaveBeenCalledTimes(5);
    });
  });

  describe('atomic write behavior', () => {
    it('should use atomic write for all checkpoint operations', async () => {
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(atomicWrite).mockResolvedValue();
      vi.mocked(mkdir).mockResolvedValue();

      const manager = new CheckpointManager(sessionPath);
      const state = createTestExecutionState();

      // Save checkpoint
      await manager.saveCheckpoint(taskId, 'Test', state);
      expect(atomicWrite).toHaveBeenCalledOnce();
    });
  });

  describe('disabled checkpoint creation', () => {
    it('should skip all operations when disabled', async () => {
      const manager = new CheckpointManager(sessionPath, { enabled: false });
      const state = createTestExecutionState();

      const id = await manager.saveCheckpoint(taskId, 'Test', state);

      expect(id).toBe('');
      expect(atomicWrite).not.toHaveBeenCalled();
    });
  });
});
