# PRP — P2.M1.T1.S2: Three-tier discovery, layered merge, env-over-file seeding

---

## Goal

**Feature Goal**: Implement PRD §9.7.3 (Discovery, Layering & File Locations) +
§9.2.1 (env-over-file rule) on top of P2.M1.T1.S1's `parseHackFile`: a SYNC
`loadHackConfig(repoRoot: string): MergedHackConfig` that **discovers up to three
optional tier files** (global → project → project-local), **layers them per-section/key**
(each higher tier overwrites the same key from a lower tier), and **seeds `process.env`
ONLY for keys not already set** (so real shell env / `.env` win — §9.2.1 env-over-file).
Then wire the load into `main()` between the §9.8 chdir and `configureEnvironment()`
(§9.7.9 bootstrap ordering).

**Deliverable** (all in `src/config/hack-config.ts`, the file S1 created — S2 ADDS to it):
1. **`HackConfigTier` type** + **`MergedHackConfig` interface** (extends `ParsedHackConfig`
   with a `_sources` metadata map `"section.key" → tier`).
2. **Provisional env-var mapping** (`HACK_KEY_TO_ENV: Record<string, string>`) covering all
   28 §9.7.5 env-var keys (self-contained literal strings; `@provisional` — P2.M2.T1.S1
   reconciles against `constants.ts`).
3. **`loadHackConfig(repoRoot): MergedHackConfig`** — discover (existsSync-first) → parse
   (S1's `parseHackFile`) → per-section/key layered merge with `_sources` attribution →
   seed `process.env` only-for-undefined-keys.
4. **Wire into `src/index.ts` `main()`**: call `loadHackConfig(repoRoot)` immediately before
   `configureEnvironment()` (after the chdir/PRD-check), per §9.7.9.
5. **Mode-A JSDoc** documenting tier order, env-over-file seeding rule, and bootstrap position.
6. **`tests/unit/config/hack-config.test.ts`** — EXTEND S1's file: add `describe('loadHackConfig')`
   covering discovery/merge/seeding/env-over-file/coverage branches (real temp files +
   `vi.stubEnv`).

**Success Definition**:
- `loadHackConfig(repoRoot)` discovers global (`$HACK_CONFIG_HOME/config` →
  `$XDG_CONFIG_HOME/hack/config` → `~/.hack`), `<repoRoot>/.hack`, `<repoRoot>/.hack.local`;
  a missing tier is silently skipped (NOT an error).
- Each higher tier overwrites the same `[section].key` from a lower tier via per-section
  nested spread (lower-tier siblings in the same section survive); `_sources['section.key']`
  records the winning tier.
- For each merged key present in `HACK_KEY_TO_ENV`, if `process.env[ENV] === undefined`, set
  `process.env[ENV] = String(value)`; otherwise leave the env var untouched (env-over-file).
  CLI-only keys (not in the map) are NOT seeded.
- `main()` calls `loadHackConfig(repoRoot)` before `configureEnvironment()` (verified by
  reading `src/index.ts`).
- `npm run typecheck && npm run lint && npm run format:check` clean; `npx vitest run
  tests/unit/config/hack-config.test.ts` GREEN with **100% coverage** on
  `src/config/hack-config.ts`; `npm run build` compiles.
- S2 does NOT add secrets refusal (P2.M1.T2.S1), type/range validation (P2.M1.T2.S1), the
  `hack config` subcommand (P2.M2.T2), or .gitignore handling (P2.M2.T3).

---

## Why

- **Realizes §9.2.1 layers 2–4 + the env-over-file rule.** A committed `<repoRoot>/.hack`
  becomes the team default; `~/.hack` is personal cross-project defaults; `.hack.local` is
  per-developer overrides/secrets. Because seeding fills ONLY undefined env keys, CI and
  ad-hoc `VAR=val hack` always win — which is exactly what makes `.hack` safe to commit.
- **Foundational for P2.M1.T2 / P2.M2.** P2.M1.T2.S1 (secrets refusal + type/range
  validation) operates on the `MergedHackConfig` S2 produces; P2.M2.T1.S1 reconciles the
  provisional `HACK_KEY_TO_ENV` against `constants.ts`; P2.M2.T2 (`hack config show`) reads
  `_sources` for `--src`. S2 is the contract output they consume.
- **Bootstrap position is load-bearing (§9.7.9).** Project files live at `repoRoot` (known
  only after the §9.8 chdir), and the seeded env must be in place before
  `configureEnvironment()` resolves the base URL / auth. Wiring it between chdir and
  configureEnvironment satisfies both, and the env-over-file seeding keeps shell/.env on top.
- **Out of scope (hard boundaries):** secrets policy §9.7.6 (P2.M1.T2.S1), type/range/unknown-
  key validation §9.7.7 (P2.M1.T2.S1), exhaustive canonical schema map (P2.M2.T1.S1), the
  `hack config` subcommand §9.7.8 (P2.M2.T2), .gitignore management + tracked-.hack.local
  warning (P2.M2.T3), repo-root resolution itself (P1 — already complete; S2 takes a path),
  modifying S1's `parseHackFile` (S2 imports it).

---

## What

### User-visible behavior
Once wired: a `<repoRoot>/.hack`, `~/.hack`, and/or `<repoRoot>/.hack.local` TOML file
silently supplies defaults for the pipeline's env-backed tunables (models, endpoint,
harness, timeouts, etc.) — unless the shell/`.env` already set them. No new CLI surface in
S2 (the `hack config` subcommand is P2.M2.T2). A malformed/BOM tier file still throws the
S1-attributed error and aborts startup.

### Technical requirements (exact contract)

**`src/config/hack-config.ts`** — ADD to S1's file (keep `parseHackFile`/`ParsedHackConfig`/
`HackConfigValue` unchanged). New imports: `existsSync` from `node:fs`; `os` from `node:os`;
`path` from `node:path`. (S1 already imports `readFileSync` from `node:fs` — extend that import.)

