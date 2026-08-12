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
  Subtask,
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

// Mock writeTasksJSON so executeFixes' persistence to the bugfix tasks.json is
// observable without touching the real filesystem (node:fs/promises is mocked
// above with only readFile/access). Other session-utils exports are preserved
// via importOriginal.
vi.mock('../../../src/core/session-utils.js', async importOriginal => {
  const actual =
    await importOriginal<typeof import('../../../src/core/session-utils.js')>();
  return { ...actual, writeTasksJSON: vi.fn() };
});

// Mock standard-decomposition dependencies consumed via dynamic import by
// runStandardBreakdown (mirrors PRPPipeline.decomposePRD). Top-level vi.mock
// of the module path intercepts dynamic `await import(...)` too.
vi.mock('../../../src/agents/agent-factory.js', () => ({
  createArchitectAgent: vi.fn(),
}));
vi.mock('../../../src/agents/prompts/architect-prompt.js', () => ({
  createArchitectPrompt: vi.fn(),
}));
vi.mock('../../../src/utils/retry.js', () => ({
  retryAgentPrompt: vi.fn(),
}));
vi.mock('../../../src/core/scope-resolver.js', () => ({
  resolveScope: vi.fn(),
  parseScope: vi.fn(),
}));

// Import mocked BugHuntWorkflow
import { BugHuntWorkflow } from '../../../src/workflows/bug-hunt-workflow.js';
import { createArchitectAgent } from '../../../src/agents/agent-factory.js';
import { createArchitectPrompt } from '../../../src/agents/prompts/architect-prompt.js';
import { retryAgentPrompt } from '../../../src/utils/retry.js';
import { resolveScope, parseScope } from '../../../src/core/scope-resolver.js';
import { writeTasksJSON } from '../../../src/core/session-utils.js';

const mockBugHuntWorkflow = BugHuntWorkflow as any;
const mockedWriteTasksJSON = writeTasksJSON as ReturnType<typeof vi.fn>;
const mockedAccess = access as ReturnType<typeof vi.fn>;
const mockedReadFile = readFile as ReturnType<typeof vi.fn>;
const mockCreateArchitectAgent = createArchitectAgent as any;
const mockCreateArchitectPrompt = createArchitectPrompt as any;
const mockRetryAgentPrompt = retryAgentPrompt as any;
const mockResolveScope = resolveScope as any;
const mockParseScope = parseScope as any;

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

/** Build a single leaf Subtask for the flattened fix-subtask list. */
const createFixSubtaskFixture = (
  id: string,
  title: string = `Fix ${id}`
): Subtask => ({
  id,
  type: 'Subtask',
  title,
  status: 'Planned',
  story_points: 3,
  dependencies: [],
  context_scope: `CONTRACT DEFINITION:
1. RESEARCH NOTE: bugfix fixture for fix-cycle-workflow tests.
2. INPUT: TEST_RESULTS.md bug report.
3. LOGIC: apply the fix described in the bug report.
4. OUTPUT: patched source file.`,
  prd_selectors: [],
});

/**
 * Build a decomposed Backlog whose flattened leaf subtasks (via
 * resolveScope(backlog, parseScope('all'))) are `subtasks`. The mock
 * resolveScope returns `subtasks` directly, so the hierarchy shape here only
 * needs to be a valid Backlog for the JSON.parse → Backlog round-trip.
 */
const createFixBacklog = (subtasks: Subtask[]): Backlog => ({
  backlog: [
    {
      id: 'P1',
      type: 'Phase',
      title: 'Bug Fix Phase',
      status: 'Planned',
      description: 'Bug-fix phase for fix-cycle-workflow tests.',
      milestones: [
        {
          id: 'P1.M1',
          type: 'Milestone',
          title: 'Fixes',
          status: 'Planned',
          description: 'Milestone grouping reported bug fixes.',
          tasks: [
            {
              id: 'P1.M1.T1',
              type: 'Task',
              title: 'Fix reported bugs',
              status: 'Planned',
              description: 'Apply the fixes described in TEST_RESULTS.md.',
              subtasks,
            },
          ],
        },
      ],
    },
  ],
});

