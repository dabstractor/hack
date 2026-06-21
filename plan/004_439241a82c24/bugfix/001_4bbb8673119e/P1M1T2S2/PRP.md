name: "P1.M1.T2.S2 — Add positive claude-code+anthropic test coverage and cover the resolved-provider guard's allow branch"
description: |

---

## Goal

**Feature Goal**: Add a **positive-path** unit test to `tests/unit/config/harness-provider-compat.test.ts`
that proves `claude-code` + an `anthropic/*` model override **passes** the resolved-provider guard
implemented in P1.M1.T2.S1 (i.e. does NOT throw, returns `'claude-code'`, and delegates to
`configureHarnesses()` with `defaultHarness: 'claude-code'`). This closes the only **behaviorally
untested** path of `configureHarness()` — the ALLOW branch of the Issue-2 guard — and hardens branch
coverage so any future refactor of the `&&` into nested `if`s stays fully covered.

**Deliverable**: A single edited test file — `tests/unit/config/harness-provider-compat.test.ts` —
with **one new `it(...)` case** appended to the existing `describe('harness/provider compatibility')`
block. **No source changes, no new files, no dependency changes, no mock changes.** The existing
inline `vi.mock('groundswell', …)` already stubs `configureHarnesses` + `HarnessRegistry` +
`PiHarness` sufficiently (see "Why no mock change is needed").

**Success Definition**:
- `npm run test:run -- config/harness-provider-compat` → **6/6 pass** (was 5/5), including the new
  positive case.
