/**
 * Provider-endpoint guard module (PRD §9.2.4)
 *
 * @remarks
 * Centralizes the API-endpoint safeguard that constrains the **LLM provider**
 * (z.ai), NOT the agent harness. The pi harness is provider-neutral; the
 * pipeline defaults to pi + zai. This module is the single source of truth
 * for the guard logic and messaging — consumed by scripts, tests/setup.ts,
 * and unit tests.
 *
 * @module config/endpoint-guard
 */

export const ZAI_ENDPOINT = 'https://api.z.ai/api/anthropic' as const;

export const BLOCKED_ENDPOINT_PATTERNS = [
  'https://api.anthropic.com',
  'http://api.anthropic.com',
  'api.anthropic.com',
] as const;

export type EndpointCheckStatus = 'allowed' | 'blocked' | 'warning';

export interface EndpointCheckResult {
  readonly status: EndpointCheckStatus;
  readonly message: string;
}

function isMockEndpoint(url: string): boolean {
  return (
    url.includes('localhost') ||
    url.includes('127.0.0.1') ||
    url.includes('mock') ||
    url.includes('test')
  );
}

/**
 * Pure predicate over the LLM **provider** endpoint (PRD §9.2.4).
 *
 * @remarks
 * Orthogonal to the agent harness — does NOT read PRP_AGENT_HARNESS.
 * Returns an `EndpointCheckResult` whose status is one of:
 * - `'allowed'` — empty, z.ai, or localhost/mock/test
 * - `'blocked'` — matches a BLOCKED_ENDPOINT_PATTERNS entry (Anthropic official API)
 * - `'warning'` — any other non-empty, non-z.ai, non-mock URL
 */
export function checkProviderEndpoint(baseUrl: string): EndpointCheckResult {
  // 1) Blocked: Anthropic official API (any protocol variant)
  if (BLOCKED_ENDPOINT_PATTERNS.some(p => baseUrl.includes(p))) {
    return {
      status: 'blocked',
      message: [
        `LLM provider endpoint safeguard (PRD §9.2.4): ` +
          `ANTHROPIC_BASE_URL "${baseUrl}" points at Anthropic's official API, ` +
          `which is blocked.`,
        `This constrains the LLM PROVIDER (z.ai), not the agent harness — ` +
          `the pi harness is provider-neutral and the pipeline defaults to pi + zai.`,
        `Expected provider endpoint: ${ZAI_ENDPOINT}.`,
      ].join(' '),
    };
  }

  // 2) Allowed: unset, z.ai, or localhost/mock/test
  if (baseUrl === '' || baseUrl === ZAI_ENDPOINT || isMockEndpoint(baseUrl)) {
    return { status: 'allowed', message: '' };
  }

  // 3) Warning: any other non-z.ai endpoint
  return {
    status: 'warning',
    message:
      `LLM provider endpoint safeguard (PRD §9.2.4): non-z.ai PROVIDER endpoint ` +
      `"${baseUrl}" detected. This constrains the LLM provider, not the agent ` +
      `harness. Recommended provider endpoint: ${ZAI_ENDPOINT}.`,
  };
}

/**
 * Reads `process.env.ANTHROPIC_BASE_URL` by default; throws on `'blocked'`,
 * `console.warn`s on `'warning'`. Used by tests/setup.ts and test suites.
 *
 * @remarks
 * Consumes the existing `ANTHROPIC_BASE_URL` env var — no new env vars introduced.
 * The thrown `Error(message)` semantics are preserved 1:1 so the global test-time
 * guard in tests/setup.ts behaves identically to the previous inline implementation.
 */
export function validateProviderEndpoint(
  baseUrl: string = process.env.ANTHROPIC_BASE_URL ?? ''
): void {
  const result = checkProviderEndpoint(baseUrl);

  if (result.status === 'blocked') {
    throw new Error(result.message);
  }

  if (result.status === 'warning') {
    console.warn(result.message);
  }
}
