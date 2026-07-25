/**
 * Unit tests for the lenient READ path of tasks.json (P2.M2.T1.S2 / bugfix Issue 3B)
 *
 * @remarks
 * Proves the write-strict / read-lenient asymmetry mandated by PRD §5.1:
 *  - `readTasksJSON` now uses `BacklogReadSchema` (S1's lenient twin) so that legacy,
 *    hand-edited, externally-authored, or test-fixture sessions with a PLAIN
 *    (non-`CONTRACT DEFINITION:`) `context_scope` LOAD instead of being hard-rejected.
 *  - `writeTasksJSON` is UNCHANGED — it still uses the strict `BacklogSchema`, preserving
 *    the contract-format guarantee on architect OUTPUT.
 *  - Leniency is FORMAT-only: structural errors (bad subtask ID, empty scope) still throw
 *    `SessionFileError`.
 *  - An optional debug-level log lists subtask IDs missing the CONTRACT DEFINITION prefix
 *    (observable without rejecting) — the scan's TRUE and FALSE branches are both covered
 *    for 100% branch coverage on `src/core/session-utils.ts`.
 *
 * Uses a REAL temp dir + REAL `readTasksJSON` (Pattern A) so the real
 * readFile → JSON.parse → schema.parse path is exercised. The logger is mocked via the
 * canonical `vi.hoisted` stable-object pattern (logger() caches the singleton at first call).
 *
 * @see {@link ../../../src/core/session-utils.ts}
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Backlog, Status } from '../../../src/core/models.js';

// =============================================================================
// MOCK PATTERN: stable shared logger object (logger() caches the singleton)
// =============================================================================
// session-utils' `logger()` accessor caches `_logger ??= getLogger('session-utils')` at
// first call, so getLogger MUST return a STABLE shared object — otherwise the cached
// `_logger` diverges from the spy we inspect after vi.clearAllMocks(). vi.hoisted()
// guarantees the shared mock is initialized BEFORE the vi.mock() factory runs (vi.mock
// is hoisted above all top-level const declarations).
const { mockLogger, mockLoggerDebug } = vi.hoisted(() => {
  const debug = vi.fn();
  return {
    mockLogger: {
      debug,
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    mockLoggerDebug: debug,
  };
});
vi.mock('../../../src/utils/logger.js', () => ({
  getLogger: vi.fn(() => mockLogger),
}));

// Import the system under test AFTER the vi.mock() calls above (imports run after the
// mocked implementations are bound). writeTasksJSON is imported to prove the strict
// write gate is preserved (the core read-lenient / write-strict invariant).
import {
  readTasksJSON,
  writeTasksJSON,
} from '../../../src/core/session-utils.js';

// =============================================================================
// TEST FIXTURES & HELPERS
// =============================================================================

/**
 * A backlog with ONE nested subtask whose `context_scope` is a PLAIN string (no
 * `CONTRACT DEFINITION:` prefix) — the exact PRD Issue 3 repro. The strict
 * `BacklogSchema` REJECTS this; the lenient `BacklogReadSchema` ACCEPTS it.
 */
