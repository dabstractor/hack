# Scout 2 — Process-Exit / Signal-Handler / Cleanup-Registry Patterns

Target: P3.M2.T6.S2 (temp-file cleanup on graceful SIGTERM/SIGINT/exit + best-effort SIGKILL, PRD §9.3.3).
S2 MUST follow the `src/core/file-lock.ts` module-level pattern EXACTLY. This doc captures that pattern verbatim, the existing test, the contrast with the per-run pipeline handlers, and the gotchas.

---

## Files Retrieved

1. `src/core/file-lock.ts` (lines 1-31) — module-level header doc + three-layer architecture notes.
2. `src/core/file-lock.ts` (lines 233-299) — `acquireFileLock`, `releaseFileLock`, `tryUnlink` (idempotent unlink primitives).
3. `src/core/file-lock.ts` (lines 345-382) — `_heldLockPaths` registry declaration + `withFileLock` add/delete pairing.
4. `src/core/file-lock.ts` (lines 410-432) — `acquireTasksJSONLock` / `releaseTasksJSONLock` add/delete.
5. `src/core/file-lock.ts` (lines 520-560) — `withLockedTasksJSON` add/delete in try/finally.
6. `src/core/file-lock.ts` (lines 567-615) — **THE PATTERN**: `cleanupHeldLocks`, `onLockCleanupSignal(code, mockExit)`, `onSIGINTCleanup`, `onSIGTERMCleanup`, and the three `process.on(...)` registration lines.
7. `tests/unit/core/file-lock.test.ts` (lines 1-31) — imports of the `@internal` handlers.
8. `tests/unit/core/file-lock.test.ts` (lines 413-471) — the `describe('process cleanup handlers')` block with the `mockExit` trick.
9. `src/workflows/prp-pipeline.ts` (lines 225-240) — per-run handler class fields.
10. `src/workflows/prp-pipeline.ts` (lines 395-443) — `#setupSignalHandlers()` (first/second SIGINT, SIGTERM, registration).
11. `src/workflows/prp-pipeline.ts` (lines 1428-1485) — `cleanup()` with `process.off(...)` removal.
12. `PRD.md` (lines 566-573) — §9.3.3 requirement: temp files MUST be cleaned on graceful AND hard-killed (SIGTERM/SIGKILL/power-loss) exits.

---

## Focus 1 — `src/core/file-lock.ts` registry + handler pattern (THE canonical template)

### (a) Module-level registry shape

`src/core/file-lock.ts:345-352` — a plain module-level `Set<string>`:

```ts
/**
 * Set of lockfile paths currently held by THIS process, for best-effort
 * cleanup on graceful exit / signal handlers (belt-and-suspenders). The PID +
 * mtime stale detector is the authoritative crash-recovery mechanism (it alone
 * handles SIGKILL/OOM/segfault, where signal handlers do NOT fire).
 *
 * @internal
 */
const _heldLockPaths = new Set<string>();
```

- Leading underscore + `@internal` = private to the module, never exported.
- Registry is MUTATED in symmetric pairs. Every acquire site does `_heldLockPaths.add(lockPath)` and every release site (in a `finally`) does `_heldLockPaths.delete(lockPath)`. The four add/delete pairs:
  - `withFileLock` → `src/core/file-lock.ts:377` (add) / `:382` (delete in `finally`)
  - `acquireTasksJSONLock` / `releaseTasksJSONLock` → `:415` (add) / `:430` (delete)
  - `withLockedTasksJSON` → `:538` (add) / `:555` (delete in inner `finally`)

### (b) `cleanupHeldLocks()` iteration — `src/core/file-lock.ts:567-580`

```ts
/**
 * Release every still-held lockfile on graceful exit. Does NOT help for
 * SIGKILL/OOM/segfault — the PID+mtime stale detector handles those.
 *
 * Exported so the process-signal handlers below can be unit-tested directly
 * (they cannot be exercised via a real signal without terminating the test
 * process).
 *
 * @internal
 */
export function cleanupHeldLocks(): void {
  for (const p of _heldLockPaths) {
    releaseFileLock(p);
  }
}
```

