# Research — P1.M1.T1.S2 (five per-role reasoning getters + validateAllReasoningLevels)

S2 adds the 5 per-role reasoning getters + a fail-fast aggregate validator on top of S1's landed
primitives. Each getter is a one-line wrapper over `resolveReasoningLevel` (S1) — mirroring the
`getValidationAgent()` JSDoc shape but routing through the validator for case-normalization +
empty→default + invalid→throw. Consumed by T3 (agent factories) and T4 (startup fail-fast).

## 1. S1 is LANDED (verified — consume, don't modify)

`src/config/constants.ts` (all confirmed present):
- `ReasoningLevel` type (L1519) = `'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'`
- `REASONING_LEVELS` (L1534, `as const`) = `['off','minimal','low','medium','high','xhigh']`
- 5 env-name constants: `PRP_REASONING_AGENT` (L1551), `PRP_REASONING_BREAKDOWN_AGENT` (L1560),
  `PRP_REASONING_BUG_FINDER_AGENT` (L1569), `PRP_REASONING_VALIDATION_AGENT` (L1578),
  `PRP_REASONING_IMPL_AGENT` (L1588) — each equals its own name string.
- 5 defaults (`as const`): `DEFAULT_REASONING_AGENT='high'` (L1593), `DEFAULT_REASONING_BREAKDOWN_AGENT='high'`
  (L1598), `DEFAULT_REASONING_BUG_FINDER_AGENT='high'` (L1603), `DEFAULT_REASONING_VALIDATION_AGENT='high'`
  (L1608), `DEFAULT_REASONING_IMPL_AGENT='off'` (L1616).
- `resolveReasoningLevel(raw, envKey, defaultLevel): ReasoningLevel` (L1637-1654): undefined→default,
  trim→''→default, toLowerCase, `(REASONING_LEVELS as readonly string[]).includes(lowered)` else throw
  `ReasoningConfigError({ key: envKey, value: raw })`, return lowered.

`src/config/types.ts`: `ReasoningConfigError` (rich AuthPreflightError form — readonly `key`+`value`).

S2 APPENDS the 5 getters + `validateAllReasoningLevels` to the Reasoning section in constants.ts
(after `resolveReasoningLevel`, ~L1654). S2 does NOT modify any S1 symbol.

## 2. The getter → role → env → default mapping (verified vs integration-points.md §C + PRD §9.2.9)

| Getter | Role | env-name constant | Default |
| --- | --- | --- | --- |
| `getReasoningAgent()` | research/PRP (`AGENT`) | `PRP_REASONING_AGENT` | `high` |
| `getReasoningBreakdown()` | task-decomposition (`BREAKDOWN_AGENT`) | `PRP_REASONING_BREAKDOWN_AGENT` | `high` |
| `getReasoningBugFinder()` | bug-finder (`BUG_FINDER_AGENT`) | `PRP_REASONING_BUG_FINDER_AGENT` | `high` |
| `getReasoningValidation()` | validation (`VALIDATION_AGENT`) | `PRP_REASONING_VALIDATION_AGENT` | `high` |
| `getReasoningImpl()` | implementation/codegen (`IMPL_AGENT`) | `PRP_REASONING_IMPL_AGENT` | `off` |

Consumer mapping (integration-points.md §C, for cross-check — T3 owns the wiring, NOT S2):
`createResearcherAgent→getReasoningAgent()`; `createArchitectAgent→getReasoningBreakdown()`;
`createCoderAgent→getReasoningImpl()`; `createQAAgent(level)` receives the caller-resolved level
(bug-finder/validation).

## 3. The getter bodies (one-liners over resolveReasoningLevel)

```ts
export function getReasoningAgent(): ReasoningLevel {
  return resolveReasoningLevel(
    process.env[PRP_REASONING_AGENT], PRP_REASONING_AGENT, DEFAULT_REASONING_AGENT);
}
// …same shape for Breakdown / BugFinder / Validation / Impl with their (env-name, default) pairs…
export function getReasoningImpl(): ReasoningLevel {
  return resolveReasoningLevel(
    process.env[PRP_REASONING_IMPL_AGENT], PRP_REASONING_IMPL_AGENT, DEFAULT_REASONING_IMPL_AGENT);
}

/** Call all 5 getters so an invalid value in ANY role throws at the call site (fail-fast, §9.2.9 #4). */
export function validateAllReasoningLevels(): void {
  getReasoningAgent();
  getReasoningBreakdown();
  getReasoningBugFinder();
  getReasoningValidation();
  getReasoningImpl();
}
```

