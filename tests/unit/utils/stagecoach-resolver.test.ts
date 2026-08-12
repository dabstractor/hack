/**
 * Hermetic unit tests for the stagecoach binary resolver (PRD §9.10.1).
 *
 * @remarks
 * Mocks `node:module` (controls `nodeRequire.resolve`) and `node:fs` (controls
 * `existsSync`/`readFileSync`) so the suite is independent of whether
 * stagecoach-ai is actually installed or the native binary is on disk. This is
 * what makes every branch (dep-ok / dep-missing / binary-ok / binary-missing +
 * STAGECOACH_CACHE_DIR override + the platform/arch mappings) deterministically
 * coverable for 100% coverage.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

// vi.hoisted lets the mock factory reference a STABLE require-object + resolve spy that
// the resolver captures once at import time. Per-test re-config of mockResolve then
// actually affects the resolver's captured nodeRequire (mutating the same object).
const { mockRequire, mockResolve } = vi.hoisted(() => {
  const mockResolve = vi.fn((id: string) => `/fake/node_modules/${id}`);
  return { mockRequire: { resolve: mockResolve }, mockResolve };
});

vi.mock('node:module', () => ({
  // createRequire returns the SAME stable object every call → the resolver's
  // `const nodeRequire = createRequire(...)` captures it at import.
  createRequire: vi.fn(() => mockRequire),
}));
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

import {
  platformArch,
  resolveStagecoachBinary,
} from '../../../src/utils/stagecoach-resolver.js';
import { AgentError } from '../../../src/utils/errors.js';

const mockExists = existsSync as unknown as ReturnType<typeof vi.fn>;
const mockRead = readFileSync as unknown as ReturnType<typeof vi.fn>;

// Default platform/arch (restored after every test that overrides them).
const ORIG_PLATFORM = process.platform;
const ORIG_ARCH = process.arch;

function setPlatformArch(platform: string, arch: string): void {
  Object.defineProperty(process, 'platform', {
    value: platform,
    configurable: true,
  });
  Object.defineProperty(process, 'arch', { value: arch, configurable: true });
}

describe('utils/stagecoach-resolver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default happy-path: resolve points at /fake/node_modules/<id>; package.json reads
    // as 0.1.16; the binary is on disk. (mockRequire.resolve IS mockResolve — stable object.)
    mockResolve.mockImplementation((id: string) => `/fake/node_modules/${id}`);
    mockRead.mockReturnValue('{"version":"0.1.16"}');
    mockExists.mockReturnValue(true);
    setPlatformArch('linux', 'x64');
    delete process.env.STAGECOACH_CACHE_DIR;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    setPlatformArch(ORIG_PLATFORM, ORIG_ARCH);
  });

  describe('platformArch', () => {
    it('maps linux+x64 → {linux, amd64, stagecoach}', () => {
      setPlatformArch('linux', 'x64');
      expect(platformArch()).toEqual({
        goos: 'linux',
        goarch: 'amd64',
        binaryName: 'stagecoach',
      });
    });

    it('maps darwin+arm64 → {darwin, arm64, stagecoach}', () => {
      setPlatformArch('darwin', 'arm64');
      expect(platformArch()).toEqual({
        goos: 'darwin',
        goarch: 'arm64',
        binaryName: 'stagecoach',
      });
    });

    it('maps win32+x64 → {windows, amd64, stagecoach.exe}', () => {
      setPlatformArch('win32', 'x64');
      expect(platformArch()).toEqual({
        goos: 'windows',
        goarch: 'amd64',
        binaryName: 'stagecoach.exe',
      });
    });
  });

  describe('resolveStagecoachBinary — happy path', () => {
    it('returns the versioned per-platform cache path (mirrors bin/stagecoach.js)', () => {
      const p = resolveStagecoachBinary();
      expect(p).toContain('.stagecoach/versions/0.1.16/');
      expect(p).toMatch(/(linux|darwin|windows)-(amd64|arm64)/);
      expect(p).toMatch(/stagecoach(\.exe)?$/);
    });

    it('reads the version from stagecoach-ai/package.json', () => {
      mockRead.mockReturnValue('{"version":"9.9.9"}');
      expect(resolveStagecoachBinary()).toContain(
        '.stagecoach/versions/9.9.9/'
      );
    });
  });

  describe('resolveStagecoachBinary — STAGECOACH_CACHE_DIR override', () => {
    it('honors STAGECOACH_CACHE_DIR as the cache root', () => {
      vi.stubEnv('STAGECOACH_CACHE_DIR', '/tmp/sc-cache');
      const p = resolveStagecoachBinary();
      expect(p).toContain('/tmp/sc-cache/');
      expect(p).not.toContain('.stagecoach');
    });
  });

  describe('resolveStagecoachBinary — missing binary (fail-fast)', () => {
    it('throws AgentError naming the path + npm install + §9.10.1', () => {
      mockExists.mockReturnValue(false);
      expect(() => resolveStagecoachBinary()).toThrow(AgentError);
      expect(() => resolveStagecoachBinary()).toThrow(
        /native binary not found/
      );
      expect(() => resolveStagecoachBinary()).toThrow(/npm install/);
      expect(() => resolveStagecoachBinary()).toThrow(/§9.10.1/);
    });
  });

  describe('resolveStagecoachBinary — missing dep (fail-fast)', () => {
    it('throws AgentError when stagecoach-ai/package.json cannot be resolved', () => {
      // nodeRequire.resolve throws MODULE_NOT_FOUND → resolver catches → AgentError.
      mockResolve.mockImplementation(() => {
        throw new Error('MODULE_NOT_FOUND');
      });
      expect(() => resolveStagecoachBinary()).toThrow(AgentError);
      expect(() => resolveStagecoachBinary()).toThrow(
        /stagecoach-ai dependency not installed/
      );
      expect(() => resolveStagecoachBinary()).toThrow(/npm install/);
    });
  });
});
