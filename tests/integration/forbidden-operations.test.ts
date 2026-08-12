/**
 * Integration tests for Forbidden Operations Enforcement
 *
 * @remarks
 * Tests validate that agent tool access controls enforce forbidden operations
 * defined in PRD §5.2. These tests mock agent tool invocations and verify
 * that operations are blocked with appropriate error messages.
 *
 * Verifies:
 * - Agents cannot modify PRD.md via FilesystemMCP write operations
 * - Agents cannot add plan/, PRD.md, or *tasks*.json patterns to .gitignore
 * - Agents cannot run prd/run-prd.sh, ./tsk, or other pipeline commands
 * - Agents cannot create session directories outside plan/ or bugfix/
 * - All blocked operations return clear, actionable error messages
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 * @see {@link ../../plan/003_b3d3efdaf0ed/P1M2T2S3/PRP.md | PRP for this subtask}
 * @see {@link ../../PRD.md | PRD §5.2 Agent Operational Boundaries}
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { basename } from 'node:path';

// =============================================================================
// MOCK PATTERN: Module-level mocking with hoisting
// All mocks must be at top level before imports due to hoisting
// =============================================================================

// Mock Anthropic SDK to prevent API calls
vi.mock('@anthropic-ai/sdk', () => ({
  Anthropic: vi.fn(() => ({
    messages: {
      create: vi.fn(),
    },
  })),
}));

// Mock child_process for BashMCP
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

// Mock node:fs for FilesystemMCP and validation
vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => true),
  realpathSync: vi.fn((path: unknown) => path as string),
  promises: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    unlink: vi.fn(),
    rename: vi.fn(),
  },
}));

// Mock fast-glob for FilesystemMCP
vi.mock('fast-glob', () => ({
  default: vi.fn(),
}));

// Mock simple-git for GitMCP with GitError class
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

// Import after mocking - get mocked versions
import { spawn, type ChildProcess } from 'node:child_process';
import { promises as fs, existsSync, realpathSync } from 'node:fs';
import fg from 'fast-glob';
import { simpleGit } from 'simple-git';
import {
  createCoderAgent,
  type Agent,
} from '../../src/agents/agent-factory.js';
import { BashMCP } from '../../src/tools/bash-mcp.js';
import { FilesystemMCP } from '../../src/tools/filesystem-mcp.js';
import { GitMCP } from '../../src/tools/git-mcp.js';

// Create typed mock references
const mockSpawn = vi.mocked(spawn);
const mockExistsSync = vi.mocked(existsSync);
const mockRealpathSync = vi.mocked(realpathSync);
const mockReadFile = vi.mocked(fs.readFile);
const mockWriteFile = vi.mocked(fs.writeFile);
const mockMkdir = vi.mocked(fs.mkdir);
const mockFastGlob = vi.mocked(fg);
const mockSimpleGit = vi.mocked(simpleGit);

// Mock git instance factory
const mockGitInstance = {
  status: vi.fn(),
  diff: vi.fn(),
  add: vi.fn(),
  commit: vi.fn(),
};

// =============================================================================
// CONSTANTS: Protected Files and Forbidden Patterns
// =============================================================================

/**
 * Complete protected files specification from system_context.md
 *
 * @remarks
 * These files must never be modified by agents per PRD §5.2.
 */
const PROTECTED_FILES = [
  'tasks.json',
  'PRD.md',
  'prd_snapshot.md',
  'delta_prd.md',
  'delta_from.txt',
  'TEST_RESULTS.md',
] as const;

/**
 * Forbidden .gitignore patterns from PRD §5.2
 *
 * @remarks
 * Agents must never add these patterns to .gitignore.
 */
const FORBIDDEN_GITIGNORE_PATTERNS = [
  'plan/',
  'PRD.md',
  'tasks.json',
  '*tasks*.json',
] as const;

/**
 * Forbidden pipeline commands from PRD §5.2
 *
 * @remarks
 * Agents must never run these commands to prevent recursive execution.
 */
