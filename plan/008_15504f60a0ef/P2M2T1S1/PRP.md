# PRP — P2.M2.T1.S1: Add reasoning budget config and role parameter to agent-factory

---

## Goal

**Feature Goal**: Add the **role/reasoning-budget data model** to the agent factory
(per PRD §9.2.3 "Model Selection" + §6.1 "maximum reasoning budget"). Concretely:
(1) a project-local `ThinkingLevel` union and a `ModelRole` type
(`'research' | 'reasoning' | 'implementation'`); (2) a `thinking?: ThinkingLevel`
field on the project-local `AgentConfig` interface; (3) a `ROLE_CONFIG` constant
mapping each role → `{ tier, thinking }`; (4) a `createBaseConfig(persona, role)`
overload that resolves `model` tier and `thinking` budget from `ROLE_CONFIG`. This is
the **plumbing layer only** — persona→role remapping (S2) and the xhigh demand-write
retry wiring (S3) consume this model downstream.

**Deliverable**:
1. **`src/agents/agent-factory.ts`** — ADD `ThinkingLevel` + `ModelRole` exported
   types, ADD `thinking?` field to `AgentConfig`, ADD `ROLE_CONFIG` constant, and
   UPDATE `createBaseConfig` to `createBaseConfig(persona, role = 'research')` driving
   `model`/`thinking` from `ROLE_CONFIG[role]`. Add JSDoc on all four new symbols.
2. **`tests/unit/agents/agent-factory.test.ts`** — ADD a `describe('model roles &
   reasoning budget')` block asserting each role's `{ tier, thinking, model }` and the
   default-role backward-compat invariant (gated; runs under `npm run validate`).
3. **`docs/CONFIGURATION.md`** — ADD a `### Model Roles` subsection to `## Model
   Selection` describing the three roles + the maximum-reasoning-budget rule (Mode A
   doc-with-work; rides with this subtask).

**Success Definition**:
- `rg -n "ModelRole|ROLE_CONFIG|thinking\?:" src/agents/agent-factory.ts` → the four
  new symbols are present and exported.
- `createBaseConfig('architect')` (no role arg) still returns `model: 'zai/glm-5.2'`
  (default `role = 'research'` → balanced tier) — **zero existing tests break**.
- `createBaseConfig('architect', 'reasoning').thinking === 'xhigh'`;
  `createBaseConfig('architect', 'research').thinking === undefined`;
  `createBaseConfig('coder', 'implementation').model === 'zai/glm-5-turbo'`.
- `npm run validate` GREEN (lint + format + `tsc --noEmit -p tsconfig.build.json` +
  `vitest run`) with **100% coverage on `src/**/*.ts`** preserved.
- The 4 existing `createXxxAgent` functions are **unchanged** (S2 owns persona→role
  remap) and still compile against Groundswell's `createAgent` (spread excess-property
  carve-out — proven safe, see Context §"Known Gotchas").

---

## User Persona (if applicable)

**Target User**: Pipeline maintainer / agent-factory contributor.
**Use Case**: Selecting which model tier + reasoning budget each pipeline agent runs
with, without hardcoding tiers/budgets at each call site.
**User Journey**: A maintainer reads `ROLE_CONFIG` to see the role→{tier,thinking}
matrix; S2 then maps each persona to its role; the resolved `thinking` budget becomes
the single source of truth for downstream harness wiring.
**Pain Points Addressed**: Today `createBaseConfig` hardcodes `getModel('balanced')`
and there is no `thinking` field anywhere — so PRD §6.1's "maximum reasoning budget"
and §9.2.3's three roles cannot be expressed.

---

## Why

- **PRD compliance**: §9.2.3 mandates three model roles (Research/Reasoning/
  Implementation); §6.1 mandates decomposition at the **maximum reasoning budget**
  (extended-thinking `xhigh`). Neither is expressible today.
- **Enables S2/S3**: S2 ("Map personas to three roles") needs `createBaseConfig(role)`
  + `ROLE_CONFIG` to exist; S3 ("Wire xhigh into decomposition demand-write retry")
  needs the `thinking` field. S1 is their shared prerequisite.
- **Decoupling**: Defining the pipeline's OWN `ThinkingLevel` union (contract verbatim,
  excluding the SDK's `'minimal'`) keeps the agent factory decoupled from the harness/SDK
  — Groundswell's `AgentConfig` doesn't know about thinking at all.
