name: "P1.M1.T2.S2 — Link the fixed Groundswell dist to hacky-hack and verify auth.json resolution"
description: |

---

## Goal

**Feature Goal**: Deploy the already-committed Groundswell file-backed `AuthStorage.create()` fix
into hacky-hack's runtime resolution path by running `npm link groundswell` in hacky-hack, so
`node_modules/groundswell` (currently the **stale** v1.0.0 npm tarball that calls
`AuthStorage.inMemory()`) resolves to the **fixed** `~/projects/groundswell` checkout. Then
**verify** the auth.json-only runtime path works end-to-end — turning the RED integration test
from P1.M1.T1.S1 (`tests/integration/config/pi-harness-auth.test.ts`, case A) GREEN and passing
the PRD's repro. Finally **document** the production publish path (semantic-release → `npm install
groundswell@latest`) and the link-reversal procedure.

**Deliverable**:
1. `node_modules/groundswell` is a **symlink** to `~/projects/groundswell` (verified by
   `readlink -f`).
2. The deployed `dist/harnesses/pi-harness.js` uses `AuthStorage.create()` (verified by grep).
3. The P1.M1.T1.S1 integration test is **GREEN** (both cases pass; case A flips from RED).
4. The PRD repro (`/tmp/repro.mts` equivalent) confirms `getApiKey('zai')` resolves the seeded
   auth.json key.
5. A short, in-PRP **production-path + link-reversal** note (no separate docs file — see "Why no
   docs subtask").

**No hacky-hack source/lockfile/docs/test files are modified by the link itself.** `npm link`
rewires `node_modules/groundswell` only (machine-local, non-reproducible, NOT captured in the
lockfile). The production lockfile bump is CI-gated and documented, not executed.

**Success Definition**:
- `readlink -f node_modules/groundswell` → `/home/dustin/projects/groundswell`.
- `test -L node_modules/groundswell` → symlink.
- `grep -n 'AuthStorage\.\(create\|inMemory\)()' node_modules/groundswell/dist/harnesses/pi-harness.js`
  → a line with `this.authStorage = options?.authStorage ?? AuthStorage.create();` (NOT `inMemory()`).
- `npx vitest run tests/integration/config/pi-harness-auth.test.ts` → **2/2 pass** (case A
  `getApiKey('zai') === 'SECRET-FROM-AUTH-JSON'`; case B control still passes).
- The PRD repro prints `harness can resolve zai key? true`.

> **EMPIRICALLY VERIFIED PRE-STATE (run before writing this PRP):**
> - Groundswell `git status` is **clean**; `git log -1` == `fix(harnesses): use file-backed
>   AuthStorage.create() over inMemory() to honor ~/.pi/agent/auth.json (PRD §9.2.6)` (P1.M1.T2.S1 ✅).
> - `~/projects/groundswell/dist/harnesses/pi-harness.js:103` == `this.authStorage =
>   options?.authStorage ?? AuthStorage.create();` (FIXED dist, rebuilt).
> - `npm ls -g groundswell` → `groundswell@1.0.0 -> /home/dustin/projects/groundswell` — **the
>   global producer-side `npm link` is ALREADY registered**. So S2 only needs the **consumer-side**
>   link: `cd ~/projects/hacky-hack && npm link groundswell`.
> - hacky-hack `node_modules/groundswell` is a **plain directory** (`test -L` → not a symlink),
>   resolved to the npm tarball `https://registry.npmjs.org/groundswell/-/groundswell-1.0.0.tgz`,
>   with `AuthStorage.inMemory()` at line 95 (STALE).
> - Integration test case A is **RED** (`expected undefined to be 'SECRET-FROM-AUTH-JSON'`); case B
>   (env control) GREEN.

## User Persona (if applicable)

**Target User**: Every hacky-hack user who authenticates via the documented `pi /login` flow
(writes `~/.pi/agent/auth.json`) and runs the pipeline with **no** env vars set.

**Use Case**: After `npm link groundswell`, the `pi` harness loads the file-backed
`AuthStorage.create()` at runtime, reads `~/.pi/agent/auth.json`, and resolves the on-disk `zai`
credential — so the pipeline's first LLM call no longer dies with "No API key found for zai".

**User Journey**:
1. Maintainer runs `npm link groundswell` in hacky-hack (this subtask).
2. `node_modules/groundswell` becomes a symlink → `~/projects/groundswell` (fixed dist).
3. A user runs `pi /login` → `~/.pi/agent/auth.json` is written.
4. The pipeline calls `ensureHarnessInitialized()` → `PiHarness.initialize()` →
   `this.authStorage = AuthStorage.create()` → reads `auth.json`.
5. At agent-run time `harness.authStorage.getApiKey('zai')` returns the on-disk key. ✓

**Pain Points Addressed**: Today the preflight **passes** (it reads auth.json via its own
`AuthStorage.create()`) while the **harness fails** (it uses `AuthStorage.inMemory()`, which
ignores auth.json) — a false-positive that is *worse* than no preflight (PRD §9.2.7). The link
makes the two paths agree.

## Why

