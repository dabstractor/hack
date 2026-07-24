/**
 * Environment configuration module for z.ai API compatibility
 *
 * @module config/environment
 *
 * @remarks
 * This module provides type-safe access to Anthropic/z.ai API configuration.
 * It handles the critical mapping between shell environment variables and
 * SDK expectations, validates configuration, and provides model selection.
 *
 * @example
 * ```ts
 * import { configureEnvironment, getModel, validateEnvironment } from './config/environment.js';
 *
 * // Configure environment at application startup
 * configureEnvironment();
 *
 * // Validate required variables are set
 * validateEnvironment();
 *
 * // Get model name for agent creation
 * const model = getModel('balanced'); // 'zai/glm-5.2'
 * ```
 */

import {
  DEFAULT_BASE_URL,
  DEFAULT_MODEL_PROVIDER,
  MODEL_NAMES,
  MODEL_ENV_VARS,
  LEGACY_MODEL_ENV_VARS,
  PRP_API_BASE_URL,
} from './constants.js';
import type { ModelTier } from './types.js';
import { EnvironmentValidationError } from './types.js';

/**
 * Module-private one-time deprecation-warning dedup (PRD §9.2.8).
 *
 * @remarks
 * Keyed by `'model:${tier}'` | `'baseURL'`. `getModel()` runs per agent creation
 * (many times) and `configureEnvironment()` runs at startup, so without dedup a
 * legacy `.env` would spam warnings. Mirrors the `clearLoggerCache()` underscore-
 * prefixed test-reset-hook pattern in logger.ts.
 */
const _deprecatedWarned = new Set<string>();

/**
 * Reset the one-time deprecation-warning guards.
 *
 * @remarks
 * Production code never calls this. Test-only hook (mirrors logger.ts
 * `clearLoggerCache`) so individual `it()` blocks can re-arm the dedup `Set`,
 * since vitest does NOT reset module state between tests in a file.
 *
 * @internal
 */
export function _resetDeprecationWarnings(): void {
  _deprecatedWarned.clear();
}

/**
 * Emit a one-time deprecation warning for a legacy model-override env var (PRD §9.2.8).
 *
 * @remarks
 * Synchronous `console.warn` (stderr, PRD §9.6-compliant) because the pino logger
 * is configured AFTER `configureEnvironment()` (it needs CLI `--verbose` /
 * `--machine-readable` flags) and cannot carry startup deprecations reliably.
 * Matches the `console.error` precedent for actionable startup messages in index.ts.
 */
function warnLegacyModelVar(tier: ModelTier): void {
  const key = `model:${tier}`;
  if (_deprecatedWarned.has(key)) return;
  _deprecatedWarned.add(key);
  console.warn(
    `[PRP] Deprecation: environment variable ${LEGACY_MODEL_ENV_VARS[tier]} is deprecated; ` +
      `use the canonical ${MODEL_ENV_VARS[tier]} instead (PRD §9.2.8). ` +
      `The legacy alias will be removed in a future major version.`
  );
}

/**
 * Emit a one-time deprecation warning for the legacy `ANTHROPIC_BASE_URL` env var (PRD §9.2.8).
 *
 * @remarks
 * Synchronous `console.warn` (stderr, PRD §9.6-compliant); see
 * {@link warnLegacyModelVar} for the logger-timing rationale.
 */
function warnLegacyBaseUrl(): void {
  const key = 'baseURL';
  if (_deprecatedWarned.has(key)) return;
  _deprecatedWarned.add(key);
  console.warn(
    `[PRP] Deprecation: environment variable ANTHROPIC_BASE_URL is deprecated for the ` +
      `pipeline endpoint; use the canonical ${PRP_API_BASE_URL} instead (PRD §9.2.8). ` +
      `The legacy alias will be removed in a future major version.`
  );
}

/**
 * Resolve the selected LLM provider id from the resolved model string (PRD §9.2.3 / §9.4.3).
 *
 * @returns e.g. 'zai' (default) or 'anthropic' (from an 'anthropic/*' model override).
 *
 * @example
 * ```ts
 * import { getResolvedProvider } from './config/environment.js';
 *
 * console.log(getResolvedProvider()); // 'zai' (when PRP_MODEL_BALANCED unset)
 * ```
 */
