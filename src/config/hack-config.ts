/**
 * `.hack` configuration file parser (PRD §9.7 — The `.hack` Configuration File).
 *
 * @module config/hack-config
 */

import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse, TomlError } from 'smol-toml';
import { PRP_API_KEY } from './constants.js';

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
 * A single row of the exhaustive §9.7.5 schema reference: the dual-config-surface
 * mapping for ONE `[section].key` tunable.
 *
 * @remarks
 * `envVar` is the §9.2.2 name the TOML key seeds into `process.env` (absent for
 * CLI-only keys). `cliFlag` is the `parseCLIArgs()` option (absent for env-only
 * keys). `type`/`acceptedValues?` are SHOW/render metadata (consumed by
 * `hack config show`, P2.M2.T2); they are NOT the validation authority — that is
 * {@link HACK_CONFIG_SCHEMA} (P2.M1.T2.S1), which carries `min`/`max`/`enum` for
 * type/range enforcement. The two intentionally coexist: SCHEMA_MAP is the
 * seeding/dual-surface/show map; HACK_CONFIG_SCHEMA is the validation spec.
 *
 * @see {@link SCHEMA_MAP} for the exhaustive table.
 */
export interface HackConfigSchemaEntry {
  /** TOML `[section]` header (e.g. 'pipeline'). */
  readonly section: string;
  /** TOML key within the section (e.g. 'research_depth'). */
  readonly key: string;
  /** §9.2.2 env-var name the key seeds (undefined for CLI-only keys). */
  readonly envVar?: string;
  /** Commander option (e.g. '--research-depth' or '-r/--parallel-research'; undefined for env-only keys). */
  readonly cliFlag?: string;
  /** Scalar type (matches §9.7.5 Type column; enums are 'string' + acceptedValues). */
  readonly type: 'string' | 'int' | 'boolean';
  /** §9.7.5 Default; undefined for [cli] scope / max_tasks / max_duration_ms (unset). */
  readonly defaultValue?: string | number | boolean;
  /** Enum's accepted values (e.g. ['pi','claude-code']); undefined for free-form/range ints. */
  readonly acceptedValues?: readonly string[];
}

/**
 * Exhaustive §9.7.5 schema reference as an array of {@link HackConfigSchemaEntry}
 * (PRD §9.7.5 — THE authoritative source; `hack config show` prints the same mapping).
 *
 * @remarks
 * **Dual-surface resolution rule (PRD §9.7.5 "Mapping semantics"):**
 * - Each `[section].key` maps to EXACTLY ONE env var and/or CLI flag (no duplicate
 *   `[cli]`/`[pipeline]` pair for the same concept).
 * - For dual concepts (`concurrency.research_queue`/`--research-concurrency`,
 *   `cli.log_level`/`--log-level`, `monitor.task_interval`/`--monitor-task-interval`,
 *   `pipeline.parallel_research`/`-r`), the TOML key seeds the ENV VAR and the CLI
 *   option reads THROUGH it (Commander `.default(process.env.X ?? …)`); only ONE
 *   TOML key exists per concept.
 * - Negating flags (`--no-cache`, `--no-resource-monitor`) name the POSITIVE state
 *   (`cli.cache_enabled=true`, `monitor.enabled=true`); `false` ≡ the `--no-*` form.
 * - Model-id values are written BARE (`glm-5.2`) and provider-qualified at read time
 *   by `qualifyModel()` (§9.2.3); already-qualified values pass through intact.
 *
 * **Coexistence with HACK_CONFIG_SCHEMA (P2.M1.T2.S1):** this map is the
 * seeding/dual-surface/show authority; HACK_CONFIG_SCHEMA (type/`min`/`max`/`enum`)
 * is the VALIDATION authority. Both carry type/enum info by design — do not
 * "consolidate" them; they serve different consumers.
 *
 * `[auth]` is deliberately ABSENT: it is secret-bearing (§9.7.6) and not a §9.7.5
 * tunable; it is governed by the secrets policy (P2.M1.T2.S1) and never env-seeded
 * by the normal path.
 *
 * @see {@link HACK_KEY_TO_ENV} — derived from this map (the authoritative env-seed table).
 * @see {@link SCHEMA_BY_KEY} — the `"section.key"` lookup index.
 */
