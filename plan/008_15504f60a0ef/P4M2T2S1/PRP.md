# PRP — P4.M2.T2.S1: Update BUG_FINDER_AGENT default `glp` → `pizr`

---

## Goal

**Feature Goal**: Add the **`BUG_FINDER_AGENT`** env-var config surface (default **`pizr`**) to the TS
pipeline — the bug-finder analog of the `VALIDATION_AGENT` surface P4.M2.T1.S1 already shipped — and
wire `createQAAgent()` to **resolve + surface** that identifier at agent-creation time. PRD §4.4 /
§9.2.2 / §9.2.3 mandate: the bug-finder (QA) agent is the **reasoning-tier** persona (`pizr` = balanced
model @ maximum `xhigh` reasoning budget), realized in the TS rewrite by the existing `qa` persona +
`reasoning` role.

`architecture/phase_findings.md §PHASE 4` line 121 documents the one stale artifact verbatim:
*"`BUG_FINDER_AGENT` default `glp` → `pizr`."* Confirmed: the **only** stale `glp` default today lives in
**docs** (`docs/CONFIGURATION.md:178` table + `:494` example); there is **no** `BUG_FINDER_AGENT`
constant/getter in code yet (grep-clean — S1's research summary explicitly reserves it for this item).

**Deliverable** (1 new constant triplet + 1 modified agent factory + 2 doc files + 1 modified test + 1
new test file; **no** new dependency, **no** workflow change, **no** `ROLE_CONFIG`/model-tier change,
**no** new persona, **no** CLI flag):

1. **`src/config/constants.ts`** (MODIFY — ADD 3 exports) — `BUG_FINDER_AGENT` (env-var name) +
   `DEFAULT_BUG_FINDER_AGENT = 'pizr' as const` + `getBugFinderAgent(): string` (trim-empty → default
   guard). **Byte-for-byte analogous** to S1's `VALIDATION_AGENT` triplet. Inserted under a new
   `// Bug Hunt Configuration (PRD §4.4, §9.2.2)` banner placed immediately after the
   `// Validation Control (PRD §4.4, §9.2.2)` section.
2. **`src/agents/agent-factory.ts`** (MODIFY — `createQAAgent()`) — ADD `import { getBugFinderAgent }
   from '../config/constants.js'`; update the `createQAAgent()` JSDoc `@remarks` to state it is the
   runtime realization of `BUG_FINDER_AGENT` (default `pizr`); ADD a `bugFinderAgent:
   getBugFinderAgent()` field to the existing `logger().debug(...)` call. `createBaseConfig('qa',
   'reasoning')` is **UNCHANGED** — the model tier stays `balanced` @ `xhigh` (PRD §9.2.3 + contract
   point (c); "resolve the model from BUG_FINDER_AGENT env" = read/surface the env-driven agent
   identity, NOT change the tier).
3. **`.env.example`** (MODIFY — ADD 1 section) — new `# BUG HUNT CONFIGURATION (OPTIONAL)` section
   documenting `BUG_FINDER_AGENT` (default `pizr`), placed between the `# VALIDATION CONFIGURATION
   (OPTIONAL)` section (S1) and `# SECURITY NOTES`.
4. **`docs/CONFIGURATION.md`** (MODIFY — 2 edits) — table row `BUG_FINDER_AGENT` (`:178`) default
   `glp`→`pizr` (+ improved description); example env block (`:494`) `# BUG_FINDER_AGENT=glp`→
   `# BUG_FINDER_AGENT=pizr`.
5. **`tests/unit/config/constants.test.ts`** (MODIFY — ADD 1 import + 1 describe block) — value-lock
   test `DEFAULT_BUG_FINDER_AGENT === 'pizr'`, mirroring the existing
   `describe('config/constants: DEFAULT_VALIDATION_AGENT (pizr)')` block (`:251`).
6. **`tests/unit/config/bug-finder-config.test.ts`** (NEW) — full `getBugFinderAgent()` branch
   coverage, mirroring `tests/unit/config/validation-config.test.ts`'s `getValidationAgent` describe
   block verbatim (unset→`pizr`, custom→honored, empty→`pizr`, whitespace→`pizr`, trim, explicit
   `pizr`→`pizr`).

**Success Definition**:
- `BUG_FINDER_AGENT` is a real, env-driven, observable config knob defaulting to `pizr`
  (`getBugFinderAgent()`), available for import by any consumer.
- `createQAAgent()` reads `getBugFinderAgent()` and surfaces it in its debug log at agent-creation
  time; the `Agent`/`AgentConfig` it returns is byte-identical to before (model `zai/glm-5.2`,
  `thinking: 'xhigh'`, persona `qa`, stateless `true`) — the bug-finder IS the reasoning persona @ max
  budget, exactly as P2.M2.T1.S2 configured.
- `BUG_FINDER_AGENT` defaults to `pizr` everywhere user-facing: `.env.example`,
  `docs/CONFIGURATION.md` (table + example). No `glp` default remains.
- `npm run validate` GREEN; `npm run test:coverage` stays at 100% (new getter fully covered by the new
  test file; the new statement in `createQAAgent()` is exercised by existing `createQAAgent()` tests).
- `git diff --name-only` shows EXACTLY the 6 files above — **no** `ROLE_CONFIG`/`MODEL_NAMES` edit,
  **no** workflow edit, **no** `BUG_RESULTS_FILE`/`BUGFIX_SCOPE` (out of scope), **no** conflict with
  the parallel validation-workflow.ts (P4.M2.T1.S2).

---

## User Persona (if applicable)

**Target User**: A pipeline operator tuning which agent runs the creative bug-hunt (PRD §4.4 step 2),
or an auditor reading the config reference to understand the default bug-finder tier.

**Use Case**: "By default the bug-finder should run as the reasoning-tier persona (`pizr` — balanced
model at maximum `xhigh` reasoning budget), matching the bash pipeline's `pizr` agent and the
VALIDATION_AGENT default. I should be able to override it via `BUG_FINDER_AGENT=<id>` and see which id
is in effect."

