/**
 * Unit tests for BugHuntWorkflow class
 *
 * @remarks
 * Tests validate BugHuntWorkflow class from src/workflows/bug-hunt-workflow.ts
 * with comprehensive coverage. Tests follow the Setup/Execute/Verify pattern.
 *
 * Mocks are used for all agent operations - no real I/O is performed.
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { BugHuntWorkflow } from '../../../src/workflows/bug-hunt-workflow.js';
import type { Task, TestResults, Bug } from '../../../src/core/models.js';

// Mock agent factory
vi.mock('../../../src/agents/agent-factory.js', () => ({
  createQAAgent: vi.fn(),
}));

// Mock bug hunt prompt
vi.mock('../../../src/agents/prompts/bug-hunt-prompt.js', () => ({
  createBugHuntPrompt: vi.fn(),
}));

// Mock session-utils
vi.mock('../../../src/core/session-utils.js', () => ({
  atomicWrite: vi.fn(),
}));

// Mock node:fs/promises for file-as-contract pattern in generateReport
// and for removeNoIssuesMarker's tolerant unlink (PRD §4.4 marker).
const { mockReadFile, mockUnlink } = vi.hoisted(() => ({
  mockReadFile: vi.fn(),
  mockUnlink: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  readFile: mockReadFile,
  unlink: mockUnlink,
}));

// Mock git-commit's smartCommit so the clean-hunt marker path (PRD §4.4)
// never runs real git ops in unit tests.
vi.mock('../../../src/utils/git-commit.js', () => ({
  smartCommit: vi.fn(),
}));

// Import mocked modules
import { createQAAgent } from '../../../src/agents/agent-factory.js';
import { createBugHuntPrompt } from '../../../src/agents/prompts/bug-hunt-prompt.js';
import { atomicWrite } from '../../../src/core/session-utils.js';
import { smartCommit } from '../../../src/utils/git-commit.js';

// Cast mocked functions
const mockCreateQAAgent = createQAAgent as any;
const mockCreateBugHuntPrompt = createBugHuntPrompt as any;
const mockAtomicWrite = atomicWrite as any;
const mockSmartCommit = smartCommit as any;

// Factory functions for test data
const createTestTask = (
  id: string,
  title: string,
  description?: string
): Task => ({
  id,
  type: 'Task',
  title,
  status: 'Complete',
  description: description ?? `Description for ${title}`,
  subtasks: [],
});

const createTestBug = (
  id: string,
  severity: 'critical' | 'major' | 'minor' | 'cosmetic',
  title: string,
  description: string,
  reproduction: string
): Bug => ({
  id,
  severity,
  title,
  description,
  reproduction,
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

describe('BugHuntWorkflow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Setup default mocks
    mockCreateQAAgent.mockReturnValue({
      prompt: vi.fn(),
    });
    mockCreateBugHuntPrompt.mockReturnValue({});
    mockAtomicWrite.mockResolvedValue(undefined);
    // By default, readFile throws (file not found) — simulates
    // the QA agent not having written the file yet.
    mockReadFile.mockRejectedValue(new Error('ENOENT'));
    // PRD §4.4 marker defaults: a prior clean marker is usually absent, so
    // removeNoIssuesMarker's unlink resolves to ENOENT (swallowed). The
    // clean path's smartCommit succeeds with a fake hash.
    mockUnlink.mockRejectedValue(
      Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    );
    mockSmartCommit.mockResolvedValue('deadbeef');
  });

  describe('constructor', () => {
    it('should throw if prdContent is empty', () => {
      // EXECUTE & VERIFY
      expect(() => new BugHuntWorkflow('', [])).toThrow(
        'prdContent must be a non-empty string'
      );
    });

    it('should throw if prdContent is only whitespace', () => {
      // EXECUTE & VERIFY
      expect(() => new BugHuntWorkflow('   ', [])).toThrow(
        'prdContent must be a non-empty string'
      );
    });

    it('should throw if prdContent is not a string', () => {
      // EXECUTE & VERIFY
      expect(() => new BugHuntWorkflow('' as any, [])).toThrow(
        'prdContent must be a non-empty string'
      );
    });

    it('should throw if completedTasks is not an array', () => {
      // EXECUTE & VERIFY
      expect(
        () => new BugHuntWorkflow('PRD content', 'not an array' as any)
      ).toThrow('completedTasks must be an array');
    });

    it('should initialize ObservedState fields with provided values', () => {
      // SETUP
      const prdContent = '# PRD\n## Requirements\nBuild a feature.';
      const completedTasks = [
        createTestTask('P1.M1.T1', 'Setup Project', 'Initial setup'),
        createTestTask('P1.M2.T1', 'Implement Core', 'Core logic'),
      ];

      // EXECUTE
      const workflow = new BugHuntWorkflow(prdContent, completedTasks);

      // VERIFY
      expect(workflow.prdContent).toBe(prdContent);
      expect(workflow.completedTasks).toEqual(completedTasks);
    });

    it('should initialize testResults as null', () => {
      // EXECUTE
      const workflow = new BugHuntWorkflow('PRD content', []);

      // VERIFY
      expect(workflow.testResults).toBeNull();
    });

    it('should accept empty completedTasks array', () => {
      // EXECUTE
      const workflow = new BugHuntWorkflow('PRD content', []);

      // VERIFY
      expect(workflow.completedTasks).toEqual([]);
    });
  });

  describe('analyzeScope', () => {
    it('should execute without error', async () => {
      // SETUP
      const workflow = new BugHuntWorkflow('PRD content', []);

      // EXECUTE - should not throw
      await workflow.analyzeScope();

      // VERIFY - method completes successfully
      expect(workflow.prdContent).toBe('PRD content');
    });

    it('should log PRD analysis details', async () => {
      // SETUP
      const prdContent = '# Test PRD\n## Requirements\nSome requirements';
      const tasks = [
        createTestTask('P1.M1.T1', 'Task 1'),
        createTestTask('P1.M2.T1', 'Task 2'),
      ];
      const workflow = new BugHuntWorkflow(prdContent, tasks);

      // Spy on logger
      const logSpy = vi.spyOn((workflow as any).correlationLogger, 'info');

      // EXECUTE
      await workflow.analyzeScope();

      // VERIFY
      expect(logSpy).toHaveBeenCalledWith(
        '[BugHuntWorkflow] Phase 1: Scope Analysis'
      );
      expect(logSpy).toHaveBeenCalledWith(
        '[BugHuntWorkflow] Analyzing PRD requirements...',
        { prdLength: prdContent.length }
      );
      expect(logSpy).toHaveBeenCalledWith(
        '[BugHuntWorkflow] Completed tasks for testing:',
        {
          count: 2,
          tasks: ['P1.M1.T1: Task 1', 'P1.M2.T1: Task 2'],
        }
      );
    });
  });

  describe('creativeE2ETesting', () => {
    it('should execute without error', async () => {
      // SETUP
      const workflow = new BugHuntWorkflow('PRD content', []);

      // EXECUTE
      await workflow.creativeE2ETesting();

      // VERIFY
      expect(workflow.prdContent).toBe('PRD content');
    });

    it('should log E2E test categories', async () => {
      // SETUP
      const workflow = new BugHuntWorkflow('PRD content', []);
      const logSpy = vi.spyOn((workflow as any).correlationLogger, 'info');

      // EXECUTE
      await workflow.creativeE2ETesting();

      // VERIFY
      expect(logSpy).toHaveBeenCalledWith(
        '[BugHuntWorkflow] Phase 2: Creative E2E Testing'
      );
      expect(logSpy).toHaveBeenCalledWith(
        '[BugHuntWorkflow] E2E test categories:',
        [
          'Happy Path Testing',
          'Edge Case Testing',
          'Workflow Testing',
          'Integration Testing',
          'Error Handling',
          'State Testing',
          'Concurrency Testing',
          'Regression Testing',
        ]
      );
    });
  });

  describe('adversarialTesting', () => {
    it('should execute without error', async () => {
      // SETUP
      const workflow = new BugHuntWorkflow('PRD content', []);

      // EXECUTE
      await workflow.adversarialTesting();

      // VERIFY
      expect(workflow.prdContent).toBe('PRD content');
    });

    it('should log adversarial test categories', async () => {
      // SETUP
      const workflow = new BugHuntWorkflow('PRD content', []);
      const logSpy = vi.spyOn((workflow as any).correlationLogger, 'info');

      // EXECUTE
      await workflow.adversarialTesting();

      // VERIFY
      expect(logSpy).toHaveBeenCalledWith(
        '[BugHuntWorkflow] Phase 3: Adversarial Testing'
      );
      expect(logSpy).toHaveBeenCalledWith(
        '[BugHuntWorkflow] Adversarial test categories:',
        [
          'Unexpected Inputs',
          'Missing Features',
          'Incomplete Features',
          'Implicit Requirements',
          'User Experience Issues',
          'Security Concerns',
          'Performance Issues',
        ]
      );
    });
  });

  describe('generateReport', () => {
    it('should call createQAAgent to get agent', async () => {
      // SETUP
      const workflow = new BugHuntWorkflow('PRD content', []);
      const mockAgent = {
        prompt: vi.fn().mockResolvedValue({
          status: 'success',
          data: {
            hasBugs: false,
            bugs: [],
            summary: 'No bugs found',
            recommendations: [],
          },
          error: null,
          metadata: {
            agentId: 'test-qa-agent',
            timestamp: Date.now(),
          },
        }),
      };
      mockCreateQAAgent.mockReturnValue(mockAgent);
      mockCreateBugHuntPrompt.mockReturnValue({});

      // EXECUTE
      await workflow.generateReport();

      // VERIFY
      expect(mockCreateQAAgent).toHaveBeenCalled();
    });

    it('should call createBugHuntPrompt with correct parameters', async () => {
      // SETUP
      const prdContent = '# Test PRD';
      const completedTasks = [
        createTestTask('P1.M1.T1', 'Task 1'),
        createTestTask('P1.M2.T1', 'Task 2'),
      ];
      const workflow = new BugHuntWorkflow(prdContent, completedTasks);
      const mockAgent = {
        prompt: vi.fn().mockResolvedValue({
          status: 'success',
          data: {
            hasBugs: false,
            bugs: [],
            summary: 'No bugs found',
            recommendations: [],
          },
          error: null,
          metadata: {
            agentId: 'test-qa-agent',
            timestamp: Date.now(),
          },
        }),
      };
      mockCreateQAAgent.mockReturnValue(mockAgent);
      mockCreateBugHuntPrompt.mockReturnValue({});

      // EXECUTE
      await workflow.generateReport();

      // VERIFY
      expect(mockCreateBugHuntPrompt).toHaveBeenCalledWith(
        prdContent,
        completedTasks,
        undefined
      );
    });

    it('should call agent.prompt with the prompt', async () => {
      // SETUP
      const workflow = new BugHuntWorkflow('PRD content', []);
      const prompt = { user: 'test prompt', system: 'system' };
      const mockAgent = {
        prompt: vi.fn().mockResolvedValue({
          status: 'success',
          data: {
            hasBugs: false,
            bugs: [],
            summary: 'No bugs found',
            recommendations: [],
          },
          error: null,
          metadata: {
            agentId: 'test-qa-agent',
            timestamp: Date.now(),
          },
        }),
      };
      mockCreateQAAgent.mockReturnValue(mockAgent);
      mockCreateBugHuntPrompt.mockReturnValue(prompt);

      // EXECUTE
      await workflow.generateReport();

      // VERIFY
      expect(mockAgent.prompt).toHaveBeenCalledWith(prompt);
    });

    it('should store result in testResults field', async () => {
      // SETUP
      const workflow = new BugHuntWorkflow('PRD content', []);
      const expectedResult = createTestResults(
        true,
        [
          createTestBug(
            'BUG-001',
            'critical',
            'Login fails',
            'Auth error',
            'Steps to reproduce'
          ),
        ],
        'Found 1 critical bug',
        ['Fix auth']
      );
      const mockAgent = {
        prompt: vi.fn().mockResolvedValue({
          status: 'success',
          data: expectedResult,
          error: null,
          metadata: {
            agentId: 'test-qa-agent',
            timestamp: Date.now(),
          },
        }),
      };
      mockCreateQAAgent.mockReturnValue(mockAgent);
      mockCreateBugHuntPrompt.mockReturnValue({});

      // EXECUTE
      await workflow.generateReport();

      // VERIFY
      expect(workflow.testResults).toEqual(expectedResult);
    });

    it('should return TestResults result', async () => {
      // SETUP
      const workflow = new BugHuntWorkflow('PRD content', []);
      const expectedResult = createTestResults(
        false,
        [],
        'All tests passed',
        []
      );
      const mockAgent = {
        prompt: vi.fn().mockResolvedValue({
          status: 'success',
          data: expectedResult,
          error: null,
          metadata: {
            agentId: 'test-qa-agent',
            timestamp: Date.now(),
          },
        }),
      };
      mockCreateQAAgent.mockReturnValue(mockAgent);
      mockCreateBugHuntPrompt.mockReturnValue({});

      // EXECUTE
      const result = await workflow.generateReport();

      // VERIFY
      expect(result).toEqual(expectedResult);
    });

    it('should log bug report summary', async () => {
      // SETUP
      const workflow = new BugHuntWorkflow('PRD content', []);
      const testResults = createTestResults(
        true,
        [
          createTestBug('BUG-001', 'critical', 'Bug 1', 'Desc 1', 'Rep 1'),
          createTestBug('BUG-002', 'major', 'Bug 2', 'Desc 2', 'Rep 2'),
          createTestBug('BUG-003', 'minor', 'Bug 3', 'Desc 3', 'Rep 3'),
          createTestBug('BUG-004', 'cosmetic', 'Bug 4', 'Desc 4', 'Rep 4'),
        ],
        'Found 4 bugs',
        ['Fix all']
      );
      const mockAgent = {
        prompt: vi.fn().mockResolvedValue({
          status: 'success',
          data: testResults,
          error: null,
          metadata: {
            agentId: 'test-qa-agent',
            timestamp: Date.now(),
          },
        }),
      };
      mockCreateQAAgent.mockReturnValue(mockAgent);
      mockCreateBugHuntPrompt.mockReturnValue({});
      const logSpy = vi.spyOn((workflow as any).correlationLogger, 'info');

      // EXECUTE
      await workflow.generateReport();

      // VERIFY
      expect(logSpy).toHaveBeenCalledWith(
        '[BugHuntWorkflow] Bug report generated',
        {
          hasBugs: true,
          bugCount: 4,
          criticalCount: 1,
          majorCount: 1,
          minorCount: 1,
          cosmeticCount: 1,
        }
      );
    });

    it('should propagate errors from agent.prompt', async () => {
      // SETUP
      const workflow = new BugHuntWorkflow('PRD content', []);
      const mockError = new Error('Agent failed');
      const mockAgent = {
        prompt: vi.fn().mockRejectedValue(mockError),
      };
      mockCreateQAAgent.mockReturnValue(mockAgent);
      mockCreateBugHuntPrompt.mockReturnValue({});

      // EXECUTE & VERIFY
      await expect(workflow.generateReport()).rejects.toThrow(
        'Bug report generation failed: Agent failed'
      );
    });

    it('should propagate errors from createQAAgent', async () => {
      // SETUP
      const workflow = new BugHuntWorkflow('PRD content', []);
      mockCreateQAAgent.mockImplementation(() => {
        throw new Error('Factory failed');
      });
      mockCreateBugHuntPrompt.mockReturnValue({});

      // EXECUTE & VERIFY
      await expect(workflow.generateReport()).rejects.toThrow(
        'Bug report generation failed: Factory failed'
      );
    });

    it('should propagate errors from createBugHuntPrompt', async () => {
      // SETUP
      const workflow = new BugHuntWorkflow('PRD content', []);
      mockCreateBugHuntPrompt.mockImplementation(() => {
        throw new Error('Prompt creation failed');
      });

      // EXECUTE & VERIFY
      await expect(workflow.generateReport()).rejects.toThrow(
        'Bug report generation failed: Prompt creation failed'
      );
    });

    it('should handle empty bugs array', async () => {
      // SETUP
      const workflow = new BugHuntWorkflow('PRD content', []);
      const expectedResult = createTestResults(false, [], 'No bugs found', []);
      const mockAgent = {
        prompt: vi.fn().mockResolvedValue({
          status: 'success',
          data: expectedResult,
          error: null,
          metadata: {
            agentId: 'test-qa-agent',
            timestamp: Date.now(),
          },
        }),
      };
      mockCreateQAAgent.mockReturnValue(mockAgent);
      mockCreateBugHuntPrompt.mockReturnValue({});

      // EXECUTE
      const result = await workflow.generateReport();

      // VERIFY
      expect(result.bugs).toEqual([]);
      expect(result.hasBugs).toBe(false);
    });
  });

  describe('createQAAgent reasoning wiring (PRD §9.2.9 / P1.M1.T3.S3)', () => {
    afterEach(() => vi.unstubAllEnvs());

    it('passes the bug-finder reasoning level (default high) to createQAAgent', async () => {
      // SETUP — stub explicitly for robustness (PRD §9.2.9 default is 'high').
      vi.stubEnv('PRP_REASONING_BUG_FINDER_AGENT', 'high');
      const workflow = new BugHuntWorkflow('PRD content', []);
      mockCreateQAAgent.mockReturnValue({
        prompt: vi.fn().mockResolvedValue({
          status: 'success',
          data: {
            hasBugs: false,
            bugs: [],
            summary: 'No bugs found',
            recommendations: [],
          },
          error: null,
          metadata: { agentId: 'test-qa-agent', timestamp: Date.now() },
        }),
      });
      mockCreateBugHuntPrompt.mockReturnValue({});

      // EXECUTE
      await workflow.generateReport();

      // VERIFY — bug-hunt threads its OWN (bug-finder) level.
      expect(mockCreateQAAgent).toHaveBeenCalledWith('high');
    });

    it('passes the bug-finder reasoning level independently of validation (xhigh)', async () => {
      // SETUP — set BOTH role vars to DIFFERENT values; bug-hunt must see ONLY its own (xhigh).
      vi.stubEnv('PRP_REASONING_BUG_FINDER_AGENT', 'xhigh');
      vi.stubEnv('PRP_REASONING_VALIDATION_AGENT', 'low');
      const workflow = new BugHuntWorkflow('PRD content', []);
      mockCreateQAAgent.mockReturnValue({
        prompt: vi.fn().mockResolvedValue({
          status: 'success',
          data: {
            hasBugs: false,
            bugs: [],
            summary: 'No bugs found',
            recommendations: [],
          },
          error: null,
          metadata: { agentId: 'test-qa-agent', timestamp: Date.now() },
        }),
      });
      mockCreateBugHuntPrompt.mockReturnValue({});

      // EXECUTE
      await workflow.generateReport();

      // VERIFY — 'xhigh' (NOT 'low'); the two roles resolve independent levels (§9.2.9).
      expect(mockCreateQAAgent).toHaveBeenCalledWith('xhigh');
    });
  });

  describe('run', () => {
    it('should call all phase methods in order', async () => {
      // SETUP
      const workflow = new BugHuntWorkflow('PRD content', []);
      const expectedResult = createTestResults(
        false,
        [],
        'All tests passed',
        []
      );
      const mockAgent = {
        prompt: vi.fn().mockResolvedValue({
          status: 'success',
          data: expectedResult,
          error: null,
          metadata: {
            agentId: 'test-qa-agent',
            timestamp: Date.now(),
          },
        }),
      };
      mockCreateQAAgent.mockReturnValue(mockAgent);
      mockCreateBugHuntPrompt.mockReturnValue({});

      // Spy on phase methods
      const analyzeScopeSpy = vi.spyOn(workflow, 'analyzeScope');
      const creativeE2ETestingSpy = vi.spyOn(workflow, 'creativeE2ETesting');
      const adversarialTestingSpy = vi.spyOn(workflow, 'adversarialTesting');
      const generateReportSpy = vi.spyOn(workflow, 'generateReport');

      // EXECUTE
      await workflow.run();

      // VERIFY
      expect(analyzeScopeSpy).toHaveBeenCalled();
      expect(creativeE2ETestingSpy).toHaveBeenCalled();
      expect(adversarialTestingSpy).toHaveBeenCalled();
      expect(generateReportSpy).toHaveBeenCalled();
    });

    it('should return TestResults', async () => {
      // SETUP
      const workflow = new BugHuntWorkflow('PRD content', []);
      const expectedResult = createTestResults(
        true,
        [createTestBug('BUG-001', 'critical', 'Bug', 'Desc', 'Rep')],
        'Found bugs',
        ['Fix']
      );
      const mockAgent = {
        prompt: vi.fn().mockResolvedValue({
          status: 'success',
          data: expectedResult,
          error: null,
          metadata: {
            agentId: 'test-qa-agent',
            timestamp: Date.now(),
          },
        }),
      };
      mockCreateQAAgent.mockReturnValue(mockAgent);
      mockCreateBugHuntPrompt.mockReturnValue({});

      // EXECUTE
      const result = await workflow.run();

      // VERIFY
      expect(result).toEqual(expectedResult);
    });

    it('should set status to running before execution', async () => {
      // SETUP
      const workflow = new BugHuntWorkflow('PRD content', []);
      const mockAgent = {
        prompt: vi.fn().mockResolvedValue({
          status: 'success',
          data: {
            hasBugs: false,
            bugs: [],
            summary: 'No bugs',
            recommendations: [],
          },
          error: null,
          metadata: {
            agentId: 'test-qa-agent',
            timestamp: Date.now(),
          },
        }),
      };
      mockCreateQAAgent.mockReturnValue(mockAgent);
      mockCreateBugHuntPrompt.mockReturnValue({});

      // Spy on setStatus
      const setStatusSpy = vi.spyOn(workflow, 'setStatus');

      // EXECUTE
      await workflow.run();

      // VERIFY - setStatus('running') should be called before setStatus('completed')
      expect(setStatusSpy).toHaveBeenNthCalledWith(1, 'running');
      expect(setStatusSpy).toHaveBeenNthCalledWith(2, 'completed');
    });

    it('should set status to completed after successful execution', async () => {
      // SETUP
      const workflow = new BugHuntWorkflow('PRD content', []);
      const mockAgent = {
        prompt: vi.fn().mockResolvedValue({
          status: 'success',
          data: {
            hasBugs: false,
            bugs: [],
            summary: 'No bugs',
            recommendations: [],
          },
          error: null,
          metadata: {
            agentId: 'test-qa-agent',
            timestamp: Date.now(),
          },
        }),
      };
      mockCreateQAAgent.mockReturnValue(mockAgent);
      mockCreateBugHuntPrompt.mockReturnValue({});

      // Spy on setStatus
      const setStatusSpy = vi.spyOn(workflow, 'setStatus');

      // EXECUTE
      await workflow.run();

      // VERIFY
      expect(setStatusSpy).toHaveBeenCalledWith('completed');
    });

    it('should propagate errors from phase methods', async () => {
      // SETUP
      const workflow = new BugHuntWorkflow('PRD content', []);
      const mockAgent = {
        prompt: vi.fn().mockRejectedValue(new Error('Phase failed')),
      };
      mockCreateQAAgent.mockReturnValue(mockAgent);
      mockCreateBugHuntPrompt.mockReturnValue({});

      // EXECUTE & VERIFY
      await expect(workflow.run()).rejects.toThrow('Phase failed');
    });

    it('should set status to failed on error', async () => {
      // SETUP
      const workflow = new BugHuntWorkflow('PRD content', []);
      const mockAgent = {
        prompt: vi.fn().mockRejectedValue(new Error('Test error')),
      };
      mockCreateQAAgent.mockReturnValue(mockAgent);
      mockCreateBugHuntPrompt.mockReturnValue({});

      // Spy on setStatus
      const setStatusSpy = vi.spyOn(workflow, 'setStatus');

      // EXECUTE
      try {
        await workflow.run();
      } catch {
        // Expected error
      }

      // VERIFY
      expect(setStatusSpy).toHaveBeenCalledWith('running');
      expect(setStatusSpy).toHaveBeenCalledWith('failed');
    });

    it('should not set status to completed on error', async () => {
      // SETUP
      const workflow = new BugHuntWorkflow('PRD content', []);
      const mockAgent = {
        prompt: vi.fn().mockRejectedValue(new Error('Test error')),
      };
      mockCreateQAAgent.mockReturnValue(mockAgent);
      mockCreateBugHuntPrompt.mockReturnValue({});

      // Spy on setStatus
      const setStatusSpy = vi.spyOn(workflow, 'setStatus');

      // EXECUTE
      try {
        await workflow.run();
      } catch {
        // Expected error
      }

      // VERIFY - should be called with 'running' and 'failed' but not 'completed'
      expect(setStatusSpy).toHaveBeenCalledWith('running');
      expect(setStatusSpy).not.toHaveBeenCalledWith('completed');
    });

    it('should update testResults field after successful run', async () => {
      // SETUP
      const workflow = new BugHuntWorkflow('PRD content', []);
      const expectedResult = createTestResults(
        true,
        [createTestBug('BUG-001', 'major', 'Bug', 'Desc', 'Rep')],
        'Found bugs',
        ['Fix']
      );
      const mockAgent = {
        prompt: vi.fn().mockResolvedValue({
          status: 'success',
          data: expectedResult,
          error: null,
          metadata: {
            agentId: 'test-qa-agent',
            timestamp: Date.now(),
          },
        }),
      };
      mockCreateQAAgent.mockReturnValue(mockAgent);
      mockCreateBugHuntPrompt.mockReturnValue({});

      // EXECUTE
      await workflow.run();

      // VERIFY
      expect(workflow.testResults).toEqual(expectedResult);
    });

    it('should handle workflow with completedTasks provided', async () => {
      // SETUP
      const completedTasks = [
        createTestTask('P1.M1.T1', 'Task 1', 'First task'),
        createTestTask('P1.M2.T1', 'Task 2', 'Second task'),
        createTestTask('P1.M3.T1.S1', 'Subtask 1', 'Subtask'),
      ];
      const workflow = new BugHuntWorkflow('PRD content', completedTasks);
      const expectedResult = createTestResults(false, [], 'All good', []);
      const mockAgent = {
        prompt: vi.fn().mockResolvedValue({
          status: 'success',
          data: expectedResult,
          error: null,
          metadata: {
            agentId: 'test-qa-agent',
            timestamp: Date.now(),
          },
        }),
      };
      mockCreateQAAgent.mockReturnValue(mockAgent);
      mockCreateBugHuntPrompt.mockReturnValue({});

      // EXECUTE
      const result = await workflow.run();

      // VERIFY
      expect(mockCreateBugHuntPrompt).toHaveBeenCalledWith(
        'PRD content',
        completedTasks,
        undefined
      );
      expect(result).toEqual(expectedResult);
    });

    it('should handle workflow with no completedTasks', async () => {
      // SETUP
      const workflow = new BugHuntWorkflow('PRD content', []);
      const expectedResult = createTestResults(
        false,
        [],
        'No tasks to test',
        []
      );
      const mockAgent = {
        prompt: vi.fn().mockResolvedValue({
          status: 'success',
          data: expectedResult,
          error: null,
          metadata: {
            agentId: 'test-qa-agent',
            timestamp: Date.now(),
          },
        }),
      };
      mockCreateQAAgent.mockReturnValue(mockAgent);
      mockCreateBugHuntPrompt.mockReturnValue({});

      // EXECUTE
      const result = await workflow.run();

      // VERIFY
      expect(mockCreateBugHuntPrompt).toHaveBeenCalledWith(
        'PRD content',
        [],
        undefined
      );
      expect(result).toEqual(expectedResult);
    });

    it('should preserve prdContent and completedTasks fields during run', async () => {
      // SETUP
      const prdContent = '# Test PRD\n## Requirements\nSome requirements';
      const completedTasks = [
        createTestTask('P1.M1.T1', 'Task 1'),
        createTestTask('P1.M2.T1', 'Task 2'),
      ];
      const workflow = new BugHuntWorkflow(prdContent, completedTasks);
      const mockAgent = {
        prompt: vi.fn().mockResolvedValue({
          status: 'success',
          data: {
            hasBugs: false,
            bugs: [],
            summary: 'No bugs',
            recommendations: [],
          },
          error: null,
          metadata: {
            agentId: 'test-qa-agent',
            timestamp: Date.now(),
          },
        }),
      };
      mockCreateQAAgent.mockReturnValue(mockAgent);
      mockCreateBugHuntPrompt.mockReturnValue({});

      // EXECUTE
      await workflow.run();

      // VERIFY
      expect(workflow.prdContent).toBe(prdContent);
      expect(workflow.completedTasks).toEqual(completedTasks);
    });

    it('should call writeBugReport when sessionPath provided and critical bugs found', async () => {
      // SETUP
      const workflow = new BugHuntWorkflow('PRD content', []);
      const testResults = createTestResults(
        true,
        [createTestBug('BUG-001', 'critical', 'Bug', 'Desc', 'Rep')],
        'Found bugs',
        ['Fix']
      );
      const mockAgent = {
        prompt: vi.fn().mockResolvedValue({
          status: 'success',
          data: testResults,
          error: null,
          metadata: {
            agentId: 'test-qa-agent',
            timestamp: Date.now(),
          },
        }),
      };
      mockCreateQAAgent.mockReturnValue(mockAgent);
      mockCreateBugHuntPrompt.mockReturnValue({});
      const writeBugReportSpy = vi.spyOn(workflow, 'writeBugReport');
      const sessionPath = '/path/to/session';

      // SETUP: Mock readFile for file-as-contract path
      mockReadFile.mockResolvedValue(JSON.stringify(testResults));
      // EXECUTE
      await workflow.run(sessionPath);

      // VERIFY
      expect(writeBugReportSpy).toHaveBeenCalledWith(sessionPath, testResults);
    });

    it('should call writeBugReport when sessionPath provided and major bugs found', async () => {
      // SETUP
      const workflow = new BugHuntWorkflow('PRD content', []);
      const testResults = createTestResults(
        true,
        [createTestBug('BUG-001', 'major', 'Bug', 'Desc', 'Rep')],
        'Found bugs',
        ['Fix']
      );
      const mockAgent = {
        prompt: vi.fn().mockResolvedValue({
          status: 'success',
          data: testResults,
          error: null,
          metadata: {
            agentId: 'test-qa-agent',
            timestamp: Date.now(),
          },
        }),
      };
      mockCreateQAAgent.mockReturnValue(mockAgent);
      mockCreateBugHuntPrompt.mockReturnValue({});
      const writeBugReportSpy = vi.spyOn(workflow, 'writeBugReport');

      mockReadFile.mockResolvedValue(JSON.stringify(testResults));

      // EXECUTE
      await workflow.run('/path/to/session');

      // VERIFY
      expect(writeBugReportSpy).toHaveBeenCalledWith(
        '/path/to/session',
        testResults
      );
    });

    it('should NOT call writeBugReport when sessionPath not provided', async () => {
      // SETUP
      const workflow = new BugHuntWorkflow('PRD content', []);
      const testResults = createTestResults(
        true,
        [createTestBug('BUG-001', 'critical', 'Bug', 'Desc', 'Rep')],
        'Found bugs',
        ['Fix']
      );
      const mockAgent = {
        prompt: vi.fn().mockResolvedValue({
          status: 'success',
          data: testResults,
          error: null,
          metadata: {
            agentId: 'test-qa-agent',
            timestamp: Date.now(),
          },
        }),
      };
      mockCreateQAAgent.mockReturnValue(mockAgent);
      mockCreateBugHuntPrompt.mockReturnValue({});
      const writeBugReportSpy = vi.spyOn(workflow, 'writeBugReport');

      // EXECUTE - call run() without sessionPath
      await workflow.run();

      // VERIFY
      expect(writeBugReportSpy).not.toHaveBeenCalled();
    });

    it('should NOT call writeBugReport when no critical or major bugs found', async () => {
      // SETUP
      const workflow = new BugHuntWorkflow('PRD content', []);
      // Only minor/cosmetic bugs - writeBugReport should skip write internally
      const testResults = createTestResults(
        false,
        [
          createTestBug('BUG-001', 'minor', 'Bug', 'Desc', 'Rep'),
          createTestBug('BUG-002', 'cosmetic', 'Bug 2', 'Desc 2', 'Rep 2'),
        ],
        'Found minor bugs',
        ['Fix']
      );
      const mockAgent = {
        prompt: vi.fn().mockResolvedValue({
          status: 'success',
          data: testResults,
          error: null,
          metadata: {
            agentId: 'test-qa-agent',
            timestamp: Date.now(),
          },
        }),
      };
      mockCreateQAAgent.mockReturnValue(mockAgent);
      mockCreateBugHuntPrompt.mockReturnValue({});
      const writeBugReportSpy = vi.spyOn(workflow, 'writeBugReport');

      // SETUP: Mock readFile for file-as-contract path
      mockReadFile.mockResolvedValue(JSON.stringify(testResults));

      // EXECUTE
      await workflow.run('/path/to/session');

      // VERIFY - writeBugReport is called, but it skips writing internally
      expect(writeBugReportSpy).toHaveBeenCalledWith(
        '/path/to/session',
        testResults
      );
      // Verify atomicWrite was not called (writeBugReport skips write for non-critical/major)
      expect(mockAtomicWrite).not.toHaveBeenCalled();
    });

    it('should still return testResults when writeBugReport called', async () => {
      // SETUP
      const workflow = new BugHuntWorkflow('PRD content', []);
      const expectedResult = createTestResults(
        true,
        [createTestBug('BUG-001', 'critical', 'Bug', 'Desc', 'Rep')],
        'Found bugs',
        ['Fix']
      );
      const mockAgent = {
        prompt: vi.fn().mockResolvedValue({
          status: 'success',
          data: expectedResult,
          error: null,
          metadata: {
            agentId: 'test-qa-agent',
            timestamp: Date.now(),
          },
        }),
      };
      mockCreateQAAgent.mockReturnValue(mockAgent);
      mockCreateBugHuntPrompt.mockReturnValue({});

      // SETUP: Mock readFile for file-as-contract path
      mockReadFile.mockResolvedValue(JSON.stringify(expectedResult));

      // EXECUTE
      const result = await workflow.run('/path/to/session');

      // VERIFY
      expect(result).toEqual(expectedResult);
    });

    it('should set status to failed if writeBugReport throws', async () => {
      // SETUP
      const workflow = new BugHuntWorkflow('PRD content', []);
      const testResults = createTestResults(
        true,
        [createTestBug('BUG-001', 'critical', 'Bug', 'Desc', 'Rep')],
        'Found bugs',
        ['Fix']
      );
      const mockAgent = {
        prompt: vi.fn().mockResolvedValue({
          status: 'success',
          data: testResults,
          error: null,
          metadata: {
            agentId: 'test-qa-agent',
            timestamp: Date.now(),
          },
        }),
      };
      mockCreateQAAgent.mockReturnValue(mockAgent);
      mockCreateBugHuntPrompt.mockReturnValue({});
      const writeBugReportSpy = vi.spyOn(workflow, 'writeBugReport');
      writeBugReportSpy.mockRejectedValue(new Error('Write failed'));

      // SETUP: Mock readFile for file-as-contract path
      mockReadFile.mockResolvedValue(JSON.stringify(testResults));

      // EXECUTE
      try {
        await workflow.run('/path/to/session');
      } catch {
        // Expected error
      }

      // VERIFY
      expect(workflow.status).toBe('failed');
    });

    it('should log write operation when sessionPath provided', async () => {
      // SETUP
      const workflow = new BugHuntWorkflow('PRD content', []);
      const testResults = createTestResults(
        true,
        [createTestBug('BUG-001', 'critical', 'Bug', 'Desc', 'Rep')],
        'Found bugs',
        ['Fix']
      );
      const mockAgent = {
        prompt: vi.fn().mockResolvedValue({
          status: 'success',
          data: testResults,
          error: null,
          metadata: {
            agentId: 'test-qa-agent',
            timestamp: Date.now(),
          },
        }),
      };
      mockCreateQAAgent.mockReturnValue(mockAgent);
      mockCreateBugHuntPrompt.mockReturnValue({});
      const logSpy = vi.spyOn((workflow as any).correlationLogger, 'info');
      const sessionPath = '/test/session/path';

      mockReadFile.mockResolvedValue(JSON.stringify(testResults));

      // EXECUTE
      await workflow.run(sessionPath);

      // VERIFY
      expect(logSpy).toHaveBeenCalledWith(
        `[BugHuntWorkflow] Writing TEST_RESULTS.md to ${sessionPath}`
      );
    });

    it('should maintain backward compatibility - run() without sessionPath', async () => {
      // SETUP
      const workflow = new BugHuntWorkflow('PRD content', []);
      const expectedResult = createTestResults(
        true,
        [createTestBug('BUG-001', 'critical', 'Bug', 'Desc', 'Rep')],
        'Found bugs',
        ['Fix']
      );
      const mockAgent = {
        prompt: vi.fn().mockResolvedValue({
          status: 'success',
          data: expectedResult,
          error: null,
          metadata: {
            agentId: 'test-qa-agent',
            timestamp: Date.now(),
          },
        }),
      };
      mockCreateQAAgent.mockReturnValue(mockAgent);
      mockCreateBugHuntPrompt.mockReturnValue({});

      // EXECUTE - call without sessionPath (backward compatible)
      const result = await workflow.run();

      // VERIFY
      expect(result).toEqual(expectedResult);
      expect(workflow.status).toBe('completed');
    });

    it('should pass correct sessionPath and testResults to writeBugReport', async () => {
      // SETUP
      const workflow = new BugHuntWorkflow('PRD content', []);
      const testResults = createTestResults(
        true,
        [
          createTestBug('BUG-001', 'critical', 'Bug 1', 'Desc 1', 'Rep 1'),
          createTestBug('BUG-002', 'major', 'Bug 2', 'Desc 2', 'Rep 2'),
        ],
        'Found multiple bugs',
        ['Fix all']
      );
      const mockAgent = {
        prompt: vi.fn().mockResolvedValue({
          status: 'success',
          data: testResults,
          error: null,
          metadata: {
            agentId: 'test-qa-agent',
            timestamp: Date.now(),
          },
        }),
      };
      mockCreateQAAgent.mockReturnValue(mockAgent);
      mockCreateBugHuntPrompt.mockReturnValue({});
      const writeBugReportSpy = vi.spyOn(workflow, 'writeBugReport');
      const sessionPath = '/custom/session/path';

      mockReadFile.mockResolvedValue(JSON.stringify(testResults));

      // EXECUTE
      await workflow.run(sessionPath);

      // VERIFY
      expect(writeBugReportSpy).toHaveBeenCalledTimes(1);
      expect(writeBugReportSpy).toHaveBeenCalledWith(sessionPath, testResults);
    });
  });

  describe('writeBugReport', () => {
    it('should throw if sessionPath is empty', async () => {
      // SETUP
      const workflow = new BugHuntWorkflow('PRD content', []);
      const testResults = createTestResults(
        true,
        [createTestBug('BUG-001', 'critical', 'Bug', 'Desc', 'Rep')],
        'Found bugs',
        ['Fix']
      );

      // EXECUTE & VERIFY
      await expect(workflow.writeBugReport('', testResults)).rejects.toThrow(
        'sessionPath must be a non-empty string'
      );
    });

    it('should throw if sessionPath is only whitespace', async () => {
      // SETUP
      const workflow = new BugHuntWorkflow('PRD content', []);
      const testResults = createTestResults(
        true,
        [createTestBug('BUG-001', 'critical', 'Bug', 'Desc', 'Rep')],
        'Found bugs',
        ['Fix']
      );

      // EXECUTE & VERIFY
      await expect(workflow.writeBugReport('   ', testResults)).rejects.toThrow(
        'sessionPath must be a non-empty string'
      );
    });

    it('should not write if no critical or major bugs (hasBugs false)', async () => {
      // SETUP
      const workflow = new BugHuntWorkflow('PRD content', []);
      const testResults = createTestResults(
        false,
        [createTestBug('BUG-001', 'minor', 'Bug', 'Desc', 'Rep')],
        'Found minor bugs',
        ['Fix']
      );

      // EXECUTE
      await workflow.writeBugReport('/path/to/session', testResults);

      // VERIFY - atomicWrite should not be called
      expect(mockAtomicWrite).not.toHaveBeenCalled();
    });

    it('should not write if no critical or major bugs (only cosmetic)', async () => {
      // SETUP
      const workflow = new BugHuntWorkflow('PRD content', []);
      const testResults = createTestResults(
        false,
        [
          createTestBug('BUG-001', 'cosmetic', 'Bug 1', 'Desc 1', 'Rep 1'),
          createTestBug('BUG-002', 'minor', 'Bug 2', 'Desc 2', 'Rep 2'),
        ],
        'Found minor bugs',
        ['Fix']
      );

      // EXECUTE
      await workflow.writeBugReport('/path/to/session', testResults);

      // VERIFY - atomicWrite should not be called
      expect(mockAtomicWrite).not.toHaveBeenCalled();
    });

    it('should write if critical bugs are present', async () => {
      // SETUP
      const workflow = new BugHuntWorkflow('PRD content', []);
      const testResults = createTestResults(
        true,
        [createTestBug('BUG-001', 'critical', 'Bug', 'Desc', 'Rep')],
        'Found bugs',
        ['Fix']
      );
      const sessionPath = '/path/to/session';

      // EXECUTE
      await workflow.writeBugReport(sessionPath, testResults);

      // VERIFY
      const expectedPath = '/path/to/session/TEST_RESULTS.md';
      const expectedContent = JSON.stringify(testResults, null, 2);
      expect(mockAtomicWrite).toHaveBeenCalledWith(
        expectedPath,
        expectedContent
      );
    });

    it('should write if major bugs are present', async () => {
      // SETUP
      const workflow = new BugHuntWorkflow('PRD content', []);
      const testResults = createTestResults(
        true,
        [createTestBug('BUG-001', 'major', 'Bug', 'Desc', 'Rep')],
        'Found bugs',
        ['Fix']
      );
      const sessionPath = '/path/to/session';

      // EXECUTE
      await workflow.writeBugReport(sessionPath, testResults);

      // VERIFY
      const expectedPath = '/path/to/session/TEST_RESULTS.md';
      const expectedContent = JSON.stringify(testResults, null, 2);
      expect(mockAtomicWrite).toHaveBeenCalledWith(
        expectedPath,
        expectedContent
      );
    });

    it('should construct correct file path with resolve()', async () => {
      // SETUP
      const workflow = new BugHuntWorkflow('PRD content', []);
      const testResults = createTestResults(
        true,
        [createTestBug('BUG-001', 'critical', 'Bug', 'Desc', 'Rep')],
        'Found bugs',
        ['Fix']
      );
      const sessionPath = '/absolute/path/to/session';

      // EXECUTE
      await workflow.writeBugReport(sessionPath, testResults);

      // VERIFY
      expect(mockAtomicWrite).toHaveBeenCalledWith(
        '/absolute/path/to/session/TEST_RESULTS.md',
        expect.any(String)
      );
    });

    it('should call atomicWrite with correct parameters', async () => {
      // SETUP
      const workflow = new BugHuntWorkflow('PRD content', []);
      const testResults = createTestResults(
        true,
        [
          createTestBug('BUG-001', 'critical', 'Bug 1', 'Desc 1', 'Rep 1'),
          createTestBug('BUG-002', 'major', 'Bug 2', 'Desc 2', 'Rep 2'),
        ],
        'Found bugs',
        ['Fix']
      );
      const sessionPath = '/path/to/session';

      // EXECUTE
      await workflow.writeBugReport(sessionPath, testResults);

      // VERIFY
      const expectedContent = JSON.stringify(testResults, null, 2);
      expect(mockAtomicWrite).toHaveBeenCalledWith(
        '/path/to/session/TEST_RESULTS.md',
        expectedContent
      );
    });

    it('should log success message on successful write', async () => {
      // SETUP
      const workflow = new BugHuntWorkflow('PRD content', []);
      const testResults = createTestResults(
        true,
        [
          createTestBug('BUG-001', 'critical', 'Bug 1', 'Desc 1', 'Rep 1'),
          createTestBug('BUG-002', 'major', 'Bug 2', 'Desc 2', 'Rep 2'),
          createTestBug('BUG-003', 'minor', 'Bug 3', 'Desc 3', 'Rep 3'),
        ],
        'Found bugs',
        ['Fix']
      );
      const logSpy = vi.spyOn((workflow as any).correlationLogger, 'info');

      // EXECUTE
      await workflow.writeBugReport('/path/to/session', testResults);

      // VERIFY - should log writing and success
      expect(logSpy).toHaveBeenCalledWith(
        '[BugHuntWorkflow] Writing bug report',
        expect.objectContaining({
          resultsPath: '/path/to/session/TEST_RESULTS.md',
          hasBugs: true,
          bugCount: 3,
          criticalCount: 1,
          majorCount: 1,
        })
      );
      expect(logSpy).toHaveBeenCalledWith(
        '[BugHuntWorkflow] Bug report written successfully',
        { resultsPath: '/path/to/session/TEST_RESULTS.md' }
      );
    });

    it('should throw descriptive error on atomicWrite failure', async () => {
      // SETUP
      const workflow = new BugHuntWorkflow('PRD content', []);
      const testResults = createTestResults(
        true,
        [createTestBug('BUG-001', 'critical', 'Bug', 'Desc', 'Rep')],
        'Found bugs',
        ['Fix']
      );
      const writeError = new Error('EACCES: permission denied');
      mockAtomicWrite.mockRejectedValue(writeError);
      const logSpy = vi.spyOn((workflow as any).correlationLogger, 'error');

      // EXECUTE & VERIFY
      await expect(
        workflow.writeBugReport('/path/to/session', testResults)
      ).rejects.toThrow(
        'Failed to write bug report to /path/to/session/TEST_RESULTS.md: EACCES: permission denied'
      );

      // VERIFY error was logged
      expect(logSpy).toHaveBeenCalledWith(
        '[BugHuntWorkflow] Failed to write bug report',
        {
          error: 'EACCES: permission denied',
          resultsPath: '/path/to/session/TEST_RESULTS.md',
        }
      );
    });

    it('should validate testResults with TestResultsSchema', async () => {
      // SETUP
      const workflow = new BugHuntWorkflow('PRD content', []);
      // Create invalid TestResults (missing required fields)
      // Must include a critical bug to reach validation code
      const invalidResults = {
        hasBugs: true,
        bugs: [createTestBug('BUG-001', 'critical', 'Bug', 'Desc', 'Rep')],
        // Missing summary (required by schema)
        recommendations: [],
      } as any;

      // EXECUTE & VERIFY
      await expect(
        workflow.writeBugReport('/path/to/session', invalidResults)
      ).rejects.toThrow('Invalid TestResults provided to writeBugReport');
    });

    it('should pass sessionPath and testResults correctly', async () => {
      // SETUP
      const workflow = new BugHuntWorkflow('PRD content', []);
      const testResults = createTestResults(
        true,
        [createTestBug('BUG-001', 'critical', 'Bug', 'Desc', 'Rep')],
        'Found bugs',
        ['Fix']
      );
      const sessionPath = '/custom/session/path';

      // EXECUTE
      await workflow.writeBugReport(sessionPath, testResults);

      // VERIFY
      expect(mockAtomicWrite).toHaveBeenCalledWith(
        '/custom/session/path/TEST_RESULTS.md',
        JSON.stringify(testResults, null, 2)
      );
    });

    it('should handle multiple critical and major bugs', async () => {
      // SETUP
      const workflow = new BugHuntWorkflow('PRD content', []);
      const testResults = createTestResults(
        true,
        [
          createTestBug('BUG-001', 'critical', 'Bug 1', 'Desc 1', 'Rep 1'),
          createTestBug('BUG-002', 'critical', 'Bug 2', 'Desc 2', 'Rep 2'),
          createTestBug('BUG-003', 'major', 'Bug 3', 'Desc 3', 'Rep 3'),
          createTestBug('BUG-004', 'major', 'Bug 4', 'Desc 4', 'Rep 4'),
          createTestBug('BUG-005', 'minor', 'Bug 5', 'Desc 5', 'Rep 5'),
        ],
        'Found multiple bugs',
        ['Fix all']
      );
      const logSpy = vi.spyOn((workflow as any).correlationLogger, 'info');

      // EXECUTE
      await workflow.writeBugReport('/path/to/session', testResults);

      // VERIFY - should log correct counts
      expect(logSpy).toHaveBeenCalledWith(
        '[BugHuntWorkflow] Writing bug report',
        expect.objectContaining({
          bugCount: 5,
          criticalCount: 2,
          majorCount: 2,
        })
      );
      expect(mockAtomicWrite).toHaveBeenCalled();
    });

    // ========================================================================
    // Enhancement Tests - Added for comprehensive coverage
    // ========================================================================

    describe('logging behavior - skip conditions', () => {
      it('should log skip message when only minor bugs present', async () => {
        // SETUP
        const workflow = new BugHuntWorkflow('PRD content', []);
        const testResults = createTestResults(
          false,
          [createTestBug('BUG-001', 'minor', 'Bug', 'Desc', 'Rep')],
          'Found minor bugs',
          ['Fix']
        );
        const logSpy = vi.spyOn((workflow as any).correlationLogger, 'info');

        // EXECUTE
        await workflow.writeBugReport('/path/to/session', testResults);

        // VERIFY - skip message should be logged
        expect(logSpy).toHaveBeenCalledWith(
          '[BugHuntWorkflow] No critical or major bugs - skipping bug report write'
        );
        expect(mockAtomicWrite).not.toHaveBeenCalled();
      });

      it('should log skip message when only cosmetic bugs present', async () => {
        // SETUP
        const workflow = new BugHuntWorkflow('PRD content', []);
        const testResults = createTestResults(
          false,
          [createTestBug('BUG-001', 'cosmetic', 'Bug', 'Desc', 'Rep')],
          'Found cosmetic bugs',
          ['Fix']
        );
        const logSpy = vi.spyOn((workflow as any).correlationLogger, 'info');

        // EXECUTE
        await workflow.writeBugReport('/path/to/session', testResults);

        // VERIFY
        expect(logSpy).toHaveBeenCalledWith(
          '[BugHuntWorkflow] No critical or major bugs - skipping bug report write'
        );
        expect(mockAtomicWrite).not.toHaveBeenCalled();
      });

      it('should log skip message when bugs array is empty', async () => {
        // SETUP
        const workflow = new BugHuntWorkflow('PRD content', []);
        const testResults = createTestResults(false, [], 'No bugs found', []);
        const logSpy = vi.spyOn((workflow as any).correlationLogger, 'info');

        // EXECUTE
        await workflow.writeBugReport('/path/to/session', testResults);

        // VERIFY
        expect(logSpy).toHaveBeenCalledWith(
          '[BugHuntWorkflow] No critical or major bugs - skipping bug report write'
        );
        expect(mockAtomicWrite).not.toHaveBeenCalled();
      });
    });

    describe('input validation - non-string sessionPath', () => {
      it('should throw if sessionPath is not a string', async () => {
        // SETUP
        const workflow = new BugHuntWorkflow('PRD content', []);
        const testResults = createTestResults(
          true,
          [createTestBug('BUG-001', 'critical', 'Bug', 'Desc', 'Rep')],
          'Found bugs',
          ['Fix']
        );

        // EXECUTE & VERIFY
        await expect(
          workflow.writeBugReport(null as any, testResults)
        ).rejects.toThrow('sessionPath must be a non-empty string');

        await expect(
          workflow.writeBugReport(undefined as any, testResults)
        ).rejects.toThrow('sessionPath must be a non-empty string');

        await expect(
          workflow.writeBugReport(123 as any, testResults)
        ).rejects.toThrow('sessionPath must be a non-empty string');

        await expect(
          workflow.writeBugReport({} as any, testResults)
        ).rejects.toThrow('sessionPath must be a non-empty string');
      });
    });

    describe('path construction - relative paths', () => {
      it('should handle relative paths correctly', async () => {
        // SETUP
        const workflow = new BugHuntWorkflow('PRD content', []);
        const testResults = createTestResults(
          true,
          [createTestBug('BUG-001', 'critical', 'Bug', 'Desc', 'Rep')],
          'Found bugs',
          ['Fix']
        );
        const relativePath = 'relative/path/to/session';

        // EXECUTE
        await workflow.writeBugReport(relativePath, testResults);

        // VERIFY - resolve() should convert to absolute path
        expect(mockAtomicWrite).toHaveBeenCalledWith(
          expect.stringContaining('relative/path/to/session/TEST_RESULTS.md'),
          expect.any(String)
        );
      });

      it('should handle paths with trailing slash', async () => {
        // SETUP
        const workflow = new BugHuntWorkflow('PRD content', []);
        const testResults = createTestResults(
          true,
          [createTestBug('BUG-001', 'critical', 'Bug', 'Desc', 'Rep')],
          'Found bugs',
          ['Fix']
        );
        const sessionPath = '/path/to/session/';

        // EXECUTE
        await workflow.writeBugReport(sessionPath, testResults);

        // VERIFY - resolve() normalizes the path
        expect(mockAtomicWrite).toHaveBeenCalledWith(
          expect.stringMatching(/\/path\/to\/session.*TEST_RESULTS\.md$/),
          expect.any(String)
        );
      });

      it('should handle paths with dot segments', async () => {
        // SETUP
        const workflow = new BugHuntWorkflow('PRD content', []);
        const testResults = createTestResults(
          true,
          [createTestBug('BUG-001', 'critical', 'Bug', 'Desc', 'Rep')],
          'Found bugs',
          ['Fix']
        );
        const sessionPath = '/path/to/../session';

        // EXECUTE
        await workflow.writeBugReport(sessionPath, testResults);

        // VERIFY - resolve() normalizes the path
        expect(mockAtomicWrite).toHaveBeenCalledWith(
          expect.stringMatching(/\/path\/session.*TEST_RESULTS\.md$/),
          expect.any(String)
        );
      });
    });

    describe('atomic write pattern verification', () => {
      it('should use atomicWrite utility for file operations', async () => {
        // SETUP
        const workflow = new BugHuntWorkflow('PRD content', []);
        const testResults = createTestResults(
          true,
          [createTestBug('BUG-001', 'critical', 'Bug', 'Desc', 'Rep')],
          'Found bugs',
          ['Fix']
        );
        const sessionPath = '/path/to/session';

        // EXECUTE
        await workflow.writeBugReport(sessionPath, testResults);

        // VERIFY - atomicWrite should be called (not direct fs operations)
        expect(mockAtomicWrite).toHaveBeenCalledTimes(1);
        expect(mockAtomicWrite).toHaveBeenCalledWith(
          '/path/to/session/TEST_RESULTS.md',
          JSON.stringify(testResults, null, 2)
        );
      });

      it('should serialize TestResults with 2-space indentation', async () => {
        // SETUP
        const workflow = new BugHuntWorkflow('PRD content', []);
        const testResults = createTestResults(
          true,
          [createTestBug('BUG-001', 'critical', 'Bug', 'Desc', 'Rep')],
          'Found bugs',
          ['Fix']
        );

        // EXECUTE
        await workflow.writeBugReport('/path/to/session', testResults);

        // VERIFY - content should be JSON with 2-space indentation
        const expectedContent = JSON.stringify(testResults, null, 2);
        expect(mockAtomicWrite).toHaveBeenCalledWith(
          expect.any(String),
          expectedContent
        );

        // Verify indentation - top-level properties use 2 spaces
        expect(mockAtomicWrite.mock.calls[0][1]).toContain('  "hasBugs"');
        expect(mockAtomicWrite.mock.calls[0][1]).toContain('  "bugs"');
        expect(mockAtomicWrite.mock.calls[0][1]).not.toContain('    "hasBugs"'); // top-level not 4 spaces
      });
    });

    describe('Zod schema validation - comprehensive tests', () => {
      it('should throw when summary is missing', async () => {
        // SETUP
        const workflow = new BugHuntWorkflow('PRD content', []);
        const invalidResults = {
          hasBugs: true,
          bugs: [createTestBug('BUG-001', 'critical', 'Bug', 'Desc', 'Rep')],
          // summary is missing - required by schema
          recommendations: [],
        } as any;

        // EXECUTE & VERIFY
        await expect(
          workflow.writeBugReport('/path/to/session', invalidResults)
        ).rejects.toThrow('Invalid TestResults provided to writeBugReport');
      });

      it('should throw when summary is empty string', async () => {
        // SETUP
        const workflow = new BugHuntWorkflow('PRD content', []);
        const invalidResults = createTestResults(
          true,
          [createTestBug('BUG-001', 'critical', 'Bug', 'Desc', 'Rep')],
          '', // Empty summary violates Zod schema (nonEmpty)
          []
        );

        // EXECUTE & VERIFY
        await expect(
          workflow.writeBugReport('/path/to/session', invalidResults)
        ).rejects.toThrow('Invalid TestResults provided to writeBugReport');
      });

      it('should throw when bugs array contains invalid bug structure', async () => {
        // SETUP
        const workflow = new BugHuntWorkflow('PRD content', []);
        // Create an invalid bug - include severity but missing other required fields
        // Must include 'critical' severity to reach validation code (after severity check)
        const invalidResults = {
          hasBugs: true,
          bugs: [
            {
              severity: 'critical',
              // Missing: id, title, description, reproduction
            },
          ] as any,
          summary: 'Found bugs',
          recommendations: [],
        };

        // EXECUTE & VERIFY
        await expect(
          workflow.writeBugReport('/path/to/session', invalidResults)
        ).rejects.toThrow('Invalid TestResults provided to writeBugReport');
      });

      it('should accept valid TestResults with all required fields', async () => {
        // SETUP
        const workflow = new BugHuntWorkflow('PRD content', []);
        const validResults = createTestResults(
          true,
          [
            createTestBug(
              'BUG-001',
              'critical',
              'Authentication Bug',
              'Login fails with valid credentials',
              '1. Go to login page\n2. Enter valid credentials\n3. Click login'
            ),
          ],
          'Found 1 critical bug in authentication system',
          ['Fix authentication service', 'Add unit tests for login flow']
        );

        // EXECUTE - should not throw
        await workflow.writeBugReport('/path/to/session', validResults);

        // VERIFY
        expect(mockAtomicWrite).toHaveBeenCalled();
      });
    });

    describe('error handling - comprehensive edge cases', () => {
      it('should handle error when atomicWrite rejects with Error object', async () => {
        // SETUP
        const workflow = new BugHuntWorkflow('PRD content', []);
        const testResults = createTestResults(
          true,
          [createTestBug('BUG-001', 'critical', 'Bug', 'Desc', 'Rep')],
          'Found bugs',
          ['Fix']
        );
        const writeError = new Error('ENOSPC: no space left on device');
        mockAtomicWrite.mockRejectedValue(writeError);
        const logSpy = vi.spyOn((workflow as any).correlationLogger, 'error');

        // EXECUTE & VERIFY
        await expect(
          workflow.writeBugReport('/path/to/session', testResults)
        ).rejects.toThrow(
          'Failed to write bug report to /path/to/session/TEST_RESULTS.md: ENOSPC: no space left on device'
        );

        expect(logSpy).toHaveBeenCalledWith(
          '[BugHuntWorkflow] Failed to write bug report',
          {
            error: 'ENOSPC: no space left on device',
            resultsPath: '/path/to/session/TEST_RESULTS.md',
          }
        );
      });

      it('should handle error when atomicWrite rejects with string', async () => {
        // SETUP
        const workflow = new BugHuntWorkflow('PRD content', []);
        const testResults = createTestResults(
          true,
          [createTestBug('BUG-001', 'critical', 'Bug', 'Desc', 'Rep')],
          'Found bugs',
          ['Fix']
        );
        mockAtomicWrite.mockRejectedValue('String error message');

        // EXECUTE & VERIFY
        await expect(
          workflow.writeBugReport('/path/to/session', testResults)
        ).rejects.toThrow(
          'Failed to write bug report to /path/to/session/TEST_RESULTS.md: String error message'
        );
      });

      it('should handle error when atomicWrite rejects with non-Error object', async () => {
        // SETUP
        const workflow = new BugHuntWorkflow('PRD content', []);
        const testResults = createTestResults(
          true,
          [createTestBug('BUG-001', 'critical', 'Bug', 'Desc', 'Rep')],
          'Found bugs',
          ['Fix']
        );
        mockAtomicWrite.mockRejectedValue({
          code: 'EIO',
          message: 'I/O error',
        });

        // EXECUTE & VERIFY
        await expect(
          workflow.writeBugReport('/path/to/session', testResults)
        ).rejects.toThrow(
          'Failed to write bug report to /path/to/session/TEST_RESULTS.md: I/O error (EIO)'
        );
      });
    });

    describe('edge cases', () => {
      it('should handle empty recommendations array', async () => {
        // SETUP
        const workflow = new BugHuntWorkflow('PRD content', []);
        const testResults = createTestResults(
          true,
          [createTestBug('BUG-001', 'critical', 'Bug', 'Desc', 'Rep')],
          'Found bugs',
          [] // Empty recommendations is valid
        );

        // EXECUTE - should not throw
        await workflow.writeBugReport('/path/to/session', testResults);

        // VERIFY
        expect(mockAtomicWrite).toHaveBeenCalled();
        const content = mockAtomicWrite.mock.calls[0][1];
        expect(content).toContain('"recommendations": []');
      });

      it('should handle special characters in summary', async () => {
        // SETUP
        const workflow = new BugHuntWorkflow('PRD content', []);
        const testResults = createTestResults(
          true,
          [createTestBug('BUG-001', 'critical', 'Bug', 'Desc', 'Rep')],
          'Found bugs with special chars: <>&"\'\n\t\\', // Various special chars
          ['Fix']
        );

        // EXECUTE
        await workflow.writeBugReport('/path/to/session', testResults);

        // VERIFY - special characters should be properly escaped in JSON
        expect(mockAtomicWrite).toHaveBeenCalled();
        const content = mockAtomicWrite.mock.calls[0][1];
        expect(content).toContain('Found bugs with special chars');
      });

      it('should handle long summary text', async () => {
        // SETUP
        const workflow = new BugHuntWorkflow('PRD content', []);
        const longSummary = 'A'.repeat(10000); // Very long summary
        const testResults = createTestResults(
          true,
          [createTestBug('BUG-001', 'critical', 'Bug', 'Desc', 'Rep')],
          longSummary,
          ['Fix']
        );

        // EXECUTE
        await workflow.writeBugReport('/path/to/session', testResults);

        // VERIFY
        expect(mockAtomicWrite).toHaveBeenCalled();
        const content = mockAtomicWrite.mock.calls[0][1];
        expect(content).toContain(longSummary);
      });

      it('should handle mixed severity bugs correctly', async () => {
        // SETUP
        const workflow = new BugHuntWorkflow('PRD content', []);
        const testResults = createTestResults(
          true,
          [
            createTestBug('BUG-001', 'critical', 'Critical Bug', 'Desc', 'Rep'),
            createTestBug('BUG-002', 'major', 'Major Bug', 'Desc', 'Rep'),
            createTestBug('BUG-003', 'minor', 'Minor Bug', 'Desc', 'Rep'),
            createTestBug('BUG-004', 'cosmetic', 'Cosmetic Bug', 'Desc', 'Rep'),
          ],
          'Found bugs of all severities',
          ['Fix all']
        );

        // EXECUTE - should write because has critical/major
        await workflow.writeBugReport('/path/to/session', testResults);

        // VERIFY
        expect(mockAtomicWrite).toHaveBeenCalled();

        // Verify bug count logging includes all bugs
        const logSpy = vi.spyOn((workflow as any).correlationLogger, 'info');
        await workflow.writeBugReport('/path/to/session', testResults);
        expect(logSpy).toHaveBeenCalledWith(
          '[BugHuntWorkflow] Writing bug report',
          expect.objectContaining({
            bugCount: 4,
            criticalCount: 1,
            majorCount: 1,
          })
        );
      });

      it('should handle unicode characters in bug data', async () => {
        // SETUP
        const workflow = new BugHuntWorkflow('PRD content', []);
        const testResults = createTestResults(
          true,
          [
            createTestBug(
              'BUG-001',
              'critical',
              'Unicode Bug 🐛',
              'Description with emoji: 🎉 🔥',
              'Reproduction with unicode: café, naïve'
            ),
          ],
          'Found unicode bugs',
          ['修复', '修复问题'] // Chinese characters
        );

        // EXECUTE
        await workflow.writeBugReport('/path/to/session', testResults);

        // VERIFY - unicode should be preserved
        expect(mockAtomicWrite).toHaveBeenCalled();
        const content = mockAtomicWrite.mock.calls[0][1];
        expect(content).toContain('🐛');
        expect(content).toContain('修复');
      });

      it('should handle recommendations with special characters', async () => {
        // SETUP
        const workflow = new BugHuntWorkflow('PRD content', []);
        const testResults = createTestResults(
          true,
          [createTestBug('BUG-001', 'critical', 'Bug', 'Desc', 'Rep')],
          'Found bugs',
          [
            'Fix the authentication bug in /src/auth/login.ts:45',
            'Add tests: npm run test:auth',
            'See docs: https://docs.example.com/auth',
          ]
        );

        // EXECUTE
        await workflow.writeBugReport('/path/to/session', testResults);

        // VERIFY
        expect(mockAtomicWrite).toHaveBeenCalled();
        const content = mockAtomicWrite.mock.calls[0][1];
        expect(content).toContain('/src/auth/login.ts:45');
        expect(content).toContain('npm run test:auth');
        expect(content).toContain('https://docs.example.com/auth');
      });
    });
  });

  // ========================================================================
  // PRD §4.4 — NO_ISSUES_FOUND.md marker (recordQAMarker orchestrator)
  // ========================================================================
  describe('recordQAMarker / NO_ISSUES_FOUND marker', () => {
    it('CLEAN (empty bugs): writes marker + commits it', async () => {
      // SETUP
      const workflow = new BugHuntWorkflow('PRD content', []);
      const testResults = createTestResults(false, [], 'No bugs found', []);
      const sessionPath = '/path/to/session';
      // tasks.json present → real sha256
      mockReadFile.mockResolvedValue('{"tasks":[]}');

      // EXECUTE
      await workflow.recordQAMarker(sessionPath, testResults);

      // VERIFY — marker written via atomicWrite
      expect(mockAtomicWrite).toHaveBeenCalledWith(
        '/path/to/session/NO_ISSUES_FOUND.md',
        expect.stringContaining('# No Issues Found')
      );
      const content = mockAtomicWrite.mock.calls[0][1];
      expect(content).toMatch(/\*\*Timestamp:\*\* \d{4}-\d{2}-\d{2}T/); // ISO
      expect(content).toContain('**Session path tested:** /path/to/session');
      // 64-char hex sha256 from the tasks.json content above
      expect(content).toMatch(
        /\*\*tasks\.json hash \(SHA-256\):\*\* [0-9a-f]{64}/
      );
      expect(content).toContain('**Bug-finder agent:** pizr'); // getBugFinderAgent default

      // VERIFY — committed via smartCommit (fixed message)
      expect(mockSmartCommit).toHaveBeenCalledTimes(1);
      expect(mockSmartCommit).toHaveBeenCalledWith(
        sessionPath,
        'chore(qa): bug hunt clean — no issues found (NO_ISSUES_FOUND.md)'
      );

      // VERIFY — remove path NOT taken (unlink not called)
      expect(mockUnlink).not.toHaveBeenCalled();
    });

    it('CLEAN (cosmetic-only): still clean per CONTRACT → marker written', async () => {
      // SETUP — cosmetic bugs are NOT critical/major/minor → clean
      const workflow = new BugHuntWorkflow('PRD content', []);
      const testResults = createTestResults(
        false,
        [
          createTestBug('BUG-001', 'cosmetic', 'C1', 'D1', 'R1'),
          createTestBug('BUG-002', 'cosmetic', 'C2', 'D2', 'R2'),
        ],
        'Cosmetic only',
        ['Polish']
      );
      mockReadFile.mockResolvedValue('{"tasks":[]}');

      // EXECUTE
      await workflow.recordQAMarker('/path/to/session', testResults);

      // VERIFY — marker written + committed despite cosmetic bugs
      expect(mockAtomicWrite).toHaveBeenCalledWith(
        '/path/to/session/NO_ISSUES_FOUND.md',
        expect.any(String)
      );
      expect(mockSmartCommit).toHaveBeenCalledTimes(1);
      expect(mockUnlink).not.toHaveBeenCalled();
    });

    it('BUGS (critical): NOT clean → removes stale marker, no commit', async () => {
      // SETUP
      const workflow = new BugHuntWorkflow('PRD content', []);
      const testResults = createTestResults(
        true,
        [createTestBug('BUG-001', 'critical', 'Bug', 'Desc', 'Rep')],
        'Found bugs',
        ['Fix']
      );
      // A prior marker exists → unlink succeeds
      mockUnlink.mockResolvedValue(undefined);

      // EXECUTE
      await workflow.recordQAMarker('/path/to/session', testResults);

      // VERIFY — stale marker removed
      expect(mockUnlink).toHaveBeenCalledWith(
        '/path/to/session/NO_ISSUES_FOUND.md'
      );
      // VERIFY — no clean-marker write / no commit
      expect(mockAtomicWrite).not.toHaveBeenCalled();
      expect(mockSmartCommit).not.toHaveBeenCalled();
    });

    it('BUGS (minor): NOT clean → removes stale marker, no commit', async () => {
      // SETUP — minor counts as actionable per CONTRACT → not clean
      const workflow = new BugHuntWorkflow('PRD content', []);
      const testResults = createTestResults(
        false,
        [createTestBug('BUG-001', 'minor', 'Bug', 'Desc', 'Rep')],
        'Minor bug',
        ['Fix']
      );
      mockUnlink.mockResolvedValue(undefined);

      // EXECUTE
      await workflow.recordQAMarker('/path/to/session', testResults);

      // VERIFY
      expect(mockUnlink).toHaveBeenCalledWith(
        '/path/to/session/NO_ISSUES_FOUND.md'
      );
      expect(mockSmartCommit).not.toHaveBeenCalled();
      expect(mockAtomicWrite).not.toHaveBeenCalled();
    });

    it('tasks.json MISSING: marker still written with sentinel hash', async () => {
      // SETUP
      const workflow = new BugHuntWorkflow('PRD content', []);
      const testResults = createTestResults(false, [], 'No bugs found', []);
      // tasks.json read rejects → sentinel hash path
      mockReadFile.mockRejectedValue(
        Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      );

      // EXECUTE
      await workflow.recordQAMarker('/path/to/session', testResults);

      // VERIFY — marker written with sentinel hash
      expect(mockAtomicWrite).toHaveBeenCalledWith(
        '/path/to/session/NO_ISSUES_FOUND.md',
        expect.stringContaining(
          '**tasks.json hash (SHA-256):** tasks.json-not-found'
        )
      );
      expect(mockSmartCommit).toHaveBeenCalledTimes(1);
    });

    it('removeNoIssuesMarker: ENOENT-tolerant (no throw, no error log)', async () => {
      // SETUP
      const workflow = new BugHuntWorkflow('PRD content', []);
      mockUnlink.mockRejectedValue(
        Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      );
      const errorSpy = vi.spyOn((workflow as any).correlationLogger, 'error');

      // EXECUTE & VERIFY — resolves without throwing
      await expect(
        workflow.removeNoIssuesMarker('/path/to/session')
      ).resolves.toBeUndefined();
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('removeNoIssuesMarker: real failure (EACCES) → throws + logs', async () => {
      // SETUP
      const workflow = new BugHuntWorkflow('PRD content', []);
      mockUnlink.mockRejectedValue(
        Object.assign(new Error('EACCES: denied'), { code: 'EACCES' })
      );
      const errorSpy = vi.spyOn((workflow as any).correlationLogger, 'error');

      // EXECUTE & VERIFY
      await expect(
        workflow.removeNoIssuesMarker('/path/to/session')
      ).rejects.toThrow(
        'Failed to remove marker /path/to/session/NO_ISSUES_FOUND.md: EACCES: denied'
      );
      expect(errorSpy).toHaveBeenCalledWith(
        '[BugHuntWorkflow] Failed to remove NO_ISSUES_FOUND.md marker',
        {
          markerPath: '/path/to/session/NO_ISSUES_FOUND.md',
          error: 'EACCES: denied',
        }
      );
    });

    it('smartCommit returns null: recordQAMarker still resolves (non-fatal)', async () => {
      // SETUP
      const workflow = new BugHuntWorkflow('PRD content', []);
      const testResults = createTestResults(false, [], 'No bugs found', []);
      mockReadFile.mockResolvedValue('{"tasks":[]}');
      mockSmartCommit.mockResolvedValue(null);
      const logSpy = vi.spyOn((workflow as any).correlationLogger, 'info');

      // EXECUTE & VERIFY — resolves; null is logged, not treated as error
      await expect(
        workflow.recordQAMarker('/path/to/session', testResults)
      ).resolves.toBeUndefined();
      expect(logSpy).toHaveBeenCalledWith(
        '[BugHuntWorkflow] Committed clean-hunt marker',
        { commitHash: null }
      );
    });

    it('writeNoIssuesMarker: empty sessionPath → throws', async () => {
      // SETUP
      const workflow = new BugHuntWorkflow('PRD content', []);
      const testResults = createTestResults(false, [], 'No bugs found', []);

      // EXECUTE & VERIFY
      await expect(
        workflow.writeNoIssuesMarker('', testResults)
      ).rejects.toThrow('sessionPath must be a non-empty string');
      expect(mockAtomicWrite).not.toHaveBeenCalled();
    });

    it('writeNoIssuesMarker: atomicWrite failure → throws descriptive error', async () => {
      // SETUP
      const workflow = new BugHuntWorkflow('PRD content', []);
      const testResults = createTestResults(false, [], 'No bugs found', []);
      mockReadFile.mockResolvedValue('{"tasks":[]}');
      mockAtomicWrite.mockRejectedValue(new Error('ENOSPC: no space'));
      const errorSpy = vi.spyOn((workflow as any).correlationLogger, 'error');

      // EXECUTE & VERIFY
      await expect(
        workflow.writeNoIssuesMarker('/path/to/session', testResults)
      ).rejects.toThrow(
        'Failed to write marker to /path/to/session/NO_ISSUES_FOUND.md: ENOSPC: no space'
      );
      expect(errorSpy).toHaveBeenCalledWith(
        '[BugHuntWorkflow] Failed to write NO_ISSUES_FOUND.md',
        {
          markerPath: '/path/to/session/NO_ISSUES_FOUND.md',
          error: 'ENOSPC: no space',
        }
      );
    });

    it('round-trip: clean hunt writes marker, then buggy hunt removes it', async () => {
      // SETUP
      const workflow = new BugHuntWorkflow('PRD content', []);
      mockReadFile.mockResolvedValue('{"tasks":[]}');

      // (1) clean hunt → marker written + committed
      await workflow.recordQAMarker(
        '/path/to/session',
        createTestResults(false, [], 'clean', [])
      );
      expect(mockAtomicWrite).toHaveBeenCalledWith(
        '/path/to/session/NO_ISSUES_FOUND.md',
        expect.any(String)
      );
      expect(mockSmartCommit).toHaveBeenCalledTimes(1);

      // (2) buggy hunt → marker removed, no new commit
      mockUnlink.mockResolvedValue(undefined);
      await workflow.recordQAMarker(
        '/path/to/session',
        createTestResults(
          true,
          [createTestBug('BUG-001', 'critical', 'Bug', 'Desc', 'Rep')],
          'buggy',
          ['Fix']
        )
      );
      expect(mockUnlink).toHaveBeenCalledWith(
        '/path/to/session/NO_ISSUES_FOUND.md'
      );
      // commit count unchanged from the clean hunt (no commit on buggy path)
      expect(mockSmartCommit).toHaveBeenCalledTimes(1);
    });
  });
});
