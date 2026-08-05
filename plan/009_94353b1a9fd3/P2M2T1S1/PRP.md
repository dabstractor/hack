# PRP — P2.M2.T1.S1: Full schema map (all tunables) with env-var + CLI-flag seeding

---

## Goal

**Feature Goal**: Replace the **provisional** `HACK_KEY_TO_ENV` (28-entry literal,
marked `@provisional` by S2) with an **authoritative `SCHEMA_MAP`** — an exhaustive
array of `{ section, key, envVar?, cliFlag?, type, defaultValue?, acceptedValues? }`
covering **every row of the PRD §9.7.5 schema-reference table** (38 tunables across
13 sections). `SCHEMA_MAP` becomes the single source of truth that (a) the env-seeding
in `loadHackConfig` derives from, (b) the `hack config show` subcommand renders
(P2.M2.T2), and (c) documents the dual-config-surface resolution rule (one TOML key
per concept → seeds env var → CLI reads through).

> **Scope boundary (read first).** S1 is the **dual-surface DATA layer** in
> `src/config/hack-config.ts`. It runs **IN PARALLEL with P2.M1.T2.S1** (Secrets +
> type/range validation), which defines its OWN `HACK_CONFIG_SCHEMA` for validation.
> S1's `SCHEMA_MAP` is the **seeding/show/dual-surface** map; T2.S1's
> `HACK_CONFIG_SCHEMA` is the **validation** spec. They **intentionally coexist** —
> S1 must NOT modify/delete T2.S1's symbols or its 3-line `loadHackConfig` insertion.
> See "Why / Out of scope" + research §s1-conflict-reconciliation.md.

**Deliverable** (all in `src/config/hack-config.ts`):
1. **`HackConfigSchemaEntry`** — exported interface (the row shape).
2. **`SCHEMA_MAP`** — exported `readonly HackConfigSchemaEntry[]`, 38 entries,
   verbatim from §9.7.5, with Mode-A JSDoc cross-referencing §9.7.5 as authoritative
   + the dual-surface resolution rule + the coexistence-with-HACK_CONFIG_SCHEMA note.
3. **`SCHEMA_BY_KEY`** — exported `Readonly<Record<string, HackConfigSchemaEntry>>`
   lookup index (keyed `"section.key"`), derived from `SCHEMA_MAP`.
4. **`HACK_KEY_TO_ENV`** — REPLACE the provisional 28-entry literal with a
   **derivation from `SCHEMA_MAP`** (the contract's "provisional mapping becomes
   authoritative"). Symbol/type/consumer/semantics stay identical → `seedProcessEnv`
   and `loadHackConfig` stay byte-identical (zero conflict with T2.S1).
5. **`tests/unit/config/hack-config.test.ts`** — ADD a `describe('hack-config: SCHEMA_MAP')`
   block asserting: 38 entries; every §9.7.5 row present; dual-surface concepts appear
   exactly once; negating flags map to positive-state keys; model-id defaults are bare;
   `HACK_KEY_TO_ENV` derived correctly (env-seeding regression guard).

**Success Definition**:
- `SCHEMA_MAP.length === 38`; every §9.7.5 `[section].key` row is present with the
  exact env-var / CLI-flag / type / default / acceptedValues from the PRD table.
- `HACK_KEY_TO_ENV` is derived from `SCHEMA_MAP` and still contains exactly the 28
  env-linked keys (CLI-only keys absent) — `loadHackConfig`'s env-seeding behavior is
  unchanged (regression-green).
- T2.S1's symbols (`HACK_CONFIG_SCHEMA`, `HackConfigFieldSpec`, `validateHackTier`,
  `seedAuthOverrideKey`, `logEffectiveConfigTrace`) and its `loadHackConfig` insertion
  are untouched; `seedProcessEnv`/`loadHackConfig`/`mergeTier`/`globalHackPath` are
  byte-identical to S2.
- `npm run typecheck && npm run lint && npm run format:check` clean; `npx vitest run
  tests/unit/config/hack-config.test.ts` GREEN; `npm run build` compiles; 100%
  coverage on `src/config/hack-config.ts` preserved.

---

## User Persona (if applicable)

**Target User**: Pipeline maintainer / `hack config show` consumer (P2.M2.T2).
**Use Case**: Inspecting or overriding which TOML key maps to which env var / CLI
flag / default — one authoritative map instead of scattered inline literals.
**User Journey**: Maintainer reads `SCHEMA_MAP`; `hack config show` (P2.M2.T2)
renders it; env-seeding derives from it; a tunable's env-var + CLI-flag + default are
consistent because they come from one row.
**Pain Points Addressed**: Today `HACK_KEY_TO_ENV` is provisional (28 of 38 rows;
the 10 CLI-only keys aren't represented anywhere centralized), and env/CLI/default
live as scattered inline literals strings in `src/cli/index.ts`.

---

## Why

- **PRD §9.7.5 compliance**: the schema reference is "exhaustive; `hack config show`
  prints the same mapping." `SCHEMA_MAP` IS that mapping, machine-readable.
- **Unblocks P2.M2.T2** (`hack config` subcommand show/validate): it consumes
  `SCHEMA_MAP` to render every key + its env-var/CLI-flag/default.
- **Authoritative env-seeding**: the contract's "provisional mapping becomes
  authoritative" — deriving `HACK_KEY_TO_ENV` from the exhaustive `SCHEMA_MAP`
  guarantees every env-linked §9.7.5 key seeds `process.env` correctly.
- **Single source of truth**: kills the scattered inline `HACKY_*` /
  `RESEARCH_QUEUE_CONCURRENCY` / `MONITOR_TASK_INTERVAL` literals for the §9.7.5 keys.

### Out of scope (hard fences)
- **T2.S1's validation layer** (`HACK_CONFIG_SCHEMA`, `HackConfigFieldSpec`,
  `validateHackTier`, `seedAuthOverrideKey`, `logEffectiveConfigTrace`, its 3-line
  `loadHackConfig` insertion) — T2.S1 contract; S1 coexists, does not merge.
