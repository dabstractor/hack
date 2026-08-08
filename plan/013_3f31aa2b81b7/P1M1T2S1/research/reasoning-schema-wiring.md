# Research — P1.M1.T2.S1: Add 5 `[reasoning]` entries to SCHEMA_MAP + reasoning section to HACK_CONFIG_SCHEMA

## 1. What this task does (.hack schema wiring for §9.2.9)

Wires the 5 per-role reasoning-level `.hack` keys (`[reasoning] agent|breakdown_agent|bug_finder_agent|
validation_agent|impl_agent`) into the config schema so the TOML loader (a) recognizes them as known
keys, (b) seeds their `PRP_REASONING_*` env vars, and (c) `hack config show --src` auto-surfaces them.
Purely additive: 5 SCHEMA_MAP entries + 1 HACK_CONFIG_SCHEMA section + a focused test block. **No
runtime/consumer change** — the consumers (getters, agent-factory) already exist (S1/S2/S3); this just
makes `.hack` a first-class way to set the values.

## 2. Verified source state (all line numbers confirmed in-repo)

### SCHEMA_MAP (hack-config.ts:189) — `readonly HackConfigSchemaEntry[]`
The **`[harness]` enum entry to mirror** (L222-230):
```ts
{
  section: 'harness',
  key: 'name',
  envVar: 'PRP_AGENT_HARNESS',
  type: 'string',
  defaultValue: 'pi',
  acceptedValues: ['pi', 'claude-code'],
},
```
The 5 reasoning entries mirror this EXACTLY: `section: 'reasoning'`, the 5 keys, the 5 `PRP_REASONING_*`
envVars, defaults `high`/`high`/`high`/`high`/`off`, and `acceptedValues: REASONING_LEVELS` (imported
from constants — single source of truth for the 6-value vocab, per the contract).

**Placement**: SCHEMA_MAP order is `[models]` (L190-212) → `[endpoint]` (L213) → `[harness]` (L222).
PRD §9.7.5 table order is models → **reasoning** → endpoint → harness. Insert the 5 reasoning entries
BETWEEN the `[models]` block (ends ~L212) and the `// --- [endpoint] (§9.2.4) ---` comment (L213),
prefixed by a `// --- [reasoning] (§9.2.9) ---` comment.

### HACK_CONFIG_SCHEMA (hack-config.ts:632) — the VALIDATION authority
The **`harness` field to mirror** (L641): `harness: { name: { type: 'string', enum: ['pi', 'claude-code'] } },`.
Add a `reasoning` section (5 fields, each `{ type: 'string', enum: REASONING_LEVELS }`), placed between
`models` (L636-640) and `endpoint` (L640) to match the PRD table order.

### The coexistence note (hack-config.ts:181-186) — DO NOT "consolidate"
> "SCHEMA_MAP is the seeding/dual-surface/show authority; HACK_CONFIG_SCHEMA (type/min/max/enum) is the
> VALIDATION authority. Both carry type/enum info by design — do not consolidate them; they serve
> different consumers."

→ Both structures MUST carry the enum. This is BY DESIGN (the contract restates it). SCHEMA_MAP's
`acceptedValues` drives `hack config show`; HACK_CONFIG_SCHEMA's `enum` drives the loader's validation
check. Do not "DRY" them into one.

### HACK_KEY_TO_ENV (hack-config.ts:535) — DERIVED, do NOT hand-edit
```ts
const HACK_KEY_TO_ENV = Object.fromEntries(
  SCHEMA_MAP.filter(e => e.envVar !== undefined).map(e => [`${e.section}.${e.key}`, e.envVar as string])
);
```
Adding the 5 entries (each with an `envVar`) AUTO-includes `reasoning.agent → PRP_REASONING_AGENT`, etc.
The loader's `seedProcessEnv` then sets `process.env.PRP_REASONING_*` (only if undefined — §9.2.1
env-over-file). **No manual edit.**

