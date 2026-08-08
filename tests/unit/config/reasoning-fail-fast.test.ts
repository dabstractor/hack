/**
 * Unit + integration tests for the fail-fast reasoning-level startup gate
 * (PRD §9.2.9 "Per-Role Reasoning Level" → "#4 Validation (fail-fast)").
 *
 * @remarks
 * Two-tier suite mirroring auth-preflight.test.ts:
 *  - (unit) `validateAllReasoningLevels()` directly: invalid env → throws
 *    `ReasoningConfigError` naming key+value+accepted list; valid / empty /
 *    unset / case-insensitive env → no throw (no-op void).
 *  - (spawn) `PRP_REASONING_AGENT=ultra` + `ZAI_API_KEY` set → exit 1,
 *    actionable reasoning message on stderr, NO new `plan/<NNN>_<hash>/`
 *    session dir, auth message ABSENT (auth passed first). Plus a `--dry-run`
 *    CONTROL proving the gate sits AFTER the credential-free early returns.
 *
 * The unit tests do NOT mock `constants.js` — `validateAllReasoningLevels` is a
 * pure `process.env` reader (constants.ts does not import groundswell), so the
 * real getters run and the ENV is stubbed per case. The spawn tests need a
 * built `dist/index.js` and are gated with `describeOrSkip(hasBuild)`.
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  validateAllReasoningLevels,
  PRP_REASONING_AGENT,
  PRP_REASONING_BREAKDOWN_AGENT,
  PRP_REASONING_BUG_FINDER_AGENT,
  PRP_REASONING_VALIDATION_AGENT,
  PRP_REASONING_IMPL_AGENT,
} from '../../../src/config/constants.js';
import { ReasoningConfigError } from '../../../src/config/types.js';

// The five per-role reasoning env vars (mirror the AUTH_VARS pattern in
// auth-preflight.test.ts). tests/setup.ts runs dotenv.config(), and while the
// repo .env does NOT set any PRP_REASONING_* (only .env.example documents them,
// commented), clearing these in beforeEach guarantees determinism on any host.
const REASONING_VARS = [
  PRP_REASONING_AGENT,
  PRP_REASONING_BREAKDOWN_AGENT,
  PRP_REASONING_BUG_FINDER_AGENT,
  PRP_REASONING_VALIDATION_AGENT,
  PRP_REASONING_IMPL_AGENT,
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  for (const v of REASONING_VARS) {
    delete process.env[v];
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('validateAllReasoningLevels (startup gate, PRD §9.2.9 #4)', () => {
  it('throws ReasoningConfigError for an invalid PRP_REASONING_AGENT value', () => {
    vi.stubEnv(PRP_REASONING_AGENT, 'ultra');

    expect(() => validateAllReasoningLevels()).toThrow(ReasoningConfigError);

    // Assert the actionable message substrings + structured fields.
    let caught: unknown;
    try {
      validateAllReasoningLevels();
    } catch (e) {
      caught = e;
    }
    const err = caught as ReasoningConfigError;
    expect(err).toBeInstanceOf(ReasoningConfigError);
    expect(err.name).toBe('ReasoningConfigError');
    expect(err.message).toContain('Invalid reasoning level');
    expect(err.message).toContain(PRP_REASONING_AGENT);
    expect(err.message).toContain('ultra');
    expect(err.message).toContain('off, minimal, low, medium, high, xhigh');
    expect(err.key).toBe(PRP_REASONING_AGENT);
    expect(err.value).toBe('ultra');
  });

  it('throws ReasoningConfigError for an invalid value on a DIFFERENT role (proves all 5 are validated)', () => {
    vi.stubEnv(PRP_REASONING_IMPL_AGENT, 'loud');

    expect(() => validateAllReasoningLevels()).toThrow(ReasoningConfigError);

    let caught: unknown;
    try {
      validateAllReasoningLevels();
    } catch (e) {
      caught = e;
    }
    const err = caught as ReasoningConfigError;
    expect(err).toBeInstanceOf(ReasoningConfigError);
    expect(err.message).toContain(PRP_REASONING_IMPL_AGENT);
    expect(err.message).toContain('loud');
    expect(err.key).toBe(PRP_REASONING_IMPL_AGENT);
    expect(err.value).toBe('loud');
  });

  it('does NOT throw for a valid PRP_REASONING_VALIDATION_AGENT value', () => {
    vi.stubEnv(PRP_REASONING_VALIDATION_AGENT, 'xhigh');
    expect(() => validateAllReasoningLevels()).not.toThrow();
  });

  it('treats a case-insensitive valid value as valid (e.g. HIGH)', () => {
    vi.stubEnv(PRP_REASONING_AGENT, 'HIGH');
    expect(() => validateAllReasoningLevels()).not.toThrow();
  });

  it('treats an empty/whitespace value as unset → default (no throw)', () => {
    vi.stubEnv(PRP_REASONING_AGENT, '   ');
    expect(() => validateAllReasoningLevels()).not.toThrow();
  });

  it('does NOT throw when all reasoning vars are unset (defaults)', () => {
    expect(() => validateAllReasoningLevels()).not.toThrow();
  });

  it('exposes name/key/value fields on the thrown ReasoningConfigError', () => {
    vi.stubEnv(PRP_REASONING_BUG_FINDER_AGENT, 'nope');

    let caught: unknown;
    try {
      validateAllReasoningLevels();
    } catch (e) {
      caught = e;
    }
    const err = caught as ReasoningConfigError;
    expect(err).toBeInstanceOf(ReasoningConfigError);
    expect(err.name).toBe('ReasoningConfigError');
    expect(err.key).toBe(PRP_REASONING_BUG_FINDER_AGENT);
    expect(err.value).toBe('nope');
  });
});

// =============================================================================
// T4.S1 — Acceptance: invalid reasoning env aborts at startup
// (PRD §9.2.9 #4 — exit 1 + single actionable message + NO session dir)
//
// main() is NOT exported and index.ts auto-runs void main().catch(...). The
// "exit 1 + single message + no session dir" guarantee is a PROCESS-level
// property — prove it with spawnSync (mirrors auth-preflight.test.ts).
//
// CRITICAL ordering: validateAllReasoningLevels() runs AFTER runAuthPreflight()
// (architecture §G). To ISOLATE the reasoning gate, the spawn test SETS
// ZAI_API_KEY so the auth preflight passes and the reasoning gate is reached.
// Without ZAI_API_KEY, AuthPreflightError fires first and the test sees the
// wrong message.
// =============================================================================

const CLI = resolve(process.cwd(), 'dist/index.js');
const hasBuild = existsSync(CLI);
const describeOrSkip = hasBuild ? describe : describe.skip;

describeOrSkip(
  'acceptance — invalid reasoning env aborts at startup: exit 1, single message, NO session dir (PRD §9.2.9 #4)',
  () => {
    it('exits 1, prints the reasoning message on stderr, auth message ABSENT, creates no plan/ session dir', () => {
      const tmpAgentDir = mkdtempSync(join(tmpdir(), 'reasoning-spawn-'));
      const prdAbs = resolve(process.cwd(), 'spec/SPEC.md'); // EXISTS — avoids the parseCLIArgs existsSync trap
      // SET ZAI_API_KEY so the auth preflight PASSES and the reasoning gate is
      // reached. Without it, AuthPreflightError fires first (auth precedes
      // reasoning per architecture §G) and the test would see the auth message.
      const env = {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        USER: process.env.USER,
        SHELL: process.env.SHELL,
        PI_CODING_AGENT_DIR: tmpAgentDir,
        ZAI_API_KEY: 'zai-test-key', // ← auth preflight passes
        PRP_REASONING_AGENT: 'ultra', // ← invalid → ReasoningConfigError
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

      // Exit code 1 (reasoning gate abort)
      expect(res.status).toBe(1);

      // The single reasoning-config message on STDERR (console.error).
      expect(res.stderr).toContain('Invalid reasoning level');
      expect(res.stderr).toContain(PRP_REASONING_AGENT);
      expect(res.stderr).toContain('ultra');
      expect(res.stderr).toContain('off, minimal, low, medium, high, xhigh');

      // CRITICAL: proves the auth preflight PASSED (would be on stderr w/
      // exit 1 if it had failed) — the reasoning gate, not auth, aborted.
      expect(res.stderr).not.toContain('Authentication preflight failed');

      // No new plan/<NNN>_<hash>/ session dir created (gate aborted before
      // PRPPipeline / any session work).
      const after = existsSync(planDir)
        ? new Set(readdirSync(planDir).filter(s => sessRe.test(s)))
        : new Set<string>();
      expect([...after].sort()).toEqual([...before].sort());

      rmSync(tmpAgentDir, { recursive: true, force: true });
    });

    // CONTROL: the reasoning gate sits AFTER the credential-free early returns
    // (--dry-run / --validate-prd). So a --dry-run with an invalid reasoning env
    // still exits 0 — the gate is never reached. (PRD §9.2.9 scopes the gate to
    // agent-creating paths.) NO ZAI_API_KEY here (not needed — dry-run returns
    // before runAuthPreflight, which precedes the reasoning gate).
    it('CONTROL: --dry-run with an invalid reasoning env still exits 0 (gate is after the credential-free early returns)', () => {
      const tmpAgentDir = mkdtempSync(join(tmpdir(), 'reasoning-spawn-'));
      const prdAbs = resolve(process.cwd(), 'spec/SPEC.md');
      const env = {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        USER: process.env.USER,
        SHELL: process.env.SHELL,
        PI_CODING_AGENT_DIR: tmpAgentDir, // empty temp dir — NO creds
        PRP_REASONING_AGENT: 'ultra', // invalid, but dry-run returns before the gate
      };

      const res = spawnSync(
        process.execPath,
        [CLI, '--prd', prdAbs, '--dry-run'],
        {
          encoding: 'utf8',
          timeout: 20_000,
          env,
        }
      );

      // EXIT 0 — credential-free early return (dry-run) precedes the gate.
      expect(res.status).toBe(0);
      // Dry-run banner on STDOUT (pino-pretty → stdout).
      expect(res.stdout).toContain('DRY RUN');
      // CRITICAL: proves neither the auth preflight NOR the reasoning gate ran.
      expect(res.stderr).not.toContain('Authentication preflight failed');
      expect(res.stderr).not.toContain('Invalid reasoning level');

      rmSync(tmpAgentDir, { recursive: true, force: true });
    });
  }
);
