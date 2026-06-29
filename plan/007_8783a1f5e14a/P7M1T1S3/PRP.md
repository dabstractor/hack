---
name: "P7.M1.T1.S3 — Single root logger per process (REQ-L3) + teardown validation tests"
description: |
  Bound the process to ONE synchronous destination stream per output mode (and zero worker
  threads) by deriving every component logger as a `.child()` of a single process-wide root
  pino (per mode), instead of each `getLogger()` constructing an independent `pino(...)`.
  Then add the authoritative teardown-validation test suite
  (`tests/unit/utils/logger-teardown.test.ts`) that proves (a) only one destination is built
  per mode regardless of how many loggers are requested, (b) getLogger() adds ZERO
  process-exit/beforeExit listeners (⇒ no ThreadStream/worker — the worker_threads.Worker
  spy is INOPERATIVE here and is deliberately NOT used), and (c) the built CLI
  (`node ./dist/index.js --help`, `-h`, `--version`, invalid flag) each finish < 2s wall.
  Consumes S1's lazy/sync-destination getLogger() (already landed) and S2's lazy call sites.
  This is the final subtask of the logging workstream (PRD §9.6 / REQ-L3); together S1+S2+S3
  satisfy every §9.6.3 acceptance criterion.
---

## Goal

**Feature Goal**: `getLogger(context, options)` no longer constructs an independent
`pino(...)` (with its own destination stream) per context. Instead it derives a **child**
from a single process-wide **root** pino — one root per output mode (pretty vs JSON). Each
root owns exactly ONE synchronous destination stream (`pino-pretty` Transform for the human
path; default `process.stdout` for JSON) and ZERO worker threads. N component loggers ⇒ at
most 1 destination per mode (collapsing to 1 per process in normal single-mode CLI usage),
with byte-identical log output, redaction, levels, correlation IDs, and child semantics.

**Deliverable**:
1. **`src/utils/logger.ts` (MODIFIED)** — add module-singleton roots (`_rootPretty`,
   `_rootJson`) + a `getRoot(machineReadable)` memoized accessor; rewrite `getLogger()` to
   return `getRoot(machineReadable).child({ context, correlationId }, { level: resolvedLevel })`
   wrapped via the existing `wrapPinoLogger`; extend `clearLoggerCache()` to reset the roots;
   update the `getLogger()` JSDoc to state REQ-L3 is now satisfied (single root, one sync
   stream per mode). The public `Logger` interface, `LoggerConfig`, `wrapPinoLogger`,
   `loggerCache`, `getCacheKey`, redaction, levels, and `getGlobalConfig` are unchanged.
2. **`tests/unit/utils/logger-teardown.test.ts` (NEW)** — the authoritative teardown suite:
   - single-destination proof via `vi.mock('pino-pretty')` call-counting (pretty=1 across N loggers; JSON=0),
   - no-ThreadStream proof via `process.listenerCount('exit'|'beforeExit')` delta = 0 (the worker_threads.Worker spy is inoperative — see Known Gotchas),
   - fast-exit e2e: spawn `node ./dist/index.js` for `--help`/`-h`/`--version`/invalid-flag, assert each < 2000ms.

**Success Definition** (maps to PRD §9.6.3):
- `vi.mock('pino-pretty')` call counter reports **exactly 1** construction across ≥4 distinct
  pretty `getLogger()` calls (was 4 before this subtask) and **0** for machineReadable calls.
- `process.listenerCount('exit')` and `listenerCount('beforeExit')` deltas around `getLogger()`
  are **0** (pretty + JSON + verbose paths).
- `node ./dist/index.js --help`, `-h`, `--version`, and an invalid flag each return in
  **< 2000ms** wall (target <1s excluding cold module load), with no multi-second exit stall.
- `rg -n "transport\s*:" src/utils/logger.ts` → **zero hits** (S1 invariant preserved; S3 adds none).
- `rg -n "^(export )?(const|let) \w+ = getLogger\(" src/` → **zero hits** (S2 invariant; S3 adds none).
- `npm run validate` passes; `npm run test:coverage` keeps **100%** statements/branches/functions/lines on `src/utils/logger.ts`.
- `npm run build` succeeds; the built CLI runs the four fast-exit invocations under 2s.

## User Persona (if applicable)

**Target User**: Every end-user invoking `hack` and every contributor to the hacky-hack CLI.

**Use Case**: Trivial CLI invocations (`--help`, `--version`, an invalid flag, PRD validation,
dry-run) must tear down instantly. S1 killed the per-logger worker thread; S2 made call sites
lazy; **S3 bounds the destination count to one per process** so that even a code path that
*does* build many loggers still pays for only one stream and zero workers.

