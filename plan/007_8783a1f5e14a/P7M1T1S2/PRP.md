---
name: "P7.M1.T1.S2 — Lazy logger instantiation (REQ-L2) — migrate all 31 module-scope declarations"
description: |
  Replace every top-level `const logger = getLogger('X')` in `src/` (exactly 31
  files) with a lazy, in-module memoized accessor so the logger is constructed on
  first USE, not at `import` time. Apply ONE uniform pattern across all 31 files;
  update each module's `logger.<m>(...)` call sites to `logger().<m>(...)`.
  Consumes S1's unchanged `getLogger`/`Logger` public API; does NOT touch
  `src/utils/logger.ts` (S1 owns it, parallel execution). This is subtask S2 of
  the logging workstream (PRD §9.6 / REQ-L2). S3 owns REQ-L3 (single root) and
  the <2s teardown e2e test.
---

## Goal

**Feature Goal**: Every one of the 31 modules in `src/` that today calls
`getLogger('X')` at module top-level scope instead obtains its logger **lazily**
— the underlying pino logger is constructed only on the first call that actually
logs, and never during `import`. The context-keyed `loggerCache` is preserved so
no duplicate instances are created. Existing log output, levels, redaction, and
correlation IDs are byte-for-byte unchanged.

**Deliverable**: 31 source files modified. Each receives exactly two structural
changes — (1) the import gains `type Logger`, (2) the single declaration line
becomes a memoized lazy accessor `const logger = (): Logger => (_logger ??= getLogger('X'))`
— plus its ~N `logger.<m>(...)` call sites rewritten to `logger().<m>(...)`
(238 call sites in total). No change to `src/utils/logger.ts`. No new
user-facing/config/API surface. A recommended grep-as-test encodes the acceptance
criterion for future regression protection.

**Success Definition**:
- `rg -n "^(export )?(const|let) \w+ = getLogger\(" src/` returns **ZERO hits**
  (the REQ-L2 acceptance gate).
- `npm run validate` (= `lint && format:check && typecheck && test:run`) passes,
  with the **100% coverage gate** (statements/branches/functions/lines) still
  green on every migrated file.
- No `logger.child(...)` or call-site behavioural change — all 33+ test files
  that `vi.mock` the logger still pass without test edits (mocks are migration-
  safe; verified in `research/verified_facts.md` §4).
- `npm run build` succeeds; `node ./dist/index.js --help` returns promptly with
  no multi-second exit stall (full <2s timing assertion is S3's deliverable;
  S2 only needs a healthy build + no regression).

## User Persona (if applicable)

**Target User**: Contributors / maintainers of the hacky-hack CLI, and every
end-user invoking `hack --help`, `--version`, validation, or a full run.

**Use Case**: Fast, stall-free CLI teardown. After S1 removes the per-logger
worker thread, the remaining REQ-L2 win is that trivial code paths (`--help`,
`-h`, `--version`, invalid flags, validation, dry-run) construct **zero**
loggers at all — they never import-side-effect a logger they won't use.

**User Journey**: `hack --help` → Commander parses args → prints help →
`process.exit(0)` — no `getLogger(...)` call ever executes, so no pino instance,
no destination stream, and no exit handler is created on that path.

**Pain Points Addressed**: The residual import-time cost of constructing loggers
that a given invocation never uses (PRD §9.6.1: the stall was deterministic and
argument-independent because loggers were built at `import`).

## Why

- **Business value**: Completes the REQ-L2 half of the logging teardown fix
  (PRD §9.6.2). Together with S1 (REQ-L1, sync destinations / no workers), this
  removes the entire multi-second exit stall described in §9.6.1. S1 kills the
  per-logger worker-thread + blocking exit handler; S2 ensures trivial paths
  build no logger at all.
- **Integration with existing features**: Pure internal refactor. The public
  `getLogger`/`Logger` API is untouched (S1 keeps it stable). All 238 call sites
  keep identical semantics (`logger().info(...)` vs `logger.info(...)` — same
  object, same methods). Dependency graph (`architecture/implementation_notes.md`):
  `T1.S1 ─▶ T1.S2 ─▶ T1.S3` — S2 unblocks S3 (single root + teardown e2e test).
