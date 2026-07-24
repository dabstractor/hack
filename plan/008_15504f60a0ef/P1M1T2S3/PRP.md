# PRP — P1.M1.T2.S3: Add pre-merged PRD guidance to every agent prompt that embeds PRD content

> Consumes S2's resolved-document pipeline (LOGICAL input — the guidance is TRUE because S1/S2 made
> every downstream consumer run over the fully-resolved, include-expanded document). Adds the
> PRD §2.3 "Agent guidance" statement to **4 prompt constants** (`prompts.ts`) AND **3 prompt-generator
> functions** (`architect/bug-hunt/delta-analysis-prompt.ts`). No downstream subtask consumes this — it
> completes P1.M1. File-disjoint from S1/S2 (zero overlap).

---

## Goal

**Feature Goal**: Every agent prompt that embeds PRD content MUST explicitly tell the agent that the
PRD text it receives is **already the complete, merged document** and that it must **not** attempt to
resolve `@include` directives itself (PRD §2.3 "Agent guidance"). Today no prompt declares this, so an
agent could waste turns hunting for `@docs/foo.md` includes that the pipeline already expanded — or
worse, hallucinate include resolution. Close that gap across all embedding sites.

**Deliverable**:
1. **`src/agents/prompts.ts`** — ADD one exported canonical constant `PRD_PREMERGED_DECLARATION`
   (verbatim contract wording). Inject `${PRD_PREMERGED_DECLARATION}` into the 4 system-prompt
   constants: `TASK_BREAKDOWN_PROMPT`, `PRP_BLUEPRINT_PROMPT`, `DELTA_ANALYSIS_PROMPT`,
   `BUG_HUNT_PROMPT` (each right after its opening `# Header` line).
2. **`src/agents/prompts/architect-prompt.ts`** — EDIT `createArchitectPrompt`: import the constant and
   inject it into the **user** prompt immediately before `prdContent` (the system side is already
   covered by the `TASK_BREAKDOWN_PROMPT` constant).
3. **`src/agents/prompts/bug-hunt-prompt.ts`** — EDIT `constructUserPrompt`: import the constant and
   inject it into the user prompt immediately before the `## Original PRD` block.
4. **`src/agents/prompts/delta-analysis-prompt.ts`** — EDIT `constructUserPrompt`: import the constant
   and inject it into the user prompt immediately before the `## Previous PRD` block.
5. **Tests** — ADD lightweight substring assertions to the existing suites (`prompts.test.ts`,
   `bug-hunt-prompt.test.ts`, `delta-analysis-prompt.test.ts`) + a minimal new
   `tests/unit/agents/prompts/architect-prompt.test.ts` (mirrors the sibling unit-test pattern) to lock
   the injection in `createArchitectPrompt` (whose user prompt had no constant before).

**Success Definition**:
- The verbatim sentence *"The PRD text provided is already the complete, merged document — do not chase
  @include directives yourself."* appears in: all 4 prompt constants, and in the user prompt produced by
  `createArchitectPrompt`, `createBugHuntPrompt`, and `createDeltaAnalysisPrompt`.
- `createPRPBlueprintPrompt` (deliberately NOT edited) inherits the statement transitively — it already
  appends `PRP_BLUEPRINT_PROMPT` to its user prompt and uses it as `system` — verify via test.
- `npm run typecheck && npm run lint && npm run format:check` clean; `npm run test:run` green; touched
  source lines at 100% coverage.

---

## Why

- **PRD §2.3 mandates it.** *"Agent prompts that embed PRD content MUST state that the text they
  receive is already the complete merged document (agents must not chase includes themselves)."*
  S1/S2 completed the resolved-document invariant (hash/snapshot/delta all run over the merged doc).
  S3 closes the loop on the **agent-facing declaration** that makes that invariant useful to agents.
- **Prevents a real failure mode.** Without the declaration, a decomposition/delta/bug-hunt agent
  receiving `@architecture/api.md` tokens (or residual markers) could burn turns trying to `cat`/fetch
  includes, or hallucinate them. The declaration tells it the text is final.
- **Completes P1.M1 (Milestone 1).** No downstream subtask consumes this output; it is the terminal
  subtask of the milestone. P1.M2 (section extraction / `prd_selectors`) assumes resolved content is
  already the contract — this declaration is the human-readable expression of that contract.
- **Out of scope (hard boundary):** editing `resolvePRD`/the resolver (T1), S1's hash/snapshot wiring,
  S2's delta-path threading, `createPRPBlueprintPrompt` (covered transitively — do NOT edit),
  `DELTA_PRD_PROMPT` (generates a delta PRD, not an embedding prompt), `PRP_BUILDER_PROMPT` (embeds the
  PRP, not the PRD), the `PROMPTS` lookup object / `PromptKey` type, and any `docs/*.md` (DOCS: none).

---

## What

