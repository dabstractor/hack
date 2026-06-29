# Test Strategy — P7.M1.T1.S3 teardown validation

> Single source of truth for the `tests/unit/utils/logger-teardown.test.ts` design.
> Every assertion below was **proven viable** via throwaway vitest probes (see
> `verified_facts.md` §3–§6). The worker_threads.Worker spy (recommended by
> `external_deps.md §1 Finding 6a` and the S1 PRP) is **deliberately NOT used** — it
> is inoperative in this vitest/forks setup (§3).

## File: `tests/unit/utils/logger-teardown.test.ts` (net-new)

The contract names exactly this path (`tests/unit/utils/logger-teardown.test.ts` or
extend `logger.test.ts`). We create a dedicated file because teardown validation is a
distinct concern and mixes a unit-level no-ThreadStream/single-destination suite with an
integration-level subprocess-timing suite.

The file has THREE describe blocks:

### A. `REQ-L3 — Single root logger (one destination per output mode)`

Uses `vi.mock('pino-pretty', …)` with a **delegating** factory that counts calls. Hoisted
above the `import { getLogger }`, so it replaces `prettyNs.default` before `logger.ts`
captures it.

```ts
let prettyCalls = 0;
vi.mock('pino-pretty', async (importOriginal) => {
  const orig = await importOriginal();
  const real = (orig as any).default ?? orig;
  const factory = (...args: unknown[]) => { prettyCalls++; return real(...args); };
  return { ...(orig as object), default: factory };
});
import { getLogger, clearLoggerCache } from '../../../src/utils/logger.js';
```

Tests:
1. **pretty mode creates the destination exactly once.** `clearLoggerCache()`; `prettyCalls=0`;
   call `getLogger` for 4+ distinct pretty contexts/options (incl. verbose, explicit level);
   `expect(prettyCalls).toBe(1)` (was **4** before S3 — the regression this guards).
2. **JSON mode never touches the pretty factory.** `getLogger('x',{machineReadable:true})` ×N;
   `expect(prettyCalls).toBe(0)` (JSON uses stdout, no pretty Transform).
3. **Child loggers reuse the same destination.** Build a logger, `.child()` twice, log through
   the grandchildren; assert no throw AND `prettyCalls` unchanged (children share root stream).

> Note: because `vi.mock` is per-file isolated, this does **not** affect
> `tests/unit/logger.test.ts` or any other file.

### B. `REQ-L3 — No worker thread / no ThreadStream on construction` (PRIMARY no-worker proof)

The worker_threads.Worker spy is **unusable** (verified_facts §3). Use the reliable proxies:

1. **`process.listenerCount` delta (no exit/beforeExit handlers).**
   ```ts
   const beforeExit = process.listenerCount('exit');
   const beforeBE = process.listenerCount('beforeExit');
   clearLoggerCache();
   getLogger('A'); getLogger('B', { machineReadable: true }); getLogger('C', { verbose: true });
   expect(process.listenerCount('exit') - beforeExit).toBe(0);
   expect(process.listenerCount('beforeExit') - beforeBE).toBe(0);
   ```
   A `ThreadStream` always registers an `exit`+`beforeExit` handler; zero delta ⇒ zero
   ThreadStream ⇒ zero workers.
2. **`vi.spyOn(process,'on')` confirms no transport-exit registration** (mirrors the existing
   REQ-L1 test; `process` IS spyable). Asserts no `'exit'`/`'beforeExit'`/`'SIGINT'` added.
3. **OPTIONAL streamSym inspection** (only if a raw-pino affordance is added to the wrapper;
   otherwise skip — see verified_facts §4d). Not required.

### C. `Teardown — fast CLI exit (< 2s)` (AUTHORITATIVE, environment-independent)

Spawns the **built** binary `node ./dist/index.js` (`bin.hack`). Requires a prior
`npm run build` (the PRP validation gate does this; see Level 4).

```ts
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const CLI = resolve(process.cwd(), 'dist/index.js');
const TWO_SECONDS_MS = 2000;

function runCli(args: string[]) {
  const start = Date.now();
  const res = spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    timeout: 10_000,          // hard kill long before the old ~10s stall could ever mask a pass
    env: { ...process.env },  // --help exits in parseCLIArgs() before any endpoint/env work
  });
  return { ms: Date.now() - start, status: res.status, stdout: res.stdout };
}

const hasBuild = existsSync(CLI);
const describeOrSkip = hasBuild ? describe : describe.skip;
```

Tests (`describeOrSkip` so `npm run validate` without a build stays green; the PRP Level-4
gate builds first so these actually run):
1. `--help`  → `expect(ms).toBeLessThan(TWO_SECONDS_MS)` AND `status === 0`.
2. `-h`      → `< 2s`, status 0.
3. `--version` → `< 2s`, status 0.
4. invalid flag (e.g. `--no-such-flag`) → `< 2s`, status ≠ 0 (Commander error exit 1).

`timeout: 10_000` guarantees a regressed ~10s stall still FAILS (the spawn would be killed
and `.status === null`, failing the status check) rather than silently passing.

## Coverage

The new file adds NO `src/` coverage burden (it's a test). `src/utils/logger.ts` 100%
coverage is preserved by the REQ-L3 refactor's trivially-covered branches
(verified_facts §10).

## Why not extend `logger.test.ts`?

The contract allows either. A dedicated file is cleaner because:
- `vi.mock('pino-pretty')` would change pino-pretty's behavior for the WHOLE file if
  added to `logger.test.ts` (even though per-file isolated, it would still apply to every
  test in that file, complicating the existing redaction/child/format assertions).
- The subprocess-timing suite is a different concern (integration vs unit).
- Keeps S3's deliverable self-contained and easy to audit against REQ-L3.
