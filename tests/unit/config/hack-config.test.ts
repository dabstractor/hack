/**
 * Unit tests for `parseHackFile` — the `.hack` (TOML 1.0) parse module (PRD §9.7.4).
 *
 * @remarks
 * Covers the parse-only contract (P2.M1.T1.S1): valid parse (type preservation), BOM
 * rejection, malformed-TOML rethrow (file path + parser line/column), duplicate-key
 * wrapping, empty/whitespace/comments-only → `{}`, and ENOENT propagation. Pure &
 * deterministic — operates on real TOML temp files under the OS tmpdir; no env mutation,
 * so it stays stable under the project's mandatory 100%-coverage gate.
 *
 * Branch map (research §7) → every branch of `src/config/hack-config.ts` is hit:
 * - parse-success (valid TOML)               → 'SHOULD parse a valid .hack …'
 * - BOM-throw (first-3-bytes 0xEF 0xBB 0xBF) → 'SHOULD reject a leading UTF-8 BOM …'
 * - TomlError-if (malformed TOML)            → 'SHOULD rethrow parse errors …'
 * - TomlError-if (duplicate key)             → 'SHOULD surface duplicate-key errors …'
 * - else-rethrow (ENOENT)                    → 'SHOULD let a missing file propagate …'
 * - empty→{} (empty/whitespace/comments)     → 'SHOULD return an empty object …' / 'SHOULD ignore TOML comments'
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  loadHackConfig,
  parseHackFile,
  SCHEMA_MAP,
  SCHEMA_BY_KEY,
  _resetValidationWarnings,
} from '../../../src/config/hack-config.js';

describe('config/hack-config: parseHackFile', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'hack-config-'));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // Per-test cleanup of any env/state (none used today, but keeps the suite hermetic).
  afterEach(() => {
    // no-op placeholder for future env-mutation cleanup
  });

  it('SHOULD parse a valid .hack into a ParsedHackConfig preserving types', () => {
    // SETUP — a real .hack mirroring the §9.7.5 schema (string / number / boolean)
    const path = join(dir, 'valid.hack');
    writeFileSync(
      path,
      '[harness]\nname = "pi"\n[pipeline]\nresearch_depth = 3\nparallel_research = true\n'
    );

    // EXECUTE
    const cfg = parseHackFile(path);

    // VERIFY — TOML types preserved as JS primitives (not stringified)
    expect(cfg.harness.name).toBe('pi'); // string
    expect(cfg.pipeline.research_depth).toBe(3); // number
    expect(cfg.pipeline.parallel_research).toBe(true); // boolean
  });

  it('SHOULD reject a leading UTF-8 BOM with a clear error naming the file', () => {
    // SETUP — raw BOM bytes (0xEF 0xBB 0xBF) followed by otherwise-valid TOML.
    // Must write via Buffer (a utf8 string would re-encode the BOM away).
    const path = join(dir, 'bom.hack');
    writeFileSync(
      path,
      Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from('[harness]\nname = "pi"\n'),
      ])
    );

    // EXECUTE & VERIFY — throws, message names the file + says "BOM"
    expect(() => parseHackFile(path)).toThrow(/BOM/);
    expect(() => parseHackFile(path)).toThrow(path);
  });

  it('SHOULD rethrow parse errors with the file path and parser line/column', () => {
    // SETUP — malformed TOML (unterminated table header) → smol-toml raises TomlError
    const path = join(dir, 'malformed.hack');
    writeFileSync(path, '[harness\nname = "pi"');

    // EXECUTE & VERIFY — wrapped error names the file AND includes line/column
    expect(() => parseHackFile(path)).toThrow(path);
    expect(() => parseHackFile(path)).toThrow(/line/i);
    expect(() => parseHackFile(path)).toThrow(/column/i);
  });

  it('SHOULD surface duplicate-key errors with the file path', () => {
    // SETUP — duplicate key in the same section → smol-toml raises TomlError; S1 wraps w/ path
    const path = join(dir, 'dup-key.hack');
    writeFileSync(path, '[harness]\nname = "pi"\nname = "claude-code"\n');

    // EXECUTE & VERIFY — wrapped error names the file
    expect(() => parseHackFile(path)).toThrow(path);
  });

  it('SHOULD return an empty object for an empty/whitespace-only file', () => {
    // SETUP — empty file AND whitespace-only file (both parse to {})
    const emptyPath = join(dir, 'empty.hack');
    const wsPath = join(dir, 'whitespace.hack');
    writeFileSync(emptyPath, '');
    writeFileSync(wsPath, '   \n  \t\n');

    // EXECUTE & VERIFY — NOT an error; returns {}
    expect(parseHackFile(emptyPath)).toEqual({});
    expect(parseHackFile(wsPath)).toEqual({});
  });

  it('SHOULD ignore TOML comments', () => {
    // SETUP — leading comment + inline comment; only the real key/value should surface
    const path = join(dir, 'comments.hack');
    writeFileSync(path, '# a comment\n[harness]\nname = "pi" # inline\n');

    // EXECUTE & VERIFY
    const cfg = parseHackFile(path);
    expect(cfg.harness.name).toBe('pi');
  });

  it('SHOULD let a missing file propagate (ENOENT)', () => {
    // SETUP — a path that does not exist (readFileSync throws ENOENT)
    const path = join(dir, 'nope.hack');

    // EXECUTE & VERIFY — ENOENT propagates (exercises the catch else-branch)
    expect(() => parseHackFile(path)).toThrow(/ENOENT/);
  });
});

describe('config/hack-config: loadHackConfig', () => {
  // S2: three-tier discovery, per-section/key layered merge, env-over-file seeding
  // (PRD §9.7.3 / §9.2.1). Uses real TOML temp files for tier files + vi.stubEnv for the
  // global-path cascade (HACK_CONFIG_HOME / XDG_CONFIG_HOME / HOME). Per-test env-key
  // deletion is mandatory: tests/setup.ts loads .env, so a real process.env value would
  // skip seeding (false pass).

  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'hack-load-'));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // Delete every env var this suite might seed, so a real .env value never masks seeding.
  beforeEach(() => {
    delete process.env.HACK_CONFIG_HOME;
    delete process.env.XDG_CONFIG_HOME;
    const seeded = [
      'PRP_MODEL_HIGH',
      'PRP_MODEL_BALANCED',
      'PRP_MODEL_FAST',
      'PRP_API_BASE_URL',
      'PRP_AGENT_HARNESS',
      'PARALLEL_RESEARCH',
      'RESEARCH_DEPTH',
      'RESEARCH_TIMEOUT',
      'ISSUE_RETRY_MAX',
      'BUG_FINDER_AGENT',
      'BUG_RESULTS_FILE',
      'BUGFIX_SCOPE',
      'VALIDATION_AGENT',
      'VALIDATION_TIMEOUT',
      'RESEARCH_QUEUE_CONCURRENCY',
      'API_TIMEOUT_MS',
      'MONITOR_TASK_INTERVAL',
      'HACKY_LOG_LEVEL',
    ];
    for (const k of seeded) delete process.env[k];
  });

  it('SHOULD return empty sections + empty _sources when no tier files exist (missing tier is not an error)', () => {
    // SETUP — an empty repoRoot (no .hack / .hack.local); global forced to a nonexistent dir.
    vi.stubEnv('HACK_CONFIG_HOME', join(dir, 'no-global-here'));
    const repoRoot = mkdtempSync(join(dir, 'repo-empty-'));

    // EXECUTE
    const cfg = loadHackConfig(repoRoot);

    // VERIFY — no sections, no sources, no env mutation
    expect(cfg._sources).toEqual({});
    expect(Object.keys(cfg).length).toBe(1); // only the _sources key
    expect(process.env.RESEARCH_DEPTH).toBeUndefined(); // sentinel — no seeding happened
  });

  it('SHOULD load + seed from the global tier (HACK_CONFIG_HOME branch)', () => {
    // SETUP — global via HACK_CONFIG_HOME → $HACK_CONFIG_HOME/config
    const globalHome = mkdtempSync(join(dir, 'global-home-'));
    vi.stubEnv('HACK_CONFIG_HOME', globalHome);
    writeFileSync(
      join(globalHome, 'config'),
      '[pipeline]\nresearch_depth = 2\n'
    );
    const repoRoot = mkdtempSync(join(dir, 'repo-global-'));

    // EXECUTE
    const cfg = loadHackConfig(repoRoot);

    // VERIFY — global merged + attributed + seeded
    expect(cfg.pipeline?.research_depth).toBe(2);
    expect(cfg._sources['pipeline.research_depth']).toBe('global');
    expect(process.env.RESEARCH_DEPTH).toBe('2');
  });

  it('SHOULD load + seed from the project tier (<repoRoot>/.hack)', () => {
    // SETUP — only the project tier exists
    vi.stubEnv('HACK_CONFIG_HOME', join(dir, 'no-global-2'));
    const repoRoot = mkdtempSync(join(dir, 'repo-project-'));
    writeFileSync(join(repoRoot, '.hack'), '[harness]\nname = "pi"\n');

    // EXECUTE
    const cfg = loadHackConfig(repoRoot);

    // VERIFY
    expect(cfg.harness?.name).toBe('pi');
    expect(cfg._sources['harness.name']).toBe('project');
    expect(process.env.PRP_AGENT_HARNESS).toBe('pi');
  });

  it('SHOULD load + seed from the project-local tier (<repoRoot>/.hack.local)', () => {
    // SETUP — only the project-local tier exists
    vi.stubEnv('HACK_CONFIG_HOME', join(dir, 'no-global-3'));
    const repoRoot = mkdtempSync(join(dir, 'repo-local-'));
    writeFileSync(join(repoRoot, '.hack.local'), '[api]\ntimeout_ms = 30000\n');

    // EXECUTE
    const cfg = loadHackConfig(repoRoot);

    // VERIFY
    expect(cfg.api?.timeout_ms).toBe(30000);
    expect(cfg._sources['api.timeout_ms']).toBe('project-local');
    expect(process.env.API_TIMEOUT_MS).toBe('30000');
  });

  it('SHOULD layer all three tiers per-section/key (higher wins; lower-tier siblings survive)', () => {
    // SETUP — global [pipeline] research_depth=2; project [pipeline] issue_retry_max=5 +
    // [harness] name="pi"; project-local [pipeline] research_depth=3.
    const globalHome = mkdtempSync(join(dir, 'global-three-'));
    vi.stubEnv('HACK_CONFIG_HOME', globalHome);
    writeFileSync(
      join(globalHome, 'config'),
      '[pipeline]\nresearch_depth = 2\n'
    );
    const repoRoot = mkdtempSync(join(dir, 'repo-three-'));
    writeFileSync(
      join(repoRoot, '.hack'),
      '[pipeline]\nissue_retry_max = 5\n[harness]\nname = "pi"\n'
    );
    writeFileSync(
      join(repoRoot, '.hack.local'),
      '[pipeline]\nresearch_depth = 3\n'
    );

    // EXECUTE
    const cfg = loadHackConfig(repoRoot);

    // VERIFY — project-local won research_depth (3); project's issue_retry_max survived
    // (sibling in the same section); project's harness.name survived (whole other section).
    expect(cfg.pipeline?.research_depth).toBe(3);
    expect(cfg.pipeline?.issue_retry_max).toBe(5);
    expect(cfg.harness?.name).toBe('pi');
    expect(cfg._sources['pipeline.research_depth']).toBe('project-local');
    expect(cfg._sources['pipeline.issue_retry_max']).toBe('project');
    expect(cfg._sources['harness.name']).toBe('project');
  });

  it('SHOULD skip a missing middle tier without error (global + project-local only, no .hack)', () => {
    // SETUP — global + project-local exist; the project tier (.hack) is absent
    const globalHome = mkdtempSync(join(dir, 'global-mid-'));
    vi.stubEnv('HACK_CONFIG_HOME', globalHome);
    writeFileSync(
      join(globalHome, 'config'),
      '[pipeline]\nresearch_depth = 2\n'
    );
    const repoRoot = mkdtempSync(join(dir, 'repo-mid-'));
    writeFileSync(
      join(repoRoot, '.hack.local'),
      '[pipeline]\nresearch_depth = 7\n'
    );

    // EXECUTE
    const cfg = loadHackConfig(repoRoot);

    // VERIFY — project-local won; no throw from the missing project tier
    expect(cfg.pipeline?.research_depth).toBe(7);
    expect(cfg._sources['pipeline.research_depth']).toBe('project-local');
  });

  it('SHOULD honor env-over-file: a pre-set env var is NOT overwritten by the file value', () => {
    // SETUP — pre-set the env var (simulating shell/.env); file would seed a different value.
    vi.stubEnv('HACK_CONFIG_HOME', join(dir, 'no-global-eof'));
    const repoRoot = mkdtempSync(join(dir, 'repo-eof-'));
    writeFileSync(join(repoRoot, '.hack'), '[pipeline]\nresearch_depth = 3\n');
    process.env.RESEARCH_DEPTH = '99'; // real env wins (§9.2.1)

    // EXECUTE
    loadHackConfig(repoRoot);

    // VERIFY — the env var is untouched (file value 3 did NOT leak)
    expect(process.env.RESEARCH_DEPTH).toBe('99');
  });

  it('SHOULD NOT seed CLI-only keys (absent from HACK_KEY_TO_ENV) but keep them in the merged config', () => {
    // SETUP — [cli] mode is CLI-only (no env mapping); [concurrency] parallelism likewise.
    vi.stubEnv('HACK_CONFIG_HOME', join(dir, 'no-global-cli'));
    const repoRoot = mkdtempSync(join(dir, 'repo-cli-'));
    writeFileSync(join(repoRoot, '.hack'), '[cli]\nmode = "bug-hunt"\n');

    // EXECUTE
    const cfg = loadHackConfig(repoRoot);

    // VERIFY — present in the merged config, but NOT seeded to process.env
    expect(cfg.cli?.mode).toBe('bug-hunt');
    // mode/parallelism are CLI-only: no HACKY_* env var for them (only cli.log_level maps).
    expect(cfg._sources['cli.mode']).toBe('project');
  });

  it('SHOULD coerce booleans + numbers + strings via String() when seeding env', () => {
    // SETUP — boolean → "true", number → "1800", string passthrough
    vi.stubEnv('HACK_CONFIG_HOME', join(dir, 'no-global-coerce'));
    const repoRoot = mkdtempSync(join(dir, 'repo-coerce-'));
    writeFileSync(
      join(repoRoot, '.hack'),
      '[pipeline]\nparallel_research = true\nresearch_timeout_seconds = 1800\n[bug_hunt]\nfinder_agent = "glp"\n'
    );

    // EXECUTE
    loadHackConfig(repoRoot);

    // VERIFY — String() coercion of each TOML type
    expect(process.env.PARALLEL_RESEARCH).toBe('true'); // boolean → "true"
    expect(process.env.RESEARCH_TIMEOUT).toBe('1800'); // number → "1800"
    expect(process.env.BUG_FINDER_AGENT).toBe('glp'); // string passthrough
  });

  it('SHOULD resolve the global tier via XDG_CONFIG_HOME when HACK_CONFIG_HOME is unset', () => {
    // SETUP — XDG fallback: $XDG_CONFIG_HOME/hack/config
    delete process.env.HACK_CONFIG_HOME;
    const xdgHome = mkdtempSync(join(dir, 'xdg-home-'));
    vi.stubEnv('XDG_CONFIG_HOME', xdgHome);
    const globalDir = join(xdgHome, 'hack');
    mkdirSync(globalDir, { recursive: true });
    writeFileSync(
      join(globalDir, 'config'),
      '[pipeline]\nissue_retry_max = 4\n'
    );
    const repoRoot = mkdtempSync(join(dir, 'repo-xdg-'));

    // EXECUTE
    const cfg = loadHackConfig(repoRoot);

    // VERIFY — global resolved via XDG + seeded
    expect(cfg.pipeline?.issue_retry_max).toBe(4);
    expect(cfg._sources['pipeline.issue_retry_max']).toBe('global');
    expect(process.env.ISSUE_RETRY_MAX).toBe('4');
  });

  it('SHOULD resolve the global tier via HOME (~/.hack) when both HACK_CONFIG_HOME + XDG_CONFIG_HOME are unset', () => {
    // SETUP — HOME fallback: ~/.hack. Stub HOME to a temp dir (os.homedir reads $HOME).
    delete process.env.HACK_CONFIG_HOME;
    delete process.env.XDG_CONFIG_HOME;
    const fakeHome = mkdtempSync(join(dir, 'fake-home-'));
    vi.stubEnv('HOME', fakeHome);
    writeFileSync(join(fakeHome, '.hack'), '[models]\nfast = "glm-flash"\n');
    const repoRoot = mkdtempSync(join(dir, 'repo-home-'));

    // EXECUTE
    const cfg = loadHackConfig(repoRoot);

    // VERIFY — global resolved via ~/.hack + seeded
    expect(cfg.models?.fast).toBe('glm-flash');
    expect(cfg._sources['models.fast']).toBe('global');
    expect(process.env.PRP_MODEL_FAST).toBe('glm-flash');
  });

  it('SHOULD rethrow parse errors from an EXISTING tier file (existsSync-first does not swallow them)', () => {
    // SETUP — an EXISTING project .hack that is malformed (BOM) → parseHackFile throws.
    // Proves the existsSync guard skips MISSING files but lets parse errors propagate.
    vi.stubEnv('HACK_CONFIG_HOME', join(dir, 'no-global-bom'));
    const repoRoot = mkdtempSync(join(dir, 'repo-bom-'));
    writeFileSync(
      join(repoRoot, '.hack'),
      Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from('[harness]\nname = "pi"\n'),
      ])
    );

    // EXECUTE & VERIFY — the BOM error propagates (file path + "BOM")
    expect(() => loadHackConfig(repoRoot)).toThrow(/BOM/);
    expect(() => loadHackConfig(repoRoot)).toThrow(/\.hack/);
  });
});

describe('hack-config: SCHEMA_MAP', () => {
  // P2.M2.T1.S1: exhaustive §9.7.5 schema reference (dual-surface env/CLI/default map).
  // Pure-data assertions on SCHEMA_MAP / SCHEMA_BY_KEY + an env-seeding regression that
  // exercises the derived HACK_KEY_TO_ENV (filter() of CLI-only keys). The schema map is
  // static + two derivations → zero runtime branches → 100% coverage trivially.

  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'hack-schema-'));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('SCHEMA_MAP has all 38 §9.7.5 rows', () => {
    // VERIFY: exhaustive coverage of the §9.7.5 schema reference table
    expect(SCHEMA_MAP.length).toBe(38);
  });

  it('every §9.7.5 [section].key is present in SCHEMA_BY_KEY', () => {
    // VERIFY: a representative sample across all 13 sections resolves via the lookup index
    const sample = [
      'models.high',
      'models.balanced',
      'models.fast',
      'endpoint.base_url',
      'harness.name',
      'pipeline.parallel_research',
      'pipeline.research_depth',
      'pipeline.commit_format',
      'commit.retry_max',
      'bug_hunt.finder_agent',
      'validation.agent',
      'distributed_prd.include_max_depth',
      'tasks_lock.poll_ms',
      'concurrency.parallelism',
      'api.timeout_ms',
      'monitor.enabled',
      'cli.mode',
      'cli.scope',
      'cli.log_level',
      'cli.cache_enabled',
      'cli.max_tasks',
      'cli.max_duration_ms',
    ];
    for (const k of sample) {
      expect(SCHEMA_BY_KEY[k]).toBeDefined();
    }
  });

  it('SCHEMA_BY_KEY is a complete lookup index (38 keys, every entry reachable)', () => {
    // VERIFY: the derived index has exactly one entry per SCHEMA_MAP row
    expect(Object.keys(SCHEMA_BY_KEY).length).toBe(38);
    for (const entry of SCHEMA_MAP) {
      expect(SCHEMA_BY_KEY[`${entry.section}.${entry.key}`]).toBe(entry);
    }
  });

  it('dual-surface concepts appear exactly once (one TOML key per concept)', () => {
    // VERIFY: the 4 dual-surface concepts each have BOTH envVar AND cliFlag, and appear once
    const dualSurface = [
      'concurrency.research_queue',
      'cli.log_level',
      'monitor.task_interval',
      'pipeline.parallel_research',
    ];
    for (const k of dualSurface) {
      const occurrences = SCHEMA_MAP.filter(e => `${e.section}.${e.key}` === k);
      expect(occurrences.length).toBe(1);
      expect(occurrences[0].envVar).toBeDefined();
      expect(occurrences[0].cliFlag).toBeDefined();
    }
  });

  it('negating flags name the POSITIVE state (default true, --no-* form)', () => {
    // VERIFY: cache_enabled + monitor.enabled default to true and use the --no-* flag
    expect(SCHEMA_BY_KEY['cli.cache_enabled'].defaultValue).toBe(true);
    expect(SCHEMA_BY_KEY['cli.cache_enabled'].cliFlag).toBe('--no-cache');
    expect(SCHEMA_BY_KEY['monitor.enabled'].defaultValue).toBe(true);
    expect(SCHEMA_BY_KEY['monitor.enabled'].cliFlag).toBe(
      '--no-resource-monitor'
    );
  });

  it('model-id defaults are BARE (qualified at read time, not in schema)', () => {
    // VERIFY: no 'zai/' prefix in the schema defaults; qualifyModel() qualifies at read time
    expect(SCHEMA_BY_KEY['models.high'].defaultValue).toBe('glm-5.2');
    expect(SCHEMA_BY_KEY['models.balanced'].defaultValue).toBe('glm-5.2');
    expect(SCHEMA_BY_KEY['models.fast'].defaultValue).toBe('glm-5-turbo');
  });

  it('acceptedValues match the §9.7.5 enums', () => {
    // VERIFY: enum-bearing entries carry the §9.7.5 accepted-values
    expect(SCHEMA_BY_KEY['harness.name'].acceptedValues).toEqual([
      'pi',
      'claude-code',
    ]);
    expect(SCHEMA_BY_KEY['pipeline.commit_format'].acceptedValues).toEqual([
      'task-prefix',
      'plain',
    ]);
    expect(SCHEMA_BY_KEY['cli.mode'].acceptedValues).toEqual([
      'normal',
      'delta',
      'bug-hunt',
      'validate',
    ]);
    expect(SCHEMA_BY_KEY['cli.log_level'].acceptedValues).toEqual([
      'trace',
      'debug',
      'info',
      'warn',
      'error',
      'fatal',
    ]);
  });

  it('the 3 unset CLI keys have no defaultValue', () => {
    // VERIFY: [cli] scope / max_tasks / max_duration_ms are unset (no §9.7.5 default)
    expect(SCHEMA_BY_KEY['cli.scope'].defaultValue).toBeUndefined();
    expect(SCHEMA_BY_KEY['cli.max_tasks'].defaultValue).toBeUndefined();
    expect(SCHEMA_BY_KEY['cli.max_duration_ms'].defaultValue).toBeUndefined();
  });

  it('[auth] is ABSENT (secret-bearing → T2.S1 secrets policy; never env-seeded)', () => {
    // VERIFY: no [auth] rows leak into SCHEMA_MAP (seeding secrets to env would be WRONG)
    expect(SCHEMA_MAP.filter(e => e.section === 'auth').length).toBe(0);
  });

  it('HACK_KEY_TO_ENV regression: env-linked key seeds process.env; CLI-only key does not', () => {
    // SETUP — a .hack with an env-linked key ([pipeline] research_depth → RESEARCH_DEPTH)
    // AND a CLI-only key ([cli] mode, which has NO envVar → must NOT seed anything).
    // This exercises the derived HACK_KEY_TO_ENV's filter() (CLI-only keys absent).
    vi.stubEnv('HACK_CONFIG_HOME', join(dir, 'no-global-here-seed'));
    delete process.env.RESEARCH_DEPTH; // real .env value would skip seeding (false pass)
    const repoRoot = mkdtempSync(join(dir, 'repo-seed-'));
    writeFileSync(
      join(repoRoot, '.hack'),
      '[pipeline]\nresearch_depth = 7\n\n[cli]\nmode = "bug-hunt"\n'
    );

    // EXECUTE
    loadHackConfig(repoRoot);

    // VERIFY — env-linked key seeds process.env (stringified per §9.2.1); CLI-only does NOT.
    expect(process.env.RESEARCH_DEPTH).toBe('7');
    // [cli] mode has no envVar → derived HACK_KEY_TO_ENV skips it → seedProcessEnv never
    // writes it under any name. Assert no process.env var carries the [cli] mode value
    // ('bug-hunt') as a result of this load (robust against vitest's own MODE/NODE_ENV).
    const modeValueVars = Object.entries(process.env)
      .filter(([, v]) => v === 'bug-hunt')
      .map(([k]) => k);
    expect(modeValueVars).toEqual([]);
  });
});

describe('hack-config: secrets & validation', () => {
  // P2.M1.T2.S1: secrets refusal (§9.7.6) + type/range/enum + unknown-key/section
  // (§9.7.7) + auth-override seeding (§9.7.9) + masked debug trace (§9.7.10). Uses real
  // TOML temp files for tier files. Per-test env-key deletion is mandatory: tests/setup.ts
  // loads .env, so real process.env values would skip seeding/trace (false passes).
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hack-valid-'));
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Delete the env keys this suite touches so .env values never mask behavior.
    delete process.env.PRP_API_KEY;
    delete process.env.HACKY_LOG_LEVEL;
    // Global-path cascade keys must be clean so a stray HOME/XDG never leaks.
    delete process.env.HACK_CONFIG_HOME;
    delete process.env.XDG_CONFIG_HOME;
    delete process.env.RESEARCH_DEPTH; // sentinel for "typo key ignored"
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    warnSpy.mockRestore();
    _resetValidationWarnings();
    rmSync(dir, { recursive: true, force: true });
  });

  // --- Secrets policy (§9.7.6) ----------------------------------------------

  it('SHOULD refuse a non-empty secret in the PROJECT .hack (§9.7.6) naming file+key+remediation', () => {
    // SETUP — global forced empty; project .hack carries a secret.
    vi.stubEnv('HACK_CONFIG_HOME', join(dir, 'no-global-secret'));
    const repoRoot = mkdtempSync(join(dir, 'repo-secret-'));
    const hackFile = join(repoRoot, '.hack');
    writeFileSync(hackFile, '[auth]\nzai_api_key = "sk-leaked"\n');

    // EXECUTE & VERIFY — throws naming key, file, and remediation (.hack.local / env var)
    expect(() => loadHackConfig(repoRoot)).toThrow(/zai_api_key/);
    expect(() => loadHackConfig(repoRoot)).toThrow(hackFile);
    expect(() => loadHackConfig(repoRoot)).toThrow(
      /\.hack\.local|environment variable/
    );
  });

  it('SHOULD refuse a non-empty secret in the GLOBAL ~/.hack (§9.7.6)', () => {
    // SETUP — global via HOME fallback carries an override_key secret.
    const fakeHome = mkdtempSync(join(dir, 'fake-home-secret-'));
    vi.stubEnv('HOME', fakeHome);
    const globalFile = join(fakeHome, '.hack');
    writeFileSync(globalFile, '[auth]\noverride_key = "sk-global"\n');
    const repoRoot = mkdtempSync(join(dir, 'repo-global-secret-'));

    // EXECUTE & VERIFY — throws naming that global file + the key
    expect(() => loadHackConfig(repoRoot)).toThrow(/override_key/);
    expect(() => loadHackConfig(repoRoot)).toThrow(globalFile);
  });

  it('SHOULD accept a secret in .hack.local and seed PRP_API_KEY from override_key (§9.7.6/§9.7.9)', () => {
    // SETUP — project-local .hack.local carries override_key (the only tier allowed).
    vi.stubEnv('HACK_CONFIG_HOME', join(dir, 'no-global-ok'));
    const repoRoot = mkdtempSync(join(dir, 'repo-local-ok-'));
    writeFileSync(
      join(repoRoot, '.hack.local'),
      '[auth]\noverride_key = "sk-local"\n'
    );

    // EXECUTE
    loadHackConfig(repoRoot);

    // VERIFY — no throw; PRP_API_KEY seeded from the local override_key
    expect(process.env.PRP_API_KEY).toBe('sk-local');
  });

  it('SHOULD treat an empty/whitespace secret as "not configured" in ANY tier (§9.2.7)', () => {
    // SETUP — empty (whitespace-only) secret in the committable project .hack.
    vi.stubEnv('HACK_CONFIG_HOME', join(dir, 'no-global-empty'));
    const repoRoot = mkdtempSync(join(dir, 'repo-empty-secret-'));
    writeFileSync(join(repoRoot, '.hack'), '[auth]\nzai_api_key = "   "\n');

    // EXECUTE — no throw (empty == not configured, never refused).
    expect(() => loadHackConfig(repoRoot)).not.toThrow();

    // VERIFY — not forwarded: PRP_API_KEY never seeded from an empty zai_api_key.
    expect(process.env.PRP_API_KEY).toBeUndefined();
  });

  it('SHOULD honor env-over-file: a pre-set PRP_API_KEY wins over .hack.local override_key', () => {
    // SETUP — shell/.env already set PRP_API_KEY; .hack.local would seed a different value.
    vi.stubEnv('HACK_CONFIG_HOME', join(dir, 'no-global-eof'));
    const repoRoot = mkdtempSync(join(dir, 'repo-eof-auth-'));
    writeFileSync(
      join(repoRoot, '.hack.local'),
      '[auth]\noverride_key = "from-file"\n'
    );
    process.env.PRP_API_KEY = 'from-shell'; // real env wins (§9.2.1)

    // EXECUTE
    loadHackConfig(repoRoot);

    // VERIFY — env var untouched (the === undefined guard prevented the file value)
    expect(process.env.PRP_API_KEY).toBe('from-shell');
  });

  // --- Unknown section / key (§9.7.7) — warn once, proceed ------------------

  it('SHOULD warn once on an unknown section and continue loading', () => {
    // SETUP — project .hack has a bogus [foo] section with a non-secret key.
    vi.stubEnv('HACK_CONFIG_HOME', join(dir, 'no-global-sec'));
    const repoRoot = mkdtempSync(join(dir, 'repo-unknown-sec-'));
    const hackFile = join(repoRoot, '.hack');
    writeFileSync(hackFile, '[foo]\nbar = 1\n[harness]\nname = "pi"\n');

    // EXECUTE
    loadHackConfig(repoRoot);

    // VERIFY — one warn naming the section + file; load proceeded (harness merged).
    const sectionWarns = warnSpy.mock.calls.filter(([m]) =>
      /unknown section \[foo\]/.test(String(m))
    );
    expect(sectionWarns.length).toBe(1);
    expect(sectionWarns[0][0]).toContain(hackFile);
  });

  it('SHOULD warn once on an unknown key in a known section and ignore it', () => {
    // SETUP — typo'd key 'reseaerch_depth' in a known [pipeline] section.
    vi.stubEnv('HACK_CONFIG_HOME', join(dir, 'no-global-key'));
    const repoRoot = mkdtempSync(join(dir, 'repo-unknown-key-'));
    const hackFile = join(repoRoot, '.hack');
    writeFileSync(hackFile, '[pipeline]\nreseaerch_depth = 2\n');

    // EXECUTE
    loadHackConfig(repoRoot);

    // VERIFY — one warn naming section+key+file; the typo key did NOT seed RESEARCH_DEPTH.
    const keyWarns = warnSpy.mock.calls.filter(([m]) =>
      /unknown key \[pipeline\] reseaerch_depth/.test(String(m))
    );
    expect(keyWarns.length).toBe(1);
    expect(keyWarns[0][0]).toContain(hackFile);
    expect(process.env.RESEARCH_DEPTH).toBeUndefined(); // typo ignored, not seeded
  });

  it('SHOULD dedup warnings: a repeated unknown key in one file warns once per unique key', () => {
    // SETUP — two DIFFERENT unknown keys in one [pipeline] section (smol-toml raises on a
    // true duplicate key, so dedup across the SAME key can't be exercised via a real file).
    vi.stubEnv('HACK_CONFIG_HOME', join(dir, 'no-global-dedup'));
    const repoRoot = mkdtempSync(join(dir, 'repo-dedup-'));
    writeFileSync(
      join(repoRoot, '.hack'),
      '[pipeline]\nreseaerch_depth = 2\nreserch_timeout = 3\n'
    );

    // EXECUTE
    loadHackConfig(repoRoot);

    // VERIFY — two distinct unknown keys → two warns (one per unique key).
    const unknownKeyWarns = warnSpy.mock.calls.filter(([m]) =>
      /unknown key \[pipeline\] /.test(String(m))
    );
    expect(unknownKeyWarns.length).toBe(2);
    // Each unique key appears in exactly one call (per-key dedup).
    for (const key of ['reseaerch_depth', 'reserch_timeout']) {
      const keyWarns = warnSpy.mock.calls.filter(([m]) =>
        new RegExp(key).test(String(m))
      );
      expect(keyWarns.length).toBe(1);
    }
  });

  // --- Type / range / enum (§9.7.7) — HARD errors ---------------------------

  it('SHOULD throw on an out-of-range int naming file+section+key+range', () => {
    // SETUP — [tasks_lock] poll_ms = -5 (min:1) → out of range.
    vi.stubEnv('HACK_CONFIG_HOME', join(dir, 'no-global-range'));
    const repoRoot = mkdtempSync(join(dir, 'repo-range-'));
    const hackFile = join(repoRoot, '.hack');
    writeFileSync(hackFile, '[tasks_lock]\npoll_ms = -5\n');

    // EXECUTE & VERIFY
    expect(() => loadHackConfig(repoRoot)).toThrow(/out of range/);
    expect(() => loadHackConfig(repoRoot)).toThrow(/poll_ms/);
    expect(() => loadHackConfig(repoRoot)).toThrow(hackFile);
  });

  it('SHOULD throw on a bad enum for [harness] name listing accepted values', () => {
    // SETUP — [harness] name = "foo" (enum: pi, claude-code).
    vi.stubEnv('HACK_CONFIG_HOME', join(dir, 'no-global-enum-h'));
    const repoRoot = mkdtempSync(join(dir, 'repo-enum-h-'));
    writeFileSync(join(repoRoot, '.hack'), '[harness]\nname = "foo"\n');

    // EXECUTE & VERIFY — accepted values listed
    expect(() => loadHackConfig(repoRoot)).toThrow(
      /not one of the accepted values/
    );
    expect(() => loadHackConfig(repoRoot)).toThrow(/pi, claude-code/);
  });

  it('SHOULD throw on a bad enum for [cli] mode listing accepted values', () => {
    // SETUP — [cli] mode = "fast" (enum: normal, delta, bug-hunt, validate).
    vi.stubEnv('HACK_CONFIG_HOME', join(dir, 'no-global-enum-c'));
    const repoRoot = mkdtempSync(join(dir, 'repo-enum-c-'));
    writeFileSync(join(repoRoot, '.hack'), '[cli]\nmode = "fast"\n');

    // EXECUTE & VERIFY — all four accepted values listed
    expect(() => loadHackConfig(repoRoot)).toThrow(/accepted values/);
    expect(() => loadHackConfig(repoRoot)).toThrow(
      /normal, delta, bug-hunt, validate/
    );
  });

  it('SHOULD throw on a type mismatch where an int is required (string passed)', () => {
    // SETUP — [pipeline] research_depth = "3" as a TOML string (int expected).
    vi.stubEnv('HACK_CONFIG_HOME', join(dir, 'no-global-type-i'));
    const repoRoot = mkdtempSync(join(dir, 'repo-type-i-'));
    writeFileSync(
      join(repoRoot, '.hack'),
      '[pipeline]\nresearch_depth = "3"\n'
    );

    // EXECUTE & VERIFY
    expect(() => loadHackConfig(repoRoot)).toThrow(/expected integer/);
    expect(() => loadHackConfig(repoRoot)).toThrow(/research_depth/);
  });

  it('SHOULD throw on a type mismatch where a boolean is required (string passed)', () => {
    // SETUP — [pipeline] parallel_research = "true" as a TOML string (boolean expected).
    vi.stubEnv('HACK_CONFIG_HOME', join(dir, 'no-global-type-b'));
    const repoRoot = mkdtempSync(join(dir, 'repo-type-b-'));
    writeFileSync(
      join(repoRoot, '.hack'),
      '[pipeline]\nparallel_research = "true"\n'
    );

    // EXECUTE & VERIFY
    expect(() => loadHackConfig(repoRoot)).toThrow(/expected boolean/);
    expect(() => loadHackConfig(repoRoot)).toThrow(/parallel_research/);
  });

  it('SHOULD throw on the high bound of an int range (max exceeded)', () => {
    // SETUP — [concurrency] research_queue = 11 (max:10).
    vi.stubEnv('HACK_CONFIG_HOME', join(dir, 'no-global-max'));
    const repoRoot = mkdtempSync(join(dir, 'repo-max-'));
    writeFileSync(
      join(repoRoot, '.hack'),
      '[concurrency]\nresearch_queue = 11\n'
    );

    // EXECUTE & VERIFY
    expect(() => loadHackConfig(repoRoot)).toThrow(/out of range/);
    expect(() => loadHackConfig(repoRoot)).toThrow(/research_queue/);
  });

  // --- Relational cross-key (§9.7.5: commit.retry_delay_cap_ms ≥ retry_delay_ms) -

  it('SHOULD throw when [commit] retry_delay_cap_ms < retry_delay_ms (§9.7.5 relational)', () => {
    // SETUP — cap (100) below base delay (200000): both individually valid ints, but cap < delay.
    vi.stubEnv('HACK_CONFIG_HOME', join(dir, 'no-global-rel-throws'));
    const repoRoot = mkdtempSync(join(dir, 'repo-rel-throws-'));
    const hackFile = join(repoRoot, '.hack');
    writeFileSync(
      hackFile,
      '[commit]\nretry_delay_ms = 200000\nretry_delay_cap_ms = 100\n'
    );

    // EXECUTE & VERIFY — throws naming section + key + file + both values + 'less than'.
    expect(() => loadHackConfig(repoRoot)).toThrow(/retry_delay_cap_ms/);
    expect(() => loadHackConfig(repoRoot)).toThrow(/less than/);
    expect(() => loadHackConfig(repoRoot)).toThrow(/retry_delay_ms/);
    expect(() => loadHackConfig(repoRoot)).toThrow(hackFile);
    expect(() => loadHackConfig(repoRoot)).toThrow(/200000/);
    expect(() => loadHackConfig(repoRoot)).toThrow(/100/);
  });

  it('SHOULD accept [commit] retry_delay_cap_ms ≥ retry_delay_ms (§9.7.5 relational satisfied)', () => {
    // SETUP — cap (10000) ≥ base delay (1000): the constraint is satisfied.
    vi.stubEnv('HACK_CONFIG_HOME', join(dir, 'no-global-rel-ok'));
    const repoRoot = mkdtempSync(join(dir, 'repo-rel-ok-'));
    const hackFile = join(repoRoot, '.hack');
    writeFileSync(
      hackFile,
      '[commit]\nretry_delay_ms = 1000\nretry_delay_cap_ms = 10000\n'
    );

    // EXECUTE & VERIFY — no throw; the commit values merged through.
    expect(() => loadHackConfig(repoRoot)).not.toThrow();
  });

  it('SHOULD NOT fire the relational check when only one of the two [commit] keys is present', () => {
    // SETUP — only retry_delay_ms present; retry_delay_cap_ms omitted → the relational
    // check (which requires BOTH keys in THIS tier) is skipped.
    vi.stubEnv('HACK_CONFIG_HOME', join(dir, 'no-global-rel-one'));
    const repoRoot = mkdtempSync(join(dir, 'repo-rel-one-'));
    const hackFile = join(repoRoot, '.hack');
    writeFileSync(hackFile, '[commit]\nretry_delay_ms = 1000\n');

    // EXECUTE & VERIFY — no throw (relational check requires BOTH keys).
    expect(() => loadHackConfig(repoRoot)).not.toThrow();
  });

  // --- Debug trace (§9.7.10) -------------------------------------------------

  it('SHOULD emit a masked effective-config trace at HACKY_LOG_LEVEL=debug', () => {
    // SETUP — project .hack [pipeline] research_depth=3 + project-local .hack.local
    // [auth] override_key="sk". Debug trace must mask the secret + show source tiers.
    vi.stubEnv('HACK_CONFIG_HOME', join(dir, 'no-global-trace'));
    vi.stubEnv('HACKY_LOG_LEVEL', 'debug');
    const repoRoot = mkdtempSync(join(dir, 'repo-trace-'));
    writeFileSync(join(repoRoot, '.hack'), '[pipeline]\nresearch_depth = 3\n');
    writeFileSync(
      join(repoRoot, '.hack.local'),
      '[auth]\noverride_key = "sk"\n'
    );

    // EXECUTE
    loadHackConfig(repoRoot);

    // VERIFY — research_depth traced with its value + project source.
    const depthLine = warnSpy.mock.calls
      .map(([m]) => String(m))
      .find(m => /research_depth = 3/.test(m) && /source: project/.test(m));
    expect(depthLine).toBeDefined();

    // VERIFY — auth.override_key masked + project-local source; raw "sk" never echoed.
    const authLine = warnSpy.mock.calls
      .map(([m]) => String(m))
      .find(
        m =>
          /auth\.override_key = "<redacted>"/.test(m) &&
          /source: project-local/.test(m)
      );
    expect(authLine).toBeDefined();

    // CRITICAL — no trace line contains the raw secret value "sk".
    const traceLines = warnSpy.mock.calls.map(([m]) => String(m));
    const secretLeaks = traceLines.filter(
      m => m.includes('override_key') && !/"<redacted>"/.test(m)
    );
    expect(secretLeaks).toEqual([]);
  });

  it('SHOULD NOT emit a trace at non-debug log levels', () => {
    // SETUP — default (info) log level; same config as the trace test.
    vi.stubEnv('HACK_CONFIG_HOME', join(dir, 'no-global-no-trace'));
    const repoRoot = mkdtempSync(join(dir, 'repo-no-trace-'));
    writeFileSync(join(repoRoot, '.hack'), '[pipeline]\nresearch_depth = 3\n');

    // EXECUTE
    loadHackConfig(repoRoot);

    // VERIFY — no "source: " trace lines (HACKY_LOG_LEVEL !== 'debug').
    const traceLines = warnSpy.mock.calls
      .map(([m]) => String(m))
      .filter(m => /source: /.test(m));
    expect(traceLines).toEqual([]);
  });

  // --- Known-good config (regression: no spurious throw/warn) ----------------

  it('SHOULD load a full valid .hack mirroring §9.7.5 without throwing or warning', () => {
    // SETUP — a comprehensive valid config exercising many known sections/keys.
    vi.stubEnv('HACK_CONFIG_HOME', join(dir, 'no-global-good'));
    const repoRoot = mkdtempSync(join(dir, 'repo-good-'));
    writeFileSync(
      join(repoRoot, '.hack'),
      '[models]\nhigh = "glm-5.2"\nbalanced = "glm-5.2"\nfast = "glm-flash"\n' +
        '[harness]\nname = "pi"\n' +
        '[pipeline]\nparallel_research = true\nresearch_depth = 3\ncommit_format = "task-prefix"\n' +
        '[commit]\nretry_max = 3\nretry_delay_ms = 1000\nretry_delay_cap_ms = 10000\n' +
        '[tasks_lock]\nstale_ms = 30000\ntimeout_ms = 5000\npoll_ms = 100\n' +
        '[concurrency]\nresearch_queue = 4\nparallelism = 2\n' +
        '[cli]\nmode = "bug-hunt"\nlog_level = "info"\nmachine_readable = false\n'
    );

    // EXECUTE
    const cfg = loadHackConfig(repoRoot);

    // VERIFY — no throw; no validation warnings (no unknown-section/key messages).
    const validationWarns = warnSpy.mock.calls.filter(([m]) =>
      /unknown (section|key)/.test(String(m))
    );
    expect(validationWarns).toEqual([]);
    expect(cfg.harness?.name).toBe('pi');
    expect(cfg.pipeline?.research_depth).toBe(3);
    expect(cfg.cli?.mode).toBe('bug-hunt');
  });
});
