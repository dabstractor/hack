/**
 * Error hierarchy for pipeline operations
 *
 * @module utils/errors
 *
 * @remarks
 * Provides a robust error hierarchy with base class, specialized error types,
 * error codes, context objects, and structured logging support via toJSON().
 *
 * Features:
 * - Error codes for programmatic handling (retry logic, monitoring)
 * - Rich context objects for debugging
 * - toJSON() serialization for pino structured logging
 * - Proper prototype chain setup for instanceof checks
 * - Sensitive data sanitization matching logger.ts REDACT_PATHS
 * - Type guard functions for type narrowing
 *
 * @example
 * ```typescript
 * import { SessionError, TaskError, isSessionError } from './utils/errors.js';
 *
 * // Throw error with context
 * throw new SessionError(
 *   'Failed to load session',
 *   { sessionPath: '/path/to/session', taskId: 'P1.M1.T1' }
 * );
 *
 * // Type narrowing in catch block
 * try {
 *   await someOperation();
 * } catch (error) {
 *   if (isSessionError(error)) {
 *     // error is narrowed to SessionError
 *     console.log(error.code); // 'PIPELINE_SESSION_LOAD_FAILED'
 *   }
 * }
 *
 * // Structured logging with pino
 * logger.error(error.toJSON(), 'Operation failed');
 * ```
 */

// ============================================================================
// ERROR CODES
// ============================================================================

/**
 * Error codes for pipeline operations
 *
 * @remarks
 * Format: PIPELINE_{DOMAIN}_{ACTION}_{OUTCOME}
 * - Domain: SESSION, TASK, AGENT, VALIDATION
 * - Action: LOAD, SAVE, EXECUTION, LLM, TIMEOUT
 * - Outcome: FAILED, NOT_FOUND, INVALID
 *
 * Using const assertion for type-safe error codes.
 */
export const ErrorCodes = {
  // Session errors
  PIPELINE_SESSION_LOAD_FAILED: 'PIPELINE_SESSION_LOAD_FAILED',
  PIPELINE_SESSION_SAVE_FAILED: 'PIPELINE_SESSION_SAVE_FAILED',
  PIPELINE_SESSION_NOT_FOUND: 'PIPELINE_SESSION_NOT_FOUND',
  PIPELINE_SESSION_INVALID_BUGFIX_PATH: 'PIPELINE_SESSION_INVALID_BUGFIX_PATH',

  // Task errors
  PIPELINE_TASK_EXECUTION_FAILED: 'PIPELINE_TASK_EXECUTION_FAILED',
  PIPELINE_TASK_VALIDATION_FAILED: 'PIPELINE_TASK_VALIDATION_FAILED',
  PIPELINE_TASK_NOT_FOUND: 'PIPELINE_TASK_NOT_FOUND',

  // Agent errors
  PIPELINE_AGENT_LLM_FAILED: 'PIPELINE_AGENT_LLM_FAILED',
  PIPELINE_AGENT_TIMEOUT: 'PIPELINE_AGENT_TIMEOUT',
  PIPELINE_AGENT_PARSE_FAILED: 'PIPELINE_AGENT_PARSE_FAILED',

  // Validation errors
  PIPELINE_VALIDATION_INVALID_INPUT: 'PIPELINE_VALIDATION_INVALID_INPUT',
  PIPELINE_VALIDATION_MISSING_FIELD: 'PIPELINE_VALIDATION_MISSING_FIELD',
  PIPELINE_VALIDATION_SCHEMA_FAILED: 'PIPELINE_VALIDATION_SCHEMA_FAILED',
  PIPELINE_VALIDATION_CIRCULAR_DEPENDENCY:
    'PIPELINE_VALIDATION_CIRCULAR_DEPENDENCY',
  PIPELINE_VALIDATION_NESTED_EXECUTION: 'PIPELINE_VALIDATION_NESTED_EXECUTION',

  // Resource errors
  PIPELINE_RESOURCE_LIMIT_EXCEEDED: 'PIPELINE_RESOURCE_LIMIT_EXCEEDED',
} as const;

/**
 * Type for error code values
 */
export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

// ============================================================================
// ERROR CONTEXT INTERFACE
// ============================================================================

/**
 * Error context interface for type-safe debugging information
 *
 * @remarks
 * Extends Record<string, unknown> to allow any properties while
 * documenting common fields used across the codebase.
 */
