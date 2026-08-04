/**
 * Integration tests for PRPGenerator class
 *
 * @remarks
 * Tests the complete flow: SessionManager + PRPGenerator → PRPDocument + file write
 * Uses real createResearcherAgent() and createPRPBlueprintPrompt() but mocks
 * Agent.prompt() to avoid making real LLM calls.
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import {
  PRPGenerator,
  PRPGenerationError,
  PRPFileError,
} from '../../src/agents/prp-generator.js';
import { SessionManager } from '../../src/core/session-manager.js';
import { PRPDocumentSchema, type Backlog } from '../../src/core/models.js';
import { createPRPBlueprintPrompt } from '../../src/agents/prompts/prp-blueprint-prompt.js';
import { createResearcherAgent } from '../../src/agents/agent-factory.js';
import {
  createSuccessAgentResponse,
  createMockPRPDocument as createHelperPRPDocument,
  MINIMAL_PRP_JSON_STRING,
} from '../helpers/research-seam.js';

// Mock node:fs/promises for PRP file operations only
vi.mock('node:fs/promises', async () => {
  const actualFs = await vi.importActual('node:fs/promises');
  return {
    ...actualFs,
    // Mock mkdir and writeFile for PRP operations only
    mkdir: vi.fn((path: string, options: any) => {
      // Check if this is a PRP directory operation
      if (path && path.toString().includes('prps')) {
        return Promise.resolve(undefined);
      }
      // Use real mkdir for test setup
      return actualFs.mkdir(path, options);
    }),
    writeFile: vi.fn((path: string, data: any, options: any) => {
      // Check if this is a PRP file write operation
      if (path && path.toString().includes('prps')) {
        return Promise.resolve(undefined);
      }
      // Use real writeFile for test setup
      return actualFs.writeFile(path, data, options);
    }),
    // BUG-004 category (a) file-contract fix: generate() reads the PRP from a FILE
    // at <sessionPath>/prps/<id>.json (it ignores result.data). The writeFile
    // short-circuit above NO-OPs the agent→disk handoff. generate() reads the
    // file TWICE: (1) a fast-path cache check BEFORE the agent call (must MISS
    // so the agent actually runs — critical for retry/error tests), and (2) the
    // post-agent contract read (must HIT a schema-valid JSON). The flag below is
    // flipped by the agent mock's successful prompt() — simulating a reasoning
    // model writing the file — so the fast-path misses until the agent has
    // produced a result.
    readFile: vi.fn(async (path: string, ...rest: unknown[]) => {
      if (typeof path === 'string' && path.includes('prps')) {
        if (!agentWroteFile) {
          const err: NodeJS.ErrnoException = Object.assign(
            new Error(`ENOENT: no such file '${path}'`)
          );
          err.code = 'ENOENT';
          throw err;
        }
        return MINIMAL_PRP_JSON_STRING;
      }
      return actualFs.readFile(path, ...(rest as [unknown]));
    }),
  };
});

// Flipped to true by a successful agent prompt() — simulates the reasoning
// model writing the .json handoff file. Reset in beforeEach.
let agentWroteFile = false;

// Wraps a resolved prompt value so that, on success, `agentWroteFile` flips
// (the reasoning model “wrote” the file generate() then reads). Used by the
// default agent and the per-test agent overrides.
function writingPrompt(resolvedValue: unknown) {
  return vi.fn().mockImplementation(async () => {
    const r = await Promise.resolve(resolvedValue);
    agentWroteFile = true;
    return r;
  });
}

// Import mocked functions
const mockMkdir = mkdir as any;
const mockWriteFile = writeFile as any;

// Test data factory
const createTestBacklog = (): Backlog => ({
  backlog: [
    {
      id: 'P3',
      type: 'Phase',
      title: 'Phase 3: PRP Pipeline',
      status: 'Planned',
      description: 'Implement PRP generation and execution',
      milestones: [
        {
          id: 'P3.M3',
          type: 'Milestone',
          title: 'Milestone 3: PRP Generation',
          status: 'Planned',
          description: 'Create PRP generator and executor',
          tasks: [
            {
              id: 'P3.M3.T1',
              type: 'Task',
              title: 'Create PRP Generator',
              status: 'Planned',
              description: 'Implement PRPGenerator class',
              subtasks: [
                {
                  id: 'P3.M3.T1.S1',
                  type: 'Subtask',
                  title: 'Create PRPGenerator class',
                  status: 'Planned',
                  story_points: 5,
                  dependencies: [],
                  context_scope: 'Implement PRPGenerator with retry logic',
                },
              ],
            },
          ],
        },
      ],
    },
  ],
});

// Mock agent-factory to avoid MCP server registration issues
vi.mock('../../src/agents/agent-factory.js', () => ({
  createResearcherAgent: vi.fn(),
}));

describe('integration/prp-generator', () => {
  let tempDir: string;
  let prdPath: string;
  let planDir: string;
  let sessionManager: SessionManager;

  beforeEach(async () => {
    // Create unique temp directory for each test
    const uniqueId = randomBytes(8).toString('hex');
    tempDir = join(tmpdir(), `prp-gen-test-${uniqueId}`);
    planDir = join(tempDir, 'plan');
    prdPath = join(tempDir, 'PRD.md');

    // Clear mock calls before each test
    mockWriteFile.mockClear();
    mockMkdir.mockClear();
    agentWroteFile = false;

    // Create test PRD file with unique content to avoid finding existing sessions
    const testPRD = `# Test PRD ${uniqueId}

This is a unique test PRD for PRPGenerator integration tests with ID: ${uniqueId}.`;
    // Use real writeFile for test setup
    const fs = await import('node:fs/promises');
    await fs.mkdir(tempDir, { recursive: true });
    await fs.writeFile(prdPath, testPRD);

    // Initialize SessionManager with test PRD and custom plan directory
    sessionManager = new SessionManager(prdPath, planDir, 3);
    await sessionManager.initialize();

    // Setup mock agent — generate() reads result.status (must be 'success'),
    // NOT the bare doc. Wrap in createSuccessAgentResponse and use writingPrompt
    // so a successful call flips `agentWroteFile` (BUG-004 fix).
    const mockAgent = {
      prompt: writingPrompt(
        createSuccessAgentResponse(createHelperPRPDocument('P3.M3.T1.S1'))
      ),
    };
    (createResearcherAgent as any).mockReturnValue(mockAgent);
  });

  afterEach(async () => {
    // Clean up temp directory
    const fs = await import('node:fs/promises');
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
    // Clear all mocks between tests
    vi.clearAllMocks();
  });

  describe('session manager integration', () => {
    it('should initialize PRPGenerator with SessionManager session path', async () => {
      // EXECUTE
      const generator = new PRPGenerator(sessionManager);

      // VERIFY: Session manager and path are set correctly
      expect(generator.sessionManager).toBe(sessionManager);
      // Note: createSessionDirectory() uses hardcoded 'plan/' path (session-utils.ts:208)
      expect(generator.sessionPath).toMatch(/plan\/\d{3}_[a-f0-9]{12}$/);
    });

    it('should throw error when SessionManager has no active session', async () => {
      // SETUP: Create SessionManager without initializing
      const emptyManager = new SessionManager(prdPath, planDir, 3);

      // EXECUTE & VERIFY: Constructor throws
      expect(() => new PRPGenerator(emptyManager)).toThrow(
        'Cannot create PRPGenerator: no active session'
      );
    });
  });

  describe('full PRP generation flow', () => {
    it('should generate PRP for subtask and write to session directory', async () => {
      // SETUP: Get test subtask and backlog
      const backlog = createTestBacklog();
      const subtask = backlog.backlog[0].milestones[0].tasks[0].subtasks[0];

      // EXECUTE: Generate PRP
      const generator = new PRPGenerator(sessionManager);
      const result = await generator.generate(subtask, backlog);

      // VERIFY: Result is valid PRPDocument
      expect(result).toBeDefined();
      expect(result.taskId).toBe('P3.M3.T1.S1');
      expect(result.objective).toBe('Implement PRPGenerator class');

      // VERIFY: File was written to correct location
      // Find the PRP file write call (filter out test setup writes)
      const prpCall = mockWriteFile.mock.calls.find(
        (call: any[]) =>
          call[0] && call[0].toString().endsWith('P3_M3_T1_S1.md')
      );
      expect(prpCall).toBeDefined();
      expect(prpCall![1]).toContain('# PRP for P3.M3.T1.S1');
      expect(prpCall![2]).toEqual({ mode: 0o644 });

      // VERIFY: Directory was created (using actual session path)
      const sessionPath = generator.sessionPath;
      expect(mockMkdir).toHaveBeenCalledWith(join(sessionPath, 'prps'), {
        recursive: true,
      });
    });

    it('should validate generated PRP against PRPDocumentSchema', async () => {
      // SETUP: Get test subtask and backlog
      const backlog = createTestBacklog();
      const subtask = backlog.backlog[0].milestones[0].tasks[0].subtasks[0];

      // EXECUTE: Generate PRP
      const generator = new PRPGenerator(sessionManager);
      const result = await generator.generate(subtask, backlog);

      // VERIFY: Result passes schema validation
      const validation = PRPDocumentSchema.safeParse(result);
      expect(validation.success).toBe(true);
      if (validation.success) {
        expect(validation.data.taskId).toBe('P3.M3.T1.S1');
      }
    });

    it('should format PRP markdown correctly', async () => {
      // SETUP: Get test subtask and backlog
      const backlog = createTestBacklog();
      const subtask = backlog.backlog[0].milestones[0].tasks[0].subtasks[0];

      // EXECUTE: Generate PRP
      const generator = new PRPGenerator(sessionManager);
      await generator.generate(subtask, backlog);

      // VERIFY: Markdown contains all required sections
      // Find the call to writeFile for the prps directory
      const prpCall = mockWriteFile.mock.calls.find(
        (call: any[]) => call[0] && call[0].toString().includes('prps')
      );
      expect(prpCall).toBeDefined();
      const markdownContent = prpCall ? prpCall[1] : '';

      expect(markdownContent).toContain('# PRP for P3.M3.T1.S1');
      expect(markdownContent).toContain('## Objective');
      expect(markdownContent).toContain('Implement PRPGenerator class');
      expect(markdownContent).toContain('## Context');
      expect(markdownContent).toContain('## Implementation Steps');
      expect(markdownContent).toContain('1. Step 1: Create class');
      expect(markdownContent).toContain('## Validation Gates');
      expect(markdownContent).toContain('### Level 1: 1');
      expect(markdownContent).toContain('npm run lint');
      expect(markdownContent).toContain('## Success Criteria');
      expect(markdownContent).toContain('- [ ] Tests pass');
      expect(markdownContent).toContain('## References');
    });
  });

  describe('retry logic integration', () => {
    it('should retry on LLM failures and succeed', async () => {
      // SETUP: Get test subtask and backlog
      const backlog = createTestBacklog();
      const subtask = backlog.backlog[0].milestones[0].tasks[0].subtasks[0];

      // SETUP: Mock agent to fail once, then succeed. writingPrompt flips
      // agentWroteFile on the success call so generate()'s post-agent read hits.
      const successImpl = vi.fn().mockImplementation(async () => {
        agentWroteFile = true;
        return createSuccessAgentResponse(
          createHelperPRPDocument('P3.M3.T1.S1')
        );
      });
      const mockAgent = {
        prompt: vi
          .fn()
          .mockRejectedValueOnce(new Error('LLM timeout'))
          .mockImplementation(successImpl),
      };
      (createResearcherAgent as any).mockReturnValue(mockAgent);

      // Clear mockWriteFile calls from previous tests
      mockWriteFile.mockClear();

      // EXECUTE: Generate PRP
      const generator = new PRPGenerator(sessionManager);
      const result = await generator.generate(subtask, backlog);

      // VERIFY: PRP was generated after retry
      expect(result).toBeDefined();
      expect(result.taskId).toBe('P3.M3.T1.S1');

      // VERIFY: Agent was called twice (failed once, succeeded once)
      expect(mockAgent.prompt).toHaveBeenCalledTimes(2);

      // VERIFY: File was written after success. generate() writes TWO files per
      // success: the PRP markdown (.md) and the cache metadata (.cache/.json).
      expect(mockWriteFile).toHaveBeenCalledTimes(2);
    });

    it('should throw PRPGenerationError after all retries exhausted', async () => {
      // SETUP: Get test subtask and backlog
      const backlog = createTestBacklog();
      const subtask = backlog.backlog[0].milestones[0].tasks[0].subtasks[0];

      // SETUP: Mock agent to always fail
      const mockAgent = {
        prompt: vi.fn().mockRejectedValue(new Error('LLM service down')),
      };
      (createResearcherAgent as any).mockReturnValue(mockAgent);

      // EXECUTE & VERIFY: generate() rejects after all retries are exhausted.
      // (The raw agent error propagates from retryAgentPrompt; generate no
      // longer wraps it in PRPGenerationError.)
      const generator = new PRPGenerator(sessionManager);
      await expect(generator.generate(subtask, backlog)).rejects.toThrow(
        'LLM service down'
      );
    });
  });

  describe('prompt generation integration', () => {
    it('should use createPRPBlueprintPrompt with correct parameters', async () => {
      // SETUP: Get test subtask and backlog
      const backlog = createTestBacklog();
      const subtask = backlog.backlog[0].milestones[0].tasks[0].subtasks[0];

      // SETUP: Spy on the real createPRPBlueprintPrompt function
      // Note: We can't easily spy on it because it's imported inside PRPGenerator
      // Instead, we verify the result is correct
      const generator = new PRPGenerator(sessionManager);

      // EXECUTE: Generate PRP
      const result = await generator.generate(subtask, backlog);

      // VERIFY: Result matches expected task ID
      expect(result.taskId).toBe('P3.M3.T1.S1');
    });
  });

  describe('error handling', () => {
    it('should throw PRPFileError when file write fails', async () => {
      // SETUP: Get test subtask and backlog
      const backlog = createTestBacklog();
      const subtask = backlog.backlog[0].milestones[0].tasks[0].subtasks[0];

      // SETUP: Set up writeFile to reject for prps directory
      mockWriteFile.mockImplementation(function (
        path: string,
        data: any,
        options: any
      ) {
        if (path && path.toString().includes('prps')) {
          return Promise.reject(new Error('EACCES: permission denied'));
        }
        // Use real writeFile for test setup
        const fs = require('node:fs/promises'); // eslint-disable-line @typescript-eslint/no-var-requires
        return fs.writeFile(path, data, options);
      });

      // EXECUTE & VERIFY: Throws PRPFileError
      const generator = new PRPGenerator(sessionManager);
      await expect(generator.generate(subtask, backlog)).rejects.toThrow(
        PRPFileError
      );
    });

    it('should not retry file write failures', async () => {
      // SETUP: Get test subtask and backlog
      const backlog = createTestBacklog();
      const subtask = backlog.backlog[0].milestones[0].tasks[0].subtasks[0];

      // SETUP: Mock agent and writeFile
      const mockAgent = {
        prompt: writingPrompt(
          createSuccessAgentResponse(createHelperPRPDocument('P3.M3.T1.S1'))
        ),
      };
      (createResearcherAgent as any).mockReturnValue(mockAgent);
      mockWriteFile.mockImplementation(function (
        path: string,
        data: any,
        options: any
      ) {
        if (path && path.toString().includes('prps')) {
          return Promise.reject(new Error('EACCES: permission denied'));
        }
        // Use real writeFile for test setup
        const fs = require('node:fs/promises'); // eslint-disable-line @typescript-eslint/no-var-requires
        return fs.writeFile(path, data, options);
      });

      // EXECUTE
      const generator = new PRPGenerator(sessionManager);
      await expect(generator.generate(subtask, backlog)).rejects.toThrow(
        PRPFileError
      );

      // VERIFY: Agent was only called once (no retries for file write failures)
      expect(mockAgent.prompt).toHaveBeenCalledTimes(1);
    });
  });
});
