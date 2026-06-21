# PRP — P1.M2.T1.S2: Harness/provider compatibility rejection test

---

## Goal

**Feature Goal**: Prove, with a green deterministic unit-test suite, that the
harness↔provider compatibility guard (PRD §9.4.3 / §9.2.4) implemented in
P1.M1.T1.S2 (`configureHarness()` throwing `HarnessProviderMismatchError` for
`claude-code` + `zai`) does exactly three things: **(a)** allows the default
`pi` + `zai` path at init; **(b)** rejects `claude-code` + `zai` with an
**actionable** error that cites PRD §9.2.4 **and explicitly points the user to
switch the harness or the model provider**; **(c)** keeps `claude-code` a
**structurally valid** harness id (rejected only for the z.ai provider mismatch,
not as an unknown id). No network/LLM calls.

**Deliverable**:

1. **`tests/unit/config/harness-provider-compat.test.ts`** — **CREATE**: the
   compatibility-rejection suite asserting (a), (b), (c) plus the
   structural-validity-vs-unknown-id contrast. Mocks `configureHarnesses`
   (Groundswell's only public harness export) and asserts on call args — the
   contract's `getGlobalHarnessConfig()`/`resetGlobalHarnessConfig()` recipe is
   **unusable** (see Known Gotchas).
2. **`src/config/types.ts`** — **EDIT** (surgical): tighten the
   `HarnessProviderMismatchError` message so it explicitly names BOTH
   remediation paths (switch harness → `pi`, OR switch provider →
   `anthropic/*`), satisfying the work-item requirement that the message
   "points the user to switch harness or model provider". Preserves all tokens
   asserted by existing tests (`claude-code`, `zai`, `§9.2.4`).

**Success Definition** (the contract from the work item):

- (a) `PRP_AGENT_HARNESS=pi` + `zai` → `configureHarness()` succeeds (no throw)
  and the resolved/default harness is `'pi'` (verified via the
  `configureHarnesses` call args: `defaultHarness === 'pi'`).
- (b) `PRP_AGENT_HARNESS=claude-code` + `zai` → `configureHarness()` throws
  `HarnessProviderMismatchError`; the message references PRD §9.2.4 AND
  points the user to switch the harness (to `pi`) or the model provider
  (to `anthropic/*`); `configureHarnesses` is NOT called.
- (c) `claude-code` is asserted to be a member of `SUPPORTED_HARNESSES` — i.e. a
  structurally valid harness id — and is distinguished from the "unknown id"
  rejection path (which throws a plain `Error` listing supported harnesses).
- `npm run validate` passes; `npm run test:run` passes with **100% coverage**
  retained on all `src/**/*.ts` (no new src file is created, so no new coverage
  obligation is introduced).

---

## Why

- **PRD §9.4.3 / §9.2.4 are the contract.** `claude-code` runs Anthropic-only
  models; requesting the `zai` provider on `claude-code` is a configuration
  error that MUST be surfaced at init. Groundswell's `configureHarnesses()`
  validates harness IDs but NOT `defaultModelProvider` (open set — verified in
  `architecture/external_deps.md` and P1.M1.T1.S2 research), so the PRP pipeline
  OWNS the guard. This subtask turns that ownership into executable proof.
- **Closes the one gap P1.M1.T1.S2 left open.** M1.T1.S2 tested the _behavior_
  (throw / no-throw / call-args) but did NOT assert (i) that `claude-code` is a
  _structurally valid_ id rejected solely for the provider mismatch, nor (ii)
  that the error message gives _actionable_ remediation guidance. Both are
  explicit requirements of this work item's contract (cases b + c). See
  `research/groundswell-exports-and-scope.md §2` for the precise delta.
- **Cost safeguard (PRD §9.2.4).** Hard-rejecting `claude-code` + `zai` at init
  prevents a misconfiguration that would otherwise route to Anthropic's
  production API. The actionable message ensures a misconfigured user can
  self-correct without reading source.
- **Pairs with, and is disjoint from, the parallel P1.M2.T1.S1.** S1 clarifies
  the provider-ENDPOINT guard (URL-level, orthogonal to the harness). This item
  covers the harness×provider ID-pair compatibility. Disjoint files, disjoint
  source edits (see Known Gotchas).
- **Out of scope (hard boundary):** the provider-endpoint guard
  (`endpoint-guard.ts` — P1.M2.T1.S1), model qualification (`qualifyModel`/
  `getModel` — M1.T2.S1), the agent-config `harness` field wiring (M1.T2.S2),
  feature-parity tests (M2.T2), docs (M2.T3), and making the provider
  env-configurable (later milestones). The compat check compares only against
  the `DEFAULT_MODEL_PROVIDER` constant.

---

## What

### User-visible behavior

None at runtime/CLI. This is a test + message-wording subtask. Observable
changes: (1) one new green test file; (2) the `HarnessProviderMismatchError`
message text becomes actionable (names both remediation paths). No new env
vars, no new public API, no behavior change on the happy path.

### Technical requirements (exact contract)

**`tests/unit/config/harness-provider-compat.test.ts`** (CREATE) — covers:

1. **Mocking**: `vi.mock('groundswell', () => ({ configureHarnesses: vi.fn() }))`
   (hoisted, file-scoped). `beforeEach`: `vi.clearAllMocks()` +
   `delete process.env.PRP_AGENT_HARNESS` + `vi.stubEnv('ANTHROPIC_API_KEY', ...)`.
   `afterEach`: `vi.unstubAllEnvs()`. (The contract's `resetGlobalHarnessConfig()`
   is NOT exported by Groundswell — see Known Gotchas.)
2. **(a) pi + zai succeeds + default harness is pi** — `vi.stubEnv('PRP_AGENT_HARNESS','pi')`;
   `expect(configureHarness()).toBe('pi')`; `expect(configureHarnesses).toHaveBeenCalledWith(`
   `expect.objectContaining({ defaultHarness:'pi', defaultModelProvider:'zai' }))`.
   Also cover the env-unset default: `delete process.env.PRP_AGENT_HARNESS` → same.
3. **(b) claude-code + zai throws actionable error** — `vi.stubEnv('PRP_AGENT_HARNESS','claude-code')`;
   capture the thrown error; assert `instanceof HarnessProviderMismatchError`,
   `.name === 'HarnessProviderMismatchError'`, `.harness === 'claude-code'`,
   `.provider === 'zai'`, message contains `'§9.2.4'`, AND message points to
   switching harness OR provider (assert it references the `pi` harness
   alternative AND the `anthropic` provider alternative, e.g. contains both
   `'pi'` and `'anthropic'`). Assert `configureHarnesses` was NOT called.
4. **(c) claude-code is structurally valid** — assert
   `SUPPORTED_HARNESSES.includes('claude-code') === true` (cast
   `SUPPORTED_HARNESSES as readonly string[]`). Then the **contrast**: an
   unknown id (`'bogus'`) is NOT in `SUPPORTED_HARNESSES` and throws a PLAIN
   `Error` (NOT `HarnessProviderMismatchError`) whose message lists the
   supported harnesses. This proves `claude-code` is rejected for the provider
   mismatch, not for being unknown.

**`src/config/types.ts`** (EDIT — message string only) — change the
`HarnessProviderMismatchError` constructor's `super(...)` message from:

```
`Harness '${harness}' is incompatible with provider '${provider}' (PRD §9.2.4). Select a compatible harness/provider pair.`
```

to (one logical line, keep the two-concat layout the file already uses):

```
`Harness '${harness}' is incompatible with provider '${provider}' (PRD §9.2.4). ` +
  `Switch the harness to 'pi' (PRP_AGENT_HARNESS=pi) or switch the model provider to anthropic/* models.`
```

This aligns with `architecture/implementation_notes.md §1`, which prescribed
"Switch to PRP_AGENT_HARNESS=pi or use anthropic/\* models." Preserve the
interpolations (`'${harness}'`, `'${provider}'`) so the existing
`message.contains('claude-code')` / `('zai')` assertions in
`harness.test.ts` keep passing, and keep `'§9.2.4'` verbatim for
`harness-config.test.ts`. Touch NOTHING else in `types.ts`.

### Success Criteria

- [ ] `tests/unit/config/harness-provider-compat.test.ts` exists and is green.
- [ ] Case (a): `pi` (and env-unset) + `zai` → no throw; `configureHarnesses`
      called with `defaultHarness:'pi'`, `defaultModelProvider:'zai'`.
- [ ] Case (b): `claude-code` + `zai` → throws `HarnessProviderMismatchError`;
      message contains `§9.2.4`, `pi`, and `anthropic`; `configureHarnesses`
      NOT called.
- [ ] Case (c): `SUPPORTED_HARNESSES.includes('claude-code') === true`; an
      unknown id throws a plain `Error` (contrast), not the mismatch error.
- [ ] `HarnessProviderMismatchError` message in `types.ts` names both
      remediation paths and still contains `claude-code`, `zai`, `§9.2.4`.
- [ ] `npm run validate` exits 0; `npm run test:run` exits 0; global coverage
      remains 100% (no new uncovered `src/**/*.ts` file).

---

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed
to implement this successfully?_ **Yes** — every file path is concrete, the test
cases are enumerated with exact assertions, the message edit is specified
token-for-token, and the ONE non-obvious trap (Groundswell not exporting the
reset/query helpers the contract names) is documented with a verified working
alternative and proof pointers.

### Documentation & References

```yaml
# MUST READ — the work-item contract + PRD
- docfile: PRD.md
  section: "9.4.3 Critical Rules" (h4.11) and "9.2.4 API Endpoint Safeguards" (h4.3)
  why: >
    §9.4.3 — "Provider/harness compatibility. claude-code runs anthropic/* models
    only. Requesting the z.ai provider on claude-code is a configuration error
    surfaced at initialize()/execute()." §9.2.4 harness note — the safeguard
    constrains the provider, not the harness; pi+zai is the default. This item
    encodes both as executable tests.
  critical: The error message MUST point the user to switch harness OR model provider.

# MUST READ — this subtask's research (THE load-bearing trap + scope delta)
- docfile: plan/004_439241a82c24/P1M2T1S2/research/groundswell-exports-and-scope.md
  section: "1. getGlobalHarnessConfig / resetGlobalHarnessConfig are UNREACHABLE" and "2. Scope"
  why: >
    Proves (with package.json exports + dist/index.js grep + the M1.T1.S2 runtime
    probe) that the contract's getGlobalHarnessConfig()/resetGlobalHarnessConfig()
    are NOT importable from 'groundswell'. Gives the working vi.mock alternative and
    maps each contract phrase onto it. Also enumerates exactly what is NEW vs already
    covered by M1.T1.S2, and the message-edit safety analysis.

# MUST READ — the implementation whose behavior we are testing (the SUT)
- file: src/config/harness.ts
  why: configureHarness() — the entrypoint under test. Read it to confirm the
        6-step flow (env read → SUPPORTED_HARNESSES.includes() validate → cast →
        claude-code+zai compat check → configureHarnesses() → return harness).
  pattern: "if (!(SUPPORTED_HARNESSES as readonly string[]).includes(raw)) throw new Error(...)"
  critical: The unknown-id throw is a PLAIN Error; the mismatch throw is
            HarnessProviderMismatchError. Case (c) relies on this distinction.

- file: src/config/types.ts
  why: EDIT target — the HarnessProviderMismatchError constructor message (lines ~153-155).
        Tighten the second concat string only.
  pattern: "super(`Harness '${harness}' ... (PRD §9.2.4). ` + `Select a compatible ...`)"
  gotcha: Preserve the '${harness}'/'${provider}' interpolations and '§9.2.4' — existing
          tests assert on those substrings (see Message-edit safety analysis in research).

- file: src/config/constants.ts
  why: CONSUME — SUPPORTED_HARNESSES (['pi','claude-code'] as const), DEFAULT_MODEL_PROVIDER
        ('zai'), DEFAULT_HARNESS ('pi'). Case (c) asserts SUPPORTED_HARNESSES.includes('claude-code').

# PATTERN FILES — copy these conventions exactly
- file: tests/unit/config/harness-config.test.ts
  why: The closest structural template — SAME vi.mock('groundswell') pattern, SAME
        beforeEach(clearAllMocks + delete env + stubEnv), SAME capture-the-thrown-error
        style. M2.T1.S2's new file is a sibling that adds the structural-validity +
        actionable-message dimensions.
  pattern: "vi.mock('groundswell', () => ({ configureHarnesses: vi.fn() })); ... expect(configureHarnesses).toHaveBeenCalledWith(expect.objectContaining({defaultHarness:'pi',...}))"
  gotcha: That file already tests throw/no-throw/call-args — DO NOT duplicate; focus on
          the NEW assertions (structural validity + actionable message). Keep file disjoint.

- file: tests/unit/config/harness.test.ts
  why: Shows the message-substring assertions you MUST NOT break: error.message
        contains 'claude-code' AND 'zai'. Confirms the message edit is safe if those
        tokens are preserved.
  pattern: "expect(error.message).toContain('claude-code'); expect(error.message).toContain('zai');"

- docfile: plan/004_439241a82c24/architecture/implementation_notes.md
  section: "1. WHERE the compatibility check must live" and "7. Validation gates"
  why: §1 prescribes the exact intended message wording ("Switch to PRP_AGENT_HARNESS=pi
        or use anthropic/* models.") the message edit aligns to. §7 confirms DoD =
        npm run validate + npm run test:run green.

- docfile: plan/004_439241a82c24/P1M1T1S2/PRP.md
  why: The SUT's own PRP — documents the configureHarness() contract, the 4 startup
        cases, and the Groundswell-exports discovery. Treat as background; do not
        re-implement configureHarness() (it is already merged and green).
```

### Current Codebase tree (relevant slice)

```bash
src/config/
├── constants.ts     # CONSUME — SUPPORTED_HARNESSES, DEFAULT_MODEL_PROVIDER, DEFAULT_HARNESS
├── environment.ts   # UNCHANGED (M1.T1/M1.T2 own; configureEnvironment() runs at agent-factory load)
├── harness.ts       # SUT (read-only) — configureHarness() implemented & green in M1.T1.S2
└── types.ts         # EDIT — HarnessProviderMismatchError message string only
tests/unit/config/
├── environment.test.ts        # UNCHANGED
├── harness.test.ts            # M1.T1.S1 (constants/types/error shape) — must stay green
├── harness-config.test.ts     # M1.T1.S2 (configureHarness behavior) — must stay green
└── harness-provider-compat.test.ts  # ← THIS SUBTASK CREATES
```

### Desired Codebase tree with files to be added/edited

```bash
src/config/types.ts                                      # EDIT — tighten mismatch error message (actionable guidance)
tests/unit/config/harness-provider-compat.test.ts        # NEW — compatibility rejection suite (cases a/b/c + contrast)
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — Groundswell does NOT export getGlobalHarnessConfig / resetGlobalHarnessConfig.
//   The work-item CONTRACT names both ("getGlobalHarnessConfig().defaultHarness === 'pi'",
//   "reset ... with resetGlobalHarnessConfig() in afterEach"). THEY ARE UNREACHABLE:
//   groundswell/package.json `exports` exposes only "."; dist/index.js re-exports ONLY
//   configureHarnesses from ./utils/harness-config.js. Deep imports are blocked by the
//   exports map. (Source helpers exist @internal in src/utils/harness-config.ts lines
//   158/222 but are not re-exported from the package root.)
//   USE: vi.mock('groundswell', () => ({ configureHarnesses: vi.fn() })) and assert on
//   call args. Reset = vi.clearAllMocks() (beforeEach) + vi.unstubAllEnvs() (afterEach).
//   See research/groundswell-exports-and-scope.md §1 for proof + the M1.T1.S2 runtime probe.

// CRITICAL — "defaultHarness === 'pi'" is verified via the configureHarnesses CALL ARGS,
//   not via a singleton query. configureHarness() delegates to configureHarnesses({
//     defaultHarness: <resolved>, defaultModelProvider: 'zai', harnessDefaults: {...} }).
//   Assert: expect(configureHarnesses).toHaveBeenCalledWith(
//             expect.objectContaining({ defaultHarness: 'pi', defaultModelProvider: 'zai' })).

// CRITICAL — two DISTINCT throw sites in configureHarness(); case (c) depends on the distinction:
//   * unknown harness value (e.g. 'bogus') → PLAIN Error, message lists supported harnesses
//   * claude-code + zai mismatch           → HarnessProviderMismatchError
//   Assert claude-code is in SUPPORTED_HARNESSES (structural validity) AND that an unknown
//   id is NOT, to prove claude-code is rejected for the MISMATCH, not for being unknown.

// CRITICAL — MESSAGE-EDIT SAFETY. The tightened message MUST still contain the substrings
//   asserted by existing tests: 'claude-code' (via '${harness}' interpolation), 'zai' (via
//   '${provider}'), and '§9.2.4'. Keep the interpolations and the §9.2.4 token verbatim.
//   No file asserts the exact full string (grep-confirmed) — only these substrings.

// GOTCHA — vi.mock is hoisted + FILE-SCOPED. Mocking 'groundswell' here does NOT leak into
//   agent-factory.test.ts (which imports the real configureHarnesses). Safe.

// GOTCHA — tests/setup.ts registers a global beforeEach that runs the provider-endpoint guard.
//   It runs BEFORE local hooks and calls vi.unstubAllEnvs() in afterEach. Stub
//   PRP_AGENT_HARNESS in the test body / local beforeEach (after the global hook). This is
//   identical to how harness-config.test.ts already works — copy that file's hook layout.

// GOTCHA — 100% coverage is enforced (vitest.config.ts, include src/**/*.ts). This subtask
//   adds NO new src file (only edits a string literal in types.ts and adds a test), so it
//   introduces NO new coverage obligation. types.ts is already fully covered by harness.test.ts.

// GOTCHA — prettier is an ERROR (eslint prettier/prettier: error). Run `npm run fix`
//   (lint:fix + format) before `npm run validate`. Keep the existing two-string-concat
//   layout in the message (do not collapse to one line if prettier would re-split it).

// CRITICAL — DISJOINT FROM P1.M2.T1.S1. That parallel item creates src/config/endpoint-guard.ts
//   + tests/unit/config/endpoint-guard.test.ts (provider-ENDPOINT guard). This item touches
//   types.ts (message) + a differently-named test file (harness-provider-compat.test.ts).
//   No file overlap; no merge conflict.
```

---

## Implementation Blueprint

### Data models and structure

No new data models. This subtask consumes S1's `HarnessProviderMismatchError`,
`AgentHarness`, `SUPPORTED_HARNESSES`, `DEFAULT_MODEL_PROVIDER`, `DEFAULT_HARNESS`
and S2's `configureHarness()`. The only "model" change is the error **message
string** (a surgical edit), whose target wording is fixed in the contract above.

### Implementation Tasks (ordered by dependencies — implicit TDD: RED first, then GREEN)

```yaml
Task 1: EDIT src/config/types.ts   (GREEN — tighten the message; do this FIRST so the test can assert the new wording)
  - LOCATE: HarnessProviderMismatchError constructor, the super(...) call (~lines 153-155).
  - REPLACE the second concat string `Select a compatible harness/provider pair.` with:
      `Switch the harness to 'pi' (PRP_AGENT_HARNESS=pi) or switch the model provider to anthropic/* models.`
  - PRESERVE: the first concat (`Harness '${harness}' is incompatible with provider '${provider}' (PRD §9.2.4). `),
    the '${harness}'/'${provider}' interpolations, the '§9.2.4' token, this.name/.harness/.provider
    assignments, the constructor signature, and the JSDoc. Touch NOTHING else in the file.
  - (Optional) update the @example comment line (~137) to reflect the new wording for doc consistency.
  - EXPECTED: harness.test.ts + harness-config.test.ts stay GREEN (they assert substrings only).

Task 2: CREATE tests/unit/config/harness-provider-compat.test.ts   (RED→GREEN — the suite)
  - IMPORT: { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
            configureHarness from '../../../src/config/harness.js';
            { HarnessProviderMismatchError } from '../../../src/config/types.js';
            { SUPPORTED_HARNESSES, DEFAULT_MODEL_PROVIDER } from '../../../src/config/constants.js'.
  - MOCK (hoisted, top of file): vi.mock('groundswell', () => ({ configureHarnesses: vi.fn() }));
    then `import { configureHarnesses } from 'groundswell';`.
  - HOOKS: beforeEach(() => { vi.clearAllMocks(); delete process.env.PRP_AGENT_HARNESS;
              vi.stubEnv('ANTHROPIC_API_KEY', 'stubbed-key'); });
            afterEach(() => vi.unstubAllEnvs());   (match harness-config.test.ts layout)
  - FOLLOW pattern: tests/unit/config/harness-config.test.ts (SETUP/EXECUTE/VERIFY comments,
    capture-thrown-error style, ESM .js specifiers).
  - CASES:
      describe('harness/provider compatibility'):
        it('(a) pi + zai succeeds and resolves default harness pi'):
          - vi.stubEnv('PRP_AGENT_HARNESS','pi'); expect(configureHarness()).toBe('pi');
            expect(configureHarnesses).toHaveBeenCalledWith(expect.objectContaining(
              { defaultHarness:'pi', defaultModelProvider: DEFAULT_MODEL_PROVIDER }));
        it('(a-cont) env unset defaults to pi + zai (the allowed config)'):
          - delete process.env.PRP_AGENT_HARNESS; expect(configureHarness()).toBe('pi');
            expect(configureHarnesses).toHaveBeenCalledWith(expect.objectContaining(
              { defaultHarness:'pi', defaultModelProvider:'zai' }));
        it('(b) claude-code + zai throws HarnessProviderMismatchError with actionable guidance'):
          - vi.stubEnv('PRP_AGENT_HARNESS','claude-code');
            let err: HarnessProviderMismatchError;
            try { configureHarness(); throw new Error('should not reach'); }
            catch (e) { err = e as HarnessProviderMismatchError; }
            expect(err!).toBeInstanceOf(HarnessProviderMismatchError);
            expect(err!.name).toBe('HarnessProviderMismatchError');
            expect(err!.harness).toBe('claude-code');
            expect(err!.provider).toBe('zai');
            expect(err!.message).toContain('§9.2.4');
            expect(err!.message).toContain('pi');           // switch-harness remediation
            expect(err!.message).toContain('anthropic');    // switch-provider remediation
            expect(configureHarnesses).not.toHaveBeenCalled();
        it('(c) claude-code is a structurally valid harness id'):
          - expect((SUPPORTED_HARNESSES as readonly string[]).includes('claude-code')).toBe(true);
        it('(c-cont) an UNKNOWN id is rejected as unknown, NOT as a provider mismatch'):
          - expect((SUPPORTED_HARNESSES as readonly string[]).includes('bogus')).toBe(false);
            vi.stubEnv('PRP_AGENT_HARNESS','bogus');
            let err2: unknown; try { configureHarness(); } catch (e) { err2 = e; }
            expect(err2).toBeInstanceOf(Error);
            expect(err2).not.toBeInstanceOf(HarnessProviderMismatchError);
            expect((err2 as Error).message).toMatch(/pi.*claude-code|claude-code.*pi/);
            expect(configureHarnesses).not.toHaveBeenCalled();
  - NAMING: describe('harness/provider compatibility'); it('should ...') per case.
  - PLACEMENT: tests/unit/config/harness-provider-compat.test.ts (distinct from harness-config.test.ts).
  - EXPECTED: GREEN after Task 1 (message edit) lands; the actionable-message assertions require it.

Task 3: FORMAT + VERIFY
  - RUN: npm run fix; then npm run validate; then
    npx vitest run tests/unit/config/harness-provider-compat.test.ts;
    then npx vitest run tests/unit/config/ (S1 + S2 + this file all green);
    then npm run test:run (full regression, 100% coverage retained).
  - EXPECTED: all green. If harness.test.ts or harness-config.test.ts regress, the message edit
    dropped a required token (§9.2.4 / claude-code / zai) — restore it.
```

### Implementation Patterns & Key Details

```ts
// ---- src/config/types.ts (EDIT — message only) ----
// BEFORE (current, ~lines 153-155):
//   super(
//     `Harness '${harness}' is incompatible with provider '${provider}' (PRD §9.2.4). ` +
//       `Select a compatible harness/provider pair.`
//   );
// AFTER:
super(
  `Harness '${harness}' is incompatible with provider '${provider}' (PRD §9.2.4). ` +
    `Switch the harness to 'pi' (PRP_AGENT_HARNESS=pi) or switch the model provider to anthropic/* models.`
);

// ---- tests/unit/config/harness-provider-compat.test.ts (NEW — key slices) ----
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

// CRITICAL: Groundswell does NOT export getGlobalHarnessConfig/resetGlobalHarnessConfig.
// Mock configureHarnesses and assert on call args (verified working by M1.T1.S2).
vi.mock('groundswell', () => ({ configureHarnesses: vi.fn() }));

import { configureHarnesses } from 'groundswell';
import { configureHarness } from '../../../src/config/harness.js';
import { HarnessProviderMismatchError } from '../../../src/config/types.js';
import {
  DEFAULT_MODEL_PROVIDER,
  SUPPORTED_HARNESSES,
} from '../../../src/config/constants.js';

describe('harness/provider compatibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.PRP_AGENT_HARNESS;
    vi.stubEnv('ANTHROPIC_API_KEY', 'stubbed-key');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('(a) pi + zai succeeds and resolves the default harness to pi', () => {
    vi.stubEnv('PRP_AGENT_HARNESS', 'pi');
    expect(configureHarness()).toBe('pi');
    // "defaultHarness === 'pi'" verified via the configureHarnesses call args
    // (getGlobalHarnessConfig is unexported — see research).
    expect(configureHarnesses).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultHarness: 'pi',
        defaultModelProvider: DEFAULT_MODEL_PROVIDER,
      })
    );
  });

  it('(b) claude-code + zai throws with actionable switch guidance', () => {
    vi.stubEnv('PRP_AGENT_HARNESS', 'claude-code');
    let err: HarnessProviderMismatchError;
    try {
      configureHarness();
      throw new Error('should not reach');
    } catch (e) {
      err = e as HarnessProviderMismatchError;
    }
    expect(err!).toBeInstanceOf(HarnessProviderMismatchError);
    expect(err!.name).toBe('HarnessProviderMismatchError');
    expect(err!.harness).toBe('claude-code');
    expect(err!.provider).toBe('zai');
    expect(err!.message).toContain('§9.2.4');
    expect(err!.message).toContain('pi'); // points to switching the harness
    expect(err!.message).toContain('anthropic'); // points to switching the provider
    expect(configureHarnesses).not.toHaveBeenCalled();
  });

  it('(c) claude-code is a structurally valid harness id', () => {
    expect(
      (SUPPORTED_HARNESSES as readonly string[]).includes('claude-code')
    ).toBe(true);
  });

  it('(c-cont) an unknown id is rejected as unknown, NOT as a provider mismatch', () => {
    expect((SUPPORTED_HARNESSES as readonly string[]).includes('bogus')).toBe(
      false
    );
    vi.stubEnv('PRP_AGENT_HARNESS', 'bogus');
    let err: unknown;
    try {
      configureHarness();
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(HarnessProviderMismatchError);
    expect((err as Error).message).toMatch(/pi.*claude-code|claude-code.*pi/);
    expect(configureHarnesses).not.toHaveBeenCalled();
  });
});
```

### Integration Points

```yaml
SOURCE EDIT (src/config/types.ts):
  - scope: HarnessProviderMismatchError constructor super(...) message ONLY
  - preserve: '${harness}'/'${provider}' interpolations, '§9.2.4' token, .name/.harness/.provider,
    constructor signature, all other exports in the file
  - downstream impact: harness.test.ts + harness-config.test.ts stay green (substring asserts only)

