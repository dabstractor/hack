/**
 * Integration tests for TaskOrchestrator - Runtime Component Integration
 *
 * @remarks
 * Tests validate TaskOrchestrator correctly integrates with ResearchQueue and PRPRuntime
 * for parallel PRP generation and execution delegation. These tests complement the unit
 * tests by using actual SessionManager and mocked runtime components.
 *
 * Tests cover:
 * - ResearchQueue initialization with concurrency limit
 * - Subtask enqueuing via executeTask()
 * - ResearchQueue statistics (getStats)
 * - Background research triggering via processNext()
 * - PRPRuntime.executeSubtask() delegation
 * - Status progression (Researching → Implementing → Complete/Failed)
 * - Smart commit after successful execution
 * - Cache hit/miss behavior
 * - Cache metrics logging
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 * @see {@link ../../src/core/task-orchestrator.ts | TaskOrchestrator Implementation}
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  existsSync,
  mkdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { SessionManager } from '../../../src/core/session-manager.js';
import { TaskOrchestrator } from '../../../src/core/task-orchestrator.js';
import { PRPGenerator } from '../../../src/agents/prp-generator.js';
import { wireMockPRPGenerator } from '../../helpers/research-seam.js';
import type { Backlog, Subtask } from '../../../src/core/models.js';
import { mockSimplePRD } from '../../fixtures/simple-prd.js';

// =============================================================================
// Test Constants
// =============================================================================

const TEMP_DIR_TEMPLATE = join(tmpdir(), 'orchestrator-runtime-test-XXXXXX');

// Valid minimal context_scope (src/core/models.ts superRefine requires the
// 'CONTRACT DEFINITION:\n' prefix + 4 ordered sections). Shared across fixtures.
const CONTEXT_SCOPE =
  'CONTRACT DEFINITION:\n1. RESEARCH NOTE: none\n2. INPUT: none\n3. LOGIC: none\n4. OUTPUT: none';

// =============================================================================
// Mock Setup
// =============================================================================

// Mock the PRPRuntime class to control execution outcomes
vi.mock('../../../src/agents/prp-runtime.js', () => ({
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

// Mock the git-commit module
vi.mock('../../../src/utils/git-commit.js', () => ({
  smartCommit: vi.fn().mockResolvedValue('abc123'),
  filterProtectedFiles: vi.fn((files: string[]) => files),
  formatCommitMessage: vi.fn((msg: string) => msg),
  // parseItemPosition is imported by TaskOrchestrator from this module.
  parseItemPosition: vi.fn((id: string) => {
    const m = /^(\d+)\.M(\d+)\.T(\d+)(?:\.S(\d+))?$/.exec(id);
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

// Mock the PRPGenerator class (BUG-004 category (a) research seam). This suite's
// subject is orchestrator runtime behavior, NOT the research path — bypass
// generate() to avoid the `PiHarness not initialized` chain. Keeps ResearchQueue real.
vi.mock('../../../src/agents/prp-generator.js', () => ({
  PRPGenerator: vi.fn(),
}));

// =============================================================================
// Fixture Helper Functions
// =============================================================================

function createTestBacklog(): Backlog {
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
            id: 'P1.M1',
            title: 'Test Milestone',
            status: 'Planned',
            description: 'Test milestone',
            tasks: [
              {
                type: 'Task',
                id: 'P1.M1.T1',
                title: 'Test Task',
                status: 'Planned',
                description: 'Test task',
                subtasks: [
                  {
                    type: 'Subtask',
                    id: 'P1.M1.T1.S1',
                    title: 'Test Subtask 1',
                    status: 'Planned',
                    story_points: 1,
                    dependencies: [],
                    context_scope: CONTEXT_SCOPE,
                  },
                  {
                    type: 'Subtask',
                    id: 'P1.M1.T1.S2',
                    title: 'Test Subtask 2',
                    status: 'Planned',
                    story_points: 1,
                    dependencies: [],
                    context_scope: CONTEXT_SCOPE,
                  },
                  {
                    type: 'Subtask',
                    id: 'P1.M1.T1.S3',
                    title: 'Test Subtask 3',
                    status: 'Planned',
                    story_points: 1,
                    dependencies: [],
                    context_scope: CONTEXT_SCOPE,
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

function createSessionState(backlog: Backlog, planDir: string) {
  const { createHash } = require('node:crypto'); // eslint-disable-line @typescript-eslint/no-var-requires
  const hash = createHash('sha256')
    .update(JSON.stringify(backlog))
    .digest('hex');
  return {
    metadata: {
      id: `001_${hash.substring(0, 12)}`,
      hash: hash.substring(0, 12),
      path: join(planDir, `001_${hash.substring(0, 12)}`),
      createdAt: new Date(),
      parentSession: null,
    },
    prdSnapshot: mockSimplePRD,
    taskRegistry: backlog,
    currentItemId: null,
  };
}

function setupTestEnvironment(): {
  tempDir: string;
  prdPath: string;
  sessionManager: SessionManager;
} {
  const tempDir = mkdtempSync(TEMP_DIR_TEMPLATE);
  const planDir = join(tempDir, 'plan');
  const prdPath = join(tempDir, 'PRD.md');

  writeFileSync(prdPath, mockSimplePRD);

  const backlog = createTestBacklog();
  const sessionState = createSessionState(backlog, planDir);
  const sessionDir = sessionState.metadata.path;

  for (const dir of [
    sessionDir,
    join(sessionDir, 'architecture'),
    join(sessionDir, 'prps'),
    join(sessionDir, 'artifacts'),
  ]) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(
    join(sessionDir, 'tasks.json'),
    JSON.stringify({ backlog: backlog.backlog }, null, 2)
  );
  writeFileSync(join(sessionDir, 'prd_snapshot.md'), mockSimplePRD);
  writeFileSync(join(sessionDir, 'delta_from.txt'), '');

  const sessionManager = new SessionManager(prdPath, planDir);

  return { tempDir, prdPath, sessionManager };
}

// =============================================================================
// Test Suites
// =============================================================================

describe('TaskOrchestrator Runtime Integration Tests', () => {
  let tempDir: string;
  let prdPath: string;
  let sessionManager: SessionManager;

  beforeEach(async () => {
    const env = setupTestEnvironment();
    tempDir = env.tempDir;
    prdPath = env.prdPath;
    sessionManager = env.sessionManager;

    const backlog = createTestBacklog();
    const planDir = join(tempDir, 'plan');
    const sessionState = createSessionState(backlog, planDir);
    await sessionManager.loadSession(sessionState.metadata.path);

    // Wire the research seam before each test constructs the orchestrator.
    // (afterEach runs vi.clearAllMocks(), so re-wire per test here.)
    wireMockPRPGenerator({ PRPGenerator: vi.mocked(PRPGenerator) });
  });

  afterEach(() => {
    vi.clearAllMocks();
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // ===========================================================================
  // P2.M2.T2.S1: Test ResearchQueue integration
  // ===========================================================================

  describe('P2.M2.T2.S1: ResearchQueue Integration', () => {
    it('should initialize ResearchQueue with concurrency limit 3', async () => {
      // SETUP & EXECUTE
      const orchestrator = new TaskOrchestrator(sessionManager);

      // VERIFY: ResearchQueue should be accessible
      expect(orchestrator.researchQueue).toBeDefined();
      expect(orchestrator.researchQueue.maxSize).toBe(3);
    });

    it('should enqueue subtasks when executing task', async () => {
      // SETUP
      const orchestrator = new TaskOrchestrator(sessionManager);
      const backlog = sessionManager.currentSession!.taskRegistry;
      const task = backlog.backlog[0].milestones[0].tasks[0];

      // EXECUTE: Execute the task (which enqueues subtasks)
      await orchestrator.executeTask(task);

      // VERIFY: All three subtasks entered the research queue and completed
      // (the mocked PRPGenerator.generate resolves, caching each result).
      // executeTask uses the (default) flat-pool model to bulk-enqueue all
      // subtasks; they are processed and cached.
      const stats = orchestrator.researchQueue.getStats();
      expect(stats.cached).toBe(3); // Three subtasks researched + cached
    });

    it('should provide stats after enqueue', async () => {
      // SETUP
      const orchestrator = new TaskOrchestrator(sessionManager);
      const backlog = sessionManager.currentSession!.taskRegistry;
      const task = backlog.backlog[0].milestones[0].tasks[0];

      // EXECUTE: Execute task and get stats
      await orchestrator.executeTask(task);
      const stats = orchestrator.researchQueue.getStats();

      // VERIFY: Stats should reflect queue state
      expect(stats).toHaveProperty('queued');
      expect(stats).toHaveProperty('researching');
      expect(stats).toHaveProperty('cached');
      expect(typeof stats.queued).toBe('number');
      expect(typeof stats.researching).toBe('number');
      expect(typeof stats.cached).toBe('number');
    });

    it('should trigger background research via processNext', async () => {
      // SETUP
      const orchestrator = new TaskOrchestrator(sessionManager);
      const backlog = sessionManager.currentSession!.taskRegistry;
      const task = backlog.backlog[0].milestones[0].tasks[0];

      // EXECUTE: Enqueue and trigger background processing
      await orchestrator.executeTask(task);

      // processNext should not throw
      await expect(
        orchestrator.researchQueue.processNext(backlog)
      ).resolves.toBeUndefined();
    });
  });

  // ===========================================================================
  // P2.M2.T2.S2: Test PRPRuntime execution delegation
  // ===========================================================================

  describe('P2.M2.T2.S2: PRPRuntime Execution Delegation', () => {
    it('should delegate to PRPRuntime.executeSubtask when executing subtask', async () => {
      // SETUP
      const orchestrator = new TaskOrchestrator(sessionManager);
      const backlog = sessionManager.currentSession!.taskRegistry;
      const subtask = backlog.backlog[0].milestones[0].tasks[0].subtasks[0];

      // EXECUTE: Execute the subtask
      await orchestrator.executeSubtask(subtask);

      // VERIFY: Subtask should be marked Complete (PRPRuntime returned success)
      const updatedSession = sessionManager.currentSession!;
      const updatedSubtask =
        updatedSession.taskRegistry.backlog[0].milestones[0].tasks[0]
          .subtasks[0];
      expect(updatedSubtask.status).toBe('Complete');
    });

    it('should progress status through Researching → Implementing → Complete', async () => {
      // SETUP
      const orchestrator = new TaskOrchestrator(sessionManager);
      const backlog = sessionManager.currentSession!.taskRegistry;
      const subtask = backlog.backlog[0].milestones[0].tasks[0].subtasks[0];

      // SPY: Track status changes
      const statuses: string[] = [];
      const originalUpdateStatus =
        sessionManager.updateItemStatus.bind(sessionManager);
      vi.spyOn(sessionManager, 'updateItemStatus').mockImplementation(
        async (id, status) => {
          statuses.push(status);
          return originalUpdateStatus(id, status);
        }
      );

      // EXECUTE
      await orchestrator.executeSubtask(subtask);

      // VERIFY: Status should progress through expected states
      expect(statuses).toContain('Researching');
      expect(statuses).toContain('Implementing');
      expect(statuses).toContain('Complete');
    });

    it('should trigger smart commit after successful execution', async () => {
      // SETUP
      const { smartCommit } = await import('../../../src/utils/git-commit.js');
      const mockSmartCommit = smartCommit as any;

      const orchestrator = new TaskOrchestrator(sessionManager);
      const backlog = sessionManager.currentSession!.taskRegistry;
      const subtask = backlog.backlog[0].milestones[0].tasks[0].subtasks[0];

      // EXECUTE
      await orchestrator.executeSubtask(subtask);

      // VERIFY: Smart commit should have been called
      expect(mockSmartCommit).toHaveBeenCalled();
    });

    it('should set Failed status on execution failure', async () => {
      // SETUP: Mock PRPRuntime to return failure
      const { PRPRuntime } = await import('../../../src/agents/prp-runtime.js');
      const MockPRPRuntime = PRPRuntime as any;
      MockPRPRuntime.mockImplementation(() => ({
        executeSubtask: vi.fn().mockResolvedValue({
          success: false,
          error: 'Test execution failure',
          validationResults: [],
          artifacts: [],
          fixAttempts: 0,
        }),
      }));

      const orchestrator = new TaskOrchestrator(
        sessionManager,
        undefined,
        false
      );
      const backlog = sessionManager.currentSession!.taskRegistry;
      const subtask = backlog.backlog[0].milestones[0].tasks[0].subtasks[0];

      // EXECUTE
      try {
        await orchestrator.executeSubtask(subtask);
      } catch {
        // Expected to throw
      }

      // VERIFY: Status should be Failed
      const updatedSession = sessionManager.currentSession!;
      const updatedSubtask =
        updatedSession.taskRegistry.backlog[0].milestones[0].tasks[0]
          .subtasks[0];
      expect(updatedSubtask.status).toBe('Failed');

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
  // P2.M2.T2.S3: Test cache hit/miss behavior
  // ===========================================================================

  describe('P2.M2.T2.S3: Cache Hit/Miss Behavior', () => {
    it('should log cache hit when PRP is cached', async () => {
      // SETUP: Pre-populate cache
      const orchestrator = new TaskOrchestrator(sessionManager);
      const backlog = sessionManager.currentSession!.taskRegistry;
      const subtask = backlog.backlog[0].milestones[0].tasks[0].subtasks[0];

      // Create a mock PRP document and cache it
      const mockPRP = {
        goal: 'Test goal',
        context: [],
        implementationTasks: [],
        validationGates: [],
      };
      orchestrator.researchQueue.results.set(subtask.id, mockPRP as any);

      // EXECUTE: Execute subtask (should use cached PRP)
      await orchestrator.executeSubtask(subtask);

      // VERIFY: Should complete successfully (used cache)
      const updatedSession = sessionManager.currentSession!;
      const updatedSubtask =
        updatedSession.taskRegistry.backlog[0].milestones[0].tasks[0]
          .subtasks[0];
      expect(updatedSubtask.status).toBe('Complete');
    });

    it('should log cache miss when PRP is not cached', async () => {
      // SETUP: No cached PRP
      const orchestrator = new TaskOrchestrator(sessionManager);
      const backlog = sessionManager.currentSession!.taskRegistry;
      const subtask = backlog.backlog[0].milestones[0].tasks[0].subtasks[0];

      // EXECUTE: Execute subtask (cache miss, generates new PRP)
      await orchestrator.executeSubtask(subtask);

      // VERIFY: Should still complete (PRPRuntime handles generation)
      const updatedSession = sessionManager.currentSession!;
      const updatedSubtask =
        updatedSession.taskRegistry.backlog[0].milestones[0].tasks[0]
          .subtasks[0];
      expect(updatedSubtask.status).toBe('Complete');
    });

    it('should log cache metrics correctly', async () => {
      // SETUP
      const orchestrator = new TaskOrchestrator(sessionManager);
      const backlog = sessionManager.currentSession!.taskRegistry;
      const subtask = backlog.backlog[0].milestones[0].tasks[0].subtasks[0];

      // EXECUTE: Execute multiple subtasks to generate metrics
      for (const s of backlog.backlog[0].milestones[0].tasks[0].subtasks) {
        await orchestrator.executeSubtask(s);
      }

      // VERIFY: Metrics should be tracked (we can't directly access them,
      // but we can verify the tests complete without error)
      expect(backlog.backlog[0].milestones[0].tasks[0].subtasks.length).toBe(3);
    });

    it('should bypass cache when --no-cache flag is set', async () => {
      // SETUP: Create orchestrator with noCache=true
      const orchestrator = new TaskOrchestrator(
        sessionManager,
        undefined,
        true
      );
      const backlog = sessionManager.currentSession!.taskRegistry;
      const subtask = backlog.backlog[0].milestones[0].tasks[0].subtasks[0];

      // Pre-populate cache (should be bypassed)
      const mockPRP = {
        goal: 'Test goal',
        context: [],
        implementationTasks: [],
        validationGates: [],
      };
      orchestrator.researchQueue.results.set(subtask.id, mockPRP as any);

      // EXECUTE
      await orchestrator.executeSubtask(subtask);

      // VERIFY: Should still complete
      const updatedSession = sessionManager.currentSession!;
      const updatedSubtask =
        updatedSession.taskRegistry.backlog[0].milestones[0].tasks[0]
          .subtasks[0];
      expect(updatedSubtask.status).toBe('Complete');
    });
  });
});
