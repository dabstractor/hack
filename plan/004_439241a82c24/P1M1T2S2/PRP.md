# PRP — P1.M1.T2.S2: Update model types/JSDoc and wire `harness` field into agent configs

---

## Goal

**Feature Goal**: Make every Groundswell-bound agent config carry (a) a
**provider-qualified** `model` (already produced by `getModel()` in T2.S1) and
(b) a **`harness`** field resolved from the configured harness — so `createAgent()`
receives both the `provider/model` string (PRD §9.2.3 / §9.4.3) and the runtime
harness id (PRD §9.4.2 cascade: global default unless overridden). Also update the
`EnvironmentConfig` model-field JSDoc/examples (and stale bare-name JSDoc in
`agent-factory.ts`) to the `provider/model` form.

**Deliverable**:

1. **`src/config/types.ts`** — EDIT: update `EnvironmentConfig` model-field JSDoc
   (`opusModel`/`sonnetModel`/`haikuModel`) + `@example` + `@remarks` to the
   `provider/model` form (e.g. `opusModel: 'zai/GLM-4.7'`).
2. **`src/agents/agent-factory.ts`** — EDIT: (a) capture the top-level
   `configureHarness()` return value into a module-level `RESOLVED_HARNESS`
   constant; (b) add `harness: AgentHarness` to the local `AgentConfig` interface
   and to the object returned by `createBaseConfig()`; (c) fix stale bare-name
   JSDoc (`'GLM-4.7'` → `'zai/GLM-4.7'`). Keep `model = getModel('sonnet')`,
   `mcps: MCP_TOOLS`, `enableCache`/`enableReflection`/`maxTokens`, persona
   naming, and the local `env` field **all unchanged**.
3. **`tests/unit/agents/agent-factory.test.ts`** — EDIT (additive): add
   `expect(config).toHaveProperty('harness')` to the config-shape `it.each`;
   add a NEW dedicated `it()` asserting `config.harness === DEFAULT_HARNESS`
   (`'pi'`) for all personas; add `ANTHROPIC_API_KEY` to the existing env-stub
   `beforeEach`. **Do NOT** re-edit the model literal (T2.S1 already set
   `'zai/GLM-4.7'`).

**Success Definition** (the exact contract from the work item):

- `createBaseConfig(p).model === 'zai/GLM-4.7'` (qualified — already true via T2.S1;
  preserved, not regressed).
- `createBaseConfig(p).harness` is **defined** and equals `'pi'` under default
  config (`PRP_AGENT_HARNESS` unset), for every persona.
- All four persona factories (`createArchitectAgent`/`createResearcherAgent`/
  `createCoderAgent`/`createQAAgent`) still construct agents via `createAgent()`
  **without throwing** — proving the new `harness` field flows through cleanly.
- `src/config/types.ts` `EnvironmentConfig` JSDoc shows `opusModel: 'zai/GLM-4.7'`,
  `sonnetModel: 'zai/GLM-4.7'`, `haikuModel: 'zai/GLM-4.5-Air'`.
- `npm run validate` passes (lint + format:check + typecheck).
- Full `npm run test:run` passes with **no regression** (incl. 100% coverage on
  `src/config/types.ts` and `src/agents/agent-factory.ts`).

---

## Why

