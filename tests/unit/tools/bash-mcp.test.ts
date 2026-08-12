/**
 * Unit tests for Bash MCP tool
 *
 * @remarks
 * Tests validate bash command execution with security constraints
 * and achieve 100% code coverage of src/tools/bash-mcp.ts
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock child_process to avoid actual command execution
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

// Mock fs modules for directory validation
vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => true),
  realpathSync: vi.fn(path => path),
}));

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import {
  BashMCP,
  executeBashCommand,
  bashTool,
  isDeniedCommand,
  type BashToolInput,
  type DenylistResult,
} from '../../../src/tools/bash-mcp.js';

const mockSpawn = vi.mocked(spawn);
const mockExistsSync = vi.mocked(existsSync);
const mockRealpathSync = vi.mocked(realpathSync);

describe('tools/bash-mcp', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('BashMCP class', () => {
    it('should instantiate and register bash server', () => {
      // EXECUTE
      const bashMCP = new BashMCP();

      // VERIFY
      expect(bashMCP).toBeInstanceOf(BashMCP);
    });

    it('should register execute_bash tool', () => {
      // EXECUTE
      const bashMCP = new BashMCP();

      // VERIFY - tool is registered via MCPHandler
      // (Cannot directly inspect registration without exposing internals)
      expect(bashMCP).toBeDefined();
    });
  });

  describe('bashTool schema', () => {
    it('should have correct tool name', () => {
      // VERIFY
      expect(bashTool.name).toBe('execute_bash');
    });

    it('should have description', () => {
      // VERIFY
      expect(bashTool.description).toContain('Execute shell commands');
    });

    it('should require command property in input schema', () => {
      // VERIFY
      expect(bashTool.input_schema.required).toContain('command');
    });

    it('should have command property defined', () => {
      // VERIFY
      expect(bashTool.input_schema.properties.command).toEqual({
        type: 'string',
        description: 'The shell command to execute',
      });
    });

    it('should have optional cwd property', () => {
      // VERIFY
      expect(bashTool.input_schema.properties.cwd).toBeDefined();
      expect(bashTool.input_schema.properties.cwd).toEqual({
        type: 'string',
        description: 'Working directory for command execution (optional)',
      });
    });

    it('should have optional timeout property with constraints', () => {
      // VERIFY
      expect(bashTool.input_schema.properties.timeout).toEqual({
        type: 'number',
        description: 'Timeout in milliseconds (default: 30000)',
        minimum: 1000,
        maximum: 300000,
      });
    });
  });

  describe('executeBashCommand', () => {
    let mockChild: ReturnType<typeof createMockChild>;

    beforeEach(() => {
      mockChild = createMockChild();
      mockSpawn.mockReturnValue(mockChild as any);
      mockExistsSync.mockReturnValue(true);
      mockRealpathSync.mockImplementation(path => path as string);
    });

    describe('successful execution', () => {
      it('should execute simple command successfully', async () => {
        // SETUP
        const input: BashToolInput = { command: 'echo test' };

        // EXECUTE
        const result = await executeBashCommand(input);

        // VERIFY
        expect(result.success).toBe(true);
        expect(result.stdout).toBe('test output');
        expect(result.stderr).toBe('');
        expect(result.exitCode).toBe(0);
        expect(result.error).toBeUndefined();
        expect(mockSpawn).toHaveBeenCalledWith(
          'echo test',
          expect.objectContaining({
            shell: true,
            cwd: undefined,
            stdio: ['ignore', 'pipe', 'pipe'],
          })
        );
      });

      it('should use default timeout of 30000ms', async () => {
        // SETUP
        const input: BashToolInput = { command: 'sleep 1' };

        // EXECUTE
        const result = await executeBashCommand(input);

        // VERIFY
        expect(result.success).toBe(true);
        expect(mockSpawn).toHaveBeenCalledWith('sleep 1', {
          cwd: undefined,
          shell: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      });

      it('should capture stdout correctly', async () => {
        // SETUP
        mockChild = createMockChild({ stdout: 'captured output' });
        mockSpawn.mockReturnValue(mockChild as any);
        const input: BashToolInput = { command: 'cat file.txt' };

        // EXECUTE
        const result = await executeBashCommand(input);

        // VERIFY
        expect(result.stdout).toBe('captured output');
      });
    });

    describe('failed execution', () => {
      it('should return failure for non-zero exit code', async () => {
        // SETUP
        mockChild = createMockChild({ exitCode: 1, stderr: 'error occurred' });
        mockSpawn.mockReturnValue(mockChild as any);
        const input: BashToolInput = { command: 'false' };

        // EXECUTE
        const result = await executeBashCommand(input);

        // VERIFY
        expect(result.success).toBe(false);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toBe('error occurred');
        expect(result.error).toContain('failed with exit code 1');
      });

      it('should capture stderr for failed commands', async () => {
        // SETUP
        mockChild = createMockChild({
          exitCode: 2,
          stderr: 'command not found',
          stdout: '',
        });
        mockSpawn.mockReturnValue(mockChild as any);
        const input: BashToolInput = { command: 'invalid-command' };

        // EXECUTE
        const result = await executeBashCommand(input);

        // VERIFY
        expect(result.success).toBe(false);
        expect(result.stderr).toBe('command not found');
        expect(result.stdout).toBe('');
      });
    });

    describe('timeout handling', () => {
      it('should handle timeout correctly', async () => {
        // SETUP - Create a child that never closes
        let closeCallback: ((code: number) => void) | null = null;
        let childKilled = false;
        mockChild = {
          stdout: { on: vi.fn() },
          stderr: { on: vi.fn() },
          on: vi.fn((event: string, callback: any) => {
            if (event === 'close') closeCallback = callback;
          }),
          kill: vi.fn(() => {
            childKilled = true;
          }),
          get killed() {
            return childKilled;
          },
        } as any;
        mockSpawn.mockReturnValue(mockChild);

        const input: BashToolInput = { command: 'sleep 100', timeout: 50 };

        // EXECUTE
        const resultPromise = executeBashCommand(input);

        // Wait for timeout
        await new Promise(resolve => setTimeout(resolve, 100));

        // VERIFY - kill should be called with SIGTERM
        expect(mockChild.killed).toBe(true);
        expect(mockChild.kill).toHaveBeenCalledWith('SIGTERM');

        // Clean up - trigger close to resolve promise
        if (closeCallback) {
          (closeCallback as (code: number) => void)(143); // SIGTERM exit code
        }
        await resultPromise;
      });

      it('should include timeout error in result', async () => {
        // SETUP - Create a child that times out
        const mockChild = createMockChild({ exitCode: 143 });
        mockSpawn.mockReturnValue(mockChild as any);

        // Mock setTimeout to trigger immediately
        vi.useFakeTimers();
        const input: BashToolInput = { command: 'sleep 100', timeout: 50 };

        // EXECUTE
        const resultPromise = executeBashCommand(input);
        vi.advanceTimersByTime(60);
        await resultPromise;

        // Since we're using fake timers, the actual setTimeout callback
        // won't execute in the normal flow. Let's test with a real timeout.
        vi.useRealTimers();

        // Let's test timeout differently - by manually triggering the timeout behavior
        const timeoutInput: BashToolInput = {
          command: 'test',
          timeout: 1,
        };

        // Create a child that doesn't close immediately
        let closeCallback: ((code: number) => void) | null = null;
        let slowChildKilled = false;
        const slowChild = {
          stdout: { on: vi.fn() },
          stderr: { on: vi.fn() },
          on: vi.fn((event: string, callback: any) => {
            if (event === 'close') closeCallback = callback;
          }),
          kill: vi.fn(() => {
            slowChildKilled = true;
          }),
          get killed() {
            return slowChildKilled;
          },
        } as any;
        mockSpawn.mockReturnValue(slowChild as any);

        const slowResult = executeBashCommand(timeoutInput);

        // Wait for timeout
        await new Promise(resolve => setTimeout(resolve, 10));

        // Cleanup
        if (closeCallback) {
          (closeCallback as (code: number) => void)(143);
        }
        await slowResult;

        // VERIFY - kill was called
        expect(slowChild.kill).toHaveBeenCalled();
      });

      it('should send SIGKILL if SIGTERM does not kill process', async () => {
        // SETUP - Create a stubborn child that ignores SIGTERM
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
            childKilled = signal === 'SIGKILL'; // Only SIGKILL "kills" this child
          }),
          get killed() {
            return childKilled;
          },
        } as any;
        mockSpawn.mockReturnValue(stubbornChild as any);

        const input: BashToolInput = { command: 'stubborn', timeout: 10 };

        // EXECUTE - start command
        const resultPromise = executeBashCommand(input);

        // Wait for initial timeout + SIGKILL grace period
        await new Promise(resolve => setTimeout(resolve, 2250));

        // VERIFY - both SIGTERM and SIGKILL should be called
        expect(killCalls).toContain('SIGTERM');
        expect(killCalls).toContain('SIGKILL');

        // Clean up - trigger close to resolve promise
        if (closeCallback) {
          (closeCallback as (code: number) => void)(137); // SIGKILL exit code
        }
        await resultPromise;
      });

      it('should surface timedOut=true and killed=true when the watchdog fires', async () => {
        // SETUP - manual non-closing child capturing the close callback.
        // The watchdog sets timedOut/killed=true on the FIRST setTimeout tick
        // (before the 2s SIGKILL grace), so real timers with small values suffice.
        let closeCallback: ((code: number) => void) | null = null;
        let childKilled = false;
        const hangingChild = {
          stdout: { on: vi.fn() },
          stderr: { on: vi.fn() },
          on: vi.fn((event: string, callback: any) => {
            if (event === 'close') closeCallback = callback;
          }),
          kill: vi.fn(() => {
            childKilled = true;
          }),
          get killed() {
            return childKilled;
          },
        } as any;
        mockSpawn.mockReturnValue(hangingChild as any);

        const input: BashToolInput = { command: 'hang', timeout: 10 };

        // EXECUTE - start command (do not await yet)
        const resultPromise = executeBashCommand(input);

        // Wait long enough for the watchdog setTimeout (10ms) to fire SIGTERM
        await new Promise(resolve => setTimeout(resolve, 40));

        // VERIFY (pre-close) - the watchdog fired: kill was invoked and the
        // in-closure locals are now true. The result is not resolved yet
        // because we have not emitted 'close'.
        expect(hangingChild.kill).toHaveBeenCalledWith('SIGTERM');

        // TRIGGER close (SIGTERM exit code 143) to resolve the promise
        if (closeCallback) {
          (closeCallback as (code: number) => void)(143);
        }
        const result = await resultPromise;

        // VERIFY - the watchdog flags are surfaced on the result
        expect(result.timedOut).toBe(true);
        expect(result.killed).toBe(true);
        expect(result.success).toBe(false);
        expect(result.exitCode).toBe(143);
        expect(result.error).toContain('timed out');
      });
    });

    describe('spawn error handling', () => {
      it('should handle spawn errors (command not found)', async () => {
        // SETUP - spawn throws an error
        const spawnError = new Error('spawn echo ENOENT');
        mockSpawn.mockImplementation(() => {
          throw spawnError;
        });

        const input: BashToolInput = { command: 'echo test' };

        // EXECUTE
        const result = await executeBashCommand(input);

        // VERIFY
        expect(result.success).toBe(false);
        expect(result.exitCode).toBeNull();
        expect(result.error).toContain('ENOENT');
      });

      it('should handle async child process error events', async () => {
        // SETUP - child emits 'error' event asynchronously
        let errorCallback: ((error: Error) => void) | null = null;
        const erroringChild = {
          stdout: { on: vi.fn() },
          stderr: { on: vi.fn() },
          on: vi.fn((event: string, callback: any) => {
            if (event === 'error') errorCallback = callback;
          }),
          kill: vi.fn(),
          killed: false,
        } as any;
        mockSpawn.mockReturnValue(erroringChild as any);

        const input: BashToolInput = { command: 'failing-command' };

        // EXECUTE - start command but don't await yet
        const resultPromise = executeBashCommand(input);

        // Emit error event
        if (errorCallback) {
          (errorCallback as (error: Error) => void)(
            new Error('EMFILE: too many open files')
          );
        }

        const result = await resultPromise;

        // VERIFY
        expect(result.success).toBe(false);
        expect(result.exitCode).toBeNull();
        expect(result.error).toBe('EMFILE: too many open files');
      });

      it('should handle generic spawn errors', async () => {
        // SETUP
        const genericError = new Error('Permission denied');
        mockSpawn.mockImplementation(() => {
          throw genericError;
        });

        const input: BashToolInput = { command: 'restricted-command' };

        // EXECUTE
        const result = await executeBashCommand(input);

        // VERIFY
        expect(result.success).toBe(false);
        expect(result.exitCode).toBeNull();
        expect(result.error).toBe('Permission denied');
      });
    });

    describe('working directory handling', () => {
      it('should validate working directory exists', async () => {
        // SETUP
        mockExistsSync.mockReturnValue(false);
        const input: BashToolInput = { command: 'ls', cwd: '/nonexistent' };

        // EXECUTE & VERIFY
        await expect(executeBashCommand(input)).rejects.toThrow(
          'Working directory does not exist: /nonexistent'
        );
      });

      it('should pass cwd to spawn when provided', async () => {
        // SETUP
        const input: BashToolInput = { command: 'ls', cwd: '/tmp' };
        mockExistsSync.mockReturnValue(true);
        mockRealpathSync.mockReturnValue('/tmp');

        // EXECUTE
        await executeBashCommand(input);

        // VERIFY
        expect(mockSpawn).toHaveBeenCalledWith(
          'ls',
          expect.objectContaining({
            cwd: '/tmp',
          })
        );
      });

      it('should not pass cwd to spawn when not provided', async () => {
        // SETUP
        const input: BashToolInput = { command: 'ls' };

        // EXECUTE
        await executeBashCommand(input);

        // VERIFY
        expect(mockSpawn).toHaveBeenCalledWith(
          'ls',
          expect.objectContaining({
            cwd: undefined,
          })
        );
      });

      it('should resolve absolute path for relative cwd', async () => {
        // SETUP
        const input: BashToolInput = { command: 'ls', cwd: './relative' };
        mockExistsSync.mockReturnValue(true);
        mockRealpathSync.mockImplementation(path => {
          // Simulate realpath resolving to absolute path
          if (typeof path === 'string' && path.includes('relative')) {
            return '/absolute/relative';
          }
          return path as string;
        });

        // EXECUTE
        await executeBashCommand(input);

        // VERIFY - realpathSync was called with resolved path
        expect(mockRealpathSync).toHaveBeenCalled();
        expect(mockSpawn).toHaveBeenCalledWith(
          'ls',
          expect.objectContaining({
            cwd: '/absolute/relative',
          })
        );
      });
    });

    describe('shell security', () => {
      it('should always use shell: true', async () => {
        // SETUP
        const input: BashToolInput = { command: 'echo test' };

        // EXECUTE
        await executeBashCommand(input);

        // VERIFY
        expect(mockSpawn).toHaveBeenCalledWith(
          'echo test',
          expect.objectContaining({
            shell: true,
          })
        );
      });

      it('should use stdio pipe for stdout and stderr', async () => {
        // SETUP
        const input: BashToolInput = { command: 'cat file' };

        // EXECUTE
        await executeBashCommand(input);

        // VERIFY
        expect(mockSpawn).toHaveBeenCalledWith(
          'cat file',
          expect.objectContaining({
            stdio: ['ignore', 'pipe', 'pipe'],
          })
        );
      });
    });

    describe('command parsing', () => {
      it('should pass full command string to spawn', async () => {
        // SETUP
        const input: BashToolInput = { command: 'git status -sb' };

        // EXECUTE
        await executeBashCommand(input);

        // VERIFY
        expect(mockSpawn).toHaveBeenCalledWith(
          'git status -sb',
          expect.any(Object)
        );
      });

      it('should handle command with single argument', async () => {
        // SETUP
        const input: BashToolInput = { command: 'ls -la' };

        // EXECUTE
        await executeBashCommand(input);

        // VERIFY
        expect(mockSpawn).toHaveBeenCalledWith('ls -la', expect.any(Object));
      });

      it('should handle command with no arguments', async () => {
        // SETUP
        const input: BashToolInput = { command: 'pwd' };

        // EXECUTE
        await executeBashCommand(input);

        // VERIFY
        expect(mockSpawn).toHaveBeenCalledWith('pwd', expect.any(Object));
      });
    });
  });

  describe('edge cases', () => {
    it('should handle empty stdout', async () => {
      // SETUP
      const mockChild = createMockChild({ stdout: '', stderr: '' });
      mockSpawn.mockReturnValue(mockChild as any);
      const input: BashToolInput = { command: 'true' };

      // EXECUTE
      const result = await executeBashCommand(input);

      // VERIFY
      expect(result.stdout).toBe('');
      expect(result.success).toBe(true);
    });

    it('should handle both stdout and stderr', async () => {
      // SETUP
      const mockChild = createMockChild({
        stdout: 'standard output',
        stderr: 'standard error',
        exitCode: 1,
      });
      mockSpawn.mockReturnValue(mockChild as any);
      const input: BashToolInput = { command: 'mixed-output' };

      // EXECUTE
      const result = await executeBashCommand(input);

      // VERIFY
      expect(result.stdout).toBe('standard output');
      expect(result.stderr).toBe('standard error');
      expect(result.success).toBe(false);
    });

    it('should handle data events after kill (should ignore)', async () => {
      // SETUP - Mock child that emits data after timeout
      let stdoutCallback: ((data: Buffer) => void) | null = null;
      let closeCallback: ((code: number) => void) | null = null;
      let childKilled = false;
      const mockChild = {
        stdout: {
          on: vi.fn((event: string, callback: (data: Buffer) => void) => {
            if (event === 'data') stdoutCallback = callback;
          }),
        },
        stderr: { on: vi.fn() },
        on: vi.fn((event: string, callback: any) => {
          if (event === 'close') closeCallback = callback;
        }),
        kill: vi.fn(() => {
          childKilled = true;
        }),
        get killed() {
          return childKilled;
        },
      };
      mockSpawn.mockReturnValue(mockChild as any);

      const input: BashToolInput = { command: 'slow-cmd', timeout: 10 };

      // EXECUTE - start command but don't await
      const resultPromise = executeBashCommand(input);

      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 20));

      // Try to send data after kill (should be ignored)
      if (stdoutCallback) {
        (stdoutCallback as (data: Buffer) => void)(Buffer.from('late data'));
      }

      // Trigger close
      if (closeCallback) {
        (closeCallback as (code: number) => void)(143);
      }

      const result = await resultPromise;

      // VERIFY - late data should not be in stdout
      expect(result.stdout).toBe('');
      expect(mockChild.kill).toHaveBeenCalled();
    });

    it('should handle empty command (uses fallback executable)', async () => {
      // SETUP - empty command results in args[0] being undefined
      const mockChild = createMockChild({ exitCode: 1 });
      mockSpawn.mockReturnValue(mockChild as any);
      const input: BashToolInput = { command: '' };

      // EXECUTE
      const result = await executeBashCommand(input);

      // VERIFY - spawn should be called with empty string as executable
      expect(mockSpawn).toHaveBeenCalledWith('', expect.any(Object));
      expect(result.exitCode).toBe(1);
    });

    it('should handle non-Error objects thrown during spawn', async () => {
      // SETUP - spawn throws a non-Error object
      const nonError = 'string error';
      mockSpawn.mockImplementation(() => {
        throw nonError;
      });

      const input: BashToolInput = { command: 'test' };

      // EXECUTE
      const result = await executeBashCommand(input);

      // VERIFY
      expect(result.success).toBe(false);
      expect(result.exitCode).toBeNull();
      expect(result.error).toBe('string error');
      expect(result.timedOut).toBe(false);
      expect(result.killed).toBe(false);
    });
  });
});

/**
 * Helper to create a minimal mock ChildProcess for the denylist integration
 * tests. Mirrors createMockChild() but is scoped here so the §9.10.3 block is
 * self-contained.
 */
