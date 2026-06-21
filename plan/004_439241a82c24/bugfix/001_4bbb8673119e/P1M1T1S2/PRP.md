name: "P1.M1.T1.S2 — Update groundswell vi.mock stubs to provide PiHarness + HarnessRegistry"
description: |

---

## Goal

**Feature Goal**: Update the `vi.mock('groundswell', …)` factories in BOTH config test
files so they stub `HarnessRegistry` and `PiHarness` in addition to `configureHarnesses`,
allowing the S1-updated `configureHarness()` (which now calls
`HarnessRegistry.getInstance().has('pi')` / `registry.register(new PiHarness())`) to execute
inside the mocked context without throwing.

**Deliverable**: Two modified test files — `tests/unit/config/harness-config.test.ts` and
`tests/unit/config/harness-provider-compat.test.ts` — each with an expanded `vi.mock`
factory. No source files change (S1 already shipped the production code; this is a
test-only fix to keep the mock contract in sync with the new imports).

**Success Definition**:
- `npm run test:run -- config/harness-config config/harness-provider-compat` → **all 9 tests
  pass** (currently 4 fail with `"No 'HarnessRegistry' export is defined on the 'groundswell' mock"`).
- `npm run test:run -- agents/agent-factory` → the **5 persona-factory creation tests**
  (`architect` / `researcher` / `coder` / `qa` + `multi-agent conflict`) pass — these use the
  REAL sibling groundswell (no mock), where S1's real registration now makes `createAgent()`
  succeed.
- All previously-passing assertions in both config files stay green: `configureHarnesses`
  called/not-called with expected args; `HarnessProviderMismatchError` thrown on `claude-code + zai`.

## User Persona (if applicable)

**Target User**: PRP-pipeline maintainer / QA engineer running the Session-004 test surface.

**Use Case**: Running the config unit-test suite after the S1 registration fix without the
mocked `groundswell` module crashing the System-Under-Test.

**Pain Points Addressed**: The `vi.mock('groundswell', () => ({ configureHarnesses: vi.fn() }))`
factory replaces the ENTIRE groundswell module. Once S1 added `import { …, PiHarness,
HarnessRegistry } from 'groundswell'` to `src/config/harness.ts` and called those symbols,
the mock made them `undefined`, so every config test that reaches Step 4.5 threw
`Cannot read properties of undefined (reading 'getInstance')`.

## Why

- **Unblocks Issue 1 (PRD §9.3.3 / §9.4.2)**: S1 registered `PiHarness` so the runtime can
  create agents, but the config test mocks must mirror the new import surface or those unit
  tests break. This subtask closes the loop.
- **Restores the green config test surface** that the Session-004 QA report (PRD "Testing
  Summary") relies on ("all `config/*` … pass").
- **Scope discipline**: This is a pure mock-synchronization change. It does NOT introduce new
  assertions about `HarnessRegistry.has/register` in the config tests — branch coverage of the
  registration guard's `has()→true` path is explicitly deferred to **P1.M1.T2.S2** (and the
  full 100%-coverage gate belongs to **P1.M2.T3**). See "Scope Boundaries" below.

## What

Expand the single `vi.mock('groundswell', …)` line in each of the two test files so the factory
returns stubs for the two new symbols the SUT imports. The stubs must satisfy the exact call
surface `configureHarness()` (Step 4.5) uses:

```ts
const registry = HarnessRegistry.getInstance();  // → needs an object with has() + register()
if (!registry.has('pi')) {                         // → needs has(id) → boolean (false, so register runs)
  registry.register(new PiHarness());              // → needs register(instance) → void (no-throw);
}                                                  //   and PiHarness must be constructable via new
```

### Authoritative mock shape (from the task contract)

```ts
vi.mock('groundswell', () => ({
  configureHarnesses: vi.fn(),
  HarnessRegistry: {
    getInstance: () => ({ has: () => false, register: vi.fn() }),
  },
  PiHarness: class MockPiHarness {},
}));
```

### Success Criteria