- **Completes PRD §9.3.3 / §9.4.2.** Groundswell `createAgent()` accepts
  `harness?: HarnessId` (verified — `architecture/external_deps.md` §4). Today the
  factory builds a config with `model` but **no** `harness`, so the runtime harness
  is selected only via the global singleton `configureHarnesses()` sets. Adding an
  explicit `harness` to each agent config makes the per-agent selection
  self-describing and is the documented cascade step ("global default → agent
  config → prompt overrides").
- **Pairs the harness with the now-qualified model.** T2.S1 made `getModel()` emit
  `zai/GLM-4.7`. T2.S2 makes the same config object also carry the resolved
  harness — together they are the complete `createAgent()` payload for P1.M2
  (parity/validation/docs) and P1.M2 unblocks on this.
- **Docs accuracy.** `EnvironmentConfig`'s `@example` and field JSDoc still show
  bare `GLM-4.7`/`GLM-4.5-Air`, contradicting the qualified strings the system now
  emits. Aligning the JSDoc prevents future implementers from copying the bare form.
- **Single source of truth for the harness value.** Capturing `configureHarness()`'s
  return value (rather than re-reading env or re-invoking the side effect) means
  the harness id has exactly one resolver — the T1.S2 entrypoint the work item names.
- **Out of scope (hard boundary):** qualifying model strings (T2.S1 — done), the
  `configureHarness()`/`configureHarnesses()` implementation (T1.S2 — done), the
  harness/provider constants & types (T1.S1 — done), provider-endpoint guard tests
  (M2.T1), feature-parity tests (M2.T2), docs files (M2.T3). `harnessOptions` is
  intentionally NOT added (per-harness options come from the global
  `harnessDefaults`).

---

## What

### User-visible behavior

None at the CLI surface. Observable only via config inspection: every
`createBaseConfig(...)` result now has a `harness: 'pi'` field (default), and the
same object is what `createAgent()` consumes. No runtime/network/LLM call is added
— `createAgent()` is config-only construction (provider is not contacted until
`prompt()`/`execute()`).

### Technical requirements (exact contract)

**`src/agents/agent-factory.ts`** — three small edits in one pass:

```ts
// 1) import the AgentHarness type (near the existing '../config/environment.js' import)
import type { AgentHarness } from '../config/types.js';

// 2) capture the resolved harness at module load (replace the bare `configureHarness();` line)
configureEnvironment();
/**
 * Resolved agent harness — captured once at startup from configureHarness()
 * (PRD §9.4.2 cascade: global default unless overridden). configureHarness() also
 * populates Groundswell's global singleton via configureHarnesses().
 */
const RESOLVED_HARNESS: AgentHarness = configureHarness();

// 3) add `harness` to the AgentConfig interface ...
export interface AgentConfig {
  readonly name: string;
  readonly system: string;
  /** Model identifier — provider-qualified 'provider/model' (e.g. 'zai/GLM-4.7'); never harness-qualified */
  readonly model: string;
  /** Agent runtime harness id (PRD §9.4.2) — 'pi' | 'claude-code' */
  readonly harness: AgentHarness;
  readonly enableCache: boolean;
  readonly enableReflection: boolean;
  readonly maxTokens: number;
  readonly env: {
    readonly ANTHROPIC_API_KEY: string;
    readonly ANTHROPIC_BASE_URL: string;
  };
}

// 4) ...and to the object createBaseConfig() returns (place `harness` right after `model`)
return {
  name,
  system,
  model,
  harness: RESOLVED_HARNESS,
  enableCache: true,
  enableReflection: true,
  maxTokens: PERSONA_TOKEN_LIMITS[persona],
  env: {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? '',
    ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL ?? '',
  },
};
```

Also fix the stale bare-name JSDoc in this file (module `@example`,
`createBaseConfig` `@example`) → `'zai/GLM-4.7'` (exact before/after in
`research/jsdoc-and-test-cascade.md` §2).

**`src/config/types.ts`** — update `EnvironmentConfig` JSDoc only (no type/shape
change): `@example` literals → `zai/...`; per-field JSDoc → "Provider-qualified
model name … (e.g. 'zai/GLM-4.7')"; add a `@remarks` line that model values are
provider-qualified and the harness never appears in them (PRD §9.2.3 / §9.4.3).
Exact before/after in `research/jsdoc-and-test-cascade.md` §1.

**`tests/unit/agents/agent-factory.test.ts`** — additive only (see Implementation
Tasks). The `expect(config.model).toBe('zai/GLM-4.7')` line is **already correct
(T2.S1)** — leave it untouched.

### Success Criteria

- [ ] `createBaseConfig(p).harness` is defined for all four personas.
- [ ] `createBaseConfig(p).harness === 'pi'` (=== `DEFAULT_HARNESS`) under default config.
- [ ] `createBaseConfig(p).model === 'zai/GLM-4.7'` (preserved from T2.S1, not regressed).
- [ ] All four `create<Persona>Agent()` factories construct without throwing.
- [ ] `EnvironmentConfig` JSDoc shows `opusModel: 'zai/GLM-4.7'`,
      `sonnetModel: 'zai/GLM-4.7'`, `haikuModel: 'zai/GLM-4.5-Air'`.
- [ ] `agent-factory.ts` JSDoc no longer contains a bare `'GLM-4.7'` model example.
- [ ] `mcps: MCP_TOOLS`, `enableCache`, `enableReflection`, `maxTokens`, persona
      naming, and the local `env` field are byte-for-byte preserved.
- [ ] `npm run validate` exits 0; `npm run test:run` exits 0 with 100% coverage on
      touched source files.

---

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed to
implement this successfully?_ **Yes** — every reference is a concrete file path
with the exact before/after JSDoc, the exact `RESOLVED_HARNESS` wiring, and the
exact additive test lines. The Groundswell `createAgent()` contract (`harness?:
HarnessId`) is verified in `external_deps.md` §4. The one non-obvious constraint —
that the model literal is already owned by T2.S1 and must not be re-edited — is
spelled out in the anti-patterns.

### Documentation & References

```yaml
# MUST READ — the Groundswell contract that permits the harness field
- docfile: plan/004_439241a82c24/architecture/external_deps.md
  section: "4. createAgent() config surface (from src/types/agent.ts)"
  why: Proves Groundswell AgentConfig carries harness?: HarnessId and model? accepts
       'provider/model'. HarnessId === 'pi' | 'claude-code' === our local AgentHarness.
       Therefore adding harness: AgentHarness is structurally compatible + flows through
       the persona `{ ...baseConfig, system, mcps }` spread into createAgent().
  critical: harnessOptions is intentionally NOT added here — per-harness options come from
            the global harnessDefaults set by configureHarnesses().

# MUST READ — where the resolved harness comes from (the INPUT entrypoint)
- docfile: plan/004_439241a82c24/P1M1T1S2/PRP.md
  section: "Technical requirements" (configureHarness() returns AgentHarness)
  why: configureHarness() is the work-item-named entrypoint. It already runs top-level in
       agent-factory.ts; T2.S2 captures its return value (single source of truth) rather
       than re-reading env or re-invoking the side effect.

# THIS subtask's research
- docfile: plan/004_439241a82c24/P1M1T2S2/research/harness-field-wiring.md
  section: "1. The source of the resolved harness" and "4. Non-conflict with T2.S1"
  why: Justifies capturing RESOLVED_HARNESS at module load (vs re-calling/re-reading env);
       proves the test edit is disjoint from T2.S1's model-literal edit.

- docfile: plan/004_439241a82c24/P1M1T2S2/research/jsdoc-and-test-cascade.md
  section: "1. EnvironmentConfig JSDoc" and "3. test cascade"
  why: Exact before/after JSDoc for types.ts; exact additive test lines + the env-stub
       beforeEach addition; confirms the model literal is already 'zai/GLM-4.7' (T2.S1).

# PATTERN FILES — copy existing conventions exactly
- file: src/agents/agent-factory.ts
  why: The file to EDIT. createBaseConfig() already does `const model = getModel('sonnet');`
        and returns a readonly config. Add `harness: RESOLVED_HARNESS` after `model`.
        The top-level `configureHarness();` call already exists — change it to capture
        the return value.
  pattern: "export interface AgentConfig { readonly name: string; ... readonly model: string; ... }"
  gotcha: Add `import type { AgentHarness } from '../config/types.js';` (type-only import).

- file: src/config/types.ts
  why: The file to EDIT (JSDoc only). EnvironmentConfig's @example + field JSDoc still show
        bare 'GLM-4.7'. No type/shape change — only doc text.
  pattern: "readonly opusModel: string;  /** Model name for opus tier */"
  gotcha: ModelTier JSDoc describes model *capabilities* — leave its GLM-4.7 mentions as-is.

- file: tests/unit/agents/agent-factory.test.ts
  why: EDIT (additive). Add toHaveProperty('harness') to the it.each config-shape test; add a
        NEW it() for config.harness === DEFAULT_HARNESS; add ANTHROPIC_API_KEY to the
        createBaseConfig beforeEach. Do NOT touch the 'zai/GLM-4.7' model assertion (T2.S1).
  pattern: "vi.stubEnv('ANTHROPIC_BASE_URL', 'https://api.z.ai/api/anthropic');"
  gotcha: Import DEFAULT_HARNESS from '../../../src/config/constants.js' for the robust assertion.

- file: src/config/harness.ts
  why: CONSUME — exports configureHarness(): AgentHarness (T1.S2). NO edit. Confirms the
        return value is the validated, resolved harness ('pi' under default config).

- file: src/config/constants.ts
  why: CONSUME — DEFAULT_HARNESS === 'pi', DEFAULT_MODEL_PROVIDER === 'zai'. Import
        DEFAULT_HARNESS in the test for the robust `toBe(DEFAULT_HARNESS)` assertion.

# CONSUMERS (downstream — NO edit in this subtask)
- file: src/scripts/validate-api.ts
  why: Reads getModel('sonnet') and passes to createAgent({ model }). The harness field is
        additive and transparent to it. Listed so the implementer does not waste time on it.
- file: tests/integration/agents.test.ts
  why: Line 171 asserts required AgentConfig props via additive toHaveProperty(...). Adding
        `harness` does NOT break it. Optionally augment with toHaveProperty('harness') for
        consistency — NOT required by the contract.
```

### Current Codebase tree (relevant slice)

```bash
src/config/
├── constants.ts     # CONSUME — DEFAULT_HARNESS, DEFAULT_MODEL_PROVIDER (T1.S1 — present)
├── environment.ts   # CONSUME — getModel() now returns 'zai/GLM-4.7' (T2.S1 — present)
├── harness.ts       # CONSUME — configureHarness(): AgentHarness (T1.S2 — present)
└── types.ts         # EDIT — EnvironmentConfig JSDoc → provider/model form
src/agents/
└── agent-factory.ts # EDIT — +RESOLVED_HARNESS capture; +harness field (interface + return); fix stale JSDoc
tests/unit/agents/
└── agent-factory.test.ts # EDIT (additive) — +harness assertions; +ANTHROPIC_API_KEY stub
```

### Desired Codebase tree with files to be added/edited

```bash
src/config/types.ts                       # EDIT (JSDoc only — no new files)
src/agents/agent-factory.ts               # EDIT (harness field + RESOLVED_HARNESS + JSDoc)
tests/unit/agents/agent-factory.test.ts   # EDIT (additive harness assertions + env stub)
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — capture configureHarness()'s RETURN VALUE; do NOT re-call it inside
// createBaseConfig() (would re-run configureHarnesses() per persona) and do NOT re-read
// process.env.PRP_AGENT_HARNESS (duplicates resolution, skips validation). The work item
// names configureHarness() as the INPUT entrypoint — capturing its return is the faithful
// interpretation. See research/harness-field-wiring.md §1.

// CRITICAL — the model literal in agent-factory.test.ts is ALREADY 'zai/GLM-4.7' (T2.S1
// landed it). DO NOT re-edit that line. T2.S2's test edits are strictly ADDITIVE and target
// DIFFERENT it() blocks (the config-shape it.each + a NEW harness it()). Per
// implementation_notes.md §8, M1.T2 runs S1 before S2, so S1 is merged when S2 executes.

// CRITICAL — Groundswell's createAgent() accepts harness?: HarnessId where HarnessId ===
// 'pi' | 'claude-code' — IDENTICAL to our local AgentHarness. So harness: AgentHarness is
// structurally compatible and flows through the persona { ...baseConfig, system, mcps }
// spread into createAgent(). Verified: architecture/external_deps.md §4.

// CRITICAL — do NOT add harnessOptions to AgentConfig. The work item says "add a harness
// field" (singular). Per-harness options come from the global harnessDefaults binding
// ('claude-code' → { apiKey }) set by configureHarnesses() (T1.S2).

// GOTCHA — module-load resolution: configureHarness() runs ONCE at import of
// agent-factory.ts. tests/setup.ts does not stub PRP_AGENT_HARNESS, so at import time it is
// unset → RESOLVED_HARNESS === 'pi'. Test-time vi.stubEnv does NOT retroactively change the
// captured const — correct, because the harness is a startup singleton. The new test asserts
// config.harness === DEFAULT_HARNESS ('pi'), which holds.

// GOTCHA — 100% coverage is globally enforced (vitest.config.ts). The new
// `harness: RESOLVED_HARNESS` line is exercised by every createBaseConfig() call (the
// it.each personas + the new harness it()), so coverage is preserved. No new branch is
// introduced (captured const, not a conditional).

// GOTCHA — prettier is an ERROR (eslint prettier/prettier: error). Run `npm run fix`
// (lint:fix + format) before `npm run validate`. Keep readonly fields + trailing commas
// matching the existing AgentConfig style.

// GOTCHA — type-only import for AgentHarness: `import type { AgentHarness } from
// '../config/types.js';` (keeps the runtime import graph clean; AgentHarness is erased at
// compile time). The value configureHarness() is imported from '../config/harness.js'.

// CRITICAL — DO NOT modify getModel()/qualifyModel() (T2.S1), configureHarness()/
// harness.ts (T1.S2), constants.ts/types.ts type shapes (T1.S1), mcps/MCP_TOOLS,
// enableCache/enableReflection/maxTokens, persona naming, or the local env field.
// DO NOT touch docs/ (M2.T3) or add provider-endpoint/parity tests (M2.T1/M2.T2).
```

---

## Implementation Blueprint

### Data models and structure

No new data models. The only structural change is one new readonly field on the
local `AgentConfig` interface and one module-level captured constant:

```ts
// src/agents/agent-factory.ts
const RESOLVED_HARNESS: AgentHarness = configureHarness();

export interface AgentConfig {
  // ...existing fields...
  /** Agent runtime harness id (PRD §9.4.2) — 'pi' | 'claude-code' */
  readonly harness: AgentHarness;
  // ...existing fields...
}
```

### Implementation Tasks (ordered by dependencies — implicit TDD: RED first, then GREEN)

```yaml
Task 1: EDIT tests/unit/agents/agent-factory.test.ts   (RED — failing assertions for the harness field)
  - IMPORT: add `import { DEFAULT_HARNESS } from '../../../src/config/constants.js';`
    (near the existing agent-factory import; constants import is new).
  - EDIT the existing `it.each(personas)('should return valid config for %s persona')`:
    alongside `expect(config).toHaveProperty('env');` add:
        expect(config).toHaveProperty('harness');
        expect(config.harness).toBeDefined();
  - ADD a NEW it() directly after the "should use qualified GLM-4.7 model" test:
        it('should set harness to the resolved runtime (default pi) for all personas', () => {
          const configs = personas.map(p => createBaseConfig(p));
          configs.forEach(config => {
            expect(config.harness).toBe(DEFAULT_HARNESS); // 'pi'
          });
        });
  - EDIT the `describe('createBaseConfig')` beforeEach: add
        vi.stubEnv('ANTHROPIC_API_KEY', 'test-token');
    next to the existing ANTHROPIC_AUTH_TOKEN / ANTHROPIC_BASE_URL stubs (work-item MOCKING).
  - DO NOT touch the `expect(config.model).toBe('zai/GLM-4.7')` line (T2.S1 owns it).
  - EXPECTED NOW: toHaveProperty('harness') + toBe(DEFAULT_HARNESS) FAIL (no harness field yet) → RED.

Task 2: EDIT src/agents/agent-factory.ts   (GREEN — wire the harness field)
  - ADD import: `import type { AgentHarness } from '../config/types.js';` (type-only).
  - EDIT the top-level startup block: change the bare `configureHarness();` to capture
        const RESOLVED_HARNESS: AgentHarness = configureHarness();
    with a JSDoc/comment noting it is the startup-resolved cascade default (PRD §9.4.2).
    KEEP it directly beneath `configureEnvironment();` (ordering invariant from T1.S2).
  - EDIT the AgentConfig interface: insert `readonly harness: AgentHarness;` with JSDoc,
    placed immediately after `readonly model: string;` (and update model's field JSDoc to
    mention provider-qualified form).
  - EDIT createBaseConfig's returned object: insert `harness: RESOLVED_HARNESS,` immediately
    after `model,`.
  - EDIT stale JSDoc: module @example `model: 'GLM-4.7'` → `model: 'zai/GLM-4.7'` (optionally
    append `harness: 'pi'`); createBaseConfig @example `model: 'GLM-4.7'` → `'zai/GLM-4.7'`
    (both the ArchitectAgent and CoderAgent example lines).
  - DO NOT: touch getModel import/call, mcps/MCP_TOOLS, enableCache, enableReflection,
    maxTokens/PERSONA_TOKEN_LIMITS, persona naming, the env field, prompts, or persona factories.
  - EXPECTED: agent-factory.test.ts harness assertions turn GREEN; model assertions stay GREEN.

Task 3: EDIT src/config/types.ts   (GREEN — EnvironmentConfig JSDoc → provider/model form)
  - EDIT EnvironmentConfig @remarks: add a line that model fields are provider-qualified and
    the harness never appears in the model string (PRD §9.2.3 / §9.4.3).
  - EDIT EnvironmentConfig @example: opusModel/sonnetModel → 'zai/GLM-4.7'; haikuModel →
    'zai/GLM-4.5-Air'.
  - EDIT per-field JSDoc:
        /** Provider-qualified model name for opus tier (e.g. 'zai/GLM-4.7') */  readonly opusModel: string;
        /** Provider-qualified model name for sonnet tier (e.g. 'zai/GLM-4.7') */ readonly sonnetModel: string;
        /** Provider-qualified model name for haiku tier (e.g. 'zai/GLM-4.5-Air') */ readonly haikuModel: string;
  - DO NOT: change any type/shape, ModelTier JSDoc (describes capabilities), or other symbols.
  - EXPECTED: no behavior change; typecheck/format pass; existing types.ts tests unaffected.

Task 4: FORMAT + VERIFY
  - RUN: `npm run fix` (lint:fix + prettier --write) then `npm run validate` then
      `npm run test:run -- agents/agent-factory` then `npm run test:run` (full regression).
  - EXPECTED: all green, zero lint/type/format errors, 100% coverage on agent-factory.ts +
    types.ts retained, no regression anywhere (esp. integration agents.test.ts).
```

### Implementation Patterns & Key Details

```ts
// ---- src/agents/agent-factory.ts (EDIT — key slices) ----

// 1) type-only import (new):
import type { AgentHarness } from '../config/types.js';

// 2) capture the resolved harness (replace bare `configureHarness();`):
configureEnvironment();
/** Resolved harness from configureHarness() (PRD §9.4.2 cascade). Captured once at startup. */
const RESOLVED_HARNESS: AgentHarness = configureHarness();

// 3) AgentConfig interface — add harness after model:
export interface AgentConfig {
  readonly name: string;
  readonly system: string;
  /** Model identifier — provider-qualified 'provider/model' (e.g. 'zai/GLM-4.7'); never harness-qualified */
  readonly model: string;
  /** Agent runtime harness id (PRD §9.4.2) — 'pi' | 'claude-code' */
  readonly harness: AgentHarness;
  readonly enableCache: boolean;
  readonly enableReflection: boolean;
  readonly maxTokens: number;
  readonly env: {
    readonly ANTHROPIC_API_KEY: string;
    readonly ANTHROPIC_BASE_URL: string;
  };
}

// 4) createBaseConfig return — add harness after model (model/getModel call UNCHANGED):
export function createBaseConfig(persona: AgentPersona): AgentConfig {
  const model = getModel('sonnet'); // → 'zai/GLM-4.7' (T2.S1)
  const name = `${persona.charAt(0).toUpperCase() + persona.slice(1)}Agent`;
  const system = `You are a ${persona} agent.`;
  return {
    name,
    system,
    model,
    harness: RESOLVED_HARNESS, // ← NEW (PRD §9.4.2)
    enableCache: true,
    enableReflection: true,
    maxTokens: PERSONA_TOKEN_LIMITS[persona],
    env: {
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? '',
      ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL ?? '',
    },
  };
}

// ---- src/config/types.ts (EDIT — JSDoc only) ----
export interface EnvironmentConfig {
  /** API authentication key (mapped from ANTHROPIC_AUTH_TOKEN) */
  readonly apiKey: string;
  /** Base URL for z.ai API endpoint */
  readonly baseURL: string;
  /** Provider-qualified model name for opus tier (e.g. 'zai/GLM-4.7') */
  readonly opusModel: string;
  /** Provider-qualified model name for sonnet tier (e.g. 'zai/GLM-4.7') */
  readonly sonnetModel: string;
  /** Provider-qualified model name for haiku tier (e.g. 'zai/GLM-4.5-Air') */
  readonly haikuModel: string;
}
// @example literals → opusModel: 'zai/GLM-4.7', sonnetModel: 'zai/GLM-4.7', haikuModel: 'zai/GLM-4.5-Air'
// @remarks → "Model fields are provider-qualified ('provider/model'); the harness NEVER
//            appears in the model string (PRD §9.2.3 / §9.4.3)."

// ---- tests/unit/agents/agent-factory.test.ts (EDIT — additive) ----
import { DEFAULT_HARNESS } from '../../../src/config/constants.js';
// ...
// in describe('createBaseConfig') beforeEach:
beforeEach(() => {
  vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'test-token');
  vi.stubEnv('ANTHROPIC_BASE_URL', 'https://api.z.ai/api/anthropic');
  vi.stubEnv('ANTHROPIC_API_KEY', 'test-token'); // ← NEW (work-item MOCKING)
});
// in it.each(personas)('should return valid config for %s persona'):
expect(config).toHaveProperty('harness'); // ← NEW
expect(config.harness).toBeDefined(); // ← NEW
// NEW it() block (after the model test):
it('should set harness to the resolved runtime (default pi) for all personas', () => {
  const configs = personas.map(p => createBaseConfig(p));
  configs.forEach(config => {
    expect(config.harness).toBe(DEFAULT_HARNESS); // 'pi'
  });
});
```

### Integration Points

```yaml
AGENT-FACTORY.TS (src/agents/agent-factory.ts):
  - add import (type-only): AgentHarness from '../config/types.js'
  - edit top-level: `configureHarness();` → `const RESOLVED_HARNESS: AgentHarness = configureHarness();`
  - edit interface: AgentConfig += readonly harness: AgentHarness (after model)
  - edit createBaseConfig return: += harness: RESOLVED_HARNESS (after model)
  - edit JSDoc: module + createBaseConfig @example bare 'GLM-4.7' → 'zai/GLM-4.7'
  - preserve: getModel('sonnet') call, mcps/MCP_TOOLS, enableCache/enableReflection,
              maxTokens/PERSONA_TOKEN_LIMITS, persona naming, env field, prompts, persona factories

