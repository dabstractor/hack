# PRP — P1.M1.T1.S1: Non-mocked `PiHarness` auth.json integration test (TDD RED step)

> Bugfix subtask for **Issue 1** of
> `plan/007_8783a1f5e14a/bugfix/001_7912d248208a/TEST_RESULTS.md`. The deployed
> `node_modules/groundswell` dist still uses `AuthStorage.inMemory()` and ignores
> `~/.pi/agent/auth.json`, so the documented `pi /login` (auth.json-only) flow dies at the
> first LLM call with a misleading "No API key found for zai".

---

## ⚠️ STOP — READ THIS BEFORE WRITING THE TEST ⚠️

The contract asks for "a vitest test file that **FAILS** against the current stale dist".
**An in-process vitest assertion CANNOT fail here.** Verified (see
`research/alias-conflict-and-subprocess-approach.md`):

`vitest.config.ts` sets `resolve.alias.groundswell` → the **sibling checkout**
`/home/dustin/projects/groundswell/dist/index.js`, which is the **FIXED** dist
(`AuthStorage.create()`, line 103). Meanwhile `node_modules/groundswell` is the **STALE**
dist (`AuthStorage.inMemory()`, line 95). Probe run under vitest:

```json
{ "aliasTarget": "/home/dustin/projects/groundswell/dist/index.js",
  "siblingUsesCreate": true, "nodeModsUsesInMemory": true }
```

So under vitest, EVERY `import 'groundswell'` — including the internal import inside
`ensureHarnessInitialized()` (`src/config/harness.ts`) — loads the **FIXED** dist. An
in-process `await harness.authStorage.getApiKey('zai')` would return the seeded key and
**PASS (GREEN)**, never RED. The bug only manifests at runtime (tsx/node, no alias) — which
is exactly why the PRD Issue-1 reproduction script uses `npx tsx`, not vitest.

**Therefore this PRP prescribes a vitest test that spawns a `tsx` SUBPROCESS** (the
subprocess does not inherit vitest's resolve alias → its `import 'groundswell'` resolves to
the real `node_modules/groundswell` STALE dist). This is the ONLY mechanism that faithfully
reproduces the bug through the real `ensureHarnessInitialized()` path AND produces a genuine
RED that turns GREEN after P1.M1.T2 deploys the fix. It mirrors the existing repo pattern
(`tests/unit/config/auth-preflight.test.ts:258` uses `spawnSync(process.execPath, [CLI, …])`
to touch the real dist).

This deviation from the contract's implied in-process mechanism is **mandatory and
justified**. Do not attempt an in-process `await` assertion — it will silently pass and
provide no regression signal (the exact blind spot that let Issue 1 ship).

---

## Goal

**Feature Goal**: Add a **non-mocked** integration test that proves the deployed
`node_modules/groundswell` `PiHarness` resolves a `zai` credential from an on-disk
`auth.json` (the `pi /login` flow). The test is the **TDD RED step**: it FAILS today
(getApiKey returns `undefined`) and turns GREEN when P1.M1.T2 deploys the file-backed
`AuthStorage.create()` fix.

**Deliverable**: `tests/integration/config/pi-harness-auth.test.ts` — a vitest test file
containing two cases that spawn a `tsx` runner exercising the REAL `node_modules/groundswell`
`PiHarness`:
1. **Case A (auth.json-only)** → asserts `getApiKey('zai') === 'SECRET-FROM-AUTH-JSON'`
   (RED now: returns `undefined`; GREEN after fix).
2. **Case B (ZAI_API_KEY-only control)** → asserts `getApiKey('zai') === 'SECRET-FROM-ENV'`
   (passes even on the stale dist, proving the bug is specific to auth.json).

**Success Definition**:
- Running `npx vitest run tests/integration/config/pi-harness-auth.test.ts` today yields:
  Case A **failed** (RED — `getApiKey` returned `undefined`), Case B **passed**.
- After P1.M1.T2 deploys the fixed Groundswell dist, the SAME command yields both passing.
- No `vi.mock('groundswell')` and no `vi.mock('@earendil-works/pi-coding-agent')` anywhere
  in the file (the real deployed dist must run).
