/**
 * Integration test — full delta breakdown path (PRD §4.3; bugfix 001, Issue 1)
 *
 * @remarks
 * Drives the FULL delta-breakdown path — `handleDelta()` → (default)
 * `spawnDeltaSession()` → `decomposePRD()` — starting from a parent session with a
 * **NON-EMPTY** backlog (the production precondition that masked the dead-branch bug in
 * `tests/unit/core/delta-prd.test.ts` CASE A, which seeds an empty backlog).
 *
 * Asserts the three Issue-1 acceptance criteria end-to-end with REAL `session-utils` file I/O
 * (resolvePRD/writeDeltaPRD/loadDeltaPRD/writePendingDeltaHash) and mocked agents/SessionManager:
 *  - (d) the Architect breakdown runs over `delta_prd.md` content (NOT the full PRD / prdSnapshot),
 *        and `createArchitectPrompt` is called EXACTLY ONCE (hasBacklog did NOT short-circuit).
 *  - (e) the delta session's final `tasks.json` contains NEW tasks for the ADDED requirement.
 *  - (f) patched statuses survived the S2 merge: modified task → Planned, removed task → Obsolete.
 *
 * Mock surface mirrors `tests/unit/core/delta-prd.test.ts` and EXTENDS it for the full path:
 * `currentSession` is a LIVE getter (stateful mock — it switches parent→delta via
 * `createDeltaSession`), `saveBacklog` syncs `taskRegistry` in memory AND writes disk, and the
 * architect mock WRITES `tasks.json` (the production side effect) via `vi.hoisted` shared state.
 *
 * @see {@link ../../../src/workflows/prp-pipeline.ts}
 * @see {@link ../../../src/core/backlog-merger.ts}
 * @see {@link ../../../src/core/session-utils.ts}
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  Backlog,
  DeltaAnalysis,
  SessionState,
} from '../../../src/core/models.js';
import { mergeBacklogs } from '../../../src/core/backlog-merger.js';

// ─────────────────────────────────────────────────────────────────────────────
// vi.hoisted: assertable spy + shared mutable state.
// (vi.mock factories are hoisted — they cannot reference non-`mock`-prefixed outer vars.)
// ─────────────────────────────────────────────────────────────────────────────
const { createArchitectPromptMock, mockState } = vi.hoisted(() => ({
  // SPY: assert createArchitectPrompt's FIRST arg (the prdContent) + call count.
  createArchitectPromptMock: vi.fn().mockReturnValue({
    user: 'mock-architect-prompt',
  }),
  // Shared mutable state for the architect's tasks.json side effect.
  mockState: {
    deltaSessionPath: '',
    architectBacklog: null as Backlog | null,
  },
}));

// Mock the architect prompt generator so decomposePRD's dynamic import resolves to a spy.
vi.mock('../../../src/agents/prompts/architect-prompt.js', () => ({
  createArchitectPrompt: createArchitectPromptMock,
}));

// Mock the agent factory. The architect WRITES tasks.json itself in production — the mock must
// too, or decomposePRD's readFile below throws ENOENT. The write uses the vi.hoisted shared state.
vi.mock('../../../src/agents/agent-factory.js', () => ({
  createArchitectAgent: vi.fn().mockReturnValue({
    prompt: vi.fn().mockImplementation(async () => {
      const { writeFileSync } = await import('node:fs');
      const { join } = await import('node:path');
      if (mockState.deltaSessionPath && mockState.architectBacklog) {
        writeFileSync(
          join(mockState.deltaSessionPath, 'tasks.json'),
          JSON.stringify(mockState.architectBacklog)
        );
      }
      return { status: 'success', output: '' };
    }),
  }),
}));

// Mock SessionManager (the real constructor's instance is overwritten in the test with a
// STATEFUL mock — see makeStatefulSessionManager).
vi.mock('../../../src/core/session-manager.js', () => ({
  SessionManager: vi.fn(),
}));

// Mock DeltaAnalysisWorkflow (constructor → { run } returning a DeltaAnalysis with an 'added'
// change among modified + removed). spawnDeltaSession does `new DeltaAnalysisWorkflow(...)` then
// `await workflow.run()`.
vi.mock('../../../src/workflows/delta-analysis-workflow.js', () => ({
  DeltaAnalysisWorkflow: vi.fn().mockImplementation(() => ({
    run: vi.fn().mockResolvedValue({
      changes: [
        {
          itemId: 'P1.M1.T1',
          type: 'modified',
          description: 'T1 requirements changed',
          impact: 'Re-execute T1',
        },
        {
          itemId: 'P1.M1.T2',
          type: 'removed',
          description: 'T2 dropped from PRD',
          impact: 'Drop T2',
        },
        {
          itemId: 'P1.M2',
          type: 'added',
          description: 'New feature section added',
          impact: 'Decompose new tasks',
        },
      ],
      patchInstructions: 'Re-execute P1.M1.T1; drop P1.M1.T2; decompose P1.M2',
      taskIds: ['P1.M1.T1'],
    } satisfies DeltaAnalysis),
  })),
}));

// Mock task-patcher: patchBacklog → NON-EMPTY patched backlog (T1 Planned [modified], T2 Obsolete
// [removed]). MUST return non-empty (a bare vi.fn() returns undefined → saveBacklog(undefined) →
// merge crash). Same structure/ids as the parent so the merge can match + assertions can find T1/T2.
vi.mock('../../../src/core/task-patcher.js', () => ({
  patchBacklog: vi
    .fn()
    .mockImplementation((b: Backlog) => patchParentBacklog(b)),
}));

// Mock task-utils: filterByStatus → [] (no completed tasks → simpler delta render). NOTE: the
// assertions cannot use task-utils helpers (it's mocked) — use the local walkers below.
vi.mock('../../../src/utils/task-utils.js', () => ({
  filterByStatus: vi.fn().mockReturnValue([]),
}));

// Mock bug-hunt + fix-cycle (constructor side-effect avoidance — mirror delta-prd.test.ts).
vi.mock('../../../src/workflows/bug-hunt-workflow.js', () => ({
  BugHuntWorkflow: vi.fn(),
}));
vi.mock('../../../src/workflows/fix-cycle-workflow.js', () => ({
  FixCycleWorkflow: vi.fn(),
}));

// Mock execution-guard (decomposePRD dependency).
vi.mock('../../../src/utils/validation/execution-guard.js', () => ({
  validateNestedExecution: vi.fn(),
  isNestedExecutionError: vi.fn(() => false),
}));

// session-utils is NOT mocked — resolvePRD/writeDeltaPRD/loadDeltaPRD/writePendingDeltaHash run
// for real against the tmp dir.
import { PRPPipeline } from '../../../src/workflows/prp-pipeline.js';

// ─────────────────────────────────────────────────────────────────────────────
// Fixture builders
// ─────────────────────────────────────────────────────────────────────────────

// context_scope must pass the CONTRACT DEFINITION format (ContextScopeSchema). Subtasks need it.
const CS = `CONTRACT DEFINITION:
1. RESEARCH NOTE: baseline context.
2. INPUT: parent artifacts.
3. LOGIC: implement per delta.
4. OUTPUT: merged tasks.json.`;

function sub(id: string, status: string = 'Planned') {
  return {
    id,
    type: 'Subtask' as const,
    title: id,
    status: status as any,
    story_points: 1,
    dependencies: [] as string[],
    context_scope: CS,
    prd_selectors: [] as string[],
  };
}

/** NON-EMPTY parent backlog: P1 → P1.M1 → T1[Complete] + T2[Complete]. (The bug-mask precondition.) */
function makeParentBacklog(): Backlog {
  return {
    backlog: [
      {
        id: 'P1',
        type: 'Phase',
        title: 'Foundation',
        status: 'Planned',
        description: 'Foundation phase',
        milestones: [
          {
            id: 'P1.M1',
            type: 'Milestone',
            title: 'Core',
            status: 'Planned',
            description: 'Core milestone',
            tasks: [
              {
                id: 'P1.M1.T1',
                type: 'Task',
                title: 'T1',
                status: 'Complete',
                description: 'Task one',
                subtasks: [sub('P1.M1.T1.S1', 'Complete')],
              },
              {
                id: 'P1.M1.T2',
                type: 'Task',
                title: 'T2',
                status: 'Complete',
                description: 'Task two',
                subtasks: [sub('P1.M1.T2.S1', 'Complete')],
              },
            ],
          },
        ],
      },
    ],
  };
}

