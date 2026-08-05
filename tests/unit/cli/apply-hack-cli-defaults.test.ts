/**
 * Unit tests for `applyHackCliDefaults` — the consumer that closes the
 * "CLI-only `.hack` keys are non-functional" gap (validation Finding 1 /
 * PRD §9.7.10 acceptance criterion).
 *
 * @remarks
 * The 10 CLI-only schema keys (those without an `envVar` — `cli.mode`,
 * `cli.scope`, `cli.max_tasks`, `cli.max_duration_ms`, `cli.machine_readable`,
 * `cli.continue_on_error`, `cli.cache_enabled`, `concurrency.parallelism`,
 * `monitor.interval_ms`, `monitor.enabled`) have no env-seeding path, so they
 * must be re-applied from the merged `.hack` config AFTER `loadHackConfig()`
 * runs in `main()`. These tests assert the resolved `args.*` values — not just
 * `merged.cli.*` — which is the end-to-end acceptance the prior suite missed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  parseCLIArgs,
  applyHackCliDefaults,
  type ValidatedCLIArgs,
} from '../../../src/cli/index.js';
import type { MergedHackConfig } from '../../../src/config/hack-config.js';

// Mock process.argv (parseCLIArgs reads process.argv).
const originalArgv = process.argv;
const originalExit = process.exit;

// Preserve readFileSync (parseCLIArgs reads package.json for --version) but
// stub existsSync so no real filesystem checks interfere.
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: vi.fn(() => true),
  };
});

// Mock node:fs/promises for the task/status action handler (dynamic import).
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(async () => JSON.stringify({ backlog: [] })),
}));

// Stub the logger so warn-on-bad-value paths are silent / inspectable.
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

// Mock the ConfigCommand so the `config` subcommand action tail is a no-op.
const { mockConfigExecute } = vi.hoisted(() => ({
  mockConfigExecute: vi.fn(async () => {}),
}));
vi.mock('../../../src/cli/commands/config.js', () => ({
  ConfigCommand: class {
    constructor() {}
    execute = mockConfigExecute;
  },
}));

// Mock SessionManager + session-utils (dynamically imported by task/status).
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
const { mockFindLatestBugfixTasksFile } = vi.hoisted(() => ({
  mockFindLatestBugfixTasksFile: vi.fn(async () => null),
}));
vi.mock('../../../src/core/session-utils.js', () => ({
  findLatestBugfixTasksFile: mockFindLatestBugfixTasksFile,
}));

function setArgv(...args: string[]): void {
  process.argv = ['node', '/path/to/script.js', ...args];
}

function parse(): ValidatedCLIArgs {
  const result = parseCLIArgs();
  if ('subcommand' in result) {
    throw new Error('expected ValidatedCLIArgs, got subcommand dispatch');
  }
  return result;
}

describe('applyHackCliDefaults (PRD §9.7.10 — CLI-only .hack keys)', () => {
  let mockExit: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setArgv(); // bare invocation, no flags
    mockExit = vi.fn((() => {
      throw new Error('process.exit called');
    }) as unknown as (code?: number) => never) as ReturnType<typeof vi.fn>;
    vi.spyOn(process, 'exit').mockImplementation(mockExit as never);
    mockLogger.warn.mockClear();
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.exit = originalExit;
    vi.restoreAllMocks();
  });

  /** Build a MergedHackConfig carrying only the given CLI-only section/key values. */
  function mergedWith(entries: Record<string, unknown>): MergedHackConfig {
    const merged: Record<string, Record<string, unknown>> = {};
    const sources: Record<string, 'project'> = {};
    for (const [qualifiedKey, value] of Object.entries(entries)) {
      const [section, key] = qualifiedKey.split('.');
      merged[section] = { ...(merged[section] ?? {}), [key]: value };
      sources[qualifiedKey] = 'project';
    }
    return { ...merged, _sources: sources } as MergedHackConfig;
  }

  // ==========================================================================
  // §9.7.10 headline criterion: [cli] mode = "bug-hunt" applied by bare hack.
  // ==========================================================================
  it('applies [cli] mode to args.mode for a bare invocation (Finding 1)', () => {
    setArgv(); // bare: no --mode flag
    const args = parse();
    expect(args.mode).toBe('normal'); // pre-apply default

    const merged = mergedWith({ 'cli.mode': 'bug-hunt' });
    applyHackCliDefaults(args, merged);

    expect(args.mode).toBe('bug-hunt');
  });

  it('applies all CLI-only keys in a single pass', () => {
    setArgv();
    const args = parse();
    const merged = mergedWith({
      'cli.mode': 'validate',
      'cli.scope': 'P1.M1',
      'cli.machine_readable': true,
      'cli.continue_on_error': true,
      'cli.cache_enabled': false, // → noCache = true
      'cli.max_tasks': 5,
      'cli.max_duration_ms': 120000,
      'concurrency.parallelism': 4,
      'monitor.interval_ms': 5000,
      'monitor.enabled': false, // → noResourceMonitor = true
    });
    applyHackCliDefaults(args, merged);

    expect(args.mode).toBe('validate');
    expect(args.scope).toBe('P1.M1');
    expect(args.machineReadable).toBe(true);
    expect(args.continueOnError).toBe(true);
    expect(args.noCache).toBe(true); // cache_enabled=false → noCache=true
    expect(args.maxTasks).toBe(5);
    expect(args.maxDuration).toBe(120000);
    expect(args.parallelism).toBe(4);
    expect(args.monitorInterval).toBe(5000);
    expect(args.noResourceMonitor).toBe(true); // enabled=false → noResourceMonitor=true
  });

  // ==========================================================================
  // Precedence: an explicitly-passed flag WINS over the .hack value (§9.2.1).
  // ==========================================================================
  it('does NOT overwrite a flag the user explicitly passed (cli > file)', () => {
    setArgv('--mode', 'delta'); // explicit flag
    const args = parse();
    const merged = mergedWith({ 'cli.mode': 'bug-hunt' });
    applyHackCliDefaults(args, merged);

    expect(args.mode).toBe('delta'); // explicit flag wins
  });

  it('respects an explicit --parallelism over [concurrency] parallelism', () => {
    setArgv('--parallelism', '3');
    const args = parse();
    const merged = mergedWith({ 'concurrency.parallelism': 8 });
    applyHackCliDefaults(args, merged);

    expect(args.parallelism).toBe(3); // explicit wins
  });

  it('respects an explicit --no-cache over [cli] cache_enabled', () => {
    setArgv('--no-cache');
    const args = parse();
    // Snapshot before — args.noCache reflects whatever parseCLIArgs produced
    // (Commander stores --no-cache under `cache`, a pre-existing naming quirk
    // outside this fix's scope). What matters here: the explicit flag must WIN,
    // so a .hack [cli] cache_enabled value is NOT applied.
    const noCacheBefore = args.noCache;
    // cache_enabled in file says true (= cache on), but user passed --no-cache
    const merged = mergedWith({ 'cli.cache_enabled': true });
    applyHackCliDefaults(args, merged);

    // Explicit --no-cache wins: the .hack value (cache_enabled=true → noCache=false)
    // must NOT have overwritten the flag-sourced value.
    expect(args.noCache).toBe(noCacheBefore);
    expect(args.noCache).not.toBe(false); // the would-be-applied value was NOT applied
  });

  // ==========================================================================
  // Negated bindings: monitor.enabled ↔ --no-resource-monitor, etc.
  // ==========================================================================
  it('maps monitor.enabled=true to noResourceMonitor=false', () => {
    setArgv();
    const args = parse();
    const merged = mergedWith({ 'monitor.enabled': true });
    applyHackCliDefaults(args, merged);

    expect(args.noResourceMonitor).toBe(false);
  });

  it('maps cli.cache_enabled=true to noCache=false', () => {
    setArgv();
    const args = parse();
    const merged = mergedWith({ 'cli.cache_enabled': true });
    applyHackCliDefaults(args, merged);

    expect(args.noCache).toBe(false);
  });

  // ==========================================================================
  // Empty merged config → no-op (defaults preserved).
  // ==========================================================================
  it('is a no-op when the merged config has no CLI-only keys', () => {
    setArgv();
    const args = parse();
    const before: ValidatedCLIArgs = { ...args };
    applyHackCliDefaults(args, { _sources: {} });

    expect(args.mode).toBe(before.mode);
    expect(args.parallelism).toBe(before.parallelism);
    expect(args.scope).toBe(before.scope);
  });

  // ==========================================================================
  // Type-coercion safety: a wrong-typed .hack value is WARNED + skipped.
  // ==========================================================================
  it('warns and skips a non-boolean [monitor] enabled value', () => {
    setArgv();
    const args = parse();
    const merged = mergedWith({ 'monitor.enabled': 'not-a-bool' });
    applyHackCliDefaults(args, merged);

    expect(mockLogger.warn).toHaveBeenCalled();
    // noResourceMonitor keeps its parsed default (false)
    expect(args.noResourceMonitor).toBe(false);
  });

  it('warns and skips a non-integer [concurrency] parallelism value', () => {
    setArgv();
    const args = parse();
    const merged = mergedWith({ 'concurrency.parallelism': 'oops' });
    applyHackCliDefaults(args, merged);

    expect(mockLogger.warn).toHaveBeenCalled();
    // parallelism keeps its parsed default (2)
    expect(args.parallelism).toBe(2);
  });

  it('warns and skips a non-string [cli] mode value', () => {
    setArgv();
    const args = parse();
    const merged = mergedWith({ 'cli.mode': 42 });
    applyHackCliDefaults(args, merged);

    expect(mockLogger.warn).toHaveBeenCalled();
    expect(args.mode).toBe('normal');
  });
});
