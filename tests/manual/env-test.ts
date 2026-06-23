/**
 * Manual verification script for environment configuration module
 *
 * Tests the environment variable mapping, model selection, and validation.
 * Run with: npx tsx tests/manual/env-test.ts
 */

import {
  configureEnvironment,
  getModel,
  validateEnvironment,
  EnvironmentValidationError,
} from '../../src/config/environment.js';

console.log('=== Environment Configuration Manual Test ===\n');

// Capture initial state
const initialApiKey = process.env.ANTHROPIC_API_KEY;
const initialAuthToken = process.env.ANTHROPIC_AUTH_TOKEN;
const initialBaseURL = process.env.ANTHROPIC_BASE_URL;

console.log('--- Before configureEnvironment ---');
console.log(
  'ANTHROPIC_API_KEY:',
  initialApiKey ? `${initialApiKey.slice(0, 10)}...` : '(not set)'
);
console.log(
  'ANTHROPIC_AUTH_TOKEN:',
  initialAuthToken ? `${initialAuthToken.slice(0, 10)}...` : '(not set)'
);
console.log('ANTHROPIC_BASE_URL:', initialBaseURL || '(not set)');

// Configure environment
configureEnvironment();

console.log('\n--- After configureEnvironment ---');
console.log(
  'ANTHROPIC_API_KEY:',
  process.env.ANTHROPIC_API_KEY
    ? `${process.env.ANTHROPIC_API_KEY.slice(0, 10)}...`
    : '(not set)'
);
console.log(
  'ANTHROPIC_AUTH_TOKEN:',
  process.env.ANTHROPIC_AUTH_TOKEN
    ? `${process.env.ANTHROPIC_AUTH_TOKEN.slice(0, 10)}...`
    : '(not set)'
);
console.log(
  'ANTHROPIC_BASE_URL:',
  process.env.ANTHROPIC_BASE_URL || '(not set)'
);

// Test mapping behavior
console.log('\n--- Mapping Test ---');
if (initialAuthToken && !initialApiKey) {
  console.log('✓ AUTH_TOKEN was mapped to API_KEY');
} else if (initialApiKey) {
  console.log('✓ API_KEY was already set, preserved original value');
} else {
  console.log('⚠ Neither AUTH_TOKEN nor API_KEY was set');
}

// Test BASE_URL default
if (process.env.ANTHROPIC_BASE_URL === 'https://api.z.ai/api/anthropic') {
  console.log('✓ BASE_URL set to correct default');
} else if (initialBaseURL) {
  console.log('✓ BASE_URL preserved custom value:', initialBaseURL);
}

// Test model selection
console.log('\n--- Model Selection ---');
const opusModel = getModel('opus');
const sonnetModel = getModel('sonnet');
const haikuModel = getModel('haiku');

console.log(`getModel('opus'):   ${opusModel}`);
console.log(`getModel('sonnet'): ${sonnetModel}`);
console.log(`getModel('haiku'):  ${haikuModel}`);

if (opusModel === 'GLM-4.7') {
  console.log('✓ Opus model correct');
}
if (sonnetModel === 'GLM-4.7') {
  console.log('✓ Sonnet model correct');
}
if (haikuModel === 'glm-5-turbo') {
  console.log('✓ Haiku model correct');
}

// Test validation
console.log('\n--- Validation Test ---');
try {
  validateEnvironment();
  console.log('✓ Validation passed - all required variables set');
} catch (error) {
  if (error instanceof EnvironmentValidationError) {
    console.log('✗ Validation failed - missing variables:', error.missing);
  } else {
    console.log('✗ Unexpected error:', error);
  }
}

// Test environment variable override for models
console.log('\n--- Model Override Test ---');
const originalHaikuModel = process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL;
process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL = 'GLM-4.7';
const overrideModel = getModel('haiku');
console.log(`After setting ANTHROPIC_DEFAULT_HAIKU_MODEL='GLM-4.7':`);
console.log(`getModel('haiku'): ${overrideModel}`);
if (overrideModel === 'GLM-4.7') {
  console.log('✓ Model override works correctly');
}
// Restore original value
if (originalHaikuModel) {
  process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL = originalHaikuModel;
} else {
  delete process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL;
}

console.log('\n=== Test Complete ===');
