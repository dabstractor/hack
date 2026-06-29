/**
 * Structured logging utility using pino for performance and observability
 *
 * @module utils/logger
 *
 * @remarks
 * Provides centralized, structured logging with sensitive data redaction,
 * context-aware loggers, and configurable output modes (pretty/JSON).
 *
 * Features:
 * - Log levels: TRACE, DEBUG, INFO, WARN, ERROR, FATAL
 * - Correlation ID support for request tracking across components
 * - Component-level log filtering
 * - Sensitive data redaction (API keys, tokens, passwords)
 * - Context-aware loggers with consistent prefixes
 * - Pretty-printed output for development (colored, human-readable)
 * - Machine-readable JSON output for log aggregation
 * - Verbose mode for debug-level logging
 *
 * @example
 * ```typescript
 * import { getLogger, LogLevel } from './utils/logger.js';
 *
 * // Basic usage - get context-aware logger
 * const logger = getLogger('TaskOrchestrator');
 * logger.info('Task execution started');
 *
 * // With data object
 * logger.info({ taskId: 'P1.M1.T1', status: 'in_progress' }, 'Task status changed');
 *
 * // Child logger for additional context
 * const taskLogger = logger.child({ taskId: 'P1.M1.T1' });
 * taskLogger.info('Starting execution');
 *
 * // Sensitive data is auto-redacted
 * logger.info({ apiKey: 'sk-1234567890', userId: 'abc' }, 'API call');
 * // Output: {"apiKey":"[REDACTED]","userId":"abc",...}
 *
 * // Using trace level for fine-grained debugging
 * logger.trace('Entering function with args', { arg1: 'value1' });
 *
 * // Using fatal level for system-critical errors
 * logger.fatal('Database connection lost - system cannot operate');
 * ```
 */

import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import pretty from 'pino-pretty';

const nodeRequire = createRequire(import.meta.url);

// ===== TYPES =====

/**
 * Log levels enum matching pino standard levels
 *
 * @remarks
 * Includes all standard Pino levels plus custom TRACE and FATAL levels:
 * - TRACE (10): Most verbose level for fine-grained debugging
 * - DEBUG (20): Debug-level messages
 * - INFO (30): Informational messages (default)
 * - WARN (40): Warning messages for non-critical issues
 * - ERROR (50): Error messages for failures and exceptions
 * - FATAL (60): Fatal errors indicating system-critical failures
 */
export enum LogLevel {
  TRACE = 'trace',
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
  FATAL = 'fatal',
}

/**
 * Logger interface - consistent API across the application
 * Mirrors pino's Logger interface with type safety
 */
export interface Logger {
  /** Log at trace level - most verbose, only shown when log-level is trace */
  trace(msg: string, ...args: unknown[]): void;
  trace(obj: unknown, msg?: string, ...args: unknown[]): void;

  /** Log at debug level - only shown when --verbose is enabled */
  debug(msg: string, ...args: unknown[]): void;
  debug(obj: unknown, msg?: string, ...args: unknown[]): void;

  /** Log at info level - default production level */
  info(msg: string, ...args: unknown[]): void;
  info(obj: unknown, msg?: string, ...args: unknown[]): void;

  /** Log at warn level - for non-critical issues */
  warn(msg: string, ...args: unknown[]): void;
  warn(obj: unknown, msg?: string, ...args: unknown[]): void;

  /** Log at error level - for failures and exceptions */
  error(msg: string, ...args: unknown[]): void;
  error(obj: unknown, msg?: string, ...args: unknown[]): void;

  /** Log at fatal level - for system-critical failures */
  fatal(msg: string, ...args: unknown[]): void;
  fatal(obj: unknown, msg?: string, ...args: unknown[]): void;

  /** Create a child logger with additional context */
  child(bindings: Record<string, unknown>): Logger;
}

/**
 * Logger configuration options
 */
export interface LoggerConfig {
  /** Minimum log level (default: 'info') */
  level?: LogLevel;
  /** Enable machine-readable JSON output */
  machineReadable?: boolean;
  /** Enable debug-level logging (alias for level: 'debug') */
  verbose?: boolean;
  /** Manual correlation ID override (auto-generated if not provided) */
  correlationId?: string;
  /** Explicit component labeling for categorization */
  component?: string;
}

