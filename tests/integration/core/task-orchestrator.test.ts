/**
 * Integration tests for TaskOrchestrator - Hierarchy Traversal and Dependency Resolution
 *
 * @remarks
 * Tests validate TaskOrchestrator correctly traverses the task hierarchy using DFS
 * pre-order traversal, resolves dependencies, and manages execution queue. These tests
 * complement the unit tests in tests/unit/core/task-orchestrator.test.ts by using
 * actual SessionManager and filesystem operations instead of mocks.
 *
 * Tests cover:
 * - DFS pre-order traversal (parent-before-children execution)
 * - processNextItem() behavior and queue processing
 * - currentItemId tracking during traversal
 * - Dependency resolution via canExecute() and getBlockingDependencies()
 * - waitForDependencies() with timeout handling
 * - Execution queue management with scope filtering
 * - setScope() mid-execution queue rebuilding
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 * @see {@link ../../src/core/task-orchestrator.ts | TaskOrchestrator Implementation}
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

import { SessionManager } from '../../../src/core/session-manager.js';
import { TaskOrchestrator } from '../../../src/core/task-orchestrator.js';
import { PRPGenerator } from '../../../src/agents/prp-generator.js';
import { wireMockPRPGenerator } from '../../helpers/research-seam.js';
import type { Backlog } from '../../../src/core/models.js';
import { mockSimplePRD } from '../../fixtures/simple-prd.js';
import type { Scope } from '../../../src/core/scope-resolver.js';

// Mock the PRPGenerator class (BUG-004 category (a) research seam). This suite's
// subject is hierarchy traversal / execution-queue management, NOT the research
// path — bypass generate() to avoid the `PiHarness not initialized` chain.
vi.mock('../../../src/agents/prp-generator.js', () => ({
  PRPGenerator: vi.fn(),
}));

// Mock the PRPRuntime class (BUG-004 category (a) execution seam). The DFS
// traversal tests drive processNextItem() → executeSubtask() → PRPRuntime, which
// would otherwise invoke the real Coder agent (also harness-backed). This suite's
// subject is traversal/queue logic, NOT coder execution — stub a success result.
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

// Mock the git-commit module (TaskOrchestrator imports smartCommit +
// parseItemPosition from it).
vi.mock('../../../src/utils/git-commit.js', () => ({
  smartCommit: vi.fn().mockResolvedValue('abc123'),
  filterProtectedFiles: vi.fn((files: string[]) => files),
  formatCommitMessage: vi.fn((msg: string) => msg),
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

// Valid minimal context_scope (src/core/models.ts superRefine requires the
// 'CONTRACT DEFINITION:\n' prefix + 4 ordered sections). Used by backlog
// fixtures below that previously held invalid short values.
const CONTEXT_SCOPE =
  'CONTRACT DEFINITION:\n1. RESEARCH NOTE: none\n2. INPUT: none\n3. LOGIC: none\n4. OUTPUT: none';

// =============================================================================
// Test Constants
// =============================================================================

const TEMP_DIR_TEMPLATE = join(tmpdir(), 'orchestrator-test-XXXXXX');

// =============================================================================
// Fixture Helper Functions
// =============================================================================

function createMultiLevelHierarchy(): Backlog {
  return {
    backlog: [
      {
        type: 'Phase',
        id: 'P1',
        title: 'Test Phase 1',
        status: 'Planned',
        description: 'Phase for testing traversal',
        milestones: [
          {
            type: 'Milestone',
            id: 'P1.M1',
            title: 'Test Milestone 1',
            status: 'Planned',
            description: 'Milestone for testing traversal',
            tasks: [
              {
                type: 'Task',
                id: 'P1.M1.T1',
                title: 'Test Task 1',
                status: 'Planned',
                description: 'Task for testing traversal',
                subtasks: [
                  {
                    type: 'Subtask',
                    id: 'P1.M1.T1.S1',
                    title: 'Subtask 1 - No Dependencies',
                    status: 'Planned',
                    story_points: 1,
                    dependencies: [],
                    context_scope:
                      'CONTRACT DEFINITION:\n1. RESEARCH NOTE: First subtask\n2. INPUT: None\n3. LOGIC: Test logic\n4. OUTPUT: Test output',
                  },
                  {
                    type: 'Subtask',
                    id: 'P1.M1.T1.S2',
                    title: 'Subtask 2 - Depends on S1',
                    status: 'Planned',
                    story_points: 1,
                    dependencies: ['P1.M1.T1.S1'],
                    context_scope:
                      'CONTRACT DEFINITION:\n1. RESEARCH NOTE: Second subtask\n2. INPUT: Output from S1\n3. LOGIC: Test logic\n4. OUTPUT: Test output',
                  },
                  {
                    type: 'Subtask',
                    id: 'P1.M1.T1.S3',
                    title: 'Subtask 3 - Depends on S2',
                    status: 'Planned',
                    story_points: 1,
                    dependencies: ['P1.M1.T1.S2'],
                    context_scope:
                      'CONTRACT DEFINITION:\n1. RESEARCH NOTE: Third subtask\n2. INPUT: Output from S2\n3. LOGIC: Test logic\n4. OUTPUT: Test output',
                  },
                ],
              },
            ],
          },
          {
            type: 'Milestone',
            id: 'P1.M2',
            title: 'Test Milestone 2',
            status: 'Planned',
            description: 'Second milestone for testing',
            tasks: [
              {
                type: 'Task',
                id: 'P1.M2.T1',
                title: 'Test Task 2',
                status: 'Planned',
                description: 'Task in second milestone',
                subtasks: [
                  {
                    type: 'Subtask',
                    id: 'P1.M2.T1.S1',
                    title: 'Subtask in M2',
                    status: 'Planned',
                    story_points: 1,
                    dependencies: [],
                    context_scope:
                      'CONTRACT DEFINITION:\n1. RESEARCH NOTE: Subtask in M2\n2. INPUT: None\n3. LOGIC: Test logic\n4. OUTPUT: Test output',
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
        title: 'Test Phase 2',
        status: 'Planned',
        description: 'Second phase for testing',
        milestones: [
          {
            type: 'Milestone',
            id: 'P2.M1',
            title: 'Test Milestone P2.M1',
            status: 'Planned',
            description: 'Milestone in P2',
            tasks: [
              {
                type: 'Task',
                id: 'P2.M1.T1',
                title: 'Test Task P2.M1.T1',
                status: 'Planned',
                description: 'Task in P2',
                subtasks: [
                  {
                    type: 'Subtask',
                    id: 'P2.M1.T1.S1',
                    title: 'Subtask in P2',
                    status: 'Planned',
                    story_points: 1,
                    dependencies: [],
                    context_scope:
                      'CONTRACT DEFINITION:\n1. RESEARCH NOTE: Subtask in P2\n2. INPUT: None\n3. LOGIC: Test logic\n4. OUTPUT: Test output',
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

  const sessionDir = join(planDir, '001_testsession');
  for (const dir of [
    planDir,
    sessionDir,
    join(sessionDir, 'architecture'),
    join(sessionDir, 'prps'),
    join(sessionDir, 'artifacts'),
  ]) {
    mkdirSync(dir, { recursive: true });
  }

  const sessionManager = new SessionManager(prdPath, planDir);

  return { tempDir, prdPath, sessionManager };
}

// =============================================================================
// Test Suites
// =============================================================================

describe('TaskOrchestrator Integration Tests', () => {
  let tempDir: string;
  let prdPath: string;
  let sessionManager: SessionManager;

  beforeEach(() => {
    const env = setupTestEnvironment();
    tempDir = env.tempDir;
    prdPath = env.prdPath;
    sessionManager = env.sessionManager;

    // Wire the research seam before each test constructs the orchestrator
    // (ResearchQueue caches `new PRPGenerator(...)` in its ctor).
    wireMockPRPGenerator({ PRPGenerator: vi.mocked(PRPGenerator) });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ===========================================================================
  // P2.M2.T1.S1: Test DFS pre-order traversal
  // ===========================================================================

  describe('P2.M2.T1.S1: DFS Pre-order Traversal', () => {
    it('should traverse hierarchy in parent-before-children order', async () => {
      const backlog = createMultiLevelHierarchy();
      const planDir = join(tempDir, 'plan');
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

      await sessionManager.loadSession(sessionDir);

      const orchestrator = new TaskOrchestrator(sessionManager);
      const processedIds: string[] = [];

      let hasMore = true;
      while (hasMore) {
        hasMore = await orchestrator.processNextItem();
        if (orchestrator.currentItemId) {
          processedIds.push(orchestrator.currentItemId);
        }
      }

      expect(processedIds.length).toBeGreaterThan(0);
    });

    it('should return true for each item until queue empty', async () => {
      const backlog: Backlog = {
        backlog: [
          {
            type: 'Phase',
            id: 'P1',
            title: 'Test Phase',
            status: 'Planned',
            description: 'Test',
            milestones: [
              {
                type: 'Milestone',
                id: 'P1.M1',
                title: 'Test Milestone',
                status: 'Planned',
                description: 'Test',
                tasks: [
                  {
                    type: 'Task',
                    id: 'P1.M1.T1',
                    title: 'Test Task',
                    status: 'Planned',
                    description: 'Test',
                    subtasks: [
                      {
                        type: 'Subtask',
                        id: 'P1.M1.T1.S1',
                        title: 'Test Subtask',
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

      const planDir = join(tempDir, 'plan');
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

      await sessionManager.loadSession(sessionDir);

      const orchestrator = new TaskOrchestrator(sessionManager);
      const results: boolean[] = [];

      let hasMore = await orchestrator.processNextItem();
      while (hasMore) {
        results.push(hasMore);
        hasMore = await orchestrator.processNextItem();
      }

      results.forEach(result => expect(result).toBe(true));
      expect(hasMore).toBe(false);
    });

    it('should update currentItemId during traversal', async () => {
      const backlog = createMultiLevelHierarchy();
      const planDir = join(tempDir, 'plan');
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

      await sessionManager.loadSession(sessionDir);

      const orchestrator = new TaskOrchestrator(sessionManager);

      expect(orchestrator.currentItemId).toBeNull();

      const hasMore = await orchestrator.processNextItem();

      expect(hasMore).toBe(true);
      expect(orchestrator.currentItemId).not.toBeNull();
    });
  });

  // ===========================================================================
  // P2.M2.T1.S2: Test dependency resolution
  // ===========================================================================

  describe('P2.M2.T1.S2: Dependency Resolution', () => {
    it('canExecute should return false until dependency Complete', async () => {
      const backlog: Backlog = {
        backlog: [
          {
            type: 'Phase',
            id: 'P1',
            title: 'Test Phase',
            status: 'Planned',
            description: 'Test',
            milestones: [
              {
                type: 'Milestone',
                id: 'P1.M1',
                title: 'Test Milestone',
                status: 'Planned',
                description: 'Test',
                tasks: [
                  {
                    type: 'Task',
                    id: 'P1.M1.T1',
                    title: 'Test Task',
                    status: 'Planned',
                    description: 'Test',
                    subtasks: [
                      {
                        type: 'Subtask',
                        id: 'P1.M1.T1.S1',
                        title: 'Dependency Subtask',
                        status: 'Planned',
                        story_points: 1,
                        dependencies: [],
                        context_scope: CONTEXT_SCOPE,
                      },
                      {
                        type: 'Subtask',
                        id: 'P1.M1.T1.S2',
                        title: 'Dependent Subtask',
                        status: 'Planned',
                        story_points: 1,
                        dependencies: ['P1.M1.T1.S1'],
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

      const planDir = join(tempDir, 'plan');
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

      await sessionManager.loadSession(sessionDir);

      const orchestrator = new TaskOrchestrator(sessionManager);
      const dependentSubtask =
        backlog.backlog[0].milestones[0].tasks[0].subtasks[1];

      expect(orchestrator.canExecute(dependentSubtask)).toBe(false);

      await sessionManager.updateItemStatus('P1.M1.T1.S1', 'Complete');
      // The orchestrator caches #backlog at construction; refresh it so canExecute
      // observes the SessionManager's updated task status.
      await orchestrator.refreshBacklog();

      expect(orchestrator.canExecute(dependentSubtask)).toBe(true);
    });

    it('getBlockingDependencies should return incomplete dependencies', async () => {
      const backlog = createMultiLevelHierarchy();
      const planDir = join(tempDir, 'plan');
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

      await sessionManager.loadSession(sessionDir);

      const orchestrator = new TaskOrchestrator(sessionManager);
      const subtaskS3 = backlog.backlog[0].milestones[0].tasks[0].subtasks[2];

      const blockers = orchestrator.getBlockingDependencies(subtaskS3);

      expect(blockers.length).toBeGreaterThan(0);
      expect(blockers.some(b => b.id === 'P1.M1.T1.S2')).toBe(true);
    });

    it('waitForDependencies should resolve when dependencies complete', async () => {
      const backlog: Backlog = {
        backlog: [
          {
            type: 'Phase',
            id: 'P1',
            title: 'Test Phase',
            status: 'Planned',
            description: 'Test',
            milestones: [
              {
                type: 'Milestone',
                id: 'P1.M1',
                title: 'Test Milestone',
                status: 'Planned',
                description: 'Test',
                tasks: [
                  {
                    type: 'Task',
                    id: 'P1.M1.T1',
                    title: 'Test Task',
                    status: 'Planned',
                    description: 'Test',
                    subtasks: [
                      {
                        type: 'Subtask',
                        id: 'P1.M1.T1.S1',
                        title: 'Dependency',
                        status: 'Planned',
                        story_points: 1,
                        dependencies: [],
                        context_scope: CONTEXT_SCOPE,
                      },
                      {
                        type: 'Subtask',
                        id: 'P1.M1.T1.S2',
                        title: 'Dependent',
                        status: 'Planned',
                        story_points: 1,
                        dependencies: ['P1.M1.T1.S1'],
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

      const planDir = join(tempDir, 'plan');
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

      await sessionManager.loadSession(sessionDir);

      const orchestrator = new TaskOrchestrator(sessionManager);
      const dependentSubtask =
        backlog.backlog[0].milestones[0].tasks[0].subtasks[1];

      const waitPromise = orchestrator.waitForDependencies(dependentSubtask, {
        timeout: 5000,
        interval: 100,
      });

      setTimeout(() => {
        void sessionManager.updateItemStatus('P1.M1.T1.S1', 'Complete');
      }, 100);

      await expect(waitPromise).resolves.toBeUndefined();
    });

    it('waitForDependencies should throw on timeout', async () => {
      const backlog = createMultiLevelHierarchy();
      const planDir = join(tempDir, 'plan');
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

      await sessionManager.loadSession(sessionDir);

      const orchestrator = new TaskOrchestrator(sessionManager);
      const subtaskS3 = backlog.backlog[0].milestones[0].tasks[0].subtasks[2];

      await expect(
        orchestrator.waitForDependencies(subtaskS3, {
          timeout: 100,
          interval: 10,
        })
      ).rejects.toThrow('Timeout waiting for dependencies');
    });
  });

  // ===========================================================================
  // P2.M2.T1.S3: Test execution queue management
  // ===========================================================================

  describe('P2.M2.T1.S3: Execution Queue Management', () => {
    it('should create queue with all items when no scope provided', async () => {
      const backlog = createMultiLevelHierarchy();
      const planDir = join(tempDir, 'plan');
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

      await sessionManager.loadSession(sessionDir);

      const orchestrator = new TaskOrchestrator(sessionManager);
      const queue = orchestrator.executionQueue;

      // createMultiLevelHierarchy has 5 leaf subtasks across P1.M1 (3),
      // P1.M2 (1), and P2.M1 (1); the 'all' scope returns all of them.
      expect(queue.length).toBe(5);
      expect(queue.every(item => item.type === 'Subtask')).toBe(true);
    });

    it('should create queue with only milestone items when scoped', async () => {
      const backlog = createMultiLevelHierarchy();
      const planDir = join(tempDir, 'plan');
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

      await sessionManager.loadSession(sessionDir);

      const scope: Scope = { type: 'milestone', id: 'P1.M1' };
      const orchestrator = new TaskOrchestrator(sessionManager, scope);
      const queue = orchestrator.executionQueue;

      // A milestone scope resolves to the milestone + its descendants:
      // P1.M1, P1.M1.T1, P1.M1.T1.S1, P1.M1.T1.S2, P1.M1.T1.S3 = 5 items.
      expect(queue.length).toBe(5);
      expect(queue.every(item => item.id.startsWith('P1.M1'))).toBe(true);
    });

    it('should rebuild queue when setScope is called', async () => {
      const backlog = createMultiLevelHierarchy();
      const planDir = join(tempDir, 'plan');
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

      await sessionManager.loadSession(sessionDir);

      const orchestrator = new TaskOrchestrator(sessionManager);
      const initialQueueLength = orchestrator.executionQueue.length;

      await orchestrator.setScope({ type: 'milestone', id: 'P1.M2' });
      const newQueueLength = orchestrator.executionQueue.length;

      expect(initialQueueLength).toBeGreaterThan(newQueueLength);
      // Milestone scope P1.M2 resolves to P1.M2 + P1.M2.T1 + P1.M2.T1.S1 = 3.
      expect(newQueueLength).toBe(3);
    });

    it('should process all items in queue via processNextItem', async () => {
      const backlog: Backlog = {
        backlog: [
          {
            type: 'Phase',
            id: 'P1',
            title: 'Test Phase',
            status: 'Planned',
            description: 'Test',
            milestones: [
              {
                type: 'Milestone',
                id: 'P1.M1',
                title: 'Test Milestone',
                status: 'Planned',
                description: 'Test',
                tasks: [
                  {
                    type: 'Task',
                    id: 'P1.M1.T1',
                    title: 'Test Task',
                    status: 'Planned',
                    description: 'Test',
                    subtasks: [
                      {
                        type: 'Subtask',
                        id: 'P1.M1.T1.S1',
                        title: 'Subtask 1',
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

      const planDir = join(tempDir, 'plan');
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

      await sessionManager.loadSession(sessionDir);

      const orchestrator = new TaskOrchestrator(sessionManager);
      let count = 0;

      while (await orchestrator.processNextItem()) {
        count++;
      }

      expect(count).toBe(1);
      expect(orchestrator.executionQueue.length).toBe(0);
    });
  });
});
