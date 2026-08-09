/**
 * Unit tests for `setLogDestination` (BUG-2: keep stdout clean under `-o json`).
 *
 * @remarks
 * BUG-2 root cause: the per-command `-o json` output flag is independent of the
 * global `--machine-readable` logger flag, so structured pino logs (e.g. the
 * `tasks.json written successfully` INFO line from `writeTasksJSON`) land on
 * stdout and corrupt the machine-readable payload. `setLogDestination(stderr)`
 * routes every logger off stdout so `hack update … -o json | jq .` stays clean.
 *
 * These tests prove the routing at the logger layer:
 *  - JSON mode writes synchronously to the override stream.
 *  - Pretty mode hands the override to pino-pretty as its `destination`.
 *  - The default (no override) is byte-identical to the pre-fix behavior.
 *  - `clearLoggerCache()` resets the override (test isolation).
 *
 * The CLI wiring (`updateAction` calls `setLogDestination(process.stderr)`
 * under `-o json`) is asserted in the `update` unit + integration suites.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Writable } from 'node:stream';

// Capture the options handed to the pino-pretty factory (pretty-path routing).
let lastPrettyOpts: Record<string, unknown> | undefined;
vi.mock('pino-pretty', async importOriginal => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const real = (orig as any).default ?? orig;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const factory = (opts?: any) => {
    lastPrettyOpts = opts ?? {};
    return real(opts);
  };
  return { ...orig, default: factory };
});

import {
  getLogger,
  setLogDestination,
  clearLoggerCache,
} from '../../../src/utils/logger.js';

/** A real Node Writable that records everything written to it synchronously. */
function recordingStream(): {
  stream: NodeJS.WritableStream;
  chunks: string[];
} {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer | string, _enc, cb) {
      chunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
      cb();
    },
  });
  return { stream: stream as unknown as NodeJS.WritableStream, chunks };
}

describe('setLogDestination (BUG-2 — route logs off stdout under -o json)', () => {
  beforeEach(() => {
    clearLoggerCache();
    lastPrettyOpts = undefined;
  });
  afterEach(() => clearLoggerCache());

  it('JSON mode writes log lines to the override destination (synchronous)', () => {
    const { stream, chunks } = recordingStream();
    setLogDestination(stream);

    getLogger('Bug2', { machineReadable: true }).info(
      { marker: 'sentinel' },
      'routed log line'
    );

    const combined = chunks.join('');
    expect(combined).toContain('routed log line');
    expect(combined).toContain('sentinel');
    expect(combined).toContain('"context":"Bug2"');
  });

  it('pretty mode hands the override to pino-pretty as its destination', () => {
    const { stream } = recordingStream();
    setLogDestination(stream);

    getLogger('Bug2Pretty'); // builds the pretty root against the override

    expect(lastPrettyOpts).toBeDefined();
    expect(lastPrettyOpts!.destination).toBe(stream);
  });

  it('default (no override) leaves pino-pretty on its stdout default', () => {
    getLogger('Default'); // builds the pretty root with NO override

    expect(lastPrettyOpts).toBeDefined();
    // No destination key → pino-pretty defaults to stdout (pre-fix behavior).
    expect(lastPrettyOpts!.destination).toBeUndefined();
  });

  it('clearLoggerCache() resets to the default destination', () => {
    const { stream, chunks } = recordingStream();
    setLogDestination(stream);
    clearLoggerCache();

    // After reset, a fresh JSON logger must NOT write to the old recorder.
    getLogger('Reset', { machineReadable: true }).info('no leak');
    expect(chunks).toHaveLength(0);

    // A fresh pretty build after reset also has no destination override.
    lastPrettyOpts = undefined;
    getLogger('ResetPretty');
    expect(lastPrettyOpts!.destination).toBeUndefined();
  });

  it('switching destinations rebuilds the root against the new stream', () => {
    const a = recordingStream();
    setLogDestination(a.stream);
    getLogger('First', { machineReadable: true }).info('to first recorder');
    expect(a.chunks.join('')).toContain('to first recorder');

    const b = recordingStream();
    setLogDestination(b.stream);
    getLogger('Second', { machineReadable: true }).info('to second recorder');
    expect(b.chunks.join('')).toContain('to second recorder');
    // The first recorder must not receive the second log line.
    expect(a.chunks.join('')).not.toContain('to second recorder');
  });
});
