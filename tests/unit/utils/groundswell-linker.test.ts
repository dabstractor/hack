/**
 * Unit tests for Groundswell Linker
 *
 * @remarks
 * Tests validate npm link functionality including:
 * 1. Input validation using verifyGroundswellExists()
 * 2. npm link execution with spawn()
 * 3. stdout/stderr capture and return
 * 4. Exit code handling and timeout scenarios
 * 5. Error handling for spawn failures
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChildProcess } from 'node:child_process';

// =============================================================================
// MOCK SETUP
// ============================================================================

// Mock node:child_process
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

// Mock node:fs/promises for symlink verification (async path used by the
// global linkGroundswell() verification; the 132 passing tests in this file
// depend on these mocks).
vi.mock('node:fs/promises', () => ({
  lstat: vi.fn(),
  readlink: vi.fn(),
  access: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

// CRITICAL: linkGroundswellLocally() verifies the symlink with the SYNCHRONOUS
// lstatSync/readlinkSync from 'node:fs' (inside the child 'close' callback,
// where it cannot await). The async lstat/readlink mocks above cover the global
// linkGroundswell() path ONLY. Without mocking the sync pair, the close-callback
// hits the real filesystem → 'Path exists but is not a symbolic link'.
vi.mock('node:fs', () => ({
  lstatSync: vi.fn(),
  readlinkSync: vi.fn(),
}));

// Mock groundswell-verifier module
vi.mock('../../../src/utils/groundswell-verifier.js', () => ({
  verifyGroundswellExists: vi.fn(),
}));

// Import mocked modules
import { spawn } from 'node:child_process';
import { lstatSync, readlinkSync } from 'node:fs';
import { access, lstat, readFile, readlink, writeFile } from 'node:fs/promises';
import { verifyGroundswellExists } from '../../../src/utils/groundswell-verifier.js';
import {
  linkGroundswell,
  linkGroundswellLocally,
  verifyGroundswellSymlink,
  verifyGroundswellNpmList,
  documentGroundswellReadme,
  type GroundswellLinkResult,
  type GroundswellLocalLinkResult,
  type GroundswellSymlinkVerifyResult,
  type GroundswellSymlinkVerifyOptions,
  type NpmListVerifyResult,
  type ReadmeUpdateResult,
  type ReadmeUpdateOptions,
} from '../../../src/utils/groundswell-linker.js';

// =============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Creates a realistic mock of Node.js ChildProcess that emits
 * data events and closes with the specified exit code.
 *
 * @param options - Options for configuring the mock behavior
 * @returns Mock ChildProcess object
 */
