/**
 * Harness configuration module for agent runtime selection
 *
 * @module config/harness
 *
 * @remarks
 * Reads the `PRP_AGENT_HARNESS` environment variable, validates it against
 * supported harnesses, enforces harness↔provider compatibility, and delegates
 * to Groundswell's `configureHarnesses()`. This module is consumed at startup
 * by `agent-factory.ts`.
 *
 * @example
 * ```ts
 * import { configureHarness } from './config/harness.js';
 *
 * const harness = configureHarness(); // 'pi' | 'claude-code'
 * ```
 */

import { configureHarnesses, PiHarness, HarnessRegistry } from 'groundswell';
import { AuthStorage } from '@earendil-works/pi-coding-agent';
import {
  DEFAULT_HARNESS,
  DEFAULT_MODEL_PROVIDER,
  PRP_AGENT_HARNESS,
  PRP_API_KEY,
  SUPPORTED_HARNESSES,
} from './constants.js';
import { getResolvedProvider, getModel } from './environment.js';
import type { AgentHarness } from './types.js';
import {
  HarnessProviderMismatchError,
  UnsupportedHarnessError,
  AuthPreflightError,
} from './types.js';

/**
 * Get the provider-native env-var value for API key lookup (PRD §9.2.6).
 *
 * @remarks
 * Mirrors pi's `getEnvApiKey(provider)` mapping (stable, identity across versions):
 * - `zai` → `ZAI_API_KEY`
 * - `anthropic` → `ANTHROPIC_OAUTH_TOKEN` then `ANTHROPIC_API_KEY`
 *
 * Pure + synchronous — reads `process.env` only.
 *
 * @returns The raw env value, or undefined if no known env var is set.
 */
function getProviderEnvApiKey(provider: string): string | undefined {
  if (provider === 'zai') {
    return process.env.ZAI_API_KEY;
  }
  if (provider === 'anthropic') {
    return process.env.ANTHROPIC_OAUTH_TOKEN ?? process.env.ANTHROPIC_API_KEY;
  }
  return undefined;
}

/**
 * Resolve the API key to forward into the harness options for a given provider (PRD §9.2.6).
 *
 * Priority (first NON-EMPTY wins; whitespace-only == "not configured"):
 *   1. Explicit override — options.override, else process.env.PRP_API_KEY.
 *   2. Provider-native env var — zai→ZAI_API_KEY; anthropic→OAUTH_TOKEN then API_KEY.
 *   3. ~/.pi/agent/auth.json — hacky-hack forwards NOTHING; pi's file-backed AuthStorage
 *      (Groundswell T2.S2) resolves natively. ⇒ returns undefined here.
 *
 * @param provider - The LLM provider id (e.g. 'zai', 'anthropic').
 * @param options - Optional override; options.override takes highest precedence.
 * @returns The non-empty resolved credential, or undefined (forward nothing; let pi resolve).
 *
 * @example
 * ```ts
 * import { resolveApiKeyForProvider } from './config/harness.js';
 *
 * // With ZAI_API_KEY set, no override:
 * resolveApiKeyForProvider('zai'); // → 'the-zai-key'
 *
 * // With no credential configured:
 * resolveApiKeyForProvider('zai'); // → undefined
 * ```
 */
export function resolveApiKeyForProvider(
  provider: string,
  options?: { override?: string }
): string | undefined {
  // 1. Explicit override (highest precedence, non-empty only).
  const override = (options?.override ?? process.env[PRP_API_KEY])?.trim();
  if (override) return override;

  // 2. Provider-native env var (pi's mapping; trimmed; empty == not configured).
  const envVal = getProviderEnvApiKey(provider)?.trim();
  if (envVal) return envVal;

  // 3. auth.json — deferred to pi's file-backed AuthStorage (T2.S2). Forward nothing.
  return undefined;
}

/**
 * Configure the global agent harness at startup (PRD §9.4.2 / §9.5).
 *
 * @remarks
 * Reads `PRP_AGENT_HARNESS` (default `'pi'`), validates it against
 * `SUPPORTED_HARNESSES`, enforces harness↔provider compatibility (PRD §9.2.4 /
 * §9.4.3 — `claude-code` is Anthropic-only and rejects the default `zai`
 * provider), then delegates to Groundswell `configureHarnesses()`.
 *
 * Intentional side effect: populates the global harness singleton. Must run
 * AFTER `configureEnvironment()` (which maps `ANTHROPIC_AUTH_TOKEN` →
 * `ANTHROPIC_API_KEY`) so the `harnessDefaults` apiKey binding is populated.
 *
 * @returns The resolved, validated harness id (for downstream consumption).
 * @throws {UnsupportedHarnessError} If `PRP_AGENT_HARNESS` is not a supported harness id.
 * @throws {HarnessProviderMismatchError} If `claude-code` is selected with the
 *   default `zai` provider.
 *
 * @example
 * ```ts
 * import { configureHarness } from './config/harness.js';
 *
 * const harness = configureHarness(); // returns 'pi' when env unset
 * ```
 */
