/**
 * Process-level mutual-exclusion lock for tasks.json read-modify-write (PRD §5.1).
 *
 * @module core/file-lock
 *
 * @remarks
 * Node.js has no native `flock` binding. This module implements an equivalent
 * zero-dependency **O_EXCL lockfile** primitive (`fs.open(lockPath, 'wx')`)
 * plus a {@link withLockedTasksJSON} accessor that serializes every
 * read-modify-write of `tasks.json` so the foreground executor and the
 * background research supervisor (or any other concurrent writer) cannot
 * interleave their cycles and silently clobber a status back.
 *
 * The architecture is a three-layer stack (see
 * `plan/.../research/file-locking-patterns.md` §3):
 *
 * 1. **Layer 1 — in-process async mutex + re-entrancy**: a `Map` keyed by
 *    session dir cheaply serializes concurrent async operations in the SAME
 *    process (no filesystem thrash), and an `AsyncLocalStorage<Set<string>>`
 *    makes the lock re-entrant within a single async chain so transitive
 *    callers that re-enter {@link withLockedTasksJSON} on the same dir do NOT
 *    deadlock.
 * 2. **Layer 2 — O_EXCL lockfile**: `<sessionDir>/tasks.json.lock` excludes
 *    OTHER processes (a backgrounded supervisor, a second CLI invocation, or a
 *    crash+restart). Acquired with `openSync('wx')` (atomic create-or-fail);
 *    stale detection is dual: age > `staleMs` **OR** holder PID dead
 *    (`process.kill(pid,0)` → ESRCH). This dual scheme recovers a SIGKILLed
 *    holder immediately instead of waiting the full `staleMs`.
 * 3. **Layer 3 — atomic write** is delegated to {@link writeTasksJSON}, which
 *    already uses the temp-file + rename pattern (crash-safe data integrity).
 *
 * Per PRD §5.1: "every read-modify-write of `tasks.json` MUST be serialized
 * under an exclusive lock … scoped so it is safe under recursion and the
 * backgrounded supervisor." This subtask (P3.M1.T2.S1) delivers the utility
 * ONLY; P3.M1.T2.S2 wires the existing callers through it.
 *
 * @example
 * ```typescript
 * import { withLockedTasksJSON } from './core/file-lock.js';
 *
 * // Serialized read-modify-write of tasks.json:
 * const next = await withLockedTasksJSON(sessionDir, (backlog) => {
 *   backlog.backlog[0].status = 'Complete';
 *   return backlog;
 * });
 * ```
 */

import {
  openSync,
  closeSync,
  writeSync,
  unlinkSync,
  statSync,
  readFileSync,
} from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { AsyncLocalStorage } from 'node:async_hooks';
import { resolve } from 'node:path';
import { getLogger, type Logger } from '../utils/logger.js';
import {
  getTasksLockStaleMs,
  getTasksLockTimeoutMs,
  getTasksLockPollMs,
} from '../config/constants.js';
import { readTasksJSON, writeTasksJSON } from './session-utils.js';
import type { Backlog } from './models.js';

/**
 * Logger instance for file-lock debug logging.
 *
 * @remarks
 * Lazy-initialized to avoid constructing a logger at import time, mirroring the
 * `session-utils.ts` convention.
 */
let _logger: Logger | undefined;
const logger = (): Logger => (_logger ??= getLogger('file-lock'));

/**
 * JSON sentinel written into `tasks.json.lock` for stale detection.
 *
 * @internal
 */
interface TasksLockInfo {
  /** PID of the process holding the lock (`process.pid`). */
  pid: number;
  /** ms epoch when acquired — age-based staleness fallback. */
  ts: number;
}

/**
 * Tunable options for a lock acquisition / locked accessor call.
 *
 * @remarks
 * All values default to the corresponding `getTasksLock*Ms()` env readers
 * (PRD §5.1, §9.6) so operators can tune under load without code changes.
 * Each field is independently optional.
 */
export interface TasksLockOptions {
  /**
   * Age (ms) at which a held lock is considered stale and forcibly removed.
   * Default: {@link getTasksLockStaleMs}.
   */
  staleMs?: number;
  /**
   * Deadline (ms) to acquire the lock before giving up. Default:
   * {@link getTasksLockTimeoutMs}. Must be > 0.
   */
  timeoutMs?: number;
  /**
   * Interval (ms) between acquisition retries when the lock is held. Default:
   * {@link getTasksLockPollMs}. Must be > 0.
   */
  pollMs?: number;
}