### User-visible behavior
None — prompt-internal guidance. No CLI, config, API, or filesystem surface change (DOCS: none per the
contract). The only effect is that LLM agents (architect, researcher, delta analyst, QA bug-hunter)
receive an explicit instruction not to chase includes.

### Technical requirements (exact contract)

**Canonical wording — use VERBATIM** (the em-dash is intentional; two stable test substrings:
`already the complete, merged document` and `do not chase @include directives yourself`):

> The PRD text provided is already the complete, merged document — do not chase @include directives yourself.

**The 4 constants are pure string literals** (verified: `${}` interpolation count = 0 in each) ⇒
interpolating a shared `${PRD_PREMERGED_DECLARATION}` is safe and keeps wording DRY. Declare it ONCE.

**Dual-channel injection is intentional** (the contract explicitly enumerates BOTH the constants AND
the functions): the 4 constants carry the statement at the **persona/system** level; the 3 functions
inject it into the **user prompt adjacent to the PRD content** (the most §2.3-correct placement, and
the only non-redundant place to honor "also add it to the functions" since each function already pulls
its constant in as `system`).

### Success Criteria
- [ ] `PRD_PREMERGED_DECLARATION` is exported from `src/agents/prompts.ts` with the verbatim sentence.
- [ ] All 4 constants contain the verbatim sentence at runtime (interpolated, NOT hardcoded 4×).
- [ ] `createArchitectPrompt`'s `user` prompt contains the sentence immediately before `prdContent`.
- [ ] `createBugHuntPrompt`'s `user` prompt contains the sentence immediately before `## Original PRD`.
- [ ] `createDeltaAnalysisPrompt`'s `user` prompt contains the sentence immediately before `## Previous PRD`.
- [ ] `PRD_PREMERGED_DECLARATION` is **NOT** added to the `PROMPTS` object or `PromptKey` union.
- [ ] `createPRPBlueprintPrompt` is NOT edited (transitively covered) — but its produced prompt still
      contains the sentence (verify via test, no code change).
- [ ] `npm run typecheck && npm run lint && npm run format:check` clean; `npm run test:run` green.

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_ **Yes** — the verbatim
wording, the exact header-anchored insertion pattern for each of the 4 constants (robust to line drift),
the exact before/after for each of the 3 function edits, the test-safety proof (all assertions are
`toContain`; zero strict-equality assertions on `.user`/`.systemOverride`), the transitive-coverage
explanation for `createPRPBlueprintPrompt`, the `PROMPTS`/`PromptKey` exclusion, the parallel-disjoint
proof vs S1/S2, and executable validation commands.

### Documentation & References
```yaml
# MUST READ — PRD spec (also inline in this PRP's <selected_prd_content>)
- docfile: PRD.md
  section: "§2.3 Distributed (Multi-File) PRDs" → bullet "Agent guidance"
  why: Authoritative requirement. The exact phrasing of the invariant this subtask operationalizes.
  critical: The declaration is REQUIRED on "agent prompts that embed PRD content" — system AND user.

# MUST READ — this subtask's research (call-site inventory + test-safety + design rationale)
- docfile: plan/008_15504f60a0ef/P1M1T2S3/research/agent-guidance-call-sites.md
  section: "1. Call-site inventory", "2. Test-safety analysis", "3. Design decision"
  why: Verified decl/header line numbers, the pure-literal finding (0 `${}` per constant), the zero
        strict-equality test finding, the createPRPBlueprintPrompt transitive-coverage explanation,
        and the dual-channel injection rationale.

# CONTEXT — what S3 consumes (logical input; S3 does NOT edit these files)
- file: plan/008_15504f60a0ef/P1M1T2S2/PRP.md
  why: S2 makes the delta path resolved-correct. S3's declaration is TRUE because S1/S2 landed. S3's
        file set is DISJOINT from S2's (see research §4). delta-analysis-WORKFLOW.ts (S2) ≠
        delta-analysis-PROMPT.ts (S3).

# PATTERN FILES
- file: src/agents/prompts.ts
  why: ADD `PRD_PREMERGED_DECLARATION` (top, after imports, before line 33). Inject into the 4 constants.
        Lines: TASK_BREAKDOWN_PROMPT@33 (header@34), PRP_BLUEPRINT_PROMPT@166 (header@167),
        DELTA_ANALYSIS_PROMPT@761 (header@762), BUG_HUNT_PROMPT@884 (header@885).
        PROMPTS lookup object@1004 — DO NOT add the new constant to it (PromptKey/test asserts 6 keys).
  pattern: "export const XXX = `\n# HEADER\n\n> **ROLE:** …"  →  inject `${PRD_PREMERGED_DECLARATION}\n\n` after the header line.
  gotcha: The 4 constants currently have ZERO `${}` interpolation (awk-verified) — interpolation is safe.

