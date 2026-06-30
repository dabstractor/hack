# PRP — P1.M2.T1.S1: Rewrite the `createBaseConfig` test assertion for the zai provider-aware resolver

> **Bugfix subtask** — Issue 2 of
> `plan/007_8783a1f5e14a/bugfix/001_7912d248208a/TEST_RESULTS.md`.
> The `createBaseConfig` integration test still asserts the OLD Anthropic-shell auth contract
> that T2.S1 (commit `a8ffac3`) deliberately removed — `config.env.ANTHROPIC_API_KEY` resolves
> provider-aware now. **Test-only churn; runtime behavior is unchanged.**

---

## Goal

**Feature Goal**: Replace the single stale `createBaseConfig` integration test
(`tests/integration/agents.test.ts > "should map ANTHROPIC_AUTH_TOKEN to ANTHROPIC_API_KEY"`)
with three new tests that assert the **provider-aware** auth contract introduced by T2.S1:
(a) the default `zai` provider resolves `ZAI_API_KEY`; (b) an `anthropic` provider override
honors `ANTHROPIC_API_KEY`; (c) no credential configured yields the honest `''` default.

**Deliverable**: An edited `tests/integration/agents.test.ts` in which the failing `it(...)`
(lines 154–168) is replaced by a nested `describe('provider-aware API key resolution (PRD §9.2.6)')`
containing the three cases above. **No source files touched.** No other tests in the file changed.

**Success Definition**:
- `npx vitest run tests/integration/agents.test.ts -t createBaseConfig` → **0 failures**
  (the D1 regression is gone; the 3 new tests + the untouched sibling tests all pass).
- No NEW failures are introduced anywhere in the file.
- `src/agents/agent-factory.ts` and `src/config/*.ts` are **unmodified** (test-only churn).

---

## Why

- **Removes the one D1-attributable test regression (TEST_RESULTS.md Issue 2).** T2.S1 rewired
  `createBaseConfig()` to call `resolveApiKeyForProvider(getResolvedProvider())` instead of raw
  `process.env.ANTHROPIC_API_KEY`, and updated the unit tests — but missed this integration test.
  It now fails: `expected '' to be 'test-token-123'`. PRD §9.2.6 (Provider-Agnostic
  Authentication Model).
- **The runtime is correct; only the test is stale.** The resolver
  (`src/config/harness.ts:67–99`) is fully unit-tested and green
  (`tests/unit/config/auth-resolver.test.ts`, 19 tests). This subtask brings the integration
  test into alignment with the new contract by mirroring the exact cases already proven at the
  unit level.
- **Unblocks `npm run validate`.** `validate` = `lint && format:check && typecheck && test:run`.
  This single failing test is the only D1 regression blocking the test gate (the other ~222
  failures across ~32 files are pre-existing, Category A/B/C, owned by P1.M3 / separate triage).
- **Scope discipline.** This is S1 = the auth-key test only. Stale model-name assertions
  (`GLM-4.7` → `zai/glm-5.2`, lines 240/286/332/378) are **P1.M3.T1.S1**. Stale
  `enableReflection`/`responseFormat` assertions are **P1.M3.T2**. Both are explicitly out of scope.

---

## What

### User-visible behavior
None — test-only change. Runtime behavior (`createBaseConfig`) is unchanged.

### Technical requirements (exact contract)

**File:** `tests/integration/agents.test.ts`.

**Locate** the `describe('createBaseConfig', …)` block (starts **line 148**). Its FIRST `it(...)`,
**lines 154–168** — `it('should map ANTHROPIC_AUTH_TOKEN to ANTHROPIC_API_KEY', () => { … })` —
is the failing test. **Replace that single `it(...)` block** with a nested
`describe('provider-aware API key resolution (PRD §9.2.6)', () => { … })` containing the three
`it(...)` cases below.

**KEEP the parent `describe('createBaseConfig')` and its `afterEach(() => vi.unstubAllEnvs())`.**
KEEP the other passing tests in the block (`should include all required AgentConfig properties`,
`should set persona-specific token limits`, …) **byte-for-byte unchanged**.

**The three replacement tests** (verbatim — mirror `tests/unit/config/auth-resolver.test.ts`):

