/**
 * Unit tests for tasks.json smart-recovery routine (PRD §5.1)
 *
 * @remarks
 * Tests validate recoverTasksJson from src/core/tasks-json-recovery.ts with
 * real tmpdir + real git repos (NO module-wide vi.mock). Covers all four
 * contract scenarios: PATH A (clean disk), PATH B (corrupt disk / git restore),
 * PATH C (total failure / non-fatal), and the Researching/Retrying preservation
 * invariant.
 *
 * @see {@link ./../../../src/core/tasks-json-recovery.ts}
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import simpleGit, { type SimpleGit } from 'simple-git';
import { recoverTasksJson } from '../../../src/core/tasks-json-recovery.js';
import { readTasksJSON } from '../../../src/core/session-utils.js';
import type { Backlog } from '../../../src/core/models.js';
import type { Status } from '../../../src/core/models.js';

// ============================================================================
// TEST FIXTURES & HELPERS
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
  const dir = await mkdtemp(join(tmpdir(), 'recovery-'));
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

describe('core/tasks-json-recovery', () => {
  let dir: string;
  let git: SimpleGit;

  beforeEach(async () => {
    ({ dir, git } = await makeRepo());
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const tasksPath = () => join(dir, 'tasks.json');

  it('PATH A — clean disk: re-applies ONLY the legitimate status delta', async () => {
    const seed = makeValidBacklog({ s1Status: 'Implementing' });
    await commitBacklog(git, dir, seed, 'seed');

    // disk is clean (unchanged from seed) — recover with legitimate delta {S1 → Complete}
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

  it('PATH A — discards an unauthorized agent mutation of an UNRELATED item (needs baseline)', async () => {
    const baseline = makeValidBacklog({
      s1Status: 'Implementing',
      s2Status: 'Planned',
    }); // pre-agent snapshot
    await commitBacklog(git, dir, baseline, 'baseline');

    // agent mutated S2 (unrelated) to Complete on disk; S1 still Implementing. Disk still VALID.
    const mutated = makeValidBacklog({
      s1Status: 'Implementing',
      s2Status: 'Complete',
    });
    await writeFile(join(dir, 'tasks.json'), JSON.stringify(mutated, null, 2));

    const result = await recoverTasksJson(
      tasksPath(),
      { itemId: 'P1.M1.T1.S1', status: 'Complete' },
      { baselineBacklog: baseline, repoPath: dir }
    );

    expect(result.source).toBe('disk');
    const after = await readTasksJSON(dir);
    expect(findSubtask(after, 'P1.M1.T1.S1')!.status).toBe('Complete'); // legitimate delta applied
    expect(findSubtask(after, 'P1.M1.T1.S2')!.status).toBe('Planned'); // unauthorized mutation DISCARDED (baseline value)
  });

  it('PATH B — truncated/invalid JSON: restores last valid version from git + re-applies delta', async () => {
    const seed = makeValidBacklog({ s1Status: 'Implementing' });
    await commitBacklog(git, dir, seed, 'seed valid');

    // corrupt on disk (truncated write)
    await writeFile(join(dir, 'tasks.json'), '{ "truncated');

    const result = await recoverTasksJson(
      tasksPath(),
      { itemId: 'P1.M1.T1.S1', status: 'Complete' },
      { repoPath: dir }
    );

    expect(result.restored).toBe(true);
    expect(result.source).toBe('git');
    expect(result.reason).toMatch(/restored from commit/);
    const after = await readTasksJSON(dir);
    expect(findSubtask(after, 'P1.M1.T1.S1')!.status).toBe('Complete'); // legitimate delta applied on top of restore
    // structure restored intact
    expect(after.backlog[0].milestones[0].tasks[0].subtasks).toHaveLength(2);
  });

  it('PATH B — preserves Researching status across a git restore', async () => {
    // committed version has S2 = Researching (background research in flight)
    const seed = makeValidBacklog({
      s1Status: 'Implementing',
      s2Status: 'Researching',
    });
    await commitBacklog(git, dir, seed, 'seed with researching');

    // corrupt on disk
    await writeFile(join(dir, 'tasks.json'), 'NOT JSON {{{');

    const result = await recoverTasksJson(
      tasksPath(),
      { itemId: 'P1.M1.T1.S1', status: 'Complete' },
      { repoPath: dir }
    );

    expect(result.restored).toBe(true);
    const after = await readTasksJSON(dir);
    expect(findSubtask(after, 'P1.M1.T1.S1')!.status).toBe('Complete'); // legitimate delta
    expect(findSubtask(after, 'P1.M1.T1.S2')!.status).toBe('Researching'); // PRESERVED — not dropped to Planned
  });

  it('PATH C — total failure is non-fatal: leaves state as-is and returns a typed result (never throws)', async () => {
    // no committed history at all → gitFileHistory returns [] → no valid version → PATH C
    await writeFile(join(dir, 'tasks.json'), '{ "truncated'); // corrupt, never committed

    const result = await recoverTasksJson(
      tasksPath(),
      { itemId: 'P1.M1.T1.S1', status: 'Complete' },
      { repoPath: dir }
    );

    expect(result.restored).toBe(false);
    expect(result.source).toBe('disk');
    expect(result.reason).toMatch(/recovery failed/);
    // on-disk state untouched (still the truncated bytes)
    const raw = await readFile(join(dir, 'tasks.json'), 'utf-8');
    expect(raw).toBe('{ "truncated');
  });
});
