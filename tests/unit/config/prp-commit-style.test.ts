/**
 * Unit tests for the PRP_COMMIT_STYLE / PRP_COMMIT_STYLE_EXAMPLES config constants and readers
 *
 * @remarks
 * Tests validate `getPrpCommitStyle` and `getPrpCommitStyleExamples` from
 * `src/config/constants.ts` (PRD §5.1 "Commit Message Style", §9.2.2). Mirrors
 * `prp-commit-format.test.ts` (the string-getter sibling) and `issue-retry-max.test.ts`
 * (the numeric-getter sibling) structure verbatim: `beforeEach` env reset,
 * `afterEach` `vi.unstubAllEnvs`, the per-case `vi.stubEnv` layout.
 *
 * Two DELIBERATE deviations from the sibling getters are locked in here:
 * - **Case-insensitive matching** for `getPrpCommitStyle` (vs `getPrpCommitFormat`'s
 *   case-sensitive single opt-out) — covers all 4 modes (auto/plain/conventional/gitmoji),
 *   case-folded, plus unrecognized/empty/whitespace → default `auto`.
 * - **Allow-0** for `getPrpCommitStyleExamples` (vs `getIssueRetryMax`/`getResearchTimeoutSeconds`'s
 *   `<= 0 → default`) — the guard is `< 0`; the `accepts 0` case is MANDATORY proof of the deviation.
 *
 * @see {@link ../../../src/config/constants.ts}
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PRP_COMMIT_STYLE,
  DEFAULT_PRP_COMMIT_STYLE_EXAMPLES,
  PRP_COMMIT_STYLE,
  PRP_COMMIT_STYLE_EXAMPLES,
  getPrpCommitStyle,
  getPrpCommitStyleExamples,
} from '../../../src/config/constants.js';

// ============================================================================
// getPrpCommitStyle — case-insensitive over 4 modes; default 'auto'
// ============================================================================

describe('config/constants: getPrpCommitStyle', () => {
  beforeEach(() => {
    delete process.env.PRP_COMMIT_STYLE;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("(a) returns the default ('auto') when env var is unset", () => {
    // SETUP — env var already deleted in beforeEach

    // EXECUTE
    const result = getPrpCommitStyle();

    // VERIFY
    expect(result).toBe(DEFAULT_PRP_COMMIT_STYLE); // 'auto'
  });

  it("(b) honors an explicit 'auto'", () => {
    vi.stubEnv(PRP_COMMIT_STYLE, 'auto');
    expect(getPrpCommitStyle()).toBe('auto');
  });

  it("(c) honors an explicit 'plain'", () => {
    vi.stubEnv(PRP_COMMIT_STYLE, 'plain');
    expect(getPrpCommitStyle()).toBe('plain');
  });

  it("(d) honors an explicit 'conventional'", () => {
    vi.stubEnv(PRP_COMMIT_STYLE, 'conventional');
    expect(getPrpCommitStyle()).toBe('conventional');
  });

  it("(e) honors an explicit 'gitmoji'", () => {
    vi.stubEnv(PRP_COMMIT_STYLE, 'gitmoji');
    expect(getPrpCommitStyle()).toBe('gitmoji');
  });

  it('(f) matches CASE-INSENSITIVELY (deviation from getPrpCommitFormat)', () => {
    vi.stubEnv(PRP_COMMIT_STYLE, 'PLAIN');
    expect(getPrpCommitStyle()).toBe('plain');

    vi.stubEnv(PRP_COMMIT_STYLE, 'Conventional');
    expect(getPrpCommitStyle()).toBe('conventional');

    vi.stubEnv(PRP_COMMIT_STYLE, 'GITMOJI');
    expect(getPrpCommitStyle()).toBe('gitmoji');

    vi.stubEnv(PRP_COMMIT_STYLE, 'Auto');
    expect(getPrpCommitStyle()).toBe('auto');
  });

  it('(g) trims whitespace before matching', () => {
    vi.stubEnv(PRP_COMMIT_STYLE, '  plain  ');
    expect(getPrpCommitStyle()).toBe('plain');
  });

  it('(h) returns default for an unrecognized value', () => {
    vi.stubEnv(PRP_COMMIT_STYLE, 'bogus');
    expect(getPrpCommitStyle()).toBe(DEFAULT_PRP_COMMIT_STYLE); // 'auto'
  });

  it('(i) returns default for an empty string', () => {
    vi.stubEnv(PRP_COMMIT_STYLE, '');
    expect(getPrpCommitStyle()).toBe(DEFAULT_PRP_COMMIT_STYLE); // 'auto'
  });
});

// ============================================================================
// getPrpCommitStyleExamples — allows 0 (deviation); default 5 on unset/NaN/negative
// ============================================================================

describe('config/constants: getPrpCommitStyleExamples', () => {
  beforeEach(() => {
    delete process.env.PRP_COMMIT_STYLE_EXAMPLES;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('(a) returns the default (5) when env var is unset', () => {
    expect(getPrpCommitStyleExamples()).toBe(DEFAULT_PRP_COMMIT_STYLE_EXAMPLES); // 5
  });

  it('(b) honors a positive integer', () => {
    vi.stubEnv(PRP_COMMIT_STYLE_EXAMPLES, '5');
    expect(getPrpCommitStyleExamples()).toBe(5);

    vi.stubEnv(PRP_COMMIT_STYLE_EXAMPLES, '10');
    expect(getPrpCommitStyleExamples()).toBe(10);
  });

  it('(c) ACCEPTS 0 — disables style learning under auto (deviation from the <=0 pattern)', () => {
    // ⚠️ MANDATORY case: proves the guard is `< 0`, NOT `<= 0`.
    vi.stubEnv(PRP_COMMIT_STYLE_EXAMPLES, '0');
    expect(getPrpCommitStyleExamples()).toBe(0);
  });

  it('(d) returns default on NaN', () => {
    vi.stubEnv(PRP_COMMIT_STYLE_EXAMPLES, 'abc');
    expect(getPrpCommitStyleExamples()).toBe(DEFAULT_PRP_COMMIT_STYLE_EXAMPLES); // 5
  });

  it('(e) returns default on negative', () => {
    vi.stubEnv(PRP_COMMIT_STYLE_EXAMPLES, '-3');
    expect(getPrpCommitStyleExamples()).toBe(DEFAULT_PRP_COMMIT_STYLE_EXAMPLES); // 5
  });

  it('(f) trims whitespace before parsing (Number trims)', () => {
    vi.stubEnv(PRP_COMMIT_STYLE_EXAMPLES, '  7  ');
    expect(getPrpCommitStyleExamples()).toBe(7);
  });
});
