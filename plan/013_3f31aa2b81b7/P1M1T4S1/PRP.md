# PRP — P1.M1.T4.S1: `validateAllReasoningLevels()` on the startup path + `ReasoningConfigError` main().catch arm

> Plan 013, PRD §9.2.9 (Per-Role Reasoning Level) #4 "Validation (fail-fast)". This is the **startup
> integration** for the reasoning-level feature: a bad reasoning env value (e.g.
> `PRP_REASONING_AGENT=ultra`) must abort the pipeline at startup — exit 1 + a single actionable
> message, BEFORE any session is created or any agent is invoked — instead of surfacing as a deep
> runtime failure inside the first agent call. Architecture spec:
> `plan/013_3f31aa2b81b7/architecture/integration-points.md §G`.

---

## Goal

**Feature Goal**: Wire `validateAllReasoningLevels()` (T1.S2, Complete) into the `src/index.ts`
`main()` startup sequence so every per-role reasoning env var is validated against the vocabulary
(`off/minimal/low/medium/high/xhigh`) before any agent is created. Add a clean `main().catch` arm for
`ReasoningConfigError` (T1.S1, Complete) so an invalid value renders as a single actionable `❌`
message + `exit(1)` — no stack trace — mirroring the existing `AuthPreflightError`/`HackConfigError`
arms (PRD §9.2.7 / §9.7.7 fail-fast discipline).

