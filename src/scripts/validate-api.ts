#!/usr/bin/env tsx
/**
 * z.ai API Validation Script
 *
 * Validates API configuration and connectivity for z.ai/Anthropic API
 *
 * @example
 * ```bash
 * npx tsx src/scripts/validate-api.ts
 * ```
 *
 * @exitcode 0 All validations passed
 * @exitcode 1 Validation failed
 */

// ============================================================================
// IMPORTS
// ============================================================================

import {
  configureEnvironment,
  validateEnvironment,
  getModel,
} from '../config/environment.js';
import { checkProviderEndpoint } from '../config/endpoint-guard.js';

// ============================================================================
// LOGGING UTILITIES
// ============================================================================

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
} as const;

const log = {
  info: (msg: string) => console.log(`${colors.blue}ℹ${colors.reset} ${msg}`),
  success: (msg: string) =>
    console.log(`${colors.green}✓${colors.reset} ${msg}`),
  error: (msg: string) => console.error(`${colors.red}✗${colors.reset} ${msg}`),
  warn: (msg: string) => console.log(`${colors.yellow}⚠${colors.reset} ${msg}`),
  section: (msg: string) =>
    console.log(`\n${colors.bright}${msg}${colors.reset}`),
};

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface ValidationResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
  data?: unknown;
}