```ts
/**
 * Which discovery tier a `.hack` value was sourced from (PRD §9.7.3).
 *
 * @remarks Order lowest→highest: 'global' → 'project' → 'project-local'. A higher tier
 * overwrites the same `[section].key` from a lower tier; {@link MergedHackConfig._sources}
 * records the winning tier per key (consumed by `hack config show --src`, P2.M2.T2).
 */
export type HackConfigTier = 'global' | 'project' | 'project-local';

/**
 * The layered `.hack` configuration after merging all discovered tiers (PRD §9.7.3).
 *
 * @remarks Extends {@link ParsedHackConfig} (the merged sections) with `_sources`: a map of
 * `"section.key"` → {@link HackConfigTier} recording which tier each value came from. The
 * tier strings satisfy the section index (they are strings ⊂ {@link HackConfigValue}), so
 * this typechecks — but note `Object.keys()` over a `MergedHackConfig` includes `_sources`;
 * consumers iterating sections must skip the `_`-prefixed key (the env-seeding loop does so
 * naturally because `_sources` is not in {@link HACK_KEY_TO_ENV}).
 */
export interface MergedHackConfig extends ParsedHackConfig {
  readonly _sources: Record<string, HackConfigTier>;
}

/**
 * Provisional TOML `"section.key"` → env-var-name mapping (PRD §9.7.5).
 *
 * @remarks
 * **@provisional** — covers all 28 §9.7.5 keys that map to a `process.env` var. The
 * EXHAUSTIVE canonical mapping (reconciling these literals against the `export const`
 * env-var names in `config/constants.ts` — 22 of 28 already exist) lands in P2.M2.T1.S1.
 * Keys that map to a CLI flag ONLY (e.g. `[concurrency] parallelism`, `[cli] mode`,
 * `[monitor] enabled`) are deliberately ABSENT here — they are never seeded to `process.env`
 * (consumed by the CLI from {@link MergedHackConfig} in a later phase). `[auth] override_key`
 * is also absent: §9.7.9 maps it to `PRP_API_KEY`, but it is secret-bearing and handled by
 * the secrets policy (§9.7.6, P2.M1.T2.S1) + the full schema (P2.M2.T1.S1).
 */
const HACK_KEY_TO_ENV: Readonly<Record<string, string>> = {
  'models.high': 'PRP_MODEL_HIGH',
  'models.balanced': 'PRP_MODEL_BALANCED',
  'models.fast': 'PRP_MODEL_FAST',
  'endpoint.base_url': 'PRP_API_BASE_URL',
  'harness.name': 'PRP_AGENT_HARNESS',
  'pipeline.parallel_research': 'PARALLEL_RESEARCH',
  'pipeline.research_depth': 'RESEARCH_DEPTH',
  'pipeline.research_timeout_seconds': 'RESEARCH_TIMEOUT',
  'pipeline.issue_retry_max': 'ISSUE_RETRY_MAX',
  'pipeline.commit_format': 'PRP_COMMIT_FORMAT',
  'commit.retry_max': 'COMMIT_RETRY_MAX',
  'commit.retry_delay_ms': 'COMMIT_RETRY_DELAY',
  'commit.retry_delay_cap_ms': 'COMMIT_RETRY_DELAY_CAP',
  'commit.classifier_retry_max': 'CLASSIFIER_RETRY_MAX',
  'bug_hunt.finder_agent': 'BUG_FINDER_AGENT',
  'bug_hunt.results_file': 'BUG_RESULTS_FILE',
  'bug_hunt.fix_scope': 'BUGFIX_SCOPE',
  'validation.agent': 'VALIDATION_AGENT',
  'validation.timeout_seconds': 'VALIDATION_TIMEOUT',
  'distributed_prd.include_max_depth': 'PRD_INCLUDE_MAX_DEPTH',
  'distributed_prd.include_markers': 'PRD_INCLUDE_MARKERS',
  'tasks_lock.stale_ms': 'TASKS_LOCK_STALE_MS',
  'tasks_lock.timeout_ms': 'TASKS_LOCK_TIMEOUT_MS',
  'tasks_lock.poll_ms': 'TASKS_LOCK_POLL_MS',
  'concurrency.research_queue': 'RESEARCH_QUEUE_CONCURRENCY',
  'api.timeout_ms': 'API_TIMEOUT_MS',
  'monitor.task_interval': 'MONITOR_TASK_INTERVAL',
  'cli.log_level': 'HACKY_LOG_LEVEL',
};

/** Resolve the global-tier `.hack` path (PRD §9.7.3). */
function globalHackPath(): string {
  if (process.env.HACK_CONFIG_HOME) {
    return path.join(process.env.HACK_CONFIG_HOME, 'config');
  }
  if (process.env.XDG_CONFIG_HOME) {
    return path.join(process.env.XDG_CONFIG_HOME, 'hack', 'config');
  }
  return path.join(os.homedir(), '.hack');
}

/**
 * Merge an overlay tier into the running merged config + sources (PRD §9.7.3 per-section/key).
 * Each overlay key overwrites the same key from a lower tier; sibling keys in the same
 * section survive (nested object spread per section).
 */
function mergeTier(
  base: ParsedHackConfig,
  overlay: ParsedHackConfig,
  tier: HackConfigTier,
  sources: Record<string, HackConfigTier>
): void {
  for (const [section, keys] of Object.entries(overlay)) {
    base[section] = { ...(base[section] ?? {}), ...keys };
    for (const key of Object.keys(keys)) {
      sources[`${section}.${key}`] = tier;
    }
  }
}

/**
 * Seed `process.env` from the merged config, ONLY for keys not already set (PRD §9.2.1
 * env-over-file rule). CLI-only keys (absent from {@link HACK_KEY_TO_ENV}) are skipped.
 */
function seedProcessEnv(merged: ParsedHackConfig): void {
  for (const [section, keys] of Object.entries(merged)) {
    for (const [key, value] of Object.entries(keys)) {
      const envName = HACK_KEY_TO_ENV[`${section}.${key}`];
      if (envName && process.env[envName] === undefined) {
        process.env[envName] = String(value);
      }
    }
  }
}

/**
 * Discover, merge, and seed `.hack` configuration for a repository (PRD §9.7.3 / §9.2.1).
 *
 * @remarks
 * **Tier order (lowest → highest):** (1) global `$HACK_CONFIG_HOME/config`, else
 * `$XDG_CONFIG_HOME/hack/config`, else `~/.hack`; (2) project `<repoRoot>/.hack`
 * (committable); (3) project-local `<repoRoot>/.hack.local` (gitignored). A missing file
 * at any tier is NOT an error (that tier contributes nothing). Each higher tier overwrites
 * the same `[section].key` from a lower tier (per-section nested merge — sibling keys
 * survive).
 *
 * **Env-over-file seeding (§9.2.1):** after merging, for each key mapped to an env var
 * (per the §9.7.5 schema), if `process.env[ENV]` is UNDEFINED it is set to `String(value)`
 * (bool→"true", number→"1800", string passthrough). If the env var is already set (by shell
 * or `.env`), the file value does NOT override it — real env wins. CLI-only keys are stored
 * only in the returned {@link MergedHackConfig} (NOT seeded).
 *
 * **Bootstrap position (§9.7.9):** called in `main()` AFTER the §9.8 repo-root `chdir`
 * (project files live at `repoRoot`) and BEFORE `configureEnvironment()` (so seeded values
 * are visible to the env resolver) — preserving `parseCLIArgs → chdir → .hack load →
 * configureEnvironment → configureHarness → runAuthPreflight`.
 *
 * SYNC. Mutates `process.env` as an intentional side effect. Does NOT enforce the secrets
 * policy (§9.7.6) or type/range validation (§9.7.7) — those are P2.M1.T2.S1 layers applied
 * to this function's output.
 *
 * @param repoRoot - The repository root (post-chdir; project files are read from here).
 * @returns The merged config + per-key `_sources` attribution.
 * @throws {Error} if an EXISTING tier file is malformed/BOM (rethrown from {@link parseHackFile}
 *   with the file path + line/column). A missing file does NOT throw.
 *
 * @example
 * ```ts
 * import { loadHackConfig } from './config/hack-config.js';
 *
 * const cfg = loadHackConfig(repoRoot);
 * // cfg.pipeline?.research_depth === 3; cfg._sources['pipeline.research_depth'] === 'project'
 * ```
 */
export function loadHackConfig(repoRoot: string): MergedHackConfig {
  const tiers: ReadonlyArray<{ tier: HackConfigTier; file: string }> = [
    { tier: 'global', file: globalHackPath() },
    { tier: 'project', file: path.join(repoRoot, '.hack') },
    { tier: 'project-local', file: path.join(repoRoot, '.hack.local') },
  ];

  const merged: ParsedHackConfig = {};
  const sources: Record<string, HackConfigTier> = {};

  for (const { tier, file } of tiers) {
    if (!existsSync(file)) continue; // missing tier is not an error (§9.7.3)
    const parsed = parseHackFile(file); // S1 — throws ENOENT only if file vanishes mid-run; BOM/malformed rethrow
    mergeTier(merged, parsed, tier, sources);
  }

  seedProcessEnv(merged);

  return { ...merged, _sources: sources };
}
```