**User Journey**: `hack --help` → Commander parses args in `parseCLIArgs()` → prints help →
`process.exit(0)` — and on paths that *do* log, every logger shares one in-process
`pino-pretty` Transform / one stdout, so there is nothing to flush and nothing to block exit.

**Pain Points Addressed**: The residual "N contexts ⇒ N destination streams" cost ceiling.
Even though each stream is now synchronous (S1), constructing many of them is still wasteful;
REQ-L3 caps it at one.

## Why

- **Business value**: Completes the REQ-L3 half of the logging teardown fix (PRD §9.6.2).
  Together with S1 (REQ-L1) and S2 (REQ-L2), this delivers every §9.6.3 acceptance
  criterion. This subtask also ships the **authoritative teardown test** that the whole
  workstream (S1+S2+S3) is measured against — the fast-exit e2e and the single-destination
  assertion are the regression guard that prevents the ~10s stall (PRD §9.6.1) from ever
  returning.
- **Integration with existing features**: Pure internal refactor of `src/utils/logger.ts`
  construction + one new test file. Public API is stable (S2's lazy `logger()` call sites
  and the 33+ logger-mocking test files are unaffected — verified). Dependency graph
  (`architecture/implementation_notes.md`): `T1.S1 ─▶ T1.S2 ─▶ T1.S3`; S3 is the final,
  unblocking step for the T4 documentation sweep.
- **Problems solved / for whom**: For every CLI user (guaranteed fast teardown under any
  code path) and for future contributors (the teardown test fails loudly if anyone
  reintroduces a transport, a module-scope logger, or per-logger independent destinations).

## What

User-visible behaviour is **unchanged** (identical log output, redaction, levels, prefixes,
child semantics). The change is structural:

1. **One root per output mode.** A process-wide singleton root pino is built lazily on the
   first `getLogger()` for each mode (`_rootPretty` for human/pretty, `_rootJson` for
   machine-readable). Each root owns exactly ONE destination stream and is configured ONCE
   (redaction, customLevels, timestamp, formatters, `base: {}`).
2. **Component loggers are children.** `getLogger(context, options)` returns
   `getRoot(machineReadable).child({ context, correlationId }, { level })` wrapped in the
   existing `Logger` interface. Children inherit the root's destination/config and set their
   own level independently (verified: root level does not gate children).
3. **`base: {}` on the root** preserves today's output exactly (no `pid`/`hostname`; context
   & correlationId arrive via child bindings). **Forgetting this re-introduces
   pid+hostname into every JSON line.**
4. **`clearLoggerCache()` resets the roots** so tests (and runtime reconfiguration) get fresh
   roots. The pino bundle in `getPino()` is NOT reset (the module never changes).
5. **New teardown test** proves the bounded-destination + no-worker + fast-exit guarantees.

### Success Criteria

- [ ] `vi.mock('pino-pretty')` → pretty constructed **exactly 1×** across ≥4 pretty loggers;
      **0×** for machineReadable loggers.
- [ ] `process.listenerCount('exit'|'beforeExit')` delta around `getLogger()` = **0**
      (pretty + JSON + verbose).
- [ ] Built CLI `--help`/`-h`/`--version`/invalid-flag each **< 2000ms** wall.
- [ ] `rg -n "transport\s*:" src/utils/logger.ts` → zero hits; no new module-scope `getLogger`.
- [ ] `npm run validate` passes; `src/utils/logger.ts` stays at 100% coverage.
- [ ] Public `Logger` API, cache key shape, redaction, levels, child semantics unchanged.

## All Needed Context

### Context Completeness Check

If someone knew nothing about this codebase, would they have everything needed to implement
this successfully? **Yes.** The authoritative contract is
`architecture/implementation_notes.md §T1.S3`; the test design is
`P7M1T1S3/research/test_strategy.md`; every load-bearing assumption (incl. the
worker_threads.Worker-spy is-inoperative finding) is proven in
`P7M1T1S3/research/verified_facts.md`. The only files to edit are `src/utils/logger.ts`
and the new test file.

### Documentation & References

