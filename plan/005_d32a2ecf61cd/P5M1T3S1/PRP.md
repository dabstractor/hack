# PRP — P5.M1.T3.S1: Add two-mode doc-sync rule to TASK_BREAKDOWN_PROMPT

## Goal

**Feature Goal**: Implement PRD §6.1's "Documentation Sync (two-mode rule)" inside the Architect agent's system prompt by appending an explicit **"DOCUMENTATION SYNC (TWO MODES)"** section to the `TASK_BREAKDOWN_PROMPT` HEREDOC constant in `src/agents/prompts.ts`. The rule states: documentation is **never a standalone subtask** (it rides with the work, mirroring the existing implicit-TDD rule); docs a subtask directly touches — config, public API, CLI, env vars, exported types — are updated **inside** that subtask's `context_scope` and declared via a `DOCS:` line (**Mode A**, default); cross-cutting docs that only make sense once the whole change lands — README, feature overviews, architecture summaries — become a **final "Sync changeset-level documentation" task** that depends on all implementing subtasks (**Mode B**); decision rule: per-file → Mode A, whole-feature/overview → Mode B, when in doubt both. The prompt already encodes implicit TDD ("docs never a standalone subtask"); this subtask makes the Mode A / Mode B rule **explicit and testable**.

**Deliverable**:
1. `src/agents/prompts.ts` — a new `### 5. DOCUMENTATION SYNC (TWO MODES)` section inserted into the `TASK_BREAKDOWN_PROMPT` `as const` string constant (after `### 4. THE "CONTEXT SCOPE" BLINDER`, before the `---` that closes the SOW section). Pure additive text; NO other constant, NO signature, NO runtime behavior change.
2. `tests/unit/agents/prompts.test.ts` — a NEW `describe('two-mode documentation sync rule (PRD §6.1)', ...)` block of **string assertions** that the `TASK_BREAKDOWN_PROMPT` contains: the "never a standalone subtask" rule; Mode A + Mode B; the `DOCS:` line requirement; Mode A's category list (config, public API, CLI, env vars, exported types); Mode B's category list (README, feature overviews, architecture summaries); the decision rule (per-file → Mode A; whole-feature/overview → Mode B; when in doubt, both). Written FIRST (RED), then made GREEN by the prompt edit.

