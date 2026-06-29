/**
 * End-to-end tests for the provider-aware auth resolution order (PRD §9.2.6 / §9.2.7)
 *
 * @remarks
 * Proves ALL FIVE resolution-order cases from PRD §9.2.6/§9.2.7 (no network/LLM calls):
 * (a) explicit override wins;
 * (b) ZAI_API_KEY-only succeeds under pi+zai;
 * (c) auth.json-only (no env) succeeds under pi+zai (file-backed via AuthStorage + temp-dir);
 * (d) empty/whitespace strings treated as "not configured";
 * (e) ANTHROPIC_AUTH_TOKEN succeeds ONLY when the provider is anthropic.
 *
 * The matrix exercises the resolution order END-TO-END: it asserts BOTH what
 * `resolveApiKeyForProvider()` returns AND what `ensureHarnessInitialized()` actually
 * forwards into the harness (`registry.initializeProvider('pi', opts)`), using the
 * `vi.mock('groundswell')` + spy pattern from `harness-provider-compat.test.ts`.
 *
 * For case (c) it additionally proves the file-backed half (the pi contract T2.S2 enables)
 * by asserting `AuthStorage.create().getApiKey('zai')` resolves a seeded temp-dir auth.json.
 *
 * INPUT: the resolver from T2.S1 (DONE — exported) + the file-backed AuthStorage from T2.S2
 * (parallel; assumed settled).
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ── vi.mock('groundswell'): intercepts ONLY 'groundswell' (the real AuthStorage import below
//    from '@earendil-works/pi-coding-agent' is unaffected — it is a different module). ──
vi.mock('groundswell', () => {
  const initializeProvider = vi.fn();
  const registry = {
    has: vi.fn(() => false),
    register: vi.fn(),
    initializeProvider, // shared spy — asserted on per forwarding test
  };
  return {
    configureHarnesses: vi.fn(),
    HarnessRegistry: { getInstance: () => registry }, // stable object across has/register/init
    PiHarness: class MockPiHarness {},
  };
});

// The S1-shipped hacky-hack resolver + forwarding fns (real, not mocked by vi.mock('groundswell')
// because they live in src/config/harness.js — a different module specifier).
import {
  resolveApiKeyForProvider,
  ensureHarnessInitialized,
} from '../../../src/config/harness.js';
import {
  configureEnvironment,
  getResolvedProvider,
} from '../../../src/config/environment.js';

// The mocked HarnessRegistry export — used to fetch the shared spy in forwarding tests.
import { HarnessRegistry } from 'groundswell';

// The real AuthStorage for case (c) (different module — NOT mocked by vi.mock('groundswell')).
import { AuthStorage } from '@earendil-works/pi-coding-agent';

// ── Shared env-clearing helper: tests/setup.ts loads .env, so clear everything auth-related. ──
const AUTH_VARS = [
  'ZAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_OAUTH_TOKEN',
  'PRP_API_KEY',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
] as const;

function clearAuthEnv(): void {
  for (const v of AUTH_VARS) delete process.env[v];
}

// =============================================================================
// RESOLVER LEVEL — cases (a), (b), (d), (e) against resolveApiKeyForProvider directly
// =============================================================================
describe('auth resolution order — resolver level', () => {
  beforeEach(() => {
    clearAuthEnv();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('(a) explicit options.override wins over provider env', () => {
    vi.stubEnv('ZAI_API_KEY', 'zai-env-key');

    expect(resolveApiKeyForProvider('zai', { override: 'override-x' })).toBe(
      'override-x'
    );
  });

  it('(a) PRP_API_KEY env wins over provider env', () => {
    vi.stubEnv('PRP_API_KEY', 'env-override');
    vi.stubEnv('ZAI_API_KEY', 'zai-env-key');

    expect(resolveApiKeyForProvider('zai')).toBe('env-override');
  });

  it('(b) ZAI_API_KEY returned for zai when no override (no Anthropic var required)', () => {
    vi.stubEnv('ZAI_API_KEY', 'zai-key-123');

    expect(resolveApiKeyForProvider('zai')).toBe('zai-key-123');
  });

  it('(d) whitespace-only ZAI_API_KEY treated as not configured', () => {
    vi.stubEnv('ZAI_API_KEY', '   ');

    expect(resolveApiKeyForProvider('zai')).toBeUndefined();
  });

  it('(d) whitespace-only PRP_API_KEY falls through to provider env', () => {
    vi.stubEnv('PRP_API_KEY', '  ');
    vi.stubEnv('ZAI_API_KEY', 'zai-key');

    expect(resolveApiKeyForProvider('zai')).toBe('zai-key');
  });

  it('(e-zai) ANTHROPIC_AUTH_TOKEN NOT consulted for zai', () => {
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'token');

    // AUTH_TOKEN is NOT directly read by the resolver; configureEnvironment does NOT
    // map it for zai. → resolver sees nothing.
    expect(resolveApiKeyForProvider('zai')).toBeUndefined();
  });
});

// =============================================================================
// FORWARDING LEVEL — cases (a)–(e) via ensureHarnessInitialized with mocked groundswell
// =============================================================================
describe('auth resolution order — what is forwarded to the harness', () => {
  beforeEach(() => {
    clearAuthEnv();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // Helper: get the shared initializeProvider spy from the mocked registry.
  function getInitSpy() {
    return HarnessRegistry.getInstance().initializeProvider as ReturnType<
      typeof vi.fn
    >;
  }

  it('(a) override forwarded as { apiKey: override }', async () => {
    vi.stubEnv('PRP_API_KEY', 'override');
    vi.stubEnv('ZAI_API_KEY', 'zai-env-key');

    await ensureHarnessInitialized();

    expect(getInitSpy()).toHaveBeenCalledWith('pi', { apiKey: 'override' });
  });

  it('(b) ZAI_API_KEY forwarded as { apiKey: <zaiVal> }', async () => {
    vi.stubEnv('ZAI_API_KEY', 'zai-key');

    await ensureHarnessInitialized();

    expect(getInitSpy()).toHaveBeenCalledWith('pi', { apiKey: 'zai-key' });
  });

  it('(c) auth.json-only forwards undefined (defer to pi)', async () => {
    // No env vars set — resolver returns undefined → forwarded undefined (NOT { apiKey: '' })
    await ensureHarnessInitialized();

    expect(getInitSpy()).toHaveBeenCalledWith('pi', undefined);
  });

  it('(d) whitespace-only forwards undefined (NOT { apiKey: "" })', async () => {
    vi.stubEnv('ZAI_API_KEY', '   ');

    await ensureHarnessInitialized();

    expect(getInitSpy()).toHaveBeenCalledWith('pi', undefined);
  });

  it('(e-zai) ANTHROPIC_AUTH_TOKEN NOT forwarded under default zai provider', async () => {
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'token');
    // Default provider is zai → AUTH_TOKEN is not consulted.
    await ensureHarnessInitialized();

    expect(getInitSpy()).toHaveBeenCalledWith('pi', undefined);
  });

  it('(e-anthropic) ANTHROPIC_AUTH_TOKEN forwarded ONLY under anthropic provider', async () => {
    vi.stubEnv('ANTHROPIC_DEFAULT_SONNET_MODEL', 'anthropic/claude-sonnet-4');
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'token');

    // configureEnvironment maps AUTH_TOKEN → ANTHROPIC_API_KEY for anthropic provider
    configureEnvironment();
    expect(getResolvedProvider()).toBe('anthropic');
    expect(process.env.ANTHROPIC_API_KEY).toBe('token'); // proves the map ran

    await ensureHarnessInitialized();

    expect(getInitSpy()).toHaveBeenCalledWith('pi', { apiKey: 'token' });
  });
});

// =============================================================================
// AUTH.JSON — file-backed resolution (PRD §9.2.6 / T2.S2) — case (c) pi-side proof
// =============================================================================
describe('auth.json — file-backed resolution (PRD §9.2.6 / T2.S2)', () => {
  let tmpAgentDir: string;

  beforeEach(() => {
    clearAuthEnv();
    tmpAgentDir = mkdtempSync(join(tmpdir(), 'auth-res-'));
    vi.stubEnv('PI_CODING_AGENT_DIR', tmpAgentDir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(tmpAgentDir, { recursive: true, force: true });
  });

  it('(c) AuthStorage.create() resolves a seeded auth.json (no env vars)', async () => {
    writeFileSync(
      join(tmpAgentDir, 'auth.json'),
      JSON.stringify({ zai: { type: 'api_key', key: 'auth-json-key' } })
    );

    const auth = AuthStorage.create(); // file-backed; reads PI_CODING_AGENT_DIR/auth.json
    expect(await auth.getApiKey('zai')).toBe('auth-json-key'); // ASYNC — proves file-backed read
  });

  it('(c) missing auth.json is tolerated (no throw, no key)', async () => {
    // No auth.json in tmpAgentDir — AuthStorage.create() is missing-file tolerant.
    const auth = AuthStorage.create();
    await expect(auth.getApiKey('zai')).resolves.toBeUndefined();
  });

  it('AuthStorage.inMemory seed resolves', async () => {
    const auth = AuthStorage.inMemory({
      zai: { type: 'api_key', key: 'mem-key' },
    });
    expect(await auth.getApiKey('zai')).toBe('mem-key');
  });
});