export function configureHarness(): AgentHarness {
  // Step 1: Read env var with default
  const raw = process.env[PRP_AGENT_HARNESS] ?? DEFAULT_HARNESS;

  // Step 2: Validate against supported harnesses
  if (!(SUPPORTED_HARNESSES as readonly string[]).includes(raw)) {
    throw new UnsupportedHarnessError(raw, SUPPORTED_HARNESSES);
  }

  // Step 3: Type-safe cast (validated above)
  const harness = raw as AgentHarness;

  // Step 4: Enforce harness↔provider compatibility
  const resolvedProvider = getResolvedProvider();
  if (harness === 'claude-code' && resolvedProvider === 'zai') {
    throw new HarnessProviderMismatchError(harness, resolvedProvider);
  }

  // Step 4.5: Register the default 'pi' harness instance idempotently.
  //
  // configureHarnesses() (Step 5) only stores a *config* singleton — it does NOT populate the
  // HarnessRegistry. Groundswell's `new Agent(...)` does registry.get('pi') and throws
  // "Harness 'pi' is not registered" when nothing is registered, so we register a live PiHarness
  // here. The has() guard is MANDATORY: configureHarness() runs at module-load in
  // agent-factory.ts and registry.register() throws "Provider 'pi' is already registered" on
  // a second call.
  const registry = HarnessRegistry.getInstance();
  if (!registry.has('pi')) {
    registry.register(new PiHarness());
  }

  // Step 5: Delegate to Groundswell global harness configuration
  configureHarnesses({
    defaultHarness: harness,
    defaultModelProvider: DEFAULT_MODEL_PROVIDER,
    harnessDefaults: {
      'claude-code': {
        apiKey: resolveApiKeyForProvider('anthropic') ?? undefined,
      },
    },
  });

  // Step 6: Return resolved harness for downstream consumers
  return harness;
}

/**
 * Initialize the resolved agent harness (PRD §9.4.2).
 *
 * @remarks
 * `configureHarness()` only *registers* a live `PiHarness` in the
 * `HarnessRegistry`; it does NOT call `PiHarness.initialize()`. Groundswell's
 * `Agent` layer assumes the harness is already initialized and never calls
 * `initialize()` itself, so without this step every `agent.prompt()` fails
 * sub-second with `"PiHarness not initialized"` — an error the harness wraps
 * into an `{ status: 'error' }` response (not a throw), which upstream code
 * silently dropped.
 *
 * This performs the async initialization (`await import(pi-sdk)`, build the
 * in-memory model registry, bind the API key) exactly once. Idempotent:
 * `HarnessRegistry.initializeProvider()` caches the initialized state, and the
 * `has('pi')` guard mirrors `configureHarness()` to avoid double-registration.
 *
 * MUST be called after `configureEnvironment()` (so `ANTHROPIC_API_KEY` is
 * populated) and before any agent runs.
 */
export async function ensureHarnessInitialized(): Promise<void> {
  const registry = HarnessRegistry.getInstance();
  if (!registry.has('pi')) {
    registry.register(new PiHarness());
  }
  const apiKey = resolveApiKeyForProvider(getResolvedProvider());
  await registry.initializeProvider('pi', apiKey ? { apiKey } : undefined);
}

/**
 * Run the fail-fast auth preflight (PRD §9.2.7).
 *
 * @remarks
 * Invoked in `main()` AFTER {@link configureEnvironment} and BEFORE
 * {@link ensureHarnessInitialized} / `new PRPPipeline(...)`. Resolves the selected
 * harness + provider/model and verifies that at least one auth source (PRD §9.2.6) is
 * available for that provider:
 *   1. hacky-hack override/env — {@link resolveApiKeyForProvider} (trims; empty/whitespace
 *      == "not configured").
 *   2. pi's file-backed `AuthStorage.create()` — `getAuthStatus(provider).configured` (the
 *      SAME resolver the `pi` harness uses at runtime; honors `~/.pi/agent/auth.json`).
 *
 * For the `claude-code` harness the check targets the `anthropic` provider (that harness is
 * Anthropic-only). On failure, throws {@link AuthPreflightError} — the pipeline then aborts
 * at startup with exit code 1, BEFORE any session directory is created or any agent is invoked.
 *
 * @throws {AuthPreflightError} When no credential is resolvable for the selected provider.
 *
 * @example
 * ```ts
 * import { runAuthPreflight } from './config/harness.js';
 *
 * configureEnvironment();
 * await runAuthPreflight();        // throws AuthPreflightError if misconfigured
 * await ensureHarnessInitialized();
 * ```
 */
export async function runAuthPreflight(): Promise<void> {
  const harness = process.env[PRP_AGENT_HARNESS] ?? DEFAULT_HARNESS;
  const model = getModel('sonnet');
  const provider =
    harness === 'claude-code' ? 'anthropic' : getResolvedProvider();

  // Source 1+2: hacky-hack override/env (empty/whitespace == not configured via .trim()).
  if (resolveApiKeyForProvider(provider)) {
    return; // configured
  }

  // Source 3: pi file-backed AuthStorage — auth.json (SAME resolver the harness uses at runtime).
  // getAuthStatus().configured is false for the `environment` source → whitespace env does NOT pass.
  if (AuthStorage.create().getAuthStatus(provider).configured) {
    return; // configured (auth.json)
  }

  throw new AuthPreflightError({ harness, provider, model });
}
