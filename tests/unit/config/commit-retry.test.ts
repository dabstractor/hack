/**
 * Unit tests for COMMIT_RETRY_* config constants and reader helpers
 *
 * @remarks
 * Tests validate the getCommitRetryMax(), getCommitRetryDelayMs(), and
 * getCommitRetryDelayCapMs() functions from src/config/constants.ts
 * (PRD §5.1 "Smart Commit Resilience"). Each reader covers all 6 contract
 * cases mirroring tests/unit/config/issue-retry-max.test.ts:
 * - (a) Returns DEFAULT when env var is unset
 * - (b) Honors a stubbed positive integer
 * - (c) Returns DEFAULT when stubbed with NaN ('abc')
 * - (d) Returns DEFAULT when stubbed with zero ('0')
 * - (e) Returns DEFAULT when stubbed with negative ('-5')
 * - (f) Returns a stubbed integer value
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COMMIT_RETRY_MAX,
  DEFAULT_COMMIT_RETRY_MAX,
  getCommitRetryMax,
  COMMIT_RETRY_DELAY,
  DEFAULT_COMMIT_RETRY_DELAY_MS,
  getCommitRetryDelayMs,
  COMMIT_RETRY_DELAY_CAP,
  DEFAULT_COMMIT_RETRY_DELAY_CAP_MS,
  getCommitRetryDelayCapMs,
} from '../../../src/config/constants.js';

describe('config/constants: getCommitRetryMax', () => {
  beforeEach(() => {
    delete process.env.COMMIT_RETRY_MAX;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('(a) returns the default (5) when env var is unset', () => {
    // SETUP — env var already deleted in beforeEach

    // EXECUTE
    const result = getCommitRetryMax();

    // VERIFY
    expect(result).toBe(DEFAULT_COMMIT_RETRY_MAX); // 5
  });

  it('(b) honors a stubbed positive integer', () => {
    // SETUP
    vi.stubEnv(COMMIT_RETRY_MAX, '8');

    // EXECUTE
    const result = getCommitRetryMax();

    // VERIFY
    expect(result).toBe(8);
  });

  it('(c) returns default when env var is NaN', () => {
    // SETUP
    vi.stubEnv(COMMIT_RETRY_MAX, 'abc');

    // EXECUTE
    const result = getCommitRetryMax();

    // VERIFY
    expect(result).toBe(DEFAULT_COMMIT_RETRY_MAX); // 5
  });

  it('(d) returns default when env var is zero', () => {
    // SETUP
    vi.stubEnv(COMMIT_RETRY_MAX, '0');

    // EXECUTE
    const result = getCommitRetryMax();

    // VERIFY
    expect(result).toBe(DEFAULT_COMMIT_RETRY_MAX); // 5
  });

  it('(e) returns default when env var is negative', () => {
    // SETUP
    vi.stubEnv(COMMIT_RETRY_MAX, '-3');

    // EXECUTE
    const result = getCommitRetryMax();

    // VERIFY
    expect(result).toBe(DEFAULT_COMMIT_RETRY_MAX); // 5
  });

  it('(f) returns a stubbed integer value', () => {
    // SETUP
    vi.stubEnv(COMMIT_RETRY_MAX, '7');

    // EXECUTE
    const result = getCommitRetryMax();

    // VERIFY
    expect(result).toBe(7);
  });
});

describe('config/constants: getCommitRetryDelayMs', () => {
  beforeEach(() => {
    delete process.env.COMMIT_RETRY_DELAY;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('(a) returns the default (10000) when env var is unset', () => {
    // SETUP — env var already deleted in beforeEach

    // EXECUTE
    const result = getCommitRetryDelayMs();

    // VERIFY
    expect(result).toBe(DEFAULT_COMMIT_RETRY_DELAY_MS); // 10000
  });

  it('(b) honors a stubbed positive integer', () => {
    // SETUP
    vi.stubEnv(COMMIT_RETRY_DELAY, '5000');

    // EXECUTE
    const result = getCommitRetryDelayMs();

    // VERIFY
    expect(result).toBe(5000);
  });

  it('(c) returns default when env var is NaN', () => {
    // SETUP
    vi.stubEnv(COMMIT_RETRY_DELAY, 'abc');

    // EXECUTE
    const result = getCommitRetryDelayMs();

    // VERIFY
    expect(result).toBe(DEFAULT_COMMIT_RETRY_DELAY_MS); // 10000
  });

  it('(d) returns default when env var is zero', () => {
    // SETUP
    vi.stubEnv(COMMIT_RETRY_DELAY, '0');

    // EXECUTE
    const result = getCommitRetryDelayMs();

    // VERIFY
    expect(result).toBe(DEFAULT_COMMIT_RETRY_DELAY_MS); // 10000
  });

  it('(e) returns default when env var is negative', () => {
    // SETUP
    vi.stubEnv(COMMIT_RETRY_DELAY, '-1000');

    // EXECUTE
    const result = getCommitRetryDelayMs();

    // VERIFY
    expect(result).toBe(DEFAULT_COMMIT_RETRY_DELAY_MS); // 10000
  });

  it('(f) returns a stubbed integer value', () => {
    // SETUP
    vi.stubEnv(COMMIT_RETRY_DELAY, '20000');

    // EXECUTE
    const result = getCommitRetryDelayMs();

    // VERIFY
    expect(result).toBe(20000);
  });
});

describe('config/constants: getCommitRetryDelayCapMs', () => {
  beforeEach(() => {
    delete process.env.COMMIT_RETRY_DELAY_CAP;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('(a) returns the default (120000) when env var is unset', () => {
    // SETUP — env var already deleted in beforeEach

    // EXECUTE
    const result = getCommitRetryDelayCapMs();

    // VERIFY
    expect(result).toBe(DEFAULT_COMMIT_RETRY_DELAY_CAP_MS); // 120000
  });

  it('(b) honors a stubbed positive integer', () => {
    // SETUP
    vi.stubEnv(COMMIT_RETRY_DELAY_CAP, '60000');

    // EXECUTE
    const result = getCommitRetryDelayCapMs();

    // VERIFY
    expect(result).toBe(60000);
  });

  it('(c) returns default when env var is NaN', () => {
    // SETUP
    vi.stubEnv(COMMIT_RETRY_DELAY_CAP, 'abc');

    // EXECUTE
    const result = getCommitRetryDelayCapMs();

    // VERIFY
    expect(result).toBe(DEFAULT_COMMIT_RETRY_DELAY_CAP_MS); // 120000
  });

  it('(d) returns default when env var is zero', () => {
    // SETUP
    vi.stubEnv(COMMIT_RETRY_DELAY_CAP, '0');

    // EXECUTE
    const result = getCommitRetryDelayCapMs();

    // VERIFY
    expect(result).toBe(DEFAULT_COMMIT_RETRY_DELAY_CAP_MS); // 120000
  });

  it('(e) returns default when env var is negative', () => {
    // SETUP
    vi.stubEnv(COMMIT_RETRY_DELAY_CAP, '-5000');

    // EXECUTE
    const result = getCommitRetryDelayCapMs();

    // VERIFY
    expect(result).toBe(DEFAULT_COMMIT_RETRY_DELAY_CAP_MS); // 120000
  });

  it('(f) returns a stubbed integer value', () => {
    // SETUP
    vi.stubEnv(COMMIT_RETRY_DELAY_CAP, '240000');

    // EXECUTE
    const result = getCommitRetryDelayCapMs();

    // VERIFY
    expect(result).toBe(240000);
  });
});
