# PRP — P1.M1.T4.S2: Verify `hack config show --src` surfaces each role's resolved reasoning level + source layer

> Plan 013, PRD §9.2.9 (Per-Role Reasoning Level) → **acceptance criterion**: *"`hack config show
> --src` reports each role's resolved reasoning level together with its winning source layer."*
> Architecture spec: `plan/013_3f31aa2b81b7/architecture/integration-points.md §F` ("AUTO-DERIVED …
> verify only").
>
> **This is a TDD verification task — the test IS the work.** No production code change is expected.
> `ConfigCommand.#showAction` already iterates ALL `SCHEMA_MAP` entries and resolves value + winning
> source via `#resolveEntry`; once T2.S1 added the five `[reasoning]` SCHEMA_MAP entries, the
> reasoning rows surface with source attribution (`default` / file tier / `env`) for **free**. This
> subtask verifies that derivation with a precise test asserting **value + source** per key across the
> three §9.2.1 precedence layers. (Derivation already confirmed working today — see research §1.)

---

## Goal

**Feature Goal**: Add a focused test to `tests/unit/cli/commands/config.test.ts` that proves
`hack config show --src` reports **each of the 5 `[reasoning]` keys** with (a) its **resolved
value** and (b) its **winning source layer** — exercising the three precedence cases: schema
default (`'default'`), `.hack` file value (`'project'`), and shell env over file (`'env'`). Extend
the file's `beforeEach` to clear the five `PRP_REASONING_*` env vars for determinism (same pattern
as the existing `RESEARCH_DEPTH`/`PARALLEL_RESEARCH` clearing).

**Deliverable**:
1. **`tests/unit/cli/commands/config.test.ts`** — (a) extend `beforeEach` to `delete process.env` for
   the five `PRP_REASONING_*` vars (`PRP_REASONING_AGENT`, `_BREAKDOWN_AGENT`, `_BUG_FINDER_AGENT`,
   `_VALIDATION_AGENT`, `_IMPL_AGENT`); (b) ADD a new `describe('show --src: [reasoning] value +
   source (§9.2.9 acceptance)')` block inside the existing `show` describe with **3 tests** (all
   defaults; `.hack` sets a value; env wins over `.hack`). Each test uses JSON output
   (`-o json --src`), parses the array, locates the reasoning rows by `key`, and asserts the exact
   `value` **and** `source`.

**Success Definition**:
- `npx vitest run tests/unit/cli/commands/config.test.ts` is fully GREEN (all 44+ existing tests
  plus the new ones).
- The new tests assert, for every one of the 5 `[reasoning]` keys, both the resolved value and the
  source label — across `default` / `project` / `env` precedence — proving the §9.2.9 acceptance
  criterion holds via the auto-derived `--src` report.
- `npm run typecheck` exit 0; `npm run lint` clean; `npm run format:check` clean.
- **No production file is modified.** `src/cli/commands/config.ts` is UNCHANGED. If any reasoning
  key does NOT surface, the fix belongs in `SCHEMA_MAP`/T2.S1 (`hack-config.ts`), NOT in
  `#showAction` (§F: "AUTO-DERIVED … verify only").

## User Persona

N/A — internal verification of an operator-facing debugging surface (`hack config show --src`, PRD
§9.7.8). Indirect beneficiaries: pipeline operators who, with the rest of P1.M1, can run
`hack config show --src` to see each role's resolved reasoning level *and where it came from*
(default vs. `.hack` vs. shell env) — the primary debugging aid for the §9.2.9 feature.

## Why

- **Closes the §9.2.9 acceptance criterion that is *explicitly* about `show --src`.** §9.2.9 lists
  six acceptance criteria; five are runtime/validation concerns owned by T1–T3 and the T4.S1
  startup gate. The *last* criterion — *"hack config show --src reports each role's resolved
  reasoning level together with its winning source layer"* — is a **config-surfacing** concern
  owned by THIS task. It can only be closed by a test that exercises `--src` on the real reasoning
  keys and asserts both axes.
- **Locks in the auto-derivation against regression.** §F marks `--src` as AUTO-DERIVED (no
  `#showAction` edit). That elegance is also a fragility: a future change to `SCHEMA_MAP` or
  `#resolveEntry` could silently drop a reasoning row or mis-attribute its source, and the *existing*
  weak test (key-name presence only) would still pass. A test asserting **value + source per key per
  tier** is the only thing that catches that.
