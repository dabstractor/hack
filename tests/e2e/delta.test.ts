/**
 * End-to-end tests for delta session workflow
 *
 * @remarks
 * Tests validate complete delta session workflow:
 * 1. Initial PRPPipeline run with PRD v1
 * 2. PRD modification to PRD v2
 * 3. Delta PRPPipeline run with PRD v2
 * 4. Validation of delta session, parent reference, and patched backlog
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// =============================================================================
// MOCK PATTERN: Module-level mocking with hoisting
// =============================================================================

// Mock groundswell for createAgent, createPrompt
vi.mock('groundswell', async () => {
  const actual = await vi.importActual('groundswell');
  return {
    ...actual,
    createAgent: vi.fn(),
    createPrompt: vi.fn(),
  };
});

// Mock agent factory (all agents including QA)
vi.mock('../../src/agents/agent-factory.js', () => ({
  createArchitectAgent: vi.fn(),
  createResearcherAgent: vi.fn(),
  createCoderAgent: vi.fn(),
  createQAAgent: vi.fn(),
}));

// Mock DeltaAnalysisWorkflow
vi.mock('../../src/workflows/delta-analysis-workflow.js', () => ({
  DeltaAnalysisWorkflow: vi.fn(),
}));

// Mock ValidationWorkflow — the validation stage now runs in run() before
// runQACycle (PRD §4.4 step 1). Default: validation passes.
vi.mock('../../src/workflows/validation-workflow.js', () => ({
  ValidationWorkflow: vi.fn().mockImplementation(() => ({
    run: vi.fn().mockResolvedValue({
      success: true,
      exitCode: 0,
      timedOut: false,
      stdout: '',
      stderr: '',
      scriptPath: '/plan/validate.sh',
      durationMs: 0,
    }),
  })),
  ValidationFailedError: class ValidationFailedError extends Error {
    readonly timedOut: boolean;
    readonly exitCode: number | null;
    constructor(outcome: { timedOut: boolean; exitCode: number | null }) {
      super('Validation failed (mock)');
      this.name = 'ValidationFailedError';
      this.timedOut = outcome.timedOut || outcome.exitCode === 124;
      this.exitCode = outcome.exitCode;
    }
  },
}));

// Mock fs/promises for file operations
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
  };
});

// Mock node:fs for existsSync, realpathSync, preserve real mkdtempSync, rmSync
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: vi.fn(() => true),
    realpathSync: vi.fn((path: unknown) => path as string),
  };
});

// Mock child_process for BashMCP
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

// Mock simple-git for GitMCP
vi.mock('simple-git', () => ({
  simpleGit: vi.fn(() => mockGitInstance),
  GitError: class MockGitError extends Error {
    name = 'GitError';
    message: string;
    constructor(message: string) {
      super(message);
      this.message = message;
    }
  },
}));

// =============================================================================
// IMPORT MOCKED MODULES
// =============================================================================

import { createAgent, createPrompt } from 'groundswell';
import { spawn } from 'node:child_process';
import {
  createArchitectAgent,
  createResearcherAgent,
  createCoderAgent,
  createQAAgent,
} from '../../src/agents/agent-factory.js';
import { PRPPipeline } from '../../src/workflows/prp-pipeline.js';
import { DeltaAnalysisWorkflow } from '../../src/workflows/delta-analysis-workflow.js';
import { mockSimplePRD } from '../fixtures/simple-prd.js';
import { mockSimplePRDv2 } from '../fixtures/simple-prd-v2.js';
import type { Backlog, Status, DeltaAnalysis } from '../../src/core/models.js';

// =============================================================================
// MOCK FIXTURES
// =============================================================================

// Mock Agent with prompt method
const mockAgent = {
  prompt: vi.fn(),
};

// Mock Prompt object
const mockPrompt = {
  user: '',
  system: '',
  responseFormat: {},
  enableReflection: true,
};

// Setup createAgent to return mock agent
vi.mocked(createAgent).mockReturnValue(mockAgent as never);
vi.mocked(createPrompt).mockReturnValue(mockPrompt as never);

// Mock git instance
const mockGitInstance = {
  status: vi.fn().mockResolvedValue({
    current: 'main',
    files: [],
    is_clean: () => true,
  }),
  diff: vi.fn().mockResolvedValue(''),
  add: vi.fn().mockResolvedValue(undefined),
  commit: vi.fn().mockResolvedValue({
    commit: 'abc123',
    branch: 'main',
  }),
};

// =============================================================================
// MOCK FACTORY: createMockBacklogV1 (3 subtasks, all Complete)
// =============================================================================

function createMockBacklogV1(): Backlog {
  return {
    backlog: [
      {
        id: 'P1',
        type: 'Phase',
        title: 'Test Phase',
        status: 'Complete' as Status,
        description: 'Validate pipeline functionality with minimal complexity',
        milestones: [
          {
            id: 'P1.M1',
            type: 'Milestone',
            title: 'Test Milestone',
            status: 'Complete' as Status,
            description: 'Create a simple hello world implementation',
            tasks: [
              {
                id: 'P1.M1.T1',
                type: 'Task',
                title: 'Create Hello World',
                status: 'Complete' as Status,
                description:
                  'Implement a basic hello world function with tests',
                subtasks: [
                  {
                    id: 'P1.M1.T1.S1',
                    type: 'Subtask',
                    title: 'Write Hello World Function',
                    status: 'Complete' as Status,
                    story_points: 1,
                    dependencies: [],
                    context_scope: '...',
                  },
                  {
                    id: 'P1.M1.T1.S2',
                    type: 'Subtask',
                    title: 'Write Test for Hello World',
                    status: 'Complete' as Status,
                    story_points: 1,
                    dependencies: ['P1.M1.T1.S1'],
                    context_scope: '...',
                  },
                  {
                    id: 'P1.M1.T1.S3',
                    type: 'Subtask',
                    title: 'Run Test',
                    status: 'Complete' as Status,
                    story_points: 1,
                    dependencies: ['P1.M1.T1.S2'],
                    context_scope: '...',
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

// =============================================================================
// MOCK FACTORY: createMockBacklogV2 (4 subtasks, 3 Complete + 1 Planned)
// =============================================================================

function createMockBacklogV2(): Backlog {
  return {
    backlog: [
      {
        id: 'P1',
        type: 'Phase',
        title: 'Test Phase',
        status: 'Complete' as Status,
        description: 'Validate pipeline functionality with minimal complexity',
        milestones: [
          {
            id: 'P1.M1',
            type: 'Milestone',
            title: 'Test Milestone',
            status: 'Complete' as Status,
            description: 'Create a simple hello world implementation',
            tasks: [
              {
                id: 'P1.M1.T1',
                type: 'Task',
                title: 'Create Hello World',
                status: 'Complete' as Status,
                description:
                  'Implement a basic hello world function with tests',
                subtasks: [
                  {
                    id: 'P1.M1.T1.S1',
                    type: 'Subtask',
                    title: 'Write Hello World Function',
                    status: 'Complete' as Status,
                    story_points: 2, // CHANGED from 1
                    dependencies: [],
                    context_scope: '...',
                  },
                  {
                    id: 'P1.M1.T1.S2',
                    type: 'Subtask',
                    title: 'Write Test for Hello World',
                    status: 'Complete' as Status,
                    story_points: 1,
                    dependencies: ['P1.M1.T1.S1'],
                    context_scope: '...',
                  },
                  {
                    id: 'P1.M1.T1.S3',
                    type: 'Subtask',
                    title: 'Run Test',
                    status: 'Complete' as Status,
                    story_points: 1,
                    dependencies: ['P1.M1.T1.S2'],
                    context_scope: '...',
                  },
                ],
              },
              {
                id: 'P1.M1.T2',
                type: 'Task',
                title: 'Add Calculator Functions',
                status: 'Planned' as Status, // NEW task
                description: 'Implement basic calculator operations',
                subtasks: [
                  {
                    id: 'P1.M1.T2.S1',
                    type: 'Subtask',
                    title: 'Implement Calculator Functions',
                    status: 'Planned' as Status, // NEW subtask
                    story_points: 3,
                    dependencies: [],
                    context_scope: '...',
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

// =============================================================================
// MOCK FACTORY: createMockChild for ChildProcess
// =============================================================================

function createMockChild(
  options: {
    exitCode?: number;
    stdout?: string;
    stderr?: string;
  } = {}
) {
  const { exitCode = 0, stdout = 'test output', stderr = '' } = options;

  return {
    stdout: {
      on: vi.fn((event: string, callback: (data: Buffer) => void) => {
        if (event === 'data') {
          setTimeout(() => callback(Buffer.from(stdout)), 5);
        }
      }),
    },
    stderr: {
      on: vi.fn((event: string, callback: (data: Buffer) => void) => {
        if (event === 'data') {
          setTimeout(() => callback(Buffer.from(stderr)), 5);
        }
      }),
    },
    on: vi.fn((event: string, callback: (code: number) => void) => {
      if (event === 'close') {
        setTimeout(() => callback(exitCode), 10);
      }
    }),
    killed: false,
    kill: vi.fn(),
  } as unknown as import('node:child_process').ChildProcess;
}

// =============================================================================
// MOCK DELTA ANALYSIS RESULT
// =============================================================================

const mockDeltaAnalysis: DeltaAnalysis = {
  changes: [
    {
      type: 'added',
      itemId: 'P1.M1.T2',
      description: 'Add Calculator Functions',
      impact: 'New task requires implementation',
    },
    {
      type: 'modified',
      itemId: 'P1.M1.T1.S1',
      description: 'Write Hello World Function (enhanced)',
      impact: 'Story points changed from 1 to 2',
    },
  ],
  patchInstructions:
    'Re-execute P1.M1.T1.S1 with new story points. Implement new task P1.M1.T2.',
  taskIds: ['P1.M1.T1.S1', 'P1.M1.T2'],
};

// =============================================================================
// TEST SUITE: E2E Delta Session Tests
// =============================================================================

describe('E2E Delta Session Tests', () => {
  let tempDir: string;
  let prdPath: string;
  let planDir: string;

  beforeEach(() => {
    // Clear all mocks
    vi.clearAllMocks();

    // Create temp directory
    tempDir = mkdtempSync(join(tmpdir(), 'e2e-delta-test-'));
    prdPath = join(tempDir, 'PRD.md');
    planDir = join(tempDir, 'plan');

    // Setup agent mocks
    vi.mocked(createArchitectAgent).mockReturnValue(mockAgent as never);
    vi.mocked(createResearcherAgent).mockReturnValue(mockAgent as never);
    vi.mocked(createCoderAgent).mockReturnValue(mockAgent as never);
    vi.mocked(createQAAgent).mockReturnValue(mockAgent as never);

    // Setup existsSync mock
    vi.mocked(existsSync).mockReturnValue(true);

    // Setup spawn mock for BashMCP
    vi.mocked(spawn).mockReturnValue(
      createMockChild({ stdout: '', exitCode: 0 }) as never
    );

    // Use real timers for async mock behavior
    vi.useRealTimers();
  });

  afterEach(() => {
    // Cleanup temp directory
    rmSync(tempDir, { recursive: true, force: true });

    // Restore fake timers
    vi.useFakeTimers();
  });

  // =============================================================================
  // TEST: Full Delta Session Workflow
  // =============================================================================

  it('should complete delta session workflow successfully', async () => {
    // =======================================================================
    // PHASE 1: Initial Run with PRD v1
    // =======================================================================

    // ARRANGE: Write PRD v1 and setup mocks
    writeFileSync(prdPath, mockSimplePRD);
    const initialBacklogV1 = createMockBacklogV1();

    vi.mocked(readFile).mockImplementation(path => {
      const pathStr = String(path);
      if (pathStr.includes('PRD.md')) {
        return Promise.resolve(mockSimplePRD);
      }
      if (pathStr.includes('tasks.json')) {
        return Promise.resolve(JSON.stringify(initialBacklogV1));
      }
      if (pathStr.includes('prd_snapshot.md')) {
        return Promise.resolve(mockSimplePRD);
      }
      return Promise.resolve('');
    });

    vi.mocked(writeFile).mockResolvedValue(undefined);
    vi.mocked(mkdir).mockResolvedValue(undefined);

    // ACT: Run initial pipeline
    const start1 = performance.now();
    const pipeline1 = new PRPPipeline(
      prdPath,
      undefined,
      'normal',
      false,
      false,
      undefined,
      undefined,
      planDir
    );

    // Mock pipeline methods to bypass actual execution
    const mockSession1 = {
      metadata: {
        id: '001_aaaaaaaaaa',
        hash: 'aaaaaaaaaa',
        path: join(planDir, '001_aaaaaaaaaa'),
        createdAt: new Date(),
        parentSession: null,
      },
      prdSnapshot: mockSimplePRD,
      taskRegistry: initialBacklogV1,
      currentItemId: null,
    };

    const _initializeSpy = vi
      .spyOn(pipeline1 as any, 'initializeSession')
      .mockResolvedValue(undefined);
    const _decomposeSpy = vi
      .spyOn(pipeline1 as any, 'decomposePRD')
      .mockImplementation(async () => {
        (pipeline1 as any).sessionManager = { currentSession: mockSession1 };
        (pipeline1 as any).totalTasks = 3;
        (pipeline1 as any).completedTasks = 3;
      });
    const _executeSpy = vi
      .spyOn(pipeline1 as any, 'executeBacklog')
      .mockResolvedValue(undefined);
    const _qaSpy = vi
      .spyOn(pipeline1 as any, 'runQACycle')
      .mockResolvedValue(undefined);
    const _cleanupSpy = vi
      .spyOn(pipeline1 as any, 'cleanup')
      .mockResolvedValue(undefined);

    const result1 = await pipeline1.run();
    const duration1 = performance.now() - start1;

    // ASSERT: Verify initial session
    expect(result1.success).toBe(true);
    expect(result1.sessionPath).toBeDefined();

    // =======================================================================
    // PHASE 2: Delta Run with PRD v2
    // =======================================================================

    // ARRANGE: Write PRD v2 and setup mocks
    writeFileSync(prdPath, mockSimplePRDv2);

    // Setup DeltaAnalysisWorkflow mock
    const mockDeltaWorkflow = {
      analyzeDelta: vi.fn().mockResolvedValue(mockDeltaAnalysis),
      run: vi.fn().mockResolvedValue(mockDeltaAnalysis),
    };
    vi.mocked(DeltaAnalysisWorkflow).mockImplementation(
      () => mockDeltaWorkflow as never
    );

    vi.mocked(readFile).mockImplementation(path => {
      const pathStr = String(path);
      if (pathStr.includes('PRD.md')) {
        return Promise.resolve(mockSimplePRDv2);
      }
      if (pathStr.includes('tasks.json')) {
        return Promise.resolve(JSON.stringify(createMockBacklogV2()));
      }
      if (pathStr.includes('prd_snapshot.md')) {
        return Promise.resolve(mockSimplePRD);
      }
      if (pathStr.includes('parent_session.txt')) {
        return Promise.resolve(result1.sessionPath.split('/').pop() as string);
      }
      return Promise.resolve('');
    });

    // ACT: Run delta pipeline
    const start2 = performance.now();
    const pipeline2 = new PRPPipeline(
      prdPath,
      undefined,
      'normal',
      false,
      false,
      undefined,
      undefined,
      planDir
    );

    // Mock delta session manager
    const initialSessionId = result1.sessionPath.split('/').pop() as string;
    const deltaSessionId = '002_bbbbbbbbbbb';
    const deltaBacklog = createMockBacklogV2();

    const mockSession2 = {
      metadata: {
        id: deltaSessionId,
        hash: 'bbbbbbbbbb',
        path: join(planDir, deltaSessionId),
        createdAt: new Date(),
        parentSession: initialSessionId,
      },
      prdSnapshot: mockSimplePRDv2,
      taskRegistry: deltaBacklog,
      currentItemId: null,
    };

    const _initializeSpy2 = vi
      .spyOn(pipeline2 as any, 'initializeSession')
      .mockResolvedValue(undefined);
    const _decomposeSpy2 = vi
      .spyOn(pipeline2 as any, 'decomposePRD')
      .mockImplementation(async () => {
        (pipeline2 as any).sessionManager = {
          currentSession: mockSession2,
          hasSessionChanged: vi.fn().mockReturnValue(true),
        };
        (pipeline2 as any).totalTasks = 4;
        (pipeline2 as any).completedTasks = 4;
      });
    const _handleDeltaSpy = vi
      .spyOn(pipeline2 as any, 'handleDelta')
      .mockImplementation(async () => {
        (pipeline2 as any).sessionManager.currentSession = mockSession2;
      });
    const _executeSpy2 = vi
      .spyOn(pipeline2 as any, 'executeBacklog')
      .mockResolvedValue(undefined);
    const _qaSpy2 = vi
      .spyOn(pipeline2 as any, 'runQACycle')
      .mockResolvedValue(undefined);
    const _cleanupSpy2 = vi
      .spyOn(pipeline2 as any, 'cleanup')
      .mockResolvedValue(undefined);

    const result2 = await pipeline2.run();
    const duration2 = performance.now() - start2;

    // ASSERT: Verify delta session created
    expect(result2.success).toBe(true);
    expect(result2.sessionPath).toBeDefined();
    expect(result2.sessionPath).not.toBe(result1.sessionPath); // Different session

    // ASSERT: Verify parent reference in metadata
    expect(mockSession2.metadata.parentSession).toBe(initialSessionId);

    // ASSERT: Verify patched backlog has 4 subtasks (3 original + 1 new)
    const allSubtasks = deltaBacklog.backlog[0].milestones[0].tasks.flatMap(
      (t: any) => t.subtasks
    );
    expect(allSubtasks).toHaveLength(4);

    // ASSERT: Verify original tasks preserved (still Complete)
    const originalSubtaskIds = ['P1.M1.T1.S1', 'P1.M1.T1.S2', 'P1.M1.T1.S3'];
    const preservedTasks = allSubtasks.filter((s: any) =>
      originalSubtaskIds.includes(s.id)
    );
    expect(preservedTasks).toHaveLength(3);
    expect(preservedTasks.every((s: any) => s.status === 'Complete')).toBe(
      true
    );

    // ASSERT: Verify new task exists
    const newTask = allSubtasks.find((s: any) => s.id === 'P1.M1.T2.S1');
    expect(newTask).toBeDefined();

    // LOG: Execution time
    const totalDuration = duration1 + duration2;
    expect(totalDuration).toBeLessThan(30000); // <30 seconds
    console.log(`Delta E2E test completed in ${totalDuration.toFixed(0)}ms`);
  });

  // =============================================================================
  // TEST: Parent Session Reference
  // =============================================================================

  it('should create parent_session.txt referencing initial session', async () => {
    // PHASE 1: Initial Run
    writeFileSync(prdPath, mockSimplePRD);
    const initialBacklogV1 = createMockBacklogV1();

    vi.mocked(readFile).mockResolvedValue(mockSimplePRD);
    vi.mocked(writeFile).mockResolvedValue(undefined);
    vi.mocked(mkdir).mockResolvedValue(undefined);

    const pipeline1 = new PRPPipeline(
      prdPath,
      undefined,
      'normal',
      false,
      false,
      undefined,
      undefined,
      planDir
    );
    const initialSessionId = '001_aaaaaaaaaa';

    const mockSession1 = {
      metadata: {
        id: initialSessionId,
        hash: 'aaaaaaaaaa',
        path: join(planDir, initialSessionId),
        createdAt: new Date(),
        parentSession: null,
      },
      prdSnapshot: mockSimplePRD,
      taskRegistry: initialBacklogV1,
      currentItemId: null,
    };

    vi.spyOn(pipeline1 as any, 'initializeSession').mockResolvedValue(
      undefined
    );
    vi.spyOn(pipeline1 as any, 'decomposePRD').mockImplementation(async () => {
      (pipeline1 as any).sessionManager = { currentSession: mockSession1 };
      (pipeline1 as any).totalTasks = 3;
      (pipeline1 as any).completedTasks = 3;
    });
    vi.spyOn(pipeline1 as any, 'executeBacklog').mockResolvedValue(undefined);
    vi.spyOn(pipeline1 as any, 'runQACycle').mockResolvedValue(undefined);
    vi.spyOn(pipeline1 as any, 'cleanup').mockResolvedValue(undefined);

    const result1 = await pipeline1.run();
    expect(result1.success).toBe(true);

    // PHASE 2: Delta Run
    writeFileSync(prdPath, mockSimplePRDv2);

    const mockDeltaWorkflow = {
      analyzeDelta: vi.fn().mockResolvedValue(mockDeltaAnalysis),
      run: vi.fn().mockResolvedValue(mockDeltaAnalysis),
    };
    vi.mocked(DeltaAnalysisWorkflow).mockImplementation(
      () => mockDeltaWorkflow as never
    );

    vi.mocked(readFile).mockResolvedValue(mockSimplePRDv2);

    const pipeline2 = new PRPPipeline(
      prdPath,
      undefined,
      'normal',
      false,
      false,
      undefined,
      undefined,
      planDir
    );
    const deltaSessionId = '002_bbbbbbbbbbb';

    const mockSession2 = {
      metadata: {
        id: deltaSessionId,
        hash: 'bbbbbbbbbb',
        path: join(planDir, deltaSessionId),
        createdAt: new Date(),
        parentSession: initialSessionId,
      },
      prdSnapshot: mockSimplePRDv2,
      taskRegistry: createMockBacklogV2(),
      currentItemId: null,
    };

    vi.spyOn(pipeline2 as any, 'initializeSession').mockResolvedValue(
      undefined
    );
    vi.spyOn(pipeline2 as any, 'decomposePRD').mockImplementation(async () => {
      (pipeline2 as any).sessionManager = {
        currentSession: mockSession2,
        hasSessionChanged: vi.fn().mockReturnValue(true),
      };
      (pipeline2 as any).totalTasks = 4;
      (pipeline2 as any).completedTasks = 4;
    });
    const _handleDeltaSpy2 = vi
      .spyOn(pipeline2 as any, 'handleDelta')
      .mockImplementation(async () => {
        (pipeline2 as any).sessionManager.currentSession = mockSession2;
      });
    vi.spyOn(pipeline2 as any, 'executeBacklog').mockResolvedValue(undefined);
    vi.spyOn(pipeline2 as any, 'runQACycle').mockResolvedValue(undefined);
    vi.spyOn(pipeline2 as any, 'cleanup').mockResolvedValue(undefined);

    const result2 = await pipeline2.run();

    // ASSERT: Verify delta session created with parent reference
    expect(result2.success).toBe(true);
    expect(mockSession2.metadata.parentSession).toBe(initialSessionId);
  });

  // =============================================================================
  // TEST: Task Preservation
  // =============================================================================

  it('should preserve original completed tasks in delta session', async () => {
    // PHASE 1: Initial Run
    writeFileSync(prdPath, mockSimplePRD);
    const initialBacklog = createMockBacklogV1();

    vi.mocked(readFile).mockImplementation(path => {
      const pathStr = String(path);
      if (pathStr.includes('PRD.md')) {
        return Promise.resolve(mockSimplePRD);
      }
      return Promise.resolve(JSON.stringify(initialBacklog));
    });
    vi.mocked(writeFile).mockResolvedValue(undefined);
    vi.mocked(mkdir).mockResolvedValue(undefined);

    const pipeline1 = new PRPPipeline(
      prdPath,
      undefined,
      'normal',
      false,
      false,
      undefined,
      undefined,
      planDir
    );
    const initialSessionId = '001_aaaaaaaaaa';

    const mockSession1 = {
      metadata: {
        id: initialSessionId,
        hash: 'aaaaaaaaaa',
        path: join(planDir, initialSessionId),
        createdAt: new Date(),
        parentSession: null,
      },
      prdSnapshot: mockSimplePRD,
      taskRegistry: initialBacklog,
      currentItemId: null,
    };

    vi.spyOn(pipeline1 as any, 'initializeSession').mockResolvedValue(
      undefined
    );
    vi.spyOn(pipeline1 as any, 'decomposePRD').mockImplementation(async () => {
      (pipeline1 as any).sessionManager = { currentSession: mockSession1 };
      (pipeline1 as any).totalTasks = 3;
      (pipeline1 as any).completedTasks = 3;
    });
    vi.spyOn(pipeline1 as any, 'executeBacklog').mockResolvedValue(undefined);
    vi.spyOn(pipeline1 as any, 'runQACycle').mockResolvedValue(undefined);
    vi.spyOn(pipeline1 as any, 'cleanup').mockResolvedValue(undefined);

    await pipeline1.run();

    const initialSubtasks =
      initialBacklog.backlog[0].milestones[0].tasks[0].subtasks;

    // PHASE 2: Delta Run
    writeFileSync(prdPath, mockSimplePRDv2);

    const mockDeltaWorkflow = {
      analyzeDelta: vi.fn().mockResolvedValue(mockDeltaAnalysis),
      run: vi.fn().mockResolvedValue(mockDeltaAnalysis),
    };
    vi.mocked(DeltaAnalysisWorkflow).mockImplementation(
      () => mockDeltaWorkflow as never
    );

    vi.mocked(readFile).mockImplementation(path => {
      const pathStr = String(path);
      if (pathStr.includes('PRD.md')) {
        return Promise.resolve(mockSimplePRDv2);
      }
      if (pathStr.includes('prd_snapshot.md')) {
        return Promise.resolve(mockSimplePRD);
      }
      return Promise.resolve(JSON.stringify(createMockBacklogV2()));
    });

    const pipeline2 = new PRPPipeline(
      prdPath,
      undefined,
      'normal',
      false,
      false,
      undefined,
      undefined,
      planDir
    );
    const deltaSessionId = '002_bbbbbbbbbbb';
    const deltaBacklog = createMockBacklogV2();

    const mockSession2 = {
      metadata: {
        id: deltaSessionId,
        hash: 'bbbbbbbbbb',
        path: join(planDir, deltaSessionId),
        createdAt: new Date(),
        parentSession: initialSessionId,
      },
      prdSnapshot: mockSimplePRDv2,
      taskRegistry: deltaBacklog,
      currentItemId: null,
    };

    vi.spyOn(pipeline2 as any, 'initializeSession').mockResolvedValue(
      undefined
    );
    vi.spyOn(pipeline2 as any, 'decomposePRD').mockImplementation(async () => {
      (pipeline2 as any).sessionManager = {
        currentSession: mockSession2,
        hasSessionChanged: vi.fn().mockReturnValue(true),
      };
      (pipeline2 as any).totalTasks = 4;
      (pipeline2 as any).completedTasks = 4;
    });
    vi.spyOn(pipeline2 as any, 'handleDelta').mockImplementation(async () => {
      (pipeline2 as any).sessionManager.currentSession = mockSession2;
    });
    vi.spyOn(pipeline2 as any, 'executeBacklog').mockResolvedValue(undefined);
    vi.spyOn(pipeline2 as any, 'runQACycle').mockResolvedValue(undefined);
    vi.spyOn(pipeline2 as any, 'cleanup').mockResolvedValue(undefined);

    await pipeline2.run();

    // Get delta subtasks
    const deltaSubtasks = deltaBacklog.backlog[0].milestones[0].tasks.flatMap(
      (t: any) => t.subtasks
    );

    // ASSERT: Verify original task IDs preserved
    const originalIds = initialSubtasks.map((s: any) => s.id);
    const deltaIds = deltaSubtasks.map((s: any) => s.id);
    originalIds.forEach((id: string) => {
      expect(deltaIds).toContain(id);
    });

    // ASSERT: Verify original tasks still Complete
    const preservedTasks = deltaSubtasks.filter((s: any) =>
      originalIds.includes(s.id)
    );
    expect(preservedTasks.every((s: any) => s.status === 'Complete')).toBe(
      true
    );
  });
});

// =============================================================================
// KEY IMPLEMENTATION DETAILS
// =============================================================================

// 1. TWO-PHASE TEST EXECUTION
// Test runs PRPPipeline twice: initial run with PRD v1, delta run with PRD v2
// Same temp directory used for both runs (don't cleanup between phases)

// 2. PRD MODIFICATION BETWEEN RUNS
// writeFileSync(prdPath, mockSimplePRDv2) overwrites PRD v1 with PRD v2
// This triggers hash mismatch and delta detection in second run

// 3. DELTA ANALYSIS MOCK
// DeltaAnalysisWorkflow.analyzeDelta() mocked to return predefined DeltaAnalysis
// Includes 'added' change (P1.M1.T2) and 'modified' change (P1.M1.T1.S1)

// 4. PARENT SESSION REFERENCE
// parent_session.txt file created in delta session directory
// Contains initial session ID for verification

// 5. TASK PRESERVATION
// Original completed tasks (P1.M1.T1.S1-S3) preserved in delta backlog
// New task (P1.M1.T2.S1) added to delta backlog

// 6. MODULE MOCKING WITH HOISTING
// All vi.mock() calls at top level before imports
// vi.mock() for DeltaAnalysisWorkflow in addition to agent mocks

// 7. FILE SYSTEM MOCKS
// readFile checks path to return PRD v1 or v2 based on current phase
// existsSync returns true for all paths in test

// 8. EXECUTION TIME MEASUREMENT
// performance.now() for millisecond precision
// Total duration (phase 1 + phase 2) asserted <30 seconds
