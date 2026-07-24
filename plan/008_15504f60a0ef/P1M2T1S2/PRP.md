# PRP — P1.M2.T1.S2: Section index generator over resolved document

---

## Goal

**Feature Goal**: Create a deterministic, synchronous section-index generator that
maps PRD selector strings (`h2.0`, `h3.1`, `code.0`, `para.0`, `list.0`,
`table.0`, `quote.0`, …) to their corresponding section/block text, computed over
the **resolved** (include-expanded) PRD document. It reuses `parsePRDSections()`
from `prd-differ.ts` as the heading primitive and adds block-level parsing for
code/paragraph/list/table/quote. Its selector scheme is byte-compatible with the
selectors the Architect agent emits into `subtask.prd_selectors` and `prd_index.txt`
(verified — see Context). Consumed by P1.M2.T1.S3 (selector extraction at
PRP-generation time, with full-PRD fallback).

**Deliverable**:
1. **`src/core/prd-selector.ts`** — **CREATE**: exports `generateSectionIndex(resolvedPRD: string): SectionIndex`, the `SectionIndex` interface, and a supporting `SelectorType` type. Reuses `parsePRDSections` + `PRDSection` from `./prd-differ.js`. Mode-A JSDoc documents selector syntax + the resolved-document requirement.
2. **`src/core/index.ts`** — **EDIT**: re-export `generateSectionIndex`, `SectionIndex`, `SelectorType` from `./prd-selector.js` (follow the existing prd-differ re-export pattern at lines 31-36 / 65).
3. **`tests/unit/core/prd-selector.test.ts`** — **CREATE**: implicit-TDD suite covering every selector type, per-level-global heading indexing, determinism, code-fence safety, and the `SectionIndex` shape. 100% coverage of the new module.

**Success Definition**:
- `generateSectionIndex(resolvedPRD)` is **synchronous**, takes the resolved PRD **string**, does **no file I/O**, and is deterministic (same string ⇒ same index).
- Heading selectors `h{1..6}.{N}` use a **global-per-level** index (N counts all headings of that level in document order, NOT reset per parent). Verified to reproduce `prd_index.txt` heading counts on the resolved snapshot: `{h1:1, h2:9, h3:24, h4:19}`.
- Block selectors `code.N` / `para.N` / `list.N` / `table.N` / `quote.N` enumerate blocks of each type globally in document order. Counts for `code`/`para`/`table`/`quote` reproduce `prd_index.txt` exactly on the resolved snapshot (`code:6 para:85 table:4 quote:1`); `list` is best-effort (see Context §3 caveat).
- `sections.get(selector)` returns the exact source slice for the heading/block; `counts` records per-type totals.
- `npm run validate` passes; `npm run test:run` passes with **100% coverage** on `src/core/prd-selector.ts`.

---

## Why

- **PRD §4.2 mandates selective extraction.** Each subtask carries `prd_selectors` so the Researcher receives only the referenced sections instead of the full document. S1 models the field; **this task builds the resolver** that turns a selector string into actual section text; S3 wires extraction + full-PRD fallback. Without the generator, S3 has nothing to look selectors up against.
- **The selector scheme is already fixed by the Architect agent.** `prd_index.txt` and the live `tasks.json` `prd_selectors` already use `h{level}.{globalN}` + `{type}.{N}`. The generator MUST speak that exact dialect or lookups silently miss and fall back to the full PRD (defeating the feature). This PRP nails the dialect from empirical proof, not guesswork.
- **Resolved-document invariant (PRD §2.3 / §4.1).** The index is computed over the **resolved** document so `h3.N` / `code.N` indices are stable regardless of how many `@path` includes the raw PRD scattered across. The resolver (`resolvePRD`, session-utils.ts:564) already materializes the resolved string into `prd_snapshot.md`; the generator consumes that string.
- **Reuse, don't fork, the parser.** `parsePRDSections()` already detects h1-h6 headings correctly (counts match the Architect exactly). Reusing it keeps one parsing primitive; layering block parsing on top avoids touching the diff-oriented `prd-differ.ts`.
- **Out of scope (hard boundary):** selector extraction + full-PRD fallback (S3), populating `prd_selectors` (Architect agent), writing `prd_index.txt` (Architect agent), modifying `prd-differ.ts`, any `docs/*.md` (DOCS = Mode A: JSDoc only).

---

## What

### User-visible behavior
None at the CLI/runtime surface. This is a pure library function + type. Observable
only via import: a caller can now turn a resolved PRD string into a
selector→section-text map. No env vars, no I/O, no network.

### Technical requirements (exact contract)

**`src/core/prd-selector.ts`** exports:

```ts
/** Kind of an indexable PRD block/heading — forms the selector prefix. */
export type SelectorType =
  | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
  | 'code' | 'para' | 'list' | 'table' | 'quote';

/**
 * Deterministic index of a resolved PRD's sections (PRD §4.2).
 * Computed by generateSectionIndex over the include-expanded document.
 */
export interface SectionIndex {
  /** selector (e.g. 'h3.4', 'code.0', 'para.5') → exact section/block text. */
  readonly sections: ReadonlyMap<string, string>;
  /** per-type totals, e.g. { h1:1, h2:9, h3:24, code:6, para:85, list:50, table:4, quote:1 }. */
  readonly counts: Readonly<Record<string, number>>;
}

export function generateSectionIndex(resolvedPRD: string): SectionIndex;
```

**`generateSectionIndex` logic** (single deterministic pass; SYNC; no I/O):

1. Guard: `if (!resolvedPRD || resolvedPRD.trim().length === 0) return { sections: new Map(), counts: {} }`.
2. `const sections = parsePRDSections(resolvedPRD);` (reuse the primitive).
3. Compute fenced-code **line ranges** (a fence is a line matching `^\s*````;
   toggle in/out). Used to (a) skip heading lines that fall inside a fence — matches
   how a rendered doc is read — and (b) drive the code-block counter.
4. **Headings** → `h{level}.{N}`: for each level L in 1..6, enumerate the `sections`
   with `level === L` whose `lineNumber` is NOT inside a fence, in document order,
   index 0,1,2,…. The section TEXT = the exact source slice `[lineNumber, nextHeadingLineNumber-1]`
   (or EOF). **Exclude level 0** (implicit "Introduction" — no `h0` selector).
5. **Blocks** → walk lines with fence-state tracking; classify into:
   - `code.N` — fence pair → exact fenced lines (incl. the ``` fences).
   - `table.N` — maximal run of `^\|.*\|\s*$` lines.
   - `quote.N` — maximal run of `^>`-prefixed lines.
   - `list.N` — maximal run of list-item lines `^\s*([-*+]|\d+\.)\s+`.
   - `para.N` — maximal run of non-blank lines that are not a heading/fence/list-item/table-row/quote.
   Counters are global per type, 0-indexed, in document order. TEXT = exact source lines.
6. Build `sections` Map and `counts` Record; return `{ sections, counts }`.

**`src/core/index.ts`** — add (mirroring the existing `prd-differ.js` re-export block):

```ts
export { generateSectionIndex } from './prd-selector.js';
export type { SectionIndex, SelectorType } from './prd-selector.js';
```

### Success Criteria
- [ ] `generateSectionIndex` is exported, SYNC, takes `string`, returns `SectionIndex`, no I/O.
- [ ] Headings indexed **global-per-level**; on the resolved snapshot, `counts` is
      `{h1:1, h2:9, h3:24, h4:19}` (h5/h6/code/para/list/table/quote present as applicable).
- [ ] `sections.get('h3.4')` returns the "4.2 The Execution Loop" heading + body; the
      exact `h3.4`/`h3.3` selectors this very subtask was assigned resolve correctly.
- [ ] `code.N`/`para.N`/`table.N`/`quote.N` counts reproduce `prd_index.txt`
      (`code:6 para:85 table:4 quote:1`) on the resolved snapshot.
- [ ] Determinism: `generateSectionIndex(x)` deep-equals itself across calls.
- [ ] `npm run validate` exits 0; `npm run test:run` exits 0; `src/core/prd-selector.ts` 100% covered.

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_
**Yes** — the selector dialect is proven empirically (heading counts + live
selectors), the parsing primitive is named with its line number and verified
behavior, the block definitions are spelled out with the exact regexes, the
resolved-document input contract is traced to `resolvePRD`, the test pattern file
is named, and every non-obvious trap (code-fence blind spot, list-count fuzziness,
"selectors are headings in practice", level-0 exclusion, no-I/O/sync invariant,
disjointness from S1/S3) is documented with proof pointers in the research note.