function createMockChild(
  options: {
    exitCode?: number | null;
    stdout?: string;
    stderr?: string;
  } = {}
) {
  const { exitCode = 0, stdout = 'linked groundswell', stderr = '' } = options;

  return {
    stdout: {
      on: vi.fn((event: string, callback: (data: Buffer) => void) => {
        if (event === 'data' && stdout) {
          // Simulate async data emission
          setTimeout(() => callback(Buffer.from(stdout)), 5);
        }
      }),
    },
    stderr: {
      on: vi.fn((event: string, callback: (data: Buffer) => void) => {
        if (event === 'data' && stderr) {
          // Simulate async data emission
          setTimeout(() => callback(Buffer.from(stderr)), 5);
        }
      }),
    },
    on: vi.fn((event: string, callback: (code: number | null) => void) => {
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
// TEST SETUP
// ============================================================================

describe('linkGroundswell', () => {
  const mockHomeDir = '/home/testuser';
  const mockGroundswellPath = `${mockHomeDir}/projects/groundswell`;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // ========================================================================
  // Happy path tests
  // ========================================================================

  describe('Successful npm link', () => {
    it('should return success: true when npm link completes with exit code 0', async () => {
      vi.mocked(verifyGroundswellExists).mockReturnValue({
        exists: true,
        path: mockGroundswellPath,
        missingFiles: [],
        message: `Groundswell verified at ${mockGroundswellPath}`,
      });

      const mockChild = createMockChild({
        exitCode: 0,
        stdout: 'linked groundswell in /usr/local/lib/node_modules',
      });
      vi.mocked(spawn).mockReturnValue(mockChild);

      const resultPromise = linkGroundswell();
      await vi.runAllTimersAsync();

      const result = await resultPromise;

      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.message).toContain('Successfully linked');
      expect(result.stdout).toContain('linked groundswell');
    });

    it('should use default timeout of 30000ms when no options provided', async () => {
      vi.mocked(verifyGroundswellExists).mockReturnValue({
        exists: true,
        path: mockGroundswellPath,
        missingFiles: [],
        message: `Groundswell verified at ${mockGroundswellPath}`,
      });

      const mockChild = createMockChild();
      vi.mocked(spawn).mockReturnValue(mockChild);

      const resultPromise = linkGroundswell();
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(spawn).toHaveBeenCalledWith('npm', ['link'], {
        cwd: mockGroundswellPath,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
      });
    });

    it('should accept custom timeout option', async () => {
      vi.mocked(verifyGroundswellExists).mockReturnValue({
        exists: true,
        path: mockGroundswellPath,
        missingFiles: [],
        message: `Groundswell verified at ${mockGroundswellPath}`,
      });

      const mockChild = createMockChild();
      vi.mocked(spawn).mockReturnValue(mockChild);

      const resultPromise = linkGroundswell({ timeout: 60000 });
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(spawn).toHaveBeenCalledWith('npm', ['link'], expect.anything());
    });

    it('should capture stdout from npm link command', async () => {
      vi.mocked(verifyGroundswellExists).mockReturnValue({
        exists: true,
        path: mockGroundswellPath,
        missingFiles: [],
        message: `Groundswell verified at ${mockGroundswellPath}`,
      });

      const mockChild = createMockChild({
        stdout: 'audited 1 package\nlinked groundswell',
      });
      vi.mocked(spawn).mockReturnValue(mockChild);

      const resultPromise = linkGroundswell();
      await vi.runAllTimersAsync();

      const result = await resultPromise;

      expect(result.stdout).toContain('audited 1 package');
      expect(result.stdout).toContain('linked groundswell');
    });

    it('should capture stderr from npm link command', async () => {
      vi.mocked(verifyGroundswellExists).mockReturnValue({
        exists: true,
        path: mockGroundswellPath,
        missingFiles: [],
        message: `Groundswell verified at ${mockGroundswellPath}`,
      });

      const mockChild = createMockChild({
        exitCode: 0,
        stdout: 'linked',
        stderr: 'npm notice',
      });
      vi.mocked(spawn).mockReturnValue(mockChild);

      const resultPromise = linkGroundswell();
      await vi.runAllTimersAsync();

      const result = await resultPromise;

      expect(result.stderr).toContain('npm notice');
    });
  });

  // ========================================================================
  // Input validation tests
  // ========================================================================

  describe('Input validation', () => {
    it('should throw error if Groundswell directory does not exist', async () => {
      vi.mocked(verifyGroundswellExists).mockReturnValue({
        exists: false,
        path: mockGroundswellPath,
        missingFiles: [],
        message: `Groundswell directory not found at ${mockGroundswellPath}`,
      });

      await expect(linkGroundswell()).rejects.toThrow('Cannot create npm link');
      await expect(linkGroundswell()).rejects.toThrow('not found');
    });

    it('should include verification message in thrown error when directory does not exist', async () => {
      const customMessage = 'Custom verification message';
      vi.mocked(verifyGroundswellExists).mockReturnValue({
        exists: false,
        path: mockGroundswellPath,
        missingFiles: [],
        message: customMessage,
      });

      await expect(linkGroundswell()).rejects.toThrow(customMessage);
    });

    it('should throw error if required files are missing', async () => {
      vi.mocked(verifyGroundswellExists).mockReturnValue({
        exists: true,
        path: mockGroundswellPath,
        missingFiles: ['package.json'],
        message: 'Missing package.json',
      });

      await expect(linkGroundswell()).rejects.toThrow('missing required files');
      await expect(linkGroundswell()).rejects.toThrow('package.json');
    });

    it('should include all missing files in thrown error', async () => {
      vi.mocked(verifyGroundswellExists).mockReturnValue({
        exists: true,
        path: mockGroundswellPath,
        missingFiles: ['package.json', 'entry point'],
        message: 'Missing multiple files',
      });

      await expect(linkGroundswell()).rejects.toThrow('package.json');
      await expect(linkGroundswell()).rejects.toThrow('entry point');
    });

    it('should call verifyGroundswellExists() for input validation', async () => {
      vi.mocked(verifyGroundswellExists).mockReturnValue({
        exists: true,
        path: mockGroundswellPath,
        missingFiles: [],
        message: `Groundswell verified at ${mockGroundswellPath}`,
      });

      const mockChild = createMockChild();
      vi.mocked(spawn).mockReturnValue(mockChild);

      const resultPromise = linkGroundswell();
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(verifyGroundswellExists).toHaveBeenCalledTimes(1);
    });

    it('should use Groundswell path from verification result', async () => {
      const customPath = '/custom/path/to/groundswell';
      vi.mocked(verifyGroundswellExists).mockReturnValue({
        exists: true,
        path: customPath,
        missingFiles: [],
        message: `Groundswell verified at ${customPath}`,
      });

      const mockChild = createMockChild();
      vi.mocked(spawn).mockReturnValue(mockChild);

      const resultPromise = linkGroundswell();
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(spawn).toHaveBeenCalledWith('npm', ['link'], {
        cwd: customPath,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
      });
    });
  });

  // ========================================================================
  // npm link command failure tests
  // ========================================================================

  describe('npm link command failures', () => {
    it('should return success: false when npm link exits with non-zero code', async () => {
      vi.mocked(verifyGroundswellExists).mockReturnValue({
        exists: true,
        path: mockGroundswellPath,
        missingFiles: [],
        message: `Groundswell verified at ${mockGroundswellPath}`,
      });

      const mockChild = createMockChild({
        exitCode: 1,
        stdout: '',
        stderr: 'npm ERR! code EACCES',
      });
      vi.mocked(spawn).mockReturnValue(mockChild);

      const resultPromise = linkGroundswell();
      await vi.runAllTimersAsync();

      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('EACCES');
      expect(result.message).toContain('failed with exit code 1');
    });

    it('should capture stderr on npm link failure', async () => {
      vi.mocked(verifyGroundswellExists).mockReturnValue({
        exists: true,
        path: mockGroundswellPath,
        missingFiles: [],
        message: `Groundswell verified at ${mockGroundswellPath}`,
      });

      const mockChild = createMockChild({
        exitCode: 1,
        stdout: '',
        stderr: 'npm ERR! code EEXIST\nnpm ERR! link already exists',
      });
      vi.mocked(spawn).mockReturnValue(mockChild);

      const resultPromise = linkGroundswell();
      await vi.runAllTimersAsync();

      const result = await resultPromise;

      expect(result.stderr).toContain('EEXIST');
      expect(result.stderr).toContain('link already exists');
    });

    it('should include exit code in error message when non-zero', async () => {
      vi.mocked(verifyGroundswellExists).mockReturnValue({
        exists: true,
        path: mockGroundswellPath,
        missingFiles: [],
        message: `Groundswell verified at ${mockGroundswellPath}`,
      });

      const mockChild = createMockChild({ exitCode: 127 });
      vi.mocked(spawn).mockReturnValue(mockChild);

      const resultPromise = linkGroundswell();
      await vi.runAllTimersAsync();

      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(127);
      expect(result.message).toContain('exit code 127');
    });

    it('should return success: false when exit code is null', async () => {
      vi.mocked(verifyGroundswellExists).mockReturnValue({
        exists: true,
        path: mockGroundswellPath,
        missingFiles: [],
        message: `Groundswell verified at ${mockGroundswellPath}`,
      });

      const mockChild = createMockChild({ exitCode: null });
      vi.mocked(spawn).mockReturnValue(mockChild);

      const resultPromise = linkGroundswell();
      await vi.runAllTimersAsync();

      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(null);
      expect(result.message).toContain('npm link failed');
    });
  });

  // ========================================================================
  // Spawn error handling tests
  // ========================================================================

  describe('Spawn error handling', () => {
    it('should return success: false when spawn throws synchronous error', async () => {
      vi.mocked(verifyGroundswellExists).mockReturnValue({
        exists: true,
        path: mockGroundswellPath,
        missingFiles: [],
        message: `Groundswell verified at ${mockGroundswellPath}`,
      });

      vi.mocked(spawn).mockImplementation(() => {
        throw new Error('ENOENT: npm command not found');
      });

      const result = await linkGroundswell();

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(null);
      expect(result.error).toContain('npm command not found');
      expect(result.message).toContain('Failed to spawn');
    });

    it('should handle spawn error with error message', async () => {
      vi.mocked(verifyGroundswellExists).mockReturnValue({
        exists: true,
        path: mockGroundswellPath,
        missingFiles: [],
        message: `Groundswell verified at ${mockGroundswellPath}`,
      });

      const errorMessage = 'EACCES: permission denied';
      vi.mocked(spawn).mockImplementation(() => {
        throw new Error(errorMessage);
      });

      const result = await linkGroundswell();

      expect(result.success).toBe(false);
      expect(result.error).toBe(errorMessage);
    });

    it('should handle non-Error spawn errors', async () => {
      vi.mocked(verifyGroundswellExists).mockReturnValue({
        exists: true,
        path: mockGroundswellPath,
        missingFiles: [],
        message: `Groundswell verified at ${mockGroundswellPath}`,
      });

      vi.mocked(spawn).mockImplementation(() => {
        throw 'string error';
      });

      const result = await linkGroundswell();

      expect(result.success).toBe(false);
      expect(result.error).toBe('string error');
    });

    it('should return empty stdout/stderr on spawn error', async () => {
      vi.mocked(verifyGroundswellExists).mockReturnValue({
        exists: true,
        path: mockGroundswellPath,
        missingFiles: [],
        message: `Groundswell verified at ${mockGroundswellPath}`,
      });

      vi.mocked(spawn).mockImplementation(() => {
        throw new Error('Spawn failed');
      });

      const result = await linkGroundswell();

      expect(result.stdout).toBe('');
      expect(result.stderr).toBe('');
    });
  });

  // ========================================================================
  // Timeout handling tests
  // ========================================================================

  // These tests use real timers instead of fake timers
  describe('Timeout handling', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      vi.useRealTimers(); // Override fake timers from outer beforeEach
    });

    afterEach(() => {
      vi.clearAllMocks();
    });

    it('should return success: false when command times out', async () => {
      vi.mocked(verifyGroundswellExists).mockReturnValue({
        exists: true,
        path: mockGroundswellPath,
        missingFiles: [],
        message: `Groundswell verified at ${mockGroundswellPath}`,
      });

      // Child that emits close after a delay longer than our timeout
      const mockChild = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event: string, callback: (code: number | null) => void) => {
          if (event === 'close') {
            // Emit close after 200ms, but our timeout is 100ms
            setTimeout(() => callback(0), 200);
          }
        }),
        kill: vi.fn(),
        killed: false,
      };

      vi.mocked(spawn).mockReturnValue(mockChild as never);

      // Use a short timeout
      const result = await linkGroundswell({ timeout: 100 });

      expect(result.success).toBe(false);
      expect(result.error).toContain('timed out after 100ms');
      expect(mockChild.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('should send SIGKILL if SIGTERM does not kill process', async () => {
      vi.mocked(verifyGroundswellExists).mockReturnValue({
        exists: true,
        path: mockGroundswellPath,
        missingFiles: [],
        message: `Groundswell verified at ${mockGroundswellPath}`,
      });

      // Track signals received
      const signals: string[] = [];
      let closeCallback: ((code: number | null) => void) | undefined;

      const mockChild = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event: string, callback: (code: number | null) => void) => {
          if (event === 'close') {
            closeCallback = callback;
          }
        }),
        kill: vi.fn((_signal: string) => {
          signals.push(_signal);
          // After SIGKILL, emit close to resolve the promise
          if (_signal === 'SIGKILL' && closeCallback) {
            closeCallback(null);
          }
        }),
        killed: false, // Property that stays false to trigger SIGKILL
      };

      vi.mocked(spawn).mockReturnValue(mockChild as never);

      const resultPromise = linkGroundswell({ timeout: 50 });

      // Wait for timeout + grace period (50ms timeout + 2000ms grace)
      await new Promise(resolve => setTimeout(resolve, 2100));

      const result = await resultPromise;

      expect(signals).toContain('SIGTERM');
      expect(signals).toContain('SIGKILL');
      expect(result.success).toBe(false);
    });

    it('should stop capturing output after timeout', async () => {
      vi.mocked(verifyGroundswellExists).mockReturnValue({
        exists: true,
        path: mockGroundswellPath,
        missingFiles: [],
        message: `Groundswell verified at ${mockGroundswellPath}`,
      });

      let closeCallback: ((code: number | null) => void) | undefined;

      const mockChild = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event: string, callback: (code: number | null) => void) => {
          if (event === 'close') {
            closeCallback = callback;
          }
        }),
        kill: vi.fn((_signal: string) => {
          // Emit close after kill to resolve the promise
          if (closeCallback) {
            closeCallback(null);
          }
        }),
        killed: false,
      };

      vi.mocked(spawn).mockReturnValue(mockChild as never);

      const resultPromise = linkGroundswell({ timeout: 50 });

      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 100));

      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.stdout).toBe('');
    });
  });

  // ========================================================================
  // Result structure tests
  // ========================================================================

  describe('GroundswellLinkResult structure', () => {
    it('should return complete GroundswellLinkResult object', async () => {
      vi.mocked(verifyGroundswellExists).mockReturnValue({
        exists: true,
        path: mockGroundswellPath,
        missingFiles: [],
        message: `Groundswell verified at ${mockGroundswellPath}`,
      });

      const mockChild = createMockChild();
      vi.mocked(spawn).mockReturnValue(mockChild);

      const resultPromise = linkGroundswell();
      await vi.runAllTimersAsync();

      const result: GroundswellLinkResult = await resultPromise;

      // Check result structure
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('message');
      expect(result).toHaveProperty('stdout');
      expect(result).toHaveProperty('stderr');
      expect(result).toHaveProperty('exitCode');

      // Check types
      expect(typeof result.success).toBe('boolean');
      expect(typeof result.message).toBe('string');
      expect(typeof result.stdout).toBe('string');
      expect(typeof result.stderr).toBe('string');

      // exitCode can be number or null
      expect(
        result.exitCode === null || typeof result.exitCode === 'number'
      ).toBe(true);
    });

    it('should include success: true in result on successful link', async () => {
      vi.mocked(verifyGroundswellExists).mockReturnValue({
        exists: true,
        path: mockGroundswellPath,
        missingFiles: [],
        message: `Groundswell verified at ${mockGroundswellPath}`,
      });

      const mockChild = createMockChild();
      vi.mocked(spawn).mockReturnValue(mockChild);

      const resultPromise = linkGroundswell();
      await vi.runAllTimersAsync();

      const result = await resultPromise;

      expect(result.success).toBe(true);
    });

    it('should include success: false in result on failed link', async () => {
      vi.mocked(verifyGroundswellExists).mockReturnValue({
        exists: true,
        path: mockGroundswellPath,
        missingFiles: [],
        message: `Groundswell verified at ${mockGroundswellPath}`,
      });

      const mockChild = createMockChild({ exitCode: 1 });
      vi.mocked(spawn).mockReturnValue(mockChild);

      const resultPromise = linkGroundswell();
      await vi.runAllTimersAsync();

      const result = await resultPromise;

      expect(result.success).toBe(false);
    });

    it('should include descriptive message in result', async () => {
      vi.mocked(verifyGroundswellExists).mockReturnValue({
        exists: true,
        path: mockGroundswellPath,
        missingFiles: [],
        message: `Groundswell verified at ${mockGroundswellPath}`,
      });

      const mockChild = createMockChild();
      vi.mocked(spawn).mockReturnValue(mockChild);

      const resultPromise = linkGroundswell();
      await vi.runAllTimersAsync();

      const result = await resultPromise;

      expect(result.message).toBeTruthy();
      expect(typeof result.message).toBe('string');
    });

    it('should include optional error property when spawn fails', async () => {
      vi.mocked(verifyGroundswellExists).mockReturnValue({
        exists: true,
        path: mockGroundswellPath,
        missingFiles: [],
        message: `Groundswell verified at ${mockGroundswellPath}`,
      });

      vi.mocked(spawn).mockImplementation(() => {
        throw new Error('Spawn error');
      });

      const result = await linkGroundswell();

      expect(result.error).toBe('Spawn error');
    });

    it('should include optional error property on timeout', async () => {
      vi.mocked(verifyGroundswellExists).mockReturnValue({
        exists: true,
        path: mockGroundswellPath,
        missingFiles: [],
        message: `Groundswell verified at ${mockGroundswellPath}`,
      });

      const mockChild = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event: string, callback: (code: number | null) => void) => {
          if (event === 'close') {
            // Emit close after a delay longer than timeout
            setTimeout(() => callback(0), 200);
          }
        }),
        kill: vi.fn(),
        killed: false,
      };

      vi.mocked(spawn).mockReturnValue(mockChild as never);

      const resultPromise = linkGroundswell({ timeout: 50 });
      await vi.runAllTimersAsync();

      const result = await resultPromise;

      expect(result.error).toContain('timed out after 50ms');
    });

    it('should not include error property on successful link', async () => {
      vi.mocked(verifyGroundswellExists).mockReturnValue({
        exists: true,
        path: mockGroundswellPath,
        missingFiles: [],
        message: `Groundswell verified at ${mockGroundswellPath}`,
      });

      const mockChild = createMockChild();
      vi.mocked(spawn).mockReturnValue(mockChild);

      const resultPromise = linkGroundswell();
      await vi.runAllTimersAsync();

      const result = await resultPromise;

      expect(result.error).toBeUndefined();
    });
  });

  // ========================================================================
  // Spawn arguments tests
  // ========================================================================

  describe('Spawn arguments', () => {
    it('should spawn npm with link command', async () => {
      vi.mocked(verifyGroundswellExists).mockReturnValue({
        exists: true,
        path: mockGroundswellPath,
        missingFiles: [],
        message: `Groundswell verified at ${mockGroundswellPath}`,
      });

      const mockChild = createMockChild();
      vi.mocked(spawn).mockReturnValue(mockChild);

      const resultPromise = linkGroundswell();
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(spawn).toHaveBeenCalledWith('npm', ['link'], expect.anything());
    });

    it('should use shell: false to prevent injection', async () => {
      vi.mocked(verifyGroundswellExists).mockReturnValue({
        exists: true,
        path: mockGroundswellPath,
        missingFiles: [],
        message: `Groundswell verified at ${mockGroundswellPath}`,
      });

      const mockChild = createMockChild();
      vi.mocked(spawn).mockReturnValue(mockChild);

      const resultPromise = linkGroundswell();
      await vi.runAllTimersAsync();
      await resultPromise;

      const spawnOptions = vi.mocked(spawn).mock.calls[0]?.[2];
      expect(spawnOptions?.shell).toBe(false);
    });

    it('should use stdio ignore, pipe, pipe', async () => {
      vi.mocked(verifyGroundswellExists).mockReturnValue({
        exists: true,
        path: mockGroundswellPath,
        missingFiles: [],
        message: `Groundswell verified at ${mockGroundswellPath}`,
      });

      const mockChild = createMockChild();
      vi.mocked(spawn).mockReturnValue(mockChild);

      const resultPromise = linkGroundswell();
      await vi.runAllTimersAsync();
      await resultPromise;

      const spawnOptions = vi.mocked(spawn).mock.calls[0]?.[2];
      expect(spawnOptions?.stdio).toEqual(['ignore', 'pipe', 'pipe']);
    });

    it('should use cwd from verification result', async () => {
      const customPath = '/custom/groundswell/path';
      vi.mocked(verifyGroundswellExists).mockReturnValue({
        exists: true,
        path: customPath,
        missingFiles: [],
        message: `Groundswell verified at ${customPath}`,
      });

      const mockChild = createMockChild();
      vi.mocked(spawn).mockReturnValue(mockChild);

      const resultPromise = linkGroundswell();
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(spawn).toHaveBeenCalledWith('npm', ['link'], {
        cwd: customPath,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
      });
    });
  });

  // ========================================================================
  // Integration tests
  // ========================================================================

  describe('Integration', () => {
    it('should support full workflow: verify then link', async () => {
      // Full workflow: first verify, then link based on result
      vi.mocked(verifyGroundswellExists).mockReturnValue({
        exists: true,
        path: mockGroundswellPath,
        missingFiles: [],
        message: `Groundswell verified at ${mockGroundswellPath}`,
      });

      const mockChild = createMockChild();
      vi.mocked(spawn).mockReturnValue(mockChild);

      // First verify
      const verification = verifyGroundswellExists();
      expect(verification.exists).toBe(true);
      expect(verification.missingFiles).toHaveLength(0);

      // Then link (should succeed)
      const resultPromise = linkGroundswell();
      await vi.runAllTimersAsync();

      const linkResult = await resultPromise;
      expect(linkResult.success).toBe(true);
    });

    it('should fail fast if verification fails', async () => {
      // Verification fails - should not attempt spawn
      vi.mocked(verifyGroundswellExists).mockReturnValue({
        exists: false,
        path: mockGroundswellPath,
        missingFiles: [],
        message: 'Groundswell not found',
      });

      await expect(linkGroundswell()).rejects.toThrow();

      // Spawn should never be called
      expect(spawn).not.toHaveBeenCalled();
    });
  });
});

// =============================================================================
// TEST SUITE: linkGroundswellLocally
// ============================================================================

