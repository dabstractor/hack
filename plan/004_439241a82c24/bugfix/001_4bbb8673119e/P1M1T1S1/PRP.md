# PRP — P1.M1.T1.S1: Register PiHarness (idempotent) inside `configureHarness()`

> **Bugfix subtask** — Issue 1 of `plan/004_439241a82c24/bugfix/001_4bbb8673119e/TEST_RESULTS.md`.
> `createAgent()` throws `"Harness 'pi' is not registered"` for every persona factory.

---

## Goal

**Feature Goal**: Make Groundswell's `HarnessRegistry` singleton contain a live
`PiHarness` instance after `configureHarness()` runs, so that downstream
`createAgent({ harness: 'pi', ... })` finds a registered `pi` provider and stops
throwing. This is a **two-line import change + three-line registration block** —
surgical, source-only, idempotent.

**Deliverable**: A modified `src/config/harness.ts` whose `configureHarness()`
function:
1. Imports `PiHarness` and `HarnessRegistry` from `'groundswell'` (alongside the
   existing `configureHarnesses`).
2. Inserts an idempotent registration block — `if (!registry.has('pi')) registry.register(new PiHarness())`
   — between Step 4 (provider-compat guard) and Step 5 (the `configureHarnesses()` call).

**Success Definition**:
- `npx tsc --noEmit -p tsconfig.build.json` reports **no new errors** in `src/config/harness.ts`
  (the file is currently clean — it must stay clean).
- The registration is provably idempotent: calling `configureHarness()` twice must NOT throw
  `"Provider 'pi' is already registered"`.
- The function's return value (`harness: AgentHarness`) is unchanged.
- Step 4's `DEFAULT_MODEL_PROVIDER` logic is untouched (Issue 2 owns that — P1.M1.T2.S1).
- **No test files are modified in this subtask** (mock updates belong to S2; the full test suite
  is intentionally NOT run here).

---

## Why

- **Fixes a Critical pipeline blocker (TEST_RESULTS.md Issue 1).** Every persona factory
  (`createArchitectAgent`, `createResearcherAgent`, `createCoderAgent`, `createQAAgent`)
  throws at `createAgent()` because `HarnessRegistry` is empty. The pipeline cannot
  instantiate a single agent. PRD §9.3.3 / §9.4.2 / §9.5 step 1; contract P1.M1.T2.S2
  ("All persona factories must still create agents without throwing").
- **`configureHarnesses()` does not register anything.** Confirmed in
  `architecture/system_context.md §2` and `architecture/groundswell_harness_registry.md §1`:
  that function only stores a *config* singleton; the *instance* registry stays empty unless
  someone explicitly calls `registry.register(...)`. So the registration MUST live in PRP code.
- **Why here (and not `agent-factory.ts` or a new file):** `configureHarness()` is already the
  single startup entry point invoked at module-load in `agent-factory.ts`. Putting registration
  there guarantees it runs exactly once per process before any `createAgent()` call, with no
  additional wiring.
- **Why manual `new PiHarness()` and not `registerDefaultHarnesses()`:** that helper lives on
  the `groundswell/harnesses` subpath, which is **not** in the published `exports` map, and it
  imports `ClaudeCodeHarness` → `@anthropic-ai/claude-agent-sdk` (not installed) → module-load
  crash. The main-barrel `PiHarness` import avoids both problems. (See research note §4.)
- **Scope guard:** This subtask is intentionally minimal. Resolved-provider guard (Issue 2),
  mock updates (S2), end-to-end test verification (S3), and the `docs:lint`/`validate` gates
  (M2) are all separate subtasks.

---

## What

### User-visible behavior
None directly. Indirectly (once S2/S3 land): `createArchitectAgent()` and siblings stop
throwing and return live `Agent` objects.

### Technical requirements (exact contract — verbatim from the work item)

**File:** `src/config/harness.ts`.

**(a) Change the groundswell import** from:
```ts
import { configureHarnesses } from 'groundswell';
```
to:
```ts
import { configureHarnesses, PiHarness, HarnessRegistry } from 'groundswell';
```