**`src/index.ts` `main()`** — wire the load before `configureEnvironment()` (after the chdir
+ PRD-exists check, ~line 132; `configureEnvironment()` is ~line 133):
```ts
  // (existing) if (!existsSync(args.prd)) { ... return 1; }
  // (existing) setupGlobalHandlers(args.verbose);

  // PRD §9.7.9 / §9.2.1: load .hack (global → project → project-local) AFTER the §9.8 chdir
  // (project files live at repoRoot) and BEFORE configureEnvironment() (so seeded values are
  // visible to the env resolver). Env-over-file: seeding fills ONLY undefined env keys, so
  // shell/.env still win (§9.2.1). Secrets/type validation (§9.7.6/§9.7.7) are P2.M1.T2.S1.
  loadHackConfig(repoRoot);   // repoRoot is in scope from the resolveRepositoryRoot call above

  configureEnvironment();     // (existing — unchanged)
```
Use the in-scope `repoRoot` (line ~116) — it equals `getRepoRoot()` (same cached value) but
avoids a redundant call + the pre-bootstrap throw. Import `loadHackConfig` from
`./config/hack-config.js` alongside the existing `configureEnvironment` import (line ~38).

### Success Criteria
- [ ] `loadHackConfig(repoRoot)` discovers the 3 tiers (global via env-override cascade,
      project + project-local under repoRoot); a missing tier is skipped, not an error.
- [ ] Higher tier overwrites same `[section].key`; lower-tier siblings in the same section
      survive; `_sources['section.key']` records the winning tier.
- [ ] For mapped keys with `process.env[ENV] === undefined`, sets `String(value)`; an
      already-set env var is left untouched; CLI-only keys are NOT seeded.
- [ ] `main()` calls `loadHackConfig(repoRoot)` before `configureEnvironment()` (read index.ts).
- [ ] `MergedHackConfig` extends `ParsedHackConfig` + `_sources`; typechecks clean.
- [ ] `npm run typecheck && npm run lint && npm run format:check` clean.
- [ ] `npx vitest run tests/unit/config/hack-config.test.ts` GREEN with 100% coverage on the module.
- [ ] S2 does NOT add secrets refusal / type validation / the subcommand / .gitignore handling.

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_
**Yes.** The verbatim `loadHackConfig` + helpers are given (§"Technical requirements"). The
S1 contract (`parseHackFile` throws ENOENT → existsSync-first) is proven. The §9.7.3 tier
paths + global cascade are quoted from the PRD. The §9.7.9 bootstrap position is verified in
`src/index.ts` (chdir ~119 → PRD check → configureEnvironment ~133). The env-over-file rule
(`=== undefined`, env wins) is quoted from §9.2.1. The provisional mapping covers all 28
§9.7.5 env keys (literal strings; 22 of 28 already exist in constants.ts — P2.M2.T1.S1
reconciles). The `MergedHackConfig` typecheck + iteration gotcha is explained. The 100%-
coverage branch map + test recipe (temp files + vi.stubEnv + the .env-load gotcha) are spelled out.

