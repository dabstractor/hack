/**
 * Retry utility with exponential backoff and transient error detection
 *
 * @module utils/retry
 *
 * @remarks
 * Provides production-ready retry logic for resilient agent LLM calls and
 * MCP tool executions. Handles temporary network failures, rate limits,
 * and service interruptions with exponential backoff and jitter.
 *
 * Features:
 * - Exponential backoff with configurable cap
 * - Full jitter to prevent thundering herd problem
 * - Transient error detection (network, timeout, 5xx, 429)
 * - Integration with error hierarchy from errors.ts
 * - Structured logging via logger.ts
 * - Type-safe generic implementation
 *
 * @example
 * ```typescript
 * import { retry, isTransientError } from './utils/retry.js';
 *
 * // Basic usage
 * const result = await retry(
 *   () => agent.prompt(prompt),
 *   { maxAttempts: 3, baseDelay: 1000 }
 * );
 *
 * // Custom retryable predicate
 * const result = await retry(
 *   () => fetch(url).then(r => r.json()),
 *   {
 *     isRetryable: (error) => isTransientError(error),
 *     onRetry: (attempt, error, delay) => {
 *       console.log(`Retry ${attempt} after ${delay}ms`);
 *     }
 *   }
 * );
 * ```
 */

// ============================================================================
// IMPORTS
// ============================================================================

import { getLogger, type Logger } from './logger.js';
import {
  isValidationError,
  isPipelineError,
  ErrorCodes,
  type PipelineError,
} from './errors.js';

// ============================================================================
// TRANSIENT ERROR CONSTANTS
// ============================================================================

/**
 * Node.js system error codes that indicate transient failures
 *
 * @remarks
 * These errors typically indicate temporary network issues that
 * may resolve on retry. Source: Node.js Error documentation.
 *
 * @see https://nodejs.org/api/errors.html#errors_common_system_errors
 */
const TRANSIENT_ERROR_CODES = new Set([
  'ECONNRESET', // Connection reset by peer
  'ECONNREFUSED', // Connection refused
  'ETIMEDOUT', // Connection timeout
  'ENOTFOUND', // DNS lookup failed
  'EPIPE', // Broken pipe
  'EAI_AGAIN', // DNS temporary failure
  'EHOSTUNREACH', // Host unreachable
  'ENETUNREACH', // Network unreachable
  'ECONNABORTED', // Connection aborted
]);

/**
 * HTTP status codes that are safe to retry
 *
 * @remarks
 * - 408: Request timeout
 * - 429: Rate limit exceeded
 * - 500+: Server errors (may be temporary)
 */
const RETRYABLE_HTTP_STATUS_CODES = new Set([
  408, // Request Timeout
  429, // Too Many Requests
  500, // Internal Server Error
  502, // Bad Gateway
  503, // Service Unavailable
  504, // Gateway Timeout
]);

/**
 * Error message patterns that indicate transient failures
 *
 * @remarks
 * Fallback pattern matching for errors without structured codes.
 */
const TRANSIENT_PATTERNS = [
  'timeout',
  'network error',
  'temporarily unavailable',
  'service unavailable',
  'connection reset',
  'connection refused',
  'rate limit',
  'too many requests',
  'econnreset',
  'etimedout',
] as const;

/**
 * Error message patterns that indicate permanent failures
 *
 * @remarks
 * These errors should never be retried as they indicate
 * application-level issues.
 */
const PERMANENT_PATTERNS = [
  'validation failed',
  'invalid input',
  'unauthorized',
  'forbidden',
  'not found',
  'authentication failed',
  'parse error',
] as const;

// ============================================================================
// RETRY OPTIONS INTERFACE
// ============================================================================

/**
 * Configuration options for retry behavior
 *
 * @remarks
 * All properties are optional with sensible defaults for LLM and
 * MCP tool operations.
 */
export interface RetryOptions {
  /**
   * Maximum number of retry attempts (default: 3)
   *
   * @remarks
   * Total attempts = maxAttempts (1 initial + maxAttempts-1 retries)
   */
  maxAttempts?: number;

