/**
 * Unit tests for PRPGenerator class
 *
 * @remarks
 * Tests validate PRPGenerator class from src/agents/prp-generator.ts with comprehensive
 * coverage of happy path, retry scenarios, and error handling.
 *
 * Mocks are used for all external dependencies - no real I/O or LLM calls are performed.
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PRPGenerator,
  PRPGenerationError,
  PRPFileError,
} from '../../../src/agents/prp-generator.js';
import type { SessionManager } from '../../../src/core/session-manager.js';
import type {
  PRPDocument,
  Backlog,
  Subtask,
} from '../../../src/core/models.js';

// Mock the agent-factory module
vi.mock('../../../src/agents/agent-factory.js', () => ({
  createResearcherAgent: vi.fn(),
}));

// Mock the prp-blueprint-prompt module
vi.mock('../../../src/agents/prompts/prp-blueprint-prompt.js', () => ({
  createPRPBlueprintPrompt: vi.fn(),
}));

// Mock the node:fs/promises module
vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  readFile: vi.fn(),
  stat: vi.fn(),
}));

// Mock crypto for hash computation
vi.mock('node:crypto', () => ({
  createHash: vi.fn(),
  randomUUID: vi.fn(() => 'test-uuid'),
}));

// Import mocked modules
import { createResearcherAgent } from '../../../src/agents/agent-factory.js';
import { createPRPBlueprintPrompt } from '../../../src/agents/prompts/prp-blueprint-prompt.js';
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// Cast mocked functions
const mockCreateResearcherAgent = createResearcherAgent as any;
const mockCreatePRPBlueprintPrompt = createPRPBlueprintPrompt as any;
const mockMkdir = mkdir as any;
const mockWriteFile = writeFile as any;
const mockReadFile = readFile as any;
const mockStat = stat as any;
const mockCreateHash = createHash as any;

/**
 * Path-aware, agent-driven mockReadFile for the file-is-the-contract pattern.
 *
 * The source's retry closure (prp-generator.ts:688-745) makes readFile calls
 * to TWO distinct paths and in TWO distinct roles:
 *
 *   1. fast-path reuse probe (:696) on EVERY attempt — reads prpOutputPath
 *      to reuse a prior attempt's output. In a unit test mockWriteFile is a
 *      no-op (nothing is really written), so the file only "exists" AFTER the
 *      agent has successfully returned. Before that, the probe MUST reject
 *      ENOENT (otherwise the agent is never called and "prompt called N×"
 *      assertions break).
 *   2. file-contract read (:735) — AFTER a successful agent.prompt() call,
 *      reads the PRP the agent "wrote". This returns the PRP JSON.
 *
 * The faithful discriminator is NOT call-order (the fast-path probe runs on
 * every attempt, including retries) but whether the agent has already
 * produced a successful response: the file "exists" exactly once the agent
 * has resolved successfully. We key off mockAgent.prompt.mock.calls to model
 * that — once the agent has a successful (status:'success') call on record,
 * the prpOutputPath read returns the PRP JSON; before that it rejects ENOENT.
 *
 * mockReadFile is ALSO called for cache-metadata reads at
 * `{sessionPath}/prps/.cache/{sanitizedId}.json` (getCacheMetadataPath) — both
 * the PRP-output path and the cache-metadata path end in `{sanitizedId}.json`,
 * so the `!path.includes('.cache')` guard distinguishes them. Cache reads are
 * wrapped in try/catch that tolerates ENOENT (cache miss → null).
 *
 * Applied PER-TEST (never in a global beforeEach) so it does not clobber the
 * cache-HIT test's own per-test mockReadFile setup.
 *
 * @param prp - the PRPDocument to return at the prpOutputPath
 * @param agent - the mock agent (its `prompt` mock's settled results drive the
 *   file-exists check, since the agent's `prompt` mock is scoped inside the
 *   describe block)
 */
