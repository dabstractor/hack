# PRP — P1.M2.T1.S3: Selector extraction at PRP-generation time with full-PRD fallback

---

## Goal

**Feature Goal**: Wire **selective PRD section extraction** (PRD §4.2) into the
PRP-generation flow. Create a pure `extractPRDSections(resolvedPRD, selectors)`
that uses S2's `generateSectionIndex` to pull only the sections referenced by a
subtask's `prd_selectors`, then thread that extracted text through
`PRPGenerator.generate()` → `createPRPBlueprintPrompt` so the Researcher Agent
receives a focused `## PRD Context` instead of (or, on fallback, in addition to)
the whole document. **All-or-nothing fallback to the full PRD** when selectors are
empty/absent or any single selector fails to resolve.

**Deliverable**:
1. **`src/core/prd-selector.ts`** — EDIT (S2 created it): add `extractPRDSections(resolvedPRD: string, selectors: string[]): string` + Mode-A JSDoc (fallback behavior, all-or-nothing semantics, resolved-doc requirement).
2. **`src/core/index.ts`** — EDIT: re-export `extractPRDSections` from `./prd-selector.js` (one line, value export).
3. **`src/agents/prompts/prp-blueprint-prompt.ts`** — EDIT: add `prdSections?: string` as the **6th optional** param to BOTH `createPRPBlueprintPrompt` and `constructUserPrompt`; inject a conditional `## PRD Context` block into the user prompt (mirrors the existing `codebaseSection`/`feedbackSection` pattern — undefined/empty ⇒ byte-identical to today).
4. **`src/agents/prp-generator.ts`** — EDIT: in `generate()`, read the resolved PRD via `this.sessionManager.currentSession?.prdSnapshot`, read `task.prd_selectors` (Subtask only — `[]` for Task), call `extractPRDSections`, and pass the result as the **6th arg** to `createPRPBlueprintPrompt`.
5. **Tests** — EDIT (additive): (a) `extractPRDSections` cases in S2's `tests/unit/core/prd-selector.test.ts`; (b) `prdSections` injection cases in `tests/unit/agents/prompts/prp-blueprint-prompt.test.ts`; (c) a `generate()` wiring test in `tests/unit/agents/prp-generator.test.ts` (swallow-the-throw pattern — see Context §6).

**Success Definition**:
- `extractPRDSections(resolvedPRD, [])` === `resolvedPRD` (empty/absent selectors ⇒ full PRD).
- `extractPRDSections(resolvedPRD, ['h2.0','h3.1'])` (all resolve) === those sections' exact source text joined by `\n\n`, in selector order.
- `extractPRDSections(resolvedPRD, ['h2.0','zzz.9'])` (any miss) === `resolvedPRD` (all-or-nothing fallback).
- `createPRPBlueprintPrompt(…, prdSections)` injects a `## PRD Context` section into `prompt.user` iff `prdSections` is a non-empty string; omitted ⇒ no section (existing tests unaffected).
- `PRPGenerator.generate(subtask,…)` calls `createPRPBlueprintPrompt` with the 6th arg = `extractPRDSections(resolvedPRD, subtask.prd_selectors)`; for a `Task` (no selectors) the 6th arg = the full resolved PRD.
- `npm run validate` green; new unit tests green; **prp-generator.test.ts failure count unchanged** (15 pre-existing — see Context §6); 100% coverage maintained on edited src files.

---

## Why

