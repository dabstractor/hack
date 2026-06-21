# PRP — P1.M1.T2.S1: Qualify model defaults with the `zai` provider via `getModel()`

---

## Goal

**Feature Goal**: Make `getModel(tier)` in `src/config/environment.ts` return
**provider-qualified** model strings (`zai/<model>`) instead of bare names, via a single,
exported, idempotent `qualifyModel(name, provider)` helper. This is the single source of
truth for PRD §9.2.3 / §9.4.3 ("Models are specified as provider-qualified strings
`provider/model` … qualified with the `zai` provider"), consumed downstream by every persona
factory (`createBaseConfig` → `createAgent`) and by `src/scripts/validate-api.ts`.

**Deliverable**:

1. **`src/config/environment.ts`** — EDIT (no new file): add `export function qualifyModel(...)`
   and wrap `getModel`'s return through it.
2. **`tests/unit/config/environment.test.ts`** — EDIT: (a) update the existing
   `describe('getModel')` assertions to expect qualified strings; (b) add a new
   `describe('qualifyModel')` covering the env-override-qualification + already-qualified
   idempotency contract.
3. **`tests/unit/agents/agent-factory.test.ts`** — EDIT: one-line fix to the cascading
   `config.model` assertion (`'GLM-4.7'` → `'zai/GLM-4.7'`).

**Success Definition** (the exact contract from the work item):

- `getModel('sonnet') === 'zai/GLM-4.7'`.
- `getModel('haiku') === 'zai/GLM-4.5-Air'`.
- `getModel('opus') === 'zai/GLM-4.7'`.
- Env override is qualified: with `ANTHROPIC_DEFAULT_OPUS_MODEL='custom-opus'`,
  `getModel('opus') === 'zai/custom-opus'`.
- Already-qualified override is NOT double-prefixed: with
  `ANTHROPIC_DEFAULT_OPUS_MODEL='anthropic/foo'`, `getModel('opus') === 'anthropic/foo'`.
- `configureEnvironment()` and `validateEnvironment()` behavior is unchanged.
- `npm run validate` passes (lint + format:check + typecheck).
- `npm run test:run` passes (full suite, no regression — including the two cascade fixes).

---

## Why

- **Provider-qualification is required by Groundswell's `parseModelSpec`** (PRD §9.2.3 /
  §9.4.3, verified in `architecture/external_deps.md` §3). Bare `'GLM-4.7'` is only resolved
  against a defaultProvider if Groundswell is told one; the deterministic, harness-agnostic
  path is to hand it a fully-qualified `zai/GLM-4.7`. Qualifying once, at the `getModel()`
  chokepoint, means **every** consumer (every persona factory, `validate-api.ts`) gets the
  correct string without each one re-implementing the rule.
- **One helper prevents drift** (`architecture/implementation_notes.md` §2). Centralizing the
  `provider + '/' + name` rule in an exported `qualifyModel()` means `getModel()`,
  `MODEL_NAMES`, and `validate-api.ts` can never disagree on the qualification format.
- **Never produce a 3-segment string.** Groundswell `parseModelSpec` THROWS on
  `pi/zai/GLM-4.7` (harness in the model string). The `.includes('/')` guard guarantees
  idempotency so re-qualification (or an already-qualified env override) never yields a
  malformed `zai/zai/...` or `pi/zai/...` string.
- **Unblocks P1.M1.T2.S2** (which updates agent-config `model` field types/JSDoc and wires the
  harness field) — S2 assumes `getModel()` already returns `zai/<model>`.
- **Out of scope (hard boundary):** adding a `harness` field to `AgentConfig` (T2.S2),
  qualifying literals inside `MODEL_NAMES` itself (values stay bare — qualification happens at
  read time), `configureHarnesses()` wiring (T1.S2), provider env-configurability (later),
  docs (M2.T3). `MODEL_NAMES`/`MODEL_ENV_VARS`/`DEFAULT_MODEL_PROVIDER` constants are consumed,
  NOT modified.

---

## What

### User-visible behavior

None at the CLI surface. The only observable effect: `getModel()` (and therefore every
`createBaseConfig(...).model` and the `model` passed to `createAgent`) now reads as
`zai/GLM-4.7` / `zai/GLM-4.5-Air` instead of `GLM-4.7` / `GLM-4.5-Air`. This is the string
Groundswell's `parseModelSpec` consumes to route to the `zai` provider.