TYPES.TS (src/config/types.ts):
  - edit EnvironmentConfig: @remarks (qualification note) + @example (zai/...) + 3 field JSDoc
  - preserve: every type/shape; ModelTier JSDoc; AgentHarness/ModelProvider/HarnessProviderMismatchError (T1.S1)

GROUNDWELL CONTRACT (read-only — verified):
  - createAgent(config) accepts harness?: HarnessId === 'pi' | 'claude-code' (=== AgentHarness).
  - The persona `{ ...baseConfig, system, mcps }` spread carries `harness` into createAgent().
  - No harnessOptions added (global harnessDefaults covers per-harness options).

DOWNSTREAM (read-only — NO edit in this subtask):
  - src/scripts/validate-api.ts → getModel('sonnet') → createAgent({ model }); harness is additive/transparent.
  - tests/integration/agents.test.ts:171 → toHaveProperty(...) checks; non-breaking (additive).
  - P1.M2 (parity/validation/docs) → consumes config.model ('zai/GLM-4.7') + config.harness ('pi').
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# After editing each file — auto-fix first, then verify.
npm run fix                  # = lint:fix + prettier --write
npm run validate             # = lint && format:check && typecheck   (MUST be green)

# Targeted checks (optional, faster feedback):
npx eslint src/agents/agent-factory.ts src/config/types.ts tests/unit/agents/agent-factory.test.ts
npx tsc --noEmit -p tsconfig.build.json
npx prettier --check src/agents/agent-factory.ts src/config/types.ts tests/unit/agents/agent-factory.test.ts