- [ ] Both config test files use the expanded factory above (or equivalent).
- [ ] `npm run test:run -- config/harness-config config/harness-provider-compat` → 0 failures.
- [ ] `npm run test:run -- agents/agent-factory` → the 5 creation tests pass (downstream
      proof that S1's real registration works end-to-end).
- [ ] No changes to source files, `agent-factory.test.ts`, or any other test file.

## All Needed Context

### Context Completeness Check

_Pass._ A developer who has never seen this repo can implement this from the four file
references below + the exact mock shape. The fix is mechanical (two single-line factory
expansions) and the failure mode is fully reproduced and explained.

### Documentation & References

```yaml
# MUST READ - Include these in your context window

- file: src/config/harness.ts
  why: The System-Under-Test. Step 4.5 (the block added by S1) shows the EXACT calls the
        mock must satisfy: HarnessRegistry.getInstance(), registry.has('pi'), registry.register(new PiHarness()).
  pattern: |
    const registry = HarnessRegistry.getInstance();
    if (!registry.has('pi')) {
      registry.register(new PiHarness());
    }
  gotcha: |
    The has() guard is MANDATORY in real code (register() throws "Provider 'pi' is already
    registered" on a duplicate). In the MOCK, has() is hardwired to false (per contract) and
    register is a vi.fn() (never throws) — so the guard's true-branch (skip register) is NOT
    exercised by these config tests. That gap is intentional and tracked under P1.M1.T2.S2.

- file: tests/unit/config/harness-config.test.ts
  why: TARGET FILE #1. Contains the vi.mock('groundswell', () => ({ configureHarnesses: vi.fn() }))
        line to expand. Also shows the assertions that must stay green (configureHarnesses.toHaveBeenCalledWith(...)).
  pattern: |
        vi.mock('groundswell', () => ({
          configureHarnesses: vi.fn(),   // ← existing
          // ADD the two stubs here
        }));
  gotcha: |
    The file's test (c) "claude-code + zai throws" exits at Step 4 (provider guard) BEFORE
    reaching Step 4.5 (registration). Test (d) "invalid value" exits at Step 2. So only tests
    (a) and (b) actually hit getInstance(). But the stub MUST be in the SHARED factory so the
    module-level import in harness.ts resolves for ALL cases (vi.mock is hoisted and applies
    to the whole module graph).

- file: tests/unit/config/harness-provider-compat.test.ts
  why: TARGET FILE #2. Identical vi.mock line to expand. Its test (b) "claude-code + zai throws"
        also exits before Step 4.5; tests (a) and (a-cont) hit getInstance().
  pattern: same factory expansion as TARGET FILE #1.
  gotcha: This file has an `afterEach(() => vi.unstubAllEnvs())` in addition to beforeEach clearAllMocks — preserve it.

- file: vitest.config.ts
  why: Confirms coverage is configured but NOT `enabled: true` by default.
  critical: |
    `npm run test:run` = `vitest run` (NO --coverage flag). The 100% branch threshold does NOT
    fire on the subset runs in this task's validation. Only `npm run test:coverage`
    (= `vitest run --coverage`) enforces it. THEREFORE the `has()→true` branch gap introduced
    by `has: () => false` does NOT fail this task's validation gates — it is a known deferred
    item owned by P1.M1.T2.S2 / P1.M2.T3.

- file: ../groundswell/dist/harnesses/harness-registry.d.ts   (sibling checkout)
  why: Source of truth for the real HarnessRegistry API surface the mock mirrors.
  critical: |
    Real API: getInstance() → singleton; register(provider) → void (THROWS if id already
    registered); has(id) → boolean; get(id) → instance|undefined. The mock needs only
    getInstance/has/register. `PiHarness` (../groundswell/dist/harnesses/pi-harness.d.ts) is a
    class with `readonly id: HarnessId = "pi"` and a no-arg constructor → the mock's
    `class MockPiHarness {}` satisfies `new PiHarness()`.

- docfile: plan/004_439241a82c24/bugfix/001_4bbb8673119e/architecture/system_context.md
  section: §2 "Issue 1 Root Cause & Fix Surface" → "Test mock impact (CRITICAL)"
  why: Documents the exact mock-update requirement and confirms agent-factory.test.ts uses the
        REAL sibling groundswell (no mock) so S1's real registration makes its 5 tests pass.
```

### Current Codebase tree (relevant slice)

```bash
src/config/
├── harness.ts          # SUT — already updated by S1 (imports PiHarness, HarnessRegistry)
├── constants.ts        # DEFAULT_MODEL_PROVIDER='zai', SUPPORTED_HARNESSES, PRP_AGENT_HARNESS
└── types.ts            # AgentHarness type, HarnessProviderMismatchError class
tests/unit/config/
├── harness-config.test.ts            # ← TARGET FILE #1 (vi.mock line ~22)
├── harness-provider-compat.test.ts   # ← TARGET FILE #2 (vi.mock line ~24)
└── harness.test.ts                   # UNCHANGED (constants/types/error-class only — no groundswell mock)
../groundswell/dist/
├── index.js / index.d.ts             # barrel: exports { configureHarnesses, PiHarness, HarnessRegistry }
├── harnesses/harness-registry.d.ts   # real API surface for HarnessRegistry
└── harnesses/pi-harness.d.ts         # real API surface for PiHarness
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# No new files. Two existing files modified in place (single vi.mock factory each):
tests/unit/config/harness-config.test.ts            # +2 stubs in the factory object
tests/unit/config/harness-provider-compat.test.ts   # +2 stubs in the factory object
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: vi.mock('groundswell', factory) REPLACES THE ENTIRE MODULE.
// The factory MUST return EVERY named export the SUT (src/config/harness.ts) imports.
// S1 added `PiHarness, HarnessRegistry` to the import list, so the factory MUST stub them
// or vitest throws: "No 'HarnessRegistry' export is defined on the 'groundswell' mock."
//
// CRITICAL: register MUST be a vi.fn() (or no-throw stub), NOT the real register().
//   Why: the mock's has() always returns false → register is called on EVERY configureHarness()
//   invocation (tests a & b call it multiple times across the file). The REAL register() throws
//   "Provider 'pi' is already registered" on the second call. A vi.fn() silently accepts repeats.
//
// CRITICAL: PiHarness MUST be constructable (`new PiHarness()`). Use a class expression
//   `class MockPiHarness {}` (or `function MockPiHarness(){}`) — a bare object literal would
//   fail at `new PiHarness()` with "PiHarness is not a constructor".
//
// GOTCHA (coverage): `has: () => false` means the `!registry.has('pi')` branch's FALSE arm
//   (skip-register) is NOT covered by these two config files. That arm is covered downstream
//   by tests using the REAL registry (agent-factory suite loads configureHarness() at module
//   load; a separate positive-registration test lands in P1.M1.T2.S2). `npm run test:run`
//   does NOT enforce coverage thresholds (only `test:coverage` does), so this gap is acceptable
//   for THIS subtask's validation and is explicitly tracked as deferred.
//
// GOTCHA (hoisting): vi.mock is hoisted to the top of the file by vitest's transformer, so it
//   runs BEFORE any `import { configureHarnesses } from 'groundswell'`. Keep the factory
//   self-contained (no references to outer-scope variables that aren't themselves hoisted
//   vi.* calls) — the existing single-line factory already satisfies this.
//
// GOTCHA (vi.clearAllMocks): beforeEach calls vi.clearAllMocks(), which resets configureHarnesses
//   call history (so toHaveBeenCalledTimes(1) assertions work per-test). Because each
//   getInstance() returns a FRESH { has, register } object, clearAllMocks has no adverse effect
//   on the new stubs — no extra reset logic needed.
```

## Implementation Blueprint

### Data models and structure

None. This is a test-only mock-factory edit; no models, schemas, or types are introduced.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY tests/unit/config/harness-config.test.ts — expand the vi.mock('groundswell') factory
  - LOCATE: the single line (~line 22):
      vi.mock('groundswell', () => ({ configureHarnesses: vi.fn() }));
  - REPLACE WITH (multi-line factory object):
      vi.mock('groundswell', () => ({
        configureHarnesses: vi.fn(),
        HarnessRegistry: {
          getInstance: () => ({ has: () => false, register: vi.fn() }),
        },
        PiHarness: class MockPiHarness {},
      }));
  - PRESERVE: everything else — the `import { configureHarnesses } from 'groundswell'` line
      (still used for call-count/args assertions), the 4 `it(...)` blocks, and the beforeEach.
  - DO NOT add new assertions about HarnessRegistry/PiHarness in this file (out of scope — S2 is
      mock-synchronization only; coverage tests live in P1.M1.T2.S2).
  - VERIFY immediately after: `npm run test:run -- config/harness-config` → 4/4 tests pass.

Task 2: MODIFY tests/unit/config/harness-provider-compat.test.ts — identical factory expansion
  - LOCATE: the single line (~line 24):
      vi.mock('groundswell', () => ({ configureHarnesses: vi.fn() }));
  - REPLACE WITH the SAME multi-line factory object as Task 1 (byte-identical stub shape):
      vi.mock('groundswell', () => ({
        configureHarnesses: vi.fn(),
        HarnessRegistry: {
          getInstance: () => ({ has: () => false, register: vi.fn() }),
        },
        PiHarness: class MockPiHarness {},
      }));
  - PRESERVE: the afterEach(() => vi.unstubAllEnvs()) hook, all `it(...)` blocks, the
      SUPPORTED_HARNESSES import + assertions, and the configureHarnesses call assertions.
  - DO NOT add new assertions (same scope rule as Task 1).
  - VERIFY immediately after: `npm run test:run -- config/harness-provider-compat` → 5/5 tests pass.
```

### Implementation Patterns & Key Details

```ts
// PATTERN: Minimal but complete groundswell mock for config unit tests.
// The factory returns ONLY the symbols src/config/harness.ts imports. If a future task adds
// another groundswell import to harness.ts, this factory must grow correspondingly — that is
// exactly the S1→S2 sync this PRP performs.
vi.mock('groundswell', () => ({
  configureHarnesses: vi.fn(),
  HarnessRegistry: {
    // getInstance returns a fresh registry stub each call — safe under vi.clearAllMocks().
    getInstance: () => ({
      has: () => false,          // false → register branch always runs (true-arm deferred to P1.M1.T2.S2)
      register: vi.fn(),         // vi.fn (not real register) → no "already registered" throw on repeats
    }),
  },
  PiHarness: class MockPiHarness {},  // class expression → `new PiHarness()` succeeds
}));

// WHY each stub is shaped this way (mapped to harness.ts Step 4.5):
//   HarnessRegistry.getInstance()   ← must be a function returning an object
//   registry.has('pi') → false      ← exercises the register branch
//   registry.register(new PiHarness())  ← register must accept 1 arg & not throw; PiHarness must be newable
```

### Integration Points

```yaml
DATABASE:
  - none
CONFIG:
  - none (no env-var or settings changes)
ROUTES:
  - none
BUILD / TOOLING:
  - none (no package.json, tsconfig, or vitest.config changes)
DEPENDENCIES:
  - DEPENDS-ON (completed): P1.M1.T1.S1 — src/config/harness.ts must already import
      PiHarness + HarnessRegistry and call registry.has/register. (Verified present.)
  - ENABLES (downstream): P1.M1.T1.S3 — end-to-end persona-factory verification + 100% branch
      coverage of the registration guard's true-arm.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# After each file edit — confirm no formatting regression on the changed files.
npx prettier --check tests/unit/config/harness-config.test.ts tests/unit/config/harness-provider-compat.test.ts
# Expected: both files already pass Prettier. If the multi-line factory reformats differently,
# run `npx prettier --write` on the two files and re-check.

# Lint (the project's lint glob is eslint . --ext .ts — picks up tests/).
npm run lint
# Expected: zero NEW errors introduced by this change. (Pre-existing typecheck errors in
# src/tools/* — Issue 4 — are out of scope and tracked separately; do NOT try to fix them here.)

# Typecheck NOTE: tsconfig.build.json excludes tests/ (include: ["src/**/*"]), so test files are
# NOT validated by `npm run typecheck`. The mock stubs are structurally compatible by
# construction (plain object + class expression). Skip typecheck for this task.
```

### Level 2: Unit Tests (Primary Validation — Component)

```bash
# TARGET FILE #1 alone
npm run test:run -- config/harness-config
# Expected: Test Files 1 passed | Tests 4 passed (was: 2 failed | 2 passed).

# TARGET FILE #2 alone
npm run test:run -- config/harness-provider-compat
# Expected: Test Files 1 passed | Tests 5 passed (was: 2 failed | 3 passed).

# BOTH config files together (the task's stated gate)
npm run test:run -- config/harness-config config/harness-provider-compat
# Expected: Test Files 2 passed | Tests 9 passed (was: 2 failed | 4 failed | 5 passed).
# All configureHarnesses call-count/args assertions AND HarnessProviderMismatchError
# assertions remain green.
```

### Level 3: Integration Testing (Downstream Proof — Issue 1 end-to-end)

```bash
# agent-factory uses the REAL sibling groundswell (no vi.mock). S1's real registration of
# PiHarness at module-load must now let createAgent() succeed for every persona.
npm run test:run -- agents/agent-factory
# Expected: Test Files 1 passed | Tests green including the 5 creation tests:
#   - should create architect agent successfully
#   - should create researcher agent successfully
#   - should create coder agent successfully
#   - should create QA agent successfully
#   - should create multiple agents without MCP server registration conflicts
# (These were the 5 failing with "Harness 'pi' is not registered" before S1; they must now pass.)
# NOTE: This run is NOT mocked, so it validates the REAL configureHarness() registration path.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Regression guard: confirm the S2 change did not disturb any OTHER config test or the broader
# config surface. (Optional but recommended before handing off to S3.)
npm run test:run -- config
# Expected: all tests/unit/config/*.test.ts files green (harness.test.ts, environment.test.ts,
# endpoint-guard.test.ts included).

# DO NOT run `npm run test:coverage` as a gate for THIS task — the registration guard's
# has()→true branch is intentionally not yet covered (deferred to P1.M1.T2.S2). The full
# 100%-coverage gate is owned by P1.M2.T3.
```

## Final Validation Checklist

### Technical Validation

- [ ] Level 1: `npx prettier --check` on both edited files passes.
- [ ] Level 1: `npm run lint` introduces zero new errors.
- [ ] Level 2: `npm run test:run -- config/harness-config config/harness-provider-compat` → 9/9 pass.
- [ ] Level 3: `npm run test:run -- agents/agent-factory` → 5 persona-creation tests pass.
- [ ] No source files modified (only the two test files).
- [ ] No new dependencies, config, or tooling changes.

### Feature Validation

- [ ] Both `vi.mock('groundswell', …)` factories now return `HarnessRegistry` and `PiHarness`.
- [ ] `HarnessRegistry.getInstance()` returns `{ has, register }`; `has()` returns `false`;
      `register` is a `vi.fn()` (non-throwing); `PiHarness` is constructable.
- [ ] Existing `configureHarnesses` call-count/args assertions in both files remain green.
- [ ] Existing `HarnessProviderMismatchError` assertions remain green.
- [ ] The 5 agent-factory creation tests pass (proves S1's real registration works end-to-end).

### Code Quality Validation

- [ ] The two factory expansions are byte-identical in stub shape (consistency).
- [ ] No new test assertions added (respects S2 scope = mock sync only).
- [ ] File placement unchanged; only the single `vi.mock(…)` block per file is edited.
- [ ] beforeEach/afterEach hooks in both files preserved unchanged.

### Documentation & Deployment

- [ ] No env vars or operational docs affected (test-only change).
- [ ] Inline comment in the factory (optional) explaining `has: () => false` deferral is welcome
      but not required — the contract is captured in this PRP.

---

## Scope Boundaries (DO NOT EXPAND)

This subtask is **mock synchronization ONLY**. The following are explicitly OUT OF SCOPE and
owned by sibling subtasks — do not implement them here:

- ❌ Adding assertions that `HarnessRegistry.getInstance().register` was called (→ coverage test,
  belongs to P1.M1.T2.S2 / P1.M1.T1.S3).
- ❌ Covering the `!registry.has('pi')` FALSE arm (true-branch) — requires a `has: () => true`
  variant or real-registry test; tracked under P1.M1.T2.S2.
- ❌ Fixing Issue 2 (claude-code provider guard) — P1.M1.T2.S1.
- ❌ Fixing Issue 3 (`docs:lint`) or Issue 4 (`ToolExecutor` typecheck / prettierignore) — P1.M2.T1 / P1.M2.T2.
- ❌ Running the full `npm run validate` / `npm run test:coverage` gate — P1.M2.T3.
- ❌ Modifying `src/config/harness.ts` (S1 is shipped) or `tests/unit/agents/agent-factory.test.ts`.

---

## Anti-Patterns to Avoid

- ❌ Don't use the REAL `HarnessRegistry`/`PiHarness` in the mock (would re-introduce the
  `@anthropic-ai/claude-agent-sdk` import chain that the mock exists to avoid, and would make
  `register()` throw on the second call).
- ❌ Don't make `has` return `true` "to be safe" — that skips the register branch and would hide
  a class of regressions; the contract explicitly specifies `false`.
- ❌ Don't replace the single shared factory with per-test `vi.doMock` calls — the existing
  hoisted `vi.mock` pattern is correct and used by both files.
- ❌ Don't import `HarnessRegistry`/`PiHarness` from `'groundswell'` into the test bodies just to
  assert on them — that widens scope into coverage territory owned by T2.S2.
- ❌ Don't "improve" the mock by stubbing `get`/`initializeProvider`/`terminateAll` — YAGNI; only
  `getInstance`/`has`/`register` are called by the SUT.
- ❌ Don't run `npm run test:coverage` and try to chase the `has()→true` branch gap — it is a
  known, tracked, deferred item; doing so here violates scope.

---

**Confidence Score: 9/10** for one-pass implementation success. The change is mechanical
(two single-line → multi-line factory expansions with an exact, authoritative stub shape),
the failure mode is fully reproduced and diagnosed, and the validation commands are verified
to distinguish passing from failing states. The one point of residual risk is purely a
discipline risk: an implementer tempted to "also fix coverage" or "also assert on register"
must be held to the narrow S2 scope defined above.