**User Journey**: operator sets `BUG_FINDER_AGENT=pizr` (or leaves it unset → default `pizr`) →
pipeline reaches the QA & bug-hunt loop (PRD §4.4) → `createQAAgent()` constructs the reasoning
persona (balanced @ xhigh) and logs the resolved `bugFinderAgent` identifier for observability → the
bug-finder runs at max reasoning budget → `TEST_RESULTS.md` is produced.

**Pain Points Addressed**: today `BUG_FINDER_AGENT` is a doc-only concept with a stale `glp` default
and no code presence — there is no constant, no getter, no observability, and the documented default
contradicts PRD §9.2.2/§9.2.3 (which mandate `pizr`).

---

## Why

- **PRD compliance**: PRD §9.2.2 lists `BUG_FINDER_AGENT` under "Bug Hunt Configuration" with default
  `pizr` (reasoning-tier; see §9.2.3). PRD §9.2.3 mandates: *"the Reasoning role (BREAKDOWN_AGENT /
  BUG_FINDER_AGENT / VALIDATION_AGENT) … run on the balanced model but at the maximum reasoning budget
  (extended-thinking xhigh) … In the bash pipeline these are the `pizr` agent."* PRD §9.2.3 closing:
  *"These values should be read from the environment at runtime, not hardcoded."* → this item makes
  BUG_FINDER_AGENT a real env-read surface defaulting to `pizr`.
- **Work-item CONTRACT mapping**:
  - **CONTRACT (1) RESEARCH NOTE** — phase_findings §PHASE 4 line 121: *"`BUG_FINDER_AGENT` default
    `glp` → `pizr`."* → confirms the only stale `glp` is in docs; the persona wiring exists. ✓
  - **CONTRACT (2) INPUT** — *"Three-role model from P2.M2.T1.S2 (qa → reasoning @ xhigh)."* →
    `ROLE_CONFIG.reasoning = { tier: 'balanced', thinking: 'xhigh' }` already exists; CONSUMED, not
    redefined.
  - **CONTRACT (3) LOGIC** — (a) add `BUG_FINDER_AGENT` env var to constants.ts default `pizr` →
    Task 1; (b) update `createQAAgent()` to resolve the model from `BUG_FINDER_AGENT` env (default
    `pizr`) instead of [having only] the hardcoded balanced tier [with no env-driven identity] →
    Task 2 (read+surface `getBugFinderAgent()` at agent creation; tier UNCHANGED — see "Why the tier
    stays `balanced`"); (c) bug-finder/QA runs as reasoning persona @ max budget `xhigh` (already
    configured by P2.M2.T1.S2) → Task 2 keeps `createBaseConfig('qa','reasoning')` — no-op by design;
    (d) update `.env.example` → Task 3.
  - **CONTRACT (4) OUTPUT** — *"BUG_FINDER_AGENT defaults to pizr. Completes P4.M2.T2."* → ✓ (P4.M2.T2
    has only this one subtask).
  - **CONTRACT (5) DOCS** — *"[Mode A] Add BUG_FINDER_AGENT to .env.example (update default); update
    docs/CONFIGURATION.md. This rides WITH the work."* → Tasks 3 + 4.
- **Symmetry with S1**: `VALIDATION_AGENT` (P4.M2.T1.S1, COMPLETE) shipped the identical-shape
  triplet; this item closes the mirror gap for `BUG_FINDER_AGENT` so both reasoning-tier knobs
  (`BUG_FINDER_AGENT`, `VALIDATION_AGENT`) have first-class, tested, documented config surfaces.

### Why the model tier STAYS `balanced` (do not "change away from balanced")

Contract point (b) says *"resolve the model from BUG_FINDER_AGENT env (default pizr) instead of the
hardcoded balanced tier."* Read together with point (c) — *"the reasoning persona at max budget
(xhigh), which P2.M2.T1.S2 already configured"* — and PRD §9.2.3, the intent is: **make the agent
identity env-driven and observable** (read `BUG_FINDER_AGENT`, default `pizr`), NOT change the model
tier. PRD §9.2.3 is explicit that the reasoning role runs on the **balanced model** at `xhigh`, and
that `pizr` is precisely the bash name for that combination (`pi --thinking xhigh`). So `pizr`
**equals** balanced-@-xhigh; there is no different model to switch to. Changing `ROLE_CONFIG.reasoning`
away from `balanced` would violate PRD §9.2.3 and contract point (c).

This is the SAME reconciliation S1 applied to `VALIDATION_AGENT` (see S1 research summary
"Conclusion"): S1 declared the config surface and left `createQAAgent()` as the realization; the
validation *workflow* logs `getValidationAgent()`. This item additionally wires the read into
`createQAAgent()` itself (per contract b), as an additive debug-log field — the safest mechanism that
touches `createQAAgent()`, reads the env var at creation time, and cannot alter the returned
`Agent`/`AgentConfig`.

---

## What

A new `BUG_FINDER_AGENT` config triplet (constant + default + getter) in `constants.ts`, an additive
observability read inside `createQAAgent()` (no model/persona/shape change), a `.env.example` Bug Hunt
section, two `CONFIGURATION.md` doc edits, a value-lock test, and a new getter-coverage test file.

**No** new CLI flag, **no** `ROLE_CONFIG`/`MODEL_NAMES`/tier change, **no** new persona, **no**
workflow change, **no** `BUG_RESULTS_FILE`/`BUGFIX_SCOPE` (out of scope), **no** constants.ts edit
beyond the 3 new exports.

### Success Criteria

- [ ] **`src/config/constants.ts`** — ADD `BUG_FINDER_AGENT`, `DEFAULT_BUG_FINDER_AGENT = 'pizr' as
      const`, `getBugFinderAgent(): string` (trim-empty → default guard) under a new
      `// Bug Hunt Configuration (PRD §4.4, §9.2.2)` banner, immediately after the Validation Control
      section. Byte-for-byte analogous to the `VALIDATION_AGENT` triplet.
