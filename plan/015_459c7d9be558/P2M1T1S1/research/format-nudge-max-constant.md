# Research — P2.M1.T1.S1: FORMAT_NUDGE_MAX constant + wire 3 call sites

> Project 015 "Format-Nudge Recovery" · **PRD §4.5.1**. A pure mechanical refactor:
> extract the inlined magic number `2` (the format-nudge bound) into a named
> `FORMAT_NUDGE_MAX` constant in `src/config/constants.ts`, and wire the three
> variants to it. **No behavioral change** — the value stays 2.

---

## 1. The three inlined call sites (verified — exact text + semantics)

All three are bounded "nudge-then-reparse" loops, each capped at 2 attempts. The bound
is a literal `2` inlined at each site (no shared constant today). Confirmed by direct read:

### (a) Coder result-envelope variant — `src/agents/prp-executor.ts` (~line 356)
```ts
let formatNudges = 0;
const maxFormatNudges = 2;                         // ← replace with FORMAT_NUDGE_MAX
while (coderResult.formatFailure === true && formatNudges < maxFormatNudges) {
  formatNudges++;
  this.#logger.warn(
    { prpTaskId: prp.taskId, formatNudges, maxFormatNudges },
    'Coder Agent response had no parseable JSON result envelope — sending format nudge (PRD §4.5.1)'
  );
  const nudgeResponse = await this.#nudgeForFormat(prp, formatNudges, maxFormatNudges, coderResponse);
  ...
}
```
`maxFormatNudges` is read at 3 sub-points (loop condition, WARN fields, `#nudgeForFormat`
arg). Only the `= 2` initializer changes → `const maxFormatNudges = FORMAT_NUDGE_MAX;`.
(The format-nudge-analysis.md cites line 357; current file has it at 356 — minor drift;
the exact text `const maxFormatNudges = 2;` is the unambiguous anchor.)

### (b) Researcher PRP-file-write variant — `src/agents/prp-generator.ts` (~line 822)
```ts
async #nudgeResearcherToWrite(
  task: { id: string },
  prpOutputPath: string,
  maxNudges = 2                                     // ← default param; replace with = FORMAT_NUDGE_MAX
): Promise<unknown> {
  for (let attempt = 1; attempt <= maxNudges; attempt++) {
    this.#logger.warn({ taskId: task.id, attempt, maxNudges }, '... write-nudge (PRD §4.5.1)');
    ...
  }
  ... `... after ${maxNudges} write-nudge(s) (PRD §4.5.1)` ...
}
```
`maxNudges` is a **default parameter** (`= 2`); the caller (`generate()` line 762) does
NOT pass it. Change ONLY the default: `maxNudges = FORMAT_NUDGE_MAX`. (Analysis cites 821;
current file 822 — drift; anchor = `maxNudges = 2` inside `#nudgeResearcherToWrite(...)`.)

### (c) Architect backlog-schema variant — `src/workflows/fix-cycle-workflow.ts` (line 373)
```ts
let vr = BacklogSchema.safeParse(backlog);
if (vr.success) return backlog;
const maxNudge = 2;                                 // ← replace with FORMAT_NUDGE_MAX
for (let attempt = 1; attempt <= maxNudge && !vr.success; attempt++) {
  ... `[FixCycleWorkflow] Architect backlog failed schema validation — nudge ${attempt}/${maxNudge}:\n${errs}` ...
}
```
`maxNudge` read at the loop condition + the WARN template. Only the `= 2` initializer
changes → `const maxNudge = FORMAT_NUDGE_MAX;`. (Line 373 matches exactly.)

**All three values are `2`, matching §4.5.1's "default 2". After the refactor every site
still resolves to 2 → zero behavioral change.** Existing behavior tests (which assert
"nudges N times then fails", not the literal) pass unchanged.

## 2. `FORMAT_NUDGE_MAX` is NOT in constants.ts (confirmed)

`rg "FORMAT_NUDGE" src/config/constants.ts` → absent (format-nudge-analysis.md §4 confirms).
It must be ADDED. The contract + analysis are explicit: it is **intentionally NOT exposed
as an env/.hack knob** — §4.5.1 gives it a fixed default with no documented env var, and
the project's P3.M1.T1.S2 doc task explicitly confirms "no .hack schema row for
FORMAT_NUDGE_MAX". So it is a **plain `export const FORMAT_NUDGE_MAX = 2;`** — NO env-name
const, NO `DEFAULT_*`, NO `get*()` reader (contrast with the env-configurable
`ISSUE_RETRY_MAX` / `DEFAULT_ISSUE_RETRY_MAX` / `getIssueRetryMax()` triplet at 392/407/422).

## 3. constants.ts placement + JSDoc precedent

**Placement:** the semantic neighbor is the **ISSUE_RETRY_MAX group** (§4.5 issue-driven
re-planning) — §4.5.1 #4 explicitly says format-nudges are "a separate budget from …
ISSUE_RETRY_MAX". Both live in the **"Resilience Tuning (§4.2, §4.5, §9.2.2)"** section
(banner at line 217). Insert `FORMAT_NUDGE_MAX` **immediately after `getIssueRetryMax()`
(line 427) and before the COMMIT_RETRY_MAX JSDoc (line 429)** — i.e. as the last member
of the §4.5 resilience cluster.