## 4. The JSDoc pattern to mirror (getValidationAgent, constants.ts:978-1005)

`getValidationAgent` JSDoc: `@returns` (names the default) + `@remarks` (empty→default rationale) +
`@example`. S2's getter JSDoc MIRRORS this but ADDS the invalid→hard-error note (reasoning getters
validate + throw, unlike the free-string agent getters). Each getter's JSDoc MUST state: the default,
empty/whitespace→default (never forwarded, §9.2.9), invalid→`ReasoningConfigError` (hard startup
error, §9.2.9 #4), and cite §9.2.9. `validateAllReasoningLevels` JSDoc: states it calls all 5 getters
(fail-fast; consumed by T4 startup).

## 5. The test file (tests/unit/config/constants.test.ts — S2 appends after L452)

- S1 already added `describe('config/constants: resolveReasoningLevel', …)` (L361) +
  `describe('config/types: ReasoningConfigError', …)` (the file is now 452 lines). S2 APPENDS new
  describe block(s) after L452.
- ENV pattern for getter tests (mirror `getResearchDepth` L179 / `getBugfixScope` L296):
  `afterEach(() => vi.unstubAllEnvs())` + `vi.stubEnv('<VAR>', value)` per case. S2's getters READ
  `process.env[PRP_REASONING_*]`, so they NEED env control (unlike S1's resolveReasoningLevel tests,
  which passed raw values as args).
- IMPORT the 5 getters + validateAllReasoningLevels from `'../../../src/config/constants.js'`;
  `ReasoningConfigError` from `'../../../src/config/types.js'` (already imported at L47).

## 6. Test cases (data-driven over the 5 tuples is DRYest; matches the file's per-getter style too)

Per getter (or a data-driven describe iterating the 5 `[getter, envName, default]` tuples):
1. unset → default (the var is unset in the test env; or stubEnv '' to be deterministic).
2. empty (`''`) → default; whitespace (`'  '`) → default.
3. valid lowercase (`'medium'`) → `'medium'`; case-insensitive (`'HIGH'`) → `'high'`.
4. invalid (`'ultra'`) → throws `ReasoningConfigError` (instanceof + name + key === envName + value).
Plus a focused check: `getReasoningImpl()` default is `'off'` (the one non-`high` default).

`validateAllReasoningLevels()`:
- all-unset → no throw (no-op; returns void).
- one invalid (stubEnv `PRP_REASONING_AGENT='ultra'`) → throws `ReasoningConfigError`.

## 7. Coverage (vitest 100% on src/**/*.ts)

The 5 getters + validateAllReasoningLevels are one-liners with NO internal branches (the branches
live in `resolveReasoningLevel`, already covered by S1's tests). For 100% FUNCTION coverage each
getter must be CALLED ≥ once — the data-driven test (calling all 5) + the validateAll tests cover
every new function. The getter LINES are covered by any call. No new branch inside the getters.

## 8. Scope boundaries

- S2 = 5 getters + validateAllReasoningLevels + JSDoc + tests. NOTHING else.
- S1 (landed) = the vocabulary + validator + error. Do NOT modify any S1 symbol.
- T3 (agent-factory) = wires the getters into createBaseConfig/createQAAgent. S2 only PROVIDES them.
- T4 (startup) = calls validateAllReasoningLevels() on the startup path + the main().catch arm.
- S4 (.env.example) = documents the env-var surface; S2 is JSDoc-only (Mode A).

## 9. Validation (verified executable)

- `npm run typecheck` / `npm run lint` / `npm run format:check` (prettier ERROR-enforced; `npm run fix`).
- `npx vitest run tests/unit/config/constants.test.ts --coverage` (S2 additions + S1 regression; 100%).
- Do NOT run full `npm run test:run` as the gate (orthogonal suite state).