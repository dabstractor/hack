# S1 Codebase Analysis — SCHEMA_MAP (all tunables)

> Scope: P2.M2.T1.S1 — "Full schema map (all tunables) with env-var + CLI-flag
> seeding". This is the **dual-surface DATA layer**: an authoritative `SCHEMA_MAP`
> covering every §9.7.5 row, that REPLACES the provisional `HACK_KEY_TO_ENV`
> (becoming the authoritative env-seeding source) and is consumed by `hack config
> show` (P2.M2.T2). Runs IN PARALLEL with P2.M1.T2.S1 (validation) — see
> s1-conflict-reconciliation.md.

## 1. What exists now (S2 output, read in `src/config/hack-config.ts`)

- `parseHackFile`, `ParsedHackConfig`, `HackConfigValue` (S1 — parse-only).
- `MergedHackConfig` (`extends ParsedHackConfig` + `_sources: Record<string,
  HackConfigTier>`), `HackConfigTier` ('global'|'project'|'project-local').
- **`HACK_KEY_TO_ENV`** — a PROVISIONAL `Readonly<Record<string,string>>` literal
  mapping **28** `"section.key"` → env-var. Marked `@provisional` in its JSDoc:
  "The EXHAUSTIVE canonical mapping ... lands in P2.M2.T1.S1." ← **THIS IS THE
  SYMBOL S1 REPLACES** (makes authoritative).
- `seedProcessEnv(merged)` — iterates merged sections, looks up `HACK_KEY_TO_ENV`,
  sets `process.env[ENV] = String(value)` ONLY if undefined (§9.2.1 env-over-file).
  Skips keys absent from the map (the CLI-only keys). **Uses `=== undefined`**
  (real env — even empty — wins over file).
- `loadHackConfig(repoRoot)` — 3-tier discover/merge → `seedProcessEnv` → return
  `{ ...merged, _sources }`. SYNC; mutates `process.env`.

**S1's job is to make `HACK_KEY_TO_ENV` AUTHORITATIVE** by deriving it from an
exhaustive `SCHEMA_MAP` (38 rows), WITHOUT changing `seedProcessEnv`/`loadHackConfig`
behavior (those stay byte-identical → zero conflict with T2.S1).

## 2. The authoritative §9.7.5 table — 38 rows, 13 tunable sections

Verified verbatim from `prd_snapshot.md` §9.7.5. Count: models(3) endpoint(1)
harness(1) pipeline(5) commit(4) bug_hunt(3) validation(2) distributed_prd(2)
tasks_lock(3) concurrency(2) api(1) monitor(3) cli(8) = **38**. (`[auth]` is the
14th section but is secret-bearing and NOT a §9.7.5 tunable — handled by T2.S1's
secrets policy §9.7.6; OUT of SCHEMA_MAP. See §5 below.)

The full ready-to-paste SCHEMA_MAP source is in **s1-schema-map-source.md**.

### Dual-surface concepts (contract rule b — ONE TOML key per concept)
These seed the ENV VAR; the CLI flag reads THROUGH it (Commander
`.default(process.env.X ?? …)`). Exactly ONE `[section].key` each — NO duplicate
`[cli]`/`[pipeline]` pair:
| concept | TOML key | envVar | cliFlag |
|---|---|---|---|
| research queue concurrency | `concurrency.research_queue` | `RESEARCH_QUEUE_CONCURRENCY` | `--research-concurrency` |
| log level | `cli.log_level` | `HACKY_LOG_LEVEL` | `--log-level` |
| monitor task interval | `monitor.task_interval` | `MONITOR_TASK_INTERVAL` | `--monitor-task-interval` |
| parallel research | `pipeline.parallel_research` | `PARALLEL_RESEARCH` | `-r/--parallel-research` |

### Negating flags (contract rule c — TOML names POSITIVE state)
| TOML key (positive) | negating flag | defaultValue |
|---|---|---|
| `cli.cache_enabled` | `--no-cache` | `true` |
| `monitor.enabled` | `--no-resource-monitor` | `true` |

### Model-id values (contract rule d — written BARE, qualified at read time)
`models.high/balanced/fast` defaults are `glm-5.2`/`glm-5.2`/`glm-5-turbo` (BARE).
`qualifyModel()` (environment.ts:159) is **idempotent** — bare → `zai/glm-5.2`,
already-qualified → unchanged. So `anthropic/claude-sonnet-4` (from .hack.local)
passes through intact. SCHEMA_MAP stores BARE defaults; qualification is a
runtime concern (environment.ts), NOT a schema concern.

## 3. The "missing" env-var names (contract research note c/d/e — CONFIRMED)

These env vars are referenced by the §9.7.5 table / config but are NOT `export
const` in `constants.ts` (verified: `grep` = empty):
- `API_TIMEOUT_MS` ([api] timeout_ms) — defined NOWHERE; S1 introduces it as a
  SCHEMA_MAP envVar literal (the value seeds `process.env.API_TIMEOUT_MS`; a
  future consumer reads it). Not a constants.ts change (S1 is data-only).
