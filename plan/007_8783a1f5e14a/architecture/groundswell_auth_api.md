# Groundswell Auth & Harness API Surface — Verbatim Brief

All paths are absolute. Library versions: `@earendil-works/pi-coding-agent` (host) re-exports
`AuthStorage`/`ModelRegistry` from its own `dist/core/auth-storage.js` and `dist/core/model-registry.js`.
Env-var mapping and `getEnvApiKey` live in the nested `@earendil-works/pi-ai@0.79.8`.

> Packages discovered (the second is nested under the first):
> - `/home/dustin/projects/groundswell/node_modules/@earendil-works/pi-coding-agent/`
> - `/home/dustin/projects/groundswell/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/` (v0.79.8)

---

## 1. `PiHarness.initialize()` — `AuthStorage.inMemory()` + `ModelRegistry.inMemory(authStorage)`

**File:** `/home/dustin/projects/groundswell/src/harnesses/pi-harness.ts`

Imports (top of file, line 24):
```ts
import { ModelRegistry, AuthStorage } from "@earendil-works/pi-coding-agent";
```

Full method (lines 124-149), verbatim:
```ts
  /**
   * Initialize the Pi harness (PRD §7.3).
   *
   * Lazily `await import`s the Pi SDK, builds a headless `ModelRegistry.inMemory(...)`, and stores
   * the caller's options. Does NOT call `createAgentSession` — that is T2 (P2.M2.T2.S1), which
   * consumes `this.sdk`, `this.modelRegistry`, and `this.resolveModel(spec)`.
   *
   * Idempotent: a no-op if already initialized. API keys are resolved per-provider at
   * `resolveModel` time (the provider is unknown until a model string is parsed — GOTCHA #8).
   */
  async initialize(options?: HarnessOptions): Promise<void> {
    // Idempotent guard (mirror ClaudeCodeHarness L233-235).
    if (this.sdk) return;

    // Lazy SDK import (mirror ClaudeCodeHarness L237-248).
    try {
      this.sdk = await import("@earendil-works/pi-coding-agent");
    } catch (error) {
      throw new Error(
        `Failed to load @earendil-works/pi-coding-agent: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    }
    if (!this.sdk) {
      throw new Error("Failed to load @earendil-works/pi-coding-agent: Import returned null");
    }

    // Headless registry: no disk (no agentDir/models.json/auth.json). Env-var key resolution
    // is built into AuthStorage.getApiKey (GOTCHA #7).
    this.authStorage = AuthStorage.inMemory();          // line 144 — NO args
    this.modelRegistry = ModelRegistry.inMemory(this.authStorage);  // line 145 — authStorage REQUIRED

    // Store options; apiKey is applied per-provider in resolveModel (GOTCHA #8).
    this.options = options ?? null;
  }