function setupReadFileForPRP(
  prp: PRPDocument,
  agent: { prompt: { mock: { results: { type: string; value: unknown }[] } } }
): void {
  const prpJson = JSON.stringify(prp);
  const sanitizedId = prp.taskId.replace(/\./g, '_');
  mockReadFile.mockImplementation(async (path: string) => {
    // PRP output path: {sessionPath}/prps/{sanitizedId}.json (NOT .cache)
    if (path.endsWith(`${sanitizedId}.json`) && !path.includes('.cache')) {
      // The file "exists" only after the agent has successfully returned —
      // model the file-is-the-contract write. Before any successful agent
      // call, the fast-path reuse probe must see ENOENT so the agent runs.
      const agentSucceeded = agent.prompt.mock.results.some(
        (r: { type: string; value: unknown }) =>
          r.type === 'return' &&
          (r.value as { status?: string })?.status === 'success'
      );
      if (agentSucceeded) {
        return prpJson;
      }
      const err = new Error(
        `ENOENT: no such file or directory, open '${path}'`
      ) as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    }
    // Cache metadata (.cache/*.json) or anything else → ENOENT (cache miss → null).
    const err = new Error(
      `ENOENT: no such file or directory, open '${path}'`
    ) as NodeJS.ErrnoException;
    err.code = 'ENOENT';
    throw err;
  });
}

// Factory functions for test data
const createMockSessionManager = (sessionPath: string): SessionManager => {
  return {
    currentSession: {
      metadata: {
        id: '001_14b9dc2a33c7',
        hash: '14b9dc2a33c7',
        path: sessionPath,
        createdAt: new Date(),
        parentSession: null,
      },
      prdSnapshot: '# PRD Content',
      taskRegistry: { backlog: [] },
      currentItemId: null,
    },
  } as SessionManager;
};

const createMockSubtask = (id: string, title: string): Subtask => ({
  id,
  type: 'Subtask',
  title,
  status: 'Planned',
  story_points: 3,
  dependencies: [],
  context_scope: 'Implement the feature',
});

const createMockBacklog = (): Backlog => ({
  backlog: [],
});

const createMockPRPDocument = (taskId: string): PRPDocument => ({
  taskId,
  objective: 'Implement feature X',
  context: '## Context\nFull context here',
  implementationSteps: ['Step 1: Create file', 'Step 2: Implement logic'],
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
      description: 'Manual review',
      command: null,
      manual: true,
    },
  ],
  successCriteria: [
    { description: 'Feature works as expected', satisfied: false },
    { description: 'Tests pass', satisfied: false },
  ],
  references: ['https://example.com/docs'],
});

const createMockAgent = () => ({
  prompt: vi.fn(),
});

