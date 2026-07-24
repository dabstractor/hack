/**
 * Real-tmpdir integration tests proving the merge-under-lock invariant for
 * SessionManager's tasks.json write path (PRD §5.1 lost-update prevention,
 * P3.M1.T2.S2).
 *
 * @remarks
 * NO module-wide `vi.mock('node:fs')` — these tests use a REAL tmpdir + REAL
 * filesystem (and REAL git for the recovery case) so the on-disk merge-under-
 * lock invariant can actually be PROVEN. Mocked-fs tests cannot prove it.
 * Mirrors `tasks-json-recovery.test.ts` / `file-lock.test.ts`.
 *
 * Cases:
 *  1. MERGE-UNDER-LOCK — a concurrent writer's status survives a batched
 *     flushUpdates (the core PRD §5.1 lost-update proof).
 *  2. CONCURRENT SERIALIZATION — two overlapping flushUpdates both land.
 *  3. DELTA CLEAR ON SUCCESS — a second flush with no updates is a no-op.
 *  4. RECOVERY RETURNS BACKLOG — recoverTasksJson returns result.backlog.
 *  5. RE-ENTRANT DELTA PRESERVATION (D4) — outer+inner deltas both land.
 *
 * @see {@link ./../../../src/core/session-manager.ts}
 * @see {@link ./../../../src/core/file-lock.ts}
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import simpleGit, { type SimpleGit } from 'simple-git';
import { SessionManager } from '../../../src/core/session-manager.js';
import { withLockedTasksJSON } from '../../../src/core/file-lock.js';
import { recoverTasksJson } from '../../../src/core/tasks-json-recovery.js';
import { readTasksJSON } from '../../../src/core/session-utils.js';
import { existsSync } from 'node:fs';
import type { Backlog, Status } from '../../../src/core/models.js';

// ============================================================================
// TEST FIXTURES & HELPERS
// ============================================================================

/**
 * Minimal schema-valid Backlog with two subtasks (S1="X" and S2="Y") for the
 * merge-under-lock proof. Subtask IDs MUST match P{N}.M{N}.T{N}.S{N} per the
 * Zod schema, so we use S1/S2 ids with X/Y titles.
 */