- **Problems solved / for whom**: For every CLI user (faster `--help`/`--version`)
  and for future contributors, who are prevented from reintroducing module-scope
  loggers by the acceptance grep + the recommended regression test.

## What

User-visible behaviour is unchanged (identical log output). The change is the
**timing** of logger construction:

1. **No `getLogger('X')` runs at module top-level scope.** The module binds a
   lazy accessor; `getLogger` is invoked only on first `logger()` call.
2. **Call sites** change from `logger.info(...)` to `logger().info(...)` — the
   extra `()` triggers the (memoized) lazy build on first use and returns the
   cached `Logger` thereafter.
3. **Context strings are preserved byte-for-byte** (e.g. `'CLI'`,
   `'BuildLogger'`, `'retry'`) so the context-keyed cache and log prefixes are
   identical.
4. **The `Logger` type is imported** in each of the 31 files (today none import
   it) to type the lazy accessor — via the inline `type` modifier so it is erased
   at runtime (no ESM import change).

### Success Criteria

- [ ] `rg -n "^(export )?(const|let) \w+ = getLogger\(" src/` → **zero hits**.
- [ ] All 31 files migrated to the uniform `??=` lazy form (or, where coverage
      forces it, the documented branch-free `.bind` form) — ONE pattern per file.
- [ ] `npm run validate` passes; 100% coverage gate green on every migrated file.
- [ ] No test file edited for behaviour (only optional coverage/regression additions).
- [ ] `npm run build` succeeds; `node ./dist/index.js --help` exits promptly.

## All Needed Context

### Context Completeness Check

If someone knew nothing about this codebase, would they have everything needed
to implement this successfully? **Yes.** The authoritative contract is
`architecture/implementation_notes.md §T1.S2`, the verified migration playbook
(including the safe scoped-replace command, the coverage mitigation, and the
comment/string-replace gotchas) is in `P7M1T1S2/research/`, and the full live
31-file list + call-site/test/coverage analysis is in `verified_facts.md`.

### Documentation & References

```yaml
# MUST READ — authoritative, file-level contract for this exact subtask
- file: plan/007_8783a1f5e14a/architecture/implementation_notes.md
  why: "§T1.S2 is the verbatim contract — the lazy pattern, the 'apply ONE pattern
        uniformly' rule, the cache-preservation requirement, the acceptance grep,
        and the full 31-file list (with the note that line numbers may drift after
        S1 edits logger.ts — re-grep)."
  section: "T1 — Logging Architecture → T1.S2 — Lazy logger instantiation (REQ-L2)"
  critical: "Re-run the acceptance grep on the LIVE repo before migrating; line
             numbers drift. Preserve each context string byte-for-byte. Do NOT
             touch src/utils/logger.ts (S1 owns it)."

# MUST READ — the migration playbook (safe replace command, coverage mitigation)
- file: plan/007_8783a1f5e14a/P7M1T1S2/research/migration_strategy.md
  why: "The exact perl one-liner that replaces call sites WITHOUT corrupting
        JSDoc examples or the 'logger.test.ts' string; the per-file import +
        declaration edits; the coverage-hazard mitigation; the optional
        branch-free .bind fallback; the recommended regression test."
  section: "§1 pattern · §2 safe replace · §3 coverage · §4 regression test"

# MUST READ — verified facts (the live 31-file list, call-site count, test-mock
# and coverage analysis, the comment/string-replace risk inventory)
- file: plan/007_8783a1f5e14a/P7M1T1S2/research/verified_facts.md
  why: "Confirms exactly 31 sites, 238 call sites, zero .child() in scope, zero
        column-0 (module-scope) logger calls, migration-safe vi.mock patterns,
        and the 4 no-direct-test files that risk the 100% branch gate."
  section: "§1 list · §2 call sites · §3 replace risk · §4 tests · §5 coverage · §7 API"

# MUST READ — the S1 PRP (defines the getLogger/Logger API this task consumes)
- file: plan/007_8783a1f5e14a/P7M1T1S1/PRP.md
  why: "S1 lands lazy getPino() + sync destinations but KEEPS getLogger()/Logger
        byte-for-byte stable. S2 depends only on that stable signature. Reading
        S1 confirms there is no API change to absorb and that logger.ts is
        S1's territory (parallel — do not co-edit)."
  section: "Success Definition + Integration Points (NO CHANGES TO wrapPinoLogger,
            Logger interface, loggerCache, getCacheKey, clearLoggerCache, getGlobalConfig)"

# MUST READ — the PRD requirement being satisfied (binding)
- file: PRD.md
  why: "§9.6.2 REQ-L2 is the binding requirement (lazy accessor examples incl. the
        'memoized module-local function logger()' canonical form); §9.6.3 lists
        the acceptance criteria (the zero-hit grep)."
  section: "9.6 Logging Architecture → 9.6.2 REQ-L2 + 9.6.3 Acceptance Criteria"

# REFERENCE — pino child/cache semantics (confirm no caller-facing change)
- url: https://github.com/pinojs/pino/blob/main/docs/api.md
  why: "Confirms getLogger's context-keyed cache semantics: identical context +
        options returns the same instance, so an in-module memo and getLogger's
        own cache are consistent (no duplicate destinations)."
```

