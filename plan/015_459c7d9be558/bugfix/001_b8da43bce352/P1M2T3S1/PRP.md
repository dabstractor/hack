# PRP — P1.M2.T3.S1: Update the Coder-Agent error assertion to the §4.5.1 format-nudge terminal message

---

## Goal

**Feature Goal**: Make the stale integration test `tests/integration/prp-executor-integration.test.ts`
→ `'should handle invalid JSON from Coder Agent'` (line 482) **PASS** by updating its
line-497 assertion from the legacy parse-error text (`'Failed to parse Coder Agent
response'`) to the §4.5.1 format-nudge **terminal** message (`'… did not return a
parseable JSON result envelope after 2 format nudge(s) …'`). The implementation
already behaves per PRD §4.5.1 — only the assertion is stale. **Test-only change,
no `src/` edit.** This is 1 of the 8 stale tests in BUG-002; consumed by the
full-suite verification in P1.M2.T4.S1.

**Deliverable**: `tests/integration/prp-executor-integration.test.ts` — one `toContain`
string literal changed on line 497. Line 496 (`expect(result.success).toBe(false)`)
is unchanged. No imports, no setup, no `src/` changes.

**Success Definition**:
- `npx vitest run tests/integration/prp-executor-integration.test.ts -t 'should handle invalid JSON from Coder Agent'` → **PASS** (currently FAILS).
- `result.error` contains `'did not return a parseable JSON result envelope after 2 format nudge(s)'` (the count `2` confirmed by running the test — matches `FORMAT_NUDGE_MAX`, default 2).
- `result.success === false` still asserted (line 496, unchanged).
- The other 11 tests in the file stay green (one-literal change, no setup change).
- No `src/` file modified; no other test file touched.

---

## User Persona (if applicable)

**Target User**: **Maintainer** restoring a green CI suite (BUG-002). Not end-user-facing.

**Use Case**: `npm run validate` / `npm test` must pass for the project's own CI gate.
This stale assertion is one of 8 blocking the gate.

**Pain Points Addressed**: A permanently-red suite hides real regressions; this fixes
the one assertion that encodes pre-§4.5.1 behavior (before the format-nudge loop was added).

---

## Why

- **BUG-002 §(c).** The §4.5.1 format-nudge recovery was added to
  `src/agents/prp-executor.ts`: a no-envelope coder response re-prompts the coder up
  to `FORMAT_NUDGE_MAX` (2) times; on exhaustion a clear terminal message replaces
  the raw parse error. The integration test's assertion was never updated and still
  targets the legacy `'Failed to parse Coder Agent response'` text — which is now an
  **intermediate** message (overwritten by the terminal one), so the test fails.
- **Not a product defect.** The runtime behaves correctly (verified by running the
  test — it emits the improved terminal message with count `2`). Only the assertion
  drifted. Test-only fix.
