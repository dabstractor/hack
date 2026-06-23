#!/usr/bin/env tsx
/**
 * z.ai API TypeScript Validation Script
 *
 * Tests z.ai API compatibility with Anthropic's API format.
 * Run with: npx tsx tests/validation/zai-api-test.ts
 *
 * CRITICAL: This script validates z.ai API connectivity only.
 * It will refuse to run if configured to use Anthropic's official API.
 */

import {
  configureEnvironment,
  getModel,
  validateEnvironment,
  EnvironmentValidationError,
} from '../../src/config/environment.js';
import { checkProviderEndpoint } from '../../src/config/endpoint-guard.js';

// ANSI color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  gray: '\x1b[90m',
};

function log(message: string, color: keyof typeof colors = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

// CRITICAL SAFEGUARD: Provider-endpoint guard (PRD §9.2.4) — constrains the
// LLM provider (z.ai), NOT the agent harness. Centralized in endpoint-guard.ts.

// Configure environment before validation
configureEnvironment();

// Validate that the provider endpoint is not Anthropic's official API
const guardResult = checkProviderEndpoint(process.env.ANTHROPIC_BASE_URL ?? '');
if (guardResult.status === 'blocked') {
  log('========================================', 'red');
  log('CRITICAL: Blocked Anthropic provider endpoint!', 'red');
  log('========================================', 'red');
  log(guardResult.message, 'red');
  process.exit(1);
}
if (guardResult.status === 'warning') {
  log(guardResult.message, 'yellow');
}

function success(message: string) {
  log(`✓ ${message}`, 'green');
}

function fail(message: string) {
  log(`✗ ${message}`, 'red');
}

function warn(message: string) {
  log(`⚠ ${message}`, 'yellow');
}

function info(message: string) {
  log(`  ${message}`, 'blue');
}

interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
  details?: Record<string, unknown>;
}

interface AnthropicMessageResponse {
  id?: string;
  type?: string;
  role?: string;
  content?: unknown[];
  model?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

function isAnthropicMessageResponse(
  value: unknown
): value is AnthropicMessageResponse {
  return typeof value === 'object' && value !== null;
}

class ZAiValidator {
  private baseURL: string = '';
  private apiKey: string = '';
  private results: TestResult[] = [];

  constructor() {
    log('\n=== z.ai API TypeScript Validation ===\n', 'blue');
  }