export interface PipelineErrorContext extends Record<string, unknown> {
  /** Path to session directory */
  sessionPath?: string;
  /** Task or subtask ID */
  taskId?: string;
  /** Operation being performed */
  operation?: string;
  /** Underlying cause description */
  cause?: string;
  /** Additional properties */
  [key: string]: unknown;
}

// ============================================================================
// PIPELINE ERROR BASE CLASS
// ============================================================================

/**
 * Base error class for all pipeline operations
 *
 * @remarks
 * Abstract class that defines the common structure for all pipeline errors.
 * Each specialized error class extends this base and provides a specific
 * error code.
 *
 * Features:
 * - Abstract code property enforced on subclasses
 * - Optional context object for debugging
 * - Timestamp for error tracking
 * - toJSON() for structured logging
 * - Sensitive data sanitization
 * - Circular reference handling
 *
 * @example
 * ```typescript
 * // Cannot instantiate directly (abstract class)
 * // new PipelineError('message'); // ERROR
 *
 * // Use specialized subclasses
 * throw new SessionError('Failed to load session', { sessionPath: '/path' });
 * ```
 */
export abstract class PipelineError extends Error {
  /**
   * Unique error code for programmatic handling
   *
   * @remarks
   * Abstract property - each subclass must define its own code.
   * Used for retry logic, monitoring, and type narrowing.
   */
  abstract readonly code: ErrorCode;

  /**
   * Additional context for debugging
   *
   * @remarks
   * Optional object containing operation-specific debugging information.
   * Sanitized in toJSON() to remove sensitive data.
   */
  readonly context?: PipelineErrorContext;

  /**
   * Timestamp when error was created
   *
   * @remarks
   * ISO 8601 timestamp for error tracking and monitoring.
   */
  readonly timestamp: Date;

  /**
   * Creates a new PipelineError
   *
   * @param message - Human-readable error message
   * @param context - Optional context object with debugging information
   * @param cause - Optional underlying error that caused this error
   *
   * @remarks
   * - Sets prototype explicitly for instanceof checks
   * - Captures stack trace via Error.captureStackTrace (V8/Node.js only)
   * - Stores cause on error instance for error chaining
   */
  constructor(message: string, context?: PipelineErrorContext, cause?: Error) {
    super(message);

    // CRITICAL: Set prototype for instanceof to work correctly
    // ES5 target requires this, but it's best practice even for ES2022
    Object.setPrototypeOf(this, new.target.prototype);

    // CRITICAL: Capture stack trace (V8/Node.js only)
    // Check for existence before calling for cross-platform compatibility
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }

    this.name = this.constructor.name;
    this.context = context;
    this.timestamp = new Date();

    // CRITICAL: Attach context properties directly to error instance for easy access
    // This allows tests to access properties like error.variable, error.taskId, etc.
    if (context) {
      Object.assign(this, context);
    }