```

**Key facts for the contract:**
- `initialize()` always constructs an in-memory store. There is NO parameter that lets a caller
  inject a file-backed `AuthStorage`.
- The instance fields it populates (declared lines ~70-90):
  ```ts
  private sdk: typeof import("@earendil-works/pi-coding-agent") | null = null;
  private authStorage: AuthStorage | null = null;
  private modelRegistry: ModelRegistry | null = null;
  private options: HarnessOptions | null = null;
  ```
- `resolveModel()` (lines ~177-205) consumes options.apiKey via
  `this.authStorage.setRuntimeApiKey(spec.provider, this.options.apiKey)`, then calls
  `this.modelRegistry.find(spec.provider, spec.model)`.
- `terminate()` (lines ~155-163) nulls all four fields.

---

## 2. `AuthStorage` class API

**Files:**
- `/home/dustin/projects/groundswell/node_modules/@earendil-works/pi-coding-agent/dist/core/auth-storage.d.ts`
- `/home/dustin/projects/groundswell/node_modules/@earendil-works/pi-coding-agent/dist/core/auth-storage.js`

### Does `AuthStorage.create()` exist? — YES

From `.d.ts`:
```ts
export declare class AuthStorage {
    private data;
    private runtimeOverrides;
    private fallbackResolver?;
    private loadError;
    private errors;
    private storage;
    private constructor();
    static create(authPath?: string): AuthStorage;
    static fromStorage(storage: AuthStorageBackend): AuthStorage;
    static inMemory(data?: AuthStorageData): AuthStorage;
    ...
}
```

Verbatim implementation (`.js` lines 147-175):
```js
export class AuthStorage {
    data = {};
    runtimeOverrides = new Map();
    fallbackResolver;
    loadError = null;
    errors = [];
    storage;
    constructor(storage) {              // PRIVATE — only callable via the static factories
        this.storage = storage;
        this.reload();
    }
    static create(authPath) {
        return new AuthStorage(new FileAuthStorageBackend(authPath ?? join(getAgentDir(), "auth.json")));
    }
    static fromStorage(storage) {
        return new AuthStorage(storage);
    }
    static inMemory(data = {}) {
        const storage = new InMemoryAuthStorageBackend();
        storage.withLock(() => ({ result: undefined, next: JSON.stringify(data, null, 2) }));
        return AuthStorage.fromStorage(storage);
    }
    ...
}
```

### `FileAuthStorageBackend` — default path IS `getAgentDir()/auth.json`

From `.d.ts`:
```ts
export interface AuthStorageBackend {
    withLock<T>(fn: (current: string | undefined) => LockResult<T>): T;
    withLockAsync<T>(fn: (current: string | undefined) => Promise<LockResult<T>>): Promise<T>;
}
export declare class FileAuthStorageBackend implements AuthStorageBackend {
    private authPath;
    constructor(authPath?: string);     // DEFAULT below
    ...
}
export declare class InMemoryAuthStorageBackend implements AuthStorageBackend { ... }
```

Verbatim constructor (`.js` lines 17-20):
```js
export class FileAuthStorageBackend {
    authPath;
    constructor(authPath = join(getAgentDir(), "auth.json")) {
        this.authPath = normalizePath(authPath);
    }
    ...
}
```

So the default is **`join(getAgentDir(), "auth.json")`** — i.e. `~/.pi/agent/auth.json` (see §6).
`AuthStorage.create(authPath?)` independently applies the SAME default if `authPath` is omitted.

### Other public AuthStorage methods (relevant to a contract)

```ts
setRuntimeApiKey(provider: string, apiKey: string): void;        // in-memory override (highest priority)
removeRuntimeApiKey(provider: string): void;
setFallbackResolver(resolver: (provider: string) => string | undefined): void;
reload(): void;
get(provider: string): AuthCredential | undefined;
getProviderEnv(provider: string): Record<string, string> | undefined;
set(provider: string, credential: AuthCredential): void;
remove(provider: string): void;
list(): string[];
has(provider: string): boolean;                                  // only checks auth.json (in-memory data)
hasAuth(provider: string): boolean;                              // runtime + auth.json + env + fallback
getAuthStatus(provider: string): AuthStatus;
getAll(): AuthStorageData;
drainErrors(): Error[];
login(providerId: OAuthProviderId, callbacks: OAuthLoginCallbacks): Promise<void>;
logout(provider: string): void;
getApiKey(providerId: string, options?: { includeFallback?: boolean }): Promise<string | undefined>;
getOAuthProviders(): OAuthProviderInterface[];
```

`AuthStatus` shape:
```ts
export type AuthStatus = {
    configured: boolean;
    source?: "stored" | "runtime" | "environment" | "fallback" | "models_json_key" | "models_json_command";
    label?: string;
};
```

`getApiKey()` priority order (verbatim from the source comment):
```
1. Runtime override (CLI --api-key)             → runtimeOverrides.get(provider)
2. API key from auth.json                        → data[provider] with type "api_key"
3. OAuth token from auth.json (auto-refreshed)   → data[provider] with type "oauth"
4. Environment variable                          → getEnvApiKey(providerId)
5. Fallback resolver (models.json custom providers)
```

### Backing types
```ts
export type ApiKeyCredential = { type: "api_key"; key: string; env?: Record<string, string> };
export type OAuthCredential   = { type: "oauth" } & OAuthCredentials;
export type AuthCredential    = ApiKeyCredential | OAuthCredential;
export type AuthStorageData   = Record<string, AuthCredential>;
```

### What it imports (relevant to key resolution wiring)
`auth-storage.js` line 1-2:
```js
import { findEnvKeys, getEnvApiKey } from "@earendil-works/pi-ai";
import { getOAuthApiKey, getOAuthProvider, getOAuthProviders } from "@earendil-works/pi-ai/oauth";
```
And `getAgentDir` from `../config.js`.

---

## 3. `ModelRegistry` — `inMemory()` vs file-backed; AuthStorage is REQUIRED

**Files:**
- `/home/dustin/projects/groundswell/node_modules/@earendil-works/pi-coding-agent/dist/core/model-registry.d.ts`
- `/home/dustin/projects/groundswell/node_modules/@earendil-works/pi-coding-agent/dist/core/model-registry.js`

Static factories (`.d.ts`):
```ts
export declare class ModelRegistry {
    ...
    readonly authStorage: AuthStorage;
    private modelsJsonPath;
    private constructor();
    static create(authStorage: AuthStorage, modelsJsonPath?: string): ModelRegistry;
    static inMemory(authStorage: AuthStorage): ModelRegistry;
    ...
}
```

Verbatim (`.js` lines 241-253):
```js
    authStorage;
    constructor(authStorage, modelsJsonPath) {           // PRIVATE
        this.authStorage = authStorage;
        this.modelsJsonPath = modelsJsonPath;
        ...
    }
    static create(authStorage, modelsJsonPath = join(getAgentDir(), "models.json")) {
        return new ModelRegistry(authStorage, modelsJsonPath);     // FILE-BACKED
    }
    static inMemory(authStorage) {
        return new ModelRegistry(authStorage, undefined);          // modelsJsonPath=undefined → built-ins only
    }
