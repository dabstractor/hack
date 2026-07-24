# PRP — P2.M2.T1.S2: Map personas to three roles with correct budgets

---

## Goal

**Feature Goal**: Wire the four agent personas to their **model roles** via the `createBaseConfig(persona, role)` overload that S1 shipped. Each `createXxxAgent` factory passes the role that encodes its PRD-mandated tier + reasoning budget: `architect → 'reasoning'` (xhigh), `researcher → 'research'` (normal), `coder → 'implementation'` (fast), `qa → 'reasoning'` (xhigh). Concretely: (1) flip the four `createXxxAgent` call sites from one-arg `createBaseConfig(persona)` to two-arg `createBaseConfig(persona, role)`; (2) remove the now-redundant manual `model: getModel('fast')` override in `createCoderAgent` (the role arg already drives the fast tier); (3) fix the one stale integration-test assertion that the Coder remap exposes. This is the **persona-routing layer** — the data model (S1) is already in place; S2 consumes it.

**Deliverable**:
1. **`src/agents/agent-factory.ts`** — UPDATE the four `createXxxAgent` factories: each calls `createBaseConfig(persona, role)` with the correct role (architect/researcher/coder/qa). REMOVE the `model: getModel('fast'),` manual override line from `createCoderAgent` (now redundant — role `'implementation'` drives it). UPDATE the JSDoc `@remarks` on each factory to state its role + budget. Update the stale "the Coder overrides to fast" comment on `createBaseConfig`/`createCoderAgent` so the docs match the code.
2. **`tests/integration/agents.test.ts`** — FIX line 364: the `createCoderAgent` assertion `model: 'zai/glm-5.2'` → `model: 'zai/glm-5-turbo'` (it was already wrong pre-S2; the role remap makes the correct value authoritative). Architect/Researcher/QA assertions stay `'zai/glm-5.2'` (unchanged).

**Success Definition**:
- `rg -n "createBaseConfig\(" src/agents/agent-factory.ts` → the four factories each pass a role literal: `('architect', 'reasoning')`, `('researcher', 'research')`, `('coder', 'implementation')`, `('qa', 'reasoning')`.
- `rg -n "model: getModel\('fast'\)" src/agents/agent-factory.ts` → **zero matches** (the manual override is gone; the fast tier is driven solely by `ROLE_CONFIG.implementation.tier`).
- `createArchitectAgent()` / `createQAAgent()` resolve to `model: 'zai/glm-5.2'` AND `thinking: 'xhigh'`; `createResearcherAgent()` → `model: 'zai/glm-5.2'`, `thinking: undefined`; `createCoderAgent()` → `model: 'zai/glm-5-turbo'`, `thinking: undefined`.
- `npm run validate` GREEN (lint + format:check + typecheck + `vitest run`) with **100% coverage on `src/**/*.ts`** preserved — including the corrected Coder integration assertion.
- Factory **signatures unchanged** (still zero-arg `(): Agent`) → every production call site and every mock is unaffected.

---

## User Persona (if applicable)

**Target User**: Pipeline maintainer / agent-factory contributor.
**Use Case**: Selecting which model tier + reasoning budget each pipeline agent runs with — by persona, via the role indirection — instead of hardcoding tiers at each factory.
**User Journey**: A maintainer reads a factory's JSDoc and immediately sees *"Architect: Reasoning role, xhigh budget"*; the `ROLE_CONFIG` table is the single source of truth for the resolved tier/budget. No call site needs to know model strings.
**Pain Points Addressed**: Today the four factories all pass one-arg `createBaseConfig` (defaulting to `'research'`/balanced) and the Coder paper-overs that with a literal `getModel('fast')` override — so the role model S1 introduced is bypassed and the tier decision lives in two places. S2 collapses it to one.

---

## Why

- **PRD compliance**: §9.2.3 (h4.2) mandates three model roles; §6.1 (h3.12) mandates decomposition at the **maximum reasoning budget** (`xhigh`); §6.5 (h3.16) places bug-finding at reasoning-tier. None of these are *exercised* until the personas actually request the roles.
- **Enables downstream**: The corrected personas are consumed by P2.M2.T1.S3 (xhigh demand-write retry reuses the architect/reasoning path), P3.M2.T3.S1 (stateless personas), P4.M2.T1.S1 (VALIDATION_AGENT reasoning), P4.M2.T2.S1 (BUG_FINDER_AGENT reasoning). S2 makes the role assignment authoritative so those tasks can rely on it.
- **Single source of truth**: Removing the Coder's manual `getModel('fast')` override means `ROLE_CONFIG` is the *only* place the tier→model decision lives (matches the S1 design intent and the scout's Finding B).
- **Fixes latent rot**: The integration test's Coder assertion (`'zai/glm-5.2'`) was already inconsistent with the implementation (which produces `'zai/glm-5-turbo'`). S2 corrects it as part of making the role remap authoritative.

