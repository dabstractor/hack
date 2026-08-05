# PRP — P1.M2.T2.S1: Add `HackConfigError` + `EnvironmentValidationError` clean arms to `main().catch()`

> Bugfix 001, **BUG-002 (Minor)** step 3. `.hack` validation errors (BOM, TOML parse, secrets,
> type/range/enum) and environment-validation errors are thrown as typed errors but render through
> `main().catch()`'s DEFAULT arm — `console.error('\n❌ Fatal error in main():', error)` — which
> dumps the full `Error` object + stack trace. This is inconsistent with the 4 dedicated clean arms
> (AuthPreflightError, HarnessProviderMismatchError, UnsupportedHarnessError, NotARepositoryError),
> each of which prints a single `❌ <message>` line + exit 1. **This item adds two clean arms**
> (`HackConfigError` + `EnvironmentValidationError`) before the default arm, so these user-facing
> misconfigurations render as one actionable line with no stack trace (PRD §9.7.6/§9.7.7/§9.2.7).
> **P1.M2.T1.S1** (parallel previous) defines `HackConfigError` + converts the 9 throw sites; **this
> item** consumes that export and adds the rendering arms in `src/index.ts`. **P1.M2.T2.S2** (next)
> writes the clean-rendering subprocess tests.

---

## Goal

**Feature Goal**: Add dedicated `instanceof HackConfigError` and `instanceof EnvironmentValidationError`
arms to `main().catch()` in `src/index.ts`, placed before the default arm, each rendering
`console.error(\`\n❌ ${error.message}\`); process.exit(1);` — identical to the 4 existing clean arms.
This suppresses the stack trace for these user-facing config/env misconfigurations, consistent with the
typed-error rendering convention (PRD §9.7.6/§9.7.7/§9.2.7 fail-fast actionable-startup-error philosophy).

**Deliverable**:
1. **`src/index.ts`** — EDIT: (a) extend the existing `from './config/types.js'` import block (lines
   45-49) to include `EnvironmentValidationError` + `HackConfigError` (NEITHER is currently imported —
   verified); (b) insert two new `if (error instanceof …)` arms in `main().catch()` immediately before
   the default arm (`console.error('\n❌ Fatal error in main():', error)`).

**Success Definition**:
- A thrown `HackConfigError` (a `.hack` BOM/type/range/enum/secrets/parse error from S1-of-T1's
  converted throw sites) renders as a SINGLE `\n❌ <message>` line + exit 1, with NO stack trace.
- A thrown `EnvironmentValidationError` (missing env vars) renders as a SINGLE `\n❌ <message>` line +
  exit 1, with NO stack trace.
- All 4 EXISTING clean arms + the default arm behave identically (non-matching errors still fall
  through to the default arm with the full dump).
- `npm run typecheck && npm run lint && npm run format:check` clean. Coverage is a regression FLOOR
  (89/90), NOT 100% (vitest.config.ts:55-57) — S1 lands cleanly; S2 (P1.M2.T2.S2) writes the
  clean-rendering subprocess tests.

---

## Why