**(b) Insert the registration block** AFTER Step 4 (the provider-compatibility guard) and
BEFORE Step 5 (the `configureHarnesses()` call):
```ts
  // Step 4.5: Register the default 'pi' harness instance idempotently.
  // configureHarnesses() only stores the config singleton — it does NOT populate the
  // HarnessRegistry. createAgent() looks up registry.get('pi') and throws if missing,
  // so we register a live PiHarness here. The has() guard is MANDATORY because
  // configureHarness() runs at module-load in agent-factory.ts and registry.register()
  // throws 'already registered' on the second call.
  const registry = HarnessRegistry.getInstance();
  if (!registry.has('pi')) {
    registry.register(new PiHarness());
  }
```

**(c) Leave everything else unchanged** — Steps 1–4 and 5–6, the return value, all JSDoc,
all other imports. In particular **Step 4 must remain** `DEFAULT_MODEL_PROVIDER === 'zai'`
(Issue 2 / P1.M1.T2.S1 owns changing it).

### Success Criteria

- [ ] `src/config/harness.ts` imports `{ configureHarnesses, PiHarness, HarnessRegistry }` from `'groundswell'`.
- [ ] `configureHarness()` calls `HarnessRegistry.getInstance()` and, guarded by `!registry.has('pi')`,
      calls `registry.register(new PiHarness())`.
- [ ] The registration block sits between Step 4 and Step 5.
- [ ] Step 4's condition is still `harness === 'claude-code' && DEFAULT_MODEL_PROVIDER === 'zai'`.
- [ ] `configureHarness()` still returns the resolved `harness: AgentHarness`.
- [ ] `npx tsc --noEmit -p tsconfig.build.json` introduces **no new errors** in `src/config/harness.ts`.
- [ ] No test file is modified.

---

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed to
implement this successfully?_ **Yes** — the change is a literal 2-line import edit + a
literal 3-line insertion at a pinned location, with the exact API signatures verified
against the compiled Groundswell dist. No judgement calls are left to the implementer.

### Documentation & References

```yaml
# MUST READ — root-cause + verified API surface
- docfile: plan/004_439241a82c24/bugfix/001_4bbb8673119e/architecture/system_context.md
  section: "1. CRITICAL: Dual Groundswell Environments" and "2. Issue 1 Root Cause & Fix Surface"
  why: Explains WHY configureHarnesses() alone doesn't fix the bug (config singleton ≠ instance
        registry) and WHY the has() guard is mandatory (register() throws on duplicate).
  critical: >
    Documents the dual-env split: tests resolve groundswell to the sibling checkout (which HAS
    @earendil-works/pi-coding-agent installed), so new PiHarness() works under vitest. The yalc
    runtime tree does NOT have the package, but that is a separate pre-existing concern (Issue 4),
    and this subtask's acceptance is the typecheck + downstream S3 test suite.

- docfile: plan/004_439241a82c24/bugfix/001_4bbb8673119e/architecture/groundswell_harness_registry.md
  section: "1. HarnessRegistry — singleton; empty Map until register() is called"
  why: Line-level source of register()/has()/get()/getInstance() behavior; confirms register() THROWS
        on duplicate id (the exact reason the idempotency guard exists).
  pattern: "registry.register(provider) → throws `Provider '${id}' is already registered` if has(id)"

- docfile: plan/004_439241a82c24/bugfix/001_4bbb8673119e/TEST_RESULTS.md
  section: "Issue 1" (Suggested Fix option 1)
  why: The authoritative bug report + the exact preferred fix snippet this PRP encodes.

# PATTERN FILE — the only file being edited
- file: src/config/harness.ts
  why: Contains configureHarness() with its 6 numbered steps. The change is a pinned insertion
        between Step 4 and Step 5 plus a 2-symbol import addition.
  pattern: |
    import { configureHarnesses } from 'groundswell';   // ← add PiHarness, HarnessRegistry
    ...
    export function configureHarness(): AgentHarness {
      // Step 1..3 (read env, validate, cast) — UNCHANGED
      // Step 4: if (harness === 'claude-code' && DEFAULT_MODEL_PROVIDER === 'zai') throw ... — UNCHANGED
      // ← INSERT Step 4.5 registration block HERE
      // Step 5: configureHarnesses({...}) — UNCHANGED
      // Step 6: return harness; — UNCHANGED
    }
  gotcha: >
    Do NOT touch Step 4. Issue 2 (P1.M1.T2.S1) owns replacing DEFAULT_MODEL_PROVIDER with the
    resolved provider. Touching it here violates the contract and collides with that subtask.

# VERIFIED DEPENDENCY EXPORTS (do not re-discover; confirmed in ~/projects/groundswell/dist/index.js)
- symbol: configureHarnesses   # already imported — keep
- symbol: PiHarness            # dist/index.js:19  — export { PiHarness } from './harnesses/pi-harness.js'
- symbol: HarnessRegistry      # dist/index.js:17  — export { HarnessRegistry, ProviderRegistry } from './harnesses/harness-registry.js'
```

