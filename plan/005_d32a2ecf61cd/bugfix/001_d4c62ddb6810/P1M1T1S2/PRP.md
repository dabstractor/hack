# PRP — P1.M1.T1.S2: Regression test — `getLogger` under partial `process` stub lacking `setMaxListeners`

> **Bugfix subtask** — Issue 1 of
> `plan/005_d32a2ecf61cd/bugfix/001_d4c62ddb6810/TEST_RESULTS.md`.
> Test-only change: add a regression test that guards against
> `process.setMaxListeners(30)` (the unguarded form from `main` commit `4e6d2ef`)
> ever returning to `getLogger()` and breaking partial-`process`-stub test
> environments (14 `progress-display` tests on `main`).

---

## ⚠️ STOP — READ THIS PRECONDITION BLOCK FIRST ⚠️

**The offending `process.setMaxListeners(30)` line is NOT present in the current
working tree, and S1 was completed as a NO-OP.** This was probed and confirmed at
PRP-authoring time and **must be re-probed before writing the test.**

| Probe (run these FIRST) | Expected result | Meaning |
| --- | --- | --- |
| `grep -n "setMaxListeners" src/utils/logger.ts` | **no matches** | bug line is absent in this tree |
| `npm run test:run -- tests/unit/utils/progress-display.test.ts` | **44 passed / 0 failed** | regression does NOT reproduce here |
| `git merge-base --is-ancestor 4e6d2ef HEAD && echo YES \|\| echo NO` | **NO** | regression commit `4e6d2ef` is NOT in current history |