- **Zero production risk.** Verification-only; the derivation already works (research §1 confirmed
  both reasoning tests pass today). The work is a test file edit + a `beforeEach` env-clear addition.

## What

### User-visible behavior
Unchanged. `hack config show --src` already (today) prints the five reasoning rows with value +
source. This task adds the regression test that *guarantees* it.

### Technical requirements (exact contract)

**`beforeEach` extension** — add the five reasoning env-var deletions alongside the existing three
(file: `tests/unit/cli/commands/config.test.ts`, the `beforeEach` that already deletes
`RESEARCH_DEPTH` / `RESEARCH_QUEUE_CONCURRENCY` / `PARALLEL_RESEARCH`). Same rationale (the adjacent
comment: *"clear .hack-overlapping env vars so file-only values are observed deterministically"*).
`afterEach` already restores the full original environment, so no matching cleanup is needed.

**New `describe` block** — place inside the existing `describe('show', () => { … })`, e.g. right
after the existing `'reports each [reasoning] row with source attribution via --src (§9.7.5)'` test
(which stays — it documents table-path auto-derivation; the new block is the stronger JSON-based
verification). Three `it(...)` tests:

1. **All defaults** (no `.hack`, no env): `run('show', { output:'json', src:true })`; for each of the
   5 keys assert `value === <default>` and `source === 'default'`. Expected defaults:
   `agent=high`, `breakdown_agent=high`, `bug_finder_agent=high`, `validation_agent=high`,
   `impl_agent=off`.
2. **`.hack` sets one value** (per-key independence + project-tier attribution): write `.hack` with
   `[reasoning] impl_agent = "high"`; assert `reasoning.impl_agent` → `value:'high'`,
   `source:'project'`; AND assert the other four reasoning keys still resolve to their defaults with
   `source:'default'` (proves a file value for one role does not perturb the others).
3. **Env wins over `.hack`** (env-over-file, §9.2.1): write `.hack` with `[reasoning] agent = "medium"`
   AND `process.env.PRP_REASONING_AGENT = 'low'` set before `run(...)`; assert `reasoning.agent` →
   `value:'low'`, `source:'env'`. (Optional: assert a `.hack`-only key, e.g. one set in the file with
   no env counterpart, resolves to `source:'project'`.)

All three use the **JSON output** surface (`{ output:'json', src:true }` → array of
`{ key, value, source }`), find rows by `key`, and assert `value` + `source` exactly — never
substring-match the table grid (where `'default'`/`'project'` can collide with unrelated text).

### Success Criteria
- [ ] `beforeEach` deletes the five `PRP_REASONING_*` env vars (determinism; matches existing pattern).
- [ ] New `describe` block with 3 tests added inside the existing `show` describe.
- [ ] Test 1 (defaults): all 5 reasoning keys → `value` = §9.2.9 default, `source` = `'default'`.
- [ ] Test 2 (`.hack`): the set key → `value` = file value, `source` = `'project'`; the other four →
      their defaults + `'default'`.
- [ ] Test 3 (env over `.hack`): the env-set key → `value` = env value, `source` = `'env'`.
- [ ] Every assertion targets the **JSON** `{key,value,source}` row (not table substrings).
- [ ] `npx vitest run tests/unit/cli/commands/config.test.ts` GREEN (existing + new).
- [ ] `npm run typecheck` exit 0; `npm run lint` + `npm run format:check` clean.
- [ ] NO production file modified (`src/cli/commands/config.ts` byte-identical; verified via git diff).

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_ **Yes.** The
exact file to edit, the exact `beforeEach` lines to mirror, the exact `run()` helper signature, the
exact JSON row shape, the exact `#resolveEntry` precedence (research §3), the exact 5 keys + envVars
+ defaults (research §4), the three precedence cases with copy-ready assertions (research §7), the
verified facts (derivation works today; dev shell has no reasoning env set), and the verified
validation commands are all below.

