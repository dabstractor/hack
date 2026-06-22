# PRP — P5.M1.T3.S2: Require doc-impact declaration in the delta/blueprint prompt

## Goal

**Feature Goal**: Implement PRD §6.4's "Doc Impact Declaration" requirement inside the **Change-Manager** and **Researcher** system prompts by appending:
1. an explicit, per-item doc-impact-declaration instruction to `DELTA_PRD_PROMPT` (the Change-Manager HEREDOC at `src/agents/prompts.ts` ~L696) — each affected item in a delta MUST declare its documentation impact at authoring time, either a **Mode A** `DOCS:` line (the per-item doc that item touches) or a **Mode B** changeset-level note (cross-cutting doc deferred to the final "Sync changeset-level documentation" task), per the §6.1 two-mode rule; and
2. a **lighter-weight reminder** to `PRP_BLUEPRINT_PROMPT` (the Researcher HEREDOC at `src/agents/prompts.ts` ~L157) that every PRP it generates must surface the item's declared DOCS impact.

Both edits are **pure additive text** inside existing `as const` template-literal constants — NO other constant, NO generator signature, NO runtime behavior change. The generators (`createPRPBlueprintPrompt`, and the `DELTA_PRD` lookup consumer) read the constants verbatim and therefore pick up the new text automatically.

**Deliverable**:
1. `src/agents/prompts.ts` — (a) a new `6. DOC IMPACT DECLARATION` item appended to the `## Instructions:` numbered list inside `DELTA_PRD_PROMPT`, placed after item 5 (`**OUTPUT**`) and before the closing paragraph; (b) a new `**Docs Impact**:` line appended to `### Step 3: Research Integration` inside `PRP_BLUEPRINT_PROMPT`, placed after the `**Validation Gates**` line and before `### Step 4: Information Density Standards`.
2. `tests/unit/agents/prompts/delta-analysis-prompt.test.ts` — a NEW `describe('DELTA_PRD_PROMPT doc-impact declaration (PRD §6.4)', ...)` block of **string assertions on the constant** (imports `DELTA_PRD_PROMPT` directly). Written FIRST (RED), then made GREEN by the prompt edit.
3. `tests/unit/agents/prompts/prp-blueprint-prompt.test.ts` — a NEW `describe('PRP_BLUEPRINT_PROMPT DOCS impact reminder (PRD §6.4)', ...)` block of **string assertions on `prompt.systemOverride`** (which is `PRP_BLUEPRINT_PROMPT` verbatim — no new import needed). Written FIRST (RED), then made GREEN by the prompt edit.

**Success Definition**: `npm run validate` (eslint + prettier --check + tsc --noEmit) and `npm run test:run` (vitest run) both green; the two new describe blocks pass; every existing assertion on `DELTA_PRD_PROMPT` (`delta-prd-generation.test.ts`, `delta-resume-regeneration.test.ts`, `prompts.test.ts`) and on `PRP_BLUEPRINT_PROMPT` (`prompts.test.ts`, `prp-create-prompt.test.ts`, `prp-blueprint-agent.test.ts`, `prp-blueprint-prompt.test.ts`) still passes (additive text cannot break a `.toContain`); `createPRPBlueprintPrompt(...)` is **unchanged** (it consumes `PRP_BLUEPRINT_PROMPT` verbatim via `system:`, so it picks up the new text automatically); `git diff --stat` shows ONLY the three in-scope files.

## Why

- **Business value**: PRD §6.4 turns documentation into a **rule-encoded part of delta authoring**. Without a doc-impact declaration, delta sessions ship stale READMEs: the Change-Manager omits which docs each item touches, and the Researcher's PRP silently drops the doc requirement. Forcing a Mode A `DOCS:` line (or a Mode B deferral note) at authoring time guarantees every delta item carries its doc obligation forward into the PRP, so docs ship with the change instead of rotting.
- **Scope boundary**: This subtask owns the **doc-impact declaration half of R3**. The sibling S1 (`P5.M1.T3.S1`, in-flight) owns the **two-mode rule text** in `TASK_BREAKDOWN_PROMPT`. This subtask owns the **declaration requirement** in the *downstream* prompts that consume that rule (`DELTA_PRD_PROMPT` Change-Manager + `PRP_BLUEPRINT_PROMPT` Researcher). Together S1 + S2 close R3. This subtask does NOT touch `TASK_BREAKDOWN_PROMPT`, `DELTA_ANALYSIS_PROMPT`, `PRP_BUILDER_PROMPT`, `BUG_HUNT_PROMPT`, or any generator signature.
- **Scope cohesion (parallel S1 + S4)**: Runs in parallel with S1 (which edits a *different constant* `TASK_BREAKDOWN_PROMPT` L33–146 + `tests/unit/agents/prompts.test.ts`) and with S4 (`src/core/*` + `docs/WORKFLOWS.md`). This subtask edits `DELTA_PRD_PROMPT` (L696) + `PRP_BLUEPRINT_PROMPT` (L157) in the same `src/agents/prompts.ts` file plus two test files under `tests/unit/agents/prompts/`. Keeping each edit **localized to its own constant region** (and its own test file) makes a future merge conflict impossible — the three edits touch non-overlapping line ranges.
- **Why string-constant edits (not runtime code)**: The doc-impact declaration is a **prompt directive** the LLM obeys at delta-authoring / PRP-generation time — there is no runtime function to add. The mechanism IS the prompt text. That is why `DOCS: [Mode A] none — this subtask IS the doc-declaration mechanism` (per the item contract): no external doc file is touched.

## What

### User-visible behavior

None directly — both constants are system prompts. The observable downstream effects are: (a) delta PRDs authored by the Change-Manager will carry a per-item doc-impact declaration (Mode A `DOCS:` line or Mode B deferral note); (b) PRPs generated by the Researcher will surface the item's declared DOCS impact so the Coder keeps docs in sync.

### Technical requirements (the CONTRACT)

1. **Edits are additive and localized.** Add exactly TWO new text blocks:
   - **(a)** `DELTA_PRD_PROMPT`: a new numbered item `6. DOC IMPACT DECLARATION` inside the `## Instructions:` list, placed **after** item `5. **OUTPUT**: Write the delta PRD to \`$SESSION_DIR/delta_prd.md\`` and **before** the closing paragraph `The delta PRD should be self-contained but reference the previous session's work.` Do NOT touch the `$(cat ...)` shell-interpolation lines, items 1–5, the closing paragraph, `as const`, the JSDoc above the constant, or any other constant.
   - **(b)** `PRP_BLUEPRINT_PROMPT`: a new `**Docs Impact**:` line at the end of `### Step 3: Research Integration`, placed **after** the `**Validation Gates**:` line and **before** `### Step 4: Information Density Standards`. Do NOT touch `<item_title>`/`<item_description>` placeholders, the `<PRP-README>`/`<PRP-TEMPLATE>` blocks, the other Steps, `as const`, the JSDoc, or any other constant.
