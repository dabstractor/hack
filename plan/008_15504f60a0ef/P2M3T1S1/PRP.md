# PRP — P2.M3.T1.S1: Update PRP blueprint prompt with strict single-PRP batching gates

---

## Goal

**Feature Goal**: Encode **PRD §6.2's** "Single-PRP default with strict batching
gates" rule directly into the **`PRP_BLUEPRINT_PROMPT` system-prompt text** in
`src/agents/prompts.ts`. After this change, every Researcher (PRP-creation) agent
invocation is explicitly told: (a) **default = write exactly ONE PRP** per call —
the one it was asked for; (b) batching multiple PRPs into one session is permitted
**only** as an optimization for tightly-coupled items, at a *higher* bar — and
**only** when ALL gates pass (full task-tree + full-PRD context held, 3–5 deep
research calls run *per item*, per-item "No Prior Knowledge" check passed, batch
declared explicitly); (c) **when in doubt, write one.** This converts an implicit
assumption into an enforced, regression-tested prompt instruction and closes out
the prompt-content half of milestone **P2.M3**.

**Deliverable**:
1. **`src/agents/prompts.ts`** — MODIFY the `PRP_BLUEPRINT_PROMPT` template-literal
   string: insert a dedicated, clearly-headed **`## MULTI-PRP BATCHING POLICY — READ THIS BEFORE WRITING MORE THAN ONE PRP`** section immediately **after** the
   line `You are creating a PRP (Product Requirement Prompt) for this specific work item.`
   (currently line 192, immediately before `## PRP Creation Mission`). The section
   must encode PRD §6.2's four gates verbatim-in-meaning: (a) default = exactly one
   PRP; (b) batching only when ALL gates pass — full task-tree + full-PRD context,
   3–5 research calls *per item*, per-item "No Prior Knowledge" check, explicit
   batch declaration; (c) when in doubt, write one. No other line of the constant
   changes.
2. **`tests/unit/agents/prompts.test.ts`** — ADD a focused regression test (one
   new `describe('PRP_BLUEPRINT_PROMPT single-PRP / batching gates (PRD §6.2)')`
   block with one or more `it(...)` cases) that asserts the key normative
   substrings are present in `PRP_BLUEPRINT_PROMPT`. This locks the §6.2 contract
   against future regressions (mirrors the existing
   `should carry the declaration (system channel)` substring-assertion style).

**Success Definition**:
- `rg -n "MULTI-PRP BATCHING POLICY" src/agents/prompts.ts` → exactly one match,
  inside `PRP_BLUEPRINT_PROMPT`, located after the `for this specific work item.`
  line and before `## PRP Creation Mission`.
- `rg -n "When in doubt, write one" src/agents/prompts.ts` → exactly one match,
  inside the new section.
- The new test block exists and PASSES, asserting (at minimum): `exactly ONE PRP`,
  `When in doubt, write one`, `No Prior Knowledge`, the per-item research budget
  (`3–5` with an en-dash **or** `3-5` with a hyphen — match whichever you write),
  and `MULTI-PRP`.
- All existing `PRP_BLUEPRINT_PROMPT` substring assertions in
  `tests/unit/agents/prompts.test.ts` and
  `tests/unit/agents/prompts/prp-blueprint-prompt.test.ts` still PASS unchanged
  (the change is purely additive text; no asserted substring is removed).
- `npm run validate` GREEN (lint + format:check + typecheck + `vitest run`) with
  **100% coverage on `src/**/*.ts`** preserved.

---

## User Persona (if applicable)

