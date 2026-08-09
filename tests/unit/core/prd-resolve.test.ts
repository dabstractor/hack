/**
 * Unit tests for `resolvePRD` recursive include expansion (PRD §2.3)
 *
 * @remarks
 * Tests validate {@link resolvePRD} from `src/core/session-utils.ts` using a REAL tmpdir
 * (NOT a module-wide `vi.mock('node:fs/promises')`), because recursion + cycle detection +
 * the base invariant are only trustworthy against real files. Covers the full S2 contract:
 *
 * - recursion: nested chain (entry→a→b→c) expands inline to full depth.
 * - cycles: self-cycle (a→a) and mutual cycle (a→b→a) terminate; the back-edge `@token` stays
 *   literal; no throw.
 * - diamond: entry→a→c and entry→b→c expands `c` in BOTH branches (path-based visited set).
 * - base invariant: a `@token` inside a sub-directory file resolves against the ENTRY PRD's
 *   directory, not the including file's directory (PRD §2.3).
 * - max depth: `opts.maxDepth = N` and the default bound stop expanding; deeper tokens literal.
 * - error branches: missing include (ENOENT) silent verbatim; directory token silent verbatim;
 *   invalid UTF-8 inside recursion → `SessionFileError`; stat EACCES (Linux) → `SessionFileError`;
 *   missing entry → `SessionFileError`.
 * - idempotency-friendly single pass: entry with no includes is returned verbatim.
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
  resolvePRD,
  resolveIncludes,
  SessionFileError,
} from '../../../src/core/session-utils.js';

// ============================================================================
// TEST FIXTURES
// ============================================================================

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'prd-resolve-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

// ============================================================================
// resolvePRD — recursion (happy paths)
// ============================================================================

describe('resolvePRD — recursion', () => {
  it('expands a single-level include inline', async () => {
    // SETUP — entry has '@a.md'; a.md has no includes.
    writeFileSync(join(tmp, 'a.md'), 'A BODY');
    writeFileSync(join(tmp, 'main.md'), 'start @a.md end');

    // EXECUTE
    const result = await resolvePRD(join(tmp, 'main.md'));

    // VERIFY — a.md body inlined; prose preserved.
    expect(result).toBe('start A BODY end');
  });

  it('deduplicates a shared descendant across a nested chain (c imported exactly once)', async () => {
    // SETUP — each file includes the next, three levels deep. Both @tokens in a.md are at a
    // non-path-char boundary (preceded by '(' and space), so BOTH would expand recursively —
    // but c.md is referenced from BOTH a.md and (transitively) b.md, so the SECOND encounter is
    // ELIDED under §2.3 global-flat dedup.
    writeFileSync(join(tmp, 'c.md'), 'C');
    writeFileSync(join(tmp, 'b.md'), 'B(@c.md)');
    writeFileSync(join(tmp, 'a.md'), 'A(@c.md via b:@b.md)');
    writeFileSync(join(tmp, 'main.md'), 'start @a.md end');

    // EXECUTE + VERIFY — c expands ONCE (first encounter, in a); b's @c.md is ELIDED (§2.3 dedup) → B().
    await expect(resolvePRD(join(tmp, 'main.md'))).resolves.toBe(
      'start A(C via b:B()) end'
    );
  });

  it('returns entry content verbatim when there are no includes (single-pass idempotency)', async () => {
    // SETUP — no @tokens at all.
    writeFileSync(join(tmp, 'main.md'), 'plain content with no includes');

    // EXECUTE + VERIFY — exact identity (proves the no-match path).
    await expect(resolvePRD(join(tmp, 'main.md'))).resolves.toBe(
      'plain content with no includes'
    );
  });
});

// ============================================================================
// resolvePRD — global-flat dedup & elision (each file imported at most once)
// ============================================================================

describe('resolvePRD — global-flat dedup & elision (each file imported at most once)', () => {
  it('elides a self-cycle (second encounter drops the @token)', async () => {
    // SETUP — a.md includes itself.
    writeFileSync(join(tmp, 'a.md'), 'X @a.md Y');
    writeFileSync(join(tmp, 'main.md'), '@a.md');

    // EXECUTE + VERIFY — the inner @a.md is ELIDED (a already visited); no throw, no infinite loop.
    // The double space is correct: elision drops the '@token', leaving the surrounding whitespace.
    await expect(resolvePRD(join(tmp, 'main.md'))).resolves.toBe('X  Y');
  });

  it('elides a mutual-cycle back-edge (a is imported exactly once)', async () => {
    // SETUP — a→b→a (b includes a again).
    writeFileSync(join(tmp, 'a.md'), 'A-TOP @b.md A-BOT');
    writeFileSync(join(tmp, 'b.md'), 'B-OPEN @a.md B-CLOSE');
    writeFileSync(join(tmp, 'main.md'), '@a.md');

    // EXECUTE — a expands; a's @b.md expands; b's @a.md is ELIDED (a already visited).
    const result = await resolvePRD(join(tmp, 'main.md'));

    // VERIFY — b's body inlined once; b's back-edge @a.md is ELIDED (double space B-OPEN␣␣B-CLOSE).
    expect(result).toBe('A-TOP B-OPEN  B-CLOSE A-BOT');
    expect(result).not.toContain('A-TOP A-TOP'); // proves a is imported exactly once (§2.3 dedup)
  });

  it('elides an include pointing back at the entry (entry pre-seeded in visited)', async () => {
    // SETUP — a.md points back at main.md (the entry, pre-seeded in visited).
    writeFileSync(join(tmp, 'a.md'), 'A @main.md END');
    writeFileSync(join(tmp, 'main.md'), '@a.md');

    // EXECUTE + VERIFY — a's @main.md is ELIDED (the entry is pre-seeded in visited). Double space.
    await expect(resolvePRD(join(tmp, 'main.md'))).resolves.toBe('A  END');
  });

  it('deduplicates a diamond dependency — shared file expanded exactly once', async () => {
    // SETUP — entry→a and entry→b; both a and b include shared.md.
    writeFileSync(join(tmp, 'shared.md'), 'S');
    writeFileSync(join(tmp, 'a.md'), '[@shared.md]');
    writeFileSync(join(tmp, 'b.md'), '{@shared.md}');
    writeFileSync(join(tmp, 'main.md'), '@a.md\n@b.md');

    // EXECUTE
    const out = await resolvePRD(join(tmp, 'main.md'));

    // VERIFY — shared expands ONCE (first encounter via a); b's @shared.md is ELIDED (§2.3 global-flat-dedup).
    expect(out).toBe('[S]\n{}');
  });
});

// ============================================================================
// resolvePRD — base invariant (project-root-relative)
// ============================================================================

describe('resolvePRD — base invariant', () => {
  it('resolves includes against the ENTRY PRD directory, not the including file directory', async () => {
    // SETUP — entry at <tmp>/main.md includes '@sub/a.md'; sub/a.md includes '@shared.md';
    // shared.md lives at <tmp>/shared.md (NOT <tmp>/sub/shared.md).
    mkdirSync(join(tmp, 'sub'));
    writeFileSync(join(tmp, 'shared.md'), 'SHARED_AT_ROOT');
    writeFileSync(join(tmp, 'sub', 'a.md'), 'sub-file refs @shared.md');
    writeFileSync(join(tmp, 'main.md'), '@sub/a.md');

    // EXECUTE + VERIFY — @shared.md inside sub/a.md resolves to <tmp>/shared.md (entry dir).
    await expect(resolvePRD(join(tmp, 'main.md'))).resolves.toBe(
      'sub-file refs SHARED_AT_ROOT'
    );
  });

  it('keeps the base invariant across nested sub-directory files', async () => {
    // SETUP — two levels of sub-directories; both child includes resolve against the entry dir.
    mkdirSync(join(tmp, 'sub'));
    mkdirSync(join(tmp, 'sub', 'deep'));
    writeFileSync(join(tmp, 'root.md'), 'ROOT');
    writeFileSync(join(tmp, 'sub', 'deep', 'c.md'), 'deep @root.md');
    writeFileSync(join(tmp, 'sub', 'a.md'), 'a @sub/deep/c.md');
    writeFileSync(join(tmp, 'main.md'), '@sub/a.md');

    // EXECUTE + VERIFY — @root.md (inside sub/deep/c.md) resolves to <tmp>/root.md.
    await expect(resolvePRD(join(tmp, 'main.md'))).resolves.toBe('a deep ROOT');
  });
});

// ============================================================================
// resolvePRD — max depth gate
// ============================================================================

describe('resolvePRD — max depth', () => {
  it('stops expanding at opts.maxDepth (deeper tokens stay literal)', async () => {
    // SETUP — entry→a→b→c; with maxDepth=1 only a expands; b is read but not recursed.
    writeFileSync(join(tmp, 'c.md'), 'C');
    writeFileSync(join(tmp, 'b.md'), 'B @c.md');
    writeFileSync(join(tmp, 'a.md'), 'A @b.md');
    writeFileSync(join(tmp, 'main.md'), '@a.md');

    // EXECUTE — maxDepth=1: a expands at depth 1, but a's body (containing @b.md) is the
    // depth-1 boundary, so @b.md inside a is NOT recursed.
    const out = await resolvePRD(join(tmp, 'main.md'), { maxDepth: 1 });

    // VERIFY — a expanded; @b.md stays literal (depth gate TRUE branch).
    expect(out).toBe('A @b.md');
    expect(out).toContain('A ');
    expect(out).not.toContain('B ');
    expect(out).not.toContain('C');
  });

  it('stops expanding at opts.maxDepth = 0 (entry returned verbatim)', async () => {
    // SETUP — would expand at depth 1 if the gate were open.
    writeFileSync(join(tmp, 'a.md'), 'A');
    writeFileSync(join(tmp, 'main.md'), '@a.md');

    // EXECUTE — depth gate closes immediately (0 >= 0 at entry, depth 0).
    const out = await resolvePRD(join(tmp, 'main.md'), { maxDepth: 0 });

    // VERIFY — identity; the @a.md token stays literal.
    expect(out).toBe('@a.md');
  });

  it('stops expanding at the default depth bound (PRD_INCLUDE_MAX_DEPTH)', async () => {
    // SETUP — a 12-deep chain; default maxDepth (10) means levels 11–12 stay literal.
    // main.md → l1 → l2 → ... → l12, where each lN includes @l{N+1}.md.
    for (let i = 12; i >= 1; i--) {
      const body = i === 12 ? 'LEAF' : `L${i} @l${i + 1}.md`;
      writeFileSync(join(tmp, `l${i}.md`), body);
    }
    writeFileSync(join(tmp, 'main.md'), '@l1.md');

    // EXECUTE — default bound (10): levels 1–10 expand; @l11.md inside l10 stays literal.
    const out = await resolvePRD(join(tmp, 'main.md'));

    // VERIFY — levels 1–10 expanded inline; the @l11.md token (depth 10 boundary) stays literal.
    expect(out).toContain('L1 ');
    expect(out).toContain('L10 ');
    expect(out).toContain('@l11.md'); // literal — depth gate hit at the 10th nesting level
    expect(out).not.toContain('L11 ');
    expect(out).not.toContain('LEAF');
  });
});

// ============================================================================
// resolvePRD — silent verbatim branches inside recursion
// ============================================================================

describe('resolvePRD — silent verbatim inside recursion', () => {
  it('leaves a missing include (ENOENT) literal and silent deep in recursion', async () => {
    // SETUP — a expands; a's @missing.md does not exist → literal, silent.
    writeFileSync(join(tmp, 'a.md'), 'A @missing.md END');
    writeFileSync(join(tmp, 'main.md'), '@a.md');

    // EXECUTE + VERIFY — no throw; @missing.md verbatim.
    await expect(resolvePRD(join(tmp, 'main.md'))).resolves.toBe(
      'A @missing.md END'
    );
  });

  it('leaves a directory token literal and silent deep in recursion (isFile false)', async () => {
    // SETUP — a expands; a's @docs resolves but is a directory → literal, silent.
    mkdirSync(join(tmp, 'docs'));
    writeFileSync(join(tmp, 'a.md'), 'A @docs END');
    writeFileSync(join(tmp, 'main.md'), '@a.md');

    // EXECUTE + VERIFY — no throw; @docs verbatim (isFile false branch).
    await expect(resolvePRD(join(tmp, 'main.md'))).resolves.toBe('A @docs END');
  });
});

// ============================================================================
// resolvePRD — error branches (SessionFileError)
// ============================================================================

describe('resolvePRD — error branches', () => {
  it('rejects a missing entry file with SessionFileError (ENOENT)', async () => {
    // EXECUTE + VERIFY — entry read failure → SessionFileError.
    await expect(resolvePRD(join(tmp, 'nope.md'))).rejects.toBeInstanceOf(
      SessionFileError
    );
  });

  it('rejects when the entry file has invalid UTF-8', async () => {
    // SETUP — entry with an invalid UTF-8 byte sequence (0xFF is invalid as a lead byte).
    writeFileSync(join(tmp, 'main.md'), Buffer.from([0xff, 0xfe, 0xfd]));

    // EXECUTE + VERIFY — readUTF8FileStrict fatal-decode throws SessionFileError.
    await expect(resolvePRD(join(tmp, 'main.md'))).rejects.toBeInstanceOf(
      SessionFileError
    );
  });

  it('rejects with SessionFileError when an included file deep in recursion has invalid UTF-8', async () => {
    // SETUP — a is included; a's body is invalid UTF-8 → readUTF8FileStrict fatal decode.
    writeFileSync(join(tmp, 'a.md'), Buffer.from([0xff, 0xfe, 0xfd]));
    writeFileSync(join(tmp, 'main.md'), '@a.md');

    // EXECUTE + VERIFY — read-fail branch inside recursion.
    await expect(resolvePRD(join(tmp, 'main.md'))).rejects.toBeInstanceOf(
      SessionFileError
    );
  });

  it.runIf(process.platform !== 'win32')(
    'throws SessionFileError on stat EACCES inside recursion (Linux, chmod 000)',
    async () => {
      // SETUP — a readable-name file with no permissions to stat. chmod 000 makes stat throw
      // EACCES (a non-ENOENT error → SessionFileError). Restore perms in finally so afterEach
      // rmSync can clean up.
      const target = join(tmp, 'locked.md');
      writeFileSync(target, 'LOCKED');
      chmodSync(target, 0o000);
      writeFileSync(join(tmp, 'a.md'), 'A @locked.md END');
      writeFileSync(join(tmp, 'main.md'), '@a.md');
      try {
        // EXECUTE + VERIFY — stat-non-ENOENT branch → SessionFileError.
        await expect(resolvePRD(join(tmp, 'main.md'))).rejects.toBeInstanceOf(
          SessionFileError
        );
      } finally {
        chmodSync(target, 0o644);
      }
    }
  );
});

// ============================================================================
// P1.M1.T2.S2 (plan 014) — NEW invariant tests (N1, N3, N4, N5, N6, N7) locking the
// §2.3 dedup / elision / idempotency of `expandIncludesRecursive`. No source changes.
// Disjoint describes (S1 owns 'global-flat dedup & elision'); reuse the file-level `tmp`.
// ============================================================================

/** Shared diamond fixture for the dedup/marker tests (N1/N3 + prd-markers N2). */
function writeDiamond(dir: string): void {
  writeFileSync(join(dir, 'D.md'), 'D-BODY');
  writeFileSync(join(dir, 'B.md'), 'B-OPEN @D.md B-CLOSE');
  writeFileSync(join(dir, 'C.md'), 'C-OPEN @D.md C-CLOSE');
  writeFileSync(join(dir, 'A.md'), 'A-TOP @B.md @C.md A-BOT'); // B before C
  writeFileSync(join(dir, 'main.md'), '@A.md');
}