### Documentation & References
```yaml
# AUTHORITATIVE SPEC — pins this task as AUTO-DERIVED / verify-only
- docfile: plan/013_3f31aa2b81b7/architecture/integration-points.md
  section: "F. src/config/hack-config.ts" → bullet "AUTO-DERIVED (no edit needed — verify only)" →
        "hack config show --src — #showAction … iterates SCHEMA_MAP … reasoning rows appear
        automatically with winning layer."
  why: Establishes that this task writes a TEST, not config.ts code. If derivation fails, fix SCHEMA_MAP.
  critical: Do NOT hand-special-case #showAction for reasoning — it is intentionally generic.

# PRD — the exact acceptance criterion this task closes
- docfile: PRD.md   # (provided in selected_prd_content §9.2.9)
  section: §9.2.9 "Per-Role Reasoning Level" → final acceptance criterion: "hack config show --src
        reports each role's resolved reasoning level together with its winning source layer."
        + §9.2.1 precedence (env > global > project > project-local > default) + §9.7.8/§9.7.10 show.
  why: Defines what the test must assert (value + source per role) and the source-layer vocabulary.

# EDIT TARGET — the test file being extended (read it first)
- file: tests/unit/cli/commands/config.test.ts
  section: beforeEach (≈L80-100, the env-clear block) + describe('show') (≈L170-290) + the
        existing 'reports each [reasoning] row with source attribution via --src (§9.7.5)' test
  why: Extend beforeEach (add 5 PRP_REASONING_* deletes); add the new describe block alongside the
        existing weak reasoning test. The run() helper + JSON-parse pattern are reused verbatim.
  pattern: mirror the existing JSON tests verbatim — 'emits valid JSON with --output json',
        'includes Source field in JSON output when --src is set', 'preserves scalar type fidelity'.
  gotcha: process.exit is a no-op in these tests (records exitCalls) → show() returns its stdout;
        run() spies console.log → returns {stdout, stderr}. Use output:'json' for precise asserts.

# THE CODE UNDER TEST (READ-ONLY — verified, do NOT edit)
- file: src/cli/commands/config.ts
  section: #showAction (≈L327-416) iterates SCHEMA_MAP → #resolveEntry; JSON render (≈L383-401)
        emits [{key,value,source?}]; #resolveEntry (≈L419-447) precedence env→file→default.
  why: Confirms the auto-derivation path the test exercises + the exact JSON row shape + the exact
        source labels. The test asserts against THIS contract.
  critical: source labels are exactly 'env'|'global'|'project'|'project-local'|'default' (type
        ShowSource). 'cli' is structurally N/A (show takes no pipeline flags).

# INPUT — the 5 [reasoning] SCHEMA_MAP entries (T2.S1 COMPLETE — verified in source)
- file: src/config/hack-config.ts
  section: SCHEMA_MAP :213-256 (section:'reasoning', the 5 entries) + HACK_CONFIG_SCHEMA reasoning
        block :691. envVar/defaults: agent=PRP_REASONING_AGENT/high, breakdown_agent=…/high,
        bug_finder_agent=…/high, validation_agent=…/high, impl_agent=…/off.
  why: The exact keys, envVar names, and defaults the test asserts. Type is 'string' for all 5
        (so coerceEnv passes the env value through unchanged — 'low' stays 'low').

# RESEARCH NOTE (this task) — copy-ready assertions + precedence walkthrough
- docfile: plan/013_3f31aa2b81b7/P1M1T4S2/research/show-src-reasoning.md
  section: "3. #resolveEntry precedence", "7. Three precedence cases", "6. Test harness facts"
  why: The verbatim JSON-find-and-assert pattern, the preEnv timing gotcha, the three cases w/ exact
        expected values, and the run()/beforeEach/afterEach harness facts.

# PARALLEL PREDECESSOR (read as a CONTRACT) — T4.S1 owns src/index.ts + a NEW test file
- docfile: plan/013_3f31aa2b81b7/P1M1T4S1/PRP.md
  section: "Integration Points" / "All Needed Context"
  why: T4.S1 adds validateAllReasoningLevels() to src/index.ts + creates
        tests/unit/config/reasoning-fail-fast.test.ts. It does NOT touch config.ts NOR
        config.test.ts. No file overlap with T4.S2 (this task edits config.test.ts only).
```

### Current Codebase tree (edit surface)

```bash
tests/unit/cli/commands/config.test.ts   # EDIT — beforeEach (+5 env deletes) + new describe block
src/cli/commands/config.ts               # READ-ONLY (#showAction / #resolveEntry / JSON render)
src/config/hack-config.ts                # READ-ONLY (SCHEMA_MAP reasoning entries :213-256)
```

### Desired Codebase tree with files to be changed
```bash
tests/unit/cli/commands/config.test.ts   # EDIT only — no new files, no src/ change
# (nothing else)
```