// ===== CONSTANTS =====

/**
 * Sensitive data redaction paths
 *
 * @remarks
 * Uses dot-notation for nested object paths.
 * Pino redaction uses exact path matching.
 *
 * Critical: 'apiKey' redacts obj.apiKey but NOT obj.credentials.apiKey
 * Use wildcards: ['apiKey', 'credentials.*'] for nested redaction
 */
const REDACT_PATHS: readonly string[] = [
  // Common API key patterns
  'apiKey',
  'apiSecret',
  'api_key',
  'api_secret',
  'apiKeySecret',
  // Token patterns
  'token',
  'accessToken',
  'refreshToken',
  'authToken',
  'bearerToken',
  'idToken',
  'sessionToken',
  // Credential patterns
  'password',
  'passwd',
  'secret',
  'privateKey',
  'private',
  // GDPR sensitive data
  'email',
  'emailAddress',
  'phoneNumber',
  'ssn',
  // Authorization headers
  'authorization',
  'Authorization',
  'headers.authorization',
  'headers.Authorization',
  'request.headers.authorization',
  'response.headers["set-cookie"]',
  // Groundswell-specific (from PRP context)
  'config.apiKey',
  'environment.ANTHROPIC_AUTH_TOKEN',
  'environment.ANTHROPIC_API_KEY',
] as const;

/**
 * Redaction censor value
 */
const REDACT_CENSOR = '[REDACTED]';

/**
 * Pino level mapping for custom levels
 *
 * @remarks
 * Maps log level names to numeric values following Pino's conventions.
 * Used for customLevels configuration in pino().
 *
 * Numeric values determine filtering priority - higher numbers = more severe.
 */
const PINO_LEVELS = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
} as const;

// ===== PRIVATE STATE =====

/**
 * Logger instance cache by context
 *
 * @remarks
 * Uses Map for caching logger instances.
 * Key is combination of context string and options object.
 */
const loggerCache = new Map<string, Logger>();

/**
 * Global logger configuration
 *
 * @remarks
 * Stores the last configuration to detect when to invalidate cache.
 */
let globalConfig: LoggerConfig = {};

/**
 * Memoized pino accessor — lazily loads pino on first getLogger() call.
 *
 * @remarks
 * Pino is CommonJS and loaded via createRequire (same mechanism as before S1),
 * but deferred out of module-eval scope so importing logger.ts has zero side
 * effects. The bundle is memoized: after the first call the cached
 * { pino, stdTimeFunctions } is returned without touching require again.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PinoBundle = { pino: any; stdTimeFunctions: any };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _pinoBundle: PinoBundle | undefined;

function getPino(): PinoBundle {
  if (_pinoBundle) return _pinoBundle;
  const pinoRequire = nodeRequire('pino');
  const pino = pinoRequire; // CJS module.exports IS the factory
  _pinoBundle = { pino, stdTimeFunctions: pinoRequire.stdTimeFunctions };
  return _pinoBundle;
}

// ===== REQ-L3: SINGLE SHARED ROOT PER OUTPUT MODE (one sync stream, zero workers) =====

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _rootPretty: any; // human/pretty root — owns ONE pino-pretty Transform destination
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _rootJson: any; // machine-readable root — owns stdout (no separate stream)

/**
 * Builds a fresh root pino for the given output mode (configured ONCE; inherited by children).
 *
 * @param machineReadable - If true, build a JSON root (stdout). Otherwise, build a pretty root.
 * @returns A pino root logger instance.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildRoot(machineReadable: boolean): any {
  const { pino, stdTimeFunctions } = getPino();
  const config = createLoggerConfig({}, stdTimeFunctions);
  if (machineReadable) {
    // JSON → default stdout (sync); no 2nd arg, no pretty Transform.
    // base:{} suppresses pid/hostname (preserve today's output).
    return pino({ ...config, base: {} });
  }
  const dest = pretty({
    colorize: true,
    translateTime: 'HH:MM:ss',
    ignore: 'pid,hostname',
    messageFormat: '[{correlationId}] [{context}] {msg}',
    singleLine: false,
  });
  // base:{} suppresses pid/hostname; child bindings provide context & correlationId.
  return pino({ ...config, base: {} }, dest);
}

/**
 * Returns the cached root for the mode, building it lazily on first use (memoized).
 *
 * @param machineReadable - If true, return the JSON root. Otherwise, the pretty root.
 * @returns A pino root logger instance (cached after first build).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getRoot(machineReadable: boolean): any {
  return machineReadable
    ? (_rootJson ??= buildRoot(true))
    : (_rootPretty ??= buildRoot(false));
}

// ===== HELPER FUNCTIONS =====

/**
 * Generates cache key from context and options
 */
