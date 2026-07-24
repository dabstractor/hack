# S1 Codebase Analysis — agent-factory role/reasoning plumbing

> Scope: P2.M2.T1.S1 — "Add reasoning budget config and role parameter to
> agent-factory". This is the PLUMBING layer. The data model
> (`ModelRole`, `ROLE_CONFIG`, `thinking` field) + a `createBaseConfig` role
> parameter. Downstream wiring (persona→role remap, xhigh demand-write retry)
> is P2.M2.T1.S2 / S3.

## 1. Target file: `src/agents/agent-factory.ts` (329 lines)

### 1a. Local `AgentConfig` interface (lines ~75–101)
A **project-local** interface (NOT Groundswell's). Current fields (all `readonly`):
`name, system, model, harness, enableCache, enableReflection, maxTokens, env`.
**No `thinking` field exists today.** This is where the contract item (a) lands.

### 1b. `createBaseConfig` (line 171)
```ts
export function createBaseConfig(persona: AgentPersona): AgentConfig {
  const model = getModel('balanced');          // hardcoded balanced tier
  const name = `${persona[0].toUpperCase()}${persona.slice(1)}Agent`;
  const system = `You are a ${persona} agent.`;
  return { name, system, model, harness: resolvedHarness(),
           enableCache: true, enableReflection: true,
           maxTokens: PERSONA_TOKEN_LIMITS[persona],
           env: { ANTHROPIC_API_KEY: resolveApiKeyForProvider(getResolvedProvider()) ?? '',
                  ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL ?? '' } };
}
```
Accepts **only `persona`** (matches phase_findings §PHASE 2 note: "createBaseConfig
(line 171) accepts only persona"). The contract changes the signature to
`createBaseConfig(persona, role)` and drives `model` tier + `thinking` from `ROLE_CONFIG`.

### 1c. `createXxxAgent` functions (lines ~215–329)
Four factory functions: `createArchitectAgent` (222), `createResearcherAgent` (253),
`createCoderAgent` (284), `createQAAgent` (316). Each does:
```ts
const baseConfig = createBaseConfig('<persona>');   // ONE-arg call (default role)
const config = { ...baseConfig, system: PROMPT, mcps: MCP_TOOLS };  // SPREAD into createAgent
// createCoderAgent additionally overrides: model: getModel('fast')
return createAgent(config);
```
**These 4 one-arg call sites are the ONLY internal callers of `createBaseConfig`**
(grep-confirmed: no external callers in `src/`). Giving `role` a **default value**
(`= 'research'`) keeps all 4 working UNMODIFIED — which is correct: remapping
personas→roles is **S2's lane**, not S1's.

## 2. Config layer (the inputs S1 consumes from P2.M1.T1.S3)

`src/config/environment.ts` exports `getModel(tier: ModelTier): string` — canonical-first
loader returning provider-qualified `'provider/model'` (e.g. `'zai/glm-5.2'`).
`src/config/types.ts` `ModelTier = 'high' | 'balanced' | 'fast'`. These are S1's
CONTRACT INPUTS (post P2.M1.T1.S3, tiers are already `high`/`balanced`/`fast`).

**Default model values** (`src/config/constants.ts`):
- `MODEL_NAMES.balanced = 'glm-5.2'` → `getModel('balanced') = 'zai/glm-5.2'`
- `MODEL_NAMES.fast = 'glm-5-turbo'` → `getModel('fast') = 'zai/glm-5-turbo'`

So `ROLE_CONFIG` mapping (contract) resolves to:
| role           | tier       | thinking  | resolved model     |
|----------------|------------|-----------|--------------------|
| research       | balanced   | (none)    | zai/glm-5.2        |
| reasoning      | balanced   | xhigh     | zai/glm-5.2        |
| implementation | fast       | (none)    | zai/glm-5-turbo    |

## 3. Groundswell `createAgent` consumption (the excess-property question)

`createAgent(config: AgentConfig)` (Groundswell `core/factory.d.ts`). Groundswell's
`AgentConfig` (`node_modules/groundswell/dist/types/agent.d.ts`) has **NO `thinking`
field** (it has `harnessOptions?: HarnessOptions` for harness-specific opts). The local
`AgentConfig` is structurally assignable to Groundswell's today (verified: `tsc
--noEmit -p tsconfig.build.json` = exit 0).

**CRITICAL (see s1-gotchas-and-coverage.md §1):** the createXxxAgent spread
`{...baseConfig, system, mcps}` does NOT trigger TypeScript excess-property checks for
properties that arrive ONLY via spread. So adding `thinking?` to the local `AgentConfig`
is SAFE — Groundswell silently ignores the extra property, and the 4 createXxxAgent
functions need **zero changes** for S1. (Verified with an isolated `tsc` reproduction.)

## 4. Tests + gating

- `tests/unit/agents/agent-factory.test.ts` — existing suite, **GATED**
  (`vitest.config.ts` `include: ['tests/**/*.{test,spec}.ts']` → runs under
  `npm run validate`). This is where the new `ModelRole`/`ROLE_CONFIG`/role-param tests go.
- `vitest.config.ts` enforces **100% coverage** (statements/branches/functions/lines)
  on `src/**/*.ts`. Every new branch (role param default, ROLE_CONFIG lookup, thinking
  assignment) MUST be exercised by a test. See s1-gotchas-and-coverage.md §3.

## 5. Default-role backward compatibility (verified)

If `role` defaults to `'research'`:
- `createBaseConfig('architect')` → balanced → `zai/glm-5.2` (existing test expects glm-5.2 ✓)
- `createBaseConfig('coder')` → balanced → `zai/glm-5.2` (existing createBaseConfig test ✓);
  `createCoderAgent()` then overrides `model: getModel('fast')` → `zai/glm-5-turbo`
  (no existing test asserts the coder AGENT's model value directly — only `.name`).

→ Default `role = 'research'` preserves ALL existing assertions. No existing test breaks.

## 6. CONFIGURATION.md docs target (Mode A)

`docs/CONFIGURATION.md` has a `## Model Selection` section (line 237) describing
**three tiers** (high/balanced/fast) — but NOTHING about **three roles** or the
reasoning budget. Contract DOCS item: "Update docs/CONFIGURATION.md model section to
describe three roles." Insert a new `### Model Roles` subsection after `### Model Tiers`
(line ~245). See PRP §Implementation Tasks Task 5 for exact content.

## 7. Out-of-scope (hard boundaries — owned by siblings/later)

- **Persona→role remap** (architect→reasoning, coder→implementation, etc.) = **S2**.
  S1 ships the plumbing + a backward-compatible default; S2 flips the createXxxAgent
  calls to pass explicit roles.
- **xhigh wiring into the decomposition demand-write retry** = **S3**.
- **End-to-end `thinking` → pi harness `thinkingLevel`** (via `harnessOptions`): S1
  stores `thinking` as a pipeline-internal budget marker on the config object. The
  harness-options threading to `createAgentSession({ thinkingLevel })` is a deeper
  harness-layer concern (Groundswell `HarnessOptions`), NOT in S1's contract. S1 must
  only ensure the field EXISTS, is typed, and is set from `ROLE_CONFIG` — and that it
  does not break the Groundswell `createAgent` spread (it does not; §3).