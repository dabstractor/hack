/**
 * Unit tests for `parseHackFile` — the `.hack` (TOML 1.0) parse module (PRD §9.7.4).
 *
 * @remarks
 * Covers the parse-only contract (P2.M1.T1.S1): valid parse (type preservation), BOM
 * rejection, malformed-TOML rethrow (file path + parser line/column), duplicate-key
 * wrapping, empty/whitespace/comments-only → `{}`, and ENOENT propagation. Pure &
 * deterministic — operates on real TOML temp files under the OS tmpdir; no env mutation,
 * so it stays stable under the project's mandatory 100%-coverage gate.
 *
 * Branch map (research §7) → every branch of `src/config/hack-config.ts` is hit:
 * - parse-success (valid TOML)               → 'SHOULD parse a valid .hack …'
 * - BOM-throw (first-3-bytes 0xEF 0xBB 0xBF) → 'SHOULD reject a leading UTF-8 BOM …'
 * - TomlError-if (malformed TOML)            → 'SHOULD rethrow parse errors …'
 * - TomlError-if (duplicate key)             → 'SHOULD surface duplicate-key errors …'
 * - else-rethrow (ENOENT)                    → 'SHOULD let a missing file propagate …'
 * - empty→{} (empty/whitespace/comments)     → 'SHOULD return an empty object …' / 'SHOULD ignore TOML comments'
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { parseHackFile } from '../../../src/config/hack-config.js';

describe('config/hack-config: parseHackFile', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'hack-config-'));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // Per-test cleanup of any env/state (none used today, but keeps the suite hermetic).
  afterEach(() => {
    // no-op placeholder for future env-mutation cleanup
  });

  it('SHOULD parse a valid .hack into a ParsedHackConfig preserving types', () => {
    // SETUP — a real .hack mirroring the §9.7.5 schema (string / number / boolean)
    const path = join(dir, 'valid.hack');
    writeFileSync(
      path,
      '[harness]\nname = "pi"\n[pipeline]\nresearch_depth = 3\nparallel_research = true\n'
    );

    // EXECUTE
    const cfg = parseHackFile(path);

    // VERIFY — TOML types preserved as JS primitives (not stringified)
    expect(cfg.harness.name).toBe('pi'); // string
    expect(cfg.pipeline.research_depth).toBe(3); // number
    expect(cfg.pipeline.parallel_research).toBe(true); // boolean
  });

  it('SHOULD reject a leading UTF-8 BOM with a clear error naming the file', () => {
    // SETUP — raw BOM bytes (0xEF 0xBB 0xBF) followed by otherwise-valid TOML.
    // Must write via Buffer (a utf8 string would re-encode the BOM away).
    const path = join(dir, 'bom.hack');
    writeFileSync(
      path,
      Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from('[harness]\nname = "pi"\n'),
      ])
    );

    // EXECUTE & VERIFY — throws, message names the file + says "BOM"
    expect(() => parseHackFile(path)).toThrow(/BOM/);
    expect(() => parseHackFile(path)).toThrow(path);
  });

  it('SHOULD rethrow parse errors with the file path and parser line/column', () => {
    // SETUP — malformed TOML (unterminated table header) → smol-toml raises TomlError
    const path = join(dir, 'malformed.hack');
    writeFileSync(path, '[harness\nname = "pi"');

    // EXECUTE & VERIFY — wrapped error names the file AND includes line/column
    expect(() => parseHackFile(path)).toThrow(path);
    expect(() => parseHackFile(path)).toThrow(/line/i);
    expect(() => parseHackFile(path)).toThrow(/column/i);
  });

  it('SHOULD surface duplicate-key errors with the file path', () => {
    // SETUP — duplicate key in the same section → smol-toml raises TomlError; S1 wraps w/ path
    const path = join(dir, 'dup-key.hack');
    writeFileSync(path, '[harness]\nname = "pi"\nname = "claude-code"\n');

    // EXECUTE & VERIFY — wrapped error names the file
    expect(() => parseHackFile(path)).toThrow(path);
  });

  it('SHOULD return an empty object for an empty/whitespace-only file', () => {
    // SETUP — empty file AND whitespace-only file (both parse to {})
    const emptyPath = join(dir, 'empty.hack');
    const wsPath = join(dir, 'whitespace.hack');
    writeFileSync(emptyPath, '');
    writeFileSync(wsPath, '   \n  \t\n');

    // EXECUTE & VERIFY — NOT an error; returns {}
    expect(parseHackFile(emptyPath)).toEqual({});
    expect(parseHackFile(wsPath)).toEqual({});
  });

  it('SHOULD ignore TOML comments', () => {
    // SETUP — leading comment + inline comment; only the real key/value should surface
    const path = join(dir, 'comments.hack');
    writeFileSync(path, '# a comment\n[harness]\nname = "pi" # inline\n');

    // EXECUTE & VERIFY
    const cfg = parseHackFile(path);
    expect(cfg.harness.name).toBe('pi');
  });

  it('SHOULD let a missing file propagate (ENOENT)', () => {
    // SETUP — a path that does not exist (readFileSync throws ENOENT)
    const path = join(dir, 'nope.hack');

    // EXECUTE & VERIFY — ENOENT propagates (exercises the catch else-branch)
    expect(() => parseHackFile(path)).toThrow(/ENOENT/);
  });
});
