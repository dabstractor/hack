# Research Summary — P4.M2.T2.S1: Update BUG_FINDER_AGENT default `glp` → `pizr`

## Item contract (verbatim)

> CONTRACT DEFINITION:
> 1. RESEARCH NOTE: architecture/phase_findings.md §PHASE 4 documents: the QA Agent (bug-hunt) uses
>    createQAAgent() which is getModel('balanced') (was 'sonnet'). PRD §4.4/§9.2.2 specifies
>    BUG_FINDER_AGENT default changes glp → pizr (reasoning-tier). The QA Agent is the reasoning
>    persona at max budget.
> 2. INPUT: Three-role model from P2.M2.T1.S2 (qa → reasoning @ xhigh).
> 3. LOGIC: (a) Add BUG_FINDER_AGENT env var to constants.ts with default 'pizr'. (b) Update
>    createQAAgent() to resolve the model from BUG_FINDER_AGENT env (default pizr) instead of the
>    hardcoded balanced tier. (c) Ensure the bug-finder/QA agent runs as the reasoning persona at max
>    budget (xhigh), which P2.M2.T1.S2 already configured. (d) Update .env.example.
> 4. OUTPUT: BUG_FINDER_AGENT defaults to pizr. Completes P4.M2.T2.
> 5. DOCS: [Mode A] Add BUG_FINDER_AGENT to .env.example (update default); update docs/CONFIGURATION.md.

## Why this is the "VALIDATION_AGENT" sibling — S1 is the exact template

P4.M2.T1.S1 (COMPLETE) already shipped the **identical-shape** config surface for `VALIDATION_AGENT`
in `src/config/constants.ts`:

```typescript
export const VALIDATION_AGENT = 'VALIDATION_AGENT';
export const DEFAULT_VALIDATION_AGENT = 'pizr' as const;
export function getValidationAgent(): string {
  const raw = process.env[VALIDATION_AGENT];
  if (raw === undefined) { return DEFAULT_VALIDATION_AGENT; }
  const trimmed = raw.trim();
  return trimmed === '' ? DEFAULT_VALIDATION_AGENT : trimmed;
}
```

This item produces the **byte-for-byte analogous** triplet for `BUG_FINDER_AGENT`. The S1 research
summary (`plan/008_15504f60a0ef/P4M2T1S1/research/00_research_summary.md`) is the authoritative
template and explicitly calls out: *"BUG_FINDER_AGENT also does NOT exist in code (it is
P4.M2.T2.S1)."* → confirms clean-slate, no sibling getter to collide with.

## phase_findings.md §PHASE 4 — the RESEARCH NOTE source

`plan/008_15504f60a0ef/architecture/phase_findings.md` line 121 (verbatim):
> `BUG_FINDER_AGENT` default `glp` → `pizr`.

And lines 43–47, 55 document the current (post-P2) reality:
> `getModel(tier) = qualifyModel(process.env[MODEL_ENV_VARS[tier]] ?? MODEL_NAMES[tier])`
> `createBaseConfig(persona)` → all use `getModel('sonnet')`  *(now 'balanced' post-rename)*
> `5. xhigh reasoning: Wire --thinking xhigh into agent configs for architect/bug-finder/validation.`

→ confirms: (1) the only stale `glp` default lives in **docs only** (CONFIGURATION.md:178 table +
:494 example); (2) the reasoning persona wiring already exists (point 5 / P2.M2.T1.S2).

## The model/role reality (PRD §9.2.3 — DO NOT change the tier)

`src/agents/agent-factory.ts`:
- `ModelRole = 'research' | 'reasoning' | 'implementation'`
- `ROLE_CONFIG` (single source of truth):
  - `research: { tier: 'balanced' }`
  - `reasoning: { tier: 'balanced', thinking: 'xhigh' }` ← **bug-finder / QA lives here**
  - `implementation: { tier: 'fast' }`
- `createQAAgent()` → `createBaseConfig('qa', 'reasoning')` → balanced tier (`glm-5.2`) + `xhigh`.

