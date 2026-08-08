# Research — P1.M1.T3.S1: Decouple `createBaseConfig` (explicit `thinking` param, strip `thinking` from `ROLE_CONFIG`)

> Plan 013, PRD §9.2.9 (Per-Role Reasoning Level) → §9.2.3 (Model Selection). The "two independent
> axes" requirement: **which model a role runs** (tier) and **how hard it reasons** (thinking level)
> MUST be decoupled. Today `createBaseConfig` derives BOTH from `ROLE_CONFIG[role]` (reasoning→xhigh).
> S1 severs the coupling: `ROLE_CONFIG` carries `tier` ONLY; `createBaseConfig` takes an explicit,
> required `thinking: ThinkingLevel` param composed onto the config INDEPENDENT of the tier. Architecture
> spec: `plan/013_3f31aa2b81b7/architecture/integration-points.md §C`.

## 0. Scope boundary (critical — this is a deliberate breaking step)

- **S1 changes the CONTRACT**: `ROLE_CONFIG` (strip `thinking`) + `createBaseConfig` (new required
  `thinking` param) + their JSDoc (Mode A) + the createBaseConfig tests.
- **S1 INTENTIONALLY LEAVES THE 6 SRC CALL SITES BROKEN** (they pass only 2 args to a now-3-required-arg
  function). **S2** (`Wire non-QA factories + createQAAgent(level) + commit-message-agent`) wires them.
  The item description states this verbatim: *"this signature change will break the existing factories +
  commit-message-agent.ts until S2 wires them — that is expected and fixed in S2."*
- **No file overlap with the parallel item T2.S2** (it edits `src/config/hack-config.ts` only).
- Files touched by S1: `src/agents/agent-factory.ts` + `tests/unit/agents/agent-factory.test.ts`. Nothing else.

## 1. Verified current state (src/agents/agent-factory.ts)

- **`ThinkingLevel` (T1.S3, line 122)**: `export type ThinkingLevel = ReasoningLevel;` — already the
  reconciled alias. `ReasoningLevel` (constants.ts:1519) = `'off'|'minimal'|'low'|'medium'|'high'|'xhigh'`
  (`'max'` DROPPED; `'minimal'` ADDED). `REASONING_LEVELS` (constants.ts:1534) backs it. **INPUT READY.**
- **`ModelRole` (lines ~157–167)**: `'research'|'reasoning'|'implementation'` — UNCHANGED by S1 (still
  selects the tier). Its JSDoc currently says "'reasoning' → balanced tier, 'xhigh' budget" — that
  budget clause is now stale (thinking is decoupled); S1 updates it (Mode A accuracy).
- **`ROLE_CONFIG` (lines ~297–307)** — currently:
  ```ts
  export const ROLE_CONFIG: Readonly<Record<ModelRole, { readonly tier: ModelTier; readonly thinking?: ThinkingLevel }>> = {
    research: { tier: 'balanced' },
    reasoning: { tier: 'balanced', thinking: 'xhigh' },
    implementation: { tier: 'fast' },
  } as const;
  ```
  S1 → drop `thinking` from the value type AND from `reasoning`; keep `tier` only (§C).
- **`createBaseConfig` (lines ~360–410)** — currently `(persona: AgentPersona, role: ModelRole = 'research'): AgentConfig`,
  body `const { tier, thinking } = ROLE_CONFIG[role]; const model = getModel(tier);` and returns `thinking`.
  S1 → `(persona, role='research', thinking: ThinkingLevel)`, body `const { tier } = ROLE_CONFIG[role]; const model = getModel(tier);`,
  returns the PASSED `thinking`. `getModel(tier)` resolution UNCHANGED (§C: "unchanged model resolution").
- **The 5 factories** each call `createBaseConfig(persona, role)` with 2 args → these become the expected
  S2 breakage. **S1 does NOT touch them.**
- **createQAAgent** currently `createQAAgent(): Agent` → `createBaseConfig('qa','reasoning')`. Its
  signature change to `createQAAgent(reasoningLevel)` is **S2** (§C). S1 leaves it.

