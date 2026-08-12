# BUG-001 — Validation Abort Swallowed Under --continue-on-error (Major)

## PRD Authority
**§4.4 Abort-on-failure** (`spec/04-workflows.md:63`):
> "If validation does not finish (non-zero exit), the run MUST abort _before_ cleanup, commit, and bug-hunt. Proceeding on a half-validated build is forbidden. (A watchdog-killed validation is a hard failure, never retried — see §9.3.2.)"

The ONLY special-case §4.4 names is watchdog kills. There is **no** `--continue-on-error` exception.

## Defect Location
`src/workflows/prp-pipeline.ts`, method `#runValidation()` (line 1835).

## Current (Buggy) Code — lines 1856-1874
```typescript
    if (!outcome.success) {
      const watchdog = outcome.timedOut || outcome.exitCode === 124;
      // --continue-on-error: a non-watchdog validation failure ... must NOT abort
      // the whole run when the operator explicitly asked to proceed past failures
      if (this.#continueOnError && !watchdog) {           // ← THE BUG (line 1868)
        this.logger.warn(
          `[PRPPipeline] validate.sh failed (exitCode ${outcome.exitCode}) — proceeding under --continue-on-error (not aborting before bug-hunt)`
        );
      } else {
        throw new ValidationFailedError(outcome);
      }
    }
```
When `#continueOnError === true` and the failure is non-watchdog (`exitCode != 124 && !timedOut`), the throw is **skipped** → falls through to `runQACycle()` (bug-hunt + fix-cycle) and Smart Commit — exactly the "half-validated build" §4.4 forbids.

## Why It's Wrong (architectural confirmation)
1. `#runValidation()` is called from `run()` at **line 2935**, BEFORE `runQACycle()` at **line 2937**, deliberately OUTSIDE `runQACycle()`'s try/catch. The JSDoc (lines 1825-1830) and the comment at lines 2929-2930 both state the throw must propagate unconditionally even under `--continue-on-error`. The carve-out contradicts the method's own documented contract.
2. `run()`'s catch block (line ~2976) returns `{ success: false, error: <ValidationFailedError.message> }` — the correct terminal result.
3. `#continueOnError` is used legitimately at ~10 OTHER task-level sites (lines 671, 783, 843, 1250, 1451, 1714, 1793, 2172, 2250, 2588) to continue past individual task failures. Line 1868 is the ONLY place it gates a STAGE-level abort — an incorrect overload.

## The Fix
Remove the `if (this.#continueOnError && !watchdog)` fall-through entirely. Every `!outcome.success` outcome must throw `ValidationFailedError`. Result:
```typescript
    if (!outcome.success) {
      throw new ValidationFailedError(outcome);
    }
```
Also remove the now-dead `const watchdog` local (line 1860) and the contradicting comment block (lines 1861-1867). The `ValidationFailedError` constructor already classifies watchdog vs non-watchdog internally (see `src/workflows/validation-workflow.ts:104`), so the local `watchdog` computation is redundant after the fix.

**Do NOT** add a new flag to re-introduce an escape hatch — the PRD has no `--continue-on-error` exception for §4.4. If operators genuinely need to proceed past validation debt, that requires a separate, explicitly-scoped PRD entry (not this bugfix).

## Test That Validates the Fix
`tests/unit/workflows/prp-pipeline-validation.test.ts:337` — `'should NOT swallow a validation abort under --continue-on-error'`:
- Sets validation to fail: `outcome({ success: false, exitCode: 1, timedOut: false })` (non-watchdog).
- Creates pipeline with `continueOnError: true` (5th constructor arg).
- Asserts: `result.success === false`, `result.error` matches `/Validation failed/`, `MockBugHunt` NOT called.
- Currently FAILS (result.success is true because the abort was swallowed). After the fix it PASSES.

Related tests that must remain green:
- `:363` — `'should run validation in "validate" mode'`
- `:377` — `'should abort before bug-hunt when validation fails (bug-hunt never reached)'` (continueOnError=false path)

## Verification
`npx vitest run tests/unit/workflows/prp-pipeline-validation.test.ts` → all green.