interface MessageResponse {
  id: string;
  type: string;
  role: 'assistant';
  content: Array<{ type: string; text: string }>;
  model: string;
  stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence';
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

// Type guard for MessageResponse
function isValidMessageResponse(data: unknown): data is MessageResponse {
  if (typeof data !== 'object' || data === null) return false;
  const response = data as Record<string, unknown>;
  return (
    typeof response.id === 'string' &&
    typeof response.type === 'string' &&
    response.role === 'assistant' &&
    Array.isArray(response.content) &&
    typeof response.model === 'string' &&
    typeof response.stop_reason === 'string' &&
    typeof response.usage === 'object' &&
    response.usage !== null
  );
}

// ============================================================================
// CONFIGURATION
// ============================================================================

// CRITICAL SAFEGUARD: Provider-endpoint guard (PRD §9.2.4) — constrains the
// LLM provider (z.ai), NOT the agent harness. Centralized in endpoint-guard.ts.

// Must call configureEnvironment() BEFORE accessing ANTHROPIC_API_KEY
// Shell uses ANTHROPIC_AUTH_TOKEN, but SDK expects ANTHROPIC_API_KEY
configureEnvironment();

// Validate that the provider endpoint is not Anthropic's official API
const endpointResult = checkProviderEndpoint(
  process.env.ANTHROPIC_BASE_URL ?? ''
);
if (endpointResult.status === 'blocked') {
  log.error(endpointResult.message);
  process.exit(1);
}
if (endpointResult.status === 'warning') {
  log.warn(endpointResult.message);
}

let apiKey: string;
let baseURL: string;

// ============================================================================
// FETCH WITH TIMEOUT
// ============================================================================

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeoutMs}ms`);
    }
    throw error;
  }
}

// ============================================================================
// TEST 1: Environment Configuration Validation
// ============================================================================

async function testEnvironmentConfig(): Promise<ValidationResult> {
  const startTime = Date.now();

  try {
    // Validate environment variables
    validateEnvironment();

    // Get configuration values
    apiKey = process.env.ANTHROPIC_API_KEY!;
    baseURL = process.env.ANTHROPIC_BASE_URL!;

    // Display configuration (with redacted API key)
    const maskedKey = apiKey.slice(0, 10) + '...';
    log.info(`API Key: ${maskedKey}`);
    log.info(`Base URL: ${baseURL}`);
    log.info(`Model: ${getModel('sonnet')}`);

    return {
      name: 'Environment Configuration',
      passed: true,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error(errorMsg);
    return {
      name: 'Environment Configuration',
      passed: false,
      duration: Date.now() - startTime,
      error: errorMsg,
    };
  }
}

// ============================================================================
// TEST 2: Endpoint Availability
// ============================================================================

async function testEndpointAvailability(): Promise<ValidationResult> {
  const startTime = Date.now();

  try {
    // Test 1: GET request to BASE_URL (root endpoint)
    log.info(`Testing root endpoint: ${baseURL}`);
    const rootResponse = await fetchWithTimeout(
      baseURL,
      {
        method: 'GET',
      },
      10000
    );

    log.info(`Root endpoint status: ${rootResponse.status}`);

    // Test 2: HEAD request to /v1/messages
    const messagesEndpoint = `${baseURL}/v1/messages`;
    log.info(`Testing messages endpoint: ${messagesEndpoint}`);
    const messagesResponse = await fetchWithTimeout(
      messagesEndpoint,
      {
        method: 'HEAD',
      },
      10000
    );

    log.info(`Messages endpoint status: ${messagesResponse.status}`);

    // Check if endpoints are reachable (allow 405 Method Not Allowed for HEAD requests)
    const rootReachable =
      rootResponse.ok ||
      rootResponse.status === 401 ||
      rootResponse.status === 405;
    const messagesReachable =
      messagesResponse.ok ||
      messagesResponse.status === 401 ||
      messagesResponse.status === 405;

    if (rootReachable && messagesReachable) {
      // Convert Headers to a plain object for logging
      const headersObj: Record<string, string> = {};
      messagesResponse.headers.forEach((value, key) => {
        headersObj[key] = value;
      });
      log.info(`Response headers: ${JSON.stringify(headersObj, null, 2)}`);
      return {
        name: 'Endpoint Availability',
        passed: true,
        duration: Date.now() - startTime,
        data: {
          rootStatus: rootResponse.status,
          messagesStatus: messagesResponse.status,
        },
      };
    }

    throw new Error(
      `Endpoints not reachable. Root: ${rootResponse.status}, Messages: ${messagesResponse.status}`
    );
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error(errorMsg);
    return {
      name: 'Endpoint Availability',
      passed: false,
      duration: Date.now() - startTime,
      error: errorMsg,
    };
  }
}

// ============================================================================
// TEST 3: Authentication
// ============================================================================

async function testAuthentication(): Promise<ValidationResult> {
  const startTime = Date.now();

  try {
    const url = `${baseURL}/v1/messages`;
    const model = getModel('sonnet');

    const payload = {
      model,
      max_tokens: 10,
      messages: [
        {
          role: 'user',
          content: 'Respond with just "OK"',
        },
      ],
    };

    log.info(`Sending authentication test to: ${url}`);

    const response = await fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
      },
      30000
    );

    log.info(`Response status: ${response.status}`);

    // Check for authentication failures
    if (response.status === 401) {
      throw new Error('Authentication failed: Invalid API key (401)');
    }
    if (response.status === 403) {
      throw new Error('Authentication failed: Access forbidden (403)');
    }

    // Any other status means authentication headers were accepted
    return {
      name: 'Authentication',
      passed: true,
      duration: Date.now() - startTime,
      data: { status: response.status },
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error(errorMsg);
    return {
      name: 'Authentication',
      passed: false,
      duration: Date.now() - startTime,
      error: errorMsg,
    };
  }
}

// ============================================================================
// TEST 4: Message Completion
// ============================================================================

async function testMessageCompletion(): Promise<ValidationResult> {
  const startTime = Date.now();

  try {
    const url = `${baseURL}/v1/messages`;
    const model = getModel('sonnet');

    const payload = {
      model,
      max_tokens: 10,
      messages: [
        {
          role: 'user',
          content: 'Respond with just "OK"',
        },
      ],
    };

    log.info(`Sending message completion request to: ${url}`);
    log.info(`Model: ${model}`);

    const response = await fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
      },
      30000
    );

    log.info(`Response status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    // Parse and validate response
    const data: unknown = await response.json();

    // Log response format for analysis
    log.section('Response Format:');
    console.log(JSON.stringify(data, null, 2));

    // Validate response structure
    if (!isValidMessageResponse(data)) {
      throw new Error(
        'Response structure does not match expected Anthropic format'
      );
    }

    // Validate required fields
    if (!data.id) {
      throw new Error('Response missing id field');
    }
    if (!data.content || !Array.isArray(data.content)) {
      throw new Error('Response missing content array');
    }
    if (data.role !== 'assistant') {
      throw new Error(`Unexpected role: ${data.role}`);
    }

    // Extract and display the assistant's response
    const textContent = data.content
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('');

    log.success(`Assistant response: "${textContent}"`);

    // Display usage statistics
    if (data.usage) {
      log.info(`Input tokens: ${data.usage.input_tokens}`);
      log.info(`Output tokens: ${data.usage.output_tokens}`);
    }

    // Log response headers
    const headersObj: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headersObj[key] = value;
    });
    log.info(`Response headers: ${JSON.stringify(headersObj, null, 2)}`);

    return {
      name: 'Message Completion',
      passed: true,
      duration: Date.now() - startTime,
      data: {
        id: data.id,
        model: data.model,
        stopReason: data.stop_reason,
        usage: data.usage,
        textContent,
      },
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error(errorMsg);
    return {
      name: 'Message Completion',
      passed: false,
      duration: Date.now() - startTime,
      error: errorMsg,
    };
  }
}