function getCacheKey(context: string, options?: LoggerConfig): string {
  const opts = options ?? {};
  return `${context}|${opts.level ?? 'info'}|${opts.machineReadable ?? false}|${opts.verbose ?? false}|${opts.correlationId ?? 'auto'}|${opts.component ?? 'none'}`;
}

/**
 * Generates a unique correlation ID for request tracking
 *
 * @returns UUID v4 string
 *
 * @remarks
 * Uses Node.js crypto.randomUUID() for fast, secure UUID generation.
 * Correlation IDs link related log entries across different components.
 */
function generateCorrelationId(): string {
  return randomUUID();
}

/**
 * Creates pino logger configuration
 *
 * @param options - Logger configuration options
 * @param stdTimeFunctions - pino stdTimeFunctions for ISO timestamps (from getPino())
 * @returns Pino LoggerOptions object (never contains a pino transport config key)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createLoggerConfig(
  options: LoggerConfig = {},
  stdTimeFunctions?: any
): any {
  const { level = LogLevel.INFO, verbose = false } = options;

  return {
    // Define custom levels with Pino numeric values
    customLevels: PINO_LEVELS,
    // Set log level based on verbose flag or explicit level
    level: verbose ? LogLevel.DEBUG : level,
    // Configure redaction
    redact: {
      paths: [...REDACT_PATHS],
      censor: REDACT_CENSOR,
      remove: false, // Keep the key with censored value
    },
    // Timestamp in ISO format for log aggregation
    timestamp: stdTimeFunctions.isoTime,
    // Custom formatters
    formatters: {
      level: (label: string) => {
        return { level: label };
      },
    },
  };
}

/**
 * Wraps a pino logger with our Logger interface
 *
 * @param pinoLogger - The underlying pino logger instance
 * @returns Logger interface wrapper
 *
 * @remarks
 * Pino's logger interface supports multiple call signatures:
 * - log(msg: string): void
 * - log(obj: unknown, msg?: string): void
 *
 * This wrapper provides a consistent interface that matches our Logger type.
 * Child loggers automatically inherit the parent's correlation ID via pino's bindings mechanism.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function wrapPinoLogger(pinoLogger: any): Logger {
  return {
    trace: (msgOrObj: unknown, msg?: string, ...args: unknown[]) => {
      if (typeof msgOrObj === 'string') {
        pinoLogger.trace(msgOrObj, ...args);
      } else {
        pinoLogger.trace(msgOrObj, msg, ...args);
      }
    },
    debug: (msgOrObj: unknown, msg?: string, ...args: unknown[]) => {
      if (typeof msgOrObj === 'string') {
        pinoLogger.debug(msgOrObj, ...args);
      } else {
        pinoLogger.debug(msgOrObj, msg, ...args);
      }
    },
    info: (msgOrObj: unknown, msg?: string, ...args: unknown[]) => {
      if (typeof msgOrObj === 'string') {
        pinoLogger.info(msgOrObj, ...args);
      } else {
        pinoLogger.info(msgOrObj, msg, ...args);
      }
    },
    warn: (msgOrObj: unknown, msg?: string, ...args: unknown[]) => {
      if (typeof msgOrObj === 'string') {
        pinoLogger.warn(msgOrObj, ...args);
      } else {
        pinoLogger.warn(msgOrObj, msg, ...args);
      }
    },
    error: (msgOrObj: unknown, msg?: string, ...args: unknown[]) => {
      if (typeof msgOrObj === 'string') {
        pinoLogger.error(msgOrObj, ...args);
      } else {
        pinoLogger.error(msgOrObj, msg, ...args);
      }
    },
    fatal: (msgOrObj: unknown, msg?: string, ...args: unknown[]) => {
      if (typeof msgOrObj === 'string') {
        pinoLogger.fatal(msgOrObj, ...args);
      } else {
        pinoLogger.fatal(msgOrObj, msg, ...args);
      }
    },
    child: (bindings: Record<string, unknown>) => {
      // Child loggers automatically inherit parent's correlation ID via pino
      const childPino = pinoLogger.child(bindings);
      return wrapPinoLogger(childPino);
    },
  };
}

// ===== PUBLIC API =====

/**
 * Logger factory function
 *
 * @param context - Context string for log identification (e.g., 'TaskOrchestrator')
 * @param options - Optional logger configuration
 * @returns Logger instance with context-aware logging
 *
 * @remarks
 * Creates or retrieves a cached logger instance for the given context.
 * Loggers are cached by context and options combination.
 *
 * The context is included in all log entries for filtering and tracing.
 * A correlation ID is automatically generated and included in all log entries
 * for distributed tracing. Child loggers automatically inherit the parent's
 * correlation ID.
 *
 * **Lazy pino loading (REQ-L2):** pino is loaded on first `getLogger()` call via
 * a memoized `getPino()` accessor — no module-eval side effects. This allows
 * call sites to import the logger module without triggering pino initialization
 * until logging is actually needed.
 *
 * **Synchronous destinations (REQ-L1):** both the JSON (machine-readable) and
 * pretty-print paths use synchronous in-process destination streams. No pino
 * transport config key is ever produced — zero worker threads, zero blocking
 * `process.on('exit')` handlers. The process can exit as soon as work is done.
 *
 * **Single root per mode (REQ-L3):** every logger is derived as a `child()` of a single
 * process-wide root pino — one root per output mode (pretty vs JSON). Each root owns exactly
 * ONE synchronous destination stream and ZERO worker threads, bounding total destinations
 * to at most one per mode (collapsing to one per process in normal single-mode CLI usage).
 * Child loggers inherit the root's destination and config, with independent level control.
 *
 * @example
 * ```typescript
 * // Default configuration (INFO level, pretty print)
 * const logger = getLogger('MyComponent');
 *
 * // Verbose mode (DEBUG level)
 * const debugLogger = getLogger('MyComponent', { verbose: true });
 *
 * // Machine-readable JSON output
 * const jsonLogger = getLogger('MyComponent', { machineReadable: true });
 *
 * // With custom correlation ID for request tracking
 * const logger = getLogger('MyComponent', { correlationId: 'req-12345' });
 *
 * // With custom log level
 * const traceLogger = getLogger('MyComponent', { level: LogLevel.TRACE });
 * ```
 */
