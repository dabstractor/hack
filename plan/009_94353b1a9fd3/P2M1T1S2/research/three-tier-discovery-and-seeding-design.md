# P2.M1.T1.S2 — Research: three-tier discovery, layered merge, env-over-file seeding

Scope: build `loadHackConfig(repoRoot)` (PRD §9.7.3) on top of S1's `parseHackFile` +
`ParsedHackConfig`. Discover 3 optional tier files, layer them global→project→project-local
(per-section/key merge), and seed `process.env` ONLY for keys not already set (§9.2.1
env-over-file). Wire into `main()` between the chdir and `configureEnvironment()` (§9.7.9).

Implementation order: S1 (parse module) → S2 (this). S2 imports S1's `parseHackFile` +
`ParsedHackConfig` + `HackConfigValue` from `src/config/hack-config.ts` and ADDS
`loadHackConfig` + `MergedHackConfig` to the SAME file.

---

## 1. The contract inputs (what S2 consumes)

- **S1 output** (`src/config/hack-config.ts`, created by S1):
  - `parseHackFile(filePath: string): ParsedHackConfig` — SYNC; reads UTF-8, rejects BOM,
    rethrows TomlError with file+line+col. **CRITICAL: throws ENOENT on a missing file**
    (readFileSync propagates). → S2 MUST `existsSync(path)` BEFORE calling parseHackFile.
  - `type HackConfigValue = string | number | boolean`
  - `interface ParsedHackConfig { [section: string]: { [key: string]: HackConfigValue } }`
- **P1.M1.T1.S1 output** (`src/utils/repo-root.ts`):
  - `getRepoRoot(): string` (line 143) — reads the cached `_repoRoot` set by
    `resolveRepositoryRoot`. Throws if accessed pre-bootstrap.
  - In `main()` (`src/index.ts:~116-119`) the bootstrap ALREADY does
    `const { repoRoot } = resolveRepositoryRoot(...); process.chdir(repoRoot);` — so
    `repoRoot` is IN SCOPE at the insertion point. `getRepoRoot()` === the in-scope
    `repoRoot` (same cached value). The contract says `loadHackConfig(getRepoRoot())`; the
    in-scope `repoRoot` is strictly cleaner (no redundant call, no throw risk). PRP
    recommends `loadHackConfig(repoRoot)` and notes the equivalence.

## 2. The bootstrap insertion point (§9.7.9) — verified in src/index.ts

```
parseCLIArgs()                       // --help/--version short-circuit (Commander process.exit)
resolveRepositoryRoot(...)           // line ~116
process.chdir(repoRoot);             // line ~119  ← AFTER this
[PRD exists check]                   // lines ~120-128
setupGlobalHandlers(args.verbose);   // line ~130
configureEnvironment();              // line ~133  ← BEFORE this
getLogger(...) / configureHarness() / runAuthPreflight() / pipeline
```
§9.7.9 ordering: `parseCLIArgs → repo-root + chdir → .hack load (global→project→local) →
configureEnvironment() → configureHarness() → runAuthPreflight() → pipeline`. **Insert
`loadHackConfig(repoRoot)` immediately before `configureEnvironment()`** (after the PRD
exists check). Rationale: project files live at repoRoot (known post-chdir); seeded env
must be in place BEFORE configureEnvironment() reads process.env to resolve base URL /
auth (env-over-file: shell/.env still win because seeding only fills undefined keys).

## 3. §9.7.3 discovery — three tiers, each optional

| Tier | Path | Git-tracked | Secrets |
|------|------|-------------|---------|
| global | `$HACK_CONFIG_HOME/config` if set, else `$XDG_CONFIG_HOME/hack/config` if set, else `~/.hack` (`os.homedir()+'/.hack'`) | N/A | discouraged |
| project | `<repoRoot>/.hack` | Yes (committable) | refused (§9.7.6) |
| project-local | `<repoRoot>/.hack.local` | No (gitignored) | allowed |

- **Missing file at any tier is NOT an error** — that tier contributes nothing.
  `existsSync` check → skip. (CRITICAL: existsSync FIRST; parseHackFile throws ENOENT.)
- Project files resolved against `repoRoot` (post-chdir), NEVER invocation dir.
- Global resolved against `$HOME`-rooted paths (env overrides), independent of repo.

Global path resolver:
```ts
function globalHackPath(): string {
  if (process.env.HACK_CONFIG_HOME) return path.join(process.env.HACK_CONFIG_HOME, 'config');
  if (process.env.XDG_CONFIG_HOME) return path.join(process.env.XDG_CONFIG_HOME, 'hack', 'config');
  return path.join(os.homedir(), '.hack');
}
```

## 4. §9.7.5 schema → provisional env-var mapping (28 env keys + ~10 CLI-only)