```yaml
# MUST READ — authoritative, file-level contract for this exact subtask
- file: plan/007_8783a1f5e14a/architecture/implementation_notes.md
  why: "§T1.S3 is the verbatim contract — derive component loggers from ONE shared root
        (child of a process-wide root pino), bound to one sync stream + zero workers; the
        teardown test must assert <2s fast-exit AND no worker (worker_threads.Worker spy
        OR streamSym-not-ThreadStream)."
  section: "T1 — Logging Architecture → T1.S3 — Single root logger per process (REQ-L3) + validation"
  critical: "The contract suggests the worker_threads.Worker spy; verified_facts.md §3 PROVES
             it is inoperative in this vitest setup. Use listenerCount delta + the e2e instead
             (test_strategy.md §B/§C). Do NOT spend time making the Worker spy work."

# MUST READ — the proven test design (what to assert, what NOT to assert, why)
- file: plan/007_8783a1f5e14a/P7M1T1S3/research/test_strategy.md
  why: "The exact logger-teardown.test.ts structure: the vi.mock('pino-pretty')
        single-destination counter, the process.listenerCount no-ThreadStream delta, and the
        spawnSync fast-exit e2e. Copy the snippets."
  section: "§A single-destination · §B no-worker · §C fast-exit e2e"

# MUST READ — every load-bearing assumption, empirically verified
- file: plan/007_8783a1f5e14a/P7M1T1S3/research/verified_facts.md
  why: "Proves: S1 already landed; pino child level is independent of root; the
        worker_threads.Worker spy THROWS / assignment is blocked (configurable:false +
        ESM-locked); vi.mock('pino-pretty') works (currently 4 calls → must be 1);
        listenerCount delta=0 works; built --help is ~570ms; base:{} is required; clearLoggerCache
        must reset roots; coverage stays 100%."
  section: "§1–§12 (read all)"

# MUST READ — the S1 PRP (defines the getLogger this task consumes & must NOT break)
- file: plan/007_8783a1f5e14a/P7M1T1S1/PRP.md
  why: "S1 landed lazy getPino() + sync destinations. S3 restructures getLogger()'s
        construction to single-root but MUST keep getLogger()/Logger/wrapPinoLogger/cache
        stable and MUST keep the pretty() destination options byte-identical (colorize,
        translateTime:'HH:MM:ss', ignore:'pid,hostname', messageFormat, singleLine:false)."
  section: "Success Definition + Implementation Patterns (the getLogger shape to restructure)"

# MUST READ — the S2 PRP (the lazy call sites S3 must NOT touch)
- file: plan/007_8783a1f5e14a/P7M1T1S2/PRP.md
  why: "S2 migrated the 31 module-scope declarations to lazy `logger()` accessors. S3 must
        not touch any of those 31 files; S3 only edits logger.ts + adds the test file."
  section: "Goal + Integration Points (NO CHANGES TO call sites)"

# MUST READ — the PRD requirement being satisfied (binding)
- file: PRD.md
  why: "§9.6.2 REQ-L3 (single root, one sync stream, zero workers); §9.6.3 acceptance
        criteria (fast-exit <2s, no ThreadStream workers, no top-level getLogger, no transport:)."
  section: "9.6 Logging Architecture → 9.6.2 REQ-L3 + 9.6.3 Acceptance Criteria"

# MUST READ — the file under edit
- file: src/utils/logger.ts
  why: "THE edit target. getLogger() (the construction block) becomes root.child(...);
        clearLoggerCache() gains root reset; add getRoot()/buildRoot(); JSDoc updated."
  pattern: "Keep wrapPinoLogger / Logger interface / loggerCache / getCacheKey / redaction /
            levels / getPino() byte-for-byte identical. The change is confined to how the pino
            instance is obtained (child of a shared root) and to cache teardown."
  gotcha: "Root MUST be built with base:{} (else pid/hostname leak into JSON). Root config
           level is irrelevant (children set their own). Do NOT reset getPino()'s bundle in
           clearLoggerCache — only the roots."

# MUST READ — the existing logger test (mirror structure; do not duplicate the teardown tests there)
- file: tests/unit/logger.test.ts
  why: "Mirror its describe/it + beforeEach(clearLoggerCache) style. It already has a REQ-L1
        'no exit listeners' test (a weaker proxy) — do NOT weaken it; S3's teardown file adds
        the authoritative single-destination + e2e assertions alongside it."
  pattern: "vitest globals; vi.spyOn(process,'on') is safe (process IS spyable, unlike worker_threads)."

# REFERENCE — pino child()/symbols semantics
- url: https://github.com/pinojs/pino/blob/main/docs/api.md
  why: "child(bindings, options) with options.level (independent of parent level); pino.symbols.streamSym (optional shape inspection)."
```

### Current Codebase tree (relevant slice)

```bash
src/
  utils/
    logger.ts                 # ← EDIT TARGET (getLogger → root.child; clearLoggerCache resets roots; +getRoot/buildRoot; JSDoc)
tests/
  unit/
    logger.test.ts            # ← existing REQ-L1 proxies; leave as-is (do not duplicate teardown tests here)
    utils/
      logger-teardown.test.ts # ← NEW (single-destination mock + no-ThreadStream listenerCount + fast-exit e2e)
dist/
  index.js                    # ← the built CLI the e2e spawns (requires `npm run build` first)
package.json                  # bin.hack = ./dist/index.js; scripts: build / test:run / validate
vitest.config.ts              # include tests/**; coverage include src/**; 100% thresholds
plan/007_8783a1f5e14a/
  architecture/implementation_notes.md   # §T1.S3 — authoritative contract
  architecture/external_deps.md          # Part 1 Finding 6 (test strategies — NOTE: 6a worker-spy is inoperative here)
  P7M1T1S1/PRP.md                        # S1 contract (consumed)
  P7M1T1S2/PRP.md                        # S2 contract (do not touch call sites)
  P7M1T1S3/research/{verified_facts,test_strategy}.md
  P7M1T1S3/PRP.md                        # this file
```

