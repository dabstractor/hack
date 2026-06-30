# PRP — P1.M1.T2.S3: Subprocess acceptance test — claude-code + zai → clean exit 1, NO raw stack trace

> **Scope:** TEST-ONLY. No source code, no docs, no config/API surface change. This subtask
> verifies (via a build-guarded subprocess suite against the **built `dist/`**) that the
> claude-code+zai harness/provider mismatch — which previously crashed at module load with a
> raw Node stack trace + `Node.js v26.2.0` banner — now fails cleanly: **exit 1, single friendly
> `❌` message on stderr, no raw stack/banner, no session dir.**
>
> **Depends on (both COMPLETE in source):**
> - P1.M1.T2.S1 — lazy `resolvedHarness()` accessor in `src/agents/agent-factory.ts` (removed module-eval `configureHarness()` side effect).
> - P1.M1.T2.S2 — explicit `configureHarness()` call in `main()` (after local-only early-returns, before preflight) + `HarnessProviderMismatchError` arm in `main().catch()`.
>
> All concrete outputs below were **captured live** from the working tree — see `research/verified-subprocess-behavior.md`.

---

## Goal

**Feature Goal**: A build-guarded subprocess acceptance test that proves, against the compiled `dist/index.js`, that an invalid `PRP_AGENT_HARNESS=claude-code` + default `zai` configuration aborts at startup with exit code 1 and a single actionable `❌ <message>` on stderr — with **no** raw `file://` stack frames, `at ModuleJob.run`, `HarnessProviderMismatchError:` header line, or `Node.js v…` banner — and creates **no** `plan/NNN_<hash>/` session dir.

**Deliverable**: One new test file OR an extended acceptance block in an existing test file (see Placement), containing:
1. The core mismatch test (claude-code+zai → clean exit 1, clean message, no stack, no session dir).
2. *(Recommended)* A regression control proving the module-load crash is gone (claude-code config no longer crashes local-only modes).
3. *(Verification, not new code)* Confirmation that `src/agents/agent-factory.ts` in-process coverage is not reduced by S1's lazy accessor.

**Success Definition**: After `npm run build`, `npx vitest run <the new/extended test file>` passes; the test does NOT skip (build present); the assertions on `res.status`, `res.stderr` content (present + absent), and the `plan/` session-dir before/after set all hold. No new source/docs changes.

---

## Why

- **Closes bugfix PRD Issue 2 (§h3.3)**: the `claude-code`+`zai` combination is genuinely invalid (PRD §9.4.3 / §9.2.4), but it must surface as a clean one-liner consistent with the §9.2.7 preflight UX, not a raw stack trace.
- **Proves S1 + S2 end-to-end on the BUILT artifact** (not just in-process mocks): the vitest `groundswell` resolve-alias + hoisted `vi.mock` would **mask** module-load ordering — only `spawnSync(dist/index.js)` exercises the real import graph (see `architecture/system_context.md` §6 and `architecture/test-conventions.md` §4).
- **Regression fence**: locks the clean-error contract so a future refactor cannot silently re-introduce the module-eval `configureHarness()` side effect.

---

## What

### Behavior under test (built CLI, scrubbed env, `PRP_AGENT_HARNESS=claude-code`, no credential, no model override → provider stays default `zai`)

| Property | Required value |
| --- | --- |
| Exit code `res.status` | `1` |
| stderr **contains** | `incompatible with provider`, `'claude-code'`, `'zai'`, `§9.2.4`, `PRP_AGENT_HARNESS=pi` (switch-harness remediation), `anthropic` (switch-provider remediation) |
| stderr **does NOT contain** | `Node.js v` (banner), `at ModuleJob.run` (stack), `at file://` (stack frame), `HarnessProviderMismatchError:` (the raw `ErrorClass:` header Node prepends only to uncaught errors) |
| New `plan/NNN_<hash>/` session dir | **none** created (before/after dir set equal) |

### Success Criteria

