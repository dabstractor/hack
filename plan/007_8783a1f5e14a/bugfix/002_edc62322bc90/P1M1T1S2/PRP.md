# PRP — P1.M1.T1.S2: Subprocess acceptance tests — `--validate-prd` & `--dry-run` succeed with NO credential

> **Bugfix subtask** — Issue 1 of
> `plan/007_8783a1f5e14a/bugfix/002_edc62322bc90/TEST_RESULTS.md` (Major: auth preflight
> blocks pure-local CLI modes). S1 reordered `main()` so `--validate-prd` / `--dry-run`
> early-return **before** the §9.2.7 credential preflight. S2 adds the **end-to-end
> subprocess acceptance tests** proving both modes run credential-free on the built CLI.

---

## Goal

**Feature Goal**: Add build-guarded **subprocess** acceptance tests that prove the built CLI
(`dist/index.js`) runs `--validate-prd` and `--dry-run` to a clean `exit 0` with a **fully
scrubbed environment containing zero API credentials** — and that this bypasses the auth
preflight (no `'Authentication preflight failed'` message) and creates **no** `plan/NNN_*`
session directory.

**Deliverable**: New test coverage in `tests/unit/config/auth-preflight.test.ts` — extend the
existing `describeOrSkip` acceptance block with two new `it(...)` cases (one per local mode) —
mirroring Pattern A (the existing no-credential-abort acceptance test) exactly. (Alternative
placement: a new `tests/unit/cli/local-modes.test.ts`. The PRP specifies the **preferred**
placement = extend the existing acceptance block; see "Placement Decision" under What.)