### The loader enum check (hack-config.ts:898-903) — CASE-SENSITIVE (T2.S2 owns the fix)
```ts
if (spec.type === 'string' && spec.enum !== undefined && !spec.enum.includes(value as string)) {
  throw new HackConfigError(`[${section}] ${key} in ${file}: ${JSON.stringify(value)} is not one of the accepted values [${spec.enum.join(', ')}].`);
}
```
- `impl_agent = "loud"` (genuinely out-of-vocab) → THROWS the §9.7.7 message (names section+key+file+
  value+accepted). **This is T2.S1's test target** — works with the existing check, no fix needed.
- `impl_agent = "HIGH"` (case variant) → ALSO throws today (`.includes` is case-sensitive). **This is
  the gap T2.S2 fixes** (case-insensitive enum). T2.S1 does NOT touch the loader check; T2.S1's test
  uses `'loud'` (out-of-vocab), NOT a case variant — keeping the two subtasks disjoint.

## 3. S1 (Complete) symbols to reference (constants.ts)

- `REASONING_LEVELS` (L1534): `['off','minimal','low','medium','high','xhigh']` — the vocab. Import
  into hack-config.ts for `acceptedValues`/`enum` (single source of truth — the contract's directive).
- Env-name constants: `PRP_REASONING_AGENT` (L1552), `_BREAKDOWN_AGENT` (L1562), `_BUG_FINDER_AGENT`
  (L1572), `_VALIDATION_AGENT` (L1582), `_IMPL_AGENT` (L1593) — values are the literal env-var names.
- Defaults: `DEFAULT_REASONING_AGENT`='high' (L1598), `_BREAKDOWN`='high' (L1603), `_BUG_FINDER`='high'
  (L1608), `_VALIDATION`='high' (L1613), `_IMPL`='off' (L1621).

**Import decision**: hack-config.ts ALREADY imports from `./constants.js` (L11: `PRP_API_KEY`). Extend
that import to add `REASONING_LEVELS`. Use `acceptedValues: REASONING_LEVELS` / `enum: REASONING_LEVELS`
(the drift-prone 6-value list — single source of truth). For `envVar`/`defaultValue`, use LITERAL
strings (`'PRP_REASONING_AGENT'`, `'high'`, `'off'`) to match the file's existing entry convention
(the harness entry uses literals). This honors the contract's specific "REASONING_LEVELS for
acceptedValues/enum" directive while staying consistent with the file's style. (If a readonly/mutable
type mismatch occurs on the enum, spread: `enum: [...REASONING_LEVELS]`.)

## 4. AUTO-DERIVED outputs (verify in T2.S2, do NOT edit here)

- **HACK_KEY_TO_ENV** auto-includes the 5 mappings (derived — §2).
- **`hack config init` template** (`ConfigCommand.#buildTemplate`, config.ts:207) iterates SCHEMA_MAP
  by section → a `[reasoning]` block is emitted automatically. (Verify in T2.S2.)
- **`hack config show --src`** (`#showAction`, config.ts:327-416) iterates SCHEMA_MAP → reasoning rows
  appear automatically with winning layer. (Verify in T2.S2.)
- T2.S1 does NOT edit config.ts, the loader, or the template generator. It only adds the 5 SCHEMA_MAP
  entries + the reasoning HACK_CONFIG_SCHEMA section + tests.

## 5. Test design (TDD — mirror the file's existing patterns)

`tests/unit/config/hack-config.test.ts` already has:
- **TOML-seeding tests** (L231-234): `writeFileSync(join(repoRoot,'.hack'), '[harness]\nname = "pi"\n');
  const cfg = loadHackConfig(repoRoot);` then assert.
- **Validation-error tests** (L315-319): `writeFileSync(...'[pipeline]\nresearch_depth = 3\n');
  expect(() => loadHackConfig(repoRoot)).toThrow(...)` — wait, research_depth=3 is VALID; the error
  tests use invalid values. Mirror the `expect(() => loadHackConfig(repoRoot)).toThrow(/.../)` shape.
- **A `describe('hack-config: SCHEMA_MAP')` block** (L417) with an `acceptedValues match the §9.7.5
  enums` test (L515) — REVIEW it: if it asserts a specific enum-entry COUNT, adding 5 more may need an
  update; if it iterates, it auto-accommodates.

