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
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  readdirSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

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
import { configureEnvironment } from '../../../src/config/environment.js';

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

// =============================================================================
// T3.S2 — Acceptance case (d): ANTHROPIC_AUTH_TOKEN is provider-conditional
// (PRD §9.2.7 — AUTH_TOKEN succeeds only under the anthropic provider)
//
// Cross-references: T3.S1 covers (b) auth.json-only, (c) ZAI_API_KEY-only,
// (e) claude-code-requires-anthropic. T3.S2 owns (d) only.
// =============================================================================

describe('acceptance (d) — ANTHROPIC_AUTH_TOKEN is provider-conditional', () => {
  it('AUTH_TOKEN proceeds ONLY under the anthropic provider', async () => {
    vi.stubEnv('ANTHROPIC_DEFAULT_SONNET_MODEL', 'anthropic/claude-sonnet-4');
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'tok');
    configureEnvironment(); // maps AUTH_TOKEN → ANTHROPIC_API_KEY (provider=anthropic)
    await expect(runAuthPreflight()).resolves.toBeUndefined();
    expect(process.env.ANTHROPIC_API_KEY).toBe('tok'); // proves the map ran
  });

  it('AUTH_TOKEN is NOT consulted for the default zai path (throws)', async () => {
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'tok'); // no model override → provider stays 'zai'
    configureEnvironment(); // does NOT map AUTH_TOKEN for zai
    await expect(runAuthPreflight()).rejects.toThrow(AuthPreflightError);
    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined(); // proves NO map for zai
  });
});

// =============================================================================
// T3.S2 — Full AuthPreflightError shape + message-contents matrix (PRD §9.2.7)
//
// Asserts the structured harness/provider/model fields and that the message
// names EVERY checked source and BOTH remediation commands, for both zai and
// anthropic variants. T3.S1 checks some message fragments; T3.S2 covers the
// structured-field assertions + the COMPLETE source/remediation matrix.
// =============================================================================