### Documentation & References
```yaml
# MUST READ — PRD spec (the feature's reason)
- docfile: PRD.md
  section: "4.2 The Execution Loop (The "Inner Loop")" (h3.4) → step 2 "Selective PRD Section Extraction"
  why: Defines prd_selectors as selector strings computed from a generated PRD section index;
       Researcher receives only referenced sections; absent/failed → full-PRD fallback.
  critical: This task builds the INDEX/RESOLVER. S1 added the field; S3 does extraction + fallback.

# MUST READ — this subtask's research (the proven dialect + traps)
- docfile: plan/008_15504f60a0ef/P1M2T1S2/research/selector-scheme-and-block-parsing.md
  section: "1. The selector scheme", "2. parsePRDSections ... code-fence-SAFE here",
           "3. Block parsing", "4. The resolved-document invariant", "5. Section TEXT"
  why: Empirical proof that heading indices are global-per-level and match parsePRDSections
        counts {1,9,24,19}; the working block definitions (code/para/table/quote exact,
        list best-effort); the resolved-doc/no-I/O/sync contract; the list-count caveat and
        WHY it's acceptable (zero block selectors in practice + S3 fallback).

# MUST READ — architecture (authoritative current state)
- docfile: plan/008_15504f60a0ef/architecture/phase_findings.md
  section: "PHASE 1 — ... Section Index / prd_selectors"
  why: "Reuse parsePRDSections() (prd-differ.ts:179) as a base"; "Section index must run over
        the RESOLVED document (materialized copy)"; "Extraction at PRP-generation time ...
        Fallback: full PRD when selectors absent/extraction fails."

# THE PARSING PRIMITIVE (reuse, do NOT modify)
- file: src/core/prd-differ.ts
  why: parsePRDSections (line 179) + PRDSection interface (line 49). Import both from './prd-differ.js'.
  pattern: "export function parsePRDSections(prd: string): PRDSection[] { ... /^(#{1,6})\s+(.+)$/ ... }"
  critical: It is diff-oriented and returns content WITHOUT the header line. Reconstruct the heading
            section TEXT by slicing source lines [lineNumber, nextHeadingLineNumber-1]. EXCLUDE level 0.
  gotcha: Its header regex would match '# comment' inside a ``` fence; compute fenced ranges and SKIP
          such headings (no-op for the live resolved doc — 0 such lines — but correct for other PRDs).
          Do NOT edit prd-differ.ts (it owns diffPRDs/hasSignificantChanges for the delta workflow).

# THE RESOLVED-DOCUMENT SOURCE (input contract)
- file: src/core/session-utils.ts
  why: resolvePRD(prdPath): Promise<string> (line 564) produces the resolved string;
        writePRDSnapshot({resolvedContent}) (line 1040) materializes prd_snapshot.md. The generator
        consumes the resolved STRING the caller already holds — it does NO file I/O itself.
  pattern: "const resolved = await resolvePRD(prdPath); // §2.3: hash the resolved document"

# PATTERN FILES — copy conventions exactly
- file: src/core/index.ts
  why: Barrel re-export. Add the prd-selector exports next to the existing prd-differ block (lines 31-36, 65).
  pattern: "export { diffPRDs, hasSignificantChanges, parsePRDSections, normalizeMarkdown } from './prd-differ.js';"
  gotcha: Use `export type { ... }` for interfaces/types (the file already separates value vs type exports).

- file: tests/unit/core/prd-differ.test.ts
  why: Test-style template — vitest, BDD describe('GIVEN …')/it('SHOULD …'), expect(...).toEqual({...}),
        toHaveLength. Mirror for the new prd-selector.test.ts.
  pattern: "describe('parsePRDSections()', () => { describe('GIVEN a PRD with ...', () => { it('SHOULD ...', ...)})})"

# CONSUMERS (read-only — proves non-breaking + what uses it next)
- file: plan/008_15504f60a0ef/prd_index.txt
  why: The Architect-agent index format (the dialect to match). Heading lines + a summary line
        "code:6 para:85 list:50 table:4 quote:1". The generator's counts field mirrors this summary.
- file: plan/008_15504f60a0ef/P1M2T1S1/PRP.md
  why: S1 (parallel) adds the prd_selectors field to Subtask/SubtaskSchema. S2 consumes nothing from
        S1 at runtime; S2 is FILE-DISJOINT from S1 (models.ts/fix-cycle-workflow.ts/models.test.ts).
- file: plan/008_15504f60a0ef/tasks.json
  why: PROOF that real selectors are headings — all 63 prd_selectors are h2.N/h3.N/h4.N (zero blocks).
        This is why list-count fuzziness is acceptable (block lookups never happen in practice today).
```

### Current Codebase tree (relevant slice)
```bash
src/core/
├── prd-differ.ts     # REUSE (import parsePRDSections, PRDSection) — DO NOT EDIT
├── session-utils.ts  # REFERENCE — resolvePRD/writePRDSnapshot (input contract); DO NOT EDIT
├── index.ts          # EDIT — re-export generateSectionIndex + SectionIndex + SelectorType
└── prd-selector.ts   # ← THIS SUBTASK CREATES
tests/unit/core/
└── prd-selector.test.ts   # ← THIS SUBTASK CREATES
```

### Desired Codebase tree with files to be added/edited
```bash
src/core/prd-selector.ts            # NEW — generateSectionIndex + SectionIndex + SelectorType (+JSDoc)
src/core/index.ts                   # EDIT — +3 re-export lines (value + type)
tests/unit/core/prd-selector.test.ts # NEW — selector dialect + determinism + 100% coverage
```

### Known Gotchas of our codebase & Library Quirks
```ts
// CRITICAL — selector dialect is FIXED by the Architect agent. Heading index is GLOBAL-PER-LEVEL
//   (h3.0..h3.23 across the whole doc, NOT reset per h2 parent). Verified: parsePRDSections counts
//   {1:1,2:9,3:24,4:19} == prd_index.txt. Assign h{L}.{N} by filtering sections to level===L in order.