### Desired Codebase tree with files added/changed

```bash
src/utils/logger.ts                      # MODIFIED — single-root getLogger() + root-reset clearLoggerCache + JSDoc
tests/unit/utils/logger-teardown.test.ts # NEW     — REQ-L3 + teardown validation suite
# (everything else UNCHANGED — S1's logger internals, S2's 31 lazy call sites, PRD/tasks/prd_snapshot/.gitignore READ-ONLY)
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — The worker_threads.Worker spy (external_deps.md §1 Finding 6a, S1 PRP) is
// INOPERATIVE in this vitest/forks setup. PROVEN:
//   Object.getOwnPropertyDescriptor(worker_threads,'Worker') = { writable:true, configurable:false }
//   vi.spyOn(wt,'Worker')            → THROWS (needs configurable:true)
//   (wt as any).Worker = fn          → TypeError: Cannot assign to property 'Worker' of [object Module]
//   Object.defineProperty(wt,'Worker',{get}) → Cannot redefine property: Worker
// DO NOT use it. Use process.listenerCount('exit'|'beforeExit') delta=0 (reliable) + the
// fast-exit e2e (authoritative). See verified_facts.md §3–§4.

// CRITICAL — Build the root with `base: {}`. Today each logger is
//   pino({ ...config, base: { context, correlationId } }, dest)  → base REPLACES default {pid,hostname}
// so current JSON output has NO pid/hostname. After S3 the ROOT must carry base:{} (keep
// suppressing pid/hostname) and the CHILD carries {context,correlationId} as bindings.
// Forgetting base:{} → pid+hostname leak into every JSON line (silent output regression).

// CRITICAL — Root level does NOT gate children (PROVEN via probe: root info + child trace
// → trace emitted). So set the child's level via the 2nd arg: root.child({context,correlationId},
// { level: resolvedLevel }). Do NOT rely on the root's configured level for per-logger filtering.

// CRITICAL — vi.mock('pino-pretty') is hoisted ABOVE logger.ts's import, so it replaces
// prettyNs.default BEFORE logger.ts captures `const pretty = prettyNs.default ?? prettyNs`.
// The mock factory MUST delegate to the real implementation (return real(opts)) or logger
// output breaks. vi.mock is per-file isolated → does NOT affect tests/unit/logger.test.ts.

// CRITICAL — clearLoggerCache() MUST reset _rootPretty and _rootJson (tests call it in
// beforeEach). Do NOT reset getPino()'s _pinoBundle (the pino module never changes).

// GOTCHA — pino-pretty messageFormat '[{correlationId}] [{context}] {msg}' reads those
// fields from the log object; child bindings ARE present in the log object, so it still
// works. Do not move context/correlationId anywhere that pino-pretty can't see them.

// GOTCHA — Keep the pretty() option values VERBATIM (colorize:true, translateTime:'HH:MM:ss',
// ignore:'pid,hostname', messageFormat:'[{correlationId}] [{context}] {msg}', singleLine:false)
// and leave destination unset (process.stdout). A file destination re-introduces SonicBoom +
// an exit handler (the REQ-L1 hazard S1 removed).

// GOTCHA — The fast-exit e2e spawns the BUILT dist/index.js. It only reflects S1+S2+S3
// after `npm run build`. The PRP Level-4 gate runs build first. If dist/index.js is missing,
// the e2e describe.skip()s (so `npm run validate` without a build stays green) — do NOT
// make it fail the whole suite when unbuilt.

// GOTCHA — --help/-h/--version/invalid-flag exit inside parseCLIArgs() (src/index.ts)
// BEFORE configureEnvironment()/endpoint-guard, so the z.ai §9.2.4 safeguard does not
// affect e2e timing. Pass process.env through to the child (it exits before reading it).

// GOTCHA — coverage gate is 100% (vitest.config.ts). The new branches (getRoot true/false,
// _rootJson/_rootPretty ??= memoized, resolvedLevel verbose?level, root reset) are all hit
// by existing logger.test.ts + the new single-destination test. If any branch is <100%, add
// a one-line assertion that exercises it rather than skipping.
```

## Implementation Blueprint

### Data models and structure