// ============================================================================
// MAIN FUNCTION
// ============================================================================

async function main(): Promise<void> {
  try {
    log.section('=== z.ai API Validation ===\n');

    // Step 1: Environment Configuration
    log.info('Validating environment configuration...');
    const envResult = await testEnvironmentConfig();
    if (!envResult.passed) {
      throw new Error(`Environment configuration failed: ${envResult.error}`);
    }
    log.success(`Environment configured (${envResult.duration}ms)\n`);

    // Step 2: Endpoint Availability
    log.info('Testing endpoint availability...');
    const endpointResult = await testEndpointAvailability();
    if (!endpointResult.passed) {
      throw new Error(
        `Endpoint availability test failed: ${endpointResult.error}`
      );
    }
    log.success(`Endpoint available (${endpointResult.duration}ms)\n`);

    // Step 3: Authentication
    log.info('Testing authentication...');
    const authResult = await testAuthentication();
    if (!authResult.passed) {
      throw new Error(`Authentication test failed: ${authResult.error}`);
    }
    log.success(`Authentication successful (${authResult.duration}ms)\n`);

    // Step 4: Message Completion
    log.info('Testing message completion...');
    const completionResult = await testMessageCompletion();
    if (!completionResult.passed) {
      throw new Error(
        `Message completion test failed: ${completionResult.error}`
      );
    }
    log.success(`Message completion working (${completionResult.duration}ms)`);

    // All tests passed
    log.section('\n=== All Validations Passed ===');
    log.success('z.ai API is working correctly!');
    log.info('You can now proceed with Groundswell agent implementation.\n');

    process.exit(0);
  } catch (error) {
    log.section('\n=== Validation Failed ===');
    if (error instanceof Error) {
      log.error(error.message);
    } else {
      log.error('Unknown error occurred');
    }
    process.exit(1);
  }
}

// ============================================================================
// PROCESS ERROR HANDLERS
// ============================================================================

process.on('unhandledRejection', reason => {
  log.error(`Unhandled rejection: ${reason}`);
  process.exit(1);
});

process.on('uncaughtException', error => {
  log.error(`Uncaught exception: ${error.message}`);
  process.exit(1);
});

process.on('SIGINT', () => {
  log.warn('\nReceived SIGINT, exiting...');
  process.exit(130); // 128 + 2 (SIGINT)
});

// ============================================================================
// INVOKE MAIN
// ============================================================================

await main();