- **Boundaries**: S1 ships ONLY the data model + a backward-compatible `createBaseConfig`
  role parameter with a `'research'` default. It does **not** remap personas (S2), wire
  `thinking` into the pi harness end-to-end (harness-layer, later), or touch the config
  layer (P2.M1.T1 — already complete/landing).

### Out of scope (hard fences)
- Persona→role remap in `createXxxAgent` → **S2**.
- `thinking` → `harnessOptions` → pi `thinkingLevel` end-to-end threading → harness-layer,
  later (Groundswell `HarnessOptions`). S1 only STORES the field as a pipeline-internal
  budget marker.
- `getModel` / `ModelTier` / `MODEL_NAMES` / `environment.ts` / `constants.ts` /
  `types.ts` → owned by **P2.M1.T1.S1/S2/S3** (complete/landing).
- Stale `glm-4.7` test TITLE + model-VALUE prose sweep → **S3 / P6**.
- Adding `'minimal'` to the union → the contract intentionally **excludes** it.

---

## What

### User-visible behavior
None. This is internal plumbing: a new type, a new config field, a new constant, and a
new optional `createBaseConfig` parameter with a default. No CLI, env, or runtime
behavior changes (default role preserves all current outputs).

### Technical requirements (exact contract — item 3a–d)

**(a) `ThinkingLevel` union** — define the pipeline's own, matching the contract
verbatim (NOT the SDK's, which adds `'minimal'`):
```ts
export type ThinkingLevel = 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
```

**(b) `ModelRole` type**:
```ts
export type ModelRole = 'research' | 'reasoning' | 'implementation';
```

**(a) `thinking` field** on the project-local `AgentConfig` interface (readonly,
optional), with JSDoc:
```ts
/** Extended-thinking (reasoning) budget for this agent (PRD §6.1, §9.2.3).
 *  Set to 'xhigh' for the Reasoning role (decomposition/bug-finding/validation);
 *  undefined for Research/Implementation roles. Pipeline-internal budget marker —
 *  Groundswell's AgentConfig does not model thinking; harness wiring is downstream. */
readonly thinking?: ThinkingLevel;
```

**(d) `ROLE_CONFIG` constant** mapping roles → `{ tier, thinking }`:
```ts
export const ROLE_CONFIG: Readonly<
  Record<ModelRole, { readonly tier: ModelTier; readonly thinking?: ThinkingLevel }>
> = {
  research:       { tier: 'balanced' },
  reasoning:      { tier: 'balanced', thinking: 'xhigh' },
  implementation: { tier: 'fast' },
} as const;
```
(`thinking` is OMITTED on research/implementation entries — yields `undefined` on read,
assignable to `AgentConfig.thinking?`. No `??` → no coverage branch. See Context
§"Known Gotchas".)

**(c) `createBaseConfig` updated signature + body**:
```ts
export function createBaseConfig(
  persona: AgentPersona,
  role: ModelRole = 'research',
): AgentConfig {
  const { tier, thinking } = ROLE_CONFIG[role];
  const model = getModel(tier);   // was: getModel('balanced') hardcoded
  const name = `${persona.charAt(0).toUpperCase() + persona.slice(1)}Agent`;
  const system = `You are a ${persona} agent.`;
  return {
    name, system, model, thinking,
    harness: resolvedHarness(),
    enableCache: true, enableReflection: true,
    maxTokens: PERSONA_TOKEN_LIMITS[persona],
    env: {
      ANTHROPIC_API_KEY: resolveApiKeyForProvider(getResolvedProvider()) ?? '',
      ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL ?? '',
    },
  };
}
```
The default `role = 'research'` keeps all 4 existing one-arg call sites
(`createBaseConfig('architect'|'researcher'|'coder'|'qa')` at lines 222/253/284/316)
working **unmodified** → balanced tier → `zai/glm-5.2`, matching today.

**Import additions**: `import type { ModelTier } from '../config/types.js';` (the tier
type backing `ROLE_CONFIG`).

### Success Criteria
- [ ] `ThinkingLevel`, `ModelRole` exported types; `thinking?` field on `AgentConfig`;
      `ROLE_CONFIG` exported constant — all present with JSDoc.
- [ ] `createBaseConfig(persona, role = 'research')` resolves `model`/`thinking` from
      `ROLE_CONFIG[role]`.
- [ ] Default role `'research'` preserves all existing assertions (no test regressions).
- [ ] `createBaseConfig(p, 'reasoning').thinking === 'xhigh'`;
      `createBaseConfig(p, 'research'|'implementation').thinking === undefined`.
- [ ] The 4 `createXxxAgent` functions are unchanged and still typecheck against
      Groundswell `createAgent`.
- [ ] `npm run validate` GREEN; 100% coverage on `src/**/*.ts` preserved.
- [ ] `docs/CONFIGURATION.md` has a `### Model Roles` subsection under `## Model Selection`.

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_
**Yes.** The four target edits are anchored to exact symbols/lines in
`src/agents/agent-factory.ts` (329 lines). The "will the spread break Groundswell's
createAgent?" question is **proven safe** by an isolated `tsc` reproduction (research
§s1-gotchas-and-coverage #1). The 100%-coverage trap is pre-solved by an
explicitly-branch-free `ROLE_CONFIG` design. The default-role backward-compat
invariant is tabulated against every existing assertion. The contract union is
specified verbatim with the SDK-`minimal` discrepancy called out.

### Documentation & References
```yaml
# MUST READ — the PRD spec (the source of truth for the three roles + xhigh rule)
- docfile: PRD.md
  section: "9.2.3 Model Selection" (h4.2)
  why: Defines the three roles (Research=balanced/normal, Reasoning=balanced@xhigh,
       Implementation=fast) and the "reasoning-intensive steps pin the maximum thinking
       budget" rule. S1's ROLE_CONFIG is the literal encoding of this section.
  critical: Reasoning role = balanced model + xhigh thinking (NOT a different tier).
       Model ids are lowercase provider-qualified ('zai/glm-5.2'); never harness-qualified.
- docfile: PRD.md
  section: "6.1 Task Breakdown System Prompt" (h3.12)
  why: "Decomposition runs at the MAXIMUM reasoning budget (extended-thinking xhigh
       equivalent)." This is WHY the Reasoning role carries thinking:'xhigh'.
  critical: The "demand write" retry uses the SAME xhigh budget (S3 wires the retry; S1
       supplies the field).

# MUST READ — upstream CONTRACT (assume implemented exactly as specified)
- docfile: plan/008_15504f60a0ef/P2M1T1S3/PRP.md
  section: "Goal / Deliverable / Out of scope"
  why: S3 finalizes the tier rename to high/balanced/fast + the getModel JSDoc. S1
       CONSUMES `getModel(tier)` and `ModelTier` as finished inputs. S1 must NOT touch
       environment.ts/constants.ts/types.ts (S1/S2/S3 territory).
  critical: `getModel('balanced')` → 'zai/glm-5.2'; `getModel('fast')` → 'zai/glm-5-turbo'.
       These are the resolved values behind ROLE_CONFIG.

# MUST READ — this subtask's research (proven facts)
- docfile: plan/008_15504f60a0ef/P2M2T1S1/research/s1-codebase-analysis.md
  section: §1c (4 one-arg call sites), §2 (config inputs), §3 (Groundswell createAgent),
       §5 (default-role backward compat), §6 (CONFIGURATION.md target), §7 (scope fences)
  why: Proven: only 4 internal createBaseConfig callers (all in agent-factory.ts);
       default 'research' preserves every existing assertion; Groundswell createAgent
       spread is safe.
- docfile: plan/008_15504f60a0ef/P2M2T1S1/research/s1-gotchas-and-coverage.md
  section: §1 (spread excess-property carve-out PROVEN), §2 (ThinkingLevel vs SDK),
       §3 (100%-coverage branch-free design), §4 (backward-compat table)
  why: The spread-safety proof (tsc reproduction) and the coverage strategy are the two
       things that determine one-pass success.

# THE FILE TO EDIT — current (post-S1-tier-rename) state
- file: src/agents/agent-factory.ts
  why: EDIT: add ThinkingLevel + ModelRole types (~after AgentPersona), add thinking?
       field to AgentConfig interface (~line 75-101), add ROLE_CONFIG constant (near
       PERSONA_TOKEN_LIMITS), update createBaseConfig signature+body (line 171).
  pattern: readonly fields; const-asserted config maps (mirror PERSONA_TOKEN_LIMITS
       `as const` style); JSDoc on every exported symbol (see existing AgentPersona/
       AgentConfig JSDoc).
  gotcha: Do NOT modify the 4 createXxxAgent functions — S2's lane. They call
       createBaseConfig with ONE arg; the default role keeps them working.

- file: tests/unit/agents/agent-factory.test.ts
  why: ADD describe('model roles & reasoning budget') block. GATED (*.test.ts → runs
       under npm run validate). Must cover all 3 roles + default-role path + thinking
       field for coverage (see Validation §Level 2).
  pattern: mirror existing createBaseConfig describe block — vi.stubEnv in beforeEach,
       afterEach vi.unstubAllEnvs; it.each over roles; expect(...).toBe(...).

- file: docs/CONFIGURATION.md
  why: ADD ### Model Roles subsection inside ## Model Selection (after ### Model Tiers,
       ~line 245). Mode A doc-with-work (rides with this subtask per PRD §6.1).
  pattern: match the existing table + "When to use" prose style of ### Model Tiers.

# CONTRACT INPUTS (read-only — owned by P2.M1.T1, already complete/landing)
- file: src/config/environment.ts
  section: getModel(tier: ModelTier): string
  why: S1 calls getModel(ROLE_CONFIG[role].tier). Returns provider-qualified model string.
  gotcha: DO NOT edit this file (S2/S3 territory).
- file: src/config/types.ts
  section: type ModelTier = 'high' | 'balanced' | 'fast'
  why: import type for ROLE_CONFIG's tier field. DO NOT edit.
```

### Current Codebase tree (relevant slice)
```bash
src/
  agents/
    agent-factory.ts          # EDIT — types, field, ROLE_CONFIG, createBaseConfig
    prompts.ts                # untouched
  config/
    constants.ts              # untouched (MODEL_NAMES — S1/S2 own)
    environment.ts            # untouched (getModel — S2/S3 own) — INPUT only
    types.ts                  # untouched (ModelTier — S1 own) — INPUT only
docs/
  CONFIGURATION.md            # EDIT — add ### Model Roles subsection
tests/
  unit/agents/
    agent-factory.test.ts     # EDIT — add roles/reasoning describe block
vitest.config.ts              # READ-ONLY — 100% coverage thresholds; include globs
```

### Desired Codebase tree with files to be added and responsibility of file
```bash
src/agents/agent-factory.ts   # MODIFIED — exports ThinkingLevel, ModelRole, ROLE_CONFIG;
                              #   AgentConfig.thinking field; createBaseConfig(persona, role)
docs/CONFIGURATION.md         # MODIFIED — ### Model Roles subsection (Mode A docs)
tests/unit/agents/agent-factory.test.ts  # MODIFIED — roles & reasoning-budget test block
# (no NEW files)
```

### Known Gotchas of our codebase & Library Quirks
```ts
// CRITICAL: TypeScript suppresses excess-property checks for spread-only properties.
// Adding `thinking?` to the LOCAL AgentConfig does NOT break the createXxxAgent spread
// `{...baseConfig, system, mcps}` passed to Groundswell's createAgent (which has no
// `thinking` field). PROVEN via isolated tsc reproduction (exit 0). Do NOT destructure/
// cast/strip `thinking` — just add the field. Groundswell ignores the extra property.
//   → The 4 createXxxAgent functions need ZERO changes for S1.

// CRITICAL: vitest.config.ts enforces 100% coverage (statements/branches/functions/lines).
// Design ROLE_CONFIG branch-free: OMIT `thinking` on research/implementation entries
// (reading ROLE_CONFIG[role].thinking yields undefined → typed ThinkingLevel|undefined,
// assignable to AgentConfig.thinking?). Do NOT write `thinking: undefined` and do NOT use
// `?? undefined` (both can introduce coverage branches).

// CRITICAL: define the pipeline's OWN ThinkingLevel union = 'off'|'low'|'medium'|
// 'high'|'xhigh'|'max'. The pi SDK (@earendil-works/pi-agent-core types.d.ts:254) ADDS
// 'minimal' — intentionally EXCLUDED by this contract. Do NOT re-export the SDK type;
// record the discrepancy in JSDoc so a maintainer doesn't "fix" it.

// GOTCHA: default role MUST be 'research' (not 'reasoning') to preserve backward compat.
// createBaseConfig('coder') today returns balanced (glm-5.2); createCoderAgent then
// overrides to fast. Default 'research' → balanced → identical output. Any other default
// (e.g. 'reasoning'→xhigh, or 'implementation'→fast) would change createBaseConfig's
// output for architect/researcher/qa and break the existing "all personas → glm-5.2" test.

// GOTCHA: keep `as const` on ROLE_CONFIG (mirrors PERSONA_TOKEN_LIMITS / MODEL_NAMES
// style) so the literal tier/thinking values are preserved and the Record index is sound.

// GOTCHA: the existing test it('should use qualified glm-4.7 model for all personas')
// has a STALE title (model-VALUE prose, pre-existing) but asserts createBaseConfig(p)
// .model === 'zai/glm-5.2'. Do NOT touch its title (S3/P6 lane) — just ensure your
// default role keeps the assertion green.
```

---

## Implementation Blueprint

### Data models and structure

```ts
// === src/agents/agent-factory.ts (additions) ===

import type { ModelTier } from '../config/types.js'; // NEW import (INPUT from P2.M1.T1)

/**
 * Extended-thinking (reasoning) budget for an agent (PRD §6.1, §9.2.3).
 *
 * @remarks
 * The Reasoning role (task decomposition, creative bug-finding, validation) runs at the
 * MAXIMUM budget ('xhigh'); Research and Implementation roles run at their model's normal
 * budget (field omitted → undefined). This is a pipeline-internal budget marker: Groundswell's
 * AgentConfig does not model thinking, so the field rides on the config object for downstream
 * harness wiring; it is NOT consumed by Groundswell createAgent.
 *
 * NOTE: the pi SDK (`@earendil-works/pi-agent-core`) defines a `ThinkingLevel` that also
 * includes 'minimal'. This pipeline type intentionally EXCLUDES 'minimal' per the P2.M2.T1.S1
 * contract — only the six levels below are selectable.
 */
export type ThinkingLevel = 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/**
 * Model role selecting tier + reasoning budget for a pipeline agent (PRD §9.2.3).
 *
 * @remarks
 * - 'research'       → balanced tier, normal budget (architecture research, PRP creation)
 * - 'reasoning'      → balanced tier, 'xhigh' budget (decomposition, bug-finding, validation)
 * - 'implementation' → fast tier, normal budget (PRP execution, post-validation fix)
 *
 * @see {@link ROLE_CONFIG} for the role → {tier, thinking} mapping.
 */
export type ModelRole = 'research' | 'reasoning' | 'implementation';

// ... inside `export interface AgentConfig { ... }` add:
//   /** Extended-thinking budget — 'xhigh' for the Reasoning role; undefined otherwise.
//    * Pipeline-internal marker (Groundswell AgentConfig does not model thinking). */
//   readonly thinking?: ThinkingLevel;

/**
 * Role → { tier, thinking } mapping (PRD §9.2.3 / §6.1).
 *
 * @remarks
 * Single source of truth for the role→tier and role→budget decisions. `thinking` is OMITTED
 * on research/implementation (normal budget → field undefined); the Reasoning role carries
 * 'xhigh' (the maximum reasoning budget mandated by PRD §6.1 for decomposition/validation).
 *
 * @example
 * ```ts
 * ROLE_CONFIG.reasoning.tier;       // 'balanced'
 * ROLE_CONFIG.reasoning.thinking;   // 'xhigh'
 * ROLE_CONFIG.implementation.tier;  // 'fast'
 * ROLE_CONFIG.implementation.thinking; // undefined (omitted)
 * ```
 */
export const ROLE_CONFIG: Readonly<
  Record<ModelRole, { readonly tier: ModelTier; readonly thinking?: ThinkingLevel }>
> = {
  research: { tier: 'balanced' },
  reasoning: { tier: 'balanced', thinking: 'xhigh' },
  implementation: { tier: 'fast' },
} as const;
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/agents/agent-factory.ts — ADD the four new symbols
  - ADD import: `import type { ModelTier } from '../config/types.js';` (top, near other
    config imports — INPUT from P2.M1.T1).
  - ADD exported type `ThinkingLevel` (verbatim contract union, JSDoc noting SDK 'minimal'
    exclusion) — place near `AgentPersona` (after line ~58).
  - ADD exported type `ModelRole = 'research' | 'reasoning' | 'implementation'` with JSDoc,
    immediately after `ThinkingLevel`.
  - MODIFY `export interface AgentConfig`: ADD `readonly thinking?: ThinkingLevel;` field
    with JSDoc (inside the interface body, near `model`/`maxTokens`).
  - ADD exported `ROLE_CONFIG` constant (const-asserted Readonly<Record<ModelRole,...>>)
    near `PERSONA_TOKEN_LIMITS` (after line ~130), with the JSDoc above.
  - MODIFY `createBaseConfig`:
      * signature → `createBaseConfig(persona: AgentPersona, role: ModelRole = 'research'): AgentConfig`
      * body: `const { tier, thinking } = ROLE_CONFIG[role]; const model = getModel(tier);`
        (REPLACES `const model = getModel('balanced');` at line ~174)
      * return object: ADD `thinking,` alongside `model,`.
      * UPDATE the function JSDoc: note role-driven tier/thinking selection + that the
        default role is 'research' (balanced, normal budget); keep the existing Coder
        fast-tier override note (createCoderAgent still overrides — S2 will replace it).
        (NOTE: S3's PRP refreshes stale tier WORDS in this same JSDoc — if S3 lands first,
        your wording edit must not clobber S3's 'balanced'/'fast' wording; coordinate via
        the JSDoc block only, do not touch S3's other edits.)
  - FOLLOW pattern: readonly fields; `as const` config maps (mirror PERSONA_TOKEN_LIMITS,
    MODEL_NAMES); JSDoc `@remarks`/`@example` on every exported symbol (see AgentPersona).
  - NAMING: PascalCase types (ThinkingLevel, ModelRole); UPPER_SNAKE const (ROLE_CONFIG);
    lowercase union members.
  - DO NOT touch the 4 createXxxAgent functions (S2's lane). They compile unchanged.
  - PRESERVE: resolvedHarness() lazy-accessor, MCP singletons, PERSONA_TOKEN_LIMITS.

Task 2: MODIFY tests/unit/agents/agent-factory.test.ts — ADD roles/reasoning tests
  - ADD `import { ROLE_CONFIG, type ModelRole }` (and ThinkingLevel if needed for asserts)
    to the existing agent-factory import statement.
  - ADD a new `describe('model roles & reasoning budget', () => { ... })` block (sibling to
    the existing `describe('createBaseConfig', ...)`). Reuse the SAME beforeEach/afterEach
    env-stub pattern (vi.stubEnv ANTHROPIC_*; afterEach vi.unstubAllEnvs).
  - TESTS (cover all 3 roles + default + thinking field — drives 100% coverage):
      * it.each over the 3 roles: assert `createBaseConfig('architect', role).model` ===
        expected resolved model and `.thinking` === expected (research→'zai/glm-5.2'/undefined;
        reasoning→'zai/glm-5.2'/'xhigh'; implementation→'zai/glm-5-turbo'/undefined).
      * it('defaults role to research when omitted'): createBaseConfig('architect') (one arg)
        → model 'zai/glm-5.2', thinking undefined (asserts the default-param path).
      * it('ROLE_CONFIG maps each role to the correct tier and budget'): assert the 3
        entries' shape directly (covers the ROLE_CONFIG object literal).
  - FOLLOW pattern: existing createBaseConfig describe block (it.each, beforeEach stubEnv).
  - NAMING: test_{scenario} style in prose; describe('model roles & reasoning budget').
  - COVERAGE: every ROLE_CONFIG entry read, default + explicit role paths, thinking present
    (reasoning) + absent (research/implementation). (See Known Gotchas re: branch-free design.)
  - PLACEMENT: inside the existing top-level `describe('agents/agent-factory', ...)`.

Task 3: MODIFY docs/CONFIGURATION.md — ADD ### Model Roles subsection (Mode A)
  - FIND: `## Model Selection` → `### Model Tiers` table (line ~243). INSERT a new
    `### Model Roles` subsection immediately AFTER the `### When to Use Each Tier` prose
    (before `### Model Override`, ~line ~269).
  - CONTENT: a short intro sentence + a 3-row table (Role | Tier | Reasoning Budget |
    Pipeline agents) + a "Maximum reasoning budget" callout quoting PRD §6.1:
      * Research       | balanced | normal  | Researcher (PRP creation, architecture research)
      * Reasoning      | balanced | xhigh   | Architect (decomposition), Bug-finder, Validation
      * Implementation | fast     | normal  | Coder (PRP execution, post-validation fix)
    Callout: "Decomposition, creative bug-finding, and validation run at the MAXIMUM
    reasoning budget (extended-thinking 'xhigh') per PRD §6.1 / §9.2.3, because synthesizing
    research into a strict Phase→Milestone→Task→Subtask hierarchy is the most
    reasoning-intensive step."
  - FOLLOW pattern: existing ### Model Tiers table + "When to use" prose style.
  - GOTCHA: this is Mode A (doc-with-work) per PRD §6.1 — it rides WITH this subtask. Do
    NOT do a broader docs sweep (README/ARCHITECTURE) — that's P6 (Mode B).

Task 4: VERIFY — no functional regressions (read-only checks before declaring done)
  - RUN `npx tsc --noEmit -p tsconfig.build.json` → exit 0 (confirms the spread carve-out +
    new types compile; Groundswell createAgent unaffected).
  - RUN `npm run validate` → GREEN (lint + format:check + typecheck + test:run) with 100%
    coverage on src/**/*.ts preserved.
  - VERIFY existing assertions still green: createBaseConfig(p).model === 'zai/glm-5.2' for
    all 4 personas (default role 'research' → balanced).
  - VERIFY the 4 createXxxAgent functions are byte-identical to pre-S1 (diff src/agents/
    agent-factory.ts: only the 4 new symbols + createBaseConfig signature/body changed).
```

### Implementation Patterns & Key Details

```ts
// PATTERN: const-asserted Readonly<Record> config map (mirror PERSONA_TOKEN_LIMITS /
// src/config/constants.ts MODEL_NAMES). Branch-free for 100% coverage: OMIT `thinking`
// on entries that should be undefined (do NOT write `thinking: undefined`).
export const ROLE_CONFIG: Readonly<
  Record<ModelRole, { readonly tier: ModelTier; readonly thinking?: ThinkingLevel }>
> = {
  research:       { tier: 'balanced' },
  reasoning:      { tier: 'balanced', thinking: 'xhigh' },   // PRD §6.1 max budget
  implementation: { tier: 'fast' },
} as const;

// PATTERN: createBaseConfig drives model + thinking from ROLE_CONFIG (was hardcoded balanced).
export function createBaseConfig(
  persona: AgentPersona,
  role: ModelRole = 'research',   // DEFAULT 'research' → preserves all 4 one-arg callers
): AgentConfig {
  const { tier, thinking } = ROLE_CONFIG[role];   // destructure — no branch
  const model = getModel(tier);
  // ... name/system/maxTokens/env unchanged ...
  return { name, system, model, thinking, harness: resolvedHarness(),
           enableCache: true, enableReflection: true,
           maxTokens: PERSONA_TOKEN_LIMITS[persona],
           env: { /* unchanged */ } };
}

// CRITICAL: the createXxxAgent spread is SAFE — `thinking` arrives only via spread so
// TypeScript does NOT run excess-property checks against Groundswell's AgentConfig.
// Groundswell silently ignores the extra field. (PROVEN: tsc reproduction, exit 0.)
//   → createXxxAgent functions stay UNCHANGED (S2 owns persona→role remap).
```

### Integration Points

```yaml
TYPES (src/agents/agent-factory.ts):
  - export: ThinkingLevel, ModelRole (new exported types)
  - export: ROLE_CONFIG (new exported const)
  - field: AgentConfig.thinking?: ThinkingLevel (new readonly optional field)

CONFIG (READ-ONLY — INPUT from P2.M1.T1, already complete/landing):
  - consume: getModel(tier) from src/config/environment.ts
  - consume: ModelTier from src/config/types.ts

DOCS (docs/CONFIGURATION.md):
  - add: ### Model Roles subsection under ## Model Selection (Mode A doc-with-work)

NO DATABASE / NO ROUTES / NO ENV VARS / NO CLI — pure internal plumbing.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# After editing src/agents/agent-factory.ts:
npx tsc --noEmit -p tsconfig.build.json   # MUST be exit 0 (spread carve-out + new types)
npm run lint -- --ext .ts                  # eslint: fix any unused-import / naming issues
npm run format:check                        # prettier; run `npm run format` if it complains

# Expected: Zero errors. The tsc check is the headline gate — it proves adding `thinking?`
# to the local AgentConfig does NOT break the createXxxAgent → Groundswell createAgent spread.
```

### Level 2: Unit Tests (Component Validation)

```bash
# Run the agent-factory suite (gated — included by vitest include globs):
npx vitest run tests/unit/agents/agent-factory.test.ts

# Full suite + 100% coverage enforcement:
npm run test:run
npx vitest run --coverage   # thresholds: statements/branches/functions/lines = 100

# Expected: ALL green. Specifically verify the NEW describe('model roles & reasoning budget'):
#   - research  → model 'zai/glm-5.2', thinking undefined
#   - reasoning → model 'zai/glm-5.2', thinking 'xhigh'
#   - implementation → model 'zai/glm-5-turbo', thinking undefined
#   - default (one-arg) → research behavior
#   - ROLE_CONFIG shape (3 entries) covered
# AND the EXISTING assertions still pass (createBaseConfig(p).model === 'zai/glm-5.2' for all 4).
# If coverage < 100% on agent-factory.ts: a ROLE_CONFIG entry or the default-role path is
# untested — add/fix the test (see Known Gotchas: avoid `??` and `thinking: undefined`).
```

### Level 3: Integration Testing (System Validation)

```bash
# Full project validation gate (lint + format + typecheck + tests):
npm run validate

# Build (compiles dist — confirms no transitive breakage):
npm run build

# Expected: `npm run validate` GREEN; `npm run build` succeeds. No behavior change at runtime
# (default role 'research' is identical to today's hardcoded balanced tier).
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Confirm the contract OUTPUT symbols exist and are correctly shaped:
rg -n "export type (ThinkingLevel|ModelRole)\b|export const ROLE_CONFIG|readonly thinking\?" src/agents/agent-factory.ts

# Confirm the SDK 'minimal' is NOT in our union (contract narrowing):
rg -n "minimal" src/agents/agent-factory.ts   # EXPECT: only a JSDoc mention in the note, NOT in the union

# Confirm createXxxAgent functions are UNCHANGED (S2's lane):
git diff src/agents/agent-factory.ts -- | rg -n "createArchitectAgent|createResearcherAgent|createCoderAgent|createQAAgent" 
# EXPECT: no diffs inside those four function bodies (only createBaseConfig + new symbols changed)

# Confirm docs subsection landed:
rg -n "### Model Roles" docs/CONFIGURATION.md   # EXPECT: one match

# Expected: all four symbols present; 'minimal' only in JSDoc; createXxxAgent untouched; docs updated.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npx tsc --noEmit -p tsconfig.build.json` exit 0 (spread carve-out holds).
- [ ] `npm run validate` GREEN (lint + format:check + typecheck + test:run).
- [ ] `npm run build` succeeds.
- [ ] 100% coverage on `src/**/*.ts` preserved (`vitest run --coverage`).

### Feature Validation
- [ ] `ThinkingLevel`, `ModelRole`, `ROLE_CONFIG` exported from agent-factory.ts with JSDoc.
- [ ] `AgentConfig.thinking?: ThinkingLevel` field present (readonly optional).
- [ ] `createBaseConfig(persona, role = 'research')` resolves model+thinking from ROLE_CONFIG.
- [ ] reasoning role → thinking 'xhigh'; research/implementation → thinking undefined.
- [ ] default role 'research' preserves all existing assertions (no test regressions).
- [ ] The 4 createXxxAgent functions unchanged; `docs/CONFIGURATION.md` has `### Model Roles`.

### Code Quality Validation
- [ ] Follows existing readonly-field + `as const` config-map conventions (PERSONA_TOKEN_LIMITS).
- [ ] JSDoc on every new exported symbol (matches AgentPersona/AgentConfig style).
- [ ] `ThinkingLevel` is the pipeline's own union (not the SDK re-export); 'minimal' excluded.
- [ ] No new branches that would dent 100% coverage (ROLE_CONFIG omits `thinking` on normal roles).

### Documentation & Deployment
- [ ] Mode A `### Model Roles` subsection in docs/CONFIGURATION.md (rides with the work).
- [ ] No new env vars / CLI flags / routes (pure internal plumbing — nothing to document there).

---

## Anti-Patterns to Avoid

- ❌ Don't re-export the SDK's `ThinkingLevel` or add `'minimal'` — the contract narrows to six levels.
- ❌ Don't remap personas→roles in createXxxAgent — that's S2.
- ❌ Don't wire `thinking` into `harnessOptions`/pi `thinkingLevel` end-to-end — harness-layer, later.
- ❌ Don't touch `environment.ts`/`constants.ts`/`types.ts`/`getModel`/`ModelTier` — P2.M1.T1 owns them.
- ❌ Don't destructure/cast/strip `thinking` out of the createAgent spread — it's unnecessary (spread
  carve-out is proven safe) and signals a non-problem.
- ❌ Don't write `thinking: undefined` or `?? undefined` in ROLE_CONFIG — use omission for branch-free coverage.
- ❌ Don't default `role` to anything but `'research'` — any other default breaks the existing
  "all personas → zai/glm-5.2" createBaseConfig test.
- ❌ Don't edit the stale `glm-4.7` test TITLE or model-VALUE prose — S3/P6 lane.

---

## Confidence Score

**9/10** — One-pass success likelihood is high. The two technical risks (spread
excess-property breakage, and 100%-coverage branch traps) are both **pre-solved** by
proven research (isolated `tsc` reproduction; branch-free `ROLE_CONFIG` design). The
default-role backward-compat invariant is tabulated against every existing assertion.
The remaining 1/10 is the JSDoc-coordination seam with S3 on the `createBaseConfig`
function doc block (both S1 and S3 touch that JSDoc) — resolved by keeping S1's JSDoc
edit scoped to the role/tier/thinking description and not clobbering S3's tier-WORD
wording.