### Known Gotchas of our codebase & Library Quirks
```ts
// CRITICAL (assert value+source, not key presence): the EXISTING reasoning test only checks the key
//   NAMES appear in stdout — it cannot detect a wrong VALUE or a mis-attributed SOURCE. The new
//   tests MUST assert both axes. Use JSON output + find-by-key + exact equality on value & source.

// CRITICAL (use JSON, not the table grid): cli-table3 renders a grid where 'default'/'project'/'env'
//   are loose substrings that can collide with unrelated text (e.g. a model id, a path). The JSON
//   surface (output:'json', src:true → [{key,value,source}]) gives exact per-row structure. ALWAYS
//   JSON.parse(stdout) and find the row by key, then assert row.value === X && row.source === Y.

// CRITICAL (preEnv snapshot timing): #showAction snapshots which env vars are pre-defined BEFORE
//   loadHackConfig() runs. So to assert the 'env' layer, SET process.env.PRP_REASONING_AGENT BEFORE
//   calling run('show',...). Setting it after run() has no effect (preEnv already snapshotted).

// GOTCHA (env value passes through verbatim): all 5 reasoning keys are type:'string', so
//   #resolveEntry's coerceEnv(raw,'string') returns raw unchanged. PRP_REASONING_AGENT='low' →
//   value:'low' (not coerced/normalized). Assert the EXACT string you set.

// GOTCHA (determinism — clear reasoning env in beforeEach): the dev shell has NO PRP_REASONING_*
//   today, so the defaults test passes as-is — but a contributor shell or CI might. Extend beforeEach
//   to delete the 5 vars (mirror the existing RESEARCH_DEPTH/PARALLEL_RESEARCH deletes). afterEach
//   restores the original env, so no extra cleanup is needed.

// GOTCHA (.hack tier label is 'project', NOT '.hack'): a value set in <repoRoot>/.hack attributes
//   to source 'project'. .hack.local → 'project-local'. The global file → 'global'. Assert 'project'
//   for a .hack value (NOT 'default' and NOT '.hack').

// GOTCHA (impl_agent default is 'off', not 'high'): the only role whose default differs is
//   impl_agent → 'off'. The other four default to 'high'. Get this right in the defaults test.

// GOTCHA (no production change): if a reasoning key does NOT surface, the fix is in SCHEMA_MAP
//   (hack-config.ts, T2.S1 territory) — do NOT hand-special-case #showAction. Verify with a git diff
//   that config.ts is byte-identical before finishing.
```

## Implementation Blueprint

### Data models and structure
N/A — no new data models. The test consumes the existing `{ key, value, source }` JSON row shape
emitted by `#showAction` and asserts against the existing `SCHEMA_MAP` reasoning entries.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT tests/unit/cli/commands/config.test.ts — beforeEach env determinism
  - LOCATE: the beforeEach block that already does `delete process.env.RESEARCH_DEPTH;`
        `delete process.env.RESEARCH_QUEUE_CONCURRENCY;` `delete process.env.PARALLEL_RESEARCH;`
        (with the "Test isolation (Finding F-4)" comment).
  - ADD: delete the five PRP_REASONING_* vars in the same block:
        PRP_REASONING_AGENT, PRP_REASONING_BREAKDOWN_AGENT, PRP_REASONING_BUG_FINDER_AGENT,
        PRP_REASONING_VALIDATION_AGENT, PRP_REASONING_IMPL_AGENT.
  - NAMING: exact env-var names from SCHEMA_MAP (hack-config.ts:213-256) — copy verbatim.
  - DO NOT: alter afterEach (it already restores the full original env); touch other tests.

Task 2: EDIT tests/unit/cli/commands/config.test.ts — new describe block (3 tests)
  - LOCATE: inside describe('show', () => { … }), immediately AFTER the existing test
        'reports each [reasoning] row with source attribution via --src (§9.7.5)'.
  - ADD: describe('show --src: [reasoning] value + source (§9.2.9 acceptance)', () => { … }) with
        3 it() tests (verbatim bodies in "Implementation Patterns" below):
    * 'defaults: all 5 roles resolve to §9.2.9 defaults with source "default"' — no .hack, no env;
          JSON output; for each key assert value+source.
    * '.hack value: the set role attributes source "project"; others stay default (independence)'
          — write .hack [reasoning] impl_agent = "high"; assert impl_agent @ project + the other
          four @ default.
    * 'env over .hack: a pre-defined env var wins with source "env" (§9.2.1)' — write .hack
          [reasoning] agent = "medium"; set process.env.PRP_REASONING_AGENT = 'low' before run();
          assert agent @ env value 'low'.
  - PATTERN: mirror the existing JSON tests verbatim — const {stdout} = await run('show',
        {output:'json', src:true}); const parsed = JSON.parse(stdout); const row = parsed.find(r
        => r.key === 'reasoning.X'); expect(row.value).toBe(...); expect(row.source).toBe(...).
  - DO NOT: assert on table substrings; set env after run(); modify any other describe; delete the
        existing weak reasoning test (keep it — table-path coverage).