- file: src/agents/prompts/architect-prompt.ts
  why: `createArchitectPrompt(prdContent, sessionPath?)` → currently `user: prdContent` (RAW, no constant
        appended). This is the ONE function whose user prompt does NOT already carry a constant ⇒ the
        user injection here is ESSENTIAL (system is covered via TASK_BREAKDOWN_PROMPT).
        Import line 8: `import { TASK_BREAKDOWN_PROMPT } from '../prompts.js';` → ADD the new constant.
  pattern: "user: prdContent," → "user: `${PRD_PREMERGED_DECLARATION}\n\n${prdContent}`,"

- file: src/agents/prompts/bug-hunt-prompt.ts
  why: `constructUserPrompt(prd, completedTasks)` builds the user string; PRD sits under `## Original PRD`.
        Import line 14: `import { BUG_HUNT_PROMPT } from '../prompts.js';` → ADD the new constant.
        NOTE: constructUserPrompt ALSO appends `${BUG_HUNT_PROMPT}` to the user tail — so the constant
        injection makes the sentence appear at the tail too (pre-existing behavior; the contract's
        "also add to the function" is satisfied by the PRD-adjacent injection).
  pattern: "return `\n## Original PRD\n\n${prd}…" → "return `\n${PRD_PREMERGED_DECLARATION}\n\n## Original PRD\n\n${prd}…"

- file: src/agents/prompts/delta-analysis-prompt.ts
  why: `constructUserPrompt(oldPRD, newPRD, completedTaskIds?)` builds the user string; old PRD under
        `## Previous PRD`, new under `## Current PRD`. Import line 9:
        `import { DELTA_ANALYSIS_PROMPT } from '../prompts.js';` → ADD the new constant.
        NOTE: same tail-append behavior as bug-hunt. ⚠️ Do NOT use a `## ` header for the declaration
        (would collide with the order test that keys on indexOf('## Previous PRD') — use the blockquote
        prose form, which has no `## ` prefix).
  pattern: "return `\n## Previous PRD\n\n${oldPRD}…" → "return `\n${PRD_PREMERGED_DECLARATION}\n\n## Previous PRD\n\n${oldPRD}…"

- file: src/agents/prompts/prp-blueprint-prompt.ts
  why: REFERENCE ONLY — DO NOT EDIT. `constructUserPrompt` appends `${PRP_BLUEPRINT_PROMPT}`@233 to the
        user prompt and uses it as `system`. Once the constant has the statement, the researcher prompt
        carries it in BOTH channels transitively. This is WHY the contract omits createPRPBlueprintPrompt.

- file: src/agents/prompts/index.ts
  why: Barrel re-export. Optionally re-export `PRD_PREMERGED_DECLARATION` for the architect test
        (`import { … } from '#/prompts/index.js'` alias is used by bug-hunt-prompt.test.ts). Check
        whether the architect test needs the alias path or a direct relative path.
```

### Current Codebase tree (relevant slice)
```bash
src/agents/
├── prompts.ts                          # EDIT: add PRD_PREMERGED_DECLARATION + inject into 4 constants
└── prompts/
    ├── architect-prompt.ts             # EDIT: createArchitectPrompt — inject into `user`
    ├── bug-hunt-prompt.ts              # EDIT: constructUserPrompt — inject before "## Original PRD"
    ├── delta-analysis-prompt.ts        # EDIT: constructUserPrompt — inject before "## Previous PRD"
    ├── prp-blueprint-prompt.ts         # NO EDIT (transitively covered)
    └── index.ts                        # OPTIONAL: re-export PRD_PREMERGED_DECLARATION (if test uses alias)
tests/unit/agents/
├── prompts.test.ts                     # EDIT: add assertions (4 constants + new export)
└── prompts/
    ├── bug-hunt-prompt.test.ts         # EDIT: assert user prompt contains the sentence
    ├── delta-analysis-prompt.test.ts   # EDIT: assert user prompt contains the sentence
    └── architect-prompt.test.ts        # CREATE: minimal test locking createArchitectPrompt's user injection
```

### Desired Codebase tree with files to be added/edited
```bash
src/agents/prompts.ts                       # MODIFIED (new const + 4 interpolated injections)
src/agents/prompts/architect-prompt.ts      # MODIFIED (import + user injection)
src/agents/prompts/bug-hunt-prompt.ts       # MODIFIED (import + constructUserPrompt injection)
src/agents/prompts/delta-analysis-prompt.ts # MODIFIED (import + constructUserPrompt injection)
tests/unit/agents/prompts.test.ts           # MODIFIED (new describe block)
tests/unit/agents/prompts/bug-hunt-prompt.test.ts       # MODIFIED (1-2 assertions)
tests/unit/agents/prompts/delta-analysis-prompt.test.ts # MODIFIED (1-2 assertions)
tests/unit/agents/prompts/architect-prompt.test.ts      # NEW (minimal, mirrors sibling pattern)
```

### Known Gotchas of our codebase & Library Quirks
```ts
// CRITICAL — Use the verbatim sentence. Two stable test substrings anchor it:
//   "already the complete, merged document" and "do not chase @include directives yourself".
//   Do NOT paraphrase. The em-dash (—) is intentional.

