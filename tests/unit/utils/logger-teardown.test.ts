/**
 * Teardown validation suite for logger (REQ-L3)
 *
 * @remarks
 * Authoritative tests that prove:
 * A. Single root logger → only ONE destination stream is built per output mode,
 *    regardless of how many loggers are requested (vi.mock('pino-pretty') call counter).
 * B. No worker threads / no ThreadStream on construction (process.listenerCount delta = 0).
 * C. Fast CLI exit (< 2s) for --help, -h, --version, and invalid flags.
 *
 * The worker_threads.Worker spy is deliberately NOT used — it is inoperative in this
 * vitest/forks setup (configurable:false + ESM-locked). See verified_facts.md §3.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// ===== vi.mock('pino-pretty') — must be hoisted above the import =====
// Per-file isolated: does NOT affect tests/unit/logger.test.ts.

let prettyCalls = 0;

vi.mock('pino-pretty', async importOriginal => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const real = (orig as any).default ?? orig;
  const factory = (...args: unknown[]) => {
    prettyCalls++;
    // Delegate to the real factory so logger output still works.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (real as any)(...args);
  };
  return { ...orig, default: factory };
});

import { getLogger, clearLoggerCache } from '../../../src/utils/logger.js';

// =============================================================================
// A. REQ-L3 — Single root logger (one destination per output mode)
// =============================================================================

describe('REQ-L3 — Single root logger (one destination per output mode)', () => {
  beforeEach(() => {
    clearLoggerCache();
    prettyCalls = 0;
  });

  it('pretty mode builds the destination exactly once across ≥4 distinct loggers', () => {
    getLogger('ComponentA');
    getLogger('ComponentB');
    getLogger('ComponentC');
    getLogger('ComponentD', { verbose: true });
    getLogger('ComponentE', { level: 'warn' as never });
    expect(prettyCalls).toBe(1);
  });

  it('JSON mode never calls the pretty factory', () => {
    prettyCalls = 0;
    getLogger('JsonA', { machineReadable: true });
    getLogger('JsonB', { machineReadable: true });
    getLogger('JsonC', { machineReadable: true, verbose: true });
    expect(prettyCalls).toBe(0);
  });

  it('child loggers reuse the same destination (no additional pretty calls)', () => {
    const parent = getLogger('ParentCtx');
    const child1 = parent.child({ taskId: 'T1' });
    const child2 = child1.child({ subtaskId: 'S1' });

    // All three must be functional
    expect(() => parent.info('parent msg')).not.toThrow();
    expect(() => child1.info('child1 msg')).not.toThrow();
    expect(() => child2.info('child2 msg')).not.toThrow();

    // pretty() was called exactly once (for the shared root)
    expect(prettyCalls).toBe(1);
  });
});

// =============================================================================
// B. REQ-L3 — No worker thread / no ThreadStream on construction
// =============================================================================

describe('REQ-L3 — No worker thread / no ThreadStream on construction', () => {
  beforeEach(() => {
    clearLoggerCache();
  });

  it('getLogger adds zero exit/beforeExit listeners (pretty + JSON + verbose)', () => {
    const beforeExit = process.listenerCount('exit');
    const beforeBE = process.listenerCount('beforeExit');

    clearLoggerCache();
    getLogger('PrettyA');
    getLogger('JsonA', { machineReadable: true });
    getLogger('VerboseA', { verbose: true });

    expect(process.listenerCount('exit') - beforeExit).toBe(0);
    expect(process.listenerCount('beforeExit') - beforeBE).toBe(0);
  });

  it('no transport-exit handler registered via process.on', () => {
    const onSpy = vi.spyOn(process, 'on');
    try {
      clearLoggerCache();
      const beforeCalls = onSpy.mock.calls.length;

      getLogger('SpyPretty');
      getLogger('SpyJson', { machineReadable: true });
      getLogger('SpyVerbose', { verbose: true });

      const newCalls = onSpy.mock.calls.slice(beforeCalls);
      const exitCalls = newCalls.filter(call => call[0] === 'exit');
      const beCalls = newCalls.filter(call => call[0] === 'beforeExit');
      const sigintCalls = newCalls.filter(call => call[0] === 'SIGINT');

      expect(exitCalls).toHaveLength(0);
      expect(beCalls).toHaveLength(0);
      expect(sigintCalls).toHaveLength(0);
    } finally {
      onSpy.mockRestore();
    }
  });
});

// =============================================================================
// C. Teardown — fast CLI exit (< 2s)
// =============================================================================

const CLI = resolve(process.cwd(), 'dist/index.js');
const TWO_SECONDS_MS = 2000;
const hasBuild = existsSync(CLI);

function runCli(args: string[]) {
  const start = Date.now();
  const res = spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    timeout: 10_000, // hard kill long before the old ~10s stall could ever mask a pass
    env: { ...process.env }, // --help exits in parseCLIArgs() before any endpoint/env work
  });
  return { ms: Date.now() - start, status: res.status, stdout: res.stdout };
}

// describeOrSkip so `npm run validate` without a build stays green;
// the PRP Level-4 gate builds first so these actually run.
const describeOrSkip = hasBuild ? describe : describe.skip;

describeOrSkip('Teardown — fast CLI exit (< 2s)', () => {
  it('--help exits in < 2s with status 0', () => {
    const { ms, status, stdout } = runCli(['--help']);
    expect(ms).toBeLessThan(TWO_SECONDS_MS);
    expect(status).toBe(0);
    expect(stdout).toContain('Usage');
  });

  it('-h exits in < 2s with status 0', () => {
    const { ms, status, stdout } = runCli(['-h']);
    expect(ms).toBeLessThan(TWO_SECONDS_MS);
    expect(status).toBe(0);
    expect(stdout).toContain('Usage');
  });

  it('--version exits in < 2s with status 0', () => {
    const { ms, status } = runCli(['--version']);
    expect(ms).toBeLessThan(TWO_SECONDS_MS);
    expect(status).toBe(0);
  });

  it('invalid flag exits in < 2s with non-zero status', () => {
    const { ms, status } = runCli(['--no-such-flag']);
    expect(ms).toBeLessThan(TWO_SECONDS_MS);
    expect(status).not.toBe(0);
  });
});