- [ ] New build-guarded subprocess test passes (build present) and skips cleanly (build absent) via `describeOrSkip`.
- [ ] Core mismatch test: `--prd PRD.md` (NO `--dry-run`) + `PRP_AGENT_HARNESS=claude-code` + scrubbed env → exit 1 + clean message + no stack/banner + no session dir.
- [ ] `src/agents/agent-factory.ts` in-process coverage is **not reduced** by S1 (memoization branch still hit by existing agent-config tests).
- [ ] `npx vitest run tests/unit/config/auth-preflight.test.ts` still green (the existing acceptance (a) + P1.M1.T1.S2 dry-run/validate-prd tests are not disturbed).

---

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed to implement this successfully?_ **Yes** — the exact pattern to copy, the exact command (with the critical `--dry-run` gotcha resolved), the exact GOOD/BAD output substrings (captured live), and the exact test-runner/build commands are all below.

### Documentation & References

```yaml
# ── Architecture / conventions (READ FIRST) ──────────────────────────────
- docfile: plan/007_8783a1f5e14a/bugfix/002_edc62322bc90/architecture/test-conventions.md
  why: §4 (Pattern A spawnSync + scrubbed env + describeOrSkip build guard), §5 (describe/it naming),
       §6 (existing clean-error assertions), §8 (start-here summary for new subprocess tests).
  critical: "§1 — vitest `resolve.alias.groundswell` → the alias MASKS module-load ordering; this is
            WHY the test must be subprocess spawnSync, not in-process. §2 — scrubbed env requires
            only PATH/HOME/USER/SHELL/PI_CODING_AGENT_DIR; for THIS test we ADD PRP_AGENT_HARNESS."

- docfile: plan/007_8783a1f5e14a/bugfix/002_edc62322bc90/architecture/system_context.md
  why: §1 (startup flow + import graph), §3 (root cause of Issue 2 + the lazy-accessor fix), §4 (final
       main() ordering — line numbers), §6 (coverage reality: index.ts 0%, agent-factory.ts in-process).
  critical: "§6 — index.ts is 0% (subprocess doesn't feed v8 coverage); do NOT chase 100%, do NOT add
            istanbul-ignore. agent-factory.ts DOES take in-process coverage — verify not reduced."

# ── The pattern to COPY (subprocess acceptance) ──────────────────────────
- file: tests/unit/config/auth-preflight.test.ts
  why: "THE template. Lines ~188–368: `const CLI = resolve(process.cwd(),'dist/index.js')`;
        `const describeOrSkip = existsSync(CLI) ? describe : describe.skip`;
        scrubbed `env` object (PATH/HOME/USER/SHELL/PI_CODING_AGENT_DIR→mkdtempSync);
        `plan/` before/after session-dir set comparison (sessRe = /^\\d{3}_[0-9a-f]{12}$/);
        `spawnSync(process.execPath, [CLI,'--prd',prdAbs], {encoding:'utf8', timeout:20_000, env})`."
  pattern: "Acceptance `describe` titled `acceptance (X) — <summary citing PRD §>`. Body comments use
            SETUP / EXECUTE / VERIFY dividers. `rmSync(tmpAgentDir,{recursive:true,force:true})` at end."
  gotcha: "`prdAbs = resolve(process.cwd(),'PRD.md')` MUST point at the real repo PRD.md — avoids the
           parseCLIArgs existsSync trap (else you'd see 'PRD file not found', not the mismatch)."

# ── The error class + exact message (assertion source of truth) ──────────
- file: src/config/types.ts
  why: "Lines 141–161 — HarnessProviderMismatchError. Exact message text (assert against it verbatim):
        `Harness '<harness>' is incompatible with provider '<provider>' (PRD §9.2.4). Switch the
        harness to 'pi' (PRP_AGENT_HARNESS=pi) or switch the model provider to anthropic/* models.`"
  critical: "Clean render path is `console.error(\\`\\n❌ ${error.message}\\`)` → stderr gets ONLY the
            message (no `HarnessProviderMismatchError:` header, no stack). That header line is the
            cleanest discriminator: PRESENT in the bug, ABSENT after the fix."

# ── The fix being verified (S1+S2, already in source) ────────────────────
- file: src/agents/agent-factory.ts
  why: "S1 — lazy `resolvedHarness()` accessor (lines ~47–60); removed module-eval `configureHarness()`."
- file: src/index.ts
  why: "S2 — main() ordering (L130 logger; L142 dryRun return; L156 validatePrd return; L211
        configureHarness(); L212 runAuthPreflight()) and main().catch() HarnessProviderMismatchError arm."

# ── Verified behavior captured live (GOOD/BAD output substrings) ─────────
- docfile: plan/007_8783a1f5e14a/bugfix/002_edc62322bc90/P1M1T2S3/research/verified-subprocess-behavior.md
  why: "Full BAD output (matches PRD §h3.3), GOOD output format (via AuthPreflightError clean render),
        exact message text, the --dry-run command gotcha, coverage realities, build/runner commands."
```

### Current Codebase tree (relevant slice)

```bash
src/
  index.ts                       # main() ordering (S2 done) + main().catch() mismatch arm (S2 done)
  agents/agent-factory.ts        # lazy resolvedHarness() accessor (S1 done)
  config/harness.ts              # configureHarness() — throws HarnessProviderMismatchError on mismatch
  config/types.ts                # HarnessProviderMismatchError (exact message) + AuthPreflightError
tests/
  unit/config/
    auth-preflight.test.ts       # ← PATTERN SOURCE: acceptance (a) subprocess block (L188–368)
    harness-provider-compat.test.ts  # in-process mismatch assertions (regression guard, still pass)
    harness-config.test.ts           # in-process configureHarness() throw (regression guard, still pass)
    harness.test.ts                  # HarnessProviderMismatchError class-level tests
  integration/
    agents.test.ts               # constructs agent configs → covers agent-factory.ts lazy accessor in-process
dist/index.js                    # STALE build (gitignored) — MUST `npm run build` before running the test
vitest.config.ts                 # v8 coverage, 100% gate, `resolve.alias.groundswell` (masks module-load)
package.json                     # build=tsc -p tsconfig.build.json; test:run=vitest run
```

### Desired Codebase tree with files to be added

```bash
# PREFERRED (Option A) — extend the existing acceptance file (reuses CLI/hasBuild/describeOrSkip/scrubbed-env machinery):
tests/unit/config/auth-preflight.test.ts   # MODIFY: append a new describeOrSkip('acceptance — harness/provider mismatch …') block

# ACCEPTABLE ALTERNATIVE (Option B) — new focused file (copy the boilerplate from auth-preflight.test.ts):
tests/unit/config/harness-error.test.ts    # CREATE: standalone build-guarded subprocess suite for the mismatch
```

**Responsibility of the change**: prove the claude-code+zai mismatch fails cleanly on the built CLI (exit 1, single `❌` message, no raw stack/banner, no session dir) + regression control proving the module-load crash is gone. Test-only; no production code.

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL (resolves a latent inconsistency in the work-item CONTRACT):
// The work item says spawn [CLI, '--prd', absPrd, '--dry-run']. DO NOT USE --dry-run for the
// mismatch test. After S1's reorder, `--dry-run` returns at src/index.ts main() L142 — BEFORE
// configureHarness() at L211 — so --dry-run + claude-code exits 0 (DRY RUN banner) and the
// mismatch is NEVER thrown. Use `[CLI, '--prd', absPrd]` (NO --dry-run) to reach the agent path.
// (--dry-run is still useful as a SEPARATE regression control — see Task 2b.)

// CRITICAL: dist/ is STALE. `dist/agents/agent-factory.js` still has the module-eval
// `const RESOLVED_HARNESS = configureHarness();`. `npm run build` (tsc -p tsconfig.build.json) is
// MANDATORY before the test can run/pass. describeOrSkip guards the no-build case (skip), but a
// stale build will make the test FAIL showing the bug — so build first.

// CRITICAL: vitest `resolve.alias.groundswell` → ../groundswell/dist, AND hoisted vi.mock('groundswell')
// in harness tests. BOTH mask module-load ordering. => the mismatch ordering MUST be exercised via
// spawnSync(dist/index.js), never in-process. (test-conventions §1, §4.)

// COVERAGE: src/index.ts is 0% in the committed report (main() unexported; auto-runs via
// void main().catch(); subprocess spawnSync does NOT feed v8 in-process coverage). Do NOT chase
// 100%, do NOT add /* istanbul ignore */. The subprocess suite IS the authoritative acceptance path.
// src/agents/agent-factory.ts DOES take in-process coverage — its lazy accessor memoization branch
// is covered by tests/integration/agents.test.ts (constructs configs). VERIFY not reduced by S1.