describe('linkGroundswellLocally', () => {
  const mockProjectPath = '/home/dustin/projects/hacky-hack';
  const mockSymlinkPath = `${mockProjectPath}/node_modules/groundswell`;
  const mockGlobalLinkPath = '/usr/local/lib/node_modules/groundswell';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // ========================================================================
  // Happy path tests
  // ========================================================================

  describe('Successful npm link groundswell', () => {
    it('should return success: true when npm link groundswell completes with symlink verification', async () => {
      // S2 result - successful global link
      const previousResult: GroundswellLinkResult = {
        success: true,
        message: 'Successfully linked Groundswell at /path/to/groundswell',
        stdout: 'linked',
        stderr: '',
        exitCode: 0,
      };

      // Mock symlink verification — linkGroundswellLocally() verifies with
      // the SYNCHRONOUS lstatSync/readlinkSync inside the close-callback.
      vi.mocked(lstatSync).mockReturnValue({
        isSymbolicLink: () => true,
      } as ReturnType<typeof lstatSync>);

      vi.mocked(readlinkSync).mockReturnValue(mockGlobalLinkPath);

      // Mock successful npm link groundswell
      const mockChild = createMockChild({
        exitCode: 0,
        stdout: 'linked groundswell in project',
      });
      vi.mocked(spawn).mockReturnValue(mockChild);

      const resultPromise = linkGroundswellLocally(previousResult);
      await vi.runAllTimersAsync();

      const result: GroundswellLocalLinkResult = await resultPromise;

      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.message).toContain(
        'Successfully linked groundswell in project'
      );
      expect(result.symlinkPath).toBe(mockSymlinkPath);
      expect(result.symlinkTarget).toBe(mockGlobalLinkPath);
    });

    it('should include symlinkTarget in result when verification succeeds', async () => {
      const previousResult: GroundswellLinkResult = {
        success: true,
        message: 'Global link succeeded',
        stdout: '',
        stderr: '',
        exitCode: 0,
      };

      const customTarget = '/custom/global/link/path';
      vi.mocked(lstatSync).mockReturnValue({
        isSymbolicLink: () => true,
      } as ReturnType<typeof lstatSync>);

      vi.mocked(readlinkSync).mockReturnValue(customTarget);

      const mockChild = createMockChild({ exitCode: 0 });
      vi.mocked(spawn).mockReturnValue(mockChild);

      const resultPromise = linkGroundswellLocally(previousResult);
      await vi.runAllTimersAsync();

      const result = await resultPromise;

      expect(result.symlinkTarget).toBe(customTarget);
    });

    it('should use default project path when no options provided', async () => {
      const previousResult: GroundswellLinkResult = {
        success: true,
        message: 'Global link succeeded',
        stdout: '',
        stderr: '',
        exitCode: 0,
      };

      vi.mocked(lstat).mockResolvedValue({
        isSymbolicLink: () => true,
      } as ReturnType<typeof lstat>);

      vi.mocked(readlink).mockResolvedValue(mockGlobalLinkPath);

      const mockChild = createMockChild({ exitCode: 0 });
      vi.mocked(spawn).mockReturnValue(mockChild);

      const resultPromise = linkGroundswellLocally(previousResult);
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(spawn).toHaveBeenCalledWith('npm', ['link', 'groundswell'], {
        cwd: '/home/dustin/projects/hacky-hack',
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
      });
    });

    it('should use custom project path from options', async () => {
      const previousResult: GroundswellLinkResult = {
        success: true,
        message: 'Global link succeeded',
        stdout: '',
        stderr: '',
        exitCode: 0,
      };

      const customProjectPath = '/custom/project/path';
      vi.mocked(lstat).mockResolvedValue({
        isSymbolicLink: () => true,
      } as ReturnType<typeof lstat>);

      vi.mocked(readlink).mockResolvedValue(mockGlobalLinkPath);

      const mockChild = createMockChild({ exitCode: 0 });
      vi.mocked(spawn).mockReturnValue(mockChild);

      const resultPromise = linkGroundswellLocally(previousResult, {
        projectPath: customProjectPath,
      });
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(spawn).toHaveBeenCalledWith('npm', ['link', 'groundswell'], {
        cwd: customProjectPath,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
      });
    });

    it('should capture stdout from npm link groundswell command', async () => {
      const previousResult: GroundswellLinkResult = {
        success: true,
        message: 'Global link succeeded',
        stdout: '',
        stderr: '',
        exitCode: 0,
      };

      vi.mocked(lstat).mockResolvedValue({
        isSymbolicLink: () => true,
      } as ReturnType<typeof lstat>);

      vi.mocked(readlink).mockResolvedValue(mockGlobalLinkPath);

      const mockChild = createMockChild({
        stdout: 'audited 1 package\nlinked groundswell locally',
      });
      vi.mocked(spawn).mockReturnValue(mockChild);

      const resultPromise = linkGroundswellLocally(previousResult);
      await vi.runAllTimersAsync();

      const result = await resultPromise;

      expect(result.stdout).toContain('audited 1 package');
      expect(result.stdout).toContain('linked groundswell locally');
    });

    it('should capture stderr from npm link groundswell command', async () => {
      const previousResult: GroundswellLinkResult = {
        success: true,
        message: 'Global link succeeded',
        stdout: '',
        stderr: '',
        exitCode: 0,
      };

      vi.mocked(lstat).mockResolvedValue({
        isSymbolicLink: () => true,
      } as ReturnType<typeof lstat>);

      vi.mocked(readlink).mockResolvedValue(mockGlobalLinkPath);

      const mockChild = createMockChild({
        exitCode: 0,
        stdout: 'linked',
        stderr: 'npm notice',
      });
      vi.mocked(spawn).mockReturnValue(mockChild);

      const resultPromise = linkGroundswellLocally(previousResult);
      await vi.runAllTimersAsync();

      const result = await resultPromise;

      expect(result.stderr).toContain('npm notice');
    });
  });

  // ========================================================================
  // Conditional skip tests (input validation based on S2 result)
  // ========================================================================

  describe('Conditional skip based on S2 result', () => {
    it('should skip execution when previousResult.success is false', async () => {
      const previousResult: GroundswellLinkResult = {
        success: false,
        message: 'npm link failed with exit code 1',
        stdout: '',
        stderr: 'npm ERR!',
        exitCode: 1,
      };

      const result = await linkGroundswellLocally(previousResult);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Skipped: Global npm link failed');
      expect(result.message).toContain('npm link failed with exit code 1');
      expect(result.exitCode).toBe(null);
    });

    it('should not call spawn when skipping due to S2 failure', async () => {
      const previousResult: GroundswellLinkResult = {
        success: false,
        message: 'Global link failed',
        stdout: '',
        stderr: '',
        exitCode: 1,
      };

      await linkGroundswellLocally(previousResult);

      expect(spawn).not.toHaveBeenCalled();
    });

    it('should include previousResult.message in skip message', async () => {
      const customMessage = 'Custom failure message from S2';
      const previousResult: GroundswellLinkResult = {
        success: false,
        message: customMessage,
        stdout: '',
        stderr: '',
        exitCode: 127,
      };

      const result = await linkGroundswellLocally(previousResult);

      expect(result.message).toContain(customMessage);
    });

    it('should return correct symlinkPath even when skipping', async () => {
      const previousResult: GroundswellLinkResult = {
        success: false,
        message: 'Failed',
        stdout: '',
        stderr: '',
        exitCode: 1,
      };

      const result = await linkGroundswellLocally(previousResult);

      expect(result.symlinkPath).toContain('node_modules/groundswell');
    });
  });

  // ========================================================================
  // Spawn error handling tests
  // ========================================================================

  describe('Spawn error handling', () => {
    it('should return success: false when spawn throws synchronous error', async () => {
      const previousResult: GroundswellLinkResult = {
        success: true,
        message: 'Global link succeeded',
        stdout: '',
        stderr: '',
        exitCode: 0,
      };

      vi.mocked(spawn).mockImplementation(() => {
        throw new Error('ENOENT: npm command not found');
      });

      const result = await linkGroundswellLocally(previousResult);

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(null);
      expect(result.error).toContain('npm command not found');
      expect(result.message).toContain('Failed to spawn');
    });

    it('should handle ENOENT (npm not found)', async () => {
      const previousResult: GroundswellLinkResult = {
        success: true,
        message: 'Global link succeeded',
        stdout: '',
        stderr: '',
        exitCode: 0,
      };

      vi.mocked(spawn).mockImplementation(() => {
        throw new Error('ENOENT: npm command not found');
      });

      const result = await linkGroundswellLocally(previousResult);

      expect(result.success).toBe(false);
      expect(result.error).toContain('ENOENT');
    });

    it('should handle EACCES (permission denied)', async () => {
      const previousResult: GroundswellLinkResult = {
        success: true,
        message: 'Global link succeeded',
        stdout: '',
        stderr: '',
        exitCode: 0,
      };

      const errorMessage = 'EACCES: permission denied';
      vi.mocked(spawn).mockImplementation(() => {
        throw new Error(errorMessage);
      });

      const result = await linkGroundswellLocally(previousResult);

      expect(result.success).toBe(false);
      expect(result.error).toBe(errorMessage);
    });

    it('should return empty stdout/stderr on spawn error', async () => {
      const previousResult: GroundswellLinkResult = {
        success: true,
        message: 'Global link succeeded',
        stdout: '',
        stderr: '',
        exitCode: 0,
      };

      vi.mocked(spawn).mockImplementation(() => {
        throw new Error('Spawn failed');
      });

      const result = await linkGroundswellLocally(previousResult);

      expect(result.stdout).toBe('');
      expect(result.stderr).toBe('');
    });
  });

  // ========================================================================
  // Symlink verification tests
  // ========================================================================

  describe('Symlink verification', () => {
    it('should return success: false when symlink not created (ENOENT)', async () => {
      const previousResult: GroundswellLinkResult = {
        success: true,
        message: 'Global link succeeded',
        stdout: '',
        stderr: '',
        exitCode: 0,
      };

      // npm link succeeds but symlink not found
      const mockChild = createMockChild({ exitCode: 0 });
      vi.mocked(spawn).mockReturnValue(mockChild);

      // linkGroundswellLocally() calls the SYNC lstatSync in the close-callback;
      // a sync fs function THROWS (not rejects) on a missing path.
      vi.mocked(lstatSync).mockImplementation(() => {
        const e = new Error(
          'ENOENT: no such file or directory'
        ) as NodeJS.ErrnoException;
        e.code = 'ENOENT';
        throw e;
      });

      const resultPromise = linkGroundswellLocally(previousResult);
      await vi.runAllTimersAsync();

      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.error).toBe('ENOENT');
      expect(result.message).toContain('symlink verification failed');
    });

    it('should return success: false when path exists but is not a symlink', async () => {
      const previousResult: GroundswellLinkResult = {
        success: true,
        message: 'Global link succeeded',
        stdout: '',
        stderr: '',
        exitCode: 0,
      };

      const mockChild = createMockChild({ exitCode: 0 });
      vi.mocked(spawn).mockReturnValue(mockChild);

      // Path exists but is not a symlink (sync lstatSync in the close-callback)
      vi.mocked(lstatSync).mockReturnValue({
        isSymbolicLink: () => false,
      } as ReturnType<typeof lstatSync>);

      const resultPromise = linkGroundswellLocally(previousResult);
      await vi.runAllTimersAsync();

      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.message).toContain('path is not a symlink');
      expect(result.error).toBe('Path exists but is not a symbolic link');
    });

    it('should return symlinkTarget when verification succeeds', async () => {
      const previousResult: GroundswellLinkResult = {
        success: true,
        message: 'Global link succeeded',
        stdout: '',
        stderr: '',
        exitCode: 0,
      };

      const mockChild = createMockChild({ exitCode: 0 });
      vi.mocked(spawn).mockReturnValue(mockChild);

      const expectedTarget = '/expected/global/link/path';
      vi.mocked(lstatSync).mockReturnValue({
        isSymbolicLink: () => true,
      } as ReturnType<typeof lstatSync>);

      vi.mocked(readlinkSync).mockReturnValue(expectedTarget);

      const resultPromise = linkGroundswellLocally(previousResult);
      await vi.runAllTimersAsync();

      const result = await resultPromise;

      expect(result.success).toBe(true);
      expect(result.symlinkTarget).toBe(expectedTarget);
    });

    it('should call lstat with correct symlink path', async () => {
      const previousResult: GroundswellLinkResult = {
        success: true,
        message: 'Global link succeeded',
        stdout: '',
        stderr: '',
        exitCode: 0,
      };

      const mockChild = createMockChild({ exitCode: 0 });
      vi.mocked(spawn).mockReturnValue(mockChild);

      vi.mocked(lstatSync).mockReturnValue({
        isSymbolicLink: () => true,
      } as ReturnType<typeof lstatSync>);

      vi.mocked(readlinkSync).mockReturnValue(mockGlobalLinkPath);

      const resultPromise = linkGroundswellLocally(previousResult);
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(lstatSync).toHaveBeenCalledWith(
        '/home/dustin/projects/hacky-hack/node_modules/groundswell'
      );
    });

    it('should call readlink after lstat confirms symlink', async () => {
      const previousResult: GroundswellLinkResult = {
        success: true,
        message: 'Global link succeeded',
        stdout: '',
        stderr: '',
        exitCode: 0,
      };

      const mockChild = createMockChild({ exitCode: 0 });
      vi.mocked(spawn).mockReturnValue(mockChild);

      vi.mocked(lstatSync).mockReturnValue({
        isSymbolicLink: () => true,
      } as ReturnType<typeof lstatSync>);

      vi.mocked(readlinkSync).mockReturnValue(mockGlobalLinkPath);

      const resultPromise = linkGroundswellLocally(previousResult);
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(readlinkSync).toHaveBeenCalledWith(
        '/home/dustin/projects/hacky-hack/node_modules/groundswell'
      );
    });
  });

  // ========================================================================
  // Timeout handling tests
  // ========================================================================

  describe('Timeout handling', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      vi.useRealTimers(); // Override fake timers from outer beforeEach
    });

    afterEach(() => {
      vi.clearAllMocks();
    });

    it(
      'should return success: false when command times out',
      async () => {
        const previousResult: GroundswellLinkResult = {
          success: true,
          message: 'Global link succeeded',
          stdout: '',
          stderr: '',
          exitCode: 0,
        };

        let closeCallback: ((code: number | null) => void) | undefined;

        // Child that emits close when killed
        const mockChild = {
          stdout: { on: vi.fn() },
          stderr: { on: vi.fn() },
          on: vi.fn(
            (event: string, callback: (code: number | null) => void) => {
              if (event === 'close') {
                closeCallback = callback;
              }
            }
          ),
          kill: vi.fn((_signal: string) => {
            // Emit close after kill to resolve the promise
            if (closeCallback !== undefined) {
              closeCallback(null);
            }
          }),
          killed: false,
        };

        vi.mocked(spawn).mockReturnValue(mockChild as never);

        // Use a short timeout
        const result = await linkGroundswellLocally(previousResult, {
          timeout: 100,
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('timed out after 100ms');
        expect(mockChild.kill).toHaveBeenCalledWith('SIGTERM');
      },
      { timeout: 10000 }
    );

    it('should send SIGKILL if SIGTERM does not kill process', async () => {
      const previousResult: GroundswellLinkResult = {
        success: true,
        message: 'Global link succeeded',
        stdout: '',
        stderr: '',
        exitCode: 0,
      };

      // Track signals received
      const signals: string[] = [];

      const mockChild = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn(),
        kill: vi.fn((_signal: string) => {
          signals.push(_signal);
          // After SIGKILL, emit close to resolve the promise
          if (_signal === 'SIGKILL') {
            const closeCallback = mockChild.on.mock.calls.find(
              c => c[0] === 'close'
            )?.[1];
            if (closeCallback !== undefined) closeCallback(null);
          }
        }),
        killed: false, // Property that stays false to trigger SIGKILL
      };

      vi.mocked(spawn).mockReturnValue(mockChild as never);

      const resultPromise = linkGroundswellLocally(previousResult, {
        timeout: 50,
      });

      // Wait for timeout + grace period (50ms timeout + 2000ms grace)
      await new Promise(resolve => {
        setTimeout(resolve, 2100);
      });

      const result = await resultPromise;

      expect(signals).toContain('SIGTERM');
      expect(signals).toContain('SIGKILL');
      expect(result.success).toBe(false);
    });
  });

  // ========================================================================
  // Result structure tests
  // ========================================================================

  describe('GroundswellLocalLinkResult structure', () => {
    it('should return complete GroundswellLocalLinkResult object', async () => {
      const previousResult: GroundswellLinkResult = {
        success: true,
        message: 'Global link succeeded',
        stdout: '',
        stderr: '',
        exitCode: 0,
      };

      vi.mocked(lstat).mockResolvedValue({
        isSymbolicLink: () => true,
      } as ReturnType<typeof lstat>);

      vi.mocked(readlink).mockResolvedValue(mockGlobalLinkPath);

      const mockChild = createMockChild({ exitCode: 0 });
      vi.mocked(spawn).mockReturnValue(mockChild);

      const resultPromise = linkGroundswellLocally(previousResult);
      await vi.runAllTimersAsync();

      const result: GroundswellLocalLinkResult = await resultPromise;

      // Check result structure
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('message');
      expect(result).toHaveProperty('symlinkPath');
      expect(result).toHaveProperty('stdout');
      expect(result).toHaveProperty('stderr');
      expect(result).toHaveProperty('exitCode');

      // Check types
      expect(typeof result.success).toBe('boolean');
      expect(typeof result.message).toBe('string');
      expect(typeof result.symlinkPath).toBe('string');
      expect(typeof result.stdout).toBe('string');
      expect(typeof result.stderr).toBe('string');

      // exitCode can be number or null
      expect(
        result.exitCode === null || typeof result.exitCode === 'number'
      ).toBe(true);
    });

    it('should include symlinkTarget when verification succeeds', async () => {
      const previousResult: GroundswellLinkResult = {
        success: true,
        message: 'Global link succeeded',
        stdout: '',
        stderr: '',
        exitCode: 0,
      };

      vi.mocked(lstatSync).mockReturnValue({
        isSymbolicLink: () => true,
      } as ReturnType<typeof lstatSync>);

      vi.mocked(readlinkSync).mockReturnValue(mockGlobalLinkPath);

      const mockChild = createMockChild({ exitCode: 0 });
      vi.mocked(spawn).mockReturnValue(mockChild);

      const resultPromise = linkGroundswellLocally(previousResult);
      await vi.runAllTimersAsync();

      const result = await resultPromise;

      expect(result.symlinkTarget).toBeDefined();
      expect(result.symlinkTarget).toBe(mockGlobalLinkPath);
    });

    it('should not include symlinkTarget when verification fails', async () => {
      const previousResult: GroundswellLinkResult = {
        success: true,
        message: 'Global link succeeded',
        stdout: '',
        stderr: '',
        exitCode: 0,
      };

      const mockChild = createMockChild({ exitCode: 0 });
      vi.mocked(spawn).mockReturnValue(mockChild);

      // linkGroundswellLocally() calls the SYNC lstatSync in the close-callback;
      // a sync fs function THROWS (not rejects) on a missing path.
      vi.mocked(lstatSync).mockImplementation(() => {
        const e = new Error('ENOENT: not found') as NodeJS.ErrnoException;
        e.code = 'ENOENT';
        throw e;
      });

      const resultPromise = linkGroundswellLocally(previousResult);
      await vi.runAllTimersAsync();

      const result = await resultPromise;

      expect(result.symlinkTarget).toBeUndefined();
    });

    it('should include optional error property when verification fails', async () => {
      const previousResult: GroundswellLinkResult = {
        success: true,
        message: 'Global link succeeded',
        stdout: '',
        stderr: '',
        exitCode: 0,
      };

      const mockChild = createMockChild({ exitCode: 0 });
      vi.mocked(spawn).mockReturnValue(mockChild);

      // linkGroundswellLocally() calls the SYNC lstatSync in the close-callback;
      // a sync fs function THROWS (not rejects) on a missing path.
      vi.mocked(lstatSync).mockImplementation(() => {
        const e = new Error('ENOENT: not found') as NodeJS.ErrnoException;
        e.code = 'ENOENT';
        throw e;
      });

      const resultPromise = linkGroundswellLocally(previousResult);
      await vi.runAllTimersAsync();

      const result = await resultPromise;

      expect(result.error).toBe('ENOENT');
    });

    it('should not include error property on successful link', async () => {
      const previousResult: GroundswellLinkResult = {
        success: true,
        message: 'Global link succeeded',
        stdout: '',
        stderr: '',
        exitCode: 0,
      };

      vi.mocked(lstatSync).mockReturnValue({
        isSymbolicLink: () => true,
      } as ReturnType<typeof lstatSync>);

      vi.mocked(readlinkSync).mockReturnValue(mockGlobalLinkPath);

      const mockChild = createMockChild({ exitCode: 0 });
      vi.mocked(spawn).mockReturnValue(mockChild);

      const resultPromise = linkGroundswellLocally(previousResult);
      await vi.runAllTimersAsync();

      const result = await resultPromise;

      expect(result.error).toBeUndefined();
    });
  });

  // ========================================================================
  // Spawn arguments tests
  // ========================================================================

  describe('Spawn arguments', () => {
    it('should spawn npm with link groundswell command', async () => {
      const previousResult: GroundswellLinkResult = {
        success: true,
        message: 'Global link succeeded',
        stdout: '',
        stderr: '',
        exitCode: 0,
      };

      vi.mocked(lstat).mockResolvedValue({
        isSymbolicLink: () => true,
      } as ReturnType<typeof lstat>);

      vi.mocked(readlink).mockResolvedValue(mockGlobalLinkPath);

      const mockChild = createMockChild({ exitCode: 0 });
      vi.mocked(spawn).mockReturnValue(mockChild);

      const resultPromise = linkGroundswellLocally(previousResult);
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(spawn).toHaveBeenCalledWith(
        'npm',
        ['link', 'groundswell'],
        expect.anything()
      );
    });

    it('should use shell: false to prevent injection', async () => {
      const previousResult: GroundswellLinkResult = {
        success: true,
        message: 'Global link succeeded',
        stdout: '',
        stderr: '',
        exitCode: 0,
      };

      vi.mocked(lstat).mockResolvedValue({
        isSymbolicLink: () => true,
      } as ReturnType<typeof lstat>);

      vi.mocked(readlink).mockResolvedValue(mockGlobalLinkPath);

      const mockChild = createMockChild({ exitCode: 0 });
      vi.mocked(spawn).mockReturnValue(mockChild);

      const resultPromise = linkGroundswellLocally(previousResult);
      await vi.runAllTimersAsync();
      await resultPromise;

      const spawnOptions = vi.mocked(spawn).mock.calls[0]?.[2];
      expect(spawnOptions?.shell).toBe(false);
    });

    it('should use stdio ignore, pipe, pipe', async () => {
      const previousResult: GroundswellLinkResult = {
        success: true,
        message: 'Global link succeeded',
        stdout: '',
        stderr: '',
        exitCode: 0,
      };

      vi.mocked(lstat).mockResolvedValue({
        isSymbolicLink: () => true,
      } as ReturnType<typeof lstat>);

      vi.mocked(readlink).mockResolvedValue(mockGlobalLinkPath);

      const mockChild = createMockChild({ exitCode: 0 });
      vi.mocked(spawn).mockReturnValue(mockChild);

      const resultPromise = linkGroundswellLocally(previousResult);
      await vi.runAllTimersAsync();
      await resultPromise;

      const spawnOptions = vi.mocked(spawn).mock.calls[0]?.[2];
      expect(spawnOptions?.stdio).toEqual(['ignore', 'pipe', 'pipe']);
    });
  });

  // ========================================================================
  // Integration tests
  // ========================================================================

  describe('Integration with linkGroundswell', () => {
    it('should support full workflow: global link then local link', async () => {
      // First, S2 succeeds
      const globalResult: GroundswellLinkResult = {
        success: true,
        message: 'Successfully linked Groundswell at /path/to/groundswell',
        stdout: 'linked globally',
        stderr: '',
        exitCode: 0,
      };

      // Then S3 (local link) should proceed
      vi.mocked(lstatSync).mockReturnValue({
        isSymbolicLink: () => true,
      } as ReturnType<typeof lstatSync>);

      vi.mocked(readlinkSync).mockReturnValue(mockGlobalLinkPath);

      const mockChild = createMockChild({ exitCode: 0 });
      vi.mocked(spawn).mockReturnValue(mockChild);

      const resultPromise = linkGroundswellLocally(globalResult);
      await vi.runAllTimersAsync();

      const localResult = await resultPromise;

      expect(localResult.success).toBe(true);
      expect(spawn).toHaveBeenCalledWith(
        'npm',
        ['link', 'groundswell'],
        expect.anything()
      );
    });

    it('should fail fast if global link failed', async () => {
      // Global link failed
      const globalResult: GroundswellLinkResult = {
        success: false,
        message: 'npm link failed with exit code 1',
        stdout: '',
        stderr: 'npm ERR!',
        exitCode: 1,
      };

      // Local link should skip without calling spawn
      const result = await linkGroundswellLocally(globalResult);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Skipped');
      expect(spawn).not.toHaveBeenCalled();
    });
  });
});

