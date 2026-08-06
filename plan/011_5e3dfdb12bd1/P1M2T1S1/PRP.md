# PRP — P1.M2.T1.S1: Add pure `isNegatedFileExistenceGate` detector with a unit-test table

> **Subtask** — P1.M2.T1.S1 of PRD §9.9 (Validation Gate Semantics). REQ-G2 runtime layer.
> A zero-dependency **pure predicate** that detects unambiguous negated file/directory-existence
> gate commands so the executor (S2) can neutralize them. **S1 = the function + its unit-test
> table ONLY. Do NOT wire it into the executor — that is P1.M2.T1.S2.**

---

## ⚠️ STOP — READ THIS PRECONDITION BLOCK FIRST ⚠️

The work-item contract's RESEARCH NOTE (authored 2026-08-06) claims the detector file is
absent. **On the current working tree that is no longer true — both files already exist and
the tests are green.** Verified at PRP-authoring time (see
`research/precondition-existing-files.md`):

| Probe (run these FIRST) | Current result | Meaning |
| --- | --- | --- |
| `ls src/agents/gate-semantics.ts tests/unit/agents/gate-semantics.test.ts` | **both exist** | files are present |
| `npx vitest run tests/unit/agents/gate-semantics.test.ts` | **14 passed (14)** | the unit-test table is green |
| `grep -n "isNegatedFileExistenceGate\|gate-semantics" src/agents/prp-executor.ts` | **no matches** | detector NOT yet wired into executor (correct — S2's job) |
| `npx tsc --noEmit -p tsconfig.build.json 2>&1 \| grep -i gate-semantics` | **no errors** | type-clean |

**Therefore Task 1 is a hard precondition gate.** Two outcomes:

- **Branch A — CURRENT TREE (files present, tests green):** S1's deliverable is **already
  complete**. Run the verification commands in Task 4, confirm the contract table (§B.2 of the
  implementation-status) is fully covered (it is — see the coverage table below), confirm the
  executor is untouched, and record the state as verified-complete. **Do NOT rewrite or
  "improve" the existing implementation** — it matches the design and passes. This is a no-op.
- **Branch B — FRESH/ALTERNATE TREE (files absent):** create `src/agents/gate-semantics.ts` and
  `tests/unit/agents/gate-semantics.test.ts` **verbatim** from the "Implementation Patterns"
  section, then run the verification commands in Task 4.

This PRP supplies the verbatim source + test so Branch B can recreate them, and the exact
verification commands so Branch A can confirm completeness. The implementing agent cannot fail
either branch if it follows Task 1's logic.

---

## Goal

**Feature Goal**: Provide an exported, zero-dependency, **pure** predicate
`isNegatedFileExistenceGate(command: string): boolean` that returns `true` ONLY for the
unambiguous negated file/directory-existence gate forms — leading `!` before `test`/`[`
(`! test -f X`, `! [ -e X ]`) and inner `!` inside `test`/`[` (`test ! -f X`, `[ ! -d X ]`) —
and `false` for everything else (negated content, positive checks, ambiguous commands). This is
the detector REQ-G2 (PRD §9.9.2) requires; it is **consumed by S2** to neutralize cached/legacy
non-monotonic gates at execution time.

**Deliverable**:
1. `src/agents/gate-semantics.ts` exporting `isNegatedFileExistenceGate(command: string): boolean`.
2. `tests/unit/agents/gate-semantics.test.ts` with a table-driven `it.each` unit test covering
   the exact behavior table (G2.1 true rows, G2.2 false row, G2.3 ambiguous false rows) plus
   defensive/edge cases.

**Success Definition**:
- `npx vitest run tests/unit/agents/gate-semantics.test.ts` → **all green** (the contract table
  rows return their expected booleans).
- The function is **exported** and **type-clean** (`npm run typecheck` reports no `gate-semantics`
  errors).
- The detector is **pure** (no `process.env`, no I/O, no side effects) and **conservative**
  (G2.3 — ambiguous → `false` → executor runs normally).
- `src/agents/prp-executor.ts` is **untouched** (wiring is S2). `src/core/models.ts` and
  `src/agents/prompts.ts` are untouched.

---

## Why

- **REQ-G2 (PRD §9.9.2) — deterministic neutralization of non-monotonic gates.** PRPs are cached
  and resumed, so PRPs generated before REQ-G1 ships would keep failing on `! test -f X` gates.
  The executor must neutralize them at runtime — but to do so it needs a reliable, conservative
  detector. G2.1 mandates detect+skip; G2.2 narrows scope to *existence* (never *content*); G2.3
  demands conservatism (ambiguous → execute normally).
- **S1 is the pure, testable foundation for S2.** Splitting detector from executor integration
  keeps the detector trivially unit-testable (no mocking of BashMCP / groundswell / the executor)
  and lets S2 import a single green function. A dedicated `gate-semantics.ts` leaf module avoids
  dragging the executor's heavy dependency graph into the test.
- **Why a dedicated module (not a co-located export in prp-executor.ts):** the work item + the
  implementation-status doc (§B.2) both say "either is acceptable," but a zero-dependency leaf
  module is strictly cleaner for a pure function (the test imports only the function; no
  `vi.mock('groundswell')` / BashMCP setup needed). S2 imports it with one line.
- **Scope discipline.** S1 = function + unit test ONLY. Wiring into `#runValidationGates` + the
  neutralization branch + executor integration tests is **S2 (P1.M2.T1.S2)**. REQ-G1 prompt edits
  are **P1.M1.*** (already Complete). Mode-B doc sync is **P1.M3**.

---

## What

### User-visible behavior
None — internal helper. Indirectly (once S2 lands): cached PRPs with legacy `! test -f X` gates
no longer hard-fail; those gates are neutralized (skipped + logged).

### Technical requirements (exact contract — from PRD §9.9.2 G2.1/G2.2/G2.3)

**Signature:** `export function isNegatedFileExistenceGate(command: string): boolean`

**Returns `true` ONLY for** unambiguous negated file/directory-**existence** forms where the
flag is `-f` (regular file), `-e` (exists), or `-d` (directory):
- Leading bang: `! test -f X`, `! [ -e X ]`  (`!` then `test`/`[` then `-[fed]`)
- Inner bang: `test ! -f X`, `[ ! -d X ]`     (`test`/`[` then `!` then `-[fed]`)

**Returns `false` for** (G2.2/G2.3 — conservative default):
- Negated **content** checks: `! grep -q TODO src/x.ts` (G2.2 — executes normally)
- Positive existence/content: `test -f x`, `grep -q foo x`
- Unrelated: `npm test`
- Ambiguous: `test -n foo`, `test foo` (G2.3 — when unsure, execute normally)
- Compound: `test -f x -a ! -f y`; wrapped: `bash -c "! test -f x"`

**Behavior table** (the unit-test contract — every row MUST be asserted):

| command | expected |
| --- | --- |
| `! test -f src/hooks/index.ts` | `true` |
| `test ! -f x` | `true` |
| `! [ -e x ]` | `true` |
| `[ ! -d x ]` | `true` |
| `! grep -q TODO src/x.ts` | `false` |
| `test -f x` | `false` |
| `npm test` | `false` |
| `grep -q foo x` | `false` |
| `test -n foo` (ambiguous) | `false` |

### Success Criteria
- [ ] `src/agents/gate-semantics.ts` exports `isNegatedFileExistenceGate(command: string): boolean`.
- [ ] The unit-test table asserts every row above (true rows → `true`; false rows → `false`).
- [ ] `npx vitest run tests/unit/agents/gate-semantics.test.ts` → all green.
- [ ] `npm run typecheck` reports no errors mentioning `gate-semantics`.
- [ ] The function is pure (no env/I/O/side effects) and conservative (ambiguous → `false`).
- [ ] `src/agents/prp-executor.ts`, `src/core/models.ts`, `src/agents/prompts.ts` untouched.

---

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed to implement
this successfully?_ **Yes** — the precondition gate (Task 1) routes to Branch A (verify, no-op)
or Branch B (create). For Branch B, the verbatim source file and verbatim test file are supplied
in "Implementation Patterns", the regex design is justified row-by-row against the behavior
table, and the verification commands are project-specific and confirmed working. No judgement
calls remain in either branch.

### Documentation & References

```yaml
# MUST READ — the authoritative requirement (REQ-G2) + acceptance (§9.9.3)
- docfile: plan/011_5e3dfdb12bd1/prd_snapshot.md
  section: "#### 9.9.2 Requirements > REQ-G2" and "#### 9.9.3 Acceptance Criteria"
  why: G2.1 (detect+skip negated existence — the leading/inner ! forms on test/[ over -f/-e/-d),
        G2.2 (negated existence only, NEVER negated content), G2.3 (conservative — ambiguous
        executes normally). The exact true/false contract this function encodes.
  critical: >
    G2.3 is the design driver: the detector MUST be conservative. A too-greedy regex would
    silently suppress a legitimate gate. When in doubt, return false.

# MUST READ — exact files, line ranges, the behavior table, and the S1/S2 boundary
- docfile: plan/011_5e3dfdb12bd1/architecture/implementation-status.md
  section: "B. REQ-G2 — runtime layer (executor hardening) > B.2 The pure detector (new, exported)"
  why: Pins the function signature, the recommended placement (dedicated module OR co-located —
        dedicated chosen here), the exact behavior table, and the note that the ValidationGate
        model needs NO schema change. Also documents B.1 (#runValidationGates) as S2's surface.
  critical: >
    S1 must NOT edit prp-executor.ts (#runValidationGates) or src/core/models.ts. The
    neutralization branch + executor integration tests are S2.

# MUST READ — the precondition finding (authored with this PRP)
- docfile: plan/011_5e3dfdb12bd1/P1M2T1S1/research/precondition-existing-files.md
  section: "0. CRITICAL PRECONDITION FINDING"
  why: Documents that on the current tree BOTH files already exist and 14/14 tests pass, that
        the executor is untouched (S1/S2 boundary intact), and the contract-row coverage map.
  critical: >
    On the current tree (Branch A) the task is a verified-complete no-op. Do NOT rewrite the
    passing implementation. Only Branch B (absent files) creates them.

# CONSUMER (downstream — DO NOT EDIT in S1; S2 owns the wiring)
- file: src/agents/prp-executor.ts
  section: "#runValidationGates() (line 518) — manual/null skip block (line 528) + execute_bash (line 548)"
  why: This is where S2 will call isNegatedFileExistenceGate(gate.command) and push a
        skipped:true / success:true result mirroring the manual-skip shape. S1 only needs to
        know the function's name + signature so S2 can import it.
  pattern: "S2 will: if (isNegatedFileExistenceGate(gate.command)) { push skipped result; continue; }"
  gotcha: >
    S1 must NOT add this branch. The grep confirming the executor is untouched is a success
    criterion for S1 (it proves the S1/S2 boundary is respected).

# MODEL (read-only — NO schema change)
- file: src/core/models.ts
  section: "interface ValidationGate (L1271) — already has manual: boolean, command: string | null"
  why: Confirms no model edit is needed. The neutralization is a runtime decision, not a schema
        change. Do NOT edit this file in S1.

# TEST CONVENTION (the it.each pattern to mirror in Branch B)
- file: tests/unit/agents/agent-factory.test.ts
  section: "it.each([...]) table-driven test (~L176)"
  why: Establishes the project's table-driven unit-test idiom (vitest, it.each, ESM .js imports).
  pattern: "it.each<[a, b]>([[...],[...]])('returns %j for %s', (cmd, expected) => { expect(...).toBe(expected); })"
```

### Current Codebase tree (relevant slice)

```bash
src/agents/
├── gate-semantics.ts          # CREATE (Branch B) / VERIFY (Branch A) — the pure detector
├── prp-executor.ts            # READ-ONLY — #runValidationGates (S2 wires the detector here)
└── prompts.ts                 # READ-ONLY — REQ-G1 prompt rules (P1.M1.*, already Complete)
src/core/
└── models.ts                  # READ-ONLY — ValidationGate (no schema change)
tests/unit/agents/
├── gate-semantics.test.ts     # CREATE (Branch B) / VERIFY (Branch A) — the it.each table
├── agent-factory.test.ts      # READ-ONLY — the it.each convention to mirror
└── prp-executor.test.ts       # READ-ONLY (S2's integration tests go here, NOT S1)
```

### Desired Codebase tree with files to be added/edited

```bash
src/agents/
└── gate-semantics.ts          # the pure detector (Branch B creates; Branch A confirms present)
tests/unit/agents/
└── gate-semantics.test.ts     # the table-driven unit test (Branch B creates; Branch A confirms green)
# No other files touched. The executor, model, and prompts are untouched in S1.
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — PRECONDITION. On the current tree BOTH files already exist and 14/14 tests pass.
//   Probe with `ls src/agents/gate-semantics.ts tests/unit/agents/gate-semantics.test.ts` and
//   `npx vitest run tests/unit/agents/gate-semantics.test.ts` BEFORE editing. If present+green
//   (Branch A) → verify + STOP (no-op). If absent (Branch B) → create verbatim per the patterns.

// CRITICAL — be CONSERVATIVE (G2.3). The regexes must match ONLY the unambiguous forms:
//   LEADING: ^\s*!\s+(?:test|\[)\s+-[fed]\b   (a literal `!`, then test|[, then -f/-e/-d)
//   INNER  : ^\s*(?:test|\[)\s+!\s+-[fed]\b   (test|[, then a literal `!`, then -f/-e/-d)
//   - The `-[fed]` class is deliberate: it EXCLUDES string tests (-n/--z) and other primaries.
//   - The leading `\s*` / `\s+` tolerate arbitrary leading/inter-token whitespace.
//   - `\b` after the flag prevents matching `-file` (a non-flag token) as `-f`.
//   DO NOT broaden to `!.*-f` or `test.*!.*-f` — that would false-positive on compound/wrapped
//   commands and silently suppress legitimate gates (violates G2.3).

// GOTCHA — DO NOT wire the detector into prp-executor.ts. That neutralization branch + the
//   executor integration tests are S2 (P1.M2.T1.S2). S1 = function + unit test only. The grep
//   confirming the executor has no `isNegatedFileExistenceGate` reference is a success criterion.

// GOTCHA — DO NOT edit src/core/models.ts. ValidationGate already has manual + command; the
//   neutralization is a runtime decision, not a schema change.

// GOTCHA — use ESM `.js` import paths in the test (project is "type": "module"):
//   import { isNegatedFileExistenceGate } from '../../../src/agents/gate-semantics.js';

// GOTCHA — the function must be PURE. No process.env reads, no filesystem, no logging. The only
//   input is the command string; the only output is a boolean. This is what makes it trivially
//   unit-testable with zero mocking (the whole point of splitting it from the executor).

// GOTCHA — prettier is ERROR-enforced. After any edit (Branch B), run
//   `npx prettier --write src/agents/gate-semantics.ts tests/unit/agents/gate-semantics.test.ts`
//   before `npm run format:check`.
```

---

## Implementation Blueprint

### Data models and structure
None — a pure predicate operating on a `string`. No types/constants/classes beyond the function.
The `ValidationGate` model (`src/core/models.ts`) is **not** modified.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: PRECONDITION PROBE  (MANDATORY FIRST — do not skip)
  - RUN: `ls src/agents/gate-semantics.ts tests/unit/agents/gate-semantics.test.ts 2>&1`
  - RUN: `npx vitest run tests/unit/agents/gate-semantics.test.ts 2>&1 | tail -5`   (if the file exists)
  - RUN: `grep -n "isNegatedFileExistenceGate\|gate-semantics" src/agents/prp-executor.ts` (expect none)
  - BRANCH A (both files exist AND the test run shows all green — CURRENT TREE):
      * S1 is ALREADY COMPLETE. Go to Task 4 (verify + confirm coverage + record no-op). Do NOT
        edit anything. Do NOT "improve" the passing implementation.
  - BRANCH B (either file absent, or the test fails):
      * Go to Task 2 (create the source) → Task 3 (create the test) → Task 4 (verify).
  - PLACEMENT: run from repo root.

Task 2: CREATE src/agents/gate-semantics.ts  (ONLY Branch B)
  - WRITE the file VERBATIM from the "Implementation Patterns > Source module" block below.
  - The module exports ONE function: isNegatedFileExistenceGate(command: string): boolean.
  - Two module-private anchored regexes (LEADING_NEGATED_EXISTENCE, INNER_NEGATED_EXISTENCE).
  - Defensive guard: typeof command !== 'string' || command.trim() === '' → return false.
  - RETURN: LEADING.test(command) || INNER.test(command).
  - DO NOT: import anything (zero-dependency leaf). DO NOT touch prp-executor.ts / models.ts.
  - PLACEMENT: src/agents/gate-semantics.ts (new file).

Task 3: CREATE tests/unit/agents/gate-semantics.test.ts  (ONLY Branch B)
  - WRITE the file VERBATIM from the "Implementation Patterns > Test module" block below.
  - Table-driven it.each covering the FULL behavior table (9 contract rows) PLUS conservative
        edge cases (compound `test -f x -a ! -f y`, wrapped `bash -c "..."`, empty/whitespace,
        whitespace tolerance). ESM .js import. describe/it/expect from 'vitest'.
  - DO NOT: mock anything (the function is pure). DO NOT edit prp-executor.test.ts (S2's surface).
  - PLACEMENT: tests/unit/agents/gate-semantics.test.ts (new file).

Task 4: VERIFY  (run in BOTH branches; in Branch A this confirms the complete state)
  - RUN: `npx prettier --check src/agents/gate-semantics.ts tests/unit/agents/gate-semantics.test.ts`
        (if it fails: `npx prettier --write` on both, then re-check).
  - RUN: `npx eslint src/agents/gate-semantics.ts tests/unit/agents/gate-semantics.test.ts`
  - RUN: `npx vitest run tests/unit/agents/gate-semantics.test.ts`
        EXPECT: all green (≥14 tests; every behavior-table row returns its expected boolean).
  - RUN: `npx tsc --noEmit -p tsconfig.build.json 2>&1 | grep -i gate-semantics || echo "clean"`
        EXPECT: "clean" (no typecheck errors mentioning gate-semantics).
  - RUN (S1/S2 boundary guard): `grep -n "isNegatedFileExistenceGate\|gate-semantics" src/agents/prp-executor.ts`
        EXPECT: no matches (the detector is NOT wired into the executor — S2's job).
  - EXPECTED: Branch A → all checks pass with no edits; record as verified-complete no-op.
              Branch B → the created files pass all checks identically.
  - DO NOT: run the full `npm run validate` / `npm run test:run` as the S1 gate (the broader
        suite has unrelated pre-existing failures). S1's acceptance is the targeted file + the
        typecheck/lint/prettier checks on these two files.
```

### Implementation Patterns & Key Details

```ts
// === SOURCE MODULE — src/agents/gate-semantics.ts (Branch B: create verbatim) ===

/**
 * Gate Semantics — Conservative negated file-existence gate detector
 *
 * @module agents/gate-semantics
 *
 * @remarks
 * Pure predicate that detects the unambiguous negated file/directory-existence
 * gate forms so that `#runValidationGates` can neutralize them at runtime
 * (PRD §9.9.2 REQ-G2).
 *
 * Returns `true` ONLY for:
 *   - Leading bang before `test`/`[`:   `! test -f X`, `! [ -e X ]`
 *   - Inner bang inside `test`/`[`:     `test ! -f X`, `[ ! -d X ]`
 *
 * where the flag is one of the POSIX existence flags: `-f` (regular file),
 * `-e` (exists), `-d` (directory).
 *
 * Returns `false` for everything else (negated content, positive checks,
 * unrelated commands, ambiguous expressions) per G2.2/G2.3 — when unsure,
 * return `false` so the executor runs the gate normally.
 */

// Leading negation: `! test -f X` or `! [ -e X ]`
const LEADING_NEGATED_EXISTENCE = /^\s*!\s+(?:test|\[)\s+-[fed]\b/;

// Inner negation: `test ! -f X` or `[ ! -d X ]`
const INNER_NEGATED_EXISTENCE = /^\s*(?:test|\[)\s+!\s+-[fed]\b/;

/**
 * Returns `true` only for unambiguous negated file/directory-existence gate
 * commands (PRD §9.9.2 G2.1). Returns `false` for negated content checks
 * (G2.2), ambiguous commands, and anything else (G2.3 — conservative default).
 *
 * @param command - The raw shell command string to inspect.
 * @returns `true` if the command is a negated existence gate; `false` otherwise.
 */
export function isNegatedFileExistenceGate(command: string): boolean {
  if (typeof command !== 'string' || command.trim() === '') return false;
  return (
    LEADING_NEGATED_EXISTENCE.test(command) ||
    INNER_NEGATED_EXISTENCE.test(command)
  );
}
```

```ts
// === TEST MODULE — tests/unit/agents/gate-semantics.test.ts (Branch B: create verbatim) ===

import { describe, expect, it } from 'vitest';
import { isNegatedFileExistenceGate } from '../../../src/agents/gate-semantics.js';

describe('agents/gate-semantics — isNegatedFileExistenceGate', () => {
  // EXECUTE + VERIFY — full behavior table (PRD §9.9.2 G2.1/G2.2/G2.3)
  it.each<[command: string, expected: boolean]>([
    // G2.1 — negated existence gates (must return true)
    ['! test -f src/hooks/index.ts', true],
    ['test ! -f x', true],
    ['! [ -e x ]', true],
    ['[ ! -d x ]', true],

    // G2.2 — negated content (must execute normally → false)
    ['! grep -q TODO src/x.ts', false],

    // Positive existence / content / unrelated (→ false)
    ['test -f x', false],
    ['grep -q foo x', false],
    ['npm test', false],

    // G2.3 — ambiguous (conservative → false)
    ['test -n foo', false],
    ['test foo', false],

    // Extra conservative edge cases → false
    ['test -f x -a ! -f y', false], // compound expression
    ['bash -c "! test -f x"', false], // wrapped in bash -c
  ])('returns %j for %s', (command, expected) => {
    expect(isNegatedFileExistenceGate(command)).toBe(expected);
  });

  // EXECUTE + VERIFY — defensive: empty / non-string input
  it('returns false for empty / non-string input (defensive)', () => {
    expect(isNegatedFileExistenceGate('')).toBe(false);
    expect(isNegatedFileExistenceGate('   ')).toBe(false);
  });

  // EXECUTE + VERIFY — whitespace tolerance (regex uses \s+)
  it('tolerates leading/extra whitespace in negated-existence forms', () => {
    expect(isNegatedFileExistenceGate('  test ! -d  x  ')).toBe(true);
  });
});

// PATTERN NOTES (regex justification, for the implementer):
//   LEADING = /^\s*!\s+(?:test|\[)\s+-[fed]\b/
//     - `^\s*` leading whitespace, then literal `!`, then `\s+`, then test or [.
//     - `-[fed]` is exactly -f/-e/-d (NOT -n/-z). `\b` stops `-file` matching as `-f`.
//   INNER = /^\s*(?:test|\[)\s+!\s+-[fed]\b/
//     - test or [, then whitespace, then literal `!`, then the existence flag.
//   Why this is conservative (G2.3): a compound (`test -f x -a ! -f y`) starts with -f (not !)
//     after `test`, so INNER misses it → false. A wrapper (`bash -c '...'`) starts with `bash`
//     → both miss → false. Both correctly execute normally.
```

### Integration Points

```yaml
CONSUMER (downstream — DO NOT edit in S1; S2 owns this):
  - src/agents/prp-executor.ts #runValidationGates (line 518):
      S2 will add, right after the manual/null skip block (line 528) and before the
      execute_bash call (line 548):
        if (isNegatedFileExistenceGate(gate.command)) {
          // push skipped:true / success:true / exitCode:null result (mirrors manual-skip shape)
          // log "non-monotonic negative-existence gate neutralized (§9.9)"
          // continue;  — do NOT call execute_bash
        }
      S1 only guarantees the function exists + is green; S1 does NOT add this branch.

NOT INTEGRATED (do NOT touch in S1):
  - src/core/models.ts (ValidationGate) — no schema change (manual + command already exist).
  - src/agents/prompts.ts — REQ-G1 prompt rules are P1.M1.* (already Complete).
  - tests/unit/agents/prp-executor.test.ts — executor integration tests are S2.
  - No docs (contract DOCS: none — internal helper).
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Format + lint the (only) two files in scope (Branch A: already clean; Branch B: after creating):
npx prettier --check src/agents/gate-semantics.ts tests/unit/agents/gate-semantics.test.ts
npx eslint src/agents/gate-semantics.ts tests/unit/agents/gate-semantics.test.ts
# If prettier fails: npx prettier --write src/agents/gate-semantics.ts tests/unit/agents/gate-semantics.test.ts
# Expected: zero errors.
```

### Level 2: Unit Tests (Component Validation)

```bash
# THE primary acceptance gate for S1 (both branches):
npx vitest run tests/unit/agents/gate-semantics.test.ts
# Expected: Test Files 1 passed (1); all table rows green (≥14 tests).
#   Every behavior-table row returns its expected boolean (true for the 4 negated-existence
#   forms; false for negated content, positive checks, unrelated, and ambiguous).
```

### Level 3: Integration Testing (System Validation)

```bash
# N/A for S1. The detector is NOT wired into the executor (S2's job). The only "integration"
# concern is the S1/S2 boundary guard:
grep -n "isNegatedFileExistenceGate\|gate-semantics" src/agents/prp-executor.ts
# Expected: no matches (confirms S1 did NOT cross into S2's surface).

# Type cleanliness (the function is exported and type-correct):
npx tsc --noEmit -p tsconfig.build.json 2>&1 | grep -i gate-semantics || echo "clean"
# Expected: "clean" (no typecheck errors mentioning gate-semantics).
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Optional — prove the conservatism (G2.3) directly against the regexes (no assertion in the
# test needed; this is a sanity probe for the commit message):
npx tsx -e "import('./src/agents/gate-semantics.js').then(m => { \
  const cases = [['! test -f x',true],['test ! -f x',true],['! grep -q TODO y',false],['test -f x -a ! -f y',false],['npm test',false]]; \
  console.log(cases.map(([c,e]) => m.isNegatedFileExistenceGate(c)===e ? 'OK '+c : 'FAIL '+c).join('\n')); \
});"
# Expected: every line "OK …". Confirms the conservative boundary (compound + content + unrelated → false).
```

---

## Final Validation Checklist

### Technical Validation
- [ ] Task 1 precondition probe executed; Branch A or B recorded.
- [ ] `npx prettier --check src/agents/gate-semantics.ts tests/unit/agents/gate-semantics.test.ts` passes.
- [ ] `npx eslint src/agents/gate-semantics.ts tests/unit/agents/gate-semantics.test.ts` passes.
- [ ] `npx vitest run tests/unit/agents/gate-semantics.test.ts` → all green.
- [ ] `npx tsc --noEmit -p tsconfig.build.json` → no `gate-semantics` errors.

### Feature Validation
- [ ] `src/agents/gate-semantics.ts` exports `isNegatedFileExistenceGate(command: string): boolean`.
- [ ] The unit-test table asserts all 9 contract rows (4 true; 5 false incl. the ambiguous `test -n foo`).
- [ ] Conservative edge cases covered (compound, wrapped, empty/whitespace, whitespace-tolerance).
- [ ] The function is pure (no env/I/O) and conservative (ambiguous → false, G2.3).
- [ ] **Branch A:** no edits; state recorded as verified-complete.
- [ ] **Branch B:** both files created verbatim and pass all checks identically.

### Code Quality Validation
- [ ] Only `src/agents/gate-semantics.ts` (+ test) in scope — executor, model, prompts untouched.
- [ ] `grep -n "isNegatedFileExistenceGate\|gate-semantics" src/agents/prp-executor.ts` → no matches (S1/S2 boundary intact).
- [ ] Zero-dependency leaf module (no imports in gate-semantics.ts).
- [ ] Regexes are conservative (`-[fed]` only; anchored `^`; `\b` after flag) — not broadened.
- [ ] ESM `.js` import path used in the test.

### Documentation & Deployment
- [ ] No docs change (contract DOCS: none — internal helper).
- [ ] Task result states which branch (A/B) was taken + the HEAD sha (so the orchestrator can
      reconcile the "Researching" status vs the already-complete tree).

---

## Anti-Patterns to Avoid

- ❌ Don't skip the Task 1 precondition probe — on the current tree the files already exist and pass (Branch A).
- ❌ Don't rewrite or "improve" the existing passing implementation in Branch A — it matches the design and is green.
- ❌ Don't broaden the regexes (`!.*-f`, `test.*!.*-f`) — that violates G2.3 (conservative) and would silently suppress legitimate gates.
- ❌ Don't wire the detector into `prp-executor.ts` (`#runValidationGates`) — that neutralization branch + integration tests are S2 (P1.M2.T1.S2).
- ❌ Don't edit `src/core/models.ts` (ValidationGate) — no schema change is needed.
- ❌ Don't edit `src/agents/prompts.ts` — REQ-G1 is P1.M1.* (already Complete).
- ❌ Don't put integration tests in `tests/unit/agents/prp-executor.test.ts` — that's S2's surface.
- ❌ Don't run the full `npm run validate` / `npm run test:run` as the S1 gate (unrelated pre-existing failures); S1's acceptance is the targeted file + typecheck/lint/prettier.
- ❌ Don't let prettier fail — run `npx prettier --write` on the two files after any edit (Branch B).

---

## Confidence Score

**Branch A (current tree — files present, 14/14 green): 10/10.** A pure verification no-op: the
function + table-driven test already exist, every behavior-table row is covered and passes, the
detector is correctly not yet wired into the executor, and there are no typecheck/lint errors.
The implementing agent runs the probes, confirms the state, and records it.

**Branch B (fresh tree — files absent): 10/10.** The verbatim source module and verbatim test
module are supplied in "Implementation Patterns"; the regex design is justified row-by-row against
the behavior table; the placement (dedicated zero-dependency leaf module) keeps the test
mock-free; and the verification commands are project-specific and confirmed working. No unknowns.

**Overall note (outside the PRP's control):** the only residual risk is orchestrator-level —
whether the implementation lands on the current tree (Branch A, no-op) or a fresh checkout
(Branch B, create). Either way the implementing agent cannot fail if it follows Task 1's branch
logic. The PRP documents the precondition (the stale "ABSENT" research note) thoroughly so the
"Researching" status can be reconciled against the already-complete tree.