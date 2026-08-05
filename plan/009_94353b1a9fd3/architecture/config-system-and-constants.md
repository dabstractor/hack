# Config System & Constants — Architecture Scouting Report

> Source of truth for the §9.7.5 schema mapping. Catalogs every env-var name,
> default, getter, CLI flag, and dual-config-surface linkage in `src/config/*` and `src/cli/index.ts`.

---

## 1. `src/config/constants.ts` — Complete Catalog (1271 lines)

### Model Selection (§9.2.8)
| Env-var NAME const | String value | DEFAULT | Getter | Lines |
|---|---|---|---|---|
| `MODEL_NAMES` | `{ high:'glm-5.2', balanced:'glm-5.2', fast:'glm-5-turbo' }` | — | `getModel(tier)` (env.ts:196) | L44-54 |
| `MODEL_ENV_VARS` | `{ high:'PRP_MODEL_HIGH', balanced:'PRP_MODEL_BALANCED', fast:'PRP_MODEL_FAST' }` | — | `getModel(tier)` | L70-75 |
| `LEGACY_MODEL_ENV_VARS` | `{ high:'ANTHROPIC_DEFAULT_OPUS_MODEL', ... }` | — | `getModel(tier)` (one-time warn) | L92-97 |
| `REQUIRED_ENV_VARS` | `{ apiKey:'ANTHROPIC_API_KEY', baseURL:'PRP_API_BASE_URL' }` | — | `validateEnvironment()` | L109-112 |

### Provider / Harness Identity
| Const | Value | Lines |
|---|---|---|
| `DEFAULT_BASE_URL` | `'https://api.z.ai/api/anthropic'` | L22 |
| `PRP_AGENT_HARNESS` | `'PRP_AGENT_HARNESS'` | L129 |
| `DEFAULT_HARNESS` | `'pi'` | L144 |
| `DEFAULT_MODEL_PROVIDER` | `'zai'` | L159 |
| `SUPPORTED_HARNESSES` | `['pi', 'claude-code']` | L175 |
| `PRP_API_KEY` | `'PRP_API_KEY'` | L193 |
| `PRP_API_BASE_URL` | `'PRP_API_BASE_URL'` | L213 |

### Resilience Tuning (§4.2, §9.2.2)
| Env-var NAME | DEFAULT | Getter | Lines |
|---|---|---|---|
| `RESEARCH_TIMEOUT` | 1800 | `getResearchTimeoutSeconds()` | L234,274 |
| `RESEARCH_DEPTH` | 2 | `getResearchDepth()` | L300,330 |
| `PARALLEL_RESEARCH` | false (=== 'true') | `isParallelResearch()` | L355,369 |
| `ISSUE_RETRY_MAX` | 3 | `getIssueRetryMax()` | L390,420 |

### Commit Generation Resilience (§5.1)
| Env-var NAME | DEFAULT | Getter | Lines |
|---|---|---|---|
| `COMMIT_RETRY_MAX` | 5 | `getCommitRetryMax()` | L449,480 |
| `COMMIT_RETRY_DELAY` | 10000 | `getCommitRetryDelayMs()` | L574,606 |
| `COMMIT_RETRY_DELAY_CAP` | 120000 | `getCommitRetryDelayCapMs()` | L634,666 |

### Classifier Resilience (§4.3)
| Env-var NAME | DEFAULT | Getter | Lines |
|---|---|---|---|
| `CLASSIFIER_RETRY_MAX` | 4 | `getClassifierRetryMax()` | L513,545 |

### Commit Message Format (§5.1)
| Const/Type | Value | Getter | Lines |
|---|---|---|---|
| `PRP_COMMIT_FORMAT` | `'PRP_COMMIT_FORMAT'` | `getPrpCommitFormat()` | L705,760 |
| `DEFAULT_PRP_COMMIT_FORMAT` | `'task-prefix'` | — | L723 |
| `PrpCommitFormat` (type) | `'task-prefix' \| 'plain'` | — | L736 |

### Validation Control (§4.4)
| Env-var NAME | DEFAULT | Getter | Lines |
|---|---|---|---|
| `VALIDATION_AGENT` | `'pizr'` | `getValidationAgent()` | L797,833 |
| `VALIDATION_TIMEOUT` | 7200 | `getValidationTimeoutSeconds()` | L860,898 |

### Bug Hunt Configuration (§4.4)
| Env-var NAME | DEFAULT | Getter | Lines |
|---|---|---|---|
| `BUG_FINDER_AGENT` | `'pizr'` | `getBugFinderAgent()` | L936,974 |

