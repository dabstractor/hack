/**
 * Unit tests for FixCycleWorkflow class
 *
 * @remarks
 * Tests validate FixCycleWorkflow class from src/workflows/fix-cycle-workflow.ts
 * with comprehensive coverage. Tests follow the Setup/Execute/Verify pattern.
 *
 * Mocks are used for all external dependencies - no real I/O is performed.
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { readFile, access, constants } from 'node:fs/promises';
import { resolve } from 'node:path';
import { FixCycleWorkflow } from '../../../src/workflows/fix-cycle-workflow.js';
import {
  PARALLEL_RESEARCH,
  RESEARCH_DEPTH,
} from '../../../src/config/constants.js';
import type {
  Task,
  TestResults,
  Bug,
  Backlog,
} from '../../../src/core/models.js';
import type { TaskOrchestrator } from '../../../src/core/task-orchestrator.js';
import type { SessionManager } from '../../../src/core/session-manager.js';

// Mock BugHuntWorkflow
vi.mock('../../../src/workflows/bug-hunt-workflow.js', () => ({
  BugHuntWorkflow: vi.fn().mockImplementation(() => ({
    run: vi.fn(),
  })),
}));

// Mock node:fs/promises
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  access: vi.fn(),
  constants: { F_OK: 0 },
}));

// Import mocked BugHuntWorkflow
import { BugHuntWorkflow } from '../../../src/workflows/bug-hunt-workflow.js';

const mockBugHuntWorkflow = BugHuntWorkflow as any;
const mockedAccess = access as ReturnType<typeof vi.fn>;
const mockedReadFile = readFile as ReturnType<typeof vi.fn>;

// Factory functions for test data
const _createTestTask = (
  id: string,
  title: string,
  status: 'Complete' | 'Failed' | 'Planned' = 'Complete'
): Task => ({
  id,
  type: 'Task',
  title,
  status,
  description: `Description for ${title}`,
  subtasks: [],
});

const createTestBug = (
  id: string,
  severity: 'critical' | 'major' | 'minor' | 'cosmetic',
  title: string,
  description: string,
  reproduction: string,
  location?: string
): Bug => ({
  id,
  severity,
  title,
  description,
  reproduction,
  location,
});

const _createTestResults = (
  hasBugs: boolean,
  bugs: Bug[],
  summary: string,
  recommendations: string[]
): TestResults => ({
  hasBugs,
  bugs,
  summary,
  recommendations,
});

const createMockTaskOrchestrator = (): TaskOrchestrator =>
  ({
    executeSubtask: vi.fn().mockResolvedValue(undefined),
  }) as any;

const createMockSessionManager = (backlog?: Backlog): SessionManager =>
  ({
    currentSession: {
      metadata: {
        id: '001_test',
        hash: 'test123',
        path: 'plan/001_test',
        createdAt: new Date(),
        parentSession: null,
      },
      prdSnapshot: '# Test PRD',
      taskRegistry: backlog ?? { backlog: [] },
      currentItemId: null,
    },
    updateItemStatus: vi.fn().mockResolvedValue(undefined),
  }) as any;

describe('FixCycleWorkflow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Setup default BugHuntWorkflow mock
    mockBugHuntWorkflow.mockImplementation(() => ({
      run: vi.fn().mockResolvedValue({
        hasBugs: false,
        bugs: [],
        summary: 'No bugs found',
        recommendations: [],
      }),
    }));
  });

  describe('constructor', () => {
    it('should throw if sessionPath is empty string', () => {
      // SETUP
      const orchestrator = createMockTaskOrchestrator();
      const sessionManager = createMockSessionManager();

      // EXECUTE & VERIFY
      expect(() => {
        new FixCycleWorkflow('', 'PRD content', orchestrator, sessionManager);
      }).toThrow('requires valid sessionPath');
    });

    it('should throw if sessionPath is whitespace only', () => {
      // SETUP
      const orchestrator = createMockTaskOrchestrator();
      const sessionManager = createMockSessionManager();

      // EXECUTE & VERIFY
      expect(() => {
        new FixCycleWorkflow(
          '   ',
          'PRD content',
          orchestrator,
          sessionManager
        );
      }).toThrow('requires valid sessionPath');
    });

    it('should accept valid non-empty sessionPath string', () => {
      // SETUP
      const orchestrator = createMockTaskOrchestrator();
      const sessionManager = createMockSessionManager();

      // EXECUTE & VERIFY - Should not throw
      expect(() => {
        new FixCycleWorkflow(
          'plan/003_b3d3efdaf0ed/bugfix/001_d5507a871918',
          'PRD content',
          orchestrator,
          sessionManager
        );
      }).not.toThrow();
    });

    it('should initialize with provided values', () => {
      // SETUP
      const sessionPath = 'plan/003_b3d3efdaf0ed/bugfix/001_d5507a871918';
      const prdContent = '# PRD Content';
      const orchestrator = createMockTaskOrchestrator();
      const sessionManager = createMockSessionManager();

      // EXECUTE
      const workflow = new FixCycleWorkflow(
        sessionPath,
        prdContent,
        orchestrator,
        sessionManager
      );

      // VERIFY
      expect(workflow.sessionPath).toBe(sessionPath);
      expect(workflow.prdContent).toBe(prdContent);
      expect(workflow.taskOrchestrator).toBe(orchestrator);
      expect(workflow.sessionManager).toBe(sessionManager);
      expect(workflow.iteration).toBe(0);
      expect(workflow.maxIterations).toBe(3);
      expect(workflow.currentResults).toBeNull();
    });
  });

  describe('createFixTasks', () => {
    it('should convert bugs to fix subtasks with correct format', async () => {
      // SETUP
      const testResults: TestResults = {
        hasBugs: true,
        bugs: [
          createTestBug(
            'BUG-001',
            'critical',
            'Login bug',
            'Critical login failure',
            '1. Go to login\n2. Enter bad password',
            'src/auth/login.ts:45'
          ),
          createTestBug(
            'BUG-002',
            'major',
            'Validation error',
            'Form validation fails',
            '1. Open form\n2. Submit empty'
          ),
        ],
        summary: 'Found 2 bugs',
        recommendations: [],
      };

      // Mock file operations for loadBugReport
      mockedAccess.mockResolvedValue(undefined);
      mockedReadFile.mockResolvedValue(JSON.stringify(testResults));

      const orchestrator = createMockTaskOrchestrator();
      const sessionManager = createMockSessionManager();

      const workflow = new FixCycleWorkflow(
        'plan/003_b3d3efdaf0ed/bugfix/001_d5507a871918',
        'PRD content',
        orchestrator,
        sessionManager
      );

      // Load test results first (populates this.#testResults)
      await workflow._loadBugReportForTesting();

      // EXECUTE
      await workflow.createFixTasks();

      // VERIFY - Use test-only getter
      const fixTasks = workflow._fixTasksForTesting;

      expect(fixTasks).toHaveLength(2);

      // First bug
      expect(fixTasks[0].id).toBe('PFIX.M1.T001.S1');
      expect(fixTasks[0].title).toContain('[BUG FIX]');
      expect(fixTasks[0].title).toContain('Login bug');
      expect(fixTasks[0].status).toBe('Planned');
      expect(fixTasks[0].story_points).toBe(13); // critical = 13
      expect(fixTasks[0].dependencies).toEqual([]);
      expect(fixTasks[0].context_scope).toContain('BUG-001');
      expect(fixTasks[0].context_scope).toContain('src/auth/login.ts:45');

      // Second bug
      expect(fixTasks[1].id).toBe('PFIX.M1.T002.S1');
      expect(fixTasks[1].story_points).toBe(8); // major = 8
    });

    it('should map severity to correct story points', async () => {
      // SETUP
      const testResults: TestResults = {
        hasBugs: true,
        bugs: [
          createTestBug(
            'BUG-001',
            'critical',
            'Critical bug',
            'Critical',
            'Repro'
          ),
          createTestBug('BUG-002', 'major', 'Major bug', 'Major', 'Repro'),
          createTestBug('BUG-003', 'minor', 'Minor bug', 'Minor', 'Repro'),
          createTestBug(
            'BUG-004',
            'cosmetic',
            'Cosmetic bug',
            'Cosmetic',
            'Repro'
          ),
        ],
        summary: 'Found 4 bugs',
        recommendations: [],
      };

      // Mock file operations for loadBugReport
      mockedAccess.mockResolvedValue(undefined);
      mockedReadFile.mockResolvedValue(JSON.stringify(testResults));

      const orchestrator = createMockTaskOrchestrator();
      const sessionManager = createMockSessionManager();

      const workflow = new FixCycleWorkflow(
        'plan/003_b3d3efdaf0ed/bugfix/001_d5507a871918',
        'PRD content',
        orchestrator,
        sessionManager
      );

      // Load test results first
      await workflow._loadBugReportForTesting();

      // EXECUTE
      await workflow.createFixTasks();

      // VERIFY
      const fixTasks = workflow._fixTasksForTesting;

      expect(fixTasks[0].story_points).toBe(13); // critical
      expect(fixTasks[1].story_points).toBe(8); // major
      expect(fixTasks[2].story_points).toBe(3); // minor
      expect(fixTasks[3].story_points).toBe(1); // cosmetic
    });

    it('should handle bugs without location field', async () => {
      // SETUP
      const testResults: TestResults = {
        hasBugs: true,
        bugs: [
          createTestBug(
            'BUG-001',
            'minor',
            'Bug without location',
            'Description',
            'Repro'
            // location is undefined
          ),
        ],
        summary: 'Found 1 bug',
        recommendations: [],
      };

      // Mock file operations for loadBugReport
      mockedAccess.mockResolvedValue(undefined);
      mockedReadFile.mockResolvedValue(JSON.stringify(testResults));

      const orchestrator = createMockTaskOrchestrator();
      const sessionManager = createMockSessionManager();

      const workflow = new FixCycleWorkflow(
        'plan/003_b3d3efdaf0ed/bugfix/001_d5507a871918',
        'PRD content',
        orchestrator,
        sessionManager
      );

      // Load test results first
      await workflow._loadBugReportForTesting();

      // EXECUTE
      await workflow.createFixTasks();

      // VERIFY
      const fixTasks = workflow._fixTasksForTesting;

      expect(fixTasks[0].context_scope).toContain('Not specified');
    });
  });

  describe('executeFixes', () => {
    it('should execute all fix tasks via orchestrator', async () => {
      // SETUP
      const testResults: TestResults = {
        hasBugs: true,
        bugs: [
          createTestBug('BUG-001', 'critical', 'Bug 1', 'Description', 'Repro'),
          createTestBug('BUG-002', 'major', 'Bug 2', 'Description', 'Repro'),
        ],
        summary: 'Found 2 bugs',
        recommendations: [],
      };

      // Mock file operations for loadBugReport
      mockedAccess.mockResolvedValue(undefined);
      mockedReadFile.mockResolvedValue(JSON.stringify(testResults));

      const mockOrchestrator = createMockTaskOrchestrator();
      const sessionManager = createMockSessionManager();

      const workflow = new FixCycleWorkflow(
        'plan/003_b3d3efdaf0ed/bugfix/001_d5507a871918',
        'PRD content',
        mockOrchestrator,
        sessionManager
      );

      // Load test results and create fix tasks first
      await workflow._loadBugReportForTesting();
      await workflow.createFixTasks();

      // EXECUTE
      await workflow.executeFixes();

      // VERIFY
      expect(mockOrchestrator.executeSubtask).toHaveBeenCalledTimes(2);
    });

    it('should continue on individual fix failures', async () => {
      // SETUP
      const testResults: TestResults = {
        hasBugs: true,
        bugs: [
          createTestBug('BUG-001', 'critical', 'Bug 1', 'Description', 'Repro'),
          createTestBug('BUG-002', 'major', 'Bug 2', 'Description', 'Repro'),
        ],
        summary: 'Found 2 bugs',
        recommendations: [],
      };

      // Mock file operations for loadBugReport
      mockedAccess.mockResolvedValue(undefined);
      mockedReadFile.mockResolvedValue(JSON.stringify(testResults));

      const mockOrchestrator: TaskOrchestrator = {
        executeSubtask: vi
          .fn()
          .mockRejectedValueOnce(new Error('Fix failed'))
          .mockResolvedValueOnce(undefined),
      } as any;
      const sessionManager = createMockSessionManager();

      const workflow = new FixCycleWorkflow(
        'plan/003_b3d3efdaf0ed/bugfix/001_d5507a871918',
        'PRD content',
        mockOrchestrator,
        sessionManager
      );

      await workflow._loadBugReportForTesting();
      await workflow.createFixTasks();

      // EXECUTE - Should not throw
      await workflow.executeFixes();

      // VERIFY - Both should be called (second one after first failed)
      expect(mockOrchestrator.executeSubtask).toHaveBeenCalledTimes(2);
    });
  });

  describe('checkComplete', () => {
    it('should return false if critical bugs remain', async () => {
      // SETUP
      const testResults: TestResults = {
        hasBugs: true,
        bugs: [
          createTestBug(
            'BUG-001',
            'critical',
            'Critical bug',
            'Description',
            'Repro'
          ),
        ],
        summary: 'Found critical bug',
        recommendations: [],
      };
      const orchestrator = createMockTaskOrchestrator();
      const sessionManager = createMockSessionManager();

      const workflow = new FixCycleWorkflow(
        'plan/003_b3d3efdaf0ed/bugfix/001_d5507a871918',
        'PRD content',
        orchestrator,
        sessionManager
      );

      // Set currentResults with critical bug
      (workflow as any).currentResults = testResults;

      // EXECUTE
      const complete = await workflow.checkComplete();

      // VERIFY
      expect(complete).toBe(false);
    });

    it('should return false if major bugs remain', async () => {
      // SETUP
      const testResults: TestResults = {
        hasBugs: true,
        bugs: [
          createTestBug(
            'BUG-001',
            'major',
            'Major bug',
            'Description',
            'Repro'
          ),
        ],
        summary: 'Found major bug',
        recommendations: [],
      };
      const orchestrator = createMockTaskOrchestrator();
      const sessionManager = createMockSessionManager();

      const workflow = new FixCycleWorkflow(
        'plan/003_b3d3efdaf0ed/bugfix/001_d5507a871918',
        'PRD content',
        orchestrator,
        sessionManager
      );

      (workflow as any).currentResults = testResults;

      // EXECUTE
      const complete = await workflow.checkComplete();

      // VERIFY
      expect(complete).toBe(false);
    });

    it('should return true if only minor bugs remain', async () => {
      // SETUP
      const testResults: TestResults = {
        hasBugs: true,
        bugs: [
          createTestBug(
            'BUG-002',
            'minor',
            'Minor bug',
            'Description',
            'Repro'
          ),
        ],
        summary: 'Found minor bug',
        recommendations: [],
      };
      const orchestrator = createMockTaskOrchestrator();
      const sessionManager = createMockSessionManager();

      const workflow = new FixCycleWorkflow(
        'plan/003_b3d3efdaf0ed/bugfix/001_d5507a871918',
        'PRD content',
        orchestrator,
        sessionManager
      );

      (workflow as any).currentResults = testResults;

      // EXECUTE
      const complete = await workflow.checkComplete();

      // VERIFY
      expect(complete).toBe(true);
    });

    it('should return true if only cosmetic bugs remain', async () => {
      // SETUP
      const testResults: TestResults = {
        hasBugs: true,
        bugs: [
          createTestBug(
            'BUG-003',
            'cosmetic',
            'Cosmetic bug',
            'Description',
            'Repro'
          ),
        ],
        summary: 'Found cosmetic bug',
        recommendations: [],
      };
      const orchestrator = createMockTaskOrchestrator();
      const sessionManager = createMockSessionManager();

      const workflow = new FixCycleWorkflow(
        'plan/003_b3d3efdaf0ed/bugfix/001_d5507a871918',
        'PRD content',
        orchestrator,
        sessionManager
      );

      (workflow as any).currentResults = testResults;

      // EXECUTE
      const complete = await workflow.checkComplete();

      // VERIFY
      expect(complete).toBe(true);
    });

    it('should return true if no bugs remain', async () => {
      // SETUP - Need initial bugs for constructor validation
      const initialResults: TestResults = {
        hasBugs: true,
        bugs: [
          createTestBug(
            'BUG-001',
            'critical',
            'Critical bug',
            'Description',
            'Repro'
          ),
        ],
        summary: 'Found bug',
        recommendations: [],
      };

      const noBugsResults: TestResults = {
        hasBugs: false,
        bugs: [],
        summary: 'No bugs found',
        recommendations: [],
      };

      const orchestrator = createMockTaskOrchestrator();
      const sessionManager = createMockSessionManager();

      const workflow = new FixCycleWorkflow(
        'plan/003_b3d3efdaf0ed/bugfix/001_d5507a871918',
        'PRD content',
        orchestrator,
        sessionManager
      );

      // Set currentResults to no bugs (simulating after retest)
      (workflow as any).currentResults = noBugsResults;

      // EXECUTE
      const complete = await workflow.checkComplete();

      // VERIFY
      expect(complete).toBe(true);
    });

    it('should return false if currentResults is null', async () => {
      // SETUP
      const testResults: TestResults = {
        hasBugs: true,
        bugs: [
          createTestBug(
            'BUG-001',
            'critical',
            'Critical bug',
            'Description',
            'Repro'
          ),
        ],
        summary: 'Found bug',
        recommendations: [],
      };
      const orchestrator = createMockTaskOrchestrator();
      const sessionManager = createMockSessionManager();

      const workflow = new FixCycleWorkflow(
        'plan/003_b3d3efdaf0ed/bugfix/001_d5507a871918',
        'PRD content',
        orchestrator,
        sessionManager
      );

      // currentResults is null (initial state)

      // EXECUTE
      const complete = await workflow.checkComplete();

      // VERIFY
      expect(complete).toBe(false);
    });
  });

  describe('loadBugReport', () => {
    const sessionPath = 'plan/003_b3d3efdaf0ed/bugfix/001_d5507a871918';

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should successfully load valid TEST_RESULTS.md', async () => {
      // SETUP
      const mockTestResults: TestResults = {
        hasBugs: true,
        bugs: [
          createTestBug(
            'BUG-001',
            'critical',
            'Login bug',
            'Critical login failure',
            '1. Go to login\n2. Enter bad password',
            'src/auth/login.ts:45'
          ),
        ],
        summary: 'Found 1 critical bug',
        recommendations: ['Fix login validation'],
      };

      mockedAccess.mockResolvedValue(undefined);
      mockedReadFile.mockResolvedValue(JSON.stringify(mockTestResults));

      const orchestrator = createMockTaskOrchestrator();
      const sessionManager = createMockSessionManager();
      const workflow = new FixCycleWorkflow(
        sessionPath,
        'PRD content',
        orchestrator,
        sessionManager
      );

      // EXECUTE - Use test-only getter
      const result = await workflow._loadBugReportForTesting();

      // VERIFY
      expect(mockedAccess).toHaveBeenCalledWith(
        resolve(sessionPath, 'TEST_RESULTS.md'),
        constants.F_OK
      );
      expect(mockedReadFile).toHaveBeenCalledWith(
        resolve(sessionPath, 'TEST_RESULTS.md'),
        'utf-8'
      );
      expect(result).toEqual(mockTestResults);
      expect(result.hasBugs).toBe(true);
      expect(result.bugs).toHaveLength(1);
      expect(result.bugs[0].id).toBe('BUG-001');
    });

    it('should throw error if TEST_RESULTS.md not found', async () => {
      // SETUP
      const enoentError: NodeJS.ErrnoException = new Error(
        'File not found'
      ) as NodeJS.ErrnoException;
      enoentError.code = 'ENOENT';

      mockedAccess.mockRejectedValue(enoentError);

      const orchestrator = createMockTaskOrchestrator();
      const sessionManager = createMockSessionManager();
      const workflow = new FixCycleWorkflow(
        sessionPath,
        'PRD content',
        orchestrator,
        sessionManager
      );

      // EXECUTE & VERIFY
      await expect(workflow._loadBugReportForTesting()).rejects.toThrow(
        `TEST_RESULTS.md not found at ${resolve(sessionPath, 'TEST_RESULTS.md')}`
      );

      expect(mockedAccess).toHaveBeenCalledWith(
        resolve(sessionPath, 'TEST_RESULTS.md'),
        constants.F_OK
      );
      expect(mockedReadFile).not.toHaveBeenCalled();
    });

    it('should throw error if JSON parsing fails', async () => {
      // SETUP
      mockedAccess.mockResolvedValue(undefined);
      mockedReadFile.mockResolvedValue('invalid json {{{');

      const orchestrator = createMockTaskOrchestrator();
      const sessionManager = createMockSessionManager();
      const workflow = new FixCycleWorkflow(
        sessionPath,
        'PRD content',
        orchestrator,
        sessionManager
      );

      // EXECUTE & VERIFY
      await expect(workflow._loadBugReportForTesting()).rejects.toThrow(
        `Failed to parse TEST_RESULTS.md at ${resolve(sessionPath, 'TEST_RESULTS.md')}`
      );

      expect(mockedAccess).toHaveBeenCalledWith(
        resolve(sessionPath, 'TEST_RESULTS.md'),
        constants.F_OK
      );
      expect(mockedReadFile).toHaveBeenCalledWith(
        resolve(sessionPath, 'TEST_RESULTS.md'),
        'utf-8'
      );
    });

    it('should throw error if Zod validation fails', async () => {
      // SETUP
      const invalidTestResults = {
        hasBugs: true,
        bugs: [
          createTestBug(
            'BUG-001',
            'critical',
            'Login bug',
            'Critical login failure',
            '1. Go to login\n2. Enter bad password',
            'src/auth/login.ts:45'
          ),
        ],
        // Missing required 'summary' field
        recommendations: [],
      };

      mockedAccess.mockResolvedValue(undefined);
      mockedReadFile.mockResolvedValue(JSON.stringify(invalidTestResults));

      const orchestrator = createMockTaskOrchestrator();
      const sessionManager = createMockSessionManager();
      const workflow = new FixCycleWorkflow(
        sessionPath,
        'PRD content',
        orchestrator,
        sessionManager
      );

      // EXECUTE & VERIFY
      await expect(workflow._loadBugReportForTesting()).rejects.toThrow(
        `Invalid TestResults in TEST_RESULTS.md at ${resolve(sessionPath, 'TEST_RESULTS.md')}`
      );

      expect(mockedAccess).toHaveBeenCalled();
      expect(mockedReadFile).toHaveBeenCalled();
    });
  });

  describe('run loop', () => {
    it('should loop until complete (1 iteration)', async () => {
      // SETUP - Mock BugHuntWorkflow to return bugs first, then no bugs
      const mockBugHuntInstance = {
        run: vi
          .fn()
          .mockResolvedValueOnce({
            hasBugs: false,
            bugs: [],
            summary: 'No bugs found',
            recommendations: [],
          })
          .mockResolvedValueOnce({
            hasBugs: false,
            bugs: [],
            summary: 'No bugs found',
            recommendations: [],
          }),
      };

      mockBugHuntWorkflow.mockImplementation(() => mockBugHuntInstance);

      const testResults: TestResults = {
        hasBugs: true,
        bugs: [
          createTestBug(
            'BUG-001',
            'critical',
            'Critical bug',
            'Description',
            'Repro'
          ),
        ],
        summary: 'Found bug',
        recommendations: [],
      };

      // Mock file operations for loadBugReport
      mockedAccess.mockResolvedValue(undefined);
      mockedReadFile.mockResolvedValue(JSON.stringify(testResults));

      const mockOrchestrator = createMockTaskOrchestrator();
      const sessionManager = createMockSessionManager();

      const workflow = new FixCycleWorkflow(
        'plan/003_b3d3efdaf0ed/bugfix/001_d5507a871918',
        'PRD content',
        mockOrchestrator,
        sessionManager
      );

      // EXECUTE
      const results = await workflow.run();

      // VERIFY
      expect(workflow.iteration).toBe(1);
      expect(results.hasBugs).toBe(false);
      expect(workflow.status).toBe('completed');
    });

    it('should stop at max iterations', async () => {
      // SETUP - Mock BugHuntWorkflow to always return bugs
      const mockBugHuntInstance = {
        run: vi.fn().mockResolvedValue({
          hasBugs: true,
          bugs: [
            createTestBug(
              'BUG-001',
              'critical',
              'Critical bug',
              'Description',
              'Repro'
            ),
          ],
          summary: 'Still has bugs',
          recommendations: [],
        }),
      };

      mockBugHuntWorkflow.mockImplementation(() => mockBugHuntInstance);

      const testResults: TestResults = {
        hasBugs: true,
        bugs: [
          createTestBug(
            'BUG-001',
            'critical',
            'Critical bug',
            'Description',
            'Repro'
          ),
        ],
        summary: 'Found bug',
        recommendations: [],
      };

      // Mock file operations for loadBugReport
      mockedAccess.mockResolvedValue(undefined);
      mockedReadFile.mockResolvedValue(JSON.stringify(testResults));

      const mockOrchestrator = createMockTaskOrchestrator();
      const sessionManager = createMockSessionManager();

      const workflow = new FixCycleWorkflow(
        'plan/003_b3d3efdaf0ed/bugfix/001_d5507a871918',
        'PRD content',
        mockOrchestrator,
        sessionManager
      );

      // Override maxIterations for faster test
      (workflow as any).maxIterations = 2;

      // EXECUTE
      const results = await workflow.run();

      // VERIFY
      expect(workflow.iteration).toBe(2);
      expect(results.hasBugs).toBe(true);
      expect(mockBugHuntInstance.run).toHaveBeenCalledTimes(2);
    });
  });

  describe('research config forwarding', () => {
    const validBugfixPath = 'plan/003_b3d3efdaf0ed/bugfix/001_d5507a871918';

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('stores forwarded researchConfig and applies it to process.env', () => {
      // SETUP - clear env so the constructor's write is observable
      vi.stubEnv(PARALLEL_RESEARCH, '');
      vi.stubEnv(RESEARCH_DEPTH, '');
      const orchestrator = createMockTaskOrchestrator();
      const sessionManager = createMockSessionManager();

      // EXECUTE
      const workflow = new FixCycleWorkflow(
        validBugfixPath,
        'PRD content',
        orchestrator,
        sessionManager,
        { parallelResearch: true, researchDepth: 3 }
      );

      // VERIFY
      expect(workflow.researchConfig).toEqual({
        parallelResearch: true,
        researchDepth: 3,
      });
      expect(process.env[PARALLEL_RESEARCH]).toBe('true');
      expect(process.env[RESEARCH_DEPTH]).toBe('3');
    });

    it("writes 'false' to env when parallelResearch is false (ternary false-branch)", () => {
      // SETUP
      vi.stubEnv(PARALLEL_RESEARCH, '');
      vi.stubEnv(RESEARCH_DEPTH, '');
      const orchestrator = createMockTaskOrchestrator();
      const sessionManager = createMockSessionManager();

      // EXECUTE
      const workflow = new FixCycleWorkflow(
        validBugfixPath,
        'PRD content',
        orchestrator,
        sessionManager,
        { parallelResearch: false, researchDepth: 2 }
      );

      // VERIFY
      expect(workflow.researchConfig).toEqual({
        parallelResearch: false,
        researchDepth: 2,
      });
      expect(process.env[PARALLEL_RESEARCH]).toBe('false');
      expect(process.env[RESEARCH_DEPTH]).toBe('2');
    });

    it('leaves researchConfig null and env UNCHANGED when 5th arg omitted', () => {
      // SETUP - capture env values BEFORE construction
      const parallelBefore = process.env[PARALLEL_RESEARCH];
      const depthBefore = process.env[RESEARCH_DEPTH];
      const orchestrator = createMockTaskOrchestrator();
      const sessionManager = createMockSessionManager();

      // EXECUTE - legacy 4-arg call (no researchConfig)
      const workflow = new FixCycleWorkflow(
        validBugfixPath,
        'PRD content',
        orchestrator,
        sessionManager
      );

      // VERIFY - no env mutation, field is null
      expect(workflow.researchConfig).toBeNull();
      expect(process.env[PARALLEL_RESEARCH]).toBe(parallelBefore);
      expect(process.env[RESEARCH_DEPTH]).toBe(depthBefore);
    });
  });
});
