# Research — P1.M1.T1.S2 (two new `[pipeline]` keys in SCHEMA_MAP + HACK_CONFIG_SCHEMA)

S2 wires the two commit-style `.hack` keys (`commit_style`, `commit_style_examples`) into the
config schema so the loader seeds their env vars and `hack config show` displays them. S1 (parallel)
provides the env-var names (`PRP_COMMIT_STYLE`, `PRP_COMMIT_STYLE_EXAMPLES`) + getters in constants.ts.
This is a small, purely-additive wiring task (1 point).

## 1. S1's surface (consumed — assume landed)

`src/config/constants.ts` exports (per S1's PRP):
- `PRP_COMMIT_STYLE = 'PRP_COMMIT_STYLE'`, `DEFAULT_PRP_COMMIT_STYLE = 'auto'`, `PrpCommitStyle`,
  `getPrpCommitStyle()` (case-insensitive over auto|plain|conventional|gitmoji, default auto).
- `PRP_COMMIT_STYLE_EXAMPLES = 'PRP_COMMIT_STYLE_EXAMPLES'`, `DEFAULT_PRP_COMMIT_STYLE_EXAMPLES = 5`,
  `getPrpCommitStyleExamples()` (allows 0; `< 0`/NaN → 5).

S2 consumes only the two **env-var name strings** (`PRP_COMMIT_STYLE`, `PRP_COMMIT_STYLE_EXAMPLES`) —
it does NOT import the getters (the loader seeds process.env; the getters read process.env elsewhere).
S1 owns `.env.example`; S2 does NOT touch it (contract: "the .env.example update in S1 already
documents the env-var surface").

## 2. The three structures in `src/config/hack-config.ts` (verified shapes + line numbers)

### (A) `HackConfigSchemaEntry` interface (L143-158) — the SCHEMA_MAP entry shape
```ts
readonly section: string;            // 'pipeline'
readonly key: string;                // 'commit_style'
readonly envVar?: string;            // 'PRP_COMMIT_STYLE'
readonly cliFlag?: string;           // undefined for these (env-only, no CLI flag)
readonly type: 'string' | 'int' | 'boolean';
readonly defaultValue?: string | number | boolean;
readonly acceptedValues?: readonly string[];
```

### (B) `SCHEMA_MAP` (L189, `readonly HackConfigSchemaEntry[]`) — the existing `commit_format` entry (L262-269)
```ts
{
  section: 'pipeline',
  key: 'commit_format',
  envVar: 'PRP_COMMIT_FORMAT',
  type: 'string',
  defaultValue: 'task-prefix',
  acceptedValues: ['task-prefix', 'plain'],
},
```
**Insert the two new entries IMMEDIATELY AFTER this entry** (before the blank line + `// --- [commit] ---`
comment at L271). Verbatim entries (from implementation-status §F1.B):
```ts
{
  section: 'pipeline',
  key: 'commit_style',
  envVar: 'PRP_COMMIT_STYLE',
  type: 'string',
  defaultValue: 'auto',
  acceptedValues: ['auto', 'plain', 'conventional', 'gitmoji'],
},
{
  section: 'pipeline',
  key: 'commit_style_examples',
  envVar: 'PRP_COMMIT_STYLE_EXAMPLES',
  type: 'int',
  defaultValue: 5,
},
```
NOTE: `commit_style_examples` has NO `acceptedValues` (it's a range int, min 0) — mirror `issue_retry_max`
(L256-260: `{ section:'pipeline', key:'issue_retry_max', envVar:'ISSUE_RETRY_MAX', type:'int', defaultValue:3 }`).

### (C) `HACK_CONFIG_SCHEMA` (L617, `Record<string, Record<string, HackConfigFieldSpec>>`) — pipeline section (L627-633)
```ts
pipeline: {
  parallel_research: { type: 'boolean' },
  research_depth: { type: 'int', min: 1 },
  research_timeout_seconds: { type: 'int', min: 1 },
  issue_retry_max: { type: 'int', min: 0 },
  commit_format: { type: 'string', enum: ['task-prefix', 'plain'] },
},
```
FieldSpec shape = `{ type: 'string'|'int'|'boolean', min?, max?, enum? }`. **Add two fields after
`commit_format`** (verbatim):
```ts
  commit_style: { type: 'string', enum: ['auto', 'plain', 'conventional', 'gitmoji'] },
  commit_style_examples: { type: 'int', min: 0 },
```
`min: 0` mirrors `issue_retry_max` (int ≥ 0; 0 disables learning per PRD §5.1 — consistent with S1's
allow-0 getter).

### (D) `HACK_KEY_TO_ENV` (L523) — DERIVED, do NOT edit
```ts
const HACK_KEY_TO_ENV = Object.fromEntries(
  SCHEMA_MAP.filter(e => e.envVar !== undefined).map(e => [`${e.section}.${e.key}`, e.envVar])
);
```
Adding the two entries to SCHEMA_MAP **automatically** adds `pipeline.commit_style → PRP_COMMIT_STYLE`
and `pipeline.commit_style_examples → PRP_COMMIT_STYLE_EXAMPLES` to HACK_KEY_TO_ENV. The loader (L578:
`const envName = HACK_KEY_TO_ENV[`${section}.${key}`]`) then seeds process.env from `.hack` TOML.
**No manual edit to HACK_KEY_TO_ENV.**

## 3. CONFIRMED — no test breakage (iterate-based, no count assertions)

Surveyed the 3 relevant test files:
- `tests/unit/config/hack-config.test.ts` — parses TOML, accesses specific keys (`cfg.pipeline.research_depth`),
  asserts `_sources` length (L202: `Object.keys(cfg).length === 1` — that's the _sources-only case, NOT a
  SCHEMA_MAP count). No SCHEMA_MAP length assertion. Adding 2 entries doesn't affect TOML parsing of
  existing keys.
- `tests/unit/cli/commands/config.test.ts` — `hack config show` checks specific rows
  (`pipeline.parallel_research`, `pipeline.research_depth`) + `toContain('hack config show')`. No snapshot,
  no exhaustive-count. Adding 2 rows doesn't break these.
- `tests/integration/config/hack-config-acceptance.test.ts` — `crit 3` (L350): "show --src prints every
  SCHEMA_MAP key" iterates `for (const e of SCHEMA_MAP)` (L386) and asserts each `${section}.${key}` appears.
  Adding 2 entries → 2 more keys appear → the show command (auto-discovers from SCHEMA_MAP) renders them →
  test STILL PASSES (it iterates the now-larger map). The "unknown key" warning test (L534) uses a
  MISSPELLED key (`reseaerch_depth`) which remains unknown. ✓ No break.

**Net: purely additive.** No existing assertion breaks. The 2 new keys flow through the derived
HACK_KEY_TO_ENV → loader → process.env seeding, and through SCHEMA_MAP → `hack config show` auto-discovery.

## 4. The loader already stringifies int values (precedent)

`commit_style_examples = 5` (int in TOML) must seed `process.env.PRP_COMMIT_STYLE_EXAMPLES = '5'` (string).
The existing int keys (`research_depth`, `issue_retry_max`) already seed correctly (the loader converts to
string for process.env), so `commit_style_examples` (also int) seeds correctly → `getPrpCommitStyleExamples()`
does `Number(process.env[...] ?? 5)` → 5. ✓ (No loader change needed — the existing seeding path handles it.)

## 5. S2's test additions (focused, in hack-config.test.ts)

S2 appends a `describe('commit_style / commit_style_examples schema wiring', …)` block to
`tests/unit/config/hack-config.test.ts` (the natural home — it tests SCHEMA_MAP + parsing + seeding +
validation). Mirror the file's existing TOML-parse + seeding patterns. Cases:
1. SCHEMA_MAP contains the two new entries with the exact shape (find by section+key; assert envVar/type/
   defaultValue/acceptedValues).
2. `[pipeline] commit_style = "conventional"` in a `.hack` → after load, `process.env.PRP_COMMIT_STYLE === 'conventional'`
   (the loader seeded it via HACK_KEY_TO_ENV). Clean up env in afterEach.
3. `[pipeline] commit_style_examples = 3` → `process.env.PRP_COMMIT_STYLE_EXAMPLES === '3'` (stringified int).
4. `[pipeline] commit_style = "bogus"` → enum validation error via HACK_CONFIG_SCHEMA (mirror the existing
   "unknown/invalid key" validation test pattern). Bogus is KNOWN (in SCHEMA_MAP) but INVALID (not in enum) →
   the enum check fires.
5. `hack config show` (or the show-rows helper) includes `pipeline.commit_style` + `pipeline.commit_style_examples`
   rows (auto-discovered).

## 6. Scope boundaries

- S2 = the 2 SCHEMA_MAP entries + 2 HACK_CONFIG_SCHEMA fields + the focused test block. NOTHING else.
- S1 (parallel) = constants.ts getters + .env.example + prp-commit-style.test.ts. S2 consumes only the
  env-var name strings. Do NOT touch constants.ts or .env.example.
- T3 (prompt builder) + T4 (generateCommitMessage wiring) = the actual style-resolution consumers; S2 only
  enables the config surface (loader seeding + show display).
- No docs (contract: "`hack config show` auto-discovers from SCHEMA_MAP").

## 7. Validation (verified executable)

- `npm run typecheck` / `npm run lint` / `npm run format:check` (prettier ERROR-enforced; `npm run fix`).
- `npx vitest run tests/unit/config/hack-config.test.ts` (S2's additions + regression — the existing
  parse/seed/validate/show tests stay green).
- `npx vitest run tests/integration/config/hack-config-acceptance.test.ts` (the iterate-based show --src
  test stays green; the 2 new keys now render).
- Do NOT run full `npm run test:run` as the gate (orthogonal suite state).