### Out of scope (hard fences)
- The data model (`ThinkingLevel`, `ModelRole`, `ROLE_CONFIG`, `AgentConfig.thinking`, the `createBaseConfig` signature) → **S1** (already in the working tree). Do not modify.
- `getModel` / `ModelTier` / `MODEL_NAMES` / `environment.ts` / `constants.ts` / `types.ts` → **P2.M1.T1** (complete).
- Wiring `thinking` → `harnessOptions`/pi `thinkingLevel` end-to-end → **harness-layer, later**. S2 only *routes* personas to roles; the `thinking` value is stored (write-only marker) and read by nothing yet — that is by design.
- S3's xhigh demand-write retry in the orchestrator → **S3**. S2 does not touch the orchestrator/retry path.
- Documentation → **none**. The work item explicitly says "DOCS: none — no user-facing/config/API surface change beyond what P2.M2.T1.S1 documented." S1 already added `### Model Roles` to `docs/CONFIGURATION.md`. Do NOT edit docs.
- Adding a `validation` persona → not in scope (the existing `qa` persona serves bug-hunt; a separate VALIDATION_AGENT is P4.M2.T1).

---

## What

### User-visible behavior
None. Factory signatures are unchanged (zero-arg `(): Agent`). The only externally observable effect is the resolved `model`/`thinking` on the config each factory produces — which is exactly the intended PRD behavior.

### Technical requirements (exact contract — item 3a–d)

**(a) `createArchitectAgent` → role `'reasoning'`**
```ts
const baseConfig = createBaseConfig('architect', 'reasoning');
// → tier 'balanced' → model 'zai/glm-5.2'; thinking 'xhigh' (PRD §6.1 max reasoning budget)
```

**(b) `createResearcherAgent` → role `'research'`**
```ts
const baseConfig = createBaseConfig('researcher', 'research');
// → tier 'balanced' → model 'zai/glm-5.2'; thinking undefined (normal budget)
```

**(c) `createCoderAgent` → role `'implementation'` (removes manual fast override)**
```ts
const baseConfig = createBaseConfig('coder', 'implementation');
// → tier 'fast' → model 'zai/glm-5-turbo'; thinking undefined (normal budget)
// DELETE the old `model: getModel('fast'),` line — ROLE_CONFIG.implementation.tier drives it now.
const config = { ...baseConfig, system: PRP_BUILDER_PROMPT, mcps: MCP_TOOLS };
```

**(d) `createQAAgent` → role `'reasoning'`**
```ts
const baseConfig = createBaseConfig('qa', 'reasoning');
// → tier 'balanced' → model 'zai/glm-5.2'; thinking 'xhigh' (PRD §6.5 bug-finding is reasoning-tier)
```

**JSDoc refresh**: each factory's `@remarks` block must name its role + budget so a maintainer can read it without jumping to `ROLE_CONFIG`. Example for the Architect:
> *"Uses the Reasoning model role (balanced tier, `xhigh` reasoning budget per PRD §6.1) — decomposition is the most reasoning-intensive step. Uses the TASK_BREAKDOWN_PROMPT system prompt…"*

**Stale comment cleanup**: the `createBaseConfig` JSDoc comment *"the Coder overrides to fast"* (and the inline `// Default role 'research' → balanced tier (glm-5.2); the Coder overrides to fast.` note) becomes inaccurate once `createCoderAgent` routes through the role arg. Reword to reflect that the Coder now uses the `'implementation'` role (no manual override). Keep this wording change scoped — do NOT touch S3's tier-WORD wording if S3 lands concurrently (coordinate via the JSDoc block only).