// GOTCHA: prdAbs MUST resolve to the real repo PRD.md (resolve(process.cwd(),'PRD.md')) so parseCLIArgs
// does not short-circuit with 'PRD file not found' before main() reaches configureHarness().
```

---

## Implementation Blueprint

### Data models and structure

_None._ Test-only; no ORM/pydantic/schema models. The only "model" is the inline `scrubbedEnv` object and the `sessRe` regex (copy verbatim from `auth-preflight.test.ts`).

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0 (PREREQUISITE, not a file change): REBUILD dist
  - RUN: npm run build     # tsc -p tsconfig.build.json
  - WHY: dist/ is stale (still has the module-eval RESOLVED_HARNESS side effect). The subprocess test
         asserts the FIXED behavior; without a rebuild it either skips (no build) or fails (stale build).
  - VERIFY: rg -n "const RESOLVED_HARNESS = configureHarness" dist/agents/agent-factory.js  → 0 hits
            (should now contain the lazy resolvedHarness accessor instead).

Task 1: CHOOSE PLACEMENT (pick ONE)
  - OPTION A (PREFERRED): MODIFY tests/unit/config/auth-preflight.test.ts — append a new sibling block:
        describeOrSkip('acceptance — harness/provider mismatch (claude-code+zai) renders cleanly: exit 1, single message, NO raw stack (PRD §h3.3 / §9.4.3 / §9.2.4)', () => { … })
    Reuses the file-scope `CLI`, `hasBuild`, `describeOrSkip`, `mkdtempSync`/`rmSync`, `resolve`, `readdirSync`,
    `spawnSync` already imported at the top of the file. Lowest friction; colocates startup-abort acceptance.
  - OPTION B (ACCEPTABLE): CREATE tests/unit/config/harness-error.test.ts — copy the header JSDoc style +
    the `CLI`/`hasBuild`/`describeOrSkip` + scrubbed-env + plan-dir before/after boilerplate verbatim from
    auth-preflight.test.ts (lines ~1–60, ~188–215). Clean separation; more boilerplate.
  - FOLLOW pattern: tests/unit/config/auth-preflight.test.ts acceptance (a) block (L188–246).

Task 2: IMPLEMENT the core mismatch test (the deliverable)
  NAMING: it('exits 1, prints the single friendly HarnessProviderMismatchError message on stderr, NO raw stack/banner, NO session dir', () => { … })
  SETUP:
    - tmpAgentDir = mkdtempSync(join(tmpdir(), 'harness-mismatch-spawn-'))
    - prdAbs      = resolve(process.cwd(), 'PRD.md')          // real repo PRD (avoids parseCLIArgs trap)
    - scrubbedEnv = {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        USER: process.env.USER,
        SHELL: process.env.SHELL,
        PI_CODING_AGENT_DIR: tmpAgentDir,        // empty temp dir — NO auth.json, NO creds
        PRP_AGENT_HARNESS: 'claude-code',        // ← the mismatch trigger; NO model override → provider stays 'zai'
      }                                          // DO NOT include ZAI_API_KEY/PRP_API_KEY/ANTHROPIC_*/any model override
    - planDir = resolve(process.cwd(), 'plan'); sessRe = /^\d{3}_[0-9a-f]{12}$/
    - before  = existsSync(planDir) ? new Set(readdirSync(planDir).filter(s => sessRe.test(s))) : new Set()
  EXECUTE:
    - const res = spawnSync(process.execPath, [CLI, '--prd', prdAbs], {   // ← NO --dry-run (see gotcha)
        encoding: 'utf8', timeout: 20_000, env: scrubbedEnv,
      })
  VERIFY:
    - expect(res.status).toBe(1)
    - // PRESENT — the friendly message body + BOTH remediations
      expect(res.stderr).toContain('incompatible with provider')
      expect(res.stderr).toContain("'claude-code'")
      expect(res.stderr).toContain("'zai'")
      expect(res.stderr).toContain('§9.2.4')
      expect(res.stderr).toContain('PRP_AGENT_HARNESS=pi')   // switch-harness remediation
      expect(res.stderr).toContain('anthropic')              // switch-provider remediation
    - // ABSENT — the raw module-load crash signatures (the bug)
      expect(res.stderr).not.toContain('Node.js v')          // version banner
      expect(res.stderr).not.toContain('at ModuleJob.run')   // stack frame
      expect(res.stderr).not.toContain('at file://')         // stack frame (file:// URL frames)
      expect(res.stderr).not.toContain('HarnessProviderMismatchError:')  // raw ErrorClass header (cleanest discriminator)
    - // No new session dir created (mismatch throws BEFORE PRPPipeline/session work)
      const after = existsSync(planDir) ? new Set(readdirSync(planDir).filter(s => sessRe.test(s))) : new Set()
      expect([...after].sort()).toEqual([...before].sort())
    - rmSync(tmpAgentDir, { recursive: true, force: true })
  DEPENDENCIES: Task 0 (fresh build) + Task 1 (placement).
  PLACEMENT: inside the describeOrSkip block chosen in Task 1.

Task 2b (RECOMMENDED regression control — proves S1 module-load crash is gone):
  NAMING: it('claude-code config does NOT crash local-only --dry-run (module-load side effect removed): exit 0, NO raw stack', () => { … })
  - Same scrubbedEnv (PRP_AGENT_HARNESS='claude-code', no cred).
  - EXECUTE: spawnSync(process.execPath, [CLI, '--prd', prdAbs, '--dry-run'], {encoding:'utf8', timeout:20_000, env:scrubbedEnv})
  - VERIFY:
      expect(res.status).toBe(0)                              // dry-run succeeds
      expect(res.stdout).toContain('DRY RUN')                 // dry-run banner on stdout
      expect(res.stderr).not.toContain('Node.js v')           // no module-load crash
      expect(res.stderr).not.toContain('HarnessProviderMismatchError:')  // no raw error header
      expect(res.stderr).not.toContain('incompatible with provider')     // mismatch NOT triggered on dry-run path
  - WHY: before S1, claude-code+zai crashed at IMPORT time for EVERY flag (incl. --dry-run/--help).
         This control locks that the lazy accessor removed the import-time side effect.
  - ALTERNATIVE (if you prefer not to add it): rely on P1.M1.T1.S2's existing --dry-run/--validate-prd
    exit-0 subprocess tests (in auth-preflight.test.ts) + in-process coverage of agent-factory.ts. Those
    do NOT set PRP_AGENT_HARNESS=claude-code though, so Task 2b is the stronger regression fence.

Task 3: VERIFY agent-factory.ts in-process coverage is not reduced by S1
  - RUN: npx vitest run tests/integration/agents.test.ts tests/unit/config/harness-config.test.ts tests/unit/config/harness-provider-compat.test.ts --coverage
  - CHECK: src/agents/agent-factory.ts reports 100% statements/branches/functions/lines (the lazy
           resolvedHarness() memoization branch — `if (_resolvedHarness === undefined)` true AND false —
           is hit because agents.test.ts constructs multiple agent configs in one worker).
  - IF reduced: do NOT add istanbul-ignore. Instead ensure agents.test.ts (or another in-process test)
    invokes createBaseConfig ≥2× so both memoization branches execute. (No new test needed if already covered.)
  - NOTE: src/index.ts will still report 0% — that is PRE-EXISTING and expected (subprocess does not feed
          v8 coverage). Do NOT attempt to raise it.

Task 4: NO source / docs changes
  - This is test-only. Do NOT modify src/, PRD.md, README.md, docs/, or any config. If a source change
    appears necessary, STOP — S1/S2 are already complete in source; the defect is in dist (rebuild) or
    in the test assertions, not in production code.
```

