# S1 — Full ready-to-paste SCHEMA_MAP source (38 rows, §9.7.5 verbatim)

> Drop-in source for `src/config/hack-config.ts`. Verbatim from §9.7.5 table.
> 38 entries across 13 tunable sections (NO `[auth]` — secret-bearing, T2.S1 owns).

## Entry type + constants

```ts
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
```

## SCHEMA_MAP — all 38 rows (§9.7.5 table, verbatim order)

```ts
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
  { section: 'models', key: 'high', envVar: 'PRP_MODEL_HIGH', type: 'string', defaultValue: 'glm-5.2' },
  { section: 'models', key: 'balanced', envVar: 'PRP_MODEL_BALANCED', type: 'string', defaultValue: 'glm-5.2' },
  { section: 'models', key: 'fast', envVar: 'PRP_MODEL_FAST', type: 'string', defaultValue: 'glm-5-turbo' },

  // --- [endpoint] (§9.2.4) ---
  { section: 'endpoint', key: 'base_url', envVar: 'PRP_API_BASE_URL', type: 'string', defaultValue: 'https://api.z.ai/api/anthropic' },

  // --- [harness] (§9.4) ---
  { section: 'harness', key: 'name', envVar: 'PRP_AGENT_HARNESS', type: 'string', defaultValue: 'pi', acceptedValues: ['pi', 'claude-code'] },

  // --- [pipeline] (§4.2 / §5.1) ---
  { section: 'pipeline', key: 'parallel_research', envVar: 'PARALLEL_RESEARCH', cliFlag: '-r/--parallel-research', type: 'boolean', defaultValue: false },
  { section: 'pipeline', key: 'research_depth', envVar: 'RESEARCH_DEPTH', type: 'int', defaultValue: 2 },
  { section: 'pipeline', key: 'research_timeout_seconds', envVar: 'RESEARCH_TIMEOUT', type: 'int', defaultValue: 1800 },
  { section: 'pipeline', key: 'issue_retry_max', envVar: 'ISSUE_RETRY_MAX', type: 'int', defaultValue: 3 },
  { section: 'pipeline', key: 'commit_format', envVar: 'PRP_COMMIT_FORMAT', type: 'string', defaultValue: 'task-prefix', acceptedValues: ['task-prefix', 'plain'] },

  // --- [commit] (§5.1) ---
  { section: 'commit', key: 'retry_max', envVar: 'COMMIT_RETRY_MAX', type: 'int', defaultValue: 5 },
  { section: 'commit', key: 'retry_delay_ms', envVar: 'COMMIT_RETRY_DELAY', type: 'int', defaultValue: 10000 },
  { section: 'commit', key: 'retry_delay_cap_ms', envVar: 'COMMIT_RETRY_DELAY_CAP', type: 'int', defaultValue: 120000 },
  { section: 'commit', key: 'classifier_retry_max', envVar: 'CLASSIFIER_RETRY_MAX', type: 'int', defaultValue: 4 },

  // --- [bug_hunt] (§4.4) ---
  { section: 'bug_hunt', key: 'finder_agent', envVar: 'BUG_FINDER_AGENT', type: 'string', defaultValue: 'pizr' },
  { section: 'bug_hunt', key: 'results_file', envVar: 'BUG_RESULTS_FILE', type: 'string', defaultValue: 'TEST_RESULTS.md' },
  { section: 'bug_hunt', key: 'fix_scope', envVar: 'BUGFIX_SCOPE', type: 'string', defaultValue: 'subtask' },

  // --- [validation] (§4.4) ---
  { section: 'validation', key: 'agent', envVar: 'VALIDATION_AGENT', type: 'string', defaultValue: 'pizr' },
  { section: 'validation', key: 'timeout_seconds', envVar: 'VALIDATION_TIMEOUT', type: 'int', defaultValue: 7200 },

  // --- [distributed_prd] (§2.3) ---
  { section: 'distributed_prd', key: 'include_max_depth', envVar: 'PRD_INCLUDE_MAX_DEPTH', type: 'int', defaultValue: 10 },
  { section: 'distributed_prd', key: 'include_markers', envVar: 'PRD_INCLUDE_MARKERS', type: 'boolean', defaultValue: false },

  // --- [tasks_lock] (§5.1) ---
  { section: 'tasks_lock', key: 'stale_ms', envVar: 'TASKS_LOCK_STALE_MS', type: 'int', defaultValue: 30000 },
  { section: 'tasks_lock', key: 'timeout_ms', envVar: 'TASKS_LOCK_TIMEOUT_MS', type: 'int', defaultValue: 30000 },
  { section: 'tasks_lock', key: 'poll_ms', envVar: 'TASKS_LOCK_POLL_MS', type: 'int', defaultValue: 50 },

  // --- [concurrency] ---
  { section: 'concurrency', key: 'research_queue', envVar: 'RESEARCH_QUEUE_CONCURRENCY', cliFlag: '--research-concurrency', type: 'int', defaultValue: 3 },
  { section: 'concurrency', key: 'parallelism', cliFlag: '--parallelism', type: 'int', defaultValue: 2 },

  // --- [api] ---
  { section: 'api', key: 'timeout_ms', envVar: 'API_TIMEOUT_MS', type: 'int', defaultValue: 60000 },

  // --- [monitor] ---
  { section: 'monitor', key: 'task_interval', envVar: 'MONITOR_TASK_INTERVAL', cliFlag: '--monitor-task-interval', type: 'int', defaultValue: 1 },
  { section: 'monitor', key: 'interval_ms', cliFlag: '--monitor-interval', type: 'int', defaultValue: 30000 },
  { section: 'monitor', key: 'enabled', cliFlag: '--no-resource-monitor', type: 'boolean', defaultValue: true },

  // --- [cli] (CLI-default group; env-linked only for log_level) ---
  { section: 'cli', key: 'mode', cliFlag: '-m/--mode', type: 'string', defaultValue: 'normal', acceptedValues: ['normal', 'delta', 'bug-hunt', 'validate'] },
  { section: 'cli', key: 'scope', cliFlag: '-s/--scope', type: 'string' }, // unset
  { section: 'cli', key: 'log_level', envVar: 'HACKY_LOG_LEVEL', cliFlag: '--log-level', type: 'string', defaultValue: 'info', acceptedValues: ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] },
  { section: 'cli', key: 'machine_readable', cliFlag: '--machine-readable', type: 'boolean', defaultValue: false },
  { section: 'cli', key: 'continue_on_error', cliFlag: '--continue-on-error', type: 'boolean', defaultValue: false },
  { section: 'cli', key: 'cache_enabled', cliFlag: '--no-cache', type: 'boolean', defaultValue: true },
  { section: 'cli', key: 'max_tasks', cliFlag: '--max-tasks', type: 'int' }, // unset
  { section: 'cli', key: 'max_duration_ms', cliFlag: '--max-duration', type: 'int' }, // unset
] as const;
```