### Current Codebase tree (relevant slice)

```bash
src/
  utils/
    logger.ts                 # S1 territory — DO NOT EDIT (parallel). getLogger/Logger stable.
  # ── the 31 files to migrate (each: import + declaration + N call sites) ──
  cli/index.ts                # 'CLI'         (~33 call sites)  stall-critical
  cli/commands/inspect.ts     # 'InspectCommand'
  cli/commands/cache.ts       # 'CacheCommand'  ← NO direct unit test
  cli/commands/validate-state.ts
  cli/commands/artifacts.ts
  core/tasks-json-recovery.ts # 'tasks-json-recovery'
  core/state-validator.ts     # 'StateValidator' ← NO direct unit test
  core/dependency-validator.ts
  core/session-utils.ts
  core/task-patcher.ts
  agents/agent-factory.ts     # 'AgentFactory'
  utils/build-logger.ts       # 'BuildLogger'
  utils/git-commit.ts         # 'smartCommit'
  utils/retry.ts              # 'retry'        (decl near line 556; 4 call sites)
  utils/console-log-verifier.ts
  utils/...verifier|runner|parser|reporter|updater|reader|executor.ts   # (remaining verifiers/runners)
tests/
  unit/utils/lazy-logger.test.ts   # ← NEW (recommended): grep-as-test encoding REQ-L2
  unit/**  +  integration/**        # 33+ files vi.mock the logger — run unchanged
plan/007_8783a1f5e14a/P7M1T1S2/research/{verified_facts,migration_strategy}.md
```

### Desired Codebase tree with files added/changed

