/**
 * Unit tests for RESEARCH_TIMEOUT config constants and reader helper
 *
 * @remarks
 * Tests validate the getResearchTimeoutSeconds() function from src/config/constants.ts.
 * Covers all 6 contract cases:
 * - (a) Returns DEFAULT (300) when env var is unset
 * - (b) Honors a stubbed positive integer (120)
 * - (c) Returns DEFAULT when stubbed with NaN ('abc')
 * - (d) Returns DEFAULT when stubbed with zero ('0')
 * - (e) Returns DEFAULT when stubbed with negative ('-5')
 * - (f) Returns a stubbed integer value (150)
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_RESEARCH_TIMEOUT_SECONDS,
  RESEARCH_TIMEOUT,
  getResearchTimeoutSeconds,
} from '../../../src/config/constants.js';

describe('config/constants: getResearchTimeoutSeconds', () => {
  beforeEach(() => {
    delete process.env.RESEARCH_TIMEOUT;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('(a) returns the default (300) when env var is unset', () => {
    // SETUP — env var already deleted in beforeEach

    // EXECUTE
    const result = getResearchTimeoutSeconds();

    // VERIFY
    expect(result).toBe(DEFAULT_RESEARCH_TIMEOUT_SECONDS); // 300
  });

  it('(b) honors a stubbed positive integer', () => {
    // SETUP
    vi.stubEnv(RESEARCH_TIMEOUT, '120');

    // EXECUTE
    const result = getResearchTimeoutSeconds();

    // VERIFY
    expect(result).toBe(120);
  });

  it('(c) returns default when env var is NaN', () => {
    // SETUP
    vi.stubEnv(RESEARCH_TIMEOUT, 'abc');

    // EXECUTE
    const result = getResearchTimeoutSeconds();

    // VERIFY
    expect(result).toBe(DEFAULT_RESEARCH_TIMEOUT_SECONDS); // 300
  });

  it('(d) returns default when env var is zero', () => {
    // SETUP
    vi.stubEnv(RESEARCH_TIMEOUT, '0');

    // EXECUTE
    const result = getResearchTimeoutSeconds();

    // VERIFY
    expect(result).toBe(DEFAULT_RESEARCH_TIMEOUT_SECONDS); // 300
  });

  it('(e) returns default when env var is negative', () => {
    // SETUP
    vi.stubEnv(RESEARCH_TIMEOUT, '-5');

    // EXECUTE
    const result = getResearchTimeoutSeconds();

    // VERIFY
    expect(result).toBe(DEFAULT_RESEARCH_TIMEOUT_SECONDS); // 300
  });

  it('(f) returns a stubbed integer value', () => {
    // SETUP
    vi.stubEnv(RESEARCH_TIMEOUT, '150');

    // EXECUTE
    const result = getResearchTimeoutSeconds();

    // VERIFY
    expect(result).toBe(150);
  });
});
