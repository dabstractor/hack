# Research — JSDoc updates + test cascade for P1.M1.T2.S2

Exact before/after for the documentation edits (`src/config/types.ts` and the stale
JSDoc in `src/agents/agent-factory.ts`) and the precise additive test changes in
`tests/unit/agents/agent-factory.test.ts`.

## 1. `src/config/types.ts` — `EnvironmentConfig` JSDoc → provider/model form

Contract item: "update `EnvironmentConfig` model-field JSDoc/examples to the
`provider/model` form (e.g. `opusModel: 'zai/GLM-4.7'`)".

### BEFORE (current working tree)

````ts
/**
 * Environment configuration interface
 * ...
 * @example
 * ```ts
 * import type { EnvironmentConfig } from './config/types.js';
 *
 * const config: EnvironmentConfig = {
 *   apiKey: 'sk-ant-...',
 *   baseURL: 'https://api.z.ai/api/anthropic',
 *   opusModel: 'GLM-4.7',
 *   sonnetModel: 'GLM-4.7',
 *   haikuModel: 'GLM-4.5-Air',
 * };
 * ```
 */
export interface EnvironmentConfig {
  /** API authentication key (mapped from ANTHROPIC_AUTH_TOKEN) */
  readonly apiKey: string;
  /** Base URL for z.ai API endpoint */
  readonly baseURL: string;
  /** Model name for opus tier */
  readonly opusModel: string;
  /** Model name for sonnet tier */
  readonly sonnetModel: string;
  /** Model name for haiku tier */
  readonly haikuModel: string;
}
````

### AFTER

- `@example` model literals → `provider/model` form.
- Per-field JSDoc → state the value is **provider-qualified**.
- `@remarks` → add a one-line note that model values are provider-qualified and the
  harness never appears in them (PRD §9.2.3 / §9.4.3).

````ts
/**
 * Environment configuration interface
 *
 * @remarks
 * Defines the shape of validated environment variables.
 * All properties are required after configuration is complete.
 * Model fields are provider-qualified ('provider/model', e.g. 'zai/GLM-4.7');
 * the harness NEVER appears in the model string (PRD §9.2.3 / §9.4.3).
 *
 * @example
 * ```ts
 * import type { EnvironmentConfig } from './config/types.js';
 *
 * const config: EnvironmentConfig = {
 *   apiKey: 'sk-ant-...',
 *   baseURL: 'https://api.z.ai/api/anthropic',
 *   opusModel: 'zai/GLM-4.7',
 *   sonnetModel: 'zai/GLM-4.7',
 *   haikuModel: 'zai/GLM-4.5-Air',
 * };
 * ```
 */
export interface EnvironmentConfig {
  /** API authentication key (mapped from ANTHROPIC_AUTH_TOKEN) */
  readonly apiKey: string;
  /** Base URL for z.ai API endpoint */
  readonly baseURL: string;
  /** Provider-qualified model name for opus tier (e.g. 'zai/GLM-4.7') */
  readonly opusModel: string;
  /** Provider-qualified model name for sonnet tier (e.g. 'zai/GLM-4.7') */
  readonly sonnetModel: string;
  /** Provider-qualified model name for haiku tier (e.g. 'zai/GLM-4.5-Air') */
  readonly haikuModel: string;
}
````

NOTE: `ModelTier` JSDoc describes model _capabilities_ (not the config-field
format), so its `GLM-4.7` mentions stay as-is. Scope is `EnvironmentConfig` only.

## 2. `src/agents/agent-factory.ts` — stale bare-name JSDoc (same edit pass)

While editing this file to add the `harness` field, fix its stale JSDoc so docs do
not contradict the now-qualified `getModel()` output.

| Location                        | BEFORE                                                                                          | AFTER                                                                                                         |
| ------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Module `@example` (top of file) | `// Returns AgentConfig with maxTokens: 8192, model: 'GLM-4.7'`                                 | `// Returns AgentConfig with maxTokens: 8192, model: 'zai/GLM-4.7', harness: 'pi'`                            |
| `AgentConfig.model` field JSDoc | `/** Model identifier (e.g., 'GLM-4.7') */`                                                     | `/** Model identifier — provider-qualified 'provider/model' (e.g. 'zai/GLM-4.7'); never harness-qualified */` |
| `createBaseConfig` `@example`   | `// { name: 'ArchitectAgent', model: 'GLM-4.7', maxTokens: 8192, ... }` and the CoderAgent line | `model: 'zai/GLM-4.7'` (add `harness: 'pi'` if listing fields)                                                |

## 3. `tests/unit/agents/agent-factory.test.ts` — additive harness assertions

### 3a. The model literal is ALREADY updated by T2.S1 — DO NOT re-edit

Line 86 currently reads `expect(config.model).toBe('zai/GLM-4.7');` (T2.S1 landed it).
**T2.S2 must not touch this line** (see research/harness-field-wiring.md §4).

### 3b. ADD `toHaveProperty('harness')` to the existing config-shape test

In `it.each(personas)('should return valid config for %s persona', persona => { ... })`,
append one assertion alongside the existing `toHaveProperty('env')`:

```ts
expect(config).toHaveProperty('harness');
expect(config.harness).toBeDefined();
```

### 3c. ADD a dedicated harness-value test (NEW `it()` block)

Place it directly after the "should use qualified GLM-4.7 model for all personas"
test. Import `DEFAULT_HARNESS` from `'../../../src/config/constants.js'` and assert
the cascade default:

```ts
import { DEFAULT_HARNESS } from '../../../src/config/constants.js';
// ...
it('should set harness to the resolved runtime (default pi) for all personas', () => {
  // EXECUTE
  const configs = personas.map(p => createBaseConfig(p));
  // VERIFY: harness is the startup-resolved value (PRP_AGENT_HARNESS unset → 'pi')
  // and is identical across personas (single module-load resolution).
  configs.forEach(config => {
    expect(config.harness).toBe(DEFAULT_HARNESS); // 'pi'
  });
});
```

### 3d. Mocking / env stubbing (per work-item MOCKING section)

The existing `describe('createBaseConfig')` `beforeEach` stubs
`ANTHROPIC_AUTH_TOKEN` + `ANTHROPIC_BASE_URL`. The work-item MOCKING note also lists
`ANTHROPIC_API_KEY` (used by the harnessDefaults binding). Add it to the same
`beforeEach` for completeness:

```ts
beforeEach(() => {
  vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'test-token');
  vi.stubEnv('ANTHROPIC_BASE_URL', 'https://api.z.ai/api/anthropic');
  vi.stubEnv('ANTHROPIC_API_KEY', 'test-token'); // mapped key; used by harnessDefaults
});
```

`afterEach` already calls `vi.unstubAllEnvs()` (file-local) AND the global setup does
too — no change needed. `createAgent()` is config-only construction (no provider call
until `prompt()`/`execute()`), already proven by the existing
"should create multiple agents without MCP server registration conflicts" test — so
no network mocking is required.

## 4. Coverage note

`agent-factory.ts` already has 100% coverage from the existing suite. The new
`harness: RESOLVED_HARNESS` line is exercised by every `createBaseConfig()` call
(the `it.each(personas)` + the new harness `it()`), so 100% coverage is preserved.
No new branches are introduced (the value is a captured const, not a conditional).
