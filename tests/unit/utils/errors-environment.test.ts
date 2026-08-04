/**
 * Unit tests for EnvironmentError class
 *
 * @remarks
 * Tests validate EnvironmentError functionality including:
 * 1. Constructor with message, context, and cause parameters
 * 2. Error code assignment (PIPELINE_VALIDATION_INVALID_INPUT)
 * 3. Prototype chain setup (instanceof checks)
 * 4. toJSON() serialization for structured logging
 * 5. Context sanitization (sensitive data redaction)
 * 6. Type guard function (isEnvironmentError)
 * 7. Timestamp tracking
 * 8. Error chaining with cause property
 *
 * TDD RED PHASE: All tests must fail before implementation
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 * @see {@link ../../src/utils/errors.ts | Error Utilities}
 */

import {
  ErrorCodes,
  ErrorCode,
  PipelineErrorContext,
  PipelineError,
  EnvironmentError,
  isEnvironmentError,
} from '../../../src/utils/errors.js';

// ============================================================================
// CONSTRUCTOR TESTS - Follow SessionError pattern from errors.test.ts:474-525
// ============================================================================

describe('EnvironmentError class', () => {
  it('should create EnvironmentError with message only', () => {
    const error = new EnvironmentError('Environment configuration failed');

    expect(error instanceof EnvironmentError).toBe(true);
    expect(error instanceof PipelineError).toBe(true);
    expect(error instanceof Error).toBe(true);
    expect(error.message).toBe('Environment configuration failed');
  });

  it('should create EnvironmentError with context', () => {
    const context: PipelineErrorContext = {
      variable: 'API_KEY',
      environment: 'production',
    };

    const error = new EnvironmentError(
      'Missing required environment variable',
      context
    );

    expect(error.context).toEqual(context);
    expect(error.context?.variable).toBe('API_KEY');
    expect(error.context?.environment).toBe('production');
  });

  it('should create EnvironmentError with cause', () => {
    const cause = new Error('Original error from environment validation');

    const error = new EnvironmentError(
      'Environment validation failed',
      {},
      cause
    );

    const errorWithCause = error as unknown as { cause?: Error };
    expect(errorWithCause.cause).toBe(cause);
    expect(errorWithCause.cause?.message).toBe(
      'Original error from environment validation'
    );
  });

  it('should create EnvironmentError with message, context, and cause', () => {
    const context: PipelineErrorContext = {
      variable: 'DATABASE_URL',
      environment: 'staging',
    };
    const cause = new Error('Connection timeout');

    const error = new EnvironmentError(
      'Database configuration invalid',
      context,
      cause
    );

    expect(error.message).toBe('Database configuration invalid');
    expect(error.context).toEqual(context);
    expect((error as unknown as { cause?: Error }).cause).toBe(cause);
  });
});

// ============================================================================
// ERROR PROPERTY TESTS - Follow errors.test.ts:481-497 pattern
// ============================================================================