**Success Definition**: `npm run validate` (eslint + prettier --check + tsc --noEmit) and `npm run test:run` (vitest run) both green; the new describe block passes; the existing `prompts.test.ts` assertions (LEAD TECHNICAL ARCHITECT / PROJECT SYNTHESIZER / ```json) still pass; `createArchitectPrompt(prdContent)` is **unchanged** (it consumes `TASK_BREAKDOWN_PROMPT` as `system` verbatim, so it automatically picks up the new text); `git diff --stat` shows ONLY the two in-scope files (`src/agents/prompts.ts`, `tests/unit/agents/prompts.test.ts`).

## Why

- **Business value**: PRD §6.1 turns documentation from an afterthought into a **rule-encoded part of the breakdown**. Without an explicit two-mode rule, the Architect agent either (a) creates wasteful standalone "Write docs" subtasks, or (b) silently drops documentation entirely, shipping stale READMEs. The two-mode rule guarantees every doc change is either attached to the implementing subtask (Mode A `DOCS:` line) or collected into a final changeset-level sync task (Mode B) — so docs ship with the work, never as a forgotten gap.
- **Scope boundary**: This subtask owns the **explicit text** of the Mode A/B rule in `TASK_BREAKDOWN_PROMPT` ONLY. It does NOT touch the sibling prompt that consumes the rule downstream — **P5.M1.T3.S2** will add the doc-impact-declaration requirement to the delta/blueprint prompts (`PRP_BLUEPRINT_PROMPT` / `DELTA_PRD_PROMPT`). This subtask closes the **Mode A/B rule half of R3**; S2 closes the declaration half.
- **Scope cohesion (R3 + parallel S4)**: This is the prompt-text half of the R3 cluster. It runs in parallel with **P5.M1.T2.S4** (orchestrator issue-loop) with **zero file overlap** (S4 edits `src/core/*` + `docs/WORKFLOWS.md`; this subtask edits `src/agents/prompts.ts` + its unit test). The future **S2** edits a *different constant* in the same `prompts.ts` file, so keeping this edit localized to the `TASK_BREAKDOWN_PROMPT` region avoids a future merge conflict.
- **Why a string-constant edit (not runtime code)**: The doc-sync rule is a **prompt directive** the LLM Architect obeys at breakdown time — there is no runtime function to add. The mechanism IS the prompt text. That is why `DOCS: [Mode A] none — this subtask IS the doc-sync mechanism` (per the item contract): no external doc file is touched.

## What

### User-visible behavior

None directly — `TASK_BREAKDOWN_PROMPT` is the Architect agent's system prompt. The observable downstream effect is that Architect-generated backlogs will (a) never contain standalone "documentation" subtasks, (b) carry a `DOCS:` line inside implementing subtasks' `context_scope` for per-file docs (Mode A), and (c) terminate with a final "Sync changeset-level documentation" task depending on all implementing subtasks when cross-cutting docs exist (Mode B).

### Technical requirements (the CONTRACT)

1. **Insertion is additive and localized.** Add ONE new `### 5. DOCUMENTATION SYNC (TWO MODES)` markdown section inside the `TASK_BREAKDOWN_PROMPT` constant, placed **after** the `### 4. THE "CONTEXT SCOPE" BLINDER` bullet list and **before** the `---` separator that closes the `## CRITICAL CONSTRAINTS & STANDARD OF WORK (SOW)` section. Do NOT renumber existing `### 1`–`### 4` headings. Do NOT touch any other constant (`PRP_BLUEPRINT_PROMPT`, `PRP_BUILDER_PROMPT`, `DELTA_PRD_PROMPT`, `DELTA_ANALYSIS_PROMPT`, `BUG_HUNT_PROMPT`, `PROMPTS`).
2. **Canonical section text (use this exact wording — the test assertions are derived from its substrings).** The inserted block must contain (at minimum) these phrases verbatim so the string assertions pass:
   - The invariant sentence: `Documentation is never a standalone subtask` and a phrase that `mirrors the implicit-TDD rule` (e.g. "mirroring the implicit-TDD rule").
   - **Mode A (doc-with-work, default)** with a `DOCS:` line requirement inside `context_scope`, and the category list: **config, public API, CLI, env vars, exported types**.
   - **Mode B (changeset-level)** as a **final "Sync changeset-level documentation" task** that **depends on all implementing subtasks**, with the category list: **README, feature overviews, architecture summaries**.
   - The **decision rule**: `per-file → Mode A; whole-feature/overview → Mode B; when in doubt, both`.
   - (See "Implementation Blueprint → Data models and structure" for the full canonical block, which contains every one of these substrings.)
3. **No signature / no runtime change.** `createArchitectPrompt(prdContent)` in `src/agents/prompts/architect-prompt.ts` is UNCHANGED — it reads `system: TASK_BREAKDOWN_PROMPT` verbatim, so it automatically picks up the new text. Do NOT edit `architect-prompt.ts`.
4. **TDD (RED before GREEN — implementation_notes.md §7).** Write the failing string-assertion `describe` block in `tests/unit/agents/prompts.test.ts` FIRST; confirm it fails (`npm run test:run -- prompts`); THEN insert the section text; then confirm it passes.
5. **No external doc file (Mode A docs = none).** Do NOT edit `docs/WORKFLOWS.md`, `docs/ARCHITECTURE.md`, `docs/CONFIGURATION.md`, or any other `docs/*` file. The item contract is explicit: this subtask IS the doc-sync mechanism (the prompt text itself); no external doc is touched.
6. **Prettier compliance.** `npm run format:check` checks `**/*.{ts,js,json,md,yml,yaml}`, including `src/agents/prompts.ts`. The HEREDOC content inside a template literal is NOT reformatted by prettier (it is a string), but the surrounding TS must stay compliant. Run `npm run format` (writes) then `npm run validate` to be safe.
7. **PROMPTS.md (legacy) is OUT OF SCOPE.** `prompts.ts` JSDoc cites "Source: PROMPTS.md lines 54-169", but `PROMPTS.md` is the legacy bash source and is NOT the runtime consumer (`prompts.ts` is, via `createArchitectPrompt`). The item OUTPUT contract is the `TASK_BREAKDOWN_PROMPT` constant only. Do NOT edit `PROMPTS.md` (optional, not required by any gate).

### Success Criteria

- [ ] `TASK_BREAKDOWN_PROMPT` contains `### 5. DOCUMENTATION SYNC (TWO MODES)` heading.
- [ ] `TASK_BREAKDOWN_PROMPT` contains the invariant `Documentation is never a standalone subtask`.
- [ ] `TASK_BREAKDOWN_PROMPT` contains a phrase mirroring the implicit-TDD rule (e.g. `mirroring the implicit-TDD rule`).
- [ ] `TASK_BREAKDOWN_PROMPT` defines **Mode A** with a `DOCS:` line requirement inside `context_scope`, listing **config, public API, CLI, env vars, exported types**.
- [ ] `TASK_BREAKDOWN_PROMPT` defines **Mode B** as a final changeset-level doc-sync task depending on all implementing subtasks, listing **README, feature overviews, architecture summaries**.
- [ ] `TASK_BREAKDOWN_PROMPT` contains the **decision rule**: `per-file → Mode A; whole-feature/overview → Mode B; when in doubt, both`.
- [ ] The new `describe('two-mode documentation sync rule ...')` block passes; the existing `prompts.test.ts` assertions still pass.
- [ ] RED step observed before GREEN (failing test written before the prompt edit — TDD).
- [ ] `npm run validate` passes (zero errors: eslint + prettier --check + tsc --noEmit).
- [ ] `npm run test:run` passes (all green).
- [ ] `git diff --stat` shows ONLY `src/agents/prompts.ts` + `tests/unit/agents/prompts.test.ts`.

## All Needed Context

### Context Completeness Check

_Pass_: An agent with zero codebase knowledge can implement this from (a) the exact current SOW block quoted below (the insertion site — anchored on the MOCKING bullet + the `---`), (b) the canonical section text to insert (verbatim in "Data models and structure"), (c) the exact test assertions (verbatim in Task 1), and (d) the verified validation commands. Every reference resolves to a real file/line in the tree today. No inference required — it is a localized string edit + a string-assertion test.

### Documentation & References

```yaml
# MUST READ — the PRIMARY file edited (the prompt constant)
- file: src/agents/prompts.ts
  why: |
    Contains the TASK_BREAKDOWN_PROMPT `as const` string constant (starts ~L37, `export const TASK_BREAKDOWN_PROMPT = \``).
    The insertion site is INSIDE `## CRITICAL CONSTRAINTS & STANDARD OF WORK (SOW)`, after `### 4. THE "CONTEXT SCOPE" BLINDER`
    and before the `---` that closes SOW. The existing `### 3. IMPLICIT TDD & QUALITY` ("DO NOT create subtasks for 'Write Tests.'")
    is the rule the new section explicitly mirrors — keep both under SOW as siblings.
  pattern: |
    # CURRENT SOW tail (EXACT — the block to anchor the edit on; the new ### 5 goes between MOCKING and ---):
    ### 4. THE "CONTEXT SCOPE" BLINDER

    For every Subtask, the \`context_scope\` must be a **strict set of instructions** for a developer who cannot see the rest of the project. It must define:

    - **INPUT:** What specific data/interfaces are available from previous subtasks?
    - **OUTPUT:** What exact interface does this subtask expose?
    - **MOCKING:** What external services must be mocked to keep this subtask isolated?

    ---

    ## PROCESS
  gotcha: |
    - The edit is PURELY additive text INSIDE the template literal. Do NOT touch the `as const`, the JSDoc comment above the
      constant, or any other constant in the file.
    - prettier does NOT reformat the inside of a template-literal string, so the markdown spacing is yours to control; just keep
      the surrounding TS valid. Run `npm run format` then `npm run validate` regardless.
    - Do NOT renumber `### 1`..`### 4` — adding `### 5` keeps the existing headings (and the existing tests) intact.