/** Patched backlog: SAME structure/ids as parent but T1→Planned (modified), T2→Obsolete (removed). */
function patchParentBacklog(parent: Backlog): Backlog {
  const phase = parent.backlog[0];
  const milestone = phase.milestones[0];
  const [t1, t2] = milestone.tasks;
  return {
    backlog: [
      {
        ...phase,
        milestones: [
          {
            ...milestone,
            tasks: [
              { ...t1, status: 'Planned' },
              { ...t2, status: 'Obsolete' },
            ],
          },
        ],
      },
    ],
  };
}

/**
 * Architect output: SAME phase title 'Foundation' (→ merge EXTENDS by title) with a NEW milestone
 * P1.M2 title 'New Feature' (→ append) containing a NEW task P1.M2.T1 + subtask. NEW ids only — no
 * collision with the patched P1.M1.* items, so the merge appends cleanly.
 */
function makeArchitectBacklog(): Backlog {
  return {
    backlog: [
      {
        id: 'P1',
        type: 'Phase',
        title: 'Foundation',
        status: 'Planned',
        description: 'Foundation phase',
        milestones: [
          {
            id: 'P1.M2',
            type: 'Milestone',
            title: 'New Feature',
            status: 'Planned',
            description: 'New feature milestone for the added requirement',
            tasks: [
              {
                id: 'P1.M2.T1',
                type: 'Task',
                title: 'New Task',
                status: 'Planned',
                description: 'Task for the added requirement',
                subtasks: [sub('P1.M2.T1.S1')],
              },
            ],
          },
        ],
      },
    ],
  };
}