// resolvePRD — diamond dedup & first-encounter position (§2.3)
describe('resolvePRD — diamond dedup & first-encounter position (§2.3)', () => {
  it('N1: expands the shared include exactly once at its first-encounter (B before C) position', async () => {
    writeDiamond(tmp);

    const out = await resolvePRD(join(tmp, 'main.md'));

    // VERIFY — D-BODY expanded once (inside B), elided from C (leaving the double-space). B precedes
    // C in A, so D-BODY sits between B-OPEN/B-CLOSE, before C-OPEN.
    expect(out).toBe('A-TOP B-OPEN D-BODY B-CLOSE C-OPEN  C-CLOSE A-BOT');
    expect(out.split('D-BODY').length).toBe(2); // appears exactly once
    expect(out).not.toContain('@D.md'); // no literal survivor
    expect(out.indexOf('D-BODY')).toBeLessThan(out.indexOf('C-OPEN'));
  });

  it('N3: emits no @include-ref comments under markers-off elision and expands D exactly once', async () => {
    writeDiamond(tmp);

    const out = await resolvePRD(join(tmp, 'main.md'));

    // VERIFY — markers-off elision is silent (no reference comments) and still dedups.
    expect(out).not.toContain('@D.md');
    expect(out).not.toContain('@include-ref');
    expect(out.split('D-BODY').length).toBe(2);
  });
});