- **PRD §9.2.6 / §9.2.7 compliance**: "`pi` auth.json … **This must be honored**" and the §9.2.7
  acceptance "A run authenticated via `~/.pi/agent/auth.json` alone (no env vars) succeeds under
  the `pi` + `zai` default." The link deploys the fix that honors it.
- **PRD Issue 1 (Critical) — the deploy half**: P1.M1.T2.S1 committed the fix in the Groundswell
  repo; S2 deploys it into hacky-hack's runtime. Without S2, the committed fix has zero effect on
  what hacky-hack actually imports.
- **Closes the RED→GREEN loop**: P1.M1.T1.S1 shipped the failing test on purpose (TDD RED) so
  that the deploy would be provably correct. This subtask is the GREEN step.
- **Immediate local verifiability**: `npm link` lets the integration test + validator hardening
  (P1.M1.T3) run green against the fixed code **now**, without waiting for a CI publish round-trip.

## What

A two-part operation: **(A) `npm link`** (the deploy), **(B) verify + document** (the proof +
production note).

### Action A — Link the fixed Groundswell into hacky-hack

```bash
# Producer side (GROUNDWELL REPO) — ALREADY DONE (verified: npm ls -g shows the global link).
# Idempotent: re-running is harmless and guarantees the global registration is present.
cd ~/projects/groundswell
npm link                            # registers ~/projects/groundswell globally (if not already)

# Consumer side (HACKY-HACK) — THIS IS THE DELIVERABLE STEP.
cd ~/projects/hacky-hack
npm link groundswell                # node_modules/groundswell → symlink → ~/projects/groundswell
```

After `npm link groundswell`, `node_modules/groundswell` is replaced by a **symlink** to the
global registration, which itself points at `~/projects/groundswell` (the fixed, committed repo
with the rebuilt `dist/`). `readlink -f node_modules/groundswell` resolves the full chain to
`/home/dustin/projects/groundswell`.

### Action B — Verify auth.json resolution end-to-end

```bash
cd ~/projects/hacky-hack

# B1 — structural: the deployed dist now uses the file-backed auth store.
readlink -f node_modules/groundswell           # → /home/dustin/projects/groundswell
test -L node_modules/groundswell && echo SYMLINK
grep -n 'AuthStorage\.\(create\|inMemory\)()' node_modules/groundswell/dist/harnesses/pi-harness.js
# → ~line 103: this.authStorage = options?.authStorage ?? AuthStorage.create();   (FIXED)
#   (grep will ALSO list comment lines at ~72/99 mentioning create() — fine; what matters is the
#    executable assignment. AuthStorage.inMemory() must NOT appear as the default assignment.)

# B2 — functional: the RED integration test goes GREEN (case A resolves the seeded key).
npx vitest run tests/integration/config/pi-harness-auth.test.ts
# → Test Files 1 passed | Tests 2 passed (case A: getApiKey('zai') === 'SECRET-FROM-AUTH-JSON').

# B3 — runtime repro (the PRD's /tmp/repro.mts) — optional belt-and-suspenders confirmation.
#     (B2 already exercises the identical path via the subprocess; B3 is an independent tsx proof.)
#     See "Validation Loop → Level 3" for the repro script.
```

### Action C — Document the production publish path + link reversal (in this PRP, not a docs file)

Documented in the **"Production Path & Link Reversal"** section below. Not a separate docs subtask
(the README promise "auto-detected by the harness" becomes TRUE as a result and is verified in
**P1.M4.T1**).

### Constraints (DO/DON'T)

- **DO** run `npm link groundswell` in **hacky-hack** (the consumer). That is the deploy.
- **DO** run the producer `npm link` in `~/projects/groundswell` **only if** `npm ls -g groundswell`
  does NOT already show the global link (it does, verified — so this is a no-op safety check).
- **DO** verify with `readlink -f` + `grep` + the integration test before declaring success.
- **DON'T** push Groundswell to GitHub, run `npm publish`, or run `semantic-release` — those are
  CI-gated and out of scope (documented as the production path only).
- **DON'T** run `npm install groundswell@latest` / bump `package-lock.json` here — that consumes a
  published version that does not exist yet (v1.0.1 will be published by CI after push). Doing so
  now would re-download the stale 1.0.0 and **undo** the link.