```bash
# 31 files MODIFIED (declaration → lazy; import gains `type Logger`; call sites → logger().x):
src/cli/index.ts  src/cli/commands/{inspect,cache,validate-state,artifacts}.ts
src/core/{tasks-json-recovery,state-validator,dependency-validator,session-utils,task-patcher}.ts
src/agents/agent-factory.ts
src/utils/{build-logger,git-commit,retry,console-log-verifier,cli-options-verifier,
           cli-help-executor,console-log-verifier,eslint-error-verifier,eslint-result-parser,
           full-test-suite-runner,high-priority-warning-verifier,issue-resolution-verifier,
           memory-comparison-reporter,package-json-{reader,updater,syntax-verifier},
           pass-rate-analyzer,prd-validation-executor,single-test-runner,
           startup-error-verifier,validation-report-verifier}.ts
tests/unit/utils/lazy-logger.test.ts   # NEW (recommended regression guard)
# src/utils/logger.ts  → UNCHANGED (S1 owns)
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — Do NOT touch src/utils/logger.ts. S1 edits it in parallel and keeps
// getLogger()/Logger stable. Adding a lazy helper there would conflict with S1.
// The lazy memo MUST live in each consuming module.

// CRITICAL — Preserve the context string byte-for-byte. The lazy form must call
// getLogger('CLI') — NOT getLogger('Cli') or getLogger('cli'). The context is the
// loggerCache key AND the log prefix; drifting it creates a DUPLICATE logger
// (violates "no duplicate instances") and changes log output.

// CRITICAL — Blind `s/logger./logger()./g` CORRUPTS the repo. It would rewrite
// JSDoc examples (tasks-json-recovery.ts:26, dependency-validator.ts:382) and the
// STRING 'logger.test.ts' (single-test-runner.ts:203,207) into 'logger().test.ts'.
// Use the SCOPED perl replace (skips comment lines; matches only logger.METHOD():
//   perl -i -pe 's/\blogger\.(trace|debug|info|warn|error|fatal)\s*\(/logger().$1(/ unless /^\s*(\/\/|\*|\/\*)/' FILE
// ) then run typecheck + test:run as the safety net.

// CRITICAL — 100% BRANCH coverage gate (vitest.config.ts, coverage.include=['src/**/*.ts']).
// `(_logger ??= getLogger('X'))` adds a 2-outcome branch (assign vs memoized) PER
// FILE. The memoized outcome is hit only when a module's logging path runs ≥2x.
// 4 of the 31 files have NO direct unit test (cache.ts, state-validator.ts,
// pass-rate-analyzer.ts, eslint-result-parser.ts) — verify their branch coverage
// after migration; add a tiny test if the memoized branch is unhit. (See §3 of
// migration_strategy.md; branch-free .bind fallback documented as last resort.)

// GOTCHA — None of the 31 files currently import the `Logger` type. Add it inline:
//   import { getLogger, type Logger } from '<rel>/utils/logger.js';
// The `type` modifier erases it at runtime (no ESM runtime change).

// GOTCHA — logger.child(...) is used in ZERO of the 31 files (verified). No
// chaining/return-type concern. (The only repo-wide .child() is in
// metrics-collector.ts on a different local logger — leave it alone.)

// GOTCHA — Tests are migration-SAFE (verified): 33+ test files vi.mock getLogger
// with either a stable hoisted object or a per-call factory; BOTH still work
// because logger() still calls the mocked getLogger on first use and caches it.
// NO test asserts getLogger was called → deferred timing breaks nothing.

// GOTCHA — Do NOT change call-site semantics. logger().error('x', {a:1}) must pass
// the SAME args as logger.error('x', {a:1}). The replace must only insert `()`
// after `logger`, never reflow arguments.

// GOTCHA — prettier may want to reformat the new arrow line. Run `npm run format`
// if `npm run format:check` complains (do NOT silence with eslint-disable).
```

## Implementation Blueprint

### Data models and structure

No data-model changes. The only new per-module shape is the lazy memo pair:

```ts
// Module-local, memoized. Replaces `const logger = getLogger('Foo');`
import { getLogger, type Logger } from '<rel>/utils/logger.js';

let _logger: Logger | undefined;
const logger = (): Logger => (_logger ??= getLogger('Foo'));
//                                       ^^^ exact existing context string
```

`getLogger`'s public signature is unchanged (S1): `(context: string, options?: LoggerConfig) => Logger`.
The `Logger` interface, `wrapPinoLogger`, `loggerCache`, `getCacheKey`,
`clearLoggerCache`, `getGlobalConfig`, redaction, and levels are all untouched.