The contract: "use a provisional mapping that covers all keys from §9.7.5 table." This is
the END-TO-END WORKING mapping now; the EXHAUSTIVE/canonical mapping (constants.ts
reconciliation) is P2.M2.T1.S1. **22 of 28 env-var names ALREADY exist in constants.ts** as
`export const` (PRP_AGENT_HARNESS, PRP_API_BASE_URL, RESEARCH_TIMEOUT, RESEARCH_DEPTH,
PARALLEL_RESEARCH, ISSUE_RETRY_MAX, PRP_COMMIT_FORMAT, COMMIT_RETRY_MAX/Delay/Cap,
CLASSIFIER_RETRY_MAX, VALIDATION_AGENT/TIMEOUT, BUG_FINDER_AGENT, PRD_INCLUDE_MAX_DEPTH,
PRD_INCLUDE_MARKERS, TASKS_LOCK_STALE_MS/TIMEOUT_MS/POLL_MS) or as MODEL_ENV_VARS values
(PRP_MODEL_HIGH/BALANCED/FAST). 6 are MISSING (no constant yet): BUG_RESULTS_FILE,
BUGFIX_SCOPE, RESEARCH_QUEUE_CONCURRENCY, API_TIMEOUT_MS, MONITOR_TASK_INTERVAL,
HACKY_LOG_LEVEL.

**Decision: define the provisional mapping as a self-contained `Record<string,string>` of
literal env-var name strings** (all 28) in hack-config.ts, marked `@provisional` (JSDoc).
Self-contained = import-safe (no risk of importing a name that doesn't exist); uniform;
P2.M2.T1.S1 reconciles against the existing constants. This is the lowest-risk reading of
"provisional mapping that covers all keys from §9.7.5 table."

The 28 env-var keys (TOML `"section.key"` → env var):
```
models.high→PRP_MODEL_HIGH            models.balanced→PRP_MODEL_BALANCED     models.fast→PRP_MODEL_FAST
endpoint.base_url→PRP_API_BASE_URL    harness.name→PRP_AGENT_HARNESS
pipeline.parallel_research→PARALLEL_RESEARCH   pipeline.research_depth→RESEARCH_DEPTH
pipeline.research_timeout_seconds→RESEARCH_TIMEOUT   pipeline.issue_retry_max→ISSUE_RETRY_MAX
pipeline.commit_format→PRP_COMMIT_FORMAT
commit.retry_max→COMMIT_RETRY_MAX     commit.retry_delay_ms→COMMIT_RETRY_DELAY
commit.retry_delay_cap_ms→COMMIT_RETRY_DELAY_CAP    commit.classifier_retry_max→CLASSIFIER_RETRY_MAX
bug_hunt.finder_agent→BUG_FINDER_AGENT   bug_hunt.results_file→BUG_RESULTS_FILE   bug_hunt.fix_scope→BUGFIX_SCOPE
validation.agent→VALIDATION_AGENT     validation.timeout_seconds→VALIDATION_TIMEOUT
distributed_prd.include_max_depth→PRD_INCLUDE_MAX_DEPTH   distributed_prd.include_markers→PRD_INCLUDE_MARKERS
tasks_lock.stale_ms→TASKS_LOCK_STALE_MS   tasks_lock.timeout_ms→TASKS_LOCK_TIMEOUT_MS   tasks_lock.poll_ms→TASKS_LOCK_POLL_MS
concurrency.research_queue→RESEARCH_QUEUE_CONCURRENCY
api.timeout_ms→API_TIMEOUT_MS         monitor.task_interval→MONITOR_TASK_INTERVAL   cli.log_level→HACKY_LOG_LEVEL
```
**CLI-only keys (NO env var — store in MergedHackConfig, do NOT seed process.env):**
concurrency.parallelism, monitor.interval_ms, monitor.enabled, cli.mode, cli.scope,
cli.machine_readable, cli.continue_on_error, cli.cache_enabled, cli.max_tasks,
cli.max_duration_ms.

**Boundary:** `[auth] override_key` is NOT in §9.7.5's table → NOT in S2's provisional
mapping → NOT seeded by S2. §9.7.9 maps it to PRP_API_KEY but that + secrets refusal
(§9.7.6) is P2.M1.T2.S1 / P2.M2.T1.S1. S2 naturally avoids it (table-derived mapping).

## 5. Layered merge (§9.7.3) — per-section/key, NOT shallow

"each key from a higher tier overwrites the same key from a lower tier" + "per-section/key
merge — nested object spread." A SHALLOW `{...global, ...project}` would REPLACE an entire
section, losing lower-tier keys. Must merge per-section:
```ts
for (const [section, keys] of Object.entries(overlay)) {
  result[section] = { ...(result[section] ?? {}), ...keys };   // nested object spread
  for (const key of Object.keys(keys)) sources[`${section}.${key}`] = tier;
}
```
Example: global `[pipeline] research_depth=2` + project `[pipeline] issue_retry_max=5` →
merged has BOTH (research_depth=2 from global, issue_retry_max=5 from project).
project-local `[pipeline] research_depth=3` → overwrites research_depth=2 → 3 (sources
records 'project-local'). This is the test's golden merge case.

## 6. Env-over-file seeding (§9.2.1) — only if process.env[X] === undefined

```ts
for (const [section, keys] of Object.entries(merged)) {
  for (const [key, value] of Object.entries(keys)) {
    const envName = HACK_KEY_TO_ENV[`${section}.${key}`];
    if (envName && process.env[envName] === undefined) {       // env-over-file: env wins
      process.env[envName] = String(value);                    // bool→"true", number→"1800"
    }
  }
}
```
- `=== undefined` (NOT also-empty): §9.2.1 says real env (layers 5–6) wins over files
  (2–4). An exported empty env var IS set → env wins → not overridden. (Treating '' as
  unset would VIOLATE env-over-file.) Use `=== undefined`.
- `String(value)`: TOML bool `true`→"true", int `1800`→"1800", string passthrough. Matches
  the existing getter pattern `Number(process.env[X] ?? DEFAULT)` + boolean getters.
- CLI-only keys (not in HACK_KEY_TO_ENV) are skipped → stay in MergedHackConfig for the CLI.

## 7. MergedHackConfig type — extends ParsedHackConfig + _sources

```ts
export type HackConfigTier = 'global' | 'project' | 'project-local';
export interface MergedHackConfig extends ParsedHackConfig {
  readonly _sources: Record<string, HackConfigTier>;   // key "section.key" → source tier
}
```
**Typechecks:** `_sources: Record<string, HackConfigTier>` satisfies ParsedHackConfig's
section index `{ [key]: HackConfigValue }` because tier strings ⊂ string ⊂ HackConfigValue
(TS is covariant on index value types). **Iteration gotcha:** `Object.keys(merged)` includes
`_sources` (it satisfies the index) — the seeding loop naturally skips it (not in
HACK_KEY_TO_ENV), but consumers reading sections must filter the `_`-prefix. Document it.
**GOTCHA:** if `readonly` on `_sources` clashes with the mutable index during typecheck,
drop `readonly` (verify; TS index bivariance usually permits it but confirm).

## 8. Boundaries (what S2 does NOT do)

- NO secrets refusal (§9.7.6) — P2.M1.T2.S1. S2 doesn't reject [auth] keys (and they're not
  in the table-derived mapping anyway, so not seeded).