export const SCHEMA_MAP: readonly HackConfigSchemaEntry[] = [
  // --- [models] (§9.2.3 / §9.2.8) — bare ids, qualified at read time ---
  {
    section: 'models',
    key: 'high',
    envVar: 'PRP_MODEL_HIGH',
    type: 'string',
    defaultValue: 'glm-5.2',
  },
  {
    section: 'models',
    key: 'balanced',
    envVar: 'PRP_MODEL_BALANCED',
    type: 'string',
    defaultValue: 'glm-5.2',
  },
  {
    section: 'models',
    key: 'fast',
    envVar: 'PRP_MODEL_FAST',
    type: 'string',
    defaultValue: 'glm-5-turbo',
  },

  // --- [endpoint] (§9.2.4) ---
  {
    section: 'endpoint',
    key: 'base_url',
    envVar: 'PRP_API_BASE_URL',
    type: 'string',
    defaultValue: 'https://api.z.ai/api/anthropic',
  },

  // --- [harness] (§9.4) ---
  {
    section: 'harness',
    key: 'name',
    envVar: 'PRP_AGENT_HARNESS',
    type: 'string',
    defaultValue: 'pi',
    acceptedValues: ['pi', 'claude-code'],
  },

  // --- [pipeline] (§4.2 / §5.1) ---
  {
    section: 'pipeline',
    key: 'parallel_research',
    envVar: 'PARALLEL_RESEARCH',
    cliFlag: '-r/--parallel-research',
    type: 'boolean',
    defaultValue: false,
  },
  {
    section: 'pipeline',
    key: 'research_depth',
    envVar: 'RESEARCH_DEPTH',
    type: 'int',
    defaultValue: 2,
  },
  {
    section: 'pipeline',
    key: 'research_timeout_seconds',
    envVar: 'RESEARCH_TIMEOUT',
    type: 'int',
    defaultValue: 1800,
  },
  {
    section: 'pipeline',
    key: 'issue_retry_max',
    envVar: 'ISSUE_RETRY_MAX',
    type: 'int',
    defaultValue: 3,
  },
  {
    section: 'pipeline',
    key: 'commit_format',
    envVar: 'PRP_COMMIT_FORMAT',
    type: 'string',
    defaultValue: 'task-prefix',
    acceptedValues: ['task-prefix', 'plain'],
  },

  // --- [commit] (§5.1) ---
  {
    section: 'commit',
    key: 'retry_max',
    envVar: 'COMMIT_RETRY_MAX',
    type: 'int',
    defaultValue: 5,
  },
  {
    section: 'commit',
    key: 'retry_delay_ms',
    envVar: 'COMMIT_RETRY_DELAY',
    type: 'int',
    defaultValue: 10000,
  },
  {
    section: 'commit',
    key: 'retry_delay_cap_ms',
    envVar: 'COMMIT_RETRY_DELAY_CAP',
    type: 'int',
    defaultValue: 120000,
  },
  {
    section: 'commit',
    key: 'classifier_retry_max',
    envVar: 'CLASSIFIER_RETRY_MAX',
    type: 'int',
    defaultValue: 4,
  },

  // --- [bug_hunt] (§4.4) ---
  {
    section: 'bug_hunt',
    key: 'finder_agent',
    envVar: 'BUG_FINDER_AGENT',
    type: 'string',
    defaultValue: 'pizr',
  },
  {
    section: 'bug_hunt',
    key: 'results_file',
    envVar: 'BUG_RESULTS_FILE',
    type: 'string',
    defaultValue: 'TEST_RESULTS.md',
  },
  {
    section: 'bug_hunt',
    key: 'fix_scope',
    envVar: 'BUGFIX_SCOPE',
    type: 'string',
    defaultValue: 'subtask',
  },

  // --- [validation] (§4.4) ---
  {
    section: 'validation',
    key: 'agent',
    envVar: 'VALIDATION_AGENT',
    type: 'string',
    defaultValue: 'pizr',
  },
  {
    section: 'validation',
    key: 'timeout_seconds',
    envVar: 'VALIDATION_TIMEOUT',
    type: 'int',
    defaultValue: 7200,
  },

  // --- [distributed_prd] (§2.3) ---
  {
    section: 'distributed_prd',
    key: 'include_max_depth',
    envVar: 'PRD_INCLUDE_MAX_DEPTH',
    type: 'int',
    defaultValue: 10,
  },
  {
    section: 'distributed_prd',
    key: 'include_markers',
    envVar: 'PRD_INCLUDE_MARKERS',
    type: 'boolean',
    defaultValue: false,
  },

  // --- [tasks_lock] (§5.1) ---
  {
    section: 'tasks_lock',
    key: 'stale_ms',
    envVar: 'TASKS_LOCK_STALE_MS',
    type: 'int',
    defaultValue: 30000,
  },
  {
    section: 'tasks_lock',
    key: 'timeout_ms',
    envVar: 'TASKS_LOCK_TIMEOUT_MS',
    type: 'int',
    defaultValue: 30000,
  },
  {
    section: 'tasks_lock',
    key: 'poll_ms',
    envVar: 'TASKS_LOCK_POLL_MS',
    type: 'int',
    defaultValue: 50,
  },

  // --- [concurrency] ---
  {
    section: 'concurrency',
    key: 'research_queue',
    envVar: 'RESEARCH_QUEUE_CONCURRENCY',
    cliFlag: '--research-concurrency',
    type: 'int',
    defaultValue: 3,
  },
  {
    section: 'concurrency',
    key: 'parallelism',
    cliFlag: '--parallelism',
    type: 'int',
    defaultValue: 2,
  },

  // --- [api] ---
  {
    section: 'api',
    key: 'timeout_ms',
    envVar: 'API_TIMEOUT_MS',
    type: 'int',
    defaultValue: 60000,
  },

  // --- [monitor] ---
  {
    section: 'monitor',
    key: 'task_interval',
    envVar: 'MONITOR_TASK_INTERVAL',
    cliFlag: '--monitor-task-interval',
    type: 'int',
    defaultValue: 1,
  },
  {
    section: 'monitor',
    key: 'interval_ms',
    cliFlag: '--monitor-interval',
    type: 'int',
    defaultValue: 30000,
  },
  {
    section: 'monitor',
    key: 'enabled',
    cliFlag: '--no-resource-monitor',
    type: 'boolean',
    defaultValue: true,
  },

  // --- [cli] (CLI-default group; env-linked only for log_level) ---
  {
    section: 'cli',
    key: 'mode',
    cliFlag: '-m/--mode',
    type: 'string',
    defaultValue: 'normal',
    acceptedValues: ['normal', 'delta', 'bug-hunt', 'validate'],
  },
  // [cli] scope — unset (no §9.7.5 default; consumed from MergedHackConfig, not seeded)
  {
    section: 'cli',
    key: 'scope',
    cliFlag: '-s/--scope',
    type: 'string',
  },
  {
    section: 'cli',
    key: 'log_level',
    envVar: 'HACKY_LOG_LEVEL',
    cliFlag: '--log-level',
    type: 'string',
    defaultValue: 'info',
    acceptedValues: ['trace', 'debug', 'info', 'warn', 'error', 'fatal'],
  },
  {
    section: 'cli',
    key: 'machine_readable',
    cliFlag: '--machine-readable',
    type: 'boolean',
    defaultValue: false,
  },
  {
    section: 'cli',
    key: 'continue_on_error',
    cliFlag: '--continue-on-error',
    type: 'boolean',
    defaultValue: false,
  },
  {
    section: 'cli',
    key: 'cache_enabled',
    cliFlag: '--no-cache',
    type: 'boolean',
    defaultValue: true,
  },
  // [cli] max_tasks / max_duration_ms — unset (no §9.7.5 default; consumed from MergedHackConfig)
  {
    section: 'cli',
    key: 'max_tasks',
    cliFlag: '--max-tasks',
    type: 'int',
  },
  {
    section: 'cli',
    key: 'max_duration_ms',
    cliFlag: '--max-duration',
    type: 'int',
  },
] as const;

