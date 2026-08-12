# Research — P1.M1.T2.S1: Pathspec-default staging + ARG_MAX chunked filtered sets

## 1. The bug + the fix

**BUG**: `smartCommit` in `src/utils/git-commit.ts` stages files by enumerating modified+untracked file
paths and passing them as an explicit list to `gitAdd({ path, files: filteredFiles })` → `git.add(['--',
...everyFile])`. A repo with an unignored `node_modules/` (tens of thousands of files) overflows the
kernel's ARG_MAX → `spawn E2BIG` → silently strands task status. The survival/recovery commits never land.

**Fix**: switch the staging to pathspec by default (`git add -A` via `gitAdd({ path })` or `gitAdd({ path,
files: ['.'] })`), and for the protected-files case, stage ALL with pathspec first, then UNSTAGE the
protected files via `gitUnstagePath`. Never build a massive explicit path list. If an explicit set is
unavoidable, chunk it under an ARG_MAX byte budget.

## 2. Verified source state (all line numbers confirmed in-repo)

### `smartCommit` staging section (src/utils/git-commit.ts ~L600-660)
```ts
// Current flow:
const statusResult = await gitStatus({ path: repoRoot });
const filesToStage = [...statusResult.modified, ...statusResult.untracked];
const filteredFiles = filterProtectedFiles(filesToStage);
if (filteredFiles.length === 0) return null;
const addResult = await gitAdd({ path: repoRoot, files: filteredFiles }); // ← ARG_MAX overflow risk
await restore_critical_files(repoRoot);
```
The fix replaces the `gitAdd({ path, files: filteredFiles })` call with pathspec staging + protected-
file unstaging.

### `gitAdd` in git-mcp.ts (L432-455) — already supports pathspec
```ts
async function gitAdd(input: GitAddInput): Promise<GitAddResult> {
  const safePath = await validateRepositoryPath(input.path);
  const git = simpleGit(safePath);
  const files = input.files ?? ['.'];
  if (files.length === 1 && files[0] === '.') {
    await git.add('.');                    // ← pathspec: respects .gitignore, no ARG_MAX risk
  } else {
    await git.add(['--', ...files]);       // ← explicit list: ARG_MAX risk
  }
  return { success: true, stagedCount: files.length };
}
```
**Key**: `gitAdd({ path: repoRoot })` (no `files`) → `files = ['.']` → `git.add('.')` — the pathspec path.
This is ALREADY supported; `smartCommit` just doesn't use it.

### `gitUnstagePath` in git-mcp.ts (L613-628) — already exists
```ts
async function gitUnstagePath(filePath: string, repoPath?: string): Promise<GitRestoreFromHeadResult> {
  // `git reset HEAD -- <path>`: exit 0 even if path absent from HEAD.
  await git.reset(['HEAD', '--', filePath]);
  return { success: true };
}
```
**Key**: this is the unstage path for protected files. It's already exported + imported in `git-commit.ts`
(L30). Each protected file is one path → no ARG_MAX risk (a handful of basenames, not tens of thousands).

### `filterProtectedFiles` + `PROTECTED_FILES` (L68-97)
```ts
const PROTECTED_FILES = [
  'PRD.md', 'prd_snapshot.md', 'delta_prd.md', 'delta_from.txt', 'prd_changed.marker', 'TEST_RESULTS.md',
] as const;
export function filterProtectedFiles(files: string[]): string[] { ... basename filter ... }
```
**Key**: the filter is by BASENAME, so `filterProtectedFiles` on a status list tells us WHICH files were
filtered out. We need those names to unstage them AFTER pathspec staging. Currently the filtered-OUT
files are lost — `filteredFiles` is the AFTER set, not the excluded set. So I need to compute the
excluded set: `const excludedFiles = filesToStage.filter(f => !filteredFiles.includes(f))` (or compute
directly from `PROTECTED_FILES` basenames in the status).

### `restore_critical_files` (L472-512) — unchanged
Runs AFTER staging. Detects staged DELETIONS of `PRD.md`/`PRP.md` and undoes them. This is separate
from the protected-files unstaging — it's about deletions, not about staging state files. Both must run.

## 3. The fix design

**Replace the staging block in `smartCommit`** (~L620-660) with:

```ts
// PRD §5.1: ARG_MAX-safe staging. Stage by pathspec (git add -A / git add .) by default — this
// respects .gitignore and never overflows ARG_MAX. Where protected files were filtered out, stage
// ALL via pathspec first, then unstage the protected files via git reset HEAD -- <path>.
// Never build a massive explicit file list.
const filesToStage = [...(statusResult.modified ?? []), ...(statusResult.untracked ?? [])];
const filteredFiles = filterProtectedFiles(filesToStage);
const excludedFiles = filesToStage.filter(f => !filteredFiles.includes(f));

// Skip commit if no files to stage at all
if (filesToStage.length === 0) { return null; }

// Stage ALL changes via pathspec (respects .gitignore; no ARG_MAX risk)
const addResult = await gitAdd({ path: repoRoot }); // files defaults to ['.'] → git.add('.')
if (!addResult.success) { return null; }

// Unstage protected files that were filtered out (a handful of basenames; no ARG_MAX risk)
for (const excluded of excludedFiles) {
  const unstageResult = await gitUnstagePath(excluded, repoRoot);
  if (!unstageResult.success) {
    logger().warn(`Failed to unstage protected file ${excluded}: ${unstageResult.error}`);
    // Non-fatal: the protected file stays staged. restore_critical_files may catch
    // PRD.md deletions. The commit proceeds (substance is never stranded).
  }
}
```