- [ ] **`src/agents/agent-factory.ts`** — ADD `import { getBugFinderAgent } from '../config/constants.js'`;
      update `createQAAgent()` JSDoc `@remarks`; ADD `bugFinderAgent: getBugFinderAgent()` to the
      existing `logger().debug(...)` call. `createBaseConfig('qa','reasoning')` UNCHANGED.
- [ ] **`.env.example`** — ADD `# BUG HUNT CONFIGURATION (OPTIONAL)` section with `# BUG_FINDER_AGENT=pizr`,
      between the VALIDATION CONFIGURATION section and SECURITY NOTES.
- [ ] **`docs/CONFIGURATION.md`** — table row `BUG_FINDER_AGENT` default `glp`→`pizr` (`:178`) +
      improved description; example block `# BUG_FINDER_AGENT=glp`→`# BUG_FINDER_AGENT=pizr` (`:494`).
- [ ] **`tests/unit/config/constants.test.ts`** — ADD `DEFAULT_BUG_FINDER_AGENT` import + a
      `describe('config/constants: DEFAULT_BUG_FINDER_AGENT (pizr)')` value-lock block.
- [ ] **`tests/unit/config/bug-finder-config.test.ts`** (NEW) — `getBugFinderAgent()` full branch
      coverage (unset/custom/empty/whitespace/trim/explicit), mirroring
      `validation-config.test.ts`'s `getValidationAgent` describe.
- [ ] `npm run validate` GREEN; `npm run test:coverage` 100% (global gate holds).
- [ ] `git diff --name-only` shows EXACTLY the 6 files above.

---

## All Needed Context

### Context Completeness Check

✅ "If someone knew nothing about this codebase, would they have everything needed to implement this
successfully?" — YES. This PRP names: the EXACT sibling template (S1's `VALIDATION_AGENT` triplet +
its test files); the EXACT insertion seams in `constants.ts` (after `getValidationTimeoutSeconds()`,
before `PRD_INCLUDE_MAX_DEPTH`), `agent-factory.ts` (import + `createQAAgent` debug log), `.env.example`
(between VALIDATION CONFIGURATION and SECURITY NOTES), and `CONFIGURATION.md` (`:178` table + `:494`
example); the EXACT test templates (`validation-config.test.ts`, `constants.test.ts:251`); the CRITICAL
"do NOT change the tier" reasoning; and the parallel-execution non-conflict guarantee.

### Documentation & References

```yaml
# MUST READ - Include these in your context window

- file: plan/008_15504f60a0ef/P4M2T2S1/research/00_research_summary.md
  why: THIS PRP's own research summary. Contains the contract reconciliation (b vs c), the
        sibling-safety proof for touching shared createQAAgent, the no-cycle proof, the exact
        insertion points, and the test strategy. READ FIRST.

- file: plan/008_15504f60a0ef/P4M2T1S1/research/00_research_summary.md
  section: "Primary file to MODIFY: src/config/constants.ts" + "Agent/role model" + "Test strategy".
  why: S1 shipped the IDENTICAL-SHAPE VALIDATION_AGENT surface. This item is its mirror. S1's
        research is the authoritative pattern source (triplet shape, banner placement, test layout,
        doc-ride-along). S1's "Conclusion" is the exact precedent for "do NOT change agent-factory /
        the reasoning persona already exists" — this item extends it by the one additive log field.

- file: src/config/constants.ts
  section: "Validation Control (PRD §4.4, §9.2.2)" banner (~:676-748) — VALIDATION_AGENT (:704),
           DEFAULT_VALIDATION_AGENT (:720), getValidationAgent (:740-747).
  why: THE BYTE-FOR-BYTE TEMPLATE for the BUG_FINDER_AGENT triplet. Copy the three exports, rename
        VALIDATION→BUG_FINDER, default stays 'pizr', same trim-empty guard. Insert the new triplet
        under a new "// Bug Hunt Configuration (PRD §4.4, §9.2.2)" banner IMMEDIATELY AFTER
        getValidationTimeoutSeconds() and BEFORE the PRD_INCLUDE_MAX_DEPTH block.

- file: src/agents/agent-factory.ts
  section: imports (:30-36); ROLE_CONFIG (:250-270 — reasoning = {tier:'balanced', thinking:'xhigh'});
           createQAAgent (:421-461 — createBaseConfig('qa','reasoning') + logger().debug).
  why: THE FILE THIS PRP MODIFIES (add 1 import + extend createQAAgent's debug log + JSDoc).
        ROLE_CONFIG.reasoning PROVES the bug-finder already runs balanced @ xhigh — DO NOT edit it.
  pattern: see "Implementation Blueprint" — the exact createQAAgent edit.
  gotcha: createQAAgent is SHARED (bug-hunt-workflow, delta-analysis-workflow, change-classifier, and
        the parallel validation-workflow). The edit is strictly additive (a debug-log field + import)
        and does NOT change the returned Agent/AgentConfig, so it cannot break any consumer or mock.

- file: tests/unit/config/validation-config.test.ts
  section: describe('config/constants: getValidationAgent') (:104-178) — the (a)..(f) case layout.
  why: THE TEST TEMPLATE for tests/unit/config/bug-finder-config.test.ts. Mirror verbatim, rename
        getValidationAgent→getBugFinderAgent, VALIDATION_AGENT→BUG_FINDER_AGENT,
        DEFAULT_VALIDATION_AGENT→DEFAULT_BUG_FINDER_AGENT. Same beforeEach env-reset +
        afterEach vi.unstubAllEnvs. This single file MUST hit 100% of every branch in the getter
        (the 100% gate in vitest.config.ts:43-46).

- file: tests/unit/config/constants.test.ts
  section: describe('config/constants: DEFAULT_VALIDATION_AGENT (pizr)') (:251-255).
  why: THE VALUE-LOCK TEMPLATE. Add a describe('config/constants: DEFAULT_BUG_FINDER_AGENT (pizr)')
        block + the DEFAULT_BUG_FINDER_AGENT import. constants.test.ts has NO env mutation (pure
        value locks) — keep it that way so it stays stable under the 100% gate.

- file: tests/integration/qa-agent.test.ts
  section: describe('createQAAgent configuration') (:262-365) — asserts name/model/maxTokens/
           enableCache/enableReflection/system/mcps via expect.objectContaining.
  why: PROVES the createQAAgent edit does not break existing assertions — NONE of them read the
        debug payload. model stays 'GLM-4.7' under the stubbed env because createBaseConfig('qa',
        'reasoning') is unchanged. READ-ONLY (no edit).

- file: .env.example
  section: "# VALIDATION CONFIGURATION (OPTIONAL)" section (added by S1), immediately before
           "# SECURITY NOTES".
  why: INSERTION SEAM. Add a new "# BUG HUNT CONFIGURATION (OPTIONAL)" section BETWEEN the
        VALIDATION CONFIGURATION section and SECURITY NOTES, documenting BUG_FINDER_AGENT (default
        pizr). Mirror the VALIDATION section's banner + comment style.

- file: docs/CONFIGURATION.md
  section: "### Bug Hunt Configuration" table row BUG_FINDER_AGENT (:178, default `glp`); the example
           env block "# BUG_FINDER_AGENT=glp" (:494).
  why: THE TWO STALE `glp` DEFAULTS TO FIX. :178 → default `pizr` + improved description; :494 →
        `# BUG_FINDER_AGENT=pizr`.

