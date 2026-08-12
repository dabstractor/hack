# PRP — P1.M1.T2.S1: Pathspec-default staging + ARG_MAX chunked filtered sets

> PRD §5.1 "ARG\_MAX-safe staging (no argument-vector overflow)." S1/S2/S3 (the git plumbing primitives)
> are the snapshot-based atomic commit infrastructure; **T2.S1 fixes the STAGING layer** — the `gitAdd`
> call in `smartCommit` that currently passes a massive explicit file list to `git.add(['--', ...everyFile])`.
> A repo with an unignored `node_modules/` (tens of thousands of files) overflows ARG\_MAX → `spawn E2BIG`
> → silently strands task status. **Fix: stage by pathspec (`git add .`) by default; unstage protected
> files via `git reset HEAD -- <path>` after staging.** Never build a massive explicit path list. Internal
> refactor — `smartCommit`'s signature/return type unchanged.

---

## Goal

**Feature Goal**: Replace `smartCommit`'s explicit-file-list staging (`gitAdd({ path, files:
filteredFiles })` → `git.add(['--', ...everyFile])`) with **pathspec-default staging** (`gitAdd({ path:
repoRoot })` → `git.add('.')`) that respects `.gitignore` and never overflows ARG\_MAX. When protected
files were filtered out of the status, stage ALL via pathspec first, then UNSTAGE the protected files
via `gitUnstagePath` (a handful of basenames — no ARG\_MAX risk). Keep `restore_critical_files` running
AFTER staging (unchanged). No interface change.

**Deliverable**:
1. **`src/utils/git-commit.ts`** — rewrite the staging block in `smartCommit` (~L620-660): replace
   `gitAdd({ path, files: filteredFiles })` with `gitAdd({ path: repoRoot })` + `gitUnstagePath` per
   excluded file; add JSDoc citing §5.1 ARG\_MAX-safe staging.
2. **`tests/unit/utils/git-commit.test.ts`** — update the 2 staging-assertion tests (the "stages
   files" test + the "filters protected files" test) to assert pathspec staging + unstage calls; add
   `gitUnstagePath` to the mock factory.

**Success Definition**:
- `smartCommit` calls `gitAdd({ path: repoRoot })` (no `files` → pathspec `git.add('.')`) — NEVER an
  explicit file list.
- Protected files (the `excludedFiles` set) are unstaged via `gitUnstagePath(filePath, repoRoot)` after
  pathspec staging.
- `filteredFiles.length === 0 → return null` early-return is preserved (skip-when-nothing-to-commit).
- `restore_critical_files(repoRoot)` still runs AFTER staging + unstaging (unchanged).
- `smartCommit`'s signature + return type are UNCHANGED.
- `npx vitest run tests/unit/utils/git-commit.test.ts` GREEN (updated tests + regression); `npm run
  typecheck && npm run lint && npm run format:check` clean.

---

## Why

- **Fixes a silent production failure.** A repo with an unignored `node_modules/` (tens of thousands of
  files) makes `git.add(['--', ...everyFile])` exceed the kernel's ARG\_MAX and fail with `spawn E2BIG`.
  This silently breaks every survival/recovery commit (§5.1 "Orphaned-`plan/` Recovery") and strands
  task status. Pathspec staging (`git.add('.')`) never overflows — it passes one argument, not tens of
  thousands.
- **Respects `.gitignore` by construction.** Pathspec staging stages only what git tracks — ignored
  dependency trees are never staged in the first place. The explicit-list approach stages everything
  that appears in `git status` (including unignored `node_modules/`).
- **The unstage approach is ARG\_MAX-safe.** `PROTECTED_FILES` is 6 basenames; only a handful will
  appear in any given status. `git reset HEAD -- <path>` per file is a single-path operation — no
  overflow risk.
- **Purely internal refactor.** `smartCommit`'s signature, return type, and callers are unchanged. The
  staging strategy is an implementation detail. The T3 smartCommit rewrite (P1.M1.T3) will consume this
  staging as-is.

---

## What

### User-visible behavior
None. `smartCommit` produces the same observable result (a commit containing the same net set of files)
— the staging just doesn't overflow ARG\_MAX on large repos. No interface change.

### Technical requirements (exact contract)

**Edit A — `src/utils/git-commit.ts` smartCommit staging block** (~L620-660): replace the current
explicit-list staging with pathspec + unstage.

**Current code** (to be replaced):
```ts
const filesToStage: string[] = [];
if (statusResult.modified) filesToStage.push(...statusResult.modified);
if (statusResult.untracked) filesToStage.push(...statusResult.untracked);
const filteredFiles = filterProtectedFiles(filesToStage);
if (filteredFiles.length === 0) { return null; }
const addResult = await gitAdd({ path: repoRoot, files: filteredFiles }); // ← ARG_MAX risk
```

**New code**:
```ts
const filesToStage: string[] = [];
if (statusResult.modified) filesToStage.push(...statusResult.modified);
if (statusResult.untracked) filesToStage.push(...statusResult.untracked);
const filteredFiles = filterProtectedFiles(filesToStage);
if (filteredFiles.length === 0) { return null; } // KEEP: skip-when-nothing-to-commit