  /**
   * Base delay before first retry in milliseconds (default: 1000)
   *
   * @remarks
   * First retry happens after baseDelay, second after baseDelay * 2, etc.
   */
  baseDelay?: number;

  /**
   * Maximum delay cap in milliseconds (default: 30000)
   *
   * @remarks
   * Prevents exponential growth from producing excessive delays.
   * 30 seconds is a reasonable upper bound for most operations.
   */
  maxDelay?: number;

  /**
   * Exponential backoff multiplier (default: 2)
   *
   * @remarks
   * Delay formula: min(baseDelay * backoffFactor ^ attempt, maxDelay)
   */
  backoffFactor?: number;

  /**
   * Jitter factor 0-1 for randomization (default: 0.1)
   *
   * @remarks
   * 0.1 means +/- 10% variance. Prevents thundering herd problem.
   * Formula: delay + (random() - 0.5) * 2 * jitterFactor * delay
   */
  jitterFactor?: number;

  /**
   * Custom predicate to determine if error is retryable
   *
   * @remarks
   * If provided, overrides the default isTransientError check.
   * Use this for application-specific retry logic.
   */
  isRetryable?: (error: unknown) => boolean;

  /**
   * Callback invoked before each retry attempt
   *
   * @remarks
   * Receives attempt number (1-indexed), error, and calculated delay.
   * Useful for custom logging and metrics collection.
   */
  onRetry?: (attempt: number, error: unknown, delay: number) => void;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Async sleep utility
 *
 * @param ms - Milliseconds to sleep
 * @returns Promise that resolves after delay
 *
 * @remarks
 * Non-blocking sleep using Promise + setTimeout.
 * NEVER use blocking sleep loops in async code.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate exponential backoff delay with jitter
 *
 * @param attempt - Current attempt number (0-indexed)
 * @param baseDelay - Base delay in milliseconds
 * @param maxDelay - Maximum delay cap in milliseconds
 * @param backoffFactor - Exponential multiplier
 * @param jitterFactor - Jitter randomization factor (0-1)
 * @returns Delay in milliseconds
 *
 * @remarks
 * Formula: exponentialDelay + jitter
 * Where:
 * - exponentialDelay = min(baseDelay * backoffFactor ^ attempt, maxDelay)
 * - jitter = exponentialDelay * jitterFactor * random()
 *
 * Example with baseDelay=1000, backoffFactor=2, jitterFactor=0.1:
 * - Attempt 0: 1000ms to 1100ms (positive-only jitter)
 * - Attempt 1: 2000ms to 2200ms (positive-only jitter)
 * - Attempt 2: 4000ms to 4400ms (positive-only jitter)
 * - Attempt 3: 8000ms to 8800ms (positive-only jitter)
 * - Attempt 4+: 30000ms (capped) to 33000ms (positive-only jitter)
 */
export function calculateDelay(
  attempt: number,
  baseDelay: number,
  maxDelay: number,
  backoffFactor: number,
  jitterFactor: number
): number {
  // Exponential backoff with cap
  const exponentialDelay = Math.min(
    baseDelay * Math.pow(backoffFactor, attempt),
    maxDelay
  );

  // Positive jitter: always adds variance, never subtracts
  // Math.random() gives range [0, 1), ensuring jitter is always >= 0
  // Multiply by jitterFactor to scale variance
  const jitter = exponentialDelay * jitterFactor * Math.random();

  // Ensure delay is strictly greater than exponentialDelay
  const delay = Math.max(1, Math.floor(exponentialDelay + jitter));

  return delay;
}

// ============================================================================
// TRANSIENT ERROR DETECTION
// ============================================================================

/**
 * Extended error interface for retry detection
 *
 * @remarks
 * Node.js errors and HTTP response errors may have these properties.
 * The `code` property is used for both Node.js system error codes and
 * PipelineError error codes from the custom error hierarchy.
 */
interface RetryableError extends Error {
  /** Node.js system error code or PipelineError code */
  code?: string;

