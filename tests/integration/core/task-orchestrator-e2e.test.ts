/**
 * End-to-end integration tests for TaskOrchestrator - Complete Workflow Validation
 *
 * @remarks
 * Tests validate complete TaskOrchestrator workflows from backlog initialization
 * to task completion with real filesystem operations. These tests validate the
 * integration of all components working together.
 *
 * Tests cover:
 * - Complete workflow execution (SessionManager → TaskOrchestrator → completion)
 * - tasks.json persistence across execution
 * - Smart commit creation after task completion
 * - Complex hierarchy processing (multiple phases/milestones/tasks/subtasks)
 * - Scope-based execution (milestone, task, phase, all)
 * - setScope() mid-execution queue rebuilding
 * - Invalid scope handling
 * - Graceful shutdown with state preservation
 * - Resume from interrupted session
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 * @see {@link ../../src/core/task-orchestrator.ts | TaskOrchestrator Implementation}
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { SessionManager } from '../../../src/core/session-manager.js';
import { TaskOrchestrator } from '../../../src/core/task-orchestrator.js';
import { PRPGenerator } from '../../../src/agents/prp-generator.js';
import { wireMockPRPGenerator } from '../../helpers/research-seam.js';
import type { Backlog } from '../../../src/core/models.js';
import { mockSimplePRD } from '../../fixtures/simple-prd.js';
import type { Scope } from '../../../src/core/scope-resolver.js';

// =============================================================================
// Test Constants
// =============================================================================

const TEMP_DIR_TEMPLATE = join(tmpdir(), 'orchestrator-e2e-test-XXXXXX');

// Valid minimal context_scope (src/core/models.ts superRefine requires the
// 'CONTRACT DEFINITION:\n' prefix + 4 ordered sections: RESEARCH NOTE, INPUT,
// LOGIC, OUTPUT). Shared across all backlog fixtures below.
const CONTEXT_SCOPE =
  'CONTRACT DEFINITION:\n1. RESEARCH NOTE: none\n2. INPUT: none\n3. LOGIC: none\n4. OUTPUT: none';

// =============================================================================
// Mock Setup
// =============================================================================

// Mock the PRPRuntime class for controlled execution
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
// subject is E2E orchestration, NOT the research path — bypass generate() to avoid
// the `PiHarness not initialized` chain.
vi.mock('../../../src/agents/prp-generator.js', () => ({
  PRPGenerator: vi.fn(),
}));

// =============================================================================
// Fixture Helper Functions
// =============================================================================

function createComplexBacklog(): Backlog {
  return {
    backlog: [
      {
        type: 'Phase',
        id: 'P1',
        title: 'Phase 1',
        status: 'Planned',
        description: 'First phase',
        milestones: [
          {
            type: 'Milestone',
            id: 'P1.M1',
            title: 'Milestone 1',
            status: 'Planned',
            description: 'First milestone',
            tasks: [
              {
                type: 'Task',
                id: 'P1.M1.T1',
                title: 'Task 1',
                status: 'Planned',
                description: 'First task',
                subtasks: [
                  {
                    type: 'Subtask',
                    id: 'P1.M1.T1.S1',
                    title: 'Subtask 1.1.1',
                    status: 'Planned',
                    story_points: 1,
                    dependencies: [],
                    context_scope: CONTEXT_SCOPE,
                  },
                  {
                    type: 'Subtask',
                    id: 'P1.M1.T1.S2',
                    title: 'Subtask 1.1.2',
                    status: 'Planned',
                    story_points: 1,
                    dependencies: [],
                    context_scope: CONTEXT_SCOPE,
                  },
                ],
              },
            ],
          },
          {
            type: 'Milestone',
            id: 'P1.M2',
            title: 'Milestone 2',
            status: 'Planned',
            description: 'Second milestone',
            tasks: [
              {
                type: 'Task',
                id: 'P1.M2.T1',
                title: 'Task 2',
                status: 'Planned',
                description: 'Second task',
                subtasks: [
                  {
                    type: 'Subtask',
                    id: 'P1.M2.T1.S1',
                    title: 'Subtask 1.2.1',
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
      {
        type: 'Phase',
        id: 'P2',
        title: 'Phase 2',
        status: 'Planned',
        description: 'Second phase',
        milestones: [
          {
            type: 'Milestone',
            id: 'P2.M1',
            title: 'Milestone P2.M1',
            status: 'Planned',
            description: 'Milestone in P2',
            tasks: [
              {
                type: 'Task',
                id: 'P2.M1.T1',
                title: 'Task P2.M1.T1',
                status: 'Planned',
                description: 'Task in P2',
                subtasks: [
                  {
                    type: 'Subtask',
                    id: 'P2.M1.T1.S1',
                    title: 'Subtask 2.1.1',
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

function setupTestEnvironment(backlog: Backlog): {
  tempDir: string;
  prdPath: string;
  sessionManager: SessionManager;
  sessionPath: string;
} {
  const tempDir = mkdtempSync(TEMP_DIR_TEMPLATE);
  const planDir = join(tempDir, 'plan');
  const prdPath = join(tempDir, 'PRD.md');

  writeFileSync(prdPath, mockSimplePRD);

  const sessionState = createSessionState(backlog, planDir);
  const sessionPath = sessionState.metadata.path;

  for (const dir of [
    sessionPath,
    join(sessionPath, 'architecture'),
    join(sessionPath, 'prps'),
    join(sessionPath, 'artifacts'),
  ]) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(
    join(sessionPath, 'tasks.json'),
    JSON.stringify({ backlog: backlog.backlog }, null, 2)
  );
  writeFileSync(join(sessionPath, 'prd_snapshot.md'), mockSimplePRD);
  writeFileSync(join(sessionPath, 'delta_from.txt'), '');

  const sessionManager = new SessionManager(prdPath, planDir);

  return { tempDir, prdPath, sessionManager, sessionPath };
}

// =============================================================================
// Test Suites
// =============================================================================

describe('TaskOrchestrator E2E Workflow Tests', () => {
  let tempDir: string;
  let sessionManager: SessionManager;
  let sessionPath: string;

  beforeEach(async () => {
    const backlog = createComplexBacklog();
    const env = setupTestEnvironment(backlog);
    tempDir = env.tempDir;
    sessionManager = env.sessionManager;
    sessionPath = env.sessionPath;

    await sessionManager.loadSession(sessionPath).catch(err => {
      // Log the error for debugging
      console.error('Session load failed in beforeEach:', err);
      // Re-throw to fail the test
      throw err;
    });

    // Wire the research seam: ResearchQueue caches `new PRPGenerator(...)` in its
    // ctor, so the mock impl must be set before each test constructs the orchestrator.
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
  // P2.M2.T3.S1: Test complete workflow execution
  // ===========================================================================

  describe('P2.M2.T3.S1: Complete Workflow Execution', () => {
    it('should process all items to completion', async () => {
      // SETUP
      const orchestrator = new TaskOrchestrator(sessionManager);
      const processedIds: string[] = [];

      // EXECUTE: Process all items
      let hasMore = true;
      while (hasMore) {
        hasMore = await orchestrator.processNextItem();
        if (orchestrator.currentItemId) {
          processedIds.push(orchestrator.currentItemId);
        }
      }

      // VERIFY: All subtasks should be processed
      expect(processedIds.length).toBeGreaterThan(0);

      // All items should be Complete
      const currentSession = sessionManager.currentSession!;
      const backlog = currentSession.taskRegistry;

      for (const phase of backlog.backlog) {
        for (const milestone of phase.milestones) {
          for (const task of milestone.tasks) {
            for (const subtask of task.subtasks) {
              expect(subtask.status).toBe('Complete');
            }
          }
        }
      }
    });

    it('should persist status changes to tasks.json', async () => {
      // SETUP
      const orchestrator = new TaskOrchestrator(sessionManager);

      // EXECUTE: Process all items
      let hasMore = true;
      while (hasMore) {
        hasMore = await orchestrator.processNextItem();
      }

      // Flush updates to disk
      await sessionManager.flushUpdates();

      // VERIFY: Read tasks.json from disk and verify statuses
      const tasksJsonPath = join(sessionPath, 'tasks.json');
      const tasksJsonContent = readFileSync(tasksJsonPath, 'utf-8');
      const tasksJson = JSON.parse(tasksJsonContent);

      for (const phase of tasksJson.backlog) {
        for (const milestone of phase.milestones) {
          for (const task of milestone.tasks) {
            for (const subtask of task.subtasks) {
              expect(subtask.status).toBe('Complete');
            }
          }
        }
      }
    });

    it('should create smart commits after successful execution', async () => {
      // SETUP
      const { smartCommit } = await import('../../../src/utils/git-commit.js');
      const mockSmartCommit = smartCommit as any;

      const orchestrator = new TaskOrchestrator(sessionManager);

      // EXECUTE: Process all items
      let hasMore = true;
      while (hasMore) {
        hasMore = await orchestrator.processNextItem();
      }

      // VERIFY: Smart commit should have been called for each subtask
      expect(mockSmartCommit).toHaveBeenCalled();
    });

    it('should handle complex hierarchy correctly', async () => {
      // SETUP: Use the complex backlog with multiple phases, milestones, tasks
      const orchestrator = new TaskOrchestrator(sessionManager);

      // EXECUTE: Process all items
      const processedIds: string[] = [];
      let hasMore = true;
      while (hasMore) {
        hasMore = await orchestrator.processNextItem();
        if (orchestrator.currentItemId) {
          processedIds.push(orchestrator.currentItemId);
        }
      }

      // VERIFY: All 4 subtasks should be processed
      expect(processedIds.length).toBe(4);

      // Verify hierarchy is intact
      const backlog = sessionManager.currentSession!.taskRegistry;
      expect(backlog.backlog.length).toBe(2); // 2 phases
      expect(backlog.backlog[0].milestones.length).toBe(2); // P1 has 2 milestones
      expect(backlog.backlog[1].milestones.length).toBe(1); // P2 has 1 milestone
    });
  });

  // ===========================================================================
  // P2.M2.T3.S2: Test scope-based execution
  // ===========================================================================

  describe('P2.M2.T3.S2: Scope-based Execution', () => {
    it('should execute only items within milestone scope', async () => {
      // SETUP: Create orchestrator with milestone scope
      const scope: Scope = { type: 'milestone', id: 'P1.M1' };
      const orchestrator = new TaskOrchestrator(sessionManager, scope);

      // EXECUTE: Process all scoped items
      const processedIds: string[] = [];
      let hasMore = true;
      while (hasMore) {
        hasMore = await orchestrator.processNextItem();
        if (orchestrator.currentItemId) {
          processedIds.push(orchestrator.currentItemId);
        }
      }

      // VERIFY: Only P1.M1 subtasks should be processed. The scoped execution
      // queue includes the ancestor containers (milestone + task) plus their 2
      // leaf subtasks: P1.M1, P1.M1.T1, P1.M1.T1.S1, P1.M1.T1.S2 = 4 items.
      expect(processedIds.length).toBe(4);
      expect(processedIds.every(id => id.startsWith('P1.M1'))).toBe(true);
    });

    it('should execute only items within task scope', async () => {
      // SETUP: Create new session for clean state
      const backlog = createComplexBacklog();
      const env = setupTestEnvironment(backlog);
      const newSessionManager = env.sessionManager;
      await newSessionManager.loadSession(env.sessionPath);

      const scope: Scope = { type: 'task', id: 'P1.M1.T1' };
      const orchestrator = new TaskOrchestrator(newSessionManager, scope);

      // EXECUTE
      const processedIds: string[] = [];
      let hasMore = true;
      while (hasMore) {
        hasMore = await orchestrator.processNextItem();
        if (orchestrator.currentItemId) {
          processedIds.push(orchestrator.currentItemId);
        }
      }

      // VERIFY: Only P1.M1.T1 subtasks should be processed. The scoped execution
      // queue includes the task container plus its 2 leaf subtasks:
      // P1.M1.T1, P1.M1.T1.S1, P1.M1.T1.S2 = 3 items.
      expect(processedIds.length).toBe(3); // P1.M1.T1 + its 2 subtasks

      // Cleanup
      if (existsSync(env.tempDir)) {
        rmSync(env.tempDir, { recursive: true, force: true });
      }
    });

    it('should rebuild queue when setScope is called mid-execution', async () => {
      // SETUP: Start with P1.M1 scope
      let scope: Scope = { type: 'milestone', id: 'P1.M1' };
      const orchestrator = new TaskOrchestrator(sessionManager, scope);

      // EXECUTE: Process one item
      await orchestrator.processNextItem();

      // Change scope to P1.M2
      scope = { type: 'milestone', id: 'P1.M2' };
      await orchestrator.setScope(scope);

      const newQueue = orchestrator.executionQueue;

      // VERIFY: Queue should only contain P1.M2 items
      expect(newQueue.every(item => item.id.startsWith('P1.M2'))).toBe(true);
    });

    it('should return empty queue for invalid scope', async () => {
      // SETUP: Create orchestrator with non-existent scope
      const scope: Scope = { type: 'milestone', id: 'P999.M999' };
      const orchestrator = new TaskOrchestrator(sessionManager, scope);

      // VERIFY: Queue should be empty
      expect(orchestrator.executionQueue.length).toBe(0);
    });
  });

  // ===========================================================================
  // P2.M2.T3.S3: Test graceful shutdown handling
  // ===========================================================================

  describe('P2.M2.T3.S3: Graceful Shutdown Handling', () => {
    it('should preserve state on shutdown', async () => {
      // SETUP
      const orchestrator = new TaskOrchestrator(sessionManager);

      // EXECUTE: Process one item
      await orchestrator.processNextItem();

      // Simulate shutdown by flushing updates
      await sessionManager.flushUpdates();

      // VERIFY: State should be persisted
      const tasksJsonPath = join(sessionPath, 'tasks.json');
      const tasksJsonContent = readFileSync(tasksJsonPath, 'utf-8');
      const tasksJson = JSON.parse(tasksJsonContent);

      // At least one item should have been processed
      const hasCompleteStatus = tasksJson.backlog.some((phase: any) =>
        phase.milestones.some((milestone: any) =>
          milestone.tasks.some((task: any) =>
            task.subtasks.some((subtask: any) => subtask.status === 'Complete')
          )
        )
      );
      expect(hasCompleteStatus).toBe(true);
    });

    it('should resume from interrupted session', async () => {
      // SETUP: Create new session and process partially
      const backlog = createComplexBacklog();
      const env = setupTestEnvironment(backlog);
      const newSessionManager = env.sessionManager;
      await newSessionManager.loadSession(env.sessionPath);

      const orchestrator = new TaskOrchestrator(newSessionManager);

      // Process one item
      await orchestrator.processNextItem();
      await newSessionManager.flushUpdates();

      // EXECUTE: Create new orchestrator from same session (simulating resume)
      const resumedOrchestrator = new TaskOrchestrator(newSessionManager);

      // Continue processing
      let hasMore = true;
      while (hasMore) {
        hasMore = await resumedOrchestrator.processNextItem();
      }

      // VERIFY: All items should be Complete
      const finalSession = newSessionManager.currentSession!;
      for (const phase of finalSession.taskRegistry.backlog) {
        for (const milestone of phase.milestones) {
          for (const task of milestone.tasks) {
            for (const subtask of task.subtasks) {
              expect(subtask.status).toBe('Complete');
            }
          }
        }
      }

      // Cleanup
      if (existsSync(env.tempDir)) {
        rmSync(env.tempDir, { recursive: true, force: true });
      }
    });

    it('should preserve currentItemId across shutdown', async () => {
      // SETUP
      const orchestrator = new TaskOrchestrator(sessionManager);

      // EXECUTE: Process one item
      await orchestrator.processNextItem();
      const itemId = orchestrator.currentItemId;

      // VERIFY: currentItemId should be set
      expect(itemId).not.toBeNull();

      // Create new orchestrator (simulating resume after shutdown)
      const resumedOrchestrator = new TaskOrchestrator(sessionManager);

      // CurrentItemId should be reset on new orchestrator
      expect(resumedOrchestrator.currentItemId).toBeNull();
    });

    it('should handle multiple shutdown/resume cycles', async () => {
      // SETUP: Create new session
      const backlog = createComplexBacklog();
      const env = setupTestEnvironment(backlog);
      const newSessionManager = env.sessionManager;
      await newSessionManager.loadSession(env.sessionPath);

      // EXECUTE: Multiple cycles of process and "shutdown"
      for (let cycle = 0; cycle < 3; cycle++) {
        const orchestrator = new TaskOrchestrator(newSessionManager);

        // Process one item per cycle
        const hasMore = await orchestrator.processNextItem();
        await newSessionManager.flushUpdates();

        if (!hasMore) {
          break; // Queue exhausted
        }
      }

      // VERIFY: State should be consistent
      const finalSession = newSessionManager.currentSession!;
      const completeCount = finalSession.taskRegistry.backlog.reduce(
        (count, phase) =>
          count +
          phase.milestones.reduce(
            (mCount, milestone) =>
              mCount +
              milestone.tasks.reduce(
                (tCount, task) =>
                  tCount +
                  task.subtasks.filter(s => s.status === 'Complete').length,
                0
              ),
            0
          ),
        0
      );

      expect(completeCount).toBeGreaterThan(0);

      // Cleanup
      if (existsSync(env.tempDir)) {
        rmSync(env.tempDir, { recursive: true, force: true });
      }
    });
  });
});