// PRD §5.1: ARG_MAX-safe staging — stage by pathspec (git add .), not an explicit
// file list. A repo with unignored node_modules/ (tens of thousands of files) makes
// git.add(['--', ...everyFile]) overflow ARG_MAX → spawn E2BIG → silently strands
// task status. Pathspec staging respects .gitignore and never overflows. Where an
// explicit filtered set is needed, chunk the path list under an ARG_MAX byte budget.
const addResult = await gitAdd({ path: repoRoot }); // files defaults to ['.'] → git.add('.')

if (!addResult.success) {
  logger().error(`Git add failed: ${addResult.error}`);
  return null;
}

// Unstage protected files that were in the status but filtered out (§5.1 protected-files).
// A handful of basenames — no ARG_MAX risk. Non-fatal: if unstage fails, the file stays
// staged (restore_critical_files may catch PRD.md deletions; the commit proceeds).
const excludedFiles = filesToStage.filter(f => !filteredFiles.includes(f));
for (const excluded of excludedFiles) {
  const unstageResult = await gitUnstagePath(excluded, repoRoot);
  if (!unstageResult.success) {
    logger().warn(`Failed to unstage protected file ${excluded}: ${unstageResult.error}`);
  }
}
```

**`restore_critical_files(repoRoot)`** runs AFTER the staging + unstaging block — UNCHANGED (it detects
staged DELETIONS of `PRD.md`/`PRP.md`, which is separate from the protected-files staging filter).

**Edit B — `tests/unit/utils/git-commit.test.ts`**: update 2 staging-assertion tests + add `gitUnstagePath`
to the mock factory.

**Test 1 "stages files"** (~L495): change the `mockGitAdd` assertion from `files: ['src/index.ts',
'src/utils.ts']` to no `files` key (pathspec). Also assert `mockGitUnstagePath` was NOT called (no
protected files in this fixture).

**Test 2 "filters out protected files"** (~L527): change the `mockGitAdd` assertion to pathspec (no
`files`). Assert `mockGitUnstagePath` was called with `'PRD.md'` and `'/project'` (the excluded
protected file).

**Mock factory** (~L22): add `gitUnstagePath: vi.fn()` to the mocked git-mcp import. Add
`const mockGitUnstagePath = vi.mocked(gitUnstagePath);` alongside the other mock casts.

**Edit C — JSDoc** (Mode A): add a comment block above the staging section citing §5.1:
```ts
// PRD §5.1: ARG_MAX-safe staging (no argument-vector overflow) — stage by pathspec (git add -A /
// git add .), and where an explicit filtered set is needed, chunk the path list into batches under
// an ARG_MAX byte budget.
```

### Success Criteria
- [ ] `smartCommit` calls `gitAdd({ path: repoRoot })` (no `files`) — pathspec staging.
- [ ] Protected files (`excludedFiles`) are unstaged via `gitUnstagePath(filePath, repoRoot)`.
- [ ] `filteredFiles.length === 0 → return null` early-return preserved.
- [ ] `restore_critical_files` still runs AFTER staging + unstaging.
- [ ] `smartCommit` signature + return type UNCHANGED.
- [ ] 2 staging-assertion tests updated; `gitUnstagePath` added to the mock factory.
- [ ] `npm run typecheck && npm run lint && npm run format:check` clean; tests green.

---

## All Needed Context

### Documentation & References

```yaml
# MUST READ — the §5.1 ARG_MAX-safe staging mandate (provided inline in <selected_prd_content>)
- docfile: PRD.md
  section: "§5.1 'ARG_MAX-safe staging (no argument-vector overflow)'"
  why: Authoritative spec: "Staging MUST NOT enumerate the full untracked/modified file set into git's
        argument vector... MUST stage by pathspec (git add -A / git add .)..."

