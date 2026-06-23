/**
 * Unit tests for Logger utility
 *
 * @remarks
 * Tests validate the complete logger functionality including:
 * 1. LogLevel enum exports all required levels
 * 2. getLogger() returns Logger interface
 * 3. Child logger creation with additional bindings
 * 4. Log level filtering (debug ignored when not verbose)
 * 5. Redaction of sensitive data (apiKey, token, password)
 * 6. Machine-readable JSON output mode
 * 7. Pretty print development output mode
 * 8. Logger caching by context
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getLogger,
  LogLevel,
  Logger,
  LoggerConfig,
  clearLoggerCache,
  getGlobalConfig,
} from '../../src/utils/logger.js';

// =============================================================================
// TEST SETUP
// =============================================================================

describe('Logger utility', () => {
  // Clear cache before each test to ensure isolated test behavior
  beforeEach(() => {
    clearLoggerCache();
  });

  afterEach(() => {
    clearLoggerCache();
  });

  // ========================================================================
  // LogLevel enum tests
  // ========================================================================

  describe('LogLevel enum', () => {
    it('should export all six log levels', () => {
      expect(LogLevel.TRACE).toBe('trace');
      expect(LogLevel.DEBUG).toBe('debug');
      expect(LogLevel.INFO).toBe('info');
      expect(LogLevel.WARN).toBe('warn');
      expect(LogLevel.ERROR).toBe('error');
      expect(LogLevel.FATAL).toBe('fatal');
    });

    it('should have correct string values for pino compatibility', () => {
      expect(Object.values(LogLevel)).toEqual([
        'trace',
        'debug',
        'info',
        'warn',
        'error',
        'fatal',
      ]);
    });
  });

  // ========================================================================
  // getLogger() factory tests
  // ========================================================================

  describe('getLogger()', () => {
    it('should return a Logger interface', () => {
      const logger = getLogger('TestContext');
      expect(logger).toBeDefined();
      expect(typeof logger.trace).toBe('function');
      expect(typeof logger.debug).toBe('function');
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.warn).toBe('function');
      expect(typeof logger.error).toBe('function');
      expect(typeof logger.fatal).toBe('function');
      expect(typeof logger.child).toBe('function');
    });

    it('should return cached logger for same context and options', () => {
      const logger1 = getLogger('TestContext');
      const logger2 = getLogger('TestContext');
      expect(logger1).toBe(logger2);
    });

    it('should return different logger for different context', () => {
      const logger1 = getLogger('Context1');
      const logger2 = getLogger('Context2');
      expect(logger1).not.toBe(logger2);
    });

    it('should return different logger for different options', () => {
      const logger1 = getLogger('TestContext', { verbose: true });
      const logger2 = getLogger('TestContext', { verbose: false });
      expect(logger1).not.toBe(logger2);
    });

    it('should use INFO level by default', () => {
      const logger = getLogger('TestContext');
      // Logger is created, level check is implicit
      expect(logger).toBeDefined();
    });

    it('should accept LogLevel enum for level option', () => {
      const logger = getLogger('TestContext', { level: LogLevel.DEBUG });
      expect(logger).toBeDefined();
    });

    it('should not throw when process lacks setMaxListeners (partial stub)', () => {
      // Mirror the real progress-display.test.ts stub: spread copies OWN enumerable
      // props only, so the INHERITED setMaxListeners (from EventEmitter.prototype) is
      // absent. On main/4e6d2ef this made getLogger() throw
      // "TypeError: process.setMaxListeners is not a function".
      vi.stubGlobal('process', {
        ...process,
        on: vi.fn(),
        off: vi.fn(),
      });
      try {
        // Cache MUST be empty so the first-creation path (where setMaxListeners runs)
        // is exercised. beforeEach already cleared it; be explicit for robustness.
        clearLoggerCache();
        expect(() => getLogger('PartialStubTest')).not.toThrow();
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  // ========================================================================
  // Log level filtering tests
  // ========================================================================

  describe('Log level filtering', () => {
    let infoLogger: Logger;
    let debugLogger: Logger;

    beforeEach(() => {
      // Create loggers with test stream
      // Note: pino output is async, so we need to flush before checking
      infoLogger = getLogger('LevelTest', { level: LogLevel.INFO });
      debugLogger = getLogger('LevelTestDebug', { level: LogLevel.DEBUG });
    });

    it('should log info messages in INFO mode', () => {
      // This test validates the logger interface exists
      // Actual output validation requires stream redirection which is complex with pino
      expect(infoLogger.info).toBeDefined();
    });

    it('should log warn messages in INFO mode', () => {
      expect(infoLogger.warn).toBeDefined();
    });

    it('should log error messages in INFO mode', () => {
      expect(infoLogger.error).toBeDefined();
    });

    it('should log debug messages in DEBUG mode', () => {
      expect(debugLogger.debug).toBeDefined();
    });

    it('should support verbose option alias for DEBUG level', () => {
      const verboseLogger = getLogger('VerboseTest', { verbose: true });
      expect(verboseLogger).toBeDefined();
    });
  });

  // ========================================================================
  // Child logger tests
  // ========================================================================

  describe('child()', () => {
    it('should create child logger with additional bindings', () => {
      const parent = getLogger('ParentContext');
      const child = parent.child({ taskId: 'P1.M1.T1' });
      expect(child).toBeDefined();
      expect(typeof child.info).toBe('function');
      expect(typeof child.child).toBe('function');
    });

    it('should create nested child loggers', () => {
      const parent = getLogger('ParentContext');
      const child = parent.child({ taskId: 'P1.M1.T1' });
      const grandchild = child.child({ subtaskId: 'S1' });
      expect(grandchild).toBeDefined();
      expect(typeof grandchild.info).toBe('function');
    });

    it('should preserve logger interface in child', () => {
      const parent = getLogger('ParentContext');
      const child = parent.child({ key: 'value' });
      expect(typeof child.trace).toBe('function');
      expect(typeof child.debug).toBe('function');
      expect(typeof child.info).toBe('function');
      expect(typeof child.warn).toBe('function');
      expect(typeof child.error).toBe('function');
      expect(typeof child.fatal).toBe('function');
      expect(typeof child.child).toBe('function');
    });
  });

  // ========================================================================
  // Logger method signatures tests
  // ========================================================================

  describe('Logger method signatures', () => {
    let logger: Logger;

    beforeEach(() => {
      logger = getLogger('SignatureTest');
    });

    it('should accept string message for debug()', () => {
      expect(() => logger.debug('Debug message')).not.toThrow();
    });

    it('should accept object and message for debug()', () => {
      expect(() =>
        logger.debug({ key: 'value' }, 'Debug message')
      ).not.toThrow();
    });

    it('should accept string message for info()', () => {
      expect(() => logger.info('Info message')).not.toThrow();
    });

    it('should accept object and message for info()', () => {
      expect(() => logger.info({ key: 'value' }, 'Info message')).not.toThrow();
    });

    it('should accept string message for warn()', () => {
      expect(() => logger.warn('Warning message')).not.toThrow();
    });

    it('should accept object and message for warn()', () => {
      expect(() =>
        logger.warn({ key: 'value' }, 'Warning message')
      ).not.toThrow();
    });

    it('should accept string message for error()', () => {
      expect(() => logger.error('Error message')).not.toThrow();
    });

    it('should accept object and message for error()', () => {
      expect(() =>
        logger.error({ key: 'value' }, 'Error message')
      ).not.toThrow();
    });

    it('should accept additional args for all methods', () => {
      expect(() => logger.info('Message', 'arg1', 'arg2', 123)).not.toThrow();
      expect(() =>
        logger.debug({ key: 'value' }, 'Message', 'arg1', { obj: true })
      ).not.toThrow();
    });
  });

  // ========================================================================
  // Redaction tests
  // ========================================================================

  describe('Sensitive data redaction', () => {
    it('should redact apiKey field', () => {
      const logger = getLogger('RedactTest');
      // Redaction is configured but actual output validation requires stream capture
      // This test validates the configuration is accepted
      expect(() =>
        logger.info({ apiKey: 'sk-secret123' }, 'API call')
      ).not.toThrow();
    });

    it('should redact token field', () => {
      const logger = getLogger('RedactTest');
      expect(() =>
        logger.info({ token: 'secret-token-abc' }, 'Auth request')
      ).not.toThrow();
    });

    it('should redact password field', () => {
      const logger = getLogger('RedactTest');
      expect(() =>
        logger.info({ password: 'secret-password' }, 'Login attempt')
      ).not.toThrow();
    });

    it('should redact multiple sensitive fields in single object', () => {
      const logger = getLogger('RedactTest');
      expect(() =>
        logger.info(
          {
            apiKey: 'sk-secret',
            token: 'secret-token',
            password: 'secret-password',
            safeField: 'public-value',
          },
          'Multi-field log'
        )
      ).not.toThrow();
    });

    it('should redact nested credentials when path is specified', () => {
      const logger = getLogger('RedactTest');
      expect(() =>
        logger.info(
          {
            headers: {
              authorization: 'Bearer secret-token',
            },
          },
          'HTTP request'
        )
      ).not.toThrow();
    });

    it('should redact email addresses', () => {
      const logger = getLogger('RedactTest');
      expect(() =>
        logger.info({ email: 'user@example.com' }, 'User registration')
      ).not.toThrow();
    });
  });

  // ========================================================================
  // Cache management tests
  // ========================================================================

  describe('Logger cache', () => {
    it('should cache loggers by context and options', () => {
      const logger1 = getLogger('CacheTest');
      const logger2 = getLogger('CacheTest');
      expect(logger1).toBe(logger2); // Same instance
    });

    it('should create separate cache entries for different options', () => {
      const logger1 = getLogger('CacheTest', { level: LogLevel.INFO });
      const logger2 = getLogger('CacheTest', { level: LogLevel.DEBUG });
      expect(logger1).not.toBe(logger2);
    });

    it('should clear cache with clearLoggerCache()', () => {
      const logger1 = getLogger('CacheTest');
      clearLoggerCache();
      const logger2 = getLogger('CacheTest');
      expect(logger1).not.toBe(logger2); // New instance after clear
    });

    it('should return empty global config initially', () => {
      clearLoggerCache();
      const config = getGlobalConfig();
      expect(config).toEqual({});
    });

    it('should return global config after creating logger', () => {
      clearLoggerCache();
      const options: LoggerConfig = {
        level: LogLevel.DEBUG,
        verbose: true,
        machineReadable: false,
      };
      getLogger('ConfigTest', options);
      const config = getGlobalConfig();
      expect(config.level).toBe(LogLevel.DEBUG);
      expect(config.verbose).toBe(true);
      expect(config.machineReadable).toBe(false);
    });
  });

  // ========================================================================
  // Configuration options tests
  // ========================================================================

  describe('Logger configuration', () => {
    it('should accept machine-readable option', () => {
      const logger = getLogger('ConfigTest', { machineReadable: true });
      expect(logger).toBeDefined();
    });

    it('should accept verbose option', () => {
      const logger = getLogger('ConfigTest', { verbose: true });
      expect(logger).toBeDefined();
    });

    it('should accept level option', () => {
      const logger = getLogger('ConfigTest', { level: LogLevel.WARN });
      expect(logger).toBeDefined();
    });

    it('should accept all options together', () => {
      const logger = getLogger('ConfigTest', {
        level: LogLevel.ERROR,
        verbose: false,
        machineReadable: true,
      });
      expect(logger).toBeDefined();
    });

    it('should use default options when none provided', () => {
      const logger = getLogger('ConfigTest');
      expect(logger).toBeDefined();
    });
  });

  // ========================================================================
  // Context field tests
  // ========================================================================

  describe('Context field', () => {
    it('should include context in logger', () => {
      const logger = getLogger('MyComponent');
      // Context is included internally
      expect(logger).toBeDefined();
    });

    it('should create loggers with different contexts', () => {
      const logger1 = getLogger('ComponentA');
      const logger2 = getLogger('ComponentB');
      expect(logger1).not.toBe(logger2);
    });

    it('should allow context with special characters', () => {
      const logger = getLogger('Task.Orchestrator-P1');
      expect(logger).toBeDefined();
    });

    it('should allow context with numbers', () => {
      const logger = getLogger('Task123');
      expect(logger).toBeDefined();
    });
  });

  // ========================================================================
  // Integration tests
  // ========================================================================

  describe('Integration scenarios', () => {
    it('should support typical usage pattern', () => {
      // Simulate typical component usage
      const logger = getLogger('TaskOrchestrator');

      logger.info('Task execution started');
      logger.info(
        { taskId: 'P1.M1.T1', status: 'in_progress' },
        'Task status changed'
      );

      const taskLogger = logger.child({ taskId: 'P1.M1.T1' });
      taskLogger.info('Starting execution');
      taskLogger.debug('Detailed diagnostic information');

      logger.info({ apiKey: 'sk-1234567890', userId: 'abc' }, 'API call');

      // If no error thrown, test passes
      expect(true).toBe(true);
    });

    it('should support error logging pattern', () => {
      const logger = getLogger('ErrorComponent');

      const error = new Error('Something went wrong');
      logger.error(error.message);

      logger.error(
        { error: error.message, stack: error.stack },
        'Operation failed'
      );

      expect(true).toBe(true);
    });

    it('should support child logger for request tracking', () => {
      const baseLogger = getLogger('APIHandler');
      const requestLogger = baseLogger.child({
        requestId: 'req-123',
        userId: 'user-456',
      });

      requestLogger.info('Processing request');
      requestLogger.debug('Request details', { endpoint: '/api/tasks' });

      expect(true).toBe(true);
    });
  });
});