function makeValidBacklog(
  overrides: { s1Status?: Status; s2Status?: Status } = {}
): Backlog {
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
                    title: 'X',
                    status: overrides.s1Status ?? 'Planned',
                    story_points: 1,
                    dependencies: [],
                    context_scope: cs,
                  },
                  {
                    id: 'P1.M1.T1.S2',
                    type: 'Subtask',
                    title: 'Y',
                    status: overrides.s2Status ?? 'Planned',
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

/** id of the "X" subtask. */
const X = 'P1.M1.T1.S1';
/** id of the "Y" subtask. */
const Y = 'P1.M1.T1.S2';

/** Set a subtask's status in place by id (readonly-cast idiom). */
function setSubtaskStatus(backlog: Backlog, id: string, status: Status): void {
  for (const p of backlog.backlog)
    for (const m of p.milestones)
      for (const t of m.tasks)
        for (const s of t.subtasks)
          if (s.id === id) (s as { status: Status }).status = status;
}

/** Locate a subtask's status by id (returns undefined if not found). */
function findStatus(backlog: Backlog, id: string): Status | undefined {
  for (const p of backlog.backlog)
    for (const m of p.milestones)
      for (const t of m.tasks)
        for (const s of t.subtasks) if (s.id === id) return s.status;
  return undefined;
}

/**
 * Build a REAL SessionManager against a tmpdir, fully initialized via the real
 * `initialize()` path (creates a proper session dir under planDir). Returns the
 * manager and the absolute session dir path (where tasks.json lives).
 */
async function makeManager(
  prdPath: string,
  planDir: string
): Promise<{ manager: SessionManager; sessionDir: string }> {
  const manager = new SessionManager(prdPath, planDir);
  const session = await manager.initialize();
  return { manager, sessionDir: session.metadata.path };
}

/** A PRD body long enough to pass PRD validation. */
const MINIMAL_PRD = `# Test PRD

## Executive Summary

This is a comprehensive test PRD for integration testing of SessionManager.
It contains enough content to pass PRD validation (minimum 100 characters).

## Functional Requirements

The system shall properly persist task status under an exclusive lock.
`;

/** Seed tasks.json into an existing session dir (overwriting the empty init one). */
async function seedTasksJSON(
  sessionDir: string,
  backlog: Backlog
): Promise<void> {
  await writeFile(
    join(sessionDir, 'tasks.json'),
    JSON.stringify(backlog, null, 2)
  );
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('core/session-manager locking (merge-under-lock, PRD §5.1)', () => {
  let dir: string;
  let prdPath: string;
  let planDir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sm-lock-'));
    prdPath = join(dir, 'PRD.md');
    planDir = join(dir, 'plan');
    await writeFile(prdPath, MINIMAL_PRD);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // ── Case 1: MERGE-UNDER-LOCK (the core lost-update invariant) ─────────────
  it('a concurrent writer status survives a batched flushUpdates', async () => {
    const { manager, sessionDir } = await makeManager(prdPath, planDir);
    // Seed the on-disk backlog: S1=Planned, S2=Planned.
    await seedTasksJSON(
      sessionDir,
      makeValidBacklog({ s1Status: 'Planned', s2Status: 'Planned' })
    );

    // Writer B (simulate the background supervisor) persists S2=Ready directly
    // under the lock BEFORE writer A flushes.
    await withLockedTasksJSON(sessionDir, fresh => {
      setSubtaskStatus(fresh, Y, 'Ready');
      return fresh;
    });

    // Writer A (the executor): batch S1=Complete in memory, then flush. Today's
    // full-snapshot overwrite would revert S2 back to Planned (A's stale
    // in-memory snapshot never saw B's Ready). The delta-merge must NOT.
    await manager.updateItemStatus(X, 'Complete');
    await manager.flushUpdates();

    const after = await readTasksJSON(sessionDir);
    expect(findStatus(after, X)).toBe('Complete'); // A's delta landed
    expect(findStatus(after, Y)).toBe('Ready'); // B's status SURVIVED (not reverted to Planned)
  });

  // ── Case 2: CONCURRENT SERIALIZATION — two overlapping flushes both land ──
  it('serializes two overlapping locked writes so both deltas persist', async () => {
    await seedTasksJSON(
      dir,
      makeValidBacklog({ s1Status: 'Planned', s2Status: 'Planned' })
    );

    // Two overlapping locked RMWs on the same dir, each sleeping inside the
    // mutator to force interleaving. The in-process mutex + lockfile must
    // serialize them; the result must reflect BOTH deltas (not last-writer-wins
    // of a single stale snapshot).
    await Promise.all([
      withLockedTasksJSON(dir, async fresh => {
        await new Promise(r => setTimeout(r, 20));
        setSubtaskStatus(fresh, X, 'Complete');
        return fresh;
      }),
      withLockedTasksJSON(dir, async fresh => {
        await new Promise(r => setTimeout(r, 20));
        setSubtaskStatus(fresh, Y, 'Failed');
        return fresh;
      }),
    ]);

    const after = await readTasksJSON(dir);
    expect(findStatus(after, X)).toBe('Complete');
    expect(findStatus(after, Y)).toBe('Failed');
    // lockfile always released after the critical sections
    expect(existsSync(join(dir, 'tasks.json.lock'))).toBe(false);
  });

  // ── Case 3: DELTA CLEAR ON SUCCESS — second flush with no updates is a no-op
  it('a second flushUpdates with no intervening update is a no-op', async () => {
    const { manager, sessionDir } = await makeManager(prdPath, planDir);
    await seedTasksJSON(sessionDir, makeValidBacklog({ s1Status: 'Planned' }));

    await manager.updateItemStatus(X, 'Complete');
    await manager.flushUpdates();
    let after = await readTasksJSON(sessionDir);
    expect(findStatus(after, X)).toBe('Complete');

    // Flush again (no updates queued) and confirm content is byte-identical —
    // #dirty was cleared and #pendingDeltas is empty, so it is a no-op.
    const before = JSON.stringify(await readTasksJSON(sessionDir));
    await manager.flushUpdates();
    after = await readTasksJSON(sessionDir);
    expect(JSON.stringify(after)).toBe(before);
    expect(findStatus(after, X)).toBe('Complete'); // unchanged
  });

  // ── Case 4: RECOVERY RETURNS BACKLOG — result.backlog is authoritative ────
  it('recoverTasksJson returns the written backlog via result.backlog', async () => {
    const git = simpleGit(dir);
    await git.init();
    await git.addConfig('user.email', 'test@test.test');
    await git.addConfig('user.name', 'Test');
    const seed = makeValidBacklog({ s1Status: 'Implementing' });
    await writeFile(join(dir, 'tasks.json'), JSON.stringify(seed, null, 2));
    await git.add('tasks.json');
    await git.commit('seed');

    const result = await recoverTasksJson(
      join(dir, 'tasks.json'),
      { itemId: X, status: 'Complete' },
      { repoPath: dir }
    );

    expect(result.backlog).toBeDefined();
    expect(findStatus(result.backlog!, X)).toBe('Complete');
    // result.backlog matches the on-disk authoritative written version
    const onDisk = await readTasksJSON(dir);
    expect(findStatus(onDisk, X)).toBe('Complete');
    expect(findStatus(onDisk, Y)).toBe(findStatus(result.backlog!, Y));
  });

  // ── Case 5: RE-ENTRANT DELTA PRESERVATION (D4) ───────────────────────────
  it('an outer + inner same-dir re-entrant locked call preserves BOTH deltas', async () => {
    await seedTasksJSON(
      dir,
      makeValidBacklog({ s1Status: 'Planned', s2Status: 'Planned' })
    );

    // The outer mutator applies delta A (S1=Complete) and re-enters the accessor
    // on the SAME dir to apply delta B (S2=Failed). D4: the inner call operates
    // on the SAME in-flight backlog (not a disk re-read), so both deltas land
    // on the single persisted write.
    await withLockedTasksJSON(dir, async outer => {
      setSubtaskStatus(outer, X, 'Complete');
      await withLockedTasksJSON(dir, inner => {
        setSubtaskStatus(inner, Y, 'Failed');
        return inner;
      });
      return outer;
    });

    const after = await readTasksJSON(dir);
    expect(findStatus(after, X)).toBe('Complete'); // outer delta
    expect(findStatus(after, Y)).toBe('Failed'); // inner delta (preserved, NOT lost to a disk re-read)
    expect(existsSync(join(dir, 'tasks.json.lock'))).toBe(false);
  });
});