> Branch-free alternative (use ONLY if a file's 100% branch coverage can't be met):
> `const logger = getLogger.bind(null, 'Foo') as () => Logger;` then `logger().x`.
> Calls getLogger each time (cheap cache hit); adds ZERO per-file branches. Not
> the contract's literal `??=` form — documented fallback only.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: RE-GREP the live 31-file list (line numbers drift after S1)
  - RUN: rg -n "^(export )?(const|let) \w+ = getLogger\(" src/
  - CAPTURE: the exact files + context strings (the list in verified_facts.md §1
            is the baseline; reconcile any drift from S1's logger.ts edits).
  - ASSERT: exactly 31 hits BEFORE migration; ZERO hits AFTER.
  - DEPENDENCY: run before Task 1; this is the source of truth, not line numbers.

Task 1: MIGRATE the declaration + import in EACH of the 31 files (manual edit tool)
  - EDIT the import line: `import { getLogger }` → `import { getLogger, type Logger }`
            (same module path; inline `type` modifier — runtime-erased).
  - REPLACE the single declaration `const logger = getLogger('<CTX>');` with:
            let _logger: Logger | undefined;
            const logger = (): Logger => (_logger ??= getLogger('<CTX>'));
            where '<CTX>' is the file's EXACT existing context string.
  - NAMING: `_logger` (module-local memo), `logger` (the accessor — keep the SAME
            name so the rest of the file's identifiers are unaffected).
  - UNIQUENESS: each declaration's context string differs per file, so the
            `oldText` for the edit is unique within its file.
  - DO NOT touch logger.ts; do NOT change the context string; do NOT add options.
  - DEPENDENCY: Task 0.

Task 2: REWRITE call sites `logger.<m>(` → `logger().<m>(` in all 31 files
  - APPLY the SCOPED perl replace per file (see Known Gotchas / migration_strategy §2):
            perl -i -pe 's/\blogger\.(trace|debug|info|warn|error|fatal)\s*\(/logger().$1(/ unless /^\s*(\/\/|\*|\/\*)/' FILE
  - SCOPE: matches only logger.METHOD( on non-comment lines → skips JSDoc examples
            and the 'logger.test.ts' string. 238 call sites converted.
  - VERIFY per file: rg -n "\blogger\.(trace|debug|info|warn|error|fatal)" FILE
            must show ONLY comment-line survivors (no real code sites left).
  - DEPENDENCY: Task 1 (the accessor `logger` must exist before call sites call it).

Task 3: FULL validation gate
  - RUN: npm run validate     # = lint && format:check && typecheck && test:run
  - RUN: npm run test:coverage  # inspect per-file BRANCH % on all 31 files
  - RUN (acceptance): rg -n "^(export )?(const|let) \w+ = getLogger\(" src/  → ZERO hits
  - DEPENDENCY: Tasks 1–2.

Task 4: COVERAGE remediation (CONDITIONAL — only if Task 3 shows <100% branches)
  - FOR each migrated file below 100% branches: the `??=` memoized outcome was
            not hit. Ensure a logging path in that module runs ≥2× in tests.
  - FILES most at risk (no direct unit test, transitive coverage only):
            src/cli/commands/cache.ts, src/core/state-validator.ts,
            src/utils/pass-rate-analyzer.ts, src/utils/eslint-result-parser.ts.
  - FIX: add a focused test that imports the module and invokes an exported
            logging function TWICE (hits both `??=` outcomes). Or, for a stubborn
            file, switch that ONE file to the branch-free .bind fallback (§1).
  - RE-RUN: npm run test:coverage until 100% on every migrated file.
  - DEPENDENCY: Task 3.

Task 5 (RECOMMENDED): ADD the REQ-L2 regression-guard test
  - CREATE tests/unit/utils/lazy-logger.test.ts (grep-as-test, ~15 lines — see
            migration_strategy.md §4) that runs the acceptance grep and asserts
            zero hits. Encode the PRD §9.6.3 acceptance criterion for CI.
  - DEPENDENCY: Task 3 (add last so the gate is green when it lands).

Task 6: BUILD + quick teardown sanity (S3 owns the <2s e2e, but sanity-check now)
  - RUN: npm run build
  - RUN: node ./dist/index.js --help  ; node ./dist/index.js --version
  - EXPECT: prompt return, no multi-second exit stall. (S3 lands the authoritative
            timing assertion + syscall trace; S2 only confirms no regression.)
  - DEPENDENCY: Task 3.
```

### Implementation Patterns & Key Details

```ts
// ── BEFORE (module top-level — FORBIDDEN by REQ-L2) ────────────────────────
import { getLogger } from '../utils/logger.js';
const logger = getLogger('BuildLogger');
export async function documentBuildSuccess() {
  logger.info('Build succeeded');
}

// ── AFTER (lazy — constructed on first call, memoized) ─────────────────────
import { getLogger, type Logger } from '../utils/logger.js';
let _logger: Logger | undefined;
const logger = (): Logger => (_logger ??= getLogger('BuildLogger'));
export async function documentBuildSuccess() {
  logger().info('Build succeeded');   // first call builds; later calls reuse cache
}

// ── Multi-arg / object form is unchanged (only `()` is inserted) ───────────
// BEFORE:  logger.error('Inspect command failed: %s', msg, { cause });
// AFTER :  logger().error('Inspect command failed: %s', msg, { cause });

// ── The branch-free fallback (ONLY if 100% branch coverage can't be met) ───
// import { getLogger } from '../utils/logger.js';
// const logger = getLogger.bind(null, 'BuildLogger') as () => Logger;
//   // logger().info(...) — getLogger called each time (cache hit); zero branches.
```

### Integration Points

```yaml
IMPORTS (each of 31 files):
  - change: `import { getLogger } from '<rel>/utils/logger.js';`
        →  `import { getLogger, type Logger } from '<rel>/utils/logger.js';`
  - pattern: inline `type` modifier (runtime-erased; no ESM behavior change).

DECLARATIONS (each of 31 files):
  - replace: `const logger = getLogger('<CTX>');`
        →  `let _logger: Logger | undefined;\nconst logger = (): Logger => (_logger ??= getLogger('<CTX>'));`
  - invariant: '<CTX>' byte-for-byte identical to today (cache key + log prefix).

CALL SITES (238 total across 31 files):
  - replace: `logger.<m>(` → `logger().<m>(`  (m ∈ trace|debug|info|warn|error|fatal)
  - tool: scoped perl one-liner (skips comment lines; see Known Gotchas).

TESTS:
  - none required for behaviour (mocks are migration-safe).
  - optional: tests/unit/utils/lazy-logger.test.ts (REQ-L2 grep regression guard).
  - conditional: tiny coverage tests for the 4 no-direct-test files IF branch <100%.

NO CHANGES TO:
  - src/utils/logger.ts (S1 — parallel)
  - getLogger / Logger / LoggerConfig / wrapPinoLogger / loggerCache / getCacheKey
  - src/utils/metrics-collector.ts (different local logger; not one of the 31)
  - src/tools/*-mcp.ts (MCP transports)
  - PRD.md, tasks.json, prd_snapshot.md, .gitignore (READ-ONLY)
```

## Validation Loop

> Run after the relevant task group. Fix before proceeding to the next level.

### Level 1: Syntax & Style (after Tasks 1–2)

```bash
# Type-check (NodeNext, strict). Must be zero errors — catches any malformed edit.
npm run typecheck

# Lint (eslint .ts). Must be zero errors.
npm run lint

# Format check. Run `npm run format` to fix if it complains.
npm run format:check
```
Expected: all three pass. typecheck is the primary catcher of a botched call-site
edit (e.g. a stray `logger()` in a comment that breaks syntax — though the scoped
perl avoids comments entirely).

### Level 2: Unit + Coverage (after Task 3 / Task 4)

```bash
# Full suite (33+ logger-mocking test files exercise behaviour end-to-end).
npm run test:run

# Coverage — INSPECT the per-file branch column for all 31 migrated files.
npm run test:coverage
# Expect: statements/branches/functions/lines = 100% global, AND each of the 31
# files at 100% branches (the `??=` memoized outcome must be hit everywhere).
```
Expected: all tests pass; 100% coverage. If a migrated file shows <100% branches,
the memoized outcome wasn't exercised → Task 4 (add a 2× logging invocation or
switch that file to the `.bind` fallback).

### Level 3: Acceptance grep (the REQ-L2 gate)

```bash
# PRIMARY ACCEPTANCE — must return ZERO hits (rg exits 1 on no match).
rg -n "^(export )?(const|let) \w+ = getLogger\(" src/
# Expected: <no output>, exit code 1.

# Confirm no stray module-scope getLogger variants were introduced.
rg -n "getLogger\(" src/ | rg -v "logger\(\)\s*$|^\s*//|^\s*\*|function getLogger|// .*getLogger"
```
Expected: the first grep returns zero hits; the second shows only lazy `logger()`
internals (the `??= getLogger('X')` inside the accessor) and comments — no bare
top-level `const/let X = getLogger(`.

### Level 4: Build + teardown sanity (S3 owns the authoritative e2e)

```bash
npm run build
node ./dist/index.js --help        # prompt return, no ~10s stall
node ./dist/index.js --version
node ./dist/index.js --bogus-flag  # exits 1 promptly
```
Expected: build succeeds; `--help`/`--version`/invalid-flag return promptly with
no multi-second exit stall. (The binding <2s timing assertion + syscall trace is
S3's deliverable; S2 confirms no regression only.)

## Final Validation Checklist

### Technical Validation
- [ ] Level 1: `npm run typecheck`, `npm run lint`, `npm run format:check` pass.
- [ ] Level 2: `npm run test:run` passes; `npm run test:coverage` shows 100%
      branches on every one of the 31 migrated files.
- [ ] Level 3: `rg -n "^(export )?(const|let) \w+ = getLogger\(" src/` → **zero hits**.
- [ ] Level 4: `npm run build` succeeds; `--help`/`--version` exit promptly.

### Feature Validation
- [ ] All 31 module-scope `getLogger()` declarations migrated to lazy accessors.
- [ ] ONE uniform pattern applied across all 31 files (the `??=` form, or the
      documented `.bind` fallback only where coverage forced it).
- [ ] Every context string preserved byte-for-byte (no duplicate loggers, no
      changed log prefixes).
- [ ] All 238 call sites rewritten `logger.<m>(` → `logger().<m>(` with args intact.
- [ ] No comment/JSDoc/string corrupted by the replace (verify the perl scope held).
- [ ] 33+ logger-mocking tests pass without behavioural test edits.

### Code Quality Validation
- [ ] `Logger` imported via inline `type` modifier in each of the 31 files.
- [ ] `_logger` is module-local (not exported); `logger` keeps its prior name.
- [ ] No edit to `src/utils/logger.ts` (S1 territory).
- [ ] No `eslint-disable` silencing added; prettier-clean.

### Documentation
- [ ] No user-facing/config/API docs to change (contract point 5: DOCS = none).
- [ ] (Recommended) `tests/unit/utils/lazy-logger.test.ts` encodes REQ-L2 for CI.
- [ ] PRP execution summary notes any file switched to the `.bind` fallback + why.

---

## Anti-Patterns to Avoid

- ❌ Don't run a blind `s/logger./logger()./g` — it corrupts JSDoc examples
  (`tasks-json-recovery.ts:26`, `dependency-validator.ts:382`) and the string
  `'logger.test.ts'` (`single-test-runner.ts:203`). Use the scoped perl replace.
- ❌ Don't change the context string (`'CLI'`→`'cli'`) — breaks the cache contract
  and changes log output; creates a duplicate logger.
- ❌ Don't edit `src/utils/logger.ts` — S1 owns it (parallel); its public API is
  stable and that's all S2 needs.
- ❌ Don't touch `src/utils/metrics-collector.ts` `logger.child(...)` — different
  local logger, not one of the 31.
- ❌ Don't reflow call-site arguments — only insert `()` after `logger`.
- ❌ Don't ship with <100% branch coverage on a migrated file — the `??=` memoized
  outcome MUST be exercised (add a test or use the `.bind` fallback).
- ❌ Don't apply two different patterns to different files "just because" — the
  contract requires ONE uniform pattern. (`.bind` is a documented last-resort
  fallback for an individual coverage-blocked file, not a free choice.)
- ❌ Don't add `logger.flush()` / teardown calls — sync destinations (S1) need none.
- ❌ Don't modify PRD.md, tasks.json, prd_snapshot.md, or .gitignore (READ-ONLY).