**Key changes from the current code:**
1. **Always** call `gitAdd({ path: repoRoot })` (pathspec) — no explicit `files` list. This is the
   ARG_MAX-safe default.
2. Compute `excludedFiles` (the files that `filterProtectedFiles` removed). Unstage them via
   `gitUnstagePath` AFTER pathspec staging.
3. The "skip if no files" check changes from `filteredFiles.length === 0` to `filesToStage.length === 0`
   (if there ARE files but they're all protected, pathspec staging stages them, then unstaging removes
   them → the net staged set is empty → the commit will either succeed with just the task-prefix or be
   a no-op; the current behavior returns null when filteredFiles is empty, which is correct).

   Wait — actually, re-examine: if ALL files are protected (e.g. only `PRD.md` modified), the current
   code returns null (filteredFiles empty). Under the new pathspec approach, `gitAdd('.')` would stage
   everything including PRD.md, then `gitUnstagePath('PRD.md')` would unstage it. Net: nothing staged.
   `gitCommit` would either error ("nothing to commit") or succeed as an empty commit. To preserve the
   current "return null when no files" behavior, I should still check `filteredFiles.length === 0` and
   return null BEFORE staging. This is a compatibility-preserving decision.

   Actually — the simplest approach: keep the `filteredFiles.length === 0 → return null` guard (as
   before), then for the non-empty case, stage ALL via pathspec + unstage the excluded files. This
   preserves the early-return semantics while avoiding ARG_MAX on the staging.

**Revised:**
```ts
const filteredFiles = filterProtectedFiles(filesToStage);
if (filteredFiles.length === 0) { return null; }  // ← KEEP (preserves current behavior)

// PRD §5.1: ARG_MAX-safe staging (pathspec default; chunked filtered sets)
const addResult = await gitAdd({ path: repoRoot }); // pathspec: git.add('.') → respects .gitignore
if (!addResult.success) { return null; }

// Unstage protected files that were in the status but filtered out
const excludedFiles = filesToStage.filter(f => !filteredFiles.includes(f));
for (const excluded of excludedFiles) {
  await gitUnstagePath(excluded, repoRoot);
}
```

## 4. Test impact (verified)

### `tests/unit/utils/git-commit.test.ts` — the staging assertion must change
Current (L495):
```ts
expect(mockGitAdd).toHaveBeenCalledWith({ path: '/project', files: ['src/index.ts', 'src/utils.ts'] });
```
New:
```ts
expect(mockGitAdd).toHaveBeenCalledWith({ path: '/project' });  // pathspec — no explicit files list
```
And the "filter out protected files" test (L527):
```ts
// OLD: assert files: ['src/index.ts', 'tasks.json']  (filteredFiles passed to gitAdd)
// NEW: assert gitAdd called with pathspec (no files); assert gitUnstagePath called for 'PRD.md'
expect(mockGitAdd).toHaveBeenCalledWith({ path: '/project' });
expect(mockGitUnstagePath).toHaveBeenCalledWith('PRD.md', '/project');
```
Also mock `gitUnstagePath` in the test file (it's already imported at L30 but needs to be added to the
vi.mock factory).

The "no files to commit" test (L538) is unchanged (filteredFiles empty → return null before staging).

## 5. ARG_MAX chunking (for the rare explicit-filtered-set case)

The contract says "if an explicit filtered set is unavoidable, chunk the path list into batches under an
ARG_MAX byte budget." When is an explicit set unavoidable? Under the new pathspec-default approach,
**never** — the pathspec stages everything, and unstaging handles the protected files. The chunking
path is only for a future hypothetical caller that needs to stage a SUBSET (not "everything minus
protected"). Since `smartCommit` is the only caller today, and it now uses pathspec + unstage, chunking
is NOT needed for this PRP. Document it in JSDoc as the fallback strategy for explicit subsets, but
don't implement it (no caller needs it).

## 6. Decisions locked

- **Pathspec default**: `gitAdd({ path: repoRoot })` (no `files`) → `git.add('.')`. Always.
- **Protected-file unstaging**: compute `excludedFiles` from the status; unstage each via
  `gitUnstagePath(filePath, repoRoot)`. A handful of basenames → no ARG_MAX risk.
- **Keep the `filteredFiles.length === 0 → return null` early-return** (preserves current "skip when
  nothing to commit" behavior).
- **`restore_critical_files` runs AFTER staging + unstaging** (unchanged — it detects DELETIONS, not
  staging state).
- **No chunking implementation** — pathspec + unstage handles the current use case; document chunking
  in JSDoc as the fallback for hypothetical future callers with explicit subset needs.
- **No interface change** — `smartCommit`'s signature and return type are unchanged.
- **JSDoc** on the staging section citing §5.1 ARG_MAX-safe staging.
- **Update 2 existing tests** to assert pathspec staging + unstage calls.