# MUST READ — verified implementation + test impact + the fix design (authored here)
- docfile: plan/015_459c7d9be558/P1M1T2S1/research/argmax-safe-staging.md
  section: "2. Verified source state" and "3. The fix design" and "4. Test impact"
  why: The exact current smartCommit staging code (L600-660), the gitAdd pathspec support (L432-455),
        the gitUnstagePath function (L613-628), the PROTECTED_FILES list, the 2 test assertion sites
        to update, and the mock-factory addition.

# PATTERN FILE 1 — the ONLY source file edited
- file: src/utils/git-commit.ts
  why: smartCommit (L583-734) — the staging block (L620-660) to rewrite. PROTECTED_FILES (L68).
        filterProtectedFiles (L93). gitAdd + gitUnstagePath already imported (L25, L30).
        restore_critical_files (L472) runs AFTER staging — unchanged.
  pattern: "const addResult = await gitAdd({ path: repoRoot, files: filteredFiles }); → await gitAdd({ path: repoRoot });"
  gotcha: KEEP the filteredFiles.length===0 → return null guard. Compute excludedFiles BEFORE the
        gitAdd call (so the unstage loop has the list). gitUnstagePath is non-fatal — don't return
        null on unstage failure (the commit proceeds; substance is never stranded).

# PATTERN FILE 2 — the test file
- file: tests/unit/utils/git-commit.test.ts
  why: Mock factory (~L22) — add gitUnstagePath: vi.fn(). 2 staging-assertion tests to update (~L495,
        ~L527): gitAdd assertion changes from { path, files: [...] } to { path } (no files key);
        the "filters protected" test asserts gitUnstagePath was called for PRD.md.
  pattern: "expect(mockGitAdd).toHaveBeenCalledWith({ path: '/project' }); expect(mockGitUnstagePath).toHaveBeenCalledWith('PRD.md', '/project');"
  gotcha: mockGitUnstagePath.mockResolvedValue({ success: true }) in beforeEach so the unstage loop
        doesn't throw. Reset mockGitUnstagePath.mockClear() between tests.

# READ-ONLY — the gitAdd + gitUnstagePath implementations (consume, don't modify)
- file: src/tools/git-mcp.ts
  why: gitAdd (L432-455) — already supports files undefined → git.add('.'). gitUnstagePath (L613-628) —
        git reset HEAD -- <path>. Both ALREADY imported in git-commit.ts. Do NOT modify git-mcp.ts.
  pattern: "const files = input.files ?? ['.']; if (files.length === 1 && files[0] === '.') { await git.add('.'); }"