    // Store cause if provided (ES2022+)
    // Using type assertion because cause property is not on Error type in all TypeScript versions
    if (cause) {
      (this as unknown as { cause?: Error }).cause = cause;
    }
  }

  /**
   * Serialize error for structured logging
   *
   * @remarks
   * Returns a plain object compatible with JSON.stringify and pino logger.
   * Handles circular references and sanitizes sensitive data.
   *
   * Output includes:
   * - name: Error class name
   * - code: Error code for programmatic handling
   * - message: Human-readable error message
   * - timestamp: ISO 8601 timestamp
   * - context: Sanitized context object (if provided)
   * - stack: Stack trace (if available)
   *
   * @example
   * ```typescript
   * import { getLogger } from './logger.js';
   * const logger = getLogger('MyComponent');
   *
   * try {
   *   await someOperation();
   * } catch (error) {
   *   if (error instanceof PipelineError) {
   *     logger.error(error.toJSON(), 'Operation failed');
   *   }
   * }
   * ```
   */
  toJSON(): Record<string, unknown> {
    const serialized: Record<string, unknown> = {
      name: this.name,
      code: this.code,
      message: this.message,
      timestamp: this.timestamp.toISOString(),
    };

    // Add context if present (with sanitization)
    if (this.context) {
      serialized.context = this.sanitizeContext(this.context);
    }

    // Add stack trace (inherited from Error.prototype)
    if (this.stack) {
      serialized.stack = this.stack;
    }

    return serialized;
  }

  /**
   * Sanitize context object for logging
   *
   * @remarks
   * Removes sensitive data matching logger.ts REDACT_PATHS patterns.
   * Handles circular references and non-serializable objects.
   *
   * Sensitive keys (case-insensitive):
   * - apiKey, apiSecret, api_key, api_secret
   * - token, accessToken, refreshToken, authToken
   * - password, secret, privateKey
   * - authorization, Authorization
   *
   * @param context - Context object to sanitize
   * @returns Sanitized context object
   * @private
   */
  private sanitizeContext(
    context: PipelineErrorContext
  ): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {};

    // Sensitive key patterns (lowercase for case-insensitive matching)
    const sensitiveKeys = [
      'apikey',
      'apisecret',
      'api_key',
      'api_secret',
      'token',
      'accesstoken',
      'refreshtoken',
      'authtoken',
      'bearertoken',
      'idtoken',
      'sessiontoken',
      'password',
      'passwd',
      'secret',
      'privatekey',
      'private',
      'email',
      'emailaddress',
      'phonenumber',
      'ssn',
      'authorization',
    ];

    for (const [key, value] of Object.entries(context)) {
      // Check if key is sensitive (case-insensitive)
      if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk))) {
        sanitized[key] = '[REDACTED]';
        continue;
      }

      // Handle nested errors
      if (value instanceof Error) {
        sanitized[key] = {
          name: value.name,
          message: value.message,
        };
        continue;
      }

      // Handle functions (non-serializable)
      if (typeof value === 'function') {
        sanitized[key] = '[non-serializable]';
        continue;
      }

      // Handle circular references and other non-serializable objects
      try {
        JSON.stringify(value);
        sanitized[key] = value;
      } catch {
        sanitized[key] = '[non-serializable]';
      }
    }

    return sanitized;
  }
}

// ============================================================================
// SPECIALIZED ERROR CLASSES
// ============================================================================

/**
 * Session management errors
 *
 * @remarks
 * Used by SessionManager, session-utils.ts for session load/save operations.
 *
 * @example
 * ```typescript
 * throw new SessionError(
 *   'Failed to load session',
 *   { sessionPath: '/path/to/session', taskId: 'P1.M1.T1' }
 * );
 * ```
 */
export class SessionError extends PipelineError {
  readonly code = ErrorCodes.PIPELINE_SESSION_LOAD_FAILED;

  constructor(message: string, context?: PipelineErrorContext, cause?: Error) {
    super(message, context, cause);
    // Ensure prototype is set for this class
    Object.setPrototypeOf(this, SessionError.prototype);
  }

  /**
   * Check if this is a session load error
   *
   * @remarks
   * Convenience method for checking specific error codes.
   */
  isLoadError(): boolean {
    return this.code === ErrorCodes.PIPELINE_SESSION_LOAD_FAILED;
  }
}

/**
 * Task execution errors
 *
 * @remarks
 * Used by TaskOrchestrator, PRPExecutor for task execution failures.
 *
 * @example
 * ```typescript
 * throw new TaskError(
 *   'Task execution failed',
 *   { taskId: 'P1.M1.T1', attempt: 3, maxAttempts: 5 }
 * );
 * ```
 */
export class TaskError extends PipelineError {
  readonly code = ErrorCodes.PIPELINE_TASK_EXECUTION_FAILED;

  constructor(message: string, context?: PipelineErrorContext, cause?: Error) {
    super(message, context, cause);
    Object.setPrototypeOf(this, TaskError.prototype);
  }
}

/**
 * LLM agent errors
 *
 * @remarks
 * Used by PRPGenerator, PRPExecutor, PRPRuntime for LLM call failures.
 * Covers timeouts, API failures, and response parsing errors.
 *
 * @example
 * ```typescript
 * throw new AgentError(
 *   'LLM call failed',
 *   { taskId: 'P1.M1.T1', operation: 'generatePRP', attempt: 3 }
 * );
 * ```
 */
export class AgentError extends PipelineError {
  readonly code = ErrorCodes.PIPELINE_AGENT_LLM_FAILED;

  constructor(message: string, context?: PipelineErrorContext, cause?: Error) {
    super(message, context, cause);
    Object.setPrototypeOf(this, AgentError.prototype);
  }
}