### Implementation Patterns & Key Details

```ts
// === The exact pattern to copy (from auth-preflight.test.ts L188–246) ===
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const CLI = resolve(process.cwd(), 'dist/index.js');
const hasBuild = existsSync(CLI);
const describeOrSkip = hasBuild ? describe : describe.skip;   // build guard — skip when no dist

describeOrSkip('acceptance — harness/provider mismatch (claude-code+zai) renders cleanly (PRD §h3.3)', () => {
  it('exits 1, single friendly message, NO raw stack/banner, NO session dir', () => {
    // SETUP
    const tmpAgentDir = mkdtempSync(join(tmpdir(), 'harness-mismatch-'));
    const prdAbs = resolve(process.cwd(), 'PRD.md');          // REAL repo PRD — avoids parseCLIArgs trap
    const env = {
      PATH: process.env.PATH, HOME: process.env.HOME,
      USER: process.env.USER, SHELL: process.env.SHELL,
      PI_CODING_AGENT_DIR: tmpAgentDir,                       // empty temp dir — NO creds, NO auth.json
      PRP_AGENT_HARNESS: 'claude-code',                        // mismatch trigger; NO model override → 'zai'
    };
    const planDir = resolve(process.cwd(), 'plan');
    const sessRe = /^\d{3}_[0-9a-f]{12}$/;
    const before = existsSync(planDir)
      ? new Set(readdirSync(planDir).filter(s => sessRe.test(s)))
      : new Set<string>();

    // EXECUTE — NOTE: NO --dry-run (dry-run returns before configureHarness(); see gotcha)
    const res = spawnSync(process.execPath, [CLI, '--prd', prdAbs], {
      encoding: 'utf8', timeout: 20_000, env,
    });

    // VERIFY — exit + friendly message present
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('incompatible with provider');
    expect(res.stderr).toContain("'claude-code'");
    expect(res.stderr).toContain("'zai'");
    expect(res.stderr).toContain('§9.2.4');
    expect(res.stderr).toContain('PRP_AGENT_HARNESS=pi');     // switch-harness remediation
    expect(res.stderr).toContain('anthropic');                // switch-provider remediation

    // VERIFY — raw module-load crash signatures ABSENT (the bug)
    expect(res.stderr).not.toContain('Node.js v');
    expect(res.stderr).not.toContain('at ModuleJob.run');
    expect(res.stderr).not.toContain('at file://');
    expect(res.stderr).not.toContain('HarnessProviderMismatchError:');

    // VERIFY — no session dir created
    const after = existsSync(planDir)
      ? new Set(readdirSync(planDir).filter(s => sessRe.test(s)))
      : new Set<string>();
    expect([...after].sort()).toEqual([...before].sort());

    rmSync(tmpAgentDir, { recursive: true, force: true });
  });
});

// GOTCHA (repeat): `--dry-run` would make res.status === 0 (dry-run returns at main() L142, before
// configureHarness() at L211). The mismatch test MUST use `[CLI, '--prd', prdAbs]` with NO --dry-run.
// Use `--dry-run` only in the separate Task 2b regression control.
```