// =============================================================================
// TEST SUITE: verifyGroundswellSymlink
// ============================================================================

describe('verifyGroundswellSymlink', () => {
  const mockProjectPath = '/home/dustin/projects/hacky-hack';
  const mockSymlinkPath = `${mockProjectPath}/node_modules/groundswell`;
  const mockSymlinkTarget = '../../../projects/groundswell';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ========================================================================
  // Conditional execution tests (input validation based on S3 result)
  // ========================================================================

  describe('Conditional execution based on S3 result', () => {
    it('should skip verification when previousResult.success is false', async () => {
      const previousResult: GroundswellLocalLinkResult = {
        success: false,
        message: 'npm link groundswell failed with exit code 1',
        symlinkPath: mockSymlinkPath,
        stdout: '',
        stderr: 'npm ERR!',
        exitCode: 1,
      };

      const result = await verifyGroundswellSymlink(previousResult);

      expect(result.exists).toBe(false);
      expect(result.message).toContain('Skipped: Local link failed');
      expect(result.message).toContain('npm link groundswell failed');
      expect(result.error).toBeUndefined();
    });

    it('should not call lstat when skipping due to S3 failure', async () => {
      const previousResult: GroundswellLocalLinkResult = {
        success: false,
        message: 'Local link failed',
        symlinkPath: mockSymlinkPath,
        stdout: '',
        stderr: '',
        exitCode: 1,
      };

      await verifyGroundswellSymlink(previousResult);

      expect(lstat).not.toHaveBeenCalled();
    });

    it('should include previousResult.message in skip message', async () => {
      const customMessage = 'Custom failure message from S3';
      const previousResult: GroundswellLocalLinkResult = {
        success: false,
        message: customMessage,
        symlinkPath: mockSymlinkPath,
        stdout: '',
        stderr: '',
        exitCode: 127,
      };

      const result = await verifyGroundswellSymlink(previousResult);

      expect(result.message).toContain(customMessage);
    });

    it('should return correct path even when skipping', async () => {
      const previousResult: GroundswellLocalLinkResult = {
        success: false,
        message: 'Failed',
        symlinkPath: '/custom/symlink/path',
        stdout: '',
        stderr: '',
        exitCode: 1,
      };

      const result = await verifyGroundswellSymlink(previousResult);

      expect(result.path).toContain('node_modules/groundswell');
    });
  });

  // ========================================================================
  // Happy path tests - symlink exists
  // ========================================================================

  describe('Happy path - symlink exists and is valid', () => {
    it('should return exists: true when symlink is valid', async () => {
      const previousResult: GroundswellLocalLinkResult = {
        success: true,
        message: 'Successfully linked groundswell locally',
        symlinkPath: mockSymlinkPath,
        symlinkTarget: mockSymlinkTarget,
        stdout: 'linked',
        stderr: '',
        exitCode: 0,
      };

      vi.mocked(lstat).mockResolvedValue({
        isSymbolicLink: () => true,
      } as ReturnType<typeof lstat>);

      vi.mocked(readlink).mockResolvedValue(mockSymlinkTarget);

      const result = await verifyGroundswellSymlink(previousResult);

      expect(result.exists).toBe(true);
      expect(result.symlinkTarget).toBe(mockSymlinkTarget);
      expect(result.error).toBeUndefined();
    });

    it('should use default project path when no options provided', async () => {
      const previousResult: GroundswellLocalLinkResult = {
        success: true,
        message: 'Local link succeeded',
        symlinkPath: mockSymlinkPath,
        stdout: '',
        stderr: '',
        exitCode: 0,
      };

      vi.mocked(lstat).mockResolvedValue({
        isSymbolicLink: () => true,
      } as ReturnType<typeof lstat>);

      vi.mocked(readlink).mockResolvedValue(mockSymlinkTarget);

      await verifyGroundswellSymlink(previousResult);

      expect(lstat).toHaveBeenCalledWith(
        '/home/dustin/projects/hacky-hack/node_modules/groundswell'
      );
    });

    it('should use custom project path when provided', async () => {
      const previousResult: GroundswellLocalLinkResult = {
        success: true,
        message: 'Local link succeeded',
        symlinkPath: mockSymlinkPath,
        stdout: '',
        stderr: '',
        exitCode: 0,
      };

      const customProjectPath = '/custom/project/path';
      vi.mocked(lstat).mockResolvedValue({
        isSymbolicLink: () => true,
      } as ReturnType<typeof lstat>);

      vi.mocked(readlink).mockResolvedValue(mockSymlinkTarget);

      await verifyGroundswellSymlink(previousResult, {
        projectPath: customProjectPath,
      });

      expect(lstat).toHaveBeenCalledWith(
        '/custom/project/path/node_modules/groundswell'
      );
    });

    it('should include symlink target in success message', async () => {
      const previousResult: GroundswellLocalLinkResult = {
        success: true,
        message: 'Local link succeeded',
        symlinkPath: mockSymlinkPath,
        stdout: '',
        stderr: '',
        exitCode: 0,
      };

      const customTarget = '/custom/target/path';
      vi.mocked(lstat).mockResolvedValue({
        isSymbolicLink: () => true,
      } as ReturnType<typeof lstat>);

      vi.mocked(readlink).mockResolvedValue(customTarget);

      const result = await verifyGroundswellSymlink(previousResult);

      expect(result.message).toContain(customTarget);
      expect(result.message).toContain('Symlink verified at');
    });

    it('should call readlink after lstat confirms symlink', async () => {
      const previousResult: GroundswellLocalLinkResult = {
        success: true,
        message: 'Local link succeeded',
        symlinkPath: mockSymlinkPath,
        stdout: '',
        stderr: '',
        exitCode: 0,
      };

      vi.mocked(lstat).mockResolvedValue({
        isSymbolicLink: () => true,
      } as ReturnType<typeof lstat>);

      vi.mocked(readlink).mockResolvedValue(mockSymlinkTarget);

      await verifyGroundswellSymlink(previousResult);

      expect(readlink).toHaveBeenCalledWith(mockSymlinkPath);
    });
  });

  // ========================================================================
  // Symlink detection errors
  // ========================================================================

  describe('Symlink detection errors', () => {
    it('should return exists: false when path is not a symlink', async () => {
      const previousResult: GroundswellLocalLinkResult = {
        success: true,
        message: 'Local link succeeded',
        symlinkPath: mockSymlinkPath,
        stdout: '',
        stderr: '',
        exitCode: 0,
      };

      vi.mocked(lstat).mockResolvedValue({
        isSymbolicLink: () => false,
      } as ReturnType<typeof lstat>);

      const result = await verifyGroundswellSymlink(previousResult);

      expect(result.exists).toBe(false);
      expect(result.error).toBe('Not a symlink');
      expect(result.message).toContain('not a symbolic link');
    });

    it('should return exists: false when path does not exist (ENOENT)', async () => {
      const previousResult: GroundswellLocalLinkResult = {
        success: true,
        message: 'Local link succeeded',
        symlinkPath: mockSymlinkPath,
        stdout: '',
        stderr: '',
        exitCode: 0,
      };

      vi.mocked(lstat).mockRejectedValue({
        code: 'ENOENT',
        message: 'no such file or directory',
      } as NodeJS.ErrnoException);

      const result = await verifyGroundswellSymlink(previousResult);

      expect(result.exists).toBe(false);
      expect(result.error).toBe('ENOENT');
      expect(result.message).toContain('Symlink not found');
    });

    it('should return exists: false with EACCES error (permission denied)', async () => {
      const previousResult: GroundswellLocalLinkResult = {
        success: true,
        message: 'Local link succeeded',
        symlinkPath: mockSymlinkPath,
        stdout: '',
        stderr: '',
        exitCode: 0,
      };

      vi.mocked(lstat).mockRejectedValue({
        code: 'EACCES',
        message: 'permission denied',
      } as NodeJS.ErrnoException);

      const result = await verifyGroundswellSymlink(previousResult);

      expect(result.exists).toBe(false);
      expect(result.error).toBe('EACCES');
      expect(result.message).toContain('Permission denied');
    });

    it('should return exists: false with generic error for unknown error codes', async () => {
      const previousResult: GroundswellLocalLinkResult = {
        success: true,
        message: 'Local link succeeded',
        symlinkPath: mockSymlinkPath,
        stdout: '',
        stderr: '',
        exitCode: 0,
      };

      vi.mocked(lstat).mockRejectedValue({
        code: 'EPERM',
        message: 'operation not permitted',
      } as NodeJS.ErrnoException);

      const result = await verifyGroundswellSymlink(previousResult);

      expect(result.exists).toBe(false);
      expect(result.error).toBe('EPERM');
      expect(result.message).toContain('Verification failed');
    });

    it('should handle error without code property', async () => {
      const previousResult: GroundswellLocalLinkResult = {
        success: true,
        message: 'Local link succeeded',
        symlinkPath: mockSymlinkPath,
        stdout: '',
        stderr: '',
        exitCode: 0,
      };

      vi.mocked(lstat).mockRejectedValue({
        message: 'Some unknown error',
      } as NodeJS.ErrnoException);

      const result = await verifyGroundswellSymlink(previousResult);

      expect(result.exists).toBe(false);
      expect(result.error).toBe('UNKNOWN');
      expect(result.message).toContain('Some unknown error');
    });

    it('should handle error without message or code', async () => {
      const previousResult: GroundswellLocalLinkResult = {
        success: true,
        message: 'Local link succeeded',
        symlinkPath: mockSymlinkPath,
        stdout: '',
        stderr: '',
        exitCode: 0,
      };

      vi.mocked(lstat).mockRejectedValue({});

      const result = await verifyGroundswellSymlink(previousResult);

      expect(result.exists).toBe(false);
      expect(result.error).toBe('UNKNOWN');
      expect(result.message).toContain('Unknown error');
    });

    it('should handle readlink() errors gracefully', async () => {
      const previousResult: GroundswellLocalLinkResult = {
        success: true,
        message: 'Local link succeeded',
        symlinkPath: mockSymlinkPath,
        stdout: '',
        stderr: '',
        exitCode: 0,
      };

      vi.mocked(lstat).mockResolvedValue({
        isSymbolicLink: () => true,
      } as ReturnType<typeof lstat>);

      vi.mocked(readlink).mockRejectedValue({
        code: 'EINVAL',
        message: 'invalid argument',
      } as NodeJS.ErrnoException);

      const result = await verifyGroundswellSymlink(previousResult);

      expect(result.exists).toBe(false);
      expect(result.error).toBe('EINVAL');
    });
  });

  // ========================================================================
  // Result structure tests
  // ========================================================================

  describe('GroundswellSymlinkVerifyResult structure', () => {
    it('should return complete result object on successful verification', async () => {
      const previousResult: GroundswellLocalLinkResult = {
        success: true,
        message: 'Local link succeeded',
        symlinkPath: mockSymlinkPath,
        stdout: '',
        stderr: '',
        exitCode: 0,
      };

      vi.mocked(lstat).mockResolvedValue({
        isSymbolicLink: () => true,
      } as ReturnType<typeof lstat>);

      vi.mocked(readlink).mockResolvedValue(mockSymlinkTarget);

      const result: GroundswellSymlinkVerifyResult =
        await verifyGroundswellSymlink(previousResult);

      expect(result).toHaveProperty('exists');
      expect(result).toHaveProperty('path');
      expect(result).toHaveProperty('message');
      expect(result).toHaveProperty('symlinkTarget');

      expect(typeof result.exists).toBe('boolean');
      expect(typeof result.path).toBe('string');
      expect(typeof result.message).toBe('string');
    });

    it('should populate symlinkTarget when verification succeeds', async () => {
      const previousResult: GroundswellLocalLinkResult = {
        success: true,
        message: 'Local link succeeded',
        symlinkPath: mockSymlinkPath,
        stdout: '',
        stderr: '',
        exitCode: 0,
      };

      const expectedTarget = '../../../projects/groundswell';
      vi.mocked(lstat).mockResolvedValue({
        isSymbolicLink: () => true,
      } as ReturnType<typeof lstat>);

      vi.mocked(readlink).mockResolvedValue(expectedTarget);

      const result = await verifyGroundswellSymlink(previousResult);

      expect(result.symlinkTarget).toBe(expectedTarget);
    });

    it('should not include symlinkTarget when verification fails', async () => {
      const previousResult: GroundswellLocalLinkResult = {
        success: true,
        message: 'Local link succeeded',
        symlinkPath: mockSymlinkPath,
        stdout: '',
        stderr: '',
        exitCode: 0,
      };

      vi.mocked(lstat).mockRejectedValue({
        code: 'ENOENT',
        message: 'not found',
      } as NodeJS.ErrnoException);

      const result = await verifyGroundswellSymlink(previousResult);

      expect(result.symlinkTarget).toBeUndefined();
    });

    it('should include error field when verification fails', async () => {
      const previousResult: GroundswellLocalLinkResult = {
        success: true,
        message: 'Local link succeeded',
        symlinkPath: mockSymlinkPath,
        stdout: '',
        stderr: '',
        exitCode: 0,
      };

      vi.mocked(lstat).mockRejectedValue({
        code: 'ENOENT',
        message: 'not found',
      } as NodeJS.ErrnoException);

      const result = await verifyGroundswellSymlink(previousResult);

      expect(result.error).toBe('ENOENT');
    });

    it('should not include error property on successful verification', async () => {
      const previousResult: GroundswellLocalLinkResult = {
        success: true,
        message: 'Local link succeeded',
        symlinkPath: mockSymlinkPath,
        stdout: '',
        stderr: '',
        exitCode: 0,
      };

      vi.mocked(lstat).mockResolvedValue({
        isSymbolicLink: () => true,
      } as ReturnType<typeof lstat>);

      vi.mocked(readlink).mockResolvedValue(mockSymlinkTarget);

      const result = await verifyGroundswellSymlink(previousResult);

      expect(result.error).toBeUndefined();
    });
  });

  // ========================================================================
  // Integration with S3 tests
  // ========================================================================

  describe('Integration with S3 (linkGroundswellLocally)', () => {
    it('should consume S3 result correctly when S3 succeeded', async () => {
      const previousResult: GroundswellLocalLinkResult = {
        success: true,
        message: 'Successfully linked groundswell in project',
        symlinkPath: mockSymlinkPath,
        symlinkTarget: mockSymlinkTarget,
        stdout: 'linked',
        stderr: '',
        exitCode: 0,
      };

      vi.mocked(lstat).mockResolvedValue({
        isSymbolicLink: () => true,
      } as ReturnType<typeof lstat>);

      vi.mocked(readlink).mockResolvedValue(mockSymlinkTarget);

      const result = await verifyGroundswellSymlink(previousResult);

      expect(result.exists).toBe(true);
      expect(lstat).toHaveBeenCalled();
    });

    it('should consume S3 result correctly when S3 failed', async () => {
      const previousResult: GroundswellLocalLinkResult = {
        success: false,
        message: 'npm link groundswell failed',
        symlinkPath: mockSymlinkPath,
        stdout: '',
        stderr: 'npm ERR!',
        exitCode: 1,
      };

      const result = await verifyGroundswellSymlink(previousResult);

      expect(result.exists).toBe(false);
      expect(result.message).toContain('Skipped');
      expect(lstat).not.toHaveBeenCalled();
    });

    it('should pass through S3 error messages on skip', async () => {
      const s3ErrorMessage = 'npm link groundswell failed with exit code 127';
      const previousResult: GroundswellLocalLinkResult = {
        success: false,
        message: s3ErrorMessage,
        symlinkPath: mockSymlinkPath,
        stdout: '',
        stderr: 'npm ERR!',
        exitCode: 127,
      };

      const result = await verifyGroundswellSymlink(previousResult);

      expect(result.message).toContain(s3ErrorMessage);
    });

    it('should support chaining S3 -> S4 -> S5 workflow', async () => {
      // S3 result
      const s3Result: GroundswellLocalLinkResult = {
        success: true,
        message: 'Successfully linked groundswell in project',
        symlinkPath: mockSymlinkPath,
        symlinkTarget: mockSymlinkTarget,
        stdout: 'linked',
        stderr: '',
        exitCode: 0,
      };

      // S4 verification
      vi.mocked(lstat).mockResolvedValue({
        isSymbolicLink: () => true,
      } as ReturnType<typeof lstat>);

      vi.mocked(readlink).mockResolvedValue(mockSymlinkTarget);

      const s4Result = await verifyGroundswellSymlink(s3Result);

      // Verify S4 result is ready for S5 consumption
      expect(s4Result.exists).toBe(true);
      expect(s4Result.symlinkTarget).toBeDefined();
      expect(typeof s4Result.symlinkTarget).toBe('string');
    });
  });

  // ========================================================================
  // Additional edge case tests
  // ========================================================================

  describe('Edge cases', () => {
    it('should handle relative symlink targets', async () => {
      const previousResult: GroundswellLocalLinkResult = {
        success: true,
        message: 'Local link succeeded',
        symlinkPath: mockSymlinkPath,
        stdout: '',
        stderr: '',
        exitCode: 0,
      };

      const relativeTarget = '../../../projects/groundswell';
      vi.mocked(lstat).mockResolvedValue({
        isSymbolicLink: () => true,
      } as ReturnType<typeof lstat>);

      vi.mocked(readlink).mockResolvedValue(relativeTarget);

      const result = await verifyGroundswellSymlink(previousResult);

      expect(result.symlinkTarget).toBe(relativeTarget);
      expect(result.exists).toBe(true);
    });

    it('should handle absolute symlink targets', async () => {
      const previousResult: GroundswellLocalLinkResult = {
        success: true,
        message: 'Local link succeeded',
        symlinkPath: mockSymlinkPath,
        stdout: '',
        stderr: '',
        exitCode: 0,
      };

      const absoluteTarget = '/home/dustin/projects/groundswell';
      vi.mocked(lstat).mockResolvedValue({
        isSymbolicLink: () => true,
      } as ReturnType<typeof lstat>);

      vi.mocked(readlink).mockResolvedValue(absoluteTarget);

      const result = await verifyGroundswellSymlink(previousResult);

      expect(result.symlinkTarget).toBe(absoluteTarget);
      expect(result.exists).toBe(true);
    });

    it('should handle empty symlink target', async () => {
      const previousResult: GroundswellLocalLinkResult = {
        success: true,
        message: 'Local link succeeded',
        symlinkPath: mockSymlinkPath,
        stdout: '',
        stderr: '',
        exitCode: 0,
      };

      vi.mocked(lstat).mockResolvedValue({
        isSymbolicLink: () => true,
      } as ReturnType<typeof lstat>);

      vi.mocked(readlink).mockResolvedValue('');

      const result = await verifyGroundswellSymlink(previousResult);

      expect(result.symlinkTarget).toBe('');
      expect(result.exists).toBe(true);
    });

    it('should handle S3 result with undefined symlinkTarget', async () => {
      const previousResult: GroundswellLocalLinkResult = {
        success: true,
        message: 'Local link succeeded',
        symlinkPath: mockSymlinkPath,
        stdout: '',
        stderr: '',
        exitCode: 0,
      };

      vi.mocked(lstat).mockResolvedValue({
        isSymbolicLink: () => true,
      } as ReturnType<typeof lstat>);

      vi.mocked(readlink).mockResolvedValue(mockSymlinkTarget);

      const result = await verifyGroundswellSymlink(previousResult);

      // S4 should re-verify independently, not rely on S3's symlinkTarget
      expect(result.exists).toBe(true);
      expect(result.symlinkTarget).toBe(mockSymlinkTarget);
    });

    it('should handle S3 result with defined symlinkTarget', async () => {
      const previousResult: GroundswellLocalLinkResult = {
        success: true,
        message: 'Local link succeeded',
        symlinkPath: mockSymlinkPath,
        symlinkTarget: mockSymlinkTarget,
        stdout: '',
        stderr: '',
        exitCode: 0,
      };

      vi.mocked(lstat).mockResolvedValue({
        isSymbolicLink: () => true,
      } as ReturnType<typeof lstat>);

      vi.mocked(readlink).mockResolvedValue(mockSymlinkTarget);

      const result = await verifyGroundswellSymlink(previousResult);

      expect(result.exists).toBe(true);
      expect(result.symlinkTarget).toBe(mockSymlinkTarget);
    });
  });

  // ========================================================================
  // Type safety tests
  // ========================================================================

  describe('Type safety', () => {
    it('should accept GroundswellLocalLinkResult as first parameter', async () => {
      const previousResult: GroundswellLocalLinkResult = {
        success: true,
        message: 'Local link succeeded',
        symlinkPath: mockSymlinkPath,
        stdout: '',
        stderr: '',
        exitCode: 0,
      };

      vi.mocked(lstat).mockResolvedValue({
        isSymbolicLink: () => true,
      } as ReturnType<typeof lstat>);

      vi.mocked(readlink).mockResolvedValue(mockSymlinkTarget);

      const result = await verifyGroundswellSymlink(previousResult);

      expect(result.exists).toBe(true);
    });

    it('should accept GroundswellSymlinkVerifyOptions as second parameter', async () => {
      const previousResult: GroundswellLocalLinkResult = {
        success: true,
        message: 'Local link succeeded',
        symlinkPath: mockSymlinkPath,
        stdout: '',
        stderr: '',
        exitCode: 0,
      };

      const options: GroundswellSymlinkVerifyOptions = {
        projectPath: '/custom/path',
      };

      vi.mocked(lstat).mockResolvedValue({
        isSymbolicLink: () => true,
      } as ReturnType<typeof lstat>);

      vi.mocked(readlink).mockResolvedValue(mockSymlinkTarget);

      const result = await verifyGroundswellSymlink(previousResult, options);

      expect(result.exists).toBe(true);
    });

    it('should accept undefined as second parameter', async () => {
      const previousResult: GroundswellLocalLinkResult = {
        success: true,
        message: 'Local link succeeded',
        symlinkPath: mockSymlinkPath,
        stdout: '',
        stderr: '',
        exitCode: 0,
      };

      vi.mocked(lstat).mockResolvedValue({
        isSymbolicLink: () => true,
      } as ReturnType<typeof lstat>);

      vi.mocked(readlink).mockResolvedValue(mockSymlinkTarget);

      const result = await verifyGroundswellSymlink(previousResult, undefined);

      expect(result.exists).toBe(true);
    });

    it('should return GroundswellSymlinkVerifyResult', async () => {
      const previousResult: GroundswellLocalLinkResult = {
        success: true,
        message: 'Local link succeeded',
        symlinkPath: mockSymlinkPath,
        stdout: '',
        stderr: '',
        exitCode: 0,
      };

      vi.mocked(lstat).mockResolvedValue({
        isSymbolicLink: () => true,
      } as ReturnType<typeof lstat>);

      vi.mocked(readlink).mockResolvedValue(mockSymlinkTarget);

      const result: GroundswellSymlinkVerifyResult =
        await verifyGroundswellSymlink(previousResult);

      expect(typeof result.exists).toBe('boolean');
      expect(typeof result.path).toBe('string');
      expect(typeof result.message).toBe('string');
    });
  });
});