**T2.S1's new describe block** (append, e.g. `describe('hack-config: [reasoning] schema wiring')`):
1. **SCHEMA_MAP shape**: assert the 5 entries exist (find by `section:'reasoning'` + key) with the
   correct `envVar`/`type`/`defaultValue`/`acceptedValues` (the 6 REASONING_LEVELS).
2. **HACK_CONFIG_SCHEMA shape**: assert `HACK_CONFIG_SCHEMA.reasoning` has the 5 fields each with
   `enum` = REASONING_LEVELS (import HACK_CONFIG_SCHEMA if exported — it may be module-private; if so,
   assert via the validation-error test instead).
3. **TOML seeding**: `writeFileSync(join(repoRoot,'.hack'), '[reasoning]\nagent = "medium"\n'); 
   delete process.env.PRP_REASONING_AGENT; loadHackConfig(repoRoot);` →
   `expect(process.env.PRP_REASONING_AGENT).toBe('medium')`. (delete in beforeEach so a stale env var
   doesn't mask the seed; restore in afterEach.)
4. **Out-of-vocab hard-error (§9.7.7)**: `writeFileSync(join(repoRoot,'.hack'), '[reasoning]\nimpl_agent = "loud"\n');
   expect(() => loadHackConfig(repoRoot)).toThrow(/is not one of the accepted values/);` — and the
   message names `reasoning.impl_agent` + the file + the accepted levels. **Use `'loud'` (out-of-vocab),
   NOT a case variant** — case-insensitivity is T2.S2.

## 6. Parallel-execution / file-disjoint check

- **vs P1.M1.T1.S4 (in-flight, .env.example + JSDoc):** S4 edits `.env.example` + `constants.ts`/`types.ts`
  JSDoc. T2.S1 edits `hack-config.ts` + `hack-config.test.ts`. **Zero overlap** (different files; S4 is
  doc/JSDoc, T2.S1 is schema wiring). T2.S1 consumes S1's `REASONING_LEVELS` (Complete) — S4's JSDoc
  edits don't change the symbol values T2.S1 imports.
- **vs T2.S2 (next):** T2.S2 edits the LOADER (case-insensitive enum check at :898-903) + verifies the
  auto-derived outputs + the repo `./.hack [reasoning]` block. T2.S1 adds the SCHEMA data; T2.S2 makes
  the validation case-insensitive. **Disjoint**: T2.S1 = data; T2.S2 = loader behavior. T2.S1's test
  uses `'loud'` (out-of-vocab) so it passes BOTH before and after T2.S2's case-insensitivity fix — no
  ordering coupling.
- **vs S1/S2/S3 (Complete):** T2.S1 consumes S1's `REASONING_LEVELS` + env-name constants + defaults.
  It does NOT touch the getters (S2), agent-factory (S3), or the startup validator (T4).

## 7. Decisions locked

- **5 SCHEMA_MAP entries** section `'reasoning'`, mirroring the `[harness]` enum entry shape, with
  `acceptedValues: REASONING_LEVELS` (imported — single source of truth). Placed between `[models]` and
  `[endpoint]` (PRD §9.7.5 table order).
- **`reasoning` HACK_CONFIG_SCHEMA section** (5 fields, each `{ type:'string', enum: REASONING_LEVELS }`),
  placed between `models` and `endpoint`.
- **Both carry the enum BY DESIGN** (coexistence note §2) — do not consolidate.
- **HACK_KEY_TO_ENV NOT hand-edited** (derived — auto-includes the 5 mappings).
- **Import `REASONING_LEVELS`** (extend the existing `./constants.js` import); literal `envVar`/
  `defaultValue` strings (match the file convention). Spread the enum if a readonly-type mismatch occurs.
- **TDD test block** with `'loud'` (out-of-vocab) for the hard-error case — NOT a case variant (T2.S2's
  domain).
- **JSDoc** on the new SCHEMA_MAP entries noting the `[reasoning]`-independent-of-`[models]` invariant
  (§9.7.5 / §9.2.9 — reasoning sets a role's thinking level; models sets its model id; the two are
  orthogonal). Mode A.
- **No loader/consumer/config.ts/startup change** — T2.S1 is schema DATA only.