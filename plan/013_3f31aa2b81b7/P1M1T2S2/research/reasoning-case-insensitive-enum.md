# Research — Case-insensitive [reasoning] enum + auto-derivation verify + repo .hack block

P1.M1.T2.S2 (plan 013, PRD §9.2.9 / §9.7.5). Two surgical loader changes make `[reasoning]` enum
validation case-insensitive (so `[reasoning] agent = "HIGH"` is accepted) and normalize the seeded
value to the canonical lowercase token (`→ 'high'`), gated to the `reasoning` section so other enum
keys (`[harness] name`, `[cli] mode`, `[pipeline] commit_format`/`commit_style`) stay case-sensitive.
Then VERIFY (test-only, no code change) that `hack config init` emits a `[reasoning]` block and
`hack config show --src` reports reasoning rows — both auto-derived because `#buildTemplate` and
`#showAction` iterate `SCHEMA_MAP` (which S1 augmented).

## 1. S1 dependency (must be LANDED before T2.S2)

S1 (P1.M1.T2.S1, Implementing) adds to `src/config/hack-config.ts`:
- 5 `SCHEMA_MAP` entries: `section:'reasoning'`, keys `agent|breakdown_agent|bug_finder_agent|
  validation_agent|impl_agent`, `envVar` `PRP_REASONING_*`, `type:'string'`, defaults `high`/`high`/
  `high`/`high`/`off`, `acceptedValues: REASONING_LEVELS`.
- a `reasoning` section in `HACK_CONFIG_SCHEMA`: 5 fields, each `{ type:'string', enum: REASONING_LEVELS }`.
- imports `REASONING_LEVELS` from `./constants.js`.

T2.S2 CONSUMES these: the loader's enum check reads `HACK_CONFIG_SCHEMA.reasoning.*.enum`
(= `REASONING_LEVELS`); the `section === 'reasoning'` gate matches S1's `section:'reasoning'` entries.
S1 < S2 ordering within P1.M1.T2 ⇒ S1 is merged when T2.S2 executes.

## 2. The case-sensitive bug (the gap T2.S2 closes)

