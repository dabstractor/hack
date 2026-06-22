/**
 * Unit tests for ResearchQueue class
 *
 * @remarks
 * Tests validate ResearchQueue class from src/core/research-queue.ts with 100% coverage.
 * Tests follow the Setup/Execute/Verify pattern with comprehensive edge case coverage.
 *
 * Mocks are used for all SessionManager and PRPGenerator operations - no real I/O is performed.
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  ResearchQueue,
  ResearchTimeoutError,
} from '../../../src/core/research-queue.js';
import type { SessionManager } from '../../../src/core/session-manager.js';
import type {
  Backlog,
  PRPDocument,
  Subtask,
} from '../../../src/core/models.js';
import { Status } from '../../../src/core/models.js';
import { RESEARCH_TIMEOUT } from '../../../src/config/constants.js';

// Mock the prp-generator module
vi.mock('../../../src/agents/prp-generator.js', () => ({
  PRPGenerator: vi.fn(),
}));

// Mock node:fs/promises for deletePRP tests (unlink)
vi.mock('node:fs/promises', () => ({
  unlink: vi.fn().mockResolvedValue(undefined),
}));

// Import PRPGenerator after mocking to access the mock
import { PRPGenerator } from '../../../src/agents/prp-generator.js';
import { unlink } from 'node:fs/promises';

// Cast mocked constructor
const MockPRPGenerator = PRPGenerator as any;
const mockUnlink = unlink as ReturnType<typeof vi.fn>;

// Factory functions for test data
const createTestSubtask = (
  id: string,
  title: string,
  status: Status,
  dependencies: string[] = [],
  context_scope: string = 'Test scope'
): Subtask => ({
  id,
  type: 'Subtask',
  title,
  status,
  story_points: 2,
  dependencies,
  context_scope,
});

const createTestPRPDocument = (taskId: string): PRPDocument => ({
  taskId,
  objective: `Test objective for ${taskId}`,
  context: '## Context\n\nTest context content.',
  implementationSteps: [`Step 1 for ${taskId}`, `Step 2 for ${taskId}`],
  validationGates: [
    {
      level: 1,
      description: 'Syntax check',
      command: 'npm run lint',
      manual: false,
    },
    {
      level: 2,
      description: 'Unit tests',
      command: 'npm test',
      manual: false,
    },
    {
      level: 3,
      description: 'Integration tests',
      command: 'npm run test:integration',
      manual: false,
    },
    {
      level: 4,
      description: 'Manual validation',
      command: null,
      manual: true,
    },
  ],
  successCriteria: [
    { description: `Criterion 1 for ${taskId}`, satisfied: false },
    { description: `Criterion 2 for ${taskId}`, satisfied: false },
  ],
  references: [`src/test-${taskId}.ts`],
});

const createTestBacklog = (phases: any[]): Backlog => ({
  backlog: phases,
});

// Mock SessionManager
const createMockSessionManager = (currentSession: any): SessionManager => {
  const mockManager = {
    currentSession,
  } as unknown as SessionManager;
  return mockManager;
};

// Test constants for ResearchQueue constructor parameters
const DEFAULT_MAX_SIZE = 3;
const DEFAULT_NO_CACHE = false;
const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

describe('ResearchQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mockUnlink to default (resolved) after clearAllMocks
    mockUnlink.mockResolvedValue(undefined);
  });

  describe('constructor', () => {
    it('should store sessionManager as readonly property', () => {
      // SETUP: Create mock session manager with active session
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: createTestBacklog([]),
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      const mockGenerate = vi
        .fn()
        .mockResolvedValue(createTestPRPDocument('P1.M1.T1.S1'));
      MockPRPGenerator.mockImplementation(() => ({
        generate: mockGenerate,
      }));

      // EXECUTE
      const queue = new ResearchQueue(
        mockManager,
        DEFAULT_MAX_SIZE,
        DEFAULT_NO_CACHE,
        DEFAULT_CACHE_TTL_MS
      );

      // VERIFY
      expect(queue.sessionManager).toBe(mockManager);
    });

    it('should set maxSize from constructor parameter', () => {
      // SETUP
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: createTestBacklog([]),
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      const mockGenerate = vi
        .fn()
        .mockResolvedValue(createTestPRPDocument('P1.M1.T1.S1'));
      MockPRPGenerator.mockImplementation(() => ({
        generate: mockGenerate,
      }));

      // EXECUTE
      const queue = new ResearchQueue(
        mockManager,
        5,
        DEFAULT_NO_CACHE,
        DEFAULT_CACHE_TTL_MS
      );

      // VERIFY
      expect(queue.maxSize).toBe(5);
    });

    it('should handle minimum concurrency of 1', () => {
      // SETUP
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: createTestBacklog([]),
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      const mockGenerate = vi
        .fn()
        .mockResolvedValue(createTestPRPDocument('P1.M1.T1.S1'));
      MockPRPGenerator.mockImplementation(() => ({
        generate: mockGenerate,
      }));

      // EXECUTE
      const queue = new ResearchQueue(
        mockManager,
        1,
        DEFAULT_NO_CACHE,
        DEFAULT_CACHE_TTL_MS
      );

      // VERIFY
      expect(queue.maxSize).toBe(1);
    });

    it('should handle maximum concurrency of 10', () => {
      // SETUP
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: createTestBacklog([]),
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      const mockGenerate = vi
        .fn()
        .mockResolvedValue(createTestPRPDocument('P1.M1.T1.S1'));
      MockPRPGenerator.mockImplementation(() => ({
        generate: mockGenerate,
      }));

      // EXECUTE
      const queue = new ResearchQueue(
        mockManager,
        10,
        DEFAULT_NO_CACHE,
        DEFAULT_CACHE_TTL_MS
      );

      // VERIFY
      expect(queue.maxSize).toBe(10);
    });

    it('should use default maxSize of 3 when not specified', () => {
      // SETUP
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: createTestBacklog([]),
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      const mockGenerate = vi
        .fn()
        .mockResolvedValue(createTestPRPDocument('P1.M1.T1.S1'));
      MockPRPGenerator.mockImplementation(() => ({
        generate: mockGenerate,
      }));

      // EXECUTE
      const queue = new ResearchQueue(
        mockManager,
        DEFAULT_MAX_SIZE,
        DEFAULT_NO_CACHE,
        DEFAULT_CACHE_TTL_MS
      );

      // VERIFY
      expect(queue.maxSize).toBe(3);
    });

    it('should create PRPGenerator with sessionManager', () => {
      // SETUP
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: createTestBacklog([]),
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      const mockGenerate = vi
        .fn()
        .mockResolvedValue(createTestPRPDocument('P1.M1.T1.S1'));
      MockPRPGenerator.mockImplementation(() => ({
        generate: mockGenerate,
      }));

      // EXECUTE
      new ResearchQueue(
        mockManager,
        DEFAULT_MAX_SIZE,
        DEFAULT_NO_CACHE,
        DEFAULT_CACHE_TTL_MS
      );

      // VERIFY
      expect(MockPRPGenerator).toHaveBeenCalledWith(
        mockManager,
        DEFAULT_NO_CACHE,
        DEFAULT_CACHE_TTL_MS
      );
    });

    it('should initialize with empty queue, researching, and results', () => {
      // SETUP
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: createTestBacklog([]),
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      const mockGenerate = vi
        .fn()
        .mockResolvedValue(createTestPRPDocument('P1.M1.T1.S1'));
      MockPRPGenerator.mockImplementation(() => ({
        generate: mockGenerate,
      }));

      // EXECUTE
      const queue = new ResearchQueue(
        mockManager,
        DEFAULT_MAX_SIZE,
        DEFAULT_NO_CACHE,
        DEFAULT_CACHE_TTL_MS
      );

      // VERIFY
      expect(queue.queue).toEqual([]);
      expect(queue.researching.size).toBe(0);
      expect(queue.results.size).toBe(0);
    });
  });

  describe('noCache parameter', () => {
    it('should forward noCache=true to PRPGenerator', () => {
      // SETUP
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: createTestBacklog([]),
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      const mockGenerate = vi
        .fn()
        .mockResolvedValue(createTestPRPDocument('P1.M1.T1.S1'));
      MockPRPGenerator.mockImplementation(() => ({
        generate: mockGenerate,
      }));

      // EXECUTE
      new ResearchQueue(
        mockManager,
        DEFAULT_MAX_SIZE,
        true,
        DEFAULT_CACHE_TTL_MS
      );

      // VERIFY
      expect(MockPRPGenerator).toHaveBeenCalledWith(
        mockManager,
        true,
        DEFAULT_CACHE_TTL_MS
      );
    });
  });

  describe('cacheTtlMs parameter', () => {
    it('should forward custom cacheTtlMs to PRPGenerator', () => {
      // SETUP
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: createTestBacklog([]),
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      const mockGenerate = vi
        .fn()
        .mockResolvedValue(createTestPRPDocument('P1.M1.T1.S1'));
      MockPRPGenerator.mockImplementation(() => ({
        generate: mockGenerate,
      }));
      const customTtl = 12 * 60 * 60 * 1000; // 12 hours

      // EXECUTE
      new ResearchQueue(
        mockManager,
        DEFAULT_MAX_SIZE,
        DEFAULT_NO_CACHE,
        customTtl
      );

      // VERIFY
      expect(MockPRPGenerator).toHaveBeenCalledWith(
        mockManager,
        DEFAULT_NO_CACHE,
        customTtl
      );
    });

    it('should use default cacheTtlMs when not specified', () => {
      // SETUP
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: createTestBacklog([]),
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      const mockGenerate = vi
        .fn()
        .mockResolvedValue(createTestPRPDocument('P1.M1.T1.S1'));
      MockPRPGenerator.mockImplementation(() => ({
        generate: mockGenerate,
      }));

      // EXECUTE
      new ResearchQueue(
        mockManager,
        DEFAULT_MAX_SIZE,
        DEFAULT_NO_CACHE,
        DEFAULT_CACHE_TTL_MS
      );

      // VERIFY
      expect(MockPRPGenerator).toHaveBeenCalledWith(
        mockManager,
        DEFAULT_NO_CACHE,
        DEFAULT_CACHE_TTL_MS
      );
    });
  });

  describe('enqueue', () => {
    it('should add task to queue', async () => {
      // SETUP
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: createTestBacklog([]),
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      const mockGenerate = vi
        .fn()
        .mockResolvedValue(createTestPRPDocument('P1.M1.T1.S1'));
      MockPRPGenerator.mockImplementation(() => ({
        generate: mockGenerate,
      }));
      const queue = new ResearchQueue(
        mockManager,
        0,
        DEFAULT_NO_CACHE,
        DEFAULT_CACHE_TTL_MS
      ); // maxSize = 0, no processing
      const task = createTestSubtask('P1.M1.T1.S1', 'Test Subtask', 'Planned');
      const backlog = createTestBacklog([]);

      // EXECUTE
      await queue.enqueue(task, backlog);

      // VERIFY: Task should be in queue (not processed because maxSize=0)
      expect(queue.queue).toContain(task);
    });

    it('should call processNext when enqueuing', async () => {
      // SETUP
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: createTestBacklog([]),
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      const mockGenerate = vi
        .fn()
        .mockResolvedValue(createTestPRPDocument('P1.M1.T1.S1'));
      MockPRPGenerator.mockImplementation(() => ({
        generate: mockGenerate,
      }));
      const queue = new ResearchQueue(
        mockManager,
        DEFAULT_MAX_SIZE,
        DEFAULT_NO_CACHE,
        DEFAULT_CACHE_TTL_MS
      );
      const task = createTestSubtask('P1.M1.T1.S1', 'Test Subtask', 'Planned');
      const backlog = createTestBacklog([]);

      // EXECUTE
      await queue.enqueue(task, backlog);

      // VERIFY: Task should be removed from queue (processNext called)
      expect(queue.queue).not.toContain(task);
      expect(queue.researching.has('P1.M1.T1.S1')).toBe(true);
    });

    it('should skip enqueue if already researching (deduplication)', async () => {
      // SETUP
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: createTestBacklog([]),
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      const mockGenerate = vi
        .fn()
        .mockResolvedValue(createTestPRPDocument('P1.M1.T1.S1'));
      MockPRPGenerator.mockImplementation(() => ({
        generate: mockGenerate,
      }));
      const queue = new ResearchQueue(
        mockManager,
        DEFAULT_MAX_SIZE,
        DEFAULT_NO_CACHE,
        DEFAULT_CACHE_TTL_MS
      );
      const task = createTestSubtask('P1.M1.T1.S1', 'Test Subtask', 'Planned');
      const backlog = createTestBacklog([]);

      // EXECUTE: First enqueue starts research
      await queue.enqueue(task, backlog);
      const initialQueueLength = queue.queue.length;
      const initialResearchingSize = queue.researching.size;

      // Second enqueue should skip (deduplication)
      await queue.enqueue(task, backlog);

      // VERIFY: Queue and researching should not change
      expect(queue.queue.length).toBe(initialQueueLength);
      expect(queue.researching.size).toBe(initialResearchingSize);
    });

    it('should skip enqueue if already cached (deduplication)', async () => {
      // SETUP
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: createTestBacklog([]),
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      const mockGenerate = vi
        .fn()
        .mockResolvedValue(createTestPRPDocument('P1.M1.T1.S1'));
      MockPRPGenerator.mockImplementation(() => ({
        generate: mockGenerate,
      }));
      const queue = new ResearchQueue(
        mockManager,
        DEFAULT_MAX_SIZE,
        DEFAULT_NO_CACHE,
        DEFAULT_CACHE_TTL_MS
      );
      const task = createTestSubtask('P1.M1.T1.S1', 'Test Subtask', 'Planned');
      const backlog = createTestBacklog([]);

      // Pre-populate cache
      queue.results.set('P1.M1.T1.S1', createTestPRPDocument('P1.M1.T1.S1'));

      // EXECUTE
      await queue.enqueue(task, backlog);

      // VERIFY: Task should not be added to queue
      expect(queue.queue).not.toContain(task);
    });
  });

  describe('processNext', () => {
    it('should start PRP generation when under maxSize', async () => {
      // SETUP
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: createTestBacklog([]),
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      const mockGenerate = vi
        .fn()
        .mockResolvedValue(createTestPRPDocument('P1.M1.T1.S1'));
      MockPRPGenerator.mockImplementation(() => ({
        generate: mockGenerate,
      }));
      const queue = new ResearchQueue(
        mockManager,
        DEFAULT_MAX_SIZE,
        DEFAULT_NO_CACHE,
        DEFAULT_CACHE_TTL_MS
      );
      const task = createTestSubtask('P1.M1.T1.S1', 'Test Subtask', 'Planned');
      const backlog = createTestBacklog([]);
      queue.queue.push(task);

      // EXECUTE
      await queue.processNext(backlog);

      // VERIFY
      expect(mockGenerate).toHaveBeenCalledWith(task, backlog);
      expect(queue.researching.has('P1.M1.T1.S1')).toBe(true);
    });

    it('should not start PRP generation when at maxSize limit', async () => {
      // SETUP
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: createTestBacklog([]),
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      const mockGenerate = vi
        .fn()
        .mockResolvedValue(createTestPRPDocument('P1.M1.T1.S1'));
      MockPRPGenerator.mockImplementation(() => ({
        generate: mockGenerate,
      }));
      const queue = new ResearchQueue(
        mockManager,
        2,
        DEFAULT_NO_CACHE,
        DEFAULT_CACHE_TTL_MS
      ); // maxSize = 2
      const task1 = createTestSubtask('P1.M1.T1.S1', 'Task 1', 'Planned');
      const task2 = createTestSubtask('P1.M1.T1.S2', 'Task 2', 'Planned');
      const task3 = createTestSubtask('P1.M1.T1.S3', 'Task 3', 'Planned');
      const backlog = createTestBacklog([]);

      // Start 2 tasks (at maxSize limit)
      const promise1 = Promise.resolve(createTestPRPDocument('P1.M1.T1.S1'));
      const promise2 = Promise.resolve(createTestPRPDocument('P1.M1.T1.S2'));
      queue.researching.set('P1.M1.T1.S1', promise1);
      queue.researching.set('P1.M1.T1.S2', promise2);
      queue.queue.push(task3);

      // EXECUTE
      await queue.processNext(backlog);

      // VERIFY: Task 3 should not be started (still in queue)
      expect(queue.queue).toContain(task3);
      expect(mockGenerate).not.toHaveBeenCalledWith(task3, backlog);
    });

    it('should do nothing if queue is empty', async () => {
      // SETUP
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: createTestBacklog([]),
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      const mockGenerate = vi
        .fn()
        .mockResolvedValue(createTestPRPDocument('P1.M1.T1.S1'));
      MockPRPGenerator.mockImplementation(() => ({
        generate: mockGenerate,
      }));
      const queue = new ResearchQueue(
        mockManager,
        DEFAULT_MAX_SIZE,
        DEFAULT_NO_CACHE,
        DEFAULT_CACHE_TTL_MS
      );
      const backlog = createTestBacklog([]);

      // EXECUTE
      await queue.processNext(backlog);

      // VERIFY: generate should not be called
      expect(mockGenerate).not.toHaveBeenCalled();
    });

    it('should cache result in results Map after completion', async () => {
      // SETUP
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: createTestBacklog([]),
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      const expectedPRP = createTestPRPDocument('P1.M1.T1.S1');
      const mockGenerate = vi.fn().mockResolvedValue(expectedPRP);
      MockPRPGenerator.mockImplementation(() => ({
        generate: mockGenerate,
      }));
      const queue = new ResearchQueue(
        mockManager,
        DEFAULT_MAX_SIZE,
        DEFAULT_NO_CACHE,
        DEFAULT_CACHE_TTL_MS
      );
      const task = createTestSubtask('P1.M1.T1.S1', 'Test Subtask', 'Planned');
      const backlog = createTestBacklog([]);

      // EXECUTE
      await queue.enqueue(task, backlog);
      await queue.waitForPRP('P1.M1.T1.S1'); // Wait for completion

      // VERIFY: Result should be cached
      expect(queue.results.has('P1.M1.T1.S1')).toBe(true);
      expect(queue.results.get('P1.M1.T1.S1')).toEqual(expectedPRP);
    });

    it('should remove from researching Map after completion', async () => {
      // SETUP
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: createTestBacklog([]),
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      const expectedPRP = createTestPRPDocument('P1.M1.T1.S1');
      const mockGenerate = vi.fn().mockResolvedValue(expectedPRP);
      MockPRPGenerator.mockImplementation(() => ({
        generate: mockGenerate,
      }));
      const queue = new ResearchQueue(
        mockManager,
        DEFAULT_MAX_SIZE,
        DEFAULT_NO_CACHE,
        DEFAULT_CACHE_TTL_MS
      );
      const task = createTestSubtask('P1.M1.T1.S1', 'Test Subtask', 'Planned');
      const backlog = createTestBacklog([]);

      // EXECUTE
      await queue.enqueue(task, backlog);
      await queue.waitForPRP('P1.M1.T1.S1'); // Wait for completion

      // VERIFY: Should be removed from researching
      expect(queue.researching.has('P1.M1.T1.S1')).toBe(false);
    });

    it('should chain to next task after completion', async () => {
      // SETUP
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: createTestBacklog([]),
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      const mockGenerate = vi
        .fn()
        .mockResolvedValueOnce(createTestPRPDocument('P1.M1.T1.S1'))
        .mockResolvedValueOnce(createTestPRPDocument('P1.M1.T1.S2'));
      MockPRPGenerator.mockImplementation(() => ({
        generate: mockGenerate,
      }));
      const queue = new ResearchQueue(
        mockManager,
        1,
        DEFAULT_NO_CACHE,
        DEFAULT_CACHE_TTL_MS
      ); // maxSize = 1, serial processing
      const task1 = createTestSubtask('P1.M1.T1.S1', 'Task 1', 'Planned');
      const task2 = createTestSubtask('P1.M1.T1.S2', 'Task 2', 'Planned');
      const backlog = createTestBacklog([]);

      // EXECUTE: Enqueue both tasks
      await queue.enqueue(task1, backlog);
      await queue.enqueue(task2, backlog);

      // Wait for both to complete
      await queue.waitForPRP('P1.M1.T1.S1');
      await queue.waitForPRP('P1.M1.T1.S2');

      // VERIFY: Both tasks should be processed (chaining)
      expect(mockGenerate).toHaveBeenCalledWith(task1, backlog);
      expect(mockGenerate).toHaveBeenCalledWith(task2, backlog);
      expect(queue.results.has('P1.M1.T1.S1')).toBe(true);
      expect(queue.results.has('P1.M1.T1.S2')).toBe(true);
    });
  });

  describe('isResearching', () => {
    it('should return true for in-flight task', async () => {
      // SETUP
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: createTestBacklog([]),
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      const mockGenerate = vi
        .fn()
        .mockImplementation(
          () =>
            new Promise(resolve =>
              setTimeout(
                () => resolve(createTestPRPDocument('P1.M1.T1.S1')),
                100
              )
            )
        );
      MockPRPGenerator.mockImplementation(() => ({
        generate: mockGenerate,
      }));
      const queue = new ResearchQueue(
        mockManager,
        DEFAULT_MAX_SIZE,
        DEFAULT_NO_CACHE,
        DEFAULT_CACHE_TTL_MS
      );
      const task = createTestSubtask('P1.M1.T1.S1', 'Test Subtask', 'Planned');
      const backlog = createTestBacklog([]);

      // EXECUTE: Start research
      await queue.enqueue(task, backlog);

      // VERIFY: Should be researching
      expect(queue.isResearching('P1.M1.T1.S1')).toBe(true);
    });

    it('should return false for queued task', async () => {
      // SETUP
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: createTestBacklog([]),
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      const mockGenerate = vi
        .fn()
        .mockResolvedValue(createTestPRPDocument('P1.M1.T1.S1'));
      MockPRPGenerator.mockImplementation(() => ({
        generate: mockGenerate,
      }));
      const queue = new ResearchQueue(
        mockManager,
        0,
        DEFAULT_NO_CACHE,
        DEFAULT_CACHE_TTL_MS
      ); // maxSize = 0, no processing
      const task = createTestSubtask('P1.M1.T1.S1', 'Test Subtask', 'Planned');
      const backlog = createTestBacklog([]);

      // EXECUTE: Add to queue but don't process
      queue.queue.push(task);

      // VERIFY: Should NOT be researching (just queued)
      expect(queue.isResearching('P1.M1.T1.S1')).toBe(false);
    });

    it('should return false for completed task', async () => {
      // SETUP
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: createTestBacklog([]),
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      const mockGenerate = vi
        .fn()
        .mockResolvedValue(createTestPRPDocument('P1.M1.T1.S1'));
      MockPRPGenerator.mockImplementation(() => ({
        generate: mockGenerate,
      }));
      const queue = new ResearchQueue(
        mockManager,
        DEFAULT_MAX_SIZE,
        DEFAULT_NO_CACHE,
        DEFAULT_CACHE_TTL_MS
      );
      const task = createTestSubtask('P1.M1.T1.S1', 'Test Subtask', 'Planned');
      const backlog = createTestBacklog([]);

      // EXECUTE: Complete research
      await queue.enqueue(task, backlog);
      await queue.waitForPRP('P1.M1.T1.S1');

      // VERIFY: Should NOT be researching (completed)
      expect(queue.isResearching('P1.M1.T1.S1')).toBe(false);
    });

    it('should return false for unknown task', async () => {
      // SETUP
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: createTestBacklog([]),
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      const mockGenerate = vi
        .fn()
        .mockResolvedValue(createTestPRPDocument('P1.M1.T1.S1'));
      MockPRPGenerator.mockImplementation(() => ({
        generate: mockGenerate,
      }));
      const queue = new ResearchQueue(
        mockManager,
        DEFAULT_MAX_SIZE,
        DEFAULT_NO_CACHE,
        DEFAULT_CACHE_TTL_MS
      );

      // VERIFY: Unknown task should return false
      expect(queue.isResearching('P1.M1.T1.S999')).toBe(false);
    });
  });

  describe('getPRP', () => {
    it('should return cached result for completed task', async () => {
      // SETUP
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: createTestBacklog([]),
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      const expectedPRP = createTestPRPDocument('P1.M1.T1.S1');
      const mockGenerate = vi.fn().mockResolvedValue(expectedPRP);
      MockPRPGenerator.mockImplementation(() => ({
        generate: mockGenerate,
      }));
      const queue = new ResearchQueue(
        mockManager,
        DEFAULT_MAX_SIZE,
        DEFAULT_NO_CACHE,
        DEFAULT_CACHE_TTL_MS
      );
      const task = createTestSubtask('P1.M1.T1.S1', 'Test Subtask', 'Planned');
      const backlog = createTestBacklog([]);

      // EXECUTE: Complete research
      await queue.enqueue(task, backlog);
      await queue.waitForPRP('P1.M1.T1.S1');

      // VERIFY: getPRP should return cached result
      const result = queue.getPRP('P1.M1.T1.S1');
      expect(result).toEqual(expectedPRP);
    });

    it('should return null for queued task', async () => {
      // SETUP
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: createTestBacklog([]),
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      const mockGenerate = vi
        .fn()
        .mockResolvedValue(createTestPRPDocument('P1.M1.T1.S1'));
      MockPRPGenerator.mockImplementation(() => ({
        generate: mockGenerate,
      }));
      const queue = new ResearchQueue(
        mockManager,
        0,
        DEFAULT_NO_CACHE,
        DEFAULT_CACHE_TTL_MS
      ); // maxSize = 0, no processing
      const task = createTestSubtask('P1.M1.T1.S1', 'Test Subtask', 'Planned');
      const backlog = createTestBacklog([]);

      // EXECUTE: Add to queue but don't process
      queue.queue.push(task);

      // VERIFY: getPRP should return null (not cached yet)
      const result = queue.getPRP('P1.M1.T1.S1');
      expect(result).toBeNull();
    });

    it('should return null for in-flight task', async () => {
      // SETUP
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: createTestBacklog([]),
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      const mockGenerate = vi
        .fn()
        .mockImplementation(
          () =>
            new Promise(resolve =>
              setTimeout(
                () => resolve(createTestPRPDocument('P1.M1.T1.S1')),
                100
              )
            )
        );
      MockPRPGenerator.mockImplementation(() => ({
        generate: mockGenerate,
      }));
      const queue = new ResearchQueue(
        mockManager,
        DEFAULT_MAX_SIZE,
        DEFAULT_NO_CACHE,
        DEFAULT_CACHE_TTL_MS
      );
      const task = createTestSubtask('P1.M1.T1.S1', 'Test Subtask', 'Planned');
      const backlog = createTestBacklog([]);

      // EXECUTE: Start research (in progress)
      await queue.enqueue(task, backlog);

      // VERIFY: getPRP should return null (not cached yet)
      const result = queue.getPRP('P1.M1.T1.S1');
      expect(result).toBeNull();
    });

    it('should return null for unknown task', async () => {
      // SETUP
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: createTestBacklog([]),
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      const mockGenerate = vi
        .fn()
        .mockResolvedValue(createTestPRPDocument('P1.M1.T1.S1'));
      MockPRPGenerator.mockImplementation(() => ({
        generate: mockGenerate,
      }));
      const queue = new ResearchQueue(
        mockManager,
        DEFAULT_MAX_SIZE,
        DEFAULT_NO_CACHE,
        DEFAULT_CACHE_TTL_MS
      );

      // VERIFY: Unknown task should return null
      const result = queue.getPRP('P1.M1.T1.S999');
      expect(result).toBeNull();
    });
  });

  describe('waitForPRP', () => {
    it('should return cached result immediately', async () => {
      // SETUP
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: createTestBacklog([]),
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      const expectedPRP = createTestPRPDocument('P1.M1.T1.S1');
      const mockGenerate = vi.fn().mockResolvedValue(expectedPRP);
      MockPRPGenerator.mockImplementation(() => ({
        generate: mockGenerate,
      }));
      const queue = new ResearchQueue(
        mockManager,
        DEFAULT_MAX_SIZE,
        DEFAULT_NO_CACHE,
        DEFAULT_CACHE_TTL_MS
      );
      const task = createTestSubtask('P1.M1.T1.S1', 'Test Subtask', 'Planned');
      const backlog = createTestBacklog([]);

      // EXECUTE: Complete research first
      await queue.enqueue(task, backlog);
      await queue.waitForPRP('P1.M1.T1.S1');

      // Then waitForPRP should return immediately from cache
      const startTime = Date.now();
      const result = await queue.waitForPRP('P1.M1.T1.S1');
      const elapsed = Date.now() - startTime;

      // VERIFY: Should return cached result immediately
      expect(result).toEqual(expectedPRP);
      expect(elapsed).toBeLessThan(10); // Should be nearly instant
    });

    it('should wait for in-flight task', async () => {
      // SETUP
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: createTestBacklog([]),
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      const expectedPRP = createTestPRPDocument('P1.M1.T1.S1');
      const mockGenerate = vi
        .fn()
        .mockImplementation(
          () =>
            new Promise(resolve => setTimeout(() => resolve(expectedPRP), 50))
        );
      MockPRPGenerator.mockImplementation(() => ({
        generate: mockGenerate,
      }));
      const queue = new ResearchQueue(
        mockManager,
        DEFAULT_MAX_SIZE,
        DEFAULT_NO_CACHE,
        DEFAULT_CACHE_TTL_MS
      );
      const task = createTestSubtask('P1.M1.T1.S1', 'Test Subtask', 'Planned');
      const backlog = createTestBacklog([]);

      // EXECUTE: Start research
      await queue.enqueue(task, backlog);

      // waitForPRP should wait for completion
      const result = await queue.waitForPRP('P1.M1.T1.S1');

      // VERIFY: Should return the PRP after waiting
      expect(result).toEqual(expectedPRP);
    });

    it('should resolve after task completes', async () => {
      // SETUP
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: createTestBacklog([]),
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      const expectedPRP = createTestPRPDocument('P1.M1.T1.S1');
      const mockGenerate = vi.fn().mockResolvedValue(expectedPRP);
      MockPRPGenerator.mockImplementation(() => ({
        generate: mockGenerate,
      }));
      const queue = new ResearchQueue(
        mockManager,
        DEFAULT_MAX_SIZE,
        DEFAULT_NO_CACHE,
        DEFAULT_CACHE_TTL_MS
      );
      const task = createTestSubtask('P1.M1.T1.S1', 'Test Subtask', 'Planned');
      const backlog = createTestBacklog([]);

      // EXECUTE: Enqueue and wait for completion
      await queue.enqueue(task, backlog);
      const result = await queue.waitForPRP('P1.M1.T1.S1');

      // VERIFY: Should resolve with the PRP
      expect(result).toEqual(expectedPRP);
      expect(result.objective).toBe('Test objective for P1.M1.T1.S1');
    });

    it('should throw for unknown task', async () => {
      // SETUP
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: createTestBacklog([]),
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      const mockGenerate = vi
        .fn()
        .mockResolvedValue(createTestPRPDocument('P1.M1.T1.S1'));
      MockPRPGenerator.mockImplementation(() => ({
        generate: mockGenerate,
      }));
      const queue = new ResearchQueue(
        mockManager,
        DEFAULT_MAX_SIZE,
        DEFAULT_NO_CACHE,
        DEFAULT_CACHE_TTL_MS
      );

      // EXECUTE & VERIFY: Should throw for unknown task
      await expect(queue.waitForPRP('P1.M1.T1.S999')).rejects.toThrow(
        'No PRP available for task P1.M1.T1.S999'
      );
    });
  });

  describe('getStats', () => {
    it('should return statistics for queue state', async () => {
      // SETUP
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: createTestBacklog([]),
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      const mockGenerate = vi
        .fn()
        .mockResolvedValue(createTestPRPDocument('P1.M1.T1.S1'));
      MockPRPGenerator.mockImplementation(() => ({
        generate: mockGenerate,
      }));
      const queue = new ResearchQueue(
        mockManager,
        DEFAULT_MAX_SIZE,
        DEFAULT_NO_CACHE,
        DEFAULT_CACHE_TTL_MS
      );
      const task1 = createTestSubtask('P1.M1.T1.S1', 'Task 1', 'Planned');
      const task2 = createTestSubtask('P1.M1.T1.S2', 'Task 2', 'Planned');
      const backlog = createTestBacklog([]);

      // EXECUTE: Add some tasks and start one
      queue.queue.push(task2); // Add to queue (not started)
      await queue.enqueue(task1, backlog); // Start this one

      // Get stats while task1 is in progress
      const stats = queue.getStats();

      // VERIFY: Stats should reflect current state
      expect(stats.queued).toBeGreaterThan(0);
      expect(stats.researching).toBe(1);
      expect(stats.cached).toBe(0); // Not completed yet
    });

    it('should return all zeros for empty queue', async () => {
      // SETUP
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: createTestBacklog([]),
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      const mockGenerate = vi
        .fn()
        .mockResolvedValue(createTestPRPDocument('P1.M1.T1.S1'));
      MockPRPGenerator.mockImplementation(() => ({
        generate: mockGenerate,
      }));
      const queue = new ResearchQueue(
        mockManager,
        DEFAULT_MAX_SIZE,
        DEFAULT_NO_CACHE,
        DEFAULT_CACHE_TTL_MS
      );

      // EXECUTE
      const stats = queue.getStats();

      // VERIFY: All should be zero
      expect(stats).toEqual({
        queued: 0,
        researching: 0,
        cached: 0,
      });
    });

    it('should count cached results correctly', async () => {
      // SETUP
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: createTestBacklog([]),
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      const mockGenerate = vi
        .fn()
        .mockResolvedValue(createTestPRPDocument('P1.M1.T1.S1'));
      MockPRPGenerator.mockImplementation(() => ({
        generate: mockGenerate,
      }));
      const queue = new ResearchQueue(
        mockManager,
        DEFAULT_MAX_SIZE,
        DEFAULT_NO_CACHE,
        DEFAULT_CACHE_TTL_MS
      );
      const task = createTestSubtask('P1.M1.T1.S1', 'Test Subtask', 'Planned');
      const backlog = createTestBacklog([]);

      // EXECUTE: Complete a task
      await queue.enqueue(task, backlog);
      await queue.waitForPRP('P1.M1.T1.S1');

      const stats = queue.getStats();

      // VERIFY: Should have 1 cached result
      expect(stats.cached).toBe(1);
    });
  });

  describe('clearCache', () => {
    it('should clear cached results', async () => {
      // SETUP
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: createTestBacklog([]),
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      const mockGenerate = vi
        .fn()
        .mockResolvedValue(createTestPRPDocument('P1.M1.T1.S1'));
      MockPRPGenerator.mockImplementation(() => ({
        generate: mockGenerate,
      }));
      const queue = new ResearchQueue(
        mockManager,
        DEFAULT_MAX_SIZE,
        DEFAULT_NO_CACHE,
        DEFAULT_CACHE_TTL_MS
      );
      const task = createTestSubtask('P1.M1.T1.S1', 'Test Subtask', 'Planned');
      const backlog = createTestBacklog([]);

      // Complete a task to populate cache
      await queue.enqueue(task, backlog);
      await queue.waitForPRP('P1.M1.T1.S1');
      expect(queue.results.size).toBe(1);

      // EXECUTE: Clear cache
      queue.clearCache();

      // VERIFY: Cache should be empty
      expect(queue.results.size).toBe(0);
      expect(queue.getPRP('P1.M1.T1.S1')).toBeNull();
    });

    it('should not affect in-flight research or queue', async () => {
      // SETUP
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: createTestBacklog([]),
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      const mockGenerate = vi
        .fn()
        .mockImplementation(
          () =>
            new Promise(resolve =>
              setTimeout(
                () => resolve(createTestPRPDocument('P1.M1.T1.S1')),
                100
              )
            )
        );
      MockPRPGenerator.mockImplementation(() => ({
        generate: mockGenerate,
      }));
      const queue = new ResearchQueue(
        mockManager,
        DEFAULT_MAX_SIZE,
        DEFAULT_NO_CACHE,
        DEFAULT_CACHE_TTL_MS
      );
      const task = createTestSubtask('P1.M1.T1.S1', 'Test Subtask', 'Planned');
      const backlog = createTestBacklog([]);

      // Start research
      await queue.enqueue(task, backlog);
      const researchingSizeBefore = queue.researching.size;
      const queueLengthBefore = queue.queue.length;

      // EXECUTE: Clear cache while in-flight
      queue.clearCache();

      // VERIFY: In-flight and queue should not be affected
      expect(queue.researching.size).toBe(researchingSizeBefore);
      expect(queue.queue.length).toBe(queueLengthBefore);
    });
  });

  describe('error handling', () => {
    it('should propagate PRPGenerationError from waitForPRP', async () => {
      // SETUP
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: createTestBacklog([]),
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      const mockError = new Error('PRP generation failed');
      const mockGenerate = vi.fn().mockRejectedValue(mockError);
      MockPRPGenerator.mockImplementation(() => ({
        generate: mockGenerate,
      }));
      const queue = new ResearchQueue(
        mockManager,
        DEFAULT_MAX_SIZE,
        DEFAULT_NO_CACHE,
        DEFAULT_CACHE_TTL_MS
      );
      const task = createTestSubtask('P1.M1.T1.S1', 'Test Subtask', 'Planned');
      const backlog = createTestBacklog([]);

      // EXECUTE: Enqueue and wait for error
      await queue.enqueue(task, backlog);

      // VERIFY: Error should propagate
      await expect(queue.waitForPRP('P1.M1.T1.S1')).rejects.toThrow(
        'PRP generation failed'
      );
    });

    it('should remove failed task from researching Map', async () => {
      // SETUP
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: createTestBacklog([]),
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      const mockError = new Error('PRP generation failed');
      const mockGenerate = vi.fn().mockRejectedValue(mockError);
      MockPRPGenerator.mockImplementation(() => ({
        generate: mockGenerate,
      }));
      const queue = new ResearchQueue(
        mockManager,
        DEFAULT_MAX_SIZE,
        DEFAULT_NO_CACHE,
        DEFAULT_CACHE_TTL_MS
      );
      const task = createTestSubtask('P1.M1.T1.S1', 'Test Subtask', 'Planned');
      const backlog = createTestBacklog([]);

      // EXECUTE: Enqueue and wait for error
      await queue.enqueue(task, backlog);

      try {
        await queue.waitForPRP('P1.M1.T1.S1');
      } catch {
        // Expected error
      }

      // VERIFY: Should be removed from researching
      expect(queue.researching.has('P1.M1.T1.S1')).toBe(false);
    });

    it('should not cache failed results', async () => {
      // SETUP
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: createTestBacklog([]),
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      const mockError = new Error('PRP generation failed');
      const mockGenerate = vi.fn().mockRejectedValue(mockError);
      MockPRPGenerator.mockImplementation(() => ({
        generate: mockGenerate,
      }));
      const queue = new ResearchQueue(
        mockManager,
        DEFAULT_MAX_SIZE,
        DEFAULT_NO_CACHE,
        DEFAULT_CACHE_TTL_MS
      );
      const task = createTestSubtask('P1.M1.T1.S1', 'Test Subtask', 'Planned');
      const backlog = createTestBacklog([]);

      // EXECUTE: Enqueue and wait for error
      await queue.enqueue(task, backlog);

      try {
        await queue.waitForPRP('P1.M1.T1.S1');
      } catch {
        // Expected error
      }

      // VERIFY: Should not be cached
      expect(queue.results.has('P1.M1.T1.S1')).toBe(false);
      expect(queue.getPRP('P1.M1.T1.S1')).toBeNull();
    });

    it('should continue processing after error', async () => {
      // SETUP
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: createTestBacklog([]),
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      const mockGenerate = vi
        .fn()
        .mockRejectedValueOnce(new Error('Task 1 failed'))
        .mockResolvedValueOnce(createTestPRPDocument('P1.M1.T1.S2'));
      MockPRPGenerator.mockImplementation(() => ({
        generate: mockGenerate,
      }));
      const queue = new ResearchQueue(mockManager, 1); // Serial processing
      const task1 = createTestSubtask('P1.M1.T1.S1', 'Task 1', 'Planned');
      const task2 = createTestSubtask('P1.M1.T1.S2', 'Task 2', 'Planned');
      const backlog = createTestBacklog([]);

      // EXECUTE: Enqueue both tasks
      await queue.enqueue(task1, backlog);
      await queue.enqueue(task2, backlog);

      // Wait for task1 to fail
      try {
        await queue.waitForPRP('P1.M1.T1.S1');
      } catch {
        // Expected error
      }

      // Task 2 should still complete
      const result = await queue.waitForPRP('P1.M1.T1.S2');

      // VERIFY: Task 2 should complete despite task 1 failure
      expect(result).toBeDefined();
      expect(result.taskId).toBe('P1.M1.T1.S2');
    });
  });

  describe('waitForPRP deadline & abandonment', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      vi.useFakeTimers();
      vi.stubEnv(RESEARCH_TIMEOUT, '5'); // 5s deadline; POSITIVE (S1 guards <=0 → 300)
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllEnvs();
    });

    // Helper: create a standard queue + subtask + backlog for deadline tests
    const createDeadlineTestFixtures = () => {
      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: createTestBacklog([]),
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      const queue = new ResearchQueue(
        mockManager,
        DEFAULT_MAX_SIZE,
        DEFAULT_NO_CACHE,
        DEFAULT_CACHE_TTL_MS
      );
      const taskId = 'P1.M1.T1.S1';
      const task = createTestSubtask(taskId, 'Test Subtask', 'Planned');
      const backlog = createTestBacklog([]);
      return { queue, taskId, task, backlog };
    };

    it('should resolve normally when generation completes under deadline', async () => {
      // SETUP: mock generate resolves after 1s (under 5s deadline)
      const expectedPRP = createTestPRPDocument('P1.M1.T1.S1');
      const mockGenerate = vi
        .fn()
        .mockImplementation(
          () =>
            new Promise<PRPDocument>(r =>
              setTimeout(() => r(expectedPRP), 1000)
            )
        );
      MockPRPGenerator.mockImplementation(() => ({ generate: mockGenerate }));

      const { queue, taskId, task, backlog } = createDeadlineTestFixtures();

      // EXECUTE
      await queue.enqueue(task, backlog);
      const p = queue.waitForPRP(taskId);
      await vi.advanceTimersByTimeAsync(1000);
      const prp = await p;

      // VERIFY
      expect(prp).toEqual(expectedPRP);
      expect(queue.isAbandoned(taskId)).toBe(false);
    });

    it('should abandon after timeout and throw ResearchTimeoutError', async () => {
      // SETUP: mock generate NEVER resolves
      const mockGenerate = vi
        .fn()
        .mockImplementation(() => new Promise<PRPDocument>(() => {}));
      MockPRPGenerator.mockImplementation(() => ({ generate: mockGenerate }));

      const { queue, taskId, task, backlog } = createDeadlineTestFixtures();

      // EXECUTE
      await queue.enqueue(task, backlog);
      const p = queue.waitForPRP(taskId);
      // Attach rejection handler BEFORE advancing timers to prevent vitest
      // unhandled-rejection detection (timer fires → promise rejects before
      // expect().rejects can attach its handler).
      const errorPromise = p.catch((err: unknown) => err);
      await vi.advanceTimersByTimeAsync(5_000); // past the 5s deadline
      const err = await errorPromise;

      // VERIFY
      expect(err).toBeInstanceOf(ResearchTimeoutError);
      expect((err as ResearchTimeoutError).message).toMatch(/exceeded the 5s/);
      expect(queue.isAbandoned(taskId)).toBe(true);
    });

    it('should ignore a late resolved result for an abandoned task (not cached)', async () => {
      // SETUP: deferred promise that we control
      let resolveGen!: (p: PRPDocument) => void;
      const gen = new Promise<PRPDocument>(r => {
        resolveGen = r;
      });
      const mockGenerate = vi.fn().mockReturnValue(gen);
      MockPRPGenerator.mockImplementation(() => ({ generate: mockGenerate }));

      const expectedPRP = createTestPRPDocument('P1.M1.T1.S1');
      const { queue, taskId, task, backlog } = createDeadlineTestFixtures();

      // EXECUTE: enqueue, wait past deadline → abandoned
      await queue.enqueue(task, backlog);
      const p = queue.waitForPRP(taskId);
      // Attach rejection handler before advancing timers (see test (b) rationale)
      const errorPromise = p.catch((err: unknown) => err);
      await vi.advanceTimersByTimeAsync(5_000);
      const err = await errorPromise;

      // VERIFY: abandonment
      expect(err).toBeInstanceOf(ResearchTimeoutError);
      expect(queue.isAbandoned(taskId)).toBe(true);

      // EXECUTE: late result arrives (resolve the deferred generate)
      resolveGen(expectedPRP);
      await vi.advanceTimersByTimeAsync(0); // flush microtasks

      // VERIFY: NOT cached (dedup)
      expect(queue.getPRP(taskId)).toBeNull();
      expect(queue.isAbandoned(taskId)).toBe(true);
    });

    it('should still return cache via getPRP for a non-abandoned completed task', async () => {
      // SETUP: mock generate resolves fast (1s)
      const expectedPRP = createTestPRPDocument('P1.M1.T1.S1');
      const mockGenerate = vi
        .fn()
        .mockImplementation(
          () =>
            new Promise<PRPDocument>(r =>
              setTimeout(() => r(expectedPRP), 1000)
            )
        );
      MockPRPGenerator.mockImplementation(() => ({ generate: mockGenerate }));

      const { queue, taskId, task, backlog } = createDeadlineTestFixtures();

      // EXECUTE: enqueue, advance past 1s resolve, await waitForPRP
      await queue.enqueue(task, backlog);
      await vi.advanceTimersByTimeAsync(1000);
      await queue.waitForPRP(taskId);

      // VERIFY
      expect(queue.getPRP(taskId)).toEqual(expectedPRP);
      expect(queue.isAbandoned(taskId)).toBe(false);
    });

    it('should not surface a late background failure on an abandoned task', async () => {
      // SETUP: deferred-reject promise
      let rejectGen!: (err: Error) => void;
      const gen = new Promise<PRPDocument>((_, rej) => {
        rejectGen = rej;
      });
      const mockGenerate = vi.fn().mockReturnValue(gen);
      MockPRPGenerator.mockImplementation(() => ({ generate: mockGenerate }));

      const { queue, taskId, task, backlog } = createDeadlineTestFixtures();

      // EXECUTE: enqueue, advance past deadline → abandoned
      await queue.enqueue(task, backlog);
      const p = queue.waitForPRP(taskId);
      // Attach rejection handler before advancing timers (see test (b) rationale)
      const errorPromise = p.catch((err: unknown) => err);
      await vi.advanceTimersByTimeAsync(5_000);
      const err = await errorPromise;

      // VERIFY: abandonment
      expect(err).toBeInstanceOf(ResearchTimeoutError);
      expect(queue.isAbandoned(taskId)).toBe(true);

      // EXECUTE: late failure arrives
      rejectGen(new Error('late gen boom'));
      await vi.advanceTimersByTimeAsync(0); // flush microtasks

      // VERIFY: still abandoned, no cache, no unhandled rejection
      expect(queue.isAbandoned(taskId)).toBe(true);
      expect(queue.getPRP(taskId)).toBeNull();
    });

    it('should return false for isAbandoned on a never-abandoned/unknown task', async () => {
      // SETUP
      const mockGenerate = vi
        .fn()
        .mockResolvedValue(createTestPRPDocument('P1.M1.T1.S1'));
      MockPRPGenerator.mockImplementation(() => ({ generate: mockGenerate }));

      const { queue } = createDeadlineTestFixtures();

      // VERIFY
      expect(queue.isAbandoned('P1.M1.T1.S999')).toBe(false);
    });
  });

  describe('researchNow', () => {
    it('should generate synchronously inline and cache the result', async () => {
      // SETUP
      const expectedPRP = createTestPRPDocument('P1.M1.T1.S1');
      const mockGenerate = vi.fn().mockResolvedValue(expectedPRP);
      MockPRPGenerator.mockImplementation(() => ({ generate: mockGenerate }));

      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: createTestBacklog([]),
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      const queue = new ResearchQueue(
        mockManager,
        DEFAULT_MAX_SIZE,
        DEFAULT_NO_CACHE,
        DEFAULT_CACHE_TTL_MS
      );
      const task = createTestSubtask('P1.M1.T1.S1', 'Test Subtask', 'Planned');
      const backlog = createTestBacklog([]);

      // EXECUTE
      const out = await queue.researchNow(task, backlog);

      // VERIFY: returned the generated PRP
      expect(out).toEqual(expectedPRP);
      expect(mockGenerate).toHaveBeenCalledTimes(1);
      expect(mockGenerate).toHaveBeenCalledWith(task, backlog, undefined);

      // VERIFY: cached in results (getPRP returns it)
      expect(queue.getPRP(task.id)).toEqual(expectedPRP);
    });

    it('should return the cached result without re-generating if one already exists', async () => {
      // SETUP
      const cached = createTestPRPDocument('P1.M1.T1.S1');
      const mockGenerate = vi.fn(); // must NOT be called
      MockPRPGenerator.mockImplementation(() => ({ generate: mockGenerate }));

      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: createTestBacklog([]),
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      const queue = new ResearchQueue(
        mockManager,
        DEFAULT_MAX_SIZE,
        DEFAULT_NO_CACHE,
        DEFAULT_CACHE_TTL_MS
      );
      const task = createTestSubtask('P1.M1.T1.S1', 'Test Subtask', 'Planned');

      // Pre-seed cache
      (queue as any).results.set(task.id, cached);

      // EXECUTE
      const out = await queue.researchNow(task, createTestBacklog([]));

      // VERIFY: returned cached result, generate NOT called
      expect(out).toEqual(cached);
      expect(mockGenerate).not.toHaveBeenCalled();
    });

    it('should not delete from researching (background cleanup is processNext.finally)', async () => {
      // SETUP
      const expectedPRP = createTestPRPDocument('P1.M1.T1.S1');
      const mockGenerate = vi.fn().mockResolvedValue(expectedPRP);
      MockPRPGenerator.mockImplementation(() => ({ generate: mockGenerate }));

      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: createTestBacklog([]),
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      const queue = new ResearchQueue(
        mockManager,
        DEFAULT_MAX_SIZE,
        DEFAULT_NO_CACHE,
        DEFAULT_CACHE_TTL_MS
      );
      const task = createTestSubtask('P1.M1.T1.S1', 'Test Subtask', 'Planned');

      // Pre-seed researching (simulates in-flight background work)
      (queue as any).researching.set(
        task.id,
        Promise.resolve(createTestPRPDocument('P1.M1.T1.S1'))
      );
      expect((queue as any).researching.has(task.id)).toBe(true);

      // EXECUTE
      await queue.researchNow(task, createTestBacklog([]));

      // VERIFY: researching is still intact
      expect((queue as any).researching.has(task.id)).toBe(true);
    });

    it('should forward issueFeedback to generate as the 3rd arg', async () => {
      // SETUP
      const mockGenerate = vi
        .fn()
        .mockResolvedValue(createTestPRPDocument('P1.M1.T1.S1'));
      MockPRPGenerator.mockImplementation(() => ({
        generate: mockGenerate,
        getCachePath: (id: string) =>
          `/plan/x/prps/${id.replace(/\./g, '_')}.md`,
        getCacheMetadataPath: (id: string) =>
          `/plan/x/prps/.cache/${id.replace(/\./g, '_')}.json`,
      }));

      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: createTestBacklog([]),
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      const queue = new ResearchQueue(
        mockManager,
        DEFAULT_MAX_SIZE,
        DEFAULT_NO_CACHE,
        DEFAULT_CACHE_TTL_MS
      );
      const task = createTestSubtask('P1.M1.T1.S1', 'Test Subtask', 'Planned');
      const backlog = createTestBacklog([]);

      // EXECUTE
      await queue.researchNow(task, backlog, 'feedback forcing re-research');

      // VERIFY: generate received the feedback as the 3rd arg
      expect(mockGenerate).toHaveBeenCalledWith(
        task,
        backlog,
        'feedback forcing re-research'
      );
    });
  });

  describe('deletePRP', () => {
    it('should clear the in-memory results entry and unlink the PRP + metadata files', async () => {
      // SETUP
      const expectedPRP = createTestPRPDocument('P1.M1.T1.S1');
      const mockGenerate = vi.fn().mockResolvedValue(expectedPRP);
      MockPRPGenerator.mockImplementation(() => ({
        generate: mockGenerate,
        getCachePath: (id: string) =>
          `/plan/x/prps/${id.replace(/\./g, '_')}.md`,
        getCacheMetadataPath: (id: string) =>
          `/plan/x/prps/.cache/${id.replace(/\./g, '_')}.json`,
      }));

      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: createTestBacklog([]),
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      const queue = new ResearchQueue(
        mockManager,
        DEFAULT_MAX_SIZE,
        DEFAULT_NO_CACHE,
        DEFAULT_CACHE_TTL_MS
      );
      const task = createTestSubtask('P1.M1.T1.S1', 'Test Subtask', 'Planned');

      // Pre-seed cache
      (queue as any).results.set(task.id, expectedPRP);
      expect(queue.getPRP(task.id)).toEqual(expectedPRP);

      // EXECUTE
      await queue.deletePRP(task.id);

      // VERIFY: in-memory cache cleared
      expect(queue.getPRP(task.id)).toBeNull();
      expect((queue as any).results.has(task.id)).toBe(false);

      // VERIFY: unlink called for both PRP file + metadata file
      expect(mockUnlink).toHaveBeenCalledTimes(2);
    });

    it('should not throw when the PRP file does not exist (ENOENT-tolerant)', async () => {
      // SETUP
      mockUnlink.mockRejectedValue({ code: 'ENOENT' });
      MockPRPGenerator.mockImplementation(() => ({
        generate: vi.fn(),
        getCachePath: (id: string) =>
          `/plan/x/prps/${id.replace(/\./g, '_')}.md`,
        getCacheMetadataPath: (id: string) =>
          `/plan/x/prps/.cache/${id.replace(/\./g, '_')}.json`,
      }));

      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: createTestBacklog([]),
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      const queue = new ResearchQueue(
        mockManager,
        DEFAULT_MAX_SIZE,
        DEFAULT_NO_CACHE,
        DEFAULT_CACHE_TTL_MS
      );

      // EXECUTE & VERIFY: should NOT throw
      await expect(queue.deletePRP('P1.M1.T1.S1')).resolves.toBeUndefined();

      // VERIFY: unlink was still attempted (both calls rejected ENOENT)
      expect(mockUnlink).toHaveBeenCalledTimes(2);
    });

    it('should re-throw non-ENOENT errors from unlink', async () => {
      // SETUP
      mockUnlink.mockRejectedValue(new Error('Permission denied'));
      MockPRPGenerator.mockImplementation(() => ({
        generate: vi.fn(),
        getCachePath: (id: string) =>
          `/plan/x/prps/${id.replace(/\./g, '_')}.md`,
        getCacheMetadataPath: (id: string) =>
          `/plan/x/prps/.cache/${id.replace(/\./g, '_')}.json`,
      }));

      const currentSession = {
        metadata: {
          id: '001_14b9dc2a33c7',
          hash: '14b9dc2a33c7',
          path: '/plan/001_14b9dc2a33c7',
          createdAt: new Date(),
          parentSession: null,
        },
        prdSnapshot: '# Test PRD',
        taskRegistry: createTestBacklog([]),
        currentItemId: null,
      };
      const mockManager = createMockSessionManager(currentSession);
      const queue = new ResearchQueue(
        mockManager,
        DEFAULT_MAX_SIZE,
        DEFAULT_NO_CACHE,
        DEFAULT_CACHE_TTL_MS
      );

      // EXECUTE & VERIFY: non-ENOENT errors should propagate
      await expect(queue.deletePRP('P1.M1.T1.S1')).rejects.toThrow(
        'Permission denied'
      );
    });
  });
});
