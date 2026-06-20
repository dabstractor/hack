# External Dependencies — Groundswell Harness API Surface

Authoritative reference for the Groundswell APIs Session 004 integrates with.
All of these are **already shipped** in `groundswell@0.0.4` (the version linked
via `.yalc`). Source: `~/projects/groundswell/src`.

## 1. Types (`import type { ... } from 'groundswell'`)

From `src/types/harnesses.ts`:

```ts
type HarnessId        = 'pi' | 'claude-code';
type ModelProviderId  = 'anthropic' | 'openai' | 'google' | 'zai' | (string & {}); // OPEN SET

interface HarnessOptions {
  endpoint?: string;
  apiKey?: string;        // forwarded to the LLM provider, NOT owned by the harness
  sessionId?: string;
  timeout?: number;
  headers?: Record<string, string>;
}

interface GlobalHarnessConfig {
  defaultHarness: HarnessId;                         // 'pi' | 'claude-code'
  harnessDefaults?: Partial<Record<HarnessId, HarnessOptions>>;
  defaultModelProvider?: ModelProviderId;            // OPEN SET — not validated
}

interface ModelSpec { provider: ModelProviderId; model: string; raw: string; }
```

**Key semantics:**
- `defaultModelProvider` is an **open set** — `configureHarnesses()` does NOT validate it.
- `configureHarnesses()` validates ONLY `defaultHarness` and the keys of `harnessDefaults`
  (must be `'pi'` or `'claude-code'`). It throws on invalid harness ids.
- This means **the PRP pipeline must enforce the `claude-code` + z.ai incompatibility
  itself** — Groundswell will not reject it.

## 2. Configuration functions (`import { ... } from 'groundswell'`)

From `src/utils/harness-config.ts`:

```ts
configureHarnesses(config: GlobalHarnessConfig): void   // call ONCE at startup
getGlobalHarnessConfig(): GlobalHarnessConfig            // never null (defaults to {defaultHarness:'pi'})
resolveHarnessConfig(global, agentHarness?, agentOptions?, promptHarness?, promptOptions?)
  : { harness: HarnessId; options: HarnessOptions }      // pure cascade (PRD §7.7)
resetGlobalHarnessConfig(): void                         // TESTS ONLY
```

Startup call required by the delta (PRD §9.4.2 / §9.5):
```ts
configureHarnesses({
  defaultHarness: 'pi',
  defaultModelProvider: 'zai',
  harnessDefaults: {
    'claude-code': { apiKey: process.env.ANTHROPIC_API_KEY },
  },
});
```

## 3. Model-spec helpers (`import { parseModelSpec } from 'groundswell'`)

From `src/utils/model-spec.ts`:

```ts
parseModelSpec(model: string, defaultProvider?: ModelProviderId): ModelSpec
//  'zai/GLM-4.7'           -> { provider:'zai', model:'GLM-4.7', raw:'zai/GLM-4.7' }
//  'GLM-4.7'               -> resolved against defaultProvider
//  'pi/zai/GLM-4.7'        -> THROWS ("Harness must not appear in model string …")
```

`formatModelForProvider(spec, target)` is pass-through when providers match, else throws.

## 4. `createAgent()` config surface (from `src/types/agent.ts`)

Groundswell `AgentConfig` now carries (alongside the legacy `model`, `provider`,
`providerOptions`):

```ts
interface AgentConfig {
  model?: string;              // plain OR "provider/model" — NEVER harness-qualified
  harness?: HarnessId;         // 'pi' | 'claude-code'
  harnessOptions?: HarnessOptions;
  // ... name, system, enableCache, enableReflection, maxTokens, mcps, etc.
}
export function createAgent(config: AgentConfig): Agent;
```

So the PRP `createBaseConfig()` (in `src/agents/agent-factory.ts`) only needs to
add `harness` and `harnessOptions` to the config it already builds. The `env` field
the PRP factory currently sets is a hacky-hack-local extra and is harmlessly ignored
by Groundswell.

## 5. Harness adapters / registry

```ts
import { PiHarness, ClaudeCodeHarness, HarnessRegistry } from 'groundswell';
import { registerDefaultHarnesses } from 'groundswell/harnesses';
```

- `registerDefaultHarnesses(registry?)` is **idempotent** — registers `pi` and
  `claude-code` instances. Safe to call multiple times.
- **Provider/harness compatibility (PRD §9.4.3):** `claude-code` is **Anthropic-only**;
  requesting the `zai` provider on `claude-code` is surfaced as a config error at
  `initialize()`/`execute()`. (The default `pi` harness runs any provider.)

## 6. Safeguard interaction (PRD §9.2.4)

The existing z.ai endpoint guard lives in:
- `src/scripts/validate-api.ts`
- `tests/validation/zai-api-test.ts`

Both check `ANTHROPIC_BASE_URL` against `https://api.anthropic.com` and hard-exit.
The delta **clarifies** that this constrains the **LLM provider** (not the harness),
and adds a new rejection: `claude-code` + z.ai provider must fail at init.
Because `configureHarnesses()` does NOT validate the provider, the PRP pipeline
must add this check in its own startup/config path.
