# PRP — P1.M1.T1.S1: Apply optional-chaining fix to `process.setMaxListeners` in `getLogger`

> **Bugfix subtask** — Issue 1 of
> `plan/005_d32a2ecf61cd/bugfix/001_d4c62ddb6810/TEST_RESULTS.md`.
> `process.setMaxListeners(30)` in `src/utils/logger.ts` throws under partial `process`
> stubs and breaks 14 `progress-display` tests.

---

## ⚠️ STOP — READ THIS PRECONDITION BLOCK FIRST ⚠️

**The offending line is NOT present in the current working tree.** This must be probed
before any edit. Verified at PRP-authoring time (see
`research/setMaxListeners-precondition.md`):

| Probe (run these FIRST) | Current result | Meaning |
| --- | --- | --- |
| `grep -n "setMaxListeners" src/utils/logger.ts` | **no matches** | bug line is absent |
| `npx vitest run tests/unit/utils/progress-display.test.ts` | **44 passed / 0 failed** | tests already green |
| `git merge-base --is-ancestor 4e6d2ef HEAD && echo YES \|\| echo NO` | **NO** | regression commit `4e6d2ef` is NOT in current history |

The regression was introduced by commit `4e6d2ef` ("Add task CLI subcommand and delta
execution mode"), which lives on `main`/`origin/main` but is **not an ancestor** of the
current (detached) HEAD `fd7352c`. The bug report was written against `main`; the current
branch diverged before `4e6d2ef` landed, so the bug line simply does not exist here.

**Therefore Task 1 below is a hard precondition gate.** Two outcomes:

- **If the offending line IS present** (orchestrator checked out a tree containing
  `4e6d2ef`, e.g. `main`): proceed to Task 2 (apply the `?.` fix) and Task 3 (verify).
- **If the offending line is ABSENT** (current tree state): the fix is a **no-op** —
  there is nothing to change. Run the verification commands, confirm 44/44 pass, document
  the finding in the task result, and STOP. Do NOT fabricate the line, do NOT "add the
  guard anyway", do NOT edit anything else.

This PRP is written to succeed in either scenario.

---

## Goal

**Feature Goal**: Make `getLogger()` in `src/utils/logger.ts` safe to call under a
partial `process` stub (where `setMaxListeners` is absent), eliminating the
`TypeError: process.setMaxListeners is not a function` that breaks 14
`progress-display` tests on any tree that contains the regression.

**Deliverable**: A one-character semantic edit to `src/utils/logger.ts` — change
`process.setMaxListeners(30);` to `process.setMaxListeners?.(30);` (optional chaining) —
plus an updated preceding comment explaining why optional chaining is required.

**Success Definition**:
- `npx vitest run tests/unit/utils/progress-display.test.ts` → **44 passed, 0 failed**
  (was 14 failed on `main`/`4e6d2ef`).
- `npm run lint && npm run format:check && npm run typecheck` → all green.
- No other behavior change; production listener-cap raise is preserved on real `process`.
- **OR**, if the precondition probe finds the line absent (current tree): no edit is made;
  the 44/44 passing state is confirmed and the task is recorded as a no-op with the
  divergence documented.

---

## Why

- **Restores a reliable `npm run test:run` gate.** The regression (TEST_RESULTS.md
  Issue 1) made 14 of 44 `progress-display` tests fail on `main`, undermining the
  Progressive Validation gate (PRD §6.3 Level 2) that every resilience subtask depends on.
- **Root cause is a real test-environment hazard, not a test bug.** `process.setMaxListeners`
  is inherited from `EventEmitter.prototype`, not an own property of `process`
  (`process.hasOwnProperty('setMaxListeners') === false`). `vi.stubGlobal('process',
  {...originalProcess, ...})` spreads only enumerable OWN properties, so the inherited
  method is lost. Optional chaining is the minimal, correct hardening.
- **Zero production impact.** Real Node.js `process` always defines `setMaxListeners`, so
  `?.` is a no-op there; the listener cap is still raised. The change only adds safety
  when the method is absent.
- **Scope discipline.** This is S1 = the fix + comment only. The regression test is S2
  (P1.M1.T1.S2). No docs (the comment IS the documentation per work-item contract #5).

---

## What

### User-visible behavior
None — internal hardening of the logger initialization path. The only externally
observable effect is that `npm run test:run -- tests/unit/utils/progress-display.test.ts`
goes from 14 failed / 30 passed → 44 passed on any tree that contains the regression.

### Technical requirements (exact contract)

**File:** `src/utils/logger.ts`, inside `getLogger(context, options?)`, in the block
guarded by `if (!loggerCache.size)` (at `4e6d2ef` this is ~lines 445–449).

**(a) Change the call** from:
```ts
process.setMaxListeners(30);
```
to:
```ts
process.setMaxListeners?.(30);
```

**(b) Update the preceding comment** to explain WHY optional chaining is used. Target:
```ts
// Prevent MaxListenersExceededWarning from pino transport workers.
// Optional chaining: setMaxListeners is inherited from EventEmitter.prototype, not an
// own property of process; partial stubs via vi.stubGlobal lose it. `?.` keeps this
// safe in tests while preserving production behavior (real process always has it).
if (!loggerCache.size) {
  process.setMaxListeners?.(30);
}
```

### Success Criteria
- [ ] `src/utils/logger.ts` calls `process.setMaxListeners?.(30)` (optional chaining)
      inside the `if (!loggerCache.size)` guard — **IF that block exists in the tree**.
- [ ] The preceding comment documents the inheritance/stub rationale.
- [ ] No other line in `getLogger()` or `logger.ts` is changed.
- [ ] `npx vitest run tests/unit/utils/progress-display.test.ts` → 44 passed, 0 failed.
- [ ] `npm run lint && npm run format:check && npm run typecheck` → green.
- [ ] **OR (precondition-absent path):** no edit made; 44/44 confirmed; divergence
      documented in the task result.

---

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed to
implement this successfully?_ **Yes** — the change is a literal single-character (`?.`)
edit at an explicitly located block, with a verbatim comment to write, verified
before/after test counts, and a hard precondition gate that tells the agent exactly
what to do if the target line is absent. No judgement calls remain.

### Documentation & References

```yaml
# MUST READ — the authoritative bug report + suggested fix
- docfile: plan/005_d32a2ecf61cd/bugfix/001_d4c62ddb6810/TEST_RESULTS.md
  section: "Major Issues > Issue 1"
  why: Root-cause analysis (setMaxListeners is inherited, not own; vi.stubGlobal spread
        drops it), the 14 failing tests, the before/after commit evidence (b03ed87 = 44
        pass; 4e6d2ef = 14 fail), and the verbatim suggested fix.
  critical: The suggested fix is a one-character `?.` addition. Do not over-engineer.

# MUST READ — precondition finding (authored with this PRP)
- docfile: plan/005_d32a2ecf61cd/bugfix/001_d4c62ddb6810/P1M1T1S1/research/setMaxListeners-precondition.md
  section: "0. CRITICAL PRECONDITION FINDING"
  why: Documents that the bug line is ABSENT on current HEAD fd7352c (it lives only on
        main/4e6d2ef). The implementer MUST run the precondition probe before editing.
  critical: If the probe finds the line absent, the task is a verified no-op — do NOT
        invent the line or add a speculative guard.

# PATTERN FILE — the only file that may be edited
- file: src/utils/logger.ts
  why: Contains getLogger() (function starts ~line 437 on current HEAD). On trees that
        contain 4e6d2ef, the offending block is the `if (!loggerCache.size) { process.setMaxListeners(30); }`
        guard placed right after the cache-hit early-return and before "Auto-generate
        correlation ID".
  pattern: |
    // current HEAD body (NO setMaxListeners):
    export function getLogger(context, options?) {
      const cacheKey = getCacheKey(context, options);
      const cached = loggerCache.get(cacheKey);
      if (cached) return cached;
      // ... (no setMaxListeners block on current HEAD)
      const correlationId = options?.correlationId || generateCorrelationId();
      ...
    }
    // main/4e6d2ef body (HAS the block at ~445-449, right after the cache early-return):
      if (!loggerCache.size) {
        process.setMaxListeners(30);   // ← change to process.setMaxListeners?.(30);
      }
  gotcha: >
    loggerCache = `new Map<string, Logger>()` (~line 204). The `!loggerCache.size` guard
    means the cap is raised only on the FIRST logger creation. Do not remove or alter the
    guard — only add `?.` to the call inside it.

# TEST FILE (read-only in S1 — do NOT edit; S2 owns the regression test)
- file: tests/unit/utils/progress-display.test.ts
  why: The 44-test suite that regressed. Its `vi.stubGlobal('process', {...originalProcess, ...})`
        (around line 174) is the stub that drops the inherited setMaxListeners. Reading it
        confirms WHY the fix works; do not modify it in S1.
```

### Current Codebase tree (relevant slice)

```bash
src/utils/
└── logger.ts   # EDIT (conditionally) — getLogger() setMaxListeners call
tests/unit/utils/
└── progress-display.test.ts   # READ-ONLY — 44-test suite (the regression victim)
```

### Desired Codebase tree with files to be added/edited

```bash
src/utils/
└── logger.ts   # MODIFIED — only if precondition probe finds the offending line present
# No new files. No test files modified in S1.
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — PRECONDITION DIVERGENCE. The offending line exists ONLY on main/4e6d2ef,
// not on current HEAD fd7352c. Probe with `grep -n setMaxListeners src/utils/logger.ts`
// BEFORE editing. If absent → no-op (document + stop). If present → apply the `?.` fix.

// CRITICAL — setMaxListeners is INHERITED, not own:
//   process.hasOwnProperty('setMaxListeners') === false
// vi.stubGlobal('process', { ...originalProcess, ... }) spreads ONLY enumerable own
// props → the inherited method is dropped → unguarded call throws under the stub.
// Optional chaining (`?.`) is the minimal correct fix.

// GOTCHA — keep the `if (!loggerCache.size)` guard intact. It limits the listener-cap
//   raise to first-logger-creation only. Only the inner call gains `?.`.

// GOTCHA — prettier is enforced as ERROR (`prettier/prettier: error`). After editing,
//   run `npm run fix` (or `npx prettier --write src/utils/logger.ts`) before format:check.

// GOTCHA — do NOT add a regression test in S1. That is S2 (P1.M1.T1.S2). Editing the
//   test file here violates the contract and collides with S2.
```

---

## Implementation Blueprint

### Data models and structure
None — pure behavioral one-character edit; no types, constants, or classes.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: PRECONDITION PROBE  (MANDATORY FIRST — do not skip)
  - RUN: `grep -n "setMaxListeners" src/utils/logger.ts`
  - RUN: `git merge-base --is-ancestor 4e6d2ef HEAD && echo "BUG_BRANCH_PRESENT" || echo "BUG_BRANCH_ABSENT"`
  - RUN: `npx vitest run tests/unit/utils/progress-display.test.ts 2>&1 | tail -5`
  - BRANCH A (line present / tests show 14 failed): proceed to Task 2, then Task 3.
  - BRANCH B (line ABSENT / tests show 44 passed — CURRENT TREE STATE):
      * Do NOT edit src/utils/logger.ts. There is no bug to fix on this tree.
      * Record in the task result: "Precondition not met — offending line absent on HEAD
        <sha>; bug lives only on main@4e6d2ef. 44/44 progress-display tests already pass.
        No-op." and STOP.
  - PLACEMENT: run from repo root.

Task 2: EDIT src/utils/logger.ts  (ONLY if Task 1 → Branch A)
  - LOCATE: the block `if (!loggerCache.size) { process.setMaxListeners(30); }` inside
        getLogger() (right after the cache-hit early-return, before "Auto-generate
        correlation ID"). On 4e6d2ef this is ~lines 445-449.
  - CHANGE: `process.setMaxListeners(30);`  →  `process.setMaxListeners?.(30);`
        (add the optional-chaining operator `?.` — a 2-character insertion).
  - REPLACE the two-line comment above it with the 4-line rationale comment from the
        "Technical requirements" section (documents the inheritance/stub reason).
  - DO NOT TOUCH: the `if (!loggerCache.size)` guard, any other line in getLogger(),
        anything else in logger.ts.
  - NAMING/PLACEMENT: in-place edit; no new symbols.

Task 3: VERIFY  (run in both branches; in Branch B this confirms the clean state)
  - RUN: `npm run fix`  (lint:fix + prettier --write) — auto-fix any formatting nit.
  - RUN: `npm run lint && npm run format:check && npm run typecheck`  → must be green.
  - RUN: `npx vitest run tests/unit/utils/progress-display.test.ts`  → 44 passed, 0 failed.
  - EXPECTED:
      * Branch A: the 14 previously-failing tests now pass (44/44).
      * Branch B: already 44/44; nothing changed.
  - DO NOT RUN the full `npm run test:run` or `npm run validate`-with-tests unless asked;
        S1's scope is the progress-display suite + the static gates. (Note: the project's
        `validate` script is lint+format:check+typecheck only — it does NOT include tests;
        that is a separate Issue 2 / P1.M2.T1, out of scope here.)
```

### Implementation Patterns & Key Details

```ts
// PATTERN — the exact diff (Branch A). The `?.` is the entire semantic change.

// BEFORE (main / 4e6d2ef, ~src/utils/logger.ts:444-449):
  // Prevent MaxListenersExceededWarning from pino transport workers
  // Each transport worker attaches an exit listener to process
  if (!loggerCache.size) {
    process.setMaxListeners(30);
  }

// AFTER:
  // Prevent MaxListenersExceededWarning from pino transport workers.
  // Optional chaining: setMaxListeners is inherited from EventEmitter.prototype, not an
  // own property of process; partial stubs via vi.stubGlobal lose it. `?.` keeps this
  // safe in tests while preserving production behavior (real process always has it).
  if (!loggerCache.size) {
    process.setMaxListeners?.(30);
  }

// PATTERN — on the CURRENT HEAD (fd7352c) there is NO such block. getLogger() goes
// straight from the cache early-return to `const correlationId = ...`. Branch B applies.
```

### Integration Points

```yaml
CALLER (no edit):
  - getLogger() is called widely (agents, tools, core). The `?.` change is transparent to
    all callers — same return type, same side effect on real process, no-op under stubs.

TESTS (no edit in S1):
  - tests/unit/utils/progress-display.test.ts — the victim suite; goes 14 fail → 44 pass
    on Branch A. Already 44/44 on Branch B. Do NOT modify in S1 (S2 adds the regression test).

GIT / ORCHESTRATOR:
  - The divergence (bug on main@4e6d2ef, absent on current HEAD) is an orchestrator-level
    concern. S1's job is conditional: fix-if-present, verify-always, document-the-state.
    If the orchestrator intended this fix for main, it should apply the PRP on a main-based
    checkout (Branch A). On the current tree, Branch B (no-op) is the correct outcome.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# After Task 2 (Branch A). Skip the edit step in Branch B.
npm run fix                                              # lint:fix + prettier --write
npm run lint && npm run format:check && npm run typecheck   # must be green
# Targeted file checks (faster):
npx prettier --check src/utils/logger.ts
npx eslint src/utils/logger.ts
# Expected: zero errors. If prettier fails, `npm run fix` resolves it.
```

### Level 2: Unit Tests (Component Validation)

```bash
# THE primary acceptance gate for this subtask (both branches):
npx vitest run tests/unit/utils/progress-display.test.ts
# Expected: Test Files 1 passed (1) / Tests 44 passed (44).
#   Branch A: flips 14 failures → 44 pass.
#   Branch B: already 44/44 (confirms clean state; no edit was needed).
```

### Level 3: Integration Testing (System Validation)

```bash
# N/A for S1. The fix is a single-call hardening with no integration surface.
# (Optional sanity, Branch A only): confirm logger creation still raises the listener
# cap on a real process:
npx tsx -e "import('./src/utils/logger.ts').then(m => { const before = process.getMaxListeners(); m.getLogger('probe'); console.log('cap>=30:', process.getMaxListeners() >= 30); })"
# Expected: cap>=30: true  (proves production behavior preserved).
```

### Level 4: Creative & Domain-Specific Validation

```bash
# N/A — one-character hardening fix. Domain check (record in commit message / task result):
#   - Optional chaining is a no-op on real process (method always present) → production intact.
#   - Under partial vi.stubGlobal stubs the call becomes a no-op instead of throwing → tests fixed.
#   - The `if (!loggerCache.size)` guard still limits the raise to first-logger-creation.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] Precondition probe (Task 1) executed and its branch (A or B) recorded.
- [ ] **Branch A:** `npm run lint && npm run format:check && npm run typecheck` green.
- [ ] **Branch A:** `npx vitest run tests/unit/utils/progress-display.test.ts` → 44/44.
- [ ] **Branch B:** same 44/44 confirmed with NO edit to `src/utils/logger.ts`.

### Feature Validation
- [ ] **Branch A:** `src/utils/logger.ts` calls `process.setMaxListeners?.(30)` inside the
      `if (!loggerCache.size)` guard; comment documents the inheritance/stub rationale.
- [ ] **Branch A:** no other line in `getLogger()` or `logger.ts` changed.
- [ ] **Branch A:** production listener-cap raise still effective (Level 3 sanity passes).
- [ ] **Branch B:** no fabricated line, no speculative guard added; divergence documented.

### Code Quality Validation
- [ ] Only `src/utils/logger.ts` is (conditionally) modified — no test file, no other source.
- [ ] Comment explains WHY (`?.`), not just WHAT.
- [ ] No regression test added in S1 (deferred to S2 / P1.M1.T1.S2).
- [ ] No docs changes (the comment IS the documentation, per work-item contract #5).

### Documentation & Deployment
- [ ] Inline comment updated to explain the optional-chaining rationale.
- [ ] Task result states which branch (A/B) was taken and the HEAD sha, so the
      orchestrator/human can reconcile the main-vs-current divergence.

---

## Anti-Patterns to Avoid

- ❌ Don't skip the Task 1 precondition probe — the bug line is absent on the current HEAD.
- ❌ Don't fabricate the `process.setMaxListeners(30)` line if it isn't there (Branch B = no-op).
- ❌ Don't add a speculative `if (typeof process.setMaxListeners === 'function')` guard — the contract is `?.`, nothing heavier.
- ❌ Don't remove or alter the `if (!loggerCache.size)` guard — only the inner call gains `?.`.
- ❌ Don't edit `tests/unit/utils/progress-display.test.ts` or add a regression test in S1 — that's S2.
- ❌ Don't edit docs — the comment update is the only documentation (work-item #5).
- ❌ Don't run `npm run test:run` (full suite) as the S1 gate — scope is the progress-display suite + static gates. (`validate` doesn't include tests; that's Issue 2 / P1.M2.T1, out of scope.)
- ❌ Don't "fix" anything else in `logger.ts` while in there.

---

## Confidence Score

**Branch A (line present): 10/10.** Literal one-character (`?.`) edit at an explicitly
located block, verbatim comment supplied, verified before/after test counts (14 fail →
44 pass), and verified validation commands. No unknowns.

**Branch B (line absent — current tree): 10/10.** A pure verification no-op with nothing
to change; 44/44 already confirmed.

**Overall note (outside the PRP's control):** the only residual risk is orchestrator-level
— whether the implementation runs on a tree containing `4e6d2ef` (Branch A, fix applies)
or the current diverged HEAD (Branch B, no-op). The PRP is robust to both: Task 1 gates
the path, both paths have deterministic success criteria, and the divergence is documented
for human reconciliation. The implementing agent cannot fail either way if it follows
Task 1's branch logic.