// resolvePRD — idempotency fixed point (§2.3)
describe('resolvePRD — idempotency fixed point (§2.3)', () => {
  it('N4: re-resolving pass-1 output yields the same bytes (no surviving @tokens)', async () => {
    writeFileSync(join(tmp, 'a.md'), 'A-body @c.md');
    writeFileSync(join(tmp, 'b.md'), 'B-body @c.md');
    writeFileSync(join(tmp, 'c.md'), 'C-body @a.md'); // cycle back to a (already visited → elided)
    writeFileSync(join(tmp, 'main.md'), '@a.md\n@b.md');

    const out1 = await resolvePRD(join(tmp, 'main.md'));

    // Pass 2: resolvePRD takes a PATH — write pass-1 output to a temp file, then resolve that.
    const pass2 = join(tmp, 'pass2.md');
    writeFileSync(pass2, out1);
    const out2 = await resolvePRD(pass2);

    // VERIFY — fixed point (idempotent) + no surviving include tokens.
    expect(out2).toBe(out1);
    expect(out1).not.toMatch(/@a\.md|@b\.md|@c\.md/);
  });
});

// resolvePRD — exponential-blowup guard (§2.3 dedup bounds recursion)
describe('resolvePRD — exponential-blowup guard (§2.3 dedup bounds recursion)', () => {
  it('N5: 8 mutually-referencing files resolve in bounded time/size (each body once)', async () => {
    // SETUP — 8 files f0..f7, each referencing f(i+1)%8 and f(i+2)%8 (a dense cycle graph).
    let totalInput = 0;
    for (let i = 0; i < 8; i++) {
      const body = `F${i} @f${(i + 1) % 8}.md @f${(i + 2) % 8}.md`;
      writeFileSync(join(tmp, `f${i}.md`), body);
      totalInput += body.length;
    }
    writeFileSync(join(tmp, 'main.md'), '@f0.md');
    totalInput += '@f0.md'.length;

    // EXECUTE — COMPLETES (no throw, no exponential blowup; dedup bounds the traversal).
    const out = await resolvePRD(join(tmp, 'main.md'));

    // VERIFY — each file body appears EXACTLY once (first-encounter wins; back-edges elided).
    for (let i = 0; i < 8; i++) {
      expect(out.split(`F${i}`).length).toBe(2);
    }
    // Bounded size: output is smaller than 2× the total input bytes (dedup, no duplication).
    expect(out.length).toBeLessThan(totalInput * 2);
  });
});

// resolvePRD — entry-self-include elision (§2.3)
describe('resolvePRD — entry-self-include elision (§2.3)', () => {
  it('N6: an include pointing back at the entry is elided silently (no stale-warn)', async () => {
    // SETUP — entry is pre-seeded in `visited`, so @main.md is a back-edge → elided (emit nothing,
    // leaving the double-space). Elision is SILENT — no stale-include console.warn.
    writeFileSync(join(tmp, 'main.md'), 'X @main.md Y');

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(resolvePRD(join(tmp, 'main.md'))).resolves.toBe('X  Y');
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});

// resolveIncludes — single-level, no dedup (§2.3)
describe('resolveIncludes — single-level, no dedup (§2.3)', () => {
  it('N7: a duplicate @token expands BOTH times (no visited set, no recursion)', async () => {
    // SETUP — resolveIncludes is the single-level primitive: no dedup, no recursion. A repeated
    // @a.md expands both occurrences.
    writeFileSync(join(tmp, 'a.md'), 'A');

    const out = await resolveIncludes('@a.md @a.md', tmp);

    // VERIFY — both occurrences expanded (single-level: the contract has no visited set).
    expect(out).toBe('A A');
  });
});