/**
 * REALISTIC architect output (the case makeArchitectBacklog AVOIDS): the architect numbers fresh
 * from P1 (TASK_BREAKDOWN_PROMPT, prompts.ts:134) and invents its OWN title from the delta content.
 * So a new 'Reporting' requirement emits Phase id 'P1' title 'Reporting' (NEW title, colliding id),
 * Milestone id 'P1.M1' title 'Reports' (colliding), Task id 'P1.M1.T1' (colliding). Pre-S2 this was
 * DROPPED by mergeBacklogs (skip-on-collision); post-S2 it is renumbered-and-appended (BUG-001 fix).
 */
function makeCollidingArchitectBacklog(): Backlog {
  return {
    backlog: [
      {
        id: 'P1', // COLLIDES with patched Foundation's P1 — but title 'Reporting' is NEW
        type: 'Phase',
        title: 'Reporting',
        status: 'Planned',
        description: 'Reporting phase (ADDED requirement)',
        milestones: [
          {
            id: 'P1.M1', // COLLIDES with patched Core's P1.M1 — but title 'Reports' is NEW
            type: 'Milestone',
            title: 'Reports',
            status: 'Planned',
            description: 'Reports milestone (ADDED requirement)',
            tasks: [
              {
                id: 'P1.M1.T1', // COLLIDES with patched T1
                type: 'Task',
                title: 'New Report Task',
                status: 'Planned',
                description: 'Task for the ADDED requirement',
                subtasks: [sub('P1.M1.T1.S1')], // also collides
              },
            ],
          },
        ],
      },
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// STATEFUL SessionManager mock.
// currentSession is read MULTIPLE times across the path (handleDelta, spawnDeltaSession as the
// PARENT, then createDeltaSession switches it to the DELTA session, then decomposePRD reads it).
// A stateless mock (fixed currentSession) CANNOT model this → use a LIVE getter.
// saveBacklog MUST sync taskRegistry in memory (the S2 merge reads currentSession.taskRegistry as
// the patched backlog) AND write tasks.json to disk (the FINAL artifact asserted on).
// ─────────────────────────────────────────────────────────────────────────────
function makeStatefulSessionManager(
  parent: SessionState,
  deltaSessionPath: string,
  delta: SessionState
) {
  let _current = parent;
  return {
    prdPath: '', // set by the caller (real tmp PRD file)
    get currentSession() {
      return _current; // ALWAYS live across the path
    },
    initialize: vi.fn().mockResolvedValue(parent),
    createDeltaSession: vi.fn().mockImplementation(async () => {
      mkdirSync(deltaSessionPath, { recursive: true }); // real dir for writeDeltaPRD + architect write
      _current = delta; // switch to the DELTA session (metadata.parentSession set)
    }),
    saveBacklog: vi.fn().mockImplementation(async (b: Backlog) => {
      _current = { ..._current, taskRegistry: b }; // SYNC MEMORY (S2 merge reads taskRegistry)
      writeFileSync(
        join(_current.metadata.path, 'tasks.json'),
        JSON.stringify(b)
      ); // mirror real SM so the final tasks.json = merged
    }),
    hasSessionChanged: vi.fn().mockReturnValue(false),
    flushUpdates: vi.fn().mockResolvedValue(undefined),
  } as any;
}

// Small local id/task walkers — do NOT use src/utils/task-utils (it's MOCKED here).
function collectIds(b: Backlog): string[] {
  const ids: string[] = [];
  for (const p of b.backlog) {
    ids.push(p.id);
    for (const m of p.milestones) {
      ids.push(m.id);
      for (const t of m.tasks) {
        ids.push(t.id);
        for (const s of t.subtasks) ids.push(s.id);
      }
    }
  }
  return ids;
}
function findTask(b: Backlog, id: string) {
  for (const p of b.backlog)
    for (const m of p.milestones)
      for (const t of m.tasks) if (t.id === id) return t;
  throw new Error(`task ${id} not found in backlog`);
}

// ─────────────────────────────────────────────────────────────────────────────
// The test
// ─────────────────────────────────────────────────────────────────────────────
describe('delta breakdown — full handleDelta → spawnDeltaSession → decomposePRD (non-empty parent backlog)', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'delta-brkdn-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    // PRPPipeline registers SIGINT/SIGTERM handlers in its constructor — mirror delta-prd.test.ts.
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGTERM');
    // NOTE: do NOT vi.restoreAllMocks() — it reverts the mockImplementation set inside the hoisted
    // vi.mock factories (architect prompt's tasks.json write, saveBacklog's memory-sync), breaking
    // every test after the first. clearAllMocks resets call history while preserving implementations.
    vi.clearAllMocks();
  });

  /**
   * Shared setup: scaffold the real on-disk layout, build the non-empty parent + delta sessions,
   * prime the architect side-effect state, drive handleDelta + decomposePRD, and return the handles
   * each assertion needs. Each `it` calls this then runs its own assertions.
   */
  /**
   * Shared setup. Backward-compatible default (`makeArchitectBacklog()`) keeps the existing 4
   * non-colliding `it`s unchanged; the realistic-collision case passes its own fixture so the
   * NEW-title→renumber-append path is driven end-to-end (BUG-001 regression).
   */
  async function setupAndDrive(
    architectBacklog: Backlog = makeArchitectBacklog()
  ): Promise<{
    parent: SessionState;
    deltaPath: string;
  }> {
    const parentPath = join(tmp, '001_parent');
    const deltaPath = join(tmp, '009_delta');
    const prdPath = join(tmp, 'prd.md');
    mkdirSync(parentPath, { recursive: true }); // writePendingDeltaHash writes here
    writeFileSync(
      prdPath,
      '# New PRD\n\n## Added Feature\n\nnew requirement body\n'
    ); // resolvePRD reads this (no @-includes → identity)

    // Parent session: NON-EMPTY backlog (the bug-mask precondition, now the test's setup).
    const parent: SessionState = {
      metadata: {
        id: '001_parent',
        hash: 'parent_hash_1234567890ab',
        path: parentPath,
        createdAt: new Date(),
        parentSession: null,
      },
      prdSnapshot: '# Old PRD',
      taskRegistry: makeParentBacklog(),
      currentItemId: null,
    };

    // Delta session: parentSession set (→ isDelta true); prdSnapshot is the FULL new PRD which MUST
    // NOT be sourced to the architect (the dead-branch leak); taskRegistry starts as the parent
    // backlog (spawnDeltaSession overwrites it with the patched backlog via saveBacklog).
    const delta: SessionState = {
      metadata: {
        id: '009_delta',
        hash: 'delta_hash_1234567890ab',
        path: deltaPath,
        createdAt: new Date(),
        parentSession: '001_parent',
      },
      prdSnapshot: '# Full new PRD (must NOT be used)',
      taskRegistry: makeParentBacklog(),
      currentItemId: null,
    };

    // Prime the architect side-effect state (via the vi.hoisted shared object).
    mockState.deltaSessionPath = deltaPath;
    mockState.architectBacklog = architectBacklog;

    // Construct the pipeline + overwrite its SessionManager with the STATEFUL mock.
    const sm = makeStatefulSessionManager(parent, deltaPath, delta);
    sm.prdPath = prdPath;
    const pipeline = new PRPPipeline(prdPath);
    (pipeline as any).sessionManager = sm;

    // Drive the full path.
    await pipeline.handleDelta(); // → spawnDeltaSession (default): resolvePRD, writePendingDeltaHash,
    //   DeltaAnalysisWorkflow.run, patchBacklog, createDeltaSession [switch+mkdir],
    //   writeDeltaPRD, saveBacklog(patched).
    await pipeline.decomposePRD(); // isDelta → loadDeltaPRD [delta_prd.md] → architect.prompt
    //   [writes tasks.json] → read tasks.json → mergeBacklogs(patched, architect) → saveBacklog(merged).

    return { parent, deltaPath };
  }

  it('sources delta_prd.md (NOT prdSnapshot) to the architect', async () => {
    const { parent } = await setupAndDrive();

    // (d) architect sourced delta_prd.md (NOT prdSnapshot / full PRD); invoked exactly once.
    expect(createArchitectPromptMock).toHaveBeenCalledTimes(1);
    const sourced = createArchitectPromptMock.mock.calls[0][0] as string;
    expect(sourced).toContain('# Delta PRD');
    expect(sourced).toContain('## Added');
    expect(sourced).toContain('P1.M2'); // the added itemId
    expect(sourced).not.toBe(parent.prdSnapshot); // NOT the snapshot
    expect(sourced).not.toContain('# New PRD'); // NOT the raw new-PRD file content
  });

  it('does NOT short-circuit via hasBacklog (architect invoked exactly once)', async () => {
    await setupAndDrive();

    // The dead-branch bug (hasBacklog before isDelta) would have skipped the architect entirely.
    expect(createArchitectPromptMock).toHaveBeenCalledTimes(1);
  });

  it('produces NEW tasks for the added requirement in the delta tasks.json', async () => {
    const { deltaPath } = await setupAndDrive();

    // (e) Final tasks.json has the NEW added-req task (P1.M2.T1) absent from the parent.
    const final = JSON.parse(
      readFileSync(join(deltaPath, 'tasks.json'), 'utf-8')
    ) as Backlog;
    const parentIds = collectIds(makeParentBacklog());
    expect(collectIds(final)).toContain('P1.M2.T1'); // NEW task from the architect
    expect(parentIds).not.toContain('P1.M2.T1'); // absent from the parent
  });

  it('preserves patched statuses: modified→Planned, removed→Obsolete', async () => {
    const { deltaPath } = await setupAndDrive();

    // (f) Patched statuses survived the S2 merge (proves mergeBacklogs ran).
    const final = JSON.parse(
      readFileSync(join(deltaPath, 'tasks.json'), 'utf-8')
    ) as Backlog;
    expect(findTask(final, 'P1.M1.T1').status).toBe('Planned'); // modified
    expect(findTask(final, 'P1.M1.T2').status).toBe('Obsolete'); // removed
  });

  it('survives a realistic architect collision end-to-end (Reporting phase renumbered into tasks.json)', async () => {
    const { deltaPath } = await setupAndDrive(makeCollidingArchitectBacklog());

    // The ADDED 'Reporting' phase survives the real decomposePRD→merge wiring (renumbered, not
    // dropped) alongside the intact patched 'Foundation' phase.
    const final = JSON.parse(
      readFileSync(join(deltaPath, 'tasks.json'), 'utf-8')
    ) as Backlog;
    const titles = final.backlog.map(p => p.title);
    expect(titles).toContain('Foundation'); // patched phase intact
    expect(titles).toContain('Reporting'); // ADDED phase survived the merge (renumbered, not dropped)
    const reporting = final.backlog.find(p => p.title === 'Reporting')!;
    expect(reporting.id).toBe('P2'); // renumbered to a fresh unique id (NOT P1)
    expect(reporting.id).not.toBe('P1');
    // No duplicate ids end-to-end (renumber guarantees uniqueness).
    const ids = collectIds(final);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Pure-function BUG-001 regression guard. mergeBacklogs is PURE (it imports only models.ts), so
// the module-level vi.mocks above are INERT for a direct call — no additional mocks needed.
// ─────────────────────────────────────────────────────────────────────────────
describe('mergeBacklogs — realistic architect collision (BUG-001 regression)', () => {
  it('renumbers (not drops) a NEW-title architect phase whose id collides — the production case', () => {
    const patched = makeParentBacklog(); // P1 'Foundation' → P1.M1 → [T1, T2]
    const architect = makeCollidingArchitectBacklog(); // P1 'Reporting' → P1.M1 'Reports' → P1.M1.T1 (ALL collide)
    const merged = mergeBacklogs(patched, architect);

    const byTitle = Object.fromEntries(merged.backlog.map(p => [p.title, p]));

    // ADDED 'Reporting' phase SURVIVES — renumbered to a fresh unique id (NOT the colliding 'P1').
    expect(byTitle['Reporting']).toBeDefined();
    expect(byTitle['Reporting'].id).toBe('P2');
    expect(byTitle['Reporting'].id).not.toBe('P1');
    // Its 'Reports' milestone + new task survived (remapped, hierarchy-consistent ids).
    const reports = byTitle['Reporting'].milestones.find(
      m => m.title === 'Reports'
    );
    expect(reports).toBeDefined();
    expect(reports!.id).toBe('P2.M1');
    expect(reports!.tasks.map(t => t.id)).toContain('P2.M1.T1');

    // Original 'Foundation' phase + its P1.M1 milestone are FULLY INTACT (original ids preserved).
    expect(byTitle['Foundation']).toBeDefined();
    expect(byTitle['Foundation'].id).toBe('P1');
    expect(byTitle['Foundation'].milestones.map(m => m.id)).toContain('P1.M1');
    expect(byTitle['Foundation'].milestones[0].tasks.map(t => t.id)).toEqual([
      'P1.M1.T1',
      'P1.M1.T2',
    ]);

    // NO duplicate ids anywhere in the merged backlog (renumber guarantees uniqueness).
    const ids = collectIds(merged);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
