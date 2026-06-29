# Verified Facts — P7.M1.T1.S3 (Single root logger / REQ-L3 + teardown tests)

> Every fact below was **empirically confirmed** against the live repo on 2026-06-29
> using `node` + `npx vitest run` probes (temp files, since removed). These are the
> load-bearing assumptions for the PRP; the test design in `test_strategy.md` is
> derived directly from them.

## 1. S1 (REQ-L1) has ALREADY landed in `src/utils/logger.ts`

The current `src/utils/logger.ts` already contains every S1 change:
- `import * as prettyNs from 'pino-pretty'; const pretty = (prettyNs as any).default ?? prettyNs;` (ESM interop fallback).
- `getPino()` memoized accessor (lazy pino load, deferred out of module-eval).
- `pretty({...})` passed as the **2nd positional argument** to `pino(...)` (destination stream), not a `transport:` key.
- `process.setMaxListeners?.(30)` band-aid **removed**.
- `tests/unit/logger.test.ts` already has a `REQ-L1 — Synchronous destinations` describe block (exit-listener spy, setMaxListeners-not-called, multi-logger no-throw).

**Implication for S3:** S3 consumes S1's getLogger as its input and ADDS the REQ-L3
single-root restructuring ON TOP of it. S3 also OWNS the authoritative teardown tests
(the worker-spy / fast-exit assertions) — they are NOT already present (the existing
REQ-L1 tests are weaker proxies; see §3).

## 2. pino `child()` supports an INDEPENDENT per-child level — CONFIRMED

`node_modules/pino/pino.d.ts:81-88`: "From v2.x.x the log level of a child is mutable
… If a `level` property is present … it will override the child logger level" and
`child(bindings, options?)` where `options: ChildLoggerOptions` carries `level`.

Empirical probe (`root = pino({level:'info'}, prettyDest); child = root.child({ctx}, {level:'trace'})`):
- `child.trace('x')` → **emitted** (level 10 captured in the destination).
- A sibling child at `level:'info'` → its `.trace()` was **filtered out**.
- **Conclusion:** the ROOT's level does NOT gate children. Each child filters
  independently. So a single shared root (any level) + per-child `{ level }` is correct
  and preserves today's per-logger level/verbose semantics exactly.

## 3. `vi.spyOn(worker_threads, 'Worker')` is INOPERATIVE in this vitest setup — DO NOT USE

This is the single most important finding. `external_deps.md §1 Finding 6a` and the
S1 PRP both recommend `vi.spyOn(workerThreads, 'Worker') → expect(notCalled)`. It
**does not work here**:

- `Object.getOwnPropertyDescriptor(worker_threads, 'Worker')` → `{ writable: true, configurable: false }`.
- `vi.spyOn(wt, 'Worker')` → **throws** (spyOn needs `configurable:true` to install its getter/setter).
- Direct assignment `(wt as any).Worker = fn` → **`TypeError: Cannot assign to property 'Worker' of [object Module]`** (the ESM namespace is locked).
- `Object.defineProperty(wt, 'Worker', { get })` → **`Cannot redefine property: Worker`** (configurable:false).

The built-in `worker_threads` namespace is non-configurable and ESM-locked under vitest's
`forks` pool, so neither a spy nor a sentinel patch can intercept pino's internal
`new Worker()`. **Any test using the worker_threads.Worker spy will silently never fire /
throw at install time.** S3 must use the reliable alternatives in §4.

## 4. RELIABLE no-ThreadStream / no-worker proofs (CONFIRMED working)

### 4a. `process.listenerCount('exit'|'beforeExit')` delta — PRIMARY, RELIABLE
A `ThreadStream` always registers a `process.on('exit', onExit)` (+ `beforeExit`) handler
to flush its worker queue. So: **zero new exit/beforeExit listeners during `getLogger()` ⇒
zero ThreadStreams ⇒ zero workers.** Probe across pretty + JSON + verbose loggers:
`exit delta = 0`, `beforeExit delta = 0`. ✔ (Also matches the existing `REQ-L1` exit-listener
spy test, which uses `vi.spyOn(process,'on')` — `process` IS spyable, unlike worker_threads.)

### 4b. `vi.mock('pino-pretty')` delegating factory + call counter — RELIABLE (see §5)
Counts how many destination streams are constructed.

### 4c. Fast-exit e2e (spawn built CLI, measure wall) — AUTHORITATIVE, environment-independent
The real-world proof the requirement actually cares about. See §6.

### 4d. streamSym inspection (`log[pino.symbols.streamSym]`) — OPTIONAL
`pino/lib/symbols.js:20,57` exports `streamSym = Symbol('pino.stream')`. Reachable ONLY on
the raw pino instance, which `wrapPinoLogger` does NOT expose. To use it we'd have to add
a test-only affordance on the wrapper. **Recommendation: skip it** — 4a+4c fully cover the
"no worker / not a ThreadStream" requirement without polluting the public `Logger` interface.
(Documented as an optional strengthening in the PRP.)

## 5. `vi.mock('pino-pretty')` WORKS and proves the REQ-L3 "single destination" claim — CONFIRMED

Probe: `vi.mock('pino-pretty', factory => { count++; return real(...); })`, then 4 pretty
loggers via `getLogger`. **Result: `pretty()` called 4 times** (today = one destination
PER logger). After S3's single-root refactor the SAME assertion sees **1 call**.