### Success Criteria
- [ ] The four factories call `createBaseConfig(persona, role)` with `architect→'reasoning'`, `researcher→'research'`, `coder→'implementation'`, `qa→'reasoning'`.
- [ ] `createCoderAgent` has **no** `model: getModel('fast'),` line (role drives the tier).
- [ ] `createArchitectAgent()`/`createQAAgent()` produce config with `model: 'zai/glm-5.2'` and `thinking: 'xhigh'`.
- [ ] `createResearcherAgent()` produces `model: 'zai/glm-5.2'`, `thinking: undefined`.
- [ ] `createCoderAgent()` produces `model: 'zai/glm-5-turbo'`, `thinking: undefined`.
- [ ] `tests/integration/agents.test.ts` Coder assertion is `'zai/glm-5-turbo'`; the other three stay `'zai/glm-5.2'`.
- [ ] Factory signatures unchanged; production call sites + mocks unaffected.
- [ ] `npm run validate` GREEN; 100% coverage on `src/**/*.ts` preserved.

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_
**Yes.** S2 is a four-line-call-site change plus a one-line test fix, but the value is in knowing (1) S1's data model is already in the tree (verified), (2) the exact persona→role table (confirmed from the architecture findings + the work-item contract + PRD §9.2.3/§6.1), (3) the pre-existing stale Coder integration assertion that the remap exposes, and (4) the strict scope fences (no docs, no harness wiring, no data-model edits). Each is documented below with exact file:line anchors.

### Documentation & References
```yaml
# MUST READ — the PRD spec (source of truth for the three roles + xhigh rule)
- docfile: PRD.md
  section: "9.2.3 Model Selection" (h4.2)
  why: Defines Research=balanced/normal, Reasoning=balanced@xhigh, Implementation=fast. S2's
       persona→role table is the literal encoding of this section for the four existing personas.
  critical: Reasoning role = balanced model + xhigh thinking (NOT a different tier). QA bug-hunt is
       reasoning-tier (§6.5); decomposition (architect) is reasoning-tier (§6.1).
- docfile: PRD.md
  section: "6.1 Task Breakdown System Prompt" (h3.12)
  why: "Decomposition runs at the MAXIMUM reasoning budget (extended-thinking xhigh)." This is WHY
       the Architect maps to reasoning@xhigh.
  critical: The "demand write" retry uses the SAME xhigh budget — that's S3's wiring, not S2's.
- docfile: PRD.md
  section: "6.5 Creative Bug Finding Prompt" (h3.16)
  why: Bug-finding is reasoning-tier — this is WHY QA maps to reasoning@xhigh.

# MUST READ — the persona→role mapping table (confirms the S2 contract verbatim)
- docfile: plan/008_15504f60a0ef/architecture/phase_findings.md
  section: "PHASE 2 — Agent Persona → Role Mapping"
  why: The table maps architect→Reasoning/balanced/xhigh, researcher→Research/balanced/normal,
       coder→Implementation/fast/normal, qa→Reasoning/balanced/xhigh. This is the authoritative
       cross-check for item 3a–d.
  critical: A separate (new) `validation` persona is listed in the table but is OUT OF SCOPE for S2
       (P4.M2.T1 owns VALIDATION_AGENT). S2 touches only the four existing personas.

# MUST READ — upstream CONTRACT (S1; assume implemented exactly as specified — and it IS in the tree)
- docfile: plan/008_15504f60a0ef/P2M2T1S1/PRP.md
  section: "Goal / Deliverable / What (technical requirements)"
  why: S1 defines createBaseConfig(persona, role='research'), ROLE_CONFIG, ThinkingLevel, ModelRole,
       AgentConfig.thinking. S2 CONSUMES these as finished inputs. S2 must NOT modify any of them.
  critical: createBaseConfig('coder','implementation').model === 'zai/glm-5-turbo' and .thinking ===
       undefined (proven by S1). So the manual getModel('fast') override in createCoderAgent becomes
       redundant — REMOVE it.

# MUST READ — this subtask's research (proven facts about the working tree)
- docfile: plan/008_15504f60a0ef/P2M2T1S2/research/s2-codebase-analysis.md
  section: §1 (S1 already in tree), §2 (current factory bodies), §3 (stale Coder integration test),
       §4 (persona→role table), §5 (Coder override redundancy), §6 (call-site blast radius),
       §8 (100% coverage), §9 (no docs), §10 (scope fences)
  why: Proven: S1 symbols present; the four factories still call one-arg createBaseConfig; the Coder
       integration assertion is ALREADY stale (asserts glm-5.2 but impl produces glm-5-turbo); factory
       signatures are unchanged so all call sites/mocks are unaffected.

# THE FILES TO EDIT
- file: src/agents/agent-factory.ts
  why: EDIT the four createXxxAgent functions (each: add role arg to createBaseConfig call) + REMOVE
       the `model: getModel('fast'),` line in createCoderAgent + refresh the @remarks JSDoc on each
       factory + reword the stale "Coder overrides to fast" comment on createBaseConfig.
  pattern: each factory is ~15 lines: `const baseConfig = createBaseConfig(<persona>, <role>);`
       then `const config = { ...baseConfig, system: <PROMPT>, mcps: MCP_TOOLS };` then
       `logger().debug({persona, model: config.model}, 'Creating agent'); return createAgent(config);`
  gotcha: Do NOT change the factory signatures (zero-arg `(): Agent`) — all production call sites and
       every test mock depend on that. Do NOT touch createBaseConfig/ROLE_CONFIG/ThinkingLevel/
       ModelRole/AgentConfig (S1). Do NOT wire `thinking` into the harness (later).

- file: tests/integration/agents.test.ts
  why: FIX the createCoderAgent model assertion at line 364: 'zai/glm-5.2' → 'zai/glm-5-turbo'. The
       other three (Architect:272, Researcher:318, QA:410) stay 'zai/glm-5.2'. This test runs under
       `npm run validate` (vitest.config.ts include = tests/**/*.{test,spec}.ts).
  pattern: each describe block does `expect(createAgent).toHaveBeenCalledWith(expect.objectContaining({
       name, system, maxTokens, model, enableCache, enableReflection }))`.
  gotcha: This test does NOT assert `thinking` — leave it that way (the unit test owns role/budget
       coverage). Only the model value for Coder changes. The stale assertion was pre-existing (the
       impl already produced glm-5-turbo via the manual override); S2 just makes the correct value
       authoritative and fixes the assertion to match.

# CONTRACT INPUTS (read-only — owned by S1 / P2.M1.T1, already in the tree)
- file: src/agents/agent-factory.ts
  section: ROLE_CONFIG (line ~199), createBaseConfig (line ~238)
  why: createBaseConfig('persona', role) resolves tier+thinking from ROLE_CONFIG[role]. S2 calls it
       with the role literals; it returns model+thinking already set. READ-ONLY — do not edit these.
- file: src/config/environment.ts
  section: getModel(tier)
  why: Resolves tier → provider-qualified model. getModel('balanced')='zai/glm-5.2';
       getModel('fast')='zai/glm-5-turbo' (baked-in MODEL_NAMES.fast; .env has no PRP_MODEL_FAST).
       READ-ONLY — do not edit.
```