```ts
    describe('provider-aware API key resolution (PRD §9.2.6)', () => {
      // Each case mirrors the unit-level matrix in tests/unit/config/auth-resolver.test.ts.
      // createBaseConfig() forwards resolveApiKeyForProvider(getResolvedProvider()) ?? ''
      // as config.env.ANTHROPIC_API_KEY (the field the Groundswell SDK reads).

      it('(a) DEFAULT zai provider — resolves ZAI_API_KEY and forwards it as the SDK key', () => {
        // SETUP: default zai provider (no sonnet override), no PRP_API_KEY override
        delete process.env.ANTHROPIC_DEFAULT_SONNET_MODEL;
        delete process.env.PRP_API_KEY;
        vi.stubEnv('ZAI_API_KEY', 'zai-test-key');

        // EXECUTE
        const config = createBaseConfig('architect');

        // VERIFY: the zai-native env var is resolved and forwarded
        expect(config.env.ANTHROPIC_API_KEY).toBe('zai-test-key');
      });

      it('(b) anthropic provider override — honors ANTHROPIC_API_KEY', () => {
        // SETUP: switch provider to anthropic via a qualified sonnet override
        vi.stubEnv('ANTHROPIC_DEFAULT_SONNET_MODEL', 'anthropic/claude-sonnet-4');
        vi.stubEnv('ANTHROPIC_API_KEY', 'anthropic-test-key');
        delete process.env.ANTHROPIC_OAUTH_TOKEN; // OAUTH has precedence; clear so API_KEY wins
        delete process.env.PRP_API_KEY;

        // EXECUTE
        const config = createBaseConfig('architect');

        // VERIFY: ANTHROPIC_API_KEY IS honored for the anthropic provider
        expect(config.env.ANTHROPIC_API_KEY).toBe('anthropic-test-key');
      });

      it('(c) no credential configured — honest empty-string default', () => {
        // SETUP: default zai provider, nothing configured anywhere
        delete process.env.ANTHROPIC_DEFAULT_SONNET_MODEL;
        delete process.env.PRP_API_KEY;
        delete process.env.ZAI_API_KEY;
        delete process.env.ANTHROPIC_API_KEY;
        delete process.env.ANTHROPIC_OAUTH_TOKEN;

        // EXECUTE
        const config = createBaseConfig('architect');

        // VERIFY: terminal ?? '' — genuinely unconfigured, not a fake key
        expect(config.env.ANTHROPIC_API_KEY).toBe('');
      });
    });
```

**Placement / indentation:** the nested `describe` replaces the old `it(...)` at the same
indentation level (4 spaces — inside `describe('createBaseConfig', () => {`), immediately after
the parent's `afterEach(() => { vi.unstubAllEnvs(); });` block and before the
`it('should include all required AgentConfig properties', …)` test.

### Success Criteria
- [ ] The `it('should map ANTHROPIC_AUTH_TOKEN to ANTHROPIC_API_KEY', …)` test is **removed**.
- [ ] A nested `describe('provider-aware API key resolution (PRD §9.2.6)')` with the 3 cases is added in its place.
- [ ] Case (a) asserts `config.env.ANTHROPIC_API_KEY === 'zai-test-key'` (default zai + `ZAI_API_KEY`).
- [ ] Case (b) asserts `config.env.ANTHROPIC_API_KEY === 'anthropic-test-key'` (anthropic provider + `ANTHROPIC_API_KEY`).
- [ ] Case (c) asserts `config.env.ANTHROPIC_API_KEY === ''` (nothing configured).
- [ ] The parent `describe('createBaseConfig')`, its `afterEach`, and the other 3 sibling tests are unchanged.
- [ ] `npx vitest run tests/integration/agents.test.ts -t createBaseConfig` → 0 failures.
- [ ] No source file (`src/**`) is modified.

---

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed to
implement this successfully?_ **Yes** — the exact failing test (file + line range + live error),
the exact runtime contract (`createBaseConfig` body + resolver priority order), the exact mechanic
for switching providers (`ANTHROPIC_DEFAULT_SONNET_MODEL` qualified override), the verbatim
canonical stubbing pattern (from the green unit test), and the verbatim replacement code are all
supplied. No judgement calls remain.

