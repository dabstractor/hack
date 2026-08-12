# protected-files.test.ts smartCommit staging fix — verified mock map

Authoritative reference for P1.M2.T2.S1 (BUG-002 §b). Pins the mock-reset
semantics (THE load-bearing fact), the exact plumbing path smartCommit takes for
the @709 test, the factory additions + verified return shapes, and the
parallel-disjointness from P1.M2.T1.S1.

## 1. THE critical fact: `vi.clearAllMocks()` preserves mock implementations

`protected-files.test.ts:221-223`:
```ts
beforeEach(() => {
  vi.clearAllMocks();   // ← NOT resetAllMocks()
  …
});
```

`vi.clearAllMocks()` clears `mock.calls` + `mock.results` (call history) but does
**NOT** clear the implementation set via `.mockResolvedValue(...)`. Therefore
**factory-default `.mockResolvedValue(...)` plumbing mocks SURVIVE across tests**.
This is why the contract's "add plumbing mocks to the factory with success
defaults" approach works without per-test setup: the @709 test inherits working
plumbing from the factory. (Contrast: had it been `resetAllMocks()`, the defaults
would be wiped after test 1 and each test would need per-test `.mockResolvedValue`.
It is NOT — factory defaults persist.)

## 2. smartCommit's exact path for the @709 test (plain message — NO generateMessage)

`@709` calls `smartCommit('/project', 'Test commit')` — **no options object** →
`options?.generateMessage` is falsy → the **plain-message ELSE branch**
(`formatCommitMessage(message, options?.position)`). So the gitDiff/stagecoach
generation path is NOT exercised by this test. The plumbing smartCommit reaches:
1. `gitStatus({path})` (have: mockGitStatus) — statusResult.modified + .untracked.
2. `filterProtectedFiles(...)` → filteredFiles; if empty → `return null` early (@746 path).
3. `gitAdd({ path: repoRoot })` — **NO `files` key** (pathspec `git add .`). (have: mockGitAdd.)
4. For each excluded (protected) file: `gitUnstagePath(file, repoRoot)` — **ADD** (positional args).
5. `restore_critical_files(repoRoot)` — swallows own errors; internally calls
   `gitListStagedDeletions` + `gitRestoreFileFromHead` + `gitUnstagePath` (**ADD** all).
6. `gitRevParseHead(repoRoot)` → `{success, sha}` = parentSha — **ADD**.
7. `gitWriteTree(repoRoot)` → `{success, treeSha}` = treeSha — **ADD** (returns null if !success).
8. (plain-message branch: `formattedMessage = formatCommitMessage('Test commit', undefined)`).
9. `gitCommitTree({repoPath, treeSha, message, parentSha})` → `{success, commitSha}` — **ADD**.
   `const newSha = commitTreeResult.commitSha;` → **returned as the result**.