### Integration Points

```yaml
BUILD:
  - prerequisite: "npm run build  (tsc -p tsconfig.build.json) — dist/ is stale; mandatory before the test runs/passes"
  - verify:       "rg 'const RESOLVED_HARNESS = configureHarness' dist/agents/agent-factory.js  → 0 hits after rebuild"

TEST RUNNER:
  - add to: the new/extended test file under tests/unit/config/  (vitest include glob: tests/**/*.{test,spec}.ts)
  - run:    "npx vitest run tests/unit/config/auth-preflight.test.ts"   (Option A)
            "npx vitest run tests/unit/config/harness-error.test.ts"    (Option B)
  - pattern: "describeOrSkip = existsSync(CLI) ? describe : describe.skip  (skips cleanly in CI without a build)"

COVERAGE:
  - gate: "vitest.config.ts enforces 100% on src/**/*.ts (v8 provider). src/index.ts is PRE-EXISTING 0%
           (subprocess does not feed v8 coverage) — do NOT block on it. VERIFY src/agents/agent-factory.ts
           stays 100% (lazy accessor memoization branch hit by tests/integration/agents.test.ts)."

NO CHANGES TO:
  - src/** (S1/S2 already complete), PRD.md, README.md, docs/**, .env*, package.json, vitest.config.ts,
    any config. Test-only change.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Type-check + lint the new/edited test file (project uses tsc + eslint)
npx tsc --noEmit -p tsconfig.json
npx eslint tests/unit/config/<your-file>.ts --fix
# Expected: zero errors. (No source files changed, so src/ type-check is unaffected.)
```