// CRITICAL — Declare PRD_PREMERGED_DECLARATION ONCE in prompts.ts and reference it everywhere (DRY).
//   Do NOT hardcode the sentence 4× in the constants. The 4 constants are pure literals today (0 `${}`)
//   so `${PRD_PREMERGED_DECLARATION}` interpolation is safe and keeps the wording identical.

// CRITICAL — DO NOT add PRD_PREMERGED_DECLARATION to the `PROMPTS` lookup object (prompts.ts ~line 1004)
//   or the `PromptKey` union. prompts.test.ts asserts `Object.keys(PROMPTS).toHaveLength(6)`. The new
//   constant is a guidance fragment, not a persona prompt.

// CRITICAL — DO NOT edit createPRPBlueprintPrompt. It appends `${PRP_BLUEPRINT_PROMPT}` to its user
//   prompt (prp-blueprint-prompt.ts:233) AND uses it as system ⇒ the constant injection covers it
//   transitively. Editing the function would create a 2nd hand-injected copy. The contract omits it
//   deliberately.

// CRITICAL — Inject into the FUNCTIONS' USER prompt (not system). Each function already pulls its
//   constant in as `system:`. The only non-redundant place to honor "also add it to the function" is
//   the user prompt, adjacent to the PRD content — which is also the most §2.3-correct placement.

// GOTCHA — delta-analysis-prompt.ts: do NOT give the declaration a `## ` markdown header. The test
//   `indexOf('## Previous PRD') < indexOf('## Current PRD')` and the completed-tasks order test key on
//   those exact header strings. Use the blockquote prose form (no `## ` prefix) so it can't collide.

// GOTCHA — bug-hunt/delta constructUserPrompt ALSO append their constant to the user tail
//   (`${BUG_HUNT_PROMPT}` / `${DELTA_ANALYSIS_PROMPT}`). So after this change those agents see the
//   sentence at: system + PRD-adjacent-user + tail-user. Triple occurrence is intentional/defensive
//   (the contract enumerates both channels); do NOT try to de-duplicate by removing the tail append.

// GOTCHA — There is NO existing unit test for architect-prompt.ts (only integration architect-agent
//   tests). createArchitectPrompt's user injection is the most important one to lock (its user prompt
//   had no constant before). Add a minimal tests/unit/agents/prompts/architect-prompt.test.ts mirroring
//   the bug-hunt/delta sibling pattern.

// GOTCHA — prettier is ERROR-enforced (format:check). Run `npm run fix` (lint:fix + prettier --write)
//   before format:check. Template-literal interpolations may trigger a prettier reflow — let `npm run
//   fix` handle it.

// GOTCHA — 100% coverage is globally enforced (vitest.config.ts). The new constant + injection lines
//   are covered when tests (a) import/reference the constant and (b) call the 3 functions. The new
//   architect test + the edited bug-hunt/delta tests + the prompts.test.ts constant assertions cover it.

// CRITICAL — Parallel execution: S3's files are DISJOINT from S1/S2 (research §4). Do NOT touch
//   session-manager.ts / prp-pipeline.ts / delta-analysis-WORKFLOW.ts / session-manager.test.ts.
//   Note: delta-analysis-WORKFLOW.ts (S2) ≠ delta-analysis-PROMPT.ts (S3).
```

---

## Implementation Blueprint

### Data models and structure
No new data models. One new exported string constant (internal guidance fragment — not a persona prompt,
not added to `PROMPTS`/`PromptKey`):
```ts
// src/agents/prompts.ts — add near the top (after the module JSDoc, before line 33)
export const PRD_PREMERGED_DECLARATION =
  '> **PRD document note (PRD §2.3):** The PRD text provided is already the complete, merged document — do not chase @include directives yourself.';
