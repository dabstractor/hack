# PRP — P1.M1.T1.S1: Make `#runValidation()` throw `ValidationFailedError` unconditionally on non-success outcome

> Bugfix 001, **BUG-001 (MAJOR)** — `#runValidation()` has an undocumented carve-out: when
> `--continue-on-error` is set and the failure is non-watchdog, it logs a warning and FALLS THROUGH
> to bug-hunt/commit instead of throwing — allowing a half-validated build (violates PRD §4.4).
> The fix removes the carve-out so every non-success outcome throws. The existing failing test at
> `prd-pipeline-validation.test.ts:337` transitions RED → GREEN.

---

## Goal

**Feature Goal**: In `PRPPipeline.#runValidation()` (`src/workflows/prp-pipeline.ts` ~line 1857),
remove the `if (this.#continueOnError && !watchdog)` fall-through branch so EVERY `!outcome.success`
throws `ValidationFailedError(outcome)` unconditionally. Delete the now-dead `const watchdog` local
and the contradicting inline comment. This restores PRD §4.4's unconditional abort-on-failure.

**Deliverable**: `src/workflows/prp-pipeline.ts` — the corrected `#runValidation()` (3 changes: replace
the if/else with unconditional throw; delete the `watchdog` local; delete the contradicting comment).

**Success Definition**:
- The test at `prd-pipeline-validation.test.ts:337` ('should NOT swallow a validation abort under
  --continue-on-error') transitions from FAIL → PASS.
- Sibling validation tests (watchdog/terminal at :330, validate-mode at :363, abort-before-bug-hunt
  with `continueOnError=false` at :377) remain green.
- No new flag/option/escape hatch is added (the PRD has no `--continue-on-error` exception for §4.4).
- `#continueOnError` remains untouched at its ~10 other task-level call sites.

---

## Why

- **Restores PRD §4.4 unconditional abort.** The PRD says: 'If validation does not finish (non-zero
  exit), the run MUST abort before cleanup, commit, and bug-hunt. Proceeding on a half-validated build
  is forbidden.' The carve-out violates this by letting bug-hunt + Smart Commit run after a failed
  validate.sh when `--continue-on-error` is set.
- **The method's own JSDoc + the run() call-site already document the throw as unconditional.** The
  carve-out contradicts both the PRD and the code's own documentation.
- **AGENTS.md Rule 5 (out-of-spec corrective fix).** This is a bug in existing behavior — a code
  branch that contradicts the spec it claims to implement. No PRD entry is blocking.
- **Zero-risk control-flow correction.** The fix replaces an if/else with a single unconditional throw;
  `ValidationFailedError`'s constructor already classifies watchdog vs non-watchdog internally, so the
  local `watchdog` variable becomes dead code.

---

## What

### The buggy code (src/workflows/prp-pipeline.ts ~lines 1857-1878)

```ts
    if (!outcome.success) {
      const watchdog = outcome.timedOut || outcome.exitCode === 124;
      // --continue-on-error: a non-watchdog validation failure ...
      // must NOT abort the whole run when the operator explicitly asked to
      // proceed past failures ...
      if (this.#continueOnError && !watchdog) {
        this.logger.warn(
          `[PRPPipeline] validate.sh failed (exitCode ${outcome.exitCode}) — proceeding under --continue-on-error (not aborting before bug-hunt)`
        );
      } else {
        throw new ValidationFailedError(outcome);
      }
    }
```

### The fix — three changes

**(a)** Replace the entire if/else with an unconditional throw:
```ts
    if (!outcome.success) {
      throw new ValidationFailedError(outcome);
    }
```