**Why this matters:** The regression was introduced by commit `4e6d2ef` ("Add task CLI
subcommand and delta execution mode"), which lives on `main` but is **not an ancestor**
of the current (detached) HEAD. The bug report was written against `main`; this branch
diverged before `4e6d2ef` landed. Consequently:

1. **S1 (the optional-chaining fix) was a no-op** — there was nothing to change. It is
   marked Complete because its PRP was written to succeed in exactly this scenario
   (see `plan/005_.../P1M1T1S1/PRP.md` "STOP — READ THIS PRECONDITION BLOCK FIRST").
   Confirmed: `grep -c "setMaxListeners" src/utils/logger.ts` → `0`.
2. **There is nothing to "revert" to demonstrate test failure.** The work-item contract
   says *"Verify the test FAILS without the fix from S1 (by temporarily reverting)."*
   That literal step is **impossible** here because S1 changed zero bytes. See the
   adapted methodology in **Validation Loop → Level 2** below.

**The regression test is STILL WORTH WRITING** — as a forward-looking tripwire:
when `main`'s `4e6d2ef` (or any future re-introduction of the unguarded
`process.setMaxListeners(30)` call) merges/rebases into this tree, this test will fail
and force the unguarded line to be either removed or guarded with `?.`. Until then it
passes trivially (it is a no-op assertion against a code path that doesn't exist). This
is a legitimate and common pattern for regression tests written against a bug on another
branch.

**This PRP is written to succeed regardless of which scenario the orchestrator's tree
is in:** if the probe later finds the line present (tree moved forward to include
`4e6d2ef`), the same test still applies and now actively guards the live code path.

---

## Goal

**Feature Goal**: Add a self-contained regression test to `tests/unit/logger.test.ts`
that proves `getLogger()` does **not** throw when invoked under a partial `process`
stub that lacks the inherited `setMaxListeners` method — the exact condition that
broke 14 `progress-display` tests on `main`/`4e6d2ef`.

**Deliverable**: One new `it(...)` test case (≈12 lines) added inside the existing
`describe('getLogger()', …)` block of `tests/unit/logger.test.ts`, plus adding `vi` to
the file's `vitest` import. No source files, no docs, no other test files touched.

**Success Definition**:
- `npx vitest run tests/unit/logger.test.ts` → **all tests pass** (the new one included).
- The new test is located inside the existing `describe('getLogger()')` block and uses
  the **`vi.stubGlobal('process', …)` approach** (Approach (a)) so it mirrors the real
  `progress-display.test.ts` failure scenario.
- The new test calls `clearLoggerCache()` before `getLogger` so the first-logger-creation
  path (`if (!loggerCache.size)`) is exercised (this is where the original unguarded line
  ran).
- (Adapted, see Validation Loop Level 2) When the unguarded `process.setMaxListeners(30)`
  line is temporarily injected to simulate `4e6d2ef`, the new test **fails**; with the
  line absent or guarded (`?.`), the new test **passes**.
- `npm run test:run -- tests/unit/logger.test.ts tests/unit/utils/progress-display.test.ts`
  → both files fully green (no collateral damage).

## User Persona (if applicable)

**Target User**: PRP-pipeline maintainer / contributor merging `main` into feature branches.

**Use Case**: Catching re-introduction of the `process.setMaxListeners(30)` unguarded call
automatically at test time, rather than discovering 14 broken `progress-display` tests
after a merge from `main`.

**Pain Points Addressed**: The `main` regression (`4e6d2ef`) silently passed `npm run
validate` (lint/format/typecheck are static-only) and only surfaced as 14 runtime test
failures. A dedicated tripwire test makes the hazard explicit and self-documenting.

## Why

- **Forward-looking regression protection.** The unguarded `process.setMaxListeners(30)`
  pattern exists on `main` and will re-enter this tree on the next merge/rebase from
  `main`. This test makes that re-entry fail loudly and locally (in `logger.test.ts`)
  rather than as 14 confusing failures in `progress-display.test.ts`.
- **Documents a non-obvious test-environment hazard.** `process.setMaxListeners` is
  **inherited** from `EventEmitter.prototype`, not an own property
  (`process.hasOwnProperty('setMaxListeners') === false`). `vi.stubGlobal('process',
  {...originalProcess, …})` spreads only **enumerable own** properties, so the inherited
  method is silently dropped from the stub. A test that encodes this fact prevents future
  contributors from re-introducing the unguarded call OR from "fixing" the guard away.
- **Closes the Issue-1 loop.** S1 hardened (or confirmed the absence of) the production
  line; S2 hardens the test side so the regression cannot recur undetected.
- **Zero production impact / zero new dependencies.** Test-only addition.

## What

Add one `it(...)` case inside the existing `describe('getLogger()', …)` block
(`tests/unit/logger.test.ts`, currently lines 72–117) that:

1. Stubs the global `process` with a partial object that deliberately omits
   `setMaxListeners` (via spread, which drops the inherited method) — Approach (a).
2. Asserts `expect(() => getLogger('PartialStubTest')).not.toThrow()`.
3. Restores the global via `vi.unstubAllGlobals()` (in a `finally` or after the assertion).

Also add `vi` to the file's existing `vitest` import (line 18).

### Success Criteria

- [ ] New `it('should not throw when process lacks setMaxListeners (partial stub)', …)`
      lives inside `describe('getLogger()')`.
- [ ] Test uses Approach (a): `vi.stubGlobal('process', { ...process, on: vi.fn(), off: vi.fn() })`
      (spread omits inherited `setMaxListeners`).
- [ ] Test calls `clearLoggerCache()` immediately before the `getLogger` call (belt-and-
      suspenders on top of the file-level `beforeEach`).
- [ ] Test restores the global via `vi.unstubAllGlobals()` regardless of pass/fail.
- [ ] `npx vitest run tests/unit/logger.test.ts` → 100% green, new test included.
- [ ] No source files, docs, or other test files modified.

## All Needed Context

### Context Completeness Check

_Pass._ A developer with no prior knowledge of this repo can implement this from:
(a) the exact insertion point (line numbers + surrounding code quoted below), (b) the
authoritative test body, (c) the precondition probe table, and (d) the adapted
"fails-without-fix" methodology. The change is ~13 lines in one file.

### Documentation & References

```yaml
# MUST READ - Include these in your context window

- file: src/utils/logger.ts
  why: The System-Under-Test's production code. Understand getLogger() (lines ~436–468):
        it caches by key, and (ON main/4e6d2ef ONLY) runs process.setMaxListeners(30)
        inside `if (!loggerCache.size)` on first creation. In THIS tree that block is
        ABSENT — confirm with the precondition probe.
  pattern: |
    export function getLogger(context: string, options?: LoggerConfig): Logger {
      const cacheKey = getCacheKey(context, options);
      const cached = loggerCache.get(cacheKey);
      if (cached) return cached;
      // [ON main ONLY, ABSENT HERE] if (!loggerCache.size) { process.setMaxListeners(30); }
      ...
      loggerCache.set(cacheKey, logger);
      return logger;
    }
  gotcha: |
    The setMaxListeners call (when present) is guarded by `if (!loggerCache.size)` — it
    ONLY runs on the FIRST logger creation when the cache is empty. The regression test
    MUST call clearLoggerCache() before getLogger so this path executes; otherwise the
    test passes trivially even with the unguarded line present (false-negative).

- file: tests/unit/logger.test.ts
  why: TARGET FILE. Insert the new test inside `describe('getLogger()', …)` (lines 72–117).
  pattern: |
        # Line 18 — add `vi` to the import (it is currently absent):
        import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
        # Lines 72–117 — the existing describe('getLogger()') block. Insert the new `it`
        # AFTER the last existing test ('should accept LogLevel enum for level option',
        # ~line 110) and BEFORE the block's closing `});` (~line 117).
  gotcha: |
    `vi` is currently NOT imported (line 18 omits it). Although `globals: true` in
    vitest.config.ts makes `vi` available globally, ADD it to the import for clarity and
    to match the rest of the suite's explicit-import style (progress-display.test.ts
    imports vi explicitly). Do NOT rely on the implicit global — lint may flag it.

- file: tests/unit/utils/progress-display.test.ts
  why: The REAL failure scenario this test mirrors. Lines ~174–186 show the exact
        `vi.stubGlobal('process', { ...originalProcess, stdout: {...}, on: vi.fn(), off: vi.fn() })`
        pattern that drops the inherited setMaxListeners and (on main) triggered the
        TypeError. Copy this stub shape verbatim into the new logger test.
  pattern: |
        vi.stubGlobal('process', {
          ...originalProcess,           // spread copies OWN enumerable props ONLY → setMaxListeners (inherited) is ABSENT
          on: vi.fn(),
          off: vi.fn(),
        });
        // ... code under test ...
        vi.unstubAllGlobals();
  critical: |
    Object spread `{...process}` does NOT copy inherited properties. setMaxListeners is
    defined on EventEmitter.prototype, NOT on process itself
    (process.hasOwnProperty('setMaxListeners') === false). So the stub genuinely lacks it.

- docfile: plan/005_d32a2ecf61cd/bugfix/001_d4c62ddb6810/architecture/test-infrastructure.md
  section: "Issue 1: Logger Regression — Detailed Analysis" → "Where to Add the Regression Test"
  why: Confirms tests/unit/logger.test.ts (NOT tests/unit/utils/logger.test.ts) is the
        target; documents both approaches (a)/(b) and the stub mechanics.
  critical: |
    The doc's Approach (b) (`delete (process as any).setMaxListeners`) is BROKEN for an
    INHERITED property: `delete` on a non-own inherited property is a silent no-op in JS
    — the method remains reachable via the prototype, so getLogger would NOT throw and the
    test would never catch the regression. DO NOT use (b) as written. Use Approach (a)
    (vi.stubGlobal). See "Known Gotchas" below.

- docfile: plan/005_d32a2ecf61cd/bugfix/001_d4c62ddb6810/P1M1T1S1/PRP.md
  section: "STOP — READ THIS PRECONDITION BLOCK FIRST"
  why: S1's PRP already documented and resolved the same line-absent precondition. S2
        inherits that state (S1 = no-op). Read it to understand why "revert S1" is not a
        meaningful operation here.

- url: https://vitest.dev/api/vi.html#vi-stubglobal
  why: vi.stubGlobal replaces a global for the duration of the test; vi.unstubAllGlobals
        restores all stubs. This is the clean, auto-restoring mechanism (preferred over
        manual Object.defineProperty + try/finally).
  critical: vi.unstubAllGlobals() restores the ORIGINAL process reference exactly — no
            risk of leaking a mutated global into sibling tests.

- url: https://nodejs.org/api/events.html#emittersetmaxlistenersn
  why: Confirms setMaxListeners lives on EventEmitter (the prototype), inherited by
        process — the root cause of the stub dropping it.
```

