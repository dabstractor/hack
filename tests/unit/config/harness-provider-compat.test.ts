/**
 * Unit tests for harness↔provider compatibility rejection (PRD §9.4.3 / §9.2.4)
 *
 * @remarks
 * Proves that the configureHarness() guard implemented in P1.M1.T1.S2 does exactly:
 * (a) allows the default pi + zai path at init
 * (b) rejects claude-code + zai with an actionable error citing PRD §9.2.4 and
 *     explicitly pointing the user to switch the harness OR the model provider
 * (c) keeps claude-code a structurally valid harness id (rejected only for the
 *     z.ai provider mismatch, not as an unknown id)
 *
 * No network/LLM calls. Mocks configureHarnesses (Groundswell's only public
 * harness export) and asserts on call args.
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

// CRITICAL: Groundswell does NOT export getGlobalHarnessConfig/resetGlobalHarnessConfig.
// Mock configureHarnesses and assert on call args (verified working by M1.T1.S2).
vi.mock('groundswell', () => ({
  configureHarnesses: vi.fn(),
  HarnessRegistry: {
    getInstance: () => ({ has: () => false, register: vi.fn() }),
  },
  PiHarness: class MockPiHarness {},
}));

import { configureHarnesses } from 'groundswell';
import { configureHarness } from '../../../src/config/harness.js';
import { HarnessProviderMismatchError } from '../../../src/config/types.js';
import {
  DEFAULT_MODEL_PROVIDER,
  SUPPORTED_HARNESSES,
} from '../../../src/config/constants.js';

describe('harness/provider compatibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.PRP_AGENT_HARNESS;
    vi.stubEnv('ANTHROPIC_API_KEY', 'stubbed-key');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('(a) pi + zai succeeds and resolves the default harness to pi', () => {
    // SETUP
    vi.stubEnv('PRP_AGENT_HARNESS', 'pi');

    // EXECUTE & VERIFY
    expect(configureHarness()).toBe('pi');
    // "defaultHarness === 'pi'" verified via the configureHarnesses call args
    // (getGlobalHarnessConfig is unexported — see research).
    expect(configureHarnesses).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultHarness: 'pi',
        defaultModelProvider: DEFAULT_MODEL_PROVIDER,
      })
    );
  });

  it('(a-cont) env unset defaults to pi + zai (the allowed config)', () => {
    // SETUP
    delete process.env.PRP_AGENT_HARNESS;

    // EXECUTE & VERIFY
    expect(configureHarness()).toBe('pi');
    expect(configureHarnesses).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultHarness: 'pi',
        defaultModelProvider: 'zai',
      })
    );
  });

  it('(b) claude-code + zai throws HarnessProviderMismatchError with actionable guidance', () => {
    // SETUP
    vi.stubEnv('PRP_AGENT_HARNESS', 'claude-code');

    // EXECUTE
    let err: HarnessProviderMismatchError;
    try {
      configureHarness();
      throw new Error('should not reach');
    } catch (e) {
      err = e as HarnessProviderMismatchError;
    }

    // VERIFY: error shape
    expect(err!).toBeInstanceOf(HarnessProviderMismatchError);
    expect(err!.name).toBe('HarnessProviderMismatchError');
    expect(err!.harness).toBe('claude-code');
    expect(err!.provider).toBe('zai');

    // VERIFY: actionable message — must cite §9.2.4 AND point to both remediation paths
    expect(err!.message).toContain('§9.2.4');
    expect(err!.message).toContain('pi'); // switch-harness remediation
    expect(err!.message).toContain('anthropic'); // switch-provider remediation

    // VERIFY: configureHarnesses must NOT have been called
    expect(configureHarnesses).not.toHaveBeenCalled();
  });

  it('(c) claude-code is a structurally valid harness id', () => {
    // EXECUTE & VERIFY: claude-code is in SUPPORTED_HARNESSES — rejected only for
    // the provider mismatch, not for being an unknown id.
    expect(
      (SUPPORTED_HARNESSES as readonly string[]).includes('claude-code')
    ).toBe(true);
  });

  it('(c-cont) an unknown id is rejected as unknown, NOT as a provider mismatch', () => {
    // SETUP
    expect((SUPPORTED_HARNESSES as readonly string[]).includes('bogus')).toBe(
      false
    );
    vi.stubEnv('PRP_AGENT_HARNESS', 'bogus');

    // EXECUTE
    let err2: unknown;
    try {
      configureHarness();
    } catch (e) {
      err2 = e;
    }

    // VERIFY: plain Error, NOT HarnessProviderMismatchError — proves the
    // claude-code rejection is for the MISMATCH, not for being unknown.
    expect(err2).toBeInstanceOf(Error);
    expect(err2).not.toBeInstanceOf(HarnessProviderMismatchError);
    expect((err2 as Error).message).toMatch(/pi.*claude-code|claude-code.*pi/);

    // VERIFY: configureHarnesses must NOT have been called
    expect(configureHarnesses).not.toHaveBeenCalled();
  });

  it('(d) claude-code + anthropic provider is ALLOWED (no throw) — resolved-provider guard allow branch', () => {
    // SETUP: claude-code harness + an anthropic/* model override.
    // getModel('sonnet') reads ANTHROPIC_DEFAULT_SONNET_MODEL FIRST → 'anthropic/claude-sonnet-4'
    // (qualifyModel is idempotent on '/') → resolvedProvider = 'anthropic' → guard does NOT throw.
    vi.stubEnv('PRP_AGENT_HARNESS', 'claude-code');
    vi.stubEnv('ANTHROPIC_DEFAULT_SONNET_MODEL', 'anthropic/claude-sonnet-4');

    // EXECUTE & VERIFY: returns 'claude-code' (reaching this assertion PROVES no throw).
    expect(configureHarness()).toBe('claude-code');

    // VERIFY: Step 5 delegation happened with claude-code as the default harness.
    expect(configureHarnesses).toHaveBeenCalledTimes(1);
    expect(configureHarnesses).toHaveBeenCalledWith(
      expect.objectContaining({ defaultHarness: 'claude-code' })
    );
  });
});