// =============================================================================
// TEST SUITE: verifyGroundswellNpmList
// ============================================================================

describe('verifyGroundswellNpmList', () => {
  const mockProjectPath = '/home/dustin/projects/hacky-hack';
  const mockSymlinkPath = `${mockProjectPath}/node_modules/groundswell`;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // ========================================================================
  // Conditional execution tests
  // ========================================================================

  describe('Conditional execution based on S4 result', () => {
    it('should skip verification when previousResult.exists is false', async () => {
      const s4Result: GroundswellSymlinkVerifyResult = {
        exists: false,
        path: mockSymlinkPath,
        message: 'Symlink not found',
        error: 'ENOENT',
      };

      const result = await verifyGroundswellNpmList(s4Result);

      expect(result.linked).toBe(false);
      expect(spawn).not.toHaveBeenCalled();
      expect(result.message).toContain('Skipped');
    });

    it('should include previousResult.message when skipping', async () => {
      const customMessage = 'Custom S4 error message';
      const s4Result: GroundswellSymlinkVerifyResult = {
        exists: false,
        path: mockSymlinkPath,
        message: customMessage,
        error: 'Custom error',
      };

      const result = await verifyGroundswellNpmList(s4Result);

      expect(result.message).toContain(customMessage);
    });

    it('should execute npm list when previousResult.exists is true', async () => {
      const s4Result: GroundswellSymlinkVerifyResult = {
        exists: true,
        path: mockSymlinkPath,
        symlinkTarget: '../../../projects/groundswell',
        message: 'Symlink verified',
      };

      const mockChild = createMockChild({
        exitCode: 0,
        stdout: JSON.stringify({
          version: '0.1.0',
          name: 'hacky-hack',
          dependencies: {
            groundswell: { version: '1.0.0' },
          },
        }),
      });
      vi.mocked(spawn).mockReturnValue(mockChild);

      const resultPromise = verifyGroundswellNpmList(s4Result);
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(spawn).toHaveBeenCalledWith(
        'npm',
        ['list', 'groundswell', '--json', '--depth=0'],
        expect.anything()
      );
    });
  });

  // ========================================================================
  // Happy path tests
  // ========================================================================

  describe('Successful npm list verification', () => {
    it('should return linked: true when npm list shows groundswell in dependencies', async () => {
      const s4Result: GroundswellSymlinkVerifyResult = {
        exists: true,
        path: mockSymlinkPath,
        message: 'Symlink verified',
      };

      const npmOutput = {
        version: '0.1.0',
        name: 'hacky-hack',
        dependencies: {
          groundswell: {
            version: '1.0.0',
            resolved: 'file:../../groundswell',
          },
        },
      };

      const mockChild = createMockChild({
        exitCode: 0,
        stdout: JSON.stringify(npmOutput),
      });
      vi.mocked(spawn).mockReturnValue(mockChild);

      const resultPromise = verifyGroundswellNpmList(s4Result);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.linked).toBe(true);
      expect(result.version).toBe('1.0.0');
      expect(result.exitCode).toBe(0);
      expect(result.message).toContain('npm list confirms');
    });

    it('should handle linked packages without version field', async () => {
      const s4Result: GroundswellSymlinkVerifyResult = {
        exists: true,
        path: mockSymlinkPath,
        message: 'Symlink verified',
      };

      const npmOutput = {
        version: '0.1.0',
        name: 'hacky-hack',
        dependencies: {
          groundswell: {
            resolved: 'file:../../groundswell',
            // version field may be missing for linked packages
          },
        },
      };

      const mockChild = createMockChild({
        exitCode: 0,
        stdout: JSON.stringify(npmOutput),
      });
      vi.mocked(spawn).mockReturnValue(mockChild);

      const resultPromise = verifyGroundswellNpmList(s4Result);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.linked).toBe(true);
      expect(result.version).toBeUndefined();
    });

    it('should use default timeout when no options provided', async () => {
      const s4Result: GroundswellSymlinkVerifyResult = {
        exists: true,
        path: mockSymlinkPath,
        message: 'Symlink verified',
      };

      const mockChild = createMockChild({
        exitCode: 0,
        stdout: JSON.stringify({
          version: '0.1.0',
          name: 'hacky-hack',
          dependencies: { groundswell: { version: '1.0.0' } },
        }),
      });
      vi.mocked(spawn).mockReturnValue(mockChild);

      const resultPromise = verifyGroundswellNpmList(s4Result);
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(spawn).toHaveBeenCalledWith(
        'npm',
        ['list', 'groundswell', '--json', '--depth=0'],
        expect.anything()
      );
    });

    it('should accept custom timeout option', async () => {
      const s4Result: GroundswellSymlinkVerifyResult = {
        exists: true,
        path: mockSymlinkPath,
        message: 'Symlink verified',
      };

      const mockChild = createMockChild({
        exitCode: 0,
        stdout: JSON.stringify({
          version: '0.1.0',
          name: 'hacky-hack',
          dependencies: { groundswell: { version: '1.0.0' } },
        }),
      });
      vi.mocked(spawn).mockReturnValue(mockChild);

      const resultPromise = verifyGroundswellNpmList(s4Result, {
        timeout: 5000,
      });
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.linked).toBe(true);
    });

    it('should accept custom projectPath option', async () => {
      const s4Result: GroundswellSymlinkVerifyResult = {
        exists: true,
        path: mockSymlinkPath,
        message: 'Symlink verified',
      };

      const mockChild = createMockChild({
        exitCode: 0,
        stdout: JSON.stringify({
          version: '0.1.0',
          name: 'hacky-hack',
          dependencies: { groundswell: { version: '1.0.0' } },
        }),
      });
      vi.mocked(spawn).mockReturnValue(mockChild);

      const customProjectPath = '/custom/project/path';
      const resultPromise = verifyGroundswellNpmList(s4Result, {
        projectPath: customProjectPath,
      });
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(spawn).toHaveBeenCalledWith(
        'npm',
        ['list', 'groundswell', '--json', '--depth=0'],
        expect.objectContaining({ cwd: customProjectPath })
      );
      expect(result.linked).toBe(true);
    });

    it('should capture stdout content from npm list command', async () => {
      const s4Result: GroundswellSymlinkVerifyResult = {
        exists: true,
        path: mockSymlinkPath,
        message: 'Symlink verified',
      };

      const expectedStdout = JSON.stringify({
        version: '0.1.0',
        name: 'hacky-hack',
        dependencies: { groundswell: { version: '1.0.0' } },
      });

      const mockChild = createMockChild({
        exitCode: 0,
        stdout: expectedStdout,
      });
      vi.mocked(spawn).mockReturnValue(mockChild);

      const resultPromise = verifyGroundswellNpmList(s4Result);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.stdout).toBe(expectedStdout);
    });

    it('should capture stderr content from npm list command', async () => {
      const s4Result: GroundswellSymlinkVerifyResult = {
        exists: true,
        path: mockSymlinkPath,
        message: 'Symlink verified',
      };

      const expectedStderr = 'npm notice';

      const mockChild = createMockChild({
        exitCode: 0,
        stdout: JSON.stringify({
          version: '0.1.0',
          name: 'hacky-hack',
          dependencies: { groundswell: { version: '1.0.0' } },
        }),
        stderr: expectedStderr,
      });
      vi.mocked(spawn).mockReturnValue(mockChild);

      const resultPromise = verifyGroundswellNpmList(s4Result);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.stderr).toBe(expectedStderr);
    });
  });

  // ========================================================================
  // Package not found tests
  // ========================================================================

  describe('Package not found scenarios', () => {
    it('should return linked: false when package not in dependencies (exit code 1)', async () => {
      const s4Result: GroundswellSymlinkVerifyResult = {
        exists: true,
        path: mockSymlinkPath,
        message: 'Symlink verified',
      };

      const npmOutput = {
        version: '0.1.0',
        name: 'hacky-hack',
        // dependencies object does not contain groundswell
      };

      const mockChild = createMockChild({
        exitCode: 1,
        stdout: JSON.stringify(npmOutput),
      });
      vi.mocked(spawn).mockReturnValue(mockChild);

      const resultPromise = verifyGroundswellNpmList(s4Result);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.linked).toBe(false);
      expect(result.exitCode).toBe(1);
      expect(result.message).toContain('not found in dependency tree');
    });

    it('should handle empty dependencies object', async () => {
      const s4Result: GroundswellSymlinkVerifyResult = {
        exists: true,
        path: mockSymlinkPath,
        message: 'Symlink verified',
      };

      const npmOutput = {
        version: '0.1.0',
        name: 'hacky-hack',
        dependencies: {},
      };

      const mockChild = createMockChild({
        exitCode: 1,
        stdout: JSON.stringify(npmOutput),
      });
      vi.mocked(spawn).mockReturnValue(mockChild);

      const resultPromise = verifyGroundswellNpmList(s4Result);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.linked).toBe(false);
    });
  });

  // ========================================================================
  // Spawn error handling tests
  // ========================================================================

  describe('Spawn error handling', () => {
    it('should return linked: false when spawn throws synchronous error', async () => {
      const s4Result: GroundswellSymlinkVerifyResult = {
        exists: true,
        path: mockSymlinkPath,
        message: 'Symlink verified',
      };

      vi.mocked(spawn).mockImplementation(() => {
        throw new Error('ENOENT: npm command not found');
      });

      const result = await verifyGroundswellNpmList(s4Result);

      expect(result.linked).toBe(false);
      expect(result.exitCode).toBe(null);
      expect(result.error).toContain('npm command not found');
      expect(result.message).toContain('Failed to spawn');
    });

    it('should handle ENOENT (npm not found)', async () => {
      const s4Result: GroundswellSymlinkVerifyResult = {
        exists: true,
        path: mockSymlinkPath,
        message: 'Symlink verified',
      };

      vi.mocked(spawn).mockImplementation(() => {
        throw new Error('ENOENT: npm command not found');
      });

      const result = await verifyGroundswellNpmList(s4Result);

      expect(result.linked).toBe(false);
      expect(result.error).toContain('ENOENT');
    });

    it('should handle EACCES (permission denied)', async () => {
      const s4Result: GroundswellSymlinkVerifyResult = {
        exists: true,
        path: mockSymlinkPath,
        message: 'Symlink verified',
      };

      vi.mocked(spawn).mockImplementation(() => {
        throw new Error('EACCES: permission denied');
      });

      const result = await verifyGroundswellNpmList(s4Result);

      expect(result.linked).toBe(false);
      expect(result.error).toContain('EACCES');
    });

    it('should return empty stdout/stderr on spawn error', async () => {
      const s4Result: GroundswellSymlinkVerifyResult = {
        exists: true,
        path: mockSymlinkPath,
        message: 'Symlink verified',
      };

      vi.mocked(spawn).mockImplementation(() => {
        throw new Error('Spawn failed');
      });

      const result = await verifyGroundswellNpmList(s4Result);

      expect(result.stdout).toBe('');
      expect(result.stderr).toBe('');
    });
  });

  // ========================================================================
  // JSON parsing error tests
  // ========================================================================

  describe('JSON parsing errors', () => {
    it('should handle invalid JSON output', async () => {
      const s4Result: GroundswellSymlinkVerifyResult = {
        exists: true,
        path: mockSymlinkPath,
        message: 'Symlink verified',
      };

      const mockChild = createMockChild({
        exitCode: 0,
        stdout: '{"invalid": json here}', // Starts with { but invalid JSON
      });
      vi.mocked(spawn).mockReturnValue(mockChild);

      const resultPromise = verifyGroundswellNpmList(s4Result);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.linked).toBe(false);
      expect(result.message).toContain('Failed to parse');
    });

    it('should handle malformed JSON structure', async () => {
      const s4Result: GroundswellSymlinkVerifyResult = {
        exists: true,
        path: mockSymlinkPath,
        message: 'Symlink verified',
      };

      const mockChild = createMockChild({
        exitCode: 0,
        stdout: '{"incomplete":',
      });
      vi.mocked(spawn).mockReturnValue(mockChild);

      const resultPromise = verifyGroundswellNpmList(s4Result);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.linked).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  // ========================================================================
  // Timeout handling tests
  // ========================================================================

  describe('Timeout handling', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      vi.useRealTimers(); // Override fake timers from outer beforeEach
    });

    afterEach(() => {
      vi.clearAllMocks();
    });

    it('should return linked: false when command times out', async () => {
      const s4Result: GroundswellSymlinkVerifyResult = {
        exists: true,
        path: mockSymlinkPath,
        message: 'Symlink verified',
      };

      let closeCallback: ((code: number | null) => void) | undefined;

      const mockChild = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event: string, callback: (code: number | null) => void) => {
          if (event === 'close') {
            closeCallback = callback;
          }
        }),
        kill: vi.fn((_signal: string) => {
          // Emit close after kill to resolve the promise
          if (closeCallback !== undefined) {
            closeCallback(null);
          }
        }),
        killed: false,
      };

      vi.mocked(spawn).mockReturnValue(mockChild as never);

      // Use a short timeout
      const result = await verifyGroundswellNpmList(s4Result, {
        timeout: 100,
      });

      expect(result.linked).toBe(false);
      expect(mockChild.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('should send SIGKILL if SIGTERM does not kill process', async () => {
      const s4Result: GroundswellSymlinkVerifyResult = {
        exists: true,
        path: mockSymlinkPath,
        message: 'Symlink verified',
      };

      const signals: string[] = [];

      const mockChild = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn(),
        kill: vi.fn((_signal: string) => {
          signals.push(_signal);
          // After SIGKILL, emit close to resolve the promise
          if (_signal === 'SIGKILL') {
            const closeCallback = mockChild.on.mock.calls.find(
              (c: unknown[]) => c[0] === 'close'
            )?.[1];
            if (closeCallback !== undefined) closeCallback(null);
          }
        }),
        killed: false, // Property that stays false to trigger SIGKILL
      };

      vi.mocked(spawn).mockReturnValue(mockChild as never);

      const resultPromise = verifyGroundswellNpmList(s4Result, {
        timeout: 50,
      });

      // Wait for timeout + grace period (50ms timeout + 2000ms grace)
      await new Promise(resolve => {
        setTimeout(resolve, 2100);
      });

      const result = await resultPromise;

      expect(signals).toContain('SIGTERM');
      expect(signals).toContain('SIGKILL');
      expect(result.linked).toBe(false);
    });
  });

  // ========================================================================
  // Result structure tests
  // ========================================================================

  describe('NpmListVerifyResult structure', () => {
    it('should return complete NpmListVerifyResult object', async () => {
      const s4Result: GroundswellSymlinkVerifyResult = {
        exists: true,
        path: mockSymlinkPath,
        message: 'Symlink verified',
      };

      const mockChild = createMockChild({
        exitCode: 0,
        stdout: JSON.stringify({
          version: '0.1.0',
          name: 'hacky-hack',
          dependencies: { groundswell: { version: '1.0.0' } },
        }),
      });
      vi.mocked(spawn).mockReturnValue(mockChild);

      const resultPromise = verifyGroundswellNpmList(s4Result);
      await vi.runAllTimersAsync();
      const result: NpmListVerifyResult = await resultPromise;

      // Check result structure
      expect(result).toHaveProperty('linked');
      expect(result).toHaveProperty('version');
      expect(result).toHaveProperty('message');
      expect(result).toHaveProperty('stdout');
      expect(result).toHaveProperty('stderr');
      expect(result).toHaveProperty('exitCode');

      // Check types
      expect(typeof result.linked).toBe('boolean');
      expect(typeof result.message).toBe('string');
      expect(typeof result.stdout).toBe('string');
      expect(typeof result.stderr).toBe('string');

      // version can be string or undefined
      expect(
        result.version === undefined || typeof result.version === 'string'
      ).toBe(true);

      // exitCode can be number or null
      expect(
        result.exitCode === null || typeof result.exitCode === 'number'
      ).toBe(true);
    });

    it('should include linked: true in result on successful verification', async () => {
      const s4Result: GroundswellSymlinkVerifyResult = {
        exists: true,
        path: mockSymlinkPath,
        message: 'Symlink verified',
      };

      const mockChild = createMockChild({
        exitCode: 0,
        stdout: JSON.stringify({
          version: '0.1.0',
          name: 'hacky-hack',
          dependencies: { groundswell: { version: '1.0.0' } },
        }),
      });
      vi.mocked(spawn).mockReturnValue(mockChild);

      const resultPromise = verifyGroundswellNpmList(s4Result);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.linked).toBe(true);
    });

    it('should include linked: false in result when package not found', async () => {
      const s4Result: GroundswellSymlinkVerifyResult = {
        exists: true,
        path: mockSymlinkPath,
        message: 'Symlink verified',
      };

      const mockChild = createMockChild({
        exitCode: 1,
        stdout: JSON.stringify({ version: '0.1.0', name: 'hacky-hack' }),
      });
      vi.mocked(spawn).mockReturnValue(mockChild);

      const resultPromise = verifyGroundswellNpmList(s4Result);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.linked).toBe(false);
    });

    it('should include optional error property when verification fails', async () => {
      const s4Result: GroundswellSymlinkVerifyResult = {
        exists: true,
        path: mockSymlinkPath,
        message: 'Symlink verified',
      };

      vi.mocked(spawn).mockImplementation(() => {
        throw new Error('Spawn error');
      });

      const result = await verifyGroundswellNpmList(s4Result);

      expect(result.error).toBe('Spawn error');
    });

    it('should not include error property on successful verification', async () => {
      const s4Result: GroundswellSymlinkVerifyResult = {
        exists: true,
        path: mockSymlinkPath,
        message: 'Symlink verified',
      };

      const mockChild = createMockChild({
        exitCode: 0,
        stdout: JSON.stringify({
          version: '0.1.0',
          name: 'hacky-hack',
          dependencies: { groundswell: { version: '1.0.0' } },
        }),
      });
      vi.mocked(spawn).mockReturnValue(mockChild);

      const resultPromise = verifyGroundswellNpmList(s4Result);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.error).toBeUndefined();
    });
  });

  // ========================================================================
  // Spawn arguments tests
  // ========================================================================

  describe('Spawn arguments', () => {
    it('should spawn npm with list command and correct arguments', async () => {
      const s4Result: GroundswellSymlinkVerifyResult = {
        exists: true,
        path: mockSymlinkPath,
        message: 'Symlink verified',
      };

      const mockChild = createMockChild({
        exitCode: 0,
        stdout: JSON.stringify({
          version: '0.1.0',
          name: 'hacky-hack',
          dependencies: { groundswell: { version: '1.0.0' } },
        }),
      });
      vi.mocked(spawn).mockReturnValue(mockChild);

      const resultPromise = verifyGroundswellNpmList(s4Result);
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(spawn).toHaveBeenCalledWith(
        'npm',
        ['list', 'groundswell', '--json', '--depth=0'],
        expect.anything()
      );
    });

    it('should use shell: false to prevent injection', async () => {
      const s4Result: GroundswellSymlinkVerifyResult = {
        exists: true,
        path: mockSymlinkPath,
        message: 'Symlink verified',
      };

      const mockChild = createMockChild({
        exitCode: 0,
        stdout: JSON.stringify({
          version: '0.1.0',
          name: 'hacky-hack',
          dependencies: { groundswell: { version: '1.0.0' } },
        }),
      });
      vi.mocked(spawn).mockReturnValue(mockChild);

      const resultPromise = verifyGroundswellNpmList(s4Result);
      await vi.runAllTimersAsync();
      await resultPromise;

      const spawnOptions = vi.mocked(spawn).mock.calls[0]?.[2];
      expect(spawnOptions?.shell).toBe(false);
    });

    it('should use stdio ignore, pipe, pipe', async () => {
      const s4Result: GroundswellSymlinkVerifyResult = {
        exists: true,
        path: mockSymlinkPath,
        message: 'Symlink verified',
      };

      const mockChild = createMockChild({
        exitCode: 0,
        stdout: JSON.stringify({
          version: '0.1.0',
          name: 'hacky-hack',
          dependencies: { groundswell: { version: '1.0.0' } },
        }),
      });
      vi.mocked(spawn).mockReturnValue(mockChild);

      const resultPromise = verifyGroundswellNpmList(s4Result);
      await vi.runAllTimersAsync();
      await resultPromise;

      const spawnOptions = vi.mocked(spawn).mock.calls[0]?.[2];
      expect(spawnOptions?.stdio).toEqual(['ignore', 'pipe', 'pipe']);
    });
  });

  // ========================================================================
  // Integration with S4 tests
  // ========================================================================

  describe('Integration with S4', () => {
    it('should support full workflow: S4 then S5', async () => {
      // S4 result - successful symlink verification
      const s4Result: GroundswellSymlinkVerifyResult = {
        exists: true,
        path: mockSymlinkPath,
        symlinkTarget: '../../../projects/groundswell',
        message: 'Symlink verified at /home/.../node_modules/groundswell',
      };

      // Mock npm list success
      const mockChild = createMockChild({
        exitCode: 0,
        stdout: JSON.stringify({
          version: '0.1.0',
          name: 'hacky-hack',
          dependencies: { groundswell: { version: '1.0.0' } },
        }),
      });
      vi.mocked(spawn).mockReturnValue(mockChild);

      // S5 (npm list verification) should proceed
      const resultPromise = verifyGroundswellNpmList(s4Result);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.linked).toBe(true);
      expect(spawn).toHaveBeenCalledWith(
        'npm',
        ['list', 'groundswell', '--json', '--depth=0'],
        expect.anything()
      );
    });

    it('should fail fast if S4 symlink verification failed', async () => {
      // S4 result - symlink not found
      const s4Result: GroundswellSymlinkVerifyResult = {
        exists: false,
        path: mockSymlinkPath,
        message: 'Symlink not found: ENOENT',
        error: 'ENOENT',
      };

      // S5 should skip without calling spawn
      const result = await verifyGroundswellNpmList(s4Result);

      expect(result.linked).toBe(false);
      expect(result.message).toContain('Skipped');
      expect(spawn).not.toHaveBeenCalled();
    });
  });
});

