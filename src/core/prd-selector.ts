/**
 * Deterministic section-index generator for resolved PRD documents
 *
 * @module core/prd-selector
 *
 * @remarks
 * Maps PRD selector strings (`h2.0`, `h3.1`, `code.0`, `para.0`, `list.0`,
 * `table.0`, `quote.0`, …) to their corresponding section/block text, computed
 * over the **resolved** (include-expanded) PRD document. Consumed by the
 * PRP-generation path for selective PRD section extraction (PRD §4.2).
 *
 * **Selector dialect** (byte-compatible with the Architect agent's
 * `prd_index.txt` and `subtask.prd_selectors`):
 * - `h{1..6}.{N}` — the N-th heading of that level, counted **globally across
 *   the whole document** in source order (N is NOT reset per parent section).
 *   Level 0 (implicit "Introduction" content before the first heading) is
 *   NEVER emitted — there is no `h0` selector.
 * - `code.N` / `para.N` / `list.N` / `table.N` / `quote.N` — the N-th block of
 *   the given type, 0-indexed, global, in document order.
 *
 * **Input contract:** the caller passes the **already-resolved** PRD string
 * (produced by `resolvePRD` and materialized into `prd_snapshot.md`).
 * {@link generateSectionIndex} is synchronous, performs **no file I/O**, and is
 * a pure, deterministic function of its input. When a selector does not resolve
 * (absent or unknown), callers SHOULD fall back to the full PRD (PRD §4.2).
 *
 * **List-count caveat:** the deterministic rule "a list is a maximal run of
 * list-item lines" may diverge slightly from an LLM-authored `prd_index.txt`
 * (e.g. 58 vs 50). This is acceptable because (1) all live `prd_selectors` are
 * headings, which are byte-exact, and (2) S3 falls back to the full PRD on any
 * miss. Do not chase the LLM's exact count.
 *
 * @example
 * ```typescript
 * import { generateSectionIndex } from './core/prd-selector.js';
 *
 * const resolved = `# Title
 *
 * Intro paragraph.
 *
 * ## Section A
 *
 * Body text for section A.
 * `;
 *
 * const index = generateSectionIndex(resolved);
 * index.counts.h2; // 1
 * index.sections.get('h2.0'); // '## Section A\n\nBody text for section A.\n'
 * ```
 */

import { parsePRDSections, type PRDSection } from './prd-differ.js';

/**
 * Kind of an indexable PRD block/heading — forms the selector prefix.
 *
 * @remarks
 * The set of selector type strings: heading levels `h1`..`h6` plus the block
 * types `code`, `para`, `list`, `table`, `quote`.
 */
export type SelectorType =
  | 'h1'
  | 'h2'
  | 'h3'
  | 'h4'
  | 'h5'
  | 'h6'
  | 'code'
  | 'para'
  | 'list'
  | 'table'
  | 'quote';

/**
 * Deterministic index of a resolved PRD's sections (PRD §4.2).
 *
 * @remarks
 * Computed by {@link generateSectionIndex} over the include-EXPANDED (resolved)
 * document, so selector indices are stable regardless of `@path` include layout.
 * Selector syntax: `h{1..6}.{N}` (N-th heading of that level, global per level),
 * and `{code|para|list|table|quote}.{N}` (N-th block of that type, global).
 * Heading indices are byte-compatible with the Architect agent's `prd_index.txt`
 * and `subtask.prd_selectors`. When a selector does not resolve, callers SHOULD
 * fall back to the full PRD (PRD §4.2).
 */
export interface SectionIndex {
  /**
   * Selector (e.g. `'h3.4'`, `'code.0'`, `'para.5'`) → exact section/block
   * source text. Use `.get(selector)`; an absent selector indicates the caller
   * should fall back to the full PRD.
   */
  readonly sections: ReadonlyMap<string, string>;

  /**
   * Per-type totals, e.g.
   * `{ h1:1, h2:9, h3:24, h4:19, code:6, para:85, list:50, table:4, quote:1 }`.
   * Keys are present only for types that occur at least once.
   */
  readonly counts: Readonly<Record<string, number>>;
}

// ---- Line predicates / regexes (see research §3) ----

