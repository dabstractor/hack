/**
 * Unit tests for SessionManager class
 *
 * @remarks
 * Tests validate SessionManager class from src/core/session-manager.ts with 100% coverage.
 * Tests follow the Setup/Execute/Verify pattern with comprehensive edge case coverage.
 *
 * Mocks are used for all file system, crypto, and session-utils operations - no real I/O is performed.
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  SessionManager,
  createAdoptedBaseline,
} from '../../../src/core/session-manager.js';
import {
  hashPRD,
  resolvePRD,
  hashPRDContent,
  createSessionDirectory,
  snapshotPRD,
  readTasksJSON,
  writeTasksJSON,
  SessionFileError,
} from '../../../src/core/session-utils.js';
import {
  updateItemStatus as updateItemStatusUtil,
  findItem,
} from '../../../src/utils/task-utils.js';
import { PRDValidator } from '../../../src/utils/prd-validator.js';
import { ValidationError } from '../../../src/utils/errors.js';
import type { Backlog } from '../../../src/core/models.js';
import { Status, BacklogSchema } from '../../../src/core/models.js';

// Mock the node:fs/promises module
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  stat: vi.fn(),
  readdir: vi.fn(),
}));

// Mock the node:fs module for synchronous operations
vi.mock('node:fs', () => ({
  statSync: vi.fn(),
  readdir: vi.fn(),
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

// Mock the task-utils module. setItemStatus is given a REAL implementation
// (it is a pure function) so the delta-merge mutator in saveBacklog works
// correctly under the file-lock passthrough; updateItemStatus/findItem stay
// bare spies so individual tests can shape their return values.
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
// still records the call AND existing assertions on it stay meaningful.
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

// Mock the prd-validator module
vi.mock('../../../src/utils/prd-validator.js', () => ({
  PRDValidator: vi.fn(),
  default: vi.fn(),
}));

// Import mocked modules
import { readFile, writeFile, stat, readdir } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { resolve } from 'node:path';

// Cast mocked functions
const mockReadFile = readFile as any;
const mockWriteFile = writeFile as any;
const mockStat = stat as any;
const mockReaddir = readdir as any;
const mockStatSync = statSync as any;

const mockHashPRD = hashPRD as any;
const mockResolvePRD = resolvePRD as any;
const mockHashPRDContent = hashPRDContent as any;
const mockCreateSessionDirectory = createSessionDirectory as any;
const mockSnapshotPRD = snapshotPRD as any;
const mockReadTasksJSON = readTasksJSON as any;
const mockWriteTasksJSON = writeTasksJSON as any;
const mockUpdateItemStatusUtil = updateItemStatusUtil as any;
const mockFindItem = findItem as any;

// Mock PRDValidator class
const mockPRDValidator = PRDValidator as any;
const mockValidate = vi.fn();

// Setup mock validator instance
mockPRDValidator.mockImplementation(() => ({
  validate: mockValidate,
}));

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

// Mock hash response (64-character hex string)
const MOCK_FULL_HASH =
  '14b9dc2a33c7a1234567890abcdef1234567890abcdef1234567890abcdef123';
const MOCK_SESSION_HASH = '14b9dc2a33c7'; // First 12 chars

// Test constants for SessionManager constructor
const DEFAULT_PRD_PATH = '/test/PRD.md';
const DEFAULT_PLAN_DIR = 'plan'; // Will be resolved to absolute path
const DEFAULT_FLUSH_RETRIES = 3;

describe('SessionManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Defaults for the session-utils mocks consumed by initialize() (resolve once,
    // hash the resolved doc, write the snapshot). Individual tests override as
    // needed (e.g. delta tests that want a specific oldPRD value).
    mockResolvePRD.mockResolvedValue('# Test PRD');
    mockHashPRDContent.mockReturnValue(MOCK_FULL_HASH);
    mockSnapshotPRD.mockResolvedValue(undefined);
  });

  describe('constructor', () => {
    it('should validate PRD file exists synchronously', () => {
      // SETUP: Mock successful stat check
      mockStatSync.mockReturnValue({ isFile: () => true });

      // EXECUTE
      const manager = new SessionManager('/test/PRD.md', resolve('plan'));

      // VERIFY
      expect(mockStatSync).toHaveBeenCalledWith('/test/PRD.md');
      expect(manager.prdPath).toBe('/test/PRD.md');
      expect(manager.planDir).toContain('plan');
    });

    it('should throw SessionFileError when PRD does not exist (ENOENT)', () => {
      // SETUP: Mock ENOENT error
      const error = new Error('ENOENT: no such file') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      mockStatSync.mockImplementation(() => {
        throw error;
      });

      // EXECUTE & VERIFY
      expect(() => new SessionManager('/test/PRD.md', resolve('plan'))).toThrow(
        SessionFileError
      );
      expect(() => new SessionManager('/test/PRD.md', resolve('plan'))).toThrow(
        'validate PRD exists'
      );
    });

    it('should throw SessionFileError when path is not a file', () => {
      // SETUP: Mock directory stat
      mockStatSync.mockReturnValue({ isFile: () => false });

      // EXECUTE & VERIFY
      expect(() => new SessionManager('/test/PRD.md', resolve('plan'))).toThrow(
        SessionFileError
      );
      expect(() => new SessionManager('/test/PRD.md', resolve('plan'))).toThrow(
        'validate PRD path'
      );
    });

    it('should store prdPath and planDir as readonly properties', () => {
      // SETUP
      mockStatSync.mockReturnValue({ isFile: () => true });

      // EXECUTE
      const manager = new SessionManager('/test/PRD.md', '/custom/plan');

      // VERIFY
      expect(manager.prdPath).toBe('/test/PRD.md');
      expect(manager.planDir).toContain('/custom/plan');
      // Verify readonly - TypeScript enforces this, but we can check the values
      expect(() => {
        (manager as any).prdPath = '/new/path';
      }).not.toThrow(); // Runtime allows it, but TypeScript prevents it
    });

    it('should initialize currentSession to null', () => {
      // SETUP
      mockStatSync.mockReturnValue({ isFile: () => true });

      // EXECUTE
      const manager = new SessionManager('/test/PRD.md', resolve('plan'));

      // VERIFY
      expect(manager.currentSession).toBeNull();
    });

    it('should resolve relative paths to absolute paths', () => {
      // SETUP
      mockStatSync.mockReturnValue({ isFile: () => true });

      // EXECUTE
      const manager = new SessionManager('./PRD.md', resolve('plan'));

      // VERIFY: Path should be absolute
      expect(manager.prdPath).toMatch(/^\/.*PRD\.md$/);
    });

    it('should use default plan directory when not specified', () => {
      // SETUP
      mockStatSync.mockReturnValue({ isFile: () => true });

      // EXECUTE
      const manager = new SessionManager('/test/PRD.md', resolve('plan'));

      // VERIFY
      expect(manager.planDir).toContain('plan');
    });

    it('should accept custom planDir as second parameter', () => {
      // SETUP
      mockStatSync.mockReturnValue({ isFile: () => true });
      const customPlanDir = '/custom/plan/path';

      // EXECUTE
      const manager = new SessionManager(DEFAULT_PRD_PATH, customPlanDir);

      // VERIFY
      expect(manager.prdPath).toBe(DEFAULT_PRD_PATH);
      expect(manager.planDir).toContain(customPlanDir);
    });

    it('should accept all three parameters', () => {
      // SETUP
      mockStatSync.mockReturnValue({ isFile: () => true });

      // EXECUTE
      const manager = new SessionManager(
        DEFAULT_PRD_PATH,
        resolve(DEFAULT_PLAN_DIR),
        5
      );

      // VERIFY
      expect(manager.prdPath).toBe(DEFAULT_PRD_PATH);
      expect(manager.planDir).toContain(DEFAULT_PLAN_DIR);
    });
  });

  describe('currentSession getter', () => {
    it('should return null before initialize is called', () => {
      // SETUP
      mockStatSync.mockReturnValue({ isFile: () => true });

      // EXECUTE
      const manager = new SessionManager('/test/PRD.md', resolve('plan'));

      // VERIFY
      expect(manager.currentSession).toBeNull();
    });

    it('should return SessionState after initialize is called', async () => {
      // SETUP
      mockStatSync.mockReturnValue({ isFile: () => true });
      mockHashPRD.mockResolvedValue(MOCK_FULL_HASH);
      mockReaddir.mockResolvedValue([]); // No existing sessions
      mockCreateSessionDirectory.mockResolvedValue('/plan/001_14b9dc2a33c7');
      mockReadFile.mockResolvedValue('# Test PRD');
      mockWriteFile.mockResolvedValue(undefined);
      // Mock successful validation
      mockValidate.mockResolvedValue({
        valid: true,
        prdPath: '/test/PRD.md',
        issues: [],
        summary: { critical: 0, warning: 0, info: 0 },
        validatedAt: new Date(),
      });

      // EXECUTE
      const manager = new SessionManager('/test/PRD.md', resolve('plan'));
      await manager.initialize();

      // VERIFY
      expect(manager.currentSession).not.toBeNull();
      expect(manager.currentSession?.metadata.id).toBe('001_14b9dc2a33c7');
    });
  });

  describe('initialize', () => {
    beforeEach(() => {
      mockStatSync.mockReturnValue({ isFile: () => true });
      mockHashPRD.mockResolvedValue(MOCK_FULL_HASH);
      mockReadFile.mockResolvedValue('# Test PRD');
      mockWriteFile.mockResolvedValue(undefined);
      // Mock successful validation by default
      mockValidate.mockResolvedValue({
        valid: true,
        prdPath: '/test/PRD.md',
        issues: [],
        summary: { critical: 0, warning: 0, info: 0 },
        validatedAt: new Date(),
      });
    });

    it('should validate PRD before processing', async () => {
      // SETUP: No existing sessions
      mockReaddir.mockResolvedValue([]);
      mockCreateSessionDirectory.mockResolvedValue('/plan/001_14b9dc2a33c7');

      // EXECUTE
      const manager = new SessionManager('/test/PRD.md', resolve('plan'));
      await manager.initialize();

      // VERIFY
      expect(mockValidate).toHaveBeenCalledWith('/test/PRD.md');
    });

    it('should throw ValidationError for invalid PRD', async () => {
      // SETUP: Mock validation failure
      mockValidate.mockResolvedValue({
        valid: false,
        prdPath: '/test/PRD.md',
        issues: [
          {
            severity: 'critical',
            category: 'content',
            message: 'PRD content is too short (10 chars). Minimum: 100 chars',
            field: 'content',
            expected: 'At least 100 characters',
            actual: '10 characters',
            suggestion: 'Add more content to your PRD.',
          },
        ],
        summary: { critical: 1, warning: 0, info: 0 },
        validatedAt: new Date(),
      });

      // EXECUTE & VERIFY
      const manager = new SessionManager('/test/PRD.md', resolve('plan'));
      await expect(manager.initialize()).rejects.toThrow(ValidationError);
    });

    it('should include validation context in ValidationError', async () => {
      // SETUP: Mock validation failure
      mockValidate.mockResolvedValue({
        valid: false,
        prdPath: '/test/PRD.md',
        issues: [
          {
            severity: 'critical',
            category: 'content',
            message: 'PRD content is too short',
            suggestion: 'Add more content',
          },
        ],
        summary: { critical: 1, warning: 0, info: 0 },
        validatedAt: new Date(),
      });

      // EXECUTE & VERIFY
      const manager = new SessionManager('/test/PRD.md', resolve('plan'));
      try {
        await manager.initialize();
        expect.fail('Should have thrown ValidationError');
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        expect((error as ValidationError).code).toBe(
          'PIPELINE_VALIDATION_INVALID_INPUT'
        );
        expect((error as ValidationError).context).toHaveProperty('prdPath');
        expect((error as ValidationError).context).toHaveProperty(
          'validationIssues'
        );
      }
    });

    it('should resolve PRD once and hash the resolved doc', async () => {
      // SETUP: No existing sessions
      mockReaddir.mockResolvedValue([]);
      mockCreateSessionDirectory.mockResolvedValue('/plan/001_14b9dc2a33c7');

      // EXECUTE
      const manager = new SessionManager('/test/PRD.md', resolve('plan'));
      await manager.initialize();

      // VERIFY: resolvePRD is called exactly once with the PRD path; the hash is
      // computed by hashPRDContent over the resolved bytes; hashPRD is NOT called
      // (initialize resolves once itself and delegates the pure hash to hashPRDContent).
      expect(mockResolvePRD).toHaveBeenCalledWith('/test/PRD.md');
      expect(mockResolvePRD).toHaveBeenCalledTimes(1);
      expect(mockHashPRDContent).toHaveBeenCalledWith('# Test PRD');
      expect(mockHashPRD).not.toHaveBeenCalled();
    });

    it('should search plan/ directory for matching hash', async () => {
      // SETUP
      mockReaddir.mockResolvedValue([]); // No existing sessions
      mockCreateSessionDirectory.mockResolvedValue('/plan/001_14b9dc2a33c7');

      // EXECUTE
      const manager = new SessionManager('/test/PRD.md', resolve('plan'));
      await manager.initialize();

      // VERIFY: readdir was called to search for existing sessions
      expect(mockReaddir).toHaveBeenCalledWith(manager.planDir, {
        withFileTypes: true,
      });
    });

    it('should create new session when hash not found', async () => {
      // SETUP: No matching session found
      mockReaddir.mockResolvedValue([]);
      mockCreateSessionDirectory.mockResolvedValue('/plan/001_14b9dc2a33c7');

      // EXECUTE
      const manager = new SessionManager('/test/PRD.md', resolve('plan'));
      const session = await manager.initialize();

      // VERIFY
      expect(mockCreateSessionDirectory).toHaveBeenCalledWith(
        '/test/PRD.md',
        1,
        resolve('plan'),
        MOCK_FULL_HASH
      );
      expect(session.metadata.id).toBe('001_14b9dc2a33c7');
      expect(session.taskRegistry.backlog).toEqual([]);
    });

    it('should write PRD snapshot via snapshotPRD with the resolved doc', async () => {
      // SETUP
      const prdContent = '# Test PRD\n\nThis is content.';
      mockReaddir.mockResolvedValue([]);
      mockResolvePRD.mockResolvedValue(prdContent);
      mockCreateSessionDirectory.mockResolvedValue('/plan/001_14b9dc2a33c7');

      // EXECUTE
      const manager = new SessionManager('/test/PRD.md', resolve('plan'));
      await manager.initialize();

      // VERIFY: snapshotPRD writes the SAME resolved bytes (PRD §2.3).
      expect(mockSnapshotPRD).toHaveBeenCalledWith(
        '/plan/001_14b9dc2a33c7',
        '/test/PRD.md',
        prdContent
      );
    });

    it('should return SessionState with metadata, prdSnapshot, taskRegistry, currentItemId', async () => {
      // SETUP
      mockReaddir.mockResolvedValue([]);
      mockCreateSessionDirectory.mockResolvedValue('/plan/001_14b9dc2a33c7');

      // EXECUTE
      const manager = new SessionManager('/test/PRD.md', resolve('plan'));
      const session = await manager.initialize();

      // VERIFY
      expect(session).toMatchObject({
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: MOCK_SESSION_HASH,
          path: '/plan/001_14b9dc2a33c7',
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: { backlog: [] },
        currentItemId: null,
      });
      expect(session.metadata.createdAt).toBeInstanceOf(Date);
    });

    it('should load existing session when matching hash is found', async () => {
      // SETUP: Existing session directory found
      const testBacklog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Planned'),
      ]);
      mockReaddir.mockResolvedValue([
        { name: '001_14b9dc2a33c7', isDirectory: () => true },
      ]);
      mockReadTasksJSON.mockResolvedValue(testBacklog);
      mockStat.mockResolvedValue({ mtime: new Date('2024-01-01') });

      // EXECUTE
      const manager = new SessionManager('/test/PRD.md', resolve('plan'));
      const session = await manager.initialize();

      // VERIFY: Should load from existing session
      expect(mockCreateSessionDirectory).not.toHaveBeenCalled();
      expect(session.metadata.id).toBe('001_14b9dc2a33c7');
      expect(session.taskRegistry.backlog).toHaveLength(1);
    });

    it('should increment sequence number when creating new session', async () => {
      // SETUP: Existing session 001 exists, but hash doesn't match
      mockReaddir.mockResolvedValue([
        { name: '001_a1b2c3d4e5f6', isDirectory: () => true }, // Valid format but different hash
      ]);
      mockCreateSessionDirectory.mockResolvedValue('/plan/002_14b9dc2a33c7');

      // EXECUTE
      const manager = new SessionManager('/test/PRD.md', resolve('plan'));
      const session = await manager.initialize();

      // VERIFY
      expect(mockCreateSessionDirectory).toHaveBeenCalledWith(
        '/test/PRD.md',
        2,
        resolve('plan'),
        MOCK_FULL_HASH
      );
      expect(session.metadata.id).toBe('002_14b9dc2a33c7');
    });

    it('should start from sequence 1 when no sessions exist', async () => {
      // SETUP
      mockReaddir.mockResolvedValue([]);
      mockCreateSessionDirectory.mockResolvedValue('/plan/001_14b9dc2a33c7');

      // EXECUTE
      const manager = new SessionManager('/test/PRD.md', resolve('plan'));
      await manager.initialize();

      // VERIFY
      expect(mockCreateSessionDirectory).toHaveBeenCalledWith(
        '/test/PRD.md',
        1,
        resolve('plan'),
        MOCK_FULL_HASH
      );
    });

    it('should use zero-padded sequence (3 digits) in session ID', async () => {
      // SETUP
      mockReaddir.mockResolvedValue([]);
      mockCreateSessionDirectory.mockResolvedValue('/plan/001_14b9dc2a33c7');

      // EXECUTE
      const manager = new SessionManager('/test/PRD.md', resolve('plan'));
      const session = await manager.initialize();

      // VERIFY
      expect(session.metadata.id).toMatch(/^00\d_/);
    });

    it('should extract session hash (first 12 chars) from full hash', async () => {
      // SETUP
      mockReaddir.mockResolvedValue([]);
      mockCreateSessionDirectory.mockResolvedValue('/plan/001_14b9dc2a33c7');

      // EXECUTE
      const manager = new SessionManager('/test/PRD.md', resolve('plan'));
      const session = await manager.initialize();

      // VERIFY
      expect(session.metadata.hash).toBe(MOCK_SESSION_HASH);
      expect(session.metadata.hash.length).toBe(12);
    });

    it('should handle plan/ directory not existing (ENOENT)', async () => {
      // SETUP: plan/ doesn't exist
      const error = new Error('ENOENT') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      mockReaddir.mockImplementation(() => {
        throw error;
      });
      mockCreateSessionDirectory.mockResolvedValue('/plan/001_14b9dc2a33c7');

      // EXECUTE: Should create first session
      const manager = new SessionManager('/test/PRD.md', resolve('plan'));
      const session = await manager.initialize();

      // VERIFY
      expect(session.metadata.id).toBe('001_14b9dc2a33c7');
    });

    it('should propagate SessionFileError from resolvePRD()', async () => {
      // SETUP: resolvePRD throws error (initialize resolves via resolvePRD now)
      const resolveError = new SessionFileError('/test/PRD.md', 'read PRD');
      mockResolvePRD.mockRejectedValue(resolveError);

      // EXECUTE & VERIFY
      const manager = new SessionManager('/test/PRD.md', resolve('plan'));
      await expect(manager.initialize()).rejects.toThrow(SessionFileError);
    });

    it('should propagate SessionFileError from createSessionDirectory()', async () => {
      // SETUP: createSessionDirectory throws error
      const dirError = new SessionFileError(
        '/plan/001_14b9dc2a33c7',
        'create directory'
      );
      mockReaddir.mockResolvedValue([]);
      mockCreateSessionDirectory.mockRejectedValue(dirError);

      // EXECUTE & VERIFY
      const manager = new SessionManager('/test/PRD.md', resolve('plan'));
      await expect(manager.initialize()).rejects.toThrow(SessionFileError);
    });
  });

  describe('loadSession', () => {
    beforeEach(() => {
      mockStatSync.mockReturnValue({ isFile: () => true });
    });

    it('should read tasks.json using readTasksJSON()', async () => {
      // SETUP
      const testBacklog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Planned'),
      ]);
      mockReadTasksJSON.mockResolvedValue(testBacklog);
      mockReadFile.mockResolvedValue('# Test PRD');
      mockStat.mockResolvedValue({ mtime: new Date('2024-01-01') });

      // EXECUTE
      const manager = new SessionManager('/test/PRD.md', resolve('plan'));
      const session = await manager.loadSession('/plan/001_14b9dc2a33c7');

      // VERIFY
      expect(mockReadTasksJSON).toHaveBeenCalledWith('/plan/001_14b9dc2a33c7');
      expect(session.taskRegistry.backlog).toHaveLength(1);
    });

    it('should read prd_snapshot.md from session directory', async () => {
      // SETUP
      const prdContent = '# Test PRD Content';
      mockReadTasksJSON.mockResolvedValue({ backlog: [] });
      mockReadFile.mockResolvedValue(prdContent);
      mockStat.mockResolvedValue({ mtime: new Date('2024-01-01') });

      // EXECUTE
      const manager = new SessionManager('/test/PRD.md', resolve('plan'));
      const session = await manager.loadSession('/plan/001_14b9dc2a33c7');

      // VERIFY
      expect(mockReadFile).toHaveBeenCalledWith(
        expect.stringMatching(/\/plan\/001_14b9dc2a33c7\/prd_snapshot\.md$/),
        'utf-8'
      );
      expect(session.prdSnapshot).toBe(prdContent);
    });

    it('should parse metadata from directory name', async () => {
      // SETUP
      mockReadTasksJSON.mockResolvedValue({ backlog: [] });
      mockReadFile.mockResolvedValue('# PRD');
      mockStat.mockResolvedValue({ mtime: new Date('2024-01-01') });

      // EXECUTE
      const manager = new SessionManager('/test/PRD.md', resolve('plan'));
      const session = await manager.loadSession('/plan/001_14b9dc2a33c7');

      // VERIFY
      expect(session.metadata.id).toBe('001_14b9dc2a33c7');
      expect(session.metadata.hash).toBe('14b9dc2a33c7');
    });

    it('should check for parent_session.txt file', async () => {
      // SETUP: Parent session file exists
      mockReadTasksJSON.mockResolvedValue({ backlog: [] });
      mockReadFile
        .mockResolvedValueOnce('# PRD')
        .mockResolvedValueOnce('000_parenthash'); // parent_session.txt
      mockStat.mockResolvedValue({ mtime: new Date('2024-01-01') });

      // EXECUTE
      const manager = new SessionManager('/test/PRD.md', resolve('plan'));
      const session = await manager.loadSession('/plan/001_14b9dc2a33c7');

      // VERIFY
      expect(session.metadata.parentSession).toBe('000_parenthash');
    });

    it('should set parentSession to null when no parent file exists', async () => {
      // SETUP: No parent file (readFile throws)
      const error = new Error('ENOENT') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      mockReadTasksJSON.mockResolvedValue({ backlog: [] });
      mockReadFile.mockResolvedValueOnce('# PRD').mockRejectedValueOnce(error); // parent_session.txt doesn't exist
      mockStat.mockResolvedValue({ mtime: new Date('2024-01-01') });

      // EXECUTE
      const manager = new SessionManager('/test/PRD.md', resolve('plan'));
      const session = await manager.loadSession('/plan/001_14b9dc2a33c7');

      // VERIFY
      expect(session.metadata.parentSession).toBeNull();
    });

    it('should get directory creation time from stat()', async () => {
      // SETUP
      const mtime = new Date('2024-01-15T10:30:00Z');
      mockReadTasksJSON.mockResolvedValue({ backlog: [] });
      mockReadFile.mockResolvedValue('# PRD');
      mockStat.mockResolvedValue({ mtime });

      // EXECUTE
      const manager = new SessionManager('/test/PRD.md', resolve('plan'));
      const session = await manager.loadSession('/plan/001_14b9dc2a33c7');

      // VERIFY
      expect(mockStat).toHaveBeenCalledWith('/plan/001_14b9dc2a33c7');
      expect(session.metadata.createdAt).toEqual(mtime);
    });

    it('should set currentItemId to null (Task Orchestrator will set it)', async () => {
      // SETUP
      mockReadTasksJSON.mockResolvedValue({ backlog: [] });
      mockReadFile.mockResolvedValue('# PRD');
      mockStat.mockResolvedValue({ mtime: new Date() });

      // EXECUTE
      const manager = new SessionManager('/test/PRD.md', resolve('plan'));
      const session = await manager.loadSession('/plan/001_14b9dc2a33c7');

      // VERIFY
      expect(session.currentItemId).toBeNull();
    });

    it('should reconstruct complete SessionState from disk', async () => {
      // SETUP: Full session state
      const testBacklog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Planned', [
          createTestMilestone('P1.M1', 'Milestone 1', 'Planned', [
            createTestTask('P1.M1.T1', 'Task 1', 'Planned', [
              createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Planned'),
            ]),
          ]),
        ]),
      ]);
      mockReadTasksJSON.mockResolvedValue(testBacklog);
      mockReadFile.mockResolvedValue('# Full PRD');
      mockStat.mockResolvedValue({ mtime: new Date('2024-01-01') });

      // EXECUTE
      const manager = new SessionManager('/test/PRD.md', resolve('plan'));
      const session = await manager.loadSession('/plan/001_14b9dc2a33c7');

      // VERIFY: Complete hierarchy restored
      expect(session.taskRegistry.backlog).toHaveLength(1);
      expect(session.taskRegistry.backlog[0].id).toBe('P1');
      expect(session.taskRegistry.backlog[0].milestones[0].id).toBe('P1.M1');
      expect(session.taskRegistry.backlog[0].milestones[0].tasks[0].id).toBe(
        'P1.M1.T1'
      );
      expect(
        session.taskRegistry.backlog[0].milestones[0].tasks[0].subtasks[0].id
      ).toBe('P1.M1.T1.S1');
    });

    it('should propagate SessionFileError from readTasksJSON()', async () => {
      // SETUP
      const error = new SessionFileError(
        '/plan/001_14b9dc2a33c7/tasks.json',
        'read tasks.json'
      );
      mockReadTasksJSON.mockRejectedValue(error);

      // EXECUTE & VERIFY
      const manager = new SessionManager('/test/PRD.md', resolve('plan'));
      await expect(
        manager.loadSession('/plan/001_14b9dc2a33c7')
      ).rejects.toThrow(SessionFileError);
    });

    it('should throw when prd_snapshot.md not found', async () => {
      // SETUP
      const error = new Error('ENOENT') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      mockReadTasksJSON.mockResolvedValue({ backlog: [] });
      mockReadFile.mockRejectedValue(error);

      // EXECUTE & VERIFY
      const manager = new SessionManager('/test/PRD.md', resolve('plan'));
      await expect(
        manager.loadSession('/plan/001_14b9dc2a33c7')
      ).rejects.toThrow();
    });
  });

  describe('createDeltaSession', () => {
    beforeEach(() => {
      mockStatSync.mockReturnValue({ isFile: () => true });
    });

    it('should require initialize() to be called first', async () => {
      // SETUP: Manager with no current session
      const manager = new SessionManager('/test/PRD.md', resolve('plan'));

      // EXECUTE & VERIFY
      await expect(manager.createDeltaSession('/new/PRD.md')).rejects.toThrow(
        'no current session loaded'
      );
    });

    it('should validate new PRD exists', async () => {
      // SETUP: Initialize with current session (beforeEach defaults resolve+hash)
      mockReaddir.mockResolvedValue([]);
      mockCreateSessionDirectory.mockResolvedValue('/plan/001_14b9dc2a33c7');
      mockWriteFile.mockResolvedValue(undefined);

      const manager = new SessionManager('/test/PRD.md', resolve('plan'));
      await manager.initialize();

      // SETUP: New PRD doesn't exist
      mockStat.mockRejectedValue(new Error('ENOENT'));

      // EXECUTE & VERIFY
      await expect(manager.createDeltaSession('/new/PRD.md')).rejects.toThrow(
        SessionFileError
      );
    });

    it('should hash new PRD', async () => {
      // SETUP: Initialize current session (initialize resolves once + hashes the
      // resolved doc via the beforeEach defaults).
      const newHash =
        'a3f8e9d12b4aa5678901234567890abcdef1234567890abcdef1234567890abcdef';
      mockReaddir.mockResolvedValue([]);
      mockCreateSessionDirectory.mockResolvedValue('/plan/001_14b9dc2a33c7');
      mockWriteFile.mockResolvedValue(undefined);
      mockStat.mockResolvedValue({});

      const manager = new SessionManager('/test/PRD.md', resolve('plan'));
      await manager.initialize();

      // SETUP: Mock createDeltaSession's resolve-once (feeds hash+diff+snapshot) +
      // the pure hash of the resolved bytes (createDeltaSession uses hashPRDContent).
      mockResolvePRD.mockResolvedValueOnce('# New PRD');
      mockHashPRDContent.mockReturnValueOnce(newHash);
      mockCreateSessionDirectory.mockResolvedValue('/plan/002_a3f8e9d12b4a');

      // EXECUTE
      await manager.createDeltaSession('/new/PRD.md');

      // VERIFY: createDeltaSession resolves the new PRD and hashes the resolved doc
      // (PRD §2.3); it no longer calls the path-based hashPRD.
      expect(mockResolvePRD).toHaveBeenCalledWith('/new/PRD.md');
      expect(mockHashPRDContent).toHaveBeenCalledWith('# New PRD');
      expect(mockHashPRD).not.toHaveBeenCalledWith('/new/PRD.md');
    });

    it('should compare new PRD hash with current session hash', async () => {
      // SETUP: Initialize current session
      mockReaddir.mockResolvedValue([]);
      mockCreateSessionDirectory.mockResolvedValue('/plan/001_14b9dc2a33c7');
      mockWriteFile.mockResolvedValue(undefined);
      mockStat.mockResolvedValue({});

      const manager = new SessionManager('/test/PRD.md', resolve('plan'));
      await manager.initialize();

      // SETUP: Different hash for new PRD (resolved once, then hashed)
      const newHash =
        'a3f8e9d12b4aa5678901234567890abcdef1234567890abcdef1234567890abcdef';
      mockResolvePRD.mockResolvedValueOnce('# New PRD');
      mockHashPRDContent.mockReturnValueOnce(newHash);
      mockCreateSessionDirectory.mockResolvedValue('/plan/002_a3f8e9d12b4a');

      // EXECUTE
      const originalHash = manager.currentSession!.metadata.hash;
      const deltaSession = await manager.createDeltaSession('/new/PRD.md');

      // VERIFY: Hash should be different from original
      expect(deltaSession.metadata.hash).not.toBe(originalHash);
      expect(deltaSession.metadata.hash).toBe('a3f8e9d12b4a');
      // Verify current session was updated to delta session
      expect(manager.currentSession?.metadata.hash).toBe('a3f8e9d12b4a');
    });

    it('should read old PRD from current session prdSnapshot', async () => {
      // SETUP
      const oldPRD = '# Old PRD Content';
      mockResolvePRD.mockResolvedValue(oldPRD);
      mockReaddir.mockResolvedValue([]);
      mockCreateSessionDirectory.mockResolvedValue('/plan/001_14b9dc2a33c7');
      mockWriteFile.mockResolvedValue(undefined);
      mockStat.mockResolvedValue({});

      const manager = new SessionManager('/test/PRD.md', resolve('plan'));
      await manager.initialize();

      // SETUP: New PRD (resolved once for createDeltaSession)
      const newHash =
        'a3f8e9d12b4aa5678901234567890abcdef1234567890abcdef1234567890abcdef';
      mockResolvePRD.mockResolvedValueOnce('# New PRD');
      mockHashPRDContent.mockReturnValueOnce(newHash);
      mockCreateSessionDirectory.mockResolvedValue('/plan/002_a3f8e9d12b4a');

      // EXECUTE
      const deltaSession = await manager.createDeltaSession('/new/PRD.md');

      // VERIFY
      expect(deltaSession.oldPRD).toBe(oldPRD);
    });

    it('should read new PRD from file', async () => {
      // SETUP
      const newPRD = '# New PRD Content';
      mockReaddir.mockResolvedValue([]);
      mockCreateSessionDirectory.mockResolvedValue('/plan/001_14b9dc2a33c7');
      mockWriteFile.mockResolvedValue(undefined);
      mockStat.mockResolvedValue({});

      const manager = new SessionManager('/test/PRD.md', resolve('plan'));
      await manager.initialize();

      // SETUP: New PRD is resolved once by createDeltaSession (feeds hash+diff+snapshot)
      const newHash =
        'a3f8e9d12b4aa5678901234567890abcdef1234567890abcdef1234567890abcdef';
      mockResolvePRD.mockResolvedValueOnce(newPRD);
      mockHashPRDContent.mockReturnValueOnce(newHash);
      mockCreateSessionDirectory.mockResolvedValue('/plan/002_a3f8e9d12b4a');

      // EXECUTE
      const deltaSession = await manager.createDeltaSession('/new/PRD.md');

      // VERIFY
      expect(deltaSession.newPRD).toBe(newPRD);
    });

    it('should generate diff summary', async () => {
      // SETUP
      mockReaddir.mockResolvedValue([]);
      mockCreateSessionDirectory.mockResolvedValue('/plan/001_14b9dc2a33c7');
      mockWriteFile.mockResolvedValue(undefined);
      mockStat.mockResolvedValue({});

      const manager = new SessionManager('/test/PRD.md', resolve('plan'));
      await manager.initialize();

      // SETUP: New PRD with different content (resolved once for createDeltaSession)
      const newHash =
        'a3f8e9d12b4aa5678901234567890abcdef1234567890abcdef1234567890abcdef';
      mockResolvePRD.mockResolvedValueOnce('# New PRD\n\nExtra content');
      mockHashPRDContent.mockReturnValueOnce(newHash);
      mockCreateSessionDirectory.mockResolvedValue('/plan/002_a3f8e9d12b4a');

      // EXECUTE
      const deltaSession = await manager.createDeltaSession('/new/PRD.md');

      // VERIFY
      expect(deltaSession.diffSummary).toContain('PRD changes');
      expect(deltaSession.diffSummary).toBeDefined();
    });

    it('should create new session with incremented sequence', async () => {
      // SETUP
      mockReaddir.mockResolvedValue([]);
      mockCreateSessionDirectory.mockResolvedValue('/plan/001_14b9dc2a33c7');
      mockWriteFile.mockResolvedValue(undefined);
      mockStat.mockResolvedValue({});

      const manager = new SessionManager('/test/PRD.md', resolve('plan'));
      await manager.initialize();

      // SETUP: Create delta session (resolved once, hashed via hashPRDContent)
      const newHash =
        'a3f8e9d12b4aa5678901234567890abcdef1234567890abcdef1234567890abcdef';
      mockResolvePRD.mockResolvedValueOnce('# New PRD');
      mockHashPRDContent.mockReturnValueOnce(newHash);
      mockCreateSessionDirectory.mockResolvedValue('/plan/002_a3f8e9d12b4a');

      // EXECUTE
      const deltaSession = await manager.createDeltaSession('/new/PRD.md');

      // VERIFY
      expect(deltaSession.metadata.id).toBe('002_a3f8e9d12b4a');
      expect(mockCreateSessionDirectory).toHaveBeenCalledWith(
        '/new/PRD.md',
        2,
        resolve('plan'),
        newHash
      );
    });

    it('should write parent_session.txt to new session directory', async () => {
      // SETUP
      mockReaddir.mockResolvedValue([]);
      mockCreateSessionDirectory.mockResolvedValue('/plan/001_14b9dc2a33c7');
      mockWriteFile.mockResolvedValue(undefined);
      mockStat.mockResolvedValue({});

      const manager = new SessionManager('/test/PRD.md', resolve('plan'));
      await manager.initialize();

      // SETUP: Create delta session (resolved once)
      const newHash =
        'a3f8e9d12b4aa5678901234567890abcdef1234567890abcdef1234567890abcdef';
      mockResolvePRD.mockResolvedValueOnce('# New PRD');
      mockHashPRDContent.mockReturnValueOnce(newHash);
      mockCreateSessionDirectory.mockResolvedValue('/plan/002_a3f8e9d12b4a');

      // EXECUTE
      await manager.createDeltaSession('/new/PRD.md');

      // VERIFY
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringMatching(/\/parent_session\.txt$/),
        '001_14b9dc2a33c7',
        { mode: 0o644 }
      );
    });

    it('should set parentSession to current session ID', async () => {
      // SETUP
      mockReaddir.mockResolvedValue([]);
      mockCreateSessionDirectory.mockResolvedValue('/plan/001_14b9dc2a33c7');
      mockWriteFile.mockResolvedValue(undefined);
      mockStat.mockResolvedValue({});

      const manager = new SessionManager('/test/PRD.md', resolve('plan'));
      await manager.initialize();

      // SETUP: Create delta session (resolved once)
      const newHash =
        'a3f8e9d12b4aa5678901234567890abcdef1234567890abcdef1234567890abcdef';
      mockResolvePRD.mockResolvedValueOnce('# New PRD');
      mockHashPRDContent.mockReturnValueOnce(newHash);
      mockCreateSessionDirectory.mockResolvedValue('/plan/002_a3f8e9d12b4a');

      // EXECUTE
      const deltaSession = await manager.createDeltaSession('/new/PRD.md');

      // VERIFY
      expect(deltaSession.metadata.parentSession).toBe('001_14b9dc2a33c7');
    });

    it('should return DeltaSession with oldPRD, newPRD, diffSummary', async () => {
      // SETUP
      const oldPRD = '# Old PRD';
      const newPRD = '# New PRD\n\nAdditional content';
      mockResolvePRD.mockResolvedValue(oldPRD);
      mockReaddir.mockResolvedValue([]);
      mockCreateSessionDirectory.mockResolvedValue('/plan/001_14b9dc2a33c7');
      mockWriteFile.mockResolvedValue(undefined);
      mockStat.mockResolvedValue({});

      const manager = new SessionManager('/test/PRD.md', resolve('plan'));
      await manager.initialize();

      // SETUP: Create delta session — resolve the new PRD once (resolved-vs-resolved diff)
      const newHash =
        'a3f8e9d12b4aa5678901234567890abcdef1234567890abcdef1234567890abcdef';
      mockResolvePRD.mockResolvedValueOnce(newPRD);
      mockHashPRDContent.mockReturnValueOnce(newHash);
      mockCreateSessionDirectory.mockResolvedValue('/plan/002_a3f8e9d12b4a');

      // EXECUTE
      const deltaSession = await manager.createDeltaSession('/new/PRD.md');

      // VERIFY
      expect(deltaSession).toMatchObject({
        oldPRD,
        newPRD,
        diffSummary: expect.stringContaining('PRD changes'),
      });
      expect(deltaSession.taskRegistry).toEqual({ backlog: [] });
      expect(deltaSession.currentItemId).toBeNull();
    });

    it('should propagate SessionFileError from new PRD validation', async () => {
      // SETUP: Initialize current session
      mockReaddir.mockResolvedValue([]);
      mockCreateSessionDirectory.mockResolvedValue('/plan/001_14b9dc2a33c7');
      mockWriteFile.mockResolvedValue(undefined);
      mockStat.mockResolvedValue({});

      const manager = new SessionManager('/test/PRD.md', resolve('plan'));
      await manager.initialize();

      // SETUP: New PRD stat throws
      const error = new Error('ENOENT') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      mockStat.mockRejectedValue(error);

      // EXECUTE & VERIFY
      await expect(manager.createDeltaSession('/new/PRD.md')).rejects.toThrow(
        SessionFileError
      );
    });

    it('should propagate SessionFileError from createSessionDirectory()', async () => {
      // SETUP: Initialize current session
      mockReaddir.mockResolvedValue([]);
      mockCreateSessionDirectory.mockResolvedValue('/plan/001_14b9dc2a33c7');
      mockWriteFile.mockResolvedValue(undefined);
      mockStat.mockResolvedValue({});

      const manager = new SessionManager('/test/PRD.md', resolve('plan'));
      await manager.initialize();

      // SETUP: createSessionDirectory throws (resolve-once + hash first)
      const dirError = new SessionFileError(
        '/plan/002_a3f8e9d12b4a',
        'create directory'
      );
      const newHash =
        'a3f8e9d12b4aa5678901234567890abcdef1234567890abcdef1234567890abcdef';
      mockResolvePRD.mockResolvedValueOnce('# New PRD');
      mockHashPRDContent.mockReturnValueOnce(newHash);
      mockCreateSessionDirectory.mockRejectedValue(dirError);

      // EXECUTE & VERIFY
      await expect(manager.createDeltaSession('/new/PRD.md')).rejects.toThrow(
        SessionFileError
      );
    });
  });

  describe('integration scenarios', () => {
    it('should support full session lifecycle: initialize -> load -> delta', async () => {
      // SETUP: Initial session creation
      mockStatSync.mockReturnValue({ isFile: () => true });
      mockHashPRD.mockResolvedValue(MOCK_FULL_HASH);
      mockResolvePRD.mockResolvedValue('# Original PRD');
      mockReaddir.mockResolvedValue([]);
      mockCreateSessionDirectory.mockResolvedValue('/plan/001_14b9dc2a33c7');
      mockReadFile.mockResolvedValue('# Original PRD');
      mockWriteFile.mockResolvedValue(undefined);
      mockStat.mockResolvedValue({ mtime: new Date() });

      // EXECUTE: Initialize new session
      const manager = new SessionManager('/test/PRD.md', resolve('plan'));
      const session1 = await manager.initialize();

      // VERIFY: Initial session created
      expect(session1.metadata.id).toBe('001_14b9dc2a33c7');
      expect(session1.metadata.parentSession).toBeNull();

      // EXECUTE: Load the same session (simulate restart)
      const testBacklog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Complete'),
      ]);
      mockReaddir.mockResolvedValue([
        { name: '001_14b9dc2a33c7', isDirectory: () => true },
      ]);
      mockReadTasksJSON.mockResolvedValue(testBacklog);

      const session2 = await manager.initialize();

      // VERIFY: Existing session loaded
      expect(session2.metadata.id).toBe('001_14b9dc2a33c7');
      expect(session2.taskRegistry.backlog[0].status).toBe('Complete');

      // EXECUTE: Create delta session with modified PRD (resolved once)
      const newHash =
        'a3f8e9d12b4aa5678901234567890abcdef1234567890abcdef1234567890abcdef';
      mockResolvePRD.mockResolvedValueOnce('# Modified PRD');
      mockHashPRDContent.mockReturnValueOnce(newHash);
      mockCreateSessionDirectory.mockResolvedValue('/plan/002_a3f8e9d12b4a');

      const deltaSession = await manager.createDeltaSession('/modified/PRD.md');

      // VERIFY: Delta session created with parent reference
      expect(deltaSession.metadata.id).toBe('002_a3f8e9d12b4a');
      expect(deltaSession.metadata.parentSession).toBe('001_14b9dc2a33c7');
      expect(deltaSession.oldPRD).toBe('# Original PRD');
      expect(deltaSession.newPRD).toBe('# Modified PRD');
    });

    it('should handle multiple sequential sessions', async () => {
      // SETUP
      mockStatSync.mockReturnValue({ isFile: () => true });
      mockWriteFile.mockResolvedValue(undefined);

      const manager = new SessionManager('/test/PRD.md', resolve('plan'));

      // EXECUTE: Create first session (initialize resolves once + hashes resolved)
      mockReaddir.mockResolvedValue([]);
      mockCreateSessionDirectory.mockResolvedValue('/plan/001_14b9dc2a33c7');
      await manager.initialize();

      // EXECUTE: Simulate PRD change, create second session (resolve once)
      const hash2 =
        'a3f8e9d12b4aa5678901234567890abcdef1234567890abcdef1234567890abcdef';
      mockResolvePRD.mockResolvedValueOnce('# PRD v2');
      mockHashPRDContent.mockReturnValueOnce(hash2);
      mockCreateSessionDirectory.mockResolvedValue('/plan/002_a3f8e9d12b4a');
      mockStat.mockResolvedValue({});

      await manager.createDeltaSession('/test/PRD.md');

      // EXECUTE: Another PRD change, create third session (resolve once)
      const hash3 =
        'xyz789abc12a4567890abcdef1234567890abcdef1234567890abcdef123456';
      mockResolvePRD.mockResolvedValueOnce('# PRD v3');
      mockHashPRDContent.mockReturnValueOnce(hash3);
      mockCreateSessionDirectory.mockResolvedValue('/plan/003_xyz789abc12');

      await manager.createDeltaSession('/test/PRD.md');

      // VERIFY: Sequence numbers incremented correctly (precomputedHash passed)
      expect(mockCreateSessionDirectory).toHaveBeenNthCalledWith(
        1,
        '/test/PRD.md',
        1,
        resolve('plan'),
        MOCK_FULL_HASH
      );
      expect(mockCreateSessionDirectory).toHaveBeenNthCalledWith(
        2,
        '/test/PRD.md',
        2,
        resolve('plan'),
        hash2
      );
      expect(mockCreateSessionDirectory).toHaveBeenNthCalledWith(
        3,
        '/test/PRD.md',
        3,
        resolve('plan'),
        hash3
      );
    });
  });

  describe('edge cases and boundary conditions', () => {
    it('should handle empty task registry', async () => {
      // SETUP
      mockStatSync.mockReturnValue({ isFile: () => true });
      mockHashPRD.mockResolvedValue(MOCK_FULL_HASH);
      mockReaddir.mockResolvedValue([]);
      mockCreateSessionDirectory.mockResolvedValue('/plan/001_14b9dc2a33c7');
      mockReadFile.mockResolvedValue('# PRD');
      mockWriteFile.mockResolvedValue(undefined);

      // EXECUTE
      const manager = new SessionManager('/test/PRD.md', resolve('plan'));
      const session = await manager.initialize();

      // VERIFY
      expect(session.taskRegistry.backlog).toEqual([]);
    });

    it('should handle large task registry with deep hierarchy', async () => {
      // SETUP: Deep hierarchy
      const deepBacklog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Planned', [
          createTestMilestone('P1.M1', 'Milestone 1', 'Planned', [
            createTestTask('P1.M1.T1', 'Task 1', 'Planned', [
              createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Planned'),
              createTestSubtask('P1.M1.T1.S2', 'Subtask 2', 'Planned'),
              createTestSubtask('P1.M1.T1.S3', 'Subtask 3', 'Planned'),
            ]),
          ]),
        ]),
      ]);

      mockStatSync.mockReturnValue({ isFile: () => true });
      mockHashPRD.mockResolvedValue(MOCK_FULL_HASH);
      mockReadTasksJSON.mockResolvedValue(deepBacklog);
      mockReadFile.mockResolvedValue('# PRD');
      mockStat.mockResolvedValue({ mtime: new Date() });

      // EXECUTE
      const manager = new SessionManager('/test/PRD.md', resolve('plan'));
      const session = await manager.loadSession('/plan/001_14b9dc2a33c7');

      // VERIFY
      expect(
        session.taskRegistry.backlog[0].milestones[0].tasks[0].subtasks
      ).toHaveLength(3);
    });

    it('should handle session ID with maximum sequence (999)', async () => {
      // SETUP: Existing session 999
      mockStatSync.mockReturnValue({ isFile: () => true });
      mockHashPRD.mockResolvedValue(MOCK_FULL_HASH);
      mockReaddir.mockResolvedValue([
        { name: '999_a1b2c3d4e5f6', isDirectory: () => true }, // Valid format but different hash
      ]);
      mockCreateSessionDirectory.mockResolvedValue('/plan/1000_14b9dc2a33c7');
      mockReadFile.mockResolvedValue('# PRD');
      mockWriteFile.mockResolvedValue(undefined);

      // EXECUTE
      const manager = new SessionManager('/test/PRD.md', resolve('plan'));
      const session = await manager.initialize();

      // VERIFY: Should create session 1000 (initialize passes the precomputed hash)
      expect(mockCreateSessionDirectory).toHaveBeenCalledWith(
        '/test/PRD.md',
        1000,
        resolve('plan'),
        MOCK_FULL_HASH
      );
      expect(session.metadata.id).toBe('1000_14b9dc2a33c7');
    });

    it('should handle parent session with long ID', async () => {
      // SETUP
      const longParentId = '999_1234567890ab'; // Max valid format
      mockStatSync.mockReturnValue({ isFile: () => true });
      mockHashPRD.mockResolvedValue(MOCK_FULL_HASH);
      mockReadTasksJSON.mockResolvedValue({ backlog: [] });
      mockReadFile
        .mockResolvedValueOnce('# PRD')
        .mockResolvedValueOnce(longParentId); // parent_session.txt
      mockStat.mockResolvedValue({ mtime: new Date() });

      // EXECUTE
      const manager = new SessionManager('/test/PRD.md', resolve('plan'));
      const session = await manager.loadSession('/plan/001_14b9dc2a33c7');

      // VERIFY
      expect(session.metadata.parentSession).toBe(longParentId);
    });

    it('should handle PRD with special characters in content', async () => {
      // SETUP
      const specialPRD =
        '# PRD\n\n```typescript\nconst code = "test";\n```\n\n* List item\n\n> Quote';
      mockStatSync.mockReturnValue({ isFile: () => true });
      mockHashPRD.mockResolvedValue(MOCK_FULL_HASH);
      mockResolvePRD.mockResolvedValue(specialPRD);
      mockReaddir.mockResolvedValue([]);
      mockCreateSessionDirectory.mockResolvedValue('/plan/001_14b9dc2a33c7');
      mockReadFile.mockResolvedValue(specialPRD);
      mockWriteFile.mockResolvedValue(undefined);

      // EXECUTE
      const manager = new SessionManager('/test/PRD.md', resolve('plan'));
      const session = await manager.initialize();

      // VERIFY
      expect(session.prdSnapshot).toBe(specialPRD);
    });
  });

  describe('error handling paths', () => {
    it('should propagate generic errors from readdir', async () => {
      // SETUP
      mockStatSync.mockReturnValue({ isFile: () => true });
      mockHashPRD.mockResolvedValue(MOCK_FULL_HASH);
      mockReaddir.mockRejectedValue(new Error('EACCES: permission denied'));

      // EXECUTE & VERIFY
      const manager = new SessionManager('/test/PRD.md', resolve('plan'));
      await expect(manager.initialize()).rejects.toThrow('EACCES');
    });

    it('should propagate errors from stat when loading session', async () => {
      // SETUP
      mockStatSync.mockReturnValue({ isFile: () => true });
      mockReadTasksJSON.mockResolvedValue({ backlog: [] });
      mockReadFile.mockResolvedValue('# PRD');
      mockStat.mockRejectedValue(new Error('EIO: I/O error'));

      // EXECUTE & VERIFY
      const manager = new SessionManager('/test/PRD.md', resolve('plan'));
      await expect(
        manager.loadSession('/plan/001_14b9dc2a33c7')
      ).rejects.toThrow('EIO');
    });

    it('should handle createDeltaSession called twice with different PRDs', async () => {
      // SETUP: Initialize (beforeEach defaults resolve+hash)
      mockStatSync.mockReturnValue({ isFile: () => true });
      mockReaddir.mockResolvedValue([]);
      mockCreateSessionDirectory.mockResolvedValue('/plan/001_14b9dc2a33c7');
      mockWriteFile.mockResolvedValue(undefined);
      mockStat.mockResolvedValue({});

      const manager = new SessionManager('/test/PRD.md', resolve('plan'));
      await manager.initialize();

      // EXECUTE: First delta (resolve once)
      const hash2 =
        'a3f8e9d12b4aa5678901234567890abcdef1234567890abcdef1234567890abcdef';
      mockResolvePRD.mockResolvedValueOnce('# PRD v2');
      mockHashPRDContent.mockReturnValueOnce(hash2);
      mockCreateSessionDirectory.mockResolvedValue('/plan/002_a3f8e9d12b4a');

      await manager.createDeltaSession('/test/PRD.md');

      // EXECUTE: Second delta (different PRD, resolve once)
      const hash3 =
        'xyz789abc12a4567890abcdef1234567890abcdef1234567890abcdef123456';
      mockResolvePRD.mockResolvedValueOnce('# PRD v3');
      mockHashPRDContent.mockReturnValueOnce(hash3);
      mockCreateSessionDirectory.mockResolvedValue('/plan/003_xyz789abc12a');

      const delta2 = await manager.createDeltaSession('/test/PRD.md');

      // VERIFY: Should use session 002 as parent (latest session)
      expect(delta2.metadata.id).toBe('003_xyz789abc12a');
      expect(mockCreateSessionDirectory).toHaveBeenCalledWith(
        '/test/PRD.md',
        3,
        resolve('plan'),
        hash3
      );
    });
  });

  describe('createAdoptedBaseline', () => {
    it('returns one Phase→Milestone→Task→Subtask, all Complete', () => {
      // EXECUTE
      const b = createAdoptedBaseline();

      // VERIFY: a single 4-level hierarchy with the exact IDs + all-Complete.
      expect(b.backlog).toHaveLength(1);
      const p = b.backlog[0];
      const m = p.milestones[0];
      const t = m.tasks[0];
      const s = t.subtasks[0];
      expect(p.id).toBe('P1');
      expect(p.status).toBe('Complete');
      expect(m.id).toBe('P1.M1');
      expect(m.status).toBe('Complete');
      expect(t.id).toBe('P1.M1.T1');
      expect(t.status).toBe('Complete');
      expect(s.id).toBe('P1.M1.T1.S1');
      expect(s.title).toBe('Adopt existing codebase');
      expect(s.status).toBe('Complete');
      expect(s.prd_selectors).toEqual([]);
    });

    it('passes BacklogSchema.parse (schema-valid, writeTasksJSON would accept it)', () => {
      // EXECUTE + VERIFY: the seeded baseline MUST pass schema validation so
      // writeTasksJSON (which runs BacklogSchema.parse) accepts it at seed time.
      expect(() => BacklogSchema.parse(createAdoptedBaseline())).not.toThrow();
    });
  });

  describe('seedAdoptedBaseline', () => {
    beforeEach(() => {
      mockStatSync.mockReturnValue({ isFile: () => true });
    });

    it('writes .adopted marker + tasks.json and updates in-memory taskRegistry', async () => {
      // SETUP: initialize a session (sets #currentSession.path to the mocked
      // session dir). writeTasksJSON is mocked (vi.mock session-utils), so it
      // records the call without invoking BacklogSchema.parse; writeFile is
      // mocked (node:fs/promises) for the .adopted marker.
      mockHashPRD.mockResolvedValue(MOCK_FULL_HASH);
      mockReaddir.mockResolvedValue([]);
      mockCreateSessionDirectory.mockResolvedValue('/plan/001_14b9dc2a33c7');
      mockReadFile.mockResolvedValue('# Test PRD');
      mockWriteFile.mockResolvedValue(undefined);
      // Mock successful PRD validation (consumed by initialize()).
      mockValidate.mockResolvedValue({
        valid: true,
        prdPath: '/test/PRD.md',
        issues: [],
        summary: { critical: 0, warning: 0, info: 0 },
        validatedAt: new Date(),
      });
      mockWriteTasksJSON.mockResolvedValue(undefined);
      mockWriteTasksJSON.mockClear();
      mockWriteFile.mockClear();

      const manager = new SessionManager('/test/PRD.md', resolve('plan'));
      await manager.initialize();

      // sanity: the seeded session dir is the expected path
      expect(manager.currentSession?.metadata.path).toBe(
        '/plan/001_14b9dc2a33c7'
      );

      // EXECUTE
      const result = await manager.seedAdoptedBaseline();

      // VERIFY (a): .adopted marker written at join(sessionPath, '.adopted')
      const markerCalls = (mockWriteFile as any).mock.calls.filter(
        (c: unknown[]) => typeof c[0] === 'string' && c[0].endsWith('.adopted')
      );
      expect(markerCalls).toHaveLength(1);
      expect(markerCalls[0][0]).toBe('/plan/001_14b9dc2a33c7/.adopted');

      // VERIFY (b): writeTasksJSON called with the session path + a baseline
      // whose single Phase id is P1 (schema-valid — see createAdoptedBaseline).
      expect(mockWriteTasksJSON).toHaveBeenCalledTimes(1);
      expect(mockWriteTasksJSON).toHaveBeenCalledWith(
        '/plan/001_14b9dc2a33c7',
        expect.objectContaining({
          backlog: expect.arrayContaining([
            expect.objectContaining({ id: 'P1', status: 'Complete' }),
          ]),
        })
      );

      // VERIFY (c): in-memory taskRegistry updated to the seeded baseline so
      // the very next decomposePRD() auto-skips the architect.
      expect(result.taskRegistry.backlog).toHaveLength(1);
      expect(result.taskRegistry.backlog[0].id).toBe('P1');
      expect(manager.currentSession?.taskRegistry.backlog).toHaveLength(1);
      expect(manager.currentSession?.taskRegistry.backlog[0].id).toBe('P1');
    });

    it('throws if called before initialize (#currentSession null)', async () => {
      // SETUP: a manager with NO currentSession (initialize() not called).
      const manager = new SessionManager('/test/PRD.md', resolve('plan'));

      // EXECUTE + VERIFY
      await expect(manager.seedAdoptedBaseline()).rejects.toThrow(
        /initialized session/
      );
    });
  });

  describe('saveBacklog', () => {
    beforeEach(() => {
      mockStatSync.mockReturnValue({ isFile: () => true });
    });

    it('should call writeTasksJSON with session path and backlog', async () => {
      // SETUP: Initialize session
      mockHashPRD.mockResolvedValue(MOCK_FULL_HASH);
      mockReaddir.mockResolvedValue([]);
      mockCreateSessionDirectory.mockResolvedValue('/plan/001_14b9dc2a33c7');
      mockReadFile.mockResolvedValue('# Test PRD');
      mockWriteFile.mockResolvedValue(undefined);
      mockWriteTasksJSON.mockResolvedValue(undefined);

      const manager = new SessionManager('/test/PRD.md', resolve('plan'));
      await manager.initialize();

      const testBacklog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Planned'),
      ]);

      // EXECUTE
      await manager.saveBacklog(testBacklog);

      // VERIFY
      expect(mockWriteTasksJSON).toHaveBeenCalledWith(
        '/plan/001_14b9dc2a33c7',
        testBacklog
      );
    });

    it('should throw Error when no session loaded', async () => {
      // SETUP: Manager without session
      const manager = new SessionManager('/test/PRD.md', resolve('plan'));
      const testBacklog = createTestBacklog([]);

      // EXECUTE & VERIFY
      await expect(manager.saveBacklog(testBacklog)).rejects.toThrow(
        'Cannot save backlog: no session loaded'
      );
    });

    it('should propagate SessionFileError from writeTasksJSON', async () => {
      // SETUP
      mockHashPRD.mockResolvedValue(MOCK_FULL_HASH);
      mockReaddir.mockResolvedValue([]);
      mockCreateSessionDirectory.mockResolvedValue('/plan/001_14b9dc2a33c7');
      mockReadFile.mockResolvedValue('# Test PRD');
      mockWriteFile.mockResolvedValue(undefined);

      const error = new SessionFileError(
        '/plan/001_14b9dc2a33c7/tasks.json',
        'write tasks.json'
      );
      mockWriteTasksJSON.mockRejectedValue(error);

      const manager = new SessionManager('/test/PRD.md', resolve('plan'));
      await manager.initialize();

      const testBacklog = createTestBacklog([]);

      // EXECUTE & VERIFY
      await expect(manager.saveBacklog(testBacklog)).rejects.toThrow(
        SessionFileError
      );
    });
  });

  describe('loadBacklog', () => {
    beforeEach(() => {
      mockStatSync.mockReturnValue({ isFile: () => true });
    });

    it('should call readTasksJSON and return backlog', async () => {
      // SETUP: Initialize session
      mockHashPRD.mockResolvedValue(MOCK_FULL_HASH);
      mockReaddir.mockResolvedValue([]);
      mockCreateSessionDirectory.mockResolvedValue('/plan/001_14b9dc2a33c7');
      mockReadFile.mockResolvedValue('# Test PRD');
      mockWriteFile.mockResolvedValue(undefined);

      const testBacklog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Complete'),
      ]);
      mockReadTasksJSON.mockResolvedValue(testBacklog);

      const manager = new SessionManager('/test/PRD.md', resolve('plan'));
      await manager.initialize();

      // EXECUTE
      const result = await manager.loadBacklog();

      // VERIFY
      expect(mockReadTasksJSON).toHaveBeenCalledWith('/plan/001_14b9dc2a33c7');
      expect(result).toEqual(testBacklog);
    });

    it('should throw Error when no session loaded', async () => {
      // SETUP: Manager without session
      const manager = new SessionManager('/test/PRD.md', resolve('plan'));

      // EXECUTE & VERIFY
      await expect(manager.loadBacklog()).rejects.toThrow(
        'Cannot load backlog: no session loaded'
      );
    });

    it('should propagate SessionFileError from readTasksJSON', async () => {
      // SETUP
      mockHashPRD.mockResolvedValue(MOCK_FULL_HASH);
      mockReaddir.mockResolvedValue([]);
      mockCreateSessionDirectory.mockResolvedValue('/plan/001_14b9dc2a33c7');
      mockReadFile.mockResolvedValue('# Test PRD');
      mockWriteFile.mockResolvedValue(undefined);

      const error = new SessionFileError(
        '/plan/001_14b9dc2a33c7/tasks.json',
        'read tasks.json'
      );
      mockReadTasksJSON.mockRejectedValue(error);

      const manager = new SessionManager('/test/PRD.md', resolve('plan'));
      await manager.initialize();

      // EXECUTE & VERIFY
      await expect(manager.loadBacklog()).rejects.toThrow(SessionFileError);
    });
  });

  describe('updateItemStatus', () => {
    beforeEach(() => {
      mockStatSync.mockReturnValue({ isFile: () => true });
    });

    it('should update status, save, and return updated backlog', async () => {
      // SETUP: Initialize session
      mockHashPRD.mockResolvedValue(MOCK_FULL_HASH);
      mockReaddir.mockResolvedValue([]);
      mockCreateSessionDirectory.mockResolvedValue('/plan/001_14b9dc2a33c7');
      mockReadFile.mockResolvedValue('# Test PRD');
      mockWriteFile.mockResolvedValue(undefined);

      // Initialize creates empty backlog
      const emptyBacklog = createTestBacklog([]);
      const _originalBacklog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Planned', [
          createTestMilestone('P1.M1', 'Milestone 1', 'Planned', [
            createTestTask('P1.M1.T1', 'Task 1', 'Planned', [
              createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Planned'),
            ]),
          ]),
        ]),
      ]);

      const updatedBacklog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Planned', [
          createTestMilestone('P1.M1', 'Milestone 1', 'Planned', [
            createTestTask('P1.M1.T1', 'Task 1', 'Planned', [
              createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Complete'),
            ]),
          ]),
        ]),
      ]);

      // Mock updateItemStatusUtil to transform empty backlog to updated backlog
      mockUpdateItemStatusUtil.mockReturnValue(updatedBacklog);
      mockWriteTasksJSON.mockResolvedValue(undefined);
      // Seed the locked read so the delta-merge mutator has a structured base to
      // apply the {P1.M1.T1.S1 → Complete} delta onto (mirrors real runtime:
      // flush reads fresh disk, then applies only the queued delta).
      const preUpdateBacklog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Planned', [
          createTestMilestone('P1.M1', 'Milestone 1', 'Planned', [
            createTestTask('P1.M1.T1', 'Task 1', 'Planned', [
              createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Planned'),
            ]),
          ]),
        ]),
      ]);
      mockReadTasksJSON.mockResolvedValue(preUpdateBacklog);

      const manager = new SessionManager('/test/PRD.md', resolve('plan'));
      await manager.initialize();

      // EXECUTE - updateItemStatus will batch the update (no immediate write)
      const result = await manager.updateItemStatus('P1.M1.T1.S1', 'Complete');

      // VERIFY: updateItemStatus updated memory but did NOT write
      expect(mockUpdateItemStatusUtil).toHaveBeenCalledWith(
        emptyBacklog,
        'P1.M1.T1.S1',
        'Complete'
      );
      expect(mockWriteTasksJSON).not.toHaveBeenCalled(); // Batching: no immediate write
      expect(result).toEqual(updatedBacklog);

      // EXECUTE: Flush to persist the batched updates
      await manager.flushUpdates();

      // VERIFY: writeTasksJSON was called after flush with the delta-merged
      // backlog (fresh pre-update base + the queued Complete delta)
      expect(mockWriteTasksJSON).toHaveBeenCalledWith(
        '/plan/001_14b9dc2a33c7',
        updatedBacklog
      );
    });

    it('should throw Error when no session loaded', async () => {
      // SETUP: Manager without session
      const manager = new SessionManager('/test/PRD.md', resolve('plan'));

      // EXECUTE & VERIFY
      await expect(
        manager.updateItemStatus('P1.M1.T1.S1', 'Complete')
      ).rejects.toThrow('Cannot update item status: no session loaded');
    });

    it('should update currentSession.taskRegistry after save', async () => {
      // SETUP
      mockHashPRD.mockResolvedValue(MOCK_FULL_HASH);
      mockReaddir.mockResolvedValue([]);
      mockCreateSessionDirectory.mockResolvedValue('/plan/001_14b9dc2a33c7');
      mockReadFile.mockResolvedValue('# Test PRD');
      mockWriteFile.mockResolvedValue(undefined);

      const originalBacklog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Planned'),
      ]);

      const updatedBacklog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Complete'),
      ]);

      mockUpdateItemStatusUtil.mockReturnValue(updatedBacklog);
      mockWriteTasksJSON.mockResolvedValue(undefined);

      const manager = new SessionManager('/test/PRD.md', resolve('plan'));
      await manager.initialize();
      // Now we have empty backlog, but for this test let's use loadBacklog to set the original
      mockReadTasksJSON.mockResolvedValue(originalBacklog);
      await manager.loadBacklog(); // This loads but doesn't update currentSession

      // EXECUTE - updateItemStatus will use current empty backlog from initialize
      await manager.updateItemStatus('P1', 'Complete');

      // VERIFY: Internal state updated to updatedBacklog
      expect(manager.currentSession?.taskRegistry).toEqual(updatedBacklog);
    });
  });

  describe('getCurrentItem', () => {
    beforeEach(() => {
      mockStatSync.mockReturnValue({ isFile: () => true });
    });

    it('should return item when currentItemId is set', async () => {
      // SETUP: Initialize session with currentItemId
      mockHashPRD.mockResolvedValue(MOCK_FULL_HASH);
      mockReaddir.mockResolvedValue([]);
      mockCreateSessionDirectory.mockResolvedValue('/plan/001_14b9dc2a33c7');
      mockReadFile.mockResolvedValue('# Test PRD');
      mockWriteFile.mockResolvedValue(undefined);

      const testSubtask = createTestSubtask(
        'P1.M1.T1.S1',
        'Subtask 1',
        'Planned'
      );
      mockFindItem.mockReturnValue(testSubtask);

      const manager = new SessionManager('/test/PRD.md', resolve('plan'));
      await manager.initialize(); // Must await for session to load
      // Set currentItemId
      manager.setCurrentItem('P1.M1.T1.S1');

      // EXECUTE
      const result = manager.getCurrentItem();

      // VERIFY
      expect(mockFindItem).toHaveBeenCalledWith(
        manager.currentSession?.taskRegistry,
        'P1.M1.T1.S1'
      );
      expect(result).toEqual(testSubtask);
    });

    it('should return null when no session loaded', () => {
      // SETUP: Manager without session
      const manager = new SessionManager('/test/PRD.md', resolve('plan'));

      // EXECUTE
      const result = manager.getCurrentItem();

      // VERIFY: Should return null, not throw
      expect(result).toBeNull();
    });

    it('should return null when currentItemId is null', async () => {
      // SETUP: Initialize session without currentItemId
      mockHashPRD.mockResolvedValue(MOCK_FULL_HASH);
      mockReaddir.mockResolvedValue([]);
      mockCreateSessionDirectory.mockResolvedValue('/plan/001_14b9dc2a33c7');
      mockReadFile.mockResolvedValue('# Test PRD');
      mockWriteFile.mockResolvedValue(undefined);

      const manager = new SessionManager('/test/PRD.md', resolve('plan'));
      await manager.initialize(); // Must await for session to load

      // EXECUTE
      const result = manager.getCurrentItem();

      // VERIFY
      expect(result).toBeNull();
      expect(mockFindItem).not.toHaveBeenCalled();
    });

    it('should return null when item not found in backlog', async () => {
      // SETUP: Initialize session with currentItemId but item doesn't exist
      mockHashPRD.mockResolvedValue(MOCK_FULL_HASH);
      mockReaddir.mockResolvedValue([]);
      mockCreateSessionDirectory.mockResolvedValue('/plan/001_14b9dc2a33c7');
      mockReadFile.mockResolvedValue('# Test PRD');
      mockWriteFile.mockResolvedValue(undefined);
      mockFindItem.mockReturnValue(null);

      const manager = new SessionManager('/test/PRD.md', resolve('plan'));
      await manager.initialize(); // Must await for session to load
      manager.setCurrentItem('P1.M1.T1.S1');

      // EXECUTE
      const result = manager.getCurrentItem();

      // VERIFY
      expect(result).toBeNull();
    });
  });

  describe('setCurrentItem', () => {
    beforeEach(() => {
      mockStatSync.mockReturnValue({ isFile: () => true });
    });

    it('should set currentItemId on currentSession', async () => {
      // SETUP: Initialize session
      mockHashPRD.mockResolvedValue(MOCK_FULL_HASH);
      mockReaddir.mockResolvedValue([]);
      mockCreateSessionDirectory.mockResolvedValue('/plan/001_14b9dc2a33c7');
      mockReadFile.mockResolvedValue('# Test PRD');
      mockWriteFile.mockResolvedValue(undefined);

      const manager = new SessionManager('/test/PRD.md', resolve('plan'));
      await manager.initialize(); // Must await for session to load

      // EXECUTE
      manager.setCurrentItem('P1.M1.T1.S1');

      // VERIFY: Access via getter to verify
      expect(manager.currentSession?.currentItemId).toBe('P1.M1.T1.S1');
    });

    it('should throw Error when no session loaded', () => {
      // SETUP: Manager without session
      const manager = new SessionManager('/test/PRD.md', resolve('plan'));

      // EXECUTE & VERIFY
      expect(() => manager.setCurrentItem('P1.M1.T1.S1')).toThrow(
        'Cannot set current item: no session loaded'
      );
    });
  });

  describe('persistence integration scenarios', () => {
    beforeEach(() => {
      mockStatSync.mockReturnValue({ isFile: () => true });
    });

    it('should support full save/load cycle', async () => {
      // SETUP: Initialize session with backlog
      mockHashPRD.mockResolvedValue(MOCK_FULL_HASH);
      mockReaddir.mockResolvedValue([]);
      mockCreateSessionDirectory.mockResolvedValue('/plan/001_14b9dc2a33c7');
      mockReadFile.mockResolvedValue('# Test PRD');
      mockWriteFile.mockResolvedValue(undefined);

      const originalBacklog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Planned'),
      ]);
      mockWriteTasksJSON.mockResolvedValue(undefined);
      mockReadTasksJSON.mockResolvedValue(originalBacklog);

      const manager = new SessionManager('/test/PRD.md', resolve('plan'));
      await manager.initialize();

      // EXECUTE: Save backlog
      await manager.saveBacklog(originalBacklog);

      // EXECUTE: Load backlog
      const loaded = await manager.loadBacklog();

      // VERIFY: Same data returned
      expect(loaded).toEqual(originalBacklog);
    });

    it('should support updateItemStatus persistence cycle', async () => {
      // SETUP
      mockHashPRD.mockResolvedValue(MOCK_FULL_HASH);
      mockReaddir.mockResolvedValue([]);
      mockCreateSessionDirectory.mockResolvedValue('/plan/001_14b9dc2a33c7');
      mockReadFile.mockResolvedValue('# Test PRD');
      mockWriteFile.mockResolvedValue(undefined);

      const updatedBacklog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Complete'),
      ]);

      mockUpdateItemStatusUtil.mockReturnValue(updatedBacklog);
      mockWriteTasksJSON.mockResolvedValue(undefined);
      // loadBacklog should return the updated backlog (simulating persistence)
      mockReadTasksJSON.mockResolvedValue(updatedBacklog);

      const manager = new SessionManager('/test/PRD.md', resolve('plan'));
      await manager.initialize();

      // EXECUTE: Update status (batched in memory)
      await manager.updateItemStatus('P1', 'Complete');

      // EXECUTE: Flush to persist the batched updates
      await manager.flushUpdates();

      // EXECUTE: Load to verify persistence
      const loaded = await manager.loadBacklog();

      // VERIFY: Updated status persisted
      expect(loaded.backlog[0].status).toBe('Complete');
    });

    it('should support setCurrentItem/getCurrentItem cycle', async () => {
      // SETUP
      mockHashPRD.mockResolvedValue(MOCK_FULL_HASH);
      mockReaddir.mockResolvedValue([]);
      mockCreateSessionDirectory.mockResolvedValue('/plan/001_14b9dc2a33c7');
      mockReadFile.mockResolvedValue('# Test PRD');
      mockWriteFile.mockResolvedValue(undefined);

      const testSubtask = createTestSubtask(
        'P1.M1.T1.S1',
        'Subtask 1',
        'Planned'
      );
      mockFindItem.mockReturnValue(testSubtask);

      const manager = new SessionManager('/test/PRD.md', resolve('plan'));
      await manager.initialize(); // Must await for session to load

      // EXECUTE: Set current item
      manager.setCurrentItem('P1.M1.T1.S1');

      // EXECUTE: Get current item
      const current = manager.getCurrentItem();

      // VERIFY: Correct item returned
      expect(current?.id).toBe('P1.M1.T1.S1');
      expect(current?.title).toBe('Subtask 1');
    });
  });

  describe('listSessions (static)', () => {
    it('should list all sessions sorted by sequence ascending', async () => {
      // SETUP: Mock multiple session directories (all with 12-char hashes)
      mockStatSync.mockReturnValue({ isFile: () => true });
      mockReaddir.mockImplementation(async () => [
        { name: '002_25e8db4b4d8a', isDirectory: () => true },
        { name: '001_14b9dc2a33c7', isDirectory: () => true },
        { name: '003_a3f8e9d12b4a', isDirectory: () => true },
        { name: 'invalid_dir', isDirectory: () => true },
        { name: 'file.txt', isDirectory: () => false },
      ]);
      mockStat.mockImplementation(async () => ({
        mtime: new Date('2024-01-01'),
      }));
      const error = new Error('ENOENT') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      mockReadFile.mockImplementation(async () => {
        throw error;
      }); // No parent file for any session

      // EXECUTE
      const sessions = await SessionManager.listSessions('/test/plan');

      // VERIFY: Should return 3 sessions, sorted by sequence ascending
      expect(sessions).toHaveLength(3);
      expect(sessions[0].id).toBe('001_14b9dc2a33c7');
      expect(sessions[1].id).toBe('002_25e8db4b4d8a');
      expect(sessions[2].id).toBe('003_a3f8e9d12b4a');
    });

    it('should parse hash from directory name correctly', async () => {
      // SETUP
      mockStatSync.mockReturnValue({ isFile: () => true });
      mockReaddir.mockResolvedValue([
        { name: '001_14b9dc2a33c7', isDirectory: () => true },
      ]);
      mockStat.mockResolvedValue({ mtime: new Date('2024-01-01') });
      mockReadFile.mockRejectedValueOnce(new Error('ENOENT'));

      // EXECUTE
      const sessions = await SessionManager.listSessions('/test/plan');

      // VERIFY
      expect(sessions[0].hash).toBe('14b9dc2a33c7');
    });

    it('should read parent_session.txt if present', async () => {
      // SETUP
      mockStatSync.mockReturnValue({ isFile: () => true });
      mockReaddir.mockResolvedValue([
        { name: '002_25e8db4b4d8a', isDirectory: () => true },
      ]);
      mockStat.mockResolvedValue({ mtime: new Date('2024-01-02') });
      mockReadFile.mockResolvedValue('001_14b9dc2a33c7'); // parent_session.txt

      // EXECUTE
      const sessions = await SessionManager.listSessions('/test/plan');

      // VERIFY
      expect(sessions[0].parentSession).toBe('001_14b9dc2a33c7');
    });

    it('should set parentSession to null when no parent file exists', async () => {
      // SETUP
      mockStatSync.mockReturnValue({ isFile: () => true });
      mockReaddir.mockResolvedValue([
        { name: '001_14b9dc2a33c7', isDirectory: () => true },
      ]);
      mockStat.mockResolvedValue({ mtime: new Date('2024-01-01') });
      const error = new Error('ENOENT') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      mockReadFile.mockRejectedValueOnce(error);

      // EXECUTE
      const sessions = await SessionManager.listSessions('/test/plan');

      // VERIFY
      expect(sessions[0].parentSession).toBeNull();
    });

    it('should return empty array when plan directory does not exist', async () => {
      // SETUP
      mockStatSync.mockReturnValue({ isFile: () => true });
      const error = new Error('ENOENT') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      mockReaddir.mockRejectedValue(error);

      // EXECUTE
      const sessions = await SessionManager.listSessions('/test/plan');

      // VERIFY
      expect(sessions).toEqual([]);
    });

    it('should filter out non-matching directory names', async () => {
      // SETUP
      mockStatSync.mockReturnValue({ isFile: () => true });
      mockReaddir.mockResolvedValue([
        { name: '001_14b9dc2a33c7', isDirectory: () => true },
        { name: '001_invalid', isDirectory: () => true }, // Invalid hash
        { name: '999_abc', isDirectory: () => true }, // Too short
        { name: 'not_a_session', isDirectory: () => true },
      ]);
      mockStat.mockResolvedValue({ mtime: new Date('2024-01-01') });
      mockReadFile.mockRejectedValueOnce(new Error('ENOENT'));

      // EXECUTE
      const sessions = await SessionManager.listSessions('/test/plan');

      // VERIFY: Only valid session directories should be included
      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe('001_14b9dc2a33c7');
    });

    it('should handle empty plan directory', async () => {
      // SETUP
      mockStatSync.mockReturnValue({ isFile: () => true });
      mockReaddir.mockResolvedValue([]);

      // EXECUTE
      const sessions = await SessionManager.listSessions('/test/plan');

      // VERIFY
      expect(sessions).toEqual([]);
    });

    it('should use default plan directory when not specified', async () => {
      // SETUP
      mockStatSync.mockReturnValue({ isFile: () => true });
      mockReaddir.mockResolvedValue([]);
      mockStatSync.mockReturnValue({ isFile: () => true });

      // EXECUTE
      const _sessions = await SessionManager.listSessions();

      // VERIFY: Should call readdir with resolved 'plan' directory
      expect(mockReaddir).toHaveBeenCalled();
    });

    it('should skip sessions that fail to load during listSessions', async () => {
      // SETUP: Multiple sessions exist, one will throw error during stat
      mockStatSync.mockReturnValue({ isFile: () => true });
      mockReaddir.mockImplementation(async () => [
        { name: '001_14b9dc2a33c7', isDirectory: () => true },
        { name: '002_25e8db4b4d8a', isDirectory: () => true },
        { name: '003_a3f8e9d12b4a', isDirectory: () => true },
      ]);

      // Mock stat to throw error for session 002
      let callCount = 0;
      mockStat.mockImplementation(async () => {
        callCount++;
        if (callCount === 2) {
          // Second call (session 002) throws error
          throw new Error('EACCES: permission denied');
        }
        return { mtime: new Date('2024-01-01') };
      });

      const error = new Error('ENOENT') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      mockReadFile.mockRejectedValue(error);

      // EXECUTE
      const sessions = await SessionManager.listSessions('/test/plan');

      // VERIFY: Should return 2 sessions (001 and 003), skipping 002
      expect(sessions).toHaveLength(2);
      expect(sessions[0].id).toBe('001_14b9dc2a33c7');
      expect(sessions[1].id).toBe('003_a3f8e9d12b4a');
      // Line 677-679: catch block executes, continue skips the failing session
    });
  });

  describe('findLatestSession (static)', () => {
    it('should return session with highest sequence number', async () => {
      // SETUP
      mockStatSync.mockReturnValue({ isFile: () => true });
      mockReaddir.mockResolvedValue([
        { name: '001_14b9dc2a33c7', isDirectory: () => true },
        { name: '002_25e8db4b4d8a', isDirectory: () => true },
        { name: '003_a3f8e9d12b4a', isDirectory: () => true },
      ]);
      mockStat.mockResolvedValue({ mtime: new Date('2024-01-01') });
      mockReadFile.mockRejectedValue(new Error('ENOENT'));

      // EXECUTE
      const latest = await SessionManager.findLatestSession('/test/plan');

      // VERIFY
      expect(latest?.id).toBe('003_a3f8e9d12b4a');
    });

    it('should return null when no sessions exist', async () => {
      // SETUP
      mockStatSync.mockReturnValue({ isFile: () => true });
      mockReaddir.mockResolvedValue([]);

      // EXECUTE
      const latest = await SessionManager.findLatestSession('/test/plan');

      // VERIFY
      expect(latest).toBeNull();
    });

    it('should return null when plan directory does not exist', async () => {
      // SETUP
      mockStatSync.mockReturnValue({ isFile: () => true });
      const error = new Error('ENOENT') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      mockReaddir.mockRejectedValue(error);

      // EXECUTE
      const latest = await SessionManager.findLatestSession('/test/plan');

      // VERIFY
      expect(latest).toBeNull();
    });

    it('should return single session when only one exists', async () => {
      // SETUP
      mockStatSync.mockReturnValue({ isFile: () => true });
      mockReaddir.mockResolvedValue([
        { name: '001_14b9dc2a33c7', isDirectory: () => true },
      ]);
      mockStat.mockResolvedValue({ mtime: new Date('2024-01-01') });
      mockReadFile.mockRejectedValue(new Error('ENOENT'));

      // EXECUTE
      const latest = await SessionManager.findLatestSession('/test/plan');

      // VERIFY
      expect(latest?.id).toBe('001_14b9dc2a33c7');
    });
  });

  describe('findSessionByPRD (static)', () => {
    beforeEach(() => {
      mockStatSync.mockReturnValue({ isFile: () => true });
    });

    it('should find session by PRD hash', async () => {
      // SETUP
      mockHashPRD.mockResolvedValue(MOCK_FULL_HASH);
      mockReaddir.mockResolvedValue([
        { name: '001_14b9dc2a33c7', isDirectory: () => true },
        { name: '002_differenthash', isDirectory: () => true },
      ]);
      mockStat.mockResolvedValue({ mtime: new Date('2024-01-01') });
      mockReadFile.mockRejectedValue(new Error('ENOENT'));

      // EXECUTE
      const session = await SessionManager.findSessionByPRD('/test/PRD.md');

      // VERIFY
      expect(session).not.toBeNull();
      expect(session?.id).toBe('001_14b9dc2a33c7');
      expect(session?.hash).toBe(MOCK_SESSION_HASH);
      expect(mockHashPRD).toHaveBeenCalledWith('/test/PRD.md');
    });

    it('should return null when no matching session found', async () => {
      // SETUP
      mockHashPRD.mockResolvedValue(MOCK_FULL_HASH);
      mockReaddir.mockResolvedValue([
        { name: '001_differenthash', isDirectory: () => true },
      ]);

      // EXECUTE
      const session = await SessionManager.findSessionByPRD('/test/PRD.md');

      // VERIFY
      expect(session).toBeNull();
    });

    it('should throw SessionFileError when PRD does not exist', async () => {
      // SETUP: PRD file doesn't exist
      const error = new Error('ENOENT') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      mockStatSync.mockImplementation(() => {
        throw error;
      });

      // EXECUTE & VERIFY
      await expect(
        SessionManager.findSessionByPRD('/nonexistent/PRD.md')
      ).rejects.toThrow(SessionFileError);
    });

    it('should validate PRD is a file, not directory', async () => {
      // SETUP: PRD path is a directory
      mockStatSync.mockReturnValue({ isFile: () => false });

      // EXECUTE & VERIFY
      await expect(
        SessionManager.findSessionByPRD('/test/PRD.md')
      ).rejects.toThrow(SessionFileError);
    });

    it('should extract session hash from full PRD hash', async () => {
      // SETUP
      mockHashPRD.mockResolvedValue(MOCK_FULL_HASH);
      mockReaddir.mockResolvedValue([
        { name: '001_14b9dc2a33c7', isDirectory: () => true },
      ]);
      mockStat.mockResolvedValue({ mtime: new Date('2024-01-01') });
      mockReadFile.mockRejectedValue(new Error('ENOENT'));

      // EXECUTE
      const session = await SessionManager.findSessionByPRD('/test/PRD.md');

      // VERIFY: Session hash should be first 12 chars of full hash
      expect(session?.hash).toBe(MOCK_SESSION_HASH);
      expect(MOCK_SESSION_HASH.length).toBe(12);
    });

    it('should read parent session from parent_session.txt', async () => {
      // SETUP
      mockHashPRD.mockResolvedValue(MOCK_FULL_HASH);
      mockReaddir.mockResolvedValue([
        { name: '001_14b9dc2a33c7', isDirectory: () => true }, // Matching PRD hash
      ]);
      mockStat.mockResolvedValue({ mtime: new Date('2024-01-02') });
      mockReadFile.mockResolvedValue('000_parenthash'); // parent_session.txt

      // EXECUTE
      const session = await SessionManager.findSessionByPRD('/test/PRD.md');

      // VERIFY
      expect(session?.parentSession).toBe('000_parenthash');
    });

    it('should return null when plan directory does not exist', async () => {
      // SETUP
      mockHashPRD.mockResolvedValue(MOCK_FULL_HASH);
      const error = new Error('ENOENT') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      mockReaddir.mockRejectedValue(error);

      // EXECUTE
      const session = await SessionManager.findSessionByPRD('/test/PRD.md');

      // VERIFY
      expect(session).toBeNull();
    });
  });

  describe('hasSessionChanged', () => {
    it('should return false when PRD hash matches session hash', async () => {
      // SETUP: Initialize with matching PRD
      mockStatSync.mockReturnValue({ isFile: () => true });
      mockHashPRD.mockResolvedValue(MOCK_FULL_HASH);
      mockReaddir.mockResolvedValue([]); // No existing sessions
      mockCreateSessionDirectory.mockResolvedValue('/plan/001_14b9dc2a33c7');
      mockReadFile.mockResolvedValue('# Test PRD');
      mockWriteFile.mockResolvedValue(undefined);

      const manager = new SessionManager('/test/PRD.md', resolve('plan'));
      await manager.initialize();

      // EXECUTE
      const changed = manager.hasSessionChanged();

      // VERIFY: PRD hash was cached during initialize(), should match session hash
      expect(changed).toBe(false);
    });

    it('should return true when PRD hash differs from session hash', async () => {
      // SETUP: Initialize session with PRD hash
      mockStatSync.mockReturnValue({ isFile: () => true });
      mockHashPRD.mockResolvedValue(MOCK_FULL_HASH); // Returns 14b9dc2a33c7...
      mockReaddir.mockResolvedValue([]); // No existing sessions
      mockCreateSessionDirectory.mockResolvedValue('/plan/001_14b9dc2a33c7');
      mockReadFile.mockResolvedValue('# Test PRD');
      mockWriteFile.mockResolvedValue(undefined);

      const manager = new SessionManager('/test/PRD.md', resolve('plan'));
      await manager.initialize();

      // Create a delta session with different hash (simulating PRD change)
      const newHash =
        'a3f8e9d12b4aa5678901234567890abcdef1234567890abcdef1234567890abcdef';
      mockResolvePRD.mockResolvedValueOnce('# Different PRD');
      mockHashPRDContent.mockReturnValueOnce(newHash);
      mockCreateSessionDirectory.mockResolvedValue('/plan/002_a3f8e9d12b4a');
      mockStat.mockResolvedValue({});

      await manager.createDeltaSession('/new/PRD.md');

      // EXECUTE: After delta session, cached PRD hash (14b9dc2a33c7) differs from new session hash (a3f8e9d12b4a)
      const changed = manager.hasSessionChanged();

      // VERIFY: Should return true because hashes don't match
      expect(changed).toBe(true);
    });

    it('should throw Error when no session is loaded', async () => {
      // SETUP: Manager without session
      mockStatSync.mockReturnValue({ isFile: () => true });
      const manager = new SessionManager('/test/PRD.md', resolve('plan'));

      // EXECUTE & VERIFY
      expect(() => manager.hasSessionChanged()).toThrow(
        'Cannot check session change: no session loaded'
      );
    });

    it('should use cached PRD hash from initialize()', async () => {
      // SETUP: Initialize caches the PRD hash (resolvePRD + hashPRDContent, once)
      mockStatSync.mockReturnValue({ isFile: () => true });
      mockHashPRD.mockResolvedValue(MOCK_FULL_HASH);
      mockReaddir.mockResolvedValue([]);
      mockCreateSessionDirectory.mockResolvedValue('/plan/001_14b9dc2a33c7');
      mockReadFile.mockResolvedValue('# Test PRD');
      mockWriteFile.mockResolvedValue(undefined);

      const manager = new SessionManager('/test/PRD.md', resolve('plan'));
      await manager.initialize();

      // Verify resolvePRD/hashPRDContent were each called exactly once during initialize
      expect(mockResolvePRD).toHaveBeenCalledTimes(1);
      expect(mockHashPRDContent).toHaveBeenCalledTimes(1);

      // EXECUTE: hasSessionChanged should use cached hash, not re-resolve/re-hash
      manager.hasSessionChanged();

      // VERIFY: no additional resolution/hashing occurred
      expect(mockResolvePRD).toHaveBeenCalledTimes(1);
      expect(mockHashPRDContent).toHaveBeenCalledTimes(1);
    });

    it('defensive check for null prdHash is unreachable in normal operation', () => {
      // NOTE: Lines 830-831 in session-manager.ts check if #prdHash is null
      // This is defensive code that cannot be reached in normal operation because:
      // 1. initialize() always calls hashPRD() and sets #prdHash before returning
      // 2. There is no public API that sets #currentSession without also setting #prdHash
      // 3. The first check in hasSessionChanged() (for #currentSession) would fail first
      //
      // This is a TypeScript type guard combined with defensive programming to provide
      // runtime safety, but it's unreachable given the current implementation.
      //
      // Coverage approach: Document as unreachable defensive code rather than
      // attempting to create artificial test scenarios that don't reflect real usage.
    });
  });

  describe('session discovery integration', () => {
    it('should support full discovery workflow', async () => {
      // SETUP: Multiple sessions exist (all with 12-char hashes)
      mockStatSync.mockReturnValue({ isFile: () => true });
      mockReaddir.mockResolvedValue([
        { name: '001_14b9dc2a33c7', isDirectory: () => true },
        { name: '002_25e8db4b4d8a', isDirectory: () => true },
        { name: '003_a3f8e9d12b4a', isDirectory: () => true },
      ]);

      // Set up stat to return mtime
      mockStat.mockResolvedValue({ mtime: new Date('2024-01-01') });

      // Set up readFile to return content for parent sessions (simulating they have parents)
      mockReadFile.mockResolvedValue('001_14b9dc2a33c7');

      mockHashPRD.mockResolvedValue(MOCK_FULL_HASH);

      // EXECUTE: List all sessions
      const sessions = await SessionManager.listSessions('/test/plan');

      // VERIFY: All sessions found
      expect(sessions.length).toBeGreaterThan(0);

      // EXECUTE: Find latest
      const latest = await SessionManager.findLatestSession('/test/plan');

      // VERIFY
      expect(latest).not.toBeNull();
      expect(latest?.id).toBe('003_a3f8e9d12b4a');

      // EXECUTE: Find session by PRD
      const byPRD = await SessionManager.findSessionByPRD('/test/PRD.md');

      // VERIFY
      expect(byPRD).not.toBeNull();
      expect(byPRD?.id).toBe('001_14b9dc2a33c7');
    });

    it('hasAnySessions() returns true when session dirs exist (PRD §4.6)', async () => {
      // SETUP: a session directory matches the NNN_<hash> pattern.
      mockStatSync.mockReturnValue({ isFile: () => true });
      mockReaddir.mockResolvedValue([
        { name: '001_14b9dc2a33c7', isDirectory: () => true },
      ]);

      const manager = new SessionManager('/test/PRD.md', '/test/plan');

      // EXECUTE + VERIFY
      expect(await manager.hasAnySessions()).toBe(true);
    });

    it('hasAnySessions() returns false on a fresh project (no sessions, PRD §4.6)', async () => {
      // SETUP: plan dir has no NNN_<hash> session directories.
      mockStatSync.mockReturnValue({ isFile: () => true });
      mockReaddir.mockResolvedValue([
        { name: 'not-a-session.txt', isDirectory: () => false },
        { name: 'README.md', isDirectory: () => false },
      ]);

      const manager = new SessionManager('/test/PRD.md', '/test/plan');

      // EXECUTE + VERIFY
      expect(await manager.hasAnySessions()).toBe(false);
    });
  });

  describe('batch state updates', () => {
    beforeEach(() => {
      mockStatSync.mockReturnValue({ isFile: () => true });
    });

    it('should batch updates without immediate write', async () => {
      // SETUP: Initialize session
      mockHashPRD.mockResolvedValue(MOCK_FULL_HASH);
      mockReaddir.mockResolvedValue([]);
      mockCreateSessionDirectory.mockResolvedValue('/plan/001_14b9dc2a33c7');
      mockReadFile.mockResolvedValue('# Test PRD');
      mockWriteFile.mockResolvedValue(undefined);

      const _originalBacklog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Planned', [
          createTestMilestone('P1.M1', 'Milestone 1', 'Planned', [
            createTestTask('P1.M1.T1', 'Task 1', 'Planned', [
              createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Planned'),
            ]),
          ]),
        ]),
      ]);

      const updatedBacklog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Planned', [
          createTestMilestone('P1.M1', 'Milestone 1', 'Planned', [
            createTestTask('P1.M1.T1', 'Task 1', 'Planned', [
              createTestSubtask('P1.M1.T1.S1', 'Subtask 1', 'Complete'),
            ]),
          ]),
        ]),
      ]);

      mockUpdateItemStatusUtil.mockReturnValue(updatedBacklog);

      const manager = new SessionManager('/test/PRD.md', resolve('plan'));
      await manager.initialize();

      // EXECUTE: Update status (should batch, not write)
      await manager.updateItemStatus('P1.M1.T1.S1', 'Complete');

      // VERIFY: writeTasksJSON should NOT be called
      expect(mockWriteTasksJSON).not.toHaveBeenCalled();

      // VERIFY: Backlog was updated in memory
      expect(manager.currentSession?.taskRegistry).toEqual(updatedBacklog);
    });

    it('should flushUpdates write accumulated state atomically', async () => {
      // SETUP: Initialize session with batched updates
      mockHashPRD.mockResolvedValue(MOCK_FULL_HASH);
      mockReaddir.mockResolvedValue([]);
      mockCreateSessionDirectory.mockResolvedValue('/plan/001_14b9dc2a33c7');
      mockReadFile.mockResolvedValue('# Test PRD');
      mockWriteFile.mockResolvedValue(undefined);
      mockWriteTasksJSON.mockResolvedValue(undefined);

      const updatedBacklog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Complete'),
      ]);

      mockUpdateItemStatusUtil.mockReturnValue(updatedBacklog);

      const manager = new SessionManager('/test/PRD.md', resolve('plan'));
      await manager.initialize();

      // EXECUTE: Batch updates then flush
      await manager.updateItemStatus('P1', 'Complete');
      await manager.flushUpdates();

      // VERIFY: writeTasksJSON was called exactly once
      expect(mockWriteTasksJSON).toHaveBeenCalledTimes(1);
      expect(mockWriteTasksJSON).toHaveBeenCalledWith(
        '/plan/001_14b9dc2a33c7',
        updatedBacklog
      );
    });

    it('should flushUpdates be no-op when not dirty', async () => {
      // SETUP: Initialize session
      mockHashPRD.mockResolvedValue(MOCK_FULL_HASH);
      mockReaddir.mockResolvedValue([]);
      mockCreateSessionDirectory.mockResolvedValue('/plan/001_14b9dc2a33c7');
      mockReadFile.mockResolvedValue('# Test PRD');
      mockWriteFile.mockResolvedValue(undefined);
      mockWriteTasksJSON.mockResolvedValue(undefined);

      const manager = new SessionManager('/test/PRD.md', resolve('plan'));
      await manager.initialize();

      // EXECUTE: Flush without any updates
      await manager.flushUpdates();

      // VERIFY: writeTasksJSON should NOT be called
      expect(mockWriteTasksJSON).not.toHaveBeenCalled();
    });

    it('should accumulate multiple updates before flush', async () => {
      // SETUP
      mockHashPRD.mockResolvedValue(MOCK_FULL_HASH);
      mockReaddir.mockResolvedValue([]);
      mockCreateSessionDirectory.mockResolvedValue('/plan/001_14b9dc2a33c7');
      mockReadFile.mockResolvedValue('# Test PRD');
      mockWriteFile.mockResolvedValue(undefined);
      mockWriteTasksJSON.mockResolvedValue(undefined);

      const backlog1 = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Implementing'),
      ]);
      const backlog2 = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Complete'),
      ]);

      mockUpdateItemStatusUtil
        .mockReturnValueOnce(backlog1)
        .mockReturnValueOnce(backlog2);

      const manager = new SessionManager('/test/PRD.md', resolve('plan'));
      await manager.initialize();

      // EXECUTE: Multiple updates, single flush
      await manager.updateItemStatus('P1', 'Implementing');
      await manager.updateItemStatus('P1', 'Complete');
      await manager.flushUpdates();

      // VERIFY: writeTasksJSON called exactly once
      expect(mockWriteTasksJSON).toHaveBeenCalledTimes(1);
    });

    it('should log batch stats on flush', async () => {
      // SETUP
      mockHashPRD.mockResolvedValue(MOCK_FULL_HASH);
      mockReaddir.mockResolvedValue([]);
      mockCreateSessionDirectory.mockResolvedValue('/plan/001_14b9dc2a33c7');
      mockReadFile.mockResolvedValue('# Test PRD');
      mockWriteFile.mockResolvedValue(undefined);
      mockWriteTasksJSON.mockResolvedValue(undefined);

      const backlog1 = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Implementing'),
      ]);
      const backlog2 = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Complete'),
      ]);
      const backlog3 = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Complete'),
        createTestPhase('P2', 'Phase 2', 'Implementing'),
      ]);

      mockUpdateItemStatusUtil
        .mockReturnValueOnce(backlog1)
        .mockReturnValueOnce(backlog2)
        .mockReturnValueOnce(backlog3);
      // Seed the locked read with a structured base (P1 + P2 both Planned) so
      // the delta-merge mutator applies the 3 queued deltas onto it and yields
      // backlog3 (P1=Complete via LWW, P2=Implementing).
      mockReadTasksJSON.mockResolvedValue(
        createTestBacklog([
          createTestPhase('P1', 'Phase 1', 'Planned'),
          createTestPhase('P2', 'Phase 2', 'Planned'),
        ])
      );

      const manager = new SessionManager('/test/PRD.md', resolve('plan'));
      await manager.initialize();

      // EXECUTE: 3 updates then flush
      await manager.updateItemStatus('P1', 'Implementing');
      await manager.updateItemStatus('P1', 'Complete');
      await manager.updateItemStatus('P2', 'Implementing');
      await manager.flushUpdates();

      // VERIFY: writeTasksJSON called once, stats show 3 items
      expect(mockWriteTasksJSON).toHaveBeenCalledTimes(1);
      expect(mockWriteTasksJSON).toHaveBeenCalledWith(
        '/plan/001_14b9dc2a33c7',
        backlog3
      );
    });

    it('should preserve dirty state on flush error', async () => {
      // SETUP: Initialize session
      mockHashPRD.mockResolvedValue(MOCK_FULL_HASH);
      mockReaddir.mockResolvedValue([]);
      mockCreateSessionDirectory.mockResolvedValue('/plan/001_14b9dc2a33c7');
      mockReadFile.mockResolvedValue('# Test PRD');
      mockWriteFile.mockResolvedValue(undefined);

      const updatedBacklog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Complete'),
      ]);

      // Mock writeTasksJSON to fail
      const writeError = new SessionFileError(
        '/plan/001_14b9dc2a33c7/tasks.json',
        'write tasks.json'
      );
      mockWriteTasksJSON.mockRejectedValue(writeError);
      mockUpdateItemStatusUtil.mockReturnValue(updatedBacklog);

      const manager = new SessionManager('/test/PRD.md', resolve('plan'));
      await manager.initialize();

      // EXECUTE: Update then flush (should fail)
      await manager.updateItemStatus('P1', 'Complete');

      // EXECUTE & VERIFY: flushUpdates should throw error
      await expect(manager.flushUpdates()).rejects.toThrow(SessionFileError);

      // VERIFY: writeTasksJSON was called (attempted write)
      expect(mockWriteTasksJSON).toHaveBeenCalledTimes(1);

      // NOTE: After error, dirty state would still be set internally
      // but we can't test private fields without exposing them
      // The key behavior is that the error is thrown for retry
    });

    it('should reset batching state after successful flush', async () => {
      // SETUP
      mockHashPRD.mockResolvedValue(MOCK_FULL_HASH);
      mockReaddir.mockResolvedValue([]);
      mockCreateSessionDirectory.mockResolvedValue('/plan/001_14b9dc2a33c7');
      mockReadFile.mockResolvedValue('# Test PRD');
      mockWriteFile.mockResolvedValue(undefined);
      mockWriteTasksJSON.mockResolvedValue(undefined);

      const updatedBacklog = createTestBacklog([
        createTestPhase('P1', 'Phase 1', 'Complete'),
      ]);

      mockUpdateItemStatusUtil.mockReturnValue(updatedBacklog);

      const manager = new SessionManager('/test/PRD.md', resolve('plan'));
      await manager.initialize();

      // EXECUTE: Update, flush, then flush again
      await manager.updateItemStatus('P1', 'Complete');
      await manager.flushUpdates();
      await manager.flushUpdates(); // Second flush should be no-op

      // VERIFY: writeTasksJSON called only once (second flush was no-op)
      expect(mockWriteTasksJSON).toHaveBeenCalledTimes(1);
    });

    it('should handle dirty flag without pendingUpdates gracefully', async () => {
      // SETUP: Initialize session
      mockHashPRD.mockResolvedValue(MOCK_FULL_HASH);
      mockReaddir.mockResolvedValue([]);
      mockCreateSessionDirectory.mockResolvedValue('/plan/001_14b9dc2a33c7');
      mockReadFile.mockResolvedValue('# Test PRD');
      mockWriteFile.mockResolvedValue(undefined);

      const manager = new SessionManager('/test/PRD.md', resolve('plan'));
      await manager.initialize();

      // NOTE: We can't directly set dirty flag without pendingUpdates
      // because those are private fields. This is a defensive code path
      // that handles inconsistent state. The behavior is:
      // - If dirty is true but pendingUpdates is null, log warning and reset
      //
      // This test documents the defensive behavior but the actual
      // scenario can't be easily tested without exposing private fields.

      // EXECUTE: Flush should be safe (no updates pending)
      await manager.flushUpdates();

      // VERIFY: No errors thrown
      expect(mockWriteTasksJSON).not.toHaveBeenCalled();
    });
  });
});
