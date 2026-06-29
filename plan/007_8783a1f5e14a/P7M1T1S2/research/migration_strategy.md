# Migration Strategy — P7.M1.T1.S2 (Lazy logger instantiation, REQ-L2)

## 1. The ONE uniform pattern (contract-mandated)

Work-item contract point 3 specifies this exact form. Apply it to all 31 files
with NO variation:

```ts
// ── BEFORE ──────────────────────────────────────────────
import { getLogger } from '../utils/logger.js';
// ...
const logger = getLogger('Foo');
// ... logger.info('hi');  logger.error('boom', { x: 1 });

// ── AFTER ───────────────────────────────────────────────
import { getLogger, type Logger } from '../utils/logger.js';   // add `type Logger`
// ...
let _logger: Logger | undefined;
const logger = (): Logger => (_logger ??= getLogger('Foo'));    // lazy, memoized in-module
// ... logger().info('hi');  logger().error('boom', { x: 1 });  // call sites gain `()`
```

Why this satisfies REQ-L2:
- `getLogger('Foo')` is NOT executed at module-eval time (only the arrow fn is
  bound). The logger is constructed on the first `logger()` call.
- The in-module `_logger` memo means `getLogger` is called at most once per
  module; combined with getLogger's context-keyed cache, no duplicate instances.

Required changes per file (exactly two):
1. Import: add `type Logger` to the existing `import { getLogger }` (inline
   `type` modifier keeps it erased at runtime — no ESM import change).
2. Declaration: replace the single `const logger = getLogger('X')` line with the
   two-line lazy form (`let _logger...` + `const logger = () => ...`). Keep the
   SAME context string `'X'` byte-for-byte (cache key must not drift).
3. Call sites: every `logger.<method>(` → `logger().<method>(` (see §2).

> ALTERNATIVE (branch-free, only if coverage proves fragile — see §3):
> `const logger = getLogger.bind(null, 'Foo') as () => Logger;` then `logger().x`.
> This calls getLogger on every `logger()` (cheap cache lookup) and adds ZERO
> per-file branches. It deviates from the contract's literal `??=` form, so use
> ONLY as a documented fallback. Primary form = `??=` above.

## 2. Safe mechanical call-site replacement

238 call sites total. DO NOT run a blind `s/logger./logger()./g` — it corrupts
JSDoc examples and the string `'logger.test.ts'` (see `verified_facts.md` §3).

Safe scoped replace (per file) — matches ONLY real method calls with `(` on
NON-comment lines:

```bash
# Replace logger.METHOD( -> logger().METHOD( , skipping comment/docstring lines.
perl -i -pe 's/\blogger\.(trace|debug|info|warn|error|fatal)\s*\(/logger().$1(/ unless /^\s*(\/\/|\*|\/\*)/' FILE
```

Why it is safe for THIS codebase:
- `unless /^\s*(\/\/|\*|\/\*)/` skips every full-line `//`, `* ` (JSDoc), and
  `/*` comment — the verified comment occurrences (`tasks-json-recovery.ts:26`,
  `dependency-validator.ts:382`, etc.) all start with `*` → untouched. ✓
- The method alternation `(trace|debug|info|warn|error|fatal)` excludes
  `logger.test.ts` (string literal — `.test` not in list) and the declaration
  line (`const logger = getLogger` — no `logger.METHOD(`). ✓
- Trailing `\s*\(` requires an actual call → a bare `logger.error` reference
  (none observed) would be skipped rather than guessed at.

Recommended loop (idempotent; run from repo root):

```bash
FILES="src/cli/index.ts src/cli/commands/inspect.ts src/cli/commands/cache.ts \
src/cli/commands/validate-state.ts src/cli/commands/artifacts.ts \
src/core/tasks-json-recovery.ts src/core/state-validator.ts \
src/agents/agent-factory.ts src/core/session-utils.ts src/utils/git-commit.ts \
src/utils/pass-rate-analyzer.ts src/utils/validation-report-verifier.ts \
src/utils/issue-resolution-verifier.ts src/utils/cli-options-verifier.ts \
src/utils/high-priority-warning-verifier.ts src/utils/startup-error-verifier.ts \
src/utils/build-logger.ts src/utils/eslint-error-verifier.ts \
src/core/dependency-validator.ts src/utils/eslint-result-parser.ts \
src/utils/memory-comparison-reporter.ts src/core/task-patcher.ts \
src/utils/package-json-reader.ts src/utils/full-test-suite-runner.ts \
src/utils/package-json-updater.ts src/utils/prd-validation-executor.ts \
src/utils/package-json-syntax-verifier.ts src/utils/cli-help-executor.ts \
src/utils/console-log-verifier.ts src/utils/retry.ts src/utils/single-test-runner.ts"

for f in $FILES; do
  perl -i -pe 's/\blogger\.(trace|debug|info|warn|error|fatal)\s*\(/logger().$1(/ unless /^\s*(\/\/|\*|\/\*)/' "$f"
done
```