- **`loadHackConfig` / `seedProcessEnv` / `mergeTier` / `globalHackPath` bodies** —
  byte-identical to S2 (T2.S1 treats them immutable; only `HACK_KEY_TO_ENV`'s
  declaration changes).
- **`[auth]` section** in `SCHEMA_MAP` — secret-bearing (§9.7.6); owned by T2.S1's
  secrets policy; never env-seeded by the normal path.
- **Inventing non-§9.7.5 rows** (`--task-retry`, `--flush-retries`, `--cache-ttl`,
  `--retry-backoff`, `--prp-compression`, `--dry-run`, `--verbose`, `--progress-mode`
  …) — these are CLI flags with NO §9.7.5 table row. `SCHEMA_MAP` = the 38 §9.7.5
  rows ONLY.
- **Commander wiring** (`src/cli/index.ts`) to read `MergedHackConfig` for non-env-
  linked flags — CLI-layer work (P2.M2.T2 / a CLI task). S1 provides the DATA +
  documents the contract.
- **Adding `API_TIMEOUT_MS`/`BUG_RESULTS_FILE`/`BUGFIX_SCOPE` as `export const` to
  `constants.ts`** — S1 is data-only in `hack-config.ts`; these are envVar LITERALS
  in `SCHEMA_MAP` (the value seeds env at runtime).
- **The `hack config` subcommand** (P2.M2.T2), .gitignore handling (P2.M2.T3).

---

## What

### User-visible behavior
None. S1 is config-data + its derivation + tests. The user-visible `hack config show`
lands in P2.M2.T2 (which renders `SCHEMA_MAP`).

### Technical requirements (exact contract — item 3a–d)

**(a) `SCHEMA_MAP`** — `readonly HackConfigSchemaEntry[]`, 38 entries covering EVERY
§9.7.5 row. Entry shape:
```ts
export interface HackConfigSchemaEntry {
  readonly section: string;
  readonly key: string;
  readonly envVar?: string;       // §9.2.2 name; undefined for CLI-only keys
  readonly cliFlag?: string;      // Commander option; undefined for env-only keys
  readonly type: 'string' | 'int' | 'boolean';
  readonly defaultValue?: string | number | boolean;  // undefined for [cli] scope/max_tasks/max_duration_ms
  readonly acceptedValues?: readonly string[];         // enum (e.g. ['pi','claude-code'])
}
```
Full ready-to-paste source (all 38 rows, verbatim §9.7.5) is in research
§s1-schema-map-source.md.

**(b) Dual-surface rule (one TOML key per concept)** — each concept reachable as both
env-var AND CLI flag appears EXACTLY ONCE; the TOML key seeds the ENV VAR and the CLI
option reads through it (Commander `.default(process.env.X ?? …)`). The four such
concepts: `concurrency.research_queue`/`--research-concurrency`,
`cli.log_level`/`--log-level`, `monitor.task_interval`/`--monitor-task-interval`,
`pipeline.parallel_research`/`-r`. No duplicate `[cli]`/`[pipeline]` pair.

**(c) Negating flags name the POSITIVE state** — `cli.cache_enabled` (default `true`,
flag `--no-cache`) and `monitor.enabled` (default `true`, flag `--no-resource-monitor`).

**(d) Model-id values BARE** — `models.high/balanced/fast` defaults are `glm-5.2`/
`glm-5.2`/`glm-5-turbo` (bare). `qualifyModel()` (environment.ts:159, idempotent)
qualifies at read time; already-qualified values pass through.

**(e) `HACK_KEY_TO_ENV` becomes AUTHORITATIVE** — replace the S2 provisional literal
with a derivation from `SCHEMA_MAP`:
```ts
const HACK_KEY_TO_ENV: Readonly<Record<string, string>> = Object.fromEntries(
  SCHEMA_MAP.filter((e) => e.envVar !== undefined).map((e) => [
    `${e.section}.${e.key}`, e.envVar as string,
  ])
);
```
Symbol, type (`Readonly<Record<string,string>>`), consumer (`seedProcessEnv`), and
semantics (28 env-linked keys) are identical to S2 — only the source changes
(literal → derivation).

**DOCS (Mode A, PRD §6.1 — rides with the work)**: JSDoc on `SCHEMA_MAP`
cross-referencing §9.7.5 as the authoritative reference; document the dual-surface
resolution rule (one TOML key per concept, seeds env var, CLI reads through) and the
coexistence-with-`HACK_CONFIG_SCHEMA` note (SCHEMA_MAP = seeding/show; HACK_CONFIG_SCHEMA
= validation). JSDoc on `HackConfigSchemaEntry`, `SCHEMA_BY_KEY`, and the now-authoritative
`HACK_KEY_TO_ENV`.

