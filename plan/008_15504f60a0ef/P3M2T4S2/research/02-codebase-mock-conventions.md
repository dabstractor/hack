# Research 02 — Codebase Layering + Mock/Test Conventions

Source: scout brief at `.pi-subagents/artifacts/outputs/696ec936/context.md`.

## Layering (decides WHERE the code lives)

- `src/tools/git-mcp.ts` is the **ONLY** module that imports `simpleGit` and
  talks to git. `src/utils/git-commit.ts` consumes git-mcp's wrapped functions
  (`gitStatus, gitAdd, gitCommit, gitDiff` — git-commit.ts:23). It NEVER
  imports `simpleGit` directly.
- **Conclusion:** new git ops (`checkout`, `reset`, `diff --name-only`) belong
  in `src/tools/git-mcp.ts` as wrapped functions returning
  `{ success: boolean; error?: string; ... }`. `git-commit.ts` imports them.

## Result-object convention

Every wrapped op returns `{ success: boolean; error?: string; ...payload }`.
`gitRestoreFile` is the single throw-on-error exception (returns `void`).

```ts
interface GitDiffResult  { success: boolean; diff?: string; error?: string; }
interface GitAddResult   { success: boolean; stagedCount?: number; error?: string; }
```

## Existing functions to reuse / extend in git-mcp.ts

- `gitStatus`, `gitAdd`, `gitCommit`, `gitDiff`, `gitFileHistory`,
  `gitReadFileAtCommit`, `gitRestoreFile` — all exported from the bottom
  export block (git-mcp.ts:664-671).
- `gitRestoreFile(filePath, commit='HEAD', repoPath?)` →
  `git.show('HEAD:path')` + `atomicWrite` (index-blind; see research/01 Q2a).
- `validateRepositoryPath(path?)` → `resolve → existsSync(.git) → realpathSync`.
  Every wrapped function calls `const safePath = await validateRepositoryPath(...)`
  then `const git = simpleGit(safePath)`.

## Test pattern — tests/unit/utils/git-commit.test.ts

```ts
vi.mock('../../../src/tools/git-mcp.js', () => ({
  gitStatus: vi.fn(),
  gitAdd: vi.fn(),
  gitCommit: vi.fn(),
  gitDiff: vi.fn(),
  // ADD new helper(s) here, e.g. gitRestorePaths, gitListStagedDeletions
}));

import { gitStatus, gitAdd, gitCommit, gitDiff } from '../../../src/tools/git-mcp.js';
const mockGitStatus  = vi.mocked(gitStatus);
// ... etc
```

⚠️ `vi.mock` is HOISTED above imports. The mock object MUST list every named
export the test imports from git-mcp.js, else the import yields `undefined`
and `vi.mocked(undefined)` throws at module-eval time.

Logger is fully mocked via `vi.hoisted`:
```ts
const { mockLogger } = vi.mocked(() => ({ mockLogger: { info, error, warn, debug: vi.fn() } }));
vi.mock('../../../src/utils/logger.js', () => ({ getLogger: vi.fn(() => mockLogger) }));
```
So tests can `expect(mockLogger.warn).toHaveBeenCalledWith(...)`.

Representative happy-path test (SETUP / EXECUTE / VERIFY comment convention):
```ts
mockGitStatus.mockResolvedValue({ success: true, modified: ['src/index.ts'], untracked: [] });
mockGitAdd.mockResolvedValue({ success: true, stagedCount: 1 });
mockGitCommit.mockResolvedValue({ success: true, commitHash: 'abc123' });
const result = await smartCommit('/project', 'Test commit');
expect(result).toBe('abc123');
expect(mockGitAdd).toHaveBeenCalledWith({ path: '/project', files: ['src/index.ts'] });
```
`expect(mockX).not.toHaveBeenCalled()` is the established "should skip" assertion.

## Test pattern — tests/unit/tools/git-mcp.test.ts (for a new git-mcp helper)