export function getResolvedProvider(): string {
  return getModel('balanced').split('/')[0];
}

/**
 * Configure environment variables for API compatibility (PRD §9.2.6 / §9.2.8).
 *
 * @remarks
 * Provider-conditional configuration:
 * - **AUTH_TOKEN alias**: `ANTHROPIC_AUTH_TOKEN` is mapped to `ANTHROPIC_API_KEY` ONLY when
 *   the resolved provider is `anthropic` (backward-compat alias). For the default `zai` path,
 *   AUTH_TOKEN is NOT consulted.
 * - **Base URL**: read canonical-first (`PRP_API_BASE_URL`) → legacy `ANTHROPIC_BASE_URL`
 *   (one-time deprecation warning, PRD §9.2.8) → z.ai default ONLY when the provider is `zai`.
 *   The resolved endpoint is always mirrored into `process.env.ANTHROPIC_BASE_URL` — the SDK
 *   contract consumed downstream by endpoint-guard / agent-factory / runtime-api-validator /
 *   validate-api / `validateEnvironment`.
 *
 * This function modifies `process.env` in place as an intentional side effect.
 * Must be called before `configureHarness()` and `ensureHarnessInitialized()`.
 *
 * @example
 * ```ts
 * import { configureEnvironment } from './config/environment.js';
 *
 * // Must be called before creating agents
 * configureEnvironment();
 *
 * // After this call, process.env.ANTHROPIC_BASE_URL is available (for zai)
 * console.log(process.env.ANTHROPIC_BASE_URL); // 'https://api.z.ai/api/anthropic'
 * ```
 */
export function configureEnvironment(): void {
  const provider = getResolvedProvider();

  // ANTHROPIC_AUTH_TOKEN demoted to a backward-compat alias for the anthropic provider ONLY.
  if (
    provider === 'anthropic' &&
    process.env.ANTHROPIC_AUTH_TOKEN &&
    !process.env.ANTHROPIC_API_KEY
  ) {
    process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_AUTH_TOKEN;
  }

  // PRP_API_BASE_URL canonical-first; ANTHROPIC_BASE_URL legacy fallback (PRD §9.2.8).
  // The resolved endpoint is written into process.env.ANTHROPIC_BASE_URL — the SDK contract
  // consumed downstream by endpoint-guard / agent-factory / runtime-api-validator / validate-api.
  const canonicalBaseUrl = process.env[PRP_API_BASE_URL];
  const legacyBaseUrl = process.env.ANTHROPIC_BASE_URL;
  let resolvedBaseUrl: string | undefined;
  if (canonicalBaseUrl) {
    resolvedBaseUrl = canonicalBaseUrl;
  } else if (legacyBaseUrl) {
    warnLegacyBaseUrl();
    resolvedBaseUrl = legacyBaseUrl;
  } else if (provider === 'zai') {
    resolvedBaseUrl = DEFAULT_BASE_URL;
  }
  if (resolvedBaseUrl && process.env.ANTHROPIC_BASE_URL !== resolvedBaseUrl) {
    process.env.ANTHROPIC_BASE_URL = resolvedBaseUrl;
  }
}

/**
 * Get the model name for a given model tier (PRD §9.2.3 / §9.2.8).
 *
 * @remarks
 * Resolves the model for the specified tier **canonical-first with legacy fallback**:
 * 1. canonical env var (`PRP_MODEL_HIGH` / `PRP_MODEL_BALANCED` / `PRP_MODEL_FAST`);
 * 2. legacy env var (`ANTHROPIC_DEFAULT_OPUS_MODEL` / `..._SONNET_MODEL` /
 *    `..._HAIKU_MODEL`) — emits a one-time deprecation warning naming the canonical
 *    replacement (PRD §9.2.8);
 * 3. the baked-in {@link MODEL_NAMES} default.
 *
 * The resolved bare name is provider-qualified via {@link qualifyModel}.
 *
 * Model tier mappings (defaults):
 * - 'high':     glm-5.2 (highest quality, complex reasoning, Architect agent)
 * - 'balanced': glm-5.2 (balanced, default for most agents)
 * - 'fast':     glm-5-turbo (fastest, simple operations, quick tasks)
 *
 * @param tier - The model tier identifier ('high' | 'balanced' | 'fast')
 * @returns The provider-qualified model string (e.g. 'zai/glm-5.2')
 *
 * @example
 * ```ts
 * import { getModel } from './config/environment.js';
 * import type { ModelTier } from './config/types.js';
 *
 * const highModel = getModel('high'); // 'zai/glm-5.2'
 * const balancedModel = getModel('balanced'); // 'zai/glm-5.2'
 * const fastModel = getModel('fast'); // 'zai/glm-5-turbo'
 *
 * // Canonical override (no warning):
 * process.env.PRP_MODEL_FAST = 'glm-5.2';
 * const customFast = getModel('fast'); // 'zai/glm-5.2'
 * ```
 */

