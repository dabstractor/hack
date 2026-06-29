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
 * const model = getModel('sonnet'); // 'zai/glm-5.2'
 * ```
 */

import {
  DEFAULT_BASE_URL,
  DEFAULT_MODEL_PROVIDER,
  MODEL_NAMES,
  MODEL_ENV_VARS,
} from './constants.js';
import type { ModelTier } from './types.js';
import { EnvironmentValidationError } from './types.js';

/**
 * Resolve the selected LLM provider id from the resolved model string (PRD §9.2.3 / §9.4.3).
 *
 * @returns e.g. 'zai' (default) or 'anthropic' (from an 'anthropic/*' model override).
 *
 * @example
 * ```ts
 * import { getResolvedProvider } from './config/environment.js';
 *
 * console.log(getResolvedProvider()); // 'zai' (when ANTHROPIC_DEFAULT_SONNET_MODEL unset)
 * ```
 */
export function getResolvedProvider(): string {
  return getModel('sonnet').split('/')[0];
}

/**
 * Configure environment variables for API compatibility (PRD §9.2.6).
 *
 * @remarks
 * Provider-conditional configuration:
 * - **AUTH_TOKEN alias**: `ANTHROPIC_AUTH_TOKEN` is mapped to `ANTHROPIC_API_KEY` ONLY when
 *   the resolved provider is `anthropic` (backward-compat alias). For the default `zai` path,
 *   AUTH_TOKEN is NOT consulted.
 * - **Base URL**: `ANTHROPIC_BASE_URL` defaults to the z.ai endpoint ONLY when the provider
 *   is `zai`. For `anthropic`, the user/SDK default is left intact.
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

  // Provider-aware base URL: z.ai default ONLY for zai.
  if (!process.env.ANTHROPIC_BASE_URL && provider === 'zai') {
    process.env.ANTHROPIC_BASE_URL = DEFAULT_BASE_URL;
  }
}

/**
 * Get the model name for a given model tier
 *
 * @remarks
 * Returns the model name for the specified tier, checking environment variables
 * for overrides first, then falling back to default values.
 *
 * Model tier mappings:
 * - 'opus': glm-5.2 (highest quality, complex reasoning, Architect agent)
 * - 'sonnet': glm-5.2 (balanced, default for most agents)
 * - 'haiku': glm-5-turbo (fastest, simple operations, quick tasks)
 *
 * @param tier - The model tier identifier ('opus' | 'sonnet' | 'haiku')
 * @returns The provider-qualified model string (e.g. 'zai/glm-5.2')
 *
 * @example
 * ```ts
 * import { getModel } from './config/environment.js';
 * import type { ModelTier } from './config/types.js';
 *
 * const opusModel = getModel('opus'); // 'zai/glm-5.2'
 * const sonnetModel = getModel('sonnet'); // 'zai/glm-5.2'
 * const haikuModel = getModel('haiku'); // 'zai/glm-5-turbo'
 *
 * // Can be overridden with environment variables
 * process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL = 'glm-5.2';
 * const customHaiku = getModel('haiku'); // 'zai/glm-5.2'
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
  const envVar = MODEL_ENV_VARS[tier];
  return qualifyModel(process.env[envVar] ?? MODEL_NAMES[tier]);
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