/**
 * `"section.key"` → {@link HackConfigSchemaEntry} lookup index, derived from
 * {@link SCHEMA_MAP}. O(1) access for env-seeding, `hack config show`, and
 * (optionally) validation consumers.
 */
export const SCHEMA_BY_KEY: Readonly<Record<string, HackConfigSchemaEntry>> =
  Object.fromEntries(SCHEMA_MAP.map(e => [`${e.section}.${e.key}`, e]));

/**
 * Authoritative TOML `"section.key"` → env-var-name mapping (PRD §9.7.5).
 *
 * @remarks
 * Derived from {@link SCHEMA_MAP} (P2.M2.T1.S1) — the exhaustive §9.7.5 schema
 * reference — superseding S2's provisional 28-entry literal. Covers exactly the
 * §9.7.5 keys that map to a `process.env` var (CLI-only keys, which have no
 * `envVar`, are absent — they are consumed from {@link MergedHackConfig} by the
 * CLI, not seeded). `[auth]` is intentionally absent (secret-bearing; §9.7.6).
 *
 * Consumed by {@link seedProcessEnv} (unchanged): sets `process.env[ENV]` ONLY if
 * undefined (§9.2.1 env-over-file; real env — even empty — wins over file).
 */
const HACK_KEY_TO_ENV: Readonly<Record<string, string>> = Object.fromEntries(
  SCHEMA_MAP.filter(e => e.envVar !== undefined).map(e => [
    `${e.section}.${e.key}`,
    e.envVar as string,
  ])
);

