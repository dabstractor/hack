# S1 Conflict reconciliation with P2.M1.T2.S1 (validation)

> P2.M1.T2.S1 (Secrets + type/range validation) runs IN PARALLEL. This file is
> the binding design that lets S1's `SCHEMA_MAP` and T2.S1's `HACK_CONFIG_SCHEMA`
> COEXIST without merge conflicts.

## 1. Two distinct data structures — NOT redundant

| Aspect | **S1: `SCHEMA_MAP`** (this task) | **T2.S1: `HACK_CONFIG_SCHEMA`** (parallel) |
|---|---|---|
| Shape | `HackConfigSchemaEntry[]` (array) | `Record<section, Record<key, HackConfigFieldSpec>>` |
| Entry fields | `section, key, envVar?, cliFlag?, type, defaultValue?, acceptedValues?` | `type, enum?, min?, max?` |
| Purpose | **env-seeding + `hack config show` (dual-surface map)** | **type/range/enum VALIDATION** |
| Covers | 38 §9.7.5 tunable rows (+ dual-surface env/CLI/default) | §9.7.5 rows + `[auth]` section (so secrets don't trip "unknown section") |
| Consumer | `seedProcessEnv` (via derived `HACK_KEY_TO_ENV`), P2.M2.T2 show/validate | `validateHackTier` (secrets + type/range/enum enforcement) |

They BOTH carry `type`/enum-ish info (redundant by design) but serve different
consumers. **S1 does NOT delete, modify, or merge T2.S1's `HACK_CONFIG_SCHEMA`.**
S1's `type`/`acceptedValues?` are SHOW/render metadata (and a future-unification
target); T2.S1's `min`/`max`/`enum` are the validation authority. Document this in
SCHEMA_MAP's JSDoc so the implementer doesn't "consolidate" them mid-flight.

## 2. The ONE symbol both touch: `HACK_KEY_TO_ENV` (the env-seed map)

