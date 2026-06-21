name: "P1.M1.T2.S1 — Replace DEFAULT_MODEL_PROVIDER constant check with resolved-provider derivation in configureHarness() Step 4"
description: |

---

## Goal

**Feature Goal**: Replace the compile-time `DEFAULT_MODEL_PROVIDER === 'zai'` constant check
in `configureHarness()` **Step 4** with a *resolved-provider* derivation (`getModel('sonnet').split('/')[0]`)
so that the `claude-code` harness guard fires ONLY when `claude-code` is actually combined
with the effective `zai` provider — not unconditionally. This realises PRD §9.4.1
(`claude-code` is a supported harness) and §9.4.2/§9.2.4 ("selected independently"; only the
`zai`+`claude-code` combination is a config error).

**Deliverable**: A single edited source file — `src/config/harness.ts` — with (a) one new
import line (`getModel` from `./environment.js`) and (b) the Step 4 block rewritten to derive
the provider from the resolved model string. No new files, no test changes, no dependency
changes. (Positive `claude-code + anthropic` test coverage is explicitly deferred to
**P1.M1.T2.S2**.)

**Success Definition**:
- `npx tsc --noEmit -p tsconfig.build.json` → **0 new** errors (18 pre-existing errors in
  `src/tools/*` remain — Issue 4, out of scope; **none** in `harness.ts`/`environment.ts`).
- `npm run test:run -- config/harness-provider-compat` → **5/5 pass** (the existing test (b)
  `claude-code + zai throws` MUST still pass — see "Why test (b) still passes" below).
- `npm run test:run -- config/harness-config` → all pass (Step 5 still uses
  `DEFAULT_MODEL_PROVIDER`, so `configureHarnesses.toHaveBeenCalledWith({ defaultModelProvider: 'zai' })`
  assertions stay green).
- `npx prettier --check src/config/harness.ts` passes; `npm run lint` introduces no new errors.

## User Persona (if applicable)

**Target User**: Operator / developer who wants to run the `claude-code` agent runtime with
`anthropic/*` model overrides (PRD §9.4.1 optional harness, §9.2.4 note).

**Use Case**: Set `PRP_AGENT_HARNESS=claude-code` together with
`ANTHROPIC_DEFAULT_SONNET_MODEL=anthropic/claude-sonnet-4` (and the anthropic endpoint) and
have `configureHarness()` proceed past Step 4 to registration + `configureHarnesses()`.

**User Journey**:
1. Operator sets the env overrides described in `docs/CONFIGURATION.md`.
2. At startup `agent-factory.ts` calls `configureHarness()` at module-load.
3. Step 4 derives `resolvedProvider = getModel('sonnet').split('/')[0] === 'anthropic'` →
   does NOT throw.
4. Step 4.5 registers `PiHarness` (S1); Step 5 delegates to `configureHarnesses()`.

**Pain Points Addressed**: Today Step 4 unconditionally throws for `claude-code` regardless
of overrides, because it reads the hardcoded `DEFAULT_MODEL_PROVIDER` constant instead of the
resolved provider. The "pluggable" harness system therefore cannot plug in `claude-code` at all.

## Why

- **PRD §9.4.1 / §9.2.4 compliance**: `claude-code` is a *supported* harness; only its
  combination with the `zai` provider is a config error. Today the guard can never be satisfied.
- **Issue 2 (Major) of the Session-004 QA report**: the compatibility guard checks a hardcoded
  constant, so the optional `claude-code` harness is permanently unusable.
- **Unblocks P1.M1.T2.S2**: the positive-path test (`claude-code + anthropic` passes) cannot be
  written until the guard reads the *resolved* provider. This subtask ships the source change;
  S2 ships the coverage.
- **Default path is untouched**: with no model override, `getModel('sonnet')` → `'zai/GLM-4.7'`
  → `resolvedProvider === 'zai'` → the existing rejection (and the pi default path) behave
  exactly as before.

## What

Modify **one** block in `src/config/harness.ts` and add **one** import. Concretely:

### Change A — add the import (top of file, with the other `./environment`-adjacent imports)

```ts
import { getModel } from './environment.js';
```

### Change B — rewrite Step 4

