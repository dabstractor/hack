---
name: "P7.M1.T1.S1 — Synchronous logger destinations (REQ-L1)"
description: |
  Eliminate the pino worker-thread `transport:` from `getLogger()` so both the JSON
  and the pretty-print paths write to a synchronous in-process destination stream.
  Single-file change to `src/utils/logger.ts` (plus JSDoc + a focused unit test).
  This is subtask S1 of the logging workstream (PRD §9.6); it MUST NOT touch the 31
  module-scope `getLogger()` call sites (that is S2/REQ-L2) or add the single-root /
  teardown e2e test (that is S3/REQ-L3).
---

## Goal

**Feature Goal**: `getLogger()` constructs **zero worker threads** for either the
machine-readable (JSON) or the human-readable (pretty) path. Pretty-printing is
delivered via a synchronous in-process destination stream (`pino-pretty` passed as
the 2nd positional argument to `pino(...)`), never via a pino `transport:` key.
Pino itself is no longer eagerly loaded at module-eval time — it is loaded lazily
on first `getLogger()`.

**Deliverable**: A modified `src/utils/logger.ts` that (1) imports `pino-pretty`
and passes it as a destination stream instead of a `transport: { target: … }` config,
(2) replaces the eager top-level `await import('module')` pino-load block with a
memoized `getPino()` accessor invoked on first `getLogger()`, (3) removes the
`process.setMaxListeners?.(30)` band-aid, (4) updates the `getLogger()` JSDoc to
document the lazy + synchronous-destination contract (REQ-L1/L2/L3). Plus one
updated/added unit test in `tests/unit/logger.test.ts` asserting no worker thread
is spawned.

**Success Definition**:
- `rg -n "transport\s*:" src/utils/logger.ts` returns **ZERO hits**.
- `npm run typecheck`, `npm run lint`, and `npm run test:run` all pass (the 100%
  coverage gate must remain green — every new branch is covered).
- A `getLogger('X')` call (both default pretty and `{ machineReadable: true }` JSON)
  does not construct a `worker_threads.Worker` (asserted by an in-test
  `vi.spyOn(worker_threads, 'Worker')`).
- The public `Logger` interface, `wrapPinoLogger`, `loggerCache`, redaction config,
  log levels, and correlation-ID behaviour are unchanged (no caller breakage; S2
  migrates call sites later).

## User Persona (if applicable)

**Target User**: Contributors / maintainers of the hacky-hack CLI (and every
end-user invoking `hack --help`, `hack --version`, validation, or a full run).

**Use Case**: Fast, stall-free CLI teardown. Today every CLI invocation pays
~10s of frozen event loop at exit because 13 pino transport `exit` handlers run
sequentially (PRD §9.6.1). S1 removes the per-logger worker thread + its blocking
exit handler from the logger factory itself.

**Pain Points Addressed**: `hack --help` / `--version` / invalid-flag taking ~10.7s
wall / ~1.6s CPU with a frozen event loop for ~10s after `process.exit()`.

## Why

- **Business value**: The single most visible performance defect of the CLI — a
  multi-second stall on *every* invocation, including trivial ones — is
  teardown-bound and caused entirely by pino worker-thread transports
  (PRD §9.6.1: stubbing `ThreadStream` shutdown reduced `--help` 10.71s → 1.94s).
- **Integration with existing features**: S1 is the foundation of the logging
  workstream. It changes the logger factory internals only; the public API stays
  identical so S2 (lazy call-site migration) and S3 (single root + teardown e2e
  test) can land independently afterward. See dependency graph in
  `architecture/implementation_notes.md` (`T1.S1 ─▶ T1.S2 ─▶ T1.S3`).
- **Problems solved / for whom**: For every CLI user; and for future contributors
  who must never reintroduce a `transport:` key (enforced by the acceptance grep +
  the new worker-spy test).

## What

User-visible behaviour is unchanged (same log output, same redaction, same levels,
same context/correlationId prefixes). The change is internal to logger
construction:

1. **No `transport:` key** is ever produced by `createLoggerConfig()` or passed to
   the underlying pino instance.
2. **Pretty path** (default, `!machineReadable`): build
   `const dest = pretty({ colorize: true, translateTime: 'HH:MM:ss',
   ignore: 'pid,hostname', messageFormat: '[{correlationId}] [{context}] {msg}',
   singleLine: false })` and pass `dest` as the 2nd argument to `syncPino(...)`.
   Leave `destination` **unset** (defaults to `process.stdout`) — do NOT pass a
   file path (would re-introduce SonicBoom async flush + a blocking exit handler).
