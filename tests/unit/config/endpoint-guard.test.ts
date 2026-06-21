/**
 * Unit tests for endpoint guard module (checkProviderEndpoint / validateProviderEndpoint)
 *
 * @remarks
 * Tests validate the provider-endpoint guard from src/config/endpoint-guard.ts.
 * Covers all 5 decision-table branches + message wording + vi.stubEnv delegation.
 * Proves the guard constrains the LLM PROVIDER (z.ai), NOT the agent harness (PRD §9.2.4).
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  checkProviderEndpoint,
  validateProviderEndpoint,
  ZAI_ENDPOINT,
  BLOCKED_ENDPOINT_PATTERNS,
} from '../../../src/config/endpoint-guard.js';
import { DEFAULT_HARNESS } from '../../../src/config/constants.js';

describe('endpoint-guard', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe('checkProviderEndpoint', () => {
    it('allows the z.ai provider endpoint', () => {
      const result = checkProviderEndpoint(ZAI_ENDPOINT);
      expect(result.status).toBe('allowed');
      expect(result.message).toBe('');
    });

    it('allows empty/unset base URL', () => {
      const result = checkProviderEndpoint('');
      expect(result.status).toBe('allowed');
      expect(result.message).toBe('');
    });

    it('allows localhost endpoints', () => {
      expect(checkProviderEndpoint('http://localhost:3000').status).toBe(
        'allowed'
      );
      expect(
        checkProviderEndpoint('http://localhost:3000/v1/messages').status
      ).toBe('allowed');
    });

    it('allows 127.0.0.1 endpoints', () => {
      expect(checkProviderEndpoint('http://127.0.0.1:4000').status).toBe(
        'allowed'
      );
    });

    it('allows endpoints containing "mock"', () => {
      expect(checkProviderEndpoint('http://mock-server:9999').status).toBe(
        'allowed'
      );
    });

    it('allows endpoints containing "test"', () => {
      expect(checkProviderEndpoint('http://test-server:8888').status).toBe(
        'allowed'
      );
    });

    it('blocks Anthropic official API (https variant)', () => {
      const result = checkProviderEndpoint('https://api.anthropic.com');
      expect(result.status).toBe('blocked');
    });

    it('blocks Anthropic official API (http variant)', () => {
      const result = checkProviderEndpoint('http://api.anthropic.com');
      expect(result.status).toBe('blocked');
    });

    it('blocks Anthropic official API (bare domain)', () => {
      const result = checkProviderEndpoint('api.anthropic.com');
      expect(result.status).toBe('blocked');
    });

    it('blocks Anthropic official API with path suffix', () => {
      const result = checkProviderEndpoint(
        'https://api.anthropic.com/v1/messages'
      );
      expect(result.status).toBe('blocked');
    });

    it('blocks all BLOCKED_ENDPOINT_PATTERNS variants', () => {
      for (const pattern of BLOCKED_ENDPOINT_PATTERNS) {
        expect(checkProviderEndpoint(pattern).status).toBe('blocked');
      }
    });

    it('returns warning for other non-z.ai endpoints', () => {
      const result = checkProviderEndpoint('https://example.com/api');
      expect(result.status).toBe('warning');
    });
  });

  describe('checkProviderEndpoint message clarification', () => {
    it('blocked message contains "provider" and cites §9.2.4', () => {
      const result = checkProviderEndpoint('https://api.anthropic.com');
      expect(result.status).toBe('blocked');
      expect(result.message).toMatch(/provider/i);
      expect(result.message).toContain('§9.2.4');
    });

    it('blocked message states orthogonality to the agent harness', () => {
      const result = checkProviderEndpoint('https://api.anthropic.com');
      expect(result.message).toMatch(/harness/i);
    });

    it('blocked message does NOT reference PRP_AGENT_HARNESS', () => {
      const result = checkProviderEndpoint('https://api.anthropic.com');
      expect(result.message).not.toContain('PRP_AGENT_HARNESS');
    });

    it('warning message contains "provider" and cites §9.2.4', () => {
      const result = checkProviderEndpoint('https://example.com/api');
      expect(result.status).toBe('warning');
      expect(result.message).toMatch(/provider/i);
      expect(result.message).toContain('§9.2.4');
    });

    it('warning message does NOT reference PRP_AGENT_HARNESS', () => {
      const result = checkProviderEndpoint('https://example.com/api');
      expect(result.message).not.toContain('PRP_AGENT_HARNESS');
    });

    it('DEFAULT_HARNESS is pi — documents provider/harness orthogonality', () => {
      // The allowed config is the default pi harness + z.ai provider (PRD §9.4)
      expect(DEFAULT_HARNESS).toBe('pi');
    });
  });

  describe('validateProviderEndpoint', () => {
    it('does not throw when ANTHROPIC_BASE_URL is z.ai', () => {
      vi.stubEnv('ANTHROPIC_BASE_URL', ZAI_ENDPOINT);
      expect(() => validateProviderEndpoint()).not.toThrow();
    });

    it('throws when ANTHROPIC_BASE_URL points at Anthropic', () => {
      vi.stubEnv('ANTHROPIC_BASE_URL', 'https://api.anthropic.com');
      expect(() => validateProviderEndpoint()).toThrow(/provider/i);
    });

    it('does not throw when ANTHROPIC_BASE_URL is localhost', () => {
      vi.stubEnv('ANTHROPIC_BASE_URL', 'http://localhost:3000');
      expect(() => validateProviderEndpoint()).not.toThrow();
    });

    it('does not throw when ANTHROPIC_BASE_URL contains mock', () => {
      vi.stubEnv('ANTHROPIC_BASE_URL', 'http://mock-server:9999');
      expect(() => validateProviderEndpoint()).not.toThrow();
    });

    it('does not throw when ANTHROPIC_BASE_URL is empty/unset', () => {
      delete process.env.ANTHROPIC_BASE_URL;
      expect(() => validateProviderEndpoint()).not.toThrow();
    });

    it('warns (console.warn) for other non-z.ai endpoint', () => {
      vi.stubEnv('ANTHROPIC_BASE_URL', 'https://example.com/api');
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      expect(() => validateProviderEndpoint()).not.toThrow();
      expect(warnSpy).toHaveBeenCalled();
      expect(warnSpy.mock.calls[0][0]).toMatch(/provider/i);

      warnSpy.mockRestore();
    });

    it('accepts an explicit baseUrl argument (env bypass)', () => {
      // Even if env is Anthropic, explicit z.ai param should not throw
      vi.stubEnv('ANTHROPIC_BASE_URL', 'https://api.anthropic.com');
      expect(() => validateProviderEndpoint(ZAI_ENDPOINT)).not.toThrow();
    });
  });
});
