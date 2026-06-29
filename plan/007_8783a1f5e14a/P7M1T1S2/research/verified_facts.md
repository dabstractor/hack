# Verified Facts — P7.M1.T1.S2 (Lazy logger instantiation, REQ-L2)

All facts below were verified against the live repo at PRP-research time
(2026-06-29). Line numbers may drift after S1 edits `src/utils/logger.ts`; the
**acceptance grep** is the source of truth, not line numbers.

## 1. The 31 module-scope declarations (LIVE grep)

Command: `rg -n "^(export )?(const|let) \w+ = getLogger\(" src/`
Count: **exactly 31** (confirmed).

```
src/cli/index.ts:40:const logger = getLogger('CLI');
src/cli/commands/inspect.ts:46
src/cli/commands/cache.ts:31
src/cli/commands/validate-state.ts:39
src/cli/commands/artifacts.ts:37
src/core/tasks-json-recovery.ts:45
src/core/state-validator.ts:38
src/agents/agent-factory.ts:49
src/core/session-utils.ts:36
src/utils/git-commit.ts:27
src/utils/pass-rate-analyzer.ts:49
src/utils/validation-report-verifier.ts:38
src/utils/issue-resolution-verifier.ts:53
src/utils/cli-options-verifier.ts:35
src/utils/high-priority-warning-verifier.ts:42
src/utils/startup-error-verifier.ts:38
src/utils/build-logger.ts:37
src/utils/eslint-error-verifier.ts:46
src/core/dependency-validator.ts:44
src/utils/eslint-result-parser.ts:43
src/utils/memory-comparison-reporter.ts:36
src/core/task-patcher.ts:26
src/utils/package-json-reader.ts:35
src/utils/full-test-suite-runner.ts:57
src/utils/package-json-updater.ts:44
src/utils/prd-validation-executor.ts:43
src/utils/package-json-syntax-verifier.ts:36
src/utils/cli-help-executor.ts:37
src/utils/console-log-verifier.ts:36
src/utils/retry.ts:556
src/utils/single-test-runner.ts:41
```

- **None are `export`-ed.** Every `logger` binding is module-local. (grep for
  `^(export )?` confirms no `export const logger`.) Re-export propagation is NOT
  a concern.
- Import line in every file is `import { getLogger } from '<rel>/utils/logger.js';`.
  **None currently import the `Logger` type** — the lazy form requires adding
  `type Logger` to that import (see migration strategy).

## 2. Call-site scope

- Total `logger.<method>` call sites across the 31 files: **238**.
  (`rg -nc "\blogger\."` summed.)
- **`logger.child(...)` is used in ZERO of the 31 files.** The only `.child()`
  usages repo-wide are in `logger.ts` (a docstring example) and
  `src/utils/metrics-collector.ts:316` (a DIFFERENT local `logger`, not one of
  the 31). → No `.child()` chaining concern for this migration.
- **Zero column-0 (`^logger\.`) calls** in any of the 31 files. Confirms every
  `logger.x(...)` lives inside a function body → converting to `logger().x(...)`
  genuinely defers construction until first call. (REQ-L2 fully achievable.)
- The stall-critical chain (PRD §9.6.1): `src/index.ts` → `src/cli/index.ts`
  (decl line 40, `'CLI'`). `cli/index.ts` has ~33 call sites, all `logger.error`
  / `logger.warn` inside function bodies (lines 387–909).

## 3. Comment / string bulk-replace RISK (do NOT blind-replace)

`logger.<method>(` appears inside COMMENTS / DOCSTRINGS / STRING LITERALS in
several of the 31 files. A naive `s/logger./logger()./g` would corrupt them:

```
src/utils/build-logger.ts:19          * import { documentBuildSuccess } from './utils/build-logger.js';
src/core/tasks-json-recovery.ts:26    * if (result.restored) logger.info(result.reason, '...');   <-- JSDoc example
src/core/tasks-json-recovery.ts:154   * if (result.restored) logger.info(...);                     <-- JSDoc example
src/utils/single-test-runner.ts:203   * const r = await runSingleTestFile('tests/unit/utils/logger.test.ts');  <-- STRING (filename!)
src/utils/single-test-runner.ts:207   *   'tests/unit/utils/logger.test.ts',                       <-- STRING (filename!)
src/core/dependency-validator.ts:382  *   logger.info('Dependency validation passed');             <-- JSDoc example
src/core/dependency-validator.ts:386  *     logger.error(`Circular dependency: ${path}`);          <-- JSDoc example
src/utils/retry.ts:16                 * - Structured logging via logger.ts
src/utils/retry.ts:567                * logger utility from src/utils/logger.ts.
```

`logger.test.ts` contains a literal `logger.` — a blind replace would turn the
test-path string into `logger().test.ts` and break that test path at runtime.
→ Use the SCOPED perl one-liner in `migration_strategy.md` (skips comment lines,
matches only real method calls with `(`).