  /** HTTP response with status code */
  response?: {
    status?: number;
  };
}

/**
 * Detects if an error is transient (retryable)
 *
 * @param error - Unknown error to check
 * @returns true if error is retryable, false otherwise
 *
 * @remarks
 * Checks in order:
 * 1. Null/undefined check
 * 2. PipelineError agent timeout/LLM failure codes
 * 3. ValidationError (never retryable)
 * 4. Node.js system error codes (ETIMEDOUT, ECONNRESET, etc.)
 * 5. HTTP status codes (408, 429, 5xx)
 * 6. Error message patterns
 *
 * ValidationError is explicitly non-retryable because retrying
 * with the same input will always produce the same error.
 *
 * @example
 * ```typescript
 * try {
 *   await agent.prompt(prompt);
 * } catch (error) {
 *   if (isTransientError(error)) {
 *     // Retry the operation
 *   } else {
 *     // Throw immediately
 *   }
 * }
 * ```
 */
export function isTransientError(error: unknown): boolean {
  // Null/undefined check
  if (error == null || typeof error !== 'object') {
    return false;
  }

  const err = error as RetryableError;

  // Check PipelineError from P5.M4.T1.S1
  // We need to check the code before type narrowing since AgentError has a fixed code
  if (isPipelineError(err)) {
    const errorCode = err.code;
    // Agent errors are transient if they're timeouts or LLM failures
    // NOTE: AgentError class hardcodes code to PIPELINE_AGENT_LLM_FAILED
    // So we check the error message for parse errors to determine if permanent
    const message = String(err.message ?? '').toLowerCase();
    if (message.includes('parse') || message.includes('parsing')) {
      return false; // Parse errors are not retryable
    }
    return (
      errorCode === ErrorCodes.PIPELINE_AGENT_TIMEOUT ||
      errorCode === ErrorCodes.PIPELINE_AGENT_LLM_FAILED
    );
  }

  // ValidationError is never retryable (permanent failure)
  if (isValidationError(err)) {
    return false;
  }

  // Check Node.js system error code
  if (typeof err.code === 'string' && TRANSIENT_ERROR_CODES.has(err.code)) {
    return true;
  }

  // Check HTTP status code (for axios/fetch errors)
  const status = err.response?.status as number | undefined;
  if (typeof status === 'number' && RETRYABLE_HTTP_STATUS_CODES.has(status)) {
    return true;
  }

  // Check error message patterns for transient indicators
  const message = String(err.message ?? '').toLowerCase();
  return TRANSIENT_PATTERNS.some(pattern => message.includes(pattern));
}

/**
 * Detects if an error is permanent (non-retryable)
 *
 * @param error - Unknown error to check
 * @returns true if error is permanent, false otherwise
 *
 * @remarks
 * Permanent errors indicate application-level issues that
 * retrying will not fix:
 * - ValidationError (invalid input)
 * - HTTP 4xx client errors (except 408, 429)
 * - Parse errors
 * - Authentication failures
 *
 * @example
 * ```typescript
 * try {
 *   await someOperation();
 * } catch (error) {
 *   if (isPermanentError(error)) {
 *     throw error; // Don't retry
 *   }
 * }
 * ```
 */
export function isPermanentError(error: unknown): boolean {
  // Null/undefined check
  if (error == null || typeof error !== 'object') {
    return false;
  }

  const err = error as RetryableError;

  // Check ValidationError from P5.M4.T1.S1
  if (isValidationError(err)) {
    return true;
  }

  // Check PipelineError for permanent AgentError codes
  // NOTE: AgentError class hardcodes code to PIPELINE_AGENT_LLM_FAILED
  // So we check the error message for parse errors to determine if permanent
  if (isPipelineError(err)) {
    const message = String(err.message ?? '').toLowerCase();
    // AgentError with parse error message is permanent (cannot retry parse errors)
    if (message.includes('parse') || message.includes('parsing')) {
      return true;
    }
    const errorCode = err.code;
    // Check for specific permanent error codes (if class is fixed in future)
    return errorCode === ErrorCodes.PIPELINE_AGENT_PARSE_FAILED;
  }

  // Check HTTP client errors (except 408 timeout and 429 rate limit)
  const status = err.response?.status as number | undefined;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    return status !== 408 && status !== 429;
  }

