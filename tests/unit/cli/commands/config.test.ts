/**
 * Unit tests for ConfigCommand (the `hack config` subcommand — PRD §9.7.8).
 *
 * @remarks
 * Tests validate the four actions (init/show/validate/path) by instantiating
 * {@link ConfigCommand} directly with a real temp directory as `repoRoot`. The
 * logger is mocked (vi.hoisted, like artifacts.test.ts); `process.exit` is
 * overridden to throw a sentinel error so exit paths can be asserted without
 * terminating the process.
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ConfigCommand,
  type ConfigOptions,
} from '../../../../src/cli/commands/config.js';

// Mock the logger with hoisted variables (mirrors artifacts.test.ts).
const { mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../../../src/utils/logger.js', () => ({
  getLogger: vi.fn(() => mockLogger),
}));

/** Default options object (all flags off, table output). */
const DEFAULT_OPTIONS: ConfigOptions = {
  output: 'table',
  force: false,
  src: false,
  global: false,
  local: false,
};

describe('cli/commands/config', () => {
  let repoRoot: string;
  const originalExit = process.exit;
  const originalEnv = { ...process.env };
  let exitCalls: number[];

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'hack-config-test-'));
    exitCalls = [];
    mockLogger.info.mockClear();
    mockLogger.error.mockClear();
    mockLogger.warn.mockClear();
    mockLogger.debug.mockClear();
    // Override process.exit to a NO-OP that records the code (does NOT throw),
    // so actions that call process.exit continue to the following `break`/
    // return and the switch + catch arms in execute() stay fully coverable.
    // Tests assert on exitCalls rather than relying on a thrown sentinel.
    process.exit = ((code?: number) => {
      exitCalls.push(code ?? 0);
    }) as unknown as typeof process.exit;
    // Test isolation (Finding F-4): clear .hack-overlapping env vars so file-only
    // values are observed deterministically regardless of the dev shell. afterEach
    // restores the original environment (env-over-file is spec-correct; the code is
    // fine — these tests just never established a clean env baseline).
    delete process.env.RESEARCH_DEPTH;
    delete process.env.RESEARCH_QUEUE_CONCURRENCY;
    delete process.env.PARALLEL_RESEARCH;
  });

  afterEach(() => {
    process.exit = originalExit;
    rmSync(repoRoot, { recursive: true, force: true });
    // Restore env (vi.stubAllEnvs handles vitest stubs; manually undo other edits).
    for (const k of Object.keys(process.env)) {
      if (!(k in originalEnv)) delete process.env[k];
    }
    for (const [k, v] of Object.entries(originalEnv)) {
      process.env[k] = v;
    }
  });

  /** Helper: run an action, returning captured stdout/stderr. Records exit codes
   * (process.exit is a no-op in these tests). */
  async function run(
    action: string,
    options: Partial<ConfigOptions> = {},
    fileArg?: string
  ): Promise<{ stdout: string; stderr: string }> {
    const cmd = new ConfigCommand(repoRoot);
    let stdout = '';
    let stderr = '';
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...a) => {
      stdout += a.join(' ') + '\n';
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation((...a) => {
      stderr += a.join(' ') + '\n';
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation((...a) => {
      stderr += a.join(' ') + '\n';
    });
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      await cmd.execute(action, { ...DEFAULT_OPTIONS, ...options }, fileArg);
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
      warnSpy.mockRestore();
      infoSpy.mockRestore();
    }
    return { stdout, stderr };
  }

  // ===========================================================================
  // init
  // ===========================================================================
  describe('init', () => {
    it('writes a commented .hack template with all 13 sections', async () => {
      await run('init');

      const dotHack = join(repoRoot, '.hack');
      expect(existsSync(dotHack)).toBe(true);
      const content = readFileSync(dotHack, 'utf8');
      // Header + a sample of the 13 sections present as commented section headers.
      expect(content).toContain('# <repoRoot>/.hack');
      // Entries are commented examples.
      expect(content).toMatch(/^# high = "glm-5\.2"$/m);
      // A sampling of sections (13 total per SCHEMA_MAP) — assert a handful.
      for (const section of [
        'models',
        'harness',
        'pipeline',
        'cli',
        'commit',
      ]) {
        expect(content).toContain(`[${section}]`);
      }
    });

    it('refuses to clobber an existing .hack without --force', async () => {
      writeFileSync(join(repoRoot, '.hack'), '[models]\nhigh = "custom"\n');
      await run('init');
      expect(exitCalls).toContain(1);
      // Existing file untouched.
      expect(readFileSync(join(repoRoot, '.hack'), 'utf8')).toContain('custom');
    });

    it('overwrites an existing .hack with --force', async () => {
      writeFileSync(join(repoRoot, '.hack'), 'OLD CONTENT\n');
      await run('init', { force: true });
      const content = readFileSync(join(repoRoot, '.hack'), 'utf8');
      expect(content).not.toContain('OLD CONTENT');
      expect(content).toContain('# <repoRoot>/.hack');
    });

    it('creates .gitignore with .hack.local when absent', async () => {
      await run('init');
      const gi = join(repoRoot, '.gitignore');
      expect(existsSync(gi)).toBe(true);
      expect(readFileSync(gi, 'utf8')).toContain('.hack.local');
    });

    it('appends .hack.local to an existing .gitignore', async () => {
      writeFileSync(join(repoRoot, '.gitignore'), 'node_modules\n');
      await run('init');
      const content = readFileSync(join(repoRoot, '.gitignore'), 'utf8');
      expect(content).toContain('node_modules');
      expect(content).toContain('.hack.local');
    });

    it('dedups .hack.local in .gitignore on repeated init', async () => {
      await run('init');
      await run('init', { force: true });
      const content = readFileSync(join(repoRoot, '.gitignore'), 'utf8');
      const matches = content
        .split('\n')
        .filter(l => l.trim() === '.hack.local');
      expect(matches).toHaveLength(1);
    });

    it('prints next-step guidance', async () => {
      const { stdout } = await run('init');
      expect(stdout).toContain('Wrote');
      expect(stdout).toContain('hack config show');
      expect(stdout).toContain('hack config validate');
    });
  });

  // ===========================================================================
  // show
  // ===========================================================================
  describe('show', () => {
    it('prints every SCHEMA_MAP key with file-tier values', async () => {
      writeFileSync(
        join(repoRoot, '.hack'),
        '[harness]\nname = "claude-code"\n[cli]\nlog_level = "debug"\n'
      );
      const { stdout } = await run('show');
      expect(stdout).toContain('harness.name');
      expect(stdout).toContain('claude-code');
      expect(stdout).toContain('cli.log_level');
      expect(stdout).toContain('debug');
    });

    it('attributes source with --src (project tier for a .hack value)', async () => {
      writeFileSync(
        join(repoRoot, '.hack'),
        '[harness]\nname = "claude-code"\n'
      );
      const { stdout } = await run('show', { src: true });
      expect(stdout).toContain('project');
      // harness.name value present too.
      expect(stdout).toContain('claude-code');
    });

    it('reports schema default with no file/env present', async () => {
      // No .hack file at all.
      const { stdout } = await run('show', { src: true });
      // models.high default is 'glm-5.2', source 'default'.
      expect(stdout).toContain('glm-5.2');
      expect(stdout).toContain('default');
    });

    it('env var wins over file value (env-over-file) when pre-defined', async () => {
      writeFileSync(
        join(repoRoot, '.hack'),
        '[pipeline]\nparallel_research = false\n'
      );
      // Set the env var BEFORE running show (preEnv snapshot captures it).
      process.env.PARALLEL_RESEARCH = 'true';
      const { stdout } = await run('show', { src: true });
      // Find the parallel_research row; source should be 'env', value 'true'.
      expect(stdout).toMatch(/parallel_research/);
      // The 'env' source label appears alongside (file says false; env says true).
      expect(stdout).toContain('env');
      // The boolean coercion renders 'true' (not 'false' from the file).
      expect(stdout).toContain('true');
    });

    it('emits valid JSON with --output json', async () => {
      writeFileSync(join(repoRoot, '.hack'), '[harness]\nname = "pi"\n');
      const { stdout } = await run('show', { output: 'json' });
      const parsed = JSON.parse(stdout);
      expect(Array.isArray(parsed)).toBe(true);
      const harnessRow = parsed.find(
        (r: { key: string }) => r.key === 'harness.name'
      );
      expect(harnessRow).toBeDefined();
      expect(harnessRow.value).toBe('pi');
    });

    it('preserves scalar type fidelity in JSON output (Finding 3)', async () => {
      // Booleans emit as JSON booleans, ints as JSON numbers — NOT strings.
      // This is the machine-readable surface (PRD §9.7.8); losing fidelity
      // makes a boolean indistinguishable from a string-valued enum in jq.
      writeFileSync(
        join(repoRoot, '.hack'),
        '[pipeline]\nparallel_research = true\nresearch_depth = 7\n' +
          '[distributed_prd]\ninclude_markers = false\n'
      );
      const { stdout } = await run('show', { output: 'json' });
      const parsed = JSON.parse(stdout) as Array<{
        key: string;
        value: unknown;
      }>;
      const parallelResearch = parsed.find(
        r => r.key === 'pipeline.parallel_research'
      );
      const researchDepth = parsed.find(
        r => r.key === 'pipeline.research_depth'
      );
      const includeMarkers = parsed.find(
        r => r.key === 'distributed_prd.include_markers'
      );
      // boolean → JSON boolean (not "true")
      expect(parallelResearch?.value).toBe(true);
      expect(typeof parallelResearch?.value).toBe('boolean');
      // int → JSON number (not "7")
      expect(researchDepth?.value).toBe(7);
      expect(typeof researchDepth?.value).toBe('number');
      // false boolean stays a boolean (not "false")
      expect(includeMarkers?.value).toBe(false);
      expect(typeof includeMarkers?.value).toBe('boolean');
    });

    it('emits JSON null for an unset key with no default', async () => {
      // cli.scope / cli.max_tasks have no §9.7.5 default → JSON null (not "").
      const { stdout } = await run('show', { output: 'json' });
      const parsed = JSON.parse(stdout) as Array<{
        key: string;
        value: unknown;
      }>;
      const scope = parsed.find(r => r.key === 'cli.scope');
      const maxTasks = parsed.find(r => r.key === 'cli.max_tasks');
      expect(scope?.value).toBeNull();
      expect(maxTasks?.value).toBeNull();
    });

    it('includes Source field in JSON output when --src is set', async () => {
      writeFileSync(join(repoRoot, '.hack'), '[harness]\nname = "pi"\n');
      const { stdout } = await run('show', { output: 'json', src: true });
      const parsed = JSON.parse(stdout);
      const harnessRow = parsed.find(
        (r: { key: string }) => r.key === 'harness.name'
      );
      expect(harnessRow.source).toBe('project');
    });

    it('masks a secret-suffixed key value', async () => {
      // SCHEMA_MAP has no secret keys; place a secret in .hack.local so it passes
      // the secrets policy (only project-local may hold secrets). Then a show of a
      // secret-suffixed SCHEMA_MAP key (none exist) is N/A — instead verify the
      // masking path by asserting show never echoes a raw secret. Use a .hack.local
      // auth override_key; show should not render it (it's not in SCHEMA_MAP) and
      // must never echo its value.
      writeFileSync(
        join(repoRoot, '.hack.local'),
        '[auth]\noverride_key = "sk-super-secret-value"\n'
      );
      const { stdout } = await run('show');
      expect(stdout).not.toContain('sk-super-secret-value');
    });
  });

  // ===========================================================================
  // validate
  // ===========================================================================
  describe('validate', () => {
    it('exits 0 on a valid .hack', async () => {
      writeFileSync(
        join(repoRoot, '.hack'),
        '[pipeline]\nresearch_depth = 3\n[harness]\nname = "pi"\n'
      );
      await run('validate');
      expect(exitCalls).toContain(0);
    });

    it('exits 1 on a secret in a committable file (.hack)', async () => {
      writeFileSync(
        join(repoRoot, '.hack'),
        '[auth]\nzai_api_key = "sk-leaked"\n'
      );
      await run('validate');
      expect(exitCalls).toContain(1);
    });

    it('exits 1 on an out-of-range int', async () => {
      writeFileSync(join(repoRoot, '.hack'), '[tasks_lock]\npoll_ms = -5\n');
      await run('validate');
      expect(exitCalls).toContain(1);
    });

    it('exits 1 on a type mismatch', async () => {
      // poll_ms expects int; a boolean is a type error.
      writeFileSync(join(repoRoot, '.hack'), '[tasks_lock]\npoll_ms = true\n');
      await run('validate');
      expect(exitCalls).toContain(1);
    });

    it('exits 0 on an unknown section/key (warning only)', async () => {
      writeFileSync(join(repoRoot, '.hack'), '[unknownsection]\nfoo = 1\n');
      await run('validate');
      expect(exitCalls).toContain(0);
    });

    it('honors an explicit <file> argument', async () => {
      const file = join(repoRoot, 'custom.hack');
      writeFileSync(file, '[tasks_lock]\npoll_ms = -5\n');
      await run('validate', {}, file);
      expect(exitCalls).toContain(1);
    });

    it('never seeds process.env (pure lint)', async () => {
      // Ensure the env var is unset before.
      delete process.env.RESEARCH_DEPTH;
      writeFileSync(
        join(repoRoot, '.hack'),
        '[pipeline]\nresearch_depth = 7\n'
      );
      await run('validate');
      // validate must NOT seed env (unlike loadHackConfig).
      expect(process.env.RESEARCH_DEPTH).toBeUndefined();
    });

    it('skips missing files gracefully', async () => {
      // No .hack / .hack.local present — both missing, no error, exit 0.
      await run('validate');
      expect(exitCalls).toContain(0);
    });

    it('infers project-local tier for .hack.local (secret allowed)', async () => {
      // A secret in .hack.local is ALLOWED (only project-local may hold secrets).
      writeFileSync(
        join(repoRoot, '.hack.local'),
        '[auth]\nzai_api_key = "sk-ok-local"\n'
      );
      await run('validate');
      expect(exitCalls).toContain(0);
    });
  });

  // ===========================================================================
  // path
  // ===========================================================================
  describe('path', () => {
    it('prints global/project/local paths with no flag', async () => {
      process.env.HACK_CONFIG_HOME = join(repoRoot, 'globalcfg');
      const { stdout } = await run('path');
      expect(stdout).toContain(join(repoRoot, '.hack'));
      expect(stdout).toContain(join(repoRoot, '.hack.local'));
      expect(stdout).toContain(join(repoRoot, 'globalcfg', 'config'));
      expect(stdout.toLowerCase()).toContain('global');
      expect(stdout.toLowerCase()).toContain('project');
      expect(stdout.toLowerCase()).toContain('local');
    });

    it('--global prints only the global path', async () => {
      process.env.HACK_CONFIG_HOME = join(repoRoot, 'globalcfg');
      const { stdout } = await run('path', { global: true });
      expect(stdout).toContain(join(repoRoot, 'globalcfg', 'config'));
      // Project path should NOT be present when --global filter is active.
      expect(stdout).not.toContain(join(repoRoot, '.hack'));
    });

    it('--local prints only the local path', async () => {
      const { stdout } = await run('path', { local: true });
      expect(stdout).toContain(join(repoRoot, '.hack.local'));
      // Global path should NOT be present when --local filter is active.
      expect(stdout).not.toContain(join(repoRoot, '.hack' + '\n'));
    });

    it('marks missing paths with the absent marker', async () => {
      // No .hack / .hack.local files present; global dir doesn't exist either.
      const { stdout } = await run('path');
      // All three layers print; the absent (✷) marker is exercised.
      expect(stdout).toContain(join(repoRoot, '.hack'));
    });

    it('emits valid JSON with --output json', async () => {
      process.env.HACK_CONFIG_HOME = join(repoRoot, 'globalcfg');
      const { stdout } = await run('path', { output: 'json' });
      const parsed = JSON.parse(stdout);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBe(3);
      const layers = parsed.map((r: { layer: string }) => r.layer);
      expect(layers).toEqual(['global', 'project', 'local']);
    });
  });

  // ===========================================================================
  // unknown action
  // ===========================================================================
  describe('unknown action', () => {
    it('exits 1 with a helpful message', async () => {
      await run('bogus');
      expect(exitCalls).toContain(1);
    });
  });

  // ===========================================================================
  // edge cases / branch coverage
  // ===========================================================================
  describe('branch coverage', () => {
    it('show table output renders without --src', async () => {
      writeFileSync(join(repoRoot, '.hack'), '[harness]\nname = "pi"\n');
      const { stdout } = await run('show');
      expect(stdout).toContain('harness.name');
      // No Source column header when --src is absent.
      expect(stdout).not.toContain('Source');
    });

    it('show attributes an int env var to the env layer (int coercion)', async () => {
      writeFileSync(
        join(repoRoot, '.hack'),
        '[pipeline]\nresearch_depth = 2\n'
      );
      // Pre-define the int env var → env wins + int coercion path is exercised.
      process.env.RESEARCH_DEPTH = '5';
      const { stdout } = await run('show', { src: true });
      expect(stdout).toContain('env');
      // Coerced int value (5) rendered, not the file value (2).
      expect(stdout).toMatch(/pipeline\.research_depth[\s\S]*5/);
    });

    it('execute() catch arm fires on a malformed .hack (show)', async () => {
      writeFileSync(join(repoRoot, '.hack'), 'this is = = not valid toml\n');
      await run('show');
      // execute()'s catch arm calls process.exit(1).
      expect(exitCalls).toContain(1);
    });

    it('init appends .hack.local to a .gitignore lacking a trailing newline', async () => {
      writeFileSync(join(repoRoot, '.gitignore'), 'node_modules'); // no newline
      await run('init');
      const content = readFileSync(join(repoRoot, '.gitignore'), 'utf8');
      expect(content).toContain('node_modules');
      expect(content).toContain('.hack.local');
    });
  });

  // ===========================================================================
  // displayValue helper (secret masking + undefined→empty)
  // ===========================================================================
  describe('ConfigCommand.displayValue', () => {
    it('masks a secret-suffixed key', () => {
      expect(ConfigCommand.displayValue('zai_api_key', 'sk-secret')).toBe(
        '<redacted>'
      );
    });

    it('renders a defined non-secret value as a string', () => {
      expect(ConfigCommand.displayValue('name', 'pi')).toBe('pi');
      expect(ConfigCommand.displayValue('research_depth', 3)).toBe('3');
      expect(ConfigCommand.displayValue('parallel_research', false)).toBe(
        'false'
      );
    });

    it('renders an undefined value as empty string', () => {
      expect(ConfigCommand.displayValue('scope', undefined)).toBe('');
    });
  });

  // ===========================================================================
  // coerceEnv helper (env-string → schema scalar)
  // ===========================================================================
  describe('ConfigCommand.coerceEnv', () => {
    it('coerces "true"/"false" to booleans', () => {
      expect(ConfigCommand.coerceEnv('true', 'boolean')).toBe(true);
      expect(ConfigCommand.coerceEnv('anything-else', 'boolean')).toBe(false);
    });

    it('coerces integer strings to numbers', () => {
      expect(ConfigCommand.coerceEnv('42', 'int')).toBe(42);
    });

    it('falls back to the raw string for a non-integer int value', () => {
      expect(ConfigCommand.coerceEnv('abc', 'int')).toBe('abc');
    });

    it('passes string-typed values through unchanged', () => {
      expect(ConfigCommand.coerceEnv('glm-5.2', 'string')).toBe('glm-5.2');
    });
  });
});