2. **Canonical text (use this exact wording — the test assertions are derived from its substrings).** See "Implementation Blueprint → Data models and structure" for the two verbatim blocks. The `DELTA_PRD_PROMPT` block must contain (at minimum): `DOC IMPACT DECLARATION`, `declare its documentation impact`, `Mode A`, `DOCS:`, `Mode B`, `changeset-level`, `Sync changeset-level documentation`, `§6.1` / `two-mode rule`. The `PRP_BLUEPRINT_PROMPT` block must contain: `Docs Impact`, `DOCS impact`, `Mode A`, `DOCS:`, `Mode B`, `changeset-level`.
3. **No signature / no runtime change.** `createPRPBlueprintPrompt(task, backlog, codebasePath?, issueFeedback?)` in `src/agents/prompts/prp-blueprint-prompt.ts` is UNCHANGED — it sets `system: PRP_BLUEPRINT_PROMPT` (L284) verbatim, so additive text flows through untouched. Do NOT edit any generator.
4. **TDD (RED before GREEN — implementation_notes.md §7).** Write the failing assertion `describe` blocks in BOTH test files FIRST; confirm they fail (`npm run test:run -- delta-analysis-prompt prp-blueprint-prompt`); THEN insert the two prompt blocks; then confirm GREEN.
5. **No external doc file (Mode A docs = none).** Do NOT edit `docs/WORKFLOWS.md`, `docs/ARCHITECTURE.md`, `docs/CONFIGURATION.md`, `README.md`, or any `docs/*` file. The item contract is explicit: this subtask IS the doc-declaration mechanism (the prompt text itself).
6. **Prettier compliance.** `npm run format:check` covers `**/*.{ts,js,json,md,yml,yaml}`, including `src/agents/prompts.ts`. prettier does NOT reformat inside template literals (they are strings), but run `npm run format` (writes) then `npm run validate` to be safe.
7. **Backtick escaping.** Backticks inside both blocks (`\`DOCS:\``, `\`$SESSION_DIR/...\``, `\`DOCS: update docs/CONFIGURATION.md ...\``) MUST be `\`-escaped because they live inside template literals. Match the escaping the existing constants already use.

### Success Criteria

- [ ] `DELTA_PRD_PROMPT` contains a new `6. DOC IMPACT DECLARATION` instruction.
- [ ] `DELTA_PRD_PROMPT` requires each affected delta item to declare its doc impact (Mode A `DOCS:` line or Mode B changeset-level note), referencing the §6.1 two-mode rule.
- [ ] `PRP_BLUEPRINT_PROMPT` contains a `**Docs Impact**:` reminder in Step 3 that references the DOCS impact.
- [ ] The two new describe blocks pass; every existing prompt assertion still passes (additive-safe).
- [ ] RED step observed before GREEN in BOTH test files (failing tests written before the prompt edits — TDD).
- [ ] `npm run validate` passes (zero errors: eslint + prettier --check + tsc --noEmit).
- [ ] `npm run test:run` passes (all green).
- [ ] `git diff --stat` shows ONLY `src/agents/prompts.ts` + the two test files.

## All Needed Context

### Context Completeness Check

_Pass_: An agent with zero codebase knowledge can implement this from (a) the two exact insertion sites quoted verbatim below (anchored on item 5 + closing paragraph for DELTA_PRD_PROMPT; on the `**Validation Gates**` + `### Step 4` lines for PRP_BLUEPRINT_PROMPT), (b) the two canonical text blocks to insert (verbatim in "Data models and structure"), (c) the exact test assertions (verbatim in Tasks 1 & 2), and (d) the verified validation commands. Every reference resolves to a real file/line in the tree today. No inference required — it is two localized string edits + two string-assertion test blocks.

### Documentation & References

