# Research — P1.M1.T1.S1 (reorder main(): local early-returns before preflight)

Bugfix 002 Issue 1 (TEST_RESULTS.md §h3.2): the auth preflight blocks two
pure-local CLI modes (`--dry-run`, `--validate-prd`) that make zero API calls.

## 1. Current `main()` ordering in `src/index.ts` (as-built, lines 99–209)

```
parseCLIArgs()                        # --help/-h/--version/inspect short-circuit + process.exit() HERE
  → (if subcommand) return 0          # type guard only; never reached
const args: ValidatedCLIArgs
setupGlobalHandlers(args.verbose)
configureEnvironment()
await runAuthPreflight()              # ← Issue 1: blocks local modes with no cred
await ensureHarnessInitialized()
const logger = getLogger('App', { verbose, machineReadable })
if (args.verbose) { logger.debug(...) }
if (args.dryRun) { logger.info(...); return 0; }
if (args.validatePrd) { ...PRDValidator...; return result.valid ? 0 : 1; }
const scope = args.scope ? parseScope(args.scope) : undefined
const pipeline = new PRPPipeline(args.prd, ...)
const result = await pipeline.run()
... (result handling: shutdown/fail/success) ...
```

## 2. Target ordering (bugfix PRD §h3.2 "Suggested fix" + system_context.md §4)

```
parseCLIArgs() ... const args ...
setupGlobalHandlers(args.verbose)
configureEnvironment()
const logger = getLogger('App', { verbose, machineReadable })   # ← moved UP (independent of creds/harness)
if (args.verbose) { logger.debug(...) }                          # keep verbose block with logger
if (args.dryRun)    { logger.info(...); return 0; }              # credential-free
if (args.validatePrd){ ...PRDValidator...; return result.valid ? 0 : 1; }   # credential-free
await runAuthPreflight()                                         # agent paths only
await ensureHarnessInitialized()
... new PRPPipeline(...) ...
```

## 3. EXACT lines to move (byte-for-byte body preservation required)

The bodies that must be relocated WITHOUT any change to their contents:
- **Logger creation** (currently src/index.ts:130–133):
  ```ts
  const logger: Logger = getLogger('App', {
    verbose: args.verbose,
    machineReadable: args.machineReadable,
  });
  ```
- **Verbose block** (currently src/index.ts:136–139):
  ```ts
  if (args.verbose) {
    logger.debug('Verbose mode enabled');
    logger.debug('Parsed CLI arguments:', args);
  }
  ```
- **dry-run block** (currently src/index.ts:142–152): unchanged body, returns 0.
- **validate-prd block** (currently src/index.ts:155–198): unchanged body, returns 0/1.

The **preflight + harness init** lines move DOWN past the early-returns:
- `await runAuthPreflight();`
- `await ensureHarnessInitialized();`

Only POSITION changes; no body/return-value/logic edits. The verbose block should travel
with the logger (it depends on `logger`), so it sits between logger creation and dry-run.

## 4. Verified contract facts

- `parseCLIArgs()` (src/cli/index.ts) calls `process.exit()` for `--help`/`-h`/`--version`/`-V`/
  unknown-flag/`inspect` BEFORE `main()`'s body — so they are unaffected by this reorder.
  (system_context.md §2 confirms: "help/version exit inside `parseCLIArgs()` before `main()`'s
  body runs".)
- `PRDValidator` (src/utils/prd-validator.ts:27–30) imports ONLY `prd-differ`, `session-utils`,
  `node:path`, `node:fs/promises` — no agent/harness/model/prompt. It is purely local. Do NOT
  modify it.
- `ValidatedCLIArgs` fields: `dryRun` (cli/index.ts:76), `validatePrd` (:94), `verbose` (:82),
  `machineReadable` (:85) — all present and unchanged.
- `getLogger` + `type Logger` imported at src/index.ts:47 — unchanged.
- `Logger` type annotation used on the moved line (src/index.ts:131: `const logger: Logger =`).
- Entry point: `void main().catch(...)` (src/index.ts:312) has a clean handler ONLY for
  `AuthPreflightError`. This subtask does NOT touch that handler (P1.M1.T2.S2 extends it for
  `HarnessProviderMismatchError`).

## 5. Why moving `getLogger` up is safe (PRD §9.6.2 REQ-L2 compliance)

- REQ-L2 requires loggers be lazy — NO module-top-level `getLogger()`. The §9.6.3 acceptance
  grep `rg "^(export )?(const|let) \w+ = getLogger\(" src/` → 0 hits (verified in §h3.1 table).
- The root logger being moved lives INSIDE `main()` (function scope), NOT at module top-level.
  Moving it earlier within `main()` does not change that — it is still not a module-scope
  declaration. REQ-L2 is preserved.
- The logger is independent of credentials/harness: `getLogger('App', {verbose, machineReadable})`
  reads only args; no env/SDK dependency. Safe to run before preflight.

## 6. Why this does NOT regress §9.6.3 --help timing

`--help`/`-h`/`--version` exit inside `parseCLIArgs()` BEFORE `main()`'s body executes, so the
reorder (which only touches lines after `parseCLIArgs()`) is invisible to those modes. The
verified ~560 ms timing is unaffected.

## 7. Scope boundaries

- **S1 = reorder + JSDoc update ONLY.** No new tests here (S2 = subprocess acceptance tests).
  No `agent-factory.ts` changes (P1.M1.T2.S1/S2 = the harness-error work). No docs files
  (P1.M1.T3 = separate docs subtask).
- The contract states: "Do NOT change `runAuthPreflight`/`ensureHarnessInitialized`/
  `PRDValidator`/`parseCLIArgs`." Only `main()`'s internal ordering + its JSDoc.
- P1.M1.T2.S2 will later insert an explicit `configureHarness()` call into the gap BETWEEN the
  early-returns and `runAuthPreflight()` — so leave that gap clean (no stray code).

## 8. Validation

- `npm run typecheck` (or `npx tsc --noEmit -p tsconfig.build.json`) → clean. A pure reorder
  cannot introduce type errors, but the move of the logger+verbose blocks must not orphan any
  binding (it doesn't — they are self-contained).
- `npm run lint && npm run format:check` → clean.
- No unit test directly asserts the `main()` internal ordering today (grep: the existing
  `auth-preflight.test.ts` tests the preflight function, not main's sequencing). S2 adds the
  real acceptance tests. So S1's own validation is the static gates + a manual smoke check:
  `env -u <auth vars> ... node dist/index.js --prd PRD.md --validate-prd` → exit 0 (requires
  `npm run build` first; see PRP Level 3).
- Do NOT run the full `npm run test:run` — it has 212 PRE-EXISTING failures unrelated to this
  delta (TEST_RESULTS.md §h3.1 note). The S1 gate is typecheck + lint + format + the targeted
  smoke checks.