- **BUG-002: rendering inconsistency.** PRD §9.7.6/§9.7.7 frame `.hack` failures as user-facing
  misconfigurations that must surface as actionable startup errors (§9.2.7: "a misconfigured `.hack`
  must not surface as a deep runtime error mid-pipeline"). The messages are already correct/actionable,
  but rendering them through the default arm appends a stack trace into `hack-config.js` internals —
  scary and inconsistent with the typed-error arms. This item makes the rendering match the spec intent.
- **Consumes S1-of-T1's typed-error foundation.** P1.M2.T1.S1 (parallel previous) converts the 9
  `.hack` throw sites from plain `Error` to `HackConfigError` — but WITHOUT a dedicated catch arm, the
  typed error STILL hits the default arm (same stack trace; the typing is invisible to the user until
  an arm consumes it). This item is the consumer that makes S1-of-T1's refactor user-visible.
- **Closes the EnvironmentValidationError gap.** `EnvironmentValidationError` (types.ts:79, thrown by
  `validateEnvironment`) ALSO lacks a dedicated arm and hits the default with a stack trace for the
  same reason. The architecture doc explicitly flags it ("Also consider adding EnvironmentValidationError
  to the same pass"). This item adds both in one pass — consistent treatment of user-facing config/env errors.
- **Matches the established convention exactly.** The 4 existing clean arms are the pattern; the 2 new
  arms are byte-identical in structure (`instanceof` → `console.error(\`\n❌ ${error.message}\`)` →
  `process.exit(1)`). No new pattern, no new format — same `❌` prefix, same message text; only the
  stack trace is suppressed.
- **Behavior-preserving for everything else.** Each arm matches on `instanceof` and exits; non-matching
  errors fall through unchanged to the default arm. Both error classes extend `Error`, so the arms are
  precise (no over-capture). No test asserts on the stack trace (the stack IS the bug); existing
  message-regex tests use `error.message`, which is unchanged.
- **Scope discipline.** This item edits ONLY `src/index.ts` (the import block + the 2 arms). It is
  file-disjoint from P1.M2.T1.S1 (types.ts + hack-config.ts) and from P1.M2.T2.S2 (the test file). It
  does NOT write tests (S2's deliverable), does NOT touch the config subcommand's own catch
  (architecture doc Step 5 — optional follow-up, out of scope), and does NOT edit any docs (rendering
  format is unchanged; DOCS: none).
- **Out of scope (hard boundary):** defining/converting `HackConfigError` (P1.M2.T1.S1), the
  clean-rendering subprocess tests (P1.M2.T2.S2), the config subcommand catch rendering
  (`src/cli/commands/config.ts` — optional follow-up), BUG-003 relational constraint (P1.M3.T1.S1),
  any `docs/*.md`, any other catch arm / error class.

---

## What

### User-visible behavior
A `.hack` validation failure (e.g. `[tasks_lock]\npoll_ms = -5`) or a missing-env-var failure now
prints a SINGLE `\n❌ <message>` line and exits 1 — no stack trace. Previously it printed
`\n❌ Fatal error in main(): Error: <message>` followed by a 4-line stack trace into internals. The
message TEXT and the `❌` prefix are UNCHANGED; only the stack trace (and the "Fatal error in main():"
preamble) is removed. All other error paths are unaffected.

### Technical requirements (exact contract)

**`src/index.ts` import block** (lines 45-49) — extend to include both classes (alphabetical,
prettier-sorted). BEFORE:
```ts
import {
  AuthPreflightError,
  HarnessProviderMismatchError,
  UnsupportedHarnessError,
} from './config/types.js';
```
AFTER:
```ts
import {
  AuthPreflightError,
  EnvironmentValidationError,
  HackConfigError,
  HarnessProviderMismatchError,
  UnsupportedHarnessError,
} from './config/types.js';
```

**`src/index.ts` `main().catch()`** — insert two new arms immediately BEFORE the default arm
(`console.error('\n❌ Fatal error in main():', error);`, currently line 412), i.e. right after the
`NotARepositoryError` arm's closing brace. Verbatim:
```ts
    if (error instanceof HackConfigError) {
      console.error(`\n❌ ${error.message}`); // §9.7.7: actionable one-line startup error (no stack)
      process.exit(1);
    }
    if (error instanceof EnvironmentValidationError) {
      console.error(`\n❌ ${error.message}`); // §9.2.7: missing-env actionable one-liner (no stack)
      process.exit(1);
    }
```
(Order among the clean arms does not matter — each `instanceof` arm exits on match. Placing the two new
arms after `NotARepositoryError` and before the default keeps the diff minimal and the readability
grouped: typed clean arms first, default last.)

### Success Criteria
- [ ] `HackConfigError` + `EnvironmentValidationError` imported from `'./config/types.js'` in `src/index.ts`.
- [ ] Two new `instanceof` arms in `main().catch()` before the default arm; each renders `\n❌ ${error.message}` + `process.exit(1)`.
- [ ] A `HackConfigError` no longer reaches the default arm (no stack trace).
- [ ] An `EnvironmentValidationError` no longer reaches the default arm (no stack trace).
- [ ] The 4 existing clean arms + the default arm behave identically (non-matching errors still hit the default).
- [ ] `npm run typecheck && npm run lint && npm run format:check` clean.
- [ ] Only `src/index.ts` modified (`git diff --name-only` shows exactly one file).

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_ **Yes** — the verbatim
import-block before/after, the verbatim two-arm insertion, the EXACT insertion site (immediately before
the default arm at line 412), the stale-line-number correction (contract says 404-423/default@421;
ACTUAL is 395-413/default@412 — verified by reading src/index.ts), the two error classes (HackConfigError
from S1-of-T1's contract + EnvironmentValidationError already at types.ts:79), the coverage-is-a-floor
fact (so S1 lands without S2's tests), the testability model (main() NOT exported → subprocess spawn,
per auth-preflight.test.ts:222-290 — S2's recipe), the manual smoke test, and the scope boundaries.
See `research/catch-arm-wiring.md` for per-claim evidence.

### Documentation & References
```yaml
# MUST READ — the BUG-002 fix strategy (what this item implements: step 3)
- docfile: plan/009_94353b1a9fd3/bugfix/001_412283d974f7/architecture/bug_002_fix_strategy.md
  section: "Step 3: Add clean arm to main().catch()" + "Risks"
  why: Prescribes the verbatim HackConfigError arm + the EnvironmentValidationError arm, the insertion
        site (before the default arm), and the test-safety guarantee (instanceof Error / e.message unchanged).
  critical: Step 5 (config subcommand catch) is OPTIONAL and OUT OF SCOPE here — the main().catch() arms
        alone satisfy BUG-002 (subcommand paths propagate through program.parse() → main() → main().catch()).

# MUST READ — this subtask's research (the exact edit map + test pattern + scope)
- docfile: plan/009_94353b1a9fd3/bugfix/001_412283d974f7/P1M2T2S1/research/catch-arm-wiring.md
  section: "1. ACTUAL main().catch() block", "2. import extension", "3. the two error classes",
           "4. coverage is a FLOOR", "5. testability model (subprocess spawn)", "6. manual smoke test", "7/8. scope"
  why: The stale-line-number correction (contract 404-423 vs actual 395-413); the verified fact that NEITHER
        class is currently imported; the verbatim before/after import block; the verbatim two-arm insertion;
        the coverage-floor fact (so S1 lands without S2's tests); the subprocess-spawn test recipe (S2's
        deliverable, referenced so the change is confirmed observable); the disjointness from S1-of-T1.

# CONTEXT — S1-of-T1 (the HackConfigError PROVIDER) — read the CONTRACT, assume it landed
- docfile: plan/009_94353b1a9fd3/bugfix/001_412283d974f7/P1M2T1S1/PRP.md
  why: Defines `export class HackConfigError extends Error` (message-only ctor, this.name='HackConfigError')
        in src/config/types.ts + converts the 9 throw sites in hack-config.ts. This item CONSUMES that
        export (import + instanceof arm). S1-of-T1 is file-disjoint (types.ts + hack-config.ts); this item
        touches ONLY index.ts → no merge conflict. Assume HackConfigError is exported from types.ts.

# THE FILE TO EDIT
- file: src/index.ts
  why: EDIT the import block (45-49) + main().catch() (insert 2 arms before the default @ line 412).
  pattern: "if (error instanceof AuthPreflightError) { console.error(`\\n❌ ${error.message}`); process.exit(1); }"
  critical: The ACTUAL default arm is at line 412 (`console.error('\\n❌ Fatal error in main():', error);`), NOT
        421 as the work-item contract states (line numbers shifted). Insert the 2 new arms immediately BEFORE
        it. main() is NOT exported and index.ts AUTO-RUNS void main().catch(...) — so the arms are verified
        end-to-end via subprocess spawn, not in-process unit tests (that's S2's deliverable).

# THE TWO ERROR CLASSES (consume, do not define)
- file: src/config/types.ts
  why: READ-ONLY — provides EnvironmentValidationError (line 79; ctor(missing: string[]); message = "Missing
        required environment variables: …") + HackConfigError (ADDED by S1-of-T1; message-only ctor). Both
        extend Error → error.message works + instanceof arms are precise. Do NOT edit this file (S1-of-T1 owns it).
  pattern: "export class EnvironmentValidationError extends Error { constructor(missing: string[]) { super(`Missing required environment variables: ${missing.join(', ')}`); this.name = 'EnvironmentValidationError'; … } }"

# TEST PATTERN — how the catch arms are verified (S2's deliverable; referenced for observability)
- file: tests/unit/config/auth-preflight.test.ts
  why: The ESTABLISHED end-to-end pattern for catch-arm rendering (lines 222-290): main() is NOT exported, so
        verify via spawnSync(process.execPath, [CLI, ...], { env }) against dist/index.js; assert res.status===1 +
        res.stderr contains the ❌ message + res.stderr does NOT match /\\n\\s*at / (no stack). describe.skip
        when dist/index.js is absent. S2 (P1.M2.T2.S2) mirrors this for HackConfigError/EnvironmentValidationError.
        This item references it so the implementing agent confirms the change is OBSERVABLE (manual smoke test
        in research §6) — it does NOT write the tests.

# CONSUMER-ADJACENT (read-only — do NOT edit)
- file: src/config/hack-config.ts
  why: S1-of-T1 converts the 9 throw sites to HackConfigError here. READ-ONLY for this item (S1-of-T1 owns it).
- file: src/cli/commands/config.ts
  why: the `hack config validate` path uses `e instanceof Error ? e.message : String(e)` → works identically
        with HackConfigError (subclass, same .message). Its own catch rendering is the OPTIONAL Step 5
        follow-up — OUT OF SCOPE here (flag in commit message, don't implement).

# COVERAGE CONFIG — confirms S1 lands without S2's tests
- file: vitest.config.ts
  why: thresholds (55-57): statements 89, branches 90 — a regression FLOOR (~90% actual), NOT 100%. The 2 new
        if-branches in main().catch() do NOT drop coverage below the gate before S2's tests land.
```

### Current Codebase tree (relevant slice)
```bash
src/index.ts                      # EDIT — import block (45-49) + main().catch() (+2 arms before default@412)
src/config/types.ts               # UNCHANGED (S1-of-T1 adds HackConfigError here; provides EnvironmentValidationError@79)
src/config/hack-config.ts         # UNCHANGED (S1-of-T1 converts 9 throw sites here)
src/cli/commands/config.ts        # UNCHANGED (optional Step 5 follow-up — out of scope)
tests/unit/config/auth-preflight.test.ts  # UNCHANGED (the subprocess-spawn test PATTERN; S2 mirrors it)
```

### Desired Codebase tree with files to be added/edited
```bash
src/index.ts                      # MODIFIED (+2 imports, +2 catch arms)
# No test changes (S2 = P1.M2.T2.S2 writes the clean-rendering subprocess tests). No docs/*.md (DOCS: none).
```

### Known Gotchas of our codebase & Library Quirks
```ts
// CRITICAL — STALE LINE NUMBERS. The work-item contract cites main().catch() at "404-423, default@421".
//   The ACTUAL block (verified by reading src/index.ts) is at 395-413, default arm at LINE 412
//   (`console.error('\n❌ Fatal error in main():', error);`). Insert the 2 new arms immediately BEFORE
//   line 412. Do NOT trust the contract's line numbers — anchor on the default arm's text, not its number.

// CRITICAL — NEITHER class is currently imported. The contract speculated EnvironmentValidationError "may
//   already be" imported — it is NOT (verified: the import block 45-49 has only AuthPreflightError,
//   HarnessProviderMismatchError, UnsupportedHarnessError). ADD BOTH EnvironmentValidationError + HackConfigError.
//   NotARepositoryError is imported from a DIFFERENT module (./utils/repo-root.js:59) — do not touch it.

// CRITICAL — main() is NOT exported + index.ts AUTO-RUNS void main().catch(...). You CANNOT unit-test the
//   catch arms in-process (importing index.ts runs the whole bootstrap). The arms are verified END-TO-END via
//   subprocess spawn (spawnSync against dist/index.js) — that is S2's (P1.M2.T2.S2) deliverable. This item
//   references the recipe (research §5) + a manual smoke test (research §6) to confirm the change is observable.

// CRITICAL — Coverage is a FLOOR (statements 89 / branches 90), NOT 100% (vitest.config.ts:55-57). The 2 new
//   if-branches do NOT drop coverage below the gate before S2's tests. Do NOT write tests here (S2's scope);
//   do NOT block S1 on coverage. (Contrast: other hacky-hack projects enforce 100% — THIS one does not.)

// CRITICAL — Depends on P1.M2.T1.S1 having landed (it defines + exports HackConfigError from types.ts). If
//   S1-of-T1 has NOT landed, the `import { HackConfigError }` will fail typecheck ("has no exported member
//   'HackConfigError'"). This is the intended sequencing — S1-of-T1 and this item are a matched pair. If
//   typecheck fails on the HackConfigError import, confirm S1-of-T1 landed first.

// GOTCHA — Both arms must render `console.error(\`\n❌ ${error.message}\`)` (template literal, backtick),
//   IDENTICAL to the 4 existing arms — NOT `console.error('\n❌ Fatal error in main():', error)` (the default
//   arm's two-arg form, which dumps the object). The single-arg template-literal form suppresses the stack.

// GOTCHA — Order among the clean arms does not matter (each instanceof arm exits on match). Place the 2 new
//   arms after NotARepositoryError (the 4th arm) + before the default for a minimal, readable diff. Do NOT
//   reorder the existing 4 arms.

// GOTCHA — prettier is ERROR-enforced (format:check). The extended import block must be alphabetically sorted
//   (AuthPreflightError, EnvironmentValidationError, HackConfigError, HarnessProviderMismatchError,
//   UnsupportedHarnessError). Run `npm run fix` before format:check.

// GOTCHA — Do NOT run the full `npm run test:run` as the gate (orthogonal pre-existing failures per the
//   bugfix architecture docs). Gate = typecheck + lint + format:check + a manual smoke test (research §6).

// CRITICAL — DO NOT touch src/config/types.ts (S1-of-T1 owns it), src/config/hack-config.ts (S1-of-T1),
//   src/cli/commands/config.ts (optional Step 5 follow-up — out of scope), any test file (S2's scope),
//   or any docs/*.md (DOCS: none — rendering format unchanged, only stack suppressed).
```

---

## Implementation Blueprint

### Data models and structure
No new data models. This item consumes two existing exported classes (`HackConfigError` from S1-of-T1,
`EnvironmentValidationError` from types.ts:79) and adds two `instanceof` arms + two import names. The
only "structure" is the import block + the two arms (both verbatim above).

### Implementation Tasks (ordered by dependencies)
```yaml
Task 1: EDIT src/index.ts  (the import block — lines 45-49)
  - EXTEND the `from './config/types.js'` import block to add EnvironmentValidationError + HackConfigError,
    alphabetically sorted (verbatim AFTER block in "Technical requirements").
  - DO NOT: touch the NotARepositoryError import (it's from ./utils/repo-root.js:59); reorder existing names.
  - EXPECTED: typecheck clean IF S1-of-T1 has landed (HackConfigError exported). If typecheck reports "has no
    exported member 'HackConfigError'", confirm S1-of-T1 (P1.M2.T1.S1) landed first.

Task 2: EDIT src/index.ts  (the two catch arms — before the default arm @ line 412)
  - INSERT the two new `if (error instanceof …)` arms (verbatim in "Technical requirements") immediately
    BEFORE the default arm `console.error('\n❌ Fatal error in main():', error);` (line 412), i.e. right
    after the NotARepositoryError arm's closing brace (line 411).
  - Each arm: `console.error(\`\n❌ ${error.message}\`)` (single-arg template literal — NOT the default's
    two-arg form) + `process.exit(1);`.
  - DO NOT: reorder the existing 4 arms; change the default arm; use the two-arg console.error form.
  - EXPECTED: typecheck/lint clean. The 2 new arms match their typed errors and exit; everything else
    falls through unchanged.

Task 3: FORMAT + VERIFY
  - RUN: npm run fix → npm run typecheck → npm run lint → npm run format:check.
  - RUN (manual smoke, no build required): in a git repo with a valid PRD.md,
        echo -e '[tasks_lock]\npoll_ms = -5' > .hack
        npx tsx src/index.ts --dry-run --prd PRD.md 2>&1 | tail -5
    EXPECTED: a SINGLE `❌ [tasks_lock] poll_ms in <path>/.hack: -5 is out of range (...)` line, NO stack frames.
    BEFORE the fix it printed `❌ Fatal error in main(): Error: …` + 4 `at …` stack lines.
  - RUN: git diff --name-only   # Expect EXACTLY src/index.ts.
  - DO NOT run the full `npm run test:run` (orthogonal pre-existing failures — not this item's concern).
    Do NOT write subprocess tests (S2 = P1.M2.T2.S2 owns them).
  - EXPECTED: typecheck/lint/format clean; manual smoke shows a single ❌ line with no stack; git diff
    shows only src/index.ts. If the smoke test still shows a stack, the arms were placed AFTER the default
    arm or used the two-arg console.error form — re-check insertion site + form.
```

### Implementation Patterns & Key Details
```ts
// ---- src/index.ts: the import block (lines 45-49 → extended) ----
import {
  AuthPreflightError,
  EnvironmentValidationError,
  HackConfigError,
  HarnessProviderMismatchError,
  UnsupportedHarnessError,
} from './config/types.js';

// ---- src/index.ts main().catch(): the two new arms (before the default @ line 412) ----
    if (error instanceof HackConfigError) {
      console.error(`\n❌ ${error.message}`); // §9.7.7: actionable one-line startup error (no stack)
      process.exit(1);
    }
    if (error instanceof EnvironmentValidationError) {
      console.error(`\n❌ ${error.message}`); // §9.2.7: missing-env actionable one-liner (no stack)
      process.exit(1);
    }
    console.error('\n❌ Fatal error in main():', error);   // ← DEFAULT (unchanged; full dump for unknown errors)
    process.exit(1);

// ---- manual smoke test (research §6) ----
//   echo -e '[tasks_lock]\npoll_ms = -5' > .hack
//   npx tsx src/index.ts --dry-run --prd PRD.md 2>&1 | tail -5
//   EXPECTED: single `❌ [tasks_lock] poll_ms ...` line, no `at validateFieldValue (...)` frames.
```

### Integration Points
```yaml
INDEX.TS (src/index.ts):
  - +2 imports (EnvironmentValidationError, HackConfigError) on the existing './config/types.js' block.
  - main().catch(): +2 instanceof arms before the default arm (line 412).
  - PRESERVE: the 4 existing clean arms; the default arm; NotARepositoryError import (./utils/repo-root.js);
    main()'s body; the .then() exit-code handler; the top-of-file process-handler setup.

TYPES.TS (src/config/types.ts): UNCHANGED — S1-of-T1 adds HackConfigError; EnvironmentValidationError@79 pre-exists.

HACK-CONFIG.TS (src/config/hack-config.ts): UNCHANGED — S1-of-T1 converts the 9 throw sites to HackConfigError.

DOWNSTREAM (S2 — P1.M2.T2.S2; NOT this item):
  - tests (subprocess spawn against dist/index.js): assert exit 1 + stderr has the ❌ message + NO stack-trace
    lines (/\n\s*at /) for a HackConfigError (malformed .hack) and an EnvironmentValidationError (scrubbed env).
    Mirrors tests/unit/config/auth-preflight.test.ts:222-290.

DOCS (none):
  - Rendering format is UNCHANGED (same ❌ prefix, same message text); only the stack trace is suppressed.
    No docs/*.md, README, or .env.example changes. The per-arm `// §…` comments are the only doc artifact.

OPTIONAL FOLLOW-UP (out of scope — flag in commit message):
  - src/cli/commands/config.ts Step 5: have the config subcommand's own catch detect instanceof HackConfigError
    and render via console.error(`\n❌ ${error.message}`) instead of logger().error(). NOT required (the
    main().catch() arms handle subcommand paths via program.parse() → main() propagation; ConfigCommand.execute
    has its own inner catch). Flag it; do NOT implement it.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
npm run fix            # lint:fix + prettier --write (run first — the import block must be alphabetically sorted)
npm run typecheck      # tsc --noEmit -p tsconfig.build.json — clean (IF S1-of-T1 landed; else HackConfigError import errors)
npm run lint           # eslint . --ext .ts — clean
npm run format:check   # prettier --check — clean
# Expected: all clean. Likely failure: "has no exported member 'HackConfigError'" → S1-of-T1 (P1.M2.T1.S1) hasn't
#   landed yet (it defines the class). Confirm sequencing. Otherwise a prettier nit on import ordering (npm run fix).
```

### Level 2: Component Validation (manual smoke — no in-process unit test possible)
```bash
# main() is NOT exported → no in-process unit test. Verify end-to-end via tsx (no build needed):
#   1. HackConfigError path (a .hack range error — requires S1-of-T1's converted throw sites):
echo -e '[tasks_lock]\npoll_ms = -5' > .hack
npx tsx src/index.ts --dry-run --prd PRD.md 2>&1 | tail -5
# EXPECTED: `\n❌ [tasks_lock] poll_ms in <path>/.hack: -5 is out of range (expected integer in [1, +∞]).`
#   — a SINGLE ❌ line. NO `❌ Fatal error in main():` preamble, NO `    at validateFieldValue (...)` stack frames.
#   (If S1-of-T1 hasn't converted the throw sites yet, this still throws a plain Error → default arm → stack.
#    That's expected until S1-of-T1 lands; the ARM itself is correct.)
rm .hack

#   2. (Optional) EnvironmentValidationError path — scrub a required env var so validateEnvironment throws.
#      Assert the same single-❌-line render. (Exact reproduction depends on which env vars are required; a
#      targeted subprocess test is S2's deliverable.)
# Do NOT run the full `npm run test:run` (orthogonal pre-existing failures). Subprocess tests are S2's scope.
```

### Level 3: Integration / Regression (System Validation)
```bash
# Confirm ONLY src/index.ts changed (file-disjoint from S1-of-T1 + S2):
git diff --name-only                           # Expect EXACTLY src/index.ts.
# Confirm the 2 imports + 2 arms landed:
grep -n "HackConfigError\|EnvironmentValidationError" src/index.ts   # Expect: 2 import lines + 2 instanceof arms (≥4 hits).
grep -n "instanceof NotARepositoryError" src/index.ts                # Expect: 1 (the existing arm, UNCHANGED).
grep -c "Fatal error in main()" src/index.ts                         # Expect: 1 (the default arm, UNCHANGED).
# Build emits dist/ cleanly (proves the imports + arms compile — also enables S2's subprocess tests):
npx tsc -p tsconfig.build.json
# Sibling regression — types.ts/hack-config.ts unchanged by this item (S1-of-T1 owns them):
npx vitest run tests/unit/config/hack-config.test.ts 2>/dev/null || echo "(S1-of-T1 owns hack-config; run its suite if landed)"
# Expected: git diff shows only src/index.ts; grep confirms 2 imports + 2 arms + default unchanged; build clean.
```

### Level 4: Creative & Domain-Specific Validation
```bash
# No MCP/DB/HTTP. Domain checks (record in commit message):
#   1. A .hack misconfiguration (HackConfigError) now renders as ONE actionable ❌ line, no stack — matching
#      NotARepositoryError/AuthPreflightError (PRD §9.7.6/§9.7.7/§9.2.7 fail-fast philosophy).
#   2. A missing-env-var failure (EnvironmentValidationError) renders the same clean way.
#   3. The 4 existing clean arms + the default arm are UNCHANGED (non-matching errors still get the full dump).
#   4. Rendering FORMAT is unchanged (same ❌ prefix, same message text) — only the stack trace + the
#      "Fatal error in main():" preamble are suppressed for these two typed errors.
#   5. Coverage is a floor (89/90), not 100% — S1 lands cleanly; S2 (P1.M2.T2.S2) writes the subprocess tests.
#   6. Scope: ONLY src/index.ts; consumes S1-of-T1's HackConfigError export; file-disjoint from S1-of-T1 + S2.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` clean (confirms S1-of-T1 landed + imports resolve).
- [ ] `npm run lint` clean.
- [ ] `npm run format:check` clean.
- [ ] `git diff --name-only` shows EXACTLY `src/index.ts`.
- [ ] `npx tsc -p tsconfig.build.json` builds cleanly (enables S2's subprocess tests).

### Feature Validation
- [ ] `HackConfigError` + `EnvironmentValidationError` imported from `'./config/types.js'`.
- [ ] Two new `instanceof` arms in `main().catch()` before the default arm; each `\n❌ ${error.message}` + `process.exit(1)`.
- [ ] Manual smoke: a `.hack` range error prints a single `❌` line with NO stack trace.
- [ ] The 4 existing clean arms + the default arm unchanged (grep proof in Level 3).

### Code Quality Validation
- [ ] The two new arms mirror the existing clean-arm pattern exactly (single-arg template-literal console.error).
- [ ] Import block is alphabetically sorted (prettier-compliant).
- [ ] Only `src/index.ts` modified; `types.ts`/`hack-config.ts`/`config.ts`/test files/`docs/*.md` UNCHANGED.

### Documentation & Deployment
- [ ] Per-arm `// §…` comments are the only doc artifact (rendering format unchanged → no docs/*.md).
- [ ] No new env vars.
- [ ] Commit message notes: the 2 clean arms (BUG-002 step 3); consumes S1-of-T1's HackConfigError; the
      stale-line-number correction (contract 404-423 vs actual 395-413/default@412); the coverage-is-a-floor
      fact (S1 lands, S2 writes tests); the main()-not-exported → subprocess-spawn test model (S2); the
      OPTIONAL config-subcommand Step 5 follow-up (flagged, NOT implemented).

---

## Anti-Patterns to Avoid

- ❌ Don't trust the contract's line numbers (404-423 / default@421). The ACTUAL block is 395-413 / default@412
      (verified). Anchor on the default arm's TEXT (`console.error('\n❌ Fatal error in main():', error);`),
      not its line number. Insert the 2 new arms immediately BEFORE it.
- ❌ Don't assume `EnvironmentValidationError` is already imported — it is NOT (verified). ADD BOTH it and
      `HackConfigError` to the existing `from './config/types.js'` block.
- ❌ Don't use the default arm's two-arg `console.error('\n❌ Fatal error in main():', error)` form. The clean
      arms use the SINGLE-ARG template literal `console.error(\`\n❌ ${error.message}\`)` — that's what
      suppresses the stack. The two-arg form dumps the object (stack included).
- ❌ Don't write subprocess/unit tests in this item — that's S2 (P1.M2.T2.S2). This item wires the arms +
      imports; the manual smoke test (research §6) confirms observability. (Coverage is a floor, not 100%, so
      S1 lands without S2's tests — do not block on coverage.)
- ❌ Don't edit `src/config/types.ts` (S1-of-T1 owns it — it adds HackConfigError), `src/config/hack-config.ts`
      (S1-of-T1 converts the 9 throw sites), `src/cli/commands/config.ts` (the optional Step 5 config-handler
      follow-up — out of scope), any test file (S2), or any `docs/*.md` (DOCS: none).
- ❌ Don't implement the config-subcommand Step 5 follow-up (architecture doc). It's OPTIONAL and out of scope —
      the main().catch() arms handle subcommand paths via program.parse() → main() propagation. Flag it; don't do it.
- ❌ Don't reorder the 4 existing clean arms. Place the 2 new arms after NotARepositoryError + before the default
      for a minimal, readable diff.
- ❌ Don't run the full `npm run test:run` as the gate — orthogonal pre-existing failures. Gate = typecheck +
      lint + format:check + the manual smoke test.
- ❌ Don't block on the HackConfigError typecheck if S1-of-T1 hasn't landed — confirm the sequencing first
      (this item CONSUMES S1-of-T1's export; they're a matched pair). If S1-of-T1 is still in flight, the
      import will error until it lands.

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: This is a tiny, mechanical, behavior-preserving change — two import names added to an existing
import block + two `instanceof` arms copy-pasted from the 4 existing siblings (byte-identical structure) and
inserted before the default arm. The exact before/after import block and the verbatim arm bodies are specified;
the insertion site is pinned by TEXT (the default arm), not the stale line number in the contract; and the two
error classes are documented (HackConfigError from S1-of-T1's contract, EnvironmentValidationError already at
types.ts:79). The coverage-is-a-floor fact (89/90, not 100%) means S1 lands cleanly without S2's tests, and the
main()-not-exported → subprocess-spawn test model is documented as S2's recipe (this item confirms observability
via a manual tsx smoke test). The work is file-disjoint from S1-of-T1 (types.ts + hack-config.ts) and from S2
(the test file) — only `src/index.ts` changes. The one sequencing dependency (S1-of-T1 must land for the
HackConfigError import to typecheck) is explicit and intentional (matched pair). Residual risks: (a) implementing
before S1-of-T1 lands → HackConfigError import typecheck error (caught immediately; resolved by sequencing);
(b) a prettier nit on import ordering (auto-fixed via `npm run fix`); (c) accidentally using the two-arg
console.error form (caught by the manual smoke test — a stack trace would still appear). No runtime/network/LLM
unknowns — the arms are pure rendering + exit.