  /**
   * Test 1: Environment Configuration
   */
  async testEnvironmentConfig(): Promise<TestResult> {
    const startTime = Date.now();
    log('1. Testing Environment Configuration', 'blue');
    log('----------------------------------------', 'gray');

    try {
      // Configure environment
      configureEnvironment();

      // Check ANTHROPIC_API_KEY
      if (!process.env.ANTHROPIC_API_KEY) {
        fail('ANTHROPIC_API_KEY not set');
        return {
          name: 'Environment Configuration',
          passed: false,
          duration: Date.now() - startTime,
          error: 'ANTHROPIC_API_KEY not set after configureEnvironment()',
        };
      }
      success('ANTHROPIC_API_KEY is configured');

      // Mask API key for display
      const maskedKey = `${process.env.ANTHROPIC_API_KEY.slice(0, 10)}...`;
      info(`API Key: ${maskedKey}`);

      // Check ANTHROPIC_BASE_URL
      if (!process.env.ANTHROPIC_BASE_URL) {
        fail('ANTHROPIC_BASE_URL not set');
        return {
          name: 'Environment Configuration',
          passed: false,
          duration: Date.now() - startTime,
          error: 'ANTHROPIC_BASE_URL not set',
        };
      }
      success(`ANTHROPIC_BASE_URL: ${process.env.ANTHROPIC_BASE_URL}`);
      this.baseURL = process.env.ANTHROPIC_BASE_URL;

      // Store API key for later tests
      this.apiKey = process.env.ANTHROPIC_API_KEY;

      // Validate environment
      try {
        validateEnvironment();
        success('Environment validation passed');
      } catch (error) {
        if (error instanceof EnvironmentValidationError) {
          fail(`Environment validation failed: ${error.missing.join(', ')}`);
          return {
            name: 'Environment Configuration',
            passed: false,
            duration: Date.now() - startTime,
            error: `Missing variables: ${error.missing.join(', ')}`,
          };
        }
      }

      log('', 'reset');
      return {
        name: 'Environment Configuration',
        passed: true,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      fail(
        `Unexpected error: ${error instanceof Error ? error.message : String(error)}`
      );
      return {
        name: 'Environment Configuration',
        passed: false,
        duration: Date.now() - startTime,
        error: String(error),
      };
    }
  }

  /**
   * Test 2: Model Selection
   */
  async testModelSelection(): Promise<TestResult> {
    const startTime = Date.now();
    log('2. Testing Model Selection', 'blue');
    log('----------------------------', 'gray');

    try {
      const opusModel = getModel('opus');
      const sonnetModel = getModel('sonnet');
      const haikuModel = getModel('haiku');

      info(`Opus model:   ${opusModel}`);
      info(`Sonnet model: ${sonnetModel}`);
      info(`Haiku model:  ${haikuModel}`);

      const checks: boolean[] = [];

      if (opusModel === 'GLM-4.7') {
        success('Opus model is GLM-4.7');
        checks.push(true);
      } else {
        warn(`Opus model is ${opusModel}, expected GLM-4.7`);
        checks.push(false);
      }

      if (sonnetModel === 'GLM-4.7') {
        success('Sonnet model is GLM-4.7');
        checks.push(true);
      } else {
        warn(`Sonnet model is ${sonnetModel}, expected GLM-4.7`);
        checks.push(false);
      }

      if (haikuModel === 'glm-5-turbo') {
        success('Haiku model is glm-5-turbo');
        checks.push(true);
      } else {
        warn(`Haiku model is ${haikuModel}, expected glm-5-turbo`);
        checks.push(false);
      }

      log('', 'reset');
      return {
        name: 'Model Selection',
        passed: checks.every(c => c),
        duration: Date.now() - startTime,
        details: {
          opus: opusModel,
          sonnet: sonnetModel,
          haiku: haikuModel,
        },
      };
    } catch (error) {
      fail(
        `Unexpected error: ${error instanceof Error ? error.message : String(error)}`
      );
      return {
        name: 'Model Selection',
        passed: false,
        duration: Date.now() - startTime,
        error: String(error),
      };
    }
  }

  /**
   * Test 3: Endpoint Connectivity
   */
  async testEndpointConnectivity(): Promise<TestResult> {
    const startTime = Date.now();
    log('3. Testing Endpoint Connectivity', 'blue');
    log('-----------------------------------', 'gray');

    try {
      info(`Testing: ${this.baseURL}`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(this.baseURL, {
        method: 'HEAD',
        signal: controller.signal,
      }).finally(() => clearTimeout(timeoutId));

      info(`HTTP Status: ${response.status}`);

      if (response.ok || response.status === 405 || response.status === 401) {
        success('Endpoint is reachable');
        log('', 'reset');
        return {
          name: 'Endpoint Connectivity',
          passed: true,
          duration: Date.now() - startTime,
          details: { status: response.status },
        };
      } else {
        warn(`Endpoint returned unusual status: ${response.status}`);
        log('', 'reset');
        return {
          name: 'Endpoint Connectivity',
          passed: false,
          duration: Date.now() - startTime,
          error: `HTTP ${response.status}`,
        };
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        fail('Request timeout (10s)');
      } else {
        fail(
          `Connection error: ${error instanceof Error ? error.message : String(error)}`
        );
      }
      log('', 'reset');
      return {
        name: 'Endpoint Connectivity',
        passed: false,
        duration: Date.now() - startTime,
        error: String(error),
      };
    }
  }

  /**
   * Test 4: Message API with GLM-4.7
   */
  async testMessageAPI(): Promise<TestResult> {
    const startTime = Date.now();
    log('4. Testing /v1/messages Endpoint', 'blue');
    log('---------------------------------', 'gray');

    try {
      const url = `${this.baseURL}/v1/messages`;
      info(`POST ${url}`);

      const requestBody = {
        model: 'GLM-4.7',
        max_tokens: 10,
        messages: [
          {
            role: 'user',
            content: 'Say OK if you receive this',
          },
        ],
      };

      info('Request body:');
      info(
        JSON.stringify(requestBody, null, 2)
          .split('\n')
          .map(l => `  ${l}`)
          .join('\n')
      );

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      }).finally(() => clearTimeout(timeoutId));

      info(`HTTP Status: ${response.status}`);

      const responseBody: unknown = await response.json();
      info('Response body:');
      info(
        JSON.stringify(responseBody, null, 2)
          .split('\n')
          .map(l => `  ${l}`)
          .join('\n')
      );

      if (!response.ok) {
        fail(`API request failed with HTTP ${response.status}`);
        log('', 'reset');
        return {
          name: 'Message API (GLM-4.7)',
          passed: false,
          duration: Date.now() - startTime,
          error: `HTTP ${response.status}: ${JSON.stringify(responseBody)}`,
        };
      }

      // Validate response structure
      const checks: boolean[] = [];

      if (isAnthropicMessageResponse(responseBody)) {
        if (responseBody.id) {
          success('Response contains "id" field (Anthropic-compatible)');
          checks.push(true);
        } else {
          warn('Response missing "id" field');
          checks.push(false);
        }

        if (responseBody.type === 'message') {
          success('Response type is "message"');
          checks.push(true);
        } else {
          warn(
            `Response type is "${String(responseBody.type ?? 'undefined')}", expected "message"`
          );
          checks.push(false);
        }

        if (responseBody.role === 'assistant') {
          success('Response role is "assistant"');
          checks.push(true);
        } else {
          warn(
            `Response role is "${String(responseBody.role ?? 'undefined')}", expected "assistant"`
          );
          checks.push(false);
        }

        if (responseBody.content && Array.isArray(responseBody.content)) {
          success('Response contains "content" array');
          checks.push(true);

          // Extract text content
          const textContent = responseBody.content
            .filter(
              (c: unknown) =>
                typeof c === 'object' &&
                c !== null &&
                'type' in c &&
                c.type === 'text'
            )
            .map((c: unknown) =>
              typeof c === 'object' && c !== null && 'text' in c
                ? String(c.text)
                : ''
            )
            .join('');

          if (textContent) {
            success(`Assistant response: "${textContent}"`);
          }
        } else {
          warn('Response missing or invalid "content" field');
          checks.push(false);
        }

        if (responseBody.model) {
          success(`Response model: ${responseBody.model}`);
          checks.push(true);
        } else {
          warn('Response missing "model" field');
          checks.push(false);
        }

        if (responseBody.usage) {
          success('Response contains "usage" field');
          info(`  Input tokens: ${responseBody.usage.input_tokens ?? 'N/A'}`);
          info(`  Output tokens: ${responseBody.usage.output_tokens ?? 'N/A'}`);
          checks.push(true);
        } else {
          warn('Response missing "usage" field');
          checks.push(false);
        }
      } else {
        fail('Response body is not a valid object');
        checks.push(false);
      }

      log('', 'reset');
      return {
        name: 'Message API (GLM-4.7)',
        passed: checks.every(c => c),
        duration: Date.now() - startTime,
        details: { response: responseBody },
      };
    } catch (error) {
      fail(
        `Request failed: ${error instanceof Error ? error.message : String(error)}`
      );
      log('', 'reset');
      return {
        name: 'Message API (GLM-4.7)',
        passed: false,
        duration: Date.now() - startTime,
        error: String(error),
      };
    }
  }

