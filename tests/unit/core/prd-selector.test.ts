/**
 * Unit tests for PRD section-index generator
 *
 * @remarks
 * Tests validate {@link generateSectionIndex} in src/core/prd-selector.ts with
 * 100% coverage. Covers every selector type (h1-h6, code, para, list, table,
 * quote), global-per-level heading indexing, level-0 exclusion, code-fence
 * safety, determinism, the SectionIndex shape, and empty/whitespace input.
 *
 * Pure function with no external dependencies.
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { describe, expect, it } from 'vitest';
import {
  generateSectionIndex,
  extractPRDSections,
  type SectionIndex,
} from '../../../src/core/prd-selector.js';

/**
 * Hand-counted fixture PRD covering every selector type:
 *
 * ```text
 * # Title              → h1.0
 * Intro paragraph.     → para.0
 * ## A                 → h2.0
 * Para in A.           → para.1
 * - item 1             → list.0
 * - item 2
 * ```ts                → code.0
 * code here
 * ```
 * ### A1               → h3.0
 * | col1 | col2 |      → table.0
 * |------|------|
 * | a    | b    |
 * > a quote            → quote.0
 * ## B                 → h2.1
 * Final para.          → para.2
 * ```
 *
 * Hand counts: h1:1, h2:2, h3:1, code:1, para:3, list:1, table:1, quote:1.
 */
const FIXTURE_PRD = [
  '# Title',
  'Intro paragraph.',
  '## A',
  'Para in A.',
  '- item 1',
  '- item 2',
  '```ts',
  'code here',
  '```',
  '### A1',
  '| col1 | col2 |',
  '|------|------|',
  '| a    | b    |',
  '> a quote',
  '## B',
  'Final para.',
].join('\n');