- **DON'T** modify ANY hacky-hack tracked file (no source, no lockfile, no docs, no tests). The
  link touches only `node_modules/groundswell` (untracked) and the runner script
  `_pi-harness-auth-runner.mjs` (created+deleted by the test's beforeEach/afterEach).
- **DON'T** commit the link state. `npm link` is intentionally NOT captured in git. The production
  fix is the publish path, not the link.
- **DON'T** "also fix `validate:groundswell`" while here — adding a file-backed-auth assertion /
  symlink detection is **P1.M1.T3** (out of scope).

### Why a subprocess test is the real proof (not an in-process one)

`vitest.config.ts` sets `resolve.alias.groundswell` → `../groundswell/dist/index.js` (the sibling
checkout, which is ALREADY fixed). Any **in-process** `await import('groundswell')` inside a
vitest test resolves to that alias — NOT to `node_modules/groundswell`. So an in-process test
would **silently pass** even with the stale tarball (the bug that let Issue 1 ship). The P1.M1.T1.S1
test deliberately spawns a **`tsx` subprocess** (no vitest alias) so its `import 'groundswell'`
hits the real `node_modules/groundswell`. **`npm link` is the only thing that changes what that
subprocess resolves to** — which is exactly why linking flips case A from RED to GREEN.

## All Needed Context

### Context Completeness Check

_Pass._ A developer who has never seen either repo can execute this from the exact commands above.
The deploy is a single `npm link groundswell`; the only non-obvious facts — that the producer-side
link is already registered, that vitest aliases `groundswell` (hence the subprocess test), that the
link is machine-local and must be reversed after publish, and that the production path is
semantic-release — are all verified and documented below with exact commands and expected output.

### Documentation & References

```yaml
# MUST READ - Include these in your context window

- docfile: plan/007_8783a1f5e14a/bugfix/001_7912d248208a/architecture/deployment_strategy.md
  why: AUTHORITATIVE deployment strategy. Confirms (a) hacky-hack consumes the npm tarball (not a
        link), (b) Option A = npm link for local verification, (c) Option B = publish via
        semantic-release for production, (d) BOTH in sequence, (e) the link must be reversed before
        the published version is consumed.
  section: "Recommended Approach for This Bugfix" + "Cross-Repo Considerations" + "What the
        implementer must verify after deployment"
  critical: |
    The strategy explicitly scopes THIS subtask as step 2 ("npm link for immediate local
    verification") + step 3 ("document the publish path"). It also states the producer/consumer
    cannot push or npm publish without CI/credentials. The verification grep + readlink in the PRP
    are quoted verbatim from this doc.

- docfile: plan/007_8783a1f5e14a/bugfix/001_7912d248208a/architecture/auth_resolution_blindspot.md
  why: Explains WHY the integration test uses a subprocess (the vitest alias masks the bug) and why
        env-var users don't see the bug (runtime override via resolveApiKeyForProvider). Confirms
        the exact assertion: harness.authStorage.getApiKey('zai') must resolve the seeded key.
  section: "Why No Test Caught This" + "What the New Integration Test Must Do"
  critical: |
    The blindspot doc is the reason a plain `npm install`/in-process check is insufficient. The
    subprocess approach is mandatory — do NOT "simplify" the integration test to in-process.

- docfile: plan/007_8783a1f5e14a/bugfix/001_7912d248208a/architecture/system_context.md
  why: Dependency graph + the two divergent AuthStorage paths (preflight create() vs harness
        inMemory()). Confirms the cross-repo structure.
  section: "Key Code Paths" + "Dependency Graph"
  critical: |
    Confirms hacky-hack imports AuthStorage from @earendil-works/pi-coding-agent (preflight) while
    the harness uses its own internal AuthStorage (from node_modules/groundswell). The link makes
    the harness's internal store file-backed, aligning the two paths.

- file: tests/integration/config/pi-harness-auth.test.ts
  why: THE verification gate. Case A (auth.json-only) is the RED→GREEN test; case B (ZAI_API_KEY
        control) must stay GREEN. Documents the subprocess runner protocol and AUTH_VARS cleanup.
  pattern: |
    # The subprocess runner does (no vitest alias → hits node_modules/groundswell):
    #   await import('./src/config/harness.ts')  → ensureHarnessInitialized()
    #   await import('groundswell')              → HarnessRegistry.getInstance().get('pi')
    #   await h.authStorage.getApiKey('zai')     → seeded key (GREEN) or undefined (RED)
  gotcha: |
    After `npm link groundswell`, the subprocess's `import 'groundswell'` resolves node_modules/
    groundswell → symlink → ~/projects/groundswell/dist (FIXED). Case A flips to GREEN. Case B was
    already GREEN (env fallback works on both dists). Do NOT edit this test file.

- file: src/config/harness.ts
  why: ensureHarnessInitialized() is what the subprocess calls. Confirms it forwards resolveApiKey
        ForProvider() to initializeProvider('pi', ...) — which returns undefined for the auth.json-
        only path, so the harness MUST read auth.json itself (the Groundswell fix).
  pattern: |
    export async function ensureHarnessInitialized(): Promise<void> {
      const registry = HarnessRegistry.getInstance();
      if (!registry.has('pi')) registry.register(new PiHarness());
      const apiKey = resolveApiKeyForProvider(getResolvedProvider());
      await registry.initializeProvider('pi', apiKey ? { apiKey } : undefined);
      // ↑ auth.json-only path: apiKey === undefined → forwards NO override → the harness must read
      //   auth.json via its own AuthStorage.create() (the Groundswell fix the link deploys).
    }
  critical: |
    `import { ... } from 'groundswell'` in THIS file is resolved by the vitest alias for in-process
    unit tests, but by node_modules/groundswell at runtime (npm run dev/hack) and in the integration
    test's subprocess. The link is what makes the runtime + subprocess see the fixed dist.

- file: ~/projects/groundswell/dist/harnesses/pi-harness.js   (the FIXED dist the link points at)
  why: Confirms the fix the link deploys.
  pattern: |
    // ~line 103 (FIXED, committed by P1.M1.T2.S1):
    this.authStorage = options?.authStorage ?? AuthStorage.create();   // reads ~/.pi/agent/auth.json
    this.modelRegistry = options?.modelRegistry ?? ModelRegistry.create(this.authStorage);
  critical: |
    Contrast with the STALE deployed dist (node_modules/groundswell BEFORE linking): line 95 ==
    `this.authStorage = AuthStorage.inMemory();` (never reads auth.json). After `npm link`,
    node_modules/groundswell/dist/harnesses/pi-harness.js IS this file (via the symlink).

- file: vitest.config.ts
  why: Documents the resolve.alias that masks the bug for in-process tests.
  pattern: |
    resolve: { alias: { groundswell: new URL('../groundswell/dist/index.js', import.meta.url).pathname } }
  gotcha: |
    Because of this alias, `npm link` has NO effect on in-process vitest unit tests (they resolve
    groundswell to the sibling checkout regardless). It ONLY affects: (1) the integration test's
    subprocess, (2) runtime (`npm run dev`, `npm run hack`). This is why the link is verified via
    the subprocess integration test, not a unit test.
```

### Current Codebase tree (relevant slice)

```bash
~/projects/hacky-hack/
├── node_modules/groundswell/        # ← TARGET OF `npm link groundswell` (stale plain-dir → symlink)
│   └── dist/harnesses/pi-harness.js #    line 95: AuthStorage.inMemory()  →  (after link) line 103: AuthStorage.create()
├── tests/integration/config/
│   └── pi-harness-auth.test.ts      # VERIFICATION GATE — case A RED→GREEN, case B control GREEN
├── src/config/harness.ts            # ensureHarnessInitialized() (called by the subprocess)
├── package.json                     # "groundswell": "^1.0.0" (range permits the future 1.0.1)
├── package-lock.json                # resolved: .../groundswell-1.0.0.tgz (NOT touched by npm link)
├── vitest.config.ts                 # resolve.alias.groundswell → ../groundswell/dist (masks bug in-process)
├── .envrc                           # z.ai env vars only — NO NODE_PATH
└── (no .npmrc)

~/projects/groundswell/              # SEPARATE REPO — the fixed source the link points at
├── dist/harnesses/pi-harness.js     # line 103: AuthStorage.create()  (FIXED, committed, built)
└── (git status clean — P1.M1.T2.S1 ✅)

$(npm root -g)/groundswell           # global link → ~/projects/groundswell  (ALREADY registered)
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# NO new files. `npm link groundswell` rewrites ONE untracked entry:
node_modules/groundswell   #   plain directory  →  symlink → ~/projects/groundswell
# The test's _pi-harness-auth-runner.mjs is created and deleted by beforeEach/afterEach (untracked).
```

### Known Gotchas of our codebase & Library Quirks

```bash
# CRITICAL: run `npm link groundswell` in HACKY-HACK (the consumer), not groundswell. The producer
#   side (`npm link` in ~/projects/groundswell) is ALREADY registered (verified: npm ls -g). If you
#   only re-run the producer side and skip the consumer side, node_modules/groundswell stays stale
#   and the test stays RED.

# CRITICAL: do NOT run `npm install` or `npm install groundswell@latest` AFTER linking — npm install
#   will see ^1.0.0 still resolves to the published 1.0.0 tarball and will OVERWRITE the symlink with
#   the stale plain dir again, silently reverting the fix and turning the test back RED. The link is
#   the deploy; `npm install` is the production path (only valid AFTER 1.0.1 is published).

# CRITICAL: the vitest resolve.alias masks the bug for IN-PROCESS tests. A unit test that does
#   `await import('groundswell')` inside vitest resolves to the sibling checkout (already fixed)
#   regardless of node_modules. ONLY the integration test's SUBPROCESS (spawnSync tsx, no alias)
#   and runtime (npm run dev) hit node_modules/groundswell. Verify via the integration test, NOT
#   a unit test.

# CRITICAL: `npm link` is machine-local and NOT captured in package-lock.json. It is a dev-time
#   verification tool, NOT a deployment. The permanent fix is the publish path (semantic-release →
#   1.0.1 → npm install → commit lockfile). Document the reversal step (below) so the tree is not
#   left hybrid once 1.0.1 is consumed.

# GOTCHA (subprocess auth-var cleanup): the integration test's runCase() strips AUTH_VARS
#   (ZAI_API_KEY, ANTHROPIC_*, PRP_API_KEY, etc.) and sets PI_CODING_AGENT_DIR to a temp dir with the
#   seeded auth.json. Do NOT pre-set those env vars when running the test or it becomes non-deterministic.

# GOTCHA (singleton leak): HarnessRegistry is a process-wide singleton. The integration test runs each
#   case in a FRESH subprocess (spawnSync), so there is no cross-test leak. (An in-process test would
#   leak — another reason the subprocess design is mandatory.)

# GOTCHA (validate:groundswell still weak): `npm run validate:groundswell` checks only that exports
#   are importable + version >= 0.0.3. It does NOT assert PiHarness uses a file-backed store, so it
#   passes on the stale dist too. Hardening it is P1.M1.T3 (out of scope here). After linking,
#   validate:groundswell still passes (the fixed dist is importable) — that is expected, not a
#   confirmation of the auth fix. Use the integration test (B2) as the real gate.

# GOTCHA (the global link may already exist): `npm link` (producer) is idempotent; re-running in
#   ~/projects/groundswell just re-registers the same global symlink. Verify with `npm ls -g
#   groundswell` → expect `groundswell@1.0.0 -> /home/dustin/projects/groundswell`.
```

## Implementation Blueprint

### Data models and structure

None. No code is authored. This is a deploy (npm link) + verify + document operation.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: VERIFY pre-state (read-only — prevents deploying onto a wrong base)
  - RUN: cd ~/projects/groundswell && git status --short
  - EXPECT: empty (P1.M1.T2.S1 committed cleanly). If NOT empty, STOP — the groundswell fix is not
      committed; re-read P1.M1.T2.S1 before proceeding.
  - RUN: git log -1 --format='%s'
  - EXPECT: fix(harnesses): use file-backed AuthStorage.create() over inMemory() to honor ~/.pi/agent/auth.json (PRD §9.2.6)
  - RUN: grep -n 'AuthStorage\.\(create\|inMemory\)()' ~/projects/groundswell/dist/harnesses/pi-harness.js
  - EXPECT: ~line 103 → this.authStorage = options?.authStorage ?? AuthStorage.create();
  - RUN: cd ~/projects/hacky-hack && test -L node_modules/groundswell && echo "already linked" || echo "stale plain dir (expected pre-link)"
  - EXPECT (pre-link): "stale plain dir (expected pre-link)". (If already linked, someone ran S2
      already — skip to Task 3 verification.)
  - RUN: npm ls -g groundswell
  - EXPECT: groundswell@1.0.0 -> /home/dustin/projects/groundswell  (producer link registered)

Task 1: LINK the fixed Groundswell into hacky-hack (THE DEPLOY)
  - RUN (producer, idempotent safety — skip only if Task 0 confirmed the global link exists):
      cd ~/projects/groundswell && npm link
  - RUN (consumer — THE DELIVERABLE):
      cd ~/projects/hacky-hack && npm link groundswell
  - EXPECT: npm prints "added 1 package" / "removed N packages" or similar; node_modules/groundswell
      is now a symlink. No error. If npm reports EACCES or EEXIST, see anti-patterns (do NOT force
      with sudo; fix the node_modules ownership / remove the stale dir first).

Task 2: VERIFY the link structurally + the deployed dist is fixed
  - RUN: readlink -f node_modules/groundswell
  - EXPECT: /home/dustin/projects/groundswell
  - RUN: test -L node_modules/groundswell && echo SYMLINK
  - EXPECT: SYMLINK
  - RUN: grep -n 'AuthStorage\.\(create\|inMemory\)()' node_modules/groundswell/dist/harnesses/pi-harness.js
  - EXPECT: a line ~103 → this.authStorage = options?.authStorage ?? AuthStorage.create();
      (AuthStorage.inMemory() must NOT be the default assignment.)

Task 3: VERIFY the auth.json-only runtime path (RED → GREEN)
  - RUN: npx vitest run tests/integration/config/pi-harness-auth.test.ts
  - EXPECT: Test Files 1 passed | Tests 2 passed.
      - case A "auth.json-only: getApiKey(zai) resolves the on-disk credential" → GREEN
        (getApiKey('zai') === 'SECRET-FROM-AUTH-JSON'). This was RED before Task 1.
      - case B "ZAI_API_KEY-only (control)" → still GREEN.
  - IF case A still returns undefined: the link did not take effect. Re-check Task 2 (readlink).
      Most likely cause: a stale vitest cache or the subprocess resolved a different node_modules
      (cwd). The runner script is written to the PROJECT ROOT and run with tsx, so cwd is the repo
      root — confirm you ran `npm link groundswell` from ~/projects/hacky-hack, not elsewhere.

Task 4: RUN the PRD repro (independent runtime confirmation)
  - RUN the /tmp/repro.mts script from Validation Loop → Level 3.
  - EXPECT: "harness can resolve zai key? true"  (getApiKey('zai') === 'SECRET-FROM-AUTH-JSON').
  - NOTE: Task 3 already exercises the identical path via the subprocess; Task 4 is an independent
      belt-and-suspenders proof using `npx tsx` directly (no vitest at all).

Task 5: DOCUMENT the production publish path + link reversal
  - WRITE nothing to the repo (no docs file — see "Why no docs subtask"). The production path is
      documented in THIS PRP's "Production Path & Link Reversal" section. Confirm in the final
      checklist that the note is present and accurate.
```

### Implementation Patterns & Key Details

```bash
# PATTERN: npm link (producer→global→consumer).
#   Producer:  cd ~/projects/groundswell && npm link      → registers $(npm root -g)/groundswell → ~/projects/groundswell
#   Consumer:  cd ~/projects/hacky-hack  && npm link groundswell  → node_modules/groundswell → global → ~/projects/groundswell
#   The full resolution: readlink -f node_modules/groundswell → /home/dustin/projects/groundswell
#
# PATTERN: verify a cross-repo dependency deploy with THREE independent signals:
#   (1) structural  — readlink -f + test -L  (the symlink exists and points at the fixed repo)
#   (2) content     — grep AuthStorage.create() in the deployed dist  (the fix is physically present)
#   (3) functional  — the non-mocked integration test (subprocess) resolves auth.json end-to-end
#   All three must agree. (1)+(2) without (3) is exactly the false confidence that let Issue 1 ship.)
#
# PATTERN: the subprocess defeats the vitest alias. vitest.config.ts alias.groundswell → sibling
#   checkout. spawnSync('tsx', [RUNNER]) has NO alias → import 'groundswell' resolves node_modules.
#   This is the ONLY way to test what hacky-hack actually imports at runtime.
```

### Integration Points

```yaml
DATABASE:
  - none
CONFIG:
  - none (no .envrc, .npmrc, or env-var changes; the link is a node_modules rewrite)
ROUTES:
  - none
BUILD / TOOLING:
  - `npm link` / `npm link groundswell` (no package.json, tsconfig, or vitest.config changes)
DEPENDENCIES:
  - DEPENDS-ON (completed): P1.M1.T2.S1 — the Groundswell fix is committed on main and the dist is
      rebuilt with AuthStorage.create(). (Verified: git clean, dist line 103 = create().)
  - DEPENDS-ON (completed): P1.M1.T1.S1 — the RED integration test exists and is failing on the
      stale dist, ready to flip GREEN.
  - ENABLES (downstream): P1.M1.T3 — validate-groundswell.ts hardening (file-backed assertion +
      symlink detection) can now be written/verified against the linked dist.
  - ENABLES (downstream): P1.M4.T1 — the README "auto-detected by the harness" promise becomes TRUE
      (verified post-link) rather than aspirational.
  - ENABLES (later, CI-gated): push ~/projects/groundswell main → semantic-release → npm v1.0.1 →
      hacky-hack `npm install groundswell@latest` + commit package-lock.json (production deploy).
```

## Validation Loop

### Level 1: Syntax & Style (structural link verification)

```bash
cd ~/projects/hacky-hack

# The link must be a real symlink pointing at the fixed repo.
readlink -f node_modules/groundswell
# Expected: /home/dustin/projects/groundswell

test -L node_modules/groundswell && echo SYMLINK || echo "NOT A SYMLINK — link failed"
# Expected: SYMLINK

# The deployed dist must use the file-backed auth store.
grep -n 'AuthStorage\.\(create\|inMemory\)()' node_modules/groundswell/dist/harnesses/pi-harness.js
# Expected (~line 103): this.authStorage = options?.authStorage ?? AuthStorage.create();
#   plus comment mentions at ~72/99 (fine). AuthStorage.inMemory() must NOT be the default assignment.
```

### Level 2: Unit/Integration Tests (the primary GREEN gate)

```bash
cd ~/projects/hacky-hack

# THE primary gate: the P1.M1.T1.S1 RED test flips to GREEN.
npx vitest run tests/integration/config/pi-harness-auth.test.ts
# Expected: Test Files 1 passed | Tests 2 passed.
#   case A (auth.json-only): getApiKey('zai') === 'SECRET-FROM-AUTH-JSON'   ← was RED, now GREEN
#   case B (ZAI_API_KEY control): getApiKey('zai') === 'SECRET-FROM-ENV'    ← stays GREEN
# If case A is STILL undefined: the link did not take effect for the subprocess. Re-run Task 2's
# readlink/grep; confirm the link is in ~/projects/hacky-hack (the subprocess cwd = repo root).

# Sanity: the validator still passes (it checks importability; it does NOT yet assert file-backed
# auth — that's P1.M1.T3. It passing on the linked dist is expected, not the auth proof.)
npm run validate:groundswell
# Expected: exits 0 (imports resolve; version OK). NOT a substitute for Level 2 case A.
```

### Level 3: Integration Testing (the PRD repro — independent tsx runtime proof)

```bash
cd ~/projects/hacky-hack

# The PRD's repro script (auth.json-only, no env vars), run via tsx (no vitest alias → hits the
# linked node_modules/groundswell). This is an independent confirmation of Level 2 case A.
cat > /tmp/repro-link.mts <<'EOF'
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
  await runAuthPreflight();
  await ensureHarnessInitialized();
  const h = (HarnessRegistry.getInstance() as any).harnesses?.get('pi');
  const key = await h.authStorage.getApiKey('zai', { includeFallback: false });
  console.log('preflight passed; harness can resolve zai key?', !!key, '| key=', key);
} finally { rmSync(tmp, { recursive:true, force:true }); for (const k of vars) if (saved[k]!==undefined) process.env[k]=saved[k]; }
EOF
npx tsx /tmp/repro-link.mts
# Expected (post-link): "preflight passed; harness can resolve zai key? true | key= SECRET-FROM-AUTH-JSON"
#   (Pre-link this printed "false". If it still prints false, the link is not resolving in the tsx
#    process — re-check readlink; ensure you are cwd'd in ~/projects/hacky-hack.)

rm -f /tmp/repro-link.mts   # cleanup
```

### Level 4: Creative & Domain-Specific Validation (production path — DRY-RUN ONLY)

```bash
cd ~/projects/hacky-hack

# A) Confirm the published-vs-linked divergence is real (proves the publish path is still needed).
md5sum node_modules/groundswell/dist/harnesses/pi-harness.js   # linked → fixed dist
# Compare with the STILL-PUBLISHED tarball (1.0.0) that CI would hand a fresh `npm install`:
npm view groundswell version            # → 1.0.0 (the stale published version; publish path pending)
# (Do NOT `npm install groundswell` here — it would revert the link to the stale 1.0.0.)

# B) semantic-release DRY-RUN in the groundswell repo (simulates the version bump WITHOUT publishing).
#    Confirms the committed fix: message → patch → 1.0.1 on push. OPTIONAL (may need GH/npm env).
cd ~/projects/groundswell
npx semantic-release --dry-run 2>&1 | grep -iE 'release|version|1\.0\.1|no releas' || true
# Expected: indicates a patch release (1.0.1) is queued from the fix(harnesses): commit.
#   (If it errors on missing GH/npm credentials, the dry-run still logs the planned version in most
#    configs. This is an OPTIONAL confirmation, not a hard gate. DO NOT run without --dry-run.)

# DO NOT (out of scope / CI-gated):
#   - git push (publishes via semantic-release in CI)
#   - npm publish (manual publish; CI owns it)
#   - npm install groundswell@latest in hacky-hack (no 1.0.1 exists yet; would revert the link)
```

## Production Path & Link Reversal (documented, NOT executed by this subtask)

This section satisfies Action C. It is documentation only.

### The permanent deployment (Option B — semantic-release)

1. **Commit** the Groundswell fix — ✅ DONE by P1.M1.T2.S1 (`fix(harnesses): use file-backed
   AuthStorage.create() …`). The `fix:` type → semantic-release classifies it as a **patch**.
2. **Push** `~/projects/groundswell` `main` to `origin`. semantic-release runs in CI: builds dist,
   runs tests, publishes **`groundswell@1.0.1`** to npm, tags the release. *(CI-gated; requires
   GitHub + npm credentials held by CI — out of scope for this subtask.)*
3. **Consume** in hacky-hack: the `package.json` range `"groundswell": "^1.0.0"` already permits
   1.0.1+, so run:
   ```bash
   cd ~/projects/hacky-hack
   npm install groundswell@latest      # pulls 1.0.1 from npm; refreshes package-lock.json
   git add package-lock.json && git commit -m "chore(deps): bump groundswell to 1.0.1 (file-backed AuthStorage, PRD §9.2.6)"
   ```
4. **Re-verify**: after `npm install groundswell@latest`, re-run Level 1 grep + Level 2 integration
   test against the freshly-installed (non-linked) dist — they must still pass.

### Link reversal (REQUIRED once 1.0.1 is consumed)

`npm link` is machine-local and leaves `node_modules/groundswell` as a symlink that is NOT
described by the lockfile. Once the published 1.0.1 is installed (step 3 above), the symlink must
be **reversed** so the tree is not left in a hybrid (linked-for-one-dev, tarball-for-everyone-else)
state:

```bash
cd ~/projects/hacky-hack
npm unlink groundswell             # removes the symlink
npm install                        # restores node_modules/groundswell from the lockfile (1.0.1)
# Verify the restored dist is the fixed (non-symlinked) copy:
test -L node_modules/groundswell && echo "STILL A SYMLINK (reversal incomplete)" || echo "plain dir (good)"
grep -n 'AuthStorage\.\(create\|inMemory\)()' node_modules/groundswell/dist/harnesses/pi-harness.js
# → AuthStorage.create()  (the published 1.0.1 carries the fix)
```

> **Why this matters**: if the link is not reversed, a teammate or CI doing a clean `npm install`
> gets the published tarball while this machine has the symlink — divergent behavior that is
> invisible in git. The link is a **verification tool**, not a deployment.

## Why no docs subtask

The item's DOCS line is `[Mode A] none — deployment/link operation`. The README promise (auth.json
*"auto-detected by the harness"*) becomes **TRUE** as a result of this link, but verifying/syncing
that documentation claim is the explicit scope of **P1.M4.T1.S1** (post-fix README accuracy check),
not this subtask. Creating a docs change here would duplicate P1.M4 and muddy the deploy/test
boundary. **Do not write any docs file in this subtask.**

