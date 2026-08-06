/**
 * Regression test for the "Theme not initialized" pipeline crash.
 *
 * @remarks
 * pi's tool renderers (bash/read/write/edit/grep/ls/find) and agent-session read the
 * lazily-backed `theme` proxy exported from `@earendil-works/pi-coding-agent`, which
 * throws `"Theme not initialized. Call initTheme() first."` until `initTheme()` has
 * populated the Symbol-keyed globalThis slot the proxy reads. Groundswell's headless
 * `PiHarness` drives the SDK without ever calling `initTheme()`, so without an explicit
 * call every coder-agent tool invocation throws an unhandled promise rejection
 * mid-pipeline — which surfaced as RESEARCH_TIMEOUT blowups and unparseable agent
 * output (task failures).
 *
 * `ensureHarnessInitialized()` (src/config/harness.ts) now calls `initTheme()` before
 * any agent can run. These tests mock only groundswell's registry (so the heavy
 * `initializeProvider` SDK import is a no-op) and assert the REAL observable effect:
 * after `ensureHarnessInitialized()`, pi's global theme slot is populated — i.e. the
 * `theme` proxy will no longer throw.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The exact globalThis Symbol key pi's `theme` proxy reads (theme.js). */
const THEME_KEY = Symbol.for('@earendil-works/pi-coding-agent:theme');

// CRITICAL: groundswell mock is REQUIRED because harness.ts imports groundswell at module
// level. `initializeProvider` is stubbed to a no-op so the real SDK import is skipped.
vi.mock('groundswell', () => ({
  configureHarnesses: vi.fn(),
  HarnessRegistry: {
    getInstance: () => ({
      has: () => false,
      register: vi.fn(),
      initializeProvider: vi.fn(async () => {}),
    }),
  },
  PiHarness: class MockPiHarness {},
}));

import { ensureHarnessInitialized } from '../../../src/config/harness.js';

describe('ensureHarnessInitialized — pi theme init ("Theme not initialized" regression)', () => {
  beforeEach(() => {
    // Clear the global theme slot so each test proves initTheme() actually ran here
    // (it is idempotent, so a prior run would otherwise mask a regression).
    delete (globalThis as Record<symbol, unknown>)[THEME_KEY];
  });

  it('populates pi global theme so the theme proxy no longer throws', async () => {
    // SETUP — theme slot is empty before harness init (the bug condition).
    expect((globalThis as Record<symbol, unknown>)[THEME_KEY]).toBeUndefined();

    // EXECUTE
    await ensureHarnessInitialized();

    // VERIFY — the Symbol-keyed globalThis entry the `theme` proxy reads is now set,
    // so tool renderers will not throw "Theme not initialized" mid-pipeline.
    expect((globalThis as Record<symbol, unknown>)[THEME_KEY]).toBeDefined();
  });

  it('is safe to call repeatedly (idempotent — no throw, theme stays populated)', async () => {
    await ensureHarnessInitialized();
    await expect(ensureHarnessInitialized()).resolves.toBeUndefined();
    expect((globalThis as Record<symbol, unknown>)[THEME_KEY]).toBeDefined();
  });
});