3. **JSON path** (`machineReadable`): unchanged — already uses a sync stdout
   destination (no 2nd arg).
4. **Pino is loaded lazily**: a memoized `getPino()` accessor (returning both the
   pino factory and `stdTimeFunctions`) replaces the eager top-level
   `await import('module')` block. It runs on first `getLogger()`, never at import.
5. **`process.setMaxListeners?.(30)` removed** from `getLogger()`.

### Success Criteria

- [ ] `rg -n "transport\s*:" src/utils/logger.ts` → **zero hits**.
- [ ] `getLogger('X')` and `getLogger('X', { machineReadable: true })` each construct
      zero `worker_threads.Worker` instances (asserted in test).
- [ ] `getLogger('X')` is idempotent + still cached by context (existing cache test
      stays green).
- [ ] No eager pino load at module-eval: importing `logger.ts` does not call
      `require('pino')` until `getLogger()` is invoked.
- [ ] `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run test:run`
      all pass (100% coverage gate green).
- [ ] Public `Logger` interface, `wrapPinoLogger`, `loggerCache`, redaction paths,
      `LogLevel`, and `getGlobalConfig`/`clearLoggerCache` are unchanged.

## All Needed Context

### Context Completeness Check

If someone knew nothing about this codebase, would they have everything needed to
implement this successfully? **Yes** — the authoritative contract is
`plan/007_8783a1f5e14a/architecture/implementation_notes.md §T1.S1`, the pino
pattern research is `…/architecture/external_deps.md` Part 1, and the current
`src/utils/logger.ts` + `tests/unit/logger.test.ts` are the only files to edit.
Verified facts (line numbers, exported symbols, versions) are in
`…/P7M1T1S1/research/verified_facts.md`.

### Documentation & References

```yaml
# MUST READ — authoritative, file-level contract for this exact subtask
- file: plan/007_8783a1f5e14a/architecture/implementation_notes.md
  why: "§T1.S1 is the verbatim contract — current violation, required change, the
        pretty() destination snippet, the getPino() deferral, and the
        setMaxListeners removal. Treat its CONTRACT block as authoritative."
  section: "T1 — Logging Architecture → T1.S1 — Synchronous destinations (REQ-L1)"
  critical: "Do NOT mix forms: syncPino({transport:...}, pretty()) double-formats
             AND spawns a worker. Leave destination unset (process.stdout)."

# MUST READ — the pino-pretty destination-stream pattern + test strategies
- file: plan/007_8783a1f5e14a/architecture/external_deps.md
  why: "Part 1 proves the destination-stream form spawns no worker, gives the exact
        ESM import + interop fallback, lists the do-not-mix-forms / no-file-path
        gotchas, and Finding 6 gives THREE test strategies (worker_threads.Worker
        spy, pino.symbols.streamSym inspection, sentinel patch)."
  section: "Part 1 — pino + pino-pretty teardown → Findings 1–6 + Gotchas"
  critical: "ESM default-export is the factory; use interop fallback to be safe.
             destination must be unset / process.stdout — a file path re-adds
             SonicBoom + an exit handler."

# MUST READ — the PRD requirement being satisfied (binding)
- file: PRD.md
  why: "§9.6.2 REQ-L1 is the binding requirement; §9.6.3 lists acceptance criteria."
  section: "9.6 Logging Architecture → 9.6.2 Requirements (REQ-L1) + 9.6.3 Acceptance Criteria"

# MUST READ — the file under edit
- file: src/utils/logger.ts
  why: "THE edit target. Three change sites: (A) eager top-level await pino-load
        block + `let syncPino`/`let syncStdTime`, (B) createLoggerConfig()
        `if (!machineReadable)` return carrying `transport:` (line ~318),
        (C) getLogger()'s `if (!loggerCache.size) process.setMaxListeners?.(30)`."
  pattern: "Keep wrapPinoLogger / Logger interface / loggerCache / redaction / levels
            byte-for-byte identical. The change is confined to how the pino instance
            is constructed and when pino is loaded."
  gotcha: "The current code uses createRequire+top-level await because pino is CJS.
           A lazy getPino() may keep using createRequire internally — just defer it
           out of module-eval into a function called on first getLogger()."

# MUST READ — existing test file (extend, do not replace)
- file: tests/unit/logger.test.ts
  why: "Mirror its structure (describe/it, beforeEach→clearLoggerCache(), vi helpers).
        There is an EXISTING test 'should not throw when process lacks setMaxListeners
        (partial stub)' that covers the band-aid being REMOVED in change site C — it
        MUST be repurposed (see Known Gotchas)."
  pattern: "vi.stubGlobal('process', {...}), vi.spyOn(...). Tests use vitest globals."

# Verified facts captured during PRP research (line numbers, exported symbols, versions)
- file: plan/007_8783a1f5e14a/P7M1T1S1/research/verified_facts.md
  why: "Confirms pino.symbols.streamSym exists (Symbol(pino.stream)), pino-pretty
        default export is a function, vitest config has interopDefault:true, the
        exact current line of the transport: hit, and the 31-call-site count that
        S1 must NOT touch."

# External (pino-pretty README — destination-stream pattern; confirm anchors)
- url: https://github.com/pinojs/pino-pretty#pino-pretty-as-a-destination-stream
  why: "Primary source for the 2nd-positional-argument destination pattern."
- url: https://github.com/pinojs/pino/blob/main/docs/transports.md
  why: "Transport-vs-destination semantics (why transports spawn workers)."
- url: https://github.com/pinojs/pino/blob/main/docs/api.md
  why: "pino.symbols.streamSym for the in-test destination inspection."
```