```
No signature changes anywhere. The 3 generator functions keep their existing signatures.

### Implementation Tasks (ordered by dependencies)
```yaml
Task 1: EDIT src/agents/prompts.ts  (add constant + inject into 4 constants)
  - ADD (top, after imports/module JSDoc, before TASK_BREAKDOWN_PROMPT@33):
        export const PRD_PREMERGED_DECLARATION =
          '> **PRD document note (PRD §2.3):** The PRD text provided is already the complete, merged document — do not chase @include directives yourself.';
        (plus a JSDoc @remarks citing PRD §2.3 "Agent guidance" — single source of truth for all sites.)
  - For EACH of the 4 constants, interpolate `${PRD_PREMERGED_DECLARATION}` immediately AFTER the
        opening `# HEADER` line (and its following blank line), before the rest of the prompt:
        * TASK_BREAKDOWN_PROMPT  (header line 34: "# LEAD TECHNICAL ARCHITECT & PROJECT SYNTHESIZER")
        * PRP_BLUEPRINT_PROMPT   (header line 167: "# Create PRP for Work Item")
        * DELTA_ANALYSIS_PROMPT  (header line 762: "# PRD Delta Analysis")
        * BUG_HUNT_PROMPT        (header line 885: "# Creative Bug Finding - End-to-End PRD Validation")
        Pattern (header-anchored, robust to line drift):
          export const X = `
          # HEADER

          ${PRD_PREMERGED_DECLARATION}

          <rest of prompt unchanged>
          `
  - DO NOT touch PROMPTS lookup object (~line 1004) or PromptKey. DO NOT touch DELTA_PRD_PROMPT,
        PRP_BUILDER_PROMPT, or any other constant.
  - EXPECTED: prompts.test.ts still green (all assertions are `toContain` on the runtime value; the
        header substrings remain present).

Task 2: EDIT src/agents/prompts/architect-prompt.ts  (inject into `user`)
  - IMPORT: line 8 `import { TASK_BREAKDOWN_PROMPT } from '../prompts.js';` → add PRD_PREMERGED_DECLARATION
        to the named imports.
  - createArchitectPrompt: change the returned createPrompt `user` field from `prdContent` to
        `${PRD_PREMERGED_DECLARATION}\n\n${prdContent}` (template literal). Leave `system` (systemPrompt)
        and `responseFormat` untouched — system is already covered by TASK_BREAKDOWN_PROMPT.
  - DO NOT touch the sessionPath placeholder substitution logic.
  - EXPECTED: no existing test asserts on createArchitectPrompt's user (none exists); new architect test
        (Task 6) will lock it.

Task 3: EDIT src/agents/prompts/bug-hunt-prompt.ts  (inject into constructUserPrompt)
  - IMPORT: line 14 `import { BUG_HUNT_PROMPT } from '../prompts.js';` → add PRD_PREMERGED_DECLARATION.
  - constructUserPrompt: inject `${PRD_PREMERGED_DECLARATION}` as the FIRST line of the returned
        template literal, immediately before `## Original PRD`. Keep the `## Original PRD` / `## Completed
        Tasks` / `---` / appended `${BUG_HUNT_PROMPT}` structure and ordering otherwise identical.
  - DO NOT touch fileBanner logic, responseFormat, or enableReflection.
  - EXPECTED: bug-hunt-prompt.test.ts still green (toContain on `## Original PRD`/PRD text; no order test
        across PRD↔tasks↔phases). The appended `${BUG_HUNT_PROMPT}` tail now ALSO carries the sentence.

