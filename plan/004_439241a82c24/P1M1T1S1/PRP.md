# PRP — P1.M1.T1.S1: Add `PRP_AGENT_HARNESS` env var, harness/provider constants, and supporting types

---

## Goal

**Feature Goal**: Extend the `src/config` layer with the harness/provider
vocabulary (constants + types + a dedicated error class) that the rest of the
Pluggable Agent Harness System (PRD §9.4) will build on. This is the typed,
zero-runtime foundation — pure constants and types, no env reading, no
Groundswell calls.

**Deliverable**:

1. **`src/config/constants.ts`** — add four new exports: `PRP_AGENT_HARNESS`,
   `DEFAULT_HARNESS`, `DEFAULT_MODEL_PROVIDER`, `SUPPORTED_HARNESSES`.
2. **`src/config/types.ts`** — add three new exports: `AgentHarness` (type),
   `ModelProvider` (type), `HarnessProviderMismatchError` (class).
3. **`tests/unit/config/harness.test.ts`** — new failing-first unit test file
   covering all new symbols (implicit TDD: RED → GREEN).

**Success Definition**:

- All seven new symbols are exported with the exact values/types/shapes below.
- `HarnessProviderMismatchError` extends `Error`, has `name === 'HarnessProviderMismatchError'`,
  and carries `readonly harness` + `readonly provider` fields echoing the mismatch.
- `npm run validate` passes (lint + format:check + typecheck).
- `npm run test:run -- config` passes with **100% coverage** on the touched files.
- Every previously-existing export in `constants.ts` and `types.ts` is untouched.

---

## Why

- **Enables the harness system (PRD §9.4 / §9.5).** S2 (`P1.M1.T1.S2`) will read
  `PRP_AGENT_HARNESS` from the environment, validate it against `SUPPORTED_HARNESSES`,
  enforce the `claude-code` + z.ai incompatibility by **throwing
  `HarnessProviderMismatchError`**, then call Groundswell `configureHarnesses()`.
  S2 cannot be implemented until these symbols exist.
- **Mirrors Groundswell's source-of-truth types.** Groundswell's `HarnessId` /
  `ModelProviderId` (architecture/external_deps.md §1) are the contract this project
  re-declares locally so the rest of the codebase is decoupled from the yalc-linked
  Groundswell package.
- **Single home for the qualification rule.** Centralizing `DEFAULT_MODEL_PROVIDER = 'zai'`
  and the `claude-code`-only-Anthropic invariant here means later subtasks
  (M1.T2 model qualification, M2 safeguards) reference one source.
- **Out of scope (hard boundary):** reading env vars at runtime, calling
  `configureHarnesses()`, qualifying model strings (`zai/<model>`), editing
  `agent-factory.ts`, docs. Those belong to S2 / M1.T2 / M2.T3 respectively.

---

## What

### User-visible behavior

None — this subtask adds only config-layer constants and types consumed by other
modules. No CLI, no runtime side effects, no I/O, no network.

### Technical requirements (exact contract)

In **`src/config/constants.ts`** (append; keep all existing exports):

| Symbol                   | Kind                                | Exact value                                                   |
| ------------------------ | ----------------------------------- | ------------------------------------------------------------- |
| `PRP_AGENT_HARNESS`      | `const` (string literal)            | `'PRP_AGENT_HARNESS'` — the **env-var name** (not its value). |
| `DEFAULT_HARNESS`        | `const` (`as const`)                | `'pi'`                                                        |
| `DEFAULT_MODEL_PROVIDER` | `const` (`as const`)                | `'zai'`                                                       |
| `SUPPORTED_HARNESSES`    | `const` readonly tuple (`as const`) | `['pi', 'claude-code']`                                       |

In **`src/config/types.ts`** (append; keep all existing exports):

| Symbol                         | Kind                         | Exact shape                                                                                                           |
| ------------------------------ | ---------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `AgentHarness`                 | `export type`                | `'pi' \| 'claude-code'` (mirrors Groundswell `HarnessId`)                                                             |
| `ModelProvider`                | `export type`                | `'zai' \| 'anthropic' \| (string & {})` (open set via the `(string & {})` idiom)                                      |
| `HarnessProviderMismatchError` | `export class extends Error` | `readonly harness: AgentHarness; readonly provider: ModelProvider;` with `this.name = 'HarnessProviderMismatchError'` |

