# PRP — P1.M1.T1.S1: Reorder `main()` — local-only early-returns before preflight + harness init (move root logger up)

> Bugfix 002, **Issue 1 (MAJOR)** of
> `plan/007_8783a1f5e14a/bugfix/002_edc62322bc90/TEST_RESULTS.md`.
> The auth preflight (`runAuthPreflight()`) blocks two pure-local CLI modes
> (`--validate-prd`, `--dry-run`) that make **zero** API calls.

---

## Goal

**Feature Goal**: In `src/index.ts` `main()`, move the root-logger creation (and its verbose
block) **up** to immediately after `configureEnvironment()`, then move the two pure-local
early-return branches (`--dry-run`, `--validate-prd`) **ahead of** `runAuthPreflight()` /
`ensureHarnessInitialized()`. After this change, the local-only modes run credential-free;
the preflight and harness init run only on paths that actually construct `PRPPipeline` and
invoke an agent.

**Deliverable**: A reordered `main()` in `src/index.ts` whose statement order is:

```
parseCLIArgs → args → setupGlobalHandlers → configureEnvironment
  → getLogger('App', {...})              [moved up]
  → if (args.verbose) { logger.debug }   [moved up with the logger]
  → if (args.dryRun)    { ...; return 0; }            [credential-free, moved up]
  → if (args.validatePrd){ ...; return valid?0:1; }   [credential-free, moved up]
  → await runAuthPreflight()                          [agent paths only, moved down]
  → await ensureHarnessInitialized()                  [agent paths only, moved down]
  → parseScope → new PRPPipeline(...) → pipeline.run() → result handling
```

…plus an updated JSDoc `@remarks` block on `main()` documenting the new ordering (Mode A: docs
ride with the code; no separate docs subtask).

**Success Definition**:
- The two local-only modes (`--dry-run`, `--validate-prd`) return **before** any
  credential/harness requirement, so they succeed with NO auth env var set.
- The bodies of the dry-run, validate-prd, verbose, and logger-creation blocks are
  **byte-for-byte identical** to today (only their position changes).
- `runAuthPreflight` / `ensureHarnessInitialized` / `PRDValidator` / `parseCLIArgs` are
  **not modified**.
- Every §9.2.7 acceptance criterion is preserved for the agent-invoking paths (the preflight
  still aborts before any session dir / agent is created on those paths).
- `npm run typecheck && npm run lint && npm run format:check` are clean.
- The root logger is still created inside `main()` (NOT at module top-level) → §9.6.2 REQ-L2
  preserved; §9.6.3 `--help` timing unaffected.

---

## Why

- **Fixes a Major UX/onboarding defect (TEST_RESULTS.md Issue 1).** With no credential,
  `hack --validate-prd PRD.md` and `hack --prd PRD.md --dry-run` abort at the preflight with a
  message instructing `pi /login` / `export ZAI_API_KEY=…` — actively misleading, because both
  modes are purely local (a markdown linter; an args printer). A new user validating their first
  PRD before setting up API access is blocked.
- **Matches the PRD's own motivation for the preflight.** PRD §9.2.7 says the preflight exists
  because a misconfigured credential "is not detected until the first agent actually calls the
  model." `--dry-run`/`--validate-prd` never call a model, so gating them is incorrect.
- **Preserves §9.2.7 exactly for real agent paths.** Reordering puts the preflight before
  `new PRPPipeline(...)` (the only path that constructs an agent), so the no-credential abort
  still happens before any session dir/agent is created on those paths. Nothing in §9.2.7's
  acceptance matrix changes.
- **Logger move is safe.** `getLogger('App', {verbose, machineReadable})` is independent of
  credentials/harness (reads args only) and lives inside `main()` (function scope, not module
  top-level), so §9.6.2 REQ-L2 ("lazy loggers") is preserved. `--help`/`--version` exit inside
  `parseCLIArgs()` before `main()`'s body runs, so the §9.6.3 ~560 ms timing is unaffected.
