/**
 * Unit tests for provider-aware auth resolver + provider-conditional configureEnvironment
 *
 * @remarks
 * Tests validate the resolveApiKeyForProvider() resolver (PRD §9.2.6 priority order),
 * the provider-conditional configureEnvironment() behavior, and getResolvedProvider().
 * Coverage-sufficient for T2.S1; the comprehensive resolution matrix + auth.json-on-disk
 * tests are owned by T2.S3.
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { resolveApiKeyForProvider } from '../../../src/config/harness.js';
import {
  configureEnvironment,
  getResolvedProvider,
} from '../../../src/config/environment.js';
import { DEFAULT_BASE_URL } from '../../../src/config/constants.js';

describe('resolveApiKeyForProvider', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns PRP_API_KEY override when set (wins over provider env)', () => {
    vi.stubEnv('PRP_API_KEY', 'override-key');
    vi.stubEnv('ZAI_API_KEY', 'zai-env-key');

    expect(resolveApiKeyForProvider('zai')).toBe('override-key');
  });

  it('returns ZAI_API_KEY for zai when no override (no Anthropic var required)', () => {
    vi.stubEnv('ZAI_API_KEY', 'zai-key-123');
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    delete process.env.PRP_API_KEY;

    expect(resolveApiKeyForProvider('zai')).toBe('zai-key-123');
  });

  it('returns undefined when no credential configured', () => {
    delete process.env.ZAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    delete process.env.PRP_API_KEY;
    delete process.env.ANTHROPIC_OAUTH_TOKEN;

    expect(resolveApiKeyForProvider('zai')).toBeUndefined();
    expect(resolveApiKeyForProvider('anthropic')).toBeUndefined();
  });

  it('treats whitespace-only ZAI_API_KEY as not configured (returns undefined)', () => {
    vi.stubEnv('ZAI_API_KEY', '   ');
    delete process.env.PRP_API_KEY;

    expect(resolveApiKeyForProvider('zai')).toBeUndefined();
  });

  it('treats whitespace-only PRP_API_KEY as not configured (falls through to provider env)', () => {
    vi.stubEnv('PRP_API_KEY', '  ');
    vi.stubEnv('ZAI_API_KEY', 'zai-key');

    expect(resolveApiKeyForProvider('zai')).toBe('zai-key');
  });

  it('returns ANTHROPIC_API_KEY for anthropic provider (via provider env lookup)', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'anthropic-key');
    delete process.env.ANTHROPIC_OAUTH_TOKEN;
    delete process.env.PRP_API_KEY;

    expect(resolveApiKeyForProvider('anthropic')).toBe('anthropic-key');
  });

  it('returns ANTHROPIC_OAUTH_TOKEN for anthropic provider (takes precedence over API_KEY)', () => {
    vi.stubEnv('ANTHROPIC_OAUTH_TOKEN', 'oauth-token');
    vi.stubEnv('ANTHROPIC_API_KEY', 'api-key');
    delete process.env.PRP_API_KEY;

    expect(resolveApiKeyForProvider('anthropic')).toBe('oauth-token');
  });

  it('options.override wins over PRP_API_KEY env', () => {
    vi.stubEnv('PRP_API_KEY', 'env-override');
    vi.stubEnv('ZAI_API_KEY', 'zai-env');

    expect(
      resolveApiKeyForProvider('zai', { override: 'direct-override' })
    ).toBe('direct-override');
  });

  it('options.override wins even when PRP_API_KEY is unset', () => {
    delete process.env.PRP_API_KEY;
    vi.stubEnv('ZAI_API_KEY', 'zai-env');

    expect(
      resolveApiKeyForProvider('zai', { override: 'direct-override' })
    ).toBe('direct-override');
  });

  it('returns undefined for unknown provider', () => {
    delete process.env.PRP_API_KEY;

    expect(resolveApiKeyForProvider('unknown-provider')).toBeUndefined();
  });
});

describe('getResolvedProvider', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns zai when ANTHROPIC_DEFAULT_SONNET_MODEL is unset (default)', () => {
    delete process.env.ANTHROPIC_DEFAULT_SONNET_MODEL;

    expect(getResolvedProvider()).toBe('zai');
  });

  it('returns zai when a bare model name is set', () => {
    vi.stubEnv('ANTHROPIC_DEFAULT_SONNET_MODEL', 'glm-5.2');

    expect(getResolvedProvider()).toBe('zai');
  });

  it('returns anthropic when an anthropic/* model override is set', () => {
    vi.stubEnv('ANTHROPIC_DEFAULT_SONNET_MODEL', 'anthropic/claude-sonnet-4');

    expect(getResolvedProvider()).toBe('anthropic');
  });
});

describe('configureEnvironment (provider-conditional)', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.ANTHROPIC_DEFAULT_SONNET_MODEL;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('does NOT map ANTHROPIC_AUTH_TOKEN→ANTHROPIC_API_KEY for default zai provider', () => {
    // Default provider is zai (sonnet model unset)
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'test-token-123');

    configureEnvironment();

    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('maps ANTHROPIC_AUTH_TOKEN→ANTHROPIC_API_KEY only when provider is anthropic', () => {
    vi.stubEnv('ANTHROPIC_DEFAULT_SONNET_MODEL', 'anthropic/claude-sonnet-4');
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'test-token-456');

    configureEnvironment();

    expect(process.env.ANTHROPIC_API_KEY).toBe('test-token-456');
  });

  it('defaults ANTHROPIC_BASE_URL to z.ai for zai', () => {
    configureEnvironment();

    expect(process.env.ANTHROPIC_BASE_URL).toBe(DEFAULT_BASE_URL);
  });

  it('does NOT force z.ai BASE_URL for anthropic provider', () => {
    vi.stubEnv('ANTHROPIC_DEFAULT_SONNET_MODEL', 'anthropic/claude-sonnet-4');

    configureEnvironment();

    expect(process.env.ANTHROPIC_BASE_URL).toBeUndefined();
  });

  it('preserves custom BASE_URL when already set (zai provider)', () => {
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://custom.endpoint.com/api');

    configureEnvironment();

    expect(process.env.ANTHROPIC_BASE_URL).toBe(
      'https://custom.endpoint.com/api'
    );
  });

  it('preserves existing API_KEY when AUTH_TOKEN is also set (anthropic provider)', () => {
    vi.stubEnv('ANTHROPIC_DEFAULT_SONNET_MODEL', 'anthropic/claude-sonnet-4');
    vi.stubEnv('ANTHROPIC_API_KEY', 'original-api-key');
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'different-auth-token');

    configureEnvironment();

    expect(process.env.ANTHROPIC_API_KEY).toBe('original-api-key');
  });
});