describe('generateSectionIndex', () => {
  describe('GIVEN a PRD with headings of multiple levels', () => {
    it('SHOULD index headings global-per-level (continuous across the doc)', () => {
      // EXECUTE
      const { counts, sections } = generateSectionIndex(FIXTURE_PRD);

      // VERIFY — per-level totals
      expect(counts.h1).toBe(1);
      expect(counts.h2).toBe(2);
      expect(counts.h3).toBe(1);

      // VERIFY — selectors resolve to the right headings
      expect(sections.get('h1.0')).toContain('# Title');
      expect(sections.get('h2.0')).toContain('## A');
      expect(sections.get('h2.1')).toContain('## B');
      expect(sections.get('h3.0')).toContain('### A1');
    });

    it('SHOULD map heading selectors to exact heading+body slice (header line included)', () => {
      // EXECUTE
      const { sections } = generateSectionIndex(FIXTURE_PRD);

      // VERIFY — h2.0 starts with its header and includes its body ...
      const h2_0 = sections.get('h2.0');
      expect(h2_0).toBeDefined();
      expect(h2_0!.startsWith('## A')).toBe(true);
      expect(h2_0!).toContain('Para in A.');
      // ... but ENDS before the next heading of any level (### A1)
      expect(h2_0!).not.toContain('### A1');

      // VERIFY — last heading's slice runs to EOF
      const h2_1 = sections.get('h2.1');
      expect(h2_1).toBeDefined();
      expect(h2_1!.startsWith('## B')).toBe(true);
      expect(h2_1!).toContain('Final para.');
    });
  });

  describe('GIVEN a PRD with code/para/list/table/quote blocks', () => {
    it('SHOULD index blocks globally in document order with exact source text', () => {
      // EXECUTE
      const { counts, sections } = generateSectionIndex(FIXTURE_PRD);

      // VERIFY — block counts match the hand-counted fixture
      expect(counts.code).toBe(1);
      expect(counts.para).toBe(3);
      expect(counts.list).toBe(1);
      expect(counts.table).toBe(1);
      expect(counts.quote).toBe(1);

      // code.0 includes both fence lines and the inner code
      const code0 = sections.get('code.0');
      expect(code0).toBeDefined();
      expect(code0!).toContain('```ts');
      expect(code0!).toContain('code here');
      expect(code0!.endsWith('```')).toBe(true);

      // list.0 includes the list items
      expect(sections.get('list.0')).toContain('- item 1');
      expect(sections.get('list.0')).toContain('- item 2');

      // table.0 includes the data row
      expect(sections.get('table.0')).toContain('| a');

      // quote.0 includes the quoted line
      expect(sections.get('quote.0')).toContain('> a quote');

      // para.2 is the final paragraph exactly
      expect(sections.get('para.2')).toBe('Final para.');

      // para.0 is the intro (content before first heading, NOT an h0 block)
      expect(sections.get('para.0')).toBe('Intro paragraph.');
    });
  });

  describe('GIVEN a PRD with content before the first header', () => {
    it('SHOULD NOT emit an h0 selector (level 0 is implicit)', () => {
      // EXECUTE
      const { sections } = generateSectionIndex(FIXTURE_PRD);

      // VERIFY — no h0.* selector exists
      const h0Key = [...sections.keys()].find(k => k.startsWith('h0.'));
      expect(h0Key).toBeUndefined();
    });
  });

  describe('GIVEN the same input twice', () => {
    it('SHOULD be deterministic (deep-equal across calls)', () => {
      // EXECUTE
      const first = generateSectionIndex(FIXTURE_PRD);
      const second = generateSectionIndex(FIXTURE_PRD);

      // VERIFY
      expect(second.sections.size).toBe(first.sections.size);
      expect(second.counts).toEqual(first.counts);
      for (const [key, value] of first.sections) {
        expect(second.sections.get(key)).toBe(value);
      }
    });
  });

  describe('GIVEN empty or whitespace-only input', () => {
    it('SHOULD return an empty index for an empty string', () => {
      // EXECUTE
      const result = generateSectionIndex('');

      // VERIFY
      expect(result.sections.size).toBe(0);
      expect(result.counts).toEqual({});
    });

    it('SHOULD return an empty index for whitespace-only input', () => {
      // EXECUTE
      const result = generateSectionIndex('   \n\t  \n  ');

      // VERIFY
      expect(result.sections.size).toBe(0);
      expect(result.counts).toEqual({});
    });
  });

  describe('GIVEN heading-like lines inside a code fence', () => {
    it('SHOULD skip in-fence headings (not counted as h{level})', () => {
      // SETUP — a fake h1 inside a fence plus a real h1 outside
      const prdWithFencedHeading = [
        '# Real',
        '```ts',
        '# fake heading',
        '```',
      ].join('\n');

      // EXECUTE
      const { counts } = generateSectionIndex(prdWithFencedHeading);

      // VERIFY — only the real heading counts
      expect(counts.h1).toBe(1);
    });
  });

  describe('GIVEN a heading with no following heading (EOF boundary)', () => {
    it('SHOULD slice the heading body through end-of-document', () => {
      // SETUP
      const prd = ['# Only', 'trailing body line'].join('\n');

      // EXECUTE
      const { sections } = generateSectionIndex(prd);

      // VERIFY
      const h1 = sections.get('h1.0');
      expect(h1).toBeDefined();
      expect(h1!.startsWith('# Only')).toBe(true);
      expect(h1!).toContain('trailing body line');
    });
  });

  describe('GIVEN the return value', () => {
    it('SHOULD be a SectionIndex with a Map sections and a counts record', () => {
      // EXECUTE
      const result = generateSectionIndex(FIXTURE_PRD);

      // VERIFY
      expect(result.sections).toBeInstanceOf(Map);
      expect(typeof result.counts).toBe('object');
      expect(result.counts).not.toBeNull();

      // Type is exported and usable
      const _typed: SectionIndex = result;
      expect(_typed).toBe(result);
    });
  });

  describe('GIVEN a PRD with ordered and numbered list items as separate lists', () => {
    it('SHOULD index consecutive list runs separated by non-list lines as distinct lists', () => {
      // SETUP — two separate lists split by a paragraph
      const prd = [
        '- first list',
        'paragraph between',
        '1. second list',
        '2. continues',
      ].join('\n');

      // EXECUTE
      const { counts, sections } = generateSectionIndex(prd);

      // VERIFY
      expect(counts.list).toBe(2);
      expect(sections.get('list.0')).toContain('- first list');
      expect(sections.get('list.1')).toContain('1. second list');
      expect(sections.get('list.1')).toContain('2. continues');
    });
  });
});

/**
 * Fixture PRD for extractPRDSections with two known h2 sections (h2.0, h2.1)
 * plus a third h2 (h2.2) used to assert non-referenced sections are excluded.
 *
 * ```text
 * # Title            → h1.0
 * ## First           → h2.0  (body: "first body")
 * ## Second          → h2.1  (body: "second body")
 * ## Third           → h2.2  (body: "third body")
 * ```
 */