  // Check error message for permanent indicators
  const message = String(err.message ?? '').toLowerCase();
  return PERMANENT_PATTERNS.some(pattern => message.includes(pattern));
}

// ============================================================================
// MAIN RETRY FUNCTION
// ============================================================================

/**
 * Retry an async operation with exponential backoff and jitter
 *
 * @template T - Return type of the function
 * @param fn - Async function to retry
 * @param options - Retry configuration options
 * @returns Promise that resolves to the function result
 * @throws Last error if all retry attempts are exhausted
 *
 * @remarks
 * Retry flow:
 * 1. Execute fn()
 * 2. On success: return result immediately
 * 3. On error: check if retryable via isRetryable or isTransientError
 * 4. If non-retryable or last attempt: throw error immediately
 * 5. Calculate delay with exponential backoff and jitter
 * 6. Call onRetry callback if provided
 * 7. Sleep for delay
 * 8. Loop back to step 1
 *
 * Default configuration:
 * - maxAttempts: 3 (1 initial + 2 retries)
 * - baseDelay: 1000ms (1 second)
 * - maxDelay: 30000ms (30 seconds)
 * - backoffFactor: 2 (exponential)
 * - jitterFactor: 0.1 (10% variance)
 *
 * @example
 * ```typescript
 * // Basic usage with defaults
 * const result = await retry(
 *   () => agent.prompt(prompt)
 * );
 *
 * // Custom configuration
 * const result = await retry(
 *   () => fetch(url).then(r => r.json()),
 *   {
 *     maxAttempts: 5,
 *     baseDelay: 500,
 *     maxDelay: 60000,
 *     onRetry: (attempt, error, delay) => {
 *       console.log(`Retry ${attempt} after ${delay}ms:`, error.message);
 *     }
 *   }
 * );
 *
 * // Custom retryable predicate
 * const result = await retry(
 *   () => database.query(sql),
 *   {
 *     isRetryable: (error) => {
 *       // Only retry connection errors
 *       return error.code === 'ECONNREFUSED';
 *     }
 *   }
 * );
 * ```
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    baseDelay = 1000,
    maxDelay = 30000,
    backoffFactor = 2,
    jitterFactor = 0.1,
    isRetryable = isTransientError,
    onRetry,
  } = options;

  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      // Attempt the operation
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if error is retryable
      if (!isRetryable(error)) {
        // Non-retryable error - throw immediately
        throw error;
      }

      // Check if this was the last attempt
      if (attempt >= maxAttempts - 1) {
        // Last attempt failed - throw the error
        throw error;
      }

      // Calculate delay with exponential backoff and jitter
      const delay = calculateDelay(
        attempt,
        baseDelay,
        maxDelay,
        backoffFactor,
        jitterFactor
      );

      // Call retry callback if provided
      onRetry?.(attempt + 1, error, delay);

      // Wait before retrying
      await sleep(delay);
    }
  }

  // Should never reach here, but TypeScript needs it
  throw lastError;
}

// ============================================================================
// DEFAULT ON RETRY HANDLER WITH LOGGER
// ============================================================================

/** Logger instance for retry operations */
let _logger: Logger | undefined;
const logger = (): Logger => (_logger ??= getLogger('retry'));

/**
 * Creates a default onRetry handler with structured logging
 *
 * @param operationName - Name of the operation being retried
 * @param maxAttempts - Maximum number of attempts (for logging)
 * @returns onRetry callback function
 *
 * @remarks
 * Creates a logging callback that integrates with the existing
 * logger utility from src/utils/logger.ts. Logs at warning level
 * with structured context including attempt, delay, and error info.
 *
 * @example
 * ```typescript
 * await retry(
 *   () => agent.prompt(prompt),
 *   {
 *     onRetry: createDefaultOnRetry('Agent.researcher.prompt')
 *   }
 * );
 * ```
 */
