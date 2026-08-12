# PRP — P1.M2.T4.S1: Verify full suite green (0 failed) + sweep README/overview docs for drift (Bugfix 001)

---

## Goal

**Feature Goal**: Confirm the two-bug changeset (BUG-001 validation-abort integrity
+ BUG-002 stale-test restoration) produces a **green `npm run validate` CI gate**
(0 test failures, 0 type/lint/format/docs errors), AND sweep `README.md` + `docs/`
for any claim that `--continue-on-error` permits proceeding past a **FAILED
VALIDATION** — correcting any such claim to reflect PRD §4.4's unconditional abort,
or (expected) making **no change** because BUG-001 was an undocumented carve-out.
This is a **Mode B verification + light-touch doc-sync task**: it ships NO new
feature, flag, env var, public API, or exported type. It RUNS the gates and confirms
the doc surface.

**Deliverable**: A green `npx vitest run` (0 failed) + a green `npm run validate`
(lint + format:check + typecheck + test:run + docs:check), PLUS an explicit
confirmation that README/docs require no changeset-level update (or, only if a
SPECIFIC stale `--continue-on-error`-vs-validation claim is found, a one-line §4.4
correction). This unblocks the project's own `npm run validate` CI gate that was RED.

**Success Definition**:
- `npx vitest run` → **0 failed** (expected ~7328 passed | 71 skipped; exact pass
  count may shift — 0 failures is the hard requirement).
- `npm run typecheck` → 0 errors (the BUG-001 `src/` change — removing the
  `const watchdog` local + if/else — introduces no type error / unused local).
- `npm run lint` → 0 errors (same rationale).
- `npm run format:check` → clean.
- `npm run docs:check` → clean.
- `npm run validate` → **exit 0** (all 5 sub-gates green).
- `git diff --stat` shows ONLY the changeset's expected files (1 `src/` + 3 tests,
  plus optionally 1 doc line) — confirms no scope creep.
- Doc sweep: explicit confirmation that no `--continue-on-error` claim contradicts
  §4.4 (evidence: the sweep table in `research/verification-and-doc-sweep-facts.md`).

---

## User Persona (if applicable)

**Target User**: **Maintainer / CI** — the project's own `npm run validate` gate was
RED (9 failures) and must be restored to green so CI passes and real regressions are
no longer hidden by the permanently-red suite.

**Use Case**: After a bugfix changeset lands, run the full gate to prove the fixes
hold and no regression was introduced, and confirm user-facing docs still match the
(now-§4.4-compliant) behavior.

**User Journey**: `npm run validate` → all green → CI passes → maintainer trusts the
suite to catch future regressions; docs verified consistent with §4.4.

**Pain Points Addressed**: A red suite hides real regressions; a stale doc could
mislead an operator into thinking `--continue-on-error` exempts validation.

---

## Why

- **BUG-001 (§4.4)** and **BUG-002 (§4.5.1/§5.1)** were out-of-spec corrective
  bugfixes restoring EXISTING PRD-specified behavior — they introduced NO new
  behavior, so there is no new feature to document. The verification confirms the
  four implementing siblings' fixes collectively close all 9 failures.
- **The project's own `validate` script is the CI gate.** With 9 failures it could
  never pass; restoring green is the prerequisite for the gate to have any value.
- **Mode B doc-sync is part of the changeset.** Per the work item, this IS the
  changeset-level documentation task — it sweeps README.md + overview docs that span
  the whole changeset. The EXPECTED outcome is "no change needed" (pure corrective
  bugfix), but the implementing agent CONFIRMS this explicitly rather than assuming.
- **Out of scope (hard boundary):** implementing new features/flags/env vars/public
  API; re-doing a sibling's already-landed test fix; editing `PRD.md`/`spec/`/
  `tasks.json`/`prd_snapshot.md`/`.gitignore`; adding documentation for a
  non-existent feature.

---

## What

### User-visible behavior

None (verification + optional one-line doc correction). Observable change: the
`npm run validate` CI gate flips RED → GREEN.

### Technical requirements (the verification runbook)

1. **Run the full suite:** `npx vitest run` → confirm `0 failed`. Record the pass
   count (expect ~7328 passed | 71 skipped). If ANY failure remains, apply the
   decision tree in Implementation Patterns (do not silently mask).
