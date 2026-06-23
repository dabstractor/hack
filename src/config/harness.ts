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
import {
  DEFAULT_HARNESS,
  DEFAULT_MODEL_PROVIDER,
  PRP_AGENT_HARNESS,
  SUPPORTED_HARNESSES,
} from './constants.js';
import { getModel } from './environment.js';
import type { AgentHarness } from './types.js';
import { HarnessProviderMismatchError } from './types.js';

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
 * @throws {Error} If `PRP_AGENT_HARNESS` is not a supported harness id.
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
    throw new Error(
      `Unsupported PRP_AGENT_HARNESS value: "${raw}". ` +
        `Supported harnesses: ${SUPPORTED_HARNESSES.join(', ')}.`
    );
  }

  // Step 3: Type-safe cast (validated above)
  const harness = raw as AgentHarness;

  // Step 4: Enforce harness↔provider compatibility
  const resolvedProvider = getModel('sonnet').split('/')[0];
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
      'claude-code': { apiKey: process.env.ANTHROPIC_API_KEY },
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
  const apiKey = process.env.ANTHROPIC_API_KEY;
  await registry.initializeProvider('pi', apiKey ? { apiKey } : undefined);
}