### Success Criteria

- [ ] `PRP_AGENT_HARNESS === 'PRP_AGENT_HARNESS'`, `DEFAULT_HARNESS === 'pi'`,
      `DEFAULT_MODEL_PROVIDER === 'zai'`.
- [ ] `SUPPORTED_HARNESSES` equals `['pi', 'claude-code']` and is a **readonly** tuple
      (`as const`); `typeof SUPPORTED_HARNESSES[number]` resolves to `'pi' | 'claude-code'`.
- [ ] `AgentHarness` accepts exactly `'pi'` and `'claude-code'` and rejects other literals (type-level).
- [ ] `ModelProvider` accepts `'zai'`, `'anthropic'`, and arbitrary strings (open set) — type-level.
- [ ] `new HarnessProviderMismatchError('claude-code', 'zai')` is `instanceof Error`,
      has `.name === 'HarnessProviderMismatchError'`, and `.harness === 'claude-code'`,
      `.provider === 'zai'`.
- [ ] `npm run validate` exits 0.
- [ ] `npm run test:run -- config` exits 0 with 100% coverage on touched files.

---

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed to
implement this successfully?_ **Yes** — every reference below is a concrete file path,
with the exact pattern to copy and the exact symbols to add. No prior knowledge required.

### Documentation & References

```yaml
# MUST READ — source of truth for the type shapes
- file: ~/projects/groundswell/src/types/harnesses.ts
  why: Defines Groundswell's HarnessId and ModelProviderId that this subtask mirrors locally.
  pattern: "export type HarnessId = 'pi' | 'claude-code';  and  ModelProviderId = 'anthropic' | ... | 'zai' | (string & {})"
  critical: >
    Groundswell's ModelProviderId is a wider union ('openai'|'google'|...). The
    work-item CONTRACT narrows the local mirror to 'zai' | 'anthropic' | (string & {}).
    Follow the contract literally — do NOT copy Groundswell's full union.

- docfile: plan/004_439241a82c24/architecture/external_deps.md
  section: "1. Types" and "2. Configuration functions"
  why: Confirms Groundswell type shapes AND that configureHarnesses() does NOT validate
        defaultModelProvider (open set) — which is WHY this project must own
        HarnessProviderMismatchError (thrown later in S2, not here).

- docfile: plan/004_439241a82c24/architecture/delta_impact.md
  section: "A. Configuration layer" (rows for constants.ts and types.ts)
  why: Line-level CURRENT vs TARGET inventory; confirms append-only and exact target symbols.

- docfile: plan/004_439241a82c24/architecture/implementation_notes.md
  section: "1. WHERE the compatibility check must live" and "7. Validation gates"
  why: Confirms HarnessProviderMismatchError is DEFINED here but THROWN in S2 —
        this subtask only defines the class and tests its shape.

# PATTERN FILES — copy existing conventions exactly
- file: src/config/constants.ts
  why: Append new constants here following the existing `as const` + JSDoc style.
  pattern: "DEFAULT_BASE_URL = '...' as const;  MODEL_NAMES = {...} as const;"
  gotcha: Use `as const` on every new const to preserve literal types (matches DEFAULT_BASE_URL).

- file: src/config/types.ts
  why: Append the new type aliases and the error class here. COPY EnvironmentValidationError
        verbatim as the structural template (extends Error, readonly fields, this.name set).
  pattern: |
    export class EnvironmentValidationError extends Error {
      readonly missing: string[];
      constructor(missing: string[]) {
        super(`Missing required environment variables: ${missing.join(', ')}`);
        this.name = 'EnvironmentValidationError';
        this.missing = missing;
      }
    }
  critical: >
    Do NOT add Object.setPrototypeOf — the existing EnvironmentValidationError does not,
    and the project targets esnext/Node 20+ where native `extends Error` is correct.

- file: tests/unit/config/environment.test.ts
  why: Copy the test layout for the new harness.test.ts (describe/it, SETUP/EXECUTE/VERIFY
        comments, instanceof + field-read assertions, ESM .js import specifiers).
  pattern: "import { X } from '../../../src/config/types.js';  ... expect(e).toBeInstanceOf(Cls);"
  gotcha: vitest.config.ts enforces 100% coverage — the new error constructor MUST be
          instantiated in a test or coverage will fail.

- file: tests/unit/config/harness.test.ts
  why: NEW FILE to create (does not exist yet). Co-locates constants + types + error tests.
```