PRD §9.2.3 (selected_prd_content) is unambiguous: *"the Reasoning role (BREAKDOWN_AGENT /
BUG_FINDER_AGENT / VALIDATION_AGENT) … run on the balanced model but at the maximum reasoning budget
(extended-thinking xhigh) … In the bash pipeline these are the `pizr` agent — `pi` with
`--thinking xhigh`."* So **`pizr` IS the balanced tier @ xhigh** — they are the same thing described
in two vocabularies (bash identifier vs TS role). Changing the tier away from `balanced` would
VIOLATE PRD §9.2.3 and contract point (c).

## Reconciling contract (b) "resolve the model from BUG_FINDER_AGENT env … instead of the hardcoded
balanced tier" with contract (c) "the reasoning persona at max budget (xhigh), which P2.M2.T1.S2
already configured"

(b) and (c) are reconciled exactly the way S1 reconciled the same wording for VALIDATION_AGENT
(see S1 research summary "Conclusion"): the env var is the **observable / configurable identity
knob** whose default `pizr` NAMES the reasoning persona; `createQAAgent()` is its **runtime
realization** (balanced tier @ xhigh). S1 did NOT change agent-factory.ts for VALIDATION_AGENT — it
only declared the config surface and had the *consumer workflow* (validation-workflow, S2) log
`getValidationAgent()`.

This item's contract additionally asks to **update `createQAAgent()`** (point b). The faithful,
sibling-safe, PRD-compliant mechanism is:
- Keep `createBaseConfig('qa', 'reasoning')` UNCHANGED (tier stays `balanced` — PRD §9.2.3, point c).
- Have `createQAAgent()` **read** `getBugFinderAgent()` and surface it in its existing `logger().debug`
  call as `bugFinderAgent` — i.e. "resolve the agent identity from BUG_FINDER_AGENT env at
  agent-creation time" instead of constructing the agent from a tier-only call with no env-driven
  identity. This is a real code change to createQAAgent (satisfies b) that does NOT alter the model
  tier (satisfies c + PRD §9.2.3).
- Update the `createQAAgent()` JSDoc to state it is the realization of `BUG_FINDER_AGENT` (default
  `pizr`).

### Sibling-safety of touching createQAAgent (it is shared)

`createQAAgent()` is consumed by:
- `src/workflows/bug-hunt-workflow.ts:267` (the bug-finder — primary)
- `src/workflows/delta-analysis-workflow.ts:121`
- `src/core/change-classifier.ts:112, :161`
- `src/workflows/validation-workflow.ts` (NEW, P4.M2.T1.S2 — being implemented in parallel)

ALL of these are the reasoning persona (validation also defaults to `pizr`). Adding a debug-level
`bugFinderAgent: getBugFinderAgent()` field to the existing `logger().debug(...)` call is therefore
harmless for every caller: the value is `'pizr'` (or a user override) in all cases, the log is
`debug`-level, and **no existing assertion reads that log**. Existing assertions use
`expect.objectContaining({ name, model, maxTokens, enableCache, enableReflection, system, mcps })`
(qa-agent.test.ts:262-365, agent-factory.test.ts:313-340) — none inspect the debug payload. Model
assertion `model: 'GLM-4.7'` (qa-agent.test.ts:284, under a stubbed env) still holds because
`createBaseConfig('qa','reasoning')` is unchanged → `getModel('balanced')` is unchanged.

## No circular-import risk

`src/config/constants.ts` has **zero** intra-project imports (pure `process.env` reads + literals).
Adding `import { getBugFinderAgent } from '../config/constants.js'` to `agent-factory.ts` introduces
no cycle. (agent-factory.ts already imports from `../config/environment.js` and `../config/types.js`.)

## Exact insertion points (grep-confirmed)

### constants.ts
The "Validation Control (PRD §4.4, §9.2.2)" banner section ends with `getValidationTimeoutSeconds()`
(~line 770). The next block is `PRD_INCLUDE_MAX_DEPTH` (~line 773). Insert a NEW banner
`// Bug Hunt Configuration (PRD §4.4, §9.2.2)` AFTER `getValidationTimeoutSeconds()` and BEFORE the
`PRD_INCLUDE_MAX_DEPTH` block — mirrors how S1 carved out Validation Control from the resilience
group. (BUG_RESULTS_FILE / BUGFIX_SCOPE are OUT OF SCOPE — only BUG_FINDER_AGENT is in this
contract.)

