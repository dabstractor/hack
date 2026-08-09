/**
 * Unit tests for `resolvePRD` markers, stale-include warnings, and idempotency (PRD §2.3; S3)
 *
 * @remarks
 * Tests validate the S3 behaviors layered onto S2's landed `resolvePRD` /
 * `expandIncludesRecursive` in `src/core/session-utils.ts`:
 *  - MARKERS: default off; `PRD_INCLUDE_MARKERS=1` wraps each expanded include; `opts.markers`
 *    overrides env both ways; nested includes wrap at every depth; literal survivors never wrap;
 *    inline and line-start expansions both wrap.
 *  - STALE WARNING: a missing `.md` token emits exactly ONE stderr `console.warn` per pass and
 *    stays verbatim; a directory named `*.md` warns too; non-`.md` missing tokens, cycle
 *    back-edges, depth-exceeded, and resolved tokens emit NO warning.
 *  - IDEMPOTENCY: `resolve(resolve(x)) === resolve(x)` byte-for-byte for within-depth fixtures,
 *    markers OFF and ON, and with stale survivors.
 *  - GETTER: `getPrdIncludeMarkers()` rejects unset/empty/`0`/`false`/`no`/`off` (case-insensitive,
 *    trimmed); accepts any other non-empty value.
 *
 * Uses a REAL tmpdir (NOT `vi.mock('node:fs/promises')`) — boundary + existence + recursion logic
 * is only trustworthy against real files. Mirrors S1's `prd-includes.test.ts` scaffolding.
 *
 * @see {@link ../../../src/core/session-utils.ts}
 * @see {@link ../../../src/config/constants.ts}
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolvePRD } from '../../../src/core/session-utils.js';
import {
  getPrdIncludeMarkers,
  PRD_INCLUDE_MARKERS,
} from '../../../src/config/constants.js';

let tmp: string;

describe('resolvePRD — markers, stale warnings, idempotency', () => {
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'prd-markers-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  // ── MARKERS CASES ──────────────────────────────────────────────────────────

  it('emits NO markers by default (env unset)', async () => {
    writeFileSync(join(tmp, 'a.md'), 'A');
    writeFileSync(join(tmp, 'main.md'), '@a.md');
    await expect(resolvePRD(join(tmp, 'main.md'))).resolves.toBe('A');
  });

  it('wraps expanded includes when PRD_INCLUDE_MARKERS is set', async () => {
    vi.stubEnv(PRD_INCLUDE_MARKERS, '1');
    writeFileSync(join(tmp, 'a.md'), 'A');
    writeFileSync(join(tmp, 'main.md'), '@a.md');
    await expect(resolvePRD(join(tmp, 'main.md'))).resolves.toBe(
      '<!-- @!include: a.md -->\nA\n<!-- @!end-include -->'
    );
  });

  it('wraps expanded includes when opts.markers=true (env unset)', async () => {
    writeFileSync(join(tmp, 'a.md'), 'A');
    writeFileSync(join(tmp, 'main.md'), '@a.md');
    await expect(
      resolvePRD(join(tmp, 'main.md'), { markers: true })
    ).resolves.toBe('<!-- @!include: a.md -->\nA\n<!-- @!end-include -->');
  });

  it('opts.markers=false suppresses markers even when env=1', async () => {
    vi.stubEnv(PRD_INCLUDE_MARKERS, '1');
    writeFileSync(join(tmp, 'a.md'), 'A');
    writeFileSync(join(tmp, 'main.md'), '@a.md');
    await expect(
      resolvePRD(join(tmp, 'main.md'), { markers: false })
    ).resolves.toBe('A');
  });

  it('wraps nested includes at every depth', async () => {
    vi.stubEnv(PRD_INCLUDE_MARKERS, '1');
    writeFileSync(join(tmp, 'b.md'), 'B');
    writeFileSync(join(tmp, 'a.md'), '@b.md');
    writeFileSync(join(tmp, 'main.md'), '@a.md');
    const out = await resolvePRD(join(tmp, 'main.md'));
    expect(out).toContain('<!-- @!include: a.md -->');
    expect(out).toContain('<!-- @!include: b.md -->');
    // b is nested inside a's marker block
    expect(out).toBe(
      '<!-- @!include: a.md -->\n<!-- @!include: b.md -->\nB\n<!-- @!end-include -->\n<!-- @!end-include -->'
    );
  });

  it('does NOT wrap a literal survivor (missing .md) even when markers on', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv(PRD_INCLUDE_MARKERS, '1');
    writeFileSync(join(tmp, 'main.md'), '@missing.md');
    const out = await resolvePRD(join(tmp, 'main.md'));
    expect(out).toBe('@missing.md'); // never wrap a non-expansion
    expect(out).not.toContain('<!-- @!include');
  });

  it('wraps inline expansions identically to line-start (surrounding prose preserved)', async () => {
    vi.stubEnv(PRD_INCLUDE_MARKERS, '1');
    writeFileSync(join(tmp, 'a.md'), 'A');
    writeFileSync(join(tmp, 'inline.md'), 'see @a.md here');
    writeFileSync(join(tmp, 'linestart.md'), '@a.md');
    const inline = await resolvePRD(join(tmp, 'inline.md'));
    const linestart = await resolvePRD(join(tmp, 'linestart.md'));
    expect(inline).toBe(
      'see <!-- @!include: a.md -->\nA\n<!-- @!end-include --> here'
    );
    expect(linestart).toBe(
      '<!-- @!include: a.md -->\nA\n<!-- @!end-include -->'
    );
  });

  // ── STALE-WARNING CASES ────────────────────────────────────────────────────

  it('emits a stderr warning for a stale .md token and keeps it verbatim', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    writeFileSync(join(tmp, 'main.md'), '@missing.md');
    const out = await resolvePRD(join(tmp, 'main.md'));
    expect(out).toBe('@missing.md'); // stays literal
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('missing.md');
  });

  it('does NOT warn for a non-.md missing token', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    writeFileSync(join(tmp, 'main.md'), '@missing.txt');
    const out = await resolvePRD(join(tmp, 'main.md'));
    expect(out).toBe('@missing.txt');
    expect(warn).not.toHaveBeenCalled();
  });

  it('does NOT warn for a cycle back-edge (file exists, elided not literal)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Entry IS a.md; inner @a.md points back at the entry → a cycle (file exists, not stale).
    // Under §2.3 the self-include is ELIDED (emit nothing); elision is silent (the continue skips
    // the stale-warning path), so warn is NOT called. The double space is correct: elision drops
    // the '@token', leaving the surrounding whitespace.
    writeFileSync(join(tmp, 'a.md'), 'X @a.md Y');
    const out = await resolvePRD(join(tmp, 'a.md'));
    expect(warn).not.toHaveBeenCalled();
    expect(out).toBe('X  Y');
  });

  it('warns for a directory named *.md (path does not resolve to a FILE)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mkdirSync(join(tmp, 'docs.md')); // a DIRECTORY named docs.md
    writeFileSync(join(tmp, 'main.md'), '@docs.md');
    const out = await resolvePRD(join(tmp, 'main.md'));
    expect(out).toBe('@docs.md'); // directory is not a file → verbatim
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('docs.md');
  });

  it('does NOT warn for a successfully-resolved .md token', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    writeFileSync(join(tmp, 'a.md'), 'A');
    writeFileSync(join(tmp, 'main.md'), '@a.md');
    await resolvePRD(join(tmp, 'main.md'));
    expect(warn).not.toHaveBeenCalled();
  });

  // ── IDEMPOTENCY CASES ──────────────────────────────────────────────────────

  it('is idempotent with markers OFF (resolve(resolve(x)) === resolve(x))', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    writeFileSync(join(tmp, 'b.md'), 'B');
    writeFileSync(join(tmp, 'a.md'), '@b.md');
    writeFileSync(join(tmp, 'main.md'), '@a.md');
    const r1 = await resolvePRD(join(tmp, 'main.md'));
    writeFileSync(join(tmp, 'round2.md'), r1);
    const r2 = await resolvePRD(join(tmp, 'round2.md'));
    expect(r2).toBe(r1);
  });

  it('is idempotent with markers ON (resolve(resolve(x)) === resolve(x))', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv(PRD_INCLUDE_MARKERS, '1');
    writeFileSync(join(tmp, 'b.md'), 'B');
    writeFileSync(join(tmp, 'a.md'), '[@b.md]');
    writeFileSync(join(tmp, 'main.md'), '@a.md');
    const r1 = await resolvePRD(join(tmp, 'main.md'), { markers: true });
    writeFileSync(join(tmp, 'round2.md'), r1);
    const r2 = await resolvePRD(join(tmp, 'round2.md'), { markers: true });
    expect(r2).toBe(r1);
  });

  it('is idempotent with a stale survivor (re-fail yields same bytes)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    writeFileSync(join(tmp, 'real.md'), 'R');
    writeFileSync(join(tmp, 'main.md'), '@real.md @missing.md');
    const r1 = await resolvePRD(join(tmp, 'main.md'));
    writeFileSync(join(tmp, 'round2.md'), r1);
    const r2 = await resolvePRD(join(tmp, 'round2.md'));
    expect(r2).toBe(r1);
  });
});

// ============================================================================
// P1.M1.T2.S2 (plan 014) — NEW invariant test N2 locking §2.3 marker-on elision +
// fixed-point idempotency. No source changes. Disjoint describe (S1 owns the block above).
// Self-contained tmp (the describe above scopes its own beforeEach/afterEach).
// ============================================================================

// resolvePRD — marker reference comments for elided refs (§2.3)
describe('resolvePRD — marker reference comments for elided refs (§2.3)', () => {
  let n2tmp: string;

  beforeEach(() => {
    n2tmp = mkdtempSync(join(tmpdir(), 'prd-markers-n2-'));
  });

  afterEach(() => {
    rmSync(n2tmp, { recursive: true, force: true });
  });

  it('N2: markers-on emits @include-ref for the elided occurrence and is a fixed point', async () => {
    // SETUP — diamond: D is shared; B precedes C in A. Under markers-on, the FIRST encounter of
    // D (inside B) is wrapped in @include/@end-include; the SECOND (inside C) is elided as a
    // stable @include-ref comment (non-resolvable). Re-resolving pass-1 output is a fixed point.
    writeFileSync(join(n2tmp, 'D.md'), 'D-BODY');
    writeFileSync(join(n2tmp, 'B.md'), 'B-OPEN @D.md B-CLOSE');
    writeFileSync(join(n2tmp, 'C.md'), 'C-OPEN @D.md C-CLOSE');
    writeFileSync(join(n2tmp, 'A.md'), 'A-TOP @B.md @C.md A-BOT'); // B before C
    writeFileSync(join(n2tmp, 'main.md'), '@A.md');

    const out1 = await resolvePRD(join(n2tmp, 'main.md'), { markers: true });

    // VERIFY — the elided occurrence carries the reference comment; the first encounter is wrapped;
    // D-BODY still appears exactly once.
    expect(out1).toContain('<!-- @!include-ref: D.md -->');
    expect(out1).toContain('<!-- @!include: D.md -->');
    expect(out1.split('D-BODY').length).toBe(2);

    // Idempotency: marker comments (@!include/@!include-ref/@!end-include) are STRUCTURALLY
    // non-resolvable — the `!` after `@` defeats RESOLVE_TOKEN's token group [A-Za-z0-9_./-] → zero
    // captures on re-scan → pass-1 is a fixed point (PRD §2.3 L26/L27).
    const pass2 = join(n2tmp, 'pass2.md');
    writeFileSync(pass2, out1);
    const out2 = await resolvePRD(pass2, { markers: true });
    expect(out2).toBe(out1);
  });

  it('BUG-001: markers are STRUCTURALLY non-resolvable — byte-idempotent even with marker-word collision files', async () => {
    // The marker comments contain `@!include` / `@!end-include` / `@!include-ref`. The `!` after `@`
    // is NOT in RESOLVE_TOKEN's token group [A-Za-z0-9_./-] → the group can't start → ZERO captures
    // on re-scan → pass-1 is a fixed point EVEN when real files named `include`/`end-include`/
    // `include-ref` exist in the PRD dir (the collision that would make a resolvable `@include`
    // expand on pass 2 and break idempotency). PRD §2.3 L26/L27.
    const coltmp = join(tmpdir(), 'bug001-collision-');
    const col = mkdtempSync(coltmp);
    writeFileSync(join(col, 'a.md'), 'A');
    writeFileSync(join(col, 'include'), 'COLLISION');
    writeFileSync(join(col, 'end-include'), 'COLLISION');
    writeFileSync(join(col, 'include-ref'), 'COLLISION');
    writeFileSync(join(col, 'main.md'), '@a.md');

    const o1 = await resolvePRD(join(col, 'main.md'), { markers: true });
    writeFileSync(join(col, 'pass2.md'), o1);
    const o2 = await resolvePRD(join(col, 'pass2.md'), { markers: true });
    expect(o2).toBe(o1); // byte-idempotent despite the collision files
    // The output must contain NO COLLISION text (proves markers did NOT expand on pass 2).
    expect(o2).not.toContain('COLLISION');
    rmSync(col, { recursive: true, force: true });
  });
});

describe('config/constants: getPrdIncludeMarkers', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns false for off spellings (unset/empty/0/false/no/off, case-insensitive, trimmed)', () => {
    vi.stubEnv(PRD_INCLUDE_MARKERS, '');
    expect(getPrdIncludeMarkers()).toBe(false);
    vi.stubEnv(PRD_INCLUDE_MARKERS, '0');
    expect(getPrdIncludeMarkers()).toBe(false);
    vi.stubEnv(PRD_INCLUDE_MARKERS, 'false');
    expect(getPrdIncludeMarkers()).toBe(false);
    vi.stubEnv(PRD_INCLUDE_MARKERS, 'no');
    expect(getPrdIncludeMarkers()).toBe(false);
    vi.stubEnv(PRD_INCLUDE_MARKERS, 'off');
    expect(getPrdIncludeMarkers()).toBe(false);
    vi.stubEnv(PRD_INCLUDE_MARKERS, 'FALSE');
    expect(getPrdIncludeMarkers()).toBe(false);
    vi.stubEnv(PRD_INCLUDE_MARKERS, ' 0 ');
    expect(getPrdIncludeMarkers()).toBe(false);
  });

  it('returns true for any other non-empty value (1/true/yes/on/ON/enable/trimmed)', () => {
    vi.stubEnv(PRD_INCLUDE_MARKERS, '1');
    expect(getPrdIncludeMarkers()).toBe(true);
    vi.stubEnv(PRD_INCLUDE_MARKERS, 'true');
    expect(getPrdIncludeMarkers()).toBe(true);
    vi.stubEnv(PRD_INCLUDE_MARKERS, 'yes');
    expect(getPrdIncludeMarkers()).toBe(true);
    vi.stubEnv(PRD_INCLUDE_MARKERS, 'on');
    expect(getPrdIncludeMarkers()).toBe(true);
    vi.stubEnv(PRD_INCLUDE_MARKERS, 'ON');
    expect(getPrdIncludeMarkers()).toBe(true);
    vi.stubEnv(PRD_INCLUDE_MARKERS, 'enable');
    expect(getPrdIncludeMarkers()).toBe(true);
    vi.stubEnv(PRD_INCLUDE_MARKERS, ' 1 ');
    expect(getPrdIncludeMarkers()).toBe(true);
  });

  it('returns false when unset', () => {
    delete process.env[PRD_INCLUDE_MARKERS];
    expect(getPrdIncludeMarkers()).toBe(false);
  });
});

// P1.M1.T2.S1 (bugfix 002_2b460dab1a1f, BUG-002 minor): the depth gate's stale-`.md` stderr warning.
// PRD §2.3 unconditionally: "A `.md` token that fails to resolve (stale include) MUST emit a stderr
// warning." The main recursive loop warns; the depth-gate path (neutralizeResolvableTokens) must
// warn too — so a typo'd deeply-nested `.md` include surfaces regardless of depth. Output bytes are
// UNCHANGED (the verbatim survivor is still emitted) → idempotency is preserved.
describe('resolvePRD — stale .md warning at the maxDepth gate (BUG-002)', () => {
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'prd-markers-gate-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('warns once for a stale .md token at the maxDepth gate', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // SETUP — g.md references a MISSING .md file; maxDepth=1 forces the gate on g's body.
    writeFileSync(join(tmp, 'g.md'), 'G @missing.md END');
    writeFileSync(join(tmp, 'main.md'), '@g.md');

    // EXECUTE — g expands at depth 1; its body (containing @missing.md) hits the depth-1 gate.
    const out = await resolvePRD(join(tmp, 'main.md'), { maxDepth: 1 });

    // VERIFY — exactly ONE stderr warning naming the stale token; output unchanged (verbatim survivor).
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('missing.md');
    expect(out).toBe('G @missing.md END');
  });

  it('does NOT warn for a non-.md token at the gate', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // SETUP — non-`.md` extension → not a stale-include per §2.3 (silent).
    writeFileSync(join(tmp, 'g.md'), 'G @missing.txt END');
    writeFileSync(join(tmp, 'main.md'), '@g.md');

    // EXECUTE
    await resolvePRD(join(tmp, 'main.md'), { maxDepth: 1 });

    // VERIFY — silent (the stale-`.md` warning is `.md`-only).
    expect(warn).not.toHaveBeenCalled();
  });

  it('elides (not warns) a resolvable token at the gate', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // SETUP — @h.md RESOLVES (h.md exists) → ELIDED at the gate (not a stale warning; a successful
    // resolution). Cross-checks the BUG-002 idempotency fix output (double space = elision artifact).
    writeFileSync(join(tmp, 'g.md'), 'G @h.md END');
    writeFileSync(join(tmp, 'h.md'), 'H');
    writeFileSync(join(tmp, 'main.md'), '@g.md');

    // EXECUTE
    const out = await resolvePRD(join(tmp, 'main.md'), { maxDepth: 1 });

    // VERIFY — silent (elision is a SUCCESSFUL resolution); @h.md ELIDED (double space).
    expect(warn).not.toHaveBeenCalled();
    expect(out).toBe('G  END');
  });

  it('warns for a stale .md in the entry at maxDepth = 0 (uniform edge)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // SETUP — maxDepth=0 fires the gate at the ENTRY (depth 0); the entry is NOT exempt.
    writeFileSync(join(tmp, 'main.md'), '@missing.md');

    // EXECUTE
    const out = await resolvePRD(join(tmp, 'main.md'), { maxDepth: 0 });

    // VERIFY — exactly ONE warning (uniform treatment at every depth); output unchanged.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('missing.md');
    expect(out).toBe('@missing.md');
  });
});
