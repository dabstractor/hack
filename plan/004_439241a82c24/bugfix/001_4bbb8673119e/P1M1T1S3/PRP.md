name: "P1.M1.T1.S3 — Verify end-to-end persona factory creation + 100% branch coverage of the registration guard"
description: |

  Test-only verification + coverage-closure subtask. Confirms the 5 previously-failing
  persona-factory creation tests are green after S1/S2, and adds ONE explicit mock-based
  test case that deterministically exercises the `has('pi')→true` (skip) branch of the
  `configureHarness()` registration guard so that `src/config/harness.ts` is robustly at
  100% branch coverage — independent of v8 coverage-provider quirks or singleton state.

---

## Goal

**Feature Goal**: Close out Issue 1 (P1.M1.T1) by (a) confirming every persona factory
creates a live agent without throwing after the S1 registration fix, and (b) adding an
explicit, deterministic unit test for the `if (!registry.has('pi'))` skip branch in
`configureHarness()`, so the full Session-004 harness test surface is green with 100%
branch coverage on `src/config/harness.ts`.

**Deliverable**: A modified `tests/unit/config/harness-config.test.ts` containing:
1. A `vi.hoisted`-based refactor of the existing `vi.mock('groundswell', …)` factory so
   `HarnessRegistry.getInstance().has` / `.register` are **per-test reconfigurable** vi.fns
   (default `has→false`, preserving all current behavior).
2. ONE new test case — `(e) registry already has 'pi' → configureHarness() skips register()`
   — that flips `mockHas` to `true`, calls `configureHarness()`, and asserts the mock
   `register` was **NOT** called and the resolved harness is still `'pi'`.
3. `beforeEach` updates to reset the hoisted mocks (so the new case cannot leak into the
   existing `(a)–(d)` cases).

No source files change. `agent-factory.test.ts`, `harness-provider-compat.test.ts`, and all
other test/source files are untouched.

**Success Definition**:
- `npm run test:run -- config/ agents/agent-factory agents/cache-key-isolation tools/mcp-tool-parity`
  → **0 failures** (currently 107/107 pass post-S1/S2; must remain 107/107 — i.e. +1 from
  the new case in `harness-config`, whose file count goes 4 → 5).
- The 5 previously-failing persona-factory creation tests are GREEN:
  `should create architect/researcher/coder/QA agent successfully` and
  `should create multiple agents without MCP server registration conflicts`.
- `npm run test:run -- config/harness-config --coverage` → `src/config/harness.ts`
  reports **100% Branch** (and 100% statements/functions/lines), AND the new skip-branch
  test is the one exercising the skip arc (deterministic, not coincidental).