### Documentation & References

```yaml
# MUST READ — the authoritative bug report + suggested fix
- docfile: plan/007_8783a1f5e14a/bugfix/001_7912d248208a/TEST_RESULTS.md
  section: "Major Issues > Issue 2"
  why: Root cause (createBaseConfig now resolves provider-aware; the test stubs only
        ANTHROPIC_API_KEY which the zai resolver ignores), the exact failure
        ("expected '' to be 'test-token-123'"), and the suggested fix (rewrite to assert the
        new provider-aware contract, mirroring tests/unit/config/environment.test.ts).
  critical: This is test-only churn; runtime behavior is correct. Do NOT edit src/.

# MUST READ — full triage (confirms this is the ONE D1 regression)
- docfile: plan/007_8783a1f5e14a/bugfix/001_7912d248208a/architecture/test_triage.md
  section: "D1 Regression (Issue 2) — exactly ONE test"
  why: Pins the failing test (tests/integration/agents.test.ts:155-168), the resolver line
        numbers (createBaseConfig 174-176), and confirms the 5 auth unit files are GREEN.
  critical: >
    The stale model-name assertions (GLM-4.7 → zai/glm-5.2, lines 240/286/332/378) and the
    enableReflection/responseFormat assertions are SEPARATE pre-existing issues (Categories
    A & B) owned by P1.M3.T1 / P1.M3.T2. Do NOT fix them here.

# MUST READ — the authoritative stubbing pattern to mirror
- file: tests/unit/config/auth-resolver.test.ts
  why: This is the GREEN unit test for resolveApiKeyForProvider() + getResolvedProvider(). It
        establishes the canonical env-stubbing idiom this rewrite MUST follow.
  pattern: |
    afterEach(() => { vi.unstubAllEnvs(); });
    // vars that must be ABSENT → delete process.env.X  (NOT vi.stubEnv to undefined)
    // vars that must be PRESENT → vi.stubEnv('X', 'value')
    // the resolver .trim()s every value; '' / whitespace-only == "not configured"
    // switch provider to anthropic: vi.stubEnv('ANTHROPIC_DEFAULT_SONNET_MODEL', 'anthropic/claude-sonnet-4')
  gotcha: >
    vi.unstubAllEnvs() does NOT undo `delete process.env.X`. The reference file accepts this
    (each test re-establishes what it needs). Mirror it — do not try to "restore" deleted keys.

# THE RUNTIME CONTRACT (read-only — do NOT edit)
- file: src/agents/agent-factory.ts
  section: "createBaseConfig() — the env block (lines 174-176)"
  why: Shows exactly what createBaseConfig reads: ANTHROPIC_API_KEY = resolveApiKeyForProvider(
        getResolvedProvider()) ?? '';  ANTHROPIC_BASE_URL = process.env.ANTHROPIC_BASE_URL ?? ''.
  pattern: "ANTHROPIC_API_KEY: resolveApiKeyForProvider(getResolvedProvider()) ?? ''"
  gotcha: The field is named ANTHROPIC_API_KEY regardless of provider — it is the SDK key slot.

- file: src/config/harness.ts
  section: "resolveApiKeyForProvider() (lines 67-99) + getProviderEnvApiKey() (lines 45-54)"
  why: The resolver priority order: (1) options.override ?? PRP_API_KEY; (2) provider-native
        env var — zai→ZAI_API_KEY, anthropic→ANTHROPIC_OAUTH_TOKEN then ANTHROPIC_API_KEY;
        (3) auth.json deferred → undefined. Every value is .trim()'d.
  pattern: "zai → ZAI_API_KEY (NOT ANTHROPIC_API_KEY); anthropic → OAUTH then API_KEY"
  gotcha: ANTHROPIC_API_KEY is ONLY consulted when the resolved provider is 'anthropic'.

- file: src/config/environment.ts
  section: "getResolvedProvider() (line 47)"
  why: getResolvedProvider() = getModel('sonnet').split('/')[0]. Unset sonnet override → 'zai'.
        A qualified 'anthropic/...' override → 'anthropic'.
  pattern: "provider = getModel('sonnet').split('/')[0]"
```