```ts
  // BEFORE (current):
  if (harness === 'claude-code' && DEFAULT_MODEL_PROVIDER === 'zai') {
    throw new HarnessProviderMismatchError(harness, DEFAULT_MODEL_PROVIDER);
  }

  // AFTER:
  const resolvedProvider = getModel('sonnet').split('/')[0];
  if (harness === 'claude-code' && resolvedProvider === 'zai') {
    throw new HarnessProviderMismatchError(harness, resolvedProvider);
  }
```

### Constraints (DO/DON'T)

- **DO** keep the `DEFAULT_MODEL_PROVIDER` import from `./constants.js` — it is still used in
  **Step 5** (`defaultModelProvider: DEFAULT_MODEL_PROVIDER`).
- **DO** keep the existing JSDoc on `configureHarness()` (it already describes the
  harness↔provider compatibility contract; optionally note the resolved-provider derivation).
- **DON'T** remove or rename `DEFAULT_MODEL_PROVIDER`.
- **DON'T** add any test, helper, or new exported function in this subtask (coverage is S2).
- **DON'T** introduce a `getResolvedProvider()` helper — the task contract specifies the inline
  two-liner above. (A helper would be an out-of-scope refactor; S2 can wrap it later if desired.)

### Why test (b) still passes (the critical invariant to verify)

`getModel('sonnet')` with no `ANTHROPIC_DEFAULT_SONNET_MODEL` override returns
`qualifyModel(MODEL_NAMES.sonnet)` = `qualifyModel('GLM-4.7')` = `'zai/GLM-4.7'`, so
`'zai/GLM-4.7'.split('/')[0] === 'zai'` → the throw STILL fires for test (b), which does NOT
stub the override. The constant check and the resolved check agree exactly on the default path.

### Success Criteria

- [ ] `src/config/harness.ts` Step 4 uses `getModel('sonnet').split('/')[0]` (not
      `DEFAULT_MODEL_PROVIDER`) in both the condition and the thrown error.
- [ ] `import { getModel } from './environment.js';` is present; `DEFAULT_MODEL_PROVIDER`
      import is retained.
- [ ] `npx tsc --noEmit -p tsconfig.build.json` → 0 new errors (18 pre-existing in `src/tools/*`).
- [ ] `npm run test:run -- config/harness-provider-compat` → 5/5 pass.
- [ ] `npm run test:run -- config/harness-config` → all pass.

## All Needed Context

### Context Completeness Check

_Pass._ A developer who has never seen this repo can implement this from the four file
references below + the exact before/after block. The change is two surgical edits to one
source file; the failure modes (typecheck regressions, broken test (b), removed import) are
all enumerated below with the reason each is avoided.

### Documentation & References

