# Research — Provider-Endpoint Guard Extraction & Testability

Findings anchoring P1.M2.T1.S1 (provider-endpoint guard tests). All file
references verified against the working tree on 2026-06-20.

## 1. The guard currently lives in THREE places (work item names two)

| File                               | Role                                          | Runs via                        | Exit/throw on block                                           |
| ---------------------------------- | --------------------------------------------- | ------------------------------- | ------------------------------------------------------------- |
| `src/scripts/validate-api.ts`      | Standalone validation script                  | `npm run validate:api` (manual) | `process.exit(1)` (top-level, before `main()`)                |
| `tests/validation/zai-api-test.ts` | Standalone validation script                  | `npx tsx ...` (manual)          | `process.exit(1)` (top-level)                                 |
| `tests/setup.ts`                   | **Global vitest setup** — runs for EVERY test | `npm run test:run` (auto)       | `throw new Error(message)` (in `beforeEach` + at module load) |

The work item text names only the first two, but `tests/setup.ts` contains the
identical guard and is the one actually enforced during `npm run test:run`. The
clarification ("constrains the PROVIDER, not the harness") is incomplete unless
it reaches the test-time message too.

## 2. Coverage scope — CRITICAL, non-obvious

`vitest.config.ts` coverage `include: ['src/**/*.ts']`. So
`src/scripts/validate-api.ts` IS in coverage scope. BUT v8 coverage only
measures files that are **loaded during the test run**. Verified:

- `grep -rn "validate-api" src/ tests/` → the file is imported by **nothing**
  (only its own JSDoc `@example` mentions the path).
- It has top-level `await main()`, `process.exit(...)`, and live `fetch()` — it
  cannot be imported without executing side effects, so no test imports it.

**Conclusion**: `validate-api.ts` currently contributes ZERO to coverage
(neither covered nor uncovered). Therefore:

> ❌ DO NOT add a test that `import`s `src/scripts/validate-api.ts`. Doing so
> would load 16KB of network/exit code into coverage and instantly violate the
> 100% global threshold. Test the GUARD LOGIC via a dedicated pure module, not
> by importing the script.

The new module (`src/config/endpoint-guard.ts`) WILL be in coverage scope (it is
imported by the test) → it must be 100% covered. The dedicated test suite covers
all branches (see §5).

## 3. `zai-api-test.ts` is NOT executed by vitest

`vitest.config.ts` → `include: ['tests/**/*.{test,spec}.ts']`.
`tests/validation/zai-api-test.ts` ends in `-test.ts`, NOT `.test.ts` → vitest
ignores it. It is a **manual** script (`npx tsx tests/validation/zai-api-test.ts`).
Implication: refactoring its guard messaging cannot break `npm run test:run`.
(Side note, OUT OF SCOPE: its Test 2 has stale `getModel('opus') === 'GLM-4.7'`
checks; T2.S1 made `getModel` return `'zai/GLM-4.7'`, so those now `warn` rather
than `success`. Do not "fix" them here — they are unrelated to the guard and not
run by the suite. Leave them.)

## 4. Global-setup interaction with `vi.stubEnv` (the mocking trap)

`tests/setup.ts` registers a global `beforeEach` that calls `validateApiEndpoint()`.
Vitest runs **setup-file hooks BEFORE local-file hooks**, and global `afterEach`
calls `vi.unstubAllEnvs()`. Trace for a test that stubs env to Anthropic:

1. Global `beforeEach`: `validateApiEndpoint()` reads `process.env.ANTHROPIC_BASE_URL`
   — env is CLEAN here (restored by prior `afterEach`) → passes, no throw.
2. Local `beforeEach` (or test body): `vi.stubEnv('ANTHROPIC_BASE_URL', 'https://api.anthropic.com')`.
3. Test body: calls the guard fn → Anthropic → throws → `expect(() => …).toThrow()` ✓.
4. Global `afterEach`: `vi.unstubAllEnvs()` restores env.

So `vi.stubEnv` works **provided the stub is applied inside the test body or a
LOCAL hook (which runs after the global hook)**. Invariant to preserve: the
global `beforeEach` always sees a clean (default z.ai) env.

## 5. Extraction design — dual-function module for clean testing

A pure predicate cannot satisfy the work item's explicit `vi.stubEnv` requirement
(a pure fn takes a URL arg and never reads env). So the module exposes BOTH:

```ts
// src/config/endpoint-guard.ts
export type EndpointCheckStatus = 'allowed' | 'blocked' | 'warning';
export interface EndpointCheckResult {
  readonly status: EndpointCheckStatus;
  readonly message: string; // clarified: constrains the PROVIDER, orthogonal to harness
}

/** PURE — no env, no side effects. Tests assert branches/messages here. */
export function checkProviderEndpoint(baseUrl: string): EndpointCheckResult;

/** Reads env by default; throws on 'blocked', console.warn on 'warning'. */
export function validateProviderEndpoint(
  baseUrl: string = process.env.ANTHROPIC_BASE_URL ?? ''
): void;
```

