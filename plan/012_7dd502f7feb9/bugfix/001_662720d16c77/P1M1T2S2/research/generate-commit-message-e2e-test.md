# Research — End-to-end generateCommitMessage test under default `auto` config (LLM mocked only)

P1.M1.T2.S2 (bugfix 001, TEST_RESULTS.md Recommendation #3). One new integration test file that drives
the FULL `auto` commit-style path end-to-end with REAL `getRecentCommitMessages` + REAL simple-git +
REAL `buildCommitMessageSystemPrompt`, mocking ONLY the LLM boundary (`createCommitMessageAgent` →
`agent.prompt()`). This is the test that would have caught BUG-001 (the `maxEntries` regression) before
it shipped — the unit tests masked it by mocking `getRecentCommitMessages` to a `vi.fn()`.

## 1. The path under test (`generateCommitMessage`, src/utils/git-commit.ts:344–385)

```ts
export async function generateCommitMessage(diff: string): Promise<string> {
  if (!diff || !diff.trim()) throw new AgentError('…empty staged diff');
  const style = getPrpCommitStyle();          // DEFAULT 'auto' (env unset)
  let resolvedStyle: PrpCommitStyle = style;
  let examples: string[] | undefined;
  if (style === 'auto') {
    const n = getPrpCommitStyleExamples();    // DEFAULT 5 (env unset)
    if (n > 0) {
      examples = await getRecentCommitMessages(n);   // ← NO repoPath arg → uses process.cwd()
    }
    if (!examples || examples.length <= 1) resolvedStyle = 'plain';  // ≤1 commit → degrade
  }
  const system = buildCommitMessageSystemPrompt(resolvedStyle, examples);
  const agent = createCommitMessageAgent(system);
  const prompt = createPrompt({ user: buildCommitMessageUserPrompt(diff), responseFormat: z.string() });
  const r = await agent.prompt(prompt);
  if (r.status === 'error') throw new AgentError('…');
  const message = (r.data ?? '').trim();
  if (!message || message === 'skip') throw new AgentError('…empty agent output');
  return message;
}
```

**Reads**: `r.status` and `r.data`. So the fake agent's `.prompt()` must resolve to
`{ status: 'success', data: '<msg>', error: null }`.

**Degradation rule**: `examples.length <= 1` → degrade to `'plain'`. To keep the test on the `auto`
path (the bug-broken path), seed **≥2** commits so `getRecentCommitMessages(5)` returns ≥2 and the
style stays `'auto'`. (Seed 3 to be safe.)

## 2. The repo-resolution challenge — and why a `process.cwd()` spy solves it

`generateCommitMessage` calls `getRecentCommitMessages(n)` with **NO repoPath**. `getRecentCommitMessages`
(`src/tools/git-mcp.ts:583`) does `validateRepositoryPath(repoPath)` where `repoPath` is `undefined`.

`validateRepositoryPath(undefined)` (`src/tools/git-mcp.ts:202`):
```ts
async function validateRepositoryPath(path?: string): Promise<string> {
  const repoPath = resolve(path ?? process.cwd());   // ← undefined → process.cwd()
  if (!existsSync(repoPath)) throw …;
  if (!existsSync(join(repoPath, '.git'))) throw …;  // ← needs a real .git
  return realpathSync(repoPath);
}
```

So if `process.cwd()` returns the temp repo, `validateRepositoryPath(undefined)` resolves to it (it has
a `.git` after `git.init()`). **`vi.spyOn(process, 'cwd').mockReturnValue(dir)`** is the established
pattern (`tests/unit/utils/git-commit.test.ts:132` does exactly `vi.spyOn(process, 'cwd').mockReturnValue('/project')`).
The spy MUST be active during the `generateCommitMessage` call and restored in `afterEach`.

## 3. Mock ONLY the LLM boundary (`createCommitMessageAgent`)

`createCommitMessageAgent` (L360) and `buildCommitMessageSystemPrompt` (L303) are BOTH in
`src/agents/commit-message-agent.ts`. To mock ONLY the LLM factory and keep the pure prompt-builder
REAL, use an **async `importActual`-spread** factory (proven in this codebase —
`tests/integration/prp-executor-integration.test.ts` does the same for agent-factory):

```ts
vi.mock('../../src/agents/commit-message-agent.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/agents/commit-message-agent.js')>(
    '../../src/agents/commit-message-agent.js'
  );
  return {
    ...actual,   // keeps the REAL buildCommitMessageSystemPrompt (pure builder, no I/O)
    createCommitMessageAgent: vi.fn(() => ({
      prompt: vi.fn().mockResolvedValue({
        status: 'success' as const,
        data: 'feat: generated commit message',
        error: null,
      }),
    })),
  };
});
```

**Why `importActual`-spread (not a full mock):** if `buildCommitMessageSystemPrompt` is left undefined,
`generateCommitMessage` throws `buildCommitMessageSystemPrompt is not a function`. Spreading `actual`
keeps it real — exercising more of the real path AND honoring the item's "mock ONLY the LLM boundary".

**Side-effect note (non-blocking):** `commit-message-agent.ts` imports `createBaseConfig` from
`agent-factory.js`, which runs `configureEnvironment()`/`configureHarness()` at load. Under the DEFAULT
config (harness `'pi'`, provider `'zai'`) these are safe and already tolerated by the existing
integration suite (prp-executor-integration.test.ts imports the real agent-factory too). If a future
agent-factory load throws in this env, fall back to mocking BOTH `createCommitMessageAgent` AND
`buildCommitMessageSystemPrompt` (the latter as `vi.fn(() => 'mock system')`) — this still keeps
`getRecentCommitMessages`/git REAL (the bug-relevant layer) while avoiding the agent-factory import.

`createPrompt` (from `'groundswell'`) is kept REAL — it is a pure Prompt factory (not an LLM call); the
fake agent ignores its arg. (If the real `createPrompt` ever needs Groundswell init, mock it as a
passthrough `vi.fn((opts) => opts)` like the unit test does — but try real first.)

## 4. Config defaults (verified — src/config/constants.ts)

- `getPrpCommitStyle()` (L851): `process.env[PRP_COMMIT_STYLE]` undefined → returns
  `DEFAULT_PRP_COMMIT_STYLE === 'auto'` (L814). Unknown/empty → also `'auto'`.
- `getPrpCommitStyleExamples()` (L919): `process.env[PRP_COMMIT_STYLE_EXAMPLES] ?? '5'` → `5`.
  (`< 0` or NaN → `5`; `0` is valid and disables examples.)
- **To force the DEFAULT `auto`/5 path**: `delete process.env.PRP_COMMIT_STYLE` and
  `delete process.env.PRP_COMMIT_STYLE_EXAMPLES` in `beforeEach`. Restore/clean in `afterEach`.

## 5. The regression-catching property (the whole point)

`generateCommitMessage` does an UNCAUGHT `await getRecentCommitMessages(n)` (the await is bare — no
try/catch inside generateCommitMessage). If the source reverts to `git.log({ maxEntries })`, real git
throws `fatal: ambiguous argument 'maxEntries=N'…` → the `await` rejects → `generateCommitMessage`
**throws** → the test's `await generateCommitMessage(...)` rejects → the `it` FAILS. **No separate
`doesNotThrow` assertion needed** — the bare await IS the failure signal. Then asserting the returned
message is the LLM output (not the fallback placeholder) confirms success on the fixed source.

NOTE: `generateCommitMessage` itself never RETURNS the fallback placeholder — the fallback
(`chore: commit-gen failed (exit 0); fallback commit`) is built by `buildFallbackCommitMessage` inside
`smartCommit`'s catch. So calling `generateCommitMessage` directly either returns the agent's message
(success) or throws (failure). The `not.toBe(placeholder)` assertion documents the anti-regression
intent; the load-bearing assertion is "does not throw + returns the descriptive message".

## 6. File-disjoint from S1 (parallel-execution safe)

- **S1 (P1.M1.T2.S1)** creates `tests/integration/git-mcp-log.test.ts` — a NARROW helper-level test of
  `getRecentCommitMessages(count, dir)` (passes `dir` explicitly; 3 cases). No cwd spy.
- **S2 (this task)** creates `tests/integration/git-commit-generate.test.ts` — the BROADER end-to-end
  test of `generateCommitMessage(diff)` (no repoPath → cwd spy to the temp repo; mocks the LLM only).
  Different file, different concern (helper vs full path), different mock surface. **Zero overlap.**
- vitest isolates test files (pool: 'forks'); the cwd spy is restored in afterEach → no leak to S1.
- Both consume S1's (Complete) fixed `getRecentCommitMessages` (uses `maxCount`).

## 7. Test design (the new file)

```ts
// tests/integration/git-commit-generate.test.ts (NEW)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { simpleGit } from 'simple-git';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Mock ONLY the LLM boundary. buildCommitMessageSystemPrompt stays REAL (importActual spread).
vi.mock('../../src/agents/commit-message-agent.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/agents/commit-message-agent.js')>(
    '../../src/agents/commit-message-agent.js'
  );
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
const mockCreateCommitMessageAgent = createCommitMessageAgent as unknown as ReturnType<typeof vi.fn>;

describe('generateCommitMessage — default auto config, real git (LLM mocked only)', () => {
  let dir: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    // DEFAULT config (env unset → auto / 5) — the exact path BUG-001 broke.
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
    const result = await generateCommitMessage('diff --git a/x b/x\n+added line');

    // VERIFY (a)+(b): the LLM-generated descriptive message, NOT the fallback placeholder.
    expect(result).toBe('feat: generated commit message');
    expect(result).not.toBe('chore: commit-gen failed (exit 0); fallback commit');

    // VERIFY (c): the real auto path ran (style stayed 'auto' because ≥2 examples were fetched) and
    // wired the agent exactly once.
    expect(mockCreateCommitMessageAgent).toHaveBeenCalledTimes(1);
  });
});
```

## 8. Non-break / scope
- ONLY creates `tests/integration/git-commit-generate.test.ts` (one `it()`; can add a second for the
  ≤1-commit degrade-to-plain contrast if desired, but one focused case is the contract). No
  source/config/docs changes (the item's "DOCS: none").
- Does NOT mock `getRecentCommitMessages`, `git-mcp.js`, `simple-git`, or `validateRepositoryPath` —
  the bug-relevant layer is REAL. Does NOT mock `buildCommitMessageSystemPrompt` (importActual keeps it
  real). Does NOT mock `createPrompt` (real).
- Does NOT touch S1's `git-mcp-log.test.ts` or any unit test file.