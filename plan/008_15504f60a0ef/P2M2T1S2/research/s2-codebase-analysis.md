# S2 Codebase Analysis — Map Personas to Roles

Research for **P2.M2.T1.S2** ("Map personas to three roles with correct budgets").
Starting state: **S1 is already implemented in the working tree (uncommitted).**

## 1. S1 is ALREADY present in the working tree (verified)

`git status --short` shows `src/agents/agent-factory.ts` and `tests/unit/agents/agent-factory.test.ts`
modified (S1, uncommitted). The S1 symbols exist:
- `src/agents/agent-factory.ts:114` `export type ThinkingLevel = 'off'|'low'|'medium'|'high'|'xhigh'|'max'`
- `:126` `export type ModelRole = 'research'|'reasoning'|'implementation'`
- `:158` `readonly thinking?: ThinkingLevel;` (on `AgentConfig`)
- `:199` `export const ROLE_CONFIG` = `{ research:{tier:'balanced'}, reasoning:{tier:'balanced',thinking:'xhigh'}, implementation:{tier:'fast'} } as const`
- `:238` `createBaseConfig(persona, role: ModelRole = 'research')` — destructures `{tier,thinking}` from ROLE_CONFIG, `getModel(tier)`, returns `thinking` in the object.

→ **S2's job is purely to UPDATE the four createXxxAgent call sites** to pass the correct role,
plus remove the now-redundant manual `model: getModel('fast')` override in createCoderAgent.

## 2. The four createXxxAgent functions — current bodies (post-S1, pre-S2)

All four still call ONE-ARG `createBaseConfig(<persona>)` → default role `'research'` → balanced tier.
Locations (file: `src/agents/agent-factory.ts`):
- `createArchitectAgent` ~:290 — `const baseConfig = createBaseConfig('architect');` then `{...baseConfig, system: TASK_BREAKDOWN_PROMPT, mcps: MCP_TOOLS}`.
- `createResearcherAgent` ~:321 — `createBaseConfig('researcher')` → `{...baseConfig, system: PRP_BLUEPRINT_PROMPT, mcps}`.
- `createCoderAgent` ~:352 — `createBaseConfig('coder')` then **`model: getModel('fast'),`** override (manual fast-tier), then `{system: PRP_BUILDER_PROMPT, mcps}`.
- `createQAAgent` ~:388 — `createBaseConfig('qa')` → `{...baseConfig, system: BUG_HUNT_PROMPT, mcps}`.

Each ends with `logger().debug({ persona, model: config.model }, 'Creating agent')` then `return createAgent(config);`.

## 3. CRITICAL — pre-existing stale integration test assertions (Finding A)

`tests/integration/agents.test.ts` asserts `createAgent` was called with specific models:
- **Architect** (line 272): `model: 'zai/glm-5.2'`
- **Researcher** (line 318): `model: 'zai/glm-5.2'`
- **Coder** (line 364): `model: 'zai/glm-5.2'` ← **STALE / already-wrong**
- **QA** (line 410): `model: 'zai/glm-5.2'`

### Why the Coder assertion is already wrong
The CURRENT implementation (pre-S2) overrides `model: getModel('fast')`. `.env` (loaded by
`tests/setup.ts`) does NOT set `PRP_MODEL_FAST`, so `getModel('fast')` resolves to the baked-in
`MODEL_NAMES.fast = 'glm-5-turbo'` → qualified `'zai/glm-5-turbo'`. The test asserts `'zai/glm-5.2'`.
→ This integration test is **already inconsistent** with the implementation (pre-existing S1/S2 bug).

### Impact on S2
After S2:
- Architect → reasoning → balanced → `glm-5.2` ✓ assertion stays correct (line 272).
- Researcher → research → balanced → `glm-5.2` ✓ assertion stays correct (line 318).
- QA → reasoning → balanced → `glm-5.2` ✓ assertion stays correct (line 410).
- **Coder → implementation → fast → `glm-5-turbo`** — line 364 assertion `'zai/glm-5.2'` is WRONG
  and MUST be corrected to `'zai/glm-5-turbo'` as part of S2.

### Is the integration test in the validate gate? YES.
`npm run validate` = `lint && format:check && typecheck && test:run`. `test:run` = `vitest run`.
`vitest.config.ts` include = `['tests/**/*.{test,spec}.ts']` → integration tests ARE run.
→ S2 MUST fix line 364 or `npm run validate` fails.

NOTE: This test also has NO `.thinking` assertions. S2 does not need to add thinking assertions
to the integration test (the unit test owns role/budget coverage).

## 4. Persona → Role mapping (the S2 contract) — confirmed from two sources

| Persona   | createXxxAgent role arg | Resolved tier | Resolved model | thinking |
|-----------|-------------------------|---------------|----------------|----------|
| architect | `'reasoning'`           | balanced      | `zai/glm-5.2`  | `'xhigh'`|
| researcher| `'research'`            | balanced      | `zai/glm-5.2`  | undefined|
| coder     | `'implementation'`      | fast          | `zai/glm-5-turbo` | undefined|
| qa        | `'reasoning'`           | balanced      | `zai/glm-5.2`  | `'xhigh'`|