- NO type/range/unknown-key validation (§9.7.7) — P2.M1.T2.S1. S2 seeds raw String(value).
- NO exhaustive canonical schema reconciliation — P2.M2.T1.S1 (the literal mapping is provisional).
- NO `hack config` subcommand (§9.7.8) — P2.M2.T2.
- NO .gitignore management / tracked-.hack.local warning — P2.M2.T3.
- S2 does NOT modify S1's parseHackFile (imports it). S2 ADDS to hack-config.ts.

## 9. Test design (mirror S1's hack-config.test.ts style; 100% coverage gate)

- **Tier files:** real temp files via `mkdtempSync` (global via stubbed
  $HACK_CONFIG_HOME/$XDG_CONFIG_HOME, project + project-local under a temp repoRoot).
- **process.env:** `vi.stubEnv` for tier-discovery vars (HACK_CONFIG_HOME, XDG_CONFIG_HOME,
  HOME) + `delete process.env[<seeded key>]` before each test, `vi.unstubAllEnvs()` in
  afterEach. **GOTCHA:** `tests/setup.ts` loads `.env`, so real env may pre-set a seeded
  key → tests MUST `delete` the specific key first or seeding is skipped (false pass).
- **Cases:** (a) no files → MergedHackConfig with empty sections + empty _sources, no env
  mutation; (b) global only; (c) project only; (d) all three with per-section/key merge +
  _sources attribution; (e) missing tier skipped (not error); (f) env-over-file: key
  already set in process.env → NOT overwritten (assert unchanged); (g) CLI-only key NOT
  seeded (absent from env); (h) bool/number coercion to String; (i) parseHackFile error on
  an existing tier propagates (BOM/malformed → throws, aborts load). Cover EVERY branch:
  existsSync true/false (×3 tiers), key in/not-in map, env set/unset, each tier winning.
- Mocking note (contract §5): vi.stubEnv for process.env; temp dirs for files; NO network.

## 10. Validation gate (verified)

- `npx vitest run tests/unit/config/hack-config.test.ts` GREEN with 100% coverage on
  src/config/hack-config.ts (S1's parse branches + S2's load branches).
- `npm run typecheck && npm run lint && npm run format:check` clean.
- `npm run build` compiles (smol-toml import path, os/path/existsSync).
- Bootstrap smoke: an end-to-end check that a temp `.hack` seeds process.env before
  configureEnvironment() — done via a focused test on loadHackConfig (not a full main()
  integration; P2.M2 reconciles main() more fully).
- The full `npm run test:run` is the project-wide gate (this plan has no pre-existing-red
  suite noted, unlike plan 008). Run it; the hack-config additions must keep it green.