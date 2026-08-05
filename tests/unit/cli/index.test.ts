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
import { resolve, isAbsolute } from 'node:path';
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

// Mock the ConfigCommand so the `config` subcommand's async .action() tail is
// a no-op (no real config load / process.exit / env mutation) when the sentinel
// return path is exercised. Hoisted so it is wired before parseCLIArgs runs.
const { mockConfigExecute } = vi.hoisted(() => ({
  mockConfigExecute: vi.fn(async () => {}),
}));
vi.mock('../../../src/cli/commands/config.js', () => ({
  ConfigCommand: class {
    constructor() {}
    execute = mockConfigExecute;
  },
}));

// Mock SessionManager (dynamically imported by the task/status handler) so the
// breakdown-in-progress + no-sessions paths are deterministic. Hoisted so
// per-test override (mockFindLatestSession.mockResolvedValue(null), etc.) works.
const { mockFindLatestSession, mockListSessions } = vi.hoisted(() => ({
  mockFindLatestSession: vi.fn(),
  mockListSessions: vi.fn(),
}));
vi.mock('../../../src/core/session-manager.js', () => ({
  SessionManager: Object.assign(class {}, {
    findLatestSession: mockFindLatestSession,
    listSessions: mockListSessions,
  }),
}));

// Mock findLatestBugfixTasksFile (dynamically imported by the task/status
// handler). Defaults to null (no bugfix tasks.json → main-session fallback).
const { mockFindLatestBugfixTasksFile } = vi.hoisted(() => ({
  mockFindLatestBugfixTasksFile: vi.fn(async () => null),
}));
vi.mock('../../../src/core/session-utils.js', () => ({
  findLatestBugfixTasksFile: mockFindLatestBugfixTasksFile,
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

        // VERIFY: Custom PRD path is used (S2: explicit --prd pre-resolved against INVOCATION_CWD → absolute)
        expect(args.prd).toBe(resolve(process.cwd(), './custom/PRD.md'));
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

      it('should default --accept-prd-changes to false when absent', () => {
        // SETUP
        setArgv([]);

        // EXECUTE
        const args = parseArgs();

        // VERIFY: acceptPrdChanges defaults to false
        expect(args.acceptPrdChanges).toBe(false);
      });

      it('should parse --accept-prd-changes flag as true', () => {
        // SETUP
        setArgv(['--accept-prd-changes']);

        // EXECUTE
        const args = parseArgs();

        // VERIFY: acceptPrdChanges is true
        expect(args.acceptPrdChanges).toBe(true);
      });

      it('should carry --accept-prd-changes onto ValidatedCLIArgs', () => {
        // SETUP
        setArgv(['--accept-prd-changes']);

        // EXECUTE
        const args = parseArgs();

        // VERIFY: the flag survives validation as a boolean (PRD §4.3 —
        // --accept-prd-changes must flow through to PRPPipeline unchanged).
        expect(args.acceptPrdChanges).toBe(true);
        // parseArgs() already narrows via isCLIArgs(); the returned object is a
        // ValidatedCLIArgs, so acceptPrdChanges is present and typed.
        expect('acceptPrdChanges' in args).toBe(true);
      });

      it('should default --adopt-prd to false when absent', () => {
        // SETUP
        setArgv([]);

        // EXECUTE
        const args = parseArgs();

        // VERIFY: adoptPrd defaults to false
        expect(args.adoptPrd).toBe(false);
      });

      it('should parse --adopt-prd flag as true', () => {
        // SETUP
        setArgv(['--adopt-prd']);

        // EXECUTE
        const args = parseArgs();

        // VERIFY: adoptPrd is true
        expect(args.adoptPrd).toBe(true);
      });

      it('should carry --adopt-prd onto ValidatedCLIArgs', () => {
        // SETUP
        setArgv(['--adopt-prd']);

        // EXECUTE
        const args = parseArgs();

        // VERIFY: the flag survives validation as a boolean (PRD §4.6 —
        // --adopt-prd must flow through to PRPPipeline unchanged).
        expect(args.adoptPrd).toBe(true);
        // parseArgs() already narrows via isCLIArgs(); the returned object is a
        // ValidatedCLIArgs, so adoptPrd is present and typed.
        expect('adoptPrd' in args).toBe(true);
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

        // VERIFY: All options are parsed correctly (S2: explicit --prd pre-resolved → absolute)
        expect(args.prd).toBe(resolve(process.cwd(), './custom/PRD.md'));
        expect(args.scope).toBe('P1.M2.T3');
        expect(args.mode).toBe('bug-hunt');
        expect(args.continue).toBe(true);
        expect(args.dryRun).toBe(true);
        expect(args.verbose).toBe(true);
      });
    });

    describe('PRD path handling (no parse-time existence check)', () => {
      // S2 (P1.M1.T1.S2) moved the PRD existence check out of parseCLIArgs into main()
      // post-chdir (it ran pre-chdir and rejected the default './PRD.md' from a subdir).
      // parseCLIArgs now just passes --prd through (pre-resolving an EXPLICIT --prd against
      // INVOCATION_CWD). The post-chdir existence check is covered by the integration suite.

      it('does NOT call existsSync or exit for a missing PRD (check moved to main)', () => {
        // SETUP: File does not exist — but parseCLIArgs no longer checks.
        mockExistsSync.mockReturnValue(false);
        setArgv(['--prd', './missing.md']);

        // EXECUTE: passes through without exiting.
        const args = parseArgs();

        // VERIFY: process.exit NOT called; existsSync NOT consulted at parse time.
        expect(mockExit).not.toHaveBeenCalled();
        expect(mockExistsSync).not.toHaveBeenCalled();
        // Default --prd is left relative (resolved against repoRoot post-chdir).
        expect(args.prd).toBe(resolve(process.cwd(), './missing.md'));
      });

      it('pre-resolves an EXPLICIT --prd against INVOCATION_CWD (absolute)', () => {
        // SETUP: explicit --prd resolves against process.cwd() (=== INVOCATION_CWD at parse time).
        mockExistsSync.mockReturnValue(true);
        setArgv(['--prd', './custom/prd.md']);

        // EXECUTE
        const args = parseArgs();

        // VERIFY: --prd is absolute (INVOCATION_CWD-relative); survives the later chdir.
        expect(args.prd).toBe(resolve(process.cwd(), './custom/prd.md'));
        expect(require('node:path').isAbsolute(args.prd)).toBe(true);
      });

      it('leaves the DEFAULT ./PRD.md relative (resolved against repoRoot post-chdir)', () => {
        // SETUP: no --prd → default './PRD.md' (Commander supplies it).
        mockExistsSync.mockReturnValue(true);
        setArgv([]);

        // EXECUTE
        const args = parseArgs();

        // VERIFY: default stays relative (NOT pre-resolved) → resolves against repoRoot later.
        expect(args.prd).toBe('./PRD.md');
        expect(isAbsolute(args.prd)).toBe(false);
      });

      it('parses --repo-root and flows it through to ValidatedCLIArgs', () => {
        // SETUP: explicit --repo-root.
        mockExistsSync.mockReturnValue(true);
        setArgv(['--repo-root', '/some/repo']);

        // EXECUTE
        const args = parseArgs();

        // VERIFY: repoRoot flows through (undefined when omitted; the resolver consumes it in main).
        expect(args.repoRoot).toBe('/some/repo');
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

  describe('config subcommand sentinel (PRD §9.7.8)', () => {
    /** Helper to set process.argv for testing (scoped to this block). */
    const setArgv = (args: string[] = []) => {
      process.argv = ['node', '/path/to/script.js', ...args];
    };

    // The `config` .action() runs asynchronously after parseCLIArgs() returns and
    // calls process.exit(). ConfigCommand is mocked (top of file) to a no-op, and
    // process.exit is overridden to a no-op so the async tail resolves cleanly.
    // We assert the synchronous sentinel return of parseCLIArgs().
    let configExit: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockConfigExecute.mockClear();
      configExit = vi.fn();
      process.exit = configExit as any;
    });

    it('should return the config sentinel for `hack config show`', async () => {
      setArgv(['config', 'show']);
      const result = parseCLIArgs();
      // Let the mocked async action tail finish.
      await new Promise(resolve => setImmediate(resolve));

      expect(result).toEqual({
        subcommand: 'config',
        options: {
          output: 'table',
          force: false,
          src: false,
          global: false,
          local: false,
        },
      });
    });

    it('should default the action to `show` when only `hack config` is passed', async () => {
      setArgv(['config']);
      const result = parseCLIArgs();
      await new Promise(resolve => setImmediate(resolve));

      expect(result).toMatchObject({ subcommand: 'config' });
      // The mocked ConfigCommand.execute was invoked with the default 'show'.
      expect(mockConfigExecute).toHaveBeenCalled();
      expect(mockConfigExecute.mock.calls[0][0]).toBe('show');
    });
  });

  describe('breakdown-in-progress (PRD §5.3)', () => {
    /** Helper to set process.argv for testing (scoped to this block). */
    const setArgv = (args: string[] = []) => {
      process.argv = ['node', '/path/to/script.js', ...args];
    };

    // The taskAction handler runs asynchronously after parseCLIArgs() returns.
    // We use a NO-OP exit mock for ALL cases here (mirroring the 'prd status
    // alias' block): breakdown cases assert exit(0); hard-error cases assert
    // exit(1) (the catch block's process.exit(1) is captured, not thrown — so
    // no unhandled rejection leaks into a later test). The source's `return`
    // after process.exit(0) prevents fall-through to readFile.
    let bdExit: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      // Default discovery state: latest session exists, no bugfix tasks file,
      // tasks.json absent (breakdown in progress), session dir present.
      mockFindLatestSession.mockResolvedValue({
        path: '/plan/001_abc',
        id: '001_abc',
        hash: 'abc',
      });
      mockListSessions.mockResolvedValue([
        { path: '/plan/001_abc', id: '001_abc', hash: 'abc' },
      ]);
      mockFindLatestBugfixTasksFile.mockResolvedValue(null);
      // tasks.json absent; session dir (dirname) present.
      mockExistsSync.mockImplementation((p: string) =>
        p.endsWith('tasks.json') ? false : true
      );
      // Default: readFile returns a valid backlog (used by the normal-path case).
      mockReadFileFn.mockResolvedValue(JSON.stringify({ backlog: [] }));

      bdExit = vi.fn();
      process.exit = bdExit as any;
    });

    it('hack status (breakdown) → calm stderr notice, exit 0, no scary ERROR/ENOENT/stack on stdout', async () => {
      // SETUP — capture stderr (the notice channel) + stdout (must stay clean)
      const stderrSpy = vi
        .spyOn(process.stderr, 'write')
        .mockImplementation(() => true);
      const stdoutSpy = vi
        .spyOn(console, 'log')
        .mockImplementation(() => undefined);

      setArgv(['status']);
      parseCLIArgs();
      await new Promise(resolve => setImmediate(resolve));

      // VERIFY — exit 0 (the graceful breakdown path)
      expect(bdExit).toHaveBeenCalledWith(0);
      // VERIFY — the calm notice went to stderr, naming the session + breakdown
      const stderrText = stderrSpy.mock.calls.flat().join(' ');
      expect(stderrText).toContain('001_abc');
      expect(stderrText).toContain('breakdown');
      expect(stderrText).toContain(
        'tasks.json is generated during PRD breakdown'
      );
      // VERIFY — NO scary error/ENOENT/stack leaked to stdout
      const stdoutText = stdoutSpy.mock.calls.flat().join(' ');
      expect(stdoutText).not.toMatch(/ENOENT|ERROR|stack|Trace/);

      stderrSpy.mockRestore();
      stdoutSpy.mockRestore();
    });

    it('hack status --output json → { status: awaiting_breakdown, session } on stdout, exit 0', async () => {
      // SETUP — capture stdout (JSON channel)
      const stdoutSpy = vi
        .spyOn(console, 'log')
        .mockImplementation(() => undefined);

      setArgv(['status', '--output', 'json']);
      parseCLIArgs();
      await new Promise(resolve => setImmediate(resolve));

      // VERIFY — exit 0
      expect(bdExit).toHaveBeenCalledWith(0);
      // VERIFY — the exact JSON object (parsed, to allow pretty-print whitespace)
      expect(stdoutSpy).toHaveBeenCalled();
      const emitted = JSON.parse(stdoutSpy.mock.calls[0][0]);
      expect(emitted).toEqual({
        status: 'awaiting_breakdown',
        session: '001_abc',
      });

      stdoutSpy.mockRestore();
    });

    it('hack status --file /nonexistent/tasks.json → STILL a hard error (exit non-zero; not softened)', async () => {
      // SETUP — explicit --file override: the breakdown check is gated off
      // (!options.file is FALSE). readFile rejects ENOENT → catch → exit 1.
      // NO-OP exit captures the catch's exit(1) without throwing.
      mockReadFileFn.mockRejectedValue(
        Object.assign(
          new Error("ENOENT: no such file, open '/nonexistent/tasks.json'"),
          { code: 'ENOENT' }
        )
      );

      setArgv(['status', '--file', '/nonexistent/tasks.json']);
      parseCLIArgs();
      await new Promise(resolve => setImmediate(resolve));

      // VERIFY — hard error preserved (NOT softened): exit 1, not 0.
      expect(bdExit).toHaveBeenCalledWith(1);
      expect(bdExit).not.toHaveBeenCalledWith(0);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Task command failed')
      );
    });

    it('no sessions at all → STILL a hard error with "No sessions found" (distinct empty state)', async () => {
      // SETUP — findLatestSession returns null → throws ABOVE the breakdown
      // check → catch → exit 1.
      mockFindLatestSession.mockResolvedValue(null);

      setArgv(['status']);
      parseCLIArgs();
      await new Promise(resolve => setImmediate(resolve));

      // VERIFY — hard error, distinct from the breakdown state (exit 1, not 0)
      expect(bdExit).toHaveBeenCalledWith(1);
      expect(bdExit).not.toHaveBeenCalledWith(0);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('No sessions found')
      );
    });

    it('hack task (breakdown) → exit 0 with the list/status wording (not the "next" wording)', async () => {
      // SETUP
      const stderrSpy = vi
        .spyOn(process.stderr, 'write')
        .mockImplementation(() => true);

      setArgv(['task']);
      parseCLIArgs();
      await new Promise(resolve => setImmediate(resolve));

      // VERIFY — exit 0, list/status wording (not "no tasks available yet")
      expect(bdExit).toHaveBeenCalledWith(0);
      const stderrText = stderrSpy.mock.calls.flat().join(' ');
      expect(stderrText).toContain(
        'tasks.json is generated during PRD breakdown'
      );
      expect(stderrText).not.toContain('no tasks available yet');

      stderrSpy.mockRestore();
    });

    it('hack task next (breakdown) → exit 0 with the "next" wording variant', async () => {
      // SETUP — drive the action === 'next' wording branch
      const stderrSpy = vi
        .spyOn(process.stderr, 'write')
        .mockImplementation(() => true);

      setArgv(['task', 'next']);
      parseCLIArgs();
      await new Promise(resolve => setImmediate(resolve));

      // VERIFY — exit 0, the "next"-specific wording
      expect(bdExit).toHaveBeenCalledWith(0);
      const stderrText = stderrSpy.mock.calls.flat().join(' ');
      expect(stderrText).toContain(
        'no tasks available yet (breakdown in progress)'
      );

      stderrSpy.mockRestore();
    });

    it('(coverage) normal path: tasks.json EXISTS → breakdown check skipped → readFile → handler completes', async () => {
      // SETUP — tasks.json PRESENT → the breakdown check's existsSync(tasksFile)
      // returns true → the `!existsSync(tasksFile)` branch is FALSE → normal
      // path runs (sourceNote prints, readFile returns the backlog, the action
      // branch emits and the handler returns without exit).
      mockExistsSync.mockReturnValue(true); // tasks.json exists → skip breakdown
      mockReadFileFn.mockResolvedValue(JSON.stringify({ backlog: [] }));
      const stdoutSpy = vi
        .spyOn(console, 'log')
        .mockImplementation(() => undefined);

      setArgv(['status']);
      parseCLIArgs();
      await new Promise(resolve => setImmediate(resolve));

      // VERIFY — breakdown check was skipped: readFile WAS called (the normal
      // read path was reached, not the breakdown early-exit), and the normal
      // status output was emitted (NOT the breakdown JSON object). The normal
      // path also calls exit(0) at the end of taskAction — that's expected;
      // the key distinction is readFile was reached + no awaiting_breakdown.
      expect(mockReadFileFn).toHaveBeenCalled();
      const stdoutText = stdoutSpy.mock.calls.flat().join(' ');
      expect(stdoutText).not.toContain('awaiting_breakdown');

      stdoutSpy.mockRestore();
    });
  });
});