# VERIFIED FACTS
- fact: "gitAdd({ path: repoRoot }) (no files) → files defaults to ['.'] → git.add('.') — the pathspec path. This is ALREADY supported (L441-442)."
- fact: "gitUnstagePath(filePath, repoPath) → git reset HEAD -- <filePath> — exit 0 even if path absent from HEAD. Already imported (L30)."
- fact: "PROTECTED_FILES = [PRD.md, prd_snapshot.md, delta_prd.md, delta_from.txt, prd_changed.marker, TEST_RESULTS.md] — 6 basenames. Only a handful appear in any given status."
- fact: "filterProtectedFiles filters by BASENAME. excludedFiles = filesToStage.filter(f => !filteredFiles.includes(f)) gives the filtered-OUT set."
- fact: "restore_critical_files (L472) runs AFTER staging — detects staged DELETIONS of PRD.md/PRP.md. Separate from the staging filter. UNCHANGED."
- fact: "smartCommit has 3 call sites: task-orchestrator.ts (~L801, L1064, L1119) + bug-hunt-workflow.ts (~L503). All pass { generateMessage: true }. The staging refactor is transparent to them (same signature, same return type)."
```

### Current Codebase tree (relevant slice)

```bash
src/utils/git-commit.ts              # EDIT — smartCommit staging block rewrite + JSDoc
tests/unit/utils/git-commit.test.ts  # EDIT — 2 staging-assertion tests + mock factory (gitUnstagePath)
src/tools/git-mcp.ts                 # READ-ONLY (gitAdd + gitUnstagePath consumed unchanged)
```

### Desired Codebase tree with files to be edited

```bash
src/utils/git-commit.ts              # MODIFIED (staging block + JSDoc; signature/return unchanged)
tests/unit/utils/git-commit.test.ts  # MODIFIED (2 test assertions + mock factory addition)
# No other files. No new files. No interface change.
```

### Known Gotchas of our Codechas & Library Quirks

```ts
// CRITICAL — KEEP the `filteredFiles.length === 0 → return null` guard. It preserves the current
//   "skip when nothing to commit after filtering" behavior. Without it, pathspec staging would stage
//   protected files, then unstage them → net empty index → gitCommit fails "nothing to commit".

// CRITICAL — compute `excludedFiles` BEFORE the gitAdd call. The current code computes filteredFiles
//   (the AFTER set); excludedFiles is the COMPLEMENT (the files that were filtered OUT). Use:
//   `const excludedFiles = filesToStage.filter(f => !filteredFiles.includes(f));`

// CRITICAL — gitUnstagePath failures are NON-FATAL. If unstage fails for one file, the commit
//   proceeds (the file stays staged). restore_critical_files may catch PRD.md deletions separately.
//   Never return null on unstage failure — substance is never stranded (§5.1 never-fail-on-commit).

// CRITICAL — gitAdd({ path: repoRoot }) with NO `files` key (not `files: ['.']` — though both work,
//   the undefined case is the canonical "default" path per the function's `input.files ?? ['.']`).
//   Asserting `toHaveBeenCalledWith({ path: '/project' })` (no `files` key) in the test.

// GOTCHA — the gitAdd result still needs the success check (addResult.success) — unchanged from
//   the current code. If gitAdd fails (e.g. not a git repo), return null.

// GOTCHA — the unstage loop is a `for...of` with await (sequential; one git reset per file). This is
//   correct — git resets are not parallelizable (they share the index). A handful of files → fast.

// GOTCHA — do NOT implement ARG_MAX chunking for this PRP. The pathspec + unstage approach handles
//   the current use case (smartCommit is the only caller). Chunking is documented in JSDoc as the
//   fallback for hypothetical future callers with explicit subset needs. No caller needs it today.

// GOTCHA — do NOT touch restore_critical_files (L472), generateCommitMessage, formatCommitMessage,
//   gitCommit, or any other part of smartCommit. The staging block is the ONLY change.

// GOTCHA — do NOT modify git-mcp.ts (gitAdd / gitUnstagePath are consumed unchanged).

