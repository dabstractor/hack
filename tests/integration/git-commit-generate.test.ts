/**
 * End-to-end integration test for `generateCommitMessage` under the DEFAULT `auto` config.
 *
 * @remarks
 * Regression-prevention net for BUG-001 (TEST_RESULTS.md Recommendation #3): the default-config-
 * breaking bug where `getRecentCommitMessages` passed `simple-git` `{ maxEntries }` instead of
 * `{ maxCount }`. CI missed it because the unit tests mocked `getRecentCommitMessages` to a `vi.fn()`
 * that never ran real git. This test drives the FULL `auto` commit-style path — config resolution →
 * REAL `getRecentCommitMessages` → REAL `git.log` → REAL prompt builder → agent-factory wiring →
 * message return — mocking ONLY the LLM boundary (`createCommitMessageAgent`). If the source ever
 * reverts to an invalid `log()` option, the bare `await` inside `generateCommitMessage` rejects (git
 * fatal) and this test FAILS.
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { simpleGit } from 'simple-git';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Mock ONLY the LLM boundary. importActual-spread keeps the REAL buildCommitMessageSystemPrompt
// (a pure builder, no I/O) so the full auto path — including the real system-prompt construction —
// runs. If this is mocked away, generateCommitMessage throws "buildCommitMessageSystemPrompt is not
// a function". getRecentCommitMessages / simple-git / validateRepositoryPath are NEVER mocked.
vi.mock('../../src/agents/commit-message-agent.js', async () => {
  const actual = await vi.importActual<
    typeof import('../../src/agents/commit-message-agent.js')
  >('../../src/agents/commit-message-agent.js');
  return {
    ...actual,
    createCommitMessageAgent: vi.fn(() => ({
      prompt: vi.fn().mockResolvedValue({
        status: 'success' as const,
        data: 'feat: generated commit message',
        error: null,
      }),
    })),
  };
});

import { generateCommitMessage } from '../../src/utils/git-commit.js';
import { createCommitMessageAgent } from '../../src/agents/commit-message-agent.js';

const mockCreateCommitMessageAgent =
  createCommitMessageAgent as unknown as ReturnType<typeof vi.fn>;

describe('generateCommitMessage — default auto config, real git (LLM mocked only)', () => {
  let dir: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    // DEFAULT config (env unset → auto / 5): the exact path BUG-001 broke.
    delete process.env.PRP_COMMIT_STYLE;
    delete process.env.PRP_COMMIT_STYLE_EXAMPLES;

    // Seed a temp repo with >1 commit so the auto path does NOT degrade to plain (needs ≥2 examples).
    dir = mkdtempSync(join(tmpdir(), 'commit-style-e2e-'));
    const git = simpleGit(dir);
    await git.init();
    await git.addConfig('user.email', 'test@test.com');
    await git.addConfig('user.name', 'Test');
    for (let i = 0; i < 3; i++) {
      writeFileSync(join(dir, `file${i}.txt`), `content ${i}\n`);
      await git.add('.');
      await git.commit(`feat: example commit ${i + 1}`);
    }

    // generateCommitMessage → getRecentCommitMessages(n) with NO repoPath → validateRepositoryPath
    // resolves process.cwd(). Point cwd at the temp repo so the REAL git.log runs against it.
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(dir);
    mockCreateCommitMessageAgent.mockClear();
  });

  afterEach(() => {
    cwdSpy?.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  });

  it('does not throw and returns the LLM-generated message under default auto config (PRD §5.1)', async () => {
    // EXECUTE — the bare await rejects if getRecentCommitMessages throws (a maxEntries regression).
    const result = await generateCommitMessage(
      'diff --git a/x b/x\n+added line'
    );

    // VERIFY (a)+(b): the LLM-generated descriptive message, NOT the fallback placeholder.
    expect(result).toBe('feat: generated commit message');
    expect(result).not.toBe(
      'chore: commit-gen failed (exit 0); fallback commit'
    );

    // VERIFY (c): the real auto path ran (≥2 examples fetched → style stayed 'auto') and wired the
    // agent exactly once.
    expect(mockCreateCommitMessageAgent).toHaveBeenCalledTimes(1);
  });
});
