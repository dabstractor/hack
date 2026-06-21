# Research: Groundswell Harness Registration API — root cause of `createAgent()` → "Harness 'pi' is not registered"

## Summary

`createAgent()` calls `new Agent(...)`, whose constructor unconditionally looks up the default harness (`'pi'`) in the `HarnessRegistry` singleton via `registry.get(effectiveHarness)` and throws `Harness '${effectiveHarness}' is not registered` when nothing has been registered. The registry is **empty by default** — nothing in `dist/index.js` or `configureHarnesses()` auto-registers a harness. The only function that populates the `'pi'` and `'claude-code'` instances is `registerDefaultHarnesses()` in `dist/harnesses/register-defaults.js`, and that function is **not** exported from the package's main entry (`dist/index.js`), nor is the `groundswell/harnesses` subpath declared in the published `package.json` `exports` map. Calling `configureHarnesses({ defaultHarness: 'pi' })` alone does NOT fix the bug — it only stores a _config_ singleton, not a harness _instance_.

## Findings

### 1. `HarnessRegistry` — singleton; empty `Map` until `register()` is called

File: `node_modules/groundswell/dist/harnesses/harness-registry.js`

Class declaration begins ~L77. Key members:

- **L79** — `static instance;` (the singleton slot; lazy).
- **L86** — `providers = new Map();` (keyed by `provider.id`).
- **L93** — `states = new Map();` (init-state tracking; irrelevant to this bug).
- **L99** — `constructor()` — empty, but private-by-convention (TS source has `private`; the compiled JS still allows direct `new`, but the singleton is the supported path).

Method signatures + bodies (1-indexed line numbers):

```js
// L131-137
static getInstance() {
    if (!HarnessRegistry.instance) {
        HarnessRegistry.instance = new HarnessRegistry();
    }
    return HarnessRegistry.instance;
}
```

```js
// L152-160
register(provider) {
    if (this.providers.has(provider.id)) {
        throw new Error(`Provider '${provider.id}' is already registered`);
    }
    this.providers.set(provider.id, provider);
}
```

```js
// L184-187  — returns undefined when missing; does NOT throw
get(id) {
    return this.providers.get(id);
}
```

```js
// L199-202
has(id) {
    return this.providers.has(id);
}
```

The module also re-exports a deprecated alias: `export const ProviderRegistry = HarnessRegistry;` (bottom of file). `agent.ts` imports `HarnessRegistry` from `../harnesses/index.js` (verified in `dist/harnesses/index.js`), so it uses the new name.

**Implication for the bug:** `getInstance()` is lazy and creates a fresh empty `Map`. Unless something explicitly calls `register(new PiHarness())` (or `registerDefaultHarnesses()`), `registry.get('pi')` returns `undefined`.

### 2. `PiHarness` — `id = "pi"`; exported from main barrel

File: `node_modules/groundswell/dist/harnesses/pi-harness.js`

Top-of-file imports (L1-6):

```js
import { MCPHandler } from '../core/mcp-handler.js';
import { parseModelSpec } from '../utils/model-spec.js';
import { getGlobalHarnessConfig } from '../utils/harness-config.js';
import { AGENT_ERROR_CODES } from '../types/agent.js';
import { createSuccessResponse, createErrorResponse } from '../types/agent.js';
import { ConfigError } from './claude-code-harness.js';
import { ModelRegistry, AuthStorage } from '@earendil-works/pi-coding-agent';
```

Note the **top-level** `import { ModelRegistry, AuthStorage } from "@earendil-works/pi-coding-agent"` — this is a static import, so loading `pi-harness.js` requires the Pi SDK to be resolvable at import time (it is _not_ lazily gated like the Anthropic SDK is).

Class declaration + identifier (searching the file):

```js
export class PiHarness {
  /** Harness identifier (PRD §7.2). */
  id = 'pi';
  capabilities = {
    mcp: true,
    skills: true,
    lsp: true,
    streaming: true,
    sessions: true,
    extendedThinking: true,
  };
  // ...
}
```

