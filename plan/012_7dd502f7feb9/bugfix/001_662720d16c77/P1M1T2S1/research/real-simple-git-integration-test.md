# Research — P1.M1.T2.S1: Integration test for `getRecentCommitMessages` (real simple-git, temp repo)

## 1. What this task does (regression prevention for BUG-001)

BUG-001: `getRecentCommitMessages()` passed simple-git an INVALID option (`{ maxEntries }` instead of
`{ maxCount }`), and the unit test masked it (asserted the broken contract against an arg-ignoring
`vi.fn`). S1 fixed the source (`maxCount`); S2 (parallel) fixes the unit assertion. **T2.S1 adds the
integration test that the bug report's Recommendation #2 asks for**: call the REAL simple-git (no mock)
against a throwaway temp git repo, so an invalid option name fails the build instead of being masked.
If the source ever reverts to `maxEntries`, this test throws (`fatal: ambiguous argument…`) and FAILS.

## 2. Verified source state (post-S1)

`src/tools/git-mcp.ts` `getRecentCommitMessages` (confirmed in-repo):
```ts
async function getRecentCommitMessages(count: number, repoPath?: string): Promise<string[]> {
  if (count === 0) return [];                                  // short-circuit BEFORE validate
  const safePath = await validateRepositoryPath(repoPath);
  const git = simpleGit(safePath);
  const logResult = await git.log({ maxCount: count });        // ← S1 fixed: maxCount (was maxEntries)
  return logResult.all.map(entry => entry.message);            // newest-first; full message
}
```
The integration test consumes this FIXED source unchanged. (S1 is Complete; T2.S1 begins after S1.)

## 3. CRITICAL verification — `validateRepositoryPath` accepts an external tmpdir (NO mock needed)

`src/tools/git-mcp.ts` `validateRepositoryPath`:
```ts
async function validateRepositoryPath(path?: string): Promise<string> {
  const repoPath = resolve(path ?? process.cwd());
  if (!existsSync(repoPath)) throw new Error(`Repository path not found: ${repoPath}`);
  const gitDir = join(repoPath, '.git');
  if (!existsSync(gitDir)) throw new Error(`Not a git repository: ${repoPath}`);
  return realpathSync(repoPath);
}
```
**It checks existence + `.git` presence + realpath — NOTHING projects-scoped.** An OS tmpdir
(`/tmp/git-log-test-XXX` → realpath `/private/tmp/...` on macOS) with a real `.git` (from `git init`)
PASSES. The contract's NOTE ("may require the path inside the project") is a **false alarm** — verified
against the implementation. **Do NOT mock `validateRepositoryPath`** — the whole point is end-to-end
real-git; the temp repo satisfies the validator directly. (Mocking it would re-introduce a mask.)

## 4. The temp-repo pattern (established in this codebase)

From `architecture/external_deps.md` §62-90 + `tests/unit/config/hack-config.test.ts`:
- `mkdtempSync(join(tmpdir(), 'prefix-'))` creates the dir; `rmSync(dir, { recursive: true, force: true })`
  in `afterEach` cleans up.
- Init: `simpleGit(dir).init()` (or `execFileSync('git', ['init', dir])`). simple-git preferred (the
  lib under test).
- Commits need a git identity: `addConfig('user.email','test@test.com')` + `addConfig('user.name','Test')`
  after init (hermetic — don't rely on global git config in CI).
- Seed N commits: write a unique file per commit (`writeFileSync(join(dir, `f${i}.txt`), …)`) →
  `add('.')` → `commit('message i')`. Each commit needs ≥1 changed file.

## 5. The simple-git `log({ maxCount })` contract (the thing under test)

- `git.log({ maxCount: count })` returns `{ all: LogEntry[], … }`; `.all` is **newest-first** (git log
  default). Each `LogEntry.message` is the commit's message (subject; for single-line commits, the
  trimmed subject — simple-git trims). BUG-001 proved `maxEntries` is INVALID → `fatal: ambiguous
  argument 'maxEntries=N'…` → throws. So an invalid option makes `await getRecentCommitMessages(N)`
  REJECT → the `it` fails automatically (no separate "doesNotThrow" assertion needed).
- A repo with **fewer than `count` commits** returns all available (no error) — but T2.S1 seeds exactly
  5 and tests count ≤ 5, so this branch isn't exercised here (the unit test owns it).