# Expected: Zero errors. Most likely failure: a prettier nit (re-run `npm run fix`) or a stale
# bare-name 'GLM-4.7' left in agent-factory.ts JSDoc (fix to 'zai/GLM-4.7').
```

### Level 2: Unit Tests (Component Validation)

```bash
# The directly-affected suite (must pass + retain 100% coverage of agent-factory.ts):
npm run test:run -- agents/agent-factory

# Equivalent explicit path:
npx vitest run tests/unit/agents/agent-factory.test.ts

# Config suites (proves types.ts JSDoc edit didn't disturb anything — no behavior change):
npm run test:run -- config

# Full suite regression (MUST stay green — proves the harness field + no other regression,
# incl. the integration agents.test.ts and the T2.S1 model literal):
npm run test:run

# Coverage check on the touched source files (vitest.config.ts enforces 100% globally):
npx vitest run tests/unit/agents/agent-factory.test.ts --coverage

# Expected: all pass. If agent-factory.ts coverage < 100%, the new `harness: RESOLVED_HARNESS`
# line is unexercised — it runs on every createBaseConfig() call, so the it.each + new it() cover it.
```

### Level 3: Integration Testing (System Validation)

```bash
# Prove the harness field flows into createAgent() without breaking construction.
# The "should create multiple agents without MCP server registration conflicts" test
# constructs all four persona agents with the new harness field present:
npx vitest run tests/unit/agents/agent-factory.test.ts