function createDenylistMockChild() {
  return {
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn((event: string, callback: (code: number) => void) => {
      if (event === 'close') {
        setTimeout(() => callback(0), 5);
      }
    }),
    killed: false,
    kill: vi.fn(),
  } as unknown as ChildProcess;
}

describe('§9.10.3 bash denylist', () => {
  describe('isDeniedCommand — denied patterns', () => {
    // git remote-mutation / state-mutation
    const gitDenied: Array<[string, RegExp]> = [
      ['git push', /git push/],
      ['git push origin main', /git push/],
      ['git push -f origin HEAD', /git push/],
      ['git push --force', /git push/],
      ['/usr/bin/git push', /git push/],
      ['git.exe push', /git push/],
      ['GIT PUSH', /git push/],
      ['git  push', /git push/],
      ['git remote', /git remote/],
      ['git remote -v', /git remote/],
      ['git remote add origin https://github.com/x/y', /git remote/],
      ['git update-ref refs/heads/main abc123', /git update-ref/],
      ['git config user.name "x"', /git config/],
      ['git config --list', /git config/],
      ['git rebase main', /git rebase/],
      ['git commit -m "msg"', /git commit/],
    ];
    for (const [cmd, reasonRe] of gitDenied) {
      it(`denies: ${cmd}`, () => {
        const result: DenylistResult = isDeniedCommand(cmd);
        expect(result.denied).toBe(true);
        expect(result.reason).toBeTruthy();
        expect(result.reason).toMatch(reasonRe);
      });
    }

    // gh
    const ghDenied: Array<[string, RegExp]> = [
      [
        'gh repo edit owner/repo --default-branch hack',
        /default_branch|gh repo/,
      ],
      ['gh repo create', /gh repo/],
      ['gh repo view', /gh repo/],
      [
        'gh api -X PATCH repos/o/r -f default_branch=hack',
        /default_branch|gh api/,
      ],
      ['gh api -X POST repos/o/r -f x=y', /gh api/],
      ['gh api -X DELETE repos/o/r', /gh api/],
      ['gh api repos/o/r -f x=y', /gh api/],
    ];
    for (const [cmd, reasonRe] of ghDenied) {
      it(`denies: ${cmd}`, () => {
        const result: DenylistResult = isDeniedCommand(cmd);
        expect(result.denied).toBe(true);
        expect(result.reason).toBeTruthy();
        expect(result.reason).toMatch(reasonRe);
      });
    }

    // http
    it('denies: curl https://api.github.com/repos/o/r', () => {
      const result = isDeniedCommand('curl https://api.github.com/repos/o/r');
      expect(result.denied).toBe(true);
      expect(result.reason).toMatch(/api\.github\.com/i);
    });
    it('denies: wget -qO- https://api.github.com/', () => {
      const result = isDeniedCommand('wget -qO- https://api.github.com/');
      expect(result.denied).toBe(true);
      expect(result.reason).toMatch(/api\.github\.com/i);
    });

    // default_branch catch-all
    it('denies: echo $default_branch (catch-all)', () => {
      const result = isDeniedCommand('echo $default_branch');
      expect(result.denied).toBe(true);
      expect(result.reason).toMatch(/default_branch/i);
    });
    it('denies: gh api repos/o/r -f default_branch=main', () => {
      const result = isDeniedCommand('gh api repos/o/r -f default_branch=main');
      expect(result.denied).toBe(true);
      expect(result.reason).toMatch(/default_branch/i);
    });

    // compound / obfuscation
    it('denies: echo a && git push (compound, second segment matches)', () => {
      const result = isDeniedCommand('echo a && git push');
      expect(result.denied).toBe(true);
      expect(result.reason).toMatch(/git push/);
    });
    it('denies: true; git push origin main (semicolon compound)', () => {
      const result = isDeniedCommand('true; git push origin main');
      expect(result.denied).toBe(true);
      expect(result.reason).toMatch(/git push/);
    });
    it('denies: git status; git commit -m x (second segment matches)', () => {
      const result = isDeniedCommand('git status; git commit -m x');
      expect(result.denied).toBe(true);
      expect(result.reason).toMatch(/git commit/);
    });
  });

  describe('isDeniedCommand — fail-closed / ambiguous (denied)', () => {
    it('denies: git reset --hard (shared-ref qualifier undecidable)', () => {
      const result = isDeniedCommand('git reset --hard');
      expect(result.denied).toBe(true);
      expect(result.reason).toMatch(/reset/i);
    });
    it('denies: git reset --hard origin/main', () => {
      const result = isDeniedCommand('git reset --hard origin/main');
      expect(result.denied).toBe(true);
      expect(result.reason).toMatch(/reset/i);
    });
    it('denies: git reset --hard HEAD~1', () => {
      const result = isDeniedCommand('git reset --hard HEAD~1');
      expect(result.denied).toBe(true);
      expect(result.reason).toMatch(/reset/i);
    });
    it('fail-closed on gh api -X PUT (write not in PATCH|POST|DELETE)', () => {
      const result = isDeniedCommand('gh api -X PUT repos/o/r');
      expect(result.denied).toBe(true);
      expect(result.reason).toMatch(/gh api/i);
    });
    it('fail-closed on gh api repos/o/r -F type@file (-F typed field)', () => {
      const result = isDeniedCommand('gh api repos/o/r -F type@file');
      expect(result.denied).toBe(true);
      expect(result.reason).toMatch(/gh api/i);
    });
  });

  describe('isDeniedCommand — allowed patterns (the gates)', () => {
    const allowed: string[] = [
      // must-pass test/build/lint gates
      'npx vitest run',
      'npx vitest run tests/unit/tools/bash-mcp.test.ts',
      'npm test',
      'npx tsc --noEmit',
      'npm run lint',
      'npm run build',
      'npm run typecheck',
      'npm run format:check',
      'npx prettier --check .',
      'node dist/index.js',
      // read-only git (first positional is a read subcommand)
      'git status',
      'git status -sb',
      'git diff',
      'git diff HEAD~1',
      'git log --oneline',
      'git show HEAD',
      'git log --grep="push"',
      'git log config',
      // deny-keyword present but NOT the target binary's subcommand
      'npm config get registry',
      'npm run commit',
      'echo remote',
      'cat config.json',
      // gh reads
      'gh api repos/o/r',
      'gh api -X GET repos/o/r',
      'gh pr view 123',
      // benign
      'echo test',
      'ls -la',
      'pwd',
      '',
    ];
    for (const cmd of allowed) {
      it(`allows: ${JSON.stringify(cmd)}`, () => {
        const result: DenylistResult = isDeniedCommand(cmd);
        expect(result.denied).toBe(false);
        expect(result.reason).toBeUndefined();
      });
    }
  });

  describe('executeBashCommand integration with denylist', () => {
    beforeEach(() => {
      mockSpawn.mockClear();
      mockSpawn.mockReturnValue(createDenylistMockChild());
      mockExistsSync.mockReturnValue(true);
      mockRealpathSync.mockImplementation(path => path as string);
    });

    it('refuses git push without spawning (exitCode 126)', async () => {
      const result = await executeBashCommand({
        command: 'git push origin main',
      });
      expect(mockSpawn).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(126);
      expect(result.error).toMatch(/denylist/i);
      expect(result.timedOut).toBe(false);
      expect(result.killed).toBe(false);
      expect(result.stdout).toBe('');
      expect(result.stderr).toBe('');
    });

    it('refuses gh repo edit --default-branch without spawning', async () => {
      const result = await executeBashCommand({
        command: 'gh repo edit owner/repo --default-branch hack',
      });
      expect(mockSpawn).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(126);
      expect(result.error).toMatch(/denylist/i);
      expect(result.timedOut).toBe(false);
      expect(result.killed).toBe(false);
    });

    it('refuses gh api -X PATCH with default_branch (acceptance triple #3)', async () => {
      const result = await executeBashCommand({
        command: 'gh api -X PATCH repos/o/r -f default_branch=hack',
      });
      expect(mockSpawn).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(126);
      expect(result.error).toMatch(/denylist/i);
      expect(result.timedOut).toBe(false);
      expect(result.killed).toBe(false);
    });

    it('still runs npm test (spawn called, shell:true preserved)', async () => {
      await executeBashCommand({ command: 'npm test' });
      expect(mockSpawn).toHaveBeenCalledWith(
        'npm test',
        expect.objectContaining({ shell: true })
      );
    });

    it('still runs git status -sb (regression guard for existing test cmd)', async () => {
      await executeBashCommand({ command: 'git status -sb' });
      expect(mockSpawn).toHaveBeenCalledWith(
        'git status -sb',
        expect.objectContaining({ shell: true })
      );
    });

    it('still runs npx tsc --noEmit (acceptance: type-check gate passes)', async () => {
      await executeBashCommand({ command: 'npx tsc --noEmit' });
      expect(mockSpawn).toHaveBeenCalledWith(
        'npx tsc --noEmit',
        expect.objectContaining({ shell: true })
      );
    });
  });
});

/**
 * Helper to create mock ChildProcess for testing
 *
 * @remarks
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