### Success Criteria
- [ ] `SCHEMA_MAP.length === 38`; every §9.7.5 `[section].key` present with exact env/CLI/type/default/acceptedValues.
- [ ] `HACK_KEY_TO_ENV` derived from `SCHEMA_MAP`; still 28 env-linked keys; CLI-only keys absent.
- [ ] `SCHEMA_BY_KEY` lookup returns the entry for every `"section.key"`.
- [ ] `seedProcessEnv`/`loadHackConfig`/`mergeTier`/`globalHackPath` byte-identical to S2.
- [ ] T2.S1 symbols untouched (coexist).
- [ ] `typecheck && lint && format:check` clean; `vitest run tests/unit/config/hack-config.test.ts` GREEN; 100% coverage preserved; `npm run build` compiles.

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_
**Yes.** The full 38-row `SCHEMA_MAP` source (verbatim §9.7.5, ready-to-paste) is in
research §s1-schema-map-source.md. The conflict-reconciliation design (SCHEMA_MAP vs
T2.S1's HACK_CONFIG_SCHEMA; the ONE symbol both touch is `HACK_KEY_TO_ENV`, which S1
owns and T2.S1 leaves alone) is in research §s1-conflict-reconciliation.md. The
"missing" env-var names (`API_TIMEOUT_MS`/`BUG_RESULTS_FILE`/`BUGFIX_SCOPE`) are
confirmed absent from `constants.ts`. The 100%-coverage trap is branch-free by
construction (static array + two derivations). Build baseline is verified green.

### Documentation & References
```yaml
# MUST READ — the authoritative schema reference (THE source for SCHEMA_MAP)
- docfile: PRD.md
  section: "9.7.5 Schema Reference" (h4.23) + its "Mapping semantics" block
  why: The exhaustive 38-row table SCHEMA_MAP encodes verbatim, plus the dual-surface
       rules (one TOML key per concept; negating flags name positive state; bare model
       ids qualified at read time). "Every tunable maps to exactly one [section].key ...
       hack config show prints the same mapping."
  critical: [auth] is NOT a §9.7.5 tunable row (secret-bearing, §9.7.6) → OUT of SCHEMA_MAP.
       Negating flags: cache_enabled/monitor.enabled name the POSITIVE state. Model ids BARE.
- docfile: PRD.md
  section: "9.7.4 Format" (h4.22) + "9.7.6 Secrets Policy" (h4.24)
  why: §9.7.4 — lowercase snake_case keys within sections; §9.7.6 — why [auth] is secret-only.
- docfile: PRD.md
  section: "9.2.1 Configuration Source Priority" (h4.0) + "9.2.2 Required Environment Variables" (h4.1)
  why: env-over-file rule (real env wins over file) that seedProcessEnv enforces; §9.2.2 env-var names.

# MUST READ — the architecture scouting report (proven facts)
- docfile: plan/009_94353b1a9fd3/architecture/config-system-and-constants.md
  section: §6 (CLI flag catalog), §7 (dual-config-surface map)
  why: Documents every env-var name, default, getter, CLI flag, and dual-surface linkage.
       Confirms: RESEARCH_DEPTH has both a constants.ts getter AND CLI .default();
       PARALLEL_RESEARCH is desc-only (NOT wired via .default()); all HACKY_* are inline
       literals in src/cli/index.ts; BUG_RESULTS_FILE/BUGFIX_SCOPE/API_TIMEOUT_MS NOT in constants.ts.
  critical: The §7 map is the ground truth for which concepts are dual-surface. Don't invent rows
       for CLI flags with NO §9.7.5 row (--task-retry, --flush-retries, --cache-ttl, etc.).

# MUST READ — the parallel task's PRP (T2.S1 — CONTRACT; do not conflict)
- docfile: plan/009_94353b1a9fd3/P2M1T2S1/PRP.md
  section: "Goal / Deliverable / Out of scope"
  why: T2.S1 defines HACK_CONFIG_SCHEMA (Record<section,Record<key,HackConfigFieldSpec>> with
       type/min/max/enum) for VALIDATION, validateHackTier, seedAuthOverrideKey,
       logEffectiveConfigTrace, and a 3-line loadHackConfig insertion. It treats S2's
       HACK_KEY_TO_ENV/seedProcessEnv/loadHackConfig as IMMUTABLE.
  critical: SCHEMA_MAP and HACK_CONFIG_SCHEMA COEXIST (seeding/show vs validation). S1's only
       modification to an existing symbol is HACK_KEY_TO_ENV's declaration (literal→derivation) —
       the ONE symbol T2.S1 explicitly leaves alone. Do NOT touch T2.S1's symbols or its insertion.

# MUST READ — this subtask's research (ready-to-paste source + reconciliation)
- docfile: plan/009_94353b1a9fd3/P2M2T1S1/research/s1-schema-map-source.md
  section: HackConfigSchemaEntry type + SCHEMA_MAP (38 rows) + SCHEMA_BY_KEY + derived HACK_KEY_TO_ENV
  why: The complete, type-correct, drop-in source. Verbatim §9.7.5. Row-count reconciliation (38; 28 env-linked; 10 CLI-only).
- docfile: plan/009_94353b1a9fd3/P2M2T1S1/research/s1-conflict-reconciliation.md
  section: §1 (two structures), §2 (HACK_KEY_TO_ENV ownership), §3 (loadHackConfig byte-identical), §4 (the safe edit), §5 (CLI-only keys), §6 (fences)
  why: The binding design that makes S1 + T2.S1 merge cleanly.
- docfile: plan/009_94353b1a9fd3/P2M2T1S1/research/s1-codebase-analysis.md
  section: §1 (current S2 state), §2 (38-row table), §3 (missing env vars), §4 (env-seeding), §5 ([auth] out), §6 (test home), §7 (coverage)
  why: The codebase facts + the §9.7.5 row inventory.

# THE FILE TO EDIT
- file: src/config/hack-config.ts
  why: EDIT — add HackConfigSchemaEntry + SCHEMA_MAP + SCHEMA_BY_KEY (pure additions), and
       REPLACE the provisional HACK_KEY_TO_ENV literal with the derivation. loadHackConfig/
       seedProcessEnv/mergeTier/globalHackPath stay byte-identical.
  pattern: mirror the existing `HACK_KEY_TO_ENV` declaration site (just above globalHackPath);
           `readonly` + `as const` for the array (matches MODEL_NAMES style in constants.ts);
           Mode-A JSDoc on every export (matches parseHackFile/loadHackConfig JSDoc density).
  gotcha: HACK_KEY_TO_ENV must STAY `const` (not `export`) — it is module-private, consumed by
          seedProcessEnv. Exporting it would widen T2.S1's assumed surface; keep it private and
          test env-seeding via loadHackConfig (the public behavior).

- file: tests/unit/config/hack-config.test.ts
  why: EDIT — import SCHEMA_MAP + SCHEMA_BY_KEY (+ HackConfigSchemaEntry type); ADD
       describe('hack-config: SCHEMA_MAP'). GATED (*.test.ts → runs under npm run validate).
  pattern: existing describe/it + SETUP/EXECUTE/VERIFY comments; for the env-seeding
           regression, mirror the existing real-temp-file + vi.stubEnv style.

# CONTRACT INPUTS (read-only)
- symbol: HACK_KEY_TO_ENV (src/config/hack-config.ts, S2 provisional) — the symbol S1 re-authoritizes
- symbol: seedProcessEnv / loadHackConfig (src/config/hack-config.ts, S2) — consumed UNCHANGED
- symbol: qualifyModel (src/config/environment.ts:159) — idempotent model qualifier (read-time, not schema)

# DOWNSTREAM CONSUMERS (DO NOT implement; stay compatible)
- P2.M2.T2 (hack config show/validate): renders SCHEMA_MAP + SCHEMA_BY_KEY.
- src/cli/index.ts: env-linked flags already read process.env via .default(); non-env-linked
       CLI flags must read MergedHackConfig (CLI-layer work, NOT S1).
```