describe('FixCycleWorkflow', () => {
  /**
   * Wire the standard-decomposition happy-path mocks for runStandardBreakdown:
   * architect agent created once + prompt built; retryAgentPrompt runs the
   * supplied fn; readFile returns the backlog JSON for tasks.json; resolveScope
   * returns `subtasks`. Tests can override individual mocks after calling this.
   */
  const setupStandardBreakdownMocks = (
    subtasks: Subtask[] = [createFixSubtaskFixture('P1.M1.T1.S1')]
  ) => {
    mockCreateArchitectAgent.mockReturnValue({
      prompt: vi.fn().mockResolvedValue({ status: 'success', data: 'ok' }),
    });
    mockCreateArchitectPrompt.mockReturnValue({
      /* architect prompt obj */
    });
    // retryAgentPrompt just runs the supplied fn and returns its result.
    mockRetryAgentPrompt.mockImplementation(async (fn: any) => fn());
    mockParseScope.mockReturnValue({ type: 'all' });
    mockResolveScope.mockReturnValue(subtasks);
  };

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
    // Default happy-path decomposition mocks (individual tests override as needed)
    setupStandardBreakdownMocks();
    // executeFixes persists outcomes to the bugfix tasks.json — default to a
    // silent resolved mock (individual tests assert on the call).
    mockedWriteTasksJSON.mockResolvedValue(undefined);
    // Default readFile: TEST_RESULTS.md → TestResults JSON, tasks.json → Backlog JSON
    mockedReadFile.mockImplementation(async (p: any) => {
      if (String(p).endsWith('tasks.json')) {
        return JSON.stringify(
          createFixBacklog([createFixSubtaskFixture('P1.M1.T1.S1')])
        );
      }
      // TEST_RESULTS.md (or any other path) → a default TestResults fixture
      return JSON.stringify({
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
      } as TestResults);
    });
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

  describe('runStandardBreakdown', () => {
    const sessionPath = 'plan/003_b3d3efdaf0ed/bugfix/001_d5507a871918';

    it('builds a Markdown mini-PRD containing each bug field + summary and passes it with the bugfix sessionPath', async () => {
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
        ],
        summary: 'Found 1 critical bug',
        recommendations: ['Fix login validation'],
      };

      mockedAccess.mockResolvedValue(undefined);
      mockedReadFile.mockResolvedValue(JSON.stringify(testResults));

      const workflow = new FixCycleWorkflow(
        sessionPath,
        'PRD content',
        createMockTaskOrchestrator(),
        createMockSessionManager()
      );
      await workflow._loadBugReportForTesting();

      // EXECUTE
      await workflow.runStandardBreakdown();

      // VERIFY - createArchitectPrompt received (miniPrd, this.sessionPath)
      expect(mockCreateArchitectPrompt).toHaveBeenCalledTimes(1);
      const [miniPrd, passedSessionPath] =
        mockCreateArchitectPrompt.mock.calls[0];
      expect(passedSessionPath).toBe(sessionPath);
      // mini-PRD carries every bug field + the summary (PRD §4.4)
      expect(miniPrd).toContain('BUG-001');
      expect(miniPrd).toContain('critical');
      expect(miniPrd).toContain('Login bug');
      expect(miniPrd).toContain('Critical login failure');
      expect(miniPrd).toContain('1. Go to login');
      expect(miniPrd).toContain('src/auth/login.ts:45');
      expect(miniPrd).toContain('Found 1 critical bug');
      expect(miniPrd).toContain('Fix login validation'); // recommendation
    });

    it('creates the architect agent ONCE and invokes it through retryAgentPrompt({Agent, decomposeBugReport})', async () => {
      // SETUP
      mockedAccess.mockResolvedValue(undefined);

      const workflow = new FixCycleWorkflow(
        sessionPath,
        'PRD content',
        createMockTaskOrchestrator(),
        createMockSessionManager()
      );
      await workflow._loadBugReportForTesting();

      // EXECUTE
      await workflow.runStandardBreakdown();

      // VERIFY - agent created exactly once (not inside the retry closure)
      expect(mockCreateArchitectAgent).toHaveBeenCalledTimes(1);
      // retryAgentPrompt wraps the agent.prompt call with the right context
      expect(mockRetryAgentPrompt).toHaveBeenCalledTimes(1);
      const [, context] = mockRetryAgentPrompt.mock.calls[0];
      expect(context).toEqual({
        agentType: 'Architect',
        operation: 'decomposeBugReport',
      });
    });

    it('reads tasks.json back, flattens via resolveScope(backlog, parseScope(all)), and stores the subtasks in #fixTasks', async () => {
      // SETUP - mockedReadFile returns a backlog JSON for tasks.json;
      // resolveScope returns a 2-subtask list.
      const s1 = createFixSubtaskFixture('P1.M1.T1.S1');
      const s2 = createFixSubtaskFixture('P1.M1.T1.S2');
      mockResolveScope.mockReturnValue([s1, s2]);
      mockedReadFile.mockImplementation(async (p: any) => {
        if (String(p).endsWith('tasks.json')) {
          return JSON.stringify(createFixBacklog([s1, s2]));
        }
        // TEST_RESULTS.md fallback
        return JSON.stringify({
          hasBugs: true,
          bugs: [createTestBug('BUG-001', 'critical', 'b', 'd', 'r')],
          summary: 's',
          recommendations: [],
        } as TestResults);
      });
      mockedAccess.mockResolvedValue(undefined);

      const workflow = new FixCycleWorkflow(
        sessionPath,
        'PRD content',
        createMockTaskOrchestrator(),
        createMockSessionManager()
      );
      await workflow._loadBugReportForTesting();

      // EXECUTE
      await workflow.runStandardBreakdown();

      // VERIFY - tasks.json read from the bugfix sessionPath
      expect(mockedReadFile).toHaveBeenCalledWith(
        resolve(sessionPath, 'tasks.json'),
        'utf-8'
      );
      // resolveScope called with (parsedBacklog, parseScope('all'))
      expect(mockParseScope).toHaveBeenCalledWith('all');
      expect(mockResolveScope).toHaveBeenCalledTimes(1);
      const [backlogArg, scopeArg] = mockResolveScope.mock.calls[0];
      expect(backlogArg).toEqual(createFixBacklog([s1, s2]));
      expect(scopeArg).toEqual({ type: 'all' });
      // #fixTasks holds the flattened subtasks
      expect(workflow._fixTasksForTesting).toEqual([s1, s2]);
      expect(workflow._fixTasksForTesting).toHaveLength(2);
    });

    it('throws "Architect agent failed: …" on a {status:error} agent result', async () => {
      // SETUP - architect prompt resolves to an error result
      mockCreateArchitectAgent.mockReturnValue({
        prompt: vi.fn().mockResolvedValue({
          status: 'error',
          error: { message: 'boom' },
        }),
      });
      mockedAccess.mockResolvedValue(undefined);

      const workflow = new FixCycleWorkflow(
        sessionPath,
        'PRD content',
        createMockTaskOrchestrator(),
        createMockSessionManager()
      );
      await workflow._loadBugReportForTesting();

      // EXECUTE & VERIFY
      await expect(workflow.runStandardBreakdown()).rejects.toThrow(
        'Architect agent failed: boom'
      );
      // tasks.json was never read (the error check short-circuits)
      expect(
        mockedReadFile.mock.calls.some((c: any) =>
          String(c[0]).endsWith('tasks.json')
        )
      ).toBe(false);
    });

    it('throws "Failed to read/parse bugfix tasks.json …" when tasks.json is missing (ENOENT)', async () => {
      // SETUP - readFile rejects ENOENT for the tasks.json path
      mockedReadFile.mockImplementation(async (p: any) => {
        if (String(p).endsWith('tasks.json')) {
          const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
          throw err;
        }
        return JSON.stringify({
          hasBugs: true,
          bugs: [createTestBug('BUG-001', 'critical', 'b', 'd', 'r')],
          summary: 's',
          recommendations: [],
        } as TestResults);
      });
      mockedAccess.mockResolvedValue(undefined);

      const workflow = new FixCycleWorkflow(
        sessionPath,
        'PRD content',
        createMockTaskOrchestrator(),
        createMockSessionManager()
      );
      await workflow._loadBugReportForTesting();

      // EXECUTE & VERIFY
      await expect(workflow.runStandardBreakdown()).rejects.toThrow(
        `Failed to read/parse bugfix tasks.json at ${resolve(sessionPath, 'tasks.json')}`
      );
    });

    it('throws "No test results available" when no bug report has been loaded', async () => {
      // SETUP - do NOT call _loadBugReportForTesting; currentResults is null
      const workflow = new FixCycleWorkflow(
        sessionPath,
        'PRD content',
        createMockTaskOrchestrator(),
        createMockSessionManager()
      );

      // EXECUTE & VERIFY
      await expect(workflow.runStandardBreakdown()).rejects.toThrow(
        'No test results available'
      );
    });

    it('NEVER calls sessionManager.saveBacklog / updateItemStatus (§5 invariant)', async () => {
      // SETUP
      const sessionManager = createMockSessionManager();
      mockedAccess.mockResolvedValue(undefined);

      const workflow = new FixCycleWorkflow(
        sessionPath,
        'PRD content',
        createMockTaskOrchestrator(),
        sessionManager
      );
      await workflow._loadBugReportForTesting();

      // EXECUTE
      await workflow.runStandardBreakdown();

      // VERIFY - the bugfix path must not touch the shared manager's registry
      expect(sessionManager.saveBacklog).toBeUndefined(); // mock has no saveBacklog by design
      expect(sessionManager.updateItemStatus).not.toHaveBeenCalled();
    });
  });

  describe('executeFixes', () => {
    it('should execute all fix subtasks via orchestrator', async () => {
      // SETUP - runStandardBreakdown drives #fixTasks from the mocked
      // resolveScope return value (2 subtasks → executeSubtask called 2×).
      const s1 = createFixSubtaskFixture('P1.M1.T1.S1');
      const s2 = createFixSubtaskFixture('P1.M1.T1.S2');
      mockResolveScope.mockReturnValue([s1, s2]);
      mockedReadFile.mockImplementation(async (p: any) => {
        if (String(p).endsWith('tasks.json')) {
          return JSON.stringify(createFixBacklog([s1, s2]));
        }
        return JSON.stringify({
          hasBugs: true,
          bugs: [
            createTestBug(
              'BUG-001',
              'critical',
              'Bug 1',
              'Description',
              'Repro'
            ),
            createTestBug('BUG-002', 'major', 'Bug 2', 'Description', 'Repro'),
          ],
          summary: 'Found 2 bugs',
          recommendations: [],
        } as TestResults);
      });
      mockedAccess.mockResolvedValue(undefined);

      const mockOrchestrator = createMockTaskOrchestrator();
      const sessionManager = createMockSessionManager();

      const workflow = new FixCycleWorkflow(
        'plan/003_b3d3efdaf0ed/bugfix/001_d5507a871918',
        'PRD content',
        mockOrchestrator,
        sessionManager
      );

      // Load test results and run standard breakdown first
      await workflow._loadBugReportForTesting();
      await workflow.runStandardBreakdown();

      // EXECUTE
      await workflow.executeFixes();

      // VERIFY
      expect(mockOrchestrator.executeSubtask).toHaveBeenCalledTimes(2);
    });

    it('should continue on individual fix failures', async () => {
      // SETUP - 2 subtasks; first executeSubtask rejects, second resolves.
      const s1 = createFixSubtaskFixture('P1.M1.T1.S1');
      const s2 = createFixSubtaskFixture('P1.M1.T1.S2');
      mockResolveScope.mockReturnValue([s1, s2]);
      mockedReadFile.mockImplementation(async (p: any) => {
        if (String(p).endsWith('tasks.json')) {
          return JSON.stringify(createFixBacklog([s1, s2]));
        }
        return JSON.stringify({
          hasBugs: true,
          bugs: [
            createTestBug(
              'BUG-001',
              'critical',
              'Bug 1',
              'Description',
              'Repro'
            ),
            createTestBug('BUG-002', 'major', 'Bug 2', 'Description', 'Repro'),
          ],
          summary: 'Found 2 bugs',
          recommendations: [],
        } as TestResults);
      });
      mockedAccess.mockResolvedValue(undefined);

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
      await workflow.runStandardBreakdown();

      // EXECUTE - Should not throw
      await workflow.executeFixes();

      // VERIFY - Both should be called (second one after first failed)
      expect(mockOrchestrator.executeSubtask).toHaveBeenCalledTimes(2);
    });

    // Regression: the bugfix child's OWN tasks.json must reflect fix outcomes.
    // Previously the shared orchestrator wrote status only to the PARENT
    // registry (under colliding P1.M1.… IDs), so the bugfix tasks.json stayed
    // "Planned" forever and `hack status`/resume never saw progress.
    it('persists completed fix subtask outcomes to the bugfix tasks.json and rolls the status up', async () => {
      // SETUP - 2 leaf subtasks under one Task/Milestone/Phase (all 'Planned').
      const s1 = createFixSubtaskFixture('P1.M1.T1.S1');
      const s2 = createFixSubtaskFixture('P1.M1.T1.S2');
      const fixBacklog = createFixBacklog([s1, s2]);
      mockResolveScope.mockReturnValue([s1, s2]);
      mockedReadFile.mockImplementation(async (p: any) => {
        if (String(p).endsWith('tasks.json')) {
          return JSON.stringify(fixBacklog);
        }
        return JSON.stringify({
          hasBugs: true,
          bugs: [createTestBug('BUG-001', 'critical', 'Bug 1', 'D', 'R')],
          summary: 's',
          recommendations: [],
        } as TestResults);
      });
      mockedAccess.mockResolvedValue(undefined);
      mockedWriteTasksJSON.mockClear();

      const workflow = new FixCycleWorkflow(
        'plan/003_b3d3efdaf0ed/bugfix/001_d5507a871918',
        'PRD content',
        createMockTaskOrchestrator(),
        createMockSessionManager()
      );
      await workflow._loadBugReportForTesting();
      await workflow.runStandardBreakdown();

      // EXECUTE
      await workflow.executeFixes();

      // VERIFY - writeTasksJSON called once against the bugfix sessionPath...
      expect(mockedWriteTasksJSON).toHaveBeenCalledTimes(1);
      const [writtenPath, writtenBacklog] = mockedWriteTasksJSON.mock.calls[0];
      expect(writtenPath).toBe('plan/003_b3d3efdaf0ed/bugfix/001_d5507a871918');
      // ...with BOTH subtasks marked Complete (rolled up to the Task too).
      const sub = (writtenBacklog as any).backlog[0].milestones[0].tasks[0]
        .subtasks as Subtask[];
      expect(sub.map(s => s.status)).toEqual(['Complete', 'Complete']);
      expect(
        (writtenBacklog as any).backlog[0].milestones[0].tasks[0].status
      ).toBe('Complete');
    });

    it('marks a failed fix subtask Failed in the persisted bugfix tasks.json (and keeps successful ones Complete)', async () => {
      // SETUP - 2 subtasks; the first executeSubtask rejects, the second resolves.
      const s1 = createFixSubtaskFixture('P1.M1.T1.S1');
      const s2 = createFixSubtaskFixture('P1.M1.T1.S2');
      mockResolveScope.mockReturnValue([s1, s2]);
      mockedReadFile.mockImplementation(async (p: any) => {
        if (String(p).endsWith('tasks.json')) {
          return JSON.stringify(createFixBacklog([s1, s2]));
        }
        return JSON.stringify({
          hasBugs: true,
          bugs: [createTestBug('BUG-001', 'critical', 'Bug 1', 'D', 'R')],
          summary: 's',
          recommendations: [],
        } as TestResults);
      });
      mockedAccess.mockResolvedValue(undefined);
      mockedWriteTasksJSON.mockClear();

      const mockOrchestrator: TaskOrchestrator = {
        executeSubtask: vi
          .fn()
          .mockRejectedValueOnce(new Error('Fix failed'))
          .mockResolvedValueOnce(undefined),
      } as any;

      const workflow = new FixCycleWorkflow(
        'plan/003_b3d3efdaf0ed/bugfix/001_d5507a871918',
        'PRD content',
        mockOrchestrator,
        createMockSessionManager()
      );
      await workflow._loadBugReportForTesting();
      await workflow.runStandardBreakdown();

      // EXECUTE
      await workflow.executeFixes();

      // VERIFY - persisted statuses reflect the mixed outcomes.
      expect(mockedWriteTasksJSON).toHaveBeenCalledTimes(1);
      const writtenBacklog = mockedWriteTasksJSON.mock.calls[0][1] as any;
      const sub = writtenBacklog.backlog[0].milestones[0].tasks[0]
        .subtasks as Subtask[];
      expect(sub.map(s => s.status)).toEqual(['Failed', 'Complete']);
    });

    // Regression (convergence): when a bugfixOrchestratorFactory is provided,
    // fix subtasks MUST execute against the factory-built (bugfix-scoped)
    // orchestrator — never the shared parent orchestrator. This is what routes
    // PRPs into `${bugfixDir}/prps/` so bugfix subtasks stop reusing the
    // parent's stale PRP under colliding P1.M1.T1.S1 IDs.
    it('uses the bugfix-scoped orchestrator from the factory (and skips the shared one) when a factory is provided', async () => {
      // SETUP
      const s1 = createFixSubtaskFixture('P1.M1.T1.S1');
      const s2 = createFixSubtaskFixture('P1.M1.T1.S2');
      mockResolveScope.mockReturnValue([s1, s2]);
      mockedReadFile.mockImplementation(async (p: any) => {
        if (String(p).endsWith('tasks.json')) {
          return JSON.stringify(createFixBacklog([s1, s2]));
        }
        return JSON.stringify({
          hasBugs: true,
          bugs: [createTestBug('BUG-001', 'critical', 'Bug 1', 'D', 'R')],
          summary: 's',
          recommendations: [],
        } as TestResults);
      });
      mockedAccess.mockResolvedValue(undefined);
      mockedWriteTasksJSON.mockClear();

      // The PARENT (shared) orchestrator must NEVER be touched on this path.
      const parentOrchestrator = createMockTaskOrchestrator();
      // The bugfix-scoped orchestrator is its own mock.
      const bugfixExecute = vi.fn().mockResolvedValue(undefined);
      const bugfixOrchestrator: TaskOrchestrator = {
        executeSubtask: bugfixExecute,
      } as any;
      const factory = vi.fn().mockResolvedValue(bugfixOrchestrator);

      const workflow = new FixCycleWorkflow(
        'plan/003_b3d3efdaf0ed/bugfix/001_d5507a871918',
        'PRD content',
        parentOrchestrator,
        createMockSessionManager(),
        undefined,
        factory
      );
      await workflow._loadBugReportForTesting();
      await workflow.runStandardBreakdown();

      // EXECUTE
      await workflow.executeFixes();

      // VERIFY - factory called once (after breakdown), bugfix orchestrator
      // ran both subtasks, parent orchestrator untouched.
      expect(factory).toHaveBeenCalledTimes(1);
      expect(bugfixExecute).toHaveBeenCalledTimes(2);
      expect(parentOrchestrator.executeSubtask).not.toHaveBeenCalled();
      // The bugfix orchestrator owns persistence on this path → no fallback write.
      expect(mockedWriteTasksJSON).not.toHaveBeenCalled();
    });

    it('falls back to the shared orchestrator + mirror persistence when the factory throws', async () => {
      // SETUP
      const s1 = createFixSubtaskFixture('P1.M1.T1.S1');
      mockResolveScope.mockReturnValue([s1]);
      mockedReadFile.mockImplementation(async (p: any) => {
        if (String(p).endsWith('tasks.json')) {
          return JSON.stringify(createFixBacklog([s1]));
        }
        return JSON.stringify({
          hasBugs: true,
          bugs: [createTestBug('BUG-001', 'critical', 'Bug 1', 'D', 'R')],
          summary: 's',
          recommendations: [],
        } as TestResults);
      });
      mockedAccess.mockResolvedValue(undefined);
      mockedWriteTasksJSON.mockClear();

      const parentOrchestrator = createMockTaskOrchestrator();
      const factory = vi.fn().mockRejectedValue(new Error('boom'));

      const workflow = new FixCycleWorkflow(
        'plan/003_b3d3efdaf0ed/bugfix/001_d5507a871918',
        'PRD content',
        parentOrchestrator,
        createMockSessionManager(),
        undefined,
        factory
      );
      await workflow._loadBugReportForTesting();
      await workflow.runStandardBreakdown();

      // EXECUTE - must not throw despite the factory failure
      await workflow.executeFixes();

      // VERIFY - fell back to parent orchestrator + mirror persistence.
      expect(parentOrchestrator.executeSubtask).toHaveBeenCalledTimes(1);
      expect(mockedWriteTasksJSON).toHaveBeenCalledTimes(1);
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

      // Mock file operations: TEST_RESULTS.md → testResults, tasks.json → backlog
      mockedAccess.mockResolvedValue(undefined);
      mockedReadFile.mockImplementation(async (p: any) => {
        if (String(p).endsWith('tasks.json')) {
          return JSON.stringify(
            createFixBacklog([createFixSubtaskFixture('P1.M1.T1.S1')])
          );
        }
        return JSON.stringify(testResults);
      });

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

      // Mock file operations: TEST_RESULTS.md → testResults, tasks.json → backlog
      mockedAccess.mockResolvedValue(undefined);
      mockedReadFile.mockImplementation(async (p: any) => {
        if (String(p).endsWith('tasks.json')) {
          return JSON.stringify(
            createFixBacklog([createFixSubtaskFixture('P1.M1.T1.S1')])
          );
        }
        return JSON.stringify(testResults);
      });

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