function makePlainScopeBacklog(): Backlog {
  return {
    backlog: [
      {
        id: 'P1',
        type: 'Phase',
        title: 'Phase 1',
        status: 'Planned',
        description: 'First phase',
        milestones: [
          {
            id: 'P1.M1',
            type: 'Milestone',
            title: 'Milestone 1',
            status: 'Planned',
            description: 'First milestone',
            tasks: [
              {
                id: 'P1.M1.T1',
                type: 'Task',
                title: 'Task 1',
                status: 'Planned',
                description: 'First task',
                subtasks: [
                  {
                    id: 'P1.M1.T1.S1',
                    type: 'Subtask',
                    title: 'Subtask 1',
                    status: 'Planned' as Status,
                    story_points: 1,
                    dependencies: [],
                    // PLAIN scope — the field the strict schema rejects on READ.
                    context_scope: 'Implement feature X in src/foo.ts',
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

/** The same shape, but with a CONTRACT DEFINITION: prefix on the scope (strict-valid). */
function makeContractScopeBacklog(): Backlog {
  const backlog = makePlainScopeBacklog();
  backlog.backlog[0]!.milestones[0]!.tasks[0]!.subtasks[0]!.context_scope =
    'CONTRACT DEFINITION:\n1. RESEARCH NOTE: seed.\n2. INPUT: none.\n3. LOGIC: seed.\n4. OUTPUT: seed.';
  return backlog;
}

/** Write `backlog` as a real tasks.json inside `dir`. */
function writeTasksFile(dir: string, backlog: Backlog): void {
  writeFileSync(join(dir, 'tasks.json'), JSON.stringify(backlog, null, 2));
}

// =============================================================================
// TEST SUITE
// =============================================================================

describe('readTasksJSON — lenient read path (P2.M2.T1.S2)', () => {
  let dir: string;

  beforeEach(() => {
    // SETUP: a fresh real temp directory per test (Pattern A — no fs mock).
    dir = mkdtempSync(join(tmpdir(), 'session-utils-lenient-'));
    // Isolate each test's log assertions.
    mockLoggerDebug.mockClear();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('loads a tasks.json with a plain (non-contract) context_scope (lenient read)', async () => {
    // SETUP: the PRD Issue 3 repro — a plain-scope subtask that previously threw.
    writeTasksFile(dir, makePlainScopeBacklog());

    // EXECUTE: readTasksJSON must now RESOLVE (previously rejected with
    // 'context_scope must start with "CONTRACT DEFINITION:"').
    const result = await readTasksJSON(dir);

    // VERIFY: the backlog loaded with its structure intact.
    expect(result.backlog).toHaveLength(1);
    expect(result.backlog[0]!.milestones[0]!.tasks[0]!.subtasks[0]!.id).toBe(
      'P1.M1.T1.S1'
    );
  });

  it('emits a debug log listing subtask IDs missing the CONTRACT DEFINITION prefix', async () => {
    // SETUP: a plain-scope backlog (the scan's TRUE branch).
    writeTasksFile(dir, makePlainScopeBacklog());

    // EXECUTE
    await readTasksJSON(dir);

    // VERIFY: the lenient-acceptance debug breadcrumb fired with the offending IDs.
    expect(mockLoggerDebug).toHaveBeenCalledWith(
      expect.objectContaining({
        nonContractIds: expect.arrayContaining(['P1.M1.T1.S1']),
      }),
      expect.stringContaining('missing CONTRACT DEFINITION prefix')
    );
  });

  it('does NOT emit the non-contract debug log for a contract-format backlog', async () => {
    // SETUP: a contract-format backlog (the scan's FALSE branch).
    writeTasksFile(dir, makeContractScopeBacklog());

    // EXECUTE
    await readTasksJSON(dir);

    // VERIFY: no debug call carried a `nonContractIds` payload (the scan found nothing).
    const nonContractCall = mockLoggerDebug.mock.calls.find(
      ([, msg]) =>
        typeof msg === 'string' &&
        msg.includes('missing CONTRACT DEFINITION prefix')
    );
    expect(nonContractCall).toBeUndefined();
  });

  it('still throws SessionFileError on STRUCTURAL errors (leniency is FORMAT-only)', async () => {
    // SETUP: a backlog with a bad subtask ID ('P1.M1.T1.X' — invalid hierarchy tail).
    // BacklogReadSchema is FORMAT-lenient only; structural validation is preserved.
    const badIdBacklog = makePlainScopeBacklog();
    badIdBacklog.backlog[0]!.milestones[0]!.tasks[0]!.subtasks[0]!.id =
      'P1.M1.T1.X';
    writeTasksFile(dir, badIdBacklog);

    // EXECUTE & VERIFY: structural malformation still throws.
    await expect(readTasksJSON(dir)).rejects.toThrow();
  });

  it('still throws on an EMPTY context_scope (BacklogReadSchema keeps the .min(1) guard)', async () => {
    // SETUP: an empty scope — format-lenient does not mean "accept empty".
    const emptyScopeBacklog = makePlainScopeBacklog();
    emptyScopeBacklog.backlog[0]!.milestones[0]!.tasks[0]!.subtasks[0]!.context_scope =
      '';
    writeTasksFile(dir, emptyScopeBacklog);

    // EXECUTE & VERIFY
    await expect(readTasksJSON(dir)).rejects.toThrow();
  });

  it('strict write still rejects a plain-scope backlog (writeTasksJSON unchanged)', async () => {
    // SETUP: the same plain-scope backlog that readTasksJSON now ACCEPTS.
    const plainScopeBacklog = makePlainScopeBacklog();

    // EXECUTE & VERIFY: the WRITE path (BacklogSchema.parse at writeTasksJSON:781) is
    // STILL strict — the core write-strict / read-lenient invariant.
    await expect(writeTasksJSON(dir, plainScopeBacklog)).rejects.toThrow();
  });
});
