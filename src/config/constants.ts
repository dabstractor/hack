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
 * Default model names for each tier (PRD §9.2.8 — provider-neutral tier keys).
 *
 * @remarks
 * Keys are the vendor-neutral QUALITY tiers (opus→high, sonnet→balanced,
 * haiku→fast). VALUES are the model id strings (unchanged by the rename).
 * Uses const assertion to preserve literal types.
 *
 * - high:     glm-5.2 (highest quality, complex reasoning)
 * - balanced: glm-5.2 (balanced, default for most agents)
 * - fast:     glm-5-turbo (fastest, simple operations / codegen)
 *
 * @example
 * ```ts
 * import { MODEL_NAMES } from './config/constants.js';
 *
 * const highModel = MODEL_NAMES.high; // 'glm-5.2'
 * const fastModel = MODEL_NAMES.fast; // 'glm-5-turbo'
 * ```
 */
export const MODEL_NAMES = {
  /** Highest quality model for complex reasoning tasks */
  high: 'glm-5.2',
  /** Balanced model, default for most agents */
  balanced: 'glm-5.2',
  /** Fast model for simple operations / codegen */
  fast: 'glm-5-turbo',
} as const;

/**
 * Canonical provider-neutral model-override env-var names (PRD §9.2.8).
 *
 * @remarks
 * KEYS are the vendor-neutral tiers (S1). VALUES are the CANONICAL PRP_* names.
 * The loader (environment.ts `getModel`) reads canonical-first and falls back to
 * the deprecated {@link LEGACY_MODEL_ENV_VARS} aliases, emitting a one-time
 * deprecation warning naming the canonical replacement.
 *
 * Uses `as const` to preserve the literal key types ↔ {@link ModelTier}.
 *
 * @example
 * ```ts
 * // In shell (canonical, no deprecation warning):
 * export PRP_MODEL_HIGH="glm-5.2"
 * ```
 */
export const MODEL_ENV_VARS = {
  high: 'PRP_MODEL_HIGH',
  balanced: 'PRP_MODEL_BALANCED',
  fast: 'PRP_MODEL_FAST',
} as const;

/**
 * Deprecated legacy model-override env-var names (PRD §9.2.8 backward-compat).
 *
 * @remarks
 * Read ONLY when the canonical {@link MODEL_ENV_VARS} var is unset; triggers a
 * one-time deprecation warning naming the canonical replacement. Slated for
 * removal in a future major version.
 *
 * Uses `as const` to preserve the literal key types ↔ {@link ModelTier}.
 *
 * @example
 * ```ts
 * // Legacy alias — still readable, but emits a one-time deprecation warning:
 * export ANTHROPIC_DEFAULT_OPUS_MODEL="glm-5.2"  // → use PRP_MODEL_HIGH
 * ```
 */
export const LEGACY_MODEL_ENV_VARS = {
  high: 'ANTHROPIC_DEFAULT_OPUS_MODEL',
  balanced: 'ANTHROPIC_DEFAULT_SONNET_MODEL',
  fast: 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
} as const;

/**
 * Required environment variable names for SDK configuration (PRD §9.2.8).
 *
 * @remarks
 * These variables must be set after configureEnvironment() is called.
 * `ANTHROPIC_API_KEY` is provider-native (§9.2.8 exception — NOT renamed) and is
 * mapped from `ANTHROPIC_AUTH_TOKEN` if needed. `baseURL` points at the canonical
 * pipeline-global endpoint {@link PRP_API_BASE_URL} (legacy alias
 * `ANTHROPIC_BASE_URL`); configureEnvironment() mirrors the resolved value into
 * `process.env.ANTHROPIC_BASE_URL` (the SDK contract).
 */
