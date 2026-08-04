# PRP — P1.M3.T1.S1: Add `PRP_COMMIT_FORMAT` config getter to `constants.ts`

> Bugfix 002, **BUG-003 (MAJOR) — S1 (config slice)**. PRD §5.1 mandates a `PRP_COMMIT_FORMAT` toggle
> (`task-prefix` default / `plain` opt-out) governing `formatCommitMessage`, but **`PRP_COMMIT_FORMAT`
> has ZERO matches in `src/` today** (verified: `grep -rn 'PRP_COMMIT_FORMAT' src/` → none). This item
> ships the config getter — the prerequisite for S2 (P1.M3.T1.S2), which reworks
> `formatCommitMessage` (`src/utils/git-commit.ts:108`) to drop the forbidden `[PRP Auto]` banner and
> layer on the `<phase>.<milestone>.<task>.<subtask>:` task-prefix. The architecture contract
> (`architecture/bug-003-commit-format.md` → "S1 — config") prescribes the exact exports verbatim;
> this PRP fuses the **`COMMIT_RETRY_MAX` triple structure** (`constants.ts` ~449–483) with the
> **`getValidationAgent` string-getter style** (`constants.ts:740`). Mode A docs ride with the work:
> one new row in `docs/CONFIGURATION.md`.

---

## Goal

**Feature Goal**: Add the `PRP_COMMIT_FORMAT` env-var constant, its `task-prefix` default, the
`PrpCommitFormat` union type, and the `getPrpCommitFormat()` reader to `src/config/constants.ts`,
following the established config-getter conventions, so that S2 (P1.M3.T1.S2) can consume it to gate
the commit-message format per PRD §5.1. The reader is the SINGLE `process.env` read site for this
var — no other code reads it directly (project convention: all `process.env` reads live inside
`constants.ts` getters).

**Deliverable**:
1. **`src/config/constants.ts`** — ADD a new "Commit Message Format (PRP_COMMIT_FORMAT) — PRD §5.1"
   section (4 exported symbols + JSDoc each) immediately AFTER `getCommitRetryDelayCapMs` (line 674)
   and BEFORE the "Validation Control" header (line 676). Verbatim block below.
2. **`tests/unit/config/prp-commit-format.test.ts`** — NEW file mirroring
   `tests/unit/config/commit-retry.test.ts` + `tests/unit/config/validation-config.test.ts` (beforeEach
   env reset, afterEach `vi.unstubAllEnvs()`, `(a)`–`(g)` cases). Covers unset→default, `'plain'`,
   explicit `'task-prefix'`, `'garbage'`→default, `''`→default, whitespace-trim→plain, and
   case-sensitivity.
3. **`docs/CONFIGURATION.md`** — ADD one row for `PRP_COMMIT_FORMAT` to the "Resilience Tuning" table
   (the commit-config block, ~line 158–167) documenting `task-prefix` default / `plain` opt-out per
   PRD §5.1 (Mode A docs ride with the work).

**Success Definition**:
- `getPrpCommitFormat()` returns `'task-prefix'` when `PRP_COMMIT_FORMAT` is unset, empty, or any
  non-`'plain'` value (incl. `'garbage'`, `'TASK-PREFIX'`, `'  '`); returns `'plain'` for `'plain'`
  (and `'  plain  '` after trim).
- All four symbols (`PRP_COMMIT_FORMAT`, `DEFAULT_PRP_COMMIT_FORMAT`, `PrpCommitFormat`,
  `getPrpCommitFormat`) are exported and importable from `'../config/constants.js'` / `'../../../src/config/constants.js'`.
- `getPrpCommitFormat()`'s return type is the narrow `PrpCommitFormat` union (NOT `string`) — S2 can
  exhaustively switch on it.
- Every branch of the getter is covered (100% coverage is globally enforced by `vitest.config.ts`).
- `npm run typecheck && npm run lint && npm run format:check` clean; the new test file is GREEN.
- The CONFIGURATION.md row matches the existing table pattern and cites PRD §5.1.

---

## Why

- **BUG-003 S1: the config toggle is entirely absent.** PRD §5.1 mandates `PRP_COMMIT_FORMAT` as the
  opt-out for the new task-prefix commit format; it is referenced nowhere in `src/` today. Without
  this getter, S2 has nothing to branch on. This item is the non-negotiable prerequisite for the rest
  of P1.M3.T1 (S2 builder, S3 wiring, S4 stagecoach prompt).
- **Single-read-site convention.** The codebase reads `process.env` ONLY inside `constants.ts` getters
  (verified: `COMMIT_RETRY_MAX`, `VALIDATION_AGENT`, `CLASSIFIER_RETRY_MAX`, … all funnel through
  getters). Centralizing `PRP_COMMIT_FORMAT` here preserves that contract and gives S2 a typed,
  defaulted, guarded entry point instead of a raw `process.env` string.
- **Type safety for S2.** Returning the `PrpCommitFormat` union (not `string`) lets S2
  `switch(format) { case 'task-prefix': …; case 'plain': … }` with exhaustiveness checking — a raw
  string would force fragile `=== 'plain'` checks scattered across the consumer.
- **Mode A docs accuracy.** A config var that exists in code but not in `docs/CONFIGURATION.md` is a
  doc gap. The row rides with the work so the var is documented the moment it ships.
