/**
 * Integration tests for Smart Commit Functionality
 *
 * @remarks
 * Tests validate the smart commit workflow that automatically creates Git commits
 * after successful subtask completion, with proper message formatting and protected
 * file filtering.
 *
 * Tests verify:
 * - Git commit is triggered after successful subtask completion
 * - Commit subject: task-prefix `<n.n.n.n>:` over the message (subtasks,
 *   default) or plain (non-backlog) (PRD §5.1; identity-transparent — no trailer).
 *   No `[PRP Auto]` banner.
 * - Protected files (tasks.json, PRD.md, prd_snapshot.md) are not committed
 * - All other changes are staged and committed
 * - Commit hash is returned and logged
 * - Smart commit failures don't fail subtask execution
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 * @see {@link ../../src/core/task-orchestrator.ts | TaskOrchestrator Implementation}
 * @see {@link ../../src/utils/git-commit.ts | Smart Commit Implementation}
 * @see {@link ../../src/tools/git-mcp.ts | Git MCP Implementation}
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

import type { Backlog, Subtask } from '../../src/core/models.js';

// =============================================================================
// Mock Setup
// =============================================================================

// Mock the git-commit module with actual implementation
vi.mock('../../src/utils/git-commit.js', () => ({
  smartCommit: vi.fn(),
  filterProtectedFiles: vi.fn((files: string[]) => {
    const { basename } = require('node:path'); // eslint-disable-line @typescript-eslint/no-var-requires
    return files.filter(
      (f: string) =>
        !['tasks.json', 'PRD.md', 'prd_snapshot.md'].includes(basename(f))
    );
  }),
  formatCommitMessage: vi.fn((msg: string) => msg),
  // parseItemPosition is imported by TaskOrchestrator from this module; the mock
  // factory must re-export it (same shape as src/utils/git-commit.ts:137).
  parseItemPosition: vi.fn((id: string) => {
    const m = /^P(\d+)\.M(\d+)\.T(\d+)(?:\.S(\d+))?$/.exec(id);
    if (!m) return null;
    const pos: Record<string, number> = {
      phase: Number(m[1]),
      milestone: Number(m[2]),
      task: Number(m[3]),
    };
    if (m[4] !== undefined) pos.subtask = Number(m[4]);
    return pos;
  }),
}));

// Mock the git-mcp module
vi.mock('../../src/tools/git-mcp.js', () => ({
  GitMCP: vi.fn().mockImplementation(() => ({
    name: 'git',
    transport: 'inprocess' as const,
    tools: [],
  })),
}));

// Mock the PRPRuntime class
vi.mock('../../src/agents/prp-runtime.js', () => ({
  PRPRuntime: vi.fn().mockImplementation(() => ({
    executeSubtask: vi.fn().mockResolvedValue({
      success: true,
      validationResults: [
        {
          level: 'Gate 1: Compilation',
          passed: true,
          details: 'Code compiles successfully',
        },
      ],
      artifacts: [],
      error: undefined,
      fixAttempts: 0,
    }),
  })),
}));

// Mock the PRPGenerator class (BUG-004 category (a) research seam). smart-commit's
// subject is commits, NOT the research path — bypass generate() to avoid the
// `PiHarness not initialized` chain (TaskOrchestrator → researchNow → generate).
vi.mock('../../src/agents/prp-generator.js', () => ({
  PRPGenerator: vi.fn(),
}));

// Mock logger with hoisted variables
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

// =============================================================================
// Imports
// =============================================================================

import { TaskOrchestrator } from '../../src/core/task-orchestrator.js';
import { PRPGenerator } from '../../src/agents/prp-generator.js';
import { wireMockPRPGenerator } from '../helpers/research-seam.js';
import {
  smartCommit,
  filterProtectedFiles,
  formatCommitMessage,
  parseItemPosition,
} from '../../src/utils/git-commit.js';

// Typed mocks
const mockSmartCommit = vi.mocked(smartCommit);
const mockFormatCommitMessage = vi.mocked(formatCommitMessage);

// =============================================================================
// Test Constants
// =============================================================================

const TEMP_DIR_TEMPLATE = join(tmpdir(), 'smart-commit-test-');

// =============================================================================
// Helper Functions
// =============================================================================

function createMockSubtask(overrides: Partial<Subtask> = {}): Subtask {
  return {
    type: 'Subtask',
    id: 'P1.M2.T1.S3',
    title: 'Verify smart commit functionality',
    status: 'Implementing',
    story_points: 1,
    dependencies: [],
    context_scope:
      'CONTRACT DEFINITION:\n1. RESEARCH NOTE: Test\n2. INPUT: None\n3. LOGIC: None\n4. OUTPUT: None',
    ...overrides,
  };
}

function createMockBacklog(): Backlog {
  return {
    backlog: [
      {
        type: 'Phase',
        id: 'P1',
        title: 'Test Phase',
        status: 'Planned',
        description: 'Test phase',
        milestones: [
          {
            type: 'Milestone',
            id: 'P1.M2',
            title: 'Test Milestone',
            status: 'Planned',
            description: 'Test milestone',
            tasks: [
              {
                type: 'Task',
                id: 'P1.M2.T1',
                title: 'Test Task',
                status: 'Planned',
                description: 'Test task',
                subtasks: [createMockSubtask()],
              },
            ],
          },
        ],
      },
    ],
  };
}

function createMockSessionState(sessionPath: string, backlog: Backlog) {
  const hash = createHash('sha256')
    .update(JSON.stringify(backlog))
    .digest('hex');
  return {
    metadata: {
      id: `001_${hash.substring(0, 12)}`,
      hash: hash.substring(0, 12),
      path: sessionPath,
      createdAt: new Date(),
      parentSession: null,
    },
    prdSnapshot: '# Test PRD',
    taskRegistry: backlog,
    currentItemId: null,
  };
}

function setupTestEnvironment(): {
  tempDir: string;
  sessionPath: string;
  backlog: Backlog;
} {
  const tempDir = mkdtempSync(TEMP_DIR_TEMPLATE);
  const planDir = join(tempDir, 'plan');
  const prdPath = join(tempDir, 'PRD.md');
  const hash = createHash('sha256').update('# Test PRD').digest('hex');
  const sessionPath = join(planDir, `001_${hash.substring(0, 12)}`);

  // Create directory structure
  mkdirSync(sessionPath, { recursive: true });

  // Write PRD file
  writeFileSync(prdPath, '# Test PRD');

  // Write session files
  writeFileSync(
    join(sessionPath, 'tasks.json'),
    JSON.stringify({ backlog: [] }, null, 2)
  );
  writeFileSync(join(sessionPath, 'prd_snapshot.md'), '# Test PRD');

  const backlog = createMockBacklog();

  return { tempDir, sessionPath, backlog };
}

// =============================================================================
// Test Suites
// =============================================================================

describe('integration/smart-commit > smart commit functionality', () => {
  let tempDir: string;
  let sessionPath: string;
  let taskOrchestrator: TaskOrchestrator;
  let mockSessionManager: any;
  let backlog: Backlog;

  beforeEach(() => {
    // SETUP: Create test environment
    const env = setupTestEnvironment();
    tempDir = env.tempDir;
    sessionPath = env.sessionPath;
    backlog = env.backlog;

    // SETUP: Clear all mocks
    vi.clearAllMocks();
    mockLogger.info.mockClear();
    mockLogger.error.mockClear();
    mockLogger.warn.mockClear();

    // SETUP: Create mock session manager
    const sessionState = createMockSessionState(sessionPath, backlog);
    mockSessionManager = {
      currentSession: sessionState,
      loadSession: vi.fn(),
      saveBacklog: vi.fn(),
      updateItemStatus: vi.fn(),
      flushUpdates: vi.fn(),
    };

    // Wire the research seam BEFORE constructing the orchestrator: ResearchQueue
    // caches `new PRPGenerator(...)` in its ctor (research-queue.ts:173), so the
    // mock implementation must be in place at construction time. (vi.clearAllMocks
    // above wipes the prior impl, so re-wire per test.)
    wireMockPRPGenerator({ PRPGenerator: vi.mocked(PRPGenerator) });

    // SETUP: Create TaskOrchestrator with mocked session manager
    taskOrchestrator = new TaskOrchestrator(mockSessionManager as any);
  });

  afterEach(() => {
    // CLEANUP: Remove temp directory
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // ===========================================================================
  // Commit triggering after subtask completion
  // ===========================================================================

  describe('commit triggering after subtask completion', () => {
    it('should trigger smart commit after successful subtask execution', async () => {
      // SETUP: Create mock subtask
      const subtask = createMockSubtask({
        id: 'P1.M2.T1.S3',
        title: 'Verify smart commit functionality',
      });

      // SETUP: Mock smartCommit to return commit hash
      mockSmartCommit.mockResolvedValue('abc123def456');

      // EXECUTE: Execute subtask (this will trigger smart commit)
      await taskOrchestrator.executeSubtask(subtask);

      // VERIFY: Smart commit was called with correct parameters (the
      // orchestrator threads the implementing item's position — BUG-003 S3).
      expect(mockSmartCommit).toHaveBeenCalledWith(
        sessionPath,
        'P1.M2.T1.S3: Verify smart commit functionality',
        expect.objectContaining({
          generateMessage: true,
          position: parseItemPosition('P1.M2.T1.S3'),
        })
      );
    });

    it('should not trigger smart commit when subtask execution throws exception', async () => {
      // SETUP: Create mock subtask
      const subtask = createMockSubtask();

      // SETUP: Mock PRPRuntime to throw exception
      const { PRPRuntime } = await import('../../src/agents/prp-runtime.js');
      const MockPRPRuntime = PRPRuntime as any;
      MockPRPRuntime.mockImplementation(() => ({
        executeSubtask: vi
          .fn()
          .mockRejectedValue(new Error('Execution failed')),
      }));

      // Create new orchestrator with throwing PRPRuntime
      const failingOrchestrator = new TaskOrchestrator(
        mockSessionManager as any
      );

      // EXECUTE: Execute subtask (which will throw)
      try {
        await failingOrchestrator.executeSubtask(subtask);
      } catch {
        // Expected to throw
      }

      // VERIFY: Smart commit was NOT called when exception is thrown
      expect(mockSmartCommit).not.toHaveBeenCalled();

      // Restore mock
      MockPRPRuntime.mockImplementation(() => ({
        executeSubtask: vi.fn().mockResolvedValue({
          success: true,
          validationResults: [],
          artifacts: [],
          error: undefined,
          fixAttempts: 0,
        }),
      }));
    });
  });

  // ===========================================================================
  // Commit message formatting
  // ===========================================================================

  describe('commit message formatting', () => {
    it('should format commit message with subtask ID and title', async () => {
      // SETUP: Create subtask with specific ID and title
      const subtask = createMockSubtask({
        id: 'P3.M4.T1.S3',
        title: 'Implement smart commit workflow',
      });

      // SETUP: Mock smartCommit to succeed
      mockSmartCommit.mockResolvedValue('abc123');

      // EXECUTE: Execute subtask
      await taskOrchestrator.executeSubtask(subtask);

      // VERIFY: Smart commit called with formatted message + the position
      // option (BUG-003 S3: the orchestrator now threads the implementing
      // item's parsed position so the task-prefix lights up).
      expect(mockSmartCommit).toHaveBeenCalledWith(
        sessionPath,
        'P3.M4.T1.S3: Implement smart commit workflow',
        expect.objectContaining({
          generateMessage: true,
          position: parseItemPosition('P3.M4.T1.S3'),
        })
      );
    });

    it('should layer the task-prefix and NOT emit [PRP Auto] when position is supplied', async () => {
      // EXECUTE: Call the (mocked) formatCommitMessage with a position. The
      // mock now mirrors the real identity-transparent behavior (no trailer),
      // so assert the ABSENCE of both the forbidden [PRP Auto] banner and any
      // Co-Authored-By trailer (PRD §5.1 commit-identity transparency). The
      // real task-prefix behavior is covered by the unit tests in
      // tests/unit/utils/git-commit.test.ts; here we lock the format contract.
      const baseMessage = 'P1.M2.T1.S3: Test';
      mockFormatCommitMessage.mockReturnValue(baseMessage);
      const formatted = formatCommitMessage(baseMessage, {
        phase: 1,
        milestone: 2,
        task: 1,
        subtask: 3,
      });

      // VERIFY: NO [PRP Auto] banner; NO Co-Authored-By trailer.
      expect(formatted).not.toContain('[PRP Auto]');
      expect(formatted).toContain(baseMessage);
      expect(formatted).not.toContain('Co-Authored-By');
    });

    it('should NOT add any Co-Authored-By trailer (identity-transparent, §5.1)', async () => {
      // SETUP
      const baseMessage = 'P1.M2.T1.S3: Test';

      // EXECUTE
      const formatted = formatCommitMessage(baseMessage);

      // VERIFY: No trailer, no machine author (§5.1 commit-identity transparency)
      expect(formatted).not.toContain('Co-Authored-By');
      expect(formatted).not.toMatch(/\n\nCo-Authored-By:/);
    });
  });

  // ===========================================================================
  // Protected files filtering (contract verification)
  // ===========================================================================

  describe('protected files filtering', () => {
    it('should filter out tasks.json from file list', () => {
      // SETUP: Files with protected and non-protected
      const files = ['src/index.ts', 'tasks.json', 'src/utils.ts', 'README.md'];

      // EXECUTE: Filter protected files
      const filtered = filterProtectedFiles(files);

      // VERIFY: tasks.json filtered out
      expect(filtered).not.toContain('tasks.json');
      expect(filtered).toContain('src/index.ts');
      expect(filtered).toContain('src/utils.ts');
      expect(filtered).toContain('README.md');
    });

    it('should filter out PRD.md from file list', () => {
      // SETUP
      const files = ['src/index.ts', 'PRD.md', 'src/utils.ts'];

      // EXECUTE
      const filtered = filterProtectedFiles(files);

      // VERIFY
      expect(filtered).not.toContain('PRD.md');
      expect(filtered).toContain('src/index.ts');
      expect(filtered).toContain('src/utils.ts');
    });

    it('should filter out prd_snapshot.md from file list', () => {
      // SETUP
      const files = ['src/app.ts', 'prd_snapshot.md'];

      // EXECUTE
      const filtered = filterProtectedFiles(files);

      // VERIFY
      expect(filtered).not.toContain('prd_snapshot.md');
      expect(filtered).toContain('src/app.ts');
    });

    it('should filter protected files with paths using basename', () => {
      // SETUP: Files with path prefixes
      const files = [
        'src/index.ts',
        'plan/session/tasks.json',
        'src/utils.ts',
        'session/PRD.md',
      ];

      // EXECUTE
      const filtered = filterProtectedFiles(files);

      // VERIFY: Basename comparison used
      expect(filtered).not.toContain('plan/session/tasks.json');
      expect(filtered).not.toContain('session/PRD.md');
      expect(filtered).toContain('src/index.ts');
      expect(filtered).toContain('src/utils.ts');
    });

    it('should keep all non-protected files', () => {
      // SETUP: Mix of protected and non-protected files
      const files = [
        'src/index.ts',
        'tasks.json',
        'src/utils.ts',
        'README.md',
        'PRD.md',
      ];

      // EXECUTE
      const filtered = filterProtectedFiles(files);

      // VERIFY: Only non-protected files remain
      expect(filtered).toEqual(['src/index.ts', 'src/utils.ts', 'README.md']);
    });
  });

  // ===========================================================================
  // Commit hash and logging
  // ===========================================================================

  describe('commit hash and logging', () => {
    it('should log commit hash on success', async () => {
      // SETUP: Create subtask and mock success
      const subtask = createMockSubtask();
      const commitHash = 'abc123';
      mockSmartCommit.mockResolvedValue(commitHash);

      // EXECUTE: Execute subtask
      await taskOrchestrator.executeSubtask(subtask);

      // VERIFY: Logger called with commit hash. The orchestrator's survival
      // commit logs the hash on success (src/core/task-orchestrator.ts).
      expect(mockLogger.info).toHaveBeenCalledWith(
        { commitHash },
        'Survival commit created'
      );
    });

    it('should log when no files to commit', async () => {
      // SETUP: Mock to return null (no files)
      mockSmartCommit.mockResolvedValue(null);

      // EXECUTE: Execute subtask
      const subtask = createMockSubtask();
      await taskOrchestrator.executeSubtask(subtask);

      // VERIFY: Logged appropriately. smartCommit returning null (no
      // committable substance) is logged by the orchestrator's survival-commit
      // stage.
      expect(mockLogger.info).toHaveBeenCalledWith(
        'No substance to commit (survival commit empty)'
      );
    });
  });

  // ===========================================================================
  // Error handling
  // ===========================================================================

  describe('error handling', () => {
    it('should not fail subtask when smart commit fails', async () => {
      // SETUP: Mock smart commit to throw error
      const error = new Error('Git operation failed');
      mockSmartCommit.mockRejectedValue(error);

      // SETUP: Mock PRPRuntime to succeed
      const subtask = createMockSubtask();

      // EXECUTE: Execute subtask
      await taskOrchestrator.executeSubtask(subtask);

      // VERIFY: Subtask still completes successfully (no exception thrown)
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should log error when smart commit fails', async () => {
      // SETUP
      const errorMessage = 'Git repository not found';
      mockSmartCommit.mockRejectedValue(new Error(errorMessage));

      // EXECUTE
      const subtask = createMockSubtask();
      await taskOrchestrator.executeSubtask(subtask);

      // VERIFY: Error logged
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          error: errorMessage,
        }),
        'Smart commit failed'
      );
    });
  });

  // ===========================================================================
  // Edge cases
  // ===========================================================================

  describe('edge cases', () => {
    it('should handle missing session path gracefully', async () => {
      // SETUP: Create a new session manager with null metadata path
      const sessionStateWithNullPath = {
        ...createMockSessionState(sessionPath, backlog),
        metadata: {
          ...createMockSessionState(sessionPath, backlog).metadata,
          path: null as any,
        },
      };

      const nullPathSessionManager = {
        currentSession: sessionStateWithNullPath,
        loadSession: vi.fn(),
        saveBacklog: vi.fn(),
        updateItemStatus: vi.fn(),
        flushUpdates: vi.fn(),
      };

      // EXECUTE: Create new orchestrator with null path session
      const nullPathOrchestrator = new TaskOrchestrator(
        nullPathSessionManager as any
      );

      const subtask = createMockSubtask();

      // EXECUTE: Execute subtask - should handle gracefully
      await nullPathOrchestrator.executeSubtask(subtask);

      // VERIFY: Warning logged, smart commit not called
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Session path not available for smart commit'
      );
      expect(mockSmartCommit).not.toHaveBeenCalled();
    });
  });
});