### Documentation & References
```yaml
# MUST READ — the PRD spec this implements
- docfile: plan/009_94353b1a9fd3/prd_snapshot.md
  section: "9.7.3 Discovery, Layering & File Locations"
  why: The 3-tier table (global cascade $HACK_CONFIG_HOME→$XDG_CONFIG_HOME→~/.hack; project
        <repoRoot>/.hack; project-local <repoRoot>/.hack.local); missing-tier-not-an-error;
        per-key overwrite; merged result seeded into process.env ONLY for keys not already set.
- docfile: plan/009_94353b1a9fd3/prd_snapshot.md
  section: "9.2.1 Configuration Source Priority"
  why: The env-over-file rule ("Real environment variables (layers 5–6) take precedence over
        file configuration (layers 2–4)") + the load sequence (resolve repo root → chdir →
        global → project → .hack.local → .env → shell env → CLI flags).
- docfile: plan/009_94353b1a9fd3/prd_snapshot.md
  section: "9.7.5 Schema Reference"
  why: The EXHAUSTIVE schema table — the source of the provisional HACK_KEY_TO_ENV mapping
        (28 env-var keys + ~10 CLI-only keys). "A key with both an env var and a CLI flag
        seeds both" + "only one TOML key exists per concept."
- docfile: plan/009_94353b1a9fd3/prd_snapshot.md
  section: "9.7.9 Interaction with Existing Subsystems"
  why: The bootstrap ordering (parseCLIArgs → repo-root+chdir → .hack load →
        configureEnvironment → configureHarness → runAuthPreflight → pipeline) + §9.2.1
        precedence note + §9.2.5 child-process inheritance (children inherit seeded env).

# MUST READ — S1's PRP (the contract input; defines parseHackFile + ParsedHackConfig)
- docfile: plan/009_94353b1a9fd3/P2M1T1S1/PRP.md
  section: "Technical requirements", "What"
  why: S1 creates src/config/hack-config.ts with parseHackFile (SYNC, BOM reject, TomlError
        rethrow w/ line+col), ParsedHackConfig, HackConfigValue. CRITICAL: parseHackFile
        THROWS ENOENT on a missing file → S2 must existsSync BEFORE calling it. S2 ADDS to
        this file; do not modify parseHackFile.

# MUST READ — this subtask's research (verbatim impl + branch map + boundaries)
- docfile: plan/009_94353b1a9fd3/P2M1T1S2/research/three-tier-discovery-and-seeding-design.md
  section: §2 insertion point, §3 discovery, §4 provisional mapping (+ 22/28 exist), §5 merge,
           §6 env-over-file (=== undefined), §7 MergedHackConfig type, §8 boundaries, §9 tests
  why: Verified facts: existsSync-first (S1 throws ENOENT); per-section nested merge (shallow
        would drop sibling keys); === undefined (NOT also-empty — env wins even if empty);
        _sources typechecks (tier strings ⊂ HackConfigValue); the .env-load test gotcha.

# MUST READ — architecture (config system + schema surface + bootstrap data flow)
- docfile: plan/009_94353b1a9fd3/architecture/system_context.md
  section: "3.3 Config System Architecture", "3.4 Complete Schema Surface"
  why: Confirms bootstrap data flow + "The .hack loader must insert BETWEEN chdir and
        configureEnvironment()" + the full TOML→env→CLI mapping table (cross-check §9.7.5).
  critical: §3.4 lists which env vars are "(not in constants.ts — inline)" / "(not currently
        defined)" → confirms the 6 provisional literals (BUG_RESULTS_FILE, BUGFIX_SCOPE,
        RESEARCH_QUEUE_CONCURRENCY, API_TIMEOUT_MS, MONITOR_TASK_INTERVAL, HACKY_LOG_LEVEL).

# THE FILE TO EDIT — S1's module (S2 ADDS loadHackConfig + types + helpers)
- file: src/config/hack-config.ts
  why: ADD HackConfigTier, MergedHackConfig, HACK_KEY_TO_ENV, globalHackPath, mergeTier,
        seedProcessEnv, loadHackConfig. Extend the node:fs import (+ existsSync); add os, path.
  pattern: mirror S1's JSDoc density + SYNC style. parseHackFile/ParsedHackConfig UNCHANGED.
  gotcha: existsSync BEFORE parseHackFile (S1 throws ENOENT on missing). Keep HACK_KEY_TO_ENV
        Readonly + the module self-contained (no constants.ts imports — provisional).

# THE BOOTSTRAP WIRING — exact insertion point
- file: src/index.ts
  why: In main(), call loadHackConfig(repoRoot) immediately before configureEnvironment()
        (after the PRD-exists check + setupGlobalHandlers). Import alongside configureEnvironment (line ~38).
  pattern: "import { configureEnvironment } from './config/environment.js';" → add loadHackConfig
        from './config/hack-config.js'.
  gotcha: use the in-scope repoRoot (line ~116), NOT getRepoRoot() (redundant; same cached value).

# CONTRACT — the accessor (reused, not modified)
- file: src/utils/repo-root.ts
  why: getRepoRoot() (line 143) reads the cached _repoRoot set by resolveRepositoryRoot. In
        main() repoRoot is already in scope (line ~116) — prefer it. DO NOT edit this file.

# PATTERN FILES — fs/os/path + test style
- file: src/config/hack-config.ts (S1's parseHackFile)
  why: S1's `import { readFileSync } from 'node:fs'` + SYNC read convention — extend the node:fs
        import to add existsSync. Mirror S1's error-attribution JSDoc style for loadHackConfig.
- file: tests/unit/config/hack-config.test.ts (S1's test file)
  why: S1 uses real TOML temp files (mkdtempSync) + BDD describe/it/expect. EXTEND this file:
        add describe('loadHackConfig') using mkdtempSync for tier files + vi.stubEnv for
        HACK_CONFIG_HOME/XDG_CONFIG_HOME/HOME + delete specific env keys before each test.
  pattern: "import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';"
  gotcha: tests/setup.ts loads .env → real env may pre-set a seeded key; DELETE the specific
        key before each load test or seeding is skipped (false pass). afterEach vi.unstubAllEnvs.
```