- **Restores the green suite** so `npm run validate` (the project's CI gate) can pass;
  prerequisite for P1.M2.T4.S1's full-suite verification.
- **Out of scope (hard boundary):** any `src/` change (the implementation is correct),
  the other 7 stale tests (P1.M2.T1.S1 fix-cycle, P1.M2.T2.S1 protected-files), the
  full-suite green check (P1.M2.T4.S1), BUG-001 (P1.M1 — already complete), any
  `docs/*.md` (Mode A — test-only), `PRD.md`, `tasks.json`.

---

## What

### User-visible behavior

None (test-only). Observable change: one integration test flips FAIL → PASS.

### Technical requirements (exact contract — confirmed by running the test)

**`tests/integration/prp-executor-integration.test.ts`** — line 497, inside
`'should handle invalid JSON from Coder Agent'` (line 482):

```diff
       // VERIFY: Invalid JSON handled gracefully
       expect(result.success).toBe(false);
-      expect(result.error).toContain('Failed to parse Coder Agent response');
+      expect(result.error).toContain('did not return a parseable JSON result envelope after 2 format nudge(s)');
     });
```

**Line 496** (`expect(result.success).toBe(false);`) — **KEEP unchanged.**

**The actual `result.error`** (captured by running the test before the fix):
```
Coder Agent did not return a parseable JSON result envelope after 2 format nudge(s) (PRD §4.5.1). Last response: Not valid JSON at all
```
- The nudge count is **`2`** (confirmed live; matches `FORMAT_NUDGE_MAX = 2`,
  `src/config/constants.ts:459`). The test setup does NOT override `FORMAT_NUDGE_MAX`
  (zero `FORMAT_NUDGE` references in the test file), so the default `2` applies.

**Alternative (optional robustness variant — either passes):** import `FORMAT_NUDGE_MAX`
and build the substring dynamically —
`` `did not return a parseable JSON result envelope after ${FORMAT_NUDGE_MAX} format nudge(s)` ``
(needs `import { FORMAT_NUDGE_MAX } from '../../src/config/constants.js';`). The
contract prescribes the **literal `'2'`** (and the live run confirms 2), so the
literal is PRIMARY.

### Success Criteria

- [ ] Line 497 asserts `'did not return a parseable JSON result envelope after 2 format nudge(s)'`.
- [ ] Line 496 (`result.success === false`) unchanged.
- [ ] `npx vitest run tests/integration/prp-executor-integration.test.ts -t 'should handle invalid JSON from Coder Agent'` → PASS.
- [ ] The full file (`npx vitest run tests/integration/prp-executor-integration.test.ts`) → green (12/12).
- [ ] No `src/` change; no other test file touched.

---

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed?_
**Yes** — the exact file, the exact line (497), the exact FROM/TO strings, the
sibling line to preserve (496), the **actual emitted message captured by running
the test** (proving the count is `2`), the source-location proof that the legacy
text is an overwritten intermediate message (not the terminal one), `FORMAT_NUDGE_MAX
= 2`, the test's mock setup (returns unparseable on every call → nudges exhaust at
2), the file-disjointness from the parallel siblings, and the verified validation
commands. The non-obvious fact — that `'Failed to parse Coder Agent response'` is
NOT the terminal message for this path — is proven with line citations. See
`research/format-nudge-assertion-facts.md`.

### Documentation & References

