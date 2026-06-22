/**
 * Unit tests for ISSUE_RETRY_MAX config constants and reader helper
 *
 * @remarks
 * Tests validate the getIssueRetryMax() function from src/config/constants.ts.
 * Covers all 6 contract cases:
 * - (a) Returns DEFAULT (3) when env var is unset
 * - (b) Honors a stubbed positive integer (5)
 * - (c) Returns DEFAULT when stubbed with NaN ('abc')
 * - (d) Returns DEFAULT when stubbed with zero ('0')
 * - (e) Returns DEFAULT when stubbed with negative ('-5')
 * - (f) Returns a stubbed integer value (7)
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_ISSUE_RETRY_MAX,
  ISSUE_RETRY_MAX,
  getIssueRetryMax,
} from '../../../src/config/constants.js';

describe('config/constants: getIssueRetryMax', () => {
  beforeEach(() => {
    delete process.env.ISSUE_RETRY_MAX;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('(a) returns the default (3) when env var is unset', () => {
    // SETUP — env var already deleted in beforeEach

    // EXECUTE
    const result = getIssueRetryMax();

    // VERIFY
    expect(result).toBe(DEFAULT_ISSUE_RETRY_MAX); // 3
  });

  it('(b) honors a stubbed positive integer', () => {
    // SETUP
    vi.stubEnv(ISSUE_RETRY_MAX, '5');

    // EXECUTE
    const result = getIssueRetryMax();

    // VERIFY
    expect(result).toBe(5);
  });

  it('(c) returns default when env var is NaN', () => {
    // SETUP
    vi.stubEnv(ISSUE_RETRY_MAX, 'abc');

    // EXECUTE
    const result = getIssueRetryMax();

    // VERIFY
    expect(result).toBe(DEFAULT_ISSUE_RETRY_MAX); // 3
  });

  it('(d) returns default when env var is zero', () => {
    // SETUP
    vi.stubEnv(ISSUE_RETRY_MAX, '0');

    // EXECUTE
    const result = getIssueRetryMax();

    // VERIFY
    expect(result).toBe(DEFAULT_ISSUE_RETRY_MAX); // 3
  });

  it('(e) returns default when env var is negative', () => {
    // SETUP
    vi.stubEnv(ISSUE_RETRY_MAX, '-5');

    // EXECUTE
    const result = getIssueRetryMax();

    // VERIFY
    expect(result).toBe(DEFAULT_ISSUE_RETRY_MAX); // 3
  });

  it('(f) returns a stubbed integer value', () => {
    // SETUP
    vi.stubEnv(ISSUE_RETRY_MAX, '7');

    // EXECUTE
    const result = getIssueRetryMax();

    // VERIFY
    expect(result).toBe(7);
  });
});