### Current Codebase tree (relevant slice)
```bash
src/config/
  hack-config.ts     # EDIT — add SCHEMA_MAP/SCHEMA_BY_KEY/HackConfigSchemaEntry; re-authorize HACK_KEY_TO_ENV
  constants.ts       # UNTOUCHED (env-var NAME consts live here; S1 references by literal, not import)
  environment.ts     # UNTOUCHED (qualifyModel/getModel — read-time qualifier)
src/cli/
  index.ts           # UNTOUCHED (Commander wiring is CLI-layer work, NOT S1)
tests/unit/config/
  hack-config.test.ts # EDIT — add describe('hack-config: SCHEMA_MAP')
```

### Desired Codebase tree with files to be added and responsibility of file
```bash
src/config/hack-config.ts            # MODIFIED — authoritative SCHEMA_MAP (dual-surface) + derived HACK_KEY_TO_ENV
tests/unit/config/hack-config.test.ts # MODIFIED — SCHEMA_MAP assertions + env-seeding regression
# (no NEW files)
```

### Known Gotchas of our codebase & Library Quirks
```ts
// CRITICAL: SCHEMA_MAP and T2.S1's HACK_CONFIG_SCHEMA COEXIST. SCHEMA_MAP = seeding/show/dual-surface;
// HACK_CONFIG_SCHEMA = type/min/max/enum VALIDATION. Both carry type/enum info by design — do NOT
// "consolidate" or delete either. S1 must NOT touch T2.S1's symbols or its 3-line loadHackConfig insertion.

// CRITICAL: S1's ONLY modification of an existing symbol is HACK_KEY_TO_ENV's declaration (literal → derivation
// from SCHEMA_MAP). seedProcessEnv/loadHackConfig/mergeTier/globalHackPath stay BYTE-IDENTICAL to S2. T2.S1
// treats them immutable; only HACK_KEY_TO_ENV is S1's to re-author (T2.S1 leaves it alone). Blast radius: ONE declaration.

// CRITICAL: HACK_KEY_TO_ENV must stay `const` (module-private), NOT `export`. seedProcessEnv is its sole consumer.
// Keep the symbol, type (Readonly<Record<string,string>>), consumer, and semantics identical to S2 (28 env-linked keys).
// Test env-seeding via the PUBLIC loadHackConfig on a temp .hack — do not export HACK_KEY_TO_ENV.

// CRITICAL: [auth] is NOT in SCHEMA_MAP. It is secret-bearing (§9.7.6), not a §9.7.5 tunable row, and is owned
// by T2.S1's secrets policy (HACK_CONFIG_SCHEMA includes [auth] so it's a known section; seedAuthOverrideKey
// maps override_key → PRP_API_KEY). Adding [auth] rows to SCHEMA_MAP would seed secrets to process.env — WRONG.

// CRITICAL: do NOT invent §9.7.5 rows for CLI flags that have NO table row (--task-retry, --flush-retries,
// --cache-ttl, --retry-backoff, --prp-compression, --progress-mode, --dry-run, --verbose). SCHEMA_MAP = the 38
// §9.7.5 rows ONLY. (--parallelism, --monitor-interval, --no-resource-monitor, --no-cache, --mode, --scope,
// --machine-readable, --continue-on-error, --max-tasks, --max-duration ARE in the table.)

// GOTCHA: model-id defaults are BARE (glm-5.2, glm-5-turbo), NOT provider-qualified. qualifyModel() (environment.ts:159)
// is idempotent and qualifies at READ time; already-qualified values (zai/glm-5.2, anthropic/claude-sonnet-4) pass
// through. SCHEMA_MAP stores bare defaults; qualification is a runtime concern, not a schema concern.

// GOTCHA: API_TIMEOUT_MS / BUG_RESULTS_FILE / BUGFIX_SCOPE are NOT export const in constants.ts (confirmed). They are
// envVar LITERALS in SCHEMA_MAP — the value seeds process.env at runtime via seedProcessEnv. Do NOT add them to
// constants.ts (S1 is data-only in hack-config.ts).

// GOTCHA: vitest enforces 100% coverage. SCHEMA_MAP is a static array + two Object.fromEntries derivations — ZERO
// runtime branches. Coverage is achieved by reading SCHEMA_MAP (length/shapes) + the filter() derivation (exercised
// by the env-seeding regression: CLI-only keys NOT seeded, env-linked keys seeded) + SCHEMA_BY_KEY lookup. No conditionals.

// GOTCHA: dual-surface concepts appear EXACTLY ONCE (one TOML key per concept): concurrency.research_queue,
// cli.log_level, monitor.task_interval, pipeline.parallel_research. No duplicate [cli]/[pipeline] pair. The test
// asserts each appears once.
```