### Technical requirements (exact contract)

**Add to `src/config/environment.ts`** (and update its imports + `getModel`):

```ts
// import line becomes (add DEFAULT_MODEL_PROVIDER):
import {
  DEFAULT_BASE_URL,
  DEFAULT_MODEL_PROVIDER,
  MODEL_ENV_VARS,
  MODEL_NAMES,
} from './constants.js';

/**
 * Qualify a bare model name with its provider (PRD §9.2.3 / §9.4.3).
 *
 * Idempotent: if `name` already contains a provider segment (contains '/'),
 * it is returned unchanged. Otherwise the `provider` prefix is prepended
 * (default: DEFAULT_MODEL_PROVIDER === 'zai'). Never produces a 3-segment
 * (harness-qualified) string.
 *
 * @example
 *   qualifyModel('GLM-4.7');            // 'zai/GLM-4.7'
 *   qualifyModel('GLM-4.5-Air');        // 'zai/GLM-4.5-Air'
 *   qualifyModel('anthropic/foo');      // 'anthropic/foo'  (unchanged)
 *   qualifyModel('zai/GLM-4.7');        // 'zai/GLM-4.7'    (unchanged)
 *   qualifyModel('GLM-4.7', 'anthropic'); // 'anthropic/GLM-4.7'
 */
export function qualifyModel(
  name: string,
  provider: string = DEFAULT_MODEL_PROVIDER
): string {
  return name.includes('/') ? name : `${provider}/${name}`;
}

// getModel becomes:
export function getModel(tier: ModelTier): string {
  const envVar = MODEL_ENV_VARS[tier];
  return qualifyModel(process.env[envVar] ?? MODEL_NAMES[tier]);
}
```

`getModel`'s JSDoc `@returns` / `@example` lines that currently show bare `'GLM-4.7'` must be
updated to the qualified form (e.g. `// 'zai/GLM-4.7'`). `configureEnvironment()` and
`validateEnvironment()` are **untouched**.

### Success Criteria

- [ ] `qualifyModel` is exported from `src/config/environment.ts`.
- [ ] `getModel('sonnet') === 'zai/GLM-4.7'`; `getModel('haiku') === 'zai/GLM-4.5-Air'`;
      `getModel('opus') === 'zai/GLM-4.7'` (with env vars unset).
- [ ] With `ANTHROPIC_DEFAULT_OPUS_MODEL='custom-opus'`, `getModel('opus') === 'zai/custom-opus'`.
- [ ] With `ANTHROPIC_DEFAULT_OPUS_MODEL='anthropic/foo'`, `getModel('opus') === 'anthropic/foo'`
      (NOT `zai/anthropic/foo`).
- [ ] `configureEnvironment()` and `validateEnvironment()` source is byte-identical to before.
- [ ] `MODEL_NAMES`, `MODEL_ENV_VARS`, `DEFAULT_MODEL_PROVIDER` constants are unchanged.
- [ ] `npm run validate` exits 0; `npm run test:run` exits 0 (including the two cascade fixes).

---

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed to implement
this successfully?_ **Yes** — every reference is a concrete file path with the exact before/after
diff, the exact assertion lines to change, and a verified external contract
(`parseModelSpec`). The two non-obvious cascades (existing tests that hard-code bare names)
are enumerated line-by-line.

### Documentation & References