### Current Codebase tree (relevant slice)

```bash
src/utils/
└── logger.ts                      # SUT — getLogger() at ~line 436; setMaxListeners block ABSENT in this tree
tests/unit/
├── logger.test.ts                 # ← TARGET FILE (470 lines); describe('getLogger()') at line 72
└── utils/
    └── progress-display.test.ts   # the 14-failure scenario on main; stub pattern to mirror (lines ~174-186)
vitest.config.ts                   # globals: true → vi available globally (but import it anyway)
```

> NOTE: `tests/unit/utils/logger.test.ts` does **NOT** exist — the PRD's suggested path was
> slightly wrong. The real file is `tests/unit/logger.test.ts`. (Verified via `ls`.)

### Desired Codebase tree with files to be added and responsibility of file

```bash
# No new files. One existing file modified (one new `it` block + one import tweak):
tests/unit/logger.test.ts   # +`vi` in import; +1 regression test inside describe('getLogger()')
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: process.setMaxListeners is INHERITED from EventEmitter.prototype, NOT an own
//   property of process. `process.hasOwnProperty('setMaxListeners') === false`. Therefore:
//     • `{ ...process }` (spread) drops it → the stub genuinely lacks it.  (Approach (a) ✓)
//     • `delete process.setMaxListeners` is a NO-OP on an inherited property → the method
//       stays reachable via the prototype → getLogger would NOT throw → test NEVER catches
//       the regression.  (Approach (b) ✗ — DO NOT USE as written in the arch doc.)
//
// CRITICAL: The original unguarded block is gated by `if (!loggerCache.size)` — it runs
//   ONLY on the FIRST logger creation when the cache is empty. If the regression test
//   calls getLogger while a cached logger exists, the setMaxListeners path is skipped and
//   the test passes trivially (false-negative). MITIGATION: call clearLoggerCache()
//   immediately before getLogger in the test body. (The file's beforeEach already clears
//   the cache, but be explicit — another test in the same file could populate the cache
//   if test ordering changes.)
//
// GOTCHA: vi.mock/vi.stubGlobal are HOISTED only for module mocks; vi.stubGlobal itself
//   is a runtime call and runs where written. Call it INSIDE the it() body (after
//   beforeEach's clearLoggerCache), not at module top-level.
//
// GOTCHA: After the test, the logger 'PartialStubTest' remains in the REAL loggerCache.
//   The file-level afterEach calls clearLoggerCache(), so it's cleaned up automatically —
//   no extra teardown needed. Do NOT add a manual cache clear beyond what afterEach does.
//
// GOTCHA (globals): vitest.config.ts sets `globals: true`, so `vi` is usable without an
//   import. But the file's line-18 import does NOT currently include `vi`. ADD it for
//   clarity and consistency with sibling test files. (Lint/style prefers explicit imports.)
//
// PRECONDITION (line-absent): In THIS tree, src/utils/logger.ts has NO setMaxListeners
//   call at all (grep -c = 0). So the new test passes trivially here. It only FAILS when
//   the unguarded line is present (e.g. after merging main's 4e6d2ef). This is the
//   intended forward-looking tripwire behavior — NOT a tautology bug.
```

