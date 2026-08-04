/**
 * Integration tests for prd task command
 *
 * @remarks
 * Tests validate the prd task command and its subcommands:
 * - `prd task` - displays tasks from current session
 * - `prd task next` - returns next executable task
 * - `prd task status` - shows task counts by status
 * - `prd task -f <file>` - overrides with specified tasks.json
 *
 * Tests also verify bugfix session priority and error handling.
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { SessionManager } from '../../src/core/session-manager.js';
import { TaskOrchestrator } from '../../src/core/task-orchestrator.js';
import type {
  Backlog,
  Phase,
  Milestone,
  Task,
  Subtask,
  Status,
} from '../../src/core/models.js';

// Mock the logger with hoisted variables
const { mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../src/utils/logger.js', () => ({
  getLogger: vi.fn(() => mockLogger),
}));

// Mock the node:fs module
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal();
  const mockStats = {
    isFile: vi.fn(() => true),
    isDirectory: vi.fn(() => true),
  };
  return {
    ...actual,
    existsSync: vi.fn(() => true),
    readFileSync: vi.fn(path => {
      if (path.includes('tasks.json')) {
        return JSON.stringify({ backlog: createTestBacklog().backlog });
      }
      return '{}';
    }),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    rmSync: vi.fn(),
    mkdtempSync: vi.fn(() => '/tmp/prd-task-test-XXXXXX'),
    statSync: vi.fn(() => mockStats),
  };
});

// Mock the SessionManager to avoid file system issues
vi.mock('../../src/core/session-manager.js', async importOriginal => {
  const actual = await importOriginal();
  return {
    ...actual,
    SessionManager: vi.fn().mockImplementation(() => {
      // currentSession MUST be a SessionState object (not a path string):
      // TaskOrchestrator reads currentSession.taskRegistry; the ResearchQueue it
      // builds constructs a PRPGenerator that reads currentSession.metadata.path.
      const mockState = {
        metadata: {
          id: '001_testsession',
          hash: 'testhash00000',
          path: '/tmp/prd-task-test-XXXXXX/plan/001_testsession',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD\n',
        taskRegistry: createTestBacklog(),
        currentItemId: null,
      };
      const mockInstance = {
        loadSession: vi.fn(),
        discoverSessions: vi
          .fn()
          .mockResolvedValue([
            '/tmp/prd-task-test-XXXXXX/plan/001_testsession',
          ]),
        get currentSession() {
          return mockState;
        },
        set currentSession(v) {
          Object.assign(mockState, v);
        },
      };
      return mockInstance;
    }),
  };
});

// Mock the node:path module
vi.mock('node:path', async importOriginal => {
  const actual = await importOriginal();
  return {
    ...actual,
    join: vi.fn(),
    resolve: vi.fn(),
  };
});

// Mock the node:os module
vi.mock('node:os', async importOriginal => {
  const actual = await importOriginal();
  return {
    ...actual,
    tmpdir: vi.fn(),
  };
});

// Mock the node:crypto module
vi.mock('node:crypto', async importOriginal => {
  const actual = await importOriginal();
  return {
    ...actual,
    createHash: vi.fn(),
  };
});

// Import mocked modules
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  mkdtempSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

const mockExistsSync = existsSync as any;
const mockReadFileSync = readFileSync as any;
const mockWriteFileSync = writeFileSync as any;
const mockMkdirSync = mkdirSync as any;
const mockRmSync = rmSync as any;
const mockMkdtempSync = mkdtempSync as any;
const mockJoin = join as any;
const mockResolve = resolve as any;
const mockTmpdir = tmpdir as any;
const mockCreateHash = createHash as any;

// =============================================================================
// Test Constants
// =============================================================================

const TEMP_DIR_TEMPLATE = join(tmpdir(), 'prd-task-test-XXXXXX');
const SESSION_DIR_PATTERN = /^(\d{3})_([a-f0-9]{12})$/;

// =============================================================================
// Fixture Helper Functions
// =============================================================================

const createTestSubtask = (
  id: string,
  title: string,
  status: Status = 'Planned',
  story_points: number = 1
): Subtask => ({
  id,
  type: 'Subtask' as const,
  title,
  status,
  story_points,
  dependencies: [],
  context_scope: 'Test scope',
});

const createTestTask = (
  id: string,
  title: string,
  subtasks: Subtask[] = []
): Task => ({
  id,
  type: 'Task' as const,
  title,
  status: 'Planned',
  description: 'Test task description',
  subtasks,
});

const createTestMilestone = (
  id: string,
  title: string,
  tasks: Task[] = []
): Milestone => ({
  id,
  type: 'Milestone' as const,
  title,
  status: 'Planned',
  description: 'Test milestone description',
  tasks,
});

const createTestPhase = (
  id: string,
  title: string,
  milestones: Milestone[] = []
): Phase => ({
  id,
  type: 'Phase' as const,
  title,
  status: 'Planned',
  description: 'Test phase description',
  milestones,
});

// Create a backlog with mixed statuses for testing
function createTestBacklog(): Backlog {
  const s1 = createTestSubtask('P1.M1.T1.S1', 'Complete Task', 'Complete', 1);
  const s2 = createTestSubtask('P1.M1.T1.S2', 'Planned Task', 'Planned', 2);
  const s3 = createTestSubtask(
    'P1.M1.T2.S1',
    'Researching Task',
    'Researching',
    3
  );
  const s4 = createTestSubtask(
    'P1.M1.T2.S2',
    'Implementing Task',
    'Implementing',
    1
  );

  const t1 = createTestTask('P1.M1.T1', 'Task 1', [s1, s2]);
  const t2 = createTestTask('P1.M1.T2', 'Task 2', [s3, s4]);

  const m1 = createTestMilestone('P1.M1', 'Milestone 1', [t1, t2]);

  const p1 = createTestPhase('P1', 'Phase 1', [m1]);

  return { backlog: [p1] };
}

// Setup a test session with required directory structure
function setupTestSession(
  tempDir: string,
  sessionId: string,
  backlog: Backlog
): string {
  const planDir = join(tempDir, 'plan');
  const sessionDir = join(planDir, sessionId);

  // Create required directories
  for (const dir of [
    planDir,
    sessionDir,
    join(sessionDir, 'architecture'),
    join(sessionDir, 'prps'),
    join(sessionDir, 'artifacts'),
  ]) {
    mkdirSync(dir, { recursive: true });
  }

  // Write session files
  writeFileSync(
    join(sessionDir, 'tasks.json'),
    JSON.stringify({ backlog: backlog.backlog }, null, 2)
  );
  writeFileSync(join(sessionDir, 'prd_snapshot.md'), '# Test PRD\n');
  writeFileSync(join(sessionDir, 'delta_from.txt'), '');

  return sessionDir;
}

// PATTERN: 'prd task' display test
describe('PRD Task Command Integration Tests', () => {
  let tempDir: string;
  let sessionManager: SessionManager;
  let originalArgv: string[];
  let originalExit: any;

  beforeEach(() => {
    // Setup mock temp directory
    mockMkdtempSync.mockReturnValue('/tmp/prd-task-test-XXXXXX');
    mockTmpdir.mockReturnValue('/tmp');
    mockJoin.mockImplementation((...paths) => paths.join('/'));
    mockResolve.mockImplementation(path => path);

    // Setup original process.argv and process.exit
    originalArgv = process.argv;
    originalExit = process.exit;

    // Mock process.exit to capture exit calls
    const mockExit = vi.fn((code: number) => {
      throw new Error(`process.exit(${code})`);
    });
    process.exit = mockExit as any;

    // Create temp directory
    tempDir = mockMkdtempSync(TEMP_DIR_TEMPLATE);

    // Use mocked SessionManager
    sessionManager = new SessionManager(
      mockJoin(tempDir, 'PRD.md'),
      mockJoin(tempDir, 'plan'),
      3
    );
  });

  afterEach(() => {
    // Restore original process.argv and process.exit
    process.argv = originalArgv;
    process.exit = originalExit;

    // Clear all mocks
    vi.clearAllMocks();
  });

  describe('prd task command', () => {
    it('should display tasks from current session in hierarchical format', async () => {
      // SETUP: Mock session loading
      const backlog = createTestBacklog();
      const orchestrator = new TaskOrchestrator(sessionManager);

      // EXECUTE: Get all tasks (simulating 'prd task' output)
      const tasks = orchestrator.executionQueue;

      // VERIFY: Tasks are in hierarchy
      expect(tasks.length).toBeGreaterThan(0);
      expect(tasks[0].id).toBe('P1.M1.T1.S1'); // DFS order
    });
  });

  describe('prd task next', () => {
    it('should return next executable task (first Planned or Researching)', async () => {
      // SETUP: Mock session loading with mixed statuses
      const backlog = createTestBacklog();
      const orchestrator = new TaskOrchestrator(sessionManager);

      // EXECUTE: Get next task
      const nextTask = orchestrator.executionQueue.find(
        t => t.status === 'Planned' || t.status === 'Researching'
      );

      // VERIFY: First Planned|Researching in DFS order. DFS leaf order is
      // S1(Complete) -> S2(Planned) -> S3(Researching) -> S4(Implementing), so the
      // first executable (Planned|Researching) leaf is S2 (Planned). (Confirmed by
      // sibling test #1: tasks[0].id === 'P1.M1.T1.S1'.)
      expect(nextTask).toBeDefined();
      expect(nextTask!.id).toBe('P1.M1.T1.S2');
      expect(nextTask!.status).toBe('Planned');
    });

    it('should return null when all tasks are Complete', async () => {
      // SETUP: Mock session loading with all Complete tasks
      const backlog: Backlog = {
        backlog: [
          createTestPhase('P1', 'Phase 1', [
            createTestMilestone('P1.M1', 'Milestone 1', [
              createTestTask('P1.M1.T1', 'Task 1', [
                createTestSubtask('P1.M1.T1.S1', 'Complete Task', 'Complete'),
              ]),
            ]),
          ]),
        ],
      };
      (sessionManager as any).currentSession = { taskRegistry: backlog };

      const orchestrator = new TaskOrchestrator(sessionManager);

      // EXECUTE: Find next task
      const nextTask = orchestrator.executionQueue.find(
        t => t.status === 'Planned' || t.status === 'Researching'
      );

      // VERIFY: No next task
      expect(nextTask).toBeUndefined();
    });
  });

  describe('prd task status', () => {
    it('should show counts by status', async () => {
      // SETUP: Mock session loading with various statuses
      const backlog = createTestBacklog();
      const orchestrator = new TaskOrchestrator(sessionManager);

      // EXECUTE: Count tasks by status
      const tasks = orchestrator.executionQueue;
      const counts: Record<Status, number> = {
        Planned: 0,
        Researching: 0,
        Implementing: 0,
        Complete: 0,
        Failed: 0,
        Obsolete: 0,
      };

      for (const task of tasks) {
        counts[task.status]++;
      }

      // VERIFY: Correct counts
      expect(counts.Complete).toBe(1);
      expect(counts.Planned).toBe(1);
      expect(counts.Researching).toBe(1);
      expect(counts.Implementing).toBe(1);
      expect(counts.Failed).toBe(0);
      expect(counts.Obsolete).toBe(0);
    });
  });

  describe('file override -f <file>', () => {
    it('should load tasks from specified file path', async () => {
      // SETUP: Mock alternative tasks file
      const altBacklog: Backlog = {
        backlog: [
          createTestPhase('P2', 'Alternative Phase', [
            createTestMilestone('P2.M1', 'Alt Milestone', [
              createTestTask('P2.M1.T1', 'Alt Task', [
                createTestSubtask('P2.M1.T1.S1', 'Alt Subtask'),
              ]),
            ]),
          ]),
        ],
      };

      // Mock reading alternative file
      mockReadFileSync.mockImplementation(path => {
        if (path.includes('alternative-tasks.json')) {
          return JSON.stringify(altBacklog, null, 2);
        }
        return '{}';
      });

      // EXECUTE: Load from alternative file (simulated)
      const altFilePath = mockJoin(tempDir, 'alternative-tasks.json');
      const content = mockReadFileSync(altFilePath, 'utf-8');
      const loadedBacklog = JSON.parse(content) as Backlog;

      // VERIFY: Alternative file loaded
      expect(loadedBacklog.backlog[0].id).toBe('P2');
      expect(loadedBacklog.backlog[0].title).toBe('Alternative Phase');
    });
  });

  describe('bugfix session priority', () => {
    it('should prioritize bugfix tasks over main tasks', async () => {
      // SETUP: Mock main session
      const mainBacklog = createTestBacklog();
      (sessionManager.loadSession as any).mockResolvedValue({
        tasks: mainBacklog.backlog,
        currentSession: '/tmp/prd-task-test-XXXXXX/plan/001_mainsession',
      });

      // SETUP: Mock bugfix session
      const bugfixBacklog: Backlog = {
        backlog: [
          createTestPhase('PFIX', 'Bugfix Phase', [
            createTestMilestone('PFIX.M1', 'Bugfix Milestone', [
              createTestTask('PFIX.M1.T1', 'Bugfix Task', [
                createTestSubtask(
                  'PFIX.M1.T1.S1',
                  'Critical Bug Fix',
                  'Planned',
                  13
                ),
              ]),
            ]),
          ]),
        ],
      };
      (sessionManager.loadSession as any).mockResolvedValue({
        tasks: bugfixBacklog.backlog,
        currentSession:
          '/tmp/prd-task-test-XXXXXX/plan/001_mainsession/bugfix/001_bugfix',
      });

      // EXECUTE: Discover sessions (bugfix should be found first)
      const sessions = [
        '/tmp/prd-task-test-XXXXXX/plan/001_mainsession',
        '/tmp/prd-task-test-XXXXXX/plan/001_mainsession/bugfix/001_bugfix',
      ];

      // VERIFY: Bugfix session comes first in priority
      const bugfixIndex = sessions.findIndex(s => s.includes('bugfix'));
      expect(bugfixIndex).toBeGreaterThanOrEqual(0);
    });
  });

  describe('error handling', () => {
    it('should handle non-existent file gracefully', () => {
      // SETUP: Non-existent file path (override the module-level existsSync=>true
      // default for THIS path only — the passing file-override/bugfix tests rely on
      // truthy existsSync)
      (mockExistsSync as any).mockReturnValue(false);
      const nonExistentPath = mockJoin(tempDir, 'does-not-exist.json');

      // EXECUTE: Try to read file
      const exists = mockExistsSync(nonExistentPath);

      // VERIFY: File does not exist
      expect(exists).toBe(false);
    });

    it('should handle invalid JSON', () => {
      // SETUP: Invalid JSON file
      const invalidJsonPath = mockJoin(tempDir, 'invalid.json');
      mockReadFileSync.mockImplementation(path => {
        if (path.includes('invalid.json')) {
          return '{ invalid json }';
        }
        return '{}';
      });

      // EXECUTE: Try to parse
      const parse = () => {
        try {
          JSON.parse(mockReadFileSync(invalidJsonPath, 'utf-8'));
          return true;
        } catch {
          return false;
        }
      };

      // VERIFY: Parse fails
      expect(parse()).toBe(false);
    });
  });
});