- **PRD §4.2 mandates selective extraction.** "The Researcher receives only the referenced sections instead of the full document, keeping its context window focused." S1 modeled the `prd_selectors` field; S2 built the index/`SectionIndex`; **S3 is the extraction + the wiring + the fallback**. Without S3, the field and index are dead code — the Researcher never sees selected sections.
- **Completes P1.M2** (the milestone's final subtask). All three subtasks chain: S1 (field) → S2 (index) → S3 (extract + wire + fallback). This PRP is the capstone.
- **Fallback is a first-class requirement, not an afterthought.** PRD §4.2: "When selectors are absent or extraction fails, the full PRD is used." S3 implements the all-or-nothing rule (any-miss ⇒ full PRD) so a partial/confusing slice never silently reaches the Researcher.
- **Backward-compatible by construction.** `prdSections` is an optional 6th param on a function with exactly one production caller; `[]` selectors (every Task, every legacy Subtask) fall straight through to the full PRD, byte-identical to today's behavior.
- **Out of scope (hard boundary):** `generateSectionIndex`/`SectionIndex` internals (S2 — reuse only), the `prd_selectors` field/schema (S1 — consume only), populating selectors (Architect agent), writing `prd_index.txt` (Architect agent), fixing the pre-existing `prp-generator.test.ts` mock gap (§6), any `docs/*.md` (DOCS = Mode A: JSDoc only).

---

## What

### User-visible behavior
None at the CLI/runtime surface for the no-selectors case (byte-identical prompt).
For a Subtask carrying non-empty `prd_selectors` that all resolve, the Researcher's
user prompt gains a `## PRD Context` block containing ONLY the referenced sections'
source text — focused context. If any selector misses, the block contains the full
resolved PRD instead (safe fallback).

### Technical requirements (exact contract)

**`src/core/prd-selector.ts`** — ADD (S2 owns `generateSectionIndex`/`SectionIndex`/`SelectorType`; S3 adds the consumer):

```ts
import { generateSectionIndex } from ...; // already present after S2

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
 * ```ts
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
```

**`src/core/index.ts`** — ADD one value re-export (next to the S2 `generateSectionIndex` block):
```ts
export { extractPRDSections } from './prd-selector.js';
```

**`src/agents/prompts/prp-blueprint-prompt.ts`** — EDIT (two functions, both gain the 6th optional param):
- `constructUserPrompt(task, backlog, codebasePath?, prpOutputPath?, issueFeedback?, prdSections?)` — add `prdSections?: string` and a conditional `## PRD Context` block (undefined/empty ⇒ no block; mirrors `codebaseSection`/`feedbackSection`).
- `createPRPBlueprintPrompt(task, backlog, codebasePath?, prpOutputPath?, issueFeedback?, prdSections?)` — thread `prdSections` into the `constructUserPrompt` call. Update the JSDoc `@param` block.

Injection shape (after the `## Parent Context` block, before `codebaseSection`):
```ts
const prdContextBlock =
  prdSections !== undefined && prdSections.length > 0
    ? `\n\n## PRD Context\n\nThe following PRD sections are relevant to this work item (PRD §4.2 selective extraction). When a selector did not resolve, the full PRD is provided as a fallback.\n\n${prdSections}\n`
    : '';
```
Then reference `${prdContextBlock}` in the returned template string (place it after `${parentContextDisplay}` and before `${codebaseSection}`).

**`src/agents/prp-generator.ts`** — EDIT `generate()` (around the existing `createPRPBlueprintPrompt` call at line ~658):
```ts
// Selective PRD section extraction (PRD §4.2): pull only the referenced sections
// from the resolved PRD; fall back to the full PRD when selectors are absent/[].
const resolvedPRD = this.sessionManager.currentSession?.prdSnapshot ?? '';
const selectors = task.type === 'Subtask' ? task.prd_selectors : [];
const prdSections = extractPRDSections(resolvedPRD, selectors);

const prompt = createPRPBlueprintPrompt(
  task,
  backlog,
  process.cwd(),
  prpOutputPath,
  issueFeedback,
  prdSections   // ← NEW 6th arg
);
```
Add the import: `import { extractPRDSections } from '../core/prd-selector.js';`
(or from `'../core/index.js'` — match the existing import style in the file; prp-generator.ts currently imports from `'../core/models.js'`/`'../utils/…'`, so `'../core/prd-selector.js'` is consistent).

### Success Criteria
- [ ] `extractPRDSections(prd, [])` === `prd`; `extractPRDSections(prd, ['h2.0'])` (resolves) === the `h2.0` section text.
- [ ] `extractPRDSections(prd, ['h2.0','bad.9'])` (any miss) === `prd` (full-PRD fallback, all-or-nothing).
- [ ] `extractPRDSections` is SYNC, pure, no I/O; deterministic (same inputs ⇒ same output).
- [ ] `extractPRDSections` re-exported from `src/core/index.ts`.
- [ ] `createPRPBlueprintPrompt(…, 'PRD TEXT')` ⇒ `prompt.user` contains `## PRD Context` and the text; omitted/empty `prdSections` ⇒ no `## PRD Context` block (existing prompt tests stay green).
- [ ] `PRPGenerator.generate(subtask,…)` passes `extractPRDSections(resolvedPRD, subtask.prd_selectors)` as the 6th arg; `Task` input ⇒ 6th arg = full resolved PRD.
- [ ] `npm run validate` green; new unit tests green; `prp-generator.test.ts` failure count **unchanged** (15); 100% coverage on edited src files.

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_
**Yes** — the resolved-PRD data path is traced (`currentSession.prdSnapshot`); the
S2 `generateSectionIndex`/`SectionIndex` contract is cited with its exact return
shape (`sections: ReadonlyMap<string,string>` with `.get(sel)→string|undefined`);
the exact current signatures of `createPRPBlueprintPrompt`/`constructUserPrompt`
(5 params) and the single production call site (prp-generator.ts:658) are given;
the backward-compatible 6th-optional-param strategy is justified against all
~50 call sites; the all-or-nothing fallback decision is documented with its
contract rationale; the pre-existing `prp-generator.test.ts` red state (15
failures) is proven empirically with a concrete swallow-the-throw test strategy;
and every non-obvious trap (Task vs Subtask selectors, `prdSnapshot` always
resolved post-P1.M1, mock factory lacks `prd_selectors`, file-disjointness) is in
the research note.

### Documentation & References
```yaml
# MUST READ — PRD spec (the feature's reason)
- docfile: PRD.md
  section: "4.2 The Execution Loop (The "Inner Loop")" (h3.4) → step 2 "Selective PRD Section Extraction"
  why: Defines prd_selectors + selective extraction + full-PRD fallback when absent/failed.
  critical: This subtask is the EXTRACTION + WIRING + FALLBACK. S1=field, S2=index, S3=this.

# MUST READ — this subtask's research (data path, fallback decision, test strategy)
- docfile: plan/008_15504f60a0ef/P1M2T1S3/research/extraction-wiring-and-data-path.md
  section: "1. The data path", "4. Where extractPRDSections lives", "5. All-or-nothing fallback",
           "6. prp-generator.test.ts is ALREADY RED", "7. mock session manager", "8. file-disjointness"
  why: Proven facts: prdSnapshot reachability, backward-compatible 6th param, the 15 pre-existing
        test failures + swallow-the-throw pattern, the mock factory's missing prd_selectors.

# MUST READ — S2's index contract (the building block this consumes)
- docfile: plan/008_15504f60a0ef/P1M2T1S2/PRP.md
  section: "Technical requirements → generateSectionIndex", "SectionIndex interface"
  why: extractPRDSections REUSES generateSectionIndex + SectionIndex.sections.get(sel). The index
        returns exact section text per selector; .get(sel) is undefined when absent (drives fallback).
  critical: S2's file (src/core/prd-selector.ts) + barrel re-export + test suite EXIST by S3's run
            (S3 depends on S2). S3 EXTENDS the file; it does not recreate it.

# MUST READ — S1's field contract (the selector source)
- docfile: plan/008_15504f60a0ef/P1M2T1S1/PRP.md
  section: "Technical requirements → Subtask interface/schema"
  why: prd_selectors: string[] on Subtask (required in-memory, optional().default([]) on schema).
        EXISTS on Subtask ONLY — Task has no selectors (⇒ [] ⇒ full-PRD fallback). Read via
        task.type === 'Subtask' ? task.prd_selectors : [].

# THE FILES TO EDIT — exact current state + edit anchors
- file: src/agents/prompts/prp-blueprint-prompt.ts
  why: EDIT createPRPBlueprintPrompt (line 287) + constructUserPrompt (line 142). Add 6th optional
        prdSections?: string param to BOTH; inject conditional ## PRD Context block.
  pattern: "export function createPRPBlueprintPrompt(task, backlog, codebasePath?, prpOutputPath?, issueFeedback?): Prompt<unknown>"
  gotcha: There are ~50 test call sites (0-5 args). Adding an OPTIONAL 6th param keeps them ALL valid.
          Mirror the existing conditional-block pattern: `prdSections !== undefined && prdSections.length > 0 ? '...' : ''`
          (same shape as codebaseSection at line ~91 and feedbackSection at line ~113).

- file: src/agents/prp-generator.ts
  why: EDIT generate() — the SOLE production caller of createPRPBlueprintPrompt (line ~658). Compute
        extractPRDSections(currentSession.prdSnapshot, selectors) and pass as 6th arg.
  pattern: "const prompt = createPRPBlueprintPrompt(task, backlog, process.cwd(), prpOutputPath, issueFeedback);"
  gotcha: resolvedPRD = this.sessionManager.currentSession?.prdSnapshot ?? '' (resolved post-P1.M1).
          selectors = task.type === 'Subtask' ? task.prd_selectors : []. Import extractPRDSections.

- file: src/core/prd-selector.ts   (S2 CREATES; S3 EXTENDS)
  why: ADD extractPRDSections + Mode-A JSDoc. Reuses generateSectionIndex + SectionIndex (S2).
  pattern: "export function generateSectionIndex(resolvedPRD: string): SectionIndex { ... }" (S2)
  gotcha: SYNC, no I/O (same invariant as generateSectionIndex). DO NOT modify S2's generateSectionIndex.

- file: src/core/index.ts
  why: EDIT — add `export { extractPRDSections } from './prd-selector.js';` next to S2's re-export block.
  pattern: "export { generateSectionIndex } from './prd-selector.js';" (S2 adds this); existing
           value/type-split style: `export type { SectionIndex, SelectorType } from './prd-selector.js';`
  gotcha: extractPRDSections is a VALUE export (not a type). S2 already adds the generateSectionIndex +
        SectionIndex/SelectorType exports; S3 adds exactly ONE more line. No conflict (different symbols).

# PATTERN FILES — test style to mirror
- file: tests/unit/core/prd-selector.test.ts   (S2 CREATES; S3 EXTENDS)
  why: Add extractPRDSections cases to the EXISTING suite. Pure, deterministic, green.
  pattern: "describe('generateSectionIndex', () => { describe('GIVEN …', () => { it('SHOULD …', ...) }) })"
  gotcha: Add a sibling `describe('extractPRDSections')`. Cover: []→full PRD; all-resolve→joined text;
          any-miss→full PRD; determinism; selector-order preservation.

- file: tests/unit/agents/prompts/prp-blueprint-prompt.test.ts
  why: Add prdSections injection cases — mirror the EXISTING issueFeedback tests (lines 178-221).
  pattern: "it('should include the <issue_feedback> block when issueFeedback is provided', () => { ... })"
  gotcha: The mockBacklog fixtures use inline Subtasks WITHOUT prd_selectors (tests not typechecked) —
          that's fine; pass prdSections directly to createPRPBlueprintPrompt, independent of the subtask.

- file: tests/unit/agents/prp-generator.test.ts
  why: Add a generate() WIRING test using the swallow-the-throw pattern. Proves the 6th arg.
  pattern: "it('should forward issueFeedback to createPRPBlueprintPrompt as the 4th arg', ...)" (line 237)
  gotcha: THIS SUITE IS ALREADY RED (15 failures, pre-existing mock gap — readFile returns undefined).
          Do NOT fix those 15; do NOT grow the count. createPRPBlueprintPrompt (line 658) is called
          BEFORE the failing agent/file-read step (line 678+), so a spy records the call even though
          generate() later rejects. See Context §6 for the exact pattern.

# CONSUMERS (read-only — proves non-breaking)
- file: tests/unit/agent-context-injection.test.ts
  why: ~25 call sites of createPRPBlueprintPrompt (0-5 args). All stay valid with an optional 6th param.
- file: tests/integration/prp-blueprint-agent.test.ts
  why: Integration call sites (0-5 args). Stay valid. Verify after the change.
- file: tests/integration/agents.test.ts
  why: 2 call sites (line 517, 533). Stay valid.
```

### Current Codebase tree (relevant slice)
```bash
src/core/
├── prd-selector.ts              # S2 CREATES (generateSectionIndex+SectionIndex+SelectorType); S3 EXTENDS (+extractPRDSections)
├── index.ts                     # EDIT — +1 re-export line (extractPRDSections)
src/agents/
├── prp-generator.ts             # EDIT — generate() reads prdSnapshot + calls extractPRDSections → 6th arg
└── prompts/
    └── prp-blueprint-prompt.ts  # EDIT — createPRPBlueprintPrompt + constructUserPrompt += prdSections? (6th)
tests/unit/core/
└── prd-selector.test.ts         # S2 CREATES; S3 EXTENDS (+extractPRDSections cases)
tests/unit/agents/prompts/
└── prp-blueprint-prompt.test.ts # EDIT (additive) — prdSections injection cases
tests/unit/agents/
└── prp-generator.test.ts        # EDIT (additive) — generate() wiring test (swallow-the-throw)
```

### Desired Codebase tree with files to be added/edited
```bash
src/core/prd-selector.ts                       # MODIFIED (+extractPRDSections + JSDoc; reuses S2's generateSectionIndex)
src/core/index.ts                              # MODIFIED (+1 value re-export)
src/agents/prompts/prp-blueprint-prompt.ts     # MODIFIED (+prdSections? 6th param on 2 fns + ## PRD Context block)
src/agents/prp-generator.ts                    # MODIFIED (generate() reads prdSnapshot, calls extractPRDSections, 6th arg)
tests/unit/core/prd-selector.test.ts           # MODIFIED (+extractPRDSections describe block)
tests/unit/agents/prompts/prp-blueprint-prompt.test.ts  # MODIFIED (+prdSections cases)
tests/unit/agents/prp-generator.test.ts        # MODIFIED (+wiring test; additive only)
```

### Known Gotchas of our codebase & Library Quirks
```ts
// CRITICAL — prd_selectors is on Subtask ONLY. In generate(): guard with
//   const selectors = task.type === 'Subtask' ? task.prd_selectors : [];
// A Task → [] → extractPRDSections returns the full resolved PRD (correct: Tasks have no selectors).

// CRITICAL — the resolved PRD is this.sessionManager.currentSession?.prdSnapshot. It IS the
//   include-expanded document (post P1.M1: initialize() sets prdSnapshot: resolved at
//   session-manager.ts:492; loadSession() reads prd_snapshot.md which is the resolved materialization).
//   The constructor guarantees currentSession is non-null (throws otherwise), but use ?. + ?? '' for safety.

// CRITICAL — 6th param is OPTIONAL. createPRPBlueprintPrompt has ~50 test call sites passing 0-5 args.
//   `prdSections?: string` keeps every one valid. NEVER reorder existing params. NEVER make it required.

// CRITICAL — all-or-nothing fallback. extractPRDSections returns the FULL resolvedPRD if selectors is
//   empty/absent OR if ANY single selector's sections.get(sel) === undefined. Never return a partial slice.
//   Contract-literal ("fails for any selector"). Documented in JSDoc. Rare in practice (all live selectors
//   are headings that resolve byte-exact per S2's research).

// CRITICAL — prd-generator.test.ts is ALREADY RED (15 failures). Root cause: vi.mock('node:fs/promises')
//   makes readFile a bare vi.fn() returning undefined → #parsePRDText throws at line 270. This PREDATES S3.
//   DO NOT fix those 15. DO NOT grow the count. Use the swallow-the-throw pattern for the wiring test
//   (createPRPBlueprintPrompt @658 is called BEFORE the failing step @678+). See Context §6.

// GOTCHA — createMockSubtask (prp-generator.test.ts:83) does NOT set prd_selectors. After S1 it's
//   required on the interface, but tests/ are excluded from tsc.build so the factory still compiles.
//   For S3's wiring test, construct the subtask with an EXPLICIT prd_selectors (don't rely on the factory).

// GOTCHA — createMockSessionManager (prp-generator.test.ts:77) sets prdSnapshot: '# PRD Content'.
//   For a deterministic wiring assertion use prd_selectors: [] (or a Task) ⇒ fallback ⇒ 6th arg ===
//   '# PRD Content'. For an extraction-positive assertion, override prdSnapshot to a small PRD with a
//   known h1.0 and set prd_selectors: ['h1.0'].

// GOTCHA — conditional-block injection must be BYTE-IDENTICAL when prdSections is undefined/empty
//   (mirrors codebaseSection at line ~91 and feedbackSection at line ~113). The existing prompt tests
//   (e.g. "should not include the <issue_feedback> block when omitted") have direct analogues — add
//   "should not include ## PRD Context when prdSections is omitted".

// GOTCHA — prettier is ERROR-enforced (format:check). Run `npm run fix` before `npm run validate`.
//   100% coverage is globally enforced (vitest.config.ts include=src/**/*.ts, thresholds 100). The new
//   branches in extractPRDSections (empty-selectors, any-miss, all-resolve) must each be exercised.

// CRITICAL — DISJOINT from S1 (models.ts/fix-cycle-workflow.ts/models.test.ts) and from S2's sole-owned
//   logic (generateSectionIndex body). The shared edit points (prd-selector.ts, its barrel, its test) are
//   sequentially safe: S2 completes BEFORE S3 (S3 depends on S2). Do NOT touch prd-differ.ts, prompts.ts,
//   any docs/*.md (Mode A = JSDoc only), prd_index.txt (Architect agent), or any P1.M1.T2.S3 prompt file.
```

---

## Implementation Blueprint

### Data models and structure
No new types. `extractPRDSections` returns a `string`. It consumes S2's
`SectionIndex` (`{ readonly sections: ReadonlyMap<string, string>; readonly
counts: Readonly<Record<string, number>> }`) via `generateSectionIndex`. The
6th prompt param is `prdSections?: string`.

```ts
// src/core/prd-selector.ts — ADD (after S2's generateSectionIndex)
export function extractPRDSections(resolvedPRD: string, selectors: string[]): string {
  if (!selectors || selectors.length === 0) return resolvedPRD;        // fallback: empty/absent
  const { sections } = generateSectionIndex(resolvedPRD);
  const collected: string[] = [];
  for (const selector of selectors) {
    const text = sections.get(selector);
    if (text === undefined) return resolvedPRD;                         // fallback: any-miss
    collected.push(text);
  }
  return collected.join('\n\n');                                        // selector order
}

// src/agents/prompts/prp-blueprint-prompt.ts — EDIT (6th optional param on both fns)
function constructUserPrompt(
  task, backlog, codebasePath?, prpOutputPath?, issueFeedback?, prdSections?: string
): string { /* …add conditional prdContextBlock… */ }

export function createPRPBlueprintPrompt(
  task, backlog, codebasePath?, prpOutputPath?, issueFeedback?, prdSections?: string
): Prompt<unknown> { /* …thread prdSections into constructUserPrompt… */ }

// src/agents/prp-generator.ts — EDIT generate() (around line 658)
const resolvedPRD = this.sessionManager.currentSession?.prdSnapshot ?? '';
const selectors = task.type === 'Subtask' ? task.prd_selectors : [];
const prdSections = extractPRDSections(resolvedPRD, selectors);
const prompt = createPRPBlueprintPrompt(task, backlog, process.cwd(), prpOutputPath, issueFeedback, prdSections);
```

### Implementation Tasks (ordered by dependencies — implicit TDD: RED first, then GREEN)
```yaml
Task 1: EXTEND tests/unit/core/prd-selector.test.ts   (RED — extraction cases fail until impl)
  - ADD a sibling `describe('extractPRDSections', …)` to S2's existing suite.
  - IMPORT: extractPRDSections from '../../../src/core/prd-selector.js' (S2 already imports generateSectionIndex there).
  - FIXTURE: reuse S2's hand-counted PRD fixture (or a small one) with known selectors, e.g. an
    `h2.0` + `h2.1` + a `para.0`. Build it inline so counts are obvious.
  - CASES (minimum):
      * 'SHOULD return the full PRD when selectors is empty':
            expect(extractPRDSections(prd, [])).toBe(prd);
      * 'SHOULD return the full PRD when selectors is undefined/null-ish':
            expect(extractPRDSections(prd, undefined as any)).toBe(prd);  // guard `!selectors`
      * 'SHOULD return concatenated sections (in selector order) when all resolve':
            const out = extractPRDSections(prd, ['h2.0','h2.1']);
            expect(out).toContain(<h2.0 heading text>); expect(out).toContain(<h2.1 heading text>);
            expect(out.indexOf(<h2.0>)).toBeLessThan(out.indexOf(<h2.1>));  // selector order
            expect(out).not.toContain(<h2.2 heading text>);  // only referenced sections
      * 'SHOULD fall back to the full PRD when ANY selector misses (all-or-nothing)':
            expect(extractPRDSections(prd, ['h2.0','zzz.9'])).toBe(prd);
      * 'SHOULD be deterministic': extractPRDSections(prd, ['h2.0']) deep-equals itself (twice).
      * 'SHOULD join sections with a blank line': out contains '\n\n' between the two sections.
  - NAMING: describe('extractPRDSections'); BDD it('SHOULD …').
  - PLACEMENT: tests/unit/core/prd-selector.test.ts (S2 created it; ADD a sibling describe).
  - EXPECTED NOW: import fails (extractPRDSections absent) → RED (until Task 2).

Task 2: EXTEND src/core/prd-selector.ts   (GREEN — add extractPRDSections)
  - ADD `export function extractPRDSections(resolvedPRD: string, selectors: string[]): string`
    exactly as in "Technical requirements" (guard → generateSectionIndex → loop with any-miss
    fallback → join('\n\n')). Reuse S2's `generateSectionIndex` (already imported in the file).
  - ADD the Mode-A JSDoc (verbatim from "Technical requirements") documenting: PRD §4.2 selective
    extraction; the all-or-nothing fallback (empty/absent OR any-miss ⇒ full PRD); SYNC/no-I/O;
    the resolved-document requirement; selector-order preservation; @example.
  - DO NOT modify S2's generateSectionIndex/SectionIndex/SelectorType.
  - EXPECTED: prd-selector.test.ts turns GREEN (S2 + S3 cases); 100% coverage of prd-selector.ts.

Task 3: EDIT src/core/index.ts   (barrel re-export)
  - ADD next to S2's prd-selector re-export block:
        export { extractPRDSections } from './prd-selector.js';
  - DO NOT reorder/edit existing exports (incl. S2's generateSectionIndex/SectionIndex/SelectorType).
  - EXPECTED: `import { extractPRDSections } from './core/index.js'` works; typecheck green.

Task 4: EDIT src/agents/prompts/prp-blueprint-prompt.ts   (6th optional param + injection)
  - ADD `prdSections?: string` as the 6th param to `constructUserPrompt` (line 142) and
    `createPRPBlueprintPrompt` (line 287). Thread it: createPRPBlueprintPrompt passes prdSections
    into its constructUserPrompt call (line ~311).
  - IN constructUserPrompt, add the conditional block (mirror codebaseSection line ~91):
        const prdContextBlock =
          prdSections !== undefined && prdSections.length > 0
            ? `\n\n## PRD Context\n\nThe following PRD sections are relevant to this work item (PRD §4.2 selective extraction). When a selector did not resolve, the full PRD is provided as a fallback.\n\n${prdSections}\n`
            : '';
    and interpolate `${prdContextBlock}` in the returned template AFTER `${parentContextDisplay}`
    and BEFORE `${codebaseSection}`.
  - UPDATE the JSDoc @param blocks on both functions to document prdSections (fallback semantics, PRD §4.2).
  - EXPECTED: typecheck green; existing prompt tests stay green (undefined prdSections ⇒ no block).

Task 5: EDIT tests/unit/agents/prompts/prp-blueprint-prompt.test.ts   (injection cases)
  - ADD 3 cases mirroring the EXISTING issueFeedback tests (lines 178-221):
      * 'should include the ## PRD Context block when prdSections is provided':
            const prompt = createPRPBlueprintPrompt(task, mockBacklog, undefined, undefined, undefined, 'RELEVANT PRD SECTIONS TEXT');
            expect(prompt.user).toContain('## PRD Context'); expect(prompt.user).toContain('RELEVANT PRD SECTIONS TEXT');
      * 'should NOT include the ## PRD Context block when prdSections is omitted':
            const prompt = createPRPBlueprintPrompt(task, mockBacklog);
            expect(prompt.user).not.toContain('## PRD Context');
      * 'should NOT include the ## PRD Context block when prdSections is an empty string':
            const prompt = createPRPBlueprintPrompt(task, mockBacklog, undefined, undefined, undefined, '');
            expect(prompt.user).not.toContain('## PRD Context');
  - EXPECTED: green. (The 6th-arg position matches createPRPBlueprintPrompt's new signature.)

Task 6: EDIT src/agents/prp-generator.ts   (wire extraction into generate())
  - IMPORT: `import { extractPRDSections } from '../core/prd-selector.js';`
  - IN generate(), JUST BEFORE the existing createPRPBlueprintPrompt call (line ~658), add:
        const resolvedPRD = this.sessionManager.currentSession?.prdSnapshot ?? '';
        const selectors = task.type === 'Subtask' ? task.prd_selectors : [];
        const prdSections = extractPRDSections(resolvedPRD, selectors);
  - ADD prdSections as the 6th arg to createPRPBlueprintPrompt(task, backlog, process.cwd(), prpOutputPath, issueFeedback, prdSections).
  - EXPECTED: typecheck green; the createMockSessionManager.prdSnapshot ('# PRD Content') feeds the call in tests.

Task 7: EDIT tests/unit/agents/prp-generator.test.ts   (wiring test — swallow-the-throw)
  - ADD ONE case in describe('generate') — MIRRORS the existing "forward issueFeedback as 4th arg"
    test (line 237) but for the 6th arg, using the swallow-the-throw pattern:
      it('should pass extracted PRD sections as the 6th arg to createPRPBlueprintPrompt', async () => {
        const subtask: Subtask = {
          ...createMockSubtask('P1.M2.T1.S3', 'Selector extraction'),
          prd_selectors: [],   // explicit (factory omits it) — [] ⇒ full-PRD fallback
        };
        const backlog = createMockBacklog();
        const generator = new PRPGenerator(mockSessionManager);
        // generate() throws at the agent/file-read step (PRE-EXISTING mock gap) — swallow it;
        // createPRPBlueprintPrompt (line 658) is called BEFORE that step, so the spy recorded the call.
        await expect(generator.generate(subtask, backlog)).rejects.toThrow();
        expect(mockCreatePRPBlueprintPrompt).toHaveBeenCalledWith(
          subtask, backlog, expect.any(String), expect.any(String), undefined,
          '# PRD Content'   // ← 6th arg prdSections = full resolved PRD (selectors=[] fallback)
        );
      });
  - OPTIONAL positive-extraction variant: override mockSessionManager.prdSnapshot to a PRD with a
    known h1.0, set prd_selectors: ['h1.0'], assert the 6th arg contains that heading's text.
  - GOTCHA: do NOT fix the 15 pre-existing failures; this test must be the ONLY change. After the
    edit, re-run and confirm the failure COUNT is unchanged (15) — this new test is among the passing 10.
  - EXPECTED: the new test PASSES (swallow-the-throw); pre-existing failure count unchanged.

Task 8: FORMAT + VERIFY
  - RUN: npm run fix → npm run validate (lint + format:check + typecheck).
  - RUN: npx vitest run tests/unit/core/prd-selector.test.ts --coverage (S2+S3 cases green; 100% on prd-selector.ts).
  - RUN: npx vitest run tests/unit/agents/prompts/prp-blueprint-prompt.test.ts (incl. new prdSections cases).
  - RUN: npx vitest run tests/unit/agents/prp-generator.test.ts (CONFIRM: 10 passed | 15 failed — the new
        wiring test passes; the 15 pre-existing failures are UNCHANGED; failure COUNT did not grow).
  - RUN: npx vitest run tests/unit/agent-context-injection.test.ts tests/integration/prp-blueprint-agent.test.ts
        tests/integration/agents.test.ts (createPRPBlueprintPrompt call sites — all stay green; optional 6th param).
  - RUN: npm run test:run (full suite — no NEW regressions; 100% coverage on edited src files).
  - EXPECTED: all green except the known 15 pre-existing prp-generator.test.ts failures (unchanged).
```

### Implementation Patterns & Key Details
```ts
// ---- src/core/prd-selector.ts: extractPRDSections (ADD; reuses S2's generateSectionIndex) ----
import { generateSectionIndex } from './prd-selector.js'; // S2's own export (same file) — no import needed if same module

export function extractPRDSections(resolvedPRD: string, selectors: string[]): string {
  if (!selectors || selectors.length === 0) return resolvedPRD;
  const { sections } = generateSectionIndex(resolvedPRD);
  const collected: string[] = [];
  for (const selector of selectors) {
    const text = sections.get(selector);
    if (text === undefined) return resolvedPRD;   // any-miss ⇒ full-PRD fallback (all-or-nothing)
    collected.push(text);
  }
  return collected.join('\n\n');                   // selector order; blank-line separator
}

// ---- src/agents/prompts/prp-blueprint-prompt.ts: constructUserPrompt (EDIT — add 6th param + block) ----
function constructUserPrompt(
  task: Task | Subtask, backlog: Backlog, codebasePath?: string,
  prpOutputPath?: string, issueFeedback?: string, prdSections?: string   // ← NEW
): string {
  // …existing locals…
  const prdContextBlock =
    prdSections !== undefined && prdSections.length > 0
      ? `\n\n## PRD Context\n\nThe following PRD sections are relevant to this work item (PRD §4.2 selective extraction). When a selector did not resolve, the full PRD is provided as a fallback.\n\n${prdSections}\n`
      : '';
  // …insert `${prdContextBlock}` after `${parentContextDisplay}` and before `${codebaseSection}`…
  return `${writeFileBanner}# Work Item Context\n\n## Task Information\n…\n${taskContext}\n\n## Parent Context\n\n${parentContextDisplay}${prdContextBlock}${codebaseSection}${feedbackSection}\n\n---\n\n${PRP_BLUEPRINT_PROMPT}\n`;
}

// ---- src/agents/prompts/prp-blueprint-prompt.ts: createPRPBlueprintPrompt (EDIT — 6th param) ----
export function createPRPBlueprintPrompt(
  task: Task | Subtask, backlog: Backlog, codebasePath?: string,
  prpOutputPath?: string, issueFeedback?: string, prdSections?: string   // ← NEW
): Prompt<unknown> {
  // …systemPrompt logic unchanged…
  return createPrompt({
    user: constructUserPrompt(task, backlog, codebasePath, prpOutputPath, issueFeedback, prdSections),
    system: systemPrompt,
    responseFormat: z.unknown(),
  });
}

// ---- src/agents/prp-generator.ts: generate() (EDIT — wire extraction; ~line 658) ----
import { extractPRDSections } from '../core/prd-selector.js';
// …inside generate(), before the createPRPBlueprintPrompt call:
const resolvedPRD = this.sessionManager.currentSession?.prdSnapshot ?? '';
const selectors = task.type === 'Subtask' ? task.prd_selectors : [];
const prdSections = extractPRDSections(resolvedPRD, selectors);
const prompt = createPRPBlueprintPrompt(
  task, backlog, process.cwd(), prpOutputPath, issueFeedback, prdSections
);
```

### Integration Points
```yaml
EXTRACTION (src/core/prd-selector.ts):
  - ADD extractPRDSections(resolvedPRD: string, selectors: string[]): string
  - REUSES generateSectionIndex + SectionIndex (S2). SYNC, no I/O, pure, deterministic.
  - all-or-nothing fallback: [] / undefined selectors OR any-miss ⇒ full resolvedPRD.

BARREL (src/core/index.ts):
  - +1 value re-export: extractPRDSections (next to S2's prd-selector block).

PROMPT (src/agents/prompts/prp-blueprint-prompt.ts):
  - createPRPBlueprintPrompt += prdSections?: string (6th, optional)
  - constructUserPrompt += prdSections?: string (6th, optional) + conditional ## PRD Context block
  - undefined/empty prdSections ⇒ byte-identical prompt (existing tests unaffected)

GENERATOR (src/agents/prp-generator.ts):
  - generate() reads currentSession.prdSnapshot (resolved) + task.prd_selectors (Subtask only)
  - calls extractPRDSections, passes result as 6th arg to createPRPBlueprintPrompt

NO CHANGES TO (hard boundary):
  - src/core/prd-differ.ts (REUSE parsePRDSections — owned by S2/delta workflow)
  - src/core/models.ts, src/workflows/fix-cycle-workflow.ts (S1 — consume prd_selectors only)
  - src/agents/prompts.ts / PRP_BLUEPRINT_PROMPT (system prompt — unchanged)
  - any docs/*.md (Mode A = JSDoc only), prd_index.txt (Architect agent)
  - the 15 pre-existing prp-generator.test.ts failures (out of scope — do NOT fix, do NOT grow)
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
npm run fix            # lint:fix + prettier --write (run first)
npm run validate       # = lint && format:check && typecheck   (MUST be green)
# Targeted:
npx eslint src/core/prd-selector.ts src/core/index.ts \
           src/agents/prompts/prp-blueprint-prompt.ts src/agents/prp-generator.ts
npx tsc --noEmit -p tsconfig.build.json
npx prettier --check src/core/prd-selector.ts src/agents/prompts/prp-blueprint-prompt.ts \
                     src/agents/prp-generator.ts
# Expected: Zero errors. Most likely failures: (a) a typecheck error if selectors is read on a Task
#   without the type guard (Task has no prd_selectors) — fix with `task.type === 'Subtask' ? ... : []`;
#   (b) a prettier nit (re-run `npm run fix`).
```

### Level 2: Unit Tests (Component Validation)
```bash
# The extraction logic (PRIMARY, reliable proof — pure, no mocks):
npx vitest run tests/unit/core/prd-selector.test.ts --coverage
#   Expected: green (S2 + S3 cases); 100% coverage on src/core/prd-selector.ts. If coverage < 100%,
#   an extractPRDSections branch is unexercised (empty-selectors / any-miss / all-resolve) — add the case.

# The prompt injection (pure, no mocks):
npx vitest run tests/unit/agents/prompts/prp-blueprint-prompt.test.ts
#   Expected: green, incl. the 3 new prdSections cases. If "should NOT include ## PRD Context when
#   omitted" fails, the conditional block is emitting on undefined/empty — fix the guard.

# The generate() wiring (mocked — swallow-the-throw):
npx vitest run tests/unit/agents/prp-generator.test.ts
#   Expected: 10 passed | 15 failed (the new wiring test passes; the 15 pre-existing failures are
#   UNCHANGED — same root cause, same count). If the COUNT grew, the 6th-arg addition broke a
#   previously-passing test — investigate (most likely a test asserting exact arg count/positions).
```

### Level 3: Integration / Regression (System Validation)
```bash
# createPRPBlueprintPrompt call sites — all stay green (optional 6th param):
npx vitest run tests/unit/agent-context-injection.test.ts tests/integration/prp-blueprint-agent.test.ts \
              tests/integration/agents.test.ts
# Full suite — MUST stay green (proves the optional param + extraction don't regress anything):
npm run test:run
# Build emits dist/ cleanly (proves the edits compile under tsc):
npx tsc -p tsconfig.build.json
# Expected: no NEW failures vs. the pre-S3 baseline. (prp-generator.test.ts retains its 15 pre-existing
#   failures; everything else green; 100% coverage on edited src files.)
```

### Level 4: Creative & Domain-Specific Validation
```bash
# No MCP/DB/HTTP. Domain checks (record in commit message):
#   1. End-to-end extraction over the RESOLVED snapshot — selectors this very subtask was assigned
#      (h3.4) resolve and extract to the "4.2 Execution Loop" body; a bogus selector falls back:
node --input-type=module -e "
import('./dist/core/prd-selector.js').then(async ({ generateSectionIndex, extractPRDSections }) => {
  const fs = await import('node:fs');
  const prd = fs.readFileSync('plan/008_15504f60a0ef/prd_snapshot.md', 'utf8');
  console.log('h3.4 extract head:', JSON.stringify(extractPRDSections(prd, ['h3.4']).slice(0, 50)));
  console.log('any-miss fallback === full PRD:',
    extractPRDSections(prd, ['h3.4','nope.99']) === prd);
  console.log('empty selectors fallback === full PRD:', extractPRDSections(prd, []) === prd);
});"   # (run `npm run build` first; Expected: h3.4 → '### 4.2 The Execution Loop…'; both fallbacks true)
#   2. Live-selector coverage — EVERY distinct selector in plan/008/.../tasks.json resolves under
#      extractPRDSections (no accidental fallback) — proves the feature works end-to-end for real data.
#   3. Prompt shape — createPRPBlueprintPrompt(…, 'X') yields a prompt.user containing '## PRD Context'
#      and 'X'; with prdSections omitted, '## PRD Context' is absent (byte-identical to pre-S3).
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run validate` exits 0 (lint + format:check + typecheck).
- [ ] `npx vitest run tests/unit/core/prd-selector.test.ts --coverage` exits 0 with 100% on `src/core/prd-selector.ts`.
- [ ] `npx vitest run tests/unit/agents/prompts/prp-blueprint-prompt.test.ts` exits 0 (incl. 3 new cases).
- [ ] `npx vitest run tests/unit/agents/prp-generator.test.ts` shows **10 passed | 15 failed** (new wiring test passes; pre-existing failure count UNCHANGED).
- [ ] `npm run test:run` shows no NEW failures vs. the pre-S3 baseline; 100% coverage on edited src files.
- [ ] `npx tsc -p tsconfig.build.json` compiles.

### Feature Validation
- [ ] `extractPRDSections(prd, [])` === `prd`; `extractPRDSections(prd, ['h2.0'])` === the `h2.0` section text.
- [ ] `extractPRDSections(prd, ['h2.0','zzz.9'])` === `prd` (all-or-nothing any-miss fallback).
- [ ] `extractPRDSections` is SYNC, pure, no I/O, deterministic; reuses S2's `generateSectionIndex`.
- [ ] `extractPRDSections` re-exported from `src/core/index.ts`.
- [ ] `createPRPBlueprintPrompt(…, 'X')` injects `## PRD Context` + 'X'; omitted/empty ⇒ no block (byte-identical).
- [ ] `PRPGenerator.generate(subtask,…)` passes `extractPRDSections(resolvedPRD, subtask.prd_selectors)` as the 6th arg; `Task` ⇒ full resolved PRD.

### Code Quality Validation
- [ ] `prdSections?: string` is the 6th OPTIONAL param (never reordered, never required) — all ~50 call sites valid.
- [ ] `## PRD Context` block follows the existing conditional-block pattern (codebaseSection/feedbackSection).
- [ ] Mode-A JSDoc on `extractPRDSections` documents PRD §4.2, all-or-nothing fallback, SYNC/no-I/O, resolved-doc requirement.
- [ ] `generate()` reads selectors via `task.type === 'Subtask' ? task.prd_selectors : []` (Task-safe).
- [ ] File-disjoint from S1 (models.ts/fix-cycle-workflow.ts/models.test.ts) and S2's sole-owned logic (generateSectionIndex body).

### Documentation & Deployment
- [ ] Mode-A JSDoc on `extractPRDSections` is the only doc artifact (rides with the code).
- [ ] No `docs/*.md`, README, `.env.example`, or `prd_index.txt` changes.
- [ ] Commit message notes: the resolved-PRD data path (currentSession.prdSnapshot), the all-or-nothing fallback decision, the backward-compatible 6th optional param, and the pre-existing prp-generator.test.ts red state (15 failures, unchanged).

---

## Anti-Patterns to Avoid

- ❌ Don't make `prdSections` a required param or reorder the existing 5 — ~50 call sites pass 0-5 args. It MUST be the 6th OPTIONAL param.
- ❌ Don't read `prd_selectors` on a `Task` — it doesn't exist. Guard with `task.type === 'Subtask' ? task.prd_selectors : []`. A Task ⇒ `[]` ⇒ full-PRD fallback (correct).
- ❌ Don't return a PARTIAL slice when a selector misses — all-or-nothing: any single miss ⇒ the full resolved PRD. Contract-literal ("fails for any selector"). Partial slices can silently omit requirements.
- ❌ Don't make `extractPRDSections` async or do file I/O — the resolved string is passed in by the caller (`currentSession.prdSnapshot`, already materialized). SYNC, pure, deterministic — same invariant as S2's `generateSectionIndex`.
- ❌ Don't modify S2's `generateSectionIndex`/`SectionIndex`/`SelectorType` — S3 EXTENDS `prd-selector.ts`; it reuses the index, not rewrites it.
- ❌ Don't fix the 15 pre-existing `prp-generator.test.ts` failures — they predate S3 (a `readFile`-mock gap). Do NOT grow the count either; use the swallow-the-throw pattern for the wiring test.
- ❌ Don't rely on `createMockSubtask`'s default for `prd_selectors` — the factory omits it (compiles only because tests/ are excluded from tsc.build). Set it EXPLICITLY in the wiring test.
- ❌ Don't reorder sections in `constructUserPrompt`'s template — insert `${prdContextBlock}` at one point (after Parent Context, before codebaseSection) and keep everything else byte-identical so omitted-`prdSections` is byte-identical to today.
- ❌ Don't modify `PRP_BLUEPRINT_PROMPT` (the system prompt) or `prompts.ts` — the PRD sections go in the USER prompt via `constructUserPrompt`, not the system prompt.
- ❌ Don't touch `prd-differ.ts`, `models.ts`, `fix-cycle-workflow.ts`, `prd_index.txt`, or any `docs/*.md` — Mode A = JSDoc only; S1/S2/delta-workflow/Architect-agent own those.
- ❌ Don't change the concatenation order — join in SELECTOR order (`selectors` array order). Reordering would surprise callers; the Architect emits document order already.

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: Every integration fact is empirically verified, not inferred. The
resolved-PRD data path is traced (`currentSession.prdSnapshot` = resolved, set at
session-manager.ts:492/560). The building block (`generateSectionIndex`/`SectionIndex`)
is defined by S2's PRP (which completes before S3 by dependency). The single
production caller of `createPRPBlueprintPrompt` (prp-generator.ts:658) is
identified, and the backward-compatible 6th-OPTIONAL-param strategy is justified
against all ~50 call sites (agent-context-injection, blueprint-prompt, two
integration suites — all stay green). The all-or-nothing fallback is the
contract-literal reading and is rare in practice (S2 proved all 63 live selectors
resolve byte-exact). The one genuine landmine — `prp-generator.test.ts` is already
red (15 failures, proven by running it) — is explicitly fenced: the swallow-the-throw
pattern lets the wiring test assert the 6th arg without fixing or growing the
pre-existing failures, and the reliable proof of the feature lives in the pure
`extractPRDSections` + prompt-injection unit tests (no mocks). Residual risks are
mechanical and gate-caught: (a) a Task-vs-Subtask typecheck error from reading
`prd_selectors` unguarded (caught by `npm run typecheck`; fix = the type guard);
(b) a coverage gap on an `extractPRDSections` branch (caught by `--coverage`;
closed by adding one case); (c) a prettier nit (auto-fixed via `npm run fix`).
No runtime/network/LLM unknowns.