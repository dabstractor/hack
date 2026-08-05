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

  it('falls back to null when no numbered child has a tasks.json', async () => {
    // SETUP — two numbered children, neither with tasks.json (both
    // interrupted breakdowns). With no bugfix tasks.json anywhere, the caller
    // must fall back to the main session's tasks.
    const b1 = join(session, 'bugfix', '001_aaaaaaaaaaaa');
    const b2 = join(session, 'bugfix', '002_bbbbbbbbbbbb');
    await mkdir(b1, { recursive: true });
    await mkdir(b2, { recursive: true });

    // VERIFY — no child has tasks.json → null (caller uses main tasks)
    expect(await findLatestBugfixTasksFile(session)).toBeNull();
  });

  it('prefers the same-sequence sibling that has tasks.json (regression)', async () => {
    // SETUP — a stray truncated-hash dir shares sequence `002` with the real
    // child, but only the real child has tasks.json. The stray dir must not
    // mask the real one. (Mirrors the live `002_86589b7d2` /
    // `002_86589b7d57d2` condition from PRD §5.3.)
    const stray = join(session, 'bugfix', '002_86589b7d2'); // no tasks.json
    const real = join(session, 'bugfix', '002_86589b7d57d2'); // has tasks.json
    await mkdir(stray, { recursive: true });
    await mkdir(real, { recursive: true });
    await writeFile(join(real, 'tasks.json'), '{"backlog":[]}');

    // VERIFY — the same-sequence sibling with tasks.json wins
    expect(await findLatestBugfixTasksFile(session)).toBe(
      join(real, 'tasks.json')
    );
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