### Current Codebase tree (relevant slice)
```bash
src/
  agents/
    agent-factory.ts          # EDIT — 4 createXxxAgent factories (add role arg) + drop coder override
  config/
    environment.ts            # untouched (getModel) — INPUT only
    constants.ts              # untouched (MODEL_NAMES) — INPUT only
    types.ts                  # untouched (ModelTier) — INPUT only
tests/
  integration/
    agents.test.ts            # EDIT — fix Coder model assertion (line 364)
  unit/
    agents/agent-factory.test.ts  # untouched (S1 owns the roles/budget unit tests) — INPUT only
vitest.config.ts              # READ-ONLY — 100% coverage; include tests/**
package.json                  # READ-ONLY — `npm run validate` = lint+format:check+typecheck+test:run
```

### Desired Codebase tree with files to be added and responsibility of file
```bash
src/agents/agent-factory.ts   # MODIFIED — 4 factories route personas→roles; coder override removed;
                              #   JSDoc refreshed. No new symbols (S1 owns them).
tests/integration/agents.test.ts  # MODIFIED — Coder model assertion corrected to 'zai/glm-5-turbo'.
# (no NEW files, no docs changes)
```

### Known Gotchas of our codebase & Library Quirks
```ts
// CRITICAL (PRE-EXISTING BUG EXPOSED BY S2): tests/integration/agents.test.ts line 364 asserts
// createCoderAgent is called with model: 'zai/glm-5.2'. But the implementation (both pre- and
// post-S2) produces 'zai/glm-5-turbo' for the Coder (pre-S2 via the manual getModel('fast')
// override; post-S2 via ROLE_CONFIG.implementation.tier). The assertion was ALREADY wrong. S2 MUST
// correct it to 'zai/glm-5-turbo' or `npm run validate` fails. (The other three personas — architect,
// researcher, qa — correctly resolve to 'zai/glm-5.2' and need NO change.)
//   → Proven: .env has no PRP_MODEL_FAST; tests/setup.ts loads .env; getModel('fast') → baked-in
//     MODEL_NAMES.fast = 'glm-5-turbo' → qualified 'zai/glm-5-turbo'.

// CRITICAL: factory signatures MUST stay zero-arg `(): Agent`. All production call sites
// (prp-executor.ts:255, prp-generator.ts:218, prp-pipeline.ts:774, bug-hunt-workflow.ts:267,
// delta-analysis-workflow.ts:121) and ALL test mocks (vi.fn + mockReturnValue across e2e/integration/
// unit tests) depend on the zero-arg signature. S2 changes only the BODY of each factory (the role
// arg is passed internally to createBaseConfig), never the signature.

// CRITICAL: after removing the manual `model: getModel('fast')` override in createCoderAgent, do NOT
// remove the `getModel` import — createBaseConfig still uses it internally (via ROLE_CONFIG[role].tier).
// Only the redundant manual call site is removed.

// CRITICAL (100% coverage): vitest.config.ts enforces 100% (statements/branches/functions/lines) on
// src/**/*.ts. S2 changes NO branches in src/ — each factory was already executed by tests, and the
// role-arg change is a literal-string swap. createBaseConfig/ROLE_CONFIG remain 100%-covered by S1's
// unit tests. No new test lines are needed in src for coverage.

// GOTCHA: do NOT add `thinking` assertions to tests/integration/agents.test.ts. The integration test
// owns "createAgent was called with the right config shape"; the UNIT test (agent-factory.test.ts,
// S1-owned) owns the role→{tier,thinking} coverage. Keep concerns separated.

// GOTCHA: `thinking` is a write-only field (no src/ reader). Groundswell createAgent does NOT
// recognize it (spread suppresses excess-property checks; runtime stores-and-ignores). This is by
// design — harness wiring is a LATER task. S2 only routes personas to roles; it does NOT make the
// xhigh budget actually take effect at the harness. Do not attempt harness wiring in S2.

// GOTCHA: JSDoc-coordination seam with S3. Both S2 and S3 may touch prose in/near createBaseConfig's
// JSDoc. Keep S2's wording edit scoped to (a) each factory's @remarks (role + budget) and (b) the
// one stale "the Coder overrides to fast" comment that S2's code change makes inaccurate. Do not
// clobber S3's tier-WORD wording if S3 lands concurrently.

// GOTCHA: the existing unit test 'should use qualified glm-4.7 model for all personas' has a STALE
// TITLE (pre-existing) but asserts createBaseConfig(p).model === 'zai/glm-5.2' via the default
// 'research' role. S2 does NOT change createBaseConfig, so this stays green. Do NOT touch its title
// (S3/P6 lane).
```

