/**
 * Unit tests for PRP_COMMIT_FORMAT config constant and the getPrpCommitFormat() reader
 *
 * @remarks
 * Tests validate the getPrpCommitFormat() function from src/config/constants.ts
 * (PRD §5.1 "Commit Message Format (Standardized Task-Prefix)"). Mirrors
 * validation-config.test.ts (the string-getter sibling) and commit-retry.test.ts
 * (the commit-family sibling) structure verbatim: beforeEach env reset,
 * afterEach vi.unstubAllEnvs, the (a)..(g) case layout covering all 3 getter
 * branches (raw===undefined / v==='plain' true / v==='plain' false) plus the
 * case-sensitivity quirk.
 * - (a) Returns DEFAULT ('task-prefix') when env var is unset
 * - (b) Honors 'plain' (the opt-out)
 * - (c) Honors an explicit 'task-prefix' (the default value)
 * - (d) Returns DEFAULT for an unknown value ('garbage')
 * - (e) Returns DEFAULT for an empty string
 * - (f) Trims whitespace before matching ('  plain  ' → 'plain')
 * - (g) Is case-SENSITIVE ('TASK-PREFIX' → 'task-prefix')
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PRP_COMMIT_FORMAT,
  PRP_COMMIT_FORMAT,
  getPrpCommitFormat,
} from '../../../src/config/constants.js';

describe('config/constants: getPrpCommitFormat', () => {
  beforeEach(() => {
    delete process.env.PRP_COMMIT_FORMAT;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("(a) returns the default ('task-prefix') when env var is unset", () => {
    // SETUP — env var already deleted in beforeEach

    // EXECUTE
    const result = getPrpCommitFormat();

    // VERIFY
    expect(result).toBe(DEFAULT_PRP_COMMIT_FORMAT); // 'task-prefix'
  });

  it("(b) honors 'plain' (the opt-out)", () => {
    // SETUP
    vi.stubEnv(PRP_COMMIT_FORMAT, 'plain');

    // EXECUTE
    const result = getPrpCommitFormat();

    // VERIFY
    expect(result).toBe('plain');
  });

  it("(c) honors an explicit 'task-prefix' (the default value)", () => {
    // SETUP
    vi.stubEnv(PRP_COMMIT_FORMAT, 'task-prefix');

    // EXECUTE
    const result = getPrpCommitFormat();

    // VERIFY
    expect(result).toBe('task-prefix');
  });

  it("(d) returns default for an unknown value ('garbage')", () => {
    // SETUP — an unrecognized token must NEVER yield an unrecognized mode
    vi.stubEnv(PRP_COMMIT_FORMAT, 'garbage');

    // EXECUTE
    const result = getPrpCommitFormat();

    // VERIFY
    expect(result).toBe('task-prefix');
  });

  it('(e) returns default for an empty string', () => {
    // SETUP — an explicitly-empty value falls back to the safe default
    vi.stubEnv(PRP_COMMIT_FORMAT, '');

    // EXECUTE
    const result = getPrpCommitFormat();

    // VERIFY
    expect(result).toBe('task-prefix');
  });

  it("(f) trims whitespace before matching ('  plain  ' → 'plain')", () => {
    // SETUP
    vi.stubEnv(PRP_COMMIT_FORMAT, '  plain  ');

    // EXECUTE
    const result = getPrpCommitFormat();

    // VERIFY
    expect(result).toBe('plain');
  });

  it("(g) is case-SENSITIVE ('TASK-PREFIX' → 'task-prefix')", () => {
    // SETUP — only the exact lowercase 'plain' opts out (PRD §5.1); every other
    // case variant (incl. 'TASK-PREFIX', 'Plain') falls back to 'task-prefix'.
    vi.stubEnv(PRP_COMMIT_FORMAT, 'TASK-PREFIX');

    // EXECUTE
    const result = getPrpCommitFormat();

    // VERIFY
    expect(result).toBe('task-prefix');
  });

  it("(h) returns the narrow PrpCommitFormat union (type-safety) — unset → 'task-prefix'", () => {
    // This is a compile-time assertion that getPrpCommitFormat() returns the
    // PrpCommitFormat union (NOT string). A type error here = the getter returns
    // string = the `as const` on DEFAULT_PRP_COMMIT_FORMAT is missing.
    const f: typeof DEFAULT_PRP_COMMIT_FORMAT = getPrpCommitFormat();
    expect(f).toBe(DEFAULT_PRP_COMMIT_FORMAT); // 'task-prefix'
  });
});