- Satisfies contract criterion **P1.M1.T2.S2** ("All persona factories must still create
  agents without throwing") for the Issue-1 fix.

## User Persona (if applicable)

**Target User**: PRP-pipeline maintainer / QA engineer running the Session-004 test surface.

**Use Case**: Running the targeted harness test + coverage gate after the S1+S2 fix and
getting a deterministic, human-readable green signal that the registration guard is fully
covered.

**Pain Points Addressed**:
- v8 coverage's 100%-branch number on `harness.ts` was **coincidental** (it doesn't emit a
  skip arc for a single-statement `if` that's always taken) — fragile and un-informative.
  The explicit `has()→true` test makes coverage **deterministic and asserted**.

## Why

- **Closes Issue 1 cleanly (PRD §9.3.3 / §9.4.2 / §9.5 step 1).** S1 registered `PiHarness`
  idempotently; S2 synced the config-test mocks. This subtask is the verification + the last
  coverage branch, turning "5 tests green" into "5 tests green AND 100% branch coverage
  deterministically proven".
- **Why the explicit test is required even though coverage already reads 100%** — see
  `research/coverage_findings.md` §3: `configureHarness()` runs **exactly once** in the whole
  codebase (module-load of `agent-factory.ts:46`), and the S2 mock hardwires `has: () => false`.
  Neither path ever enters the skip branch; the 100% number is a v8-coverage artifact for
  single-statement `if`s without `else`. The contract mandates an explicit, asserted test so
  the skip path is real coverage, not a provider quirk.
- **Scope discipline:** Test-only. No production code. Does NOT touch Issue 2
  (`claude-code` resolved-provider guard — P1.M1.T2.S1/S2), Issue 3/4 (M2), or the full
  `npm run validate` gate. The `DEFAULT_MODEL_PROVIDER` constant in Step 4 stays as-is.

## What

### User-visible behavior
None. Test-only.

### Technical requirements (exact contract)

**Host file:** `tests/unit/config/harness-config.test.ts` (contract allows
`harness-provider-compat.test.ts` as an alternative; this PRP pins the former for
co-location with the other `configureHarness()` cases).

**(a) Refactor the `vi.mock('groundswell', …)` factory** from the current hardwired form:

```ts
vi.mock('groundswell', () => ({
  configureHarnesses: vi.fn(),
  HarnessRegistry: {
    getInstance: () => ({ has: () => false, register: vi.fn() }),
  },
  PiHarness: class MockPiHarness {},
}));
```

to a **`vi.hoisted`-controlled** form (the ONLY way to share mutable vi.fns with a hoisted
`vi.mock` factory — top-level `const`s are initialized AFTER the hoisted factory runs):

```ts
const { mockHas, mockRegister } = vi.hoisted(() => ({
  mockHas: vi.fn(() => false),   // default: pi NOT registered → register() runs (existing behavior)
  mockRegister: vi.fn(),
}));

vi.mock('groundswell', () => ({
  configureHarnesses: vi.fn(),
  HarnessRegistry: {
    getInstance: () => ({ has: mockHas, register: mockRegister }),
  },
  PiHarness: class MockPiHarness {},
}));
```

> The `configureHarnesses` and `PiHarness` stubs are UNCHANGED. `mockHas` defaults to
> `() => false`, so the existing `(a)–(d)` cases behave identically.

**(b) Update `beforeEach`** to reset the hoisted mocks alongside the existing resets
(`vi.clearAllMocks()` + `delete process.env.PRP_AGENT_HARNESS` + the `ANTHROPIC_API_KEY`
stub). Add right after the existing `vi.clearAllMocks()`:

```ts
mockHas.mockReturnValue(false); // ensure each case starts in the "not registered" state
// (mockRegister is cleared by vi.clearAllMocks() above)
```

**(c) Add the new skip-branch test case** inside the existing `describe('config/harness', …)`
block, after case `(d)`:

```ts
it('(e) skips register() when HarnessRegistry already has pi (skip branch)', () => {
  // SETUP: simulate "pi already registered" — the idempotent skip path
  mockHas.mockReturnValue(true);

  // EXECUTE
  const h = configureHarness();

  // VERIFY: resolved harness still 'pi' ...
  expect(h).toBe('pi');
  // ... and register() was NOT called (the skip branch)
  expect(mockRegister).not.toHaveBeenCalled();
  // ... and configureHarnesses() WAS still called (registration-skip ≠ config-skip)
  expect(configureHarnesses).toHaveBeenCalledTimes(1);
  expect(configureHarnesses).toHaveBeenCalledWith(
    expect.objectContaining({ defaultHarness: 'pi', defaultModelProvider: 'zai' })
  );
});
```

### Success Criteria

- [ ] `harness-config.test.ts` uses the `vi.hoisted` mock factory exactly as specified
      (controllable `mockHas` defaulting to `false` + `mockRegister`).
- [ ] A new `(e)` test asserts `mockRegister` is NOT called when `mockHas→true`, while
      `configureHarness()` still returns `'pi'` and still calls `configureHarnesses()` once.
- [ ] Existing `(a)–(d)` cases remain GREEN and unchanged in intent.
- [ ] `beforeEach` resets `mockHas` to `false` so no test leaks state into another.
- [ ] No source files, `agent-factory.test.ts`, or other test files are modified.

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed to
implement this successfully?_ **Yes** — the change is a mechanical mock refactor + one
literal test case at a pinned location, with the exact import/fixture names and the
verified call surface of the System-Under-Test. No judgement calls remain.

### Documentation & References

```yaml
# MUST READ - Include these in your context window

- url: https://vitest.dev/guide/mocking.html#Mocking-with-factories
  why: vi.mock() factory hoisting rules — explains WHY plain top-level const cannot be
       referenced inside the factory and why vi.hoisted() is required.
  critical: |
    vi.mock is hoisted to the TOP of the file (before imports). Referencing an outer
    `const mockHas` directly inside the factory throws "Cannot access ... before
    initialization". vi.hoisted() lifts the declaration above the hoist boundary.

- url: https://vitest.dev/api/#vi-hoisted
  why: Official vi.hoisted() API — returns the value and makes it available to vi.mock.
  critical: The hoisted factory runs BEFORE any import; only vi APIs are safe inside it.

- file: src/config/harness.ts
  why: The System-Under-Test. Lines 84–85 are the registration guard whose skip branch
        must be covered.
  pattern: |
    // Step 4.5 (lines 78–85):
    const registry = HarnessRegistry.getInstance();
    if (!registry.has('pi')) {
      registry.register(new PiHarness());
    }
  gotcha: |
    configureHarness() is called EXACTLY ONCE app-wide (agent-factory.ts:46 module-load),
    so the real registry never deterministically hits the skip path. The mock must drive
    it. See research/coverage_findings.md §3.

- file: tests/unit/config/harness-config.test.ts
  why: TARGET FILE. Contains the vi.mock('groundswell') factory to refactor (lines ~23–30)
        and the describe('config/harness') block to extend with case (e). Shows the
        existing (a)–(d) assertions that MUST stay green and the beforeEach() to extend.
  pattern: |
    vi.mock('groundswell', () => ({ configureHarnesses: vi.fn(),
      HarnessRegistry: { getInstance: () => ({ has: () => false, register: vi.fn() }) },
      PiHarness: class MockPiHarness {} }));
  gotcha: |
    `has: () => false` is NOT reconfigurable per-test. Replace with vi.hoisted vi.fns
    (default false) so the new (e) case can flip has→true. Do NOT change the default
    behavior — existing cases rely on has()===false.

- file: tests/unit/config/harness-provider-compat.test.ts
  why: Reference for the IDENTICAL mock pattern used elsewhere (do NOT need to change it
        for coverage — harness-config.test.ts is the chosen host). Confirms vi.mock is
        per-file so the two files' mocks are independent.
  pattern: Same vi.mock skeleton as harness-config.test.ts.

- file: tests/unit/agents/agent-factory.test.ts
  why: The 5 creation tests this subtask must confirm GREEN. Uses the REAL groundswell
        (no vi.mock) → real PiHarness registered at module-load → createAgent() succeeds.
  gotcha: |
    DO NOT modify this file. Its 5 creation tests are the end-to-end proof for S1.
    configureHarness() runs at import (once); createXxxAgent() call createAgent() directly.

- docfile: plan/004_439241a82c24/bugfix/001_4bbb8673119e/architecture/system_context.md
  why: §2 (Issue 1 root cause + fix surface) and §6 (test infra / 100% threshold) and §7
        (validation gates). Authoritative on the dual-groundswell environment and the
        exact validation commands.
  section: "§2, §6, §7"

- docfile: plan/004_439241a82c24/bugfix/001_4bbb8673119e/P1M1T1S3/research/coverage_findings.md
  why: Explains WHY the explicit skip-branch test is required despite coverage reading 100%
        today (v8 single-statement-if artifact) and documents the do-not-run-full-suite hazard.
```

### Current Codebase tree (relevant slice)

```bash
src/config/
  harness.ts            # SUT — registration guard at lines 84–85 (Step 4.5)
  constants.ts          # DEFAULT_MODEL_PROVIDER='zai', DEFAULT_HARNESS='pi', SUPPORTED_HARNESSES
  types.ts              # AgentHarness, HarnessProviderMismatchError
tests/unit/
  config/
    harness-config.test.ts          # ← TARGET FILE (mock refactor + new case (e))
    harness-provider-compat.test.ts #   sibling, identical mock; not modified
    harness.test.ts                 #   constants/types tests; not modified
    environment.test.ts             #   not modified
    endpoint-guard.test.ts          #   not modified
  agents/
    agent-factory.test.ts           #   5 creation tests — confirm GREEN; not modified
vitest.config.ts        # 100% thresholds (statements/branches/functions/lines) on src/**/*.ts
```

### Desired Codebase tree with files to be added/modified

```bash
tests/unit/config/
  harness-config.test.ts   # MODIFIED — vi.hoisted mock + beforeEach reset + new case (e)
# (no files added; no source changes)
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: vi.mock() factories are HOISTED. A top-level `const mockHas = vi.fn(...)`
// referenced inside the factory is NOT yet initialized at hoist time → throws
// "Cannot access 'mockHas' before initialization". MUST use vi.hoisted() to lift it.
//   const { mockHas } = vi.hoisted(() => ({ mockHas: vi.fn(() => false) }));

// CRITICAL: @vitest/coverage-v8 does NOT reliably emit a "skip" branch arc for a
// single-statement `if (cond) stmt;` that is always taken in exercised paths. The
// registration guard currently reads 100% branch COINCIDENTALLY. The explicit
// has()→true test makes the skip path real, asserted coverage. See research §3.

// CRITICAL: Do NOT run `npm run test:run --coverage` (full suite). It imports
// src/utils/prd-validation-executor.ts + cli-help-executor.ts, whose module load boots
// live pipeline executors that self-SIGTERM/SIGKILL after 10s. Run ONLY the targeted
// subsets specified in the Validation Loop.

// GOTCHA: `vi.clearAllMocks()` in beforeEach clears call history on mockHas/mockRegister
// but does NOT reset mockHas's return value — that's why the explicit
// `mockHas.mockReturnValue(false)` reset is required, otherwise case (e)'s `true` would
// leak into the next case.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: REFACTOR the vi.mock factory in tests/unit/config/harness-config.test.ts
  - IMPLEMENT: vi.hoisted() block exposing { mockHas (default false), mockRegister };
        rewrite the vi.mock('groundswell') factory so getInstance() returns
        { has: mockHas, register: mockRegister }. Keep configureHarnesses + PiHarness stubs.
  - FOLLOW pattern: the existing vi.mock in the same file (only the has/register wiring changes).
  - NAMING: mockHas, mockRegister (hoisted consts).
  - PLACEMENT: Immediately above the existing `vi.mock('groundswell', …)` line; the
        `import { configureHarnesses } from 'groundswell'` stays after.
  - GOTCHA: vi.hoisted factory may only use vi APIs (no outer refs).

Task 2: UPDATE beforeEach() in the same describe block
  - IMPLEMENT: after `vi.clearAllMocks();`, add `mockHas.mockReturnValue(false);`
        (resets the skip-branch toggle between cases).
  - PRESERVE: existing `delete process.env.PRP_AGENT_HARNESS;` and
        `vi.stubEnv('ANTHROPIC_API_KEY', 'stubbed-key');`.
  - WHY: vi.clearAllMocks() clears calls but NOT mockReturnValue overrides.

Task 3: ADD the skip-branch test case (e)
  - IMPLEMENT: `it('(e) skips register() when HarnessRegistry already has pi (skip branch)', ...)`
        — set mockHas.mockReturnValue(true); call configureHarness(); assert:
          expect(h).toBe('pi');
          expect(mockRegister).not.toHaveBeenCalled();
          expect(configureHarnesses).toHaveBeenCalledTimes(1);
          expect(configureHarnesses).toHaveBeenCalledWith(expect.objectContaining(
            { defaultHarness: 'pi', defaultModelProvider: 'zai' }));
  - FOLLOW pattern: the existing (a)/(b) cases for shape + assertion style.
  - PLACEMENT: LAST `it(...)` inside `describe('config/harness', …)`, after case (d).
  - COVERAGE: this is the ONLY test that deterministically exercises the
        `if (!registry.has('pi'))` skip arc.

Task 4: VERIFY — do NOT edit code; run the validation commands (see Validation Loop).
  - CONFIRM 107→108 targeted tests pass (harness-config 4→5; rest unchanged).
  - CONFIRM the 5 agent-factory creation tests are green.
  - CONFIRM harness.ts reports 100% Branch on the targeted coverage run.
```

### Implementation Patterns & Key Details

```ts
// === The complete mocked-region shape AFTER Tasks 1–3 ===
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Task 1: hoist controllable vi.fns so the hoisted vi.mock factory can see them.
const { mockHas, mockRegister } = vi.hoisted(() => ({
  mockHas: vi.fn(() => false),
  mockRegister: vi.fn(),
}));

vi.mock('groundswell', () => ({
  configureHarnesses: vi.fn(),
  HarnessRegistry: {
    getInstance: () => ({ has: mockHas, register: mockRegister }),
  },
  PiHarness: class MockPiHarness {},
}));

import { configureHarnesses } from 'groundswell';
import { configureHarness } from '../../../src/config/harness.js';
import { HarnessProviderMismatchError } from '../../../src/config/types.js';
import { DEFAULT_MODEL_PROVIDER } from '../../../src/config/constants.js';

describe('config/harness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHas.mockReturnValue(false);   // Task 2: reset skip-branch toggle (default = not registered)
    delete process.env.PRP_AGENT_HARNESS;
    vi.stubEnv('ANTHROPIC_API_KEY', 'stubbed-key');
  });

  // … existing (a) defaults to pi …
  // … existing (b) explicit pi + zai succeeds …
  // … existing (c) claude-code + zai throws HarnessProviderMismatchError …
  // … existing (d) invalid value throws …

  it('(e) skips register() when HarnessRegistry already has pi (skip branch)', () => {
    mockHas.mockReturnValue(true);            // simulate "pi already registered"
    const h = configureHarness();
    expect(h).toBe('pi');
    expect(mockRegister).not.toHaveBeenCalled();      // ← the skip-branch assertion
    expect(configureHarnesses).toHaveBeenCalledTimes(1); // config delegation still happens
    expect(configureHarnesses).toHaveBeenCalledWith(
      expect.objectContaining({ defaultHarness: 'pi', defaultModelProvider: 'zai' })
    );
  });
});
```

### Integration Points

```yaml
TEST COUNT:
  - harness-config.test.ts: 4 → 5 tests (the +1 is case (e))
  - Full targeted Session-004 surface: 107 → 108 tests, all passing

COVERAGE:
  - src/config/harness.ts: stays 100% statements/branches/functions/lines; the skip
    branch is now DETERMINISTICALLY covered (case (e)) instead of coincidentally.

NO CHANGES TO:
  - src/** (any source file)
  - tests/unit/agents/agent-factory.test.ts
  - tests/unit/config/harness-provider-compat.test.ts (or any other test)
  - vitest.config.ts, package.json, tsconfig.*
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Targeted lint/format/typecheck on the single changed test file's neighborhood.
# (npm run typecheck only covers src/, so it is unaffected — run anyway to prove no drift.)
npm run lint
npm run format:check
npm run typecheck
# Expected: same baseline as before this subtask (no NEW errors introduced by the test edit).
# NOTE: pre-existing typecheck errors in src/tools/* (Issue 4) and docs:lint (Issue 3) are
#       OUT OF SCOPE here — do not attempt to fix them in this subtask.
```

### Level 2: Unit Tests (Component Validation)

```bash
# The changed file in isolation — must be 5/5 after the edit.
npm run test:run -- config/harness-config
# Expected: 5 tests pass (was 4; +1 = case (e)).

# Sibling mock file must remain green (unchanged).
npm run test:run -- config/harness-provider-compat
# Expected: 5 tests pass (unchanged).
```

### Level 3: Coverage Gate (the contract's 100%-branch proof)

```bash
# Targeted coverage on harness.ts — must report 100% across the board.
npm run test:run -- config/harness-config --coverage
# Expected line in the table:
#   harness.ts | 100 | 100 | 100 | 100 |
# AND case (e) is present & passing (it is what makes the skip arc real coverage).
```

### Level 4: End-to-End Session-004 Surface (the contract's "all green" proof)

```bash
# The full Session-004 test surface named by the contract.
npm run test:run -- config/ agents/agent-factory agents/cache-key-isolation tools/mcp-tool-parity
# Expected: 8 test files, 108 tests passed (107 prior + 1 new case (e)).
# CRITICAL sub-assertion — the 5 previously-failing creation tests MUST be in the green list:
#   ✓ tests/unit/agents/agent-factory.test.ts (23 tests)
#     - should create architect agent successfully
#     - should create researcher agent successfully
#     - should create coder agent successfully
#     - should create QA agent successfully
#     - should create multiple agents without MCP server registration conflicts

# ⚠️ DO NOT RUN: `npm run test:run --coverage` (full suite). It imports pipeline
#    executors (prd-validation-executor.ts / cli-help-executor.ts) that self-terminate
#    after 10s. Out of scope and hazardous. See research/coverage_findings.md §5.
```

## Final Validation Checklist

### Technical Validation

- [ ] Level 1 passed with NO new lint/format/typecheck errors vs. baseline.
- [ ] Level 2: `config/harness-config` = 5 tests pass; `config/harness-provider-compat` = 5 pass.
- [ ] Level 3: `config/harness-config --coverage` → `harness.ts` = 100/100/100/100.
- [ ] Level 4: targeted Session-004 surface = 108 tests, 0 failures.

### Feature Validation

- [ ] The 5 previously-failing persona-factory creation tests are GREEN (contract P1.M1.T2.S2).
- [ ] Case `(e)` asserts `mockRegister` is NOT called when `mockHas→true` (skip branch).
- [ ] Case `(e)` also asserts `configureHarness()` still returns `'pi'` and still calls
      `configureHarnesses()` once (registration-skip ≠ config-skip).
- [ ] `beforeEach` resets `mockHas` to `false` — no state leak between cases.

### Code Quality Validation

- [ ] Mock refactor preserves default behavior (`has→false`), so existing (a)–(d) are unchanged.
- [ ] Uses `vi.hoisted()` (not a bare top-level `const`) so the hoisted `vi.mock` factory compiles.
- [ ] No source files modified; no other test files modified.
- [ ] Naming (`mockHas`, `mockRegister`, case `(e)`) matches the file's existing conventions.

### Scope Discipline

- [ ] Did NOT touch Step 4 `DEFAULT_MODEL_PROVIDER` guard (Issue 2 — P1.M1.T2.S1/S2).
- [ ] Did NOT touch Issue 3 (`docs:lint`) or Issue 4 (ToolExecutor typecheck) — those are M2.
- [ ] Did NOT run the full `npm run test:run --coverage` suite.

---

## Anti-Patterns to Avoid

- ❌ Don't reference a top-level `const` inside `vi.mock(...)` — it's hoisted; use `vi.hoisted()`.
- ❌ Don't change `mockHas`'s default to `true` — existing (a)–(d) rely on `false`.
- ❌ Don't rely on the real registry / `agent-factory.test.ts` to cover the skip branch —
  `configureHarness()` runs once app-wide and never skips; the mock MUST drive it.
- ❌ Don't skip the `mockHas.mockReturnValue(false)` reset in `beforeEach` — `vi.clearAllMocks()`
  does NOT reset `mockReturnValue` overrides.
- ❌ Don't run `npm run test:run --coverage` (full suite) — it boots live pipeline executors.
- ❌ Don't modify source files, `agent-factory.test.ts`, or any other test file.

---

## Confidence Score

**9 / 10** for one-pass implementation success.

Rationale: the change is a mechanical, fully-specified mock refactor + one literal test
case at a pinned location. The SUT call surface, the exact assertion shape, the
vi.hoisted requirement, and all four validation commands have been verified against the
live codebase. The −1 accounts for the (small) possibility that a future v8 provider
revision re-derives branch arcs differently — in which case case `(e)` only makes things
more robust, never less.