---

## Implementation Blueprint

### Data models and structure
None. S2 adds NO new types, constants, or fields. It consumes S1's `ModelRole` / `ROLE_CONFIG` / `createBaseConfig(persona, role)` as-is.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/agents/agent-factory.ts — route the four factories to roles
  - createArchitectAgent (~line 290): change `createBaseConfig('architect')` →
      `createBaseConfig('architect', 'reasoning')`. (role reasoning → balanced tier, xhigh thinking)
  - createResearcherAgent (~line 321): change `createBaseConfig('researcher')` →
      `createBaseConfig('researcher', 'research')`. (role research → balanced tier, normal budget)
  - createCoderAgent (~line 352):
      * change `createBaseConfig('coder')` → `createBaseConfig('coder', 'implementation')`.
        (role implementation → fast tier, normal budget)
      * DELETE the `model: getModel('fast'),` line from the `config` object — ROLE_CONFIG.implementation
        .tier now drives the fast tier via createBaseConfig. The resulting config object becomes
        `{ ...baseConfig, system: PRP_BUILDER_PROMPT, mcps: MCP_TOOLS }` (matches the other three
        factories' shape).
      * DELETE the now-inaccurate inline comment "IMPL_AGENT role → fast tier ... the Coder overrides
        to 'fast' ..." (the override is gone; the role drives it).
  - createQAAgent (~line 388): change `createBaseConfig('qa')` →
      `createBaseConfig('qa', 'reasoning')`. (role reasoning → balanced tier, xhigh thinking; PRD §6.5)
  - FOLLOW pattern: each factory already does `const baseConfig = createBaseConfig(<persona>);` then
    spreads into `config`. Only the createBaseConfig call gains the role literal; the spread + logger
    + return are unchanged.
  - PRESERVE: factory signatures (`(): Agent`), the logger().debug({persona, model: config.model},
    'Creating agent') line in each, MCP_TOOLS, the system-prompt assignment.
  - DO NOT touch: createBaseConfig body, ROLE_CONFIG, ThinkingLevel, ModelRole, AgentConfig,
    resolvedHarness(), PERSONA_TOKEN_LIMITS, imports (getModel still used by createBaseConfig).

Task 2: MODIFY src/agents/agent-factory.ts — refresh JSDoc + stale comments
  - UPDATE each factory's @remarks to name its role + budget (one sentence each). Example (Architect):
      "Uses the **Reasoning** model role (balanced tier, `xhigh` reasoning budget per PRD §6.1 —
      decomposition is the most reasoning-intensive step). Uses the TASK_BREAKDOWN_PROMPT system
      prompt for analyzing PRDs and generating structured task hierarchies."
    Mirror the same one-liner pattern for Researcher (Research role, normal budget), Coder
    (Implementation role, fast tier, normal budget), QA (Reasoning role, xhigh; bug-finding is
    reasoning-tier per PRD §6.5).
  - REWORD the stale comment in createBaseConfig's JSDoc/body: "the Coder overrides to fast" /
      "Default role 'research' → balanced tier (glm-5.2); the Coder overrides to fast." → state that
      the Coder now uses the `'implementation'` role (fast tier) — no manual override. Keep the edit
      scoped to these specific sentences; do not rewrite the whole JSDoc block.
  - FOLLOW pattern: existing @remarks prose style (short, PRD-referencing).
  - GOTCHA: if S3 lands concurrently and edits tier-WORD prose in createBaseConfig's JSDoc, coordinate
      so S2's wording change and S3's tier-WORD change don't clobber each other. Touch only the
      sentences that become factually wrong due to S2's code change.