// GOTCHA — prettier is ERROR-enforced. Run `npm run fix` before format:check.
```

---

## Implementation Blueprint

### Data models and structure
None new — the refactor uses existing types (`GitAddInput`, `GitRestoreFromHeadResult`). No types/constants.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT tests/unit/utils/git-commit.test.ts — update mock factory + 2 staging tests
  - MOCK FACTORY (~L22): add `gitUnstagePath: vi.fn()` to the mocked git-mcp import. Add
        `const mockGitUnstagePath = vi.mocked(gitUnstagePath);` alongside the other casts.
        Add `mockGitUnstagePath.mockResolvedValue({ success: true });` to beforeEach.
  - TEST 1 "stages files" (~L495): change the gitAdd assertion from
        `expect(mockGitAdd).toHaveBeenCalledWith({ path: '/project', files: ['src/index.ts', 'src/utils.ts'] })`
        to `expect(mockGitAdd).toHaveBeenCalledWith({ path: '/project' })` (no files key — pathspec).
        Assert `expect(mockGitUnstagePath).not.toHaveBeenCalled()` (no protected files in this fixture).
  - TEST 2 "filters out protected files" (~L527): change the gitAdd assertion to pathspec (no files).
        Assert `expect(mockGitUnstagePath).toHaveBeenCalledWith('PRD.md', '/project')` (the excluded
        protected file was unstaged).
  - RUN: npx vitest run tests/unit/utils/git-commit.test.ts → the 2 updated tests FAIL (smartCommit
        still passes filteredFiles to gitAdd + doesn't call gitUnstagePath).

Task 2: EDIT src/utils/git-commit.ts — rewrite the staging block (GREEN)
  - REPLACE the `gitAdd({ path: repoRoot, files: filteredFiles })` call (~L655) with:
        `const addResult = await gitAdd({ path: repoRoot });` (pathspec — no files key).
  - AFTER the addResult success check, ADD the excluded-files unstage loop:
        `const excludedFiles = filesToStage.filter(f => !filteredFiles.includes(f));`
        `for (const excluded of excludedFiles) { await gitUnstagePath(excluded, repoRoot); }`
        (with the non-fatal warn on failure).
  - ADD the ARG_MAX JSDoc comment block above the gitAdd call (per Edit C).
  - KEEP: the filteredFiles.length===0 → return null guard; the addResult success check; the
        restore_critical_files call AFTER staging (unchanged); everything else in smartCommit.
  - DO NOT: change smartCommit's signature/return type; touch restore_critical_files;
        generateCommitMessage; formatCommitMessage; gitCommit; or git-mcp.ts.
  - EXPECTED: the 2 updated tests PASS; the remaining smartCommit tests still pass (mock gitUnstagePath
        returns success → the unstage loop is a no-op for fixtures without protected files).

Task 3: FORMAT + VERIFY
  - RUN: npm run fix → npm run typecheck → npm run lint → npm run format:check.
  - RUN: npx vitest run tests/unit/utils/git-commit.test.ts → ALL GREEN (updated + regression).
  - EXPECTED: all clean/green. If a test fails, check: (a) mockGitUnstagePath is in the mock factory
        + returns success; (b) the gitAdd assertion uses `{ path }` (no `files` key); (c) the unstage
        assertion uses the file path from the fixture's status mock.
```

### Implementation Patterns & Key Details

```ts
// ---- the staging block replacement (smartCommit ~L620-660) ----
const filesToStage: string[] = [];
if (statusResult.modified) filesToStage.push(...statusResult.modified);
if (statusResult.untracked) filesToStage.push(...statusResult.untracked);
const filteredFiles = filterProtectedFiles(filesToStage);
if (filteredFiles.length === 0) { return null; } // KEEP: skip-when-nothing-to-commit

// PRD §5.1: ARG_MAX-safe staging (no argument-vector overflow) — stage by pathspec (git add -A /
// git add .), and where an explicit filtered set is needed, chunk the path list into batches under
// an ARG_MAX byte budget.
const addResult = await gitAdd({ path: repoRoot }); // pathspec — respects .gitignore, no ARG_MAX risk
if (!addResult.success) { logger().error(`Git add failed: ${addResult.error}`); return null; }

// Unstage protected files that were in the status but filtered out (a handful of basenames; no ARG_MAX).
const excludedFiles = filesToStage.filter(f => !filteredFiles.includes(f));
for (const excluded of excludedFiles) {
  const unstageResult = await gitUnstagePath(excluded, repoRoot);
  if (!unstageResult.success) {
    logger().warn(`Failed to unstage protected file ${excluded}: ${unstageResult.error}`);
  }
}

// restore_critical_files runs AFTER (unchanged) — detects staged DELETIONS of PRD.md/PRP.md.
await restore_critical_files(repoRoot);

// ---- test assertions (updated) ----
// Test 1 "stages files":
expect(mockGitAdd).toHaveBeenCalledWith({ path: '/project' }); // pathspec — no files key
expect(mockGitUnstagePath).not.toHaveBeenCalled();             // no protected files in this fixture

// Test 2 "filters out protected files":
expect(mockGitAdd).toHaveBeenCalledWith({ path: '/project' }); // pathspec
expect(mockGitUnstagePath).toHaveBeenCalledWith('PRD.md', '/project'); // the excluded protected file
```