**Target User**: Pipeline contributor / orchestrator maintainer + the Researcher
agent itself (the system-prompt text is the agent's normative instruction set).
**Use Case**: A Researcher is invoked for one work item. It must unambiguously
know it should produce exactly ONE PRP by default, and exactly what evidence it
must hold before it is *allowed* to produce a second PRP in the same session.
**User Journey**: The Researcher reads the top of its system prompt, encounters
the `## MULTI-PRP BATCHING POLICY` section *before* the research/process
instructions, and (in the default case) writes the one PRP it was asked for. If
it ever considers batching, it self-checks against the enumerated gates and, on
any doubt, writes one.
**Pain Points Addressed**: Today `PRP_BLUEPRINT_PROMPT` says only *"You are
creating a PRP for this specific work item"* — a soft, single-item framing with
no explicit gate against batching. Past runs produced thin, under-researched
batched PRPs (the exact failure PRD §6.2 calls out). S1 makes the rule explicit
and machine-checkable.

---

## Why

- **PRD compliance**: PRD §6.2 (h3.13) mandates the Single-PRP default with strict
  batching gates. The blueprint system prompt is the channel that delivers that
  rule to the Researcher; encoding it there is the direct implementation.
- **Item contract (item 3 LOGIC)**: *"Update the PRP_BLUEPRINT_PROMPT system
  prompt text … to explicitly state: (a) Default: write exactly ONE PRP per call.
  (b) Batching is permitted ONLY when ALL gates pass … (c) When in doubt, write
  one PRP. This is a prompt-content change."* S1 implements exactly this.
- **Closes part of P2.M3**: Item 4 — "Completes this part of P2.M3." (The other
  half, the `prd status` CLI alias, is a separate subtask P2.M3.T1.S2.)
- **Prevents regression**: Without a test, the rule is a comment in markdown that
  a future edit could silently drop. The added substring assertions make §6.2 a
  CI-enforced contract.

### Out of scope (hard fences)
- **`createPRPBlueprintPrompt` / `prp-blueprint-prompt.ts`** → NOT edited. It only
  *consumes* the constant (and `.replace()`s one unrelated sentence when
  `prpOutputPath` is set — that replace targets `Store the PRP and documentation…`
  and is untouched by this change).
- **`prp-generator.ts`** → NOT edited. It calls `createPRPBlueprintPrompt`; no
  wiring change.
- **Any other prompt constant** (`TASK_BREAKDOWN_PROMPT`, `PRP_BUILDER_PROMPT`,
  `DELTA_PRD_PROMPT`, `DELTA_ANALYSIS_PROMPT`, `BUG_HUNT_PROMPT`,
  `PRD_PREMERGED_DECLARATION`) → NOT edited.
- **Any runtime/logic/behavior change** → NONE. This is pure prompt text + a test.
- **Docs** → item 5: *"DOCS: none — no user-facing/config/API surface change
  (prompt-internal)."* Do NOT edit `docs/CONFIGURATION.md`, `docs/ARCHITECTURE.md`,
  `README.md`, or `PROMPTS.md`.
- **Re-tuning the Research process / subagent wording** → OUT OF SCOPE. The
  existing `## Research Process` block (which already says "Subagents are OPTIONAL
  and may be unavailable") is left as-is. The new policy text must *coexist* with
  that note (see Implementation Patterns — phrase the "3–5 calls per item" gate so
  it does not contradict the subagent-optional caveat).
- **`PRD.md` / `tasks.json` / any `prd_snapshot.md`** → READ-ONLY (research agent
  never touches them).

---

## What

### User-visible behavior
None. No CLI, env, config, API, or runtime behavior change. The Researcher agent
receives a longer, more explicit system prompt.

### Technical requirements (exact contract — item 3)

**(a) Insert the batching-gates section into `PRP_BLUEPRINT_PROMPT`** — in
`src/agents/prompts.ts`, inside the `export const PRP_BLUEPRINT_PROMPT` template
literal (starts line 182). Insert the new section **immediately after** the line:

```
You are creating a PRP (Product Requirement Prompt) for this specific work item.
```

(currently line 192) and **immediately before** the line:

```
## PRP Creation Mission
```

(currently line 194). Use this verbatim section text (it encodes PRD §6.2's four
gates; keep the bold/emphasis and the `##` header so the LLM sees a distinct
section):

```
## MULTI-PRP BATCHING POLICY — READ THIS BEFORE WRITING MORE THAN ONE PRP

**Default: write exactly ONE PRP per call — the one you were asked for, at the exact path given.** Do not write PRPs for other work items "to be helpful" or to save tokens. Each item normally gets its own dedicated research session, and that is the expected, high-quality path.

Writing several PRPs in a single session is **allowed only as an optimization for tightly-coupled items that genuinely share one body of research** — and only when you hold yourself to a HIGHER bar, not a lower one. Saving tokens by producing thin PRPs is a failure: an under-researched PRP costs more in failed implementations than the research it skipped. The goal is fewer redundant planning *stages*, not shallower planning per item.

### HARD GATE — clear ALL of this before writing a second PRP
Before writing any PRP beyond the one you were asked for, verify EVERY item you intend to batch against ALL of these:

1. **Full situational awareness.** You have read the COMPLETE task tree and the FULL PRD — not just the selectors for the first item. You know every sibling task, its status, and how the items depend on each other.
2. **Per-item research, as thorough as an independent agent.** Each batched item gets its OWN 3–5 deep research calls (codebase analysis + external research), its own codebase + external analysis, and its own notes in its own research/ directory. The 3–5 call budget is PER PRP — a 3-PRP batch needs ~3× the research of a single PRP, not a third of it.
3. **Per-item "No Prior Knowledge" pass.** Each PRP independently clears the Context Completeness Check and the "No Prior Knowledge" test from the template. If ANY item would be thin, guess-y, or copy-pasted from a sibling, you have NOT met the bar.
4. **Explicit batch declaration.** Before writing, list every item you are batching, state why each shares this research session, and confirm each one clears the gates above.

**When in doubt, write one.** This prevents the thin, under-researched PRPs that batching produced in the past.

```

**Notes for the implementer:**
- The section ends with a **blank line** so the subsequent `## PRP Creation
  Mission` header stays separated (preserves markdown structure + the existing
  assertion `'PRP Creation Mission'` still matches the same header).
- The line `You are creating a PRP (Product Requirement Prompt) for this specific
  work item.` is left **untouched** (just above the new section). The new section
  is inserted between it and `## PRP Creation Mission`.
- This wording is **compatible** with the existing `## Research Process` block ~15
  lines below (which states "Subagents are OPTIONAL and may be unavailable"). It
  says "3–5 deep research calls" rather than mandating "subagent calls", so the
  subagent-optional caveat is not contradicted. PRD §6.2 says "3–5 subagent
  research calls per item"; the implementation preserves the *meaning* (per-item
  thoroughness, ~N× budget for an N-PRP batch) while honoring the
  subagent-optional note already in this constant.
- Use an **en-dash** (`–`, U+2013) in `3–5` to match PRD §6.2's typography — but
  if prettier/eslint rejects the non-ASCII dash in a template literal, fall back
  to a plain hyphen `3-5` and make the test assert that exact form. Pick ONE and
  make the test match. (Template literals accept UTF-8 fine; the en-dash is
  safe. Prettier does not reflow inside string literals.)

**(b) Add the regression test** — in
`tests/unit/agents/prompts.test.ts`, inside the existing top-level
`describe('prompts', ...)` (or as a sibling `describe` next to
`describe('pre-merged PRD declaration (PRD §2.3 "Agent guidance")')`), ADD:

```ts
describe('PRP_BLUEPRINT_PROMPT single-PRP / batching gates (PRD §6.2)', () => {
  it('should declare the single-PRP default', () => {
    expect(PRP_BLUEPRINT_PROMPT).toContain('exactly ONE PRP');
  });

  it('should carry the explicit "when in doubt, write one" rule', () => {
    expect(PRP_BLUEPRINT_PROMPT).toContain('When in doubt, write one');
  });

  it('should require a per-item No Prior Knowledge pass before batching', () => {
    expect(PRP_BLUEPRINT_PROMPT).toContain('No Prior Knowledge');
  });

  it('should state the per-item research budget (3–5 / 3-5 calls, ~N× for a batch)', () => {
    // Accept en-dash or hyphen — match whichever form you wrote in prompts.ts.
    expect(PRP_BLUEPRINT_PROMPT).toMatch(/3[–-]5/);
    expect(PRP_BLUEPRINT_PROMPT).toContain('PER PRP');
  });

  it('should headline the batching policy as its own section', () => {
    expect(PRP_BLUEPRINT_PROMPT).toContain('MULTI-PRP BATCHING POLICY');
    expect(PRP_BLUEPRINT_PROMPT).toContain('HARD GATE');
  });

  it('should preserve the existing single-item framing line above the new section', () => {
    // The line immediately above the new section must remain intact.
    expect(PRP_BLUEPRINT_PROMPT).toContain(
      'You are creating a PRP (Product Requirement Prompt) for this specific work item.'
    );
  });
});
```

`PRP_BLUEPRINT_PROMPT` is already imported at the top of
`tests/unit/agents/prompts.test.ts` (line 14) — verify the import exists; if not,
add `PRP_BLUEPRINT_PROMPT` to the existing `import { ... } from '#src/agents/prompts'`
/ relative import (mirror however the file currently imports it — see Context
§"the import").

**IMPORTANT — make the test's `3[–-]5` regex match the exact dash you typed in the
prompt.** If you write `3–5` (en-dash) in `prompts.ts`, the regex `/3[–-]5/`
matches both forms and is safe. If you write `3-5` (hyphen), the regex still
matches. Prefer the en-dash in the prompt to mirror PRD §6.2.

### Success Criteria
- [ ] `## MULTI-PRP BATCHING POLICY — READ THIS BEFORE WRITING MORE THAN ONE PRP`
      section present exactly once, inside `PRP_BLUEPRINT_PROMPT`, after the
      `for this specific work item.` line and before `## PRP Creation Mission`.
- [ ] The section encodes all four §6.2 gates (full task-tree+PRD context; 3–5
      research calls *per item*; per-item "No Prior Knowledge" pass; explicit
      batch declaration) and the "when in doubt, write one" rule.
- [ ] New `describe('PRP_BLUEPRINT_PROMPT single-PRP / batching gates (PRD §6.2)')`
      test block exists and all its `it(...)` cases PASS.
- [ ] All pre-existing `PRP_BLUEPRINT_PROMPT` assertions in
      `prompts.test.ts` and `prp-blueprint-prompt.test.ts` still PASS unchanged.
- [ ] `npm run validate` GREEN; 100% coverage on `src/**/*.ts` preserved.
- [ ] No edits to `prp-blueprint-prompt.ts`, `prp-generator.ts`, any other prompt
      constant, `PRD_PREMERGED_DECLARATION`, or any `docs/` file.

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_
**Yes.** This is a 2-file, text-only change (one prompt constant + one test
block). Its correctness hinges on five non-obvious facts, all pinned below with
exact file:line anchors: (1) the edit target is the **`PRP_BLUEPRINT_PROMPT`**
string constant in `src/agents/prompts.ts:182` (NOT the `createPRPBlueprintPrompt`
function named in the contract — that's the *consumer*); (2) the exact insertion
seam (after line 192 `…for this specific work item.`, before line 194
`## PRP Creation Mission`); (3) the existing substring assertions that must keep
passing (`'Create PRP for Work Item'`, `'PRP Creation Mission'`, `<item_title>`,
`<item_description>`, `'do not chase @include directives yourself'`,
`/DOCS impact/i`, `/Mode A/i`, `DOCS:`, `/Mode B/i`, `/changeset-level/i`); (4)
the existing `## Research Process` subagent-optional caveat the new text must not
contradict; (5) the verbatim PRD §6.2 normative text to encode. The scope fences
are airtight (no consumer edits, no docs, no runtime change).

### Documentation & References
```yaml
# MUST READ — the PRD spec (single source of truth for the rule being encoded)
- docfile: PRD.md
  section: "6.2 PRP Creation Prompt ('The Blueprint')" (h3.13), specifically the
           "Single-PRP default with strict batching gates" bullet
  why: This is the ENTIRE normative content S1 encodes into the prompt. Quote its
       four gates (full task-tree + full-PRD context; 3–5 research calls per item;
       per-item "No Prior Knowledge" check; explicit batch declaration) and the
       "When in doubt, write one." close.
  critical: The PRD says "3–5 subagent research calls per item". The constant
       already contains a subagent-OPTIONAL caveat in ## Research Process, so
       phrase the gate as "3–5 deep research calls" (per-item, ~N× for a batch)
       to preserve meaning without contradicting that caveat.

# MUST READ — this subtask's research (proven facts about the working tree)
- docfile: plan/008_15504f60a0ef/P2M3T1S1/research/s1-codebase-analysis.md
  section: §1 (the constant is the edit site), §2 (the exact insertion seam),
       §3 (existing assertions that must NOT break), §4 (the test to add),
       §5 (validation commands), §6 (scope fences), §7 (verbatim PRD §6.2 text),
       §8 (subagent-optional caveat compatibility)
  why: Proves the edit site, the seam, that no existing test breaks, and exactly
       what regression test to add.

# THE FILE TO EDIT (prompt text)
- file: src/agents/prompts.ts
  section: `export const PRP_BLUEPRINT_PROMPT` (line 182). Insert the new
           `## MULTI-PRP BATCHING POLICY …` section between line 192
           (`…for this specific work item.`) and line 194 (`## PRP Creation Mission`).
  why: This is the system-prompt text delivered to every Researcher agent. It is
       a template-literal STRING — editing it changes raw prompt text, no TS
       types/logic.
  pattern: The constant already uses `${PRD_PREMERGED_DECLARATION}` interpolations
       and markdown `##` headers; match that markdown density. Other sections
       (e.g. the `## PRP Creation Mission` and `## Research Process` blocks) show
       the prose style (bold for emphasis, numbered lists for gates).
  gotcha: Do NOT touch the `${PRD_PREMERGED_DECLARATION}` interpolation at line
       185 (still must appear). Do NOT remove/alter the
       `<item_title>`/`<item_description>` placeholders (asserted by tests). Do
       NOT edit any other prompt constant. Do NOT change the `.replace(...)`
       sentence targeted by createPRPBlueprintPrompt (`Store the PRP and
       documentation…`).

# THE FILE TO EDIT (regression test)
- file: tests/unit/agents/prompts.test.ts
  section: existing `describe('prompts', ...)` block; add a sibling `describe(
           'PRP_BLUEPRINT_PROMPT single-PRP / batching gates (PRD §6.2)')`.
  why: Lock the §6.2 substrings against regression. Mirrors the existing
       `PRP_BLUEPRINT_PROMPT should carry the declaration (system channel)` test
       (substring assertion on the constant).
  pattern: `expect(PRP_BLUEPRINT_PROMPT).toContain('…')` — exact style used by
       every other prompt-content test in this file. `PRP_BLUEPRINT_PROMPT` is
       imported at the top of the file (line 14).
  gotcha: Make the `3[–-]5` regex match the dash form you actually typed in
       prompts.ts (en-dash `–` recommended to mirror PRD §6.2; the regex matches
       both). Do NOT over-assert on exact full sentences (prompt prose may be
       lightly tuned) — assert the normative KEYWORDS/substrings instead.

# CONTRACT INPUTS (read-only — owned by other layers / other subtasks)
- file: src/agents/prompts/prp-blueprint-prompt.ts
  section: createPRPBlueprintPrompt (line 301), constructUserPrompt, the
           `.replace(/Store the PRP and documentation at the path…/)` at line ~317
  why: The CONSUMER of PRP_BLUEPRINT_PROMPT. Proves S1 does NOT need to touch it:
       it interpolates the constant verbatim and only replaces one unrelated
       sentence (when prpOutputPath is set). S1's added section does not contain
       that sentence, so the replace is unaffected.
  gotcha: READ-ONLY for S1. Do not edit.
- file: tests/unit/agents/prompts/prp-blueprint-prompt.test.ts
  why: Asserts on `prompt.systemOverride` / `prompt.user` substrings (task title,
       context_scope, `<item_title>`, parent context, DOCS impact, Mode A/B).
       S1's change is to the SYSTEM constant text and does NOT remove any of these.
       Confirms S1 needs NO change here.
  gotcha: READ-ONLY for S1 (do not edit; just confirm green after).
- file: vitest.config.ts
  section: coverage.include = ['src/**/*.ts'], thresholds 100%
  why: Confirms adding string-literal text to a constant (no new branch) cannot
       dent the 100% threshold; adding a test only adds coverage.
```

### Current Codebase tree (relevant slice)
```bash
src/
  agents/
    prompts.ts                          # EDIT — insert MULTI-PRP BATCHING POLICY
                                        #   section into PRP_BLUEPRINT_PROMPT (line ~192-194)
    prompts/
      prp-blueprint-prompt.ts           # untouched (consumer) — INPUT only
    prp-generator.ts                    # untouched — INPUT only
tests/
  unit/
    agents/
      prompts.test.ts                   # EDIT — add 1 describe block (§6.2 substrings)
      agents/
        prompts/
          prp-blueprint-prompt.test.ts  # untouched — confirm green (no edit)
vitest.config.ts                        # READ-ONLY — 100% coverage thresholds
package.json                            # READ-ONLY — `npm run validate` gate
PRD.md                                  # READ-ONLY — §6.2 (h3.13) source of truth
```

### Desired Codebase tree with files to be added and responsibility of file
```bash
src/agents/prompts.ts            # MODIFIED — +1 markdown section inside PRP_BLUEPRINT_PROMPT
                                 #   (MULTI-PRP BATCHING POLICY; 4 gates + "write one")
tests/unit/agents/prompts.test.ts # MODIFIED — +1 describe block asserting §6.2 substrings
# (no NEW files, no docs changes, no consumer/runtime/config changes)
```

### Known Gotchas of our codebase & Library Quirks
```ts
// CRITICAL: the EDIT SITE is the PRP_BLUEPRINT_PROMPT string constant in
// src/agents/prompts.ts:182 — NOT createPRPBlueprintPrompt. The contract names
// createPRPBlueprintPrompt (prp-blueprint-prompt.ts:288/301) but that function
// only CONSUMES the constant. Edit the constant text; leave the consumer alone.

// CRITICAL (insertion seam): insert AFTER the line
//   "You are creating a PRP (Product Requirement Prompt) for this specific work item."
// (line 192) and BEFORE "## PRP Creation Mission" (line 194). Do NOT insert inside
// the ## PRP Creation Mission block or the ## Research Process block — keep the new
// policy as its own clearly-headed section so the LLM sees it first.

// CRITICAL (existing assertions must stay green): these substrings are asserted by
// tests/unit/agents/prompts.test.ts and tests/unit/agents/prompts/prp-blueprint-prompt.test.ts
// and MUST remain present after the edit:
//   - 'Create PRP for Work Item'           (header)
//   - 'PRP Creation Mission'               (header)
//   - '<item_title>', '<item_description>' (placeholders)
//   - 'do not chase @include directives yourself'  (from ${PRD_PREMERGED_DECLARATION})
//   - /DOCS impact/i, /Mode A/i, 'DOCS:', /Mode B/i, /changeset-level/i  (§6.4 reminder)
// The proposed insertion does not remove any of these — verify with a quick rg before
// committing.

// GOTCHA (subagent-optional caveat): the SAME constant, ~15 lines below the
// insertion point, contains a ## Research Process block that says "Subagents are
// OPTIONAL and may be unavailable … STOP calling subagents and do the research
// yourself." PRD §6.2 says "3–5 subagent research calls per item". To avoid a
// contradiction, phrase the gate as "3–5 deep research calls (codebase analysis +
// external research) per item" — i.e. per-item thoroughness, not a hard subagent
// count. The ~N× budget phrasing is preserved either way.

// GOTCHA (en-dash vs hyphen): PRD §6.2 writes "3–5" with an en-dash (U+2013).
// Template literals accept UTF-8, and prettier does NOT reflow inside string
// literals, so the en-dash is safe in prompts.ts. Prefer the en-dash to mirror
// the PRD; make the test regex `/3[–-]5/` so it matches both dash forms (defensive
// against a future prettier/editor normalization).

// GOTCHA (100% coverage): prompts.ts is in the 100%-coverage include glob. Adding
// string-literal text to a constant creates NO new branch, so coverage is
// unaffected. Adding the describe/it test only ADDS coverage. Do not worry about
// the threshold.

// GOTCHA (don't over-assert): the new test should assert KEYWORDS/substrings
// ('exactly ONE PRP', 'When in doubt, write one', 'No Prior Knowledge',
// 'MULTI-PRP', 'HARD GATE', /3[–-]5/, 'PER PRP') — NOT entire sentences. Prompt
// prose may be lightly tuned later; keyword assertions are stable and still prove
// the §6.2 contract is present.

// CRITICAL (scope): item 5 = "DOCS: none — no user-facing/config/API surface
// change (prompt-internal)." Do NOT edit docs/CONFIGURATION.md, docs/ARCHITECTURE.md,
// README.md, PROMPTS.md, or PRD.md. Do NOT add env vars, CLI flags, or config keys.
// Do NOT touch createPRPBlueprintPrompt, prp-generator.ts, any other prompt
// constant, or PRD_PREMERGED_DECLARATION.

// GOTCHA (parallel seam with P2.M2.T1.S3): S3 is being implemented concurrently
// and edits src/workflows/prp-pipeline.ts + tests/unit/workflows/prp-pipeline.test.ts.
// S1 edits src/agents/prompts.ts + tests/unit/agents/prompts.test.ts — ZERO file
// overlap. The two PRPs cannot conflict at the filesystem level.
```

---

## Implementation Blueprint

### Data models and structure
None. S1 adds NO types, constants, fields, or logic. It edits one template-literal
**string** and adds one **test block**.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/agents/prompts.ts — insert the MULTI-PRP BATCHING POLICY section
  - LOCATE `export const PRP_BLUEPRINT_PROMPT` (line 182).
  - FIND the line `You are creating a PRP (Product Requirement Prompt) for this specific work item.`
    (line 192) and the next header `## PRP Creation Mission` (line 194).
  - INSERT the verbatim `## MULTI-PRP BATCHING POLICY — READ THIS BEFORE WRITING MORE
    THAN ONE PRP` section (see "What" §a) BETWEEN those two lines, preserving a blank
    line before `## PRP Creation Mission`.
  - PRESERVE: the `for this specific work item.` line, `${PRD_PREMERGED_DECLARATION}`
    interpolation, the `<item_title>`/`<item_description>` placeholders, the `## PRP
    Creation Mission` header, and EVERY other line of the constant.
  - FOLLOW pattern: the markdown density/style of the existing `## PRP Creation Mission`
    and `## Research Process` blocks (bold for emphasis, numbered list for the four gates).
  - GOTCHA: do NOT edit any other constant in this file. do NOT touch the line
    targeted by createPRPBlueprintPrompt's `.replace(/Store the PRP and documentation…/)`.

Task 2: MODIFY tests/unit/agents/prompts.test.ts — add the §6.2 regression test
  - CONFIRM `PRP_BLUEPRINT_PROMPT` is imported at the top of the file (line ~14).
    If not, add it to the existing import.
  - ADD a `describe('PRP_BLUEPRINT_PROMPT single-PRP / batching gates (PRD §6.2)',
    () => { ... })` block (see "What" §b for the verbatim it() cases). Place it as a
    sibling of `describe('pre-merged PRD declaration ...')`.
  - ASSERT the KEYWORDS: 'exactly ONE PRP', 'When in doubt, write one',
    'No Prior Knowledge', /3[–-]5/, 'PER PRP', 'MULTI-PRP BATCHING POLICY', 'HARD GATE',
    and the preserved framing line 'You are creating a PRP (Product Requirement Prompt)
    for this specific work item.'.
  - GOTCHA: make /3[–-]5/ match the dash form you typed in prompts.ts (en-dash
    recommended; regex matches both). Do NOT assert entire sentences.
  - FOLLOW pattern: `expect(PRP_BLUEPRINT_PROMPT).toContain('…')` — the exact style
    of the existing `should carry the declaration (system channel)` test.

Task 3: VERIFY — no regressions (read-only checks before declaring done)
  - RUN `npm run typecheck` → exit 0 (trivially — string edit + test edit compile).
  - RUN `npx vitest run tests/unit/agents/prompts.test.ts` → ALL green, including
    the NEW describe block AND the pre-existing PRP_BLUEPRINT_PROMPT assertions.
  - RUN `npx vitest run tests/unit/agents/prompts/prp-blueprint-prompt.test.ts` →
    ALL green (proves the consumer's substring assertions still pass).
  - RUN `npm run validate` → GREEN (lint + format:check + typecheck + vitest run)
    with 100% coverage on src/**/*.ts preserved.
  - VERIFY (rg) the new section landed exactly once, in the right place, and that
    NO asserted substring was removed (see Validation §Level 4).
  - VERIFY only the two intended files changed: `git diff --name-only` →
    src/agents/prompts.ts + tests/unit/agents/prompts.test.ts.
```

### Implementation Patterns & Key Details

```ts
// PATTERN: insert a clearly-headed markdown section into the system-prompt constant.
// src/agents/prompts.ts — PRP_BLUEPRINT_PROMPT (top), S1 adds ONLY the new section:
export const PRP_BLUEPRINT_PROMPT = `
# Create PRP for Work Item

${PRD_PREMERGED_DECLARATION}

## Work Item Information

**ITEM TITLE**: <item_title>
**ITEM DESCRIPTION**: <item_description>

You are creating a PRP (Product Requirement Prompt) for this specific work item.

## MULTI-PRP BATCHING POLICY — READ THIS BEFORE WRITING MORE THAN ONE PRP

**Default: write exactly ONE PRP per call …** …
… (four gates: situational awareness / per-item 3–5 research / No Prior Knowledge /
   explicit declaration) …
**When in doubt, write one.**

## PRP Creation Mission
… (unchanged) …

// PATTERN: substring assertions lock the §6.2 contract (mirrors existing style).
// tests/unit/agents/prompts.test.ts
describe('PRP_BLUEPRINT_PROMPT single-PRP / batching gates (PRD §6.2)', () => {
  it('should declare the single-PRP default', () => {
    expect(PRP_BLUEPRINT_PROMPT).toContain('exactly ONE PRP');
  });
  it('should carry the explicit "when in doubt, write one" rule', () => {
    expect(PRP_BLUEPRINT_PROMPT).toContain('When in doubt, write one');
  });
  it('should require a per-item No Prior Knowledge pass before batching', () => {
    expect(PRP_BLUEPRINT_PROMPT).toContain('No Prior Knowledge');
  });
  it('should state the per-item research budget (3–5 / 3-5, ~N× for a batch)', () => {
    expect(PRP_BLUEPRINT_PROMPT).toMatch(/3[–-]5/);   // matches en-dash OR hyphen
    expect(PRP_BLUEPRINT_PROMPT).toContain('PER PRP');
  });
  it('should headline the batching policy as its own section', () => {
    expect(PRP_BLUEPRINT_PROMPT).toContain('MULTI-PRP BATCHING POLICY');
    expect(PRP_BLUEPRINT_PROMPT).toContain('HARD GATE');
  });
  it('should preserve the existing single-item framing line above the new section', () => {
    expect(PRP_BLUEPRINT_PROMPT).toContain(
      'You are creating a PRP (Product Requirement Prompt) for this specific work item.'
    );
  });
});

// CRITICAL: the edit is ADDITIVE text inside a template-literal string — no logic,
//   no types, no runtime change. The consumer (createPRPBlueprintPrompt) interpolates
//   the constant verbatim and is unaffected.
// CRITICAL: do NOT remove any substring that existing tests assert on (see Known
//   Gotchas). The new section is inserted in a region that contains none of them.
```

### Integration Points

```yaml
PROMPT TEXT (src/agents/prompts.ts):
  - add: `## MULTI-PRP BATCHING POLICY …` section inside PRP_BLUEPRINT_PROMPT.
  - no logic change; no interpolation change; no other constant touched.

TESTS (tests/unit/agents/prompts.test.ts):
  - add: 1 `describe(...)` block (6 `it(...)` cases) asserting §6.2 substrings.
  - add: PRP_BLUEPRINT_PROMPT to the import if not already present.

NO CONSUMER CHANGE / NO RUNTIME CHANGE / NO DATABASE / NO ROUTES / NO ENV VARS /
NO CLI / NO DOCS / NO OTHER PROMPT CONSTANT
  — pure prompt-text + regression-test change.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# After editing prompts.ts (string text) + the test file:
npm run typecheck        # tsc --noEmit -p tsconfig.build.json → MUST be exit 0
npm run lint             # eslint . --ext .ts → the new markdown string/test should trip no rule
npm run format:check     # prettier; run `npm run format` if it complains

# Expected: Zero errors. The src/ change is text inside a template literal (cannot
# break compilation). The test change adds a describe/it block + maybe an import —
# typecheck confirms PRP_BLUEPRINT_PROMPT resolves.
```

### Level 2: Unit Tests (Component Validation)

```bash
# The prompt-content suite (includes the new §6.2 describe block):
npx vitest run tests/unit/agents/prompts.test.ts

# The consumer suite (must stay green — proves no asserted substring was removed):
npx vitest run tests/unit/agents/prompts/prp-blueprint-prompt.test.ts

# Full suite + 100% coverage enforcement:
npm run test:run
npx vitest run --coverage   # thresholds: statements/branches/functions/lines = 100

# Expected: ALL green. Specifically the NEW describe block passes all 6 it() cases.
# AND every pre-existing PRP_BLUEPRINT_PROMPT assertion still passes:
#   - 'Create PRP for Work Item', 'PRP Creation Mission' headers
#   - '<item_title>', '<item_description>' placeholders
#   - 'do not chase @include directives yourself' (declaration)
#   - /DOCS impact/i, /Mode A/i, 'DOCS:', /Mode B/i, /changeset-level/i (§6.4 reminder)
# Coverage on src/**/*.ts stays 100% (string-text edit adds no branch; the new test
# only adds coverage).
```

### Level 3: Integration Testing (System Validation)

```bash
# Full project validation gate (lint + format:check + typecheck + tests):
npm run validate

# Build (compiles dist — confirms no transitive breakage from the text/test edit):
npm run build

# Expected: `npm run validate` GREEN; `npm run build` succeeds. No runtime behavior
# change (the only src/ edit is text inside a string literal; the test edit is additive).
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Confirm the new section landed exactly once, in the right place:
rg -n "MULTI-PRP BATCHING POLICY" src/agents/prompts.ts
# EXPECT: exactly one match, inside PRP_BLUEPRINT_PROMPT, after the
# 'for this specific work item.' line and before '## PRP Creation Mission'.

# Confirm the "when in doubt, write one" rule is present:
rg -n "When in doubt, write one" src/agents/prompts.ts
# EXPECT: exactly one match, inside the new section.

# Confirm ALL existing asserted substrings still survive the edit:
rg -n "Create PRP for Work Item|PRP Creation Mission|<item_title>|<item_description>|do not chase @include directives yourself|DOCS impact|Mode A|Mode B|changeset-level" src/agents/prompts.ts
# EXPECT: every term still present (one or more matches each).

# Confirm the new regression test exists and asserts the §6.2 keywords:
rg -n "single-PRP / batching gates|exactly ONE PRP|When in doubt, write one|No Prior Knowledge|MULTI-PRP BATCHING POLICY|HARD GATE" tests/unit/agents/prompts.test.ts
# EXPECT: the describe title + each asserted substring present.

# Confirm ONLY the two intended files changed:
git diff --name-only
# EXPECT: only src/agents/prompts.ts and tests/unit/agents/prompts.test.ts.
#   (NO prp-blueprint-prompt.ts, prp-generator.ts, any other prompt constant,
#    PRD_PREMERGED_DECLARATION, PRD.md, tasks.json, or any docs/ file.)

# Expected: section present once, in place; all existing substrings intact; new test
# present; no out-of-scope file touched.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` exit 0 (PRP_BLUEPRINT_PROMPT import resolves; test compiles).
- [ ] `npm run validate` GREEN (lint + format:check + typecheck + `vitest run`).
- [ ] `npm run build` succeeds.
- [ ] 100% coverage on `src/**/*.ts` preserved (`vitest run --coverage`).

### Feature Validation
- [ ] `## MULTI-PRP BATCHING POLICY — READ THIS BEFORE WRITING MORE THAN ONE PRP`
      section present exactly once in `PRP_BLUEPRINT_PROMPT`, between the
      `for this specific work item.` line and `## PRP Creation Mission`.
- [ ] The section encodes all four §6.2 gates + "when in doubt, write one".
- [ ] New `describe('PRP_BLUEPRINT_PROMPT single-PRP / batching gates (PRD §6.2)')`
      block present with all `it(...)` cases passing.
- [ ] All pre-existing `PRP_BLUEPRINT_PROMPT` assertions (in `prompts.test.ts` and
      `prp-blueprint-prompt.test.ts`) still pass unchanged.
- [ ] No edits to `prp-blueprint-prompt.ts`, `prp-generator.ts`, any other prompt
      constant, `PRD_PREMERGED_DECLARATION`, or any `docs/` file.

### Code Quality Validation
- [ ] New section uses markdown `##` header + bold + numbered list matching the
      existing prose density (`## PRP Creation Mission`, `## Research Process`).
- [ ] The "3–5 calls per item" gate is phrased to coexist with the existing
      subagent-optional caveat (no contradiction).
- [ ] Test asserts KEYWORDS/substrings (stable), not entire sentences (brittle).
- [ ] The `3[–-]5` test regex matches the exact dash form typed in the prompt.

### Documentation & Deployment
- [ ] No docs edits (item 5: DOCS none).
- [ ] No new env vars / CLI flags / routes / config (pure prompt-text + test).

---

## Anti-Patterns to Avoid

- ❌ Don't edit `createPRPBlueprintPrompt` / `prp-blueprint-prompt.ts` — it only
  *consumes* the constant. The edit site is the `PRP_BLUEPRINT_PROMPT` string in
  `prompts.ts:182`.
- ❌ Don't edit `prp-generator.ts`, any other prompt constant, or
  `PRD_PREMERGED_DECLARATION` — out of scope.
- ❌ Don't remove or alter the `<item_title>`/`<item_description>` placeholders, the
  `${PRD_PREMERGED_DECLARATION}` interpolation, the `## PRP Creation Mission` header,
  or the §6.4 DOCS-impact reminder — all are asserted by existing tests.
- ❌ Don't insert the new section *inside* `## PRP Creation Mission` or
  `## Research Process` — give it its own clearly-headed section so the LLM sees the
  gates first.
- ❌ Don't phrase the "3–5 calls per item" gate as a hard "subagent calls" mandate —
  the same constant says subagents are OPTIONAL; phrase it as "3–5 deep research
  calls" to avoid contradicting that caveat.
- ❌ Don't over-assert in the test (entire sentences) — assert the normative
  keywords/substrings so light prose tuning later won't break CI.
- ❌ Don't edit any `docs/` file — item 5 says DOCS none (prompt-internal change).
- ❌ Don't add env vars / CLI flags / config keys — there is no user-facing surface.
- ❌ Don't add logic or a new constant — this is text inside one existing string
  literal plus one test block. Nothing else.

---

## Confidence Score

**9/10** — One-pass success likelihood is very high. S1 is a 2-file, text-only
change: one markdown section inserted into a template-literal **string** (no types,
no logic, no runtime effect) plus one `describe`/`it` test block that asserts
substrings. The correctness rests on five pre-proven facts: (1) the edit site is
`PRP_BLUEPRINT_PROMPT` in `prompts.ts:182` (the contract's `createPRPBlueprintPrompt`
reference is the *consumer*, read in full and confirmed untouched); (2) the exact
insertion seam (after line 192, before line 194) is located and contains none of the
asserted substrings; (3) every existing substring assertion that must survive is
enumerated (`'Create PRP for Work Item'`, `'PRP Creation Mission'`, placeholders,
declaration, §6.4 DOCS/Mode A/B) and the insertion removes none; (4) the subagent-
optional caveat 15 lines below is identified, and the new "3–5 deep research calls"
wording is designed to coexist with it; (5) the verbatim PRD §6.2 normative text is
quoted. The scope fences are airtight (no consumer/runtime/docs/other-constant
edits; zero file overlap with the parallel S3). The remaining 1/10 is the minor
en-dash-vs-hyphen detail in the `3–5` phrasing, which the `/3[–-]5/` test regex
defensively covers either way.