export const REQUIRED_ENV_VARS = {
  apiKey: 'ANTHROPIC_API_KEY',
  baseURL: 'PRP_API_BASE_URL',
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

/**
 * Environment variable name: explicit API-key override for the resolved provider (PRD §9.2.6).
 *
 * @remarks
 * The VALUE of this variable (read at runtime by resolveApiKeyForProvider) is
 * the highest-precedence credential source. Optional — when unset or empty,
 * the resolver falls through to provider-native env vars and auth.json.
 *
 * @example
 * ```ts
 * import { PRP_API_KEY } from './config/constants.js';
 *
 * console.log(PRP_API_KEY); // 'PRP_API_KEY'
 * console.log(process.env[PRP_API_KEY]); // e.g. 'sk-override-123'
 * ```
 */
export const PRP_API_KEY = 'PRP_API_KEY';

/**
 * Environment variable name: canonical LLM provider endpoint (PRD §9.2.8).
 *
 * @remarks
 * Provider-neutral pipeline-global endpoint. The loader (configureEnvironment)
 * reads this canonical-first, falling back to the deprecated `ANTHROPIC_BASE_URL`
 * alias (one-time deprecation warning), and writes the resolved value into
 * `process.env.ANTHROPIC_BASE_URL` — the SDK contract consumed downstream by
 * endpoint-guard / agent-factory / runtime-api-validator / validate-api.
 *
 * @example
 * ```ts
 * import { PRP_API_BASE_URL } from './config/constants.js';
 *
 * console.log(PRP_API_BASE_URL); // 'PRP_API_BASE_URL'
 * console.log(process.env[PRP_API_BASE_URL]); // e.g. 'https://api.z.ai/api/anthropic'
 * ```
 */
export const PRP_API_BASE_URL = 'PRP_API_BASE_URL';

// ---------------------------------------------------------------------------
// Resilience Tuning (PRD §4.2, §4.5, §9.2.2)
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
 * console.log(process.env[RESEARCH_TIMEOUT]); // e.g. '1800'
 * ```
 */
export const RESEARCH_TIMEOUT = 'RESEARCH_TIMEOUT';

/**
 * Default deadline (1800s = 30min) for background research before synchronous fallback (PRD §4.2).
 *
 * @remarks
 * When the RESEARCH_TIMEOUT env var is unset or invalid, this value is used.
 *
 * @example
 * ```ts
 * import { DEFAULT_RESEARCH_TIMEOUT_SECONDS } from './config/constants.js';
 *
 * console.log(DEFAULT_RESEARCH_TIMEOUT_SECONDS); // 1800
 * ```
 */
export const DEFAULT_RESEARCH_TIMEOUT_SECONDS = 1800;

/**
 * Read & validate the RESEARCH_TIMEOUT env var (PRD §4.2, §9.2.2).
 *
 * @returns The configured deadline in seconds, or DEFAULT_RESEARCH_TIMEOUT_SECONDS
 *          when unset, non-numeric, or non-positive.
 *
 * @remarks
 * Grace period / hard deadline (PRD §4.2): the deadline is a HARD upper bound —
 * `waitForPRP` (research-queue.ts) and `withAgentDeadline` (retry.ts) race the
 * in-flight research against this value and fail fast on a genuinely stuck
 * supervisor. No intermediate "heartbeat" warning is emitted during the window,
 * so legitimately long research is never flagged as stuck (a heartbeat would
 * surface only after a grace period; today there is no heartbeat, so nothing is
 * spammed). On expiry the work is abandoned and re-researched synchronously
 * inline (PRD §4.2 fallback).
 *
 * @example
 * ```ts
 * import { getResearchTimeoutSeconds } from './config/constants.js';
 *
 * const deadline = getResearchTimeoutSeconds(); // 1800 (default)
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

/**
 * Environment variable name: how many items ahead the background research
 * supervisor prefetches as a chain (PRD §4.2, §9.2.2).
 *
 * @remarks
 * The VALUE of this variable (read at runtime via getResearchDepth()) is a
 * positive integer. This constant is the env-var NAME itself.
 *
 * @example
 * ```ts
 * import { RESEARCH_DEPTH } from './config/constants.js';
 *
 * console.log(RESEARCH_DEPTH); // 'RESEARCH_DEPTH'
 * console.log(process.env[RESEARCH_DEPTH]); // e.g. '3'
 * ```
 */
export const RESEARCH_DEPTH = 'RESEARCH_DEPTH';

/**
 * Default prefetch chain depth (PRD §4.2).
 *
 * @remarks
 * When the RESEARCH_DEPTH env var is unset or invalid, this value is used.
 *
 * @example
 * ```ts
 * import { DEFAULT_RESEARCH_DEPTH } from './config/constants.js';
 *
 * console.log(DEFAULT_RESEARCH_DEPTH); // 2
 * ```
 */
export const DEFAULT_RESEARCH_DEPTH = 2;

/**
 * Read & validate the RESEARCH_DEPTH env var (PRD §4.2, §9.2.2).
 *
 * @returns The configured prefetch depth, or DEFAULT_RESEARCH_DEPTH
 *          when unset, non-numeric, or non-positive.
 *
 * @example
 * ```ts
 * import { getResearchDepth } from './config/constants.js';
 *
 * const depth = getResearchDepth(); // 2 (default)
 * ```
 */
export function getResearchDepth(): number {
  const raw = Number(process.env[RESEARCH_DEPTH] ?? DEFAULT_RESEARCH_DEPTH);
  if (Number.isNaN(raw) || raw <= 0) {
    return DEFAULT_RESEARCH_DEPTH;
  }
  return raw;
}

/**
 * Environment variable name: enable background (parallel) PRP research (PRD §4.2, §9.2.2).
 *
 * @remarks
 * The VALUE of this variable (read at runtime via isParallelResearch()) is the
 * case-sensitive literal 'true' to enable; any other value (including unset)
 * means disabled. This matches the SKIP_BUG_FINDING convention. This constant is
 * the env-var NAME itself.
 *
 * @example
 * ```ts
 * import { PARALLEL_RESEARCH } from './config/constants.js';
 *
 * console.log(PARALLEL_RESEARCH); // 'PARALLEL_RESEARCH'
 * console.log(process.env[PARALLEL_RESEARCH]); // e.g. 'true'
 * ```
 */
export const PARALLEL_RESEARCH = 'PARALLEL_RESEARCH';

/**
 * Whether background (parallel) PRP research is enabled (PRD §4.2, §9.2.2).
 *
 * @returns true only when PARALLEL_RESEARCH is the literal 'true'; false otherwise.
 *
 * @example
 * ```ts
 * import { isParallelResearch } from './config/constants.js';
 *
 * const enabled = isParallelResearch(); // false (default)
 * ```
 */
export function isParallelResearch(): boolean {
  return process.env[PARALLEL_RESEARCH] === 'true';
}

/**
 * Environment variable name: max issue-driven re-planning attempts per item (PRD §4.5, §9.2.2).
 *
 * @remarks
 * Bounds the issue-driven re-planning loop (PRD §4.5): after this many issue outcomes
 * (recoverable PRP gaps re-researched with feedback), the item hard-fails. This is a SEPARATE
 * retry dimension from TaskRetryManager (transient infra errors) — see implementation_notes.md §3.
 * The VALUE of this variable is read at runtime via getIssueRetryMax().
 *
 * @example
 * ```ts
 * import { ISSUE_RETRY_MAX } from './config/constants.js';
 *
 * console.log(ISSUE_RETRY_MAX); // 'ISSUE_RETRY_MAX'
 * console.log(process.env[ISSUE_RETRY_MAX]); // e.g. '3'
 * ```
 */
export const ISSUE_RETRY_MAX = 'ISSUE_RETRY_MAX';

/**
 * Default max issue-driven re-planning attempts per item before hard-fail (PRD §4.5).
 *
 * @remarks
 * When the ISSUE_RETRY_MAX env var is unset or invalid, this value is used.
 *
 * @example
 * ```ts
 * import { DEFAULT_ISSUE_RETRY_MAX } from './config/constants.js';
 *
 * console.log(DEFAULT_ISSUE_RETRY_MAX); // 3
 * ```
 */
export const DEFAULT_ISSUE_RETRY_MAX = 3;

/**
 * Read & validate the ISSUE_RETRY_MAX env var (PRD §4.5, §9.2.2).
 *
 * @returns The configured max re-planning attempts, or DEFAULT_ISSUE_RETRY_MAX
 *          when unset, non-numeric, or non-positive.
 *
 * @example
 * ```ts
 * import { getIssueRetryMax } from './config/constants.js';
 *
 * const max = getIssueRetryMax(); // 3 (default)
 * ```
 */
export function getIssueRetryMax(): number {
  const raw = Number(process.env[ISSUE_RETRY_MAX] ?? DEFAULT_ISSUE_RETRY_MAX);
  if (Number.isNaN(raw) || raw <= 0) {
    return DEFAULT_ISSUE_RETRY_MAX;
  }
  return raw;
}

/**
 * Environment variable name: max stagecoach commit-message-generation attempts
 * before falling back (PRD §5.1 "Smart Commit Resilience").
 *
 * @remarks
 * Bounds the bounded-retry-with-backoff loop around the transient-API-sensitive
 * stagecoach LLM commit-message generation boundary
 * ({@link generateCommitMessage} in `src/utils/git-commit.ts`). PRD §5.1 mandates:
 * "commit-generation is retried up to `COMMIT_RETRY_MAX` (default 5) attempts with
 * exponential backoff." This is the TOTAL attempt count (initial + retries), matching
 * `retry()`'s `maxAttempts` semantics — NOT the retry count. The VALUE of this variable
 * is read at runtime via {@link getCommitRetryMax}.
 *
 * @example
 * ```ts
 * import { COMMIT_RETRY_MAX } from './config/constants.js';
 *
 * console.log(COMMIT_RETRY_MAX); // 'COMMIT_RETRY_MAX'
 * console.log(process.env[COMMIT_RETRY_MAX]); // e.g. '5'
 * ```
 */
export const COMMIT_RETRY_MAX = 'COMMIT_RETRY_MAX';

/**
 * Default max stagecoach commit-message-generation attempts before falling back
 * (PRD §5.1).
 *
 * @remarks
 * When the COMMIT_RETRY_MAX env var is unset or invalid, this value is used.
 *
 * @example
 * ```ts
 * import { DEFAULT_COMMIT_RETRY_MAX } from './config/constants.js';
 *
 * console.log(DEFAULT_COMMIT_RETRY_MAX); // 5
 * ```
 */
export const DEFAULT_COMMIT_RETRY_MAX = 5;

/**
 * Read & validate the COMMIT_RETRY_MAX env var (PRD §5.1, §9.2.2).
 *
 * @returns The configured max stagecoach generation attempts, or
 *          {@link DEFAULT_COMMIT_RETRY_MAX} when unset, non-numeric, or non-positive.
 *
 * @example
 * ```ts
 * import { getCommitRetryMax } from './config/constants.js';
 *
 * const max = getCommitRetryMax(); // 5 (default)
 * ```
 */
export function getCommitRetryMax(): number {
  const raw = Number(process.env[COMMIT_RETRY_MAX] ?? DEFAULT_COMMIT_RETRY_MAX);
  if (Number.isNaN(raw) || raw <= 0) {
    return DEFAULT_COMMIT_RETRY_MAX;
  }
  return Math.floor(raw);
}

/**
 * Environment variable name: max LLM change/artifact classifier attempts before
 * failing to the protective/conservative default (PRD §4.3 "The Delta Workflow",
 * h3.5, step 1, "Change Classification").
 *
 * @remarks
 * Bounds the bounded-retry-with-backoff loop around the transient-API-sensitive
 * LLM classifier boundary ({@link classifyChange} / {@link classifyArtifact} in
 * `src/core/change-classifier.ts`). PRD §4.3 mandates: "These classifiers MUST
 * distinguish transient API failures (empty output, connection errors, rate
 * limits, overloaded) from invalid model responses, retrying up to a bounded count
 * (default 4) before giving up. On exhaustion they MUST fail to the
 * protective/conservative default (treat as SUBSTANTIVE / DIRTY) — never silently
 * fall through to 'could not classify' and proceed unprotected." This is the TOTAL
 * attempt count (initial + retries), matching `retry()`'s `maxAttempts` semantics.
 * The VALUE of this variable is read at runtime via {@link getClassifierRetryMax}.
 *
 * @example
 * ```ts
 * import { CLASSIFIER_RETRY_MAX } from './config/constants.js';
 *
 * console.log(CLASSIFIER_RETRY_MAX); // 'CLASSIFIER_RETRY_MAX'
 * console.log(process.env[CLASSIFIER_RETRY_MAX]); // e.g. '4'
 * ```
 */
export const CLASSIFIER_RETRY_MAX = 'CLASSIFIER_RETRY_MAX';

/**
 * Default max LLM change/artifact classifier attempts before failing to the
 * protective/conservative default (PRD §4.3).
 *
 * @remarks
 * When the CLASSIFIER_RETRY_MAX env var is unset or invalid, this value is used.
 *
 * @example
 * ```ts
 * import { DEFAULT_CLASSIFIER_RETRY_MAX } from './config/constants.js';
 *
 * console.log(DEFAULT_CLASSIFIER_RETRY_MAX); // 4
 * ```
 */
export const DEFAULT_CLASSIFIER_RETRY_MAX = 4;

/**
 * Read & validate the CLASSIFIER_RETRY_MAX env var (PRD §4.3, §9.2.2).
 *
 * @returns The configured max classifier attempts, or
 *          {@link DEFAULT_CLASSIFIER_RETRY_MAX} when unset, non-numeric, or
 *          non-positive.
 *
 * @example
 * ```ts
 * import { getClassifierRetryMax } from './config/constants.js';
 *
 * const max = getClassifierRetryMax(); // 4 (default)
 * ```
 */
export function getClassifierRetryMax(): number {
  const raw = Number(
    process.env[CLASSIFIER_RETRY_MAX] ?? DEFAULT_CLASSIFIER_RETRY_MAX
  );
  if (Number.isNaN(raw) || raw <= 0) {
    return DEFAULT_CLASSIFIER_RETRY_MAX;
  }
  return Math.floor(raw);
}

/**
 * Environment variable name: base delay in milliseconds between stagecoach
 * commit-message-generation retries (PRD §5.1 "Smart Commit Resilience").
 *
 * @remarks
 * The exponential-backoff base delay (doubling, per `backoffFactor: 2`) for the
 * retry loop around the stagecoach generation boundary. PRD §5.1 mandates a
 * default of 10s ("`COMMIT_RETRY_DELAY`, default 10s, doubling, capped at 120s").
 * Expressed in MILLISECONDS (10_000) to feed `retry()`'s `baseDelay` option.
 * The VALUE of this variable is read at runtime via {@link getCommitRetryDelayMs}.
 *
 * @example
 * ```ts
 * import { COMMIT_RETRY_DELAY } from './config/constants.js';
 *
 * console.log(COMMIT_RETRY_DELAY); // 'COMMIT_RETRY_DELAY'
 * console.log(process.env[COMMIT_RETRY_DELAY]); // e.g. '10000'
 * ```
 */
export const COMMIT_RETRY_DELAY = 'COMMIT_RETRY_DELAY';

/**
 * Default base retry delay in milliseconds for stagecoach commit-message
 * generation (PRD §5.1: 10s).
 *
 * @remarks
 * When the COMMIT_RETRY_DELAY env var is unset or invalid, this value is used.
 *
 * @example
 * ```ts
 * import { DEFAULT_COMMIT_RETRY_DELAY_MS } from './config/constants.js';
 *
 * console.log(DEFAULT_COMMIT_RETRY_DELAY_MS); // 10000
 * ```
 */
export const DEFAULT_COMMIT_RETRY_DELAY_MS = 10_000;

/**
 * Read & validate the COMMIT_RETRY_DELAY env var (PRD §5.1, §9.2.2).
 *
 * @returns The configured base retry delay in ms, or
 *          {@link DEFAULT_COMMIT_RETRY_DELAY_MS} when unset, non-numeric, or
 *          non-positive.
 *
 * @example
 * ```ts
 * import { getCommitRetryDelayMs } from './config/constants.js';
 *
 * const baseDelay = getCommitRetryDelayMs(); // 10000 (default)
 * ```
 */
export function getCommitRetryDelayMs(): number {
  const raw = Number(
    process.env[COMMIT_RETRY_DELAY] ?? DEFAULT_COMMIT_RETRY_DELAY_MS
  );
  if (Number.isNaN(raw) || raw <= 0) {
    return DEFAULT_COMMIT_RETRY_DELAY_MS;
  }
  return Math.floor(raw);
}

/**
 * Environment variable name: maximum delay cap in milliseconds for stagecoach
 * commit-message-generation backoff (PRD §5.1 "Smart Commit Resilience").
 *
 * @remarks
 * Caps the exponential-backoff growth so a single retry never waits longer
 * than this. PRD §5.1 mandates a cap of 120s ("doubling, capped at 120s").
 * Expressed in MILLISECONDS (120_000) to feed `retry()`'s `maxDelay` option.
 * The VALUE of this variable is read at runtime via {@link getCommitRetryDelayCapMs}.
 *
 * @example
 * ```ts
 * import { COMMIT_RETRY_DELAY_CAP } from './config/constants.js';
 *
 * console.log(COMMIT_RETRY_DELAY_CAP); // 'COMMIT_RETRY_DELAY_CAP'
 * console.log(process.env[COMMIT_RETRY_DELAY_CAP]); // e.g. '120000'
 * ```
 */
export const COMMIT_RETRY_DELAY_CAP = 'COMMIT_RETRY_DELAY_CAP';

/**
 * Default max-delay cap in milliseconds for stagecoach commit-message
 * generation backoff (PRD §5.1: capped 120s).
 *
 * @remarks
 * When the COMMIT_RETRY_DELAY_CAP env var is unset or invalid, this value is used.
 *
 * @example
 * ```ts
 * import { DEFAULT_COMMIT_RETRY_DELAY_CAP_MS } from './config/constants.js';
 *
 * console.log(DEFAULT_COMMIT_RETRY_DELAY_CAP_MS); // 120000
 * ```
 */
export const DEFAULT_COMMIT_RETRY_DELAY_CAP_MS = 120_000;

/**
 * Read & validate the COMMIT_RETRY_DELAY_CAP env var (PRD §5.1, §9.2.2).
 *
 * @returns The configured max-delay cap in ms, or
 *          {@link DEFAULT_COMMIT_RETRY_DELAY_CAP_MS} when unset, non-numeric,
 *          or non-positive.
 *
 * @example
 * ```ts
 * import { getCommitRetryDelayCapMs } from './config/constants.js';
 *
 * const maxDelay = getCommitRetryDelayCapMs(); // 120000 (default)
 * ```
 */
export function getCommitRetryDelayCapMs(): number {
  const raw = Number(
    process.env[COMMIT_RETRY_DELAY_CAP] ?? DEFAULT_COMMIT_RETRY_DELAY_CAP_MS
  );
  if (Number.isNaN(raw) || raw <= 0) {
    return DEFAULT_COMMIT_RETRY_DELAY_CAP_MS;
  }
  return Math.floor(raw);
}

// =============================================================================
// Commit Message Format (PRP_COMMIT_FORMAT) — PRD §5.1
// =============================================================================
// One env-var knob for the stagecoach commit-message subject: whether to layer the
// standardized <phase>.<milestone>.<task>.<subtask>: position prefix. Consumed by
// P1.M3.T1.S2 (formatCommitMessage in src/utils/git-commit.ts), which branches on the
// PrpCommitFormat union. This getter is the SINGLE read site for this var (no other
// code reads process.env[PRP_COMMIT_FORMAT] directly — project convention).

/**
 * Environment variable name: the commit-message format mode (PRD §5.1 "Commit Message Format
 * (Standardized Task-Prefix)").
 *
 * @remarks
 * The VALUE of this variable (read at runtime via {@link getPrpCommitFormat}) is either
 * `'task-prefix'` (DEFAULT — layer the `<phase>.<milestone>.<task>.<subtask>:` prefix) or
 * `'plain'` (opt-out — emit the message verbatim with no position prefix). This constant is
 * the env-var NAME itself; the VALUE is read + normalized by {@link getPrpCommitFormat},
 * the SINGLE read site for this var (no other code reads `process.env[PRP_COMMIT_FORMAT]`
 * directly).
 *
 * @example
 * ```ts
 * import { PRP_COMMIT_FORMAT } from './config/constants.js';
 *
 * console.log(PRP_COMMIT_FORMAT); // 'PRP_COMMIT_FORMAT'
 * console.log(process.env[PRP_COMMIT_FORMAT]); // e.g. 'plain'
 * ```
 */
export const PRP_COMMIT_FORMAT = 'PRP_COMMIT_FORMAT';

/**
 * Default commit-message format mode (PRD §5.1).
 *
 * @remarks
 * `'task-prefix'` — the standardized `<phase>.<milestone>.<task>.<subtask>:` prefix is the
 * default. Uses `as const` to preserve the literal type (matches
 * {@link DEFAULT_VALIDATION_AGENT} and {@link DEFAULT_HARNESS}); it is a member of
 * {@link PrpCommitFormat}.
 *
 * @example
 * ```ts
 * import { DEFAULT_PRP_COMMIT_FORMAT } from './config/constants.js';
 *
 * console.log(DEFAULT_PRP_COMMIT_FORMAT); // 'task-prefix'
 * ```
 */
export const DEFAULT_PRP_COMMIT_FORMAT = 'task-prefix' as const;

/**
 * The two supported commit-message format modes (PRD §5.1).
 *
 * @remarks
 * - `'task-prefix'` — layer the position prefix (`<phase>.<milestone>.<task>.<subtask>:`)
 *   onto the commit subject; the DEFAULT.
 * - `'plain'` — opt-out: emit the descriptive message verbatim with no position prefix.
 *
 * Returned by {@link getPrpCommitFormat}; consumed by `formatCommitMessage`
 * (P1.M3.T1.S2).
 */
export type PrpCommitFormat = 'task-prefix' | 'plain';

/**
 * Read the PRP_COMMIT_FORMAT env var (PRD §5.1).
 *
 * @returns `'plain'` when the (trimmed) value is exactly `'plain'`; otherwise
 *          {@link DEFAULT_PRP_COMMIT_FORMAT} (`'task-prefix'`) — including when unset,
 *          empty, whitespace-only, or any unrecognized value.
 *
 * @remarks
 * The trim + unknown→default guard is the string analog of {@link getValidationAgent}'s
 * empty-string guard: an explicitly-empty value (`PRP_COMMIT_FORMAT=`) or any typo
 * (`'task_prefix'`, `'TASK-PREFIX'`, `'tsk-prefix'`) falls back to the safe default rather
 * than yielding an unrecognized mode. The match is CASE-SENSITIVE — only the exact
 * lowercase `'plain'` opts out (mirrors how `'plain'` is the only opt-out token named in
 * PRD §5.1).
 *
 * @example
 * ```ts
 * import { getPrpCommitFormat } from './config/constants.js';
 *
 * const format = getPrpCommitFormat(); // 'task-prefix' (default)
 * ```
 */
export function getPrpCommitFormat(): PrpCommitFormat {
  const raw = process.env[PRP_COMMIT_FORMAT];
  if (raw === undefined) {
    return DEFAULT_PRP_COMMIT_FORMAT;
  }
  const v = raw.trim();
  return v === 'plain' ? 'plain' : 'task-prefix'; // any unknown/empty value → default task-prefix
}

// =============================================================================
// Validation Control (PRD §4.4, §9.2.2)
// =============================================================================
// Two env-var knobs for the QA & validation stage: which reasoning-tier agent runs
// validation (VALIDATION_AGENT), and the watchdog budget for that call only
// (VALIDATION_TIMEOUT). Both OVERRIDE the generic agent defaults for the validation
// call only. Consumed by P4.M2.T1.S2 (validate.sh generation + abort-on-failure).

/**
 * Environment variable name: the reasoning-tier agent that generates and runs `validate.sh`
 * (PRD §4.4 step 1, §9.2.2 "Validation Control").
 *
 * @remarks
 * The VALUE of this variable (read at runtime via {@link getValidationAgent}) is an agent
 * identifier. Overrides the generic `$AGENT` for the validation call only. This constant is
 * the env-var NAME itself. The DEFAULT ({@link DEFAULT_VALIDATION_AGENT}) is `pizr` — the
 * bash-pipeline reasoning agent (`pi` with `--thinking xhigh` per PRD §9.2.3); in the TS
 * rewrite the reasoning persona (balanced tier @ `xhigh`) realizes it via the `qa` persona
 * (`createQAAgent`, `agent-factory.ts`).
 *
 * @example
 * ```ts
 * import { VALIDATION_AGENT } from './config/constants.js';
 *
 * console.log(VALIDATION_AGENT); // 'VALIDATION_AGENT'
 * console.log(process.env[VALIDATION_AGENT]); // e.g. 'pizr'
 * ```
 */
export const VALIDATION_AGENT = 'VALIDATION_AGENT';

/**
 * Default validation agent identifier (PRD §4.4, §9.2.3).
 *
 * @remarks
 * `pizr` — the reasoning-tier agent. Uses `as const` to preserve the literal type (matches
 * {@link DEFAULT_HARNESS}).
 *
 * @example
 * ```ts
 * import { DEFAULT_VALIDATION_AGENT } from './config/constants.js';
 *
 * console.log(DEFAULT_VALIDATION_AGENT); // 'pizr'
 * ```
 */
export const DEFAULT_VALIDATION_AGENT = 'pizr' as const;

/**
 * Read the VALIDATION_AGENT env var (PRD §4.4, §9.2.2).
 *
 * @returns The configured validation agent identifier, or {@link DEFAULT_VALIDATION_AGENT}
 *          (`'pizr'`) when unset or blank (empty/whitespace-only).
 *
 * @remarks
 * The trim-empty guard is the string analog of the numeric getters' `NaN`/`<=0` guard: an
 * explicitly-empty value (`VALIDATION_AGENT=`) falls back to the default rather than yielding
 * `''`, which would silently break the validation call.
 *
 * @example
 * ```ts
 * import { getValidationAgent } from './config/constants.js';
 *
 * const agent = getValidationAgent(); // 'pizr' (default)
 * ```
 */
export function getValidationAgent(): string {
  const raw = process.env[VALIDATION_AGENT];
  if (raw === undefined) {
    return DEFAULT_VALIDATION_AGENT;
  }
  const trimmed = raw.trim();
  return trimmed === '' ? DEFAULT_VALIDATION_AGENT : trimmed;
}

/**
 * Environment variable name: the watchdog budget in seconds for the validation call
 * (PRD §4.4 step 1, §9.2.2 "Validation Control").
 *
 * @remarks
 * The VALUE of this variable (read at runtime via {@link getValidationTimeoutSeconds}) is a
 * positive number of seconds. Overrides the generic agent timeout for the validation call
 * only — validation legitimately runs full test suites (PRD §4.4). This constant is the
 * env-var NAME itself.
 *
 * @example
 * ```ts
 * import { VALIDATION_TIMEOUT } from './config/constants.js';
 *
 * console.log(VALIDATION_TIMEOUT); // 'VALIDATION_TIMEOUT'
 * console.log(process.env[VALIDATION_TIMEOUT]); // e.g. '7200'
 * ```
 */
export const VALIDATION_TIMEOUT = 'VALIDATION_TIMEOUT';

/**
 * Default watchdog budget (7200s = 2h) for the validation call (PRD §4.4).
 *
 * @remarks
 * When the VALIDATION_TIMEOUT env var is unset or invalid, this value is used. 2h because
 * validation legitimately runs full test suites (PRD §4.4).
 *
 * @example
 * ```ts
 * import { DEFAULT_VALIDATION_TIMEOUT_SECONDS } from './config/constants.js';
 *
 * console.log(DEFAULT_VALIDATION_TIMEOUT_SECONDS); // 7200
 * ```
 */
export const DEFAULT_VALIDATION_TIMEOUT_SECONDS = 7200;

/**
 * Read & validate the VALIDATION_TIMEOUT env var (PRD §4.4, §9.2.2).
 *
 * @returns The configured watchdog budget in seconds, or
 *          {@link DEFAULT_VALIDATION_TIMEOUT_SECONDS} (`7200`) when unset, non-numeric, or
 *          non-positive.
 *
 * @remarks
 * Mirrors {@link getResearchTimeoutSeconds} exactly (same `Number(... ?? default)` + `NaN`/
 * `<=0` → default guard). PRD §4.4: validation runs on its own watchdog; a non-zero exit MUST
 * abort before cleanup/commit/bug-hunt (the abort is wired by P4.M2.T1.S2; this getter only
 * supplies the budget).
 *
 * @example
 * ```ts
 * import { getValidationTimeoutSeconds } from './config/constants.js';
 *
 * const budget = getValidationTimeoutSeconds(); // 7200 (default)
 * ```
 */
export function getValidationTimeoutSeconds(): number {
  const raw = Number(
    process.env[VALIDATION_TIMEOUT] ?? DEFAULT_VALIDATION_TIMEOUT_SECONDS
  );
  if (Number.isNaN(raw) || raw <= 0) {
    return DEFAULT_VALIDATION_TIMEOUT_SECONDS;
  }
  return raw;
}

// =============================================================================
// Bug Hunt Configuration (PRD §4.4, §9.2.2)
// =============================================================================
// The env-var knob for the QA & bug-hunt stage: which reasoning-tier agent runs the
// creative bug discovery (BUG_FINDER_AGENT). OVERRIDES nothing — it NAMES the
// reasoning persona that already runs the bug hunt (balanced tier @ `xhigh`). Consumed
// by createQAAgent() (agent-factory.ts) for observability at agent-creation time.

/**
 * Environment variable name: the reasoning-tier agent used for creative bug discovery
 * (PRD §4.4 step 2, §9.2.2 "Bug Hunt Configuration").
 *
 * @remarks
 * The VALUE of this variable (read at runtime via {@link getBugFinderAgent}) is an agent
 * identifier. This constant is the env-var NAME itself. The DEFAULT
 * ({@link DEFAULT_BUG_FINDER_AGENT}) is `pizr` — the bash-pipeline reasoning agent (`pi`
 * with `--thinking xhigh` per PRD §9.2.3); in the TS rewrite the reasoning persona
 * (balanced tier @ `xhigh`) realizes it via the `qa` persona (`createQAAgent`,
 * `agent-factory.ts`).
 *
 * @example
 * ```ts
 * import { BUG_FINDER_AGENT } from './config/constants.js';
 *
 * console.log(BUG_FINDER_AGENT); // 'BUG_FINDER_AGENT'
 * console.log(process.env[BUG_FINDER_AGENT]); // e.g. 'pizr'
 * ```
 */
export const BUG_FINDER_AGENT = 'BUG_FINDER_AGENT';

/**
 * Default bug-finder agent identifier (PRD §4.4, §9.2.2, §9.2.3).
 *
 * @remarks
 * `pizr` — the reasoning-tier agent. Uses `as const` to preserve the literal type
 * (matches {@link DEFAULT_VALIDATION_AGENT}).
 *
 * @example
 * ```ts
 * import { DEFAULT_BUG_FINDER_AGENT } from './config/constants.js';
 *
 * console.log(DEFAULT_BUG_FINDER_AGENT); // 'pizr'
 * ```
 */
export const DEFAULT_BUG_FINDER_AGENT = 'pizr' as const;

/**
 * Read the BUG_FINDER_AGENT env var (PRD §4.4, §9.2.2).
 *
 * @returns The configured bug-finder agent identifier, or {@link DEFAULT_BUG_FINDER_AGENT}
 *          (`'pizr'`) when unset or blank (empty/whitespace-only).
 *
 * @remarks
 * Mirrors {@link getValidationAgent} exactly (same trim-empty guard). The bug-finder
 * agent is the runtime reasoning persona (`createQAAgent`, balanced tier @ `xhigh` per
 * PRD §9.2.3); this getter surfaces the configured identifier for observability and honors
 * a user override. An explicitly-empty value (`BUG_FINDER_AGENT=`) falls back to the
 * default rather than yielding `''`, which would silently break observability.
 *
 * @example
 * ```ts
 * import { getBugFinderAgent } from './config/constants.js';
 *
 * const agent = getBugFinderAgent(); // 'pizr' (default)
 * ```
 */
export function getBugFinderAgent(): string {
  const raw = process.env[BUG_FINDER_AGENT];
  if (raw === undefined) {
    return DEFAULT_BUG_FINDER_AGENT;
  }
  const trimmed = raw.trim();
  return trimmed === '' ? DEFAULT_BUG_FINDER_AGENT : trimmed;
}

/**
 * Environment variable name: max recursion depth for PRD `@`-include expansion (PRD §2.3).
 *
 * @remarks
 * Bounds the include-expansion recursion (PRD §2.3: "expanded recursively with cycle
 * detection up to `PRD_INCLUDE_MAX_DEPTH`"). The VALUE of this variable is read at runtime
 * via {@link getPrdIncludeMaxDepth}. S1 (this subtask) declares the surface and uses it only
 * as a base-case depth gate; the recursive loop lands in S2.
 *
 * @example
 * ```ts
 * import { PRD_INCLUDE_MAX_DEPTH } from './config/constants.js';
 *
 * console.log(PRD_INCLUDE_MAX_DEPTH); // 'PRD_INCLUDE_MAX_DEPTH'
 * console.log(process.env[PRD_INCLUDE_MAX_DEPTH]); // e.g. '10'
 * ```
 */
export const PRD_INCLUDE_MAX_DEPTH = 'PRD_INCLUDE_MAX_DEPTH';

/**
 * Default max include depth when `PRD_INCLUDE_MAX_DEPTH` is unset/invalid (PRD §2.3).
 *
 * @remarks
 * When the `PRD_INCLUDE_MAX_DEPTH` env var is unset or invalid, this value is used.
 *
 * @example
 * ```ts
 * import { DEFAULT_PRD_INCLUDE_MAX_DEPTH } from './config/constants.js';
 *
 * console.log(DEFAULT_PRD_INCLUDE_MAX_DEPTH); // 10
 * ```
 */
export const DEFAULT_PRD_INCLUDE_MAX_DEPTH = 10;

/**
 * Read & validate the `PRD_INCLUDE_MAX_DEPTH` env var (PRD §2.3).
 *
 * @returns The configured max include depth, or {@link DEFAULT_PRD_INCLUDE_MAX_DEPTH}
 *          when unset, non-numeric, or non-positive.
 *
 * @example
 * ```ts
 * import { getPrdIncludeMaxDepth } from './config/constants.js';
 *
 * const depth = getPrdIncludeMaxDepth(); // 10 (default)
 * ```
 */
export function getPrdIncludeMaxDepth(): number {
  const raw = Number(
    process.env[PRD_INCLUDE_MAX_DEPTH] ?? DEFAULT_PRD_INCLUDE_MAX_DEPTH
  );
  if (Number.isNaN(raw) || raw <= 0) {
    return DEFAULT_PRD_INCLUDE_MAX_DEPTH;
  }
  return raw;
}

/**
 * Environment variable name: emit `<!-- @include -->` markers around expanded includes
 * (PRD §2.3; consumed in S3).
 *
 * @remarks
 * When set, resolved include output emits `<!-- @include: path -->` / `<!-- @end-include -->`
 * comment markers, and a `.md` token that fails to resolve (stale include) emits a stderr
 * warning. This is declared here so S3 only adds behavior, not new plumbing; it is NOT
 * consumed by S1's `resolveIncludes`.
 *
 * @example
 * ```ts
 * import { PRD_INCLUDE_MARKERS } from './config/constants.js';
 *
 * console.log(PRD_INCLUDE_MARKERS); // 'PRD_INCLUDE_MARKERS'
 * console.log(process.env[PRD_INCLUDE_MARKERS]); // e.g. '1'
 * ```
 */
export const PRD_INCLUDE_MARKERS = 'PRD_INCLUDE_MARKERS';

/**
 * Read & validate the `PRD_INCLUDE_MARKERS` env var (PRD §2.3; S3).
 *
 * @remarks
 * Truthy unless unset/empty or one of the common "off" spellings (`'0'`, `'false'`, `'no'`,
 * `'off'`, case-insensitive, surrounding whitespace trimmed). Value is compared case-insensitively
 * AFTER `trim().toLowerCase()`; any other non-empty value → `true`. This is the first boolean
 * env getter in this module.
 *
 * @returns `true` iff markers should be emitted around expanded includes.
 *
 * @example
 * ```ts
 * import { getPrdIncludeMarkers } from './config/constants.js';
 *
 * console.log(getPrdIncludeMarkers()); // false (unset)
 * // PRD_INCLUDE_MARKERS=1 → true; PRD_INCLUDE_MARKERS=off → false
 * ```
 */
export function getPrdIncludeMarkers(): boolean {
  const raw = process.env[PRD_INCLUDE_MARKERS];
  if (raw === undefined) {
    return false;
  }
  const v = raw.trim().toLowerCase();
  return v !== '' && v !== '0' && v !== 'false' && v !== 'no' && v !== 'off';
}

// =============================================================================
// tasks.json lockfile tunables (PRD §5.1 — read-modify-write mutual exclusion)
// =============================================================================
// These three env-var-backed tunables configure the O_EXCL lockfile used by
// src/core/file-lock.ts to serialize every read-modify-write of tasks.json.
// See PRD §5.1 "tasks.json Write Concurrency (lost-update prevention)".

/**
 * Environment variable name: age (ms) at which an unreleased tasks.json.lock
 * is considered stale and forcibly removed (PRD §5.1).
 *
 * @remarks
 * The VALUE of this variable (read at runtime via {@link getTasksLockStaleMs})
 * is a number of milliseconds. This constant is the env-var NAME itself. Used
 * as the age-based fallback in the dual (PID + mtime) stale-detection scheme.
 *
 * @example
 * ```ts
 * import { TASKS_LOCK_STALE_MS } from './config/constants.js';
 *
 * console.log(TASKS_LOCK_STALE_MS); // 'TASKS_LOCK_STALE_MS'
 * console.log(process.env[TASKS_LOCK_STALE_MS]); // e.g. '30000'
 * ```
 */
export const TASKS_LOCK_STALE_MS = 'TASKS_LOCK_STALE_MS';

/**
 * Default stale age (30000ms = 30s) for an unreleased tasks.json.lock (PRD §5.1).
 *
 * @remarks
 * When the TASKS_LOCK_STALE_MS env var is unset or invalid, this value is used.
 * Must exceed the longest possible read-modify-write critical section.
 *
 * @example
 * ```ts
 * import { DEFAULT_TASKS_LOCK_STALE_MS } from './config/constants.js';
 *
 * console.log(DEFAULT_TASKS_LOCK_STALE_MS); // 30000
 * ```
 */
export const DEFAULT_TASKS_LOCK_STALE_MS = 30_000;

/**
 * Read & validate the TASKS_LOCK_STALE_MS env var (PRD §5.1).
 *
 * @returns The configured stale age in ms, or {@link DEFAULT_TASKS_LOCK_STALE_MS}
 *          when unset, non-finite, or non-positive.
 *
 * @example
 * ```ts
 * import { getTasksLockStaleMs } from './config/constants.js';
 *
 * const staleMs = getTasksLockStaleMs(); // 30000 (default)
 * ```
 */
export function getTasksLockStaleMs(): number {
  const raw = Number(
    process.env[TASKS_LOCK_STALE_MS] ?? DEFAULT_TASKS_LOCK_STALE_MS
  );
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TASKS_LOCK_STALE_MS;
}

/**
 * Environment variable name: deadline (ms) to acquire tasks.json.lock before
 * giving up with a {@link TasksLockAcquisitionError} (PRD §5.1).
 *
 * @remarks
 * The VALUE of this variable (read at runtime via {@link getTasksLockTimeoutMs})
 * is a number of milliseconds. This constant is the env-var NAME itself.
 *
 * @example
 * ```ts
 * import { TASKS_LOCK_TIMEOUT_MS } from './config/constants.js';
 *
 * console.log(TASKS_LOCK_TIMEOUT_MS); // 'TASKS_LOCK_TIMEOUT_MS'
 * console.log(process.env[TASKS_LOCK_TIMEOUT_MS]); // e.g. '30000'
 * ```
 */
export const TASKS_LOCK_TIMEOUT_MS = 'TASKS_LOCK_TIMEOUT_MS';

/**
 * Default acquisition deadline (30000ms = 30s) for tasks.json.lock (PRD §5.1).
 *
 * @remarks
 * When the TASKS_LOCK_TIMEOUT_MS env var is unset or invalid, this value is used.
 *
 * @example
 * ```ts
 * import { DEFAULT_TASKS_LOCK_TIMEOUT_MS } from './config/constants.js';
 *
 * console.log(DEFAULT_TASKS_LOCK_TIMEOUT_MS); // 30000
 * ```
 */
export const DEFAULT_TASKS_LOCK_TIMEOUT_MS = 30_000;

/**
 * Read & validate the TASKS_LOCK_TIMEOUT_MS env var (PRD §5.1).
 *
 * @returns The configured acquisition deadline in ms, or
 *          {@link DEFAULT_TASKS_LOCK_TIMEOUT_MS} when unset, non-finite, or
 *          non-positive.
 *
 * @example
 * ```ts
 * import { getTasksLockTimeoutMs } from './config/constants.js';
 *
 * const timeoutMs = getTasksLockTimeoutMs(); // 30000 (default)
 * ```
 */
export function getTasksLockTimeoutMs(): number {
  const raw = Number(
    process.env[TASKS_LOCK_TIMEOUT_MS] ?? DEFAULT_TASKS_LOCK_TIMEOUT_MS
  );
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TASKS_LOCK_TIMEOUT_MS;
}

/**
 * Environment variable name: retry interval (ms) between lock-acquisition
 * attempts when tasks.json.lock is held by another process (PRD §5.1).
 *
 * @remarks
 * The VALUE of this variable (read at runtime via {@link getTasksLockPollMs})
 * is a number of milliseconds. This constant is the env-var NAME itself.
 *
 * @example
 * ```ts
 * import { TASKS_LOCK_POLL_MS } from './config/constants.js';
 *
 * console.log(TASKS_LOCK_POLL_MS); // 'TASKS_LOCK_POLL_MS'
 * console.log(process.env[TASKS_LOCK_POLL_MS]); // e.g. '50'
 * ```
 */
export const TASKS_LOCK_POLL_MS = 'TASKS_LOCK_POLL_MS';

/**
 * Default retry interval (50ms) between lock-acquisition attempts (PRD §5.1).
 *
 * @remarks
 * When the TASKS_LOCK_POLL_MS env var is unset or invalid, this value is used.
 *
 * @example
 * ```ts
 * import { DEFAULT_TASKS_LOCK_POLL_MS } from './config/constants.js';
 *
 * console.log(DEFAULT_TASKS_LOCK_POLL_MS); // 50
 * ```
 */
export const DEFAULT_TASKS_LOCK_POLL_MS = 50;

/**
 * Read & validate the TASKS_LOCK_POLL_MS env var (PRD §5.1).
 *
 * @returns The configured retry interval in ms, or {@link DEFAULT_TASKS_LOCK_POLL_MS}
 *          when unset, non-finite, or non-positive.
 *
 * @example
 * ```ts
 * import { getTasksLockPollMs } from './config/constants.js';
 *
 * const pollMs = getTasksLockPollMs(); // 50 (default)
 * ```
 */
export function getTasksLockPollMs(): number {
  const raw = Number(
    process.env[TASKS_LOCK_POLL_MS] ?? DEFAULT_TASKS_LOCK_POLL_MS
  );
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TASKS_LOCK_POLL_MS;
}
