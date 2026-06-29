# Bug Fix Requirements

## Overview

Creative end-to-end QA of the **Auth & Logging Hardening (Delta D1)** implementation
(`plan/007_8783a1f5e14a/`) against PRD §9.6 (Logging Architecture), §9.2.6
(Provider-Agnostic Authentication Model), and §9.2.7 (Fail-Fast Authentication Preflight).

**Testing performed:**
- PRD scope mapping for all three workstreams (T1 logging, T2 auth, T3 preflight, T4 docs).
- Acceptance-grep verification for REQ-L1/L2/L3 (§9.6.3): zero `transport:` in logger config,
  zero module-scope `getLogger()` declarations, zero worker threads spawned.
- Wall-clock timing of `hack --help`, `-h`, `--version`, and an invalid flag (all < 0.6 s,
  well under the 2 s bar) with a `worker_threads.Worker` spy confirming **0** spawns.
- Full §9.2.7 preflight acceptance matrix (7 cases) driven through the real
  `configureEnvironment() → runAuthPreflight()` path with an isolated `PI_CODING_AGENT_DIR`.
- **Runtime harness credential resolution** for the auth.json-only path (the documented
  primary flow) — this is where a Critical defect was found.
- Cross-repo Groundswell (T2.S2) deployment verification.
- Documentation review (README, `.env.example`, `docs/CONFIGURATION.md`).
- Full `vitest` suite run to assess regression scope.

**Overall assessment:** The **logging workstream (T1) is excellent** — every §9.6.3 acceptance
criterion is met and verified. The **preflight logic (T3) is correct in isolation.** However,
the **auth.json runtime path (the core deliverable of T2) is broken in the deployed build**:
the cross-repo Groundswell fix (T2.S2) was written in the source repo but never propagated to
the `node_modules/groundswell` that hacky-hack actually imports, so the harness still uses an
in-memory auth store that ignores `~/.pi/agent/auth.json`. The preflight therefore emits a
**false positive** for `pi /login` users, who then hit the exact deep, misleading
"No API key found for zai" failure §9.2.7 was designed to eliminate.

---

## Critical Issues (Must Fix)

### Issue 1: Stale `node_modules/groundswell` defeats the auth.json-only auth path (T2.S2 fix not deployed)

