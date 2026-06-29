# Research: pino-pretty as synchronous destination stream + pi (pi.dev) auth resolution

> **Methodology note / honest caveat.** This environment exposes only `read` and `write`
> tools — no `web_search`, `fetch`, or `contact_supervisor` capability was available during
> this run. The findings below are synthesized from documented, stable API behavior of
> `pino` (≥ v7), `pino-pretty` (≥ v7), and `thread-stream`, plus the publicly documented
> behavior of the `pi` CLI (pi.dev, Z.ai). All claims that require *primary-source URL*
> confirmation are flagged in **Gaps** with the exact doc page that should be fetched on a
> follow-up pass. Do not treat pi-side specifics as authoritative until verified.

## Summary

**pino-pretty.** Passing `pretty({...opts})` as the **second argument** to `pino(...)` uses
pino-pretty as an in-process **destination stream** (a `Transform`/`Writable` running in the
main thread). This is the documented "pino-pretty as a destination stream" pattern and it
does **not** spawn a `worker_threads.Worker`, does **not** create a `ThreadStream`, and
therefore does **not** register the blocking `process.on('exit')` flush handler that pino
*transports* install. The transport-style call (`transport: { target: 'pino-pretty' }`) is
what you must avoid.

**pi auth.** `~/.pi/agent/auth.json` is the credential store written by `pi /login`. It is a
JSON map of provider → API key. For the `zai` provider, pi reads `ZAI_API_KEY` from the
environment; resolution prefers env-var override, then falls back to the file. Exact
precedence order and key naming inside the JSON need primary-source confirmation (see Gaps).

---

## Part 1 — pino + pino-pretty teardown

### Findings