NEW TEST (tests/unit/config/harness-provider-compat.test.ts):
  - mock: vi.mock('groundswell', () => ({ configureHarnesses: vi.fn() }))  (file-scoped, no leak)
  - consumes: configureHarness (SUT), HarnessProviderMismatchError, SUPPORTED_HARNESSES,
    DEFAULT_MODEL_PROVIDER from src/config/*.js
  - no new src module → no new coverage obligation

NO CHANGES TO (hard boundary):
  - src/config/harness.ts (SUT, read-only — M1.T1.S2 owns)
  - src/config/constants.ts, src/config/environment.ts, src/config/endpoint-guard.ts (M1.T1.S1 / M1.T1.S2 / M2.T1.S1)
  - src/agents/agent-factory.ts (M1.T2.S2 owns the harness field)
  - any docs/ file (M2.T3)
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# After editing each file — auto-fix first, then verify.
npm run fix                  # = lint:fix + prettier --write
npm run validate             # = lint && format:check && typecheck   (MUST be green)

# Targeted checks (optional, faster feedback):
npx eslint src/config/types.ts tests/unit/config/harness-provider-compat.test.ts
npx tsc --noEmit -p tsconfig.build.json
npx prettier --check src/config/types.ts tests/unit/config/harness-provider-compat.test.ts

# Expected: Zero errors. Most likely failure: a prettier nit (re-run `npm run fix`), or a
# type error if a token was accidentally removed from the message string.
```

### Level 2: Unit Tests (Component Validation)

```bash
# The new suite (must pass):
npx vitest run tests/unit/config/harness-provider-compat.test.ts

# The whole config suite — proves S1 (harness.test.ts) + S2 (harness-config.test.ts)
# are NOT broken by the message edit, and the new file sits cleanly alongside them:
npm run test:run -- config
# equivalent: npx vitest run tests/unit/config/

# Expected: all green. If harness.test.ts or harness-config.test.ts fail, the message edit
# dropped a required substring (§9.2.4 / claude-code / zai) — restore it and re-run.
```

### Level 3: Integration / Regression (System Validation)

```bash
# Full suite — MUST stay green. This is the proof that:
#  (1) the new compatibility suite passes,
#  (2) the message edit caused NO regression anywhere (esp. the two existing harness suites
#      and agent-factory.test.ts, which imports the real configureHarnesses),
#  (3) global coverage remains 100% (no new uncovered src file introduced).
npm run test:run
npm run test:coverage   # optional: confirm 100% statements/branches/functions/lines on src/**

# Build emits dist/ cleanly (proves the types.ts message edit compiles):
npx tsc -p tsconfig.build.json

# Expected: full suite green; coverage at 100%; build succeeds.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# No network/LLM/MCP/DB in this subtask — pure logic + message wording, all env-stubbed.
# Domain-specific reasoning (record in commit message):
#   1. Provider/harness orthogonality (PRD §9.4 h3.18): claude-code is a VALID harness id
#      (case c proves SUPPORTED_HARNESSES.includes('claude-code')); it is rejected ONLY because
#      the default provider is z.ai and claude-code is Anthropic-only. The unknown-id contrast
#      (case c-cont) proves the rejection reason is the MISMATCH, not "unknown value".
#   2. Actionable guidance (PRD §9.4.3): the error names BOTH remediation paths — switch the
#      harness to 'pi' OR switch the model provider to anthropic/*. A misconfigured user can
#      self-correct from the message alone.
#   3. Contract-fidelity note: the work item literally named getGlobalHarnessConfig()/
#      resetGlobalHarnessConfig(); both are UNEXPORTED by Groundswell (verified — see research).
#      The suite uses the verified vi.mock('groundswell') alternative and asserts on the
#      configureHarnesses call args to verify "defaultHarness === 'pi'". Document this deviation
#      in the commit message so reviewers understand why the literal recipe was not followed.
```

---

## Final Validation Checklist

### Technical Validation

- [ ] `npm run validate` exits 0 (lint + format:check + typecheck).
- [ ] `npx vitest run tests/unit/config/harness-provider-compat.test.ts` exits 0.
- [ ] `npm run test:run` (full suite) exits 0 — no regression (esp. `harness.test.ts`,
      `harness-config.test.ts`, `agent-factory.test.ts`).
- [ ] Global coverage remains 100% (no new uncovered `src/**/*.ts` file).
- [ ] `npx tsc -p tsconfig.build.json` compiles with no errors.

### Feature Validation

- [ ] Case (a): `pi` + `zai` (and env-unset) → `configureHarness()` returns `'pi'`, no throw;
      `configureHarnesses` called with `{ defaultHarness:'pi', defaultModelProvider:'zai', ... }`.
- [ ] Case (b): `claude-code` + `zai` → throws `HarnessProviderMismatchError` (`.name`,
      `.harness==='claude-code'`, `.provider==='zai'`); message contains `§9.2.4`, `pi`, AND
      `anthropic`; `configureHarnesses` NOT called.
- [ ] Case (c): `SUPPORTED_HARNESSES.includes('claude-code') === true`; an unknown id throws a
      plain `Error` (NOT the mismatch error) listing supported harnesses.
- [ ] `HarnessProviderMismatchError` message in `types.ts` names both remediation paths and still
      contains `claude-code`, `zai`, `§9.2.4`.

### Code Quality Validation

- [ ] New test file follows `harness-config.test.ts` conventions (vi.mock, beforeEach/afterEach,
      SETUP/EXECUTE/VERIFY comments, ESM `.js` specifiers, capture-thrown-error style).
- [ ] Message edit is surgical: only the second concat string changed; interpolations + §9.2.4
      preserved; constructor signature/fields/JSDoc intact.
- [ ] No use of `getGlobalHarnessConfig` / `resetGlobalHarnessConfig` (unexported — verified).
- [ ] New test file is disjoint from `harness-config.test.ts` (focuses on the NEW assertions:
      structural validity + actionable message); no verbatim duplication of M1.T1.S2's cases.
- [ ] No `any` in the test (cast `SUPPORTED_HARNESSES as readonly string[]` for `.includes`).

### Documentation & Deployment

- [ ] Commit message documents: (1) the compatibility-rejection coverage added; (2) the message
      tightening + which tokens were preserved; (3) the verified deviation from the contract's
      literal `getGlobalHarnessConfig`/`resetGlobalHarnessConfig` recipe (use `vi.mock` + call-arg
      asserts instead), with a pointer to `research/groundswell-exports-and-scope.md`.
- [ ] No new env vars introduced.

---

## Anti-Patterns to Avoid

- ❌ Don't import `getGlobalHarnessConfig` / `resetGlobalHarnessConfig` from `'groundswell'` —
  they are NOT exported (verified: `exports` map = only `.`; `dist/index.js` re-exports only
  `configureHarnesses`). The contract's literal reset/query recipe is broken. Mock
  `configureHarnesses` and assert on call args instead.
- ❌ Don't import Groundswell internals via deep path (`'groundswell/dist/utils/...'`) — blocked
  by the `exports` map, and the helpers are `@internal`.
- ❌ Don't change the `HarnessProviderMismatchError` constructor signature, fields, or drop the
  `'${harness}'`/`'${provider}'` interpolations or the `'§9.2.4'` token — existing tests assert
  on those substrings and will break.
- ❌ Don't edit anything in `types.ts` other than the mismatch-error message string.
- ❌ Don't edit `src/config/harness.ts` (the SUT — M1.T1.S2 owns it), `constants.ts`,
  `environment.ts`, `endpoint-guard.ts`, or `agent-factory.ts`.
- ❌ Don't duplicate M1.T1.S2's four startup cases verbatim — focus this file on the NEW
  dimensions: structural validity (case c) + actionable message (case b). Re-affirm case (a)
  briefly under the compatibility framing, but don't copy the whole file.
- ❌ Don't conflate the two throw sites: unknown id → plain `Error`; claude-code+zai →
  `HarnessProviderMismatchError`. Case (c) explicitly relies on telling them apart.
- ❌ Don't assert the message's EXACT full string — assert substrings (`§9.2.4`, `pi`,
  `anthropic`, plus the preserved `claude-code`/`zai`). Exact-string asserts are brittle.
- ❌ Don't create any new `src/**/*.ts` file (would add a coverage obligation) — this is a
  test + message-wording subtask only.
- ❌ Don't skip the failing-test-first (RED) step — create the test file (Task 2) so the
  actionable-message assertions are observed failing before the message edit confirms GREEN.

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: The change is tiny and self-contained — one surgical message-string edit in
`types.ts` and one new test file that mirrors the already-green `harness-config.test.ts`
layout. The SUT (`configureHarness()`), the constants/types it consumes, and the
`vi.mock('groundswell')` pattern are all already implemented and green (M1.T1.S1 + M1.T1.S2).
The genuinely novel assertions (structural validity of `claude-code`; actionable switch
guidance in the message) are precisely enumerated with exact vitest assertions and a
token-for-token target message aligned with `implementation_notes.md §1`. The ONE non-obvious
trap — the work-item contract's reliance on `getGlobalHarnessConfig()`/`resetGlobalHarnessConfig()`,
which Groundswell does NOT export — is fully documented with proof (package `exports` map +
`dist/index.js` grep + the M1.T1.S2 runtime probe) and a verified working alternative
(`vi.mock` + call-arg asserts). Residual risks: (a) a prettier nit on the message concat
(auto-fixed via `npm run fix`); (b) accidentally dropping a preserved token during the message
edit (caught immediately by the existing `harness.test.ts`/`harness-config.test.ts` substring
asserts). Neither is structural.