### Current Codebase tree (relevant slice)

```bash
src/
  utils/
    logger.ts                 # ← EDIT TARGET (3 sites: load, transport, setMaxListeners)
tests/
  unit/
    logger.test.ts            # ← EXTEND: repurpose setMaxListeners test + add no-worker test
docs/
  CONFIGURATION.md            # ← VERIFY ONLY (no worker-thread prose exists today)
plan/007_8783a1f5e14a/
  architecture/
    implementation_notes.md   # §T1.S1 — authoritative contract
    external_deps.md          # Part 1 — pino-pretty destination research
  P7M1T1S1/
    research/verified_facts.md
    PRP.md                    # this file
```

### Desired Codebase tree with files added/changed

```bash
src/utils/logger.ts           # MODIFIED — lazy getPino(), pretty() destination, no transport:, no setMaxListeners
tests/unit/logger.test.ts     # MODIFIED — repurpose setMaxListeners test → no-worker/no-exit-listener assertion
docs/CONFIGURATION.md         # UNCHANGED (verify no worker-thread prose; only edit if found)
# (NEW files in research/ are PRP artifacts, not shipped code)
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — pino is CommonJS (9.14.0); pino-pretty is CommonJS (11.3.0).
// The current code uses createRequire + top-level await to load pino. KEEP using
// createRequire inside the lazy getPino() — just move it OUT of module-eval scope
// into a function invoked on first getLogger(). Do not introduce a top-level await.

// CRITICAL — pino-pretty ESM default export IS the factory, but use the interop
// fallback so a bundler/Node ESM quirk can't break it:
//   import * as prettyNs from 'pino-pretty';
//   const pretty = (prettyNs as any).default ?? prettyNs;
// (vitest.config.ts already sets deps.interopDefault:true, so tests resolve it too.)

// CRITICAL — NEVER mix forms. This double-formats AND spawns a worker (FORBIDDEN):
//   syncPino({ transport: { target: 'pino-pretty', ... } }, pretty({...}))   // ❌
// Pick the destination-stream form ONLY: syncPino({ ...config }, dest)        // ✅

// CRITICAL — leave `destination` UNSET in pretty({...}). Default = process.stdout
// (synchronous-enough for CLI). Passing a FILE PATH opts into SonicBoom async
// buffering + its OWN process.on('exit') flush — re-introduces the exact hazard
// REQ-L1 forbids. destination: 1 (fd for stdout) is the only safe explicit value.

// CRITICAL — coverage gate is 100% (vitest.config.ts thresholds). Every new branch
// must be hit: getPino() first-load vs memoized; pretty path vs JSON path; the
// interop fallback line (import it via * as and assert default used). If a branch
// is awkward to cover, simplify the code rather than skip the assertion.

// GOTCHA — the EXISTING test 'should not throw when process lacks setMaxListeners
// (partial stub)' (tests/unit/logger.test.ts) covers the process.setMaxListeners?.(30)
// band-aid being REMOVED. After S1, getLogger() never touches setMaxListeners, so
// that test asserts dead behaviour. REPURPOSE it (e.g. assert getLogger() does not
// attach transport exit listeners / does not spawn a Worker). Do NOT leave it
// testing removed code — the coverage gate will complain about untouched branches.

// GOTCHA — do NOT touch src/tools/*-mcp.ts. Those `transport: this.transport` hits
// are MCP transports (unrelated to logging). `rg -n "transport\s*:" src/` will still
// show them after S1 — that is expected and correct. The acceptance grep scopes to
// src/utils/logger.ts ONLY.

// GOTCHA — keep the context-keyed loggerCache working. getCacheKey() includes
// machineReadable in its key, so the pretty logger and the JSON logger for the same
// context are distinct cache entries (both must use sync destinations). Do not
// collapse them. clearLoggerCache()/getGlobalConfig() behaviour unchanged.

// GOTCHA — do NOT remove the messageFormat 'singleLine: false' / the
// '[{correlationId}] [{context}] {msg}' format string. Carry these option values
// verbatim into the pretty({...}) destination call so human-readable output is
// byte-identical to today (only the delivery mechanism changes, not the format).
```