/**
 * Qualify a bare model name with its provider (PRD §9.2.3 / §9.4.3).
 *
 * Idempotent: if `name` already contains a provider segment (contains '/'),
 * it is returned unchanged. Otherwise the `provider` prefix is prepended
 * (default: DEFAULT_MODEL_PROVIDER === 'zai'). Never produces a 3-segment
 * (harness-qualified) string.
 *
 * @param name - Bare model name (e.g. 'glm-5.2') OR an already-qualified 'provider/model'.
 * @param provider - Provider prefix; defaults to {@link DEFAULT_MODEL_PROVIDER} ('zai').
 * @returns The provider-qualified model string.
 *
 * @example
 *   qualifyModel('glm-5.2');            // 'zai/glm-5.2'
 *   qualifyModel('glm-5-turbo');        // 'zai/glm-5-turbo'
 *   qualifyModel('anthropic/foo');      // 'anthropic/foo'  (unchanged)
 *   qualifyModel('zai/glm-5.2');        // 'zai/glm-5.2'    (unchanged)
 *   qualifyModel('glm-5.2', 'anthropic'); // 'anthropic/glm-5.2'
 */
export function qualifyModel(
  name: string,
  provider: string = DEFAULT_MODEL_PROVIDER
): string {
  return name.includes('/') ? name : `${provider}/${name}`;
}

export function getModel(tier: ModelTier): string {
  const canonical = process.env[MODEL_ENV_VARS[tier]];
  if (canonical) return qualifyModel(canonical);
  const legacy = process.env[LEGACY_MODEL_ENV_VARS[tier]];
  if (legacy) {
    warnLegacyModelVar(tier);
    return qualifyModel(legacy);
  }
  return qualifyModel(MODEL_NAMES[tier]);
}

/**
 * Validate that all required environment variables are set
 *
 * @remarks
 * Checks that ANTHROPIC_API_KEY and ANTHROPIC_BASE_URL exist after
 * configuration is complete. Throws a descriptive error if any are missing.
 *
 * Should be called after {@link configureEnvironment} to ensure the
 * environment is properly configured for agent creation.
 *
 * @throws {EnvironmentValidationError} When required environment variables are missing.
 * The error message includes all missing variable names for easy debugging.
 *
 * @example
 * ```ts
 * import { configureEnvironment, validateEnvironment } from './config/environment.js';
 *
 * configureEnvironment();
 *
 * // Validate before proceeding with agent creation
 * try {
 *   validateEnvironment();
 *   console.log('Environment is properly configured');
 * } catch (error) {
 *   if (error instanceof EnvironmentValidationError) {
 *     console.error('Missing variables:', error.missing);
 *   }
 * }
 * ```
 */
export function validateEnvironment(): void {
  const missing: string[] = [];

  if (!process.env.ANTHROPIC_API_KEY) {
    missing.push('ANTHROPIC_API_KEY');
  }

  if (!process.env.ANTHROPIC_BASE_URL) {
    missing.push('ANTHROPIC_BASE_URL');
  }

  if (missing.length > 0) {
    throw new EnvironmentValidationError(missing);
  }
}

// Re-export types for convenience
export type { ModelTier, EnvironmentConfig } from './types.js';
export { EnvironmentValidationError } from './types.js';