### Current Codebase tree (relevant slice)

```bash
src/config/
├── constants.ts     # EDIT — append PRP_AGENT_HARNESS, DEFAULT_HARNESS, DEFAULT_MODEL_PROVIDER, SUPPORTED_HARNESSES
├── environment.ts   # DO NOT TOUCH (S2 adds harness wiring here)
└── types.ts         # EDIT — append AgentHarness, ModelProvider, HarnessProviderMismatchError
tests/unit/config/
└── environment.test.ts   # EXISTING — reference for test patterns (do not modify)
```

### Desired Codebase tree with files to be added/edited

```bash
src/config/
├── constants.ts     # MODIFIED (append-only)
└── types.ts         # MODIFIED (append-only)
tests/unit/config/
├── environment.test.ts   # UNCHANGED
└── harness.test.ts       # NEW — unit tests for all 7 new symbols
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — open-set idiom: `(string & {})` is REQUIRED, NOT `string`.
//   - Plain `string` collapses the union (loses autocomplete) and can trigger
//     lint/type strictness. The `(string & {})` trick keeps 'zai'|'anthropic'
//     as autocomplete hints while allowing ANY string. Copy Groundswell's idiom.
export type ModelProvider = 'zai' | 'anthropic' | (string & {});

// CRITICAL — readonly tuple via `as const`, NOT a mutable array.
//   A plain `['pi','claude-code']` has type `string[]` and loses literal info.
export const SUPPORTED_HARNESSES = ['pi', 'claude-code'] as const;

// GOTCHA — prettier is enforced as an ERROR (`prettier/prettier: error` in .eslintrc.json).
//   Run `npm run fix` (lint:fix + format) before `npm run validate`, or format:check fails.

// GOTCHA — 100% coverage threshold (vitest.config.ts). The error class constructor
//   body must execute in at least one test. One `new HarnessProviderMismatchError(...)`
//   assertion per field covers both lines and branches.

// GOTCHA — no eslint-plugin-jsdoc. JSDoc is CONVENTION (strongly encouraged to match
//   existing symbols) but will NOT fail the build. Still add it for consistency.

// CRITICAL — append-only. Do NOT reorder/edit existing exports; downstream modules
//   and existing tests import MODEL_NAMES, ModelTier, EnvironmentValidationError, etc.
```

---

## Implementation Blueprint

### Data models and structure

This subtask is types/constants only — no ORM, no Pydantic (TypeScript project).
The "models" are the two type aliases and one error class.

```ts
// ---- src/config/types.ts (APPEND) ----

/**
 * Agent runtime / harness identifier (mirrors Groundswell's HarnessId, PRD §9.4.1).
 * The harness is ORTHOGONAL to the LLM provider and NEVER appears in the model string.
 */
export type AgentHarness = 'pi' | 'claude-code';

/**
 * LLM host / model provider id (PRD §9.2 / §9.4.2). OPEN SET via `(string & {})`:
 * known providers ('zai','anthropic') get autocomplete, but any string is valid.
 */
export type ModelProvider = 'zai' | 'anthropic' | (string & {});

/**
 * Error thrown when a harness/provider combination is incompatible
 * (PRD §9.2.4 / §9.4.3). e.g. `claude-code` harness is Anthropic-only and
 * cannot run the `zai` provider.
 *
 * DEFINED here; THROWN by the startup guard in P1.M1.T1.S2 (agent-factory.ts).
 */
export class HarnessProviderMismatchError extends Error {
  /** The harness that was selected (e.g. 'claude-code'). */
  readonly harness: AgentHarness;
  /** The model provider that is incompatible with the harness (e.g. 'zai'). */
  readonly provider: ModelProvider;

  constructor(harness: AgentHarness, provider: ModelProvider) {
    super(
      `Harness '${harness}' is incompatible with provider '${provider}' (PRD §9.2.4). ` +
        `Select a compatible harness/provider pair.`
    );
    this.name = 'HarnessProviderMismatchError';
    this.harness = harness;
    this.provider = provider;
  }
}

// ---- src/config/constants.ts (APPEND) ----

/** Env-var NAME selecting the agent runtime (PRD §9.2.2). Value: 'pi' | 'claude-code'. */
export const PRP_AGENT_HARNESS = 'PRP_AGENT_HARNESS';

/** Default harness when PRP_AGENT_HARNESS is unset — vendor-neutral pi runtime (PRD §9.4.1). */
export const DEFAULT_HARNESS = 'pi' as const;

/** Default LLM provider — z.ai (PRD §9.4.2). Orthogonal to the harness. */
export const DEFAULT_MODEL_PROVIDER = 'zai' as const;

/** All supported agent harness ids (PRD §9.4.1). Readonly tuple — exhaustive list. */
export const SUPPORTED_HARNESSES = ['pi', 'claude-code'] as const;
```