```yaml
# MUST READ — the external contract this change serves
- docfile: plan/004_439241a82c24/architecture/external_deps.md
  section: "3. Model-spec helpers (parseModelSpec)"
  why: Proves 'zai/GLM-4.7' parses correctly, bare 'GLM-4.7' is resolved against a
       defaultProvider, and 3-segment 'pi/zai/GLM-4.7' THROWS — justifying the
       `.includes('/')` idempotency guard.
  critical: Never prefix the harness; only the provider. Never produce >2 segments.

# MUST READ — the cascade rules + single-helper rationale
- docfile: plan/004_439241a82c24/architecture/implementation_notes.md
  section: "2. Model string flow (single source of truth)" and "3. Test fragility"
  why: §2 mandates ONE qualifyModel helper; §3 mandates fixing agent-factory.test.ts in the
       SAME subtask as the getModel change (implicit TDD; npm run test:run must stay green).

# THIS subtask's research (cascades + branch coverage + parallel-disjoint proof)
- docfile: plan/004_439241a82c24/P1M1T2S1/research/qualify-model-cascades.md
  section: "2. Cascading test breakages" and "3. Branch-coverage mapping"
  why: Lists the EXACT existing assertions that break and their qualified replacements;
       maps the one ternary branch to the two covering tests.

# PATTERN FILES — copy existing conventions exactly
- file: src/config/environment.ts
  why: The file to EDIT. getModel() currently returns bare process.env[...] ?? MODEL_NAMES[tier].
        Wrap that in qualifyModel(). Import DEFAULT_MODEL_PROVIDER from './constants.js'.
  pattern: "export function getModel(tier: ModelTier): string { const envVar = MODEL_ENV_VARS[tier]; return process.env[envVar] ?? MODEL_NAMES[tier]; }"
  gotcha: Update getModel's JSDoc @example (currently '// GLM-4.7') to '// zai/GLM-4.7'.

- file: src/config/constants.ts
  why: CONFIRMS DEFAULT_MODEL_PROVIDER === 'zai', MODEL_NAMES === { opus:'GLM-4.7',
        sonnet:'GLM-4.7', haiku:'GLM-4.5-Air' }, MODEL_ENV_VARS (all already present from T1.S1).
        DO NOT EDIT — consume only.

- file: tests/unit/config/environment.test.ts
  why: EDIT — the describe('getModel') block hard-codes bare names that break after
        qualification (Cascade A). Update the 6 assertions to qualified values, and append a
        new describe('qualifyModel') for the env-override-qualification + idempotency cases.
  pattern: "delete process.env.ANTHROPIC_DEFAULT_OPUS_MODEL; ... vi.stubEnv('ANTHROPIC_DEFAULT_OPUS_MODEL','...');"
  gotcha: afterEach already calls vi.unstubAllEnvs() (file-local) AND the global setup.ts does
          too — belt-and-suspenders. Prefer the robust form `${DEFAULT_MODEL_PROVIDER}/${MODEL_NAMES.opus}`.

- file: tests/unit/agents/agent-factory.test.ts
  why: EDIT — the "should use GLM-4.7 model for all personas" test asserts config.model === 'GLM-4.7'
        (Cascade B). createBaseConfig() calls getModel('sonnet') which now yields 'zai/GLM-4.7'.
        Change the single literal 'GLM-4.7' → 'zai/GLM-4.7'.
  gotcha: This is the ONLY edit to this file. Do not touch any other assertion.

- file: src/scripts/validate-api.ts
  why: CONSUMER — reads getModel('sonnet') and passes it to createAgent({ model }) / logging.
        Qualification is transparent and correct (zai/GLM-4.7 is exactly what parseModelSpec
        wants). NO edit required. Listed here only so the implementer does not waste time on it.
```

### Current Codebase tree (relevant slice)

```bash
src/config/
├── constants.ts     # CONSUME (DEFAULT_MODEL_PROVIDER, MODEL_NAMES, MODEL_ENV_VARS — all present)
├── environment.ts   # EDIT — +qualifyModel(); wrap getModel()
└── types.ts         # CONSUME (ModelTier) — DO NOT TOUCH
src/scripts/
└── validate-api.ts  # CONSUMER — transparent, NO edit
src/agents/
└── agent-factory.ts # CONSUMER (createBaseConfig → getModel('sonnet')) — NO source edit; only its test changes
tests/unit/config/
└── environment.test.ts   # EDIT — fix getModel assertions (Cascade A) + add describe('qualifyModel')
tests/unit/agents/
└── agent-factory.test.ts # EDIT — one-line fix (Cascade B): 'GLM-4.7' → 'zai/GLM-4.7'
```

### Desired Codebase tree with files to be added/edited