```yaml
# MUST READ - Include these in your context window

- file: src/config/harness.ts
  why: TARGET FILE. Step 4 is the block to rewrite; Step 5 is why DEFAULT_MODEL_PROVIDER must
        stay imported.
  pattern: |
    # Step 4 (REWRITE):
    const resolvedProvider = getModel('sonnet').split('/')[0];
    if (harness === 'claude-code' && resolvedProvider === 'zai') {
      throw new HarnessProviderMismatchError(harness, resolvedProvider);
    }
    # Step 5 (KEEP — uses DEFAULT_MODEL_PROVIDER):
    configureHarnesses({
      defaultHarness: harness,
      defaultModelProvider: DEFAULT_MODEL_PROVIDER,
      harnessDefaults: { 'claude-code': { apiKey: process.env.ANTHROPIC_API_KEY } },
    });
  gotcha: |
    Step 4.5 (the PiHarness registration block added by P1.M1.T1.S1) sits BETWEEN Step 4 and
    Step 5. Do NOT disturb it. The new `const resolvedProvider` declaration must go ABOVE the
    `if` — placing it after Step 4.5 would leave it unused/hoisting-scoped incorrectly. Keep
    the comment header "// Step 4: Enforce harness↔provider compatibility" in place.

- file: src/config/environment.ts
  why: Source of `getModel(tier)` and `qualifyModel(name, provider)`. Confirms the return shape
        and the idempotency guarantee that makes `.split('/')[0]` safe.
  pattern: |
    export function qualifyModel(name, provider = DEFAULT_MODEL_PROVIDER): string {
      return name.includes('/') ? name : `${provider}/${name}`;
    }
    export function getModel(tier: ModelTier): string {
      return qualifyModel(process.env[MODEL_ENV_VARS[tier]] ?? MODEL_NAMES[tier]);
    }
  critical: |
    `getModel('sonnet')` reads `process.env.ANTHROPIC_DEFAULT_SONNET_MODEL` FIRST, then falls
    back to MODEL_NAMES.sonnet = 'GLM-4.7'. So with no override → 'zai/GLM-4.7' → provider
    'zai'. With override 'anthropic/claude-sonnet-4' → 'anthropic/claude-sonnet-4' (idempotent
    — already-qualified strings pass through unchanged) → provider 'anthropic'.
    NO circular import: environment.ts imports only ./constants.js and ./types.js.

- file: src/config/types.ts
  why: Confirms `HarnessProviderMismatchError` constructor signature and that `string` is
        assignable to `ModelProvider` (so `resolvedProvider: string` needs NO cast).
  pattern: |
    export type ModelProvider = 'zai' | 'anthropic' | (string & {});
    export class HarnessProviderMismatchError extends Error {
      constructor(harness: AgentHarness, provider: ModelProvider) { ... }
    }
  critical: |
    `string & {}` makes a bare `string` assignable to `ModelProvider` (the `{}` intersect only
    excludes null/undefined; `string` satisfies it). Therefore
    `new HarnessProviderMismatchError(harness, resolvedProvider)` where resolvedProvider is
    `string` typechecks cleanly — DO NOT add an `as ModelProvider` cast (unnecessary + would
    be flagged by the no-unnecessary-type-assertion lint if enabled).

- file: src/config/constants.ts
  why: Confirms `DEFAULT_MODEL_PROVIDER = 'zai' as const` (compile-time literal) is the
        constant being replaced in the Step 4 condition. Also exports MODEL_NAMES /
        MODEL_ENV_VARS consumed by environment.ts.
  gotcha: |
    Do NOT remove `DEFAULT_MODEL_PROVIDER` from the harness.ts import list — Step 5 still uses
    it, and harness-config.test.ts asserts on `defaultModelProvider: DEFAULT_MODEL_PROVIDER`.

- file: tests/unit/config/harness-provider-compat.test.ts
  why: The regression gate. Test (b) "claude-code + zai throws" must STILL throw after the
        change. Documents the mock shape (getModel is NOT mocked — environment.ts runs for real).
  critical: |
    This test does NOT stub ANTHROPIC_DEFAULT_SONNET_MODEL, so getModel('sonnet') → 'zai/GLM-4.7'
    → resolvedProvider 'zai' → throw. The test's assertions on err.provider === 'zai' still hold.
    The vi.mock('groundswell') factory does NOT need to change — it mocks groundswell only;
    environment.ts is a sibling internal module, unaffected.

- docfile: plan/004_439241a82c24/bugfix/001_4bbb8673119e/architecture/system_context.md
  section: §3 "Issue 2 Root Cause & Fix Surface"
  why: Authoritative root cause + the exact fix recipe (the code block in this PRP is quoted
        from §3). Also documents the 100%-branch-coverage deferral note.
  critical: |
    §3 states the false-arm of the new guard (claude-code + anthropic passes) must be covered
    by tests; that coverage is the deliverable of P1.M1.T2.S2, NOT this subtask. `npm run
    test:run` does NOT enforce coverage thresholds (only `test:coverage` does), so the gap is
    acceptable for THIS subtask's gates.
```

### Current Codebase tree (relevant slice)