- **Scope discipline.** This item touches ONLY `constants.ts` (additive, one new section), the new
  test file, and one CONFIGURATION.md row. It does NOT touch `git-commit.ts` (S2's surface),
  `commit-message-agent.ts` (S4), `task-orchestrator.ts`/`bug-hunt-workflow.ts` (S3 call sites), or
  any existing test file. Disjoint from the parallel P1.M2.T2.S1 (which edits `prp-pipeline.ts`).

---

## What

### User-visible behavior
None directly — this is a config primitive. A user may now set `PRP_COMMIT_FORMAT=plain` in their
environment; S2 (next item) will make `formatCommitMessage` honor it. Today the getter exists and is
tested but has no consumer yet (S2 wires it).

### Technical requirements (exact contract — VERBATIM from architecture/bug-003-commit-format.md §S1)

Add to `src/config/constants.ts` immediately after `getCommitRetryDelayCapMs` (line 674), before the
"Validation Control" header (line 676), under a new banner:
```
// =============================================================================
// Commit Message Format (PRP_COMMIT_FORMAT) — PRD §5.1
// =============================================================================
```

The four exports — each with a full JSDoc block (one-line summary + `@remarks` citing PRD §5.1 +
fenced `@example`; the getter adds `@returns`). Style mirrors `COMMIT_RETRY_MAX`/`DEFAULT_COMMIT_RETRY_MAX`/
`getCommitRetryMax` (the triple structure) and `getValidationAgent` (the string-getter trim-empty guard):

```ts
/**
 * Environment variable name: the commit-message format mode (PRD §5.1 "Commit Message Format
 * (Standardized Task-Prefix)").
 *
 * @remarks
 * The VALUE of this variable (read at runtime via {@link getPrpCommitFormat}) is either
 * `'task-prefix'` (DEFAULT — layer the `<phase>.<milestone>.<task>.<subtask>:` prefix) or
 * `'plain'` (opt-out — emit the message verbatim with no position prefix). This constant is the
 * env-var NAME itself; the VALUE is read + normalized by {@link getPrpCommitFormat}, the SINGLE
 * read site for this var (no other code reads `process.env[PRP_COMMIT_FORMAT]` directly).
 *
 * @example
 * ```ts
 * import { PRP_COMMIT_FORMAT } from './config/constants.js';
 *
 * console.log(PRP_COMMIT_FORMAT); // 'PRP_COMMIT_FORMAT'
 * console.log(process.env[PRP_COMMIT_FORMAT]); // e.g. 'plain'
 * ```
 */
export const PRP_COMMIT_FORMAT = 'PRP_COMMIT_FORMAT';

/**
 * Default commit-message format mode (PRD §5.1).
 *
 * @remarks
 * `'task-prefix'` — the standardized `<phase>.<milestone>.<task>.<subtask>:` prefix is the default.
 * Uses `as const` to preserve the literal type (matches {@link DEFAULT_VALIDATION_AGENT} and
 * {@link DEFAULT_HARNESS}); it is a member of {@link PrpCommitFormat}.
 *
 * @example
 * ```ts
 * import { DEFAULT_PRP_COMMIT_FORMAT } from './config/constants.js';
 *
 * console.log(DEFAULT_PRP_COMMIT_FORMAT); // 'task-prefix'
 * ```
 */
export const DEFAULT_PRP_COMMIT_FORMAT = 'task-prefix' as const;

/**
 * The two supported commit-message format modes (PRD §5.1).
 *
 * @remarks
 * - `'task-prefix'` — layer the position prefix (`<phase>.<milestone>.<task>.<subtask>:`) onto the
 *   commit subject; the DEFAULT.
 * - `'plain'` — opt-out: emit the descriptive message verbatim with no position prefix.
 * Returned by {@link getPrpCommitFormat}; consumed by `formatCommitMessage` (P1.M3.T1.S2).
 */
export type PrpCommitFormat = 'task-prefix' | 'plain';

/**
 * Read the PRP_COMMIT_FORMAT env var (PRD §5.1).
 *
 * @returns `'plain'` when the (trimmed) value is exactly `'plain'`; otherwise
 *          {@link DEFAULT_PRP_COMMIT_FORMAT} (`'task-prefix'`) — including when unset, empty,
 *          whitespace-only, or any unrecognized value.
 *
 * @remarks
 * The trim + unknown→default guard is the string analog of `getValidationAgent`'s empty-string guard:
 * an explicitly-empty value (`PRP_COMMIT_FORMAT=`) or any typo (`'task_prefix'`, `'TASK-PREFIX'`,
 * `'tsk-prefix'`) falls back to the safe default rather than yielding an unrecognized mode. The match
 * is CASE-SENSITIVE — only the exact lowercase `'plain'` opts out (mirrors how `'plain'` is the only
 * opt-out token named in PRD §5.1).
 *
 * @example
 * ```ts
 * import { getPrpCommitFormat } from './config/constants.js';
 *
 * const format = getPrpCommitFormat(); // 'task-prefix' (default)
 * ```
 */
export function getPrpCommitFormat(): PrpCommitFormat {
  const raw = process.env[PRP_COMMIT_FORMAT];
  if (raw === undefined) {
    return DEFAULT_PRP_COMMIT_FORMAT;
  }
  const v = raw.trim();
  return v === 'plain' ? 'plain' : 'task-prefix'; // any unknown/empty value → default task-prefix
}
```

> **Note on multi-line vs the architecture's compact form:** the architecture doc's one-liner
> `if (raw === undefined) return DEFAULT_PRP_COMMIT_FORMAT;` is functionally identical; expanding to
> the braced form matches the surrounding `getValidationAgent` / `getCommitRetryDelayCapMs` style
> (every getter in this file uses braces). Either compiles identically; let `npm run fix` normalize.

### Success Criteria
- [ ] `PRP_COMMIT_FORMAT`, `DEFAULT_PRP_COMMIT_FORMAT` (`as const`), `PrpCommitFormat` (type), and
      `getPrpCommitFormat` are all `export`ed from `src/config/constants.ts`.
- [ ] `getPrpCommitFormat()` returns `'task-prefix'` when the env var is unset.
- [ ] `getPrpCommitFormat()` returns `'plain'` for `'plain'` and `'  plain  '`.
- [ ] `getPrpCommitFormat()` returns `'task-prefix'` for `''`, `'  '`, `'garbage'`, `'task-prefix'`,
      `'TASK-PREFIX'`, `'Plain'`.
- [ ] The getter's return type is `PrpCommitFormat` (narrow union), not `string`.
- [ ] The new section sits between `getCommitRetryDelayCapMs` and the "Validation Control" header.
- [ ] Every branch of the getter (`raw === undefined`; `v === 'plain'` true; `v === 'plain'` false)
      is exercised by tests.
- [ ] `docs/CONFIGURATION.md` has a new `PRP_COMMIT_FORMAT` row in the commit-config (Resilience
      Tuning) table citing PRD §5.1 and the `plain` opt-out.
- [ ] `npm run typecheck && npm run lint && npm run format:check` clean; new test file GREEN.

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_ **Yes** — the
verbatim export block, the exact insertion site (after line 674 / before line 676, verified via
`sed -n '670,685p'`), the JSDoc style (mirrors `getValidationAgent`/`getCommitRetryMax`), the two
sibling test files to copy structure from, the CONFIGURATION.md table row pattern, the npm scripts,
the case-sensitivity quirk, and the 100%-coverage gate. See
`research/constants-and-test-patterns.md` for per-claim evidence.

### Documentation & References
```yaml
# MUST READ — the authoritative architecture spec (S1 block is verbatim-prescribed)
- docfile: plan/008_15504f60a0ef/bugfix/002_86589b7d57d2/architecture/bug-003-commit-format.md
  section: "Fix design → S1 — config (Mode A docs: update docs/CONFIGURATION.md)"
  why: Prescribes the EXACT four exports + the default/opt-out semantics + the Mode A docs requirement.
  critical: The block is specified verbatim — implement it as-is (the @remarks are this PRP's elaboration of it).

# MUST READ — PRD §5.1 (the contract this config realizes)
- file: PRD.md
  section: "5.1 Commit Message Format (Standardized Task-Prefix)"
  why: "PRP_COMMIT_FORMAT=task-prefix (DEFAULT) | PRP_COMMIT_FORMAT=plain (opt-out, no prefix)."
        "When task-prefix selected but commit is not a backlog item → degrade to plain."
        "Toggling affects only newly generated messages; existing history is never rewritten."
  critical: default is task-prefix; plain is the opt-out; ONLY 'plain' is a recognized opt-out token.

# THE FILE TO EDIT + the two patterns this getter fuses
- file: src/config/constants.ts
  why: EDIT — add the 4-export PRP_COMMIT_FORMAT section after getCommitRetryDelayCapMs (line 674).
  pattern_triple: "export const COMMIT_RETRY_MAX = 'COMMIT_RETRY_MAX'; (449) + export const DEFAULT_COMMIT_RETRY_MAX = 5; (~468) + export function getCommitRetryMax(): number {…} (480) — the STRUCTURE to mirror."
  pattern_string_getter: "export function getValidationAgent(): string { const raw = process.env[VALIDATION_AGENT]; if (raw === undefined) { return DEFAULT_VALIDATION_AGENT; } const trimmed = raw.trim(); return trimmed === '' ? DEFAULT_VALIDATION_AGENT : trimmed; } (740) — the trim-empty-guard STYLE to mirror."
  critical: Insert AFTER line 674 (closing `}` of getCommitRetryDelayCapMs), BEFORE line 676 (Validation Control `// ===` header). The `as const` on DEFAULT_PRP_COMMIT_FORMAT is REQUIRED for type-narrowing (getPrpCommitFormat returns PrpCommitFormat, not string).

