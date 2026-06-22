/**
 * Unit tests for Groundswell npm link validation
 *
 * @remarks
 * Tests validate npm link functionality including:
 * 1. Package.json dependency check (informational)
 * 2. npm list command execution and parsing
 * 3. Symlink verification and validation
 * 4. TypeScript import resolution testing
 * 5. Error message generation with actionable guidance
 * 6. Overall validation result aggregation
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

// Mock node:fs/promises
vi.mock('node:fs/promises', () => ({
  lstat: vi.fn(),
  readlink: vi.fn(),
  writeFile: vi.fn(),
  unlink: vi.fn(),
  readFile: vi.fn(),
}));

// Mock typescript (programmatic compilation)
vi.mock('typescript', () => ({
  createProgram: vi.fn(),
  ModuleKind: { NodeNext: 100 },
  ModuleResolutionKind: { NodeNext: 100 },
  ScriptTarget: { ES2022: 4 },
  flattenDiagnosticMessageText: vi.fn((msg: string | unknown) => {
    if (typeof msg === 'string') return msg;
    return String(msg);
  }),
}));

// Import mocked modules
import { spawn } from 'node:child_process';
import { lstat, readlink, writeFile, unlink, readFile } from 'node:fs/promises';
import * as ts from 'typescript';
import {
  validateNpmLink,
  LinkValidationError,
  LinkErrorCodes,
  type NpmLinkValidationResult,
} from '../../../src/utils/validate-groundswell-link.js';

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
  const { exitCode = 0, stdout = '', stderr = '' } = options;
  const pendingTimers: ReturnType<typeof setTimeout>[] = [];

  // Cleanup helper to clear pending timers
  const cleanup = () => {
    pendingTimers.forEach(t => clearTimeout(t));
    pendingTimers.length = 0;
  };

  const mock = {
    stdout: {
      on: vi.fn((event: string, callback: (data: Buffer) => void) => {
        if (event === 'data' && stdout) {
          pendingTimers.push(
            setTimeout(() => callback(Buffer.from(stdout)), 5)
          );
        }
      }),
    },
    stderr: {
      on: vi.fn((event: string, callback: (data: Buffer) => void) => {
        if (event === 'data' && stderr) {
          pendingTimers.push(
            setTimeout(() => callback(Buffer.from(stderr)), 5)
          );
        }
      }),
    },
    on: vi.fn((event: string, callback: (code: number | null) => void) => {
      if (event === 'close') {
        pendingTimers.push(setTimeout(() => callback(exitCode), 10));
      }
    }),
    killed: false,
    kill: cleanup,
  } as unknown as ChildProcess;

  return mock;
}

/**
 * Creates a mock Stats object from lstat
 *
 * @param isSymlink - Whether this represents a symbolic link
 * @returns Mock Stats object (should be used with mockResolvedValue)
 */
function createMockStats(isSymlink: boolean = false) {
  return {
    isSymbolicLink: vi.fn(() => isSymlink),
    isFile: vi.fn(() => !isSymlink),
    isDirectory: vi.fn(() => false),
  };
}

// =============================================================================
// TEST SETUP
// ============================================================================

