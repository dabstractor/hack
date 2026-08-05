/**
 * Integration tests: subcommands resolve `plan/`/`PRD.md` at the repo root (PRD §9.8.7/§9.8.9).
 *
 * @remarks
 * This is the P1.M1.T2.S1 suite that closes the integration-test gap which let BUG-001 ship. BUG-001
 * was a TIMING bug: the 6 subcommand `.action()` handlers ran INSIDE `program.parse()` — before
 * `main()`'s `process.chdir(repoRoot)` — so they resolved `plan/`/`PRD.md` against INVOCATION_CWD.
 * S2's fix is a single `program.hook('preAction', …)` that bootstraps repo-root resolution + chdir
 * before ANY action handler. This suite PROVES the fix end-to-end via real subprocess invocations
 * (the only faithful way to reproduce the action-handler timing).
 *
 * Three groups (all subprocess-based — hermetic; no in-process `parseCLIArgs` / singleton leakage):
 * - **Group A** (§9.8.7/§9.8.9): each of the 6 subcommands (`task`, `status`, `inspect`, `artifacts`,
 *   `cache`, `validate-state`) from a NESTED subdir resolves `plan/`/`PRD.md` at the repo root.
 * - **Group B** (§9.8.5): `task`/`status`/`validate-state` (representative — the hook fires for ALL)
 *   from OUTSIDE any repo exit 1 with the clean `No .git entry found` message (the dedicated
 *   `NotARepositoryError` arm), NOT `No sessions found` (the action never ran) and NOT a stack trace.
 * - **Group C** (§5.3): `hack status` from a subdir during breakdown-in-progress (session dir exists,
 *   no `tasks.json`) prints the calm notice, not the scary `No sessions found`.
 *
 * §9.8.9 criteria f/g/h/i (`--repo-root` + explicit/default `--prd` semantics) are owned by S2's
 * `tests/integration/cli/repo-root-semantics.test.ts` and are NOT duplicated here.
 *
 * @see {@link ../../../src/cli/index.ts} — taskAction (`Using main tasks`/§5.3 notice) + the preAction hook
 * @see {@link ../../../src/index.ts} — main().catch() NotARepositoryError dedicated arm
 */

import { describe, it, expect } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

// =============================================================================
// Hermetic harness — MIRRORS tests/integration/repo-root-acceptance.test.ts verbatim.
// LOCAL tsx binary + ABSOLUTE src/index.ts path (NOT global `npx tsx` — flaky/online).
// =============================================================================

const tsxBin = resolve(process.cwd(), 'node_modules', '.bin', 'tsx');
const absIndex = resolve(process.cwd(), 'src/index.ts');

/**
 * Run the CLI as a real subprocess with a controlled cwd. Returns exit status + streams.
 * Each spawnSync is a FRESH process → no module-singleton leakage, no `_resetBootstrap()`.
 */