### Current Codebase tree (relevant slice)

```bash
tests/integration/
└── agents.test.ts          # EDIT — replace ONE it() (lines 154-168) with 3-case nested describe
src/
├── agents/agent-factory.ts # READ-ONLY — createBaseConfig (the code under test)
└── config/
    ├── harness.ts          # READ-ONLY — resolveApiKeyForProvider, getProviderEnvApiKey
    └── environment.ts      # READ-ONLY — getResolvedProvider, getModel
tests/unit/config/
├── auth-resolver.test.ts   # READ-ONLY — the canonical stubbing pattern to mirror (GREEN)
└── environment.test.ts     # READ-ONLY — the anthropic-provider-override pattern to mirror
```

### Desired Codebase tree with files to be added/edited

```bash
tests/integration/
└── agents.test.ts          # MODIFIED — one it() replaced by a 3-case nested describe
# No new files. No source files. No other test files.
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — the zai resolver does NOT read ANTHROPIC_API_KEY. For the default zai provider,
//   resolveApiKeyForProvider('zai') checks PRP_API_KEY → ZAI_API_KEY → auth.json (deferred).
//   Stubbing only ANTHROPIC_API_KEY yields '' (the terminal ?? ''). That is WHY the old test
//   fails and WHY case (a) must stub ZAI_API_KEY instead.

// CRITICAL — to switch the provider to 'anthropic' in a test, stub a QUALIFIED sonnet override:
//   vi.stubEnv('ANTHROPIC_DEFAULT_SONNET_MODEL', 'anthropic/claude-sonnet-4')
//   qualifyModel() does NOT double-prefix an already-qualified name, so this passes through.
//   getResolvedProvider() then = getModel('sonnet').split('/')[0] = 'anthropic'. This is the
//   exact pattern in environment.test.ts (lines 33/47/60/73) and auth-resolver.test.ts.

// GOTCHA — for the anthropic provider, ANTHROPIC_OAUTH_TOKEN takes precedence over
//   ANTHROPIC_API_KEY (getProviderEnvApiKey: 'ANTHROPIC_OAUTH_TOKEN ?? ANTHROPIC_API_KEY').
//   In case (b), `delete process.env.ANTHROPIC_OAUTH_TOKEN` so API_KEY wins. Otherwise the
//   real env's OAUTH token (if any) would leak in and the assertion could be non-deterministic.

// GOTCHA — vi.unstubAllEnvs() (in the parent afterEach) restores vi.stubEnv'd values but does
//   NOT undo `delete process.env.X`. This is intentional and matches auth-resolver.test.ts.
//   Each test re-establishes the env it needs via delete + stubEnv. Do not add restore logic.

// GOTCHA — the resolver .trim()s every value and treats '' / whitespace-only as "not configured".
//   So vi.stubEnv('ZAI_API_KEY', '') is equivalent to absent. But prefer explicit `delete` for
//   the "absent" cases (case c) to match the reference idiom and avoid ambiguity.

// GOTCHA — do NOT add model assertions. In case (b) config.model becomes
//   'anthropic/claude-sonnet-4' (getModel returns the override). The stale GLM-4.7 model
//   assertions elsewhere in this file are P1.M3.T1.S1. Adding a model assertion here risks
//   colliding with that subtask. Assert ONLY config.env.ANTHROPIC_API_KEY.

// GOTCHA — prettier is ERROR-enforced (format:check). After editing, run
//   `npx prettier --write tests/integration/agents.test.ts` (or `npm run fix`) before
//   format:check. Keep the nested describe at 4-space indent (inside the parent describe).
```

---

## Implementation Blueprint

### Data models and structure
None — test-only edit. No types, constants, or source code.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: LOCATE + CONFIRM the failing test (read-only sanity)
  - RUN: `npx vitest run tests/integration/agents.test.ts -t createBaseConfig 2>&1 | tail -8`
  - EXPECT: exactly 1 failure — "should map ANTHROPIC_AUTH_TOKEN to ANTHROPIC_API_KEY"
        (AssertionError: expected '' to be 'test-token-123'); the other tests in the block pass.
  - OPEN: tests/integration/agents.test.ts. Confirm the describe('createBaseConfig') block
        starts at line 148 and the failing it(...) is the first test (lines 154-168).
  - If the failure is different or absent, STOP — the tree state has changed; re-evaluate.