Task 3: MODIFY tests/integration/agents.test.ts — fix the Coder model assertion
  - FIND: describe('createCoderAgent') → it('should create coder agent with PRP_BUILDER_PROMPT')
    (line ~358-375). The `expect(createAgent).toHaveBeenCalledWith(expect.objectContaining({...}))`
    block currently asserts `model: 'zai/glm-5.2'` (line ~364).
  - CHANGE: `model: 'zai/glm-5.2'` → `model: 'zai/glm-5-turbo'`.
  - LEAVE UNCHANGED: the Architect (line ~272), Researcher (line ~318), QA (line ~410) assertions —
    they correctly expect 'zai/glm-5.2' and S2 keeps those personas on the balanced tier.
  - DO NOT add `thinking` assertions here (the unit test owns role/budget coverage).
  - FOLLOW pattern: existing objectContaining({ name, system, maxTokens, model, enableCache,
    enableReflection }) shape.
  - GOTCHA: this assertion was ALREADY inconsistent with the implementation (pre-S2 the manual
    getModel('fast') override produced glm-5-turbo). S2 makes the correct value authoritative and
    fixes the test to match — this is NOT introducing a new assertion, it is correcting a stale one.

Task 4: VERIFY — no functional regressions (read-only checks before declaring done)
  - RUN `npm run typecheck` (tsc --noEmit -p tsconfig.build.json) → exit 0 (confirms the role literals
    are valid ModelRole members; factory signatures still typecheck against call sites).
  - RUN `npm run validate` → GREEN (lint + format:check + typecheck + vitest run) with 100% coverage on
    src/**/*.ts preserved.
  - VERIFY the four role remaps produce the expected model+thinking. (See Validation §Level 4 for the
    exact rg/inline assertions.)
  - VERIFY no production call site or mock broke: factory signatures unchanged (zero-arg `(): Agent`).
  - VERIFY the `getModel` import is still used (createBaseConfig) — not orphaned.
```

### Implementation Patterns & Key Details

```ts
// PATTERN: each factory routes its persona to a role; createBaseConfig does the rest.
// Before S2 (all four):
export function createArchitectAgent(): Agent {
  const baseConfig = createBaseConfig('architect');            // one-arg → default 'research'
  const config = { ...baseConfig, system: TASK_BREAKDOWN_PROMPT, mcps: MCP_TOOLS };
  logger().debug({ persona: 'architect', model: config.model }, 'Creating agent');
  return createAgent(config);
}

// After S2 (architect → reasoning @ xhigh):
export function createArchitectAgent(): Agent {
  const baseConfig = createBaseConfig('architect', 'reasoning');   // balanced tier + xhigh thinking
  const config = { ...baseConfig, system: TASK_BREAKDOWN_PROMPT, mcps: MCP_TOOLS };
  logger().debug({ persona: 'architect', model: config.model }, 'Creating agent');
  return createAgent(config);
}

