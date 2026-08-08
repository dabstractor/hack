# PRP — P1.M1.T2.S1: Add 5 `[reasoning]` entries to `SCHEMA_MAP` + `reasoning` section to `HACK_CONFIG_SCHEMA`

> Plan 013, PRD §9.2.9 (Per-Role Reasoning Level) → §9.7.5 (`.hack` schema). S1 (Complete) added
> `REASONING_LEVELS`/`ReasoningLevel`/`resolveReasoningLevel`/`ReasoningConfigError` + the 5 env-name
> constants + 5 defaults; S2 (Complete) added the 5 getters; S3 reconciled `agent-factory`'s
> `ThinkingLevel`; S4 (parallel) is the `.env.example`/JSDoc doc layer. **T2.S1 wires the 5 per-role
> `[reasoning]` keys into the `.hack` schema** (`SCHEMA_MAP` + `HACK_CONFIG_SCHEMA`) so the TOML loader
> recognizes them, seeds `PRP_REASONING_*`, and `hack config show --src` auto-surfaces them. Purely
> additive schema DATA — no loader/consumer/config.ts/startup change. The case-insensitive enum fix is
> **T2.S2** (out of scope).

---

## Goal

**Feature Goal**: Add 5 `section:'reasoning'` entries to `SCHEMA_MAP` (mirroring the `[harness]` enum
entry) and a 5-field `reasoning` section to `HACK_CONFIG_SCHEMA` (mirroring the `harness` field), so
`.hack` `[reasoning] agent|breakdown_agent|bug_finder_agent|validation_agent|impl_agent` are schema-known
keys that seed their `PRP_REASONING_*` env vars and reject out-of-vocab values via the existing enum
validation. Both structures carry the `REASONING_LEVELS` enum **by design** (SCHEMA_MAP = seeding/show
authority; HACK_CONFIG_SCHEMA = validation authority — the file's own coexistence note).

**Deliverable**:
1. **`src/config/hack-config.ts`** — (a) extend the `./constants.js` import with `REASONING_LEVELS`;
   (b) add 5 `SCHEMA_MAP` entries (section `'reasoning'`, between `[models]` and `[endpoint]`) with a
   `// --- [reasoning] (§9.2.9) ---` comment + a JSDoc note on the `[reasoning]`⊥`[models]` invariant;
   (c) add a `reasoning: { … }` section to `HACK_CONFIG_SCHEMA` (between `models` and `endpoint`).
2. **`tests/unit/config/hack-config.test.ts`** — append a `describe('hack-config: [reasoning] schema
   wiring')` block: SCHEMA_MAP shape (5 entries), HACK_CONFIG_SCHEMA shape (5 enum fields), TOML
   seeding (`[reasoning]\nagent = "medium"` → `process.env.PRP_REASONING_AGENT === 'medium'`), and the
   out-of-vocab hard-error (`impl_agent = "loud"` → §9.7.7 message).

**Success Definition**:
- `SCHEMA_MAP` contains the 5 `section:'reasoning'` entries with `envVar` `PRP_REASONING_AGENT` /
  `_BREAKDOWN_AGENT` / `_BUG_FINDER_AGENT` / `_VALIDATION_AGENT` / `_IMPL_AGENT`, `type:'string'`,
  defaults `high`/`high`/`high`/`high`/`off`, and `acceptedValues: REASONING_LEVELS`.
- `HACK_CONFIG_SCHEMA.reasoning` contains 5 fields, each `{ type:'string', enum: REASONING_LEVELS }`.
- `HACK_KEY_TO_ENV` auto-derives the 5 mappings (not hand-edited) → the loader seeds
  `process.env.PRP_REASONING_*` from `.hack` `[reasoning]` TOML.
- `.hack` `[reasoning] impl_agent = "loud"` → throws the §9.7.7 message (`is not one of the accepted
  values [off, minimal, low, medium, high, xhigh]`) naming `reasoning.impl_agent` + the file.
- Existing parse/seed/validate/show tests stay GREEN (purely additive; REVIEW the `acceptedValues match
  the §9.7.5 enums` test at ~L515 for any count assertion).
- `npm run typecheck && npm run lint && npm run format:check` clean.

---

## Why

- **Completes the §9.7.5 schema for the reasoning axis.** Without these 5 `.hack` keys, a project
  cannot set per-role reasoning levels from its `.hack` file — only via env vars (which S1/S4 documented).
  T2.S1 makes them first-class `.hack` citizens, consistent with the exhaustive §9.7.5 table (which
  already lists all 5 rows).
- **Purely additive + low-risk.** `HACK_KEY_TO_ENV` is derived (`Object.fromEntries(SCHEMA_MAP.filter(
  e => e.envVar !== undefined)…)`), so the 5 entries auto-flow into the loader's env-seeding map. The
  `hack config show`/`init` commands iterate `SCHEMA_MAP` → auto-discover the 5 rows. No per-key code.
- **Mirrors a proven enum entry.** `[harness] name` (SCHEMA_MAP L222-230 + HACK_CONFIG_SCHEMA L641) is
  the exact template for an enum-bearing key. The 5 reasoning entries are the same shape with
  `REASONING_LEVELS` as the vocab.
- **Both structures carry the enum BY DESIGN.** The file's coexistence note (L181-186) explicitly says
  SCHEMA_MAP (seeding/show) and HACK_CONFIG_SCHEMA (validation) both carry type/enum and must NOT be
  consolidated. T2.S1 honors this (the contract restates it).
- **Scope discipline.** T2.S1 = the 5 SCHEMA_MAP entries + the reasoning HACK_CONFIG_SCHEMA section +
  a focused test block + JSDoc. T2.S2 owns the loader's case-insensitive enum fix + the auto-derived
  verification + the repo `./.hack [reasoning]` block. S4 (parallel) owns `.env.example`/JSDoc. No
  overlap.

---

## What

### User-visible behavior
A project can now set per-role reasoning levels from `.hack`:
```toml
[reasoning]
agent            = "high"   # research/PRP (default high)
breakdown_agent  = "high"   # task decomposition (default high)
bug_finder_agent = "high"   # bug finder (default high)
validation_agent = "high"   # validation (default high)
impl_agent       = "off"    # implementation/codegen (default off)
```
`hack config show` lists all 5; an out-of-vocab value (`impl_agent = "loud"`) aborts startup with the
§9.7.7 message. (The levels actually take effect via the S2 getters, which read the seeded env vars.)

### Technical requirements (exact contract)

**Edit A — `src/config/hack-config.ts` import** (~L11): extend the existing `./constants.js` import to
add `REASONING_LEVELS`:
```ts
import { PRP_API_KEY, REASONING_LEVELS } from './constants.js';
```

**Edit B — `SCHEMA_MAP`** (~L189): insert 5 entries BETWEEN the `[models]` block (ends ~L212) and the
`// --- [endpoint] (§9.2.4) ---` comment (L213). Prefix with a section comment + a JSDoc invariant note:
```ts
  // --- [reasoning] (§9.2.9) — per-role extended-thinking level; INDEPENDENT of [models]
  //     (§9.7.5): [reasoning] sets a role's thinking level; [models] sets its model id;
  //     the two are orthogonal — a strong model can run with reasoning off (§9.2.3/§9.2.9). ---
  {
    section: 'reasoning',
    key: 'agent',
    envVar: 'PRP_REASONING_AGENT',
    type: 'string',
    defaultValue: 'high',
    acceptedValues: REASONING_LEVELS,
  },
  {
    section: 'reasoning',
    key: 'breakdown_agent',
    envVar: 'PRP_REASONING_BREAKDOWN_AGENT',
    type: 'string',
    defaultValue: 'high',
    acceptedValues: REASONING_LEVELS,
  },
  {
    section: 'reasoning',
    key: 'bug_finder_agent',
    envVar: 'PRP_REASONING_BUG_FINDER_AGENT',
    type: 'string',
    defaultValue: 'high',
    acceptedValues: REASONING_LEVELS,
  },
  {
    section: 'reasoning',
    key: 'validation_agent',
    envVar: 'PRP_REASONING_VALIDATION_AGENT',
    type: 'string',
    defaultValue: 'high',
    acceptedValues: REASONING_LEVELS,
  },
  {
    section: 'reasoning',
    key: 'impl_agent',
    envVar: 'PRP_REASONING_IMPL_AGENT',
    type: 'string',
    defaultValue: 'off',
    acceptedValues: REASONING_LEVELS,
  },
```
(Mirror the `[harness]` entry at L222-230 exactly — only `section`/`key`/`envVar`/`defaultValue`/
`acceptedValues` differ. `impl_agent` default is `'off'`; the other four are `'high'`.)

**Edit C — `HACK_CONFIG_SCHEMA`** (~L632): add a `reasoning` section BETWEEN `models` (L636-640) and
`endpoint` (L640), mirroring `harness: { name: { type:'string', enum:[...] } }` (L641):
```ts
  reasoning: {
    agent: { type: 'string', enum: REASONING_LEVELS },
    breakdown_agent: { type: 'string', enum: REASONING_LEVELS },
    bug_finder_agent: { type: 'string', enum: REASONING_LEVELS },
    validation_agent: { type: 'string', enum: REASONING_LEVELS },
    impl_agent: { type: 'string', enum: REASONING_LEVELS },
  },
```
(If a readonly/mutable type mismatch occurs on `enum: REASONING_LEVELS`, spread it: `enum: [...REASONING_LEVELS]`.
REASONING_LEVELS is a plain array (L1534); it should assign cleanly to the `enum` field.)

**`HACK_KEY_TO_ENV` (~L535): DO NOT EDIT** — it's `Object.fromEntries(SCHEMA_MAP.filter(e => e.envVar !==
undefined)…)`, so the 5 new entries auto-add `reasoning.agent → PRP_REASONING_AGENT`, etc.

### Success Criteria
- [ ] `REASONING_LEVELS` imported into hack-config.ts (extend the existing `./constants.js` import).
- [ ] `SCHEMA_MAP` has the 5 `section:'reasoning'` entries (between `[models]` and `[endpoint]`) with
      correct envVar/type/defaultValue/acceptedValues.
- [ ] `HACK_CONFIG_SCHEMA.reasoning` has the 5 fields, each `{ type:'string', enum: REASONING_LEVELS }`.
- [ ] `HACK_KEY_TO_ENV` auto-includes the 5 mappings (derived — verified, not edited).
- [ ] `.hack` `[reasoning] agent = "medium"` → seeds `process.env.PRP_REASONING_AGENT === 'medium'`.
- [ ] `.hack` `[reasoning] impl_agent = "loud"` → throws the §9.7.7 message (`is not one of the accepted
      values […]` naming `reasoning.impl_agent` + the file).
- [ ] `npm run typecheck && npm run lint && npm run format:check` clean; existing hack-config tests green.

---

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed?_ **Yes** — the exact
mirror templates (`[harness]` SCHEMA_MAP entry L222-230 + `harness` HACK_CONFIG_SCHEMA field L641), the
verbatim 5 entries (with the `REASONING_LEVELS` single-source directive), the precise insertion sites
(between `[models]` and `[endpoint]`), the derived-`HACK_KEY_TO_ENV` fact (no manual edit), the
case-sensitive-enum/T2.S2-boundary fact, the S1 symbols to import, and the executable validation
commands are all below.

### Documentation & References

```yaml
# MUST READ — the §F spec for this task (verbatim entry + the case-sensitivity boundary)
- docfile: plan/013_3f31aa2b81b7/architecture/integration-points.md
  section: "F. src/config/hack-config.ts — .hack schema (SCHEMA_MAP + HACK_CONFIG_SCHEMA)"
  why: Pins the [harness] mirror (L222-230 / L641), the 5 entries + defaults, the AUTO-DERIVED list
        (HACK_KEY_TO_ENV / init template / show --src), and the case-sensitivity note (loader enum
        check :898-903 is case-sensitive → T2.S2 fixes it; T2.S1 tests with an out-of-vocab value).

