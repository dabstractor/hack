---
name: "P7.M1.T2.S3 — Tests for the provider-aware auth resolution order"
description: |
  TEST-ONLY work item (hacky-hack). Create `tests/unit/config/auth-resolution.test.ts` proving ALL FIVE
  resolution-order cases from PRD §9.2.6/§9.2.7 (no network/LLM calls): (a) explicit override wins;
  (b) ZAI_API_KEY-only succeeds under pi+zai; (c) auth.json-only (no env) succeeds under pi+zai (seed a
  temp-dir ~/.pi/agent/auth.json via PI_CODING_AGENT_DIR); (d) empty/whitespace strings treated as "not
  configured"; (e) ANTHROPIC_AUTH_TOKEN succeeds ONLY when the provider is anthropic. The matrix exercises
  the resolution order END-TO-END: it asserts BOTH what `resolveApiKeyForProvider()` returns AND what
  `ensureHarnessInitialized()` actually forwards into the harness (`registry.initializeProvider('pi', opts)`),
  using the `vi.mock('groundswell')` + spy pattern from `harness-provider-compat.test.ts`. For case (c) it
  additionally proves the file-backed half (the pi contract T2.S2 enables) by asserting
  `AuthStorage.create().getApiKey('zai')` resolves a seeded temp-dir auth.json. INPUT: the resolver from
  P7.M1.T2.S1 (DONE — exported) + the file-backed AuthStorage from P7.M1.T2.S2 (parallel; must be settled
  first). NO src/ edits; NO doc edits (Mode A docs rode with S1; this is test-only per the work-item DOCS
  clause). Existing config tests stay green. Satisfies PRD §9.2.6 + §9.2.7 acceptance (auth-only cases).
---

## Goal

**Feature Goal**: A single new test file, `tests/unit/config/auth-resolution.test.ts`, that deterministically
proves the complete provider-aware auth resolution order (PRD §9.2.6) — covering all five acceptance cases
enumerated in the work item and in PRD §9.2.7 — with **no network and no LLM calls**. The matrix asserts the
resolution order both at the resolver level (`resolveApiKeyForProvider`) AND at the forwarding level (what
`ensureHarnessInitialized` actually passes to `registry.initializeProvider('pi', …)`), so it catches
regressions in either half (a stale `?? ''`, a forgotten override, an AUTH_TOKEN leak into the zai path).

**Deliverable**:
1. **`tests/unit/config/auth-resolution.test.ts` (NEW)** — vitest suite with up to 3 `describe` blocks:
   (1) `describe('auth resolution order — resolver level')` — cases (a)/(b)/(d)/(e) against
   `resolveApiKeyForProvider` directly (the hacky-hack resolver contract); (2)
   `describe('auth resolution order — what is forwarded to the harness')` — cases (a)–(e) via
   `ensureHarnessInitialized()` with a mocked `groundswell` whose `HarnessRegistry.getInstance()` returns a
   **spy** `initializeProvider`; assert the exact call args (`{apiKey}` vs `undefined`); (3)
   `describe('auth.json — file-backed resolution (PRD §9.2.6 / T2.S2)')` — case (c): seed a temp
   `PI_CODING_AGENT_DIR`/auth.json, assert `AuthStorage.create().getApiKey('zai')` resolves the seeded key
   (the pi-side contract hacky-hack depends on) + the hacky-hack-side forward-`undefined` assertion.
