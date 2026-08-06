/**
 * Acceptance tests for PRD §9.7.10 (`.hack` configuration — Acceptance Criteria).
 *
 * @remarks
 * This is the P2.M2.T3.S1 acceptance sweep — the machine-checked Definition of
 * Done for the `.hack` feature (Phase P2). It proves all NINE §9.7.10 criteria
 * end-to-end across the config subsystem (loader + validator + repo-root
 * resolution + CLI), complementing (NOT duplicating) the unit suites:
 * - `tests/unit/config/hack-config.test.ts` (P2.M1 — loader/validator/secrets)
 * - `tests/unit/cli/commands/config.test.ts` (P2.M2.T2.S1 — command unit tests)
 *
 * Two layers:
 * - **Layer A** — direct subsystem calls (`loadHackConfig`, `ConfigCommand`,
 *   `resolveRepositoryRoot`) on REAL `git init` tmpdirs (the gold template from
 *   `tests/integration/repo-root-acceptance.test.ts`).
 * - **Layer B** — subprocess `hack config init` via the real CLI (proves the
 *   real CLI path writes `.gitignore`).
 *
 * Hermetic env: `beforeEach` deletes the config-seeded env vars (the ambient
 * shell / `tests/setup.ts`-loaded `.env` may export them); `afterEach` relies on
 * the global `vi.unstubAllEnvs()` (called by `tests/setup.ts`) plus an explicit
 * env-var delete to undo non-stub edits.
 *
 * @see {@link ../../../src/config/hack-config.ts}
 * @see {@link ../../../src/cli/commands/config.ts}
 * @see {@link ../../../src/utils/repo-root.ts}
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  realpathSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  loadHackConfig,
  SCHEMA_MAP,
  _resetValidationWarnings,
} from '../../../src/config/hack-config.js';
import { resolveRepositoryRoot } from '../../../src/utils/repo-root.js';
import {
  ConfigCommand,
  type ConfigOptions,
} from '../../../src/cli/commands/config.js';

// --- hermetic subprocess invocation (verbatim pattern from repo-root-acceptance.test.ts) ---
const tsxBin = resolve(process.cwd(), 'node_modules', '.bin', 'tsx');
const absIndex = resolve(process.cwd(), 'src/index.ts');

/** Run the CLI as a real subprocess with a controlled cwd. */
const runCli = (
  args: string[],
  cwd: string
): { status: number | null; stdout: string; stderr: string } => {
  const result = spawnSync(tsxBin, [absIndex, ...args], {
    cwd,
    encoding: 'utf8',
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
};

/** Create a real git repo tmpdir (`git init`). Caller cleans up. */
const makeRepo = (): string => {
  const repo = mkdtempSync(join(tmpdir(), 'hack-acceptance-'));
  const r = spawnSync('git', ['init', '-q', repo]);
  if (r.status !== 0) {
    rmSync(repo, { recursive: true, force: true });
    throw new Error(
      `git init failed: ${r.stderr ?? 'unknown error'} (is git installed?)`
    );
  }
  return repo;
};

/** Default ConfigCommand options (all flags off, table output). */
const DEFAULT_OPTIONS: ConfigOptions = {
  output: 'table',
  force: false,
  src: false,
  global: false,
  local: false,
};

/** Env vars seeded by `.hack` config (must be clean for hermetic assertions). */
const SEEDED_ENV = [
  'PARALLEL_RESEARCH',
  'PRP_MODEL_BALANCED',
  'PRP_MODEL_HIGH',
  'PRP_MODEL_FAST',
  'PRP_API_KEY',
  'PRP_AGENT_HARNESS',
  'HACKY_LOG_LEVEL',
  'RESEARCH_DEPTH',
  'PRP_API_BASE_URL',
];

describe('§9.7.10 acceptance — `.hack` configuration', () => {
  beforeEach(() => {
    for (const k of SEEDED_ENV) delete process.env[k];
    _resetValidationWarnings();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // ==========================================================================
  // Criterion 1 — committable .hack applies, bare, from any subdir.
  // ==========================================================================
  it('crit 1: a committable .hack seeds process.env + merged [cli] from a nested cwd (bare)', () => {
    const repo = makeRepo();
    try {
      writeFileSync(
        join(repo, '.hack'),
        '[cli]\nmode = "bug-hunt"\n' +
          '[pipeline]\nparallel_research = true\n' +
          '[models]\nbalanced = "glm-5.2"\n'
      );
      const nested = join(repo, 'src', 'deep', 'nested');
      mkdirSync(nested, { recursive: true });

      // EXECUTE — resolve the repo root from the nested cwd, then load .hack.
      const { repoRoot } = resolveRepositoryRoot(nested);
      const merged = loadHackConfig(repoRoot);

      // VERIFY — env-seeded (no env/flags passed), merged [cli] carried.
      expect(process.env.PARALLEL_RESEARCH).toBe('true');
      expect(process.env.PRP_MODEL_BALANCED).toBe('glm-5.2');
      expect(merged.cli?.mode).toBe('bug-hunt');
      expect(merged._sources['cli.mode']).toBe('project');
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  // ==========================================================================
  // Criterion 2 — init writes commented .hack + gitignores .hack.local + refuses clobber.
  // ==========================================================================
  describe('crit 2: hack config init (commented .hack + gitignore + clobber guard)', () => {
    /** Capture console output for the duration of `fn`. The caller is responsible
     *  for stubbing `process.exit` (via vi.spyOn) when it needs to assert exit
     *  codes — capture() deliberately does NOT install an exit spy so callers can
     *  use their own recording stub. */
    async function capture(fn: () => Promise<void>): Promise<{
      stdout: string;
      stderr: string;
    }> {
      let stdout = '';
      let stderr = '';
      const logSpy = vi
        .spyOn(console, 'log')
        .mockImplementation((...a) => (stdout += a.join(' ') + '\n'));
      const errSpy = vi
        .spyOn(console, 'error')
        .mockImplementation((...a) => (stderr += a.join(' ') + '\n'));
      const warnSpy = vi
        .spyOn(console, 'warn')
        .mockImplementation((...a) => (stderr += a.join(' ') + '\n'));
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      try {
        await fn();
      } finally {
        logSpy.mockRestore();
        errSpy.mockRestore();
        warnSpy.mockRestore();
        infoSpy.mockRestore();
      }
      return { stdout, stderr };
    }

    it('Layer A: ConfigCommand init writes all sections + commented .gitignore block near # Environment files', async () => {
      const repo = makeRepo();
      try {
        // Pre-seed a .gitignore with an # Environment files section (the repo's shape).
        writeFileSync(
          join(repo, '.gitignore'),
          'node_modules\n\n# Environment files\n.env\n.env.local\n'
        );

        await capture(async () => {
          await new ConfigCommand(repo).execute('init', { ...DEFAULT_OPTIONS });
        });

        // VERIFY — .hack exists with the schema sections.
        const dotHack = readFileSync(join(repo, '.hack'), 'utf8');
        for (const section of ['harness', 'models', 'pipeline', 'cli']) {
          expect(dotHack).toContain(`[${section}]`);
        }

        // VERIFY — .gitignore: block placed AFTER the # Environment files header,
        // with the comment line immediately preceding .hack.local.
        const gi = readFileSync(join(repo, '.gitignore'), 'utf8');
        const envIdx = gi.indexOf('# Environment files');
        const commentIdx = gi.indexOf('# .hack local overrides (never commit)');
        const lineIdx = gi.indexOf('.hack.local');
        expect(commentIdx).toBeGreaterThan(envIdx);
        expect(lineIdx).toBeGreaterThan(commentIdx);
        // The comment is the immediate predecessor of the .hack.local line.
        expect(gi.slice(commentIdx, lineIdx).trim()).toBe(
          '# .hack local overrides (never commit)'
        );
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    });

    it('Layer A: init refuses to clobber without --force, overwrites with --force', async () => {
      const repo = makeRepo();
      try {
        writeFileSync(join(repo, '.hack'), 'OLD\n');
        let exitCalls: number[] = [];
        const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((
          code?: number
        ) => {
          exitCalls.push(code ?? 0);
        }) as never);
        try {
          await capture(async () => {
            await new ConfigCommand(repo).execute('init', {
              ...DEFAULT_OPTIONS,
            });
          });
          // Clobber refused (exit 1 recorded); file untouched.
          expect(exitCalls).toContain(1);
          expect(readFileSync(join(repo, '.hack'), 'utf8')).toBe('OLD\n');
        } finally {
          exitSpy.mockRestore();
        }

        // With --force, the file is overwritten.
        exitCalls = [];
        const exitSpy2 = vi.spyOn(process, 'exit').mockImplementation(((
          code?: number
        ) => {
          exitCalls.push(code ?? 0);
        }) as never);
        try {
          await capture(async () => {
            await new ConfigCommand(repo).execute('init', {
              ...DEFAULT_OPTIONS,
              force: true,
            });
          });
        } finally {
          exitSpy2.mockRestore();
        }
        const content = readFileSync(join(repo, '.hack'), 'utf8');
        expect(content).not.toContain('OLD');
        expect(content).toContain('# <repoRoot>/.hack');
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    });

    it('idempotent: repeated init does not duplicate the .hack.local line', async () => {
      const repo = makeRepo();
      try {
        await capture(async () => {
          await new ConfigCommand(repo).execute('init', { ...DEFAULT_OPTIONS });
          await new ConfigCommand(repo).execute('init', {
            ...DEFAULT_OPTIONS,
            force: true,
          });
        });
        const gi = readFileSync(join(repo, '.gitignore'), 'utf8');
        const matches = gi.split('\n').filter(l => l.trim() === '.hack.local');
        expect(matches).toHaveLength(1);
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    });

    it('gitignore branches: create-if-absent + append-when-no-env-section', async () => {
      const repo = makeRepo();
      try {
        // (a) no .gitignore → created with just the block.
        await capture(async () => {
          await new ConfigCommand(repo).execute('init', { ...DEFAULT_OPTIONS });
        });
        let gi = readFileSync(join(repo, '.gitignore'), 'utf8');
        expect(gi).toContain('.hack.local');
        expect(gi).toContain('# .hack local overrides (never commit)');

        // (b) a .gitignore with NO # Environment files section → block appended.
        rmSync(join(repo, '.gitignore'), { force: true });
        writeFileSync(join(repo, '.gitignore'), 'node_modules\n');
        await capture(async () => {
          await new ConfigCommand(repo).execute('init', {
            ...DEFAULT_OPTIONS,
            force: true,
          });
        });
        gi = readFileSync(join(repo, '.gitignore'), 'utf8');
        expect(gi).toContain('node_modules');
        expect(gi).toContain('.hack.local');
        // No env section present → block appended (not inserted mid-file before env header).
        expect(gi.indexOf('# Environment files')).toBe(-1);
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    });

    it('gitignore dedup-wins-over-placement: a bare pre-existing .hack.local line is left untouched', async () => {
      const repo = makeRepo();
      try {
        // A prior T2.S1-style bare line (no comment) already present.
        writeFileSync(join(repo, '.gitignore'), 'node_modules\n.hack.local\n');
        await capture(async () => {
          await new ConfigCommand(repo).execute('init', { ...DEFAULT_OPTIONS });
        });
        const gi = readFileSync(join(repo, '.gitignore'), 'utf8');
        // Dedup wins: the file is unchanged (no comment added, still one line).
        const matches = gi.split('\n').filter(l => l.trim() === '.hack.local');
        expect(matches).toHaveLength(1);
        expect(gi).not.toContain('# .hack local overrides (never commit)');
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    });

    it('Layer B: subprocess `hack config init` writes .hack + the .gitignore block (exit 0)', () => {
      const repo = makeRepo();
      try {
        const { status, stdout } = runCli(['config', 'init'], repo);
        expect(status).toBe(0);
        expect(existsSync(join(repo, '.hack'))).toBe(true);
        const gi = readFileSync(join(repo, '.gitignore'), 'utf8');
        expect(gi).toContain('.hack.local');
        expect(stdout).toContain('Wrote');
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    });
  });

  // ==========================================================================
  // Criterion 3 — show --src prints every tunable + winning layer.
  // ==========================================================================
  it('crit 3: show --src prints every SCHEMA_MAP key + the winning layer per key', async () => {
    const repo = makeRepo();
    let exitSpy: ReturnType<typeof vi.spyOn> | undefined;
    try {
      writeFileSync(
        join(repo, '.hack'),
        '[harness]\nname = "claude-code"\n[pipeline]\nresearch_depth = 5\n'
      );
      writeFileSync(join(repo, '.hack.local'), '[cli]\nlog_level = "debug"\n');

      let stdout = '';
      const logSpy = vi
        .spyOn(console, 'log')
        .mockImplementation((...a) => (stdout += a.join(' ') + '\n'));
      const errSpy = vi
        .spyOn(console, 'error')
        .mockImplementation((...a) => (stdout += a.join(' ') + '\n'));
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      exitSpy = vi
        .spyOn(process, 'exit')
        .mockImplementation((() => {}) as never);
      try {
        await new ConfigCommand(repo).execute('show', {
          ...DEFAULT_OPTIONS,
          src: true,
        });
      } finally {
        logSpy.mockRestore();
        errSpy.mockRestore();
        warnSpy.mockRestore();
        infoSpy.mockRestore();
        exitSpy?.mockRestore();
      }

      // VERIFY — every SCHEMA_MAP `${section}.${key}` appears in stdout.
      for (const e of SCHEMA_MAP) {
        expect(stdout).toContain(`${e.section}.${e.key}`);
      }
      // Source attribution: harness.name → project; cli.log_level → project-local;
      // a default key (e.g. pipeline.issue_retry_max, unset) → default.
      expect(stdout).toContain('claude-code');
      expect(stdout).toContain('debug');
      expect(stdout.toLowerCase()).toContain('project-local');
      expect(stdout.toLowerCase()).toContain('default');
      // No [auth] section leaks (show never prints [auth]).
      expect(stdout).not.toMatch(/\bauth\./);
    } finally {
      exitSpy?.mockRestore();
      rmSync(repo, { recursive: true, force: true });
    }
  });

  // ==========================================================================
  // Criterion 4 — zai_api_key refused in .hack / accepted in .hack.local;
  //               override_key seeds PRP_API_KEY.
  // ==========================================================================
  describe('crit 4: secrets policy (refusal / acceptance / override_key→PRP_API_KEY)', () => {
    it('(a) zai_api_key in .hack is a hard error (no value echoed)', () => {
      const repo = makeRepo();
      try {
        writeFileSync(
          join(repo, '.hack'),
          '[auth]\nzai_api_key = "sk-secret-x"\n'
        );
        let msg = '';
        try {
          loadHackConfig(repo);
          throw new Error('expected loadHackConfig to throw');
        } catch (e) {
          msg = e instanceof Error ? e.message : String(e);
        }
        // Names file + key + §9.7.6 + remediation.
        expect(msg).toContain('zai_api_key');
        expect(msg).toMatch(/9\.7\.6/);
        expect(msg).toContain('.hack.local');
        // CRITICAL invariant (crit 9 half): the secret value is NEVER echoed.
        expect(msg).not.toContain('sk-secret-x');
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    });

    it('(b) zai_api_key in .hack.local is accepted (held in merged.auth, not re-seeded)', () => {
      const repo = makeRepo();
      try {
        writeFileSync(
          join(repo, '.hack.local'),
          '[auth]\nzai_api_key = "sk-y"\n'
        );
        const merged = loadHackConfig(repo); // does NOT throw
        expect(merged.auth?.zai_api_key).toBe('sk-y');
        // §9.7.2 non-goal: zai_api_key is NOT re-seeded to any env var.
        expect(process.env.PRP_API_KEY).toBeUndefined();
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    });

    it('(c) override_key in .hack.local seeds PRP_API_KEY (§9.7.6 canonical mapping)', () => {
      const repo = makeRepo();
      try {
        writeFileSync(
          join(repo, '.hack.local'),
          '[auth]\noverride_key = "sk-override"\n'
        );
        delete process.env.PRP_API_KEY;
        loadHackConfig(repo);
        expect(process.env.PRP_API_KEY).toBe('sk-override');
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    });
  });

  // ==========================================================================
  // Criterion 5 — out-of-range / typo aborts before any agent (during LOAD).
  // ==========================================================================
  describe('crit 5: out-of-range / enum aborts load with an actionable message', () => {
    it('(a) poll_ms = -5 is out of range (int > 0)', () => {
      const repo = makeRepo();
      try {
        writeFileSync(join(repo, '.hack'), '[tasks_lock]\npoll_ms = -5\n');
        let msg = '';
        try {
          loadHackConfig(repo);
          throw new Error('expected loadHackConfig to throw');
        } catch (e) {
          msg = e instanceof Error ? e.message : String(e);
        }
        expect(msg).toContain('poll_ms');
        expect(msg).toContain('-5'); // offending value echoed (non-secret)
        expect(msg).toMatch(/\[1,/); // expected range [1, +∞]
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    });

    it('(b) harness name = "foo" is not one of the accepted values', () => {
      const repo = makeRepo();
      try {
        writeFileSync(join(repo, '.hack'), '[harness]\nname = "foo"\n');
        let msg = '';
        try {
          loadHackConfig(repo);
          throw new Error('expected loadHackConfig to throw');
        } catch (e) {
          msg = e instanceof Error ? e.message : String(e);
        }
        expect(msg).toContain('name');
        expect(msg).toContain('foo');
        expect(msg).toContain('pi');
        expect(msg).toContain('claude-code');
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    });
  });

  // ==========================================================================
  // Criterion 6 — unknown key/section → stderr warning + proceeds.
  // ==========================================================================
  it('crit 6: unknown section/key warn to stderr + load proceeds (typo key ignored)', () => {
    const repo = makeRepo();
    try {
      writeFileSync(
        join(repo, '.hack'),
        '[foo]\nx = 1\n[pipeline]\nreseaerch_depth = 9\n'
      );

      let captured = '';
      const warnSpy = vi
        .spyOn(console, 'warn')
        .mockImplementation((...a) => (captured += a.join(' ') + '\n'));
      try {
        const merged = loadHackConfig(repo); // does NOT throw
        // The typo'd key does NOT take effect as the REAL key: research_depth
        // (the correct spelling) remains unset — the typo is not aliased in.
        expect(merged.pipeline?.research_depth).toBeUndefined();
      } finally {
        warnSpy.mockRestore();
      }
      // VERIFY — both unknown-section + unknown-key warnings emitted to stderr.
      expect(captured).toMatch(/unknown section \[foo\]/);
      expect(captured).toMatch(/unknown key \[pipeline\] reseaerch_depth/);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  // ==========================================================================
  // Criterion 7 — env-over-file: PARALLEL_RESEARCH=false beats file true.
  // ==========================================================================
  describe('crit 7: env-over-file (real env wins over .hack value)', () => {
    it('PARALLEL_RESEARCH=false (env) beats [pipeline] parallel_research=true (file)', () => {
      const repo = makeRepo();
      try {
        writeFileSync(
          join(repo, '.hack'),
          '[pipeline]\nparallel_research = true\n'
        );
        vi.stubEnv('PARALLEL_RESEARCH', 'false');
        loadHackConfig(repo);
        // Env wins: the file value (true) did NOT override the exported env (false).
        expect(process.env.PARALLEL_RESEARCH).toBe('false');
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    });

    it('complement: without the env stub, the file value seeds process.env', () => {
      const repo = makeRepo();
      try {
        writeFileSync(
          join(repo, '.hack'),
          '[pipeline]\nparallel_research = true\n'
        );
        delete process.env.PARALLEL_RESEARCH;
        loadHackConfig(repo);
        expect(process.env.PARALLEL_RESEARCH).toBe('true');
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    });
  });

  // ==========================================================================
  // Criterion 8 — subdir resolves the same .hack/.env/PRD.md/plan/ as root (§9.8 joint).
  // ==========================================================================
  it('crit 8: from src/deep/nested/ resolves the same repo-rooted files (§9.8 joint)', () => {
    const repo = makeRepo();
    const originalCwd = process.cwd();
    try {
      writeFileSync(join(repo, '.hack'), '[models]\nbalanced = "glm-5.2"\n');
      writeFileSync(join(repo, '.env'), '# placeholder\n');
      writeFileSync(join(repo, 'PRD.md'), '# PRD\n');
      mkdirSync(join(repo, 'plan'), { recursive: true });

      const nested = join(repo, 'src', 'deep', 'nested');
      mkdirSync(nested, { recursive: true });

      // (a) config load from the nested cwd reads repoRoot/.hack (NOT nested/.hack).
      const { repoRoot } = resolveRepositoryRoot(nested);
      expect(repoRoot).toBe(realpathSync(repo));
      const merged = loadHackConfig(repoRoot);
      expect(merged.models?.balanced).toBe('glm-5.2');

      // (b) default paths resolve against repoRoot after the bootstrap chdir (§9.8.3).
      process.chdir(repoRoot);
      expect(resolve('PRD.md')).toBe(join(repoRoot, 'PRD.md'));
      expect(resolve('plan')).toBe(join(repoRoot, 'plan'));
      expect(resolve('.env')).toBe(join(repoRoot, '.env'));
    } finally {
      process.chdir(originalCwd);
      rmSync(repo, { recursive: true, force: true });
    }
  });

  // ==========================================================================
  // Criterion 9 — no secret value unmasked in show / debug-trace / errors.
  // ==========================================================================
  describe('crit 9: no secret value unmasked (show / debug-trace / errors)', () => {
    it('(a) debug trace masks secret values as "<redacted>"', () => {
      const repo = makeRepo();
      try {
        writeFileSync(
          join(repo, '.hack.local'),
          '[auth]\noverride_key = "sk-trace-marker"\n'
        );
        delete process.env.PRP_API_KEY;
        vi.stubEnv('HACKY_LOG_LEVEL', 'debug');

        let captured = '';
        const warnSpy = vi
          .spyOn(console, 'warn')
          .mockImplementation((...a) => (captured += a.join(' ') + '\n'));
        try {
          loadHackConfig(repo);
        } finally {
          warnSpy.mockRestore();
        }
        // The trace line names the key with a masked value + source layer.
        expect(captured).toMatch(
          /auth\.override_key = "<redacted>" {2}\(source: project-local\)/
        );
        // CRITICAL: the raw secret never appears in the trace.
        expect(captured).not.toContain('sk-trace-marker');
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    });

    it('(b) a secret-refusal error message never echoes the secret value', () => {
      const repo = makeRepo();
      try {
        writeFileSync(
          join(repo, '.hack'),
          '[auth]\nzai_api_key = "sk-secret-x"\n'
        );
        let msg = '';
        try {
          loadHackConfig(repo);
          throw new Error('expected loadHackConfig to throw');
        } catch (e) {
          msg = e instanceof Error ? e.message : String(e);
        }
        expect(msg).not.toContain('sk-secret-x');
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    });

    it('(c) show never prints a raw secret (no [auth] in SCHEMA_MAP)', async () => {
      const repo = makeRepo();
      let exitSpy: ReturnType<typeof vi.spyOn> | undefined;
      try {
        writeFileSync(
          join(repo, '.hack.local'),
          '[auth]\noverride_key = "sk-trace-marker"\n'
        );
        let stdout = '';
        const logSpy = vi
          .spyOn(console, 'log')
          .mockImplementation((...a) => (stdout += a.join(' ') + '\n'));
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
        exitSpy = vi
          .spyOn(process, 'exit')
          .mockImplementation((() => {}) as never);
        try {
          await new ConfigCommand(repo).execute('show', { ...DEFAULT_OPTIONS });
        } finally {
          logSpy.mockRestore();
          errSpy.mockRestore();
          warnSpy.mockRestore();
          infoSpy.mockRestore();
        }
        // show renders only SCHEMA_MAP keys (no [auth]); the secret never leaks.
        expect(stdout).not.toContain('sk-trace-marker');
        expect(stdout).not.toMatch(/\bauth\./);
      } finally {
        exitSpy?.mockRestore();
        rmSync(repo, { recursive: true, force: true });
      }
    });
  });

  // ==========================================================================
  // T3.S1 new config.ts branches — tracked-.hack.local warning (validate).
  // ==========================================================================
  describe('T3.S1: tracked-.hack.local warning (validate, advisory stderr)', () => {
    /**
     * Capture validate output + exit code. process.exit is stubbed to a no-op so
     * the validate action returns without terminating the test process.
     */
    async function runValidate(
      repo: string
    ): Promise<{ stdout: string; stderr: string; exits: number[] }> {
      let stdout = '';
      let stderr = '';
      const exits: number[] = [];
      const logSpy = vi
        .spyOn(console, 'log')
        .mockImplementation((...a) => (stdout += a.join(' ') + '\n'));
      const errSpy = vi
        .spyOn(console, 'error')
        .mockImplementation((...a) => (stderr += a.join(' ') + '\n'));
      const warnSpy = vi
        .spyOn(console, 'warn')
        .mockImplementation((...a) => (stderr += a.join(' ') + '\n'));
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((
        code?: number
      ) => {
        exits.push(code ?? 0);
      }) as never);
      try {
        await new ConfigCommand(repo).execute('validate', {
          ...DEFAULT_OPTIONS,
        });
      } finally {
        logSpy.mockRestore();
        errSpy.mockRestore();
        warnSpy.mockRestore();
        infoSpy.mockRestore();
        exitSpy.mockRestore();
      }
      return { stdout, stderr, exits };
    }

    it('warns (stderr) when .hack.local is tracked by git, exit code unaffected (advisory)', async () => {
      const repo = makeRepo();
      try {
        writeFileSync(
          join(repo, '.hack.local'),
          '[cli]\nlog_level = "debug"\n'
        );
        // Stage .hack.local into the index (tracked, no commit needed).
        const add = spawnSync('git', ['-C', repo, 'add', '.hack.local']);
        expect(add.status).toBe(0);

        const { stderr, exits } = await runValidate(repo);

        // VERIFY — loud stderr WARNING naming the file + remediation.
        expect(stderr).toContain('[hack] WARNING:');
        expect(stderr).toContain('is tracked by git');
        expect(stderr).toContain('git rm --cached .hack.local');
        // Advisory: validate exits 0 when only warnings occurred (no hard errors).
        expect(exits).toContain(0);
        expect(exits).not.toContain(1);
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    });

    it('stays silent when .hack.local is present but UNtracked (no warning)', async () => {
      const repo = makeRepo();
      try {
        writeFileSync(
          join(repo, '.hack.local'),
          '[cli]\nlog_level = "debug"\n'
        );
        // NOT staged → untracked.
        const { stderr, exits } = await runValidate(repo);
        expect(stderr).not.toContain('[hack] WARNING:');
        expect(exits).toContain(0);
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    });

    it('stays silent when .hack.local is absent (no file on disk)', async () => {
      const repo = makeRepo();
      try {
        // No .hack.local on disk at all.
        const { stderr, exits } = await runValidate(repo);
        expect(stderr).not.toContain('[hack] WARNING:');
        expect(exits).toContain(0);
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    });

    it('stays silent in a non-git tmpdir (git ls-files exits non-zero)', async () => {
      // A plain tmpdir with NO .git ancestor — not a git repo.
      const nonRepo = mkdtempSync(join(tmpdir(), 'hack-nongit-'));
      try {
        writeFileSync(join(nonRepo, '.hack.local'), '[cli]\nmode = "normal"\n');
        const { stderr, exits } = await runValidate(nonRepo);
        expect(stderr).not.toContain('[hack] WARNING:');
        expect(exits).toContain(0);
      } finally {
        rmSync(nonRepo, { recursive: true, force: true });
      }
    });
  });
});

// ==========================================================================
// §9.7.5 [cli] prd — the default PRD entry path (subprocess regression).
//
// Guards the TWO defects that together made `[cli] prd` non-functional:
//   (A) the key was absent from SCHEMA_MAP → warned-then-ignored by the loader;
//   (B) main()'s existsSync() guard ran BEFORE .hack was loaded, so the override was
//       never honored. Verified end-to-end via a real subprocess in a throwaway git
//       repo. `--dry-run` returns 0 BEFORE auth/harness/pipeline (no API key, no
//       session), so the only gate it exercises is the PRD existence guard.
// ==========================================================================
describe('§9.7.5 [cli] prd — default PRD entry path (subprocess)', () => {
  it('honors .hack [cli] prd on a bare run; does NOT print "PRD file not found"', () => {
    const repo = makeRepo();
    try {
      // Distributed-PRD layout: spec is pinned via [cli] prd; the default ./PRD.md is ABSENT.
      mkdirSync(join(repo, 'spec'), { recursive: true });
      writeFileSync(join(repo, 'spec', 'SPEC.md'), '# Spec entry doc\n');
      writeFileSync(join(repo, '.hack'), '[cli]\nprd = "spec/SPEC.md"\n');

      // With the bug, the guard ran pre-.hack → "PRD file not found: ./PRD.md" (status 1).
      // The fix loads .hack first, so the guard resolves to <repoRoot>/spec/SPEC.md and passes.
      const { status, stdout, stderr } = runCli(['--dry-run'], repo);

      expect(stderr).not.toContain('PRD file not found');
      expect(status).toBe(0); // dry-run reached its early return → guard passed
      expect(stdout).toContain('spec/SPEC.md'); // effective PRD path = the .hack override
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it('resolves [cli] prd from a NESTED cwd (repo-root-relative, §9.8)', () => {
    const repo = makeRepo();
    try {
      mkdirSync(join(repo, 'spec'), { recursive: true });
      writeFileSync(join(repo, 'spec', 'SPEC.md'), '# Spec\n');
      writeFileSync(join(repo, '.hack'), '[cli]\nprd = "spec/SPEC.md"\n');
      const nested = join(repo, 'src', 'deep');
      mkdirSync(nested, { recursive: true });

      const { status, stderr } = runCli(['--dry-run'], nested);

      expect(stderr).not.toContain('PRD file not found');
      expect(status).toBe(0);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it('still errors "PRD file not found" when no --prd, [cli] prd, or ./PRD.md exists', () => {
    const repo = makeRepo();
    try {
      // No .hack, no ./PRD.md, no --prd → the default './PRD.md' is absent → guard fires.
      const { status, stderr } = runCli(['--dry-run'], repo);

      expect(status).toBe(1);
      expect(stderr).toContain('PRD file not found: ./PRD.md');
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