### agent-factory.ts
- Imports (top of file, ~lines 30-36): ADD `import { getBugFinderAgent } from '../config/constants.js';`
- `createQAAgent()` (~line 447-461): update JSDoc `@remarks` + extend the `logger().debug({...})`
  call with `bugFinderAgent: getBugFinderAgent()`.

### .env.example
S1 added a `# VALIDATION CONFIGURATION (OPTIONAL)` section immediately before `# SECURITY NOTES`.
Insert a NEW `# BUG HUNT CONFIGURATION (OPTIONAL)` section between the VALIDATION CONFIGURATION
section and SECURITY NOTES, documenting `BUG_FINDER_AGENT` (default `pizr`). (There is currently NO
bug-hunt section in .env.example — BUG_FINDER_AGENT etc. exist only in CONFIGURATION.md.)

### docs/CONFIGURATION.md
- Table row `BUG_FINDER_AGENT` (line 178): default `glp` → `pizr`; improve description.
- Example env block (line 494): `# BUG_FINDER_AGENT=glp` → `# BUG_FINDER_AGENT=pizr`.

## Test strategy (mirrors S1 two-tier precedent exactly)

1. **`tests/unit/config/constants.test.ts`** (MODIFY) — value-lock test mirroring the existing
   `describe('config/constants: DEFAULT_VALIDATION_AGENT (pizr)')` block (constants.test.ts:251). Add
   import `DEFAULT_BUG_FINDER_AGENT` + one describe block asserting `=== 'pizr'`. (constants.test.ts
   has NO env mutation — pure value locks — stays stable under the 100% gate.)

2. **`tests/unit/config/bug-finder-config.test.ts`** (NEW) — full `getBugFinderAgent()` branch
   coverage, mirroring `tests/unit/config/validation-config.test.ts`'s `getValidationAgent` describe
   block verbatim (same `beforeEach` env-reset / `afterEach vi.unstubAllEnvs` / `(a)..(f)` layout):
   unset→`pizr`, stubbed custom→honored, empty `''`→`pizr` (trim guard), whitespace `'   '`→`pizr`,
   trim `'  pizr  '`→`'pizr'`, explicit `'pizr'`→`'pizr'`. This single new file must hit 100% of
   every branch in the getter (vitest.config.ts:43-46 gates statements/branches/functions/lines at
   100%).

   The `getBugFinderAgent()` call inside `createQAAgent()` is a statement in `agent-factory.ts`; it
   is executed by the EXISTING `createQAAgent()` unit/integration tests (agent-factory.test.ts:313/336,
   qa-agent.test.ts:269) — no new assertion needed there (the debug log field is not asserted; the
   statement is covered by execution).

## Validation commands (verified against package.json)

- `npm run validate` = `npm run lint && npm run format:check && npm run typecheck && npm run test:run`
- `npm run test:coverage` = `vitest run --coverage` (gated 100% — vitest.config.ts:41-46)
- `npm run lint` = `eslint . --ext .ts`; `npm run format:check` = `prettier --check`
- `npm run typecheck` = `tsc --noEmit -p tsconfig.build.json`

## Scope boundaries (non-overlap)

- This item touches: `src/config/constants.ts` (ADD 3 exports), `src/agents/agent-factory.ts`
  (MODIFY createQAAgent: 1 import + JSDoc + 1 debug-log field), `tests/unit/config/constants.test.ts`
  (MODIFY: 1 describe block + import), `tests/unit/config/bug-finder-config.test.ts` (NEW),
  `.env.example` (MODIFY: 1 section), `docs/CONFIGURATION.md` (MODIFY: 1 table row + 1 example line).
- It does NOT touch: `ROLE_CONFIG` (tier stays `balanced`), `MODEL_NAMES`, any workflow file
  (bug-hunt-workflow is READ-ONLY), `BUG_RESULTS_FILE` / `BUGFIX_SCOPE` (out of scope), the parallel
  validation-workflow.ts (P4.M2.T1.S2 owns it).
- Parallel-execution note: P4.M2.T1.S2 (validation-workflow.ts) is being implemented concurrently.
  It consumes `createQAAgent()` and `getValidationAgent()`/`getValidationTimeoutSeconds()`. My change
  to `createQAAgent()` is strictly additive (a debug-log field + import) and does NOT alter the
  returned `Agent` / `AgentConfig` shape, so it cannot break S2's wiring or its mocked tests.