  /**
   * Test 5: anthropic-version Header
   */
  async testAnthropicVersionHeader(): Promise<TestResult> {
    const startTime = Date.now();
    log('5. Testing anthropic-version Header', 'blue');
    log('----------------------------------', 'gray');

    try {
      const url = `${this.baseURL}/v1/messages`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'GLM-4.7',
          max_tokens: 5,
          messages: [{ role: 'user', content: 'test' }],
        }),
        signal: controller.signal,
      }).finally(() => clearTimeout(timeoutId));

      info(`HTTP Status: ${response.status}`);

      if (response.ok) {
        success('Request with anthropic-version header succeeded');
        log('', 'reset');
        return {
          name: 'anthropic-version Header',
          passed: true,
          duration: Date.now() - startTime,
        };
      } else {
        warn(`Request returned HTTP ${response.status}`);
        info('Note: z.ai may not require this header');
        log('', 'reset');
        return {
          name: 'anthropic-version Header',
          passed: true, // Not failing, just informational
          duration: Date.now() - startTime,
          details: { status: response.status },
        };
      }
    } catch (error) {
      warn(
        `Request failed: ${error instanceof Error ? error.message : String(error)}`
      );
      info('This may indicate z.ai does not support this header');
      log('', 'reset');
      return {
        name: 'anthropic-version Header',
        passed: true,
        duration: Date.now() - startTime,
        error: String(error),
      };
    }
  }

  /**
   * Test 6: Error Handling
   */
  async testErrorHandling(): Promise<TestResult> {
    const startTime = Date.now();
    log('6. Testing Error Handling', 'blue');
    log('--------------------------', 'gray');

    const checks: boolean[] = [];

    // Test invalid model
    info('Test 6a: Invalid model name');
    try {
      const response = await fetch(`${this.baseURL}/v1/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'invalid-model-name',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'test' }],
        }),
      });

      if (
        response.status === 400 ||
        response.status === 404 ||
        response.status === 500
      ) {
        success(`Invalid model returns error (HTTP ${response.status})`);
        checks.push(true);
      } else {
        warn(`Invalid model returned unexpected status: ${response.status}`);
        checks.push(false);
      }
    } catch (error) {
      warn(
        `Error testing invalid model: ${error instanceof Error ? error.message : String(error)}`
      );
      checks.push(false);
    }

    // Test invalid API key
    info('');
    info('Test 6b: Invalid API key');
    try {
      const response = await fetch(`${this.baseURL}/v1/messages`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer invalid-key-12345',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'GLM-4.7',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'test' }],
        }),
      });

      if (response.status === 401 || response.status === 403) {
        success(`Invalid API key returns auth error (HTTP ${response.status})`);
        checks.push(true);
      } else {
        warn(`Invalid API key returned unexpected status: ${response.status}`);
        checks.push(false);
      }
    } catch (error) {
      warn(
        `Error testing invalid API key: ${error instanceof Error ? error.message : String(error)}`
      );
      checks.push(false);
    }

    log('', 'reset');
    return {
      name: 'Error Handling',
      passed: checks.every(c => c),
      duration: Date.now() - startTime,
    };
  }

  /**
   * Run all validation tests
   */
  async runAll(): Promise<void> {
    const overallStart = Date.now();

    // Test 1: Environment Configuration
    const envResult = await this.testEnvironmentConfig();
    this.results.push(envResult);

    if (!envResult.passed) {
      log(
        '\n❌ Environment configuration failed. Aborting remaining tests.\n',
        'red'
      );
      this.printSummary(overallStart);
      process.exit(1);
    }

    // Test 2: Model Selection
    const modelResult = await this.testModelSelection();
    this.results.push(modelResult);

    // Test 3: Endpoint Connectivity
    const connectivityResult = await this.testEndpointConnectivity();
    this.results.push(connectivityResult);

    if (!connectivityResult.passed) {
      log(
        '\n❌ Endpoint connectivity failed. Aborting remaining tests.\n',
        'red'
      );
      this.printSummary(overallStart);
      process.exit(1);
    }

    // Test 4: Message API
    const messageResult = await this.testMessageAPI();
    this.results.push(messageResult);

    // Test 5: anthropic-version Header
    const versionResult = await this.testAnthropicVersionHeader();
    this.results.push(versionResult);

    // Test 6: Error Handling
    const errorResult = await this.testErrorHandling();
    this.results.push(errorResult);

    // Print summary
    this.printSummary(overallStart);
  }

  /**
   * Print test summary
   */
  private printSummary(overallStart: number): void {
    log('\n========================================', 'blue');
    log('Validation Summary', 'blue');
    log('========================================', 'blue');
    log('', 'reset');

    const totalTests = this.results.length;
    const passedTests = this.results.filter(r => r.passed).length;
    const failedTests = totalTests - passedTests;

    this.results.forEach(result => {
      if (result.passed) {
        success(`${result.name} (${result.duration}ms)`);
      } else {
        fail(`${result.name} (${result.duration}ms)`);
        if (result.error) {
          info(`  Error: ${result.error}`);
        }
      }
    });

    log('', 'reset');
    log(`Total Tests: ${totalTests}`, 'blue');
    log(`Passed: ${passedTests}`, 'green');
    log(`Failed: ${failedTests}`, failedTests > 0 ? 'red' : 'gray');
    log(`Duration: ${Date.now() - overallStart}ms`, 'blue');
    log('', 'reset');

    if (failedTests > 0) {
      log('\n❌ Some validation tests failed.\n', 'red');
      log('Review the errors above and ensure:', 'red');
      log('  1. ANTHROPIC_AUTH_TOKEN is set correctly', 'gray');
      log('  2. ANTHROPIC_BASE_URL is correct', 'gray');
      log('  3. z.ai API is accessible from your network', 'gray');
      log('  4. Models GLM-4.7 and glm-5-turbo are available', 'gray');
      log('', 'reset');
      process.exit(1);
    } else {
      log('\n✅ All validation tests passed!\n', 'green');
      log('Your z.ai API configuration is working correctly.', 'green');
      log('You can now proceed with creating Groundswell agents.\n', 'green');
    }
  }
}

// Run validation
const validator = new ZAiValidator();
validator.runAll().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
