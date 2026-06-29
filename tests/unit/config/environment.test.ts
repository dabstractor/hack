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
  // CLEANUP: Always restore environment after each test
  afterEach(() => {
    vi.unstubAllEnvs();
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
  });

  describe('getModel', () => {
    it('should return qualified default model for opus tier', () => {
      // SETUP: No override
      delete process.env.ANTHROPIC_DEFAULT_OPUS_MODEL;

      // EXECUTE & VERIFY
      expect(getModel('opus')).toBe(
        `${DEFAULT_MODEL_PROVIDER}/${MODEL_NAMES.opus}`
      ); // 'zai/GLM-4.7'
    });

    it('should return qualified default model for sonnet tier', () => {
      // SETUP: No override
      delete process.env.ANTHROPIC_DEFAULT_SONNET_MODEL;

      // EXECUTE & VERIFY
      expect(getModel('sonnet')).toBe(
        `${DEFAULT_MODEL_PROVIDER}/${MODEL_NAMES.sonnet}`
      );
    });

    it('should return qualified default model for haiku tier', () => {
      // SETUP: No override
      delete process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL;

      // EXECUTE & VERIFY
      expect(getModel('haiku')).toBe(
        `${DEFAULT_MODEL_PROVIDER}/${MODEL_NAMES.haiku}`
      ); // 'zai/glm-5-turbo'
    });

    it('should qualify environment override for opus tier', () => {
      // SETUP: Override via env var
      vi.stubEnv('ANTHROPIC_DEFAULT_OPUS_MODEL', 'custom-opus-model');

      // EXECUTE & VERIFY
      expect(getModel('opus')).toBe('zai/custom-opus-model');
    });

    it('should qualify environment override for sonnet tier', () => {
      // SETUP: Override via env var
      vi.stubEnv('ANTHROPIC_DEFAULT_SONNET_MODEL', 'custom-sonnet-model');

      // EXECUTE & VERIFY
      expect(getModel('sonnet')).toBe('zai/custom-sonnet-model');
    });

    it('should qualify environment override for haiku tier', () => {
      // SETUP: Override via env var
      vi.stubEnv('ANTHROPIC_DEFAULT_HAIKU_MODEL', 'custom-haiku-model');

      // EXECUTE & VERIFY
      expect(getModel('haiku')).toBe('zai/custom-haiku-model');
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
      // SETUP
      vi.stubEnv('ANTHROPIC_DEFAULT_OPUS_MODEL', 'custom-opus');

      // EXECUTE & VERIFY
      expect(getModel('opus')).toBe('zai/custom-opus');
    });

    it('does not double-prefix an already-qualified env override', () => {
      // SETUP
      vi.stubEnv('ANTHROPIC_DEFAULT_OPUS_MODEL', 'anthropic/foo');

      // EXECUTE & VERIFY
      expect(getModel('opus')).toBe('anthropic/foo');
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