// CRITICAL — EXCLUDE level 0. parsePRDSections returns a level-0 "Introduction" for content before
//   the first header. prd_index.txt has NO h0 selector. Do not emit h0.N.

// CRITICAL — parsePRDSections returns content WITHOUT the header line. Reconstruct the heading
//   section TEXT by slicing the source: [section.lineNumber, nextSection.lineNumber - 1] (or EOF).
//   This preserves the exact header + body the Researcher LLM should see.

// CRITICAL — SYNC, NO I/O. generateSectionIndex(resolvedPRD: string): SectionIndex. The resolved
//   string is ALREADY materialized by the caller (resolvePRD → prd_snapshot.md). Do not read files,
//   do not return a Promise. Determinism = pure function of the input string.

// CRITICAL — CODE-FENCE SAFETY. parsePRDSections' regex /^(#{1,6})\s+(.+)$/ would treat '# comment'
//   inside a ``` block as a heading. For the live resolved doc there are 0 such lines (verified),
//   but for other PRDs: compute fenced line-ranges and SKIP any heading whose lineNumber is in a
//   fence. The block walker MUST also track fence state so '# ...'/ '| ...|' lines inside fences
//   are not counted as headings/tables/paras.

// GOTCHA — list counting is FUZZY (deterministic rule gives 58; Architect's prd_index.txt says 50).
//   This is ACCEPTABLE: (1) zero block selectors exist in live tasks.json (all 63 are headings);
//   (2) headings are byte-exact; (3) S3 falls back to the full PRD when a selector doesn't resolve
//   (PRD §4.2). Document the rule (maximal run of list-item lines) + the caveat in JSDoc. Do NOT
//   chase the LLM's exact 50.

// GOTCHA — 100% coverage enforced (vitest.config.ts include=src/**/*.ts, thresholds 100). The new
//   module must be fully exercised: empty input, every selector type, code-fence skip branch,
//   level-0 exclusion, EOF heading boundary. One focused fixture PRD with hand-counted selectors
//   covers all branches deterministically.

// GOTCHA — prettier is ERROR-enforced (format:check). Run `npm run fix` before `npm run validate`.
//   Match src/core/*.ts conventions (JSDoc @module/@remarks/@example, `as const`, trailing commas).

// CRITICAL — DISJOINT from the parallel P1.M2.T1.S1 (models.ts/fix-cycle-workflow.ts/models.test.ts)
//   and from P1.M1.T2.S3 (prompts). Do NOT touch those files. Do NOT modify prd-differ.ts.
//   Do NOT write prd_index.txt (Architect agent's job) or docs/*.md (Mode A = JSDoc only).
```

---

## Implementation Blueprint

### Data models and structure

```ts
// src/core/prd-selector.ts
import { parsePRDSections, type PRDSection } from './prd-differ.js';

/** Kind of an indexable PRD block/heading — forms the selector prefix. */
export type SelectorType =
  | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
  | 'code' | 'para' | 'list' | 'table' | 'quote';

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
  /** selector → exact section/block source text. Use .get(selector); absent ⇒ fallback. */
  readonly sections: ReadonlyMap<string, string>;
  /** per-type totals (e.g. { h1:1, h2:9, h3:24, h4:19, code:6, para:85, list:50, table:4, quote:1 }). */
  readonly counts: Readonly<Record<string, number>>;
}
```

### Implementation Tasks (ordered by dependencies — implicit TDD: RED first, then GREEN)
```yaml
Task 1: CREATE tests/unit/core/prd-selector.test.ts   (RED — must fail before impl)
  - IMPORT: { describe, it, expect } from 'vitest';
            generateSectionIndex, type SectionIndex from '../../../src/core/prd-selector.js'.
  - FOLLOW pattern: tests/unit/core/prd-differ.test.ts (BDD describe('GIVEN …')/it('SHOULD …'),
    expect(...).toEqual / toHaveLength / toBeInstanceOf(Map)).
  - FIXTURE: a small hand-counted PRD string covering every selector type, e.g.:
        # Title              → h1.0
        Intro paragraph.     → para.0
        ## A                 → h2.0
        Para in A.           → para.1
        - item 1             → list.0
        - item 2
        ```ts                → code.0
        code here
        ```
        ### A1               → h3.0
        | col1 | col2 |      → table.0
        |------|------|
        | a    | b    |
        > a quote            → quote.0
        ## B                 → h2.1
        Final para.          → para.2
    Hand-counted: h1:1, h2:2, h3:1, code:1, para:3, list:1, table:1, quote:1.
  - CASES (minimum):
      * 'SHOULD index headings global-per-level': counts.h1===1, h2===2, h3===1;
        sections.get('h2.0') includes '## A'; sections.get('h2.1') includes '## B';
        sections.get('h3.0') includes '### A1'.
      * 'SHOULD map heading selectors to exact heading+body slice': sections.get('h2.0')
        starts with '## A' and includes 'Para in A.'; the slice ENDS before '### A1'.
      * 'SHOULD index code/para/list/table/quote blocks globally': counts match the hand counts;
        sections.get('code.0') includes the ``` fences + 'code here';
        sections.get('list.0') includes '- item 1'; sections.get('table.0') includes '| a';
        sections.get('quote.0') includes '> a quote'; sections.get('para.2') === 'Final para.'.
      * 'SHOULD NOT emit an h0 selector for content before the first header':
        expect([...sections.keys()].find(k=>k.startsWith('h0.'))).toBeUndefined();
        (the 'Intro paragraph.' is para.0, not an h0).
      * 'SHOULD be deterministic': generateSectionIndex(prd) deep-equals itself (call twice).
      * 'SHOULD return empty index for empty/whitespace input':
        generateSectionIndex('').sections.size === 0; generateSectionIndex('   ').counts === {}.
      * 'SHOULD skip heading-like lines inside a code fence': a PRD with '# fake' inside ```
        does NOT produce an extra h1 (counts.h1 reflects only real headings).
      * 'SHOULD return a SectionIndex with a ReadonlyMap sections and counts record':
        result.sections instanceof Map; typeof result.counts === 'object'.
  - NAMING: describe('generateSectionIndex'); BDD it('SHOULD …').
  - PLACEMENT: tests/unit/core/prd-selector.test.ts
  - EXPECTED NOW: import fails (module absent) → RED.

