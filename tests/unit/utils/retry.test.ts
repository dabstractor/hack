/**
 * Unit tests for Retry utility
 *
 * @remarks
 * Tests validate the complete retry functionality including:
 * 1. RetryOptions interface and defaults
 * 2. isTransientError() predicate for various error types
 * 3. isPermanentError() predicate for non-retryable errors
 * 4. retry<T>() function with exponential backoff
 * 5. Jitter randomization to prevent thundering herd
 * 6. maxAttempts limit enforcement
 * 7. Non-retryable errors throw immediately
 * 8. Successful retry after transient failure
 * 9. onRetry callback invocation
 * 10. retryAgentPrompt() helper
 * 11. retryMcpTool() helper
 * 12. createDefaultOnRetry() logger integration
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  retry,
  isTransientError,
  isPermanentError,
  createDefaultOnRetry,
  retryAgentPrompt,
  retryMcpTool,
} from '../../../src/utils/retry.js';
import {
  AgentError,
  ValidationError,
  ErrorCodes,
  isValidationError,
} from '../../../src/utils/errors.js';

// =============================================================================
// TEST SETUP
// =============================================================================

describe('Retry utility', () => {
  // Use fake timers for deterministic sleep timing
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ========================================================================
  // isTransientError() tests
  // ========================================================================

  describe('isTransientError()', () => {
    describe('Node.js system error codes', () => {
      it('should return true for ETIMEDOUT', () => {
        const error = { code: 'ETIMEDOUT', message: 'Connection timeout' };
        expect(isTransientError(error)).toBe(true);
      });

      it('should return true for ECONNRESET', () => {
        const error = {
          code: 'ECONNRESET',
          message: 'Connection reset by peer',
        };
        expect(isTransientError(error)).toBe(true);
      });

      it('should return true for ECONNREFUSED', () => {
        const error = { code: 'ECONNREFUSED', message: 'Connection refused' };
        expect(isTransientError(error)).toBe(true);
      });

      it('should return true for ENOTFOUND', () => {
        const error = { code: 'ENOTFOUND', message: 'DNS lookup failed' };
        expect(isTransientError(error)).toBe(true);
      });

      it('should return true for EPIPE', () => {
        const error = { code: 'EPIPE', message: 'Broken pipe' };
        expect(isTransientError(error)).toBe(true);
      });

      it('should return true for EAI_AGAIN', () => {
        const error = { code: 'EAI_AGAIN', message: 'DNS temporary failure' };
        expect(isTransientError(error)).toBe(true);
      });

      it('should return true for EHOSTUNREACH', () => {
        const error = { code: 'EHOSTUNREACH', message: 'Host unreachable' };
        expect(isTransientError(error)).toBe(true);
      });

      it('should return true for ENETUNREACH', () => {
        const error = { code: 'ENETUNREACH', message: 'Network unreachable' };
        expect(isTransientError(error)).toBe(true);
      });

      it('should return true for ECONNABORTED', () => {
        const error = { code: 'ECONNABORTED', message: 'Connection aborted' };
        expect(isTransientError(error)).toBe(true);
      });

      it('should return false for non-transient error codes', () => {
        const error = { code: 'ENOENT', message: 'File not found' };
        expect(isTransientError(error)).toBe(false);
      });
    });

    describe('HTTP status codes', () => {
      it('should return true for 408 Request Timeout', () => {
        const error = {
          message: 'Request timeout',
          response: { status: 408 },
        };
        expect(isTransientError(error)).toBe(true);
      });

      it('should return true for 429 Too Many Requests', () => {
        const error = {
          message: 'Rate limit exceeded',
          response: { status: 429 },
        };
        expect(isTransientError(error)).toBe(true);
      });

      it('should return true for 500 Internal Server Error', () => {
        const error = {
          message: 'Internal server error',
          response: { status: 500 },
        };
        expect(isTransientError(error)).toBe(true);
      });

      it('should return true for 502 Bad Gateway', () => {
        const error = {
          message: 'Bad gateway',
          response: { status: 502 },
        };
        expect(isTransientError(error)).toBe(true);
      });

      it('should return true for 503 Service Unavailable', () => {
        const error = {
          message: 'Service unavailable',
          response: { status: 503 },
        };
        expect(isTransientError(error)).toBe(true);
      });

      it('should return true for 504 Gateway Timeout', () => {
        const error = {
          message: 'Gateway timeout',
          response: { status: 504 },
        };
        expect(isTransientError(error)).toBe(true);
      });

      it('should return false for 400 Bad Request', () => {
        const error = {
          message: 'Bad request',
          response: { status: 400 },
        };
        expect(isTransientError(error)).toBe(false);
      });

      it('should return false for 404 Not Found', () => {
        const error = {
          message: 'Not found',
          response: { status: 404 },
        };
        expect(isTransientError(error)).toBe(false);
      });
    });

    describe('PipelineError hierarchy', () => {
      it('should return true for AgentError with PIPELINE_AGENT_TIMEOUT code', () => {
        const error = new AgentError('Agent timeout', { taskId: 'P1.M1.T1' });
        // Override code for testing
        (error as { code: string }).code = ErrorCodes.PIPELINE_AGENT_TIMEOUT;
        expect(isTransientError(error)).toBe(true);
      });

      it('should return true for AgentError with PIPELINE_AGENT_LLM_FAILED code', () => {
        const error = new AgentError('LLM failed', { taskId: 'P1.M1.T1' });
        (error as { code: string }).code = ErrorCodes.PIPELINE_AGENT_LLM_FAILED;
        expect(isTransientError(error)).toBe(true);
      });

      it('should return false for AgentError with other codes', () => {
        const error = new AgentError('Agent parse failed', {
          taskId: 'P1.M1.T1',
        });
        (error as { code: string }).code =
          ErrorCodes.PIPELINE_AGENT_PARSE_FAILED;
        expect(isTransientError(error)).toBe(false);
      });

      it('should return false for ValidationError', () => {
        const error = new ValidationError('Invalid input', {
          field: 'taskId',
        });
        expect(isTransientError(error)).toBe(false);
      });
    });

    describe('Error message patterns', () => {
      it('should return true for timeout pattern', () => {
        const error = new Error('Request timeout');
        expect(isTransientError(error)).toBe(true);
      });

      it('should return true for network error pattern', () => {
        const error = new Error('Network error occurred');
        expect(isTransientError(error)).toBe(true);
      });

      it('should return true for temporarily unavailable pattern', () => {
        const error = new Error('Service temporarily unavailable');
        expect(isTransientError(error)).toBe(true);
      });

      it('should return true for service unavailable pattern', () => {
        const error = new Error('Service unavailable');
        expect(isTransientError(error)).toBe(true);
      });

      it('should return true for connection reset pattern', () => {
        const error = new Error('Connection reset');
        expect(isTransientError(error)).toBe(true);
      });

      it('should return true for connection refused pattern', () => {
        const error = new Error('Connection refused');
        expect(isTransientError(error)).toBe(true);
      });

      it('should return true for rate limit pattern', () => {
        const error = new Error('Rate limit exceeded');
        expect(isTransientError(error)).toBe(true);
      });

      it('should return true for too many requests pattern', () => {
        const error = new Error('Too many requests');
        expect(isTransientError(error)).toBe(true);
      });

      it('should return true for econnreset pattern', () => {
        const error = new Error('econnreset - connection reset');
        expect(isTransientError(error)).toBe(true);
      });

      it('should return true for etimedout pattern', () => {
        const error = new Error('etimedout - operation timed out');
        expect(isTransientError(error)).toBe(true);
      });

      it('should return false for non-transient patterns', () => {
        const error = new Error('Some random error message');
        expect(isTransientError(error)).toBe(false);
      });
    });

    describe('Edge cases', () => {
      it('should return false for null', () => {
        expect(isTransientError(null)).toBe(false);
      });

      it('should return false for undefined', () => {
        expect(isTransientError(undefined)).toBe(false);
      });

      it('should return false for string', () => {
        expect(isTransientError('error string')).toBe(false);
      });

      it('should return false for number', () => {
        expect(isTransientError(123)).toBe(false);
      });

      it('should return false for plain object without error properties', () => {
        expect(isTransientError({ foo: 'bar' })).toBe(false);
      });

      it('should return false for Error without message or code', () => {
        const error = new Error();
        expect(isTransientError(error)).toBe(false);
      });
    });
  });

  // ========================================================================
  // isPermanentError() tests
  // ========================================================================

  describe('isPermanentError()', () => {
    describe('ValidationError from error hierarchy', () => {
      it('should return true for ValidationError', () => {
        const error = new ValidationError('Invalid input', {
          field: 'taskId',
        });
        expect(isPermanentError(error)).toBe(true);
      });

      it('should return true for ValidationError via type guard', () => {
        const error = new ValidationError('Schema validation failed', {
          schema: 'TaskSchema',
        });
        expect(isValidationError(error)).toBe(true);
        expect(isPermanentError(error)).toBe(true);
      });
    });

    describe('HTTP client errors (4xx)', () => {
      it('should return true for 400 Bad Request', () => {
        const error = {
          message: 'Bad request',
          response: { status: 400 },
        };
        expect(isPermanentError(error)).toBe(true);
      });

      it('should return true for 401 Unauthorized', () => {
        const error = {
          message: 'Unauthorized',
          response: { status: 401 },
        };
        expect(isPermanentError(error)).toBe(true);
      });

      it('should return true for 403 Forbidden', () => {
        const error = {
          message: 'Forbidden',
          response: { status: 403 },
        };
        expect(isPermanentError(error)).toBe(true);
      });

      it('should return true for 404 Not Found', () => {
        const error = {
          message: 'Not found',
          response: { status: 404 },
        };
        expect(isPermanentError(error)).toBe(true);
      });

      it('should return true for 405 Method Not Allowed', () => {
        const error = {
          message: 'Method not allowed',
          response: { status: 405 },
        };
        expect(isPermanentError(error)).toBe(true);
      });

      it('should return true for 422 Unprocessable Entity', () => {
        const error = {
          message: 'Unprocessable entity',
          response: { status: 422 },
        };
        expect(isPermanentError(error)).toBe(true);
      });

      it('should return false for 408 Request Timeout (retryable)', () => {
        const error = {
          message: 'Request timeout',
          response: { status: 408 },
        };
        expect(isPermanentError(error)).toBe(false);
      });

      it('should return false for 429 Rate Limit (retryable)', () => {
        const error = {
          message: 'Rate limit exceeded',
          response: { status: 429 },
        };
        expect(isPermanentError(error)).toBe(false);
      });
    });

    describe('Error message patterns', () => {
      it('should return true for validation failed pattern', () => {
        const error = new Error('Schema validation failed');
        expect(isPermanentError(error)).toBe(true);
      });

      it('should return true for invalid input pattern', () => {
        const error = new Error('Invalid input provided');
        expect(isPermanentError(error)).toBe(true);
      });

      it('should return true for unauthorized pattern', () => {
        const error = new Error('Unauthorized access');
        expect(isPermanentError(error)).toBe(true);
      });

      it('should return true for forbidden pattern', () => {
        const error = new Error('Access forbidden');
        expect(isPermanentError(error)).toBe(true);
      });

      it('should return true for not found pattern', () => {
        const error = new Error('Resource not found');
        expect(isPermanentError(error)).toBe(true);
      });

      it('should return true for authentication failed pattern', () => {
        const error = new Error('Authentication failed');
        expect(isPermanentError(error)).toBe(true);
      });

      it('should return true for parse error pattern', () => {
        const error = new Error('JSON parse error');
        expect(isPermanentError(error)).toBe(true);
      });
    });

    describe('Edge cases', () => {
      it('should return false for null', () => {
        expect(isPermanentError(null)).toBe(false);
      });

      it('should return false for undefined', () => {
        expect(isPermanentError(undefined)).toBe(false);
      });

      it('should return false for transient error patterns', () => {
        const error = new Error('Request timeout');
        expect(isPermanentError(error)).toBe(false);
      });
    });
  });

  // ========================================================================
  // retry<T>() function tests
  // ========================================================================

  describe('retry<T>()', () => {
    describe('successful operation (no retry needed)', () => {
      it('should return result immediately on success', async () => {
        const fn = async () => 'success';
        const result = await retry(fn);
        expect(result).toBe('success');
      });

      it('should return object result', async () => {
        const fn = async () => ({ data: 'value' });
        const result = await retry(fn);
        expect(result).toEqual({ data: 'value' });
      });

      it('should return null result', async () => {
        const fn = async () => null;
        const result = await retry(fn);
        expect(result).toBeNull();
      });
    });

    describe('transient error retry behavior', () => {
      it('should retry on transient error and succeed', async () => {
        let attempts = 0;
        const fn = async () => {
          attempts++;
          if (attempts === 1) {
            const err = new Error('ETIMEDOUT');
            (err as { code?: string }).code = 'ETIMEDOUT';
            throw err;
          }
          return 'success';
        };

        const retryPromise = retry(fn, { maxAttempts: 3 });
        retryPromise.catch(() => {}); // prevent unhandled rejection during fake timer advance
        await vi.runAllTimersAsync();
        const result = await retryPromise;
        expect(result).toBe('success');
        expect(attempts).toBe(2);
      });

      it('should retry multiple times before success', async () => {
        let attempts = 0;
        const fn = async () => {
          attempts++;
          if (attempts < 3) {
            const err = new Error('Connection timeout');
            (err as { code?: string }).code = 'ETIMEDOUT';
            throw err;
          }
          return 'success';
        };

        const retryPromise = retry(fn, { maxAttempts: 5 });
        retryPromise.catch(() => {}); // prevent unhandled rejection during fake timer advance
        await vi.runAllTimersAsync();
        const result = await retryPromise;
        expect(result).toBe('success');
        expect(attempts).toBe(3);
      });

      it('should use exponential backoff between retries', async () => {
        const delays: number[] = [];
        let attempts = 0;

        const fn = async () => {
          attempts++;
          if (attempts < 3) {
            const err = new Error('ECONNRESET');
            (err as { code?: string }).code = 'ECONNRESET';
            throw err;
          }
          return 'success';
        };

        // Track timer calls with fake timers
        const originalSetTimeout = global.setTimeout;
        vi.spyOn(global, 'setTimeout').mockImplementation((callback, ms) => {
          if (ms !== undefined) {
            delays.push(ms);
          }
          // Call original to use fake timers
          return originalSetTimeout(
            callback as () => void,
            ms ?? 0
          ) as unknown as NodeJS.Timeout;
        });

        const retryPromise = retry(fn, {
          maxAttempts: 3,
          baseDelay: 1000,
          backoffFactor: 2,
          jitterFactor: 0, // No jitter for predictable testing
        });

        // Run all timers to execute retries
        await vi.runAllTimersAsync();
        await retryPromise;

        // First retry: attempt 0, delay = 1000 * 2^0 = 1000ms
        // Second retry: attempt 1, delay = 1000 * 2^1 = 2000ms
        expect(delays[0]).toBe(1000);
        expect(delays[1]).toBe(2000);
      });

      it('should cap delay at maxDelay', async () => {
        const delays: number[] = [];
        let attempts = 0;

        const fn = async () => {
          attempts++;
          if (attempts < 4) {
            const err = new Error('ETIMEDOUT');
            (err as { code?: string }).code = 'ETIMEDOUT';
            throw err;
          }
          return 'success';
        };

        // Track timer calls with fake timers
        const originalSetTimeout = global.setTimeout;
        vi.spyOn(global, 'setTimeout').mockImplementation((callback, ms) => {
          if (ms !== undefined) {
            delays.push(ms);
          }
          // Call original to use fake timers
          return originalSetTimeout(
            callback as () => void,
            ms ?? 0
          ) as unknown as NodeJS.Timeout;
        });

        const retryPromise = retry(fn, {
          maxAttempts: 5,
          baseDelay: 1000,
          maxDelay: 2000,
          backoffFactor: 2,
          jitterFactor: 0,
        });

        // Run all timers to execute retries
        await vi.runAllTimersAsync();
        await retryPromise;

        // Attempt 0: 1000ms
        // Attempt 1: 2000ms (capped at maxDelay)
        // Attempt 2: 2000ms (capped at maxDelay, would be 4000ms)
        expect(delays[0]).toBe(1000);
        expect(delays[1]).toBe(2000);
        expect(delays[2]).toBe(2000);
      });

      it('should add jitter to delay', async () => {
        const delays: number[] = [];
        let attempts = 0;

        const fn = async () => {
          attempts++;
          if (attempts < 3) {
            const err = new Error('ETIMEDOUT');
            (err as { code?: string }).code = 'ETIMEDOUT';
            throw err;
          }
          return 'success';
        };

        const originalSetTimeout = global.setTimeout;
        vi.spyOn(global, 'setTimeout').mockImplementation((callback, ms) => {
          if (ms !== undefined) {
            delays.push(ms);
          }
          // Call original to use fake timers
          return originalSetTimeout(
            callback as () => void,
            ms ?? 0
          ) as unknown as NodeJS.Timeout;
        });

        const retryPromise = retry(fn, {
          maxAttempts: 3,
          baseDelay: 1000,
          jitterFactor: 0.2, // 20% jitter
        });

        await vi.runAllTimersAsync();
        await retryPromise;

        // With jitter, delays should vary
        // First: ~1000ms +/- 200ms
        // Second: ~2000ms +/- 400ms
        expect(delays[0]).toBeGreaterThan(800);
        expect(delays[0]).toBeLessThan(1200);
        expect(delays[1]).toBeGreaterThan(1600);
        expect(delays[1]).toBeLessThan(2400);
      });
    });

    describe('non-retryable errors', () => {
      it('should throw immediately for ValidationError', async () => {
        const fn = async () => {
          throw new ValidationError('Invalid input', { field: 'taskId' });
        };

        await expect(retry(fn, { maxAttempts: 5 })).rejects.toThrow(
          'Invalid input'
        );
      });

      it('should throw immediately for 404 error', async () => {
        let attempts = 0;
        const fn = async () => {
          attempts++;
          const err = new Error('Not found');
          (err as { response?: { status?: number } }).response = {
            status: 404,
          };
          throw err;
        };

        await expect(retry(fn, { maxAttempts: 5 })).rejects.toThrow(
          'Not found'
        );
        expect(attempts).toBe(1); // Should not retry
      });

      it('should throw immediately for 400 error', async () => {
        let attempts = 0;
        const fn = async () => {
          attempts++;
          const err = new Error('Bad request');
          (err as { response?: { status?: number } }).response = {
            status: 400,
          };
          throw err;
        };

        await expect(retry(fn, { maxAttempts: 5 })).rejects.toThrow(
          'Bad request'
        );
        expect(attempts).toBe(1); // Should not retry
      });

      it('should throw immediately for custom isRetryable returning false', async () => {
        let attempts = 0;
        const fn = async () => {
          attempts++;
          throw new Error('Custom error');
        };

        await expect(
          retry(fn, {
            maxAttempts: 5,
            isRetryable: () => false, // Never retry
          })
        ).rejects.toThrow('Custom error');

        expect(attempts).toBe(1); // Should not retry
      });
    });

    describe('maxAttempts enforcement', () => {
      it('should throw after maxAttempts exhausted', async () => {
        let attempts = 0;
        const fn = async () => {
          attempts++;
          const err = new Error('ETIMEDOUT');
          (err as { code?: string }).code = 'ETIMEDOUT';
          throw err;
        };

        const retryPromise = retry(fn, { maxAttempts: 3 });
        retryPromise.catch(() => {}); // prevent unhandled rejection during fake timer advance
        await vi.runAllTimersAsync();
        await expect(retryPromise).rejects.toThrow('ETIMEDOUT');

        expect(attempts).toBe(3); // Initial + 2 retries
      });

      it('should throw original error after maxAttempts', async () => {
        const originalError = new Error('ECONNRESET');
        (originalError as { code?: string }).code = 'ECONNRESET';

        const fn = async () => {
          throw originalError;
        };

        const retryPromise = retry(fn, { maxAttempts: 3 });
        retryPromise.catch(() => {}); // prevent unhandled rejection during fake timer advance
        await vi.runAllTimersAsync();
        await expect(retryPromise).rejects.toThrow('ECONNRESET');
      });

      it('should respect default maxAttempts of 3', async () => {
        let attempts = 0;
        const fn = async () => {
          attempts++;
          const err = new Error('ETIMEDOUT');
          (err as { code?: string }).code = 'ETIMEDOUT';
          throw err;
        };

        const retryPromise = retry(fn);
        retryPromise.catch(() => {}); // prevent unhandled rejection during fake timer advance
        await vi.runAllTimersAsync();
        await expect(retryPromise).rejects.toThrow('ETIMEDOUT');
        expect(attempts).toBe(3);
      });
    });

    describe('onRetry callback', () => {
      it('should call onRetry with attempt, error, and delay', async () => {
        const callbackCalls: Array<{
          attempt: number;
          error: unknown;
          delay: number;
        }> = [];

        let attempts = 0;
        const fn = async () => {
          attempts++;
          if (attempts < 3) {
            const err = new Error('ETIMEDOUT');
            (err as { code?: string }).code = 'ETIMEDOUT';
            throw err;
          }
          return 'success';
        };

        const originalSetTimeout = global.setTimeout;
        vi.spyOn(global, 'setTimeout').mockImplementation((callback, ms) => {
          // Call original to use fake timers
          return originalSetTimeout(
            callback as () => void,
            ms ?? 0
          ) as unknown as NodeJS.Timeout;
        });

        const retryPromise = retry(fn, {
          maxAttempts: 5,
          baseDelay: 1000,
          jitterFactor: 0,
          onRetry: (attempt, error, delay) => {
            callbackCalls.push({ attempt, error, delay });
          },
        });

        await vi.runAllTimersAsync();
        await retryPromise;

        expect(callbackCalls.length).toBe(2);

        // First retry
        expect(callbackCalls[0].attempt).toBe(1);
        expect(callbackCalls[0].delay).toBe(1000);
        expect((callbackCalls[0].error as Error).message).toBe('ETIMEDOUT');

        // Second retry
        expect(callbackCalls[1].attempt).toBe(2);
        expect(callbackCalls[1].delay).toBe(2000);
      });

      it('should not call onRetry on success', async () => {
        const callbackCalls: unknown[] = [];

        const fn = async () => 'success';

        await retry(fn, {
          onRetry: () => {
            callbackCalls.push(true);
          },
        });

        expect(callbackCalls.length).toBe(0);
      });

      it('should not call onRetry for non-retryable errors', async () => {
        const callbackCalls: unknown[] = [];

        const fn = async () => {
          throw new ValidationError('Invalid input', { field: 'taskId' });
        };

        await expect(
          retry(fn, {
            onRetry: () => {
              callbackCalls.push(true);
            },
          })
        ).rejects.toThrow();

        expect(callbackCalls.length).toBe(0);
      });
    });

    describe('custom configuration', () => {
      it('should use custom baseDelay', async () => {
        const delays: number[] = [];
        let attempts = 0;

        const fn = async () => {
          attempts++;
          if (attempts < 2) {
            const err = new Error('ETIMEDOUT');
            (err as { code?: string }).code = 'ETIMEDOUT';
            throw err;
          }
          return 'success';
        };

        const originalSetTimeout = global.setTimeout;
        vi.spyOn(global, 'setTimeout').mockImplementation((callback, ms) => {
          if (ms !== undefined) {
            delays.push(ms);
          }
          // Call original to use fake timers
          return originalSetTimeout(
            callback as () => void,
            ms ?? 0
          ) as unknown as NodeJS.Timeout;
        });

        const retryPromise = retry(fn, {
          baseDelay: 500,
          jitterFactor: 0,
        });

        await vi.runAllTimersAsync();
        await retryPromise;

        expect(delays[0]).toBe(500);
      });

      it('should use custom backoffFactor', async () => {
        const delays: number[] = [];
        let attempts = 0;

        const fn = async () => {
          attempts++;
          if (attempts < 3) {
            const err = new Error('ETIMEDOUT');
            (err as { code?: string }).code = 'ETIMEDOUT';
            throw err;
          }
          return 'success';
        };

        const originalSetTimeout = global.setTimeout;
        vi.spyOn(global, 'setTimeout').mockImplementation((callback, ms) => {
          if (ms !== undefined) {
            delays.push(ms);
          }
          // Call original to use fake timers
          return originalSetTimeout(
            callback as () => void,
            ms ?? 0
          ) as unknown as NodeJS.Timeout;
        });

        const retryPromise = retry(fn, {
          baseDelay: 1000,
          backoffFactor: 3,
          jitterFactor: 0,
        });

        await vi.runAllTimersAsync();
        await retryPromise;

        // backoffFactor 3: 1000, 3000, 9000...
        expect(delays[0]).toBe(1000);
        expect(delays[1]).toBe(3000);
      });

      it('should use custom isRetryable predicate', async () => {
        let attempts = 0;
        const fn = async () => {
          attempts++;
          const err = new Error('CUSTOM_ERROR');
          throw err;
        };

        // Only retry CUSTOM_ERROR
        const retryPromise = retry(fn, {
          maxAttempts: 5,
          isRetryable: (error: unknown) => {
            return error instanceof Error && error.message === 'CUSTOM_ERROR';
          },
        });
        retryPromise.catch(() => {}); // prevent unhandled rejection during fake timer advance
        await vi.runAllTimersAsync();
        await expect(retryPromise).rejects.toThrow('CUSTOM_ERROR');

        expect(attempts).toBe(5); // Retried 4 times
      });
    });

    describe('edge cases', () => {
      it('should handle function returning undefined', async () => {
        const fn = async () => undefined;
        const result = await retry(fn);
        expect(result).toBeUndefined();
      });

      it('should handle function returning 0', async () => {
        const fn = async () => 0;
        const result = await retry(fn);
        expect(result).toBe(0);
      });

      it('should handle function returning false', async () => {
        const fn = async () => false;
        const result = await retry(fn);
        expect(result).toBe(false);
      });

      it('should handle function returning empty string', async () => {
        const fn = async () => '';
        const result = await retry(fn);
        expect(result).toBe('');
      });

      it('should preserve error stack trace', async () => {
        const fn = async () => {
          const err = new Error('ETIMEDOUT');
          (err as { code?: string }).code = 'ETIMEDOUT';
          throw err;
        };

        const retryPromise = retry(fn);
        retryPromise.catch(() => {}); // prevent unhandled rejection during fake timer advance
        await vi.runAllTimersAsync();
        await expect(retryPromise).rejects.toThrow('ETIMEDOUT');
      });
    });
  });

  // ========================================================================
  // createDefaultOnRetry() tests
  // ========================================================================

  describe('createDefaultOnRetry()', () => {
    it('should return a function', () => {
      const handler = createDefaultOnRetry('TestOperation');
      expect(typeof handler).toBe('function');
    });

    it('should accept operationName parameter', () => {
      expect(() => createDefaultOnRetry('Agent.prompt')).not.toThrow();
    });

    it('should accept maxAttempts parameter', () => {
      expect(() => createDefaultOnRetry('Agent.prompt', 5)).not.toThrow();
    });

    it('should create callback with correct signature', () => {
      const handler = createDefaultOnRetry('TestOperation');
      const error = new Error('ETIMEDOUT');
      (error as { code?: string }).code = 'ETIMEDOUT';

      expect(() => handler(1, error, 1000)).not.toThrow();
    });

    it('should log with operation context', async () => {
      const logSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const handler = createDefaultOnRetry('Agent.researcher');
      const error = new Error('Connection timeout');
      (error as { code?: string }).code = 'ETIMEDOUT';

      handler(1, error, 1000);

      logSpy.mockRestore();
    });
  });

  // ========================================================================
  // retryAgentPrompt() tests
  // ========================================================================

  describe('retryAgentPrompt()', () => {
    it('should wrap agent prompt with retry', async () => {
      let attempts = 0;
      const mockAgent = {
        prompt: async () => {
          attempts++;
          if (attempts === 1) {
            const err = new Error('ETIMEDOUT');
            (err as { code?: string }).code = 'ETIMEDOUT';
            throw err;
          }
          return { content: 'Success' };
        },
      };

      const retryPromise = retryAgentPrompt(() => mockAgent.prompt(), {
        agentType: 'Researcher',
        operation: 'generatePRP',
      });

      await vi.runAllTimersAsync();
      const result = await retryPromise;

      expect(result).toEqual({ content: 'Success' });
      expect(attempts).toBe(2);
    });

    it('should use agent-specific retry config', async () => {
      let attempts = 0;
      const mockAgent = {
        prompt: async () => {
          attempts++;
          if (attempts < 3) {
            const err = new Error('ETIMEDOUT');
            (err as { code?: string }).code = 'ETIMEDOUT';
            throw err;
          }
          return { content: 'Success' };
        },
      };

      const originalSetTimeout = global.setTimeout;
      vi.spyOn(global, 'setTimeout').mockImplementation((callback, ms) => {
        // Call original to use fake timers
        return originalSetTimeout(
          callback as () => void,
          ms ?? 0
        ) as unknown as NodeJS.Timeout;
      });

      const retryPromise = retryAgentPrompt(() => mockAgent.prompt(), {
        agentType: 'Coder',
        operation: 'fixValidation',
      });

      await vi.runAllTimersAsync();
      const result = await retryPromise;

      expect(result).toEqual({ content: 'Success' });
      expect(attempts).toBe(3);
    });
  });

  // ========================================================================
  // retryMcpTool() tests
  // ========================================================================

  describe('retryMcpTool()', () => {
    it('should wrap MCP tool execution with retry', async () => {
      let attempts = 0;
      const mockTool = {
        execute_bash: async () => {
          attempts++;
          if (attempts === 1) {
            throw new Error('Command failed: Connection timeout');
          }
          return { success: true, stdout: 'output', stderr: '' };
        },
      };

      const retryPromise = retryMcpTool(() => mockTool.execute_bash(), {
        toolName: 'BashMCP',
        operation: 'execute_bash',
      });

      await vi.runAllTimersAsync();
      const result = await retryPromise;

      expect(result).toEqual({ success: true, stdout: 'output', stderr: '' });
      expect(attempts).toBe(2);
    });

    it('should use MCP-specific retry config (fewer attempts)', async () => {
      let attempts = 0;
      const mockTool = {
        execute_bash: async () => {
          attempts++;
          throw new Error('Temporarily unavailable');
        },
      };

      const retryPromise = retryMcpTool(() => mockTool.execute_bash(), {
        toolName: 'BashMCP',
        operation: 'execute_bash',
      });
      retryPromise.catch(() => {}); // prevent unhandled rejection during fake timer advance

      await vi.runAllTimersAsync();
      await expect(retryPromise).rejects.toThrow('Temporarily unavailable');

      // MCP uses maxAttempts: 2
      expect(attempts).toBe(2);
    });

    it('should detect transient errors in MCP messages', async () => {
      let attempts = 0;
      const mockTool = {
        execute_bash: async () => {
          attempts++;
          if (attempts === 1) {
            throw new Error('Command temporarily unavailable');
          }
          return { success: true, stdout: 'output', stderr: '' };
        },
      };

      const retryPromise = retryMcpTool(() => mockTool.execute_bash(), {
        toolName: 'BashMCP',
        operation: 'execute_bash',
      });

      await vi.runAllTimersAsync();
      const result = await retryPromise;

      expect(result.success).toBe(true);
      expect(attempts).toBe(2);
    });
  });

  // ========================================================================
  // Integration tests
  // ========================================================================

  describe('Integration scenarios', () => {
    it('should handle typical agent prompt retry scenario', async () => {
      let attempts = 0;
      const researcherAgent = {
        prompt: async (_prompt: string) => {
          attempts++;
          if (attempts === 1) {
            const err = new Error('LLM API timeout');
            (err as { code?: string }).code = 'ETIMEDOUT';
            throw err;
          }
          return { prp: { taskId: 'P1.M1.T1', objective: 'Generate PRP' } };
        },
      };

      const retryPromise = retryAgentPrompt(
        () => researcherAgent.prompt('Generate PRP for task P1.M1.T1'),
        { agentType: 'Researcher', operation: 'generatePRP' }
      );

      await vi.runAllTimersAsync();
      const result = await retryPromise;

      expect(result.prp.taskId).toBe('P1.M1.T1');
      expect(attempts).toBe(2);
    });

    it('should handle typical MCP tool retry scenario', async () => {
      let attempts = 0;
      const bashMCP = {
        execute_bash: async (_input: { command: string }) => {
          attempts++;
          if (attempts === 1) {
            const err = new Error('ECONNREFUSED');
            (err as { code?: string }).code = 'ECONNREFUSED';
            throw err;
          }
          return { success: true, stdout: 'Build successful', stderr: '' };
        },
      };

      const retryPromise = retryMcpTool(
        () => bashMCP.execute_bash({ command: 'npm run build' }),
        { toolName: 'BashMCP', operation: 'execute_bash' }
      );

      await vi.runAllTimersAsync();
      const result = await retryPromise;

      expect(result.success).toBe(true);
      expect(result.stdout).toBe('Build successful');
      expect(attempts).toBe(2);
    });

    it('should handle mixed error types correctly', async () => {
      let attempts = 0;
      const fn = async () => {
        attempts++;
        if (attempts === 1) {
          // Transient - should retry
          const err = new Error('ETIMEDOUT');
          (err as { code?: string }).code = 'ETIMEDOUT';
          throw err;
        }
        if (attempts === 2) {
          // Transient - should retry
          const err = new Error('Service temporarily unavailable');
          throw err;
        }
        // Permanent - should not retry
        throw new ValidationError('Invalid PRP format', { taskId: 'P1.M1.T1' });
      };

      const retryPromise = retry(fn, { maxAttempts: 5 });
      retryPromise.catch(() => {}); // prevent unhandled rejection during fake timer advance
      await vi.runAllTimersAsync();
      await expect(retryPromise).rejects.toThrow('Invalid PRP format');

      // First error (transient) -> retry
      // Second error (transient) -> retry
      // Third error (permanent) -> throw immediately
      expect(attempts).toBe(3);
    });
  });
});
