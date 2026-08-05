# Research — P2.M1.T2.S1: Secrets refusal + type/range validation + error semantics + debug trace

> Verified findings grounding the PRP. All facts cross-checked against `prd_snapshot.md`
> §9.7.5/§9.7.6/§9.7.7/§9.7.10, §9.6, §9.2.7; architecture `system_context.md` §3.4/§3.5;
> `src/config/hack-config.ts` (S1 state), `environment.ts` (deprecation pattern to mirror),
> `harness.ts` (`resolveApiKeyForProvider`), `src/index.ts` (bootstrap + error rendering).

---

## 1. The contract input — S2's `loadHackConfig` (assumed implemented exactly per S2 PRP)

S2 produces this structure in `src/config/hack-config.ts` (T2.S1 EDITS it — adds 3 lines +
new functions; does NOT rewrite it):

```ts
export function loadHackConfig(repoRoot: string): MergedHackConfig {
  const tiers = [
    { tier: 'global', file: globalHackPath() },
    { tier: 'project', file: path.join(repoRoot, '.hack') },
    { tier: 'project-local', file: path.join(repoRoot, '.hack.local') },
  ];
  const merged: ParsedHackConfig = {};
  const sources: Record<string, HackConfigTier> = {};
  for (const { tier, file } of tiers) {
    if (!existsSync(file)) continue;        // missing tier is NOT an error
    const parsed = parseHackFile(file);     // S1 — BOM/malformed rethrows w/ file+line/col
    mergeTier(merged, parsed, tier, sources);
  }
  seedProcessEnv(merged);                   // S2 — HACK_KEY_TO_ENV only (EXCLUDES auth)
  return { ...merged, _sources: sources };
}
```

**T2.S1 insertion points** (minimal, 3 new lines inside the existing body):
- INSIDE the loop, right after `parseHackFile(file)` → `validateHackTier(parsed, file, tier);`
- After `seedProcessEnv(merged);` → `seedAuthOverrideKey(merged);` + `logEffectiveConfigTrace(merged, sources);`

CRITICAL: S2's `seedProcessEnv` uses `HACK_KEY_TO_ENV`, which **deliberately EXCLUDES**
`[auth] override_key` (S2 JSDoc: "secret-bearing and handled by the secrets policy
(P2.M1.T2.S1)"). → T2.S1 must add `seedAuthOverrideKey` separately (the `.hack.local`
override_key → `PRP_API_KEY` mapping the item description requires).

## 2. Secrets policy (§9.7.6) — exact rules