```yaml
# MUST READ — the bug report prescribing this exact fix
- docfile: (BUG-002 in selected_prd_content) "Minor Issues → Issue 1 (c)"
  why: >
    "tests/integration/prp-executor-integration.test.ts (1 failure) — asserts the legacy
    error text 'Failed to parse Coder Agent response', but the §4.5.1 format-nudge path
    now emits the improved 'Coder Agent did not return a parseable JSON result envelope
    after 2 format nudge(s) ...' message." THE fix mandate.
  critical: This is test-only; the implementation behaves per the PRD. Only the assertion is stale.

# MUST READ — this subtask's architecture pin (prescribes the exact new substring)
- docfile: plan/015_459c7d9be558/bugfix/001_b8da43bce352/architecture/bug002_stale_tests.md
  section: "(c) prp-executor-integration.test.ts — 1 failure (§4.5.1 format-nudge)"
  why: >
    Shows the current line-497 assertion (STALE), the §4.5.1 terminal message source
    (prp-executor.ts line 385), and the prescribed new assertion:
    `expect(result.error).toContain('did not return a parseable JSON result envelope after 2 format nudge(s)');`
  critical: Confirms the legacy 'Failed to parse Coder Agent response' (line 866) is NOT the path reached.

# MUST READ — this subtask's research (count verified by RUNNING the test)
- docfile: plan/015_459c7d9be558/bugfix/001_b8da43bce352/P1M2T3S1/research/format-nudge-assertion-facts.md
  section: "1 (the single edit)", "2 (actual emitted message + count=2, live-confirmed)",
           "3 (terminal vs intermediate message — line citations)", "5 (substring rationale + dynamic alternative)",
           "6 (file-disjoint from siblings)", "7 (verified commands)"
  why: >
    The count '2' is not assumed — it was captured by running the failing test. The actual
    result.error is recorded verbatim. The terminal-vs-intermediate distinction is proven
    with prp-executor.ts line ~385 vs ~866 citations.

# THE FILE TO EDIT
- file: tests/integration/prp-executor-integration.test.ts
  why: >
    EDIT line 497 only. Test 'should handle invalid JSON from Coder Agent' @482; mock
    `mockAgent.prompt.mockResolvedValue('Not valid JSON at all')` @490 (returns unparseable
    on every call → format-nudge loop exhausts at FORMAT_NUDGE_MAX=2 → terminal message
    fires with count 2). Line 496 (`result.success === false`) KEEP.
  pattern: "expect(result.error).toContain('Failed to parse Coder Agent response');  // line 497 — STALE"
  gotcha: The mock returns the SAME invalid string every call, so both nudge iterations
          fail to parse and the terminal message (not the legacy one) is the final result.error.

# THE SOURCE — the terminal message (read-only; do NOT edit)
- file: src/agents/prp-executor.ts
  why: >
    Lines ~382-385: after the format-nudge `while` loop exhausts (formatNudges === maxFormatNudges === 2),
    the terminal message OVERWRITES coderResult.message:
    `Coder Agent did not return a parseable JSON result envelope after ${formatNudges} format nudge(s) (PRD §4.5.1). Last response: ${coderResponse.slice(0,300)}`
    Lines ~860-868 (#parseCoderResult catch): the legacy `Failed to parse Coder Agent response: ${response}`
    sets formatFailure:true and is then OVERWRITTEN by the terminal message — so it is NEVER the final
    result.error for a no-envelope response.
  pattern: "message: `Coder Agent did not return a parseable JSON result envelope after ${formatNudges} format nudge(s) (PRD §4.5.1). Last response: ${coderResponse.slice(0, 300)}`"
  critical: The count is INTERPOLATED at runtime from the loop counter; the live run confirms it equals 2.

# THE CONSTANT
- file: src/config/constants.ts
  why: >
    Line 459: `export const FORMAT_NUDGE_MAX = 2;` The default nudge ceiling. The test does NOT override
    it → 2 applies → the terminal message emits "2 format nudge(s)".
  pattern: "export const FORMAT_NUDGE_MAX = 2;"

# PARALLEL-SIBLING CONTRACT (file-disjoint — no conflict)
- docfile: plan/015_459c7d9be558/bugfix/001_b8da43bce352/P1M2T2S1/PRP.md
  why: >
    The parallel sibling edits tests/unit/protected-files.test.ts (BUG-002 §(b)). This item edits
    tests/integration/prp-executor-integration.test.ts (BUG-002 §(c)). ZERO file overlap → clean merge.
    Both are test-only; neither touches src/. Treat T2.S1 as landed; it does not affect this file.

# CONSUMER (forward reference — do not implement)
- docfile: plan/015_459c7d9be558/bugfix/001_b8da43bce352/tasks.json   # P1.M2.T4.S1
  why: >
    P1.M2.T4.S1 (full-suite verification) confirms `npx vitest run` → 0 failed across all 8 stale
    tests (this one + the 7 from T1.S1/T2.S1). This item delivers exactly this 1 test green.
```

### Current Codebase tree (relevant slice)

```bash
tests/integration/prp-executor-integration.test.ts   # ← EDIT line 497 only (test 'should handle invalid JSON from Coder Agent' @482)
src/agents/prp-executor.ts                           # READ-ONLY — terminal message @~385; legacy intermediate @~866 (do NOT edit)
src/config/constants.ts                              # READ-ONLY — FORMAT_NUDGE_MAX = 2 @459 (do NOT edit)
plan/015_.../bugfix/001_.../architecture/bug002_stale_tests.md     # §(c) — the prescribed fix
plan/015_.../bugfix/001_.../P1M2T3S1/research/format-nudge-assertion-facts.md   # THIS ITEM'S RESEARCH (count live-confirmed)
```

### Desired Codebase tree with files to be added