- file: PRD.md   # §9.2.2 "Bug Hunt Configuration" + §9.2.3 "Model Selection" — source of truth
  section: §9.2.2 (BUG_FINDER_AGENT default pizr, reasoning-tier) + §9.2.3 (Reasoning role = balanced
           model @ xhigh = the bash `pizr` agent; "values read from the environment at runtime, not
           hardcoded"). Verbatim text in selected_prd_content.
  why: THE REQUIREMENT. Quote it in JSDoc on getBugFinderAgent + the createQAAgent @remarks.

- file: plan/008_15504f60a0ef/architecture/phase_findings.md
  section: §PHASE 4, line 121 ("BUG_FINDER_AGENT default glp → pizr").
  why: THE RESEARCH NOTE the contract cites — confirms the stale `glp` is docs-only and the persona
        wiring already exists.
```

### Current Codebase tree (relevant slice)

```bash
src/config/
  constants.ts            # MODIFY — ADD BUG_FINDER_AGENT triplet (mirror VALIDATION_AGENT).
src/agents/
  agent-factory.ts        # MODIFY — createQAAgent(): + import getBugFinderAgent, + debug-log field,
                          #   + JSDoc. createBaseConfig('qa','reasoning') UNCHANGED.
tests/unit/config/
  constants.test.ts       # MODIFY — + DEFAULT_BUG_FINDER_AGENT value-lock describe + import.
  validation-config.test.ts     # READ-ONLY — the getValidationAgent TEST TEMPLATE.
  bug-finder-config.test.ts     # NEW — getBugFinderAgent() branch coverage (mirror above).
.env.example              # MODIFY — + "# BUG HUNT CONFIGURATION (OPTIONAL)" section.
docs/
  CONFIGURATION.md        # MODIFY — BUG_FINDER_AGENT table row glp→pizr (:178) + example (:494).
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
src/config/constants.ts
  # + export const BUG_FINDER_AGENT = 'BUG_FINDER_AGENT';
  # + export const DEFAULT_BUG_FINDER_AGENT = 'pizr' as const;
  # + export function getBugFinderAgent(): string   // trim-empty → DEFAULT_BUG_FINDER_AGENT
  #   (under a new "// Bug Hunt Configuration (PRD §4.4, §9.2.2)" banner)
src/agents/agent-factory.ts
  # + import { getBugFinderAgent } from '../config/constants.js';
  # createQAAgent():
  #   - JSDoc @remarks: "runtime realization of BUG_FINDER_AGENT (default pizr); reasoning persona
  #     (balanced tier @ xhigh) = the bash `pizr` agent (PRD §9.2.2/§9.2.3)"
  #   - logger().debug({ persona:'qa', model: config.model, bugFinderAgent: getBugFinderAgent() },
  #                    'Creating agent')
  #   - createBaseConfig('qa','reasoning') UNCHANGED
tests/unit/config/constants.test.ts
  # + import { DEFAULT_BUG_FINDER_AGENT }
  # + describe('config/constants: DEFAULT_BUG_FINDER_AGENT (pizr)') → expect === 'pizr'
tests/unit/config/bug-finder-config.test.ts   # NEW
  # getBugFinderAgent(): (a) unset→'pizr', (b) custom→honored, (c) ''→'pizr', (d) '   '→'pizr',
  #   (e) '  pizr  '→'pizr', (f) 'pizr'→'pizr'. Mirror validation-config.test.ts getValidationAgent.
.env.example
  # + "# BUG HUNT CONFIGURATION (OPTIONAL)" section w/ "# BUG_FINDER_AGENT=pizr" (default pizr)
docs/CONFIGURATION.md
  # :178 BUG_FINDER_AGENT default glp→pizr (+ improved description)
  # :494 "# BUG_FINDER_AGENT=glp" → "# BUG_FINDER_AGENT=pizr"
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL (the model tier STAYS balanced — do NOT "change away from balanced"): PRD §9.2.3 mandates
//   the Reasoning role runs on the BALANCED model @ xhigh, and that `pizr` IS that combination
//   (pi --thinking xhigh). Contract (c) confirms P2.M2.T1.S2 already configured ROLE_CONFIG.reasoning.
//   So "resolve the model from BUG_FINDER_AGENT env (default pizr)" = READ/SURFACE the env-driven
//   agent identity (getBugFinderAgent()), NOT swap the tier. Editing ROLE_CONFIG.reasoning would
//   violate PRD §9.2.3 + contract (c). Keep createBaseConfig('qa','reasoning') byte-identical.

// CRITICAL (createQAAgent is SHARED — additive edit only): createQAAgent() is consumed by
//   bug-hunt-workflow.ts:267, delta-analysis-workflow.ts:121, change-classifier.ts:112/:161, AND the
//   parallel validation-workflow.ts (P4.M2.T1.S2). The edit MUST NOT change the returned
//   Agent/AgentConfig shape (no new/removed/renamed field on the config object passed to createAgent).
//   Add ONLY: an import + a field inside the EXISTING logger().debug(...) payload + a JSDoc update.
//   Existing assertions (qa-agent.test.ts:262-365, agent-factory.test.ts:313-340) use
//   expect.objectContaining on name/model/maxTokens/enableCache/enableReflection/system/mcps — none
//   read the debug payload, so they keep passing. model stays 'GLM-4.7' under stubbed env because
//   getModel('balanced') is unchanged.

// CRITICAL (no circular import): src/config/constants.ts has ZERO intra-project imports (pure
//   process.env reads + literals). Adding `import { getBugFinderAgent } from '../config/constants.js'`
//   to agent-factory.ts introduces no cycle. (agent-factory.ts already imports from
//   ../config/environment.js and ../config/types.js.)

// CRITICAL (trim-empty guard — string analog of the numeric NaN/<=0 guard): getBugFinderAgent() MUST
//   fall back to DEFAULT_BUG_FINDER_AGENT when process.env[BUG_FINDER_AGENT] is undefined OR trims to
//   ''. An explicit empty value (BUG_FINDER_AGENT=) must NOT yield '' (which would silently break
//   observability / any future consumer). Mirror getValidationAgent() EXACTLY.

// GOTCHA (100% coverage gate): vitest.config.ts:43-46 enforces 100% stmt/branch/func/lines GLOBALLY.
//   The new getBugFinderAgent() has 3 branches (undefined / trim-empty / value) — bug-finder-config
//   .test.ts must exercise ALL of them. The new statement inside createQAAgent (getBugFinderAgent()
//   call) is covered by EXISTING createQAAgent() tests (agent-factory.test.ts:313/336,
//   qa-agent.test.ts:269) — no new assertion needed there.

// GOTCHA (ESM .js imports): intra-project imports use .js extensions in .ts source
//   (e.g. '../config/constants.js'). The new import follows this.

// GOTCHA (constants.test.ts has NO env mutation): it is pure value-locks only (no beforeEach env
//   stubbing) so it stays stable under the 100% gate. Do NOT add env-mutating cases there — put
//   env-mutating getter tests in the NEW bug-finder-config.test.ts (mirrors how S1 split
//   validation-config.test.ts from constants.test.ts).

// GOTCHA (banner placement): constants.ts groups exports under "// <Section> (PRD …)" comment
//   banners. Place the new triplet under a NEW "// Bug Hunt Configuration (PRD §4.4, §9.2.2)" banner
//   immediately AFTER getValidationTimeoutSeconds() (end of Validation Control) and BEFORE the
//   PRD_INCLUDE_MAX_DEPTH block. Unique, non-overlapping seam.
```

---

## Implementation Blueprint

### Data models and structure

```typescript
// === src/config/constants.ts — the BUG_FINDER_AGENT triplet (NEW, mirrors VALIDATION_AGENT) ===

/**
 * Environment variable name: the reasoning-tier agent used for creative bug discovery
 * (PRD §4.4 step 2, §9.2.2 "Bug Hunt Configuration").
 *
 * @remarks
 * The VALUE of this variable (read at runtime via {@link getBugFinderAgent}) is an agent identifier.
 * This constant is the env-var NAME itself. The DEFAULT ({@link DEFAULT_BUG_FINDER_AGENT}) is `pizr`
 * — the bash-pipeline reasoning agent (`pi` with `--thinking xhigh` per PRD §9.2.3); in the TS
 * rewrite the reasoning persona (balanced tier @ `xhigh`) realizes it via the `qa` persona
 * (`createQAAgent`, `agent-factory.ts`).
 *
 * @example
 * ```ts
 * import { BUG_FINDER_AGENT } from './config/constants.js';
 *
 * console.log(BUG_FINDER_AGENT); // 'BUG_FINDER_AGENT'
 * console.log(process.env[BUG_FINDER_AGENT]); // e.g. 'pizr'
 * ```
 */
export const BUG_FINDER_AGENT = 'BUG_FINDER_AGENT';

/**
 * Default bug-finder agent identifier (PRD §4.4, §9.2.2, §9.2.3).
 *
 * @remarks
 * `pizr` — the reasoning-tier agent. Uses `as const` to preserve the literal type (matches
 * {@link DEFAULT_VALIDATION_AGENT}).
 *
 * @example
 * ```ts
 * import { DEFAULT_BUG_FINDER_AGENT } from './config/constants.js';
 *
 * console.log(DEFAULT_BUG_FINDER_AGENT); // 'pizr'
 * ```
 */
export const DEFAULT_BUG_FINDER_AGENT = 'pizr' as const;

/**
 * Read the BUG_FINDER_AGENT env var (PRD §4.4, §9.2.2).
 *
 * @returns The configured bug-finder agent identifier, or {@link DEFAULT_BUG_FINDER_AGENT}
 *          (`'pizr'`) when unset or blank (empty/whitespace-only).
 *
 * @remarks
 * Mirrors {@link getValidationAgent} exactly (same trim-empty guard). The bug-finder agent is the
 * runtime reasoning persona (`createQAAgent`, balanced tier @ `xhigh` per PRD §9.2.3); this getter
 * surfaces the configured identifier for observability and honors a user override.
 *
 * @example
 * ```ts
 * import { getBugFinderAgent } from './config/constants.js';
 *
 * const agent = getBugFinderAgent(); // 'pizr' (default)
 * ```
 */
export function getBugFinderAgent(): string {
  const raw = process.env[BUG_FINDER_AGENT];
  if (raw === undefined) {
    return DEFAULT_BUG_FINDER_AGENT;
  }
  const trimmed = raw.trim();
  return trimmed === '' ? DEFAULT_BUG_FINDER_AGENT : trimmed;
}
```

```typescript
// === src/agents/agent-factory.ts — the createQAAgent() edit (MODIFY; additive only) ===

// NEW import (top of file, alongside the existing ../config/environment.js import):
import { getBugFinderAgent } from '../config/constants.js';

// createQAAgent() — ONLY the debug-log payload + JSDoc change. createBaseConfig UNCHANGED.
export function createQAAgent(): Agent {
  const baseConfig = createBaseConfig('qa', 'reasoning'); // UNCHANGED — balanced @ xhigh (PRD §9.2.3)
  const config = {
    ...baseConfig,
    system: BUG_HUNT_PROMPT,
    mcps: MCP_TOOLS,
  };
  logger().debug(
    { persona: 'qa', model: config.model, bugFinderAgent: getBugFinderAgent() }, // <-- ADDED field
    'Creating agent'
  );
  return createAgent(config);
}
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/config/constants.ts — ADD the BUG_FINDER_AGENT triplet
  - ADD a new "// Bug Hunt Configuration (PRD §4.4, §9.2.2)" banner IMMEDIATELY AFTER
    getValidationTimeoutSeconds() (end of the Validation Control section) and BEFORE the
    PRD_INCLUDE_MAX_DEPTH block.
  - UNDER that banner, ADD (byte-for-byte analogous to the VALIDATION_AGENT triplet at :704/:720/:740):
      export const BUG_FINDER_AGENT = 'BUG_FINDER_AGENT';
      export const DEFAULT_BUG_FINDER_AGENT = 'pizr' as const;
      export function getBugFinderAgent(): string { …trim-empty guard… }
  - COPY the FULL JSDoc blocks from VALIDATION_AGENT/DEFAULT_VALIDATION_AGENT/getValidationAgent and
    s/VALIDATION/BUG_FINDER/g, s/validation/bug discovery/g, citing PRD §4.4 step 2 + §9.2.2 + §9.2.3.
  - FOLLOW pattern: the VALIDATION_AGENT triplet (constants.ts:704-747) — the EXACT template.
  - NAMING: BUG_FINDER_AGENT (SCREAMING_SNAKE env name), DEFAULT_BUG_FINDER_AGENT (const),
    getBugFinderAgent (verb-first getter). Matches VALIDATION_AGENT/DEFAULT_VALIDATION_AGENT/
    getValidationAgent.
  - PLACEMENT: constants.ts, new banner section after Validation Control.
  - SCOPE: add ONLY BUG_FINDER_AGENT. Do NOT add BUG_RESULTS_FILE / BUGFIX_SCOPE (out of scope).

Task 2: MODIFY src/agents/agent-factory.ts — wire createQAAgent() to read BUG_FINDER_AGENT
  - ADD import: `import { getBugFinderAgent } from '../config/constants.js';` (near the existing
    `import { … } from '../config/environment.js';` line ~:30).
  - MODIFY createQAAgent()'s JSDoc `@remarks`: state it is the runtime realization of BUG_FINDER_AGENT
    (default `pizr`, PRD §9.2.2/§9.2.3) — the reasoning persona (balanced tier @ `xhigh`) = the bash
    `pizr` agent; the configured identifier is observable via getBugFinderAgent().
  - MODIFY the createQAAgent() debug log: add `bugFinderAgent: getBugFinderAgent()` to the EXISTING
    `logger().debug({ persona: 'qa', model: config.model }, 'Creating agent')` payload. Do NOT add a
    second log call; do NOT change the log level (debug).
  - DO NOT EDIT createBaseConfig('qa','reasoning'), ROLE_CONFIG, MODEL_NAMES, or any other factory.
  - FOLLOW pattern: the existing createQAAgent() debug log (:458-460).
  - NAMING: bugFinderAgent (camelCase log field key, matches persona/model style).
  - PLACEMENT: agent-factory.ts (import at top; edit inside createQAAgent only).

Task 3: MODIFY .env.example — ADD the BUG HUNT CONFIGURATION section
  - ADD a new section BETWEEN the "# VALIDATION CONFIGURATION (OPTIONAL)" section (added by S1) and
    the "# SECURITY NOTES" section:
      # =============================================================================
      # BUG HUNT CONFIGURATION (OPTIONAL)
      # =============================================================================
      # Reasoning-tier agent used for creative bug discovery (default: pizr). The bug-finder
      # runs as the reasoning persona at the maximum reasoning budget (xhigh). See PRD §4.4, §9.2.2,
      # §9.2.3.
      # BUG_FINDER_AGENT=pizr
  - FOLLOW pattern: the "# VALIDATION CONFIGURATION (OPTIONAL)" section banner + comment style.
  - SCOPE: document ONLY BUG_FINDER_AGENT (BUG_RESULTS_FILE/BUGFIX_SCOPE are out of scope).

Task 4: MODIFY docs/CONFIGURATION.md — fix the two stale `glp` defaults
  - EDIT the "### Bug Hunt Configuration" table row (:178): change `BUG_FINDER_AGENT` Default from
    `glp` to `pizr`; improve the Description to: "Reasoning-tier agent used for creative bug
    discovery (PRD §4.4, §9.2.3)." (mirror the VALIDATION_AGENT row's PRD-citing style).
  - EDIT the example env block (:494): change `# BUG_FINDER_AGENT=glp` to `# BUG_FINDER_AGENT=pizr`.
  - FOLLOW pattern: the VALIDATION_AGENT table row (:188) + the VALIDATION example block (:506-507).
  - SCOPE: ONLY the BUG_FINDER_AGENT row/line. Do NOT touch BUG_RESULTS_FILE / BUGFIX_SCOPE rows.

Task 5: MODIFY tests/unit/config/constants.test.ts — ADD the DEFAULT_BUG_FINDER_AGENT value-lock
  - ADD `DEFAULT_BUG_FINDER_AGENT` to the import from '../../../src/config/constants.js' (alongside
    the existing DEFAULT_VALIDATION_AGENT import, :32).
  - ADD a describe block immediately after the DEFAULT_VALIDATION_AGENT block (:251-255):
      describe('config/constants: DEFAULT_BUG_FINDER_AGENT (pizr)', () => {
        it('SHOULD be "pizr" (PRD §4.4/§9.2.2 — reasoning-tier bug-finder agent, default pizr)', () => {
          expect(DEFAULT_BUG_FINDER_AGENT).toBe('pizr');
        });
      });
  - FOLLOW pattern: the DEFAULT_VALIDATION_AGENT describe block (:251-255) — pure value lock, NO env
    mutation.
  - NAMING/PLACEMENT: constants.test.ts, value-lock block near the VALIDATION sibling.

Task 6: CREATE tests/unit/config/bug-finder-config.test.ts (NEW)
  - IMPLEMENT full getBugFinderAgent() branch coverage, MIRRORING the
    describe('config/constants: getValidationAgent') block in validation-config.test.ts:104-178
    VERBATIM in structure (beforeEach env-reset + afterEach vi.unstubAllEnvs + (a)..(f) layout).
  - IMPORT from '../../../src/config/constants.js': BUG_FINDER_AGENT, DEFAULT_BUG_FINDER_AGENT,
    getBugFinderAgent.
  - CASES (mirror getValidationAgent a..f exactly):
      (a) unset → DEFAULT_BUG_FINDER_AGENT ('pizr')
      (b) stubbed 'custom-reasoner' → 'custom-reasoner'
      (c) '' → DEFAULT_BUG_FINDER_AGENT ('pizr')   [trim-empty guard]
      (d) '   ' → DEFAULT_BUG_FINDER_AGENT ('pizr') [whitespace guard]
      (e) '  pizr  ' → 'pizr'                       [trim]
      (f) 'pizr' → DEFAULT_BUG_FINDER_AGENT ('pizr')
  - FOLLOW pattern: tests/unit/config/validation-config.test.ts:104-178.
  - COVERAGE: 100% of every branch in getBugFinderAgent (the global 100% gate).
  - PLACEMENT: tests/unit/config/bug-finder-config.test.ts.
```

### Implementation Patterns & Key Details

```typescript
// PATTERN (config triplet — mirror VALIDATION_AGENT EXACTLY). The trim-empty guard is the string
//   analog of the numeric getters' NaN/<=0 guard: an explicitly-empty value (BUG_FINDER_AGENT=)
//   falls back to the default rather than yielding ''.
export function getBugFinderAgent(): string {
  const raw = process.env[BUG_FINDER_AGENT];
  if (raw === undefined) {
    return DEFAULT_BUG_FINDER_AGENT;
  }
  const trimmed = raw.trim();
  return trimmed === '' ? DEFAULT_BUG_FINDER_AGENT : trimmed;
}

// PATTERN (createQAAgent additive edit — do NOT touch createBaseConfig):
export function createQAAgent(): Agent {
  const baseConfig = createBaseConfig('qa', 'reasoning'); // UNCHANGED — balanced @ xhigh (PRD §9.2.3)
  const config = { ...baseConfig, system: BUG_HUNT_PROMPT, mcps: MCP_TOOLS };
  logger().debug(
    // ADDED: bugFinderAgent field (reads BUG_FINDER_AGENT env at agent-creation time).
    // This is the faithful "resolve the agent identity from BUG_FINDER_AGENT env" — additive only;
    // the returned Agent/AgentConfig is byte-identical to before.
    { persona: 'qa', model: config.model, bugFinderAgent: getBugFinderAgent() },
    'Creating agent'
  );
  return createAgent(config);
}
```

### Integration Points

```yaml
CONFIG (constants.ts):
  - ADD: BUG_FINDER_AGENT / DEFAULT_BUG_FINDER_AGENT / getBugFinderAgent under a new
    "// Bug Hunt Configuration (PRD §4.4, §9.2.2)" banner.

AGENT FACTORY (agent-factory.ts):
  - ADD import: getBugFinderAgent from '../config/constants.js'.
  - MODIFY createQAAgent(): + JSDoc @remarks, + bugFinderAgent field in the debug-log payload.
    createBaseConfig('qa','reasoning') UNCHANGED.

DOCS:
  - .env.example: + "# BUG HUNT CONFIGURATION (OPTIONAL)" section (BUG_FINDER_AGENT=pizr).
  - docs/CONFIGURATION.md: BUG_FINDER_AGENT table row glp→pizr (:178) + example (:494).

NO DATABASE / NO ROUTES / NO CLI FLAG / NO ROLE_CONFIG / MODEL_NAMES / PERSONA CHANGE / NO WORKFLOW
  CHANGE / NO BUG_RESULTS_FILE / BUGFIX_SCOPE (out of scope) / NO validation-workflow.ts edit
  (parallel item P4.M2.T1.S2 owns it; my createQAAgent edit is additive and cannot affect it).
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Run after creating/editing each file — fix before proceeding
npm run lint            # eslint . --ext .ts  (expected: zero errors)
npm run format:check    # prettier --check    (run `npm run format` to fix)
npm run typecheck       # tsc --noEmit -p tsconfig.build.json (expected: zero errors)

# Canonical CI gate
npm run validate        # = lint && format:check && typecheck && test:run

# Expected: Zero errors. READ the output and fix before proceeding.
```

### Level 2: Unit Tests (Component Validation)

```bash
# New getter-coverage test
npx vitest run tests/unit/config/bug-finder-config.test.ts

# Modified value-lock test (constants)
npx vitest run tests/unit/config/constants.test.ts

# Regression: createQAAgent still constructs identically (the additive edit breaks nothing)
npx vitest run tests/unit/agents/agent-factory.test.ts
npx vitest run tests/integration/qa-agent.test.ts

# Full config + agents suites
npx vitest run tests/unit/config/
npx vitest run tests/unit/agents/

# Expected: All tests pass. If failing, debug root cause — the createQAAgent edit is additive, so a
# failure there means the edit accidentally changed the returned config (revert to additive-only).
```

### Level 3: Integration Testing (System Validation)

```bash
# Coverage gate — MUST stay 100% globally (vitest.config.ts:43-46)
npm run test:coverage

# Confirm the new getter + the new statement in createQAAgent are both covered. If the new
# createQAAgent statement shows uncovered, the existing createQAAgent tests did not execute it
# (unlikely — they call createQAAgent() directly); otherwise it is covered by execution.

# Grep guard — NO stale `glp` default remains anywhere user-facing
grep -rn "BUG_FINDER_AGENT=glp\|BUG_FINDER_AGENT.*glp" .env.example docs/CONFIGURATION.md
# Expected: NO matches (the default is now pizr everywhere).

# Grep guard — the new constant is importable & used
grep -rn "getBugFinderAgent" src/
# Expected: constants.ts (definition) + agent-factory.ts (createQAAgent call).

# Expected: coverage 100%; grep guards clean; createQAAgent integration tests GREEN.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Behavioral smoke: BUG_FINDER_AGENT default resolves to pizr, and an override is honored.
node --input-type=module -e "
import { getBugFinderAgent, DEFAULT_BUG_FINDER_AGENT } from './src/config/constants.ts';
console.log('default:', getBugFinderAgent(), '=== DEFAULT?', getBugFinderAgent() === DEFAULT_BUG_FINDER_AGENT);
process.env.BUG_FINDER_AGENT = 'custom-id';
console.log('override:', getBugFinderAgent());
delete process.env.BUG_FINDER_AGENT;
process.env.BUG_FINDER_AGENT = '   ';
console.log('whitespace:', getBugFinderAgent(), '=== pizr?', getBugFinderAgent() === 'pizr');
"
# Expected (ts-node/esbuild via node --loader or tsx): default: pizr === DEFAULT? true;
#   override: custom-id; whitespace: pizr === pizr? true.
# (If the project has no direct .ts runner, exercise the same via a temporary vitest case instead.)

# Documentation consistency: BUG_FINDER_AGENT appears in .env.example AND CONFIGURATION.md as pizr.
grep -n "BUG_FINDER_AGENT=pizr" .env.example docs/CONFIGURATION.md
# Expected: matches in both files.

# Expected: behavioral smoke matches the getter contract; docs consistent.
```

## Final Validation Checklist

### Technical Validation

- [ ] All 4 validation levels completed successfully
- [ ] `npm run validate` GREEN (lint + format:check + typecheck + test:run)
- [ ] `npm run test:coverage` 100% (global gate — new getter fully covered; createQAAgent statement
      covered by existing tests)
- [ ] No linting errors: `npm run lint`
- [ ] No type errors: `npm run typecheck`
- [ ] No formatting issues: `npm run format:check`

### Feature Validation

- [ ] `getBugFinderAgent()` returns `'pizr'` by default and honors a non-empty override (trim guard
      on empty/whitespace)
- [ ] `BUG_FINDER_AGENT` is exported from `src/config/constants.ts` with default `'pizr'`
- [ ] `createQAAgent()` reads `getBugFinderAgent()` and surfaces `bugFinderAgent` in its debug log;
      the returned `Agent`/`AgentConfig` is byte-identical to before (model `zai/glm-5.2`,
      `thinking: 'xhigh'`, persona `qa`, stateless `true`)
- [ ] `ROLE_CONFIG.reasoning` is UNCHANGED (`{ tier: 'balanced', thinking: 'xhigh' }`) — the
      bug-finder runs as the reasoning persona @ max budget (contract point c)
- [ ] `.env.example` has a BUG HUNT CONFIGURATION section with `BUG_FINDER_AGENT=pizr`
- [ ] `docs/CONFIGURATION.md` shows `BUG_FINDER_AGENT` default `pizr` (table + example); no `glp`
- [ ] Error cases handled: empty/whitespace `BUG_FINDER_AGENT=` → default `pizr` (no silent `''`)

### Code Quality Validation

- [ ] Follows existing codebase patterns (mirrors S1's VALIDATION_AGENT triplet + test split)
- [ ] File placement matches the desired codebase tree
- [ ] Anti-patterns avoided (no tier change, no shared-factory shape change, no env mutation in the
      value-lock test file)
- [ ] Dependencies properly managed (`getBugFinderAgent` imported via ESM `.js` extension; no cycle)
- [ ] JSDoc cites PRD §4.4 / §9.2.2 / §9.2.3 on the new exports + the edited `createQAAgent`

### Documentation & Deployment

- [ ] `.env.example` and `docs/CONFIGURATION.md` document `BUG_FINDER_AGENT` default `pizr`
- [ ] No new environment variables beyond `BUG_FINDER_AGENT` (BUG_RESULTS_FILE / BUGFIX_SCOPE out of
      scope)
- [ ] Code is self-documenting (JSDoc explains `pizr` = balanced @ xhigh = the bash reasoning agent)

---

## Anti-Patterns to Avoid

- ❌ Don't change `ROLE_CONFIG.reasoning` / the model tier — `pizr` IS balanced-@-xhigh (PRD §9.2.3);
      switching the tier violates the PRD and contract (c).
- ❌ Don't alter the `Agent`/`AgentConfig` returned by `createQAAgent()` — it is shared by validation,
      delta-analysis, and change-classifier; an additive debug-log field is the only safe edit.
- ❌ Don't add `BUG_RESULTS_FILE` / `BUGFIX_SCOPE` — out of scope (contract names only
      `BUG_FINDER_AGENT`).
- ❌ Don't put env-mutating getter tests in `constants.test.ts` (it is pure value-locks by convention;
      env-mutating tests live in the dedicated `bug-finder-config.test.ts`, mirroring S1's split).
- ❌ Don't duplicate the parallel `validation-workflow.ts` work (P4.M2.T1.S2) — this item's
      `createQAAgent` edit is additive and must not touch any workflow file.
- ❌ Don't skip the 100% coverage gate — the new getter's 3 branches must all be exercised.
- ❌ Don't catch all exceptions — be specific (not applicable here, but keep JSDoc accurate).