- Iterates the Set and calls `releaseFileLock(p)` on each. It does NOT clear the Set explicitly, but `releaseFileLock` → `tryUnlink` is idempotent so a re-run is a safe no-op (see gotcha — the registry is read-only here; clearing is moot because process is exiting).
- `releaseFileLock` (`:284-292`) just calls `tryUnlink`, and `tryUnlink` (`:297-307`) swallows all errors (ENOENT race, EACCES) — this is what makes the whole chain idempotent and never-throwing:
  ```ts
  function releaseFileLock(lockPath: string): void {
    tryUnlink(lockPath);
  }
  export function tryUnlink(lockPath: string): boolean {
    try {
      unlinkSync(lockPath);
      return true;
    } catch {
      // already gone / no permission — fine; lock is effectively released.
      return false;
    }
  }
  ```

### (c) `onLockCleanupSignal(code, mockExit)` — `src/core/file-lock.ts:583-599`

```ts
/**
 * Signal/exit handler: release held locks, then exit with the given code.
 * Exported for direct unit testing of both the SIGINT (130) and SIGTERM (143)
 * code paths without terminating the test process.
 *
 * @param code - Process exit code to pass through (130 = SIGINT, 143 = SIGTERM).
 * @param mockExit - Injectable exit hook (defaults to `process.exit`) so the
 *                   handler can be exercised without terminating the process.
 * @internal
 */
export function onLockCleanupSignal(
  code: number,
  mockExit: (code: number) => void = c => process.exit(c)
): void {
  cleanupHeldLocks();
  mockExit(code);
}
```

**This is the key testability seam.** `mockExit` is an injectable second parameter that defaults to `c => process.exit(c)`. The default is a *function expression* that re-reads `process.exit` at call time — so a `vi.spyOn(process, 'exit')` installed before the call IS picked up even when no explicit mock is passed (default param evaluates the body when the arg is `undefined`). Order: cleanup FIRST, then exit.

### (d) `onSIGINTCleanup` / `onSIGTERMCleanup` — `src/core/file-lock.ts:601-611`

```ts
/** Registered SIGINT handler (exported so the registration site has no
 * anonymous arrow body that would otherwise be uncoverable). @internal */
export function onSIGINTCleanup(): void {
  onLockCleanupSignal(130);
}

/** Registered SIGTERM handler (exported so the registration site has no
 * anonymous arrow body that would otherwise be uncoverable). @internal */
export function onSIGTERMCleanup(): void {
  onLockCleanupSignal(143);
}
```

- Exit codes are the shell convention: `128 + signum` → SIGINT=2 → **130**, SIGTERM=15 → **143**.
- The thin wrappers exist for ONE reason stated in the JSDoc: *"exported so the registration site has no anonymous arrow body that would otherwise be uncoverable"* — i.e. `process.on('SIGINT', onSIGINTCleanup)` is a named reference (coverable) instead of `process.on('SIGINT', () => {...})` (the arrow would be an untestable anonymous body). **S2 must replicate this — never put the cleanup body inline in the `process.on` call.**

### (e) The `process.on(...)` registration lines — `src/core/file-lock.ts:613-615`

```ts
process.on('exit', cleanupHeldLocks);
process.on('SIGINT', onSIGINTCleanup);
process.on('SIGTERM', onSIGTERMCleanup);
```

- These run at **MODULE LOAD TIME** (top level, not inside a function). Registered ONCE per process. There is NO `process.off` anywhere in `file-lock.ts` (confirmed by grep: zero matches for `process.off`/`once`/`removeListener`/`removeAllListeners`).
- `exit` handler = `cleanupHeldLocks` only (no `process.exit` — you cannot call `process.exit` inside an `exit` handler; Node ignores it). The signal handlers route through `onLockCleanupSignal` which DOES call exit.

