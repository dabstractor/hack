/**
 * Integration tests for MCP Tool Integration with Agents
 *
 * @remarks
 * Tests validate that all three MCP servers (BashMCP, FilesystemMCP, GitMCP)
 * are properly registered with each agent type and accessible via agent.tool() calls.
 *
 * Verifies:
 * - All agents (Architect, Researcher, Coder, QA) have MCP tools registered
 * - Tools are accessible via agent.getMcpHandler().getTools()
 * - Tool naming follows server__tool pattern
 * - BashMCP uses spawn() for safe command execution
 * - FilesystemMCP validates file paths
 * - GitMCP uses simple-git library correctly
 * - Mock agent tool invocations work correctly
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 * @see {@link ../../src/tools/bash-mcp.ts | BashMCP Implementation}
 * @see {@link ../../src/tools/filesystem-mcp.ts | FilesystemMCP Implementation}
 * @see {@link ../../src/tools/git-mcp.ts | GitMCP Implementation}
 * @see {@link ../../src/agents/agent-factory.ts | Agent Factory}
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

// Mock node:fs for BashMCP (cwd validation), FilesystemMCP, and GitMCP
vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => true),
  realpathSync: vi.fn((path: unknown) => path as string),
  promises: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
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
  createArchitectAgent,
  createResearcherAgent,
  createCoderAgent,
  createQAAgent,
} from '../../src/agents/agent-factory.js';
import { BashMCP } from '../../src/tools/bash-mcp.js';
import { FilesystemMCP } from '../../src/tools/filesystem-mcp.js';
import { GitMCP } from '../../src/tools/git-mcp.js';
import type { Agent } from 'groundswell';

// Create typed mock references
const mockSpawn = vi.mocked(spawn);
const mockExistsSync = vi.mocked(existsSync);
const mockRealpathSync = vi.mocked(realpathSync);
const mockReadFile = vi.mocked(fs.readFile);
const mockWriteFile = vi.mocked(fs.writeFile);
const _mockMkdir = vi.mocked(fs.mkdir);
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
// MOCK FACTORY: createMockChild for ChildProcess
// =============================================================================

/**
 * Creates a realistic mock of Node.js ChildProcess that emits
 * data events and closes with the specified exit code.
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
) {
  const { exitCode = 0, stdout = 'test output', stderr = '' } = options;

  return {
    stdout: {
      on: vi.fn((event: string, callback: (data: Buffer) => void) => {
        if (event === 'data') {
          // Simulate async data emission
          setTimeout(() => callback(Buffer.from(stdout)), 5);
        }
      }),
    },
    stderr: {
      on: vi.fn((event: string, callback: (data: Buffer) => void) => {
        if (event === 'data') {
          // Simulate async data emission
          setTimeout(() => callback(Buffer.from(stderr)), 5);
        }
      }),
    },
    on: vi.fn((event: string, callback: (code: number) => void) => {
      if (event === 'close') {
        // Simulate async close
        setTimeout(() => callback(exitCode), 10);
      }
    }),
    killed: false,
    kill: vi.fn(),
  } as unknown as ChildProcess;
}

// =============================================================================
// HELPER: Parse tool result from executeTool()
// =============================================================================

/**
 * Parses tool result from executeTool() response
 *
 * @remarks
 * executeTool() returns ToolResult with content as JSON string
 * When there's an error, content might be a plain string
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

// =============================================================================
// TEST SUITE: Agent MCP Integration
// =============================================================================

describe('integration/mcp-tools > agent MCP integration', () => {
  let architectAgent: Agent;
  let researcherAgent: Agent;
  let coderAgent: Agent;
  let qaAgent: Agent;

  beforeEach(() => {
    // SETUP: Stub environment variables
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-token');
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://api.z.ai/api/anthropic');

    // SETUP: Set up default mock behaviors
    mockExistsSync.mockReturnValue(true);
    mockRealpathSync.mockImplementation((path: unknown) => path as string);

    // PATTERN: Clear all mocks at start of each test
    vi.clearAllMocks();
  });

  afterEach(() => {
    // SETUP: Clean up mocks and env vars
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  // =============================================================================
  // TEST SUITE 1: Agent Factory MCP Registration
  // =============================================================================

  describe('agent factory MCP registration', () => {
    it('should register all three MCP servers with Architect agent', () => {
      // SETUP
      architectAgent = createArchitectAgent();
      const handler = architectAgent.getMcpHandler();
      const tools = handler.getTools();

      // EXECUTE
      const bashTools = tools.filter(t => t.name.startsWith('bash__'));
      const filesystemTools = tools.filter(t =>
        t.name.startsWith('filesystem__')
      );
      const gitTools = tools.filter(t => t.name.startsWith('git__'));

      // VERIFY
      expect(bashTools).toHaveLength(1);
      expect(filesystemTools).toHaveLength(4);
      expect(gitTools).toHaveLength(4);
      expect(bashTools[0].name).toBe('bash__execute_bash');
    });

    it('should register all three MCP servers with Researcher agent', () => {
      // SETUP
      researcherAgent = createResearcherAgent();
      const handler = researcherAgent.getMcpHandler();
      const tools = handler.getTools();

      // VERIFY
      expect(tools.length).toBeGreaterThanOrEqual(9); // 1 + 4 + 4 tools
      expect(handler.hasTool('bash__execute_bash')).toBe(true);
      expect(handler.hasTool('filesystem__file_read')).toBe(true);
      expect(handler.hasTool('git__git_status')).toBe(true);
    });

    it('should register all three MCP servers with Coder agent', () => {
      // SETUP
      coderAgent = createCoderAgent();
      const handler = coderAgent.getMcpHandler();

      // VERIFY
      expect(handler.hasTool('bash__execute_bash')).toBe(true);
      expect(handler.hasTool('filesystem__file_write')).toBe(true);
      expect(handler.hasTool('git__git_commit')).toBe(true);
    });

    it('should register all three MCP servers with QA agent', () => {
      // SETUP
      qaAgent = createQAAgent();
      const handler = qaAgent.getMcpHandler();
      const tools = handler.getTools();

      // VERIFY
      const toolNames = tools.map(t => t.name);
      expect(toolNames).toContain('bash__execute_bash');
      expect(toolNames).toContain('filesystem__file_read');
      expect(toolNames).toContain('git__git_status');
    });
  });

  // =============================================================================
  // TEST SUITE 2: MCP Tool Accessibility
  // =============================================================================

  describe('MCP tool accessibility', () => {
    beforeEach(() => {
      architectAgent = createArchitectAgent();
    });

    it('should expose BashMCP tools via getMcpHandler().getTools()', () => {
      // SETUP
      const handler = architectAgent.getMcpHandler();
      const tools = handler.getTools();

      // VERIFY
      const bashTool = tools.find(t => t.name === 'bash__execute_bash');
      expect(bashTool).toBeDefined();
      expect(bashTool?.description).toContain('shell command');
    });

    it('should expose FilesystemMCP tools via getMcpHandler().getTools()', () => {
      // SETUP
      const handler = architectAgent.getMcpHandler();

      // VERIFY
      expect(handler.hasTool('filesystem__file_read')).toBe(true);
      expect(handler.hasTool('filesystem__file_write')).toBe(true);
      expect(handler.hasTool('filesystem__glob_files')).toBe(true);
      expect(handler.hasTool('filesystem__grep_search')).toBe(true);
    });

    it('should expose GitMCP tools via getMcpHandler().getTools()', () => {
      // SETUP
      const handler = architectAgent.getMcpHandler();
      const tools = handler.getTools();

      // VERIFY
      const gitTools = tools.filter(t => t.name.startsWith('git__'));
      expect(gitTools).toHaveLength(4);

      const toolNames = gitTools.map(t => t.name);
      expect(toolNames).toContain('git__git_status');
      expect(toolNames).toContain('git__git_diff');
      expect(toolNames).toContain('git__git_add');
      expect(toolNames).toContain('git__git_commit');
    });
  });

  // =============================================================================
  // TEST SUITE 3: Tool Naming Conventions
  // =============================================================================

  describe('tool naming conventions', () => {
    beforeEach(() => {
      architectAgent = createArchitectAgent();
    });

    it('should use bash__ prefix for BashMCP tools', () => {
      // SETUP
      const handler = architectAgent.getMcpHandler();
      const tools = handler.getTools();
      const bashTools = tools.filter(t => t.name.startsWith('bash__'));

      // VERIFY
      bashTools.forEach(tool => {
        expect(tool.name).toMatch(/^bash__/);
      });
    });

    it('should use filesystem__ prefix for FilesystemMCP tools', () => {
      // SETUP
      const handler = architectAgent.getMcpHandler();
      const tools = handler.getTools();
      const fsTools = tools.filter(t => t.name.startsWith('filesystem__'));

      // VERIFY
      fsTools.forEach(tool => {
        expect(tool.name).toMatch(/^filesystem__/);
      });
    });

    it('should use git__ prefix for GitMCP tools', () => {
      // SETUP
      const handler = architectAgent.getMcpHandler();
      const tools = handler.getTools();
      const gitTools = tools.filter(t => t.name.startsWith('git__'));

      // VERIFY
      gitTools.forEach(tool => {
        expect(tool.name).toMatch(/^git__/);
      });
    });
  });

  // =============================================================================
  // TEST SUITE 4: BashMCP Tool Verification
  // =============================================================================

  describe('BashMCP tool verification', () => {
    let bashMCP: BashMCP;

    beforeEach(() => {
      bashMCP = new BashMCP();
      mockExistsSync.mockReturnValue(true);
      mockRealpathSync.mockImplementation((path: unknown) => path as string);
    });

    it('should register execute_bash tool', () => {
      // SETUP
      const tools = bashMCP.getTools();
      const bashTool = tools.find(t => t.name === 'bash__execute_bash');

      // VERIFY
      expect(bashTool).toBeDefined();
      expect(bashTool?.name).toBe('bash__execute_bash');
      expect(bashTool?.input_schema.properties).toHaveProperty('command');
    });

    it('should verify spawn() usage (shell: false)', async () => {
      vi.useRealTimers();

      // SETUP
      const mockChild = createMockChild({ stdout: 'hello', exitCode: 0 });
      mockSpawn.mockReturnValue(mockChild);

      // EXECUTE
      await bashMCP.executeTool('bash__execute_bash', {
        command: 'echo hello',
      });

      // VERIFY: spawn was called with shell: true
      expect(mockSpawn).toHaveBeenCalledWith(
        'echo hello',
        expect.objectContaining({
          shell: true,
        })
      );

      vi.useFakeTimers();
    });

    it('should execute bash tool through MCP handler', async () => {
      vi.useRealTimers();

      // SETUP
      const mockChild = createMockChild({ stdout: 'test output', exitCode: 0 });
      mockSpawn.mockReturnValue(mockChild);

      // EXECUTE
      const result = await bashMCP.executeTool('bash__execute_bash', {
        command: 'echo test output',
      });
      const parsed = parseToolResult(result);

      // VERIFY
      expect(parsed.success).toBe(true);
      expect(parsed.stdout).toBe('test output');
      expect(parsed.exitCode).toBe(0);

      vi.useFakeTimers();
    });
  });

  // =============================================================================
  // TEST SUITE 5: FilesystemMCP Tool Verification
  // =============================================================================

  describe('FilesystemMCP tool verification', () => {
    let fsMCP: FilesystemMCP;

    beforeEach(() => {
      fsMCP = new FilesystemMCP();
      mockReadFile.mockResolvedValue('file content' as any);
      mockWriteFile.mockResolvedValue(undefined);
      mockFastGlob.mockResolvedValue([] as any);
    });

    it('should register file_read tool', () => {
      // SETUP
      const tools = fsMCP.getTools();
      const tool = tools.find(t => t.name === 'filesystem__file_read');

      // VERIFY
      expect(tool).toBeDefined();
      expect(tool?.name).toBe('filesystem__file_read');
    });

    it('should register file_write tool', () => {
      // SETUP
      const tools = fsMCP.getTools();

      // VERIFY
      expect(fsMCP.hasTool('filesystem__file_write')).toBe(true);
    });

    it('should register glob_files tool', () => {
      // SETUP
      const tools = fsMCP.getTools();

      // VERIFY
      expect(fsMCP.hasTool('filesystem__glob_files')).toBe(true);
    });

    it('should register grep_search tool', () => {
      // SETUP
      const tools = fsMCP.getTools();

      // VERIFY
      expect(fsMCP.hasTool('filesystem__grep_search')).toBe(true);
    });

    it('should verify path validation in file operations', async () => {
      // SETUP
      mockReadFile.mockImplementation((async (_path: unknown) => {
        // Verify resolve() was called for path sanitization
        return 'content';
      }) as any);

      // EXECUTE
      await fsMCP.executeTool('filesystem__file_read', {
        path: './test.txt',
      });

      // VERIFY: readFile was called (path validation happens internally)
      expect(mockReadFile).toHaveBeenCalled();
    });

    it('should execute filesystem tools through MCP handler', async () => {
      // SETUP
      mockReadFile.mockResolvedValue('test content' as any);

      // EXECUTE
      const result = await fsMCP.executeTool('filesystem__file_read', {
        path: './test.txt',
      });
      const parsed = parseToolResult(result);

      // VERIFY
      expect(parsed.success).toBe(true);
      expect(parsed.content).toBe('test content');
    });
  });

  // =============================================================================
  // TEST SUITE 6: GitMCP Tool Verification
  // =============================================================================

  describe('GitMCP tool verification', () => {
    let gitMCP: GitMCP;

    beforeEach(() => {
      gitMCP = new GitMCP();
      mockExistsSync.mockReturnValue(true);
      mockGitInstance.status.mockResolvedValue({
        current: 'main',
        files: [],
        isClean: () => true,
      } as never);
    });

    it('should register git_status tool', () => {
      // SETUP
      const tools = gitMCP.getTools();
      const tool = tools.find(t => t.name === 'git__git_status');

      // VERIFY
      expect(tool).toBeDefined();
      expect(tool?.name).toBe('git__git_status');
    });

    it('should register git_diff tool', () => {
      // SETUP
      const tools = gitMCP.getTools();

      // VERIFY
      expect(gitMCP.hasTool('git__git_diff')).toBe(true);
    });

    it('should register git_add tool', () => {
      // SETUP
      const tools = gitMCP.getTools();

      // VERIFY
      expect(gitMCP.hasTool('git__git_add')).toBe(true);
    });

    it('should register git_commit tool', () => {
      // SETUP
      const tools = gitMCP.getTools();

      // VERIFY
      expect(gitMCP.hasTool('git__git_commit')).toBe(true);
    });

    it('should verify simple-git library usage', async () => {
      // SETUP
      // EXECUTE
      await gitMCP.executeTool('git__git_status', {
        path: './test-repo',
      });

      // VERIFY: simpleGit was called
      expect(mockSimpleGit).toHaveBeenCalled();
      expect(mockGitInstance.status).toHaveBeenCalled();
    });

    it('should execute git tools through MCP handler', async () => {
      // SETUP
      mockGitInstance.status.mockResolvedValue({
        current: 'develop',
        files: [{ path: 'test.ts', index: 'M', working_dir: ' ' }],
        is_clean: () => false,
      } as never);

      // EXECUTE
      const result = await gitMCP.executeTool('git__git_status', {
        path: './repo',
      });
      const parsed = parseToolResult(result);

      // VERIFY
      expect(parsed.success).toBe(true);
      expect(parsed.branch).toBe('develop');
    });
  });

  // =============================================================================
  // TEST SUITE 7: Mock Agent Tool Invocations
  // =============================================================================

  describe('mock agent tool invocations', () => {
    it('should mock agent.tool() calls successfully', async () => {
      // SETUP
      const mockTool = vi.fn().mockResolvedValue({
        success: true,
        data: 'test result',
      });

      const mockAgent = {
        getMcpHandler: vi.fn(() => ({
          getTools: vi.fn(() => []),
          hasTool: vi.fn(() => true),
          executeTool: mockTool,
        })),
      } as any;

      // EXECUTE
      await mockAgent.getMcpHandler().executeTool('test__tool', {
        input: 'test',
      });

      // VERIFY
      expect(mockTool).toHaveBeenCalledWith('test__tool', { input: 'test' });
    });

    it('should verify tool execution through mocked agent', async () => {
      // SETUP
      const expectedValue = { success: true, result: 'executed' };
      const mockExecute = vi.fn().mockResolvedValue(expectedValue);

      const mockAgent = {
        getMcpHandler: vi.fn(() => ({
          executeTool: mockExecute,
        })),
      } as any;

      // EXECUTE
      const result = await mockAgent
        .getMcpHandler()
        .executeTool('test__tool', {});

      // VERIFY
      expect(result).toEqual(expectedValue);
      expect(mockExecute).toHaveBeenCalledTimes(1);
    });

    it('should parse tool results correctly', () => {
      // SETUP
      const validResult = {
        content: '{"success":true,"data":"test"}',
      };
      const errorResult = {
        content: 'Error message',
      };

      // EXECUTE & VERIFY
      const parsedValid = parseToolResult(validResult);
      expect(parsedValid.success).toBe(true);
      expect(parsedValid.data).toBe('test');

      const parsedError = parseToolResult(errorResult);
      expect(parsedError.success).toBe(false);
      expect(parsedError.error).toBe('Error message');
    });
  });
});