---

## Implementation Blueprint

### Data models and structure

See research §s1-schema-map-source.md for the **full, type-correct, drop-in source**
(`HackConfigSchemaEntry` + 38-row `SCHEMA_MAP` + `SCHEMA_BY_KEY` + derived
`HACK_KEY_TO_ENV`). Summary:

```ts
export interface HackConfigSchemaEntry {
  readonly section: string;
  readonly key: string;
  readonly envVar?: string;
  readonly cliFlag?: string;
  readonly type: 'string' | 'int' | 'boolean';
  readonly defaultValue?: string | number | boolean;
  readonly acceptedValues?: readonly string[];
}

export const SCHEMA_MAP: readonly HackConfigSchemaEntry[] = [ /* 38 rows, §9.7.5 verbatim */ ] as const;

export const SCHEMA_BY_KEY: Readonly<Record<string, HackConfigSchemaEntry>> =
  Object.fromEntries(SCHEMA_MAP.map((e) => [`${e.section}.${e.key}`, e]));

const HACK_KEY_TO_ENV: Readonly<Record<string, string>> = Object.fromEntries(
  SCHEMA_MAP.filter((e) => e.envVar !== undefined).map((e) => [`${e.section}.${e.key}`, e.envVar as string])
);
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/config/hack-config.ts — ADD the schema + re-authorize HACK_KEY_TO_ENV
  - FIND: the `MergedHackConfig` interface / `HackConfigTier` block (S2 output). INSERT the new
    schema block (HackConfigSchemaEntry + SCHEMA_MAP + SCHEMA_BY_KEY) AFTER MergedHackConfig and
    BEFORE the provisional HACK_KEY_TO_ENV declaration. (Paste from research §s1-schema-map-source.md.)
  - REPLACE the provisional `HACK_KEY_TO_ENV` literal (the 28-entry `const HACK_KEY_TO_ENV:
    Readonly<Record<string,string>> = { ... }`) with the derivation:
      const HACK_KEY_TO_ENV: Readonly<Record<string, string>> = Object.fromEntries(
        SCHEMA_MAP.filter((e) => e.envVar !== undefined).map((e) => [`${e.section}.${e.key}`, e.envVar as string])
      );
    Keep it `const` (module-private — NOT exported; seedProcessEnv is its sole consumer). Update its
    JSDoc from `@provisional` → authoritative (derived from SCHEMA_MAP; supersedes S2's literal).
  - VERIFY the 38 rows match §9.7.5 verbatim (env-var / CLI-flag / type / default / acceptedValues).
    Cross-check the 4 dual-surface concepts appear once; the 2 negating flags name positive state;
    model defaults are bare; the 3 "unset" CLI keys (scope/max_tasks/max_duration_ms) have NO defaultValue.
  - ADD Mode-A JSDoc on SCHEMA_MAP (cross-ref §9.7.5; dual-surface rule; coexistence-with-HACK_CONFIG_SCHEMA
    note; [auth] absent rationale), HackConfigSchemaEntry, SCHEMA_BY_KEY, and the re-authored HACK_KEY_TO_ENV.
  - FOLLOW pattern: `readonly` + `as const` on SCHEMA_MAP (mirror constants.ts MODEL_NAMES); JSDoc density
    matching parseHackFile/loadHackConfig.
  - DO NOT touch: T2.S1's HACK_CONFIG_SCHEMA/HackConfigFieldSpec/validateHackTier/seedAuthOverrideKey/
    logEffectiveConfigTrace; S2's seedProcessEnv/loadHackConfig/mergeTier/globalHackPath (byte-identical);
    src/cli/index.ts; constants.ts; environment.ts.
  - NAMING: SCHEMA_MAP, SCHEMA_BY_KEY, HackConfigSchemaEntry (exported); HACK_KEY_TO_ENV (private).

Task 2: MODIFY tests/unit/config/hack-config.test.ts — ADD the SCHEMA_MAP describe block
  - EDIT the import block: ADD `SCHEMA_MAP, SCHEMA_BY_KEY` (and `type HackConfigSchemaEntry` if used in
    type-level asserts) to the import from `'../../../src/config/hack-config.js'`.
  - ADD `describe('hack-config: SCHEMA_MAP', () => { ... })` (sibling to the existing
    describe('config/hack-config: parseHackFile')). Pure-data assertions (no temp files needed):
      * it('SCHEMA_MAP has all 38 §9.7.5 rows'): expect(SCHEMA_MAP.length).toBe(38).
      * it('every §9.7.5 [section].key is present'): assert a representative sample of the 38
        "section.key" strings exist in SCHEMA_BY_KEY (models.high, pipeline.parallel_research,
        concurrency.parallelism, api.timeout_ms, cli.max_duration_ms, tasks_lock.poll_ms, …).
      * it('dual-surface concepts appear exactly once (one TOML key per concept)'): for the 4
        concepts (concurrency.research_queue, cli.log_level, monitor.task_interval,
        pipeline.parallel_research), assert the entry has BOTH envVar AND cliFlag, and that there
        is no DUPLICATE entry (count occurrences in SCHEMA_MAP === 1).
      * it('negating flags name the POSITIVE state'): cli.cache_enabled.defaultValue===true &&
        cliFlag==='--no-cache'; monitor.enabled.defaultValue===true && cliFlag==='--no-resource-monitor'.
      * it('model-id defaults are BARE (qualified at read time, not in schema)'):
        models.high/balanced/fast defaults are 'glm-5.2'/'glm-5.2'/'glm-5-turbo' (no 'zai/' prefix).
      * it('acceptedValues match the §9.7.5 enums'): harness.name→['pi','claude-code'];
        pipeline.commit_format→['task-prefix','plain']; cli.mode→['normal','delta','bug-hunt','validate'];
        cli.log_level→['trace','debug','info','warn','error','fatal'].
      * it('the 3 unset CLI keys have no defaultValue'): cli.scope/max_tasks/max_duration_ms have
        defaultValue===undefined.
      * it('SCHEMA_BY_KEY is a complete lookup index'): Object.keys(SCHEMA_BY_KEY).length===38 and
        every SCHEMA_MAP entry is reachable.
  - ADD an env-seeding REGRESSION test (real temp .hack, mirrors the existing test style) inside the
    existing loadHackConfig describe (or the new block): a .hack with an env-linked key
    (e.g. [pipeline] research_depth = 7) seeds process.env.RESEARCH_DEPTH='7' (only if undefined); a
    .hack with a CLI-only key ([cli] mode = "bug-hunt") does NOT seed any env var (mode has no envVar).
    Guard with vi.stubEnv + afterEach vi.unstubAllEnvs. This exercises the filter() derivation in
    HACK_KEY_TO_ENV (the 100%-coverage path).
  - COVERAGE: SCHEMA_MAP literal read (shape asserts) + filter() derivation (regression test) +
    SCHEMA_BY_KEY map build (lookup asserts). Zero branches → 100% trivially.
  - PLACEMENT: inside the existing top-level test structure; pure-data block needs no beforeAll/tmpdir.

Task 3: VERIFY — typecheck, lint, format, targeted tests, coverage, no-conflict
  - RUN `npx tsc --noEmit -p tsconfig.build.json` → exit 0 (proves SCHEMA_MAP + derivation + the
    byte-identical seedProcessEnv/loadHackConfig compile; SCHEMA_BY_KEY typing sound).
  - RUN `npm run lint && npm run format:check` → clean (run `npm run format` if it complains).
  - RUN `npx vitest run tests/unit/config/hack-config.test.ts` → GREEN.
  - RUN `npx vitest run --coverage` for hack-config.ts → 100% preserved.
  - VERIFY `git diff src/config/hack-config.ts` shows: ADDITIONS (HackConfigSchemaEntry, SCHEMA_MAP,
    SCHEMA_BY_KEY) + ONE modified declaration (HACK_KEY_TO_ENV literal→derivation); seedProcessEnv/
    loadHackConfig/mergeTier/globalHackPath byte-identical; NO edits to T2.S1 symbols.
  - VERIFY no edits to src/cli/index.ts, constants.ts, environment.ts.
```

