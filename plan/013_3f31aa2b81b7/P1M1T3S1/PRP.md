# PRP — P1.M1.T3.S1: Decouple `createBaseConfig` — explicit `thinking` param, strip `thinking` from `ROLE_CONFIG`

> Plan 013, PRD §9.2.9 (Per-Role Reasoning Level) → §9.2.3 (Model Selection). The "two independent axes"
> requirement: **which model a role runs** (tier) and **how hard it reasons** (thinking level) MUST be
> decoupled. Today `createBaseConfig` derives BOTH from `ROLE_CONFIG[role]` (reasoning→`xhigh`). **S1
> severs the coupling**: `ROLE_CONFIG` carries `tier` ONLY; `createBaseConfig` takes an explicit,
> **required** `thinking: ThinkingLevel` param composed onto the config INDEPENDENT of the tier. **S1 is a
> deliberate breaking step** — it leaves the 6 src call sites (5 factories + `commit-message-agent.ts`)
> with TS2554 arity errors that **S2** wires. Architecture spec:
> `plan/013_3f31aa2b81b7/architecture/integration-points.md §C`.

---

## Goal

**Feature Goal**: In `src/agents/agent-factory.ts`, (a) change `ROLE_CONFIG` to carry `tier` ONLY (delete
the `thinking` field from `reasoning`), and (b) change `createBaseConfig`'s signature to
`(persona: AgentPersona, role: ModelRole = 'research', thinking: ThinkingLevel): AgentConfig` — taking the
tier from `ROLE_CONFIG[role].tier` (UNCHANGED `getModel(tier)` resolution) and composing the **passed**
`thinking` onto the returned config's `thinking` field, **independent of role**. Update the
`createBaseConfig` + `ROLE_CONFIG` JSDoc (Mode A) to document the decoupling and the unchanged role→tier
mapping. Extend `tests/unit/agents/agent-factory.test.ts` with decoupling proof tests and adapt the
now-obsolete role→thinking assertions. **Intentionally leave the 6 src call sites broken for S2.**