2. **Confirm the BUG-001 `src/` change is clean:** `npm run typecheck` → 0 errors;
   `npm run lint` → 0 errors. The change removed the `const watchdog` local + the
   `if (this.#continueOnError && !watchdog)` fall-through in
   `src/workflows/prp-pipeline.ts` `#runValidation()`; verify no now-unused
   import/local remains (eslint `no-unused-vars` / tsc must be clean). If a leftover
   exists, apply a minimal cleanup fix (in-scope: "confirm the BUG-001 source change
   introduces no type/lint errors").
3. **Formatting:** `npm run format:check` → clean. If not, run `npm run fix` then
   re-check.
4. **Docs consistency:** `npm run docs:check` → clean.
5. **The headline gate:** `npm run validate` → **exit 0**.
6. **Scope check:** `git diff --stat` shows ONLY the changeset's expected files
   (`src/workflows/prp-pipeline.ts` + the 3 test files + optionally 1 doc line).
   No surprise files.
7. **Doc sweep (Mode B):** `grep -rni 'continue-on-error' README.md docs/*.md`,
   then for each hit decide whether it SPECIFICALLY claims `--continue-on-error`
   proceeds past a FAILED VALIDATION (contradicting §4.4). See the sweep table +
   decision rules in Implementation Patterns.

### Success Criteria

- [ ] `npx vitest run` → 0 failed.
- [ ] `npm run typecheck` → 0 errors; `npm run lint` → 0 errors.
- [ ] `npm run format:check` → clean; `npm run docs:check` → clean.
- [ ] `npm run validate` → exit 0.
- [ ] `git diff --stat` shows only the expected changeset files (no scope creep).
- [ ] Doc sweep: explicit confirmation no `--continue-on-error` claim contradicts
      §4.4 (or exactly one minimal §4.4 correction if a specific claim is found).
- [ ] No new feature/flag/env var/API/type introduced (confirm via diff).

---

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed?_
**Yes** — the exact npm gate commands (verified in package.json), the exact expected
suite outcome (0 failed; ~7328 passed | 71 skipped baseline), the exact 4 affected
test files + 1 `src/` file the changeset touched, the exact §4.4 authority quote,
the COMPLETE `--continue-on-error` doc-sweep table (every mention in README + docs
with a per-claim §4.4 verdict), the decision tree for a remaining failure, the
`docs:check` behavior, and the hard boundaries. The non-obvious facts (the
expected doc outcome is NO change; the generic flag-table text is NOT a
validation-specific claim; `--continue-on-error` is legitimately used at ~10
task-level sites) are all in
`research/verification-and-doc-sweep-facts.md`.

### Documentation & References

```yaml
# MUST READ — the bug report (the two-bug changeset contract)
- docfile: (BUG-001 + BUG-002 in selected_prd_content)
  why: >
    BUG-001 = §4.4 validation abort swallowed under --continue-on-error (Major); fix =
    remove the carve-out in #runValidation(). BUG-002 = 8 stale tests across 3 files
    (fix-cycle-workflow ×6, protected-files ×1, prp-executor-integration ×1); fixes =
    test-only. The 9 failures are what made `npm run validate` RED. This task verifies
    they are all resolved and the gate is GREEN.
  critical: The changeset is TWO out-of-spec corrective bugfixes — NO new feature/flag/
            env/API/type was introduced. Expected doc outcome = NO change.

# MUST READ — architecture pins (current-vs-fixed + do-not-touch boundaries)
- docfile: plan/015_459c7d9be558/bugfix/001_b8da43bce352/architecture/bug001_validation_abort.md
  why: >
    Prescribes the EXACT BUG-001 fix (remove the `if (this.#continueOnError && !watchdog)`
    fall-through + the dead `const watchdog` local + the contradicting comment) and the
    test that validates it (`prp-pipeline-validation.test.ts:337`). "Do NOT add a new flag
    to re-introduce an escape hatch — the PRD has no --continue-on-error exception for §4.4."
  critical: §4.4 authority: validation MUST abort before bug-hunt/commit; the ONLY special-case
            is watchdog kills. There is NO --continue-on-error exception.

- docfile: plan/015_459c7d9be558/bugfix/001_b8da43bce352/architecture/bug002_stale_tests.md
  why: >
    Prescribes the 3 test-file fixes (a/b/c). Confirms all 8 are NOT product defects — the
    implementation behaves per the PRD; only the tests drifted. This is WHY the verification's
    job is "confirm green", not "re-investigate behavior".

- docfile: plan/015_459c7d9be558/bugfix/001_b8da43bce352/architecture/system_context.md
  why: >
    The relevant source architecture: #runValidation() @2935 is OUTSIDE runQACycle()'s catch
    so a thrown ValidationFailedError propagates into run()'s catch → {success:false}. The
    Format-Nudge path (§4.5.1) terminal message + BacklogSchema/ContextScopeSchema heal path +
    Smart Commit pathspec staging (§5.1) — all the behaviors the stale tests now correctly assert.

# MUST READ — this task's research (THE doc-sweep table + verification facts)
- docfile: plan/015_459c7d9be558/bugfix/001_b8da43bce352/P1M2T4S1/research/verification-and-doc-sweep-facts.md
  section: "1 (the 4-sibling changeset table)", "2 (npm gates)", "3 (verification contract)",
           "4 (the 4 affected test files)", "5 (FULL --continue-on-error doc-sweep table + verdicts)",
           "6 (decision tree for a remaining failure)", "7 (docs:check behavior)", "8 (boundaries)"
  why: >
    Proves NO doc SPECIFICALLY claims --continue-on-error proceeds past validation (the expected
    no-change outcome). The generic flag-table text ("Treat all errors as non-fatal…") is NOT a
    validation-specific claim and the detailed descriptions correctly scope to "individual tasks".
    Gives the exact decision tree if a failure remains.

# PARALLEL-SIBLING CONTRACTS (assume implemented as-specified — this task verifies them)
- docfile: plan/015_459c7d9be558/bugfix/001_b8da43bce352/P1M1T1S1/PRP.md   # BUG-001 src fix — Complete
  why: >
    Defines the #runValidation() change this task verifies is clean (typecheck/lint). The test
    `prp-pipeline-validation.test.ts:337` must now PASS.
- docfile: plan/015_459c7d9be558/bugfix/001_b8da43bce352/P1M2T1S1/PRP.md   # fix-cycle fixtures — Complete
- docfile: plan/015_459c7d9be558/bugfix/001_b8da43bce352/P1M2T2S1/PRP.md   # protected-files staging — Complete
- docfile: plan/015_459c7d9be558/bugfix/001_b8da43bce352/P1M2T3S1/PRP.md   # prp-executor error text — Ready (parallel)
  why: >
    The 3 BUG-002 test fixes. This task verifies all 3 files now pass + the full suite is green.
    Treat all as landed; if a sibling's fix did NOT fully land, apply the decision tree (research §6).

# THE SOURCE this task verifies is clean (read-only unless a leftover cleanup is needed)
- file: src/workflows/prp-pipeline.ts
  why: >
    #runValidation() — after BUG-001, the `if (!outcome.success) { throw new ValidationFailedError(outcome); }`
    block must have NO leftover `const watchdog` local, NO `--continue-on-error` fall-through, NO
    contradicting comment. typecheck/lint must be clean. If a now-unused local/import remains, it is a
    BUG-001 cleanup miss → minimal fix in-scope.
  pattern: "if (!outcome.success) { throw new ValidationFailedError(outcome); }   // §4.4 unconditional"
  gotcha: ValidationFailedError's constructor already classifies watchdog vs non-watchdog internally
          (validation-workflow.ts:104), so the local `watchdog` computation is redundant after the fix.

# THE DOCS to sweep (Mode B)
- file: README.md
  why: >
    Project overview. Sweep for any --continue-on-error-vs-validation claim. (Verified: README has NO
    --continue-on-error text — only --continue references at lines 324/387/411.) Expected: no change.
- file: docs/CLI_REFERENCE.md
  why: >
    Flag table @350 ("Treat all errors as non-fatal and continue pipeline execution" — GENERIC) +
    Flag Details @367 ("continues execution even when individual tasks fail" — correctly scoped). Sweep
    both. Expected: no change (generic table + correctly-scoped detail).
- file: docs/CONFIGURATION.md
  why: >
    Flag table @408 (same generic text as CLI_REFERENCE:350). Expected: no change.
- file: docs/WORKFLOWS.md
  why: >
    "Continue-on-Error Mode" @1432-1441 (correctly scoped to "Task failures") + @372 (documents an
    UNCONDITIONAL abort under --continue-on-error — consistent with §4.4). Expected: no change.
- file: docs/CUSTOM_WORKFLOWS.md
  why: >
    @430 ("Individual task failures") + code samples @443/464/831/1531 (task-level isFatalError use).
    Correctly scoped. Expected: no change.

# THE DOCS GATE
- file: scripts/check-docs.ts
  why: >
    `npm run docs:check` runs this — markdown consistency (files, internal links, terminology, code blocks,
    dates). Skips node_modules/docs/api/docs/research. If the sweep makes NO change, docs:check is
    unaffected; if a one-line correction is made, re-run to confirm no broken link/terminology.
```

### Current Codebase tree (relevant slice)

```bash
src/workflows/prp-pipeline.ts                                   # VERIFY clean (BUG-001 change); minimal cleanup ONLY if a leftover local/import remains
tests/unit/workflows/prp-pipeline-validation.test.ts            # VERIFY :337 now PASSES (BUG-001 test)
tests/unit/workflows/fix-cycle-workflow.test.ts                 # VERIFY 6 tests now PASS (BUG-002 a)
tests/unit/protected-files.test.ts                              # VERIFY ~738 now PASSES (BUG-002 b)
tests/integration/prp-executor-integration.test.ts              # VERIFY line-497 test now PASSES (BUG-002 c)
README.md + docs/*.md                                           # SWEEP for --continue-on-error-vs-validation drift (expected: none)
package.json                                                    # READ-ONLY — npm scripts (validate/lint/typecheck/test:run/format:check/docs:check)
scripts/check-docs.ts                                           # READ-ONLY — docs:check behavior
plan/015_.../bugfix/001_.../architecture/{bug001,bug002,system_context}.md  # the fixes' contracts
plan/015_.../bugfix/001_.../P1M2T4S1/research/verification-and-doc-sweep-facts.md  # THIS ITEM'S RESEARCH
```

### Desired Codebase tree with files to be added

```bash
# Expected: NO new files. Net diff across the whole changeset (all siblings) =
#   src/workflows/prp-pipeline.ts        (BUG-001 — sibling P1.M1.T1.S1)
#   tests/unit/workflows/fix-cycle-workflow.test.ts      (BUG-002 a — P1.M2.T1.S1)
#   tests/unit/protected-files.test.ts                   (BUG-002 b — P1.M2.T2.S1)
#   tests/integration/prp-executor-integration.test.ts   (BUG-002 c — P1.M2.T3.S1)
#   [OPTIONAL] one line in docs/*.md      (ONLY if a SPECIFIC validation-exempt claim is found)
# This task ideally adds ZERO files / ZERO line changes (verification + confirmation only).
```

### Known Gotchas of our codebase & Library Quirks

```bash
# CRITICAL — the expected doc outcome is NO CHANGE. BUG-001 was an UNDOCUMENTED carve-out (the bug
#   report itself says so). There was never a doc claiming --continue-on-error exempts validation.
#   Do NOT add documentation for a non-existent feature. Confirm the sweep explicitly; do not assume.
#   (research §5.)

# CRITICAL — the generic flag-table text "Treat all errors as non-fatal and continue pipeline
#   execution" (CLI_REFERENCE:350, CONFIGURATION:408) is NOT a validation-specific claim. It is a
#   generic summary, and the detailed descriptions (CLI_REFERENCE:367 "individual tasks fail";
#   WORKFLOWS.md:1438 "Task failures") correctly scope the flag to task-level use. Leave as-is.
#   Amending it would over-specify a non-existent feature surface. (research §5.)

# CRITICAL — `--continue-on-error` is used LEGITIMATELY at ~10 task-level sites in prp-pipeline.ts
#   (lines 671, 783, 843, 1250, 1451, 1714, 1793, 2172, 2250, 2588). Only the (now-removed) line-1868
#   carve-out incorrectly gated a STAGE-level abort. Do NOT "fix" the task-level uses — they are correct.
#   (system_context.md; research §1.)

# CRITICAL — the hard requirement is 0 FAILURES, not an exact pass count. The bug-report baseline was
#   7319 passed / 9 failed / 71 skipped; after the 9 fixes expect ~7328 passed | 71 skipped, but the
#   count may shift slightly if a sibling's edit changed a test count. Gate on "0 failed".

# GOTCHA — `npm run validate` runs ALL of: lint && format:check && typecheck && test:run && docs:check.
#   A green `npx vitest run` alone is NOT sufficient — the CI gate also requires lint/typecheck/format/
#   docs:check. Run the full `npm run validate` as the headline deliverable.

# GOTCHA — if typecheck/lint flags a now-unused local/import in prp-pipeline.ts after the BUG-001 edit,
#   that is a cleanup miss by P1.M1.T1.S1. A minimal removal of the dead symbol is IN-SCOPE here
#   ("confirm the BUG-001 source change introduces no type/lint errors"). Do not re-architect.

# GOTCHA — if `npx vitest run` shows a failure NOT in the 4 known files, it may be a regression from
#   the BUG-001 change (e.g. a test that encoded the swallow behavior). Apply the decision tree
#   (research §6): diagnose → minimal corrective fix under Rule 5, or report. Do not mask.

# GOTCHA — `npm run fix` runs lint:fix + prettier --write. If format:check fails, run `npm run fix`
#   then re-check. Do NOT commit formatting noise unrelated to the changeset.

# GOTCHA — Mode B doc-sync spans README.md + overview docs. Do NOT edit spec/ (PRD authority) or
#   PRD.md. The sweep is grep-driven; record the evidence table, do not rewrite sections.
```

---

## Implementation Blueprint

### Data models and structure

None. This is a verification + optional one-line doc correction. No types, no
models, no new symbols.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: RUN the full test suite (the headline check)
  - RUN: npx vitest run
  - EXPECT: "Test Files … 0 failed" + "Tests … 0 failed | ~7328 passed | 71 skipped".
  - IF 0 failed → proceed to Task 2.
  - IF failures remain → apply the decision tree (Task 6) BEFORE proceeding. Do not mask.

Task 2: CONFIRM the BUG-001 src/ change is clean (typecheck + lint)
  - RUN: npm run typecheck   → 0 errors.
  - RUN: npm run lint        → 0 errors.
  - INSPECT: src/workflows/prp-pipeline.ts #runValidation() — confirm the
    `if (!outcome.success) { throw new ValidationFailedError(outcome); }` block has NO leftover
    `const watchdog` local, NO `--continue-on-error` fall-through, NO contradicting comment.
  - IF a now-unused local/import remains (cleanup miss by P1.M1.T1.S1) → remove it (minimal,
    in-scope) → re-run typecheck + lint.
  - DO NOT: re-architect, add a flag, or touch the legitimate task-level --continue-on-error sites.

Task 3: CONFIRM formatting + docs consistency
  - RUN: npm run format:check   → clean. (If not: npm run fix, then re-check.)
  - RUN: npm run docs:check     → clean.

Task 4: RUN the headline CI gate
  - RUN: npm run validate   → EXPECT exit 0 (lint && format:check && typecheck && test:run && docs:check).
  - IF non-zero → identify which sub-gate failed from the output → fix at its task above → re-run.

Task 5: SWEEP README.md + docs/ for --continue-on-error-vs-validation drift (Mode B)
  - RUN: grep -rni 'continue-on-error' README.md docs/*.md
  - FOR EACH hit, decide: does it SPECIFICALLY claim --continue-on-error proceeds past a FAILED
    VALIDATION (contradicting §4.4)?
      • Expected answer: NO (see the sweep table in research §5). → make NO change; record evidence.
      • If a SPECIFIC claim IS found (e.g. "validation failures are non-fatal under
        --continue-on-error") → make a ONE-LINE correction reflecting §4.4's unconditional abort.
        Then re-run `npm run docs:check` (no broken link/terminology introduced).
  - DO NOT: add new documentation for a non-existent feature; amend the generic flag-table text;
    rewrite sections; edit spec/ or PRD.md.

Task 6 (CONDITIONAL — only if Task 1 showed failures): DECISION TREE
  - IDENTIFY the failing file(s) from `npx vitest run` output.
  - IF in one of the 4 known files (prp-pipeline-validation / fix-cycle-workflow / protected-files /
    prp-executor-integration): a sibling's fix did not fully land OR has a residual edge. Apply a
    TRIVIAL corrective fix of the SAME KIND (fixture/staging/error-text drift) under Rule 5, OR report.
    Re-run the targeted file.
  - IF in a DIFFERENT file (NEW failure): potential regression from the changeset. Diagnose whether
    the BUG-001 unconditional throw trips a test that encoded the swallow behavior; if so, update that
    test to §4.4 (Rule 5 corrective). If unrelated, REPORT (do not mask).
  - DO NOT: broaden scope; implement new features; mask a failure to force green.

Task 7: SCOPE check
  - RUN: git diff --stat   → confirm ONLY the changeset's expected files (prp-pipeline.ts + 3 tests,
    optionally 1 doc line). No surprise files = no scope creep.

Task 8: RECORD the outcome
  - Summarize: pass/fail counts, each gate's status, the doc-sweep verdict (no change / one-line
    correction with file:line), and the git diff --stat. This is the verification evidence.
```

### Implementation Patterns & Key Details

```bash
# ---- the verification runbook (run in order) ----
npx vitest run                              # 1. headline: 0 failed (expect ~7328 passed | 71 skipped)
npm run typecheck                           # 2. BUG-001 src change is clean (no unused local/import)
npm run lint                                # 2b. eslint .ts clean
npm run format:check                        # 3. prettier clean (npm run fix if not)
npm run docs:check                          # 3b. scripts/check-docs.ts clean
npm run validate                            # 4. THE CI gate: all 5 sub-gates → exit 0

# ---- the doc sweep (Mode B) ----
grep -rni 'continue-on-error' README.md docs/*.md
# For each hit, cross-check against the verdict table in research §5:
#   - CLI_REFERENCE:350 / CONFIGURATION:408 (flag table, generic)        → NOT validation-specific → no change
#   - CLI_REFERENCE:367 ("individual tasks fail")                         → correctly scoped          → no change
#   - WORKFLOWS.md:1432-1441 ("Task failures")                           → correctly scoped          → no change
#   - WORKFLOWS.md:372 (unconditional abort under the flag)              → consistent with §4.4      → no change
#   - CUSTOM_WORKFLOWS.md:430 ("Individual task failures") + code        → correctly scoped          → no change
# EXPECTED OUTCOME: NO doc change. Record the table as evidence.
# If (unexpectedly) a SPECIFIC validation-exempt claim appears, ONE-LINE fix only, then:
npm run docs:check                          # confirm no broken link/terminology/date introduced

# ---- the scope check ----
git diff --stat                             # ONLY: prp-pipeline.ts + 3 test files (+ optional 1 doc line)
```

```bash
# ---- decision tree (Task 6 — only if npx vitest run shows failures) ----
# Step 1: identify failing files from the vitest summary.
# Step 2a (known file): the matching sibling's fix didn't fully land or has a residual edge.
#         A trivial corrective fix of the SAME KIND (ContextScope fixture / pathspec gitAdd /
#         format-nudge error text) is permitted under Rule 5. Re-run the targeted file:
#           npx vitest run tests/unit/workflows/fix-cycle-workflow.test.ts
#           npx vitest run tests/unit/protected-files.test.ts
#           npx vitest run tests/integration/prp-executor-integration.test.ts
#           npx vitest run tests/unit/workflows/prp-pipeline-validation.test.ts
# Step 2b (NEW/unknown file): likely a regression from BUG-001's unconditional throw tripping a
#         test that encoded the swallow behavior. Diagnose; if confirmed, update that test to §4.4
#         (Rule 5 corrective). If unrelated to the changeset, REPORT rather than mask.
# Step 3: re-run `npx vitest run` to confirm 0 failed before proceeding to Task 2.
```

### Integration Points

```yaml
CI GATE (the headline deliverable):
  - npm run validate  →  exit 0   (was RED with 9 failures; now GREEN)
  - Composed of: lint && format:check && typecheck && test:run && docs:check — ALL must pass.

TEST FILES (verified green — owned by siblings, confirmed by this task):
  - tests/unit/workflows/prp-pipeline-validation.test.ts   (:337 BUG-001 test now PASSES)
  - tests/unit/workflows/fix-cycle-workflow.test.ts         (6 tests now PASS — §4.5.1 fixtures)
  - tests/unit/protected-files.test.ts                      (~738 now PASSES — §5.1 pathspec)
  - tests/integration/prp-executor-integration.test.ts      (line-497 test now PASSES — §4.5.1 text)

SOURCE (verified clean — owned by P1.M1.T1.S1, confirmed by this task):
  - src/workflows/prp-pipeline.ts  #runValidation()  → unconditional ValidationFailedError; no leftover local

DOCS (swept — Mode B):
  - README.md + docs/CLI_REFERENCE.md + docs/CONFIGURATION.md + docs/WORKFLOWS.md + docs/CUSTOM_WORKFLOWS.md
  - Expected: NO change. (Optional ONE-LINE §4.4 correction only if a specific validation-exempt claim is found.)

NO CHANGES TO (hard boundary):
  - PRD.md, spec/, tasks.json, prd_snapshot.md, .gitignore
  - any sibling's already-landed fix (only a minimal corrective patch if a sibling left a residual)
  - new features / flags / env vars / public API / exported types (none introduced — confirm via diff)
```

---

## Validation Loop

### Level 1: Syntax & Style (the BUG-001 src cleanliness check)

```bash
npm run typecheck      # tsc --noEmit -p tsconfig.build.json → 0 errors
npm run lint           # eslint . --ext .ts → 0 errors
npm run format:check   # prettier --check → clean (npm run fix if not)
# Expected: all clean. The BUG-001 edit removed code (the watchdog local + if/else), so the only
# possible issue is a now-unused import/local — remove it (minimal) if flagged.
```

### Level 2: The Test Suite (the headline gate)

```bash
npx vitest run
# Expected: "Test Files … 0 failed" + "Tests … 0 failed | ~7328 passed | 71 skipped".
# Hard requirement: 0 failed. If failures remain → decision tree (Implementation Patterns Task 6).

# Targeted re-check of the 4 formerly-failing files (fast confidence):
npx vitest run tests/unit/workflows/prp-pipeline-validation.test.ts -t 'should NOT swallow a validation abort under --continue-on-error'   # PASS
npx vitest run tests/unit/workflows/fix-cycle-workflow.test.ts        # 6 PASS
npx vitest run tests/unit/protected-files.test.ts -t 'should filter all protected files in smart commit workflow'                          # PASS
npx vitest run tests/integration/prp-executor-integration.test.ts -t 'should handle invalid JSON from Coder Agent'                         # PASS
```

### Level 3: The Full CI Gate (the deliverable)

```bash
npm run validate       # = lint && format:check && typecheck && test:run && docs:check → exit 0
# Expected: exit 0. This is the project's own CI gate that was RED; restoring it is the deliverable.
# If non-zero: the output names the failing sub-gate → fix at its task above → re-run.
```

### Level 4: Documentation Sweep (Mode B)

```bash
grep -rni 'continue-on-error' README.md docs/*.md     # enumerate every mention
# Cross-check each hit against the verdict table in research §5. Expected: NONE specifically claims
# validation is exempt under --continue-on-error → make NO change.
# IF a specific claim is found → ONE-LINE §4.4 correction → then:
npm run docs:check     # confirm no broken link/terminology/date
# Expected (primary path): NO doc change; docs:check unaffected (it was already part of Task 3).
```

---

## Final Validation Checklist

### Technical Validation

- [ ] `npx vitest run` → 0 failed (~7328 passed | 71 skipped).
- [ ] `npm run typecheck` → 0 errors (BUG-001 src change clean; no unused local/import).
- [ ] `npm run lint` → 0 errors.
- [ ] `npm run format:check` → clean.
- [ ] `npm run docs:check` → clean.
- [ ] `npm run validate` → **exit 0** (the CI gate restored to GREEN).

### Feature Validation (the changeset's intent)

- [ ] `prp-pipeline-validation.test.ts:337` ('should NOT swallow a validation abort…') PASSES.
- [ ] `fix-cycle-workflow.test.ts` (6 tests) PASS (§4.5.1 fixtures).
- [ ] `protected-files.test.ts` (~738) PASSES (§5.1 pathspec staging).
- [ ] `prp-executor-integration.test.ts` (line-497) PASSES (§4.5.1 format-nudge text).
- [ ] No new failure introduced outside the 4 known files (no regression from BUG-001).

### Code Quality Validation

- [ ] `git diff --stat` shows ONLY the changeset's expected files (1 src/ + 3 tests, optionally 1 doc line).
- [ ] No new feature/flag/env var/public API/exported type introduced (diff confirms).
- [ ] Any corrective patch (Task 6) is minimal + same-kind (not a scope expansion).

### Documentation & Deployment (Mode B)

- [ ] Doc sweep completed; evidence table recorded (every `--continue-on-error` mention + verdict).
- [ ] NO doc change made (expected) — OR exactly ONE minimal §4.4 correction if a specific claim was found.
- [ ] No new documentation added for a non-existent feature.
- [ ] `npm run docs:check` clean after any doc touch.
- [ ] Verification summary recorded: pass/fail counts, each gate's status, doc-sweep verdict, diff --stat.

---

## Anti-Patterns to Avoid

- ❌ Don't assume the suite is green — RUN `npx vitest run` and confirm 0 failed. Don't gate on a
  subset; gate on the full count. (research §3.)
- ❌ Don't treat "green `npx vitest run`" as sufficient — the CI gate is `npm run validate` (lint +
  format:check + typecheck + test:run + docs:check). Run the FULL gate. (research §2.)
- ❌ Don't add documentation for a non-existent feature. BUG-001 was an UNDOCUMENTED carve-out; the
  expected doc outcome is NO change. Confirm the sweep explicitly; don't assume, but don't invent.
  (research §5; work item "Do NOT add new documentation for a non-existent feature".)
- ❌ Don't amend the generic flag-table text ("Treat all errors as non-fatal and continue pipeline
  execution") — it is a GENERIC summary, not a validation-specific claim, and the detailed
  descriptions already scope to "individual tasks". Amending it over-specifies a non-existent surface.
- ❌ Don't "fix" the legitimate task-level `--continue-on-error` sites (~10 of them in prp-pipeline.ts)
  — they are correct; only the removed line-1868 carve-out was wrong. (system_context.md.)
- ❌ Don't mask a failure to force green. If `npx vitest run` shows a failure, apply the decision tree:
  known-file → trivial same-kind corrective fix (Rule 5); unknown-file → diagnose (possible BUG-001
  regression) → corrective fix or REPORT. Never silently skip. (research §6.)
- ❌ Don't re-do a sibling's already-landed test fix. Only apply a minimal corrective patch if a
  sibling left a residual edge. (research §6.)
- ❌ Don't broaden scope — no new features, no re-architecture, no spec/PRD edits. This is verification
  + optional one-line doc correction. Every change is minimal and out-of-spec-corrective.
- ❌ Don't edit `PRD.md`, `spec/`, `tasks.json`, `prd_snapshot.md`, or `.gitignore`.
- ❌ Don't skip `git diff --stat` — it is the scope-creep guard. Surprise files = something went wrong.

---

## Confidence Score

**9/10** — One-pass success likelihood.

Rationale: This is a verification + light-touch doc-sync task with a deterministic
outcome. The four implementing siblings' fixes are each small and prescribed by
architecture pins; their collective effect (9 failures → 0) is directly verifiable
by `npx vitest run`. The npm gates are verified in package.json
(`validate` = lint + format:check + typecheck + test:run + docs:check). The doc
sweep is grep-driven and the FULL `--continue-on-error` mention table is pre-vetted
(every hit classified against §4.4 — none specifically claims validation-exempt, so
the expected outcome is NO change). The only residual risks are: (a) a sibling's
fix didn't fully land → the decision tree handles it (trivial same-kind corrective
under Rule 5, or report); (b) a BUG-001 cleanup miss (leftover unused local) → a
minimal removal, in-scope; (c) P1.M2.T3.S1 running in parallel — its PRP is treated
as a contract and its one-line test edit is the last of the 8 stale tests this task
verifies. None of these block the verification; they are decision points the PRP
equips the agent to handle. With the sweep table pre-built and the gates verified,
this is as deterministic a verification task as exists.