- The test leaves no artifacts behind (temp dirs and the runner script are cleaned up).

---

## Why

- **Closes the verification blind spot that let Issue 1 ship.** Every existing auth test
  `vi.mock('groundswell')` (`auth_resolution_blindspot.md` §"Why No Test Caught This" —
  4 of 5 files). None exercise the real `node_modules/groundswell` `PiHarness`, so all 26
  auth tests passed while the runtime was broken. This test is the first to touch the real
  deployed dist's auth path.
- **Gates the fix (P1.M1.T2) with a real RED→GREEN signal.** TDD requires a failing test
  before the fix. Without it, "deploy the Groundswell fix" cannot be verified to actually
  change runtime behavior.
- **Honors PRD §9.2.7 acceptance** ("A run authenticated via `~/.pi/agent/auth.json` alone
  succeeds under the `pi` + `zai` default") at the integration level, not just the
  mocked-unit level.
- **Scope discipline.** This is **S1 = the RED test only**. Deploying the Groundswell fix is
  P1.M1.T2; hardening `validate-groundswell.ts` is P1.M1.T3. This subtask changes NO source
  and NO config — it only adds a test file.

---

## What

### User-visible behavior
None (test-only, Mode A — no user/config/API surface change). The only observable effect is
that `npx vitest run tests/integration/config/pi-harness-auth.test.ts` reports Case A as
failing today and passing after P1.M1.T2.

### Technical requirements (exact contract, adapted to the verified mechanism)

**File:** `tests/integration/config/pi-harness-auth.test.ts` (NEW).

**Mechanism — subprocess (MANDATORY; see the STOP block above):**
- A vitest `describe`/`it` test that, per case, writes a small runner script to the **project
  root** (e.g. `_pi-harness-auth-runner.mjs`) and invokes it via
  `spawnSync('<repo>/node_modules/.bin/tsx', ['_pi-harness-auth-runner.mjs'], { env, encoding: 'utf8' })`.
  The runner MUST live inside the project tree so its bare `import 'groundswell'` resolves to
  `node_modules/groundswell` (stale), and `import './src/config/harness.ts'` resolves to the
  repo source.
- The runner prints a single machine-parseable line: `RESULT key=<JSON>` (or
  `RESULT ERROR=<msg>`). The test parses `stdout` and asserts the value.

**The runner script (`_pi-harness-auth-runner.mjs`, written by the test):**
```js
// Top-level await is legal in .mjs. NO mocking of any kind.
try {
  const { ensureHarnessInitialized } = await import('./src/config/harness.ts');
  const { HarnessRegistry } = await import('groundswell');       // resolves to node_modules/groundswell in the subprocess
  await ensureHarnessInitialized();
  const h = HarnessRegistry.getInstance().get('pi');
  const key = await h?.authStorage?.getApiKey('zai');            // async; nullable authStorage guarded with ?.
  process.stdout.write('RESULT key=' + JSON.stringify(key));
} catch (e) {
  process.stdout.write('RESULT ERROR=' + (e?.message ?? String(e)));
} finally {
  try { await HarnessRegistry.getInstance()?.get('pi')?.terminate?.(); } catch {}
}
```

**Test structure (both cases):**
1. Clear ALL auth env vars in the spawn `env`: `ZAI_API_KEY`, `PRP_API_KEY`,
   `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_OAUTH_TOKEN`, `PRP_AGENT_HARNESS`
   (build `env` from a filtered copy of `process.env`).
2. Create a temp dir via `mkdtempSync(join(tmpdir(), 'pi-auth-'))` and set
   `PI_CODING_AGENT_DIR` to it in the spawn `env`.
3. Case A: write `auth.json` = `{ zai: { type: 'api_key', key: 'SECRET-FROM-AUTH-JSON' } }`.
   Case B: write NO auth.json; instead set `ZAI_API_KEY='SECRET-FROM-ENV'` in the spawn `env`.
4. `spawnSync(tsx, [runnerPath], { env, encoding })`; parse `RESULT key=…` from `stdout`.
5. Assert: Case A → `key === 'SECRET-FROM-AUTH-JSON'`; Case B → `key === 'SECRET-FROM-ENV'`.
6. Cleanup (`afterEach`/finally): `rmSync(tmpDir, { recursive: true, force: true })` and
   `unlinkSync(runnerPath)` (guard with try/catch).

**Forbidden in this file:**
- `vi.mock('groundswell', …)` — would defeat the entire purpose.
- `vi.mock('@earendil-works/pi-coding-agent', …)` — would short-circuit the SDK import inside
  `PiHarness.initialize()`.
- Importing `ensureHarnessInitialized` / `HarnessRegistry` **in-process** for assertion — that
  path is aliased to the FIXED dist and would never RED. All assertion logic runs in the
  subprocess via stdout parsing.

### Success Criteria
- [ ] `tests/integration/config/pi-harness-auth.test.ts` exists with two `it` cases (A and B).
- [ ] No `vi.mock('groundswell')`, no `vi.mock('@earendil-works/pi-coding-agent')` in the file.
- [ ] `npx vitest run tests/integration/config/pi-harness-auth.test.ts` → **Case A FAILS**
      today (asserted `'SECRET-FROM-AUTH-JSON'`, received `undefined`), **Case B PASSES**.
- [ ] The test cleans up its temp dir and the `_pi-harness-auth-runner.mjs` script.
- [ ] No `src/` or config file is modified.

---

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed to implement
this successfully?_ **Yes** — the exact mechanism (subprocess), the exact runner source, the
exact two cases with verified expected values (RED `undefined` / control `'SECRET-FROM-ENV'`),
the exact env vars to clear, the exact spawn invocation, and the verified reason an in-process
approach is impossible are all specified below. No judgement calls remain.

### Documentation & References

```yaml
# MUST READ — the blind-spot analysis + the exact test design
- docfile: plan/007_8783a1f5e14a/bugfix/001_7912d248208a/architecture/auth_resolution_blindspot.md
  section: "What the New Integration Test Must Do" and "Isolation Gotchas"
  why: Explains WHY every existing auth test misses this (they vi.mock groundswell) and the
        exact non-mocked test design. NOTE its in-process suggestion is overridden by this PRP's
        STOP block (the vitest alias makes in-process RED impossible — use the subprocess here).
  critical: The blindspot doc lists isolation worries (singleton leak, has('pi') pollution).
        The SUBPROCESS approach eliminates ALL of them (fresh process per run).

# MUST READ — why in-process is impossible + verified ground truth (authored with this PRP)
- docfile: plan/007_8783a1f5e14a/bugfix/001_7912d248208a/P1M1T1S1/research/alias-conflict-and-subprocess-approach.md
  section: "0. CRITICAL: in-process vitest CANNOT produce a RED here" and "2. Ground-truth results"
  why: Proof of the alias conflict and the verified Case A (undefined) / Case B (SECRET-FROM-ENV)
        values run via tsx against the real stale dist.

# PATTERN FILE — the existing subprocess/dist-touching test (mirror its spawnSync usage)
- file: tests/unit/config/auth-preflight.test.ts
  why: Line 19 `import { spawnSync } from 'node:child_process'`; line 235 `const CLI = resolve(process.cwd(), 'dist/index.js')`;
        line 258 `spawnSync(process.execPath, [CLI, '--prd', prdAbs], { env, encoding })`. Copy this
        spawn/env/encoding shape; replace the CLI invocation with `node_modules/.bin/tsx <runner>`.
  pattern: "spawnSync(binPath, [args], { env, encoding: 'utf8' }); parse child.stdout"
  gotcha: The subprocess does NOT inherit vitest's resolve.alias — that is precisely why it hits
        node_modules/groundswell (stale). Do NOT pass cwd outside the repo or bare imports break.

# API SURFACE (verified — do not re-discover)
- symbol: ensureHarnessInitialized   # src/config/harness.ts:189 — async; registers + initializeProvider('pi', opts?)
- symbol: HarnessRegistry.getInstance().get('pi')   # node_modules/groundswell — returns PiHarness | undefined
- symbol: PiHarness.authStorage       # public, NULLABLE (null until initialize()) — guard with ?.
- symbol: authStorage.getApiKey('zai') # ASYNC, Promise<string|undefined>; single-arg (fallback ON → env resolves)
- symbol: PiHarness.terminate()       # pi-harness.js:106 — runner calls it for tidy-up

# GROUND TRUTH (run via `npx tsx ./_repro_runner.mjs`, stale node_modules dist)
- case_authjson_only: "getApiKey('zai') -> undefined   (RED now; -> 'SECRET-FROM-AUTH-JSON' after fix)"
- case_envkey_only:   "getApiKey('zai') -> 'SECRET-FROM-ENV'   (passes on stale dist — control)"
```

### Current Codebase tree (relevant slice)

```bash
tests/integration/config/          # NEW directory (tests/integration/<area>/ convention; config/ does not exist yet)
└── pi-harness-auth.test.ts        # NEW — the two-case subprocess test
# Runner script _pi-harness-auth-runner.mjs is written to the PROJECT ROOT at runtime (not committed; cleaned up).
src/config/harness.ts              # READ-ONLY (consumed by the subprocess via import) — NOT modified
node_modules/groundswell/dist/harnesses/pi-harness.js   # READ-ONLY (the STALE dist under test)
```

### Desired Codebase tree with files to be added

```bash
tests/integration/config/
└── pi-harness-auth.test.ts        # NEW (the ONLY file added in this subtask)
# No source changes. No config changes. No committed runner (generated at runtime + unlinked).
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — the vitest alias makes in-process RED IMPOSSIBLE.
//   vitest.config.ts: resolve.alias.groundswell -> ../groundswell/dist/index.js (FIXED sibling).
//   Do NOT write `await harness.authStorage.getApiKey('zai')` in-process and expect it to fail —
//   it will PASS (alias -> fixed dist). The assertion MUST run in a tsx subprocess (no alias).

// CRITICAL — the subprocess runner MUST live inside the project tree (e.g. project root) so that
//   bare `import 'groundswell'` resolves to node_modules/groundswell (stale) and
//   `import './src/config/harness.ts'` resolves to the repo source. A runner in /tmp cannot
//   resolve 'groundswell' (no node_modules ancestor) — verified.

// GOTCHA — clear ALL auth env vars in the spawn env, or a developer's real ~/.pi credentials /
//   shell exports leak in and the test becomes non-deterministic. Clear at least:
//   ZAI_API_KEY, PRP_API_KEY, ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, ANTHROPIC_OAUTH_TOKEN,
//   PRP_AGENT_HARNESS. (ANTHROPIC_BASE_URL may be left; the runner never makes a call.)

// GOTCHA — authStorage is NULLABLE (null until initialize()). Guard with `h?.authStorage?.getApiKey(...)`.
//   getApiKey is ASYNC (Promise<string|undefined>) — MUST await. The runner JSON.stringifies the
//   result so undefined serializes correctly to the literal `undefined` token in `RESULT key=undefined`.

// GOTCHA — coverage: a subprocess test executes NO src/ code in the vitest process, so it adds 0
//   to src coverage. The global 100% threshold is upheld by existing unit tests (harness.ts is
//   already covered). Do NOT run this file alone as a coverage source.

// GOTCHA — no vi.mock of @anthropic-ai/sdk is needed. The subprocess calls ensureHarnessInitialized()
//   (-> PiHarness.initialize() lazy-imports the SDK but instantiates nothing and makes no call) +
//   getApiKey() (local). No network is reachable. A vi.mock in the vitest process wouldn't affect
//   the subprocess anyway.

// GOTCHA — isolation is AUTOMATIC via subprocess (fresh process = fresh HarnessRegistry singleton).
//   No afterEach harness.terminate() is needed for cross-test isolation (still call terminate() in
//   the runner for tidy-up of OS resources).
```

---

## Implementation Blueprint

### Data models and structure
None — test-only. The only "data" is the seeded `auth.json` object
`{ zai: { type: 'api_key', key: '<secret>' } }` and the runner's `RESULT key=<json>` protocol.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE tests/integration/config/pi-harness-auth.test.ts
  - STRUCTURE: vitest describe('PiHarness auth.json resolution (non-mocked, real node_modules/groundswell)')
        with two it() cases: (A) 'auth.json-only: getApiKey(zai) resolves the on-disk credential';
        (B) 'ZAI_API_KEY-only (no auth.json): getApiKey(zai) resolves the env value (control)'.
  - IMPORTS: from 'vitest' (describe/it/expect/beforeEach/afterEach); node:child_process spawnSync;
        node:fs (mkdtempSync/writeFileSync/rmSync/unlinkSync); node:os tmpdir; node:path (join/resolve).
  - CONSTANTS:
        TSX = resolve('node_modules/.bin/tsx');
        RUNNER = resolve('_pi-harness-auth-runner.mjs');  # project root, generated
        AUTH_VARS = ['ZAI_API_KEY','PRP_API_KEY','ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','ANTHROPIC_OAUTH_TOKEN','PRP_AGENT_HARNESS'];
        RUNNER_SRC = <the runner source string from the "Technical requirements" block>.
  - HELPER: beforeEach(() => writeFileSync(RUNNER, RUNNER_SRC));
        afterEach(() => { try { unlinkSync(RUNNER); } catch {} });   # always remove the runner
  - HELPER runCase(mode, extraEnv):
        const tmp = mkdtempSync(join(tmpdir(), 'pi-auth-'));
        const env = { ...process.env }; for (const k of AUTH_VARS) delete env[k];
        env.PI_CODING_AGENT_DIR = tmp; Object.assign(env, extraEnv);
        const res = spawnSync(TSX, [RUNNER], { env, encoding: 'utf8' });
        const m = (res.stdout||'').match(/RESULT key=(.*)$/m);   # parse the protocol line
        rmSync(tmp, { recursive: true, force: true });
        if (!m) throw new Error('runner produced no RESULT; stderr=' + res.stderr);
        return JSON.parse(m[1]);   # undefined -> undefined, 'SECRET...' -> string
  - CASE A: const key = runCase('authjson', {}); writeFileSync(join(tmp...,'auth.json'), ...)
        — NOTE: write auth.json BEFORE spawning (the helper needs the tmp dir; either pass a
        seed callback or write inside runCase). Simplest: have runCase accept a `seedAuthJson`
        boolean; when true, writeFileSync(join(tmp,'auth.json'), JSON.stringify({zai:{type:'api_key',key:'SECRET-FROM-AUTH-JSON'}})).
        expect(key).toBe('SECRET-FROM-AUTH-JSON');   // RED now (undefined), GREEN after fix
  - CASE B: const key = runCase('envkey', { ZAI_API_KEY: 'SECRET-FROM-ENV' });  // no auth.json written
        expect(key).toBe('SECRET-FROM-ENV');   // passes on stale dist (control)
  - FORBIDDEN: vi.mock('groundswell'), vi.mock('@earendil-works/pi-coding-agent'), any in-process
        import of ensureHarnessInitialized/HarnessRegistry for assertion.
  - PLACEMENT: tests/integration/config/pi-harness-auth.test.ts.

Task 2: VERIFY (RED confirmation)
  - RUN: npx vitest run tests/integration/config/pi-harness-auth.test.ts
  - EXPECTED (current tree): Case A FAILS (asserted 'SECRET-FROM-AUTH-JSON', received undefined);
        Case B PASSES. This is the correct RED state — do NOT "fix" Case A by mocking.
  - ALSO RUN (sanity, no regressions): npx vitest run tests/unit/config   # existing auth tests still green
  - DO NOT RUN npm run validate or the full npm run test:run unless asked — the wider suite has
        pre-existing failures (TEST_RESULTS.md Issues 2–3) unrelated to this subtask. This file's
        own RED on Case A is the expected, intended outcome of S1.
  - DO NOT modify any src/ or config file.
```

### Implementation Patterns & Key Details

```ts
// PATTERN — spawn the runner and parse the RESULT protocol (mirrors auth-preflight.test.ts spawnSync).
function runCase(opts: { seedAuthJson?: boolean; env?: Record<string,string> }): unknown {
  const tmp = mkdtempSync(join(tmpdir(), 'pi-auth-'));
  try {
    if (opts.seedAuthJson) {
      writeFileSync(join(tmp, 'auth.json'), JSON.stringify({
        zai: { type: 'api_key', key: 'SECRET-FROM-AUTH-JSON' },
      }));
    }
    const env: Record<string, string|undefined> = { ...process.env };
    for (const k of AUTH_VARS) delete env[k];
    env.PI_CODING_AGENT_DIR = tmp;
    if (opts.env) Object.assign(env, opts.env);
    const res = spawnSync(TSX, [RUNNER], { env: env as any, encoding: 'utf8' });
    const m = (res.stdout ?? '').match(/RESULT key=(.*)$/m);
    if (!m) throw new Error(`no RESULT line\nstdout:${res.stdout}\nstderr:${res.stderr}`);
    const raw = m[1].trim();
    return raw === 'undefined' ? undefined : JSON.parse(raw);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// PATTERN — assertions encode the verified ground truth.
it('auth.json-only: getApiKey(zai) resolves the on-disk credential', () => {
  expect(runCase({ seedAuthJson: true })).toBe('SECRET-FROM-AUTH-JSON'); // RED now
});
it('ZAI_API_KEY-only (no auth.json): resolves env value (control)', () => {
  expect(runCase({ env: { ZAI_API_KEY: 'SECRET-FROM-ENV' } })).toBe('SECRET-FROM-ENV'); // passes now
});

// CRITICAL — the runner (RUNNER_SRC) runs in a tsx SUBPROCESS. NO vi.mock anywhere.
//   Its `import 'groundswell'` resolves to node_modules/groundswell (stale) because the
//   subprocess has no vitest alias. Its `import './src/config/harness.ts'` resolves to repo src.
```

### Integration Points

```yaml
DOWNSTREAM (this test GATES these — they are separate subtasks, do NOT do them here):
  - P1.M1.T2 (deploy Groundswell fix): after node_modules/groundswell is updated (npm link or
        republish), re-run this test → Case A turns GREEN (getApiKey returns the seeded key).
        This is the definition of done for the RED→GREEN cycle.
  - P1.M1.T3 (harden validate-groundswell.ts): complementary CI-level guard; this integration
        test is the runtime-level guard.

NO SOURCE INTEGRATION: this subtask adds a test file only. It does not import or modify any
  src/ module in the vitest process (the subprocess does, read-only).
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npx eslint tests/integration/config/pi-harness-auth.test.ts
npx prettier --check tests/integration/config/pi-harness-auth.test.ts
# If prettier complains: npx prettier --write tests/integration/config/pi-harness-auth.test.ts
# (or `npm run fix`). Do NOT run project-wide `npm run validate` — it sweeps pre-existing
# unrelated failures (TEST_RESULTS.md Issues 2–3) and is out of scope for S1.
# Expected: zero lint/format errors on this file.
```

### Level 2: Unit/Integration Tests (THE acceptance gate for S1)

```bash
npx vitest run tests/integration/config/pi-harness-auth.test.ts
# EXPECTED (current tree — the RED state):
#   Case A 'auth.json-only ...' : FAILED  (asserted 'SECRET-FROM-AUTH-JSON', received undefined)
#   Case B 'ZAI_API_KEY-only ...' : passed
# This RED on Case A is the INTENDED, CORRECT outcome of the TDD RED step. Do not mask it.
# Sanity (no collateral damage to existing auth tests):
npx vitest run tests/unit/config   # all still pass
```

### Level 3: Integration Testing (System Validation)

```bash
# N/A beyond Level 2 for S1. The subprocess IS the integration exercise (real node_modules dist,
# real ensureHarnessInitialized, real AuthStorage). No service to start, no network.
# (Optional manual cross-check that the subprocess hits the stale dist, not the alias:)
node -e "console.log(require('fs').readFileSync('node_modules/groundswell/dist/harnesses/pi-harness.js','utf8').includes('AuthStorage.inMemory()') ? 'STALE (expected RED)' : 'FIXED (would be GREEN)')"
# Expected today: 'STALE (expected RED)'. After P1.M1.T2: 'FIXED (would be GREEN)'.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# N/A — a two-case auth-resolution test with no creative surface. Domain checks (record in the
# task result):
#   - Case A RED proves the deployed dist ignores auth.json (Issue 1).
#   - Case B green proves the bug is specific to auth.json (env path unaffected).
#   - No vi.mock('groundswell') / vi.mock('@earendil-works/pi-coding-agent') — real dist runs.
#   - After P1.M1.T2, re-running yields both green (the GREEN step that closes the cycle).
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `tests/integration/config/pi-harness-auth.test.ts` passes `eslint` and `prettier --check`.
- [ ] `npx vitest run tests/integration/config/pi-harness-auth.test.ts` → Case A **FAILS**
      (RED, received `undefined`), Case B **passes**.
- [ ] `npx vitest run tests/unit/config` still fully passes (no collateral damage).
- [ ] No `src/` or config file modified.

### Feature Validation
- [ ] File contains exactly two `it` cases (auth.json-only; ZAI_API_KEY-only control).
- [ ] No `vi.mock('groundswell')` and no `vi.mock('@earendil-works/pi-coding-agent')` anywhere.
- [ ] Assertions use a `tsx` subprocess (not an in-process `await`) — required by the alias conflict.
- [ ] All auth env vars are cleared in the spawn env; `PI_CODING_AGENT_DIR` is set to a temp dir.
- [ ] Temp dir and `_pi-harness-auth-runner.mjs` are removed after each case.

### Code Quality Validation
- [ ] Follows the repo's `tests/integration/<area>/<feature>.test.ts` placement convention.
- [ ] Mirrors the existing `spawnSync` pattern (`tests/unit/config/auth-preflight.test.ts`).
- [ ] Runner protocol (`RESULT key=<json>`) is robust to `undefined` (JSON-parse guarded).
- [ ] Comments explain WHY the subprocess is used (alias conflict) so future maintainers don't
      "simplify" it back to an in-process await and silently lose the RED signal.

### Documentation & Deployment
- [ ] Inline comment in the test documents the vitest-alias conflict and why a subprocess is
      mandatory (this is the key non-obvious detail).
- [ ] Task result records: Case A RED (`undefined`), Case B green; expected to flip to both-green
      after P1.M1.T2 deploys the fixed Groundswell dist.

---

## Anti-Patterns to Avoid

- ❌ Don't write an in-process `await harness.authStorage.getApiKey('zai')` assertion — the vitest alias makes it silently GREEN (no RED signal). Use the tsx subprocess.
- ❌ Don't `vi.mock('groundswell')` or `vi.mock('@earendil-works/pi-coding-agent')` — the whole point is the REAL deployed dist runs.
- ❌ Don't place the runner script in `/tmp` — `import 'groundswell'` won't resolve (no node_modules ancestor). Put it in the project root.
- ❌ Don't forget to clear the auth env vars in the spawn env — a developer's real credentials would make the test non-deterministic.
- ❌ Don't "fix" Case A by mocking or seeding the in-memory store to make it green — it is SUPPOSED to be RED in S1 (the fix lands in P1.M1.T2).
- ❌ Don't import `ensureHarnessInitialized` / `HarnessRegistry` in the vitest process for assertion — only the subprocess touches them.
- ❌ Don't modify any `src/`, config, or `node_modules` file — this is test-only (Mode A).
- ❌ Don't run `npm run validate` or the full `npm run test:run` as the S1 gate — they sweep pre-existing unrelated failures (Issues 2–3). The S1 gate is this file's own run + `tests/unit/config` sanity.

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: Every value is **verified by execution**, not assumed — the vitest-alias conflict is
proven (in-process → fixed sibling dist), the only viable mechanism (tsx subprocess → stale
node_modules dist) is proven, and BOTH cases' expected values are ground-truthed via `npx tsx`
(Case A → `undefined` RED; Case B → `'SECRET-FROM-ENV'` control). The exact runner source, spawn
invocation, env clearing, cleanup, and assertions are specified verbatim. The single residual
risk is implementer ergonomics around seeding `auth.json` inside the helper (handled by the
`seedAuthJson` flag pattern in the blueprint). The unavoidable nuance — that this PRP deviates
from the contract's implied in-process mechanism — is mandatory, justified by proof, and called
out in the STOP block so the implementer cannot accidentally take the impossible path.
