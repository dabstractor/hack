/**
 * Unit tests for BUG_FINDER_AGENT config constant and reader helper
 *
 * @remarks
 * Tests validate getBugFinderAgent() from src/config/constants.ts. Mirrors
 * validation-config.test.ts's getValidationAgent describe structure verbatim
 * (beforeEach env reset, afterEach vi.unstubAllEnvs, the (a)..(f) case layout).
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BUG_FINDER_AGENT,
  DEFAULT_BUG_FINDER_AGENT,
  getBugFinderAgent,
} from '../../../src/config/constants.js';

describe('config/constants: getBugFinderAgent', () => {
  beforeEach(() => {
    delete process.env.BUG_FINDER_AGENT;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('(a) returns the default (pizr) when env var is unset', () => {
    // EXECUTE
    const result = getBugFinderAgent();

    // VERIFY
    expect(result).toBe(DEFAULT_BUG_FINDER_AGENT); // 'pizr'
  });

  it('(b) honors a stubbed custom agent', () => {
    // SETUP
    vi.stubEnv(BUG_FINDER_AGENT, 'custom-reasoner');

    // EXECUTE
    const result = getBugFinderAgent();

    // VERIFY
    expect(result).toBe('custom-reasoner');
  });

  it('(c) returns default when env var is empty', () => {
    // SETUP — empty string would silently break observability without the guard
    vi.stubEnv(BUG_FINDER_AGENT, '');

    // EXECUTE
    const result = getBugFinderAgent();

    // VERIFY
    expect(result).toBe(DEFAULT_BUG_FINDER_AGENT); // 'pizr'
  });

  it('(d) returns default when env var is whitespace-only', () => {
    // SETUP
    vi.stubEnv(BUG_FINDER_AGENT, '   ');

    // EXECUTE
    const result = getBugFinderAgent();

    // VERIFY
    expect(result).toBe(DEFAULT_BUG_FINDER_AGENT); // 'pizr'
  });

  it('(e) trims surrounding whitespace from a set value', () => {
    // SETUP
    vi.stubEnv(BUG_FINDER_AGENT, '  pizr  ');

    // EXECUTE
    const result = getBugFinderAgent();

    // VERIFY
    expect(result).toBe('pizr');
  });

  it('(f) returns pizr when explicitly set to pizr', () => {
    // SETUP
    vi.stubEnv(BUG_FINDER_AGENT, 'pizr');

    // EXECUTE
    const result = getBugFinderAgent();

    // VERIFY
    expect(result).toBe(DEFAULT_BUG_FINDER_AGENT); // 'pizr'
  });
});