2. **`package.json` (MODIFIED — ONLY if the AuthStorage import does not resolve)** — add
   `"@earendil-works/pi-coding-agent"` to `devDependencies` (mirrors S1's `@earendil-works/pi-ai` precedent)
   so `import { AuthStorage } from '@earendil-works/pi-coding-agent'` resolves under vitest. See §Gotchas —
   this is gated on a verification step; skip it if the import already resolves.

**Success Definition** (maps to the work-item OUTPUT contract + PRD §9.2.6/§9.2.7 acceptance):
- All five cases pass: (a) override wins; (b) ZAI_API_KEY-only → forwarded; (c) auth.json-only → forwarded
  `undefined` (defer) AND the file-backed store resolves the seeded key; (d) empty/whitespace → `undefined`;
  (e) ANTHROPIC_AUTH_TOKEN forwarded ONLY for the `anthropic` provider (NOT for `zai`).
- No test makes a network or LLM call. No test reads the developer's real `~/.pi/agent/auth.json`
  (case (c) isolates via a temp `PI_CODING_AGENT_DIR`).
- `npm run validate` passes (lint + format:check + typecheck + test:run).
- `npx vitest run tests/unit/config/` is fully green — the existing config tests
  (`auth-resolver.test.ts`, `environment.test.ts`, `harness-config.test.ts`, `harness-provider-compat.test.ts`,
  `endpoint-guard.test.ts`, …) are unaffected.
- 100% coverage gate stays satisfied (automatic — T2.S3 is a new test file, excluded from coverage, and
  touches no `src/` file).

## User Persona (if applicable)

**Target User**: The hacky-hack maintainer and the CI gate. The PRD §9.2.6 auth model is the keystone of
the `pi`+`zai` default; a silent regression (e.g. re-introducing `?? ''` empty-string shadowing, or leaking
`ANTHROPIC_AUTH_TOKEN` into the zai path) would re-break the canonical `pi /login` user. These tests are the
deterministic guard that makes such a regression fail fast.

**Use Case**: A maintainer edits `src/config/harness.ts` or `src/config/environment.ts` and runs
`npm run validate`. The resolution-order matrix must fail loudly if the priority order, the empty-string
policy, or the AUTH_TOKEN-only-for-anthropic rule is violated.

**User Journey**: edit auth source → `npm run validate` → `auth-resolution.test.ts` runs the 5-case matrix
→ green (behavior preserved) or red (exact case + assertion that broke).

**Pain Points Addressed**: PRD §9.2.6 problem #3 ("empty-string shadowing obscures unset from misconfigured")
and the AUTH_TOKEN-demotion contract are now enforced by executable assertions, not just prose.

## Why

- **Business value**: This is the acceptance-level proof of the provider-agnostic auth model (PRD §9.2.6 +
  §9.2.7). S1 shipped the resolver; S2 (parallel) ships the file-backed store; **T2.S3 is what proves the
  two compose** — that the canonical `pi /login` user (auth.json only) actually succeeds, and that the
  resolution ORDER holds end-to-end (override → env → auth.json, with whitespace==unset and AUTH_TOKEN
  demoted). It is the regression net for the entire auth workstream.
- **Integration with existing features**: Consumes `resolveApiKeyForProvider` + `getResolvedProvider` +
  `ensureHarnessInitialized` (S1) and the rebuilt+relinked groundswell dist with file-backed
  `AuthStorage.create()` (S2). Reuses the `vi.mock('groundswell')` + spy pattern established by
  `harness-provider-compat.test.ts`. The exported resolver + provider fns are the SAME seam T3's preflight
  will consume (PRD §9.2.7) — T2.S3 locking them in tests protects T3.
- **Problems solved / for whom**: For every `pi`+`zai` user (the default) — guarantees the auth contract
  can't silently regress. For Anthropic loyalists (`anthropic/*`) — guarantees the AUTH_TOKEN alias still
  works for them and ONLY for them.

## What

User-visible behavior: none (test-only). Internally, a new vitest file exercises the five-case resolution
matrix. The forwarding-level tests mock `groundswell` (so no real PiHarness singleton / SDK import / disk
read occurs on those cases); the case-(c) file-backed test imports the real `AuthStorage` from
`@earendil-works/pi-coding-agent` (a different module, unaffected by the groundswell mock) and isolates it
to a temp `PI_CODING_AGENT_DIR`.

### Success Criteria

- [ ] Case (a): `resolveApiKeyForProvider('zai', { override: 'X' })` returns `'X'` even with `ZAI_API_KEY`
      set; `PRP_API_KEY` env also wins over `ZAI_API_KEY`; `ensureHarnessInitialized` forwards
      `{ apiKey: 'X' }` (spy on `initializeProvider`).
- [ ] Case (b): with only `ZAI_API_KEY` set (no override, no Anthropic var), the resolver returns the ZAI
      value AND `ensureHarnessInitialized` forwards `{ apiKey: <zaiVal> }`.
- [ ] Case (c): with NO env vars (only a seeded temp-dir `auth.json`), the resolver returns `undefined` AND
      `ensureHarnessInitialized` forwards `undefined` (defer to pi); AND `AuthStorage.create()` against the
      temp dir resolves `await auth.getApiKey('zai')` to the seeded key.
- [ ] Case (d): whitespace-only `ZAI_API_KEY` / `PRP_API_KEY` → resolver returns `undefined`; forwarded
      `undefined` (NOT `{ apiKey: '' }`).
- [ ] Case (e): `ANTHROPIC_AUTH_TOKEN` set, provider `zai` (default) → resolver returns `undefined`,
      forwarded `undefined` (AUTH_TOKEN NOT consulted for zai); provider `anthropic` (via
      `ANTHROPIC_DEFAULT_SONNET_MODEL='anthropic/*'`) + `configureEnvironment()` → AUTH_TOKEN mapped to
      `ANTHROPIC_API_KEY`, resolver returns the token value, forwarded `{ apiKey: <token> }`.
- [ ] No test reads the developer's real `~/.pi/agent/auth.json` (temp-dir isolation).
- [ ] No network/LLM calls (groundswell mocked for forwarding cases; AuthStorage is pure file/env, no HTTP).
- [ ] `npm run validate` passes; `npx vitest run tests/unit/config/` fully green.

## All Needed Context

### Context Completeness Check

If someone knew nothing about this codebase, would they have everything needed? **Yes.** The resolver +
forwarding contracts are quoted verbatim below (from the S1-shipped source, which is DONE). The test
patterns to follow (`harness-provider-compat.test.ts` for the groundswell mock+spy; `environment.test.ts`
for `vi.stubEnv`/`afterEach` cleanup) are cited with the exact structures. The AuthStorage reachability
gotcha + the dep-addition fallback is spelled out. The five cases map to concrete assertions in §7 of
`research/verified_facts.md`. The PRD binding is §9.2.6 + §9.2.7. The only conditional step (devDep
addition) is gated on a one-line verification.

### Documentation & References

```yaml
# MUST READ — authoritative, file-level contract for this exact subtask
- file: plan/007_8783a1f5e14a/architecture/implementation_notes.md
  why: "§T2.S3 is the verbatim contract — the five cases (a)–(e), the temp-dir auth.json seeding via
        PI_CODING_AGENT_DIR/HOME, the 'mock registry.initializeProvider / configureHarnesses as the
        existing harness tests do' instruction, and the boundary vs T2.S1 (resolver) / T2.S2 (file-backed)."
  section: "T2 — Provider-Agnostic Authentication Model → T2.S3"

# MUST READ — every load-bearing empirical finding (resolver contract, AuthStorage reachability, the
# parallel-S2 node_modules churn, the devDep fallback, the 5-case → assertion map, validation commands)
- file: plan/007_8783a1f5e14a/P7M1T2S3/research/verified_facts.md
  why: "§1 the S1-shipped resolver+forwarding source contract; §2 the duplication boundary vs S1's
        auth-resolver.test.ts; §3 the groundswell mock+spy pattern; §4 AuthStorage reachability + the
        devDep-addition requirement/fallback; §5 vitest.config contract; §6 setup.ts env pollution +
        endpoint safeguard; §7 the 5 cases → concrete assertions; §8 validation commands; §9 scope
        boundaries; §10 naming/placement."
  section: "§1–§10 (read all)"

# MUST READ — the pi-side AuthStorage/ModelRegistry API surface (verbatim from node_modules .d.ts)
- file: plan/007_8783a1f5e14a/architecture/groundswell_auth_api.md
  why: "§2 AuthStorage.create(authPath?)/inMemory(data?) + the FileAuthStorageBackend default
        join(getAgentDir(),'auth.json') + getApiKey() priority (runtime→auth.json api_key→oauth→env→fallback)
        + MISSING-FILE tolerance + the async getApiKey() signature; §6 getAgentDir() = ~/.pi/agent
        overridable via PI_CODING_AGENT_DIR."
  section: "§2, §6"
  critical: "getApiKey(provider) is ASYNC (returns Promise<string|undefined>). AuthStorage.create() does NOT
             throw on a missing auth.json (reload() catches into loadError) — so a temp dir with no auth.json
             is safe. AuthStorageData = Record<string, AuthCredential>; ApiKeyCredential = {type:'api_key',
             key:string, env?}. The zai seed for case (c) is { zai: { type:'api_key', key:'auth-json-key' } }."

# MUST READ — the PRD requirement being satisfied (binding)
- file: PRD.md
  why: "§9.2.6 resolution order (override → provider env → auth.json), AUTH_TOKEN demotion, empty-string
        policy; §9.2.7 acceptance (auth.json-only succeeds; ZAI_API_KEY-only succeeds; AUTH_TOKEN succeeds
        only under anthropic). These five acceptance bullets ARE the five test cases."
  section: "9.2.6 (primary), 9.2.7 (acceptance bullets)"

# MUST READ — the S1 PRP (the INPUT contract; defines the resolver + ensureHarnessInitialized exactly)
- file: plan/007_8783a1f5e14a/P7M1T2S1/PRP.md
  why: "Defines resolveApiKeyForProvider priority + the 'forward only when non-empty' rule + the AUTH_TOKEN
        demotion + getResolvedProvider. T2.S3 consumes these EXACT exports."

# MUST READ — the S2 PRP (the parallel INPUT; defines the file-backed AuthStorage.create() default)
- file: plan/007_8783a1f5e14a/P7M1T2S2/PRP.md
  why: "Defines PiHarness.initialize() → AuthStorage.create() (file-backed, honors ~/.pi/agent/auth.json).
        T2.S3 assumes S2 is DONE (dist rebuilt + groundswell re-linked). Run S2's acceptance checks
        (npm run validate:groundswell + tests/unit/groundswell/imports.test.ts) BEFORE T2.S3 to confirm."

# MUST READ — the PATTERN to follow for the forwarding tests (groundswell mock + spy)
- file: tests/unit/config/harness-provider-compat.test.ts
  why: "The established vi.mock('groundswell', factory) pattern + how it injects a mock HarnessRegistry
        (getInstance → { has, register }) + mock PiHarness + mock configureHarnesses. T2.S3 EXTENDS this:
        the mock getInstance returns a spy initializeProvider so we can assert what hacky-hack forwards."
  pattern: "Module-level vi.mock('groundswell', () => ({ configureHarnesses: vi.fn(), HarnessRegistry:
            { getInstance: () => ({ has: () => false, register: vi.fn(), initializeProvider: vi.fn() }) },
            PiHarness: class MockPiHarness {} })). beforeEach: vi.clearAllMocks + delete/stub env vars.
            afterEach: vi.unstubAllEnvs."
  gotcha: "vi.mock is hoisted + module-scoped — it ONLY intercepts the exact specifier 'groundswell'. It does
           NOT affect '@earendil-works/pi-coding-agent' (a different module) → a REAL AuthStorage import
           coexists in the same file (used for case (c)). The mock factory runs BEFORE any import in the file."

# MUST READ — the PATTERN to follow for env stubbing + cleanup (vi.stubEnv / afterEach)
- file: tests/unit/config/environment.test.ts
  why: "The established vi.stubEnv('VAR','val') + delete process.env.X + afterEach(vi.unstubAllEnvs) pattern.
        Auth tests MUST clear ZAI_API_KEY/ANTHROPIC_API_KEY/ANTHROPIC_AUTH_TOKEN/ANTHROPIC_OAUTH_TOKEN/
        PRP_API_KEY/ANTHROPIC_DEFAULT_SONNET_MODEL in beforeEach because tests/setup.ts loads .env."

# REFERENCE — S1's existing resolver-unit test (the duplication boundary — DO NOT re-test the bare resolver)
- file: tests/unit/config/auth-resolver.test.ts
  why: "S1's coverage-sufficient resolver-unit tests (no groundswell mock, no auth.json, no forwarding).
        T2.S3 is a DIFFERENT file (auth-resolution.test.ts) testing the resolution ORDER end-to-end +
        auth.json-on-disk + forwarding-to-harness. Do NOT duplicate the bare-resolver assertions here; if a
        case is already covered by S1's unit tests, T2.S3 adds the FORWARDING-level assertion (what
        ensureHarnessInitialized passes to initializeProvider) — the end-to-end half S1 deliberately left out."

# REFERENCE — vitest config (the test harness contract)
- file: vitest.config.ts
  why: "resolve.alias.groundswell → ../groundswell/dist/index.js (the rebuilt dist); fs.allow: ['.','..'];
        coverage 100% on src/** (test files EXCLUDED → no coverage burden for this test-only task);
        setupFiles: ['./tests/setup.ts'] (loads .env + runs the endpoint safeguard beforeEach)."

# REFERENCE — the resolver under test (READ to confirm exact behavior before asserting against it)
- file: src/config/harness.ts
  why: "resolveApiKeyForProvider + ensureHarnessInitialized + the local getProviderEnvApiKey. Confirms the
        exact priority + the 'forward {apiKey} only when non-empty' rule + that AUTH_TOKEN is NOT directly
        read (only via configureEnvironment mapping)."
- file: src/config/environment.ts
  why: "getResolvedProvider + configureEnvironment (the AUTH_TOKEN→API_KEY mapping for anthropic only; the
        z.ai BASE_URL default for zai only)."
```

### Current Codebase tree (relevant slice)

```bash
src/config/
  harness.ts            # READ — resolveApiKeyForProvider (L78), ensureHarnessInitialized (L188), getProviderEnvApiKey
  environment.ts        # READ — getResolvedProvider (L47), configureEnvironment (L77, provider-conditional)
  constants.ts          # READ — PRP_API_KEY, DEFAULT_BASE_URL, DEFAULT_MODEL_PROVIDER
  endpoint-guard.ts     # READ — validateProviderEndpoint (§9.2.4 safeguard; runs in setup.ts beforeEach)
tests/
  setup.ts              # READ — dotenv.config() pollutes env; validateProviderEndpoint() runs beforeEach
  unit/config/
    auth-resolver.test.ts            # S1's resolver-unit file (the duplication boundary — DO NOT re-test the bare fn)
    auth-resolution.test.ts          # ← NEW (this task): the end-to-end 5-case resolution matrix
    environment.test.ts              # REFERENCE pattern (vi.stubEnv / afterEach)
    harness-provider-compat.test.ts  # REFERENCE pattern (vi.mock('groundswell') + spy registry)
    harness-config.test.ts           # existing — must stay green
    endpoint-guard.test.ts           # existing — must stay green
    harness.test.ts                  # existing (constants/types) — must stay green
vitest.config.ts         # READ — alias + coverage gate (test files excluded)
package.json             # ← CONDITIONAL EDIT (only if AuthStorage import fails to resolve): +devDep
plan/007_8783a1f5e14a/
  architecture/implementation_notes.md   # §T2.S3 — authoritative contract
  architecture/groundswell_auth_api.md   # §2/§6 — AuthStorage + getAgentDir/PI_CODING_AGENT_DIR
  P7M1T2S1/PRP.md + research/            # the INPUT resolver contract
  P7M1T2S2/PRP.md                        # the INPUT file-backed AuthStorage contract (parallel; assume done)
  P7M1T2S3/research/verified_facts.md    # every empirical finding
  P7M1T2S3/PRP.md                        # this file
```

### Desired Codebase tree with files added/changed

```bash
tests/unit/config/auth-resolution.test.ts   # NEW — the 5-case resolution-order matrix (resolver + forwarding + auth.json)
package.json                                # CONDITIONAL — +@earendil-works/pi-coding-agent devDep (ONLY if import fails to resolve)
# (NO src/ edits. NO doc edits. PRD.md, tasks.json, prd_snapshot.md, .gitignore — READ ONLY, never touch.)
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — T2.S2 is mutating node_modules IN PARALLEL right now (re-linking groundswell). At inspection
// node_modules/@earendil-works/ was EMPTY. T2.S3 MUST run AFTER S2 settles. FIRST, confirm S2 is done:
//   npm run validate:groundswell  AND  npx vitest run tests/unit/groundswell/imports.test.ts
// both pass, AND readlink -f node_modules/groundswell resolves to ~/projects/groundswell (symlink, not copy).
// The forwarding-level tests (mock groundswell) do NOT depend on S2's dist contents (they mock it away);
// only the case-(c) AuthStorage.create() test depends on pi-coding-agent being importable (see next gotcha).

// CRITICAL — Groundswell does NOT re-export AuthStorage (grep ../groundswell/dist/index.js → zero hits).
// AuthStorage lives in '@earendil-works/pi-coding-agent' (exports map "." → dist/index.js, import condition).
// It is NOT a declared dep of hacky-hack (package.json has only "groundswell":"^1.0.0"). Bare-node import()
// FAILS with ERR_MODULE_NOT_FOUND. FIX: add "@earendil-works/pi-coding-agent" to devDependencies (mirror S1's
// pi-ai precedent), check the nested version under node_modules/groundswell/node_modules/@earendil-works/
// pi-coding-agent/package.json AFTER S2's link settles, add a matching caret range, npm install. Vitest
// resolution (deps.interopDefault:true, esbuild) is more lenient than bare node → it resolves after install.
// VERIFY before writing case (c): node --input-type=module -e "import('@earendil-works/pi-coding-agent')
//   .then(m=>console.log(typeof m.AuthStorage?.create))"  → 'function'.
// FALLBACK if the dep CANNOT be added/imported: case (c) tests ONLY the hacky-hack half (resolver returns
// undefined + ensureHarnessInitialized forwards undefined) and cites T2.S2 (groundswell repo pi-harness-
// initialize.test.ts 'consults a seeded auth.json') + the S2 behavioral smoke for the file-backed proof.
// This still satisfies the hacky-hack-side acceptance; the pi-side is proven by S2.

// CRITICAL — vi.mock('groundswell') is module-level + HOISTED. It runs before any import in the file and
// ONLY intercepts the exact specifier 'groundswell'. The real '@earendil-works/pi-coding-agent' AuthStorage
// import is UNAFFECTED → it coexists in the same file (used by case (c)). Do NOT put the AuthStorage import
// behind a condition that depends on the mock; both work simultaneously.

// CRITICAL — The forwarding-level tests assert what ensureHarnessInitialized passes to initializeProvider.
// ensureHarnessInitialized does: registry = HarnessRegistry.getInstance(); if(!registry.has('pi'))
// registry.register(new PiHarness()); const apiKey = resolveApiKeyForProvider(getResolvedProvider());
// await registry.initializeProvider('pi', apiKey ? { apiKey } : undefined);
// So the mock getInstance MUST return ONE shared object across has/register/initializeProvider (so the spy
// persists). Build it in beforeEach: const initSpy = vi.fn(); const reg = { has: vi.fn(()=>false),
//   register: vi.fn(), initializeProvider: initSpy }; and have getInstance: () => reg.
// Assert: expect(initSpy).toHaveBeenCalledWith('pi', { apiKey: 'X' })  OR
//         expect(initSpy).toHaveBeenCalledWith('pi', undefined).

// CRITICAL — tests/setup.ts runs dotenv.config() → process.env is POLLUTED by the dev's .env at test start.
// EVERY auth test MUST clear (delete process.env.X or vi.stubEnv) in beforeEach for: ZAI_API_KEY,
// ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, ANTHROPIC_OAUTH_TOKEN, PRP_API_KEY, ANTHROPIC_DEFAULT_SONNET_MODEL.
// vi.unstubAllEnvs() (global afterEach) restores STUBBED vars but does NOT re-create .env vars you `delete`d
// — be explicit per test. Prefer vi.stubEnv (it tracks + restores) over raw delete where possible.

// CRITICAL — validateProviderEndpoint() (§9.2.4 safeguard) runs in setup.ts beforeEach. It THROWS if
// ANTHROPIC_BASE_URL === 'https://api.anthropic.com'; WARNS otherwise. NEVER set ANTHROPIC_BASE_URL to
// api.anthropic.com in these tests. For the anthropic-provider case (e), leave BASE_URL unset or set a safe
// mock (e.g. 'https://mock.local'). The existing auth-resolver tests leave it unset and pass.

// GOTCHA — getResolvedProvider() reads getModel('sonnet') which reads ANTHROPIC_DEFAULT_SONNET_MODEL. When
// unset → 'zai' (default). To get the 'anthropic' branch, vi.stubEnv('ANTHROPIC_DEFAULT_SONNET_MODEL',
// 'anthropic/claude-sonnet-4'). Set it BEFORE calling configureEnvironment()/resolveApiKeyForProvider().

// GOTCHA — ANTHROPIC_AUTH_TOKEN is NEVER directly read by resolveApiKeyForProvider (S1 uses a LOCAL
// getProviderEnvApiKey that reads ANTHROPIC_OAUTH_TOKEN ?? ANTHROPIC_API_KEY for anthropic). AUTH_TOKEN only
// reaches the resolver via configureEnvironment() mapping it → ANTHROPIC_API_KEY for the anthropic provider.
// So case (e)-anthropic MUST call configureEnvironment() first (after stubbing the model to anthropic/*),
// THEN resolveApiKeyForProvider('anthropic'). Case (e)-zai asserts configureEnvironment() does NOT map it.

// GOTCHA — AuthStorage.getApiKey(provider) is ASYNC (returns Promise<string|undefined>). Use `await`.
// AuthStorage.create() is missing-file tolerant (no throw when auth.json absent). The temp-dir auth.json
// seed is JSON.stringify({ zai: { type: 'api_key', key: 'auth-json-key' } }).

// GOTCHA — PI_CODING_AGENT_DIR must be set BEFORE AuthStorage.create() is constructed (getAgentDir() reads
// it at construction time). Use vi.stubEnv('PI_CODING_AGENT_DIR', tmpDir) in beforeEach of the case-(c)
// describe block; write ${tmpDir}/auth.json; then AuthStorage.create(). Clean up: vi.unstubAllEnvs() +
// rmSync(tmpDir) in afterEach. (Mirrors T2.S2's pi-harness-initialize.test.ts isolation approach.)

// GOTCHA — Do NOT duplicate S1's auth-resolver.test.ts bare-resolver assertions. T2.S3's value-add is the
// FORWARDING level (what ensureHarnessInitialized passes to the harness) + the auth.json-on-disk file-backed
// proof (case c). If a resolver-level assertion is already in S1's file, T2.S3 either omits it or frames it
// as the forwarding variant. The two files have DIFFERENT names + DIFFERENT scope by design.

// GOTCHA — coverage gate is 100% on src/** (vitest.config.ts). T2.S3 is a NEW test file → EXCLUDED from
// coverage (exclude: '**/*.test.ts'). It touches NO src/ file. → No coverage burden; the gate is auto-
// satisfied. Do NOT add src/ code to "boost coverage" — there is nothing to boost.

// GOTCHA — This task is TEST-ONLY. Do NOT edit src/**. Do NOT edit docs (Mode A docs rode with S1; the
// work-item DOCS clause says "none — test-only"). Do NOT touch the T3 preflight (T3.S2 owns preflight tests).
// Do NOT modify PRD.md, tasks.json, prd_snapshot.md, .gitignore (READ ONLY).
```

## Implementation Blueprint

### Data models and structure

No production data models. The test fixtures are small:

```ts
// ===== tests/unit/config/auth-resolution.test.ts (NEW) =====
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The mock intercepts ONLY 'groundswell' (the real AuthStorage import below is unaffected).
vi.mock('groundswell', () => {
  const initializeProvider = vi.fn();
  const registry = {
    has: vi.fn(() => false),
    register: vi.fn(),
    initializeProvider, // shared spy — asserted on per forwarding test
  };
  return {
    configureHarnesses: vi.fn(),
    HarnessRegistry: { getInstance: () => registry }, // stable object across has/register/init
    PiHarness: class MockPiHarness {},
  };
});

// These import the S1-shipped hacky-hack resolver + forwarding fns (real, not mocked).
import { resolveApiKeyForProvider, ensureHarnessInitialized } from '../../../src/config/harness.js';
import { configureEnvironment, getResolvedProvider } from '../../../src/config/environment.js';

// The real AuthStorage for case (c) (different module — NOT mocked by vi.mock('groundswell')).
// IF THIS IMPORT FAILS TO RESOLVE → see Gotchas: add "@earendil-works/pi-coding-agent" to devDependencies.
import { AuthStorage } from '@earendil-works/pi-coding-agent';

// Shared env-clearing helper: tests/setup.ts loads .env, so clear everything auth-related per test.
const AUTH_VARS = [
  'ZAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_OAUTH_TOKEN',
  'PRP_API_KEY',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
] as const;
function clearAuthEnv(): void {
  for (const v of AUTH_VARS) delete process.env[v];
}
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: CONFIRM S2 is settled (T2.S3 depends on the parallel T2.S2 dist)
  - RUN: cd ~/projects/hacky-hack && npm run validate:groundswell
  - RUN: npx vitest run tests/unit/groundswell/imports.test.ts
  - RUN: readlink -f node_modules/groundswell   # expect → /home/dustin/projects/groundswell (symlink)
  - EXPECT: all pass + symlink confirmed. If NOT, S2 is not settled — coordinate / wait before T2.S3.
  - WHY: case (c) (AuthStorage.create file-backed) depends on S2's rebuilt+relinked dist. The forwarding
         tests (mock groundswell) do NOT depend on S2's dist contents; they work regardless.
  - DEPENDENCY: T2.S2 complete (external).

Task 1: VERIFY the AuthStorage import resolves (gate the conditional devDep)
  - RUN: node --input-type=module -e "import('@earendil-works/pi-coding-agent').then(m=>console.log(typeof m.AuthStorage?.create, typeof m.AuthStorage?.inMemory)).catch(e=>console.log('FAIL',e.code))"
  - IF 'function function' → AuthStorage is importable; SKIP Task 1b (no devDep needed).
  - IF FAIL (ERR_MODULE_NOT_FOUND / ERR_PACKAGE_PATH_NOT_EXPORTED) → Task 1b: add the devDep.
  - Task 1b (CONDITIONAL): edit package.json devDependencies → add "@earendil-works/pi-coding-agent":
    "^<version>" where <version> = the nested copy's version
    (cat node_modules/groundswell/node_modules/@earendil-works/pi-coding-agent/package.json | grep version).
    Then npm install. RE-RUN the verify command → expect 'function function'.
  - WHY: groundswell does NOT re-export AuthStorage; pi-coding-agent is not a declared dep. This mirrors
         S1's @earendil-works/pi-ai addition (verified_facts.md §4).
  - DEPENDENCY: Task 0.

Task 2: CREATE tests/unit/config/auth-resolution.test.ts — shared scaffolding
  - ADD the imports + vi.mock('groundswell', …) + AUTH_VARS clearAuthEnv() helper (see Data models above).
  - ADD a top-level beforeEach(() => { clearAuthEnv(); }) and afterEach(() => { vi.unstubAllEnvs(); clearAuthEnv(); })
    so EVERY test starts clean (setup.ts loads .env). NOTE: vi.clearAllMocks() already runs globally (setup.ts).
  - VERIFY: `npx vitest run tests/unit/config/auth-resolution.test.ts` runs (0 tests yet is fine — no failure).
  - DEPENDENCY: Task 1.

Task 3: describe('auth resolution order — resolver level')  [cases a, b, d, e at the resolver]
  - it('(a) explicit override wins over provider env') — stub ZAI_API_KEY='zai' + PRP_API_KEY unset;
    expect(resolveApiKeyForProvider('zai', { override: 'override-x' })).toBe('override-x').
    PLUS: stub PRP_API_KEY='env-override' + ZAI_API_KEY='zai'; expect(resolveApiKeyForProvider('zai')).toBe('env-override').
  - it('(b) ZAI_API_KEY returned for zai when no override (no Anthropic var required)') — stub ZAI_API_KEY='zai-key';
    expect(resolveApiKeyForProvider('zai')).toBe('zai-key').
  - it('(d) whitespace-only ZAI_API_KEY treated as not configured') — stub ZAI_API_KEY='   '; expect(...).toBeUndefined().
    PLUS whitespace-only PRP_API_KEY + ZAI set → falls through to ZAI value.
  - it('(e-zai) ANTHROPIC_AUTH_TOKEN NOT consulted for zai') — stub ANTHROPIC_AUTH_TOKEN='token' (no ZAI);
    expect(resolveApiKeyForProvider('zai')).toBeUndefined().
  - NOTE: do NOT duplicate S1's exhaustive resolver cases — keep these as the resolution-ORDER witnesses
    that the forwarding tests (Task 4) build on. If S1 already covers a bare assertion, T2.S3 adds the
    FORWARDING variant only (Task 4) to avoid duplication.
  - DEPENDENCY: Task 2.

Task 4: describe('auth resolution order — what is forwarded to the harness')  [cases a–e end-to-end]
  - PATTERN: each test stubs env, then `await ensureHarnessInitialized();` then asserts the spy:
    const initSpy = (await import('groundswell')).HarnessRegistry.getInstance().initializeProvider as ReturnType<typeof vi.fn>;
    expect(initSpy).toHaveBeenCalledWith('pi', { apiKey: '<val>' })   // OR ('pi', undefined).
    (Re-fetch the spy per test from the mocked getInstance — it's the same shared object; vi.clearAllMocks
     runs in global beforeEach so call history is clean.)
  - it('(a) override forwarded') — stub ZAI + PRP_API_KEY='override'; await ensureHarnessInitialized();
    expect(initSpy).toHaveBeenCalledWith('pi', { apiKey: 'override' }).
  - it('(b) ZAI_API_KEY forwarded') — stub ZAI_API_KEY='zai-key'; await ensureHarnessInitialized();
    expect(initSpy).toHaveBeenCalledWith('pi', { apiKey: 'zai-key' }).
  - it('(c) auth.json-only forwards undefined (defer to pi)') — NO env set; await ensureHarnessInitialized();
    expect(initSpy).toHaveBeenCalledWith('pi', undefined).  // NOT { apiKey: '' } — proves the empty-string fix
  - it('(d) whitespace-only forwards undefined') — stub ZAI_API_KEY='   '; await ensureHarnessInitialized();
    expect(initSpy).toHaveBeenCalledWith('pi', undefined).
  - it('(e-zai) ANTHROPIC_AUTH_TOKEN NOT forwarded under default zai') — stub ANTHROPIC_AUTH_TOKEN='token'
    (default provider zai); await ensureHarnessInitialized(); expect(initSpy).toHaveBeenCalledWith('pi', undefined).
  - it('(e-anthropic) ANTHROPIC_AUTH_TOKEN forwarded ONLY under anthropic provider') —
    stub ANTHROPIC_DEFAULT_SONNET_MODEL='anthropic/claude-sonnet-4' + ANTHROPIC_AUTH_TOKEN='token';
    configureEnvironment();  // maps AUTH_TOKEN→API_KEY for anthropic
    expect(getResolvedProvider()).toBe('anthropic');
    await ensureHarnessInitialized();
    expect(initSpy).toHaveBeenCalledWith('pi', { apiKey: 'token' }).
    (NOTE: do NOT set ANTHROPIC_BASE_URL to api.anthropic.com — the §9.2.4 safeguard throws. Leave unset.)
  - DEPENDENCY: Task 3.

Task 5: describe('auth.json — file-backed resolution (PRD §9.2.6 / T2.S2)')  [case c pi-side proof]
  - This describe block has its OWN beforeEach/afterEach for temp-dir isolation (does NOT share the
    resolver-level clearAuthEnv beforeEach ordering — set it up carefully):
      let tmpAgentDir: string;
      beforeEach(() => { clearAuthEnv(); tmpAgentDir = mkdtempSync(join(tmpdir(), 'auth-res-'));
        vi.stubEnv('PI_CODING_AGENT_DIR', tmpAgentDir); });
      afterEach(() => { vi.unstubAllEnvs(); rmSync(tmpAgentDir, { recursive: true, force: true }); });
  - it('(c) AuthStorage.create() resolves a seeded auth.json (no env vars)') —
    writeFileSync(join(tmpAgentDir, 'auth.json'), JSON.stringify({ zai: { type: 'api_key', key: 'auth-json-key' } }));
    const auth = AuthStorage.create();   // reads ${PI_CODING_AGENT_DIR}/auth.json
    expect(await auth.getApiKey('zai')).toBe('auth-json-key');   // ASYNC — proves file-backed read (T2.S2 contract)
  - it('(c) missing auth.json is tolerated (no throw, no key)') — ensure auth.json absent in tmpAgentDir;
    const auth = AuthStorage.create(); await expect(auth.getApiKey('zai')).resolves.toBeUndefined();
  - OPTIONAL (the inMemory variant the work item lists as the "OR"): it('AuthStorage.inMemory seed resolves') —
    const auth = AuthStorage.inMemory({ zai: { type: 'api_key', key: 'mem-key' } });
    expect(await auth.getApiKey('zai')).toBe('mem-key').
  - IF Task 1 devDep was NOT added AND the AuthStorage import fails: SKIP this describe block entirely and
    rely on Task 4's (c) forwarding assertion + a code comment citing T2.S2's groundswell-side test for the
    file-backed proof. (The hacky-hack-side acceptance — forwards undefined — is still proven.)
  - DEPENDENCY: Tasks 1–4.

Task 6: VALIDATE (the full gate + the config suite in isolation)
  - RUN: npx vitest run tests/unit/config/auth-resolution.test.ts   # the new file alone
  - RUN: npx vitest run tests/unit/config/                            # all config tests green (existing + new)
  - RUN: npm run validate   # lint + format:check + typecheck + test:run (full suite)
  - RUN: npm run test:coverage   # confirm 100% gate still satisfied (no src/ touched → automatic)
  - RUN (acceptance greps): see Validation Loop Level 3.
  - DEPENDENCY: Task 5.
```

### Implementation Patterns & Key Details

```ts
// ── The shared spy registry (forwarding tests assert on initSpy) ───────────────────────────
// vi.mock factory returns a stable registry object; getInstance() returns the SAME object each call.
vi.mock('groundswell', () => {
  const initializeProvider = vi.fn();
  const registry = { has: vi.fn(() => false), register: vi.fn(), initializeProvider };
  return {
    configureHarnesses: vi.fn(),
    HarnessRegistry: { getInstance: () => registry },
    PiHarness: class MockPiHarness {},
  };
});
// In a test:
import { ensureHarnessInitialized } from '../../../src/config/harness.js';
import { HarnessRegistry } from 'groundswell';   // the MOCKED export
it('(b) ZAI_API_KEY forwarded', async () => {
  vi.stubEnv('ZAI_API_KEY', 'zai-key');
  await ensureHarnessInitialized();
  const initSpy = HarnessRegistry.getInstance().initializeProvider;
  expect(initSpy).toHaveBeenCalledWith('pi', { apiKey: 'zai-key' });
});

// ── Case (e)-anthropic: configureEnvironment maps AUTH_TOKEN→API_KEY, then the resolver sees it ──
it('(e-anthropic) AUTH_TOKEN forwarded only under anthropic', async () => {
  vi.stubEnv('ANTHROPIC_DEFAULT_SONNET_MODEL', 'anthropic/claude-sonnet-4');
  vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'token');
  configureEnvironment();                                      // provider-conditional map (S1)
  expect(getResolvedProvider()).toBe('anthropic');
  expect(process.env.ANTHROPIC_API_KEY).toBe('token');         // proves the map ran
  await ensureHarnessInitialized();
  const initSpy = HarnessRegistry.getInstance().initializeProvider;
  expect(initSpy).toHaveBeenCalledWith('pi', { apiKey: 'token' });
});

// ── Case (c) file-backed: seed temp PI_CODING_AGENT_DIR/auth.json ──────────────────────────
it('(c) AuthStorage.create() resolves a seeded auth.json', async () => {
  writeFileSync(join(tmpAgentDir, 'auth.json'),
    JSON.stringify({ zai: { type: 'api_key', key: 'auth-json-key' } }));
  const auth = AuthStorage.create();                  // file-backed; reads PI_CODING_AGENT_DIR/auth.json
  expect(await auth.getApiKey('zai')).toBe('auth-json-key');   // ASYNC; proves pi-side resolution (T2.S2)
});
```

### Integration Points

```yaml
TESTS (NEW):
  - CREATE tests/unit/config/auth-resolution.test.ts (the 5-case matrix: resolver + forwarding + auth.json).

DEPENDENCY (CONDITIONAL — only if AuthStorage import fails to resolve):
  - package.json devDependencies: ADD "@earendil-works/pi-coding-agent": "^<nested-version>" + npm install.

NO CHANGES TO:
  src/**                                   (test-only; resolver/forwarding already shipped by S1)
  tests/unit/config/auth-resolver.test.ts  (S1's resolver-unit file — the duplication boundary; leave as-is)
  any other tests/unit/config/*.test.ts     (must stay green — they are unaffected)
  docs/**, .env.example                     (Mode A docs rode with S1; work-item DOCS clause = "none")
  ~/projects/groundswell/**                 (S2 owns the groundswell repo; T2.S3 consumes the rebuilt dist)
  PRD.md, tasks.json, prd_snapshot.md, .gitignore   (READ ONLY — never touch)
```

## Validation Loop

> Run after the relevant task group. Fix before proceeding to the next level. All commands run in
> `~/projects/hacky-hack` unless noted. T2.S3 is test-only — there is no build step.

### Level 0: Pre-flight (confirm the parallel T2.S2 is settled — Task 0)

```bash
cd ~/projects/hacky-hack
npm run validate:groundswell
# Expected: ✓ all named exports accessible (confirms S2's rebuilt dist imports cleanly).

npx vitest run tests/unit/groundswell/imports.test.ts
# Expected: RUNNING GROUNDSWELL IMPORT TESTS … all pass.

readlink -f node_modules/groundswell
# Expected: /home/dustin/projects/groundswell (symlink to source tree — confirms S2 re-linked).
```
Expected: all pass + symlink confirmed. If `node_modules/groundswell` is still a COPY (not a symlink) or the
imports test fails, S2 is not settled — do not proceed with case (c) until it is (forwarding tests still work).

### Level 1: Import-resolution gate (Task 1)

```bash
cd ~/projects/hacky-hack
node --input-type=module -e "import('@earendil-works/pi-coding-agent').then(m=>console.log(typeof m.AuthStorage?.create, typeof m.AuthStorage?.inMemory)).catch(e=>console.log('FAIL',e.code))"
# Expected: 'function function'. If 'FAIL ERR_MODULE_NOT_FOUND' → add the devDep (Task 1b) + npm install,
# then re-run until 'function function'.
```

### Level 2: Unit tests (after Tasks 2–5)

```bash
cd ~/projects/hacky-hack

# The new file alone (fast iteration).
npx vitest run tests/unit/config/auth-resolution.test.ts
# Expected: all 5 cases pass (resolver + forwarding + auth.json describe blocks).

# The full config suite — confirms existing config tests are unaffected (the work-item "existing config
# tests still green" acceptance).
npx vitest run tests/unit/config/
# Expected: all green — auth-resolver.test.ts, environment.test.ts, harness-config.test.ts,
#           harness-provider-compat.test.ts, endpoint-guard.test.ts, harness.test.ts + the new file.

# Full suite + 100% coverage gate.
npm run validate          # lint + format:check + typecheck + test:run
npm run test:coverage     # 100% on src/** — automatic (no src/ touched); just confirm no regression.
# Expected: all pass; coverage 100% statements/branches/functions/lines on src/**.
```

### Level 3: Acceptance greps (the 5-case + boundary invariants)

```bash
cd ~/projects/hacky-hack
# The new file exists + uses the groundswell mock+spy pattern + the real AuthStorage import.
rg -n "vi\.mock\('groundswell'" tests/unit/config/auth-resolution.test.ts   # ≥1 hit
rg -n "initializeProvider" tests/unit/config/auth-resolution.test.ts        # ≥1 hit (the spy assertions)
rg -n "AuthStorage\.create\(\)" tests/unit/config/auth-resolution.test.ts   # ≥1 hit (case c) — IF Task 1 devDep added
rg -n "PI_CODING_AGENT_DIR" tests/unit/config/auth-resolution.test.ts       # ≥1 hit (case c temp-dir isolation)

# The 5 cases are all present (by their distinguishing assertions).
rg -n "override|ZAI_API_KEY|auth\.json|whitespace|ANTHROPIC_AUTH_TOKEN" tests/unit/config/auth-resolution.test.ts
# Expected: hits for all five distinguishing concepts.

# S1's resolver-unit file is UNCHANGED (no duplication / no edit).
git diff --stat tests/unit/config/auth-resolver.test.ts    # Expected: (no changes) — the duplication boundary holds.

# No src/ file was edited by T2.S3.
git diff --stat src/                                       # Expected: (no changes).
# Expected: all greps return the stated results.
```

### Level 4: Behavioral spot-checks (optional — the resolver is already S1-validated)

```bash
# Quick confirmation the resolver behaves as the tests assert (re-uses S1's smoke commands).
cd ~/projects/hacky-hack
ZAI_API_KEY=zai-smoke npx tsx -e "import('./src/config/harness.js').then(m=>console.log(m.resolveApiKeyForProvider('zai')))"
# Expected: zai-smoke
ZAI_API_KEY='   ' npx tsx -e "import('./src/config/harness.js').then(m=>console.log(String(m.resolveApiKeyForProvider('zai'))))"
# Expected: undefined
# Expected: each prints the stated value (sanity; the authoritative matrix is Level 2).
```

## Final Validation Checklist

### Technical Validation
- [ ] Level 0: `npm run validate:groundswell` + `tests/unit/groundswell/imports.test.ts` pass; groundswell is a
      symlink to the source tree (S2 settled).
- [ ] Level 1: `import('@earendil-works/pi-coding-agent')` resolves AuthStorage (`create`+`inMemory` = functions),
      OR the devDep was added + installed to make it so.
- [ ] Level 2: `npx vitest run tests/unit/config/auth-resolution.test.ts` passes (all 5 cases);
      `npx vitest run tests/unit/config/` fully green (existing + new); `npm run validate` passes;
      `npm run test:coverage` shows 100% on src/** (no src/ touched).
- [ ] Level 3: acceptance greps return the stated results; `git diff --stat src/` shows no changes;
      `git diff --stat tests/unit/config/auth-resolver.test.ts` shows no changes.

### Feature Validation (PRD §9.2.6 + §9.2.7 + work-item OUTPUT)
- [ ] Case (a): explicit override (options.override OR PRP_API_KEY) wins; forwarded `{apiKey: override}`.
- [ ] Case (b): ZAI_API_KEY-only → forwarded `{apiKey: <zai>}` (no Anthropic var required).
- [ ] Case (c): auth.json-only → forwarded `undefined` (defer) AND `AuthStorage.create().getApiKey('zai')`
      resolves the seeded temp-dir auth.json key (or, fallback: hacky-hack-side forwarding proven + T2.S2 cited).
- [ ] Case (d): whitespace-only → `undefined`; forwarded `undefined` (NOT `{apiKey: ''}`).
- [ ] Case (e): ANTHROPIC_AUTH_TOKEN forwarded `{apiKey: token}` ONLY under the `anthropic` provider; under
      `zai` it is NOT consulted (forwarded `undefined`).
- [ ] No network/LLM calls (groundswell mocked; AuthStorage is pure file/env).
- [ ] No test reads the developer's real `~/.pi/agent/auth.json` (temp `PI_CODING_AGENT_DIR` isolation).

### Code Quality Validation
- [ ] The new file follows `harness-provider-compat.test.ts` (mock+spy) + `environment.test.ts` (vi.stubEnv/
      afterEach cleanup) patterns exactly.
- [ ] The new file does NOT duplicate S1's `auth-resolver.test.ts` bare-resolver assertions (different name,
      different scope — forwarding + auth.json-on-disk are T2.S3's value-add).
- [ ] Auth-related env vars are cleared in beforeEach (setup.ts loads .env).
- [ ] No `ANTHROPIC_BASE_URL='https://api.anthropic.com'` anywhere (the §9.2.4 safeguard).
- [ ] `AuthStorage.getApiKey()` is awaited (it is async).

### Documentation & Scope
- [ ] NO src/ edits. NO doc edits (Mode A rode with S1; work-item DOCS = "none — test-only").
- [ ] The ONLY non-test file possibly touched is `package.json` (conditional devDep) — and only if the
      AuthStorage import required it.
- [ ] PRD.md, tasks.json, prd_snapshot.md, .gitignore untouched (READ ONLY).

---

## Anti-Patterns to Avoid

- ❌ Don't run T2.S3 case (c) before confirming T2.S2 settled — S2 is mutating `node_modules` in parallel;
      run `npm run validate:groundswell` + `tests/unit/groundswell/imports.test.ts` + `readlink -f
      node_modules/groundswell` first. (The forwarding tests are independent of S2's dist; case (c) is not.)
- ❌ Don't try `import { AuthStorage } from 'groundswell'` — groundswell does NOT re-export it (verified).
      Use `from '@earendil-works/pi-coding-agent'`, and add it as a devDep if the import doesn't resolve
      (mirrors S1's pi-ai precedent). If you can't add it, fall back to the hacky-hack-only forwarding
      assertion for case (c) and cite T2.S2 for the file-backed proof — do NOT silently drop case (c).
- ❌ Don't duplicate S1's `auth-resolver.test.ts`. T2.S3 is a DIFFERENT file (`auth-resolution.test.ts`)
      testing the resolution ORDER end-to-end (forwarding to the harness) + auth.json-on-disk. If a
      bare-resolver assertion already exists in S1's file, add only the FORWARDING variant here.
- ❌ Don't let the `vi.mock('groundswell')` factory return a FRESH registry object per `getInstance()` call —
      `ensureHarnessInitialized` calls `has`/`register`/`initializeProvider` on the SAME instance; the spy
      must persist. Build ONE shared registry object in the factory.
- ❌ Don't forget that `vi.mock` is hoisted + module-scoped — it ONLY intercepts `'groundswell'`. The real
      `AuthStorage` import from `'@earendil-works/pi-coding-agent'` is unaffected and coexists. Do not try to
      mock AuthStorage (it's the real file-backed resolution you're PROVING in case (c)).
- ❌ Don't forget to clear auth env vars in beforeEach — `tests/setup.ts` runs `dotenv.config()`, polluting
      `process.env` with the dev's `.env`. Clear ZAI_API_KEY/ANTHROPIC_API_KEY/ANTHROPIC_AUTH_TOKEN/
      ANTHROPIC_OAUTH_TOKEN/PRP_API_KEY/ANTHROPIC_DEFAULT_SONNET_MODEL every test.
- ❌ Don't set `ANTHROPIC_BASE_URL='https://api.anthropic.com'` — `validateProviderEndpoint()` (§9.2.4) runs
      in setup.ts beforeEach and THROWS. Leave BASE_URL unset for the anthropic case (or use a safe mock).
- ❌ Don't forget to `await` `AuthStorage.getApiKey()` — it returns a `Promise<string|undefined>`.
- ❌ Don't set `ANTHROPIC_DEFAULT_SONNET_MODEL='anthropic/*'` and then forget to call `configureEnvironment()`
      in the case-(e)-anthropic test — AUTH_TOKEN only reaches the resolver via that provider-conditional map.
- ❌ Don't add src/ code or docs — T2.S3 is test-only (the resolver + configureEnvironment + forwarding are
      already shipped by S1; Mode A docs rode with S1). The only non-test edit allowed is the conditional devDep.
- ❌ Don't modify PRD.md, tasks.json, prd_snapshot.md, or .gitignore (READ-ONLY).
- ❌ Don't test the T3 preflight here — that's T3.S2's scope. T2.S3 tests the RESOLUTION ORDER only.

---

## Confidence Score

**9/10** — one-pass implementation success likelihood. The resolver + forwarding contract is fully shipped
(S1, quoted verbatim) and the two test patterns to follow (`harness-provider-compat.test.ts` mock+spy;
`environment.test.ts` env stubbing) are established and cited. The 5 cases map to concrete assertions. The
single residual risk is the conditional devDep addition for the AuthStorage import (case c) — which is gated
on a one-line verification command with a documented fallback (hacky-hack-only forwarding + cite T2.S2) that
still satisfies the hacky-hack-side acceptance. Coverage is a non-issue (test files are excluded; no src/ is
touched). The parallel-S2 coordination is handled by an explicit Level-0 pre-flight gate.
