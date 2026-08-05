# PRP — P2.M1.T2.S1: Secrets refusal + type/range validation + error semantics + debug trace

---

## Goal

**Feature Goal**: Implement PRD §9.7.6 (Secrets Policy) + §9.7.7 (Validation & Error Handling)
+ §9.7.10 acceptance (secret/out-of-range abort; unknown→warn; masked debug trace) as a
**validation + auth-seeding + debug-trace layer** layered onto S2's `loadHackConfig` in
`src/config/hack-config.ts`. The layer is called **per-tier after parse, before env seeding**
(secrets + type/range + unknown-key/section), plus an **auth-override seeding step** and an
**effective-config trace** that fire **after** S2's env seeding. **Completes Milestone P2.M1.**

**Deliverable** (all in `src/config/hack-config.ts` — the file S1 created and S2 extended;
T2.S1 ADDS to it, inserting 3 calls into S2's `loadHackConfig`):
1. **`HACK_CONFIG_SCHEMA`** constant — exhaustive `type`/`range`/`enum` validation spec for
   every §9.7.5 key (verbatim from the PRD table) + an `[auth]` section so secrets don't trip
   "unknown section".
2. **`isSecretKey(key)`** — suffix rule (`_key`/`_token`/`_secret`/`_password`); covers the 4
   explicit `[auth]` secret keys.
3. **`_validationWarned` Set + `_resetValidationWarnings()` test hook** — mirror the
   `environment.ts` `_deprecatedWarned` pattern (one-time stderr warning dedup).
4. **`validateHackTier(parsed, file, tier)`** — secrets policy (hard error in committable
   tiers; empty==not-configured; allowed in `.hack.local`) + unknown section/key (warn once) +
   type/range/enum (hard error). Plain `throw new Error` for hard errors; `console.warn` for warnings.
5. **`seedAuthOverrideKey(merged)`** — maps `.hack.local` `[auth] override_key` →
   `process.env.PRP_API_KEY` (env-over-file: only if undefined; non-empty only).
6. **`logEffectiveConfigTrace(merged, sources)`** — when `HACKY_LOG_LEVEL === 'debug'`, log each
   merged key + source tier + value to stderr via `console.warn`, **masking secret values**.
7. **3 new lines inside S2's `loadHackConfig`** wiring the above (see "Technical requirements").
8. **Mode-A JSDoc** on every new function documenting hard-error vs warn semantics (§9.7.7),
   the stderr requirement (§9.6/§9.7.7), the empty-string policy for secrets (§9.2.7), and
   debug-trace masking.
9. **`tests/unit/config/hack-config.test.ts`** — EXTEND S1/S2's file: add
   `describe('hack-config: secrets & validation')` covering every branch (real temp files +
   `vi.spyOn(console,'warn')` + `_resetValidationWarnings`).

**Success Definition**:
- A non-empty secret key (e.g. `[auth] zai_api_key = "sk-..."`) in the **project** `.hack` (or
  global `~/.hack`) → `loadHackConfig` THROWS an Error naming the file, the offending key, and
  the remediation; `process.exitCode` becomes 1 (via `main().catch()` default arm). The same key
  in `.hack.local` is accepted and (for `override_key`) seeds `PRP_API_KEY`.
- An **empty/whitespace** secret value in ANY tier is treated as "not configured" — NOT refused,
  NOT forwarded.
- An **unknown section** → one `console.warn` (stderr) naming file+section; load continues.
- An **unknown key** in a known section (e.g. `[pipeline] reseaerch_depth`) → one `console.warn`
  naming file+section+key; the key is ignored.
- A **type mismatch / out-of-range / bad enum** (e.g. `[tasks_lock] poll_ms = -5`,
  `[harness] name = "foo"`, `[cli] mode = "fast"`) → THROWS an Error naming file, section, key,
  offending value, expected type/range, and accepted values; aborts.
- When `HACKY_LOG_LEVEL === 'debug'`, each merged key is logged to stderr with its source tier
  and resolved value, with every secret value masked (never the raw value).
- `npm run typecheck && npm run lint && npm run format:check` clean; `npx vitest run
  tests/unit/config/hack-config.test.ts` GREEN; `npm run build` compiles; `npm run validate` exits 0.
- T2.S1 does NOT add the `hack config` subcommand (P2.M2.T2), .gitignore handling (P2.M2.T3),
  or the exhaustive constants.ts env-var reconciliation (P2.M2.T1.S1).

---

## Why

- **Realizes §9.7.6 + §9.7.7 fail-fast.** A committed `.hack` must never silently carry a
  secret, and a misconfigured tunable (negative timeout, typo'd key, bogus enum) must abort at
  startup — not surface as a deep runtime error mid-pipeline (mirrors the §9.2.7 auth preflight
  philosophy). Validation runs **before** any agent run because `loadHackConfig` is the earliest
  config-reading step after the §9.8 chdir.
- **Wires the `.hack.local` auth override.** §9.7.6/§9.7.9 mandate `[auth] override_key` in
  `.hack.local` → `PRP_API_KEY` (the §9.2.6 layer-1 explicit override that
  `resolveApiKeyForProvider` reads at `harness.ts:73`). S2's `seedProcessEnv` deliberately
  excludes `[auth]` (secret-bearing), so T2.S1 adds the dedicated `seedAuthOverrideKey`.
- **Debug trace = the primary config diagnostics aid** (before the `hack config show`
  subcommand lands in P2.M2.T2). At `--log-level debug` a user sees exactly which tier each
  value came from, with secrets masked — safe to paste in a bug report.
- **Out of scope (hard boundaries):** the `hack config` subcommand §9.7.8 (P2.M2.T2), .gitignore
  management + tracked-`.hack.local` warning (P2.M2.T3), exhaustive env-var/CLI-flag schema
  reconciliation against `constants.ts` (P2.M2.T1.S1 — a *seeding* concern, not a type/range
  concern), modifying S1's `parseHackFile`/types (import/extend only), modifying S2's
  `HACK_KEY_TO_ENV`/`mergeTier`/`globalHackPath`/`seedProcessEnv`, the relational
  `retry_delay_cap_ms >= retry_delay_ms` cross-key check (documented gap).

---

## What

### User-visible behavior
A `.hack` (or `~/.hack`) carrying a secret, a typo'd key, or an out-of-range value aborts
startup with a single actionable stderr message naming the file, the offending key/value, and
the fix — before any agent runs. An unknown section/key produces a stderr warning and the run
proceeds. A `.hack.local` may carry `[auth] override_key`, which supplies `PRP_API_KEY` unless
the shell already set it. At `--log-level debug`, every resolved `.hack` key is traced to stderr
with its source tier and masked secrets. No new CLI surface in T2.S1.

### Technical requirements (exact contract)

**`src/config/hack-config.ts`** — ADD to S2's file. New import: `PRP_API_KEY` from
`./constants.js` (exists at `constants.ts:193`; safe — `constants.ts` does not import
`hack-config`, so no cycle). Do NOT touch S1's `parseHackFile`/`ParsedHackConfig`/`HackConfigValue`
or S2's `HACK_KEY_TO_ENV`/`mergeTier`/`globalHackPath`/`seedProcessEnv`.

**New constant — the validation schema** (exhaustive from §9.7.5; `min`/`max` inclusive for int;
`"int > 0"`→`min:1`, `"int >= 0"`→`min:0`, `"int 1–10"`→`min:1,max:10`, etc.):
```ts
/** Per-field validation spec for a known §9.7.5 `[section].key`. */
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
 */
const HACK_CONFIG_SCHEMA: Readonly<Record<string, Readonly<Record<string, HackConfigFieldSpec>>>> = {
  models: {
    high: { type: 'string' }, balanced: { type: 'string' }, fast: { type: 'string' },
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
    finder_agent: { type: 'string' }, results_file: { type: 'string' }, fix_scope: { type: 'string' },
  },
  validation: { agent: { type: 'string' }, timeout_seconds: { type: 'int', min: 1 } },
  distributed_prd: { include_max_depth: { type: 'int', min: 1 }, include_markers: { type: 'boolean' } },
  tasks_lock: {
    stale_ms: { type: 'int', min: 1 }, timeout_ms: { type: 'int', min: 1 }, poll_ms: { type: 'int', min: 1 },
  },
  concurrency: {
    research_queue: { type: 'int', min: 1, max: 10 }, parallelism: { type: 'int', min: 1, max: 10 },
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
    log_level: { type: 'string', enum: ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] },
    machine_readable: { type: 'boolean' },
    continue_on_error: { type: 'boolean' },
    cache_enabled: { type: 'boolean' },
    max_tasks: { type: 'int', min: 1 },
    max_duration_ms: { type: 'int', min: 1 },
  },
  auth: { // NOT in §9.7.5 tunables table; known section so secrets don't false-warn (§9.7.6)
    override_key: { type: 'string' },
    zai_api_key: { type: 'string' },
    anthropic_api_key: { type: 'string' },
    anthropic_auth_token: { type: 'string' },
  },
};

const SECRET_SUFFIXES = ['_key', '_token', '_secret', '_password'] as const;

/** True if a `.hack` key NAME is secret-bearing (PRD §9.7.6 suffix rule). */
function isSecretKey(key: string): boolean {
  return SECRET_SUFFIXES.some((s) => key.endsWith(s));
}
```

**One-time warning dedup** (mirror `environment.ts:42-66`):
```ts
const _validationWarned = new Set<string>();

/** Test-only hook to re-arm the one-time warning dedup (mirrors environment.ts). @internal */
export function _resetValidationWarnings(): void {
  _validationWarned.clear();
}

/** Emit a one-time §9.7.7 validation WARNING to stderr synchronously (PRD §9.6/§9.7.7). */
function warnOnceValidation(message: string, dedupKey: string): void {
  if (_validationWarned.has(dedupKey)) return;
  _validationWarned.add(dedupKey);
  console.warn(`[hack] ${message}`); // stderr, sync — pino configured AFTER config load (§9.6)
}
```

**Per-tier validator** (secrets → unknown section/key → type/range/enum; order matters — see
research §8):
```ts
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
 * @param parsed - The tier's parsed config.
 * @param file - Absolute path of the tier file (for error attribution).
 * @param tier - Which discovery tier (only 'project-local' may hold secrets).
 * @throws {Error} on a non-empty secret in a committable tier, or on a type/range/enum mismatch.
 */
function validateHackTier(
  parsed: ParsedHackConfig,
  file: string,
  tier: HackConfigTier
): void {
  for (const [section, keys] of Object.entries(parsed)) {
    const sectionSchema = HACK_CONFIG_SCHEMA[section];
    const isKnownSection = sectionSchema !== undefined;
    if (!isKnownSection) {
      warnOnceValidation(`unknown section [${section}] in ${file}; ignored`, `section:${file}:${section}`);
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
        warnOnceValidation(`unknown key [${section}] ${key} in ${file}; ignored`, `key:${file}:${section}.${key}`);
        continue;
      }
      // (d) type/range/enum (§9.7.7) — HARD error.
      validateFieldValue(file, section, key, value, spec);
    }
  }
}

/** Type/range/enum check for a known key (PRD §9.7.7). Throws on mismatch. */
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
      throw new Error(`[${section}] ${key} in ${file}: ${value} is out of range (${range}).`);
    }
    if (spec.max !== undefined && value > spec.max) {
      throw new Error(`[${section}] ${key} in ${file}: ${value} is out of range (${range}).`);
    }
  }
  if (spec.type === 'string' && spec.enum !== undefined && !spec.enum.includes(value as string)) {
    throw new Error(
      `[${section}] ${key} in ${file}: ${JSON.stringify(value)} is not one of the accepted values ` +
        `[${spec.enum.join(', ')}].`
    );
  }
}
```

**Auth-override seeding** (the `.hack.local` `override_key` → `PRP_API_KEY` mapping; runs AFTER
S2's `seedProcessEnv`):
```ts
/**
 * Seed `process.env.PRP_API_KEY` from a `.hack.local` `[auth] override_key` (PRD §9.7.6/§9.7.9).
 *
 * @remarks `.hack.local` is the ONLY tier permitted to hold secrets (enforced by
 * {@link validateHackTier}); by the time this runs, any `override_key` in {@link merged} therefore
 * originated in `project-local` (committable tiers with a non-empty secret aborted earlier). Seeds
 * ONLY when `process.env.PRP_API_KEY` is undefined (§9.2.1 env-over-file) and the value is
 * non-empty (§9.2.7 empty-string policy — empty/whitespace == not configured, never forwarded).
 * This is the §9.2.6 layer-1 explicit override that `resolveApiKeyForProvider` reads at harness.ts:73.
 */
function seedAuthOverrideKey(merged: ParsedHackConfig): void {
  const v = merged.auth?.override_key;
  if (typeof v === 'string' && v.trim() !== '' && process.env[PRP_API_KEY] === undefined) {
    process.env[PRP_API_KEY] = v;
  }
}
```

**Effective-config trace** (debug only; masks secrets):
```ts
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
```

**Wire into S2's `loadHackConfig`** — insert the 3 marked lines (S2's body is quoted verbatim;
only the `// NEW` lines are added):
```ts
export function loadHackConfig(repoRoot: string): MergedHackConfig {
  const tiers /* = [...] (S2 — unchanged) */;
  const merged: ParsedHackConfig = {};
  const sources: Record<string, HackConfigTier> = {};

  for (const { tier, file } of tiers) {
    if (!existsSync(file)) continue;          // S2 — missing tier is not an error
    const parsed = parseHackFile(file);        // S1 — BOM/malformed rethrows (file+line/col)
    validateHackTier(parsed, file, tier);      // NEW (P2.M1.T2.S1) — §9.7.6 secrets + §9.7.7 validation
    mergeTier(merged, parsed, tier, sources);  // S2
  }

  seedProcessEnv(merged);                      // S2 — HACK_KEY_TO_ENV only (excludes [auth])
  seedAuthOverrideKey(merged);                 // NEW — .hack.local override_key → PRP_API_KEY (§9.7.6)
  logEffectiveConfigTrace(merged, sources);    // NEW — --log-level debug trace, masked (§9.7.7)
  return { ...merged, _sources: sources };     // S2
}
```
> The implementer reads S2's actual `loadHackConfig` in the file and inserts ONLY the 3 `// NEW`
> lines plus the new functions above it. If S2's local variable is named `sources` (it is, per the
> S2 PRP), pass it directly; if it differs, adapt the argument name. Do NOT otherwise edit S2's body.

### Success Criteria
- [ ] Non-empty secret key in project `.hack` or global `~/.hack` → `loadHackConfig` THROWS an
      Error naming file + `[section] key` + remediation (move to `.hack.local`/env var).
- [ ] Empty/whitespace secret value in any tier → NOT refused, NOT forwarded (§9.2.7).
- [ ] Secret key in `.hack.local` → accepted; `[auth] override_key` (non-empty) seeds
      `process.env.PRP_API_KEY` only when undefined.
- [ ] Unknown section → one `console.warn` (stderr) naming file+section; load continues.
- [ ] Unknown key in known section → one `console.warn` naming file+section+key; key ignored.
- [ ] Type mismatch / out-of-range / bad enum → THROWS naming file+section+key+value+expected+accepted.
- [ ] `HACKY_LOG_LEVEL === 'debug'` → each merged key logged to stderr with source tier + value;
      every secret value masked.
- [ ] `npm run typecheck && npm run lint && npm run format:check` clean; targeted vitest GREEN;
      `npm run build` compiles; `npm run validate` exits 0.
- [ ] No `hack config` subcommand / .gitignore handling / constants.ts reconciliation added (deferred).

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_
**Yes.** The verbatim implementations of every new function + the 3-line `loadHackConfig`
insertion are given. The S2 contract (`loadHackConfig` structure, `_sources`, `seedProcessEnv`
excluding `[auth]`) is quoted. The §9.7.5 schema table is transcribed into `HACK_CONFIG_SCHEMA`.
The §9.7.6/§9.7.7 rules and per-key validation ORDER are pinned (research §8). The
`environment.ts` dedup pattern to mirror is quoted (research §6). The error-rendering path
(`main().catch()` default arm) is verified (`src/index.ts:401`). The `PRP_API_KEY` import safety
(no cycle) is confirmed. The console.warn test pattern (`environment.test.ts:31-39`) is quoted.
The `.env`-load test gotcha and the 100%-coverage branch map are enumerated.

### Documentation & References
```yaml
# MUST READ — the PRD spec this implements
- docfile: plan/009_94353b1a9fd3/prd_snapshot.md
  section: "9.7.6 Secrets Policy"
  why: The 4 explicit secret keys + the _key/_token/_secret/_password suffix rule; ".hack.local is
        the ONLY tier permitted to hold secrets"; override_key→PRP_API_KEY; empty==not-configured.
- docfile: plan/009_94353b1a9fd3/prd_snapshot.md
  section: "9.7.7 Validation & Error Handling"
  why: unknown-section=warn-once+continue; unknown-key=warn-once+ignore; type/range=hard error;
        parse/duplicate handled by smol-toml; ALL warnings/errors to stderr sync (pino post-config);
        effective-config trace at --log-level debug, masked secrets.
- docfile: plan/009_94353b1a9fd3/prd_snapshot.md
  section: "9.7.10 Acceptance Criteria"
  why: "[auth] zai_api_key in .hack aborts; same in .hack.local accepted + seeds PRP_API_KEY";
        out-of-range/typo aborts before any agent; unknown→stderr warning+proceeds; no unmasked secret.
- docfile: plan/009_94353b1a9fd3/prd_snapshot.md
  section: "9.7.5 Schema Reference"
  why: The EXHAUSTIVE type/range/enum table — the verbatim source of HACK_CONFIG_SCHEMA.
- docfile: plan/009_94353b1a9fd3/prd_snapshot.md
  section: "9.2.7 Authentication Preflight (Fail-Fast)"
  why: The empty-string policy ("empty/whitespace == not configured, never forwarded") + the
        fail-fast philosophy this validation layer mirrors.
- docfile: plan/009_94353b1a9fd3/prd_snapshot.md
  section: "9.6.2 Requirements" + "9.6.3 Acceptance Criteria"
  why: REQ-L1 (synchronous stderr destinations) — why this layer MUST use console.warn, not pino.

# MUST READ — S2's PRP (the contract input; defines loadHackConfig + seedProcessEnv + _sources)
- docfile: plan/009_94353b1a9fd3/P2M1T1S2/PRP.md
  section: "Technical requirements", "What"
  why: S2's loadHackConfig body (quote the 3 insertion points); seedProcessEnv uses HACK_KEY_TO_ENV
        which EXCLUDES [auth] → T2.S1 adds seedAuthOverrideKey. Do NOT modify S2's helpers.
  critical: S2 names the per-key source map `sources` (passed to mergeTier) — reuse that name.

# MUST READ — this subtask's research (verbatim impl + per-key order + schema + boundaries)
- docfile: plan/009_94353b1a9fd3/P2M1T2S1/research/validation-and-secrets-design.md
  section: §2 secrets, §3 validation rules, §4 schema (exhaustive), §5 trace, §6 mirror pattern,
           §8 per-key ORDER, §9 test recipe, §10 boundaries
  why: Verified facts: secrets checked FIRST (before unknown-section); [auth] is a known section;
        empty secret skipped; env-over-file for PRP_API_KEY seeding (=== undefined); trace masks
        isSecretKey; the relational retry_delay_cap_ms check is a documented gap.

# MUST READ — architecture (secrets policy notes + schema surface)
- docfile: plan/009_94353b1a9fd3/architecture/system_context.md
  section: "3.5 Secrets Policy Implementation Notes", "3.4 Complete Schema Surface"
  why: Confirms the secret-bearing key list + suffix rule + "detected during parsing/validation".
        Cross-checks the §9.7.5 schema against constants.ts env-var names.

# THE FILE TO EDIT — S1+S2's module (T2.S1 ADDS the validation layer + 3 wiring lines)
- file: src/config/hack-config.ts
  why: ADD HACK_CONFIG_SCHEMA, HackConfigFieldSpec, isSecretKey, _validationWarned,
        _resetValidationWarnings, warnOnceValidation, validateHackTier, validateFieldValue,
        seedAuthOverrideKey, logEffectiveConfigTrace. + import PRP_API_KEY from './constants.js'.
        Insert the 3 // NEW lines into loadHackConfig. parseHackFile/HACK_KEY_TO_ENV/mergeTier UNCHANGED.
  pattern: mirror S1/S2's JSDoc density + SYNC style + the environment.ts dedup pattern.
  gotcha: import PRP_API_KEY (constants.ts:193) — safe, no cycle. Do NOT add [auth] to HACK_KEY_TO_ENV.

# THE CONSUMER — resolveApiKeyForProvider reads PRP_API_KEY (layer-1 override)
- file: src/config/harness.ts
  why: resolveApiKeyForProvider(provider, options?) (L57-80) reads process.env.PRP_API_KEY as the
        HIGHEST-priority credential override (after options.override). seedAuthOverrideKey feeds it.
  gotcha: read-only reference; DO NOT edit. Confirms the override_key→PRP_API_KEY→harness data flow.

# THE PATTERN TO MIRROR — one-time stderr warning dedup + its test hook
- file: src/config/environment.ts
  why: _deprecatedWarned Set + _resetDeprecationWarnings() + console.warn (stderr, §9.6). T2.S1's
        _validationWarned/_resetValidationWarnings/warnOnceValidation mirror this EXACTLY.
- file: tests/unit/config/environment.test.ts
  why: vi.spyOn(console,'warn').mockImplementation(()=>{}) in beforeEach; warnSpy.mockRestore() +
        _resetDeprecationWarnings() in afterEach. T2.S1 mirrors with _resetValidationWarnings().

# ERROR RENDERING — main().catch() default arm (no new arm/class needed)
- file: src/index.ts
  why: main().catch() (L382-403) default arm prints '\n❌ Fatal error in main(): ${error}' + exit(1).
        A plain throw new Error from validateHackTier propagates through loadHackConfig → here.
  gotcha: read-only; DO NOT add a catch arm (item: "the main().catch() renders the thrown error").
```

### Current Codebase tree (relevant slice — T2.S1 adds to S1+S2's file + extends its tests)
```bash
src/config/hack-config.ts        # S1 (parseHackFile) + S2 (loadHackConfig/HACK_KEY_TO_ENV/_sources); T2.S1 ADDS validation layer + 3 wiring lines
src/config/constants.ts          # existing — PRP_API_KEY (L193), SUPPORTED_HARNESSES (L175), PrpCommitFormat; import PRP_API_KEY (NOT edited)
src/config/harness.ts            # existing — resolveApiKeyForProvider reads PRP_API_KEY (L73); read-only reference
src/config/environment.ts        # existing — the _deprecatedWarned pattern to MIRROR (NOT edited)
src/index.ts                     # S2 wired loadHackConfig here; T2.S1 does NOT touch it (default catch arm renders throws)
tests/unit/config/hack-config.test.ts   # S1+S2 created; T2.S1 EXTENDS (+ describe('hack-config: secrets & validation'))
```

### Desired Codebase tree with files to be added/edited
```bash
src/config/hack-config.ts                 # MODIFIED (T2.S1 adds HACK_CONFIG_SCHEMA + isSecretKey + validateHackTier + validateFieldValue
#                                         #          + seedAuthOverrideKey + logEffectiveConfigTrace + _validationWarned/_resetValidationWarnings
#                                         #          + warnOnceValidation + HackConfigFieldSpec + 3 wiring lines in loadHackConfig + JSDoc)
tests/unit/config/hack-config.test.ts     # MODIFIED (T2.S1 adds describe('hack-config: secrets & validation') suite)
```

### Known Gotchas of our codebase & Library Quirks
```ts
// CRITICAL — secrets checked FIRST, on the KEY NAME, before any value echoing. A secret in an
//   unknown section must STILL be refused in committable tiers. Order: secrets → unknown-section →
//   unknown-key → type/range. (research §8.) And [auth] MUST be a known section in HACK_CONFIG_SCHEMA
//   or a legit .hack.local secret trips a false "unknown section" warning.

// CRITICAL — empty/whitespace secret == "not configured" (§9.2.7). Refusal fires ONLY for NON-EMPTY
//   (trimmed) secrets in committable tiers. `if (typeof value==='string' && value.trim()==='') continue;`
//   BEFORE the tier check. An empty `[auth] zai_api_key=""` in .hack is harmless → no throw, no forward.

// CRITICAL — secrets are NEVER type-checked or echoed. Once isSecretKey(key) is true, branch out:
//   committable+non-empty → throw; empty → skip; project-local → allowed+skip. Never call
//   validateFieldValue on a secret (it would JSON.stringify the secret value into a thrown message).

// CRITICAL — hard errors are a PLAIN throw new Error(msg). main().catch() default arm renders them
//   (index.ts:401). Do NOT add a new error class / catch arm (item constraint). Do NOT console.error
//   the hard error yourself — throwing lets the single catch arm own rendering + exit code.

// GOTCHA — seedAuthOverrideKey runs AFTER seedProcessEnv. By then any override_key in `merged` came
//   from project-local (committable tiers with a non-empty secret already threw). Guard with
//   `process.env[PRP_API_KEY] === undefined` (env-over-file) AND `value.trim() !== ''` (empty policy).

// GOTCHA — the debug trace MUST run after seeding (so HACKY_LOG_LEVEL reflects the merged [cli]
//   log_level / shell override). Mask EVERY isSecretKey key as '"<redacted>"' — never the raw value.
//   Use console.warn (stderr, sync); pino is configured later (§9.6). Source tier from `sources`.

// GOTCHA — HACK_KEY_TO_ENV (S2) deliberately EXCLUDES [auth]. Do NOT add [auth] override_key to it.
//   The override_key→PRP_API_KEY mapping is a SEPARATE seedAuthOverrideKey (S2 left it for T2.S1).

// GOTCHA — TOML int = JS number + Number.isInteger; bool = JS boolean; string = JS string. A TOML
//   `poll_ms = true` is a TYPE mismatch (boolean where int expected) → hard error, NOT a range error.

// GOTCHA — "warn once": mirror environment.ts _deprecatedWarned. Dedup key per (kind,file,location):
//   `section:${file}:${section}` / `key:${file}:${section}.${key}`. _resetValidationWarnings() test
//   hook in afterEach (vitest does NOT reset module state between tests in a file).

// GOTCHA — tests/setup.ts loads .env → real process.env may pre-set PRP_API_KEY / HACKY_LOG_LEVEL.
//   In tests, DELETE the specific env key before each test (or seeding/trace is skipped = false pass).
//   afterEach: vi.unstubAllEnvs() + warnSpy.mockRestore() + _resetValidationWarnings().

// GOTCHA — prettier is ERROR-enforced (format:check). Run `npm run fix` before validate. Cover EVERY
//   branch for coverage: secrets × {empty, project, global, project-local}; unknown section/key ×
//   {once, dedup}; type/range/enum × {pass, each-fail}; trace × {debug, non-debug, secret-masked};
//   auth-seed × {undefined env, set env, empty value}.

// GOTCHA — import PRP_API_KEY from './constants.js' (exists L193). constants.ts does NOT import
//   hack-config → no cycle. Do NOT use a raw literal; the canonical const is the single source of truth.

// DOCUMENTED GAP — the relational `commit.retry_delay_cap_ms >= commit.retry_delay_ms` is NOT
//   enforced (cross-key; complicates the clean per-key model). retry_delay_cap_ms validates as
//   int >= 0 only. P2.M2 may harden. Note in the commit message.
```

---

## Implementation Blueprint

### Data models and structure
No runtime types beyond `HackConfigFieldSpec` (the per-field spec). `HACK_CONFIG_SCHEMA` is a
`Readonly<Record<string, Readonly<Record<string, HackConfigFieldSpec>>>>`. `SECRET_SUFFIXES` is a
`readonly [...]`. `_validationWarned` is a module-private `Set<string>`. All SYNC; no new deps.

### Implementation Tasks (ordered by dependencies)
```yaml
Task 1: EDIT src/config/hack-config.ts — schema + secrets + validators (no wiring yet)
  - ADD import: `import { PRP_API_KEY } from './constants.js';` (alongside S2's existing imports).
        Keep S1's smol-toml import + S2's node:fs/node:os/node:path imports UNCHANGED.
  - ADD `export interface HackConfigFieldSpec { ... }` + `const HACK_CONFIG_SCHEMA` (verbatim from
        "Technical requirements" — exhaustive §9.7.5 + the [auth] section).
  - ADD `const SECRET_SUFFIXES` + `function isSecretKey(key)`.
  - ADD `const _validationWarned = new Set<string>()` + `export function _resetValidationWarnings()`
        + `function warnOnceValidation(message, dedupKey)`.
  - ADD `function validateHackTier(parsed, file, tier)` + `function validateFieldValue(...)` (verbatim).
  - ADD `function seedAuthOverrideKey(merged)` + `function logEffectiveConfigTrace(merged, sources)`.
  - DO NOT modify parseHackFile / ParsedHackConfig / HackConfigValue (S1) or HACK_KEY_TO_ENV /
        mergeTier / globalHackPath / seedProcessEnv / MergedHackConfig / HackConfigTier (S2).
  - EXPECTED: typecheck GREEN (HackConfigValue covers string|number|boolean; spec.type narrows).

Task 2: EDIT src/config/hack-config.ts — wire the 3 calls into loadHackConfig
  - In S2's loadHackConfig, insert EXACTLY 3 lines (see "Technical requirements"):
        * after `const parsed = parseHackFile(file);`  →  `validateHackTier(parsed, file, tier);`
        * after `seedProcessEnv(merged);`               →  `seedAuthOverrideKey(merged);`
        * then                                          →  `logEffectiveConfigTrace(merged, sources);`
  - Pass S2's actual `sources` local (S2 PRP names it `sources`; adapt if it differs).
  - EXPECTED: typecheck GREEN; loadHackConfig now validates per-tier + seeds auth + traces debug.

Task 3: EDIT tests/unit/config/hack-config.test.ts — EXTEND with describe('hack-config: secrets & validation')
  - IMPORTS: add `_resetValidationWarnings` to the existing `from '../../../src/config/hack-config.js'`
        import; `vi` (add to the vitest import if S1/S2 didn't). Keep S1's mkdtempSync/writeFileSync/etc.
  - ADD `describe('hack-config: secrets & validation', () => { ... })` with:
      let warnSpy; let dir;
      beforeEach: dir = mkdtempSync(...); warnSpy = vi.spyOn(console,'warn').mockImplementation(()=>{});
                  delete process.env.PRP_API_KEY; delete process.env.HACKY_LOG_LEVEL;
      afterEach: vi.unstubAllEnvs(); warnSpy.mockRestore(); _resetValidationWarnings(); rmSync(dir).
  - CASES (cover EVERY branch — research §9):
      * secret in PROJECT .hack ([auth] zai_api_key="sk-x") → loadHackConfig(dir) THROWS; msg matches
        /zai_api_key/ + dir's .hack path + remediation (/\.hack\.local|environment variable/).
      * secret in GLOBAL ~/.hack (stub HACK_CONFIG_HOME → temp + config file with override_key="sk")
        → THROWS naming that file.
      * secret in .hack.local ([auth] override_key="sk-local") → NO throw; process.env.PRP_API_KEY ===
        "sk-local" (assert seeded).
      * EMPTY secret in .hack ([auth] zai_api_key="   ") → NO throw; value not forwarded.
      * auth env-over-file: pre-set process.env.PRP_API_KEY="from-shell" + .hack.local override_key="x"
        → PRP_API_KEY stays "from-shell" (=== undefined guard).
      * unknown section ([foo] bar=1 in .hack) → NO throw; warnSpy called once with /unknown section \[foo\]/.
      * unknown key in known section ([pipeline] reseaerch_depth=2) → NO throw; warnSpy /unknown key/;
        the typo key is ignored (assert it did not seed RESEARCH_DEPTH — stays the real default/undefined).
      * warn-once dedup: two unknown keys in one section in one file → warnSpy called once per unique key.
      * out-of-range ([tasks_lock] poll_ms=-5) → THROWS /out of range/ + names the file + key.
      * bad enum ([harness] name="foo") → THROWS /not one of the accepted values/ + lists 'pi','claude-code'.
      * bad enum ([cli] mode="fast") → THROWS /accepted values/ + lists normal/delta/bug-hunt/validate.
      * type mismatch ([pipeline] research_depth="3" as a TOML string) → THROWS /expected integer/.
      * type mismatch ([pipeline] parallel_research="true" as string) → THROWS /expected boolean/.
      * range high bound ([concurrency] research_queue=11) → THROWS /out of range/ (max 10).
      * debug trace masks secret: stub HACKY_LOG_LEVEL="debug" + .hack.local override_key="sk" +
        .hack [pipeline] research_depth=3 → warnSpy includes a line /research_depth = 3.*source: project/
        AND a line /auth\.override_key = "<redacted>".*source: project-local/; assert NO warnSpy line
        contains the literal "sk" (secret never echoed).
      * debug trace does NOT fire at info: HACKY_LOG_LEVEL unset (or "info") → warnSpy NOT called for
        the trace (only for any real warnings); assert no /source: / lines.
      * known-good config (a full valid .hack mirroring §9.7.5 example) → NO throw, NO warn; merges.
  - EXPECTED: GREEN; no coverage regression on hack-config.ts (S1/S2 branches still covered by their suites).

Task 4: FORMAT + VERIFY
  - RUN: npm run fix → npm run typecheck → npm run lint → npm run format:check. (MUST be clean.)
  - RUN: npx vitest run tests/unit/config/hack-config.test.ts (GREEN).
  - RUN: npm run build (compiles — PRP_API_KEY import resolves).
  - RUN: npm run validate (full gate — MUST exit 0; no regression in sibling suites).
  - RUN: grep -n "validateHackTier\|seedAuthOverrideKey\|logEffectiveConfigTrace" src/config/hack-config.ts
        (EXPECTED: 1 call site each inside loadHackConfig + their definitions).
  - EXPECTED: all green; validation wired; secrets/auth/trace integrated; no regression.
```

### Implementation Patterns & Key Details
```ts
// ---- per-key validation ORDER (secrets first, then unknown, then type/range) ----
for (const [section, keys] of Object.entries(parsed)) {
  const sectionSchema = HACK_CONFIG_SCHEMA[section];
  const isKnownSection = sectionSchema !== undefined;
  if (!isKnownSection) warnOnceValidation(`unknown section [${section}] in ${file}; ignored`, `section:${file}:${section}`);
  for (const [key, value] of Object.entries(keys)) {
    if (isSecretKey(key)) {                                   // (a) §9.7.6 FIRST
      if (typeof value === 'string' && value.trim() === '') continue;   // empty == not configured
      if (tier !== 'project-local') throw new Error(`Secret-bearing key [${section}] ${key} ... ${file} ... (PRD §9.7.6) ...`);
      continue;                                               // .hack.local: allowed, skip type-check
    }
    if (!isKnownSection) continue;                            // (b) section already warned
    const spec = sectionSchema[key];
    if (spec === undefined) { warnOnceValidation(`unknown key [${section}] ${key} in ${file}; ignored`, `key:${file}:${section}.${key}`); continue; }
    validateFieldValue(file, section, key, value, spec);       // (d) §9.7.7 hard error
  }
}

// ---- auth-override seeding (env-over-file + empty policy) ----
function seedAuthOverrideKey(merged: ParsedHackConfig): void {
  const v = merged.auth?.override_key;
  if (typeof v === 'string' && v.trim() !== '' && process.env[PRP_API_KEY] === undefined) {
    process.env[PRP_API_KEY] = v;
  }
}

// ---- debug trace (post-seeding HACKY_LOG_LEVEL; mask secrets) ----
function logEffectiveConfigTrace(merged, sources): void {
  if (process.env.HACKY_LOG_LEVEL !== 'debug') return;
  for (const [section, keys] of Object.entries(merged))
    for (const [key, value] of Object.entries(keys)) {
      const display = isSecretKey(key) ? '"<redacted>"' : JSON.stringify(value);
      console.warn(`[hack] ${section}.${key} = ${display}  (source: ${sources[`${section}.${key}`] ?? 'unknown'})`);
    }
}

// ---- the 3 wiring lines inside S2's loadHackConfig ----
//   const parsed = parseHackFile(file);
//   validateHackTier(parsed, file, tier);          // NEW
//   mergeTier(merged, parsed, tier, sources);
// ... seedProcessEnv(merged);
//   seedAuthOverrideKey(merged);                   // NEW
//   logEffectiveConfigTrace(merged, sources);      // NEW
```

### Integration Points
```yaml
MODULE (src/config/hack-config.ts):
  - + import PRP_API_KEY from './constants.js' (safe; no cycle).
  - + HackConfigFieldSpec (interface); + HACK_CONFIG_SCHEMA (exhaustive §9.7.5 + [auth] section).
  - + SECRET_SUFFIXES / isSecretKey / _validationWarned / _resetValidationWarnings / warnOnceValidation.
  - + validateHackTier / validateFieldValue / seedAuthOverrideKey / logEffectiveConfigTrace (private;
        _resetValidationWarnings exported for tests).
  - loadHackConfig: +3 calls (validateHackTier in loop; seedAuthOverrideKey + logEffectiveConfigTrace
        after seedProcessEnv). S1/S2 internals UNCHANGED.

CONSTANTS (src/config/constants.ts): read-only — PRP_API_KEY (L193) imported. NOT edited.

HARNESS (src/config/harness.ts): read-only — resolveApiKeyForProvider (L73) consumes the seeded
        PRP_API_KEY. NOT edited. (Confirms the override_key→PRP_API_KEY→harness data flow.)

INDEX (src/index.ts): NOT edited by T2.S1. S2 already calls loadHackConfig(repoRoot) before
        configureEnvironment(); a throw propagates to main().catch() default arm (L401) → exit 1.

TESTS (tests/unit/config/hack-config.test.ts): + describe('hack-config: secrets & validation') using
        vi.spyOn(console,'warn') + _resetValidationWarnings() + temp .hack/.hack.local files.

NO CHANGES TO (hard boundary):
  - S1's parseHackFile/ParsedHackConfig/HackConfigValue; S2's HACK_KEY_TO_ENV/mergeTier/globalHackPath/
    seedProcessEnv/MergedHackConfig/HackConfigTier.
  - the hack config subcommand (P2.M2.T2); .gitignore handling (P2.M2.T3); constants.ts env-var
    reconciliation (P2.M2.T1.S1); main().catch() (default arm renders throws).
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
npm run fix            # lint:fix + prettier --write (run first)
npm run typecheck      # tsc --noEmit -p tsconfig.build.json
npm run lint           # eslint . --ext .ts
npm run format:check   # prettier --check
# Targeted:
npx eslint src/config/hack-config.ts
npx prettier --check src/config/hack-config.ts
# Expected: clean. Likely nit: prettier line-length on the schema/error messages — `npm run fix` auto-resolves.
```

### Level 2: Unit Tests (Component Validation)
```bash
# The secrets/validation suite (T2.S1's deliverable) + S1's parse suite + S2's discovery suite:
npx vitest run tests/unit/config/hack-config.test.ts
#   Expected: GREEN. If a "secret in .hack" test does NOT throw, the tier check is inverted (should be
#   `tier !== 'project-local'` → throw). If an empty secret throws, the trim() guard is missing. If a
#   type-mismatch test passes, validateFieldValue isn't reached (check isKnownSection / unknown-key early-return).
# Sibling config sanity:
npx vitest run tests/unit/config/
#   Expected: GREEN (T2.S1 only adds a validation layer; no other config behavior changes).
```

### Level 3: Integration / Regression (System Validation)
```bash
npm run validate      # = lint && format:check && typecheck && test:run  → MUST exit 0
npm run build         # tsc -p tsconfig.build.json → dist/ emits (PRP_API_KEY import resolves)
# Confirm the wiring:
grep -n "validateHackTier(parsed" src/config/hack-config.ts     # 1 call (inside the tier loop)
grep -n "seedAuthOverrideKey(merged)" src/config/hack-config.ts # 1 call (after seedProcessEnv)
grep -n "logEffectiveConfigTrace" src/config/hack-config.ts     # 1 call (after seedAuthOverrideKey)
# Expected: 3 distinct call sites inside loadHackConfig + their definitions.
```

### Level 4: Creative & Domain-Specific Validation
```bash
# No MCP/DB/HTTP. Domain checks (record observations in the commit message):
#   1. Secrets refusal — build, then run a config with a secret in the project .hack and confirm abort:
npm run build && node --input-type=module -e "
import('node:fs').then(async ({ mkdtempSync, writeFileSync }) => {
  const { loadHackConfig } = await import('./dist/config/hack-config.js');
  const tmp = mkdtempSync('/tmp/hack-secrets-');
  writeFileSync(tmp+'/.hack', '[auth]\nzai_api_key = \"sk-leaked\"\n');
  try { loadHackConfig(tmp); console.log('FAIL: did not throw'); }
  catch (e) { console.log('OK refused:', e.message); }
});"   # Expected: 'OK refused: ... zai_api_key ... §9.7.6 ...'
#   2. Same secret in .hack.local → accepted + seeds PRP_API_KEY (mirror with .hack.local + assert process.env.PRP_API_KEY).
#   3. Out-of-range abort — [tasks_lock] poll_ms = -5 in .hack → throws naming file+key+range.
#   4. Debug trace masking — HACKY_LOG_LEVEL=debug + .hack.local override_key → stderr line shows
#      auth.override_key = "<redacted>" (source: project-local); the raw key NEVER appears on stderr.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` clean (PRP_API_KEY import resolves; HackConfigValue narrows in branches).
- [ ] `npm run lint` clean; `npm run format:check` clean.
- [ ] `npx vitest run tests/unit/config/hack-config.test.ts` GREEN (no coverage regression).
- [ ] `npm run build` compiles.
- [ ] `npm run validate` (full gate) exits 0.

### Feature Validation
- [ ] Non-empty secret in project/global `.hack` → throws naming file+key+remediation.
- [ ] Empty/whitespace secret in any tier → not refused, not forwarded (§9.2.7).
- [ ] `.hack.local` secret accepted; `override_key` (non-empty) seeds `PRP_API_KEY` only when undefined.
- [ ] Unknown section/key → one stderr `console.warn`; load proceeds.
- [ ] Type/range/enum mismatch → throws naming file+section+key+value+expected+accepted.
- [ ] Debug trace fires at `HACKY_LOG_LEVEL=debug`; masks every secret value; shows source tier.

### Code Quality Validation
- [ ] T2.S1 ADDS to S1+S2's hack-config.ts; does NOT modify parseHackFile/HACK_KEY_TO_ENV/mergeTier/etc.
- [ ] `HACK_CONFIG_SCHEMA` is exhaustive (§9.7.5) + includes `[auth]` (so secrets don't false-warn).
- [ ] Secrets checked FIRST (before unknown-section/unknown-key); never type-checked or echoed.
- [ ] Hard errors are plain `throw new Error`; no new error class / main().catch() arm added.
- [ ] `_validationWarned`/`_resetValidationWarnings` mirror the `environment.ts` dedup pattern.
- [ ] No `hack config` subcommand / .gitignore handling / constants.ts reconciliation (deferred).

### Documentation & Deployment
- [ ] Mode-A JSDoc on every new function: hard-error vs warn (§9.7.7); stderr requirement (§9.6/§9.7.7);
      empty-string policy (§9.2.7); debug-trace masking (§9.7.10); auth-over-file seeding (§9.2.1).
- [ ] No `docs/*.md` / README / `.env.example` changes (Mode A = JSDoc; doc sweep is P4.M1 / P2.M2.T3).
- [ ] Commit message notes: per-key validation order; [auth] as a known section; empty-secret skip;
      the separate seedAuthOverrideKey (S2 excluded [auth]); the documented retry_delay_cap_ms gap;
      the `main().catch()` default-arm rendering; the PRP_API_KEY import (no cycle).

---

## Anti-Patterns to Avoid

- ❌ Don't type-check or echo a secret value. Once `isSecretKey(key)` is true, branch on
      empty/tier/local and `continue` — never call `validateFieldValue` on it (it would
      JSON.stringify the secret into a thrown message).
- ❌ Don't check the secret's VALUE before its tier. An empty secret is "not configured" in ALL
      tiers (skip first); a non-empty secret is refused only in committable (global/project) tiers.
      `if (empty) continue; if (tier !== 'project-local') throw; continue;`
- ❌ Don't omit `[auth]` from `HACK_CONFIG_SCHEMA`. It's not in the §9.7.5 tunables table, but it IS
      a legitimate section for `.hack.local` secrets (§9.7.6 + the example). Without it, a real
      secret trips a false "unknown section" warning. `[auth]`'s keys are secret → caught by the
      secrets policy before the type check, so its field specs are never exercised.
- ❌ Don't add a new error class or `main().catch()` arm. The item says "the main().catch() renders
      the thrown error" — a plain `throw new Error(msg)` reaches the default arm (index.ts:401). Do
      NOT `console.error` the hard error yourself; throwing lets the single catch arm own exit codes.
- ❌ Don't add `[auth] override_key` to S2's `HACK_KEY_TO_ENV`. S2 deliberately excluded it (secret-
      bearing). The override_key → `PRP_API_KEY` mapping is a SEPARATE `seedAuthOverrideKey`.
- ❌ Don't run the debug trace BEFORE seeding. `logEffectiveConfigTrace` reads `HACKY_LOG_LEVEL`,
      which S2's `seedProcessEnv` populates from `[cli] log_level`. Call it AFTER `seedProcessEnv`.
- ❌ Don't mask only `[auth]` keys in the trace — mask ANY `isSecretKey(key)` (suffix rule), in any
      section, so a future secret-suffixed key can't leak.
- ❌ Don't import env-var-name constants en masse (the 6 not-yet-defined ones). Only `PRP_API_KEY`
      (constants.ts:193) is needed; importing it alone is safe and cycle-free.
- ❌ Don't enforce the relational `retry_delay_cap_ms >= retry_delay_ms`. It's cross-key and breaks
      the clean per-key model; validate cap as int >= 0 and document the gap (P2.M2 may harden).
- ❌ Don't forget the test-hook reset: `_resetValidationWarnings()` in afterEach (vitest keeps module
      state across tests in a file), and delete `PRP_API_KEY`/`HACKY_LOG_LEVEL` before each test or
      the .env-load gotcha yields false passes.

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: This is a single-module addition (to S1+S2's file) with the verbatim implementation of
every new function given and exactly 3 wiring lines. Every load-bearing fact is verified: the §9.7.6
secrets rules + suffix list (quoted), the §9.7.7 validation rules + per-key ORDER (research §8), the
exhaustive §9.7.5 schema transcribed into `HACK_CONFIG_SCHEMA`, the `environment.ts` dedup pattern to
mirror (quoted lines 42-66), the `main().catch()` default-arm rendering (index.ts:401), the
`resolveApiKeyForProvider` `PRP_API_KEY` consumption (harness.ts:73), the `PRP_API_KEY` import safety
(no cycle), and the `.env`-load + dedup test gotchas. The critical subtleties are pinned: secrets are
checked FIRST (before unknown-section) and never echoed; `[auth]` is a known section; empty secrets
are skipped; the auth seeding is a separate step (S2 excluded `[auth]`); the trace runs post-seeding
and masks all secret-suffix keys. The 100%-coverage branch map is enumerated (research §9 + Task 3).
Residual risks are mechanical and gate-caught: (a) a prettier line-length nit (auto-fixed via
`npm run fix`); (b) an enum/range test using a wrong expected message (the error-message templates are
given verbatim); (c) the `_sources` local name in S2's actual file differing (the implementer adapts
the argument name — flagged). No runtime/network/LLM unknowns; T2.S1 cleanly layers on S2's output
and defers the subcommand/.gitignore/schema-reconciliation to the P2.M2 milestones.