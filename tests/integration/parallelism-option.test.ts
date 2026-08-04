/**
 * Integration tests for --parallelism CLI option
 *
 * @remarks
 * Tests validate the --parallelism CLI option including:
 * - Default value (2 when not specified)
 * - Custom values (1-10 range)
 * - Range validation (rejects < 1 and > 10)
 * - Type validation (rejects non-integers)
 * - Resource warnings (CPU cores, memory)
 * - Integration with CLI argument parsing
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

// Mock the logger with hoisted variables
const { mockLogger, mockCpus, mockFreemem } = vi.hoisted(() => ({
  mockLogger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  mockCpus: vi.fn(() => Array(8).fill({ model: 'Test CPU', speed: 1000 })),
  mockFreemem: vi.fn(() => 16 * 1024 * 1024 * 1024),
}));

vi.mock('../../src/utils/logger.js', () => ({
  getLogger: vi.fn(() => mockLogger),
}));

// Mock the node:os module with stubModule - this is the proper way to mock native modules
vi.mock('node:os', () => ({
  cpus: mockCpus,
  freemem: mockFreemem,
  totalmem: vi.fn(() => 32 * 1024 * 1024 * 1024),
}));

// Import after mocking
import { parseCLIArgs, type CLIArgs } from '../../src/cli/index.js';

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

describe('Parallelism CLI Option', () => {
  let originalArgv: string[];
  let originalExit: any;

  beforeEach(() => {
    originalArgv = process.argv;
    originalExit = process.exit;

    // Reset OS mocks to default (8 cores, 16GB RAM)
    mockCpus.mockReturnValue(Array(8).fill({ model: 'Test CPU', speed: 1000 }));
    mockFreemem.mockReturnValue(16 * 1024 * 1024 * 1024);

    // Mock process.exit to capture exit calls
    const mockExit = vi.fn((code: number) => {
      throw new Error(`process.exit(${code})`);
    });
    process.exit = mockExit as any;

    // Clear all mocks before each test
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.exit = originalExit;
    vi.clearAllMocks();
  });

  describe('Default value', () => {
    it('should use default parallelism of 2 when not specified', () => {
      process.argv = ['node', 'cli.js', '--prd', 'PRD.md'];
      const args = parseCLIArgs() as CLIArgs;
      expect(args.parallelism).toBe(2);
      expect(mockLogger.error).not.toHaveBeenCalled();
    });
  });

  describe('Custom values', () => {
    it('should accept parallelism of 1 (minimum)', () => {
      process.argv = [
        'node',
        'cli.js',
        '--prd',
        'PRD.md',
        '--parallelism',
        '1',
      ];
      const args = parseCLIArgs() as CLIArgs;
      expect(args.parallelism).toBe(1);
      expect(mockLogger.error).not.toHaveBeenCalled();
    });

    it('should accept parallelism of 5 (mid-range)', () => {
      process.argv = [
        'node',
        'cli.js',
        '--prd',
        'PRD.md',
        '--parallelism',
        '5',
      ];
      const args = parseCLIArgs() as CLIArgs;
      expect(args.parallelism).toBe(5);
      expect(mockLogger.error).not.toHaveBeenCalled();
    });

    it('should accept parallelism of 10 (maximum)', () => {
      process.argv = [
        'node',
        'cli.js',
        '--prd',
        'PRD.md',
        '--parallelism',
        '10',
      ];
      const args = parseCLIArgs() as CLIArgs;
      expect(args.parallelism).toBe(10);
      expect(mockLogger.error).not.toHaveBeenCalled();
    });
  });

  describe('Range validation', () => {
    it('should reject parallelism of 0 (below minimum)', () => {
      process.argv = [
        'node',
        'cli.js',
        '--prd',
        'PRD.md',
        '--parallelism',
        '0',
      ];
      expect(() => parseCLIArgs()).toThrow('process.exit(1)');
      expect(mockLogger.error).toHaveBeenCalledWith(
        '--parallelism must be an integer between 1 and 10'
      );
    });

    it('should reject negative parallelism', () => {
      process.argv = [
        'node',
        'cli.js',
        '--prd',
        'PRD.md',
        '--parallelism',
        '-1',
      ];
      expect(() => parseCLIArgs()).toThrow('process.exit(1)');
      expect(mockLogger.error).toHaveBeenCalledWith(
        '--parallelism must be an integer between 1 and 10'
      );
    });

    it('should reject parallelism of 11 (above maximum)', () => {
      process.argv = [
        'node',
        'cli.js',
        '--prd',
        'PRD.md',
        '--parallelism',
        '11',
      ];
      expect(() => parseCLIArgs()).toThrow('process.exit(1)');
      expect(mockLogger.error).toHaveBeenCalledWith(
        '--parallelism must be an integer between 1 and 10'
      );
    });

    it('should reject parallelism of 100 (far above maximum)', () => {
      process.argv = [
        'node',
        'cli.js',
        '--prd',
        'PRD.md',
        '--parallelism',
        '100',
      ];
      expect(() => parseCLIArgs()).toThrow('process.exit(1)');
      expect(mockLogger.error).toHaveBeenCalledWith(
        '--parallelism must be an integer between 1 and 10'
      );
    });
  });

  describe('Type validation', () => {
    it('should reject non-integer parallelism (abc)', () => {
      process.argv = [
        'node',
        'cli.js',
        '--prd',
        'PRD.md',
        '--parallelism',
        'abc',
      ];
      expect(() => parseCLIArgs()).toThrow('process.exit(1)');
      expect(mockLogger.error).toHaveBeenCalledWith(
        '--parallelism must be an integer between 1 and 10'
      );
    });

    it('should accept decimal and truncate to integer (3.5 -> 3)', () => {
      process.argv = [
        'node',
        'cli.js',
        '--prd',
        'PRD.md',
        '--parallelism',
        '3.5',
      ];
      // parseFloat('3.5') = 3.5, parseInt('3.5', 10) = 3, so this passes
      // because parseInt truncates. This is expected behavior.
      const args = parseCLIArgs() as CLIArgs;
      expect(args.parallelism).toBe(3); // parseInt truncates decimals
    });

    it('should reject empty string parallelism', () => {
      process.argv = ['node', 'cli.js', '--prd', 'PRD.md', '--parallelism', ''];
      expect(() => parseCLIArgs()).toThrow('process.exit(1)');
      expect(mockLogger.error).toHaveBeenCalledWith(
        '--parallelism must be an integer between 1 and 10'
      );
    });

    it('should reject whitespace-only parallelism', () => {
      process.argv = [
        'node',
        'cli.js',
        '--prd',
        'PRD.md',
        '--parallelism',
        '  ',
      ];
      expect(() => parseCLIArgs()).toThrow('process.exit(1)');
      expect(mockLogger.error).toHaveBeenCalledWith(
        '--parallelism must be an integer between 1 and 10'
      );
    });
  });

  describe('CPU resource warnings', () => {
    it('should warn when parallelism exceeds CPU cores', () => {
      // Mock os.cpus() to return 4 cores
      mockCpus.mockReturnValue(
        Array(4).fill({ model: 'Test CPU', speed: 1000 })
      );

      process.argv = [
        'node',
        'cli.js',
        '--prd',
        'PRD.md',
        '--parallelism',
        '8',
      ];
      const args = parseCLIArgs() as CLIArgs;

      expect(args.parallelism).toBe(8); // Should still accept the value
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('exceeds CPU cores')
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Recommended: --parallelism 3')
      );
      expect(mockLogger.error).not.toHaveBeenCalled(); // No error, just warning
    });

    it('should not warn when parallelism equals CPU cores', () => {
      // Mock os.cpus() to return 4 cores
      mockCpus.mockReturnValue(
        Array(4).fill({ model: 'Test CPU', speed: 1000 })
      );

      process.argv = [
        'node',
        'cli.js',
        '--prd',
        'PRD.md',
        '--parallelism',
        '4',
      ];
      const args = parseCLIArgs() as CLIArgs;

      expect(args.parallelism).toBe(4);
      expect(mockLogger.warn).not.toHaveBeenCalled(); // No warning when equal
    });

    it('should not warn when parallelism is less than CPU cores', () => {
      // Default mock is 8 cores, parallelism 4

      process.argv = [
        'node',
        'cli.js',
        '--prd',
        'PRD.md',
        '--parallelism',
        '4',
      ];
      const args = parseCLIArgs() as CLIArgs;

      expect(args.parallelism).toBe(4);
      expect(mockLogger.warn).not.toHaveBeenCalled(); // No warning when less than cores
    });

    it('should recommend minimum of 1 when CPU cores is 1', () => {
      // Mock os.cpus() to return 1 core
      mockCpus.mockReturnValue(
        Array(1).fill({ model: 'Test CPU', speed: 1000 })
      );

      process.argv = [
        'node',
        'cli.js',
        '--prd',
        'PRD.md',
        '--parallelism',
        '2',
      ];
      const args = parseCLIArgs() as CLIArgs;

      expect(args.parallelism).toBe(2);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('exceeds CPU cores')
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Recommended: --parallelism 1')
      );
    });
  });

  describe('Memory resource warnings', () => {
    it('should warn when estimated memory exceeds 80% of free memory', () => {
      // Mock low memory scenario: 1GB free, parallelism 5 = 2.5GB estimated (500MB per worker)
      mockFreemem.mockReturnValue(1 * 1024 * 1024 * 1024); // 1GB free

      process.argv = [
        'node',
        'cli.js',
        '--prd',
        'PRD.md',
        '--parallelism',
        '5',
      ];
      const args = parseCLIArgs() as CLIArgs;

      expect(args.parallelism).toBe(5);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('may exhaust free memory')
      );
    });

    it('should not warn when estimated memory is within 80% of free memory', () => {
      // Default mock is 16GB free, parallelism 5 = 2.5GB estimated
      // 2.5GB < 80% of 16GB (12.8GB), so no warning

      process.argv = [
        'node',
        'cli.js',
        '--prd',
        'PRD.md',
        '--parallelism',
        '5',
      ];
      const args = parseCLIArgs() as CLIArgs;

      expect(args.parallelism).toBe(5);
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });
  });

  describe('Combined warnings', () => {
    it('should show both CPU and memory warnings when both thresholds exceeded', () => {
      // Mock system with low CPU cores and low memory
      mockCpus.mockReturnValue(
        Array(2).fill({ model: 'Test CPU', speed: 1000 })
      );
      mockFreemem.mockReturnValue(1 * 1024 * 1024 * 1024); // 1GB free

      process.argv = [
        'node',
        'cli.js',
        '--prd',
        'PRD.md',
        '--parallelism',
        '10',
      ];
      const args = parseCLIArgs() as CLIArgs;

      expect(args.parallelism).toBe(10);
      // Should show CPU warning
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('exceeds CPU cores')
      );
      // Should show memory warning
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('may exhaust free memory')
      );
    });
  });

  describe('Integration with other options', () => {
    it('should work correctly with other CLI options', () => {
      process.argv = [
        'node',
        'cli.js',
        '--prd',
        'PRD.md',
        '--parallelism',
        '3',
        '--verbose',
      ];
      const args = parseCLIArgs() as CLIArgs;

      expect(args.parallelism).toBe(3);
      expect(args.verbose).toBe(true);
      expect(mockLogger.error).not.toHaveBeenCalled();
    });
  });
});