### Current Codebase tree (relevant slice)

```bash
src/config/
├── constants.ts     # UNCHANGED — provides DEFAULT_HARNESS, DEFAULT_MODEL_PROVIDER, PRP_AGENT_HARNESS, SUPPORTED_HARNESSES
├── environment.ts   # UNCHANGED — Issue 2 will read getModel() from here (separate subtask)
├── harness.ts       # EDIT — add PiHarness+HarnessRegistry import; insert idempotent registration block (Step 4.5)
└── types.ts         # UNCHANGED — provides AgentHarness, HarnessProviderMismatchError
```

### Desired Codebase tree with files to be added/edited

```bash
src/config/
└── harness.ts       # MODIFIED (the ONLY file touched in this subtask)
# No new files. No test files modified.
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — registry.register() THROWS on duplicate id (verified dist/harnesses/harness-registry.js):
//   "Provider 'pi' is already registered"
// configureHarness() runs at module-load in agent-factory.ts and is imported by MANY test files,
// so the has() guard is MANDATORY, not optional. Without it the second import crashes the suite.

// CRITICAL — use the MAIN barrel import ('groundswell'), NOT the 'groundswell/harnesses' subpath.
//   - 'groundswell/harnesses' is NOT in the published package.json exports map (only '.' is).
//   - registerDefaultHarnesses() there imports ClaudeCodeHarness → @anthropic-ai/claude-agent-sdk
//     (not installed) → module-load crash.
//   PiHarness + HarnessRegistry ARE exported from the main barrel — use those.

// GOTCHA — PiHarness statically imports @earendil-works/pi-coding-agent at the top of pi-harness.js.
//   This resolves under the vitest alias (sibling checkout has it installed) — which is the
//   environment S1/S3 validate against. The yalc runtime tree lacks it; that is Issue 4, out of scope.

// GOTCHA — do NOT run the full test suite or `npm run validate` in S1.
//   harness-config.test.ts and harness-provider-compat.test.ts vi.mock('groundswell', ...) with only
//   { configureHarnesses: vi.fn() }, so PiHarness/HarnessRegistry will be undefined under the mock →
//   those tests WILL fail after this change. That is EXPECTED; S2 updates the mocks. S1 runs ONLY
//   `npx tsc --noEmit -p tsconfig.build.json` (and confirms no NEW harness.ts errors).

// GOTCHA — leave Step 4 exactly as-is. Changing DEFAULT_MODEL_PROVIDER logic here collides with
//   P1.M1.T2.S1 (Issue 2) and violates the explicit contract clause.
```

---

## Implementation Blueprint

### Data models and structure