```bash
src/config/environment.ts                 # EDIT (no new files)
tests/unit/config/environment.test.ts     # EDIT (no new files)
tests/unit/agents/agent-factory.test.ts   # EDIT — 1 line
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — Groundswell's parseModelSpec THROWS on 3-segment (harness-qualified) model
// strings (e.g. 'pi/zai/GLM-4.7'). The `.includes('/')` guard makes qualifyModel idempotent
// so we never produce 'zai/zai/GLM-4.7' (re-qualifying) or a harness-prefixed string.
// Source: architecture/external_deps.md §3.

// CRITICAL — qualifyModel's provider default MUST be the DEFAULT_MODEL_PROVIDER constant,
// NOT a bare 'zai' literal. Import it from './constants.js'. This keeps the rule coupled to
// one source (implementation_notes.md §2) and survives a future provider-constant change.

// CRITICAL — two EXISTING test files hard-code bare model names and WILL break the moment
// getModel() returns zai/<name>. Both MUST be fixed in this subtask (implicit TDD; the full
// `npm run test:run` is a validation gate):
//   * tests/unit/config/environment.test.ts  -> describe('getModel') (6 assertions)
//   * tests/unit/agents/agent-factory.test.ts -> 'should use GLM-4.7 model for all personas' (1 line)
// See research/qualify-model-cascades.md §2 for the exact before/after of each.

// GOTCHA — 100% coverage is globally enforced (vitest.config.ts). qualifyModel has exactly ONE
// branch (the ternary). Both sides are covered: false-side by the default-tier getModel tests;
// true-side by the already-qualified ('anthropic/foo') test. Do NOT delete any existing
// environment.test.ts assertion — they all contribute to environment.ts's 100% coverage.

// GOTCHA — prettier is an ERROR (eslint prettier/prettier: error). Run `npm run fix`
// (lint:fix + format) before `npm run validate`. Template literals like `${provider}/${name}`
// are fine; just ensure trailing commas / line-length match the file's existing style.

// GOTCHA — env stubbing: use vi.stubEnv('ANTHROPIC_DEFAULT_OPUS_MODEL', 'custom-opus') to set
// and `delete process.env.ANTHROPIC_DEFAULT_OPUS_MODEL` to clear. Global setup.ts already
// calls vi.unstubAllEnvs() in afterEach; environment.test.ts ALSO calls it in its own
// afterEach — both run (no conflict). No vi.mock needed (pure functions, no Groundswell call).

// CRITICAL — DO NOT modify configureEnvironment() or validateEnvironment() (contract item 3).
// DO NOT modify MODEL_NAMES / MODEL_ENV_VARS / DEFAULT_MODEL_PROVIDER (T1.S1 owns them).
// DO NOT add a harness field to AgentConfig (that is T2.S2).
```

---

## Implementation Blueprint

### Data models and structure

No new data models — this subtask is a single pure function + a one-line wrapper. TypeScript
project (no ORM/Pydantic). The only "model" is the `qualifyModel` signature:

```ts
export function qualifyModel(
  name: string,
  provider: string = DEFAULT_MODEL_PROVIDER
): string;
```

### Implementation Tasks (ordered by dependencies — implicit TDD: RED first, then GREEN)

