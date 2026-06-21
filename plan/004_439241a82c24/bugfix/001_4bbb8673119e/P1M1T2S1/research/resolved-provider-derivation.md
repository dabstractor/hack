# Research Notes — P1.M1.T2.S1 (resolved-provider derivation in Step 4)

## Baseline measurements (verified before writing PRP)

| Gate | Command | Result |
|---|---|---|
| Target test file | `npm run test:run -- config/harness-provider-compat` | **5/5 pass** (test (b) `claude-code + zai throws` still green) |
| Typecheck (total) | `npx tsc --noEmit -p tsconfig.build.json` | **18 errors**, ALL in `src/tools/{bash,filesystem,git}-mcp.ts` (Issue 4, pre-existing). **ZERO** in `src/config/harness.ts` or `src/config/environment.ts`. |

→ My change must keep the test at 5/5 and must add **0 new** typecheck errors.

## Why test (b) still passes after the fix (the non-obvious invariant)

`getModel('sonnet')` with no `ANTHROPIC_DEFAULT_SONNET_MODEL` override returns
`qualifyModel(MODEL_NAMES.sonnet)` = `qualifyModel('GLM-4.7')` = `'zai/GLM-4.7'`.
Therefore `getModel('sonnet').split('/')[0] === 'zai'` → the throw branch STILL fires for
test (b), which does NOT stub `ANTHROPIC_DEFAULT_SONNET_MODEL`. The constant check and the
resolved check agree exactly on the default path. This is why the fix is safe and the
existing rejection test needs no modification.

## Type-safety of the new call (confirmed against `src/config/types.ts`)

`getModel('sonnet').split('/')[0]` is statically typed `string`.
`ModelProvider = 'zai' | 'anthropic' | (string & {})`.
Because `string` is assignable to `string & {}` (the `{}` intersect only excludes
null/undefined; `string` already satisfies it), a bare `string` IS assignable to
`ModelProvider`. → `new HarnessProviderMismatchError(harness, resolvedProvider)` typechecks
with **no cast**. Confirmed by reading `types.ts` constructor signature
`(harness: AgentHarness, provider: ModelProvider)`.

## No circular import (confirmed by reading `src/config/environment.ts`)

`environment.ts` imports ONLY from `./constants.js` and `./types.js` (both leaf modules).
It does NOT import `./harness.js`. Therefore `harness.ts` importing `getModel` from
`./environment.js` introduces no cycle. (constants.ts and types.ts are dependency-free.)

## DEFAULT_MODEL_PROVIDER must STAY imported

`DEFAULT_MODEL_PROVIDER` is still consumed in **Step 5** of `configureHarness()`:
`defaultModelProvider: DEFAULT_MODEL_PROVIDER`. Removing the import would break Step 5 and
the `harness-config.test.ts` / `harness-provider-compat.test.ts` assertions on
`configureHarnesses.toHaveBeenCalledWith({ …, defaultModelProvider: 'zai' })`.
Only its usage in **Step 4** is being removed.

## Scope boundary — what NOT to do here

The NEW false-arm of the guard (`resolvedProvider !== 'zai'` → claude-code + anthropic
passes) is NOT covered by any existing test. Adding that positive test is the explicit
deliverable of **P1.M1.T2.S2**. Per the vitest.config.ts findings (documented in
P1.M1.T1.S2 PRP), `npm run test:run` does NOT enforce coverage thresholds (only
`test:coverage` does), so the uncovered false-arm does NOT fail THIS subtask's gates.
Full 100% branch coverage is owned by P1.M2.T3.
