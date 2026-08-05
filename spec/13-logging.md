### 9.6 Logging Architecture (Lazy Loggers & Synchronous Destinations)

Cross-cutting requirement for the structured-logging subsystem (the §7.3 "Observability" improvement). The pipeline is a **CLI that calls `process.exit()` on every code path** — `--help`, `--version`, PRD validation, and full pipeline runs alike — so logging must be designed for fast process teardown, not for long-running services.

#### 9.6.1 Problem

`getLogger()` historically configured every logger with a pino **transport**:

```ts
transport: { target: 'pino-pretty', options: { /* ... */ } }
```

A pino transport spawns a **worker thread** (`ThreadStream`) per logger. pino registers one `process.on('exit', onExit)` handler per `ThreadStream` (`pino/lib/transport.js`), and that handler runs `stream.flushSync()` + `sleep(100)` + `stream.end()` **synchronously** during exit. Meanwhile, **31 modules** called `getLogger('…')` at **top-level (module-evaluation) scope**. Because `getLogger()`'s cache is keyed by context string and every module used a distinct context, each top-level call constructed an independent logger (and its own worker thread) during `import` — before the CLI parsed any arguments.

Measured consequences (the bug that motivated this section):

- Every invocation — `--help`, `-h`, `--version`, `-V`, unknown flags (exit 1), `inspect --help` — took ~10.7s wall time but only ~1.6s CPU.
- Commander printed help and called `process.exit(0)` at ~+535ms, yet the process did not terminate for ~10s more (the event loop was frozen).
- Exactly 13 pino `exit` handlers ran **sequentially**, totaling **10,111ms** — the entire stall.
- Stubbing `ThreadStream` shutdown reduced `--help` from 10.71s to 1.94s, confirming the cost is teardown-bound, not work-bound.

The stall is therefore deterministic and argument-independent: the loggers are created at import time, so every code path pays for them regardless of whether it logs a single line.

#### 9.6.2 Requirements

These requirements are **binding** for any code that constructs or configures a logger.

**REQ-L1 — Synchronous destinations only (no worker-thread transports).**
The CLI must never configure a pino `transport:` (which spawns a worker thread). Pretty-printing, when enabled, must run in-process via a synchronous destination stream — for example `pino-pretty` applied as a direct destination rather than as a transport target:

```ts
// FORBIDDEN in this CLI: spawns a worker thread + a blocking exit handler
pino({ transport: { target: 'pino-pretty' /* ... */ } });

// REQUIRED: pretty-print as a synchronous in-process destination
import pretty from 'pino-pretty';
pino(
  {
    /* ...config */
  },
  pretty({ colorize: true /* ... */ })
);
```

Transports exist to keep logging off the hot path of long-running **services**; in a CLI that exits via `process.exit()`, each transport adds one worker-thread spawn and one blocking exit handler. The machine-readable (JSON) path already uses a sync destination; the human-readable path must match it.

**REQ-L2 — Lazy logger instantiation (no module-scope loggers).**
Loggers must not be constructed at module top-level scope. A top-level `const logger = getLogger('Foo')` forces the logger to be built during `import` — before the CLI has parsed arguments or decided whether to run — which defeats every short-circuit code path (`--help`, validation, dry-run). Loggers must be obtained lazily:

- Hold the logger behind a lazy accessor (e.g. a private field populated on first use, or a memoized module-local `function logger()`), so it is constructed only by code paths that actually log.
- All existing top-level `const logger = getLogger(...)` declarations in `src/` must be migrated to lazy instantiation when this section is implemented.

`getLogger()`'s existing context-keyed cache already prevents duplicate instances per context; laziness additionally prevents construction on code paths that never log.

**REQ-L3 — Single root logger per process.**
Components running in the same process should derive their loggers from a single shared root rather than each constructing an independent logger, bounding the total number of destinations to **one per process** (one synchronous stream, zero worker threads).

#### 9.6.3 Acceptance Criteria

- `hack --help`, `hack -h`, `hack --version`, and an invalid flag each return in **under 2 seconds** (target <1s excluding cold Node/module load), with no `ThreadStream` worker threads spawned during the invocation.
- No `getLogger(...)` call exists at module top-level scope in `src/`. (Verification: `rg -n "^(export )?(const|let) \w+ = getLogger\(" src/` must return zero hits.)
- No `transport:` key appears in any logger configuration under `src/`; pretty-printing is delivered via a synchronous stream destination.
- A syscall-level trace of `hack --help` shows no multi-second blocking `epoll_pwait`/`futex` attributable to process exit.