# THE TEST PATTERNS TO COPY (structure verbatim)
- file: tests/unit/config/validation-config.test.ts
  why: The STRING-getter sibling. Copy its describe/beforeEach(delete process.env.<VAR>)/afterEach(vi.unstubAllEnvs)/(a)-(c) case layout. The (c) empty→default case is the exact analog of the ''→task-prefix case here.
  pattern: "describe('config/constants: getValidationAgent', () => { beforeEach(() => { delete process.env.VALIDATION_AGENT; }); afterEach(() => { vi.unstubAllEnvs(); }); it('(a) returns the default (pizr) when env var is unset', () => { expect(getValidationAgent()).toBe(DEFAULT_VALIDATION_AGENT); }); … })"
- file: tests/unit/config/commit-retry.test.ts
  why: The COMMIT-family sibling (imports COMMIT_RETRY_MAX/DEFAULT_COMMIT_RETRY_MAX/getCommitRetryMax + the delay/cap triple). Copy its import block shape + the (a)-(f) case comments. Confirms a dedicated per-feature test file is the convention (NOT appending to a shared constants.test.ts).

# THE DOCS FILE TO EDIT (Mode A — one table row)
- file: docs/CONFIGURATION.md
  section: "Resilience Tuning" table (~line 150–167 — holds COMMIT_RETRY_MAX/COMMIT_RETRY_DELAY/COMMIT_RETRY_DELAY_CAP/CLASSIFIER_RETRY_MAX)
  why: This is the project's "commit-config block" (architecture doc's term). Add ONE pipe-delimited row for PRP_COMMIT_FORMAT following the existing rows' pattern.
  pattern: "| `COMMIT_RETRY_MAX` | No | `5` | Maximum number of stagecoach commit-message-generation attempts before falling back (total attempts: initial + retries). See PRD §5.1. |"
  critical: Required=`No`; Default=`task-prefix`; Description must cite PRD §5.1 + name the `plain` opt-out. Keep the table column alignment (let `npm run fix`/prettier normalize the pipes).