/** A fenced-code delimiter line: optional leading whitespace then ``` . */
const FENCE_RE = /^\s*```/;
/** A markdown ATX heading line: 1-6 `#` followed by whitespace. */
const HEADING_RE = /^#{1,6}\s+/;
/** A list-item line: `-`, `*`, `+`, or `N.` then whitespace. */
const LIST_ITEM_RE = /^\s*([-*+]|\d+\.)\s+/;
/** A GFM table row: starts and ends with `|`. */
const TABLE_ROW_RE = /^\|.*\|\s*$/;
/** A block-quote line: starts with `>`. */
const QUOTE_RE = /^>/;

/**
 * Computes the fenced-code line ranges of a document.
 *
 * @remarks
 * A fence is a line matching {@link FENCE_RE}; ranges toggle open/closed.
 * Returns 1-indexed inclusive `[start, end]` pairs. An unterminated fence is
 * dropped (no range) rather than treated as spanning to EOF — matching the
 * block walker, which only emits a `code` block when it sees a closing fence.
 *
 * @param lines - Document lines (0-indexed array).
 * @returns Array of `[startLine1, endLine1]` inclusive, 1-indexed pairs.
 */
function fencedRanges(lines: string[]): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let open: number | null = null;
  for (let i = 0; i < lines.length; i++) {
    if (FENCE_RE.test(lines[i])) {
      if (open === null) {
        open = i + 1; // 1-indexed start
      } else {
        ranges.push([open, i + 1]); // closed pair (1-indexed inclusive)
        open = null;
      }
    }
  }
  // An unterminated fence is intentionally not recorded as a range.
  return ranges;
}

/**
 * Reports whether a 1-indexed line number falls inside any fenced range.
 *
 * @param lineNo1 - 1-indexed line number to test.
 * @param ranges - Fenced ranges from {@link fencedRanges}.
 * @returns `true` if the line is inside a code fence.
 */
function inFence(
  lineNo1: number,
  ranges: ReadonlyArray<readonly [number, number]>
): boolean {
  return ranges.some(([s, e]) => lineNo1 >= s && lineNo1 <= e);
}

/**
 * Builds a deterministic section index over the **resolved** PRD (PRD §4.2).
 *
 * @remarks
 * Synchronous, pure, and performs no file I/O. The caller passes the
 * already-resolved PRD string (produced by `resolvePRD`); the index is computed
 * over that string so selector indices are stable regardless of `@path` include
 * layout.
 *
 * Headings (`h1`..`h6`) are indexed **globally per level** in document order,
 * excluding the implicit level-0 "Introduction" and any heading-like line that
 * falls inside a code fence. The heading section text is the exact source slice
 * from the heading's line through the line before the next heading of any level
 * (or EOF) — preserving the header line and body that the Researcher LLM sees.
 *
 * Blocks (`code`, `para`, `list`, `table`, `quote`) are indexed in a single
 * fence-aware line-walk; each block's text is its exact source lines. The list
 * count uses the deterministic "maximal run of list-item lines" rule and may
 * differ slightly from an LLM-authored `prd_index.txt` (acceptable — see the
 * module remarks and PRD §4.2's full-PRD fallback).
 *
 * @param resolvedPRD - The resolved (include-expanded) PRD markdown string.
 * @returns A {@link SectionIndex} mapping each selector to its source text plus
 * per-type totals. For empty/whitespace input, an empty index is returned.
 *
 * @example
 * ```typescript
 * const index = generateSectionIndex(resolvedPRD);
 * const sectionText = index.sections.get('h2.0');
 * if (sectionText === undefined) {
 *   // selector did not resolve → fall back to full PRD (PRD §4.2)
 * }
 * ```
 */