```

**Yes — both `inMemory()` and `create()` REQUIRE a caller-supplied `AuthStorage`.**
There is no overload that builds its own auth store.

`authStorage` is exposed `readonly` on the instance (`.d.ts`):
```ts
readonly authStorage: AuthStorage;
```

Key lookup methods (relevant to a contract):
```ts
find(provider: string, modelId: string): Model<Api> | undefined;
getAll(): Model<Api>[];
getAvailable(): Model<Api>[];                                  // only models with auth configured
hasConfiguredAuth(model: Model<Api>): boolean;
getApiKeyAndHeaders(model: Model<Api>): Promise<ResolvedRequestAuth>;
getProviderAuthStatus(provider: string): AuthStatus;
getProviderDisplayName(provider: string): string;
getApiKeyForProvider(provider: string): Promise<string | undefined>;
isUsingOAuth(model: Model<Api>): boolean;
registerProvider(providerName: string, config: ProviderConfigInput): void;
unregisterProvider(providerName: string): void;
refresh(): void;                                               // reload from disk
getError(): string | undefined;
```

`ResolvedRequestAuth`:
```ts
export type ResolvedRequestAuth =
  | { ok: true; apiKey?: string; headers?: Record<string, string>; env?: Record<string, string> }
  | { ok: false; error: string };
