/**
 * BUG-002 config-error rendering — clean ❌ arms (PRD §9.7.6/§9.7.7/§9.2.7).
 *
 * @remarks
 * P1.M2.T2.S2 — the RENDERING tests for BUG-002 (Minor). The `.hack` validation messages were always
 * correct; the bug was that `HackConfigError` rendered through the DEFAULT `main().catch()` arm
 * (`console.error('\n❌ Fatal error in main():', error)`) — appending a stack trace into
 * `hack-config.js` internals. P1.M2.T2.S1 added two dedicated clean arms (`\n❌ ${error.message}` +
 * exit 1, no stack); P1.M2.T1.S1 defined `HackConfigError` + converted the 9 throw sites.
 *
 * THIS FILE proves the clean arms fire end-to-end via subprocess (`spawnSync tsx + src/index.ts`)
 * for each error class the contract names: (a) a range error, (b) a secrets error, (b′) a BOM error,
 * plus (c) a `NotARepositoryError` contrast case (regression guard that the S1 arms did not shadow
 * the existing clean arm). Each case asserts exit 1 + a single `❌ <message>` line + NO `/\n\s*at /`
 * stack frames + NO `Fatal error in main()` default-arm preamble.
 *
 * End-to-end is the only faithful level: `main()` is NOT exported and `index.ts` auto-runs
 * `void main().catch(...)` — the clean-arm rendering is a PROCESS-level property (which
 * `console.error` form fired, what reached stderr, the exit code) that must be verified via
 * subprocess. This mirrors `repo-root-acceptance.test.ts` (case d) + `auth-preflight.test.ts`
 * (acceptance a).
 *
 * DISJOINT from `tests/unit/config/hack-config.test.ts` (validation LOGIC, in-process `toThrow`) —
 * this file owns the RENDERING layer end-to-end (subprocess, no stack).
 *
 * @see {@link ../../../src/index.ts} main().catch() clean arms (P1.M2.T2.S1)
 * @see {@link ../../../src/config/hack-config.ts} the HackConfigError throw sites (P1.M2.T1.S1)
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

// --- hermetic subprocess invocation (PRP gotcha: LOCAL tsx binary + ABSOLUTE script path) ---
// Use tsx + src/index.ts (NO build needed); do NOT copy the auth-preflight dist/index.js variant.
const tsxBin = resolve(process.cwd(), 'node_modules', '.bin', 'tsx');
const absIndex = resolve(process.cwd(), 'src/index.ts');

/**
 * Run the CLI as a real subprocess with a controlled cwd. Returns exit status + streams.
 * Includes a 30s timeout (tsx cold-start + git init + full module load can take a few seconds).
 */