### Current Codebase tree (relevant slice — S2 adds to S1's file + wires main)
```bash
src/config/hack-config.ts        # S1 created (parseHackFile + types); S2 ADDS loadHackConfig + MergedHackConfig + HACK_KEY_TO_ENV + helpers
src/config/constants.ts          # existing — 22/28 env-var-name consts exist (provisional mapping's reconciliation target; NOT edited by S2)
src/config/environment.ts        # existing — configureEnvironment() reads process.env (NOT edited)
src/index.ts                     # EDIT — +1 import + 1 call (loadHackConfig before configureEnvironment)
src/utils/repo-root.ts           # existing — getRepoRoot() (read-only; repoRoot already in scope in main())
tests/unit/config/hack-config.test.ts   # S1 created (parse tests); S2 EXTENDS (+ describe('loadHackConfig'))
```

### Desired Codebase tree with files to be added/edited
```bash
src/config/hack-config.ts                 # MODIFIED (S2 adds loadHackConfig + MergedHackConfig + HackConfigTier + HACK_KEY_TO_ENV + helpers + JSDoc)
src/index.ts                              # MODIFIED (+import loadHackConfig; +1 call before configureEnvironment in main())
tests/unit/config/hack-config.test.ts     # MODIFIED (S2 adds describe('loadHackConfig') suite)
```

### Known Gotchas of our codebase & Library Quirks
```ts
// CRITICAL — existsSync BEFORE parseHackFile. S1's parseHackFile THROWS ENOENT on a missing file
//   (readFileSync propagates). A missing tier is NOT an error (§9.7.3) → guard with existsSync first:
//   `if (!existsSync(file)) continue; const parsed = parseHackFile(file);`

// CRITICAL — env-over-file uses process.env[X] === undefined (NOT also-empty). §9.2.1 says real env
//   (layers 5–6) wins over files (2–4); an exported empty env var IS set → env wins → NOT overridden.
//   Treating '' as unset would VIOLATE env-over-file. Use === undefined.

// CRITICAL — per-section nested merge, NOT shallow. A shallow {...global, ...project} REPLACES an
//   entire section, losing lower-tier sibling keys. Merge per section: result[section] = {...(result[section]
//   ?? {}), ...overlay[section]}. Lower-tier siblings in the same section MUST survive.

// GOTCHA — HACK_KEY_TO_ENV is PROVISIONAL literal strings (self-contained; no constants.ts import).
//   22 of 28 names already exist as export const / MODEL_ENV_VARS values in constants.ts; P2.M2.T1.S1
//   reconciles. Do NOT import the constants now (6 don't exist → import error risk; uniform literals
//   are the lowest-risk "provisional"). CLI-only keys + [auth] override_key are deliberately ABSENT.

// GOTCHA — MergedHackConfig extends ParsedHackConfig + _sources. _sources: Record<string, HackConfigTier>
//   typechecks because tier strings ⊂ string ⊂ HackConfigValue (index covariant). But Object.keys(merged)
//   INCLUDES _sources (it satisfies the section index) — consumers iterating sections must skip the
//   _-prefix; the seedProcessEnv loop naturally skips it (not in HACK_KEY_TO_ENV). If `readonly` on
//   _sources clashes with the mutable index at typecheck, drop `readonly`.

// GOTCHA — tests/setup.ts loads .env at suite start → real process.env may pre-set a seeded key. In
//   loadHackConfig tests, DELETE the specific env key before each test or seeding is skipped (false pass).
//   afterEach: vi.unstubAllEnvs().

// GOTCHA — prettier is ERROR-enforced (format:check). Run `npm run fix` before validate. 100% coverage
//   globally enforced (vitest.config.ts) — cover EVERY branch: existsSync true/false ×3 tiers, key in/not-
//   in HACK_KEY_TO_ENV, env set/unset, each tier winning the merge, no-files-at-all, parseHackFile error
//   propagation on an existing tier.

// GOTCHA — String(value) coercion: TOML bool true→"true", int 1800→"1800", string passthrough. Matches the
//   existing getter pattern Number(process.env[X] ?? DEFAULT) + boolean getters in constants.ts.

// GOTCHA — use the in-scope `repoRoot` in main() (line ~116), not getRepoRoot(). Both equal the cached
//   _repoRoot; the in-scope value avoids a redundant call + the pre-bootstrap throw. (Contract said
//   getRepoRoot(); in-scope is strictly cleaner and equivalent.)
```

---

## Implementation Blueprint

### Data models and structure
No new runtime types beyond `HackConfigTier` + `MergedHackConfig` (extends `ParsedHackConfig`
+ `_sources`). `HACK_KEY_TO_ENV` is a `Readonly<Record<string,string>>` constant. All SYNC.

