# PRP — P1.M1.T1.S2: Two new `[pipeline]` keys in `SCHEMA_MAP` + `HACK_CONFIG_SCHEMA`

> PRD §9.7.5 schema wiring for the §5.1 commit-message **style layer**. S1 (parallel) adds the
> `PRP_COMMIT_STYLE` / `PRP_COMMIT_STYLE_EXAMPLES` constants + getters to `constants.ts` + `.env.example`.
> **S2 wires the two corresponding `.hack` keys** (`[pipeline] commit_style`, `[pipeline] commit_style_examples`)
> into the config schema in `src/config/hack-config.ts` so the TOML loader seeds their env vars and
> `hack config show` auto-displays them. Purely additive. The prompt builder (T3) + generateCommitMessage
> wiring (T4) are separate subtasks.

---

## Goal

**Feature Goal**: Add two `[pipeline]` entries to `SCHEMA_MAP` (immediately after `commit_format`) and
two fields to the `pipeline` section of `HACK_CONFIG_SCHEMA` in `src/config/hack-config.ts`, enabling
`.hack` TOML loading (`commit_style` / `commit_style_examples` seed `PRP_COMMIT_STYLE` /
`PRP_COMMIT_STYLE_EXAMPLES` into `process.env` via the derived `HACK_KEY_TO_ENV`) and `hack config show`
auto-display. `HACK_KEY_TO_ENV` is derived from `SCHEMA_MAP` — no manual edit.

**Deliverable**:
1. **`src/config/hack-config.ts`** — add 2 `SCHEMA_MAP` entries (after the `commit_format` entry, ~L269)
   + 2 `HACK_CONFIG_SCHEMA` `pipeline` fields (after `commit_format`, ~L632).
2. **`tests/unit/config/hack-config.test.ts`** — append a focused `describe` block proving the entries
   exist, the loader seeds the env vars from TOML, the enum validation rejects invalid values, and
   `hack config show` includes the new rows.

**Success Definition**:
- `SCHEMA_MAP` contains `pipeline.commit_style` (envVar `PRP_COMMIT_STYLE`, type `string`, default `auto`,
  acceptedValues `['auto','plain','conventional','gitmoji']`) and `pipeline.commit_style_examples`
  (envVar `PRP_COMMIT_STYLE_EXAMPLES`, type `int`, default `5`).
- `HACK_CONFIG_SCHEMA.pipeline` contains `commit_style: { type:'string', enum:[...] }` and
  `commit_style_examples: { type:'int', min:0 }`.
- `HACK_KEY_TO_ENV` auto-includes both (derived — no manual edit); the loader seeds
  `process.env.PRP_COMMIT_STYLE` / `process.env.PRP_COMMIT_STYLE_EXAMPLES` from `.hack` TOML.
- A `.hack` with `[pipeline] commit_style = "bogus"` → enum validation error (known key, invalid value).
- `hack config show` displays the two new rows.
- Existing parse/seed/validate/show tests stay GREEN (purely additive — no count/snapshot assertions break).
- `npm run typecheck && npm run lint && npm run format:check` clean.

---

## Why

- **Completes the §9.7.5 schema for the style layer.** Without these two `.hack` keys, a project cannot
  set `commit_style` / `commit_style_examples` from its `.hack` file — only via env vars (which S1
  documented). S2 makes the keys first-class `.hack` citizens (TOML → env seeding), consistent with the
  exhaustive §9.7.5 table (which already lists both rows).
- **Purely additive + low-risk.** `HACK_KEY_TO_ENV` is derived (`Object.fromEntries(SCHEMA_MAP.filter(...))`),
  so the two entries auto-flow into the loader's env-seeding map. The show command auto-discovers from
  `SCHEMA_MAP`. No existing test asserts a schema count or a snapshot (verified — iterate-based tests
  auto-accommodate the 2 new entries).
- **Mirrors a proven entry.** `commit_format` (SCHEMA_MAP L262-269 + SCHEMA L632) is the exact template;
  `issue_retry_max` (int, min 0) is the template for `commit_style_examples`'s range.