### (f) JSDoc SIGKILL/OOM/segfault note (best-effort) — QUOTED

The SIGKILL limitation appears in two JSDoc blocks:

1. Registry doc (`src/core/file-lock.ts:348-349`):
   > *"The PID + mtime stale detector is the authoritative crash-recovery mechanism (it alone handles SIGKILL/OOM/segfault, where signal handlers do NOT fire)."*

2. `cleanupHeldLocks` doc (`src/core/file-lock.ts:568`):
   > *"Release every still-held lockfile on graceful exit. **Does NOT help for SIGKILL/OOM/segfault — the PID+mtime stale detector handles those.**"*

**Contrast with PRD §9.3.3:** the PRD (lines 572-573) requires temp files to be cleaned on *"both graceful and hard-killed (SIGTERM/SIGKILL/power-loss) exits."* The file-lock.ts answer to SIGKILL is NOT a handler (impossible — SIGKILL cannot be caught) but a **recovery mechanism** (the stale-lock detector). S2 must decide its own SIGKILL story for temp files; a signal handler alone cannot satisfy the PRD's "hard-killed" clause. Candidate approaches for S2 to evaluate (NOT decided here): a startup sweep of a known temp dir/prefix, PID-stamped temp names + liveness check, or re-write-on-every-attempt (the PRD's own retry-resilience note, line 573).

---

## Focus 2 — `src/workflows/prp-pipeline.ts` per-run handlers (CONTRAST)

The pipeline is **per-run instance** (a class), the OPPOSITE of file-lock.ts's module-level singleton. S2 should match **file-lock.ts**, but the pipeline is a useful reference for the second-SIGINT + `process.off` cleanup patterns.

### Class fields — `src/workflows/prp-pipeline.ts:231-237`
```ts
/** SIGINT event handler reference */
#sigintHandler: (() => void) | null = null;
/** SIGTERM event handler reference */
#sigtermHandler: (() => void) | null = null;
/** Counter for duplicate SIGINT (force exit) */
#sigintCount: number = 0;
```
Handlers are stored in fields specifically so they can be passed to BOTH `process.on` and later `process.off` (identity removal).

### `#setupSignalHandlers()` — `src/workflows/prp-pipeline.ts:403-443`
- SIGINT: increments `#sigintCount`; on `> 1` just logs *"Duplicate SIGINT received - shutdown already in progress"* and returns (idempotent / no-op on repeat). On first, sets `shutdownRequested = true` + `shutdownReason = 'SIGINT'`.
- SIGTERM: sets the same flags, `shutdownReason = 'SIGTERM'` (no count — single shot).
- Registration: `process.on('SIGINT', this.#sigintHandler)` / `process.on('SIGTERM', this.#sigtermHandler)`.

### Cleanup — `src/workflows/prp-pipeline.ts:1436-1441` and `:1470-1475`
The `cleanup()` method removes listeners to avoid leaks (important for a long-lived process that may create multiple pipeline instances):
```ts
if (this.#sigintHandler) {
  process.off('SIGINT', this.#sigintHandler);
}
if (this.#sigtermHandler) {
  process.off('SIGTERM', this.#sigtermHandler);
}
```
This `process.off` pattern appears in TWO branches of `cleanup()` (one early-return when no session, one on the normal path). **file-lock.ts does NOT do this** because it is module-level and outlives any single run.

---

## Focus 3 — existing test: `tests/unit/core/file-lock.test.ts`

**Path:** `tests/unit/core/file-lock.test.ts` (unit test, REAL tmpdir + real fs, NO `vi.mock('node:fs')`).

### Imports (`:18-31`) — all `@internal` handlers imported directly:
```ts
import {
  withLockedTasksJSON, withFileLock, acquireTasksJSONLock, releaseTasksJSONLock,
  isProcessAlive, isStaleLock, acquireFileLock, tryUnlink,
  cleanupHeldLocks, onLockCleanupSignal, onSIGINTCleanup, onSIGTERMCleanup,
  TasksLockAcquisitionError,
} from '../../../src/core/file-lock.js';
```