# MUST READ — the consumer (UNCHANGED — read-only confirmation)
- file: src/agents/prompts/architect-prompt.ts
  why: |
    createArchitectPrompt(prdContent) sets `system: TASK_BREAKDOWN_PROMPT` + `responseFormat: BacklogSchema`. Because it reads the
    constant verbatim, the new section is consumed AUTOMATICALLY with NO code change. Confirm this is a read-only reference (do not edit it).
  section: createArchitectPrompt()

# MUST READ — the test file to extend (the assertion site)
- file: tests/unit/agents/prompts.test.ts
  why: |
    The file imports TASK_BREAKDOWN_PROMPT from '../../../src/agents/prompts.js' (NOTE the `.js` ESM specifier — do NOT change it).
    Existing blocks: describe('prompt exports'), describe('prompt content validation'), describe('PROMPTS lookup object'),
    describe('formatting preservation'). Idiom is `expect(TASK_BREAKDOWN_PROMPT).toContain('exact phrase')`.
    Add a NEW sibling `describe('two-mode documentation sync rule (PRD §6.1)', ...)` at the END of the outer describe (after
    'formatting preservation'). Use .toContain for exact invariants + .toMatch(/.../i) for category words.
  pattern: |
    # EXISTING idiom to clone (the 'prompt content validation' / 'formatting preservation' blocks):
    it('TASK_BREAKDOWN_PROMPT should contain expected header', () => {
      expect(TASK_BREAKDOWN_PROMPT).toContain('LEAD TECHNICAL ARCHITECT');
      expect(TASK_BREAKDOWN_PROMPT).toContain('PROJECT SYNTHESIZER');
    });
  gotcha: |
    - Do NOT modify the existing assertions — only ADD a new describe block. The existing 'TASK_BREAKDOWN_PROMPT should contain
      expected header' and 'should preserve markdown code blocks' (`'```json'`) tests must still pass (they reference text you are NOT touching).
    - Vitest globals are enabled (vitest.config.ts test.globals:true), but the file already uses explicit `import { describe, expect, it } from 'vitest';` — match that style (no new import needed).

# REFERENCE — PRD source of truth for the two-mode rule (verbatim contract)
- file: PRD.md
  why: §6.1 "Task Breakdown System Prompt → Documentation Sync (two-mode rule)" is the authoritative text for Mode A / Mode B. Mode A = DOCS: line inside context_scope; Mode B = final changeset-level task depending on all implementing subtasks.
  section: "§6.1 Task Breakdown System Prompt"