### PRD @-include Directives (§2.3)
| Env-var NAME | DEFAULT | Getter | Lines |
|---|---|---|---|
| `PRD_INCLUDE_MAX_DEPTH` | 10 | `getPrdIncludeMaxDepth()` | L1000,1030 |
| `PRD_INCLUDE_MARKERS` | false | `getPrdIncludeMarkers()` | L1058,1079 |

### tasks.json Lockfile Tunables (§5.1)
| Env-var NAME | DEFAULT | Getter | Lines |
|---|---|---|---|
| `TASKS_LOCK_STALE_MS` | 30000 | `getTasksLockStaleMs()` | L1112,1143 |
| `TASKS_LOCK_TIMEOUT_MS` | 30000 | `getTasksLockTimeoutMs()` | L1166,1197 |
| `TASKS_LOCK_POLL_MS` | 50 | `getTasksLockPollMs()` | L1220,1250 |

**Getter pattern:** `Number(process.env[X] ?? DEFAULT)` → fallback on NaN/<=0. Lockfile getters use `Number.isFinite`. Commit/classifier/delay getters apply `Math.floor`.

---

## 2. `src/config/environment.ts` — `configureEnvironment()`

**Lines ~62-114.** Reads: `getResolvedProvider()` (from getModel('balanced').split('/')[0]), `ANTHROPIC_AUTH_TOKEN` (anthropic only), `PRP_API_BASE_URL` (canonical-first), `ANTHROPIC_BASE_URL` (legacy fallback).

Writes to `process.env`:
1. AUTH_TOKEN alias: IF anthropic AND AUTH_TOKEN set AND API_KEY unset → `API_KEY = AUTH_TOKEN`
2. Base URL: canonical-first → legacy (deprecation warn) → z.ai default (zai only). Mirrors resolved into `ANTHROPIC_BASE_URL`.

**Other exports:** `qualifyModel(name, provider='zai')` (L159, idempotent), `getModel(tier)` (L196), `getResolvedProvider()` (L47), `validateEnvironment()` (L220), `_resetDeprecationWarnings()` (test hook).

---

## 3. `src/config/harness.ts` — `configureHarness()`

**Lines ~88-172.**
1. Read `PRP_AGENT_HARNESS ?? DEFAULT_HARNESS` ('pi')
2. Validate against `SUPPORTED_HARNESSES`; throw `UnsupportedHarnessError`
3. Compat guard: claude-code + zai → `HarnessProviderMismatchError`
4. Register `PiHarness` idempotently via `HarnessRegistry`
5. Delegate to `configureHarnesses(...)` (Groundswell)

**`resolveApiKeyForProvider(provider, options?)` (L57-80):** PRP_API_KEY → provider-native env (ZAI_API_KEY / ANTHROPIC_OAUTH_TOKEN→API_KEY) → auth.json.

**Other exports:** `ensureHarnessInitialized()` (L180), `runAuthPreflight()` (L218, throws `AuthPreflightError`).

---

## 4. Dependencies — TOML Parser

**NO TOML parser in `package.json` dependencies.** `smol-toml@1.6.1` IS present in `node_modules` as a **transitive dep** of `markdownlint-cli`. Must be promoted to a direct `dependency`.

Runtime deps (14): chalk, cli-highlight, cli-progress, cli-table3, commander, diff, fast-glob, groundswell, ms, pino, simple-git, terser, tiktoken, zod.

DevDeps include: dotenv (devDep only), @earendil-works/pi-coding-agent, typescript, vitest, tsx, eslint, prettier, etc.

---

## 5. `dotenv` Usage — Verified

**CONFIRMED:** `dotenv` is NEVER imported in `src/`. Only used in `tests/setup.ts:22-34` via dynamic `import('dotenv')` inside a try/catch that no-ops if absent. `.env` reaches `process.env` via direnv/`.envrc` (shell) or test setup only. **No application-level config-file loader exists.**

---

## 6. `src/cli/index.ts` — Complete CLI Flag Catalog

### Root (pipeline) options — L310-436