### Implementation Tasks (ordered by dependencies)
```yaml
Task 1: EDIT src/config/hack-config.ts — types + provisional mapping + helpers
  - ADD imports: extend `import { readFileSync, existsSync } from 'node:fs'`; add `import os from 'node:os'`;
        `import path from 'node:path'`. (Keep S1's `import { parse, TomlError } from 'smol-toml'`.)
  - ADD `export type HackConfigTier = 'global' | 'project' | 'project-local';`
  - ADD `export interface MergedHackConfig extends ParsedHackConfig { readonly _sources: Record<string, HackConfigTier>; }`
        (see "Gotchas" — drop `readonly` if it clashes with the mutable index at typecheck).
  - ADD `const HACK_KEY_TO_ENV: Readonly<Record<string, string>> = { …28 entries… };` (verbatim from
        "Technical requirements"; @provisional JSDoc).
  - ADD private `globalHackPath()`, `mergeTier(base, overlay, tier, sources)`, `seedProcessEnv(merged)`.
  - ADD `export function loadHackConfig(repoRoot: string): MergedHackConfig` (verbatim from "Technical
        requirements"). DO NOT modify S1's parseHackFile/ParsedHackConfig/HackConfigValue.
  - EXPECTED: typecheck GREEN (verify _sources vs index; drop readonly if needed).

Task 2: EDIT src/index.ts — wire loadHackConfig before configureEnvironment
  - ADD to the config import block (~line 38): `import { loadHackConfig } from './config/hack-config.js';`
        (alongside the existing `configureEnvironment` import from './config/environment.js').
  - In main(), immediately BEFORE `configureEnvironment();` (~line 133), add:
        `loadHackConfig(repoRoot);` with the §9.7.9/§9.2.1 comment (see "Technical requirements").
  - Use the in-scope `repoRoot` (line ~116) — NOT getRepoRoot().
  - DO NOT change configureEnvironment() / its call ordering / anything else in main().
  - EXPECTED: typecheck GREEN; main() now loads .hack before env resolution.

Task 3: EDIT tests/unit/config/hack-config.test.ts — EXTEND S1's file with describe('loadHackConfig')
  - IMPORTS: add `existsSync, mkdtempSync, writeFileSync, mkdirSync` from 'node:fs'; `tmpdir` from 'node:os';
        `path` + `vi` (S1 imports vi). Re-use S1's parseHackFile/ParsedHackConfig imports if helpful.
  - ADD describe('loadHackConfig') with beforeEach/afterEach: afterEach(() => vi.unstubAllEnvs()); beforeEach
        deletes the specific seeded env keys under test (the .env-load gotcha).
  - CASES (cover EVERY branch for 100%):
      * no files at all (no global/project/local) → returns MergedHackConfig with empty sections + empty
        _sources; NO process.env mutation (assert a sentinel key stays undefined).
      * global only (stub HACK_CONFIG_HOME → temp dir + config file) → merged = global; _sources all 'global';
        env seeded (assert process.env[ENV] === String(value)).
      * project only (temp repoRoot + .hack) → merged = project; _sources 'project'; env seeded.
      * project-local only (temp repoRoot + .hack.local) → merged = project-local; _sources 'project-local'.
      * ALL THREE with per-section/key overlap: global [pipeline] research_depth=2; project [pipeline]
        issue_retry_max=5 + [harness] name="pi"; project-local [pipeline] research_depth=3. ASSERT merged has
        research_depth=3 (project-local won), issue_retry_max=5 (project, survived), harness.name="pi";
        _sources: pipeline.research_depth='project-local', pipeline.issue_retry_max='project',
        harness.name='project'. (Proves per-section nested merge + sibling survival.)
      * missing tier skipped (only global + project-local exist, no .hack) → not an error; both merge.
      * env-over-file: pre-set process.env['RESEARCH_DEPTH']='99' then loadHackConfig → process.env['RESEARCH_DEPTH']
        stays '99' (NOT overwritten); assert the file value did not leak.
      * CLI-only key NOT seeded: [cli] mode="bug-hunt" in a file → process.env has NO equivalent (absent from
        HACK_KEY_TO_ENV); assert it's in MergedHackConfig but not in process.env.
      * coercion: [pipeline] parallel_research=true → process.env['PARALLEL_RESEARCH']==="true"; int 1800 → "1800".
      * XDG fallback: unset HACK_CONFIG_HOME, stub XDG_CONFIG_HOME → global = $XDG/hack/config.
      * HOME fallback: unset both HACK_CONFIG_HOME + XDG_CONFIG_HOME, stub os.homedir via HOME → global = ~/.hack.
      * parseHackFile error propagation: an EXISTING project .hack with BOM (or malformed TOML) → loadHackLog
        THROWS the S1-attributed error (file path + BOM/line/col); assert it rejects/throws. (Proves the
        existsSync-first guard does NOT swallow parse errors on existing files.)
  - EXPECTED: GREEN; 100% coverage on src/config/hack-config.ts (S1's parse branches still covered too).

Task 4: FORMAT + VERIFY
  - RUN: npm run fix → npm run typecheck → npm run lint → npm run format:check. (MUST be clean.)
  - RUN: npx vitest run tests/unit/config/hack-config.test.ts --coverage (GREEN; 100% on hack-config.ts).
  - RUN: npm run build (compiles — smol-toml/os/path/existsSync resolve).
  - RUN: npm run test:run (full suite — must stay green; this plan has no pre-existing-red suite).
  - RUN: grep -n "loadHackConfig(repoRoot)" src/index.ts (EXPECTED: one call, before configureEnvironment()).
  - EXPECTED: all green; loadHackConfig wired; no regression.
```

### Implementation Patterns & Key Details
```ts
// ---- discovery: existsSync FIRST (S1 throws ENOENT on missing) ----
for (const { tier, file } of tiers) {
  if (!existsSync(file)) continue;       // missing tier is not an error (§9.7.3)
  const parsed = parseHackFile(file);    // existing file → S1 parses (BOM/malformed rethrows)
  mergeTier(merged, parsed, tier, sources);
}

// ---- per-section nested merge (NOT shallow — siblings survive) ----
function mergeTier(base, overlay, tier, sources) {
  for (const [section, keys] of Object.entries(overlay)) {
    base[section] = { ...(base[section] ?? {}), ...keys };   // nested object spread per section
    for (const key of Object.keys(keys)) sources[`${section}.${key}`] = tier;
  }
}

// ---- env-over-file: === undefined (env wins, even if empty) ----
function seedProcessEnv(merged) {
  for (const [section, keys] of Object.entries(merged)) {
    for (const [key, value] of Object.entries(keys)) {
      const envName = HACK_KEY_TO_ENV[`${section}.${key}`];
      if (envName && process.env[envName] === undefined) process.env[envName] = String(value);
    }
  }
}

// ---- main() wiring (src/index.ts, before configureEnvironment) ----
loadHackConfig(repoRoot);   // in-scope repoRoot (== getRepoRoot()); §9.7.9: after chdir, before configureEnvironment
configureEnvironment();
```