# Integration suite — confirms AgentConfig still satisfies broader contracts:
npx vitest run tests/integration/agents.test.ts

# Build emits dist/ cleanly (proves the AgentHarness type import + interface change compile):
npx tsc -p tsconfig.build.json

# Expected: agent-factory.test.ts fully green (incl. the new harness assertions + the existing
# 'zai/GLM-4.7' model assertion); integration suite green; build succeeds with no errors.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# No MCP/DB/HTTP in this subtask (createAgent() is config-only; no provider call until
# prompt()/execute()). Domain-specific reasoning (record in commit message):
#   1. Harness ↔ model orthogonality: config carries BOTH harness:'pi' AND model:'zai/GLM-4.7'.
#      The harness NEVER appears in the model string (PRD §9.4.3) — the JSDoc now states this
#      explicitly in types.ts, and agent-factory.ts JSDoc shows the qualified model.
#   2. Cascade integrity: RESOLVED_HARNESS is captured once at startup from configureHarness()
#      (the T1.S2 entrypoint). It equals the global default 'pi' unless PRP_AGENT_HARNESS
#      overrides at startup — matching PRD §9.4.2 "global default → agent config → prompt overrides".
#   3. No double-qualification risk: getModel() (T2.S1) is the sole qualifier; this subtask does
#      NOT touch model strings, so 'zai/GLM-4.7' is produced exactly once and never becomes
#      'pi/zai/GLM-4.7' (which would make Groundswell parseModelSpec THROW).
```

---

## Final Validation Checklist

### Technical Validation

- [ ] `npm run validate` exits 0 (lint + format:check + typecheck).
- [ ] `npm run test:run -- agents/agent-factory` exits 0.
- [ ] `npm run test:run` (full suite) exits 0 — no regression (incl. integration `agents.test.ts`).
- [ ] Coverage on `src/agents/agent-factory.ts` and `src/config/types.ts` remains 100%.
- [ ] `npx tsc -p tsconfig.build.json` compiles with no errors.

### Feature Validation

- [ ] `createBaseConfig(p).harness` is defined for all four personas.
- [ ] `createBaseConfig(p).harness === 'pi'` (=== `DEFAULT_HARNESS`) under default config.
- [ ] `createBaseConfig(p).model === 'zai/GLM-4.7'` (preserved from T2.S1, not regressed).
- [ ] All four `create<Persona>Agent()` factories construct without throwing.
- [ ] `EnvironmentConfig` JSDoc shows `opusModel: 'zai/GLM-4.7'`, `sonnetModel: 'zai/GLM-4.7'`,
      `haikuModel: 'zai/GLM-4.5-Air'` + a `@remarks` qualification note.
- [ ] `agent-factory.ts` JSDoc no longer contains a bare `'GLM-4.7'` model example.

### Code Quality Validation

- [ ] `harness` field co-located on `AgentConfig` (interface + return object), placed after `model`.
- [ ] `RESOLVED_HARNESS` captured from `configureHarness()` return value (single source of truth).
- [ ] `AgentHarness` imported type-only (`import type { ... }`).
- [ ] No `harnessOptions` added (out of scope; global `harnessDefaults` covers it).
- [ ] `mcps`/`enableCache`/`enableReflection`/`maxTokens`/persona naming/`env` field preserved.
- [ ] JSDoc updates are doc-only in `types.ts` (no type/shape change).

### Documentation & Deployment

- [ ] `EnvironmentConfig` JSDoc reflects the provider-qualified output format.
- [ ] `agent-factory.ts` JSDoc examples reflect `'zai/GLM-4.7'` (+ optional `harness: 'pi'`).
- [ ] No new env vars introduced (consumes existing `PRP_AGENT_HARNESS` via `configureHarness()`).

---

## Anti-Patterns to Avoid

- ❌ Don't re-edit the `expect(config.model).toBe('zai/GLM-4.7')` line in
  `agent-factory.test.ts` — T2.S1 owns it (already landed). T2.S2's test edits are strictly
  ADDITIVE and target different `it()` blocks.
- ❌ Don't call `configureHarness()` inside `createBaseConfig()` — it re-runs the
  `configureHarnesses()` side effect per persona. Capture the top-level return value into
  `RESOLVED_HARNESS` once.
- ❌ Don't re-read `process.env.PRP_AGENT_HARNESS ?? DEFAULT_HARNESS` in `createBaseConfig()`
  — that duplicates resolution + skips validation. Use the `configureHarness()` entrypoint.
- ❌ Don't add `harnessOptions` to `AgentConfig` — the work item says "a harness field"
  (singular); per-harness options come from the global `harnessDefaults` (T1.S2).
- ❌ Don't touch `getModel()`/`qualifyModel()` (T2.S1), `configureHarness()`/`harness.ts`
  (T1.S2), constants/types type-shapes (T1.S1), `mcps`/`MCP_TOOLS`, `enableCache`/
  `enableReflection`, `maxTokens`/`PERSONA_TOKEN_LIMITS`, persona naming, the `env` field,
  prompts, or the persona factory bodies.
- ❌ Don't change any type/shape in `types.ts` — the `EnvironmentConfig` edit is **JSDoc only**.
  Leave `ModelTier` JSDoc (it describes model capabilities, not the config-field format).
- ❌ Don't prefix the harness into the model string — `harness` is a separate field;
  `'pi/zai/GLM-4.7'` would make Groundswell `parseModelSpec` THROW (PRD §9.4.3).
- ❌ Don't add provider-endpoint / parity / cache-isolation tests or edit `docs/` — those are
  M2.T1 / M2.T2 / M2.T3.
- ❌ Don't skip the failing-test-first (RED) step — add the harness assertions BEFORE wiring
  the field, so RED → GREEN is observable.
- ❌ Don't use a value import for `AgentHarness` — use `import type { AgentHarness }` (it is
  erased at compile time; only `configureHarness()` is a runtime import).

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: The change is small and self-contained (one captured const, one new interface
field, one new return-object property, doc-only JSDoc in `types.ts`, and a few additive test
lines). The Groundswell contract (`createAgent()` accepts `harness?: HarnessId`, with
`HarnessId === 'pi' | 'claude-code'` === our `AgentHarness`) is verified in
`architecture/external_deps.md` §4, so the new field is structurally compatible and flows
through the persona spread into `createAgent()`. All upstream dependencies are already
merged and confirmed in the working tree: `configureHarness(): AgentHarness` (T1.S2),
`getModel()` returning `zai/GLM-4.7` (T2.S1), and the `AgentHarness`/`DEFAULT_HARNESS`
symbols (T1.S1). The single non-obvious constraint — that the model literal in the test is
already owned by T2.S1 and must not be re-edited — is documented with exact before/after in
`research/jsdoc-and-test-cascade.md` and reinforced in the anti-patterns. The integration test
(`agents.test.ts:171`) is confirmed non-breaking (additive `toHaveProperty`). Module-load
resolution of `RESOLVED_HARNESS === 'pi'` is confirmed against `tests/setup.ts`. Validation
commands (`npm run validate`, `npm run test:run`) are verified executable in this repo.
Residual risk: a prettier formatting nit (auto-fixed via `npm run fix`) or leaving a stale
bare `'GLM-4.7'` in `agent-factory.ts` JSDoc (enumerated line-by-line in the research). No
runtime/network/LLM unknowns — `createAgent()` is config-only construction.