No data-model changes. `LoggerConfig`, `Logger`, `LogLevel`, `REDACT_PATHS`, `PINO_LEVELS`,
`loggerCache`, `getCacheKey`, `generateCorrelationId`, `wrapPinoLogger`, `getGlobalConfig`,
and S1's `getPino()`/`PinoBundle` are all **unchanged**. The only new internal shape is the
per-mode root singletons + accessors:

```ts
// ===== REQ-L3: single shared root per output mode (one sync stream, zero workers) =====
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _rootPretty: any; // human/pretty root — owns ONE pino-pretty Transform destination
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _rootJson: any;   // machine-readable root — owns stdout (no separate stream)

/** Builds a fresh root pino for the given output mode (configured ONCE; inherited by children). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildRoot(machineReadable: boolean): any {
  const { pino, stdTimeFunctions } = getPino();
  const config = createLoggerConfig({}, stdTimeFunctions); // redact/customLevels/timestamp/formatters
  if (machineReadable) {
    // JSON → default stdout (sync); no 2nd arg, no pretty Transform.
    return pino({ ...config, base: {} }); // base:{} suppresses pid/hostname (preserve today's output)
  }
  const dest = pretty({
    colorize: true,
    translateTime: 'HH:MM:ss',
    ignore: 'pid,hostname',
    messageFormat: '[{correlationId}] [{context}] {msg}',
    singleLine: false,
    // CRITICAL: no destination: (defaults to process.stdout; a path re-adds SonicBoom+exit handler)
  });
  return pino({ ...config, base: {} }, dest);
}

/** Returns the cached root for the mode, building it lazily on first use (memoized). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getRoot(machineReadable: boolean): any {
  return machineReadable
    ? (_rootJson ??= buildRoot(true))
    : (_rootPretty ??= buildRoot(false));
}
```

`getLogger()`'s public signature `(context: string, options?: LoggerConfig) => Logger` is
unchanged. Internally it now derives a child:

```ts
export function getLogger(context: string, options?: LoggerConfig): Logger {
  const cacheKey = getCacheKey(context, options);
  const cached = loggerCache.get(cacheKey);
  if (cached) return cached;

  const correlationId = options?.correlationId || generateCorrelationId();
  const machineReadable = options?.machineReadable ?? false;
  const { level = LogLevel.INFO, verbose = false } = options ?? {};
  const resolvedLevel = verbose ? LogLevel.DEBUG : level;

  // REQ-L3: derive a child from the single shared root for this output mode.
  // One destination stream per mode; zero worker threads. Children set their own level
  // (proven: root level does not gate children).
  const root = getRoot(machineReadable);
  const pinoLogger = root.child(
    { context, correlationId },
    { level: resolvedLevel }
  );

  const logger = wrapPinoLogger(pinoLogger);
  loggerCache.set(cacheKey, logger);
  globalConfig = options ?? {};
  return logger;
}
```

`clearLoggerCache()` gains the root reset:

```ts
export function clearLoggerCache(): void {
  loggerCache.clear();
  globalConfig = {};
  _rootPretty = undefined; // REQ-L3: force root rebuild on next getLogger (fresh config)
  _rootJson = undefined;
  // NOTE: getPino()'s _pinoBundle is intentionally NOT reset (the pino module never changes).
}
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: ADD the single-root machinery to src/utils/logger.ts
  - ADD (after getPino()): `_rootPretty`, `_rootJson` module locals; `buildRoot(machineReadable)`; `getRoot(machineReadable)`.
  - buildRoot MUST: call getPino(); build config via createLoggerConfig({}, stdTimeFunctions);
            set base:{} on BOTH modes; for pretty build pretty({...}) with VERBATIN option values
            (colorize/translateTime:'HH:MM:ss'/ignore:'pid,hostname'/messageFormat/singleLine:false)
            and pass it as the 2nd arg; for JSON pass no 2nd arg (default stdout). No transport:.
  - getRoot MUST: memoize per mode via `??=` (so the second call of a mode returns the cached root).
  - NAMING: _rootPretty, _rootJson, buildRoot, getRoot (internal; not exported).
  - COVERAGE: both modes' first-build + memoized branches must be hit (Task 4 / existing tests).
  - DEPENDENCY: S1's getPino()/createLoggerConfig() must exist (they do).

Task 2: REWRITE getLogger() to derive a child from the shared root
  - REPLACE the block that did `const dest = machineReadable ? undefined : pretty({...});`
            `const pinoLogger = pino({ ...config, base: { context, correlationId } }, dest);`
            with: `const root = getRoot(machineReadable);` `const pinoLogger = root.child(
            { context, correlationId }, { level: resolvedLevel });`
            where resolvedLevel = (verbose ? DEBUG : level), computed from options.
  - REMOVE the now-redundant per-logger pretty({...}) construction (the root owns it).
  - KEEP: cache check (cacheKey unchanged), correlationId generation, wrapPinoLogger, loggerCache.set,
            globalConfig assignment. Public signature unchanged.
  - PRESERVE: byte-identical output (base:{} on root + child bindings = today's base:{context,correlationId}).
  - DEPENDENCY: Task 1.

Task 3: EXTEND clearLoggerCache() to reset the roots
  - ADD: `_rootPretty = undefined; _rootJson = undefined;` (do NOT touch _pinoBundle).
  - WHY: tests call clearLoggerCache() in beforeEach; without root reset they'd share stale roots.
  - DEPENDENCY: Task 1.

Task 4: UPDATE getLogger() JSDoc (Mode A — rides with the work)
  - CHANGE the REQ-L3 note from "future work" to "satisfied": getLogger() derives each logger
            as a child of a single process-wide root pino (one per output mode), bounding total
            destinations to one synchronous stream per mode and zero worker threads.
  - KEEP the REQ-L1 (sync destinations, no transport:) and REQ-L2 (lazy pino) notes accurate.
  - KEEP the @example block accurate (API unchanged).
  - DEPENDENCY: Tasks 1–3.

Task 5: CREATE tests/unit/utils/logger-teardown.test.ts (the authoritative teardown suite)
  - FOLLOW the exact structure in P7M1T1S3/research/test_strategy.md (copy the snippets):
    * describe A 'REQ-L3 — Single root logger (one destination per output mode)':
        vi.mock('pino-pretty', delegating factory + prettyCalls counter);
        import getLogger/clearLoggerCache from '../../../src/utils/logger.js';
        it 'pretty mode builds the destination exactly once' (4+ pretty loggers → prettyCalls===1);
        it 'JSON mode never calls the pretty factory' (machineReadable → prettyCalls===0);
        it 'child loggers reuse the same destination' (child().child() logs, prettyCalls unchanged).
    * describe B 'REQ-L3 — No worker thread / no ThreadStream on construction':
        it 'getLogger adds zero exit/beforeExit listeners' (process.listenerCount delta === 0,
           across pretty + JSON + verbose);
        it 'no transport-exit handler registered' (vi.spyOn(process,'on'); no 'exit'/'beforeExit').
    * describe C 'Teardown — fast CLI exit (< 2s)' (describe.skip if dist/index.js missing):
        spawnSync(node, [dist/index.js, args]) for ['--help'],['-h'],['--version'],['--no-such-flag'];
        assert ms < 2000 AND status (0 for help/version; non-zero for invalid flag); timeout 10_000.
  - NAMING: tests/unit/utils/logger-teardown.test.ts (per contract).
  - DO NOT add a worker_threads.Worker spy — it is inoperative (Known Gotchas / verified_facts §3).
  - DEPENDENCY: Tasks 1–4 (the single-destination assertion only passes after the refactor; the
            e2e needs `npm run build` — Task 6).

Task 6: BUILD then run the e2e + full validation
  - RUN: npm run build            # required for the fast-exit e2e to reflect S1+S2+S3
  - RUN: npx vitest run tests/unit/utils/logger-teardown.test.ts   # all three describes green
  - RUN: npm run validate         # lint + format:check + typecheck + test:run (incl. 100% coverage)
  - RUN (acceptance greps): rg -n "transport\s*:" src/utils/logger.ts  → zero hits
                            rg -n "^(export )?(const|let) \w+ = getLogger\(" src/  → zero hits
  - DEPENDENCY: Task 5.
```

### Implementation Patterns & Key Details

