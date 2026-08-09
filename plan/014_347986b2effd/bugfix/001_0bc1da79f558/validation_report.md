# Validation Report — hacky-hack (Autonomous PRP Development Pipeline)

**Scope:** Comprehensive validation of the codebase, focused on the §2.3
Distributed-PRD include-dedup feature (`src/core/session-utils.ts`,
`src/config/constants.ts`) and overall project health.

**Date:** (run of `./validate.sh`)
**Validator role:** Read-only validation agent (no source/PRD/plan modifications).

---

## 1. Headline Finding

**The two issues carried in the validation input (BUG-001 marker collision,
BUG-002 deep-chain idempotency) are ALREADY FIXED in the current source.**

Both are resolved, carry dedicated regression tests, and were independently
re-confirmed by a fresh end-to-end probe against the live code:

| Input bug | Fix in source | Regression test | Independent E2E probe |
|---|---|---|---|
| BUG-001 — marker-mode idempotency breaks if a file named like a marker word (`include`/`end-include`/`include-ref`) exists | Markers use the **`@!`** prefix (`<!-- @!include: … -->`, `<!-- @!include-ref: … -->`, `<!-- @!end-include -->`). `! ∉ [A-Za-z0-9_./-]`, so `RESOLVE_TOKEN`'s capture group can never start on a marker — structurally non-resolvable even when same-named files exist. `src/core/session-utils.ts:512–514, 542, 553` (`elisionRefComment`) | `tests/unit/core/prd-markers.test.ts:250` ("BUG-001: markers are STRUCTURALLY non-resolvable — byte-idempotent even with marker-word collision files") | ✅ PASS |
| BUG-002 — idempotency breaks for include chains deeper than `PRD_INCLUDE_MAX_DEPTH` | Depth gate no longer returns the body verbatim; it calls **`neutralizeResolvableTokens`** which stats each boundary token and *elides* resolvable ones (drop, or collision-proof ref-comment). No resolvable survivor reaches a 2nd pass. `src/core/session-utils.ts:487–494` + `560–599` | `tests/unit/core/prd-resolve.test.ts:190` ("elides resolvable survivors at opts.maxDepth") and `:210` (maxDepth=0 uniform-elision edge) | ✅ PASS (default depth=10 *and* lowered maxDepth=3) |

**These two must NOT be re-fixed** — any fixer driven by this report should
treat them as closed.

---

## 2. Validation Methodology

`./validate.sh` runs six phases (all read-only; the pipeline itself is never
launched, per `AGENTS.md`):

1. **Lint** — `eslint . --ext .ts`
2. **Type check** — `tsc --noEmit -p tsconfig.build.json`
3. **Style check** — `prettier --check`
4. **Tests** — `vitest run` (unit + integration + e2e)
5. **E2E probe** — standalone `tsx` probe importing the pure `resolvePRD`
   function, exercising the **real distributed PRD** (`spec/SPEC.md`, 16
   `@`-includes) plus the BUG-001/BUG-002 adversarial scenarios.
6. **Docs check** — `scripts/check-docs.ts` (best-effort).

### Results (latest run)

| Phase | Result |
|---|---|
| Lint | ✅ 0 errors (6 pre-existing `@typescript-eslint/no-explicit-any` *warnings* in `src/cli/index.ts` & `src/utils/logger.ts` — unrelated to the PRD feature) |
| Type check | ✅ clean |
| Style check | ✅ all files conform |
| Tests | ✅ **7219 passed, 71 skipped, 0 failed** across 218 files |
| E2E probe | ✅ 6/6 passed |
| Docs check | ✅ 5/5 passed, 0 warnings |

The 71 skipped tests are all **conditional/guarded** skips (macOS-only
`resource-monitoring.bench`, `hasBuild`-gated describe blocks,
upstream `groundswell` stubs awaiting implementation, QA-agent cases needing
file-I/O mocks). None conceal broken functionality in the validated feature.

### Real distributed-PRD resolution (the actual production input)

Resolving the project's own `spec/SPEC.md` (16 includes → 157023-byte merged
document, hash `314806c6e683`) yields:
- **Zero surviving `@spec/…` tokens.**
- **Byte-idempotent:** `resolve(resolve(x)) === resolve(x)`.
- **Stable hash** across passes.

(The stderr `stale include '@path/to/file.md'` lines emitted during resolution
are **correct** §2.3 behavior — that string is prose in the spec, it ends in
`.md` and matches the boundary rule, so it warns once and stays verbatim. Not a
bug.)

---

## 3. Critical Issues (Must Fix)

None.

## 4. Major Issues (Should Fix)

None.

## 5. Minor Issues (Nice to Fix)

### MINOR-1: `getPrdIncludeMaxDepth()` does not floor fractional values, diverging from sibling "count" getters
**Severity:** Minor (consistency nit; **no** impact on correctness or idempotency)
**Location:** `src/config/constants.ts:1272–1280` (`getPrdIncludeMaxDepth`, `return raw` at line 1279 — no `Math.floor`).

**Description:**
Every other *count/quantity* numeric env getter in this file normalizes a valid
positive value with `Math.floor(raw)` (e.g. `getCommitRetryMax`, line 487;
`getClassifierRetryMax`, 554; `getCommitRetryDelayMs`, 615;
`getCommitRetryDelayCapMs`, 675; `getApiTimeoutMs`, 1222). `getPrdIncludeMaxDepth`
returns the raw float: `PRD_INCLUDE_MAX_DEPTH=3.7` yields `3.7`, and the depth
gate `depth >= maxDepth` then expands one *extra* nesting level compared with
the `Math.floor`-ed value `3` (depth 3 still passes `3 >= 3.7` → false, so it
expands rather than gating).

- **Why it isn't a real bug:** fractional `PRD_INCLUDE_MAX_DEPTH` is not a
  realistic configuration; idempotency is unaffected (survivors are elided via
  `neutralizeResolvableTokens` regardless of the exact gate depth); the function's
  JSDoc only promises "DEFAULT when unset, non-numeric, or non-positive" — it
  does not promise integer flooring, so this is not a spec violation. It is
  purely an internal consistency deviation from its closest sibling getters.
- **Reproduction:** `PRD_INCLUDE_MAX_DEPTH=1.7` resolves an entry→a→b chain with
  `b` *expanded* (verified); with `Math.floor` it would gate at `a` and leave `b`
  elided.
- **Suggested fix (optional):** `return Math.floor(raw);` to match the sibling
  count-getters, plus a one-line regression test for a fractional env value.

---

## 6. Recommendations

1. **Do not re-fix BUG-001 / BUG-002** — both are already resolved with tests
   and E2E confirmation (see §1).
2. (Optional) Apply the `Math.floor` consistency fix for MINOR-1, or explicitly
   document that `PRD_INCLUDE_MAX_DEPTH` is a real-valued gate.
3. The 6 pre-existing `no-explicit-any` lint **warnings** (not errors) in
   `src/cli/index.ts` / `src/utils/logger.ts` are outside the validated feature
   and pre-date this work; harmless to leave, but could be tidied separately.

---

## 7. Conclusion

The §2.3 distributed-PRD include-dedup feature is **correct, fixed (both input
bugs resolved), and ship-ready.** The broader codebase passes every automated
gate — lint (0 errors), type check, format, the full 7219-test suite, the docs
check, and a live E2E probe of the real distributed PRD. Only one genuinely
minor consistency nit was found (fractional `PRD_INCLUDE_MAX_DEPTH` is not
floored), and it has no functional impact.