# MUST READ — the design + verified line numbers + the T2.S1/T2.S2 boundary (authored with this PRP)
- docfile: plan/013_3f31aa2b81b7/P1M1T2S1/research/reasoning-schema-wiring.md
  section: "2. Verified source state" and "5. Test design" and "6. Parallel-execution check"
  why: The exact coexistence note (L181-186 — both carry enum by design), the HACK_KEY_TO_ENV derivation
        (L535), the case-sensitive loader check (L898-903 — why 'loud' works but 'HIGH' is T2.S2), the
        import decision (hack-config already imports from constants at L11), and the test patterns to
        mirror. READ BEFORE IMPLEMENTING.

# PATTERN FILE 1 — the ONLY source file edited
- file: src/config/hack-config.ts
  why: SCHEMA_MAP (L189) + the [harness] enum entry to mirror (L222-230); HACK_CONFIG_SCHEMA (L632) +
        the harness field to mirror (L641); HACK_KEY_TO_ENV (L535 — DERIVED, do not edit); the existing
        ./constants.js import (L11 — extend with REASONING_LEVELS); the coexistence note (L181-186).
  pattern: "{ section:'harness', key:'name', envVar:'PRP_AGENT_HARNESS', type:'string', defaultValue:'pi', acceptedValues:['pi','claude-code'] }"
  gotcha: Place the 5 entries between [models] (ends ~L212) and [endpoint] (L213) to match PRD §9.7.5
        table order (models → reasoning → endpoint → harness). Both SCHEMA_MAP and HACK_CONFIG_SCHEMA
        carry the enum BY DESIGN — do not consolidate.

