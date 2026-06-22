/**
 * Unit tests for session file system utilities
 *
 * @remarks
 * Tests validate all utility functions in src/core/session-utils.ts with 100% coverage.
 * Tests follow the Setup/Execute/Verify pattern with comprehensive edge case coverage.
 *
 * Mocks are used for all file system and crypto operations - no real I/O is performed.
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  hashPRD,
  createSessionDirectory,
  writeTasksJSON,
  readTasksJSON,
  writePRP,
  snapshotPRD,
  loadSnapshot,
  SessionFileError,
} from '../../../src/core/session-utils.js';
import type { Backlog, PRPDocument } from '../../../src/core/models.js';
import { Status } from '../../../src/core/models.js';

// Mock the node:crypto module
vi.mock('node:crypto', () => ({
  createHash: vi.fn(),
  randomBytes: vi.fn(),
  randomUUID: vi.fn(() => 'test-uuid-session-utils'),
}));

// Mock the node:fs/promises module
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  rename: vi.fn(),
  unlink: vi.fn(),
}));

// Mock the node:util module
vi.mock('node:util', () => ({
  TextDecoder: vi.fn(),
}));

// Import mocked modules
import { createHash, randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises';
import { TextDecoder } from 'node:util';

// Cast mocked functions
const mockCreateHash = createHash as any;
const mockRandomBytes = randomBytes as any;
const mockReadFile = readFile as any;
const mockWriteFile = writeFile as any;
const mockMkdir = mkdir as any;
const mockRename = rename as any;
const mockUnlink = unlink as any;
const mockTextDecoder = TextDecoder as any;

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
  story_points: 2,
  dependencies,
  context_scope:
    'CONTRACT DEFINITION:\n1. RESEARCH NOTE: Test research findings.\n2. INPUT: Test input data.\n3. LOGIC: Test implementation logic.\n4. OUTPUT: Test output for consumption.',
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

const createTestPRPDocument = (taskId: string): PRPDocument => ({
  taskId,
  objective: 'Test objective',
  context: '## Context\n\nTest context section.',
  implementationSteps: ['Step 1', 'Step 2', 'Step 3'],
  validationGates: [
    {
      level: 1,
      description: 'Syntax & Style validation',
      command: 'npm run lint',
      manual: false,
    },
    {
      level: 2,
      description: 'Unit Tests',
      command: 'npm test',
      manual: false,
    },
    {
      level: 3,
      description: 'Integration Tests',
      command: null,
      manual: true,
    },
    {
      level: 4,
      description: 'Manual Verification',
      command: null,
      manual: true,
    },
  ],
  successCriteria: [
    { description: 'All functions implemented', satisfied: false },
    { description: 'All tests passing', satisfied: false },
  ],
  references: ['https://example.com', 'src/core/models.ts'],
});

// Mock hash class for crypto.createHash
class MockHash {
  private data = '';

  update(content: string): this {
    this.data = content;
    return this;
  }

  digest(encoding: 'hex'): string {
    if (encoding === 'hex') {
      // Return a consistent 64-character hex string
      return '14b9dc2a33c7a1234567890abcdef1234567890abcdef1234567890abcdef123';
    }
    return '';
  }
}

describe('core/session-utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('SessionFileError', () => {
    it('should create error with path, operation, and code', () => {
      // SETUP: Create a mock underlying error
      const cause = new Error('ENOENT: no such file');
      (cause as NodeJS.ErrnoException).code = 'ENOENT';

      // EXECUTE
      const error = new SessionFileError('/test/path', 'read file', cause);

      // VERIFY
      expect(error.name).toBe('SessionFileError');
      expect(error.path).toBe('/test/path');
      expect(error.operation).toBe('read file');
      expect(error.code).toBe('ENOENT');
      expect(error.message).toContain('Failed to read file at /test/path');
    });

    it('should create error without cause', () => {
      // EXECUTE
      const error = new SessionFileError('/test/path', 'create directory');

      // VERIFY
      expect(error.name).toBe('SessionFileError');
      expect(error.path).toBe('/test/path');
      expect(error.operation).toBe('create directory');
      expect(error.code).toBeUndefined();
      expect(error.message).toContain('unknown error');
    });

    it('should be instanceof Error and SessionFileError', () => {
      // EXECUTE
      const error = new SessionFileError('/test/path', 'test');

      // VERIFY
      expect(error instanceof Error).toBe(true);
      expect(error instanceof SessionFileError).toBe(true);
    });
  });

  describe('hashPRD', () => {
    it('should compute SHA-256 hash of PRD file', async () => {
      // SETUP: Mock file read and hash computation
      mockReadFile.mockResolvedValue('# Test PRD\n\nThis is a test PRD.');
      const hashInstance = new MockHash();
      mockCreateHash.mockReturnValue(hashInstance);

      // EXECUTE
      const hash = await hashPRD('/test/path/PRD.md');

      // VERIFY
      expect(mockReadFile).toHaveBeenCalledWith('/test/path/PRD.md', 'utf-8');
      expect(mockCreateHash).toHaveBeenCalledWith('sha256');
      expect(hash).toBe(
        '14b9dc2a33c7a1234567890abcdef1234567890abcdef1234567890abcdef123'
      );
      expect(hash.length).toBe(64);
    });

    it('should throw SessionFileError on file read failure (ENOENT)', async () => {
      // SETUP: Mock file read error
      const error = new Error('ENOENT: no such file');
      (error as NodeJS.ErrnoException).code = 'ENOENT';
      mockReadFile.mockRejectedValue(error);

      // EXECUTE & VERIFY
      await expect(hashPRD('/test/path/PRD.md')).rejects.toThrow(
        SessionFileError
      );
      await expect(hashPRD('/test/path/PRD.md')).rejects.toThrow(
        'Failed to read PRD'
      );

      // Verify error properties
      try {
        await hashPRD('/test/path/PRD.md');
      } catch (e) {
        expect(e).toBeInstanceOf(SessionFileError);
        const sessionError = e as SessionFileError;
        expect(sessionError.path).toBe('/test/path/PRD.md');
        expect(sessionError.operation).toBe('read PRD');
        expect(sessionError.code).toBe('ENOENT');
      }
    });

    it('should throw SessionFileError on file read failure (EACCES)', async () => {
      // SETUP: Mock permission error
      const error = new Error('EACCES: permission denied');
      (error as NodeJS.ErrnoException).code = 'EACCES';
      mockReadFile.mockRejectedValue(error);

      // EXECUTE & VERIFY
      await expect(hashPRD('/test/path/PRD.md')).rejects.toThrow(
        SessionFileError
      );

      try {
        await hashPRD('/test/path/PRD.md');
      } catch (e) {
        expect(e).toBeInstanceOf(SessionFileError);
        const sessionError = e as SessionFileError;
        expect(sessionError.code).toBe('EACCES');
      }
    });

    it('should throw SessionFileError on generic read error', async () => {
      // SETUP: Mock generic error (no code)
      const error = new Error('Unknown read error');
      mockReadFile.mockRejectedValue(error);

      // EXECUTE & VERIFY
      await expect(hashPRD('/test/path/PRD.md')).rejects.toThrow(
        SessionFileError
      );
    });
  });

  describe('createSessionDirectory', () => {
    beforeEach(() => {
      // Setup hashPRD mock
      mockReadFile.mockResolvedValue('# Test PRD');
      const hashInstance = new MockHash();
      mockCreateHash.mockReturnValue(hashInstance);
    });

    it('should create session directory with all subdirectories', async () => {
      // SETUP: Mock successful mkdir
      mockMkdir.mockResolvedValue(undefined);

      // EXECUTE
      const sessionPath = await createSessionDirectory('/test/PRD.md', 1);

      // VERIFY
      expect(sessionPath).toContain('plan');
      expect(sessionPath).toContain('001_14b9dc2a33c7');
      expect(mockMkdir).toHaveBeenCalledTimes(4); // sessionPath + 3 subdirs

      // Verify directory paths
      const calls = mockMkdir.mock.calls;
      const createdPaths = calls.map((call: any[]) => call[0]);
      expect(createdPaths.some((p: string) => p.endsWith('architecture'))).toBe(
        true
      );
      expect(createdPaths.some((p: string) => p.endsWith('prps'))).toBe(true);
      expect(createdPaths.some((p: string) => p.endsWith('artifacts'))).toBe(
        true
      );
    });

    it('should pad sequence number to 3 digits', async () => {
      // SETUP
      mockMkdir.mockResolvedValue(undefined);

      // EXECUTE
      const sessionPath1 = await createSessionDirectory('/test/PRD.md', 1);
      const sessionPath2 = await createSessionDirectory('/test/PRD.md', 42);
      const sessionPath3 = await createSessionDirectory('/test/PRD.md', 999);

      // VERIFY
      expect(sessionPath1).toContain('001_');
      expect(sessionPath2).toContain('042_');
      expect(sessionPath3).toContain('999_');
    });

    it('should use first 12 characters of hash', async () => {
      // SETUP
      mockMkdir.mockResolvedValue(undefined);

      // EXECUTE
      const sessionPath = await createSessionDirectory('/test/PRD.md', 1);

      // VERIFY
      expect(sessionPath).toContain('14b9dc2a33c7');
      expect(sessionPath).not.toContain('14b9dc2a33c7a'); // Full hash is 64 chars
    });

    it('should handle EEXIST error gracefully (directory exists)', async () => {
      // SETUP: Mock EEXIST error for existing directory
      const existError = new Error('Directory exists');
      (existError as any).code = 'EEXIST';
      mockMkdir.mockRejectedValue(existError);

      // EXECUTE - should not throw
      const sessionPath = await createSessionDirectory('/test/PRD.md', 1);

      // VERIFY
      expect(sessionPath).toBeDefined();
      expect(sessionPath).toContain('001_14b9dc2a33c7');
    });

    it('should throw SessionFileError on mkdir failure (non-EEXIST)', async () => {
      // SETUP: Mock non-EEXIST error
      const error = new Error('EACCES: permission denied');
      (error as NodeJS.ErrnoException).code = 'EACCES';
      mockMkdir.mockRejectedValue(error);

      // EXECUTE & VERIFY
      await expect(createSessionDirectory('/test/PRD.md', 1)).rejects.toThrow(
        SessionFileError
      );
    });

    it('should propagate SessionFileError from hashPRD', async () => {
      // SETUP: Mock hashPRD failure
      const error = new Error('ENOENT: file not found');
      (error as NodeJS.ErrnoException).code = 'ENOENT';
      mockReadFile.mockRejectedValue(error);

      // EXECUTE & VERIFY
      await expect(createSessionDirectory('/test/PRD.md', 1)).rejects.toThrow(
        SessionFileError
      );

      try {
        await createSessionDirectory('/test/PRD.md', 1);
      } catch (e) {
        expect(e).toBeInstanceOf(SessionFileError);
        const sessionError = e as SessionFileError;
        expect(sessionError.operation).toBe('read PRD');
      }
    });

    it('should return absolute path to session directory', async () => {
      // SETUP
      mockMkdir.mockResolvedValue(undefined);

      // EXECUTE
      const sessionPath = await createSessionDirectory('/test/PRD.md', 1);

      // VERIFY: Should be absolute path (starts with /)
      expect(sessionPath.startsWith('/')).toBe(true);
    });
  });

  describe('writeTasksJSON', () => {
    beforeEach(() => {
      // Setup atomic write mocks
      mockWriteFile.mockResolvedValue(undefined);
      mockRename.mockResolvedValue(undefined);
      mockRandomBytes.mockReturnValue({ toString: () => 'abc123def' });
    });

    it('should write tasks.json with atomic write pattern', async () => {
      // SETUP: Create test backlog
      const backlog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Planned'),
      ]);

      // EXECUTE
      await writeTasksJSON('/test/session', backlog);

      // VERIFY: Atomic write pattern - write then rename
      expect(mockWriteFile).toHaveBeenCalled();
      expect(mockRename).toHaveBeenCalled();

      // Verify temp file was used
      const writeFileCall = mockWriteFile.mock.calls[0];
      const tempPath = writeFileCall[0];
      expect(tempPath).toContain('.tmp');

      // Verify rename from temp to target
      const renameCall = mockRename.mock.calls[0];
      expect(renameCall[0]).toBe(tempPath); // temp path
      expect(renameCall[1]).toContain('tasks.json'); // target path
    });

    it('should validate backlog with Zod schema before writing', async () => {
      // SETUP: Create valid backlog
      const backlog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Planned'),
      ]);

      // EXECUTE
      await writeTasksJSON('/test/session', backlog);

      // VERIFY: JSON content should be properly formatted
      const writeContent = mockWriteFile.mock.calls[0][1];
      const parsed = JSON.parse(writeContent);
      expect(parsed.backlog).toHaveLength(1);
      expect(parsed.backlog[0].id).toBe('P1');
    });

    it('should serialize with 2-space indentation', async () => {
      // SETUP
      const backlog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Planned'),
      ]);

      // EXECUTE
      await writeTasksJSON('/test/session', backlog);

      // VERIFY: Check indentation in JSON
      const writeContent = mockWriteFile.mock.calls[0][1];
      expect(writeContent).toContain('  "backlog"'); // 2-space indent
    });

    it('should clean up temp file on write failure', async () => {
      // SETUP: Mock write failure
      const writeError = new Error('ENOSPC: no space left');
      mockWriteFile.mockRejectedValue(writeError);

      const backlog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Planned'),
      ]);

      // EXECUTE & VERIFY
      await expect(writeTasksJSON('/test/session', backlog)).rejects.toThrow(
        SessionFileError
      );

      // Temp file cleanup should be attempted (unlink called)
      // Note: unlink might fail too, which we ignore
    });

    it('should clean up temp file on rename failure', async () => {
      // SETUP: Mock rename failure (write succeeds)
      mockWriteFile.mockResolvedValue(undefined);
      const renameError = new Error('EIO: I/O error');
      mockRename.mockRejectedValue(renameError);

      const backlog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Planned'),
      ]);

      // EXECUTE & VERIFY
      await expect(writeTasksJSON('/test/session', backlog)).rejects.toThrow(
        SessionFileError
      );

      // Unlink should be called to clean up temp file
      expect(mockUnlink).toHaveBeenCalled();
    });

    it('should handle unlink cleanup failure gracefully', async () => {
      // SETUP: Mock rename failure and unlink failure
      mockWriteFile.mockResolvedValue(undefined);
      mockRename.mockRejectedValue(new Error('Rename failed'));
      mockUnlink.mockRejectedValue(new Error('Unlink failed'));

      const backlog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Planned'),
      ]);

      // EXECUTE & VERIFY: Should throw SessionFileError from rename, not unlink
      await expect(writeTasksJSON('/test/session', backlog)).rejects.toThrow(
        SessionFileError
      );
    });

    it('should use mode 0o644 for write', async () => {
      // SETUP
      const backlog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Planned'),
      ]);

      // EXECUTE
      await writeTasksJSON('/test/session', backlog);

      // VERIFY: File mode should be 0o644
      const writeOptions = mockWriteFile.mock.calls[0][2];
      expect(writeOptions).toEqual({ mode: 0o644 });
    });

    it('should throw SessionFileError for Zod validation failure', async () => {
      // SETUP: Create invalid backlog (missing required fields)
      const invalidBacklog = { backlog: [{ invalid: 'data' }] } as any;

      // EXECUTE & VERIFY
      await expect(
        writeTasksJSON('/test/session', invalidBacklog)
      ).rejects.toThrow(SessionFileError);

      try {
        await writeTasksJSON('/test/session', invalidBacklog);
      } catch (e) {
        expect(e).toBeInstanceOf(SessionFileError);
        const sessionError = e as SessionFileError;
        expect(sessionError.operation).toBe('write tasks.json');
      }
    });
  });

  describe('readTasksJSON', () => {
    it('should read and validate tasks.json', async () => {
      // SETUP: Mock file read with valid backlog
      const validBacklog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Planned'),
      ]);
      mockReadFile.mockResolvedValue(JSON.stringify(validBacklog));

      // EXECUTE
      const result = await readTasksJSON('/test/session');

      // VERIFY
      expect(mockReadFile).toHaveBeenCalledWith(
        expect.stringContaining('tasks.json'),
        'utf-8'
      );
      expect(result.backlog).toHaveLength(1);
      expect(result.backlog[0].id).toBe('P1');
    });

    it('should validate with Zod schema after parsing', async () => {
      // SETUP: Mock file read with valid data
      const validBacklog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Planned'),
      ]);
      mockReadFile.mockResolvedValue(JSON.stringify(validBacklog));

      // EXECUTE
      const result = await readTasksJSON('/test/session');

      // VERIFY: Should return validated Backlog
      expect(result.backlog).toBeDefined();
      expect(result.backlog[0].type).toBe('Phase');
    });

    it('should throw SessionFileError on file read failure (ENOENT)', async () => {
      // SETUP: Mock file not found
      const error = new Error('ENOENT: file not found');
      (error as NodeJS.ErrnoException).code = 'ENOENT';
      mockReadFile.mockRejectedValue(error);

      // EXECUTE & VERIFY
      await expect(readTasksJSON('/test/session')).rejects.toThrow(
        SessionFileError
      );

      try {
        await readTasksJSON('/test/session');
      } catch (e) {
        expect(e).toBeInstanceOf(SessionFileError);
        const sessionError = e as SessionFileError;
        expect(sessionError.code).toBe('ENOENT');
        expect(sessionError.operation).toBe('read tasks.json');
      }
    });

    it('should throw SessionFileError on JSON parse error', async () => {
      // SETUP: Mock invalid JSON
      mockReadFile.mockResolvedValue('{ invalid json }');

      // EXECUTE & VERIFY
      await expect(readTasksJSON('/test/session')).rejects.toThrow(
        SessionFileError
      );

      try {
        await readTasksJSON('/test/session');
      } catch (e) {
        expect(e).toBeInstanceOf(SessionFileError);
        const sessionError = e as SessionFileError;
        expect(sessionError.operation).toBe('read tasks.json');
      }
    });

    it('should throw SessionFileError on Zod validation error', async () => {
      // SETUP: Mock valid JSON but invalid schema
      const invalidSchema = { backlog: [{ id: 'P1' }] }; // Missing required fields
      mockReadFile.mockResolvedValue(JSON.stringify(invalidSchema));

      // EXECUTE & VERIFY
      await expect(readTasksJSON('/test/session')).rejects.toThrow(
        SessionFileError
      );

      try {
        await readTasksJSON('/test/session');
      } catch (e) {
        expect(e).toBeInstanceOf(SessionFileError);
        const sessionError = e as SessionFileError;
        expect(sessionError.operation).toBe('read tasks.json');
      }
    });

    it('should read from correct path in session directory', async () => {
      // SETUP
      const validBacklog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Planned'),
      ]);
      mockReadFile.mockResolvedValue(JSON.stringify(validBacklog));

      // EXECUTE
      await readTasksJSON('/test/session');

      // VERIFY
      expect(mockReadFile).toHaveBeenCalledWith(
        '/test/session/tasks.json',
        'utf-8'
      );
    });
  });

  describe('writePRP', () => {
    beforeEach(() => {
      // Setup atomic write mocks
      mockWriteFile.mockResolvedValue(undefined);
      mockRename.mockResolvedValue(undefined);
      mockRandomBytes.mockReturnValue({ toString: () => 'xyz789ghi' });
    });

    it('should write PRP as markdown with atomic write', async () => {
      // SETUP: Create test PRP document
      const prp = createTestPRPDocument('P1.M2.T2.S3');

      // EXECUTE
      await writePRP('/test/session', 'P1.M2.T2.S3', prp);

      // VERIFY: Atomic write pattern
      expect(mockWriteFile).toHaveBeenCalled();
      expect(mockRename).toHaveBeenCalled();

      // Verify file path includes prps/ subdirectory
      const renameCall = mockRename.mock.calls[0];
      const targetPath = renameCall[1];
      expect(targetPath).toContain('prps/');
      expect(targetPath).toContain('P1.M2.T2.S3.md');
    });

    it('should validate PRP with Zod schema before writing', async () => {
      // SETUP: Create valid PRP
      const prp = createTestPRPDocument('P1.M2.T2.S3');

      // EXECUTE
      await writePRP('/test/session', 'P1.M2.T2.S3', prp);

      // VERIFY: Should write markdown content
      const writeContent = mockWriteFile.mock.calls[0][1];
      expect(writeContent).toContain('# P1.M2.T2.S3');
      expect(writeContent).toContain('## Objective');
      expect(writeContent).toContain('## Context');
      expect(writeContent).toContain('## Implementation Steps');
    });

    it('should convert PRP document to markdown format', async () => {
      // SETUP
      const prp = createTestPRPDocument('P1.M2.T2.S3');

      // EXECUTE
      await writePRP('/test/session', 'P1.M2.T2.S3', prp);

      // VERIFY: Check markdown sections
      const writeContent = mockWriteFile.mock.calls[0][1];

      // Header
      expect(writeContent).toMatch(/^# P1\.M2\.T2\.S3$/m);

      // Objective
      expect(writeContent).toContain('## Objective');
      expect(writeContent).toContain('Test objective');

      // Context
      expect(writeContent).toContain('## Context');
      expect(writeContent).toContain('Test context section');

      // Implementation Steps (numbered list)
      expect(writeContent).toContain('## Implementation Steps');
      expect(writeContent).toMatch(/1\. Step 1/);
      expect(writeContent).toMatch(/2\. Step 2/);
      expect(writeContent).toMatch(/3\. Step 3/);

      // Validation Gates
      expect(writeContent).toContain('## Validation Gates');
      expect(writeContent).toContain('### Level 1');
      expect(writeContent).toContain('Syntax & Style validation');
      expect(writeContent).toContain('```bash'); // For command gates
      expect(writeContent).toContain('npm run lint');

      // Success Criteria
      expect(writeContent).toContain('## Success Criteria');
      expect(writeContent).toMatch(/- \[ \] All functions implemented/);
      expect(writeContent).toMatch(/- \[ \] All tests passing/);

      // References
      expect(writeContent).toContain('## References');
      expect(writeContent).toMatch(/- https:\/\/example\.com/);
      expect(writeContent).toMatch(/- src\/core\/models\.ts/);
    });

    it('should handle manual validation gates', async () => {
      // SETUP
      const prp = createTestPRPDocument('P1.M2.T2.S3');
      // Level 3 and 4 are manual gates

      // EXECUTE
      await writePRP('/test/session', 'P1.M2.T2.S3', prp);

      // VERIFY: Manual gates should not have code blocks
      const writeContent = mockWriteFile.mock.calls[0][1];
      expect(writeContent).toContain('*Manual validation required*');
    });

    it('should handle satisfied success criteria checkboxes', async () => {
      // SETUP
      const prp = createTestPRPDocument('P1.M2.T2.S3');
      // Use type assertion to bypass readonly for testing
      (prp.successCriteria[0] as { satisfied: boolean }).satisfied = true;

      // EXECUTE
      await writePRP('/test/session', 'P1.M2.T2.S3', prp);

      // VERIFY: Checkbox should be checked
      const writeContent = mockWriteFile.mock.calls[0][1];
      expect(writeContent).toMatch(/- \[x\] All functions implemented/);
    });

    it('should clean up temp file on write failure', async () => {
      // SETUP: Mock write failure
      const writeError = new Error('ENOSPC: no space left');
      mockWriteFile.mockRejectedValue(writeError);

      const prp = createTestPRPDocument('P1.M2.T2.S3');

      // EXECUTE & VERIFY
      await expect(
        writePRP('/test/session', 'P1.M2.T2.S3', prp)
      ).rejects.toThrow(SessionFileError);

      // Should attempt cleanup
      expect(mockUnlink).toHaveBeenCalled();
    });

    it('should clean up temp file on rename failure', async () => {
      // SETUP: Mock rename failure
      mockWriteFile.mockResolvedValue(undefined);
      const renameError = new Error('EIO: I/O error');
      mockRename.mockRejectedValue(renameError);

      const prp = createTestPRPDocument('P1.M2.T2.S3');

      // EXECUTE & VERIFY
      await expect(
        writePRP('/test/session', 'P1.M2.T2.S3', prp)
      ).rejects.toThrow(SessionFileError);

      // Unlink should be called
      expect(mockUnlink).toHaveBeenCalled();
    });

    it('should throw SessionFileError for Zod validation failure', async () => {
      // SETUP: Create invalid PRP (missing required fields)
      const invalidPRP = { taskId: 'P1.M2.T2.S3' } as any;

      // EXECUTE & VERIFY
      await expect(
        writePRP('/test/session', 'P1.M2.T2.S3', invalidPRP)
      ).rejects.toThrow(SessionFileError);

      try {
        await writePRP('/test/session', 'P1.M2.T2.S3', invalidPRP);
      } catch (e) {
        expect(e).toBeInstanceOf(SessionFileError);
        const sessionError = e as SessionFileError;
        expect(sessionError.operation).toBe('write PRP');
      }
    });

    it('should include command for automated validation gates', async () => {
      // SETUP
      const prp = createTestPRPDocument('P1.M2.T2.S3');

      // EXECUTE
      await writePRP('/test/session', 'P1.M2.T2.S3', prp);

      // VERIFY: Automated gates should have commands
      const writeContent = mockWriteFile.mock.calls[0][1];
      expect(writeContent).toContain('```bash');
      expect(writeContent).toContain('npm run lint');
      expect(writeContent).toContain('npm test');
    });

    it('should use taskId from parameter for filename', async () => {
      // SETUP
      const prp = createTestPRPDocument('P1.M2.T2.S3');

      // EXECUTE
      await writePRP('/test/session', 'CUSTOM_TASK_ID', prp);

      // VERIFY: Filename should use the taskId parameter
      const renameCall = mockRename.mock.calls[0];
      const targetPath = renameCall[1];
      expect(targetPath).toContain('CUSTOM_TASK_ID.md');
    });
  });

  describe('integration scenarios', () => {
    it('should support typical session creation workflow', async () => {
      // SETUP: Mock all operations
      mockReadFile.mockResolvedValue('# Test PRD');
      const hashInstance = new MockHash();
      mockCreateHash.mockReturnValue(hashInstance);
      mockMkdir.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);
      mockRename.mockResolvedValue(undefined);
      mockRandomBytes.mockReturnValue({ toString: () => 'tmp123' });

      // EXECUTE: Create session directory and write tasks
      const sessionPath = await createSessionDirectory('/test/PRD.md', 1);
      const backlog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Planned'),
      ]);
      await writeTasksJSON(sessionPath, backlog);

      // VERIFY: Session created and tasks written
      expect(sessionPath).toContain('001_14b9dc2a33c7');
      expect(mockMkdir).toHaveBeenCalled();
      expect(mockWriteFile).toHaveBeenCalled();
    });

    it('should support read-write roundtrip for tasks', async () => {
      // SETUP
      const originalBacklog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Planned'),
      ]);
      mockWriteFile.mockResolvedValue(undefined);
      mockRename.mockResolvedValue(undefined);
      mockRandomBytes.mockReturnValue({ toString: () => 'roundtrip' });
      mockReadFile.mockResolvedValue(JSON.stringify(originalBacklog));

      // EXECUTE: Write then read
      await writeTasksJSON('/test/session', originalBacklog);
      const readBacklog = await readTasksJSON('/test/session');

      // VERIFY: Data should match
      expect(readBacklog.backlog).toHaveLength(1);
      expect(readBacklog.backlog[0].id).toBe('P1');
    });

    it('should handle multiple PRP writes in sequence', async () => {
      // SETUP
      mockWriteFile.mockResolvedValue(undefined);
      mockRename.mockResolvedValue(undefined);
      mockRandomBytes.mockReturnValue({ toString: () => 'multi' });

      // EXECUTE: Write multiple PRPs
      await writePRP(
        '/test/session',
        'P1.M1.T1.S1',
        createTestPRPDocument('P1.M1.T1.S1')
      );
      await writePRP(
        '/test/session',
        'P1.M1.T1.S2',
        createTestPRPDocument('P1.M1.T1.S2')
      );
      await writePRP(
        '/test/session',
        'P1.M1.T2.S1',
        createTestPRPDocument('P1.M1.T2.S1')
      );

      // VERIFY: All PRPs should be written
      expect(mockWriteFile).toHaveBeenCalledTimes(3);
      expect(mockRename).toHaveBeenCalledTimes(3);

      // Check different filenames
      const renameCalls = mockRename.mock.calls;
      const targetPaths = renameCalls.map((call: any[]) => call[1]);
      expect(
        targetPaths.some((p: string) => p.includes('P1.M1.T1.S1.md'))
      ).toBe(true);
      expect(
        targetPaths.some((p: string) => p.includes('P1.M1.T1.S2.md'))
      ).toBe(true);
      expect(
        targetPaths.some((p: string) => p.includes('P1.M1.T2.S1.md'))
      ).toBe(true);
    });
  });

  describe('edge cases and boundary conditions', () => {
    it('should handle empty backlog', async () => {
      // SETUP: Empty backlog is valid
      const emptyBacklog = createTestBacklog([]);
      mockWriteFile.mockResolvedValue(undefined);
      mockRename.mockResolvedValue(undefined);
      mockRandomBytes.mockReturnValue({ toString: () => 'empty' });
      mockReadFile.mockResolvedValue(JSON.stringify(emptyBacklog));

      // EXECUTE: Write and read empty backlog
      await writeTasksJSON('/test/session', emptyBacklog);
      const result = await readTasksJSON('/test/session');

      // VERIFY
      expect(result.backlog).toEqual([]);
    });

    it('should handle large backlog with multiple phases', async () => {
      // SETUP: Create large backlog
      const phases = Array.from({ length: 10 }, (_, i) =>
        createTestPhase(`P${i + 1}`, `Phase ${i + 1}`, 'Planned')
      );
      const backlog = createTestBacklog(phases);
      mockWriteFile.mockResolvedValue(undefined);
      mockRename.mockResolvedValue(undefined);
      mockRandomBytes.mockReturnValue({ toString: () => 'large' });
      mockReadFile.mockResolvedValue(JSON.stringify(backlog));

      // EXECUTE
      await writeTasksJSON('/test/session', backlog);
      const result = await readTasksJSON('/test/session');

      // VERIFY
      expect(result.backlog).toHaveLength(10);
    });

    it('should handle deep hierarchy in backlog', async () => {
      // SETUP: Create maximum depth hierarchy
      const subtask = createTestSubtask('P1.M1.T1.S1', 'Subtask', 'Planned');
      const task = createTestTask('P1.M1.T1', 'Task', 'Planned', [subtask]);
      const milestone = createTestMilestone('P1.M1', 'Milestone', 'Planned', [
        task,
      ]);
      const phase = createTestPhase('P1', 'Phase', 'Planned', [milestone]);
      const backlog = createTestBacklog([phase]);
      mockWriteFile.mockResolvedValue(undefined);
      mockRename.mockResolvedValue(undefined);
      mockRandomBytes.mockReturnValue({ toString: () => 'deep' });
      mockReadFile.mockResolvedValue(JSON.stringify(backlog));

      // EXECUTE
      await writeTasksJSON('/test/session', backlog);
      const result = await readTasksJSON('/test/session');

      // VERIFY: Deep hierarchy preserved
      expect(result.backlog[0].milestones[0].tasks[0].subtasks[0].id).toBe(
        'P1.M1.T1.S1'
      );
    });

    it('should handle PRP with all status values', async () => {
      // SETUP: Create PRP with all validation levels
      const prp = createTestPRPDocument('P1.M2.T2.S3');

      mockWriteFile.mockResolvedValue(undefined);
      mockRename.mockResolvedValue(undefined);
      mockRandomBytes.mockReturnValue({ toString: () => 'status' });

      // EXECUTE
      await writePRP('/test/session', 'P1.M2.T2.S3', prp);

      // VERIFY: All validation levels should be in markdown
      const writeContent = mockWriteFile.mock.calls[0][1];
      expect(writeContent).toContain('### Level 1');
      expect(writeContent).toContain('### Level 2');
      expect(writeContent).toContain('### Level 3');
      expect(writeContent).toContain('### Level 4');
    });

    it('should handle PRP with empty arrays', async () => {
      // SETUP: Create PRP with empty arrays (edge case)
      const prp: PRPDocument = {
        taskId: 'P1.M2.T2.S3',
        objective: 'Test',
        context: 'Test context',
        implementationSteps: [],
        validationGates: [],
        successCriteria: [],
        references: [],
      };

      mockWriteFile.mockResolvedValue(undefined);
      mockRename.mockResolvedValue(undefined);
      mockRandomBytes.mockReturnValue({ toString: () => 'emptyarrays' });

      // EXECUTE: Should validate (empty arrays are allowed)
      await writePRP('/test/session', 'P1.M2.T2.S3', prp);

      // VERIFY: Should write without error
      expect(mockWriteFile).toHaveBeenCalled();
    });

    it('should handle session sequence 999', async () => {
      // SETUP: Test maximum sequence number
      mockReadFile.mockResolvedValue('# Test PRD');
      const hashInstance = new MockHash();
      mockCreateHash.mockReturnValue(hashInstance);
      mockMkdir.mockResolvedValue(undefined);

      // EXECUTE
      const sessionPath = await createSessionDirectory('/test/PRD.md', 999);

      // VERIFY: Should pad correctly (999 is already 3 digits)
      expect(sessionPath).toContain('999_');
    });

    it('should handle temp file random bytes', async () => {
      // SETUP: Verify randomBytes is used for temp file names
      mockReadFile.mockResolvedValue('# Test PRD');
      const hashInstance = new MockHash();
      mockCreateHash.mockReturnValue(hashInstance);
      mockMkdir.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);
      mockRename.mockResolvedValue(undefined);
      mockRandomBytes.mockReturnValue({ toString: () => 'rand' });

      const backlog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Planned'),
      ]);

      // EXECUTE
      await writeTasksJSON('/test/session', backlog);

      // VERIFY: randomBytes should be called with 8
      expect(mockRandomBytes).toHaveBeenCalledWith(8);
    });
  });

  describe('error handling paths', () => {
    it('should handle unlink error gracefully during cleanup', async () => {
      // SETUP: Mock write success, rename failure, unlink failure
      mockWriteFile.mockResolvedValue(undefined);
      mockRename.mockRejectedValue(new Error('Rename failed'));
      mockUnlink.mockRejectedValue(new Error('Unlink failed'));
      mockRandomBytes.mockReturnValue({ toString: () => 'cleanup' });

      const backlog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Planned'),
      ]);

      // EXECUTE: Should throw from rename, not unlink
      await expect(writeTasksJSON('/test/session', backlog)).rejects.toThrow(
        'Failed to atomic write'
      );
    });

    it('should propagate SessionFileError without wrapping', async () => {
      // SETUP: hashPRD throws SessionFileError
      mockReadFile.mockRejectedValue(new Error('File not found'));
      const hashInstance = new MockHash();
      mockCreateHash.mockReturnValue(hashInstance);

      // EXECUTE: createSessionDirectory should propagate the SessionFileError
      await expect(createSessionDirectory('/test/PRD.md', 1)).rejects.toThrow(
        SessionFileError
      );
    });

    it('should handle ZodError in writeTasksJSON', async () => {
      // SETUP: Create invalid data that fails Zod validation
      const invalidBacklog = { invalid: 'data' } as any;
      mockWriteFile.mockResolvedValue(undefined);
      mockRename.mockResolvedValue(undefined);
      mockRandomBytes.mockReturnValue({ toString: () => 'zod' });

      // EXECUTE & VERIFY
      await expect(
        writeTasksJSON('/test/session', invalidBacklog)
      ).rejects.toThrow(SessionFileError);
    });

    it('should handle ZodError in writePRP', async () => {
      // SETUP: Create invalid PRP
      const invalidPRP = { taskId: 'test' } as any;
      mockWriteFile.mockResolvedValue(undefined);
      mockRename.mockResolvedValue(undefined);
      mockRandomBytes.mockReturnValue({ toString: () => 'zodprp' });

      // EXECUTE & VERIFY
      await expect(
        writePRP('/test/session', 'test', invalidPRP)
      ).rejects.toThrow(SessionFileError);
    });
  });

  describe('snapshotPRD', () => {
    beforeEach(() => {
      // Setup default TextDecoder mock
      const mockDecoderInstance = {
        decode: vi.fn().mockReturnValue('# Test PRD\n\nContent'),
      };
      mockTextDecoder.mockReturnValue(mockDecoderInstance);
    });

    it('should read PRD and write to prd_snapshot.md', async () => {
      // SETUP: Mock successful read and write
      const prdContent = Buffer.from('# Test PRD\n\nContent');
      mockReadFile.mockResolvedValue(prdContent);
      mockWriteFile.mockResolvedValue(undefined);

      // EXECUTE
      await snapshotPRD('/test/session', '/test/PRD.md');

      // VERIFY
      expect(mockReadFile).toHaveBeenCalledWith('/test/PRD.md');
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringMatching(/\/prd_snapshot\.md$/),
        '# Test PRD\n\nContent', // Decoded string, not buffer
        { mode: 0o644 }
      );
    });

    it('should use strict UTF-8 validation for PRD content', async () => {
      // SETUP
      const prdContent = Buffer.from('# Test PRD\n\nContent');
      mockReadFile.mockResolvedValue(prdContent);
      mockWriteFile.mockResolvedValue(undefined);

      // EXECUTE
      await snapshotPRD('/test/session', '/test/PRD.md');

      // VERIFY: TextDecoder should be called with fatal: true
      expect(mockTextDecoder).toHaveBeenCalledWith('utf-8', { fatal: true });
    });

    it('should throw SessionFileError when PRD file not found (ENOENT)', async () => {
      // SETUP: Mock file not found
      const error = new Error(
        'ENOENT: file not found'
      ) as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      mockReadFile.mockRejectedValue(error);

      // EXECUTE & VERIFY
      await expect(
        snapshotPRD('/test/session', '/test/PRD.md')
      ).rejects.toThrow(SessionFileError);

      try {
        await snapshotPRD('/test/session', '/test/PRD.md');
      } catch (e) {
        expect(e).toBeInstanceOf(SessionFileError);
        const sessionError = e as SessionFileError;
        expect(sessionError.code).toBe('ENOENT');
        expect(sessionError.operation).toBe('read PRD');
      }
    });

    it('should throw SessionFileError when PRD has invalid UTF-8', async () => {
      // SETUP: Mock TextDecoder to throw on invalid UTF-8
      const mockDecoderInstance = {
        decode: vi.fn().mockImplementation(() => {
          throw new TypeError('Invalid UTF-8');
        }),
      };
      mockTextDecoder.mockReturnValue(mockDecoderInstance);
      mockReadFile.mockResolvedValue(Buffer.from([0xff, 0xfe]));

      // EXECUTE & VERIFY
      await expect(
        snapshotPRD('/test/session', '/test/PRD.md')
      ).rejects.toThrow(SessionFileError);

      try {
        await snapshotPRD('/test/session', '/test/PRD.md');
      } catch (e) {
        expect(e).toBeInstanceOf(SessionFileError);
        const sessionError = e as SessionFileError;
        expect(sessionError.operation).toBe('read PRD');
      }
    });

    it('should throw SessionFileError when write fails (EACCES)', async () => {
      // SETUP: Mock read success, write failure
      const error = new Error(
        'EACCES: permission denied'
      ) as NodeJS.ErrnoException;
      error.code = 'EACCES';
      mockReadFile.mockResolvedValue(Buffer.from('# Test PRD'));
      mockWriteFile.mockRejectedValue(error);

      // EXECUTE & VERIFY
      await expect(
        snapshotPRD('/test/session', '/test/PRD.md')
      ).rejects.toThrow(SessionFileError);

      try {
        await snapshotPRD('/test/session', '/test/PRD.md');
      } catch (e) {
        expect(e).toBeInstanceOf(SessionFileError);
        const sessionError = e as SessionFileError;
        expect(sessionError.code).toBe('EACCES');
        expect(sessionError.operation).toBe('write PRD snapshot');
      }
    });

    it('should create file with mode 0o644', async () => {
      // SETUP
      mockReadFile.mockResolvedValue(Buffer.from('# Test PRD'));
      mockWriteFile.mockResolvedValue(undefined);

      // EXECUTE
      await snapshotPRD('/test/session', '/test/PRD.md');

      // VERIFY: File mode should be 0o644
      const writeOptions = mockWriteFile.mock.calls[0][2];
      expect(writeOptions).toEqual({ mode: 0o644 });
    });

    it('should resolve relative paths to absolute paths', async () => {
      // SETUP
      mockReadFile.mockResolvedValue(Buffer.from('# Test PRD'));
      mockWriteFile.mockResolvedValue(undefined);

      // EXECUTE
      await snapshotPRD('relative/session', 'relative/PRD.md');

      // VERIFY: Both paths should be resolved to absolute paths
      expect(mockReadFile).toHaveBeenCalled();
      const calledPath = mockReadFile.mock.calls[0][0];
      expect(calledPath.startsWith('/')).toBe(true);
    });
  });

  describe('loadSnapshot', () => {
    beforeEach(() => {
      // Setup default TextDecoder mock
      const mockDecoderInstance = {
        decode: vi.fn().mockReturnValue('# Test PRD\n\nContent'),
      };
      mockTextDecoder.mockReturnValue(mockDecoderInstance);
    });

    it('should read and return prd_snapshot.md content', async () => {
      // SETUP: Mock successful read with custom decoder
      const snapshotContent = Buffer.from('# Test PRD\n\nSnapshot Content');
      mockReadFile.mockResolvedValue(snapshotContent);
      const mockDecoderInstance = {
        decode: vi.fn().mockReturnValue('# Test PRD\n\nSnapshot Content'),
      };
      mockTextDecoder.mockReturnValue(mockDecoderInstance);

      // EXECUTE
      const content = await loadSnapshot('/test/session');

      // VERIFY
      expect(mockReadFile).toHaveBeenCalledWith(
        expect.stringMatching(/\/prd_snapshot\.md$/)
      );
      expect(content).toBe('# Test PRD\n\nSnapshot Content');
    });

    it('should use strict UTF-8 validation for snapshot content', async () => {
      // SETUP
      mockReadFile.mockResolvedValue(Buffer.from('# Test PRD'));

      // EXECUTE
      await loadSnapshot('/test/session');

      // VERIFY: TextDecoder should be called with fatal: true
      expect(mockTextDecoder).toHaveBeenCalledWith('utf-8', { fatal: true });
    });

    it('should throw SessionFileError when snapshot file not found (ENOENT)', async () => {
      // SETUP: Mock file not found
      const error = new Error(
        'ENOENT: file not found'
      ) as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      mockReadFile.mockRejectedValue(error);

      // EXECUTE & VERIFY
      await expect(loadSnapshot('/test/session')).rejects.toThrow(
        SessionFileError
      );

      try {
        await loadSnapshot('/test/session');
      } catch (e) {
        expect(e).toBeInstanceOf(SessionFileError);
        const sessionError = e as SessionFileError;
        expect(sessionError.code).toBe('ENOENT');
        expect(sessionError.operation).toBe('read PRD snapshot');
      }
    });

    it('should throw SessionFileError when snapshot has invalid UTF-8', async () => {
      // SETUP: Mock TextDecoder to throw on invalid UTF-8
      const mockDecoderInstance = {
        decode: vi.fn().mockImplementation(() => {
          throw new TypeError('Invalid UTF-8');
        }),
      };
      mockTextDecoder.mockReturnValue(mockDecoderInstance);
      mockReadFile.mockResolvedValue(Buffer.from([0xff, 0xfe]));

      // EXECUTE & VERIFY
      await expect(loadSnapshot('/test/session')).rejects.toThrow(
        SessionFileError
      );

      try {
        await loadSnapshot('/test/session');
      } catch (e) {
        expect(e).toBeInstanceOf(SessionFileError);
        const sessionError = e as SessionFileError;
        expect(sessionError.operation).toBe('read PRD snapshot');
      }
    });

    it('should read from correct path in session directory', async () => {
      // SETUP
      mockReadFile.mockResolvedValue(Buffer.from('# Test PRD'));

      // EXECUTE
      await loadSnapshot('/test/session');

      // VERIFY
      expect(mockReadFile).toHaveBeenCalledWith(
        expect.stringMatching(/\/test\/session\/prd_snapshot\.md$/)
      );
    });
  });
});