### Level 2: Unit / Subprocess Tests (Component Validation)

```bash
# 0. MANDATORY: rebuild dist (it is stale — still has the module-eval RESOLVED_HARNESS side effect)
npm run build
rg -n "const RESOLVED_HARNESS = configureHarness" dist/agents/agent-factory.js   # expect 0 hits

# 1. Run the new/extended subprocess acceptance suite
npx vitest run tests/unit/config/auth-preflight.test.ts -t "harness/provider mismatch"   # Option A
#   or:  npx vitest run tests/unit/config/harness-error.test.ts                          # Option B
# Expected: the mismatch test PASSES (res.status===1, message present, stack/banner absent, no session dir).
#           Confirm it did NOT skip (build present). If it skips, dist build failed — redo `npm run build`.

# 2. Regression — the existing acceptance tests still pass (reorder + S1/S2 did not break them)
npx vitest run tests/unit/config/auth-preflight.test.ts
npx vitest run tests/unit/config/harness-provider-compat.test.ts tests/unit/config/harness-config.test.ts tests/unit/config/harness.test.ts
# Expected: all green.
```

### Level 3: Manual / Subprocess Verification (System Validation)

```bash
# Reproduce the FIXED behavior by hand against the freshly built CLI (matches the assertions):
TMP=$(mktemp -d)
env -u ZAI_API_KEY -u PRP_API_KEY -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_OAUTH_TOKEN \
    PI_CODING_AGENT_DIR="$TMP" PRP_AGENT_HARNESS=claude-code \
    node dist/index.js --prd PRD.md            # NOTE: NO --dry-run
echo "EXIT=$?"
# Expected: EXIT=1 and stderr is EXACTLY one line:
#   ❌ Harness 'claude-code' is incompatible with provider 'zai' (PRD §9.2.4). Switch the harness to
#     'pi' (PRP_AGENT_HARNESS=pi) or switch the model provider to anthropic/* models.
# NO `file://` frame, NO `at ModuleJob.run`, NO `HarnessProviderMismatchError:` header, NO `Node.js v…`.
rm -rf "$TMP"