```yaml
Task 1: EDIT tests/unit/config/environment.test.ts   (RED — add failing assertions for qualification)
  - In describe('getModel'): UPDATE the 3 default-tier assertions to expect qualified values.
      Prefer the robust form so a provider-constant change can't silently break the test:
        expect(getModel('opus')).toBe(`${DEFAULT_MODEL_PROVIDER}/${MODEL_NAMES.opus}`);   // 'zai/GLM-4.7'
        expect(getModel('sonnet')).toBe(`${DEFAULT_MODEL_PROVIDER}/${MODEL_NAMES.sonnet}`);
        expect(getModel('haiku')).toBe(`${DEFAULT_MODEL_PROVIDER}/${MODEL_NAMES.haiku}`); // 'zai/GLM-4.5-Air'
      Import DEFAULT_MODEL_PROVIDER from '../../../src/config/constants.js' (MODEL_NAMES already imported).
  - In describe('getModel'): UPDATE the 3 env-override assertions to expect qualified overrides:
        vi.stubEnv('ANTHROPIC_DEFAULT_OPUS_MODEL','custom-opus-model');
        expect(getModel('opus')).toBe('zai/custom-opus-model');
      (likewise 'zai/custom-sonnet-model', 'zai/custom-haiku-model').
  - ADD describe('qualifyModel') with at least:
      * it('qualifies a bare name with the default provider'): qualifyModel('GLM-4.7') === 'zai/GLM-4.7'.
      * it('does not double-prefix an already-qualified name'): qualifyModel('anthropic/foo') === 'anthropic/foo';
        qualifyModel('zai/GLM-4.7') === 'zai/GLM-4.7'.
      * it('honors an explicit provider argument'): qualifyModel('GLM-4.7','anthropic') === 'anthropic/GLM-4.7'.
      * it('qualifies an env override end-to-end via getModel'):
          vi.stubEnv('ANTHROPIC_DEFAULT_OPUS_MODEL','custom-opus'); expect(getModel('opus')).toBe('zai/custom-opus').
      * it('does not double-prefix an already-qualified env override'):
          vi.stubEnv('ANTHROPIC_DEFAULT_OPUS_MODEL','anthropic/foo'); expect(getModel('opus')).toBe('anthropic/foo').
  - IMPORT qualifyModel from '../../../src/config/environment.js' (does not exist yet → RED on this import).
  - FOLLOW pattern: existing environment.test.ts describe/it, SETUP/EXECUTE/VERIFY comments, ESM .js specifiers.
  - EXPECTED NOW: import of qualifyModel fails + updated getModel assertions fail (still bare) → RED.

Task 2: EDIT tests/unit/agents/agent-factory.test.ts   (RED — Cascade B, one line)
  - In the "should use GLM-4.7 model for all personas" it(): change
        expect(config.model).toBe('GLM-4.7');
    to
        expect(config.model).toBe('zai/GLM-4.7');
  - DO NOT touch any other line in this file.
  - EXPECTED NOW: fails (getModel still returns bare 'GLM-4.7') → RED.

Task 3: EDIT src/config/environment.ts   (GREEN — the helper + the wrapper)
  - IMPORT: add DEFAULT_MODEL_PROVIDER to the existing './constants.js' import
      (alphabetical/consistent with the file: DEFAULT_BASE_URL, DEFAULT_MODEL_PROVIDER, MODEL_ENV_VARS, MODEL_NAMES).
  - ADD: export function qualifyModel(name, provider = DEFAULT_MODEL_PROVIDER) with the
      ternary `return name.includes('/') ? name : \`${provider}/${name}\`;` and the JSDoc above.
  - EDIT getModel: change `return process.env[envVar] ?? MODEL_NAMES[tier];`
      to `return qualifyModel(process.env[envVar] ?? MODEL_NAMES[tier]);`
  - EDIT getModel's JSDoc @example/@returns: bare '// GLM-4.7' → '// zai/GLM-4.7', etc.
  - DO NOT: touch configureEnvironment() or validateEnvironment(); do not reorder existing exports.
  - NAMING: qualifyModel (camelCase, mirrors getModel/configureEnvironment).
  - PLACEMENT: src/config/environment.ts (co-located with getModel — single source of truth).
  - EXPECTED: environment.test.ts + agent-factory.test.ts turn GREEN; 100% coverage of environment.ts retained.

Task 4: FORMAT + VERIFY
  - RUN: `npm run fix` (lint:fix + prettier --write) then `npm run validate` then
      `npm run test:run -- config` then `npm run test:run` (full suite regression).
  - EXPECTED: all green, zero lint/type/format errors, no regression anywhere.
```

### Implementation Patterns & Key Details

```ts
// ---- src/config/environment.ts (EDIT) ----

// 1) import (add DEFAULT_MODEL_PROVIDER):
import {
  DEFAULT_BASE_URL,
  DEFAULT_MODEL_PROVIDER,
  MODEL_ENV_VARS,
  MODEL_NAMES,
} from './constants.js';
import type { ModelTier } from './types.js';
import { EnvironmentValidationError } from './types.js';

// 2) NEW helper (place directly ABOVE getModel for readability):
/**
 * Qualify a bare model name with its provider (PRD §9.2.3 / §9.4.3).
 *
 * Idempotent: a `name` already containing '/' is returned unchanged, so re-qualifying
 * or an already-qualified env override never yields a malformed multi-segment string.
 *
 * @param name - Bare model name (e.g. 'GLM-4.7') OR an already-qualified 'provider/model'.
 * @param provider - Provider prefix; defaults to {@link DEFAULT_MODEL_PROVIDER} ('zai').
 * @returns The qualified 'provider/model' string.
 */
