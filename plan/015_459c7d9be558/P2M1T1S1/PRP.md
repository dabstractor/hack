# PRP — P2.M1.T1.S1: FORMAT_NUDGE_MAX constant in constants.ts + import at all call sites

---

## Goal

**Feature Goal**: Extract the inlined format-nudge bound (the magic number `2`,
duplicated across three format-nudge recovery loops per PRD §4.5.1) into a single
named **`FORMAT_NUDGE_MAX`** constant in `src/config/constants.ts`, and wire all
three variants to it. **Pure refactor — zero behavioral change** (the value stays 2).
The constant is **intentionally NOT exposed as an env/`.hack` knob** (§4.5.1 gives it a
fixed default; P3.M1.T1.S2 explicitly confirms "no `.hack` schema row for
FORMAT_NUDGE_MAX"), so it is a plain `export const` — no env-name const, no
`DEFAULT_*`, no `get*()` reader.

**Deliverable** (4 src edits + JSDoc; no behavioral change):
1. **`src/config/constants.ts`** — ADD `export const FORMAT_NUDGE_MAX = 2;` (+ Mode-A
   JSDoc citing §4.5.1), placed after `getIssueRetryMax()` (line 427) in the §4.5
   Resilience cluster.
2. **`src/agents/prp-executor.ts`** — ADD import; replace `const maxFormatNudges = 2;`
   (~356) → `const maxFormatNudges = FORMAT_NUDGE_MAX;`.
3. **`src/agents/prp-generator.ts`** — ADD import; change `#nudgeResearcherToWrite(...)`
   default param `maxNudges = 2` (~822) → `maxNudges = FORMAT_NUDGE_MAX`.
4. **`src/workflows/fix-cycle-workflow.ts`** — ADD `FORMAT_NUDGE_MAX` to the existing
   line-43 constants import; replace `const maxNudge = 2;` (373) → `const maxNudge = FORMAT_NUDGE_MAX;`.
5. **(optional)** `tests/unit/config/constants.test.ts` — one-line value lock
   `expect(FORMAT_NUDGE_MAX).toBe(2)` (matches the file's lock-every-const convention).

**Success Definition**:
- `FORMAT_NUDGE_MAX` is exported from `src/config/constants.ts` with value `2` and a
  JSDoc citing §4.5.1 + the "not env/`.hack`-configurable" note.
- All three variants resolve their bound to `FORMAT_NUDGE_MAX` (no remaining literal `= 2`
  nudge bound): `rg "maxFormatNudges = 2|maxNudges = 2|maxNudge = 2" src/` → empty.
- **Behavior is unchanged** (every site still caps at 2); the three variants' existing
  behavior tests pass without modification.
- `npm run typecheck && npm run lint && npm run format:check` clean; 100% coverage
  maintained on `constants.ts` (the new const is covered by usage at module load).
- S1 edits ONLY the 4 src files above (+ optional test). No logging, budget-isolation,
  or nudge-method JSDoc changes (those are S2).

---

## Why

- **DRY + single source of truth.** §4.5.1's `FORMAT_NUDGE_MAX` (default 2) is currently
  inlined as the literal `2` in three unrelated files (Coder envelope, Researcher
  PRP-write, Architect backlog-schema). format-nudge-analysis.md §1.6/§2.4/§3.6 each
  flag "No shared constant — inlined." A future tuning of the bound would require hunting
  three sites; the named constant makes it one.
- **Documents intent.** The constant + its JSDoc make explicit that this is a *deliberate,
  fixed, non-configurable* budget — distinct from the env-tunable `ISSUE_RETRY_MAX` /
  `COMMIT_RETRY_MAX`. This preempts a future contributor "helpfully" adding an env knob
  that §4.5.1 deliberately omits.
- **Foundational for S2.** S2 ("Confirm budget isolation + consistent WARN logging +
  JSDoc completion") reasons about the bound symbolically; having the single named
  constant makes that confirmation and any later doc completion clean.
- **Out of scope (hard boundaries):** any behavioral change to the nudge loops (value must
  stay 2), the WARN logging fields (S2), budget-isolation logic (S2 — already structurally
  isolated per analysis §1.6/§2.4/§3.6), nudge-method JSDoc completion (S2), exposing
  `FORMAT_NUDGE_MAX` as an env/`.hack` knob (explicitly NOT — §4.5.1), the `hack config`
  subcommand / `.hack` schema (P2.M2 / P3), and any `docs/*.md` (Mode A = JSDoc only).

---

## What

### User-visible behavior
None. Internal refactor; the format-nudge bound is still 2 in all three variants.

### Technical requirements (exact contract)

**`src/config/constants.ts`** — INSERT after `getIssueRetryMax()` (line 427), before the
`COMMIT_RETRY_MAX` JSDoc (line 429):
```ts
/**
 * Max in-place format-nudge attempts before a missing output envelope surfaces as a
 * hard error (PRD §4.5.1 "Format-Nudge Recovery").
 *
 * @remarks
 * Bounds the three format-nudge recovery loops, each of which re-prompts the SAME agent
 * with a format reminder when its output is a transport/contract miss (no parseable
 * envelope / unwritten file / non-conforming backlog) rather than a code or planning
 * problem:
 * - Coder result-envelope miss — {@link PRPExecutor} (`src/agents/prp-executor.ts`)
 * - Researcher PRP-file-write miss — {@link PRPGenerator.#nudgeResearcherToWrite}
 *   (`src/agents/prp-generator.ts`)
 * - Architect backlog-schema miss — {@link FixCycleWorkflow} (`src/workflows/fix-cycle-workflow.ts`)
 *
 * **Budget isolation (§4.5.1 #4):** format nudges are a SEPARATE budget from the
 * validation `maxFixAttempts` (fix-and-retry), from `ISSUE_RETRY_MAX` (§4.5 re-planning),
 * and from `COMMIT_RETRY_MAX` (§5.1). A format nudge neither consumes nor resets any of them.
 *
 * **Not configurable.** This is an INTERNAL constant with a fixed default of 2. It is
 * intentionally NOT exposed as an environment variable or a `.hack` TOML key (§4.5.1 gives
 * it a fixed default; no env var is documented for it). Do not add an env reader here.
 *
 * @example
 * ```ts
 * import { FORMAT_NUDGE_MAX } from './config/constants.js';
 *
 * console.log(FORMAT_NUDGE_MAX); // 2
 * ```
 */
export const FORMAT_NUDGE_MAX = 2;
```

**`src/agents/prp-executor.ts`** — ADD import + replace the bound:
```ts
// ADD (before the '../core/checkpoint-manager.js' import, ~line 32, grouped with '../' imports):
import { FORMAT_NUDGE_MAX } from '../config/constants.js';

// REPLACE (~line 356):
const maxFormatNudges = FORMAT_NUDGE_MAX;   // was: const maxFormatNudges = 2;
```
(`maxFormatNudges` is read unchanged at the loop condition, the WARN fields, and the
`#nudgeForFormat` arg — only the initializer changes.)

**`src/agents/prp-generator.ts`** — ADD import + change the default param:
```ts
// ADD (before the '../core/models.js' import, ~line 28):
import { FORMAT_NUDGE_MAX } from '../config/constants.js';

// REPLACE the default param inside #nudgeResearcherToWrite (~line 822):
async #nudgeResearcherToWrite(
  task: { id: string },
  prpOutputPath: string,
  maxNudges = FORMAT_NUDGE_MAX   // was: maxNudges = 2
): Promise<unknown> {
```
(The caller at `generate()` line 762 does not pass `maxNudges`, so the default applies.)

**`src/workflows/fix-cycle-workflow.ts`** — EDIT the existing line-43 import + replace the bound:
```ts
// EDIT line 43 (add FORMAT_NUDGE_MAX, alphabetical within braces — F before P):
import {
  FORMAT_NUDGE_MAX,
  PARALLEL_RESEARCH,
  RESEARCH_DEPTH,
} from '../config/constants.js';

// REPLACE (line 373):
const maxNudge = FORMAT_NUDGE_MAX;   // was: const maxNudge = 2;
```

**`(optional) tests/unit/config/constants.test.ts`** — one-line value lock:
```ts
import { FORMAT_NUDGE_MAX, /* …existing… */ } from '../../../src/config/constants.js';
// …inside the appropriate describe / alongside the other const locks:
it('SHOULD lock FORMAT_NUDGE_MAX at the §4.5.1 default of 2', () => {
  expect(FORMAT_NUDGE_MAX).toBe(2);
});
```

### Success Criteria
- [ ] `FORMAT_NUDGE_MAX` exported from `src/config/constants.ts` (value `2`) with the §4.5.1 JSDoc.
- [ ] `rg "maxFormatNudges = 2|maxNudges = 2|maxNudge = 2" src/` → **empty** (all three wired to the constant).
- [ ] `rg -n "FORMAT_NUDGE_MAX" src/` → 1 definition + 3 usages (prp-executor, prp-generator, fix-cycle-workflow).
- [ ] No behavioral change: the three variants still cap at 2; their existing tests pass unmodified.
- [ ] `npm run typecheck && npm run lint && npm run format:check` clean; 100% coverage on `constants.ts` maintained.
- [ ] S1 edits ONLY constants.ts + prp-executor.ts + prp-generator.ts + fix-cycle-workflow.ts (+ optional constants.test.ts).

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_
**Yes.** The exact before/after of all four edits is given (§"Technical requirements"),
with file:line anchors verified by direct read. The three call sites' full loop semantics
are shown (so the executor sees the value flows unchanged). The constants.ts placement is
pinpointed (after `getIssueRetryMax()` line 427, before COMMIT_RETRY_MAX JSDoc line 429 —
the §4.5 Resilience cluster). The import situation is verified per-file (two need a NEW
line; fix-cycle-workflow ADDS to its existing line-43 import, alphabetical). The
"intentionally not env-configurable" decision is justified against §4.5.1 + P3.M1.T1.S2.
The parallel item (P1.M4.T3.S1) is confirmed file-disjoint (prompt-text only). And the
zero-behavioral-change guarantee is proven (value stays 2; tests assert behavior not literals).

### Documentation & References
```yaml
# MUST READ — the PRD spec this implements
- docfile: PRD.md
  section: "4.5.1 Format-Nudge Recovery (Missing Result Envelope)" (h4.0)
  why: Defines FORMAT_NUDGE_MAX (default 2), the three variants (Coder envelope / Researcher PRP-write /
        Architect backlog), budget isolation (#4), and terminal behavior (#5). The JSDoc cites this.

# MUST READ — this subtask's research (exact call sites + placement + import map + S1/S2 boundary)
- docfile: plan/015_459c7d9be558/P2M1T1S1/research/format-nudge-max-constant.md
  section: "1. The three inlined call sites", "3. constants.ts placement + JSDoc precedent",
           "4. Imports", "6. Tests", "7. S1 vs S2 boundary", "8. Exact edit anchors"
  why: Verified file:line + exact text for each site; WHY it's a plain const (not env-configurable); the
        per-file import situation (2 new lines + 1 in-place add); the optional value-lock; the line drift
        note (analysis said 357/821, current file 356/822 — use exact-text anchors).

# MUST READ — the cited analysis (confirms the 3 inlined sites + budget isolation)
- docfile: plan/015_459c7d9be558/architecture/format-nudge-analysis.md
  section: "1.3 In-place nudge loop", "2.2 #nudgeResearcherToWrite", "3.3 Validate-nudge loop",
           "4. FORMAT_NUDGE_MAX in config/constants.ts", "1.6/2.4/3.6 Budget isolation"
  why: Confirms FORMAT_NUDGE_MAX is absent; the 3 inlined `= 2` sites; that each variant is already
        structurally budget-isolated (so S1 changes ONLY the bound, not isolation logic — that's S2).

# THE FILES TO EDIT — exact current state + edit anchors
- file: src/config/constants.ts
  why: ADD FORMAT_NUDGE_MAX + JSDoc after getIssueRetryMax() (line 427), before COMMIT_RETRY_MAX JSDoc (429).
  pattern: "export const DEFAULT_ISSUE_RETRY_MAX = 3;" (line 407) — the numeric-const precedent; but FORMAT_NUDGE_MAX
           is a PLAIN const (no DEFAULT_* / no getter) since it's not env-configurable.
  gotcha: Place it in the §4.5 Resilience cluster (its semantic home — §4.5.1 #4 ties it to ISSUE_RETRY_MAX). Do NOT
          add an env-name const or getFormatNudgeMax() reader — §4.5.1 intentionally omits an env knob.

- file: src/agents/prp-executor.ts
  why: ADD import (before '../core/checkpoint-manager.js' ~line 32); replace `const maxFormatNudges = 2;` (~356).
  pattern: "const maxFormatNudges = 2;  while (coderResult.formatFailure === true && formatNudges < maxFormatNudges) {"
  gotcha: maxFormatNudges is read at 3 sub-points (condition, WARN fields, #nudgeForFormat arg) — only the `= 2`
          initializer becomes `= FORMAT_NUDGE_MAX`. Leave the rest of the loop byte-identical.

- file: src/agents/prp-generator.ts
  why: ADD import (before '../core/models.js' ~line 28); change default param `maxNudges = 2` (~822) → `= FORMAT_NUDGE_MAX`.
  pattern: "async #nudgeResearcherToWrite(task: { id: string }, prpOutputPath: string, maxNudges = 2): Promise<unknown> {"
  gotcha: maxNudges is a DEFAULT PARAMETER (not a local const). The caller (generate() line 762) does not pass it, so
          the default applies. Change ONLY the default value. maxNudges is read in the loop + WARN + the error message.

- file: src/workflows/fix-cycle-workflow.ts
  why: ADD FORMAT_NUDGE_MAX to the EXISTING line-43 import ({ PARALLEL_RESEARCH, RESEARCH_DEPTH }); replace
        `const maxNudge = 2;` (373).
  pattern: "import { PARALLEL_RESEARCH, RESEARCH_DEPTH } from '../config/constants.js';"  → add FORMAT_NUDGE_MAX (alphabetical, F before P)
  gotcha: This file ALREADY imports from constants — do NOT add a second import line; EDIT line 43 in place.

# PATTERN FILE — const-lock test convention (for the optional value lock)
- file: tests/unit/config/constants.test.ts
  why: Mirrors the lock-every-const convention (MODEL_NAMES, MODEL_ENV_VARS, ISSUE_RETRY_MAX values are all locked).
        A one-line `expect(FORMAT_NUDGE_MAX).toBe(2)` fits the existing describe blocks.
  pattern: "it('SHOULD ...', () => { expect(SOME_CONST).toBe(value) })"

# CONTRACT — sibling (do NOT duplicate; S1 is the constant, S2 is the confirmation)
- docfile: plan/015_459c7d9be558/tasks.json (P2.M1.T1.S2 title)
  why: S2 = "Confirm budget isolation + consistent WARN logging + JSDoc completion". S1 only adds the constant +
        wires the 3 sites. S2 verifies isolation/logging and completes nudge-method JSDoc. Do NOT touch logging or
        isolation logic here.

# PARALLEL ITEM — confirmed disjoint (no coordination needed)
- docfile: plan/015_459c7d9be558/P1M4T3S1/PRP.md
  why: P1.M4.T3.S1 edits ONLY src/agents/prompts.ts + PROMPTS.md (prompt text). Zero overlap with S1's 4 files.
```

### Current Codebase tree (relevant slice)
```bash
src/config/constants.ts                       # EDIT — +FORMAT_NUDGE_MAX const + JSDoc (after getIssueRetryMax, ~427)
src/agents/prp-executor.ts                    # EDIT — +import; maxFormatNudges = FORMAT_NUDGE_MAX (~356)
src/agents/prp-generator.ts                   # EDIT — +import; maxNudges default param = FORMAT_NUDGE_MAX (~822)
src/workflows/fix-cycle-workflow.ts           # EDIT — +FORMAT_NUDGE_MAX to line-43 import; maxNudge = FORMAT_NUDGE_MAX (373)
tests/unit/config/constants.test.ts           # (optional) EDIT — +expect(FORMAT_NUDGE_MAX).toBe(2)
```

### Desired Codebase tree with files to be added/edited
```bash
src/config/constants.ts                       # MODIFIED (+FORMAT_NUDGE_MAX + JSDoc)
src/agents/prp-executor.ts                    # MODIFIED (+import; bound wired)
src/agents/prp-generator.ts                   # MODIFIED (+import; default param wired)
src/workflows/fix-cycle-workflow.ts           # MODIFIED (line-43 import; bound wired)
tests/unit/config/constants.test.ts           # (optional) MODIFIED (+value lock)
```

### Known Gotchas of our codebase & Library Quirks
```ts
// CRITICAL — ZERO behavioral change. The value stays 2 at all three sites. This is a rename-of-a-literal, not a
//   tuning. Do NOT change any loop condition, WARN field, or error message — only the `= 2` → `= FORMAT_NUDGE_MAX`.

// CRITICAL — FORMAT_NUDGE_MAX is NOT env-configurable. §4.5.1 gives it a fixed default; P3.M1.T1.S2 confirms "no
//   .hack schema row". Export a PLAIN `export const FORMAT_NUDGE_MAX = 2;` — do NOT add an env-name const, a
//   DEFAULT_*, or a getFormatNudgeMax() reader (contrast ISSUE_RETRY_MAX's 3-part pattern at 392/407/422).

// GOTCHA — fix-cycle-workflow.ts ALREADY imports from '../config/constants.js' (line 43: { PARALLEL_RESEARCH,
//   RESEARCH_DEPTH }). EDIT that line in place (add FORMAT_NUDGE_MAX, alphabetical F-before-P). Do NOT add a
//   second import line. prp-executor.ts and prp-generator.ts do NOT yet import constants — they get a NEW line.

// GOTCHA — prp-generator.ts's bound is a DEFAULT PARAMETER (`maxNudges = 2`), not a local const. Change the default
//   value only; the caller (generate() line 762) doesn't pass it, so the default applies unchanged.

// GOTCHA — line drift: the format-nudge-analysis.md cites lines 357 / 821, but the current file has the bound at
//   356 / 822. Use the EXACT TEXT as the edit anchor (`const maxFormatNudges = 2;` / `maxNudges = 2` /
//   `const maxNudge = 2;`), not the line number. fix-cycle-workflow.ts:373 matches exactly.

// GOTCHA — place FORMAT_NUDGE_MAX in the §4.5 Resilience cluster (after getIssueRetryMax, line 427), NOT among the
//   commit/classifier/validation constants. §4.5.1 #4 explicitly ties it to ISSUE_RETRY_MAX as a sibling budget.

// GOTCHA — 100% coverage is globally enforced. The new `export const FORMAT_NUDGE_MAX = 2;` is covered by USAGE
//   (module load via constants.test.ts + the 3 workflow test suites). No dedicated test is REQUIRED for coverage;
//   the optional value-lock is for intent-documentation, matching the lock-every-const convention.

// GOTCHA — prettier is ERROR-enforced (format:check). The multi-line import in fix-cycle-workflow.ts (if it was
//   single-line, prettier may reflow to multi-line once a 3rd symbol is added) — run `npm run fix` to normalize.
```

---

## Implementation Blueprint

### Data models and structure
No new data models. `FORMAT_NUDGE_MAX` is a plain `number` const (`2`). The three loop
variables (`maxFormatNudges` / `maxNudges` / `maxNudge`) keep their existing local types
(`number`) — they're now initialized from the constant instead of a literal.

### Implementation Tasks (ordered by dependencies)
```yaml
Task 1: EDIT src/config/constants.ts — add FORMAT_NUDGE_MAX + JSDoc
  - INSERT (after the `}` closing getIssueRetryMax() at line 427, before the COMMIT_RETRY_MAX JSDoc `/**` at 429)
    the `FORMAT_NUDGE_MAX` const + the verbatim JSDoc from "Technical requirements" (cites §4.5.1; names the 3
    variants; states budget isolation; explicitly notes NOT env/.hack-configurable).
  - VALUE: `export const FORMAT_NUDGE_MAX = 2;`  (plain const; NO env name / DEFAULT_* / getter).
  - DO NOT add an env reader or a .hack schema row.
  - EXPECTED: typecheck clean; the const is exported and importable.

Task 2: EDIT src/agents/prp-executor.ts — import + wire the Coder-envelope bound
  - ADD import: `import { FORMAT_NUDGE_MAX } from '../config/constants.js';` (before the '../core/checkpoint-manager.js'
    import at ~line 32, grouped with the '../' imports; '../config' < '../core').
  - REPLACE `const maxFormatNudges = 2;` (~356) → `const maxFormatNudges = FORMAT_NUDGE_MAX;`.
  - LEAVE the rest of the nudge loop byte-identical (condition, WARN fields, #nudgeForFormat arg all read maxFormatNudges).
  - EXPECTED: typecheck clean; behavior unchanged (still caps at 2).

Task 3: EDIT src/agents/prp-generator.ts — import + wire the Researcher default param
  - ADD import: `import { FORMAT_NUDGE_MAX } from '../config/constants.js';` (before the '../core/models.js' import
    at ~line 28).
  - CHANGE the default param in #nudgeResearcherToWrite (~822): `maxNudges = 2` → `maxNudges = FORMAT_NUDGE_MAX`.
  - LEAVE the loop body, WARN, and the `after ${maxNudges} write-nudge(s)` error message unchanged.
  - EXPECTED: typecheck clean; the caller (generate() line 762) still gets the default (now 2 via the constant).

Task 4: EDIT src/workflows/fix-cycle-workflow.ts — extend existing import + wire the Architect bound
  - EDIT line 43: add FORMAT_NUDGE_MAX to the existing import (alphabetical, F before P):
        import { FORMAT_NUDGE_MAX, PARALLEL_RESEARCH, RESEARCH_DEPTH } from '../config/constants.js';
    (If prettier reflows it to multi-line, let `npm run fix` handle it.)
  - REPLACE `const maxNudge = 2;` (373) → `const maxNudge = FORMAT_NUDGE_MAX;`.
  - LEAVE the loop condition + WARN template (`nudge ${attempt}/${maxNudge}`) unchanged.
  - EXPECTED: typecheck clean; behavior unchanged.

Task 5 (OPTIONAL): EDIT tests/unit/config/constants.test.ts — value lock
  - ADD FORMAT_NUDGE_MAX to the existing import from '../../../src/config/constants.js'.
  - ADD one it(): `expect(FORMAT_NUDGE_MAX).toBe(2);` (mirrors the lock-every-const convention).
  - This is OPTIONAL (coverage is satisfied by usage); include it for intent-documentation.
  - EXPECTED: green; documents the "intentionally 2, not configurable" invariant.

Task 6: FORMAT + VERIFY
  - RUN: npm run fix → npm run typecheck → npm run lint → npm run format:check.  (MUST be clean.)
  - RUN: rg "maxFormatNudges = 2|maxNudges = 2|maxNudge = 2" src/   (EXPECTED: empty — all wired.)
  - RUN: rg -n "FORMAT_NUDGE_MAX" src/   (EXPECTED: 1 def in constants.ts + 3 usages.)
  - RUN: npx vitest run tests/unit/config/constants.test.ts tests/unit/agents/prp-executor.test.ts
              tests/unit/agents/prp-generator.test.ts tests/unit/workflows/fix-cycle-workflow.test.ts
        (EXPECTED: all GREEN, unchanged — zero behavioral change. If a test fails, you accidentally changed loop
        semantics — re-check that ONLY the `= 2` initializer / default changed.)
  - EXPECTED: all clean; no literal nudge bound remains; behavior tests pass unmodified.
```

### Implementation Patterns & Key Details
```ts
// ---- src/config/constants.ts: the plain const (NO env reader — intentionally not configurable) ----
/** …JSDoc citing §4.5.1, naming the 3 variants, budget isolation, "not env/.hack-configurable"… */
export const FORMAT_NUDGE_MAX = 2;

// ---- src/agents/prp-executor.ts: local const initialized from the constant ----
import { FORMAT_NUDGE_MAX } from '../config/constants.js';
// …
const maxFormatNudges = FORMAT_NUDGE_MAX;   // was: 2

// ---- src/agents/prp-generator.ts: default parameter initialized from the constant ----
import { FORMAT_NUDGE_MAX } from '../config/constants.js';
// …
async #nudgeResearcherToWrite(task: { id: string }, prpOutputPath: string, maxNudges = FORMAT_NUDGE_MAX): Promise<unknown> { … }

// ---- src/workflows/fix-cycle-workflow.ts: extend the EXISTING import + local const ----
import { FORMAT_NUDGE_MAX, PARALLEL_RESEARCH, RESEARCH_DEPTH } from '../config/constants.js';
// …
const maxNudge = FORMAT_NUDGE_MAX;   // was: 2
```

### Integration Points
```yaml
CONSTANT (src/config/constants.ts):
  - +FORMAT_NUDGE_MAX = 2 (plain const, no env reader) in the §4.5 Resilience cluster (after getIssueRetryMax).

CONSUMERS (3 wirings; zero behavioral change):
  - prp-executor.ts: maxFormatNudges = FORMAT_NUDGE_MAX (Coder envelope variant)
  - prp-generator.ts: #nudgeResearcherToWrite default param maxNudges = FORMAT_NUDGE_MAX (Researcher variant)
  - fix-cycle-workflow.ts: maxNudge = FORMAT_NUDGE_MAX (Architect backlog-schema variant)

NO CHANGES TO (hard boundary):
  - loop conditions, WARN fields, error messages (only the `= 2` initializer/default changes)
  - budget-isolation logic (already structurally isolated — S2 confirms)
  - WARN logging consistency / nudge-method JSDoc (S2)
  - env / .hack configurability (intentionally NONE — §4.5.1)
  - any docs/*.md (Mode A = JSDoc only)
  - src/agents/prompts.ts / PROMPTS.md (parallel P1.M4.T3.S1 — disjoint)
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
npm run fix            # lint:fix + prettier --write (may reflow fix-cycle's now-3-symbol import to multi-line)
npm run typecheck      # tsc --noEmit -p tsconfig.build.json — MUST be clean (imports resolve; const typed number)
npm run lint           # eslint . --ext .ts
npm run format:check   # prettier --check
# Expected: all clean. Likely failure: a prettier import-reflow in fix-cycle-workflow.ts — `npm run fix` handles it.
```

### Level 2: Unit Tests (Component Validation)
```bash
# The constant + the three wired variants — all must stay GREEN (zero behavioral change):
npx vitest run tests/unit/config/constants.test.ts tests/unit/agents/prp-executor.test.ts \
              tests/unit/agents/prp-generator.test.ts tests/unit/workflows/fix-cycle-workflow.test.ts
# Expected: GREEN, unchanged from baseline. If any test FAILS, you accidentally changed loop semantics — re-check
#   that ONLY the `= 2` initializer (prp-executor/fix-cycle) or default param (prp-generator) changed, nothing else.
# (No NEW test is required for coverage — the const is covered by module-load usage. The optional value-lock is in
#   constants.test.ts if you added Task 5.)
```

### Level 3: Integration / Regression (System Validation)
```bash
# Confirm the refactor is complete — no literal nudge bound remains:
rg "maxFormatNudges = 2|maxNudges = 2|maxNudge = 2" src/    # MUST be empty.
# Confirm exactly 1 definition + 3 usages:
rg -n "FORMAT_NUDGE_MAX" src/                                # 1 in constants.ts + 3 usages.
# Confirm scope discipline (only the 4 src files touched):
git status --short src/   # Expect: M constants.ts, M prp-executor.ts, M prp-generator.ts, M fix-cycle-workflow.ts.
# Confirm no prompt/docs files touched (parallel P1.M4.T3.S1 owns those):
git status --short src/agents/prompts.ts PROMPTS.md docs/    # Expect: empty (disjoint).
# Expected: no literal bound remains; 1 def + 3 usages; only the 4 src files modified.
```

### Level 4: Creative & Domain-Specific Validation
```bash
# No MCP/DB/HTTP. Domain checks (record in commit message):
#   1. Single source of truth — FORMAT_NUDGE_MAX is the ONLY place the bound lives; the 3 variants all reference it.
#      Proof: `rg -n "FORMAT_NUDGE_MAX" src/` → 1 def + 3 usages; `rg "maxFormatNudges = 2|maxNudges = 2|maxNudge = 2" src/` → empty.
#   2. Zero behavioral change — every variant still caps at 2. Proof: the three variant test suites are GREEN, unmodified.
#   3. Not configurable — no env reader, no .hack row. Proof: `rg -i "format.?nudge" src/config/constants.ts` shows ONLY the
#      plain const (no getFormatNudgeMax / no FORMAT_NUDGE_MAX env-name string used in process.env).
#   4. Budget isolation intact — the nudge loops still use their own local counter; S2 will formally confirm.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` clean; `npm run lint` clean; `npm run format:check` clean.
- [ ] `rg "maxFormatNudges = 2|maxNudges = 2|maxNudge = 2" src/` is **empty**.
- [ ] `rg -n "FORMAT_NUDGE_MAX" src/` shows 1 definition + 3 usages.
- [ ] The three variant test suites (`prp-executor`, `prp-generator`, `fix-cycle-workflow`) are GREEN, unchanged.

### Feature Validation
- [ ] `FORMAT_NUDGE_MAX` exported from `constants.ts` with value `2` and the §4.5.1 JSDoc.
- [ ] prp-executor.ts: `maxFormatNudges = FORMAT_NUDGE_MAX`.
- [ ] prp-generator.ts: `#nudgeResearcherToWrite` default param `maxNudges = FORMAT_NUDGE_MAX`.
- [ ] fix-cycle-workflow.ts: line-43 import extended; `maxNudge = FORMAT_NUDGE_MAX`.
- [ ] Zero behavioral change (value still 2); no loop condition / WARN / error message altered.

### Code Quality Validation
- [ ] Plain `export const FORMAT_NUDGE_MAX = 2;` (NO env reader / DEFAULT_* / getter — intentionally not configurable).
- [ ] fix-cycle-workflow.ts import EDITED in place (line 43), not duplicated.
- [ ] prp-executor.ts / prp-generator.ts get a NEW import line grouped with their '../' imports.
- [ ] FORMAT_NUDGE_MAX placed in the §4.5 Resilience cluster (after getIssueRetryMax), not among commit/validation consts.
- [ ] Mode-A JSDoc cites §4.5.1 + names the 3 variants + states budget isolation + "not env/.hack-configurable".

### Documentation & Deployment
- [ ] Mode-A JSDoc is the only doc artifact (rides with the code).
- [ ] No `docs/*.md`, README, `.env.example`, `.hack` schema, or `src/agents/prompts.ts` / `PROMPTS.md` changes.
- [ ] Commit message notes: pure refactor (zero behavior change); FORMAT_NUDGE_MAX is the single source; intentionally
      not env/.hack-configurable (§4.5.1); S2 owns budget-isolation/logging confirmation.

---

## Anti-Patterns to Avoid

- ❌ Don't change the value or any loop semantics — this is a literal→constant rename. The bound stays 2; loop
      conditions, WARN fields, and error messages are byte-identical. Only the `= 2` initializer/default changes.
- ❌ Don't add an env reader / `DEFAULT_FORMAT_NUDGE_MAX` / `getFormatNudgeMax()` / a `.hack` schema row — §4.5.1
      intentionally makes this a fixed internal constant. It's a plain `export const FORMAT_NUDGE_MAX = 2;`.
- ❌ Don't add a SECOND import line in fix-cycle-workflow.ts — it already imports `{ PARALLEL_RESEARCH, RESEARCH_DEPTH }`
      from constants (line 43). EDIT that line to add FORMAT_NUDGE_MAX (alphabetical, F before P).
- ❌ Don't treat prp-generator.ts's bound as a local const — it's a DEFAULT PARAMETER (`maxNudges = 2`). Change the
      default value only; the caller doesn't pass it.
- ❌ Don't rely on the line numbers from the analysis (357/821) — the current file has 356/822. Use the EXACT TEXT
      (`const maxFormatNudges = 2;` / `maxNudges = 2` / `const maxNudge = 2;`) as the edit anchor.
- ❌ Don't place FORMAT_NUDGE_MAX among the commit/classifier/validation constants — it belongs in the §4.5 Resilience
      cluster (after getIssueRetryMax), its semantic home per §4.5.1 #4.
- ❌ Don't touch WARN logging or budget-isolation logic — that's S2's "confirm" scope. S1 only swaps the literal for
      the constant.
- ❌ Don't edit `src/agents/prompts.ts` or `PROMPTS.md` — the parallel P1.M4.T3.S1 owns those (disjoint).
- ❌ Don't add a NEW behavior test — none is needed (zero behavior change; coverage satisfied by usage). The optional
      constants.test.ts value-lock is the only test touch, and only if you choose Task 5.
- ❌ Don't edit any `docs/*.md` — Mode A is JSDoc only.

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: This is a small, mechanical, zero-behavioral-change refactor with every fact
verified by direct read. The three call sites are confirmed with exact text + full loop
semantics (so the executor sees the value flows unchanged). The constants.ts placement is
pinpointed (after `getIssueRetryMax()` line 427 — the §4.5 Resilience cluster, its semantic
home). The per-file import situation is verified (two NEW lines for prp-executor/prp-generator;
one IN-PLACE edit to fix-cycle-workflow's existing line-43 import). The "intentionally not
env-configurable" decision is justified against §4.5.1 + the P3 doc task, so the executor
won't "helpfully" add an env reader. The parallel P1.M4.T3.S1 is confirmed file-disjoint
(prompt-text only). The zero-behavioral-change guarantee is proven (value stays 2; the variant
tests assert behavior, not literals, so they pass unmodified). The 100%-coverage gate is
satisfied by usage alone (the const runs at module load). Residual risks are mechanical and
gate-caught: (a) a stray edit to a loop condition/WARN (caught by the variant test suites —
they'd fail if behavior changed); (b) a duplicate import line in fix-cycle-workflow (caught by
lint/typecheck — duplicate import); (c) a prettier import-reflow (auto-fixed via `npm run fix`).
No runtime/network/LLM unknowns — pure constant extraction.