# PRP — P1.M2.T1.S1: Strengthen `createFixSubtaskFixture` context_scope fixture to pass `ContextScopeSchema`

> Bugfix 001, **BUG-002 (Minor) §(a)** — 6 stale tests in `tests/unit/workflows/fix-cycle-workflow.test.ts`.
> The shared fixture `createFixSubtaskFixture` sets `context_scope: 'fix'`, which fails the strict
> `ContextScopeSchema`. That makes `runStandardBreakdown`'s `BacklogSchema.safeParse` reject the
> backlog → `#validateAndHealBacklog` runs the §4.5.1 heal (extra `retryAgentPrompt` nudges +
> `writeTasksJSON` + context_scope mutation), drifting the tests' exact call-count / backlog-equality
> assertions. **One fixture string fix resolves all 6** (they all build subtasks via this fixture).
> Test-only — no source change; assertions held as-written (not weakened). Architecture spec:
> `bug002_stale_tests.md §(a)`.

---

## Goal

**Feature Goal**: Make the `createFixSubtaskFixture` test fixture's `context_scope` pass
`ContextScopeSchema` so the bugfix backlog validates on first `BacklogSchema.safeParse` and the
§4.5.1 heal path is never triggered — realigning all 6 stale assertions in
`fix-cycle-workflow.test.ts` (FAIL → PASS) without touching source code or weakening any assertion.

**Deliverable**: `tests/unit/workflows/fix-cycle-workflow.test.ts` — EDIT (one line): change
`context_scope: 'fix'` (line 165, inside `createFixSubtaskFixture`) to a full `CONTRACT DEFINITION:`
string that satisfies `ContextScopeSchema` (prefix + 4 ordered sections). All 32 tests in the file
green (6 FAIL → PASS).

**Success Definition**:
- `createFixSubtaskFixture`'s `context_scope` starts with `CONTRACT DEFINITION:\n` and contains the
  4 ordered section headers (`1. RESEARCH NOTE:`, `2. INPUT:`, `3. LOGIC:`, `4. OUTPUT:`).
- `BacklogSchema.safeParse` of a backlog built from the fixture SUCCEEDS (verified: the 6 tests no
  longer trigger `#validateAndHealBacklog`).
- The 6 currently-failing tests (L389, L415, L665, L710, L761, L812) transition FAIL → PASS; the
  other 26 tests in the file stay GREEN.
- No source file is modified; no assertion is weakened or re-worded.
- `npm run typecheck && npm run lint && npm run format:check` clean;
  `npx vitest run tests/unit/workflows/fix-cycle-workflow.test.ts` fully GREEN (32/32).

---

## Why

- **Restores a green suite (BUG-002 §a).** The implementation is PRD-compliant — `ContextScopeSchema`
  correctly rejects `'fix'`, and the §4.5.1 heal path correctly runs on a schema-invalid backlog.
  The bug is the TEST FIXTURE carrying a weak `context_scope` that was never updated when the schema
  was tightened. A permanently-red suite hides real regressions and breaks the project's own
  `npm run validate` CI gate.
- **One fixture, six tests.** All 6 failures share a single root cause (the fixture) and a single fix.
  Every failing test builds its subtasks via `createFixSubtaskFixture` → `createFixBacklog([...])`;
  making the fixture schema-valid removes the heal trigger for all of them at once.
- **Assertions held as-written.** The tests assert the CORRECT post-fix behavior (architect invoked
  once; backlog not mutated; exact writeTasksJSON counts). The fixture was wrong, not the assertions.
  Strengthening the fixture makes the assertions pass WITHOUT weakening them — the right kind of fix.
- **Test-only / zero source risk.** No production code change; the heal path stays intact for genuine
  schema failures. File-disjoint from the parallel P1.M1.T1.S1 (`prp-pipeline.ts` BUG-001 fix).