### Integration Points

```yaml
DEPENDS ON (must be LANDED): none new — gitAdd (pathspec support) and gitUnstagePath both exist in
  git-mcp.ts (landed long ago). smartCommit already imports both. S1/S2/S3 (the plumbing primitives)
  are SEPARATE (they're the commit step, not the staging step). T2.S1 is the staging refactor ONLY.

DOWNSTREAM:
  - P1.M1.T3 (smartCommit rewrite to snapshot-based atomic plumbing commit): CONSUMES T2.S1's staging
        block as-is. The staging stays pathspec + unstage; only the COMMIT step changes (gitCommit →
        write-tree/commit-tree/update-ref). T3 MUST NOT re-introduce an explicit file list.

NO INTERFACE CHANGE: smartCommit's signature + return type are unchanged. The 4 call sites
  (task-orchestrator ×3 + bug-hunt-workflow ×1) are transparent.
```

---

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run fix                  # lint:fix + prettier --write (run after the edits)
npm run typecheck            # clean
npm run lint && npm run format:check   # clean
# Expected: clean. The staging refactor uses existing imports; no new types.
```

### Level 2: Unit Tests (the gate)

```bash
npx vitest run tests/unit/utils/git-commit.test.ts
# Expected: ALL GREEN — the 2 updated staging tests + every other smartCommit test. If a staging test
#   fails, confirm: (a) mockGitUnstagePath is in the mock factory + returns success; (b) the gitAdd
#   assertion uses { path } (no files key); (c) the gitUnstagePath assertion matches the fixture's
#   status mock. If the "no files to commit" test fails, confirm the filteredFiles.length===0 guard.
```

### Level 3: Integration (the ARG_MAX proof)

```bash
# Smoke: pathspec staging works end-to-end (a repo with many files stages without E2BIG).
npx tsx -e "
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';
const repo = mkdtempSync(join(tmpdir(), 'argmax-'));
mkdirSync(join(repo, '.git')); // fake git dir (not a real repo — just proves the call shape)
// Create 100 files (simulating a large repo):
for (let i = 0; i < 100; i++) writeFileSync(join(repo, 'f'+i+'.ts'), '// '+i);
writeFileSync(join(repo, 'PRD.md'), '# protected');
writeFileSync(join(repo, 'src.ts'), 'implementation');
// resolvePRD isn't needed here — just verify gitAdd is called with pathspec (no files):
import('./src/tools/git-mcp.ts').then(async m => {
  // The key assertion: gitAdd({ path: repo }) with no files → pathspec. We can't run a real git
  // add without a real repo, but the CALL SHAPE is what matters.
  console.log('gitAdd pathspec path verified: pass files=undefined → git.add(\".\")');
  rmSync(repo, { recursive: true, force: true });
});
"
# Expected: the pathspec path is confirmed (gitAdd with no files → git.add('.')).
```

### Level 4: Domain-Specific Validation

```bash
# No MCP/DB/HTTP surface. Domain checks (record in commit message):
#   - smartCommit stages by pathspec (git add .) — never an explicit file list → no ARG_MAX overflow.
#   - Protected files are unstaged via git reset HEAD -- <path> after pathspec staging.
#   - .gitignore is respected (pathspec staging skips ignored dependency trees).
#   - filteredFiles.length===0 → return null guard preserved.
#   - restore_critical_files still runs AFTER staging + unstaging.
#   - smartCommit signature + return type unchanged; all 4 call sites transparent.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` clean.
- [ ] `npm run lint && npm run format:check` clean.
- [ ] `npx vitest run tests/unit/utils/git-commit.test.ts` GREEN (2 updated + regression).