**(b)** Delete the `const watchdog = outcome.timedOut || outcome.exitCode === 124;` local (now unused —
`ValidationFailedError`'s constructor at `validation-workflow.ts:112` computes this internally).

**(c)** Delete the 7-line inline comment that rationalizes the carve-out (the
'--continue-on-error: a non-watchdog validation failure ... must NOT abort the whole run' comment).
Keep the preceding 3-line `// PRD §4.4 Abort-on-failure: non-zero exit aborts BEFORE bug-hunt` comment.

### Success Criteria
- [ ] `#runValidation()` throws `ValidationFailedError(outcome)` for every `!outcome.success` — no `--continue-on-error` branch.
- [ ] The `watchdog` local and the contradicting comment are deleted.
- [ ] The `// PRD §4.4 Abort-on-failure` comment is preserved.
- [ ] Test at `:337` transitions FAIL → PASS; sibling tests green.
- [ ] No other call site or `#continueOnError` usage is touched.

---

## All Needed Context

### Documentation & References

```yaml
# PATTERN FILE — the only file edited
- file: src/workflows/prp-pipeline.ts
  why: #runValidation() at ~line 1835. The buggy if/else is at ~line 1857-1878. The fix replaces it
        with a single unconditional throw + deletes the watchdog local + the contradicting comment.
  pattern: "if (!outcome.success) { throw new ValidationFailedError(outcome); }"
  gotcha: ValidationFailedError's constructor (validation-workflow.ts:112) already computes
        `const watchdog = outcome.timedOut || outcome.exitCode === 124` internally — so the local
        `watchdog` in #runValidation is dead code after the fix. Delete it.

# VERIFIED FACTS
- fact: "ValidationFailedError (validation-workflow.ts:104) constructor takes the outcome, classifies watchdog internally, sets this.timedOut + this.exitCode."
- fact: "The failing test (prd-pipeline-validation.test.ts:337) constructs the pipeline with continueOnError=true (5th arg) and outcome {success:false, exitCode:1, timedOut:false}. It asserts result.success===false + MockBugHunt not called."
- fact: "#runValidation() is called from run() at ~line 2935 BEFORE runQACycle() at ~line 2937, deliberately outside runQACycle's try/catch (which swallows when continueOnError===true). The throw lands in run()'s catch (~line 2976) → returns {success:false}."
- fact: "#continueOnError is used at ~10 other task-level sites (lines 671,783,843,1250,1451,1714,1793,2172,2250,2588) — do NOT touch those."
```

### Known Gotchas
```ts
// CRITICAL — do NOT add any new flag or option. The PRD has no --continue-on-error exception for §4.4.
//   The fix is purely removing the carve-out. If operators need to skip validation, that's a separate
//   PRD-scoped feature, not an overload of --continue-on-error.

// CRITICAL — delete the `watchdog` local. After the fix it's unused (ValidationFailedError's
//   constructor computes it internally). An unused variable trips @typescript-eslint/no-unused-vars.

// GOTCHA — do NOT touch #continueOnError at any of its ~10 other task-level call sites. Those are
//   legitimate task-level error-swallowing (individual task failures don't abort the whole run).
//   Only the validation carve-out is wrong.

// GOTCHA — the sibling test at :330 (exitCode 124 → terminal even though timedOut:false) must still
//   pass. It tests ValidationFailedError's constructor directly (not #runValidation), so the fix
//   doesn't affect it. But verify.
```

---

## Implementation Blueprint

### Tasks

```yaml
Task 1: EDIT src/workflows/prp-pipeline.ts — fix #runValidation()
  - LOCATE: the buggy if/else at ~line 1857-1878 inside #runValidation().
  - REPLACE the entire block (if(!outcome.success) { const watchdog...; if(this.#continueOnError && !watchdog) { warn } else { throw } })
        with: if (!outcome.success) { throw new ValidationFailedError(outcome); }
  - DELETE: the `const watchdog` local (dead code).
  - DELETE: the 7-line contradicting comment ('--continue-on-error: a non-watchdog validation failure...').
  - KEEP: the preceding 3-line '// PRD §4.4 Abort-on-failure' comment.
  - DO NOT touch any other function or any other #continueOnError usage.

Task 2: VERIFY
  - RUN: npm run fix → npm run typecheck.
  - RUN: npx vitest run tests/unit/workflows/prp-pipeline-validation.test.ts
        → the :337 test PASSES (was FAILING); sibling tests green.
  - EXPECTED: all green. The fix is a control-flow correction with no new code paths.
```

---

## Validation Loop

```bash
npm run fix && npm run typecheck
npx vitest run tests/unit/workflows/prp-pipeline-validation.test.ts
# Expected: ALL green — the :337 test passes (was failing); siblings stay green.
```

---

## Final Validation Checklist
- [ ] `#runValidation()` throws `ValidationFailedError` unconditionally on `!outcome.success`.
- [ ] The `watchdog` local + the contradicting comment are deleted.
- [ ] The `// PRD §4.4 Abort-on-failure` comment is preserved.
- [ ] Test at `:337` transitions FAIL → PASS; siblings green.
- [ ] `npm run typecheck` clean; no new flags/options added.

---

## Anti-Patterns to Avoid
- ❌ Don't add a new flag/option — the PRD has no `--continue-on-error` exception for §4.4.
- ❌ Don't touch the ~10 other `#continueOnError` task-level call sites — those are legitimate.
- ❌ Don't leave the `watchdog` local — it's dead code (trips no-unused-vars).
- ❌ Don't delete the preceding `// PRD §4.4 Abort-on-failure` comment — only the contradicting carve-out comment.

---

## Confidence Score
**10/10** — a control-flow correction: replace an if/else with a single unconditional throw, delete
dead code, delete a contradicting comment. The failing test already encodes the target contract; the
fix makes it pass. ValidationFailedError already classifies watchdog internally. No new code paths.