```

Internally (`.js` line 518-522) `getApiKeyAndHeaders` does:
```js
const providerEnv = this.authStorage.getProviderEnv(model.provider);
const apiKeyFromAuthStorage = await this.authStorage.getApiKey(model.provider, { includeFallback: false });
```

---

## 4. `HarnessRegistry.initializeProvider('pi', { apiKey })` — options type, NO `authStorage` slot

**File:** `/home/dustin/projects/groundswell/src/harnesses/harness-registry.ts`

Signature (verbatim, the public method):
```ts
public async initializeProvider(
    id: ProviderId,
    options?: ProviderOptions
): Promise<void>
```

It just forwards to the registered harness's `initialize`:
```ts
const provider = this.get(id);
...
await provider.initialize(options);
```

### `ProviderOptions` shape (legacy, NOT slimmed)

**File:** `/home/dustin/projects/groundswell/src/types/providers.ts` (lines 127-)
```ts
/** @deprecated Since v1.2. Use {@link HarnessOptions} from types/harnesses.ts. */
export interface ProviderOptions {
  endpoint?: string;
  apiKey?: string;
  sessionId?: string;
  timeout?: number;
  headers?: Record<string, string>;
  sessionStore?: import("../harnesses/session-store.js").SessionStore<SessionState>;
  sessionPersistence?: 'memory' | 'file';
  sessionTtl?: number;
  sessionPath?: string;
}
```

### `HarnessOptions` shape (current, slimmed)

**File:** `/home/dustin/projects/groundswell/src/types/harnesses.ts` (lines 70-84)
```ts
export interface HarnessOptions {
  /** API endpoint override */
  endpoint?: string;
  /** API key (forwarded to the LLM provider) */
  apiKey?: string;
  /** Session/resume id */
  sessionId?: string;
  /** Timeout in milliseconds */
  timeout?: number;
  /** Custom headers */
  headers?: Record<string, string>;
}
```

### Can `initializeProvider` accept a caller-supplied `authStorage`? — **NO**

Neither `ProviderOptions` nor `HarnessOptions` carries an `authStorage` field. `PiHarness.initialize()`
(§1) ignores options entirely for store construction — it ALWAYS calls `AuthStorage.inMemory()` and
`ModelRegistry.inMemory(this.authStorage)`. To inject a file-backed `AuthStorage` you must either:
- construct the harness directly (not via the registry) and override before `initialize()`, OR
- change `PiHarness.initialize()` to read `options.authStorage` and use
  `AuthStorage.fromStorage(...)` / `ModelRegistry.create(authStorage, modelsJsonPath)`.

`HarnessRegistry` is a singleton: `HarnessRegistry.getInstance()`; `register(provider)`, `get(id)`,
`has(id)`, `getStatus(id)`, `isReady(id)`, `terminateAll()`. `ProviderRegistry` is a deprecated alias
of `HarnessRegistry` (same export).

---

## 5. Env-var mapping — `zai`, `anthropic` (and the full table)

**File:** `/home/dustin/projects/groundswell/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/env-api-keys.js`

Public API (`.d.ts`):
```ts
export declare function findEnvKeys(provider: KnownProvider, env?: ProviderEnv): string[] | undefined;
export declare function findEnvKeys(provider: string, env?: ProviderEnv): string[] | undefined;
export declare function getEnvApiKey(provider: KnownProvider, env?: ProviderEnv): string | undefined;
export declare function getEnvApiKey(provider: string, env?: ProviderEnv): string | undefined;
```

The mapping function `getApiKeyEnvVars(provider)` (verbatim):

```js
function getApiKeyEnvVars(provider) {
    if (provider === "github-copilot") {
        return ["COPILOT_GITHUB_TOKEN"];
    }
    // ANTHROPIC_OAUTH_TOKEN takes precedence over ANTHROPIC_API_KEY
    if (provider === "anthropic") {
        return ["ANTHROPIC_OAUTH_TOKEN", "ANTHROPIC_API_KEY"];
    }
    const envMap = {
        "ant-ling": "ANT_LING_API_KEY",
        openai: "OPENAI_API_KEY",
        "azure-openai-responses": "AZURE_OPENAI_API_KEY",
        nvidia: "NVIDIA_API_KEY",
        deepseek: "DEEPSEEK_API_KEY",
        google: "GEMINI_API_KEY",
        "google-vertex": "GOOGLE_CLOUD_API_KEY",
        groq: "GROQ_API_KEY",
        cerebras: "CEREBRAS_API_KEY",
        xai: "XAI_API_KEY",
        openrouter: "OPENROUTER_API_KEY",
        "vercel-ai-gateway": "AI_GATEWAY_API_KEY",
        zai: "ZAI_API_KEY",
        "zai-coding-cn": "ZAI_CODING_CN_API_KEY",
        mistral: "MISTRAL_API_KEY",
        minimax: "MINIMAX_API_KEY",
        "minimax-cn": "MINIMAX_CN_API_KEY",
        moonshotai: "MOONSHOT_API_KEY",
        "moonshotai-cn": "MOONSHOT_API_KEY",
        huggingface: "HF_TOKEN",
        fireworks: "FIREWORKS_API_KEY",
        together: "TOGETHER_API_KEY",
        opencode: "OPENCODE_API_KEY",
        "opencode-go": "OPENCODE_API_KEY",
        "kimi-coding": "KIMI_API_KEY",
        "cloudflare-workers-ai": "CLOUDFLARE_API_KEY",
        "cloudflare-ai-gateway": "CLOUDFLARE_API_KEY",
        xiaomi: "XIAOMI_API_KEY",
        "xiaomi-token-plan-cn": "XIAOMI_TOKEN_PLAN_CN_API_KEY",
        "xiaomi-token-plan-ams": "XIAOMI_TOKEN_PLAN_AMS_API_KEY",
        "xiaomi-token-plan-sgp": "XIAOMI_TOKEN_PLAN_SGP_API_KEY",
    };
    const envVar = envMap[provider];
    return envVar ? [envVar] : undefined;
}
```

**Exact mapping for the two providers requested:**

| Provider     | Env var(s) (in priority order)                                   |
|--------------|------------------------------------------------------------------|
| `zai`        | `ZAI_API_KEY`                                                    |
| `anthropic`  | `ANTHROPIC_OAUTH_TOKEN`, then `ANTHROPIC_API_KEY`                |

Other notable adjacent providers: `zai-coding-cn` → `ZAI_CODING_CN_API_KEY`; `xai` → `XAI_API_KEY`.

`getEnvApiKey` (resolution function) also has special-case branches:
- `google-vertex`: returns `"<authenticated>"` if ADC credentials + `GOOGLE_CLOUD_PROJECT`/`GCLOUD_PROJECT` + `GOOGLE_CLOUD_LOCATION` are all present (no API-key var).
- `amazon-bedrock`: returns `"<authenticated>"` for any of `AWS_PROFILE`, `AWS_ACCESS_KEY_ID`+`AWS_SECRET_ACCESS_KEY`, `AWS_BEARER_TOKEN_BEDROCK`, `AWS_CONTAINER_CREDENTIALS_RELATIVE_URI`, `AWS_CONTAINER_CREDENTIALS_FULL_URI`, `AWS_WEB_IDENTITY_TOKEN_FILE`.
- Otherwise returns `getProviderEnvValue(envKeys[0], env)` for the first found env var.

`getProviderEnvValue` is imported from `./utils/provider-env.js` (env-name resolver; supports a prefix convention — not opened here, but worth checking if you rely on namespaced env vars).

---

## 6. `getAgentDir()` — resolves to `~/.pi/agent` (overridable)

**File:** `/home/dustin/projects/groundswell/node_modules/@earendil-works/pi-coding-agent/dist/config.js` (lines 386-410)

Verbatim:
```js
export const CONFIG_DIR_NAME = pkg.piConfig?.configDir || ".pi";
...
export const ENV_AGENT_DIR = `${APP_NAME.toUpperCase()}_CODING_AGENT_DIR`;
...
/** Get the agent config directory (e.g., ~/.pi/agent/) */
export function getAgentDir() {
    const envDir = process.env[ENV_AGENT_DIR];
    if (envDir) {
        return expandTildePath(envDir);
    }
    return join(homedir(), CONFIG_DIR_NAME, "agent");
}
```

- Default: `~/.pi/agent` (i.e. `join(homedir(), ".pi", "agent")`).
- Override: env var `PI_CODING_AGENT_DIR` (the `${APP_NAME.toUpperCase()}_CODING_AGENT_DIR` form;
  `APP_NAME` resolves to `"pi"` in this package — confirm by grepping `APP_NAME =` if you depend on
  the exact prefix). Value is run through `expandTildePath`.

Sibling path helpers in the same file:
```js
getCustomThemesDir()  → join(getAgentDir(), "themes")
getModelsPath()       → join(getAgentDir(), "models.json")
getAuthPath()         → join(getAgentDir(), "auth.json")        // matches FileAuthStorageBackend default
getSettingsPath()     → join(getAgentDir(), "settings.json")
getToolsDir()         → join(getAgentDir(), "tools")
getBinDir()           → join(getAgentDir(), "bin")
getPromptsDir()       → join(getAgentDir(), "prompts")
getSessionsDir()      → join(getAgentDir(), "sessions")
getDebugLogPath()     → join(getAgentDir(), `${APP_NAME}-debug.log`)
```

---

## Architecture / how the pieces connect

```
HarnessRegistry.initializeProvider('pi', opts)
        │
        ▼