## 2. The 6 expected src breakage sites (S2 closes these — confirmed by grep)

`grep -rn 'createBaseConfig(' src/` (excluding the function definition + JSDoc examples):
| File:line | Caller | Current call | S2 will become |
|-----------|--------|--------------|----------------|
| `src/agents/agent-factory.ts:354` | createArchitectAgent | `createBaseConfig('architect','reasoning')` | `+ getReasoningBreakdown()` |
| `src/agents/agent-factory.ts:386` | createResearcherAgent | `createBaseConfig('researcher','research')` | `+ getReasoningAgent()` |
| `src/agents/agent-factory.ts:419` | createCoderAgent | `createBaseConfig('coder','implementation')` | `+ getReasoningImpl()` |
| `src/agents/agent-factory.ts:453` | createQAAgent | `createBaseConfig('qa','reasoning')` | (S2: `createQAAgent(level)`) |
| `src/agents/agent-factory.ts:506` | createCleanupAgent | `createBaseConfig('cleanup','implementation')` | `+ 'off'` |
| `src/agents/commit-message-agent.ts:361` | createCommitMessageAgent | `createBaseConfig('researcher','research')` | `+ 'off'` |

All 6 will emit **TS2554 "Expected 3 arguments, but got 2"** after S1. (JSDoc `@example` blocks at
agent-factory.ts:19, 288, 291 are COMMENTS — not type-checked — but S1 updates them for Mode A accuracy.)

## 3. The typecheck gate reality (why S1 can be GREEN at runtime while src typechecks RED)

- **`npm run typecheck` = `tsc --noEmit -p tsconfig.build.json`**, and `tsconfig.build.json`
  `exclude: ["node_modules","dist","tests"]` + `include: ["src/**/*"]` → **typecheck is SRC-ONLY; tests
  are NOT checked.** So after S1, typecheck FAILS on the 6 src call sites (above), but NEVER on the
  test file.
- **`npx vitest run` does NOT typecheck** (it transpiles via esbuild, stripping types). So the test
  file runs at RUNTIME regardless of src type errors. The factories' 2-arg calls become runtime calls
  with `thinking === undefined`; the factory tests (which assert `agent.name` / `.not.toThrow()`, NOT
  thinking) still PASS at runtime.
- **NET:** S1's validation = `npx vitest run tests/unit/agents/agent-factory.test.ts` GREEN (after S1
  adapts the role-budget tests), PLUS `npm run typecheck` failing with EXACTLY the 6 expected TS2554
  errors (S2 closes them). The PRP frames this precisely so the agent doesn't "fix" the expected
  breakage (that's S2's job) and doesn't panic at the typecheck red.

## 4. Ready-to-paste S1 code (src/agents/agent-factory.ts)

### 4a. ROLE_CONFIG (strip thinking)
```ts
/**
 * Role → tier mapping (PRD §9.2.3 / §9.2.9).
 *
 * @remarks
 * Single source of truth for the role→TIER decision ONLY. The reasoning (extended-thinking) level is
 * NO LONGER derived from the role — it is resolved per-role via the `PRP_REASONING_*` env vars (§9.2.9)
 * and passed EXPLICITLY to {@link createBaseConfig}. `thinking` was therefore REMOVED from this map:
 * the model (tier) and the reasoning level are now two INDEPENDENT axes (§9.2.3 "two independent axes").
 *
 * The role→tier MODEL mapping is UNCHANGED: research/reasoning → `balanced`; implementation → `fast`.
 *
 * @example
 * ```ts
 * ROLE_CONFIG.reasoning.tier;       // 'balanced'
 * ROLE_CONFIG.implementation.tier;  // 'fast'
 * ```
 */
export const ROLE_CONFIG: Readonly<Record<ModelRole, { readonly tier: ModelTier }>> = {
  research: { tier: 'balanced' },
  reasoning: { tier: 'balanced' },
  implementation: { tier: 'fast' },
} as const;
```