# REFERENCE — feature cluster + R3 boundary
- file: plan/005_d32a2ecf61cd/architecture/delta_impact.md
  why: R3 confirms this subtask = ADD the two-mode rule text to TASK_BREAKDOWN_PROMPT (Mode A DOCS: line / Mode B final task), mirroring the existing implicit-TDD framing. Confirms S2 (sibling, different prompt) owns the delta/blueprint doc-impact-declaration half.
  section: "R3 — Documentation two-mode sync rule (PRD §6.1, §6.4) — PROMPT change"

# REFERENCE — discipline rules (TDD ordering, validation gates, file boundaries)
- file: plan/005_d32a2ecf61cd/architecture/implementation_notes.md
  why: §7 (same-commit TDD — failing test first), §10 (validation gates: npm run validate + npm run test:run). Confirms the prompt-text change is the mechanism (no runtime file).
  section: "§7, §10"
```

### Current Codebase tree (relevant slice)

```bash
src/agents/
├── prompts.ts                          # <-- EDIT: +### 5. DOCUMENTATION SYNC (TWO MODES) inside TASK_BREAKDOWN_PROMPT
└── prompts/
    └── architect-prompt.ts             # <-- DO NOT TOUCH (consumer; reads the constant verbatim)

tests/unit/agents/
└── prompts.test.ts                     # <-- EDIT: +describe('two-mode documentation sync rule ...') block

# Out of scope (do NOT touch):
PROMPTS.md                              # legacy bash source; NOT the runtime consumer
docs/WORKFLOWS.md, docs/*.md            # NO Mode A doc file (this subtask IS the doc-sync mechanism)
```

### Desired Codebase tree with files to be added/modified

```bash
src/agents/
└── prompts.ts                          # MODIFIED: +### 5. DOCUMENTATION SYNC (TWO MODES) section (additive text)

tests/unit/agents/
└── prompts.test.ts                     # MODIFIED: +two-mode doc-sync describe block (string assertions)
```

> **File-placement decision**: Both edits land in existing files — no new modules, no new types, no new exports. The new markdown section is inline inside the existing `TASK_BREAKDOWN_PROMPT` constant.

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL: The edit is PURELY additive text INSIDE the TASK_BREAKDOWN_PROMPT template literal.
//   Do NOT touch: `as const`, the JSDoc above the constant, any other constant, architect-prompt.ts.

// CRITICAL: Keep the edit LOCALIZED to the TASK_BREAKDOWN_PROMPT constant region.
//   The sibling subtask S2 (Planned) will edit PRP_BLUEPRINT_PROMPT / DELTA_PRD_PROMPT in the SAME file.
//   A localized, additive edit avoids a future merge conflict. Do NOT reformat the rest of the file.

// CRITICAL: Do NOT renumber ### 1..### 4. Add ### 5. DOCUMENTATION SYNC (TWO MODES) after ### 4,
//   before the `---` that closes SOW. Renumbering risks confusing the LLM reader and is unnecessary.

// CRITICAL: The test assertions and the canonical section text MUST be consistent. The canonical block in
//   "Data models and structure" contains every substring the assertions check for (verified one-by-one).
//   Copy that block verbatim; do NOT paraphrase away the exact phrases the tests .toContain.

// CRITICAL: Existing prompts.test.ts assertions must STILL pass:
//   - 'TASK_BREAKDOWN_PROMPT should contain expected header' (LEAD TECHNICAL ARCHITECT / PROJECT SYNTHESIZER)
//   - 'TASK_BREAKDOWN_PROMPT should preserve markdown code blocks' ('```json', '```')
//   These reference text you are NOT touching → they stay green automatically.

// GOTCHA: prettier --check covers src/agents/prompts.ts (format:check = "**/*.{ts,js,json,md,yml,yaml}").
//   prettier does NOT rewrite the inside of a template literal, but run `npm run format` then `npm run validate`
//   to be safe (in case the surrounding TS drifts).

// GOTCHA: vitest.config.ts sets coverage thresholds to 100% — but coverage is only ENFORCED by
//   `npm run test:coverage`, NOT by `npm run test:run` or `npm run validate`. Editing a string constant does
//   not reduce coverage. → Safe; do not chase coverage on the prompt constant.

// GOTCHA: ESM import specifiers use `.js` in `.ts` files. The test already imports
//   `from '../../../src/agents/prompts.js'` — leave it. No new import is needed for this change.

// GOTCHA: The PRD §6.1 wording uses "Sync changeset-level documentation" for Mode B. Reuse that EXACT phrase
//   in the section (it is also a test anchor) so the Architect output matches downstream expectations.
```

## Implementation Blueprint

### Data models and structure

No data models. This subtask is ONE markdown section (a string) + ONE test describe block. Below is the **canonical section text to insert VERBATIM** — it contains every substring the test assertions check for (verified one-by-one):

```typescript
// === CANONICAL SECTION TEXT — insert this block VERBATIM into TASK_BREAKDOWN_PROMPT,
//     after `### 4. THE "CONTEXT SCOPE" BLINDER` (after its MOCKING bullet) and before the `---`:

### 5. DOCUMENTATION SYNC (TWO MODES)