## Implementation Blueprint

### Data models and structure

None. Test-only; no models, schemas, or types introduced.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: PRECONDITION GATE (run FIRST, read-only — do not skip)
  - RUN: grep -n "setMaxListeners" src/utils/logger.ts
      → Expect NO matches (line absent in this tree). If matches exist, the tree has moved
        forward to include 4e6d2ef; proceed anyway (the test is still correct and now live).
  - RUN: git merge-base --is-ancestor 4e6d2ef HEAD && echo YES || echo NO
      → Expect NO. If YES, the regression line is present; the test now actively guards it.
  - RUN: npm run test:run -- tests/unit/utils/progress-display.test.ts
      → Expect 44 passed. (If 14 fail, the regression IS live and Task 1's test will fail
        too until the production line is guarded — but that is S1's concern, already Complete.)
  - DECIDE: regardless of outcome, proceed to Task 1. The test is correct in all scenarios.
  - RECORD: note the precondition result in the task's completion summary (mirrors S1's
      documentation discipline).

Task 1: MODIFY tests/unit/logger.test.ts — add `vi` to the vitest import
  - LOCATE: line 18:
      import { afterEach, beforeEach, describe, expect, it } from 'vitest';
  - REPLACE WITH:
      import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
  - WHY: the new test calls vi.stubGlobal / vi.unstubAllGlobals. Even though `globals: true`
      makes `vi` available implicitly, the explicit import matches the file's style and
      sibling files (progress-display.test.ts imports vi explicitly).