Constructor: implicit (no explicit `constructor(...)` — class field initializers only). `new PiHarness()` is a no-arg construction.

Exports confirmation — `dist/index.js` contains:

```js
export { PiHarness } from './harnesses/pi-harness.js';
```

So `PiHarness` IS reachable from the package main entry (`groundswell`).

### 3. `ClaudeCodeHarness` — lazily imports `@anthropic-ai/claude-agent-sdk`

File: `node_modules/groundswell/dist/harnesses/claude-code-harness.js`

Top-of-file imports do **not** include `@anthropic-ai/claude-agent-sdk`. It is loaded only inside `initialize()`:

```js
// inside async initialize(options):
this.sdk = await import('@anthropic-ai/claude-agent-sdk');
```

So importing `ClaudeCodeHarness` (and `new ClaudeCodeHarness()`) does **not** require the Anthropic SDK to be installed. The SDK only needs to resolve if/when `initialize()` is actually awaited. This matters because `registerDefaultHarnesses()` constructs `new ClaudeCodeHarness()` without calling `initialize()`, so merely registering it does not trigger the missing-dependency error.

**Verified on disk:** `node_modules/@anthropic-ai/claude-agent-sdk/` does NOT exist, and there is no `node_modules/groundswell/node_modules/` (nested deps). Same for `node_modules/@earendil-works/pi-coding-agent/` — it is also absent. Both are absent because `groundswell` was installed via yalc (`"file:.yalc/groundswell"`), which ships only the `dist/` folder, not the dependency tree. This means:

- Registering a `PiHarness` and then importing the module that statically imports `@earendil-works/pi-coding-agent` will fail at import time (L7 of `pi-harness.js`).
- Registering a `ClaudeCodeHarness` is safe until `initialize()` is called.

### 4. `configureHarnesses()` — stores config only; does NOT register instances

File: `node_modules/groundswell/dist/utils/harness-config.js`

Module-private singleton:

```js
let globalHarnessConfig = null;
const DEFAULT_HARNESS_CONFIG = { defaultHarness: 'pi' };
```

`configureHarnesses(config)` implementation (full body):

```js
export function configureHarnesses(config) {
  // Validate defaultHarness
  if (!isValidHarnessId(config.defaultHarness)) {
    throw new Error(
      `Invalid default harness: "${config.defaultHarness}". Supported harnesses: ${getSupportedHarnessesList()}`
    );
  }
  // Validate harnessDefaults keys (if present)
  if (config.harnessDefaults) {
    for (const id of Object.keys(config.harnessDefaults)) {
      if (!isValidHarnessId(id)) {
        throw new Error(
          `Invalid harness in harnessDefaults: "${id}". Supported harnesses: ${getSupportedHarnessesList()}`
        );
      }
    }
  }
  // Store configuration (defaultModelProvider is open set — no validation)
  globalHarnessConfig = config;
}
```

`isValidHarnessId` accepts only `'pi' | 'claude-code'`.

**Confirmed:** `configureHarnesses` only validates + stores the config singleton. It does **not** call `HarnessRegistry.getInstance().register(...)` and never constructs a harness instance. Calling it cannot, by itself, fix "Harness 'pi' is not registered."

There is also a parallel deprecated legacy singleton `globalProviderConfig` (used by `configureProviders` / `getGlobalProviderConfig` / `resolveProviderConfig`). `agent.js` still reads the legacy path via `getGlobalProviderConfig()` and `resolveProviderConfig()` (imported from `../utils/provider-config.js`, which is a shim re-exporting the deprecated names from `harness-config.js`). The legacy default is `defaultProvider: 'anthropic'` (note: `'anthropic'`, NOT `'pi'`) — see `DEFAULT_PROVIDER_CONFIG`.

### 5. `registerDefaultHarnesses()` — exists, but only on a subpath NOT in `exports`

File: `node_modules/groundswell/dist/harnesses/register-defaults.js`

Full body:

```js
import { HarnessRegistry } from './harness-registry.js';
import { ClaudeCodeHarness } from './claude-code-harness.js';
import { PiHarness } from './pi-harness.js';

export function registerDefaultHarnesses(
  registry = HarnessRegistry.getInstance()
) {
  const CLAUDE_CODE = 'claude-code';
  if (!registry.has(CLAUDE_CODE)) {
    registry.register(new ClaudeCodeHarness());
  }
  const PI = 'pi';
  if (!registry.has(PI)) {
    registry.register(new PiHarness());
  }
  return registry;
}
```

This is the only function in the published package that actually puts `PiHarness` and `ClaudeCodeHarness` instances into the registry. It is idempotent (`registry.has(...)` guards).

Re-exported from `dist/harnesses/index.js`:

```js
export { registerDefaultHarnesses } from './register-defaults.js';
```

**But** it is NOT exported from the package main entry `dist/index.js` (verified line-by-line: the barrel exports `PiHarness`, `ClaudeCodeHarness`, `HarnessRegistry`, `ProviderRegistry`, `configureHarnesses`, etc., but never `registerDefaultHarnesses`).

**Published `package.json` `exports` field (verified):**

```json
"exports": {
  ".": {
    "import": "./dist/index.js",
    "types": "./dist/index.d.ts"
  }
}
```

Only `"."` is declared. The subpath `groundswell/harnesses` is **NOT** in `exports`. Under Node ESM resolution with a non-wildcard `exports` map, `import { registerDefaultHarnesses } from 'groundswell/harnesses'` is rejected with `ERR_PACKAGE_PATH_NOT_EXPORTED`. The PRD's claim is confirmed.

Workarounds that DO resolve:

- `import { registerDefaultHarnesses } from 'groundswell/dist/harnesses/register-defaults.js'` (deep file path, works only because `dist` is published in `files`).
- Constructing instances manually and calling `registry.register(...)` from the main barrel exports: `import { HarnessRegistry, PiHarness } from 'groundswell'`.

### 6. `Agent` constructor — the exact throw site

File: `node_modules/groundswell/dist/core/agent.js`

Constructor body (1-indexed). The relevant block, starting at L60:

```js
60:         const globalConfig = getGlobalProviderConfig();
61:         const resolved = resolveProviderConfig(globalConfig, this.harnessId, this.harnessOptions);
62:         const effectiveHarness = resolved.provider;
63:         // Fetch the harness instance from HarnessRegistry (the v1.2 rename of ProviderRegistry).
...
67:         const registry = HarnessRegistry.getInstance();
68:         const harnessInstance = registry.get(effectiveHarness);
69:         if (!harnessInstance) {
70:             throw new Error(`Harness '${effectiveHarness}' is not registered`);
71:         }
72:         this.harness = harnessInstance;
```

This throw is synchronous in the constructor — so `new Agent(...)` (and therefore `createAgent(...)`) rejects synchronously with exactly the reported message when the registry is empty.

Note the resolution chain:

- `this.harnessId = config.harness ?? config.provider;` — both undefined when the caller does `createAgent({})` or `createAgent({ name: '...' })`.
- `getGlobalProviderConfig()` returns the **legacy** default `{ defaultProvider: 'anthropic', providerDefaults: undefined }` if `configureProviders()` was never called. So `effectiveHarness` resolves to `'anthropic'` — NOT `'pi'` — unless the caller explicitly sets it.

This means the literal error message the user reports (`"Harness 'pi' is not registered"`) implies one of:

- The caller passed `{ harness: 'pi' }` (or `{ provider: 'pi' }`) to `createAgent`, OR
- The caller called `configureProviders({ defaultProvider: 'pi' })` / `configureHarnesses({ defaultHarness: 'pi' })` first.

In all cases the registry still needs an instance registered under that id, and nothing in the public main-barrel API does that automatically.

The same lookup pattern (with `createErrorResponse('PROVIDER_NOT_FOUND', ...)` instead of a throw) appears later in `executePrompt` (~L420) and `stream()` (~L300). But those are downstream of the constructor, so the constructor throw is the first failure the user hits.