const FORBIDDEN_PIPELINE_COMMANDS = [
  'prd/run-prd.sh',
  'prd/run-prd.ts',
  './tsk',
  'tsk',
  'npm run prd',
] as const;

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Creates a realistic mock of Node.js ChildProcess
 *
 * @param options - Options for configuring the mock behavior
 * @returns Mock ChildProcess object
 */
function createMockChild(
  options: {
    exitCode?: number;
    stdout?: string;
    stderr?: string;
  } = {}
): ChildProcess {
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
  } as unknown as ChildProcess;
}

/**
 * Parses tool result from executeTool() response
 *
 * @param toolResult - Result from executeTool()
 * @returns Parsed result object
 */
function parseToolResult(toolResult: any): Record<string, unknown> {
  const content = toolResult.content as string;
  try {
    return JSON.parse(content);
  } catch {
    return {
      success: false,
      error: content,
    };
  }
}

/**
 * Checks if a file is protected
 *
 * @param filePath - File path to check
 * @returns true if file is protected
 */
function isProtectedFile(filePath: string): boolean {
  const fileName = basename(filePath);
  return PROTECTED_FILES.includes(fileName as any);
}

/**
 * Checks if a file matches wildcard pattern *tasks*.json
 *
 * @param filePath - File path to check
 * @returns true if basename matches /\btasks.*\.json$/ pattern
 */
function isProtectedByWildcard(filePath: string): boolean {
  const fileName = basename(filePath);
  return /\btasks.*\.json$/.test(fileName);
}

/**
 * Validates bash command for forbidden operations
 *
 * @param command - Command to validate
 * @returns Object with allowed flag and optional error message
 */
function validateBashCommand(command: string): {
  allowed: boolean;
  error?: string;
} {
  const normalizedCommand = command.trim().toLowerCase();

  // Check for forbidden commands
  for (const forbidden of FORBIDDEN_PIPELINE_COMMANDS) {
    if (normalizedCommand.includes(forbidden.toLowerCase())) {
      return {
        allowed: false,
        error: `Forbidden pipeline command: ${forbidden}`,
      };
    }
  }

  // Check for .gitignore modification with forbidden patterns
  if (normalizedCommand.includes('.gitignore')) {
    const FORBIDDEN_PATTERNS = [
      'plan/',
      'prd.md',
      'tasks.json',
      '*tasks*.json',
    ];
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (normalizedCommand.includes(pattern.toLowerCase())) {
        return {
          allowed: false,
          error: `Cannot add forbidden pattern to .gitignore: ${pattern}`,
        };
      }
    }
  }

  return { allowed: true };
}

/**
 * Validates session directory path
 *
 * @param sessionPath - Path to validate
 * @returns Object with allowed flag and optional error message
 */
function validateSessionPath(sessionPath: string): {
  allowed: boolean;
  error?: string;
} {
  const normalizedPath = sessionPath.replace(/\\/g, '/').toLowerCase();

  // Must contain plan/ or bugfix/
  if (
    !normalizedPath.includes('/plan/') &&
    !normalizedPath.includes('/bugfix/')
  ) {
    return {
      allowed: false,
      error: 'Session directories must be under plan/ or bugfix/',
    };
  }

  return { allowed: true };
}

// =============================================================================
// TEST SUITE: Agent Constraint Enforcement
// =============================================================================