## Final Validation Checklist

### Technical Validation

- [ ] Task 0: groundswell `git status` clean; `git log -1` == the `fix(harnesses):` commit; dist
      line ~103 == `AuthStorage.create()`; hacky-hack pre-link `node_modules/groundswell` is a stale
      plain dir; global link registered.
- [ ] Task 1: `npm link groundswell` run in `~/projects/hacky-hack`; no error.
- [ ] Level 1: `readlink -f node_modules/groundswell` → `/home/dustin/projects/groundswell`.
- [ ] Level 1: `test -L node_modules/groundswell` → SYMLINK.
- [ ] Level 1: `grep … pi-harness.js` → `AuthStorage.create()` in the constructor body (NOT inMemory).
- [ ] Level 2: `npx vitest run tests/integration/config/pi-harness-auth.test.ts` → **2/2 pass**
      (case A GREEN, case B control GREEN).
- [ ] Level 3: `/tmp/repro-link.mts` prints `harness can resolve zai key? true`.
- [ ] No hacky-hack tracked file modified (only `node_modules/groundswell` + the test's ephemeral
      runner script).

### Feature Validation

- [ ] The auth.json-only runtime path resolves the on-disk `zai` credential (`getApiKey('zai')` →
      `'SECRET-FROM-AUTH-JSON'`).