# CONSUMER CONTRACT (S2 — P1.M3.T1.S2, do NOT implement; just ensure the symbol is exported)
- file: src/utils/git-commit.ts
  why: READ-ONLY here. formatCommitMessage (line 108) is reworked in S2 to import { getPrpCommitFormat } from '../config/constants.js' and branch on the union. This PRP only guarantees the symbol exists + is typed. Do NOT edit git-commit.ts in this item.

# PARALLEL-SIBLING CONTRACT (disjoint — no conflict)
- docfile: plan/008_15504f60a0ef/bugfix/002_86589b7d57d2/P1M2T2S1/PRP.md
  why: In flight in parallel. Edits src/workflows/prp-pipeline.ts + tests/unit/workflows/prp-pipeline.test.ts. This item edits src/config/constants.ts + a NEW test file + docs/CONFIGURATION.md — ZERO file overlap. No merge conflict.
```

### Current Codebase tree (relevant slice)
```bash
src/config/constants.ts                          # EDIT — add PRP_COMMIT_FORMAT section (4 exports + JSDoc)
docs/CONFIGURATION.md                            # EDIT — add one row to the commit-config (Resilience Tuning) table
tests/unit/config/validation-config.test.ts      # READ-ONLY pattern (string-getter test layout)
tests/unit/config/commit-retry.test.ts           # READ-ONLY pattern (commit-family test layout)
tests/unit/config/prp-commit-format.test.ts      # NEW — the test file for this item
src/utils/git-commit.ts                          # READ-ONLY (S2 consumes getPrpCommitFormat; do NOT touch here)
```

### Desired Codebase tree with files to be added/edited
```bash
src/config/constants.ts                          # MODIFIED (one new section: const + default const + type + getter, all exported)
tests/unit/config/prp-commit-format.test.ts      # NEW (7 cases: unset/plain/task-prefix/garbage/empty/whitespace/case)
docs/CONFIGURATION.md                            # MODIFIED (one new row in the Resilience Tuning table)
```

### Known Gotchas of our codebase & Library Quirks
```ts
// CRITICAL — The match is CASE-SENSITIVE. Only the exact lowercase 'plain' opts out. 'Plain',
//   'TASK-PREFIX', 'task_prefix', 'tsk-prefix', etc. all → 'task-prefix' (default). This is BY DESIGN
//   (PRD §5.1 names 'plain' as the sole opt-out token) and is a TESTED behavior (case g), not a bug.
//   Document it in the getter's @remarks so future readers don't "fix" it to toLowerCase().

// CRITICAL — DEFAULT_PRP_COMMIT_FORMAT MUST use `as const`. Without it the type is widened to `string`,
//   and `return DEFAULT_PRP_COMMIT_FORMAT` inside getPrpCommitFormat() (return type PrpCommitFormat)
//   becomes a TYPE ERROR. Mirrors DEFAULT_VALIDATION_AGENT = 'pizr' as const (constants.ts ~725).

// CRITICAL — Insert AFTER line 674 (the closing `}` of getCommitRetryDelayCapMs) and BEFORE line 676
//   (the `// ===` "Validation Control" header). Do NOT drop it inside the Validation Control section —
//   PRP_COMMIT_FORMAT is a COMMIT-family knob (PRD §5.1), grouped with COMMIT_RETRY_*.

// CRITICAL — Every branch must be tested (vitest.config.ts enforces 100% GLOBAL coverage). The getter
//   has 3 branches: (1) raw === undefined; (2) v === 'plain' (true); (3) v === 'plain' (false).
//   Cases (a)/(b,f)/(c,d,e,g) cover them respectively. Missing any → coverage drop → gate failure.

// GOTCHA — `process.env[PRP_COMMIT_FORMAT]` (bracket access by the CONST) is the project convention,
//   NOT `process.env.PRP_COMMIT_FORMAT`. The const IS the env-var name; bracket access keeps them in
//   sync (matches getCommitRetryMax/getValidationAgent). Use process.env[PRP_COMMIT_FORMAT].

// GOTCHA — `vi.stubEnv(VAR, value)` is vitest's env-stubbing helper; pair it with
//   afterEach(vi.unstubAllEnvs()) and beforeEach(delete process.env.PRP_COMMIT_FORMAT). The delete in
//   beforeEach is the authoritative reset (stubEnv leftovers from a prior test would bleed across).
//   Copy this exact harness from validation-config.test.ts.