```ts
// ── getLogger(): child of shared root (replaces the per-logger pino(...) construction) ──
export function getLogger(context: string, options?: LoggerConfig): Logger {
  const cacheKey = getCacheKey(context, options);
  const cached = loggerCache.get(cacheKey);
  if (cached) return cached;

  const correlationId = options?.correlationId || generateCorrelationId();
  const machineReadable = options?.machineReadable ?? false;
  const { level = LogLevel.INFO, verbose = false } = options ?? {};
  const resolvedLevel = verbose ? LogLevel.DEBUG : level;

  const root = getRoot(machineReadable);                 // ONE root per mode (cached)
  const pinoLogger = root.child(
    { context, correlationId },                           // bindings → appear in output (no pid/hostname)
    { level: resolvedLevel }                              // child level is independent of root (proven)
  );
  const logger = wrapPinoLogger(pinoLogger);              // unchanged wrapper
  loggerCache.set(cacheKey, logger);
  globalConfig = options ?? {};
  return logger;
}

// ── The teardown test's single-destination assertion (proven to drop 4 → 1 after S3) ────
let prettyCalls = 0;
vi.mock('pino-pretty', async (importOriginal) => {
  const orig = await importOriginal();
  const real = (orig as any).default ?? orig;             // delegate to the real factory
  const factory = (...args: unknown[]) => { prettyCalls++; return real(...args); };
  return { ...(orig as object), default: factory };
});
import { getLogger, clearLoggerCache } from '../../../src/utils/logger.js';
// …
clearLoggerCache(); prettyCalls = 0;
getLogger('A'); getLogger('B'); getLogger('C'); getLogger('D', { verbose: true });
expect(prettyCalls).toBe(1);   // was 4 before S3; 1 after (shared root)

// ── The reliable no-ThreadStream assertion (worker_threads.Worker spy is INOPERATIVE) ───
const beforeExit = process.listenerCount('exit');
const beforeBE = process.listenerCount('beforeExit');
clearLoggerCache();
getLogger('A'); getLogger('B', { machineReadable: true }); getLogger('C', { verbose: true });
expect(process.listenerCount('exit') - beforeExit).toBe(0);       // ThreadStream always adds one
expect(process.listenerCount('beforeExit') - beforeBE).toBe(0);

// ── The fast-exit e2e (authoritative; requires npm run build) ───────────────────────────
import { spawnSync } from 'node:child_process';
const res = spawnSync(process.execPath, ['./dist/index.js', '--help'],
  { encoding: 'utf8', timeout: 10_000, env: { ...process.env } });
expect(Date.now() - start).toBeLessThan(2000);
expect(res.status).toBe(0);
```

### Integration Points

```yaml
CODE (src/utils/logger.ts):
  - add:    `_rootPretty`, `_rootJson` locals; `buildRoot(machineReadable)`; `getRoot(machineReadable)`.
  - change: getLogger() — `root.child({context,correlationId},{level:resolvedLevel})` instead of `pino(config,dest)`.
  - change: clearLoggerCache() — reset `_rootPretty`/`_rootJson` (NOT `_pinoBundle`).
  - change: getLogger() JSDoc — REQ-L3 "satisfied".
  - keep:   getLogger()/Logger signature; wrapPinoLogger; loggerCache; getCacheKey; createLoggerConfig;
            redaction; levels; getPino(); pretty() option values; base suppression of pid/hostname.

TESTS (tests/unit/utils/logger-teardown.test.ts — NEW):
  - vi.mock('pino-pretty') delegating factory + call counter.
  - process.listenerCount('exit'|'beforeExit') delta assertions.
  - spawnSync(node, dist/index.js, …) fast-exit assertions (< 2000ms).

NO CHANGES TO:
  - the 31 lazy call sites (S2 territory — parallel/done)
  - tests/unit/logger.test.ts (leave its REQ-L1 proxies intact; do not duplicate teardown tests there)
  - src/tools/*-mcp.ts (MCP transports, unrelated)
  - any other src/** file
  - PRD.md, tasks.json, prd_snapshot.md, .gitignore (READ-ONLY — never touch)
```

## Validation Loop

> Run after the relevant task group. Fix before proceeding to the next level.

### Level 1: Syntax & Style (after Tasks 1–4)

```bash
npm run typecheck      # NodeNext, strict — catches any child()/options shape error.
npm run lint           # eslint .ts — zero errors.
npm run format:check   # run `npm run format` if it complains.
```
Expected: all three pass. typecheck is the primary catcher of a malformed `root.child(...)`
or a stale `dest`/`pino(...)` reference left over from the rewrite.

### Level 2: Unit + Coverage (after Task 5, before Task 6's build)

```bash
# The new teardown suite (single-destination + no-ThreadStream; e2e skips if dist missing).
npx vitest run tests/unit/utils/logger-teardown.test.ts

# Existing logger suite must still pass (API/output unchanged) at 100% coverage.
npx vitest run tests/unit/logger.test.ts

# Full suite + 100% coverage gate. INSPECT src/utils/logger.ts branch %.
npm run test:coverage
```
Expected: all pass; `src/utils/logger.ts` at 100% statements/branches/functions/lines. If a
new branch in `getRoot`/`buildRoot`/`resolvedLevel` is <100%, add a one-line assertion that
exercises it (e.g. a second JSON getLogger to hit the memoized `_rootJson` branch).

### Level 3: Acceptance greps (the REQ-L1/L2 invariants; S3 must not regress them)

```bash
# REQ-L1 invariant — zero transport: in logger config (must still be empty).
rg -n "transport\s*:" src/utils/logger.ts
# Expected: <no output>, exit 1.

# REQ-L2 invariant — zero module-scope getLogger (S2; S3 adds none).
rg -n "^(export )?(const|let) \w+ = getLogger\(" src/
# Expected: <no output>, exit 1.
```
Expected: both return zero hits.