- [ ] The preflight and the harness now AGREE (both read auth.json) — no more false positive.
- [ ] The ZAI_API_KEY-only control path still works (case B GREEN) — the link didn't regress env auth.
- [ ] The deployed dist is the fixed one (symlink → `~/projects/groundswell`, `AuthStorage.create()`).

### Code Quality Validation

- [ ] No `sudo` used to force the link (fix node_modules ownership / remove stale dir instead).
- [ ] No `npm install` run AFTER linking (would revert the symlink to the stale 1.0.0).
- [ ] No push, no publish, no `npm install groundswell@latest` (CI-gated / no 1.0.1 yet).
- [ ] No `validate:groundswell` edit (hardening is P1.M1.T3) and no docs edit (P1.M4.T1).
- [ ] No test file edited (the P1.M1.T1.S1 test is the gate; it is consumed, not modified).

### Documentation & Deployment

- [ ] The production publish path (push → semantic-release → 1.0.1 → `npm install groundswell@latest`
      → commit lockfile) is documented above.
- [ ] The link-reversal procedure (`npm unlink groundswell && npm install`) is documented above.
- [ ] The README "auto-detected by the harness" promise is noted as becoming TRUE (verified in
      P1.M4.T1, not here).

---

## Scope Boundaries (DO NOT EXPAND)