# Negative control: confirm a stale build still shows the BUG (sanity — proves the test would catch a regression)
# (Only if you want to witness the bad output: revert dist OR skip `npm run build` and re-run the same command.)
```

### Level 4: Coverage Verification

```bash
# Confirm agent-factory.ts lazy accessor stays fully covered in-process (S1 did not reduce coverage)
npx vitest run tests/integration/agents.test.ts tests/unit/config/harness-config.test.ts \
              tests/unit/config/harness-provider-compat.test.ts --coverage
# Expected: src/agents/agent-factory.ts → 100% statements/branches/functions/lines.
#           src/index.ts → 0% (PRE-EXISTING, expected — do NOT attempt to raise, do NOT add istanbul-ignore).
```

---

## Final Validation Checklist

### Technical Validation

- [ ] `npm run build` ran; `dist/agents/agent-factory.js` no longer has module-eval `configureHarness()`.
- [ ] `npx tsc --noEmit` clean; `npx eslint <test-file> --fix` clean.
- [ ] New subprocess mismatch test PASSES (build present) and does NOT skip.
- [ ] `npx vitest run tests/unit/config/auth-preflight.test.ts` fully green (existing + new).
- [ ] `src/agents/agent-factory.ts` in-process coverage unchanged at 100%.

### Feature Validation

- [ ] Core test: `res.status === 1`, stderr contains `incompatible with provider` + `'claude-code'` + `'zai'` + `§9.2.4` + `PRP_AGENT_HARNESS=pi` + `anthropic`.
- [ ] Core test: stderr does NOT contain `Node.js v` / `at ModuleJob.run` / `at file://` / `HarnessProviderMismatchError:`.
- [ ] Core test: no new `plan/NNN_<hash>/` session dir created (before/after sets equal).
- [ ] Core test command uses `[CLI, '--prd', prdAbs]` (NO `--dry-run`) — confirmed reaches `configureHarness()`.
- [ ] (If added) Task 2b control: claude-code + `--dry-run` → exit 0, no stack (module-load crash gone).