None — this is a behavioral insertion, not a data-model change. No new types, constants,
or classes.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT src/config/harness.ts — expand the groundswell import
  - CHANGE: `import { configureHarnesses } from 'groundswell';`
        to: `import { configureHarnesses, PiHarness, HarnessRegistry } from 'groundswell';`
  - VERIFY exports exist: ~/projects/groundswell/dist/index.js lines 17 (HarnessRegistry) & 19 (PiHarness).
  - NAMING: named imports only; preserve import order/grouping (groundswell import stays above the local ./constants.js import).
  - PLACEMENT: top of src/config/harness.ts (existing import line).

Task 2: EDIT src/config/harness.ts — insert idempotent registration block (Step 4.5)
  - INSERT between Step 4 (provider-compat guard `if (harness === 'claude-code' && ...)`) and
        Step 5 (the `configureHarnesses({...})` call):
        const registry = HarnessRegistry.getInstance();
        if (!registry.has('pi')) {
          registry.register(new PiHarness());
        }
  - GUARD: the `if (!registry.has('pi'))` check is MANDATORY — registry.register() throws on duplicate.
  - CONSTRUCTOR: `new PiHarness()` is no-arg (verified — id === 'pi').
  - COMMENTS: add a brief JSDoc-style or inline comment explaining WHY (config singleton ≠ instance
        registry; has()-guard prevents the duplicate-register throw). Keeps the file self-documenting.
  - DO NOT TOUCH: Step 4 condition, Step 5 body, Step 6 return, JSDoc on configureHarness (except
        optionally a one-line @remarks note that it also registers the default 'pi' harness).
  - PLACEMENT: src/config/harness.ts, inside configureHarness(), between Step 4 and Step 5.

Task 3: VALIDATE (source-only — DO NOT run the test suite)
  - RUN: `npx tsc --noEmit -p tsconfig.build.json`
  - EXPECTED: ZERO new errors mentioning src/config/harness.ts. (Pre-existing 18 errors in
        src/tools/{bash,filesystem,git}-mcp.ts are Issue 4, out of scope — their count must not change.)
  - DO NOT RUN: `npm run test:run`, `npm run validate`. Mock-based config tests fail until S2.
```

### Implementation Patterns & Key Details

```ts
// PATTERN — the exact diff (hunk-level). Old lines are context, not edits except the import.

// TOP OF FILE — change the single import line:
import { configureHarnesses, PiHarness, HarnessRegistry } from 'groundswell';
import {
  DEFAULT_HARNESS,
  DEFAULT_MODEL_PROVIDER,
  PRP_AGENT_HARNESS,
  SUPPORTED_HARNESSES,
} from './constants.js';
// ... (rest of imports unchanged)

export function configureHarness(): AgentHarness {
  // Step 1..3 unchanged ...

  // Step 4: Enforce harness↔provider compatibility    ← UNCHANGED (Issue 2 owns this)
  if (harness === 'claude-code' && DEFAULT_MODEL_PROVIDER === 'zai') {
    throw new HarnessProviderMismatchError(harness, DEFAULT_MODEL_PROVIDER);
  }

  // Step 4.5: Register the default 'pi' harness instance idempotently.
  //
  // configureHarnesses() (Step 5) only stores a *config* singleton — it does NOT populate the
  // HarnessRegistry. Groundswell's `new Agent(...)` does registry.get('pi') and throws
  // "Harness 'pi' is not registered" when nothing is registered, so we register a live PiHarness
  // here. The has() guard is MANDATORY: configureHarness() runs at module-load in
  // agent-factory.ts and registry.register() throws "Provider 'pi' is already registered" on
  // a second call.
  const registry = HarnessRegistry.getInstance();
  if (!registry.has('pi')) {
    registry.register(new PiHarness());
  }

  // Step 5: Delegate to Groundswell global harness configuration    ← UNCHANGED
  configureHarnesses({
    defaultHarness: harness,
    defaultModelProvider: DEFAULT_MODEL_PROVIDER,
    harnessDefaults: {
      'claude-code': { apiKey: process.env.ANTHROPIC_API_KEY },
    },
  });

  // Step 6: Return resolved harness for downstream consumers    ← UNCHANGED
  return harness;
}
```

### Integration Points

```yaml
GROUNDWELL (read-only dependency — do NOT edit ~/projects/groundswell):
  - consumes: HarnessRegistry.getInstance(), registry.has(id), registry.register(provider), new PiHarness()
  - exports verified: dist/index.js lines 17, 19, 21 (HarnessRegistry, PiHarness, configureHarnesses)
  - gotcha: PiHarness statically imports @earendil-works/pi-coding-agent; resolves under vitest alias only.