```yaml
# MUST READ — the PRIMARY file edited (both prompt constants live here)
- file: src/agents/prompts.ts
  why: |
    Contains BOTH target `as const` template-literal constants:
      - DELTA_PRD_PROMPT starts ~L696 (`export const DELTA_PRD_PROMPT = \``). Insertion site A = the `## Instructions:` numbered list,
        specifically the line `5. **OUTPUT**: Write the delta PRD to \`$SESSION_DIR/delta_prd.md\`` immediately followed by a blank line
        and the closing paragraph `The delta PRD should be self-contained but reference the previous session's work.`
      - PRP_BLUEPRINT_PROMPT starts ~L157 (`export const PRP_BLUEPRINT_PROMPT = \``). Insertion site B = `### Step 3: Research Integration`,
        specifically the `**Validation Gates**:` line immediately followed by a blank line and `### Step 4: Information Density Standards`.
  pattern: |
    # CURRENT DELTA_PRD_PROMPT tail (EXACT — anchor the edit here; the new item 6 goes between item 5 and the closing paragraph):
    5. **OUTPUT**: Write the delta PRD to \`$SESSION_DIR/delta_prd.md\`

    The delta PRD should be self-contained but reference the previous session's work.
    It will be used as input to the task breakdown process for this delta session.

    # CURRENT PRP_BLUEPRINT_PROMPT Step 3 tail (EXACT — anchor the edit here; the new **Docs Impact** line goes after Validation Gates):
    **Validation Gates**: Use project-specific validation commands that you've verified work in this codebase

    ### Step 4: Information Density Standards
  gotcha: |
    - Both edits are PURELY additive text INSIDE the template literals. Do NOT touch `as const`, the JSDoc comments above either constant,
      the `$(cat ...)` shell-interpolation lines in DELTA_PRD_PROMPT, the <item_title>/<item_description>/<PRP-README>/<PRP-TEMPLATE>
      placeholders in PRP_BLUEPRINT_PROMPT, or any OTHER constant (TASK_BREAKDOWN_PROMPT, PRP_BUILDER_PROMPT, DELTA_ANALYSIS_PROMPT,
      BUG_HUNT_PROMPT, PROMPTS).
    - prettier does NOT rewrite the inside of a template literal; run `npm run format` then `npm run validate` regardless.
    - Backticks inside the new blocks MUST be `\`-escaped (they live inside template literals). Match the escaping the existing constants use.

# MUST READ — the consumer (UNCHANGED — read-only confirmation)
- file: src/agents/prompts/prp-blueprint-prompt.ts
  why: |
    createPRPBlueprintPrompt(...) sets `system: PRP_BLUEPRINT_PROMPT` (L284) VERBATIM. Additive text is picked up AUTOMATICALLY with NO
    code change. The returned Prompt exposes it as `systemOverride` (Groundswell field name) — that is what the blueprint test asserts on.
    Confirm this is a read-only reference (do not edit it).
  section: createPRPBlueprintPrompt() return value (`system: PRP_BLUEPRINT_PROMPT`)

# MUST READ — the FIRST test file to extend (assertion site A)
- file: tests/unit/agents/prompts/delta-analysis-prompt.test.ts
  why: |
    Currently imports `createDeltaAnalysisPrompt` from `../../../../src/agents/prompts/delta-analysis-prompt.js` (4-level relative path —
    proven runtime-correct). NAMING ASYMMETRY (intentional per the item contract): this file tests `createDeltaAnalysisPrompt` (which uses
    DELTA_ANALYSIS_PROMPT) but the item contract requires it to ALSO assert on the DELTA_PRD_PROMPT constant. Therefore ADD a value import
    `import { DELTA_PRD_PROMPT } from '../../../../src/agents/prompts.js';` (same 4-level pattern) and a NEW sibling describe block at the
    END of the file asserting on the constant DIRECTLY (the generator does NOT expose DELTA_PRD_PROMPT).
  pattern: |
    # EXISTING idiom (the file's import + a describe/it using .toContain/.toMatch):
    import { describe, expect, it } from 'vitest';
    import { createDeltaAnalysisPrompt } from '../../../../src/agents/prompts/delta-analysis-prompt.js';
    ...
    describe('system prompt validation', () => {
      it('should include change categories', () => {
        const prompt = createDeltaAnalysisPrompt(mockOldPRD, mockNewPRD);
        expect(prompt.systemOverride).toContain('Semantic Changes');
      });
    });
  gotcha: |
    - Use the 4-level relative path `../../../../src/agents/prompts.js` for the DELTA_PRD_PROMPT value import (matches the file's existing
      import depth). Do NOT use the `#/` alias (it maps to src/agents, which collides confusingly with the prompts/ subdir).
    - Vitest globals are enabled, but the file already uses explicit `import { describe, expect, it } from 'vitest';` — match that (no new vitest import).
    - Do NOT modify any existing assertion.

# MUST READ — the SECOND test file to extend (assertion site B)
- file: tests/unit/agents/prompts/prp-blueprint-prompt.test.ts
  why: |
    Already imports `createPRPBlueprintPrompt` from `#/prompts/index.js` and has a `mockBacklog` fixture. The generator returns
    `systemOverride === PRP_BLUEPRINT_PROMPT` (verbatim, L284). Therefore the DOCS-impact assertions can assert on
    `prompt.systemOverride` via the EXISTING `createPRPBlueprintPrompt(task, mockBacklog)` call — ZERO new imports needed (path-safe,
    reuses the established pattern). Add a NEW sibling describe block at the END of the outer `describe('agents/prompts/prp-blueprint-prompt', ...)`.
  pattern: |
    # EXISTING idiom (call the generator, assert on systemOverride):
    const task = mockBacklog.backlog[0].milestones[0].tasks[0].subtasks[1];
    const prompt = createPRPBlueprintPrompt(task, mockBacklog);
    expect(prompt.systemOverride).toContain('Create PRP for Work Item');
  gotcha: |
    - Do NOT add a relative import for PRP_BLUEPRINT_PROMPT — asserting on `prompt.systemOverride` is asserting on the constant verbatim and
      avoids any import-path fragility (test files are NOT typechecked by `npm run typecheck` because tsconfig.build.json excludes `tests`).
    - Do NOT modify any existing assertion.

# REFERENCE — PRD source of truth for the doc-impact-declaration requirement
- file: PRD.md
  why: §6.4 "Delta PRD Generation Prompt → Doc Impact Declaration" is the authoritative contract: "Each affected item in the delta must declare its documentation impact at authoring time (a Mode A `DOCS:` line or a Mode B changeset-level note, per §6.1)". §6.1 defines the Mode A / Mode B rule that the declaration references.
  section: "§6.4 Delta PRD Generation Prompt" (+ §6.1 two-mode rule)

# REFERENCE — feature cluster + R3 boundary
- file: plan/005_d32a2ecf61cd/architecture/delta_impact.md
  why: R3 confirms this subtask = ADD the doc-impact-declaration requirement to `PRP_BLUEPRINT_PROMPT` / `DELTA_PRD_PROMPT`. Confirms S1 (sibling, different prompt TASK_BREAKDOWN_PROMPT) owns the two-mode rule text half. Confirms "this requirement IS the doc-sync mechanism — no standalone runtime file".
  section: "R3 — Documentation two-mode sync rule (PRD §6.1, §6.4) — PROMPT change"

# REFERENCE — discipline rules (TDD ordering, validation gates, file boundaries)
- file: plan/005_d32a2ecf61cd/architecture/implementation_notes.md
  why: §7 (same-commit TDD — failing test first), §9 (two-mode doc-sync — every subtask declares its DOCS line), §10 (validation gates: npm run validate + npm run test:run).
  section: "§7, §9, §10"

# REFERENCE — the in-flight sibling PRP (do not duplicate / do not conflict)
- file: plan/005_d32a2ecf61cd/P5M1T3S1/PRP.md
  why: S1 adds the two-mode rule TEXT to TASK_BREAKDOWN_PROMPT (L33–146) + tests/unit/agents/prompts.test.ts. THIS subtask (S2) consumes that rule downstream by requiring each delta item/PRP to DECLARE its doc impact. Different constant, different test file — zero overlap by design.
```

### Current Codebase tree (relevant slice)

```bash
src/agents/
├── prompts.ts                                  # <-- EDIT: +item 6 in DELTA_PRD_PROMPT (~L696); +**Docs Impact** line in PRP_BLUEPRINT_PROMPT (~L157)
└── prompts/
    ├── prp-blueprint-prompt.ts                 # <-- DO NOT TOUCH (consumer; system: PRP_BLUEPRINT_PROMPT verbatim)
    └── delta-analysis-prompt.ts                # <-- DO NOT TOUCH (uses DELTA_ANALYSIS_PROMPT, a different constant)

