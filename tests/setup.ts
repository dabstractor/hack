/**
 * Vitest global setup file
 *
 * @remarks
 * Configures global test hooks for mock cleanup and memory management.
 * This file runs before all test files and provides automatic cleanup.
 *
 * CRITICAL: All tests MUST use z.ai API endpoint, never Anthropic's official API.
 * This is enforced at the global test setup level.
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { beforeEach, afterEach, vi } from 'vitest';
import { validateProviderEndpoint } from '../src/config/endpoint-guard.js';

// =============================================================================
// LOAD .env FILE (if exists, otherwise use existing environment)
// =============================================================================

try {
  await import('dotenv').then(({ default: dotenv }) => {
    // Try to load .env file, but don't fail if it doesn't exist
    const result = dotenv.config({ quiet: true });
    if (result.error) {
      // .env file doesn't exist or can't be read - use existing environment
      console.debug('No .env file found, using existing environment variables');
    } else {
      console.debug('.env file loaded successfully');
    }
  });
} catch {
  // dotenv not installed - use existing environment variables
  console.debug('dotenv not available, using existing environment variables');
}

// =============================================================================
// z.ai API SAFEGUARD
// =============================================================================

/**
 * Validate that tests are configured to use z.ai, NOT Anthropic's API
 *
 * @remarks
 * This safeguard prevents accidental usage of Anthropic's official API
 * during testing. All tests must use the z.ai proxy endpoint.
 *
 * Allowed endpoints (z.ai):
 * - https://api.z.ai/api/anthropic
 *
 * Blocked endpoints (Anthropic):
 * - https://api.anthropic.com
 * - https://api.anthropic.com/v1
 * - http://api.anthropic.com (any protocol variant)
 * - api.anthropic.com (any domain match)
 */
function validateApiEndpoint(): void {
  // Delegate to the centralized provider-endpoint guard (PRD §9.2.4).
  // Throws on Anthropic endpoints (same semantics as before);
  // warns on non-z.ai endpoints.
  validateProviderEndpoint();
}

// Run validation immediately when test setup loads
validateApiEndpoint();

// =============================================================================
// PROMISE REJECTION TRACKING
// =============================================================================

/**
 * Track unhandled promise rejections during test execution
 *
 * @remarks
 * This module-level state tracks unhandled promise rejections that occur
 * during each test. The beforeEach hook resets this array and attaches a
 * listener to capture rejections. The afterEach hook checks for any
 * captured rejections and fails the test if any were found.
 *
 * This prevents PromiseRejectionHandledWarning messages from cluttering
 * test output and ensures all async operations have proper error handling.
 */
let unhandledRejections: unknown[] = [];

/**
 * Handler for unhandled promise rejections
 *
 * @remarks
 * Captures rejection reasons for validation in afterEach. This handler
 * is attached in beforeEach and removed in afterEach to ensure proper
 * cleanup and isolation between tests.
 */
let unhandledRejectionHandler: ((reason: unknown) => void) | null = null;

// =============================================================================
// GLOBAL TEST HOOKS
// =============================================================================

/**
 * Before each test - clear mock call histories and validate API endpoint
 *
 * @remarks
 * Clears all mock call histories while preserving mock implementations.
 * This ensures test isolation without requiring mock re-definition.
 * Also validates that tests haven't been configured to use Anthropic API.
 */
beforeEach(() => {
  // CLEANUP: Clear all mock call histories before each test
  // This prevents mock calls from bleeding between tests
  vi.clearAllMocks();

  // SAFEGUARD: Validate API endpoint before each test
  // This catches any environment changes during test runs
  validateApiEndpoint();

  // REJECTION TRACKING: Reset unhandled rejections array and attach handler
  // This captures any promise rejections that occur during test execution
  unhandledRejections = [];

  unhandledRejectionHandler = (reason: unknown) => {
    unhandledRejections.push(reason);
  };

  process.on('unhandledRejection', unhandledRejectionHandler);
});

/**
 * After each test - clean up environment and memory
 *
 * @remarks
 * Restores environment variables and forces garbage collection if available.
 * This prevents memory leaks and ensures clean state for next test.
 */
afterEach(() => {
  // REJECTION TRACKING: Clean up handler and check for unhandled rejections
  // This ensures we catch any promise rejections that weren't properly handled
  if (unhandledRejectionHandler) {
    process.removeListener('unhandledRejection', unhandledRejectionHandler);
    unhandledRejectionHandler = null;
  }

  // REJECTION TRACKING: Fail test if there were unhandled rejections
  // Only fail if the test itself hasn't already failed (prevents confusing errors)
  if (unhandledRejections.length > 0) {
    const errorMessages = unhandledRejections
      .map(r => (r instanceof Error ? r.message : String(r)))
      .join('; ');

    // Format rejection details for debugging
    const rejectionDetails = unhandledRejections
      .map((r, i) => {
        if (r instanceof Error) {
          return `  [${i + 1}] ${r.name}: ${r.message}`;
        }
        return `  [${i + 1}] ${String(r)}`;
      })
      .join('\n');

    throw new Error(
      `Test had ${unhandledRejections.length} unhandled promise rejection(s):\n${rejectionDetails}\n\nCombined: ${errorMessages}`
    );
  }

  // CLEANUP: Restore all environment variable stubs
  // This prevents environment variable leaks between tests
  vi.unstubAllEnvs();

  // CLEANUP: Force garbage collection if available
  // Requires Node.js to be started with --expose-gc flag
  // This helps manage memory in long-running test suites
  if (typeof global.gc === 'function') {
    global.gc();
  }
});