### Implementation Tasks (ordered by dependencies — implicit TDD: RED first, then GREEN)

```yaml
Task 1: CREATE tests/unit/config/harness.test.ts   (RED — must fail before impl)
  - IMPORT: the 7 new symbols from '../../../src/config/constants.js' and '../../../src/config/types.js'
  - FOLLOW pattern: tests/unit/config/environment.test.ts (describe/it, SETUP/EXECUTE/VERIFY comments,
    ESM .js specifiers, expect(...).toBeInstanceOf + field reads).
  - CASES (minimum):
      * constants: PRP_AGENT_HARNESS === 'PRP_AGENT_HARNESS';
        DEFAULT_HARNESS === 'pi'; DEFAULT_MODEL_PROVIDER === 'zai';
        SUPPORTED_HARNESSES.toEqual(['pi','claude-code']); assert it is readonly
        (TS: assign to `readonly [...]` or use expectTypeOf / a typed const).
      * types (type-level, compile-time): a const of type AgentHarness accepts 'pi' & 'claude-code';
        a const of type ModelProvider accepts 'zai','anthropic', and an arbitrary string like 'custom'.
      * error: new HarnessProviderMismatchError('claude-code','zai') is instanceof Error AND
        instanceof HarnessProviderMismatchError; .name === 'HarnessProviderMismatchError';
        .harness === 'claude-code'; .provider === 'zai'; .message contains both tokens.
  - NAMING: describe('config/harness'); test functions named test_* or it('should ...').
  - PLACEMENT: tests/unit/config/harness.test.ts
  - EXPECTED NOW: import fails / symbols undefined → RED.

Task 2: EDIT src/config/constants.ts   (GREEN — constants)
  - APPEND (do not modify existing exports): PRP_AGENT_HARNESS, DEFAULT_HARNESS,
    DEFAULT_MODEL_PROVIDER, SUPPORTED_HARNESSES with exact values from the table above.
  - NAMING: UPPER_SNAKE for constants; `as const` on each.
  - PLACEMENT: end of src/config/constants.ts.
  - EXPECTED: constants portion of harness.test.ts turns GREEN.

Task 3: EDIT src/config/types.ts   (GREEN — types + error class)
  - APPEND (do not modify existing exports): AgentHarness (type), ModelProvider (type),
    HarnessProviderMismatchError (class) using the exact shapes in "Data models" above.
  - FOLLOW pattern: EnvironmentValidationError (extends Error, readonly fields, this.name set,
    NO Object.setPrototypeOf).
  - GOTCHA: ModelProvider must use `(string & {})`, not `string`.
  - PLACEMENT: end of src/config/types.ts (error class after the two type aliases).
  - EXPECTED: full harness.test.ts GREEN; 100% coverage of the new constructor.

Task 4: FORMAT + VERIFY
  - RUN: `npm run fix` (lint:fix + prettier --write) then `npm run validate` then
    `npm run test:run -- config`.
  - EXPECTED: all green, zero lint/type/format errors, tests pass with 100% coverage.
```

### Implementation Patterns & Key Details