### Integration Points
```yaml
MODULE (src/config/hack-config.ts):
  - + HackConfigTier (type); + MergedHackConfig (extends ParsedHackConfig + _sources).
  - + HACK_KEY_TO_ENV (provisional, 28 §9.7.5 env keys; @provisional → P2.M2.T1.S1).
  - + globalHackPath() / mergeTier() / seedProcessEnv() (private); + loadHackConfig() (exported).
  - imports: + existsSync (node:fs); + os (node:os); + path (node:path). parseHackFile UNCHANGED.

BOOTSTRAP (src/index.ts main()):
  - + import loadHackConfig (alongside configureEnvironment import).
  - + loadHackConfig(repoRoot) call immediately before configureEnvironment() (after chdir + PRD check).
  - use in-scope repoRoot (NOT getRepoRoot() — redundant, same cached value).

TESTS (tests/unit/config/hack-config.test.ts):
  - + describe('loadHackConfig'): temp tier files (mkdtempSync) + vi.stubEnv (HACK_CONFIG_HOME/
    XDG_CONFIG_HOME/HOME) + per-test env-key deletion (the .env-load gotcha).

NO CHANGES TO (hard boundary):
  - S1's parseHackFile / ParsedHackConfig / HackConfigValue (S2 imports/extends them).
  - constants.ts (22/28 consts exist; provisional mapping defers reconciliation to P2.M2.T1.S1).
  - environment.ts configureEnvironment() (reads process.env — seeded values visible to it, unchanged).
  - repo-root.ts (repoRoot already in scope in main()).
  - secrets policy §9.7.6 (P2.M1.T2.S1) / type+range validation §9.7.7 (P2.M1.T2.S1) / hack config
    subcommand §9.7.8 (P2.M2.T2) / .gitignore handling (P2.M2.T3).
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
npm run fix            # lint:fix + prettier --write (run first)
npm run typecheck      # tsc --noEmit -p tsconfig.build.json — watch the _sources vs index gotcha
npm run lint           # eslint . --ext .ts
npm run format:check   # prettier --check
# Targeted:
npx eslint src/config/hack-config.ts src/index.ts
npx prettier --check src/config/hack-config.ts src/index.ts
# Expected: clean. Likely failure: _sources readonly vs the mutable section index → drop `readonly`.
#   Or a 6th-imports error if os/path/existsSync misspellings — fix to node:os / node:path / node:fs.
```

### Level 2: Unit Tests (Component Validation)
```bash
# The discovery/merge/seeding suite (S2's deliverable) + S1's parse suite:
npx vitest run tests/unit/config/hack-config.test.ts --coverage
#   Expected: GREEN; 100% coverage on src/config/hack-config.ts. If an env-over-file assertion fails
#   (file value leaked into a pre-set env var), the guard isn't `=== undefined` — fix it. If a merge
#   assertion loses a sibling key, the merge is shallow — switch to per-section nested spread.
# Sibling config sanity (the load shouldn't touch unrelated config tests):
npx vitest run tests/unit/config/
#   Expected: GREEN (S2 adds a file edit + a main() import; no other config behavior changes).
```

### Level 3: Integration / Regression (System Validation)
```bash
# Full validate gate:
npm run validate      # = lint && format:check && typecheck && test:run  → MUST exit 0
npm run build         # tsc -p tsconfig.build.json → dist/ emits cleanly (smol-toml/os/path resolve)
# Confirm the wiring:
grep -n "loadHackConfig(repoRoot)" src/index.ts    # one call
grep -n "configureEnvironment()" src/index.ts      # the load sits BEFORE this
# Expected: one loadHackConfig call, positioned before configureEnvironment(); full suite green.
```

### Level 4: Creative & Domain-Specific Validation
```bash
# No MCP/DB/HTTP. Domain checks (record in commit message):
#   1. Three-tier discovery + merge — write a temp ~/.hack + repoRoot/.hack + repoRoot/.hack.local with
#      overlapping + distinct keys, call loadHackConfig(repoRoot), assert the layered merge + _sources:
node --input-type=module -e "
import('node:fs').then(async ({ mkdtempSync, writeFileSync }) => {
  const { loadHackConfig } = await import('./dist/config/hack-config.js');
  const tmp = mkdtempSync('/tmp/hack-s2-');           // pretend repoRoot
  writeFileSync(tmp+'/.hack', '[pipeline]\nresearch_depth = 2\n');
  writeFileSync(tmp+'/.hack.local', '[pipeline]\nresearch_depth = 3\nissue_retry_max = 9\n');
  const cfg = loadHackConfig(tmp);
  console.log('research_depth =', cfg.pipeline?.research_depth, '→ expect 3 (local won)');
  console.log('issue_retry_max =', cfg.pipeline?.issue_retry_max, '→ expect 9 (local)');
  console.log('sources =', cfg._sources['pipeline.research_depth'], '→ expect project-local');
});"   # (run `npm run build` first; Expected: layered merge + _sources attribution.)
#   2. Env-over-file — pre-set RESEARCH_DEPTH=99 in the shell, run the above → process.env.RESEARCH_DEPTH
#      stays 99 (file value 3 does NOT override). Proves §9.2.1.
#   3. Missing-tier tolerance — no ~/.hack, no .hack.local → only .hack merges; no throw.
#   4. Bootstrap position — grep src/index.ts: loadHackConfig(repoRoot) appears before configureEnvironment().
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` clean (src-only; _sources vs index resolved).
- [ ] `npm run lint` clean; `npm run format:check` clean.
- [ ] `npx vitest run tests/unit/config/hack-config.test.ts --coverage` GREEN; 100% on hack-config.ts.
- [ ] `npm run build` compiles.
- [ ] `npm run validate` (full gate) exits 0.