# PATTERN FILE 2 — the S1 symbols to import (READ-ONLY — consume, don't modify)
- file: src/config/constants.ts
  why: REASONING_LEVELS (L1534 — the 6-value vocab, single source of truth for acceptedValues/enum).
        The 5 env-name constants (L1552/1562/1572/1582/1593) + 5 defaults (L1598/1603/1608/1613/1621)
        confirm the literal values to use in the entries.
  gotcha: Import ONLY REASONING_LEVELS into hack-config.ts (the contract's single-source directive for
        acceptedValues/enum). Use literal strings for envVar/defaultValue (match the file convention).

# PATTERN FILE 3 — the test file to extend
- file: tests/unit/config/hack-config.test.ts
  why: TOML-seeding pattern (L231-234: writeFileSync(.hack) + loadHackConfig + assert); validation-error
        pattern (expect(() => loadHackConfig(repoRoot)).toThrow(/.../)); describe('hack-config: SCHEMA_MAP')
        at L417 with the 'acceptedValues match the §9.7.5 enums' test at L515 (REVIEW for a count
        assertion). loadHackConfig imported at L36.
  pattern: "writeFileSync(join(repoRoot, '.hack'), '[reasoning]\\nagent = \"medium\"\\n'); delete process.env.PRP_REASONING_AGENT; const cfg = loadHackConfig(repoRoot); expect(process.env.PRP_REASONING_AGENT).toBe('medium');"
  gotcha: delete the seeded PRP_REASONING_* vars in beforeEach/afterEach so they don't leak across the
        file's other tests. Use 'loud' (out-of-vocab) for the hard-error test — NOT a case variant
        (case-insensitivity is T2.S2).

