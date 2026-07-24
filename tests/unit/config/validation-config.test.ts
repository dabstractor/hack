/**
 * Unit tests for VALIDATION_AGENT / VALIDATION_TIMEOUT config constants and reader helpers
 *
 * @remarks
 * Tests validate getValidationAgent() and getValidationTimeoutSeconds() from
 * src/config/constants.ts. Mirrors research-timeout.test.ts structure verbatim (beforeEach
 * env reset, afterEach vi.unstubAllEnvs, the (a)..(g) case layout).
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_VALIDATION_AGENT,
  DEFAULT_VALIDATION_TIMEOUT_SECONDS,
  VALIDATION_AGENT,
  VALIDATION_TIMEOUT,
  getValidationAgent,
  getValidationTimeoutSeconds,
} from '../../../src/config/constants.js';

describe('config/constants: getValidationTimeoutSeconds', () => {
  beforeEach(() => {
    delete process.env.VALIDATION_TIMEOUT;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('(a) returns the default (7200) when env var is unset', () => {
    // EXECUTE
    const result = getValidationTimeoutSeconds();

    // VERIFY
    expect(result).toBe(DEFAULT_VALIDATION_TIMEOUT_SECONDS); // 7200
  });

  it('(b) honors a stubbed positive integer', () => {
    // SETUP
    vi.stubEnv(VALIDATION_TIMEOUT, '3600');

    // EXECUTE
    const result = getValidationTimeoutSeconds();

    // VERIFY
    expect(result).toBe(3600);
  });

  it('(c) returns default when env var is NaN', () => {
    // SETUP
    vi.stubEnv(VALIDATION_TIMEOUT, 'abc');

    // EXECUTE
    const result = getValidationTimeoutSeconds();

    // VERIFY
    expect(result).toBe(DEFAULT_VALIDATION_TIMEOUT_SECONDS); // 7200
  });

  it('(d) returns default when env var is zero', () => {
    // SETUP
    vi.stubEnv(VALIDATION_TIMEOUT, '0');

    // EXECUTE
    const result = getValidationTimeoutSeconds();

    // VERIFY
    expect(result).toBe(DEFAULT_VALIDATION_TIMEOUT_SECONDS); // 7200
  });

  it('(e) returns default when env var is negative', () => {
    // SETUP
    vi.stubEnv(VALIDATION_TIMEOUT, '-5');

    // EXECUTE
    const result = getValidationTimeoutSeconds();

    // VERIFY
    expect(result).toBe(DEFAULT_VALIDATION_TIMEOUT_SECONDS); // 7200
  });

  it('(f) returns a stubbed integer value', () => {
    // SETUP
    vi.stubEnv(VALIDATION_TIMEOUT, '14400');

    // EXECUTE
    const result = getValidationTimeoutSeconds();

    // VERIFY
    expect(result).toBe(14400);
  });

  it('(g) returns the 2h default (7200) that bounds a full test-suite run (PRD §4.4)', () => {
    // The watchdog is a HARD upper bound for the validation call only — validation
    // legitimately runs full test suites, so it needs a much larger budget than a
    // normal agent call. The abort-on-failure behavior itself is wired by P4.M2.T1.S2.
    const budget = getValidationTimeoutSeconds();
    expect(budget).toBeGreaterThan(0);
    expect(budget).toBe(DEFAULT_VALIDATION_TIMEOUT_SECONDS); // 7200 when unset
  });
});

describe('config/constants: getValidationAgent', () => {
  beforeEach(() => {
    delete process.env.VALIDATION_AGENT;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('(a) returns the default (pizr) when env var is unset', () => {
    // EXECUTE
    const result = getValidationAgent();

    // VERIFY
    expect(result).toBe(DEFAULT_VALIDATION_AGENT); // 'pizr'
  });

  it('(b) honors a stubbed custom agent', () => {
    // SETUP
    vi.stubEnv(VALIDATION_AGENT, 'custom-reasoner');

    // EXECUTE
    const result = getValidationAgent();

    // VERIFY
    expect(result).toBe('custom-reasoner');
  });

  it('(c) returns default when env var is empty', () => {
    // SETUP — empty string would silently break the validation call without the guard
    vi.stubEnv(VALIDATION_AGENT, '');

    // EXECUTE
    const result = getValidationAgent();

    // VERIFY
    expect(result).toBe(DEFAULT_VALIDATION_AGENT); // 'pizr'
  });

  it('(d) returns default when env var is whitespace-only', () => {
    // SETUP
    vi.stubEnv(VALIDATION_AGENT, '   ');

    // EXECUTE
    const result = getValidationAgent();

    // VERIFY
    expect(result).toBe(DEFAULT_VALIDATION_AGENT); // 'pizr'
  });

  it('(e) trims surrounding whitespace from a set value', () => {
    // SETUP
    vi.stubEnv(VALIDATION_AGENT, '  pizr  ');

    // EXECUTE
    const result = getValidationAgent();

    // VERIFY
    expect(result).toBe('pizr');
  });

  it('(f) returns pizr when explicitly set to pizr', () => {
    // SETUP
    vi.stubEnv(VALIDATION_AGENT, 'pizr');

    // EXECUTE
    const result = getValidationAgent();

    // VERIFY
    expect(result).toBe(DEFAULT_VALIDATION_AGENT); // 'pizr'
  });
});
