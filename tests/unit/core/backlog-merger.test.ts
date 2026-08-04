/**
 * Unit tests for `mergeBacklogs` (P1.M1.T1.S2 — delta-session backlog merge)
 *
 * @remarks
 * Pure-function tests (data-in / data-out): NO tmpdir, NO mocks of node:fs. The only mock is
 * `../utils/logger.js`, to assert that the de-dup SKIP branches fire a `logger.warn` (the
 * original bug was a silent drop — every merge-skip must be observable).
 *
 * Covers every branch of `mergeBacklogs` + its helpers (`collectIds`, `registerPhaseIds`,
 * `mergePhase`, `mergeMilestone`):
 * - new phase append (title + id both fresh)
 * - extend phase by title (id differs, title matches) → extend matched milestone by title +
 *   append new milestone
 * - task id de-dup (keep patched status, warn) + new task append
 * - defensive phase id collision skip (new title, colliding id) → warn
 * - defensive milestone id collision skip (within a title-matched phase) → warn
 * - empty patched no-op: `mergeBacklogs({ backlog: [] }, x)` ≡ `x`
 * - empty architect no-op: `mergeBacklogs(x, { backlog: [] })` ≡ `x`
 * - patched statuses preserved verbatim (Obsolete / Planned survive the merge)
 * - deep nesting / multiple architect phases (extend + multiple new)
 *
 * @see {@link ../../../src/core/backlog-merger.ts}
 * @see {@link ../../../src/core/models.ts}
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the logger so the de-dup `warn` branches are observable. The merger lazily initializes
// `_logger` via getLogger('BacklogMerger'); mocking the module replaces that instance with the
// spy object below.
const warnMock = vi.fn();
vi.mock('../../../src/utils/logger.js', () => ({
  getLogger: () => ({
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: warnMock,
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(() => ({
      trace: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: warnMock,
      error: vi.fn(),
      fatal: vi.fn(),
    })),
  }),
}));

import { mergeBacklogs } from '../../../src/core/backlog-merger.js';
import {
  maxPhaseNumber,
  maxChildNumber,
  renumberPhase,
  renumberMilestone,
  renumberTask,
} from '../../../src/core/backlog-merger.js';
import type {
  Backlog,
  Phase,
  Milestone,
  Task,
  Subtask,
} from '../../../src/core/models.js';

// ============================================================================
// FIXTURE BUILDERS
// ============================================================================

/** A ContextScopeSchema-valid context_scope string (CONTRACT DEFINITION format). */
const CS =
  'CONTRACT DEFINITION:\n1. RESEARCH NOTE: x.\n2. INPUT: x.\n3. LOGIC: x.\n4. OUTPUT: x.';

/** Build a Subtask fixture (Planned by default; status/story_points overridable). */
function makeSubtask(
  id: string,
  opts: Partial<Pick<Subtask, 'status' | 'story_points'>> = {}
): Subtask {
  return {
    id,
    type: 'Subtask',
    title: id,
    status: opts.status ?? 'Planned',
    story_points: opts.story_points ?? 1,
    dependencies: [],
    context_scope: CS,
    prd_selectors: [],
  };
}

/** Build a Task fixture with the given subtasks. */
function makeTask(
  id: string,
  opts: { title?: string; status?: Task['status']; subtasks?: Subtask[] } = {}
): Task {
  return {
    id,
    type: 'Task',
    title: opts.title ?? id,
    status: opts.status ?? 'Planned',
    description: 'd',
    subtasks: opts.subtasks ?? [makeSubtask(`${id}.S1`)],
  };
}

/** Build a Milestone fixture with the given tasks. */
function makeMilestone(
  id: string,
  opts: { title?: string; tasks?: Task[] } = {}
): Milestone {
  return {
    id,
    type: 'Milestone',
    title: opts.title ?? id,
    status: 'Planned',
    description: 'd',
    tasks: opts.tasks ?? [],
  };
}

/** Build a Phase fixture with the given milestones. */
function makePhase(
  id: string,
  opts: { title?: string; milestones?: Milestone[] } = {}
): Phase {
  return {
    id,
    type: 'Phase',
    title: opts.title ?? id,
    status: 'Planned',
    description: 'd',
    milestones: opts.milestones ?? [],
  };
}

beforeEach(() => {
  warnMock.mockClear();
});

// ============================================================================
// mergeBacklogs — new phase append
// ============================================================================

