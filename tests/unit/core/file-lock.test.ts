/**
 * Real-tmpdir integration tests for src/core/file-lock.ts (PRD §5.1).
 *
 * @remarks
 * These tests use a REAL tmpdir + REAL filesystem (NO module-wide `vi.mock`),
 * mirroring `tests/unit/core/tasks-json-recovery.test.ts`. The O_EXCL lockfile
 * semantics are meaningless against a mocked `node:fs`, so every case here
 * performs genuine disk I/O. A single `vi.spyOn(process, 'kill')` is used to
 * exercise the EPERM/ESRCH branches of {@link isProcessAlive}, which cannot be
 * triggered naturally as a non-root user — everything else is real.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, utimes } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  withLockedTasksJSON,
  withFileLock,
  acquireTasksJSONLock,
  releaseTasksJSONLock,
  isProcessAlive,
  isStaleLock,
  acquireFileLock,
  tryUnlink,
  cleanupHeldLocks,
  onLockCleanupSignal,
  onSIGINTCleanup,
  onSIGTERMCleanup,
  TasksLockAcquisitionError,
} from '../../../src/core/file-lock.js';
import { readTasksJSON } from '../../../src/core/session-utils.js';
import {
  getTasksLockStaleMs,
  DEFAULT_TASKS_LOCK_STALE_MS,
} from '../../../src/config/constants.js';
import type { Backlog } from '../../../src/core/models.js';

// ============================================================================
// TEST FIXTURES & HELPERS
// ============================================================================

/**
 * Minimal schema-valid Backlog (mirrors the fixture shape from
 * tasks-json-recovery.test.ts). `context_scope` MUST satisfy ContextScopeSchema.
 */