```bash
# NO new files. ONE one-line edit:
tests/integration/prp-executor-integration.test.ts   # line 497: 'Failed to parse Coder Agent response' → 'did not return a parseable JSON result envelope after 2 format nudge(s)'
# (No src/ change. No docs/*.md — Mode A: test-only, no user-facing/config/API surface.)
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — the count '2' is not a guess; it was captured by RUNNING the failing test.
//   The actual result.error is: "Coder Agent did not return a parseable JSON result envelope
//   after 2 format nudge(s) (PRD §4.5.1). Last response: Not valid JSON at all". The test
//   setup does NOT override FORMAT_NUDGE_MAX (default 2), and the mock returns unparseable on
//   every call, so the loop runs formatNudges=1 then 2, then the terminal message interpolates 2.

// CRITICAL — 'Failed to parse Coder Agent response' is NOT the terminal message for this path.
//   It lives in #parseCoderResult's catch (prp-executor.ts ~866), sets formatFailure:true, and is
//   then OVERWRITTEN by the terminal message at ~385 after the nudge loop exhausts. Asserting on
//   it can NEVER pass for a no-envelope response. The new substring targets the real terminal message.

// CRITICAL — do NOT assert on the 'Last response: …' tail. It interpolates the mock's raw output
//   ('Not valid JSON at all'), which is brittle. The count-bearing prefix is the stable anchor.

// GOTCHA — the count in the substring ('2') couples the test to FORMAT_NUDGE_MAX's default.
//   The contract prescribes the literal '2' (live-confirmed). For robustness against a future default
//   change, the dynamic alternative `did not return a parseable JSON result envelope after
//   ${FORMAT_NUDGE_MAX} format nudge(s)` (importing FORMAT_NUDGE_MAX) is acceptable — either passes.

// GOTCHA — KEEP line 496 (expect(result.success).toBe(false)). Only line 497's toContain string changes.

// GOTCHA — test-only. Do NOT touch src/agents/prp-executor.ts, src/config/constants.ts, or any src/ file.
//   The implementation is PRD-§4.5.1-compliant; only the assertion drifted.

// GOTCHA — the touched line is inside a test file covered by .eslintrc.json's test override
//   (no-unused-vars etc. relaxed). A string-literal change introduces no lint/format issue; still run
//   `npm run fix` then `npx prettier --check` on the file to be safe.
```

---

## Implementation Blueprint

### Data models and structure

None. This is a single string-literal change in a test assertion. No types, no
models, no new symbols.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT tests/integration/prp-executor-integration.test.ts line 497
  - CHANGE: expect(result.error).toContain('Failed to parse Coder Agent response')
        →  expect(result.error).toContain('did not return a parseable JSON result envelope after 2 format nudge(s)')
  - KEEP:  line 496 expect(result.success).toBe(false) — unchanged.
  - DO NOT: change the mock setup (mockAgent.prompt.mockResolvedValue('Not valid JSON at all') @490),
            add/remove imports, or touch any src/ file or other test file.
  - OPTIONAL robustness variant: import FORMAT_NUDGE_MAX from '../../src/config/constants.js' and use
            `did not return a parseable JSON result envelope after ${FORMAT_NUDGE_MAX} format nudge(s)`.
            (The literal '2' is PRIMARY — prescribed by the contract and live-confirmed.)

Task 2: VERIFY (the targeted test flips FAIL → PASS)
  - RUN: npm run fix   (prettier --write; the string-literal change is unlikely to reflow, but be safe)
  - RUN: npx vitest run tests/integration/prp-executor-integration.test.ts -t 'should handle invalid JSON from Coder Agent'
    → EXPECT PASS (was FAIL).
  - RUN: npx vitest run tests/integration/prp-executor-integration.test.ts
    → EXPECT 12/12 green (the other 11 tests are unaffected — one-literal change).
  - RUN: npx prettier --check tests/integration/prp-executor-integration.test.ts  → clean.
  - EXPECTED: the targeted test PASS; full file green; format clean.
  - NOTE: do NOT run the full `npm run test:run` / `npm run validate` as THIS item's gate — the other
          7 stale tests (fix-cycle ×6, protected-files ×1) are still red until their items land; the
          full-suite green check is P1.M2.T4.S1's job. This item owns exactly this 1 test.
```

### Implementation Patterns & Key Details

```ts
// ---- tests/integration/prp-executor-integration.test.ts @482 — the VERIFY block after the edit ----
it('should handle invalid JSON from Coder Agent', async () => {
  const prp = createMockPRPDocument('P1.M2.T2.S2');
  const prpPath = '/tmp/test-session/prps/P1.M2.T2.S2.md';
  mockAgent.prompt.mockResolvedValue('Not valid JSON at all');   // unchanged — returns unparseable every call
  const executor = new PRPExecutor(sessionPath);
  const result = await executor.execute(prp, prpPath);

  // VERIFY: Invalid JSON handled gracefully — §4.5.1 format-nudge terminal message (count = FORMAT_NUDGE_MAX = 2)
  expect(result.success).toBe(false);                            // line 496 — UNCHANGED
  expect(result.error).toContain(                               // line 497 — CHANGED
    'did not return a parseable JSON result envelope after 2 format nudge(s)'
  );
});
```

