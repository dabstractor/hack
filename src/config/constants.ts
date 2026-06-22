/**
 * Constants for environment configuration
 *
 * @module config/constants
 */

/**
 * Default base URL for the z.ai API endpoint
 *
 * @remarks
 * This is the custom proxy endpoint for z.ai, not the official Anthropic API.
 * Anthropic: https://api.anthropic.com
 * z.ai:      https://api.z.ai/api/anthropic
 *
 * @example
 * ```ts
 * import { DEFAULT_BASE_URL } from './config/constants.js';
 *
 * console.log(DEFAULT_BASE_URL); // 'https://api.z.ai/api/anthropic'
 * ```
 */
export const DEFAULT_BASE_URL = 'https://api.z.ai/api/anthropic' as const;

/**
 * Default model names for each tier
 *
 * @remarks
 * Maps each model tier to its corresponding GLM model name.
 * Uses const assertion to preserve literal types.
 *
 * - opus: GLM-4.7 (highest quality, complex reasoning)
 * - sonnet: GLM-4.7 (balanced, default for most agents)
 * - haiku: GLM-4.5-Air (fastest, simple operations)
 *
 * @example
 * ```ts
 * import { MODEL_NAMES } from './config/constants.js';
 *
 * const opusModel = MODEL_NAMES.opus; // 'GLM-4.7'
 * const haikuModel = MODEL_NAMES.haiku; // 'GLM-4.5-Air'
 * ```
 */
export const MODEL_NAMES = {
  /** Highest quality model for complex reasoning tasks */
  opus: 'GLM-4.7',
  /** Balanced model, default for most agents */
  sonnet: 'GLM-4.7',
  /** Fast model for simple operations */
  haiku: 'GLM-4.5-Air',
} as const;

/**
 * Environment variable names used for model overrides
 *
 * @remarks
 * These environment variables can be set to override the default model names.
 * If not set, the values from MODEL_NAMES will be used.
 *
 * @example
 * ```ts
 * // In shell:
 * export ANTHROPIC_DEFAULT_OPUS_MODEL="GLM-4.7"
 * ```
 */
export const MODEL_ENV_VARS = {
  opus: 'ANTHROPIC_DEFAULT_OPUS_MODEL',
  sonnet: 'ANTHROPIC_DEFAULT_SONNET_MODEL',
  haiku: 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
} as const;

/**
 * Required environment variable names for SDK configuration
 *
 * @remarks
 * These variables must be set after configureEnvironment() is called.
 * ANTHROPIC_API_KEY is mapped from ANTHROPIC_AUTH_TOKEN if needed.
 */
export const REQUIRED_ENV_VARS = {
  apiKey: 'ANTHROPIC_API_KEY',
  baseURL: 'ANTHROPIC_BASE_URL',
} as const;

/**
 * Environment variable name selecting the agent runtime harness (PRD §9.2.2).
 *
 * @remarks
 * The VALUE of this variable (read at runtime by S2) must be 'pi' or 'claude-code'.
 * This constant is the env-var NAME itself.
 *
 * @example
 * ```ts
 * import { PRP_AGENT_HARNESS } from './config/constants.js';
 *
 * console.log(PRP_AGENT_HARNESS); // 'PRP_AGENT_HARNESS'
 * console.log(process.env[PRP_AGENT_HARNESS]); // e.g. 'pi'
 * ```
 */
export const PRP_AGENT_HARNESS = 'PRP_AGENT_HARNESS';

/**
 * Default agent harness when PRP_AGENT_HARNESS is unset (PRD §9.4.1).
 *
 * @remarks
 * Vendor-neutral pi runtime. Uses `as const` to preserve the literal type.
 *
 * @example
 * ```ts
 * import { DEFAULT_HARNESS } from './config/constants.js';
 *
 * console.log(DEFAULT_HARNESS); // 'pi'
 * ```
 */
export const DEFAULT_HARNESS = 'pi' as const;

/**
 * Default LLM provider — z.ai (PRD §9.4.2).
 *
 * @remarks
 * Orthogonal to the harness. Uses `as const` to preserve the literal type.
 *
 * @example
 * ```ts
 * import { DEFAULT_MODEL_PROVIDER } from './config/constants.js';
 *
 * console.log(DEFAULT_MODEL_PROVIDER); // 'zai'
 * ```
 */
export const DEFAULT_MODEL_PROVIDER = 'zai' as const;

/**
 * All supported agent harness identifiers (PRD §9.4.1).
 *
 * @remarks
 * Readonly literal tuple — exhaustive list of valid harness values.
 * `typeof SUPPORTED_HARNESSES[number]` resolves to `'pi' | 'claude-code'`.
 *
 * @example
 * ```ts
 * import { SUPPORTED_HARNESSES } from './config/constants.js';
 *
 * console.log(SUPPORTED_HARNESSES); // ['pi', 'claude-code']
 * ```
 */
export const SUPPORTED_HARNESSES = ['pi', 'claude-code'] as const;

// ---------------------------------------------------------------------------
// Resilience Tuning (PRD §4.2, §9.2.2)
// ---------------------------------------------------------------------------

/**
 * Environment variable name: deadline (seconds) for background research (PRD §4.2, §9.2.2).
 *
 * @remarks
 * The VALUE of this variable (read at runtime via getResearchTimeoutSeconds())
 * is a number of seconds. This constant is the env-var NAME itself.
 *
 * @example
 * ```ts
 * import { RESEARCH_TIMEOUT } from './config/constants.js';
 *
 * console.log(RESEARCH_TIMEOUT); // 'RESEARCH_TIMEOUT'
 * console.log(process.env[RESEARCH_TIMEOUT]); // e.g. '300'
 * ```
 */
export const RESEARCH_TIMEOUT = 'RESEARCH_TIMEOUT';

/**
 * Default deadline (300s = 5min) for background research before synchronous fallback (PRD §4.2).
 *
 * @remarks
 * When the RESEARCH_TIMEOUT env var is unset or invalid, this value is used.
 *
 * @example
 * ```ts
 * import { DEFAULT_RESEARCH_TIMEOUT_SECONDS } from './config/constants.js';
 *
 * console.log(DEFAULT_RESEARCH_TIMEOUT_SECONDS); // 300
 * ```
 */
export const DEFAULT_RESEARCH_TIMEOUT_SECONDS = 300;

/**
 * Read & validate the RESEARCH_TIMEOUT env var (PRD §4.2, §9.2.2).
 *
 * @returns The configured deadline in seconds, or DEFAULT_RESEARCH_TIMEOUT_SECONDS
 *          when unset, non-numeric, or non-positive.
 *
 * @example
 * ```ts
 * import { getResearchTimeoutSeconds } from './config/constants.js';
 *
 * const deadline = getResearchTimeoutSeconds(); // 300 (default)
 * ```
 */
export function getResearchTimeoutSeconds(): number {
  const raw = Number(
    process.env[RESEARCH_TIMEOUT] ?? DEFAULT_RESEARCH_TIMEOUT_SECONDS
  );
  if (Number.isNaN(raw) || raw <= 0) {
    return DEFAULT_RESEARCH_TIMEOUT_SECONDS;
  }
  return raw;
}