`validateFieldValue` (src/config/hack-config.ts:861) — the enum block (the contract's "L898-903"):
```ts
if (spec.type === 'string' && spec.enum !== undefined && !spec.enum.includes(value as string)) {
  throw new HackConfigError(`[${section}] ${key} in ${file}: ${JSON.stringify(value)} is not one of the accepted values [${spec.enum.join(', ')}].`);
}
```
`spec.enum` is `REASONING_LEVELS` (lowercase: `['off','minimal','low','medium','high','xhigh']`). `value`
is the RAW TOML string. So `[reasoning] agent = "HIGH"` → `'HIGH'` not in the lowercase enum → THROWS.
PRD §9.2.9 / §9.7.5 require case-insensitivity. This is the gap. (S1 sidesteps it by testing with
`'loud'` — genuinely out-of-vocab — so S1's test is green before AND after T2.S2.)

## 3. Design decision — two surgical, gated changes (NOT delegate-to-resolveReasoningLevel)

**Change 1 — case-insensitive enum comparison in `validateFieldValue` (gated `section === 'reasoning'`):**
```ts
if (spec.type === 'string' && spec.enum !== undefined) {
  // [reasoning] values are case-insensitive members of REASONING_LEVELS (PRD §9.2.9 / §9.7.5):
  // compare against the lowercased value so 'HIGH'/'Off' are accepted. Other enum keys
  // ([harness] name, [cli] mode, [pipeline] commit_format/commit_style) stay case-sensitive.
  // The §9.7.7 error message echoes the ORIGINAL value (what the user typed).
  const compareValue =
    section === 'reasoning' && typeof value === 'string'
      ? value.toLowerCase()
      : (value as string);
  if (!spec.enum.includes(compareValue)) {
    throw new HackConfigError(`[${section}] ${key} in ${file}: ${JSON.stringify(value)} is not one of the accepted values [${spec.enum.join(', ')}].`);
  }
}
```
- Gated on `section === 'reasoning'` → other enums UNAFFECTED (their `compareValue` = raw value, case-sensitive as today).
- Error message uses `value` (original) → the §9.7.7 "names section+key+file+value+accepted" stays actionable (e.g. `"LOUD"` shown verbatim).

**Change 2 — normalize the seeded value to lowercase in `seedProcessEnv` (gated `section === 'reasoning'`):**
```ts
// in seedProcessEnv, inside the inner loop:
const seedValue =
  section === 'reasoning' && typeof value === 'string'
    ? value.toLowerCase()
    : value;
process.env[envName] = String(seedValue);
```
- So `process.env.PRP_REASONING_AGENT` holds the CANONICAL `'high'` (matching PRD §9.7.5 "(→ 'high')").
- The downstream getter `resolveReasoningLevel` already lowercases, so runtime behavior is identical
  either way — but normalizing at the seed boundary makes the env var canonical and lets the loader-level
  test assert `process.env.PRP_REASONING_AGENT === 'high'` directly.

**Why NOT delegate to `resolveReasoningLevel()` (the item's option 2):** `resolveReasoningLevel` throws
`ReasoningConfigError` (T1's class), whose message format ≠ the §9.7.7 `HackConfigError` format (which
names file + section + the accepted-values list). The item explicitly requires "the thrown message
stays actionable (names section+key+file+value+accepted, §9.7.7)" — that IS the `HackConfigError`
message. Delegating would change the error type/message and lose the file attribution. So keep
`validateFieldValue` + `HackConfigError`; only relax the comparison + normalize the seed.

**Why gate on `section === 'reasoning'` (not make ALL enums case-insensitive):** PRD §9.2.9 makes
REASONING case-insensitive explicitly. The other enums (`[harness] name`, `[cli] mode`,
`[pipeline] commit_format`/`commit_style`) are NOT specified case-insensitive, and `[harness] name`
feeds `configureHarness()` which validates against `SUPPORTED_HARNESSES` (lowercase) — making it
case-insensitive here would be an unrequested behavior change with its own downstream surface. Scope
discipline: touch ONLY `[reasoning]`.

## 4. The load flow (why the two change points are sufficient)

`loadHackConfig` (src/config/hack-config.ts:1003) per tier: `parseHackFile` → `validateHackTier(parsed,
file, tier)` → `mergeTier(merged, parsed, …)`. After all tiers: `seedProcessEnv(merged)`.

- `validateHackTier` → `validateFieldValue` per known key. **Change 1** here makes the enum check accept
  case variants for `[reasoning]` (validation no longer throws for 'HIGH').
- `seedProcessEnv(merged)` seeds `process.env[envName] = String(value)`. **Change 2** here lowercases
  reasoning values → the env var holds the canonical token.

`validateHackTier` stays PURE (no mutation of its `parsed` input) — the two changes live in the two
functions that already own comparison and seeding respectively. (`hack config show` displays the RAW
merged value by design — it reflects the file; the runtime value is canonical via the seeded env var /
getters. The show acceptance test only asserts rows APPEAR with source attribution, not value case.)

## 5. Auto-derivation of `hack config init` + `show --src` (VERIFY — no code change)

`src/cli/commands/config.ts`:
- `#buildTemplate()` (L211) groups `SCHEMA_MAP` by section and emits `# <key> = <default>` per entry
  (L213 `for (const entry of SCHEMA_MAP)`). ⇒ once S1 adds the 5 `section:'reasoning'` entries,
  `hack config init` AUTO-emits a `[reasoning]` block with the 5 commented keys. NO config.ts edit.
- `#showAction()` (L324) resolves value + source per `SCHEMA_MAP` entry (L350 `SCHEMA_MAP.map(...)`).
  ⇒ `hack config show --src` AUTO-reports the 5 reasoning rows with their resolved value + winning
  source layer. NO config.ts edit.

So T2.S2's "verify" is purely additive TESTS that assert the auto-derived output — no config.ts change.

## 6. Test plan (TDD)

**File 1 — `tests/unit/config/hack-config.test.ts`** (loader level; mirror the existing enum tests at
L787 `[harness]`, L800 `[cli] mode`, L1085 `commit_style`):
- `it('accepts a case-variant [reasoning] value case-insensitively and normalizes to lowercase')`:
  write `.hack [reasoning]\nagent = "HIGH"\nimpl_agent = "Off"`; `delete process.env.PRP_REASONING_AGENT`
  + `_IMPL_AGENT`; `loadHackConfig(repoRoot)` does NOT throw;
  `expect(process.env.PRP_REASONING_AGENT).toBe('high')` + `expect(process.env.PRP_REASONING_IMPL_AGENT).toBe('off')`.
- (S1's existing `'loud'` → throws test stays GREEN: lowercasing 'loud'→'loud' still isn't in the enum.)
- afterEach: `delete` the 5 `PRP_REASONING_*` env vars (prevent leak — S1's directive, carried forward).

**File 2 — `tests/unit/cli/commands/config.test.ts`** (config command level; mirror existing init/show
test patterns there):
- `it('hack config init emits a [reasoning] block (auto-derived from SCHEMA_MAP)')`: invoke the init
  action (or assert `#buildTemplate` output, if testable) contains `[reasoning]` + the 5 keys
  (`agent`, `breakdown_agent`, `bug_finder_agent`, `validation_agent`, `impl_agent`).
- `it('hack config show --src reports each [reasoning] row with source attribution')`: invoke
  show --src; assert the 5 reasoning rows appear (key + resolved value + a source-layer annotation).

**File 3 — repo `./.hack` (OPTIONAL, low priority):** add a commented `[reasoning]` block to the
committed `./.hack` for discoverability (defaults apply when absent, so this is doc surface only). The
item's DOCS: "the .hack block (if added) is the doc surface."

## 7. Parallel-execution / file-disjoint check vs S1

S1 and T2.S2 BOTH edit `src/config/hack-config.ts` + `tests/unit/config/hack-config.test.ts`, but at
DISJOINT locations:
- **hack-config.ts**: S1 edits `SCHEMA_MAP` (data, ~L212) + `HACK_CONFIG_SCHEMA.reasoning` (~L636) + the
  import (~L11). T2.S2 edits `validateFieldValue` (~L898 enum block) + `seedProcessEnv` (~L590 inner
  loop). Different functions — no textual overlap.
- **hack-config.test.ts**: S1 appends a `describe('hack-config: [reasoning] schema wiring')` block.
  T2.S2 appends a `describe('hack-config: [reasoning] case-insensitive enum')` block. Different
  describe blocks.
- S1 < S2 ordering (within P1.M1.T2) ⇒ S1 lands first; T2.S2 consumes S1's schema data. The
  `section === 'reasoning'` gate in T2.S2's changes matches S1's `section:'reasoning'` entries exactly.
- T2.S2 ALSO edits `tests/unit/cli/commands/config.test.ts` (init/show verify) — S1 does NOT touch it
  (S1 is schema data + hack-config tests only). Zero overlap there.