- **S2 created it** (provisional 28-entry literal).
- **T2.S1 treats it as READ-ONLY** (its PRP: "Do NOT touch S2's
  `HACK_KEY_TO_ENV`/`mergeTier`/`globalHackPath`/`seedProcessEnv`").
- **S1 makes it AUTHORITATIVE** (contract: "provisional mapping becomes
  authoritative") by replacing the literal body with a DERIVATION from SCHEMA_MAP.

→ S1 owns this edit; T2.S1 does not. No edit-edit conflict. The derived form keeps
the symbol, its type, its consumer (`seedProcessEnv`), and its semantics identical
(28 env-linked keys → still 28; just now sourced from the exhaustive SCHEMA_MAP).

## 3. `loadHackConfig` / `seedProcessEnv` stay byte-identical (S1 does NOT touch them)

T2.S1 inserts **3 lines** into `loadHackConfig` (`validateHackTier` per-tier,
`seedAuthOverrideKey` after seeding, `logEffectiveConfigTrace` last) and treats
`seedProcessEnv` as immutable. S1 must NOT restructure `loadHackConfig` or
`seedProcessEnv` — that would collide with T2.S1's 3-line insertion and its
assumptions. S1's entire behavior change is **inside the `HACK_KEY_TO_ENV`
declaration** (literal → derivation). Blast radius: ONE declaration.

## 4. The safe edit (minimal, conflict-free)

In `src/config/hack-config.ts`, after the existing `MergedHackConfig` interface:

1. ADD `export interface HackConfigSchemaEntry { … }` (the row type).
2. ADD `export const SCHEMA_MAP: readonly HackConfigSchemaEntry[] = [ … 38 rows … ]`
   (full source in s1-schema-map-source.md).
3. ADD `export const SCHEMA_BY_KEY: Readonly<Record<string, HackConfigSchemaEntry>>`
   derived from SCHEMA_MAP (keyed `"section.key"`).
4. REPLACE the `HACK_KEY_TO_ENV` literal with:
   ```ts
   const HACK_KEY_TO_ENV: Readonly<Record<string, string>> = Object.fromEntries(
     SCHEMA_MAP.filter((e) => e.envVar !== undefined)
       .map((e) => [`${e.section}.${e.key}`, e.envVar as string])
   );
   ```
   (keeps the `@provisional`→`@authoritative` JSDoc update; keeps the symbol +
   type + consumer + semantics identical).

Steps 1–3 are pure additions (no conflict). Step 4 is S1's only modification of an
existing symbol — and it's the symbol T2.S1 explicitly leaves alone. The merge is
clean: T2.S1's 3-line `loadHackConfig` insertion + its `HACK_CONFIG_SCHEMA`/
`validateHackTier`/`seedAuthOverrideKey`/`logEffectiveConfigTrace` additions land
alongside S1's SCHEMA_MAP additions with zero textual overlap.

## 5. CLI-only keys + MergedHackConfig (contract last sentence)

Contract: "Add CLI-flag-only keys ([cli] mode, scope, max_tasks, max_duration_ms,
continue_on_error, machine_readable, cache_enabled) to the MergedHackConfig —
these seed the CLI default via process.env or a side channel ... for non-env-linked
flags, the CLI layer must read the MergedHackConfig."

**Interpretation (minimal, non-conflicting):** these 8 keys (plus
`concurrency.parallelism`, `monitor.interval_ms`, `monitor.enabled`) are ROWS in
SCHEMA_MAP with a `cliFlag` but NO `envVar`. Because they have no `envVar`, they
are absent from the derived `HACK_KEY_TO_ENV` → `seedProcessEnv` correctly does NOT
seed them (they live only in the returned `MergedHackConfig`, reachable via its
index signature `merged.cli?.mode`). `MergedHackConfig`'s TYPE already supports
arbitrary sections/keys (`ParsedHackConfig` index signature) — **no type change
needed**. The actual Commander wiring ("CLI layer must read MergedHackConfig") is
CLI-layer work (`src/cli/index.ts`) — **OUT of S1 scope** (S1's OUTPUT is
SCHEMA_MAP + authoritative env-seeding, consumed by P2.M2.T2; Commander wiring
risks a huge-file conflict and is not in the contract OUTPUT). S1 provides the DATA
+ documents the contract for the CLI task.

## 6. What S1 must NOT do (scope fences)

- **Modify/delete T2.S1's `HACK_CONFIG_SCHEMA`, `HackConfigFieldSpec`,
  `validateHackTier`, `seedAuthOverrideKey`, `logEffectiveConfigTrace`, or its
  3-line `loadHackConfig` insertion.** (T2.S1 contract.)
- **Modify `loadHackConfig` or `seedProcessEnv` bodies** (T2.S1 treats them as
  immutable; only the `HACK_KEY_TO_ENV` declaration changes).
- **Add `[auth]` rows to SCHEMA_MAP** (secret-bearing → seeds secrets to env =
  WRONG; owned by T2.S1 secrets policy).
- **Invent §9.7.5 rows** for CLI flags NOT in the table (`--task-retry`,
  `--flush-retries`, `--cache-ttl`, `--retry-backoff`, `--prp-compression`,
  `--progress-mode`, `--parallelism` IS in the table, `--dry-run`, `--verbose`,
  etc.). SCHEMA_MAP = the 38 §9.7.5 rows ONLY.
- **Wire Commander / `src/cli/index.ts`** to read MergedHackConfig (CLI-layer
  work; P2.M2.T2 or a CLI task).
- **Add `API_TIMEOUT_MS`/`BUG_RESULTS_FILE`/`BUGFIX_SCOPE` as `export const` to
  `constants.ts`** (S1 is data-only in hack-config.ts; these are envVar LITERALS
  in SCHEMA_MAP, the value seeds env at runtime).
- **Add the `hack config` subcommand** (P2.M2.T2) or .gitignore handling (P2.M2.T3).