describe('AuthPreflightError — full shape + message matrix (PRD §9.2.7)', () => {
  it('carries structured fields + the complete actionable message (zai variant)', async () => {
    // Default harness + zai provider (no env vars set by beforeEach).
    const err = (await runAuthPreflight().catch(
      (e: unknown) => e as AuthPreflightError
    )) as AuthPreflightError;

    expect(err).toBeInstanceOf(AuthPreflightError);
    expect(err.name).toBe('AuthPreflightError');
    expect(err.harness).toBe('pi');
    expect(err.provider).toBe('zai');
    expect(err.model).toMatch(/^zai\//);

    // Identity tokens
    expect(err.message).toContain("provider 'zai'");
    expect(err.message).toContain("harness 'pi'");
    expect(err.message).toMatch(/model 'zai\//);

    // ALL checked sources
    expect(err.message).toContain('PRP_API_KEY');
    expect(err.message).toContain('ZAI_API_KEY');
    expect(err.message).toContain('auth.json');

    // BOTH remediation commands
    expect(err.message).toContain('pi /login');
    expect(err.message).toContain('export ZAI_API_KEY=<your-key>');
  });

  it('carries the complete actionable message for the claude-code/anthropic variant', async () => {
    vi.stubEnv('PRP_AGENT_HARNESS', 'claude-code');
    vi.stubEnv('ANTHROPIC_DEFAULT_SONNET_MODEL', 'anthropic/claude-sonnet-4');
    // NO anthropic credential → preflight throws
    const err = (await runAuthPreflight().catch(
      (e: unknown) => e as AuthPreflightError
    )) as AuthPreflightError;

    expect(err).toBeInstanceOf(AuthPreflightError);
    expect(err.harness).toBe('claude-code');
    expect(err.provider).toBe('anthropic');
    expect(err.model).toMatch(/^anthropic\//);

    // Provider-specific env vars
    expect(err.message).toContain("provider 'anthropic'");
    expect(err.message).toContain('ANTHROPIC_API_KEY / ANTHROPIC_OAUTH_TOKEN');

    // Remediation
    expect(err.message).toContain('export ANTHROPIC_API_KEY=<your-key>');
  });
});

// =============================================================================
// T3.S2 — Acceptance case (a): end-to-end subprocess abort
// (PRD §9.2.7 — no credential → exit 1 + single message + NO session dir)
//
// main() is NOT exported and index.ts auto-runs void main().catch(...). The
// "exit 1 + no session dir" guarantee is a PROCESS-level property — prove it
// with spawnSync (mirrors logger-teardown.test.ts).
//
// Cross-references: T3.S1 covers (b) auth.json-only, (c) ZAI_API_KEY-only,
// (e) claude-code-requires-anthropic in-process. T3.S2 owns (a) subprocess only.
// =============================================================================

const CLI = resolve(process.cwd(), 'dist/index.js');
const hasBuild = existsSync(CLI);
const describeOrSkip = hasBuild ? describe : describe.skip;

describeOrSkip(
  'acceptance (a) — no-credential aborts at startup: exit 1, single message, NO session dir',
  () => {
    it('exits 1, prints the preflight message on stderr, creates no plan/ session dir', () => {
      const tmpAgentDir = mkdtempSync(join(tmpdir(), 'preflight-spawn-'));
      const prdAbs = resolve(process.cwd(), 'PRD.md'); // EXISTS — avoids the parseCLIArgs existsSync trap
      const env = {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        USER: process.env.USER,
        SHELL: process.env.SHELL,
        PI_CODING_AGENT_DIR: tmpAgentDir, // SCRUBBED — no creds
      };
      const planDir = resolve(process.cwd(), 'plan');
      const sessRe = /^\d{3}_[0-9a-f]{12}$/;
      const before = existsSync(planDir)
        ? new Set(readdirSync(planDir).filter(s => sessRe.test(s)))
        : new Set<string>();

      const res = spawnSync(process.execPath, [CLI, '--prd', prdAbs], {
        encoding: 'utf8',
        timeout: 20_000,
        env,
      });

      // Exit code 1 (auth preflight abort)
      expect(res.status).toBe(1);

      // The single preflight message on STDERR (console.error), not stdout
      expect(res.stderr).toContain('Authentication preflight failed');
      // Proves we reached the preflight, NOT parseCLIArgs (which would say 'PRD file not found')
      expect(res.stderr).not.toContain('PRD file not found');

      // No new plan/<NNN>_<hash>/ session dir created (preflight aborted before PRPPipeline)
      const after = existsSync(planDir)
        ? new Set(readdirSync(planDir).filter(s => sessRe.test(s)))
        : new Set<string>();
      expect([...after].sort()).toEqual([...before].sort());

      rmSync(tmpAgentDir, { recursive: true, force: true });
    });

    // Credential-free SUCCESS counterpart (b): --validate-prd runs with NO credential.
    // (bugfix P1.M1.T1.S1 — dryRun/validatePrd early-return BEFORE runAuthPreflight)
    it('exits 0, prints the validation report on stdout, bypasses preflight, creates no session dir', () => {
      const tmpAgentDir = mkdtempSync(join(tmpdir(), 'preflight-spawn-'));
      const prdAbs = resolve(process.cwd(), 'PRD.md'); // EXISTS + valid — required for validatePrd
      // SCRUBBED env: only the 5 safe keys. NO credential vars. Empty PI_CODING_AGENT_DIR (no auth.json).
      const env = {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        USER: process.env.USER,
        SHELL: process.env.SHELL,
        PI_CODING_AGENT_DIR: tmpAgentDir,
      };
      const planDir = resolve(process.cwd(), 'plan');
      const sessRe = /^\d{3}_[0-9a-f]{12}$/;
      const before = existsSync(planDir)
        ? new Set(readdirSync(planDir).filter(s => sessRe.test(s)))
        : new Set<string>();

      const res = spawnSync(
        process.execPath,
        [CLI, '--prd', prdAbs, '--validate-prd'],
        {
          encoding: 'utf8',
          timeout: 20_000,
          env,
        }
      );

      // EXIT 0 — local mode succeeded credential-free
      expect(res.status).toBe(0);
      // Validation report on STDOUT (pino-pretty → stdout). '✅ VALID' = PRD.md in repo root is valid.
      expect(res.stdout).toContain('✅ VALID');
      // CRITICAL: proves the preflight was BYPASSED (would be on stderr w/ exit 1 if it ran)
      expect(res.stderr).not.toContain('Authentication preflight failed');
      // No new session dir created (validatePrd returns before any pipeline/session work)
      const after = existsSync(planDir)
        ? new Set(readdirSync(planDir).filter(s => sessRe.test(s)))
        : new Set<string>();
      expect([...after].sort()).toEqual([...before].sort());

      rmSync(tmpAgentDir, { recursive: true, force: true });
    });

    // Credential-free SUCCESS counterpart (c): --dry-run runs with NO credential.
    // (bugfix P1.M1.T1.S1 — dryRun/validatePrd early-return BEFORE runAuthPreflight)
    it('exits 0, prints DRY RUN on stdout, bypasses preflight, creates no session dir', () => {
      const tmpAgentDir = mkdtempSync(join(tmpdir(), 'preflight-spawn-'));
      const prdAbs = resolve(process.cwd(), 'PRD.md');
      const env = {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        USER: process.env.USER,
        SHELL: process.env.SHELL,
        PI_CODING_AGENT_DIR: tmpAgentDir,
      };
      const planDir = resolve(process.cwd(), 'plan');
      const sessRe = /^\d{3}_[0-9a-f]{12}$/;
      const before = existsSync(planDir)
        ? new Set(readdirSync(planDir).filter(s => sessRe.test(s)))
        : new Set<string>();

      const res = spawnSync(
        process.execPath,
        [CLI, '--prd', prdAbs, '--dry-run'],
        {
          encoding: 'utf8',
          timeout: 20_000,
          env,
        }
      );

      // EXIT 0 — local mode succeeded credential-free
      expect(res.status).toBe(0);
      // Dry-run banner on STDOUT (pino-pretty → stdout)
      expect(res.stdout).toContain('DRY RUN');
      // CRITICAL: proves the preflight was BYPASSED
      expect(res.stderr).not.toContain('Authentication preflight failed');
      // No new session dir created (dryRun returns before any pipeline/session work)
      const after = existsSync(planDir)
        ? new Set(readdirSync(planDir).filter(s => sessRe.test(s)))
        : new Set<string>();
      expect([...after].sort()).toEqual([...before].sort());

      rmSync(tmpAgentDir, { recursive: true, force: true });
    });
  }
);