Task 4: EDIT src/agents/prompts/delta-analysis-prompt.ts  (inject into constructUserPrompt)
  - IMPORT: line 9 `import { DELTA_ANALYSIS_PROMPT } from '../prompts.js';` → add PRD_PREMERGED_DECLARATION.
  - constructUserPrompt: inject `${PRD_PREMERGED_DECLARATION}` as the FIRST line of the returned
        template literal, immediately before `## Previous PRD`. Keep `## Previous PRD` / `## Current PRD`
        / optional `## Completed Tasks` / `---` / appended `${DELTA_ANALYSIS_PROMPT}` ordering identical.
  - ⚠️ The declaration must NOT begin with `## ` (would collide with the order test's indexOf keys).
        The blockquote-prose form is safe.
  - DO NOT touch responseFormat or enableReflection.
  - EXPECTED: delta-analysis-prompt.test.ts still green — the two order tests (previous < current;
        completedTasks > current) hold because all indices shift up equally. `toContain` on PRD
        sections/text still true.

Task 5: EDIT tests  (lock the new behavior — lightweight substring assertions)
  - tests/unit/agents/prompts.test.ts: ADD a `describe('pre-merged PRD declaration (PRD §2.3)', …)` block:
        * `expect(PRD_PREMERGED_DECLARATION).toContain('already the complete, merged document')`
        * `expect(PRD_PREMERGED_DECLARATION).toContain('do not chase @include directives yourself')`
        * for EACH of the 4 constants: `expect(CONST).toContain('do not chase @include directives yourself')`
        * add PRD_PREMERGED_DECLARATION to the existing `import { … } from '../../../src/agents/prompts.js'`.
  - tests/unit/agents/prompts/bug-hunt-prompt.test.ts: in the existing createBugHuntPrompt describe,
        ADD: `expect(prompt.user).toContain('do not chase @include directives yourself')` (and/or the
        "already the complete, merged document" substring). It already imports createBugHuntPrompt.
  - tests/unit/agents/prompts/delta-analysis-prompt.test.ts: ADD the same assertion on `prompt.user`.
        Add the substring check to an existing test (e.g. the 'should include old PRD in user prompt' test).
  - EXPECTED: green immediately (the assertions describe behavior that the source edits deliver).

Task 6: CREATE tests/unit/agents/prompts/architect-prompt.test.ts  (mirror sibling pattern; lock Task 2)
  - IMPORT createArchitectPrompt from '../../../../src/agents/prompts/architect-prompt.js' (match the
        relative path style of delta-analysis-prompt.test.ts) OR via '#/prompts/index.js' alias — check
        whether index.ts re-exports createArchitectPrompt (it exports createPRPBlueprintPrompt; add the
        re-export if needed, else use the direct relative path).
  - Minimal tests:
        * 'should return a Prompt object' — prompt.user is a string; systemOverride defined; responseFormat defined.
        * 'should inject pre-merged PRD declaration before PRD content' —
              const p = createArchitectPrompt('# My PRD\n…');
              expect(p.user).toContain('do not chase @include directives yourself');
              expect(p.user).toContain('# My PRD');
              expect(p.user.indexOf('do not chase @include directives yourself')).toBeLessThan(p.user.indexOf('# My PRD'));
        * 'should keep the architect system persona' —
              expect(p.systemOverride).toContain('LEAD TECHNICAL ARCHITECT');
  - EXPECTED: green; covers the Task 2 injection line.

Task 7: FORMAT + VERIFY
  - RUN: npm run fix → npm run typecheck → npm run lint → npm run format:check.
  - RUN: npx vitest run tests/unit/agents/prompts.test.ts tests/unit/agents/prompts/ (all prompt unit tests).
  - RUN: npx vitest run tests/integration/task-breakdown-prompt.test.ts tests/integration/bug-finding-prompt.test.ts
        tests/integration/prp-create-prompt.test.ts (integration — unchanged, must stay green).
  - RUN: npm run test:run (full suite — no regression; 100% coverage on touched source lines).
  - EXPECTED: all green.
```

### Implementation Patterns & Key Details
```ts
// ---- src/agents/prompts.ts: the canonical constant (declare ONCE, near the top) ----
/**
 * Pre-merged PRD declaration — required by PRD §2.3 "Agent guidance".
 *
 * @remarks
 * Every agent prompt that embeds PRD content MUST state that the text is the complete, merged
 * document so the agent does not resolve @include directives itself. The pipeline resolves includes
 * upstream (§2.3 "Single canonical document downstream"). This is the single shared wording injected
 * into the 4 system-prompt constants and the 3 prompt-generator functions' user prompts.
 */
export const PRD_PREMERGED_DECLARATION =
  '> **PRD document note (PRD §2.3):** The PRD text provided is already the complete, merged document — do not chase @include directives yourself.';

// ---- src/agents/prompts.ts: constant injection pattern (header-anchored) ----
export const TASK_BREAKDOWN_PROMPT = `
# LEAD TECHNICAL ARCHITECT & PROJECT SYNTHESIZER

${PRD_PREMERGED_DECLARATION}

> **ROLE:** Act as a Lead Technical Architect and Project Management Synthesizer.
…  // (identical pattern for PRP_BLUEPRINT_PROMPT, DELTA_ANALYSIS_PROMPT, BUG_HUNT_PROMPT)

// ---- src/agents/prompts/architect-prompt.ts: user injection (ESSENTIAL — user had no constant) ----
import { TASK_BREAKDOWN_PROMPT, PRD_PREMERGED_DECLARATION } from '../prompts.js';
// …inside createArchitectPrompt, the returned createPrompt:
return createPrompt({
  user: `${PRD_PREMERGED_DECLARATION}\n\n${prdContent}`,   // declaration adjacent to the PRD
  system: systemPrompt,                                      // already carries it via TASK_BREAKDOWN_PROMPT
  responseFormat: z.unknown(),
});

// ---- src/agents/prompts/bug-hunt-prompt.ts: constructUserPrompt injection ----
import { BUG_HUNT_PROMPT, PRD_PREMERGED_DECLARATION } from '../prompts.js';
// …constructUserPrompt return:
return `
${PRD_PREMERGED_DECLARATION}

## Original PRD

${prd}

## Completed Tasks

${tasksList}

---

${BUG_HUNT_PROMPT}
`;

// ---- src/agents/prompts/delta-analysis-prompt.ts: constructUserPrompt injection ----
import { DELTA_ANALYSIS_PROMPT, PRD_PREMERGED_DECLARATION } from '../prompts.js';
// …constructUserPrompt return (note: NO `## ` prefix on the declaration):
return `
${PRD_PREMERGED_DECLARATION}

## Previous PRD

${oldPRD}

## Current PRD

${newPRD}${completedTasksSection}

---

${DELTA_ANALYSIS_PROMPT}
`;
```

### Integration Points
```yaml
PROMPTS MODULE (src/agents/prompts.ts):
  - ADD: PRD_PREMERGED_DECLARATION (exported, near top). Single source of truth.
  - INJECT: ${PRD_PREMERGED_DECLARATION} after the header line of the 4 constants.
  - DO NOT EDIT: PROMPTS lookup object, PromptKey, DELTA_PRD_PROMPT, PRP_BUILDER_PROMPT.

ARCHITECT (src/agents/prompts/architect-prompt.ts):
  - IMPORT + inject into `user` (before prdContent). system already covered. No signature change.

BUG-HUNT (src/agents/prompts/bug-hunt-prompt.ts):
  - IMPORT + inject into constructUserPrompt (before "## Original PRD"). No signature change.
  - The appended ${BUG_HUNT_PROMPT} tail now also carries the sentence (pre-existing behavior).

DELTA-ANALYSIS (src/agents/prompts/delta-analysis-prompt.ts):
  - IMPORT + inject into constructUserPrompt (before "## Previous PRD"). No signature change.
  - The appended ${DELTA_ANALYSIS_PROMPT} tail now also carries the sentence (pre-existing behavior).

RESEARCHER (src/agents/prompts/prp-blueprint-prompt.ts):
  - NO EDIT. Transitively covered (appends ${PRP_BLUEPRINT_PROMPT} to user + uses it as system).

DOWNSTREAM (becomes correct via this subtask):
  - The architect, researcher, delta-analyst, and bug-hunter agents all receive an explicit instruction
    not to chase @include directives. Completes P1.M1. P1.M2 assumes resolved content is the contract.

DOCS (Mode A — the contract says DOCS: none):
  - NO docs/*.md edits. NO user-facing/config/API surface change. The JSDoc on PRD_PREMERGED_DECLARATION
    is the only doc artifact, and it rides with the code (prompt-internal guidance).
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
npm run fix            # lint:fix + prettier --write (run first — interpolations may reflow)
npm run typecheck      # tsc --noEmit -p tsconfig.build.json — clean
npm run lint           # eslint . --ext .ts — clean (watch: unused import if a function forgets to import the const)
npm run format:check   # prettier --check — clean
# Expected: all clean. If lint flags "PRD_PREMERGED_DECLARATION is defined but never used" in prompts.ts,
#   a constant interpolation was missed. If it flags an unused import in a function file, the injection
#   line was missed.
```

### Level 2: Unit Tests (Component Validation)
```bash
# The 4 constants + new export:
npx vitest run tests/unit/agents/prompts.test.ts
# The 3 generator functions (incl. new architect test):
npx vitest run tests/unit/agents/prompts/
# Full suite:
npm run test:run
# Coverage on touched source files:
npx vitest run tests/unit/agents/prompts.test.ts tests/unit/agents/prompts/ --coverage
# Expected: all green. If prompts.ts coverage <100%, ensure the constant + each interpolation are
#   referenced (the prompts.test.ts assertions reference the constant; the function tests reference the
#   interpolated constants transitively).
```

### Level 3: Integration Testing (System Validation)
```bash
# These assert on the CONSTANTS (toContain) — must pass UNCHANGED:
npx vitest run tests/integration/task-breakdown-prompt.test.ts
npx vitest run tests/integration/bug-finding-prompt.test.ts
npx vitest run tests/integration/prp-create-prompt.test.ts
# Build emits dist/ cleanly (proves the imports/interpolations compile):
npx tsc -p tsconfig.build.json
# Expected: all green; build succeeds. These suites prove the constant edits don't regress the personas.
```

### Level 4: Creative & Domain-Specific Validation
```bash
# No MCP/DB/HTTP. Domain checks (record in commit message):
#   1. Verbatim sentence present in all 4 constants + 3 function user prompts (grep proof):
grep -c "do not chase @include directives yourself" src/agents/prompts.ts   # ≥ 1 (the constant) — runtime value appears 4× via interpolation
grep -rn "PRD_PREMERGED_DECLARATION" src/agents/                            # 1 decl + 4 constant refs + 3 function refs = 8 hits
#   2. createPRPBlueprintPrompt transitively covered (no edit) — verify via a one-off node check or by
#      trusting the prp-blueprint-prompt.ts:233 `${PRP_BLUEPRINT_PROMPT}` append + system usage.
#   3. No regression in persona headers (integration suites above).
#   4. PROMPTS lookup still has exactly 6 keys (prompts.test.ts asserts this).
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` clean.
- [ ] `npm run lint` clean (no unused `PRD_PREMERGED_DECLARATION` import/decl).
- [ ] `npm run format:check` clean.
- [ ] `npx vitest run tests/unit/agents/prompts.test.ts` green (4 constants + new export assertions).
- [ ] `npx vitest run tests/unit/agents/prompts/` green (bug-hunt, delta-analysis, NEW architect test).
- [ ] Integration prompt suites green (UNCHANGED — `toContain` on constants).
- [ ] `npm run test:run` (full suite) green — no regression; touched source lines at 100% coverage.

### Feature Validation
- [ ] The verbatim sentence appears in all 4 prompt constants (interpolated, not hardcoded 4×).
- [ ] `createArchitectPrompt`'s `user` contains the sentence before `prdContent`.
- [ ] `createBugHuntPrompt`'s `user` contains the sentence before `## Original PRD`.
- [ ] `createDeltaAnalysisPrompt`'s `user` contains the sentence before `## Previous PRD`.
- [ ] `PRD_PREMERGED_DECLARATION` is NOT in the `PROMPTS` object / `PromptKey` (lookup still 6 keys).
- [ ] `createPRPBlueprintPrompt` unedited yet transitively carries the sentence.

### Code Quality Validation
- [ ] Single shared constant (DRY) — verbatim wording identical at all 7 sites.
- [ ] Dual-channel injection (system via constant + user via function) per the contract enumeration.
- [ ] Does NOT edit `resolvePRD`/resolver, S1/S2 files, `createPRPBlueprintPrompt`, `DELTA_PRD_PROMPT`,
      `PRP_BUILDER_PROMPT`, the `PROMPTS` object, or `PromptKey`.
- [ ] Follows existing prompt-file conventions (named import from `../prompts.js`, `.js` ESM extension).
- [ ] The declaration block in delta-analysis has no `## ` header (order-test safe).

### Documentation & Deployment
- [ ] JSDoc on `PRD_PREMERGED_DECLARATION` cites PRD §2.3 "Agent guidance" (the only doc artifact).
- [ ] DOCS: none — no `docs/*.md`, README, or config changes (prompt-internal guidance per the contract).
- [ ] Commit message notes: the 4-constant + 3-function enumeration, the single shared constant design,
      the transitive coverage of createPRPBlueprintPrompt, and the PROMPTS/PromptKey exclusion.

---

## Anti-Patterns to Avoid

- ❌ Don't paraphrase the sentence — use it verbatim (tests assert on two stable substrings).
- ❌ Don't hardcode the sentence 4× in the constants — declare `PRD_PREMERGED_DECLARATION` once and
      interpolate `${PRD_PREMERGED_DECLARATION}`.
- ❌ Don't add `PRD_PREMERGED_DECLARATION` to the `PROMPTS` lookup object or `PromptKey` — `prompts.test.ts`
      asserts exactly 6 keys.
- ❌ Don't edit `createPRPBlueprintPrompt` — it's transitively covered (appends the constant to its user
      prompt + uses it as system). Editing it would duplicate.
- ❌ Don't inject the declaration into the functions' `system` field — that duplicates the constant.
      Inject into the `user` field, adjacent to the PRD content (the only non-redundant, §2.3-correct spot).
- ❌ Don't give the delta-analysis declaration a `## ` header — it collides with the order test's
      `indexOf('## Previous PRD')` / `indexOf('## Current PRD')` keys. Use the blockquote-prose form.
- ❌ Don't remove the appended `${BUG_HUNT_PROMPT}` / `${DELTA_ANALYSIS_PROMPT}` tail in the user prompts
      to "de-duplicate" — that tail carrying the sentence is pre-existing behavior; triple occurrence for
      those two agents is intentional/defensive.
- ❌ Don't touch `DELTA_PRD_PROMPT` (generates a delta PRD) or `PRP_BUILDER_PROMPT` (embeds the PRP, not
      the PRD) — neither is an agent prompt embedding the merged PRD.
- ❌ Don't touch any S1/S2 file (`session-manager.ts`, `prp-pipeline.ts`, `delta-analysis-workflow.ts`,
      `session-manager.test.ts`) — S3 is file-disjoint; `delta-analysis-workflow.ts` ≠ `delta-analysis-prompt.ts`.
- ❌ Don't skip the new architect unit test — `createArchitectPrompt`'s user injection is the one that had
      no constant before, so it's the most important to lock.

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: This is a focused, low-risk text-addition across 4 string-literal constants + 3 generator
functions, unified by one shared exported constant. The consumed facts are all verified in-repo: the 4
constants are pure literals (0 `${}` ⇒ interpolation is safe), no test asserts strict equality on any
function's `user`/`systemOverride` (all `toContain`), the delta-analysis order tests are preserved
(declaration shifts all indices equally and carries no `## ` header), and `createPRPBlueprintPrompt` is
provably covered transitively (it appends `PRP_BLUEPRINT_PROMPT` to its user + uses it as system) — which
is exactly why the contract omits it. The dual-channel (system + user) injection is the literal reading
of the contract's enumeration of both constants and functions. File-disjoint from S1/S2 (no merge
conflict). The only residual risks are (a) a prettier reflow of the interpolated template literals
(auto-fixed via `npm run fix`) and (b) choosing the import path for the new architect test (direct
relative vs `#/prompts/index.js` alias — recipe provided). No external/runtime unknowns; behavior is
purely prompt-internal (DOCS: none).