tests/unit/agents/prompts/
├── delta-analysis-prompt.test.ts               # <-- EDIT: +import DELTA_PRD_PROMPT, +describe('DELTA_PRD_PROMPT doc-impact declaration ...')
└── prp-blueprint-prompt.test.ts                # <-- EDIT: +describe('PRP_BLUEPRINT_PROMPT DOCS impact reminder ...') (asserts on systemOverride)

# Out of scope (do NOT touch):
tests/unit/agents/prompts.test.ts               # S1 territory (asserts on TASK_BREAKDOWN_PROMPT)
tests/integration/delta-prd-generation.test.ts  # consumes DELTA_PRD_PROMPT via .toContain — additive-safe, NOT modified
tests/integration/delta-resume-regeneration.test.ts  # same — NOT modified
tests/integration/prp-create-prompt.test.ts     # consumes PRP_BLUEPRINT_PROMPT via .toContain — additive-safe, NOT modified
PROMPTS.md                                      # legacy bash source; NOT the runtime consumer
docs/*.md                                       # NO Mode A doc file (this subtask IS the declaration mechanism)
```

### Desired Codebase tree with files to be modified

```bash
src/agents/
└── prompts.ts                                  # MODIFIED: +item 6 (DELTA_PRD_PROMPT) +**Docs Impact** line (PRP_BLUEPRINT_PROMPT) — additive

tests/unit/agents/prompts/
├── delta-analysis-prompt.test.ts               # MODIFIED: +DELTA_PRD_PROMPT import + doc-impact describe block
└── prp-blueprint-prompt.test.ts                # MODIFIED: +DOCS-impact reminder describe block (no new import)
```

> **File-placement decision**: All edits land in existing files — no new modules, no new types, no new exports. The new text is inline inside the two existing constants; the new assertions are new sibling `describe` blocks inside the two existing test files.

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL: Both edits are PURELY additive text INSIDE the two template literals.
//   Do NOT touch: `as const`, the JSDoc above either constant, the $(cat ...) lines in DELTA_PRD_PROMPT,
//   the <item_title>/<item_description>/<PRP-README>/<PRP-TEMPLATE> placeholders in PRP_BLUEPRINT_PROMPT,
//   or ANY other constant (TASK_BREAKDOWN_PROMPT=owned by S1, PRP_BUILDER_PROMPT, DELTA_ANALYSIS_PROMPT, BUG_HUNT_PROMPT, PROMPTS).

// CRITICAL: Keep edits LOCALIZED to their own constant region.
//   S1 (in-flight) edits TASK_BREAKDOWN_PROMPT (L33–146); this subtask edits DELTA_PRD_PROMPT (~L696) + PRP_BLUEPRINT_PROMPT (~L157).
//   Non-overlapping line ranges → no merge conflict. Do NOT reformat the rest of the file.

// CRITICAL: The test assertions and the canonical text blocks MUST be consistent. The two canonical blocks in
//   "Data models and structure" contain every substring the assertions check for (verified one-by-one). Copy them
//   verbatim; do NOT paraphrase away DOCS:, Mode A, Mode B, changeset-level, §6.1, etc.

// CRITICAL: Existing assertions on both constants must STILL pass (all are .toContain → additive-safe):
//   - DELTA_PRD_PROMPT: delta-prd-generation.test.ts, delta-resume-regeneration.test.ts, prompts.test.ts
//     (assert e.g. 'Generate Delta PRD from Changes', 'SCOPE DELTA', '$(cat "$PRD_FILE")', '$SESSION_DIR/delta_prd.md', '**OUTPUT**')
//   - PRP_BLUEPRINT_PROMPT: prompts.test.ts, prp-create-prompt.test.ts, prp-blueprint-agent.test.ts, prp-blueprint-prompt.test.ts
//     (assert e.g. 'Create PRP for Work Item', 'Step 3: Research Integration', '<item_title>')
//   None of these substrings are touched → they stay green automatically.

// GOTCHA: tsconfig.build.json EXCLUDES tests ("exclude": ["node_modules","dist","tests"]). So `npm run typecheck`
//   (tsc --noEmit -p tsconfig.build.json) does NOT typecheck test files. Test import paths need only be RUNTIME-correct
//   (vitest resolves them). delta-analysis-prompt.test.ts uses the proven 4-level `../../../../src/agents/...` path — match it.
//   prp-blueprint-prompt.test.ts asserts on `prompt.systemOverride` (=== PRP_BLUEPRINT_PROMPT verbatim) → no new import needed at all.

// GOTCHA: prettier --check covers src/agents/prompts.ts. prettier does NOT rewrite inside a template literal, but run
//   `npm run format` then `npm run validate` to be safe.

// GOTCHA: vitest.config.ts sets coverage thresholds to 100% — but coverage is enforced ONLY by `npm run test:coverage`,
//   NOT by `npm run test:run` or `npm run validate`. Editing string constants does not change coverage. → Safe.

// GOTCHA: ESM import specifiers use `.js` in `.ts` files. The new DELTA_PRD_PROMPT import in delta-analysis-prompt.test.ts
//   must end in `.js` (i.e. `'../../../../src/agents/prompts.js'`), matching the file's existing import style.

// GOTCHA: PRD §6.4 wording uses "Mode A `DOCS:` line" and "Mode B changeset-level note". Reuse those EXACT phrases
//   (plus "Sync changeset-level documentation" for the Mode B final task) so downstream output matches expectations.
```

## Implementation Blueprint

### Data models and structure

No data models. This subtask is TWO markdown text blocks (strings) + TWO test describe blocks. Below are the **canonical text blocks to insert VERBATIM** — each contains every substring its assertions check for (verified one-by-one):

```typescript
// === CANONICAL BLOCK A — insert VERBATIM into DELTA_PRD_PROMPT, as a new numbered item 6
//     AFTER `5. **OUTPUT**: Write the delta PRD to \`$SESSION_DIR/delta_prd.md\``
//     and BEFORE the closing paragraph `The delta PRD should be self-contained...`:

6. **DOC IMPACT DECLARATION**: Each affected item in the delta MUST declare its documentation impact at authoring time — either a **Mode A** \`DOCS:\` line naming the per-item doc that item touches (e.g. \`DOCS: update docs/CONFIGURATION.md FEATURE_TIMEOUT row\`) OR a **Mode B** changeset-level note deferring cross-cutting docs (README, architecture overviews) to the final "Sync changeset-level documentation" task, per the §6.1 two-mode rule. No affected item ships without a doc-impact declaration.

// === END CANONICAL BLOCK A ===


// === CANONICAL BLOCK B — insert VERBATIM into PRP_BLUEPRINT_PROMPT, as a new **Docs Impact**: line
//     at the END of `### Step 3: Research Integration`,
//     AFTER the `**Validation Gates**:` line and BEFORE the blank line + `### Step 4: Information Density Standards`:

**Docs Impact**: Every PRP must surface the item's declared DOCS impact — echo the item's Mode A \`DOCS:\` line (the per-item doc it touches) or, if the item defers to Mode B, note the changeset-level doc synced in the final task. Never let a PRP silently drop documentation.

// === END CANONICAL BLOCK B ===


// === CANONICAL TEST BLOCK A — add VERBATIM to tests/unit/agents/prompts/delta-analysis-prompt.test.ts ===
//   1) ADD a value import alongside the existing createDeltaAnalysisPrompt import:
//        import { DELTA_PRD_PROMPT } from '../../../../src/agents/prompts.js';
//   2) ADD this describe as a NEW sibling at the END of the file (after the existing 'system prompt validation' describe):

describe('DELTA_PRD_PROMPT doc-impact declaration (PRD §6.4)', () => {
  it('should require each affected delta item to declare its documentation impact', () => {
    expect(DELTA_PRD_PROMPT).toMatch(/doc.?impact declaration/i);
    expect(DELTA_PRD_PROMPT).toMatch(/declare its documentation impact/i);
  });

  it('should specify Mode A via a DOCS: line (per-item doc)', () => {
    expect(DELTA_PRD_PROMPT).toMatch(/Mode A/i);
    expect(DELTA_PRD_PROMPT).toContain('DOCS:');
  });

  it('should specify Mode B as a changeset-level note', () => {
    expect(DELTA_PRD_PROMPT).toMatch(/Mode B/i);
    expect(DELTA_PRD_PROMPT).toMatch(/changeset-level|changeset level/i);
  });

  it('should reference the §6.1 two-mode rule', () => {
    expect(DELTA_PRD_PROMPT).toMatch(/§6.1|two-mode/i);
  });
});
// === END CANONICAL TEST BLOCK A ===


// === CANONICAL TEST BLOCK B — add VERBATIM to tests/unit/agents/prompts/prp-blueprint-prompt.test.ts ===
//   NO new import needed — assert on prompt.systemOverride (=== PRP_BLUEPRINT_PROMPT verbatim) via the existing fixture.
//   ADD this describe as a NEW sibling at the END of the outer describe('agents/prompts/prp-blueprint-prompt', ...):

describe('PRP_BLUEPRINT_PROMPT DOCS impact reminder (PRD §6.4)', () => {
  it('should reference the DOCS impact', () => {
    const task = mockBacklog.backlog[0].milestones[0].tasks[0].subtasks[1];
    const prompt = createPRPBlueprintPrompt(task, mockBacklog);
    expect(prompt.systemOverride).toMatch(/DOCS impact/i);
  });

  it('should reference Mode A (DOCS: line) and Mode B (changeset-level)', () => {
    const task = mockBacklog.backlog[0].milestones[0].tasks[0].subtasks[1];
    const prompt = createPRPBlueprintPrompt(task, mockBacklog);
    expect(prompt.systemOverride).toMatch(/Mode A/i);
    expect(prompt.systemOverride).toContain('DOCS:');
    expect(prompt.systemOverride).toMatch(/Mode B/i);
    expect(prompt.systemOverride).toMatch(/changeset-level|changeset level/i);
  });
});
// === END CANONICAL TEST BLOCK B ===
```

### Implementation Tasks (ordered by dependencies — strict TDD: RED first)

```yaml
Task 1: WRITE the failing tests (RED — before Task 2)
  Step 1a — tests/unit/agents/prompts/delta-analysis-prompt.test.ts:
    - ADD the value import: `import { DELTA_PRD_PROMPT } from '../../../../src/agents/prompts.js';`
        (place it directly under the existing `import { createDeltaAnalysisPrompt } from '../../../../src/agents/prompts/delta-analysis-prompt.js';`).
    - ADD the canonical `describe('DELTA_PRD_PROMPT doc-impact declaration (PRD §6.4)', ...)` block (4 `it` cases, verbatim from
        "Data models and structure") as a NEW sibling describe at the END of the file (after the existing `describe('system prompt validation', ...)`).
    - DO NOT modify any existing assertion or import.
  Step 1b — tests/unit/agents/prompts/prp-blueprint-prompt.test.ts:
    - ADD the canonical `describe('PRP_BLUEPRINT_PROMPT DOCS impact reminder (PRD §6.4)', ...)` block (2 `it` cases, verbatim from
        "Data models and structure") as a NEW sibling describe at the END of the outer `describe('agents/prompts/prp-blueprint-prompt', ...)`.
    - NO new import — assert on `prompt.systemOverride` via the existing `createPRPBlueprintPrompt(task, mockBacklog)` fixture.
    - DO NOT modify any existing assertion.
  VERIFY RED: `npm run test:run -- delta-analysis-prompt prp-blueprint-prompt` → the 6 new `it` cases FAIL
    (the substrings are not yet in the constants). RED step confirmed.

Task 2: INSERT the canonical text blocks into src/agents/prompts.ts  (makes Task 1 GREEN)
  Step 2a — DELTA_PRD_PROMPT:
    - Locate item 5 inside `## Instructions:`: `5. **OUTPUT**: Write the delta PRD to \`$SESSION_DIR/delta_prd.md\`` immediately
        followed by a blank line and the closing paragraph `The delta PRD should be self-contained but reference the previous session's work.`
    - INSERT canonical Block A (the new `6. **DOC IMPACT DECLARATION**: ...` line) AFTER item 5 and BEFORE the closing paragraph.
        Keep one blank line above (after item 5) and one blank line below (before the closing paragraph) so markdown stays well-formed.
    - Do NOT touch the `$(cat ...)` lines, items 1–5, the closing paragraph, `as const`, the JSDoc, or any other constant.
  Step 2b — PRP_BLUEPRINT_PROMPT:
    - Locate `### Step 3: Research Integration`, specifically the `**Validation Gates**:` line immediately followed by a blank line
        and `### Step 4: Information Density Standards`.
    - INSERT canonical Block B (the new `**Docs Impact**: ...` line) AFTER the `**Validation Gates**:` line and BEFORE the blank line +
        `### Step 4`. Keep one blank line above (after Validation Gates) and one blank line below (before `### Step 4`).
    - Do NOT touch the `<item_title>`/`<item_description>`/`<PRP-README>`/`<PRP-TEMPLATE>` blocks, other Steps, `as const`, the JSDoc, or any other constant.
  GOTCHA — escaping: Use the canonical blocks' backtick escaping VERBATIM. Inside DELTA_PRD_PROMPT, `DOCS:`, `$SESSION_DIR/...`, and the
    `DOCS: update docs/CONFIGURATION.md ...` example MUST be `\`-escaped because they live inside a template literal. Same for `DOCS:` inside
    PRP_BLUEPRINT_PROMPT. An unescaped backtick terminates the constant and breaks tsc/lint.
  GOTCHA — wording: Use the EXACT canonical wording — the test assertions in Task 1 match these substrings. Do NOT paraphrase away
    `DOC IMPACT DECLARATION`, `declare its documentation impact`, `Mode A`, `DOCS:`, `Mode B`, `changeset-level`, `Sync changeset-level
    documentation`, `§6.1`, `two-mode rule`, `Docs Impact`, `DOCS impact`.
  PLACEMENT: src/agents/prompts.ts (inside DELTA_PRD_PROMPT and PRP_BLUEPRINT_PROMPT constants only).

Task 3: VERIFY (validation gates — run after Task 2)
  - RUN: `npm run validate` (lint + prettier --check + tsc --noEmit) — expect zero errors.
      If prettier --check fails on prompts.ts or a test file, run `npm run format` (writes) then `npm run validate`.
  - RUN: `npm run test:run` (vitest run) — expect all green incl. the 6 new `it` cases + every existing assertion.
  - SCOPE-VERIFY: `git diff --stat` must show ONLY `src/agents/prompts.ts` + the two test files.
      `git diff src/agents/prompts/prp-blueprint-prompt.ts src/agents/prompts/delta-analysis-prompt.ts PROMPTS.md docs/` must be EMPTY.
  - CONTENT-VERIFY: `grep -n "DOC IMPACT DECLARATION\|declare its documentation impact\|Docs Impact\|Mode A\|Mode B\|changeset-level\|§6.1\|two-mode rule" src/agents/prompts.ts`
      → matches inside the two edited constants.
```

### Implementation Patterns & Key Details

```typescript
// === PATTERN: the exact edit (oldText -> newText) for src/agents/prompts.ts — DELTA_PRD_PROMPT ===
// (Anchored on item 5 + the closing paragraph. Insert the new item 6 between them.)

// oldText (unique anchor — the tail of the Instructions list):
//   5. **OUTPUT**: Write the delta PRD to \`$SESSION_DIR/delta_prd.md\`
//
//   The delta PRD should be self-contained but reference the previous session's work.

// newText (the canonical item 6 slotted in BEFORE the closing paragraph):
//   5. **OUTPUT**: Write the delta PRD to \`$SESSION_DIR/delta_prd.md\`
//
//   6. **DOC IMPACT DECLARATION**: Each affected item in the delta MUST declare its documentation impact at authoring time — either a **Mode A** \`DOCS:\` line naming the per-item doc that item touches (e.g. \`DOCS: update docs/CONFIGURATION.md FEATURE_TIMEOUT row\`) OR a **Mode B** changeset-level note deferring cross-cutting docs (README, architecture overviews) to the final "Sync changeset-level documentation" task, per the §6.1 two-mode rule. No affected item ships without a doc-impact declaration.
//
//   The delta PRD should be self-contained but reference the previous session's work.


// === PATTERN: the exact edit (oldText -> newText) for src/agents/prompts.ts — PRP_BLUEPRINT_PROMPT ===
// (Anchored on the **Validation Gates** line + ### Step 4. Insert the new **Docs Impact** line between them.)

// oldText (unique anchor — the tail of Step 3):
//   **Validation Gates**: Use project-specific validation commands that you've verified work in this codebase
//
//   ### Step 4: Information Density Standards

// newText (the canonical **Docs Impact** line slotted in BEFORE ### Step 4):
//   **Validation Gates**: Use project-specific validation commands that you've verified work in this codebase
//   **Docs Impact**: Every PRP must surface the item's declared DOCS impact — echo the item's Mode A \`DOCS:\` line (the per-item doc it touches) or, if the item defers to Mode B, note the changeset-level doc synced in the final task. Never let a PRP silently drop documentation.
//
//   ### Step 4: Information Density Standards


// === PATTERN: the test assertions are STRING checks on the constant (NO mocking, NO network) ===
//   DELTA_PRD_PROMPT (imported directly into delta-analysis-prompt.test.ts):
//     expect(DELTA_PRD_PROMPT).toMatch(/doc.?impact declaration/i);
//     expect(DELTA_PRD_PROMPT).toContain('DOCS:');
//     expect(DELTA_PRD_PROMPT).toMatch(/Mode A/i);
//     expect(DELTA_PRD_PROMPT).toMatch(/Mode B/i);
//     expect(DELTA_PRD_PROMPT).toMatch(/changeset-level|changeset level/i);
//     expect(DELTA_PRD_PROMPT).toMatch(/§6.1|two-mode/i);
//   PRP_BLUEPRINT_PROMPT (via prompt.systemOverride in prp-blueprint-prompt.test.ts):
//     expect(prompt.systemOverride).toMatch(/DOCS impact/i);
//     expect(prompt.systemOverride).toMatch(/Mode A/i);
//     expect(prompt.systemOverride).toContain('DOCS:');
//     expect(prompt.systemOverride).toMatch(/Mode B/i);
//     expect(prompt.systemOverride).toMatch(/changeset-level|changeset level/i);
```

### Integration Points

```yaml
PROMPT CONSTANTS (the change):
  - edit: src/agents/prompts.ts DELTA_PRD_PROMPT  → +item 6 DOC IMPACT DECLARATION (additive)
  - edit: src/agents/prompts.ts PRP_BLUEPRINT_PROMPT → +**Docs Impact** line in Step 3 (additive)

TESTS (the validation):
  - edit: tests/unit/agents/prompts/delta-analysis-prompt.test.ts → +DELTA_PRD_PROMPT import + doc-impact describe block
  - edit: tests/unit/agents/prompts/prp-blueprint-prompt.test.ts  → +DOCS-impact reminder describe block (no new import)

NOT TOUCHED (scope guardrails):
  - src/agents/prompts/prp-blueprint-prompt.ts     # consumer; system: PRP_BLUEPRINT_PROMPT verbatim (no change needed)
  - src/agents/prompts/delta-analysis-prompt.ts     # uses DELTA_ANALYSIS_PROMPT (different constant); not this subtask's target
  - src/agents/prompts.ts other constants           # TASK_BREAKDOWN_PROMPT (S1 owns), PRP_BUILDER_PROMPT, DELTA_ANALYSIS_PROMPT, BUG_HUNT_PROMPT, PROMPTS
  - tests/unit/agents/prompts.test.ts               # S1 territory
  - PROMPTS.md                                      # legacy bash source; NOT the runtime consumer
  - docs/*.md                                       # NO Mode A doc file (this subtask IS the declaration mechanism)
  - src/core/* (S4 territory)                       # parallel subtask; zero overlap

CONSUMES:
  - PRD §6.4 "Doc Impact Declaration" (authoritative contract: Mode A DOCS: line or Mode B changeset-level note, per §6.1)
  - PRD §6.1 two-mode rule (the rule the declaration references — made explicit in TASK_BREAKDOWN_PROMPT by sibling S1)
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# After Task 2 (prompt edits) + Task 1 (test edits):
npm run validate
# = npm run lint && npm run format:check && npm run typecheck
#   lint      = eslint . --ext .ts
#   format:check = prettier --check "**/*.{ts,js,json,md,yml,yaml}"
#   typecheck = tsc --noEmit -p tsconfig.build.json   (NOTE: excludes tests/ — only src/ is typechecked)
# Expected: zero errors. Two additive string-constant edits + two additive test blocks are type-neutral; lint should pass.
# If prettier --check fails, run:
npm run format        # WRITES the prettier-compliant form
npm run validate      # re-check; expect zero errors.
# Common failure: stray unescaped backtick inside a template literal (the `DOCS:` / `$SESSION_DIR/...` / `DOCS: update ...` must be \`-escaped).
```

### Level 2: Unit Tests (Component Validation)

```bash
# RED step (after Task 1, before Task 2) — MUST fail first (TDD):
npm run test:run -- delta-analysis-prompt prp-blueprint-prompt
# Expected: the 6 new `it` cases FAIL (the substrings are not yet in the constants). All existing assertions pass.