CALLER (downstream — DO NOT EDIT in this subtask):
  - file: src/agents/agent-factory.ts
  - behavior: calls configureHarness() at module-load (top-level side effect). After this fix,
    that call now also registers PiHarness in the singleton registry, so subsequent
    createAgent({ harness: 'pi', ... }) succeeds.
  - no change required here.

TESTS (downstream — DO NOT EDIT in S1; S2 owns):
  - files: tests/unit/config/harness-config.test.ts, tests/unit/config/harness-provider-compat.test.ts
  - issue: both `vi.mock('groundswell', () => ({ configureHarnesses: vi.fn() }))`; after S1 the
    mocked configureHarness() will try to read HarnessRegistry.getInstance → undefined → throw.
  - expected: these tests FAIL after S1 and are fixed in S2 by stubbing HarnessRegistry + PiHarness.
  - file: tests/unit/agents/agent-factory.test.ts — does NOT mock groundswell; will go GREEN once
    registration lands (verified in S3).
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Targeted typecheck — the ONLY gate S1 must satisfy.
npx tsc --noEmit -p tsconfig.build.json
# Expected: NO new errors in src/config/harness.ts. The pre-existing 18 errors in
# src/tools/{bash,filesystem,git}-mcp.ts (Issue 4) may still appear — their count must be unchanged.