**Deliverable**:
1. **`src/index.ts`** — (a) add a NEW `import { validateAllReasoningLevels } from './config/constants.js';`
   (index.ts has no constants import today); (b) extend the `./config/types.js` named import with
   `ReasoningConfigError`; (c) insert `validateAllReasoningLevels();` into `main()` immediately after
   `await runAuthPreflight();` and before `await ensureHarnessInitialized();` (per §G "alongside/after
   runAuthPreflight()"); (d) add a `ReasoningConfigError` arm to `main().catch`.
2. **`tests/unit/config/reasoning-fail-fast.test.ts`** (NEW) — a two-tier suite mirroring
   `auth-preflight.test.ts`: (a) unit tests of `validateAllReasoningLevels()` directly (invalid env →
   throws `ReasoningConfigError` naming key+value+accepted list; valid/empty/unset env → no throw); (b)
   a `spawnSync(dist/index.js)` integration test proving invalid reasoning env + valid creds → exit 1 +
   actionable stderr message + NO session dir.

**Success Definition**:
- `PRP_REASONING_AGENT=ultra` (or any invalid value on any of the 5 role vars) at startup → the
  pipeline aborts with exit code 1 and a single `❌` message on stderr naming the offending key, the
  bad value, and the accepted levels — and **no** `plan/<NNN>_<hash>/` session dir is created.
- A valid or unset reasoning config → `validateAllReasoningLevels()` is a no-op; the pipeline proceeds
  to harness init / pipeline run exactly as today.
- The credential-free early returns (`--dry-run`, `--validate-prd`) still run BEFORE the reasoning
  gate (they return before `runAuthPreflight()`, which precedes the new call) — so a dry-run with an
  invalid reasoning env still exits 0.
- All existing tests stay GREEN; the new file is GREEN; `npm run typecheck` exit 0; `npm run lint` +
  `npm run format:check` clean.
- **No other source files modified.** `constants.ts`, `types.ts`, `harness.ts`, `agent-factory.ts`,
  and any workflow/core file are UNCHANGED. No docs (P1.M2 owns changeset docs).

## User Persona

N/A — internal startup behavior. Indirect "users" are pipeline operators who, with this task (and the
rest of P1.M1), get the §9.2.9 #4 guarantee: a typo'd `PRP_REASONING_*=ultra` fails fast with a clear
message instead of crashing deep inside the first agent call after a session dir is created.

## Why

- **Closes the §9.2.9 #4 "Validation (fail-fast)" requirement at the only place that can gate every
  agent path.** The `.hack` enum path already fail-fasts inside `loadHackConfig` (T2.S2). But the
  SHELL/ENV path (`PRP_REASONING_AGENT=ultra` exported in the shell, or set in `.env`) is NOT
  validated until a getter actually runs — which, without this task, is at agent-creation time inside
  a workflow, after a session dir exists and an `ERROR_REPORT.md` may be written. An explicit startup
  pass is REQUIRED to abort before any agent is created.
- **Mirrors the proven §9.2.7 auth-preflight pattern.** The auth preflight already gates the startup
  path after `configureEnvironment()` / before `ensureHarnessInitialized()`. The reasoning gate slots
  in right alongside it (same window, same fail-fast discipline, same clean `main().catch` rendering).
- **Tiny, low-risk, surgical.** One import line, one extended import, one function call, one catch
  arm. No new files in `src/`, no deps, no env reads beyond what the getters already do.

## What

### User-visible behavior
An invalid reasoning-level env value aborts the CLI at startup. Example:
```
$ PRP_REASONING_AGENT=ultra hack --prd spec/SPEC.md

❌ Invalid reasoning level for 'PRP_REASONING_AGENT': 'ultra'. Accepted (case-insensitive): off, minimal, low, medium, high, xhigh.
$ echo $?
1
```
No session directory is created; no agent is invoked. (A valid/unset config is unchanged — the call
is a no-op.)

### Technical requirements (exact contract)

**Import additions** at the top of `src/index.ts`:
- NEW line: `import { validateAllReasoningLevels } from './config/constants.js';` (index.ts has NO
  existing `./config/constants.js` import — grep-verified).
- Extend the `./config/types.js` named import with `ReasoningConfigError` (keep alphabetical order so
  `npm run format:check` stays clean).

**Startup insertion** — in `main()`, immediately AFTER `await runAuthPreflight();` and BEFORE the
`await ensureHarnessInitialized();` block:
```ts
  // CRITICAL: Fail-fast reasoning-level validation (PRD §9.2.9 #4). Validates every per-role
  // reasoning env var against the vocabulary BEFORE any session is created or agent invoked.
  validateAllReasoningLevels();
```
- `validateAllReasoningLevels()` is synchronous (`(): void`) — no `await` needed.
- It calls all five getters (`getReasoningAgent/Breakdown/BugFinder/Validation/Impl`) in sequence; each
  throws `ReasoningConfigError` on an invalid value. The thrown error propagates out of `main()` to
  the `main().catch` handler.
- Placement is AFTER `runAuthPreflight()` (per §G). Consequence: with BOTH no-creds AND an invalid
  reasoning level, the **auth** error surfaces first (auth is the more fundamental failure). The
  integration test isolates the reasoning gate by SETTING `ZAI_API_KEY` so auth passes (research §5b).

**`main().catch` arm** — add among the clean arms (after `EnvironmentValidationError`, before the
generic fallback):
```ts
    if (error instanceof ReasoningConfigError) {
      console.error(`\n❌ ${error.message}`); // §9.2.9 #4: invalid reasoning level — actionable one-liner (no stack)
      process.exit(1);
    }
```
- Identical shape to the existing arms: `❌ ${error.message}` + `process.exit(1)`, NO stack trace.
- `error.message` is built by `buildReasoningErrorMessage` (types.ts, module-local) and already names
  the offending key, the bad value, and the full accepted-values list — so no further formatting is
  needed here.

### Success Criteria
- [ ] `validateAllReasoningLevels` imported from `./config/constants.js`; `ReasoningConfigError`
      imported from `./config/types.js`.
- [ ] `validateAllReasoningLevels()` called in `main()` after `runAuthPreflight()`, before
      `ensureHarnessInitialized()`.
- [ ] `main().catch` has a `ReasoningConfigError` arm (`❌ ${msg}` + `exit(1)`, no stack), placed
      among the clean arms (before the generic fallback).
- [ ] Invalid reasoning env (any of the 5 roles) → `validateAllReasoningLevels()` throws
      `ReasoningConfigError`; message contains the key, value, and accepted-levels list.
- [ ] Valid/unset/empty-whitespace reasoning env → no throw (no-op void).
- [ ] spawn: `PRP_REASONING_AGENT=ultra` + `ZAI_API_KEY` set → exit 1, reasoning message on stderr,
      NO new `plan/<NNN>_<hash>/` session dir, auth message ABSENT (auth passed).
- [ ] `--dry-run` with an invalid reasoning env still exits 0 (the gate is AFTER the credential-free
      early returns).
- [ ] All existing tests GREEN; new test file GREEN; `npm run typecheck` exit 0; lint + format:check clean.

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_ **Yes.** The exact
startup sequence (verified by full file read), the exact insertion point (§G, authoritative), the
exact before/after for the imports + insertion + catch arm (research §8), the verified signatures of
both input symbols (`validateAllReasoningLevels(): void` + `ReasoningConfigError` with `name`/`key`/
`value` fields + the exact message format), the proven two-tier test template (auth-preflight.test.ts,
read in full), the CRITICAL spawn-test ordering gotcha (reasoning gate runs AFTER auth — so set
`ZAI_API_KEY` to isolate), the verified facts (spec/SPEC.md exists, dist/index.js is built → spawn
tests run), and the verified validation commands are all below.

### Documentation & References
```yaml
# AUTHORITATIVE SPEC — the architecture pin for this exact task
- docfile: plan/013_3f31aa2b81b7/architecture/integration-points.md
  section: "G. src/index.ts — startup fail-fast"
  why: Pins the startup sequence, the insertion point (after runAuthPreflight :266, before agent
        creation), and the exact main().catch arm shape.
  critical: §G's placement is "alongside/after runAuthPreflight()" — do NOT place it before auth, and
        do NOT place it after ensureHarnessInitialized (must be before agent creation).

# AUTHORITATIVE SPEC — the reasoning-level PRD text (fail-fast requirement)
- docfile: PRD.md   # (provided in selected_prd_content §9.2.9 #4 "Validation (fail-fast)")
  section: §9.2.9 "Per-Role Reasoning Level" → "Validation (fail-fast)" + §9.2.7 fail-fast discipline
  why: Defines the requirement (bad value = hard startup error, exit 1, actionable message naming key/
        value/accepted-levels, before any session/agent) and the §9.2.7/§9.7.7 message discipline it mirrors.

# INPUT — the validator (T1.S2, COMPLETE) — verified in source
- file: src/config/constants.ts
  section: validateAllReasoningLevels (:1811) — calls all 5 getters; throws ReasoningConfigError on invalid
  why: The function this task calls from main(). Synchronous, no I/O, no groundswell import.
  gotcha: It returns void (NOT a Promise) — no await. The 5 getters read process.env at call time.

# INPUT — the error class (T1.S1, COMPLETE) — verified in source
- file: src/config/types.ts
  section: ReasoningConfigError (:322) — extends Error; this.name='ReasoningConfigError' set in ctor;
        readonly key + value fields; message via buildReasoningErrorMessage (:345)
  why: The error instanceof + main().catch arm both rely on this.name being set in the constructor
        (mirrors AuthPreflightError). The message already names key + value + accepted list.
  critical: message = "Invalid reasoning level for '<key>': '<value>'. Accepted (case-insensitive):
        off, minimal, low, medium, high, xhigh." — assert these substrings in tests.

# EDIT TARGET — the file being changed (read it first)
- file: src/index.ts
  section: imports (~L27-49); main() runAuthPreflight call (~L266 region) + ensureHarnessInitialized;
        main().catch arms (end of file)
  why: Add the constants import + extend the types import; insert the validate call; add the catch arm.
  pattern: Mirror the existing runAuthPreflight comment block + the existing clean catch arms EXACTLY
        (same `❌ ${error.message}` + `process.exit(1)`, no stack).
  gotcha: index.ts has NO existing ./config/constants.js import (grep-verified) — it is a NEW import line.

# TEST TEMPLATE — mirror this file's structure exactly (read in full)
- file: tests/unit/config/auth-preflight.test.ts
  section: top-of-file mocks (groundswell mock) + unit describe('runAuthPreflight') + spawn
        describeOrSkip('acceptance (a) — … aborts at startup') + dry-run control
  why: The two-tier pattern (in-process unit + spawnSync integration), the env-scrubbing setup, the
        session-dir before/after diff, and the describeOrSkip(hasBuild) gate.
  critical: validateAllReasoningLevels does NOT need the groundswell mock (constants.ts doesn't import
        groundswell). Only the spawn tests need a built dist/index.js.

# RESEARCH NOTE (this task) — copy-ready imports + insertion + catch arm + test code
- docfile: plan/013_3f31aa2b81b7/P1M1T4S1/research/startup-fail-fast.md
  section: "5. TEST STRATEGY", "8. Exact before/after", "4. INPUT contracts"
  why: The exact before/after for every edit, the spawn-test ordering gotcha (set ZAI_API_KEY to
        isolate the reasoning gate), the copy-ready unit + integration test bodies.

# PARALLEL PREDECESSOR (read as a CONTRACT) — no overlap, just confirm T3.S3 doesn't touch index.ts
- docfile: plan/013_3f31aa2b81b7/P1M1T3S3/PRP.md
  section: "Integration Points"
  why: T3.S3 owns the 5 createQAAgent call sites in workflows/core — it does NOT touch src/index.ts.
        T4.S1 owns ONLY src/index.ts + the new test file. No file overlap.

# PARALLEL SIBLING (T4.S2 — separate, do NOT implement)
- docfile: plan/013_3f31aa2b81b7  # (T4.S2: "config show --src surfaces each role's resolved reasoning level")
  why: T4.S2 owns the `hack config show --src` reasoning-level surfacing — a DIFFERENT file (cli/config
        subcommand). Do NOT touch it. T4.S1 is the startup gate only.
```

### Current Codebase tree (edit surface)

```bash
src/index.ts                                   # EDIT: +1 import line, +1 type in existing import,
  ├─ imports (~L27-49)                         #     +1 validate call in main(), +1 catch arm
  ├─ main() … await runAuthPreflight()         # INSERT validateAllReasoningLevels() right after
  ├─        … await ensureHarnessInitialized() # (unchanged — call is before this)
  └─ main().catch arms                         # ADD ReasoningConfigError arm among clean arms

tests/unit/config/reasoning-fail-fast.test.ts  # NEW — two-tier: unit (validateAllReasoningLevels) + spawn
src/config/constants.ts                        # READ-ONLY (validateAllReasoningLevels + getters — T1.S2)
src/config/types.ts                            # READ-ONLY (ReasoningConfigError — T1.S1)
src/config/harness.ts                          # READ-ONLY (runAuthPreflight — the anchor for placement)
tests/unit/config/auth-preflight.test.ts       # READ-ONLY (the template to mirror)
```

### Desired Codebase tree with files to be changed
```bash
src/index.ts                                   # EDIT — imports + validate call + catch arm
tests/unit/config/reasoning-fail-fast.test.ts  # NEW — unit + integration tests
# (no other source files touched)
```

### Known Gotchas of our codebase & Library Quirks
```ts
// CRITICAL (spawn-test ordering): validateAllReasoningLevels() runs AFTER await runAuthPreflight()
//   (per §G). So a spawn test with SCRUBBED creds + invalid reasoning env hits AuthPreflightError FIRST.
//   To isolate the reasoning gate: SET ZAI_API_KEY='zai-test-key' (auth passes) AND the invalid
//   PRP_REASONING_* value. Then assert the REASONING message (not the auth message) + exit 1 + no session.

// CRITICAL (validateAllReasoningLevels is SYNCHRONOUS): it returns void, NOT a Promise. Call it
//   plainly (no `await`): `validateAllReasoningLevels();`. In unit tests use
//   `expect(() => validateAllReasoningLevels()).toThrow(ReasoningConfigError)` (NOT rejects.toThrow).

// GOTCHA (no groundswell mock needed for unit tests): src/config/constants.ts does NOT import
//   groundswell, so importing validateAllReasoningLevels in the test needs no module mock. (Only
//   spawn-based integration against dist/index.js exercises the real harness import chain.)

// GOTCHA (index.ts has NO constants import today): this is a NEW import line, not an extension of an
//   existing one. Add `import { validateAllReasoningLevels } from './config/constants.js';`. Extend the
//   EXISTING ./config/types.js import with ReasoningConfigError (keep alphabetical order for prettier).

// GOTCHA (reasoning gate is AFTER credential-free early returns): --dry-run / --validate-prd return
//   BEFORE runAuthPreflight() (which precedes the new call). So a dry-run with an invalid reasoning
//   env still exits 0 — this is correct (PRD §9.2.9 scopes the gate to agent-creating paths). A dry-run
//   control test documents this.

// GOTCHA (env determinism): tests/setup.ts runs dotenv.config() (loads .env into process.env). The repo
//   .env does NOT set any PRP_REASONING_* (only .env.example documents them, commented). So real getters
//   return defaults with no stub. For ROBUSTNESS, the unit beforeEach clears the 5 REASONING vars +
//   afterEach(vi.unstubAllEnvs) (mirror auth-preflight.test.ts's AUTH_VARS pattern).

// GOTCHA (spawn tests need a build): the integration tests spawn dist/index.js. dist/index.js IS built
//   today (verified), but use the describeOrSkip(hasBuild) gate from auth-preflight.test.ts so the suite
//   degrades gracefully if a clean checkout has no build. Run `npm run build` before invoking the spawn tests.

// GOTCHA (format): the edited imports must pass npm run format:check (prettier). The new constants
//   import line + the alphabetical ReasoningConfigError addition are the likely nits — run
//   `npm run format` then re-check if it flags.
```

## Implementation Blueprint

### Data models and structure
N/A — no new data models. This task wires an existing pure validator into the startup path and adds an
error-class arm to an existing catch. The only "structure" is the one-line call site.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT src/index.ts — imports
  - ADD line: import { validateAllReasoningLevels } from './config/constants.js';
        (NEW import — index.ts has none today; place it among the config imports in import-order.)
  - EXTEND the ./config/types.js named import: add ReasoningConfigError (alphabetical, between
        HarnessProviderMismatchError and UnsupportedHarnessError).
  - DO NOT: remove/reorder other imports; touch any other module.

Task 2: EDIT src/index.ts — insert the validate call in main()
  - LOCATE: grep for `await runAuthPreflight();` then the `// CRITICAL: Initialize the agent harness`
        comment + `await ensureHarnessInitialized();`.
  - INSERT, between `await runAuthPreflight();` and the ensureHarnessInitialized comment:
        a brief comment (PRD §9.2.9 #4 fail-fast) + `validateAllReasoningLevels();` (NO await — sync).
  - DO NOT: move runAuthPreflight; place before/after configureHarness; touch ensureHarnessInitialized
        itself; touch the credential-free early returns; touch the pipeline creation.

Task 3: EDIT src/index.ts — add the ReasoningConfigError main().catch arm
  - LOCATE: the main().catch chain (end of file) — find the EnvironmentValidationError arm, then the
        generic `console.error('\n❌ Fatal error in main():', error)` fallback.
  - ADD, after the EnvironmentValidationError arm and before the generic fallback:
        if (error instanceof ReasoningConfigError) { console.error(`\n❌ ${error.message}`); process.exit(1); }
        + a brief §9.2.9 #4 inline comment (no stack).
  - DO NOT: alter the existing arms; alter the generic fallback; remove process.exit.

Task 4: CREATE tests/unit/config/reasoning-fail-fast.test.ts — unit + integration suite
  - TOP: imports (vitest; spawnSync/fs/os/path; validateAllReasoningLevels + REASONING env-var consts
        from constants.js; ReasoningConfigError from types.js). NO groundswell mock (constants.ts
        doesn't import it).
  - before/afterEach: clear the 5 PRP_REASONING_* vars (mirror auth-preflight AUTH_VARS) + afterEach(
        vi.unstubAllEnvs).
  - UNIT describe('validateAllReasoningLevels (startup gate, PRD §9.2.9 #4)'):
    * invalid PRP_REASONING_AGENT='ultra' → expect(() => fn()).toThrow(ReasoningConfigError); assert
      message contains 'PRP_REASONING_AGENT', 'ultra', and 'off, minimal, low, medium, high, xhigh'.
    * invalid on a DIFFERENT role (PRP_REASONING_IMPL_AGENT='loud') → throws; message names
      'PRP_REASONING_IMPL_AGENT' (proves all 5 are validated).
    * valid PRP_REASONING_VALIDATION_AGENT='xhigh' → expect(() => fn()).not.toThrow().
    * case-insensitive valid PRP_REASONING_AGENT='HIGH' → no throw.
    * empty/whitespace PRP_REASONING_AGENT='   ' → no throw (treated as unset → default).
    * all-unset (defaults) → no throw (void).
    * error shape: caught instance has name='ReasoningConfigError', key, value fields.
  - INTEGRATION (spawn, mirror auth-preflight acceptance (a)): gate with `const hasBuild = existsSync(CLI);
        const describeOrSkip = hasBuild ? describe : describe.skip;`.
    * "invalid reasoning env aborts at startup: exit 1, single message, NO session dir" — env includes
      ZAI_API_KEY='zai-test-key' (auth passes) + PRP_REASONING_AGENT='ultra'; prdAbs=spec/SPEC.md; assert
      res.status===1; stderr contains 'Invalid reasoning level' + 'PRP_REASONING_AGENT' + 'ultra' +
      'off, minimal, low, medium, high, xhigh'; stderr does NOT contain 'Authentication preflight
      failed'; session-dir before/after diff empty. (Run `npm run build` first.)
    * dry-run CONTROL — PRP_REASONING_AGENT='ultra' + --dry-run (NO ZAI_API_KEY) → exit 0, stdout
      contains 'DRY RUN' (the gate is after the credential-free early return).
  - FOLLOW pattern: auth-preflight.test.ts spawn block (temp PI_CODING_AGENT_DIR, scrubbed env, sessRe
        = /^\d{3}_[0-9a-f]{12}$/, before/after readdir diff).
  - DO NOT: mock constants.js in the unit section (let real getters run + stub env); skip the build
        gate; assert a Promise rejection (the fn is sync).
```

### Implementation Patterns & Key Details
```ts
// PATTERN: the full src/index.ts edit, before → after (research §8 has the verbatim blocks)
// IMPORTS — add validateAllReasoningLevels (NEW line) + ReasoningConfigError (extend types import)
// INSERTION in main():  await runAuthPreflight();  →  [comment + validateAllReasoningLevels();]  →  ensureHarnessInitialized comment
// CATCH ARM:  …EnvironmentValidationError arm…  →  [ReasoningConfigError arm]  →  generic fallback

// PATTERN: unit test (sync throw, NOT async)
it('throws ReasoningConfigError for an invalid level', () => {
  vi.stubEnv('PRP_REASONING_AGENT', 'ultra');
  expect(() => validateAllReasoningLevels()).toThrow(ReasoningConfigError);
  // assert the actionable message substrings
  let caught: unknown;
  try { validateAllReasoningLevels(); } catch (e) { caught = e; }
  const err = caught as ReasoningConfigError;
  expect(err.message).toContain('PRP_REASONING_AGENT');
  expect(err.message).toContain('ultra');
  expect(err.message).toContain('off, minimal, low, medium, high, xhigh');
  expect(err.key).toBe('PRP_REASONING_AGENT');
  expect(err.value).toBe('ultra');
});

// PATTERN: integration test (spawn) — isolate the reasoning gate by SETTING ZAI_API_KEY
it('invalid reasoning env aborts at startup: exit 1, single message, NO session dir', () => {
  const tmpAgentDir = mkdtempSync(join(tmpdir(), 'reasoning-spawn-'));
  const prdAbs = resolve(process.cwd(), 'spec/SPEC.md'); // EXISTS — avoids parseCLIArgs trap
  const env = {
    PATH: process.env.PATH, HOME: process.env.HOME, USER: process.env.USER, SHELL: process.env.SHELL,
    PI_CODING_AGENT_DIR: tmpAgentDir,
    ZAI_API_KEY: 'zai-test-key',     // ← auth preflight PASSES so the reasoning gate is reached
    PRP_REASONING_AGENT: 'ultra',    // ← invalid → ReasoningConfigError
  };
  const planDir = resolve(process.cwd(), 'plan');
  const sessRe = /^\d{3}_[0-9a-f]{12}$/;
  const before = existsSync(planDir) ? new Set(readdirSync(planDir).filter(s => sessRe.test(s))) : new Set();
  const res = spawnSync(process.execPath, [CLI, '--prd', prdAbs], { encoding: 'utf8', timeout: 20_000, env });
  expect(res.status).toBe(1);
  expect(res.stderr).toContain('Invalid reasoning level');
  expect(res.stderr).toContain('PRP_REASONING_AGENT');
  expect(res.stderr).toContain('ultra');
  expect(res.stderr).not.toContain('Authentication preflight failed'); // auth passed
  const after = existsSync(planDir) ? new Set(readdirSync(planDir).filter(s => sessRe.test(s))) : new Set();
  expect([...after].sort()).toEqual([...before].sort()); // no session dir
  rmSync(tmpAgentDir, { recursive: true, force: true });
});

// GOTCHA (above): if ZAI_API_KEY is omitted, AuthPreflightError fires FIRST (auth is checked before
//   reasoning per §G) and the test sees the auth message, not the reasoning one. Always set ZAI_API_KEY
//   to isolate the reasoning gate.
// GOTCHA (above): validateAllReasoningLevels is sync — unit test uses expect(() => fn()).toThrow, NOT rejects.toThrow.
// GOTCHA (above): run `npm run build` before the spawn tests; use describeOrSkip(hasBuild).
```

### Integration Points
```yaml
IMPORTS (src/index.ts):
  - NEW line: "import { validateAllReasoningLevels } from './config/constants.js';"
  - extend ./config/types.js named import: + ReasoningConfigError (alphabetical)

STARTUP CALL (src/index.ts main()):
  - insert "validateAllReasoningLevels();" between "await runAuthPreflight();" and
    "await ensureHarnessInitialized();" (§G: alongside/after runAuthPreflight, before agent creation).

CATCH ARM (src/index.ts main().catch):
  - add "if (error instanceof ReasoningConfigError) { console.error(`\\n❌ ${error.message}`); process.exit(1); }"
    among the clean arms (after EnvironmentValidationError, before the generic fallback).

DOWNSTREAM (none — this is the terminal consumer of validateAllReasoningLevels; no agent/workflow change).
ORDERING vs other gates: configureEnvironment() → configureHarness() → runAuthPreflight() →
    validateAllReasoningLevels() (NEW) → ensureHarnessInitialized() → pipeline.

NONE OF: src/config/constants.ts (T1.S2), src/config/types.ts (T1.S1), src/config/harness.ts,
         src/agents/*, src/workflows/*, src/core/* (T3.S3), src/cli/* (T4.S2 config show), docs/* (P1.M2),
         PRD.md, spec/**, tasks.json, prd_snapshot.md.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
npm run typecheck        # tsc --noEmit -p tsconfig.build.json — exit 0
npm run lint             # eslint . --ext .ts — clean (edited index.ts)
npm run format:check     # prettier --check — clean (run `npm run format` if the import addition flags)
# Expected: zero errors. If typecheck flags validateAllReasoningLevels/ReasoningConfigError as missing,
#   confirm Task 1 imports landed (NEW constants line + extended types import).
```

### Level 2: Unit Tests (Component Validation)
```bash
npx vitest run tests/unit/config/reasoning-fail-fast.test.ts   # new unit + (if built) spawn tests GREEN
# Expected: every unit it() passes. If a throw test fails, confirm vi.stubEnv ran BEFORE the call and
#   the env was clean (beforeEach clears the 5 vars). If a no-throw test fails, a prior stub leaked
#   (afterEach(vi.unstubAllEnvs) missing).
npm run build           # build dist/index.js so the spawn integration tests RUN (not skip)
npx vitest run tests/unit/config/reasoning-fail-fast.test.ts   # re-run; spawn cases now execute
# Expected: spawn "invalid reasoning env" case → exit 1 + reasoning message + no session dir; dry-run control → exit 0.
```

### Level 3: Regression (System Validation)
```bash
npx vitest run tests/unit/config/auth-preflight.test.ts   # index.ts edit must not break the auth gate
# Expected: GREEN. (The reasoning call is inserted AFTER runAuthPreflight; auth behavior is unchanged.)
npx vitest run tests/unit/config/   # full config suite — getters (T1.S2) + hack-config (T2) unaffected
# Expected: GREEN.
# Confirm the wiring is the ONLY change in index.ts (no stray edits):
grep -n 'validateAllReasoningLevels\|ReasoningConfigError' src/index.ts
# Expected: 1 import line for each + exactly 1 call site in main() + 1 arm in main().catch.
```

### Level 4: Creative & Domain-Specific Validation
```bash
# Manual end-to-end smoke (optional — the spawn test in Level 2 is authoritative). Requires a built dist.
npm run build
ZAI_API_KEY=dummy PRP_REASONING_AGENT=ultra node dist/index.js --prd spec/SPEC.md; echo "exit=$?"
# Expected: exit=1 and a single "❌ Invalid reasoning level for 'PRP_REASONING_AGENT': 'ultra'. …" line.
# (Optional) confirm the credential-free early-return still precedes the gate:
PRP_REASONING_AGENT=ultra node dist/index.js --prd spec/SPEC.md --dry-run; echo "exit=$?"
# Expected: exit=0 + "DRY RUN" output (dry-run returns before the gate).
```

## Final Validation Checklist

### Technical Validation
- [ ] Level 1–3 pass; `npm run typecheck && npm run lint && npm run format:check` clean.
- [ ] `npx vitest run tests/unit/config/reasoning-fail-fast.test.ts` GREEN (unit always; spawn after build).
- [ ] `npx vitest run tests/unit/config/auth-preflight.test.ts` GREEN (regression — auth gate unchanged).

### Feature Validation
- [ ] Invalid reasoning env (any of the 5 roles) → `validateAllReasoningLevels()` throws
      `ReasoningConfigError`; message names key + value + accepted-levels list.
- [ ] Valid/unset/empty reasoning env → no throw (no-op).
- [ ] spawn: invalid env + `ZAI_API_KEY` set → exit 1, reasoning message on stderr, NO session dir,
      auth message ABSENT.
- [ ] `--dry-run` with invalid env → exit 0 (gate is after the credential-free early returns).
- [ ] `main().catch` `ReasoningConfigError` arm renders `❌ ${msg}` + `exit(1)`, no stack.

### Code Quality Validation
- [ ] NEW constants import line; types import extended with `ReasoningConfigError` (alphabetical).
- [ ] `validateAllReasoningLevels()` called after `runAuthPreflight()`, before `ensureHarnessInitialized()`.
- [ ] Catch arm placed among the clean arms (before the generic fallback); shape identical to siblings.
- [ ] Unit test uses sync `expect(() => fn()).toThrow` (not async); env hygiene (clear + unstubAllEnvs).
- [ ] spawn test sets `ZAI_API_KEY` to isolate the reasoning gate (auth checked first per §G).

### Documentation & Deployment
- [ ] No docs-file changes in this task (P1.M2 owns changeset docs; message format covered by T1.S1 JSDoc).
- [ ] A brief inline comment at the insertion point (like the runAuthPreflight comment) — the only in-code doc.
- [ ] No env-var additions (the `PRP_REASONING_*` vars already exist from T1.S2).

---

## Anti-Patterns to Avoid
- ❌ Don't place `validateAllReasoningLevels()` BEFORE `runAuthPreflight()` — §G is explicit:
  "alongside/after runAuthPreflight()". With both no-creds and a bad level, auth must surface first
  (it's the more fundamental failure); the gate belongs right after auth.
- ❌ Don't `await validateAllReasoningLevels()` — it is synchronous (`(): void`). A stray `await` on void
  is harmless but misleading; call it plainly.
- ❌ Don't omit `ZAI_API_KEY` in the spawn integration test — with scrubbed creds the AuthPreflightError
  fires first (auth precedes reasoning) and the test sees the wrong message. Always set `ZAI_API_KEY` to
  isolate the reasoning gate.
- ❌ Don't use `rejects.toThrow` in the unit tests — `validateAllReasoningLevels` is sync; use
  `expect(() => fn()).toThrow(ReasoningConfigError)`.
- ❌ Don't mock `constants.js` in the unit tests — `validateAllReasoningLevels` is a pure process.env
  reader and constants.ts doesn't import groundswell; let the real getters run and stub the ENV.
- ❌ Don't widen scope — T4.S1 is ONLY src/index.ts (imports + call + catch arm) + the new test file. No
  constants.ts/types.ts/harness.ts/agent-factory/workflows/core/cli edits (those are T1/T2/T3/T4.S2).
- ❌ Don't skip the build for the spawn tests — dist/index.js must exist; use the `describeOrSkip(hasBuild)`
  gate and run `npm run build` first.
- ❌ Don't add a stack trace to the catch arm — the §9.2.7/§9.7.7 discipline is a single actionable
  `❌` message + exit 1, mirroring every sibling arm.

---

## Confidence Score
**9.5 / 10** — one-pass success. The edit is four mechanical pieces (1 new import line, 1 extended
import, 1 synchronous call at a §G-pinned location, 1 catch arm identical in shape to six existing
siblings). Both input symbols are verified present with known signatures; the message format is
verbatim. The only non-obvious trap — the spawn-test ordering (auth precedes reasoning, so set
`ZAI_API_KEY` to isolate) — is fully specified and copied from the proven auth-preflight.test.ts
template. Residual risk is low: a prettier nit on the import ordering (trivially fixed by
`npm run format`) and the build-gate dependency for spawn tests (mitigated by describeOrSkip + an
explicit `npm run build` step in Level 2).