export function createDefaultOnRetry(
  operationName: string,
  maxAttempts: number = 3
): (attempt: number, error: unknown, delay: number) => void {
  return (attempt: number, error: unknown, delay: number) => {
    const errorName =
      error instanceof Error ? error.constructor.name : 'UnknownError';
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorCode = (error as PipelineError).code;

    logger().warn(
      {
        operation: operationName,
        attempt,
        maxAttempts,
        delayMs: delay,
        errorName,
        errorCode,
        errorMessage,
      },
      `Retrying ${operationName} after ${delay}ms (attempt ${attempt})`
    );
  };
}

// ============================================================================
// AGENT PROMPT WRAPPER HELPER
// ============================================================================

/**
 * Retry configuration for agent LLM prompt calls
 *
 * @remarks
 * Agents use longer delays and more attempts due to LLM API
 * variability and potential rate limiting.
 */
const AGENT_RETRY_CONFIG: Required<
  Omit<RetryOptions, 'isRetryable' | 'onRetry'>
> = {
  maxAttempts: 3,
  baseDelay: 1000,
  maxDelay: 30000,
  backoffFactor: 2,
  jitterFactor: 0.1,
};

/**
 * Retry wrapper specifically for agent prompt calls
 *
 * @template T - Return type of the agent prompt
 * @param agentPromptFn - Function that calls agent.prompt()
 * @param context - Agent type and operation for logging
 * @returns Promise that resolves to the agent prompt result
 *
 * @remarks
 * Convenience wrapper for agent LLM calls with pre-configured
 * retry settings suitable for LLM API operations.
 *
 * @example
 * ```typescript
 * import { retryAgentPrompt } from './utils/retry.js';
 *
 * const result = await retryAgentPrompt(
 *   () => researcherAgent.prompt(prompt),
 *   { agentType: 'Researcher', operation: 'generatePRP' }
 * );
 * ```
 */
export async function retryAgentPrompt<T>(
  agentPromptFn: () => Promise<T>,
  context: { agentType: string; operation: string }
): Promise<T> {
  return retry(agentPromptFn, {
    ...AGENT_RETRY_CONFIG,
    onRetry: createDefaultOnRetry(`${context.agentType}.${context.operation}`),
  });
}

// ============================================================================
// MCP TOOL WRAPPER HELPER
// ============================================================================

/**
 * Retry configuration for MCP tool executions
 *
 * @remarks
 * MCP tools are generally faster and more reliable than LLM calls,
 * so they use shorter delays and fewer attempts.
 */
const MCP_RETRY_CONFIG: Required<
  Omit<RetryOptions, 'isRetryable' | 'onRetry'>
> = {
  maxAttempts: 2,
  baseDelay: 500,
  maxDelay: 5000,
  backoffFactor: 2,
  jitterFactor: 0.1,
};

/**
 * Retry wrapper specifically for MCP tool executions
 *
 * @template T - Return type of the tool execution
 * @param toolFn - Function that executes an MCP tool
 * @param context - Tool name and operation for logging
 * @returns Promise that resolves to the tool result
 *
 * @remarks
 * Convenience wrapper for MCP tool calls with custom retryable
 * detection that handles the { success, stdout, stderr } structure.
 *
 * @example
 * ```typescript
 * import { retryMcpTool } from './utils/retry.js';
 *
 * const result = await retryMcpTool(
 *   () => bashMCP.execute_bash({ command, cwd, timeout }),
 *   { toolName: 'BashMCP', operation: 'execute_bash' }
 * );
 * ```
 */
export async function retryMcpTool<T>(
  toolFn: () => Promise<T>,
  context: { toolName: string; operation: string }
): Promise<T> {
  return retry(toolFn, {
    ...MCP_RETRY_CONFIG,
    isRetryable: (error: unknown) => {
      // MCP tool errors may have different structure
      if (error == null || typeof error !== 'object') {
        return false;
      }
      const err = error as Record<string, unknown>;

      // Check for transient error patterns in MCP errors
      const message = String(err.message ?? '').toLowerCase();
      return (
        isTransientError(error) ||
        message.includes('temporarily') ||
        message.includes('timeout')
      );
    },
    onRetry: createDefaultOnRetry(`${context.toolName}.${context.operation}`),
  });
}
