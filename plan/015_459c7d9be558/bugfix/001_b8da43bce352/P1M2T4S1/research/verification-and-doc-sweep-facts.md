# Research Notes — P1.M2.T4.S1 Full-suite verification + doc-sweep (Bugfix 001)

The load-bearing facts for the verification + light-touch documentation sweep.
This is a **Mode B** (changeset-level doc-sync) + **verification** task — it ships
NO new feature, flag, env var, public API, or exported type. It RUNS the gates and
optionally makes a one-line doc correction (expected: none needed).

---

## 1. The changeset (what the 4 implementing siblings changed)

Two out-of-spec corrective bugfixes restoring EXISTING PRD-specified behavior
(§4.4, §4.5.1, §5.1). NO new behavior was introduced, so NO user-facing doc
*describes a new feature*. This is why the expected doc outcome is "no change."

| Sibling | File(s) | Change | Status |
| --- | --- | --- | --- |
| **P1.M1.T1.S1** (BUG-001) | `src/workflows/prp-pipeline.ts` `#runValidation()` ~1856-1874 | Removed the `if (this.#continueOnError && !watchdog)` fall-through + the now-dead `const watchdog` local + the contradicting comment; every `!outcome.success` now throws `ValidationFailedError` unconditionally (§4.4) | Complete |
| **P1.M2.T1.S1** (BUG-002 a) | `tests/unit/workflows/fix-cycle-workflow.test.ts` (6 tests) | Strengthened `createFixSubtask` fixtures' `context_scope` to a full `CONTRACT DEFINITION:` (4 ordered sections) so they pass `ContextScopeSchema` and stop triggering the §4.5.1 backlog-heal path | Complete |
| **P1.M2.T2.S1** (BUG-002 b) | `tests/unit/protected-files.test.ts` (~738) | Updated `gitAdd` assertion to the §5.1 pathspec shape `gitAdd({path})` (no `files` key) + mocked git plumbing so `smartCommit` completes | Complete |
| **P1.M2.T3.S1** (BUG-002 c) | `tests/integration/prp-executor-integration.test.ts` (line 497) | One string-literal: `'Failed to parse Coder Agent response'` → `'did not return a parseable JSON result envelope after 2 format nudge(s)'` (§4.5.1 terminal message) | Ready (parallel) |

**Net source diff across the whole changeset:** ONE `src/` file (`prp-pipeline.ts`,
BUG-001) — removing ~8 lines + the dead local. THREE test files (BUG-002). That is
ALL. `git diff --stat` after all siblings land should show exactly those 4 files.

## 2. The npm gates (package.json — verified)

- `npm run validate` = `npm run lint && npm run format:check && npm run typecheck && npm run test:run && npm run docs:check` — **the project's own CI gate that was RED** (9 failures) and must now be GREEN. This is the headline deliverable.
- `npm run test:run` = `vitest run` (headless; no watch).
- `npx vitest run` = the same (use either).
- `npm run typecheck` = `tsc --noEmit -p tsconfig.build.json`.
- `npm run lint` = `eslint . --ext .ts`.
- `npm run format:check` = `prettier --check "**/*.{ts,js,json,md,yml,yaml}"`.
- `npm run docs:check` = `tsx scripts/check-docs.ts` (markdown consistency: files, internal links, terminology, code blocks, dates). Part of `validate`.

## 3. The verification contract (the hard requirement)