Sources:
- `plan/008_15504f60a0ef/architecture/phase_findings.md` §PHASE 2 "Agent Persona → Role Mapping" table.
- Work-item contract (item_description): architect→reasoning(xhigh), researcher→research, coder→implementation, qa→reasoning(xhigh).
- PRD §9.2.3 (h4.2): Research=balanced/normal, Reasoning=balanced@xhigh, Implementation=fast.
- PRD §6.1 (h3.12): decomposition at MAX reasoning budget (xhigh).

## 5. The Coder fast-tier override becomes redundant after S2

Current createCoderAgent:
```ts
const baseConfig = createBaseConfig('coder');          // role 'research' → balanced
const config = { ...baseConfig, model: getModel('fast'), system: PRP_BUILDER_PROMPT, mcps: MCP_TOOLS };
```
After S2:
```ts
const baseConfig = createBaseConfig('coder', 'implementation'); // role 'implementation' → fast tier
const config = { ...baseConfig, system: PRP_BUILDER_PROMPT, mcps: MCP_TOOLS };
```
`createBaseConfig('coder','implementation')` already sets `model = getModel('fast')` and
`thinking = undefined`. The manual `model: getModel('fast')` line is **duplicate logic** (Finding B
from scout) and should be REMOVED so the role→tier indirection is the single source of truth.
The `getModel` import in agent-factory.ts remains used by createBaseConfig (via ROLE_CONFIG.tier),
so removing the manual override does NOT orphan the import.

## 6. Call sites of the four factories (blast radius of S2)

### Production (src/) — zero signature change (factories stay zero-arg `(): Agent`)
- `src/agents/prp-executor.ts:255` createCoderAgent
- `src/agents/prp-generator.ts:218` createResearcherAgent
- `src/workflows/prp-pipeline.ts:774` createArchitectAgent (dynamic import)
- `src/workflows/bug-hunt-workflow.ts:267` createQAAgent
- `src/workflows/delta-analysis-workflow.ts:121` createQAAgent

S2 does NOT change factory signatures (still zero-arg) → **all production call sites unchanged**.
Only the resolved model/thinking of the produced config changes (intended).

### Tests that mock the factories (vi.fn + mockReturnValue) — unaffected by S2
Factory signatures are unchanged; mocks continue to work. Files: `tests/e2e/delta.test.ts`,
`tests/e2e/pipeline.test.ts`, `tests/integration/prp-pipeline-integration.test.ts`,
`tests/integration/progressive-validation.test.ts`, `tests/integration/prp-executor-integration.test.ts`,
`tests/unit/workflows/*.test.ts`, `tests/unit/prp-cache-ttl.test.ts`.

### Tests that RUN the factories and assert on the model (integration) — see §3
Only `tests/integration/agents.test.ts` asserts model values; only the Coder assertion (line 364)
needs correction.

## 7. `thinking` field is write-only (no runtime consumer) — expected, NOT S2's concern

`AgentConfig.thinking` is populated by createBaseConfig but read by NOTHING in src/. Groundswell's
`createAgent` does not recognize `thinking` (verified via groundswell@1.0.1 dist types); the spread
suppresses excess-property checks; runtime: stored-and-ignored. This is by design (S1 doc: "pipeline-
internal budget marker; harness wiring is downstream"). The contract for S2 explicitly says "The xhigh
thinking budget is wired through to the pi harness `--thinking` lever" is a **downstream concern**
(harness-layer, later) — S2 only routes personas to roles; it does NOT wire thinking into the harness.

## 8. vitest.config.ts coverage gate (unchanged, still 100%)

- include `['tests/**/*.{test,spec}.ts']`; coverage include `['src/**/*.ts']`.
- thresholds: statements/branches/functions/lines = **100** global.
- S2 does NOT add branches to src/ (it only changes which role arg is passed — a literal string).
  createBaseConfig/ROLE_CONFIG are already 100%-covered by S1's unit tests. S2's role-arg change
  does not introduce new uncovered lines (each createXxxAgent already runs in tests).

## 9. Docs — S2 has NO doc deliverable

Work item item_description §5: "DOCS: none — no user-facing/config/API surface change beyond what
P2.M2.T1.S1 documented." S1 already added the `### Model Roles` subsection to docs/CONFIGURATION.md.
S2 touches ONLY src/ + the stale integration test. Do NOT edit docs/CONFIGURATION.md.

## 10. Scope fences (do NOT touch)
- `createBaseConfig`, `ROLE_CONFIG`, `ThinkingLevel`, `ModelRole`, `AgentConfig.thinking` → owned by S1.
- `getModel` / `ModelTier` / environment.ts / constants.ts / types.ts → owned by P2.M1.T1.
- Wiring `thinking` → `harnessOptions`/pi `thinkingLevel` end-to-end → harness-layer, later.
- S3 (demand-write retry xhigh) → separate subtask; S2 does not touch the orchestrator/retry path.