## 6. Test design (3 cases, shared seeded-repo setup)

**File**: `tests/integration/git-mcp-log.test.ts` (vitest glob `tests/**/*.{test,spec}.ts` picks it up).

**Shared setup** (`beforeEach` creates+inits+seeds; `afterEach` rmSync):
```ts
import { simpleGit } from 'simple-git';                       // REAL — do NOT mock
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getRecentCommitMessages } from '../../src/tools/git-mcp.js';  // REAL — do NOT mock

let dir: string;
const MSGS = ['commit 1', 'fix: commit 2', 'docs: commit 3', 'refactor: commit 4', 'feat: commit 5'];

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'git-log-test-'));
  const git = simpleGit(dir);
  await git.init();
  await git.addConfig('user.email', 'test@test.com');
  await git.addConfig('user.name', 'Test');
  for (let i = 0; i < MSGS.length; i++) {
    writeFileSync(join(dir, `file${i}.txt`), `content ${i}`);
    await git.add('.');
    await git.commit(MSGS[i]);
  }
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
```

**Cases** (newest-first: commit 5 is the newest):
1. `count < total` (3 of 5): `getRecentCommitMessages(3, dir)` → `['feat: commit 5', 'refactor: commit 4', 'docs: commit 3']`.
2. `count === total` (5 of 5): `getRecentCommitMessages(5, dir)` → `['feat: commit 5','refactor: commit 4','docs: commit 3','fix: commit 2','commit 1']`.
3. `count === 0` (short-circuit): `getRecentCommitMessages(0, dir)` → `[]` (no git call; the beforeEach repo is unused).

The exact-array `toEqual` proves BOTH correctness AND ordering (newest-first). If simple-git yields a
trailing newline in `.message` for some platform, trim before comparing (`result.map(m => m.trim())`) —
but simple-git trims `.message` for single-line commits, so exact equality is expected to hold.

## 7. Why this catches the regression (the test's whole value)

If the source reverts to `git.log({ maxEntries: count })`, the REAL simple-git passes the unrecognized
key as a literal git argument → `git log` aborts `fatal: ambiguous argument 'maxEntries=N'…` →
`getRecentCommitMessages(N)` rejects → the `await` in the `it` throws → **the test FAILS**. No mock to
mask it. This is exactly the defense BUG-001's Recommendation #2 asks for. (The count===0 case still
passes under a revert because it short-circuits before the git call — but cases 1 & 2 catch it.)

## 8. Parallel-execution / file-disjoint check

- **vs S2 (in-flight, the unit-assertion fix):** S2 edits `tests/unit/tools/git-mcp.test.ts` (2 tokens).
  T2.S1 CREATES `tests/integration/git-mcp-log.test.ts`. **Zero overlap** (different dirs, different
  files, different layers — unit mock vs real integration).
- **vs S1 (Complete, the source fix):** T2.S1 consumes S1's fixed source (`maxCount`) unchanged.
- **vs T2.S2 (next, planned):** T2.S2 is an end-to-end `generateCommitMessage`-under-`auto` test (LLM
  mocked only). T2.S1 is the narrower `getRecentCommitMessages`-against-real-git test. Distinct files,
  complementary: T2.S1 proves the helper's option name; T2.S2 proves the whole `auto` path doesn't throw.

## 9. Decisions locked

- **File**: `tests/integration/git-mcp-log.test.ts` (the contract's suggested name; glob picks it up).
- **NO mocks**: import the REAL `simpleGit` (for setup) + REAL `getRecentCommitMessages` (under test).
  Do NOT `vi.mock('simple-git')` or `vi.mock('…/git-mcp.js')` — that's the BUG-001 mask this test removes.
- **External tmpdir** (`mkdtempSync(tmpdir())`) — `validateRepositoryPath` accepts it (verified §3); no
  project-scoping, no `validateRepositoryPath` mock, no `tests/tmp/` workaround.
- **Hermetic git identity** via `addConfig` after `init` (don't rely on global config).
- **Shared `beforeEach`** creates+inits+seeds 5 commits; `afterEach` rmSync. 3 `it` cases (count 3/5/0).
- **Exact-array `toEqual`** as the primary assertion (proves correctness + newest-first ordering); trim
  fallback noted in case simple-git yields trailing newlines on some platform.
- **No source/docs change** — test-only (the item's "DOCS: none"). Depends on S1 (Complete).