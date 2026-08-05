/**
 * `.hack` configuration file parser (PRD §9.7 — The `.hack` Configuration File).
 *
 * @module config/hack-config
 */

import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse, TomlError } from 'smol-toml';

/**
 * A scalar value in a parsed `.hack` file.
 *
 * @remarks
 * The §9.7.5 schema uses only strings, integers, and booleans (enums are strings;
 * ranges are validated downstream). Datetimes/arrays/nested-tables-as-values are NOT
 * part of the schema and are rejected by the type/range validation layer (P2.M1.T2.S1).
 */
export type HackConfigValue = string | number | boolean;

/**
 * The parsed shape of a `.hack` file: a map of TOML `[section]` tables, each a map of
 * lowercase-snake_case keys to scalar values.
 *
 * @remarks
 * TOML `[section]` headers map to top-level keys; `key = value` pairs within a section
 * map to that section's nested object. For a valid `.hack` this is exactly the structure
 * `smol-toml.parse()` returns. All keys are lowercase snake_case within their section
 * (§9.7.4); `smol-toml` is case-sensitive, so the casing is an authoring convention
 * enforced by validation/docs, not transformed here.
 */
export interface ParsedHackConfig {
  [section: string]: { [key: string]: HackConfigValue };
}

/**
 * Read and parse a `.hack` (TOML 1.0) configuration file into a typed
 * {@link ParsedHackConfig}.
 *
 * @remarks
 * **Format (PRD §9.7.4):** TOML 1.0, parsed via `smol-toml` (the project's TOML
 * dependency). UTF-8 encoding; a leading byte-order mark is REJECTED with a clear
 * error (`smol-toml` does not handle BOM, so this loader detects it manually by
 * checking the first 3 bytes for `0xEF 0xBB 0xBF`). Comments (`#`) are ignored at
 * parse time. All keys are lowercase snake_case within their section.
 *
 * **Errors (PRD §9.7.7):**
 * - **BOM:** throws an `Error` naming the file and the UTF-8-without-BOM remediation.
 * - **Malformed TOML / duplicate key:** `smol-toml` raises a `TomlError` (with `.line`
 *   and `.column`); this function rethrows an `Error` naming the file and the parser's
 *   line/column (the original `TomlError` is preserved on `error.cause`).
 * - **Missing file:** the `readFileSync` `ENOENT` propagates (it already names the path).
 *
 * This is the PARSE step only. Three-tier discovery/merge (S2), secrets refusal
 * (§9.7.6), and type/range/unknown-key validation (§9.7.7) are downstream layers.
 *
 * SYNC — takes an absolute path; no discovery, no `process.env` mutation, no I/O beyond
 * the single file read.
 *
 * @param filePath - Absolute path to a `.hack` / `.hack.local` TOML file.
 * @returns The parsed config: `{ [section]: { [key]: string|number|boolean } }`.
 * @throws {Error} on BOM or malformed TOML (message names the file + line/column).
 *
 * @example
 * ```ts
 * import { parseHackFile } from './config/hack-config.js';
 *
 * const cfg = parseHackFile('/repo/.hack');
 * // cfg.harness.name === 'pi'; cfg.pipeline.research_depth === 3
 * ```
 */
export function parseHackFile(filePath: string): ParsedHackConfig {
  try {
    const buffer = readFileSync(filePath); // raw bytes — for the BOM signature check
    if (
      buffer.length >= 3 &&
      buffer[0] === 0xef &&
      buffer[1] === 0xbb &&
      buffer[2] === 0xbf
    ) {
      throw new Error(
        `BOM detected in ${filePath}; remove it and re-save as UTF-8 without BOM`
      );
    }
    return parse(buffer.toString('utf8')) as unknown as ParsedHackConfig;
  } catch (error) {
    if (error instanceof TomlError) {
      throw new Error(
        `Failed to parse ${filePath}: ${error.message} (line ${error.line}, column ${error.column})`,
        { cause: error }
      );
    }
    throw error; // BOM Error / ENOENT / etc. — already carry the path; rethrow as-is
  }
}

// ---------------------------------------------------------------------------
// Three-tier discovery, layered merge, env-over-file seeding (P2.M1.T1.S2)
// PRD §9.7.3 (Discovery, Layering & File Locations) + §9.2.1 (env-over-file).
// ---------------------------------------------------------------------------

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
  _sources: Record<string, HackConfigTier>;
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

/**
 * Resolve the global-tier `.hack` path (PRD §9.7.3).
 *
 * @remarks Cascade: `$HACK_CONFIG_HOME/config` → `$XDG_CONFIG_HOME/hack/config` → `~/.hack`.
 */
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
 *
 * @remarks Each overlay key overwrites the same key from a lower tier; sibling keys in the
 * same section survive (nested object spread per section — a shallow merge would drop them).
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
 *
 * @remarks Uses `=== undefined` (NOT also-empty): a real exported env var — even an empty
 * one — IS set and therefore wins over the file value (§9.2.1: real env > file). Coerces
 * values via `String()` (bool→"true", number→"1800", string passthrough).
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
    const parsed = parseHackFile(file); // S1 — BOM/malformed rethrows; ENOENT only if it vanishes mid-run
    mergeTier(merged, parsed, tier, sources);
  }

  seedProcessEnv(merged);

  return { ...merged, _sources: sources };
}