# Optional targeted lint/format on the single edited file:
npx eslint src/config/harness.ts
npx prettier --check src/config/harness.ts
# If prettier complains, run `npx prettier --write src/config/harness.ts` (or `npm run fix`).
# Do NOT run project-wide `npm run fix` / `npm run validate` — they sweep the broken tool files
# (Issue 4) and the mock-based config tests (deferred to S2).
```

### Level 2: Unit Tests (Component Validation)

```bash
# NOT RUN IN S1. The mock-based config tests (harness-config.test.ts, harness-provider-compat.test.ts)
# will FAIL after this source change because their vi.mock('groundswell') stub does not yet provide
# PiHarness/HarnessRegistry. That is EXPECTED — S2 updates the mocks, S3 re-runs the full suite.
#
# For reference (S2/S3 will run these), the target command is:
#   npx vitest run tests/unit/config/harness-config.test.ts tests/unit/config/harness-provider-compat.test.ts
#   npx vitest run tests/unit/agents/agent-factory.test.ts   # ← must go GREEN (5 previously-failing tests)
```

### Level 3: Integration Testing (System Validation)

```bash
# NOT RUN IN S1 (deferred to S3). For reference, S3's end-to-end check is:
#   npm run test:run -- agents/agent-factory
#   npx tsx -e "import('./src/agents/agent-factory.js').then(m => m.createArchitectAgent())"
# Both must succeed (no "Harness 'pi' is not registered" throw) once S2 mocks are in place.
# S1 does NOT perform these checks — the mocks are still broken.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# N/A — this is a 5-line behavioral insertion with no creative surface. The only domain-specific
# check is reasoning (record in commit message):
#   - The registration is idempotent (has() guard) → safe across multiple module loads.
#   - The insertion point (between Step 4 and Step 5) satisfies the ordering constraint
#     (registry populated before any createAgent() call) without changing validation/config logic.
#   - No new dependency on the unpublished 'groundswell/harnesses' subpath or @anthropic-ai/claude-agent-sdk.
```

---

## Final Validation Checklist

### Technical Validation

- [ ] `npx tsc --noEmit -p tsconfig.build.json` reports **no new errors** in `src/config/harness.ts`.
- [ ] Pre-existing Issue-4 error count in `src/tools/*-mcp.ts` is unchanged (this subtask touches none of them).
- [ ] `npx prettier --check src/config/harness.ts` passes (or was auto-fixed).
- [ ] `npx eslint src/config/harness.ts` passes.

### Feature Validation

- [ ] `src/config/harness.ts` imports `{ configureHarnesses, PiHarness, HarnessRegistry }` from `'groundswell'`.
- [ ] `configureHarness()` contains `HarnessRegistry.getInstance()` + `if (!registry.has('pi')) registry.register(new PiHarness())`.
- [ ] The registration block sits between Step 4 and Step 5.
- [ ] Step 4 is still `harness === 'claude-code' && DEFAULT_MODEL_PROVIDER === 'zai'` (untouched).
- [ ] Step 5 (`configureHarnesses({...})`) body unchanged.
- [ ] `configureHarness()` still returns `harness: AgentHarness`.
- [ ] Idempotency: the `has('pi')` guard is present (so a second call does not throw).

### Code Quality Validation

- [ ] Only `src/config/harness.ts` is modified — no other source file, no test file.
- [ ] Inline comment explains WHY the registration exists and WHY the guard is mandatory.
- [ ] Import line preserves existing grouping/order (groundswell import above local `./constants.js`).
- [ ] No use of the unpublished `'groundswell/harnesses'` subpath or `registerDefaultHarnesses`.
- [ ] No change to Step 4 logic (Issue 2 / P1.M1.T2.S1 owns it).

### Documentation & Deployment

- [ ] Brief inline comment documents the config-singleton ≠ instance-registry distinction (future readers).
- [ ] Optionally extend `configureHarness()` JSDoc `@remarks` with one line: "Also registers the
      default 'pi' harness instance in Groundswell's HarnessRegistry (idempotent)."
- [ ] Commit message references Issue 1 and notes that mock-based config tests are intentionally
      deferred to S2 (so a reviewer does not mistake their failure for a regression).

---

## Anti-Patterns to Avoid

- ❌ Don't drop the `if (!registry.has('pi'))` guard — `register()` throws on duplicate and `configureHarness()` runs at module-load across many test files.
- ❌ Don't import from `'groundswell/harnesses'` or call `registerDefaultHarnesses()` — unpublished subpath + pulls in the uninstalled `@anthropic-ai/claude-agent-sdk`.
- ❌ Don't edit Step 4 / `DEFAULT_MODEL_PROVIDER` — that's Issue 2 (P1.M1.T2.S1).
- ❌ Don't edit the mock-based test files (`harness-config.test.ts`, `harness-provider-compat.test.ts`) — that's S2.
- ❌ Don't run `npm run test:run` / `npm run validate` in S1 — the mock tests fail until S2; only run `npx tsc --noEmit -p tsconfig.build.json`.
- ❌ Don't edit `~/projects/groundswell/` — read-only yalc/sibling dependency.
- ❌ Don't reorder Steps 1–6 or rewrite JSDoc "to clean up" — minimal pinned insertion only.
- ❌ Don't register `claude-code` here — it requires the uninstalled Anthropic SDK and is always rejected for the z.ai provider anyway.

---

## Confidence Score

**10/10** — One-pass implementation success likelihood.

Rationale: The change is a literal, contract-pinned 2-symbol import addition + a 3-line
insertion at an explicitly named location (between Step 4 and Step 5). All three consumed
symbols (`configureHarnesses`, `PiHarness`, `HarnessRegistry`) are verified exported from
the main `groundswell` barrel (dist/index.js lines 17/19/21). The `register()` throws-on-duplicate
behavior is verified, justifying the mandatory `has()` guard. The single validation gate
(`npx tsc --noEmit -p tsconfig.build.json`) is explicitly scoped to "no NEW errors in harness.ts",
sidestepping the known pre-existing Issue-4 errors and the intentionally-deferred S2 mock failures.
There are no unknowns left: every API signature, import path, and ordering constraint is
documented with line-level evidence in the research notes.
