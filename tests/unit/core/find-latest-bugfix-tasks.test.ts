/**
 * Unit tests for findLatestBugfixTasksFile (PRD §5.3 "Task File Discovery Priority").
 *
 * @remarks
 * Real-filesystem tests (mkdtemp + real bugfix/ dirs + real tasks.json) so the
 * directory-scanning and tasks.json-existence logic is exercised exactly as in
 * production. Mirrors the reference `run-prd.sh` `prd task` selector: prefer the
 * most recent numbered bugfix child's tasks.json regardless of completion
 * status, falling back to `null` (→ main session tasks) when there is none.
 *
 * @see {@link ../../../src/core/session-utils.ts | findLatestBugfixTasksFile}
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findLatestBugfixTasksFile } from '../../../src/core/session-utils.js';

describe('findLatestBugfixTasksFile (PRD §5.3)', () => {
  let session: string;

  beforeEach(async () => {
    session = await mkdtemp(join(tmpdir(), 'hack-bugfix-'));
  });

  afterEach(async () => {
    await rm(session, { recursive: true, force: true });
  });

  it('returns null when bugfix/ does not exist (never hunted)', async () => {
    expect(await findLatestBugfixTasksFile(session)).toBeNull();
  });

  it('returns null when bugfix/ has no numbered NNN_ children', async () => {
    await mkdir(join(session, 'bugfix', 'architecture'), { recursive: true });
    await mkdir(join(session, 'bugfix', 'foo_bar'), { recursive: true });
    expect(await findLatestBugfixTasksFile(session)).toBeNull();
  });

  it('returns the latest bugfix child tasks.json (regardless of status)', async () => {
    // SETUP — two numbered children, both with tasks.json
    const b1 = join(session, 'bugfix', '001_aaaaaaaaaaaa');
    const b2 = join(session, 'bugfix', '002_bbbbbbbbbbbb');
    await mkdir(b1, { recursive: true });
    await mkdir(b2, { recursive: true });
    await writeFile(join(b1, 'tasks.json'), '{"backlog":[]}');
    await writeFile(join(b2, 'tasks.json'), '{"backlog":[]}');

    // VERIFY — most recent (002) wins even though 001 also has tasks.json
    expect(await findLatestBugfixTasksFile(session)).toBe(
      join(b2, 'tasks.json')
    );
  });

  it('mirrors run-prd.sh: falls back to null when the latest child has no tasks.json', async () => {
    // SETUP — older child has tasks.json, latest (002) does not (interrupted
    // breakdown). run-prd.sh checks only the latest child and falls back to the
    // main session's tasks in this case.
    const b1 = join(session, 'bugfix', '001_aaaaaaaaaaaa');
    const b2 = join(session, 'bugfix', '002_bbbbbbbbbbbb');
    await mkdir(b1, { recursive: true });
    await mkdir(b2, { recursive: true });
    await writeFile(join(b1, 'tasks.json'), '{"backlog":[]}');

    // VERIFY — latest child lacks tasks.json → null (caller uses main tasks)
    expect(await findLatestBugfixTasksFile(session)).toBeNull();
  });

  it('ignores non-directory entries and stray files', async () => {
    // SETUP — one valid child plus noise that must not be treated as a child
    const b1 = join(session, 'bugfix', '001_aaaaaaaaaaaa');
    await mkdir(b1, { recursive: true });
    await writeFile(join(b1, 'tasks.json'), '{"backlog":[]}');
    await writeFile(join(session, 'bugfix', 'stray.txt'), 'noise');

    // VERIFY
    expect(await findLatestBugfixTasksFile(session)).toBe(
      join(b1, 'tasks.json')
    );
  });
});