Task 2: MODIFY tests/unit/logger.test.ts — add the regression test inside describe('getLogger()')
  - LOCATE: the describe('getLogger()') block (lines 72–117). Its LAST existing test is
      `it('should accept LogLevel enum for level option', ...)` ending ~line 116, followed
      by the block's closing `});` at ~line 117.
  - INSERT the following `it(...)` IMMEDIATELY BEFORE that closing `});` (i.e. as the last
      test in the getLogger() block):
      it('should not throw when process lacks setMaxListeners (partial stub)', () => {
        // Mirror the real progress-display.test.ts stub: spread copies OWN enumerable
        // props only, so the INHERITED setMaxListeners (from EventEmitter.prototype) is
        // absent. On main/4e6d2ef this made getLogger() throw
        // "TypeError: process.setMaxListeners is not a function".
        vi.stubGlobal('process', {
          ...process,
          on: vi.fn(),
          off: vi.fn(),
        });
        try {
          // Cache MUST be empty so the first-creation path (where setMaxListeners runs)
          // is exercised. beforeEach already cleared it; be explicit for robustness.
          clearLoggerCache();
          expect(() => getLogger('PartialStubTest')).not.toThrow();
        } finally {
          vi.unstubAllGlobals();
        }
      });
  - PRESERVE: all existing tests, the file-level beforeEach/afterEach (lines 34–40), all
      other describe blocks, and the existing imports of getLogger/clearLoggerCache/etc.
  - DO NOT add assertions about logger shape, log level, or cache contents — the contract
      is a single not.toThrow() regression guard. Keep it minimal.
  - DO NOT modify src/utils/logger.ts, progress-display.test.ts, or any other file.

Task 3: VERIFY (see Validation Loop)
  - RUN: npx vitest run tests/unit/logger.test.ts   → all pass, new test green.
  - RUN (regression sweep): npm run test:run -- tests/unit/logger.test.ts tests/unit/utils/progress-display.test.ts
      → both files fully green.
```

### Implementation Patterns & Key Details

```ts
// PATTERN: partial-process-stub regression test (Approach (a) — the ONLY correct approach).
//
// Why spread omits setMaxListeners:
//   process.setMaxListeners is inherited from EventEmitter.prototype (not an own prop).
//   `{ ...process }` copies enumerable OWN properties only → inherited methods are dropped.
//
// Why the try/finally + unstubAllGlobals:
//   Guarantees the real `process` is restored even if the assertion throws, so no sibling
//   test sees a neutered process global. (vi.unstubAllGlobals restores the exact original.)
//
// Why clearLoggerCache() inside the test:
//   The (main-only) unguarded block is gated by `if (!loggerCache.size)`. If a cached
//   logger existed, the path would be skipped and the test would be a false-negative.
it('should not throw when process lacks setMaxListeners (partial stub)', () => {
  vi.stubGlobal('process', { ...process, on: vi.fn(), off: vi.fn() });
  try {
    clearLoggerCache();                                  // exercise first-creation path
    expect(() => getLogger('PartialStubTest')).not.toThrow();
  } finally {
    vi.unstubAllGlobals();                               // ALWAYS restore real process
  }
});

// ANTI-PATTERN (do NOT use — Approach (b) is broken for inherited props):
//   delete (process as any).setMaxListeners;   // ← NO-OP on inherited property!
//   // process.setMaxListeners is STILL reachable via EventEmitter.prototype, so getLogger
//   // would NOT throw even with the unguarded line present → the test can never fail.
//   // If a non-stubGlobal variant is ever needed, use:
//   //   Object.defineProperty(process, 'setMaxListeners', { value: undefined, configurable: true });
//   //   // ... test ...
//   //   delete process.setMaxListeners;   // removes the own shadow → inherited method returns
//   // ...but vi.stubGlobal is strictly cleaner. Prefer it.
```

### Integration Points

```yaml
DATABASE:
  - none
CONFIG:
  - none (no env-var or settings changes)
ROUTES / API:
  - none
BUILD / TOOLING:
  - none (no package.json, tsconfig, or vitest.config changes)