const EXTRACTION_PRD = [
  '# Title',
  '## First',
  'first body',
  '## Second',
  'second body',
  '## Third',
  'third body',
].join('\n');

describe('extractPRDSections', () => {
  describe('GIVEN empty or absent selectors', () => {
    it('SHOULD return the full PRD when selectors is an empty array', () => {
      // EXECUTE
      const out = extractPRDSections(EXTRACTION_PRD, []);

      // VERIFY — empty selectors ⇒ full PRD (fallback)
      expect(out).toBe(EXTRACTION_PRD);
    });

    it('SHOULD return the full PRD when selectors is undefined/null-ish', () => {
      // EXECUTE — guard `!selectors` catches undefined/null
      const outUndefined = extractPRDSections(EXTRACTION_PRD, undefined as any);
      const outNull = extractPRDSections(EXTRACTION_PRD, null as any);

      // VERIFY
      expect(outUndefined).toBe(EXTRACTION_PRD);
      expect(outNull).toBe(EXTRACTION_PRD);
    });
  });

  describe('GIVEN selectors that all resolve', () => {
    it('SHOULD return the concatenated section text in selector order', () => {
      // EXECUTE
      const out = extractPRDSections(EXTRACTION_PRD, ['h2.0', 'h2.1']);

      // VERIFY — both referenced sections are present
      expect(out).toContain('## First');
      expect(out).toContain('first body');
      expect(out).toContain('## Second');
      expect(out).toContain('second body');

      // VERIFY — selector order preserved (h2.0 before h2.1)
      expect(out.indexOf('## First')).toBeLessThan(out.indexOf('## Second'));

      // VERIFY — non-referenced section (h2.2) is excluded
      expect(out).not.toContain('## Third');
      expect(out).not.toContain('third body');
    });

    it('SHOULD join sections with a blank line separator', () => {
      // EXECUTE
      const out = extractPRDSections(EXTRACTION_PRD, ['h2.0', 'h2.1']);

      // VERIFY — the two sections are separated by '\n\n'
      const firstSection = extractPRDSections(EXTRACTION_PRD, ['h2.0']);
      const secondSection = extractPRDSections(EXTRACTION_PRD, ['h2.1']);
      expect(out).toBe(`${firstSection}\n\n${secondSection}`);
    });

    it('SHOULD return exactly one section when one selector resolves', () => {
      // EXECUTE
      const out = extractPRDSections(EXTRACTION_PRD, ['h2.1']);

      // VERIFY — equals the single section's text (no join for one item)
      const expected =
        generateSectionIndex(EXTRACTION_PRD).sections.get('h2.1');
      expect(out).toBe(expected);
    });
  });

  describe('GIVEN selectors where ANY single selector misses', () => {
    it('SHOULD fall back to the full PRD (all-or-nothing)', () => {
      // EXECUTE — 'zzz.9' does not exist; any-miss ⇒ full PRD
      const out = extractPRDSections(EXTRACTION_PRD, ['h2.0', 'zzz.9']);

      // VERIFY — full PRD returned, NOT a partial slice
      expect(out).toBe(EXTRACTION_PRD);
      expect(out).toContain('## Third'); // confirms it's the full doc, not just h2.0
    });

    it('SHOULD fall back to the full PRD when the FIRST selector misses', () => {
      // EXECUTE
      const out = extractPRDSections(EXTRACTION_PRD, ['zzz.9', 'h2.0']);

      // VERIFY
      expect(out).toBe(EXTRACTION_PRD);
    });

    it('SHOULD fall back to the full PRD when the ONLY selector misses', () => {
      // EXECUTE
      const out = extractPRDSections(EXTRACTION_PRD, ['zzz.9']);

      // VERIFY
      expect(out).toBe(EXTRACTION_PRD);
    });
  });

  describe('GIVEN the same inputs twice', () => {
    it('SHOULD be deterministic (deep-equal across calls)', () => {
      // EXECUTE
      const first = extractPRDSections(EXTRACTION_PRD, ['h2.0', 'h2.1']);
      const second = extractPRDSections(EXTRACTION_PRD, ['h2.0', 'h2.1']);

      // VERIFY
      expect(second).toBe(first);
    });
  });
});