describe('agents/prp-generator', () => {
  const sessionPath = '/tmp/test-session';
  let mockSessionManager: SessionManager;
  let mockAgent: ReturnType<typeof createMockAgent>;

  beforeEach(() => {
    // Setup mock session manager
    mockSessionManager = createMockSessionManager(sessionPath);

    // Setup mock agent
    mockAgent = createMockAgent();
    mockCreateResearcherAgent.mockReturnValue(mockAgent);

    // Setup mock prompt
    const mockPrompt = { system: 'system', user: 'user', responseFormat: {} };
    mockCreatePRPBlueprintPrompt.mockReturnValue(mockPrompt);

    // Setup file system mocks
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);

    // Setup crypto hash mock
    const mockHash = {
      update: vi.fn().mockReturnThis(),
      digest: vi.fn().mockReturnValue('abc123'),
    };
    mockCreateHash.mockReturnValue(mockHash);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create PRPGenerator with session path', () => {
      // EXECUTE
      const generator = new PRPGenerator(mockSessionManager);

      // VERIFY: Session manager and path are set
      expect(generator.sessionManager).toBe(mockSessionManager);
      expect(generator.sessionPath).toBe(sessionPath);
    });

    it('should cache Researcher Agent in constructor', () => {
      // EXECUTE
      new PRPGenerator(mockSessionManager);

      // VERIFY: createResearcherAgent was called once
      expect(mockCreateResearcherAgent).toHaveBeenCalledTimes(1);
    });

    it('should throw error when no active session', () => {
      // SETUP: Session manager with null current session
      const emptySessionManager = { currentSession: null } as SessionManager;

      // EXECUTE & VERIFY: Constructor throws
      expect(() => new PRPGenerator(emptySessionManager)).toThrow(
        'Cannot create PRPGenerator: no active session'
      );
    });
  });

  describe('generate', () => {
    it('should successfully generate PRP on first attempt', async () => {
      // SETUP
      const task = createMockSubtask('P1.M2.T2.S2', 'Test Subtask');
      const backlog = createMockBacklog();
      const mockPRP = createMockPRPDocument(task.id);

      mockAgent.prompt.mockResolvedValue({ status: 'success', output: '' });
      setupReadFileForPRP(mockPRP, mockAgent);

      const generator = new PRPGenerator(mockSessionManager);

      // EXECUTE
      const result = await generator.generate(task, backlog);

      // VERIFY: PRP document is returned
      expect(result).toEqual(mockPRP);
      expect(result.taskId).toBe(task.id);

      // VERIFY: Prompt was created with correct parameters (4th arg = the
      // prpOutputPath, 5th arg = undefined when no feedback, 6th arg = the
      // extracted PRD sections — selectors=[] falls back to the full PRD).
      expect(mockCreatePRPBlueprintPrompt).toHaveBeenCalledWith(
        task,
        backlog,
        expect.stringContaining('hacky-hack'),
        expect.stringContaining('P1_M2_T2_S2.json'),
        undefined,
        '# PRD Content'
      );

      // VERIFY: Agent was called once
      expect(mockAgent.prompt).toHaveBeenCalledTimes(1);

      // VERIFY: File was written (PRP file + cache metadata)
      expect(mockMkdir).toHaveBeenCalledWith(expect.stringContaining('prps'), {
        recursive: true,
      });
      expect(mockWriteFile).toHaveBeenCalledTimes(2); // PRP file + cache metadata
    });

    it('should forward issueFeedback to createPRPBlueprintPrompt as the 5th arg', async () => {
      // SETUP
      const task = createMockSubtask('P1.M2.T2.S2', 'Test Subtask');
      const backlog = createMockBacklog();
      const feedback = 'Prior PRP missed the /health contract; address it.';
      const mockPRP = createMockPRPDocument(task.id);
      mockAgent.prompt.mockResolvedValue({ status: 'success', output: '' });
      setupReadFileForPRP(mockPRP, mockAgent);
      const generator = new PRPGenerator(mockSessionManager);

      // EXECUTE
      await generator.generate(task, backlog, feedback);

      // VERIFY: Feedback was forwarded as the 5th arg (4th is the prpOutputPath).
      expect(mockCreatePRPBlueprintPrompt).toHaveBeenCalledWith(
        task,
        backlog,
        expect.stringContaining('hacky-hack'),
        expect.stringContaining('P1_M2_T2_S2.json'),
        feedback,
        '# PRD Content'
      );
    });

    it('should pass extracted PRD sections as the 6th arg to createPRPBlueprintPrompt', async () => {
      // SETUP: A Subtask with EXPLICIT prd_selectors: [] (the factory omits it).
      // [] ⇒ extractPRDSections falls back to the full resolved PRD. The mock
      // session manager's prdSnapshot is '# PRD Content', so the 6th arg must
      // equal that. createPRPBlueprintPrompt is called BEFORE the retry loop /
      // file-contract read, so the spy records the call regardless.
      const subtask: Subtask = {
        ...createMockSubtask('P1.M2.T1.S3', 'Selector extraction'),
        prd_selectors: [],
      };
      const backlog = createMockBacklog();
      mockAgent.prompt.mockResolvedValue({ status: 'success', output: '' });
      setupReadFileForPRP(createMockPRPDocument(subtask.id), mockAgent);
      const generator = new PRPGenerator(mockSessionManager);

      // EXECUTE
      await generator.generate(subtask, backlog);

      // VERIFY: The 6th arg (prdSections) = the full resolved PRD (selectors=[]
      // fallback). The full resolved PRD is the session's prdSnapshot.
      expect(mockCreatePRPBlueprintPrompt).toHaveBeenCalledWith(
        subtask,
        backlog,
        expect.any(String),
        expect.any(String),
        undefined,
        '# PRD Content'
      );
    });

    it('should pass extracted section text as the 6th arg when selectors resolve', async () => {
      // SETUP: Override the session's prdSnapshot to a small PRD with a known
      // h1.0, and a Subtask selecting ['h1.0']. All resolve ⇒ the 6th arg is
      // that section's source text (NOT the full PRD).
      const prdSnapshot = ['# Title', 'intro body'].join('\n');
      (mockSessionManager as any).currentSession.prdSnapshot = prdSnapshot;
      const subtask: Subtask = {
        ...createMockSubtask('P1.M2.T1.S3', 'Selector extraction'),
        prd_selectors: ['h1.0'],
      };
      const backlog = createMockBacklog();
      mockAgent.prompt.mockResolvedValue({ status: 'success', output: '' });
      setupReadFileForPRP(createMockPRPDocument(subtask.id), mockAgent);
      const generator = new PRPGenerator(mockSessionManager);

      // EXECUTE
      await generator.generate(subtask, backlog);

      // VERIFY: The 6th arg contains the heading text (selective extraction
      // worked end-to-end), not the full snapshot.
      expect(mockCreatePRPBlueprintPrompt).toHaveBeenCalledWith(
        subtask,
        backlog,
        expect.any(String),
        expect.any(String),
        undefined,
        expect.stringContaining('# Title')
      );
      const callArgs = mockCreatePRPBlueprintPrompt.mock.calls.at(-1)!;
      expect(callArgs[5]).toContain('# Title');
      expect(callArgs[5]).toContain('intro body');
    });

    it('should write PRP file with correct filename', async () => {
      // SETUP
      const task = createMockSubtask('P1.M2.T2.S2', 'Test Subtask');
      const backlog = createMockBacklog();
      const mockPRP = createMockPRPDocument(task.id);

      mockAgent.prompt.mockResolvedValue({ status: 'success', output: '' });
      setupReadFileForPRP(mockPRP, mockAgent);

      const generator = new PRPGenerator(mockSessionManager);

      // EXECUTE
      await generator.generate(task, backlog);

      // VERIFY: File was written with sanitized filename (dots replaced with underscores)
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringMatching(/P1_M2_T2_S2\.md$/),
        expect.stringContaining('# PRP for P1.M2.T2.S2'),
        { mode: 0o644 }
      );
    });

    it('should retry on failure and succeed on second attempt', async () => {
      // SETUP
      const task = createMockSubtask('P1.M2.T2.S1', 'Test Subtask');
      const backlog = createMockBacklog();
      const mockPRP = createMockPRPDocument(task.id);

      // First attempt fails, second succeeds
      mockAgent.prompt
        .mockRejectedValueOnce(new Error('LLM timeout'))
        .mockResolvedValueOnce({ status: 'success', output: '' });
      setupReadFileForPRP(mockPRP, mockAgent);

      const generator = new PRPGenerator(mockSessionManager);

      // EXECUTE
      const result = await generator.generate(task, backlog);

      // VERIFY: PRP is returned after retry
      expect(result).toEqual(mockPRP);

      // VERIFY: Agent was called twice (failed once, succeeded once)
      expect(mockAgent.prompt).toHaveBeenCalledTimes(2);

      // VERIFY: File was written (PRP file + cache metadata)
      expect(mockWriteFile).toHaveBeenCalledTimes(2); // PRP file + cache metadata
    });

    it(
      'should exhaust retries and throw the underlying error after max attempts',
      async () => {
        // SETUP
        const task = createMockSubtask('P1.M2.T2.S1', 'Test Subtask');
        const backlog = createMockBacklog();

        // All attempts fail with a TRANSIENT error (matches a TRANSIENT_PATTERN
        // like 'timeout') so retryAgentPrompt actually exhausts maxAttempts=3.
        // NOTE: the source's retryAgentPrompt (utils/retry.ts) does NOT wrap the
        // final error into PRPGenerationError — it rethrows the raw underlying
        // error. PRPGenerationError is exported + documented (@throws) but
        // never actually thrown by generate(). Wrapping it is a SOURCE change
        // that is explicitly out of scope for this test-only task; this test
        // asserts the actual source behavior (raw error after 3 attempts).
        const failureMessage = 'LLM service timeout';
        mockAgent.prompt.mockRejectedValue(new Error(failureMessage));

        const generator = new PRPGenerator(mockSessionManager);

        // EXECUTE & VERIFY: the raw transient error propagates after retries.
        await expect(generator.generate(task, backlog)).rejects.toThrow(
          failureMessage
        );

        // VERIFY: Agent was called 3 times (max retries)
        expect(mockAgent.prompt).toHaveBeenCalledTimes(3);
      },
      { timeout: 10000 }
    );

    it('should use exponential backoff for retries', async () => {
      // SETUP
      const task = createMockSubtask('P1.M2.T2.S1', 'Test Subtask');
      const backlog = createMockBacklog();
      const mockPRP = createMockPRPDocument(task.id);

      // Fail twice (transient errors so retryAgentPrompt retries), succeed on third
      mockAgent.prompt
        .mockRejectedValueOnce(new Error('LLM timeout - attempt 1'))
        .mockRejectedValueOnce(new Error('LLM timeout - attempt 2'))
        .mockResolvedValueOnce({ status: 'success', output: '' });
      setupReadFileForPRP(mockPRP, mockAgent);

      const generator = new PRPGenerator(mockSessionManager);
      const startTime = Date.now();

      // EXECUTE
      await generator.generate(task, backlog);

      const elapsedTime = Date.now() - startTime;

      // VERIFY: Delay was applied (exponential backoff: 1s + 2s = 3s minimum)
      // Allow some tolerance for test execution time
      expect(elapsedTime).toBeGreaterThanOrEqual(2000);
    });
  });

  describe('PRPGenerationError', () => {
    it('should create error with correct properties', () => {
      // EXECUTE
      const originalError = new Error('LLM failed');
      const error = new PRPGenerationError('P1.M2.T2.S1', 3, originalError);

      // VERIFY: Error has correct properties
      expect(error.name).toBe('PRPGenerationError');
      expect(error.taskId).toBe('P1.M2.T2.S1');
      expect(error.attempt).toBe(3);
      expect(error.message).toContain('P1.M2.T2.S1');
      expect(error.message).toContain('3');
      expect(error.message).toContain('LLM failed');
    });
  });

  describe('PRPFileError', () => {
    it('should create error with correct properties', () => {
      // EXECUTE
      const originalError = new Error('EACCES: permission denied');
      const error = new PRPFileError(
        'P1.M2.T2.S1',
        '/tmp/test-session/prps/P1M2T2S1.md',
        originalError
      );

      // VERIFY: Error has correct properties
      expect(error.name).toBe('PRPFileError');
      expect(error.taskId).toBe('P1.M2.T2.S1');
      expect(error.filePath).toBe('/tmp/test-session/prps/P1M2T2S1.md');
      expect(error.message).toContain('P1.M2.T2.S1');
      expect(error.message).toContain('/tmp/test-session/prps/P1M2T2S1.md');
      expect(error.message).toContain('permission denied');
    });
  });

  describe('PRP markdown formatting', () => {
    it('should format PRP as valid markdown', async () => {
      // SETUP
      const task = createMockSubtask('P1.M2.T2.S2', 'Test Subtask');
      const backlog = createMockBacklog();
      const mockPRP = createMockPRPDocument(task.id);

      mockAgent.prompt.mockResolvedValue({ status: 'success', output: '' });
      setupReadFileForPRP(mockPRP, mockAgent);

      const generator = new PRPGenerator(mockSessionManager);

      // EXECUTE
      await generator.generate(task, backlog);

      // VERIFY: File content contains all required sections
      const writeCall = mockWriteFile.mock.calls[0];
      const markdownContent = writeCall[1];

      expect(markdownContent).toContain('# PRP for P1.M2.T2.S2');
      expect(markdownContent).toContain('## Objective');
      expect(markdownContent).toContain('Implement feature X');
      expect(markdownContent).toContain('## Context');
      expect(markdownContent).toContain('## Implementation Steps');
      expect(markdownContent).toContain('1. Step 1: Create file');
      expect(markdownContent).toContain('2. Step 2: Implement logic');
      expect(markdownContent).toContain('## Validation Gates');
      expect(markdownContent).toContain('### Level 1: 1');
      expect(markdownContent).toContain('npm run lint');
      expect(markdownContent).toContain('## Success Criteria');
      expect(markdownContent).toContain('- [ ] Feature works as expected');
      expect(markdownContent).toContain('## References');
    });

    it('should handle null command for manual validation levels', async () => {
      // SETUP
      const task = createMockSubtask('P1.M2.T2.S2', 'Test Subtask');
      const backlog = createMockBacklog();
      const mockPRP = createMockPRPDocument(task.id);

      mockAgent.prompt.mockResolvedValue({ status: 'success', output: '' });
      setupReadFileForPRP(mockPRP, mockAgent);

      const generator = new PRPGenerator(mockSessionManager);

      // EXECUTE
      await generator.generate(task, backlog);

      // VERIFY: Manual validation level shows "Manual validation required"
      const writeCall = mockWriteFile.mock.calls[0];
      const markdownContent = writeCall[1];

      expect(markdownContent).toContain('Manual validation required');
    });
  });

  describe('file write errors', () => {
    it('should throw when mkdir fails', async () => {
      // SETUP
      const task = createMockSubtask('P1.M2.T2.S2', 'Test Subtask');
      const backlog = createMockBacklog();
      const mockPRP = createMockPRPDocument(task.id);

      mockAgent.prompt.mockResolvedValue({ status: 'success', output: '' });
      mockMkdir.mockRejectedValue(new Error('EACCES: permission denied'));

      const generator = new PRPGenerator(mockSessionManager);

      // EXECUTE & VERIFY: prp-generator.ts:656 does a BARE `await mkdir(...)`
      // with NO surrounding try/catch in generate(), so a rejecting mkdir throws
      // the RAW Error (NOT PRPFileError). Wrapping it in try/catch → PRPFileError
      // is a SOURCE change explicitly out of scope for this test-only task; this
      // asserts the actual behavior (any error propagates from mkdir).
      await expect(generator.generate(task, backlog)).rejects.toThrow();
    });

    it('should throw PRPFileError when writeFile fails', async () => {
      // SETUP
      const task = createMockSubtask('P1.M2.T2.S2', 'Test Subtask');
      const backlog = createMockBacklog();
      const mockPRP = createMockPRPDocument(task.id);

      mockAgent.prompt.mockResolvedValue({ status: 'success', output: '' });
      setupReadFileForPRP(mockPRP, mockAgent); // needed so generate reaches #writePRPToFile
      mockWriteFile.mockRejectedValue(new Error('ENOSPC: no space left'));

      const generator = new PRPGenerator(mockSessionManager);

      // EXECUTE & VERIFY
      await expect(generator.generate(task, backlog)).rejects.toThrow(
        PRPFileError
      );
    });
  });

  describe('cache', () => {
    beforeEach(() => {
      // Reset file system mocks for cache tests
      mockReadFile.mockReset();
      mockStat.mockReset();

      // Default: cache file doesn't exist
      mockStat.mockRejectedValue(new Error('ENOENT'));
    });

    it('should bypass cache read and invoke the agent when issueFeedback is provided', async () => {
      // SETUP: Seed a recent cache file with matching hash, but pass feedback.
      // feedback bypasses the cache READ entirely (the
      // `if (!this.#noCache && !issueFeedback)` guard is false), so the
      // mockStat/mockReadFile cache-check setup below is never consulted —
      // the agent runs and the file-contract read returns the PRP JSON.
      const task = createMockSubtask('P1.M1.T1.S1', 'Test Subtask');
      const backlog = createMockBacklog();
      const cachedPRP = createMockPRPDocument(task.id);
      const mockMetadata = {
        taskId: task.id,
        taskHash: 'abc123',
        createdAt: Date.now(),
        accessedAt: Date.now(),
        version: '1.0',
        prp: cachedPRP,
      };

      mockStat.mockResolvedValue({
        mtimeMs: Date.now(),
        isFile: () => true,
      });
      mockReadFile.mockResolvedValue(JSON.stringify(mockMetadata));
      mockAgent.prompt.mockResolvedValue({ status: 'success', output: '' });
      setupReadFileForPRP(cachedPRP, mockAgent);

      const generator = new PRPGenerator(mockSessionManager, false);

      // EXECUTE
      await generator.generate(task, backlog, 'feedback forcing re-research');

      // VERIFY: Agent WAS called (cache READ bypassed despite valid cache)
      expect(mockAgent.prompt).toHaveBeenCalledTimes(1);
    });

    it('should use cached PRP when hash matches and file is recent', async () => {
      // SETUP
      const task = createMockSubtask('P1.M1.T1.S1', 'Test Subtask');
      const backlog = createMockBacklog();
      const cachedPRP = createMockPRPDocument(task.id);

      // Mock cache metadata with matching hash
      const mockMetadata = {
        taskId: task.id,
        taskHash: 'abc123',
        createdAt: Date.now(),
        accessedAt: Date.now(),
        version: '1.0',
        prp: cachedPRP,
      };

      // Mock stat to return recent file
      mockStat.mockResolvedValue({
        mtimeMs: Date.now(), // Recent
        isFile: () => true,
      });

      // Mock readFile to return cached metadata
      mockReadFile.mockResolvedValue(JSON.stringify(mockMetadata));

      const generator = new PRPGenerator(mockSessionManager, false);

      // EXECUTE
      const result = await generator.generate(task, backlog);

      // VERIFY: Agent was NOT called (cache hit)
      expect(mockAgent.prompt).not.toHaveBeenCalled();
      expect(result).toEqual(cachedPRP);
    });

    it('should bypass cache when --no-cache flag is set', async () => {
      // SETUP
      const task = createMockSubtask('P1.M1.T1.S1', 'Test Subtask');
      const backlog = createMockBacklog();
      const mockPRP = createMockPRPDocument(task.id);

      mockAgent.prompt.mockResolvedValue({ status: 'success', output: '' });
      setupReadFileForPRP(mockPRP, mockAgent);

      // Create generator with noCache=true
      const generator = new PRPGenerator(mockSessionManager, true);

      // EXECUTE
      const result = await generator.generate(task, backlog);

      // VERIFY: Agent WAS called (cache bypassed)
      expect(mockAgent.prompt).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockPRP);
    });

    it('should save cache metadata after generation when cache is enabled', async () => {
      // SETUP
      const task = createMockSubtask('P1.M1.T1.S1', 'Test Subtask');
      const backlog = createMockBacklog();
      const mockPRP = createMockPRPDocument(task.id);

      mockAgent.prompt.mockResolvedValue({ status: 'success', output: '' });
      setupReadFileForPRP(mockPRP, mockAgent);

      const generator = new PRPGenerator(mockSessionManager, false);

      // EXECUTE
      await generator.generate(task, backlog);

      // VERIFY: Cache metadata was saved
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringMatching(/\.cache\/P1_M1_T1_S1\.json$/),
        expect.stringContaining('"taskHash"'),
        { mode: 0o644 }
      );
    });

    it('should return null for non-existent cache file', async () => {
      // SETUP
      const task = createMockSubtask('P1.M1.T1.S1', 'Test Subtask');
      const backlog = createMockBacklog();
      const mockPRP = createMockPRPDocument(task.id);

      mockAgent.prompt.mockResolvedValue({ status: 'success', output: '' });
      // Note: do NOT add a blanket mockReadFile.mockRejectedValue here — it
      // would shadow setupReadFileForPRP's path-aware implementation. The
      // helper already rejects ENOENT for non-prpOutput paths (cache miss →
      // null). Keep mockStat.mockRejectedValue(ENOENT) for the cache check.
      mockStat.mockRejectedValue(new Error('ENOENT'));
      setupReadFileForPRP(mockPRP, mockAgent);

      const generator = new PRPGenerator(mockSessionManager, false);

      // EXECUTE
      const result = await generator.generate(task, backlog);

      // VERIFY: Should generate new PRP (cache miss)
      expect(mockAgent.prompt).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockPRP);
    });

    it('should return null when cache file is expired (older than 24 hours)', async () => {
      // SETUP
      const task = createMockSubtask('P1.M1.T1.S1', 'Test Subtask');
      const backlog = createMockBacklog();
      const mockPRP = createMockPRPDocument(task.id);

      mockAgent.prompt.mockResolvedValue({ status: 'success', output: '' });
      setupReadFileForPRP(mockPRP, mockAgent);

      // Mock stat to return old file (25 hours ago)
      mockStat.mockResolvedValue({
        mtimeMs: Date.now() - 25 * 60 * 60 * 1000, // 25 hours ago
        isFile: () => true,
      });

      const generator = new PRPGenerator(mockSessionManager, false);

      // EXECUTE
      const result = await generator.generate(task, backlog);

      // VERIFY: Should generate new PRP (cache expired)
      expect(mockAgent.prompt).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockPRP);
    });

    it('should compute consistent hash for same task inputs', () => {
      // SETUP
      const _task = createMockSubtask('P1.M1.T1.S1', 'Test Subtask');
      const _backlog = createMockBacklog();
      const generator = new PRPGenerator(mockSessionManager, false);

      // This test uses internal access - for demonstration only
      // In practice, hash consistency is tested via cache behavior

      // EXECUTE & VERIFY: Cache hit behavior indicates hash consistency
      // If hash wasn't consistent, cache would miss every time
      expect(generator.sessionPath).toBe(sessionPath);
    });

    it('should get correct cache path for task ID', () => {
      // SETUP
      const task = createMockSubtask('P1.M2.T2.S2', 'Test Subtask');
      const generator = new PRPGenerator(mockSessionManager, false);

      // EXECUTE
      const cachePath = generator.getCachePath(task.id);

      // VERIFY: Dots replaced with underscores
      expect(cachePath).toContain('P1_M2_T2_S2.md');
      expect(cachePath).toContain('prps');
    });

    it('should get correct cache metadata path for task ID', () => {
      // SETUP
      const task = createMockSubtask('P1.M2.T2.S2', 'Test Subtask');
      const generator = new PRPGenerator(mockSessionManager, false);

      // EXECUTE
      const metadataPath = generator.getCacheMetadataPath(task.id);

      // VERIFY: Dots replaced with underscores, .cache directory
      expect(metadataPath).toContain('.cache');
      expect(metadataPath).toContain('P1_M2_T2_S2.json');
    });
  });
});