describe('mergeBacklogs — new phase append', () => {
  it('appends an architect phase with a new title (and fresh id)', () => {
    // SETUP — patched has P1; architect has P2 (different title, fresh id).
    const patched: Backlog = {
      backlog: [makePhase('P1', { title: 'Alpha' })],
    };
    const architect: Backlog = {
      backlog: [makePhase('P2', { title: 'Beta' })],
    };

    // EXECUTE
    const merged = mergeBacklogs(patched, architect);

    // VERIFY — both phases present; patched untouched.
    expect(merged.backlog).toHaveLength(2);
    expect(merged.backlog[0].id).toBe('P1');
    expect(merged.backlog[1].id).toBe('P2');
    expect(warnMock).not.toHaveBeenCalled();
  });

  it('appends multiple new architect phases (deep nesting)', () => {
    // SETUP — patched [P1, P2]; architect [P1(extend), P3(new), P4(new)].
    const patched: Backlog = {
      backlog: [
        makePhase('P1', {
          title: 'Foundation',
          milestones: [makeMilestone('P1.M1', { title: 'Core' })],
        }),
        makePhase('P2', { title: 'Other' }),
      ],
    };
    const architect: Backlog = {
      backlog: [
        makePhase('P1', {
          title: 'Foundation',
          milestones: [
            makeMilestone('P1.M1', {
              title: 'Core',
              tasks: [makeTask('P1.M1.T9', { title: 'New' })],
            }),
          ],
        }),
        makePhase('P3', { title: 'Third' }),
        makePhase('P4', { title: 'Fourth' }),
      ],
    };

    // EXECUTE
    const merged = mergeBacklogs(patched, architect);

    // VERIFY — P1 extended (matched by title), P2 kept, P3 + P4 appended.
    expect(merged.backlog.map(p => p.id)).toEqual(['P1', 'P2', 'P3', 'P4']);
    // P1.M1 extended with the new task.
    expect(merged.backlog[0].milestones[0].tasks.map(t => t.id)).toEqual([
      'P1.M1.T9',
    ]);
  });
});

// ============================================================================
// mergeBacklogs — extend phase / milestone by title
// ============================================================================