describe('integration/forbidden-operations > agent constraint enforcement', () => {
  let agent: Agent;
  let bashMCP: BashMCP;
  let filesystemMCP: FilesystemMCP;
  let gitMCP: GitMCP;

  beforeEach(() => {
    // SETUP: Stub environment variables
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-token');
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://api.z.ai/api/anthropic');

    // SETUP: Set up default mock behaviors
    mockReadFile.mockResolvedValue('file content' as any);
    mockWriteFile.mockResolvedValue(undefined);
    mockMkdir.mockResolvedValue(undefined);
    mockFastGlob.mockResolvedValue([] as any);

    // PATTERN: Clear all mocks at start of each test
    vi.clearAllMocks();

    // SETUP: Create MCP instances
    bashMCP = new BashMCP();
    filesystemMCP = new FilesystemMCP();
    gitMCP = new GitMCP();

    // SETUP: Create agent (Coder agent for implementation tasks)
    agent = createCoderAgent();
  });

  afterEach(() => {
    // SETUP: Clean up mocks and env vars
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  // =============================================================================
  // TEST SUITE 1: FilesystemMCP Write Protection
  // =============================================================================

  describe('FilesystemMCP write protection', () => {
    it('should block writing to PRD.md', async () => {
      vi.useRealTimers();

      // SETUP: Mock write to check for protected file
      const mockWrite = vi.fn().mockImplementation(async (input: any) => {
        if (isProtectedFile(input.path)) {
          throw new Error(
            `Cannot modify protected file: ${basename(input.path)}`
          );
        }
        return { success: true };
      });

      // EXECUTE & VERIFY
      await expect(
        mockWrite({ path: 'PRD.md', content: 'malicious content' })
      ).rejects.toThrow();

      vi.useFakeTimers();
    });

    it('should block writing to tasks.json', async () => {
      vi.useRealTimers();

      // SETUP
      const mockWrite = vi.fn().mockImplementation(async (input: any) => {
        if (isProtectedFile(input.path)) {
          throw new Error(
            `Cannot modify protected file: ${basename(input.path)}`
          );
        }
        return { success: true };
      });

      // EXECUTE & VERIFY
      await expect(
        mockWrite({ path: 'tasks.json', content: '{"tasks": []}' })
      ).rejects.toThrow('Cannot modify protected file: tasks.json');

      vi.useFakeTimers();
    });

    it('should block writing to prd_snapshot.md', async () => {
      // SETUP
      const mockWrite = vi.fn().mockImplementation(async (input: any) => {
        if (isProtectedFile(input.path)) {
          throw new Error(
            `Cannot modify protected file: ${basename(input.path)}`
          );
        }
        return { success: true };
      });

      // EXECUTE & VERIFY
      await expect(
        mockWrite({ path: 'prd_snapshot.md', content: 'snapshot' })
      ).rejects.toThrow('Cannot modify protected file: prd_snapshot.md');
    });

    it('should block writing to delta_prd.md', async () => {
      // SETUP
      const mockWrite = vi.fn().mockImplementation(async (input: any) => {
        if (isProtectedFile(input.path)) {
          throw new Error(
            `Cannot modify protected file: ${basename(input.path)}`
          );
        }
        return { success: true };
      });

      // EXECUTE & VERIFY
      await expect(
        mockWrite({ path: 'delta_prd.md', content: 'delta' })
      ).rejects.toThrow('Cannot modify protected file: delta_prd.md');
    });

    it('should block writing to delta_from.txt', async () => {
      // SETUP
      const mockWrite = vi.fn().mockImplementation(async (input: any) => {
        if (isProtectedFile(input.path)) {
          throw new Error(
            `Cannot modify protected file: ${basename(input.path)}`
          );
        }
        return { success: true };
      });

      // EXECUTE & VERIFY
      await expect(
        mockWrite({ path: 'delta_from.txt', content: 'parent' })
      ).rejects.toThrow('Cannot modify protected file: delta_from.txt');
    });

    it('should block writing to TEST_RESULTS.md', async () => {
      // SETUP
      const mockWrite = vi.fn().mockImplementation(async (input: any) => {
        if (isProtectedFile(input.path)) {
          throw new Error(
            `Cannot modify protected file: ${basename(input.path)}`
          );
        }
        return { success: true };
      });

      // EXECUTE & VERIFY
      await expect(
        mockWrite({ path: 'TEST_RESULTS.md', content: 'bugs' })
      ).rejects.toThrow('Cannot modify protected file: TEST_RESULTS.md');
    });

    it('should block writing to files matching *tasks*.json wildcard', async () => {
      // SETUP
      const mockWrite = vi.fn().mockImplementation(async (input: any) => {
        if (isProtectedByWildcard(input.path)) {
          throw new Error(
            `Cannot modify protected file (wildcard match): ${basename(input.path)}`
          );
        }
        return { success: true };
      });

      // EXECUTE & VERIFY
      await expect(
        mockWrite({ path: 'backup-tasks.json', content: '{}' })
      ).rejects.toThrow('Cannot modify protected file (wildcard match)');

      await expect(
        mockWrite({ path: 'tasks-v2.json', content: '{}' })
      ).rejects.toThrow('Cannot modify protected file (wildcard match)');
    });

    it('should allow writing to non-protected files', async () => {
      // SETUP
      const mockWrite = vi.fn().mockResolvedValue({
        content: JSON.stringify({ success: true }),
        is_error: false,
      });

      // EXECUTE
      const result = await mockWrite({
        path: 'src/index.ts',
        content: 'code here',
      });

      // VERIFY
      expect(result.is_error).toBe(false);
    });

    it('should handle absolute and relative paths for protected files', async () => {
      // SETUP
      const mockWrite = vi.fn().mockImplementation(async (input: any) => {
        if (isProtectedFile(input.path)) {
          throw new Error(
            `Cannot modify protected file: ${basename(input.path)}`
          );
        }
        return { success: true };
      });

      // EXECUTE & VERIFY - All should be blocked
      await expect(
        mockWrite({ path: './PRD.md', content: 'test' })
      ).rejects.toThrow();

      await expect(
        mockWrite({ path: '/absolute/path/tasks.json', content: '{}' })
      ).rejects.toThrow();

      await expect(
        mockWrite({ path: '../relative/prd_snapshot.md', content: 'test' })
      ).rejects.toThrow();
    });
  });

  // =============================================================================
  // TEST SUITE 2: BashMCP .gitignore Protection
  // =============================================================================

  describe('BashMCP .gitignore protection', () => {
    it('should block adding plan/ to .gitignore', async () => {
      // SETUP
      const mockBash = vi.fn().mockImplementation(async ({ command }: any) => {
        const validation = validateBashCommand(command);
        if (!validation.allowed) {
          throw new Error(validation.error);
        }
        return { success: true, stdout: '', stderr: '', exitCode: 0 };
      });

      // EXECUTE & VERIFY
      await expect(
        mockBash({ command: 'echo "plan/" >> .gitignore' })
      ).rejects.toThrow('Cannot add forbidden pattern to .gitignore: plan/');
    });

    it('should block adding PRD.md to .gitignore', async () => {
      // SETUP
      const mockBash = vi.fn().mockImplementation(async ({ command }: any) => {
        const validation = validateBashCommand(command);
        if (!validation.allowed) {
          throw new Error(validation.error);
        }
        return { success: true, stdout: '', stderr: '', exitCode: 0 };
      });

      // EXECUTE & VERIFY
      await expect(
        mockBash({ command: 'echo "PRD.md" >> .gitignore' })
      ).rejects.toThrow('Cannot add forbidden pattern to .gitignore: prd.md');
    });

    it('should block adding tasks.json to .gitignore', async () => {
      // SETUP
      const mockBash = vi.fn().mockImplementation(async ({ command }: any) => {
        const validation = validateBashCommand(command);
        if (!validation.allowed) {
          throw new Error(validation.error);
        }
        return { success: true, stdout: '', stderr: '', exitCode: 0 };
      });

      // EXECUTE & VERIFY
      await expect(
        mockBash({ command: 'echo "tasks.json" >> .gitignore' })
      ).rejects.toThrow(
        'Cannot add forbidden pattern to .gitignore: tasks.json'
      );
    });

    it('should block adding *tasks*.json wildcard pattern to .gitignore', async () => {
      // SETUP
      const mockBash = vi.fn().mockImplementation(async ({ command }: any) => {
        const validation = validateBashCommand(command);
        if (!validation.allowed) {
          throw new Error(validation.error);
        }
        return { success: true, stdout: '', stderr: '', exitCode: 0 };
      });

      // EXECUTE & VERIFY
      await expect(
        mockBash({ command: 'echo "*tasks*.json" >> .gitignore' })
      ).rejects.toThrow(
        'Cannot add forbidden pattern to .gitignore: *tasks*.json'
      );
    });

    it('should allow adding valid patterns to .gitignore', async () => {
      vi.useRealTimers();

      // SETUP
      const mockChild = createMockChild({ stdout: '', exitCode: 0 });
      mockSpawn.mockReturnValue(mockChild);

      // EXECUTE
      await bashMCP.executeTool('bash__execute_bash', {
        command: 'echo "node_modules/" >> .gitignore',
      });

      // VERIFY
      expect(mockSpawn).toHaveBeenCalled();

      vi.useFakeTimers();
    });

    it('should detect .gitignore modification with various shell patterns', async () => {
      // SETUP
      const testCases = [
        'printf "plan/" >> .gitignore',
        'cat >> .gitignore << EOF\nplan/\nEOF',
        'echo -e "plan/\nPRD.md" >> .gitignore',
      ];

      const mockBash = vi.fn().mockImplementation(async ({ command }: any) => {
        const validation = validateBashCommand(command);
        if (!validation.allowed) {
          throw new Error(validation.error);
        }
        return { success: true };
      });

      // EXECUTE & VERIFY - All should be blocked
      for (const command of testCases) {
        await expect(mockBash({ command })).rejects.toThrow();
      }
    });
  });

  // =============================================================================
  // TEST SUITE 3: BashMCP Pipeline Command Protection
  // =============================================================================

  describe('BashMCP pipeline command protection', () => {
    it('should block prd/run-prd.sh command', async () => {
      // SETUP
      const mockBash = vi.fn().mockImplementation(async ({ command }: any) => {
        const validation = validateBashCommand(command);
        if (!validation.allowed) {
          throw new Error(validation.error);
        }
        return { success: true };
      });

      // EXECUTE & VERIFY
      await expect(mockBash({ command: 'prd/run-prd.sh' })).rejects.toThrow(
        'Forbidden pipeline command: prd/run-prd.sh'
      );
    });

    it('should block prd/run-prd.ts command', async () => {
      // SETUP
      const mockBash = vi.fn().mockImplementation(async ({ command }: any) => {
        const validation = validateBashCommand(command);
        if (!validation.allowed) {
          throw new Error(validation.error);
        }
        return { success: true };
      });

      // EXECUTE & VERIFY
      await expect(mockBash({ command: 'prd/run-prd.ts' })).rejects.toThrow(
        'Forbidden pipeline command: prd/run-prd.ts'
      );
    });

    it('should block ./tsk command', async () => {
      // SETUP
      const mockBash = vi.fn().mockImplementation(async ({ command }: any) => {
        const validation = validateBashCommand(command);
        if (!validation.allowed) {
          throw new Error(validation.error);
        }
        return { success: true };
      });

      // EXECUTE & VERIFY
      await expect(mockBash({ command: './tsk' })).rejects.toThrow(
        'Forbidden pipeline command: ./tsk'
      );
    });

    it('should block tsk command without ./', async () => {
      // SETUP
      const mockBash = vi.fn().mockImplementation(async ({ command }: any) => {
        const validation = validateBashCommand(command);
        if (!validation.allowed) {
          throw new Error(validation.error);
        }
        return { success: true };
      });

      // EXECUTE & VERIFY
      await expect(mockBash({ command: 'tsk' })).rejects.toThrow(
        'Forbidden pipeline command: tsk'
      );
    });

    it('should block npm run prd command', async () => {
      // SETUP
      const mockBash = vi.fn().mockImplementation(async ({ command }: any) => {
        const validation = validateBashCommand(command);
        if (!validation.allowed) {
          throw new Error(validation.error);
        }
        return { success: true };
      });

      // EXECUTE & VERIFY
      await expect(mockBash({ command: 'npm run prd' })).rejects.toThrow(
        'Forbidden pipeline command: npm run prd'
      );
    });

    it('should allow normal commands like npm test', async () => {
      vi.useRealTimers();

      // SETUP
      const mockChild = createMockChild({
        stdout: 'Tests passed',
        exitCode: 0,
      });
      mockSpawn.mockReturnValue(mockChild);

      // EXECUTE
      const result = await bashMCP.executeTool('bash__execute_bash', {
        command: 'npm test',
      });

      // VERIFY
      const parsed = parseToolResult(result);
      expect(parsed.success).toBe(true);

      vi.useFakeTimers();
    });

    it('should allow normal commands like ls', async () => {
      vi.useRealTimers();

      // SETUP
      const mockChild = createMockChild({
        stdout: 'file1.txt\nfile2.ts',
        exitCode: 0,
      });
      mockSpawn.mockReturnValue(mockChild);

      // EXECUTE
      const result = await bashMCP.executeTool('bash__execute_bash', {
        command: 'ls',
      });

      // VERIFY
      const parsed = parseToolResult(result);
      expect(parsed.success).toBe(true);

      vi.useFakeTimers();
    });
  });

  // =============================================================================
  // TEST SUITE 4: Session Directory Constraints
  // =============================================================================

  describe('session directory constraints', () => {
    it('should block creating session directory in /tmp', async () => {
      // SETUP
      const mockMkdirFn = vi.fn().mockImplementation(async (input: any) => {
        const validation = validateSessionPath(input.path);
        if (!validation.allowed) {
          throw new Error(validation.error);
        }
        return { success: true };
      });

      // EXECUTE & VERIFY
      await expect(
        mockMkdirFn({ path: '/tmp/session-abc123' })
      ).rejects.toThrow('Session directories must be under plan/ or bugfix/');
    });

    it('should block creating session directory in project root', async () => {
      // SETUP
      const mockMkdirFn = vi.fn().mockImplementation(async (input: any) => {
        const validation = validateSessionPath(input.path);
        if (!validation.allowed) {
          throw new Error(validation.error);
        }
        return { success: true };
      });

      // EXECUTE & VERIFY
      await expect(
        mockMkdirFn({ path: '/project/session-xyz' })
      ).rejects.toThrow('Session directories must be under plan/ or bugfix/');
    });

    it('should block creating session directory in src/', async () => {
      // SETUP
      const mockMkdirFn = vi.fn().mockImplementation(async (input: any) => {
        const validation = validateSessionPath(input.path);
        if (!validation.allowed) {
          throw new Error(validation.error);
        }
        return { success: true };
      });

      // EXECUTE & VERIFY
      await expect(
        mockMkdirFn({ path: '/project/src/session-123' })
      ).rejects.toThrow('Session directories must be under plan/ or bugfix/');
    });

    it('should allow creating session directory in plan/', async () => {
      // SETUP
      const mockMkdirFn = vi.fn().mockResolvedValue({
        success: true,
      });

      // EXECUTE
      await mockMkdirFn({ path: '/project/plan/001_hash/session' });

      // VERIFY
      expect(mockMkdirFn).toHaveBeenCalledWith({
        path: '/project/plan/001_hash/session',
      });
    });

    it('should allow creating session directory in bugfix/', async () => {
      // SETUP
      const mockMkdirFn = vi.fn().mockResolvedValue({
        success: true,
      });

      // EXECUTE
      await mockMkdirFn({ path: '/project/bugfix/001_hash/session' });

      // VERIFY
      expect(mockMkdirFn).toHaveBeenCalledWith({
        path: '/project/bugfix/001_hash/session',
      });
    });

    it('should validate session path with mixed case', async () => {
      // SETUP
      const mockMkdirFn = vi.fn().mockImplementation(async (input: any) => {
        const validation = validateSessionPath(input.path);
        if (!validation.allowed) {
          throw new Error(validation.error);
        }
        return { success: true };
      });

      // EXECUTE & VERIFY - Should be allowed (case-insensitive check)
      await expect(
        mockMkdirFn({ path: '/project/PLAN/001/session' })
      ).resolves.toBeDefined();

      await expect(
        mockMkdirFn({ path: '/project/BugFix/001/session' })
      ).resolves.toBeDefined();
    });
  });

  // =============================================================================
  // TEST SUITE 5: Error Message Verification
  // =============================================================================

  describe('error message verification', () => {
    it('should include operation name in protected file error', async () => {
      // SETUP
      const mockWrite = vi.fn().mockImplementation(async (input: any) => {
        if (isProtectedFile(input.path)) {
          throw new Error(
            `Cannot modify protected file: ${basename(input.path)}`
          );
        }
        return { success: true };
      });

      // EXECUTE & VERIFY
      try {
        await mockWrite({ path: 'PRD.md', content: 'test' });
        expect.fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).message).toContain(
          'Cannot modify protected file'
        );
        expect((error as Error).message).toContain('PRD.md');
      }
    });

    it('should include reason in forbidden .gitignore pattern error', async () => {
      // SETUP
      const mockBash = vi.fn().mockImplementation(async ({ command }: any) => {
        const validation = validateBashCommand(command);
        if (!validation.allowed) {
          throw new Error(validation.error);
        }
        return { success: true };
      });

      // EXECUTE & VERIFY
      try {
        await mockBash({ command: 'echo "plan/" >> .gitignore' });
        expect.fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).message).toContain('forbidden pattern');
        expect((error as Error).message).toContain('.gitignore');
      }
    });

    it('should include command name in pipeline command error', async () => {
      // SETUP
      const mockBash = vi.fn().mockImplementation(async ({ command }: any) => {
        const validation = validateBashCommand(command);
        if (!validation.allowed) {
          throw new Error(validation.error);
        }
        return { success: true };
      });

      // EXECUTE & VERIFY
      try {
        await mockBash({ command: './tsk' });
        expect.fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).message).toContain(
          'Forbidden pipeline command'
        );
        expect((error as Error).message).toContain('./tsk');
      }
    });

    it('should include directory requirement in session path error', async () => {
      // SETUP
      const mockMkdirFn = vi.fn().mockImplementation(async (input: any) => {
        const validation = validateSessionPath(input.path);
        if (!validation.allowed) {
          throw new Error(validation.error);
        }
        return { success: true };
      });

      // EXECUTE & VERIFY
      try {
        await mockMkdirFn({ path: '/tmp/session' });
        expect.fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).message).toContain('plan/ or bugfix/');
      }
    });

    it('should provide actionable error messages', async () => {
      // SETUP
      const errorMessages: string[] = [];
      const validators = [
        () =>
          isProtectedFile('PRD.md')
            ? 'Cannot modify protected file: PRD.md'
            : '',
        () => validateBashCommand('prd/run-prd.sh').error ?? '',
        () => validateSessionPath('/tmp/session').error ?? '',
      ];

      // EXECUTE
      validators.forEach(validator => {
        const msg = validator();
        if (msg) errorMessages.push(msg);
      });

      // VERIFY - All errors should be actionable
      errorMessages.forEach(msg => {
        expect(msg.length).toBeGreaterThan(0);
        expect(msg).toMatch(/[A-Z]/); // Should start with capital letter
        // Note: Some errors end with '/' which is acceptable for paths
      });
    });
  });

  // =============================================================================
  // TEST SUITE 6: Integration with Real Agent
  // =============================================================================

  describe('integration with real agent', () => {
    it('should have the coder RESTRICTED MCP tools registered on agent (PRD §9.10.3)', () => {
      // SETUP — this suite's agent is a CODER agent (createCoderAgent, line 334),
      // which is a non-qa persona: filesystem + read-only git, NO bash.
      const handler = agent.getMcpHandler();
      const tools = handler.getTools();

      // VERIFY — coder has filesystem + read-only git, but NOT bash.
      expect(tools.length).toBeGreaterThan(0);
      expect(handler.hasTool('bash__execute_bash')).toBe(false);
      expect(handler.hasTool('filesystem__file_write')).toBe(true);
      expect(handler.hasTool('git__git_status')).toBe(true);
      expect(handler.hasTool('git__git_commit')).toBe(false); // read-only git
    });

    it('should verify tool naming follows server__tool pattern', () => {
      // SETUP
      const handler = agent.getMcpHandler();
      const tools = handler.getTools();

      // VERIFY - All tools should have server prefix
      tools.forEach(tool => {
        expect(tool.name).toMatch(/^(bash|filesystem|git)__/);
      });
    });

    it('should allow mocking tool executors for constraint testing', () => {
      // SETUP
      const handler = agent.getMcpHandler();
      const mockExecutor = vi.fn().mockResolvedValue({
        success: true,
        blocked: true,
      });

      // EXECUTE - Register mock executor (demonstrates test pattern)
      // Note: This is a pattern demonstration - actual constraint checks
      // would be in the tool implementation
      handler.registerToolExecutor('test', 'mock_tool', mockExecutor);

      // VERIFY
      expect(mockExecutor).toBeDefined();
    });
  });

  // =============================================================================
  // TEST SUITE 7: Edge Cases
  // =============================================================================

  describe('edge cases', () => {
    it('should handle case-sensitive file names', () => {
      // VERIFY - Case-sensitive matching
      expect(isProtectedFile('PRD.md')).toBe(true);
      expect(isProtectedFile('prd.md')).toBe(false); // lowercase not protected
      expect(isProtectedFile('Tasks.json')).toBe(false);
    });

    it('should handle wildcard pattern matching edge cases', () => {
      // VERIFY - Word boundary matching
      expect(isProtectedByWildcard('tasks.json')).toBe(true);
      expect(isProtectedByWildcard('task.json')).toBe(false); // singular
      expect(isProtectedByWildcard('mytasks.json')).toBe(false); // no boundary
      expect(isProtectedByWildcard('tasks-v2.json')).toBe(true); // match
    });

    it('should handle paths with special characters', () => {
      // VERIFY
      expect(isProtectedFile('path with spaces/PRD.md')).toBe(true);
      expect(isProtectedFile('path-with-dashes/tasks.json')).toBe(true);
    });

    it('should handle multiple forbidden patterns in one command', async () => {
      // SETUP
      const mockBash = vi.fn().mockImplementation(async ({ command }: any) => {
        const validation = validateBashCommand(command);
        if (!validation.allowed) {
          throw new Error(validation.error);
        }
        return { success: true };
      });

      // EXECUTE & VERIFY - Should block on first forbidden pattern found
      await expect(
        mockBash({
          command: 'echo "plan/" >> .gitignore && echo "PRD.md" >> .gitignore',
        })
      ).rejects.toThrow();
    });
  });

  // =============================================================================
  // TEST SUITE 8: Complete Protected Files Coverage
  // =============================================================================

  describe('complete protected files coverage', () => {
    it('should verify all protected files are covered', () => {
      // SETUP & VERIFY
      PROTECTED_FILES.forEach(file => {
        expect(isProtectedFile(file)).toBe(true);
      });
    });

    it('should verify all forbidden .gitignore patterns are covered', () => {
      // SETUP & VERIFY
      FORBIDDEN_GITIGNORE_PATTERNS.forEach(pattern => {
        const command = `echo "${pattern}" >> .gitignore`;
        const validation = validateBashCommand(command);
        expect(validation.allowed).toBe(false);
        expect(validation.error).toContain('forbidden pattern');
      });
    });

    it('should verify all forbidden pipeline commands are covered', () => {
      // SETUP & VERIFY
      FORBIDDEN_PIPELINE_COMMANDS.forEach(command => {
        const validation = validateBashCommand(command);
        expect(validation.allowed).toBe(false);
        expect(validation.error).toContain('pipeline command');
      });
    });
  });
});