# VERIFIED FACTS
- fact: "SCHEMA_MAP [harness] entry (L222-230) is the enum mirror template; HACK_CONFIG_SCHEMA harness field (L641) is the validation mirror."
- fact: "HACK_KEY_TO_ENV (L535) = Object.fromEntries(SCHEMA_MAP.filter(e => e.envVar !== undefined).map(...)) — DERIVED. Adding entries auto-derives the mappings. NEVER hand-edit."
- fact: "The loader enum check (L898-903) is CASE-SENSITIVE: !spec.enum.includes(value). 'loud' (out-of-vocab) throws the §9.7.7 message; 'HIGH' (case variant) ALSO throws today → T2.S2 fixes case-insensitivity. T2.S1 tests with 'loud' only."
- fact: "hack-config.ts already imports from './constants.js' (L11: PRP_API_KEY) — extend that import to add REASONING_LEVELS."
- fact: "The coexistence note (L181-186): SCHEMA_MAP = seeding/show authority; HACK_CONFIG_SCHEMA = validation authority; BOTH carry enum by design — do not consolidate."
- fact: "S1 REASONING_LEVELS (constants.ts L1534) = ['off','minimal','low','medium','high','xhigh']; defaults high/high/high/high/off (L1598/1603/1608/1613/1621)."
```

### Current Codebase tree (relevant slice)

```bash
src/config/hack-config.ts             # EDIT — +REASONING_LEVELS import + 5 SCHEMA_MAP entries + reasoning HACK_CONFIG_SCHEMA section
tests/unit/config/hack-config.test.ts # EDIT — append describe('hack-config: [reasoning] schema wiring') block
src/config/constants.ts               # READ-ONLY (S1 — REASONING_LEVELS/env-name consts/defaults consumed)
```

### Desired Codebase tree with files to be edited

```bash
src/config/hack-config.ts             # MODIFIED (1 import extension + 5 SCHEMA_MAP entries + 1 HACK_CONFIG_SCHEMA section + JSDoc)
tests/unit/config/hack-config.test.ts # MODIFIED (append 1 describe block)
# No other files. No loader/config.ts/startup change (T2.S2 owns the case-insensitive loader fix).
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL — BOTH SCHEMA_MAP and HACK_CONFIG_SCHEMA carry the enum BY DESIGN (coexistence note L181-186).
//   SCHEMA_MAP.acceptedValues drives `hack config show`; HACK_CONFIG_SCHEMA.enum drives the loader's
//   validation. Do NOT "DRY" them into one structure. The contract restates this.

// CRITICAL — HACK_KEY_TO_ENV (L535) is DERIVED via Object.fromEntries(SCHEMA_MAP.filter(e => e.envVar !==
//   undefined)...). Adding the 5 entries (each with envVar) AUTO-includes reasoning.agent → PRP_REASONING_AGENT
//   etc. NEVER hand-edit HACK_KEY_TO_ENV.

// CRITICAL — the loader enum check (L898-903) is CASE-SENSITIVE. T2.S1's hard-error test MUST use an
//   out-of-vocab value ('loud'), NOT a case variant ('HIGH'). 'loud' throws correctly today; 'HIGH'
//   also throws today but that's the gap T2.S2 fixes. Using 'loud' keeps T2.S1's test green BOTH before
//   and after T2.S2 (no ordering coupling). Do NOT touch the loader check — that's T2.S2.

// CRITICAL — import REASONING_LEVELS (extend the existing './constants.js' import at L11). Use it for
//   acceptedValues + enum (single source of truth — the contract's directive). Use LITERAL strings for
//   envVar ('PRP_REASONING_AGENT') + defaultValue ('high'/'off') to match the file's convention (the
//   harness entry uses literals). If typecheck flags a readonly/mutable mismatch on enum:
//   `enum: [...REASONING_LEVELS]`.

// GOTCHA — place the 5 SCHEMA_MAP entries between [models] (ends ~L212) and [endpoint] (L213), and the
//   HACK_CONFIG_SCHEMA.reasoning section between `models` and `endpoint` — matching PRD §9.7.5 table
//   order (models → reasoning → endpoint → harness). Functional order doesn't matter (the loader
//   iterates by section.key), but table-order placement keeps the file readable.

