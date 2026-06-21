/**
 * Unit tests for harness configuration module (configureHarness)
 *
 * @remarks
 * Tests validate the configureHarness() function from src/config/harness.ts.
 * Covers all 4 contract cases for 100% branch coverage:
 * - (a) PRP_AGENT_HARNESS unset → defaults to 'pi'
 * - (b) Explicit 'pi' + zai → succeeds
 * - (c) 'claude-code' + zai → throws HarnessProviderMismatchError
 * - (d) Invalid value → throws Error listing supported harnesses
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.hoisted() lifts controllable vi.fns ABOVE the vi.mock hoist boundary so the factory can reference them.
const { mockHas, mockRegister } = vi.hoisted(() => ({
  mockHas: vi.fn(() => false), // default: pi NOT registered → register() runs (existing behavior)
  mockRegister: vi.fn(),
}));

// CRITICAL: mock configureHarnesses (Groundswell does NOT export reset/query helpers)
vi.mock('groundswell', () => ({
  configureHarnesses: vi.fn(),
  HarnessRegistry: {
    getInstance: () => ({ has: mockHas, register: mockRegister }),
  },
  PiHarness: class MockPiHarness {},
}));

import { configureHarnesses } from 'groundswell';
import { configureHarness } from '../../../src/config/harness.js';
import { HarnessProviderMismatchError } from '../../../src/config/types.js';
import { DEFAULT_MODEL_PROVIDER } from '../../../src/config/constants.js';

describe('config/harness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHas.mockReturnValue(false); // ensure each case starts in the "not registered" state
    delete process.env.PRP_AGENT_HARNESS;
    vi.stubEnv('ANTHROPIC_API_KEY', 'stubbed-key');
  });

  it('(a) defaults to pi when PRP_AGENT_HARNESS unset', () => {
    // SETUP
    delete process.env.PRP_AGENT_HARNESS;

    // EXECUTE
    const h = configureHarness();

    // VERIFY
    expect(h).toBe('pi');
    expect(configureHarnesses).toHaveBeenCalledTimes(1);
    expect(configureHarnesses).toHaveBeenCalledWith({
      defaultHarness: 'pi',
      defaultModelProvider: DEFAULT_MODEL_PROVIDER,
      harnessDefaults: { 'claude-code': { apiKey: 'stubbed-key' } },
    });
  });

  it('(b) explicit pi + zai succeeds', () => {
    // SETUP
    vi.stubEnv('PRP_AGENT_HARNESS', 'pi');

    // EXECUTE & VERIFY
    expect(configureHarness()).toBe('pi');
    expect(configureHarnesses).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultHarness: 'pi',
        defaultModelProvider: 'zai',
      })
    );
  });

  it('(c) claude-code + zai throws HarnessProviderMismatchError and does NOT call configureHarnesses', () => {
    // SETUP
    vi.stubEnv('PRP_AGENT_HARNESS', 'claude-code');

    // EXECUTE & VERIFY: must throw HarnessProviderMismatchError
    expect(() => configureHarness()).toThrow(HarnessProviderMismatchError);

    // VERIFY: error properties
    let err: HarnessProviderMismatchError;
    try {
      configureHarness();
      throw new Error('Should not reach here');
    } catch (e) {
      err = e as HarnessProviderMismatchError;
    }
    expect(err!.name).toBe('HarnessProviderMismatchError');
    expect(err!.harness).toBe('claude-code');
    expect(err!.provider).toBe('zai');
    expect(err!.message).toContain('§9.2.4');

    // VERIFY: configureHarnesses must NOT have been called
    expect(configureHarnesses).not.toHaveBeenCalled();
  });

  it('(d) invalid value throws a supported-harnesses message', () => {
    // SETUP
    vi.stubEnv('PRP_AGENT_HARNESS', 'bogus');

    // EXECUTE & VERIFY: must throw a plain Error
    expect(() => configureHarness()).toThrow(Error);
    expect(() => configureHarness()).toThrow(/bogus/);
    expect(() => configureHarness()).toThrow(/pi.*claude-code|claude-code.*pi/);

    // VERIFY: configureHarnesses must NOT have been called
    expect(configureHarnesses).not.toHaveBeenCalled();
  });

  it('(e) skips register() when HarnessRegistry already has pi (skip branch)', () => {
    // SETUP: simulate "pi already registered" — the idempotent skip path
    mockHas.mockReturnValue(true);

    // EXECUTE
    const h = configureHarness();

    // VERIFY: resolved harness still 'pi' ...
    expect(h).toBe('pi');
    // ... and register() was NOT called (the skip branch)
    expect(mockRegister).not.toHaveBeenCalled();
    // ... and configureHarnesses() WAS still called (registration-skip ≠ config-skip)
    expect(configureHarnesses).toHaveBeenCalledTimes(1);
    expect(configureHarnesses).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultHarness: 'pi',
        defaultModelProvider: 'zai',
      })
    );
  });
});