- **`npx vitest run` → 0 failed.** Expected ~7328 passed | 71 skipped (the bug report
  baseline was 7319 passed / 9 failed / 71 skipped; the 8 stale tests now pass and
  the 1 BUG-001 test now passes → +9 pass. The exact pass count may SHIFT slightly
  if any sibling's edit changed a test count, but **0 failures is the hard gate**).
- **`npm run typecheck`** → 0 errors. Removing the `const watchdog` local + the
  if/else in BUG-001 must leave NO unused-variable/type error. If a now-unused
  import/local remains, that is a BUG-001 cleanup miss the verifier must fix
  (in-scope: "confirm the BUG-001 source change introduces no type/lint errors").
- **`npm run lint`** → 0 errors. Same rationale (eslint `.ts` only).
- **`npm run format:check`** → clean. Run `npm run fix` (prettier --write) if needed.
- **`npm run docs:check`** → clean (the doc-sync task must not break markdown consistency).
- **`npm run validate`** → exit 0 (all 5 sub-gates green). THIS unblocks the CI gate.

## 4. The 4 affected test files (where failures were — all must now pass)

1. `tests/unit/workflows/prp-pipeline-validation.test.ts` — the BUG-001 test
   `'should NOT swallow a validation abort under --continue-on-error'` (@337) was
   the headline failure. It must now PASS (result.success === false, result.error
   matches `/Validation failed/`, MockBugHunt NOT called). Related: `:363`
   `'should run validation in "validate" mode'` and `:377` `'should abort before
   bug-hunt when validation fails'` must stay green.
2. `tests/unit/workflows/fix-cycle-workflow.test.ts` — 6 tests (BUG-002 a).
3. `tests/unit/protected-files.test.ts` — 1 test, `'should filter all protected
   files in smart commit workflow'` (~738) (BUG-002 b).
4. `tests/integration/prp-executor-integration.test.ts` — 1 test, `'should handle
   invalid JSON from Coder Agent'` (line 497) (BUG-002 c).

## 5. The documentation sweep — `--continue-on-error` claims (the §4.4 drift check)

**§4.4 authority** (`spec/04-workflows.md:63`): "If validation does not finish
(non-zero exit), the run MUST abort _before_ cleanup, commit, and bug-hunt.
Proceeding on a half-validated build is forbidden. (A watchdog-killed validation
is a hard failure, never retried.)" The ONLY special-case §4.4 names is watchdog
kills. There is **no** `--continue-on-error` exception.

**Every `--continue-on-error` mention in README.md + docs/*.md** (full grep) and
whether it SPECIFICALLY claims validation is exempt:

| Location | Text | Claims validation-exempt? |
| --- | --- | --- |
| `docs/CLI_REFERENCE.md:350` (flag table) | "Treat all errors as non-fatal and continue pipeline execution" | NO — generic flag-table summary; not validation-specific |
| `docs/CLI_REFERENCE.md:367` (Flag Details) | "Treats all errors as non-fatal. The pipeline continues execution even when **individual tasks fail**. Useful for gathering maximum feedback." | NO — **correctly scoped** to "individual tasks fail" (the legitimate task-level behavior). This is ACCURATE post-fix. |
| `docs/CONFIGURATION.md:408` (flag table) | "Treat all errors as non-fatal and continue pipeline execution" | NO — generic flag-table summary (same as CLI_REFERENCE:350) |
| `docs/WORKFLOWS.md:1432-1441` (Continue-on-Error Mode) | "With `--continue-on-error`: Task failures tracked but don't abort pipeline; Error report generated at end; Useful for gathering maximum feedback" | NO — **correctly scoped** to "Task failures" |
| `docs/WORKFLOWS.md:372` | An empty backlog "aborts even under `--continue-on-error`" (bypasses `isFatalError`) | NO — this documents an UNCONDITIONAL abort; **consistent with** §4.4 |
| `docs/CUSTOM_WORKFLOWS.md:430` | "**Individual task failures** (with `--continue-on-error`)" | NO — correctly scoped to individual tasks |
| `docs/CUSTOM_WORKFLOWS.md:443,464,831,1531-1533` | `isFatalError(error, this.#continueOnError)` code samples / `#continueOnError` field | NO — task-level error-handling code samples (legitimate) |

**Conclusion: NO doc SPECIFICALLY claims `--continue-on-error` proceeds past a
FAILED VALIDATION.** The two borderline items are the generic flag-table entries
("Treat all errors as non-fatal and continue pipeline execution" at CLI_REFERENCE:350
and CONFIGURATION:408) — but they are GENERIC summaries, not validation-specific
claims, and the detailed descriptions (CLI_REFERENCE:367 "individual tasks fail";
WORKFLOWS.md:1438 "Task failures") correctly scope the flag to task-level use.

**Per the work item's explicit instruction** ("if none exists, make no change" +
"Do NOT add documentation for a non-existent feature"), the expected outcome is
**NO documentation change.** The verifier CONFIRMS this explicitly (do not assume)
and records the sweep table above as the evidence. The generic flag-table text is
left as-is (it is a summary, not a validation-specific claim, and amending it would
risk over-specifying a non-existent feature surface).

**If, however, a fresh grep finds a SPECIFIC claim** (e.g. a sentence like
"`--continue-on-error` lets the pipeline proceed even when validation fails" or
"validation failures are non-fatal under `--continue-on-error`"), the verifier
makes a ONE-LINE correction to reflect §4.4's unconditional abort — and ONLY that.
Do not rewrite sections; do not add new docs.

## 6. Decision tree — what to do if `npx vitest run` is NOT 0 failed

1. **Identify the failing file(s).** `npx vitest run` lists them.
2. **If a failure is in one of the 4 known files** (§4 above): the corresponding
   sibling's fix did not fully land or has a residual edge. The verifier may apply
   a TRIVIAL corrective fix (e.g. a fixture/staging/error-text drift of the same
   kind) under the project's Rule 5 (out-of-spec corrective work), OR report it.
   Re-run the targeted file after the fix.
3. **If a failure is in a DIFFERENT file** (a NEW failure not in the bug report):
   this is a potential regression from the changeset. Diagnose: is it caused by the
   BUG-001 source change (prp-pipeline.ts) — e.g. the unconditional throw now trips
   a test that relied on the swallow? If so, that test encoded the BUGGY behavior
   and must be updated to §4.4 (Rule 5 corrective). If it is unrelated, report it
   rather than masking it.
4. **Do NOT broaden scope.** This task verifies + sweeps docs. It does not
   implement new features or re-architect. Every fix is a minimal out-of-spec
   correction to restore green/§4.4-compliance.

## 7. `docs:check` behavior (`scripts/check-docs.ts`)

- Runs markdown consistency checks: `checkMarkdownFiles`, `checkInternalLinks`,
  `checkTerminology`, `checkCodeBlocks`, `checkDates`.
- Skips `node_modules`, `docs/api` (generated), `docs/research`.
- If the doc sweep makes NO change (expected), `docs:check` is unaffected. If a
  one-line correction is made, re-run `npm run docs:check` to confirm no broken
  link/terminology/date was introduced.

## 8. Hard boundaries / out of scope

- **No `src/` feature work.** The ONLY sanctioned `src/` touch is a minimal
  BUG-001 cleanup fix IF typecheck/lint reveals a leftover unused local/import
  (the sibling's responsibility, but verifying it is clean is in-scope here).
- **No new flags / env vars / public API / exported types** (none were introduced
  by the changeset — confirm via `git diff --stat`).
- **No new documentation for a non-existent feature.** The expected doc outcome is
  NO change. A one-line §4.4 correction is permitted ONLY if a SPECIFIC
  validation-exempt claim is found.
- **Do NOT touch** `PRD.md`, `tasks.json`, `prd_snapshot.md`, `.gitignore`, the
  spec/ files, or any implementing sibling's already-landed test fix.