Task 2: EDIT tests/integration/agents.test.ts — replace the one failing it(...) with 3 cases
  - DELETE: the entire it('should map ANTHROPIC_AUTH_TOKEN to ANTHROPIC_API_KEY', () => { … })
        block (lines 154-168, including its leading comment lines if any).
  - INSERT in its place (same 4-space indentation, inside describe('createBaseConfig')):
        the nested describe('provider-aware API key resolution (PRD §9.2.6)', () => { … })
        with the three it(...) cases (a)/(b)/(c) verbatim from the "Technical requirements" above.
  - PRESERVE: the parent describe('createBaseConfig') wrapper, its
        afterEach(() => { vi.unstubAllEnvs(); }), and ALL other it(...) tests in the block
        (especially 'should include all required AgentConfig properties' and
        'should set persona-specific token limits'). Byte-for-byte unchanged.
  - DO NOT TOUCH: any other describe block, any line outside 154-168, any source file.
  - PLACEMENT: tests/integration/agents.test.ts, inside describe('createBaseConfig'), between
        the afterEach and the 'should include all required AgentConfig properties' test.

Task 3: VERIFY — the D1 regression is fixed, no new failures
  - RUN: `npx prettier --write tests/integration/agents.test.ts`  (auto-format the edit)
  - RUN: `npx prettier --check tests/integration/agents.test.ts`  (must pass — ERROR-enforced)
  - RUN: `npx vitest run tests/integration/agents.test.ts -t createBaseConfig`
  - EXPECT: 0 failures. The 3 new tests pass; the untouched sibling tests still pass.
  - RUN (regression guard on the whole file): `npx vitest run tests/integration/agents.test.ts`
  - EXPECT: the createBaseConfig block is fully green; the ONLY remaining failures in the file
        are the PRE-EXISTING stale model-name / enableReflection / responseFormat assertions
        (Categories A & B, owned by P1.M3.T1 / P1.M3.T2). Their COUNT must be unchanged by S1.
  - DO NOT: fix any Category A/B assertion (that is P1.M3). DO NOT run the full `npm run
        validate` as the S1 gate (the ~222 other pre-existing failures keep it red; S1's
        acceptance is the targeted createBaseConfig command).
```

### Implementation Patterns & Key Details

```ts
// PATTERN — the exact replacement. Old block (DELETE, lines 154-168):
  it('should map ANTHROPIC_AUTH_TOKEN to ANTHROPIC_API_KEY', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-token-123');
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://api.z.ai/api/anthropic');
    const config = createBaseConfig('architect');
    expect(config.env.ANTHROPIC_API_KEY).toBe('test-token-123'); // ← FAILS (actual '')
    expect(config.env.ANTHROPIC_BASE_URL).toBe('https://api.z.ai/api/anthropic');
  });

// New block (INSERT, same indent) — see the verbatim 3-case describe in the "Technical
// requirements" section. The essential contract each case pins:

// (a) default zai:  resolveApiKeyForProvider('zai') reads ZAI_API_KEY  → forwarded
//     delete ANTHROPIC_DEFAULT_SONNET_MODEL; delete PRP_API_KEY; stub ZAI_API_KEY='zai-test-key'
//     → config.env.ANTHROPIC_API_KEY === 'zai-test-key'

// (b) anthropic:    resolveApiKeyForProvider('anthropic') reads OAUTH then API_KEY
//     stub ANTHROPIC_DEFAULT_SONNET_MODEL='anthropic/claude-sonnet-4'; stub ANTHROPIC_API_KEY;
//     delete ANTHROPIC_OAUTH_TOKEN; delete PRP_API_KEY
//     → config.env.ANTHROPIC_API_KEY === 'anthropic-test-key'