/**
 * Resolve the global-tier `.hack` path (PRD §9.7.3).
 *
 * @remarks Cascade: `$HACK_CONFIG_HOME/config` → `$XDG_CONFIG_HOME/hack/config` → `~/.hack`.
 *
 * Exported for the `hack config` subcommand (P2.M2.T2.S1).
 */
export function globalHackPath(): string {
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

// ---------------------------------------------------------------------------
// Secrets policy + type/range/enum validation + debug trace (P2.M1.T2.S1)
// PRD §9.7.6 (Secrets Policy) + §9.7.7 (Validation & Error Handling) +
// §9.7.10 (masked debug trace). Layered per-tier (after parse, before merge)
// then auth-seeding + trace (after env seeding).
// ---------------------------------------------------------------------------

/**
 * Per-field validation spec for a known §9.7.5 `[section].key`.
 *
 * @remarks `type` is the expected TOML primitive (string | int | boolean); `enum`
 * constrains a string to the accepted values; `min`/`max` are inclusive integer bounds.
 */
export interface HackConfigFieldSpec {
  readonly type: 'string' | 'int' | 'boolean';
  readonly enum?: readonly string[];
  readonly min?: number; // inclusive (int)
  readonly max?: number; // inclusive (int)
}

/**
 * Exhaustive §9.7.5 type/range/enum validation schema (PRD §9.7.7).
 *
 * @remarks Authoritative for type/range/enum checking. The `[auth]` section is included so
 * legitimate `.hack.local` secrets do NOT trip the "unknown section" warning; its keys are
 * secret-bearing and are governed by the secrets policy (§9.7.6) BEFORE any type check. Does
 * NOT overlap S2's `HACK_KEY_TO_ENV` (env-var seeding) or P2.M2.T1.S1 (constants.ts reconciliation).
 *
 * The relational `commit.retry_delay_cap_ms >= commit.retry_delay_ms` cross-key check is a
 * DOCUMENTED GAP (P2.M2 may harden); `retry_delay_cap_ms` validates as `int >= 0` only.
 */
const HACK_CONFIG_SCHEMA: Readonly<
  Record<string, Readonly<Record<string, HackConfigFieldSpec>>>
> = {
  models: {
    high: { type: 'string' },
    balanced: { type: 'string' },
    fast: { type: 'string' },
  },
  endpoint: { base_url: { type: 'string' } },
  harness: { name: { type: 'string', enum: ['pi', 'claude-code'] } },
  pipeline: {
    parallel_research: { type: 'boolean' },
    research_depth: { type: 'int', min: 1 },
    research_timeout_seconds: { type: 'int', min: 1 },
    issue_retry_max: { type: 'int', min: 0 },
    commit_format: { type: 'string', enum: ['task-prefix', 'plain'] },
  },
  commit: {
    retry_max: { type: 'int', min: 1 },
    retry_delay_ms: { type: 'int', min: 0 },
    retry_delay_cap_ms: { type: 'int', min: 0 }, // relational cap>=delay deferred (cross-key)
    classifier_retry_max: { type: 'int', min: 1 },
  },
  bug_hunt: {
    finder_agent: { type: 'string' },
    results_file: { type: 'string' },
    fix_scope: { type: 'string' },
  },
  validation: {
    agent: { type: 'string' },
    timeout_seconds: { type: 'int', min: 1 },
  },
  distributed_prd: {
    include_max_depth: { type: 'int', min: 1 },
    include_markers: { type: 'boolean' },
  },
  tasks_lock: {
    stale_ms: { type: 'int', min: 1 },
    timeout_ms: { type: 'int', min: 1 },
    poll_ms: { type: 'int', min: 1 },
  },
  concurrency: {
    research_queue: { type: 'int', min: 1, max: 10 },
    parallelism: { type: 'int', min: 1, max: 10 },
  },
  api: { timeout_ms: { type: 'int', min: 1 } },
  monitor: {
    task_interval: { type: 'int', min: 1, max: 100 },
    interval_ms: { type: 'int', min: 1000, max: 60000 },
    enabled: { type: 'boolean' },
  },
  cli: {
    mode: { type: 'string', enum: ['normal', 'delta', 'bug-hunt', 'validate'] },
    scope: { type: 'string' },
    log_level: {
      type: 'string',
      enum: ['trace', 'debug', 'info', 'warn', 'error', 'fatal'],
    },
    machine_readable: { type: 'boolean' },
    continue_on_error: { type: 'boolean' },
    cache_enabled: { type: 'boolean' },
    max_tasks: { type: 'int', min: 1 },
    max_duration_ms: { type: 'int', min: 1 },
  },
  auth: {
    // NOT in §9.7.5 tunables table; known section so secrets don't false-warn (§9.7.6)
    override_key: { type: 'string' },
    zai_api_key: { type: 'string' },
    anthropic_api_key: { type: 'string' },
    anthropic_auth_token: { type: 'string' },
  },
};

const SECRET_SUFFIXES = ['_key', '_token', '_secret', '_password'] as const;

/**
 * True if a `.hack` key NAME is secret-bearing (PRD §9.7.6 suffix rule).
 *
 * @remarks Matches the suffix rule `_key`/`_token`/`_secret`/`_password`, which covers the 4
 * explicit `[auth]` secret keys (`override_key`, `zai_api_key`, `anthropic_api_key`,
 * `anthropic_auth_token`). Applied to the KEY NAME only — never to the value — so a future
 * secret-suffixed key in any section is still masked/refused.
 *
 * Exported for the `hack config` subcommand (P2.M2.T2.S1).
 */
export function isSecretKey(key: string): boolean {
  return SECRET_SUFFIXES.some(s => key.endsWith(s));
}

/**
 * Module-private one-time validation-warning dedup (PRD §9.7.7).
 *
 * @remarks Mirrors the `environment.ts` `_deprecatedWarned` pattern: keyed per
 * (kind,file,location) so an unknown section/key warns ONCE per file even if the same
 * malformed tier is encountered multiple times. vitest does NOT reset module state between
 * tests in a file, so tests re-arm it via {@link _resetValidationWarnings}.
 */
const _validationWarned = new Set<string>();

/**
 * Reset the one-time validation-warning dedup.
 *
 * @remarks Production code never calls this. Test-only hook (mirrors
 * `environment.ts` `_resetDeprecationWarnings`) so individual `it()` blocks can re-arm the
 * dedup `Set`.
 *
 * @internal
 */
export function _resetValidationWarnings(): void {
  _validationWarned.clear();
}

/**
 * Emit a one-time §9.7.7 validation WARNING to stderr synchronously (PRD §9.6/§9.7.7).
 *
 * @remarks Synchronous `console.warn` (stderr, PRD §9.6-compliant) because the pino logger is
 * configured AFTER config load (it needs the resolved CLI flags) and cannot carry startup
 * validation warnings reliably. Deduped by `dedupKey` so a repeated unknown section/key warns
 * once per file. Mirrors `environment.ts` `warnLegacyModelVar`.
 */
function warnOnceValidation(message: string, dedupKey: string): void {
  if (_validationWarned.has(dedupKey)) return;
  _validationWarned.add(dedupKey);
  console.warn(`[hack] ${message}`); // stderr, sync — pino configured AFTER config load (§9.6)
}

/**
 * Validate a single parsed `.hack` tier file (PRD §9.7.6 secrets + §9.7.7 validation).
 *
 * @remarks Runs per-tier, immediately after {@link parseHackFile} and BEFORE merging, so error
 * messages can name the exact file. Hard errors THROW a plain `Error` (rendered by
 * `main().catch()`'s default arm → exit 1); warnings go to stderr via {@link warnOnceValidation}.
 * Secrets are checked FIRST: a non-empty secret in a committable tier (global/project) is a HARD
 * error (§9.7.6); an empty/whitespace secret is "not configured" (§9.2.7) and is skipped; a secret
 * in `project-local` is allowed and skips type validation (its value is never echoed). Unknown
 * sections/keys WARN once and are ignored (lenient, forward-compatible). A type/range/enum mismatch
 * is a HARD error naming file + section + key + offending value + expected type/range/accepted values.
 *
 * **Per-key order matters (research §8):** secrets → unknown-section → unknown-key → type/range.
 * A secret in an UNKNOWN section must still be refused in committable tiers, so the secret check
 * precedes the unknown-section short-circuit. Secrets are NEVER passed to {@link validateFieldValue}
 * (it would JSON.stringify the secret into a thrown message).
 *
 * @param parsed - The tier's parsed config.
 * @param file - Absolute path of the tier file (for error attribution).
 * @param tier - Which discovery tier (only 'project-local' may hold secrets).
 * @throws {Error} on a non-empty secret in a committable tier, or on a type/range/enum mismatch.
 *
 * Exported for the `hack config` subcommand (P2.M2.T2.S1).
 */
export function validateHackTier(
  parsed: ParsedHackConfig,
  file: string,
  tier: HackConfigTier
): void {
  for (const [section, keys] of Object.entries(parsed)) {
    const sectionSchema = HACK_CONFIG_SCHEMA[section];
    const isKnownSection = sectionSchema !== undefined;
    if (!isKnownSection) {
      warnOnceValidation(
        `unknown section [${section}] in ${file}; ignored`,
        `section:${file}:${section}`
      );
    }
    for (const [key, value] of Object.entries(keys)) {
      // (a) SECRETS POLICY (§9.7.6) — checked first, on the KEY NAME, before any value echoing.
      if (isSecretKey(key)) {
        if (typeof value === 'string' && value.trim() === '') continue; // empty == not configured (§9.2.7)
        if (tier !== 'project-local') {
          throw new Error(
            `Secret-bearing key [${section}] ${key} is not permitted in the committable file ${file} ` +
              `(PRD §9.7.6). Move it to .hack.local (gitignored) or an environment variable, then retry.`
          );
        }
        continue; // secret in .hack.local: allowed; never type-check or echo its value.
      }
      // (b) unknown section, non-secret key → section already warned; ignore the key.
      if (!isKnownSection) continue;
      // (c) unknown key in a known section (§9.7.7) — catch typos like 'reseaerch_depth'.
      const spec = sectionSchema[key];
      if (spec === undefined) {
        warnOnceValidation(
          `unknown key [${section}] ${key} in ${file}; ignored`,
          `key:${file}:${section}.${key}`
        );
        continue;
      }
      // (d) type/range/enum (§9.7.7) — HARD error.
      validateFieldValue(file, section, key, value, spec);
    }
  }
}

/**
 * Type/range/enum check for a known key (PRD §9.7.7). Throws on mismatch.
 *
 * @remarks A plain `throw new Error` reaches `main().catch()`'s default arm (index.ts:401) →
 * exit 1. The message names the file + section + key + offending value + expected
 * type/range (for int) / accepted values (for enum). TOML int = JS number +
 * `Number.isInteger`; bool = JS boolean; string = JS string. A TOML `poll_ms = true` is a
 * TYPE mismatch (boolean where int expected), not a range error.
 */
function validateFieldValue(
  file: string,
  section: string,
  key: string,
  value: HackConfigValue,
  spec: HackConfigFieldSpec
): void {
  if (spec.type === 'boolean' && typeof value !== 'boolean') {
    throw new Error(
      `[${section}] ${key} in ${file}: expected boolean, got ${typeof value} (${JSON.stringify(value)}).`
    );
  }
  if (spec.type === 'string' && typeof value !== 'string') {
    throw new Error(
      `[${section}] ${key} in ${file}: expected string, got ${typeof value} (${JSON.stringify(value)}).`
    );
  }
  if (spec.type === 'int') {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      throw new Error(
        `[${section}] ${key} in ${file}: expected integer, got ${typeof value} (${JSON.stringify(value)}).`
      );
    }
    const range = `expected integer in [${spec.min ?? '-∞'}, ${spec.max ?? '+∞'}]`;
    if (spec.min !== undefined && value < spec.min) {
      throw new Error(
        `[${section}] ${key} in ${file}: ${value} is out of range (${range}).`
      );
    }
    if (spec.max !== undefined && value > spec.max) {
      throw new Error(
        `[${section}] ${key} in ${file}: ${value} is out of range (${range}).`
      );
    }
  }
  if (
    spec.type === 'string' &&
    spec.enum !== undefined &&
    !spec.enum.includes(value as string)
  ) {
    throw new Error(
      `[${section}] ${key} in ${file}: ${JSON.stringify(value)} is not one of the accepted values ` +
        `[${spec.enum.join(', ')}].`
    );
  }
}