### 7. `createAgent()` — trivial delegation to `new Agent`

File: `node_modules/groundswell/dist/core/factory.js`

```js
export function createAgent(config) {
  return new Agent(config);
}
```

(Declared around L36-43 in the file; body is a single line.) No additional wiring, no auto-registration, no defaults injection. The throw therefore originates 100% from the `Agent` constructor.

## Sources

Kept:

- `node_modules/groundswell/dist/harnesses/harness-registry.js` — `HarnessRegistry` singleton source; line numbers cited above.
- `node_modules/groundswell/dist/harnesses/pi-harness.js` — `PiHarness` (`id = "pi"`) + static `@earendil-works/pi-coding-agent` import at L7.
- `node_modules/groundswell/dist/harnesses/claude-code-harness.js` — `ClaudeCodeHarness`; lazy `await import("@anthropic-ai/claude-agent-sdk")` in `initialize()`.
- `node_modules/groundswell/dist/harnesses/register-defaults.js` — the only place instances are registered; idempotent.
- `node_modules/groundswell/dist/harnesses/index.js` — re-exports `registerDefaultHarnesses` on the `harnesses` subpath.
- `node_modules/groundswell/dist/utils/harness-config.js` — `configureHarnesses` stores config only (no registration).
- `node_modules/groundswell/dist/utils/provider-config.js` — legacy shim re-exported into `agent.ts`.
- `node_modules/groundswell/dist/core/agent.js` — constructor throw site (L70).
- `node_modules/groundswell/dist/core/factory.js` — `createAgent` is a one-line `new Agent(config)`.
- `node_modules/groundswell/dist/index.js` — confirms `PiHarness`, `ClaudeCodeHarness`, `HarnessRegistry`, `configureHarnesses` are on `.` but `registerDefaultHarnesses` is NOT.
- `node_modules/groundswell/package.json` — confirms `exports` has only `"."`.
- `node_modules/@anthropic-ai/claude-agent-sdk/package.json` (ENOENT) — confirms SDK not installed in host.
- `node_modules/@earendil-works/pi-coding-agent/package.json` (ENOENT) — confirms Pi SDK not installed in host.
- `node_modules/groundswell/node_modules` (ENOENT) — confirms no nested deps; yalc install shipped only `dist/`.

Dropped: none — all sources read were on-point.

## Gaps / Suggested next steps

1. **What did the failing caller actually pass to `createAgent()`?** The literal `'pi'` in the error means either an explicit `harness: 'pi'`/`provider: 'pi'` was passed, or `configureProviders({ defaultProvider: 'pi' })` / `configureHarnesses({ defaultHarness: 'pi' })` ran first. Worth confirming in the host code that constructs the agent (e.g., `src/index.ts` or wherever `createAgent` is invoked) before choosing the fix shape.

2. **Fix shape options** (for the parent, not this research task):
   - (a) Import via deep path: `import { registerDefaultHarnesses } from 'groundswell/dist/harnesses/register-defaults.js'` and call it once at boot. Fragile — depends on dist layout; bypasses `exports`.
   - (b) Use only main-barrel exports and register manually:
     ```ts
     import { HarnessRegistry, PiHarness } from 'groundswell';
     const reg = HarnessRegistry.getInstance();
     if (!reg.has('pi')) reg.register(new PiHarness());
     ```
     This is robust to the missing `exports` subpath. Note it will also require `@earendil-works/pi-coding-agent` to be installed (L7 static import in `pi-harness.js`), which is currently missing.
   - (c) Patch `node_modules/groundswell/package.json` `exports` to add `"./harnesses"` (yalc-managed package, so a patch is feasible, but it will be lost on the next yalc publish).
   - (d) Upstream fix: add `registerDefaultHarnesses` to `dist/index.js` and/or add `"./harnesses"` to `exports`.