### Implementation Patterns & Key Details

```ts
// PATTERN: dual-surface concept — ONE TOML key, seeds env var, CLI reads through.
{ section: 'concurrency', key: 'research_queue',
  envVar: 'RESEARCH_QUEUE_CONCURRENCY', cliFlag: '--research-concurrency',
  type: 'int', defaultValue: 3 },   // seedProcessEnv sets process.env.RESEARCH_QUEUE_CONCURRENCY='3';
                                   // Commander .default(process.env.RESEARCH_QUEUE_CONCURRENCY ?? '3') reads it.

// PATTERN: negating flag names the POSITIVE state.
{ section: 'cli', key: 'cache_enabled', cliFlag: '--no-cache', type: 'boolean', defaultValue: true },
// cache_enabled=true → cache ON (no --no-cache). cache_enabled=false → ≡ --no-cache.

// PATTERN: bare model id (qualified at read time by qualifyModel, NOT in the schema).
{ section: 'models', key: 'balanced', envVar: 'PRP_MODEL_BALANCED', type: 'string', defaultValue: 'glm-5.2' },

// PATTERN: CLI-only key (no envVar → absent from derived HACK_KEY_TO_ENV → NOT seeded; lives in MergedHackConfig).
{ section: 'cli', key: 'mode', cliFlag: '-m/--mode', type: 'string', defaultValue: 'normal',
  acceptedValues: ['normal', 'delta', 'bug-hunt', 'validate'] },

// CRITICAL: HACK_KEY_TO_ENV derivation — the authoritative env-seed table (replaces S2 literal).
const HACK_KEY_TO_ENV: Readonly<Record<string, string>> = Object.fromEntries(
  SCHEMA_MAP.filter((e) => e.envVar !== undefined).map((e) => [`${e.section}.${e.key}`, e.envVar as string])
);
// seedProcessEnv (UNCHANGED) reads this; CLI-only keys (no envVar) are absent → not seeded → correct.
```

