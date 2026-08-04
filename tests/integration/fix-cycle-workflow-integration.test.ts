/**
 * Integration tests for FixCycleWorkflow class
 *
 * @remarks
 * Tests validate end-to-end FixCycleWorkflow workflow execution.
 * BugHuntWorkflow and TaskOrchestrator are mocked to avoid external
 * dependencies while preserving full workflow orchestration testing.
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FixCycleWorkflow } from '../../src/workflows/fix-cycle-workflow.js';
import type { Task, TestResults, Bug, Backlog } from '../../src/core/models.js';
import type { TaskOrchestrator } from '../../src/core/task-orchestrator.js';
import type { SessionManager } from '../../src/core/session-manager.js';

// Mock BugHuntWorkflow
vi.mock('../../src/workflows/bug-hunt-workflow.js', () => ({
  BugHuntWorkflow: vi.fn(),
}));

// Mock the architect agent leaf (BUG-004 category (a) seam). FixCycleWorkflow's
// runStandardBreakdown dynamically imports + calls createArchitectAgent, which
// is harness-backed (would throw 'PiHarness not initialized'). This suite's
// subject is the fix-cycle loop, NOT architect decomposition — stub a success.
vi.mock('../../src/agents/agent-factory.js', () => ({
  createArchitectAgent: vi.fn().mockReturnValue({
    prompt: vi.fn().mockResolvedValue({
      status: 'success',
      data: '{}',
      error: null,
      metadata: { agentId: 'mock-architect', timestamp: 0 },
    }),
  }),
}));

import { BugHuntWorkflow } from '../../src/workflows/bug-hunt-workflow.js';

const mockBugHuntWorkflow = BugHuntWorkflow as any;

// Factory functions for test data
const createTestTask = (
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

const createTestResults = (
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

const createMockTaskOrchestrator = (
  executeFn?: () => Promise<void>
): TaskOrchestrator =>
  ({
    executeSubtask: executeFn ?? vi.fn().mockResolvedValue(undefined),
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
      taskRegistry:
        backlog ??
        ({
          backlog: [
            {
              id: 'P1',
              type: 'Phase',
              title: 'Phase 1',
              status: 'Complete',
              description: 'Test phase',
              milestones: [
                {
                  id: 'P1.M1',
                  type: 'Milestone',
                  title: 'Milestone 1',
                  status: 'Complete',
                  description: 'Test milestone',
                  tasks: [
                    createTestTask('P1.M1.T1', 'Task 1', 'Complete'),
                    createTestTask('P1.M1.T2', 'Task 2', 'Complete'),
                  ],
                },
              ],
            },
          ],
        } as Backlog),
      currentItemId: null,
    },
    updateItemStatus: vi.fn().mockResolvedValue(undefined),
  }) as any;

/**
 * Create a real bugfix session dir on disk containing:
 *  - TEST_RESULTS.md (the JSON-serialized bug report #loadBugReport reads), and
 *  - tasks.json (the Backlog the Architect agent would write; #runStandardBreakdown
 *    reads it back and flattens to leaf subtasks).
 * Returns the sessionPath, which contains the 'bugfix' substring
 * validateBugfixSession() requires. Produces one leaf subtask per bug so the
 * fix-execution phase runs once per bug (matching the suite's existing
 * executeSubtask call-count expectations). The dir is tracked for cleanup.
 */
