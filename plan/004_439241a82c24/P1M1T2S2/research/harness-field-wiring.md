# Research — Wiring the `harness` field into `AgentConfig`

Subtask P1.M1.T2.S2. Documents the design decision for how `createBaseConfig()`
obtains the resolved harness value, the Groundswell contract that permits it, and
why this does **not** collide with the in-flight P1.M1.T2.S1.

## 1. The source of the resolved harness: `configureHarness()`

`src/config/harness.ts` (produced by P1.M1.T1.S2, already merged) exports:

```ts
export function configureHarness(): AgentHarness;
```

It reads `process.env[PRP_AGENT_HARNESS] ?? DEFAULT_HARNESS`, validates against
`SUPPORTED_HARNESSES`, enforces the `claude-code`+`zai` incompatibility, calls
Groundswell `configureHarnesses()`, and **returns the resolved, validated
`AgentHarness`**.

`agent-factory.ts` already invokes it at module load:

```ts
configureEnvironment();
configureHarness(); // return value currently DISCARDED
```

### Decision: capture the return value into a module-level const

```ts
configureEnvironment();
/** Resolved once at startup (PRD §9.4.2 cascade: global default). */
const RESOLVED_HARNESS: AgentHarness = configureHarness();
```

Then `createBaseConfig()` sets `harness: RESOLVED_HARNESS` on the returned object.

### Why this approach (and NOT the alternatives)

| Approach                                                                               | Verdict                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **(A) Capture top-level `configureHarness()` return value** ← CHOSEN                   | One source of truth (the entrypoint the work item points at); no re-invoked side effects; resolves once at startup exactly as the cascade intends.                                                            |
| (B) Call `configureHarness()` inside `createBaseConfig()`                              | **REJECTED** — re-runs `configureHarnesses()` (side effect) for every persona; also re-runs validation/throw logic. The harness is a startup-decided singleton, not per-config.                               |
| (C) Re-read `process.env.PRP_AGENT_HARNESS ?? DEFAULT_HARNESS` in `createBaseConfig()` | **REJECTED** — duplicates the resolution + skips validation; violates "single source of truth" (implementation_notes.md §2). The work item explicitly names the `configureHarness()` entrypoint as the INPUT. |

The work-item INPUT is literally "resolved harness value / `configureHarness()`
entrypoint from P1.M1.T1.S2" → approach (A) is the faithful interpretation.

## 2. Groundswell contract — `createAgent()` accepts `harness`

Verified in `architecture/external_deps.md` §4 (Groundswell `src/types/agent.ts`):

```ts
interface AgentConfig {
  model?: string; // plain OR "provider/model" — NEVER harness-qualified
  harness?: HarnessId; // 'pi' | 'claude-code'
  harnessOptions?: HarnessOptions;
  // ... name, system, enableCache, enableReflection, maxTokens, mcps, etc.
}
export function createAgent(config: AgentConfig): Agent;
```

`HarnessId` (Groundswell `src/types/harnesses.ts`) is `'pi' | 'claude-code'` —
**identical** to our local `AgentHarness` type. Therefore:

- Adding `harness: AgentHarness` to the **local** `AgentConfig` interface (in
  `agent-factory.ts`) is structurally compatible with Groundswell's options.
- The persona factories do `const config = { ...baseConfig, system, mcps }` then
  `createAgent(config)` — so `harness` flows through the spread into Groundswell.
- No `harnessOptions` is needed at the agent-config level: per-harness options come
  from the global `harnessDefaults` set by `configureHarnesses()` (the `'claude-code'
→ { apiKey }` binding). The work item asks only for the `harness` field.

## 3. Module-load resolution ⇒ `'pi'` under default config

`tests/setup.ts` (global setup) does **not** stub or unset `PRP_AGENT_HARNESS`. It
runs `validateApiEndpoint()` + `vi.clearAllMocks()` (beforeEach) and
`vi.unstubAllEnvs()` (afterEach). So at the moment `agent-factory.ts` is imported:

- `PRP_AGENT_HARNESS` is unset (unless a project `.env` sets it) →
  `configureHarness()` resolves `DEFAULT_HARNESS === 'pi'`.
- `RESOLVED_HARNESS === 'pi'`, no throw (provider is `zai`, harness is `pi` → compatible).

Therefore the new test assertion `expect(config.harness).toBe(DEFAULT_HARNESS)`
(= `'pi'`) holds under default config — exactly the work-item example
("equals 'pi' under default config"). Test-time `vi.stubEnv` of env vars does
**not** retroactively change `RESOLVED_HARNESS` (captured once at import), which is
correct: the harness is a startup singleton.

## 4. Non-conflict with the in-flight P1.M1.T2.S1

T2.S1 owns the model-qualification cascade in `tests/unit/agents/agent-factory.test.ts`:
it changes the single line `expect(config.model).toBe('GLM-4.7')` →
`'zai/GLM-4.7'` (already landed in the working tree). T2.S2's edits to the SAME file
are **strictly additive** and target DIFFERENT `it()` blocks:

- T2.S1 edits: `it('should use qualified GLM-4.7 model for all personas')` (the model literal).
- T2.S2 adds: harness assertions in `it.each(personas)('should return valid config for %s persona')`
  (a `toHaveProperty('harness')`) **plus** a NEW dedicated
  `it('should set harness to the resolved runtime (default pi)')`.

Per `implementation_notes.md` §8, within M1.T2 the ordering is **S1 before S2**, so
by the time S2 executes, S1 is merged — the model literal is already `'zai/GLM-4.7'`.
**T2.S2 MUST NOT re-edit that line.** The only model-related edit T2.S2 makes is the
stale bare-name JSDoc _inside `agent-factory.ts` source_ (not the test).

## 5. Non-breaking integration test

`tests/integration/agents.test.ts:171` ("should include all required AgentConfig
properties") asserts via additive `expect(config).toHaveProperty(...)` calls
(name, system, model, enableCache, enableReflection, maxTokens, env). Adding
`harness` does **not** break it. Adding `expect(config).toHaveProperty('harness')`
there is an OPTIONAL consistency nicety (recommended) but not required by the
contract — the unit test is the authoritative gate.