Then handle the two NON-mechanical edits per file manually (the import line and
the declaration line) with the `edit` tool — these must be exact and unique per
file (the declaration's context string differs per file, making oldText unique).

**Post-replace verification per file:**
```bash
# Should show ONLY comment/string survivors (no real code logger.METHOD calls).
rg -n "\blogger\.(trace|debug|info|warn|error|fatal)" FILE
# And the new form should be present:
rg -n "logger\(\)\." FILE | head
```
Ultimate safety net: `npm run typecheck` (no broken code) + `npm run test:run`
(any corrupted string path like `'logger().test.ts'` would fail the test that
uses it).

## 3. Coverage hazard mitigation (#1 risk to one-pass success)

The `??=` form adds a 2-outcome branch per file. `vitest.config.ts` enforces
100% branches globally (`coverage.include: ['src/**/*.ts']`, `all` defaults true).

After migration, run:
```bash
npm run test:coverage   # or: npx vitest run --coverage
```
Inspect the per-file branch column. For ANY migrated file below 100% branches,
the memoized outcome (second `logger()` call returning the cached value) was not
hit. Fix by ensuring a logging path runs ≥2 times for that module:

- **Files with a direct unit test (27):** almost always already hit both outcomes
  (multiple `it` blocks). If one doesn't, add a second logging invocation to an
  existing test (no new file needed).
- **Files with NO direct unit test (4):** `src/cli/commands/cache.ts`,
  `src/core/state-validator.ts`, `src/utils/pass-rate-analyzer.ts`,
  `src/utils/eslint-result-parser.ts`. These are covered only transitively.
  If their memoized branch is unhit, add a tiny focused test per file that
  imports the module and invokes an exported function that logs TWICE, e.g.:
  ```ts
  // tests/unit/<dir>/<file>.lazy-logger.test.ts
  import { vi } from 'vitest';
  vi.mock('../../src/utils/logger.js', () => ({ getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn(), fatal: vi.fn(), child: vi.fn() }) }));
  // call the module's exported fn twice to hit both ??= outcomes
  ```
  (Only add if coverage actually drops — verify first, don't pre-emptively add.)

If coverage remains stubbornly <100% on a file, switch THAT file to the
branch-free `.bind` alternative (§1 note) and re-check.

## 4. Regression guard (recommended, optional)

Encode the REQ-L2 acceptance criterion as a test so future regressions are
caught by CI. A grep-as-test in `tests/unit/utils/lazy-logger.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';

describe('REQ-L2 — no module-scope getLogger() declarations', () => {
  it('src/ has zero top-level `const/let X = getLogger(` bindings', () => {
    // The exact acceptance grep from the PRD/work-item contract.
    let out = '';
    try {
      out = execSync(
        `rg -n "^(export )?(const|let) \\w+ = getLogger\\(" src/`,
        { encoding: 'utf-8' },
      );
    } catch (e: any) {
      // rg exits 1 on no matches — that is the PASS condition.
      expect(e.status).toBe(1);
      return;
    }
    throw new Error(`REQ-L2 violated — module-scope getLogger found:\n${out}`);
  });
});
```
(Keep it; it directly encodes the acceptance gate and costs ~0.5s.)

## 5. Out of scope (DO NOT TOUCH)

- `src/utils/logger.ts` — owned by S1 (parallel). S2 consumes `getLogger`/`Logger`
  unchanged. Do NOT add a lazy helper to logger.ts (would conflict with S1).
- `src/utils/metrics-collector.ts` `logger.child(...)` — not one of the 31; its
  `logger` is a different (local) binding. Leave it.
- `src/tools/*-mcp.ts` — MCP transports, unrelated to logging.
- Any `transport:` keys — that's REQ-L1 (S1), already handled.
- S3's teardown/timing e2e test and the single-root (REQ-L3) refactor.
- PRD.md, tasks.json, prd_snapshot.md, .gitignore (READ-ONLY).