describe('mergeBacklogs — extend by title', () => {
  it('extends an existing phase by title (new milestone + new task in matched milestone)', () => {
    // SETUP — patched P1(title 'Foundation', different id) has M1(task T1, status Complete).
    const patched: Backlog = {
      backlog: [
        makePhase('P1', {
          title: 'Foundation',
          milestones: [
            makeMilestone('P1.M1', {
              title: 'Core',
              tasks: [makeTask('P1.M1.T1', { status: 'Complete' })],
            }),
          ],
        }),
      ],
    };
    // architect P9 (DIFFERENT id, SAME title 'Foundation') → title match extends patched P1.
    const architect: Backlog = {
      backlog: [
        makePhase('P9', {
          title: 'Foundation',
          milestones: [
            makeMilestone('P9.M1', {
              title: 'Core', // SAME title → extend matched milestone
              tasks: [makeTask('P9.M1.T1', { title: 'New' })],
            }),
            makeMilestone('P9.M2', { title: 'Extra' }), // NEW title → append milestone
          ],
        }),
      ],
    };

    // EXECUTE
    const merged = mergeBacklogs(patched, architect);
    const p1 = merged.backlog[0];

    // VERIFY — patched P1 EXTENDED (title match); patched id preserved.
    expect(p1.id).toBe('P1');
    expect(p1.milestones).toHaveLength(2); // M1 (extended) + M2 (new)
    // Matched milestone gets the new task appended; patched task kept (status Complete).
    expect(p1.milestones[0].tasks).toHaveLength(2);
    expect(p1.milestones[0].tasks[0].id).toBe('P1.M1.T1');
    expect(p1.milestones[0].tasks[0].status).toBe('Complete');
    expect(p1.milestones[0].tasks[1].id).toBe('P9.M1.T1');
    // New milestone appended.
    expect(p1.milestones[1].title).toBe('Extra');
  });

  it('extends a matched milestone by title with the architect task (milestone ids differ)', () => {
    // SETUP — isolates mergeMilestone's title-match branch with differing milestone ids.
    const patched: Backlog = {
      backlog: [
        makePhase('P1', {
          title: 'F',
          milestones: [
            makeMilestone('P1.M1', {
              title: 'Core',
              tasks: [makeTask('P1.M1.T1')],
            }),
          ],
        }),
      ],
    };
    const architect: Backlog = {
      backlog: [
        makePhase('P1', {
          title: 'F',
          milestones: [
            makeMilestone('P1.M9', {
              title: 'Core', // SAME title → extend (ids differ)
              tasks: [makeTask('P1.M9.T5')],
            }),
          ],
        }),
      ],
    };

    // EXECUTE
    const merged = mergeBacklogs(patched, architect);
    const ms = merged.backlog[0].milestones[0];

    // VERIFY — patched milestone id kept; architect task appended.
    expect(ms.id).toBe('P1.M1');
    expect(ms.tasks.map(t => t.id)).toEqual(['P1.M1.T1', 'P1.M9.T5']);
  });

  it('appends a NEW milestone (with nested tasks/subtasks) into a title-matched phase', () => {
    // SETUP — isolates mergePhase's NEW-milestone branch with a milestone that HAS tasks +
    // subtasks (exercises the new-milestone id-registration loop: task ids + subtask ids).
    const patched: Backlog = {
      backlog: [
        makePhase('P1', {
          title: 'F',
          milestones: [
            makeMilestone('P1.M1', {
              title: 'Old',
              tasks: [makeTask('P1.M1.T1')],
            }),
          ],
        }),
      ],
    };
    const architect: Backlog = {
      backlog: [
        makePhase('P1', {
          title: 'F', // title match → mergePhase
          milestones: [
            makeMilestone('P1.M2', {
              title: 'BrandNew', // NEW title → append (with tasks + subtasks)
              tasks: [
                makeTask('P1.M2.T1', {
                  subtasks: [
                    makeSubtask('P1.M2.T1.S1'),
                    makeSubtask('P1.M2.T1.S2'),
                  ],
                }),
              ],
            }),
          ],
        }),
      ],
    };

    // EXECUTE
    const merged = mergeBacklogs(patched, architect);
    const milestones = merged.backlog[0].milestones;

    // VERIFY — both milestones present; new milestone's tasks/subtasks appended intact.
    expect(milestones.map(m => m.id)).toEqual(['P1.M1', 'P1.M2']);
    expect(milestones[1].tasks[0].id).toBe('P1.M2.T1');
    expect(milestones[1].tasks[0].subtasks.map(s => s.id)).toEqual([
      'P1.M2.T1.S1',
      'P1.M2.T1.S2',
    ]);
    expect(warnMock).not.toHaveBeenCalled();
  });
});

// ============================================================================
// mergeBacklogs — task id de-dup (contract (c))
// ============================================================================

describe('mergeBacklogs — task de-dup', () => {
  it('de-duplicates a task whose id already exists (keeps patched status, warns)', () => {
    // SETUP — patched T1 has status Obsolete (removed); architect re-decomposes T1 (Planned).
    const patched: Backlog = {
      backlog: [
        makePhase('P1', {
          title: 'F',
          milestones: [
            makeMilestone('P1.M1', {
              title: 'M',
              tasks: [
                makeTask('P1.M1.T1', {
                  status: 'Obsolete',
                  subtasks: [makeSubtask('P1.M1.T1.S1')],
                }),
              ],
            }),
          ],
        }),
      ],
    };
    const architect: Backlog = {
      backlog: [
        makePhase('P1', {
          title: 'F',
          milestones: [
            makeMilestone('P1.M1', {
              title: 'M',
              tasks: [
                makeTask('P1.M1.T1', {
                  title: 'T-dup',
                  subtasks: [makeSubtask('P1.M1.T1.S1')],
                }),
              ],
            }),
          ],
        }),
      ],
    };

    // EXECUTE
    const merged = mergeBacklogs(patched, architect);
    const tasks = merged.backlog[0].milestones[0].tasks;

    // VERIFY — T1 de-duped (single task); patched's Obsolete version kept; warn fired.
    expect(tasks).toHaveLength(1);
    expect(tasks[0].status).toBe('Obsolete');
    expect(tasks[0].title).not.toBe('T-dup');
    expect(warnMock).toHaveBeenCalledTimes(1);
    const [ctx, msg] = warnMock.mock.calls[0];
    expect(ctx).toMatchObject({ itemId: 'P1.M1.T1', level: 'task' });
    expect(msg).toMatch(/de-dup skip/);
  });

  it('appends a new architect task while de-duping a colliding one in the same milestone', () => {
    // SETUP — patched has T1; architect has T1 (dup) AND T2 (new). Covers the append + skip
    // branches in a single milestone.
    const patched: Backlog = {
      backlog: [
        makePhase('P1', {
          title: 'F',
          milestones: [
            makeMilestone('P1.M1', {
              title: 'M',
              tasks: [makeTask('P1.M1.T1', { status: 'Planned' })],
            }),
          ],
        }),
      ],
    };
    const architect: Backlog = {
      backlog: [
        makePhase('P1', {
          title: 'F',
          milestones: [
            makeMilestone('P1.M1', {
              title: 'M',
              tasks: [
                makeTask('P1.M1.T1', { title: 'dup' }),
                makeTask('P1.M1.T2', { title: 'fresh' }),
              ],
            }),
          ],
        }),
      ],
    };

    // EXECUTE
    const merged = mergeBacklogs(patched, architect);
    const tasks = merged.backlog[0].milestones[0].tasks;

    // VERIFY — T1 kept (patched), T2 appended; one warn (for T1).
    expect(tasks.map(t => t.id)).toEqual(['P1.M1.T1', 'P1.M1.T2']);
    expect(tasks[0].title).not.toBe('dup');
    expect(warnMock).toHaveBeenCalledTimes(1);
    expect(warnMock.mock.calls[0][0]).toMatchObject({ itemId: 'P1.M1.T1' });
  });
});