### 4b. createBaseConfig signature + body
```ts
/**
 * Create base agent configuration for a specific persona.
 *
 * @remarks
 * The `role` selects the MODEL TIER via {@link ROLE_CONFIG} (PRD §9.2.3); `getModel(tier)` resolves the
 * provider-qualified model id — UNCHANGED. The `thinking` (extended-thinking/reasoning budget) is a
 * SEPARATE, caller-resolved axis (PRD §9.2.9): each factory passes its resolved `PRP_REASONING_*` level
 * (via the `getReasoning*()` getters), INDEPENDENT of the tier. Tuning the reasoning level never
 * perturbs the model, and vice versa — a reasoning role can run with thinking `off`, an implementation
 * role can run with thinking `xhigh`.
 *
 * `thinking` is REQUIRED (no default): the decoupling is load-bearing, so a caller that forgets to
 * resolve a level is a compile error, not a silent `undefined`.
 *
 * (Stateless invariant, env mapping, and persona naming are as before — see the prior JSDoc body.)
 *
 * @param persona - The agent persona to create configuration for.
 * @param role - The model role ('research' | 'reasoning' | 'implementation'); defaults to 'research'.
 * @param thinking - The resolved extended-thinking level (PRD §9.2.9), INDEPENDENT of `role`/tier.
 * @returns Groundswell-compatible agent configuration object.
 *
 * @example
 * ```ts
 * // reasoning role (balanced tier) running with thinking OFF — the decoupling proof
 * const cfg = createBaseConfig('architect', 'reasoning', 'off');
 * // cfg.model === 'zai/glm-5.2' (balanced tier); cfg.thinking === 'off'
 * ```
 */
export function createBaseConfig(
  persona: AgentPersona,
  role: ModelRole = 'research',
  thinking: ThinkingLevel
): AgentConfig {
  const { tier } = ROLE_CONFIG[role];   // tier ONLY — thinking no longer lives here
  const model = getModel(tier);          // UNCHANGED model resolution
  const name = `${persona.charAt(0).toUpperCase() + persona.slice(1)}Agent`;
  const system = `You are a ${persona} agent.`;
  return {
    name,
    system,
    model,
    thinking,                            // the PASSED level, independent of role/tier
    stateless: STATELESS_PERSONAS.has(persona),
    harness: resolvedHarness(),
    enableCache: true,
    enableReflection: true,
    maxTokens: PERSONA_TOKEN_LIMITS[persona],
    env: {
      ANTHROPIC_API_KEY: resolveApiKeyForProvider(getResolvedProvider()) ?? '',
      ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL ?? '',
    },
  };
}
```
(Preserve the existing inline `// PATTERN:`/`// GOTCHA:`/`// CRITICAL:` comments from the current body —
only the `thinking` source changes. Drop the now-false `// Tier + reasoning budget are driven by
ROLE_CONFIG[role]` comment; replace with a tier-only note.)