**Success Definition**:
- `npx vitest run tests/unit/config/auth-preflight.test.ts` → all green, including the 2 new
  cases (when `dist/index.js` exists) or cleanly `describe.skip`ped (when it doesn't).
- New `--validate-prd` case: scrubbed env (no creds) + empty `PI_CODING_AGENT_DIR` → `res.status === 0`,
  stdout contains `'✅ VALID'`, stderr does NOT contain `'Authentication preflight failed'`,
  no new `plan/NNN_*` session dir.
- New `--dry-run` case: same scrubbed env → `res.status === 0`, stdout contains `'DRY RUN'`,
  stderr does NOT contain `'Authentication preflight failed'`, no new session dir.
- No source files, no docs, no build config touched (test-only; contract #5).

## User Persona (if applicable)

**Target User**: PRP-pipeline maintainer / CI / a new contributor validating a `PRD.md` before
setting up API access.

**Use Case**: Run `hack --validate-prd PRD.md` or `hack --prd PRD.md --dry-run` to lint / preview
without any credential — the natural onboarding sequence that Issue 1 had broken.

**Pain Points Addressed**: Issue 1's preflight placement made both local modes fail with exit 1
and a misleading "run `pi /login`" message even though no API call is made. These tests lock in
the S1 fix so the regression cannot silently return.

## Why

- **The vitest `resolve.alias.groundswell` + `vi.mock('groundswell')` MASK module-load behavior**,
  so **subprocess is the ONLY way to prove the real, built CLI runs credential-free
  end-to-end**. In-process `import('.../index.js')` would (a) auto-run `void main().catch()`,
  (b) hit the mocked groundswell, and (c) not reflect `main()`'s true ordering. This is exactly
  why the existing no-credential-abort acceptance test uses `spawnSync` (see test-conventions §4).
- **Locks in the S1 reorder against regression.** A future refactor that moves
  `runAuthPreflight()` back above the `--dry-run` / `--validate-prd` early-returns would silently
  re-break both modes (exit 1). These tests fail loudly on that.
- **Matches the repo's existing acceptance-test pattern (Pattern A)** — the new cases sit beside
  the existing `acceptance (a)` no-credential-abort test in the same `describeOrSkip` block, so
  all "built-CLI, exit-code, scrubbed-env" coverage lives together.
- **Coverage note (pre-emptive):** subprocess runs do NOT feed the v8 in-process instrumenter;
  `src/index.ts` is at 0% in the committed coverage report and that is **pre-existing**. Do NOT
  chase 100% on `index.ts` and do NOT add `istanbul-ignore` comments. The subprocess assertions
  are the authoritative acceptance (per contract #3 / test-conventions §1).

## What

Extend `tests/unit/config/auth-preflight.test.ts`'s existing build-guarded acceptance block
(`describeOrSkip('acceptance (a) — no-credential aborts at startup …', …)`) with two new `it(...)`
cases. Mirror the existing case's mechanics **exactly** — same `CLI` / `hasBuild` / `describeOrSkip`
guard (already defined at file scope), same scrubbed `env` object, same `plan/` before/after
session-dir diff, same `spawnSync(process.execPath, [CLI, …], …)` shape.

### Placement Decision (preferred = extend existing file)

The contract offers two placement options. **Prefer extending `auth-preflight.test.ts`** because:
1. It already defines `CLI`, `hasBuild`, `describeOrSkip`, the scrubbed-env shape, and the
   session-dir-diff helper inline — reusing them keeps related subprocess coverage together.
2. The two new cases are the **positive counterpart** to the existing no-credential-abort
   acceptance test (same env scrub, opposite exit code + assertion on which path ran). They are
   the natural `(b)`/`(c)` to the existing `(a)`.
3. The file already `vi.mock('groundswell')` (mandatory for its in-process `runAuthPreflight`
   imports) — a pure-subprocess `tests/unit/cli/local-modes.test.ts` would NOT need that mock, but
   co-locating avoids a near-duplicate file. (The mock is harmless to subprocess tests — they
   spawn a fresh node process that ignores the vitest alias.)

If the implementer finds the file has grown unwieldy, the `tests/unit/cli/local-modes.test.ts`
alternative is acceptable, but it MUST replicate the `describeOrSkip` guard and scrubbed-env
hygiene verbatim.

### Success Criteria

- [ ] Two new `it(...)` cases added under the existing `describeOrSkip` acceptance block.
- [ ] Each spawns `node dist/index.js` with a **scrubbed env** = `{PATH, HOME, USER, SHELL, PI_CODING_AGENT_DIR}`,
      where `PI_CODING_AGENT_DIR` is a fresh empty `mkdtempSync` dir (no creds).
- [ ] `--validate-prd`: `res.status === 0`; `res.stdout` contains `'✅ VALID'`; `res.stderr`
      does NOT contain `'Authentication preflight failed'`; no new `plan/NNN_*` dir.
- [ ] `--dry-run`: `res.status === 0`; `res.stdout` contains `'DRY RUN'`; `res.stderr` does NOT
      contain `'Authentication preflight failed'`; no new `plan/NNN_*` dir.
- [ ] Each cleans up its temp dir in the test body (mirrors existing case) OR relies on a shared
      `afterEach`. (Existing case cleans up inline; match it.)
- [ ] Tests `describe.skip` cleanly when `dist/index.js` is absent (no build) — verified by the
      shared `describeOrSkip` guard.
- [ ] No source/docs/build changes.

## All Needed Context

### Context Completeness Check

_Pass._ A developer with no prior knowledge can implement this from: (a) the exact existing
acceptance-test block to mirror (quoted below with line numbers), (b) the two verbatim test
bodies provided in the Implementation Blueprint, (c) the empirically-verified output markers
and streams, and (d) the placement decision. The change is ~45 lines added to one file.

### Documentation & References

```yaml
# MUST READ - Include these in your context window

- file: tests/unit/config/auth-preflight.test.ts
  why: TARGET FILE + the pattern to mirror. The `describeOrSkip('acceptance (a) ...')` block
        (approx lines 276-330) contains the exact scrubbed-env + session-dir-diff + spawnSync
        recipe to copy. The file-scope `CLI`, `hasBuild`, `describeOrSkip`, `AUTH_VARS` are
        already defined — REUSE them, do not redefine.
  pattern: |
    const CLI = resolve(process.cwd(), 'dist/index.js');
    const hasBuild = existsSync(CLI);
    const describeOrSkip = hasBuild ? describe : describe.skip;
    // ... inside the block:
    const env = { PATH, HOME, USER, SHELL, PI_CODING_AGENT_DIR: tmpAgentDir };
    const planDir = resolve(process.cwd(), 'plan');
    const sessRe = /^\d{3}_[0-9a-f]{12}$/;
    const before = new Set(readdirSync(planDir).filter(s => sessRe.test(s)));
    const res = spawnSync(process.execPath, [CLI, '--prd', prdAbs], { encoding:'utf8', timeout:20_000, env });
    const after = new Set(readdirSync(planDir).filter(s => sessRe.test(s)));
    expect([...after].sort()).toEqual([...before].sort());
  gotcha: |
    The scrubbed `env` MUST contain only PATH/HOME/USER/SHELL + PI_CODING_AGENT_DIR. Do NOT
    spread `...process.env` (that leaks real dev credentials, including a real auth.json
    parent dir). The existing case enumerates exactly these 5 keys — copy verbatim.

- file: src/index.ts
  why: The SUT (via the built dist). Confirms the S1 reorder is live: getLogger('App') →
        --dry-run early-return (line ~134, prints '🔍 DRY RUN ...', returns 0) → --validate-prd
        early-return (line ~148, prints 'Status: ✅ VALID'|'❌ INVALID', returns 0|1) → THEN
        runAuthPreflight() + ensureHarnessInitialized() (lines ~192-196). The new tests prove
        the early-returns happen BEFORE the preflight.
  pattern: |
    configureEnvironment();
    const logger = getLogger('App', {...});
    if (args.dryRun) { logger.info('🔍 DRY RUN - would execute with:'); ...; return 0; }
    if (args.validatePrd) { ...; logger.info(`Status: ${result.valid ? '✅ VALID' : '❌ INVALID'}`); return result.valid ? 0 : 1; }
    await runAuthPreflight();      // <-- only reached on agent-invoking paths
    await ensureHarnessInitialized();
  critical: |
    OUTPUT STREAM: pino-pretty writes to STDOUT (empirically verified). `logger.info(...)` →
    res.stdout, NOT res.stderr. The preflight ABORT path uses console.error → res.stderr
    (that's why the existing (a) test asserts on res.stderr). So:
      • success markers ('✅ VALID', 'DRY RUN') → assert on res.STDOUT
      • absence of preflight ('Authentication preflight failed') → assert on res.STDERR

- docfile: plan/007_8783a1f5e14a/bugfix/002_edc62322bc90/architecture/test-conventions.md
  section: §4 "Exercising the built dist (subprocess)" → "Pattern A"
  why: Authoritative convention for the spawnSync + scrubbed env + describeOrSkip pattern.
        Confirms: guard with existsSync(CLI); scrubbed env = only PATH/HOME/USER/SHELL +
        PI_CODING_AGENT_DIR; assert res.status + res.stderr/res.stdout. §8 gives the
        start-here checklist.
  critical: |
    §1 notes coverage is 100% enforced for src/**/*.ts — BUT subprocess runs do NOT feed the
    v8 in-process instrumenter, so src/index.ts stays at its pre-existing 0%. Do NOT add
    istanbul-ignore and do NOT try to cover index.ts via these tests. The subprocess exit-code
    assertions ARE the acceptance.

- url: https://nodejs.org/api/child_process.html#child_processspawnsynccommand-args-options
  why: spawnSync signature + the `encoding:'utf8'` + `timeout` + `env` options used by the
        existing pattern. Returns `{status, stdout, stderr, ...}`. `status` is the exit code
        (null on signal/error).
  critical: |
    `timeout: 20_000` (ms) matches the existing case. If exceeded, `res.signal === 'SIGTERM'`
    and `res.status === null` — the test would fail on `expect(res.status).toBe(0)`, which is
    the correct failure mode (a hang would indicate a regression where the preflight or harness
    init runs and blocks). Keep the 20s timeout.

- url: https://vitest.dev/api/#describeskip
  why: `describe.skip` semantics used by the `describeOrSkip` guard. When `dist/index.js` is
        absent (e.g. a fresh clone before `npm run build`), the whole block is skipped rather
        than failed — keeps `npm run test:run` green without a prior build.
```

### Current Codebase tree (relevant slice)

```bash
src/
└── index.ts                          # SUT — main() reordered by S1; dryRun/validatePrd before preflight
dist/
└── index.js                          # built CLI (spawned by the tests); guard with existsSync
PRD.md                                # the repo-root PRD used by --prd / --validate-prd (exists, valid)
plan/                                 # session-dir parent; tests diff readdir before/after (regex /^\d{3}_[0-9a-f]{12}$/)
tests/unit/config/
└── auth-preflight.test.ts            # ← TARGET FILE; has the describeOrSkip acceptance block to extend
tests/setup.ts                        # global setup (dotenv pollution — why AUTH_VARS delete-list exists)
vitest.config.ts                      # globals:true, 100% coverage on src/**/*.ts (NOT fed by subprocess)
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# Preferred: NO new files. Extend the existing acceptance block in:
tests/unit/config/auth-preflight.test.ts   # +2 it() cases under describeOrSkip('acceptance (a) ...')
#
# (Alternative, only if the file is judged too large: new file)
tests/unit/cli/local-modes.test.ts         # pure-subprocess; MUST replicate describeOrSkip + scrubbed env
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: OUTPUT STREAM MAPPING (empirically verified on the built dist):
//   • pino-pretty logger.info(...)  → writes to STDOUT (res.stdout)
//   • preflight abort console.error → writes to STDERR (res.stderr)
//   The existing (a) test asserts the preflight message on res.stderr because that's where
//   the ABORT prints. The new SUCCESS tests must assert '✅ VALID' / 'DRY RUN' on res.STDOUT
//   and assert the ABSENCE of 'Authentication preflight failed' on res.STDERR. Getting this
//   backwards is the #1 way to write a test that passes for the wrong reason.
//
// CRITICAL: SCRUBBED ENV MUST NOT SPREAD process.env. Enumerate exactly:
//     { PATH, HOME, USER, SHELL, PI_CODING_AGENT_DIR }
//   Spreading `...process.env` leaks real ZAI_API_KEY / ANTHROPIC_* / a real ~/.pi parent,
//   which would make a "credential-free" test pass even if the preflight ran (false green).
//   PI_CODING_AGENT_DIR MUST point at a fresh EMPTY mkdtempSync dir (no auth.json).
//
// CRITICAL: PI_CODING_AGENT_DIR OVERRIDES AuthStorage's default (~/.pi/agent). Without it,
//   the subprocess would read the developer's REAL auth.json and a "no-credential" assertion
//   would be invalid. The existing case sets it to mkdtempSync(join(tmpdir(),'preflight-spawn-')).
//
// GOTCHA: PRD.md MUST be passed as an ABSOLUTE path (resolve(process.cwd(),'PRD.md')). If a
//   relative path is used, parseCLIArgs's existsSync guard fires and prints 'PRD file not
//   found' — the test would then pass on exit-code 0 only by accident for --dry-run (which
//   doesn't read the file) but FAIL for --validate-prd (which does). Use the absolute path.
//
// GOTCHA: the plan/ session-dir diff uses regex /^\d{3}_[0-9a-f]{12}$/ (NNN_<12 hex>).
//   Snapshot `before` AFTER any setup, `after` right after spawnSync returns. If the preflight
//   had run (regression), NO session dir is created either (preflight aborts before the
//   pipeline) — so the session-dir assertion alone does NOT distinguish the two paths. The
//   DISTINGUISHING assertion is exit code (0 vs 1) + the 'Authentication preflight failed'
//   absence on stderr. Keep ALL THREE assertions.
//
// GOTCHA (build currency): the test asserts against dist/index.js, which must reflect S1's
//   reorder. If a future CI forgets to `npm run build` after editing src/index.ts, the test
//   runs stale dist and may pass/fail misleadingly. The describeOrSkip guard only checks
//   EXISTS, not currency. (Acceptable — matches existing convention; document in the test
//   header that a rebuild is required after touching src/index.ts.)
//
// GOTCHA (stderr may be empty string, not undefined): spawnSync with encoding:'utf8' returns
//   res.stderr === '' (empty string) on success, never undefined. So
//   `expect(res.stderr).not.toContain('Authentication preflight failed')` is safe.
//
// COVERAGE: do NOT add /* istanbul ignore */ or try to reach 100% on src/index.ts. Subprocess
//   runs are outside the v8 instrumenter by design. The exit-code assertions are authoritative.
```

## Implementation Blueprint

### Data models and structure

None. Test-only; no models, schemas, or types introduced.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: PRECONDITION PROBE (read-only — run FIRST)
  - RUN: ls -la dist/index.js && ls -la PRD.md
      → Expect both to EXIST. If dist/index.js is missing, the new tests will describe.skip
        (still valid, but you cannot empirically verify them now — run `npm run build` first).
  - RUN (sanity, proves the fix is live in the built dist):
        TMP=$(mktemp -d)
        env -u ZAI_API_KEY -u PRP_API_KEY -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN \
             -u ANTHROPIC_OAUTH_TOKEN -u PRP_AGENT_HARNESS -u ANTHROPIC_DEFAULT_SONNET_MODEL \
             PI_CODING_AGENT_DIR="$TMP" \
             node dist/index.js --prd "$PWD/PRD.md" --validate-prd; echo "EXIT=$?"
        # → Expect EXIT=0 and 'Status: ✅ VALID' on stdout, empty stderr.
        rm -rf "$TMP"
      (Repeat for --dry-run → EXIT=0, 'DRY RUN' on stdout, empty stderr.)
  - DECIDE: if EXIT≠0 for either, S1 is NOT in the built dist → run `npm run build` and re-probe
      before writing tests (otherwise the new tests will fail at validation time).

Task 1: MODIFY tests/unit/config/auth-preflight.test.ts — add 2 acceptance cases
  - LOCATE: the existing `describeOrSkip('acceptance (a) — no-credential aborts at startup ...', ...)`
      block (near the end of the file, ~lines 276-330). Its single `it(...)` is the no-credential
      ABORT case (exit 1).
  - INSERT two new `it(...)` cases INSIDE the SAME `describeOrSkip(...)` block, immediately AFTER
      the existing abort case. They are the credential-free SUCCESS counterparts.
  - REUSE the file-scope `CLI`, `hasBuild`, `describeOrSkip` (do NOT redefine). Each new `it`
      creates its OWN tmpAgentDir + plan-dir before/after diff (do not share state across cases).
  - CASE 1 (--validate-prd): see verbatim body below.
  - CASE 2 (--dry-run): see verbatim body below.
  - PRESERVE: the existing abort `it(...)`, the in-process `describe('runAuthPreflight')` block,
      the `vi.mock('groundswell')`, `AUTH_VARS`, and the beforeEach/afterEach — all unchanged.
  - DO NOT add any in-process import of index.js (it auto-runs main()). Subprocess only.

Task 2: VERIFY (see Validation Loop)
  - RUN: npx vitest run tests/unit/config/auth-preflight.test.ts   → all green, 2 new cases pass.
  - RUN (skip-guard check): temporarily rename dist/index.js → dist/index.js.bak, re-run the file,
      confirm the acceptance block is SKIPPED (not failed), then restore. (Optional but recommended.)
```

### Implementation Patterns & Key Details

```ts
// ====== INSERT INSIDE describeOrSkip('acceptance (a) — ...') , after the existing abort it() ======

// Credential-free SUCCESS counterpart (b): --validate-prd runs with NO credential.
it('exits 0, prints the validation report on stdout, bypasses preflight, creates no session dir', () => {
  const tmpAgentDir = mkdtempSync(join(tmpdir(), 'preflight-spawn-'));
  const prdAbs = resolve(process.cwd(), 'PRD.md'); // EXISTS + valid — required for validatePrd
  // SCRUBBED env: only the 5 safe keys. NO credential vars. Empty PI_CODING_AGENT_DIR (no auth.json).
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    USER: process.env.USER,
    SHELL: process.env.SHELL,
    PI_CODING_AGENT_DIR: tmpAgentDir,
  };
  const planDir = resolve(process.cwd(), 'plan');
  const sessRe = /^\d{3}_[0-9a-f]{12}$/;
  const before = existsSync(planDir)
    ? new Set(readdirSync(planDir).filter(s => sessRe.test(s)))
    : new Set<string>();

  const res = spawnSync(process.execPath, [CLI, '--prd', prdAbs, '--validate-prd'], {
    encoding: 'utf8',
    timeout: 20_000,
    env,
  });

  // EXIT 0 — local mode succeeded credential-free
  expect(res.status).toBe(0);
  // Validation report on STDOUT (pino-pretty → stdout). '✅ VALID' = PRD.md in repo root is valid.
  expect(res.stdout).toContain('✅ VALID');
  // CRITICAL: proves the preflight was BYPASSED (would be on stderr w/ exit 1 if it ran)
  expect(res.stderr).not.toContain('Authentication preflight failed');
  // No new session dir created (validatePrd returns before any pipeline/session work)
  const after = existsSync(planDir)
    ? new Set(readdirSync(planDir).filter(s => sessRe.test(s)))
    : new Set<string>();
  expect([...after].sort()).toEqual([...before].sort());

  rmSync(tmpAgentDir, { recursive: true, force: true });
});

// Credential-free SUCCESS counterpart (c): --dry-run runs with NO credential.
it('exits 0, prints DRY RUN on stdout, bypasses preflight, creates no session dir', () => {
  const tmpAgentDir = mkdtempSync(join(tmpdir(), 'preflight-spawn-'));
  const prdAbs = resolve(process.cwd(), 'PRD.md');
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    USER: process.env.USER,
    SHELL: process.env.SHELL,
    PI_CODING_AGENT_DIR: tmpAgentDir,
  };
  const planDir = resolve(process.cwd(), 'plan');
  const sessRe = /^\d{3}_[0-9a-f]{12}$/;
  const before = existsSync(planDir)
    ? new Set(readdirSync(planDir).filter(s => sessRe.test(s)))
    : new Set<string>();

  const res = spawnSync(process.execPath, [CLI, '--prd', prdAbs, '--dry-run'], {
    encoding: 'utf8',
    timeout: 20_000,
    env,
  });

  // EXIT 0 — local mode succeeded credential-free
  expect(res.status).toBe(0);
  // Dry-run banner on STDOUT (pino-pretty → stdout)
  expect(res.stdout).toContain('DRY RUN');
  // CRITICAL: proves the preflight was BYPASSED
  expect(res.stderr).not.toContain('Authentication preflight failed');
  // No new session dir created (dryRun returns before any pipeline/session work)
  const after = existsSync(planDir)
    ? new Set(readdirSync(planDir).filter(s => sessRe.test(s)))
    : new Set<string>();
  expect([...after].sort()).toEqual([...before].sort());

  rmSync(tmpAgentDir, { recursive: true, force: true });
});

// WHY these three assertion types together:
//   exit 0          → the mode ran to completion (vs abort's exit 1)
//   stdout marker   → the RIGHT path ran (validatePrd prints '✅ VALID'; dryRun prints 'DRY RUN')
//   no preflight msg→ DISTINGUISHES "bypassed" from "ran-but-passed-with-a-credential". With a
//                     fully scrubbed env there is no credential, so the ONLY way exit==0 is if the
//                     preflight never ran. Belt-and-suspenders: also assert no session dir.
```

### Integration Points

```yaml
DATABASE:
  - none
CONFIG:
  - none (no env-var or settings changes)
ROUTES / API:
  - none
BUILD / TOOLING:
  - none (no package.json/tsconfig/vitest.config changes)
  - SOFT-DEPENDENCY: the tests assert against dist/index.js. A rebuild (`npm run build`) is
    required after any edit to src/index.ts for the tests to reflect it. The describeOrSkip
    guard checks existence, not currency (matches existing convention).
DEPENDENCIES:
  - DEPENDS-ON (completed): P1.M1.T1.S1 — main() reorder must be live in dist/index.js.
      (Verified: dryRun/validatePrd early-returns at src/index.ts lines ~134/~148, before
       runAuthPreflight() at ~192.) Run `npm run build` if the dist is stale.
  - RELATES-TO (no action): P1.M1.T2.* (Issue 2 — clean harness mismatch error). Independent;
      those tests cover the claude-code+zai path, not the local-only modes.
  - RELATES-TO (no action): P1.M1.T3.* (docs). Independent; this is test-only (contract #5).
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# After the edit — confirm formatting/lint on the changed file.
npx prettier --check tests/unit/config/auth-preflight.test.ts
# Expected: passes. If the inserted block reformats, run `npx prettier --write` on the file.

npm run lint
# Expected: zero NEW errors. (tsconfig.build.json excludes tests/ from typecheck, so the new
# cases are not type-checked by `npm run typecheck` — that's expected. They use only already-
# imported symbols: spawnSync, mkdtempSync, readdirSync, existsSync, rmSync, resolve, join, tmpdir.)

# Typecheck NOTE: `npm run typecheck` = `tsc --noEmit -p tsconfig.build.json` (include: src/**,
# exclude: tests). Test files are NOT type-checked. The new cases reuse existing imports, so
# they are structurally sound by construction. Do NOT expect typecheck to cover them.
```

### Level 2: Unit Tests (Primary Validation — the new acceptance cases)

```bash
# Ensure the build is current (the tests assert against dist/index.js).
npm run build

# Run the target file — all cases green, including the 2 new ones.
npx vitest run tests/unit/config/auth-preflight.test.ts
# Expected: Test Files 1 passed; the `acceptance (a)` block runs 3 cases (1 abort + 2 new success),
# all green IF dist/index.js exists; otherwise the whole block is skipped (describe.skip).

# Targeted run of just the new cases (Vitest -t filters by test title substring):
npx vitest run tests/unit/config/auth-preflight.test.ts -t 'validate-prd'
npx vitest run tests/unit/config/auth-preflight.test.ts -t 'DRY RUN'
# Expected: each matches and passes its single case.
```

### Level 3: Regression / Adjacent Suites (No Collateral Damage)

```bash
# Confirm the in-process runAuthPreflight cases still pass (the new cases share the file's
# beforeEach/afterEach + vi.mock — verify no interference).
npx vitest run tests/unit/config/auth-preflight.test.ts -t 'runAuthPreflight'
# Expected: the 6 in-process cases still green.

# Sibling subprocess acceptance (harness/provider) — confirm nothing in the config/ surface broke.
npx vitest run tests/unit/config/
# Expected: all green. (Some sibling files have PRE-EXISTING failures unrelated to this delta —
# see TEST_RESULTS.md note re: 212 pre-existing failures. Only THIS file's new cases are in scope.)

# DO NOT run the full `npm run test:run` as a gate for THIS task — 212 pre-existing failures
# (stale fixtures/mocks, npm-link→tarball migration) are unrelated and out of scope. The
# target-file run above is the authoritative gate.
```

### Level 4: Build-Guard Verification (the describeOrSkip contract)

```bash
# Prove the tests skip (not fail) when there is no build — the contract that lets `npm run test:run`
# stay green on a fresh clone before `npm run build`.
mv dist/index.js dist/index.js.bak
npx vitest run tests/unit/config/auth-preflight.test.ts
# Expected: the acceptance (a) block shows as SKIPPED; the in-process runAuthPreflight cases still
# run (they don't need the build). Zero failures.
mv dist/index.js.bak dist/index.js   # RESTORE — do not leave the repo without a build.

# CRITICAL cleanup check: ls dist/index.js   → must exist again before finishing.
```

## Final Validation Checklist

### Technical Validation

- [ ] Task 0 precondition probe: `dist/index.js` + `PRD.md` exist; scrubbed `--validate-prd` and
      `--dry-run` both exit 0 with the expected stdout marker and empty stderr.
- [ ] Level 1: `npx prettier --check tests/unit/config/auth-preflight.test.ts` passes.
- [ ] Level 1: `npm run lint` introduces zero new errors.
- [ ] Level 2: `npx vitest run tests/unit/config/auth-preflight.test.ts` → all green, 2 new cases pass.
- [ ] Level 3: `npx vitest run tests/unit/config/auth-preflight.test.ts -t 'runAuthPreflight'` →
      the 6 in-process cases still green (no interference).
- [ ] Level 4: with `dist/index.js` temporarily moved away, the acceptance block is SKIPPED (not failed);
      dist restored afterward.
- [ ] Only `tests/unit/config/auth-preflight.test.ts` modified; no source/docs/build changes.

### Feature Validation

- [ ] Both new `it(...)` cases live inside the existing `describeOrSkip('acceptance (a) …')` block.
- [ ] Each uses the scrubbed env `{PATH, HOME, USER, SHELL, PI_CODING_AGENT_DIR}` (no spread of process.env).
- [ ] `PI_CODING_AGENT_DIR` points at a fresh empty `mkdtempSync` dir per case; cleaned up after.
- [ ] `--validate-prd` case: `res.status===0`, `res.stdout` contains `'✅ VALID'`, `res.stderr`
      does NOT contain `'Authentication preflight failed'`, no new session dir.
- [ ] `--dry-run` case: `res.status===0`, `res.stdout` contains `'DRY RUN'`, `res.stderr` does NOT
      contain `'Authentication preflight failed'`, no new session dir.
- [ ] PRD path is absolute (`resolve(process.cwd(),'PRD.md')`).
- [ ] Reuses file-scope `CLI`/`hasBuild`/`describeOrSkip` (no redefinition).

### Code Quality Validation

- [ ] Mirrors the existing abort case's structure verbatim (same env shape, same session-dir diff,
      same spawnSync options, same cleanup).
- [ ] No in-process `import` of `index.js` (subprocess only — avoids auto-running main()).
- [ ] No `istanbul-ignore` / no attempt to cover `src/index.ts` via these tests.
- [ ] Test titles are behavior-focused and cite the success contract (exit 0, bypass preflight, no session dir).

### Documentation & Deployment

- [ ] No docs changes (test-only; contract #5 = "DOCS: none").
- [ ] No env vars, no config, no deployment surface affected.
- [ ] (Optional) A one-line header comment in the new cases cross-referencing "bugfix PRD §h3.2 /
      P1.M1.T1.S1" is welcome but not required.

---

## Scope Boundaries (DO NOT EXPAND)

This subtask is **two subprocess acceptance tests in one file**. The following are OUT OF SCOPE:

- ❌ Modifying `src/index.ts` (S1 territory — Complete).
- ❌ Issue 2 (claude-code + zai clean error path) — P1.M1.T2.*.
- ❌ Docs updates (README / CLI_REFERENCE / CONFIGURATION / INSTALLATION) — P1.M1.T3.*.
- ❌ Adding `test:run` to `validate` or any build/script change.
- ❌ Fixing any of the 212 pre-existing test failures (stale fixtures/mocks, npm-link→tarball) — out of delta scope.
- ❌ In-process coverage of `src/index.ts` / chasing 100% on index.ts / istanbul-ignore.
- ❌ Pattern B (tsx runner hitting real node_modules/groundswell) — not needed; these local modes
  don't touch groundswell at all (PRDValidator imports only fs/promises + node:path).

---

## Anti-Patterns to Avoid

- ❌ Don't spread `...process.env` into the subprocess env — it leaks real credentials and a real
  auth.json parent dir, making the "credential-free" assertion meaningless. Enumerate the 5 safe keys.
- ❌ Don't assert the success markers (`'✅ VALID'`, `'DRY RUN'`) on `res.stderr` — pino-pretty
  writes to **stdout**. (The existing abort test asserts on stderr because the abort uses
  `console.error`. Don't cargo-cult the stream; check the map in Known Gotchas.)
- ❌ Don't drop the "no `Authentication preflight failed` on stderr" assertion — without it, a
  regression where the preflight runs but happens to pass (e.g. a leaked credential from
  `...process.env`) would look green. The exit-code + absence-of-preflight-msg pair is what
  actually proves "credential-free bypass".
- ❌ Don't `import` index.js in-process to "also test main()" — it auto-runs `void main().catch()`,
  hits the vitest groundswell mock/alias, and doesn't reflect the real built CLI. Subprocess only.
- ❌ Don't redefine `CLI`/`hasBuild`/`describeOrSkip` inside the new cases — they're file-scope; reuse.
- ❌ Don't share a single tmpAgentDir across cases — each `it` needs its own fresh empty dir
  (isolation; matches the existing abort case which makes its own).
- ❌ Don't use a relative `--prd PRD.md` — parseCLIArgs's existsSync guard will reject it from a
  different cwd and print 'PRD file not found'. Always `resolve(process.cwd(),'PRD.md')`.
- ❌ Don't leave `dist/index.js` moved away after the Level 4 skip-guard check — always restore it.
- ❌ Don't add `/* istanbul ignore next */` — subprocess coverage is outside v8 by design; index.ts's
  0% is pre-existing and not these tests' concern.

---

**Confidence Score: 9/10** for one-pass implementation success. The change is ~45 lines added to a
single well-understood file, mirroring an existing acceptance test verbatim (same env scrub,
same session-dir diff, same spawnSync shape) with only the exit-code/stream/marker assertions
flipped to the success contract. All output markers and streams were verified empirically against
the current built dist (`--validate-prd` → exit 0 + `✅ VALID` on stdout; `--dry-run` → exit 0 +
`DRY RUN` on stdout; both with empty stderr). The one residual risk is the implementer
cargo-culting the existing abort test's `res.stderr` assertion onto the success cases — explicitly
guarded against in Anti-Patterns and the stream-map gotcha.