### Integration Points

```yaml
SCHEMA (src/config/hack-config.ts):
  - export (NEW): HackConfigSchemaEntry (interface), SCHEMA_MAP (38-row array), SCHEMA_BY_KEY (lookup)
  - re-authored (S2 symbol): HACK_KEY_TO_ENV (literal → derived from SCHEMA_MAP; stays private `const`)
  - unchanged (S2): seedProcessEnv, loadHackConfig, mergeTier, globalHackPath, MergedHackConfig, HackConfigTier
  - unchanged (T2.S1, parallel): HACK_CONFIG_SCHEMA, HackConfigFieldSpec, validateHackTier,
    seedAuthOverrideKey, logEffectiveConfigTrace, 3-line loadHackConfig insertion

TESTS (tests/unit/config/hack-config.test.ts):
  - add: imports + describe('hack-config: SCHEMA_MAP') + env-seeding regression

DOWNSTREAM (DO NOT implement; stay compatible):
  - P2.M2.T2 (hack config show/validate): renders SCHEMA_MAP + SCHEMA_BY_KEY
  - src/cli/index.ts: env-linked flags read process.env via .default() (already wired); non-env-linked
    CLI flags read MergedHackConfig (CLI-layer work, NOT S1)

NO DATABASE / NO ROUTES / NO NEW ENV VARS / NO CLI — pure config-data + derivation + tests.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npx tsc --noEmit -p tsconfig.build.json   # exit 0 (SCHEMA_MAP + derivation + byte-identical seeders compile)
npm run lint -- --ext .ts                  # eslint
npm run format:check                        # prettier; run `npm run format` if it complains

# Expected: Zero errors. The tsc gate proves the 38-row array + Object.fromEntries derivations + the
# re-authored HACK_KEY_TO_ENV typecheck, and that seedProcessEnv/loadHackConfig are unaffected.
```

### Level 2: Unit Tests (Component Validation)

```bash
npx vitest run tests/unit/config/hack-config.test.ts        # GATED (runs under npm run validate)
npx vitest run tests/unit/config/hack-config.test.ts --coverage   # 100% on src/config/hack-config.ts

# Expected: ALL green. Specifically describe('hack-config: SCHEMA_MAP'):
#   - SCHEMA_MAP.length === 38; every §9.7.5 [section].key present.
#   - 4 dual-surface concepts appear exactly once (envVar AND cliFlag; count === 1).
#   - negating flags (cache_enabled/monitor.enabled) name positive state (default true).
#   - model-id defaults BARE.
#   - acceptedValues match §9.7.5 enums.
#   - 3 unset CLI keys have no defaultValue.
#   - SCHEMA_BY_KEY complete (38 keys).
#   - env-seeding regression: env-linked key seeds process.env; CLI-only key does NOT.
# 100% coverage preserved (SCHEMA_MAP + derivations are branch-free).
```

### Level 3: Integration Testing (System Validation)