**Documentation is never a standalone subtask — it rides with the work, mirroring the implicit-TDD rule.** Every documentation change falls into one of two modes:

- **MODE A (doc-with-work, default):** Documentation a subtask _directly_ touches — config, public API, CLI, env vars, exported types — is updated **INSIDE** that subtask's \`context_scope\` and declared via a \`DOCS:\` line (e.g. \`DOCS: update docs/CONFIGURATION.md FEATURE_TIMEOUT row\`). Per-file docs → Mode A.
- **MODE B (changeset-level):** Cross-cutting docs that only make sense once the whole change lands — README, feature overviews, architecture summaries — become a **FINAL "Sync changeset-level documentation" task** that depends on all implementing subtasks. Whole-feature/overview docs → Mode B.
- **DECISION RULE:** per-file → Mode A; whole-feature/overview → Mode B; **when in doubt, both.**

// === END CANONICAL BLOCK ===

// === CANONICAL TEST BLOCK — add VERBATIM as a new describe in tests/unit/agents/prompts.test.ts ===
// (derive assertions from the canonical section above — they are guaranteed consistent)

describe('two-mode documentation sync rule (PRD §6.1)', () => {
  it('should declare documentation is never a standalone subtask, mirroring implicit TDD', () => {
    expect(TASK_BREAKDOWN_PROMPT).toContain('never a standalone subtask');
    expect(TASK_BREAKDOWN_PROMPT).toMatch(/mirror/i);
  });

  it('should define Mode A (doc-with-work) requiring a DOCS: line inside context_scope', () => {
    expect(TASK_BREAKDOWN_PROMPT).toMatch(/Mode A/i);
    expect(TASK_BREAKDOWN_PROMPT).toContain('DOCS:');
    expect(TASK_BREAKDOWN_PROMPT).toMatch(/context_scope/i);
    // Mode A category list (PRD §6.1):
    expect(TASK_BREAKDOWN_PROMPT).toMatch(/config/i);
    expect(TASK_BREAKDOWN_PROMPT).toMatch(/public API/i);
    expect(TASK_BREAKDOWN_PROMPT).toMatch(/CLI/i);
    expect(TASK_BREAKDOWN_PROMPT).toMatch(/env var/i);
    expect(TASK_BREAKDOWN_PROMPT).toMatch(/exported type/i);
  });

  it('should define Mode B (changeset-level) as a final doc-sync task depending on all implementing subtasks', () => {
    expect(TASK_BREAKDOWN_PROMPT).toMatch(/Mode B/i);
    expect(TASK_BREAKDOWN_PROMPT).toMatch(/changeset-level|changeset level/i);
    // Mode B category list (PRD §6.1):
    expect(TASK_BREAKDOWN_PROMPT).toMatch(/README/i);
    expect(TASK_BREAKDOWN_PROMPT).toMatch(/overview/i);
    expect(TASK_BREAKDOWN_PROMPT).toMatch(/architecture summar/i);
    // Mode B is a FINAL task that depends on all implementing subtasks:
    expect(TASK_BREAKDOWN_PROMPT).toMatch(/final/i);
    expect(TASK_BREAKDOWN_PROMPT).toMatch(/depend/i);
  });

  it('should include the decision rule (per-file -> Mode A; whole-feature/overview -> Mode B; when in doubt, both)', () => {
    expect(TASK_BREAKDOWN_PROMPT).toMatch(/per-file|per file/i);
    expect(TASK_BREAKDOWN_PROMPT).toMatch(/whole-feature|whole feature|overview/i);
    expect(TASK_BREAKDOWN_PROMPT).toMatch(/when in doubt/i);
  });
});
// === END CANONICAL TEST BLOCK ===
```

### Implementation Tasks (ordered by dependencies — strict TDD)

```yaml
Task 1: WRITE the failing test in tests/unit/agents/prompts.test.ts  (RED — before Task 2)
  - ADD the canonical `describe('two-mode documentation sync rule (PRD §6.1)', ...)` block (4 `it` cases, verbatim
      from "Data models and structure") as a NEW sibling describe at the END of the outer `describe('agents/prompts', ...)`
      (after the existing `describe('formatting preservation', ...)`).
  - FOLLOW pattern: the existing `it('TASK_BREAKDOWN_PROMPT should contain expected header', ...)` — same `.toContain`
      idiom. Vitest `describe`/`expect`/`it` already imported at the top of the file; NO new import needed.
  - DO NOT modify any existing assertion (the LEAD TECHNICAL ARCHITECT / PROJECT SYNTHESIZER / ```json tests must stay green).
  - VERIFY IT FAILS FIRST: `npm run test:run -- prompts` — the 4 new `it` cases fail (the substrings are not yet in
      TASK_BREAKDOWN_PROMPT). RED step.
  - PLACEMENT: tests/unit/agents/prompts.test.ts.

Task 2: INSERT the canonical section into src/agents/prompts.ts  (makes Task 1 GREEN)
  - STEP 2a: Locate the `## CRITICAL CONSTRAINTS & STANDARD OF WORK (SOW)` section inside `TASK_BREAKDOWN_PROMPT`,
      specifically the tail of `### 4. THE "CONTEXT SCOPE" BLINDER` (the `- **MOCKING:** ...` bullet) immediately
      followed by a blank line and `---`.
  - STEP 2b: INSERT the canonical `### 5. DOCUMENTATION SYNC (TWO MODES)` block (verbatim from "Data models and
      structure") AFTER the MOCKING bullet and BEFORE the `---` separator. Keep the surrounding blank lines so the
      markdown stays well-formed (one blank line above the new `### 5`, one blank line between the block and `---`).
  - STEP 2c: Do NOT touch `as const`, the JSDoc comment above the constant, any other constant, or any other file.
  - GOTCHA: Use the EXACT canonical wording — the test assertions in Task 1 match these substrings. Do NOT paraphrase
      away `never a standalone subtask`, `DOCS:`, `mirroring the implicit-TDD rule`, `per-file`, `whole-feature/overview`,
      `when in doubt`, or the category lists (config, public API, CLI, env vars, exported types / README, feature overviews,
      architecture summaries).
  - GOTCHA: The backticks inside the section (`\`context_scope\``, `\`DOCS:\``, `\`DOCS: update docs/CONFIGURATION.md ...\``)
      MUST be ESCAPED as \` because they live INSIDE a template literal. Use the canonical block's escaping verbatim.
  - PLACEMENT: src/agents/prompts.ts (inside the TASK_BREAKDOWN_PROMPT constant only).

Task 3: VERIFY (validation gates — run after Task 2)
  - RUN: `npm run validate` (lint + prettier --check + tsc --noEmit) — expect zero errors.
      If prettier --check fails on prompts.ts or the test file, run `npm run format` (writes) then `npm run validate`.
  - RUN: `npm run test:run` (vitest run) — expect all green incl. the 4 new `it` cases + every existing prompts.test.ts assertion.
  - GREP-VERIFY scope: `git diff --stat` must show ONLY src/agents/prompts.ts + tests/unit/agents/prompts.test.ts.
      `git diff src/agents/prompts/architect-prompt.ts PROMPTS.md docs/WORKFLOWS.md` must be EMPTY.
  - GREP-VERIFY content: `grep -n "DOCUMENTATION SYNC (TWO MODES)\|never a standalone subtask\|DOCS:\|Mode A\|Mode B\|when in doubt" src/agents/prompts.ts` → ≥6 matches inside TASK_BREAKDOWN_PROMPT.
```

### Implementation Patterns & Key Details

```typescript
// === PATTERN: the exact edit (oldText -> newText) for src/agents/prompts.ts ===
// (Anchored on the MOCKING bullet + the `---`. Insert the new section between them.)

// oldText (unique anchor — the tail of SOW):
//   - **MOCKING:** What external services must be mocked to keep this subtask isolated?
//
//   ---
//
//   ## PROCESS

// newText (the canonical ### 5 block slotted in BEFORE the `---`):
//   - **MOCKING:** What external services must be mocked to keep this subtask isolated?
//
//   ### 5. DOCUMENTATION SYNC (TWO MODES)
//
//   **Documentation is never a standalone subtask — it rides with the work, mirroring the implicit-TDD rule.** Every documentation change falls into one of two modes:
//
//   - **MODE A (doc-with-work, default):** Documentation a subtask _directly_ touches — config, public API, CLI, env vars, exported types — is updated **INSIDE** that subtask's \`context_scope\` and declared via a \`DOCS:\` line (e.g. \`DOCS: update docs/CONFIGURATION.md FEATURE_TIMEOUT row\`). Per-file docs → Mode A.
//   - **MODE B (changeset-level):** Cross-cutting docs that only make sense once the whole change lands — README, feature overviews, architecture summaries — become a **FINAL "Sync changeset-level documentation" task** that depends on all implementing subtasks. Whole-feature/overview docs → Mode B.
//   - **DECISION RULE:** per-file → Mode A; whole-feature/overview → Mode B; **when in doubt, both.**
//
//   ---
//
//   ## PROCESS

// === PATTERN: the test assertions are STRING checks on the constant (NO mocking, NO network) ===
//   expect(TASK_BREAKDOWN_PROMPT).toContain('never a standalone subtask');   // the invariant
//   expect(TASK_BREAKDOWN_PROMPT).toContain('DOCS:');                        // Mode A declaration line
//   expect(TASK_BREAKDOWN_PROMPT).toMatch(/Mode A/i);
//   expect(TASK_BREAKDOWN_PROMPT).toMatch(/Mode B/i);
//   expect(TASK_BREAKDOWN_PROMPT).toMatch(/when in doubt/i);
```

### Integration Points

```yaml
PROMPT CONSTANT (the change):
  - edit: src/agents/prompts.ts TASK_BREAKDOWN_PROMPT → +### 5. DOCUMENTATION SYNC (TWO MODES) section (additive)

TEST (the validation):
  - edit: tests/unit/agents/prompts.test.ts → +describe('two-mode documentation sync rule (PRD §6.1)') block

NOT TOUCHED (scope guardrails):
  - src/agents/prompts/architect-prompt.ts        # consumer; reads the constant verbatim (no change needed)
  - src/agents/prompts.ts other constants          # PRP_BLUEPRINT_PROMPT / PRP_BUILDER_PROMPT / DELTA_PRD_PROMPT /
                                                   #   DELTA_ANALYSIS_PROMPT / BUG_HUNT_PROMPT / PROMPTS  (S2 / other tasks own these)
  - PROMPTS.md                                     # legacy bash source; NOT the runtime consumer
  - docs/WORKFLOWS.md, docs/ARCHITECTURE.md, ...   # NO Mode A doc file (this subtask IS the doc-sync mechanism)
  - src/core/* (S4 territory)                      # parallel subtask; zero overlap

CONSUMES:
  - PRD §6.1 "Documentation Sync (two-mode rule)" (authoritative text for Mode A / Mode B / decision rule)
  - existing `### 3. IMPLICIT TDD & QUALITY` framing (the rule the new section explicitly mirrors)
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# After Task 2 (prompt edit) + Task 1 (test edit):
npm run validate
# = npm run lint && npm run format:check && npm run typecheck
#   lint      = eslint . --ext .ts
#   format:check = prettier --check "**/*.{ts,js,json,md,yml,yaml}"
#   typecheck = tsc --noEmit -p tsconfig.build.json
# Expected: zero errors. A string-constant edit + additive test is type-neutral; lint should pass.
# If prettier --check fails, run:
npm run format        # WRITES the prettier-compliant form
npm run validate      # re-check; expect zero errors.
# Common failure: stray unescaped backtick inside the template literal (the \`context_scope\` / \`DOCS:\` must be \`-escaped).
```

### Level 2: Unit Tests (Component Validation)

```bash
# RED step (after Task 1, before Task 2) — MUST fail first (TDD):
npm run test:run -- prompts
# Expected: the 4 new `it` cases FAIL (the substrings are not yet in TASK_BREAKDOWN_PROMPT). All existing assertions pass.

# GREEN step (after Task 2):
npm run test:run -- prompts
# Expected: all green incl. the 4 new cases + every existing prompts.test.ts assertion.

# Full suite (confirm no regression elsewhere — prompts.test.ts is the only file touched, so this is a fast sanity check):
npm run test:run
# Expected: all green. (Note: the full suite covers S1-S4 in-progress work too; focus confirmation on the prompts file.)
```

### Level 3: Integration Testing (System Validation)

```bash
# Confirm createArchitectPrompt still compiles + the architect integration test still passes (consumer is unchanged):
npm run test:run -- architect
# Expected: green — the consumer reads TASK_BREAKDOWN_PROMPT verbatim; additive text cannot break it.

# Scope-guard regression check — confirm we did NOT over-reach:
git diff --stat
# Expected: ONLY src/agents/prompts.ts + tests/unit/agents/prompts.test.ts.

git diff src/agents/prompts/architect-prompt.ts PROMPTS.md docs/WORKFLOWS.md docs/ARCHITECTURE.md docs/CONFIGURATION.md
# Expected: EMPTY (consumer + legacy source + all docs untouched).
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Content-presence check — the canonical phrases all landed inside TASK_BREAKDOWN_PROMPT:
grep -n "DOCUMENTATION SYNC (TWO MODES)\|never a standalone subtask\|DOCS:\|Mode A\|Mode B\|when in doubt\|per-file\|changeset-level" src/agents/prompts.ts
# Expected: ≥8 matches, all INSIDE the TASK_BREAKDOWN_PROMPT constant (i.e. between L37 and the closing backtick before PRP_BLUEPRINT_PROMPT).

# Locality check — the edit did NOT leak into other constants:
awk '/export const TASK_BREAKDOWN_PROMPT = `/{f=1} f&&/DOCUMENTATION SYNC/{print "in TASK_BREAKDOWN_PROMPT: OK"; exit} /^export const PRP_BLUEPRINT_PROMPT/{f=0}' src/agents/prompts.ts
# Expected: "in TASK_BREAKDOWN_PROMPT: OK" (the new section is inside the right constant).

# Mirror check — the new section explicitly references the implicit-TDD rule it mirrors:
grep -n "implicit-TDD\|mirroring" src/agents/prompts.ts
# Expected: ≥1 match in the new ### 5 section.

# No-Mode-B-docs-leak check — no external doc file was touched (the item contract: this subtask IS the doc-sync mechanism):
test -z "$(git diff --name-only docs/)" && echo "docs/ untouched: OK" || echo "FAIL: docs/ was modified"
# Expected: "docs/ untouched: OK".
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run validate` passes (eslint + prettier --check + tsc --noEmit, zero errors).
- [ ] `npm run test:run` passes (all green; the 4 new `it` cases + every existing prompts.test.ts assertion).
- [ ] RED step observed before GREEN (the 4 assertions failed before Task 2 — TDD).

### Feature Validation

- [ ] `TASK_BREAKDOWN_PROMPT` contains `### 5. DOCUMENTATION SYNC (TWO MODES)`.
- [ ] `TASK_BREAKDOWN_PROMPT` contains `Documentation is never a standalone subtask` + a phrase mirroring implicit TDD.
- [ ] Mode A present: `DOCS:` line inside `context_scope`; categories config, public API, CLI, env vars, exported types.
- [ ] Mode B present: a FINAL "Sync changeset-level documentation" task depending on all implementing subtasks; categories README, feature overviews, architecture summaries.
- [ ] Decision rule present: `per-file → Mode A; whole-feature/overview → Mode B; when in doubt, both`.
- [ ] `createArchitectPrompt` is UNCHANGED (the consumer reads the constant verbatim — verify via `git diff src/agents/prompts/architect-prompt.ts` = EMPTY).
- [ ] No external doc file touched (git diff on `docs/` = EMPTY).

### Code Quality Validation

- [ ] Backticks inside the section are `\`-escaped (no template-literal syntax error).
- [ ] The edit is LOCALIZED to the `TASK_BREAKDOWN_PROMPT` constant (no leak into other constants).
- [ ] Existing `### 1`–`### 4` headings unchanged (no renumbering).
- [ ] Existing prompts.test.ts assertions still pass (LEAD TECHNICAL ARCHITECT / PROJECT SYNTHESIZER / ```json).
- [ ] ESM import specifiers unchanged (`.js`); no new import added.
- [ ] `git diff --stat` shows ONLY the two in-scope files.

### Documentation & Deployment

- [ ] The new section is self-documenting (Mode A / Mode B / decision rule spelled out with examples).
- [ ] No new environment variables (n/a — prompt text only).
- [ ] PRD §6.1 contract faithfully implemented (Mode A `DOCS:` line / Mode B final task / "never a standalone subtask").

---

## Anti-Patterns to Avoid

- ❌ Don't paraphrase the canonical phrases the tests `.toContain`/`.toMatch` for — copy the canonical block verbatim. The test and the prompt text are coupled by design (deterministic RED→GREEN).
- ❌ Don't forget to `\`-escape the backticks inside the section (`\`context_scope\``, `\`DOCS:\``) — they live inside a template literal; an unescaped backtick terminates the constant and breaks `tsc`/lint.
- ❌ Don't renumber `### 1`–`### 4`. Adding `### 5` keeps the existing headings + the existing tests intact.
- ❌ Don't touch any other constant (`PRP_BLUEPRINT_PROMPT`, `DELTA_PRD_PROMPT`, etc.) — the sibling S2 owns the delta/blueprint doc-impact-declaration half; a localized edit avoids a future merge conflict.
- ❌ Don't edit `src/agents/prompts/architect-prompt.ts` — the consumer reads `TASK_BREAKDOWN_PROMPT` verbatim; additive text is picked up automatically with NO code change.
- ❌ Don't edit `PROMPTS.md` — it is the legacy bash source, NOT the runtime consumer (`prompts.ts` is). It is optional/out-of-scope.
- ❌ Don't add a `docs/*.md` update (e.g. WORKFLOWS.md) — the item contract is explicit: `DOCS: [Mode A] none — this subtask IS the doc-sync mechanism (the prompt text itself). No external doc file is touched.`
- ❌ Don't write the prompt edit before the failing test (breaks implicit-TDD; implementation_notes.md §7).
- ❌ Don't modify existing prompts.test.ts assertions — only ADD a new describe block.
- ❌ Don't conflate this (the Mode A/B **rule** in the Architect prompt) with S2 (the doc-impact **declaration** in the Researcher/Change-Manager prompts). Different constants, different prompts, different subtasks.

---

## Success Metrics

**Confidence Score: 9/10** — This is the simplest subtask in the R3 cluster: a localized, additive markdown edit inside ONE string constant plus a string-assertion test in ONE test file. Every reference resolves to a real file/line in the tree today; the insertion site is quoted verbatim; the canonical section text and the canonical test assertions are provided together and verified substring-by-substring to be mutually consistent (deterministic RED→GREEN). The consumer (`createArchitectPrompt`) reads the constant verbatim, so there is zero runtime-integration risk — `npm run validate` + `npm run test:run` are the only gates. The residual risk is purely mechanical: (a) backtick-escaping inside the template literal (guarded by Level 1 `tsc`/lint + the "Known Gotchas" callout), (b) paraphrasing away an asserted phrase (guarded by providing the canonical block verbatim + the content-presence grep in Level 4), and (c) scope creep into other constants or `docs/*` (guarded by the scope-guard `git diff` checks in Level 3/4 + the anti-patterns). Parallel safety is clean: S4 edits `src/core/*` + `docs/WORKFLOWS.md` (zero file overlap), and the future S2 edits a *different constant* in the same file (guarded by the locality requirement + the awk locality check). One-pass success is highly likely.