// After S2 (coder → implementation, fast tier — manual override REMOVED):
export function createCoderAgent(): Agent {
  const baseConfig = createBaseConfig('coder', 'implementation');  // fast tier via ROLE_CONFIG
  const config = { ...baseConfig, system: PRP_BUILDER_PROMPT, mcps: MCP_TOOLS }; // no model override
  logger().debug({ persona: 'coder', model: config.model }, 'Creating agent');
  return createAgent(config);
}
// (Researcher → 'research'; QA → 'reasoning' — same one-line change each.)

// CRITICAL: the resolved config for each persona (what S2 must produce):
//   architect : { model: 'zai/glm-5.2',  thinking: 'xhigh'    }  // reasoning
//   researcher: { model: 'zai/glm-5.2',  thinking: undefined  }  // research
//   coder     : { model: 'zai/glm-5-turbo', thinking: undefined} // implementation
//   qa        : { model: 'zai/glm-5.2',  thinking: 'xhigh'    }  // reasoning

// CRITICAL: factory signatures stay `(): Agent`. The role arg is passed INTERNALLY to
// createBaseConfig; no external caller sees it. All production call sites + test mocks unchanged.
```

### Integration Points

```yaml
AGENT-FACTORY (src/agents/agent-factory.ts):
  - consume: createBaseConfig(persona, role) — role literals: architect/researcher→'reasoning'/'research';
             coder→'implementation'; qa→'reasoning'.
  - remove: the manual `model: getModel('fast')` override in createCoderAgent (ROLE_CONFIG drives it).

TESTS (tests/integration/agents.test.ts):
  - fix: createCoderAgent model assertion → 'zai/glm-5-turbo' (was stale 'zai/glm-5.2').

NO DATABASE / NO ROUTES / NO ENV VARS / NO CLI / NO DOCS — pure internal persona routing.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# After editing src/agents/agent-factory.ts:
npm run typecheck        # tsc --noEmit -p tsconfig.build.json → MUST be exit 0
                          # (confirms role literals are valid ModelRole; signatures typecheck)
npm run lint -- --ext .ts # eslint: fix any unused-import / naming issues
npm run format:check       # prettier; run `npm run format` if it complains

# Expected: Zero errors. The typecheck confirms the four role literals ('reasoning'/'research'/
# 'implementation') are valid ModelRole members and the factory signatures still satisfy all callers.
```

### Level 2: Unit Tests (Component Validation)

```bash
# The agent-factory unit suite (S1-owned role/budget coverage — must stay green):
npx vitest run tests/unit/agents/agent-factory.test.ts

# The integration suite (includes the Coder assertion S2 corrects):
npx vitest run tests/integration/agents.test.ts

# Full suite + 100% coverage enforcement:
npm run test:run
npx vitest run --coverage   # thresholds: statements/branches/functions/lines = 100

# Expected: ALL green. Specifically:
#   - unit/agent-factory.test.ts: S1's describe('model roles & reasoning budget') still passes
#     (createBaseConfig/ROLE_CONFIG unchanged).
#   - integration/agents.test.ts: the Coder assertion now expects 'zai/glm-5-turbo' and PASSES;
#     Architect/Researcher/QA still expect 'zai/glm-5.2' and pass.
#   - coverage on src/**/*.ts stays 100% (S2 adds no branches to src/).
# If the Coder integration test still fails: you missed updating line ~364, OR createCoderAgent is
# not routing through 'implementation' (re-check Task 1).
```

### Level 3: Integration Testing (System Validation)

```bash
# Full project validation gate (lint + format:check + typecheck + tests):
npm run validate

# Build (compiles dist — confirms no transitive breakage):
npm run build

# Expected: `npm run validate` GREEN; `npm run build` succeeds. Runtime behavior change: architect/qa
# now carry thinking:'xhigh' on their config (inert until harness wiring lands — by design); coder
# resolves to glm-5-turbo via the role instead of the manual override (same observable model).
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Confirm the four factories route to the correct roles (exact contract):
rg -n "createBaseConfig\('architect', 'reasoning'\)|createBaseConfig\('researcher', 'research'\)|createBaseConfig\('coder', 'implementation'\)|createBaseConfig\('qa', 'reasoning'\)" src/agents/agent-factory.ts
# EXPECT: exactly four matches (one per factory).

# Confirm the manual coder override is GONE:
rg -n "model: getModel\('fast'\)" src/agents/agent-factory.ts
# EXPECT: zero matches (ROLE_CONFIG.implementation.tier drives the fast tier now).

# Confirm getModel is still imported+used (createBaseConfig) — not orphaned:
rg -n "getModel" src/agents/agent-factory.ts
# EXPECT: the import line + one use inside createBaseConfig (via getModel(tier)).

