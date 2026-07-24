# S1 Gotchas, TypeScript behavior & 100%-coverage strategy

## 1. Spread does NOT trigger excess-property checks (PROVEN)

The single biggest technical risk in S1: adding `thinking?: ThinkingLevel` to the
project-local `AgentConfig` interface could, in principle, make the createXxxAgent
spread `{...baseConfig, system, mcps}` fail TypeScript excess-property checking when
passed to Groundswell's `createAgent(config: GroundswellAgentConfig)` — because
Groundswell's `AgentConfig` has no `thinking` field.

**PROVEN SAFE** with an isolated reproduction (`/tmp/tsxcheck/repro.ts`,
`strict: true`, `tsc --noEmit` = exit 0):
```ts
interface LocalConfig { name: string; model: string; thinking?: 'off'|'xhigh'; }
interface GsConfig { name?: string; model?: string; }   // no thinking
declare function makeAgent(c: GsConfig): void;
const base = build();                                   // LocalConfig incl. thinking
const cfg = { ...base, system: 'sys' };                 // thinking arrives ONLY via spread
makeAgent(cfg);                                         // ✅ no excess-property error
```
TypeScript deliberately suppresses excess-property checks for properties that come
**only from a spread** (not named explicitly in the fresh literal). Therefore:
- The 4 `createXxxAgent` functions need **ZERO changes** for S1.
- `thinking` rides harmlessly on the spread object; Groundswell ignores it.
- This keeps S1 cleanly inside the plumbing lane and avoids touching S2's createXxxAgent calls.

**Do NOT** destructure `thinking` out / cast / strip it — that's unnecessary complexity
and would suggest a problem that doesn't exist. Just add the field.

## 2. `ThinkingLevel` union: contract vs pi SDK (intentional narrowing)

- **pi SDK** (`@earendil-works/pi-agent-core` `types.d.ts:254`):
  `"off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"`.
- **Contract (this PRP, item 3a)**: `'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'`
  — i.e. **excludes `'minimal'`**.

**Decision: define the pipeline's OWN `ThinkingLevel` union in `agent-factory.ts`
matching the contract verbatim** (do NOT re-export the SDK's). Rationale:
- The contract explicitly enumerates this narrower set.
- Keeps the pipeline decoupled from the harness/SDK type (Groundswell's `AgentConfig`
  doesn't know about thinking at all; the harness-options layer is a later concern).
- A JSDoc note must record that `'minimal'` exists in the pi SDK but is intentionally
  excluded by this contract, so a future maintainer doesn't "fix" the mismatch.

## 3. 100% coverage strategy (vitest enforces statements/branches/functions/lines = 100)

Every new runtime construct must be exercised. Design to **minimize branches**:

### 3a. `ROLE_CONFIG` — a plain object lookup, zero branches
```ts
export const ROLE_CONFIG: Readonly<
  Record<ModelRole, { readonly tier: ModelTier; readonly thinking?: ThinkingLevel }>
> = {
  research:       { tier: 'balanced' },
  reasoning:      { tier: 'balanced', thinking: 'xhigh' },
  implementation: { tier: 'fast' },
} as const;
```
- `thinking` OMITTED on research/implementation entries (not `thinking: undefined`).
  Reading `ROLE_CONFIG[role].thinking` yields `undefined` for those → typed
  `ThinkingLevel | undefined`, assignable to `AgentConfig.thinking?`. **No `??` → no
  branch to cover.**
- Coverage: one test that asserts all 3 entries' shape (tier + thinking) covers the
  object literal + the `Record` index access.

### 3b. `createBaseConfig(persona, role = 'research')` — default param is NOT a V8 branch
- Default-parameter assignment is handled by the JS engine, not as an enumerable branch
  in V8 coverage. Still, tests MUST call BOTH `createBaseConfig('x')` (default) AND
  `createBaseConfig('x', '<role>')` (explicit) — the default path is exercised by the
  EXISTING persona tests (they pass one arg), the explicit path by the NEW role tests.
- Body: `const { tier, thinking } = ROLE_CONFIG[role]; const model = getModel(tier);`
  then return object includes `model, thinking`. Destructure + direct field read →
  no branch. Covered by the 3 role tests.

### 3c. The returned `thinking` field
- For research/implementation: `undefined`. For reasoning: `'xhigh'`.
- Assert in role tests: `expect(cfg.thinking).toBeUndefined()` (research/impl) and
  `expect(cfg.thinking).toBe('xhigh')` (reasoning).

### 3d. Type-only exports (`ModelRole`, `ThinkingLevel`) — no coverage impact
Type aliases are erased at compile time. Nothing to cover.

### Coverage checklist (must all be green)
- [ ] `ROLE_CONFIG` read for `research` (tier='balanced', thinking undefined)
- [ ] `ROLE_CONFIG` read for `reasoning` (tier='balanced', thinking 'xhigh')
- [ ] `ROLE_CONFIG` read for `implementation` (tier='fast', thinking undefined)
- [ ] `createBaseConfig` default-role path (existing 1-arg tests)
- [ ] `createBaseConfig` explicit-role path (new tests)
- [ ] `thinking` field present on returned config for reasoning; absent (undefined)
      for research/implementation

## 4. Backward-compat invariant (must hold after S1)

With `role = 'research'` default:
| call                                 | model (post-S1) | existing test expectation | OK? |
|--------------------------------------|-----------------|---------------------------|-----|
| createBaseConfig('architect')        | zai/glm-5.2     | glm-5.2                   | ✓   |
| createBaseConfig('researcher')       | zai/glm-5.2     | glm-5.2                   | ✓   |
| createBaseConfig('coder')            | zai/glm-5.2     | glm-5.2                   | ✓   |
| createBaseConfig('qa')               | zai/glm-5.2     | glm-5.2                   | ✓   |
| createCoderAgent() (overrides fast)  | zai/glm-5-turbo | (name only asserted)      | ✓   |

The existing `it('should use qualified glm-4.7 model for all personas')` (title is stale
model-value prose — pre-existing, OUT OF SCOPE per S3) asserts `createBaseConfig(p).model
=== 'zai/glm-5.2'` for all 4 personas. Default role='research' → balanced → glm-5.2.
**Still passes.** (Do NOT "fix" the stale `glm-4.7` in the test TITLE — that's S3's lane /
pre-existing model-value staleness, explicitly out of scope.)

## 5. What S1 must NOT do (scope fences)

- Do NOT remap personas→roles in createXxxAgent (S2).
- Do NOT wire `thinking` into `harnessOptions` / pi `thinkingLevel` end-to-end (harness-layer,
  later). S1 only STORES the field.
- Do NOT touch `getModel`, `ModelTier`, `MODEL_NAMES`, `environment.ts`, `constants.ts`,
  `types.ts` (owned by P2.M1.T1.S1/S2/S3 — already complete/landing).
- Do NOT edit the stale `glm-4.7` test title or model-VALUE prose (S3 / P6 docs sweep).
- Do NOT add `'minimal'` to the union (contract excludes it).
- Do NOT re-export the SDK's `ThinkingLevel` (define the pipeline's own per contract).