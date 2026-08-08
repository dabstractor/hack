/**
 * Unit tests for DeltaAnalysisWorkflow class
 *
 * @remarks
 * Tests validate DeltaAnalysisWorkflow class from src/workflows/delta-analysis-workflow.ts
 * with comprehensive coverage. Tests follow the Setup/Execute/Verify pattern.
 *
 * Mocks are used for all agent operations - no real I/O is performed.
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { DeltaAnalysisWorkflow } from '../../../src/workflows/delta-analysis-workflow.js';
import type {
  DeltaAnalysis,
  RequirementChange,
} from '../../../src/core/models.js';

// Mock agent factory
vi.mock('../../../src/agents/agent-factory.js', () => ({
  createQAAgent: vi.fn(),
}));

// Mock delta analysis prompt
vi.mock('../../../src/agents/prompts/delta-analysis-prompt.js', () => ({
  createDeltaAnalysisPrompt: vi.fn(),
}));

// Import mocked modules
import { createQAAgent } from '../../../src/agents/agent-factory.js';
import { createDeltaAnalysisPrompt } from '../../../src/agents/prompts/delta-analysis-prompt.js';

// Cast mocked functions
const mockCreateQAAgent = createQAAgent as any;
const mockCreateDeltaAnalysisPrompt = createDeltaAnalysisPrompt as any;

// Factory functions for test data
const createTestRequirementChange = (
  itemId: string,
  type: 'added' | 'modified' | 'removed',
  description: string,
  impact: string
): RequirementChange => ({
  itemId,
  type,
  description,
  impact,
});

const createTestDeltaAnalysis = (
  changes: RequirementChange[],
  patchInstructions: string,
  taskIds: string[]
): DeltaAnalysis => ({
  changes,
  patchInstructions,
  taskIds,
});

describe('DeltaAnalysisWorkflow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Setup default mocks
    mockCreateQAAgent.mockReturnValue({
      prompt: vi.fn(),
    });
    mockCreateDeltaAnalysisPrompt.mockReturnValue({});
  });

  describe('constructor', () => {
    it('should throw if oldPRD is empty', () => {
      // EXECUTE & VERIFY
      expect(
        () => new DeltaAnalysisWorkflow('', 'new PRD content', [])
      ).toThrow('oldPRD cannot be empty');
    });

    it('should throw if oldPRD is only whitespace', () => {
      // EXECUTE & VERIFY
      expect(
        () => new DeltaAnalysisWorkflow('   ', 'new PRD content', [])
      ).toThrow('oldPRD cannot be empty');
    });

    it('should throw if newPRD is empty', () => {
      // EXECUTE & VERIFY
      expect(
        () => new DeltaAnalysisWorkflow('old PRD content', '', [])
      ).toThrow('newPRD cannot be empty');
    });

    it('should throw if newPRD is only whitespace', () => {
      // EXECUTE & VERIFY
      expect(
        () => new DeltaAnalysisWorkflow('old PRD content', '   ', [])
      ).toThrow('newPRD cannot be empty');
    });

    it('should initialize ObservedState fields with provided values', () => {
      // SETUP
      const oldPRD = '# Old PRD\n## P1.M1.T1\nImplement login';
      const newPRD = '# New PRD\n## P1.M1.T1\nImplement login with OAuth2';
      const completedTasks = ['P1.M1.T1', 'P1.M2.T1'];

      // EXECUTE
      const workflow = new DeltaAnalysisWorkflow(
        oldPRD,
        newPRD,
        completedTasks
      );

      // VERIFY
      expect(workflow.oldPRD).toBe(oldPRD);
      expect(workflow.newPRD).toBe(newPRD);
      expect(workflow.completedTasks).toEqual(completedTasks);
    });

    it('should initialize deltaAnalysis as null', () => {
      // EXECUTE
      const workflow = new DeltaAnalysisWorkflow('old PRD', 'new PRD', []);

      // VERIFY
      expect(workflow.deltaAnalysis).toBeNull();
    });

    it('should accept empty completedTasks array', () => {
      // EXECUTE
      const workflow = new DeltaAnalysisWorkflow('old PRD', 'new PRD', []);

      // VERIFY
      expect(workflow.completedTasks).toEqual([]);
    });
  });

  describe('analyzeDelta', () => {
    it('should call createQAAgent to get agent', async () => {
      // SETUP
      const workflow = new DeltaAnalysisWorkflow('old PRD', 'new PRD', []);
      const mockAgent = {
        prompt: vi.fn().mockResolvedValue({
          status: 'success',
          data: {
            changes: [],
            patchInstructions: 'No changes',
            taskIds: [],
          },
          error: null,
          metadata: {
            agentId: 'test-qa-agent',
            timestamp: Date.now(),
          },
        }),
      };
      mockCreateQAAgent.mockReturnValue(mockAgent);
      mockCreateDeltaAnalysisPrompt.mockReturnValue({});

      // EXECUTE
      await workflow.analyzeDelta();

      // VERIFY
      expect(mockCreateQAAgent).toHaveBeenCalled();
    });

    it('should call createDeltaAnalysisPrompt with correct parameters', async () => {
      // SETUP
      const oldPRD = '# Old PRD';
      const newPRD = '# New PRD';
      const completedTasks = ['P1.M1.T1', 'P1.M2.T1'];
      const workflow = new DeltaAnalysisWorkflow(
        oldPRD,
        newPRD,
        completedTasks
      );
      const mockAgent = {
        prompt: vi.fn().mockResolvedValue({
          status: 'success',
          data: {
            changes: [],
            patchInstructions: 'No changes',
            taskIds: [],
          },
          error: null,
          metadata: {
            agentId: 'test-qa-agent',
            timestamp: Date.now(),
          },
        }),
      };
      mockCreateQAAgent.mockReturnValue(mockAgent);
      mockCreateDeltaAnalysisPrompt.mockReturnValue({});

      // EXECUTE
      await workflow.analyzeDelta();

      // VERIFY
      expect(mockCreateDeltaAnalysisPrompt).toHaveBeenCalledWith(
        oldPRD,
        newPRD,
        completedTasks
      );
    });

    it('should call agent.prompt with the prompt', async () => {
      // SETUP
      const workflow = new DeltaAnalysisWorkflow('old PRD', 'new PRD', []);
      const prompt = { user: 'test prompt', system: 'system' };
      const mockAgent = {
        prompt: vi.fn().mockResolvedValue({
          status: 'success',
          data: {
            changes: [],
            patchInstructions: 'No changes',
            taskIds: [],
          },
          error: null,
          metadata: {
            agentId: 'test-qa-agent',
            timestamp: Date.now(),
          },
        }),
      };
      mockCreateQAAgent.mockReturnValue(mockAgent);
      mockCreateDeltaAnalysisPrompt.mockReturnValue(prompt);

      // EXECUTE
      await workflow.analyzeDelta();

      // VERIFY
      expect(mockAgent.prompt).toHaveBeenCalledWith(prompt);
    });

    it('should store result in deltaAnalysis field', async () => {
      // SETUP
      const workflow = new DeltaAnalysisWorkflow('old PRD', 'new PRD', []);
      const expectedResult = createTestDeltaAnalysis(
        [
          createTestRequirementChange(
            'P1.M1.T1',
            'modified',
            'Changed',
            'Impact'
          ),
        ],
        'Re-execute P1.M1.T1',
        ['P1.M1.T1']
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
      mockCreateDeltaAnalysisPrompt.mockReturnValue({});

      // EXECUTE
      await workflow.analyzeDelta();

      // VERIFY
      expect(workflow.deltaAnalysis).toEqual(expectedResult);
    });

    it('should return DeltaAnalysis result', async () => {
      // SETUP
      const workflow = new DeltaAnalysisWorkflow('old PRD', 'new PRD', []);
      const expectedResult = createTestDeltaAnalysis(
        [
          createTestRequirementChange(
            'P1.M1.T1',
            'modified',
            'Changed',
            'Impact'
          ),
          createTestRequirementChange('P2.M1.T1', 'added', 'Added', 'Impact'),
        ],
        'Re-execute tasks',
        ['P1.M1.T1', 'P2.M1.T1']
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
      mockCreateDeltaAnalysisPrompt.mockReturnValue({});

      // EXECUTE
      const result = await workflow.analyzeDelta();

      // VERIFY
      expect(result).toEqual(expectedResult);
    });

    it('should propagate errors from agent.prompt', async () => {
      // SETUP
      const workflow = new DeltaAnalysisWorkflow('old PRD', 'new PRD', []);
      const mockError = new Error('Agent failed');
      const mockAgent = {
        prompt: vi.fn().mockRejectedValue(mockError),
      };
      mockCreateQAAgent.mockReturnValue(mockAgent);
      mockCreateDeltaAnalysisPrompt.mockReturnValue({});

      // EXECUTE & VERIFY
      await expect(workflow.analyzeDelta()).rejects.toThrow('Agent failed');
    });

    it('should propagate errors from createQAAgent', async () => {
      // SETUP
      const workflow = new DeltaAnalysisWorkflow('old PRD', 'new PRD', []);
      mockCreateQAAgent.mockImplementation(() => {
        throw new Error('Factory failed');
      });
      mockCreateDeltaAnalysisPrompt.mockReturnValue({});

      // EXECUTE & VERIFY
      await expect(workflow.analyzeDelta()).rejects.toThrow('Factory failed');
    });

    it('should propagate errors from createDeltaAnalysisPrompt', async () => {
      // SETUP
      const workflow = new DeltaAnalysisWorkflow('old PRD', 'new PRD', []);
      mockCreateDeltaAnalysisPrompt.mockImplementation(() => {
        throw new Error('Prompt creation failed');
      });

      // EXECUTE & VERIFY
      await expect(workflow.analyzeDelta()).rejects.toThrow(
        'Prompt creation failed'
      );
    });

    it('should handle empty changes array', async () => {
      // SETUP
      const workflow = new DeltaAnalysisWorkflow('old PRD', 'new PRD', []);
      const expectedResult = createTestDeltaAnalysis([], 'No changes', []);
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
      mockCreateDeltaAnalysisPrompt.mockReturnValue({});

      // EXECUTE
      const result = await workflow.analyzeDelta();

      // VERIFY
      expect(result.changes).toEqual([]);
      expect(result.taskIds).toEqual([]);
    });

    it('should handle empty taskIds array', async () => {
      // SETUP
      const workflow = new DeltaAnalysisWorkflow('old PRD', 'new PRD', []);
      const expectedResult = createTestDeltaAnalysis(
        [
          createTestRequirementChange(
            'P1.M1.T1',
            'modified',
            'Changed',
            'Impact'
          ),
        ],
        'No affected tasks',
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
      mockCreateDeltaAnalysisPrompt.mockReturnValue({});

      // EXECUTE
      const result = await workflow.analyzeDelta();

      // VERIFY
      expect(result.taskIds).toEqual([]);
    });

    afterEach(() => vi.unstubAllEnvs());

    it('passes the research (AGENT) reasoning level to createQAAgent [research-leaning]', async () => {
      // SETUP — override value proves delta-analysis reads the AGENT (research) knob,
      // NOT the bug-finder/validation knobs (PRD §9.2.9).
      vi.stubEnv('PRP_REASONING_AGENT', 'medium');
      const workflow = new DeltaAnalysisWorkflow('old PRD', 'new PRD', []);
      mockCreateQAAgent.mockReturnValue({
        prompt: vi.fn().mockResolvedValue({
          status: 'success',
          data: {
            changes: [],
            patchInstructions: 'No changes',
            taskIds: [],
          },
          error: null,
          metadata: { agentId: 'test-qa-agent', timestamp: Date.now() },
        }),
      });
      mockCreateDeltaAnalysisPrompt.mockReturnValue({});

      // EXECUTE
      await workflow.analyzeDelta();

      // VERIFY — research-leaning caller threads getReasoningAgent()'s value.
      expect(mockCreateQAAgent).toHaveBeenCalledWith('medium');
    });
  });

  describe('run', () => {
    it('should call analyzeDelta and return result', async () => {
      // SETUP
      const workflow = new DeltaAnalysisWorkflow('old PRD', 'new PRD', []);
      const expectedResult = createTestDeltaAnalysis(
        [
          createTestRequirementChange(
            'P1.M1.T1',
            'modified',
            'Changed',
            'Impact'
          ),
        ],
        'Re-execute P1.M1.T1',
        ['P1.M1.T1']
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
      mockCreateDeltaAnalysisPrompt.mockReturnValue({});

      // Spy on analyzeDelta
      const analyzeDeltaSpy = vi.spyOn(workflow, 'analyzeDelta');

      // EXECUTE
      const result = await workflow.run();

      // VERIFY
      expect(analyzeDeltaSpy).toHaveBeenCalled();
      expect(result).toEqual(expectedResult);
    });

    it('should set status to running before analysis', async () => {
      // SETUP
      const workflow = new DeltaAnalysisWorkflow('old PRD', 'new PRD', []);
      const mockAgent = {
        prompt: vi.fn().mockResolvedValue({
          status: 'success',
          data: {
            changes: [],
            patchInstructions: 'No changes',
            taskIds: [],
          },
          error: null,
          metadata: {
            agentId: 'test-qa-agent',
            timestamp: Date.now(),
          },
        }),
      };
      mockCreateQAAgent.mockReturnValue(mockAgent);
      mockCreateDeltaAnalysisPrompt.mockReturnValue({});

      // Spy on setStatus
      const setStatusSpy = vi.spyOn(workflow, 'setStatus');

      // EXECUTE
      await workflow.run();

      // VERIFY - setStatus('running') should be called before setStatus('completed')
      expect(setStatusSpy).toHaveBeenNthCalledWith(1, 'running');
      expect(setStatusSpy).toHaveBeenNthCalledWith(2, 'completed');
    });

    it('should set status to completed after successful analysis', async () => {
      // SETUP
      const workflow = new DeltaAnalysisWorkflow('old PRD', 'new PRD', []);
      const mockAgent = {
        prompt: vi.fn().mockResolvedValue({
          status: 'success',
          data: {
            changes: [],
            patchInstructions: 'No changes',
            taskIds: [],
          },
          error: null,
          metadata: {
            agentId: 'test-qa-agent',
            timestamp: Date.now(),
          },
        }),
      };
      mockCreateQAAgent.mockReturnValue(mockAgent);
      mockCreateDeltaAnalysisPrompt.mockReturnValue({});

      // Spy on setStatus
      const setStatusSpy = vi.spyOn(workflow, 'setStatus');

      // EXECUTE
      await workflow.run();

      // VERIFY
      expect(setStatusSpy).toHaveBeenCalledWith('completed');
    });

    it('should return DeltaAnalysis with changes array', async () => {
      // SETUP
      const workflow = new DeltaAnalysisWorkflow('old PRD', 'new PRD', []);
      const changes: RequirementChange[] = [
        createTestRequirementChange(
          'P1.M1.T1',
          'added',
          'New task',
          'Impact 1'
        ),
        createTestRequirementChange(
          'P1.M2.T1',
          'modified',
          'Updated',
          'Impact 2'
        ),
        createTestRequirementChange(
          'P2.M1.T1',
          'removed',
          'Deleted',
          'Impact 3'
        ),
      ];
      const expectedResult = createTestDeltaAnalysis(
        changes,
        'Multiple changes',
        ['P1.M1.T1', 'P1.M2.T1', 'P2.M1.T1']
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
      mockCreateDeltaAnalysisPrompt.mockReturnValue({});

      // EXECUTE
      const result = await workflow.run();

      // VERIFY
      expect(result.changes).toHaveLength(3);
      expect(result.changes[0].type).toBe('added');
      expect(result.changes[1].type).toBe('modified');
      expect(result.changes[2].type).toBe('removed');
    });

    it('should return DeltaAnalysis with patchInstructions', async () => {
      // SETUP
      const workflow = new DeltaAnalysisWorkflow('old PRD', 'new PRD', []);
      const patchInstructions = 'Re-execute P1.M1.T1. P1.M2.T1 can be reused.';
      const expectedResult = createTestDeltaAnalysis(
        [
          createTestRequirementChange(
            'P1.M1.T1',
            'modified',
            'Changed',
            'Impact'
          ),
        ],
        patchInstructions,
        ['P1.M1.T1']
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
      mockCreateDeltaAnalysisPrompt.mockReturnValue({});

      // EXECUTE
      const result = await workflow.run();

      // VERIFY
      expect(result.patchInstructions).toBe(patchInstructions);
    });

    it('should return DeltaAnalysis with taskIds array', async () => {
      // SETUP
      const workflow = new DeltaAnalysisWorkflow('old PRD', 'new PRD', [
        'P1.M1.T1',
      ]);
      const taskIds = ['P1.M1.T1', 'P1.M2.T1.S1', 'P2.M1.T1'];
      const expectedResult = createTestDeltaAnalysis(
        [
          createTestRequirementChange(
            'P1.M1.T1',
            'modified',
            'Changed',
            'Impact'
          ),
        ],
        'Re-execute tasks',
        taskIds
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
      mockCreateDeltaAnalysisPrompt.mockReturnValue({});

      // EXECUTE
      const result = await workflow.run();

      // VERIFY
      expect(result.taskIds).toEqual(taskIds);
    });

    it('should propagate errors from analyzeDelta', async () => {
      // SETUP
      const workflow = new DeltaAnalysisWorkflow('old PRD', 'new PRD', []);
      const mockAgent = {
        prompt: vi.fn().mockRejectedValue(new Error('Analysis failed')),
      };
      mockCreateQAAgent.mockReturnValue(mockAgent);
      mockCreateDeltaAnalysisPrompt.mockReturnValue({});

      // EXECUTE & VERIFY
      await expect(workflow.run()).rejects.toThrow('Analysis failed');
    });

    it('should not set status to completed on error', async () => {
      // SETUP
      const workflow = new DeltaAnalysisWorkflow('old PRD', 'new PRD', []);
      const mockAgent = {
        prompt: vi.fn().mockRejectedValue(new Error('Analysis failed')),
      };
      mockCreateQAAgent.mockReturnValue(mockAgent);
      mockCreateDeltaAnalysisPrompt.mockReturnValue({});

      // Spy on setStatus
      const setStatusSpy = vi.spyOn(workflow, 'setStatus');

      // EXECUTE
      try {
        await workflow.run();
      } catch {
        // Expected error
      }

      // VERIFY - should be called with 'running' but not 'completed'
      expect(setStatusSpy).toHaveBeenCalledWith('running');
      expect(setStatusSpy).not.toHaveBeenCalledWith('completed');
    });

    it('should handle workflow with completedTasks provided', async () => {
      // SETUP
      const completedTasks = ['P1.M1.T1', 'P1.M2.T1', 'P1.M3.T1.S1'];
      const workflow = new DeltaAnalysisWorkflow(
        'old PRD',
        'new PRD',
        completedTasks
      );
      const expectedResult = createTestDeltaAnalysis(
        [
          createTestRequirementChange(
            'P1.M1.T1',
            'modified',
            'Changed',
            'Impact'
          ),
        ],
        'Preserve P1.M2.T1, re-execute P1.M1.T1',
        ['P1.M1.T1']
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
      mockCreateDeltaAnalysisPrompt.mockReturnValue({});

      // EXECUTE
      const result = await workflow.run();

      // VERIFY
      expect(result.taskIds).toContain('P1.M1.T1');
      expect(mockCreateDeltaAnalysisPrompt).toHaveBeenCalledWith(
        'old PRD',
        'new PRD',
        completedTasks
      );
    });

    it('should handle workflow with no completedTasks', async () => {
      // SETUP
      const workflow = new DeltaAnalysisWorkflow('old PRD', 'new PRD', []);
      const expectedResult = createTestDeltaAnalysis(
        [
          createTestRequirementChange(
            'P1.M1.T1',
            'added',
            'New task',
            'Impact'
          ),
        ],
        'Execute all tasks',
        ['P1.M1.T1']
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
      mockCreateDeltaAnalysisPrompt.mockReturnValue({});

      // EXECUTE
      const result = await workflow.run();

      // VERIFY
      expect(mockCreateDeltaAnalysisPrompt).toHaveBeenCalledWith(
        'old PRD',
        'new PRD',
        []
      );
      expect(result).toEqual(expectedResult);
    });

    it('should update deltaAnalysis field after successful run', async () => {
      // SETUP
      const workflow = new DeltaAnalysisWorkflow('old PRD', 'new PRD', []);
      const expectedResult = createTestDeltaAnalysis(
        [
          createTestRequirementChange(
            'P1.M1.T1',
            'modified',
            'Changed',
            'Impact'
          ),
        ],
        'Re-execute P1.M1.T1',
        ['P1.M1.T1']
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
      mockCreateDeltaAnalysisPrompt.mockReturnValue({});

      // EXECUTE
      await workflow.run();

      // VERIFY
      expect(workflow.deltaAnalysis).toEqual(expectedResult);
    });

    it('should preserve completedTasks field during run', async () => {
      // SETUP
      const completedTasks = ['P1.M1.T1', 'P1.M2.T1'];
      const workflow = new DeltaAnalysisWorkflow(
        'old PRD',
        'new PRD',
        completedTasks
      );
      const mockAgent = {
        prompt: vi.fn().mockResolvedValue({
          status: 'success',
          data: {
            changes: [],
            patchInstructions: 'No changes',
            taskIds: [],
          },
          error: null,
          metadata: {
            agentId: 'test-qa-agent',
            timestamp: Date.now(),
          },
        }),
      };
      mockCreateQAAgent.mockReturnValue(mockAgent);
      mockCreateDeltaAnalysisPrompt.mockReturnValue({});

      // EXECUTE
      await workflow.run();

      // VERIFY
      expect(workflow.completedTasks).toEqual(completedTasks);
    });
  });
});