/**
 * Resolve user-supplied (possibly partial) options against env defaults.
 *
 * @internal
 */
function resolveOpts(opts?: TasksLockOptions): Required<TasksLockOptions> {
  return {
    staleMs: opts?.staleMs ?? getTasksLockStaleMs(),
    timeoutMs: opts?.timeoutMs ?? getTasksLockTimeoutMs(),
    pollMs: opts?.pollMs ?? getTasksLockPollMs(),
  };
}

/**
 * Error thrown when the tasks.json lock cannot be acquired within `timeoutMs`.
 *
 * @remarks
 * Thrown by {@link acquireFileLock} (and surfaced by {@link withLockedTasksJSON}
 * / {@link withFileLock}) when the O_EXCL retry loop hits its deadline without
 * acquiring the lock. Captures the lock path and the configured deadline for
 * diagnostics.
 */
export class TasksLockAcquisitionError extends Error {
  /** Absolute path of the lockfile that could not be acquired. */
  readonly lockPath: string;
  /** Configured deadline (ms) that elapsed before acquisition. */
  readonly timeoutMs: number;

  /**
   * @param lockPath - Absolute path of the lockfile.
   * @param timeoutMs - Deadline (ms) that elapsed.
   */
  constructor(lockPath: string, timeoutMs: number) {
    super(
      `Could not acquire lock ${lockPath} within ${timeoutMs}ms (tasks.json RMW)`
    );
    this.name = 'TasksLockAcquisitionError';
    this.lockPath = lockPath;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Cross-platform "is process alive?" check via `process.kill(pid, 0)`.
 *
 * @remarks
 * Signal `0` sends no signal; it only checks process existence. `EPERM` means
 * the process EXISTS but the caller lacks permission to signal it → it is
 * ALIVE (must NOT be treated as stale). `ESRCH` means no such process → DEAD.
 * Inverting these semantics deletes a live process's lock (silent concurrent
 * RMW), the worst possible bug, so this distinction is critical.
 *
 * Exported for unit testing (EPERM is otherwise hard to trigger as non-root).
 *
 * @param pid - OS process id to probe.
 * @returns `true` if the process is alive (`0` reply or `EPERM`); `false` if
 *          dead (`ESRCH`).
 * @internal
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM = exists but no permission → alive; ESRCH (or anything else) → dead.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Determine whether an existing lockfile is stale (safe to forcibly remove).
 *
 * @remarks
 * Dual detection (research §2 recommendation): stale if EITHER the mtime age
 * exceeds `staleMs` (age fallback) OR the holder PID is dead (fast path). Both
 * conditions are evaluated independently so a dead-PID lock is recovered
 * immediately without waiting the full `staleMs`. A read/parse failure (e.g.
 * another process unlinked the lockfile between our EEXIST and the read) is
 * treated as "not stale, retry the open loop" — never delete on a read error.
 *
 * @param lockPath - Absolute path of the lockfile.
 * @param staleMs - Age threshold (ms) for the mtime fallback.
 * @returns `true` if the lock may be safely removed and acquisition retried.
 * @internal
 */
export function isStaleLock(lockPath: string, staleMs: number): boolean {
  try {
    const st = statSync(lockPath);
    if (Date.now() - st.mtimeMs > staleMs) return true; // age fallback
    const info = JSON.parse(readFileSync(lockPath, 'utf8')) as TasksLockInfo;
    if (typeof info.pid === 'number' && !isProcessAlive(info.pid)) return true; // dead holder
    return false;
  } catch {
    // Race: someone deleted/rewrote the lockfile mid-read → don't delete, retry.
    return false;
  }
}

/**
 * Acquire an O_EXCL lockfile, retrying with stale-recovery until the deadline.
 *
 * @remarks
 * Implements Layer 2. Uses `openSync(lockPath, 'wx')` (O_EXCL) for an atomic
 * create-or-fail with no TOCTOU gap. On `EEXIST`, checks staleness: if stale,
 * `unlinkSync`s and retries immediately (no sleep); otherwise sleeps `pollMs`
 * and retries. Throws {@link TasksLockAcquisitionError} once the deadline
 * (`Date.now() >= deadline`) is reached. The `{pid,ts}` sentinel is written
 * with `writeSync` BEFORE `closeSync` so it is durable on disk for the next
 * caller's stale check.
 *
 * @param lockPath - Absolute path of the lockfile to create/own.
 * @param opts - Resolved (required) lock options.
 * @internal
 */
export async function acquireFileLock(
  lockPath: string,
  opts: Required<TasksLockOptions>
): Promise<void> {
  const deadline = Date.now() + opts.timeoutMs;
  for (;;) {
    try {
      const fd = openSync(lockPath, 'wx'); // O_EXCL atomic create
      // writeSync BEFORE closeSync so the PID is durable for the stale check.
      writeSync(
        fd,
        JSON.stringify({ pid: process.pid, ts: Date.now() } as TasksLockInfo)
      );
      closeSync(fd);
      return; // ✅ Acquired
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      // else: lock exists — fall through to stale check.
    }

    if (isStaleLock(lockPath, opts.staleMs)) {
      tryUnlink(lockPath);
      continue; // retry immediately (no sleep)
    }

    if (Date.now() >= deadline) {
      throw new TasksLockAcquisitionError(lockPath, opts.timeoutMs);
    }
    await sleep(opts.pollMs);
  }
}

/**
 * Release (best-effort unlink) a lockfile.
 *
 * @remarks
 * `ENOENT` (already gone) is silently ignored. Never throws.
 *
 * @param lockPath - Absolute path of the lockfile to remove.
 * @internal
 */
function releaseFileLock(lockPath: string): void {
  tryUnlink(lockPath);
}

/**
 * Best-effort `unlinkSync` that swallows failures (ENOENT race, EACCES).
 *
 * @remarks
 * Centralizes the two defensive `unlink` sites (stale-lock recovery and lock
 * release) so both share the same "ignore a vanished lock" semantics. Exported
 * so the ENOENT-race branch is unit-testable without mocking `node:fs`.
 *
 * @param lockPath - Absolute path of the file to remove.
 * @returns `true` if the file was removed; `false` if it was already gone (or
 *          could not be removed).
 * @internal
 */
export function tryUnlink(lockPath: string): boolean {
  try {
    unlinkSync(lockPath);
    return true;
  } catch {
    // already gone / no permission — fine; lock is effectively released.
    return false;
  }
}

// ─── Layer 1: in-process serialization + re-entrancy ────────────────────────

/**
 * In-process async mutex: a pending promise per session dir serializes
 * concurrent async operations in the SAME process cheaply (no FS thrash).
 *
 * @internal
 */
const _held = new Map<string, Promise<void>>();

/**
 * Re-entrancy ownership context for the current async chain.
 *
 * @remarks
 * `held` is the set of session dirs this async chain already holds a lock on
 * (a transitive re-entry on the same dir takes the fast path). `inflight` maps
 * each held dir to the in-flight {@link Backlog} currently being mutated by the
 * owning critical section. Re-entrant inner mutators MUST operate on the SAME
 * in-flight object the outer mutator is mutating — re-reading from disk would
 * lose the outer's pending deltas (S2 / D4). Each `ownership.run` copies both
 * collections so concurrent independent critical sections never share state.
 *
 * @internal
 */
interface LockOwnership {
  /** Session dirs this async chain currently holds a lock on. */
  readonly held: Set<string>;
  /** sessionDir → in-flight backlog being mutated by the owning critical section. */
  readonly inflight: Map<string, Backlog>;
}

/**
 * Re-entrancy tracker: the ownership context for the current async chain.
 * A transitive re-entry on the same dir takes the fast path (operating on the
 * stashed in-flight backlog, not a disk re-read).
 *
 * @internal
 */
const ownership = new AsyncLocalStorage<LockOwnership>();

/**
 * Set of lockfile paths currently held by THIS process, for best-effort
 * cleanup on graceful exit / signal handlers (belt-and-suspenders). The PID +
 * mtime stale detector is the authoritative crash-recovery mechanism (it alone
 * handles SIGKILL/OOM/segfault, where signal handlers do NOT fire).
 *
 * @internal
 */
const _heldLockPaths = new Set<string>();

// ─── Generic primitive (exported for future locked resources) ───────────────

/**
 * Run `fn` while holding an exclusive O_EXCL lock on `<dataPath>.lock`.
 *
 * @remarks
 * The generic Layer-2 primitive. {@link withLockedTasksJSON} is built on top of
 * it (adding the in-process mutex, re-entrancy, and the read-modify-write
 * bodies). The lock is released in a `finally` so a throwing `fn` never wedges
 * subsequent callers. Records the held path for best-effort process cleanup.
 *
 * @typeParam T - Return type of the critical section.
 * @param dataPath - Absolute path of the protected resource (lockfile is the
 *                   sibling `<dataPath>.lock`).
 * @param fn - Critical section to run while the lock is held.
 * @param opts - Optional lock tunables.
 * @returns Whatever `fn` returns.
 * @throws {TasksLockAcquisitionError} If the lock cannot be acquired within
 *         `timeoutMs`.
 */
export async function withFileLock<T>(
  dataPath: string,
  fn: () => Promise<T>,
  opts?: TasksLockOptions
): Promise<T> {
  const resolved = resolveOpts(opts);
  const lockPath = dataPath + '.lock';
  await acquireFileLock(lockPath, resolved);
  _heldLockPaths.add(lockPath);
  try {
    return await fn();
  } finally {
    releaseFileLock(lockPath);
    _heldLockPaths.delete(lockPath);
  }
}

// ─── tasks.json locked accessor ─────────────────────────────────────────────

/**
 * Lockfile path for a given session dir (sibling of `tasks.json`).
 *
 * @internal
 */
const tasksLockPath = (sessionDir: string): string =>
  resolve(sessionDir, 'tasks.json.lock');

/**
 * Low-level: acquire the O_EXCL lockfile guarding `sessionDir/tasks.json`.
 *
 * @remarks
 * Acquires `sessionDir/tasks.json.lock` (Layer 2 only; no in-process mutex or
 * re-entrancy tracking). Prefer {@link withLockedTasksJSON} for normal use;
 * this is exposed for advanced / diagnostic callers that need manual pairing
 * with {@link releaseTasksJSONLock}. The caller MUST release in a `finally`.
 *
 * @param sessionDir - Absolute path of the session directory.
 * @param opts - Optional lock tunables.
 * @internal
 */
export async function acquireTasksJSONLock(
  sessionDir: string,
  opts?: TasksLockOptions
): Promise<void> {
  const lockPath = tasksLockPath(sessionDir);
  await acquireFileLock(lockPath, resolveOpts(opts));
  _heldLockPaths.add(lockPath);
}

/**
 * Low-level: release (best-effort unlink) the `tasks.json.lock` for a dir.
 *
 * @remarks
 * Pair with {@link acquireTasksJSONLock}. Never throws; `ENOENT` is ignored.
 *
 * @param sessionDir - Absolute path of the session directory.
 * @internal
 */
export function releaseTasksJSONLock(sessionDir: string): void {
  const lockPath = tasksLockPath(sessionDir);
  releaseFileLock(lockPath);
  _heldLockPaths.delete(lockPath);
}

/**
 * Serialized read-modify-write of `tasks.json` under an exclusive lock.
 *
 * @remarks
 * **Guarantees (PRD §5.1):**
 * 1. **Mutual exclusion** across processes: an O_EXCL lockfile
 *    (`sessionDir/tasks.json.lock`) is acquired BEFORE the read and held until
 *    AFTER the write, so concurrent writers (foreground executor + background
 *    research supervisor, two CLI invocations, crash+restart) cannot interleave
 *    their read-modify-write cycles and silently clobber a status back.
 * 2. **Atomic write**: the {@link writeTasksJSON} call already uses the
 *    temp-file + rename pattern (crash-safe data integrity).
 * 3. **Recursion-safety within the process**: an {@link AsyncLocalStorage}
 *    tracks which session dirs the current async chain already holds a lock on.
 *    A transitive call back into `withLockedTasksJSON` on the SAME session dir
 *    takes a re-entrant fast path (it is already inside the critical section)
 *    and does NOT re-acquire either layer — so recovery paths that re-enter
 *    cannot deadlock. A re-entrant call on a DIFFERENT session dir correctly
 *    acquires an independent second lock.
 * 4. **Crash recovery**: dual stale detection — a leftover/crashed lockfile is
 *    auto-removed if its holder PID is dead (`process.kill(pid,0)` → ESRCH) OR
 *    its age exceeds `staleMs`, so a SIGKILLed process does not wedge the next
 *    caller for the full `staleMs`.
 *
 * In the re-entrant fast path, the inner call operates on the SAME in-flight
 * {@link Backlog} the outer critical section is mutating (stashed in the
 * {@link AsyncLocalStorage} ownership context, SAFE: the outer caller already
 * holds the lock, so no other process can be mid-write). It does NOT re-read
 * disk — re-reading would lose the outer's pending deltas under the delta-merge
 * mutators introduced in S2 (D4). It also does NOT re-write by itself — the
 * returned backlog is written by whichever call actually owns the lock. See
 * Implementation Decision D3/D4 in the PRP.
 *
 * @param sessionDir - Absolute path of the session directory (the directory
 *                     containing `tasks.json`).
 * @param mutator - Receives the current {@link Backlog} and returns the NEXT
 *                  (mutated) `Backlog` to persist. May be async.
 * @param opts - Optional lock tunables (`staleMs` / `timeoutMs` / `pollMs`).
 * @param readFallback - Optional {@link Backlog} to use when the locked read
 *                       of `tasks.json` throws (e.g. corrupt/missing file, as
 *                       in recovery PATH B). When omitted, a read failure is
 *                       re-thrown (the normal runtime path never has corrupt
 *                       disk under the lock).
 * @returns The persisted `Backlog` (the value returned by `mutator`).
 * @throws {TasksLockAcquisitionError} If the lock cannot be acquired within
 *         `timeoutMs`.
 * @throws {Error} Re-throws any error from `readTasksJSON` (when no
 *         `readFallback` is supplied), `mutator`, or `writeTasksJSON`; the
 *         lock is always released (in a `finally`).
 *
 * @example
 * ```typescript
 * await withLockedTasksJSON(sessionDir, (backlog) => {
 *   backlog.backlog[0].milestones[0].tasks[0].subtasks[0].status = 'Complete';
 *   return backlog;
 * });
 * ```
 */
export async function withLockedTasksJSON(
  sessionDir: string,
  mutator: (backlog: Backlog) => Backlog | Promise<Backlog>,
  opts?: TasksLockOptions,
  readFallback?: Backlog
): Promise<Backlog> {
  // ── Re-entrant fast path: this async chain already holds this dir's lock ──
  const owned = ownership.getStore();
  if (owned?.held.has(sessionDir)) {
    logger().debug(
      { sessionDir, reentrant: true },
      'Re-entrant withLockedTasksJSON — skipping re-acquire'
    );
    // D4: operate on the SAME in-flight backlog the outer critical section is
    // mutating — never a disk re-read (which would lose the outer's pending
    // deltas). Fall back to a read only if no in-flight object was stashed.
    const inflight = owned.inflight.get(sessionDir);
    const cur = inflight ?? (await readTasksJSON(sessionDir));
    return mutator(cur);
  }

  // ── Layer 1: in-process async mutex for this dir ──
  while (_held.has(sessionDir)) {
    await _held.get(sessionDir);
  }
  let releaseInProc!: () => void;
  _held.set(
    sessionDir,
    new Promise<void>(r => {
      releaseInProc = r as () => void;
    })
  );

  try {
    const resolved = resolveOpts(opts);
    // Copy the parent context's collections so this independent critical
    // section does not share inflight state with a concurrent sibling, then add
    // this dir to the held set. The inflight entry is stashed right after the
    // locked read below so re-entrant inner mutators see the same object.
    const inflightForRun = new Map(owned?.inflight ?? []);
    return await ownership.run(
      {
        held: new Set(owned?.held ?? []).add(sessionDir),
        inflight: inflightForRun,
      },
      async () => {
        await acquireFileLock(tasksLockPath(sessionDir), resolved);
        _heldLockPaths.add(tasksLockPath(sessionDir));
        try {
          // READ — when a readFallback is supplied (recovery PATH B: corrupt
          // disk), use it if the read throws; otherwise propagate.
          let backlog: Backlog;
          try {
            backlog = await readTasksJSON(sessionDir);
          } catch (readErr) {
            if (readFallback === undefined) throw readErr;
            backlog = structuredClone(readFallback); // repo/caller-owned → clone
          }
          inflightForRun.set(sessionDir, backlog); // D4: stash for re-entry
          const next = await mutator(backlog); // MODIFY
          await writeTasksJSON(sessionDir, next); // WRITE (atomic temp+rename)
          return next;
        } finally {
          releaseFileLock(tasksLockPath(sessionDir)); // RELEASE
          _heldLockPaths.delete(tasksLockPath(sessionDir));
        }
      }
    );
  } finally {
    _held.delete(sessionDir);
    releaseInProc();
  }
}

// ─── Best-effort process cleanup (belt-and-suspenders) ──────────────────────

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

process.on('exit', cleanupHeldLocks);
process.on('SIGINT', onSIGINTCleanup);
process.on('SIGTERM', onSIGTERMCleanup);