- **Out of scope (hard boundary):** the other 2 BUG-002 slices — `protected-files.test.ts`
  (P1.M2.T2.S1) and `prp-executor-integration.test.ts` (P1.M2.T3.S1) are different test files,
  sequenced; the full-suite green verification is P1.M2.T4.S1. Also out of scope: any source edit
  (`src/core/models.ts` ContextScopeSchema, `src/workflows/fix-cycle-workflow.ts` heal path),
  any docs, `PRD.md`, `tasks.json`, `prd_snapshot.md`.

---

## What

### User-visible behavior
None (test-only). Indirectly: `npx vitest run tests/unit/workflows/fix-cycle-workflow.test.ts` goes
from 6 failed / 26 passed to 32 passed.

### Technical requirements (exact contract)

**The single edit** — `tests/unit/workflows/fix-cycle-workflow.test.ts`, inside `createFixSubtaskFixture`
(line 155), the `context_scope` field (line 165):

Before:
```ts
  context_scope: 'fix',
```

After (a full CONTRACT DEFINITION string; use a backtick template literal for the real newlines —
matches the codebase's context_scope style):
```ts
  context_scope: `CONTRACT DEFINITION:
1. RESEARCH NOTE: bugfix fixture for fix-cycle-workflow tests.
2. INPUT: TEST_RESULTS.md bug report.
3. LOGIC: apply the fix described in the bug report.
4. OUTPUT: patched source file.`,
```

**Why this value passes `ContextScopeSchema` (models.ts:106)** — verified against the schema:
- `startsWith('CONTRACT DEFINITION:\n')` ✓ (the backtick literal's first line + newline).
- Section regexes match in order: `/1\.\s*RESEARCH\sNOTE:/m` ✓, `/2\.\s*INPUT:/m` ✓,
  `/3\.\s*LOGIC:/m` ✓, `/4\.\s*OUTPUT:/m` ✓ (the `\s*` tolerates the single space).
- Content after each header is free-form ✓.

> The contract's example used inline `\n` escapes; a backtick multi-line literal is equivalent and
> reads cleaner. Either form is valid as long as the real newlines are present (the schema's prefix
> check is `startsWith('CONTRACT DEFINITION:\n')` — a literal `\` + `n` would FAIL).

### Success Criteria
- [ ] `createFixSubtaskFixture.context_scope` is a full CONTRACT DEFINITION (prefix + 4 ordered sections).
- [ ] The 6 failing tests (L389, L415, L665, L710, L761, L812) PASS; the other 26 stay GREEN.
- [ ] No source file modified; no assertion weakened/re-worded.
- [ ] `npm run typecheck && npm run lint && npm run format:check` clean; the fix-cycle file 32/32 green.

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_ **Yes** — the exact
file + line (155/165), the exact before/after, the verified `ContextScopeSchema` rule (prefix + 4
ordered regex sections) with the literal-newline gotcha, the proof the replacement value passes, the
6 failing test names + line numbers, the safety proof (no test asserts on `'fix'` or the heal path),
the do-not-touch-source rule, and the verified validation commands. See
`research/fix-cycle-context-scope-fixture.md` for the grep evidence.

### Documentation & References
```yaml
# AUTHORITATIVE SPEC — the BUG-002 §(a) finding this fixes
- docfile: plan/015_459c7d9be558/bugfix/001_b8da43bce352/architecture/bug002_stale_tests.md
  section: "(a) fix-cycle-workflow.test.ts — 6 failures (1 shared root cause)"
  why: Pins the root cause (context_scope:'fix' → ContextScopeSchema reject → heal → drift), the 6
        failing tests, and the example replacement value.
  critical: The doc calls the fixture `createFixSubtask`; the ACTUAL name in the file is
        `createFixSubtaskFixture` (line 155). Use the real name.

# THE SCHEMA — the exact validation the fixture must satisfy (verified in source)
- file: src/core/models.ts
  section: ContextScopeSchema (L106) — `z.string().min(1).superRefine(...)`: prefix check
        `startsWith('CONTRACT DEFINITION:\\n')` (LITERAL newline, not backslash-n) + 4 ordered
        section regexes /1. RESEARCH NOTE:/ /2. INPUT:/ /3. LOGIC:/ /4. OUTPUT:/ (in order).
  why: Defines exactly what "passes" means. The replacement value is verified against it.
  gotcha: The prefix is `'CONTRACT DEFINITION:\n'` with a REAL newline. A string literal
        `'CONTRACT DEFINITION:\\n1. …'` (backslash-n) would FAIL startsWith. Use a backtick
        template literal (real newlines) or explicit `\n` escapes that evaluate to newlines.

# EDIT TARGET — the test file (read it; the fixture is at L155-167)
- file: tests/unit/workflows/fix-cycle-workflow.test.ts
  section: createFixSubtaskFixture (L155) — the `context_scope: 'fix'` field is at L165.
  why: The SINGLE edit site. All 6 failing tests build subtasks via this fixture (call sites
        L212, L246, L418-419, L563-564, L611-612) → createFixBacklog([...]).
  pattern: "const createFixSubtaskFixture = (id, title = `Fix ${id}`): Subtask => ({ … context_scope: 'fix', … });"
  gotcha: No test asserts context_scope === 'fix' or that the heal ran (grep-verified: the only
        'fix' hit is L165). Strengthening the fixture cannot break a passing test — it's strictly
        more schema-conformant.

# THE HEAL PATH (read-only — the thing that must NOT trigger after the fix)
- file: src/workflows/fix-cycle-workflow.ts
  section: runStandardBreakdown (L273) → #validateAndHealBacklog (L380) — runs §4.5.1 heal on
        BacklogSchema.safeParse failure (extra retryAgentPrompt nudges + #healContextScopes +
        writeTasksJSON, mutating context_scope).
  why: Confirms the drift mechanism. After the fixture fix, safeParse SUCCEEDS → heal NOT triggered
        → the 6 assertions hold as-written. DO NOT edit this source.

# PARALLEL PREDECESSOR (confirm no overlap — do NOT implement it)
- docfile: plan/015_459c7d9be558/bugfix/001_b8da43bce352/P1M1T1S1/PRP.md
  why: T1.S1 fixes src/workflows/prp-pipeline.ts (#runValidation BUG-001). S1 edits a TEST file
        (fix-cycle-workflow.test.ts). ZERO file overlap.

# SIBLING BUG-002 TASKS (different test files — sequenced, no overlap)
- file: plan/015_459c7d9be558/bugfix/001_b8da43bce352/tasks.json
  why: P1.M2.T2.S1 = protected-files.test.ts; P1.M2.T3.S1 = prp-executor-integration.test.ts;
        P1.M2.T4.S1 = full-suite green verification. S1 is the fix-cycle slice only.
```

### Current Codebase tree (relevant slice)
```bash
tests/unit/workflows/fix-cycle-workflow.test.ts   # EDIT (1 line): createFixSubtaskFixture.context_scope L165
src/core/models.ts                                # READ-ONLY (ContextScopeSchema — the rule)
src/workflows/fix-cycle-workflow.ts               # READ-ONLY (the heal path that must NOT trigger — unchanged)
```

### Desired Codebase tree with files to be edited
```bash
tests/unit/workflows/fix-cycle-workflow.test.ts   # MODIFIED (1 string swap at L165)
# No other files. No source. No docs (Mode A: none — test-only).
```

### Known Gotchas of our codebase & Library Quirks
```ts
// CRITICAL — The prefix check is startsWith('CONTRACT DEFINITION:\n') with a REAL newline (char 0x0A),
//   NOT a backslash + 'n'. A JS string literal 'CONTRACT DEFINITION:\n1. …' is FINE (\n evaluates to
//   a newline at parse time); but a doubled '\\n' or a raw backslash-n in the SOURCE would FAIL. Use a
//   backtick template literal (real newlines) — matches models.test.ts's context_scope style.

// CRITICAL — The fixture's ACTUAL name is createFixSubtaskFixture (L155), NOT createFixSubtask. The
//   architecture doc §(a) abbreviates it. grep for createFixSubtaskFixture to locate it.

// CRITICAL — Do NOT change source. ContextScopeSchema + the heal path are PRD-compliant; only the
//   test fixture is stale. Do NOT weaken any assertion — make the fixture conform so the assertions
//   hold as written. The 6 tests assert the CORRECT post-fix behavior.

// GOTCHA — All 4 section headers must appear IN ORDER (the schema tracks searchStartIndex). The
//   replacement value has them ordered 1→2→3→4; do not reorder.

// GOTCHA — '\s*' in the section regexes tolerates spacing, but the DIGAL+DOT+header is required:
//   '1. RESEARCH NOTE:' (not '1.RESEARCH NOTE' or 'RESEARCH NOTE:'). Keep the exact header tokens.

// GOTCHA — No test asserts context_scope === 'fix' or that the heal ran (grep-verified). So making
//   the fixture schema-valid cannot break a passing test — it's strictly more conformant. The 26
//   other tests using the fixture get a valid context_scope (a no-op for them).

// GOTCHA — 100% coverage is enforced on src/**, NOT tests/** — a test-only edit has no coverage impact.
//   (tests/ are excluded from tsconfig.build; vitest measures src/ coverage only.)

// GOTCHA — prettier is ERROR-enforced and its glob includes .ts. The multi-line backtick string may
//   reflow; run `npm run fix` before format:check.

// CRITICAL — Do NOT run the full `npx vitest run` as the S1 gate. The other 2 BUG-002 files
//   (protected-files.test.ts, prp-executor-integration.test.ts) + BUG-001 are sibling/parallel scope
//   and still red. S1's gate = the fix-cycle file green (32/32). P1.M2.T4.S1 owns full-suite green.
```

---

## Implementation Blueprint

### Data models and structure
N/A — a single string value change in a test fixture. No new types, no new exports.

### Implementation Tasks (ordered by dependencies)
```yaml
Task 1: EDIT tests/unit/workflows/fix-cycle-workflow.test.ts — strengthen the fixture's context_scope
  - LOCATE: createFixSubtaskFixture (L155); the `context_scope: 'fix',` field at L165.
  - REPLACE `context_scope: 'fix',` with the full CONTRACT DEFINITION backtick string from
        "Technical requirements" (prefix + 4 ordered sections, real newlines).
  - DO NOT: change any other field of the fixture; touch createFixBacklog; edit any assertion;
        edit any source file; rename the fixture.
  - VERIFY (grep): `grep -n "context_scope: 'fix'" tests/unit/workflows/fix-cycle-workflow.test.ts`
        → NO output (the stale value is gone).

Task 2: VERIFY
  - RUN: npm run fix (lint:fix + prettier --write — in case the backtick string reflows).
  - RUN: npm run typecheck && npm run lint && npm run format:check   (clean; test file excluded
        from tsc.build, but eslint + prettier cover it).
  - RUN: npx vitest run tests/unit/workflows/fix-cycle-workflow.test.ts   # 32 GREEN (6 FAIL→PASS).
  - EXPECTED: all green. If a test still fails, confirm the new context_scope passes
        ContextScopeSchema (prefix is a REAL newline; 4 headers in order) — run
        `node -e "…BacklogSchema.safeParse…" ` or re-read models.ts:106. If a PREVIOUSLY-passing
        test broke, it would mean a test asserted on 'fix'/heal — re-grep to confirm none do.
```

### Implementation Patterns & Key Details
```ts
// ---- the fixture (L155-167) before → after (ONLY the context_scope line changes) ----
const createFixSubtaskFixture = (id: string, title: string = `Fix ${id}`): Subtask => ({
  id,
  type: 'Subtask',
  title,
  status: 'Planned',
  story_points: 3,
  dependencies: [],
  context_scope: `CONTRACT DEFINITION:
1. RESEARCH NOTE: bugfix fixture for fix-cycle-workflow tests.
2. INPUT: TEST_RESULTS.md bug report.
3. LOGIC: apply the fix described in the bug report.
4. OUTPUT: patched source file.`,           // ← was: 'fix'   (real newlines via backtick literal)
  prd_selectors: [],
});

// ---- why it passes ContextScopeSchema (models.ts:106) ----
// startsWith('CONTRACT DEFINITION:\n') ✓ (backtick line 1 + newline)
// /1\.\s*RESEARCH NOTE:/m ✓  /2\.\s*INPUT:/m ✓  /3\.\s*LOGIC:/m ✓  /4\.\s*OUTPUT:/m ✓ (in order)
// → BacklogSchema.safeParse SUCCEEDS → #validateAndHealBacklog NOT triggered → 6 assertions realign.
```

### Integration Points
```yaml
TEST FILE (tests/unit/workflows/fix-cycle-workflow.test.ts):
  - createFixSubtaskFixture (L155): context_scope L165 'fix' → full CONTRACT DEFINITION string.
  - PRESERVE: every other fixture field; createFixBacklog; all 32 test bodies + assertions.

SOURCE (NONE):
  - src/core/models.ts (ContextScopeSchema): UNCHANGED — read-only.
  - src/workflows/fix-cycle-workflow.ts (runStandardBreakdown / #validateAndHealBacklog): UNCHANGED.
  - The heal path stays intact for GENUINE schema failures (just no longer triggered by this fixture).

DOWNSTREAM (P1.M2.T4.S1 — full-suite green verification):
  - S1 contributes 6 of the 8 BUG-002 fixes (the fix-cycle slice). T4.S1 runs the full suite to 0 failed.

DOCS (Mode A — none):
  - Test-only change; no user-facing/config/API surface. No docs/*.md, README, .env.example.
  - Commit message notes: BUG-002 §(a); 1 fixture string fix resolves 6 stale tests; the heal path is
        correct (not triggered after the fix); assertions held as-written (not weakened).
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
npm run fix            # lint:fix + prettier --write (run first — the backtick string may reflow)
npm run typecheck      # tsc --noEmit -p tsconfig.build.json — clean (test file excluded, but run it)
npm run lint           # eslint . --ext .ts — clean
npm run format:check   # prettier --check — clean
# Expected: all clean. If prettier flags the multi-line string, `npm run fix` resolves it.
```

### Level 2: The Test File (Component Validation)
```bash
npx vitest run tests/unit/workflows/fix-cycle-workflow.test.ts
# Expected: 32 passed (was 6 failed | 26 passed). The 6 (L389/L415/L665/L710/L761/L812) transition
#   FAIL→PASS. If one still fails on a retryAgentPrompt count or backlog equality, the heal path is
#   still triggering → the new context_scope is still schema-invalid → re-check the prefix is a REAL
#   newline and the 4 headers are present + ordered (re-read models.ts:106).
# Do NOT run the full `npx vitest run` as the S1 gate (other BUG-002 files + BUG-001 are parallel scope).
```

### Level 3: Regression (no source edit, no assertion weakened)
```bash
# Confirm ONLY the test file changed (no source touched):
git diff --name-only   # → ONLY tests/unit/workflows/fix-cycle-workflow.test.ts
git diff --stat -- src/ docs/   # → empty (no source / docs edit)
# Confirm the stale 'fix' value is gone + the fixture carries a valid CONTRACT DEFINITION:
grep -n "context_scope: 'fix'" tests/unit/workflows/fix-cycle-workflow.test.ts   # → NO output
grep -n "CONTRACT DEFINITION" tests/unit/workflows/fix-cycle-workflow.test.ts    # → the fixture line
# Expected: only the test file in the diff; the stale value gone; the CONTRACT DEFINITION present.
```

### Level 4: Creative & Domain-Specific Validation
```bash
# No MCP/DB/HTTP (a unit-test fixture). Domain checks (record in commit message):
#   1. The fixture's context_scope now passes ContextScopeSchema (prefix + 4 ordered sections).
#   2. runStandardBreakdown's BacklogSchema.safeParse succeeds on first read → heal NOT triggered.
#   3. retryAgentPrompt called exactly 1× (test L389); backlog not mutated (test L415) — the assertions
#      that encode the CORRECT post-fix behavior now hold.
#   4. No source changed; no assertion weakened; the heal path remains for genuine schema failures.
#   5. The fix-cycle file is fully green (32/32) — S1's slice of BUG-002.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` clean; `npm run lint` clean; `npm run format:check` clean.
- [ ] `npx vitest run tests/unit/workflows/fix-cycle-workflow.test.ts` GREEN (32/32; 6 FAIL→PASS).
- [ ] `git diff --name-only` = ONLY `tests/unit/workflows/fix-cycle-workflow.test.ts`.

### Feature Validation
- [ ] `createFixSubtaskFixture.context_scope` is a full CONTRACT DEFINITION (prefix + 4 ordered sections).
- [ ] The 6 failing tests (L389, L415, L665, L710, L761, L812) PASS; the other 26 stay GREEN.
- [ ] The new value passes `ContextScopeSchema` (real newline in the prefix; headers in order).

### Code Quality Validation
- [ ] Only the `context_scope` line (L165) changed; every other fixture field + `createFixBacklog` intact.
- [ ] No assertion weakened or re-worded — the fixture conforms so assertions hold as-written.
- [ ] No source file modified (`src/core/models.ts`, `src/workflows/fix-cycle-workflow.ts` untouched).

### Documentation & Deployment
- [ ] No docs change (Mode A: none — test-only).
- [ ] Commit message notes: BUG-002 §(a); 1 fixture fix resolves 6 stale tests; heal path is correct
      (not triggered post-fix); assertions held as-written.

---

## Anti-Patterns to Avoid

- ❌ Don't change source — `ContextScopeSchema` and the heal path are PRD-compliant; only the test
      fixture is stale. The bug is the fixture's weak `context_scope`, not the schema/heal.
- ❌ Don't weaken any assertion — the 6 tests assert the CORRECT post-fix behavior (architect once;
      backlog unmutated; exact write counts). Make the fixture conform so they pass as-written.
- ❌ Don't use a backslash-n literal (`'CONTRACT DEFINITION:\\n…'`) — the prefix check needs a REAL
      newline. Use a backtick template literal (real newlines) or `\n` escapes that evaluate to newlines.
- ❌ Don't reorder or drop a section header — the schema requires all 4 (`1. RESEARCH NOTE:`, `2. INPUT:`,
      `3. LOGIC:`, `4. OUTPUT:`) IN ORDER.
- ❌ Don't edit `createFixBacklog` or any other fixture — only `createFixSubtaskFixture.context_scope`.
- ❌ Don't rename the fixture — the architecture doc abbreviates it as `createFixSubtask`, but the real
      name is `createFixSubtaskFixture` (L155). Edit in place; don't rename.
- ❌ Don't run the full `npx vitest run` as the S1 gate — the other 2 BUG-002 files + BUG-001 are
      parallel/sibling scope and still red. S1's gate = the fix-cycle file green (32/32). P1.M2.T4.S1
      owns full-suite green.
- ❌ Don't touch the parallel P1.M1.T1.S1 file (`src/workflows/prp-pipeline.ts`) — file-disjoint.
- ❌ Don't assume a passing test will break — grep verified NO test asserts `context_scope === 'fix'` or
      that the heal ran. Strengthening the fixture is strictly more conformant; it can only turn the 6
      red tests green.

---

## Confidence Score

**10/10** — One-pass implementation success likelihood.

Rationale: This is a single-string edit to one test fixture, with every fact verified in source: the
exact line (165), the exact schema rule (`ContextScopeSchema` at models.ts:106 — prefix + 4 ordered
regex sections), the proof the replacement value passes it, the proof all 6 failing tests share this
one fixture (call sites enumerated), and the proof no test asserts on `'fix'` or the heal path (so no
passing test can break). The fix makes the fixture schema-valid → `BacklogSchema.safeParse` succeeds on
first read → the §4.5.1 heal never triggers → the 6 assertions (which encode the correct post-fix
behavior) hold as-written. No source change, no assertion weakening, zero source risk. File-disjoint
from the parallel P1.M1.T1.S1. The only residual risk — a backslash-n-vs-real-newline slip in the
literal — is called out (use a backtick template literal) and caught by the targeted vitest run (a
still-invalid context_scope keeps the heal triggering → the L389/L415 tests stay red). No
runtime/network/LLM unknowns.