### The `describe('process cleanup handlers')` block (`:413-471`)
Has `afterEach(() => { vi.restoreAllMocks(); })` (`:416-418`) to reset `process.exit` spies between tests.

**The `mockExit` trick — two variants:**

**Variant A — explicit injectable (for `onLockCleanupSignal(code, mockExit)`):** `:418-432`. Holds a real lock inside `withFileLock`, then passes a capturing arrow as the second arg so the test does NOT terminate:
```ts
it('onLockCleanupSignal releases held locks and exits with the given code', async () => {
  const dataPath = join(dir, 'cleanup.json');
  const lockPath = dataPath + '.lock';
  let exitCode: number | undefined;
  await withFileLock(dataPath, async () => {
    expect(existsSync(lockPath)).toBe(true);
    onLockCleanupSignal(130, c => {     // ← injectable mockExit: capture, don't exit
      exitCode = c;
    });
    return undefined;
  });
  expect(exitCode).toBe(130);
});
```

**Variant B — `vi.spyOn(process, 'exit')` (for the no-arg wrappers `onSIGINTCleanup`/`onSIGTERMCleanup` and the default-path test):** These wrappers take NO args, so the exit hook CANNOT be injected. The test neutralizes `process.exit` itself:
```ts
it('onSIGINTCleanup exits with code 130', () => {
  let exitCode: number | undefined;
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((
    c?: number
  ) => { exitCode = c; }) as never);
  onSIGINTCleanup();                       // no mock arg → default c => process.exit(c)
  expect(exitCode).toBe(130);
  expect(exitSpy).toHaveBeenCalledWith(130);
});
```
- The `as never` cast is required because TS's `process.exit` signature differs from the spy's single-arg shim.
- This works ONLY because the default param `c => process.exit(c)` re-resolves `process.exit` at call time, so the spy is hit.

**Other assertions:**
- `:436-442` default-to-`process.exit` path: `onLockCleanupSignal(143)` with no mock → `expect(exitSpy).toHaveBeenCalledWith(143)`.
- `:469-471` safe no-op: `expect(() => cleanupHeldLocks()).not.toThrow()` when the registry is empty.
- NOTE: the test for `onLockCleanupSignal(130, ...)` (`:418`) does NOT assert the lockfile was actually unlinked from disk — it runs INSIDE `withFileLock`'s still-held section, relying on `releaseFileLock` idempotency. The assertion is only `exitCode === 130`. **S2 may want a stronger disk-level assertion** (acquire, then call cleanup OUTSIDE the held section, then assert `!existsSync(lockPath)` and that the registry emptied).

### How 'exit' vs SIGINT vs SIGTERM are tested separately
They are NOT tested separately via the `process.on` registration. The unit tests call the **named handler functions directly** (`onSIGINTCleanup()`, `onSIGTERMCleanup()`, `cleanupHeldLocks()`, `onLockCleanupSignal(code)`). **The module-level `process.on('exit', ...)` / `process.on('SIGINT', ...)` / `process.on('SIGTERM', ...)` registration lines (`:613-615`) are NOT covered by any test** — grep for `process.on(`/`process.off(`/`listenerCount` in the test file returns ZERO matches. This is a deliberate coverage gap (the registration is a single line with no branching). S2 should be aware that matching this style means the registration site itself is untested.

---

## Gotchas / risks for S2