- `npm run test:run -- config/harness-provider-compat config/harness-config --coverage` → all pass,
  and `src/config/harness.ts` reports **100% branches** (the contract's stated coverage gate).
- The new test exercises the `resolvedProvider === 'zai'` decision in the **FALSE** direction while
  `harness === 'claude-code'` is **TRUE** — the only `(harness, resolvedProvider)` tuple not yet
  driven through the guard. This both proves Issue 2's fix works and future-proofs branch coverage.

> **EMPIRICAL FINDING (verified by running coverage before writing this PRP):** `src/config/harness.ts`
> *already* reports `100 | 100 | 100 | 100` (statements/branches/functions/lines) with the current
> 5 tests. This is because v8/istanbul models `if (harness === 'claude-code' && resolvedProvider === 'zai')`
> as a **single** throw-vs-skip branch, and the existing `pi` tests already hit the "skip" arm. The
> contract's "ALLOW branch currently UNTESTED" is therefore a **behavioral** gap, not a coverage-
> threshold failure: *no test today proves that selecting `claude-code` with an anthropic override
> actually succeeds*. The new test closes that behavioral gap AND ensures the `resolvedProvider !== 'zai'`
> sub-condition is exercised in a `claude-code` context, so the branch stays 100% even if the `&&` is
> later refactored into nested `if`s.

## User Persona (if applicable)

**Target User**: Maintainer / QA reviewer who must trust that PRD §9.4.1 (`claude-code` is a
*supported* harness) and §9.2.4 (only the `zai`+`claude-code` *combination* is a config error) are
actually realised by the code, not just claimed in JSDoc.

**Use Case**: A future refactor (e.g. splitting the `&&` into two nested `if`s, or extracting a
`getResolvedProvider()` helper) must not silently regress the allow path. The positive test is the
regression net.

**User Journey**:
1. Reviewer opens `harness-provider-compat.test.ts` and sees both the REJECT case (test (b)/(c)) and
   the ALLOW case (the new test (d)) side by side.
2. The pair proves the guard is a *true* compatibility check (rejects zai, allows anthropic), not a
   blanket `claude-code` rejection (which was the Issue-2 bug).

**Pain Points Addressed**: Before this test, the only `claude-code` assertions in the suite were
negative (throws). A reader could not distinguish "the new resolved-provider fix works" from "the old
hardcoded-constant bug is still present" — both reject `claude-code`+zai identically.

## Why

- **Closes the Issue-2 verification loop.** P1.M1.T2.S1 shipped the *source* change (resolved-provider
  derivation); without a positive test, that fix is unproven and could be reverted without any test
  failing.
- **Satisfies the task contract.** Item 3(a) explicitly requires a positive case: stub
  `PRP_AGENT_HARNESS='claude-code'` AND `ANTHROPIC_DEFAULT_SONNET_MODEL='anthropic/claude-sonnet-4'`,
  call `configureHarness()`, assert it does NOT throw, returns `'claude-code'`, and calls
  `configureHarnesses` with `defaultHarness:'claude-code'`.
- **Future-proofs 100% branch coverage.** The `vitest.config.ts` enforces 100% branches on
  `src/**/*.ts`. Today the `&&` second operand (`resolvedProvider === 'zai'`) is only ever evaluated
  in its TRUE direction (under `claude-code`). A refactor that turns the `&&` into `if (harness ===
  'claude-code') { if (resolvedProvider === 'zai') throw; }` would create a *new* uncovered FALSE
  branch — unless this positive test exists.
- **Default path is untouched.** The existing pi tests, the reject test (b), and `harness-config.test.ts`
  all stay byte-identical and green.

## What

Append **one** `it(...)` case to the existing `describe` block in
`tests/unit/config/harness-provider-compat.test.ts`. Concretely:

### The new test (canonical form)

```ts
it('(d) claude-code + anthropic provider is ALLOWED (no throw) — resolved-provider guard allow branch', () => {
  // SETUP: claude-code harness + an anthropic/* model override.
  // getModel('sonnet') reads ANTHROPIC_DEFAULT_SONNET_MODEL FIRST → 'anthropic/claude-sonnet-4'
  // (qualifyModel is idempotent on '/') → resolvedProvider = 'anthropic' → guard does NOT throw.
  vi.stubEnv('PRP_AGENT_HARNESS', 'claude-code');
  vi.stubEnv('ANTHROPIC_DEFAULT_SONNET_MODEL', 'anthropic/claude-sonnet-4');

  // EXECUTE & VERIFY: returns 'claude-code' (reaching this assertion PROVES no throw).
  expect(configureHarness()).toBe('claude-code');

  // VERIFY: Step 5 delegation happened with claude-code as the default harness.
  expect(configureHarnesses).toHaveBeenCalledTimes(1);
  expect(configureHarnesses).toHaveBeenCalledWith(
    expect.objectContaining({ defaultHarness: 'claude-code' })
  );
});
```

### Constraints (DO/DON'T)

- **DO** place the new `it(...)` *inside* the existing `describe('harness/provider compatibility', …)`
  block (e.g. after the existing `(c-cont)` case), so it shares the file's `beforeEach`/`afterEach`
  (which `clearAllMocks`, reset `PRP_AGENT_HARNESS`, stub `ANTHROPIC_API_KEY`, and `unstubAllEnvs`).
- **DO** stub **both** env vars in the test body — `vi.stubEnv` inside the `it` is the established
  pattern (see existing tests (a)/(b)). `afterEach` already calls `vi.unstubAllEnvs()`, so cleanup
  is automatic.
- **DO** assert on the imported `configureHarnesses` mock (already imported at top of file from
  `'groundswell'`). The file's `vi.mock('groundswell', …)` factory makes it a controllable `vi.fn()`.
- **DON'T** assert `defaultModelProvider: 'anthropic'`. Step 5 passes `DEFAULT_MODEL_PROVIDER` (the
  `'zai'` **constant**) into `configureHarnesses` — it is NOT the resolved provider. The resolved
  provider is consulted **only** in the Step-4 guard. Asserting `defaultModelProvider: 'anthropic'`
  would be a false assertion. (You MAY assert `defaultModelProvider: DEFAULT_MODEL_PROVIDER` if you
  want symmetry with test (a), but it is not required.)
- **DON'T** modify the `vi.mock('groundswell', …)` factory. Its inline stub
  `HarnessRegistry: { getInstance: () => ({ has: () => false, register: vi.fn() }) }` already makes
  the new test's Step 4.5 (registration) a no-op that passes. `PiHarness: class MockPiHarness {}`
  is already stubbed.
- **DON'T** add the positive case to `harness-config.test.ts` (duplication). The contract designates
  `harness-provider-compat.test.ts` as the compatibility-guard test file (the "preferred" location).
- **DON'T** change any source file. P1.M1.T2.S1 already shipped the guard; this subtask is test-only.

### Why no mock change is needed

The existing inline mock in this file is:
```ts
vi.mock('groundswell', () => ({
  configureHarnesses: vi.fn(),
  HarnessRegistry: { getInstance: () => ({ has: () => false, register: vi.fn() }) },
  PiHarness: class MockPiHarness {},
}));
```
For the new test, `configureHarness()` runs Steps 4 → 4.5 → 5:
- **Step 4** reads the *real* `getModel('sonnet')` (environment.ts is a sibling internal module, NOT
  mocked) → with the stubbed override → `'anthropic/claude-sonnet-4'` → `resolvedProvider = 'anthropic'`
  → guard skipped (no throw). ✓