```

### Implementation Patterns & Key Details
```ts
// PATTERN: beforeEach extension (add the 5 reasoning vars next to the existing 3 deletes)
delete process.env.RESEARCH_DEPTH;
delete process.env.RESEARCH_QUEUE_CONCURRENCY;
delete process.env.PARALLEL_RESEARCH;
// Per-role reasoning (PRD §9.2.9) — same determinism rationale as above.
delete process.env.PRP_REASONING_AGENT;
delete process.env.PRP_REASONING_BREAKDOWN_AGENT;
delete process.env.PRP_REASONING_BUG_FINDER_AGENT;
delete process.env.PRP_REASONING_VALIDATION_AGENT;
delete process.env.PRP_REASONING_IMPL_AGENT;

// PATTERN: Test 1 — all defaults (no .hack, no env). JSON surface; find-by-key; exact asserts.
it('defaults: all 5 roles resolve to §9.2.9 defaults with source "default"', async () => {
  const { stdout } = await run('show', { output: 'json', src: true });
  const parsed = JSON.parse(stdout) as Array<{ key: string; value: unknown; source?: string }>;
  const expectRow = (key: string, value: string) => {
    const row = parsed.find(r => r.key === key);
    expect(row, `${key} row present`).toBeDefined();
    expect(row!.value).toBe(value);
    expect(row!.source).toBe('default');
  };
  expectRow('reasoning.agent', 'high');
  expectRow('reasoning.breakdown_agent', 'high');
  expectRow('reasoning.bug_finder_agent', 'high');
  expectRow('reasoning.validation_agent', 'high');
  expectRow('reasoning.impl_agent', 'off'); // NOTE: impl default is 'off', not 'high'
});

// PATTERN: Test 2 — .hack sets impl_agent; per-key independence + 'project' attribution.
it('.hack value: the set role attributes source "project"; others stay default (independence)', async () => {
  writeFileSync(join(repoRoot, '.hack'), '[reasoning]\nimpl_agent = "high"\n');
  const { stdout } = await run('show', { output: 'json', src: true });
  const parsed = JSON.parse(stdout) as Array<{ key: string; value: unknown; source?: string }>;
  const get = (key: string) => parsed.find(r => r.key === key)!;
  // The set key: file value 'high' wins over the 'off' default; source is 'project' (the .hack tier).
  expect(get('reasoning.impl_agent').value).toBe('high');
  expect(get('reasoning.impl_agent').source).toBe('project');
  // The other four are NOT in .hack → still their defaults + 'default'.
  expect(get('reasoning.agent').value).toBe('high');
  expect(get('reasoning.agent').source).toBe('default');
  expect(get('reasoning.breakdown_agent').source).toBe('default');
  expect(get('reasoning.bug_finder_agent').source).toBe('default');
  expect(get('reasoning.validation_agent').source).toBe('default');
});

// PATTERN: Test 3 — env over .hack (§9.2.1). Set env BEFORE run() so preEnv captures it.
it('env over .hack: a pre-defined env var wins with source "env" (§9.2.1)', async () => {
  writeFileSync(join(repoRoot, '.hack'), '[reasoning]\nagent = "medium"\n');
  process.env.PRP_REASONING_AGENT = 'low'; // set BEFORE run() — captured by preEnv snapshot
  const { stdout } = await run('show', { output: 'json', src: true });
  const parsed = JSON.parse(stdout) as Array<{ key: string; value: unknown; source?: string }>;
  const agent = parsed.find(r => r.key === 'reasoning.agent')!;
  expect(agent.value).toBe('low');  // env value (string passes through coerceEnv verbatim)
  expect(agent.source).toBe('env'); // env-over-file wins (file said 'medium')
});

