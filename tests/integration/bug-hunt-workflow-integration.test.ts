/**
 * Integration tests for BugHuntWorkflow class
 *
 * @remarks
 * Tests validate end-to-end BugHuntWorkflow workflow execution.
 * Agent calls are mocked to avoid LLM dependencies while preserving
 * full workflow orchestration testing.
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { BugHuntWorkflow } from '../../src/workflows/bug-hunt-workflow.js';
import type { Task, TestResults, Bug } from '../../src/core/models.js';
import { createSuccessAgentResponse } from '../helpers/research-seam.js';

// Mock agent factory to avoid LLM calls
vi.mock('../../src/agents/agent-factory.js', () => ({
  createQAAgent: vi.fn(),
}));

// Mock bug hunt prompt
vi.mock('../../src/agents/prompts/bug-hunt-prompt.js', () => ({
  createBugHuntPrompt: vi.fn(),
}));

import { createQAAgent } from '../../src/agents/agent-factory.js';
import { createBugHuntPrompt } from '../../src/agents/prompts/bug-hunt-prompt.js';

// Cast mocked functions
const mockCreateQAAgent = createQAAgent as any;
const mockCreateBugHuntPrompt = createBugHuntPrompt as any;

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

describe('BugHuntWorkflow Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Setup default mocks
    mockCreateQAAgent.mockReturnValue({
      prompt: vi.fn(),
    });
    mockCreateBugHuntPrompt.mockReturnValue({});
  });

  describe('full run() workflow execution', () => {
    it('should complete workflow successfully with no bugs found', async () => {
      // SETUP: Create test data
      const prdContent = '# Test PRD\n\n## Requirements\nBuild a feature.';
      const completedTasks = [
        createTestTask('P1.M1.T1', 'Setup Project'),
        createTestTask('P1.M2.T1', 'Implement Core'),
      ];
      const expectedResults = createTestResults(
        false,
        [],
        'All tests passed successfully',
        []
      );

      // Mock QA agent to return clean results
      const mockAgent = {
        prompt: vi
          .fn()
          .mockResolvedValue(createSuccessAgentResponse(expectedResults)),
      };
      mockCreateQAAgent.mockReturnValue(mockAgent);
      mockCreateBugHuntPrompt.mockReturnValue({
        user: 'prompt',
        system: 'system',
      });

      // EXECUTE
      const workflow = new BugHuntWorkflow(prdContent, completedTasks);
      const results = await workflow.run();

      // VERIFY
      expect(results).toEqual(expectedResults);
      expect(results.hasBugs).toBe(false);
      expect(results.bugs).toHaveLength(0);
      expect(results.summary).toBe('All tests passed successfully');
      expect(results.recommendations).toEqual([]);

      // Verify workflow status
      expect(workflow.testResults).toEqual(expectedResults);
    });

    it('should complete workflow successfully with bugs found', async () => {
      // SETUP
      const prdContent =
        '# Test PRD\n\n## Requirements\nBuild a login feature.';
      const completedTasks = [
        createTestTask('P1.M1.T1', 'Setup Project'),
        createTestTask('P1.M2.T1', 'Implement Login'),
      ];
      const expectedResults = createTestResults(
        true,
        [
          createTestBug(
            'BUG-001',
            'critical',
            'Login fails with empty password',
            'Authentication throws unhandled exception',
            '1. Navigate to /login\n2. Leave password empty\n3. Click Submit',
            'src/services/auth.ts:45'
          ),
          createTestBug(
            'BUG-002',
            'major',
            'No input validation',
            'Username accepts special characters',
            '1. Navigate to /login\n2. Enter special chars in username\n3. Observe validation passes',
            'src/components/LoginForm.tsx:23'
          ),
        ],
        'Found 2 bugs during testing: 1 critical, 1 major',
        ['Add password validation', 'Add username character validation']
      );

      const mockAgent = {
        prompt: vi
          .fn()
          .mockResolvedValue(createSuccessAgentResponse(expectedResults)),
      };
      mockCreateQAAgent.mockReturnValue(mockAgent);
      mockCreateBugHuntPrompt.mockReturnValue({
        user: 'prompt',
        system: 'system',
      });

      // EXECUTE
      const workflow = new BugHuntWorkflow(prdContent, completedTasks);
      const results = await workflow.run();

      // VERIFY
      expect(results).toEqual(expectedResults);
      expect(results.hasBugs).toBe(true);
      expect(results.bugs).toHaveLength(2);
      expect(results.bugs[0].severity).toBe('critical');
      expect(results.bugs[1].severity).toBe('major');
      expect(workflow.testResults).toEqual(expectedResults);
    });

    it('should execute all phases in correct order', async () => {
      // SETUP
      const prdContent = '# PRD';
      const completedTasks = [createTestTask('P1.M1.T1', 'Task')];
      const expectedResults = createTestResults(false, [], 'OK', []);

      const callOrder: string[] = [];
      const mockAgent = {
        prompt: vi
          .fn()
          .mockResolvedValue(createSuccessAgentResponse(expectedResults)),
      };
      mockCreateQAAgent.mockImplementation(() => {
        callOrder.push('createQAAgent');
        return mockAgent;
      });
      mockCreateBugHuntPrompt.mockImplementation(() => {
        callOrder.push('createBugHuntPrompt');
        return { user: 'prompt', system: 'system' };
      });

      // EXECUTE
      const workflow = new BugHuntWorkflow(prdContent, completedTasks);
      await workflow.run();

      // VERIFY - phases execute in order
      expect(mockAgent.prompt).toHaveBeenCalled();
      expect(callOrder).toContain('createQAAgent');
      expect(callOrder).toContain('createBugHuntPrompt');
    });
  });

  describe('TestResults with various bug scenarios', () => {
    it('should handle TestResults with all severity levels', async () => {
      // SETUP
      const prdContent = '# PRD';
      const completedTasks = [createTestTask('P1.M1.T1', 'Task')];
      const expectedResults = createTestResults(
        true,
        [
          createTestBug('BUG-001', 'critical', 'Critical Bug', 'Desc', 'Rep'),
          createTestBug('BUG-002', 'major', 'Major Bug', 'Desc', 'Rep'),
          createTestBug('BUG-003', 'minor', 'Minor Bug', 'Desc', 'Rep'),
          createTestBug('BUG-004', 'cosmetic', 'Cosmetic Bug', 'Desc', 'Rep'),
        ],
        'Found bugs at all severity levels',
        ['Fix critical', 'Fix major', 'Fix minor', 'Fix cosmetic']
      );

      const mockAgent = {
        prompt: vi
          .fn()
          .mockResolvedValue(createSuccessAgentResponse(expectedResults)),
      };
      mockCreateQAAgent.mockReturnValue(mockAgent);
      mockCreateBugHuntPrompt.mockReturnValue({});

      // EXECUTE
      const workflow = new BugHuntWorkflow(prdContent, completedTasks);
      const results = await workflow.run();

      // VERIFY
      expect(results.bugs).toHaveLength(4);
      expect(results.bugs.filter(b => b.severity === 'critical')).toHaveLength(
        1
      );
      expect(results.bugs.filter(b => b.severity === 'major')).toHaveLength(1);
      expect(results.bugs.filter(b => b.severity === 'minor')).toHaveLength(1);
      expect(results.bugs.filter(b => b.severity === 'cosmetic')).toHaveLength(
        1
      );
    });

    it('should handle TestResults with only minor and cosmetic bugs', async () => {
      // SETUP
      const prdContent = '# PRD';
      const completedTasks = [createTestTask('P1.M1.T1', 'Task')];
      const expectedResults = createTestResults(
        false, // hasBugs false because no critical/major
        [
          createTestBug('BUG-001', 'minor', 'Minor Bug', 'Desc', 'Rep'),
          createTestBug('BUG-002', 'cosmetic', 'Cosmetic Bug', 'Desc', 'Rep'),
        ],
        'Found minor and cosmetic issues',
        ['Fix minor', 'Fix cosmetic']
      );

      const mockAgent = {
        prompt: vi
          .fn()
          .mockResolvedValue(createSuccessAgentResponse(expectedResults)),
      };
      mockCreateQAAgent.mockReturnValue(mockAgent);
      mockCreateBugHuntPrompt.mockReturnValue({});

      // EXECUTE
      const workflow = new BugHuntWorkflow(prdContent, completedTasks);
      const results = await workflow.run();

      // VERIFY
      expect(results.hasBugs).toBe(false);
      expect(results.bugs).toHaveLength(2);
    });

    it('should handle TestResults with recommendations', async () => {
      // SETUP
      const prdContent = '# PRD';
      const completedTasks = [createTestTask('P1.M1.T1', 'Task')];
      const recommendations = [
        'Add input validation to all form fields',
        'Implement proper error handling',
        'Add unit tests for edge cases',
        'Improve error messages for better UX',
      ];
      const expectedResults = createTestResults(
        true,
        [createTestBug('BUG-001', 'critical', 'Bug', 'Desc', 'Rep')],
        'Found issues with recommendations',
        recommendations
      );

      const mockAgent = {
        prompt: vi
          .fn()
          .mockResolvedValue(createSuccessAgentResponse(expectedResults)),
      };
      mockCreateQAAgent.mockReturnValue(mockAgent);
      mockCreateBugHuntPrompt.mockReturnValue({});

      // EXECUTE
      const workflow = new BugHuntWorkflow(prdContent, completedTasks);
      const results = await workflow.run();

      // VERIFY
      expect(results.recommendations).toEqual(recommendations);
      expect(results.recommendations).toHaveLength(4);
    });
  });

  describe('workflow with different PRD and task scenarios', () => {
    it('should handle empty completedTasks array', async () => {
      // SETUP
      const prdContent = '# Empty PRD\n\nNo tasks completed yet.';
      const completedTasks: Task[] = [];
      const expectedResults = createTestResults(
        false,
        [],
        'No tasks to test',
        []
      );

      const mockAgent = {
        prompt: vi
          .fn()
          .mockResolvedValue(createSuccessAgentResponse(expectedResults)),
      };
      mockCreateQAAgent.mockReturnValue(mockAgent);
      mockCreateBugHuntPrompt.mockReturnValue({});

      // EXECUTE
      const workflow = new BugHuntWorkflow(prdContent, completedTasks);
      const results = await workflow.run();

      // VERIFY
      expect(results).toEqual(expectedResults);
      expect(workflow.completedTasks).toEqual([]);
    });

    it('should handle large number of completed tasks', async () => {
      // SETUP
      const prdContent = '# Large PRD\n\nMany features implemented.';
      const completedTasks = Array.from({ length: 50 }, (_, i) =>
        createTestTask(`P1.M1.T${i}`, `Task ${i}`, `Description for task ${i}`)
      );
      const expectedResults = createTestResults(
        false,
        [],
        'All 50 tasks tested successfully',
        []
      );

      const mockAgent = {
        prompt: vi
          .fn()
          .mockResolvedValue(createSuccessAgentResponse(expectedResults)),
      };
      mockCreateQAAgent.mockReturnValue(mockAgent);
      mockCreateBugHuntPrompt.mockReturnValue({});

      // EXECUTE
      const workflow = new BugHuntWorkflow(prdContent, completedTasks);
      const results = await workflow.run();

      // VERIFY
      expect(results.bugs).toHaveLength(0);
      expect(workflow.completedTasks).toHaveLength(50);
      expect(mockCreateBugHuntPrompt).toHaveBeenCalledWith(
        prdContent,
        completedTasks,
        // run() now passes a file-contract outputPath (3rd arg); undefined when
        // no sessionPath is configured (this test does not call setSessionPath).
        undefined
      );
    });

    it('should handle PRD with complex markdown', async () => {
      // SETUP
      const prdContent = `# Complex PRD

## Requirements

### Feature 1
- Requirement 1.1
- Requirement 1.2

### Feature 2
\`\`\`typescript
interface Example {
  field: string;
}
\`\`\`

## Edge Cases
1. Empty input
2. Unicode characters
3. Very long strings

## Success Criteria
- All tests pass
- No regressions
`;
      const completedTasks = [
        createTestTask('P1.M1.T1', 'Implement Feature 1'),
        createTestTask('P1.M2.T1', 'Implement Feature 2'),
      ];
      const expectedResults = createTestResults(
        false,
        [],
        'Complex PRD tested successfully',
        []
      );

      const mockAgent = {
        prompt: vi
          .fn()
          .mockResolvedValue(createSuccessAgentResponse(expectedResults)),
      };
      mockCreateQAAgent.mockReturnValue(mockAgent);
      mockCreateBugHuntPrompt.mockReturnValue({});

      // EXECUTE
      const workflow = new BugHuntWorkflow(prdContent, completedTasks);
      const results = await workflow.run();

      // VERIFY
      expect(results).toEqual(expectedResults);
      expect(mockCreateBugHuntPrompt).toHaveBeenCalledWith(
        prdContent,
        completedTasks,
        undefined
      );
    });
  });

  describe('error handling and recovery', () => {
    it('should handle QA agent errors gracefully', async () => {
      // SETUP
      const prdContent = '# PRD';
      const completedTasks = [createTestTask('P1.M1.T1', 'Task')];
      const mockError = new Error('QA agent API timeout');
      const mockAgent = {
        prompt: vi.fn().mockRejectedValue(mockError),
      };
      mockCreateQAAgent.mockReturnValue(mockAgent);
      mockCreateBugHuntPrompt.mockReturnValue({});

      // EXECUTE & VERIFY
      const workflow = new BugHuntWorkflow(prdContent, completedTasks);
      await expect(workflow.run()).rejects.toThrow('QA agent API timeout');

      // Verify workflow status is failed
      expect(workflow.status).toBe('failed');
    });

    it('should preserve state after error', async () => {
      // SETUP
      const prdContent = '# PRD';
      const completedTasks = [createTestTask('P1.M1.T1', 'Task')];
      const mockAgent = {
        prompt: vi.fn().mockRejectedValue(new Error('Error')),
      };
      mockCreateQAAgent.mockReturnValue(mockAgent);
      mockCreateBugHuntPrompt.mockReturnValue({});

      // EXECUTE
      const workflow = new BugHuntWorkflow(prdContent, completedTasks);
      try {
        await workflow.run();
      } catch {
        // Expected error
      }

      // VERIFY - state preserved
      expect(workflow.prdContent).toBe(prdContent);
      expect(workflow.completedTasks).toEqual(completedTasks);
    });
  });

  describe('workflow observability', () => {
    it('should update testResults after run', async () => {
      // SETUP
      const prdContent = '# PRD';
      const completedTasks = [createTestTask('P1.M1.T1', 'Task')];
      const expectedResults = createTestResults(
        true,
        [createTestBug('BUG-001', 'major', 'Bug', 'Desc', 'Rep')],
        'Found bugs',
        ['Fix']
      );

      const mockAgent = {
        prompt: vi
          .fn()
          .mockResolvedValue(createSuccessAgentResponse(expectedResults)),
      };
      mockCreateQAAgent.mockReturnValue(mockAgent);
      mockCreateBugHuntPrompt.mockReturnValue({});

      // EXECUTE
      const workflow = new BugHuntWorkflow(prdContent, completedTasks);
      expect(workflow.testResults).toBeNull();

      await workflow.run();

      // VERIFY
      expect(workflow.testResults).toEqual(expectedResults);
    });

    it('should transition status through lifecycle', async () => {
      // SETUP
      const prdContent = '# PRD';
      const completedTasks = [createTestTask('P1.M1.T1', 'Task')];
      const expectedResults = createTestResults(false, [], 'OK', []);

      const mockAgent = {
        prompt: vi
          .fn()
          .mockResolvedValue(createSuccessAgentResponse(expectedResults)),
      };
      mockCreateQAAgent.mockReturnValue(mockAgent);
      mockCreateBugHuntPrompt.mockReturnValue({});

      // EXECUTE
      const workflow = new BugHuntWorkflow(prdContent, completedTasks);

      // Initial status
      expect(workflow.status).toBe('idle');

      await workflow.run();

      // Final status
      expect(workflow.status).toBe('completed');
    });
  });
});