PiHarness.initialize(opts)              src/harnesses/pi-harness.ts:124
        │  (always; opts cannot inject storage)
        ├─ this.authStorage   = AuthStorage.inMemory()                // InMemoryAuthStorageBackend
        └─ this.modelRegistry = ModelRegistry.inMemory(authStorage)   // built-ins only; no models.json
                │
                ▼ (per execute() call)
        PiHarness.resolveModel(spec)
                ├─ authStorage.setRuntimeApiKey(spec.provider, opts.apiKey)   // runtime override
                └─ modelRegistry.find(provider, model)                        // Model<Api> | undefined
                        │
                        ▼ (at request time, inside Pi SDK)
                ModelRegistry.getApiKeyAndHeaders(model)
                        └─ authStorage.getApiKey(provider, { includeFallback:false })
                                priority: runtime → auth.json api_key → auth.json oauth →
                                          getEnvApiKey(provider) → fallback resolver
```

To switch from in-memory to disk-backed auth you must change `PiHarness.initialize()` itself
(no public seam today). The natural patch:

```ts
// sketch — NOT in the codebase today
this.authStorage = options?.authStorage
  ?? AuthStorage.create();                                  // FileAuthStorageBackend → ~/.pi/agent/auth.json
this.modelRegistry = options?.modelRegistry
  ?? ModelRegistry.create(this.authStorage);                // reads ~/.pi/agent/models.json