```ts
vi.mock('simple-git', () => ({
  simpleGit: vi.fn(() => mockGitInstance),
  GitError: class MockGitError extends Error { ... },
}));
const mockGitInstance = { status, diff, add, commit, log, show: vi.fn() /* ... */ };
// ADD: checkout: vi.fn(), reset: vi.fn(), raw: vi.fn() for the new helpers
```
`node:fs` `existsSync`/`realpathSync` are mocked so `validateRepositoryPath`
passes. `gitRestoreFile` tests use a REAL `mkdtemp` (because `atomicWrite` is
not mocked) — if a new helper writes files, mirror that; if it only runs git
commands (checkout/reset/diff), no real fs needed.

## npm scripts (package.json)

- `lint`        → `eslint . --ext .ts`  (`lint:fix` to auto-fix)
- `typecheck`   → `tsc --noEmit -p tsconfig.build.json`
- `format`      → `prettier --write ...`; `format:check` → `--check`
- `test:run`    → `vitest run`
- `validate`    → `npm run lint && npm run format:check && npm run typecheck && npm run test:run`

## Path-glob / dependencies

- `fast-glob@^3.3.3` IS a dependency (filesystem-mcp uses `import fg from
  'fast-glob'`).
- `minimatch` / `picomatch` NOT direct deps.
- **For this feature we do NOT need fast-glob** — `git diff --diff-filter=D
  --name-only` returns the literal deleted paths; a simple `basename(p)
  === 'PRP.md' || p === 'PRD.md'` test avoids node_modules false positives.

## PROTECTED_FILES + filterProtectedFiles (git-commit.ts:52-80)

```ts
const PROTECTED_FILES = [
  'PRD.md', 'prd_snapshot.md', 'delta_prd.md', 'delta_from.txt', 'TEST_RESULTS.md',
] as const;

export function filterProtectedFiles(files: string[]): string[] {
  return files.filter(file => {
    const fileName = basename(file) as (typeof PROTECTED_FILES)[number];
    return !PROTECTED_FILES.includes(fileName);
  });
}
```
**Match style: BASENAME.** Note: `PROTECTED_FILES` is module-private (not
exported). `restore_critical_files` lives in the SAME file, so it can read the
array directly. NOTE the gap: PROTECTED_FILES lists `PRD.md` but NOT `PRP.md`
(architecture/phase_findings.md:77 confirms). `restore_critical_files` must
additionally protect `**/PRP.md` (basename === 'PRP.md') — the contract's
stated target set.

## logger() style (git-commit.ts)

- plain string: `logger().error('Invalid session path');`
- template literal: `` logger().info(`Commit created: ${commitHash}`); ``
- `logger().warn(...)` exists (the fallback-commit path).
- Module-scoped lazy factory: `const logger = (): Logger => (_logger ??= getLogger('smartCommit'));`
  → `restore_critical_files` reuses the SAME `logger()`, no new factory.

## Integration points (smartCommit call sites)

- `src/core/task-orchestrator.ts:1032` — pre-cleanup survival commit
- `src/core/task-orchestrator.ts:1084` — post-cleanup commit
Both pass `{ generateMessage: true }`. `restore_critical_files` is invoked
INSIDE `smartCommit` right after `gitAdd` (before the message-resolution +
`gitCommit`), so BOTH call sites are covered transparently.

## smartCommit insertion point (git-commit.ts ~L395-410)

```
gitStatus → filesToStage → filterProtectedFiles → [empty?] return null
→ gitAdd(filteredFiles) → [fail?] return null
>>> INSERT: restore_critical_files(repoRoot) here <<<
→ resolve message (default | stagecoach+retry+fallback)
→ gitCommit → return commitHash
```
The restore runs AFTER staging (PRD §5.1: "invoked from Smart Commit right
after staging") and BEFORE commit — so the staged set is corrected before the
diff is read for stagecoach generation and before commit. This is critical:
restore must run BEFORE the `gitDiff({staged:true})` stagecoach call (so the
generated message reflects the corrected, deletion-free staged set) and before
`gitCommit`.