function setupBugfixSession(results: TestResults): string {
  const tempDir = mkdtempSync(join(tmpdir(), 'fix-cycle-test-'));
  const sessionPath = join(tempDir, 'plan', '001_test', 'bugfix', '001_test');
  mkdirSync(sessionPath, { recursive: true });
  writeFileSync(
    join(sessionPath, 'TEST_RESULTS.md'),
    JSON.stringify(results),
    'utf-8'
  );
  // Minimal valid context_scope (src/core/models.ts superRefine requires the
  // 'CONTRACT DEFINITION:\n' prefix + 4 ordered sections).
  const contextScope =
    'CONTRACT DEFINITION:\n1. RESEARCH NOTE: none\n2. INPUT: none\n3. LOGIC: none\n4. OUTPUT: none';
  const subtasks = results.bugs.map((bug, i) => ({
    type: 'Subtask' as const,
    id: `PFIX.M1.T1.S${i + 1}`,
    title: `[BUG FIX] Fix ${bug.id}: ${bug.title}`,
    status: 'Planned' as const,
    story_points: 1,
    dependencies: [],
    context_scope: contextScope,
  }));
  const backlog: Backlog = {
    backlog: [
      {
        type: 'Phase',
        id: 'PFIX',
        title: 'Bug Fix Phase',
        status: 'Planned',
        description: 'Fixes derived from the bug report',
        milestones: [
          {
            type: 'Milestone',
            id: 'PFIX.M1',
            title: 'Bug Fix Milestone',
            status: 'Planned',
            description: 'Fix milestone',
            tasks: [
              {
                type: 'Task',
                id: 'PFIX.M1.T1',
                title: 'Bug Fix Task',
                status: 'Planned',
                description: 'Fix task',
                subtasks,
              },
            ],
          },
        ],
      },
    ],
  };
  writeFileSync(
    join(sessionPath, 'tasks.json'),
    JSON.stringify(backlog),
    'utf-8'
  );
  bugfixTempDirs.push(tempDir);
  return sessionPath;
}

const bugfixTempDirs: string[] = [];