**Deliverable**:
1. **`src/agents/agent-factory.ts`** — (a) `ROLE_CONFIG` retyped to `Readonly<Record<ModelRole, { readonly tier: ModelTier }>>` with `thinking` removed from `reasoning`; (b) `createBaseConfig` new signature + body (compose passed `thinking`); (c) updated JSDoc on `createBaseConfig`, `ROLE_CONFIG`, and the `ModelRole` budget clause; (d) updated `@example` blocks. `getModel(tier)`, `ModelRole`, `PERSONA_TOKEN_LIMITS`, `STATELESS_PERSONAS`, and the 5 factories are UNCHANGED (the factories' call-site breakage is the expected S2 work).
2. **`tests/unit/agents/agent-factory.test.ts`** — rewrite the `model roles & reasoning budget` describe + the `ROLE_CONFIG` shape test + the `default role` test to the new contract; ADD decoupling proof tests (reasoning role + `thinking:'off'` → balanced model + `thinking:'off'`; implementation role + `thinking:'xhigh'` → fast model + `thinking:'xhigh'`); update remaining 1-arg `createBaseConfig` calls to the 3-arg form for type-cleanliness.

**Success Definition**:
- `createBaseConfig('architect', 'reasoning', 'off')` → `model === 'zai/glm-5.2'` (reasoning role → balanced tier, UNCHANGED) AND `thinking === 'off'` (the passed level, NOT `xhigh`) — **the decoupling proof**.
- `createBaseConfig('coder', 'implementation', 'xhigh')` → `model === 'zai/glm-5-turbo'` (impl role → fast tier, UNCHANGED) AND `thinking === 'xhigh'`.
- `ROLE_CONFIG` has NO `thinking` field on any role; `ROLE_CONFIG.reasoning === { tier: 'balanced' }`.
- `npx vitest run tests/unit/agents/agent-factory.test.ts` is GREEN (new + adapted tests pass; the factory tests pass at runtime — they don't assert thinking).
- `npm run typecheck` (src-only) is EXPECTED to FAIL with **exactly** the 6 TS2554 "Expected 3 arguments, but got 2" errors at the known call sites (5 factories in `agent-factory.ts` + `commit-message-agent.ts:361`) — this is the deliberate S2 breakage, NOT a defect. No OTHER src errors are introduced.
- `npm run lint` + `npm run format:check` clean on the edited file.
- **No changes to** `getModel`, `ModelRole`, the factory bodies, `commit-message-agent.ts`, `PRD.md`, `spec/**`, `tasks.json`, or `prd_snapshot.md` (factory wiring + commit-message-agent are S2's job).

## User Persona

N/A — internal pipeline configuration composition. Indirect "users" are the factory functions (S2 wires
them) and, ultimately, pipeline operators who gain independent control of each role's model tier and
reasoning level (PRD §9.2.9 acceptance criteria).

## Why

- **Implements the §9.2.9 / §9.2.3 "two independent axes" requirement.** Today the reasoning budget is
  coupled to the role via `ROLE_CONFIG` (reasoning→`xhigh`), so the only lever to reduce reasoning was to
  switch tiers. Decoupling lets a role run a strong model with reasoning off (or a fast model with
  reasoning on) — exactly the §9.2.9 acceptance criterion.
- **`thinking` is REQUIRED (load-bearing), not optional.** A required param turns "factory forgot to
  resolve its level" into a loud TS2554 at the call site, forcing S2 to wire the real `getReasoning*()`
  level — eliminating the silent `undefined` that would re-couple the axes. This is why S1's typecheck RED
  is a feature, not a bug.
- **Unblocks S2 + S3.** S2 wires the 5 factories + `createQAAgent(level)` + `commit-message-agent`; S3
  updates the `createQAAgent` call sites to pass their resolved level. Both need the new signature.
- **Scope discipline.** S1 = the contract change (`ROLE_CONFIG` + `createBaseConfig` + their JSDoc + the
  `createBaseConfig` tests). S2 = factory wiring + commit-message-agent + `createQAAgent(level)` (different
  lines). S3 = the `createQAAgent` call sites (different files). T2.S2 (parallel) = `hack-config.ts` loader
  (different file). **Zero file-overlap.**

## What

### User-visible behavior
None directly (internal config composition). Indirectly, once S2/S3 land: each role's reasoning level is
independently configurable via `PRP_REASONING_*`, decoupled from its model tier.

### Technical requirements (exact contract)

**Decision: `thinking` is REQUIRED (no default).** Signature:
`createBaseConfig(persona: AgentPersona, role: ModelRole = 'research', thinking: ThinkingLevel): AgentConfig`.
(The `role` default stays; `thinking` follows it with no default — a required param after an optional one,
valid TS/JS. Callers omit role only via `createBaseConfig(persona, undefined, level)`.)

- **`ROLE_CONFIG`** → `Readonly<Record<ModelRole, { readonly tier: ModelTier }>>`; values
  `{ research:{tier:'balanced'}, reasoning:{tier:'balanced'}, implementation:{tier:'fast'} }`. **No `thinking`.**
- **`createBaseConfig` body** → `const { tier } = ROLE_CONFIG[role];` (destructure `tier` ONLY);
  `const model = getModel(tier);` (UNCHANGED); return `thinking` = the PASSED param. `getModel`, env
  mapping, persona naming, `stateless`, `maxTokens` all UNCHANGED.
- **JSDoc (Mode A)** → `createBaseConfig` JSDoc: state `thinking` is caller-resolved per §9.2.9,
  independent of tier; the role→tier model mapping is unchanged; `thinking` is required (no default).
  `ROLE_CONFIG` JSDoc: tier-only; thinking removed (decoupled). `ModelRole` JSDoc: drop the `'xhigh' budget`
  clause (now resolved per §9.2.9). Update the `@example` blocks to the 3-arg form.
- **Model resolution UNCHANGED** → `getModel(ROLE_CONFIG[role].tier)` produces the same model ids
  (research/reasoning → `zai/glm-5.2`; implementation → `zai/glm-5-turbo`).
- **6 src call sites left broken** (S2 wires them — do NOT touch): `agent-factory.ts` createArchitectAgent
  / createResearcherAgent / createCoderAgent / createQAAgent / createCleanupAgent, and
  `commit-message-agent.ts:361`.

### Success Criteria
- [ ] `ROLE_CONFIG` typed `Readonly<Record<ModelRole, { readonly tier: ModelTier }>>`; no `thinking` field anywhere.
- [ ] `createBaseConfig(persona, role='research', thinking: ThinkingLevel)`; body composes the passed `thinking`; `getModel(tier)` unchanged.
- [ ] JSDoc (Mode A) on `createBaseConfig` + `ROLE_CONFIG` (+ `ModelRole` budget clause) updated for the decoupling; `@example`s updated.
- [ ] Decoupling tests pass: reasoning role + `thinking:'off'` → balanced model + `thinking:'off'`; impl role + `thinking:'xhigh'` → fast model + `thinking:'xhigh'`.
- [ ] `npx vitest run tests/unit/agents/agent-factory.test.ts` GREEN.
- [ ] `npm run typecheck` fails with EXACTLY the 6 expected TS2554 errors (5 factories + commit-message-agent:361); no other new src errors.
- [ ] The 5 factory bodies + `commit-message-agent.ts` are UNCHANGED (S2's scope).

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_ **Yes.** The exact
current `ROLE_CONFIG` + `createBaseConfig` (with the verbatim body to preserve), the ready-to-paste
replacement code, the exact 6 breakage sites, the typecheck-gate reality (src-only; tests excluded), the
must-do + should-do test changes with copy-ready assertions, and the validation framing (runtime GREEN +
bounded typecheck RED) are all below.

### Documentation & References
```yaml
# MUST READ — ready-to-paste S1 code + the 6 breakage sites + the typecheck-gate reasoning + test plan
- docfile: plan/013_3f31aa2b81b7/P1M1T3S1/research/decouple-createBaseConfig.md
  section: "4. Ready-to-paste S1 code", "2. The 6 expected src breakage sites", "3. The typecheck gate reality", "5. Test changes", "7. Why thinking is REQUIRED"
  why: Copy-ready ROLE_CONFIG + createBaseConfig (with the inline comments to preserve), the exact TS2554
        sites S2 will close, why build typecheck is src-only (tests excluded) so runtime can be GREEN while
        src typechecks RED, and the must/should test edits.
  critical: thinking is REQUIRED (no default) — this is what makes the 6 call sites a loud error and forces
        S2 to wire the real getReasoning*() level. Do NOT give thinking a default.

# MUST READ — the architecture spec for this exact change (S1 = §C ROLE_CONFIG + createBaseConfig; S2 = §C factories + §D)
- docfile: plan/013_3f31aa2b81b7/architecture/integration-points.md
  section: "C. src/agents/agent-factory.ts" (ROLE_CONFIG + createBaseConfig lines), "D. commit-message-agent.ts:361"
  why: Pins the exact ROLE_CONFIG retyping, the createBaseConfig signature/body change, the unchanged
        getModel(tier), and the S2 factory-wiring targets (so S1 knows precisely what NOT to touch).
  critical: §C's "Factory wiring" + §D are S2's job. S1 stops at ROLE_CONFIG + createBaseConfig + JSDoc.

# AUTHORITATIVE SPEC — the two-axes requirement + per-role defaults + vocabulary
- docfile: PRD.md   # (provided in selected_prd_content §9.2.9 + §9.2.3)
  section: §9.2.9 "Per-Role Reasoning Level", §9.2.3 "Model Selection" ("two independent axes")
  why: The decoupling mandate, the vocabulary (off/minimal/low/medium/high/xhigh), the per-role defaults
        (research/breakdown/bug-finder/validation → high; impl → off), and "the role→tier model mapping is
        unchanged (research/breakdown/bug-finder/validation → balanced; implementation → fast)".

# INPUT TYPE — the reconciled ThinkingLevel (T1.S3, Complete)
- file: src/agents/agent-factory.ts
  section: line 122 (`export type ThinkingLevel = ReasoningLevel;`)
  why: The `thinking` param type. ReasoningLevel (constants.ts:1519) = 'off'|'minimal'|'low'|'medium'|
        'high'|'xhigh' ('max' dropped). READY — no type work needed in S1.

# EDIT TARGET — the file being changed (read it first; preserve the inline comments + unchanged parts)
- file: src/agents/agent-factory.ts
  why: ROLE_CONFIG (~L297-307) → strip thinking; createBaseConfig (~L360-410) → new signature/body;
        JSDoc on createBaseConfig + ROLE_CONFIG + ModelRole budget clause + @examples. KEEP getModel(),
        ModelRole, PERSONA_TOKEN_LIMITS, STATELESS_PERSONAS, and the 5 factory BODIES unchanged.
  gotcha: The factories (createArchitectAgent … createCleanupAgent) call createBaseConfig with 2 args —
        LEAVE THEM. They become the expected TS2554 errors S2 closes. Do NOT "helpfully" wire them.

# TEST PATTERN — the test file being extended/adapted
- file: tests/unit/agents/agent-factory.test.ts
  why: Mirror its describe/it.each/expect style. REWRITE the 'model roles & reasoning budget' describe
        (asserts the OLD role→thinking coupling) + the ROLE_CONFIG shape test + the default-role test;
        ADD the decoupling tests; update 1-arg createBaseConfig calls to 3-arg.
  gotcha: tsconfig.build.json EXCLUDES tests → npm run typecheck never checks this file; npx vitest run
        doesn't typecheck either. So the gate is RUNTIME. The factory tests (createArchitectAgent() etc.)
        pass at runtime (they don't assert thinking) — leave them.

# CONSUMERS (downstream — do NOT implement here)
- file: src/agents/agent-factory.ts   # the 5 factories — S2 wires createBaseConfig(persona, role, getReasoning*())
- file: src/agents/commit-message-agent.ts   # :361 — S2 adds the 'off' thinking arg
- section (S3): createQAAgent call sites in src/workflows/* + src/core/change-classifier.ts
```

### Current Codebase tree (edit surface)

```bash
src/agents/agent-factory.ts            # EDIT: ROLE_CONFIG (strip thinking) + createBaseConfig (signature/body) + JSDoc
  ├─ type ThinkingLevel = ReasoningLevel  (L122, T1.S3 — UNCHANGED, the input type)
  ├─ type ModelRole                        (L157 — UNCHANGED; JSDoc budget clause updated)
  ├─ const ROLE_CONFIG  (~L297)            # EDIT: tier only
  ├─ function createBaseConfig (~L360)     # EDIT: + required thinking param; compose passed thinking
  ├─ createArchitectAgent (L354)           # UNCHANGED — becomes TS2554 (S2 wires)
  ├─ createResearcherAgent (L386)          # UNCHANGED — becomes TS2554 (S2 wires)
  ├─ createCoderAgent (L419)               # UNCHANGED — becomes TS2554 (S2 wires)
  ├─ createQAAgent (L453)                  # UNCHANGED — becomes TS2554 (S2: createQAAgent(level))
  └─ createCleanupAgent (L506)             # UNCHANGED — becomes TS2554 (S2 wires)
src/agents/commit-message-agent.ts     # UNCHANGED — :361 becomes TS2554 (S2 wires 'off')
src/config/constants.ts                # READ-ONLY (ReasoningLevel/REASONING_LEVELS/getReasoning* — T1.S1/S2, Complete)
tests/unit/agents/agent-factory.test.ts # EDIT: rewrite role-budget + ROLE_CONFIG-shape + default-role; ADD decoupling tests
```

### Desired Codebase tree with files to be added/changed

```bash
src/agents/agent-factory.ts            # EDIT — ROLE_CONFIG + createBaseConfig + JSDoc (the contract change)
tests/unit/agents/agent-factory.test.ts # EDIT — adapt obsolete assertions + add decoupling proof
# (no new files; the 6 broken call sites are DELIBERATE — S2 closes them)
```

### Known Gotchas of our codebase & Library Quirks
```ts
// CRITICAL (scope): S1 changes ONLY ROLE_CONFIG + createBaseConfig + their JSDoc + the createBaseConfig
//   tests. Do NOT wire the factories, do NOT touch commit-message-agent.ts, do NOT change createQAAgent's
//   signature — all S2. Leaving those 6 call sites as TS2554 errors is the CONTRACT.

// CRITICAL (thinking is REQUIRED): give `thinking` NO default. A default would let the factories silently
//   produce thinking:undefined with no error — re-coupling the axes the §9.2.9 work is meant to sever.
//   The required param is what forces S2 to wire the real getReasoning*() level.

// GOTCHA (typecheck gate): npm run typecheck = tsc -p tsconfig.build.json, which EXCLUDES tests
//   (include: src/**, exclude: tests). So after S1 it FAILS only on the 6 SRC call sites — NEVER on the
//   test file. And npx vitest run does NOT typecheck (esbuild strips types). So runtime can be GREEN while
//   src typechecks RED. Do NOT "fix" the 6 src errors — that is S2's job and S1's typecheck RED is expected.

// GOTCHA (getModel unchanged): the model id comes from getModel(ROLE_CONFIG[role].tier) — UNCHANGED.
//   Only the thinking SOURCE changes. research/reasoning still → zai/glm-5.2; implementation → zai/glm-5-turbo.

// GOTCHA (factory tests at runtime): createArchitectAgent() etc. internally call createBaseConfig with 2
//   args → at runtime thinking=undefined. The factory tests assert agent.name/.not.toThrow(), NOT thinking,
//   so they PASS at runtime. Leave them — do not edit factory tests.

// GOTCHA (JSDoc @example): the @example blocks (agent-factory.ts:19, 288-291) are comments, not type-
//   checked, but update them to the 3-arg form for Mode A accuracy.
```

## Implementation Blueprint

### Data models and structure
No new data models. `ThinkingLevel` (the `thinking` param type) already exists (T1.S3: alias of
`ReasoningLevel`). `ROLE_CONFIG`'s value type shrinks (`{ tier }` only); `createBaseConfig`'s signature
gains a required param. `ModelRole`, `AgentConfig`, `ModelTier` are UNCHANGED.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT src/agents/agent-factory.ts — ROLE_CONFIG (strip thinking) + createBaseConfig (signature/body) + JSDoc
  - (a) ROLE_CONFIG: retype to `Readonly<Record<ModelRole, { readonly tier: ModelTier }>>`; delete `thinking`
        from the value type AND from `reasoning` (now `{ tier:'balanced' }`). COPY-READY in research §4a.
  - (b) createBaseConfig: signature `(persona, role='research', thinking: ThinkingLevel)`; body
        `const { tier } = ROLE_CONFIG[role];` + `const model = getModel(tier);` + return passed `thinking`.
        Preserve the existing inline comments EXCEPT the now-false "Tier + reasoning budget are driven by
        ROLE_CONFIG[role]" → replace with a tier-only note. COPY-READY in research §4b.
  - (c) JSDoc (Mode A): createBaseConfig (thinking caller-resolved per §9.2.9, independent of tier;
        required, no default; role→tier mapping unchanged); ROLE_CONFIG (tier-only; thinking removed);
        ModelRole (drop the 'xhigh budget' clause). Update @examples to 3-arg. COPY-READY in research §4a/4b/4c.
  - DO NOT: touch getModel, ModelRole type, PERSONA_TOKEN_LIMITS, STATELESS_PERSONAS, the 5 factory bodies,
        or commit-message-agent.ts.
  - NAMING/PLACEMENT: unchanged (same module, same identifiers).

Task 2: EDIT tests/unit/agents/agent-factory.test.ts — adapt obsolete assertions + add decoupling proof
  - (a) MUST-DO (FAIL at runtime if skipped): rewrite `describe('model roles & reasoning budget')` — the
        roleExpectations table asserts thinking per-role; convert to tier→model only OR to the decoupling
        contract. Update `should map each role ... in ROLE_CONFIG` → tier-only (`ROLE_CONFIG.reasoning`
        === `{tier:'balanced'}`, no thinking). Reframe `should default role to research when omitted` →
        `createBaseConfig('architect', undefined, 'high')` asserts balanced model + thinking 'high'.
  - (b) ADD decoupling tests (research §5b): reasoning role + 'off' → balanced model + 'off'; impl role +
        'xhigh' → fast model + 'xhigh'; `for (const level of REASONING_LEVELS) thinking === level`.
  - (c) SHOULD-DO: update remaining 1-arg `createBaseConfig(persona)` calls in the createBaseConfig +
        stateless describes to 3-arg (`createBaseConfig(persona, 'research', 'high')`) for type-cleanliness.
  - PRESERVE: the factory tests (createArchitectAgent() etc.) — they pass at runtime; do not edit them.
        The ThinkingLevel reconciliation describe (T1.S3) — unchanged.
  - FOLLOW pattern: existing describe/it.each/expect style; import REASONING_LEVELS already present.
```

### Implementation Patterns & Key Details
```ts
// PATTERN: createBaseConfig after S1 — tier from ROLE_CONFIG, thinking from the CALLER (research §4b)
export function createBaseConfig(
  persona: AgentPersona,
  role: ModelRole = 'research',
  thinking: ThinkingLevel            // REQUIRED — no default (load-bearing decoupling)
): AgentConfig {
  const { tier } = ROLE_CONFIG[role]; // tier ONLY — thinking no longer lives here
  const model = getModel(tier);       // UNCHANGED model resolution
  // …name/system/stateless/harness/env/maxTokens UNCHANGED…
  return { /* … */ thinking, /* … */ };  // the PASSED level, independent of role/tier
}

// PATTERN: the decoupling proof test (research §5b) — reasoning role, thinking OFF, balanced model
it('decouples thinking from role: a reasoning role can run with thinking off (PRD §9.2.9)', () => {
  const config = createBaseConfig('architect', 'reasoning', 'off');
  expect(config.model).toBe('zai/glm-5.2'); // reasoning role → balanced tier (UNCHANGED)
  expect(config.thinking).toBe('off');       // …but thinking is the PASSED level, NOT xhigh
});

// GOTCHA (above): leave the 5 factories + commit-message-agent.ts calling createBaseConfig with 2 args —
//   those 6 TS2554 errors are the EXPECTED S2 breakage. Do not wire them in S1.
```

### Integration Points
```yaml
SIGNATURE (src/agents/agent-factory.ts):
  - createBaseConfig: (persona, role='research', thinking: ThinkingLevel) => AgentConfig   # NEW required param
  - ROLE_CONFIG: Readonly<Record<ModelRole, { readonly tier: ModelTier }>>                  # thinking removed

DOWNSTREAM CONSUMERS (NOT this task — S2/S3 wire them; S1 leaves them as expected TS2554 errors):
  - S2: createArchitectAgent/Researcher/Coder/Cleanup → createBaseConfig(persona, role, getReasoning*())
  - S2: createQAAgent(reasoningLevel: ReasoningLevel) — new signature
  - S2: commit-message-agent.ts:361 → createBaseConfig('researcher','research','off')
  - S3: createQAAgent call sites in src/workflows/* + src/core/change-classifier.ts

NONE OF: getModel, ModelRole type, PERSONA_TOKEN_LIMITS, STATELESS_PERSONAS, PRD.md, spec/**,
         tasks.json, prd_snapshot.md, src/config/hack-config.ts (T2.S2, parallel).
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
npm run lint               # eslint . --ext .ts — clean on the edited file (eslint is not type-aware, so arity errors don't trip it)
npm run format:check       # prettier --check — clean (run `npm run format` if it flags)
# NOTE: npm run typecheck (tsc -p tsconfig.build.json) is EXPECTED TO FAIL — see Level 3.
```

### Level 2: Unit Tests (the PRIMARY gate — runtime GREEN)
```bash
npx vitest run tests/unit/agents/agent-factory.test.ts
# EXPECTED: GREEN. The new decoupling tests pass; the rewritten role-budget/ROLE_CONFIG/default-role
#   tests pass; the factory tests (createArchitectAgent() …) pass at runtime (they don't assert thinking);
#   the ThinkingLevel reconciliation describe (T1.S3) is unchanged & green.
# If the 'model roles & reasoning budget' or 'ROLE_CONFIG' shape tests fail, you skipped Task 2(a).
```

### Level 3: The Known-Breakage Gate (src typecheck RED — DELIBERATE)
```bash
# After S1, src typecheck MUST fail — but ONLY at the 6 expected call sites (S2 closes them).
npm run typecheck 2>&1 | grep "error TS2554"
# EXPECTED: 6 lines of "Expected 3 arguments, but got 2" at:
#   src/agents/agent-factory.ts (createArchitectAgent/Researcher/Coder/QA/Cleanup) + commit-message-agent.ts:361
# Confirm NO OTHER new src error was introduced:
npm run typecheck 2>&1 | grep "error TS" | grep -v "TS2554" | grep -vE "agent-factory\.ts|commit-message-agent\.ts" || echo "OK: no unexpected src errors"
# EXPECTED: "OK: no unexpected src errors" (or only pre-existing diagnostics unrelated to S1).
# CRITICAL: do NOT "fix" the 6 TS2554 errors by wiring the factories — that is S2's job. S1's typecheck
#   RED here is the contract; the required `thinking` param is what makes it loud.
```

### Level 4: Creative & Domain-Specific Validation
```bash
# Manual decoupling proof (no agent call) — print model + thinking for cross-axis combinations.
npx tsx -e "import { createBaseConfig } from './src/agents/agent-factory.js'; console.log('reasoning+off:', JSON.stringify({model: createBaseConfig('architect','reasoning','off').model, thinking: createBaseConfig('architect','reasoning','off').thinking})); console.log('impl+xhigh:', JSON.stringify({model: createBaseConfig('coder','implementation','xhigh').model, thinking: createBaseConfig('coder','implementation','xhigh').thinking}));"
# EXPECTED: reasoning+off: {"model":"zai/glm-5.2","thinking":"off"} ; impl+xhigh: {"model":"zai/glm-5-turbo","thinking":"xhigh"}
# (If npx tsx complains about the src type errors, it still transpiles & runs — esbuild strips types.)
```

## Final Validation Checklist

### Technical Validation
- [ ] Level 1 lint + format:check clean on the edited file.
- [ ] Level 2 `npx vitest run tests/unit/agents/agent-factory.test.ts` GREEN.
- [ ] Level 3 `npm run typecheck` fails with EXACTLY the 6 expected TS2554 errors; no other new src errors.
- [ ] Level 4 cross-axis proof prints the expected model+thinking combos.

### Feature Validation
- [ ] `ROLE_CONFIG` has no `thinking` field; `ROLE_CONFIG.reasoning === { tier: 'balanced' }`.
- [ ] `createBaseConfig` composes the PASSED `thinking`, independent of role; `getModel(tier)` unchanged.
- [ ] Decoupling tests prove: reasoning role + `off` → balanced model + `off`; impl role + `xhigh` → fast model + `xhigh`.

### Code Quality Validation
- [ ] `thinking` is REQUIRED (no default) — the load-bearing decoupling.
- [ ] JSDoc (Mode A) on createBaseConfig + ROLE_CONFIG (+ ModelRole budget clause) updated; @examples 3-arg.
- [ ] The 5 factory bodies + commit-message-agent.ts UNCHANGED (S2's scope); getModel/ModelRole/PERSONA_TOKEN_LIMITS/STATELESS_PERSONAS unchanged.

### Documentation & Deployment
- [ ] No docs changes in this task (P1.M2 owns changeset docs — separate milestone).
- [ ] No env-var additions (the `PRP_REASONING_*` getters already exist from T1.S2).

---

## Anti-Patterns to Avoid
- ❌ Don't give `thinking` a default — a default silently re-couples the axes (factories would emit `thinking: undefined` with no error). It MUST be required so the 6 call sites are loud TS2554 errors S2 is forced to wire.
- ❌ Don't wire the 5 factories or commit-message-agent.ts — that is S2's job; S1 deliberately leaves those 6 call sites broken.
- ❌ Don't change `createQAAgent`'s signature (`createQAAgent(level)`) — that is S2.
- ❌ Don't change `getModel`, `ModelRole`, `PERSONA_TOKEN_LIMITS`, or `STATELESS_PERSONAS` — only the thinking SOURCE changes.
- ❌ Don't panic at `npm run typecheck` RED — it is EXPECTED (src-only, the 6 known sites). Do not "fix" it in S1.
- ❌ Don't edit the factory tests (createArchitectAgent() etc.) — they pass at runtime; only the createBaseConfig-direct tests are S1's to adapt.
- ❌ Don't run the full TS test suite and treat the 6 expected TS2554 errors (or unrelated pre-existing diagnostics) as this task's failure — run the targeted vitest file (Level 2) + the bounded typecheck check (Level 3).
- ❌ Don't forget the must-do test rewrites (role-budget describe + ROLE_CONFIG shape + default-role) — they assert the OLD role→thinking coupling and will FAIL at runtime if not adapted.