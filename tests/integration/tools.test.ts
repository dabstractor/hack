/**
 * Integration tests for MCP Tools
 *
 * @remarks
 * Tests validate the executeTool() interface for all MCP tool classes
 * (BashMCP, FilesystemMCP, GitMCP) with all system operations mocked
 * to prevent real execution during testing.
 *
 * These integration tests validate:
 * 1. MCP tool classes correctly integrate with Groundswell MCPHandler
 * 2. Tool executors are properly registered and invocable via executeTool()
 * 3. System operations are safely mocked to prevent side effects
 * 4. Tool result formats match expected schemas
 * 5. Timeout and error handling work correctly
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// =============================================================================
// MOCK PATTERN: Module-level mocking with hoisting
// All mocks must be at top level before imports due to hoisting
// =============================================================================

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
import { simpleGit, GitError } from 'simple-git';
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
function parseToolResult(toolResult: any) {
  // executeTool() returns ToolResult with content as JSON string
  // When there's an error, content might be a plain string
  const content = toolResult.content as string;
  try {
    return JSON.parse(content);
  } catch {
    // If content is not JSON, it's an error message
    // Return a synthetic error result
    return {
      success: false,
      error: content,
    };
  }
}

// =============================================================================
// TEST SUITE: BashMCP.executeTool()
// =============================================================================

describe('BashMCP.executeTool', () => {
  let bashMCP: BashMCP;

  beforeEach(() => {
    bashMCP = new BashMCP();
    mockExistsSync.mockReturnValue(true);
    mockRealpathSync.mockImplementation((path: unknown) => path as string);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should execute bash command via executeTool() and return result', async () => {
    vi.useRealTimers(); // Use real timers for mock child timing

    // SETUP
    const mockChild = createMockChild({ stdout: 'hello world', exitCode: 0 });
    mockSpawn.mockReturnValue(mockChild);

    // EXECUTE - executeTool takes ('server__tool', input)
    const toolResult = await bashMCP.executeTool('bash__execute_bash', {
      command: 'echo hello world',
    });
    const result = parseToolResult(toolResult);

    // VERIFY
    expect(result.success).toBe(true);
    expect(result.stdout).toBe('hello world');
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
    expect(result.error).toBeUndefined();

    // Verify spawn was called correctly
    expect(mockSpawn).toHaveBeenCalledWith(
      'echo hello world',
      expect.objectContaining({
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    );

    vi.useFakeTimers(); // Restore fake timers for other tests
  });

  it('should execute bash command with cwd via executeTool()', async () => {
    vi.useRealTimers(); // Use real timers for mock child timing

    // SETUP
    const mockChild = createMockChild({ stdout: 'output', exitCode: 0 });
    mockSpawn.mockReturnValue(mockChild);
    mockExistsSync.mockReturnValue(true);
    mockRealpathSync.mockImplementation(
      (path: unknown) => '/real/path' as string
    );

    // EXECUTE
    const toolResult = await bashMCP.executeTool('bash__execute_bash', {
      command: 'ls',
      cwd: '/some/path',
    });
    const result = parseToolResult(toolResult);

    // VERIFY
    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);

    // Verify spawn was called with cwd
    expect(mockSpawn).toHaveBeenCalledWith(
      'ls',
      expect.objectContaining({
        cwd: '/real/path',
      })
    );

    vi.useFakeTimers(); // Restore fake timers for other tests
  });

  it('should handle timeout correctly with SIGTERM then SIGKILL', async () => {
    vi.useRealTimers(); // Use real timers for timeout testing

    // SETUP - Create a child that never closes
    let closeCallback: ((code: number) => void) | null = null;
    let childKilled = false;
    const killCalls: string[] = [];
    const stubbornChild = {
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn((event: string, callback: any) => {
        if (event === 'close') closeCallback = callback;
      }),
      kill: vi.fn((signal: string) => {
        killCalls.push(signal);
        childKilled = signal === 'SIGKILL';
      }),
      get killed() {
        return childKilled;
      },
    } as any;
    mockSpawn.mockReturnValue(stubbornChild);

    // EXECUTE - start command
    const resultPromise = bashMCP.executeTool('bash__execute_bash', {
      command: 'stubborn',
      timeout: 100,
    });

    // Wait for initial timeout + SIGKILL grace period
    await new Promise(resolve => setTimeout(resolve, 2250));

    // VERIFY - both SIGTERM and SIGKILL should be called
    expect(killCalls).toContain('SIGTERM');
    expect(killCalls).toContain('SIGKILL');

    // Clean up - trigger close to resolve promise
    if (closeCallback) {
      closeCallback(137); // SIGKILL exit code
    }
    await resultPromise;

    vi.useFakeTimers(); // Restore fake timers for other tests
  });

  it('should handle command that returns non-zero exit code', async () => {
    vi.useRealTimers(); // Use real timers for mock child timing

    // SETUP
    const mockChild = createMockChild({
      stdout: 'some output',
      stderr: 'error message',
      exitCode: 1,
    });
    mockSpawn.mockReturnValue(mockChild);

    // EXECUTE
    const toolResult = await bashMCP.executeTool('bash__execute_bash', {
      command: 'failing-command',
    });
    const result = parseToolResult(toolResult);

    vi.useFakeTimers(); // Restore fake timers for other tests

    // VERIFY
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.error).toBe('Command failed with exit code 1');
  });

  it('should handle spawn error (command not found)', async () => {
    vi.useRealTimers(); // Use real timers for mock child timing

    // SETUP - spawn throws synchronously
    const spawnError = new Error('spawnENOENT: ENOENT');
    (spawnError as any).code = 'ENOENT';
    mockSpawn.mockImplementation(() => {
      throw spawnError;
    });

    // EXECUTE
    const toolResult = await bashMCP.executeTool('bash__execute_bash', {
      command: 'nonexistent-command',
    });
    const result = parseToolResult(toolResult);

    // VERIFY
    expect(result.success).toBe(false);
    expect(result.exitCode).toBeNull();
    expect(result.error).toBe(spawnError.message);

    vi.useFakeTimers(); // Restore fake timers for other tests
  });

  it('should handle working directory not found', async () => {
    // SETUP
    mockExistsSync.mockReturnValue(false);

    // EXECUTE
    const toolResult = await bashMCP.executeTool('bash__execute_bash', {
      command: 'echo test',
      cwd: '/nonexistent',
    });
    const result = parseToolResult(toolResult);

    // VERIFY
    expect(result.success).toBe(false);
    expect(result.error).toContain('Working directory does not exist');
  });
});

// =============================================================================
// TEST SUITE: FilesystemMCP.executeTool()
// =============================================================================

describe('FilesystemMCP.executeTool', () => {
  let fsMCP: FilesystemMCP;

  beforeEach(() => {
    fsMCP = new FilesystemMCP();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('file_read tool', () => {
    it('should read file with encoding via executeTool()', async () => {
      // SETUP
      const content = 'file content here';
      mockReadFile.mockResolvedValue(content as any);

      // EXECUTE
      const toolResult = await fsMCP.executeTool('filesystem__file_read', {
        path: './test.txt',
        encoding: 'utf-8',
      });
      const result = parseToolResult(toolResult);

      // VERIFY
      expect(result.success).toBe(true);
      expect(result.content).toBe(content);
      expect(result.error).toBeUndefined();
      expect(mockReadFile).toHaveBeenCalledWith(expect.any(String), {
        encoding: 'utf-8',
      });
    });

    it('should handle file not found error', async () => {
      // SETUP
      const error = new Error('File not found') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      mockReadFile.mockRejectedValue(error);

      // EXECUTE
      const toolResult = await fsMCP.executeTool('filesystem__file_read', {
        path: './nonexistent.txt',
      });
      const result = parseToolResult(toolResult);

      // VERIFY
      expect(result.success).toBe(false);
      expect(result.error).toContain('File not found');
    });

    it('should handle permission denied error', async () => {
      // SETUP
      const error = new Error('Permission denied') as NodeJS.ErrnoException;
      error.code = 'EACCES';
      mockReadFile.mockRejectedValue(error);

      // EXECUTE
      const toolResult = await fsMCP.executeTool('filesystem__file_read', {
        path: './protected.txt',
      });
      const result = parseToolResult(toolResult);

      // VERIFY
      expect(result.success).toBe(false);
      expect(result.error).toContain('Permission denied');
    });
  });

  describe('file_write tool', () => {
    it('should write file content via executeTool()', async () => {
      // SETUP
      mockWriteFile.mockResolvedValue(undefined);

      // EXECUTE
      const toolResult = await fsMCP.executeTool('filesystem__file_write', {
        path: './output.txt',
        content: 'Hello, World!',
      });
      const result = parseToolResult(toolResult);

      // VERIFY
      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
      expect(mockWriteFile).toHaveBeenCalled();
    });

    it('should create directories when createDirs is true', async () => {
      // SETUP
      mockMkdir.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);

      // EXECUTE
      const toolResult = await fsMCP.executeTool('filesystem__file_write', {
        path: './deep/path/file.txt',
        content: 'content',
        createDirs: true,
      });
      const result = parseToolResult(toolResult);

      // VERIFY
      expect(result.success).toBe(true);
      expect(mockMkdir).toHaveBeenCalledWith(expect.any(String), {
        recursive: true,
      });
      expect(mockWriteFile).toHaveBeenCalled();
    });

    it('should not create directories when createDirs is false', async () => {
      // SETUP
      mockWriteFile.mockResolvedValue(undefined);

      // EXECUTE
      const toolResult = await fsMCP.executeTool('filesystem__file_write', {
        path: './output.txt',
        content: 'content',
        createDirs: false,
      });
      const result = parseToolResult(toolResult);

      // VERIFY
      expect(result.success).toBe(true);
      expect(mockMkdir).not.toHaveBeenCalled();
      expect(mockWriteFile).toHaveBeenCalled();
    });
  });

  describe('glob_files tool', () => {
    it('should match glob patterns via executeTool()', async () => {
      // SETUP
      const matches = ['/path/to/file1.ts', '/path/to/file2.ts'];
      mockFastGlob.mockResolvedValue(matches as any);

      // EXECUTE
      const toolResult = await fsMCP.executeTool('filesystem__glob_files', {
        pattern: '**/*.ts',
      });
      const result = parseToolResult(toolResult);

      // VERIFY
      expect(result.success).toBe(true);
      expect(result.matches).toEqual(matches);
      expect(mockFastGlob).toHaveBeenCalledWith('**/*.ts', {
        absolute: true,
        onlyFiles: true,
        cwd: expect.any(String),
      });
    });

    it('should use custom cwd when provided', async () => {
      // SETUP
      mockFastGlob.mockResolvedValue([] as any);

      // EXECUTE
      await fsMCP.executeTool('filesystem__glob_files', {
        pattern: '**/*.js',
        cwd: './src',
      });

      // VERIFY
      expect(mockFastGlob).toHaveBeenCalledWith('**/*.js', {
        absolute: true,
        onlyFiles: true,
        cwd: expect.stringContaining('src'),
      });
    });
  });

  describe('grep_search tool', () => {
    it('should search file content with regex via executeTool()', async () => {
      // SETUP
      const content = 'line 1\nimport x\nline 3';
      mockReadFile.mockResolvedValue(content as any);

      // EXECUTE
      const toolResult = await fsMCP.executeTool('filesystem__grep_search', {
        path: './test.txt',
        pattern: 'import',
      });
      const result = parseToolResult(toolResult);

      // VERIFY
      expect(result.success).toBe(true);
      expect(result.matches).toEqual([{ line: 2, content: 'import x' }]);
    });

    it('should return multiple matches', async () => {
      // SETUP
      const content = 'import foo\nimport bar\nexport baz';
      mockReadFile.mockResolvedValue(content as any);

      // EXECUTE
      const toolResult = await fsMCP.executeTool('filesystem__grep_search', {
        path: './test.txt',
        pattern: 'import',
      });
      const result = parseToolResult(toolResult);

      // VERIFY
      expect(result.success).toBe(true);
      expect(result.matches).toHaveLength(2);
      expect(result.matches).toEqual([
        { line: 1, content: 'import foo' },
        { line: 2, content: 'import bar' },
      ]);
    });

    it('should handle case-insensitive search with flags', async () => {
      // SETUP
      const content = 'IMPORT\nimport\nImport';
      mockReadFile.mockResolvedValue(content as any);

      // EXECUTE
      const toolResult = await fsMCP.executeTool('filesystem__grep_search', {
        path: './test.txt',
        pattern: 'import',
        flags: 'i',
      });
      const result = parseToolResult(toolResult);

      // VERIFY
      expect(result.success).toBe(true);
      expect(result.matches).toHaveLength(3);
    });

    it('should handle invalid regex pattern', async () => {
      // SETUP - content doesn't matter for invalid regex
      mockReadFile.mockResolvedValue('content' as any);

      // EXECUTE
      const toolResult = await fsMCP.executeTool('filesystem__grep_search', {
        path: './test.txt',
        pattern: '[invalid(', // Invalid regex
      });
      const result = parseToolResult(toolResult);

      // VERIFY
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid regex pattern');
    });
  });
});