// GOTCHA — bugfix BUG-004: the FULL `npm run test:run` is PRE-EXISTING-RED (178 failures — P1.M4 scope).
//   Do NOT use it as the gate. Gate = typecheck + lint + format:check + the NEW prp-commit-format.test.ts
//   + the two sibling config tests (validation-config.test.ts, commit-retry.test.ts) as regression.

// GOTCHA — prettier is ERROR-enforced (format:check). The multi-line JSDoc + the table row may reflow;
//   run `npm run fix` (lint:fix + prettier --write) BEFORE format:check. Let the formatter own alignment.

// CRITICAL — DO NOT touch git-commit.ts (S2's surface), commit-message-agent.ts (S4), task-orchestrator.ts
//   or bug-hunt-workflow.ts (S3 call sites), or any existing test file. This item is purely additive in
//   constants.ts + one new test file + one CONFIGURATION.md row.
```

---

## Implementation Blueprint

### Data models and structure
No runtime data models. The only "structure" is the 4-export config triple + a 2-value union type,
specified verbatim above. The type `PrpCommitFormat = 'task-prefix' | 'plain'` is the data model — it
is the exhaustive switch surface S2 will branch on.

### Implementation Tasks (ordered by dependencies — TDD: RED first, then GREEN)
```yaml
Task 1: CREATE tests/unit/config/prp-commit-format.test.ts  (RED — write the failing tests FIRST)
  - COPY the scaffolding from tests/unit/config/validation-config.test.ts: the imports
    (afterEach, beforeEach, describe, expect, it, vi from 'vitest'); the symbol imports
    (PRP_COMMIT_FORMAT, DEFAULT_PRP_COMMIT_FORMAT, getPrpCommitFormat from '../../../src/config/constants.js');
    describe('config/constants: getPrpCommitFormat', …) with beforeEach(() => { delete process.env.PRP_COMMIT_FORMAT; })
    and afterEach(() => { vi.unstubAllEnvs(); }).
  - ADD 7 cases (the (a)-(g) table from research §5):
      (a) unset → DEFAULT_PRP_COMMIT_FORMAT ('task-prefix'): expect(getPrpCommitFormat()).toBe('task-prefix');
      (b) vi.stubEnv(PRP_COMMIT_FORMAT, 'plain') → 'plain';
      (c) vi.stubEnv(PRP_COMMIT_FORMAT, 'task-prefix') → 'task-prefix' (explicit default value honored);
      (d) vi.stubEnv(PRP_COMMIT_FORMAT, 'garbage') → 'task-prefix' (unknown → default; item MOCKING case);
      (e) vi.stubEnv(PRP_COMMIT_FORMAT, '') → 'task-prefix' (empty → default; item MOCKING case);
      (f) vi.stubEnv(PRP_COMMIT_FORMAT, '  plain  ') → 'plain' (trim honored);
      (g) vi.stubEnv(PRP_COMMIT_FORMAT, 'TASK-PREFIX') → 'task-prefix' (case-SENSITIVE — documents the quirk).
  - ADD a type-safety assertion (optional but recommended): import { PrpCommitFormat } as a type and
    assert `const f: PrpCommitFormat = getPrpCommitFormat();` in one case — proves the return is the
    narrow union (a type error here = the getter returns string = the `as const` is missing).
  - EXPECTED NOW: all cases FAIL to compile/run (symbols don't exist yet) → RED.

Task 2: EDIT src/config/constants.ts  (GREEN — add the 4-export section)
  - INSERT (immediately after line 674, the closing `}` of getCommitRetryDelayCapMs, and before the
    blank line + "Validation Control" `// ===` header at 676) the new section banner:
        // =============================================================================
        // Commit Message Format (PRP_COMMIT_FORMAT) — PRD §5.1
        // =============================================================================
    followed by the 4 exports (PRP_COMMIT_FORMAT const, DEFAULT_PRP_COMMIT_FORMAT const with `as const`,
    PrpCommitFormat type, getPrpCommitFormat function) EXACTLY as specified in "Technical requirements"
    above — each with its full JSDoc block.
  - VERIFY placement: `grep -n "Validation Control" src/config/constants.ts` must still show the header
    AFTER the new section (the new section sits between the commit-resilience block and it).
  - DO NOT: read process.env.PRP_COMMIT_FORMAT anywhere but inside getPrpCommitFormat; widen the return
    type to string; drop `as const` on DEFAULT_PRP_COMMIT_FORMAT; make the 'plain' match case-insensitive;
    place the section inside Validation Control; edit any other file.
  - EXPECTED: Task 1's cases turn GREEN; existing constants tests unaffected.

Task 3: EDIT docs/CONFIGURATION.md  (Mode A — document the var)
  - ADD one row to the "Resilience Tuning" table (the commit-config block, ~line 158–167, the rows for
    COMMIT_RETRY_MAX/COMMIT_RETRY_DELAY/COMMIT_RETRY_DELAY_CAP/CLASSIFIER_RETRY_MAX). Place it logically
    near the COMMIT_RETRY_* rows. Row (matching the table's `| <VAR> | No | <default> | <desc> |` pattern):
        | `PRP_COMMIT_FORMAT` | No | `task-prefix` | Commit-message format mode. `task-prefix` (DEFAULT) layers the `<phase>.<milestone>.<task>.<subtask>:` position prefix; `plain` opts out (no prefix). Any other value (including empty) falls back to `task-prefix`. See PRD §5.1. |
  - DO NOT add a new section/heading; DO NOT reorder existing rows. Just append the row in the commit-config
    cluster and let `npm run fix` normalize pipe alignment.
  - EXPECTED: no behavior change; prettier/format clean.

Task 4: FORMAT + VERIFY
  - RUN: npm run fix            → npm run typecheck → npm run lint → npm run format:check.
  - RUN: npx vitest run tests/unit/config/prp-commit-format.test.ts                                  # NEW file → GREEN.
  - RUN: npx vitest run tests/unit/config/validation-config.test.ts tests/unit/config/commit-retry.test.ts  # siblings → GREEN (regression).
  - DO NOT run the full `npm run test:run` (pre-existing red — bugfix BUG-004, P1.M4 scope).
  - EXPECTED: typecheck/lint/format clean; new file GREEN (7 cases); sibling config tests GREEN.
    If typecheck fails on getPrpCommitFormat → DEFAULT_PRP_COMMIT_FORMAT is missing `as const`.
    If a case fails → check the exact stubbed value (case-sensitivity) and that beforeEach deleted the var.
    If coverage drops → a getter branch lacks a test (raw===undefined / v==='plain' true / false).
```

### Implementation Patterns & Key Details
```ts
// ---- src/config/constants.ts: the verbatim section (insert after line 674) ----
// (see "Technical requirements" — the 4 exports + JSDoc, copy verbatim)

// ---- the getter logic in isolation (the contract) ----
export function getPrpCommitFormat(): PrpCommitFormat {
  const raw = process.env[PRP_COMMIT_FORMAT];
  if (raw === undefined) {
    return DEFAULT_PRP_COMMIT_FORMAT; // unset → default task-prefix
  }
  const v = raw.trim();
  return v === 'plain' ? 'plain' : 'task-prefix'; // ONLY exact 'plain' opts out; else default
}

// ---- tests/unit/config/prp-commit-format.test.ts: the test harness (copy from validation-config.test.ts) ----
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PRP_COMMIT_FORMAT,
  PRP_COMMIT_FORMAT,
  getPrpCommitFormat,
} from '../../../src/config/constants.js';

describe('config/constants: getPrpCommitFormat', () => {
  beforeEach(() => {
    delete process.env.PRP_COMMIT_FORMAT;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("(a) returns the default ('task-prefix') when env var is unset", () => {
    expect(getPrpCommitFormat()).toBe(DEFAULT_PRP_COMMIT_FORMAT); // 'task-prefix'
  });
  it("(b) honors 'plain' (the opt-out)", () => {
    vi.stubEnv(PRP_COMMIT_FORMAT, 'plain');
    expect(getPrpCommitFormat()).toBe('plain');
  });
  it("(c) honors an explicit 'task-prefix'", () => {
    vi.stubEnv(PRP_COMMIT_FORMAT, 'task-prefix');
    expect(getPrpCommitFormat()).toBe('task-prefix');
  });
  it("(d) returns default for an unknown value ('garbage')", () => {
    vi.stubEnv(PRP_COMMIT_FORMAT, 'garbage');
    expect(getPrpCommitFormat()).toBe('task-prefix');
  });
  it("(e) returns default for an empty string", () => {
    vi.stubEnv(PRP_COMMIT_FORMAT, '');
    expect(getPrpCommitFormat()).toBe('task-prefix');
  });
  it("(f) trims whitespace before matching ('  plain  ' → 'plain')", () => {
    vi.stubEnv(PRP_COMMIT_FORMAT, '  plain  ');
    expect(getPrpCommitFormat()).toBe('plain');
  });
  it("(g) is case-SENSITIVE ('TASK-PREFIX' → 'task-prefix')", () => {
    vi.stubEnv(PRP_COMMIT_FORMAT, 'TASK-PREFIX');
    expect(getPrpCommitFormat()).toBe('task-prefix');
  });
});

// ---- docs/CONFIGURATION.md: the new row (append in the Resilience Tuning commit-config cluster) ----
// | `PRP_COMMIT_FORMAT` | No | `task-prefix` | Commit-message format mode. `task-prefix` (DEFAULT) layers
//   the `<phase>.<milestone>.<task>.<subtask>:` position prefix; `plain` opts out (no prefix). Any other
//   value (including empty) falls back to `task-prefix`. See PRD §5.1. |
```

### Integration Points
```yaml
CONSTANTS.TS (src/config/constants.ts):
  - +section "Commit Message Format (PRP_COMMIT_FORMAT) — PRD §5.1" (const + default const + type + getter).
  - PLACEMENT: after getCommitRetryDelayCapMs (line 674), before the Validation Control header (line 676).
  - PRESERVE: every existing export/getter; the section banners; the `as const` convention on DEFAULT_* consts.

CONFIGURATION.MD (docs/CONFIGURATION.md):
  - +one row in the "Resilience Tuning" table (the commit-config block).
  - PRESERVE: all existing rows; the section headings; the table column structure.

TEST (tests/unit/config/prp-commit-format.test.ts):
  - NEW file; mirror validation-config.test.ts / commit-retry.test.ts structure.
  - 7 cases (a-g) covering all 3 getter branches + the case-sensitivity quirk.

DOWNSTREAM (S2 — P1.M3.T1.S2, NOT this item):
  - git-commit.ts formatCommitMessage will `import { getPrpCommitFormat, … } from '../config/constants.js'`
    and `switch` on the PrpCommitFormat union. This item guarantees the exported, typed symbol exists.

OUT OF SCOPE (hard boundary):
  - git-commit.ts (S2), commit-message-agent.ts (S4), task-orchestrator.ts / bug-hunt-workflow.ts (S3
    call sites), any existing test file, any source file other than constants.ts. The task-prefix BUILDER
    (parseItemPosition/buildTaskPrefix) is S2's job — do NOT add it here.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
npm run fix            # lint:fix + prettier --write (run first — the JSDoc + table row may reflow)
npm run typecheck      # tsc --noEmit -p tsconfig.build.json — clean
npm run lint           # eslint . --ext .ts — clean
npm run format:check   # prettier --check — clean
# Expected: all clean. Likely failure: a type error if `as const` is missing on DEFAULT_PRP_COMMIT_FORMAT
#   (getPrpCommitFormat returns PrpCommitFormat but DEFAULT_PRP_COMMIT_FORMAT widened to string).
```

### Level 2: Unit Tests (Component Validation)
```bash
# The NEW file — MUST be GREEN (all 7 cases):
npx vitest run tests/unit/config/prp-commit-format.test.ts
# The two sibling config tests as regression (proves this item didn't disturb the file's other exports):
npx vitest run tests/unit/config/validation-config.test.ts tests/unit/config/commit-retry.test.ts
# Expected: all green. If the new file fails → check the exact stubbed value (case-sensitivity) and that
#   beforeEach runs `delete process.env.PRP_COMMIT_FORMAT` (a leftover stub from a prior test would bleed).
#   If coverage drops on constants.ts → a getter branch (raw===undefined / v==='plain' true/false) lacks a test.
# Do NOT run the full `npm run test:run` — pre-existing red (bugfix BUG-004, P1.M4 scope).
```

### Level 3: Integration / Regression (System Validation)
```bash
# Confirm the 4 exports landed + are importable + the placement is correct:
grep -n "export const PRP_COMMIT_FORMAT" src/config/constants.ts            # 1 hit
grep -n "export const DEFAULT_PRP_COMMIT_FORMAT" src/config/constants.ts    # 1 hit
grep -n "export type PrpCommitFormat" src/config/constants.ts               # 1 hit
grep -n "export function getPrpCommitFormat" src/config/constants.ts        # 1 hit
# Placement: the new section sits BETWEEN getCommitRetryDelayCapMs and the Validation Control header:
grep -n "Validation Control" src/config/constants.ts                        # header is AFTER the new section
grep -n "PRP_COMMIT_FORMAT = 'PRP_COMMIT_FORMAT'" src/config/constants.ts   # the const name == value
# Confirm NO stray process.env reads outside constants.ts (single-read-site convention):
grep -rn "PRP_COMMIT_FORMAT" src/ | grep -v "src/config/constants.ts"        # expect ZERO hits (S2 will add the consumer later)
# Build emits dist/ cleanly (proves the exports + type compile):
npx tsc -p tsconfig.build.json
# Confirm the docs row landed:
grep -n "PRP_COMMIT_FORMAT" docs/CONFIGURATION.md                           # 1 hit (the new row)
# Expected: all greps return the expected hit counts; build clean; no stray reads outside constants.ts.
```

### Level 4: Creative & Domain-Specific Validation
```bash
# No MCP/DB/HTTP (a pure config getter). Domain checks (record in commit message):
#   1. Default is 'task-prefix' (PRD §5.1: "PRP_COMMIT_FORMAT=task-prefix (DEFAULT)") — the safe,
#      machine-parseable, history-improving default; 'plain' is the explicit opt-out.
#   2. ONLY exact lowercase 'plain' opts out — every other value (empty, typos, wrong case) → default.
#      This is the protective analog of getValidationAgent's empty-string guard: a typo never yields an
#      unrecognized mode. Case-sensitivity is documented + tested (case g), not a latent bug.
#   3. The return is the NARROW PrpCommitFormat union — S2 can exhaustively switch on it (type safety).
#   4. Single-read-site convention preserved: process.env[PRP_COMMIT_FORMAT] appears ONLY inside
#      getPrpCommitFormat (verified by the Level-3 grep).
#   5. Mode A docs ride with the work: the CONFIGURATION.md row ships in the same changeset.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` clean.
- [ ] `npm run lint` clean.
- [ ] `npm run format:check` clean.
- [ ] `npx vitest run tests/unit/config/prp-commit-format.test.ts` GREEN (7 cases).
- [ ] `npx vitest run tests/unit/config/validation-config.test.ts tests/unit/config/commit-retry.test.ts` GREEN (regression).

### Feature Validation
- [ ] All four symbols (`PRP_COMMIT_FORMAT`, `DEFAULT_PRP_COMMIT_FORMAT`, `PrpCommitFormat`,
      `getPrpCommitFormat`) exported from `src/config/constants.ts`.
- [ ] Unset → `'task-prefix'`; `'plain'` → `'plain'`; `'  plain  '` → `'plain'`.
- [ ] `''` / `'  '` / `'garbage'` / `'task-prefix'` / `'TASK-PREFIX'` / `'Plain'` → `'task-prefix'`.
- [ ] Return type is `PrpCommitFormat` (narrow union), not `string`.
- [ ] New section placed after `getCommitRetryDelayCapMs`, before the "Validation Control" header.
- [ ] `docs/CONFIGURATION.md` has the new `PRP_COMMIT_FORMAT` row citing PRD §5.1 + the `plain` opt-out.

### Code Quality Validation
- [ ] JSDoc on all four exports (summary + `@remarks` citing §5.1 + `@example`; getter adds `@returns`).
- [ ] `DEFAULT_PRP_COMMIT_FORMAT` uses `as const` (type-narrowing preserved).
- [ ] `process.env[PRP_COMMIT_FORMAT]` read ONLY inside `getPrpCommitFormat` (single-read-site convention).
- [ ] Only `src/config/constants.ts` + `tests/unit/config/prp-commit-format.test.ts` + `docs/CONFIGURATION.md` touched.
- [ ] Existing constants exports/getters UNTOUCHED; sibling config tests stay GREEN.
- [ ] Test file mirrors `validation-config.test.ts` / `commit-retry.test.ts` structure verbatim.

### Documentation & Deployment
- [ ] Mode A: the `docs/CONFIGURATION.md` row is the doc artifact (rides with the work).
- [ ] The getter's `@remarks` documents the case-sensitivity + unknown→default guard.
- [ ] Commit message records: BUG-003 S1; the verbatim block source (architecture/bug-003 §S1); the
      `COMMIT_RETRY_MAX`-triple + `getValidationAgent`-style fusion; the case-sensitivity decision;
      the `as const` requirement; the Mode A docs row; the S2 consumer contract (getPrpCommitFormat is
      the single read site S2 will branch on).

---

## Anti-Patterns to Avoid

- ❌ Don't widen the return type to `string`. The getter returns `PrpCommitFormat` so S2 gets an
      exhaustive switch. A `string` return defeats the union's purpose and would force fragile
      `=== 'plain'` checks in the consumer.
- ❌ Don't drop `as const` on `DEFAULT_PRP_COMMIT_FORMAT`. Without it the literal widens to `string`
      and `return DEFAULT_PRP_COMMIT_FORMAT` inside the `PrpCommitFormat`-typed getter is a type error.
      Mirrors `DEFAULT_VALIDATION_AGENT = 'pizr' as const`.
- ❌ Don't make the `'plain'` match case-insensitive (`toLowerCase()`). PRD §5.1 names `'plain'` as the
      sole opt-out token; case-sensitivity is the protective default (typos → task-prefix). It is a
      TESTED, DOCUMENTED behavior (case g), not a bug to "fix".
- ❌ Don't read `process.env.PRP_COMMIT_FORMAT` (dot access) or read it anywhere outside
      `getPrpCommitFormat`. The convention is bracket access via the const (`process.env[PRP_COMMIT_FORMAT]`)
      and a single read site inside `constants.ts`. S2 calls the getter, never the env directly.
- ❌ Don't place the section inside the "Validation Control" block. PRP_COMMIT_FORMAT is a COMMIT-family
      knob (PRD §5.1); it goes after the commit-resilience block (`getCommitRetryDelayCapMs`, line 674),
      before the Validation Control header.
- ❌ Don't append to a shared `constants.test.ts` or to `commit-retry.test.ts`. The convention is a
      dedicated per-feature test file (`prp-commit-format.test.ts`), matching `validation-config.test.ts`
      and `commit-retry.test.ts`.
- ❌ Don't forget the `beforeEach(() => { delete process.env.PRP_COMMIT_FORMAT; })` reset. A `vi.stubEnv`
      leftover from a prior test would bleed across cases and produce flaky, order-dependent failures.
- ❌ Don't run the full `npm run test:run` as the gate — it's pre-existing red (bugfix BUG-004, 178
      failures, P1.M4 scope). Gate = typecheck + lint + format:check + the NEW file + the two sibling
      config tests.
- ❌ Don't edit `git-commit.ts` (S2), `commit-message-agent.ts` (S4), `task-orchestrator.ts` /
      `bug-hunt-workflow.ts` (S3), or add the task-prefix builder (`parseItemPosition`/`buildTaskPrefix`).
      Those are S2/S3/S4 — this item ships ONLY the config getter.
- ❌ Don't add a new `docs/CONFIGURATION.md` heading/section. One row in the existing "Resilience Tuning"
      table (the commit-config block) is the Mode A artifact; the description carries the §5.1 semantics.

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: This is a small, fully-specified, additive config slice. The four exports are prescribed
**verbatim** by the architecture doc (`architecture/bug-003-commit-format.md` §S1); the two patterns to
mirror (`COMMIT_RETRY_MAX` triple, `getValidationAgent` string-getter) are both read and quoted in the
PRP; the exact insertion site is verified against HEAD (`sed -n '670,685p'` → after line 674, before
line 676); the two sibling test files (`validation-config.test.ts`, `commit-retry.test.test.ts`) give
a copy-ready test scaffold; and the CONFIGURATION.md row pattern is quoted. The only non-obvious risks
are all enumerated and mitigated: (a) the `as const` on `DEFAULT_PRP_COMMIT_FORMAT` (required for the
narrow union return — a missing `as const` is a deterministic typecheck failure caught at Level 1);
(b) the case-SENSITIVE `'plain'` match (documented as intended + tested in case g); (c) the
100%-coverage gate (all 3 getter branches covered by cases a/b-f/c-d-e-g); (d) the pre-existing-red
full suite (handled by gating on the targeted files). No runtime/network/LLM unknowns — it's a pure,
synchronous config getter. Residual risks: a prettier reflow of the JSDoc/table (auto-fixed via
`npm run fix`) and ensuring the test's `beforeEach` deletes the env var (copied verbatim from the
sibling). The S2 consumer contract is locked: this item guarantees a typed, exported, defaulted
`getPrpCommitFormat()` that S2 branches on.