### Integration Points

```yaml
TEST EDIT (tests/integration/prp-executor-integration.test.ts):
  - line 497 toContain substring: 'Failed to parse Coder Agent response'
      → 'did not return a parseable JSON result envelope after 2 format nudge(s)'
  - line 496 (result.success === false): UNCHANGED.
  - mock setup, imports, other tests: UNCHANGED.

NOT TOUCHED (hard boundary):
  - src/agents/prp-executor.ts (terminal message @~385 + legacy intermediate @~866 — correct as-is).
  - src/config/constants.ts (FORMAT_NUDGE_MAX = 2 @459 — correct as-is).
  - Any other test file (fix-cycle-workflow.test.ts = P1.M2.T1.S1; protected-files.test.ts = P1.M2.T2.S1).
  - docs/*.md (Mode A — test-only), PRD.md, tasks.json.

CONSUMED BY (forward reference):
  - P1.M2.T4.S1 (full-suite verification): this is 1 of the 8 stale tests; T4.S1 confirms the full
    `npx vitest run` → 0 failed once all of T1.S1/T2.S1/T3.S1 land.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run fix                                                        # prettier --write (safety)
npx prettier --check tests/integration/prp-executor-integration.test.ts   # clean
npx eslint tests/integration/prp-executor-integration.test.ts          # clean (test-override block; string-literal change)
# Expected: clean. The edit is a string literal inside a test override block — no lint/format risk.
```

### Level 2: Unit/Integration Test (the gate — the targeted test flips FAIL → PASS)

```bash
# The directly-affected test — MUST go green:
npx vitest run tests/integration/prp-executor-integration.test.ts -t 'should handle invalid JSON from Coder Agent'
#   → PASS (was FAIL: "expected 'Coder Agent did not return a parseabl…' to contain 'Failed to parse Coder Agent response'").

# The whole file — the other 11 tests must stay green (one-literal change, no setup change):
npx vitest run tests/integration/prp-executor-integration.test.ts
#   → 12 passed.

# Expected: targeted test PASS; full file 12/12. If the targeted test STILL fails, re-read the actual
#   result.error (the count may differ if the env/test setup changed — but the live run confirmed 2).
```

### Level 3: Regression (System Validation)

```bash
# Confirm ONLY this one file changed:
git diff --name-only      # Expect ONLY tests/integration/prp-executor-integration.test.ts
# Confirm the old text is gone + the new text is present:
grep -n "Failed to parse Coder Agent response" tests/integration/prp-executor-integration.test.ts   # ZERO
grep -n "did not return a parseable JSON result envelope after 2 format nudge(s)" tests/integration/prp-executor-integration.test.ts   # 1 hit (line ~497)
# Expected: git diff shows only the 1 file; grep confirms the assertion swap.
# NOTE: do NOT run the full `npm run test:run`/`npm run validate` as THIS item's gate — the other 7 stale
# tests remain red until P1.M2.T1.S1 (fix-cycle ×6) and P1.M2.T2.S1 (protected-files ×1) land. The
# full-suite green check is P1.M2.T4.S1.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# No runtime/CLI/API change (test-only). Domain checks (record in commit message):
#   1. The assertion now targets the §4.5.1 format-nudge TERMINAL message (prp-executor.ts ~385), not the
#      legacy intermediate 'Failed to parse Coder Agent response' (~866, overwritten by the terminal one).
#   2. The count '2' in the substring is live-confirmed (== FORMAT_NUDGE_MAX default 2; the test does not
#      override it; the mock returns unparseable every call → loop exhausts at 2).
#   3. Test-only — no src/ change; the implementation already behaves per PRD §4.5.1.
#   4. File-disjoint from the parallel P1.M2.T2.S1 (protected-files.test.ts) and P1.M2.T1.S1 (fix-cycle).
```

---

## Final Validation Checklist

### Technical Validation