- This is the cleanest, most direct **REQ-L3 "one synchronous stream per process"** guard.
- `pino-pretty` is imported by `logger.ts` via ESM (`import * as prettyNs`), and
  `vi.mock` is hoisted ABOVE imports, so the mock replaces `prettyNs.default` BEFORE
  `logger.ts` captures `const pretty = prettyNs.default ?? prettyNs`. ✔
- The mock factory MUST delegate to the real implementation (return `real(opts)`), or
  logger output breaks and other logger tests (run in the same file's isolation) misbehave.
- `vi.mock` is **per-test-file isolated** in vitest, so mocking pino-pretty here does NOT
  affect `tests/unit/logger.test.ts`.

## 6. Built-CLI fast-exit BASELINE (dist/index.js) — CONFIRMED under 2s

`bin.hack = ./dist/index.js` (package.json). Current build (rebuilt 2026-06-29 15:51):
- `node ./dist/index.js --help` → **~572ms / ~563ms** wall (exit 0).
- The ~10.7s stall (PRD §9.6.1) is already gone (S1 removed transports; S2 removes module-
  scope loggers; `--help`/`-h`/`--version`/invalid-flag exit inside `parseCLIArgs()` in
  `src/index.ts` BEFORE `configureEnvironment()` or any `getLogger()`).

**Implication:** the e2e assertion `< 2000ms` is a wide, non-flaky margin (the bug would
show ~10s). The PRD "target <1s excluding cold load" is also met. The teardown e2e is the
**culmination validation** of the whole logging workstream (S1+S2+S3 together).

## 7. CRITICAL gotcha: `base: {}` on the root to preserve output exactly

Today each logger is `pino({ ...config, base: { context, correlationId } }, dest)`. Setting
`base` REPLACES pino's default base `{ pid, hostname }`, so **current output has NO
pid/hostname** (verified against `createLoggerConfig` + `getLogger`).

After S3, the **root** must be built with `base: {}` (empty) to keep suppressing
pid/hostname, and each **child** carries `{ context, correlationId }` as bindings. Net
output is byte-identical (context, correlationId, msg; no pid/hostname). **Forgetting
`base: {}` on the root would re-introduce pid+hostname into every JSON line** = silent
output regression.

(The pretty `messageFormat: '[{correlationId}] [{context}] {msg}'` reads those fields from
the log object; child bindings ARE present in the log object, so messageFormat still works.)

## 8. redaction / timestamp / formatters / customLevels — all root-inherited

`createLoggerConfig()` returns `{ customLevels: PINO_LEVELS, level, redact, timestamp,
formatters }`. These are pino **logger options** set on the root and **inherited by every
child** automatically (pino children share the parent's serializers/redact/formatters).
So: configure ONCE on the root; children only add bindings + override `level`. No
per-logger duplication of config ⇒ no behavioral drift.

## 9. `clearLoggerCache()` MUST also reset the roots

After S3, the roots (`_rootPretty`, `_rootJson`) are module singletons. `clearLoggerCache()`
is called between every test (`tests/unit/logger.test.ts` beforeEach). If it does NOT reset
the roots, tests get stale roots from a previous test's mode. **Required:** add
`_rootPretty = undefined; _rootJson = undefined;` to `clearLoggerCache()`. (The pino BUNDLE
in `getPino()` need NOT be reset — the pino module never changes; only the configured roots do.)

## 10. Coverage gate stays 100% — every new branch is trivially covered

New branches introduced by S3 and where they're hit:
- `getRoot(machineReadable)` true/false → existing tests call both pretty & JSON loggers.
- `_rootJson ??=` / `_rootPretty ??=` memoized outcome → existing tests call the same mode twice (cache tests).
- `resolvedLevel = verbose ? DEBUG : level` → existing verbose/level tests.
- root reset in `clearLoggerCache` → existing "clear cache → new instance" test.

All covered by `tests/unit/logger.test.ts` as-is; the new `logger-teardown.test.ts` adds
the single-destination mock assertion + e2e (which don't add src branches).

## 11. No existing teardown / worker-spy test file

`rg -l "worker_threads|ThreadStream|streamSym|logger-teardown|spawnSync|execFileSync" tests/`
→ only `tests/unit/logger.test.ts` (and it has NO explicit worker_threads spy — only the
process.on('exit') proxy). So S3's new `tests/unit/utils/logger-teardown.test.ts` is net-new;
no duplication, no collision.

## 12. Test-file placement & vitest include

- `vitest.config.ts` `include: ['tests/**/*.{test,spec}.ts']` → `tests/unit/utils/logger-teardown.test.ts` is auto-collected.
- `setupFiles: ['./tests/setup.ts']` runs for every file: loads `.env`, validates the z.ai provider endpoint (§9.2.4 safeguard), tracks unhandled rejections. The teardown e2e spawns `node ./dist/index.js` which exits in `parseCLIArgs()` BEFORE `configureEnvironment()`/endpoint-guard, so endpoint config does **not** affect `--help`/`--version`/invalid-flag timing.
- Coverage `include: ['src/**/*.ts']`; the new test file is itself excluded from coverage (it's a test). Only `src/utils/logger.ts` changes must stay 100%.