# GREEN step (after Task 2):
npm run test:run -- delta-analysis-prompt prp-blueprint-prompt
# Expected: all green incl. the 6 new cases + every existing assertion in both files.

# Full suite (confirm no regression elsewhere — confirm the integration tests that consume both constants stay green):
npm run test:run -- delta-prd-generation delta-resume-regeneration prp-create-prompt prp-blueprint-agent prompts
# Expected: all green. Every assertion here is .toContain on pre-existing substrings → additive text cannot break them.
```

### Level 3: Integration Testing (System Validation)

```bash
# Confirm the generator consumer still compiles + its tests pass (consumer is unchanged):
npm run test:run -- prp-blueprint-prompt prp-blueprint-agent
# Expected: green — createPRPBlueprintPrompt reads PRP_BLUEPRINT_PROMPT verbatim; additive text cannot break it.

# Confirm the DELTA_PRD_PROMPT consumers still pass (additive text cannot break .toContain):
npm run test:run -- delta-prd-generation delta-resume-regeneration
# Expected: green.

# Scope-guard regression check — confirm we did NOT over-reach:
git diff --stat
# Expected: ONLY src/agents/prompts.ts + tests/unit/agents/prompts/delta-analysis-prompt.test.ts + tests/unit/agents/prompts/prp-blueprint-prompt.test.ts.