- [ ] `npx vitest run tests/integration/prp-executor-integration.test.ts -t 'should handle invalid JSON from Coder Agent'` → PASS.
- [ ] `npx vitest run tests/integration/prp-executor-integration.test.ts` → 12/12 green.
- [ ] `npx prettier --check tests/integration/prp-executor-integration.test.ts` → clean.
- [ ] `git diff --name-only` → ONLY `tests/integration/prp-executor-integration.test.ts`.

### Feature Validation

- [ ] Line 497 asserts `'did not return a parseable JSON result envelope after 2 format nudge(s)'`.
- [ ] Line 496 (`result.success === false`) unchanged.
- [ ] The other 11 tests in the file unaffected.
- [ ] No `src/` change; no other test file touched.

### Code Quality Validation

- [ ] One-literal change — no new patterns, no new imports (unless using the dynamic FORMAT_NUDGE_MAX variant).
- [ ] Substring excludes the brittle `'Last response: …'` tail; includes the load-bearing count `2`.
- [ ] File-disjoint from parallel siblings (no merge conflict).

### Documentation & Deployment

- [ ] Mode A — no docs (test-only, no user-facing/config/API surface change).
- [ ] Commit message notes: BUG-002 §(c); §4.5.1 format-nudge terminal message (count 2, live-confirmed
      == FORMAT_NUDGE_MAX); legacy 'Failed to parse' is the overwritten intermediate, not the terminal;
      test-only; 1 of 8 stale tests (full-suite green = P1.M2.T4.S1).

---

## Anti-Patterns to Avoid

- ❌ Don't change `src/` — the implementation is PRD-§4.5.1-compliant; only the assertion drifted. This is test-only.
- ❌ Don't assert on the `'Last response: …'` tail — it interpolates the mock's raw output (`'Not valid JSON at all'`), which is brittle.
- ❌ Don't drop the count from the substring — `'… parseable JSON result envelope …'` without `'after 2 format nudge(s)'` would pass even if the nudge loop regressed to zero iterations. The count is the load-bearing proof the §4.5.1 path ran.
- ❌ Don't keep / re-add the legacy `'Failed to parse Coder Agent response'` — it is an INTERMEDIATE message (overwritten by the terminal one) and can never be the final `result.error` for a no-envelope response.
- ❌ Don't change the mock setup (`mockAgent.prompt.mockResolvedValue('Not valid JSON at all')`) — it returning unparseable on every call is exactly what exhausts the nudge loop at 2 and fires the terminal message.
- ❌ Don't touch line 496 (`expect(result.success).toBe(false)`) — keep it.
- ❌ Don't run the full `npm run test:run` / `npm run validate` as THIS item's gate — the other 7 stale tests (fix-cycle ×6, protected-files ×1) are still red until their items land. Gate on the targeted test + the file. Full-suite green is P1.M2.T4.S1.
- ❌ Don't edit any other test file (file-disjoint from P1.M2.T1.S1 / P1.M2.T2.S1) — would collide with those siblings.
- ❌ Don't guess the count — it was captured by running the test (= 2). If a future change alters `FORMAT_NUDGE_MAX` or the test setup overrides it, re-run and match the actual emitted count (or use the dynamic `${FORMAT_NUDGE_MAX}` variant).

---

## Confidence Score

**10/10** — One-pass implementation success likelihood.

Rationale: This is a single string-literal change on one line of one test, with the
exact FROM/TO strings prescribed by both the bug report (BUG-002 §(c)) and the
architecture pin (`bug002_stale_tests.md §(c)`), AND the target message + count
were **captured by running the failing test** (so there is no guesswork — the
actual `result.error` is recorded verbatim, count = 2 == `FORMAT_NUDGE_MAX`). The
non-obvious trap (asserting on the legacy `'Failed to parse Coder Agent response'`
which is an overwritten intermediate, not the terminal message) is documented with
source line citations (~385 vs ~866). The change is file-disjoint from the parallel
siblings (T2.S1 = protected-files.test.ts; T1.S1 = fix-cycle-workflow.test.ts), so
no merge conflict. Validation is a single targeted vitest invocation that flips
FAIL → PASS. There is no `src/` change and no behavior change — the only residual
"risk" is a future `FORMAT_NUDGE_MAX` default change, for which the dynamic-constant
variant is offered as a robustness option. With the count live-confirmed, this is
as deterministic a one-pass change as exists.