## SCHEMA_BY_KEY — lookup index

```ts
/**
 * `"section.key"` → {@link HackConfigSchemaEntry} lookup index, derived from
 * {@link SCHEMA_MAP}. O(1) access for env-seeding, `hack config show`, and
 * (optionally) validation consumers.
 */
export const SCHEMA_BY_KEY: Readonly<Record<string, HackConfigSchemaEntry>> =
  Object.fromEntries(
    SCHEMA_MAP.map((e) => [`${e.section}.${e.key}`, e])
  );
```

## HACK_KEY_TO_ENV — derived (replaces the S2 provisional literal)

```ts
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
  SCHEMA_MAP.filter((e) => e.envVar !== undefined).map((e) => [
    `${e.section}.${e.key}`,
    e.envVar as string,
  ])
);
```

## Row-count reconciliation (verified = 38)

models 3, endpoint 1, harness 1, pipeline 5, commit 4, bug_hunt 3, validation 2,
distributed_prd 2, tasks_lock 3, concurrency 2, api 1, monitor 3, cli 8 → **38**.
Env-linked (have `envVar`): 3+1+1+5+4+3+2+2+3+1+1(cli.log_level)+1(concurrency.research_queue)+1(monitor.task_interval) = **28** (matches the S2 provisional count — derivation preserves it). CLI-only (no envVar): 38 − 28 = **10** (`concurrency.parallelism`, `monitor.interval_ms`, `monitor.enabled`, `cli.mode`, `cli.scope`, `cli.machine_readable`, `cli.continue_on_error`, `cli.cache_enabled`, `cli.max_tasks`, `cli.max_duration_ms`).