export function qualifyModel(
  name: string,
  provider: string = DEFAULT_MODEL_PROVIDER
): string {
  return name.includes('/') ? name : `${provider}/${name}`;
}

// 3) getModel — wrap the resolved value:
export function getModel(tier: ModelTier): string {
  const envVar = MODEL_ENV_VARS[tier];
  return qualifyModel(process.env[envVar] ?? MODEL_NAMES[tier]);
}
// (also update getModel's JSDoc examples: 'GLM-4.7' → 'zai/GLM-4.7', 'GLM-4.5-Air' → 'zai/GLM-4.5-Air')

// ---- tests/unit/config/environment.test.ts (EDIT — key new/changed assertions) ----
import {
  getModel,
  qualifyModel,
  configureEnvironment,
  validateEnvironment,
} from '../../../src/config/environment.js';
import {
  DEFAULT_BASE_URL,
  DEFAULT_MODEL_PROVIDER,
  MODEL_NAMES,
} from '../../../src/config/constants.js';

describe('getModel', () => {
  it('should return default model for opus tier', () => {
    delete process.env.ANTHROPIC_DEFAULT_OPUS_MODEL;
    expect(getModel('opus')).toBe(
      `${DEFAULT_MODEL_PROVIDER}/${MODEL_NAMES.opus}`
    ); // 'zai/GLM-4.7'
  });
  // ... sonnet → `${DEFAULT_MODEL_PROVIDER}/${MODEL_NAMES.sonnet}`
  // ... haiku → `${DEFAULT_MODEL_PROVIDER}/${MODEL_NAMES.haiku}`  ('zai/GLM-4.5-Air')

  it('should use environment override for opus tier (qualified)', () => {
    vi.stubEnv('ANTHROPIC_DEFAULT_OPUS_MODEL', 'custom-opus-model');
    expect(getModel('opus')).toBe('zai/custom-opus-model'); // CHANGED from 'custom-opus-model'
  });
  // ... sonnet/haiku overrides → 'zai/custom-sonnet-model' / 'zai/custom-haiku-model'
});

describe('qualifyModel', () => {
  it('qualifies a bare name with the default provider', () => {
    expect(qualifyModel('GLM-4.7')).toBe('zai/GLM-4.7');
  });
  it('does not double-prefix an already-qualified name', () => {
    expect(qualifyModel('anthropic/foo')).toBe('anthropic/foo');
    expect(qualifyModel('zai/GLM-4.7')).toBe('zai/GLM-4.7'); // idempotent
  });
  it('honors an explicit provider argument', () => {
    expect(qualifyModel('GLM-4.7', 'anthropic')).toBe('anthropic/GLM-4.7');
  });
  it('qualifies an env override end-to-end via getModel', () => {
    vi.stubEnv('ANTHROPIC_DEFAULT_OPUS_MODEL', 'custom-opus');
    expect(getModel('opus')).toBe('zai/custom-opus');
  });
  it('does not double-prefix an already-qualified env override', () => {
    vi.stubEnv('ANTHROPIC_DEFAULT_OPUS_MODEL', 'anthropic/foo');
    expect(getModel('opus')).toBe('anthropic/foo');
  });
});

// ---- tests/unit/agents/agent-factory.test.ts (EDIT — ONE line) ----
//   expect(config.model).toBe('GLM-4.7');   // BEFORE
//   expect(config.model).toBe('zai/GLM-4.7'); // AFTER
```

### Integration Points

```yaml
ENVIRONMENT.TS (src/config/environment.ts):
  - add import: DEFAULT_MODEL_PROVIDER (to the existing './constants.js' import block)
  - add export: qualifyModel(name, provider = DEFAULT_MODEL_PROVIDER)
  - edit: getModel() return wrapped in qualifyModel(...)
  - edit: getModel JSDoc examples (bare → qualified)
  - preserve: configureEnvironment(), validateEnvironment(), all existing exports/types

DOWNSTREAM CONSUMERS (read-only — NO edit in this subtask):
  - src/agents/agent-factory.ts → createBaseConfig() does getModel('sonnet'); now yields 'zai/GLM-4.7'.
    createAgent receives the qualified string; Groundswell parseModelSpec routes to zai.
  - src/scripts/validate-api.ts → getModel('sonnet') passed to createAgent({ model }) / logging;
    transparent + correct, no change.
  - P1.M1.T2.S2 → will rely on getModel() returning zai/<model> when adding the AgentConfig.model
    JSDoc/types and the harness field.