**Severity**: Critical
**PRD Reference**: §9.2.6 ("`pi` auth.json … **This must be honored**"), §9.2.7 acceptance
("A run authenticated via `~/.pi/agent/auth.json` alone (no env vars) succeeds under the
`pi` + `zai` default"), §9.5 ("Cross-repo: switch the `pi` harness to a file-backed
`AuthStorage` (`AuthStorage.create()`) … so `~/.pi/agent/auth.json` is honored"), and the
T2.S2 contract.

**Expected Behavior**: A user who runs `pi /login` (writing `~/.pi/agent/auth.json`) and then
runs the pipeline — with **no** env vars set — succeeds end-to-end. The `pi` harness must
consult the file-backed `AuthStorage.create()` so the on-disk `zai` credential is resolved
at agent-run time.

**Actual Behavior**: The pipeline aborts deep inside the first agent run with a misleading
"No API key found for zai" error — **after** the preflight has already passed and **after** a
session directory is created. The preflight and the harness *disagree* about whether auth is
configured:

- The **preflight** (`runAuthPreflight()` in `src/config/harness.ts`) imports
  `AuthStorage` from `@earendil-works/pi-coding-agent` and calls `AuthStorage.create()`
  directly → this **does** read `auth.json` → `getAuthStatus('zai').configured === true` →
  preflight **passes**.
- The **harness** (`PiHarness.initialize()`) is loaded from `node_modules/groundswell`, whose
  `dist/harnesses/pi-harness.js` still contains the pre-fix code:
  ```js
  this.authStorage = AuthStorage.inMemory();          // line 95 — STALE
  this.modelRegistry = ModelRegistry.inMemory(this.authStorage);  // line 96 — STALE
  ```
  An in-memory store **never** reads `~/.pi/agent/auth.json`. With only auth.json on disk
  (no `ZAI_API_KEY`), `harness.authStorage.getApiKey('zai')` returns **`null`** at run time.

This is precisely the failure mode PRD §9.2.7 was written to prevent ("surfaces as a deep,
misleading error … after a session directory has already been created and an `ERROR_REPORT.md`
written"). The preflight's false positive makes it **worse** than no preflight: the user is
told auth is fine, then the run dies on the first LLM call.

**Root cause (verified):**

1. The fix **exists** in the Groundswell **source repo** —
   `~/projects/groundswell/src/harnesses/pi-harness.ts` lines 152–153 use
   `AuthStorage.create()` / `ModelRegistry.create()`, and the rebuilt
   `~/projects/groundswell/dist/harnesses/pi-harness.js` contains it.
2. But the fix is **uncommitted** in Groundswell's working tree
   (`git status` → ` M src/harnesses/pi-harness.ts`).
3. hacky-hack's `node_modules/groundswell` is **not** an `npm link` — it is the **published
   npm v1.0.0 tarball** (`resolved: https://registry.npmjs.org/groundswell/-/groundswell-1.0.0.tgz`),
   a plain directory copy, **not** a symlink. It still uses `AuthStorage.inMemory()`.
4. Node resolves `import … from 'groundswell'` to `node_modules/groundswell/dist/…`, so
   hacky-hack runs the **stale** code.

The two dist files have different md5sums:
- `node_modules/groundswell/dist/harnesses/pi-harness.js` → `54cea962…` (stale, `inMemory()`)
- `~/projects/groundswell/dist/harnesses/pi-harness.js` → `d3de7234…` (fixed, `create()`)

**Steps to Reproduce:**

```bash
cd /home/dustin/projects/hacky-hack

# 1) Confirm the deployed (used) dist is stale:
grep -n "AuthStorage\.\(create\|inMemory\)()" node_modules/groundswell/dist/harnesses/pi-harness.js
# → line 95: this.authStorage = AuthStorage.inMemory();   (STALE)

# 2) Runtime proof — auth.json-only setup, no env vars:
cat > /tmp/repro.mts <<'EOF'
import { configureEnvironment } from '/home/dustin/projects/hacky-hack/src/config/environment.js';
import { runAuthPreflight, ensureHarnessInitialized } from '/home/dustin/projects/hacky-hack/src/config/harness.js';
import { HarnessRegistry } from 'groundswell';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os'; import { join } from 'node:path';
const tmp = mkdtempSync(join(tmpdir(), 'pi-repro-'));
writeFileSync(join(tmp, 'auth.json'), JSON.stringify({ zai: { type: 'api_key', key: 'SECRET-FROM-AUTH-JSON' } }));
const vars = ['ZAI_API_KEY','ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','ANTHROPIC_OAUTH_TOKEN','PRP_API_KEY','ANTHROPIC_BASE_URL','PI_CODING_AGENT_DIR'];
const saved: any = {}; for (const k of vars) { saved[k]=process.env[k]; delete process.env[k]; }
process.env.PI_CODING_AGENT_DIR = tmp;
try {
  configureEnvironment();
  await runAuthPreflight();            // PASSES (false positive)
  await ensureHarnessInitialized();
  const h = (HarnessRegistry.getInstance() as any).harnesses?.get('pi');
  const key = await h.authStorage.getApiKey('zai', { includeFallback: false });
  console.log('preflight passed; harness can resolve zai key?', !!key);  // → false
} finally { rmSync(tmp, { recursive:true, force:true }); for (const k of vars) if (saved[k]!==undefined) process.env[k]=saved[k]; }
EOF
npx tsx /tmp/repro.mts
# → "preflight passed; harness can resolve zai key? false"   ← BUG
```

**Control experiment (proves root cause):** temporarily copying the *fresh* Groundswell dist
over the stale one and re-running the identical repro yields `harness can resolve zai key? true`
— `getApiKey('zai')` returns `"SECRET-FROM-AUTH-JSON"` and `getAuthStatus('zai')` becomes
`{ configured: true, source: 'stored' }`. The fix works; it is simply not deployed.

**Contrast (proves the bug is specific to the auth.json path):** the `ZAI_API_KEY`-only path
works even with the stale dist, because the in-memory `AuthStorage` still resolves provider
env vars. So the regression is silent for env-var users and only bites the documented
"recommended" `pi /login` flow.

**Additional impact:** The shipped documentation (README lines 249, 277, 342–344 and
`.env.example` line 16) promises auth.json is *"auto-detected by the harness"* and recommends
`pi /login` as the primary path. With the stale dist this promise is broken, so the
recommended onboarding flow fails for every new user.

**Suggested Fix:**

1. **Commit and ship the Groundswell fix.** Commit the working-tree change in
   `~/projects/groundswell` (`src/harnesses/pi-harness.ts` + `src/types/harnesses.ts` +
   its tests), bump Groundswell's version, publish to npm, and bump hacky-hack's
   `package.json` `dependencies.groundswell` to pull the fixed release. Then `npm install`.
   *or* `npm link ~/projects/groundswell` so `node_modules/groundswell` resolves to the
   fixed source (and update `validate:groundswell` to assert the link is a real symlink).
2. **Close the verification gap that let this ship.** Add a **non-mocked** integration test
   that exercises the *real* `node_modules/groundswell` `PiHarness`: seed a temp
   `PI_CODING_AGENT_DIR/auth.json`, call `ensureHarnessInitialized()`, and assert
   `harness.authStorage.getApiKey('zai')` resolves the seeded key. The existing
   `auth-resolution`/`auth-preflight` tests all `vi.mock('groundswell')`, so they never touch
   the real (stale) dist — that is why all 26 auth tests pass while the runtime is broken.
3. **Harden `validate:groundswell`.** It currently passes on the stale dist because it only
   checks exports are importable. Add an assertion that the imported `PiHarness` uses a
   file-backed auth store (e.g. instantiate it and assert `harness.authStorage` reads a
   seeded temp auth.json), so a stale/published-without-the-fix build fails CI.

---

## Major Issues (Should Fix)

### Issue 2: `createBaseConfig` integration test not updated for provider-aware auth (T2.S1 regression, breaks `npm run validate`)

**Severity**: Major
**PRD Reference**: §9.2.6 / T2.S1 (provider-aware auth resolution). The T2.S1 commit
(`a8ffac3`) rewired `createBaseConfig()` to source the key via
`resolveApiKeyForProvider(getResolvedProvider())` instead of raw `process.env.ANTHROPIC_API_KEY`,
and updated `tests/unit/config/environment.test.ts` + `harness-config.test.ts` — but missed
this integration test.

**Expected Behavior**: `npm run validate` (the project's lint+format+typecheck+test gate) is
green after the delta.

**Actual Behavior**: `tests/integration/agents.test.ts > createBaseConfig > "should map
ANTHROPIC_AUTH_TOKEN to ANTHROPIC_API_KEY"` fails:
```
AssertionError: expected '' to be 'test-token-123'
  165 | expect(config.env.ANTHROPIC_API_KEY).toBe('test-token-123');
```
The test stubs `ANTHROPIC_API_KEY='test-token-123'`, but `createBaseConfig()` now resolves the
key provider-aware (`resolveApiKeyForProvider('zai')` checks `PRP_API_KEY` → `ZAI_API_KEY` →
auth.json, **not** `ANTHROPIC_API_KEY`), so `config.env.ANTHROPIC_API_KEY` is `''`. The test
asserts the *old* Anthropic-shell contract that T2.S1 deliberately removed.

**Steps to Reproduce:**
```bash
cd /home/dustin/projects/hacky-hack
npx vitest run tests/integration/agents.test.ts -t createBaseConfig
# → 1 failed: "should map ANTHROPIC_AUTH_TOKEN to ANTHROPIC_API_KEY"
```

**Suggested Fix:** Rewrite the test to assert the *new* provider-aware contract — e.g. that
`ZAI_API_KEY` is resolved for the default `zai` provider, and that `ANTHROPIC_API_KEY` is only
honored when the resolved provider is `anthropic` (mirror the cases already in
`tests/unit/config/environment.test.ts`). This is test-only churn; runtime behavior is correct.

---

## Minor Issues (Nice to Fix)

### Issue 3: Full `vitest` suite is red (33 files / 223 tests failing) — mix of pre-existing and the D1 regression above

**Severity**: Minor (context)
**PRD Reference**: Project development workflow relies on `npm run validate`.

**Observed:** `npx vitest run` → `Test Files 33 failed | 133 passed`, `Tests 223 failed | 5757 passed`.
Sampling shows the bulk are **pre-existing** and outside D1's three workstreams — e.g.
`tests/integration/agents/architect-agent-integration.test.ts` expects model `GLM-4.7` while the
shipped default is `zai/glm-5.2` (§9.2.3 model defaults, changed in an earlier session), and
`enableReflection` expectation mismatches from the behavior alignment in commit `a557b18`.
The **one** failure directly attributable to this delta is Issue 2 above. Calling this out so
the fix agent does not mistake the pre-existing failures for D1 regressions — but the overall
suite health means `npm run validate` is currently not a usable green gate, which is worth
tracking separately.

**Suggested Fix:** Triage the 33 files; update the stale model/reflection assertions
(pre-existing) and the `createBaseConfig` assertion (Issue 2). Consider adding a CI check that
`npm run validate` must pass on the default branch.

### Issue 4: `validate:groundswell` does not detect a stale/unlinked dist

**Severity**: Minor (but it is the reason Issue 1 escaped detection)
**PRD Reference**: §9.5 / T2.S2 output verification ("verify via `npm run validate:groundswell`").

**Observed:** `npx tsx src/scripts/validate-groundswell.ts` prints `✓ All validations passed!`
against the stale dist. It only checks that `Workflow`/`Agent`/`Prompt`/decorators are
importable and that the version is `>= 0.0.3`. It does **not** verify the install is a symlink
to the local repo, nor that `PiHarness` actually uses a file-backed auth store. This is why the
stale npm tarball passed the team's own verification step.

**Suggested Fix:** See Issue 1, suggested fix #3 — add an auth-store behavior assertion to the
validator (or a dedicated smoke test) so a Groundswell build lacking the §9.2.6 fix fails CI.

---

## Testing Summary

- **Total tests performed:** ~45 targeted probes (acceptance greps ×3, CLI timing ×4 with
  worker spy, preflight matrix ×7, runtime credential resolution ×2 incl. control experiment,
  doc review ×3, full `vitest` suite, plus cross-repo deployment verification).
- **Passing:** Logging workstream (T1) — all §9.6.3 criteria met and verified; preflight logic
  (T3) — all 7 §9.2.7 cases correct in isolation; provider-aware resolver (T2.S1) — correct
  for override/env paths; docs (T4) — accurately reframe auth/logging (modulo Issue 1 making
  the "auto-detected by the harness" promise currently false).
- **Failing:** 1 Critical (Issue 1: auth.json runtime path broken by undeployed Groundswell
  fix), 1 Major (Issue 2: stale `createBaseConfig` integration test).
- **Areas with good coverage:** lazy/sync logger architecture (T1) — genuinely excellent,
  verified at syscall (worker-thread spy) and wall-clock level; preflight decision logic (T3);
  provider-aware resolver unit behavior (T2.S1).
- **Areas needing more attention:** **end-to-end harness credential resolution against the
  real (non-mocked) `node_modules/groundswell`** — this is the blind spot that let Issue 1
  ship; the Groundswell deployment/link step and its verification; and the broader
  `npm run validate` gate (Issues 2–3).
