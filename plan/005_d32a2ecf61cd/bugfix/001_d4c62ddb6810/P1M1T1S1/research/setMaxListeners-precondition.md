# Research — P1.M1.T1.S1 (optional-chaining fix to process.setMaxListeners in getLogger)

## 0. ⚠️ CRITICAL PRECONDITION FINDING — read before implementing

The offending code described in the work item / TEST_RESULTS.md Issue 1 is **NOT
present in the current working tree**. Verified facts:

| Check | Result |
| --- | --- |
| `grep -n "setMaxListeners" src/utils/logger.ts` | **no matches** (exit 1) |
| `npx vitest run tests/unit/utils/progress-display.test.ts` | **44 passed (44)** — zero failures |
| Current HEAD | detached at `fd7352c` ("Add task breakdown and architecture research") |
| `git merge-base --is-ancestor 4e6d2ef HEAD` | **NO** — `4e6d2ef` is NOT an ancestor of HEAD |
| `4e6d2ef` lives on | `main` / `origin/main` only |
| `git show 4e6d2ef:src/utils/logger.ts \| grep setMaxListeners` | `448: process.setMaxListeners(30);` ← the bug IS on `main` |

**Interpretation:** The current branch (`fd7352c` ← `93be68d` ← `b03ed87` ← `40540a4` …)
diverged from `main` BEFORE commit `4e6d2ef` landed. The regression (`process.setMaxListeners(30)`
added by `4e6d2ef` inside `getLogger`) is therefore absent here. The bug report
(`plan/005_d32a2ecf61cd/bugfix/001_d4c62ddb6810/TEST_RESULTS.md`) was authored
against `main`/`4e6d2ef`, which is a different timeline than the current working tree.

**Consequence for the implementer:** the literal "before" text
(`process.setMaxListeners(30);`) **will not be found** in `src/utils/logger.ts` on
the current tree. The fix is either (a) a no-op here (tree already clean, tests green),
or (b) applicable only if the orchestrator checks out a tree that contains `4e6d2ef`
(e.g. `main`). The PRP must branch on a precondition probe — see PRP Task 1.

This is reported, not "fixed by me": I am a research agent and have not modified
any source file. The finding is purely observational.

## 1. Current `getLogger()` body on HEAD `fd7352c` (src/utils/logger.ts:437-467)

```ts
export function getLogger(context: string, options?: LoggerConfig): Logger {
  // Check cache first
  const cacheKey = getCacheKey(context, options);
  const cached = loggerCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // Auto-generate correlation ID if not provided
  const correlationId = options?.correlationId || generateCorrelationId();

  // Create new logger
  const config = createLoggerConfig(options);
  const pinoLogger = syncPino({ ...config, base: { context, correlationId } });

  // Wrap with our Logger interface
  const logger = wrapPinoLogger(pinoLogger);

  // Cache the logger
  loggerCache.set(cacheKey, logger);
  globalConfig = options ?? {};

  return logger;
}
```
→ No `setMaxListeners`, no `if (!loggerCache.size)` guard. Clean.

## 2. The offending block as it exists on `main`/`4e6d2ef` (4e6d2ef:src/utils/logger.ts:445-449)

```ts
  // Prevent MaxListenersExceededWarning from pino transport workers
  // Each transport worker attaches an exit listener to process
  if (!loggerCache.size) {
    process.setMaxListeners(30);
  }
```
This block sits in `getLogger()` right after the cache-hit early-return and before
"Auto-generate correlation ID". `loggerCache` is `const loggerCache = new Map<string, Logger>()`
(line 204) — the `!loggerCache.size` guard means the cap is raised only on first logger
creation.

## 3. Why the regression breaks tests (root cause, from TEST_RESULTS.md Issue 1)

- `process.setMaxListeners` is INHERITED from `EventEmitter.prototype`, not an own
  property of `process` (`process.hasOwnProperty('setMaxListeners') === false`).
- `tests/unit/utils/progress-display.test.ts` stubs the `process` global via
  `vi.stubGlobal('process', { ...originalProcess, stdout: {...}, on: vi.fn(), off: vi.fn() })`.
  Object spread copies only ENUMERABLE OWN properties → inherited `setMaxListeners`
  is dropped.
- Constructing a `ProgressDisplay` triggers `getLogger()`, which (on `main`) calls the
  unguarded `process.setMaxListeners(30)` → `TypeError: process.setMaxListeners is not a function`.
- 14 of 44 tests fail on `main`/`4e6d2ef`; 0 fail on current HEAD.

## 4. The fix (verbatim from work-item contract #3 + TEST_RESULTS.md)

Change `process.setMaxListeners(30);` → `process.setMaxListeners?.(30);` (optional
chaining). Update the preceding comment to explain WHY:
> setMaxListeners is inherited from EventEmitter.prototype, not an own property of
> process; partial stubs via vi.stubGlobal lose it. Optional chaining keeps this safe
> in tests while preserving production behavior.

Optional chaining makes the call a no-op when `setMaxListeners` is absent (test stubs)
while preserving production behavior (real Node `process` always has it). This is a
single-character semantic change (`?.`).

## 5. Scope boundaries

- **S1 = the `?.` change + comment update ONLY.** No regression test (that is S2:
  P1.M1.T1.S2). No docs (work-item #5: "no user-facing/config/API surface change …
  the code comment update IS the documentation").
- Do NOT touch anything else in `getLogger()` or `logger.ts`.
- Do NOT modify the test file in S1 (S2 adds the regression test).

## 6. Validation (work-item contract #3)

- `npm run lint && npm run format:check && npm run typecheck` → green.
- `npx vitest run tests/unit/utils/progress-display.test.ts` → 44/44 pass.
- NOTE: on the current HEAD these are ALREADY green (bug absent). On `main`/`4e6d2ef`,
  the fix flips 14 failures → 44 pass.