describe('validateNpmLink', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    // Clear all timers first to prevent unhandled rejections from mock child process timeouts
    vi.useRealTimers();
    vi.clearAllTimers();
    vi.clearAllMocks();
  });

  // ========================================================================
  // Happy path tests
  // ========================================================================

  describe('Successful npm link validation', () => {
    it('should return success: true when symlink is valid and TypeScript resolves', async () => {
      // Mock package.json read (no dependency listed)
      vi.mocked(readFile).mockResolvedValue(
        JSON.stringify({
          name: 'hacky-hack',
          dependencies: {},
          devDependencies: {},
        })
      );

      // Mock npm list to show linked package (JSON format)
      vi.mocked(spawn).mockReturnValue(
        createMockChild({
          exitCode: 0,
          stdout: JSON.stringify({
            dependencies: {
              groundswell: {
                version: '0.0.3',
                resolved: '/home/dustin/projects/groundswell',
              },
            },
          }),
        })
      );

      // Mock lstat to show symlink exists
      vi.mocked(lstat).mockResolvedValue(
        createMockStats(true) as unknown as Awaited<ReturnType<typeof lstat>>
      );

      // Mock readlink to return correct target
      vi.mocked(readlink).mockResolvedValue(
        '/home/dustin/projects/groundswell'
      );

      // Mock TypeScript compilation success
      vi.mocked(ts.createProgram).mockReturnValue({
        getSyntacticDiagnostics: vi.fn(() => []),
        getSemanticDiagnostics: vi.fn(() => []),
      } as unknown as ReturnType<typeof ts.createProgram>);

      // Mock writeFile and unlink for temp file
      vi.mocked(writeFile).mockResolvedValue(undefined);
      vi.mocked(unlink).mockResolvedValue(undefined);

      const resultPromise = validateNpmLink();
      await vi.runAllTimersAsync();

      const result = await resultPromise;

      expect(result.success).toBe(true);
      expect(result.linkedPath).toBe('/home/dustin/projects/groundswell');
      expect(result.isSymlink).toBe(true);
      expect(result.typescriptResolves).toBe(true);
      expect(result.errorMessage).toBeUndefined();
      expect(result.packageJsonEntry).toBe('absent');
      expect(result.version).toBe('0.0.3');
    });

    it('should parse npm list text output when JSON parsing fails', async () => {
      vi.mocked(readFile).mockResolvedValue(
        JSON.stringify({ name: 'hacky-hack', dependencies: {} })
      );

      // Mock npm list with text format output
      vi.mocked(spawn).mockReturnValue(
        createMockChild({
          exitCode: 0,
          stdout: 'groundswell@0.0.3 -> ../projects/groundswell',
        })
      );

      vi.mocked(lstat).mockResolvedValue(
        createMockStats(true) as unknown as Awaited<ReturnType<typeof lstat>>
      );
      vi.mocked(readlink).mockResolvedValue(
        '/home/dustin/projects/groundswell'
      );
      vi.mocked(ts.createProgram).mockReturnValue({
        getSyntacticDiagnostics: vi.fn(() => []),
        getSemanticDiagnostics: vi.fn(() => []),
      } as unknown as ReturnType<typeof ts.createProgram>);
      vi.mocked(writeFile).mockResolvedValue(undefined);
      vi.mocked(unlink).mockResolvedValue(undefined);

      const resultPromise = validateNpmLink();
      await vi.runAllTimersAsync();

      const result = await resultPromise;

      expect(result.success).toBe(true);
      expect(result.version).toBe('0.0.3');
    });

    it('should handle npm link with version but no target path', async () => {
      vi.mocked(readFile).mockResolvedValue(
        JSON.stringify({ name: 'hacky-hack', dependencies: {} })
      );

      // Mock npm list with only version
      vi.mocked(spawn).mockReturnValue(
        createMockChild({
          exitCode: 0,
          stdout: 'groundswell@0.0.3',
        })
      );

      vi.mocked(lstat).mockResolvedValue(
        createMockStats(true) as unknown as Awaited<ReturnType<typeof lstat>>
      );
      vi.mocked(readlink).mockResolvedValue(
        '/home/dustin/projects/groundswell'
      );
      vi.mocked(ts.createProgram).mockReturnValue({
        getSyntacticDiagnostics: vi.fn(() => []),
        getSemanticDiagnostics: vi.fn(() => []),
      } as unknown as ReturnType<typeof ts.createProgram>);
      vi.mocked(writeFile).mockResolvedValue(undefined);
      vi.mocked(unlink).mockResolvedValue(undefined);

      const resultPromise = validateNpmLink();
      await vi.runAllTimersAsync();

      const result = await resultPromise;

      expect(result.success).toBe(true);
      expect(result.version).toBe('0.0.3');
    });
  });

  // ========================================================================
  // Failure scenario tests
  // ========================================================================

  describe('Validation failures', () => {
    it('should return success: false when symlink does not exist', async () => {
      vi.mocked(readFile).mockResolvedValue(
        JSON.stringify({ name: 'hacky-hack', dependencies: {} })
      );

      // Mock npm list returning empty (not linked)
      vi.mocked(spawn).mockReturnValue(
        createMockChild({
          exitCode: 1,
          stdout: '',
          stderr: 'empty',
        })
      );

      // Mock lstat throwing ENOENT (file doesn't exist)
      const enoentError = new Error('ENOENT') as NodeJS.ErrnoException;
      enoentError.code = 'ENOENT';
      vi.mocked(lstat).mockRejectedValue(enoentError);

      const resultPromise = validateNpmLink();
      await vi.runAllTimersAsync();

      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.linkedPath).toBeNull();
      expect(result.isSymlink).toBe(false);
      expect(result.errorMessage).toBeDefined();
      expect(result.errorMessage).toContain('npm link does not exist');
      expect(result.errorMessage).toContain('npm link');
    });

    it('should return success: false when symlink points to wrong target', async () => {
      vi.mocked(readFile).mockResolvedValue(
        JSON.stringify({ name: 'hacky-hack', dependencies: {} })
      );

      vi.mocked(spawn).mockReturnValue(
        createMockChild({
          exitCode: 0,
          stdout: JSON.stringify({
            dependencies: {
              groundswell: {
                version: '0.0.3',
                resolved: '/wrong/path/to/groundswell',
              },
            },
          }),
        })
      );

      vi.mocked(lstat).mockResolvedValue(
        createMockStats(true) as unknown as Awaited<ReturnType<typeof lstat>>
      );
      vi.mocked(readlink).mockResolvedValue('/wrong/path/to/groundswell');
      vi.mocked(ts.createProgram).mockReturnValue({
        getSyntacticDiagnostics: vi.fn(() => []),
        getSemanticDiagnostics: vi.fn(() => []),
      } as unknown as ReturnType<typeof ts.createProgram>);
      vi.mocked(writeFile).mockResolvedValue(undefined);
      vi.mocked(unlink).mockResolvedValue(undefined);

      const resultPromise = validateNpmLink();
      await vi.runAllTimersAsync();

      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.isSymlink).toBe(true);
      expect(result.isValidTarget).toBe(false);
      expect(result.errorMessage).toBeDefined();
      expect(result.errorMessage).toContain(
        'symlink exists but points to wrong location'
      );
    });

    it('should return success: false when TypeScript cannot resolve imports', async () => {
      vi.mocked(readFile).mockResolvedValue(
        JSON.stringify({ name: 'hacky-hack', dependencies: {} })
      );

      vi.mocked(spawn).mockReturnValue(
        createMockChild({
          exitCode: 0,
          stdout: JSON.stringify({
            dependencies: {
              groundswell: {
                version: '0.0.3',
                resolved: '/home/dustin/projects/groundswell',
              },
            },
          }),
        })
      );

      vi.mocked(lstat).mockResolvedValue(
        createMockStats(true) as unknown as Awaited<ReturnType<typeof lstat>>
      );
      vi.mocked(readlink).mockResolvedValue(
        '/home/dustin/projects/groundswell'
      );

      // Mock TypeScript returning module resolution error
      vi.mocked(ts.createProgram).mockReturnValue({
        getSyntacticDiagnostics: vi.fn(() => []),
        getSemanticDiagnostics: vi.fn(() => [
          {
            messageText: "Cannot find module 'groundswell'",
            category: 1,
            code: 2307,
          } as any,
        ]),
      } as unknown as ReturnType<typeof ts.createProgram>);
      vi.mocked(writeFile).mockResolvedValue(undefined);
      vi.mocked(unlink).mockResolvedValue(undefined);

      const resultPromise = validateNpmLink();
      await vi.runAllTimersAsync();

      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.typescriptResolves).toBe(false);
      expect(result.errorMessage).toBeDefined();
      expect(result.errorMessage).toContain(
        'TypeScript cannot resolve imports'
      );
    });

    it('should include all issues in error message when multiple problems exist', async () => {
      vi.mocked(readFile).mockResolvedValue(
        JSON.stringify({ name: 'hacky-hack', dependencies: {} })
      );

      // No npm link
      vi.mocked(spawn).mockReturnValue(
        createMockChild({
          exitCode: 1,
          stdout: '',
          stderr: 'empty',
        })
      );

      // No symlink
      const enoentError = new Error('ENOENT') as NodeJS.ErrnoException;
      enoentError.code = 'ENOENT';
      vi.mocked(lstat).mockRejectedValue(enoentError);

      const resultPromise = validateNpmLink();
      await vi.runAllTimersAsync();

      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.errorMessage).toContain('npm link does not exist');
    });
  });

  // ========================================================================
  // Package.json dependency check tests
  // ========================================================================

  describe('Package.json dependency check', () => {
    it('should detect when groundswell is in dependencies', async () => {
      vi.mocked(readFile).mockResolvedValue(
        JSON.stringify({
          name: 'hacky-hack',
          dependencies: { groundswell: '0.0.3' },
        })
      );

      vi.mocked(spawn).mockReturnValue(
        createMockChild({
          exitCode: 0,
          stdout: JSON.stringify({
            dependencies: {
              groundswell: {
                version: '0.0.3',
                resolved: '/home/dustin/projects/groundswell',
              },
            },
          }),
        })
      );

      vi.mocked(lstat).mockResolvedValue(
        createMockStats(true) as unknown as Awaited<ReturnType<typeof lstat>>
      );
      vi.mocked(readlink).mockResolvedValue(
        '/home/dustin/projects/groundswell'
      );
      vi.mocked(ts.createProgram).mockReturnValue({
        getSyntacticDiagnostics: vi.fn(() => []),
        getSemanticDiagnostics: vi.fn(() => []),
      } as unknown as ReturnType<typeof ts.createProgram>);
      vi.mocked(writeFile).mockResolvedValue(undefined);
      vi.mocked(unlink).mockResolvedValue(undefined);

      const resultPromise = validateNpmLink();
      await vi.runAllTimersAsync();

      const result = await resultPromise;

      expect(result.packageJsonEntry).toBe('present');
    });

    it('should detect when groundswell is in devDependencies', async () => {
      vi.mocked(readFile).mockResolvedValue(
        JSON.stringify({
          name: 'hacky-hack',
          dependencies: {},
          devDependencies: { groundswell: '0.0.3' },
        })
      );

      vi.mocked(spawn).mockReturnValue(
        createMockChild({
          exitCode: 0,
          stdout: JSON.stringify({
            dependencies: {
              groundswell: {
                version: '0.0.3',
                resolved: '/home/dustin/projects/groundswell',
              },
            },
          }),
        })
      );

      vi.mocked(lstat).mockResolvedValue(
        createMockStats(true) as unknown as Awaited<ReturnType<typeof lstat>>
      );
      vi.mocked(readlink).mockResolvedValue(
        '/home/dustin/projects/groundswell'
      );
      vi.mocked(ts.createProgram).mockReturnValue({
        getSyntacticDiagnostics: vi.fn(() => []),
        getSemanticDiagnostics: vi.fn(() => []),
      } as unknown as ReturnType<typeof ts.createProgram>);
      vi.mocked(writeFile).mockResolvedValue(undefined);
      vi.mocked(unlink).mockResolvedValue(undefined);

      const resultPromise = validateNpmLink();
      await vi.runAllTimersAsync();

      const result = await resultPromise;

      expect(result.packageJsonEntry).toBe('present');
    });

    it('should report absent when groundswell is not in package.json', async () => {
      vi.mocked(readFile).mockResolvedValue(
        JSON.stringify({ name: 'hacky-hack', dependencies: {} })
      );

      vi.mocked(spawn).mockReturnValue(
        createMockChild({
          exitCode: 0,
          stdout: JSON.stringify({
            dependencies: {
              groundswell: {
                version: '0.0.3',
                resolved: '/home/dustin/projects/groundswell',
              },
            },
          }),
        })
      );

      vi.mocked(lstat).mockResolvedValue(
        createMockStats(true) as unknown as Awaited<ReturnType<typeof lstat>>
      );
      vi.mocked(readlink).mockResolvedValue(
        '/home/dustin/projects/groundswell'
      );
      vi.mocked(ts.createProgram).mockReturnValue({
        getSyntacticDiagnostics: vi.fn(() => []),
        getSemanticDiagnostics: vi.fn(() => []),
      } as unknown as ReturnType<typeof ts.createProgram>);
      vi.mocked(writeFile).mockResolvedValue(undefined);
      vi.mocked(unlink).mockResolvedValue(undefined);

      const resultPromise = validateNpmLink();
      await vi.runAllTimersAsync();

      const result = await resultPromise;

      expect(result.packageJsonEntry).toBe('absent');
    });
  });

  // ========================================================================
  // Error handling tests
  // ========================================================================

  describe('Error handling', () => {
    it('should throw LinkValidationError on permission denied', async () => {
      vi.mocked(readFile).mockResolvedValue(
        JSON.stringify({ name: 'hacky-hack', dependencies: {} })
      );

      vi.mocked(spawn).mockReturnValue(
        createMockChild({
          exitCode: 0,
          stdout: '',
        })
      );

      // Mock permission error
      const eaccesError = new Error('EACCES') as NodeJS.ErrnoException;
      eaccesError.code = 'EACCES';
      vi.mocked(lstat).mockRejectedValue(eaccesError);

      const resultPromise = validateNpmLink();
      resultPromise.catch(() => {}); // prevent unhandled rejection during fake timer advance
      await vi.runAllTimersAsync();

      await expect(resultPromise).rejects.toThrow(LinkValidationError);
    });

    it('should handle spawn errors gracefully', async () => {
      vi.mocked(readFile).mockResolvedValue(
        JSON.stringify({ name: 'hacky-hack', dependencies: {} })
      );

      // Mock spawn throwing an error
      const mockChild = createMockChild({ exitCode: 1 });
      (mockChild.on as ReturnType<typeof vi.fn>).mockImplementation(
        (event: string, callback: (...args: unknown[]) => void) => {
          if (event === 'error') {
            setTimeout(() => callback(new Error('spawn failed')), 5);
          }
        }
      );
      vi.mocked(spawn).mockReturnValue(mockChild);

      const enoentError = new Error('ENOENT') as NodeJS.ErrnoException;
      enoentError.code = 'ENOENT';
      vi.mocked(lstat).mockRejectedValue(enoentError);

      const resultPromise = validateNpmLink();
      await vi.runAllTimersAsync();

      const result = await resultPromise;

      expect(result.success).toBe(false);
    });

    it('should handle TypeScript compilation errors', async () => {
      vi.mocked(readFile).mockResolvedValue(
        JSON.stringify({ name: 'hacky-hack', dependencies: {} })
      );

      vi.mocked(spawn).mockReturnValue(
        createMockChild({
          exitCode: 0,
          stdout: JSON.stringify({
            dependencies: {
              groundswell: {
                version: '0.0.3',
                resolved: '/home/dustin/projects/groundswell',
              },
            },
          }),
        })
      );

      vi.mocked(lstat).mockResolvedValue(
        createMockStats(true) as unknown as Awaited<ReturnType<typeof lstat>>
      );
      vi.mocked(readlink).mockResolvedValue(
        '/home/dustin/projects/groundswell'
      );

      // Mock writeFile throwing error
      vi.mocked(writeFile).mockRejectedValue(new Error('Write failed'));

      const resultPromise = validateNpmLink();
      await vi.runAllTimersAsync();

      const result = await resultPromise;

      // TypeScript resolution should fail gracefully
      expect(result.typescriptResolves).toBe(false);
    });

    it('should handle npm timeout', async () => {
      vi.mocked(readFile).mockResolvedValue(
        JSON.stringify({ name: 'hacky-hack', dependencies: {} })
      );

      // Mock spawn that never closes
      const mockChild = createMockChild();
      // Remove the close event to simulate timeout
      (mockChild.on as ReturnType<typeof vi.fn>).mockImplementation(() => {
        // Do nothing - never call close callback
      });
      vi.mocked(spawn).mockReturnValue(mockChild);

      const enoentError = new Error('ENOENT') as NodeJS.ErrnoException;
      enoentError.code = 'ENOENT';
      vi.mocked(lstat).mockRejectedValue(enoentError);

      // Advance timers past timeout
      const resultPromise = validateNpmLink();
      await vi.runAllTimersAsync();

      const result = await resultPromise;

      expect(result.success).toBe(false);
    });
  });

  // ========================================================================
  // Edge case tests
  // ========================================================================

  describe('Edge cases', () => {
    it('should handle non-symlink file at link path', async () => {
      vi.mocked(readFile).mockResolvedValue(
        JSON.stringify({ name: 'hacky-hack', dependencies: {} })
      );

      vi.mocked(spawn).mockReturnValue(
        createMockChild({
          exitCode: 0,
          stdout: '',
        })
      );

      // Mock lstat returning non-symlink
      vi.mocked(lstat).mockResolvedValue(
        createMockStats(false) as unknown as Awaited<ReturnType<typeof lstat>>
      );

      const resultPromise = validateNpmLink();
      await vi.runAllTimersAsync();

      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.isSymlink).toBe(false);
    });

    it('should handle malformed npm list output', async () => {
      vi.mocked(readFile).mockResolvedValue(
        JSON.stringify({ name: 'hacky-hack', dependencies: {} })
      );

      // Mock invalid JSON and non-parseable text
      vi.mocked(spawn).mockReturnValue(
        createMockChild({
          exitCode: 0,
          stdout: 'not valid json or format',
        })
      );

      const enoentError = new Error('ENOENT') as NodeJS.ErrnoException;
      enoentError.code = 'ENOENT';
      vi.mocked(lstat).mockRejectedValue(enoentError);

      const resultPromise = validateNpmLink();
      await vi.runAllTimersAsync();

      const result = await resultPromise;

      expect(result.success).toBe(false);
    });

    it('should handle temp file cleanup failure', async () => {
      vi.mocked(readFile).mockResolvedValue(
        JSON.stringify({ name: 'hacky-hack', dependencies: {} })
      );

      vi.mocked(spawn).mockReturnValue(
        createMockChild({
          exitCode: 0,
          stdout: JSON.stringify({
            dependencies: {
              groundswell: {
                version: '0.0.3',
                resolved: '/home/dustin/projects/groundswell',
              },
            },
          }),
        })
      );

      vi.mocked(lstat).mockResolvedValue(
        createMockStats(true) as unknown as Awaited<ReturnType<typeof lstat>>
      );
      vi.mocked(readlink).mockResolvedValue(
        '/home/dustin/projects/groundswell'
      );
      vi.mocked(ts.createProgram).mockReturnValue({
        getSyntacticDiagnostics: vi.fn(() => []),
        getSemanticDiagnostics: vi.fn(() => []),
      } as unknown as ReturnType<typeof ts.createProgram>);
      vi.mocked(writeFile).mockResolvedValue(undefined);

      // Mock unlink throwing error
      vi.mocked(unlink).mockRejectedValue(new Error('Cleanup failed'));

      const resultPromise = validateNpmLink();
      await vi.runAllTimersAsync();

      const result = await resultPromise;

      // Should still succeed despite cleanup failure
      expect(result.success).toBe(true);
    });

    it('should handle package.json read failure', async () => {
      // Mock readFile throwing error
      vi.mocked(readFile).mockRejectedValue(new Error('Read failed'));

      vi.mocked(spawn).mockReturnValue(
        createMockChild({
          exitCode: 0,
          stdout: JSON.stringify({
            dependencies: {
              groundswell: {
                version: '0.0.3',
                resolved: '/home/dustin/projects/groundswell',
              },
            },
          }),
        })
      );

      vi.mocked(lstat).mockResolvedValue(
        createMockStats(true) as unknown as Awaited<ReturnType<typeof lstat>>
      );
      vi.mocked(readlink).mockResolvedValue(
        '/home/dustin/projects/groundswell'
      );
      vi.mocked(ts.createProgram).mockReturnValue({
        getSyntacticDiagnostics: vi.fn(() => []),
        getSemanticDiagnostics: vi.fn(() => []),
      } as unknown as ReturnType<typeof ts.createProgram>);
      vi.mocked(writeFile).mockResolvedValue(undefined);
      vi.mocked(unlink).mockResolvedValue(undefined);

      const resultPromise = validateNpmLink();
      await vi.runAllTimersAsync();

      const result = await resultPromise;

      // Should still succeed, packageJsonEntry just won't be set
      expect(result.success).toBe(true);
    });
  });

  // ========================================================================
  // Error message tests
  // ========================================================================

  describe('Error message generation', () => {
    it('should provide actionable error for missing npm link', async () => {
      vi.mocked(readFile).mockResolvedValue(
        JSON.stringify({ name: 'hacky-hack', dependencies: {} })
      );

      vi.mocked(spawn).mockReturnValue(
        createMockChild({
          exitCode: 1,
          stdout: '',
          stderr: 'empty',
        })
      );

      const enoentError = new Error('ENOENT') as NodeJS.ErrnoException;
      enoentError.code = 'ENOENT';
      vi.mocked(lstat).mockRejectedValue(enoentError);

      const resultPromise = validateNpmLink();
      await vi.runAllTimersAsync();

      const result = await resultPromise;

      expect(result.errorMessage).toBeDefined();
      expect(result.errorMessage).toContain('npm link does not exist');
      expect(result.errorMessage).toContain('npm link');
      expect(result.errorMessage).toContain('npm link groundswell');
    });

    it('should provide actionable error for wrong symlink target', async () => {
      vi.mocked(readFile).mockResolvedValue(
        JSON.stringify({ name: 'hacky-hack', dependencies: {} })
      );

      vi.mocked(spawn).mockReturnValue(
        createMockChild({
          exitCode: 0,
          stdout: JSON.stringify({
            dependencies: {
              groundswell: {
                version: '0.0.3',
                resolved: '/wrong/path',
              },
            },
          }),
        })
      );

      vi.mocked(lstat).mockResolvedValue(
        createMockStats(true) as unknown as Awaited<ReturnType<typeof lstat>>
      );
      vi.mocked(readlink).mockResolvedValue('/wrong/path');
      vi.mocked(ts.createProgram).mockReturnValue({
        getSyntacticDiagnostics: vi.fn(() => []),
        getSemanticDiagnostics: vi.fn(() => []),
      } as unknown as ReturnType<typeof ts.createProgram>);
      vi.mocked(writeFile).mockResolvedValue(undefined);
      vi.mocked(unlink).mockResolvedValue(undefined);

      const resultPromise = validateNpmLink();
      await vi.runAllTimersAsync();

      const result = await resultPromise;

      expect(result.errorMessage).toBeDefined();
      expect(result.errorMessage).toContain(
        'symlink exists but points to wrong location'
      );
      expect(result.errorMessage).toContain('/wrong/path');
      expect(result.errorMessage).toContain(
        '/home/dustin/projects/groundswell'
      );
    });

    it('should provide actionable error for TypeScript resolution failure', async () => {
      vi.mocked(readFile).mockResolvedValue(
        JSON.stringify({ name: 'hacky-hack', dependencies: {} })
      );

      vi.mocked(spawn).mockReturnValue(
        createMockChild({
          exitCode: 0,
          stdout: JSON.stringify({
            dependencies: {
              groundswell: {
                version: '0.0.3',
                resolved: '/home/dustin/projects/groundswell',
              },
            },
          }),
        })
      );

      vi.mocked(lstat).mockResolvedValue(
        createMockStats(true) as unknown as Awaited<ReturnType<typeof lstat>>
      );
      vi.mocked(readlink).mockResolvedValue(
        '/home/dustin/projects/groundswell'
      );
      vi.mocked(ts.createProgram).mockReturnValue({
        getSyntacticDiagnostics: vi.fn(() => []),
        getSemanticDiagnostics: vi.fn(() => [
          {
            messageText: "Cannot find module 'groundswell'",
            category: 1,
            code: 2307,
          } as any,
        ]),
      } as unknown as ReturnType<typeof ts.createProgram>);
      vi.mocked(writeFile).mockResolvedValue(undefined);
      vi.mocked(unlink).mockResolvedValue(undefined);

      const resultPromise = validateNpmLink();
      await vi.runAllTimersAsync();

      const result = await resultPromise;

      expect(result.errorMessage).toBeDefined();
      expect(result.errorMessage).toContain(
        'TypeScript cannot resolve imports'
      );
      expect(result.errorMessage).toContain('npm run build');
      expect(result.errorMessage).toContain('dist/index.d.ts');
    });
  });

  // ========================================================================
  // LinkValidationError class tests
  // ========================================================================

  describe('LinkValidationError', () => {
    it('should create error with correct properties', () => {
      const error = new LinkValidationError(
        'Test error message',
        LinkErrorCodes.GROUNDSWELL_NOT_LINKED,
        { linkPath: '/test/path' }
      );

      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('LinkValidationError');
      expect(error.message).toBe('Test error message');
      expect(error.code).toBe(LinkErrorCodes.GROUNDSWELL_NOT_LINKED);
    });

    it('should support cause parameter', () => {
      const cause = new Error('Original error');
      const error = new LinkValidationError(
        'Wrapper error',
        LinkErrorCodes.GROUNDSWELL_BAD_SYMLINK,
        { linkPath: '/test/path' },
        cause
      );

      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe('Wrapper error');
    });

    it('should have all defined error codes', () => {
      expect(LinkErrorCodes.GROUNDSWELL_NOT_LINKED).toBe(
        'GROUNDSWELL_NOT_LINKED'
      );
      expect(LinkErrorCodes.GROUNDSWELL_BAD_SYMLINK).toBe(
        'GROUNDSWELL_BAD_SYMLINK'
      );
      expect(LinkErrorCodes.GROUNDSWELL_BUILD_MISSING).toBe(
        'GROUNDSWELL_BUILD_MISSING'
      );
      expect(LinkErrorCodes.GROUNDSWELL_TYPESCRIPT_ERROR).toBe(
        'GROUNDSWELL_TYPESCRIPT_ERROR'
      );
      expect(LinkErrorCodes.GROUNDSWELL_PERMISSION_DENIED).toBe(
        'GROUNDSWELL_PERMISSION_DENIED'
      );
    });
  });

  // ========================================================================
  // Result type tests
  // ========================================================================

  describe('NpmLinkValidationResult interface', () => {
    it('should have all required properties on successful result', async () => {
      vi.mocked(readFile).mockResolvedValue(
        JSON.stringify({ name: 'hacky-hack', dependencies: {} })
      );

      vi.mocked(spawn).mockReturnValue(
        createMockChild({
          exitCode: 0,
          stdout: JSON.stringify({
            dependencies: {
              groundswell: {
                version: '0.0.3',
                resolved: '/home/dustin/projects/groundswell',
              },
            },
          }),
        })
      );

      vi.mocked(lstat).mockResolvedValue(
        createMockStats(true) as unknown as Awaited<ReturnType<typeof lstat>>
      );
      vi.mocked(readlink).mockResolvedValue(
        '/home/dustin/projects/groundswell'
      );
      vi.mocked(ts.createProgram).mockReturnValue({
        getSyntacticDiagnostics: vi.fn(() => []),
        getSemanticDiagnostics: vi.fn(() => []),
      } as unknown as ReturnType<typeof ts.createProgram>);
      vi.mocked(writeFile).mockResolvedValue(undefined);
      vi.mocked(unlink).mockResolvedValue(undefined);

      const resultPromise = validateNpmLink();
      await vi.runAllTimersAsync();

      const result = (await resultPromise) as NpmLinkValidationResult;

      // Check all properties exist
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('linkedPath');
      expect(result).toHaveProperty('isSymlink');
      expect(result).toHaveProperty('typescriptResolves');
      expect(result).toHaveProperty('symlinkTarget');
      expect(result).toHaveProperty('packageJsonEntry');
      expect(result).toHaveProperty('version');
      expect(result).toHaveProperty('isValidTarget');
    });

    it('should include errorMessage on failed result', async () => {
      vi.mocked(readFile).mockResolvedValue(
        JSON.stringify({ name: 'hacky-hack', dependencies: {} })
      );

      vi.mocked(spawn).mockReturnValue(
        createMockChild({
          exitCode: 1,
          stdout: '',
          stderr: 'empty',
        })
      );

      const enoentError = new Error('ENOENT') as NodeJS.ErrnoException;
      enoentError.code = 'ENOENT';
      vi.mocked(lstat).mockRejectedValue(enoentError);

      const resultPromise = validateNpmLink();
      await vi.runAllTimersAsync();

      const result = (await resultPromise) as NpmLinkValidationResult;

      expect(result.success).toBe(false);
      expect(result.errorMessage).toBeDefined();
      expect(typeof result.errorMessage).toBe('string');
    });
  });
});
