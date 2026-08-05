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