```bash
src/config/
├── harness.ts          # ← TARGET FILE (Step 4 rewrite + 1 import)
├── environment.ts      # getModel(tier) / qualifyModel — source of resolved provider
├── constants.ts        # DEFAULT_MODEL_PROVIDER='zai', MODEL_NAMES, MODEL_ENV_VARS
└── types.ts            # ModelProvider type, HarnessProviderMismatchError class
tests/unit/config/
├── harness-provider-compat.test.ts   # REGRESSION GATE — 5 tests, MUST stay green
└── harness-config.test.ts            # REGRESSION GATE — Step 5 defaultModelProvider assertion
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# No new files. One existing file modified in place:
src/config/harness.ts   # +1 import (getModel), Step 4 block rewritten (4 lines)
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: keep the DEFAULT_MODEL_PROVIDER import. It is still used in Step 5
//   (defaultModelProvider: DEFAULT_MODEL_PROVIDER) and asserted on by harness-config.test.ts.
//   Only its Step-4 USAGE is removed.
//
// CRITICAL: place `const resolvedProvider = ...` ABOVE the `if`, not inside/after. It must
//   remain in Step 4's block scope (before Step 4.5 PiHarness registration) to keep the
//   numbered-step structure legible and avoid "declared but never read" if the guard were
//   reordered.
//
// CRITICAL: do NOT cast resolvedProvider to ModelProvider. ModelProvider = 'zai' | 'anthropic'
//   | (string & {}); a plain `string` is already assignable (the `& {}` trick). Adding
//   `as ModelProvider` is a lint smell and unnecessary.
//
// GOTCHA (coverage): the new `resolvedProvider === 'zai'` branch has a TRUE arm (throw,
// covered by test (b)) and a FALSE arm (claude-code + anthropic passes, NOT covered here).
//   npm run test:run does NOT enforce thresholds, so this does not fail THIS task's gates.
//   The false-arm coverage is owned by P1.M1.T2.S2 / P1.M2.T3.
//
// GOTCHA (no mock change): tests mock 'groundswell', NOT './environment.js'. getModel runs for
//   real in the tests. Do NOT add getModel to any vi.mock factory.
//
// GOTCHA (ordering of derivation): getModel reads process.env at CALL time. configureHarness()
//   is invoked at module-load of agent-factory.ts, AFTER tests/setup.ts (which loads .env and
//   runs configureEnvironment). If a test stubs ANTHROPIC_DEFAULT_SONNET_MODEL via
//   vi.stubEnv BEFORE calling configureHarness(), the override is honoured. Test (b) does not
//   stub it → default 'zai' path → still throws.
```

## Implementation Blueprint

### Data models and structure

None. No new models, types, or exported symbols. This is a surgical edit to one function body
plus one import.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/config/harness.ts — add the getModel import
  - LOCATE: the import block at the top (after the groundswell import, near the
      `import { DEFAULT_HARNESS, DEFAULT_MODEL_PROVIDER, … } from './constants.js';` line).
  - ADD a new line:
      import { getModel } from './environment.js';
  - PRESERVE: the existing DEFAULT_MODEL_PROVIDER import (still used in Step 5). Do NOT
      remove or merge it.
  - NAMING/PLACEMENT: group with sibling local-config imports. Follow the existing
      `from './X.js'` (extension-included) convention used throughout the file.
  - VERIFY: `npx prettier --check src/config/harness.ts` still passes (the import line is
      short enough to stay on one line; if prettier reformats, run `--write`).

Task 2: MODIFY src/config/harness.ts — rewrite Step 4 (provider compatibility guard)
  - LOCATE: the Step 4 block (comment "// Step 4: Enforce harness↔provider compatibility"):
        if (harness === 'claude-code' && DEFAULT_MODEL_PROVIDER === 'zai') {
          throw new HarnessProviderMismatchError(harness, DEFAULT_MODEL_PROVIDER);
        }
  - REPLACE WITH (derives resolved provider from the live model string):
        const resolvedProvider = getModel('sonnet').split('/')[0];
        if (harness === 'claude-code' && resolvedProvider === 'zai') {
          throw new HarnessProviderMismatchError(harness, resolvedProvider);
        }
  - PRESERVE: the "// Step 4: …" comment header; the Step 3 cast above it; Step 4.5
      (PiHarness registration) and Step 5 (configureHarnesses) below it — UNCHANGED.
  - DEPENDENCIES: Task 1 (getModel must be imported before it is referenced).
  - DO NOT: introduce a helper, refactor Step 4.5, or touch the JSDoc contract (optional:
      you MAY append a one-line note to the JSDoc explaining the resolved-provider derivation).

