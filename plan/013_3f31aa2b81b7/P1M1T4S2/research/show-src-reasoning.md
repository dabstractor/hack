# Research — P1.M1.T4.S2: Verify `hack config show --src` surfaces reasoning level + source

> Verification-only task (TDD: the test IS the work). The `[reasoning]` rows are AUTO-DERIVED —
> once T2.S1 added the SCHEMA_MAP entries, `#showAction` surfaces them with NO config.ts edit.
> This research confirms the derivation, the exact source labels, the JSON assertion surface, and
> the precise `#resolveEntry` precedence so the new test asserts **value + winning source** per key.

## 1. AUTO-DERIVATION — confirmed working TODAY (no prod change needed)

`src/cli/commands/config.ts` `#showAction` (≈L327-416) iterates **every** `SCHEMA_MAP` entry and
builds a row via `#resolveEntry(e, merged, preEnv)` → `{ value, source }`. Because T2.S1 added the
five `section:'reasoning'` entries to SCHEMA_MAP, the reasoning rows flow through with zero
special-casing. **Verified:** `npx vitest run tests/unit/cli/commands/config.test.ts -t reasoning`
→ 2 passed (the init `[reasoning]`-block test + the show `--src` key-presence test). The derivation
works; this task only STRENGTHENS the verification (the existing show test asserts key NAMES only —
not value or source).

## 2. Source labels (`ShowSource`)

config.ts:
```ts
type ShowSource = HackConfigTier | 'env' | 'default';   // = 'global'|'project'|'project-local'|'env'|'default'
```
`HackConfigTier` (hack-config.ts:111): `'global' | 'project' | 'project-local'`. The `'cli'` layer
(§9.2.1 layer 7) is structurally N/A to a subcommand that takes no pipeline flags (JSDoc on
`ShowSource` is explicit). So the 5 winning layers a test can assert are exactly:
`env > global > project > project-local > default`.

## 3. `#resolveEntry` precedence (config.ts ≈L419-447) — THE core logic under test

```ts
// (a) env-linked AND the env var was pre-defined by the shell BEFORE loadHackConfig → 'env' wins.
if (entry.envVar !== undefined && preEnv.has(entry.envVar)) {
  return { value: ConfigCommand.coerceEnv(process.env[envVar], entry.type), source: 'env' };
}
// (b) present in a file tier → merged value + recorded tier (global/project/project-local).
if (qualifiedKey in merged._sources) {
  return { value: merged[section][key], source: merged._sources[qualifiedKey] };
}
// (c) no file/env value → schema default.
return { value: entry.defaultValue, source: 'default' };
```
- `coerceEnv(raw,'string')` returns `raw` unchanged → an env reasoning value like `'low'` renders
  verbatim (NOT coerced). Type `'string'` for all 5 reasoning keys.
- `preEnv` is snapshotted at the TOP of `#showAction`, BEFORE `loadHackConfig()` mutates
  `process.env` (file values seed env). So setting `process.env.PRP_REASONING_AGENT` *before*
  invoking the command → captured in `preEnv` → branch (a) fires → `'env'`. Setting it AFTER has no
  effect on `preEnv` (it was already snapshotted). In tests we set the env var before `run()`.

## 4. The 5 `[reasoning]` keys — exact envVar / default (hack-config.ts:213-256, T2.S1 COMPLETE)

| SCHEMA_MAP key        | envVar                          | default | acceptedValues      |
|-----------------------|---------------------------------|---------|---------------------|
| `reasoning.agent`             | `PRP_REASONING_AGENT`            | `high`  | REASONING_LEVELS |
| `reasoning.breakdown_agent`   | `PRP_REASONING_BREAKDOWN_AGENT`  | `high`  | REASONING_LEVELS |
| `reasoning.bug_finder_agent`  | `PRP_REASONING_BUG_FINDER_AGENT` | `high`  | REASONING_LEVELS |
| `reasoning.validation_agent`  | `PRP_REASONING_VALIDATION_AGENT` | `high`  | REASONING_LEVELS |
| `reasoning.impl_agent`        | `PRP_REASONING_IMPL_AGENT`       | `off`   | REASONING_LEVELS |