`validateProviderEndpoint` = `const r = checkProviderEndpoint(baseUrl); if
(r.status === 'blocked') throw new Error(r.message); if (r.status === 'warning')
console.warn(r.message);`. Single source of message text. Scripts keep their
colored UX by calling `checkProviderEndpoint` and printing `result.message`
themselves; `tests/setup.ts` calls `validateProviderEndpoint()` (throw semantics
identical to today).

### Branch coverage of `checkProviderEndpoint` (all must be exercised for 100%)

| Input                                                         | status    | Covered by test             |
| ------------------------------------------------------------- | --------- | --------------------------- |
| `''` (empty/unset)                                            | `allowed` | "empty env allowed" case    |
| `https://api.z.ai/api/anthropic`                              | `allowed` | (a) z.ai allowed            |
| `http://localhost:3000` / `…127.0.0.1…` / `…mock…` / `…test…` | `allowed` | (c) localhost/mock allowed  |
| any `api.anthropic.com` variant                               | `blocked` | (b) Anthropic blocked       |
| other non-z.ai, non-mock (e.g. `https://example.com/api`)     | `warning` | "other endpoint warns" case |

`validateProviderEndpoint` branches: blocked→throw, warning→warn (spy on
`console.warn`), allowed→noop. Covered by env-stub tests.

## 6. Blocked-pattern set — unify on the THOROUGH set (no weakening)

`tests/setup.ts` blocks `['https://api.anthropic.com','http://api.anthropic.com','api.anthropic.com']`.
`validate-api.ts` only checks `.includes('https://api.anthropic.com')` (would miss
`http://`/bare variants). Unify on the thorough 3-pattern set in the shared
module — this STRENGTHENS the script guard and matches work-item "do not weaken
the z.ai enforcement". `setup-verification.test.ts` already documents this exact
3-pattern set as the contract.

## 7. `setup-verification.test.ts` will NOT break

`tests/unit/setup-verification.test.ts:146` explicitly states the guard is "not
exported, so it cannot be directly tested" and instead asserts on a LOCAL copy of
`BLOCKED_PATTERNS` via `BLOCKED_PATTERNS.some(p => pattern.includes(p))`. It never
imports or calls `tests/setup.ts`'s function. Therefore refactoring `setup.ts` to
delegate to the shared module is safe — and the new module finally makes the
guard "directly testable" (exactly what that test laments). Its canary + pattern
assertions remain green regardless.

## 8. Orthogonality assertion (harness ↔ provider)

The guard must NOT reference `PRP_AGENT_HARNESS` — it constrains the PROVIDER
endpoint only. Test (a) ties in the harness by ALSO asserting `DEFAULT_HARNESS
=== 'pi'` (imported from `src/config/constants.js`, T1.S1) alongside the
allowed-endpoint check, documenting that the default `pi` harness + z.ai provider
is the allowed configuration (PRD §9.4.1/§9.4.2). The clarified message names
"provider" and explicitly notes orthogonality to the "harness".

## 9. Existing conventions to mirror (pattern files)

- `tests/unit/config/harness-config.test.ts` — `vi.mock('groundswell', …)`, `vi.stubEnv('ANTHROPIC_API_KEY', …)`, `delete process.env.X`, `expect(() => fn()).toThrow(SomeError)`, `afterEach(() => vi.unstubAllEnvs())`. **Copy this style verbatim.**
- `tests/unit/config/environment.test.ts` — `afterEach(() => vi.unstubAllEnvs())` + `import { DEFAULT_BASE_URL } from '../../../src/config/constants.js'`.
- `src/config/constants.ts` — `DEFAULT_BASE_URL = 'https://api.z.ai/api/anthropic'`, `DEFAULT_HARNESS='pi'`, `DEFAULT_MODEL_PROVIDER='zai'`. CONSUME (no edit).
- `src/config/harness.ts` (T1.S2) — the harness/provider MISMATCH guard is SEPARATE (it throws `HarnessProviderMismatchError`). That compatibility-rejection TEST is P1.M2.T1.S2, NOT this item. Do not duplicate it.

## 10. Validation commands (verified present in package.json)

- `npm run validate` = `lint && format:check && typecheck`.
- `npm run test:run` = `vitest run` (full suite; enforces 100% coverage globally).
- `npm run fix` = `lint:fix && format` (run BEFORE validate to auto-fix prettier/eslint nits).
- Targeted: `npx vitest run tests/unit/config/endpoint-guard.test.ts`.