function makeValidBacklog(): Backlog {
  const cs =
    'CONTRACT DEFINITION:\n1. RESEARCH NOTE: seed.\n2. INPUT: none.\n3. LOGIC: seed.\n4. OUTPUT: seed.';
  return {
    backlog: [
      {
        id: 'P1',
        type: 'Phase',
        title: 'Phase 1',
        status: 'Planned',
        description: 'seed phase',
        milestones: [
          {
            id: 'P1.M1',
            type: 'Milestone',
            title: 'Milestone 1',
            status: 'Planned',
            description: 'seed milestone',
            tasks: [
              {
                id: 'P1.M1.T1',
                type: 'Task',
                title: 'Task 1',
                status: 'Planned',
                description: 'seed task',
                subtasks: [
                  {
                    id: 'P1.M1.T1.S1',
                    type: 'Subtask',
                    title: 'S1',
                    status: 'Planned',
                    story_points: 1,
                    dependencies: [],
                    context_scope: cs,
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  } as Backlog;
}

/** Read story_points of the single seeded subtask back from disk. */
async function readPoints(dir: string): Promise<number> {
  const backlog = await readTasksJSON(dir);
  return backlog.backlog[0].milestones[0].tasks[0].subtasks[0].story_points;
}

/** Write a lock sentinel directly to simulate a leftover/crashed lockfile. */
async function plantLock(
  dir: string,
  info: { pid: number; ts: number }
): Promise<void> {
  await writeFile(join(dir, 'tasks.json.lock'), JSON.stringify(info));
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('core/file-lock', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'filelock-'));
    await writeFile(
      join(dir, 'tasks.json'),
      JSON.stringify(makeValidBacklog(), null, 2)
    );
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // ── Case 1: persists the mutated backlog ─────────────────────────────────
  it('runs the mutator and persists the returned backlog', async () => {
    // SETUP: confirm seed points == 1
    expect(await readPoints(dir)).toBe(1);

    // EXECUTE: increment story_points inside the locked accessor
    await withLockedTasksJSON(dir, backlog => {
      backlog.backlog[0].milestones[0].tasks[0].subtasks[0].story_points = 5;
      return backlog;
    });

    // VERIFY: the change is on disk and the lockfile is released
    expect(await readPoints(dir)).toBe(5);
    expect(existsSync(join(dir, 'tasks.json.lock'))).toBe(false);
  });

  // ── Case 2: mutual exclusion serializes concurrent RMWs ──────────────────
  it('serializes two concurrent RMWs on the same dir (no lost update)', async () => {
    // The mutator reads the current points, sleeps to widen the RMW window,
    // then increments. Without the lock, both would read 1 and the final
    // value would be 2 (one increment lost). With the lock it must be 3.
    const slowInc = async (backlog: Backlog): Promise<Backlog> => {
      const cur =
        backlog.backlog[0].milestones[0].tasks[0].subtasks[0].story_points;
      await new Promise(r => setTimeout(r, 30)); // widen the window
      backlog.backlog[0].milestones[0].tasks[0].subtasks[0].story_points =
        cur + 1;
      return backlog;
    };

    await Promise.all([
      withLockedTasksJSON(dir, slowInc),
      withLockedTasksJSON(dir, slowInc),
    ]);

    // Serialized ⇒ both increments applied (1 → 2 → 3), no lost update.
    expect(await readPoints(dir)).toBe(3);
  });

  // ── Case 3: stale-PID recovery (dead holder → immediate acquire) ─────────
  it('removes a lockfile owned by a dead PID and acquires immediately', async () => {
    // SETUP: a leftover lock owned by a PID that surely doesn't exist.
    await plantLock(dir, { pid: 999_999, ts: Date.now() });

    // EXECUTE: should NOT wait staleMs — PID-based recovery fires.
    const start = Date.now();
    await withLockedTasksJSON(dir, backlog => {
      backlog.backlog[0].milestones[0].tasks[0].subtasks[0].status = 'Complete';
      return backlog;
    });
    const elapsed = Date.now() - start;

    // VERIFY: acquired within a tiny fraction of staleMs (PID recovery path).
    expect(elapsed).toBeLessThan(1000);
    const after = await readTasksJSON(dir);
    expect(after.backlog[0].milestones[0].tasks[0].subtasks[0].status).toBe(
      'Complete'
    );
  });

  // ── Case 4: stale-age recovery (old lock, alive PID → age fallback) ──────
  it('removes an aged lockfile via the age fallback even when the PID is alive', async () => {
    const staleMs = getTasksLockStaleMs();
    // SETUP: a lock older than staleMs but owned by THIS live process. The PID
    // is alive, so only the age (mtime) path can clear it. The age check reads
    // stat.mtimeMs, NOT the JSON ts field — so we must actually backdate the
    // file's mtime with utimes to make it genuinely stale on the filesystem.
    await plantLock(dir, { pid: process.pid, ts: Date.now() });
    const oldMtime = Math.floor((Date.now() - (staleMs + 1000)) / 1000);
    await utimes(join(dir, 'tasks.json.lock'), oldMtime, oldMtime);

    // EXECUTE: age path fires → immediate acquire (no poll wait).
    const start = Date.now();
    await withLockedTasksJSON(dir, backlog => {
      backlog.backlog[0].milestones[0].tasks[0].subtasks[0].story_points = 2;
      return backlog;
    });
    const elapsed = Date.now() - start;

    // VERIFY: acquired quickly via the age fallback.
    expect(elapsed).toBeLessThan(1000);
    expect(await readPoints(dir)).toBe(2);
  });

  // ── Case 5: re-entrancy (same-dir transitive call does not deadlock) ──────
  it('does not deadlock on a re-entrant call to the same session dir', async () => {
    let innerReadCount = 0;
    let innerDiskValue = -1;

    // The outer mutator re-enters withLockedTasksJSON on the SAME dir.
    // ALS must propagate the ownership so the inner call takes the fast path
    // and does NOT re-acquire the file lock (no deadlock). The inner call
    // re-reads tasks.json from DISK (which still holds the seed value, since
    // the outer's write happens only after its mutator returns) and does NOT
    // re-write by itself. The outer's in-memory mutation is what gets persisted.
    await withLockedTasksJSON(dir, async outer => {
      outer.backlog[0].milestones[0].tasks[0].subtasks[0].story_points = 8;
      await withLockedTasksJSON(dir, inner => {
        innerReadCount++;
        innerDiskValue =
          inner.backlog[0].milestones[0].tasks[0].subtasks[0].story_points;
        return inner; // returned but NOT written by the inner call
      });
      return outer;
    });

    // VERIFY: inner fast path ran exactly once (no re-acquire / deadlock),
    // saw the on-disk seed value (1) — proving it re-read under the held lock
    // rather than seeing the outer's in-flight 8 — and the outer persisted 8.
    expect(innerReadCount).toBe(1);
    expect(innerDiskValue).toBe(1);
    expect(await readPoints(dir)).toBe(8);
    expect(existsSync(join(dir, 'tasks.json.lock'))).toBe(false);
  });

  // ── Case 5b: different-dir re-entrant call acquires an independent lock ───
  it('acquires an independent second lock for a different session dir', async () => {
    const dir2 = await mkdtemp(join(tmpdir(), 'filelock-2-'));
    try {
      await writeFile(
        join(dir2, 'tasks.json'),
        JSON.stringify(makeValidBacklog(), null, 2)
      );

      await withLockedTasksJSON(dir, async outer => {
        outer.backlog[0].milestones[0].tasks[0].subtasks[0].story_points = 7;
        // Re-enter on a DIFFERENT dir → must acquire a real second lock.
        await withLockedTasksJSON(dir2, inner => {
          inner.backlog[0].milestones[0].tasks[0].subtasks[0].story_points = 3;
          return inner;
        });
        return outer;
      });

      expect(await readPoints(dir)).toBe(7);
      expect(await readPoints(dir2)).toBe(3);
    } finally {
      await rm(dir2, { recursive: true, force: true });
    }
  });

  // ── Case 6: release-on-throw (lockfile removed + error propagates) ────────
  it('releases the lockfile and propagates when the mutator throws', async () => {
    const boom = new Error('mutator exploded');

    // EXECUTE: mutator throws mid-section.
    await expect(
      withLockedTasksJSON(dir, () => {
        throw boom;
      })
    ).rejects.toBe(boom);

    // VERIFY: lockfile gone so the next caller doesn't block.
    expect(existsSync(join(dir, 'tasks.json.lock'))).toBe(false);

    // VERIFY: a follow-up acquisition succeeds immediately (lock was released).
    await withLockedTasksJSON(dir, backlog => {
      backlog.backlog[0].milestones[0].tasks[0].subtasks[0].story_points = 2;
      return backlog;
    });
    expect(await readPoints(dir)).toBe(2);
  });

  // ── Case 7: timeout (un-acquirable live lock throws after timeoutMs) ─────
  it('throws TasksLockAcquisitionError when the lock cannot be acquired in time', async () => {
    // SETUP: plant a FRESH lock owned by a LIVE process (this one). Neither the
    // PID check (alive) nor the age check (fresh) can clear it, so the only way
    // to acquire is to wait past the tiny timeout.
    await plantLock(dir, { pid: process.pid, ts: Date.now() });

    // EXECUTE/VERIFY: tiny timeoutMs → throws the typed acquisition error.
    await expect(
      withLockedTasksJSON(dir, backlog => backlog, {
        timeoutMs: 40,
        pollMs: 10,
      })
    ).rejects.toThrow(TasksLockAcquisitionError);

    // Cleanup the planted lock so afterEach rm succeeds cleanly.
    try {
      await rm(join(dir, 'tasks.json.lock'), { force: true });
    } catch {
      // ignore
    }
  });

  // ── isProcessAlive: EPERM=alive, ESRCH=dead (unit branch coverage) ────────
  describe('isProcessAlive', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('returns true for a process that exists (this process)', () => {
      expect(isProcessAlive(process.pid)).toBe(true);
    });

    it('returns false for a non-existent PID (ESRCH)', () => {
      expect(isProcessAlive(999_999)).toBe(false);
    });

    it('returns true when process.kill throws EPERM (exists, no permission)', () => {
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
        const err: NodeJS.ErrnoException = new Error('Not permitted');
        err.code = 'EPERM';
        throw err;
      });
      // EPERM means the process EXISTS → must be treated as ALIVE.
      expect(isProcessAlive(12345)).toBe(true);
      expect(killSpy).toHaveBeenCalledWith(12345, 0);
    });

    it('returns false when process.kill throws ESRCH', () => {
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
        const err: NodeJS.ErrnoException = new Error('No such process');
        err.code = 'ESRCH';
        throw err;
      });
      expect(isProcessAlive(12345)).toBe(false);
      expect(killSpy).toHaveBeenCalledWith(12345, 0);
    });
  });

  // ── withFileLock: generic primitive (independent resource) ───────────────
  describe('withFileLock (generic primitive)', () => {
    it('acquires and releases a sibling lockfile for an arbitrary dataPath', async () => {
      const dataPath = join(dir, 'other.json');
      const lockPath = dataPath + '.lock';

      let observedHeld = false;
      await withFileLock(dataPath, async () => {
        observedHeld = existsSync(lockPath);
        return 42;
      }).then(result => expect(result).toBe(42));

      expect(observedHeld).toBe(true);
      expect(existsSync(lockPath)).toBe(false);
    });

    it('releases the lockfile even when fn throws', async () => {
      const dataPath = join(dir, 'throws.json');
      const lockPath = dataPath + '.lock';
      const boom = new Error('fn exploded');

      await expect(
        withFileLock(dataPath, async () => {
          throw boom;
        })
      ).rejects.toBe(boom);

      expect(existsSync(lockPath)).toBe(false);
    });
  });

  // ── low-level acquire/release pair ───────────────────────────────────────
  describe('acquireTasksJSONLock / releaseTasksJSONLock', () => {
    it('creates then removes the tasks.json.lock', async () => {
      const lockPath = join(dir, 'tasks.json.lock');
      expect(existsSync(lockPath)).toBe(false);

      await acquireTasksJSONLock(dir);
      expect(existsSync(lockPath)).toBe(true);

      releaseTasksJSONLock(dir);
      expect(existsSync(lockPath)).toBe(false);
    });

    it('releaseTasksJSONLock is a no-op when the lock is already gone', () => {
      // No lock planted → release must not throw.
      expect(() => releaseTasksJSONLock(dir)).not.toThrow();
    });
  });

  // ── constants reader sanity (env-backed defaults) ────────────────────────
  describe('constants', () => {
    it('DEFAULT_TASKS_LOCK_STALE_MS is a positive number used by the reader', () => {
      expect(DEFAULT_TASKS_LOCK_STALE_MS).toBeGreaterThan(0);
      // Reader honors unset env by returning the default.
      delete process.env.TASKS_LOCK_STALE_MS;
      expect(getTasksLockStaleMs()).toBe(DEFAULT_TASKS_LOCK_STALE_MS);
    });
  });

  // ── process-cleanup handlers (belt-and-suspenders) ───────────────────────
  describe('process cleanup handlers', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('onLockCleanupSignal releases held locks and exits with the given code', async () => {
      // SETUP: hold a real lock via the low-level acquire so _heldLockPaths is
      // populated; capture the exit code via a mock (must NOT terminate).
      const dataPath = join(dir, 'cleanup.json');
      const lockPath = dataPath + '.lock';
      let exitCode: number | undefined;
      await withFileLock(dataPath, async () => {
        expect(existsSync(lockPath)).toBe(true);
        onLockCleanupSignal(130, c => {
          exitCode = c;
        });
        return undefined;
      });
      // VERIFY: the handler ran cleanup (lock still owned by withFileLock here,
      // but releaseFileLock is idempotent) and surfaced the exit code.
      expect(exitCode).toBe(130);
    });

    it('onLockCleanupSignal defaults to process.exit when no mock supplied (via spy)', () => {
      const exitSpy = vi
        .spyOn(process, 'exit')
        .mockImplementation((() => undefined) as never);
      expect(() => onLockCleanupSignal(143)).not.toThrow();
      expect(exitSpy).toHaveBeenCalledWith(143);
    });

    it('onSIGINTCleanup exits with code 130', () => {
      let exitCode: number | undefined;
      // Temporarily no-op process.exit by spying so the wrapper runs fully.
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((
        c?: number
      ) => {
        exitCode = c;
      }) as never);
      onSIGINTCleanup();
      expect(exitCode).toBe(130);
      expect(exitSpy).toHaveBeenCalledWith(130);
    });

    it('onSIGTERMCleanup exits with code 143', () => {
      let exitCode: number | undefined;
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((
        c?: number
      ) => {
        exitCode = c;
      }) as never);
      onSIGTERMCleanup();
      expect(exitCode).toBe(143);
      expect(exitSpy).toHaveBeenCalledWith(143);
    });

    it('cleanupHeldLocks is a safe no-op when no locks are held', () => {
      expect(() => cleanupHeldLocks()).not.toThrow();
    });
  });

  // ── acquireFileLock error paths (defensive branch coverage) ───────────────
  describe('acquire error paths', () => {
    it('re-throws non-EEXIST open errors (e.g. ENOENT on missing parent dir)', async () => {
      // A lockfile path whose PARENT directory does not exist → openSync('wx')
      // throws ENOENT (not EEXIST). The acquire loop must re-throw it rather
      // than treat it as a held-lock EEXIST.
      const missingDir = join(dir, 'does-not-exist', 'nested');
      await expect(
        acquireTasksJSONLock(missingDir, { timeoutMs: 20 })
      ).rejects.toThrow();
    });
  });

  // ── isStaleLock: race / corrupt-content defensive paths ──────────────────
  describe('isStaleLock', () => {
    it('returns false for a non-existent lockfile (race: unlinked mid-check)', () => {
      expect(isStaleLock(join(dir, 'never-existed.lock'), 1000)).toBe(false);
    });

    it('returns false for a lockfile with corrupt (unparseable) content', async () => {
      const lockPath = join(dir, 'corrupt.lock');
      // Fresh mtime + a live PID-ish number, but the JSON is garbage → parse
      // throws → catch returns false (don't delete; let the open loop retry).
      await writeFile(lockPath, 'not-json-at-all');
      expect(isStaleLock(lockPath, 60_000)).toBe(false);
    });

    it('returns true when the holder PID is dead', async () => {
      const lockPath = join(dir, 'dead-pid.lock');
      await writeFile(
        lockPath,
        JSON.stringify({ pid: 999_999, ts: Date.now() })
      );
      expect(isStaleLock(lockPath, 60_000)).toBe(true);
    });

    it('returns true when the lockfile age exceeds staleMs', async () => {
      const lockPath = join(dir, 'aged.lock');
      await writeFile(lockPath, JSON.stringify({ pid: process.pid, ts: 0 }));
      // Backdate mtime so the age path (which reads stat.mtimeMs) fires even
      // though the PID is alive.
      const oldMtime = Math.floor((Date.now() - 60_000) / 1000);
      await utimes(lockPath, oldMtime, oldMtime);
      expect(isStaleLock(lockPath, 1000)).toBe(true);
    });
  });

  // ── acquireFileLock: stale-branch success path + tryUnlink race coverage ─
  describe('acquireFileLock stale branch & tryUnlink', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('removes a stale (dead-PID) lock and acquires on immediate retry', async () => {
      const lockPath = join(dir, 'tasks.json.lock');
      await plantLock(dir, { pid: 999_999, ts: Date.now() });
      expect(existsSync(lockPath)).toBe(true);
      await acquireFileLock(lockPath, {
        staleMs: 60_000,
        timeoutMs: 1000,
        pollMs: 5,
      });
      expect(existsSync(lockPath)).toBe(true); // we now own it
      releaseTasksJSONLock(dir);
    });

    it('tryUnlink returns true when the file exists', async () => {
      const p = join(dir, 'removable.txt');
      await writeFile(p, 'x');
      expect(existsSync(p)).toBe(true);
      expect(tryUnlink(p)).toBe(true);
      expect(existsSync(p)).toBe(false);
    });

    it('tryUnlink returns false (swallows ENOENT) when the file is already gone', () => {
      // Exercises the defensive catch that guards the stale-branch + release
      // sites against a competing unlink (TOCTOU race) without mocking node:fs.
      const p = join(dir, 'never-existed.txt');
      expect(existsSync(p)).toBe(false);
      expect(() => tryUnlink(p)).not.toThrow();
      expect(tryUnlink(p)).toBe(false);
    });
  });
});