```

This requires adding `authStorage?: AuthStorage` / `modelRegistry?: ModelRegistry` to
`HarnessOptions` (or to a Pi-specific options extension — `HarnessOptions` is explicitly
designed to be extended per PRD §7.5).

---

## Start Here

Open `/home/dustin/projects/groundswell/src/harnesses/pi-harness.ts:124` — that is the single
method that decides whether auth is in-memory or disk-backed. Everything downstream
(`resolveModel`, `ModelRegistry.find`, `AuthStorage.getApiKey`, `getEnvApiKey`) is already
file/env capable; the bottleneck is the two lines at 144-145.

For the env-var contract, open
`/home/dustin/projects/groundswell/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/env-api-keys.js`
— `zai`→`ZAI_API_KEY` and `anthropic`→`ANTHROPIC_OAUTH_TOKEN`/`ANTHROPIC_API_KEY`.

---

## Open questions / risks

- `APP_NAME` confirmed: `config.js:384` `export const APP_NAME = piConfigName || "pi"` where
  `piConfigName = pkg.piConfig?.name`. Default is `"pi"`, so `ENV_AGENT_DIR = "PI_CODING_AGENT_DIR"`
  (verified). Only changes if the consuming app sets `package.json#piConfig.name`.
- `HarnessOptions` extension point is explicitly sanctioned by the type doc ("Harness
  implementations MAY extend this with harness-specific fields"), so adding `authStorage?` there
  is type-safe; adding it to the shared `ProviderOptions` is also possible but that type is marked
  `@deprecated`.
- `AuthStorage.inMemory(data?)` accepts a seed `AuthStorageData` — useful for tests that want to
  pre-seed `{ zai: { type: "api_key", key: "..." } }` without touching disk.
- `ModelRegistry.inMemory(authStorage)` skips `models.json` entirely (built-in models only). Use
  `ModelRegistry.create(authStorage)` to also merge `~/.pi/agent/models.json` (custom providers).