Task 2: CREATE src/core/prd-selector.ts   (GREEN — the generator)
  - IMPORT: { parsePRDSections, type PRDSection } from './prd-differ.js'.
  - EXPORT: type SelectorType, interface SectionIndex, function generateSectionIndex.
  - IMPLEMENT the 6-step logic in "Technical requirements". Helpers (module-private):
      * fencedRanges(lines): Array<[number,number]> — pairs of (startLine,endLine) 1-indexed,
        toggling on /^\s*```/. Used to test whether a heading lineNumber is inside a fence.
      * isHeading/isListItem/isTableRow/isQuote/isFence line predicates (see Context §3 regexes).
      * sliceLines(lines, start1, end1Inclusive): exact source slice.
  - HEADING TEXT: for each heading section (level 1..6, not in a fence), end =
    (next section's lineNumber - 1) or lines.length; selector `h${level}.${idx}` where idx is
    the per-level counter; text = sliceLines(...). Push to a temp array; assign idx after filtering
    by level so the global-per-level order is correct.
  - BLOCKS: single line-walker with fence-state; on each boundary, emit the selector + text and
    bump the per-type counter. Skip lines that are headings (they belong to heading selectors) and
    blank lines (separators). Track fence state so in-fence content is never misclassified.
  - ASSEMBLE: sections = new Map(entries); counts = Object.fromEntries(type→count). Return {sections, counts}.
  - JSDOC (Mode A): on generateSectionIndex AND SectionIndex, document the selector syntax
    (h{1..6}.{N} global-per-level; code.N/para.N/list.N/table.N/quote.N), the resolved-document
    requirement (no I/O; caller passes resolved string), the §4.2 fallback guidance, and the
    list-count caveat. @example on generateSectionIndex showing a tiny PRD → sections.get('h2.0').
  - EXPECTED: prd-selector.test.ts turns GREEN; 100% coverage of prd-selector.ts.

Task 3: EDIT src/core/index.ts   (barrel re-export)
  - ADD next to the existing prd-differ re-export block:
        export { generateSectionIndex } from './prd-selector.js';
        export type { SectionIndex, SelectorType } from './prd-selector.js';
  - DO NOT reorder/edit existing exports.
  - EXPECTED: `import { generateSectionIndex } from './core/index.js'` works; typecheck green.

Task 4: FORMAT + VERIFY
  - RUN: npm run fix; then npm run validate; then
    npx vitest run tests/unit/core/prd-selector.test.ts --coverage; then npm run test:run.
  - EXPECTED: all green, 100% coverage on src/core/prd-selector.ts, no regression.
    If coverage < 100%, an empty-input / fence-skip / EOF-boundary branch is unexercised — add the case.
```

### Implementation Patterns & Key Details
```ts
// ---- src/core/prd-selector.ts (reference skeleton) ----
import { parsePRDSections, type PRDSection } from './prd-differ.js';

export type SelectorType =
  | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
  | 'code' | 'para' | 'list' | 'table' | 'quote';

export interface SectionIndex {
  readonly sections: ReadonlyMap<string, string>;
  readonly counts: Readonly<Record<string, number>>;
}

const FENCE_RE = /^\s*```/;
const HEADING_RE = /^#{1,6}\s+/;
const LIST_ITEM_RE = /^\s*([-*+]|\d+\.)\s+/;
const TABLE_ROW_RE = /^\|.*\|\s*$/;
const QUOTE_RE = /^>/;