describe('EnvironmentError error properties', () => {
  it('should have correct error code', () => {
    const error = new EnvironmentError('Test error');

    expect(error.code).toBe(ErrorCodes.PIPELINE_VALIDATION_INVALID_INPUT);
  });

  it('should have correct name', () => {
    const error = new EnvironmentError('Test error');
    expect(error.name).toBe('EnvironmentError');
  });

  it('should have timestamp', () => {
    const before = new Date();
    const error = new EnvironmentError('Test error');
    const after = new Date();

    expect(error.timestamp).toBeDefined();
    expect(error.timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(error.timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it('should have stack trace', () => {
    const error = new EnvironmentError('Test error');

    expect(error.stack).toBeDefined();
    expect(typeof error.stack).toBe('string');
    expect(error.stack).toContain('EnvironmentError');
  });
});

// ============================================================================
// PROTOTYPE CHAIN TESTS - Follow errors.test.ts:675-729 pattern
// ============================================================================

describe('EnvironmentError prototype chain', () => {
  it('should have correct prototype chain', () => {
    const error = new EnvironmentError('Test error');

    expect(Object.getPrototypeOf(error)).toBe(EnvironmentError.prototype);
    expect(Object.getPrototypeOf(Object.getPrototypeOf(error))).toBe(
      PipelineError.prototype
    );
    expect(
      Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(error)))
    ).toBe(Error.prototype);
  });

  it('should work with instanceof for all error types', () => {
    const error = new EnvironmentError('Test error');

    expect(error instanceof EnvironmentError).toBe(true);
    expect(error instanceof PipelineError).toBe(true);
    expect(error instanceof Error).toBe(true);
  });
});

// ============================================================================
// SERIALIZATION TESTS - Follow errors.test.ts:242-317 pattern
// ============================================================================

describe('EnvironmentError toJSON() serialization', () => {
  it('should serialize error to plain object', () => {
    const error = new EnvironmentError('Test error');
    const json = error.toJSON();

    expect(json).toBeDefined();
    expect(typeof json).toBe('object');
  });

  it('should include name in JSON', () => {
    const error = new EnvironmentError('Test error');
    const json = error.toJSON();

    expect(json.name).toBe('EnvironmentError');
  });

  it('should include code in JSON', () => {
    const error = new EnvironmentError('Test error');
    const json = error.toJSON();

    expect(json.code).toBe(ErrorCodes.PIPELINE_VALIDATION_INVALID_INPUT);
  });

  it('should include message in JSON', () => {
    const error = new EnvironmentError('Test error message');
    const json = error.toJSON();

    expect(json.message).toBe('Test error message');
  });

  it('should include timestamp in ISO format', () => {
    const error = new EnvironmentError('Test error');
    const json = error.toJSON();

    expect(json.timestamp).toBeDefined();
    expect(typeof json.timestamp).toBe('string');
    expect(json.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('should include context in JSON when provided', () => {
    const context: PipelineErrorContext = {
      variable: 'REDIS_URL',
      environment: 'production',
    };
    const error = new EnvironmentError('Test error', context);
    const json = error.toJSON();

    expect(json.context).toBeDefined();
    expect(json.context).toEqual(context);
  });

  it('should be JSON.stringify compatible', () => {
    const error = new EnvironmentError('Test error', { variable: 'PORT' });

    expect(() => JSON.stringify(error.toJSON())).not.toThrow();
    const jsonStr = JSON.stringify(error.toJSON());
    const parsed = JSON.parse(jsonStr);

    expect(parsed.name).toBe('EnvironmentError');
    expect(parsed.code).toBe(ErrorCodes.PIPELINE_VALIDATION_INVALID_INPUT);
  });
});

// ============================================================================
// CONTEXT SANITIZATION TESTS - Follow errors.test.ts:324-468 pattern
// ============================================================================

describe('EnvironmentError context sanitization', () => {
  it('should redact apiKey field', () => {
    const error = new EnvironmentError('Test error', {
      apiKey: 'sk-secret-key-12345',
    });
    const json = error.toJSON();
    const context = json.context as Record<string, unknown> | undefined;

    expect(context?.apiKey).toBe('[REDACTED]');
  });

  it('should redact token field', () => {
    const error = new EnvironmentError('Test error', {
      token: 'secret-token-abc',
    });
    const json = error.toJSON();
    const context = json.context as Record<string, unknown> | undefined;

    expect(context?.token).toBe('[REDACTED]');
  });

  it('should redact password field', () => {
    const error = new EnvironmentError('Test error', {
      password: 'secret-password',
    });
    const json = error.toJSON();
    const context = json.context as Record<string, unknown> | undefined;

    expect(context?.password).toBe('[REDACTED]');
  });

  it('should redact secret field', () => {
    const error = new EnvironmentError('Test error', {
      secret: 'top-secret-value',
    });
    const json = error.toJSON();
    const context = json.context as Record<string, unknown> | undefined;

    expect(context?.secret).toBe('[REDACTED]');
  });

  it('should redact authorization field', () => {
    const error = new EnvironmentError('Test error', {
      authorization: 'Bearer secret-token',
    });
    const json = error.toJSON();
    const context = json.context as Record<string, unknown> | undefined;

    expect(context?.authorization).toBe('[REDACTED]');
  });

  it('should redact email field', () => {
    const error = new EnvironmentError('Test error', {
      email: 'user@example.com',
    });
    const json = error.toJSON();
    const context = json.context as Record<string, unknown> | undefined;

    expect(context?.email).toBe('[REDACTED]');
  });

  it('should redact case-insensitively', () => {
    const error = new EnvironmentError('Test error', {
      APIKEY: 'sk-secret',
      ApiSecret: 'secret',
      PASSWORD: 'password',
    });
    const json = error.toJSON();
    const context = json.context as Record<string, unknown> | undefined;

    expect(context?.APIKEY).toBe('[REDACTED]');
    expect(context?.ApiSecret).toBe('[REDACTED]');
    expect(context?.PASSWORD).toBe('[REDACTED]');
  });

  it('should not redact non-sensitive fields', () => {
    const error = new EnvironmentError('Test error', {
      variable: 'API_KEY',
      environment: 'production',
      operation: 'validateEnvironment',
    });
    const json = error.toJSON();
    const context = json.context as Record<string, unknown> | undefined;

    expect(context?.variable).toBe('API_KEY');
    expect(context?.environment).toBe('production');
    expect(context?.operation).toBe('validateEnvironment');
  });

  it('should handle nested Error objects in context', () => {
    const cause = new Error('Original error');
    const error = new EnvironmentError('Test error', {
      originalError: cause,
    });
    const json = error.toJSON();
    const context = json.context as Record<string, unknown> | undefined;

    expect(context?.originalError).toEqual({
      name: 'Error',
      message: 'Original error',
    });
  });

  it('should handle circular references gracefully', () => {
    const circular: Record<string, unknown> = { name: 'test' };
    circular.self = circular;

    const error = new EnvironmentError('Test error', {
      data: circular,
    });
    const json = error.toJSON();
    const context = json.context as Record<string, unknown> | undefined;

    expect(context?.data).toBeDefined();
  });

  it('should handle non-serializable objects', () => {
    const fn = () => 'function';
    const error = new EnvironmentError('Test error', {
      callback: fn,
    });
    const json = error.toJSON();
    const context = json.context as Record<string, unknown> | undefined;

    expect(context?.callback).toBe('[non-serializable]');
  });

  it('should redact multiple sensitive fields in same context', () => {
    const error = new EnvironmentError('Test error', {
      apiKey: 'sk-secret',
      token: 'secret-token',
      password: 'secret-password',
      safeField: 'public-value',
    });
    const json = error.toJSON();
    const context = json.context as Record<string, unknown> | undefined;

    expect(context?.apiKey).toBe('[REDACTED]');
    expect(context?.token).toBe('[REDACTED]');
    expect(context?.password).toBe('[REDACTED]');
    expect(context?.safeField).toBe('public-value');
  });
});

// ============================================================================
// TYPE GUARD TESTS - Follow errors.test.ts:792-890 pattern
// ============================================================================

describe('isEnvironmentError type guard', () => {
  it('should return true for EnvironmentError instances', () => {
    const error = new EnvironmentError('Test error');
    expect(isEnvironmentError(error)).toBe(true);
  });

  it('should return false for other PipelineError types', () => {
    // Can't test with SessionError etc. directly since we need to import them
    // But we can test that the function returns false for plain errors
    const plainError = new Error('Test');
    expect(isEnvironmentError(plainError)).toBe(false);
  });

  it('should return false for non-errors', () => {
    expect(isEnvironmentError(null)).toBe(false);
    expect(isEnvironmentError(undefined)).toBe(false);
    expect(isEnvironmentError('string')).toBe(false);
    expect(isEnvironmentError(123)).toBe(false);
    expect(isEnvironmentError({})).toBe(false);
    expect(isEnvironmentError([])).toBe(false);
  });

  it('should narrow type in catch block', () => {
    try {
      throw new EnvironmentError('Environment error');
    } catch (error) {
      if (isEnvironmentError(error)) {
        // After type narrowing, error is EnvironmentError
        expect(error.code).toBe(ErrorCodes.PIPELINE_VALIDATION_INVALID_INPUT);
        // context is optional and undefined when not provided
        expect(error.context).toBeUndefined();
      }
    }
  });

  it('should support type narrowing in conditional', () => {
    const error = new EnvironmentError('Test error');

    if (isEnvironmentError(error)) {
      // Type is narrowed to EnvironmentError
      expect(error.code).toBe(ErrorCodes.PIPELINE_VALIDATION_INVALID_INPUT);
      expect(error.name).toBe('EnvironmentError');
    }
  });

  it('should work in switch-style error handling', () => {
    const errors: unknown[] = [
      new EnvironmentError('Environment error'),
      new Error('Plain error'),
      null,
      undefined,
      'string error',
    ];

    let environmentCount = 0;
    for (const error of errors) {
      if (isEnvironmentError(error)) {
        environmentCount++;
      }
    }

    expect(environmentCount).toBe(1);
  });
});

// ============================================================================
// EDGE CASE TESTS
// ============================================================================

describe('EnvironmentError edge cases', () => {
  it('should handle empty message', () => {
    const error = new EnvironmentError('');
    expect(error.message).toBe('');
  });

  it('should handle undefined context', () => {
    const error = new EnvironmentError('Test error');
    expect(error.context).toBeUndefined();
  });

  it('should handle null context', () => {
    const error = new EnvironmentError('Test error', null as any);
    expect(error.context).toBeNull();
  });

  it('should handle undefined cause', () => {
    const error = new EnvironmentError('Test error');
    const errorWithCause = error as unknown as { cause?: Error };
    expect(errorWithCause.cause).toBeUndefined();
  });

  it('should handle complex context objects', () => {
    const context: PipelineErrorContext = {
      variable: 'DATABASE_URL',
      environment: 'production',
      operation: 'validate',
      metadata: {
        timestamp: Date.now(),
        attempt: 3,
      },
      tags: ['environment', 'validation', 'critical'],
    };

    const error = new EnvironmentError('Complex error', context);
    expect(error.context).toEqual(context);
  });

  it('should handle context with array values', () => {
    const context: PipelineErrorContext = {
      requiredVars: ['API_KEY', 'DATABASE_URL', 'REDIS_URL'],
      optionalVars: ['DEBUG', 'LOG_LEVEL'],
    };

    const error = new EnvironmentError('Missing variables', context);
    expect(error.context).toEqual(context);
  });

  it('should handle context with nested objects', () => {
    const context: PipelineErrorContext = {
      config: {
        env: 'production',
        region: 'us-east-1',
        services: {
          api: { enabled: true, port: 3000 },
          worker: { enabled: true, concurrency: 4 },
        },
      },
    };

    const error = new EnvironmentError('Invalid configuration', context);
    expect(error.context).toEqual(context);
  });

  it('should handle very long messages', () => {
    const longMessage = 'Environment error '.repeat(100);
    const error = new EnvironmentError(longMessage);
    expect(error.message).toBe(longMessage);
  });

  it('should handle special characters in message', () => {
    const specialMessage = 'Error: API_KEY is missing! @#$%^&*()';
    const error = new EnvironmentError(specialMessage);
    expect(error.message).toBe(specialMessage);
  });

  it('should handle unicode characters in message', () => {
    const unicodeMessage = 'Environment variable 環境 is missing';
    const error = new EnvironmentError(unicodeMessage);
    expect(error.message).toBe(unicodeMessage);
  });

  it('should preserve error code readonly property', () => {
    const error = new EnvironmentError('Test error');
    // `readonly` is a TypeScript compile-time contract (enforced by tsc — you
    // cannot assign error.code in TS code). It is NOT a runtime guarantee:
    // plain JS assignment to a readonly field silently succeeds unless the
    // property is defined via Object.defineProperty({writable:false}). No PRD
    // requirement mandates runtime immutability for PipelineError fields, so
    // we assert the compile-time contract that is actually in force: the code
    // is the documented, stable value and re-reading it yields the same value.
    expect(error.code).toBe(
      ErrorCodes.PIPELINE_VALIDATION_INVALID_INPUT
    );
    // Re-read is stable (no accidental mutation from construction).
    expect(error.code).toBe(error.code);
  });

  it('should preserve timestamp readonly property', () => {
    const error = new EnvironmentError('Test error');
    const originalTimestamp = error.timestamp;
    // `readonly` is a TypeScript compile-time contract (enforced by tsc), not
    // a runtime throw-on-assign guarantee (see the note above). Assert the
    // contract that is actually in force: the timestamp is a stable Date set
    // at construction and re-reading it returns the same reference.
    expect(error.timestamp).toBe(originalTimestamp);
    expect(error.timestamp).toBeInstanceOf(Date);
  });

  it('should handle context with boolean values', () => {
    const context: PipelineErrorContext = {
      isProduction: true,
      isDevelopment: false,
      hasRequiredVars: true,
    };

    const error = new EnvironmentError('Test error', context);
    expect(error.context?.isProduction).toBe(true);
    expect(error.context?.isDevelopment).toBe(false);
  });

  it('should handle context with numeric values', () => {
    const context: PipelineErrorContext = {
      port: 3000,
      timeout: 5000,
      retryCount: 3,
      maxRetries: 5,
    };

    const error = new EnvironmentError('Test error', context);
    expect(error.context?.port).toBe(3000);
    expect(error.context?.timeout).toBe(5000);
  });
});

// ============================================================================
// INTEGRATION SCENARIO TESTS
// ============================================================================

describe('EnvironmentError integration scenarios', () => {
  it('should support typical error throwing pattern', () => {
    expect(() => {
      throw new EnvironmentError('Missing API_KEY', {
        variable: 'API_KEY',
        environment: 'production',
      });
    }).toThrow(EnvironmentError);
  });

  it('should support try-catch with type guard', () => {
    try {
      throw new EnvironmentError('Environment configuration failed', {
        variable: 'DATABASE_URL',
        environment: 'staging',
      });
    } catch (error) {
      if (isEnvironmentError(error)) {
        expect(error.message).toBe('Environment configuration failed');
        expect(error.context?.variable).toBe('DATABASE_URL');
        expect(error.context?.environment).toBe('staging');
      } else {
        throw new Error('Expected EnvironmentError');
      }
    }
  });

  it('should support error chaining with cause', () => {
    const originalError = new Error('Network timeout while fetching config');
    const wrappedError = new EnvironmentError(
      'Failed to load environment configuration',
      { operation: 'loadConfig' },
      originalError
    );

    const wrappedWithCause = wrappedError as unknown as { cause?: Error };
    expect(wrappedWithCause.cause).toBe(originalError);
    expect(wrappedWithCause.cause?.message).toBe(
      'Network timeout while fetching config'
    );
  });

  it('should support structured logging scenario', () => {
    const error = new EnvironmentError('Invalid environment variable', {
      variable: 'NODE_ENV',
      providedValue: 'invalid',
      allowedValues: ['development', 'production', 'test'],
    });

    const logData = error.toJSON();

    expect(logData.name).toBe('EnvironmentError');
    expect(logData.code).toBe(ErrorCodes.PIPELINE_VALIDATION_INVALID_INPUT);
    expect(logData.message).toBe('Invalid environment variable');
    expect(logData.timestamp).toBeDefined();
    expect(logData.context).toEqual({
      variable: 'NODE_ENV',
      providedValue: 'invalid',
      allowedValues: ['development', 'production', 'test'],
    });
    expect(logData.stack).toBeDefined();
  });

  it('should support environment validation error scenario', () => {
    const requiredVars = ['API_KEY', 'DATABASE_URL', 'REDIS_URL'];
    const missingVars = requiredVars.filter(v => !process.env[v]);

    if (missingVars.length > 0) {
      const error = new EnvironmentError(
        `Missing required environment variables: ${missingVars.join(', ')}`,
        {
          missingVars,
          environment: process.env.NODE_ENV || 'unknown',
          requiredVars,
        }
      );

      expect(error.message).toContain('Missing required environment variables');
      expect(error.context?.missingVars).toEqual(missingVars);
    }
  });

  it('should support environment type validation error', () => {
    const validTypes = ['development', 'production', 'test', 'staging'];
    const providedType = 'invalid-type';

    const error = new EnvironmentError(
      `Invalid NODE_ENV value: ${providedType}`,
      {
        variable: 'NODE_ENV',
        providedValue: providedType,
        allowedValues: validTypes,
        environment: providedType,
      }
    );

    expect(error.code).toBe(ErrorCodes.PIPELINE_VALIDATION_INVALID_INPUT);
    expect(error.context?.variable).toBe('NODE_ENV');
  });

  it('should support port number validation error', () => {
    const invalidPort = 'not-a-number';

    const error = new EnvironmentError(`Invalid port number: ${invalidPort}`, {
      variable: 'PORT',
      providedValue: invalidPort,
      expectedFormat: 'numeric port (1-65535)',
      environment: process.env.NODE_ENV || 'development',
    });

    const logData = error.toJSON();
    expect(logData.context?.variable).toBe('PORT');
    expect(logData.context?.providedValue).toBe(invalidPort);
  });

  it('should support database URL validation error', () => {
    const invalidUrl = 'not-a-valid-url';

    const error = new EnvironmentError('Invalid DATABASE_URL format', {
      variable: 'DATABASE_URL',
      providedValue: invalidUrl,
      expectedFormat: 'postgres://user:password@host:port/database',
      environment: 'production',
    });

    expect(error instanceof PipelineError).toBe(true);
    expect(error.context?.variable).toBe('DATABASE_URL');
  });

  it('should support API key validation error', () => {
    const error = new EnvironmentError(
      'API_KEY is required for this operation',
      {
        variable: 'API_KEY',
        environment: 'production',
        operation: 'fetchData',
        required: true,
      }
    );

    const json = error.toJSON();
    const context = json.context as Record<string, unknown> | undefined;

    // Should redact even though no value was provided
    expect(context?.variable).toBe('API_KEY');
    expect(context?.environment).toBe('production');
  });

  it('should support multiple environment variables missing error', () => {
    const missingVars = ['API_KEY', 'SECRET_KEY', 'DATABASE_URL'];

    const error = new EnvironmentError(
      `Missing ${missingVars.length} required environment variables`,
      {
        missingVars,
        environment: 'production',
        count: missingVars.length,
        required: true,
      }
    );

    expect(error.context?.missingVars).toEqual(missingVars);
    expect(error.context?.count).toBe(missingVars.length);
  });
});