### Code Quality Validation

- [ ] Follows existing subprocess acceptance pattern (spawnSync + describeOrSkip + scrubbed env + plan-dir set diff).
- [ ] describe/it naming matches §5 conventions (PRD section cited; `acceptance — <summary>` prefix).
- [ ] Header JSDoc cites PRD §h3.3 / §9.4.3 / §9.2.4 (mirror auth-preflight.test.ts header style).
- [ ] Anti-patterns avoided: no `--dry-run` on the mismatch test; no in-process attempt to exercise module-load ordering; no `/* istanbul ignore */`; no source/docs/config changes.

### Scope Discipline

- [ ] NO changes to `src/**`, `PRD.md`, `README.md`, `docs/**`, `.env*`, `package.json`, `vitest.config.ts`.
- [ ] If a source change seemed necessary, STOP and re-read S1/S2 — they are already complete in source.

---

## Anti-Patterns to Avoid

- ❌ **Don't use `--dry-run` on the mismatch test** — it returns at `main()` L142 before `configureHarness()` (L211), so the mismatch never fires (exit 0). Use `[CLI, '--prd', prdAbs]`. (This is the single most likely way to write a wrong/confused test.)
- ❌ **Don't skip `npm run build`** — `dist/` is stale (still has the module-eval side effect); the test will skip (no build) or fail showing the bug (stale build).
- ❌ **Don't exercise module-load ordering in-process** — the vitest `groundswell` alias + hoisted `vi.mock` mask it. Subprocess `spawnSync(dist/index.js)` is mandatory (test-conventions §1/§4).
- ❌ **Don't chase 100% on `src/index.ts`** or add `/* istanbul ignore */` — it is pre-existing 0% (subprocess doesn't feed v8 coverage). The subprocess suite IS the acceptance path.
- ❌ **Don't modify source/docs/config** — S1/S2 are complete; this is test-only.
- ❌ **Don't hardcode the Node version in assertions** — assert `not.toContain('Node.js v')` (prefix), not a specific version string.
- ❌ **Don't rely solely on `res.status === 1`** — both the bug AND the fix exit 1; the discriminator is the stderr CONTENT (clean message present, stack/banner absent).

---

## Confidence Score

**9/10** for one-pass implementation success.

Rationale: the exact pattern to copy (`auth-preflight.test.ts` acceptance (a)), the exact GOOD/BAD output substrings (captured live), the exact error message text, the build prerequisite, the placement options, and the pivotal `--dry-run` gotcha are all specified with verifiable commands. The only residual risk is the implementer ignoring the `--dry-run` warning — which is why it is repeated in three places (Gotchas, Task 2, Anti-Patterns) and the manual Level-3 repro shows the correct command. Deducted 1 point for the (acceptable) placement choice ambiguity and the optional Task 2b/coverage-verification steps that require judgment.