/**
 * Validation errors
 *
 * @remarks
 * Used by PRPExecutor validation gates, scope-resolver.ts.
 * Different from prp-executor.ts ValidationError (has level, command, stdout, stderr).
 *
 * @example
 * ```typescript
 * throw new ValidationError(
 *   'Invalid scope format',
 *   { invalidInput: 'P1.X', expectedFormat: 'P1.M1' }
 * );
 * ```
 */
export class ValidationError extends PipelineError {
  readonly code: ErrorCode;

  constructor(
    message: string,
    context?: PipelineErrorContext,
    errorCodeOrCause?: ErrorCode | Error
  ) {
    // Determine if third argument is an error code or a cause
    let errorCode: ErrorCode;
    let cause: Error | undefined;

    if (errorCodeOrCause) {
      if (typeof errorCodeOrCause === 'string') {
        errorCode = errorCodeOrCause;
      } else {
        cause = errorCodeOrCause;
        errorCode = ErrorCodes.PIPELINE_VALIDATION_INVALID_INPUT;
      }
    } else {
      errorCode = ErrorCodes.PIPELINE_VALIDATION_INVALID_INPUT;
    }

    super(message, context, cause);
    Object.setPrototypeOf(this, ValidationError.prototype);
    this.code = errorCode;
  }
}

/**
 * Error thrown when bugfix session validation fails
 *
 * @remarks
 * Thrown when attempting to execute bug fix tasks outside of a bugfix session.
 * This prevents state corruption from creating fix tasks in feature implementation
 * sessions or other non-bugfix contexts.
 *
 * @example
 * ```typescript
 * import { BugfixSessionValidationError } from './utils/errors.js';
 *
 * if (!sessionPath.includes('bugfix')) {
 *   throw new BugfixSessionValidationError(
 *     'Bug fix tasks can only be executed within bugfix sessions.',
 *     { sessionPath }
 *   );
 * }
 * ```
 */
export class BugfixSessionValidationError extends PipelineError {
  readonly code = ErrorCodes.PIPELINE_SESSION_INVALID_BUGFIX_PATH;

  constructor(message: string, context?: PipelineErrorContext, cause?: Error) {
    super(message, context, cause);
    // CRITICAL: Must set prototype for this class explicitly
    Object.setPrototypeOf(this, BugfixSessionValidationError.prototype);
  }
}

/**
 * Nested PRP Pipeline execution errors
 *
 * @remarks
 * Used when PRP Pipeline execution is attempted while already running.
 * Only bug fix sessions with SKIP_BUG_FINDING=true are allowed to recurse.
 *
 * @example
 * ```typescript
 * if (process.env.PRP_PIPELINE_RUNNING && !isLegitimateRecursion) {
 *   throw new NestedExecutionError(
 *     'Nested PRP Pipeline execution detected. Only bug fix sessions can recurse. PID: {existingPid}',
 *     { existingPid, currentPid, sessionPath }
 *   );
 * }
 * ```
 */
export class NestedExecutionError extends PipelineError {
  readonly code = ErrorCodes.PIPELINE_VALIDATION_NESTED_EXECUTION;

  constructor(
    message: string,
    context?: PipelineErrorContext & {
      existingPid?: string;
      currentPid?: string;
      sessionPath?: string;
    },
    cause?: Error
  ) {
    super(message, context, cause);
    // CRITICAL: Must set prototype for this class explicitly
    Object.setPrototypeOf(this, NestedExecutionError.prototype);
  }
}

/**
 * Environment configuration errors
 *
 * @remarks
 * Used for environment configuration validation failures.
 * Covers missing environment variables, invalid configuration values, etc.
 *
 * @example
 * ```typescript
 * throw new EnvironmentError(
 *   'Missing required environment variable',
 *   { variable: 'API_KEY', required: true }
 * );
 * ```
 */
export class EnvironmentError extends PipelineError {
  readonly code = ErrorCodes.PIPELINE_VALIDATION_INVALID_INPUT;