function fencedRanges(lines: string[]): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let open: number | null = null;
  for (let i = 0; i < lines.length; i++) {
    if (FENCE_RE.test(lines[i])) {
      if (open === null) open = i + 1;            // 1-indexed start
      else { ranges.push([open, i + 1]); open = null; } // closed pair
    }
  }
  return ranges;
}
function inFence(lineNo1: number, ranges: Array<[number, number]>): boolean {
  return ranges.some(([s, e]) => lineNo1 >= s && lineNo1 <= e);
}

/**
 * Build a deterministic section index over the RESOLVED PRD (PRD §4.2).
 * …(Mode-A JSDoc: selector syntax, resolved-doc requirement, list caveat, §4.2 fallback)…
 */
export function generateSectionIndex(resolvedPRD: string): SectionIndex {
  if (!resolvedPRD || resolvedPRD.trim().length === 0) {
    return { sections: new Map<string, string>(), counts: {} };
  }
  const lines = resolvedPRD.split('\n');
  const fences = fencedRanges(lines);
  const parsed: PRDSection[] = parsePRDSections(resolvedPRD);

  const sections = new Map<string, string>();
  const counts: Record<string, number> = {};

  // --- Headings (global-per-level, exclude level 0, skip in-fence) ---
  // realHeadings is in DOCUMENT ORDER (parsePRDSections preserves it).
  const realHeadings = parsed.filter(
    s => s.level >= 1 && s.level <= 6 && !inFence(s.lineNumber, fences)
  );
  // Pre-compute, for each real heading, the slice END = line before the NEXT heading OVERALL
  // (any level), or EOF. (The section text spans until the next heading of ANY level.)
  for (let level = 1; level <= 6; level++) {
    let idx = 0;
    for (let pos = 0; pos < realHeadings.length; pos++) {
      const s = realHeadings[pos];
      if (s.level !== level) continue;       // assign idx only to this level, in document order
      const start = s.lineNumber;            // 1-indexed
      const overallNext = realHeadings[pos + 1]; // next heading OVERALL (any level)
      const end = overallNext ? overallNext.lineNumber - 1 : lines.length; // 1-indexed inclusive
      const text = lines.slice(start - 1, end).join('\n'); // start-1 converts 1→0 indexed
      sections.set(`h${level}.${idx}`, text);
      idx++;
    }
    if (idx > 0) counts[`h${level}`] = idx;
  }

  // --- Blocks (single walker; fence-aware; headings excluded) ---
  const bump = (type: string, idx: number, text: string) => {
    sections.set(`${type}.${idx}`, text);
    counts[type] = (counts[type] ?? 0) + 1;
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (FENCE_RE.test(line)) {                          // code block
      const start = i;
      i++; while (i < lines.length && !FENCE_RE.test(lines[i])) i++;
      if (i < lines.length) i++;                        // consume closing fence
      bump('code', counts['code'] ?? 0, lines.slice(start, i).join('\n'));
      continue;
    }
    if (line.trim() === '' || HEADING_RE.test(line)) { i++; continue; }
    if (TABLE_ROW_RE.test(line)) {
      const start = i; while (i < lines.length && TABLE_ROW_RE.test(lines[i])) i++;
      bump('table', counts['table'] ?? 0, lines.slice(start, i).join('\n')); continue;
    }
    if (QUOTE_RE.test(line)) {
      const start = i; while (i < lines.length && QUOTE_RE.test(lines[i])) i++;
      bump('quote', counts['quote'] ?? 0, lines.slice(start, i).join('\n')); continue;
    }
    if (LIST_ITEM_RE.test(line)) {
      const start = i; while (i < lines.length && LIST_ITEM_RE.test(lines[i])) i++;
      bump('list', counts['list'] ?? 0, lines.slice(start, i).join('\n')); continue;
    }
    // paragraph
    const start = i;
    while (i < lines.length && lines[i].trim() !== '' && !FENCE_RE.test(lines[i]) &&
           !HEADING_RE.test(lines[i]) && !LIST_ITEM_RE.test(lines[i]) &&
           !TABLE_ROW_RE.test(lines[i]) && !QUOTE_RE.test(lines[i])) i++;
    bump('para', counts['para'] ?? 0, lines.slice(start, i).join('\n'));
  }

  return { sections, counts };
}

// ---- src/core/index.ts (EDIT — add the re-exports) ----
export { generateSectionIndex } from './prd-selector.js';
export type { SectionIndex, SelectorType } from './prd-selector.js';
```

### Integration Points
```yaml
NEW MODULE (src/core/prd-selector.ts):
  - imports: parsePRDSections, PRDSection from './prd-differ.js' (NO edit to prd-differ.ts)
  - exports: generateSectionIndex (value), SectionIndex + SelectorType (types)
  - contract: SYNC, string in → SectionIndex out, NO file I/O, deterministic