- **Step 4.5** calls `HarnessRegistry.getInstance().has('pi')` → mock returns `false` → calls
  `register(new MockPiHarness())` → no-op `vi.fn()`. ✓
- **Step 5** calls `configureHarnesses({ defaultHarness: 'claude-code', … })` → recorded on the mock. ✓

So the new test is a pure addition — zero mock/config changes.

### Success Criteria

- [ ] One new `it(...)` case added to `tests/unit/config/harness-provider-compat.test.ts`, asserting
      `claude-code` + `ANTHROPIC_DEFAULT_SONNET_MODEL='anthropic/claude-sonnet-4'` → no throw,
      returns `'claude-code'`, and `configureHarnesses` called with `defaultHarness: 'claude-code'`.
- [ ] `npm run test:run -- config/harness-provider-compat` → 6/6 pass.
- [ ] `npm run test:run -- config/harness-provider-compat config/harness-config --coverage` → all
      pass, `src/config/harness.ts` shows **100% branches**.
- [ ] No source files, no mock factories, no new files, no dependency/config files modified.

## All Needed Context

### Context Completeness Check

_Pass._ A developer who has never seen this repo can implement this from the four file references
below + the exact canonical test block. The only failure modes (asserting the wrong
`defaultModelProvider`, editing the mock, or duplicating into `harness-config.test.ts`) are all
enumerated below with the reason each is avoided. The non-obvious coverage finding (v8 already
reports 100%) is documented up-front so the implementer understands the task is *behavioral* coverage,
not threshold-chasing.

### Documentation & References