### Level 4: Build + fast-exit e2e (the REQ-L3 authority — after Task 6)

```bash
npm run build
node ./dist/index.js --help        # prints help, exits 0 promptly
node ./dist/index.js -h
node ./dist/index.js --version
node ./dist/index.js --no-such-flag # Commander error, exits 1 promptly

# Run the full teardown file WITH the fresh build (e2e describe now runs, not skipped).
npx vitest run tests/unit/utils/logger-teardown.test.ts
```
Expected: build succeeds; each invocation returns in well under 2s with no multi-second exit
stall; the teardown file's fast-exit assertions pass. (Baseline measured ~570ms for `--help`.)

## Final Validation Checklist

### Technical Validation
- [ ] Level 1: `npm run typecheck`, `npm run lint`, `npm run format:check` all pass.
- [ ] Level 2: `npm run test:run` passes; `npm run test:coverage` shows `src/utils/logger.ts`
      at 100% statements/branches/functions/lines.
- [ ] Level 3: `rg -n "transport\s*:" src/utils/logger.ts` → **zero hits**.
- [ ] Level 3: `rg -n "^(export )?(const|let) \w+ = getLogger\(" src/` → **zero hits**.
- [ ] Level 4: `npm run build` succeeds; `--help`/`-h`/`--version`/invalid-flag each **< 2s**.

### Feature Validation (REQ-L3 + §9.6.3)
- [ ] `vi.mock('pino-pretty')` → pretty constructed **exactly 1×** across ≥4 pretty loggers;
      **0×** for machineReadable loggers.
- [ ] `process.listenerCount('exit'|'beforeExit')` delta around `getLogger()` = **0**
      (pretty + JSON + verbose).
- [ ] getLogger() derives each logger as a child of a single shared root (one per mode).
- [ ] Fast-exit e2e passes for `--help`, `-h`, `--version`, invalid flag (< 2000ms).
- [ ] No `worker_threads.Worker` spy used (inoperative — documented + justified).
- [ ] Output is byte-identical (no pid/hostname leak; same context/correlationId/levels/redaction).

### Code Quality Validation
- [ ] `base: {}` set on BOTH roots (pid/hostname stay suppressed).
- [ ] pretty() option values carried verbatim; no `destination:` file path.
- [ ] `clearLoggerCache()` resets roots but NOT `_pinoBundle`.
- [ ] No edit to the 31 lazy call sites (S2), `tests/unit/logger.test.ts`, or any other src file.
- [ ] No `eslint-disable` silencing added beyond the existing `@typescript-eslint/no-explicit-any`
      pattern already used in logger.ts.

### Documentation
- [ ] getLogger() JSDoc states REQ-L3 is satisfied (single root, one sync stream per mode).
- [ ] No user-facing/config/API docs to change (contract point 4: DOCS = none beyond the JSDoc).
- [ ] PRP execution summary notes the worker_threads.Worker-spy abandonment + the dist-build
      prerequisite for the e2e.

---

## Anti-Patterns to Avoid

- ❌ Don't use `vi.spyOn(worker_threads, 'Worker')` or a direct-assignment sentinel — both are
  **inoperative** here (configurable:false + ESM-locked). Use `process.listenerCount` delta +
  the e2e. (verified_facts.md §3.)
- ❌ Don't forget `base: {}` on the root — without it, `pid`+`hostname` leak into every JSON
  line (silent output regression vs. today's `base:{context,correlationId}`).
- ❌ Don't set per-logger `pino(...)` anymore — that re-creates a destination per logger
  (the exact thing REQ-L3 removes). Always go through `getRoot(mode).child(...)`.
- ❌ Don't pass a file `destination:` to `pretty()` — re-introduces SonicBoom + a blocking exit
  handler (the REQ-L1 hazard S1 removed).
- ❌ Don't reset `_pinoBundle` in `clearLoggerCache()` — only the roots carry config; the pino
  module is stable.
- ❌ Don't touch the 31 lazy call sites (S2 territory) or `tests/unit/logger.test.ts`
  (its REQ-L1 proxies stay; S3's teardown assertions live in the new file).
- ❌ Don't duplicate the teardown tests into `logger.test.ts` — `vi.mock('pino-pretty')` would
  apply to that whole file and complicate its redaction/child/format assertions.
- ❌ Don't make the fast-exit e2e fail the whole suite when `dist/` is unbuilt — `describe.skip`
  it and rely on the PRP Level-4 gate (`npm run build` first) to actually run it.
- ❌ Don't change the public `Logger`/`getLogger`/`wrapPinoLogger`/cache-key shape — S2's call
  sites and the 33+ logger-mocking tests depend on it.
- ❌ Don't modify PRD.md, tasks.json, prd_snapshot.md, or .gitignore (READ-ONLY).