`REASONING_LEVELS = ['off','minimal','low','medium','high','xhigh']` (constants.ts:1534).
File tiers: `.hack` → `'project'`; `.hack.local` → `'project-local'`; global → `'global'`.

## 5. JSON output is the robust assertion surface (config.ts ≈L383-401)

`run('show', { output:'json', src:true })` emits a JSON array; each row:
```ts
{ key: 'reasoning.agent', value: 'high', source: 'default' }
```
`value` preserves scalar type (string here); `source` is only present with `--src`. This is far more
precise than substring-matching the cli-table3 grid (where `'default'`/`'project'` could collide
with unrelated text). **Use JSON for value+source assertions**; find the row by `key` and assert
`value` + `source` exactly. Existing tests already prove this pattern (`includes Source field in
JSON output when --src is set`, `preserves scalar type fidelity`).

## 6. Test harness facts (tests/unit/cli/commands/config.test.ts)

- `run(action, options, fileArg?)` instantiates `new ConfigCommand(repoRoot)` with a fresh
  `mkdtempSync` temp dir as `repoRoot`, spies on console.log/error, returns `{stdout, stderr}`.
- `process.exit` is overridden to a no-op recording `exitCalls` (does NOT throw) — so `show` runs to
  completion and returns its stdout.
- `beforeEach` clears `.hack`-overlapping env vars for determinism: `RESEARCH_DEPTH`,
  `RESEARCH_QUEUE_CONCURRENCY`, `PARALLEL_RESEARCH`. It does NOT yet clear the `PRP_REASONING_*`
  vars — **extend it** (same rationale; afterEach already restores the original env in full).
- `DEFAULT_OPTIONS = { output:'table', force:false, src:false, global:false, local:false }`.
- Dev shell has NO `PRP_REASONING_*` set today (`env | grep PRP_REASONING` → none) — so the
  defaults test passes as-is, but clearing in beforeEach is required for CI / contributor-shell
  determinism.

## 7. Three precedence cases the new tests MUST cover (the acceptance criterion)

1. **All defaults (no .hack, no env)** → each of the 5 keys: `value` = its default
   (`high/high/high/high/off`), `source` = `'default'`. Proves every role is present + the
   §9.2.9 default table.
2. **`.hack` sets a value** → that key `source` = `'project'` with the file value; the OTHER
   reasoning keys stay at their defaults + `'default'` (proves per-key independence + file-tier
   attribution). e.g. `[reasoning] impl_agent = "high"` flips impl from `off`→`high` @ project.
3. **Env wins over `.hack`** → set `PRP_REASONING_AGENT` in `process.env` AND put a different value
   in `.hack` `[reasoning] agent`; assert `value` = env value, `source` = `'env'` (env-over-file,
   §9.2.1). Proves the preEnv branch + env attribution.

## 8. Scope / boundaries (what NOT to do)

- **No production code change expected.** If the auto-derivation did NOT surface a reasoning key,
  the fix lives in `SCHEMA_MAP`/T2.S1 (hack-config.ts) — NOT a hand-special-case in `#showAction`
  (the work item is explicit; §F labels this "AUTO-DERIVED … verify only").
- Do NOT touch `src/cli/commands/config.ts`, `src/config/hack-config.ts`, `src/index.ts` (T4.S1),
  agent-factory (T3), or any docs (P1.M2 owns changeset docs).
- Output: ONLY `tests/unit/cli/commands/config.test.ts` (extend the `show` describe + beforeEach).
- Do NOT duplicate the existing weak key-presence test — ADD a focused, stronger describe block
  alongside it (table-path coverage stays intact).