```yaml
# MUST READ - Include these in your context window

- file: tests/unit/config/harness-provider-compat.test.ts
  why: TARGET FILE. Append the new it(...) inside the existing describe block. Mirrors the
        existing test (b) structure but asserts the OPPOSITE outcome (no throw).
  pattern: |
    # Existing reject test (b) — mirror this structure for the allow case:
    it('(b) claude-code + zai throws HarnessProviderMismatchError with actionable guidance', () => {
      vi.stubEnv('PRP_AGENT_HARNESS', 'claude-code');
      // … expects throw …
      expect(configureHarnesses).not.toHaveBeenCalled();
    });
    # New allow test (d) — same setup shape, ADD the anthropic override, assert NO throw + delegation:
    it('(d) claude-code + anthropic provider is ALLOWED (no throw) …', () => {
      vi.stubEnv('PRP_AGENT_HARNESS', 'claude-code');
      vi.stubEnv('ANTHROPIC_DEFAULT_SONNET_MODEL', 'anthropic/claude-sonnet-4');
      expect(configureHarness()).toBe('claude-code');
      expect(configureHarnesses).toHaveBeenCalledWith(
        expect.objectContaining({ defaultHarness: 'claude-code' })
      );
    });
  gotcha: |
    The file's beforeEach does `delete process.env.PRP_AGENT_HARNESS` + `vi.clearAllMocks()` +
    `vi.stubEnv('ANTHROPIC_API_KEY', 'stubbed-key')`; afterEach does `vi.unstubAllEnvs()`. So
    stubbing ANTHROPIC_DEFAULT_SONNET_MODEL inside the new it(...) is auto-cleaned — do NOT add a
    manual `delete`/restore. clearAllMocks() resets the configureHarnesses call history before each
    test, so `toHaveBeenCalledTimes(1)` is safe.

- file: src/config/harness.ts
  why: The function under test. Confirms Step 4 derives the resolved provider and that Step 5 passes
        the CONSTANT DEFAULT_MODEL_PROVIDER (not the resolved provider) into configureHarnesses.
  pattern: |
    // Step 4 (the guard this test exercises the ALLOW arm of):
    const resolvedProvider = getModel('sonnet').split('/')[0];
    if (harness === 'claude-code' && resolvedProvider === 'zai') {
      throw new HarnessProviderMismatchError(harness, resolvedProvider);
    }
    // Step 5 (what the test asserts is reached):
    configureHarnesses({
      defaultHarness: harness,                       // ← 'claude-code' in the allow case
      defaultModelProvider: DEFAULT_MODEL_PROVIDER,  // ← STILL the 'zai' constant (do NOT assert 'anthropic')
      harnessDefaults: { 'claude-code': { apiKey: process.env.ANTHROPIC_API_KEY } },
    });
    return harness; // ← 'claude-code'
  critical: |
    The `defaultHarness` arg IS the resolved harness ('claude-code'); the `defaultModelProvider`
    arg is the CONSTANT 'zai'. Assert `defaultHarness: 'claude-code'` only. Asserting
    `defaultModelProvider: 'anthropic'` is a FALSE assertion that will fail the test.

- file: src/config/environment.ts
  why: Source of the REAL getModel('sonnet') used by the guard. Confirms the override is honoured
        and qualifyModel is idempotent, so 'anthropic/claude-sonnet-4' passes through unchanged.
  pattern: |
    export function qualifyModel(name, provider = DEFAULT_MODEL_PROVIDER): string {
      return name.includes('/') ? name : `${provider}/${name}`;   // idempotent on already-qualified
    }
    export function getModel(tier: ModelTier): string {
      return qualifyModel(process.env[MODEL_ENV_VARS[tier]] ?? MODEL_NAMES[tier]);
      //                  ^ reads ANTHROPIC_DEFAULT_SONNET_MODEL FIRST for tier 'sonnet'
    }
  critical: |
    getModel is NOT mocked (tests mock 'groundswell' only). With the stub 'anthropic/claude-sonnet-4',
    getModel('sonnet') → 'anthropic/claude-sonnet-4' → .split('/')[0] → 'anthropic' → guard skipped.
    Without any stub it returns 'zai/GLM-4.7' → 'zai' → reject (existing test (b) relies on this).

- file: tests/unit/config/harness-config.test.ts
  why: REGRESSION GATE — must stay green (untouched). It uses vi.hoisted() mockHas/mockRegister and
        test (e) covers the `has() => true` SKIP arm of the Step-4.5 registration guard. The new
        positive test in harness-provider-compat.test.ts covers the `has() => false` REGISTER arm
        again. TOGETHER the registration guard's two branches stay fully covered.
  gotcha: |
    Do NOT add the positive claude-code+anthropic case here — it would duplicate the
    harness-provider-compat.test.ts case and muddy the "compat-guard file" separation. This file's
    test (c) is the claude-code+zai REJECT case; leave it as-is.

- docfile: plan/004_439241a82c24/bugfix/001_4bbb8673119e/architecture/system_context.md
  section: §3 "Issue 2 Root Cause & Fix Surface" (esp. the "Coverage concern" note)
  why: Authoritative statement that the false-arm of the new guard must be exercised by a positive
        claude-code+anthropic case — this IS that case. §6 documents the 100% coverage enforcement.
  critical: |
    §3's coverage note anticipated this exact test. §1 documents the dual-groundswell environment:
    in the vitest environment groundswell resolves to the sibling checkout, but THIS test fully mocks
    groundswell, so the runtime SDK availability is irrelevant — the test validates the GUARD logic
    only, not claude-code execution. (Running claude-code end-to-end needs @anthropic-ai/claude-agent-sdk,
    a separate pre-existing dependency concern — explicitly out of scope.)
```

### Current Codebase tree (relevant slice)