### 4c. ModelRole JSDoc accuracy fix (same file, Mode A)
Update the `ModelRole` JSDoc bullet that says "'reasoning' → balanced tier, 'xhigh' budget" → drop the
budget clause (e.g. "'reasoning' → balanced tier (decomposition/validation); the reasoning LEVEL is
resolved per §9.2.9, independent of the tier"). Keep the tier descriptions.

## 5. Test changes (tests/unit/agents/agent-factory.test.ts)

The gate is RUNTIME (`vitest run`, no typecheck; build typecheck excludes tests). To keep the file GREEN:

### 5a. MUST-DO (these FAIL at runtime if not updated — they assert the OLD role→thinking coupling)
- **`describe('model roles & reasoning budget')` → rewrite.** The current `roleExpectations` table
  asserts `config.thinking === thinking` where `reasoning→'xhigh'`. After S1, thinking is caller-
  supplied. Convert the `it.each` to test **tier→model ONLY** (drop the thinking column), OR rewrite
  each row to call `createBaseConfig('architect', role, <level>)` and assert both model (from tier) and
  thinking (=== passed level). Cleanest: split into (i) a tier→model table and (ii) the decoupling tests (5b).
- **`should map each role to the correct tier and budget in ROLE_CONFIG`** → ROLE_CONFIG is tier-only now:
  ```ts
  expect(ROLE_CONFIG.research).toEqual({ tier: 'balanced' });
  expect(ROLE_CONFIG.reasoning).toEqual({ tier: 'balanced' });   // NO thinking
  expect(ROLE_CONFIG.implementation).toEqual({ tier: 'fast' });
  ```
- **`should default role to research when omitted`** → it asserts `config.thinking` undefined via a
  1-arg call. Reframe: the default-role path now requires thinking; test
  `createBaseConfig('architect', undefined, 'high')` → `model === 'zai/glm-5.2'` (role defaulted to
  research → balanced) AND `thinking === 'high'`.

### 5b. ADD (the contract's explicit TDD — the decoupling proof)
```ts
it('decouples thinking from role: a reasoning role can run with thinking off (PRD §9.2.9)', () => {
  const config = createBaseConfig('architect', 'reasoning', 'off');
  expect(config.model).toBe('zai/glm-5.2');   // reasoning role → balanced tier (UNCHANGED)
  expect(config.thinking).toBe('off');          // …but thinking is the PASSED level, NOT xhigh
});
it('decouples thinking from role: an implementation role can run with thinking xhigh', () => {
  const config = createBaseConfig('coder', 'implementation', 'xhigh');
  expect(config.model).toBe('zai/glm-5-turbo'); // impl role → fast tier (UNCHANGED)
  expect(config.thinking).toBe('xhigh');         // …but thinking is the PASSED level
});
it('composes the passed thinking verbatim across all levels', () => {
  for (const level of REASONING_LEVELS) {
    expect(createBaseConfig('researcher', 'research', level).thinking).toBe(level);
  }
});
```

### 5c. SHOULD-DO (type-cleanliness — not required by the `vitest run` gate, but keeps the file
consistent for S2 and any `vitest typecheck`)
Update the remaining 1-arg `createBaseConfig(persona)` / `createBaseConfig('architect')` calls in the
`createBaseConfig` + `stateless` describe blocks to the 3-arg form (pass `'research'` + a level, e.g.
`createBaseConfig(persona, 'research', 'high')`). Model stays balanced → existing model/token assertions
hold. (Build typecheck excludes tests so these are not currently caught, but leaving mixed 1-arg/3-arg
calls is sloppy and will trip S2.) The factory tests (`createArchitectAgent()` etc.) are UNTOUCHED —
they call the factories, not createBaseConfig, and pass at runtime.

## 6. Validation gates (the intentional-breakage framing)

```bash
# PRIMARY gate — runtime GREEN (S1 adapts the role-budget tests + adds decoupling tests)
npx vitest run tests/unit/agents/agent-factory.test.ts
# EXPECTED: GREEN. (Factory tests pass at runtime — they don't assert thinking.)

# KNOWN-BREAKAGE gate — src typecheck RED, but ONLY at the 6 expected call sites (S2 closes them)
npm run typecheck 2>&1 | grep -E "error TS2554" | grep -E "agent-factory\.ts:(354|386|419|453|506)|commit-message-agent\.ts:361"
# EXPECTED: exactly 6 TS2554 "Expected 3 arguments, but got 2" lines (line numbers approximate).
# Confirm NO OTHER new src errors:
npm run typecheck 2>&1 | grep -c "error TS"   # should equal the pre-existing count + 6
# (S1 does NOT "fix" these 6 — that is S2's job. Leaving them is the contract.)

# Lint (style/formatting — eslint is not type-aware, so arity errors don't trip it)
npm run lint              # EXPECTED: clean on the edited file
npm run format:check      # EXPECTED: clean (run `npm run format` if it flags)
```

## 7. Why `thinking` is REQUIRED (not optional) — load-bearing decoupling

If `thinking` had a default, the factories' 2-arg calls would silently produce `thinking: undefined`
with NO compile error — exactly the silent-coupling the §9.2.9 decoupling is meant to eliminate. A
REQUIRED param turns "factory forgot to resolve its level" into a loud TS2554 at the call site, forcing
S2 to wire the real `getReasoning*()` level. This is why S1's typecheck RED is a FEATURE, not a bug.