This subtask is **npm link + verify + document the publish path**. The following are explicitly
OUT OF SCOPE and owned by sibling subtasks:

- ❌ Hardening `src/scripts/validate-groundswell.ts` (file-backed auth assertion + symlink detection)
      → **P1.M1.T3.S1 / S2**.
- ❌ Syncing README/docs/`.env.example` accuracy → **P1.M4.T1.S1 / S2**.
- ❌ Pushing Groundswell to GitHub / `npm publish` / `semantic-release` (no `--dry-run`) → CI-gated,
      requires credentials; documented as the production path only.
- ❌ `npm install groundswell@latest` / bumping `package-lock.json` in hacky-hack → only valid AFTER
      1.0.1 is published (CI follow-up); doing it now reverts the link to the stale 1.0.0.
- ❌ Modifying ANY hacky-hack tracked file (source, lockfile, docs, tests, vitest.config).
- ❌ Editing the P1.M1.T1.S1 integration test (it is the verification gate; consume it, don't change it).
- ❌ Fixing pre-existing unrelated vitest failures (Issue 2/3) → **P1.M2 / P1.M3**.

---

## Anti-Patterns to Avoid

- ❌ Don't run only the producer `npm link` (in groundswell) and skip the consumer
  `npm link groundswell` (in hacky-hack) — the consumer side is the actual deploy; without it
  `node_modules/groundswell` stays the stale plain dir and the test stays RED.
- ❌ Don't run `npm install` (or `npm install groundswell` / `@latest`) AFTER linking — npm will
  re-resolve `^1.0.0` to the published 1.0.0 tarball and overwrite the symlink, silently reverting
  the fix.
- ❌ Don't verify with an IN-PROCESS unit test — the vitest `resolve.alias.groundswell` masks the
  bug (resolves to the sibling checkout regardless). Verify ONLY via the subprocess integration test
  (Level 2) or a direct `npx tsx` repro (Level 3).
- ❌ Don't treat `npm run validate:groundswell` passing as proof of the auth fix — it only checks
  importability; it passes on the stale dist too. Use Level 2 case A as the real gate.
- ❌ Don't use `sudo` to force the link — fix the `node_modules` ownership or remove the stale
  `node_modules/groundswell` directory first (`rm -rf node_modules/groundswell && npm link groundswell`).
- ❌ Don't push, publish, or `semantic-release` (non-dry-run) — CI-gated; documented only.
- ❌ Don't commit the link state or create a docs file — the link is untracked by design; docs sync
  is P1.M4.T1.
- ❌ Don't edit the integration test "to make it pass" — if case A is still RED after linking, the
  cause is the link not taking effect (re-check `readlink`), NOT the test.
- ❌ Don't forget to document the link-reversal step — a lingering symlink creates a divergent,
  git-invisible hybrid tree once 1.0.1 is published.

---

**Confidence Score: 9.5/10** for one-pass implementation success. The deploy is a single
`npm link groundswell` in hacky-hack, and every prerequisite is verified present: the Groundswell
fix is committed (S1 ✅, `git clean`, dist line 103 = `AuthStorage.create()`), the producer-side
global link is already registered (`npm ls -g`), the RED integration test is in place and failing
exactly as designed, and the vitest-alias masking behavior is understood (hence the mandatory
subprocess verification). The 0.5 residual risk is operational: the implementer running
`npm install` after linking (which reverts the symlink), or verifying via an in-process test (which
the alias masks) — both are explicitly fenced off above. The production publish path and link
reversal are documented so the machine-local link is not mistaken for a permanent deployment.