// GOTCHA (above): .hack tier label is 'project' — assert 'project', NOT '.hack' or 'default'.
// GOTCHA (above): impl_agent default is 'off' — the only role not defaulting to 'high'.
// GOTCHA (above): set the env var BEFORE run(); #showAction snapshots preEnv at its top.
// GOTCHA (above): type 'string' → coerceEnv returns raw unchanged; assert the exact string you set.
```

### Integration Points
```yaml
TEST FILE (tests/unit/cli/commands/config.test.ts):
  - beforeEach: +5 `delete process.env.PRP_REASONING_*` (determinism; afterEach restores env).
  - describe('show'): +1 new describe block with 3 it() tests (JSON-based value+source asserts).

PRODUCTION (NONE):
  - src/cli/commands/config.ts: UNCHANGED. src/config/hack-config.ts: UNCHANGED.
  - If derivation is broken, fix SCHEMA_MAP (hack-config.ts) — do NOT touch #showAction.

DEPENDS ON (already COMPLETE):
  - T2.S1: the 5 [reasoning] SCHEMA_MAP entries (hack-config.ts:213-256) — VERIFIED present.
  - T2.S2: case-insensitive enum validation + auto-derivation verified — VERIFIED (2 tests pass).

NONE OF: src/cli/commands/config.ts, src/config/*, src/index.ts (T4.S1), src/agents/* (T3),
         tests/unit/config/reasoning-fail-fast.test.ts (T4.S1, NEW separate file), docs/* (P1.M2),
         PRD.md, spec/**, tasks.json, prd_snapshot.md.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
npm run typecheck        # tsc --noEmit -p tsconfig.build.json — exit 0 (test file typechecks)
npm run lint             # eslint . --ext .ts — clean (the edited config.test.ts)
npm run format:check     # prettier --check — clean (run `npm run format` if the new block flags)
# Expected: zero errors. If lint flags unused vars, drop them; if prettier flags, run `npm run format`.
```

### Level 2: Unit Tests (Component Validation)
```bash
# Run JUST the new block first (fast feedback):
npx vitest run tests/unit/cli/commands/config.test.ts -t "§9.2.9 acceptance"
# Expected: 3 tests GREEN (defaults / .hack / env). If a value/source assert fails, re-check:
#   - impl_agent default is 'off' (not 'high'); .hack tier label is 'project' (not '.hack').
#   - the env var was set BEFORE run() (preEnv timing); env value passes through verbatim.

# Then the whole file (no regressions to the 44 existing tests):
npx vitest run tests/unit/cli/commands/config.test.ts
# Expected: GREEN (44 existing + 3 new = 47). If an EXISTING show/env test flips, the beforeEach
#   env-clear addition may have exposed a latent assumption — investigate, do NOT revert the clear.
```

### Level 3: Regression (System Validation)
```bash
# The reasoning getters + .hack schema (T1/T2) must stay green — this task changes nothing they read:
npx vitest run tests/unit/config/constants.test.ts tests/unit/config/hack-config.test.ts
# Expected: GREEN.

# Confirm NO production file was modified (this is a verification-only task):
git status --porcelain src/cli/commands/config.ts src/config/hack-config.ts
# Expected: empty (no output). If anything shows, STOP — re-read §F; the fix belongs in SCHEMA_MAP,
#   not #showAction, and is out of scope for this task (raise it rather than hand-patching config.ts).
git diff --stat -- src/   # Expected: empty.
```

### Level 4: Creative & Domain-Specific Validation
```bash
# Manual end-to-end smoke (optional — the JSON tests in Level 2 are authoritative). Requires a build.
npm run build
node dist/index.js config show --src -o json 2>/dev/null | node -e '
  const rows = JSON.parse(require("fs").readFileSync(0,"utf8"));
  for (const k of ["reasoning.agent","reasoning.breakdown_agent","reasoning.bug_finder_agent",
                   "reasoning.validation_agent","reasoning.impl_agent"]) {
    const r = rows.find(x => x.key === k);
    console.log(`${k.padEnd(32)} value=${r.value} source=${r.source}`);
  }'
# Expected: five lines, each with value (high/high/high/high/off when unconfigured) + source 'default'.
# Try an env override to see the 'env' layer live:
PRP_REASONING_VALIDATION_AGENT=xhigh node dist/index.js config show --src -o json 2>/dev/null | \
  node -e 'const r=JSON.parse(require("fs").readFileSync(0,"utf8")).find(x=>x.key==="reasoning.validation_agent");console.log(r)'
# Expected: { key:'reasoning.validation_agent', value:'xhigh', source:'env' }
```

## Final Validation Checklist

### Technical Validation
- [ ] Level 1–3 pass; `npm run typecheck && npm run lint && npm run format:check` clean.
- [ ] `npx vitest run tests/unit/cli/commands/config.test.ts` GREEN (existing + 3 new).
- [ ] `git status` shows ONLY `tests/unit/cli/commands/config.test.ts` modified; `src/` untouched.

### Feature Validation
- [ ] Defaults test: all 5 reasoning keys → §9.2.9 default (`high/high/high/high/off`), source `'default'`.
- [ ] `.hack` test: the set key → file value + source `'project'`; the other four → defaults + `'default'`.
- [ ] Env-over-`.hack` test: pre-defined env var → env value + source `'env'` (§9.2.1).
- [ ] Every assertion targets a JSON `{key,value,source}` row (find-by-key, exact equality) — not table
      substrings.

### Code Quality Validation
- [ ] `beforeEach` extended with the 5 `PRP_REASONING_*` deletes (mirrors existing env-clear pattern).
- [ ] New `describe` block placed inside the existing `show` describe, alongside (not replacing) the
      weak key-presence test.
- [ ] Test names + comments reference PRD §9.2.9 / the acceptance criterion (self-documenting).
- [ ] No production file modified; no new files; no scope creep into `#showAction` or `SCHEMA_MAP`.

### Documentation & Deployment
- [ ] No docs changes in this task (P1.M2 owns changeset docs; behavior is auto-derived + already
      documented in the code's JSDoc + PRD §9.7.8/§9.7.10).
- [ ] No env-var additions (the `PRP_REASONING_*` vars already exist from T1/T2).

---

## Anti-Patterns to Avoid
- ❌ Don't assert on table-substring output for value/source — the grid's `'default'`/`'project'`/`'env'`
  tokens collide with unrelated text. Use the JSON surface (`-o json --src`) and assert the per-row
  `{value, source}` exactly.
- ❌ Don't only assert key *presence* — that's the existing weak test's job and it cannot catch a wrong
  value or a mis-attributed source. Assert BOTH axes for every one of the 5 keys.
- ❌ Don't set the env var AFTER `run()` — `#showAction` snapshots `preEnv` at its very top (before
  `loadHackConfig` mutates env). Set `process.env.PRP_REASONING_AGENT` BEFORE `run(...)` to exercise
  the `'env'` branch.
- ❌ Don't assert `.hack` → source `'.hack'` or `'default'` — the file tier label is `'project'`.
- ❌ Don't assume all five defaults are `'high'` — `reasoning.impl_agent` defaults to `'off'`.
- ❌ Don't modify `#showAction` to special-case reasoning — §F is explicit it is AUTO-DERIVED and
  verify-only. If a key doesn't surface, the fix is in `SCHEMA_MAP` (T2.S1 territory), not here.
- ❌ Don't delete the existing `'reports each [reasoning] row …'` test — it documents the table-path
  auto-derivation; the new JSON block is additive and strictly stronger on the value/source axes.
- ❌ Don't skip the `beforeEach` env-clear addition — the dev shell is clean today, but CI / a
  contributor shell may not be; determinism is required (same rationale as the existing clears).
- ❌ Don't widen scope — T4.S2 edits ONLY `tests/unit/cli/commands/config.test.ts`. No `src/`, no
  `tests/unit/config/reasoning-fail-fast.test.ts` (T4.S1's file), no docs (P1.M2).

---

## Confidence Score
**9.5 / 10** — one-pass success. The derivation already works today (research §1: both reasoning tests
pass; the 5 SCHEMA_MAP entries are verified present). The work is a pure test addition: a 5-line
`beforeEach` extension (mirroring an existing, commented pattern) + a 3-test `describe` block using a
proven JSON-find-and-assert pattern already used 4× elsewhere in the same file. The only non-obvious
traps — `.hack` tier label is `'project'`, `impl_agent` default is `'off'`, env must be set before
`run()` (preEnv timing), and use-JSON-not-the-table — are all spelled out with copy-ready assertions.
Residual risk is trivial: a prettier nit on the new block (`npm run format` fixes it) and the
possibility that the `beforeEach` env-clear exposes a latent assumption in an *existing* test (which
would itself be a real bug worth surfacing, not a reason to revert).