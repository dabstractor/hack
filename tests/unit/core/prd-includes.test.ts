/**
 * Unit tests for `resolveIncludes` PRD `@`-include tokenizer (PRD §2.3)
 *
 * @remarks
 * Tests validate {@link resolveIncludes} from `src/core/session-utils.ts` using a REAL tmpdir
 * (NOT a module-wide `vi.mock('node:fs/promises')`), because boundary + existence logic is only
 * trustworthy against real files. Covers the full S1 contract:
 * - expansion: line-start, inline, parenthesized.
 * - boundary failures: `foo@bar.com`, `dir/@file.md`, mid-word `@`.
 * - existence failures: ENOENT (missing) silent verbatim, directory silent verbatim.
 * - read error: invalid UTF-8 → `SessionFileError` (covers the read catch branch).
 * - stat error: chmod 000 (Linux only) → EACCES → `SessionFileError` (covers the stat catch branch).
 * - single-level: a nested `@token` inside an included file is NOT re-expanded.
 * - depth gate: `opts.maxDepth = 0` returns content unchanged.
 *
 * Also validates the `getPrdIncludeMaxDepth` config getter (unset/garbage/zero/negative/valid).
 *
 * @see {@link ../../../src/core/session-utils.ts}
 * @see {@link ../../../src/config/constants.ts}
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  chmodSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  resolveIncludes,
  SessionFileError,
} from '../../../src/core/session-utils.js';
import {
  getPrdIncludeMaxDepth,
  DEFAULT_PRD_INCLUDE_MAX_DEPTH,
  PRD_INCLUDE_MAX_DEPTH,
} from '../../../src/config/constants.js';

// ============================================================================
// TEST FIXTURES
// ============================================================================

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'prd-includes-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

// ============================================================================
// resolveIncludes — expansion (happy paths)
// ============================================================================

describe('resolveIncludes — expansion', () => {
  it('expands a line-start include', async () => {
    // SETUP — docs/a.md exists with body 'ARCH BODY'.
    mkdirSync(join(tmp, 'docs'));
    writeFileSync(join(tmp, 'docs', 'a.md'), 'ARCH BODY');

    // EXECUTE
    const result = await resolveIncludes('Top\n@docs/a.md\nBottom', tmp);

    // VERIFY — token replaced inline, prose preserved.
    expect(result).toBe('Top\nARCH BODY\nBottom');
  });

  it('expands an inline include in prose (space before @)', async () => {
    // SETUP
    mkdirSync(join(tmp, 'docs'));
    writeFileSync(join(tmp, 'docs', 'a.md'), 'INCLUDED');

    // EXECUTE
    const result = await resolveIncludes('see @docs/a.md here', tmp);

    // VERIFY — expanded inline, surrounding prose kept.
    expect(result).toBe('see INCLUDED here');
  });

  it('expands a parenthesized include and keeps the parens', async () => {
    // SETUP
    mkdirSync(join(tmp, 'docs'));
    writeFileSync(join(tmp, 'docs', 'a.md'), 'X');

    // EXECUTE
    const result = await resolveIncludes('(@docs/a.md)', tmp);

    // VERIFY — `(` and `)` preserved; token expanded.
    expect(result).toBe('(X)');
  });

  it('expands multiple includes in one pass', async () => {
    // SETUP
    writeFileSync(join(tmp, 'one.md'), 'ONE');
    writeFileSync(join(tmp, 'two.md'), 'TWO');

    // EXECUTE
    const result = await resolveIncludes('@one.md and @two.md', tmp);

    // VERIFY
    expect(result).toBe('ONE and TWO');
  });
});

// ============================================================================
// resolveIncludes — boundary failures (literal, untouched)
// ============================================================================

describe('resolveIncludes — boundary failures', () => {
  it('leaves foo@bar.com literal (path char before @)', async () => {
    // EXECUTE — no file created; boundary must fail before any stat.
    const result = await resolveIncludes('contact foo@bar.com today', tmp);

    // VERIFY — verbatim, untouched.
    expect(result).toBe('contact foo@bar.com today');
  });

  it('leaves dir/@file.md literal (slash before @ is a path char)', async () => {
    // SETUP — the file WOULD exist if the token were honored, to prove the boundary (not
    // existence) is what rejects it.
    writeFileSync(join(tmp, 'file.md'), 'SHOULD NOT BE USED');

    // EXECUTE
    const result = await resolveIncludes('see dir/@file.md end', tmp);

    // VERIFY
    expect(result).toBe('see dir/@file.md end');
  });

  it('leaves a mid-word @ literal', async () => {
    // EXECUTE
    const result = await resolveIncludes('a@b@c', tmp);

    // VERIFY — both @s are mid-word → literal.
    expect(result).toBe('a@b@c');
  });
});

// ============================================================================
// resolveIncludes — existence failures (silent verbatim)
// ============================================================================

describe('resolveIncludes — existence failures', () => {
  it('leaves a missing-file token literal and silent (ENOENT)', async () => {
    // EXECUTE — @missing.md does not exist.
    const result = await resolveIncludes('start @missing.md end', tmp);

    // VERIFY — verbatim, no throw.
    expect(result).toBe('start @missing.md end');
  });

  it('leaves a directory token literal and silent (isFile false)', async () => {
    // SETUP — `docs` resolves but is a directory, not a file.
    mkdirSync(join(tmp, 'docs'));

    // EXECUTE
    const result = await resolveIncludes('@docs more', tmp);

    // VERIFY — verbatim, no throw.
    expect(result).toBe('@docs more');
  });
});

// ============================================================================
// resolveIncludes — error branches (SessionFileError)
// ============================================================================

describe('resolveIncludes — error branches', () => {
  it('throws SessionFileError when an included file has invalid UTF-8', async () => {
    // SETUP — a file with an invalid UTF-8 byte sequence (0xFF is invalid as a lead byte).
    writeFileSync(join(tmp, 'bad.md'), Buffer.from([0xff, 0xfe, 0xfd]));

    // EXECUTE + VERIFY — readUTF8FileStrict fatal-decode throws SessionFileError.
    await expect(resolveIncludes('@bad.md', tmp)).rejects.toBeInstanceOf(
      SessionFileError
    );
  });

  it.runIf(process.platform !== 'win32')(
    'throws SessionFileError on stat EACCES (Linux, chmod 000)',
    async () => {
      // SETUP — a readable-name file with no permissions to stat. chmod 000 makes stat throw
      // EACCES (a non-ENOENT error → SessionFileError). Restore perms in finally so afterEach
      // rmSync can clean up.
      const target = join(tmp, 'locked.md');
      writeFileSync(target, 'LOCKED');
      chmodSync(target, 0o000);
      try {
        // EXECUTE + VERIFY
        await expect(resolveIncludes('@locked.md', tmp)).rejects.toBeInstanceOf(
          SessionFileError
        );
      } finally {
        chmodSync(target, 0o644);
      }
    }
  );
});

// ============================================================================
// resolveIncludes — single-level + depth gate
// ============================================================================

describe('resolveIncludes — single-level semantics', () => {
  it('does NOT re-expand a nested @token inside an included file', async () => {
    // SETUP — outer includes inner; inner's content contains its own @token that SHOULD be
    // left literal (single-level: substituted content is not re-scanned in S1).
    mkdirSync(join(tmp, 'docs'));
    writeFileSync(join(tmp, 'docs', 'other.md'), 'INNER BODY');
    writeFileSync(join(tmp, 'docs', 'outer.md'), 'before @docs/other.md after');

    // EXECUTE — resolve only the outer token; the inner @docs/other.md stays literal.
    const result = await resolveIncludes('@docs/outer.md', tmp);

    // VERIFY
    expect(result).toBe('before @docs/other.md after');
  });
});

describe('resolveIncludes — depth gate', () => {
  it('returns content unchanged when opts.maxDepth = 0', async () => {
    // SETUP — a token that WOULD expand if the gate were open.
    mkdirSync(join(tmp, 'docs'));
    writeFileSync(join(tmp, 'docs', 'a.md'), 'WOULD EXPAND');

    // EXECUTE — gate closes the pipeline.
    const result = await resolveIncludes('@docs/a.md', tmp, { maxDepth: 0 });

    // VERIFY — identity.
    expect(result).toBe('@docs/a.md');
  });

  it('does NOT close the gate when PRD_INCLUDE_MAX_DEPTH=0 (getter maps 0 → default)', async () => {
    // SETUP — PRD §2.3: '0' is non-positive → getter returns the DEFAULT (10), so the gate
    // stays open and the token expands. (Closing the gate is only possible via opts.maxDepth=0.)
    mkdirSync(join(tmp, 'docs'));
    writeFileSync(join(tmp, 'docs', 'a.md'), 'WOULD EXPAND');
    vi.stubEnv(PRD_INCLUDE_MAX_DEPTH, '0');

    // EXECUTE
    const result = await resolveIncludes('@docs/a.md', tmp);

    // VERIFY — getter returned default → gate open → expanded.
    expect(result).toBe('WOULD EXPAND');
  });
});

// ============================================================================
// config/constants — getPrdIncludeMaxDepth getter
// ============================================================================

describe('config/constants: getPrdIncludeMaxDepth', () => {
  beforeEach(() => {
    delete process.env.PRD_INCLUDE_MAX_DEPTH;
  });

  it('(a) returns the default (10) when env var is unset', () => {
    // EXECUTE
    const result = getPrdIncludeMaxDepth();

    // VERIFY
    expect(result).toBe(DEFAULT_PRD_INCLUDE_MAX_DEPTH); // 10
  });

  it('(b) returns default when env var is NaN', () => {
    // SETUP
    vi.stubEnv(PRD_INCLUDE_MAX_DEPTH, 'abc');

    // EXECUTE
    const result = getPrdIncludeMaxDepth();

    // VERIFY
    expect(result).toBe(DEFAULT_PRD_INCLUDE_MAX_DEPTH);
  });

  it('(c) returns default when env var is zero', () => {
    // SETUP
    vi.stubEnv(PRD_INCLUDE_MAX_DEPTH, '0');

    // EXECUTE
    const result = getPrdIncludeMaxDepth();

    // VERIFY
    expect(result).toBe(DEFAULT_PRD_INCLUDE_MAX_DEPTH);
  });

  it('(d) returns default when env var is negative', () => {
    // SETUP
    vi.stubEnv(PRD_INCLUDE_MAX_DEPTH, '-1');

    // EXECUTE
    const result = getPrdIncludeMaxDepth();

    // VERIFY
    expect(result).toBe(DEFAULT_PRD_INCLUDE_MAX_DEPTH);
  });

  it('(e) honors a stubbed positive integer', () => {
    // SETUP
    vi.stubEnv(PRD_INCLUDE_MAX_DEPTH, '4');

    // EXECUTE
    const result = getPrdIncludeMaxDepth();

    // VERIFY
    expect(result).toBe(4);
  });

  it('(f) floors a fractional value to match sibling count-getters (MINOR-1)', () => {
    // SETUP — 3.7 must floor to 3, not leak through as a real-valued gate depth
    vi.stubEnv(PRD_INCLUDE_MAX_DEPTH, '3.7');

    // EXECUTE
    const result = getPrdIncludeMaxDepth();

    // VERIFY
    expect(result).toBe(3);
  });
});