// =============================================================================
// TEST SUITE: GitMCP.executeTool()
// =============================================================================

describe('GitMCP.executeTool', () => {
  let gitMCP: GitMCP;

  beforeEach(() => {
    gitMCP = new GitMCP();
    mockExistsSync.mockReturnValue(true);
    mockRealpathSync.mockImplementation((path: unknown) => path as string);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('git_status tool', () => {
    it('should return git status with all file types via executeTool()', async () => {
      // SETUP
      mockGitInstance.status.mockResolvedValue({
        current: 'main',
        files: [
          { path: 'src/index.ts', index: 'M', working_dir: ' ' },
          { path: 'src/utils.ts', index: ' ', working_dir: 'M' },
          { path: 'newfile.txt', index: '?', working_dir: '?' },
        ],
        isClean: () => false,
      } as never);

      // EXECUTE
      const toolResult = await gitMCP.executeTool('git__git_status', {
        path: './test-repo',
      });
      const result = parseToolResult(toolResult);

      // VERIFY
      expect(result.success).toBe(true);
      expect(result.branch).toBe('main');
      expect(result.staged).toEqual(['src/index.ts']);
      expect(result.modified).toEqual(['src/utils.ts']);
      expect(result.untracked).toEqual(['newfile.txt']);
    });

    it('should handle clean repository', async () => {
      // SETUP
      mockGitInstance.status.mockResolvedValue({
        current: 'develop',
        files: [],
        isClean: () => true,
      } as never);

      // EXECUTE
      const toolResult = await gitMCP.executeTool('git__git_status', {
        path: './clean-repo',
      });
      const result = parseToolResult(toolResult);

      // VERIFY
      expect(result.success).toBe(true);
      expect(result.branch).toBe('develop');
      expect(result.staged).toBeUndefined();
      expect(result.modified).toBeUndefined();
      expect(result.untracked).toBeUndefined();
    });

    it('should handle GitError', async () => {
      // SETUP
      mockGitInstance.status.mockRejectedValue(
        new GitError('Not a git repository')
      );

      // EXECUTE
      const toolResult = await gitMCP.executeTool('git__git_status', {
        path: './not-a-repo',
      });
      const result = parseToolResult(toolResult);

      // VERIFY
      expect(result.success).toBe(false);
      expect(result.error).toBe('Not a git repository');
    });

    it('should validate repository path exists', async () => {
      // SETUP
      mockExistsSync.mockReturnValue(false);

      // EXECUTE
      const toolResult = await gitMCP.executeTool('git__git_status', {
        path: './nonexistent',
      });
      const result = parseToolResult(toolResult);

      // VERIFY
      expect(result.success).toBe(false);
      expect(result.error).toContain('Repository path not found');
    });

    it('should validate .git directory exists', async () => {
      // SETUP - Return true for path but false for .git check
      mockExistsSync.mockImplementation(path => {
        if (typeof path === 'string' && path.endsWith('.git')) {
          return false;
        }
        return true;
      });

      // EXECUTE
      const toolResult = await gitMCP.executeTool('git__git_status', {
        path: './not-a-git-repo',
      });
      const result = parseToolResult(toolResult);

      // VERIFY
      expect(result.success).toBe(false);
      expect(result.error).toContain('Not a git repository');
    });
  });

  describe('git_commit tool', () => {
    it('should create commit with message via executeTool()', async () => {
      // SETUP
      mockGitInstance.commit.mockResolvedValue({
        commit: 'abc123def456',
        branch: 'main',
      } as never);

      // EXECUTE
      const toolResult = await gitMCP.executeTool('git__git_commit', {
        path: './test-repo',
        message: 'Test commit',
      });
      const result = parseToolResult(toolResult);

      // VERIFY
      expect(result.success).toBe(true);
      expect(result.commitHash).toBe('abc123def456');
      expect(result.error).toBeUndefined();
      expect(mockGitInstance.commit).toHaveBeenCalledWith(
        'Test commit',
        [],
        {}
      );
    });

    it('should create commit with allowEmpty option', async () => {
      // SETUP
      mockGitInstance.commit.mockResolvedValue({
        commit: 'empty123',
        branch: 'main',
      } as never);

      // EXECUTE
      const toolResult = await gitMCP.executeTool('git__git_commit', {
        path: './test-repo',
        message: 'Empty commit',
        allowEmpty: true,
      });
      const result = parseToolResult(toolResult);

      // VERIFY
      expect(result.success).toBe(true);
      expect(result.commitHash).toBe('empty123');
      expect(mockGitInstance.commit).toHaveBeenCalledWith('Empty commit', [], {
        '--allow-empty': true,
      });
    });

    it('should reject empty commit message', async () => {
      // EXECUTE
      const toolResult = await gitMCP.executeTool('git__git_commit', {
        path: './test-repo',
        message: '   ', // Whitespace only
      });
      const result = parseToolResult(toolResult);

      // VERIFY
      expect(result.success).toBe(false);
      expect(result.error).toContain('Commit message is required');
      expect(mockGitInstance.commit).not.toHaveBeenCalled();
    });

    it('should handle "nothing to commit" error', async () => {
      // SETUP
      const error = new Error('nothing to commit');
      mockGitInstance.commit.mockRejectedValue(error);

      // EXECUTE
      const toolResult = await gitMCP.executeTool('git__git_commit', {
        path: './test-repo',
        message: 'Test commit',
      });
      const result = parseToolResult(toolResult);

      // VERIFY
      expect(result.success).toBe(false);
      expect(result.error).toContain('No changes staged for commit');
    });

    it('should handle merge conflict error', async () => {
      // SETUP
      const error = new Error('merge conflict');
      mockGitInstance.commit.mockRejectedValue(error);

      // EXECUTE
      const toolResult = await gitMCP.executeTool('git__git_commit', {
        path: './test-repo',
        message: 'Test commit',
      });
      const result = parseToolResult(toolResult);

      // VERIFY
      expect(result.success).toBe(false);
      expect(result.error).toContain(
        'Cannot commit with unresolved merge conflicts'
      );
    });
  });
});