const runCli = (
  args: string[],
  cwd: string
): { status: number | null; stdout: string; stderr: string } => {
  const r = spawnSync(tsxBin, [absIndex, ...args], { cwd, encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
};

/**
 * Create a real git repo tmpdir (`git init`). Returns the tmp path. Caller cleans up.
 */
const makeRepo = (): string => {
  const repo = mkdtempSync(join(tmpdir(), 'subcmd-repo-'));
  const r = spawnSync('git', ['init', '-q', repo]);
  if (r.status !== 0) {
    rmSync(repo, { recursive: true, force: true });
    throw new Error(
      `git init failed: ${r.stderr ?? 'unknown error'} (is git installed?)`
    );
  }
  return repo;
};

// A discoverable session dir (dir-NAME-based discovery: `NNN_<12hex>` is enough — no .prd_hash needed).
const SESSION_DIR = '001_abcdef123456';

/**
 * Fixture: a discoverable session dir at the repo root + a minimal valid `tasks.json`
 * (`{ "backlog": [] }` — taskAction does JSON.parse + iterate; NO Zod in that path) + a
 * `prd_snapshot.md` (read by inspect/artifacts/cache/validate-state) + a root `PRD.md`.
 * `withTasksJson=false` produces the §5.3 breakdown-in-progress state (dir present, no tasks.json).
 */
const makeSessionFixture = (repo: string, withTasksJson = true): void => {
  mkdirSync(join(repo, 'plan', SESSION_DIR), { recursive: true });
  if (withTasksJson) {
    writeFileSync(
      join(repo, 'plan', SESSION_DIR, 'tasks.json'),
      '{"backlog":[]}'
    );
  }
  // inspect/artifacts/cache/validate-state read prd_snapshot.md after finding the session.
  writeFileSync(
    join(repo, 'plan', SESSION_DIR, 'prd_snapshot.md'),
    '# Test PRD\n'
  );
  writeFileSync(join(repo, 'PRD.md'), '# Test PRD\n');
};

// =============================================================================
// Group A — §9.8.7/§9.8.9: subcommands from a NESTED subdir resolve at the repo root.
// Pre-fix (BUG-001): these resolved against the subdir (plan/PRD.md missing → No sessions found /
// subdir-path PRD error). Post-hook: the preAction chdir makes them resolve at the repo root.
// =============================================================================

describe('§9.8.7/§9.8.9 — subcommands from a nested subdir resolve at the repo root', () => {
  // Shared nested invocation dir (deeply nested — a strong contrapositive proof).
  const nestedSubdir = (repo: string): string => {
    const nested = join(repo, 'src', 'deep', 'nested');
    mkdirSync(nested, { recursive: true });
    return nested;
  };

  it('task (list) resolves the repo-root session', () => {
    const repo = makeRepo();
    makeSessionFixture(repo);
    try {
      const { status, stderr } = runCli(['task'], nestedSubdir(repo));

      expect(status).toBe(0);
      expect(stderr).toContain('Using main tasks'); // only printed when plan/<session>/tasks.json was found
      expect(stderr).toContain(SESSION_DIR); // the repo-root session id
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it('status resolves the repo-root session', () => {
    const repo = makeRepo();
    makeSessionFixture(repo);
    try {
      const { status, stderr } = runCli(['status'], nestedSubdir(repo));

      // The strongest repo-root-resolution proof: taskAction found the repo-root tasks.json
      // (printed `Using main tasks: 001_abcdef123456/tasks.json` to stderr). `hack status` with an
      // empty backlog runs the default-list branch (prints nothing to stdout), so `Using main
      // tasks` on stderr + exit 0 is the reliable signal that plan/ resolved at the repo root.
      expect(status).toBe(0);
      expect(stderr).toContain('Using main tasks'); // taskAction found the repo-root tasks.json
      expect(stderr).toContain(SESSION_DIR); // the repo-root session id
      expect(stderr).not.toContain('No sessions found'); // NOT the pre-fix subdir-resolution path
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it('inspect finds the repo-root session (not No sessions found)', () => {
    const repo = makeRepo();
    makeSessionFixture(repo);
    try {
      const { status, stdout, stderr } = runCli(
        ['inspect'],
        nestedSubdir(repo)
      );
      const combined = stdout + stderr;

      // inspect found the repo-root session (printed its id) — the strongest repo-root-resolution proof.
      expect(combined).toContain(SESSION_DIR);
      // Contrapositive: pre-fix the action ran against the subdir → 'No sessions found'.
      expect(combined).not.toContain('No sessions found');
      expect(status).not.toBe(1); // not a hard failure (inspect prints + exits 0 on a found session)
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it('artifacts operates against the repo-root session (not No sessions found)', () => {
    const repo = makeRepo();
    makeSessionFixture(repo);
    try {
      const { status, stdout, stderr } = runCli(
        ['artifacts'],
        nestedSubdir(repo)
      );
      const combined = stdout + stderr;

      // The session was found at the repo root (pre-fix: 'No sessions found' against the subdir).
      expect(combined).not.toContain('No sessions found');
      // Don't over-couple to artifacts' per-command success output; the absence of the bug signature
      // + the fact it didn't throw 'No sessions found' is the repo-root-resolution proof.
      expect(status).not.toBe(1);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it('cache operates against the repo-root plan/', () => {
    const repo = makeRepo();
    makeSessionFixture(repo);
    try {
      const { status, stdout, stderr } = runCli(['cache'], nestedSubdir(repo));
      const combined = stdout + stderr;

      // cache found the repo-root session + operated against repo-root plan/ (stats rendered).
      expect(combined).not.toContain('No session found');
      expect(combined).not.toContain('No sessions found');
      expect(status).toBe(0); // default stats against a repo-root plan/ succeeds
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it('validate-state resolves the PRD at the repo root (not the subdir)', () => {
    const repo = makeRepo();
    makeSessionFixture(repo);
    const nested = nestedSubdir(repo);
    try {
      const { status, stdout, stderr } = runCli(['validate-state'], nested);
      const combined = stdout + stderr;

      // Contrapositive — the pre-fix BUG-001 signature: validate-state ran against the subdir, so the
      // PRD-existence check failed against <nested>/PRD.md. Post-hook the PRD resolves at repoRoot.
      expect(combined).not.toContain('Failed to validate PRD exists at');
      expect(combined).not.toContain(nested); // no subdir path leaked into the PRD-resolution error
      expect(combined).not.toContain('No sessions found'); // the repo-root session was found
      // validate-state ran against the repo root (found the session + PRD); exit reflects validation,
      // not a missing-PRD crash.
      expect(status).not.toBe(1);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

// =============================================================================
// Group B — §9.8.5: subcommands OUTSIDE any repo exit 1 with the clean NotARepositoryError message.
// The preAction hook throws BEFORE the action body → propagates to main().catch()'s dedicated arm
// (index.ts) → ONE clean ❌ line + exit 1. Pre-fix the action ran against INVOCATION_CWD → 'No sessions
// found'. Post-hook it must be 'No .git entry found' (NOT 'No sessions found', NOT a stack trace).
// =============================================================================

describe('§9.8.5 — subcommands outside any repo exit 1 with the clean message', () => {
  const makeNonRepo = (): string => {
    const nonRepo = mkdtempSync(join(tmpdir(), 'subcmd-norepo-'));
    // Sanity: no .git at the non-repo dir (OS tmp has no .git ancestor in practice).
    expect(existsSync(join(nonRepo, '.git'))).toBe(false);
    return nonRepo;
  };

  // Shared assertion set for the representative subcommands (the hook fires for ALL of them).
  const assertCleanNoRepoError = (args: string[], nonRepo: string): void => {
    const { status, stderr } = runCli(args, nonRepo);

    expect(status).toBe(1);
    expect(stderr).toContain('No .git entry found'); // the dedicated arm, not the action's catch
    expect(stderr).toContain(nonRepo); // searchedFrom named
    expect(stderr).toContain('--repo-root'); // remediation
    expect(stderr).not.toContain('No sessions found'); // the action never ran
    expect(stderr).not.toContain('No session found'); // (cache uses the singular form)
    expect(stderr).not.toMatch(/^\s*at /m); // no stack trace (one clean line)
  };

  it('hack task outside any repo', () => {
    const nonRepo = makeNonRepo();
    try {
      assertCleanNoRepoError(['task'], nonRepo);
    } finally {
      rmSync(nonRepo, { recursive: true, force: true });
    }
  });

  it('hack status outside any repo', () => {
    const nonRepo = makeNonRepo();
    try {
      assertCleanNoRepoError(['status'], nonRepo);
    } finally {
      rmSync(nonRepo, { recursive: true, force: true });
    }
  });

  it('hack validate-state outside any repo', () => {
    const nonRepo = makeNonRepo();
    try {
      assertCleanNoRepoError(['validate-state'], nonRepo);
    } finally {
      rmSync(nonRepo, { recursive: true, force: true });
    }
  });
});

// =============================================================================
// Group C — §5.3: breakdown-in-progress calm notice works from a subdir.
// A session DIR exists but NO tasks.json → taskAction prints the calm notice (exit 0), NOT the scary
// 'No sessions found'. Pre-fix (BUG-001) this printed 'No sessions found' because plan/ resolved to
// the subdir. Post-hook plan/ resolves at repoRoot → the session dir is found → the §5.3 notice fires.
// =============================================================================

describe('§5.3 — breakdown-in-progress calm notice works from a subdir', () => {
  it('hack status from a subdir during breakdown prints the calm notice, not No sessions found', () => {
    const repo = makeRepo();
    makeSessionFixture(repo, false); // session DIR exists, NO tasks.json
    const nested = join(repo, 'src', 'deep', 'nested');
    mkdirSync(nested, { recursive: true });
    try {
      const { status, stderr } = runCli(['status'], nested);

      expect(status).toBe(0); // calm notice exits 0
      expect(stderr).toContain('tasks.json is generated during PRD breakdown'); // the §5.3 calm notice
      expect(stderr).not.toContain('No sessions found'); // NOT the scary pre-fix path
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