```bash
src/config/
├── harness.ts          # SUT — Step 4 resolved-provider guard (shipped in P1.M1.T2.S1); Step 5 uses CONSTANT
├── environment.ts      # getModel('sonnet') runs for REAL in the test (NOT mocked)
├── constants.ts        # MODEL_ENV_VARS.sonnet = 'ANTHROPIC_DEFAULT_SONNET_MODEL'; DEFAULT_MODEL_PROVIDER='zai'
└── types.ts            # AgentHarness = 'pi' | 'claude-code'; HarnessProviderMismatchError (thrown only on zai)
tests/unit/config/
├── harness-provider-compat.test.ts   # ← TARGET FILE: append ONE it(...) case (the ALLOW branch)
├── harness-config.test.ts            # REGRESSION GATE — untouched; covers Step-4.5 has()=>true skip arm
├── environment.test.ts               # unaffected
├── endpoint-guard.test.ts            # unaffected
└── harness.test.ts                   # unaffected (constants/types/error-class only)
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# No new files. One existing file edited in place:
tests/unit/config/harness-provider-compat.test.ts   # +1 it(...) case (~10 lines) inside the describe block
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: assert defaultHarness:'claude-code', NOT defaultModelProvider:'anthropic'. Step 5 passes
//   DEFAULT_MODEL_PROVIDER (the 'zai' constant) into configureHarnesses — it is NEVER the resolved
//   provider. The resolved provider is consulted ONLY in the Step-4 guard. This is the #1 trap.
//
// CRITICAL: getModel is NOT in the vi.mock('groundswell') factory and MUST NOT be added. getModel is a
//   local ./environment.js export; the test controls the provider purely via
//   vi.stubEnv('ANTHROPIC_DEFAULT_SONNET_MODEL', 'anthropic/claude-sonnet-4'). getModel runs for real.
//
// GOTCHA (coverage already green): npm run test:run -- … --coverage will show harness.ts at 100%
//   branches EVEN WITHOUT this new test, because v8 collapses `if (A && B)` into one throw/skip
//   branch and the pi tests already hit "skip". The new test's value is BEHAVIORAL (proving the allow
//   path) + REFACTOR-SAFETY (exercising resolvedProvider!=='zai' under harness==='claude-code'). Do NOT
//   "fix" a non-existent coverage failure; just confirm 100% is MAINTAINED and the new test passes.
//
// GOTCHA (cleanup is automatic): the file's afterEach calls vi.unstubAllEnvs(), so the
//   ANTHROPIC_DEFAULT_SONNET_MODEL stub is removed after the test. Do NOT add a manual restore.
//   beforeEach calls vi.clearAllMocks(), so configureHarnesses call counts reset per test —
//   toHaveBeenCalledTimes(1) is correct.
//
// GOTCHA (tests/setup.ts endpoint guard): the global beforeEach runs validateProviderEndpoint() which
//   throws on api.anthropic.com. This test does NOT stub ANTHROPIC_BASE_URL, so it inherits whatever
//   .env provides (the z.ai default) — fine, no endpoint interaction. Do NOT stub ANTHROPIC_BASE_URL to
//   api.anthropic.com "to match the anthropic provider" — that would make setup.ts throw.
//
// GOTCHA (no SDK needed): the test mocks groundswell, so @anthropic-ai/claude-agent-sdk (not installed
//   in this repo's node_modules) is never imported. The test validates the GUARD, not claude-code runtime.
```

## Implementation Blueprint

### Data models and structure

None. No new models, types, fixtures, or exported symbols. One `it(...)` case added to an existing
`describe` block.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT tests/unit/config/harness-provider-compat.test.ts — append the positive ALLOW case
  - LOCATE: the existing describe('harness/provider compatibility', () => { … }) block. Place the
      new it(...) as case (d), AFTER the existing (c-cont) "unknown id" case and BEFORE the closing
      }); of the describe.
  - ADD (verbatim or equivalent — see canonical form in "What"):
      it('(d) claude-code + anthropic provider is ALLOWED (no throw) — resolved-provider guard allow branch', () => {
        vi.stubEnv('PRP_AGENT_HARNESS', 'claude-code');
        vi.stubEnv('ANTHROPIC_DEFAULT_SONNET_MODEL', 'anthropic/claude-sonnet-4');
        expect(configureHarness()).toBe('claude-code');
        expect(configureHarnesses).toHaveBeenCalledTimes(1);
        expect(configureHarnesses).toHaveBeenCalledWith(
          expect.objectContaining({ defaultHarness: 'claude-code' })
        );
      });
  - REUSE: the already-imported `configureHarness` (from ../../../src/config/harness.js) and the
      already-imported `configureHarnesses` mock (from 'groundswell'). NO new imports needed.
  - NAMING: follow the file's existing '(a)/(b)/(c)' lettered-prefix convention; '(d)' is the next
      unused letter (the existing block uses a, a-cont, b, c, c-cont).
  - DO NOT: modify the vi.mock factory, beforeEach/afterEach, or any existing test.
  - DO NOT: add a second "reject with unset override" case — that scenario is ALREADY covered by
      existing test (b)/(c) (which do not stub the override → getModel defaults to 'zai/GLM-4.7' →
      reject). The contract marks this as OPTIONAL; adding it would duplicate (b).