Task 3: VERIFY (no code change — validation only)
  - RUN: `npx tsc --noEmit -p tsconfig.build.json` → confirm error count is STILL 18 (no new
      errors in harness.ts/environment.ts). All 18 pre-existing errors live in src/tools/*.
  - RUN: `npm run test:run -- config/harness-provider-compat` → 5/5 pass (test (b) throws).
  - RUN: `npm run test:run -- config/harness-config` → all pass (Step 5 assertion intact).
  - RUN: `npx prettier --check src/config/harness.ts` → pass.
  - RUN: `npm run lint` → no new errors attributable to harness.ts.
```

### Implementation Patterns & Key Details

```ts
// PATTERN: Derive the effective provider from the resolved model string instead of a constant.
// Rationale (PRD §9.4.2 "selected independently" / §9.2.4): the guard should reject ONLY the
// real (zai + claude-code) combination, not every claude-code selection regardless of overrides.
import { getModel } from './environment.js';

// Inside configureHarness(), Step 4:
const resolvedProvider = getModel('sonnet').split('/')[0];
//   getModel('sonnet') → 'zai/GLM-4.7' by default, or 'anthropic/claude-sonnet-4' if
//   ANTHROPIC_DEFAULT_SONNET_MODEL is overridden (qualifyModel is idempotent on '/').
//   .split('/')[0] → 'zai' | 'anthropic' | …  (the effective provider segment).
if (harness === 'claude-code' && resolvedProvider === 'zai') {
  throw new HarnessProviderMismatchError(harness, resolvedProvider);
  //   ^ provider param is `string`, assignable to ModelProvider=(string&{}) — no cast needed.
}

// INVARIANT: on the default path (no override) resolvedProvider === 'zai', so test (b) still
// throws. On an anthropic override path resolvedProvider === 'anthropic', so claude-code
// passes Step 4 → Step 4.5 (PiHarness) → Step 5 (configureHarnesses).
```

### Integration Points

```yaml
DATABASE:
  - none
CONFIG:
  - none (no env-var additions; reads existing ANTHROPIC_DEFAULT_SONNET_MODEL via getModel)
ROUTES:
  - none
BUILD / TOOLING:
  - none (no package.json, tsconfig, or vitest.config changes)
DEPENDENCIES:
  - DEPENDS-ON (completed): P1.M1.T1.S1 — harness.ts already imports PiHarness + HarnessRegistry
      and has the Step 4.5 registration block. (Verified present in current src/config/harness.ts.)
  - DEPENDS-ON (completed): P1.M1.T1.S2 — the config test mocks already stub
      HarnessRegistry + PiHarness (no mock change needed for this subtask).
  - ENABLES (downstream): P1.M1.T2.S2 — the positive claude-code + anthropic test can only pass
      once this resolved-provider guard is in place.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# After the two edits — confirm no formatting regression on the changed file.
npx prettier --check src/config/harness.ts
# Expected: passes. If prettier reformats the new import or block, run
# `npx prettier --write src/config/harness.ts` and re-check.

# Lint (eslint . --ext .ts). The change touches only src/, so it is in-scope.
npm run lint
# Expected: zero NEW errors in src/config/harness.ts. (Pre-existing src/tools/* Issue-4 errors
# are out of scope; do NOT fix them here.)

# Typecheck — THE PRIMARY LEVEL-1 GATE per the task contract.
npx tsc --noEmit -p tsconfig.build.json
# Expected: still 18 errors, ALL in src/tools/{bash,filesystem,git}-mcp.ts (Issue 4, pre-existing).
# CONFIRM: grep the output for `config/harness` or `config/environment` → NO matches.
#   If a NEW error appears in harness.ts (e.g. "resolvedProvider is of type string not
#   assignable to ModelProvider"), STOP — re-read the gotcha: a bare string IS assignable to
#   ModelProvider (string & {}); do NOT add a cast. Check you used getModel('sonnet') exactly.
```

### Level 2: Unit Tests (Regression Gates)

```bash
# PRIMARY GATE per the task contract — the existing (b) test must STILL pass.
npm run test:run -- config/harness-provider-compat
# Expected: Test Files 1 passed | Tests 5 passed.
# Specifically test (b) "claude-code + zai throws HarnessProviderMismatchError …" must pass
# (getModel('sonnet') defaults to 'zai/GLM-4.7' → resolvedProvider 'zai' → still throws;
#  err.provider === 'zai' assertion still holds).
# If test (b) FAILS: confirm you did not stub ANTHROPIC_DEFAULT_SONNET_MODEL in that test
# (you should not have touched the test file at all).

# Step 5 assertion gate — DEFAULT_MODEL_PROVIDER still flows into configureHarnesses.
npm run test:run -- config/harness-config
# Expected: all pass. The configureHarnesses.toHaveBeenCalledWith({ …, defaultModelProvider: 'zai' })
# assertions remain green because Step 5 is unchanged.
```

### Level 3: Integration Testing (Cross-module Safety)

```bash
# Confirm the broader config surface still passes (no incidental breakage from the new import).
npm run test:run -- config
# Expected: all tests/unit/config/*.test.ts green (harness, harness-config,
# harness-provider-compat, environment, endpoint-guard).

# Confirm the downstream agent-factory creation tests still pass (S1 registration unaffected).
npm run test:run -- agents/agent-factory
# Expected: all green incl. the 5 persona-creation tests (the new Step 4 derivation does not
# affect the default 'pi' path — resolvedProvider is computed but only consulted for
# harness === 'claude-code').
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Manual proof that the resolved-provider derivation behaves on BOTH paths (no test-file
# change required — this is a sanity probe using tsx against the REAL modules):

# Probe A — default path still rejects claude-code + zai:
npx tsx -e "
  delete process.env.ANTHROPIC_DEFAULT_SONNET_MODEL;
  process.env.PRP_AGENT_HARNESS = 'claude-code';
  process.env.ANTHROPIC_API_KEY = 'stub';
  try { (await import('./src/config/harness.js')).configureHarness();
        console.log('UNEXPECTED: did not throw'); }
  catch (e) { console.log('OK threw:', e.constructor.name, '| provider=', e.provider); }
"
# Expected: "OK threw: HarnessProviderMismatchError | provider= zai"

# Probe B — anthropic override now allows claude-code (the WHOLE POINT of this fix):
npx tsx -e "
  process.env.ANTHROPIC_DEFAULT_SONNET_MODEL = 'anthropic/claude-sonnet-4';
  process.env.PRP_AGENT_HARNESS = 'claude-code';
  process.env.ANTHROPIC_API_KEY = 'stub';
  try { const h = (await import('./src/config/harness.js')).configureHarness();
        console.log('OK claude-code allowed, resolved harness=', h); }
  catch (e) { console.log('UNEXPECTED threw:', e.message); }
"
# Expected: "OK claude-code allowed, resolved harness= claude-code"
#   (Probe B will only fully succeed if the runtime groundswell has @anthropic-ai/claude-agent-sdk
#    installed; if it throws on a MISSING SDK import rather than on HarnessProviderMismatchError,
#    that is the separate pre-existing dependency concern documented in system_context.md §1 —
#    the GUARD itself has correctly allowed claude-code, which is all this subtask guarantees.)

# DO NOT run `npm run test:coverage` as a gate for THIS task — the false-arm of the new guard
# (claude-code + anthropic passes) is intentionally not covered yet (P1.M1.T2.S2). The full
# 100%-coverage gate is owned by P1.M2.T3.
```

## Final Validation Checklist

### Technical Validation

- [ ] Level 1: `npx prettier --check src/config/harness.ts` passes.
- [ ] Level 1: `npm run lint` → no new errors in `src/config/harness.ts`.
- [ ] Level 1: `npx tsc --noEmit -p tsconfig.build.json` → **0 new** errors (still 18, all in `src/tools/*`); **zero** references to `config/harness` or `config/environment` in the output.
- [ ] Level 2: `npm run test:run -- config/harness-provider-compat` → 5/5 pass (test (b) throws).
- [ ] Level 2: `npm run test:run -- config/harness-config` → all pass.
- [ ] Level 3: `npm run test:run -- config` → all green; `agents/agent-factory` still green.
- [ ] Only `src/config/harness.ts` modified; no test files, no new files, no config changes.

### Feature Validation

- [ ] Step 4 condition reads `resolvedProvider === 'zai'` (NOT `DEFAULT_MODEL_PROVIDER === 'zai'`).
- [ ] `const resolvedProvider = getModel('sonnet').split('/')[0];` is declared above the `if`.
- [ ] The thrown error uses `resolvedProvider` as the provider arg.
- [ ] `import { getModel } from './environment.js';` is present.
- [ ] `DEFAULT_MODEL_PROVIDER` import is RETAINED (Step 5 still uses it).
- [ ] Step 4.5 (PiHarness registration) and Step 5 (configureHarnesses) are byte-unchanged.

### Code Quality Validation

- [ ] No `as ModelProvider` cast (unnecessary — `string` is assignable to `ModelProvider`).
- [ ] No new exported function/helper (inline two-liner per contract).
- [ ] File placement unchanged; only `src/config/harness.ts` edited.
- [ ] Existing JSDoc contract on `configureHarness()` preserved (one-line note optional).

### Documentation & Deployment

- [ ] No env vars added (reads existing `ANTHROPIC_DEFAULT_SONNET_MODEL`).
- [ ] No operational docs change required (the `claude-code` configuration guidance in
      `docs/CONFIGURATION.md` already documents the anthropic-override requirement).

---

## Scope Boundaries (DO NOT EXPAND)

This subtask is the **source-code change only** for Issue 2. The following are explicitly
OUT OF SCOPE and owned by sibling subtasks:

- ❌ Adding the positive `claude-code + anthropic` test (→ **P1.M1.T2.S2** — that is S2's
  entire deliverable).
- ❌ Covering the `resolvedProvider !== 'zai'` FALSE arm via a `has: () => true`-style variant
  or real-model test (→ P1.M1.T2.S2 / P1.M2.T3).
- ❌ Introducing a `getResolvedProvider()` helper exported from environment.ts (out-of-scope
  refactor; the contract specifies the inline two-liner).
- ❌ Modifying any test file, `agent-factory.ts`, or any other source file.
- ❌ Fixing Issue 1 (done), Issue 3 (`docs:lint`), or Issue 4 (`ToolExecutor` typecheck /
  prettierignore) — P1.M2.T1 / P1.M2.T2.
- ❌ Running the full `npm run validate` / `npm run test:coverage` gate as a pass/fail gate for
  THIS task — they are blocked by Issues 3–4 and owned by P1.M2.T3. (You MAY run typecheck as
  a "no new errors" check, which is what the contract asks for.)

---

## Anti-Patterns to Avoid

- ❌ Don't remove the `DEFAULT_MODEL_PROVIDER` import — Step 5 still uses it and tests assert on it.
- ❌ Don't add an `as ModelProvider` cast on `resolvedProvider` — `string` is already assignable to
  `ModelProvider` via the `(string & {})` member; a cast is an unnecessary lint smell.
- ❌ Don't declare `resolvedProvider` inside the `if` or after Step 4.5 — keep it at the top of the
  Step 4 block, before the guard, for legibility and to preserve the numbered-step structure.
- ❌ Don't refactor Step 4.5 (PiHarness registration) "while you're in there" — it is a separate,
  shipped change from P1.M1.T1.S1 and must remain byte-identical.
- ❌ Don't add a `getResolvedProvider()` helper or export from environment.ts — scope creep; the
  contract is an inline two-liner.
- ❌ Don't add `getModel` to any `vi.mock('groundswell')` factory — `getModel` is a local
  `./environment.js` export, not a groundswell export; it runs for real in the tests by design.
- ❌ Don't touch the test files to "make coverage green" — the positive claude-code+anthropic test
  is S2's deliverable; stealing it here breaks the task decomposition and the `npm run test:run`
  (non-coverage) gate already passes without it.
- ❌ Don't run `npm run test:coverage` and chase the uncovered false-arm — it is a known, tracked,
  deferred item owned by P1.M1.T2.S2 / P1.M2.T3.

---

**Confidence Score: 9.5/10** for one-pass implementation success. The change is two surgical
edits to one source file (one import + a 3-line block rewrite) with an exact, authoritative
before/after quoted from architecture §3. The type-safety, the "test (b) still throws"
invariant, the no-circular-import guarantee, and the "keep DEFAULT_MODEL_PROVIDER import"
constraint are all verified against the live code and documented above. The 0.5 residual risk
is purely a discipline risk: an implementer tempted to "also fix coverage", "also add a
helper", or "also remove the now-seemingly-unused constant import" must be held to the narrow
S1 scope defined above.