// ============================================================================
// mergeBacklogs — defensive id-collision skips (phase / milestone)
// ============================================================================

describe('mergeBacklogs — defensive id collisions', () => {
  it('skips an architect phase whose id collides (despite a new title) and warns', () => {
    // SETUP — patched P1(title 'A'); architect P1(title 'B', id collides) → phase-level skip.
    const patched: Backlog = {
      backlog: [makePhase('P1', { title: 'Alpha' })],
    };
    const architect: Backlog = {
      backlog: [makePhase('P1', { title: 'Beta' })], // new title, COLLIDING id
    };

    // EXECUTE
    const merged = mergeBacklogs(patched, architect);

    // VERIFY — architect phase skipped (no duplicate P1 id); warn fired at phase level.
    expect(merged.backlog).toHaveLength(1);
    expect(merged.backlog[0].title).toBe('Alpha');
    expect(warnMock).toHaveBeenCalledTimes(1);
    expect(warnMock.mock.calls[0][0]).toMatchObject({
      itemId: 'P1',
      level: 'phase',
    });
  });

  it('skips an architect milestone whose id collides (despite a new title) and warns', () => {
    // SETUP — title-matched phase; architect milestone has a NEW title but a COLLIDING id.
    const patched: Backlog = {
      backlog: [
        makePhase('P1', {
          title: 'F',
          milestones: [makeMilestone('P1.M1', { title: 'Old' })],
        }),
      ],
    };
    const architect: Backlog = {
      backlog: [
        makePhase('P1', {
          title: 'F', // title match → mergePhase
          milestones: [
            makeMilestone('P1.M1', { title: 'Fresh' }), // new title, COLLIDING id
          ],
        }),
      ],
    };

    // EXECUTE
    const merged = mergeBacklogs(patched, architect);

    // VERIFY — milestone skipped (no duplicate P1.M1 id); warn fired at milestone level.
    expect(merged.backlog[0].milestones).toHaveLength(1);
    expect(merged.backlog[0].milestones[0].title).toBe('Old');
    expect(warnMock).toHaveBeenCalledTimes(1);
    expect(warnMock.mock.calls[0][0]).toMatchObject({
      itemId: 'P1.M1',
      level: 'milestone',
    });
  });
});

// ============================================================================
// mergeBacklogs — empty-input no-ops (non-delta identity)
// ============================================================================

