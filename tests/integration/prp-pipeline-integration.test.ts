/**
 * Integration tests for PRPPipeline class
 *
 * @remarks
 * Tests validate end-to-end PRPPipeline workflow with real SessionManager and TaskOrchestrator.
 * Agent calls are mocked to avoid LLM dependencies. File system operations use temp directories.
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PRPPipeline } from '../../src/workflows/prp-pipeline.js';
import type { Backlog, Status } from '../../src/core/models.js';

// Mock agent factory to avoid LLM calls. Use importOriginal so every real
// export stays defined (production imports more than just the architect/QA
// fns — e.g. createResearcherAgent via TaskOrchestrator→ResearchQueue during
// initializeSession); a bare-object mock makes those exports `undefined` and
// vitest throws on access. Override only the fns this suite drives directly,
// and stub the research/coder/QA seams so construction + runQACycle's bug
// hunt do NOT reach the real PiHarness (category-(a) isolation — see
// architecture/bug-004-test-suite.md).
vi.mock('../../src/agents/agent-factory.js', async importOriginal => {
  const actual =
    await importOriginal<typeof import('../../src/agents/agent-factory.js')>();
  const stubAgent = {
    prompt: vi.fn().mockResolvedValue({ status: 'success' }),
  };
  // QA stub returns a no-bugs TestResults so BugHuntWorkflow (runQACycle)
  // completes cleanly without triggering a fix cycle or hitting the harness.
  const qaStub = {
    prompt: vi.fn().mockResolvedValue({
      status: 'success',
      data: { hasBugs: false, bugs: [], summary: 'No bugs found.' },
    }),
  };
  return {
    ...actual,
    createArchitectAgent: vi.fn(),
    createQAAgent: vi.fn().mockReturnValue(qaStub),
    createResearcherAgent: vi.fn().mockReturnValue(stubAgent),
    createCoderAgent: vi.fn().mockReturnValue(stubAgent),
  };
});

// Mock smartCommit so executeBacklog / runQACycle never reach the
// stagecoach commit-message LLM (src/utils/git-commit.ts:generateCommitMessage).
// That seam runs with retry + exponential backoff against the real PiHarness,
// which is unmocked here -> "PiHarness not initialized" -> multi-second retries
// that blow the per-test timeout. Category-(a) isolation
// (architecture/bug-004-test-suite.md). smartCommit is a no-op returning a
// stub hash; these tests assert on task counts / phases / session shape, NOT
// on git commits, so stubbing it does not weaken any assertion.
vi.mock('../../src/utils/git-commit.js', () => ({
  smartCommit: vi.fn().mockResolvedValue('stub-commit-hash'),
  parseItemPosition: vi.fn().mockReturnValue(null),
  buildTaskPrefix: vi.fn().mockReturnValue(''),
  formatCommitMessage: vi.fn().mockReturnValue('stub message'),
  filterProtectedFiles: vi.fn().mockImplementation((files: string[]) => files),
}));

// Mock the validation workflow so #runValidation() is a no-op. The real
// ValidationWorkflow generates + runs validate.sh, which executes `npm test`
// across the WHOLE suite — currently RED (~179 failures, the very thing
// BUG-004 is fixing). Running it here would abort run() via
// ValidationFailedError before the test can assert on the happy path, which
// is an environmental artifact of the red suite, not a pipeline defect. The
// validation seam itself is exercised by the dedicated validation tests; here
// it is stubbed so the pipeline's run() flow can complete.
vi.mock('../../src/workflows/validation-workflow.js', () => ({
  ValidationWorkflow: vi.fn().mockImplementation(() => ({
    run: vi.fn().mockResolvedValue({
      success: true,
      exitCode: 0,
      timedOut: false,
      stdout: '',
      stderr: '',
      scriptPath: '/tmp/test-validate.sh',
      durationMs: 0,
    }),
  })),
  ValidationFailedError: class ValidationFailedError extends Error {
    constructor(outcome: unknown) {
      super(`Validation failed: ${JSON.stringify(outcome)}`);
      this.name = 'ValidationFailedError';
    }
  },
}));

// Mock fs/promises read to return parsed tasks.json for architect result
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readFile: vi.fn((path: string, encoding?: any) => {
      if (path.includes('tasks.json')) {
        // Return the actual file content for tests
        return actual.readFile(path, encoding);
      }
      return actual.readFile(path, encoding);
    }),
  };
});

import { readFile } from 'node:fs/promises';

describe('PRPPipeline Integration Tests', () => {
  let tempDir: string;
  let prdPath: string;
  let planDir: string;

  beforeEach(() => {
    // Create temp directory for each test
    tempDir = mkdtempSync(join(tmpdir(), 'prp-pipeline-test-'));
    prdPath = join(tempDir, 'PRD.md');
    planDir = join(tempDir, 'plan');
  });

  afterEach(() => {
    // Clean up temp directory
    rmSync(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  // Helper to create a test PRD file
  // NOTE: production (src/utils/prd-validator.ts) requires PRD content >= 100
  // chars, so the default fixture is padded to clear that validation gate.
  const createTestPRD = (
    content: string = [
      '# Test PRD',
      '',
      'This is a test PRD used by the integration suite. It exists only to',
      'satisfy the PRD content-length and structure validation performed',
      'during session initialization.',
    ].join('\n')
  ) => {
    const fs = require('node:fs'); // eslint-disable-line @typescript-eslint/no-var-requires
    fs.writeFileSync(prdPath, content);
  };

  // Helper to create a minimal tasks.json in session directory
  const createTasksJson = (sessionPath: string, backlog: Backlog) => {
    const fs = require('node:fs'); // eslint-disable-line @typescript-eslint/no-var-requires
    const tasksPath = join(sessionPath, 'tasks.json');
    fs.writeFileSync(tasksPath, JSON.stringify(backlog, null, 2));
  };

  describe('full run() workflow with new session', () => {
    it('should complete workflow successfully for new session', async () => {
      // SETUP: Create test PRD
      createTestPRD();

      // Mock architect agent to write tasks.json
      const mockAgent = {
        prompt: vi.fn().mockResolvedValue({ backlog: { backlog: [] } }),
      };
      const { createArchitectAgent } =
        await import('../../src/agents/agent-factory.js');
      (createArchitectAgent as any).mockReturnValue(mockAgent);

      // Mock readFile - return PRD content when reading PRD, empty backlog for tasks.json
      const actual = require('node:fs/promises'); // eslint-disable-line @typescript-eslint/no-var-requires
      (readFile as any).mockImplementation((path: string, encoding?: any) => {
        if (path.includes('tasks.json')) {
          return JSON.stringify({ backlog: [] });
        }
        if (path.includes(prdPath)) {
          // readUTF8FileStrict calls readFile(path) WITHOUT encoding (Buffer);
          // other callers pass 'utf-8' (string). Delegate to the real readFile
          // so the return type matches the production contract.
          return actual.readFile(path, encoding);
        }
        return '';
      });

      // EXECUTE
      const pipeline = new PRPPipeline(
        prdPath,
        undefined,
        undefined,
        false,
        false,
        undefined,
        undefined,
        undefined, // monitorInterval
        1, // monitorTaskInterval (positional; constructor default)
        false, // disableMonitoring
        planDir
      );
      const result = await pipeline.run();

      // VERIFY
      expect(result.success).toBe(true);
      expect(result.sessionPath).toContain(planDir);
      expect(result.totalTasks).toBe(0);
      expect(result.completedTasks).toBe(0);
      expect(result.failedTasks).toBe(0);
      expect(result.finalPhase).toBe('qa_complete');
      expect(result.duration).toBeGreaterThan(0);
      expect(result.phases).toEqual([]);
      expect(result.bugsFound).toBe(0);
    });

    it('should generate session directory with prd_snapshot.md and tasks.json', async () => {
      // SETUP
      createTestPRD();

      const mockAgent = {
        prompt: vi.fn().mockResolvedValue({ backlog: { backlog: [] } }),
      };
      const { createArchitectAgent } =
        await import('../../src/agents/agent-factory.js');
      (createArchitectAgent as any).mockReturnValue(mockAgent);
      (readFile as any).mockImplementation((path: string, encoding?: any) => {
        if (path.includes('tasks.json')) {
          return JSON.stringify({ backlog: [] });
        }
        // Return actual file content for other files (like PRD.md)
        const actual = require('node:fs/promises'); // eslint-disable-line @typescript-eslint/no-var-requires
        return actual.readFile(path, encoding);
      });

      // EXECUTE
      const pipeline = new PRPPipeline(
        prdPath,
        undefined,
        undefined,
        false,
        false,
        undefined,
        undefined,
        undefined, // monitorInterval
        1, // monitorTaskInterval (positional; constructor default)
        false, // disableMonitoring
        planDir
      );
      const result = await pipeline.run();

      // VERIFY: Check session directory exists
      expect(existsSync(result.sessionPath)).toBe(true);

      // Verify prd_snapshot.md exists
      const prdSnapshotPath = join(result.sessionPath, 'prd_snapshot.md');
      expect(existsSync(prdSnapshotPath)).toBe(true);
      const prdSnapshot = readFileSync(prdSnapshotPath, 'utf-8');
      expect(prdSnapshot).toContain('# Test PRD');

      // Verify tasks.json exists
      const tasksPath = join(result.sessionPath, 'tasks.json');
      expect(existsSync(tasksPath)).toBe(true);
    });
  });

  describe('full run() workflow with existing session', () => {
    it('should reuse existing session when PRD hash matches', async () => {
      // SETUP: Create initial session
      createTestPRD();

      // First run creates the session
      const mockAgent = {
        prompt: vi.fn().mockResolvedValue({ backlog: { backlog: [] } }),
      };
      const { createArchitectAgent } =
        await import('../../src/agents/agent-factory.js');
      (createArchitectAgent as any).mockReturnValue(mockAgent);
      (readFile as any).mockImplementation((path: string, encoding?: any) => {
        if (path.includes('tasks.json')) {
          return JSON.stringify({ backlog: [] });
        }
        // Return actual file content for other files (like PRD.md)
        const actual = require('node:fs/promises'); // eslint-disable-line @typescript-eslint/no-var-requires
        return actual.readFile(path, encoding);
      });

      const pipeline1 = new PRPPipeline(
        prdPath,
        undefined,
        undefined,
        false,
        false,
        undefined,
        undefined,
        undefined, // monitorInterval
        1, // monitorTaskInterval (positional; constructor default)
        false, // disableMonitoring
        planDir
      );
      const result1 = await pipeline1.run();
      const sessionPath = result1.sessionPath;

      // Second run should reuse session
      vi.clearAllMocks();
      (createArchitectAgent as any).mockReturnValue(mockAgent);
      (readFile as any).mockImplementation((path: string, encoding?: any) => {
        if (path.includes('tasks.json')) {
          return JSON.stringify({ backlog: [] });
        }
        // Return actual file content for other files (like PRD.md)
        const actual = require('node:fs/promises'); // eslint-disable-line @typescript-eslint/no-var-requires
        return actual.readFile(path, encoding);
      });

      const pipeline2 = new PRPPipeline(
        prdPath,
        undefined,
        undefined,
        false,
        false,
        undefined,
        undefined,
        undefined, // monitorInterval
        1, // monitorTaskInterval (positional; constructor default)
        false, // disableMonitoring
        planDir
      );
      const result2 = await pipeline2.run();

      // VERIFY
      expect(result2.sessionPath).toBe(sessionPath);
      expect(result2.success).toBe(true);
    });

    it('should skip backlog generation for existing session with backlog', async () => {
      // SETUP: Create session with existing backlog
      createTestPRD();

      // First run to create session
      const mockAgent = {
        prompt: vi.fn().mockResolvedValue({ backlog: { backlog: [] } }),
      };
      const { createArchitectAgent } =
        await import('../../src/agents/agent-factory.js');
      (createArchitectAgent as any).mockReturnValue(mockAgent);
      (readFile as any).mockImplementation((path: string, encoding?: any) => {
        if (path.includes('tasks.json')) {
          return JSON.stringify({ backlog: [] });
        }
        // Return actual file content for other files (like PRD.md)
        const actual = require('node:fs/promises'); // eslint-disable-line @typescript-eslint/no-var-requires
        return actual.readFile(path, encoding);
      });

      const pipeline1 = new PRPPipeline(
        prdPath,
        undefined,
        undefined,
        false,
        false,
        undefined,
        undefined,
        undefined, // monitorInterval
        1, // monitorTaskInterval (positional; constructor default)
        false, // disableMonitoring
        planDir
      );
      await pipeline1.run();

      // Second run - architect should not be called (existing backlog)
      // Create fresh mock for second run
      const mockAgent2 = {
        prompt: vi.fn().mockResolvedValue({ backlog: { backlog: [] } }),
      };
      (createArchitectAgent as any).mockReturnValue(mockAgent2);
      // Mock readFile to return non-empty backlog to simulate existing session
      (readFile as any).mockImplementation((path: string, encoding?: any) => {
        if (path.includes('tasks.json')) {
          return JSON.stringify({
            backlog: [
              {
                id: 'P1',
                type: 'Phase',
                title: 'Phase 1',
                status: 'Complete' as Status,
                description: 'Test phase',
                milestones: [],
              },
            ],
          });
        }
        return '';
      });

      const pipeline2 = new PRPPipeline(
        prdPath,
        undefined,
        undefined,
        false,
        false,
        undefined,
        undefined,
        undefined, // monitorInterval
        1, // monitorTaskInterval (positional; constructor default)
        false, // disableMonitoring
        planDir
      );
      await pipeline2.run();

      // VERIFY: Architect agent not called for existing session with backlog
      expect(mockAgent2.prompt).not.toHaveBeenCalled();
    });
  });

  describe('state transitions through all phases', () => {
    it('should transition through all phases correctly', async () => {
      // SETUP
      createTestPRD();

      const mockAgent = {
        prompt: vi.fn().mockResolvedValue({ backlog: { backlog: [] } }),
      };
      const { createArchitectAgent } =
        await import('../../src/agents/agent-factory.js');
      (createArchitectAgent as any).mockReturnValue(mockAgent);
      (readFile as any).mockImplementation((path: string, encoding?: any) => {
        if (path.includes('tasks.json')) {
          return JSON.stringify({ backlog: [] });
        }
        // Return actual file content for other files (like PRD.md)
        const actual = require('node:fs/promises'); // eslint-disable-line @typescript-eslint/no-var-requires
        return actual.readFile(path, encoding);
      });

      // EXECUTE
      const pipeline = new PRPPipeline(
        prdPath,
        undefined,
        undefined,
        false,
        false,
        undefined,
        undefined,
        undefined, // monitorInterval
        1, // monitorTaskInterval (positional; constructor default)
        false, // disableMonitoring
        planDir
      );

      // Run the pipeline
      await pipeline.run();

      // VERIFY: Final phase is shutdown_complete (cleanup runs in finally block)
      expect(pipeline.currentPhase).toBe('shutdown_complete');
    });

    it('should update task counts during execution', async () => {
      // SETUP
      createTestPRD();

      // Create backlog with subtasks
      const backlog: Backlog = {
        backlog: [
          {
            id: 'P1',
            type: 'Phase',
            title: 'Phase 1',
            status: 'Planned' as Status,
            description: 'Test phase',
            milestones: [
              {
                id: 'P1.M1',
                type: 'Milestone',
                title: 'Milestone 1',
                status: 'Planned' as Status,
                description: 'Test milestone',
                tasks: [
                  {
                    id: 'P1.M1.T1',
                    type: 'Task',
                    title: 'Task 1',
                    status: 'Planned' as Status,
                    description: 'Test task',
                    subtasks: [
                      {
                        id: 'P1.M1.T1.S1',
                        type: 'Subtask',
                        title: 'Subtask 1',
                        status: 'Complete' as Status,
                        story_points: 1,
                        dependencies: [],
                        // context_scope must satisfy ContextScopeSchema
                        // (src/core/models.ts): start with "CONTRACT DEFINITION:\n"
                        // and contain the 4 numbered sections in order.
                        context_scope: [
                          'CONTRACT DEFINITION:',
                          '1. RESEARCH NOTE: Test fixture for task-count tracking.',
                          '2. INPUT: Backlog fixture with one Complete subtask.',
                          '3. LOGIC: decomposePRD loads + saves the backlog unchanged.',
                          '4. OUTPUT: totalTasks/completedTasks reflect the fixture.',
                        ].join('\n'),
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      };

      const mockAgent = {
        prompt: vi.fn().mockResolvedValue({ backlog }),
      };
      const { createArchitectAgent } =
        await import('../../src/agents/agent-factory.js');
      (createArchitectAgent as any).mockReturnValue(mockAgent);
      const actual = require('node:fs/promises'); // eslint-disable-line @typescript-eslint/no-var-requires
      (readFile as any).mockImplementation((path: string, encoding?: any) => {
        if (path.includes('tasks.json')) {
          return JSON.stringify(backlog);
        }
        if (path.includes(prdPath)) {
          // readUTF8FileStrict calls readFile(path) WITHOUT encoding (Buffer);
          // delegate to real readFile so the return type matches production.
          return actual.readFile(path, encoding);
        }
        return '';
      });

      // EXECUTE
      const pipeline = new PRPPipeline(
        prdPath,
        undefined,
        undefined,
        false,
        false,
        undefined,
        undefined,
        undefined, // monitorInterval
        1, // monitorTaskInterval (positional; constructor default)
        false, // disableMonitoring
        planDir
      );
      const result = await pipeline.run();

      // VERIFY
      expect(result.totalTasks).toBe(1);
      expect(result.completedTasks).toBe(1);
    });
  });

  describe('PipelineResult summary accuracy', () => {
    it('should return accurate phase summaries', async () => {
      // SETUP
      createTestPRD();

      // Create backlog with multiple phases
      const backlog: Backlog = {
        backlog: [
          {
            id: 'P1',
            type: 'Phase',
            title: 'Phase 1',
            status: 'Complete' as Status,
            description: 'Test phase 1',
            milestones: [
              {
                id: 'P1.M1',
                type: 'Milestone',
                title: 'Milestone 1',
                status: 'Complete' as Status,
                description: 'Test milestone',
                tasks: [],
              },
              {
                id: 'P1.M2',
                type: 'Milestone',
                title: 'Milestone 2',
                status: 'Planned' as Status,
                description: 'Test milestone',
                tasks: [],
              },
            ],
          },
          {
            id: 'P2',
            type: 'Phase',
            title: 'Phase 2',
            status: 'Planned' as Status,
            description: 'Test phase 2',
            milestones: [],
          },
        ],
      };

      const mockAgent = {
        prompt: vi.fn().mockResolvedValue({ backlog }),
      };
      const { createArchitectAgent } =
        await import('../../src/agents/agent-factory.js');
      (createArchitectAgent as any).mockReturnValue(mockAgent);
      const actual = require('node:fs/promises'); // eslint-disable-line @typescript-eslint/no-var-requires
      (readFile as any).mockImplementation((path: string, encoding?: any) => {
        if (path.includes('tasks.json')) {
          return JSON.stringify(backlog);
        }
        if (path.includes(prdPath)) {
          // readUTF8FileStrict calls readFile(path) WITHOUT encoding (Buffer);
          // delegate to real readFile so the return type matches production.
          return actual.readFile(path, encoding);
        }
        return '';
      });

      // EXECUTE
      const pipeline = new PRPPipeline(
        prdPath,
        undefined,
        undefined,
        false,
        false,
        undefined,
        undefined,
        undefined, // monitorInterval
        1, // monitorTaskInterval (positional; constructor default)
        false, // disableMonitoring
        planDir
      );
      const result = await pipeline.run();

      // VERIFY
      expect(result.phases).toHaveLength(2);
      expect(result.phases[0]).toEqual({
        id: 'P1',
        title: 'Phase 1',
        status: 'Complete',
        totalMilestones: 2,
        completedMilestones: 1,
      });
      expect(result.phases[1]).toEqual({
        id: 'P2',
        title: 'Phase 2',
        status: 'Planned',
        totalMilestones: 0,
        completedMilestones: 0,
      });
    });

    it('should calculate duration correctly', async () => {
      // SETUP
      createTestPRD();

      const mockAgent = {
        prompt: vi.fn().mockResolvedValue({ backlog: { backlog: [] } }),
      };
      const { createArchitectAgent } =
        await import('../../src/agents/agent-factory.js');
      (createArchitectAgent as any).mockReturnValue(mockAgent);
      (readFile as any).mockImplementation((path: string, encoding?: any) => {
        if (path.includes('tasks.json')) {
          return JSON.stringify({ backlog: [] });
        }
        // Return actual file content for other files (like PRD.md)
        const actual = require('node:fs/promises'); // eslint-disable-line @typescript-eslint/no-var-requires
        return actual.readFile(path, encoding);
      });

      // EXECUTE
      const startTime = performance.now();
      const pipeline = new PRPPipeline(
        prdPath,
        undefined,
        undefined,
        false,
        false,
        undefined,
        undefined,
        undefined, // monitorInterval
        1, // monitorTaskInterval (positional; constructor default)
        false, // disableMonitoring
        planDir
      );
      const result = await pipeline.run();
      const endTime = performance.now();

      // VERIFY
      expect(result.duration).toBeGreaterThan(0);
      expect(result.duration).toBeLessThan(endTime - startTime + 100); // Allow some margin
    });
  });

  describe('error handling', () => {
    it('should return failed result on error', async () => {
      // SETUP: Create invalid PRD path
      const invalidPath = join(tempDir, 'nonexistent.md');

      // EXECUTE
      const pipeline = new PRPPipeline(
        invalidPath,
        undefined,
        undefined,
        false,
        false,
        undefined,
        undefined,
        undefined, // monitorInterval
        1, // monitorTaskInterval (positional; constructor default)
        false, // disableMonitoring
        planDir
      );
      const result = await pipeline.run();

      // VERIFY
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.finalPhase).toBe('init'); // Phase should not change if init fails
    });

    it('should handle scope parameter correctly', async () => {
      // SETUP
      createTestPRD();

      const mockAgent = {
        prompt: vi.fn().mockResolvedValue({ backlog: { backlog: [] } }),
      };
      const { createArchitectAgent } =
        await import('../../src/agents/agent-factory.js');
      (createArchitectAgent as any).mockReturnValue(mockAgent);
      (readFile as any).mockImplementation((path: string, encoding?: any) => {
        if (path.includes('tasks.json')) {
          return JSON.stringify({ backlog: [] });
        }
        // Return actual file content for other files (like PRD.md)
        const actual = require('node:fs/promises'); // eslint-disable-line @typescript-eslint/no-var-requires
        return actual.readFile(path, encoding);
      });

      // EXECUTE with scope
      const pipeline = new PRPPipeline(
        prdPath,
        { type: 'phase', id: 'P1' },
        undefined,
        false,
        false,
        undefined,
        undefined,
        undefined, // monitorInterval
        1, // monitorTaskInterval (positional; constructor default)
        false, // disableMonitoring
        planDir
      );
      const result = await pipeline.run();

      // VERIFY
      expect(result.success).toBe(true);
    });
  });
});