1. **Handler idempotency (REQUIRED).** `cleanupHeldLocks` may run during `process.on('exit')` AND again from a signal handler, and the signal handlers (`130`/`143`) always run cleanup then exit. The `exit` event fires AFTER `process.exit()` is called. So on SIGINT: `onSIGINTCleanup` → `cleanupHeldLocks()` → `process.exit(130)` → Node fires `exit` → `cleanupHeldLocks()` runs AGAIN. This is safe ONLY because `releaseFileLock`/`tryUnlink` swallow ENOENT and never throw. **S2's temp-file cleanup MUST be similarly idempotent** (unlink-missing is a no-op, never throws). A non-idempotent cleanup (e.g. one that iterates a Map and throws on double-removal) will crash the exit handler.

2. **`process.off` on graceful shutdown — DON'T, for module-level.** file-lock.ts has NO `process.off`. The handlers are registered once at module load and outlive every run; removing them would re-introduce the very leak they prevent on the NEXT run. The pipeline DOES `process.off` (`prp-pipeline.ts:1436-1475`) only because it is a per-run instance that could be created repeatedly in one process. **S2: if the cleanup is module-level (recommended, matching file-lock.ts), do NOT add `process.off`. If it is per-instance (like the pipeline), store the handler in a field and `process.off` it in cleanup — choose ONE and be consistent.**

3. **No duplicate-registration.** Module-level `process.on(...)` at top level runs exactly once (Node caches modules). If S2 accidentally puts registration inside a function/constructor that runs per-run, it will register the same handler N times and cleanup runs N times on each signal (currently harmless due to idempotency, but wasteful and a latent bug if idempotency breaks). Keep registration at module top level OR guard with a `let registered = false` flag.

4. **`process.exit` is illegal inside an `exit` handler.** The `exit` handler MUST be `cleanupHeldLocks` (cleanup only), NOT `onLockCleanupSignal` (which calls `process.exit`). Node ignores `process.exit()` calls made from within the `exit` event. The signal handlers are the ones that call exit; the `exit` handler is purely best-effort cleanup for normal returns/uncaught exceptions.

5. **SIGKILL / OOM / segfault are unreachable by handlers (PRD §9.3.3 hard clause).** file-lock.ts documents this explicitly and relies on the PID+mtime stale-lock detector for those cases. For TEMP FILES, no signal handler can satisfy the PRD's "hard-killed (SIGTERM/SIGKILL/power-loss)" clause on its own — SIGKILL/power-loss/segfault cannot be caught. S2 needs a recovery mechanism for the SIGKILL case (startup sweep of PID-stamped temp names, or accept the documented best-effort limitation). **This is the single biggest design decision for S2** and is flagged here, not resolved.

6. **The `mockExit` default-param resolves `process.exit` lazily** — this is load-bearing for Variant B tests. If S2 changes the default to a captured reference (`const realExit = process.exit; ... = c => realExit(c)`), the `vi.spyOn` test trick BREAKS because the spy wouldn't be hit. Keep the default as `c => process.exit(c)` (re-reads at call time).

7. **Test coverage gap to consider.** The existing test does NOT verify disk-level unlinking inside the cleanup test, and does NOT test the `process.on(...)` registration sites at all. If S2 wants the registration proven (e.g. that SIGINT actually triggers cleanup end-to-end), it must use a real subprocess + signal (`process.kill(child.pid, 'SIGINT')`) — none of the current tests do this; they call handlers directly.

---

## Start Here

Open **`src/core/file-lock.ts:567-615`** first. That 49-line block is the entire template S2 must mirror: a module-level `Set` registry (`:347`), an idempotent `cleanup*()` iterator over it (`:577-580`), `onXCleanupSignal(code, mockExit = c => process.exit(c))` with the injectable exit seam (`:593-599`), thin named wrappers for 130/143 so the registration site stays coverable (`:601-611`), and the three top-level `process.on(...)` lines (`:613-615`). Then read the test at `tests/unit/core/file-lock.test.ts:413-471` for the exact `mockExit` injection + `vi.spyOn(process,'exit')` pattern to copy. Finally read `prp-pipeline.ts:403-443` + `:1436-1475` ONLY if S2 chooses the per-instance style (with `process.off`) instead of the module-level style.