### Feature Validation
- [ ] `loadHackConfig(repoRoot)` discovers global (cascade) + project + project-local; missing tier skipped.
- [ ] Per-section/key merge: higher tier wins same key; lower-tier siblings survive; `_sources` correct.
- [ ] Env-over-file: seeded only when `process.env[ENV] === undefined`; already-set env untouched.
- [ ] CLI-only keys + `[auth]` keys NOT seeded (absent from HACK_KEY_TO_ENV).
- [ ] `main()` calls `loadHackConfig(repoRoot)` before `configureEnvironment()` (grep-verified).

### Code Quality Validation
- [ ] S2 ADDS to S1's hack-config.ts; does NOT modify parseHackFile/ParsedHackConfig/HackConfigValue.
- [ ] HACK_KEY_TO_ENV is provisional, self-contained (no constants.ts import); @provisional JSDoc.
- [ ] existsSync BEFORE parseHackFile (no ENOENT on missing tiers).
- [ ] MergedHackConfig extends ParsedHackConfig + _sources (typechecks; iteration gotcha documented).
- [ ] No secrets refusal / type validation / subcommand / .gitignore handling (deferred to P2.M1.T2/P2.M2).

### Documentation & Deployment
- [ ] Mode-A JSDoc on loadHackConfig documents tier order, env-over-file seeding rule, bootstrap position (§9.7.9).
- [ ] No `docs/*.md` / README / `.env.example` changes (Mode A = JSDoc; doc sweep is P4.M1 / P2.M2.T3).
- [ ] Commit message notes: the existsSync-first guard (S1 throws ENOENT); per-section nested merge; `=== undefined`
      env-over-file; the provisional mapping (22/28 exist, P2.M2.T1.S1 reconciles); the in-scope repoRoot choice;
      the §9.7.9 bootstrap position.

---

## Anti-Patterns to Avoid

- ❌ Don't call parseHackFile without an existsSync guard — S1 throws ENOENT on a missing file, and a missing
      tier is NOT an error (§9.7.3). `if (!existsSync(file)) continue;` THEN parseHackFile.
- ❌ Don't do a shallow merge (`{...global, ...project}`) — it REPLACES an entire section, losing lower-tier
      sibling keys. Merge per section: `{...(base[section] ?? {}), ...overlay[section]}`.
- ❌ Don't seed env with anything but `=== undefined` as the guard. §9.2.1 says real env wins over files; an
      exported empty env var IS set → env wins → NOT overridden. (Treating '' as unset violates env-over-file.)
- ❌ Don't import the §9.7.5 env-var names from constants.ts in the provisional map — 6 don't exist yet → import
      error risk. Use self-contained literal strings; P2.M2.T1.S1 reconciles. (22/28 already exist there.)
- ❌ Don't seed CLI-only keys (`[concurrency] parallelism`, `[cli] mode/scope/...`, `[monitor] enabled/interval_ms`)
      or `[auth] override_key` — they're absent from HACK_KEY_TO_ENV by design (CLI reads them from
      MergedHackConfig; auth is secret-bearing → P2.M1.T2.S1).
- ❌ Don't enforce the secrets policy (§9.7.6) or type/range validation (§9.7.7) here — those are P2.M1.T2.S1
      layers applied to loadHackConfig's output. S2 seeds raw String(value).
- ❌ Don't modify S1's parseHackFile / ParsedHackConfig / HackConfigValue — S2 imports/extends them.
- ❌ Don't call getRepoRoot() in main() — `repoRoot` is already in scope (line ~116); getRepoRoot() is the same
      cached value but adds a redundant call + a pre-bootstrap throw risk.
- ❌ Don't reorder the bootstrap — the load goes AFTER chdir (project files need repoRoot) and BEFORE
      configureEnvironment (seeded env must be visible to the resolver). §9.7.9.
- ❌ Don't forget the .env-load test gotcha — tests/setup.ts loads .env, so real process.env may pre-set a seeded
      key; DELETE the specific key before each load test or seeding is silently skipped (false pass).

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: This is a single-module addition (to S1's file) + a one-line bootstrap wire, with the
verbatim implementation given. Every load-bearing fact is verified: the §9.7.3 tier paths + global
cascade (quoted from the PRD), the §9.2.1 env-over-file rule (`=== undefined`, env wins even if empty),
the §9.7.9 bootstrap position (confirmed in src/index.ts: chdir ~119 → PRD check → configureEnvironment
~133), the existsSync-first guard (S1's parseHackFile throws ENOENT — proven from S1's PRP), the
per-section nested merge (a shallow merge would drop siblings — explained with the golden test case),
the provisional mapping (all 28 §9.7.5 env keys listed; 22/28 already in constants.ts; 6 missing →
self-contained literals), and the MergedHackConfig typecheck (tier strings ⊂ HackConfigValue; iteration
gotcha flagged). S1's parseHackFile is reused unchanged (no duplication). The 100%-coverage branch map
is enumerated so every branch has a test, including the .env-load test gotcha. Residual risks are
mechanical and gate-caught: (a) the `readonly _sources` vs mutable-index typecheck nit → drop readonly
(documented); (b) an env-over-file test false-pass due to .env pre-setting a key → per-test delete
(documented); (c) a shallow-merge slip → the sibling-survival assertion catches it; (d) a prettier nit
(auto-fixed via `npm run fix`). No runtime/network/LLM unknowns; S2 cleanly inherits S1's parse layer
and defers secrets/validation/subcommand/schema-reconciliation to the P2.M1.T2 / P2.M2 milestones.