describe('mergeBacklogs — empty-input no-ops', () => {
  it('mergeBacklogs({ backlog: [] }, x) deep-equals x (non-delta no-op)', () => {
    // SETUP — architect output with a phase + nested milestone/task.
    const architect: Backlog = {
      backlog: [
        makePhase('P1', {
          title: 'N',
          milestones: [
            makeMilestone('P1.M1', {
              title: 'M',
              tasks: [makeTask('P1.M1.T1')],
            }),
          ],
        }),
      ],
    };

    // EXECUTE + VERIFY — empty patched → result deep-equals the architect input.
    expect(mergeBacklogs({ backlog: [] }, architect)).toEqual(architect);
    expect(warnMock).not.toHaveBeenCalled();
  });

  it('mergeBacklogs(x, { backlog: [] }) deep-equals x (empty architect no-op)', () => {
    // SETUP — patched backlog with content; empty architect.
    const patched: Backlog = {
      backlog: [
        makePhase('P1', {
          title: 'K',
          milestones: [
            makeMilestone('P1.M1', {
              tasks: [makeTask('P1.M1.T1', { status: 'Complete' })],
            }),
          ],
        }),
      ],
    };

    // EXECUTE + VERIFY — empty architect → result deep-equals the patched input.
    expect(mergeBacklogs(patched, { backlog: [] })).toEqual(patched);
    expect(warnMock).not.toHaveBeenCalled();
  });
});

// ============================================================================
// mergeBacklogs — patched statuses preserved
// ============================================================================

describe('mergeBacklogs — patched status preservation', () => {
  it('preserves patched modified→Planned and removed→Obsolete statuses through the merge', () => {
    // SETUP — patched has a Planned (modified) task and an Obsolete (removed) task; the architect
    // re-decomposes the SAME ids (which de-dup to patched's status-preserving versions) AND adds
    // a brand-new task.
    const patched: Backlog = {
      backlog: [
        makePhase('P1', {
          title: 'F',
          milestones: [
            makeMilestone('P1.M1', {
              title: 'M',
              tasks: [
                makeTask('P1.M1.T1', {
                  status: 'Planned',
                  title: 'modified-task',
                }),
                makeTask('P1.M1.T2', {
                  status: 'Obsolete',
                  title: 'removed-task',
                }),
              ],
            }),
          ],
        }),
      ],
    };
    const architect: Backlog = {
      backlog: [
        makePhase('P1', {
          title: 'F',
          milestones: [
            makeMilestone('P1.M1', {
              title: 'M',
              tasks: [
                // T1 + T2 re-decomposed (collide → de-dup keeps patched statuses).
                makeTask('P1.M1.T1', { title: 'arch-T1' }),
                makeTask('P1.M1.T2', { title: 'arch-T2' }),
                // T3 brand new (appended).
                makeTask('P1.M1.T3', { title: 'added-task' }),
              ],
            }),
          ],
        }),
      ],
    };

    // EXECUTE
    const merged = mergeBacklogs(patched, architect);
    const tasks = merged.backlog[0].milestones[0].tasks;

    // VERIFY — T1 Planned (modified reset), T2 Obsolete (removed), T3 appended; two de-dup warns.
    const byId = Object.fromEntries(tasks.map(t => [t.id, t]));
    expect(byId['P1.M1.T1'].status).toBe('Planned');
    expect(byId['P1.M1.T1'].title).toBe('modified-task');
    expect(byId['P1.M1.T2'].status).toBe('Obsolete');
    expect(byId['P1.M1.T2'].title).toBe('removed-task');
    expect(byId['P1.M1.T3'].title).toBe('added-task');
    expect(warnMock).toHaveBeenCalledTimes(2); // T1 + T2 de-dup
  });
});

// ============================================================================
// ID-renumbering helpers (BUG-001 fix — P1.M1.T1.S1)
// ============================================================================
//
// Pure data-in / data-out tests for the five exported helpers added in S1. These exercise
// every branch: empty vs non-empty reserved, each hierarchy level, dep-in-map vs
// dep-outside, deep nesting, and the collision-free guarantee (none of the produced ids were
// in the pre-call snapshot of `reserved`).