- **Scope discipline.** S2 = the 2 SCHEMA_MAP entries + 2 SCHEMA fields + a focused test block. S1 owns
  constants.ts + .env.example (S2 consumes only the env-var name strings). T3 (prompt builder) + T4
  (generateCommitMessage wiring) consume the getters, not the schema directly.

---

## What

### User-visible behavior
A project can now set commit-message style via `.hack`:
```toml
[pipeline]
commit_style = "conventional"      # auto|plain|conventional|gitmoji (default auto)
commit_style_examples = 5          # int ≥ 0 (default 5; 0 disables learning under auto)
```
`hack config show` lists both keys. (The style actually takes effect once T3/T4 wire the consumers.)

### Technical requirements (exact contract)

**Edit A — `src/config/hack-config.ts` `SCHEMA_MAP`** (insert immediately AFTER the `commit_format`
entry, which ends at ~L269, BEFORE the blank line + `// --- [commit] (§5.1) ---` comment at ~L271):
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
(`commit_style_examples` has NO `acceptedValues` — it's a range int (min 0), mirroring `issue_retry_max`.
Do NOT add an `acceptedValues` array to it.)

**Edit B — `src/config/hack-config.ts` `HACK_CONFIG_SCHEMA`** (add two fields to the `pipeline` section,
immediately AFTER `commit_format: { type: 'string', enum: ['task-prefix', 'plain'] },` at ~L632):
```ts
  commit_style: { type: 'string', enum: ['auto', 'plain', 'conventional', 'gitmoji'] },
  commit_style_examples: { type: 'int', min: 0 },
```
(`min: 0` mirrors `issue_retry_max`; 0 disables learning per PRD §5.1, consistent with S1's allow-0 getter.)

**`HACK_KEY_TO_ENV`** (~L523): **DO NOT EDIT** — it's `Object.fromEntries(SCHEMA_MAP.filter(e => e.envVar !== undefined)…)`,
so the two new entries auto-add `pipeline.commit_style → PRP_COMMIT_STYLE` and
`pipeline.commit_style_examples → PRP_COMMIT_STYLE_EXAMPLES`. The loader (L578) then seeds `process.env`
from `.hack` TOML via this map.

### Success Criteria
- [ ] `SCHEMA_MAP` contains the two new entries with the exact shapes above (findable by `section+key`).
- [ ] `HACK_CONFIG_SCHEMA.pipeline` contains the two new field specs.
- [ ] `HACK_KEY_TO_ENV` auto-includes both (derived — verified by reading, not editing).
- [ ] `.hack` `[pipeline] commit_style = "conventional"` → loader seeds `process.env.PRP_COMMIT_STYLE === 'conventional'`.
- [ ] `.hack` `[pipeline] commit_style_examples = 3` → seeds `process.env.PRP_COMMIT_STYLE_EXAMPLES === '3'` (stringified int).
- [ ] `.hack` `[pipeline] commit_style = "bogus"` → enum validation error.
- [ ] `hack config show` includes both new rows.
- [ ] `npm run typecheck && npm run lint && npm run format:check` clean; existing hack-config tests stay green.

---

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed to implement
this successfully?_ **Yes** — the verbatim entries (from the architecture doc), the exact insertion
sites (with line numbers), the confirmed entry/field-spec shapes, the derived-HACK_KEY_TO_ENV fact
(no manual edit), the no-test-breakage verification, the loader int-stringify precedent, and the
executable validation commands are all below.

### Documentation & References

```yaml
# MUST READ — verbatim entries + the derived-map note
- docfile: plan/012_7dd502f7feb9/architecture/implementation-status.md
  section: "F1.B — .hack schema (src/config/hack-config.ts)"
  why: Gives the verbatim SCHEMA_MAP entries + HACK_CONFIG_SCHEMA fields + the explicit
        "HACK_KEY_TO_ENV is derived via Object.fromEntries — NO manual edit needed" note.

# MUST READ — entry shapes + insertion sites + no-test-breakage + loader precedent
- docfile: plan/012_7dd502f7feb9/P1M1T1S2/research/schema-wiring-design.md
  section: "2. The three structures" and "3. CONFIRMED — no test breakage"
  why: The HackConfigSchemaEntry interface (L143-158), the commit_format entry to mirror (L262-269),
        the HACK_CONFIG_SCHEMA pipeline section (L627-633), the derived HACK_KEY_TO_ENV (L523), and
        the survey proving no count/snapshot assertion breaks.

# PATTERN FILE 1 — the only source file edited
- file: src/config/hack-config.ts
  why: SCHEMA_MAP (L189) + the commit_format entry (L262-269) to insert after; HACK_CONFIG_SCHEMA (L617)
        + the pipeline section (L627-633) to extend; HACK_KEY_TO_ENV (L523) is DERIVED (don't touch).
  pattern: "{ section:'pipeline', key:'commit_format', envVar:'PRP_COMMIT_FORMAT', type:'string', defaultValue:'task-prefix', acceptedValues:[...] }"
  gotcha: commit_style_examples is a range int (min 0) — NO acceptedValues (mirror issue_retry_max, NOT
        commit_format). HACK_KEY_TO_ENV auto-derives — never edit it manually.

# PATTERN FILE 2 — the test file to extend
- file: tests/unit/config/hack-config.test.ts
  why: The natural home — it tests SCHEMA_MAP, TOML parsing, env-seeding, validation, and show output.
        Mirror its existing patterns: vi.mock fs / writeFileSync(.hack) / read config / assert process.env
        seeded / assert validation errors. The "unknown/invalid key" test (reseaerch_depth) shows the
        validation-error pattern.
  pattern: "writeFileSync(join(repoRoot,'.hack'), '[pipeline]\\ncommit_style = \"conventional\"\\n'); const cfg = loadHackConfig(...); expect(process.env.PRP_COMMIT_STYLE).toBe('conventional');"
  gotcha: Restore process.env in afterEach (delete the seeded vars) so tests don't leak. The validation
        test for an enum-invalid value (commit_style='bogus') is a KNOWN-key/INVALID-value case (the enum
        check in HACK_CONFIG_SCHEMA fires), distinct from the UNKNOWN-key (misspelled) warning.

# VERIFIED FACTS
- fact: "HACK_KEY_TO_ENV (L523) = Object.fromEntries(SCHEMA_MAP.filter(e => e.envVar !== undefined).map(...)) — DERIVED. Adding entries to SCHEMA_MAP auto-adds them. NEVER edit HACK_KEY_TO_ENV manually."
- fact: "The loader (L578: const envName = HACK_KEY_TO_ENV[`${section}.${key}`]) already stringifies int values for process.env (research_depth/issue_retry_max precedent) — commit_style_examples (int) seeds as '5'."
- fact: "No test asserts SCHEMA_MAP length or a show-output snapshot. Tests iterate SCHEMA_MAP (acceptance crit 3, L386) or check specific keys — all stay green with 2 more entries."
- fact: "HackConfigFieldSpec = { type: 'string'|'int'|'boolean', min?, max?, enum? } — commit_style uses enum; commit_style_examples uses min."
```

### Current Codebase tree (relevant slice)

```bash
src/config/hack-config.ts                 # EDIT — 2 SCHEMA_MAP entries + 2 HACK_CONFIG_SCHEMA pipeline fields
tests/unit/config/hack-config.test.ts     # EDIT — append a focused describe block
src/config/constants.ts                   # READ-ONLY (S1 owns — S2 consumes only the env-var name strings)
.env.example                              # READ-ONLY (S1 owns the commit-style subsection)
```

### Desired Codebase tree with files to be added/edited

```bash
src/config/hack-config.ts                 # MODIFIED (4 small additions: 2 map entries + 2 schema fields)
tests/unit/config/hack-config.test.ts     # MODIFIED (append one describe block)
# No new files. No constants.ts / .env.example edits (S1). No docs (auto-discovered).
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — HACK_KEY_TO_ENV (L523) is DERIVED via Object.fromEntries(SCHEMA_MAP.filter(...)). Adding
//   the two SCHEMA_MAP entries AUTO-includes them in HACK_KEY_TO_ENV. NEVER edit HACK_KEY_TO_ENV manually.

// CRITICAL — commit_style_examples is a RANGE INT (min 0), NOT an enum. Give it { type:'int', defaultValue:5 }
//   in SCHEMA_MAP (NO acceptedValues) and { type:'int', min:0 } in HACK_CONFIG_SCHEMA. Mirror issue_retry_max,
//   NOT commit_format (which is an enum string).

// CRITICAL — min:0 (not min:1) for commit_style_examples. 0 disables style learning under auto (PRD §5.1),
//   consistent with S1's allow-0 getter (guard is `< 0`, not `<= 0`). Mirror issue_retry_max's min:0.

// GOTCHA — insert the SCHEMA_MAP entries IMMEDIATELY AFTER the commit_format entry (ends ~L269), BEFORE the
//   `// --- [commit] (§5.1) ---` comment. Keep them in the [pipeline] block (same section as commit_format).

// GOTCHA — the loader already stringifies int TOML values for process.env (research_depth precedent), so
//   commit_style_examples = 5 seeds process.env.PRP_COMMIT_STYLE_EXAMPLES = '5' (string). getPrpCommitStyleExamples()
//   does Number(...) on it. No loader change needed.

// GOTCHA — S2 consumes ONLY the env-var name strings (PRP_COMMIT_STYLE, PRP_COMMIT_STYLE_EXAMPLES) from S1.
//   Do NOT import the getters (the loader seeds process.env; the getters read it elsewhere). Do NOT touch
//   constants.ts or .env.example (S1 owns them).

// GOTCHA — tests must clean up seeded process.env vars in afterEach (delete process.env.PRP_COMMIT_STYLE etc.)
//   so they don't leak across the file's other tests.

// GOTCHA — the enum-validation test (commit_style='bogus') is a KNOWN-key/INVALID-value case. It must fire
//   the enum check (HACK_CONFIG_SCHEMA), NOT the "unknown key" warning (which is for misspelled/absent keys).
//   Confirm the existing validation path distinguishes these (the reseaerch_depth test is the unknown-key case).

// GOTCHA — vitest.config.ts enforces 100% coverage on src/**/*.ts. The new SCHEMA_MAP/SCHEMA lines are data
//   literals (covered by any test that reads them — e.g. the show --src acceptance test iterates SCHEMA_MAP).
//   hack-config.ts is already heavily covered; the 4 new literal lines are covered by the existing + new tests.

// GOTCHA — prettier is ERROR-enforced. Run `npm run fix` before format:check.

// GOTCHA — do NOT run the full `npm run test:run` as the S2 gate. Use the targeted hack-config suites.
```

---

## Implementation Blueprint

### Data models and structure
None new — S2 adds entries to two existing data structures (`SCHEMA_MAP` array + `HACK_CONFIG_SCHEMA`
record). The entry/field-spec shapes (`HackConfigSchemaEntry` L143-158, `HackConfigFieldSpec`) already
exist and accept the new values verbatim.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT src/config/hack-config.ts — add the 2 SCHEMA_MAP entries
  - INSERT (immediately after the commit_format entry, ~L269, before the `// --- [commit] ---` comment):
        the commit_style entry (string enum) + the commit_style_examples entry (int, default 5, NO
        acceptedValues), per Edit A (verbatim from implementation-status §F1.B).
  - DO NOT: edit HACK_KEY_TO_ENV (derived), add acceptedValues to commit_style_examples, touch any
        existing entry, or modify the HackConfigSchemaEntry interface.
  - EXPECTED: typecheck clean (the entries match HackConfigSchemaEntry). HACK_KEY_TO_ENV auto-includes both.

Task 2: EDIT src/config/hack-config.ts — add the 2 HACK_CONFIG_SCHEMA pipeline fields
  - INSERT (in the pipeline section, immediately after `commit_format: { type:'string', enum:[...] },`
        at ~L632): `commit_style: { type:'string', enum:['auto','plain','conventional','gitmoji'] },`
        and `commit_style_examples: { type:'int', min:0 },` per Edit B.
  - DO NOT: add a min to commit_style (it's an enum, not a range) or an enum to commit_style_examples
        (it's a range int).
  - EXPECTED: typecheck clean. The enum check now validates commit_style; the min-0 check validates
        commit_style_examples.

Task 3: EDIT tests/unit/config/hack-config.test.ts — append a focused describe block
  - IMPORT SCHEMA_MAP (already imported L38) + any helpers the file uses for TOML parse / show.
  - describe('commit_style / commit_style_examples schema wiring') cases:
      1. SCHEMA_MAP find by section+key: assert pipeline.commit_style entry has envVar 'PRP_COMMIT_STYLE',
         type 'string', defaultValue 'auto', acceptedValues ['auto','plain','conventional','gitmoji'].
         Assert pipeline.commit_style_examples has envVar 'PRP_COMMIT_STYLE_EXAMPLES', type 'int',
         defaultValue 5, NO acceptedValues.
      2. TOML seed: writeFileSync(.hack, '[pipeline]\ncommit_style = "conventional"\n') → loadHackConfig
         (or the file's existing load helper) → assert process.env.PRP_COMMIT_STYLE === 'conventional'.
      3. TOML seed (int): '[pipeline]\ncommit_style_examples = 3\n' → assert process.env.PRP_COMMIT_STYLE_EXAMPLES === '3'.
      4. Enum validation: '[pipeline]\ncommit_style = "bogus"\n' → the load/validation throws or reports
         an enum error (mirror the file's existing invalid-value validation test pattern). Assert the error
         names commit_style + the valid values.
      5. (Optional) HACK_KEY_TO_ENV contains the two mappings: HACK_KEY_TO_ENV['pipeline.commit_style']
         === 'PRP_COMMIT_STYLE' and ['pipeline.commit_style_examples'] === 'PRP_COMMIT_STYLE_EXAMPLES'
         (proves the derivation picked them up — import HACK_KEY_TO_ENV if exported, else assert via the
         seeding test above).
  - afterEach: delete process.env.PRP_COMMIT_STYLE + process.env.PRP_COMMIT_STYLE_EXAMPLES (prevent leak).
  - NAMING: it('seeds PRP_COMMIT_STYLE from [pipeline] commit_style'), it('seeds PRP_COMMIT_STYLE_EXAMPLES
        from [pipeline] commit_style_examples (stringified int)'), it('rejects an invalid commit_style enum
        value'), it('includes commit_style + commit_style_examples in SCHEMA_MAP with the correct shape').
  - PLACEMENT: append the describe block at the end of the existing file.

Task 4: FORMAT + VERIFY
  - RUN: npm run fix → npm run typecheck → npm run lint → npm run format:check.
  - RUN: npx vitest run tests/unit/config/hack-config.test.ts (S2 additions + regression).
  - RUN: npx vitest run tests/integration/config/hack-config-acceptance.test.ts (the show --src iterate
        test stays green; the 2 new keys now render).
  - EXPECTED: all clean. If a test fails on the new keys not appearing in show output, confirm the show
        command reads SCHEMA_MAP (it does — auto-discovery). If the enum-validation test doesn't fire,
        confirm HACK_CONFIG_SCHEMA (not just SCHEMA_MAP) got the commit_style enum field (Task 2).
```

### Implementation Patterns & Key Details

```ts
// ---- src/config/hack-config.ts: SCHEMA_MAP (insert after commit_format entry, ~L269) ----
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
// (NO acceptedValues on commit_style_examples — it's a range int. HACK_KEY_TO_ENV auto-derives both.)

// ---- src/config/hack-config.ts: HACK_CONFIG_SCHEMA.pipeline (insert after commit_format, ~L632) ----
  commit_style: { type: 'string', enum: ['auto', 'plain', 'conventional', 'gitmoji'] },
  commit_style_examples: { type: 'int', min: 0 },

// ---- tests/unit/config/hack-config.test.ts: the seeding proof ----
it('seeds PRP_COMMIT_STYLE from [pipeline] commit_style', () => {
  writeFileSync(join(repoRoot, '.hack'), '[pipeline]\ncommit_style = "conventional"\n');
  loadHackConfig(/* … per the file's existing pattern … */);
  expect(process.env.PRP_COMMIT_STYLE).toBe('conventional');
});
// afterEach: delete process.env.PRP_COMMIT_STYLE; delete process.env.PRP_COMMIT_STYLE_EXAMPLES;
```

### Integration Points

```yaml
DOWNSTREAM (S2 ENABLES these — separate subtasks, do NOT do them here):
  - P1.M1.T3.S1 (prompt builder): buildCommitMessageSystemPrompt consumes getPrpCommitStyle (S1) — which
        reads the process.env var that S2's schema + the loader now seed from .hack.
  - P1.M1.T4.S1 (generateCommitMessage wiring): resolves style + fetches examples; reads the env vars
        seeded via S2's schema when a .hack is present.

NO LOADER/SHOW CHANGES: the loader iterates HACK_KEY_TO_ENV (derived — auto-includes the new keys); the
  show command iterates SCHEMA_MAP (auto-discovers the new rows). Both work unchanged with the 2 new
  entries. No per-key code anywhere.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run fix                  # lint:fix + prettier --write (run first)
npm run typecheck            # tsc --noEmit -p tsconfig.build.json — clean
npm run lint && npm run format:check   # clean
# Expected: clean. typecheck cannot fail on additive data literals (they match the existing shapes); if
# it does, a typo in type/enum — re-check the verbatim entries.
```

### Level 2: Unit Tests (Component Validation)

```bash
# S2's gate — the hack-config suite (additions + regression):
npx vitest run tests/unit/config/hack-config.test.ts
# The iterate-based acceptance test (show --src) stays green with the 2 new keys:
npx vitest run tests/integration/config/hack-config-acceptance.test.ts
# Expected: all green. If the enum-validation test doesn't fire, confirm Task 2 added the commit_style
# enum to HACK_CONFIG_SCHEMA (not just SCHEMA_MAP). If a seeding test fails, confirm HACK_KEY_TO_ENV
# derived the new mapping (it does — Object.fromEntries over SCHEMA_MAP).
# Do NOT run the full `npm run test:run` — orthogonal suite state.
```

### Level 3: Integration Testing (System Validation)

```bash
# Smoke: a .hack with commit_style seeds the env var end-to-end (real fs tmpdir).
npx tsx -e "
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';
const repo = mkdtempSync(join(tmpdir(),'hack-')); writeFileSync(join(repo,'.hack'), '[pipeline]\ncommit_style = \"gitmoji\"\ncommit_style_examples = 7\n');
// Load via the real loader (adjust the import to the file's export) and inspect process.env.
import('./src/config/hack-config.ts').then(m => { /* call the loader with repoRoot=repo */ console.log('style:', process.env.PRP_COMMIT_STYLE, '| examples:', process.env.PRP_COMMIT_STYLE_EXAMPLES); rmSync(repo,{recursive:true,force:true}); });
"
# Expected: style: gitmoji | examples: 7 (the loader seeded both from the .hack TOML).
```

### Level 4: Creative & Domain-Specific Validation

```bash
# No MCP/DB/HTTP surface. Domain checks (record in commit message):
#   - Two new [pipeline] keys wired (commit_style enum; commit_style_examples int min 0).
#   - HACK_KEY_TO_ENV auto-derived (no manual edit); loader seeds process.env from .hack.
#   - hack config show auto-discovers both rows (§9.7.5 table now fully implemented for the style layer).
#   - commit_style_examples min:0 (0 disables learning) — consistent with S1's allow-0 getter + PRD §5.1.
#   - No existing test breaks (purely additive; iterate-based tests auto-accommodate).
#   - constants.ts / .env.example untouched (S1 owns them).
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` clean.
- [ ] `npm run lint && npm run format:check` clean.
- [ ] `npx vitest run tests/unit/config/hack-config.test.ts` green (additions + regression).
- [ ] `npx vitest run tests/integration/config/hack-config-acceptance.test.ts` green (show --src iterate).

### Feature Validation
- [ ] `SCHEMA_MAP` has `pipeline.commit_style` (string enum, default auto) + `pipeline.commit_style_examples` (int, default 5).
- [ ] `HACK_CONFIG_SCHEMA.pipeline` has `commit_style` (enum) + `commit_style_examples` (int min 0).
- [ ] `.hack` `[pipeline] commit_style="conventional"` → seeds `process.env.PRP_COMMIT_STYLE='conventional'`.
- [ ] `.hack` `[pipeline] commit_style="bogus"` → enum validation error.
- [ ] `HACK_KEY_TO_ENV` auto-includes both (derived — not manually edited).

### Code Quality Validation
- [ ] Only `src/config/hack-config.ts` (4 additions) + `tests/unit/config/hack-config.test.ts` (1 block) modified.
- [ ] `HACK_KEY_TO_ENV` NOT manually edited (derived).
- [ ] `commit_style_examples` is a range int (min 0, NO acceptedValues) — mirrors `issue_retry_max`, not `commit_format`.
- [ ] `constants.ts` / `.env.example` UNCHANGED (S1 owns them).
- [ ] New entries mirror the `commit_format` entry's shape exactly (section/key/envVar/type/defaultValue/acceptedValues).

### Documentation & Deployment
- [ ] No docs edits (contract: `hack config show` auto-discovers; `.env.example` is S1's).
- [ ] Commit message notes: 2 [pipeline] keys wired (style layer schema); HACK_KEY_TO_ENV derived; consumers = T3/T4.

---

## Anti-Patterns to Avoid

- ❌ Don't edit `HACK_KEY_TO_ENV` manually — it's `Object.fromEntries(SCHEMA_MAP.filter(...))`; adding the
      SCHEMA_MAP entries auto-derives the mappings.
- ❌ Don't give `commit_style_examples` an `acceptedValues` array — it's a range int (min 0), like
      `issue_retry_max`. Only enum strings get `acceptedValues`.
- ❌ Don't use `min: 1` for `commit_style_examples` — `min: 0` (0 disables learning per §5.1; consistent
      with S1's allow-0 getter).
- ❌ Don't touch `constants.ts` or `.env.example` — S1 owns them; S2 consumes only the env-var name strings.
- ❌ Don't import the S1 getters into hack-config.ts — the loader seeds process.env; the getters read it
      elsewhere (T3/T4). S2 just wires the schema.
- ❌ Don't insert the SCHEMA_MAP entries outside the `[pipeline]` block — they go immediately after
      `commit_format` (same section).
- ❌ Don't add a `min` to `commit_style` (it's an enum) or an `enum` to `commit_style_examples` (it's a range int).
- ❌ Don't skip the enum-validation test — it proves HACK_CONFIG_SCHEMA (not just SCHEMA_MAP) got the field.
- ❌ Don't let seeded process.env vars leak across tests — delete them in afterEach.
- ❌ Don't run the full `npm run test:run` as the gate — use the targeted hack-config suites.

---

## Confidence Score

**9/10** — one-pass implementation success likelihood.

Rationale: This is a tiny, purely-additive wiring task with verbatim entries supplied by the architecture
doc (§F1.B), exact insertion sites verified with line numbers, and the entry/field-spec shapes confirmed
against the live source. The derived-HACK_KEY_TO_ENV fact (no manual edit) and the no-test-breakage survey
(iterate-based tests; no count/snapshot assertions) remove the two plausible failure modes. The loader
already stringifies int values (research_depth precedent), so `commit_style_examples` seeds correctly
without a loader change. The one residual risk — the enum-validation test not firing because HACK_CONFIG_SCHEMA
(rather than just SCHEMA_MAP) must carry the field — is explicitly called out (Task 2 + the test gate). No
external/runtime unknowns.