describe('FixCycleWorkflow Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    while (bugfixTempDirs.length) {
      const dir = bugfixTempDirs.pop()!;
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    }
  });

  describe('full run() workflow execution', () => {
    it('should complete fix cycle successfully when bugs are resolved in one iteration', async () => {
      // SETUP: Create test data with critical bugs
      const initialBugs: Bug[] = [
        createTestBug(
          'BUG-001',
          'critical',
          'Login validation fails',
          'Empty password causes crash',
          '1. Go to /login\n2. Leave password empty\n3. Click Submit',
          'src/auth/login.ts:45'
        ),
        createTestBug(
          'BUG-002',
          'major',
          'Form validation missing',
          'Form submits with invalid data',
          '1. Open form\n2. Submit empty fields',
          'src/components/form.ts:20'
        ),
      ];

      const initialResults = createTestResults(
        true,
        initialBugs,
        'Found 2 bugs (1 critical, 1 major)',
        ['Add password validation', 'Add form validation']
      );

      // Mock BugHuntWorkflow to return no bugs after fix (success case)
      const mockBugHuntInstance = {
        run: vi
          .fn()
          .mockResolvedValueOnce(
            createTestResults(false, [], 'All bugs fixed - no issues found', [])
          ),
      };

      mockBugHuntWorkflow.mockImplementation(() => mockBugHuntInstance);

      const mockOrchestrator = createMockTaskOrchestrator();
      const sessionManager = createMockSessionManager();

      // EXECUTE
      const workflow = new FixCycleWorkflow(
        setupBugfixSession(initialResults),
        '# Test PRD',
        mockOrchestrator,
        sessionManager
      );

      const finalResults = await workflow.run();

      // VERIFY
      expect(workflow.iteration).toBe(1);
      expect(finalResults.hasBugs).toBe(false);
      expect(finalResults.bugs).toHaveLength(0);
      expect(workflow.status).toBe('completed');
      expect(mockOrchestrator.executeSubtask).toHaveBeenCalledTimes(2); // 2 bugs
      expect(mockBugHuntInstance.run).toHaveBeenCalledTimes(1);
    });

    it('should iterate until max iterations when bugs persist', async () => {
      // SETUP: Create test data with persistent bugs
      const persistentBug = createTestBug(
        'BUG-001',
        'critical',
        'Persistent bug',
        'This bug cannot be fixed',
        '1. Try to fix\n2. Bug still there'
      );

      const initialResults = createTestResults(
        true,
        [persistentBug],
        'Found 1 critical bug',
        []
      );

      // Mock BugHuntWorkflow to always return bugs (simulating persistent issues)
      const mockBugHuntInstance = {
        run: vi
          .fn()
          .mockResolvedValue(
            createTestResults(
              true,
              [persistentBug],
              'Bug still present after fix attempt',
              []
            )
          ),
      };

      mockBugHuntWorkflow.mockImplementation(() => mockBugHuntInstance);

      const mockOrchestrator = createMockTaskOrchestrator();
      const sessionManager = createMockSessionManager();

      // EXECUTE
      const workflow = new FixCycleWorkflow(
        setupBugfixSession(initialResults),
        '# Test PRD',
        mockOrchestrator,
        sessionManager
      );

      // Override maxIterations for faster test
      (workflow as any).maxIterations = 2;

      const finalResults = await workflow.run();

      // VERIFY
      expect(workflow.iteration).toBe(2); // Max iterations reached
      expect(finalResults.hasBugs).toBe(true);
      expect(finalResults.bugs).toHaveLength(1);
      expect(mockBugHuntInstance.run).toHaveBeenCalledTimes(2);
      expect(mockOrchestrator.executeSubtask).toHaveBeenCalledTimes(2); // 1 bug × 2 iterations
    });

    it('should stop iteration when only minor/cosmetic bugs remain', async () => {
      // SETUP: Start with critical bug, end with only minor bugs
      const initialBugs: Bug[] = [
        createTestBug(
          'BUG-001',
          'critical',
          'Critical bug',
          'Critical issue',
          'Repro'
        ),
      ];

      const initialResults = createTestResults(
        true,
        initialBugs,
        'Found 1 critical bug',
        []
      );

      // Mock BugHuntWorkflow to return only minor bugs after fix
      const mockBugHuntInstance = {
        run: vi
          .fn()
          .mockResolvedValue(
            createTestResults(
              true,
              [
                createTestBug(
                  'BUG-002',
                  'minor',
                  'Typo in error message',
                  'Minor typo',
                  'N/A'
                ),
              ],
              'Only minor issues remain',
              []
            )
          ),
      };

      mockBugHuntWorkflow.mockImplementation(() => mockBugHuntInstance);

      const mockOrchestrator = createMockTaskOrchestrator();
      const sessionManager = createMockSessionManager();

      // EXECUTE
      const workflow = new FixCycleWorkflow(
        setupBugfixSession(initialResults),
        '# Test PRD',
        mockOrchestrator,
        sessionManager
      );

      const finalResults = await workflow.run();

      // VERIFY
      expect(workflow.iteration).toBe(1);
      expect(finalResults.hasBugs).toBe(true); // Still has bugs
      expect(finalResults.bugs).toHaveLength(1);
      expect(finalResults.bugs[0].severity).toBe('minor'); // Only minor bugs
      expect(workflow.status).toBe('completed');
    });

    it('should handle individual fix failures gracefully', async () => {
      // SETUP: Create test data where one fix fails
      const bugs: Bug[] = [
        createTestBug(
          'BUG-001',
          'critical',
          'Fixable bug',
          'Can be fixed',
          'Repro'
        ),
        createTestBug(
          'BUG-002',
          'major',
          'Unfixable bug',
          'Will fail',
          'Repro'
        ),
      ];

      const initialResults = createTestResults(true, bugs, 'Found 2 bugs', []);

      // Mock orchestrator where second fix fails
      let callCount = 0;
      const mockOrchestrator: TaskOrchestrator = {
        executeSubtask: vi.fn().mockImplementation(async () => {
          callCount++;
          if (callCount === 2) {
            throw new Error('Fix failed for BUG-002');
          }
        }),
      } as any;

      // Mock BugHuntWorkflow to return no bugs after first iteration
      // (simulating that the first fix worked even though second failed)
      const mockBugHuntInstance = {
        run: vi
          .fn()
          .mockResolvedValueOnce(
            createTestResults(false, [], 'No bugs found - first fix worked', [])
          ),
      };

      mockBugHuntWorkflow.mockImplementation(() => mockBugHuntInstance);

      const sessionManager = createMockSessionManager();

      // EXECUTE - Should not throw despite fix failure
      const workflow = new FixCycleWorkflow(
        setupBugfixSession(initialResults),
        '# Test PRD',
        mockOrchestrator,
        sessionManager
      );

      const finalResults = await workflow.run();

      // VERIFY - Workflow completes despite fix failure
      expect(finalResults.hasBugs).toBe(false);
      expect(mockOrchestrator.executeSubtask).toHaveBeenCalledTimes(2);
    });

    it('should correctly extract completed tasks from backlog', async () => {
      // SETUP: Create backlog with mix of complete and incomplete tasks
      const backlog: Backlog = {
        backlog: [
          {
            id: 'P1',
            type: 'Phase',
            title: 'Phase 1',
            status: 'Complete',
            description: 'Test phase',
            milestones: [
              {
                id: 'P1.M1',
                type: 'Milestone',
                title: 'Milestone 1',
                status: 'Complete',
                description: 'Test milestone',
                tasks: [
                  createTestTask('P1.M1.T1', 'Complete Task', 'Complete'),
                  createTestTask('P1.M1.T2', 'Planned Task', 'Planned'),
                  createTestTask('P1.M1.T3', 'Another Complete', 'Complete'),
                ],
              },
            ],
          },
        ],
      };

      const initialResults = createTestResults(
        true,
        [createTestBug('BUG-001', 'critical', 'Bug', 'Desc', 'Repro')],
        'Found bug',
        []
      );

      const mockBugHuntInstance = {
        run: vi
          .fn()
          .mockResolvedValue(createTestResults(false, [], 'No bugs', [])),
      };

      mockBugHuntWorkflow.mockImplementation(() => mockBugHuntInstance);

      const mockOrchestrator = createMockTaskOrchestrator();
      const sessionManager = createMockSessionManager(backlog);

      // EXECUTE
      const workflow = new FixCycleWorkflow(
        setupBugfixSession(initialResults),
        '# Test PRD',
        mockOrchestrator,
        sessionManager
      );

      await workflow.run();

      // VERIFY - BugHuntWorkflow should be called with only completed tasks
      expect(mockBugHuntWorkflow).toHaveBeenCalledWith(
        '# Test PRD',
        expect.any(Array)
      );

      const completedTasksArg = mockBugHuntWorkflow.mock.calls[0][1];
      expect(completedTasksArg).toHaveLength(2);
      expect(completedTasksArg[0].id).toBe('P1.M1.T1');
      expect(completedTasksArg[1].id).toBe('P1.M1.T3');
    });
  });

  describe('BugHuntWorkflow integration', () => {
    it('should instantiate BugHuntWorkflow with correct parameters', async () => {
      // SETUP
      const prdContent = '# Test PRD\n\n## Requirements\nBuild feature.';
      const initialResults = createTestResults(
        true,
        [createTestBug('BUG-001', 'critical', 'Bug', 'Desc', 'Repro')],
        'Found bug',
        []
      );

      const mockBugHuntInstance = {
        run: vi
          .fn()
          .mockResolvedValue(createTestResults(false, [], 'No bugs', [])),
      };

      mockBugHuntWorkflow.mockImplementation(() => mockBugHuntInstance);

      const mockOrchestrator = createMockTaskOrchestrator();
      const sessionManager = createMockSessionManager();

      // EXECUTE
      const workflow = new FixCycleWorkflow(
        setupBugfixSession(initialResults),
        prdContent,
        mockOrchestrator,
        sessionManager
      );

      await workflow.run();

      // VERIFY
      expect(mockBugHuntWorkflow).toHaveBeenCalledWith(
        prdContent,
        expect.any(Array)
      );
    });

    it('should use updated completed tasks on each iteration', async () => {
      // SETUP
      const initialResults = createTestResults(
        true,
        [createTestBug('BUG-001', 'critical', 'Bug', 'Desc', 'Repro')],
        'Found bug',
        []
      );

      const mockBugHuntInstance = {
        run: vi
          .fn()
          .mockResolvedValueOnce(
            createTestResults(
              true,
              [
                createTestBug(
                  'BUG-002',
                  'major',
                  'Another bug',
                  'Desc',
                  'Repro'
                ),
              ],
              'Found another bug',
              []
            )
          )
          .mockResolvedValueOnce(createTestResults(false, [], 'No bugs', [])),
      };

      mockBugHuntWorkflow.mockImplementation(() => mockBugHuntInstance);

      const mockOrchestrator = createMockTaskOrchestrator();
      const sessionManager = createMockSessionManager();

      // EXECUTE
      const workflow = new FixCycleWorkflow(
        setupBugfixSession(initialResults),
        '# Test PRD',
        mockOrchestrator,
        sessionManager
      );

      await workflow.run();

      // VERIFY - BugHuntWorkflow should be called twice (2 iterations)
      expect(mockBugHuntInstance.run).toHaveBeenCalledTimes(2);
    });
  });

  describe('TaskOrchestrator integration', () => {
    it('should execute fix tasks via TaskOrchestrator', async () => {
      // SETUP
      const bugs: Bug[] = [
        createTestBug(
          'BUG-001',
          'critical',
          'Bug 1',
          'Desc',
          'Repro',
          'src/file1.ts:10'
        ),
        createTestBug(
          'BUG-002',
          'major',
          'Bug 2',
          'Desc',
          'Repro',
          'src/file2.ts:20'
        ),
      ];

      const initialResults = createTestResults(true, bugs, 'Found 2 bugs', []);

      const mockBugHuntInstance = {
        run: vi
          .fn()
          .mockResolvedValue(createTestResults(false, [], 'No bugs', [])),
      };

      mockBugHuntWorkflow.mockImplementation(() => mockBugHuntInstance);

      const mockOrchestrator = createMockTaskOrchestrator();
      const sessionManager = createMockSessionManager();

      // EXECUTE
      const workflow = new FixCycleWorkflow(
        setupBugfixSession(initialResults),
        '# Test PRD',
        mockOrchestrator,
        sessionManager
      );

      await workflow.run();

      // VERIFY
      expect(mockOrchestrator.executeSubtask).toHaveBeenCalledTimes(2);

      // Verify fix task structure - cast to any for mock access
      const mockFn = mockOrchestrator.executeSubtask as any;
      const firstCallArgs = mockFn.mock.calls[0][0];
      expect(firstCallArgs.id).toMatch(/^PFIX\.M1\.T\d+\.S1$/);
      expect(firstCallArgs.title).toContain('[BUG FIX]');
      expect(firstCallArgs.status).toBe('Planned');
    });
  });

  describe('error handling', () => {
    it('should set status to failed on unhandled errors', async () => {
      // SETUP
      const initialResults = createTestResults(
        true,
        [createTestBug('BUG-001', 'critical', 'Bug', 'Desc', 'Repro')],
        'Found bug',
        []
      );

      // Mock BugHuntWorkflow to throw error
      const mockBugHuntInstance = {
        run: vi.fn().mockRejectedValue(new Error('QA system failure')),
      };

      mockBugHuntWorkflow.mockImplementation(() => mockBugHuntInstance);

      const mockOrchestrator = createMockTaskOrchestrator();
      const sessionManager = createMockSessionManager();

      // EXECUTE & VERIFY
      const workflow = new FixCycleWorkflow(
        setupBugfixSession(initialResults),
        '# Test PRD',
        mockOrchestrator,
        sessionManager
      );

      await expect(workflow.run()).rejects.toThrow('QA system failure');
      expect(workflow.status).toBe('failed');
    });

    it('should handle missing session backlog gracefully', async () => {
      // SETUP - Session with no backlog
      const sessionManager: SessionManager = {
        currentSession: null,
      } as any;

      const initialResults = createTestResults(
        true,
        [createTestBug('BUG-001', 'critical', 'Bug', 'Desc', 'Repro')],
        'Found bug',
        []
      );

      const mockBugHuntInstance = {
        run: vi
          .fn()
          .mockResolvedValue(createTestResults(false, [], 'No bugs', [])),
      };

      mockBugHuntWorkflow.mockImplementation(() => mockBugHuntInstance);

      const mockOrchestrator = createMockTaskOrchestrator();

      // EXECUTE - Should handle gracefully
      const workflow = new FixCycleWorkflow(
        setupBugfixSession(initialResults),
        '# Test PRD',
        mockOrchestrator,
        sessionManager
      );

      await workflow.run();

      // VERIFY - Should complete with BugHuntWorkflow receiving empty tasks
      expect(mockBugHuntWorkflow).toHaveBeenCalledWith(
        '# Test PRD',
        expect.any(Array)
      );
      const completedTasks = mockBugHuntWorkflow.mock.calls[0][1];
      expect(completedTasks).toEqual([]);
    });
  });
});
