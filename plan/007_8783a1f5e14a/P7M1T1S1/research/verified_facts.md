# Verified Facts — P7.M1.T1.S1 (Synchronous logger destinations, REQ-L1)

Facts verified directly against this repo's `node_modules` and test config on 2026-06-29.
These complement (and confirm) the research already captured in
`plan/007_8783a1f5e14a/architecture/external_deps.md` Part 1.

## 1. pino `symbols.streamSym` exists (for the no-worker test assertion)

```
$ node -e "const p=require('pino'); console.log(p.symbols.streamSym)"
Symbol(pino.stream)
```

→ The destination of any pino logger can be inspected at runtime via
`logger[pino.symbols.streamSym]`. The teardown test can assert this destination is
**not** a `ThreadStream` (i.e. `dest.constructor.name !== 'ThreadStream'`).
Source: pino API/symbols docs — https://github.com/pinojs/pino/blob/main/docs/api.md

## 2. `pino-pretty` default export IS the factory function (ESM import is correct)

```
$ node -e "const p=require('pino-pretty'); console.log(typeof p, typeof p.default)"
function function
```

→ Both `import pretty from 'pino-pretty'` (default) and the interop fallback
`(prettyNs as any).default ?? prettyNs` resolve to the factory. **Belt-and-suspenders:
use the interop form** so a future bundler/Node ESM quirk can't break it.
The vitest config already sets `deps: { interopDefault: true }` (vitest.config.ts),
so default imports resolve cleanly under test.

Versions installed:
- `pino` 9.14.0 (CommonJS, `"main": "pino.js"`)
- `pino-pretty` 11.3.0 (CommonJS, default export = factory)

## 3. The ONLY logging `transport:` in `src/` is in `src/utils/logger.ts`

```
$ rg -n "transport\s*:" src/utils/logger.ts
318:      transport: {                 ← inside createLoggerConfig(), if (!machineReadable) branch
```

Confirmed the three `transport: this.transport` hits in `src/tools/*-mcp.ts` are
**MCP transports, unrelated** to logging. S1 touches only `src/utils/logger.ts`.

## 4. The three change sites in `src/utils/logger.ts`

| # | Site | Location (current) | Change |
|---|------|--------------------|--------|
| A | Eager pino load (top-level `await` module-eval block) | the `{ const { createRequire } = await import('module'); … syncPino = require('pino'); syncStdTime = pinoRequire.stdTimeFunctions; }` block + the `let syncPino` / `let syncStdTime` declarations | Move into a memoized `getPino()` accessor invoked lazily on first `getLogger()` |
| B | Pretty-print as `transport:` | `createLoggerConfig()` → `if (!machineReadable)` return with `transport: { target: 'pino-pretty', … }` (line 318) | Build `pretty({...})` as a DESTINATION and pass as 2nd arg to `syncPino({...config}, dest)` in `getLogger()`. `createLoggerConfig()` no longer returns a `transport:` key |
| C | `process.setMaxListeners?.(30)` band-aid | `getLogger()` → `if (!loggerCache.size) { process.setMaxListeners?.(30); }` | Remove entirely (no workers → no exit listeners to cap) |

## 5. Existing test that MUST be updated (not deleted)

`tests/unit/logger.test.ts` has:

> `it('should not throw when process lacks setMaxListeners (partial stub)', …)`

This test exists to cover the `process.setMaxListeners?.(30)` band-aid being REMOVED
in Site C. After S1, `getLogger()` never touches `process.setMaxListeners`, so this
test is left asserting a behaviour that no longer exists. **Action:** repurpose it
into an assertion that `getLogger()` does NOT attach transport exit listeners / does
NOT spawn a worker (see external_deps.md §1 Finding 6). Do not silently leave it
testing dead code — the 100% coverage gate will flag untouched branches.

## 6. Test infra facts (affect how the no-worker test must be written)

- Framework: **vitest**, `globals: true`, `pool: 'forks'`. Use `vi.spyOn`, `vi.stubGlobal`.
- **100% coverage threshold** (statements/branches/functions/lines) on `src/**/*.ts`
  → every new branch in `getPino()` (first-load vs memoized) and both pretty/JSON
  paths must be exercised by tests.
- `tests/setup.ts` runs before all tests (loads `.env`, enforces z.ai endpoint guard).
- The `hack` binary is `"bin": { "hack": "./dist/index.js" }` → the full `hack --help < 2s`
  end-to-end timing test requires `npm run build` first. **That e2e test belongs to
  S3 (REQ-L3 teardown validation); S1 adds only the in-process `worker_threads.Worker`
  spy assertion**, which does not require a build.

## 7. CONFIGURATION.md has NO worker-thread transport prose

`docs/CONFIGURATION.md` mentions `--verbose` and `--machine-readable` only in a
boolean-flags CLI table (lines 193–194). It does **not** imply worker-thread
transports anywhere. → The item's conditional DOCS task ("refresh … if it implies
worker-thread transports") is satisfied as-is. **No edit required** unless the
implementer finds prose elsewhere; flag the finding rather than fabricating edits.

## 8. What S1 does NOT touch (scope guardrails — other subtasks own these)

- **S2 (REQ-L2):** the 31 top-level `const logger = getLogger('X')` declarations
  across `src/`. S1 keeps `getLogger()`'s public API identical so S2 can migrate
  call sites independently. Verified count: `rg -n "^(export )?(const|let) \w+ = getLogger\(" src/ | wc -l` == 31.
- **S3 (REQ-L3):** single root logger + the `hack --help` wall-time e2e test.
- **`wrapPinoLogger`, `Logger` interface, `loggerCache`, redaction, levels:**
  unchanged. No public API change in S1.