DEPENDENCIES:
  - DEPENDS-ON (completed): P1.M1.T1.S1 — src/utils/logger.ts must be in its post-S1 state.
      NOTE: S1 was a NO-OP in this tree (the regression line was never present here). The
      test is written to be correct whether or not the line exists/guarded.
  - RELATES-TO (no action): P1.M2.T1.S1 (add test:run to `validate` script) — independent.
  - RELATES-TO (no action): P1.M3.* (integration tests) — independent.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# After the edit — confirm formatting/lint on the changed file.
npx prettier --check tests/unit/logger.test.ts
# Expected: passes. If the inserted block reformats, run `npx prettier --write tests/unit/logger.test.ts`.

npm run lint
# Expected: zero NEW errors. (tsconfig.build.json excludes tests/ from typecheck, so the
# new test is not type-checked by `npm run typecheck` — that's expected and fine.)

# Typecheck NOTE: `npm run typecheck` = `tsc --noEmit -p tsconfig.build.json` with
# `exclude: ["tests"]`. Test files are NOT type-checked. The new test uses only
# already-imported symbols (getLogger, clearLoggerCache) + vi (added in Task 1), so it is
# structurally sound by construction. Do NOT expect typecheck to cover it.
```

### Level 2: Unit Tests (Primary Validation — Component + Adapted "Fails-Without-Fix")

```bash
# (A) New test passes in the current tree (line absent → trivial pass):
npx vitest run tests/unit/logger.test.ts
# Expected: all tests pass, including:
#   Logger utility > getLogger() > should not throw when process lacks setMaxListeners (partial stub)

# (B) ADAPTED "fails-without-the-fix" demonstration.
#     The contract says "verify the test FAILS without the fix from S1 (by temporarily
#     reverting)". But S1 was a NO-OP in this tree (it changed nothing), so there is
#     literally nothing to revert. Instead, simulate the PRE-FIX state from main/4e6d2ef
#     by TEMPORARILY INJECTING the unguarded line, then confirm the test fails, then
#     REMOVE it. Do this on a clean git state so nothing leaks:
#
#   1. git stash   (ensure no uncommitted changes interfere) — or commit the new test first
#   2. TEMPORARILY edit src/utils/logger.ts getLogger(): add inside the function, right
#      after the `if (cached) return cached;` line:
#          if (!loggerCache.size) { process.setMaxListeners(30); }
#   3. npx vitest run tests/unit/logger.test.ts -t "partial stub"
#        → Expected: the new test FAILS with
#          "TypeError: process.setMaxListeners is not a function"  (proves the tripwire works)
#   4. REVERT the temporary injection:  git checkout -- src/utils/logger.ts
#      (or delete the injected line by hand)
#   5. Re-run:  npx vitest run tests/unit/logger.test.ts
#        → Expected: all pass again (new test green).
#   6. VERIFY cleanup:  grep -n "setMaxListeners" src/utils/logger.ts
#        → Expected: NO matches (the injected line is gone).  <-- CRITICAL, do not skip.
#
# If step (B) is undesirable in the orchestrator's environment (e.g. it forbids touching
# src/ even ephemerally), it may be SKIPPED — the test is still valid and the precondition
# probe (Task 0) already documents WHY it cannot fail in the current tree. Record the skip
# reason in the task summary. The test's value is forward-looking (it fails when 4e6d2ef
# merges in), not retroactive.
```

### Level 3: Integration / Regression Sweep (No Collateral Damage)

```bash
# Confirm the new test + the previously-affected suite are both green together.
npm run test:run -- tests/unit/logger.test.ts tests/unit/utils/progress-display.test.ts
# Expected: 2 files passed; logger.test.ts all-green (incl. new test);
#           progress-display.test.ts 44/44 green.
#
# (progress-display.test.ts must remain 44/44 — the new logger test must not have leaked a
#  stubbed `process` global into it. The try/finally + vi.unstubAllGlobals guarantees this.)
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Optional broad sweep: confirm nothing else in tests/unit/ broke from a leaked global.
npm run test:run -- tests/unit/
# Expected: all green. (This is broader than strictly necessary; Level 3 is the real gate.)