// =============================================================================
// S6: documentGroundswellReadme() TESTS
// ============================================================================

describe('documentGroundswellReadme', () => {
  const mockProjectPath = '/home/dustin/projects/hacky-hack';
  const mockReadmePath = `${mockProjectPath}/README.md`;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ========================================================================
  // Happy path tests
  // ========================================================================

  describe('Successful README update', () => {
    it('should return updated: true when README exists and S5 linked', async () => {
      const s5Result: NpmListVerifyResult = {
        linked: true,
        message: 'npm list confirms groundswell is linked',
        stdout: '{"dependencies":{"groundswell":{"version":"1.0.0"}}}',
        stderr: '',
        exitCode: 0,
      };

      vi.mocked(access).mockResolvedValue(undefined);
      vi.mocked(readFile).mockResolvedValue(
        '# Test Project\n\n## License\nMIT\n'
      );
      vi.mocked(writeFile).mockResolvedValue(undefined);

      const result: ReadmeUpdateResult =
        await documentGroundswellReadme(s5Result);

      expect(result.updated).toBe(true);
      expect(result.path).toBe(mockReadmePath);
      expect(result.message).toContain(
        'updated with Groundswell setup documentation'
      );
      expect(writeFile).toHaveBeenCalledWith(
        mockReadmePath,
        expect.stringContaining('## Local Development with Groundswell'),
        'utf-8'
      );
    });

    it('should create new README when it does not exist', async () => {
      const s5Result: NpmListVerifyResult = {
        linked: true,
        message: 'npm list confirms groundswell is linked',
        stdout: '{}',
        stderr: '',
        exitCode: 0,
      };

      const enoentError = new Error('File not found') as NodeJS.ErrnoException;
      enoentError.code = 'ENOENT';
      vi.mocked(access).mockRejectedValue(enoentError);
      vi.mocked(writeFile).mockResolvedValue(undefined);

      const result: ReadmeUpdateResult =
        await documentGroundswellReadme(s5Result);

      expect(result.updated).toBe(true);
      expect(result.message).toContain(
        'created with Groundswell setup documentation'
      );
      expect(writeFile).toHaveBeenCalledWith(
        mockReadmePath,
        expect.stringContaining('## Local Development with Groundswell'),
        'utf-8'
      );
    });

    it('should skip update if README already contains Groundswell section', async () => {
      const s5Result: NpmListVerifyResult = {
        linked: true,
        message: 'npm list confirms groundswell is linked',
        stdout: '{}',
        stderr: '',
        exitCode: 0,
      };

      vi.mocked(access).mockResolvedValue(undefined);
      vi.mocked(readFile).mockResolvedValue(
        '# Test\n\n## Local Development with Groundswell\n\nSetup instructions...\n'
      );

      const result: ReadmeUpdateResult =
        await documentGroundswellReadme(s5Result);

      expect(result.updated).toBe(false);
      expect(result.message).toContain(
        'already contains Groundswell documentation'
      );
      expect(writeFile).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // Conditional execution tests
  // ========================================================================

  describe('Conditional execution based on S5 result', () => {
    it('should skip when S5 linked is false', async () => {
      const s5Result: NpmListVerifyResult = {
        linked: false,
        message: 'npm list: groundswell not found in dependency tree',
        stdout: '{}',
        stderr: '',
        exitCode: 1,
        error: 'Package not found',
      };

      const result: ReadmeUpdateResult =
        await documentGroundswellReadme(s5Result);

      expect(result.updated).toBe(false);
      expect(result.message).toContain(
        'Skipped: Groundswell not linked by npm list verification'
      );
      expect(access).not.toHaveBeenCalled();
      expect(readFile).not.toHaveBeenCalled();
      expect(writeFile).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // Options tests
  // ========================================================================

  describe('Options configuration', () => {
    it('should use custom project path from options', async () => {
      const customPath = '/custom/project/path';
      const s5Result: NpmListVerifyResult = {
        linked: true,
        message: 'npm list confirms groundswell is linked',
        stdout: '{}',
        stderr: '',
        exitCode: 0,
      };

      const enoentError = new Error('File not found') as NodeJS.ErrnoException;
      enoentError.code = 'ENOENT';
      vi.mocked(access).mockRejectedValue(enoentError);
      vi.mocked(writeFile).mockResolvedValue(undefined);

      const options: ReadmeUpdateOptions = { projectPath: customPath };
      const result: ReadmeUpdateResult = await documentGroundswellReadme(
        s5Result,
        options
      );

      expect(result.path).toBe(`${customPath}/README.md`);
      expect(access).toHaveBeenCalledWith(`${customPath}/README.md`);
    });

    it('should use custom README file name from options', async () => {
      const customReadmeName = 'CUSTOM_README.md';
      const s5Result: NpmListVerifyResult = {
        linked: true,
        message: 'npm list confirms groundswell is linked',
        stdout: '{}',
        stderr: '',
        exitCode: 0,
      };

      const enoentError = new Error('File not found') as NodeJS.ErrnoException;
      enoentError.code = 'ENOENT';
      vi.mocked(access).mockRejectedValue(enoentError);
      vi.mocked(writeFile).mockResolvedValue(undefined);

      const options: ReadmeUpdateOptions = { readmeFileName: customReadmeName };
      const result: ReadmeUpdateResult = await documentGroundswellReadme(
        s5Result,
        options
      );

      expect(result.path).toBe(`${mockProjectPath}/${customReadmeName}`);
      expect(access).toHaveBeenCalledWith(
        `${mockProjectPath}/${customReadmeName}`
      );
    });
  });

  // ========================================================================
  // Error handling tests
  // ========================================================================

  describe('Error handling', () => {
    it('should handle EACCES (permission denied) on access check', async () => {
      const s5Result: NpmListVerifyResult = {
        linked: true,
        message: 'npm list confirms groundswell is linked',
        stdout: '{}',
        stderr: '',
        exitCode: 0,
      };

      const eaccesError = new Error(
        'Permission denied'
      ) as NodeJS.ErrnoException;
      eaccesError.code = 'EACCES';
      vi.mocked(access).mockRejectedValue(eaccesError);

      const result: ReadmeUpdateResult =
        await documentGroundswellReadme(s5Result);

      expect(result.updated).toBe(false);
      expect(result.error).toContain('Permission denied');
      expect(result.message).toContain('Failed to check README existence');
    });

    it('should handle writeFile error when creating new README', async () => {
      const s5Result: NpmListVerifyResult = {
        linked: true,
        message: 'npm list confirms groundswell is linked',
        stdout: '{}',
        stderr: '',
        exitCode: 0,
      };

      const enoentError = new Error('File not found') as NodeJS.ErrnoException;
      enoentError.code = 'ENOENT';
      vi.mocked(access).mockRejectedValue(enoentError);

      const enospcError = new Error(
        'No space left on device'
      ) as NodeJS.ErrnoException;
      enospcError.code = 'ENOSPC';
      vi.mocked(writeFile).mockRejectedValue(enospcError);

      const result: ReadmeUpdateResult =
        await documentGroundswellReadme(s5Result);

      expect(result.updated).toBe(false);
      expect(result.error).toContain('No space left on device');
      expect(result.message).toContain('Failed to create README.md');
    });

    it('should handle readFile error when checking existing README', async () => {
      const s5Result: NpmListVerifyResult = {
        linked: true,
        message: 'npm list confirms groundswell is linked',
        stdout: '{}',
        stderr: '',
        exitCode: 0,
      };

      vi.mocked(access).mockResolvedValue(undefined);

      const readError = new Error('Read error') as NodeJS.ErrnoException;
      readError.code = 'EIO';
      vi.mocked(readFile).mockRejectedValue(readError);

      const result: ReadmeUpdateResult =
        await documentGroundswellReadme(s5Result);

      expect(result.updated).toBe(false);
      expect(result.error).toContain('Read error');
      expect(result.message).toContain('Failed to update README.md');
    });

    it('should handle generic error on access check', async () => {
      const s5Result: NpmListVerifyResult = {
        linked: true,
        message: 'npm list confirms groundswell is linked',
        stdout: '{}',
        stderr: '',
        exitCode: 0,
      };

      const genericError = new Error('Unknown error');
      vi.mocked(access).mockRejectedValue(genericError);

      const result: ReadmeUpdateResult =
        await documentGroundswellReadme(s5Result);

      expect(result.updated).toBe(false);
      expect(result.error).toContain('Unknown error');
      expect(result.message).toContain('Failed to check README existence');
    });
  });

  // ========================================================================
  // Integration with S5 tests
  // ========================================================================

  describe('Integration with S5', () => {
    it('should support full workflow: S5 then S6', async () => {
      // S5 result - successful npm list verification
      const s5Result: NpmListVerifyResult = {
        linked: true,
        version: '1.0.0',
        message: 'npm list confirms groundswell is linked',
        stdout: '{"dependencies":{"groundswell":{"version":"1.0.0"}}}',
        stderr: '',
        exitCode: 0,
      };

      vi.mocked(access).mockResolvedValue(undefined);
      vi.mocked(readFile).mockResolvedValue('# Test\n\n## License\nMIT\n');
      vi.mocked(writeFile).mockResolvedValue(undefined);

      // S6 (document README) should proceed
      const result: ReadmeUpdateResult =
        await documentGroundswellReadme(s5Result);

      expect(result.updated).toBe(true);
      expect(result.message).toContain(
        'updated with Groundswell setup documentation'
      );
      expect(writeFile).toHaveBeenCalled();
    });

    it('should fail fast if S5 npm list verification failed', async () => {
      // S5 result - npm list failed
      const s5Result: NpmListVerifyResult = {
        linked: false,
        message: 'npm list: groundswell not found in dependency tree',
        stdout: '{}',
        stderr: '',
        exitCode: 1,
        error: 'Package not found',
      };

      // S6 should skip without file operations
      const result: ReadmeUpdateResult =
        await documentGroundswellReadme(s5Result);

      expect(result.updated).toBe(false);
      expect(result.message).toContain('Skipped');
      expect(access).not.toHaveBeenCalled();
      expect(readFile).not.toHaveBeenCalled();
      expect(writeFile).not.toHaveBeenCalled();
    });
  });
});