describe('renumber helpers', () => {
  // ---- maxPhaseNumber ----
  describe('maxPhaseNumber', () => {
    it('returns 1 for an empty reserved set', () => {
      expect(maxPhaseNumber(new Set())).toBe(1);
    });

    it('returns 2 for a reserved set containing only P1', () => {
      expect(maxPhaseNumber(new Set(['P1']))).toBe(2);
    });

    it('returns max+1 when multiple phases are reserved', () => {
      expect(maxPhaseNumber(new Set(['P1', 'P3', 'P2']))).toBe(4);
    });

    it('infers the phase number from a milestone id when the bare phase id is absent', () => {
      expect(maxPhaseNumber(new Set(['P2.M1']))).toBe(3);
    });

    it('infers the phase number from a deeply-nested subtask id', () => {
      expect(maxPhaseNumber(new Set(['P1.M1.T2.S1']))).toBe(2);
    });

    it('ignores non-phase ids', () => {
      expect(maxPhaseNumber(new Set(['foo', 'X1', 'PX']))).toBe(1);
    });
  });

  // ---- maxChildNumber ----
  describe('maxChildNumber', () => {
    it('milestone level: returns 1 when no milestones under the phase', () => {
      expect(maxChildNumber('P1', new Set(), 'milestone')).toBe(1);
    });

    it('milestone level: returns max M-num + 1 under the phase', () => {
      expect(
        maxChildNumber('P1', new Set(['P1.M1', 'P1.M3', 'P1.M2']), 'milestone')
      ).toBe(4);
    });

    it('milestone level: ignores milestones under a different phase', () => {
      expect(
        maxChildNumber('P1', new Set(['P1.M1', 'P2.M9']), 'milestone')
      ).toBe(2);
    });

    it('task level: anchors on the immediate parent (the milestone id)', () => {
      // Loose work-item example "parentId 'P1', level 'task'" is reconciled: the hierarchy-
      // correct anchor is the milestone id 'P1.M1'.
      expect(
        maxChildNumber('P1.M1', new Set(['P1.M1.T1', 'P1.M1.T2']), 'task')
      ).toBe(3);
    });

    it('task level: infers from a subtask descendant when the bare task id is absent', () => {
      expect(maxChildNumber('P1.M1', new Set(['P1.M1.T2.S5']), 'task')).toBe(3);
    });

    it('task level: ignores tasks under a sibling milestone', () => {
      expect(
        maxChildNumber('P1.M1', new Set(['P1.M1.T1', 'P1.M2.T9']), 'task')
      ).toBe(2);
    });

    it('subtask level: anchors on the immediate parent (the task id)', () => {
      expect(
        maxChildNumber(
          'P1.M1.T1',
          new Set(['P1.M1.T1.S1', 'P1.M1.T1.S3']),
          'subtask'
        )
      ).toBe(4);
    });

    it('subtask level: returns 1 when no subtasks under the task', () => {
      expect(maxChildNumber('P1.M1.T1', new Set(), 'subtask')).toBe(1);
    });

    it('subtask level: ignores subtasks under a different task', () => {
      expect(
        maxChildNumber(
          'P1.M1.T1',
          new Set(['P1.M1.T1.S1', 'P1.M1.T2.S9']),
          'subtask'
        )
      ).toBe(2);
    });
  });

  // ---- renumberTask ----
  describe('renumberTask', () => {
    it('produces hierarchy-consistent ids and registers them, preserving non-id fields', () => {
      const sub = makeSubtask('P1.M1.T1.S1', { story_points: 5 });
      const task = makeTask('P1.M1.T1', { subtasks: [sub] });
      const reserved = new Set<string>(['P9']);
      const snap = new Set(reserved);

      const out = renumberTask(task, 'P3.M2', 4, reserved);

      expect(out.id).toBe('P3.M2.T4');
      expect(out.subtasks[0].id).toBe('P3.M2.T4.S1');
      // registered
      expect(reserved.has('P3.M2.T4')).toBe(true);
      expect(reserved.has('P3.M2.T4.S1')).toBe(true);
      // collision-free vs the pre-call snapshot
      expect(snap.has('P3.M2.T4')).toBe(false);
      expect(snap.has('P3.M2.T4.S1')).toBe(false);
      // non-id fields preserved
      expect(out.title).toBe(task.title);
      expect(out.status).toBe(task.status);
      expect(out.description).toBe(task.description);
      expect(out.subtasks[0].story_points).toBe(5);
      expect(out.subtasks[0].context_scope).toBe(sub.context_scope);
    });

    it('rewrites in-scope subtask deps and leaves external deps verbatim', () => {
      const s1 = {
        ...makeSubtask('P1.M1.T1.S1'),
        dependencies: ['P1.M1.T1.S2'],
      };
      const s2 = {
        ...makeSubtask('P1.M1.T1.S2'),
        dependencies: ['P9.M9.T9.S9'], // external — must stay verbatim
      };
      const task = makeTask('P1.M1.T1', { subtasks: [s1, s2] });
      const reserved = new Set<string>();

      const out = renumberTask(task, 'P5.M1', 7, reserved);

      expect(out.subtasks[0].id).toBe('P5.M1.T7.S1');
      expect(out.subtasks[1].id).toBe('P5.M1.T7.S2');
      // in-scope dep S1 → S2 rewritten
      expect(out.subtasks[0].dependencies).toEqual(['P5.M1.T7.S2']);
      // external dep verbatim
      expect(out.subtasks[1].dependencies).toEqual(['P9.M9.T9.S9']);
    });

    it('does not mutate the input task', () => {
      const task = makeTask('P1.M1.T1', {
        subtasks: [makeSubtask('P1.M1.T1.S1')],
      });
      const reserved = new Set<string>();
      const before = JSON.stringify(task);

      renumberTask(task, 'P2.M1', 1, reserved);

      expect(JSON.stringify(task)).toBe(before); // input untouched
    });
  });

  // ---- renumberMilestone ----
  describe('renumberMilestone', () => {
    it('produces hierarchy-consistent ids for tasks/subtasks and registers them', () => {
      const ms = makeMilestone('P1.M1', {
        tasks: [
          makeTask('P1.M1.T1', {
            subtasks: [makeSubtask('P1.M1.T1.S1')],
          }),
          makeTask('P1.M1.T2', {
            subtasks: [makeSubtask('P1.M1.T2.S1'), makeSubtask('P1.M1.T2.S2')],
          }),
        ],
      });
      const reserved = new Set<string>();
      const snap = new Set(reserved);

      const out = renumberMilestone(ms, 'P7', 3, reserved);

      expect(out.id).toBe('P7.M3');
      expect(out.tasks[0].id).toBe('P7.M3.T1');
      expect(out.tasks[0].subtasks[0].id).toBe('P7.M3.T1.S1');
      expect(out.tasks[1].id).toBe('P7.M3.T2');
      expect(out.tasks[1].subtasks[0].id).toBe('P7.M3.T2.S1');
      expect(out.tasks[1].subtasks[1].id).toBe('P7.M3.T2.S2');
      // all registered
      for (const id of [
        'P7.M3',
        'P7.M3.T1',
        'P7.M3.T1.S1',
        'P7.M3.T2',
        'P7.M3.T2.S1',
        'P7.M3.T2.S2',
      ]) {
        expect(reserved.has(id)).toBe(true);
        expect(snap.has(id)).toBe(false); // collision-free
      }
    });

    it('rewrites in-scope cross-task subtask deps and leaves external deps verbatim', () => {
      // S1 in T1 depends on S2 in T2 (cross-task, in-scope) → rewritten.
      const s1 = {
        ...makeSubtask('P1.M1.T1.S1'),
        dependencies: ['P1.M1.T2.S2'],
      };
      const t1 = makeTask('P1.M1.T1', { subtasks: [s1] });
      const s2a = makeSubtask('P1.M1.T2.S1');
      // S2 in T2 depends on an external id → verbatim.
      const s2b = {
        ...makeSubtask('P1.M1.T2.S2'),
        dependencies: ['PEXT.M1.T1.S1'],
      };
      const t2 = makeTask('P1.M1.T2', { subtasks: [s2a, s2b] });
      const ms = makeMilestone('P1.M1', { tasks: [t1, t2] });

      const out = renumberMilestone(ms, 'P4', 1, new Set());

      // T1.S1 dep on T2.S2 (in-scope, cross-task) → rewritten to the new T2.S2 id.
      expect(out.tasks[0].subtasks[0].dependencies).toEqual(['P4.M1.T2.S2']);
      // T2.S2 external dep → verbatim.
      expect(out.tasks[1].subtasks[1].dependencies).toEqual(['PEXT.M1.T1.S1']);
    });

    it('preserves non-id fields verbatim', () => {
      const ms = makeMilestone('P1.M1', {
        title: 'Reports',
        tasks: [
          makeTask('P1.M1.T1', {
            title: 'Build',
            subtasks: [makeSubtask('P1.M1.T1.S1', { story_points: 8 })],
          }),
        ],
      });

      const out = renumberMilestone(ms, 'P2', 1, new Set());

      expect(out.title).toBe('Reports');
      expect(out.status).toBe('Planned');
      expect(out.tasks[0].title).toBe('Build');
      expect(out.tasks[0].subtasks[0].story_points).toBe(8);
    });
  });

  // ---- renumberPhase ----
  describe('renumberPhase', () => {
    it('produces a hierarchy-consistent id tree for a multi-milestone phase', () => {
      const phase = makePhase('P1', {
        milestones: [
          makeMilestone('P1.M1', {
            tasks: [
              makeTask('P1.M1.T1', {
                subtasks: [makeSubtask('P1.M1.T1.S1')],
              }),
            ],
          }),
          makeMilestone('P1.M2', {
            tasks: [
              makeTask('P1.M2.T1', {
                subtasks: [
                  makeSubtask('P1.M2.T1.S1'),
                  makeSubtask('P1.M2.T1.S2'),
                ],
              }),
            ],
          }),
        ],
      });
      const reserved = new Set<string>([
        'P1',
        'P1.M1',
        'P1.M1.T1',
        'P1.M1.T1.S1',
      ]);
      const snap = new Set(reserved);

      const out = renumberPhase(phase, 5, reserved);

      expect(out.id).toBe('P5');
      expect(out.milestones[0].id).toBe('P5.M1');
      expect(out.milestones[0].tasks[0].id).toBe('P5.M1.T1');
      expect(out.milestones[0].tasks[0].subtasks[0].id).toBe('P5.M1.T1.S1');
      expect(out.milestones[1].id).toBe('P5.M2');
      expect(out.milestones[1].tasks[0].id).toBe('P5.M2.T1');
      expect(out.milestones[1].tasks[0].subtasks[0].id).toBe('P5.M2.T1.S1');
      expect(out.milestones[1].tasks[0].subtasks[1].id).toBe('P5.M2.T1.S2');
      // all new ids registered and collision-free vs the snapshot
      for (const id of [
        'P5',
        'P5.M1',
        'P5.M1.T1',
        'P5.M1.T1.S1',
        'P5.M2',
        'P5.M2.T1',
        'P5.M2.T1.S1',
        'P5.M2.T1.S2',
      ]) {
        expect(reserved.has(id)).toBe(true);
        expect(snap.has(id)).toBe(false);
      }
    });

    it('rewrites in-scope cross-milestone subtask deps and leaves external deps verbatim', () => {
      // S1 in M1.T1 depends on S2 in M2.T1 (cross-milestone, in-scope) → rewritten.
      const s1 = {
        ...makeSubtask('P1.M1.T1.S1'),
        dependencies: ['P1.M2.T1.S2'],
      };
      const m1 = makeMilestone('P1.M1', {
        tasks: [makeTask('P1.M1.T1', { subtasks: [s1] })],
      });
      const s2a = makeSubtask('P1.M2.T1.S1');
      const s2b = {
        ...makeSubtask('P1.M2.T1.S2'),
        dependencies: ['PEXT.M9.T9.S9'], // external → verbatim
      };
      const m2 = makeMilestone('P1.M2', {
        tasks: [makeTask('P1.M2.T1', { subtasks: [s2a, s2b] })],
      });
      const phase = makePhase('P1', { milestones: [m1, m2] });

      const out = renumberPhase(phase, 2, new Set());

      expect(out.milestones[0].tasks[0].subtasks[0].dependencies).toEqual([
        'P2.M2.T1.S2',
      ]);
      expect(out.milestones[1].tasks[0].subtasks[1].dependencies).toEqual([
        'PEXT.M9.T9.S9',
      ]);
    });

    it('preserves all non-id fields including prd_selectors', () => {
      const sub = {
        ...makeSubtask('P1.M1.T1.S1'),
        prd_selectors: ['§2.3', '§4.1'],
      };
      const phase = makePhase('P1', {
        title: 'Reporting',
        milestones: [
          makeMilestone('P1.M1', {
            tasks: [makeTask('P1.M1.T1', { subtasks: [sub] })],
          }),
        ],
      });

      const out = renumberPhase(phase, 9, new Set());

      expect(out.title).toBe('Reporting');
      expect(out.milestones[0].tasks[0].subtasks[0].prd_selectors).toEqual([
        '§2.3',
        '§4.1',
      ]);
    });

    it('does not mutate the input phase', () => {
      const phase = makePhase('P1', {
        milestones: [
          makeMilestone('P1.M1', {
            tasks: [
              makeTask('P1.M1.T1', { subtasks: [makeSubtask('P1.M1.T1.S1')] }),
            ],
          }),
        ],
      });
      const before = JSON.stringify(phase);

      renumberPhase(phase, 2, new Set());

      expect(JSON.stringify(phase)).toBe(before); // input untouched
    });
  });
});