- **Scope discipline.** This is S1 (reorder + JSDoc only). S2 adds subprocess acceptance tests.
  `agent-factory.ts` / the harness-error path (Issue 2) is a separate milestone (P1.M1.T2).
  No docs files (P1.M1.T3).

---

## What

### User-visible behavior
- `hack --validate-prd PRD.md` and `hack --prd PRD.md --dry-run` now succeed (exit 0 / 0-or-1)
  with **no** API credential configured.
- All other modes behave exactly as before (preflight still gates them).
- `--help` / `-h` / `--version` / `-V` / unknown flags / `inspect` are unaffected (they exit
  inside `parseCLIArgs()` before `main()`'s body).

### Technical requirements (exact contract)

**File:** `src/index.ts`, function `main()` (starts at line 99; reorder affects lines ~115–198).

**(a) Move the logger creation + verbose block UP** to immediately after
`configureEnvironment();`. These blocks relocate verbatim:

Logger creation (currently src/index.ts:130–133):
```ts
const logger: Logger = getLogger('App', {
  verbose: args.verbose,
  machineReadable: args.machineReadable,
});
```
Verbose block (currently src/index.ts:136–139) — keep immediately after the logger:
```ts
if (args.verbose) {
  logger.debug('Verbose mode enabled');
  logger.debug('Parsed CLI arguments:', args);
}
```

**(b) Keep the dry-run and validate-prd blocks BYTE-FOR-BYTE identical** and move them to
immediately after the verbose block (i.e. before the preflight). dry-run currently
src/index.ts:142–152; validate-prd currently src/index.ts:155–198.

**(c) Move the preflight + harness-init DOWN** to after the validate-prd early-return:
```ts
await runAuthPreflight();
await ensureHarnessInitialized();
```

**(d) Leave everything else unchanged** — `parseCLIArgs`, the `args` typing, `setupGlobalHandlers`,
`configureEnvironment`, the scope parsing, `new PRPPipeline(...)`, `pipeline.run()`, and all
result handling (shutdown/fail/success). Do NOT modify `runAuthPreflight` /
`ensureHarnessInitialized` / `PRDValidator` / `parseCLIArgs`.

**(e) Update the JSDoc `@remarks` on `main()`** (Mode A) to document the new ordering. State
explicitly that pure-local modes (`--dry-run`, `--validate-prd`) run credential-free BEFORE the
§9.2.7 preflight and harness initialization, and cite bugfix PRD §h3.2. Keep it concise.

**Resulting `main()` skeleton** (comment markers added for clarity — the implementer moves real
blocks, not these comments):
```ts
async function main(): Promise<number> {
  const parseResult = parseCLIArgs();
  if ('subcommand' in parseResult) return 0;   // unchanged
  const args: ValidatedCLIArgs = parseResult;  // unchanged
  setupGlobalHandlers(args.verbose);           // unchanged
  configureEnvironment();                       // unchanged

  // [MOVED UP] root logger — independent of creds/harness; still function-scope (REQ-L2 safe).
  const logger: Logger = getLogger('App', { verbose: args.verbose, machineReadable: args.machineReadable });
  if (args.verbose) { logger.debug('Verbose mode enabled'); logger.debug('Parsed CLI arguments:', args); }

  // [MOVED UP — credential-free] local-only modes make zero API calls (PRD §h3.2).
  if (args.dryRun)     { /* unchanged body */; return 0; }
  if (args.validatePrd){ /* unchanged body */; return result.valid ? 0 : 1; }

  // [MOVED DOWN] only agent-invoking paths need credentials + an initialized harness (§9.2.7).
  await runAuthPreflight();
  await ensureHarnessInitialized();

  const scope: Scope | undefined = args.scope ? parseScope(args.scope) : undefined;  // unchanged
  if (args.verbose && scope) { logger.debug('Parsed scope:', scope); }               // unchanged
  const pipeline = new PRPPipeline(...);   // unchanged
  const result = await pipeline.run();     // unchanged
  // ... result handling unchanged ...
}
```

### Success Criteria
- [ ] `main()` creates the root logger immediately after `configureEnvironment()`.
- [ ] `--dry-run` and `--validate-prd` early-returns execute BEFORE `runAuthPreflight()`.
- [ ] `runAuthPreflight()` + `ensureHarnessInitialized()` execute only on the path that reaches
      `new PRPPipeline(...)`.
- [ ] The bodies of the moved blocks are identical to today (diff shows only line moves).
- [ ] `runAuthPreflight`/`ensureHarnessInitialized`/`PRDValidator`/`parseCLIArgs` are unchanged.
- [ ] `main()` JSDoc `@remarks` documents the ordering and cites PRD §h3.2.
- [ ] `npm run typecheck && npm run lint && npm run format:check` are clean.
- [ ] `node dist/index.js --prd PRD.md --validate-prd` succeeds with NO auth env var (after build).

---

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed to implement
this successfully?_ **Yes** — the current statement order, the exact target order, the verbatim
blocks to relocate, the verified contract facts (CLI fields, PRDValidator locality, getLogger
type), the safe-to-move rationale, and the executable validation commands are all specified with
file:line references. No judgement calls remain.

### Documentation & References

```yaml
# MUST READ — root cause + exact target ordering
- docfile: plan/007_8783a1f5e14a/bugfix/002_edc62322bc90/architecture/system_context.md
  section: "1. The startup flow today (as-built)" and "2. Root cause — Issue 1"
  why: Documents the current main() order, the import graph (parseCLIArgs exits before main body),
        and the verbatim "Resulting order" target this PRP encodes.
  critical: Confirms --help/--version/inspect exit inside parseCLIArgs() BEFORE main()'s body, so
        the reorder cannot regress §9.6.3 --help timing. Also confirms logger move is REQ-L2-safe.

# MUST READ — the bug report + the exact suggested fix
- docfile: plan/007_8783a1f5e14a/bugfix/002_edc62322bc90/TEST_RESULTS.md
  section: "Issue 1" (h3.2) — "Suggested fix"
  why: The authoritative statement of the defect and the reorder this PRP implements.

# MUST READ — reorder line-plan with verified current line numbers
- docfile: plan/007_8783a1f5e14a/bugfix/002_edc62322bc90/P1M1T1S1/research/main-reorder-plan.md
  section: "3. EXACT lines to move" and "5. Why moving getLogger up is safe"
  why: Enumerates the four blocks to relocate (logger/verbose/dry-run/validate-prd) with their
        current src/index.ts line numbers and the byte-for-byte-preservation requirement.

# PATTERN FILE — the only file being edited
- file: src/index.ts
  why: Contains main() (function starts line 99). The reorder is a cut-paste of four blocks within
        lines ~115–198, plus a JSDoc @remarks edit on main().
  pattern: "configureEnvironment(); await runAuthPreflight(); await ensureHarnessInitialized(); getLogger(...); if(dryRun){...} if(validatePrd){...}"
  gotcha: >
    The verbose block (logger.debug 'Verbose mode enabled'/'Parsed CLI arguments') depends on
    `logger`, so it MUST travel with the logger — keep verbose immediately after logger creation,
    before the dry-run branch. Do not leave the verbose block stranded below the preflight (it
    would reference `logger` defined above, which still typechecks, but semantically verbose info
    should print in local modes too — keep them together).

# VERIFIED CONTRACT FACTS (do not re-discover)
- fact: "parseCLIArgs() calls process.exit() for --help/-h/--version/-V/unknown-flag/inspect BEFORE main()'s body"
- fact: "PRDValidator (src/utils/prd-validator.ts:27-30) imports ONLY prd-differ, session-utils, node:path, node:fs/promises — purely local"
- fact: "ValidatedCLIArgs fields present: dryRun (cli/index.ts:76), validatePrd (:94), verbose (:82), machineReadable (:85)"
- fact: "getLogger + type Logger imported at src/index.ts:47 (unchanged)"
- fact: "Entry point void main().catch() (src/index.ts:312) handles ONLY AuthPreflightError — do NOT touch it here (P1.M1.T2.S2 owns extending it)"
- fact: "REQ-L2: NO module-top-level getLogger(); the root logger lives inside main() → moving it within main() stays compliant"
```

### Current Codebase tree (relevant slice)

```bash
src/
├── index.ts                  # EDIT — main() reorder + JSDoc @remarks
├── cli/index.ts              # READ-ONLY (parseCLIArgs, ValidatedCLIArgs) — not modified
├── config/harness.ts         # READ-ONLY (runAuthPreflight, ensureHarnessInitialized) — not modified
├── config/environment.ts     # READ-ONLY (configureEnvironment) — not modified
├── config/types.ts           # READ-ONLY (AuthPreflightError) — not modified
├── utils/prd-validator.ts    # READ-ONLY (PRDValidator — purely local) — not modified
└── utils/logger.ts           # READ-ONLY (getLogger, Logger) — not modified
```

### Desired Codebase tree with files to be added/edited

```bash
src/
└── index.ts                  # MODIFIED (the ONLY file touched in this subtask)
# No new files. No test files (S2 owns acceptance tests). No docs files (P1.M1.T3).
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — move the verbose block WITH the logger. It calls logger.debug(...), so if you move
//   only the logger up and leave verbose below the preflight, verbose logging would be skipped in
//   local modes (and the debug of CLI args would run after preflight for agent paths). Keep them
//   adjacent: logger creation → verbose block → dry-run → validate-prd.

// CRITICAL — byte-for-byte body preservation. The dry-run and validate-prd blocks contain real
//   logic (PRDValidator instantiation + a full validation-report print; dry-run arg printing).
//   Do NOT paraphrase, "clean up", or refactor them. The contract requires only their POSITION
//   to change. A diff review should show only line moves, no content edits.

// GOTCHA — leave a clean gap between the validate-prd early-return and runAuthPreflight().
//   P1.M1.T2.S2 will insert an explicit `configureHarness()` call into that gap. Do not add stray
//   code or comments that would make that insertion awkward.

// GOTCHA — do NOT extend void main().catch() for HarnessProviderMismatchError here. That is
//   P1.M1.T2.S2. This subtask touches ONLY main()'s body ordering + its JSDoc.

// GOTCHA — the root logger is function-scope (inside main()), NOT module top-level. Moving it
//   earlier within main() does NOT violate §9.6.2 REQ-L2 (the acceptance grep
//   `rg "^(export )?(const|let) \w+ = getLogger\(" src/` still returns 0 hits). Do not move it
//   to module scope.

// GOTCHA — prettier is enforced as ERROR. After editing, run `npm run fix` (lint:fix + format)
//   before format:check. Long moved blocks may need reformatting.

// GOTCHA — do NOT run the full `npm run test:run` as the S1 gate. The wider suite has 212
//   PRE-EXISTING failures unrelated to this delta (TEST_RESULTS.md §h3.1 note). S1's gate is
//   typecheck + lint + format + the targeted smoke checks in Level 3. S2 adds the real tests.
```

---

## Implementation Blueprint

### Data models and structure
None — pure statement reorder within a single function; no types, constants, or classes.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT src/index.ts — relocate the logger + verbose block UP
  - CUT the logger-creation block (src/index.ts:130–133) and the verbose block (:136–139)
        TOGETHER, and PASTE them immediately after `configureEnvironment();` (currently ~line 121).
  - KEEP verbose immediately after the logger (verbose depends on `logger`).
  - DO NOT change any token inside these blocks — only their position.
  - LEAVE the `await runAuthPreflight();` / `await ensureHarnessInitialized();` lines where they
        are for now (they move in Task 3).

Task 2: EDIT src/index.ts — relocate the dry-run + validate-prd blocks UP
  - CUT the `if (args.dryRun) { ...; return 0; }` block and the `if (args.validatePrd) { ...;
        return result.valid ? 0 : 1; }` block, and PASTE them immediately after the verbose block
        (i.e. now right after the logger, ahead of the preflight).
  - PRESERVE both bodies byte-for-byte (the full validate-prd report printing must remain intact).
  - ORDER: dry-run first, then validate-prd (matches today's order).

Task 3: EDIT src/index.ts — confirm preflight + harness init now sit after the early-returns
  - After Tasks 1–2, `await runAuthPreflight();` and `await ensureHarnessInitialized();` should
        naturally be positioned after the validate-prd early-return and before `parseScope` /
        `new PRPPipeline(...)`. If any other code was between them and the pipeline, leave it.
  - Do NOT modify these two calls themselves.

Task 4: EDIT src/index.ts — update the main() JSDoc @remarks (Mode A)
  - UPDATE the @remarks block on main() to document the new ordering. State that pure-local
        modes (--dry-run, --validate-prd) run credential-free BEFORE the §9.2.7 preflight and
        harness initialization, and cite bugfix PRD §h3.2. Keep concise (3–6 lines).
  - DO NOT create a separate docs file (P1.M1.T3 owns docs files; this rides with the code).

Task 5: FORMAT + VERIFY
  - RUN: `npm run fix` (lint:fix + prettier --write) then `npm run typecheck` then
        `npm run lint && npm run format:check`.
  - EXPECTED: all clean. A pure reorder cannot introduce type errors; if typecheck fails, a block
        was orphaned (e.g. verbose referencing logger defined elsewhere) — fix the placement.
```

### Implementation Patterns & Key Details

```ts
// PATTERN — the resulting main() head (skeleton; real block bodies preserved verbatim).
async function main(): Promise<number> {
  const parseResult = parseCLIArgs();            // unchanged
  if ('subcommand' in parseResult) return 0;     // unchanged
  const args: ValidatedCLIArgs = parseResult;    // unchanged
  setupGlobalHandlers(args.verbose);             // unchanged
  configureEnvironment();                         // unchanged

  // [UP] root logger — independent of creds/harness; function-scope (REQ-L2 safe). (PRD §h3.2)
  const logger: Logger = getLogger('App', {
    verbose: args.verbose,
    machineReadable: args.machineReadable,
  });
  if (args.verbose) {
    logger.debug('Verbose mode enabled');
    logger.debug('Parsed CLI arguments:', args);
  }

  // [UP — credential-free] local-only modes make zero API calls (bugfix PRD §h3.2).
  if (args.dryRun) {
    /* ... unchanged body ... */
    return 0;
  }
  if (args.validatePrd) {
    /* ... unchanged body, incl. PRDValidator + full report ... */
    return result.valid ? 0 : 1;
  }

  // [DOWN] only agent-invoking paths need credentials + an initialized harness (PRD §9.2.7).
  await runAuthPreflight();
  await ensureHarnessInitialized();

  // ... unchanged: parseScope, new PRPPipeline(...), pipeline.run(), result handling ...
}
```

### Integration Points

```yaml
DOWNSTREAM (this subtask ENABLES these — separate subtasks, do NOT do them here):
  - P1.M1.T1.S2 (subprocess acceptance tests): will assert --validate-prd & --dry-run succeed
        with NO credential. Depends on this reorder landing first.
  - P1.M1.T2.S2 (explicit configureHarness() in main()): will insert a configureHarness() call
        into the GAP between the validate-prd early-return and runAuthPreflight(). Keep that gap
        clean (no stray code) so the insertion is trivial.

NO OTHER INTEGRATION: this is a reorder within main() only. No new exports, no signature changes,
  no config/env changes. parseCLIArgs/runAuthPreflight/ensureHarnessInitialized/PRDValidator/
  getLogger are consumed unchanged.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run fix                  # lint:fix + prettier --write (run first to auto-format moved blocks)
npm run typecheck            # npx tsc --noEmit -p tsconfig.build.json — must be clean
npm run lint                 # eslint . --ext .ts — must be clean
npm run format:check         # prettier --check — must be clean
# Expected: all clean. typecheck failure ⇒ a block was orphaned (e.g. verbose referencing a logger
# defined in a different scope) — fix placement, not logic.
# Do NOT run the full `npm run test:run` here — 212 pre-existing unrelated failures (§h3.1 note).
```

### Level 2: Unit Tests (Component Validation)

```bash
# No unit test directly asserts main()'s internal ordering today. The existing auth-preflight test
# exercises runAuthPreflight() as a function, not main()'s sequencing:
npx vitest run tests/unit/config/auth-preflight.test.ts   # should still pass (preflight unchanged)
npx vitest run tests/unit/cli/index.test.ts               # CLI parsing unchanged — still passes
# Expected: both pass (this subtask changes only main()'s ordering, not these units).
# The real acceptance tests for the reorder land in S2 (subprocess: --validate-prd & --dry-run
# succeed with NO credential). S1's gate is the static checks + the Level 3 smoke test.
```

### Level 3: Integration Testing (System Validation)

```bash
# Build the CLI, then prove the two local-only modes now run credential-free.
npm run build

TMP=$(mktemp -d)
# --validate-prd with NO auth env vars and an EMPTY auth dir → must now exit 0 (was exit 1).
env -u ZAI_API_KEY -u PRP_API_KEY -u ANTHROPIC_API_KEY \
    -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_OAUTH_TOKEN \
    PI_CODING_AGENT_DIR="$TMP" \
    node dist/index.js --prd PRD.md --validate-prd
echo "validate-prd exit=$?   (expect 0)"

# --dry-run with NO auth env vars → must now exit 0 (was exit 1).
env -u ZAI_API_KEY -u PRP_API_KEY -u ANTHROPIC_API_KEY \
    -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_OAUTH_TOKEN \
    PI_CODING_AGENT_DIR="$TMP" \
    node dist/index.js --prd PRD.md --dry-run
echo "dry-run exit=$?   (expect 0)"

rm -rf "$TMP"

# Regression check: the no-credential agent path STILL aborts cleanly at the preflight.
TMP2=$(mktemp -d)
env -u ZAI_API_KEY -u PRP_API_KEY -u ANTHROPIC_API_KEY \
    -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_OAUTH_TOKEN \
    PI_CODING_AGENT_DIR="$TMP2" \
    node dist/index.js --prd PRD.md   # (no --dry-run / --validate-prd) → must exit 1 with the
echo "agent-path exit=$?   (expect 1)"   # single §9.2.7 message, no session dir created.
rm -rf "$TMP2"
# Expected: validate-prd=0, dry-run=0, agent-path=1. This proves the local modes are unblocked
# AND §9.2.7 is preserved for real agent paths.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# §9.6.3 regression check: --help timing must be unchanged (parseCLIArgs exits before main body).
time (env -u ZAI_API_KEY -u ANTHROPIC_API_KEY node dist/index.js --help >/dev/null)
# Expected: ~0.5–0.6 s (well under the 2 s bar). Unaffected because help exits in parseCLIArgs().

# REQ-L2 regression check: still NO module-top-level getLogger().
rg "^(export )?(const|let) \w+ = getLogger\(" src/
# Expected: 0 hits. (The root logger is still inside main(); only its position within main moved.)

# Doc/contract check (record in commit message):
#   - dry-run & validate-prd bodies are byte-for-byte identical to pre-reorder (diff = line moves only).
#   - runAuthPreflight/ensureHarnessInitialized/PRDValidator/parseCLIArgs are unmodified.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` clean.
- [ ] `npm run lint` clean.
- [ ] `npm run format:check` clean.
- [ ] `npx vitest run tests/unit/config/auth-preflight.test.ts` still passes (preflight unchanged).
- [ ] `npx vitest run tests/unit/cli/index.test.ts` still passes (CLI parsing unchanged).

### Feature Validation
- [ ] Root logger created immediately after `configureEnvironment()` (inside `main()`).
- [ ] `--dry-run` early-return runs BEFORE `runAuthPreflight()`.
- [ ] `--validate-prd` early-return runs BEFORE `runAuthPreflight()`.
- [ ] `runAuthPreflight()` + `ensureHarnessInitialized()` run only on the path to `new PRPPipeline(...)`.
- [ ] `node dist/index.js --prd PRD.md --validate-prd` exits 0 with NO auth env var (Level 3).
- [ ] `node dist/index.js --prd PRD.md --dry-run` exits 0 with NO auth env var (Level 3).
- [ ] `node dist/index.js --prd PRD.md` (agent path) still exits 1 with the §9.2.7 message, no cred.
- [ ] dry-run & validate-prd block bodies are byte-for-byte identical to today (diff = moves only).

### Code Quality Validation
- [ ] Only `src/index.ts` is modified — no other source, no test, no docs file.
- [ ] `runAuthPreflight`/`ensureHarnessInitialized`/`PRDValidator`/`parseCLIArgs` unmodified.
- [ ] Verbose block travels with the logger (kept adjacent).
- [ ] Gap between validate-prd early-return and `runAuthPreflight()` is clean (for P1.M1.T2.S2).
- [ ] `void main().catch()` NOT extended for `HarnessProviderMismatchError` (that's P1.M1.T2.S2).
- [ ] Root logger remains function-scope (inside `main()`), not module top-level (REQ-L2 preserved).

### Documentation & Deployment
- [ ] `main()` JSDoc `@remarks` documents the new ordering and cites PRD §h3.2 (Mode A).
- [ ] No separate docs file created (P1.M1.T3 owns docs files).
- [ ] Commit message notes: local modes now credential-free; §9.2.7 preserved for agent paths;
      logger move is REQ-L2-safe; --help timing unaffected.

---

## Anti-Patterns to Avoid

- ❌ Don't refactor or "clean up" the dry-run/validate-prd bodies — move them byte-for-byte.
- ❌ Don't leave the verbose block behind when moving the logger — it depends on `logger`.
- ❌ Don't move the root logger to module top-level — that would violate §9.6.2 REQ-L2 (and regress §9.6.3). Keep it inside `main()`.
- ❌ Don't modify `runAuthPreflight`/`ensureHarnessInitialized`/`PRDValidator`/`parseCLIArgs`.
- ❌ Don't extend `void main().catch()` for `HarnessProviderMismatchError` here — that's P1.M1.T2.S2.
- ❌ Don't add code/comments into the gap before `runAuthPreflight()` — P1.M1.T2.S2 inserts `configureHarness()` there.
- ❌ Don't run the full `npm run test:run` as the S1 gate — 212 pre-existing unrelated failures. Use typecheck + lint + format + the Level 3 smoke checks.
- ❌ Don't create a docs file for the ordering note — Mode A means the JSDoc @remarks is the doc (P1.M1.T3 owns docs files).
- ❌ Don't reorder the two early-returns relative to each other (keep dry-run before validate-prd, as today).

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: This is a pure statement reorder within a single function — no logic change, no new
types, no signature changes. The current order, the exact target order, the four blocks to
relocate (with verified current line numbers), the byte-for-byte-preservation requirement, and
the safe-to-move rationale (REQ-L2, `--help` timing, logger independence) are all documented with
file:line evidence. The executable validation is concrete: typecheck + lint + format + a
build-and-smoke proof that `--validate-prd`/`--dry-run` exit 0 with no credential while the agent
path still exits 1. The only residual risks are (a) accidentally leaving the verbose block
stranded from the logger (called out explicitly) and (b) a prettier reformatting nit on moved
blocks (auto-fixed via `npm run fix`). No external/runtime unknowns.