export function generateSectionIndex(resolvedPRD: string): SectionIndex {
  // Guard: empty or whitespace-only input → empty index.
  if (!resolvedPRD || resolvedPRD.trim().length === 0) {
    return { sections: new Map<string, string>(), counts: {} };
  }

  const lines = resolvedPRD.split('\n');
  const fences = fencedRanges(lines);
  const parsed: PRDSection[] = parsePRDSections(resolvedPRD);

  const sections = new Map<string, string>();
  const counts: Record<string, number> = {};

  // ---- Headings: global-per-level, exclude level 0, skip in-fence ----
  // realHeadings preserves DOCUMENT ORDER (parsePRDSections is order-stable).
  const realHeadings = parsed.filter(
    s => s.level >= 1 && s.level <= 6 && !inFence(s.lineNumber, fences)
  );

  for (let level = 1; level <= 6; level++) {
    let idx = 0;
    for (let pos = 0; pos < realHeadings.length; pos++) {
      const s = realHeadings[pos];
      if (s.level !== level) {
        continue; // assign idx only to this level, in document order
      }
      const start = s.lineNumber; // 1-indexed
      const overallNext = realHeadings[pos + 1]; // next heading of ANY level
      const end = overallNext ? overallNext.lineNumber - 1 : lines.length; // inclusive
      const text = lines.slice(start - 1, end).join('\n');
      sections.set(`h${level}.${idx}`, text);
      idx++;
    }
    if (idx > 0) {
      counts[`h${level}`] = idx;
    }
  }

  // ---- Blocks: single fence-aware walker; headings excluded ----
  const bump = (type: SelectorType, idx: number, text: string): void => {
    sections.set(`${type}.${idx}`, text);
    counts[type] = (counts[type] ?? 0) + 1;
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (FENCE_RE.test(line)) {
      // code block — consume through the closing fence
      const start = i;
      i++;
      while (i < lines.length && !FENCE_RE.test(lines[i])) {
        i++;
      }
      if (i < lines.length) {
        i++; // consume closing fence
      }
      bump('code', counts['code'] ?? 0, lines.slice(start, i).join('\n'));
      continue;
    }

    // Skip blank separators and heading lines (they belong to heading selectors)
    if (line.trim() === '' || HEADING_RE.test(line)) {
      i++;
      continue;
    }

    if (TABLE_ROW_RE.test(line)) {
      const start = i;
      while (i < lines.length && TABLE_ROW_RE.test(lines[i])) {
        i++;
      }
      bump('table', counts['table'] ?? 0, lines.slice(start, i).join('\n'));
      continue;
    }

    if (QUOTE_RE.test(line)) {
      const start = i;
      while (i < lines.length && QUOTE_RE.test(lines[i])) {
        i++;
      }
      bump('quote', counts['quote'] ?? 0, lines.slice(start, i).join('\n'));
      continue;
    }

    if (LIST_ITEM_RE.test(line)) {
      const start = i;
      while (i < lines.length && LIST_ITEM_RE.test(lines[i])) {
        i++;
      }
      bump('list', counts['list'] ?? 0, lines.slice(start, i).join('\n'));
      continue;
    }

    // paragraph — maximal run of non-blank, non-special lines
    const start = i;
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !FENCE_RE.test(lines[i]) &&
      !HEADING_RE.test(lines[i]) &&
      !LIST_ITEM_RE.test(lines[i]) &&
      !TABLE_ROW_RE.test(lines[i]) &&
      !QUOTE_RE.test(lines[i])
    ) {
      i++;
    }
    bump('para', counts['para'] ?? 0, lines.slice(start, i).join('\n'));
  }

  return { sections, counts };
}

/**
 * Extract the PRD sections referenced by `selectors` from the RESOLVED document
 * (PRD §4.2 "Selective PRD Section Extraction").
 *
 * @remarks
 * Builds a {@link SectionIndex} via {@link generateSectionIndex} and returns the
 * concatenated source text of ONLY the referenced sections, keeping the
 * Researcher's context focused. Sections are concatenated in SELECTOR order.
 *
 * **Fallback (all-or-nothing):** if `selectors` is empty/absent OR if ANY single
 * selector does not resolve in the index, the FULL `resolvedPRD` is returned.
 * A partial slice is never returned — a miss on one selector means the Researcher
 * gets the whole document rather than a confusing subset. In practice every live
 * selector is a heading that resolves byte-exact, so fallback is rare.
 *
 * SYNC, no file I/O — the caller passes the already-resolved (include-expanded)
 * PRD string (e.g. `sessionManager.currentSession.prdSnapshot`).
 *
 * @param resolvedPRD - The include-expanded PRD document string.
 * @param selectors - Section-index selectors (e.g. ['h2.1','h3.0']); [] ⇒ full PRD.
 * @returns Concatenated section text, or the full `resolvedPRD` on fallback.
 *
 * @example
 * ```typescript
 * const sections = extractPRDSections(resolvedPRD, subtask.prd_selectors);
 * // pass `sections` to createPRPBlueprintPrompt as prdSections
 * ```
 */
export function extractPRDSections(
  resolvedPRD: string,
  selectors: string[]
): string {
  if (!selectors || selectors.length === 0) return resolvedPRD;
  const { sections } = generateSectionIndex(resolvedPRD);
  const collected: string[] = [];
  for (const selector of selectors) {
    const text = sections.get(selector);
    if (text === undefined) return resolvedPRD; // any-miss ⇒ full-PRD fallback
    collected.push(text);
  }
  return collected.join('\n\n');
}