PARALLEL EXECUTION (vs P1.M1.T1.S2, in-flight):
  - ZERO file overlap (see research/qualify-model-cascades.md §5). T1.S2 edits
    src/config/harness.ts (NEW), src/agents/agent-factory.ts (source), harness-config.test.ts (NEW).
    T2.S1 edits src/config/environment.ts + two test files. Disjoint.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# After editing each file — auto-fix first, then verify.
npm run fix                  # = lint:fix + prettier --write
npm run validate             # = lint && format:check && typecheck   (MUST be green)

# Targeted checks (optional, faster feedback):
npx eslint src/config/environment.ts tests/unit/config/environment.test.ts tests/unit/agents/agent-factory.test.ts
npx tsc --noEmit -p tsconfig.build.json
npx prettier --check src/config/environment.ts tests/unit/config/environment.test.ts tests/unit/agents/agent-factory.test.ts

# Expected: Zero errors. Most likely failure: a prettier nit (re-run `npm run fix`) or a stale
# bare-name string left in getModel's JSDoc (fix to the qualified form).
```

### Level 2: Unit Tests (Component Validation)

```bash
# The directly-affected suites (must pass + keep 100% coverage of environment.ts):
npm run test:run -- config
npm run test:run -- agents/agent-factory

# Equivalent explicit paths:
npx vitest run tests/unit/config/environment.test.ts
npx vitest run tests/unit/agents/agent-factory.test.ts

# Full suite regression (MUST stay green — proves the two cascade fixes + no other regression):
npm run test:run

# Coverage check on the touched source file (vitest.config.ts enforces 100% globally):
npx vitest run tests/unit/config/environment.test.ts --coverage

# Expected: all pass. If environment.ts coverage < 100%, a getModel branch is unexercised —
# the existing describe('getModel') + new describe('qualifyModel') together cover both ternary sides.
```

### Level 3: Integration Testing (System Validation)

```bash
# Prove the qualified string actually flows to createAgent without breaking module load.
# agent-factory.test.ts imports agent-factory.ts (which runs configureEnvironment() at load);
# the "should create multiple agents without MCP server registration conflicts" test exercises
# createArchitectAgent()/createCoderAgent()/etc. with the now-qualified model string:
npx vitest run tests/unit/agents/agent-factory.test.ts

# Build emits dist/ cleanly (proves the edited environment.ts compiles + the JSDoc/types resolve):
npx tsc -p tsconfig.build.json