// (c) unconfigured: resolver returns undefined → terminal ?? ''
//     delete all of: ANTHROPIC_DEFAULT_SONNET_MODEL, PRP_API_KEY, ZAI_API_KEY,
//                     ANTHROPIC_API_KEY, ANTHROPIC_OAUTH_TOKEN
//     → config.env.ANTHROPIC_API_KEY === ''
```

### Integration Points

```yaml
CODE UNDER TEST (read-only — do NOT edit):
  - src/agents/agent-factory.ts createBaseConfig(): reads resolveApiKeyForProvider(
        getResolvedProvider()) ?? '' for ANTHROPIC_API_KEY; process.env.ANTHROPIC_BASE_URL ?? ''.
  - src/config/harness.ts resolveApiKeyForProvider(): priority PRP_API_KEY → provider-native
        env var → auth.json (deferred). .trim()s every value.
  - src/config/environment.ts getResolvedProvider(): getModel('sonnet').split('/')[0].

SIBLING TESTS (preserve unchanged):
  - tests/integration/agents.test.ts > createBaseConfig > 'should include all required
        AgentConfig properties' (stubs ANTHROPIC_API_KEY but does NOT assert its value → still passes).
  - tests/integration/agents.test.ts > createBaseConfig > 'should set persona-specific token
        limits' (asserts maxTokens only → still passes).