/**
 * Seed `process.env.PRP_API_KEY` from a `.hack.local` `[auth] override_key` (PRD §9.7.6/§9.7.9).
 *
 * @remarks `.hack.local` is the ONLY tier permitted to hold secrets (enforced by
 * {@link validateHackTier}); by the time this runs, any `override_key` in `merged` therefore
 * originated in `project-local` (committable tiers with a non-empty secret aborted earlier).
 * Seeds ONLY when `process.env.PRP_API_KEY` is undefined (§9.2.1 env-over-file) and the value is
 * non-empty (§9.2.7 empty-string policy — empty/whitespace == not configured, never forwarded).
 * This is the §9.2.6 layer-1 explicit override that `resolveApiKeyForProvider` reads at
 * harness.ts:73. S2's `seedProcessEnv` deliberately EXCLUDES `[auth]` (secret-bearing), so this
 * is a separate dedicated seeding step.
 */
function seedAuthOverrideKey(merged: ParsedHackConfig): void {
  const v = merged.auth?.override_key;
  if (
    typeof v === 'string' &&
    v.trim() !== '' &&
    process.env[PRP_API_KEY] === undefined
  ) {
    process.env[PRP_API_KEY] = v;
  }
}

/**
 * Log the effective merged `.hack` config to stderr when debug logging is in effect (PRD §9.7.7).
 *
 * @remarks Fires only when `process.env.HACKY_LOG_LEVEL === 'debug'`. This is authoritative
 * post-seeding: S2's `seedProcessEnv` seeds `[cli] log_level → HACKY_LOG_LEVEL` (it is in
 * `HACK_KEY_TO_ENV`) BEFORE this call, with env-over-file (shell wins), so the check captures both
 * the shell `--log-level debug` and a `.hack` `[cli] log_level = "debug"`. Uses `console.warn`
 * (stderr, sync) because the pino logger is configured AFTER config load (§9.6). Every secret key's
 * value is MASKED (§9.7.10: no secret value is ever written to stdout/logs unmasked).
 */
function logEffectiveConfigTrace(
  merged: ParsedHackConfig,
  sources: Record<string, HackConfigTier>
): void {
  if (process.env.HACKY_LOG_LEVEL !== 'debug') return;
  for (const [section, keys] of Object.entries(merged)) {
    for (const [key, value] of Object.entries(keys)) {
      const src = sources[`${section}.${key}`] ?? 'unknown';
      const display = isSecretKey(key) ? '"<redacted>"' : JSON.stringify(value);
      console.warn(`[hack] ${section}.${key} = ${display}  (source: ${src})`);
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
    validateHackTier(parsed, file, tier); // P2.M1.T2.S1 — §9.7.6 secrets + §9.7.7 validation (per-tier, pre-merge)
    mergeTier(merged, parsed, tier, sources);
  }

  seedProcessEnv(merged);
  seedAuthOverrideKey(merged); // P2.M1.T2.S1 — .hack.local override_key → PRP_API_KEY (§9.7.6; S2 excludes [auth])
  logEffectiveConfigTrace(merged, sources); // P2.M1.T2.S1 — --log-level debug trace, secrets masked (§9.7.7)

  return { ...merged, _sources: sources };
}