**JSDoc precedent to mirror:** the `ISSUE_RETRY_MAX` / `DEFAULT_ISSUE_RETRY_MAX` blocks
(380–407) — same `@remarks` + `@example` shape — but SIMPLER (one const, no env name, no
getter). The JSDoc MUST (contract DOCS): cite §4.5.1; state default 2; explicitly note
"internal constant, intentionally NOT exposed as a `.hack`/env knob"; name the 3 variants
it bounds.

## 4. Imports — two NEW lines + one IN-PLACE addition (verified)

- **`src/agents/prp-executor.ts`** — does **NOT** import from `../config/constants.js`
  today (imports at 22–33). ADD a new line `import { FORMAT_NUDGE_MAX } from '../config/constants.js';`,
  placed before the `../core` imports (line 32) so the `../config` import groups with the
  other `../` imports in roughly alphabetical order (`../config` < `../core`).
- **`src/agents/prp-generator.ts`** — does **NOT** import from `../config/constants.js`
  today (imports at 13–33). ADD the same new line, before the `../core/models.js` import
  (line 28).
- **`src/workflows/fix-cycle-workflow.ts`** — **ALREADY** imports `{ PARALLEL_RESEARCH,
  RESEARCH_DEPTH }` from `'../config/constants.js'` at **line 43**. ADD `FORMAT_NUDGE_MAX`
  to that existing import, alphabetical within braces (F before P):
  `import { FORMAT_NUDGE_MAX, PARALLEL_RESEARCH, RESEARCH_DEPTH } from '../config/constants.js';`.

## 5. Parallel item (P1.M4.T3.S1) — fully disjoint

P1.M4.T3.S1 ("Add Remote-Mutation Prohibition to FORBIDDEN OPERATIONS") is **prompt-text
only** — it edits `src/agents/prompts.ts` + `PROMPTS.md` (its PRP states: "No `src/` logic,
no tools, no tests — ONLY prompt text"). **Zero file overlap** with S1's four files
(constants.ts, prp-executor.ts, prp-generator.ts, fix-cycle-workflow.ts). No coordination
needed; no merge-conflict risk.

## 6. Tests — none required for behavior; optional value-lock

- **No behavioral change** (value stays 2) → no existing test needs updating. The three
  variants' tests assert *behavior* (nudge N times then surface the error), not the literal
  constant, so they pass unchanged.
- **100%-coverage gate:** the new `export const FORMAT_NUDGE_MAX = 2;` statement executes
  at module load; `constants.ts` is loaded by `tests/unit/config/constants.test.ts` (and by
  the three workflow files' own test suites via the wiring), so the statement is covered
  purely by usage — **no coverage gap** even with no dedicated test.
- **Optional value-lock (recommended, matches convention):** `tests/unit/config/constants.ts`
  locks every const's value (MODEL_NAMES, MODEL_ENV_VARS, ISSUE_RETRY_MAX, etc.). A one-line
  `expect(FORMAT_NUDGE_MAX).toBe(2)` mirrors that convention and documents the "intentionally
  2, not configurable" intent at the test level. Low-risk, high-clarity. (S2's scope is
  "confirm budget isolation + logging across the 3 variants" — distinct from this value lock.)

## 7. S1 vs S2 boundary
- **S1 (this PRP):** the constant + the 3 wirings + JSDoc. Pure refactor, zero behavior change.
- **S2 ("Confirm budget isolation + consistent WARN logging + JSDoc completion"):** verifies the
  3 variants are budget-isolated from `maxFixAttempts`/`ISSUE_RETRY_MAX`/`COMMIT_RETRY_MAX` (§4.5.1
  #4), that each emits the §4.5.1 WARN fields (taskId/attempt/budget), and completes any missing
  JSDoc on the nudge methods. S1 does NOT touch logging or budget-isolation logic — only the bound.

## 8. Exact edit anchors
- `src/config/constants.ts` — INSERT after line 427 (`}` closing `getIssueRetryMax`), before line 429 (`/**` COMMIT_RETRY_MAX JSDoc): the `FORMAT_NUDGE_MAX` const + JSDoc.
- `src/agents/prp-executor.ts` — ADD import (before line 32 `../core/checkpoint-manager`); replace `const maxFormatNudges = 2;` → `const maxFormatNudges = FORMAT_NUDGE_MAX;`.
- `src/agents/prp-generator.ts` — ADD import (before line 28 `../core/models`); replace default param `maxNudges = 2` → `maxNudges = FORMAT_NUDGE_MAX`.
- `src/workflows/fix-cycle-workflow.ts` — EDIT line 43 import (add FORMAT_NUDGE_MAX); replace `const maxNudge = 2;` → `const maxNudge = FORMAT_NUDGE_MAX;`.
- (optional) `tests/unit/config/constants.test.ts` — `expect(FORMAT_NUDGE_MAX).toBe(2)`.