- **Refuse** in committable tiers (project `<repoRoot>/.hack` AND global `~/.hack` — both
  non-gitignored persistent files; §9.7.6 "`.hack.local` is the ONLY file tier permitted to
  hold secrets"): any key whose NAME ends in `_key`/`_token`/`_secret`/`_password` → **HARD
  ERROR** naming file + key + remediation, abort. The 4 explicit keys are a ⊆ of the suffix
  rule: `override_key`(_key), `zai_api_key`(_key), `anthropic_api_key`(_key),
  `anthropic_auth_token`(_token).
- **Empty/whitespace-only** secret value == "not configured" (§9.2.7) → NOT refused, NOT
  forwarded. So refusal fires ONLY for non-empty (trimmed) secrets.
- **Allow** in `project-local` (`.hack.local`): the override_key maps to `PRP_API_KEY` during
  seeding (env-over-file: only if `process.env.PRP_API_KEY === undefined`; non-empty only).
- `isSecretKey(key) = key.endsWith('_key'|'_token'|'_secret'|'_password')` — operates on the
  KEY NAME (not section.key). `results_file`(_file), `base_url`(_url) → NOT secret. Good.

## 3. Validation (§9.7.7) — exact rules

| Condition | Severity | Action |
|---|---|---|
| Unknown section | WARN once (stderr) | continue (lenient, forward-compatible) |
| Unknown key in known section | WARN once (file+section+key) | ignore (catch typos like `reseaerch_depth`) |
| Type mismatch / out-of-range / bad enum | HARD ERROR | throw (file+key+value+expected+accepted) |
| Parse error (malformed TOML) | HARD ERROR | already in S1 `parseHackFile` (file+line/col) |
| Duplicate key | HARD ERROR | smol-toml throws; S1 surfaces w/ file path |

- "Warn once" → mirror `environment.ts` `_deprecatedWarned` Set pattern: module-private
  `_validationWarned = new Set<string>()` keyed by `${kind}:${file}:${sectionKey}`, +
  `_resetValidationWarnings()` test hook (mirrors `_resetDeprecationWarnings`).
- All warnings = synchronous `console.warn` (stderr) — pino is configured AFTER config load.
- Hard errors = plain `throw new Error(msg)` — rendered by `main().catch()` default arm
  (`src/index.ts:401`: `console.error('\n❌ Fatal error in main():', error); process.exit(1)`).
  No new error class / catch arm needed (item: "the main().catch() renders the thrown error").

## 4. The validation schema (`HACK_CONFIG_SCHEMA`) — exhaustive from §9.7.5 table

Per-key spec `{ type: 'string'|'int'|'boolean'; enum?: readonly string[]; min?: number; max?: number }`
(min/max inclusive for int). TOML `int`=JS number+`Number.isInteger`; `bool`=JS boolean;
`string`=JS string. `"int > 0"`→min 1; `"int >= 1"`→min 1; `"int >= 0"`→min 0;
`"int 1–10"`→min1/max10; `"int 1–100"`→min1/max100; `"int 1000–60000"`→min1000/max60000.

Sections (all §9.7.5 keys + an `[auth]` section so secrets don't trip "unknown section"):
- `models`: high/balanced/fast = string
- `endpoint`: base_url = string
- `harness`: name = string enum `['pi','claude-code']` (= `SUPPORTED_HARNESSES`, constants.ts:175)
- `pipeline`: parallel_research=bool; research_depth=int min1; research_timeout_seconds=int min1;
  issue_retry_max=int min0; commit_format=string enum `['task-prefix','plain']` (PrpCommitFormat)
- `commit`: retry_max=int min1; retry_delay_ms=int min0; retry_delay_cap_ms=int min0
  (relational cap>=delay DEFERRED — cross-key; documented gap, P2.M2 hardens); classifier_retry_max=int min1
- `bug_hunt`: finder_agent/results_file/fix_scope = string
- `validation`: agent=string; timeout_seconds=int min1
- `distributed_prd`: include_max_depth=int min1; include_markers=bool
- `tasks_lock`: stale_ms/timeout_ms/poll_ms = int min1
- `concurrency`: research_queue=int min1/max10; parallelism=int min1/max10
- `api`: timeout_ms=int min1
- `monitor`: task_interval=int min1/max100; interval_ms=int min1000/max60000; enabled=bool
- `cli`: mode=string enum `['normal','delta','bug-hunt','validate']`; scope=string;
  log_level=string enum `['trace','debug','info','warn','error','fatal']` (pino levels);
  machine_readable/continue_on_error/cache_enabled=bool; max_tasks=int min1; max_duration_ms=int min1
- `auth`: override_key/zai_api_key/anthropic_api_key/anthropic_auth_token = string
  (all secret → caught by §9.7.6 BEFORE type check; present only so `[auth]` is a KNOWN section)

> **`[auth]` is NOT in the §9.7.5 tunables table** but §9.7.6 + the `.hack.local` example use it.
> Adding it to the schema as a known section prevents a false "unknown section" warning for
> legitimate secrets in `.hack.local`. Its keys are governed by the secrets policy, not type validation.

SCOPE NOTE: this `HACK_CONFIG_SCHEMA` is the authoritative **type/range/enum** validation
source (derived verbatim from §9.7.5). It does NOT overlap with S2's `HACK_KEY_TO_ENV`
(the env-var seeding map) nor with P2.M2.T1.S1's "full schema map" (which reconciles the
env-var/CLI-flag seeding against `constants.ts`). T2.S1 needs no constants.ts imports EXCEPT
`PRP_API_KEY` (exists at constants.ts:193 — safe; no cycle: constants.ts doesn't import hack-config).

## 5. Effective-config trace (§9.7.7 "Effective-config trace")

- Fires when `process.env.HACKY_LOG_LEVEL === 'debug'`. **Why this alone suffices:** S2's
  `seedProcessEnv` seeds `[cli] log_level → HACKY_LOG_LEVEL` (it's in `HACK_KEY_TO_ENV`) BEFORE
  the trace call, with env-over-file (shell wins). So post-seeding, `HACKY_LOG_LEVEL` already
  reflects the merged `[cli] log_level` (or the shell override). Check it AFTER seeding.
- Iterates the MERGED config sections; for each key prints `section.key = <value> (source: <tier>)`
  via `console.warn` (stderr, sync — pino not configured yet).
- MASKS secret keys: `isSecretKey(key)` → value shown as `"<redacted>"`. Secrets can only be in
  project-local (enforced), so trace shows e.g. `auth.override_key = <redacted> (source: project-local)`.
- Source tier from `sources['section.key']` (S2's `_sources`).

## 6. The mirror pattern — `environment.ts` deprecation warnings (verified, lines 38–66)

```ts
const _deprecatedWarned = new Set<string>();           // module-private dedup
export function _resetDeprecationWarnings(): void { _deprecatedWarned.clear(); }  // test hook
function warnLegacyModelVar(tier: ModelTier): void {
  const key = `model:${tier}`;
  if (_deprecatedWarned.has(key)) return;
  _deprecatedWarned.add(key);
  console.warn(`[PRP] Deprecation: ...`);              // stderr, sync (§9.6)
}
```
Test usage (`tests/unit/config/environment.test.ts:31-39`): `vi.spyOn(console,'warn').mockImplementation(()=>{})`
in beforeEach; `warnSpy.mockRestore()` + `_resetDeprecationWarnings()` in afterEach. T2.S1's
`_validationWarned` + `_resetValidationWarnings()` mirror this EXACTLY.

## 7. Bootstrap / error rendering (verified `src/index.ts`)

- `loadHackConfig(repoRoot)` is called by S2 BEFORE `configureEnvironment()` (after chdir + PRD check).
- `main().catch()` (index.ts:382-403): dedicated arms for AuthPreflightError /
  HarnessProviderMismatchError / UnsupportedHarnessError / NotARepositoryError print `\n❌ ${msg}`
  + exit(1); the DEFAULT arm (line 401) prints `\n❌ Fatal error in main(): ${error}` + exit(1).
- A plain `throw new Error(actionableMsg)` from validation → propagates from `loadHackConfig` →
  caught by the default arm → exit(1). NO index.ts edit needed for error rendering (item: "the
  main().catch() renders the thrown error").

## 8. Per-key validation ORDER (resolves §9.7.6 vs §9.7.7 precedence)

```
for each [section, keys] in parsed:
  isKnownSection = section in SCHEMA
  if !isKnownSection: warnOnce(`unknown section [section] in file; ignored`)
  for each [key, value] in keys:
    (a) SECRETS first: if isSecretKey(key):
          if value.trim()==='' → continue (not configured; §9.2.7)
          if tier !== 'project-local' → THROW hard error (§9.7.6)
          else continue (allowed in .hack.local; never echo/type-check)
    (b) !isKnownSection → continue (section already warned; ignore key)
    (c) key not in SCHEMA[section] → warnOnce unknown key (§9.7.7); continue
    (d) type/range/enum check → THROW hard error on mismatch (§9.7.7)
```
Secrets are checked BEFORE unknown-section/unknown-key so a secret in an unknown section is
still refused in committable tiers (and `isKnownSection` includes `[auth]` so legit secrets
don't false-warn). Secrets skip type validation (never echo/parse a secret value).

## 9. Test recipe (mirrors environment.test.ts + S1's temp-file style)

- `vi.spyOn(console,'warn').mockImplementation(()=>{})` (capture warnings; keep output clean);
  `vi.spyOn(console,'error')` only if asserting error-stream (hard errors THROW, so error spy
  is usually unnecessary — assert via `expect(() => loadHackConfig(tmp)).toThrow(/.../)`).
- `_resetValidationWarnings()` in afterEach (re-arm dedup Set; vitest doesn't reset module state).
- `vi.unstubAllEnvs()` + delete the specific seeded env keys before each test (.env-load gotcha).
- Temp files via `mkdtempSync`/`writeFileSync` (S1 pattern): `.hack` + `.hack.local` under a tmp repoRoot.
- Cases: (1) secret in .hack → throws + names file/key/remediation; (2) secret in .hack.local → OK +
  `PRP_API_KEY` seeded; (3) empty secret in .hack → NO throw (not configured); (4) unknown section →
  warn + continue; (5) unknown key (typo `reseaerch_depth`) → warn + ignored; (6) bad enum
  `[harness] name="foo"` / `[cli] mode="fast"` → throw + names accepted values; (7) out-of-range
  `[tasks_lock] poll_ms=-5` → throw + names range; (8) type mismatch `[pipeline] research_depth="3"`
  (string not int) → throw; (9) warn-once dedup (duplicate unknown section in one file → one warning);
  (10) debug trace masks secret (stub `HACKY_LOG_LEVEL=debug`, assert `<redacted>` + source tier, never
  the raw value); (11) auth override_key env-over-file (pre-set `PRP_API_KEY` → file value not forwarded);
  (12) debug trace does NOT fire when log_level !== debug.

## 10. Hard boundaries (do NOT do)

- Do NOT modify S1's `parseHackFile`/`ParsedHackConfig`/`HackConfigValue` (import/extend only).
- Do NOT modify S2's `HACK_KEY_TO_ENV`/`mergeTier`/`globalHackPath`/`seedProcessEnv` (the auth
  override_key → `PRP_API_KEY` is a SEPARATE `seedAuthOverrideKey` — S2 deliberately excluded auth).
- Do NOT add a new `main().catch()` arm or error class — plain `throw new Error` + default arm.
- Do NOT seed any auth key EXCEPT `override_key → PRP_API_KEY` (item specifies only this; other
  `.hack.local` auth keys are permitted-but-unseeded — P2.M2 may map them).
- Do NOT add the `hack config` subcommand (P2.M2.T2), .gitignore handling (P2.M2.T3), or the
  exhaustive constants.ts env-var reconciliation (P2.M2.T1.S1).
- Do NOT enforce the relational `retry_delay_cap_ms >= retry_delay_ms` (cross-key; documented gap).
- Do NOT use pino in this layer — logger is configured AFTER config load (§9.6); use console.warn.