## 4. Test-mock compatibility (migration is SAFE — verified)

33+ test files `vi.mock('.../logger.js', ...)`. Two mock shapes observed, BOTH
survive the lazy migration:

**Shape A — stable hoisted object** (`tests/unit/cli/index.test.ts`,
`tests/unit/utils/build-logger.test.ts`):
```ts
const { mockLogger } = vi.hoisted(() => ({ mockLogger: { info: vi.fn(), ... } } }));
vi.mock('...logger.js', () => ({ getLogger: vi.fn(() => mockLogger) }));
```
After migration: `logger()` → `_logger ??= getLogger('CLI')` → returns the SAME
`mockLogger` → `mockLogger.error(...)` assertions still hold. ✓

**Shape B — per-call factory** (`tests/unit/utils/console-log-verifier.test.ts`):
```ts
vi.mock('...logger.js', () => ({ getLogger: vi.fn(() => ({ warn: vi.fn(), ... })) }));
```
After migration: first `logger()` call caches the returned object; subsequent
calls reuse it. Assertions on the verifier's RETURN value are unaffected. ✓

**No test asserts `getLogger` was CALLED** (timing/args):
`rg "getLogger.*toBeCalled|expect\(.*getLogger|getLogger.*toHaveBeenCalled" tests/`
→ zero hits. → Deferred call timing breaks no assertion. ✓

Net: the existing `npm run test:run` suite fully validates behavior after
migration without any test edits (except coverage — see §5).

## 5. Coverage gate (the #1 hazard)

`vitest.config.ts`:
```ts
coverage: {
  provider: 'v8',
  include: ['src/**/*.ts'],
  // coverage.all defaults to true → ALL src files counted
  thresholds: { global: { statements: 100, branches: 100, functions: 100, lines: 100 } },
}
```

The contract lazy form `const logger = (): Logger => (_logger ??= getLogger('X'))`
uses `??=`, which v8 reports as a **2-outcome branch** (assign-vs-skip). For
100% BRANCH coverage, BOTH outcomes must be hit per file:
- outcome 1 (first call): `_logger` undefined → assign.
- outcome 2 (memoized):    `_logger` set → skip assignment.

Files WITH a direct unit test (27 of 31) hit both outcomes automatically IF the
test triggers a logging path ≥2 times (most do — multiple `it` blocks). The
**4 files with NO direct unit test** are covered only transitively and may hit
the memoized branch zero or one times → branch coverage < 100% → gate FAILS:

```
NO TEST : src/cli/commands/cache.ts
NO TEST : src/core/state-validator.ts
NO TEST : src/utils/pass-rate-analyzer.ts
NO TEST : src/utils/eslint-result-parser.ts
```

(Direct-test files, for reference: cli/index, inspect, validate-state [integration],
artifacts, tasks-json-recovery, agent-factory, session-utils, git-commit,
validation-report-verifier, issue-resolution-verifier, cli-options-verifier,
high-priority-warning-verifier, startup-error-verifier, build-logger,
eslint-error-verifier, dependency-validator, memory-comparison-reporter,
task-patcher, package-json-reader, full-test-suite-runner, package-json-updater,
prd-validation-executor, package-json-syntax-verifier, cli-help-executor,
console-log-verifier, retry, single-test-runner.)

Mitigation: see `migration_strategy.md` §3. Run `npm run test:coverage` and
inspect the per-file branch report; for any migrated file <100% branches, ensure
a logging path is invoked a second time (add a tiny test for the 4 no-test
files).

## 6. ESLint / formatting

`.eslintrc.json`:
- `@typescript-eslint/no-explicit-any`: `"warn"` (not error) in src; OFF in tests.
- `no-var-requires` / `strict-boolean-expressions`: off.
The lazy form uses no `any` → no lint friction. (`Logger` type import is clean.)
- No `??=` precedent in `src/` today, but `??=` is ES2021 (Node 20+ / TS 5.2+
  per PRD §9.1) and is the form mandated by the work-item contract.

`package.json`:
- `format:check` exists (`prettier --check`).
- Combined gate: `npm run validate` = `lint && format:check && typecheck && test:run`.
- `build` = `tsc -p tsconfig.build.json`; runs `prebuild` (lint+typecheck).

## 7. Public API contract (from S1 — do NOT change)

`src/utils/logger.ts` (S1 owns; S2 must NOT edit it — parallel execution):
- `export interface Logger { trace/debug/info/warn/error/fatal(...); child(...); }`
- `export function getLogger(context: string, options?: LoggerConfig): Logger`
- Context-keyed `loggerCache` (memoization by `getCacheKey`) — PRESERVED. The
  lazy form must keep calling `getLogger('X')` (not bypass the cache) so no
  duplicate instances are created.

S2 consumes S1's `getLogger` unchanged. S1's deliverables (lazy `getPino()`,
no `transport:`, no `setMaxListeners`) land independently; S2 does not depend on
their internals, only on the unchanged `getLogger`/`Logger` signature.