```bash
npm run build            # compiles dist — confirms no transitive breakage from new exports

# Confirm no conflict with T2.S1's surface (the parallel task's symbols untouched):
git diff src/config/hack-config.ts | grep -E "^-" | grep -v "^---"   # EXPECT: only the HACK_KEY_TO_ENV literal lines removed
rg -n "HACK_CONFIG_SCHEMA|validateHackTier|seedAuthOverrideKey|logEffectiveConfigTrace" src/config/hack-config.ts
# EXPECT: those T2.S1 symbols (if already landed) are PRESENT and UNCHANGED by S1's diff.

# Confirm CLI/constants/environment untouched:
git diff --stat src/cli/index.ts src/config/constants.ts src/config/environment.ts   # EXPECT: empty

# Expected: build succeeds; S1's diff is additions + the single HACK_KEY_TO_ENV re-authoring; T2.S1 surface intact.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Confirm all 38 §9.7.5 rows are present (no row dropped):
node -e "import('./src/config/hack-config.ts').then(m => console.log(m.SCHEMA_MAP.length))" 2>/dev/null || \
  npx tsx -e "import { SCHEMA_MAP } from './src/config/hack-config.ts'; console.log(SCHEMA_MAP.length)"
# EXPECT: 38

# Confirm the 4 dual-surface concepts each appear once:
npx tsx -e "import { SCHEMA_MAP } from './src/config/hack-config.ts'; for (const k of ['concurrency.research_queue','cli.log_level','monitor.task_interval','pipeline.parallel_research']) { const n = SCHEMA_MAP.filter(e => \`\${e.section}.\${e.key}\`===k).length; console.log(k, n); }"
# EXPECT: each === 1

# Confirm [auth] is NOT in SCHEMA_MAP (secret-bearing → T2.S1 scope):
npx tsx -e "import { SCHEMA_MAP } from './src/config/hack-config.ts'; console.log(SCHEMA_MAP.filter(e => e.section==='auth').length)"
# EXPECT: 0

# Expected: 38 rows; 4 dual-surface concepts each once; no [auth].
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npx tsc --noEmit -p tsconfig.build.json` exit 0.
- [ ] `npm run lint` + `npm run format:check` clean.
- [ ] `npx vitest run tests/unit/config/hack-config.test.ts` green; 100% hack-config.ts coverage.
- [ ] `npm run build` succeeds.

### Feature Validation
- [ ] `SCHEMA_MAP` has 38 entries (every §9.7.5 row); `SCHEMA_BY_KEY` lookup complete.
- [ ] 4 dual-surface concepts appear exactly once; 2 negating flags name positive state; model defaults bare.
- [ ] `HACK_KEY_TO_ENV` derived from `SCHEMA_MAP` (28 env-linked keys; CLI-only keys absent).
- [ ] Env-seeding regression: env-linked key seeds `process.env`; CLI-only key does not.
- [ ] `seedProcessEnv`/`loadHackConfig`/`mergeTier`/`globalHackPath` byte-identical to S2.

### Code Quality Validation
- [ ] T2.S1 symbols (`HACK_CONFIG_SCHEMA`/`validateHackTier`/etc.) untouched (coexist).
- [ ] `src/cli/index.ts`, `constants.ts`, `environment.ts` untouched.
- [ ] Mode-A JSDoc on SCHEMA_MAP (§9.7.5 cross-ref + dual-surface rule + coexistence note) + the 3 new exports.
- [ ] `HACK_KEY_TO_ENV` stays private `const` (not exported); semantics identical to S2.

### Documentation & Deployment
- [ ] Mode-A JSDoc rides with the work (SCHEMA_MAP documents §9.7.5 as authoritative).
- [ ] No new env vars / CLI / routes (pure config-data + derivation + tests).

---

## Anti-Patterns to Avoid

- ❌ Don't merge/delete T2.S1's `HACK_CONFIG_SCHEMA` — it COEXISTS with SCHEMA_MAP (seeding/show vs validation).
- ❌ Don't modify `loadHackConfig`/`seedProcessEnv`/`mergeTier`/`globalHackPath` bodies — byte-identical to S2 (T2.S1
   treats them immutable; only `HACK_KEY_TO_ENV`'s declaration changes).
- ❌ Don't add `[auth]` rows to SCHEMA_MAP — secret-bearing (§9.7.6); seeds secrets to env = WRONG; T2.S1 owns it.
- ❌ Don't invent §9.7.5 rows for CLI flags with NO table row (--task-retry, --flush-retries, --cache-ttl, …).
- ❌ Don't export `HACK_KEY_TO_ENV` — keep it private `const`; test via the public `loadHackConfig` env-seeding.
- ❌ Don't provider-qualify model defaults in SCHEMA_MAP — they're BARE; `qualifyModel()` qualifies at read time.
- ❌ Don't add `API_TIMEOUT_MS`/`BUG_RESULTS_FILE`/`BUGFIX_SCOPE` to `constants.ts` — S1 is data-only in hack-config.ts.
- ❌ Don't wire `src/cli/index.ts` to read MergedHackConfig — that's CLI-layer work (P2.M2.T2 / a CLI task), not S1.
- ❌ Don't duplicate a dual-surface concept as both a `[cli]` and `[pipeline]` key — one TOML key per concept.

---

## Confidence Score

**9/10** — One-pass success likelihood is high. The full 38-row `SCHEMA_MAP` source is
ready-to-paste (verbatim §9.7.5, research §s1-schema-map-source.md). The
conflict-reconciliation design (SCHEMA_MAP coexists with T2.S1's HACK_CONFIG_SCHEMA;
S1's only existing-symbol edit is `HACK_KEY_TO_ENV` literal→derivation — the one symbol
T2.S1 leaves alone) is binding and minimizes blast radius to ONE declaration + pure
additions. The 100%-coverage trap is branch-free by construction. The only residual
risk is a T2.S1-vs-S1 textual overlap if T2.S1 also happens to derive/edit
`HACK_KEY_TO_ENV` — mitigated by T2.S1's PRP explicitly listing `HACK_KEY_TO_ENV` as a
symbol it does NOT touch, plus the S1 derivation keeping the symbol/type/consumer identical.