// GOTCHA — impl_agent default is 'off'; the other four are 'high'. Don't uniform them.

// GOTCHA — REVIEW tests/unit/config/hack-config.test.ts:515 ('acceptedValues match the §9.7.5 enums').
//   If it asserts a specific enum-entry COUNT, adding 5 more may need an update; if it iterates
//   SCHEMA_MAP (likely), it auto-accommodates. Confirm at implementation time.

// GOTCHA — the test's TOML-seeding assertion must `delete process.env.PRP_REASONING_AGENT` (etc.)
//   before loadHackConfig so a stale env var doesn't mask the seed (§9.2.1 env-over-file: env wins).
//   Restore in afterEach (delete the seeded vars) so they don't leak across the file's other tests.

// GOTCHA — do NOT edit the loader (T2.S2), config.ts (init template / show — auto-derived, verify in
//   T2.S2), the getters (S2), agent-factory (S3), the startup validator (T4), or the repo ./.hack
//   (T2.S2). T2.S1 is schema DATA + tests ONLY.

// GOTCHA — prettier is ERROR-enforced. Run `npm run fix` before format:check (the 5 entries + section
//   may need minor formatting).

// GOTCHA — vitest 100% coverage on src: the new SCHEMA_MAP/SCHEMA literals are data (covered by any
//   test reading them — the show --src acceptance test iterates SCHEMA_MAP). hack-config.ts is already
//   heavily covered; the additive literals don't reduce coverage.
```

---

## Implementation Blueprint

### Data models and structure
None new — T2.S1 adds entries to two existing data structures (`SCHEMA_MAP` array + `HACK_CONFIG_SCHEMA`
record). The entry/field-spec shapes (`HackConfigSchemaEntry`, `HackConfigFieldSpec`) already exist and
accept the new values verbatim. `REASONING_LEVELS` (S1) is the imported vocab.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT src/config/hack-config.ts — extend the import
  - L11: `import { PRP_API_KEY } from './constants.js';` → `import { PRP_API_KEY, REASONING_LEVELS } from './constants.js';`
  - DO NOT import the env-name constants or defaults (use literals for envVar/defaultValue — file convention).

Task 2: EDIT src/config/hack-config.ts — add the 5 SCHEMA_MAP entries
  - INSERT (between the [models] block ending ~L212 and the `// --- [endpoint] (§9.2.4) ---` comment L213):
        the `// --- [reasoning] (§9.2.9) ---` comment + the JSDoc invariant note + the 5 entries (verbatim
        from Edit B). Each: section 'reasoning', the key, envVar literal, type 'string', defaultValue
        ('high' x4 / 'off' for impl_agent), acceptedValues: REASONING_LEVELS.
  - DO NOT: edit HACK_KEY_TO_ENV (derived), touch existing entries, or place the entries outside the
        models→endpoint gap.
  - EXPECTED: typecheck clean (entries match HackConfigSchemaEntry; REASONING_LEVELS assignable to
        acceptedValues). HACK_KEY_TO_ENV auto-includes the 5 mappings.