BARREL (src/core/index.ts):
  - add 2 re-export lines next to the prd-differ block (value export + type export)

NO CHANGES TO (hard boundary):
  - src/core/prd-differ.ts (REUSE only — owns diffPRDs/hasSignificantChanges for the delta workflow)
  - src/core/session-utils.ts (resolvePRD/writePRDSnapshot — the resolved-string SOURCE; reference only)
  - src/core/models.ts, src/workflows/fix-cycle-workflow.ts, tests/unit/core/models.test.ts (parallel P1.M2.T1.S1)
  - any prompts/*.ts (P1.M1.T2.S3, Complete); any docs/*.md (Mode A = JSDoc only); prd_index.txt (Architect agent)

DOWNSTREAM CONSUMER (future — NOT this task):
  - P1.M2.T1.S3: at PRP-generation time, const index = generateSectionIndex(resolvedPRD);
    for (const sel of subtask.prd_selectors) { const txt = index.sections.get(sel); ... } with full-PRD
    fallback when sel is absent/undefined or prd_selectors is [] (PRD §4.2).
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
npm run fix            # lint:fix + prettier --write (run first)
npm run validate       # = lint && format:check && typecheck   (MUST be green)
# Targeted:
npx eslint src/core/prd-selector.ts src/core/index.ts tests/unit/core/prd-selector.test.ts
npx tsc --noEmit -p tsconfig.build.json
npx prettier --check src/core/prd-selector.ts tests/unit/core/prd-selector.test.ts
# Expected: Zero errors. Most likely failure: a prettier nit (re-run `npm run fix`) or a type error
#   from the heading-slice indexing (off-by-one on the 1-indexed lineNumber → 0-indexed array).
```

### Level 2: Unit Tests (Component Validation)
```bash
# The new suite (must pass + 100% coverage of prd-selector.ts):
npx vitest run tests/unit/core/prd-selector.test.ts --coverage
# Config suite sanity (new module sits cleanly alongside prd-differ tests):
npx vitest run tests/unit/core/prd-differ.test.ts
# Expected: green. If coverage < 100%, add a case for the unexercised branch
#   (empty input, in-fence heading skip, EOF heading boundary, or a block type).
```

### Level 3: Integration / Regression (System Validation)
```bash
# Full suite — MUST stay green (proves the barrel re-export + new module don't regress anything,
#   esp. prd-differ.test.ts and anything importing src/core/index.ts):
npm run test:run
# Build emits dist/ cleanly (proves the new module + barrel edit compile under tsc):
npx tsc -p tsconfig.build.json
# Expected: full suite green; build succeeds; global coverage remains 100%.
```

### Level 4: Creative & Domain-Specific Validation
```bash
# No MCP/DB/HTTP/LLM — pure deterministic string→index function. Domain checks (record in commit msg):
#   1. Dialect parity — run the generator over the RESOLVED snapshot and confirm heading counts +
#      code/para/table/quote counts match prd_index.txt (code:6 para:85 table:4 quote:1; headings 1/9/24/19):
node --input-type=module -e "
import('./dist/core/prd-selector.js').then(async ({ generateSectionIndex }) => {
  const fs = await import('node:fs');
  const prd = fs.readFileSync('plan/008_15504f60a0ef/prd_snapshot.md', 'utf8');
  const { counts, sections } = generateSectionIndex(prd);
  console.log('counts =', JSON.stringify(counts));
  console.log('h3.4 starts with:', JSON.stringify(sections.get('h3.4')?.slice(0, 60)));
  console.log('this subtask selectors h3.4/h3.3 resolve:',
    sections.has('h3.4'), sections.has('h3.3'));
});"   # (run `npm run build` first; Expected: h3.4 → '### 4.2 The Execution Loop…', both selectors resolve)
#   2. Determinism — generateSectionIndex(prd) called twice produces identical sections + counts.
#   3. Live-selector coverage — confirm EVERY distinct selector in plan/008/.../tasks.json (all headings)
#      resolves to non-empty text in the generated index (proves the feature works end-to-end for real data).
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run validate` exits 0 (lint + format:check + typecheck).
- [ ] `npx vitest run tests/unit/core/prd-selector.test.ts --coverage` exits 0 with 100% on `src/core/prd-selector.ts`.
- [ ] `npm run test:run` (full suite) exits 0 — no regression.
- [ ] Global coverage remains 100% (new src file fully covered).
- [ ] `npx tsc -p tsconfig.build.json` compiles.

### Feature Validation
- [ ] `generateSectionIndex` is SYNC, takes `string`, returns `SectionIndex`, no I/O.
- [ ] Heading selectors use global-per-level indexing; level 0 excluded; no `h0` selector.
- [ ] On the resolved snapshot, counts reproduce `{h1:1,h2:9,h3:24,h4:19}` + `code:6 para:85 table:4 quote:1`.
- [ ] `sections.get('h3.4')` returns the "4.2 Execution Loop" heading+body; `sections.get('h3.3')` resolves.
- [ ] `code.N`/`para.N`/`list.N`/`table.N`/`quote.N` selectors map to exact block text.
- [ ] Empty/whitespace input → `{ sections: empty Map, counts: {} }`; deterministic across calls.

### Code Quality Validation
- [ ] Reuses `parsePRDSections` + `PRDSection` from `./prd-differ.js` (no edit to prd-differ.ts).
- [ ] Code-fence-aware (headings/blocks inside ``` fences are not misclassified).
- [ ] Follows `src/core/*.ts` conventions (JSDoc @module/@remarks/@example, trailing commas, `as const` where apt).
- [ ] Barrel re-export follows the existing value/type split in `src/core/index.ts`.
- [ ] File-disjoint from P1.M2.T1.S1 (models.ts/fix-cycle-workflow.ts/models.test.ts) and P1.M1.T2.S3 (prompts).

### Documentation & Deployment
- [ ] Mode-A JSDoc on `generateSectionIndex` AND `SectionIndex` documenting selector syntax + resolved-doc requirement + §4.2 fallback + list-count caveat.
- [ ] No `docs/*.md`, README, `.env.example`, or `prd_index.txt` changes (Mode A = JSDoc only).
- [ ] Commit message notes: the proven selector dialect (global-per-level headings), reuse of parsePRDSections, the resolved-doc/no-I/O contract, and the list-count caveat + why it's acceptable.

---

## Anti-Patterns to Avoid

- ❌ Don't reset heading index per parent section — it's GLOBAL per level across the whole document
  (h3.0..h3.23 continuous). Verified against prd_index.txt. Per-parent indexing would mis-resolve every selector.
- ❌ Don't emit an `h0` selector — parsePRDSections' level-0 "Introduction" is implicit; prd_index.txt has none.
- ❌ Don't use `parsePRDSections`' `.content` directly as the heading section TEXT — it omits the header line.
  Slice the source `[lineNumber, nextHeadingLineNumber-1]` for the exact heading+body.
- ❌ Don't make `generateSectionIndex` async or do file I/O — the resolved string is passed in by the caller
  (resolvePRD already materialized it). SYNC, pure, deterministic.
- ❌ Don't ignore code-fence state in the block walker — `#`/`|`/`>` lines inside ``` must not be counted as
  headings/tables/quotes. Compute fenced ranges; skip in-fence headings; track fence state in the walker.
- ❌ Don't chase the LLM's exact `list:50` — a deterministic rule yields ~58 and that's fine (zero block
  selectors exist in live tasks.json; headings are byte-exact; S3 falls back to full PRD on any miss).
  Document the rule + caveat; don't special-case to hit 50.
- ❌ Don't modify `src/core/prd-differ.ts` — reuse it. It owns `diffPRDs`/`hasSignificantChanges` for the
  delta workflow; a change there risks Phase 4 delta behavior.
- ❌ Don't write `prd_index.txt` or `docs/*.md` — prd_index.txt is the Architect agent's artifact; docs are
  Mode A (JSDoc only) per the contract.
- ❌ Don't populate `prd_selectors` or implement extraction/fallback — that's S3 (and the Architect agent).
  This task is the generator + type + JSDoc only.
- ❌ Don't touch any P1.M2.T1.S1 file (`models.ts`, `fix-cycle-workflow.ts`, `models.test.ts`) or any
  P1.M1.T2.S3 prompt file — parallel/complete; file-disjoint.
- ❌ Don't add the barrel re-export as a TYPE when it's a VALUE (or vice-versa) — `generateSectionIndex` is a
  value export; `SectionIndex`/`SelectorType` are type exports. Match the file's existing split.

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: The hardest part — the exact selector dialect — is settled by empirical proof,
not inference: `parsePRDSections` heading counts `{1,9,24,19}` match `prd_index.txt` exactly,
the indices are global-per-level (continuous across parents), and the block definitions
reproduce `code:6 para:85 table:4 quote:1` exactly (lists 58 vs 50, documented as acceptable
because every one of the 63 live selectors is a heading and S3 has a full-PRD fallback). The
parsing primitive is named (`parsePRDSections` @ prd-differ.ts:179) and its one blind spot
(in-fence `#` lines) is a verified no-op for the live doc and defensively handled. The
input contract is traced to `resolvePRD`/`writePRDSnapshot` (resolved string, SYNC, no I/O).
The work is file-disjoint from the parallel S1 and the complete S3. The only residual risks
are mechanical and gate-caught: (a) an off-by-one in the 1-indexed→0-indexed heading slice
(caught by the "section starts with header / ends before next header" assertions); (b) a
100%-coverage gap on an edge branch (caught by `--coverage`, closed by adding one case);
(c) a prettier nit (auto-fixed via `npm run fix`). No runtime/network/LLM unknowns.