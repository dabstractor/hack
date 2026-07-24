/**
 * Unit tests for CLI argument parser
 *
 * @remarks
 * Tests validate parseCLIArgs function from src/cli/index.ts with comprehensive
 * coverage of happy path, validation, and error handling.
 *
 * Mocks are used for all external dependencies - no real file system checks
 * or process.exit calls are performed.
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  parseCLIArgs,
  isCLIArgs,
  type CLIArgs,
} from '../../../src/cli/index.js';

// Mock process.argv
const originalArgv = process.argv;
const originalExit = process.exit;

// Mock the node:fs module (existsSync is overridden per-test; readFileSync
// is preserved so parseCLIArgs can read package.json for --version).
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: vi.fn(),
  };
});

// Mock node:fs/promises for the task/status action handler (dynamic import)
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(async () => JSON.stringify({ backlog: [] })),
}));

// Mock the logger with hoisted variables
const { mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../../src/utils/logger.js', () => ({
  getLogger: vi.fn(() => mockLogger),
}));

import { existsSync } from 'node:fs';
import { readFile as mockReadFile } from 'node:fs/promises';

const mockExistsSync = existsSync as any;
const mockReadFileFn = mockReadFile as any;

describe('cli/index', () => {
  let mockExit: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Default: file exists
    mockExistsSync.mockReturnValue(true);

    // Default: minimal valid backlog for the task/status handler
    mockReadFileFn.mockResolvedValue(JSON.stringify({ backlog: [] }));

    // Clear mock logger calls
    mockLogger.info.mockClear();
    mockLogger.error.mockClear();
    mockLogger.warn.mockClear();
    mockLogger.debug.mockClear();

    // Mock process.exit to capture exit calls and prevent actual exit
    // Make it throw to stop execution (simulating real process.exit behavior)
    mockExit = vi.fn((code: number) => {
      throw new Error(`process.exit(${code})`);
    });
    process.exit = mockExit as any;
  });

  afterEach(() => {
    // Restore original process.argv
    process.argv = originalArgv;

    // Restore original process.exit
    process.exit = originalExit;

    // Clear all mocks
    vi.clearAllMocks();
  });

  /**
   * Helper to set process.argv for testing
   */
  const setArgv = (args: string[] = []) => {
    process.argv = ['node', '/path/to/script.js', ...args];
  };

  /**
   * Helper to parse CLI args with type guard
   * Throws if the result is a subcommand (should not happen in these tests)
   */
  const parseArgs = (): CLIArgs => {
    const args = parseCLIArgs();
    if (!isCLIArgs(args)) {
      throw new Error('Unexpected subcommand result in CLI args test');
    }
    return args;
  };

  describe('parseCLIArgs', () => {
    describe('default values', () => {
      it('should use default PRD path when not provided', () => {
        // SETUP
        setArgv([]);

        // EXECUTE
        const args = parseArgs();

        // VERIFY: Default PRD path is used
        expect(args.prd).toBe('./PRD.md');
      });

      it('should use default mode when not provided', () => {
        // SETUP
        setArgv([]);

        // EXECUTE
        const args = parseArgs();

        // VERIFY: Default mode is 'normal'
        expect(args.mode).toBe('normal');
      });

      it('should default boolean flags to false', () => {
        // SETUP
        setArgv([]);

        // EXECUTE
        const args = parseArgs();

        // VERIFY: All boolean flags are false
        expect(args.continue).toBe(false);
        expect(args.dryRun).toBe(false);
        expect(args.verbose).toBe(false);
      });

      it('should have undefined scope when not provided', () => {
        // SETUP
        setArgv([]);

        // EXECUTE
        const args = parseArgs();

        // VERIFY: Scope is undefined
        expect(args.scope).toBeUndefined();
      });
    });

    describe('parsing options', () => {
      it('should parse custom PRD path', () => {
        // SETUP
        setArgv(['--prd', './custom/PRD.md']);

        // EXECUTE
        const args = parseArgs();

        // VERIFY: Custom PRD path is used
        expect(args.prd).toBe('./custom/PRD.md');
      });

      it('should parse scope option', () => {
        // SETUP
        setArgv(['--scope', 'P3.M4']);

        // EXECUTE
        const args = parseArgs();

        // VERIFY: Scope is parsed
        expect(args.scope).toBe('P3.M4');
      });

      it('should parse bug-hunt mode', () => {
        // SETUP
        setArgv(['--mode', 'bug-hunt']);

        // EXECUTE
        const args = parseArgs();

        // VERIFY: Mode is set to bug-hunt
        expect(args.mode).toBe('bug-hunt');
      });

      it('should parse validate mode', () => {
        // SETUP
        setArgv(['--mode', 'validate']);

        // EXECUTE
        const args = parseArgs();

        // VERIFY: Mode is set to validate
        expect(args.mode).toBe('validate');
      });

      it('should parse --continue flag', () => {
        // SETUP
        setArgv(['--continue']);

        // EXECUTE
        const args = parseArgs();

        // VERIFY: Continue flag is true
        expect(args.continue).toBe(true);
      });

      it('should parse --dry-run flag', () => {
        // SETUP
        setArgv(['--dry-run']);

        // EXECUTE
        const args = parseArgs();

        // VERIFY: Dry run flag is true
        expect(args.dryRun).toBe(true);
      });

      it('should parse --verbose flag', () => {
        // SETUP
        setArgv(['--verbose']);

        // EXECUTE
        const args = parseArgs();

        // VERIFY: Verbose flag is true
        expect(args.verbose).toBe(true);
      });

      it('should parse all options together', () => {
        // SETUP
        setArgv([
          '--prd',
          './custom/PRD.md',
          '--scope',
          'P1.M2.T3',
          '--mode',
          'bug-hunt',
          '--continue',
          '--dry-run',
          '--verbose',
        ]);

        // EXECUTE
        const args = parseArgs();

        // VERIFY: All options are parsed correctly
        expect(args.prd).toBe('./custom/PRD.md');
        expect(args.scope).toBe('P1.M2.T3');
        expect(args.mode).toBe('bug-hunt');
        expect(args.continue).toBe(true);
        expect(args.dryRun).toBe(true);
        expect(args.verbose).toBe(true);
      });
    });

    describe('PRD file validation', () => {
      it('should exit with code 1 when PRD file does not exist', () => {
        // SETUP: File does not exist
        mockExistsSync.mockReturnValue(false);
        setArgv(['--prd', './nonexistent.md']);

        // EXECUTE & VERIFY: Should throw process.exit error
        expect(() => parseCLIArgs()).toThrow('process.exit(1)');
        expect(mockExit).toHaveBeenCalledWith(1);
      });

      it('should display error message when PRD file not found', () => {
        // SETUP: File does not exist
        mockExistsSync.mockReturnValue(false);
        setArgv(['--prd', './missing.md']);

        // EXECUTE & VERIFY: Should throw process.exit error
        expect(() => parseCLIArgs()).toThrow('process.exit(1)');

        // VERIFY: Error message was logged
        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.stringContaining('PRD file not found')
        );
        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.stringContaining('./missing.md')
        );
      });

      it('should show help text with PRD file path in error', () => {
        // SETUP: File does not exist
        mockExistsSync.mockReturnValue(false);
        setArgv(['--prd', './missing.md']);

        // EXECUTE & VERIFY: Should throw process.exit error
        expect(() => parseCLIArgs()).toThrow('process.exit(1)');

        // VERIFY: Help text includes --prd usage
        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.stringContaining('--prd')
        );
      });

      it('should not exit when PRD file exists', () => {
        // SETUP: File exists
        mockExistsSync.mockReturnValue(true);
        setArgv(['--prd', './existing.md']);

        // EXECUTE
        const args = parseArgs();

        // VERIFY: process.exit was NOT called
        expect(mockExit).not.toHaveBeenCalled();
        expect(args.prd).toBe('./existing.md');
      });
    });

    describe('scope validation', () => {
      it('should accept valid phase scope', () => {
        // SETUP
        setArgv(['--scope', 'P1']);

        // EXECUTE
        const args = parseArgs();

        // VERIFY: Scope is accepted
        expect(args.scope).toBe('P1');
        expect(mockExit).not.toHaveBeenCalled();
      });

      it('should accept valid milestone scope', () => {
        // SETUP
        setArgv(['--scope', 'P1.M1']);

        // EXECUTE
        const args = parseArgs();

        // VERIFY: Scope is accepted
        expect(args.scope).toBe('P1.M1');
      });

      it('should accept valid task scope', () => {
        // SETUP
        setArgv(['--scope', 'P1.M1.T1']);

        // EXECUTE
        const args = parseArgs();

        // VERIFY: Scope is accepted
        expect(args.scope).toBe('P1.M1.T1');
      });

      it('should accept valid subtask scope', () => {
        // SETUP
        setArgv(['--scope', 'P1.M1.T1.S1']);

        // EXECUTE
        const args = parseArgs();

        // VERIFY: Scope is accepted
        expect(args.scope).toBe('P1.M1.T1.S1');
      });

      it('should accept "all" keyword', () => {
        // SETUP
        setArgv(['--scope', 'all']);

        // EXECUTE
        const args = parseArgs();

        // VERIFY: Scope is accepted
        expect(args.scope).toBe('all');
      });

      it('should reject invalid scope and exit with code 1', () => {
        // SETUP: Invalid scope
        setArgv(['--scope', 'INVALID']);

        // EXECUTE & VERIFY: Should throw process.exit error
        expect(() => parseCLIArgs()).toThrow('process.exit(1)');
        expect(mockExit).toHaveBeenCalledWith(1);
      });

      it('should display error message for invalid scope', () => {
        // SETUP: Invalid scope
        setArgv(['--scope', 'P1.X1']);

        // EXECUTE & VERIFY: Should throw process.exit error
        expect(() => parseCLIArgs()).toThrow('process.exit(1)');

        // VERIFY: Error message was logged
        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.stringContaining('Invalid scope')
        );
        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.stringContaining('P1.X1')
        );
      });

      it('should show expected format in scope error message', () => {
        // SETUP: Invalid scope
        setArgv(['--scope', 'bad-scope']);

        // EXECUTE & VERIFY: Should throw process.exit error
        expect(() => parseCLIArgs()).toThrow('process.exit(1)');

        // VERIFY: Expected format is shown
        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.stringContaining('Expected format')
        );
        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.stringContaining('P1, P1.M1, P1.M1.T1, P1.M1.T1.S1, or all')
        );
      });

      it('should show details from ScopeParseError', () => {
        // SETUP: Invalid scope with specific format issue
        setArgv(['--scope', 'p1']); // lowercase p is invalid

        // EXECUTE & VERIFY: Should throw process.exit error
        expect(() => parseCLIArgs()).toThrow('process.exit(1)');

        // VERIFY: Details from error are shown
        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.stringContaining('Details:')
        );
      });

      it('should skip scope validation when scope not provided', () => {
        // SETUP: No scope provided
        setArgv([]);

        // EXECUTE
        const args = parseArgs();

        // VERIFY: No scope validation error
        expect(args.scope).toBeUndefined();
        expect(mockExit).not.toHaveBeenCalled();
      });
    });

    describe('mode validation', () => {
      it('should accept "normal" mode', () => {
        // SETUP
        setArgv(['--mode', 'normal']);

        // EXECUTE
        const args = parseArgs();

        // VERIFY: Mode is accepted
        expect(args.mode).toBe('normal');
      });

      it('should accept "bug-hunt" mode', () => {
        // SETUP
        setArgv(['--mode', 'bug-hunt']);

        // EXECUTE
        const args = parseArgs();

        // VERIFY: Mode is accepted
        expect(args.mode).toBe('bug-hunt');
      });

      it('should accept "validate" mode', () => {
        // SETUP
        setArgv(['--mode', 'validate']);

        // EXECUTE
        const args = parseArgs();

        // VERIFY: Mode is accepted
        expect(args.mode).toBe('validate');
      });

      it('should reject invalid mode choice', () => {
        // SETUP: Invalid mode
        setArgv(['--mode', 'invalid-mode']);

        // EXECUTE & VERIFY: Commander.js calls process.exit(1) for invalid choices
        expect(() => parseCLIArgs()).toThrow('process.exit(1)');
        expect(mockExit).toHaveBeenCalledWith(1);
      });
    });

    describe('boolean flag combinations', () => {
      it('should handle single boolean flag', () => {
        // SETUP
        setArgv(['--verbose']);

        // EXECUTE
        const args = parseArgs();

        // VERIFY
        expect(args.verbose).toBe(true);
        expect(args.continue).toBe(false);
        expect(args.dryRun).toBe(false);
      });

      it('should handle two boolean flags', () => {
        // SETUP
        setArgv(['--dry-run', '--verbose']);

        // EXECUTE
        const args = parseArgs();

        // VERIFY
        expect(args.dryRun).toBe(true);
        expect(args.verbose).toBe(true);
        expect(args.continue).toBe(false);
      });

      it('should handle all three boolean flags', () => {
        // SETUP
        setArgv(['--continue', '--dry-run', '--verbose']);

        // EXECUTE
        const args = parseArgs();

        // VERIFY
        expect(args.continue).toBe(true);
        expect(args.dryRun).toBe(true);
        expect(args.verbose).toBe(true);
      });
    });

    describe('CLIArgs interface', () => {
      it('should return object matching CLIArgs interface', () => {
        // SETUP
        setArgv([]);

        // EXECUTE
        const args = parseArgs();

        // VERIFY: All required properties exist
        expect(args).toHaveProperty('prd');
        expect(args).toHaveProperty('mode');
        expect(args).toHaveProperty('continue');
        expect(args).toHaveProperty('dryRun');
        expect(args).toHaveProperty('verbose');
        // scope is optional - check that it's either undefined or exists
        expect('scope' in args || args.scope === undefined).toBe(true);
      });

      it('should have correct types for all properties', () => {
        // SETUP
        setArgv([
          '--prd',
          './test.md',
          '--scope',
          'P1',
          '--mode',
          'bug-hunt',
          '--continue',
          '--dry-run',
          '--verbose',
        ]);

        // EXECUTE
        const args = parseArgs();

        // VERIFY: Types are correct
        expect(typeof args.prd).toBe('string');
        expect(typeof args.scope).toBe('string');
        expect(typeof args.mode).toBe('string');
        expect(['normal', 'bug-hunt', 'validate']).toContain(args.mode);
        expect(typeof args.continue).toBe('boolean');
        expect(typeof args.dryRun).toBe('boolean');
        expect(typeof args.verbose).toBe('boolean');
      });
    });

    describe('research flags (-r / --research-depth)', () => {
      it('should default -r/--parallel-research to false when not provided', () => {
        // SETUP
        setArgv([]);

        // EXECUTE
        const args = parseArgs();

        // VERIFY: boolean default is false
        expect(args.parallelResearch).toBe(false);
      });

      it('should set parallelResearch to true when -r is passed', () => {
        // SETUP
        setArgv(['-r']);

        // EXECUTE
        const args = parseArgs();

        // VERIFY: -r enables parallel research
        expect(args.parallelResearch).toBe(true);
      });

      it('should set parallelResearch to true when --parallel-research is passed', () => {
        // SETUP
        setArgv(['--parallel-research']);

        // EXECUTE
        const args = parseArgs();

        // VERIFY: long form alias enables parallel research
        expect(args.parallelResearch).toBe(true);
      });

      it('should default --research-depth to 2 when not provided', () => {
        // SETUP
        setArgv([]);

        // EXECUTE
        const args = parseArgs();

        // VERIFY: default depth is 2 (validated as number)
        expect(args.researchDepth).toBe(2);
      });

      it('should coerce --research-depth to a number when provided', () => {
        // SETUP
        setArgv(['--research-depth', '3']);

        // EXECUTE
        const args = parseArgs();

        // VERIFY: string value is coerced & stored as number
        expect(args.researchDepth).toBe(3);
      });

      it('should coerce --research-depth=<n> form to a number', () => {
        // SETUP
        setArgv(['--research-depth=4']);

        // EXECUTE
        const args = parseArgs();

        // VERIFY: equals form also coerces
        expect(args.researchDepth).toBe(4);
      });

      it('should exit with code 1 when --research-depth is 0 (invalid)', () => {
        // SETUP: 0 is not a positive integer
        setArgv(['--research-depth', '0']);

        // EXECUTE & VERIFY: Should throw process.exit error
        expect(() => parseCLIArgs()).toThrow('process.exit(1)');
        expect(mockExit).toHaveBeenCalledWith(1);
      });

      it('should exit with code 1 when --research-depth is negative (invalid)', () => {
        // SETUP: negative is not a positive integer
        setArgv(['--research-depth', '-1']);

        // EXECUTE & VERIFY: Should throw process.exit error
        expect(() => parseCLIArgs()).toThrow('process.exit(1)');
        expect(mockExit).toHaveBeenCalledWith(1);
      });

      it('should exit with code 1 when --research-depth is non-numeric (invalid)', () => {
        // SETUP: non-numeric input
        setArgv(['--research-depth', 'abc']);

        // EXECUTE & VERIFY: Should throw process.exit error
        expect(() => parseCLIArgs()).toThrow('process.exit(1)');
        expect(mockExit).toHaveBeenCalledWith(1);
      });

      it('should parse -r and --research-depth together', () => {
        // SETUP
        setArgv(['-r', '--research-depth', '5']);

        // EXECUTE
        const args = parseArgs();

        // VERIFY: both flags parsed together
        expect(args.parallelResearch).toBe(true);
        expect(args.researchDepth).toBe(5);
      });
    });
  });

  describe('prd status alias (PRD §5.3)', () => {
    /**
     * Helper to set process.argv for testing (scoped to this block)
     */
    const setArgv = (args: string[] = []) => {
      process.argv = ['node', '/path/to/script.js', ...args];
    };

    // For these alias-routing tests we only assert the SYNCHRONOUS return value
    // of parseCLIArgs() (the detection-block normalization). The taskAction
    // handler still fires asynchronously after parseCLIArgs() returns and would
    // call process.exit(); override exit to a no-op so the async tail does not
    // produce an unhandled rejection. readFile is mocked to a valid backlog so
    // the handler's success path runs cleanly.
    let aliasExit: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockReadFileFn.mockResolvedValue(JSON.stringify({ backlog: [] }));
      aliasExit = vi.fn();
      process.exit = aliasExit as any;
    });

    it('should route "status" to the same subcommand as "task"', async () => {
      // The detection block normalizes 'status' → { subcommand: 'task' },
      // mirroring the existing 'task' branch exactly (PRD §5.3 alias).
      setArgv(['status']);
      const statusResult = parseCLIArgs();
      // Let the async taskAction tail finish while the no-op exit mock is active
      await new Promise(resolve => setImmediate(resolve));

      setArgv(['task']);
      const taskResult = parseCLIArgs();
      await new Promise(resolve => setImmediate(resolve));

      // Both invocations normalize to the 'task' subcommand → true alias parity
      expect(statusResult).toEqual({ subcommand: 'task', options: {} });
      expect(taskResult).toEqual({ subcommand: 'task', options: {} });
    });

    it('should normalize "status" to subcommand "task" in the detection block', async () => {
      // Drive the new args[0] === 'status' branch for 100% branch coverage.
      setArgv(['status']);
      const result = parseCLIArgs();
      await new Promise(resolve => setImmediate(resolve));
      expect(result).toEqual({ subcommand: 'task', options: {} });
    });

    it('should support the same actions as task (status next / status status)', async () => {
      // status next → normalized to task subcommand
      setArgv(['status', 'next']);
      expect(parseCLIArgs()).toEqual({ subcommand: 'task', options: {} });
      await new Promise(resolve => setImmediate(resolve));

      // status status → normalized to task subcommand
      setArgv(['status', 'status']);
      expect(parseCLIArgs()).toEqual({ subcommand: 'task', options: {} });
      await new Promise(resolve => setImmediate(resolve));
    });
  });
});