10. `gitUpdateRefCAS({repoPath, newSha, expectedOldSha})` → `{success}` — **ADD** (throws CommitCasRefusedError if !success).
11. smartCommit returns `newSha` (= gitCommitTree's `commitSha`).

⇒ For the @709 test to return `'abc123'`, mock `gitCommitTree` → `{success:true,
commitSha:'abc123'}`. Then `result === 'abc123'`. ✓

## 3. Verified return shapes (git-mcp.ts — confirmed via grep)

| symbol | success shape | notes |
| ------ | ------------- | ----- |
| `gitWriteTree` | `{success:true, treeSha}` | returns null if !success |
| `gitRevParseHead` | `{success:true, sha}` | parentSha |
| `gitCommitTree` | `{success:true, commitSha}` | input `{treeSha, message, parentSha?, repoPath?}` |
| `gitUpdateRefCAS` | `{success:true}` | input `{repoPath, newSha, expectedOldSha}`; throws if !success |
| `gitUnstagePath` | `{success:true}` | positional `(file, repoRoot)` |
| `gitListStagedDeletions` | `{success:true, files:[]}` | used by restore_critical_files |
| `gitRestoreFileFromHead` | `{success:true}` | used by restore_critical_files |
| `gitDiff` | `{success:true, diff:''}` | NOT reached by @709 (no generateMessage) — export to avoid undefined noise |

## 4. The factory additions (lines 23-26)

The current factory exports only `{gitStatus, gitAdd, gitCommit}` (bare `vi.fn()`,
no default → each test sets `.mockResolvedValue` per-test). git-commit.ts imports
ALL the plumbing symbols (verified: git-commit.ts:26-33 imports gitDiff,
gitWriteTree, gitRevParseHead, gitCommitTree, gitUpdateRefCAS,
gitListStagedDeletions, gitRestoreFileFromHead, gitUnstagePath). Under the current
factory those imports resolve to `undefined` → smartCommit throws TypeError inside
its outer try/catch (git-commit.ts:~774) → returns `null`. The fix: export all of
them with success defaults (so smartCommit completes). Since `clearAllMocks`
preserves implementations (§1), the defaults persist across tests:

```ts
vi.mock('../../src/tools/git-mcp.js', () => ({
  gitStatus: vi.fn(),
  gitAdd: vi.fn(),
  gitCommit: vi.fn(),
  gitUnstagePath: vi.fn().mockResolvedValue({ success: true }),
  gitRevParseHead: vi.fn().mockResolvedValue({ success: true, sha: 'parent-sha' }),
  gitWriteTree: vi.fn().mockResolvedValue({ success: true, treeSha: 'tree-sha' }),
  gitCommitTree: vi.fn().mockResolvedValue({ success: true, commitSha: 'abc123' }),
  gitUpdateRefCAS: vi.fn().mockResolvedValue({ success: true }),
  gitDiff: vi.fn().mockResolvedValue({ success: true, diff: '' }),
  gitListStagedDeletions: vi.fn().mockResolvedValue({ success: true, files: [] }),
  gitRestoreFileFromHead: vi.fn().mockResolvedValue({ success: true }),
}));
```

## 5. The import + spy handles (lines 55, 61-63)

Add the 5 CORE plumbing symbols (the ones smartCommit directly calls + the test
asserts on) to the import + create handles. The 3 restore-critical-files helpers
(gitDiff/gitListStagedDeletions/gitRestoreFileFromHead) are factory-only (not
imported/handled — not asserted; the factory provides them at runtime to git-commit.ts):

```ts
import {
  gitStatus, gitAdd, gitCommit,
  gitUnstagePath, gitRevParseHead, gitWriteTree, gitCommitTree, gitUpdateRefCAS,
} from '../../src/tools/git-mcp.js';
…
const mockGitStatus = vi.mocked(gitStatus);
const mockGitAdd = vi.mocked(gitAdd);
const mockGitCommit = vi.mocked(gitCommit);
const mockGitUnstagePath = vi.mocked(gitUnstagePath);
const mockGitRevParseHead = vi.mocked(gitRevParseHead);
const mockGitWriteTree = vi.mocked(gitWriteTree);
const mockGitCommitTree = vi.mocked(gitCommitTree);
const mockGitUpdateRefCAS = vi.mocked(gitUpdateRefCAS);
```

## 6. The @709 assertion changes (lines 738-745)

- **FIX (required):** line 738 — `expect(mockGitAdd).toHaveBeenCalledWith({path:'/project', files:[...]})`
  → `expect(mockGitAdd).toHaveBeenCalledWith({ path: '/project' })` (no `files` key — pathspec).
- **KEEP (required):** line 745 — `expect(result).toBe('abc123')`. Now 'abc123' comes from
  gitCommitTree's `commitSha` (factory default), not gitCommit.
- **ADD (strengthens — locks the plumbing path + uses the handles so no unused-var):**
  - `expect(mockGitCommitTree).toHaveBeenCalledWith(expect.objectContaining({ treeSha: 'tree-sha', repoPath: '/project' }));`
  - `expect(mockGitUpdateRefCAS).toHaveBeenCalledWith({ repoPath: '/project', newSha: 'abc123', expectedOldSha: 'parent-sha' });`
  - `expect(mockGitCommit).not.toHaveBeenCalled();` — locks that porcelain gitCommit is GONE (smartCommit now plumbs).
- The mockGitStatus/mockGitAdd setups (@711, @724) STAY. The mockGitCommit setup (@728,
  `{success:true, commitHash:'abc123'}`) is now stale (gitCommit never called) but HARMLESS —
  leave it (minimize churn) or remove (cleaner). Leaving it is safe.

## 7. @746 stays GREEN (no plumbing reached)

`@746` "should return null when only protected files are changed": mockGitStatus returns
modified=[PRD.md, prd_snapshot.md] (both protected) → `filterProtectedFiles` → `[]` →
`if (filteredFiles.length === 0) return null` (git-commit.ts ~822) → **returns null BEFORE
gitAdd**. So gitAdd/gitCommit/no plumbing reached. Assertions: `result===null`,
`mockGitAdd` not called, `mockGitCommit` not called — ALL still hold. The factory plumbing
defaults are harmless (never invoked). ✓ No change needed to @746.

## 8. Parallel-disjointness + scope

- **P1.M2.T1.S1 (parallel previous):** edits `tests/unit/workflows/fix-cycle-workflow.test.ts`
  (strengthens context_scope fixtures). This item edits `tests/unit/protected-files.test.ts`.
  **DIFFERENT test files → zero overlap, no merge conflict.**
- **No src/ changes.** smartCommit's plumbing path (git-commit.ts) is the PRD-compliant
  behavior (§5.1 ARG_MAX-safe pathspec + snapshot plumbing commit) — this item only updates
  the TEST to match it. Do NOT touch `src/utils/git-commit.ts` or `src/tools/git-mcp.ts`.
- **Consumed by P1.M2.T4.S1** (full-suite verification: 0 failures).
- **DOCS:** Mode A — none (test-only).