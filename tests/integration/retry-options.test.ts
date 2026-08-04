/**
 * Integration tests for retry CLI options
 *
 * @remarks
 * Tests validate the retry CLI options including:
 * - --task-retry option (0-10 range, default: 3)
 * - --retry-backoff option (100-60000 range, default: 1000)
 * - --no-retry flag (boolean, disables retry)
 * - Environment variable HACKY_TASK_RETRY_MAX_ATTEMPTS
 * - CLI option precedence over environment variable
 * - Range validation and type conversion
 * - Integration with CLI argument parsing
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

// Mock the logger with hoisted variables
const { mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../src/utils/logger.js', () => ({
  getLogger: vi.fn(() => mockLogger),
}));

// Import after mocking
import { parseCLIArgs, isCLIArgs } from '../../src/cli/index.js';

// Mock the node:fs module for PRD file existence
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: vi.fn(() => true),
  };
});

// Mock the node:path module
vi.mock('node:path', async importOriginal => {
  const actual = await importOriginal<typeof import('node:path')>();
  return {
    ...actual,
    // Preserve real resolve semantics (join args) so parseCLIArgs can still
    // locate ../../package.json relative to import.meta.dirname. The previous
    // identity mock discarded the second argument and made that read hit a
    // directory (EISDIR), failing every test in this file before parsing began.
    resolve: vi.fn((...args: string[]) => actual.resolve(...args)),
  };
});

// Mock node:os for resource checks
vi.mock('node:os', () => ({
  cpus: vi.fn(() => Array(8).fill({ model: 'Test CPU', speed: 1000 })),
  freemem: vi.fn(() => 16 * 1024 * 1024 * 1024),
  totalmem: vi.fn(() => 32 * 1024 * 1024 * 1024),
}));

describe('CLI Retry Options', () => {
  let originalArgv: string[];
  let originalExit: any;

  beforeEach(() => {
    originalArgv = process.argv;
    originalExit = process.exit;

    // Mock process.exit to capture exit calls
    const mockExit = vi.fn((code: number) => {
      throw new Error(`process.exit(${code})`);
    });
    process.exit = mockExit as any;

    // Clear all mocks before each test
    vi.clearAllMocks();

    // Clear environment variables
    delete process.env.HACKY_TASK_RETRY_MAX_ATTEMPTS;
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.exit = originalExit;
    vi.clearAllMocks();

    // Clean up environment variables
    delete process.env.HACKY_TASK_RETRY_MAX_ATTEMPTS;
  });

  describe('--task-retry', () => {
    it('should accept valid task-retry value', () => {
      process.argv = ['node', 'cli.js', '--prd', 'PRD.md', '--task-retry', '5'];
      const args = parseCLIArgs();

      if (isCLIArgs(args)) {
        expect(args.taskRetry).toBe(5);
      }
    });

    it('should use default value of 3 when not specified', () => {
      process.argv = ['node', 'cli.js', '--prd', 'PRD.md'];
      const args = parseCLIArgs();

      if (isCLIArgs(args)) {
        expect(args.taskRetry).toBe(3);
      }
    });

    it('should accept 0 to disable retry', () => {
      process.argv = ['node', 'cli.js', '--prd', 'PRD.md', '--task-retry', '0'];
      const args = parseCLIArgs();

      if (isCLIArgs(args)) {
        expect(args.taskRetry).toBe(0);
      }
    });

    it('should accept 10 (maximum)', () => {
      process.argv = [
        'node',
        'cli.js',
        '--prd',
        'PRD.md',
        '--task-retry',
        '10',
      ];
      const args = parseCLIArgs();

      if (isCLIArgs(args)) {
        expect(args.taskRetry).toBe(10);
      }
    });

    it('should reject task-retry of -1 (below minimum)', () => {
      const mockExit = vi.fn((code: number) => {
        throw new Error(`process.exit(${code})`);
      });
      process.exit = mockExit as any;

      process.argv = [
        'node',
        'cli.js',
        '--prd',
        'PRD.md',
        '--task-retry',
        '-1',
      ];
      expect(() => parseCLIArgs()).toThrow('process.exit(1)');
      expect(mockLogger.error).toHaveBeenCalledWith(
        '--task-retry must be an integer between 0 and 10'
      );
    });

    it('should reject task-retry of 11 (above maximum)', () => {
      const mockExit = vi.fn((code: number) => {
        throw new Error(`process.exit(${code})`);
      });
      process.exit = mockExit as any;

      process.argv = [
        'node',
        'cli.js',
        '--prd',
        'PRD.md',
        '--task-retry',
        '11',
      ];
      expect(() => parseCLIArgs()).toThrow('process.exit(1)');
      expect(mockLogger.error).toHaveBeenCalledWith(
        '--task-retry must be an integer between 0 and 10'
      );
    });

    it('should reject non-numeric task-retry', () => {
      const mockExit = vi.fn((code: number) => {
        throw new Error(`process.exit(${code})`);
      });
      process.exit = mockExit as any;

      process.argv = [
        'node',
        'cli.js',
        '--prd',
        'PRD.md',
        '--task-retry',
        'abc',
      ];
      expect(() => parseCLIArgs()).toThrow('process.exit(1)');
      expect(mockLogger.error).toHaveBeenCalledWith(
        '--task-retry must be an integer between 0 and 10'
      );
    });

    it('should use HACKY_TASK_RETRY_MAX_ATTEMPTS environment variable', () => {
      process.env.HACKY_TASK_RETRY_MAX_ATTEMPTS = '7';
      process.argv = ['node', 'cli.js', '--prd', 'PRD.md'];

      const args = parseCLIArgs();

      if (isCLIArgs(args)) {
        expect(args.taskRetry).toBe(7);
      }
    });

    it('should prefer CLI option over environment variable', () => {
      process.env.HACKY_TASK_RETRY_MAX_ATTEMPTS = '7';
      process.argv = ['node', 'cli.js', '--prd', 'PRD.md', '--task-retry', '5'];

      const args = parseCLIArgs();

      if (isCLIArgs(args)) {
        expect(args.taskRetry).toBe(5); // CLI wins
      }
    });
  });

  describe('--retry-backoff', () => {
    it('should accept valid retry-backoff value', () => {
      process.argv = [
        'node',
        'cli.js',
        '--prd',
        'PRD.md',
        '--retry-backoff',
        '2000',
      ];
      const args = parseCLIArgs();

      if (isCLIArgs(args)) {
        expect(args.retryBackoff).toBe(2000);
      }
    });

    it('should use default value of 1000 when not specified', () => {
      process.argv = ['node', 'cli.js', '--prd', 'PRD.md'];
      const args = parseCLIArgs();

      if (isCLIArgs(args)) {
        expect(args.retryBackoff).toBe(1000);
      }
    });

    it('should accept 100 (minimum)', () => {
      process.argv = [
        'node',
        'cli.js',
        '--prd',
        'PRD.md',
        '--retry-backoff',
        '100',
      ];
      const args = parseCLIArgs();

      if (isCLIArgs(args)) {
        expect(args.retryBackoff).toBe(100);
      }
    });

    it('should accept 60000 (maximum)', () => {
      process.argv = [
        'node',
        'cli.js',
        '--prd',
        'PRD.md',
        '--retry-backoff',
        '60000',
      ];
      const args = parseCLIArgs();

      if (isCLIArgs(args)) {
        expect(args.retryBackoff).toBe(60000);
      }
    });

    it('should reject retry-backoff of 99 (below minimum)', () => {
      const mockExit = vi.fn((code: number) => {
        throw new Error(`process.exit(${code})`);
      });
      process.exit = mockExit as any;

      process.argv = [
        'node',
        'cli.js',
        '--prd',
        'PRD.md',
        '--retry-backoff',
        '99',
      ];
      expect(() => parseCLIArgs()).toThrow('process.exit(1)');
      expect(mockLogger.error).toHaveBeenCalledWith(
        '--retry-backoff must be an integer between 100 and 60000'
      );
    });

    it('should reject retry-backoff of 60001 (above maximum)', () => {
      const mockExit = vi.fn((code: number) => {
        throw new Error(`process.exit(${code})`);
      });
      process.exit = mockExit as any;

      process.argv = [
        'node',
        'cli.js',
        '--prd',
        'PRD.md',
        '--retry-backoff',
        '60001',
      ];
      expect(() => parseCLIArgs()).toThrow('process.exit(1)');
      expect(mockLogger.error).toHaveBeenCalledWith(
        '--retry-backoff must be an integer between 100 and 60000'
      );
    });

    it('should reject non-numeric retry-backoff', () => {
      const mockExit = vi.fn((code: number) => {
        throw new Error(`process.exit(${code})`);
      });
      process.exit = mockExit as any;

      process.argv = [
        'node',
        'cli.js',
        '--prd',
        'PRD.md',
        '--retry-backoff',
        'abc',
      ];
      expect(() => parseCLIArgs()).toThrow('process.exit(1)');
      expect(mockLogger.error).toHaveBeenCalledWith(
        '--retry-backoff must be an integer between 100 and 60000'
      );
    });
  });

  describe('--no-retry', () => {
    it('should set noRetry to true when flag is present', () => {
      process.argv = ['node', 'cli.js', '--prd', 'PRD.md', '--no-retry'];
      const args = parseCLIArgs();

      if (isCLIArgs(args)) {
        expect(args.noRetry).toBe(true);
      }
    });

    it('should default noRetry to false when flag not present', () => {
      process.argv = ['node', 'cli.js', '--prd', 'PRD.md'];
      const args = parseCLIArgs();

      if (isCLIArgs(args)) {
        expect(args.noRetry).toBe(false);
      }
    });
  });

  describe('integration', () => {
    it('should work correctly with other CLI options', () => {
      process.argv = [
        'node',
        'cli.js',
        '--prd',
        'PRD.md',
        '--task-retry',
        '5',
        '--retry-backoff',
        '2000',
        '--parallelism',
        '3',
        '--research-concurrency',
        '5',
      ];

      const args = parseCLIArgs();

      if (isCLIArgs(args)) {
        expect(args.taskRetry).toBe(5);
        expect(args.retryBackoff).toBe(2000);
        expect(args.parallelism).toBe(3);
        expect(args.researchConcurrency).toBe(5);
      }
    });

    it('should work with --no-retry and other options', () => {
      process.argv = [
        'node',
        'cli.js',
        '--prd',
        'PRD.md',
        '--no-retry',
        '--parallelism',
        '4',
      ];

      const args = parseCLIArgs();

      if (isCLIArgs(args)) {
        expect(args.noRetry).toBe(true);
        expect(args.parallelism).toBe(4);
      }
    });

    it('should parse all retry options together', () => {
      process.argv = [
        'node',
        'cli.js',
        '--prd',
        'PRD.md',
        '--task-retry',
        '7',
        '--retry-backoff',
        '5000',
        '--no-retry',
      ];

      const args = parseCLIArgs();

      if (isCLIArgs(args)) {
        expect(args.taskRetry).toBe(7);
        expect(args.retryBackoff).toBe(5000);
        expect(args.noRetry).toBe(true);
      }
    });
  });
});