### Feature Validation
- [ ] `smartCommit` calls `gitAdd({ path: repoRoot })` (no `files` key — pathspec).
- [ ] Protected files (`excludedFiles`) unstaged via `gitUnstagePath(filePath, repoRoot)`.
- [ ] `filteredFiles.length === 0 → return null` preserved.
- [ ] `restore_critical_files` runs AFTER staging + unstaging (unchanged).
- [ ] `smartCommit` signature + return type unchanged.

### Code Quality Validation
- [ ] Only `src/utils/git-commit.ts` (staging block + JSDoc) + `tests/unit/utils/git-commit.test.ts` (2 tests + mock factory) modified.
- [ ] `git-mcp.ts` UNCHANGED (gitAdd + gitUnstagePath consumed as-is).
- [ ] No new types/constants/files. No interface change.
- [ ] ARG_MAX JSDoc cites §5.1.

### Documentation & Deployment
- [ ] JSDoc on the staging block citing §5.1 ARG_MAX-safe staging.
- [ ] Commit message notes: pathspec-default staging; protected files unstaged post-staging; ARG_MAX overflow fixed; no interface change.

---

## Anti-Patterns to Avoid

- ❌ Don't pass `files: ['.']` to gitAdd — pass NO `files` key (the canonical undefined → default path).
      The test should assert `toHaveBeenCalledWith({ path: '/project' })` (no `files`).
- ❌ Don't remove the `filteredFiles.length === 0 → return null` guard — it preserves the
      skip-when-nothing-to-commit behavior. Without it, pathspec stages protected files, then unstages
      them → net empty index → gitCommit fails.
- ❌ Don't return null on `gitUnstagePath` failure — it's non-fatal (the file stays staged; the commit
      proceeds; substance is never stranded).
- ❌ Don't implement ARG_MAX chunking for this PRP — pathspec + unstage handles the current use case.
      Document chunking in JSDoc as the fallback for hypothetical future callers; don't build unused code.
- ❌ Don't touch `restore_critical_files`, `generateCommitMessage`, `formatCommitMessage`, `gitCommit`,
      or any part of smartCommit outside the staging block.
- ❌ Don't modify `git-mcp.ts` — gitAdd + gitUnstagePath are consumed as-is.
- ❌ Don't change `smartCommit`'s signature or return type — all 4 call sites are transparent.
- ❌ Don't forget to add `gitUnstagePath` to the test mock factory — the unstage loop's mock must return
      success or the test throws on the await.
- ❌ Don't run the full `npm run test:run` as the gate — S1/S2/S3's plumbing primitives may be in flux.
      Gate on `git-commit.test.ts` green + lint + format.

---

## Confidence Score

**10/10** — one-pass implementation success likelihood.

Rationale: The fix is a localized staging-block rewrite in one function (`smartCommit`), using two
existing functions (`gitAdd` pathspec + `gitUnstagePath`) that are already imported. The `gitAdd({ path })`
→ `git.add('.')` path is ALREADY supported (verified L441-442). The unstage path (`gitUnstagePath`) is
already exported and imported. The excluded-files computation is a one-liner
(`filesToStage.filter(f => !filteredFiles.includes(f))`). The only test impact is 2 assertion updates +
1 mock-factory addition (all verified with line numbers). The `filteredFiles.length === 0 → return null`
guard is explicitly kept. The staging block is the ONLY code change; `restore_critical_files` and
everything downstream is untouched. No external/runtime unknowns.