Task 2: VERIFY (no code change — validation only)
  - RUN: `npm run test:run -- config/harness-provider-compat` → expect 6/6 pass.
  - RUN: `npm run test:run -- config/harness-provider-compat config/harness-config --coverage`
      → expect all pass AND src/config/harness.ts shows 100% branches (the contract's gate).
  - RUN: `npm run test:run -- config` → expect all config tests green (no incidental breakage).
  - RUN: `npx prettier --check tests/unit/config/harness-provider-compat.test.ts` → pass.
```

### Implementation Patterns & Key Details

```ts
// PATTERN: positive/negative test pairing for a compatibility guard. The file already has the
// NEGATIVE case (claude-code + zai → throws); the new case is its POSITIVE mirror (claude-code +
// anthropic → allowed). Together they prove the guard is a true compatibility check, not a blanket
// rejection — which is the whole point of Issue 2's resolved-provider fix.

// PATTERN: control the resolved provider via vi.stubEnv, NOT via mocking getModel. getModel is a
// local ./environment.js export; the test treats it as a black box and drives it through its real
// env-var input. This keeps the test honest about the actual production code path.
vi.stubEnv('ANTHROPIC_DEFAULT_SONNET_MODEL', 'anthropic/claude-sonnet-4');
//   → getModel('sonnet') reads this FIRST → qualifyModel('anthropic/claude-sonnet-4')
//   → idempotent (already has '/') → 'anthropic/claude-sonnet-4' → split('/')[0] → 'anthropic'.

// PATTERN: "reaching the assertion proves no throw." `expect(configureHarness()).toBe('claude-code')`
// surfaces any thrown error as a test failure (the throw propagates before expect runs). If a more
// explicit no-throw assertion is desired, prepend:
//   expect(() => configureHarness()).not.toThrow();
// (calling configureHarness twice is safe — the mocked register() is a no-op vi.fn()).

// INVARIANT: the new test does NOT touch the reject path, the registration skip path, or the
// invalid-id path. Each of those remains covered by its existing dedicated test.
```

### Integration Points

```yaml
DATABASE:
  - none
CONFIG:
  - none (reads existing ANTHROPIC_DEFAULT_SONNET_MODEL via the real getModel; no new env contract)
ROUTES:
  - none
BUILD / TOOLING:
  - none (no package.json, tsconfig, vitest.config, or .prettierignore changes)
DEPENDENCIES:
  - DEPENDS-ON (completed): P1.M1.T2.S1 — src/config/harness.ts Step 4 already derives
      `resolvedProvider = getModel('sonnet').split('/')[0]` and throws only on `=== 'zai'`.
      (Verified present in current src/config/harness.ts.)
  - DEPENDS-ON (completed): P1.M1.T1.S2 — the vi.mock('groundswell') factory in this file already
      stubs configureHarnesses + HarnessRegistry.getInstance() + PiHarness. (Verified — no mock
      change needed for this subtask.)
  - ENABLES (downstream): P1.M2.T3 — the final 100%-coverage + full-suite gate can now point at a
      behaviourally-complete harness guard (both reject AND allow paths asserted).
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# After appending the test — confirm no formatting regression on the changed file.
npx prettier --check tests/unit/config/harness-provider-compat.test.ts
# Expected: passes. If prettier reformats (e.g. line wrapping on the long it() title), run
# `npx prettier --write tests/unit/config/harness-provider-compat.test.ts` and re-check.

# Lint (eslint . --ext .ts). The change touches tests/, which IS eslint-in-scope.
npm run lint
# Expected: zero NEW errors in the edited test file. (Pre-existing src/tools/* Issue-4 errors are
# out of scope; do NOT fix them here.)

# Note: tsconfig.build.json excludes tests/, so `npm run typecheck` does NOT typecheck test files.
# A type error in the test would instead surface as a vitest transform/compile failure at run time
# (caught by the Level 2 gate below).
```

### Level 2: Unit Tests (Primary Gate)

```bash
# PRIMARY GATE per the task contract — the new positive case must pass.
npm run test:run -- config/harness-provider-compat
# Expected: Test Files 1 passed | Tests 6 passed (was 5).
# Specifically the new '(d) claude-code + anthropic provider is ALLOWED …' must pass.
# If it FAILS with "expected … to be 'claude-code'" / a thrown HarnessProviderMismatchError:
#   → you did NOT stub ANTHROPIC_DEFAULT_SONNET_MODEL (or stubbed it AFTER calling configureHarness).
#   → confirm vi.stubEnv('ANTHROPIC_DEFAULT_SONNET_MODEL', 'anthropic/claude-sonnet-4') runs BEFORE
#     the configureHarness() call, inside the it(...) body (not in a non-stubbed hook).
# If it FAILS on the configureHarnesses assertion:
#   → confirm you asserted defaultHarness:'claude-code' (NOT defaultModelProvider:'anthropic').

# COVERAGE GATE per the task contract — harness.ts must show 100% branches.
npm run test:run -- config/harness-provider-compat config/harness-config --coverage
# Expected: all tests pass; in the coverage table:
#   harness.ts  | 100 | 100 | 100 | 100 |
# (Per the empirical finding, this is MAINTAINED, not newly-achieved — the value of the new test is
#  behavioral + refactor-safety. Confirm the number is 100, not < 100.)
```

### Level 3: Integration Testing (Cross-module Safety)

```bash
# Confirm the whole config surface still passes (no incidental breakage from the new case).
npm run test:run -- config
# Expected: all tests/unit/config/*.test.ts green (harness, harness-config, harness-provider-compat,
# environment, endpoint-guard).

# Confirm the downstream agent-factory creation tests still pass (the new test does not touch the
# default 'pi' path, but this guards against any env-stub leakage between files).
npm run test:run -- agents/agent-factory
# Expected: all green incl. the 5 persona-creation tests.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Manual proof that the resolved-provider derivation actually allows claude-code+anthropic at the
# GUARD level (the runtime groundswell may still fail later on the missing claude-agent-sdk — that is
# a separate pre-existing dependency concern, NOT this guard's responsibility).
npx tsx -e "
  process.env.ANTHROPIC_DEFAULT_SONNET_MODEL = 'anthropic/claude-sonnet-4';
  process.env.PRP_AGENT_HARNESS = 'claude-code';
  process.env.ANTHROPIC_API_KEY = 'stub';
  try { const h = (await import('./src/config/harness.js')).configureHarness();
        console.log('OK claude-code allowed by guard, resolved harness=', h); }
  catch (e) { console.log('GUARD rejected:', e.name, '|', e.message); }
"
# Expected: "OK claude-code allowed by guard, resolved harness= claude-code"
#   (If this prints a HarnessProviderMismatchError, P1.M1.T2.S1 was NOT actually merged — re-check
#    src/config/harness.ts Step 4 reads getModel('sonnet').split('/')[0], not DEFAULT_MODEL_PROVIDER.)

# Coverage detail probe (optional — confirm no zero-hit branch arms on harness.ts after the change):
#   npx vitest run config/harness-provider-compat config/harness-config \
#     --coverage.enabled --coverage.reporter=json --coverage.reportsDirectory=/tmp/cov
#   then inspect /tmp/cov/coverage-final.json for src/config/harness.ts branch counts (all > 0).

# DO NOT attempt to actually RUN a claude-code agent — @anthropic-ai/claude-agent-sdk is not installed
# in this repo (see system_context.md §1/§7). The guard-level proof above is the complete scope.
```

## Final Validation Checklist

### Technical Validation

- [ ] Level 1: `npx prettier --check tests/unit/config/harness-provider-compat.test.ts` passes.
- [ ] Level 1: `npm run lint` → no new errors in the edited test file.
- [ ] Level 2: `npm run test:run -- config/harness-provider-compat` → **6/6 pass** (new case green).
- [ ] Level 2: `npm run test:run -- config/harness-provider-compat config/harness-config --coverage`
      → all pass, `src/config/harness.ts` = **100% branches**.
- [ ] Level 3: `npm run test:run -- config` → all green; `agents/agent-factory` still green.
- [ ] Only `tests/unit/config/harness-provider-compat.test.ts` modified; no source/config/new files.

### Feature Validation

- [ ] New test stubs BOTH `PRP_AGENT_HARNESS='claude-code'` AND
      `ANTHROPIC_DEFAULT_SONNET_MODEL='anthropic/claude-sonnet-4'`.
- [ ] New test asserts `configureHarness()` returns `'claude-code'` (proves no throw).
- [ ] New test asserts `configureHarnesses` called with `defaultHarness: 'claude-code'`.
- [ ] New test does NOT assert `defaultModelProvider: 'anthropic'` (Step 5 uses the 'zai' constant).
- [ ] The reject path (claude-code + zai) is STILL covered by existing test (b)/(c) — untouched.
- [ ] The registration skip path (`has() => true`) is STILL covered by harness-config.test.ts test (e).

### Code Quality Validation

- [ ] New test follows the file's existing `it('(x) …', () => { vi.stubEnv(…); … })` style.
- [ ] No new imports added (reuses existing `configureHarness` + `configureHarnesses`).
- [ ] No modification to `vi.mock('groundswell', …)`, `beforeEach`, or `afterEach`.
- [ ] No duplication of the (optional) "unset override → reject" case (already covered by test (b)).
- [ ] Test placement is INSIDE the existing `describe` block (shares hooks).

### Documentation & Deployment

- [ ] No env vars added (drives existing `ANTHROPIC_DEFAULT_SONNET_MODEL` via the real `getModel`).
- [ ] No operational docs change required (the `claude-code` configuration guidance in
      `docs/CONFIGURATION.md` already documents the anthropic-override requirement).

---

## Scope Boundaries (DO NOT EXPAND)

This subtask is **test coverage only** for the Issue-2 allow branch. The following are explicitly
OUT OF SCOPE and owned by sibling subtasks:

- ❌ Any change to `src/config/harness.ts` (the guard was shipped in **P1.M1.T2.S1** — done).
- ❌ Any change to the `vi.mock('groundswell', …)` factory or to `beforeEach`/`afterEach`
      (the stubs from **P1.M1.T1.S2** are sufficient — verified).
- ❌ Adding the positive case to `harness-config.test.ts` (duplication; the contract designates
      `harness-provider-compat.test.ts` as the compat-guard file).
- ❌ Fixing Issue 3 (`docs:lint` / markdownlint-cli) or Issue 4 (`ToolExecutor` typecheck /
      prettierignore) — **P1.M2.T1 / P1.M2.T2**.
- ❌ Running the full `npm run validate` / `npm run test:coverage` (whole suite) as a pass/fail gate
      for THIS task — they are blocked by Issues 3–4 and owned by **P1.M2.T3**. (You MAY run the
      scoped `--coverage` on the two config test files, which is what the contract asks for.)
- ❌ Attempting to exercise the `claude-code` harness at runtime (requires the uninstalled
      `@anthropic-ai/claude-agent-sdk` — a separate pre-existing environment concern, system_context.md §1).

---

## Anti-Patterns to Avoid

- ❌ Don't assert `defaultModelProvider: 'anthropic'` — Step 5 passes the `'zai'` CONSTANT, not the
  resolved provider. This is the single most likely false assertion; assert `defaultHarness:'claude-code'` only.
- ❌ Don't add `getModel` to the `vi.mock('groundswell', …)` factory — `getModel` is a local
  `./environment.js` export, not a groundswell export; it runs for real by design and is driven via
  `vi.stubEnv('ANTHROPIC_DEFAULT_SONNET_MODEL', …)`.
- ❌ Don't stub `ANTHROPIC_BASE_URL` to `api.anthropic.com` "to match the anthropic provider" — the
  global `tests/setup.ts` endpoint guard throws on that host. Leave the endpoint alone; this test has
  no endpoint interaction.
- ❌ Don't add a manual `vi.unstubAllEnvs()` / `delete process.env.ANTHROPIC_DEFAULT_SONNET_MODEL` in
  the test — the file's `afterEach` already restores all stubbed envs.
- ❌ Don't duplicate the "claude-code + unset-override → reject" case — existing test (b)/(c) already
  covers it (the contract marks it OPTIONAL; adding it is pure duplication).
- ❌ Don't "also add a positive case to harness-config.test.ts for completeness" — it muddies the
  file separation and is explicitly out of scope.
- ❌ Don't chase a non-existent coverage failure. If `harness.ts` already shows 100% branches, that is
  EXPECTED (v8 models the `&&` as one branch). The new test's value is behavioral proof + refactor-safety.
- ❌ Don't edit any source file to "make the test pass" — if the new test fails, the cause is in the
  test setup (wrong/missing stub, wrong assertion), NOT in `harness.ts` (which P1.M1.T2.S1 already fixed).

---

**Confidence Score: 9.5/10** for one-pass implementation success. The deliverable is one appended
`it(...)` case (~10 lines) to one test file, with an exact canonical block quoted above, no new
imports, no mock changes, and no source changes. Every assertion, every stub, the no-cleanup-needed
guarantee, the "don't assert defaultModelProvider:'anthropic'" trap, and the "coverage is already
green — this is behavioral" finding have been verified against the live code and an empirical coverage
run. The 0.5 residual risk is purely a discipline risk: an implementer tempted to "also assert the
provider is anthropic", "also touch the mock", "also add the case to harness-config.test.ts", or
"also tweak harness.ts" must be held to the narrow S2 scope defined above.