export function getLogger(context: string, options?: LoggerConfig): Logger {
  // Check cache first
  const cacheKey = getCacheKey(context, options);
  const cached = loggerCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // Auto-generate correlation ID if not provided
  const correlationId = options?.correlationId || generateCorrelationId();

  const machineReadable = options?.machineReadable ?? false;
  const { level = LogLevel.INFO, verbose = false } = options ?? {};
  const resolvedLevel = verbose ? LogLevel.DEBUG : level;

  // REQ-L3: derive a child from the single shared root for this output mode.
  // One destination stream per mode; zero worker threads. Children set their own level
  // (proven: root level does not gate children).
  const root = getRoot(machineReadable);
  const pinoLogger = root.child(
    { context, correlationId },
    { level: resolvedLevel }
  );

  // Wrap with our Logger interface
  const logger = wrapPinoLogger(pinoLogger);

  // Cache the logger
  loggerCache.set(cacheKey, logger);
  globalConfig = options ?? {};

  return logger;
}

/**
 * Clears the logger cache
 *
 * @remarks
 * Invalidates all cached logger instances. Subsequent calls to getLogger()
 * will create new logger instances with fresh configuration.
 *
 * This is primarily useful for testing or when logger configuration
 * needs to be changed at runtime.
 */
export function clearLoggerCache(): void {
  loggerCache.clear();
  globalConfig = {};
  _rootPretty = undefined; // REQ-L3: force root rebuild on next getLogger (fresh config)
  _rootJson = undefined;
  // NOTE: getPino()'s _pinoBundle is intentionally NOT reset (the pino module never changes).
}

/**
 * Gets the current global logger configuration
 *
 * @returns Current global logger configuration
 */
export function getGlobalConfig(): Readonly<LoggerConfig> {
  return { ...globalConfig };
}