```ts
// PATTERN — error class is a STRUCTURAL COPY of EnvironmentValidationError (src/config/types.ts).
// Do not invent a new style. readonly fields + this.name + super(message). Nothing else.
export class HarnessProviderMismatchError extends Error {
  readonly harness: AgentHarness;
  readonly provider: ModelProvider;
  constructor(harness: AgentHarness, provider: ModelProvider) {
    super(
      `Harness '${harness}' is incompatible with provider '${provider}' (PRD §9.2.4).`
    );
    this.name = 'HarnessProviderMismatchError';
    this.harness = harness;
    this.provider = provider;
  }
}

// PATTERN — type-level assertions in vitest (prefer value-backed type checks; expectTypeOf optional):
import type { AgentHarness, ModelProvider } from '../../../src/config/types.js';
const h1: AgentHarness = 'pi'; // compiles
const h2: AgentHarness = 'claude-code'; // compiles
const p1: ModelProvider = 'zai'; // compiles
const p2: ModelProvider = 'anthropic'; // compiles
const p3: ModelProvider = 'custom-xyz'; // compiles (open set)

// PATTERN — assert SUPPORTED_HARNESSES is a readonly literal tuple:
expect(SUPPORTED_HARNESSES).toEqual(['pi', 'claude-code']);
// compile-time readonly check:
const _check: readonly ['pi', 'claude-code'] = SUPPORTED_HARNESSES;
```

### Integration Points

```yaml
RE-EXPORT (OPTIONAL — only if S2 needs a single import point):
  - file: src/config/environment.ts
  - current: "export type { ModelTier, EnvironmentConfig } from './types.js';
              export { EnvironmentValidationError } from './types.js';"
  - optional add: "export type { AgentHarness, ModelProvider } from './types.js';
                   export { HarnessProviderMismatchError } from './types.js';
                   export { PRP_AGENT_HARNESS, DEFAULT_HARNESS, DEFAULT_MODEL_PROVIDER,
                            SUPPORTED_HARNESSES } from './constants.js';"
  - decision: NOT required by the contract. Leave environment.ts untouched unless S2's
    import ergonomics demand it; the canonical home remains constants.ts/types.ts.
  - gotcha: if added, ensure no circular import (environment.ts already imports from both).

CONSUMERS (downstream — DO NOT EDIT in this subtask):
  - P1.M1.T1.S2: src/agents/agent-factory.ts  -> will READ PRP_AGENT_HARNESS, THROW HarnessProviderMismatchError, CALL configureHarnesses().
  - P1.M1.T2.S1: src/config/environment.ts     -> will use DEFAULT_MODEL_PROVIDER to qualify models.
  - P2/M2 docs/tests                           -> will reference SUPPORTED_HARNESSES.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# After writing each file — auto-fix first, then verify.
npm run fix                  # = lint:fix + prettier --write
npm run validate             # = lint && format:check && typecheck   (MUST be green)

# Targeted checks (optional, faster feedback):
npx eslint src/config/constants.ts src/config/types.ts tests/unit/config/harness.test.ts
npx tsc --noEmit -p tsconfig.build.json
npx prettier --check src/config/constants.ts src/config/types.ts tests/unit/config/harness.test.ts

# Expected: Zero errors. If prettier/format fails, re-run `npm run fix`. If typecheck fails,
# read the error — most likely cause is using `string` instead of `(string & {})` in ModelProvider.
```

### Level 2: Unit Tests (Component Validation)

```bash
# The new suite (must pass and cover 100% of new lines):
npm run test:run -- config

# Equivalent explicit path:
npx vitest run tests/unit/config/harness.test.ts

# Full unit suite regression check (must stay green — proves nothing existing broke):
npm run test:run

# Coverage report for the touched files (vitest.config.ts enforces 100% thresholds):
npx vitest run tests/unit/config/harness.test.ts --coverage

# Expected: all pass. If coverage < 100% on types.ts/constants.ts, ensure the error
# class constructor is actually instantiated in a test (not just type-checked).
```

### Level 3: Integration Testing (System Validation)

```bash
# N/A — this subtask is pure constants/types with zero runtime side effects, no env reads,
# no network, no Groundswell calls. No integration surface exists yet (that is S2).
# Sanity: confirm the symbols are importable from a compiled context:
npx tsc -p tsconfig.build.json   # build emits dist/ — proves the new exports compile cleanly.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# N/A — no MCP, no DB, no HTTP, no harness adapter wiring in this subtask.
# Domain-specific check (manual reasoning, recorded in commit message):
#   - AgentHarness values EXACTLY match Groundswell's HarnessId ('pi'|'claude-code').
#   - SUPPORTED_HARNESSES tuple elements are the SAME set as the AgentHarness union members.
#   - HarnessProviderMismatchError is DEFINED but not yet THROWN anywhere (S2 owns throwing).
```