# Confirm factory signatures are unchanged (zero-arg):
rg -n "export function create(Architect|Researcher|Coder|QA)Agent\(\): Agent" src/agents/agent-factory.ts
# EXPECT: four matches — `(): Agent` (no new parameters).

# Confirm the integration Coder assertion is corrected:
rg -n "zai/glm-5-turbo" tests/integration/agents.test.ts
# EXPECT: at least one match in the createCoderAgent describe block.

# Inline sanity (optional, via a throwaway vitest or tsx -e): create each agent and print
# {model, thinking} to confirm the resolved values match the contract table in §"What".

# Expected: all four factories routed; coder override gone; getModel still used; signatures unchanged;
# integration assertion fixed.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` exit 0 (role literals valid; signatures satisfy callers).
- [ ] `npm run validate` GREEN (lint + format:check + typecheck + `vitest run`).
- [ ] `npm run build` succeeds.
- [ ] 100% coverage on `src/**/*.ts` preserved (`vitest run --coverage`).

### Feature Validation
- [ ] `createArchitectAgent` → `createBaseConfig('architect', 'reasoning')` (balanced + xhigh).
- [ ] `createResearcherAgent` → `createBaseConfig('researcher', 'research')` (balanced, normal).
- [ ] `createCoderAgent` → `createBaseConfig('coder', 'implementation')` (fast, normal); NO manual override.
- [ ] `createQAAgent` → `createBaseConfig('qa', 'reasoning')` (balanced + xhigh).
- [ ] `tests/integration/agents.test.ts` Coder assertion = `'zai/glm-5-turbo'`; others unchanged.
- [ ] Factory signatures unchanged (`(): Agent`); production call sites + mocks unaffected.

### Code Quality Validation
- [ ] Each factory's `@remarks` names its role + budget (PRD-referencing).
- [ ] Stale "Coder overrides to fast" comment reworded (no manual override anymore).
- [ ] `getModel` import not orphaned (still used by createBaseConfig).
- [ ] No new branches in src/ (role-arg swap is a literal change; coverage stays 100%).

### Documentation & Deployment
- [ ] No docs edits (S1 already added `### Model Roles`; work item says DOCS: none).
- [ ] No new env vars / CLI flags / routes (pure internal persona routing).

---

## Anti-Patterns to Avoid

- ❌ Don't change factory signatures (add params) — all production call sites + test mocks depend on zero-arg `(): Agent`.
- ❌ Don't touch `createBaseConfig` / `ROLE_CONFIG` / `ThinkingLevel` / `ModelRole` / `AgentConfig` — S1 owns them.
- ❌ Don't wire `thinking` into `harnessOptions`/pi `thinkingLevel` — harness-layer, later. S2 only *routes* personas to roles.
- ❌ Don't leave the manual `model: getModel('fast')` in createCoderAgent — it's redundant with `ROLE_CONFIG.implementation.tier` and duplicates the tier decision.
- ❌ Don't remove the `getModel` import — createBaseConfig still uses it (via `getModel(tier)`).
- ❌ Don't "fix" the Coder integration assertion by changing the implementation back to balanced — the fast tier is PRD-mandated for the Implementation role (§9.2.3). Fix the TEST, not the code.
- ❌ Don't add `thinking` assertions to `tests/integration/agents.test.ts` — the unit test owns role/budget coverage; keep concerns separated.
- ❌ Don't edit `docs/CONFIGURATION.md` — the work item says DOCS: none (S1 already documented Model Roles).
- ❌ Don't introduce a `validation` persona — that's P4.M2.T1 (VALIDATION_AGENT). S2 touches only the four existing personas.
- ❌ Don't touch the orchestrator/retry path (S3's xhigh demand-write retry) — out of scope for S2.

---

## Confidence Score

**9/10** — One-pass success likelihood is high. S2 is a small, well-bounded change (four call-site role literals + one redundant-override removal + one stale-test fix). The two risks are both pre-identified and pre-solved: (1) the **pre-existing stale Coder integration assertion** (line 364) — proven to be already-wrong and explicitly corrected in Task 3; (2) the **100%-coverage gate** — proven to be unaffected (S2 adds no branches to src/; the role literals are already-covered paths). The persona→role table is triple-confirmed (architecture findings + work-item contract + PRD §9.2.3/§6.1/§6.5). The remaining 1/10 is the JSDoc-coordination seam with S3 (both may edit createBaseConfig prose) — mitigated by scoping S2's wording change to the sentences S2's code change makes factually wrong.