const runCli = (
  args: string[],
  cwd: string
): { status: number | null; stdout: string; stderr: string } => {
  const result = spawnSync(tsxBin, [absIndex, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 30_000,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
};

/**
 * Create a real git repo tmpdir (`git init -q`). Returns the tmp path. Caller cleans up via rmSync
 * in a finally block.
 */
const makeRepo = (prefix: string): string => {
  const repo = mkdtempSync(join(tmpdir(), prefix));
  const r = spawnSync('git', ['init', '-q', repo]);
  if (r.status !== 0) {
    rmSync(repo, { recursive: true, force: true });
    throw new Error(
      `git init failed: ${r.stderr ?? 'unknown error'} (is git installed?)`
    );
  }
  return repo;
};

/**
 * Shared BUG-002 contract: exit 1 + a single `❌` line + the message substrings + NO Node stack
 * frames + NO default-arm preamble. Encodes that a CLEAN arm fired (not the default arm's two-arg
 * dump of stack trace + `Fatal error in main():` preamble).
 */
const assertCleanRender = (
  result: { status: number | null; stderr: string },
  ...messageSubstrings: string[]
): void => {
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('❌');
  for (const sub of messageSubstrings) {
    expect(result.stderr).toContain(sub);
  }
  // A CLEAN arm fired — NOT the default arm's two-arg dump (stack trace + 'Fatal error in main():' preamble).
  expect(result.stderr).not.toMatch(/\n\s*at /); // no Node stack frames
  expect(result.stderr).not.toContain('Fatal error in main()'); // not the default-arm preamble
};

describe('BUG-002 config-error rendering — clean ❌ arms (PRD §9.7.6/§9.7.7/§9.2.7)', () => {
  it('(a) a [tasks_lock] poll_ms range error renders as a single ❌ line, no stack trace', () => {
    // SETUP — a real repo + PRD.md (required: --prd defaults to './PRD.md' and parseCLIArgs
    // existsSync-checks it BEFORE main() reaches loadHackConfig — the "existsSync trap").
    // loadHackConfig throws BEFORE the --dry-run early-return (main() order: parseCLIArgs →
    // loadHackConfig → configureEnvironment → dryRun early-return).
    const repo = makeRepo('cfg-range-');
    try {
      writeFileSync(join(repo, 'PRD.md'), '# Minimal PRD\n');
      writeFileSync(join(repo, '.hack'), '[tasks_lock]\npoll_ms = -5\n');

      // EXECUTE — loadHackConfig throws a HackConfigError (range) → main().catch() clean arm.
      const result = runCli(['--dry-run'], repo);

      // VERIFY — exit 1 + ❌ + range message substrings, NO stack, NO default preamble.
      assertCleanRender(result, 'poll_ms', 'out of range');
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it('(b) a [auth] secrets error renders as a single ❌ line, no stack trace', () => {
    // SETUP — a non-empty secret value in a COMMITTABLE tier (.hack, not .hack.local) is a HARD
    // error (§9.7.6). The secret VALUE is never echoed (the secrets check fires on the KEY NAME
    // first — hack-config.ts:744-747) → assert on the key name `zai_api_key`, NOT the value.
    const repo = makeRepo('cfg-secret-');
    try {
      writeFileSync(join(repo, 'PRD.md'), '# Minimal PRD\n');
      writeFileSync(
        join(repo, '.hack'),
        '[auth]\nzai_api_key = "sk-live-DO-NOT-COMMIT"\n'
      );

      // EXECUTE
      const result = runCli(['--dry-run'], repo);

      // VERIFY — `Secret-bearing key [auth] zai_api_key ...` contains both substrings.
      assertCleanRender(result, 'Secret', 'zai_api_key');
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("(b') a UTF-8 BOM renders as a single ❌ line, no stack trace", () => {
    // SETUP — raw BOM bytes (0xEF 0xBB 0xBF) + otherwise-valid TOML. A utf8 STRING re-encodes the
    // BOM away (hack-config.test.ts:77-78) — must write via Buffer.concat.
    const repo = makeRepo('cfg-bom-');
    try {
      writeFileSync(join(repo, 'PRD.md'), '# Minimal PRD\n');
      writeFileSync(
        join(repo, '.hack'),
        Buffer.concat([
          Buffer.from([0xef, 0xbb, 0xbf]),
          Buffer.from('[tasks_lock]\npoll_ms = 100\n'),
        ])
      );

      // EXECUTE — parseHackFile detects the BOM signature → HackConfigError → clean arm.
      const result = runCli(['--dry-run'], repo);

      // VERIFY
      assertCleanRender(result, 'BOM');
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it('(c) a NotARepositoryError still renders cleanly (S1 arms do not shadow it)', () => {
    // SETUP — a tmpdir with NO .git ancestor. The preAction hook throws NotARepositoryError BEFORE
    // parseCLIArgs' PRD-existence check — so no PRD.md is needed here. REGRESSION GUARD: S1's two
    // new arms (inserted before the default, not before the NotARepositoryError arm) must not
    // shadow the existing NotARepositoryError clean arm.
    const nonRepo = mkdtempSync(join(tmpdir(), 'cfg-norepo-'));
    try {
      // EXECUTE
      const result = runCli(['--dry-run'], nonRepo);

      // VERIFY — existing arm still fires (clean render, no stack).
      assertCleanRender(result, 'No .git entry found');
    } finally {
      rmSync(nonRepo, { recursive: true, force: true });
    }
  });
});