3. **Dependency installation gap:** neither `@anthropic-ai/claude-agent-sdk` nor `@earendil-works/pi-coding-agent` is installed in the host. Even after fixing registration, the `pi-harness.js` static import (L7) will throw `Cannot find module '@earendil-works/pi-coding-agent'` at import time. The host will need to either install these (e.g., `npm i @earendil-works/pi-coding-agent`) or avoid importing the `pi-harness.js` module altogether (e.g., register only `ClaudeCodeHarness` and ensure the default is `'claude-code'`).

## Acceptance Contract

This is a **research-only** task. Per the instructions: "do not modify any files." The only file written is this research brief at the requested output path. No source files, tests, or `node_modules` were modified. No commands were run beyond file reads.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Scope was research-only (read files, write one markdown brief). No source/config files were modified. The deliverable is the requested architecture brief at plan/004_439241a82c24/bugfix/001_4bbb8673119e/architecture/groundswell_harness_registry.md, covering all 7 requested items (HarnessRegistry, PiHarness, ClaudeCodeHarness, configureHarnesses, registerDefaultHarnesses + exports, Agent throw site L70, createAgent delegation) with exact file paths and 1-indexed line numbers."
    }
  ],
  "changedFiles": [
    "plan/004_439241a82c24/bugfix/001_4bbb8673119e/architecture/groundswell_harness_registry.md (created — research brief only; no code/config changes)"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "read node_modules/groundswell/package.json",
      "result": "passed",
      "summary": "Confirmed exports only has '.'; deps include @anthropic-ai/claude-agent-sdk and @earendil-works/pi-coding-agent (not installed in host)."
    },
    {
      "command": "read node_modules/groundswell/dist/index.js",
      "result": "passed",
      "summary": "Confirmed PiHarness, ClaudeCodeHarness, HarnessRegistry, configureHarnesses are exported on '.'; registerDefaultHarnesses is NOT."
    },
    {
      "command": "read node_modules/groundswell/dist/harnesses/{harness-registry,pi-harness,claude-code-harness,index,register-defaults}.js",
      "result": "passed",
      "summary": "Captured method bodies and line numbers for HarnessRegistry singleton, PiHarness.id='pi', ClaudeCodeHarness lazy SDK import, registerDefaultHarnesses idempotent registration."
    },
    {
      "command": "read node_modules/groundswell/dist/utils/{harness-config,provider-config}.js",
      "result": "passed",
      "summary": "Confirmed configureHarnesses stores config only (no register()); legacy provider-config shim still read by agent.ts."
    },
    {
      "command": "read node_modules/groundswell/dist/core/{agent,factory}.js",
      "result": "passed",
      "summary": "Located throw site at agent.js L70 (HarnessRegistry.getInstance().get(effectiveHarness)); createAgent is a one-line new Agent(config)."
    },
    {
      "command": "read node_modules/@anthropic-ai/claude-agent-sdk/package.json + node_modules/@earendil-works/pi-coding-agent/package.json + node_modules/groundswell/node_modules",
      "result": "passed",
      "summary": "All three ENOENT — confirms both SDKs are absent from the host and groundswell was installed via yalc (dist only)."
    }
  ],
  "validationOutput": [],
  "residualRisks": [
    "Fixing only the registration (registerDefaultHarnesses or manual register) is INSUFFICIENT: pi-harness.js L7 statically imports @earendil-works/pi-coding-agent, which is not installed. Importing PiHarness will throw at module load. The parent's bugfix plan must account for either installing the Pi SDK or steering the default to 'claude-code' (whose SDK is also absent but only lazily required).",
    "agent.ts still reads the legacy getGlobalProviderConfig()/resolveProviderConfig() path; default provider there is 'anthropic', not 'pi'. So a caller reporting the literal 'pi' message must have explicitly set it — confirm the call site before assuming the global default is the trigger.",
    "Patching node_modules/groundswell/package.json exports (option c) is volatile under yalc republish."
  ],
  "noStagedFiles": true,
  "notes": "Root cause in one line: the Agent constructor requires a registered harness instance, but nothing on the public '.' entry auto-registers one — registerDefaultHarnesses is the only registrar and it lives on an un-exported subpath. See 'Gaps / Suggested next steps' for the four fix-shape options ranked by robustness."
}
```
