/**
 * End-to-end integration test for tasks.json smart-recovery (PRD §5.1 — R4)
 *
 * @remarks
 * Exercises the full corrupt-disk → git-restore → delta-apply →
 * Researching-preservation flow of `recoverTasksJson` using REAL git operations,
 * a REAL filesystem, and the same Backlog fixture as the unit tests.
 *
 * No module-wide vi.mock — mirrors the unit test's real-git approach.
 *
 * @see {@link ../../../src/core/tasks-json-recovery.ts}
 * @see {@link ../unit/core/tasks-json-recovery.test.ts}
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import simpleGit, { type SimpleGit } from 'simple-git';
import { recoverTasksJson } from '../../../src/core/tasks-json-recovery.js';
import { readTasksJSON } from '../../../src/core/session-utils.js';
import type { Backlog } from '../../../src/core/models.js';
import type { Status } from '../../../src/core/models.js';

// ============================================================================
// TEST FIXTURES & HELPERS (copied from unit test — keep exact context_scope seed)
// ============================================================================

/**
 * Minimal schema-valid Backlog. context_scope MUST match ContextScopeSchema.
 */
function makeValidBacklog(
  overrides: {
    s1Status?: Status;
    s2Status?: Status;
  } = {}
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
                    title: 'S1',
                    status: overrides.s1Status ?? 'Planned',
                    story_points: 1,
                    dependencies: [],
                    context_scope: cs,
                  },
                  {
                    id: 'P1.M1.T1.S2',
                    type: 'Subtask',
                    title: 'S2',
                    status: overrides.s2Status ?? 'Planned',
                    story_points: 2,
                    dependencies: ['P1.M1.T1.S1'],
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

async function makeRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'recovery-e2e-'));
  const git = simpleGit(dir);
  await git.init();
  await git.addConfig('user.email', 'test@test.test');
  await git.addConfig('user.name', 'Test');
  return { dir, git };
}

async function commitBacklog(
  git: SimpleGit,
  dir: string,
  backlog: Backlog,
  msg: string
) {
  await writeFile(join(dir, 'tasks.json'), JSON.stringify(backlog, null, 2));
  await git.add('tasks.json');
  await git.commit(msg);
}

function findSubtask(backlog: Backlog, id: string) {
  for (const p of backlog.backlog)
    for (const m of p.milestones)
      for (const t of m.tasks)
        for (const s of t.subtasks) if (s.id === id) return s;
  return undefined;
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('tasks-json-recovery e2e (R4)', () => {
  let dir: string;
  let git: SimpleGit;

  beforeEach(async () => {
    ({ dir, git } = await makeRepo());
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const tasksPath = () => join(dir, 'tasks.json');

  it('PATH B — corrupt disk → git restore + delta apply + Researching preserved', async () => {
    // Seed: S1=Implementing, S2=Researching
    const trusted = makeValidBacklog({
      s1Status: 'Implementing',
      s2Status: 'Researching',
    });
    await commitBacklog(git, dir, trusted, 'seed valid tasks.json');

    // Corrupt on-disk file
    await writeFile(tasksPath(), '{ corrupted');

    // Recover with a legitimate delta: S1 → Complete
    const result = await recoverTasksJson(
      tasksPath(),
      { itemId: 'P1.M1.T1.S1', status: 'Complete' },
      { baselineBacklog: trusted, repoPath: dir }
    );

    // Assert git-restore result
    expect(result.restored).toBe(true);
    expect(result.source).toBe('git');
    expect(result.reason).toMatch(/restored from commit/);

    // Read restored file from disk via real session-utils
    const after = await readTasksJSON(dir);

    // Legitimate delta applied: S1 is now Complete
    expect(findSubtask(after, 'P1.M1.T1.S1')!.status).toBe('Complete');

    // Researching preserved: S2 is still Researching (NOT dropped to Planned)
    expect(findSubtask(after, 'P1.M1.T1.S2')!.status).toBe('Researching');
  });

  it('PATH B — preserves Retrying status across a git restore', async () => {
    // Seed: S1=Planned, S2=Retrying
    const trusted = makeValidBacklog({
      s1Status: 'Planned',
      s2Status: 'Retrying',
    });
    await commitBacklog(git, dir, trusted, 'seed with retrying');

    // Corrupt
    await writeFile(tasksPath(), 'NOT JSON {{{');

    const result = await recoverTasksJson(
      tasksPath(),
      { itemId: 'P1.M1.T1.S1', status: 'Complete' },
      { repoPath: dir }
    );

    expect(result.restored).toBe(true);
    const after = await readTasksJSON(dir);
    expect(findSubtask(after, 'P1.M1.T1.S1')!.status).toBe('Complete');
    // Retrying preserved (same invariant as Researching)
    expect(findSubtask(after, 'P1.M1.T1.S2')!.status).toBe('Retrying');
  });

  it('PATH A — clean disk re-applies only the legitimate delta', async () => {
    const seed = makeValidBacklog({ s1Status: 'Implementing' });
    await commitBacklog(git, dir, seed, 'seed clean');

    // Disk is clean (unchanged from seed) — recover with delta
    const result = await recoverTasksJson(
      tasksPath(),
      { itemId: 'P1.M1.T1.S1', status: 'Complete' },
      { repoPath: dir }
    );

    expect(result).toEqual({
      restored: false,
      source: 'disk',
      reason: 're-applied legitimate status delta',
    });
    const after = await readTasksJSON(dir);
    expect(findSubtask(after, 'P1.M1.T1.S1')!.status).toBe('Complete');
  });
});