# Expected: agent-factory.test.ts fully green (incl. the one-line 'zai/GLM-4.7' assertion);
# build succeeds with no errors.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# No MCP/DB/HTTP in this subtask (pure functions; no LLM/network call). Domain-specific
# reasoning (record in commit message):
#   1. qualifyModel is IDEMPOTENT: qualifyModel(qualifyModel('GLM-4.7')) === 'zai/GLM-4.7'
#      (the .includes('/') guard) — protects against future double-wrapping and against
#      already-qualified env overrides producing 'zai/zai/...'.
#   2. Never harness-qualified: only the PROVIDER ('zai') is ever prefixed. The harness
#      ('pi'/'claude-code') never appears in the model string (PRD §9.4.3) — verified by the
#      'anthropic/foo' round-trip test returning 'anthropic/foo' unchanged.
#   3. parseModelSpec compatibility: 'zai/GLM-4.7' is the documented accepted input shape
#      (architecture/external_deps.md §3) — no runtime parse error.
```

---

## Final Validation Checklist

### Technical Validation

- [ ] `npm run validate` exits 0 (lint + format:check + typecheck).
- [ ] `npm run test:run -- config` exits 0.
- [ ] `npm run test:run` (full suite) exits 0 — no regression (esp. `agent-factory.test.ts`).
- [ ] Coverage on `src/config/environment.ts` remains 100% (statements/branches/functions/lines).
- [ ] `npx tsc -p tsconfig.build.json` compiles with no errors.

### Feature Validation

- [ ] `qualifyModel` is exported from `src/config/environment.ts`.
- [ ] `getModel('sonnet') === 'zai/GLM-4.7'`; `getModel('haiku') === 'zai/GLM-4.5-Air'`;
      `getModel('opus') === 'zai/GLM-4.7'`.
- [ ] Env override qualified: `ANTHROPIC_DEFAULT_OPUS_MODEL='custom-opus'` → `getModel('opus') === 'zai/custom-opus'`.
- [ ] Already-qualified override not double-prefixed: `'anthropic/foo'` → `getModel('opus') === 'anthropic/foo'`.
- [ ] `qualifyModel('GLM-4.7','anthropic') === 'anthropic/GLM-4.7'` (explicit provider arg honored).
- [ ] `configureEnvironment()` and `validateEnvironment()` source unchanged.

### Code Quality Validation

- [ ] `qualifyModel` co-located with `getModel` in `src/config/environment.ts` (single source of truth).
- [ ] Provider default is the `DEFAULT_MODEL_PROVIDER` constant (NOT a bare `'zai'` literal).
- [ ] JSDoc on `qualifyModel` + updated `@example`/`@returns` on `getModel` (qualified forms).
- [ ] No `any` used; signature is `(name: string, provider: string = DEFAULT_MODEL_PROVIDER): string`.
- [ ] Existing exports/types in `environment.ts` preserved (append-style edit; no reordering).

### Documentation & Deployment

- [ ] `getModel` JSDoc examples reflect the new qualified output (`'zai/GLM-4.7'`).
- [ ] No new env vars introduced (reads existing `ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU}_MODEL`).
- [ ] Inline note (JSDoc) that qualification is idempotent + never harness-prefixed.

---

## Anti-Patterns to Avoid

- ❌ Don't hardcode the qualified literal `'zai/GLM-4.7'` inside `getModel` — read env at runtime
  and qualify via the helper. The ONLY qualifying prefix produced is `provider + '/'` from
  `qualifyModel`, where `provider` defaults to the `DEFAULT_MODEL_PROVIDER` constant.
- ❌ Don't drop the `.includes('/')` guard — it is what makes `qualifyModel` idempotent and
  prevents 3-segment strings (`zai/zai/...`) that make Groundswell `parseModelSpec` THROW.
- ❌ Don't prefix the **harness** (`pi`/`claude-code`) — only the **provider** (`zai`). The
  harness never appears in the model string (PRD §9.4.3).
- ❌ Don't skip the two cascade fixes — `tests/unit/config/environment.test.ts` (6 assertions)
  and `tests/unit/agents/agent-factory.test.ts` (1 line) hard-code bare names and WILL
  break; leaving them red fails the `npm run test:run` validation gate.
- ❌ Don't modify `configureEnvironment()`, `validateEnvironment()`, `MODEL_NAMES`,
  `MODEL_ENV_VARS`, or `DEFAULT_MODEL_PROVIDER` — contract item 3 + T1.S1 ownership.
- ❌ Don't add a `harness` field to `AgentConfig`, qualify literals inside `MODEL_NAMES`, or
  touch docs — those are T2.S2 / later milestones.
- ❌ Don't create a new model-resolution test file when updating `environment.test.ts` in place
  is more cohesive (the work item allows either; in-place keeps model-resolution tests
  beside the code they test and preserves the existing 100%-coverage layout).
- ❌ Don't use a bare `'zai'` default param — bind it to `DEFAULT_MODEL_PROVIDER` so the rule
  has one source of truth.
- ❌ Don't skip the failing-test-first (RED) step — the project mandates implicit TDD.

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: The change is small and fully self-contained (one ~6-line pure function + a
one-line wrapper + two test-file edits). The external contract (`parseModelSpec` accepting
`provider/model` and THROWing on 3-segment strings) is verified in `external_deps.md` §3 and
directly justifies the `.includes('/')` guard. The consumed constants
(`DEFAULT_MODEL_PROVIDER='zai'`, `MODEL_NAMES`, `MODEL_ENV_VARS`) are confirmed already present
in `src/config/constants.ts`. The only residual risk is the two cascading bare-name assertions
— and both are enumerated line-by-line in `research/qualify-model-cascades.md` §2 with exact
before/after replacements, so they cannot be missed. Validation commands
(`npm run validate`, `npm run test:run`) are verified executable in this repo. Zero file overlap
with the in-parallel T1.S2. No runtime/network/LLM unknowns.