  constructor(message: string, context?: PipelineErrorContext, cause?: Error) {
    super(message, context, cause);
    Object.setPrototypeOf(this, EnvironmentError.prototype);
  }
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Type guard for PipelineError
 *
 * @remarks
 * Returns true if the error is an instance of PipelineError.
 * Enables type narrowing in catch blocks.
 *
 * @example
 * ```typescript
 * try {
 *   await someOperation();
 * } catch (error) {
 *   if (isPipelineError(error)) {
 *     // error is narrowed to PipelineError
 *     console.log(error.code);
 *     logger.error(error.toJSON(), 'Operation failed');
 *   }
 * }
 * ```
 */
export function isPipelineError(error: unknown): error is PipelineError {
  return error instanceof PipelineError;
}

/**
 * Robustly extract a human-readable message from ANY thrown value.
 *
 * @remarks
 * `error instanceof Error ? error.message : String(error)` is the common
 * pattern, but it produces the useless literal `"[object Object]"` when a
 * plain object is thrown (e.g. a groundswell AgentResponse error, a ZodError
 * without the standard prototype, or a raw `{message: {...}}` payload). This
 * handles all those shapes so error reports and logs always carry real text.
 *
 * Handles: Error (uses .message), string (as-is), plain objects (.message if
 * string, else JSON), ZodError (.issues/.errors), arrays, null/undefined.
 */
export function toErrorMessage(error: unknown): string {
  if (error == null) {
    return 'Unknown error (null/undefined)';
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error instanceof Error) {
    return error.message || error.constructor?.name || 'Error (empty message)';
  }
  if (typeof error === 'object') {
    const obj = error as Record<string, unknown>;
    // Groundswell AgentResponse error: { code, message, details, recoverable }
    if (typeof obj.message === 'string' && obj.message.length > 0) {
      const code = typeof obj.code === 'string' ? obj.code : undefined;
      return code ? `${obj.message} (${code})` : obj.message;
    }
    // ZodError: has .issues or .errors array
    const issues = (obj.issues ?? obj.errors) as unknown;
    if (Array.isArray(issues) && issues.length > 0) {
      const parts = issues
        .map((i: unknown) => {
          if (typeof i === 'string') return i;
          if (i && typeof i === 'object') {
            const io = i as Record<string, unknown>;
            const path = io.path;
            const msg = io.message;
            const pathStr = Array.isArray(path)
              ? path.join('.')
              : typeof path === 'string'
                ? path
                : 'root';
            return typeof msg === 'string' ? `${pathStr}: ${msg}` : pathStr;
          }
          return String(i);
        })
        .slice(0, 10); // cap to avoid huge reports
      return `Validation failed: ${parts.join('; ')}`;
    }
    // Last resort: JSON (never produces [object Object])
    try {
      return JSON.stringify(error);
    } catch {
      return `${error.constructor?.name ?? 'Object'} (unserializable)`;
    }
  }
  return String(error);
}

/**
 * Type guard for SessionError
 *
 * @remarks
 * Returns true if the error is an instance of SessionError.
 * Use for session-specific error handling.
 *
 * @example
 * ```typescript
 * if (isSessionError(error)) {
 *   // error is narrowed to SessionError
 *   if (error.isLoadError()) {
 *     // Handle session load failure
 *   }
 * }
 * ```
 */
export function isSessionError(error: unknown): error is SessionError {
  return error instanceof SessionError;
}

/**
 * Type guard for TaskError
 *
 * @remarks
 * Returns true if the error is an instance of TaskError.
 * Use for task-specific error handling.
 */
export function isTaskError(error: unknown): error is TaskError {
  return error instanceof TaskError;
}

/**
 * Type guard for AgentError
 *
 * @remarks
 * Returns true if the error is an instance of AgentError.
 * Use for agent/LLM-specific error handling and retry logic.
 *
 * @example
 * ```typescript
 * if (isAgentError(error)) {
 *   // Check error code for retry logic
 *   if (error.code === ErrorCodes.PIPELINE_AGENT_TIMEOUT) {
 *     // Retry the operation
 *   }
 * }
 * ```
 */
export function isAgentError(error: unknown): error is AgentError {
  return error instanceof AgentError;
}

/**
 * Type guard for ValidationError
 *
 * @remarks
 * Returns true if the error is an instance of ValidationError.
 * Use for validation-specific error handling.
 */
export function isValidationError(error: unknown): error is ValidationError {
  return error instanceof ValidationError;
}

/**
 * Type guard for EnvironmentError
 *
 * @remarks
 * Returns true if the error is an instance of EnvironmentError.
 * Use for environment configuration-specific error handling.
 *
 * @example
 * ```typescript
 * try {
 *   validateEnvironment();
 * } catch (error) {
 *   if (isEnvironmentError(error)) {
 *     // error is narrowed to EnvironmentError
 *     console.log(`Environment error: ${error.message}`);
 *     console.log(`Error code: ${error.code}`);
 *     if (error.context) {
 *       console.log(`Context:`, error.context);
 *     }
 *   }
 * }
 * ```
 */
export function isEnvironmentError(error: unknown): error is EnvironmentError {
  return error instanceof EnvironmentError;
}

/**
 * Type guard for BugfixSessionValidationError
 *
 * @remarks
 * Returns true if the error is an instance of BugfixSessionValidationError.
 * Use for bugfix session validation error handling.
 *
 * @example
 * ```typescript
 * try {
 *   validateBugfixSession(sessionPath);
 * } catch (error) {
 *   if (isBugfixSessionValidationError(error)) {
 *     console.error(`Invalid bugfix path: ${error.context?.sessionPath}`);
 *   }
 * }
 * ```
 */
export function isBugfixSessionValidationError(
  error: unknown
): error is BugfixSessionValidationError {
  return error instanceof BugfixSessionValidationError;
}

/**
 * Type guard for NestedExecutionError
 *
 * @remarks
 * Returns true if the error is an instance of NestedExecutionError.
 * Enables type narrowing in catch blocks.
 *
 * @example
 * ```typescript
 * try {
 *   validateNestedExecution(sessionPath);
 * } catch (error) {
 *   if (isNestedExecutionError(error)) {
 *     console.error(`Nested execution detected. Existing PID: ${error.existingPid}`);
 *   }
 * }
 * ```
 */
export function isNestedExecutionError(
  error: unknown
): error is NestedExecutionError {
  return error instanceof NestedExecutionError;
}

/**
 * Determines if an error should be treated as fatal
 *
 * @remarks
 * Returns true if the error is fatal and should halt pipeline execution.
 * Returns false if the error is non-fatal and should allow continuation with tracking.
 *
 * Fatal error types:
 * - SessionError with LOAD_FAILED or SAVE_FAILED error codes
 * - EnvironmentError (all instances are fatal)
 * - ValidationError with INVALID_INPUT code for parse_prd operation
 *
 * Non-fatal error types:
 * - TaskError (all instances)
 * - AgentError (all instances)
 * - ValidationError with non-parse_prd operations
 * - All standard Error types (Error, TypeError, etc.)
 * - Non-object values (null, undefined, strings, numbers, etc.)
 * - All errors when continueOnError flag is true
 *
 * The continueOnError parameter overrides all fatal error detection,
 * treating all errors as non-fatal when set to true. This enables
 * maximum progress mode where individual task failures don't halt execution.
 *
 * @param error - Unknown error to evaluate for fatality
 * @param continueOnError - If true, all errors are treated as non-fatal (default: false)
 * @returns true if error is fatal (should abort), false otherwise
 *
 * @example
 * ```typescript
 * try {
 *   await pipelineOperation();
 * } catch (error) {
 *   if (isFatalError(error)) {
 *     // Fatal: halt execution
 *     throw error;
 *   }
 *   // Non-fatal: track and continue
 *   trackError(error);
 * }
 * ```
 */
export function isFatalError(
  error: unknown,
  continueOnError: boolean = false
): boolean {
  // Override all logic when continueOnError is true
  if (continueOnError) {
    return false;
  }

  // Non-object errors are non-fatal
  if (error == null || typeof error !== 'object') {
    return false;
  }

  // Check for PipelineError instances using type guard
  if (isPipelineError(error)) {
    // FATAL: All EnvironmentError instances
    if (isEnvironmentError(error)) {
      return true;
    }

    // FATAL: SessionError with LOAD_FAILED or SAVE_FAILED codes
    if (isSessionError(error)) {
      return (
        error.code === ErrorCodes.PIPELINE_SESSION_LOAD_FAILED ||
        error.code === ErrorCodes.PIPELINE_SESSION_SAVE_FAILED
      );
    }

    // FATAL: ValidationError for parse_prd operation with INVALID_INPUT code
    if (isValidationError(error)) {
      return (
        error.code === ErrorCodes.PIPELINE_VALIDATION_INVALID_INPUT &&
        error.context?.operation === 'parse_prd'
      );
    }

    // NON-FATAL: TaskError and AgentError are individual failures
    if (isTaskError(error) || isAgentError(error)) {
      return false;
    }
  }

  // Default: non-fatal for unknown error types
  return false;
}