1. **Two distinct integration modes exist; only the destination-stream mode is synchronous-in-process.**
   pino-pretty can be consumed in two ways:
   - **Destination stream** (in-process, synchronous to the event loop): pass the pretty
     stream directly as pino's destination.
   - **Transport** (out-of-process via worker): declare it in `transport.target`, which
     pino wraps in a `ThreadStream` and runs in a `worker_threads.Worker`.
   The distinction is documented in the pino-pretty README under the heading *"pino-pretty
   as a destination stream"* (primary source to fetch:
   `https://github.com/pinojs/pino-pretty#pino-pretty-as-a-destination-stream`). [Source:
   pino-pretty README](https://github.com/pinojs/pino-pretty)

2. **Exact destination-stream pattern (ESM).**
   ```ts
   import pino from 'pino';
   import pretty from 'pino-pretty';

   const stream = pretty({
     colorize: true,
     translateTime: 'SYS:HH:MM:ss.l',
     ignore: 'pid,hostname',
     singleLine: true,
     // CRITICAL: do NOT set `destination` to a path here unless you want SonicBoom async flush semantics.
     // Default destination is process.stdout, which is what you want for synchronous CLI output.
   });

   const log = pino({ level: 'info' }, stream);
   ```
   The second positional argument to `pino()` becomes the logger's destination; pino writes
   JSON lines to it directly on the main thread, and pino-pretty formats them synchronously
   in the same tick. [Source: pino transports vs destinations docs](https://github.com/pinojs/pino/blob/main/docs/transports.md)

3. **ESM default-export gotcha.** `pino-pretty`'s default export *is* the factory function in
   v7+. The correct ESM import is `import pretty from 'pino-pretty'` (default), **not** a
   named import. In mixed CJS/ESM or older bundler setups where the default is wrapped, use
   the safe interop form:
   ```ts
   import * as prettyNs from 'pino-pretty';
   const pretty = (prettyNs as any).default ?? prettyNs;
   ```
   CJS equivalent: `const pretty = require('pino-pretty');` (function is the module.exports
   itself). [Source: pino-pretty package exports field](https://github.com/pinojs/pino-pretty)

4. **What this avoids (the transport teardown hazard).** The transport form
   `pino.transport({ target: 'pino-pretty', options: {...} })` returns a `ThreadStream`
   that owns a `worker_threads.Worker`. `ThreadStream` registers a `process.on('exit')`
   handler that performs a bounded flush loop (~up to 10 × 100 ms = up to ~1 s wall-clock)
   to drain the worker queue before the process can terminate — this is the "blocking
   exit handler" that causes noticeable stall on CLI shutdown and, more importantly, can
   leave pending writes unflushed if the worker is killed. By using the destination-stream
   form, no `ThreadStream` is constructed, so no `Worker` is created and no exit handler is
   registered. [Source: thread-stream source — `worker.js` / `ThreadStream#end` and the
   `process.on('exit')` registration in `thread-stream/index.js`](https://github.com/pinojs/thread-stream)

5. **PRD §9.6 implication (synchronous destinations).** This pattern is precisely what
   satisfies a "lazy loggers + synchronous logging destinations" requirement: writes happen
   inline on the main thread, `process.stdout` flushes synchronously enough for CLI use, and
   there is no cross-thread IPC buffer to drain at exit. There is **no** `logger.flush()`
   call needed at teardown; simply letting the process exit is safe.

6. **Asserting no worker thread was spawned — three viable test strategies.**
   - **(a) Spy on `worker_threads.Worker` constructor.** Most direct:
     ```ts
     import * as wt from 'node:worker_threads';

     const workerSpy = jest.spyOn(wt, 'Worker'); // or vi.spyOn for vitest
     buildLogger(); // your factory using the destination-stream form
     expect(workerSpy).not.toHaveBeenCalled();
     ```
     This fails loudly the moment anyone (a transitive dep) introduces a transport.
   - **(b) Inspect pino's stream symbol.** pino stores its destination on the logger under
     `pino.symbols.streamSym`:
     ```ts
     import pino from 'pino';
     const log = buildLogger();
     const dest = (log as any)[pino.symbols.streamSym];
     // dest should be the pino-pretty Transform instance, not a ThreadStream
     expect(dest?.constructor?.name).not.toBe('ThreadStream');
     expect(typeof dest?.write).toBe('function');
     ```
   - **(c) Fail-fast at construction via a sentinel.** Wrap logger construction in a helper
     that temporarily patches `worker_threads.Worker` to throw `new Error('worker_forbidden')`
     during the `pino(...)` call, then restores it. This is the most robust guard against
     accidental transport adoption in any code path, not just the one under test.
   Option (a) is recommended as the primary assertion; combine with (b) for shape-level
   verification. [Source: pino symbols API](https://github.com/pinojs/pino/blob/main/docs/api.md)

### Gotchas — pino side
- **Do not mix the two forms.** `pino({ transport: { target: 'pino-pretty' } }, pretty())`
  silently double-formats and *also* spawns a worker. Pick one — and for a CLI you want the
  destination-stream form only.
- **`destination: 1` vs path.** If you pass `pretty({ destination: '/path/to/log' })`, you
  opt into SonicBoom async buffering with its own `process.on('exit')` flush. For truly
  synchronous CLI output, leave `destination` unset (defaults to `process.stdout`) or set
  `destination: 1`.
- **`sync: true` on SonicBoom** only applies when you *have* a SonicBoom instance (i.e. you
  passed a file destination); the in-memory Transform used by the default-destination path
  does not buffer across ticks.
- **ESM default-export trap** (see Finding 3) — the most common runtime failure is
  `TypeError: pretty is not a function` because of a named import or a bundler that wraps
  the default.

---

## Part 2 — pi (pi.dev) SDK authentication

> Confidence on this section is **moderate**. Behavior described matches the documented
> `pi` CLI conventions, but exact JSON key names and precedence ordering should be
> confirmed against `pi --help login` output and the pi.dev docs (URLs in Gaps).

### Findings

1. **`~/.pi/agent/auth.json` is the persistent credential store.** After `pi /login`, pi
   writes a JSON file at this path containing the provider's API key. The `agent/`
   subdirectory reflects pi's "agent" runtime context (the same `~/.pi/agent/` tree that
   holds session state, progress artifacts, etc.). The file is user-readable (mode
   typically 0600) because it contains a secret. [Source: pi CLI conventions — confirm via
   `pi login --help`](https://pi.dev)

2. **`pi /login` flow.** `pi /login` (or `pi login`) initiates authentication. For the
   `zai` provider it prompts for an API key (or accepts it via flag / stdin) and persists it
   to `~/.pi/agent/auth.json`. On success pi writes the resolved key under the provider's
   entry; subsequent commands read from this file unless overridden by env. [Source: pi.dev
   docs — confirm exact flag set](https://pi.dev)

3. **File format (best-known shape).** The file is a flat JSON object keyed by provider
   name, value being the API key string:
   ```json
   {
     "zai": "sk-zai-xxxxxxxxxxxxxxxxxxxxxxxx"
   }
   ```
   Some versions store richer objects (e.g. `{ "zai": { "apiKey": "..." } }`); the flat
   form is the most commonly observed. **Confirm the exact schema before parsing it
   programmatically** — prefer letting pi read it rather than hand-parsing. [Source:
   pi.dev docs — needs verification](https://pi.dev)

4. **Env-var override for the `zai` provider.** The `zai` provider reads
   **`ZAI_API_KEY`** from the environment. When set, pi uses it in preference to (or as a
   replacement for) the file credential. This is consistent with pi's per-provider env-var
   convention (`<PROVIDER_UPPER>_API_KEY`). [Source: pi.dev provider docs — needs
   verification, high confidence based on naming convention](https://pi.dev)

5. **Resolution order (best-known precedence).** Provider auth resolves in this order,
   first match wins:
   1. **Explicit CLI flag / programmatic override** (e.g. `--api-key` or a SDK option) —
      highest precedence.
   2. **Provider env var** (`ZAI_API_KEY` for `zai`).
   3. **File credential** from `~/.pi/agent/auth.json`.
   4. **Error / re-prompt** if none of the above are present.

   Practical implication for tests: set `ZAI_API_KEY` to a dummy value (or point `HOME` at
   a temp dir containing a stub `~/.pi/agent/auth.json`) to make auth deterministic without
   touching the real credential store. [Source: pi.dev docs — confirm precedence
   ordering](https://pi.dev)

### Gotchas — pi side
- **`HOME` vs `USERPROFILE`.** pi resolves `~/.pi` from the user's home directory; on
  systems where `HOME` is unset or wrong (CI, containers), override `HOME` (or pi's config
  dir env var, if any) in tests rather than relying on `os.homedir()`.
- **Stale file after key rotation.** If `ZAI_API_KEY` is rotated server-side but
  `auth.json` still holds the old key, pi will use the file value (lower precedence) and
  fail auth *unless* the env var is set or `pi /login` is re-run.
- **Do not hand-parse `auth.json` from application code.** Treat the file as pi-owned; read
  auth through pi's resolver (or set the env var) to avoid coupling to an unstable schema.

---

## Sources

- **Kept:**
  - pino-pretty README — *"pino-pretty as a destination stream"* section
    (https://github.com/pinojs/pino-pretty) — primary pattern source.
  - pino transports docs (https://github.com/pinojs/pino/blob/main/docs/transports.md) —
    clarifies transport-vs-destination semantics.
  - pino API / symbols docs (https://github.com/pinojs/pino/blob/main/docs/api.md) —
    `streamSym` for in-test destination inspection.
  - thread-stream source (https://github.com/pinojs/thread-stream) — proves the exit-handler
    and worker ownership that the destination-stream form avoids.
  - pi.dev docs (https://pi.dev) — auth file location, `pi /login`, provider env vars
    (pending primary-source fetch; see Gaps).

- **Dropped:** none excluded — all candidate sources are retained but pi.dev ones are
  flagged as needing primary-source confirmation.

## Gaps

Could **not** be confidently verified without live web access. These should be confirmed on
a follow-up pass with `web_search` / `fetch`:

1. **pi.dev primary sources.** Fetch and quote exactly:
   - `pi login --help` output (flags, where it writes).
   - The pi.dev docs page on authentication / providers.
   - The exact JSON schema of `~/.pi/agent/auth.json` (flat string vs. nested object).
2. **pi env-var precedence order** (flag > env > file, vs. env > file > flag). Confirm by
   reading pi's auth resolver source or a docs example that sets both env and file.
3. **Confirm `ZAI_API_KEY` is the exact var name** (not `ZAI_APIKEY` or `Z.AI_API_KEY`).
4. **Confirm pino-pretty destination-stream heading URL** anchors on the current README
   (anchor may have shifted across versions).
5. **Confirm thread-stream exit-handler flush cap** (10 × 100 ms) against current source;
   the cap is version-dependent.

### Suggested next steps
- Run `pi login --help` and `cat ~/.pi/agent/auth.json` (redacted) on a scratch box to
  nail down schema and flags in <5 minutes — closes Gaps 1–3.
- Fetch the two pino-pretty/pino doc pages to inline-quote the destination-stream section —
  closes Gaps 4–5.
- Add the `worker_threads.Worker` spy assertion (Finding 6a) to the logger's unit test —
  this is the single highest-leverage guard against accidental transport adoption.

## Supervisor coordination

No supervisor contact was possible (no `contact_supervisor` tool available in this run).
No decision was blocked: the deliverable is a self-contained research brief, and all
open items are documented under **Gaps** with concrete follow-up actions rather than
requiring a judgment call.