- `BUG_RESULTS_FILE` ([bug_hunt] results_file) — inline default `'TEST_RESULTS.md'`.
- `BUGFIX_SCOPE` ([bug_hunt] fix_scope) — inline default `'subtask'`.

The `HACKY_*` env names (`HACKY_LOG_LEVEL`, `HACKY_TASK_RETRY_MAX_ATTEMPTS`,
`HACKY_FLUSH_RETRIES`, `HACKY_PRP_CACHE_TTL`, `RESEARCH_QUEUE_CONCURRENCY`,
`MONITOR_TASK_INTERVAL`) are **inline string literals in `src/cli/index.ts`** — no
centralized registry (contract note c). Of these, only `HACKY_LOG_LEVEL`,
`RESEARCH_QUEUE_CONCURRENCY`, `MONITOR_TASK_INTERVAL` are §9.7.5 keys (the others
are CLI-only flags with no §9.7.5 row: `--task-retry`, `--flush-retries`,
`--cache-ttl` are NOT in the §9.7.5 table — do NOT invent rows for them).

## 4. Env-seeding mechanism (unchanged by S1)

`seedProcessEnv` (S2) is the env-seeding authority. S1 does NOT modify it — it
only changes what `HACK_KEY_TO_ENV` CONTAINS (derivation from SCHEMA_MAP). The
flow stays: `loadHackConfig` → merge tiers → `seedProcessEnv(merged)` (reads
`HACK_KEY_TO_ENV`) → return. `process.env[ENV]` is set only if `=== undefined`
(real shell/env wins; §9.2.1). CLI-only keys (no `envVar` in SCHEMA_MAP → absent
from derived `HACK_KEY_TO_ENV`) are correctly NOT seeded.

## 5. `[auth]` is OUT of SCHEMA_MAP (non-conflict with T2.S1)

`[auth]` (`override_key`, `zai_api_key`, `anthropic_api_key`, `anthropic_auth_token`)
is secret-bearing (§9.7.6). It is NOT a §9.7.5 tunable row. T2.S1's
`HACK_CONFIG_SCHEMA` includes `[auth]` (so it's a known section for validation) and
`seedAuthOverrideKey` maps `[auth] override_key` → `PRP_API_KEY`. SCHEMA_MAP is the
**non-secret tunable** map → 38 rows, 13 sections, NO `[auth]`. Documenting this
prevents the implementer from either (a) adding secret rows to SCHEMA_MAP (would
seed secrets to env — WRONG) or (b) thinking the two schemas are redundant.

## 6. Test home + conventions (tests/unit/config/hack-config.test.ts)

GATED (`vitest.config.ts` `include: ['tests/**/*.{test,spec}.ts']`; 100% coverage
threshold on `src/**/*.ts`). Existing file uses: real TOML temp files under OS
tmpdir (`mkdtempSync`), `vi.spyOn(console,'warn')`, `beforeAll/afterAll`,
SETUP/EXECUTE/VERIFY comments. S1 ADDS a `describe('hack-config: SCHEMA_MAP')`
block (pure-data assertions — no temp files needed; deterministic under 100%
coverage). Import `SCHEMA_MAP`, `SCHEMA_BY_KEY`, `HACK_KEY_TO_ENV` (re-export or
test via the derived map). NOTE: `HACK_KEY_TO_ENV` is currently NOT exported — S1
keeps it module-private (derived from SCHEMA_MAP) and tests it via the PUBLIC
`loadHackConfig` env-seeding behavior (a regression guard), OR exports it for
direct testing. Prefer: export `SCHEMA_MAP` + `SCHEMA_BY_KEY` (public, consumed by
P2.M2.T2); keep `HACK_KEY_TO_ENV` private and assert env-seeding via `loadHackConfig`
on a temp `.hack` (consistent with the existing test style).

## 7. vitest 100% coverage — SCHEMA_MAP is branch-free

`SCHEMA_MAP` is a static array literal + two `Object.fromEntries`/`reduce`
derivations. ZERO runtime branches (no conditionals). Coverage is achieved by:
- reading SCHEMA_MAP (length, entry shapes) — one test.
- the `filter(e => e.envVar)` derivation — exercised by the env-seeding regression
  test (CLI-only keys NOT seeded; env-linked keys seeded).
- `SCHEMA_BY_KEY` lookup — one test.
No conditional logic → trivially 100%.

## 8. Build baseline

`npx tsc --noEmit -p tsconfig.build.json` verified green pre-S1 (the file compiles
post-S2). S1 ADDS only: a new interface, a new const array, a derived map, and a
lookup — all pure data, no new imports beyond what `hack-config.ts` already has.