git diff src/agents/prompts/prp-blueprint-prompt.ts src/agents/prompts/delta-analysis-prompt.ts PROMPTS.md tests/unit/agents/prompts.test.ts docs/
# Expected: EMPTY (consumers + legacy source + sibling test file + all docs untouched).
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Content-presence check — the canonical phrases all landed inside the RIGHT constants:
grep -n "DOC IMPACT DECLARATION\|declare its documentation impact\|Docs Impact\|DOCS impact\|Mode A\|Mode B\|changeset-level\|§6.1\|two-mode rule" src/agents/prompts.ts
# Expected: ≥9 matches. The DELTA_PRD_PROMPT phrases (DOC IMPACT DECLARATION, declare its documentation impact, §6.1, two-mode rule)
# must appear BETWEEN L696 and L734; the PRP_BLUEPRINT_PROMPT phrases (Docs Impact, DOCS impact) BETWEEN L157 and L603.

# Locality check — the DELTA_PRD_PROMPT edit did NOT leak into other constants:
awk '/export const DELTA_PRD_PROMPT = `/{f=1} f&&/DOC IMPACT DECLARATION/{print "in DELTA_PRD_PROMPT: OK"; exit} /^export const (PRP_BUILDER_PROMPT|DELTA_ANALYSIS_PROMPT|BUG_HUNT_PROMPT)/{f=0}' src/agents/prompts.ts
# Expected: "in DELTA_PRD_PROMPT: OK".