Task 3: EDIT src/config/hack-config.ts — add the reasoning HACK_CONFIG_SCHEMA section
  - INSERT `reasoning: { agent:{...}, breakdown_agent:{...}, bug_finder_agent:{...}, validation_agent:{...},
        impl_agent:{...} },` between `models: {...},` and `endpoint: {...},` (each field
        `{ type: 'string', enum: REASONING_LEVELS }`). Per Edit C.
  - DO NOT add a min/max (it's an enum, not a range). DO NOT consolidate with SCHEMA_MAP.
  - EXPECTED: typecheck clean. The loader's enum check (L898-903) now validates reasoning values.

Task 4: EDIT tests/unit/config/hack-config.test.ts — append the [reasoning] describe block
  - IMPORT: ensure SCHEMA_MAP + loadHackConfig + HackConfigError are imported (loadHackConfig at L36;
        SCHEMA_MAP likely imported in the L417 describe — confirm + reuse).
  - describe('hack-config: [reasoning] schema wiring') cases:
      1. SCHEMA_MAP shape: find the 5 entries by section 'reasoning' + key; assert envVar
         (PRP_REASONING_AGENT/_BREAKDOWN_AGENT/_BUG_FINDER_AGENT/_VALIDATION_AGENT/_IMPL_AGENT),
         type 'string', defaultValue (high/high/high/high/off), acceptedValues deep-equals REASONING_LEVELS.
      2. HACK_CONFIG_SCHEMA shape (if exported): assert HACK_CONFIG_SCHEMA.reasoning has the 5 fields
         each with enum deep-equals REASONING_LEVELS. (If HACK_CONFIG_SCHEMA is module-private, assert
         via the validation-error test instead — case 4 proves the enum is wired.)
      3. TOML seed: writeFileSync(join(repoRoot,'.hack'), '[reasoning]\nagent = "medium"\n');
         delete process.env.PRP_REASONING_AGENT; loadHackConfig(repoRoot);
         expect(process.env.PRP_REASONING_AGENT).toBe('medium').
      4. Out-of-vocab hard-error (§9.7.7): writeFileSync(join(repoRoot,'.hack'),
         '[reasoning]\nimpl_agent = "loud"\n'); expect(() => loadHackConfig(repoRoot)).toThrow(
         /is not one of the accepted values/); AND the message matches /reasoning\.impl_agent|impl_agent/
         + /off, minimal, low, medium, high, xhigh/. (Use 'loud' — NOT a case variant; case-insensitivity
         is T2.S2.)
  - beforeEach/afterEach: delete the 5 PRP_REASONING_* process.env vars (prevent leak; the file's other
        tests must not see a stale seed).
  - REVIEW L515 ('acceptedValues match the §9.7.5 enums'): if it asserts a count, update; if iterate, leave.
  - NAMING: it('seeds PRP_REASONING_AGENT from [reasoning] agent'), it('rejects an out-of-vocab
        [reasoning] impl_agent with the §9.7.7 message'), it('carries REASONING_LEVELS as acceptedValues
        for all 5 [reasoning] SCHEMA_MAP entries').
  - PLACEMENT: append the describe block at the end of the file (or alongside the SCHEMA_MAP describe at L417).
  - EXPECTED: all 4 cases pass; existing hack-config tests green (purely additive).

Task 5: FORMAT + VERIFY
  - RUN: npm run fix → npm run typecheck → npm run lint → npm run format:check.
  - RUN: npx vitest run tests/unit/config/hack-config.test.ts (T2.S1 additions + regression).
  - EXPECTED: all clean/green. If the enum type-mismatches, spread: `enum: [...REASONING_LEVELS]`. If the
        seeding test fails, confirm HACK_KEY_TO_ENV derived the mapping (it does) + the env var was
        deleted before loadHackConfig. If the hard-error test doesn't fire, confirm HACK_CONFIG_SCHEMA
        (not just SCHEMA_MAP) got the reasoning section (Task 3). If a count-assertion test at L515
        breaks, update it to iterate.
```

### Implementation Patterns & Key Details

```ts
// ---- hack-config.ts: the import extension (L11) ----
import { PRP_API_KEY, REASONING_LEVELS } from './constants.js';

// ---- hack-config.ts: SCHEMA_MAP entries (insert between [models] ~L212 and [endpoint] L213) ----
  // --- [reasoning] (§9.2.9) — per-role extended-thinking level; INDEPENDENT of [models]
  //     (§9.7.5): [reasoning] sets a role's thinking level; [models] sets its model id;
  //     the two are orthogonal — a strong model can run with reasoning off (§9.2.3/§9.2.9). ---
  {
    section: 'reasoning',
    key: 'agent',
    envVar: 'PRP_REASONING_AGENT',
    type: 'string',
    defaultValue: 'high',
    acceptedValues: REASONING_LEVELS,
  },
  // … breakdown_agent (high), bug_finder_agent (high), validation_agent (high), impl_agent (off) …

// ---- hack-config.ts: HACK_CONFIG_SCHEMA.reasoning (insert between `models` and `endpoint`) ----
  reasoning: {
    agent: { type: 'string', enum: REASONING_LEVELS },
    breakdown_agent: { type: 'string', enum: REASONING_LEVELS },
    bug_finder_agent: { type: 'string', enum: REASONING_LEVELS },
    validation_agent: { type: 'string', enum: REASONING_LEVELS },
    impl_agent: { type: 'string', enum: REASONING_LEVELS },
  },

// ---- hack-config.test.ts: the seeding + hard-error proof ----
it('seeds PRP_REASONING_AGENT from [reasoning] agent', () => {
  writeFileSync(join(repoRoot, '.hack'), '[reasoning]\nagent = "medium"\n');
  delete process.env.PRP_REASONING_AGENT;
  loadHackConfig(repoRoot);
  expect(process.env.PRP_REASONING_AGENT).toBe('medium');
});
it('rejects an out-of-vocab [reasoning] impl_agent with the §9.7.7 message', () => {
  writeFileSync(join(repoRoot, '.hack'), '[reasoning]\nimpl_agent = "loud"\n');
  expect(() => loadHackConfig(repoRoot)).toThrow(/is not one of the accepted values/);
});
// afterEach: delete the 5 PRP_REASONING_* process.env vars.
```

### Integration Points

```yaml
DOWNSTREAM (T2.S1 ENABLES these — separate subtasks, do NOT do them here):
  - P1.M1.T2.S2 (case-insensitive enum + auto-derive verify + repo .hack): makes the loader's enum check
        case-insensitive (so 'HIGH' is accepted), verifies HACK_KEY_TO_ENV/init-template/show auto-derived
        the 5 keys, and adds the repo ./.hack [reasoning] block. T2.S1 provides the SCHEMA data T2.S2's
        loader fix applies to.
  - P1.M1.T4 (startup fail-fast + config show): the startup validator + show --src consume the seeded
        env vars / SCHEMA_MAP rows. T2.S1's schema wiring makes .hack a source for them.

NO LOADER/CONSUMER CHANGES: the loader iterates HACK_KEY_TO_ENV (derived — auto-includes the 5 keys) +
  HACK_CONFIG_SCHEMA (the new reasoning section validates them). show/init iterate SCHEMA_MAP
  (auto-discover the 5 rows). All work unchanged with the 5 new entries. No per-key code anywhere.
  The S2 getters read process.env.PRP_REASONING_* (which the loader now seeds from .hack) — unchanged.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run fix                  # lint:fix + prettier --write (run after the edits)
npm run typecheck            # tsc --noEmit -p tsconfig.build.json — clean
npm run lint && npm run format:check   # clean
# Expected: clean. If typecheck flags REASONING_LEVELS not exported, confirm constants.ts:1534 (S1 landed).
#   If it flags a readonly/mutable mismatch on enum/acceptedValues, spread: [...REASONING_LEVELS].
```

### Level 2: Unit Tests (the PRIMARY gate)

```bash
npx vitest run tests/unit/config/hack-config.test.ts
# Expected: ALL GREEN — the new [reasoning] describe (4 cases) + every existing test. If the hard-error
#   test doesn't fire, confirm HACK_CONFIG_SCHEMA.reasoning landed (Task 3 — the loader validates via
#   HACK_CONFIG_SCHEMA.enum, not SCHEMA_MAP.acceptedValues). If a count-assertion at ~L515 breaks, update
#   it to iterate. If the seeding test fails, confirm HACK_KEY_TO_ENV derived the mapping + the env var
#   was deleted before loadHackConfig.
# Do NOT run the full `npm run test:run` as the gate — orthogonal suite state.
```

### Level 3: Integration Testing (System Validation)

```bash
# Smoke: a .hack with [reasoning] seeds the env var end-to-end (real fs tmpdir).
npx tsx -e "
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';
const repo = mkdtempSync(join(tmpdir(),'hack-reasoning-'));
writeFileSync(join(repo,'.hack'), '[reasoning]\nagent = \"xhigh\"\nimpl_agent = \"off\"\n');
delete process.env.PRP_REASONING_AGENT; delete process.env.PRP_REASONING_IMPL_AGENT;
import('./src/config/hack-config.ts').then(m => { m.loadHackConfig(repo);
  console.log('agent:', process.env.PRP_REASONING_AGENT, '| impl:', process.env.PRP_REASONING_IMPL_AGENT);
  rmSync(repo,{recursive:true,force:true}); });
"
# Expected: agent: xhigh | impl: off (the loader seeded both from the .hack TOML via the derived HACK_KEY_TO_ENV).
```

### Level 4: Creative & Domain-Specific Validation

```bash
# No MCP/DB/HTTP surface. Domain checks (record in commit message):
#   - 5 [reasoning] SCHEMA_MAP entries + reasoning HACK_CONFIG_SCHEMA section wired (both carry the enum
#     by design — coexistence note L181-186; not consolidated).
#   - HACK_KEY_TO_ENV auto-derived (no manual edit); loader seeds process.env.PRP_REASONING_* from .hack.
#   - Out-of-vocab value (impl_agent='loud') → §9.7.7 hard error (case-sensitive check; T2.S2 adds
#     case-insensitivity for variants like 'HIGH').
#   - [reasoning] ⊥ [models] invariant JSDoc'd on the SCHEMA_MAP entries (§9.7.5 / §9.2.9).
#   - REASONING_LEVELS imported (single source of truth for acceptedValues/enum).
#   - No loader/consumer/config.ts/startup change (T2.S1 is schema DATA only).
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` clean.
- [ ] `npm run lint && npm run format:check` clean.
- [ ] `npx vitest run tests/unit/config/hack-config.test.ts` green (new describe + regression).

### Feature Validation
- [ ] `SCHEMA_MAP` has the 5 `section:'reasoning'` entries (between `[models]` and `[endpoint]`) with
      correct envVar/type/defaultValue/`acceptedValues: REASONING_LEVELS`.
- [ ] `HACK_CONFIG_SCHEMA.reasoning` has the 5 fields, each `{ type:'string', enum: REASONING_LEVELS }`.
- [ ] `HACK_KEY_TO_ENV` auto-includes the 5 mappings (derived — verified, not edited).
- [ ] `.hack [reasoning] agent = "medium"` → seeds `process.env.PRP_REASONING_AGENT === 'medium'`.
- [ ] `.hack [reasoning] impl_agent = "loud"` → §9.7.7 hard error (out-of-vocab; case-insensitivity is T2.S2).
- [ ] JSDoc on the SCHEMA_MAP entries notes the `[reasoning]`⊥`[models]` invariant (§9.7.5).

### Code Quality Validation
- [ ] Only `src/config/hack-config.ts` (import + 5 entries + 1 section + JSDoc) + `tests/unit/config/hack-config.test.ts` (1 describe) modified.
- [ ] Both SCHEMA_MAP and HACK_CONFIG_SCHEMA carry the enum (NOT consolidated — coexistence note).
- [ ] `HACK_KEY_TO_ENV` NOT hand-edited (derived).
- [ ] `REASONING_LEVELS` imported (single source of truth); literal envVar/defaultValue match file convention.
- [ ] No loader (T2.S2), config.ts, getters (S2), agent-factory (S3), startup (T4), or repo `./.hack` (T2.S2) changes.

### Documentation & Deployment
- [ ] Mode A: JSDoc on the new SCHEMA_MAP entries (the `[reasoning]`⊥`[models]` invariant + §9.7.5/§9.2.9 cites).
- [ ] Commit message notes: 5 [reasoning] SCHEMA_MAP entries + reasoning HACK_CONFIG_SCHEMA section wired;
      HACK_KEY_TO_ENV derived; out-of-vocab→§9.7.7 error (case-insensitivity = T2.S2); REASONING_LEVELS
      single-source; no loader/consumer/startup change.

---

## Anti-Patterns to Avoid

- ❌ Don't hand-edit `HACK_KEY_TO_ENV` (L535) — it's `Object.fromEntries(SCHEMA_MAP.filter(e => e.envVar !==
      undefined)…)`; adding the entries auto-derives the 5 mappings.
- ❌ Don't "consolidate" SCHEMA_MAP and HACK_CONFIG_SCHEMA — the coexistence note (L181-186) says BOTH
      carry the enum by design (seeding/show vs validation authorities). Add the enum to BOTH.
- ❌ Don't test with a case variant (`'HIGH'`) for the hard-error case — the loader enum check is
      case-sensitive (L898-903), so `'HIGH'` throws today but that's the gap **T2.S2** fixes. Use `'loud'`
      (out-of-vocab) so T2.S1's test is green before AND after T2.S2.
- ❌ Don't touch the loader enum check (L898-903) — the case-insensitivity fix is T2.S2. T2.S1 is schema DATA.
- ❌ Don't literalize the 6-value vocab (`['off','minimal','low','medium','high','xhigh']`) in the entries —
      import `REASONING_LEVELS` (the contract's single-source-of-truth directive; avoids drift). Literal
      envVar/defaultValue is fine (matches the file convention).
- ❌ Don't uniform the 5 defaults — `impl_agent` is `'off'`; the other four are `'high'` (§9.2.9).
- ❌ Don't place the entries outside the `[models]`→`[endpoint]` gap — match PRD §9.7.5 table order
      (models → reasoning → endpoint → harness) in both SCHEMA_MAP and HACK_CONFIG_SCHEMA.
- ❌ Don't edit `config.ts` (init template / show — auto-derived, verify in T2.S2), the getters (S2),
      agent-factory (S3), the startup validator (T4), or the repo `./.hack` (T2.S2).
- ❌ Don't let the seeded `PRP_REASONING_*` env vars leak across tests — delete them in afterEach.
- ❌ Don't run the full `npm run test:run` as the gate — use the targeted hack-config suite.

---

## Confidence Score

**10/10** — one-pass implementation success likelihood.

Rationale: This is a purely-additive schema-wiring task. The exact mirror templates are verified in-repo
(`[harness]` SCHEMA_MAP entry L222-230 + `harness` HACK_CONFIG_SCHEMA field L641), the 5 entries are
specified verbatim (with the `REASONING_LEVELS` single-source directive), the insertion sites are pinned
(between `[models]` and `[endpoint]` in both structures), and `HACK_KEY_TO_ENV` is confirmed derived
(`Object.fromEntries(SCHEMA_MAP.filter(...))` — auto-includes the 5 mappings, no manual edit). The
coexistence note (L181-186) confirms both structures carry the enum by design. The one scope boundary —
that the loader enum check (L898-903) is case-sensitive and T2.S2 owns the case-insensitivity fix — is
explicitly documented, with the directive to test using `'loud'` (out-of-vocab) so T2.S1's test is
decoupled from T2.S2's ordering. hack-config.ts already imports from `./constants.js` (L11), so the
`REASONING_LEVELS` import is a one-key extension. S1's `REASONING_LEVELS` + env-name constants + defaults
are Complete and verified. The test patterns (TOML seeding at L231, validation-error via
`expect(...).toThrow`) are established in the file. No external/runtime unknowns; even the Level-3 smoke
(seed from a real `.hack` tmpdir) is deterministic.