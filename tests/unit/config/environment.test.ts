/**
 * Unit tests for environment configuration module
 *
 * @remarks
 * Tests validate environment variable mapping, model selection, and validation
 * with 100% code coverage of src/config/environment.ts
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  _resetDeprecationWarnings,
  configureEnvironment,
  getModel,
  qualifyModel,
  validateEnvironment,
  EnvironmentValidationError,
} from '../../../src/config/environment.js';
import {
  DEFAULT_BASE_URL,
  DEFAULT_MODEL_PROVIDER,
  MODEL_NAMES,
} from '../../../src/config/constants.js';

describe('config/environment', () => {
  // Silent the one-time deprecation warnings (console.warn) so test output stays clean;
  // assertions inspect warnSpy.mock.calls directly. Re-armed per-test via afterEach.
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  // CLEANUP: Always restore environment + spy + re-arm the dedup Set after each test
  afterEach(() => {
    vi.unstubAllEnvs();
    warnSpy.mockRestore();
    _resetDeprecationWarnings();
  });

  describe('configureEnvironment', () => {
    it('should map AUTH_TOKEN to API_KEY when API_KEY is not set (anthropic provider only)', () => {
      // SETUP: Clear API_KEY, set AUTH_TOKEN, force anthropic provider
      delete process.env.ANTHROPIC_API_KEY;
      vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'test-token-123');
      vi.stubEnv('ANTHROPIC_DEFAULT_SONNET_MODEL', 'anthropic/claude-sonnet-4');

      // EXECUTE
      configureEnvironment();

      // VERIFY: API_KEY should be set from AUTH_TOKEN (anthropic provider only)
      expect(process.env.ANTHROPIC_API_KEY).toBe('test-token-123');
    });

    it('should NOT map AUTH_TOKEN for default zai provider', () => {
      // SETUP: Clear API_KEY, set AUTH_TOKEN, default zai provider
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_DEFAULT_SONNET_MODEL;
      vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'test-token-zai');

      // EXECUTE
      configureEnvironment();

      // VERIFY: AUTH_TOKEN is NOT mapped for zai
      expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
    });

    it('should preserve existing API_KEY when AUTH_TOKEN is also set (anthropic provider)', () => {
      // SETUP: Both API_KEY and AUTH_TOKEN set, anthropic provider
      vi.stubEnv('ANTHROPIC_API_KEY', 'original-api-key');
      vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'different-auth-token');
      vi.stubEnv('ANTHROPIC_DEFAULT_SONNET_MODEL', 'anthropic/claude-sonnet-4');

      // EXECUTE
      configureEnvironment();

      // VERIFY: API_KEY should NOT be overwritten
      expect(process.env.ANTHROPIC_API_KEY).toBe('original-api-key');
    });

    it('should be idempotent - calling multiple times produces same result (anthropic provider)', () => {
      // SETUP: Set AUTH_TOKEN, clear API_KEY and BASE_URL, force anthropic provider
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_BASE_URL;
      vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'test-token-456');
      vi.stubEnv('ANTHROPIC_DEFAULT_SONNET_MODEL', 'anthropic/claude-sonnet-4');

      // EXECUTE: Call configureEnvironment() twice
      configureEnvironment();
      const firstResult = {
        apiKey: process.env.ANTHROPIC_API_KEY,
        baseUrl: process.env.ANTHROPIC_BASE_URL,
      };

      configureEnvironment();
      const secondResult = {
        apiKey: process.env.ANTHROPIC_API_KEY,
        baseUrl: process.env.ANTHROPIC_BASE_URL,
      };

      // VERIFY: Results should be identical
      expect(firstResult).toEqual(secondResult);
      expect(firstResult.apiKey).toBe('test-token-456');
      // BASE_URL is NOT defaulted for anthropic provider
      expect(firstResult.baseUrl).toBeUndefined();
    });

    it('should be idempotent - zai provider defaults BASE_URL to z.ai', () => {
      // SETUP: Clear all, default zai provider
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_BASE_URL;
      delete process.env.ANTHROPIC_DEFAULT_SONNET_MODEL;

      configureEnvironment();
      configureEnvironment();

      expect(process.env.ANTHROPIC_BASE_URL).toBe(DEFAULT_BASE_URL);
    });

    it('should NOT force default BASE_URL for anthropic provider', () => {
      // SETUP: Force anthropic provider, no BASE_URL set
      delete process.env.ANTHROPIC_BASE_URL;
      vi.stubEnv('ANTHROPIC_DEFAULT_SONNET_MODEL', 'anthropic/claude-sonnet-4');

      // EXECUTE
      configureEnvironment();

      // VERIFY: BASE_URL stays unset (z.ai default NOT forced for anthropic)
      expect(process.env.ANTHROPIC_BASE_URL).toBeUndefined();
    });

    it('should set default BASE_URL when not provided (zai provider)', () => {
      // SETUP: No BASE_URL set, default zai provider
      delete process.env.ANTHROPIC_BASE_URL;
      delete process.env.ANTHROPIC_DEFAULT_SONNET_MODEL;

      // EXECUTE
      configureEnvironment();

      // VERIFY: Default z.ai endpoint
      expect(process.env.ANTHROPIC_BASE_URL).toBe(DEFAULT_BASE_URL);
    });

    it('should preserve custom BASE_URL when already set', () => {
      // SETUP: Custom BASE_URL
      vi.stubEnv('ANTHROPIC_BASE_URL', 'https://custom.endpoint.com/api');

      // EXECUTE
      configureEnvironment();

      // VERIFY: Custom URL preserved
      expect(process.env.ANTHROPIC_BASE_URL).toBe(
        'https://custom.endpoint.com/api'
      );
    });

    it('should write canonical PRP_API_BASE_URL into ANTHROPIC_BASE_URL (zai, no warning)', () => {
      // SETUP: canonical endpoint set, nothing else
      delete process.env.ANTHROPIC_BASE_URL;
      vi.stubEnv('PRP_API_BASE_URL', 'https://canon.example/api');

      // EXECUTE
      configureEnvironment();

      // VERIFY: canonical mirrored into the SDK-contract var; no deprecation warning
      expect(process.env.ANTHROPIC_BASE_URL).toBe('https://canon.example/api');
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('should let canonical PRP_API_BASE_URL win over legacy ANTHROPIC_BASE_URL (no warning)', () => {
      // SETUP: both canonical + legacy set
      vi.stubEnv('PRP_API_BASE_URL', 'https://canon.example/api');
      vi.stubEnv('ANTHROPIC_BASE_URL', 'https://legacy.example/api');

      // EXECUTE
      configureEnvironment();

      // VERIFY: canonical wins; no deprecation warning (legacy not consulted)
      expect(process.env.ANTHROPIC_BASE_URL).toBe('https://canon.example/api');
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('should preserve a legacy-only ANTHROPIC_BASE_URL + warn once naming PRP_API_BASE_URL', () => {
      // SETUP: legacy endpoint only
      delete process.env.PRP_API_BASE_URL;
      vi.stubEnv('ANTHROPIC_BASE_URL', 'https://legacy.example/api');

      // EXECUTE
      configureEnvironment();

      // VERIFY: legacy value preserved on the SDK-contract var; ONE deprecation warning
      expect(process.env.ANTHROPIC_BASE_URL).toBe('https://legacy.example/api');
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(String(warnSpy.mock.calls[0][0])).toContain('PRP_API_BASE_URL');
      expect(String(warnSpy.mock.calls[0][0])).toContain('§9.2.8');

      // VERIFY dedup — a second call does NOT warn again
      configureEnvironment();
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it('should default ANTHROPIC_BASE_URL to z.ai when neither canonical nor legacy is set (zai)', () => {
      // SETUP: nothing set, default zai provider
      delete process.env.PRP_API_BASE_URL;
      delete process.env.ANTHROPIC_BASE_URL;
      delete process.env.ANTHROPIC_DEFAULT_SONNET_MODEL;

      // EXECUTE
      configureEnvironment();

      // VERIFY: z.ai default; no deprecation warning
      expect(process.env.ANTHROPIC_BASE_URL).toBe(DEFAULT_BASE_URL);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('should leave ANTHROPIC_BASE_URL unset when neither canonical nor legacy is set (anthropic)', () => {
      // SETUP: anthropic provider via CANONICAL var (no model deprecation), nothing else set
      delete process.env.PRP_API_BASE_URL;
      delete process.env.ANTHROPIC_BASE_URL;
      vi.stubEnv('PRP_MODEL_BALANCED', 'anthropic/claude-sonnet-4');

      // EXECUTE
      configureEnvironment();

      // VERIFY: z.ai default NOT forced for anthropic; no deprecation warning
      expect(process.env.ANTHROPIC_BASE_URL).toBeUndefined();
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  describe('getModel', () => {
    // -------- canonical PRP_MODEL_* path (no warning) --------
    it('should return qualified model when canonical PRP_MODEL_HIGH is set (no warning)', () => {
      // SETUP: canonical override only
      vi.stubEnv('PRP_MODEL_HIGH', 'canon-high');

      // EXECUTE & VERIFY
      expect(getModel('high')).toBe('zai/canon-high');
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('should return qualified model when canonical PRP_MODEL_BALANCED is set (no warning)', () => {
      vi.stubEnv('PRP_MODEL_BALANCED', 'canon-balanced');
      expect(getModel('balanced')).toBe('zai/canon-balanced');
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('should return qualified model when canonical PRP_MODEL_FAST is set (no warning)', () => {
      vi.stubEnv('PRP_MODEL_FAST', 'canon-fast');
      expect(getModel('fast')).toBe('zai/canon-fast');
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('should let canonical win over legacy when BOTH are set (no warning)', () => {
      // SETUP: both canonical + legacy set for the fast tier
      vi.stubEnv('PRP_MODEL_FAST', 'canon-fast');
      vi.stubEnv('ANTHROPIC_DEFAULT_HAIKU_MODEL', 'legacy-fast');

      // EXECUTE & VERIFY — canonical wins, no deprecation warning
      expect(getModel('fast')).toBe('zai/canon-fast');
      expect(warnSpy).not.toHaveBeenCalled();
    });

    // -------- legacy ANTHROPIC_DEFAULT_* path (resolves + warns once) --------
    it('should resolve the legacy high var + emit a one-time deprecation warning', () => {
      // SETUP: legacy override only
      vi.stubEnv('ANTHROPIC_DEFAULT_OPUS_MODEL', 'legacy-high');

      // EXECUTE & VERIFY — legacy resolves, ONE warning naming PRP_MODEL_HIGH
      expect(getModel('high')).toBe('zai/legacy-high');
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(String(warnSpy.mock.calls[0][0])).toContain('PRP_MODEL_HIGH');
      expect(String(warnSpy.mock.calls[0][0])).toContain('§9.2.8');

      // VERIFY dedup — a second call does NOT warn again
      getModel('high');
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it('should resolve the legacy balanced var + warn once naming PRP_MODEL_BALANCED', () => {
      vi.stubEnv('ANTHROPIC_DEFAULT_SONNET_MODEL', 'legacy-balanced');
      expect(getModel('balanced')).toBe('zai/legacy-balanced');
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(String(warnSpy.mock.calls[0][0])).toContain('PRP_MODEL_BALANCED');
    });

    it('should resolve the legacy fast var + warn once naming PRP_MODEL_FAST', () => {
      vi.stubEnv('ANTHROPIC_DEFAULT_HAIKU_MODEL', 'legacy-fast');
      expect(getModel('fast')).toBe('zai/legacy-fast');
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(String(warnSpy.mock.calls[0][0])).toContain('PRP_MODEL_FAST');
    });

    it('should warn once per tier (independent dedup keys)', () => {
      // SETUP: legacy overrides for two different tiers
      vi.stubEnv('ANTHROPIC_DEFAULT_OPUS_MODEL', 'legacy-high');
      vi.stubEnv('ANTHROPIC_DEFAULT_SONNET_MODEL', 'legacy-balanced');

      // EXECUTE & VERIFY — each tier warns exactly once (independent dedup keys)
      getModel('high');
      getModel('high');
      getModel('balanced');
      expect(warnSpy).toHaveBeenCalledTimes(2);
    });

    // -------- default path (no warning) --------
    it('should return the qualified default high model when nothing is set', () => {
      delete process.env.PRP_MODEL_HIGH;
      delete process.env.ANTHROPIC_DEFAULT_OPUS_MODEL;
      expect(getModel('high')).toBe(
        `${DEFAULT_MODEL_PROVIDER}/${MODEL_NAMES.high}`
      );
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('should return the qualified default balanced model when nothing is set', () => {
      delete process.env.PRP_MODEL_BALANCED;
      delete process.env.ANTHROPIC_DEFAULT_SONNET_MODEL;
      expect(getModel('balanced')).toBe(
        `${DEFAULT_MODEL_PROVIDER}/${MODEL_NAMES.balanced}`
      );
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('should return the qualified default fast model when nothing is set', () => {
      delete process.env.PRP_MODEL_FAST;
      delete process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL;
      expect(getModel('fast')).toBe(
        `${DEFAULT_MODEL_PROVIDER}/${MODEL_NAMES.fast}`
      );
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  describe('qualifyModel', () => {
    it('qualifies a bare name with the default provider', () => {
      // EXECUTE & VERIFY
      expect(qualifyModel('GLM-4.7')).toBe('zai/GLM-4.7');
    });

    it('does not double-prefix an already-qualified name', () => {
      // EXECUTE & VERIFY
      expect(qualifyModel('anthropic/foo')).toBe('anthropic/foo');
      expect(qualifyModel('zai/GLM-4.7')).toBe('zai/GLM-4.7');
    });

    it('honors an explicit provider argument', () => {
      // EXECUTE & VERIFY
      expect(qualifyModel('GLM-4.7', 'anthropic')).toBe('anthropic/GLM-4.7');
    });

    it('qualifies an env override end-to-end via getModel', () => {
      // SETUP — canonical override (no deprecation)
      vi.stubEnv('PRP_MODEL_HIGH', 'custom-opus');

      // EXECUTE & VERIFY
      expect(getModel('high')).toBe('zai/custom-opus');
    });

    it('does not double-prefix an already-qualified env override', () => {
      // SETUP — canonical override (no deprecation)
      vi.stubEnv('PRP_MODEL_HIGH', 'anthropic/foo');

      // EXECUTE & VERIFY
      expect(getModel('high')).toBe('anthropic/foo');
    });
  });

  describe('validateEnvironment', () => {
    beforeEach(() => {
      // Ensure clean state before validation tests
      vi.unstubAllEnvs();
    });

    it('should pass when all required variables are set', () => {
      // SETUP: All required vars present
      vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
      vi.stubEnv('ANTHROPIC_BASE_URL', 'https://api.example.com');

      // EXECUTE & VERIFY: Should not throw
      expect(() => validateEnvironment()).not.toThrow();
    });

    it('should throw when API_KEY is missing', () => {
      // SETUP: Missing API_KEY
      delete process.env.ANTHROPIC_API_KEY;
      vi.stubEnv('ANTHROPIC_BASE_URL', 'https://api.example.com');

      // EXECUTE & VERIFY
      expect(() => validateEnvironment()).toThrow(EnvironmentValidationError);
    });

    it('should throw when BASE_URL is missing', () => {
      // SETUP: Missing BASE_URL
      vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
      delete process.env.ANTHROPIC_BASE_URL;

      // EXECUTE & VERIFY
      expect(() => validateEnvironment()).toThrow(EnvironmentValidationError);
    });

    it('should throw when both required variables are missing', () => {
      // SETUP: Both missing
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_BASE_URL;

      // EXECUTE
      try {
        validateEnvironment();
        // If we get here, test should fail
        expect(true).toBe(false);
      } catch (e) {
        // VERIFY: Error has both missing variables
        expect(e).toBeInstanceOf(EnvironmentValidationError);
        if (e instanceof EnvironmentValidationError) {
          expect(e.missing).toContain('ANTHROPIC_API_KEY');
          expect(e.missing).toContain('ANTHROPIC_BASE_URL');
          expect(e.missing).toHaveLength(2);
        }
      }
    });

    it('should include missing variable name in error', () => {
      // SETUP: Missing API_KEY only
      delete process.env.ANTHROPIC_API_KEY;
      vi.stubEnv('ANTHROPIC_BASE_URL', 'https://api.example.com');

      // EXECUTE
      try {
        validateEnvironment();
        // If we get here, test should fail
        expect(true).toBe(false);
      } catch (e) {
        // VERIFY: Error has missing property with correct variable name
        expect(e).toBeInstanceOf(EnvironmentValidationError);
        if (e instanceof EnvironmentValidationError) {
          expect(e.missing).toEqual(['ANTHROPIC_API_KEY']);
        }
      }
    });
  });
});