# Locality check — the PRP_BLUEPRINT_PROMPT edit did NOT leak into other constants:
awk '/export const PRP_BLUEPRINT_PROMPT = `/{f=1} f&&/Docs Impact/{print "in PRP_BLUEPRINT_PROMPT: OK"; exit} /^export const (TASK_BREAKDOWN_PROMPT|PRP_BUILDER_PROMPT|DELTA_PRD_PROMPT)/{if(f){f=0}}' src/agents/prompts.ts
# Expected: "in PRP_BLUEPRINT_PROMPT: OK".

# No-docs-leak check — no external doc file was touched (the item contract: this subtask IS the declaration mechanism):
test -z "$(git diff --name-only docs/)" && echo "docs/ untouched: OK" || echo "FAIL: docs/ was modified"
# Expected: "docs/ untouched: OK".
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run validate` passes (eslint + prettier --check + tsc --noEmit, zero errors).
- [ ] `npm run test:run` passes (all green; the 6 new `it` cases + every existing assertion in both test files + the integration consumers).
- [ ] RED step observed before GREEN (the 6 assertions failed before Task 2 — TDD).

### Feature Validation

- [ ] `DELTA_PRD_PROMPT` contains a new `6. DOC IMPACT DECLARATION` instruction requiring each affected delta item to declare its doc impact.
- [ ] `DELTA_PRD_PROMPT` specifies **Mode A** (`DOCS:` line, per-item doc) and **Mode B** (changeset-level note), referencing the §6.1 two-mode rule.
- [ ] `PRP_BLUEPRINT_PROMPT` contains a `**Docs Impact**:` reminder (Step 3) that surfaces the item's declared DOCS impact.
- [ ] `createPRPBlueprintPrompt(...)` is UNCHANGED (verify `git diff src/agents/prompts/prp-blueprint-prompt.ts` = EMPTY).
- [ ] No external doc file touched (git diff on `docs/` = EMPTY).

### Code Quality Validation

- [ ] Backticks inside both blocks are `\`-escaped (no template-literal syntax error).
- [ ] The DELTA_PRD_PROMPT edit is LOCALIZED to that constant (no leak into DELTA_ANALYSIS_PROMPT or others).
- [ ] The PRP_BLUEPRINT_PROMPT edit is LOCALIZED to that constant (no leak into TASK_BREAKDOWN_PROMPT or others).
- [ ] Existing assertions on both constants still pass (all `.toContain` → additive-safe).
- [ ] ESM import specifiers use `.js`; the new DELTA_PRD_PROMPT import uses the proven 4-level `../../../../src/agents/prompts.js` path.
- [ ] `git diff --stat` shows ONLY the three in-scope files.

### Documentation & Deployment

- [ ] The new text is self-documenting (Mode A / Mode B / decision framing spelled out with an example).
- [ ] No new environment variables (n/a — prompt text only).
- [ ] PRD §6.4 contract faithfully implemented (per-item doc-impact declaration at authoring time; PRP surfaces the declared DOCS impact).

---

## Anti-Patterns to Avoid

- ❌ Don't paraphrase the canonical phrases the tests `.toContain`/`.toMatch` for — copy the two canonical blocks verbatim. The tests and the prompt text are coupled by design (deterministic RED→GREEN).
- ❌ Don't forget to `\`-escape the backticks inside the blocks (`\`DOCS:\``, `\`$SESSION_DIR/delta_prd.md\``, `\`DOCS: update docs/CONFIGURATION.md ...\``) — they live inside template literals; an unescaped backtick terminates the constant and breaks `tsc`/lint.
- ❌ Don't touch any other constant — S1 owns `TASK_BREAKDOWN_PROMPT`; `PRP_BUILDER_PROMPT`, `DELTA_ANALYSIS_PROMPT`, `BUG_HUNT_PROMPT`, `PROMPTS` are out of scope. Localized edits avoid a merge conflict with the in-flight S1.
- ❌ Don't edit `src/agents/prompts/prp-blueprint-prompt.ts` or `delta-analysis-prompt.ts` — the generators read their constants verbatim; additive text is picked up automatically with NO code change.
- ❌ Don't edit `DELTA_ANALYSIS_PROMPT` instead of `DELTA_PRD_PROMPT`. The item contract names `DELTA_PRD_PROMPT` (~L696, the "Generate Delta PRD from Changes" Change-Manager HEREDOC). `DELTA_ANALYSIS_PROMPT` is a different constant ("Requirements Change Analyst") — leave it alone.
- ❌ Don't conflate the two test files' assertion targets: `delta-analysis-prompt.test.ts` asserts on the `DELTA_PRD_PROMPT` **constant** (direct import); `prp-blueprint-prompt.test.ts` asserts on `prompt.systemOverride` (=== `PRP_BLUEPRINT_PROMPT` verbatim, no new import). This naming asymmetry is intentional per the item contract.
- ❌ Don't add a relative import for `PRP_BLUEPRINT_PROMPT` in the blueprint test — `prompt.systemOverride` is the constant verbatim; adding an import is unnecessary and risks a path typo (test files are NOT typechecked by `npm run typecheck`).
- ❌ Don't edit `PROMPTS.md` — it is the legacy bash source, NOT the runtime consumer (`prompts.ts` is). It is out of scope.
- ❌ Don't add a `docs/*.md` update — the item contract is explicit: `DOCS: [Mode A] none — this subtask IS the doc-declaration mechanism`. No external doc file is touched.
- ❌ Don't write the prompt edits before the failing tests (breaks implicit-TDD; implementation_notes.md §7).
- ❌ Don't modify existing assertions in either test file — only ADD new sibling describe blocks.