---

## Final Validation Checklist

### Technical Validation

- [ ] `npm run validate` exits 0 (lint + format:check + typecheck).
- [ ] `npm run test:run -- config` exits 0.
- [ ] `npm run test:run` (full suite) exits 0 — no regression in untouched tests.
- [ ] Coverage on `src/config/constants.ts` and `src/config/types.ts` remains 100%.
- [ ] `npx tsc -p tsconfig.build.json` compiles with no errors.

### Feature Validation

- [ ] `PRP_AGENT_HARNESS === 'PRP_AGENT_HARNESS'`.
- [ ] `DEFAULT_HARNESS === 'pi'`; `DEFAULT_MODEL_PROVIDER === 'zai'`.
- [ ] `SUPPORTED_HARNESSES` is a readonly `['pi','claude-code']` tuple.
- [ ] `AgentHarness` = `'pi' | 'claude-code'` (type-level).
- [ ] `ModelProvider` = `'zai' | 'anthropic' | (string & {})` — accepts arbitrary strings.
- [ ] `HarnessProviderMismatchError` is `instanceof Error`, `.name === 'HarnessProviderMismatchError'`,
      carries `.harness` and `.provider`.
- [ ] All previously-existing exports in `constants.ts` and `types.ts` are unchanged
      (existing `tests/unit/config/environment.test.ts` still passes).

### Code Quality Validation

- [ ] Follows existing `as const` + JSDoc conventions (`DEFAULT_BASE_URL`, `MODEL_NAMES`).
- [ ] Error class mirrors `EnvironmentValidationError` structure exactly.
- [ ] No `Object.setPrototypeOf` added (unnecessary at esnext target).
- [ ] No `any` used (the `(string & {})` idiom keeps `@typescript-eslint/no-explicit-any` clean).
- [ ] Append-only edits; no reordering of existing symbols.

### Documentation & Deployment

- [ ] JSDoc on every new symbol (convention — matches existing config symbols).
- [ ] JSDoc `@example` on `HarnessProviderMismatchError` mirroring `EnvironmentValidationError`.
- [ ] No new env vars introduced at runtime (the `PRP_AGENT_HARNESS` _constant_ is the var NAME;
      reading it is S2's job).

---

## Anti-Patterns to Avoid

- ❌ Don't use plain `string` for `ModelProvider` — it collapses the open-set union; use `(string & {})`.
- ❌ Don't use a mutable `string[]` for `SUPPORTED_HARNESSES` — use `as const` for a readonly literal tuple.
- ❌ Don't copy Groundswell's full `ModelProviderId` union (`'openai'|'google'|...`) — the contract narrows it to `'zai' | 'anthropic' | (string & {})`.
- ❌ Don't add `Object.setPrototypeOf(this, HarnessProviderMismatchError.prototype)` — the existing `EnvironmentValidationError` doesn't, and esnext/Node 20+ doesn't need it.
- ❌ Don't read `process.env.PRP_AGENT_HARNESS` or call `configureHarnesses()` here — that is **S2**.
- ❌ Don't qualify model strings (`zai/GLM-4.7`) or touch `MODEL_NAMES` — that is **M1.T2.S1**.
- ❌ Don't edit `environment.ts`, `agent-factory.ts`, or any docs in this subtask.
- ❌ Don't reorder or rewrite existing exports to "clean up" — append only.
- ❌ Don't skip the failing-test-first (RED) step — the project mandates implicit TDD.

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: The change is small, fully self-contained (two append-only edits + one new
test file), with exact value/type specs, a verified structural template
(`EnvironmentValidationError`), verified Groundswell source types, and verified executable
validation commands (`npm run validate`, `npm run test:run -- config`). The only residual
risk is a prettier formatting nit (auto-fixed via `npm run fix`) or a 100%-coverage miss
on the error constructor (trivially fixed by adding one instantiation assertion — already
specified). No external/runtime unknowns.