| Flag | Default | Env linkage | Lines |
|---|---|---|---|
| `-p, --prd <path>` | `'./PRD.md'` | — | L312 |
| `-s, --scope <scope>` | (none) | — | L314 |
| `-m, --mode <mode>` | `'normal'` | — | L316-322 |
| `-c, --continue` | `false` | — | L323 |
| `-d, --dry-run` | `false` | — | L324 |
| `-v, --verbose` | `false` | — | L325-330 |
| `--log-level <level>` | `process.env.HACKY_LOG_LEVEL ?? 'info'` | **HACKY_LOG_LEVEL** | L331-339 |
| `--machine-readable` | `false` | — | L340 |
| `--no-cache` | `false` | — | L341 |
| `--continue-on-error` | `false` | — | L342 |
| `--validate-prd` | `false` | — | L343-347 |
| `--accept-prd-changes` | `false` | — | L348-352 |
| `--adopt-prd` | `false` | — | L353-357 |
| `--max-tasks <number>` | (none) | — | L358 |
| `--max-duration <ms>` | (none) | — | L359 |
| `--monitor-interval <ms>` | (none) | — | L360-363 |
| `--monitor-task-interval <n>` | `process.env.MONITOR_TASK_INTERVAL ?? '1'` | **MONITOR_TASK_INTERVAL** | L364-368 |
| `--no-resource-monitor` | `false` | — | L369-373 |
| `--parallelism <n>` | `'2'` | — | L374-378 |
| `--research-concurrency <n>` | `process.env.RESEARCH_QUEUE_CONCURRENCY ?? '3'` | **RESEARCH_QUEUE_CONCURRENCY** | L379-383 |
| `-r, --parallel-research` | `false` | desc-only (NOT wired via .default()) | L384-388 |
| `--research-depth <n>` | `process.env.RESEARCH_DEPTH ?? '2'` | **RESEARCH_DEPTH** | L389-393 |
| `--task-retry <n>` | `process.env.HACKY_TASK_RETRY_MAX_ATTEMPTS ?? '3'` | **HACKY_TASK_RETRY_MAX_ATTEMPTS** | L394-398 |
| `--retry-backoff <ms>` | `'1000'` | — | L399-403 |
| `--flush-retries <n>` | `process.env.HACKY_FLUSH_RETRIES ?? '3'` | **HACKY_FLUSH_RETRIES** | L404-408 |
| `--cache-ttl <duration>` | `process.env.HACKY_PRP_CACHE_TTL ?? '24h'` | **HACKY_PRP_CACHE_TTL** | L409-413 |
| `--cache-prune` | `false` | — | L414 |
| `--metrics-output <path>` | (none) | — | L415 |
| `--prp-compression <level>` | `'standard'` | — | L416-420 |
| `--retry` | `true` | — | L421-425 |
| `--no-retry` | `false` | — | L426 |
| `--progress-mode <mode>` | `'auto'` | — | L428-436 |

---

## 7. Dual-Config-Surface Map

| Env var | CLI flag | CLI default | Also in constants.ts? |
|---|---|---|---|
| `HACKY_LOG_LEVEL` | `--log-level` | `'info'` | No |
| `MONITOR_TASK_INTERVAL` | `--monitor-task-interval` | `'1'` | No |
| `RESEARCH_QUEUE_CONCURRENCY` | `--research-concurrency` | `'3'` | No |
| `RESEARCH_DEPTH` | `--research-depth` | `'2'` | **Yes** (`RESEARCH_DEPTH`, `getResearchDepth`, L300) |
| `HACKY_TASK_RETRY_MAX_ATTEMPTS` | `--task-retry` | `'3'` | No |
| `HACKY_FLUSH_RETRIES` | `--flush-retries` | `'3'` | No |
| `HACKY_PRP_CACHE_TTL` | `--cache-ttl` | `'24h'` | No |

**Described-but-NOT-wired:** `PARALLEL_RESEARCH` (constants.ts L355) mentioned in `--parallel-research` desc but flag default is literal `false`, NOT `process.env.PARALLEL_RESEARCH`. Only `isParallelResearch()` honors the env var at runtime.

**Env vars in constants.ts with NO CLI flag** (runtime-only getters): RESEARCH_TIMEOUT, ISSUE_RETRY_MAX, COMMIT_RETRY_MAX, COMMIT_RETRY_DELAY, COMMIT_RETRY_DELAY_CAP, CLASSIFIER_RETRY_MAX, PRP_COMMIT_FORMAT, VALIDATION_AGENT, VALIDATION_TIMEOUT, BUG_FINDER_AGENT, PRD_INCLUDE_MAX_DEPTH, PRD_INCLUDE_MARKERS, TASKS_LOCK_STALE_MS, TASKS_LOCK_TIMEOUT_MS, TASKS_LOCK_POLL_MS, PRP_MODEL_*, PRP_API_BASE_URL, PRP_API_KEY, PRP_AGENT_HARNESS.

**HACKY_* env names** (HACKY_LOG_LEVEL, HACKY_TASK_RETRY_MAX_ATTEMPTS, HACKY_FLUSH_RETRIES, HACKY_PRP_CACHE_TTL, RESEARCH_QUEUE_CONCURRENCY, MONITOR_TASK_INTERVAL) are **inline string literals** in src/cli/index.ts — no centralized constants registry.