# DO NOT run `npm run test:run` (full, incl. integration) or `npm run test:coverage` as a
# gate for THIS task — coverage thresholds are project-wide and owned by other work; the
# 100% coverage gate is not part of S2's contract. Full-suite greenness is P1.M2/P1.M3 scope.
```

## Final Validation Checklist

### Technical Validation

- [ ] Task 0 precondition probe run and result recorded (line absent expected; `4e6d2ef` not ancestor expected).
- [ ] Level 1: `npx prettier --check tests/unit/logger.test.ts` passes.
- [ ] Level 1: `npm run lint` introduces zero new errors.
- [ ] Level 2(A): `npx vitest run tests/unit/logger.test.ts` → all pass, new test green.
- [ ] Level 2(B): (if run) injected unguarded line makes the new test fail; line removed;
      `grep setMaxListeners src/utils/logger.ts` returns nothing afterward.
- [ ] Level 3: `npm run test:run -- tests/unit/logger.test.ts tests/unit/utils/progress-display.test.ts`
      → both files fully green (no leaked global).
- [ ] Only `tests/unit/logger.test.ts` modified; no source/docs/other-test changes.

### Feature Validation

- [ ] New test lives inside `describe('getLogger()')` (not at file top-level, not in another describe).
- [ ] Test uses Approach (a) `vi.stubGlobal('process', { ...process, on: vi.fn(), off: vi.fn() })`.
- [ ] Test calls `clearLoggerCache()` before `getLogger` (exercises first-creation path).
- [ ] Test restores the global via `vi.unstubAllGlobals()` in a `finally`.
- [ ] `vi` added to the file's `vitest` import (line 18).
- [ ] progress-display.test.ts still 44/44 (no collateral global leak).

### Code Quality Validation

- [ ] Test body is minimal: single `expect(...).not.toThrow()` + stub/restore + cache clear.
- [ ] No new assertions beyond the contract (no logger-shape/level/cache assertions).
- [ ] Inline comment explains WHY spread omits setMaxListeners (inherited, not own).
- [ ] No use of the broken Approach (b) (`delete process.setMaxListeners`).

### Documentation & Deployment

- [ ] No docs changes (test-only; contract #5 = "DOCS: none").
- [ ] No env vars, no config, no deployment surface affected.

---

## Scope Boundaries (DO NOT EXPAND)

This subtask is **one regression test + one import tweak**. The following are OUT OF SCOPE:

- ❌ Fixing `src/utils/logger.ts` (S1 territory — Complete; was a no-op in this tree).
- ❌ Adding `test:run` to the `validate` script (→ P1.M2.T1.S1).
- ❌ Adding resilience integration tests R1–R4 (→ P1.M3.T1/T2/T3).
- ❌ Refactoring other tests to use the partial-process-stub pattern.
- ❌ Running / fixing the full `npm run test:coverage` 100% gate.
- ❌ Modifying `progress-display.test.ts`, `vitest.config.ts`, or any source file.

---

## Anti-Patterns to Avoid

- ❌ Don't use Approach (b) `delete (process as any).setMaxListeners` — it's a no-op on an
  inherited property; the test would never fail and provides zero protection. Use Approach (a).
- ❌ Don't omit `clearLoggerCache()` before `getLogger` — the unguarded block is gated by
  `if (!loggerCache.size)`; a populated cache makes the test a silent false-negative.
- ❌ Don't skip `vi.unstubAllGlobals()` (or put it outside a `finally`) — a leaked neutered
  `process` global will break sibling tests (incl. progress-display.test.ts).
- ❌ Don't "make the test more thorough" by asserting logger shape/level/cache — the
  contract is a single regression `not.toThrow()`; extra assertions widen scope.
- ❌ Don't try to make the test fail by editing `src/utils/logger.ts` permanently — any
  production edit for demonstration MUST be reverted (Level 2(B) step 4–6), confirmed by
  `grep setMaxListeners src/utils/logger.ts` returning nothing.
- ❌ Don't declare the task failed just because the line is absent — that's the documented
  precondition; the test is a forward-looking tripwire and is legitimately valuable.
- ❌ Don't place the test outside `describe('getLogger()')` — the contract specifies that block.

---

**Confidence Score: 9/10** for one-pass implementation success. The change is ~13 lines in
one well-understood file with a precise insertion point and an authoritative test body. The
one residual complexity — the line-absent precondition and the resulting adaptation of the
"fails-without-fix" step — is fully documented in the STOP block and Level 2(B), mirroring
the approach S1's PRP took for the identical precondition. The only failure mode is an
implementer ignoring the precondition block or permanently leaving an injected production
line; both are explicitly guarded against in the checklist and anti-patterns.