## Implementation Blueprint

### Data models and structure

No data-model changes. `LoggerConfig`, `Logger`, `LogLevel`, `REDACT_PATHS`,
`PINO_LEVELS`, `loggerCache`, `getCacheKey`, `generateCorrelationId`,
`wrapPinoLogger`, `clearLoggerCache`, `getGlobalConfig` are all **unchanged**.
This is a pure construction/lifecycle refactor of the pino instance.

The only new internal shape is a lazy accessor for the pino factory + stdTime:

```ts
// Module-local, memoized. Replaces the eager top-level `await import('module')` block.
type PinoBundle = { pino: any; stdTimeFunctions: any };
let _pinoBundle: PinoBundle | undefined;
function getPino(): PinoBundle {
  // Use createRequire (pino is CommonJS) — same mechanism as today, just deferred.
  if (_pinoBundle) return _pinoBundle;
  const { createRequire } = require('module') as typeof import('module'); // or await import in an async wrapper
  const r = createRequire(import.meta.url);
  const pinoRequire = r('pino');
  const pino = pinoRequire.default ?? pinoRequire;
  _pinoBundle = { pino, stdTimeFunctions: pinoRequire.stdTimeFunctions };
  return _pinoBundle;
}
```
> Note: the current eager block uses `await import('module')`. Inside a sync
> `getPino()` you can `require('module')` directly (Node built-in, sync) — or keep
> it async and `await getPino()` in `getLogger()`. Either is acceptable; pick the
> form that keeps `getLogger()` synchronous if possible (preferred — callers don't
> await it today). Verify with `npm run typecheck`.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: REFACTOR eager pino load → lazy getPino() in src/utils/logger.ts
  - REMOVE: the top-level `{ const { createRequire } = await import('module'); …
            syncPino = require('pino'); syncStdTime = pinoRequire.stdTimeFunctions; }`
            block (runs at module-eval today).
  - REMOVE/CONVERT: the `let syncPino: any = null;` and `let syncStdTime: any = null;`
            module-locals into a single memoized getPino() returning
            `{ pino, stdTimeFunctions }` (see Data models snippet above).
  - KEEP: createRequire(import.meta.url) as the CJS-loading mechanism (pino is CJS).
  - PRESERVE: the existing eslint-disable-next-line comments intent (the file is
            eslint-clean today; don't introduce new lint errors).
  - COVERAGE: getPino() must hit both the first-load branch and the memoized branch.
  - DEPENDENCY: none (do this first; getLogger() in Task 2 consumes getPino()).

Task 2: CONVERT pretty-print from transport: to destination stream
  - EDIT createLoggerConfig(): the `if (!machineReadable)` branch must NO LONGER
            return a `transport: { target: 'pino-pretty', options: {...} }` key.
            Instead return the plain baseConfig (no transport) — the pretty stream
            is now built in getLogger() and passed as the 2nd arg to pino().
  - ADD import at top: `import * as prettyNs from 'pino-pretty';` plus interop:
            `const pretty = (prettyNs as any).default ?? prettyNs;` (top-level const
            for the FACTORY is fine — it does not load pino or spawn a worker).
  - EDIT getLogger(): for the `!machineReadable` path build
            `const dest = pretty({ colorize: true, translateTime: 'HH:MM:ss',
            ignore: 'pid,hostname', messageFormat: '[{correlationId}] [{context}] {msg}',
            singleLine: false })` and pass it as 2nd arg:
            `const pinoLogger = getPino().pino({ ...config, base:{context,correlationId} }, dest)`.
            For the machineReadable path pass NO 2nd arg (unchanged — sync stdout).
            IMPORTANT: compute `machineReadable` from options where createLoggerConfig
            did, OR have createLoggerConfig() expose it; keep the two paths consistent
            so the cache key (which includes machineReadable) still selects the right
            destination. Cleanest: keep createLoggerConfig() returning only the config
            object (no transport), and let getLogger() decide destination from
            options.machineReadable.
  - CARRY the pretty option values VERBATIM (colorize/translateTime/ignore/
            messageFormat/singleLine) so output is byte-identical to today.
  - DO NOT pass `destination:` to pretty() (defaults to process.stdout). No file paths.
  - VERIFY: `rg -n "transport\s*:" src/utils/logger.ts` → ZERO hits after this task.
  - DEPENDENCY: Task 1 (getPino()).

Task 3: REMOVE the process.setMaxListeners?.(30) band-aid in getLogger()
  - DELETE: `if (!loggerCache.size) { process.setMaxListeners?.(30); }` (it existed
            only to absorb transport-worker exit listeners; with sync destinations
            there are no workers, hence no exit listeners to cap).
  - DEPENDENCY: Task 2.

Task 4: UPDATE getLogger() JSDoc in src/utils/logger.ts (Mode A — rides with the work)
  - DOCUMENT: the lazy + synchronous-destination contract.
    - pino is loaded lazily on first getLogger() (no module-eval side effects) —
      supports REQ-L2.
    - both JSON and pretty paths use a synchronous in-process destination; no pino
      `transport:` is ever configured (zero worker threads, zero blocking exit
      handlers) — REQ-L1.
    - a single process-wide root is the REQ-L3 goal (landed by S3; mention the
      direction so the JSDoc does not need re-editing in S3).
  - KEEP the @example block accurate (API unchanged).
  - DEPENDENCY: Tasks 1–3 (document the final shape).

Task 5: UPDATE/ADD tests in tests/unit/logger.test.ts
  - REPURPOSE the existing 'should not throw when process lacks setMaxListeners
            (partial stub)' test: it covered the removed band-aid. Convert it to
            assert that getLogger() does NOT attach transport-related process exit
            listeners / does NOT call process.setMaxListeners at all.
  - ADD a 'REQ-L1 — getLogger() spawns no worker thread' test using the
            worker_threads.Worker spy (external_deps.md §1 Finding 6a):
              const wt = await import('node:worker_threads');
              const spy = vi.spyOn(wt, 'Worker');
              clearLoggerCache();
              getLogger('NoWorkerPretty');                       // pretty path
              getLogger('NoWorkerJson', { machineReadable: true }); // JSON path
              expect(spy).not.toHaveBeenCalled();
            Optionally also assert the destination symbol is not a ThreadStream
            (Finding 6b): import pino; dest = logger[pino.symbols.streamSym];
            expect(dest?.constructor?.name).not.toBe('ThreadStream').
            (Note: accessing the underlying pino instance requires reaching through
            wrapPinoLogger — if not exposed, rely on the Worker spy, which is the
            primary, most-robust assertion.)
  - ADD coverage for getPino(): assert importing the module does NOT load pino, then
            first getLogger() loads it once, second getLogger() reuses the memo.
            (e.g. spy on createRequire / on require('pino') and assert called exactly
            once across two getLogger() calls.)
  - KEEP all existing tests passing (cache, levels, redaction, child, signatures).
  - DEPENDENCY: Tasks 1–3.

Task 6: VERIFY docs/CONFIGURATION.md (conditional — likely a no-op)
  - The item says: refresh `--verbose`/logging prose "if it implies worker-thread
            transports". Verified during PRP research: CONFIGURATION.md mentions
            `--verbose` and `--machine-readable` only in a CLI boolean-flags table
            (lines ~193–194) and implies nothing about worker-thread transports.
  - ACTION: grep CONFIGURATION.md (and the wider docs/) for transport/worker/
            pino-pretty-as-transport language. If none found, make NO edit and note
            the finding in the PRP execution summary. Do NOT fabricate edits.
  - DEPENDENCY: none (can run any time; do last).
```

### Implementation Patterns & Key Details

```ts
// PATTERN — getLogger() builds the destination from options (not from createLoggerConfig).
// createLoggerConfig() returns ONLY the config object (levels, redact, timestamp,
// formatters) and NEVER a transport: key. getLogger() decides the 2nd arg:
export function getLogger(context: string, options?: LoggerConfig): Logger {
  const cacheKey = getCacheKey(context, options);
  const cached = loggerCache.get(cacheKey);
  if (cached) return cached;                       // cache unchanged

  const correlationId = options?.correlationId || generateCorrelationId();
  const config = createLoggerConfig(options);      // no transport: anymore
  const { pino, stdTimeFunctions } = getPino();    // lazy; memoized

  const machineReadable = options?.machineReadable ?? false;
  const dest = machineReadable
    ? undefined                                     // JSON → default stdout (sync)
    : pretty({                                      // human → in-process Transform (sync)
        colorize: true, translateTime: 'HH:MM:ss',
        ignore: 'pid,hostname',
        messageFormat: '[{correlationId}] [{context}] {msg}',
        singleLine: false,
        // CRITICAL: do NOT set destination to a file path (SonicBoom async flush).
      });

  const pinoLogger = dest
    ? pino({ ...config, base: { context, correlationId } }, dest)
    : pino({ ...config, base: { context, correlationId } });

  const logger = wrapPinoLogger(pinoLogger);        // unchanged
  loggerCache.set(cacheKey, logger);
  globalConfig = options ?? {};
  return logger;
}

// GOTCHA — createLoggerConfig()'s `timestamp: syncStdTime?.isoTime ?? fallback` reads
// syncStdTime, which is now inside getPino().stdTimeFunctions. Wire the timestamp
// resolution to getPino() too (or pass stdTimeFunctions in) so the ISO timestamp
// behaviour is identical. Don't leave a stale null syncStdTime reference.
```

### Integration Points

```yaml
CODE (src/utils/logger.ts):
  - remove: top-level `await import('module')` pino-load block
  - remove: `let syncPino` / `let syncStdTime` module-locals (folded into getPino())
  - remove: `if (!loggerCache.size) { process.setMaxListeners?.(30); }` in getLogger()
  - convert: createLoggerConfig() `if (!machineReadable)` transport: branch → plain baseConfig
  - add: `import * as prettyNs from 'pino-pretty'` + interop const
  - add: getPino() memoized accessor; getLogger() passes pretty({...}) as 2nd arg

TESTS (tests/unit/logger.test.ts):
  - repurpose: 'should not throw when process lacks setMaxListeners' → no-worker assertion
  - add: REQ-L1 worker_threads.Worker spy test (pretty + JSON paths)
  - add: getPino() lazy + memoized coverage

DOCS (docs/CONFIGURATION.md): verify-only; edit only if worker-thread prose found.

NO CHANGES TO:
  - wrapPinoLogger, Logger interface, LogLevel, REDACT_PATHS, PINO_LEVELS
  - loggerCache / getCacheKey / clearLoggerCache / getGlobalConfig
  - any of the 31 src/** call sites (owned by S2/REQ-L2)
  - src/tools/*-mcp.ts (MCP transports, unrelated)
  - PRD.md, tasks.json, prd_snapshot.md, .gitignore (READ-ONLY — never touch)
```

## Validation Loop

> Run after the relevant task group. Fix before proceeding to the next level.

### Level 1: Syntax & Style (after Tasks 1–4)

```bash
# Type-check (NodeNext, strict). Must be zero errors.
npm run typecheck

# Lint (eslint .ts). Must be zero errors.
npm run lint

# Format check. Must be clean (fix with `npm run format` if not).
npm run format:check
```
Expected: all three pass. If typecheck flags the createRequire/top-level-await
removal, reconcile getPino()'s sync vs async form.

### Level 2: Unit Tests (after Task 5)

```bash
# Logger tests specifically (fast feedback loop).
npx vitest run tests/unit/logger.test.ts

# Also run build-logger + logger-enhancements (they consume getLogger()).
npx vitest run tests/unit/utils/build-logger.test.ts tests/unit/logger-enhancements.test.ts

# Full unit suite + 100% coverage gate (statements/branches/functions/lines).
npm run test:run
```
Expected: all pass, coverage at 100%. If coverage <100% on logger.ts, a new branch
in getPino() or the destination selection is unexercised — add a test or simplify.

### Level 3: Acceptance grep + no-worker proof (the REQ-L1 gate)

```bash
# PRIMARY ACCEPTANCE — must return ZERO hits.
rg -n "transport\s*:" src/utils/logger.ts
# Expected: <no output>, exit code 1 (no matches).

# Confirm no top-level getLogger() / eager pino load was introduced.
rg -n "await import\('module'\)|top-level" src/utils/logger.ts   # the eager block must be gone

# (S3 owns the full hack --help < 2s e2e, but a quick sanity build is valuable here:)
npm run build
node ./dist/index.js --help        # should print help and exit promptly (no ~10s stall)
node ./dist/index.js --version
```
Expected: grep zero hits; `--help`/`--version` return promptly with no multi-second
exit stall. (The authoritative <2s timing assertion + syscall trace is S3's deliverable;
S1 only needs the worker to be gone and the build healthy.)

### Level 4: Regression — callers still compile

```bash
# Ensure no caller broke from the logger.ts change (S1 keeps the public API stable,
# so this should be a no-op — but verify before handing off to S2).
npm run typecheck
npm run lint
```
Expected: zero errors across src/. (The 31 call sites are migrated in S2; they must
still compile unchanged against S1's getLogger().)

## Final Validation Checklist

### Technical Validation
- [ ] Level 1: `npm run typecheck`, `npm run lint`, `npm run format:check` all pass.
- [ ] Level 2: `npm run test:run` passes with 100% coverage on `src/utils/logger.ts`.
- [ ] Level 3: `rg -n "transport\s*:" src/utils/logger.ts` → **zero hits**.
- [ ] Level 3: no-worker test (`vi.spyOn(worker_threads,'Worker')` not called) passes
      for both pretty and JSON paths.
- [ ] Level 3: `npm run build` succeeds; `node ./dist/index.js --help` exits promptly.
- [ ] Level 4: full `src/` typechecks/lints clean (no caller regressions).

### Feature Validation
- [ ] REQ-L1 satisfied: no `transport:` key, zero worker threads, sync destinations only.
- [ ] Public Logger API, wrapPinoLogger, loggerCache, redaction, levels unchanged.
- [ ] Pretty output is byte-identical (same colorize/translateTime/ignore/messageFormat/
      singleLine option values, just delivered via a destination stream).
- [ ] Pino no longer loaded at module-eval (getPino() memoized, invoked on first getLogger()).
- [ ] `process.setMaxListeners?.(30)` band-aid removed; the repurposed test reflects that.

### Code Quality Validation
- [ ] Follows existing file conventions (JSDoc, eslint-disable placement, createRequire use).
- [ ] No new top-level await; no module-scope side effects beyond a pure const factory import.
- [ ] Interop fallback used for pino-pretty default import (defensive against ESM quirks).
- [ ] Forms never mixed (no `syncPino({transport:…}, pretty())`).

### Documentation
- [ ] getLogger() JSDoc documents the lazy + sync-destination contract (REQ-L1/L2/L3).
- [ ] docs/CONFIGURATION.md checked; edited only if worker-thread prose was actually found.
- [ ] The repurposed unit test name/comment explains WHY (no worker = no exit handler).

---

## Anti-Patterns to Avoid

- ❌ Don't mix forms — `syncPino({ transport: { target:'pino-pretty' } }, pretty())`
  double-formats AND spawns a worker. Destination-stream form ONLY.
- ❌ Don't pass a file `destination:` to `pretty()` — re-introduces SonicBoom async
  flush + a blocking exit handler (the exact thing REQ-L1 forbids).
- ❌ Don't use a named import for pino-pretty (`import { pretty }` is wrong); the
  default export is the factory. Use the interop fallback to be safe.
- ❌ Don't leave the old `setMaxListeners` test asserting removed behaviour —
  repurpose it or the 100% coverage gate fails on untouched branches.
- ❌ Don't touch the 31 module-scope `getLogger()` call sites — that's S2 (REQ-L2).
- ❌ Don't touch `src/tools/*-mcp.ts` `transport:` — those are MCP transports.
- ❌ Don't change the public Logger interface / wrapPinoLogger / cache key shape —
  S2 and S3 depend on the API being stable.
- ❌ Don't add a `logger.flush()` teardown call — sync destinations need none;
  the process can exit as soon as work is done.
