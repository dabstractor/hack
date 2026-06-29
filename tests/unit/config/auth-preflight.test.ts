/**
 * Unit tests for the fail-fast auth preflight (PRD §9.2.7)
 *
 * @remarks
 * Coverage-sufficient suite proving runAuthPreflight() gates the startup path:
 * - (a) ZAI_API_KEY set → proceeds (override/env early return)
 * - (b) auth.json only (no env) → proceeds (AuthStorage configured)
 * - (c) no credential → throws AuthPreflightError with actionable message
 * - (d) whitespace-only ZAI_API_KEY → throws (empty-string policy; hasAuth would wrongly pass)
 * - (e) claude-code harness → checks anthropic credential
 *
 * T3.S2 owns the full acceptance/integration matrix (no-session-dir-on-fail, end-to-end main() wiring,
 * AUTH_TOKEN-only-for-anthropic, etc.). This file covers every runAuthPreflight branch for 100%.
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// CRITICAL: groundswell mock is REQUIRED because harness.ts imports groundswell at module level.
// Without this mock, importing harness.ts fails with "Cannot find module 'groundswell'".
vi.mock('groundswell', () => ({
  configureHarnesses: vi.fn(),
  HarnessRegistry: {
    getInstance: () => ({ has: () => false, register: vi.fn() }),
  },
  PiHarness: class MockPiHarness {},
}));

import { runAuthPreflight } from '../../../src/config/harness.js';
import { AuthPreflightError } from '../../../src/config/types.js';

const AUTH_VARS = [
  'ZAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_OAUTH_TOKEN',
  'PRP_API_KEY',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'PRP_AGENT_HARNESS',
] as const;

let tmpAgentDir: string;

beforeEach(() => {
  vi.clearAllMocks();
  // Clear all auth env vars (tests/setup.ts runs dotenv.config() which pollutes from .env)
  for (const v of AUTH_VARS) {
    delete process.env[v];
  }
  // MANDATORY: AuthStorage.create() reads ~/.pi/agent/auth.json unless PI_CODING_AGENT_DIR
  // is overridden. Without this, a "no-credential" test would wrongly pass on a dev machine
  // that has a real auth.json.
  tmpAgentDir = mkdtempSync(join(tmpdir(), 'preflight-'));
  vi.stubEnv('PI_CODING_AGENT_DIR', tmpAgentDir);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(tmpAgentDir, { recursive: true, force: true });
});

describe('runAuthPreflight', () => {
  it('proceeds when ZAI_API_KEY is set (override/env path)', async () => {
    vi.stubEnv('ZAI_API_KEY', 'zai-test-key');

    await expect(runAuthPreflight()).resolves.toBeUndefined();
  });

  it('proceeds when only ~/.pi/agent/auth.json is present (auth.json path)', async () => {
    // NO env vars set. Seed auth.json in the temp PI_CODING_AGENT_DIR.
    writeFileSync(
      join(tmpAgentDir, 'auth.json'),
      JSON.stringify({ zai: { type: 'api_key', key: 'auth-json-key' } })
    );

    await expect(runAuthPreflight()).resolves.toBeUndefined();
  });

  it('throws AuthPreflightError when no credential is configured', async () => {
    // NO env, NO auth.json (tmpAgentDir is empty).

    await expect(runAuthPreflight()).rejects.toThrow(AuthPreflightError);

    // Verify the message names the key identifiers
    const caught = await runAuthPreflight().catch(
      (e: unknown) => e as AuthPreflightError
    );
    expect(caught).toBeInstanceOf(AuthPreflightError);
    expect(caught!.message).toContain("provider 'zai'");
    expect(caught!.message).toContain('ZAI_API_KEY');
    expect(caught!.message).toContain('PRP_API_KEY');
    expect(caught!.message).toContain('auth.json');
    expect(caught!.message).toContain('pi /login');
  });

  it('treats whitespace-only ZAI_API_KEY as not configured (aborts)', async () => {
    // hasAuth() would WRONGLY return true for whitespace env; getAuthStatus().configured=false.
    vi.stubEnv('ZAI_API_KEY', '   ');

    await expect(runAuthPreflight()).rejects.toThrow(AuthPreflightError);
  });

  it('checks the anthropic credential for the claude-code harness', async () => {
    // claude-code is Anthropic-only; preflight should check 'anthropic' regardless of model.
    vi.stubEnv('PRP_AGENT_HARNESS', 'claude-code');
    // NO anthropic credential set.

    await expect(runAuthPreflight()).rejects.toThrow(AuthPreflightError);

    // Verify the message references 'anthropic' as the provider
    const caught = await runAuthPreflight().catch(
      (e: unknown) => e as AuthPreflightError
    );
    expect(caught).toBeInstanceOf(AuthPreflightError);
    expect(caught!.message).toContain("provider 'anthropic'");
    expect(caught!.message).toContain('ANTHROPIC_API_KEY');
  });

  it('claude-code harness proceeds when ANTHROPIC_API_KEY is set', async () => {
    vi.stubEnv('PRP_AGENT_HARNESS', 'claude-code');
    vi.stubEnv('ANTHROPIC_API_KEY', 'ant-test-key');

    await expect(runAuthPreflight()).resolves.toBeUndefined();
  });
});