---

## Success Metrics

**Confidence Score: 9/10** — This is a small, well-bounded subtask in the R3 cluster: two localized additive markdown edits inside two string constants (`DELTA_PRD_PROMPT` item 6, `PRP_BLUEPRINT_PROMPT` Step 3 Docs Impact line) plus two string-assertion describe blocks in two existing test files. Every reference resolves to a real file/line in the tree today; both insertion sites are quoted verbatim (anchored on item 5 + closing paragraph for DELTA_PRD_PROMPT; on the `**Validation Gates**` + `### Step 4` lines for PRP_BLUEPRINT_PROMPT); the two canonical text blocks and their two canonical test blocks are provided together and verified substring-by-substring to be mutually consistent (deterministic RED→GREEN). Both consumer generators read their constants verbatim (`createPRPBlueprintPrompt` sets `system: PRP_BLUEPRINT_PROMPT` at L284; the DELTA_PRD lookup is direct), so there is zero runtime-integration risk — and every existing assertion on both constants is a `.toContain` on a pre-existing substring, so additive text cannot regress them. `npm run validate` + `npm run test:run` are the only gates. Residual risk is purely mechanical: (a) backtick-escaping inside the template literals (guarded by Level 1 `tsc`/lint + the "Known Gotchas" callout), (b) paraphrasing away an asserted phrase (guarded by providing both canonical blocks verbatim + the content-presence grep in Level 4), and (c) scope creep into other constants, generators, or `docs/*` (guarded by the scope-guard `git diff` checks in Level 3/4 + the anti-patterns). Parallel safety is clean: S1 edits `TASK_BREAKDOWN_PROMPT` (L33–146) + `tests/unit/agents/prompts.test.ts`; S4 edits `src/core/*` + `docs/WORKFLOWS.md`; this subtask edits `DELTA_PRD_PROMPT` (L696) + `PRP_BLUEPRINT_PROMPT` (L157) + two files under `tests/unit/agents/prompts/` — non-overlapping line ranges and disjoint test files throughout. One-pass success is highly likely.