NOT INTEGRATED (do NOT touch in S1):
  - Stale model-name assertions (GLM-4.7 → zai/glm-5.2) at lines 240/286/332/378 → P1.M3.T1.S1.
  - Stale enableReflection/responseFormat assertions at lines 422/427/488/493 → P1.M3.T2.S1.
  - The ~222 other pre-existing failures across ~32 files → separate triage (Issue 3).
  - src/agents/agent-factory.ts and src/config/*.ts → runtime is correct; no source edits.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Format the edited file (prettier is ERROR-enforced via eslint-plugin-prettier):
npx prettier --write tests/integration/agents.test.ts
npx prettier --check tests/integration/agents.test.ts     # must pass
npx eslint tests/integration/agents.test.ts               # must pass (no lint errors)
# Expected: zero errors. If prettier complains, the --write above resolves it.
```

### Level 2: Unit Tests (Component Validation)

```bash
# N/A — this is an integration test file. There is no separate unit test to run for the edit.
# (The resolver's own unit tests, tests/unit/config/auth-resolver.test.ts, are already green
#  and are the reference, not a gate for S1.)
```

### Level 3: Integration Testing (System Validation)

```bash
# THE primary acceptance gate for S1:
npx vitest run tests/integration/agents.test.ts -t createBaseConfig
# Expected: Test Files 1 passed (1). The createBaseConfig describe block is fully green:
#   the 3 new provider-aware tests + the untouched sibling tests all pass. 0 failures.

# Regression guard — run the WHOLE file and confirm S1 introduced NO new failures:
npx vitest run tests/integration/agents.test.ts
# Expected: the createBaseConfig block is green. The ONLY remaining failures in this file are
#   the PRE-EXISTING stale model-name (GLM-4.7) and enableReflection/responseFormat assertions
#   (Categories A & B). Their count must be UNCHANGED by S1 (they are P1.M3's scope).
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Confirm the three cases exercise the real resolver branches (reasoning for the commit message):
#   (a) hits resolver branch 2 (provider-native env var) for zai → ZAI_API_KEY.
#   (b) hits resolver branch 2 for anthropic → ANTHROPIC_API_KEY (after clearing OAUTH).
#   (c) hits resolver branch 3 (auth.json deferred → undefined) → terminal ?? ''.
#
# Optional — prove the provider switch actually works (no assertion needed in the test, just
# sanity that getModel honors the qualified override end-to-end through createBaseConfig):
npx tsx -e "process.env.ANTHROPIC_DEFAULT_SONNET_MODEL='anthropic/claude-sonnet-4'; import('./src/agents/agent-factory.js').then(m => { const c = m.createBaseConfig('architect'); console.log('provider-model:', c.model); })"
# Expected: provider-model: anthropic/claude-sonnet-4  (confirms case (b) switches the provider).
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npx prettier --check tests/integration/agents.test.ts` passes (or was auto-fixed).
- [ ] `npx eslint tests/integration/agents.test.ts` passes.
- [ ] `npx vitest run tests/integration/agents.test.ts -t createBaseConfig` → 0 failures.

### Feature Validation
- [ ] The `it('should map ANTHROPIC_AUTH_TOKEN to ANTHROPIC_API_KEY', …)` test is removed.
- [ ] Case (a) asserts `config.env.ANTHROPIC_API_KEY === 'zai-test-key'` (default zai + `ZAI_API_KEY`).
- [ ] Case (b) asserts `config.env.ANTHROPIC_API_KEY === 'anthropic-test-key'` (anthropic + `ANTHROPIC_API_KEY`).
- [ ] Case (c) asserts `config.env.ANTHROPIC_API_KEY === ''` (nothing configured).
- [ ] Full-file run shows the createBaseConfig block green; pre-existing Category A/B failure count unchanged.

### Code Quality Validation
- [ ] Only `tests/integration/agents.test.ts` is modified — no source file, no other test file.
- [ ] The parent `describe('createBaseConfig')`, its `afterEach`, and the sibling tests are unchanged.
- [ ] The stubbing idiom mirrors `tests/unit/config/auth-resolver.test.ts` (`delete` for absent, `vi.stubEnv` for present).
- [ ] No model-name assertion added (deferred to P1.M3.T1.S1).
- [ ] No `src/` file touched (test-only churn; runtime unchanged).

### Documentation & Deployment
- [ ] No docs change (contract DOCS: Mode A — none; test-only, no user-facing/config/API surface).
- [ ] Commit message references Issue 2 (T2.S1 regression) and notes it is test-only churn.

---

## Anti-Patterns to Avoid

- ❌ Don't edit any `src/` file — the runtime is correct; this is test-only churn (contract OUTPUT).
- ❌ Don't stub only `ANTHROPIC_API_KEY` for the default zai case — the zai resolver ignores it; that's the bug you're fixing. Use `ZAI_API_KEY`.
- ❌ Don't forget to `delete process.env.ANTHROPIC_OAUTH_TOKEN` in case (b) — OAUTH has precedence over API_KEY for the anthropic provider; a leaked real-env OAUTH token makes the assertion non-deterministic.
- ❌ Don't use `vi.stubEnv('X', undefined)` to mean "absent" — prefer explicit `delete process.env.X` (mirrors the reference; avoids the "key present but undefined" ambiguity).
- ❌ Don't add a model-name assertion — in case (b) the model is `anthropic/claude-sonnet-4`; the stale `GLM-4.7` assertions are P1.M3.T1.S1's scope.
- ❌ Don't touch the sibling tests in the `createBaseConfig` block or any other describe block.
- ❌ Don't fix the Category A/B assertions (model names, enableReflection, responseFormat) — those are P1.M3.
- ❌ Don't run `npm run validate` as the S1 gate — the ~222 other pre-existing failures keep it red; S1's acceptance is the targeted `-t createBaseConfig` command.
- ❌ Don't let prettier fail — run `npx prettier --write tests/integration/agents.test.ts` after editing.

---

## Confidence Score

**10/10** — One-pass implementation success likelihood.

Rationale: The change is a literal block replacement (one `it(...)` → one nested `describe`
with three `it(...)` cases), with the verbatim replacement code supplied. The runtime contract
is fully traced: `createBaseConfig` (agent-factory.ts:174-176) → `resolveApiKeyForProvider(
getResolvedProvider())` (harness.ts:67-99) → provider-native env var priority (zai→ZAI_API_KEY;
anthropic→OAUTH then API_KEY) → terminal `?? ''`. The provider-switch mechanic
(`ANTHROPIC_DEFAULT_SONNET_MODEL='anthropic/claude-sonnet-4'` → `getResolvedProvider()==='anthropic'`)
is the exact pattern already proven green in `tests/unit/config/environment.test.ts` and
`auth-resolver.test.ts`, which are supplied as the canonical stubbing references. The live
failure was reproduced and pinned (1 failed | 3 passed in the block), confirming only the single
test needs replacement and the siblings are safe to leave untouched. Scope guardrails cleanly
separate the model-name (P1.M3.T1.S1) and enableReflection/responseFormat (P1.M3.T2) work. The
single validation gate (`npx vitest run tests/integration/agents.test.ts -t createBaseConfig` →
0 failures) is explicitly scoped to avoid the ~222 pre-existing failures. No unknowns remain.
